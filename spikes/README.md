# Spikes

Throwaway checks for questions before v0 ([spec section 13](../docs/spec.md#13-spikes-before-v0-offline-or-free-no-cloud-run)). Nick gave the go on 2026-10-21 (Q10). They are free: no tenant, no spend. These pages are retained as artifacts; `.github/workflows/pages.yml` now publishes the app from `site/`. S5a is specified as avd-current-state's local collector spike S2 (Q11); implementation and a real run are still pending there.

| Spike | Status | Where |
|---|---|---|
| S1, library audit | Done in a headless browser, 2026-10-21 | Below |
| S1, browser sample against ping | First real-network reading done on Windows 11 home Wi-Fi (Edge 157), 2026-10-26; cellular and VPN readings remain optional | [s1/](s1/index.html) |
| S2, old AVD hostnames | Done from container (2026-10-21) and from home Wi-Fi on Windows 11 (2026-10-26) | Below |
| S3, browser capabilities | Done on Chromium 141 Linux (2026-10-21) and Microsoft Edge 157 Windows 11 (2026-10-26); Safari, Firefox and phones remain optional | [s3/](s3/index.html) |
| S4, 8 MiB file from GitHub Pages | Cold and warm CDN edge readings done on Windows 11 home Wi-Fi (Edge 157), 2026-10-26 | [s4/](s4/index.html) |

## S1: can `@cloudflare/speedtest` run with no contact with Cloudflare?

Read at version 1.14.1 (npm, published 2026-09-22; tarball SHA-256 `ab257b619ad074b4c94ba9cc59fe9bf44fe2329c5edef01974935a95c6ff4a05`). Its license file is MIT, Copyright (c) 2023 Cloudflare, and it has no dependencies.

- **The defaults call home.** `downloadApiUrl` and `uploadApiUrl` default to `speed.cloudflare.com/__down` and `/__up`, `logAimApiUrl` (results logging) defaults to `speed.cloudflare.com/__results`, TURN credentials come from `speed.cloudflare.com/turn-creds` and packet loss uses `turn.speed.cloudflare.com:50000`, and an `rpki` measurement probes `invalid.rpki.cloudflare.com`. Started with its defaults in headless Chromium, its first request went to `speed.cloudflare.com/__down` (blocked by the test harness, so nothing was sent).
- **With every default overridden, it stays home.** Download and upload pointed at our own origin, `logAimApiUrl` and `logMeasurementApiUrl` set to `null`, and a measurement list of latency, download and upload only (no `packetLoss`, no `rpki`): 20 requests, all to our own origin, none anywhere else.
- **What it needs from the server:** `GET <download>?bytes=N` returning N bytes and `POST <upload>?bytes=N`, plus `Timing-Allow-Origin` when the server is on another origin, for its resource-timing math. GitHub Pages can serve neither (no query-driven sizes, no POST), so on Pages the library's download test would need fixed-size files and its upload test cannot run at all.
- **Loaded latency and upload read 0** against a local server that answers in under a millisecond. That says nothing either way; it needs a real network.

So for Q7: adopting it is possible only behind a config that overrides every Cloudflare default, and a test would have to keep it that way, because a library update that adds a default host would silently break the "nothing leaves the page" promise. On GitHub Pages (Q3) it brings no upload test and needs a size-per-file download. Writing our own two functions (download sufficiency from fixed files, loaded latency) is smaller than that guard. **Recommendation: build, and keep the library as prior art in the README.** Nick's Q7 answer ("adopt only with zero contact") still decides; this is the evidence.

### S1 real-network reading: browser `fetch` vs ICMP `ping` (2026-10-26)

Measured on a Windows 11 laptop over home Wi-Fi (Microsoft Edge 157 / Chromium 157) against `https://linecheck.avd-ops.dev/s1/`, ICMP `ping`, and the nearest Azure regional probe endpoints:

| Target | Method | Median | Min | Max | Notes |
|---|---|---|---|---|---|
| `login.microsoftonline.com` | ICMP `ping` (10 samples) | 19 ms | 12 ms | 28 ms | Samples: `[28, 12, 21, 16, 21, 14, 24, 13, 23, 16]` ms |
| `this site` (`linecheck.avd-ops.dev`) | Browser `HEAD` (10 samples after warm-up) | 17 ms | 13 ms | 34 ms | Samples: `[22, 13, 20, 15, 19, 17, 34, 13, 21, 15]` ms; tracks ICMP ping within 2 ms |
| `windows.cloud.microsoft` | Browser `HEAD` (10 samples after warm-up) | 47 ms | 38 ms | 64 ms | Samples: `[45, 58, 39, 49, 44, 38, 64, 52, 42, 49]` ms |
| `login.microsoftonline.com` | Browser `HEAD` (10 samples after warm-up) | 150 ms | 87 ms | 167 ms | Includes sign-in front-door application processing time |
| `eastus.api.cognitive.microsoft.com` | Browser `GET` (8 samples after warm-up) | 31 ms | 27 ms | 34 ms | Timed samples after 141 ms warm-up: `[34, 32, 30, 27, 29, 30, 31]` ms |
| `eastus2.api.cognitive.microsoft.com` | Browser `GET` (8 samples after warm-up) | 42 ms | 34 ms | 50 ms | Timed samples after 171 ms warm-up: `[50, 45, 42, 34, 38, 41, 43]` ms |

**What this settles (spec 4.1):**
- Against static or lightweight regional endpoints (`this site` at 17 ms, `eastus` at 31 ms), warm-connection HTTPS `fetch` timings sit within ~0 to 12 ms of ICMP `ping` (19 ms).
- Against sign-in front doors (`login.microsoftonline.com` at 150 ms), the HTTPS response includes server-side application time. Sign-in and portal hosts are therefore judged only on **reachability** (`pass` / `blocked`), never against RTT threshold bands, while regional latency bands (`< 100 ms`, `< 150 ms`, `<= 200 ms`) are evaluated against the regional probe endpoints and always described as an **upper bound** ("at most N ms").

## S2: do the old `*.wvd.microsoft.com` names still answer?

First reading from a cloud container outside Azure, through an HTTPS proxy, 2026-10-21; second reading from a Windows 11 laptop on a home Wi-Fi network (no proxy), 2026-10-26. Every answer came from the AVD service itself (`Server: Microsoft-IIS/10.0` with an `x-ms-wvd-service-region` header).

| Name | Container HEAD (2026-10-21) | Container region | Home Wi-Fi HEAD (2026-10-26) | Home Wi-Fi region |
|---|---|---|---|---|
| `rdweb.wvd.microsoft.com` | 405 | NCUS | 405 | EUS |
| `rdbroker.wvd.microsoft.com` | 404 | CUS | 404 | EUS2 |
| `rdgateway.wvd.microsoft.com` | 401 | NCUS | 401 | EUS |

All three still answer from a home network too, routed to the nearest AVD service region (`EUS` / `EUS2`). Learn's end-user list no longer names them, and Q5 was answered "leave them out", so they stay out of the AVD pack; this reading is the evidence if Learn ever lists them again.

## S3: browser capabilities

### Headless Chromium 141 on Linux (2026-10-21)

- `performance.now()` step: 0.1 ms, not cross-origin isolated (matches the spec's 100 microseconds for Chrome).
- `transferSize` is available in resource timing, so the cache-hit check in 4.4 works in Chromium.
- WebRTC with no STUN or TURN server connects locally, and `getStats()` fills `currentRoundTripTime` on the candidate pair. Host candidates are reported, and the page records only whether an address is an mDNS name, never the address.
- `getDisplayMedia` and `MediaRecorder` are both present; WebM (VP8, VP9) is supported for recording.

### Microsoft Edge 157 (Chromium 157) on Windows 11 (2026-10-26)

- `performance.now()` step: `minMs: 0.1`, `medianMs: 0.1` across 499 transitions (`crossOriginIsolated: false`).
- `resourceTimingTransferSize`: `true` (`transferSize` populated on same-origin fetches).
- `webrtc`: `supported: true`, `state: "connected"`, 2 local UDP `host` candidates (masked), `candidate-pair` exposes `currentRoundTripTime`, `totalRoundTripTime`, `packetsSent`, `packetsReceived`, and `packetsDiscardedOnSend`.
- `capture`: `getDisplayMedia: true`, `mediaRecorder: true`, supported MIME types `["video/webm;codecs=vp9", "video/webm;codecs=vp8", "video/webm", "video/mp4;codecs=avc1", "video/mp4"]`.

Wanted when convenient: the same page on Safari (Mac and iPad), Firefox, and Chrome on Android.

## S4: 8 MiB file from GitHub Pages (2026-10-26)

Measured on Windows 11 over home Wi-Fi (Microsoft Edge 157) against the 8 MiB blob served from GitHub Pages (`8,388,608` bytes):

- **Cold CDN edge (`x-cache: MISS`, `age: 0`):** `firstByteMs: 424`, `bodyMs: 535`, `mbitPerS: 125.4`.
- **Warm CDN edge (`x-cache: HIT`, 5 consecutive runs in Edge 157 with `cache: "reload"`):**
  - `transferSize`: `8,391,486` bytes on every run (confirming wire transfer rather than a local cache hit).
  - `firstByteMs`: `[27, 29, 25, 29, 26]` ms.
  - `bodyMs` (`responseEnd - responseStart`): `[274, 153, 98, 94, 95]` ms.
  - Raw `mbitPerS`: `[244.7, 439.2, 682.7, 713.9, 706.4]` Mbit/s (`medianMbitPerS: 682.7`).

**What this settles (spec 4.4):**
1. Measuring `responseEnd - responseStart` (first byte to last byte) cleanly separates body transfer time from cold-edge TTFB (`424 ms` on a cache miss vs `25-29 ms` on a hit).
2. Checking `entry.transferSize >= download.bytes` reliably distinguishes a real wire transfer (`8,391,486` bytes) from a browser disk/memory cache hit (`0` or header-only bytes), retrying once with `cache: "reload"` when cached.
3. On fast links where an 8 MiB transfer finishes in under a second (`94-274 ms`), raw burst numbers swing widely (`245-714 Mbit/s`) and loaded-latency probes do not have time for a full 3-second window. Capping the reported sufficiency figure at **`at least 67 Mbit/s`** (8 MiB in 1 second) and reporting `loaded-latency` only when the download runs for at least `3,000 ms` keeps both numbers honest.

## Code review (2026-10-21)

The code-review skill found ten points on the first version, all fixed: every request has a timeout that becomes a row; S4 rejects anything that is not the 8 MiB file and reads its timing entry for the right run, measuring throughput from first byte to last; the build job can read Pages; the copy button reports a failure; an iPad is told apart from a Mac; the transferSize check reads resource timing; shared code lives in `common.js`; the test checks the CSP starts from `default-src 'none'` and catches any inline handler. S1's two roots answer HEAD with 200 and no redirect (2026-10-21); a redirect to another host would be blocked by the CSP and reported as "blocked or unreachable", never timed.

## How to run the device checks

The spike pages are no longer deployed. They remain in this folder for offline review and as a record of the early checks. The current user-facing app is published from `site/`.
