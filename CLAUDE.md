# CLAUDE.md

avd-linecheck: a one-button, static, keyless browser network check for virtual desktop users (AVD first, generic packs for anyone), plus a companion log bundle script. Design: `docs/spec.md` (moved from avd-ops PR #29; red-teamed, section 14; open questions, section 15; log bundle, section 17). Public, MIT, in the avd-ops org; conventions follow [avd-landing-zone](https://github.com/avd-ops/avd-landing-zone) and the avd-ops design system.

## Validate before pushing
CI (`.github/workflows/ci.yml`) runs:

```bash
node --test "tests/*.test.mjs"
```

## Rules
- **Foundations only until Nick says.** v0 measurement code, the page, packs and the collector wait for his go on the spec's open questions. Do not list this repo on avd-ops.dev (`repos.json`, `docs/knowledge/repos/`, the switcher) until Nick says.
- **Measure where the user is; claim only what was measured; fail closed** (spec section 3, L1 to L3). A timeout, a block or an unknown is never a pass, and the result always lists what was not tested.
- **Nothing leaves the browser unless the user shares it** (L5, L7): no analytics, no font or script CDN, no error reporting, no third-party request beyond the probe targets in the pack. The CSP `connect-src` is generated from the pack, and a test keeps them equal.
- **The network export holds no personal data; the log bundle does.** The bundle is written to the user's Downloads folder and never uploaded by this tool, and no scrubbing is claimed. Real bundles and real exports never go into the repo, issues, PRs or fixtures.
- **Thresholds and endpoint lists are pinned references, never copied tables** (avd-assess rule). Every threshold carries a claim ID.
- **Pure functions, tested offline.** Verdict, export and pack logic are pure JavaScript tested with `node --test`; the collector's logic lives in a `.psm1` tested with Pester. No build step for the page: plain HTML, CSS and JavaScript, no inline script or style.
- **Prior art first.** The engine starts from avd-landing-zone's portal latency test (`site/portal/portal-page.js`, decisions 0003 and 0014). Adopt an outside tool only if it is the best at the job and open source (avd-ops `docs/build-or-adopt.md`); credit what you take in the README in your own words.
- **No GUIDs, emails, IPs, tenant, customer, user or machine names, and no secrets.** Microsoft's published endpoint names are fine.
- **Liquidware is the only partner named.** Other vendors appear only as prior art. No Nerdio and no HCL (Terraform, Packer) here.
- **Personal project, not for production, as is, not affiliated with the author's employer, Liquidware or Microsoft.** The README warning, the LICENSE and the notice at the top of every entry point stay (a test checks the README).
- **American English** in docs, output and comments. Scripts stay ASCII.
- **Knowledge capture:** this repo has no knowledge base. Record what you learn in avd-second-brain `docs/knowledge/` (avd-ops AGENTS.md: build lessons for an AVD repo go there) and link it from the PR as `KB: <link>`, or say `No KB entry: <reason>`.
