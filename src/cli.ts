#!/usr/bin/env node
import { existsSync, readFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { find, normalizeDomain } from "./find.ts";
import { configPath, envName, readConfigKeys, resolveApiKeys } from "./keys.ts";
import { trustCA, useProxy } from "./proxy.ts";
import { sources } from "./sources/index.ts";
import {
  applyResult,
  defaultOutput,
  emptyState,
  loadNames,
  loadState,
  mergeNames,
  save,
  statePath,
  succeeded,
  type State,
} from "./state.ts";

type Package = { version: string; description: string };
/** Inlined by scripts/bundle.ts, undefined everywhere else. */
declare const BUNDLED_PACKAGE: Package | undefined;

// Read at run time: the same relative path works from src/ and from the built dist/.
const pkg: Package =
  typeof BUNDLED_PACKAGE !== "undefined"
    ? BUNDLED_PACKAGE
    : (JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as Package);

class UsageError extends Error {}

const USAGE = `subdomain-finder ${pkg.version} - ${pkg.description}

Usage:
  subdomain-finder [options] <domain>
  subdomain-finder --info [-o <file>] <domain>

Options:
  -o, --output <file>         Where to write hostnames (default: subdomains-<domain>.txt).
                              Running the same command again only queries the sources that did not succeed.
                              "-" prints them to stdout as they are found, without state.
  -s, --sources <list>        Comma-separated sources to query (default: all)
  -k, --api-key <source=key>  API key for a source (repeatable)
      --fresh                 Ignore the previous run and query every source again
      --timeout <seconds>     Per-source timeout (default: 60)
      --proxy <url>           Send every request through this HTTP proxy, e.g. http://127.0.0.1:8080
      --proxy-ca <pem>        Also trust this CA, for an intercepting proxy
                              (spilltea: ~/.local/share/spilltea/ca/ca.pem)
      --info                  Summarize the previous run from its state file, without querying anything
      --list-sources          List available sources
  -h, --help                  Show help
  -v, --version               Show version

API keys are looked up in this order: --api-key, then $SUBDOMAIN_FINDER_<SOURCE>_KEY,
then api_keys in ${configPath()}:
  api_keys:
    virustotal: ...

Progress goes to stderr.

Examples:
  subdomain-finder example.com
  subdomain-finder -o - example.com | httpx
  subdomain-finder -k virustotal=XXXX -s virustotal,crtsh example.com
  subdomain-finder --proxy http://127.0.0.1:8080 --proxy-ca ~/.local/share/spilltea/ca/ca.pem example.com
  subdomain-finder --info example.com`;

function parse(argv: string[]) {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      output: { type: "string", short: "o" },
      sources: { type: "string", short: "s" },
      "api-key": { type: "string", short: "k", multiple: true },
      fresh: { type: "boolean" },
      proxy: { type: "string" },
      "proxy-ca": { type: "string" },
      timeout: { type: "string" },
      info: { type: "boolean" },
      "list-sources": { type: "boolean" },
      help: { type: "boolean", short: "h" },
      version: { type: "boolean", short: "v" },
    },
  });
  if (values.help || values.version || values["list-sources"]) return { ...values, domain: "", timeout: 0 };
  if (positionals.length !== 1) throw new UsageError("expected exactly one domain");
  const timeout = Number(values.timeout ?? 60);
  if (!(timeout > 0)) throw new UsageError(`invalid timeout: ${values.timeout}`);
  return { ...values, domain: normalizeDomain(positionals[0]!), timeout: timeout * 1000 };
}

function selectSources(list: string | undefined) {
  if (list === undefined) return sources;
  return list.split(",").map((name) => {
    const source = sources.find((s) => s.name === name.trim());
    if (!source) throw new UsageError(`unknown source: ${name} (see --list-sources)`);
    return source;
  });
}

function parseCliKeys(args: string[] = []): Record<string, string> {
  return Object.fromEntries(
    args.map((arg) => {
      const [name = "", key = ""] = arg.split(/=(.*)/s);
      if (!key) throw new UsageError(`expected --api-key <source>=<key>, got ${arg}`);
      if (!sources.some((s) => s.name === name)) throw new UsageError(`unknown source: ${name} (see --list-sources)`);
      return [name, key];
    }),
  );
}

function configKeys() {
  try {
    return readConfigKeys();
  } catch (error) {
    throw new UsageError(error instanceof Error ? error.message : String(error));
  }
}

function listSources(): string {
  const width = Math.max(...sources.map((s) => s.name.length));
  return sources.map((s) => `${s.name.padEnd(width)}  ${s.description}`).join("\n");
}

function info(output: string, state: State, results: number): string {
  const by = (status: string) => sources.filter((s) => state.sources[s.name]?.status === status).map((s) => s.name);
  const notRun = sources.flatMap((s) => {
    const entry = state.sources[s.name];
    if (!entry) return [`${s.name} (never queried)`];
    return entry.status === "skipped" ? [`${s.name} (${entry.reason})`] : [];
  });
  const row = (label: string, names: string[]) => `${label.padEnd(9)}  ${String(names.length).padStart(3)}  ${names.join(", ")}`.trimEnd();
  return [
    `${output} (${state.domain})`,
    row("succeeded", by("ok")),
    row("failed", by("failed")),
    row("not run", notRun),
    `${"results".padEnd(9)}  ${String(results).padStart(3)}`,
  ].join("\n");
}

async function main(argv: string[]): Promise<number> {
  const args = parse(argv);
  if (args.help) return (void console.log(USAGE), 0);
  if (args.version) return (void console.log(pkg.version), 0);
  if (args["list-sources"]) return (void console.log(listSources()), 0);

  const { domain } = args;
  const output = args.output ?? defaultOutput(domain);
  const toStdout = output === "-";

  if (args.info) {
    if (toStdout) throw new UsageError("--info needs a file, not stdout");
    const state = loadState(output);
    if (!state) {
      console.error(`subdomain-finder: no previous run for ${domain} (${statePath(output)} not found)`);
      return 1;
    }
    console.log(info(output, state, loadNames(output).size));
    return 0;
  }

  const cliKeys = parseCliKeys(args["api-key"]);
  let selected = selectSources(args.sources);

  let state = emptyState(domain);
  let names = new Set<string>();
  if (!toStdout) {
    const previous = args.fresh ? undefined : loadState(output);
    if (previous) {
      if (previous.domain !== domain)
        throw new UsageError(`${output} holds results for ${previous.domain}, not ${domain} (use --fresh to replace it)`);
      state = previous;
      names = loadNames(output);
      const skipped = selected.filter((s) => succeeded(state, s.name));
      selected = selected.filter((s) => !succeeded(state, s.name));
      if (skipped.length) console.error(`resuming ${output}: skipping ${skipped.map((s) => s.name).join(", ")}`);
      if (!selected.length) {
        console.error("every source already succeeded (use --fresh to query them again)");
        return 0;
      }
    } else if (!args.fresh && existsSync(output)) {
      throw new UsageError(`${output} exists but has no ${statePath(output)}: remove it or pick another file`);
    }
  }

  // The config file is only read when a selected source could use a key.
  const wantKeys = selected.filter((s) => s.apiKey).map((s) => s.name);
  const apiKeys = wantKeys.length ? resolveApiKeys(wantKeys, { cli: cliKeys, env: process.env, config: configKeys() }) : {};

  if (args.proxy) useProxy(args.proxy);
  if (args["proxy-ca"]) {
    try {
      trustCA(args["proxy-ca"]);
    } catch (error) {
      throw new UsageError(`--proxy-ca: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  const controller = new AbortController();
  process.once("SIGINT", () => controller.abort(new Error("interrupted")));

  const width = Math.max(...selected.map((s) => s.name.length));
  const retry: string[] = [];
  let anyOk = false;
  for await (const result of find(domain, { sources: selected, apiKeys, timeout: args.timeout, signal: controller.signal })) {
    applyResult(state, result);
    const added = result.status === "ok" ? mergeNames(names, result.names) : [];
    const label = result.source.padEnd(width);
    if (result.status === "ok") {
      anyOk = true;
      console.error(`${label}  ok       ${result.names.length} names, ${added.length} new`);
      if (toStdout) for (const name of added) console.log(name);
    } else if (result.status === "failed") {
      retry.push(result.source);
      console.error(`${label}  failed   ${result.error}`);
    } else {
      retry.push(result.source);
      console.error(`${label}  skipped  ${result.reason} (--api-key ${result.source}=<key> or $${envName(result.source)})`);
    }
    // Saved after every source, so an interrupted run keeps what it already got.
    if (!toStdout) save(output, state, names);
  }

  if (!toStdout) {
    console.error(`${output}: ${names.size} names`);
    if (retry.length) console.error(`not done: ${retry.join(", ")}. Run the same command again to retry them.`);
  }
  return anyOk ? 0 : 1;
}

try {
  process.exitCode = await main(process.argv.slice(2));
} catch (error) {
  if (error instanceof UsageError || error instanceof TypeError) {
    console.error(`subdomain-finder: ${error.message}\nRun subdomain-finder --help for usage.`);
    process.exitCode = 2;
  } else throw error;
}
