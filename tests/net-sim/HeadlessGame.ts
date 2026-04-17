// ============================================================
// H4KKEN - Headless Game (No Rendering)
// ============================================================
// Minimal game simulation loop that uses only the rollback
// manager + InputCodec without any Babylon.js, DOM, or audio
// dependencies. Designed for automated network testing.
//
// [Ref: GGPO] Headless replay validates determinism: same inputs → same state
// [Ref: AOE] "Determinism is the hardest bug" — headless tests catch desync early
//
// This emulates two local "clients" connected via SimLinks,
// each running their own RollbackManager against a shared
// deterministic simulation step.
//
// DETERMINISM VALIDATION: If both clients end with identical state
// after N frames, the sim is deterministic. Any divergence here means
// Math.random(), floating-point ordering, or time-dependent code leaked
// into the sim path. This is the primary regression test for desync.
// ============================================================

import { decodeSyncInput, encodeSyncInput, OP } from '../../src/game/InputCodec';
import {
  makeDiag,
  type RollbackDiag,
  type RollbackHost,
  RollbackManager,
} from '../../src/game/RollbackManager';
import type { InputState } from '../../src/Input';
import type { SimLink } from './NetSimulator';

// Minimal fighter state for headless testing — only tracks position and health.
// Full Fighter class requires Babylon.js scene which we deliberately skip.
interface MiniFighter {
  px: number;
  py: number;
  pz: number;
  vx: number;
  vy: number;
  vz: number;
  health: number;
}

interface HeadlessSnapshot {
  f1: MiniFighter;
  f2: MiniFighter;
  roundTimer: number;
  roundTimerAccum: number;
}

function cloneFighter(f: MiniFighter): MiniFighter {
  return { ...f };
}

function cloneSnapshot(s: HeadlessSnapshot): HeadlessSnapshot {
  return {
    f1: cloneFighter(s.f1),
    f2: cloneFighter(s.f2),
    roundTimer: s.roundTimer,
    roundTimerAccum: s.roundTimerAccum,
  };
}

function makeFighter(startX: number): MiniFighter {
  return { px: startX, py: 0, pz: 0, vx: 0, vy: 0, vz: 0, health: 100 };
}

/**
 * Simplified deterministic simulation step.
 * Applies movement from input (left/right/up) and a trivial punch mechanic.
 * Real game has full 3D combat — this only needs to be deterministic to
 * verify rollback correctness.
 */
function simStep(f1: MiniFighter, f2: MiniFighter, p1: InputState, p2: InputState): void {
  const speed = 0.1;
  if (p1.left) f1.px -= speed;
  if (p1.right) f1.px += speed;
  if (p1.up) f1.py = Math.min(f1.py + 0.15, 2); // simplified jump
  f1.py = Math.max(0, f1.py - 0.01); // gravity

  if (p2.left) f2.px -= speed;
  if (p2.right) f2.px += speed;
  if (p2.up) f2.py = Math.min(f2.py + 0.15, 2);
  f2.py = Math.max(0, f2.py - 0.01);

  // Simple punch: if lp pressed and within range, deal damage
  const dist = Math.abs(f1.px - f2.px);
  if (p1.lpJust && dist < 1.5) f2.health = Math.max(0, f2.health - 5);
  if (p2.lpJust && dist < 1.5) f1.health = Math.max(0, f1.health - 5);
}

export interface HeadlessStats {
  playerIndex: number;
  finalFrame: number;
  diag: RollbackDiag;
  f1Health: number;
  f2Health: number;
  f1Px: number;
  f2Px: number;
  stallFrames: number;
}

/**
 * One side of a headless match. Create two instances (player 0 and 1)
 * and wire their outLinks to each other's inLinks via SimLinks.
 */
export class HeadlessClient {
  readonly playerIndex: 0 | 1;
  frame = 0;
  private _f1: MiniFighter;
  private _f2: MiniFighter;
  private _roundTimer = 99;
  private _roundTimerAccum = 0;
  private _rm: RollbackManager;
  private _diag: RollbackDiag = makeDiag();
  private _outLink: SimLink;
  stallFrames = 0;

  constructor(playerIndex: 0 | 1, outLink: SimLink) {
    this.playerIndex = playerIndex;
    this._f1 = makeFighter(-3);
    this._f2 = makeFighter(3);
    this._rm = new RollbackManager(playerIndex);
    this._outLink = outLink;
  }

  /** Create the RollbackHost adapter (same shape as real Game._rollbackHost) */
  private get _host(): RollbackHost {
    const client = this;
    return {
      get frame() {
        return client.frame;
      },
      setFrame(f: number) {
        client.frame = f;
      },
      snapshotGame() {
        return cloneSnapshot({
          f1: client._f1,
          f2: client._f2,
          roundTimer: client._roundTimer,
          roundTimerAccum: client._roundTimerAccum,
        });
      },
      restoreGame(snap: HeadlessSnapshot) {
        client._f1 = cloneFighter(snap.f1);
        client._f2 = cloneFighter(snap.f2);
        client._roundTimer = snap.roundTimer;
        client._roundTimerAccum = snap.roundTimerAccum;
      },
      runSimStep(p1: InputState, p2: InputState) {
        simStep(client._f1, client._f2, p1, p2);
      },
      setReplaying(v: boolean) {
        client._replaying = v;
      },
    };
  }

  /** Call when a packet arrives from the network (via SimLink). */
  receivePacket(data: ArrayBuffer): void {
    const view = new DataView(data);
    const op = view.getUint8(0);
    // Accept both SYNC_INPUT (original) and OPPONENT_SYNC_INPUT (server-relayed)
    if (op === OP.SYNC_INPUT || op === OP.OPPONENT_SYNC_INPUT) {
      const { targetFrame, input } = decodeSyncInput(data);
      this._rm.receiveRemoteInput(targetFrame, input, this._host);
    }
  }

  /** Run one simulation tick with the given local input. */
  tick(localInput: InputState): void {
    // Stall check
    if (this._rm.shouldStall(this.frame)) {
      this.stallFrames++;
      this._diag.stallFrames++;
      return;
    }

    // Store local input and send to remote
    this._rm.addLocalInput(this.frame, localInput);
    const encoded = encodeSyncInput(this.frame, localInput);
    this._outLink.send(encoded);

    // Save snapshot, get inputs (with prediction), advance
    this._rm.saveSnapshot(this.frame, this._host);
    const inputs = this._rm.getInputsForFrame(this.frame);
    if (!inputs) return;

    simStep(this._f1, this._f2, inputs[0], inputs[1]);
    this.frame++;

    // Prune old data (keep MAX_ROLLBACK=30 frames of history)
    this._rm.prune(Math.max(0, this.frame - 30));
  }

  getStats(): HeadlessStats {
    // Merge RM-level counters (rollbacks, mispredictions) with client-level
    // counters (stallFrames). Use RM as base, selectively override game-level fields.
    const rmDiag = this._rm.diag;
    return {
      playerIndex: this.playerIndex,
      finalFrame: this.frame,
      diag: {
        ...rmDiag,
        stallFrames: this._diag.stallFrames,
      },
      f1Health: this._f1.health,
      f2Health: this._f2.health,
      f1Px: this._f1.px,
      f2Px: this._f2.px,
      stallFrames: this.stallFrames,
    };
  }
}
