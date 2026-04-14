// ============================================================
// H4KKEN - Network Debug Overlay
// ============================================================
// Optional HUD overlay showing real-time network metrics.
// Toggled via F3 during gameplay. Helps developers and testers
// validate WebRTC improvements, diagnose rollback issues, and
// measure connection quality during online matches.
//
// [Ref: VALVE-MP] Inspired by Source Engine's net_graph diagnostic overlay
// [Ref: TAXONOMY] Live metrics help correlate technique behavior with perceived quality
//
// Sections displayed:
//   1. FPS + WS RTT (always)
//   2. WebRTC status line: connected/connecting/failed + reason
//   3. ICE state, candidate types, P2P RTT (when on WebRTC)
//   4. Rollback netcode stats (rollbacks, misprediction, stalls)
//   5. Forfeit button
// ============================================================

import type { RollbackManager } from '../game/RollbackManager';
import type { Network } from '../Network';
import type { WebRTCStats } from '../transport/WebRTCTransport';

/** Callback for forfeit action, wired up by Game.ts */
type ForfeitCallback = () => void;

type OverlayMode = 'online' | 'practice';

export class NetworkOverlay {
  private _el: HTMLDivElement | null = null;
  private _visible = false;
  private _network: Network | null;
  private _keyHandler: ((e: KeyboardEvent) => void) | null = null;
  private _forfeitBtn: HTMLButtonElement | null = null;
  private _onForfeit: ForfeitCallback | null = null;

  // FPS tracking (rolling average over last 60 frames)
  private _fpsSamples: number[] = [];
  private _lastFrameTime = 0;

  // Cached WebRTC stats (polled at ~1s intervals, not every frame)
  private _stats: WebRTCStats | null = null;

  constructor(network: Network | null, onForfeit?: ForfeitCallback, _mode: OverlayMode = 'online') {
    this._network = network;
    this._onForfeit = onForfeit ?? null;
    this._createDOM();
    this._bindToggle();
  }

  private _createDOM(): void {
    const el = document.createElement('div');
    el.id = 'net-debug-overlay';
    el.style.cssText = [
      'position: fixed',
      'top: 8px',
      'right: 8px',
      'background: rgba(0,0,0,0.75)',
      'color: #0f0',
      'font-family: monospace',
      'font-size: 11px',
      'padding: 6px 10px',
      'border-radius: 4px',
      'z-index: 9999',
      'pointer-events: auto',
      'display: none',
      'line-height: 1.5',
      'white-space: pre',
    ].join(';');

    // Forfeit button
    const btn = document.createElement('button');
    btn.textContent = 'FORFEIT';
    btn.style.cssText = [
      'display: block',
      'margin-top: 6px',
      'width: 100%',
      'padding: 4px 8px',
      'background: #a00',
      'color: #fff',
      'border: 1px solid #f44',
      'border-radius: 3px',
      'font-family: monospace',
      'font-size: 11px',
      'cursor: pointer',
    ].join(';');
    btn.addEventListener('click', () => {
      if (this._onForfeit) this._onForfeit();
    });
    this._forfeitBtn = btn;

    el.appendChild(document.createTextNode(''));
    el.appendChild(btn);
    document.body.appendChild(el);
    this._el = el;
  }

  private _bindToggle(): void {
    this._keyHandler = (e: KeyboardEvent) => {
      if (e.key === 'F3') {
        e.preventDefault();
        this._visible = !this._visible;
        if (this._el) {
          this._el.style.display = this._visible ? 'block' : 'none';
        }
      }
    };
    document.addEventListener('keydown', this._keyHandler);
  }

  /** Call every render frame to refresh the overlay content. */
  update(rm: RollbackManager | null, frame: number, inputDelay = 0, engineFps = 0): void {
    if (!this._visible || !this._el) return;

    // FPS tracking — use engine FPS if available, otherwise measure ourselves
    const now = performance.now();
    if (this._lastFrameTime > 0) {
      const dt = now - this._lastFrameTime;
      if (dt > 0) this._fpsSamples.push(1000 / dt);
      if (this._fpsSamples.length > 60) this._fpsSamples.shift();
    }
    this._lastFrameTime = now;

    const fps = engineFps > 0 ? Math.round(engineFps) : this._avgFps();

    // Practice mode: lightweight display (FPS + frame only)
    if (!this._network) {
      const textNode = this._el.firstChild;
      if (textNode && textNode.nodeType === Node.TEXT_NODE) {
        textNode.textContent = `FPS: ${fps}  Frame: ${frame}\nMode: PRACTICE`;
      }
      this._el.style.color = '#0f0';
      if (this._forfeitBtn) this._forfeitBtn.style.color = '#fff';
      return;
    }

    const n = this._network;
    const rtt = n.rtt;
    const transport = n.transportType;

    // Color-code RTT
    const rttColor = rtt < 50 ? '#0f0' : rtt < 120 ? '#ff0' : '#f44';

    // Derive soft frame advantage from RTT (same formula as Game.ts)
    const rttFrames = rtt / 16.67;
    const softAdv = Math.max(3, Math.min(8, Math.ceil(rttFrames) + 2));

    // Poll WebRTC stats asynchronously (1s interval, non-blocking)
    n.pollWebrtcStats().then((s) => {
      this._stats = s;
    });

    let lines = `FPS: ${fps}  RTT: ${rtt}ms`;
    lines += `\nTransport: ${transport.toUpperCase()}`;
    lines += `\n${this._webrtcStatusLine(n)}`;
    lines += this._webrtcDetailLines(n, transport);
    lines += `\nAdvance: ${softAdv}f  Frame: ${frame}  Delay: ${inputDelay}f`;
    lines += this._rollbackLines(rm);

    // Set text (first child is the text node)
    const textNode = this._el.firstChild;
    if (textNode && textNode.nodeType === Node.TEXT_NODE) {
      textNode.textContent = lines;
    }

    // Apply RTT color to the whole overlay
    this._el.style.color = rttColor;
    // Forfeit button always white
    if (this._forfeitBtn) this._forfeitBtn.style.color = '#fff';
  }

  /** ICE state, candidate types, P2P RTT, DC buffer — only when on WebRTC. */
  private _webrtcDetailLines(n: Network, transport: 'websocket' | 'webrtc'): string {
    if (transport !== 'webrtc') return '';
    let out = '';
    const st = n.webrtcState;
    out += `\nICE: ${st.ice}  Gathering: ${st.gathering}`;
    if (st.localCandidate || st.remoteCandidate) {
      out += `\nCandidate: ${st.localCandidate ?? '?'} → ${st.remoteCandidate ?? '?'}`;
    }
    if (this._stats) {
      const s = this._stats;
      if (s.rttMs > 0) out += `\nP2P RTT: ${s.rttMs}ms`;
      out += `\nDC Buffer: ${s.bufferedAmount}B  Lost: ${s.packetsLost}`;
      if (n.isRelayed && s.bytesSent > 0) {
        const kbSent = (s.bytesSent / 1024).toFixed(1);
        const kbRecv = (s.bytesReceived / 1024).toFixed(1);
        out += `\nTURN: ↑${kbSent}KB ↓${kbRecv}KB`;
      }
    }
    return out;
  }

  /** Rollback netcode stats section. */
  private _rollbackLines(rm: RollbackManager | null): string {
    if (!rm) return '';
    const d = rm.diag;
    const avgDepth = d.rollbacks > 0 ? (d.rollbackDepthSum / d.rollbacks).toFixed(1) : '0';
    const mispredPct =
      d.predictionsTotal > 0 ? Math.round((d.mispredictions / d.predictionsTotal) * 100) : 0;
    const avgLag = d.inputLagCount > 0 ? (d.inputLagFramesSum / d.inputLagCount).toFixed(1) : '–';
    let out = `\nRollbacks: ${d.rollbacks} (avg ${avgDepth}f)`;
    out += `\nMisprediction: ${mispredPct}%`;
    out += `\nRemote Lag: ${avgLag}f  Stalls: ${d.stallFrames}f`;
    return out;
  }

  /** Build the WebRTC status summary line with symbol indicator. */
  private _webrtcStatusLine(n: Network): string {
    const transport = n.transportType;
    const failReason = n.webrtcFailReason;

    if (transport === 'webrtc') {
      const relay = n.isRelayed ? 'relay/TURN' : 'direct';
      return `WebRTC: \u2713 CONNECTED (${relay})`;
    }

    if (failReason) {
      return `WebRTC: \u2717 FAILED (${failReason})`;
    }

    // Neither connected nor failed — still attempting
    const st = n.webrtcState;
    if (st.connection !== 'n/a' && st.connection !== 'closed') {
      return `WebRTC: \u27F3 CONNECTING (${st.ice})`;
    }

    return 'WebRTC: \u2014 not attempted';
  }

  private _avgFps(): number {
    if (this._fpsSamples.length === 0) return 0;
    const sum = this._fpsSamples.reduce((a, b) => a + b, 0);
    return Math.round(sum / this._fpsSamples.length);
  }

  dispose(): void {
    if (this._keyHandler) {
      document.removeEventListener('keydown', this._keyHandler);
      this._keyHandler = null;
    }
    if (this._el) {
      this._el.remove();
      this._el = null;
    }
    this._forfeitBtn = null;
  }
}
