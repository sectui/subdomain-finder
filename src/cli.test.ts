import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { applyResult, emptyState, loadState, save } from "./state.ts";

const CLI = `${import.meta.dirname}/cli.ts`;

const tmp = () => mkdtempSync(join(tmpdir(), "subdomain-finder-"));

// No network: every case stops before a source runs, or only runs sources skipped for lack of a key.
function cli(args: string[], options: { cwd?: string; env?: Record<string, string> } = {}) {
  const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith("SUBDOMAIN_FINDER_")));
  const proc = spawnSync(process.execPath, [CLI, ...args], {
    encoding: "utf8",
    cwd: options.cwd ?? tmp(),
    env: { ...env, XDG_CONFIG_HOME: tmp(), ...options.env },
  });
  return { stdout: proc.stdout, stderr: proc.stderr, code: proc.status };
}

test("--list-sources lists every source", () => {
  const { stdout, code } = cli(["--list-sources"]);
  assert.equal(code, 0);
  assert.match(stdout, /^crtsh /m);
  assert.match(stdout, /^crtname /m);
  assert.match(stdout, /^virustotal /m);
});

test("usage errors exit with 2", () => {
  assert.equal(cli([]).code, 2);
  assert.equal(cli(["not a domain"]).code, 2);
  assert.equal(cli(["--nope", "example.com"]).code, 2);
  assert.match(cli(["-s", "nope", "example.com"]).stderr, /unknown source: nope/);
  assert.match(cli(["-k", "virustotal", "example.com"]).stderr, /expected --api-key <source>=<key>/);
  assert.match(cli(["-k", "nope=x", "example.com"]).stderr, /unknown source: nope/);
});

test("an existing output without state is never overwritten", () => {
  const output = join(tmp(), "subs.txt");
  writeFileSync(output, "mine\n");
  const { stderr, code } = cli(["-o", output, "example.com"]);
  assert.equal(code, 2);
  assert.match(stderr, /has no .*subs\.txt\.state\.json/);
});

test("a resumed run refuses another domain and skips sources that succeeded", () => {
  const output = join(tmp(), "subs.txt");
  const state = emptyState("example.com");
  applyResult(state, { source: "crtsh", status: "ok", names: ["a.example.com"] });
  save(output, state, new Set(["a.example.com"]));

  assert.match(cli(["-o", output, "example.org"]).stderr, /holds results for example\.com/);

  const { stderr, code } = cli(["-o", output, "-s", "crtsh", "example.com"]);
  assert.equal(code, 0);
  assert.match(stderr, /skipping crtsh/);
  assert.match(stderr, /every source already succeeded/);
});

test("the default output is named after the domain, and keyless sources are recorded as skipped", () => {
  const cwd = tmp();
  const { stderr, code } = cli(["-s", "virustotal,securitytrails", "Example.COM"], { cwd });
  assert.equal(code, 1);
  assert.match(stderr, /virustotal +skipped +missing API key \(--api-key virustotal=<key> or \$SUBDOMAIN_FINDER_VIRUSTOTAL_KEY\)/);
  const output = join(cwd, "subdomains-example.com.txt");
  assert.ok(existsSync(output));
  assert.equal(loadState(output)?.sources.securitytrails?.status, "skipped");
});

test("a corrupted state is a usage error, not a crash", () => {
  const cwd = tmp();
  writeFileSync(join(cwd, "subdomains-example.com.txt.state.json"), "{ not json");
  const { stderr, code } = cli(["--info", "example.com"], { cwd });
  assert.equal(code, 2);
  assert.match(stderr, /is not valid JSON: delete it or use --fresh/);
});

test("--info summarizes the state without querying anything", () => {
  const cwd = tmp();
  const state = emptyState("example.com");
  applyResult(state, { source: "crtsh", status: "ok", names: ["a.example.com", "b.example.com"] });
  applyResult(state, { source: "certspotter", status: "ok", names: ["b.example.com", "c.example.com"] });
  applyResult(state, { source: "otx", status: "failed", error: "HTTP 429" });
  applyResult(state, { source: "virustotal", status: "skipped", reason: "missing API key" });
  save(join(cwd, "subdomains-example.com.txt"), state, new Set(["a.example.com", "b.example.com", "c.example.com"]));

  const { stdout, code } = cli(["--info", "example.com"], { cwd });
  assert.equal(code, 0);
  assert.match(stdout, /^subdomains-example\.com\.txt \(example\.com\)$/m);
  assert.match(stdout, /^succeeded +2 +crtsh, certspotter$/m);
  assert.match(stdout, /^failed +1 +otx$/m);
  assert.match(stdout, /^not run +4 +.*virustotal \(missing API key\)/m);
  assert.match(stdout, /^not run .*hackertarget \(never queried\)/m);
  assert.match(stdout, /^results +3$/m);

  const missing = cli(["--info", "example.org"], { cwd });
  assert.equal(missing.code, 1);
  assert.match(missing.stderr, /no previous run for example\.org/);
});
