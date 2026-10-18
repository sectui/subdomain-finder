import { readFileSync } from "node:fs";
import { build } from "esbuild";

const { version, description } = JSON.parse(readFileSync("package.json", "utf8")) as { version: string; description: string };

await build({
  entryPoints: ["src/cli.ts"],
  outfile: "dist/subdomain-finder.mjs",
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node26",
  conditions: ["source"],
  define: { BUNDLED_PACKAGE: JSON.stringify({ version, description }) },
  banner: {
    js: "import { createRequire as __bannerCreateRequire } from 'node:module'; const require = __bannerCreateRequire(import.meta.url);",
  },
});
