// ============================================================
// H4KKEN - Bot AI
// Aggressive CPU opponent with spacing awareness and combos
// ============================================================

import { FIGHTER_STATE, GAME_CONSTANTS } from '../constants';
import type { Fighter } from '../fighter/Fighter';
import type { InputState } from '../Input';

const GC = GAME_CONSTANTS;

export class BotAI {
  private _decisionTimer = 0;
  private _attackCooldown = 0;
  private _heldInput: Partial<InputState> = {};
  private _comboStep = 0;
  private _comboTimer = 0;

  getInput(bot: Fighter, opponent: Fighter): InputState {
    const input: InputState = emptyInput();

    if (bot.superMeter >= GC.SUPER_MAX && !bot.superPowerActive && !bot._pendingSuperActivation) {
      input.superJust = true;
      return input;
    }

    if (
      bot.state === FIGHTER_STATE.ATTACKING ||
      bot.state === FIGHTER_STATE.KNOCKDOWN ||
      bot.state === FIGHTER_STATE.GETUP ||
      bot.state === FIGHTER_STATE.LANDING ||
      bot.state === FIGHTER_STATE.JUGGLE
    ) {
      return input;
    }

    if (bot.state === FIGHTER_STATE.HIT_STUN || bot.state === FIGHTER_STATE.BLOCK_STUN) {
      input.block = true;
      this._decisionTimer = 10;
      this._heldInput = {};
      return input;
    }

    if (this._comboStep > 0 && this._comboTimer > 0) {
      this._comboTimer--;
      return this._driveCombo(input);
    }
    this._comboStep = 0;

    if (this._decisionTimer > 0) {
      this._decisionTimer--;
      if (this._heldInput.right) input.right = true;
      if (this._heldInput.left) input.left = true;
      if (this._heldInput.up) input.up = true;
      if (this._heldInput.down) input.down = true;
      if (this._heldInput.block) input.block = true;
      return input;
    }
    if (this._attackCooldown > 0) this._attackCooldown--;

    const dx = opponent.position.x - bot.position.x;
    const dz = opponent.position.z - bot.position.z;
    const dist = Math.sqrt(dx * dx + dz * dz);
    this._heldInput = {};

    if (dist > 4.5) return this._decideFar(input);
    if (dist > 2.5) return this._decideMid(input);
    return this._decideClose(input);
  }

  private _decideFar(input: InputState): InputState {
    if (Math.random() < 0.25) {
      input.dashRight = true;
      this._decisionTimer = 8;
    } else {
      this._heldInput.right = true;
      input.right = true;
      this._decisionTimer = 18;
    }
    return input;
  }

  private _decideMid(input: InputState): InputState {
    const rand = Math.random();
    if (rand < 0.35) {
      this._heldInput.right = true;
      input.right = true;
      this._decisionTimer = 14;
    } else if (rand < 0.55 && this._attackCooldown <= 0) {
      input.lkJust = true;
      input.lk = true;
      this._attackCooldown = 35;
      this._decisionTimer = 22;
    } else if (rand < 0.68 && this._attackCooldown <= 0) {
      input.upJust = true;
      input.up = true;
      this._heldInput.up = true;
      this._decisionTimer = 12;
    } else if (rand < 0.78) {
      input.sideStepDown = true;
      this._decisionTimer = 10;
    } else {
      this._decisionTimer = 10;
    }
    return input;
  }

  private _decideClose(input: InputState): InputState {
    const rand = Math.random();
    if (rand < 0.2 && this._attackCooldown <= 0) {
      input.lpJust = true;
      input.lp = true;
      this._comboStep = 1;
      this._comboTimer = 14;
      this._attackCooldown = 50;
      this._decisionTimer = 5;
    } else if (rand < 0.38 && this._attackCooldown <= 0) {
      input.rpJust = true;
      input.rp = true;
      this._attackCooldown = 40;
      this._decisionTimer = 20;
    } else if (rand < 0.52 && this._attackCooldown <= 0) {
      input.lkJust = true;
      input.lk = true;
      this._attackCooldown = 38;
      this._decisionTimer = 20;
    } else if (rand < 0.63 && this._attackCooldown <= 0) {
      input.rkJust = true;
      input.rk = true;
      this._attackCooldown = 45;
      this._decisionTimer = 25;
    } else if (rand < 0.72) {
      this._heldInput.left = true;
      this._heldInput.block = true;
      input.left = true;
      input.block = true;
      this._decisionTimer = 18;
    } else if (rand < 0.82) {
      this._heldInput.down = true;
      input.down = true;
      this._decisionTimer = 14;
    } else if (rand < 0.9) {
      input.sideStepUp = true;
      this._decisionTimer = 8;
    } else {
      input.dashLeft = true;
      this._decisionTimer = 10;
    }
    return input;
  }

  private _driveCombo(input: InputState): InputState {
    switch (this._comboStep) {
      case 1:
        // Follow lp with rp
        if (this._comboTimer === 8) {
          input.rpJust = true;
          input.rp = true;
          this._comboStep = 2;
          this._comboTimer = 12;
        }
        break;
      case 2:
        // Finish with rk
        if (this._comboTimer === 6) {
          input.rkJust = true;
          input.rk = true;
          this._comboStep = 0;
          this._comboTimer = 0;
        }
        break;
    }
    return input;
  }
}

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
