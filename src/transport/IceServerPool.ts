// ============================================================
// H4KKEN - ICE Server Pool
// ============================================================
// Multi-provider STUN server pool with latency-based selection.
// Instead of hardcoding 1-2 Google STUN servers, we maintain a
// ranked list from multiple providers and probe them at session
// start to find the fastest reachable ones.
//
// [Ref: RFC8489 §14] STUN keepalive and server failover
// [Ref: RFC8445 §5.1.1.1] Gathering candidates from multiple servers
//   increases ICE success rate on restrictive NATs.
// [Ref: EDGEGAP] "31% of latency is infrastructure" — choosing the
//   nearest STUN server reduces the ICE gathering phase.
//
// Probe algorithm:
//   1. Create one ephemeral RTCPeerConnection per STUN server
//   2. Create a dummy DataChannel to trigger ICE gathering
//   3. Measure time-to-first-icecandidate (~ STUN RTT)
//   4. Sort by response time, cache for session lifetime
//   5. Return top N servers (default 3) for use in RTCConfiguration
//
// If probing fails entirely (e.g. no RTCPeerConnection in browser),
// the full unprobed list is returned as fallback.
// ============================================================

import type { IceServerConfig } from './WebRTCTransport';

// ── Multi-provider STUN server list ─────────────────────────
// Diversified across providers so a single outage doesn't block
// ICE gathering. Ordered by expected reliability.
// Max 5 entries — more slows ICE gathering (RFC8445 §5.1.1.1).
const STUN_SERVERS: IceServerConfig[] = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
  { urls: 'stun:stun.cloudflare.com:3478' },
  { urls: 'stun:stun.services.mozilla.com:3478' },
  { urls: 'stun:global.stun.twilio.com:3478' },
];

/** How many top servers to return after probing. */
const TOP_N = 3;

/** Probe timeout per server (ms). Servers slower than this are discarded. */
const PROBE_TIMEOUT_MS = 2500;

/** Session-level cache: probe once, reuse for all matches in this tab. */
let cachedResult: IceServerConfig[] | null = null;
let probePromise: Promise<IceServerConfig[]> | null = null;

interface ProbeResult {
  server: IceServerConfig;
  latencyMs: number;
}

/**
 * Probe a single STUN server by measuring time-to-first-ICE-candidate.
 * Returns latency in ms, or Infinity on failure/timeout.
 */
function probeOne(server: IceServerConfig, timeoutMs: number): Promise<ProbeResult> {
  return new Promise((resolve) => {
    const start = performance.now();
    let settled = false;

    const finish = (latencyMs: number) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try {
        pc.close();
      } catch {
        // Ignore close errors
      }
      resolve({ server, latencyMs });
    };

    const timer = setTimeout(() => finish(Number.POSITIVE_INFINITY), timeoutMs);

    let pc: RTCPeerConnection;
    try {
      pc = new RTCPeerConnection({ iceServers: [server] });
    } catch {
      finish(Number.POSITIVE_INFINITY);
      return;
    }

    // We need a media/data track to trigger ICE gathering
    pc.createDataChannel('probe');

    pc.onicecandidate = (event) => {
      if (event.candidate) {
        // First candidate arrived — that's our STUN round-trip
        finish(performance.now() - start);
      }
    };

    pc.createOffer()
      .then((offer) => pc.setLocalDescription(offer))
      .catch(() => finish(Number.POSITIVE_INFINITY));
  });
}

/**
 * Probe all STUN servers in parallel and return the fastest ones.
 * Results are cached for the session lifetime.
 */
async function probeAll(): Promise<IceServerConfig[]> {
  if (typeof RTCPeerConnection === 'undefined') {
    console.log('[ICE Pool] RTCPeerConnection not available — using full list');
    return STUN_SERVERS;
  }

  try {
    const results = await Promise.all(STUN_SERVERS.map((s) => probeOne(s, PROBE_TIMEOUT_MS)));

    const reachable = results
      .filter((r) => r.latencyMs < Number.POSITIVE_INFINITY)
      .sort((a, b) => a.latencyMs - b.latencyMs);

    if (reachable.length === 0) {
      console.warn('[ICE Pool] No STUN servers reachable — using full list as fallback');
      return STUN_SERVERS;
    }

    const picked = reachable.slice(0, TOP_N);
    const summary = picked
      .map((r) => {
        const url = Array.isArray(r.server.urls) ? r.server.urls[0] : r.server.urls;
        return `${url} (${Math.round(r.latencyMs)}ms)`;
      })
      .join(', ');
    console.log(`[ICE Pool] Best STUN servers: ${summary}`);

    return picked.map((r) => r.server);
  } catch (err) {
    console.warn('[ICE Pool] Probe failed:', err);
    return STUN_SERVERS;
  }
}

/**
 * Get the best STUN servers for this session.
 * First call triggers probing; subsequent calls return cached result.
 * Non-blocking: if called while probing is in progress, awaits the
 * existing probe rather than starting a new one.
 */
export async function getBestStunServers(): Promise<IceServerConfig[]> {
  if (cachedResult) return cachedResult;

  // Deduplicate concurrent calls — only one probe runs at a time
  if (!probePromise) {
    probePromise = probeAll().then((result) => {
      cachedResult = result;
      probePromise = null;
      return result;
    });
  }

  return probePromise;
}

/**
 * Start probing in the background (fire-and-forget).
 * Call early (e.g. after page load) so results are ready by match time.
 */
export function warmup(): void {
  getBestStunServers().catch(() => {
    // Swallowed — getBestStunServers already handles errors internally
  });
}
