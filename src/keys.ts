import { existsSync, readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { parse } from "yaml";

export const configPath = () => join(process.env.XDG_CONFIG_HOME || join(homedir(), ".config"), "sectui", "subdomain-finder.yaml");

export const envName = (source: string) => `SUBDOMAIN_FINDER_${source.toUpperCase().replace(/\W/g, "_")}_KEY`;

/** Like ssh with private keys, refuses a file that other users can access. */
export function readConfigKeys(path = configPath()): Record<string, string> {
  if (!existsSync(path)) return {};
  const mode = statSync(path).mode & 0o777;
  if (process.platform !== "win32" && mode & 0o077)
    throw new Error(`${path} holds API keys but is accessible by other users (mode ${mode.toString(8)}): run chmod 600 ${path}`);
  const config = (parse(readFileSync(path, "utf8")) ?? {}) as { api_keys?: unknown };
  const keys = config.api_keys ?? {};
  if (typeof keys !== "object" || Array.isArray(keys) || Object.values(keys).some((v) => typeof v !== "string"))
    throw new Error(`${path}: api_keys must map source names to strings`);
  return keys as Record<string, string>;
}

export function resolveApiKeys(
  sourceNames: readonly string[],
  layers: { cli?: Record<string, string>; env?: NodeJS.ProcessEnv; config?: Record<string, string> },
): Record<string, string> {
  const { cli = {}, env = {}, config = {} } = layers;
  const keys: Record<string, string> = {};
  for (const name of sourceNames) {
    const key = cli[name] || env[envName(name)] || config[name];
    if (key) keys[name] = key;
  }
  return keys;
}
