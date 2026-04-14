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
// Why: Console-only diagnostics (every 5s) are hard to correlate
// with gameplay feel. A live overlay lets you see exactly when
// rollbacks spike, whether WebRTC is active, and how latency
// behaves during specific in-game situations.
// ============================================================

import type { RollbackManager } from '../game/RollbackManager';
import type { Network } from '../Network';

export class NetworkOverlay {
  private _el: HTMLDivElement | null = null;
  private _visible = false;
  private _network: Network;
  private _keyHandler: ((e: KeyboardEvent) => void) | null = null;

  constructor(network: Network) {
    this._network = network;
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
      'pointer-events: none',
      'display: none',
      'line-height: 1.5',
      'white-space: pre',
    ].join(';');
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
  update(rm: RollbackManager | null, frame: number, inputDelay = 0): void {
    if (!this._visible || !this._el) return;

    const n = this._network;
    const rtt = n.rtt;
    const transport = n.transportType;

    // Derive soft frame advantage from RTT (same formula as Game.ts)
    const rttFrames = rtt / 16.67;
    const softAdv = Math.max(3, Math.min(8, Math.ceil(rttFrames) + 2));

    let lines = `RTT: ${rtt}ms  Transport: ${transport.toUpperCase()}`;
    lines += `\nSoft Advance: ${softAdv}f  Frame: ${frame}  InputDelay: ${inputDelay}f`;

    if (rm) {
      const d = rm.diag;
      const avgDepth = d.rollbacks > 0 ? (d.rollbackDepthSum / d.rollbacks).toFixed(1) : '0';
      const mispredPct =
        d.predictionsTotal > 0 ? Math.round((d.mispredictions / d.predictionsTotal) * 100) : 0;
      const avgLag = d.inputLagCount > 0 ? (d.inputLagFramesSum / d.inputLagCount).toFixed(1) : '–';

      lines += `\nRollbacks: ${d.rollbacks} (avg ${avgDepth}f)`;
      lines += `\nMisprediction: ${mispredPct}%`;
      lines += `\nRemote Lag: ${avgLag}f  Stalls: ${d.stallFrames}f`;
    }

    this._el.textContent = lines;
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
  }
}
