import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import type { SourceResult } from "./find.ts";

export type SourceState =
  | { status: "ok"; count: number; date: string }
  | { status: "failed"; error: string; date: string }
  | { status: "skipped"; reason: string; date: string };

/**
 * Hostnames live only in the output, so httpx, dnsx and friends can read it as is.
 * A source missing from `sources` counts as never run, so adding a source needs no migration.
 */
export interface State {
  domain: string;
  sources: Record<string, SourceState>;
}

export const defaultOutput = (domain: string) => `subdomains-${domain}.txt`;

export const statePath = (output: string) => `${output}.state.json`;

export const emptyState = (domain: string): State => ({ domain, sources: {} });

export function loadState(output: string): State | undefined {
  const path = statePath(output);
  if (!existsSync(path)) return undefined;
  let state: Partial<State> | null;
  try {
    state = JSON.parse(readFileSync(path, "utf8")) as Partial<State> | null;
  } catch {
    throw new TypeError(`${path} is not valid JSON: delete it or use --fresh`);
  }
  return { domain: state?.domain ?? "", sources: state?.sources ?? {} };
}

export function loadNames(output: string): Set<string> {
  if (!existsSync(output)) return new Set();
  return new Set(readFileSync(output, "utf8").split("\n").filter(Boolean));
}

export function applyResult(state: State, result: SourceResult) {
  const date = new Date().toISOString();
  state.sources[result.source] =
    result.status === "ok"
      ? { status: "ok", count: result.names.length, date }
      : result.status === "failed"
        ? { status: "failed", error: result.error, date }
        : { status: "skipped", reason: result.reason, date };
}

/** Returns the names the set did not have yet. */
export function mergeNames(names: Set<string>, found: Iterable<string>): string[] {
  const added: string[] = [];
  for (const name of found) {
    if (names.has(name)) continue;
    names.add(name);
    added.push(name);
  }
  return added;
}

export const succeeded = (state: State, source: string) => state.sources[source]?.status === "ok";

function writeAtomic(path: string, data: string) {
  writeFileSync(`${path}.tmp`, data);
  renameSync(`${path}.tmp`, path);
}

export function save(output: string, state: State, names: Set<string>) {
  const sorted = [...names].sort();
  writeAtomic(output, sorted.length ? `${sorted.join("\n")}\n` : "");
  writeAtomic(statePath(output), `${JSON.stringify(state, null, 2)}\n`);
}
