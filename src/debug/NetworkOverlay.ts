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
// ============================================================

import { ArcRotateCamera, type Camera, type Scene, Vector3 } from '@babylonjs/core';
import type { RollbackManager } from '../game/RollbackManager';
import type { Network } from '../Network';
import type { WebRTCStats } from '../transport/WebRTCTransport';

type OverlayMode = 'online' | 'practice';

interface FreeCamHooks {
  scene: Scene;
  canvas: HTMLCanvasElement;
  gameCamera: Camera;
}

export class NetworkOverlay {
  private _el: HTMLDivElement | null = null;
  private _textEl: HTMLPreElement | null = null;
  private _visible = false;
  private _network: Network | null;
  private _keyHandler: ((e: KeyboardEvent) => void) | null = null;

  private _fpsSamples: number[] = [];
  private _lastFrameTime = 0;

  private _stats: WebRTCStats | null = null;

  private _freeCamHooks: FreeCamHooks | null;
  private _freeCam: ArcRotateCamera | null = null;
  private _freeCamActive = false;
  private _savedAutoClear = false;
  private _savedAutoClearDS = false;

  constructor(
    network: Network | null,
    _mode: OverlayMode = 'online',
    freeCamHooks: FreeCamHooks | null = null,
  ) {
    this._network = network;
    this._freeCamHooks = freeCamHooks;
    this._createDOM();
    this._bindToggle();
  }

  get freeCamActive(): boolean {
    return this._freeCamActive;
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
    ].join(';');

    if (this._freeCamHooks) {
      const row = document.createElement('label');
      row.style.cssText =
        'display:flex;align-items:center;gap:6px;margin-bottom:4px;cursor:pointer;user-select:none;';
      const cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.id = 'free-cam-toggle';
      cb.style.cssText = 'cursor:pointer;';
      cb.addEventListener('change', () => this._setFreeCam(cb.checked));
      const txt = document.createElement('span');
      txt.textContent = 'Free Cam (orbit/zoom)';
      row.appendChild(cb);
      row.appendChild(txt);
      el.appendChild(row);
    }

    const pre = document.createElement('pre');
    pre.style.cssText = 'margin:0;font-family:monospace;font-size:11px;white-space:pre;';
    el.appendChild(pre);
    this._textEl = pre;

    document.body.appendChild(el);
    this._el = el;
  }

  private _setFreeCam(enabled: boolean): void {
    if (!this._freeCamHooks) return;
    const { scene, canvas, gameCamera } = this._freeCamHooks;

    if (enabled) {
      if (!this._freeCam) {
        const cam = new ArcRotateCamera(
          'freeCam',
          -Math.PI / 2,
          Math.PI / 2.5,
          12,
          new Vector3(0, 1.2, 0),
          scene,
        );
        cam.minZ = 0.1;
        cam.maxZ = 200;
        cam.wheelPrecision = 30;
        cam.panningSensibility = 60;
        cam.lowerRadiusLimit = 1.5;
        cam.upperRadiusLimit = 60;
        this._freeCam = cam;
      }
      this._freeCam.attachControl(canvas, true);
      this._savedAutoClear = scene.autoClear;
      this._savedAutoClearDS = scene.autoClearDepthAndStencil;
      scene.autoClear = true;
      scene.autoClearDepthAndStencil = true;
      scene.activeCamera = this._freeCam;
      this._freeCamActive = true;
    } else {
      if (this._freeCam) {
        this._freeCam.detachControl();
      }
      scene.autoClear = this._savedAutoClear;
      scene.autoClearDepthAndStencil = this._savedAutoClearDS;
      scene.activeCamera = gameCamera;
      this._freeCamActive = false;
    }
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

    if (!this._network) {
      if (this._textEl) {
        this._textEl.textContent = `FPS: ${fps}  Frame: ${frame}\nMode: PRACTICE`;
      }
      this._el.style.color = '#0f0';
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

    if (this._textEl) {
      this._textEl.textContent = lines;
    }
    this._el.style.color = rttColor;
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
    if (this._freeCam) {
      if (this._freeCamActive && this._freeCamHooks) {
        const { scene, gameCamera } = this._freeCamHooks;
        scene.autoClear = this._savedAutoClear;
        scene.autoClearDepthAndStencil = this._savedAutoClearDS;
        scene.activeCamera = gameCamera;
      }
      this._freeCam.detachControl();
      this._freeCam.dispose();
      this._freeCam = null;
      this._freeCamActive = false;
    }
    if (this._el) {
      this._el.remove();
      this._el = null;
    }
    this._textEl = null;
  }
}
