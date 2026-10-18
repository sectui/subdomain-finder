import { getJson, type Source } from "../source.ts";

type Page = { data: { id: string }[]; links?: { next?: string } };

export const virustotal: Source = {
  name: "virustotal",
  description: "VirusTotal domain relationships (API key required)",
  apiKey: "required",
  async run(domain, ctx) {
    const headers = { "x-apikey": ctx.apiKey! };
    const names: string[] = [];
    let url: string | undefined = `https://www.virustotal.com/api/v3/domains/${encodeURIComponent(domain)}/subdomains?limit=40`;
    while (url) {
      const page = (await getJson(url, ctx, headers)) as Page;
      names.push(...page.data.map((d) => d.id));
      url = page.links?.next;
    }
    return names;
  },
};
