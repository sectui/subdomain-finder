export interface SourceContext {
  fetch: typeof fetch;
  /** Aborts on the caller's signal or on the per-source timeout. */
  signal: AbortSignal;
  apiKey?: string;
}

export interface Source {
  /** Stable id, used in the CLI and in the state file. */
  name: string;
  description: string;
  /** "required": skipped without a key. "optional": works without one, better with one. */
  apiKey?: "required" | "optional";
  /** Returns raw names: they are normalized and filtered to the domain by `find`. */
  run(domain: string, ctx: SourceContext): Promise<Iterable<string>>;
}

export class SourceError extends Error {
  override name = "SourceError";
}

async function get(url: string, ctx: SourceContext, headers?: Record<string, string>): Promise<Response> {
  const res = await ctx.fetch(url, { signal: ctx.signal, headers });
  if (!res.ok) throw new SourceError(`HTTP ${res.status} from ${new URL(url).host}`);
  return res;
}

export const getText = async (url: string, ctx: SourceContext, headers?: Record<string, string>) => (await get(url, ctx, headers)).text();
export const getJson = async (url: string, ctx: SourceContext, headers?: Record<string, string>): Promise<unknown> =>
  (await get(url, ctx, headers)).json();

const HOSTNAME = /^[a-z0-9_-]+(\.[a-z0-9_-]+)*$/;

export function normalizeName(raw: string): string | undefined {
  const name = raw
    .trim()
    .toLowerCase()
    .replace(/^(\*\.)+/, "")
    .replace(/\.$/, "");
  return HOSTNAME.test(name) ? name : undefined;
}

export const isUnder = (name: string, domain: string) => name === domain || name.endsWith(`.${domain}`);
