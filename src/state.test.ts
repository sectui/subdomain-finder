import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { applyResult, emptyState, loadNames, loadState, mergeNames, save, statePath, succeeded } from "./state.ts";

test("the state records how each source fared, never the hostnames", () => {
  const state = emptyState("example.com");
  applyResult(state, { source: "a", status: "ok", names: ["a.example.com", "b.example.com"] });
  applyResult(state, { source: "b", status: "failed", error: "HTTP 502" });
  applyResult(state, { source: "c", status: "skipped", reason: "missing API key" });
  assert.deepEqual(Object.keys(state), ["domain", "sources"]);
  assert.deepEqual(state.sources.a, { status: "ok", count: 2, date: state.sources.a!.date });
  assert.equal(succeeded(state, "a"), true);
  assert.equal(succeeded(state, "b"), false);
  assert.equal(succeeded(state, "c"), false);
  assert.equal(succeeded(state, "never-run"), false);
});

test("mergeNames returns only the hostnames it did not have", () => {
  const names = new Set(["a.example.com"]);
  assert.deepEqual(mergeNames(names, ["a.example.com", "b.example.com", "b.example.com"]), ["b.example.com"]);
  assert.deepEqual([...names], ["a.example.com", "b.example.com"]);
});

test("hostnames go to the output, the state next to it, and both round-trip", () => {
  const output = join(mkdtempSync(join(tmpdir(), "subdomain-finder-")), "subs.txt");
  assert.equal(loadState(output), undefined);
  assert.equal(loadNames(output).size, 0);
  const state = emptyState("example.com");
  applyResult(state, { source: "a", status: "ok", names: ["b.example.com", "a.example.com"] });
  save(output, state, new Set(["b.example.com", "a.example.com"]));
  assert.equal(readFileSync(output, "utf8"), "a.example.com\nb.example.com\n");
  assert.doesNotMatch(readFileSync(statePath(output), "utf8"), /[ab]\.example\.com/);
  assert.deepEqual(loadState(output), state);
  assert.deepEqual([...loadNames(output)], ["a.example.com", "b.example.com"]);
});
