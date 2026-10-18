import { getJson, type Source } from "../source.ts";

type Subdomains = { subdomains: string[] };

export const securitytrails: Source = {
  name: "securitytrails",
  description: "SecurityTrails DNS history (API key required)",
  apiKey: "required",
  async run(domain, ctx) {
    const data = (await getJson(`https://api.securitytrails.com/v1/domain/${encodeURIComponent(domain)}/subdomains`, ctx, {
      apikey: ctx.apiKey!,
    })) as Subdomains;
    return data.subdomains.map((label) => `${label}.${domain}`);
  },
};
