# avd-linecheck: a one-button network check for virtual desktop users

Status: design baseline. Nick authorized v0 and v1 implementation on 2026-10-25: generic and AVD packs, text-first guides, and portal-style all/selectable region ranking (which supersedes the earlier 12-region cap in sections 4.2 and 5). Real-browser and real-network validation remains; this authorization does not include screenshots, v2, or listing the repo on avd-ops.dev. The remaining media-capture choice is in section 15. This design was red-teamed with Fable before this version (section 14). Name and home decided by Nick on 2026-10-21: `avd-ops/avd-linecheck`, public, MIT; the spec moved here from avd-ops PR #29. Full log collection added the same day (section 17).

A user opens a URL, presses one button, and gets a plain-language verdict plus a result they can share with a helpdesk. Everything runs in the browser. No sign-in, no server in the default path, and nothing leaves the browser unless the user copies or downloads the result. Azure Virtual Desktop (AVD) is the first "pack" of checks and thresholds; the engine is generic so anyone with a hosted desktop can write another pack.

Name: **avd-linecheck** (Nick, 2026-10-21; section 12.3). "The page" and "the tool" below mean the same thing.

## 1. The decision in one line

**A static page that measures from the user's own device, judges against pinned published thresholds, and says what it could not measure.** It reuses the browser latency method avd-landing-zone already runs, takes its AVD thresholds from avd-assess by reference and its endpoint list from one shared, pinned probe map, and leaves everything a browser cannot do (ICMP, traceroute, UDP, upload sinks) to an optional server probe that is a separate, later piece.

## 2. Who it is for, and what a result has to do

| Reader | Needs | So the page |
|---|---|---|
| A user whose desktop feels slow or will not connect | A verdict in their words, in under a minute, on the device and network they actually use | One button, no settings, a sentence per finding, works on a phone or tablet |
| A helpdesk agent | Something to paste into a ticket that says which hop is bad and what to try | A copy-paste summary and a JSON export with no personal data, and a "paste a result" view that renders someone else's export |
| An AVD admin | Evidence for the networking and remote protocol pillars of an assessment | Check IDs and thresholds that cite avd-assess claims, so a result can become an intake fact (section 6.5) |
| Anyone running another hosted desktop | The same tool with their own endpoints | A pack file: hosts, regions, thresholds, wording (section 7) |

Non-goals: a maximum-bandwidth speed test (section 4.4 explains why), a monitoring product with history, a replacement for the Windows App's own connection information, anything that signs in or touches a tenant, and any claim about the session host or the desktop itself.

## 3. Principles

| # | Principle | Where it comes from |
|---|---|---|
| L1 | Measure where the user is. A number from Cloud Shell or a probe elsewhere says nothing about this user | avd-landing-zone lesson 0003 |
| L2 | Claim only what was measured, and show what was not measured beside the result | avd-landing-zone decision 0014 |
| L3 | Fail closed: a timeout, a blocked request or an unknown state is never a pass | avd-landing-zone spec V1 |
| L4 | Thresholds and endpoint lists are pinned references, never copied tables | avd-assess rule "a map, not a shadow source" |
| L5 | Nothing leaves the browser unless the user shares it, and what they share holds no personal data | avd-landing-zone decisions 0007 and 0008 |
| L6 | Checks are pure functions over measurements, tested offline with fixtures | family rule, every repo |
| L7 | The page contacts the probe targets and its own origin, nothing else: no fonts, no analytics, no error reporting | design system rule on fonts; this spec |
| L8 | A warning is never a stop. A corporate proxy or a content blocker fails a probe for people who can connect fine | avd-landing-zone decision 0014 |

## 4. What a browser can measure, and how

Every method below was checked against MDN or the specification on 2026-10-21; the pinned pages are in section 16.

### 4.1 Latency and jitter to a host

The method avd-landing-zone's portal already uses for its region step and its reachability probe (`site/portal/portal-page.js`, `measure()` and `timeOnce()`): one warm-up request to pay for DNS, TCP and TLS, then N timed `fetch` calls with `mode: 'no-cors'`, `cache: 'no-store'`, `credentials: 'omit'`, `referrerPolicy: 'no-referrer'`, a cache-busting query, a per-request timeout, and the median. The portal uses 5 samples and a 4-second timeout and stops a host at the first rejected warm-up; this page uses 8 samples so jitter has something to work with, keeps the timeout and the short circuit, sends `method: 'HEAD'` (allowed under `no-cors`) so the answer carries no body, and leaves `redirect` at `'follow'`, the only mode the Fetch standard allows with `no-cors` (any other mode makes a `no-cors` request a network error). Redirects are handled in the pack instead: a host that answers with a redirect (the shorteners `aka.ms` and `go.microsoft.com` always do, sign-in hosts often do) is probed at a path that answers without one where Learn's host allows it, and otherwise its entry lists the redirect target hosts spike S2 recorded, which go into `connect-src` beside it, so the followed hop is not rejected by the page's CSP and a healthy line does not read as blocked. A redirect to a host the pack does not list still rejects; the verdict calls that `unknown` for an informational host and the CSP test keeps pack and policy equal.

- **What a sample is.** The time from just before `fetch` to the promise settling, read with `performance.now()` exactly as the portal's `timeOnce()` does. It is the **time to complete one small HTTPS request**: after the warm-up it is usually one round trip plus the server's own time, but nothing guarantees connection reuse (browsers open fresh connections, servers close idle ones, HTTP/2 coalescing differs by host) and a followed redirect adds round trips (one more reason the pack prefers paths that answer without one). So the page reports it as an **upper bound** on the round trip ("your round trip is at most N ms"), never as the round trip. Resource Timing is not used for samples: its `duration` runs to `responseEnd` and its default buffer holds 250 entries, fewer than a run makes.
- **Latency** = median of the samples. **Jitter** = median absolute difference between consecutive samples (7 differences from 8 samples), our own choice because a median ignores one stalled sample; LibreSpeed uses a running, asymmetrically smoothed value of the same successive differences instead, and RFC 3550 inter-arrival jitter smooths timestamped packets, so numbers from either will differ. Both are whole milliseconds.
- **Stalls** = samples that hit the timeout, reported as a count and never as packet loss (section 4.6). Samples over three times the median are counted as "slow samples", an uncited heuristic, informational only.
- **Clock resolution differs by engine.** Chrome coarsens `performance.now()` to 100 microseconds in a normal page and 5 in a cross-origin isolated one (MDN); Firefox's default timer precision reduction is 1 ms and WebKit coarsens too (exact current values to be recorded per browser in spike S3). A jitter of 1 or 2 ms on those engines is quantization, so jitter is reported with a floor ("under 2 ms").
- **What a `no-cors` request can and cannot tell.** It can use GET, HEAD or POST and CORS-safelisted headers only; the response is opaque (no status, no headers, no body). A resolved promise means DNS, a connection, TLS and some HTTP answer; a rejection means DNS failure, a TLS failure (including inspection with an untrusted certificate), a TCP block, a content blocker or the timeout. A proxy's own block page resolves too, so "reached" means "something at that name answered on 443" (L8).
- **Where the time goes.** Microsoft's front doors answer close to the user, so a time to `login.microsoftonline.com` is to the nearest edge, not to the session host's region. The page says so, in the same words avd-landing-zone uses (`REACHABILITY_LIMITS`). Through a corporate proxy, VPN or secure web gateway the sample measures that path, and the verdict sentence says so when the page can tell (section 6.6) and the "not tested" list says so always.
- **Spike S1 compares the HTTPS sample with a real round trip** (`avdnettest.exe` or a ping from the same device) on three networks before any sentence calls it "a proxy for the round trip". On Windows 11 home Wi-Fi (Edge 157, 2026-10-26), ICMP `ping` to `login.microsoftonline.com` had a 19 ms median (12 to 28 ms), browser `HEAD` to `this site` was 17 ms, and browser `GET` to `eastus.api.cognitive.microsoft.com` was 31 ms, while `login.microsoftonline.com` over HTTPS was 150 ms due to front-door server processing. Sign-in and portal hosts are therefore judged only on reachability (`pass` / `blocked`), regional latency bands are judged against the regional probe endpoints, and timings are always described as an upper bound ("at most N ms").

### 4.2 Region latency

Reuse the portal's list of regional endpoints (`<region>.api.cognitive.microsoft.com`, each checked in DNS to resolve in its own region, avd-landing-zone decision 0003) and its method. The page ranks the regions the pack lists and, when the link carries `?region=<name>`, judges that region against the round-trip bands (section 6.2). A helpdesk pre-fills the link with the host pool's region so the user never has to know it. The page ranks the target region's geography (the portal's groups: Americas, Europe, Asia Pacific, Middle East and Africa), 12 regions at most, not all 38, to keep the run short (section 5).

**Vantage check.** A user whose desktop is slow will often open the link inside the remote session, and the page would then measure the session host's network. Under the button: "Run this on your own device, not inside the remote desktop." After the run, a best-effort detection (one region under 5 ms with the rest ranked as from inside Azure; the user agent is no help, since browsers on Windows Server send the same string as Windows 11) turns the result into "this looks like it ran inside the desktop; the result is not about your network", and the export carries `vantage: device | likely-session-host | unknown`.

### 4.3 Reachability of required endpoints

Same method, against concrete hostnames from a pack. Wildcards cannot be probed by name; the AVD pack's hosts and the rule for choosing them are in section 6.1.

### 4.4 Download throughput: sufficiency, not maximum

The question a desktop user needs answered is "is there enough?", not "how fast is my line?". Microsoft publishes per-user bandwidth estimates by activity for one 1080p monitor, from idle to full-screen video (`ref:rdp-bandwidth#per-scenario-estimates`), and says the best way to know is to monitor real users (`ref:rdp-bandwidth#monitor-real-users`). Those numbers are a few megabits per second at most, so the page downloads one fixed blob of random bytes from its own origin (same-origin, so every `PerformanceResourceTiming` field is readable, `transferSize` included), times it, and reports **"at least N Mbit/s"** with N capped at the blob's size over the shortest interval worth trusting (an 8 MiB blob in one second says "at least 67 Mbit/s", 8 x 1,048,576 x 8 bits, and the page stops there). This keeps the page honest on a fast line, keeps static hosting's bandwidth bill small (section 9), and avoids reinventing LibreSpeed and OpenSpeedTest, which exist to find the maximum (section 11).

The blob is fetched with `cache: 'default'` and no cache-buster, because `cache: 'no-store'` also adds `Cache-Control: no-cache` to the request and a CDN that honors it would go to origin on every run; the blob's file name carries its hash, so a stale copy cannot be served. On a second run within the blob's max-age the browser's own cache would answer in milliseconds, so the page reads `transferSize`: when it is 0 or smaller than the blob, the reading is a local cache hit, and the page fetches once more with `cache: 'reload'` (this one request goes past the CDN cache) or, if that also fails the check, reports the step `unknown`, never a throughput. The reading is edge-to-user, not the AVD path, and the sentence says so. The pack carries no "needed" figure in v0 and v1: Microsoft's per-scenario estimates are a table on Learn, and restating one number would copy it (L4). The finding is informational, "at least N Mbit/s", until a cited need exists (Q7).

**Loaded latency.** While the blob downloads, the page keeps sampling latency to the pack's primary host, serially. Latency that climbs under load points at queueing in the user's router or link (the method is Cloudflare's, section 11, reimplemented in a few lines). One 8 MiB blob fills a queue only on a slow line, so the page reports loaded latency only when the download ran for at least 3 seconds, otherwise "not measured"; it is informational, never a verdict.

### 4.5 Upload throughput: needs a server

A static site cannot accept a POST (GitHub Pages answers 405). Upload is measured only when the optional server probe is configured (section 10); otherwise the result says "not measured", never a guess.

### 4.6 What a browser cannot measure

| Wanted | Why the browser cannot | What the page does instead |
|---|---|---|
| ICMP ping, traceroute, MTU | No raw sockets in a web page | Latency to a host over HTTPS (4.1); the result links Windows users to Microsoft's `avdnettest.exe` and admins to their own traceroute |
| UDP reachability, port 3478, NAT type | No UDP sockets. WebRTC can gather ICE candidates against a STUN or TURN server and `RTCPeerConnection.getStats()` exposes candidate type (host, srflx, relay), protocol and `currentRoundTripTime`, but only toward a STUN or TURN server the page names, and TURN needs credentials | The UDP hint in section 6.3, against servers the pack names, and the server probe in section 10. Host candidates are mDNS names in current browsers; the server-reflexive candidate is the public IP and is discarded |
| Packet loss | No ICMP or UDP. The only loss a page can count is datagrams through a TURN server it has credentials for (Cloudflare's method) or WebTransport datagrams to a server that speaks HTTP/3 | "Stalls" (4.1), named as such; real loss only with the server probe (section 10) |
| DNS resolution time to a Microsoft host | Cross-origin `domainLookupStart` and `domainLookupEnd` are zero without `Timing-Allow-Origin`, and Microsoft's endpoints do not send it | DNS time for the page's own origin (same-origin timing is complete) on the first visit, as a hint about the resolver; and cold minus warm request time to each host, reported as "connection setup" (DNS, TCP and TLS together), never as DNS |
| Which address a name resolved to (Private Link checks) | No DNS API; Resource Timing does not expose addresses | Out of scope. The per-network reviewer test in avd-assess `gaps/client-network.md` stays the method |
| The transport the real session uses (TCP, STUN, TURN) | Only the client knows; the browser-based client supports no Shortpath at all (`ref:windows-app-platforms#shortpath-by-platform`) | The result tells the user where the Windows App shows it (`ref:configure-rdp-shortpath#verify-transport`) and admins where Log Analytics does |
| Requests to private addresses or localhost | Browsers gate requests from a public page to private addresses (Chrome's local network access model; the rules keep changing) | Never probed, whatever the browser allows. A pack cannot list a private address; the pack validator refuses RFC 1918, link-local and localhost targets |
| The `nextHopProtocol` (HTTP/2, HTTP/3) of a cross-origin response | Gated behind the `Timing-Allow-Origin` check in the Resource Timing specification | Not reported, and not wanted: HTTP/3 to a CDN would show UDP 443 to that edge, not UDP 3478 to a relay. The UDP hint (6.3) is the only honest UDP signal |

## 5. The run

1. **Press "Check my connection".** Nothing runs on page load; the page shows what it is about to contact first (section 8.1), so a user on a metered or monitored network can decline.
2. **Reachability** of the pack's hosts, three at a time, with the warm-up and 8 samples each.
3. **Jitter** on the pack's primary host, serially, with nothing else running, so parallel probes on one uplink do not inflate it.
4. **Region ranking** over the target geography, three at a time, for ranking only.
5. **Target region**, serially, when the link named one: this is the sample the verdict judges, so nothing else runs beside it.
6. **Download sufficiency** with loaded latency.
7. **UDP hint** (section 6.3), only when the pack names STUN servers.
8. **Verdict**, one sentence per finding, worst first, then "what this did not test".
9. **Share**: copy the summary, download the JSON, or press "Check again".

Budget, with the AVD pack (9 hosts, 12 regions, 8 samples, 4-second timeout, 3 at a time):

| Step | Requests | Normal line | Worst case | Deadline |
|---|---|---|---|---|
| Reachability | 9 x (1 + 8) = 81 | 5 to 10 s | 9 blocked hosts: 3 rounds of 4 s = 12 s | 20 s |
| Jitter | 8 | under 2 s | 32 s if every sample stalls | 10 s |
| Regions (ranking) | 12 x 9 = 108 | 5 to 15 s | 4 rounds of 4 s = 16 s | 25 s |
| Target region (verdict) | 9 | under 2 s | 36 s | 10 s |
| Download | 1 (8 MiB) | 1 to 10 s | capped | 15 s |
| UDP hint | 2 STUN bindings | under 2 s | timeout | 5 s |
| Whole run | about 210 | 20 to 45 s | | 85 s |

Each step has its own deadline and the run has one; whatever a deadline cuts off is reported as "not finished" with the samples it has. A progress bar shows what is running. A blocked network produces a verdict, not a spinner. There is no loop mode.

## 6. The AVD pack

### 6.1 Required endpoints: one list, three readers

Microsoft's end-user list (`ref:avd-required-fqdn#client-list`, pinned in avd-assess at Learn git_commit_id 05df299, updated_at 2026-09-22) is mostly wildcards, and avd-assess's rule is to cite the claim and never copy the table. Three family tools probe it today or will: avd-landing-zone's portal (two concrete hosts), avd-current-state's `Test-AvdEndpoints` (eight, drifted from Learn: [avd-current-state #28](https://github.com/avd-ops/avd-current-state/issues/28)), and this page.

**Proposal: one probe map, read by all three.** A data file that holds, per entry: the host or range, port, protocol, purpose, the claim it comes from (`ref:avd-required-fqdn#client-list` or `#host-list`), the Learn pin it was read at, and `probeFrom: [browser, host, cloudshell]`. Wildcards appear as wildcards with `probeFrom: []`; concrete names appear only when Learn lists them by name at the pin. Where it lives was Q6. **Decided (Nick, 2026-10-21): avd-assess**, which he named "the map and the dictionary" of the family, so option (b) below, with avd-assess's rule amended there to allow a probe map as map data citing its pin. The options as they were weighed:

- **(a) With the implementer, in avd-current-state** (working path `assess/client-endpoints.json`), each row citing the pin; avd-assess keeps only the dimension row `network.client` and a line in `gaps/client-network.md` saying the list is read at the pin. This respects avd-assess's two rules, "methodology only, no tools" and "never copy the tables": a list of concrete hostnames with a `probeFrom` field is tooling data and a subset of Learn's table. The landing zone's portal and this page vendor it at a commit, the way the landing zone vendors contracts (`contracts/PINS.json`).
- **(b) In avd-assess**, which would need its rule changed to allow a probe map as a map row with a citation.

The spec had recommended (a). Either way it answers #28's first proposal and gives the AVD pack a source this page does not own.

Hostnames below are Microsoft's published endpoints, the same for everyone, and the landing zone's portal already carries two of them; no address range is restated here (guardrails: cite the pin). From the end-user list at the pin, the browser-probeable rows are: `login.microsoftonline.com`, `windows.cloud.microsoft`, `windows365.microsoft.com`, `graph.microsoft.com`, `ecs.office.com`, `go.microsoft.com`, `aka.ms`, `learn.microsoft.com`, `privacy.microsoft.com` (all TCP 443), and the certificate hosts on TCP 80 (`www.microsoft.com`, `azcsprodeusaikpublish.blob.core.windows.net`), which a page served over HTTPS cannot fetch over plain HTTP (mixed content), so they get `probeFrom: [host, cloudshell]`. The ones the pack marks **required** for the verdict are sign-in and the connection center (`login.microsoftonline.com`, `windows.cloud.microsoft`), as the portal does; the rest are **informational**, because a failure there does not stop a connection and would make a warning out of noise (avd-landing-zone verify-access spec, section 5.2).

`*.wvd.microsoft.com` (feed, broker, gateway) is the wildcard that matters and has no concrete name at the pin. The older names `rdweb`, `rdbroker` and `rdgateway.wvd.microsoft.com` still answer (avd-current-state probes them), but Learn no longer lists them. Open question Q5: probe them as "informational, not in Learn's current list", or leave them out. The spec proposes to leave them out until spike S2 shows what they return.

**Clouds.** The AVD pack (`avd.json`) is the Azure public cloud. Azure for US Government ships as its own pack (`avd-gov.json`) with its end-user list (`login.microsoftonline.us`, `graph.microsoft.us`, `*.wvd.azure.us` in `notTested`), US Government regional endpoints (`usgovvirginia`, `usgovarizona`, `usgovtexas` via `{region}.api.cognitive.microsoft.us` in `regions.json`), and STUN without TURN (`ref:configure-rdp-shortpath#turn-public-cloud-only`). Step 1 and the URL parameter `?cloud=commercial|gov` switch between the Commercial (`avd`) and Azure US Government (`avd-gov`) AVD packs and their respective region maps.

**Workload packs.** Beyond AVD (`avd.json`, `avd-gov.json`) and `generic.json`, the page ships workload packs for **Windows 365** (`w365.json`: `windows.cloud.microsoft`, `windows365.microsoft.com`, `intune.microsoft.com`, `portal.manage.microsoft.com`, `graph.microsoft.com`, `ecs.office.com`, `login.microsoftonline.com`), **Microsoft Teams VDI** (`teams.json`: `teams.cloud.microsoft`, `teams.microsoft.com`, `config.teams.microsoft.com`, `presence.teams.microsoft.com`, with `teams.media-udp` in `notTested` and links to `steps/index.html?step=teams.logs.windows` and `steps/index.html?step=teams.vdi-optimization`), and **Microsoft 365 Core** (`m365.json`: `outlook.cloud.microsoft`, `outlook.office.com`, `officeclient.microsoft.com`, `graph.microsoft.com`). Users or helpdesk links (`?pack=<id>` or `?workloads=avd,w365,teams,m365`) can run a single pack or combine multiple workloads into a deduplicated reachability target list.

### 6.2 Round-trip thresholds

Three published bands, all cited rather than restated:

| Claim | Says |
|---|---|
| `ref:avd-prerequisites#rtt-under-150` | Round trip from the client's network to the host pool's region should be under 150 ms |
| `ref:avd-insights-use-cases#rtt-ideal-100-poor-200` | Below 100 ms for ideal interaction; broadly low quality over 200 ms |
| `ref:avd-connection-quality#rtt-bands` | Up to 150 ms fine for work without rendering or video; 150 to 200 ms fine for text; over 200 ms may affect the experience |

Pack thresholds for the target region, applied to the upper-bound sample of 4.1: **pass** under 100 ms, **warn** 100 to 150 ms ("usable", the prerequisite's target met), **warn** 150 to 200 ms ("fine for text; video and rendering may lag"), **fail** over 200 ms ("likely to affect the experience; if a proxy or VPN carries this traffic, this is about that path"). The portal's `rateLatency` is <100 Good, <=150 Usable, >150 Sluggish: its job is to rank regions against each other, this page's is to judge one region against the bands, so the two differ at 150 to 200 ms. Q8 proposes the portal take these bands when it vendors the engine. Jitter has no published AVD band and no AVD table reports it (`methods/remote-protocols.md` item 8), so jitter is **informational** with a sentence, never a verdict. The HTTPS sample is at most the round trip, and the sentence says "at most".

**Finding states and the overall verdict.** Every finding is one of four states; the overall verdict is the worst state among findings the pack marks required, in this order from worst: `blocked`, `fail`, `unknown`, `warn`, `pass`. Informational findings never move it. Every finding still gets its own sentence, so a run with both a block and a slow region says both.

| State | Means | Examples |
|---|---|---|
| `pass` | Measured, within the cited band | Target region under 100 ms; required host reached |
| `warn` | Measured, outside the ideal band, or reached with a caveat | 100 to 200 ms; a required host reached but slow |
| `blocked` | A required host or step did not answer from this network. Shown as "a warning, not a stop" in the portal's words (L8), because a proxy or content blocker produces it for people who can connect | Sign-in host rejected; every region timed out |
| `unknown` | Not measured, not finished, the vantage looks wrong, or the measurement cannot be read | Deadline hit; `vantage: likely-session-host`; download skipped by `?lite` |

`fail` exists only for a measured value over the fail line (over 200 ms). A `blocked` or `unknown` finding is never a pass (L3) and never a fail: the page did not measure the thing, it measured that it could not. The overall verdict reads: "Good to go", "Usable, with warnings", "Something is blocking this network" (any `blocked`), "Likely to affect your desktop" (any `fail`), or "Could not check" (required findings `unknown`).

### 6.3 Shortpath and UDP hints

What the page can say about RDP Shortpath, and what it must not:

- **Facts it cites.** Every connection starts on TCP through the gateway and tries UDP in parallel (`ref:rdp-shortpath#tcp-first-then-udp`); on public networks STUN first, then a TURN relay on UDP 3478 (`ref:rdp-shortpath#stun-before-turn`, `#turn-range`); symmetric NAT on the session host side (Azure Firewall, NAT Gateway egress) means TURN (`#symmetric-nat-means-turn`), and the same mechanism applies on the user's side, though no Microsoft claim says so for the client (the Windows 365 network-flows page lists symmetric NAT, double NAT and carrier-grade NAT among the reasons direct STUN fails); a proxy as the only path forces TCP (`ref:avd-proxy#proxy-forces-tcp`); RDP should leave the user's network locally and outside VPN and secure web gateway tunnels (`ref:rdp-traffic-optimization#bypass-tunnels`, `#local-egress`); TLS inspection of RDP is unsupported (`#no-tls-inspection`).
- **The hint.** With **two STUN endpoints** named in the pack (two servers, or one server on two ports; one endpoint yields one reflexive candidate and no comparison), the page opens an `RTCPeerConnection` with no media, gathers candidates, and reads `getStats()`: a `srflx` candidate means outbound UDP to that endpoint's port worked from this network; two bindings that map to different public ports mean the NAT looks symmetric, so a relayed (TURN) connection is the likely transport. This is a heuristic (cone against symmetric from two mappings), browsers may filter candidates, and what `getStats()` exposes differs by browser; a spike before v2 records it per engine. It reports only "UDP to port 3478 worked: yes/no" and "NAT looks: cone/symmetric/unknown". The reflexive address itself is the user's public IP: it is read, compared, and discarded, never stored or exported (section 8.3). The CSP `webrtc` directive is implemented in Firefox only (Chromium has not shipped it; Safari unverified), so the guarantee that the page never creates a peer connection unless the pack names STUN endpoints rests on the code and its test, with the directive as a second lock where it exists.
- **What it must not say.** That Shortpath will work. The hint tests UDP from a browser to one STUN server on one port, not the RDP client's candidate exchange with a session host. The web client never uses Shortpath. The result's wording is "UDP from this network looks possible; the Windows App's connection information shows what your session actually uses".
- **Which STUN servers.** Microsoft's relays are published as one address range on UDP 3478 (`ref:rdp-shortpath#turn-range`, read at the pin), not as names, and `avdnettest.exe` carries its own list. Open question Q4: the server probe's own STUN on two ports (section 10), public STUN servers behind an explicit opt-in (a third-party contact, against L7), or nothing in v1. The spec proposes v1 without the hint and v2 with the probe's STUN, and links Windows users to `avdnettest.exe` meanwhile (`ref:configure-rdp-shortpath`, the "Check client device STUN/TURN server connectivity and NAT type" section).

### 6.4 Relay geography

A TURN relay is chosen by the client's location, and a client far from a relay may fall back to TCP (`ref:rdp-shortpath#turn-range`). RDP should leave the user's network close to the user, because a tunnel's exit picks the gateway and relay near the exit instead (`ref:rdp-traffic-optimization#local-egress`). The page cannot name the gateway or relay it would get. It can rank regions and say when the nearest TURN-capable region (the list on the Shortpath page, cited not copied) is far, as a sentence, informational.

### 6.5 Results as assessment intake

avd-assess proposes one intake entry per user network (`gaps/client-network.md`, `intake.userNetworks`): users on it, whether it allows the client endpoint list, whether outbound UDP is allowed, whether a proxy sits in the path, and round trip to candidate regions measured from that network. An avd-linecheck export answers four of those fields for one network on one day. The export carries the pack version and the claim IDs, so an admin can attach it as evidence for the row `network.client` without retyping, and avd-assess decides later whether a check reads it. The page never sends anything to avd-assess; the admin does.

### 6.6 Proxies and tunnels

The page cannot see a proxy. It can notice three things and say them as caveats, never as findings: every probed host answering with nearly the same time (one hop answers for all), a region ranking whose nearest region sits in another geography than the browser's language and time zone suggest (coarse, never stored), and a cold connection setup overhead (`setupMs = warmUpMs - medianMs`) of 250 ms or more on any probed host (pointing to a slow DNS resolver or a TLS-inspecting proxy on the first request, `ref:avd-proxy#bypass-proxies`, `ref:rdp-traffic-optimization#no-tls-inspection`). These produce caveats citing the Microsoft guidance (`ref:avd-proxy#bypass-proxies`, `ref:rdp-traffic-optimization#bypass-tunnels`, `ref:rdp-traffic-optimization#no-tls-inspection`). Same-origin DNS lookup time (`domainLookupEnd - domainLookupStart` on the navigation entry) is also reported as an informational hint (`dns.origin`) when positive.

### 6.7 Helpdesk link builder, before/after comparison, and web client readiness

- **Helpdesk link builder.** Step 1 (`Run check`) and Step 4 (`Share or read`) provide a link builder that generates a shareable URL with `?cloud=commercial|gov`, `?pack=<id>`, `?workloads=<csv>`, `?region=<id>`, and `?lite`.
- **Before / after run comparison.** Users can save the current result as a baseline in memory (or paste a baseline JSON in Step 4) and run a second check (for example, after disconnecting VPN or switching from Wi-Fi to wired Ethernet) to see the delta in target-region RTT, jitter, cleared/newly blocked required checks, and cleared/added proxy caveats.
- **Web client readiness check.** For users connecting in a browser at `windows.cloud.microsoft`, the page runs an informational, non-prompting capability check (`VideoDecoder.isConfigSupported` for H.264 and AV1 hardware/software decode, `navigator.clipboard` availability, and `window.getScreenDetails` multi-monitor API support) and includes the enumerated status values in the export (`webClient`).

## 7. Packs: the generic engine

A pack is a JSON file the page loads from its own origin (`packs/<id>.json`), validated against a schema in the repo:

```json
{
  "id": "avd",
  "version": "2026.10",
  "title": "Azure Virtual Desktop",
  "source": {"repo": "avd-ops/avd-current-state", "path": "assess/client-endpoints.json", "commit": "<sha>"},
  "hosts": [{"host": "login.microsoftonline.com", "purpose": "Sign-in", "required": true, "claim": "ref:avd-required-fqdn#client-list"}],
  "regions": [{"name": "eastus", "display": "East US", "geo": "Americas"}],
  "thresholds": {"rttMs": [
    {"below": 100, "state": "pass", "claim": "ref:avd-insights-use-cases#rtt-ideal-100-poor-200"},
    {"below": 150, "state": "warn", "claim": "ref:avd-prerequisites#rtt-under-150"},
    {"atMost": 200, "state": "warn", "claim": "ref:avd-connection-quality#rtt-bands"},
    {"otherwise": "fail", "claim": "ref:avd-connection-quality#rtt-bands"}]},
  "download": {"path": "blobs/8m.bin", "bytes": 8388608, "need": null, "claim": "ref:rdp-bandwidth#monitor-real-users"},
  "stun": [],
  "text": {"limits": "...", "next": {"windows": "...", "admin": "..."}}
}
```

Rules: hosts must be public names on 443 (the validator refuses IP literals, private ranges, localhost, and plain `http:`); every threshold carries at least one claim ID, and the list ends with `otherwise` so every value lands in exactly one band (200 ms is `warn`, 201 is `fail`); `stun` is empty or exactly two endpoints; a pack's hosts are the only cross-origin `connect-src` entries in the page's CSP, generated from the pack at build time and checked by a test (section 8.2). A pack is loaded only from the page's own origin, so "a custom pack" means a fork, and the README says so. A second pack, `generic.json`, ships with no hosts but the page's own origin and no thresholds beyond "reached or not", so the tool is useful to anyone on day one.

## 8. Privacy and safety

### 8.1 What the page sends, and to whom

| Request | To | Carries | When |
|---|---|---|---|
| The page, scripts, styles, fonts, pack, download blob | The page's own origin | Nothing but the request | Load, and during the run |
| Probe requests (`no-cors`, no credentials, no referrer, cache-buster query) | Each host in the pack, each regional endpoint | The user's IP and user agent, as any visit to those hosts would; a random cache-buster; nothing else | During the run, after the button |
| STUN binding (v2, optional) | The STUN server the pack names | The usual STUN binding request | Only when the pack names one |
| Upload (v2, optional) | The server probe | Random bytes | Only when the pack names one |

There is no analytics, no font or script CDN, no error reporting, no service worker that phones home, no cookies, and no storage except `localStorage` for the theme and the last pack choice. The page lists this table under the button before the first run.

### 8.2 Content Security Policy

Strict: `default-src 'none'; script-src 'self'; style-src 'self'; font-src 'self'; img-src 'self' data: blob:; media-src blob:; connect-src 'self' <pack hosts> <regional endpoints>; base-uri 'none'; form-action 'none'; webrtc 'block'` (v1), `webrtc 'allow'` only in a build whose pack names a STUN server. No inline script or style anywhere: the page's own CSS is a linked stylesheet (the portal keeps a `<style>` block, which this page does not), and the result bars are sized through the CSSOM (`el.style.setProperty`, which `style-src 'self'` allows) rather than the portal's `style="width:..."` strings; the no-inline-style test checks both. The `<meta>` policy precedes every script, `theme.js` in `<head>` included. On GitHub Pages the policy is a `<meta http-equiv>` element, which cannot carry `frame-ancestors`, `report-uri` or `sandbox`; on Cloudflare Pages a `_headers` file delivers it as a real header with `frame-ancestors 'none'` added (section 9). A test rebuilds the `connect-src` from the pack and fails on a mismatch, so a host cannot be probed unless it is also in the policy, and the other way round. The guided step pages of section 18 are separate pages with their own, narrower policy (18.3). `blob:` in `img-src` and `media-src` exists only for the screenshot and recording review step of section 17.6, which plays back what the page itself just captured; the CSP test checks it appears nowhere else.

### 8.3 What the export holds, and what it never holds

The export (JSON, and the summary rendered from it) holds: schema version, tool version, pack id and version, the date and time rounded to the minute, browser family and major version, coarse platform (desktop, tablet, phone), the region parameter if the link had one, and per check: id, status, value, unit, threshold, claim IDs, and the sentence. Overall verdict and the "not tested" list. The user's rating and symptom chips (section 17.6), when given, as enumerated values.

It reveals one thing a helpdesk should know about: the region ranking and the browser's platform locate the user to roughly a city. That is fine in a ticket and a disclosure in a public issue, so the share panel's default keeps the top three regions only and a "full" toggle keeps all of them; the summary text says which it is.

It never holds: an IP address (the WebRTC reflexive address is compared and dropped; `no-cors` responses carry none), a hostname of the user's device, a user name or UPN, a tenant name or ID, workspace or host pool IDs, geolocation (the page never asks for it), a full user agent string, or anything typed into the page. The page's one free-text field, the comment box of section 17.6, is saved only as a `comments.txt` download for the log bundle and never goes into the export, the summary or the paste view, nor into browser storage; the rating and symptom chips of 17.6 are enumerated values and appear in the export and the summary. A test feeds the exporter fixtures with every one of those values present in the raw measurements and asserts they are absent from the output; a redaction pattern list in the repo mirrors avd-landing-zone's portal report redaction (decision 0008) for the day free text ever reaches a shared artifact.

**What an admin can still leak.** A custom pack is the one place a tenant name can enter: a private feed host or a company proxy name typed into `hosts`. The pack validator warns on hosts outside the suffixes the AVD pack cites (`microsoft.com`, `microsoftonline.com`, `cloud.microsoft`, `windows.net`, `office.com`, `aka.ms`; the list lives in the schema), and the export marks results from such a pack `custom: true` so a helpdesk knows the file names the organization's own hosts before pasting it anywhere public. Results shared in a public issue should come from the shipped packs only; the README says so.

### 8.4 Abuse and safety

- The probe targets are fixed by the pack on the page's origin; the link cannot add hosts. The only parameters are `?cloud=` (`commercial` or `gov`), `?pack=` (validated against shipped packs), `?workloads=` (validated against shipped workload packs), `?region=` (validated against the active cloud's region list), and `?lite`, a flag; anything else is ignored. The page is not a scanner.
- Sample counts and concurrency are constants; a run makes about 200 small requests (section 5) and one blob download, with deadlines. There is no loop mode and no scheduler.
- No request carries credentials, so the page cannot be used to test whether the user is signed in anywhere.
- The paste-a-result view parses JSON with a schema check and renders only enumerated values from the paste: check ids, states, numbers and units. Every sentence is looked up from the shipped pack by check id, state and pack version, so a crafted export cannot put its own words in front of a helpdesk agent; a paste whose pack version the page does not ship renders numbers and states with "sentences unavailable for this version".

## 9. Hosting

**Static first, keyless, no secrets.** Two options, both $0:

| | GitHub Pages | Cloudflare Pages |
|---|---|---|
| Fits the family | Every portal is on it; `pages.yml` pattern exists | New account surface for the family |
| Headers | None: CSP by `<meta>` only, no `frame-ancestors` | `_headers` file: real CSP, `Timing-Allow-Origin`, cache control |
| Bandwidth | Soft limit 100 GB per month, about 12,000 full runs; and GitHub's terms exclude using Pages mainly as free hosting for bandwidth-heavy content, which a speed-test blob is the likeliest thing to trip | No stated limit on the Pages limits page; 25 MiB per file, 500 builds a month on Free |
| Upload sink | Impossible | A Pages Function or Worker could take it (that is the server probe, section 10) |

**Decided (Nick, 2026-10-21): the page is always on GitHub Pages**, "so it stays free for people who want to clone and use it": a fork publishes its own copy with no account beyond GitHub. The optional server probe (section 10) is a separate deploy, never needed by the page. The original proposal, kept for its reasoning: **GitHub Pages for v0 and v1**, with the blob at 8 MiB, served from the edge cache (no cache-buster on the blob), and the download step skipped by `?lite`, which is the default link the helpdesk builder hands out; the full run is one click more. **Cloudflare Pages when the server probe arrives**, or sooner if the Pages terms or the soft limit become a problem, because the probe is a Worker anyway and a real CSP header is better than a meta tag. Nothing in the page depends on which host serves it; a test checks the page has no absolute URL to its own origin.

Where the repo lives and how the page is published: section 12.

## 10. The optional server probe (v2)

A separate, optional piece, off by default, named in a pack, never required for the verdict. One small service (a Cloudflare Worker on the free plan, or any container) that offers:

| Endpoint | Gives the page | Why a server |
|---|---|---|
| `GET /echo` with `Timing-Allow-Origin` and CORS | Full `PerformanceResourceTiming` breakdown: DNS, TCP, TLS, request, response, and the status code | Cross-origin timing needs the header; a readable body tells a proxy's block page from a real answer |
| `POST /sink` accepting up to 16 MiB | Upload throughput | Static hosting cannot accept a POST |
| STUN on UDP 3478, TURN with short-lived credentials | UDP reachability, NAT type, round trip over UDP, and datagram loss (send N through the relay, count returns) | No UDP from a page without WebRTC; TURN needs credentials, minted per run with a short lifetime, no account needed |
| WebTransport endpoint (HTTP/3) | Datagram loss and QUIC round trip | WebTransport is Baseline 2026 "newly available" (MDN); needs an HTTP/3 server and an explicit port |

These are four services, not one, and v2 takes them as separate decisions, each with its own cost line and go: **v2a** echo and sink on a Worker (free tier, $0); **v2b** STUN on two ports and TURN with short-lived credentials (a small VM or container with public UDP, a few dollars a month, estimated before any run and never left running); **v2c** WebTransport (needs an HTTP/3 server, likely the same container); **v2d** an outside-in complement, having Globalping probe a gateway from the user's country, a third-party service and an opt-in idea at most (Q9). Rules for all: no sign-in, no storage of results, no logs beyond counts, rate limits per IP, and the same no-personal-data export. The probe's own address range goes into the pack so an admin can allow it.

## 11. Prior art, and what to reuse

Prior-art check: `scripts/kb/prior_art.py "browser network diagnostic speed test"` found nothing in this KB; the sibling and GitHub searches return 403 from the container, so the family part is from reading the repos and the rest from the projects' pages (2026-10-21). **Every outside license below is from the project's page, not its license file**, which the container could not fetch; spike S1 reads each file at a pinned release before anything is adopted, as build-or-adopt requires. Build-or-adopt rule: adopt only the best at our job and only with a readable license ([build-or-adopt.md](https://github.com/avd-ops/avd-ops/blob/main/docs/build-or-adopt.md)).

| Project | License | What it does | What we take | Verdict |
|---|---|---|---|---|
| **avd-landing-zone region latency test and reachability probe** (`site/portal/`, decisions 0003 and 0014) | MIT, ours | Browser latency to regional endpoints with warm-up, `no-cors`, median; two-host reachability with fail-closed classification and honest limits text | The whole method, the region list, `rateLatency` bands, `classifyReachability`'s shape and the limits wording. Ours, same family | **Reuse as the engine's core.** The probe code moves into the shared portal engine in avd-ops (Q8; avd-ops #37), which this page, the landing zone portal and the avd-current-state portal vendor at a pin. Download sufficiency, the UDP hint, vantage, packs, verdict and export stay in this repo |
| **avd-current-state `Test-AvdEndpoints`** | MIT, ours | TCP socket probe of eight hosts from wherever the validator runs; reports WARN off-host | The purpose strings and the lesson that an off-host probe is unknown, not pass (#28) | Share the endpoint map (6.1); different vantage, different tool |
| [LibreSpeed](https://github.com/librespeed/speedtest) | LGPL-3.0 | Self-hosted maximum-throughput test: XHR and Web Workers, download, upload, ping, jitter; PHP backend (Go and Rust ports); optional telemetry and result sharing | The idea of a separate stability test, and its smoothed jitter as the comparison our median-based definition is checked against. Code stays out: LGPL into an MIT repo is not a copy we make | Prior art and parity checklist for the measurement vocabulary |
| [OpenSpeedTest](https://github.com/openspeedtest/Speed-Test) | MIT | Vanilla JS maximum-throughput test over 6 parallel XHR connections, needs a server that accepts POST bodies of 35 MB; 4 percent overhead compensation | The HTTP/1.1 and overhead notes; a parity line "we do not do parallel streams because we test sufficiency" | Prior art. Not adopted: it answers a different question and needs a server |
| [Speedtest Tracker](https://github.com/alexjustesen/speedtest-tracker) | MIT | Self-hosted scheduled tests, history, thresholds, notifications; measures from its own host with a CLI | Nothing to run: it measures from a server, not the user's device (L1). The threshold-and-notify idea is a possible helpdesk feature we do not build | Prior art only |
| [Globalping](https://github.com/jsdelivr/globalping) | Open Software License 3.0 as far as the repo shows (the license file could not be fetched from the container; verify before any use) | Ping, traceroute, MTR, DNS and HTTP from community probes worldwide; keyless API, 250 tests an hour per IP | An outside-in view of a gateway from the user's country, as an opt-in v2 idea (Q9). Never a measurement of this user | Prior art; optional add-on at most |
| [@cloudflare/speedtest](https://github.com/cloudflare/speedtest) | MIT | Browser engine: download, upload, idle and loaded latency, jitter, from `PerformanceResourceTiming`; packet loss through a TURN server; AIM scores. Defaults to Cloudflare's endpoints and the page says results are collected by Cloudflare on completion | The loaded-latency and TURN-loss methods. The library itself only if spike S1 shows its download and latency path runs against our own origin with zero contact to Cloudflare and no result collection; its loss path needs a TURN server, which is the v2b probe anyway | **Best engine, open source**, so the rule says adopt if it can be made to honor L5 and L7 without a server; otherwise its methods are prior art and the two functions are written here (small) |
| [azure-speed-test](https://github.com/blrchen/azure-speed-test) | MIT | Latency, download and upload to Azure regions through Blob Storage; Angular front end and a .NET backend with storage keys | A cross-check for the regional endpoint list | Prior art; needs a server and keys, so not adopted |
| Microsoft AVD Experience Estimator | Closed, decommissioned | Estimated round trip from the visitor's location to each region through the service; removed, with "accuracy concerns" cited second-hand (Microsoft Q&A, 2025-01-21) | The lesson that an estimate from a location is not a measurement from a device (L1) | Prior art |
| Microsoft `avdnettest.exe` | Closed binary, Windows | Checks DNS, TURN support, the relay servers, and NAT type from a Windows device (`ref:configure-rdp-shortpath`) | The "next step for Windows users" link in the result, and the parity line for the v2 STUN and TURN check | Prior art; the page links it, never bundles it |
| Microsoft Windows App connection information, AVD Insights and Log Analytics | Platform | The real session's transport and round trip, in the client and in the admin's workspace (`ref:configure-rdp-shortpath#verify-transport`) | The wording "what your session actually uses" and the admin pointer | Platform; the page points at it |
| Microsoft 365 network connectivity test | Closed; the advanced tests are a downloaded program | Basic tests in the browser, advanced tests in a downloaded executable, location coarsened to 300 m | The browser-basic plus optional-advanced split, which is our v0 to v2 shape. We never ask for location | Prior art |

Summary: **reuse the family's own engine, adopt Cloudflare's methods (and its library if the spike passes), link Microsoft's tools, and build the pack, verdict, export and paste-to-read layers**, which none of the above has.

## 12. Public readiness

### 12.1 License and notices

MIT, like every public family repo. The README opens with the family's research-only warning block and a Contributing section (the landing zone's wording is the model), and the page carries the shell's notice line before the button (design system rule: the notice stays first). Not affiliated with Microsoft; Microsoft trademarks named only to describe what is tested.

### 12.2 Where it lives

Decided (Nick, 2026-10-21): **its own public repository, `avd-ops/avd-linecheck`**, rather than a folder in avd-ops. It is listed in avd-ops `repos.json` and given a page in `docs/knowledge/repos/` only when Nick says. Reasons: every family tool is one repo with its own issues, CI and Pages; "useful to anyone" means forkable alone, with the AVD pack as one file among others; and avd-ops stays the front door, not a host for tools (decision 0002). The page vendors the design system at a tag with a lock file (decision 0005) and uses the shell's bar, notice and footer like a portal, with the Docs, Deploy and Assess switcher. Published by a `pages.yml` like the others.

### 12.3 Name

Decided (Nick, 2026-10-21): **avd-linecheck**, the recommended name with the family's `avd-` prefix, which also clears the Rust linter collision. The candidates as weighed, with what a web search found on 2026-10-21 (the GitHub search is blocked from the container):

| Name | Why | Collisions found |
|---|---|---|
| **linecheck** (recommended) | A line check is the one-button "is my line good?" a crew does before the show; says check, says line, works for any desktop | A Rust file-length linter named `linecheck` on crates.io (MIT, alpha); nothing in networking |
| dialtone | "Do I have a dial tone?"; warm, memorable | Dialpad's open-source design system is named Dialtone (`dialpad/dialtone`, `@dialpad/dialtone-css`) |
| lastmile | Names the segment the tool measures | Agora's "last-mile probe" API; the last mile is a crowded term |

Repo `avd-ops/avd-linecheck`, page at **`linecheck.avd-ops.dev`** (Nick, 2026-10-21), a GitHub Pages custom domain whose DNS record is DNS only, never proxied: a proxy in front of Pages can inject its own scripts or reporting endpoints, which breaks L5 and L7, and the `served` workflow checks after every deploy and once a day that every served file equals the repo's copy (the generated test file by size), that plain HTTP only redirects to HTTPS, and that no response carries a proxy's reporting headers. It cannot see what a network between a user and Pages does; HTTPS is what covers that. Not `avd-ops.party`, which stays the demo environment's domain (18.4). A fork keeps the default `<owner>.github.io/avd-linecheck/` address.

### 12.4 Repository layout

```
README.md  LICENSE  CONTRIBUTING.md  SECURITY.md  PRIVACY.md
site/
  index.html            the page: shell, notice, button, results, paste-a-result
  app.js                wiring only
  engine.js             measure, jitter, stalls, download, udp hint (pure where possible)
  verdict.js            pure: measurements + pack -> findings, overall, not-tested list
  export.js             pure: findings -> JSON and summary text; scrub
  packs/avd.json  packs/generic.json  packs/schema.json
  blobs/8m.bin          random bytes, generated by a script, checked in with a hash
  assets/               vendored design system at a tag + lock file
  steps/                guided step pages, screenshots, overlays, steps.json (section 18)
docs/
  spec.md (this file, moved)  decisions/
tests/                  node --test: verdict and export fixtures, pack <-> CSP, disclaimer,
                        no-third-party-URL, no-inline-script, scrub, paste-a-result parsing
.github/workflows/      ci.yml (tests, html validation, link check), pages.yml
```

The log bundle is not here: it is specified as the session and device modes of avd-current-state's optional local collector (17.8); merged PR #40 is design only, and implementation and signing remain pending. No build step for the page itself: plain HTML, CSS and JavaScript, as the portals are, so a fork can be hosted by copying `site/`.

**Accessibility and plain language.** WCAG 2.1 AA as the target: color is never the only signal (each state has a word and an icon), the progress bar is a live region that announces the step, every control meets the shell's 44 px touch size, and the page works without JavaScript to the extent of showing the notice and the "needs JavaScript" line. Verdict sentences are written for a reader who did not choose the desktop and does not know what a gateway is: one finding, one sentence, one next step, checked against a reading-level target in a test (a word list, not a model).

### 12.5 Roadmap

| Version | Delivers | Needs |
|---|---|---|
| **v0, static page** | The run (section 5) with the generic pack: reachability of the page's own origin and any hosts in the pack, region ranking, download sufficiency with loaded latency, jitter and stalls, verdict, JSON and summary export, paste-a-result, phone layout, the shell; the first, device-only guided steps (section 18.9) | Spikes S1 to S4; the repo; the design system at a tag; device captures from Q12's checklist |
| **v1, AVD checks** | The AVD pack from the shared probe map (Q6), cited thresholds, `?region=` from a helpdesk link, the Shortpath facts and the Windows `avdnettest.exe` pointer, the intake-shaped export (6.5); the landing zone's portal links the page from its region and verify steps; the per-client guided steps (section 18) | The probe map (Q6); avd-current-state #28 aligned; Q5 answered; Q12 and a costed capture batch |
| **Log bundle** (designed for avd-current-state, 17.8) | The device and in-session collector, zip to Downloads, manifest, no upload, signed release (section 17) | Implementation and code signing; spike S5; Pester against a synthetic profile tree, in Constrained Language Mode too |
| **v2, server probe**, in pieces (v2a to v2d) | Echo with full timing and upload on a Worker first; then STUN and TURN with loss and NAT type; then WebTransport datagrams; Cloudflare Pages with a real CSP; Globalping outside-in last, if at all | A cost estimate and Nick's exact go for each piece that runs; Q4, Q7, Q9 |

Parked, not planned: history and trends (that is a monitoring product), a native app, anything that signs in.

## 13. Spikes before v0 (offline or free, no cloud run)

Go given 2026-10-21 (Q10). Pages and results so far: [spikes/README.md](../spikes/README.md).

| # | Question | How | Result |
|---|---|---|---|
| S1 | How far is the HTTPS sample from a real round trip, and can `@cloudflare/speedtest` run against our own origin with zero requests to Cloudflare and no result upload? Read every outside license file at a pinned release | A local page beside `avdnettest.exe` or a ping, three networks; the library's source at a pinned release with the network panel open | Library audited (2026-10-21): defaults call home; build our own sufficiency/loaded-latency functions. Real-network reading (2026-10-26, Windows 11 Wi-Fi, Edge 157): static/regional HTTPS (`17-31 ms`) tracks ICMP `ping` (`19 ms`) within 0-12 ms; sign-in front door (`150 ms`) includes server time, so sign-in hosts check reachability only |
| S2 | Which `*.wvd.microsoft.com` names answer today, and with what? | `curl -sI` from a laptop, not from Azure, recorded with the date | Done from container (2026-10-21, `NCUS`/`CUS`) and home Wi-Fi on Windows 11 (2026-10-26, `EUS`/`EUS2`): `rdweb` (405), `rdbroker` (404) and `rdgateway` (401) all answer with `x-ms-wvd-service-region`; kept out of the AVD pack per Q5 |
| S3 | Timer granularity, `getStats()` exposure and `getDisplayMedia` and `MediaRecorder` support per engine (Chrome, Firefox, Safari on desktop and phones) | A local page that records `performance.now()` deltas and ICE candidate fields | Done on Chromium 141 Linux (2026-10-21) and Edge 157 Windows 11 (2026-10-26): 0.1 ms timer step, `transferSize` exposed, `getDisplayMedia` + `MediaRecorder` (WebM VP9/VP8 and MP4 AVC1) supported |
| S4 | Does an 8 MiB blob from GitHub Pages give a stable sufficiency reading on phone Safari and desktop browsers, cold and warm edge? | A test page on a Pages branch of a scratch repo | Done on Windows 11 Wi-Fi (Edge 157, 2026-10-26): cold edge `firstByteMs: 424`, `bodyMs: 535` (`125.4 Mbit/s`); warm edge `firstByteMs: 25-29`, `bodyMs: 94-274` (`transferSize: 8,391,486`). Confirms `responseEnd - responseStart`, `transferSize` cache-hit retry, and the `at least 67 Mbit/s` cap |
| S5 | What can a standard user read for the log bundle (event channels, CIM classes, counter sets, `powercfg` reports), and how does zipping behave on open log files? | S5a: a standard account on a Windows 11 device (free). S5b: a standard account on a multi-session host, in a costed sandbox batch (section 17.8) | Moved to avd-current-state local collector spike S2 (Q11) |

None of these touches a tenant or costs money, except the multi-session half of S5 (S5b), which needs a host pool: it runs only inside a sandbox batch with a written cost estimate and Nick's exact go, or waits for one that is already approved.

## 14. Red team

Reviewed by Fable (claude-fable-5-1) on 2026-10-21 before this version. Findings and what changed: section 14.1 is filled in from the review. Section 17 (the log bundle, user-added context, inventory and health) was added after the review and red-teamed separately (17.9).

### 14.1 Findings folded in

Twenty findings; all folded in, none rejected.

1. The sample is the portal's `performance.now()` wrapper, not Resource Timing (buffer of 250, `duration` runs to `responseEnd`); named "time to complete one small HTTPS request" (4.1).
2. No guarantee of connection reuse and silent redirects: `HEAD`, reported as an upper bound on the round trip, "at most N ms" (4.1, 6.2), with S1 comparing it to a real round trip.
3. Jitter is the median absolute successive difference (our choice; LibreSpeed smooths, RFC 3550 differs); the 3x stall multiplier is an uncited heuristic, informational (4.1).
4. Timer resolution differs by engine (Chrome 100 us, Firefox 1 ms, WebKit coarser); jitter floor "under 2 ms"; S3 records it (4.1).
5. Loaded latency only when the download ran 3 seconds, informational; the bufferbloat sentence softened; the blob is edge-to-user (4.4).
6. Run budget was wrong (423 requests, 63 seconds blocked): regions cut to the target geography, a budget table, per-step and whole-run deadlines, jitter sampled serially (5).
7. No verdict state table: four states (`pass`, `warn`, `blocked`, `unknown`), `fail` only for a measured value over the line, the portal's 150 ms band and the difference from it stated (6.2).
8. The NAT heuristic needs two STUN endpoints; browser candidate filtering and `getStats()` differences; Safari's `webrtc` directive unverified (6.3, 7).
9. `#symmetric-nat-means-turn` is host-side; the gateway sentence was uncited: relay geography cites `#turn-range` and `#local-egress` only (6.3, 6.4).
10. Vantage: a line under the button, best-effort detection of a run inside the session, `vantage` in the export (4.2).
11. The region ranking locates the user: top three regions by default in the share panel; the paste view renders only enumerated states and numbers and looks sentences up from the shipped pack (8.3, 8.4).
12. `style-src 'self'` against the portal's inline width strings: CSSOM sizing, linked stylesheet, meta CSP before `theme.js` (8.2).
13. A hostname list with `probeFrom` in avd-assess collides with "methodology only" and "never copy the tables": Q6 now offers (a) avd-current-state, recommended, and (b) an avd-assess rule change; repo owners made consistent (6.1, 7, 15).
14. `needMbps: 5` restated a Learn figure: no need threshold in v0 and v1, sufficiency informational (4.4, 7).
15. Licenses were read from project pages, not files: said so, S1 reads them; Q7 scoped to the library's no-server path (11, 13, 15).
16. GitHub Pages terms on bandwidth-heavy hosting; the blob served from the edge cache without a cache-buster; `?lite` the default helpdesk link (9).
17. The Private Network Access citation was stale: generic wording, the validator rule stands (4.6).
18. `nextHopProtocol` would show UDP 443 to a CDN, not 3478 to a relay: row kept as "not wanted", spike dropped (4.6, 13).
19. Government and China clouds: a pack per cloud, TURN absent in Government (6.1).
20. The custom-pack warning needed a suffix list, and a pack can only come from the origin (a fork) (7, 8.3).

From the code review of the PR, folded in as well: redirecting hosts are not misread as blocked by the CSP (first as `redirect: 'manual'`, corrected in the avd-linecheck review because `no-cors` allows only `'follow'`: redirect targets go in the pack and the CSP); `?lite` named in 8.4; the user agent dropped from the vantage check (Windows Server browsers send the client string); the target region sampled serially for the verdict; thresholds as a list of cut lines each with a claim; `cache: 'default'` for the blob (`no-store` adds `Cache-Control: no-cache`); the `webrtc` directive is Firefox-only; 67, not 64 Mbit/s; the relay range cited at the pin instead of restated.

Also added from the review's "missing" list: accessibility and plain-language targets (12.4), proxies and tunnels as caveats (6.6), and v2 split into four separately costed pieces (10).

The avd-linecheck foundations review (2026-10-21, code-review skill) corrected four more: `no-cors` permits only `redirect: 'follow'` (4.1); a browser cache hit on the blob is caught by `transferSize` (4.4); the threshold list ends with `otherwise`, so 200 ms has a band (7); the overall verdict orders the states (6.2). It also put the downloadable collector in one place and kept one privacy document (12.4).

## 15. Open questions for Nick

1. **Name.** Answered 2026-10-21: avd-linecheck (12.3).
2. **Home.** Answered 2026-10-21: `avd-ops/avd-linecheck`, public, MIT (12.2).
3. **Hosting.** Answered 2026-10-21: always GitHub Pages, so anyone who clones it hosts it free (section 9). Was: GitHub Pages first with an 8 MiB blob and a `?lite` link (recommended), or Cloudflare Pages from the start for the real CSP header (section 9).
4. **UDP hint.** Answered 2026-10-21: as recommended. Was: v1 without it and v2 with the probe's own STUN on two ports (recommended), public STUN servers behind an opt-in, or try Microsoft's relay range (6.3).
5. **Unlisted names.** Answered 2026-10-21: as recommended. Was: Leave `rdweb`, `rdbroker` and `rdgateway.wvd.microsoft.com` out until spike S2 (recommended), or probe them as informational (6.1).
6. **One endpoint map.** Answered 2026-10-21: in avd-assess, "the map and the dictionary" (6.1); the rule change and the map are an avd-assess PR, and avd-current-state #28, the landing zone's portal and this page read it at a pin. Was: in avd-current-state with each row citing the Learn pin (recommended), or in avd-assess with its "no tools, no copied tables" rule changed; and who pins it (6.1, avd-current-state #28).
7. **Adopt or build the engine's throughput and loss parts.** Answered 2026-10-21: as recommended (adopt only if S1 shows zero contact with Cloudflare, otherwise build; sufficiency stays informational unless a cited figure exists). Was: adopt `@cloudflare/speedtest` only if spike S1 shows its no-server path runs with zero contact to Cloudflare, otherwise write the two functions here (section 11). Also whether a cited "enough bandwidth" figure should exist at all, or sufficiency stays informational (4.4).
8. **The landing zone's portal.** Answered 2026-10-21: one shared portal engine instead of standalone portals (Nick: "we should have a shared portal engine if possible too not build 3 standalone portals"). Measurement, paste-a-result parsing and redaction, the run-in toggle and result rendering become one engine that the landing zone portal, the avd-current-state portal and this page vendor at a pin, planned in its own thread, with its home in avd-ops next to the design system (Nick, 2026-10-21: "avd-ops makes sense"; spec avd-ops #37). Until then, this page's engine is written as modules that move there unchanged. Was: link to the page from its region and verify steps and vendor the engine later (recommended), or keep its own copy forever (6.2).
9. **v2 pieces.** Answered 2026-10-21: "v2 stay free": only pieces that run at $0 on free tiers are built, and anything with a cost line is parked. Was: Which of echo and sink (v2a), STUN and TURN (v2b), WebTransport (v2c) and Globalping outside-in (v2d) are worth their cost line, and in what order (section 10).
10. **Go for the spikes.** Answered 2026-10-21: go for S1 to S4 and S5a (free, no tenant, no spend; S5a is specified as avd-current-state's local collector spike S2, but has not been implemented or run on current-state main as of 2026-10-25). S5b still needs its own estimate and exact go. Was: S1 to S4 and S5a are offline or free; no tenant and no spend. S5b needs a sandbox run with its own estimate and go.
11. **Log bundle** (section 17). Answered 2026-10-21: the recommendations below (Windows first, macOS and mobile to Microsoft's in-app steps, Downloads, signing before shipping, 17.6 and 17.7 as drafted), designed for avd-current-state (option b). Merged PR #40 contains the design only; implementation and signing remain pending. Was: Windows script for the device and the session first, with macOS and mobile pointed at Microsoft's in-app steps (recommended); before or after the page's v0; Downloads as the destination (recommended over Documents, which OneDrive may sync); code signing, now a prerequisite for shipping the script at all (17.5), which needs a certificate, an identity and a cost line; and the user-added pieces (17.6: screenshot and recording in the page, comments only in the bundle, a picked rating that goes into the export) and the inventory and health fields (17.7).
    Who owns the collector: **answered 2026-10-21, avd-current-state** (Nick: "avd current state is the collector/validator", and avd-linecheck "is the end-user portal"). It is specified as the session and device modes of the local collector in [avd-current-state#40](https://github.com/avd-ops/avd-current-state/pull/40); that PR merged design only, and implementation is not present on current-state main as of 2026-10-25. Section 17 stays the design of those modes. The rest of Q11 is answered above. The options as recorded before (Nick, 2026-10-21: "maybe the collector should be an optional part of avd current state actually"; recorded, not decided): **(a) avd-linecheck**, as section 17 drafts it, beside the page that sends users to it; **(b) avd-current-state, as an optional part**: it already owns read-only collection and Windows PowerShell 5.1 tooling and stays self-contained with avd-landing-zone, but today it reads an estate from an admin's seat into C11 facts, while this collector runs on end users' devices and session hosts as the user and gathers personal data (17.4), so it would have to stay outside the C11 path and keep the bundle's local-only, no-upload rules; the signed-release need (avd-linecheck #3, avd-ops decision 0008 section 5.2) moves with it, and #3 is re-pointed or moved; **(c) no collector**: the page's guided steps (section 18) send each user to their client's own log collection. Whichever owns it, section 17's red-team fixes go with the code. Option (b) is drafted in [avd-current-state#40](https://github.com/avd-ops/avd-current-state/pull/40) (`docs/local-collector-spec.md`, its question 2): one signed collector with `-Mode Session` and `-Mode Device`, section 17 staying the design of those two modes. If Nick picks it, 17.8's layout and this question point there, avd-linecheck #3 moves or is re-pointed, and the federated credential subject in avd-ops decision 0008 section 5.2 becomes `repo:avd-ops/avd-current-state`.
12. **Guided steps** (section 18). Answered 2026-10-21: agreed as recommended. Was: who captures the screenshots (Nick by hand from a checklist, recommended to start; free for device-only steps, a costed sandbox batch with his exact go for anything showing a session; or a scripted sandbox run with its own estimate and go); the demo sign-in domain `avd-ops.party` (bought by Nick for the demo environment; a DNS record and a custom domain in the sandbox tenant, recommended, so no tenant domain can appear in a capture) on an extra-protected demo account (18.4); and still-plus-overlay sequences as the default animation with short videos only where motion matters (recommended).

## 16. Sources checked (2026-10-21)

Family: avd-landing-zone `site/portal/portal-core.js` and `portal-page.js` (region latency and reachability), `build/decisions/0003-region-by-latency.md`, `0014-verify-access.md`, `build/specs/verify-access-spec.md`, `build/lessons/0003-region-latency.md`; avd-current-state `avd_deployment_validator.ps1` (`Test-AvdEndpoints`) and issue #28; avd-assess `references/avd-required-fqdn.yaml`, `avd-connection-quality.yaml`, `avd-insights-use-cases.yaml`, `avd-prerequisites.yaml`, `rdp-shortpath.yaml`, `configure-rdp-shortpath.yaml`, `rdp-multipath.yaml`, `rdp-bandwidth.yaml`, `rdp-traffic-optimization.yaml`, `avd-proxy.yaml`, `windows-app-platforms.yaml`, `gaps/client-network.md`, `gaps/transport-classification.md`, `methods/remote-protocols.md`, `dimensions.yaml` row `network.client`; avd-ops `docs/design-system.md`, `docs/build-or-adopt.md`, decision 0005.

Browser: MDN `PerformanceResourceTiming` (cross-origin timing information), `Performance.now()` (resolution), `Request.mode` and the Fetch standard (no-cors methods and headers, opaque responses), `RTCPeerConnection.getStats()` with `RTCIceCandidateStats` and `RTCIceCandidatePairStats`, `WebTransport` (Baseline 2026, HTTPS, HTTP/3, explicit port), Content-Security-Policy (meta delivery), Chrome developers blog "Private Network Access update" (2024-03; since superseded by Chrome's local network access permission model, which the spec does not depend on). GitHub Pages limits (1 GB site, soft 100 GB a month, 10 builds an hour). Cloudflare Pages limits (25 MiB per file, 20,000 files and 500 builds a month on Free, 100 `_headers` rules).

Microsoft Learn (through avd-assess pins where a reference exists): required FQDNs and endpoints (end-user table), RDP Shortpath (TURN range `51.5.0.0/16`, relay regions, connection sequence), configure RDP Shortpath (`avdnettest.exe`, connection information dialog), compare Windows App features across platforms, Microsoft Q&A on the Experience Estimator (2025-01-21), the Microsoft 365 network connectivity test tool page.

## 17. Log bundle: full log collection for an AVD issue (proposed)

Nick, 2026-10-21: "needs to have full log collection for any avd related issue including teams and performance, not sure how we would send it but maybe just collection and zip to downloads/document?" Added after the red team in section 14, then red-teamed on its own by Fable the same day (17.9).

### 17.1 What a page can and cannot do

A web page cannot read files, event logs or performance counters on the device (section 4.6 for the network side; the same sandbox applies to the file system). So the bundle is a **companion script**, not part of the page. The network check stays the one-button part; the bundle is the "your helpdesk asked for logs" part. How the script reaches a device, and why the page never hands out a command to paste, is 17.5.

Where it runs: **Windows only**, on the user's device and inside a Windows session host (AVD or a Windows 365 Cloud PC, the same in-session path). macOS, iOS and Android endpoints get Microsoft's in-app logging steps (`learn.microsoft.com/windows-app/troubleshoot-collect-logs`), and Linux thin clients and Windows 365 Link get nothing on the device side; the page says so as "not collected" (L2), and the in-session half still works for all of them. The web client gets its own "Capture logs" in the session toolbar, which the page links; the page itself cannot run inside the web client's session.

### 17.2 Two places, one script

An AVD problem leaves evidence on two machines, and the user can reach both. Each row of the collector's source list (`local/sources.json` in avd-current-state, 17.8) cites the Learn page and anchor it comes from and says whether it needs admin (yes, no, unknown); a source the script cannot read is recorded as "access denied", "not present" or "locked", never a failure of the run and never silently skipped.

| Run on | Collects |
|---|---|
| **The user's own device** | Windows App logs (`%temp%\DiagOutputDir\Windows365\Logs`, `learn.microsoft.com/windows-app/troubleshoot-collect-logs`); the retired Remote Desktop client's `RdClientAutoTrace` folder as legacy, best effort; Teams new VDI optimization (SlimCore) logs on the endpoint, both the older and the split Host and Framework paths, and the AppXDeployment-Server and AppxPackagingOM operational events (`learn.microsoft.com/microsoftteams/vdi-2-troubleshooting`, "Log collection" and "Connection error"); OS build, Windows App and plugin versions; a performance sample (17.7) while the user reproduces the problem; the latest avd-linecheck result JSON if one is in Downloads |
| **Inside the remote session** (as the user, no admin) | New Teams logs (`%LOCALAPPDATA%\Packages\MSTeams_8wekyb3d8bbwe\LocalCache\Microsoft\MSTeams\Logs`, from the same Teams page); the file Teams writes when the user presses Ctrl+Alt+Shift+1, which the two Learn pages describe differently (a `PROD-WebLogs-*.zip` in the VDI page, an `MSTeams Diagnostics Log` text file in the older AVD page), so `sources.json` lists both patterns; during the run the script asks the user to press Ctrl+Alt+Shift+1 now, waits up to two minutes for a new file (the user can skip), and also takes a matching file from the 30 minutes before it started, for a user who pressed it first; `Vdi_debug.txt` and the Teams VDI events in the Application log; event logs from the time window for the channels AVD Insights collects (`learn.microsoft.com/azure/virtual-desktop/insights-glossary`, "Windows Event Logs"); FSLogix profile status; the performance sample |
| **Admin switch** (helpdesk, elevated) | Agent logs and every user's events on the host, which is the only path that claims a complete event picture |

**A multi-session host is shared.** The Application, System and session manager logs on a pooled host carry other users' sign-in names, sessions and crashes, and most events carry no session ID at all, so they cannot be filtered to one user. A session-host bundle therefore contains other users' data by design, the consent screen says so, and the manifest records per channel whether it was read, denied or absent. Non-admin read access to the TerminalServices and FSLogix channels is not documented; spike S5 records it.

Microsoft's own collectors are prior art and the escalation path. TSS (`.\TSS.ps1 -Scenario UEX_RDScli` and `UEX_RDSsrv`), which includes the Remote Desktop collector MSRD-Collect, is far broader, needs an elevated prompt and writes to `C:\MS_DATA`; its license allows use only to help Microsoft troubleshoot and forbids distribution (`learn.microsoft.com/troubleshoot/windows-client/windows-tss/introduction-to-troubleshootingscript-toolset-tss`), so it is linked, and nothing is copied from it, not even a source list. Multimedia redirection has its own log capture in the browser extension; the page links it.

### 17.3 Where the bundle goes, and how it is sent

- **Written locally, never uploaded.** One zip in the user's Downloads folder, named `avd-linecheck-<device|session>-<yyyyMMdd-HHmm>.zip`, and the script opens File Explorer on it. Downloads, not Documents, because OneDrive Known Folder Move syncs Desktop, Documents and Pictures (with Screenshots and Camera Roll) but not Downloads (`learn.microsoft.com/troubleshoot/sharepoint/lists-and-libraries/determine-known-folder-move-eligibility`). The script resolves the real Downloads folder from the user's shell folder settings rather than assuming `%USERPROFILE%\Downloads`, warns when it is redirected to a network share or a synced path, and checks free space first: inside a session, Downloads usually sits in the FSLogix profile container, which a large zip can fill. Teams already writes its own diagnostic file there.
- **Sending is the helpdesk's channel.** The user attaches the zip to their ticket or the place their helpdesk names. The tool never emails, uploads or posts it. A future "send" option, if ever, is the v2 server probe's problem and needs its own decision.
- **A manifest first.** `manifest.json` (written with an explicit `-Depth`, since `ConvertTo-Json` truncates at 2 by default) lists every file, its source path with the profile folder replaced by `%USERPROFILE%`, its size and hash, what was skipped and why (not found, access denied, locked, too big), the time window and the script version. A collection that found nothing says so instead of producing an empty zip (L2, L3).
- **Staged, then zipped.** Logs are copied to a staging folder first, because `Compress-Archive` in Windows PowerShell 5.1 fails on files another process holds open, skips hidden files, reads each file into memory and stops at 2 GB per file (`learn.microsoft.com/powershell/module/microsoft.powershell.archive/compress-archive`). Windows App and Teams keep their logs open while running, so the script asks the user to close them where Microsoft's steps say to, and records any file still locked as "locked, skipped".
- **Bounded.** A time window (default the last 24 hours, `-Hours` to change), a size cap per source and for the whole zip (default 200 MB), and a performance sample of at most 5 minutes. Budget, normal and worst case:

| Step | Cap | Normal | Worst |
|---|---|---|---|
| Inventory and health | per class property allowlist | under 30 s | 2 min (CIM timeouts) |
| Logs and events | 50 MB per source, 24 h window | under 1 min | 3 min |
| Performance sample | 5 min, user stops it sooner | 1 to 5 min | 5 min |
| Staging and zip | 200 MB total | under 1 min | 2 min |

- **Retention.** The zip and the Teams file stay in Downloads until someone deletes them. The page's "for helpdesks" note says: open the manifest first, keep the zip in the ticket and do not forward it, delete it after the ticket closes; the script's last screen tells the user they can delete both once the ticket is done.

### 17.4 Privacy: the opposite of the network export

The network export (section 8.3) holds no personal data. **The bundle does**, most of all in what the user adds:

1. **Screen recordings and screenshots**, which show whatever was on screen: chats, mail, notifications, documents.
2. **Comments**, in the user's own words.
3. **Logs**: user names, device and host names, IP addresses, tenant and session IDs, meeting titles in Teams logs, and, on a multi-session host, other users' events (17.2).
4. **Inventory**: the installed-apps list and the hardware model.

So the bundle is treated as private by design:

- The script shows the list of sources, including "other users' events on this host" in a session, and asks before it starts; the page says plainly that the zip contains personal and organizational data and goes only to the user's own helpdesk, never into a public issue, a forum or this repo.
- No scrubbing is offered. Redacting free-form logs reliably is not possible, and a "redacted" label would invite exactly the public post that leaks; `sos report`'s opt-in obfuscation (17.9) is the considered alternative, rejected for now. The manifest says "contains personal data: yes".
- Inventory takes only the properties an allowlist in `sources.json` names for each class, and a Pester test fails on any other property. Never collected: the signed-in user name from `Win32_ComputerSystem`, serial and part numbers (BIOS, memory, disks), MAC addresses, Defender's computer ID, Wi-Fi network names and access point addresses (signal quality and band only).
- This repo never receives a bundle: the issue template says so, and real bundles never become fixtures; tests use synthetic files.

### 17.5 Getting the script onto a managed device

The page never asks a user to paste a command into PowerShell, and says so in those words. A "copy this `-ExecutionPolicy Bypass` command" step is exactly the pattern look-alike phishing pages use to get people to run scripts, and it does not even work where it is needed: execution policy is not a security boundary, and on devices with App Control for Business (WDAC) or AppLocker an unsigned script from Downloads runs in Constrained Language Mode or not at all, whatever `-ExecutionPolicy` says (`learn.microsoft.com/powershell/module/microsoft.powershell.core/about/about_language_modes`).

So the bundle ships only as a **signed** script, which makes signing (Q11) a prerequisite, not a later nicety:

- A GitHub Release with build provenance (`gh attestation`) and an Authenticode signature, its hash recorded in the README at a pinned commit. A hash shown beside a download link on the same origin proves nothing if the origin is compromised, so the page shows the release link and the signature check, not its own hash as evidence.
- The helpdesk deploys it the way it deploys anything (Intune, Company Portal) or runs it for the user. The page explains this to the user and does not offer the file as a bare download.
- **Written for Constrained Language Mode.** Cmdlets from Windows-shipped modules only (`Get-CimInstance`, `Get-WinEvent`, `Get-Counter`, `Copy-Item`, `Compress-Archive`, `Get-FileHash`, `ConvertTo-Json`); no `Add-Type`, no .NET method calls, no `New-Object` outside the allowed types, no classes, so it works in CLM even signed. CLM refuses to import a script file as a module across a trust boundary (`learn.microsoft.com/powershell/scripting/security/app-control/how-app-control-works`), so the release is one signed `.ps1` assembled from the tested module by a script whose output a test compares with the sources. CI checks it two ways: a source test refuses the constructs CLM blocks (`Add-Type`, classes, .NET method calls, `New-Object` of types outside the allowed list), and a Pester test runs the assembled script's functions in a child runspace created with `ConstrainedLanguage` as its language mode, so Pester itself keeps Full Language Mode. If the PSScriptAnalyzer release CI installs offers a CLM rule, it is enabled as well; that is to be checked, not assumed.
- The script refuses to run elevated unless the helpdesk passes the admin switch, so a user does not collect other users' data by accident. The check reads the process's integrity level from `whoami /groups` (the well-known High Mandatory Level label), which works in Constrained Language Mode; the usual `[Security.Principal.WindowsPrincipal]` test does not, since that type is not allowed there.
- **No network calls.** A source test refuses every web cmdlet and alias (`Invoke-WebRequest`, `Invoke-RestMethod`, `iwr`, `curl`, `wget`), `Start-BitsTransfer`, `Test-NetConnection`, any `System.Net` type or `HttpClient` by name or accelerator (a signed script may run in Full Language Mode, where those work), COM objects for HTTP, `Start-Process` or `&` of `curl.exe`, `certutil`, `bitsadmin` or any program outside a short allowlist (`powercfg`, `whoami`), and any `-ComputerName` or `-CimSession` argument.

### 17.6 What the user adds: screenshots, a recording, comments and a rating

Nick, 2026-10-21: "screenshot/screen record/comments/sentiment and system hardware/software inventory/health too if possible with open source/built in tooling/data". Everything here is built into the browser or Windows; nothing is installed and nothing is sent.

- **Screenshot and screen recording, in the page.** A "Show what is happening" button uses the browser's own screen capture (`getDisplayMedia`, after a click, with the browser's picker and its sharing indicator) and `MediaRecorder`. It asks for video only (`audio: false`) and suggests a window rather than the whole screen (`displaySurface: 'window'`), so a user can share just the Windows App window. One frame drawn to a canvas becomes a PNG; up to 2 minutes become a video in whatever container the browser records, chosen with `MediaRecorder.isTypeSupported` (Safari records MP4, Chromium and Firefox WebM) and named by the result. A review step says "this recorded your screen; check it before saving" and shows it, and the file is saved with an ordinary download, never uploaded. The button appears only where `getDisplayMedia` exists (feature detection, not a platform list: support on phones differs by browser and is changing; spike S3 records it); elsewhere the page points to the device's own screenshot. The page's `display-capture` permission needs no policy change, since its default allowlist is the page's own origin. Steps Recorder (`psr.exe`) is not used: Microsoft deprecated it in November 2023 and recommends the Snipping Tool, Xbox Game Bar or Clipchamp (`learn.microsoft.com/windows/whats-new/deprecated-features`). The page names the Snipping Tool as the fallback and says to save into Downloads, because the Snipping Tool autosaves to Pictures\Screenshots, which OneDrive may sync.
- **Comments.** A text box, "What were you doing, and when did it start?", plus the time the problem happened. Comments go only into the log bundle (`comments.txt`), never into the network export, the copied summary or the paste view (section 8.3 is amended to match).
- **How it feels (sentiment).** The user picks it: a five-point "how is your desktop today" scale and symptom chips (slow typing, frozen or blurry screen, Teams audio or video, disconnects, sign-in, printing, slow apps). Sentiment is never inferred from the comment by a model (family rule: a model never decides). The rating and the chips are enumerated values, so they go into the network export and the summary, where a helpdesk can count them across tickets.
- **Accessible.** The rating is a radio group and the chips are checkboxes with labels, both keyboard operable; the recording controls and the review step announce their state to screen readers; the console script's prompts are plain text with numbered choices.
- **Comments are a download.** The page has no storage for them (section 8.1): a "Save comments" button writes `comments.txt` to Downloads, and the page warns before the user leaves with unsaved text.
- **The script picks them up.** No Windows Forms file dialog, which Constrained Language Mode blocks: the script opens an "add files" folder in File Explorer (`Invoke-Item`), the user drops in the screenshots, recordings and `comments.txt` they saved and presses Enter, or passes `-Add <path>`. It never searches the Pictures or Videos folders on its own, warns when an added file came from a OneDrive path, and lists them in the manifest.

### 17.7 Device inventory, health and performance, built in

The collector records what the machine is and how healthy it looks, using only what Windows ships: CIM classes through `Get-CimInstance` (WMIC was removed from Windows 11 24H2 on, `learn.microsoft.com/windows/whats-new/removed-features`), the Storage module and `powercfg`. On the device it describes the endpoint; inside the session it describes the session host. Each row's property allowlist and admin need live in `sources.json`.

| Area | Built-in source | What goes in | Needs admin |
|---|---|---|---|
| Hardware | `Win32_ComputerSystem`, `Win32_Processor`, `Win32_PhysicalMemory`, `Win32_VideoController`, display settings, audio and camera devices from `Win32_PnPEntity` by class | Model, CPU, cores, memory size, GPU and driver version, monitor count and resolution, headset and camera names and driver versions | no |
| Software | `Win32_OperatingSystem`, `Get-HotFix`, the uninstall registry keys (names and versions only), Windows App, Teams and plugin versions | OS edition, build and last update; installed apps list; uptime and pending reboot | no |
| Storage | `Get-PhysicalDisk` (`HealthStatus`: Healthy, Warning, Unhealthy, Unknown), `Get-Volume` | Disk health and free space | unknown (S5) |
| Power | `powercfg /batteryreport` (HTML, laptops), `powercfg /getactivescheme` | Battery wear and the active power plan | unknown (S5) |
| Stability | Reliability Monitor records (`Win32_ReliabilityRecords`) | App crashes and hangs in the time window | unknown (S5) |
| Security posture | `Get-MpComputerStatus` where Microsoft Defender is present | Protection on or off and signature age only | unknown (S5) |
| Performance | `Get-Counter`: processor, memory, disk, network interface; in a session, the per-session RemoteFX and user input delay counters AVD Insights reads | Peaks and averages during the reproduction | no for interactive users (`learn.microsoft.com/windows/win32/perfctrs/limited-user-access-support`), but some counter sets carry their own ACLs |

Counter names are localized, so the script finds counter sets with `Get-Counter -ListSet` and by index rather than by English path, and records a missing set as "not present". Event messages and folder names are localized too; the script matches by event ID, channel and known-folder ID, never by display text.

A `health.json` sums it up as values, not judgments: free disk space, battery wear, uptime, pending reboot, crashes in the window, peaks during the reproduction, each with a plain-language label for the helpdesk and never a verdict on the AVD service. A value becomes a flag only when a cited source gives the line, with its claim ID like every other threshold (repo rule); facts like "a reboot is pending" need no line.

In the browser, the page adds nothing: CPU core counts, memory hints and screen size are fingerprinting material, so they stay in the bundle, which the user hands only to their helpdesk.

### 17.8 Layout, spikes and roadmap

**Moved (Nick, 2026-10-21):** ownership and design moved to avd-current-state's optional local collector ([avd-current-state#40](https://github.com/avd-ops/avd-current-state/pull/40)), but that merged PR contains design only; the implementation and signed release are pending as of 2026-10-25. This repo keeps no `collector/` folder. The earlier layout below is proposed, not built: `collector/Get-AvdLogBundle.ps1`, `collector/AvdLogBundle.psm1` and `collector/sources.json`, with Pester and CLM tests from 17.5. The bundle is independent of the page and could ship first once implementation and signing are settled.

**Spike S5**: on a standard user account, on a Windows 11 device (S5a, free) and on a multi-session host (S5b, a sandbox batch with a cost estimate and Nick's exact go), record which channels, CIM classes, counter sets and `powercfg` reports a non-admin can read, and how `Compress-Archive` behaves on files Windows App and Teams hold open.

### 17.9 Red team (Fable, 2026-10-21)

Eighteen findings, all folded in above:

1. The copyable `-ExecutionPolicy Bypass` command taught the phishing pattern and does not work under App Control: no command to paste, signed releases only, helpdesk deployment (17.5).
2. The script must run in Constrained Language Mode: cmdlets only, one assembled `.ps1`, a CLM analyzer rule and a CLM test in a child runspace (17.5).
3. The Snipping Tool autosaves to Pictures\Screenshots, which OneDrive Known Folder Move syncs: save to Downloads, warn on OneDrive paths (17.6).
4. Safari records MP4, not WebM, and phone support for screen capture is changing: container by `isTypeSupported`, button by feature detection (17.6).
5. A multi-session host's logs hold other users' data and mostly cannot be filtered: said in consent and the manifest; per-channel status; the admin switch is the only complete path (17.2, 17.4).
6. The recording is the most sensitive artifact: video only, window first, a review step, first in the privacy list (17.4, 17.6).
7. Section 8.3 said the page had no free-text field: amended; comments never reach the export, the summary or the paste view.
8. Ctrl+Alt+Shift+1 output differs between the two Learn pages: both patterns, files newer than the script's start (17.2).
9. The new Teams log path made exact; the retired Remote Desktop client's folder marked legacy (17.2).
10. Admin needs were unstated: a column per source, "access denied" recorded, counters by discovery (17.2, 17.7).
11. `Compress-Archive` limits and locked files: staging copy, "locked, skipped", explicit JSON depth (17.3).
12. Downloads can be redirected and sits in the FSLogix container in a session: resolve the known folder, warn, check free space (17.3).
13. A same-origin hash proves nothing: signed release with provenance (17.5).
14. Inventory leaked identity (user name, serials, Defender computer ID): property allowlists with a test (17.4).
15. The no-network test was too narrow: widened (17.5).
16. Steps Recorder and WMIC claims confirmed; the Snipping Tool stays a link.
17. TSS license read: use only to help Microsoft troubleshoot, no distribution; linked, nothing copied (17.2).
18. Prior art: osquery's `osqueryi` runs without a service but is still a third-party binary to install, so it stays a parity checklist. Collection-bundle designs worth comparing before the collector is built: Velociraptor's offline collector (one self-contained collector, zip plus manifest, no upload), CyLR, `sos report` (plugins per source, size caps, an opt-in obfuscation step) and Replicated's `support-bundle` (declarative collectors and redactors). Their licenses are to be read from each license file before anything is reused; the red team gave them from memory.

The code review of the fold-in (Claude code-review skill) caught ten more, also fixed: the Teams hotkey file timing; S5's multi-session half needs a costed sandbox run; 12.4 still published the script on the page; .NET web clients and outside programs were missing from the no-network test; the Windows Forms file dialog and the usual elevation check fail in CLM; CLM testing moved to a child runspace; the CSP needed `blob:` for the review step; the export list and Q11 now name the rating; comments are a download, not storage; health values carry no uncited thresholds.

Also added from its "missing" list: platforms beyond Windows (17.1), accessibility (17.6), localization (17.7), retention and a helpdesk note (17.3), and a budget table (17.3).

## 18. Guided steps: screenshots and animations for what the page cannot do (proposed)

Nick, 2026-10-21: "i want the page to have every step with screenshots and/or animations for things people need to do if possible if we cant make it part of the app reliably". Context the same day: users connect from every kind of device, so a Store app or a device script cannot be the main path; the web page is. Not yet red-teamed; the code review on PR #4 changed: a demo sign-in domain of its own (18.4), session captures costed like any sandbox batch (18.4), step pages with their own CSP (18.3), callouts beside the image rather than over it (18.5), freshness from the shipped manifest (18.6), the choice kept in the URL only (18.2), device-only steps in v0 (18.9), and a retired-client answer with no screenshots (18.2).

### 18.1 What becomes a guided step

A step is a guide when the page cannot do it reliably itself, on the user's device, without installing anything. The first set, each tied to the finding or section that sends the user there:

| Step | Why the page cannot do it | Sent from |
|---|---|---|
| Find the transport and round trip in the Windows App's connection information | Only the client knows the real session (4.6) | The UDP hint and the round-trip findings (6.2, 6.3) |
| Turn on and collect Windows App logs, per platform (Windows, macOS, iOS and iPadOS, Android, web) | Logs live inside the app or its folders (17.1) | "Your helpdesk asked for logs" and the log bundle (17) |
| Save a Teams diagnostic file in the session (Ctrl+Alt+Shift+1) and find it in Downloads | Inside the remote session, out of the page's reach (17.2) | Teams symptom chip (17.6) |
| Run `avdnettest.exe` on Windows | A downloaded Microsoft tool (6.3) | The UDP hint |
| Take a screenshot or a recording with the device's own tools, and save it to Downloads | Screen capture is missing in some browsers, and the Snipping Tool saves to a synced folder (17.6) | The capture button where `getDisplayMedia` is absent |
| Capture logs in the web client and in the multimedia redirection extension | Their own buttons (17.2) | The web client and video symptoms |
| Close Windows App before collecting, or open the remote session to run the in-session half | The page cannot control another app (17.3) | The log bundle |

Every step page follows one shape: a title naming the outcome ("Find your connection details"), numbered actions with **one action per number**, a still image per action where it helps, an optional short animation for an action that is about motion or timing (a key chord, a drag), a "what you should see" line, a "done" check, and a link to Microsoft's own page for that step, cited at its pin with the date it was last checked.

### 18.2 Picking the right steps for the device

The page detects the platform and asks for the rest:

- **Platform** from User-Agent Client Hints (`navigator.userAgentData.platform`, Chromium) with the user agent string as the fallback: Windows, macOS, iOS and iPadOS, Android, ChromeOS, Linux. iPadOS Safari reports itself as a Mac, so a Mac report with touch points (`navigator.maxTouchPoints > 1`) is offered as "iPad or Mac?".
- **Client** cannot be detected from a web page, so the page asks once, "Which app do you use to connect?", with the detected platform's likely answer first: Windows App, the retired Remote Desktop client (which leads to "move to Windows App" and Microsoft's own page, with no screenshots of a retired client), a web browser, a thin client's own app ("ask your helpdesk; the in-session steps still work"), or "I don't know" (which shows how to tell).
- **Where you are**: on the device or inside the remote session. The in-session steps (Teams) are offered after "I am in my remote desktop" on the step chooser, or from the bundle if Q11 keeps one. Step pages are help pages, not the check, so opening one inside the session is expected; the check's "run this on your own device" line (4.2) applies to the check only.
- A wrong guess costs one tap: every step page carries a "Not your device?" switch. The choice lives only in the step page's URL (`?platform=` and `?client=`, each checked against a fixed list, anything else ignored), so a helpdesk can send a link to the right steps; nothing is stored in the browser and nothing is exported beyond the coarse platform already in 8.3.

### 18.3 What the assets are

- **Stills:** a clean, unedited screenshot of the real Microsoft UI per action, resized only (18.5 says why), in WebP with a PNG fallback, at most 150 KB each, both a light-theme and a dark-theme capture where the client has both.
- **Callouts as an overlay, never baked in:** numbered markers and labels are SVG drawn by the page on the image's margin, pointing in (18.5 explains why not over it), using the design system's tokens (`--accent` for markers, `--focus` for the ring, the display font for labels). Text stays text, so it is translatable, readable by screen readers, recolored for dark mode, and the screenshot itself stays unaltered.
- **Animations:** the default "animation" is the still sequence stepping through its markers with CSS transitions, which is small, accessible and needs no recording. A real screen recording is used only where motion is the point, as a short muted video (under 15 seconds, at most 1 MB, MP4 H.264 with a WebM alternative, a poster frame, controls, no autoplay with sound). No animated GIFs: they cannot be paused by the page and are large.
- **Motion rules:** `prefers-reduced-motion` shows the stills only; any motion longer than 5 seconds has a pause control (WCAG 2.2.2); nothing flashes.
- **Loading and policy:** step assets load only when a step is opened (`loading="lazy"`, no preload), from the site's own origin (L7). Step pages carry their own meta policy, `default-src 'none'; script-src 'self'; style-src 'self'; font-src 'self'; img-src 'self'; media-src 'self'; connect-src 'self'; base-uri 'none'; form-action 'none'`: no probe hosts, since they measure nothing, and a test checks every page under `steps/` has exactly that policy. The check page's own policy (8.2) is unchanged by them.

### 18.4 How they are made

- **Only from a lab identity.** Captures come from the personal sandbox tenant with a dedicated demo user and fictitious display names, on a device with no notifications, no other apps visible and a plain wallpaper. Because a screenshot may not be altered (18.5), nothing can be blurred out afterward: anything that would show a real tenant name, domain, user name, email, IP address, host pool or machine name, a profile photo or another product's content means **recapture**, not edit. Windows App shows the signed-in account's sign-in name, so the tenant's own domains must never be on the demo account: the demo user signs in with a name under `avd-ops.party`, a domain Nick bought for the demo and sandbox environment only (2026-10-21), added to the sandbox tenant as a verified custom domain (one DNS record and Nick's go), with a neutral display name. Keeping it apart from avd-ops.dev means nothing that attracts attacks shares the site's domain. Any screen that still shows the tenant's initial `onmicrosoft.com` name or the sandbox's own domain cannot be used, and that step stays text-only with a link to Microsoft's page.
- **The demo account is an extra-protected account** (Nick, 2026-10-21), because its sign-in name is published in every screenshot and will attract password sprays:
  - **Off by default.** The account is disabled except during a capture session; the capture checklist starts with enabling it and ends with disabling it and revoking its sessions.
  - **No password to steal.** It signs in with a phishing-resistant method only (a passkey or Windows Hello for Business), enforced by a Conditional Access authentication strength. Its password is long, random, never written down, and unusable for sign-in.
  - **Fenced in.** Conditional Access limits it to the demo AVD apps from the capture device (a device filter or a compliant device, once Nick names the device) and blocks everything else. Sign-in frequency is **every time** on the Windows Cloud Login app and **1 hour** on the Azure Virtual Desktop app, because Learn supports every time only on Windows Cloud Login and it causes constant prompts on the AVD app's feed refresh (`learn.microsoft.com/azure/virtual-desktop/set-up-mfa`, "Configure sign-in frequency"). It holds no admin role, no mailbox and one AVD-eligible license that includes Entra ID P1 (a spare seat, or a recurring purchase Nick makes himself), and it is assigned only to a demo host pool that holds no data, with drive and clipboard redirection off.
  - **Only one admin can change it.** It sits in a restricted management administrative unit, so tenant-wide admins other than Nick's own admin account cannot reset its credentials or change its groups.
  - **Watched.** An alert fires on any sign-in or attempt while it is disabled or outside a capture session; Where the tenant has only Entra ID P1 (likely in the sandbox), ID Protection's risk policies are not available, so the watch is a log search alert over the interactive sign-in logs in Log Analytics for any sign-in under the demo domain, checked every 15 minutes (about $0.50 a month, recurring, on Nick's go); with P2, the user risk policy also blocks it on high risk.
  - Conditional Access and administrative units need Entra ID P1, and ID Protection's risk policies need P2; the capture plan records which the sandbox tenant has before relying on them. The tenant work itself (domain, user `demo@` the demo domain with display name "Demo User", policies, alert) is planned and run from the private sandbox repo, never here. A separate canary account under the same domain, with sign-ins blocked and an alert on every attempt, belongs to the family's security work, not this repo.
- **Who captures:** steps on the device alone (screenshots, saving to Downloads, `avdnettest.exe`) need no cloud. Anything showing a connection or the inside of a session (connection information, Teams, the in-session half) needs a running host pool in the sandbox, which bills by the hour, so every such capture session is a sandbox batch with a written cost estimate and Nick's exact go, torn down after, or rides on a batch he already approved. Within that, two options (Q12): Nick captures by hand on his own devices from a checklist the repo provides, or a scripted capture on a sandbox VM covers the Windows and web parts (Playwright for the web client).
- **Our own captures only.** Microsoft Learn's illustrated steps are linked from every step page, never copied, even where a documentation repository's license would allow reuse (the azure-docs repository's content is CC BY 4.0, read 2026-10-21): one source of images, one review path, and no mixed licenses in the folder.
- **Review before merge:** every new or changed asset gets a reviewer checklist in the PR (lab identity only, no real names or addresses, no notifications or third-party content, no individual's image, released product only, not altered beyond resizing), and a test checks each manifest entry has `reviewed: true` with the reviewer and date. The build strips image metadata (EXIF and PNG text chunks) and a test refuses files that still carry any.

### 18.5 Microsoft's screenshot terms, and where steps may appear

Microsoft's permissions page (`microsoft.com/en-us/legal/intellectualproperty/permissions`, "Screenshots", read 2026-10-21) allows screenshots in documentation, tutorials, videos and websites, on conditions that shape this section: **do not alter a screenshot except to resize it; do not use portions of screenshots; do not put screenshots in your product's user interface; no third-party content; no identifiable individual;** and no splash screens or unreleased or beta products. So:

- **No crops, masks or annotations on the image.** Full window captures, resized only. Callouts are drawn by the page **around** the image, not over it: numbered markers on its margin that point in, matched by the numbered text, with no dimming or boxes on the screenshot itself. The image file and its rendering stay exactly as captured.
- **Steps are documentation, not the tool's interface.** Guided steps are help pages in a documentation layout (`steps/`): the family shell's bar, notice and footer like any docs page, no check controls, no results, reachable by a plain URL and from the README. The check links to them from a finding and opens them as ordinary pages; the check's own screens show text and the design system's own drawings only, never a Microsoft screenshot.
- **Released clients only.** No Insider, preview or beta builds in any capture; each asset records the client version it shows.
- The page's footer already carries the family trademarks line; step pages add that the screenshots show Microsoft products and are used under Microsoft's published permissions, with no endorsement implied.

This is our reading of the terms, not legal advice; where a step's fit is in doubt, the step stays text-only and links Microsoft's own illustrated page. The terms are Microsoft's to change; the review checklist links them, and a change is a reason to re-review every asset.

### 18.6 Kept current

`site/steps/steps.json` is the manifest: per step, its platform and client, the actions, each asset with alt text, size, theme, client version, `checkedAt`, `reviewed`, and the Learn page it follows with its pin (through avd-assess where a reference exists). A test fails on a missing file, missing alt text, an asset over budget, or an unreviewed entry. Each step has one `checkedAt` (the oldest of its assets' dates). A scheduled job (read-only, like the family's KB freshness check) compares each Learn pin with the page's current `updated_at` and opens one issue listing the steps whose source moved; the PR that answers it sets `sourceChangedAt` on those steps in `steps.json` until they are rechecked. A step page reads only the shipped manifest, so it shows "these pictures may be out of date; the written steps were checked on <date>" when `sourceChangedAt` is set or `checkedAt` is more than 180 days old, and the text, which is the step, stays usable while images wait for recapture.

### 18.7 Accessibility and plain language

The numbered text is the step and works with images off; images illustrate it. Alt text says what the picture shows and what to do ("The Connection information window, with Transport: UDP highlighted"). Callout labels are real text; the overlay is announced; the step sequence is keyboard operable; images scale to the 390-pixel layout and open full size on tap; nothing relies on color alone (the voice rule: results carry a word). Each step stays at the reading level of 12.4 and names buttons exactly as the client shows them, in the client's own words.

### 18.8 Brand and where the files live

Step pages use the avd-ops brand profile (`brand/profile.json` in avd-ops, design system `ds-v2.7.0`, vendored at the tag with its lock file per decision 0005, alongside the shared portal engine `pe-v1.1.0` in `site/assets/engine/`): the shell's notice line before the first section, the "A prignano.ai production" credit and the trademarks line in the footer, colors only through tokens, self-hosted fonts, 44-pixel touch targets, light and dark both designed. The family logo is used as the files provide it and never on or inside a screenshot.

Files: `site/steps/<platform>/<client>/<step>/` holding the images, videos and SVG overlays, and `site/steps/steps.json`. Our own captures and overlays are covered by the repository's MIT license as far as our work goes; the Microsoft UI in them remains Microsoft's and is used under its terms (18.5); nothing in the folder is copied from Microsoft's documentation. None of this is published on avd-ops.dev until Nick lists the tool.

### 18.9 Roadmap fit

v0 carries only device-side steps that need no AVD and no cloud (device screenshots and recordings, saving to Downloads), for Windows and macOS; v1 adds the per-client AVD set (connection information, Windows App logs, Teams) beside the AVD pack, after Q12 and a costed capture batch; the log-bundle steps follow whatever Q11 settles. Open choices for Nick are Q12.

**Implementation note (Nick, 2026-10-25):** the initial v0/v1 implementation uses text-first guides with official source links and no media assets. This keeps the guides usable while capture assets are absent; it does not authorize a sandbox capture batch or settle the future media-capture workflow.
