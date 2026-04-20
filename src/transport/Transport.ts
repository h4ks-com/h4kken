// ============================================================
// H4KKEN - Transport Abstraction Layer
// ============================================================
// Provides a common interface for binary game data transport.
// Enables switching between WebSocket (TCP) and WebRTC DataChannel (UDP)
// without changing the game or network logic.
//
// Why: WebSocket uses TCP which suffers from head-of-line blocking —
// a single lost packet delays ALL subsequent packets. WebRTC DataChannels
// support unreliable/unordered mode (UDP semantics) where lost packets
// are simply skipped. The rollback netcode already handles missing frames
// via prediction, so UDP is strictly better for per-frame input sync.
//
// [Ref: RFC8831 §6.1] Use Case 1 = "real-time game position/state data"
// [Ref: MIT-CC] TCP congestion control misinterprets jitter as congestion → starvation
// [Ref: MIT-ABC] Minimal-overhead transport maximizes benefit for tiny constant-rate packets
// ============================================================

/**
 * Transport interface for binary game data (8-byte input packets).
 * Both WebSocket and WebRTC DataChannel implement this.
 */
export interface IGameTransport {
  /** Send binary data to the remote peer. */
  send(data: ArrayBuffer): void;

  /** Callback invoked when binary data arrives from remote peer. */
  onMessage: ((data: ArrayBuffer) => void) | null;

  /** Close the transport channel. */
  close(): void;

  /** Whether the transport is ready to send data. */
  readonly ready: boolean;

  /** Transport type identifier for diagnostics. */
  readonly type: 'websocket' | 'webrtc';
}

/**
 * WebSocket transport — wraps an existing WebSocket for binary data.
 * Used as the default/fallback transport. Sends binary frames directly.
 */
export class WebSocketTransport implements IGameTransport {
  readonly type = 'websocket' as const;
  onMessage: ((data: ArrayBuffer) => void) | null = null;

  private _ws: WebSocket;

  constructor(ws: WebSocket) {
    this._ws = ws;
  }

  get ready(): boolean {
    return this._ws.readyState === WebSocket.OPEN;
  }

  send(data: ArrayBuffer): void {
    if (this._ws.readyState === WebSocket.OPEN) {
      this._ws.send(data);
    }
  }

  close(): void {
    // Don't close the WebSocket itself — it's shared with JSON messages.
    // Just null out the handler so binary messages fall through to the
    // default Network.ts handler.
    this.onMessage = null;
  }
}
