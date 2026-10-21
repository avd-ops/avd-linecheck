# avd-linecheck

Part of [avd-ops](https://avd-ops.dev/), the open toolkit for Azure Virtual Desktop.

A one-button network check for people who work on a virtual desktop. Open a link, press one button, and get a plain-language verdict about the network you are on, plus a result you can hand to your helpdesk. It runs entirely in your browser: no sign-in, no keys, and nothing leaves the page unless you copy or download the result. Azure Virtual Desktop is the first set of checks; the engine is generic, so anyone with a hosted desktop can add their own.

> [!WARNING]
> **Personal project. Research and learning only. Not for production. No warranty.**
>
> - This is my own personal project, built on my own time **for research and learning**. It is **not affiliated with, endorsed by or supported by my employer**, Liquidware or Microsoft, and it does not represent their views, products or guidance. Microsoft product names are used only to describe what is tested.
> - **Do not rely on it for production decisions.** A browser can only measure part of a connection, and the page says what it could not measure.
> - It is provided **"as is", without warranty of any kind**, under the [MIT License](LICENSE). You use it at your own risk.
> - **Contributions and forks are welcome and encouraged.** See [Contributing](#contributing).

## Status

**Design only. Nothing is built yet.** The design is [docs/spec.md](docs/spec.md): what a browser can and cannot measure, the AVD checks and their cited thresholds, privacy, hosting, prior art, and the open questions in section 15. Section 17 designs a companion log bundle (Windows App, Teams and performance logs, zipped to your Downloads folder, never uploaded), which is built in [avd-current-state](https://github.com/avd-ops/avd-current-state) as part of its local collector.

| Version | Delivers |
|---|---|
| v0 | The static page with a generic pack: reachability, region ranking, download sufficiency, jitter and stalls, a verdict, an export with no personal data, and a view that reads a pasted result |
| v1 | The AVD pack: Microsoft's published end-user endpoints and round-trip bands, cited at a pinned commit |
| Log bundle | Built in avd-current-state: a script that collects AVD, Teams and performance logs from your device or your remote session into one zip in Downloads |
| v2 | An optional server probe, in separately costed pieces |

## Layout

```text
docs/spec.md                  the design (moved here from avd-ops)
spikes/                       throwaway pages for the spikes in spec section 13, published to GitHub Pages
tests/                        node --test: repo foundations (notice, license, links, leak patterns), spike page rules
.github/workflows/ci.yml      runs the tests on every pull request
```

The full layout the spec plans (the page in `site/`, packs, the collector) is in [docs/spec.md, section 12.4](docs/spec.md#124-repository-layout).

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
