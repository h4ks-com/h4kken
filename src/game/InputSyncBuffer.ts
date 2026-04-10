// ============================================================
// H4KKEN - Input Synchronization Buffer
// Delay-based input sync for symmetric multiplayer.
// Both clients buffer inputs tagged by simulation frame and only
// advance the simulation when both players' inputs are available.
// ============================================================

import type { InputState } from '../Input';

function emptyInput(): InputState {
  return {
    up: false,
    down: false,
    left: false,
    right: false,
    block: false,
    lp: false,
    rp: false,
    lk: false,
    rk: false,
    upJust: false,
    downJust: false,
    leftJust: false,
    rightJust: false,
    lpJust: false,
    rpJust: false,
    lkJust: false,
    rkJust: false,
    dashLeft: false,
    dashRight: false,
    sideStepUp: false,
    sideStepDown: false,
    superJust: false,
  };
}

// Strip momentary flags from a confirmed input for prediction.
// Held buttons (directional, block, attack) stay; one-frame triggers clear.
function stripMomentaryFlags(input: InputState): InputState {
  return {
    ...input,
    upJust: false,
    downJust: false,
    leftJust: false,
    rightJust: false,
    lpJust: false,
    rpJust: false,
    lkJust: false,
    rkJust: false,
    forwardJust: false,
    backJust: false,
    dashLeft: false,
    dashRight: false,
    dashForward: false,
    dashBack: false,
    sideStepUp: false,
    sideStepDown: false,
    superJust: false,
  };
}

export class InputSyncBuffer {
  private delay: number;
  private maxStallFrames: number;

  // buffers[0] = P1 inputs, buffers[1] = P2 inputs (canonical player order)
  private buffers: [Map<number, InputState>, Map<number, InputState>] = [new Map(), new Map()];

  private lastConfirmed: [InputState, InputState] = [emptyInput(), emptyInput()];
  private stallCount = 0;
  private localIndex: 0 | 1;
  private remoteIndex: 0 | 1;

  constructor(localPlayerIndex: 0 | 1, delay = 3, maxStall = 6) {
    this.localIndex = localPlayerIndex;
    this.remoteIndex = localPlayerIndex === 0 ? 1 : 0;
    this.delay = delay;
    this.maxStallFrames = maxStall;
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
  getInputsForFrame(simFrame: number): [InputState, InputState] | null {
    const local = this.buffers[this.localIndex].get(simFrame);
    const remote = this.buffers[this.remoteIndex].get(simFrame);

    if (local && remote) {
      this.stallCount = 0;
      this.lastConfirmed[this.localIndex] = local;
      this.lastConfirmed[this.remoteIndex] = remote;
      this.buffers[0].delete(simFrame);
      this.buffers[1].delete(simFrame);
      return this.localIndex === 0 ? [local, remote] : [remote, local];
    }

    if (!local) {
      // Local input should always be available — captureInput runs before tryAdvance.
      return null;
    }

    // Remote missing — stall or predict
    this.stallCount++;
    if (this.stallCount < this.maxStallFrames) {
      return null;
    }

    // Stall budget exhausted — predict using last confirmed input with Just flags cleared
    const predicted = stripMomentaryFlags(this.lastConfirmed[this.remoteIndex]);
    this.lastConfirmed[this.localIndex] = local;
    this.buffers[this.localIndex].delete(simFrame);
    return this.localIndex === 0 ? [local, predicted] : [predicted, local];
  }

  reset(): void {
    this.buffers[0].clear();
    this.buffers[1].clear();
    this.lastConfirmed = [emptyInput(), emptyInput()];
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
