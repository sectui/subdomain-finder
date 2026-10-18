import { isUnder, normalizeName, type Source } from "./source.ts";
import { sources as builtinSources } from "./sources/index.ts";

export interface FindOptions {
  /** Sources to query (default: every built-in source). */
  sources?: readonly Source[];
  /** API keys by source name. A source that requires one is skipped without it. */
  apiKeys?: Readonly<Record<string, string>>;
  /** Per-source timeout in milliseconds (default: 60 s). */
  timeout?: number;
  signal?: AbortSignal;
  /** Replaces the global fetch, for tests or proxies. */
  fetch?: typeof fetch;
}

export type SourceResult =
  | { source: string; status: "ok"; names: string[] }
  | { source: string; status: "failed"; error: string }
  | { source: string; status: "skipped"; reason: string };

export function normalizeDomain(domain: string): string {
  const name = normalizeName(domain);
  if (!name?.includes(".")) throw new TypeError(`Invalid domain: ${domain}`);
  return name;
}

/** fetch rejects with a bare "fetch failed": the network error is in `cause`. */
function describe(error: unknown): string {
  if (!(error instanceof Error)) return String(error);
  return error.cause instanceof Error ? `${error.message}: ${error.cause.message}` : error.message;
}

/** Yields one result per source, in completion order. A failing source never stops the others. */
export async function* find(domain: string, options: FindOptions = {}): AsyncGenerator<SourceResult> {
  const apex = normalizeDomain(domain);
  const { sources = builtinSources, apiKeys = {}, timeout = 60_000, fetch: fetchImpl = fetch } = options;

  async function run(source: Source): Promise<SourceResult> {
    const apiKey = apiKeys[source.name];
    if (source.apiKey === "required" && !apiKey) return { source: source.name, status: "skipped", reason: "missing API key" };
    const signals = [AbortSignal.timeout(timeout), ...(options.signal ? [options.signal] : [])];
    try {
      const raw = await source.run(apex, { fetch: fetchImpl, signal: AbortSignal.any(signals), apiKey });
      const names = new Set<string>();
      for (const r of raw) {
        const name = normalizeName(r);
        if (name && isUnder(name, apex)) names.add(name);
      }
      return { source: source.name, status: "ok", names: [...names].sort() };
    } catch (error) {
      // Errors are printed and saved: a key echoed back (e.g. in a URL) must not leak.
      const message = apiKey ? describe(error).replaceAll(apiKey, "***") : describe(error);
      return { source: source.name, status: "failed", error: message };
    }
  }

  const pending = new Map(sources.map((s) => [s.name, run(s)]));
  while (pending.size) {
    const result = await Promise.race(pending.values());
    pending.delete(result.source);
    yield result;
  }
}
