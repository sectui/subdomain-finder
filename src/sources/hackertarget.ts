import { getText, SourceError, type Source } from "../source.ts";

export const hackertarget: Source = {
  name: "hackertarget",
  description: "HackerTarget host search (50 free queries per day)",
  apiKey: "optional",
  async run(domain, ctx) {
    const headers = ctx.apiKey ? { "x-api-key": ctx.apiKey } : undefined;
    const text = await getText(`https://api.hackertarget.com/hostsearch/?q=${encodeURIComponent(domain)}`, ctx, headers);
    if (!text.includes(",")) throw new SourceError(text.trim() || "empty response");
    return text.split("\n").map((line) => line.split(",")[0] ?? "");
  },
};
