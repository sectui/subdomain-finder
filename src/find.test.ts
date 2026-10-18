import assert from "node:assert/strict";
import { test } from "node:test";
import { find, type SourceResult } from "./find.ts";
import type { Source } from "./source.ts";

const fake = (name: string, run: Source["run"]): Source => ({ name, description: name, run });

async function collect(domain: string, sources: Source[]) {
  const results: SourceResult[] = [];
  for await (const r of find(domain, { sources })) results.push(r);
  return results;
}

test("names are normalized, deduplicated and kept under the domain", async () => {
  const [result] = await collect("Example.com", [
    fake("a", async () => [
      "*.WWW.example.com.",
      "www.example.com",
      "example.com",
      "evil-example.com",
      "a.example.org",
      "bad name.example.com",
    ]),
  ]);
  assert.deepEqual(result, { source: "a", status: "ok", names: ["example.com", "www.example.com"] });
});

test("a failing source does not stop the others", async () => {
  const results = await collect("example.com", [
    fake("broken", async () => {
      throw new Error("HTTP 502");
    }),
    fake("good", async () => ["api.example.com"]),
  ]);
  assert.deepEqual(
    results.sort((a, b) => a.source.localeCompare(b.source)),
    [
      { source: "broken", status: "failed", error: "HTTP 502" },
      { source: "good", status: "ok", names: ["api.example.com"] },
    ],
  );
});

test("results come in completion order", async () => {
  const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
  const results = await collect("example.com", [fake("slow", async () => (await wait(30), [])), fake("fast", async () => [])]);
  assert.deepEqual(
    results.map((r) => r.source),
    ["fast", "slow"],
  );
});

test("the timeout aborts a source", async () => {
  const hang: Source = fake(
    "hang",
    (_, ctx) => new Promise((_, reject) => ctx.signal.addEventListener("abort", () => reject(ctx.signal.reason))),
  );
  const results: SourceResult[] = [];
  for await (const r of find("example.com", { sources: [hang], timeout: 10 })) results.push(r);
  assert.equal(results[0]?.status, "failed");
});

test("invalid domains are rejected", async () => {
  await assert.rejects(collect("not a domain", []), TypeError);
  await assert.rejects(collect("localhost", []), TypeError);
});

test("API keys are masked in error messages", async () => {
  const leaky: Source = {
    ...fake("leaky", async (_, ctx) => {
      throw new Error(`GET https://api.example/?key=${ctx.apiKey} failed`, { cause: new Error(`bad key ${ctx.apiKey}`) });
    }),
    apiKey: "required",
  };
  const results: SourceResult[] = [];
  for await (const r of find("example.com", { sources: [leaky], apiKeys: { leaky: "s3cr3t" } })) results.push(r);
  assert.deepEqual(results, [{ source: "leaky", status: "failed", error: "GET https://api.example/?key=*** failed: bad key ***" }]);
});

test("a source that requires a key is skipped without one, and gets it otherwise", async () => {
  const keyed: Source = { ...fake("keyed", async (_, ctx) => [`${ctx.apiKey}.example.com`]), apiKey: "required" };
  assert.deepEqual(await collect("example.com", [keyed]), [{ source: "keyed", status: "skipped", reason: "missing API key" }]);
  const results: SourceResult[] = [];
  for await (const r of find("example.com", { sources: [keyed], apiKeys: { keyed: "secret" } })) results.push(r);
  assert.deepEqual(results, [{ source: "keyed", status: "ok", names: ["secret.example.com"] }]);
});
