import { readFileSync } from "node:fs";
import http from "node:http";
import tls from "node:tls";

/** Process-wide, fetch included. To proxy `find` only, pass it your own `fetch`. */
export function useProxy(url: string) {
  const parsed = URL.parse(url);
  if (!parsed || !["http:", "https:"].includes(parsed.protocol)) throw new TypeError(`Invalid proxy URL: ${url}`);
  http.setGlobalProxyFromEnv({ HTTP_PROXY: parsed.href, HTTPS_PROXY: parsed.href });
}

export function trustCA(pemPath: string) {
  const pem = readFileSync(pemPath, "utf8");
  if (!pem.includes("-----BEGIN CERTIFICATE-----")) throw new TypeError(`${pemPath}: not a PEM certificate`);
  tls.setDefaultCACertificates([...tls.getCACertificates("default"), pem]);
}
