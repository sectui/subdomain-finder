import assert from "node:assert/strict";
import { chmodSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { envName, readConfigKeys, resolveApiKeys } from "./keys.ts";

test("command line beats environment, which beats the config file", () => {
  const keys = resolveApiKeys(["a", "b", "c", "d"], {
    cli: { a: "cli" },
    env: { [envName("a")]: "env", [envName("b")]: "env" },
    config: { a: "config", b: "config", c: "config" },
  });
  assert.deepEqual(keys, { a: "cli", b: "env", c: "config" });
});

test("environment variable names", () => {
  assert.equal(envName("virustotal"), "SUBDOMAIN_FINDER_VIRUSTOTAL_KEY");
});

test("config file api_keys", () => {
  const dir = mkdtempSync(join(tmpdir(), "subdomain-finder-"));
  assert.deepEqual(readConfigKeys(join(dir, "missing.yaml")), {});
  writeFileSync(join(dir, "ok.yaml"), "api_keys:\n  virustotal: abc\n", { mode: 0o600 });
  assert.deepEqual(readConfigKeys(join(dir, "ok.yaml")), { virustotal: "abc" });
  writeFileSync(join(dir, "bad.yaml"), "api_keys:\n  - abc\n", { mode: 0o600 });
  assert.throws(() => readConfigKeys(join(dir, "bad.yaml")), /api_keys must map/);
});

test("a config file other users can access is refused", { skip: process.platform === "win32" }, () => {
  const dir = mkdtempSync(join(tmpdir(), "subdomain-finder-"));
  for (const mode of [0o644, 0o640, 0o604, 0o660]) {
    const path = join(dir, `${mode.toString(8)}.yaml`);
    writeFileSync(path, "api_keys:\n  virustotal: abc\n");
    chmodSync(path, mode);
    assert.throws(() => readConfigKeys(path), new RegExp(`accessible by other users \\(mode ${mode.toString(8)}\\): run chmod 600`));
  }
});
