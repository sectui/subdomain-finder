import { getJson, type Source } from "../source.ts";

type PassiveDns = { passive_dns?: { hostname: string }[] };

export const otx: Source = {
  name: "otx",
  description: "AlienVault OTX passive DNS (anonymous access is heavily rate limited)",
  apiKey: "optional",
  async run(domain, ctx) {
    const headers = ctx.apiKey ? { "x-otx-api-key": ctx.apiKey } : undefined;
    const data = (await getJson(
      `https://otx.alienvault.com/api/v1/indicators/domain/${encodeURIComponent(domain)}/passive_dns`,
      ctx,
      headers,
    )) as PassiveDns;
    return (data.passive_dns ?? []).map((r) => r.hostname);
  },
};
