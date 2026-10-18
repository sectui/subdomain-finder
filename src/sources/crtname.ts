import { getText, type Source } from "../source.ts";

export const crtname: Source = {
  name: "crtname",
  description: "Certificate Transparency logs via crt.name",
  async run(domain, ctx) {
    const text = await getText(`https://crt.name/v1/search?apex=${encodeURIComponent(domain)}`, ctx);
    return text.split("\n");
  },
};
