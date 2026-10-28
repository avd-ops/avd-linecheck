/* Personal project, not for production, as is; not affiliated with the author's employer, Liquidware or Microsoft. MIT. */
// Optional v2a server probe (docs/spec.md section 10):
// - GET /echo  -> readable JSON body + Timing-Allow-Origin: * + CORS for full DNS/TCP/TLS Resource Timing
// - POST /sink -> accepts up to 16 MiB for upload throughput measurement
// No sign-in, no storage, no cookies, and no IP or header reflection.

(function (root, factory) {
  'use strict';
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.LinecheckProbeWorker = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const MAX_SINK_BYTES = 16 * 1024 * 1024;

  const COMMON_HEADERS = Object.freeze({
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Timing-Allow-Origin': '*',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff'
  });

  function jsonResponse(body, status = 200) {
    return new Response(JSON.stringify(body), {
      status,
      headers: {
        ...COMMON_HEADERS,
        'Content-Type': 'application/json; charset=utf-8'
      }
    });
  }

  async function handleProbeRequest(request) {
    const url = new URL(request.url);
    const method = String(request.method || 'GET').toUpperCase();

    if (method === 'OPTIONS' && (url.pathname === '/echo' || url.pathname === '/sink')) {
      return new Response(null, { status: 204, headers: COMMON_HEADERS });
    }

    if (url.pathname === '/echo' && method === 'GET') {
      return jsonResponse({
        schema: 'avd-linecheck-echo/v1',
        ok: true,
        status: 200
      });
    }

    if (url.pathname === '/sink' && method === 'POST') {
      const contentLengthHeader = request.headers && request.headers.get ? request.headers.get('content-length') : null;
      if (contentLengthHeader !== null && Number(contentLengthHeader) > MAX_SINK_BYTES) {
        return jsonResponse({ schema: 'avd-linecheck-sink/v1', ok: false, error: 'payload-too-large', maxBytes: MAX_SINK_BYTES }, 413);
      }

      let receivedBytes = 0;
      if (request.body && typeof request.body.getReader === 'function') {
        const reader = request.body.getReader();
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          receivedBytes += value ? value.byteLength : 0;
          if (receivedBytes > MAX_SINK_BYTES) {
            try { await reader.cancel(); } catch { /* ignore cancel error */ }
            return jsonResponse({ schema: 'avd-linecheck-sink/v1', ok: false, error: 'payload-too-large', maxBytes: MAX_SINK_BYTES }, 413);
          }
        }
      } else if (typeof request.arrayBuffer === 'function') {
        const buf = await request.arrayBuffer();
        receivedBytes = buf.byteLength;
        if (receivedBytes > MAX_SINK_BYTES) {
          return jsonResponse({ schema: 'avd-linecheck-sink/v1', ok: false, error: 'payload-too-large', maxBytes: MAX_SINK_BYTES }, 413);
        }
      }

      return jsonResponse({
        schema: 'avd-linecheck-sink/v1',
        ok: true,
        receivedBytes
      });
    }

    return jsonResponse({ ok: false, error: 'not-found' }, 404);
  }

  return Object.freeze({
    MAX_SINK_BYTES,
    handleProbeRequest,
    fetch: handleProbeRequest
  });
});
