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

/** Events emitted by WebRTCTransport. */
interface WebRTCTransportEvents {
  /** DataChannel is open and ready for binary data. */
  onOpen: (() => void) | null;
  /** DataChannel or PeerConnection closed/failed. */
  onClose: (() => void) | null;
}

export class WebRTCTransport implements IGameTransport {
  readonly type = 'webrtc' as const;
  onMessage: ((data: ArrayBuffer) => void) | null = null;

  private _pc: RTCPeerConnection | null = null;
  private _dc: RTCDataChannel | null = null;
  private _ready = false;
  private _events: WebRTCTransportEvents = { onOpen: null, onClose: null };
  private _signaling: SignalingCallbacks;
  private _handshakeTimeout: ReturnType<typeof setTimeout> | null = null;

  constructor(iceServers: IceServerConfig[], signaling: SignalingCallbacks) {
    this._signaling = signaling;
    this._pc = new RTCPeerConnection({ iceServers });

    // Forward ICE candidates to remote peer via signaling channel
    this._pc.onicecandidate = (event) => {
      if (event.candidate) {
        this._signaling.sendIceCandidate(JSON.stringify(event.candidate));
      }
    };

    // Monitor connection state for fallback detection
    this._pc.onconnectionstatechange = () => {
      const state = this._pc?.connectionState;
      if (state === 'failed' || state === 'disconnected' || state === 'closed') {
        this._handleClose();
      }
    };

    // Answerer receives DataChannel via this event
    this._pc.ondatachannel = (event) => {
      this._setupDataChannel(event.channel);
    };

    // Auto-cancel if handshake doesn't complete within 5 seconds.
    // Game is already running on WebSocket, so this is non-blocking.
    this._handshakeTimeout = setTimeout(() => {
      if (!this._ready) {
        console.warn('[WebRTC] Handshake timeout (5s) — staying on WebSocket');
        this._handleClose();
      }
    }, 5000);
  }

  get ready(): boolean {
    return this._ready;
  }

  get events(): WebRTCTransportEvents {
    return this._events;
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
    const candidate = JSON.parse(candidateJson) as RTCIceCandidateInit;
    await this._pc.addIceCandidate(candidate);
  }

  // ── IGameTransport implementation ─────────────────────────

  send(data: ArrayBuffer): void {
    if (this._dc && this._dc.readyState === 'open') {
      this._dc.send(data);
    }
  }

  close(): void {
    this._clearHandshakeTimeout();
    this._dc?.close();
    this._pc?.close();
    this._dc = null;
    this._pc = null;
    this._ready = false;
    this.onMessage = null;
  }

  // ── Internal ──────────────────────────────────────────────

  private _setupDataChannel(dc: RTCDataChannel): void {
    dc.binaryType = 'arraybuffer';
    this._dc = dc;

    dc.onopen = () => {
      this._clearHandshakeTimeout();
      this._ready = true;
      console.log('[WebRTC] DataChannel open — switching binary input path to UDP');
      this._events.onOpen?.();
    };

    dc.onclose = () => {
      this._handleClose();
    };

    dc.onmessage = (event) => {
      if (event.data instanceof ArrayBuffer) {
        this.onMessage?.(event.data);
      }
    };
  }

  private _handleClose(): void {
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
