// ============================================================
// H4KKEN - Test Scenarios
// ============================================================
// Pre-defined input scripts for headless network testing.
// Each scenario returns a function that produces the InputState
// for a given frame number, simulating different playstyles.
// ============================================================

import type { InputState } from '../../src/Input';

const NEUTRAL: InputState = {
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
  sideStepUp: false,
  sideStepDown: false,
  dashLeft: false,
  dashRight: false,
  superJust: false,
};

type InputScript = (frame: number) => InputState;

/** Walk right, throw a punch every 30 frames. */
function aggressivePusher(): InputScript {
  return (frame: number): InputState => ({
    ...NEUTRAL,
    right: true,
    lpJust: frame % 30 === 0,
    lp: frame % 30 === 0,
  });
}

/** Block for 20 frames, then sidestep and counter-punch. */
function defensiveCounterHitter(): InputScript {
  return (frame: number): InputState => {
    const cycle = frame % 60;
    if (cycle < 20) return { ...NEUTRAL, block: true, left: true };
    if (cycle === 20) return { ...NEUTRAL, sideStepUp: true };
    if (cycle === 25) return { ...NEUTRAL, lpJust: true, lp: true };
    return { ...NEUTRAL };
  };
}

/** Alternates movement directions with occasional jumps. */
function erraticMover(): InputScript {
  return (frame: number): InputState => {
    const phase = Math.floor(frame / 15) % 4;
    switch (phase) {
      case 0:
        return { ...NEUTRAL, right: true };
      case 1:
        return { ...NEUTRAL, left: true };
      case 2:
        return { ...NEUTRAL, up: true, upJust: frame % 15 === 0 };
      case 3:
        return { ...NEUTRAL, dashRight: true };
      default:
        return { ...NEUTRAL };
    }
  };
}

/** Does nothing — useful for testing one-sided rollback scenarios. */
function idle(): InputScript {
  return (): InputState => ({ ...NEUTRAL });
}

export const SCENARIOS: Record<string, { p1: InputScript; p2: InputScript; description: string }> =
  {
    'aggro-vs-aggro': {
      p1: aggressivePusher(),
      p2: aggressivePusher(),
      description: 'Both players walk forward and punch — tests mutual prediction errors',
    },
    'aggro-vs-defense': {
      p1: aggressivePusher(),
      p2: defensiveCounterHitter(),
      description: 'Attacker vs blocker — tests asymmetric rollback depth',
    },
    'erratic-vs-idle': {
      p1: erraticMover(),
      p2: idle(),
      description: 'Movement-heavy vs idle — tests prediction of direction changes',
    },
    'mirror-erratic': {
      p1: erraticMover(),
      p2: erraticMover(),
      description: 'Both players moving erratically — worst case for predictions',
    },
  };
