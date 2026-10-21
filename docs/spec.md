# avd-linecheck: a one-button network check for virtual desktop users

Status: proposed, design only (Nick, 2026-10-21: "Spec a small open-source, browser-based network diagnostic page for end users of virtual desktops (AVD first, but useful to anyone). Spec only, no build yet."). Nothing here is built. Red-teamed with Fable before this version (section 14). The open questions Nick has to answer are in section 15. Name and home decided by Nick on 2026-10-21: `avd-ops/avd-linecheck`, public, MIT; the spec moved here from avd-ops PR #29. Full log collection added the same day (section 17).

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

The method avd-landing-zone's portal already uses for its region step and its reachability probe (`site/portal/portal-page.js`, `measure()` and `timeOnce()`): one warm-up request to pay for DNS, TCP and TLS, then N timed `fetch` calls with `mode: 'no-cors'`, `cache: 'no-store'`, `credentials: 'omit'`, `referrerPolicy: 'no-referrer'`, a cache-busting query, a per-request timeout, and the median. The portal uses 5 samples and a 4-second timeout and stops a host at the first rejected warm-up; this page uses 8 samples so jitter has something to work with, keeps the timeout and the short circuit, sends `method: 'HEAD'` (allowed under `no-cors`) so the answer carries no body, and sets `redirect: 'manual'`, so a host that answers with a redirect (the shorteners `aka.ms` and `go.microsoft.com` always do, sign-in hosts often do) resolves as an `opaqueredirect` instead of being followed off-host, where the page's `connect-src` would reject the hop and a healthy line would read as blocked.

- **What a sample is.** The time from just before `fetch` to the promise settling, read with `performance.now()` exactly as the portal's `timeOnce()` does. It is the **time to complete one small HTTPS request**: after the warm-up it is usually one round trip plus the server's own time, but nothing guarantees connection reuse (browsers open fresh connections, servers close idle ones, HTTP/2 coalescing differs by host) and a followed redirect would add round trips (which is one more reason for `redirect: 'manual'`). So the page reports it as an **upper bound** on the round trip ("your round trip is at most N ms"), never as the round trip. Resource Timing is not used for samples: its `duration` runs to `responseEnd` and its default buffer holds 250 entries, fewer than a run makes.
- **Latency** = median of the samples. **Jitter** = median absolute difference between consecutive samples (7 differences from 8 samples), which is how LibreSpeed defines it; it is not RFC 3550 inter-arrival jitter, which smooths timestamped packets. Both are whole milliseconds.
- **Stalls** = samples that hit the timeout, reported as a count and never as packet loss (section 4.6). Samples over three times the median are counted as "slow samples", an uncited heuristic, informational only.
- **Clock resolution differs by engine.** Chrome coarsens `performance.now()` to 100 microseconds in a normal page and 5 in a cross-origin isolated one (MDN); Firefox's default timer precision reduction is 1 ms and WebKit coarsens too (exact current values to be recorded per browser in spike S3). A jitter of 1 or 2 ms on those engines is quantization, so jitter is reported with a floor ("under 2 ms").
- **What a `no-cors` request can and cannot tell.** It can use GET, HEAD or POST and CORS-safelisted headers only; the response is opaque (no status, no headers, no body). A resolved promise means DNS, a connection, TLS and some HTTP answer; a rejection means DNS failure, a TLS failure (including inspection with an untrusted certificate), a TCP block, a content blocker or the timeout. A proxy's own block page resolves too, so "reached" means "something at that name answered on 443" (L8).
- **Where the time goes.** Microsoft's front doors answer close to the user, so a time to `login.microsoftonline.com` is to the nearest edge, not to the session host's region. The page says so, in the same words avd-landing-zone uses (`REACHABILITY_LIMITS`). Through a corporate proxy, VPN or secure web gateway the sample measures that path, and the verdict sentence says so when the page can tell (section 6.6) and the "not tested" list says so always.
- **Spike S1 compares the HTTPS sample with a real round trip** (`avdnettest.exe` or a ping from the same device) on three networks before any sentence calls it "a proxy for the round trip".

### 4.2 Region latency

Reuse the portal's list of regional endpoints (`<region>.api.cognitive.microsoft.com`, each checked in DNS to resolve in its own region, avd-landing-zone decision 0003) and its method. The page ranks the regions the pack lists and, when the link carries `?region=<name>`, judges that region against the round-trip bands (section 6.2). A helpdesk pre-fills the link with the host pool's region so the user never has to know it. The page ranks the target region's geography (the portal's groups: Americas, Europe, Asia Pacific, Middle East and Africa), 12 regions at most, not all 38, to keep the run short (section 5).

**Vantage check.** A user whose desktop is slow will often open the link inside the remote session, and the page would then measure the session host's network. Under the button: "Run this on your own device, not inside the remote desktop." After the run, a best-effort detection (one region under 5 ms with the rest ranked as from inside Azure; the user agent is no help, since browsers on Windows Server send the same string as Windows 11) turns the result into "this looks like it ran inside the desktop; the result is not about your network", and the export carries `vantage: device | likely-session-host | unknown`.

### 4.3 Reachability of required endpoints

Same method, against concrete hostnames from a pack. Wildcards cannot be probed by name; the AVD pack's hosts and the rule for choosing them are in section 6.1.

### 4.4 Download throughput: sufficiency, not maximum

The question a desktop user needs answered is "is there enough?", not "how fast is my line?". Microsoft publishes per-user bandwidth estimates by activity for one 1080p monitor, from idle to full-screen video (`ref:rdp-bandwidth#per-scenario-estimates`), and says the best way to know is to monitor real users (`ref:rdp-bandwidth#monitor-real-users`). Those numbers are a few megabits per second at most, so the page downloads one fixed blob of random bytes from its own origin (same-origin, so every `PerformanceResourceTiming` field is readable, `transferSize` included), times it, and reports **"at least N Mbit/s"** with N capped at the blob's size over the shortest interval worth trusting (an 8 MiB blob in one second says "at least 67 Mbit/s", 8 x 1,048,576 x 8 bits, and the page stops there). This keeps the page honest on a fast line, keeps static hosting's bandwidth bill small (section 9), and avoids reinventing LibreSpeed and OpenSpeedTest, which exist to find the maximum (section 11).

The blob is fetched with `cache: 'default'` and no cache-buster, because `cache: 'no-store'` also adds `Cache-Control: no-cache` to the request and a CDN that honors it would go to origin on every run; the blob's file name carries its hash, so a stale copy cannot be served. The reading is edge-to-user, not the AVD path, and the sentence says so. The pack carries no "needed" figure in v0 and v1: Microsoft's per-scenario estimates are a table on Learn, and restating one number would copy it (L4). The finding is informational, "at least N Mbit/s", until a cited need exists (Q7).

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

**Proposal: one probe map, read by all three.** A data file that holds, per entry: the host or range, port, protocol, purpose, the claim it comes from (`ref:avd-required-fqdn#client-list` or `#host-list`), the Learn pin it was read at, and `probeFrom: [browser, host, cloudshell]`. Wildcards appear as wildcards with `probeFrom: []`; concrete names appear only when Learn lists them by name at the pin. Where it lives is Q6, and the choice is not settled:

- **(a) With the implementer, in avd-current-state** (working path `assess/client-endpoints.json`), each row citing the pin; avd-assess keeps only the dimension row `network.client` and a line in `gaps/client-network.md` saying the list is read at the pin. This respects avd-assess's two rules, "methodology only, no tools" and "never copy the tables": a list of concrete hostnames with a `probeFrom` field is tooling data and a subset of Learn's table. The landing zone's portal and this page vendor it at a commit, the way the landing zone vendors contracts (`contracts/PINS.json`).
- **(b) In avd-assess**, which would need its rule changed to allow a probe map as a map row with a citation.

The spec recommends (a). Either way it answers #28's first proposal and gives the AVD pack a source this page does not own.

Hostnames below are Microsoft's published endpoints, the same for everyone, and the landing zone's portal already carries two of them; no address range is restated here (guardrails: cite the pin). From the end-user list at the pin, the browser-probeable rows are: `login.microsoftonline.com`, `windows.cloud.microsoft`, `windows365.microsoft.com`, `graph.microsoft.com`, `ecs.office.com`, `go.microsoft.com`, `aka.ms`, `learn.microsoft.com`, `privacy.microsoft.com` (all TCP 443), and the certificate hosts on TCP 80 (`www.microsoft.com`, `azcsprodeusaikpublish.blob.core.windows.net`), which a page served over HTTPS cannot fetch over plain HTTP (mixed content), so they get `probeFrom: [host, cloudshell]`. The ones the pack marks **required** for the verdict are sign-in and the connection center (`login.microsoftonline.com`, `windows.cloud.microsoft`), as the portal does; the rest are **informational**, because a failure there does not stop a connection and would make a warning out of noise (avd-landing-zone verify-access spec, section 5.2).

`*.wvd.microsoft.com` (feed, broker, gateway) is the wildcard that matters and has no concrete name at the pin. The older names `rdweb`, `rdbroker` and `rdgateway.wvd.microsoft.com` still answer (avd-current-state probes them), but Learn no longer lists them. Open question Q5: probe them as "informational, not in Learn's current list", or leave them out. The spec proposes to leave them out until spike S2 shows what they return.

**Clouds.** The AVD pack is the Azure public cloud. Azure for US Government has its own end-user list (`login.microsoftonline.us`, `*.wvd.azure.us`) and STUN without TURN (`ref:configure-rdp-shortpath#turn-public-cloud-only`); a pack per cloud is the extension point, not a switch inside one pack.

### 6.2 Round-trip thresholds

Three published bands, all cited rather than restated:

| Claim | Says |
|---|---|
| `ref:avd-prerequisites#rtt-under-150` | Round trip from the client's network to the host pool's region should be under 150 ms |
| `ref:avd-insights-use-cases#rtt-ideal-100-poor-200` | Below 100 ms for ideal interaction; broadly low quality over 200 ms |
| `ref:avd-connection-quality#rtt-bands` | Up to 150 ms fine for work without rendering or video; 150 to 200 ms fine for text; over 200 ms may affect the experience |

Pack thresholds for the target region, applied to the upper-bound sample of 4.1: **pass** under 100 ms, **warn** 100 to 150 ms ("usable", the prerequisite's target met), **warn** 150 to 200 ms ("fine for text; video and rendering may lag"), **fail** over 200 ms ("likely to affect the experience; if a proxy or VPN carries this traffic, this is about that path"). The portal's `rateLatency` is <100 Good, <=150 Usable, >150 Sluggish: its job is to rank regions against each other, this page's is to judge one region against the bands, so the two differ at 150 to 200 ms. Q8 proposes the portal take these bands when it vendors the engine. Jitter has no published AVD band and no AVD table reports it (`methods/remote-protocols.md` item 8), so jitter is **informational** with a sentence, never a verdict. The HTTPS sample is at most the round trip, and the sentence says "at most".

**Finding states and the overall verdict.** Every finding is one of four states; the overall verdict is the worst state among findings the pack marks required, and informational findings never move it.

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

The page cannot see a proxy. It can notice two things and say them as caveats, never as findings: every probed host answering with nearly the same time (one hop answers for all), and a region ranking whose nearest region sits in another geography than the browser's language and time zone suggest (coarse, never stored). Both produce the sentence "a proxy, VPN or security agent may be carrying this traffic; the result is about that path", with the Microsoft guidance cited (`ref:avd-proxy#bypass-proxies`, `ref:rdp-traffic-optimization#bypass-tunnels`).

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
    {"below": 200, "state": "warn", "claim": "ref:avd-connection-quality#rtt-bands"},
    {"above": 200, "state": "fail", "claim": "ref:avd-connection-quality#rtt-bands"}]},
  "download": {"path": "blobs/8m.bin", "bytes": 8388608, "need": null, "claim": "ref:rdp-bandwidth#monitor-real-users"},
  "stun": [],
  "text": {"limits": "...", "next": {"windows": "...", "admin": "..."}}
}
```

Rules: hosts must be public names on 443 (the validator refuses IP literals, private ranges, localhost, and plain `http:`); every threshold carries at least one claim ID; `stun` is empty or exactly two endpoints; a pack's hosts are the only cross-origin `connect-src` entries in the page's CSP, generated from the pack at build time and checked by a test (section 8.2). A pack is loaded only from the page's own origin, so "a custom pack" means a fork, and the README says so. A second pack, `generic.json`, ships with no hosts but the page's own origin and no thresholds beyond "reached or not", so the tool is useful to anyone on day one.

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

Strict: `default-src 'none'; script-src 'self'; style-src 'self'; font-src 'self'; img-src 'self' data:; connect-src 'self' <pack hosts> <regional endpoints>; base-uri 'none'; form-action 'none'; webrtc 'block'` (v1), `webrtc 'allow'` only in a build whose pack names a STUN server. No inline script or style anywhere: the page's own CSS is a linked stylesheet (the portal keeps a `<style>` block, which this page does not), and the result bars are sized through the CSSOM (`el.style.setProperty`, which `style-src 'self'` allows) rather than the portal's `style="width:..."` strings; the no-inline-style test checks both. The `<meta>` policy precedes every script, `theme.js` in `<head>` included. On GitHub Pages the policy is a `<meta http-equiv>` element, which cannot carry `frame-ancestors`, `report-uri` or `sandbox`; on Cloudflare Pages a `_headers` file delivers it as a real header with `frame-ancestors 'none'` added (section 9). A test rebuilds the `connect-src` from the pack and fails on a mismatch, so a host cannot be probed unless it is also in the policy, and the other way round.

### 8.3 What the export holds, and what it never holds

The export (JSON, and the summary rendered from it) holds: schema version, tool version, pack id and version, the date and time rounded to the minute, browser family and major version, coarse platform (desktop, tablet, phone), the region parameter if the link had one, and per check: id, status, value, unit, threshold, claim IDs, and the sentence. Overall verdict and the "not tested" list.

It reveals one thing a helpdesk should know about: the region ranking and the browser's platform locate the user to roughly a city. That is fine in a ticket and a disclosure in a public issue, so the share panel's default keeps the top three regions only and a "full" toggle keeps all of them; the summary text says which it is.

It never holds: an IP address (the WebRTC reflexive address is compared and dropped; `no-cors` responses carry none), a hostname of the user's device, a user name or UPN, a tenant name or ID, workspace or host pool IDs, geolocation (the page never asks for it), a full user agent string, or anything typed into the page. The page has no free-text field. A test feeds the exporter fixtures with every one of those values present in the raw measurements and asserts they are absent from the output; a redaction pattern list in the repo mirrors avd-landing-zone's portal report redaction (decision 0008) for the day a free-text field appears.

**What an admin can still leak.** A custom pack is the one place a tenant name can enter: a private feed host or a company proxy name typed into `hosts`. The pack validator warns on hosts outside the suffixes the AVD pack cites (`microsoft.com`, `microsoftonline.com`, `cloud.microsoft`, `windows.net`, `office.com`, `aka.ms`; the list lives in the schema), and the export marks results from such a pack `custom: true` so a helpdesk knows the file names the organization's own hosts before pasting it anywhere public. Results shared in a public issue should come from the shipped packs only; the README says so.

### 8.4 Abuse and safety

- The probe targets are fixed by the pack on the page's origin; the link cannot add hosts. The only parameters are `?region=`, validated against the pack's region list, and `?lite`, a flag; anything else is ignored. The page is not a scanner.
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

Proposal: **GitHub Pages for v0 and v1**, with the blob at 8 MiB, served from the edge cache (no cache-buster on the blob), and the download step skipped by `?lite`, which is the default link the helpdesk builder hands out; the full run is one click more. **Cloudflare Pages when the server probe arrives**, or sooner if the Pages terms or the soft limit become a problem, because the probe is a Worker anyway and a real CSP header is better than a meta tag. Nothing in the page depends on which host serves it; a test checks the page has no absolute URL to its own origin.

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
| **avd-landing-zone region latency test and reachability probe** (`site/portal/`, decisions 0003 and 0014) | MIT, ours | Browser latency to regional endpoints with warm-up, `no-cors`, median; two-host reachability with fail-closed classification and honest limits text | The whole method, the region list, `rateLatency` bands, `classifyReachability`'s shape and the limits wording. Ours, same family | **Reuse as the engine's core.** The new tool owns the engine; the portal keeps its copy until it vendors the tool's module at a pin (Q8) |
| **avd-current-state `Test-AvdEndpoints`** | MIT, ours | TCP socket probe of eight hosts from wherever the validator runs; reports WARN off-host | The purpose strings and the lesson that an off-host probe is unknown, not pass (#28) | Share the endpoint map (6.1); different vantage, different tool |
| [LibreSpeed](https://github.com/librespeed/speedtest) | LGPL-3.0 | Self-hosted maximum-throughput test: XHR and Web Workers, download, upload, ping, jitter; PHP backend (Go and Rust ports); optional telemetry and result sharing | The jitter definition and the idea of a separate stability test. Code stays out: LGPL into an MIT repo is not a copy we make | Prior art and parity checklist for the measurement vocabulary |
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

Repo `avd-ops/avd-linecheck`, page at `avd-ops.github.io/avd-linecheck/` first, a subdomain of avd-ops.dev later if Nick wants one (Q3).

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
  collector/            the log bundle script, offered as a download (section 17)
  assets/               vendored design system at a tag + lock file
collector/              Get-AvdLogBundle.ps1, AvdLogBundle.psm1, sources.json (section 17.6)
docs/
  spec.md (this file, moved)  decisions/  privacy.md
tests/                  node --test: verdict and export fixtures, pack <-> CSP, disclaimer,
                        no-third-party-URL, no-inline-script, scrub, paste-a-result parsing;
                        Pester for the collector
.github/workflows/      ci.yml (tests, html validation, link check), pages.yml
```

No build step for the page itself: plain HTML, CSS and JavaScript, as the portals are, so a fork can be hosted by copying `site/`.

**Accessibility and plain language.** WCAG 2.1 AA as the target: color is never the only signal (each state has a word and an icon), the progress bar is a live region that announces the step, every control meets the shell's 44 px touch size, and the page works without JavaScript to the extent of showing the notice and the "needs JavaScript" line. Verdict sentences are written for a reader who did not choose the desktop and does not know what a gateway is: one finding, one sentence, one next step, checked against a reading-level target in a test (a word list, not a model).

### 12.5 Roadmap

| Version | Delivers | Needs |
|---|---|---|
| **v0, static page** | The run (section 5) with the generic pack: reachability of the page's own origin and any hosts in the pack, region ranking, download sufficiency with loaded latency, jitter and stalls, verdict, JSON and summary export, paste-a-result, phone layout, the shell | Spikes S1 to S4; the repo; the design system at a tag |
| **v1, AVD checks** | The AVD pack from the shared probe map (Q6), cited thresholds, `?region=` from a helpdesk link, the Shortpath facts and the Windows `avdnettest.exe` pointer, the intake-shaped export (6.5); the landing zone's portal links the page from its region and verify steps | The probe map (Q6); avd-current-state #28 aligned; Q5 answered |
| **Log bundle** | The device and in-session collector, zip to Downloads, manifest, no upload (section 17) | Q11; Pester against a synthetic profile tree |
| **v2, server probe**, in pieces (v2a to v2d) | Echo with full timing and upload on a Worker first; then STUN and TURN with loss and NAT type; then WebTransport datagrams; Cloudflare Pages with a real CSP; Globalping outside-in last, if at all | A cost estimate and Nick's exact go for each piece that runs; Q4, Q7, Q9 |

Parked, not planned: history and trends (that is a monitoring product), a native app, anything that signs in.

## 13. Spikes before v0 (offline or free, no cloud run)

| # | Question | How |
|---|---|---|
| S1 | How far is the HTTPS sample from a real round trip, and can `@cloudflare/speedtest` run against our own origin with zero requests to Cloudflare and no result upload? Read every outside license file at a pinned release | A local page beside `avdnettest.exe` or a ping, three networks; the library's source at a pinned release with the network panel open |
| S2 | Which `*.wvd.microsoft.com` names answer today, and with what? | `curl -sI` from a laptop, not from Azure, recorded with the date |
| S3 | Timer granularity and `getStats()` exposure per engine (Chrome, Firefox, Safari on desktop and iPhone) | A local page that records `performance.now()` deltas and ICE candidate fields |
| S4 | Does an 8 MiB blob from GitHub Pages give a stable sufficiency reading on phone Safari and desktop browsers, cold and warm edge? | A test page on a Pages branch of a scratch repo |

None of these touches a tenant or costs money.

## 14. Red team

Reviewed by Fable (claude-fable-5-1) on 2026-10-21 before this version. Findings and what changed: section 14.1 is filled in from the review. Section 17 (the log bundle) was added after the review and has not been red-teamed yet.

### 14.1 Findings folded in

Twenty findings; all folded in, none rejected.

1. The sample is the portal's `performance.now()` wrapper, not Resource Timing (buffer of 250, `duration` runs to `responseEnd`); named "time to complete one small HTTPS request" (4.1).
2. No guarantee of connection reuse and silent redirects: `HEAD`, reported as an upper bound on the round trip, "at most N ms" (4.1, 6.2), with S1 comparing it to a real round trip.
3. Jitter is the median absolute successive difference, LibreSpeed's definition, not RFC 3550; the 3x stall multiplier is an uncited heuristic, informational (4.1).
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

From the code review of the PR, folded in as well: `redirect: 'manual'` so redirecting hosts are not misread as blocked by the CSP; `?lite` named in 8.4; the user agent dropped from the vantage check (Windows Server browsers send the client string); the target region sampled serially for the verdict; thresholds as a list of cut lines each with a claim; `cache: 'default'` for the blob (`no-store` adds `Cache-Control: no-cache`); the `webrtc` directive is Firefox-only; 67, not 64 Mbit/s; the relay range cited at the pin instead of restated.

Also added from the review's "missing" list: accessibility and plain-language targets (12.4), proxies and tunnels as caveats (6.6), and v2 split into four separately costed pieces (10).

## 15. Open questions for Nick

1. **Name.** Answered 2026-10-21: avd-linecheck (12.3).
2. **Home.** Answered 2026-10-21: `avd-ops/avd-linecheck`, public, MIT (12.2).
3. **Hosting.** GitHub Pages first with an 8 MiB blob and a `?lite` link (recommended), or Cloudflare Pages from the start for the real CSP header (section 9).
4. **UDP hint.** v1 without it and v2 with the probe's own STUN on two ports (recommended), public STUN servers behind an opt-in, or try Microsoft's relay range (6.3).
5. **Unlisted names.** Leave `rdweb`, `rdbroker` and `rdgateway.wvd.microsoft.com` out until spike S2 (recommended), or probe them as informational (6.1).
6. **One endpoint map**: in avd-current-state with each row citing the Learn pin (recommended), or in avd-assess with its "no tools, no copied tables" rule changed; and who pins it (6.1, avd-current-state #28).
7. **Adopt or build the engine's throughput and loss parts**: adopt `@cloudflare/speedtest` only if spike S1 shows its no-server path runs with zero contact to Cloudflare, otherwise write the two functions here (section 11). Also whether a cited "enough bandwidth" figure should exist at all, or sufficiency stays informational (4.4).
8. **The landing zone's portal**: link to the page from its region and verify steps and vendor the engine later (recommended), or keep its own copy forever (6.2).
9. **v2 pieces.** Which of echo and sink (v2a), STUN and TURN (v2b), WebTransport (v2c) and Globalping outside-in (v2d) are worth their cost line, and in what order (section 10).
10. **Go for the spikes.** They are offline or free; no tenant and no spend.
11. **Log bundle** (section 17): Windows script for the device and the session first, with macOS and mobile pointed at Microsoft's in-app steps (recommended); before or after the page's v0; Downloads as the destination (recommended over Documents, which OneDrive may sync); and whether to sign the script later, which needs a certificate and a cost line.

## 16. Sources checked (2026-10-21)

Family: avd-landing-zone `site/portal/portal-core.js` and `portal-page.js` (region latency and reachability), `build/decisions/0003-region-by-latency.md`, `0014-verify-access.md`, `build/specs/verify-access-spec.md`, `build/lessons/0003-region-latency.md`; avd-current-state `avd_deployment_validator.ps1` (`Test-AvdEndpoints`) and issue #28; avd-assess `references/avd-required-fqdn.yaml`, `avd-connection-quality.yaml`, `avd-insights-use-cases.yaml`, `avd-prerequisites.yaml`, `rdp-shortpath.yaml`, `configure-rdp-shortpath.yaml`, `rdp-multipath.yaml`, `rdp-bandwidth.yaml`, `rdp-traffic-optimization.yaml`, `avd-proxy.yaml`, `windows-app-platforms.yaml`, `gaps/client-network.md`, `gaps/transport-classification.md`, `methods/remote-protocols.md`, `dimensions.yaml` row `network.client`; avd-ops `docs/design-system.md`, `docs/build-or-adopt.md`, decision 0005.

Browser: MDN `PerformanceResourceTiming` (cross-origin timing information), `Performance.now()` (resolution), `Request.mode` and the Fetch standard (no-cors methods and headers, opaque responses), `RTCPeerConnection.getStats()` with `RTCIceCandidateStats` and `RTCIceCandidatePairStats`, `WebTransport` (Baseline 2026, HTTPS, HTTP/3, explicit port), Content-Security-Policy (meta delivery), Chrome developers blog "Private Network Access update" (2024-03; since superseded by Chrome's local network access permission model, which the spec does not depend on). GitHub Pages limits (1 GB site, soft 100 GB a month, 10 builds an hour). Cloudflare Pages limits (25 MiB per file, 20,000 files and 500 builds a month on Free, 100 `_headers` rules).

Microsoft Learn (through avd-assess pins where a reference exists): required FQDNs and endpoints (end-user table), RDP Shortpath (TURN range `51.5.0.0/16`, relay regions, connection sequence), configure RDP Shortpath (`avdnettest.exe`, connection information dialog), compare Windows App features across platforms, Microsoft Q&A on the Experience Estimator (2025-01-21), the Microsoft 365 network connectivity test tool page.

## 17. Log bundle: full log collection for an AVD issue (proposed)

Nick, 2026-10-21: "needs to have full log collection for any avd related issue including teams and performance, not sure how we would send it but maybe just collection and zip to downloads/document?" Added after the red team in section 14; not yet reviewed.

### 17.1 What a page can and cannot do

A web page cannot read files, event logs or performance counters on the device (section 4.6 for the network side; the same sandbox applies to the file system). So the bundle is a **companion script**, not part of the page: the page offers it as a download from its own origin, shows its SHA-256 beside the link, and tells the user what it will collect before they run it. The network check stays the one-button part; the bundle is the "your helpdesk asked for logs" part.

### 17.2 Two places, two scripts

An AVD problem leaves evidence on two machines, and the user can reach both:

| Run on | How | Collects (each source cited, never a copied table) |
|---|---|---|
| **The user's own device** | Windows: a PowerShell script that runs in Windows PowerShell 5.1 with no modules and no admin rights. macOS, iOS, Android and the web client: the page shows Microsoft's own steps for that platform instead, because their Windows App logs are switched on inside the app (`learn.microsoft.com/windows-app/troubleshoot-collect-logs`) | Windows App logs (`%temp%\DiagOutputDir\Windows365\Logs`) and the older Remote Desktop client's (`%temp%\DiagOutputDir\RdClientAutoTrace`), copied with the app closed as Microsoft's steps say; Teams new VDI optimization (SlimCore) logs on the endpoint, both the older and the split Host and Framework paths, and the AppXDeployment-Server and AppxPackagingOM operational events the Teams troubleshooting page names (`learn.microsoft.com/microsoftteams/vdi-2-troubleshooting`, "Log collection" and "Connection error"); OS build, Windows App and plugin versions; a short performance sample (CPU, memory, network interface throughput and errors, Wi-Fi signal quality) taken while the user reproduces the problem; the latest avd-linecheck result JSON if one is in Downloads |
| **Inside the remote session** | The same script, run by the user in their session (no admin). Admin-only extras (agent logs, all users' events) are a separate switch for the helpdesk | Teams logs: new Teams' log folder under its package, classic Teams' `logs.txt` (`learn.microsoft.com/azure/virtual-desktop/troubleshoot-teams`, "Collect Teams logs"), and a prompt to press Ctrl+Alt+Shift+1 first so Teams writes its own diagnostic zip to Downloads, which the script then picks up; `Vdi_debug.txt` and the "Microsoft Teams VDI" events; event logs from the last N hours for the channels AVD Insights collects (`learn.microsoft.com/azure/virtual-desktop/insights-glossary`, "Windows Event Logs": Application, System, TerminalServices RemoteConnectionManager and LocalSessionManager, FSLogix Operational and Admin), filtered to this user's session where the event carries one; a performance sample during the reproduction (processor, memory, disk, and the per-session RemoteFX and user input delay counters AVD Insights reads); FSLogix profile status |

Microsoft's own collectors are prior art and the escalation path, not something to bundle: TSS (`.\TSS.ps1 -Scenario UEX_RDScli` and `UEX_RDSsrv`, `learn.microsoft.com/troubleshoot/windows-client/windows-tss/collect-data-analyze-troubleshoot-remote-desktop-services-scenarios`), which includes the Remote Desktop collector MSRD-Collect, is far broader, needs an elevated prompt and writes to `C:\MS_DATA`; its license is to be read before anything is reused (build-or-adopt: it is the best at its job but is not open source, so it is linked, never copied). Multimedia redirection has its own log capture in the browser extension, and Windows App on the web has "Capture logs" in the session toolbar; the page links both.

### 17.3 Where the bundle goes, and how it is sent

- **Written locally, never uploaded.** One zip in the user's Downloads folder, named `avd-linecheck-<device|session>-<yyyyMMdd-HHmm>.zip`, and the script opens File Explorer on it. Downloads, not Documents, because a redirected or OneDrive-synced Documents folder would upload it the moment it lands, and Teams already writes its own diagnostic zip to Downloads. Nothing in the script makes a network request (a test checks the script source for any web cmdlet or .NET web client).
- **Sending is the helpdesk's channel.** The user attaches the zip to their ticket or the place their helpdesk names. The tool never emails, uploads or posts it. A future "send" option, if ever, is the v2 server probe's problem and needs its own decision.
- **A manifest first.** `manifest.json` at the top of the zip lists every file, its source path with the user profile folder replaced by `%USERPROFILE%`, its size and hash, what was skipped and why (not found, access denied, too big), the time window and the script version. A collection that found nothing says so instead of producing an empty zip (L2, L3).
- **Bounded.** A time window (default the last 24 hours, `-Hours` to change), a size cap per source and for the whole zip (default 200 MB), and a performance sample of at most 5 minutes. Like the page, no loop mode.

### 17.4 Privacy: the opposite of the network export

The network export (section 8.3) holds no personal data. **Logs do**: user names, device and host names, IP addresses, tenant and session IDs, meeting titles in Teams logs, Wi-Fi network names. So the bundle is treated as private by design:

- The script shows the list of sources and asks before it starts; the page says plainly that the zip contains personal and organizational data and goes only to the user's own helpdesk, never into a public issue, a forum or this repo.
- No best-effort scrubbing is claimed. Redacting free-form logs reliably is not possible, and a "redacted" label would invite exactly the public post that leaks. The manifest says "contains personal data: yes".
- Wi-Fi: signal quality and band only, never the network name or the access point's address.
- This repo never receives a bundle: the issue template says so, and real bundles never become fixtures; tests use synthetic files.

### 17.5 Running it on a managed device

Corporate devices often block unsigned scripts. The page gives one copyable command (`powershell -NoProfile -ExecutionPolicy Bypass -File <path>`), which changes the policy for that process only, and says that if the device still blocks it, the helpdesk has to run it or sign it. Signing the script with a family code-signing certificate is a cost and an identity question for later (Q11). The script refuses to run elevated unless the helpdesk passes the admin switch, so a user does not collect other users' data by accident.

### 17.6 Layout and roadmap

`collector/Get-AvdLogBundle.ps1` (the entry point, with the family notice at the top) and `collector/AvdLogBundle.psm1` (pure functions: the source list, the manifest, path normalization, size caps), tested offline with Pester against a synthetic profile tree, the way every family PowerShell repo works. The source list is data (`collector/sources.json`), each row citing the Learn page and anchor it comes from, so a moved log folder is a one-line change. The bundle comes after v0 of the page; it is independent of it and could ship first if Nick prefers (Q11).
