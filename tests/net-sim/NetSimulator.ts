// ============================================================
// H4KKEN - Network Simulator
// ============================================================
// Simulates network conditions (latency, jitter, packet loss)
// for headless testing of the rollback netcode. Runs without
// a browser — pure TypeScript, no DOM or Babylon.js dependency.
//
// [Ref: GOOGLE-LOSS] Gilbert-Elliott bursty loss model informs realistic test profiles
// [Ref: EDGEGAP] 31% of latency from infrastructure — test profiles model real routes
//
// Why headless: automated CI tests can verify rollback correctness
// and measure desync rates under various network profiles without
// needing two real browser instances or a real server.
// ============================================================

export interface NetProfile {
  /** One-way latency in ms */
  latencyMs: number;
  /** Random ± jitter added to latency */
  jitterMs: number;
  /** Probability [0,1] of dropping a packet */
  packetLoss: number;
  /** Label for logging */
  name: string;
}

export const NET_PROFILES: Record<string, NetProfile> = {
  lan: { latencyMs: 2, jitterMs: 1, packetLoss: 0, name: 'LAN' },
  broadband: { latencyMs: 30, jitterMs: 5, packetLoss: 0.001, name: 'Broadband' },
  // Mexico ↔ Germany typical: ~90ms one-way, moderate jitter
  intercontinental: { latencyMs: 90, jitterMs: 15, packetLoss: 0.005, name: 'MX↔DE' },
  // Worst case: high latency VPN with packet loss
  worstCase: { latencyMs: 150, jitterMs: 30, packetLoss: 0.02, name: 'Worst-case VPN' },
};

interface QueuedPacket {
  data: ArrayBuffer;
  deliverAt: number;
}

/**
 * Simulates a unidirectional network link with configurable latency,
 * jitter, and packet loss. Used in pairs (one per direction).
 */
export class SimLink {
  private _queue: QueuedPacket[] = [];
  private _profile: NetProfile;
  private _clock = 0;
  onDeliver: ((data: ArrayBuffer) => void) | null = null;

  constructor(profile: NetProfile) {
    this._profile = profile;
  }

  /** Enqueue a packet. It will be delivered after the simulated delay. */
  send(data: ArrayBuffer): void {
    // Simulate packet loss
    if (Math.random() < this._profile.packetLoss) return;

    const jitter = (Math.random() * 2 - 1) * this._profile.jitterMs;
    const delay = Math.max(0, this._profile.latencyMs + jitter);
    this._queue.push({ data, deliverAt: this._clock + delay });
  }

  /** Advance the clock by `dt` ms and deliver any matured packets. */
  tick(dt: number): void {
    this._clock += dt;
    let i = 0;
    while (i < this._queue.length) {
      if (this._queue[i].deliverAt <= this._clock) {
        const pkt = this._queue.splice(i, 1)[0];
        this.onDeliver?.(pkt.data);
      } else {
        i++;
      }
    }
  }

  get pending(): number {
    return this._queue.length;
  }
}
