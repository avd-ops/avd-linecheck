// avd-linecheck spike S3: timer precision, WebRTC stats exposure, screen capture and recording support.
// Personal project, research and learning only, not for production, as is.
'use strict';

// Smallest non-zero step of performance.now(), from many back-to-back reads.
function timerStep() {
  const steps = [];
  let last = performance.now();
  const end = last + 50;
  while (steps.length < 2000 && performance.now() < end) {
    const now = performance.now();
    if (now !== last) { steps.push(now - last); last = now; }
  }
  steps.sort((a, b) => a - b);
  return { minMs: steps[0] ?? null, medianMs: steps[Math.floor(steps.length / 2)] ?? null, samples: steps.length };
}

// Two local peer connections, no STUN or TURN server, so nothing leaves the device.
// Records which candidate and candidate-pair fields getStats() fills, never their values.
async function webrtcStats() {
  if (!('RTCPeerConnection' in window)) return { supported: false };
  const a = new RTCPeerConnection({ iceServers: [] });
  const b = new RTCPeerConnection({ iceServers: [] });
  try {
    a.onicecandidate = (e) => e.candidate && b.addIceCandidate(e.candidate).catch(() => {});
    b.onicecandidate = (e) => e.candidate && a.addIceCandidate(e.candidate).catch(() => {});
    a.createDataChannel('probe');
    await a.setLocalDescription(await a.createOffer());
    await b.setRemoteDescription(a.localDescription);
    await b.setLocalDescription(await b.createAnswer());
    await a.setRemoteDescription(b.localDescription);
    await new Promise((r) => setTimeout(r, 1500));
    const report = await a.getStats();
    const fields = {};
    report.forEach((s) => {
      if (!['local-candidate', 'remote-candidate', 'candidate-pair', 'transport'].includes(s.type)) return;
      fields[s.type] = [...new Set([...(fields[s.type] || []), ...Object.keys(s)])].sort();
    });
    const local = [];
    report.forEach((s) => { if (s.type === 'local-candidate') local.push({ type: s.candidateType, protocol: s.protocol, mdns: /\.local$/.test(s.address || s.ip || '') }); });
    return { supported: true, state: a.iceConnectionState, fields, localCandidates: local };
  } finally { a.close(); b.close(); }
}

function capture() {
  const md = navigator.mediaDevices;
  const types = ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm', 'video/mp4;codecs=avc1', 'video/mp4'];
  return {
    getDisplayMedia: !!(md && md.getDisplayMedia),
    mediaRecorder: 'MediaRecorder' in window,
    recorderTypes: 'MediaRecorder' in window ? types.filter((t) => MediaRecorder.isTypeSupported(t)) : [],
  };
}

spike.wire(async () => ({
  ...spike.header('S3'),
  crossOriginIsolated: self.crossOriginIsolated === true,
  timer: timerStep(),
  resourceTimingTransferSize: 'PerformanceResourceTiming' in window && 'transferSize' in PerformanceResourceTiming.prototype,
  webrtc: await webrtcStats().catch((e) => ({ supported: true, error: String(e) })),
  capture: capture(),
}));
