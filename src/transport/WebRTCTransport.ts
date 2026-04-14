// ============================================================
// H4KKEN - WebRTC DataChannel Transport
// ============================================================
// Provides UDP-like semantics for binary game input packets via
// WebRTC DataChannel with { ordered: false, maxRetransmits: 0 }.
//
// Key advantage over WebSocket/TCP: eliminates head-of-line blocking.
// On a transatlantic connection (Mexico ↔ Germany) with ~1-2% packet loss,
// TCP can spike 300-500ms on a single retransmit. With unreliable DataChannel,
// lost packets are simply skipped — the next frame arrives on time and the
// rollback netcode handles the missing frame via prediction.
//
// [Ref: RFC8831 §6.4] Unreliable channel via maxRetransmits=0
// [Ref: RFC8831 §6.6] Sender SHOULD disable Nagle to avoid 40ms coalescing
// [Ref: GOOGLE-LOSS] At 1-2% loss, next frame (16.7ms) arrives before any NACK round-trip
// [Ref: EDGEGAP] 31% of latency is infrastructure — TURN relay + rollback = dual approach
//
// Lifecycle:
//   1. After match, playerIndex=0 creates offer (deterministic role)
//   2. SDP + ICE candidates exchanged via existing WebSocket (signaling)
//   3. When DataChannel opens, Network.ts switches binary path here
//   4. If handshake fails or DC closes, falls back to WebSocket seamlessly
//   5. One automatic retry on fast failure (< 3s), after a 2s cooldown
// ============================================================

import type { IGameTransport } from './Transport';

/** ICE server configuration. STUN for NAT traversal, TURN for relay fallback. */
export interface IceServerConfig {
  urls: string | string[];
  username?: string;
  credential?: string;
}

/** Callback interface for signaling messages (sent via existing WebSocket). */
interface SignalingCallbacks {
  sendOffer(sdp: string): void;
  sendAnswer(sdp: string): void;
  sendIceCandidate(candidate: string): void;
}

/** Snapshot of WebRTC connection statistics from getStats(). */
export interface WebRTCStats {
  /** P2P round-trip time in ms from the active candidate pair (STUN keepalive). */
  rttMs: number;
  /** Total packets lost on the active candidate pair. */
  packetsLost: number;
  /** Total packets sent on the active candidate pair. */
  packetsSent: number;
  /** Local ICE candidate type (host, srflx, prflx, relay). */
  localCandidateType: string;
  /** Remote ICE candidate type. */
  remoteCandidateType: string;
  /** Estimated available outgoing bitrate (bps), or 0 if unavailable. */
  availableOutgoingBitrate: number;
  /** DataChannel bufferedAmount in bytes. */
  bufferedAmount: number;
}

/** Events emitted by WebRTCTransport. */
interface WebRTCTransportEvents {
  /** DataChannel is open and ready for binary data. */
  onOpen: (() => void) | null;
  /** DataChannel or PeerConnection closed/failed. */
  onClose: (() => void) | null;
}

/** Maximum DC bufferedAmount before we skip a send (backpressure). */
const MAX_BUFFER_BYTES = 65_536; // 64 KB

/** Handshake timeout — 8s to allow TURN relay negotiation. */
const HANDSHAKE_TIMEOUT_MS = 8_000;

export class WebRTCTransport implements IGameTransport {
  readonly type = 'webrtc' as const;
  onMessage: ((data: ArrayBuffer) => void) | null = null;

  private _pc: RTCPeerConnection | null = null;
  private _dc: RTCDataChannel | null = null;
  private _ready = false;
  private _events: WebRTCTransportEvents = { onOpen: null, onClose: null };
  private _signaling: SignalingCallbacks;
  private _handshakeTimeout: ReturnType<typeof setTimeout> | null = null;
  private _startTime = 0;

  // ── ICE/connection state tracking ─────────────────────────
  private _iceConnectionState: RTCIceConnectionState = 'new';
  private _iceGatheringState: RTCIceGatheringState = 'new';
  private _connectionState: RTCPeerConnectionState = 'new';
  private _localCandidateType: string | null = null;
  private _remoteCandidateType: string | null = null;

  // ── Failure diagnostics ───────────────────────────────────
  private _failReason: string | null = null;
  private _closed = false;

  constructor(iceServers: IceServerConfig[], signaling: SignalingCallbacks) {
    this._signaling = signaling;
    this._startTime = performance.now();
    this._pc = new RTCPeerConnection({ iceServers });

    // Forward ICE candidates to remote peer via signaling channel.
    // null candidate signals end-of-candidates (trickle ICE completion).
    this._pc.onicecandidate = (event) => {
      if (event.candidate) {
        this._signaling.sendIceCandidate(JSON.stringify(event.candidate));
      }
      // null candidate = gathering complete for this generation — no action needed
    };

    // Track ICE connection state transitions for diagnostics
    this._pc.oniceconnectionstatechange = () => {
      if (!this._pc) return;
      this._iceConnectionState = this._pc.iceConnectionState;
      if (this._pc.iceConnectionState === 'failed') {
        this._failReason = 'ICE connection failed (no route to peer)';
      }
    };

    // Track ICE gathering state for overlay display
    this._pc.onicegatheringstatechange = () => {
      if (!this._pc) return;
      this._iceGatheringState = this._pc.iceGatheringState;
    };

    // Monitor connection state for fallback detection
    this._pc.onconnectionstatechange = () => {
      if (!this._pc) return;
      this._connectionState = this._pc.connectionState;
      const state = this._pc.connectionState;
      if (state === 'failed') {
        this._failReason ??= 'Peer connection failed';
        this._handleClose();
      } else if (state === 'disconnected' || state === 'closed') {
        this._handleClose();
      } else if (state === 'connected') {
        // Extract selected candidate pair types once connected
        this._extractCandidateTypes();
      }
    };

    // Answerer receives DataChannel via this event
    this._pc.ondatachannel = (event) => {
      this._setupDataChannel(event.channel);
    };

    // Auto-cancel if handshake doesn't complete within timeout.
    // 8s allows for TURN relay negotiation on slow connections.
    // Game is already running on WebSocket, so this is non-blocking.
    this._handshakeTimeout = setTimeout(() => {
      if (!this._ready) {
        this._failReason = `Handshake timeout (${HANDSHAKE_TIMEOUT_MS / 1000}s)`;
        console.warn(`[WebRTC] ${this._failReason} — staying on WebSocket`);
        this._handleClose();
      }
    }, HANDSHAKE_TIMEOUT_MS);
  }

  get ready(): boolean {
    return this._ready;
  }

  get events(): WebRTCTransportEvents {
    return this._events;
  }

  // ── Diagnostics getters ───────────────────────────────────

  get iceConnectionState(): RTCIceConnectionState {
    return this._iceConnectionState;
  }

  get iceGatheringState(): RTCIceGatheringState {
    return this._iceGatheringState;
  }

  get connectionState(): RTCPeerConnectionState {
    return this._connectionState;
  }

  get localCandidateType(): string | null {
    return this._localCandidateType;
  }

  get remoteCandidateType(): string | null {
    return this._remoteCandidateType;
  }

  get failReason(): string | null {
    return this._failReason;
  }

  /** DataChannel buffered bytes (0 if DC not open). */
  get bufferedAmount(): number {
    return this._dc?.bufferedAmount ?? 0;
  }

  // ── Offerer flow (playerIndex === 0) ──────────────────────

  async initiateOffer(): Promise<void> {
    if (!this._pc) return;

    // Create DataChannel with UDP-like semantics:
    // - ordered: false — no head-of-line blocking
    // - maxRetransmits: 0 — lost packets are gone (rollback handles it)
    const dc = this._pc.createDataChannel('game', {
      ordered: false,
      maxRetransmits: 0,
    });
    this._setupDataChannel(dc);

    const offer = await this._pc.createOffer();
    await this._pc.setLocalDescription(offer);
    this._signaling.sendOffer(this._pc.localDescription?.sdp ?? '');
  }

  // ── Answerer flow (playerIndex === 1) ─────────────────────

  async handleOffer(sdp: string): Promise<void> {
    if (!this._pc) return;
    await this._pc.setRemoteDescription({ type: 'offer', sdp });
    const answer = await this._pc.createAnswer();
    await this._pc.setLocalDescription(answer);
    this._signaling.sendAnswer(this._pc.localDescription?.sdp ?? '');
  }

  async handleAnswer(sdp: string): Promise<void> {
    if (!this._pc) return;
    await this._pc.setRemoteDescription({ type: 'answer', sdp });
  }

  async handleIceCandidate(candidateJson: string): Promise<void> {
    if (!this._pc) return;
    try {
      const candidate = JSON.parse(candidateJson) as RTCIceCandidateInit;
      await this._pc.addIceCandidate(candidate);
    } catch (err) {
      console.warn('[WebRTC] Malformed ICE candidate:', err);
    }
  }

  // ── IGameTransport implementation ─────────────────────────

  send(data: ArrayBuffer): void {
    if (!this._dc || this._dc.readyState !== 'open') return;
    // Backpressure: skip send if DC buffer is backed up.
    // For 8-byte input packets at 60fps (480 B/s) this should never
    // trigger, but protects against pathological DC stalls.
    if (this._dc.bufferedAmount > MAX_BUFFER_BYTES) return;
    this._dc.send(data);
  }

  close(): void {
    this._closed = true;
    this._clearHandshakeTimeout();
    this._dc?.close();
    this._pc?.close();
    this._dc = null;
    this._pc = null;
    this._ready = false;
    this.onMessage = null;
  }

  // ── getStats() polling ────────────────────────────────────
  // Only called when F3 overlay is visible — no performance cost normally.

  async pollStats(): Promise<WebRTCStats | null> {
    if (!this._pc || !this._ready) return null;
    try {
      const report = await this._pc.getStats();
      let rttMs = 0;
      let packetsLost = 0;
      let packetsSent = 0;
      let localType = this._localCandidateType ?? '?';
      let remoteType = this._remoteCandidateType ?? '?';
      let availableBitrate = 0;

      // Walk the stats report to find the active candidate-pair
      report.forEach((stat) => {
        if (stat.type === 'candidate-pair' && (stat as Record<string, unknown>).nominated) {
          const pair = stat as Record<string, unknown>;
          rttMs = Math.round(((pair.currentRoundTripTime as number) ?? 0) * 1000);
          packetsLost = (pair.packetsLost as number) ?? 0;
          packetsSent = (pair.packetsSent as number) ?? 0;
          availableBitrate = (pair.availableOutgoingBitrate as number) ?? 0;

          // Resolve candidate types from the report
          const localId = pair.localCandidateId as string;
          const remoteId = pair.remoteCandidateId as string;
          if (localId) {
            const lc = report.get(localId) as Record<string, unknown> | undefined;
            if (lc) localType = (lc.candidateType as string) ?? localType;
          }
          if (remoteId) {
            const rc = report.get(remoteId) as Record<string, unknown> | undefined;
            if (rc) remoteType = (rc.candidateType as string) ?? remoteType;
          }
        }
      });

      return {
        rttMs,
        packetsLost,
        packetsSent,
        localCandidateType: localType,
        remoteCandidateType: remoteType,
        availableOutgoingBitrate: availableBitrate,
        bufferedAmount: this._dc?.bufferedAmount ?? 0,
      };
    } catch {
      return null;
    }
  }

  // ── Internal ──────────────────────────────────────────────

  private _setupDataChannel(dc: RTCDataChannel): void {
    dc.binaryType = 'arraybuffer';
    this._dc = dc;

    dc.onopen = () => {
      this._clearHandshakeTimeout();
      this._ready = true;
      this._failReason = null;
      const elapsed = Math.round(performance.now() - this._startTime);
      console.log(`[WebRTC] DataChannel open in ${elapsed}ms — switching to UDP`);
      this._events.onOpen?.();
    };

    dc.onclose = () => {
      this._handleClose();
    };

    dc.onerror = (event) => {
      const msg = (event as RTCErrorEvent).error?.message ?? 'unknown';
      console.warn('[WebRTC] DataChannel error:', msg);
      this._failReason ??= `DataChannel error: ${msg}`;
    };

    dc.onmessage = (event) => {
      if (event.data instanceof ArrayBuffer) {
        this.onMessage?.(event.data);
      }
    };
  }

  /** Extract candidate types from the selected pair once connected. */
  private _extractCandidateTypes(): void {
    if (!this._pc) return;
    this._pc
      .getStats()
      .then((report) => {
        report.forEach((stat) => {
          if (stat.type === 'candidate-pair' && (stat as Record<string, unknown>).nominated) {
            const pair = stat as Record<string, unknown>;
            const localId = pair.localCandidateId as string;
            const remoteId = pair.remoteCandidateId as string;
            if (localId) {
              const lc = report.get(localId) as Record<string, unknown> | undefined;
              if (lc) this._localCandidateType = (lc.candidateType as string) ?? null;
            }
            if (remoteId) {
              const rc = report.get(remoteId) as Record<string, unknown> | undefined;
              if (rc) this._remoteCandidateType = (rc.candidateType as string) ?? null;
            }
            const connType = this._localCandidateType === 'relay' ? 'relay/TURN' : 'direct';
            console.log(
              `[WebRTC] Connected (${connType}): ${this._localCandidateType} → ${this._remoteCandidateType}`,
            );
          }
        });
      })
      .catch(() => {
        // getStats can fail if PC is closing — ignore
      });
  }

  private _handleClose(): void {
    if (this._closed) return;
    this._clearHandshakeTimeout();
    const wasReady = this._ready;
    this._ready = false;
    if (wasReady) {
      console.warn('[WebRTC] DataChannel closed — falling back to WebSocket');
    }
    this._events.onClose?.();
  }

  private _clearHandshakeTimeout(): void {
    if (this._handshakeTimeout) {
      clearTimeout(this._handshakeTimeout);
      this._handshakeTimeout = null;
    }
  }
}
