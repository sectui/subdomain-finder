import { getJson, type Source } from "../source.ts";

type Issuance = { id: string; dns_names: string[] };

export const certspotter: Source = {
  name: "certspotter",
  description: "Certificate Transparency logs via the Cert Spotter API (rate limited without a key)",
  apiKey: "optional",
  async run(domain, ctx) {
    const headers = ctx.apiKey ? { authorization: `Bearer ${ctx.apiKey}` } : undefined;
    const names: string[] = [];
    for (let after = ""; ; ) {
      const url = `https://api.certspotter.com/v1/issuances?domain=${encodeURIComponent(domain)}&include_subdomains=true&expand=dns_names${after && `&after=${after}`}`;
      const page = (await getJson(url, ctx, headers)) as Issuance[];
      if (!page.length) return names;
      names.push(...page.flatMap((i) => i.dns_names));
      after = page.at(-1)!.id;
    }
  },
};
