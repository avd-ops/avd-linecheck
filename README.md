# avd-linecheck

Part of [avd-ops](https://avd-ops.dev/), the open toolkit for Azure Virtual Desktop.

A one-button network check for people who work on a virtual desktop. Open a link, press one button, and get a plain-language verdict about the network you are on, plus a result you can hand to your helpdesk. It runs in your browser with no sign-in or keys. When you run it, the listed probe hosts receive ordinary network request metadata; the result itself is never uploaded. Azure Virtual Desktop is the first set of checks; the engine is generic, so anyone with a hosted desktop can add their own.

> [!WARNING]
> **Personal project. Research and learning only. Not for production. No warranty.**
>
> - This is my own personal project, built on my own time **for research and learning**. It is **not affiliated with, endorsed by or supported by my employer**, Liquidware or Microsoft, and it does not represent their views, products or guidance. Microsoft product names are used only to describe what is tested.
> - **Do not rely on it for production decisions.** A browser can only measure part of a connection, and the page says what it could not measure.
> - It is provided **"as is", without warranty of any kind**, under the [MIT License](LICENSE). You use it at your own risk.
> - **Contributions and forks are welcome and encouraged.** See [Contributing](#contributing).

## Status

**The v0 and v1 static page is implemented; real-device validation is still needed before calling it release-ready.** The page, generic and AVD packs, safe result sharing, and text-first guides are in [`site/`](site/). The browser check has not yet been validated across real networks and browsers; the remaining spike work is listed in [spikes/README.md](spikes/README.md). No guided-step screenshots or recordings are included. The design baseline is [docs/spec.md](docs/spec.md). Its optional v2 server probe and listing on avd-ops.dev remain out of scope. Section 17's companion log bundle is specified for [avd-current-state](https://github.com/avd-ops/avd-current-state); [the local collector spec](https://github.com/avd-ops/avd-current-state/blob/main/docs/local-collector-spec.md) and [PR #40](https://github.com/avd-ops/avd-current-state/pull/40) describe the design, not an implementation.

| Version | Delivers |
|---|---|
| v0 | Implemented: generic pack, selectable region ranking, download sufficiency, jitter and stalls, verdict, share-safe export and paste view |
| v1 | Implemented: pinned AVD endpoint pack, cited RTT bands, target-region check and text-first guided steps |
| Log bundle | Designed for avd-current-state; implementation and signed release are still pending there |
| v2 | An optional server probe, in separately costed pieces |

## Layout

```text
docs/spec.md                  the design baseline (moved here from avd-ops)
site/                         static page, packs, pinned design assets and text-first steps
  index.html                  one-button browser check and result sharing
  packs/                      schema, generic and AVD packs, pinned endpoint and region data
  steps/                      text-first guides; media waits for approved captures
  assets/                     design system v2.2.0 with manifest and lock
spikes/                       prior spike pages and test artifacts; not published
tests/                        node --test: foundations, packs/CSP, results, runner and site
scripts/make-blob.mjs         generate a hash-named 8 MiB download file
scripts/update-csp.mjs        regenerate the page allowlist after changing packs
.github/workflows/            ci.yml, pages.yml, served.yml
```

The page is static and has no build step or runtime dependency. Its tests keep the CSP aligned with the shipped packs. The Pages workflow publishes `site/`.

Regional ranking follows the deployment portal: all four geography groups are selected by default, each can be turned off, and the results rank every selected region. Each region gets a warm-up and five timed samples, with three regions checked concurrently. The table shows the top five by default, can expand to all results, and a selected row sets the target-region check. This implementation supersedes the earlier 12-region cap in [docs/spec.md](docs/spec.md#42-region-latency).

In a fork, add DNS hostnames on HTTPS port 443 to `site/packs/generic.json`, run `node scripts/update-csp.mjs`, then run the tests. Hosts outside the shipped Microsoft suffix list are marked as custom in shared results.

## Prior art and credits

Each one is linked and described in our own words; licenses are what the project's own license file says, read before anything is reused ([spec section 11](docs/spec.md#11-prior-art-and-what-to-reuse)).

- **[avd-landing-zone](https://github.com/avd-ops/avd-landing-zone)** (MIT, same family): its deployment portal's browser latency test (warm-up request, timed `no-cors` fetches, median) and reachability probe, with their honest-limits wording, are the starting point for this engine (`site/portal/portal-page.js` and decisions 0003 and 0014 at commit `68ffda5`).
- **[@cloudflare/speedtest](https://github.com/cloudflare/speedtest)**: the loaded-latency method.
- **[LibreSpeed](https://github.com/librespeed/speedtest)**: the separate stability test idea, and its smoothed jitter as the comparison for our median-based one (ideas only; no code).
- **Microsoft Learn**: the required endpoints, round-trip guidance, RDP Shortpath, Windows App and Teams log locations this tool cites, each at a pinned version through [avd-assess](https://github.com/avd-ops/avd-assess).

## Contributing

Contributions and forks are welcome and encouraged. Open an issue for a bug, a question or an idea, or a pull request with a fix, a test or a doc. Read [CONTRIBUTING.md](CONTRIBUTING.md) first. Never attach a log bundle, a result from a custom pack, or anything with user, device, tenant or network names to an issue or a pull request: those go to your own helpdesk only. By contributing, you agree your contributions are licensed under the repo's [MIT License](LICENSE).

## License and disclaimer

[MIT](LICENSE). The software is provided "as is", without warranty of any kind, and the authors are not liable for any claim, damages or other liability arising from its use.
