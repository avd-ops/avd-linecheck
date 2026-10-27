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

**The v0 and v1 static portal is implemented on the shared `avd-ops` design system (`ds-v2.7.0`) and portal engine (`pe-v1.1.0`).** The four-step wizard (`Run check`, `Verdict`, `Add context`, `Share or read`), generic, AVD Commercial (`avd`), Azure US Government (`avd-gov`), Windows 365 (`w365`), Microsoft Teams VDI (`teams`), and Microsoft 365 Core (`m365`) packs, multi-workload toggles, phased probe execution with deadlines, cold connection setup timing (`setupMs`) and same-origin DNS hints, web client capability checks (`WebCodecs` H.264/AV1, Clipboard API, Multi-screen API), vantage and proxy/tunnel caveats, helpdesk link builder, before/after run comparison, user context (sentiment, symptoms, in-browser window capture, private `comments.txt`), assessment intake export (`avd-assess-user-network/v1`), and text-first guided steps are in [`site/`](site/). Spikes S1 through S4 are recorded in [spikes/README.md](spikes/README.md). No guided-step screenshots or recordings are included yet. The design baseline is [docs/spec.md](docs/spec.md). Its optional v2 server probe and listing on avd-ops.dev remain out of scope. Section 17's companion log bundle is specified for [avd-current-state](https://github.com/avd-ops/avd-current-state); [the local collector spec](https://github.com/avd-ops/avd-current-state/blob/main/docs/local-collector-spec.md) and [PR #40](https://github.com/avd-ops/avd-current-state/pull/40) describe the design, not an implementation.

| Version | Delivers |
|---|---|
| v0 | Implemented: generic pack, selectable region ranking, download sufficiency (capped at 67 Mbit/s) with loaded latency, serial jitter and stalls, verdict, share-safe export and paste view |
| v1 | Implemented: pinned AVD Commercial & Azure US Government packs (`?cloud=commercial\|gov`), Windows 365, Teams VDI, and Microsoft 365 workload packs (`?workloads=`), cited RTT bands, target-region check, cold setup timing (`setupMs`) & same-origin DNS hint, web client readiness check, vantage check, proxy/tunnel caveats, relay geography & Government Shortpath notes, helpdesk link builder, before/after comparison, user context, assessment intake export, and text-first guided steps |
| Log bundle | Designed for avd-current-state; implementation and signed release are still pending there |
| v2 | An optional server probe, in separately costed pieces |

## Layout

```text
docs/spec.md                  the design baseline (moved here from avd-ops)
site/                         static portal, packs, pinned design/engine assets and text-first steps
  index.html                  four-step wizard: check, verdict, context, and share/read
  engine.js                   pack validation, download sufficiency and phased probes on AvdOpsEngine.probe
  verdict.js                  pure classification, RTT bands, vantage, caveats and plain-language wording
  export.js                   pure export builder, scrubber, intake helper and shared-result parser
  app.js                      page wiring, wizard stepper, sheets, capture and comments
  packs/                      schema, generic and AVD packs, pinned endpoint and region data
  steps/                      text-first guides (`index.html`, `steps.json`, `steps.js`); media waits for approved captures
  assets/                     design system v2.7.0 (`design-system.lock.json`) and portal engine v1.1.0 (`engine.lock.json`)
spikes/                       spike pages and recorded readings; not published
tests/                        node --test: network, packs/CSP, results/verdict/export and site contracts
scripts/make-blob.mjs         generate a hash-named 8 MiB download file
scripts/update-csp.mjs        regenerate the page allowlist after changing packs
.github/workflows/            ci.yml, pages.yml, served.yml
```

The page is static and has no build step or runtime dependency. Its tests keep the CSP aligned with the shipped packs and verify the vendored design-system and portal-engine lock hashes. The Pages workflow publishes `site/`.

Regional ranking follows the deployment portal: all four geography groups are selected by default, each can be turned off, and the results rank every selected region. Each region gets a warm-up and five timed samples, with three regions checked concurrently. The table shows the top five by default, can expand to all results, and a selected row sets the target-region check. This implementation supersedes the earlier 12-region cap in [docs/spec.md](docs/spec.md#42-region-latency).

In a fork, add DNS hostnames on HTTPS port 443 to `site/packs/generic.json`, run `node scripts/update-csp.mjs`, then run the tests. Hosts outside the shipped Microsoft suffix list are marked as custom in shared results.

## Prior art and credits

Each one is linked and described in our own words; licenses are what the project's own license file says, read before anything is reused ([spec section 11](docs/spec.md#11-prior-art-and-what-to-reuse)).

- **[avd-ops portal engine](https://github.com/avd-ops/avd-ops)** and **[avd-landing-zone](https://github.com/avd-ops/avd-landing-zone)** (MIT, same family): the shared portal engine (`core.js`, `bands.js`, `probe.js`, `redact.js` at `pe-v1.1.0`) and the deployment portal's browser latency test (warm-up request, timed `no-cors` fetches, median) and reachability probe, with their honest-limits wording (decisions 0003 and 0014).
- **[@cloudflare/speedtest](https://github.com/cloudflare/speedtest)**: the loaded-latency method.
- **[LibreSpeed](https://github.com/librespeed/speedtest)**: the separate stability test idea, and its smoothed jitter as the comparison for our median-based one (ideas only; no code).
- **Microsoft Learn**: the required endpoints, round-trip guidance, RDP Shortpath, Windows App and Teams log locations this tool cites, each at a pinned version through [avd-assess](https://github.com/avd-ops/avd-assess).

## Contributing

Contributions and forks are welcome and encouraged. Open an issue for a bug, a question or an idea, or a pull request with a fix, a test or a doc. Read [CONTRIBUTING.md](CONTRIBUTING.md) first. Never attach a log bundle, a result from a custom pack, or anything with user, device, tenant or network names to an issue or a pull request: those go to your own helpdesk only. By contributing, you agree your contributions are licensed under the repo's [MIT License](LICENSE).

## License and disclaimer

[MIT](LICENSE). The software is provided "as is", without warranty of any kind, and the authors are not liable for any claim, damages or other liability arising from its use.
