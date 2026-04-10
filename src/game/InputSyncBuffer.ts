// ============================================================
// H4KKEN - Input Synchronization Buffer
// Delay-based input sync for symmetric multiplayer.
// Both clients buffer inputs tagged by simulation frame and only
// advance the simulation when both players' inputs are available.
// No prediction — the game stalls until real inputs arrive.
// This prevents permanent desync (prediction without rollback
// causes divergence that never self-corrects).
// ============================================================

import type { InputState } from '../Input';

export class InputSyncBuffer {
  private delay: number;

  // buffers[0] = P1 inputs, buffers[1] = P2 inputs (canonical player order)
  private buffers: [Map<number, InputState>, Map<number, InputState>] = [new Map(), new Map()];

  private stallCount = 0;
  private localIndex: 0 | 1;
  private remoteIndex: 0 | 1;

  constructor(localPlayerIndex: 0 | 1, delay = 3) {
    this.localIndex = localPlayerIndex;
    this.remoteIndex = localPlayerIndex === 0 ? 1 : 0;
    this.delay = delay;
  }

  get inputDelay(): number {
    return this.delay;
  }

  get currentStall(): number {
    return this.stallCount;
  }

  // Tag local input for a future simulation frame and store it.
  addLocalInput(captureFrame: number, input: InputState): number {
    const targetFrame = captureFrame + this.delay;
    this.buffers[this.localIndex].set(targetFrame, input);
    return targetFrame;
  }

  // Store opponent input received from the network.
  addRemoteInput(targetFrame: number, input: InputState): void {
    this.buffers[this.remoteIndex].set(targetFrame, input);
  }

  // Try to retrieve both inputs for the given simulation frame.
  // Returns [p1Input, p2Input] or null if the simulation should stall.
  // Never predicts — stalls until both real inputs are available.
  getInputsForFrame(simFrame: number): [InputState, InputState] | null {
    const local = this.buffers[this.localIndex].get(simFrame);
    const remote = this.buffers[this.remoteIndex].get(simFrame);

    if (local && remote) {
      this.stallCount = 0;
      this.buffers[0].delete(simFrame);
      this.buffers[1].delete(simFrame);
      return this.localIndex === 0 ? [local, remote] : [remote, local];
    }

    this.stallCount++;
    return null;
  }

  reset(): void {
    this.buffers[0].clear();
    this.buffers[1].clear();
    this.stallCount = 0;
  }

  prune(beforeFrame: number): void {
    for (const buf of this.buffers) {
      for (const frame of buf.keys()) {
        if (frame < beforeFrame) buf.delete(frame);
      }
    }
  }
}
