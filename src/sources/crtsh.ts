import { getJson, type Source } from "../source.ts";

type Entry = { name_value: string };

export const crtsh: Source = {
  name: "crtsh",
  description: "Certificate Transparency logs via crt.sh",
  async run(domain, ctx) {
    const entries = (await getJson(`https://crt.sh/?q=${encodeURIComponent(`%.${domain}`)}&output=json`, ctx)) as Entry[];
    return entries.flatMap((e) => e.name_value.split("\n"));
  },
};
