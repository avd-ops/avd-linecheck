# Spikes

Throwaway checks that settle questions before v0 ([spec section 13](../docs/spec.md#13-spikes-before-v0-offline-or-free-no-cloud-run)). Nick gave the go on 2026-10-21 (Q10). They are free: no tenant, no spend. The pages here publish to GitHub Pages through `.github/workflows/pages.yml`; the real page replaces them at v0. S5a now runs as avd-current-state's local collector spike S2 (Q11).

| Spike | Status | Where |
|---|---|---|
| S1, library audit | Done in a headless browser, 2026-10-21 | Below |
| S1, browser sample against ping | Page ready; needs three real networks | [s1/](s1/index.html) |
| S2, old AVD hostnames | First reading done, 2026-10-21; a reading from a home network is still wanted | Below |
| S3, browser capabilities | Page ready; Chromium read here; Safari, Firefox and phones wanted | [s3/](s3/index.html) |
| S4, 8 MiB file from GitHub Pages | Page ready; works locally; needs Pages turned on, then cold and warm runs on real networks | [s4/](s4/index.html) |

## S1: can `@cloudflare/speedtest` run with no contact with Cloudflare?

Read at version 1.14.1 (npm, published 2026-09-22; tarball SHA-256 `ab257b619ad074b4c94ba9cc59fe9bf44fe2329c5edef01974935a95c6ff4a05`). Its license file is MIT, Copyright (c) 2023 Cloudflare, and it has no dependencies.

- **The defaults call home.** `downloadApiUrl` and `uploadApiUrl` default to `speed.cloudflare.com/__down` and `/__up`, `logAimApiUrl` (results logging) defaults to `speed.cloudflare.com/__results`, TURN credentials come from `speed.cloudflare.com/turn-creds` and packet loss uses `turn.speed.cloudflare.com:50000`, and an `rpki` measurement probes `invalid.rpki.cloudflare.com`. Started with its defaults in headless Chromium, its first request went to `speed.cloudflare.com/__down` (blocked by the test harness, so nothing was sent).
- **With every default overridden, it stays home.** Download and upload pointed at our own origin, `logAimApiUrl` and `logMeasurementApiUrl` set to `null`, and a measurement list of latency, download and upload only (no `packetLoss`, no `rpki`): 20 requests, all to our own origin, none anywhere else.
- **What it needs from the server:** `GET <download>?bytes=N` returning N bytes and `POST <upload>?bytes=N`, plus `Timing-Allow-Origin` when the server is on another origin, for its resource-timing math. GitHub Pages can serve neither (no query-driven sizes, no POST), so on Pages the library's download test would need fixed-size files and its upload test cannot run at all.
- **Loaded latency and upload read 0** against a local server that answers in under a millisecond. That says nothing either way; it needs a real network.

So for Q7: adopting it is possible only behind a config that overrides every Cloudflare default, and a test would have to keep it that way, because a library update that adds a default host would silently break the "nothing leaves the page" promise. On GitHub Pages (Q3) it brings no upload test and needs a size-per-file download. Writing our own two functions (download sufficiency from fixed files, loaded latency) is smaller than that guard. **Recommendation: build, and keep the library as prior art in the README.** Nick's Q7 answer ("adopt only with zero contact") still decides; this is the evidence.

## S2: do the old `*.wvd.microsoft.com` names still answer?

From a cloud container outside Azure, through an HTTPS proxy, 2026-10-21. Every answer came from the AVD service itself (`Server: Microsoft-IIS/10.0` with an `x-ms-wvd-service-region` header).

| Name | HEAD | GET | Service region header |
|---|---|---|---|
| `rdweb.wvd.microsoft.com` | 405 | 200 | NCUS |
| `rdbroker.wvd.microsoft.com` | 404 | 404 | CUS |
| `rdgateway.wvd.microsoft.com` | 401 | 200 | NCUS |
| `client.wvd.microsoft.com` | not tried | 200 | not recorded |

All three still answer, so a browser `no-cors` probe would count them as reachable. Learn's end-user list no longer names them, and Q5 was answered "leave them out", so they stay out of the AVD pack; this reading is the evidence if Learn ever lists them again. The region header shows the names are served by the nearest AVD region, which could later help a "which region answered" line, but only if Learn documents it. Wanted: one reading from a home network with `curl -sI https://rdweb.wvd.microsoft.com/` (any laptop; not Cloud Shell, which runs in Azure).

## S3 so far (headless Chromium 141 on Linux)

- `performance.now()` step: 0.1 ms, not cross-origin isolated (matches the spec's 100 microseconds for Chrome).
- `transferSize` is available in resource timing, so the cache-hit check in 4.4 works in Chromium.
- WebRTC with no STUN or TURN server connects locally, and `getStats()` fills `currentRoundTripTime` on the candidate pair. Host candidates are reported, and the page records only whether an address is an mDNS name, never the address.
- `getDisplayMedia` and `MediaRecorder` are both present; WebM (VP8, VP9) is supported for recording.

Wanted: the same page on Safari (Mac and iPad), Firefox, and Chrome on Android.

## Code review (2026-10-21)

The code-review skill found ten points on the first version, all fixed: every request has a timeout that becomes a row; S4 rejects anything that is not the 8 MiB file and reads its timing entry for the right run, measuring throughput from first byte to last; the build job can read Pages; the copy button reports a failure; an iPad is told apart from a Mac; the transferSize check reads resource timing; shared code lives in `common.js`; the test checks the CSP starts from `default-src 'none'` and catches any inline handler. S1's two roots answer HEAD with 200 and no redirect (2026-10-21); a redirect to another host would be blocked by the CSP and reported as "blocked or unreachable", never timed.

## How to run the device checks

Once GitHub Pages is on (Settings, Pages, Source: GitHub Actions), the pages are at https://linecheck.avd-ops.dev/ under `s1/`, `s3/` and `s4/` (a fork gets its own `github.io` address). Each has one button and a "Copy the result" button. Paste the result into the thread. The results hold the browser name and timings only, no address.
