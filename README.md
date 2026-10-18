# @sectui/subdomain-finder

Passive subdomain enumeration from public sources, written in TypeScript for Node.js. Part of the **sectui** family of security tools for the terminal.

It never queries the target itself: no DNS resolution, no bruteforce, no HTTP probing. Pipe the output into dedicated tools for that.

## Install

With npm (Node.js 26 or later):

```sh
npx @sectui/subdomain-finder example.com          # run without installing
npm install -g @sectui/subdomain-finder           # then: subdomain-finder example.com
```

With Nix, from the [sectui NUR](https://github.com/sectui/nur):

```sh
nix run github:sectui/nur#subdomain-finder -- example.com
```

```nix
# flake: inputs.nur-sectui.url = "github:sectui/nur";
environment.systemPackages = [ nur-sectui.packages.${system}.subdomain-finder ];

# or through NUR
environment.systemPackages = [ pkgs.nur.repos.sectui.subdomain-finder ];
```

Each [GitHub release](https://github.com/sectui/subdomain-finder/releases) also has the CLI as a single file, `node subdomain-finder-<version>.mjs`.

## CLI

```sh
subdomain-finder example.com                  # writes subdomains-example.com.txt
subdomain-finder example.com                  # same command again: only the sources that did not succeed are queried
subdomain-finder --info example.com           # summary of the previous run, no query
subdomain-finder -o - example.com | httpx     # hostnames on stdout as they are found, no state
subdomain-finder -o subs.txt -s crtsh,certspotter example.com
subdomain-finder --list-sources
```

Progress and errors go to stderr. The exit code is 1 when no queried source succeeded, 2 on usage errors.

### Output and resuming

By default the output is `subdomains-<domain>.txt` in the current directory (`-o` to change it). Two files are written after every source:

- `subdomains-example.com.txt`: one hostname per line, sorted, nothing else, so any tool can read it.
- `subdomains-example.com.txt.state.json`: the domain and the status of each source only (`ok` with a count, `failed` with the error, `skipped` with the reason). No hostnames, no API keys.

Running the same command again skips the sources that already succeeded and merges the new hostnames into the existing output. `--fresh` ignores the previous run. An existing output without its state file is never overwritten.

`--info` reads the state only:

```
subdomains-example.com.txt (example.com)
succeeded    3  crtname, certspotter, hackertarget
failed       2  crtsh, otx
not run      2  virustotal (missing API key), securitytrails (missing API key)
results     31
```

### API keys

Each source gets its key from the first place that has one:

1. `--api-key <source>=<key>` (`-k`, repeatable). It shows in your shell history and `ps`.
2. `$SUBDOMAIN_FINDER_<SOURCE>_KEY`, e.g. `SUBDOMAIN_FINDER_VIRUSTOTAL_KEY`
3. `~/.config/sectui/subdomain-finder.yaml` (`$XDG_CONFIG_HOME` is honored):

   ```yaml
   api_keys:
     virustotal: ...
     securitytrails: ...
     certspotter: ...
     otx: ...
     hackertarget: ...
   ```

The config file must not be accessible by other users, or the run stops (as ssh does with private keys): `chmod 600 ~/.config/sectui/subdomain-finder.yaml`. Keys are masked as `***` in error messages and never written to the state file.

A source that requires a key is skipped without one, and retried by the next run.

### Proxy

`--proxy <url>` sends every request through an HTTP proxy. For an intercepting proxy, `--proxy-ca <pem>` trusts its CA on top of the system ones. With [spilltea](https://github.com/sectui/spilltea):

```sh
subdomain-finder --proxy http://127.0.0.1:8080 --proxy-ca ~/.local/share/spilltea/ca/ca.pem example.com
```

## Library

```ts
import { find } from "@sectui/subdomain-finder";

for await (const result of find("example.com", {
  apiKeys: { virustotal: "..." },
  timeout: 30_000,
})) {
  if (result.status === "ok") console.log(result.source, result.names);
  else console.error(result.source, result.status === "failed" ? result.error : result.reason);
}
```

`find` queries the sources in parallel and yields one result per source as it finishes. A source is `{ name, description, run(domain, ctx) }`: pass your own in `sources` to add one.

## Sources

| Name             | Data                                           | API key  |
| ---------------- | ---------------------------------------------- | -------- |
| `crtsh`          | Certificate Transparency logs via crt.sh       |          |
| `crtname`        | Certificate Transparency logs via crt.name     |          |
| `certspotter`    | Certificate Transparency logs via Cert Spotter | optional |
| `hackertarget`   | HackerTarget host search (50 free queries/day) | optional |
| `otx`            | AlienVault OTX passive DNS                     | optional |
| `virustotal`     | VirusTotal domain relationships                | required |
| `securitytrails` | SecurityTrails DNS history                     | required |
