import assert from "node:assert/strict";
import { execFile, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import tls from "node:tls";

const CLI = `${import.meta.dirname}/cli.ts`;
const hasOpenssl = spawnSync("openssl", ["version"]).status === 0;

// Async: the proxy runs in this process, so the CLI must not block the event loop.
function cli(args: string[]) {
  return new Promise<{ stdout: string; stderr: string; code: number }>((resolve) => {
    const env = { ...process.env, XDG_CONFIG_HOME: mkdtempSync(join(tmpdir(), "subdomain-finder-")) };
    execFile(process.execPath, [CLI, ...args], { env }, (error, stdout, stderr) =>
      resolve({ stdout, stderr, code: typeof error?.code === "number" ? error.code : 0 }),
    );
  });
}

function makeCerts() {
  const dir = mkdtempSync(join(tmpdir(), "subdomain-finder-"));
  const openssl = (...args: string[]) => assert.equal(spawnSync("openssl", args, { cwd: dir }).status, 0, `openssl ${args.join(" ")}`);
  const ec = ["-newkey", "ec", "-pkeyopt", "ec_paramgen_curve:P-256", "-nodes"];
  openssl("req", "-x509", ...ec, "-keyout", "ca.key", "-out", "ca.pem", "-days", "1", "-subj", "/CN=test CA");
  openssl("req", ...ec, "-keyout", "leaf.key", "-out", "leaf.csr", "-subj", "/CN=crt.name");
  writeFileSync(join(dir, "san.ext"), "subjectAltName=DNS:crt.name\n");
  openssl(..."x509 -req -in leaf.csr -CA ca.pem -CAkey ca.key -CAcreateserial -days 1 -extfile san.ext -out leaf.pem".split(" "));
  const read = (name: string) => readFileSync(join(dir, name), "utf8");
  return { caPath: join(dir, "ca.pem"), key: read("leaf.key"), cert: read("leaf.pem") };
}

/** Answers every HTTPS request itself, like spilltea would. */
async function interceptingProxy(certs: { key: string; cert: string }, body: string) {
  const seen: string[] = [];
  const app = http.createServer((req, res) => {
    seen.push(`${req.method} ${req.headers.host}${req.url}`);
    res.end(body);
  });
  const proxy = http.createServer();
  proxy.on("connect", (req, socket) => {
    seen.push(`CONNECT ${req.url}`);
    socket.write("HTTP/1.1 200 Connection Established\r\n\r\n");
    app.emit("connection", new tls.TLSSocket(socket, { isServer: true, ...certs }));
  });
  await new Promise<void>((resolve) => proxy.listen(0, "127.0.0.1", resolve));
  return { url: `http://127.0.0.1:${(proxy.address() as AddressInfo).port}`, seen, close: () => proxy.close() };
}

test("--proxy with --proxy-ca goes through an intercepting proxy", { skip: !hasOpenssl && "needs openssl" }, async () => {
  const certs = makeCerts();
  const proxy = await interceptingProxy(certs, "a.example.com\nb.example.com\n");
  try {
    const { stdout, code } = await cli(["-o", "-", "-s", "crtname", "--proxy", proxy.url, "--proxy-ca", certs.caPath, "example.com"]);
    assert.equal(code, 0);
    assert.equal(stdout, "a.example.com\nb.example.com\n");
    assert.deepEqual(proxy.seen, ["CONNECT crt.name:443", "GET crt.name/v1/search?apex=example.com"]);

    const untrusted = await cli(["-o", "-", "-s", "crtname", "--proxy", proxy.url, "example.com"]);
    assert.equal(untrusted.code, 1);
    assert.match(untrusted.stderr, /crtname +failed/);
  } finally {
    proxy.close();
  }
});

test("invalid proxy settings are usage errors", async () => {
  assert.match((await cli(["--proxy", "socks5://127.0.0.1:1080", "-s", "crtname", "example.com"])).stderr, /Invalid proxy URL/);
  const missing = await cli(["--proxy-ca", "/nonexistent.pem", "-s", "crtname", "example.com"]);
  assert.equal(missing.code, 2);
  assert.match(missing.stderr, /--proxy-ca: .*nonexistent\.pem/);
});
