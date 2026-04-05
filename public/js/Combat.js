// ============================================================
// H4KKEN - Combat System & Move Data
// ============================================================

// Attack levels
export const LEVEL = {
  HIGH: 'high',
  MID: 'mid',
  LOW: 'low',
  THROW: 'throw',
};

// Hit results
export const HIT_RESULT = {
  STAGGER: 'stagger',      // Normal hitstun
  KNOCKBACK: 'knockback',  // Push back with stun
  LAUNCH: 'launch',        // Launcher into juggle
  KNOCKDOWN: 'knockdown',  // Knockdown
  CRUMPLE: 'crumple',      // Slow fall crumple
  THROW_HIT: 'throw',      // Throw
};

// Fighter states
export const FIGHTER_STATE = {
  IDLE: 'idle',
  WALK_FORWARD: 'walkForward',
  WALK_BACKWARD: 'walkBackward',
  CROUCH: 'crouch',
  CROUCH_WALK: 'crouchWalk',
  JUMP: 'jump',
  JUMP_FORWARD: 'jumpForward',
  JUMP_BACKWARD: 'jumpBackward',
  FALLING: 'falling',
  LANDING: 'landing',
  RUN: 'run',
  DASH_BACK: 'dashBack',
  SIDESTEP: 'sidestep',
  ATTACKING: 'attacking',
  BLOCKING: 'blocking',
  HIT_STUN: 'hitStun',
  BLOCK_STUN: 'blockStun',
  JUGGLE: 'juggle',
  KNOCKDOWN: 'knockdown',
  GETUP: 'getup',
  VICTORY: 'victory',
  DEFEAT: 'defeat',
};

// Game constants
export const GAME_CONSTANTS = {
  GRAVITY: -0.025,
  GROUND_Y: 0,
  ARENA_WIDTH: 12,        // half-width
  ARENA_DEPTH: 5,         // half-depth (for sidestepping)
  WALK_SPEED: 0.045,
  BACK_WALK_SPEED: 0.035,
  RUN_SPEED: 0.09,
  CROUCH_WALK_SPEED: 0.02,
  JUMP_VELOCITY: 0.28,
  JUMP_FORWARD_X: 0.05,
  SIDESTEP_SPEED: 0.08,
  SIDESTEP_FRAMES: 15,
  DASH_BACK_SPEED: 0.1,
  DASH_BACK_FRAMES: 18,
  PUSHBACK_DECAY: 0.85,
  THROW_RANGE: 1.8,
  MAX_HEALTH: 170,
  ROUND_TIME: 60,
  ROUNDS_TO_WIN: 2,
  JUGGLE_GRAVITY: -0.018,
  COMBO_SCALING_PER_HIT: 0.88,
  MIN_COMBO_SCALING: 0.2,
  GETUP_FRAMES: 30,
  LANDING_FRAMES: 8,
  WALL_BOUNCE_SPEED: 0.06,
};

// Move definitions
// Each move defines: name, command, input direction, level, damage,
// startup/active/recovery frames, hitstun, blockstun, on-hit result,
// pushback, animation name, hitbox data, and possible combo routes
export const MOVES = {
  // ========== STANDING ATTACKS ==========
  
  // Left Punch - fast jab, high
  lp: {
    name: 'Left Punch',
    command: 'lp',
    inputDir: null, // neutral
    level: LEVEL.HIGH,
    damage: 12,
    chipDamage: 1,
    startupFrames: 10,
    activeFrames: 3,
    recoveryFrames: 11,
    hitstun: 18,
    blockstun: 10,
    onHit: HIT_RESULT.STAGGER,
    pushback: 0.15,
    pushbackOnBlock: 0.2,
    animation: 'punch1',
    animSpeed: 1.3,
    hitboxOffset: { x: 0.7, y: 1.4, z: 0 },
    hitboxSize: { x: 0.4, y: 0.3, z: 0.4 },
    comboRoutes: ['rp', 'lk'],
    canChainFrom: [],
  },

  // Right Punch - straight, high, more damage
  rp: {
    name: 'Right Punch',
    command: 'rp',
    inputDir: null,
    level: LEVEL.HIGH,
    damage: 16,
    chipDamage: 2,
    startupFrames: 14,
    activeFrames: 3,
    recoveryFrames: 14,
    hitstun: 22,
    blockstun: 12,
    onHit: HIT_RESULT.STAGGER,
    pushback: 0.25,
    pushbackOnBlock: 0.3,
    animation: 'punch2',
    animSpeed: 1.2,
    hitboxOffset: { x: 0.8, y: 1.4, z: 0 },
    hitboxSize: { x: 0.45, y: 0.35, z: 0.4 },
    comboRoutes: ['lk', 'rk'],
    canChainFrom: ['lp'],
  },

  // Forward + LP - Body Blow, mid
  f_lp: {
    name: 'Body Blow',
    command: 'lp',
    inputDir: 'forward',
    level: LEVEL.MID,
    damage: 18,
    chipDamage: 2,
    startupFrames: 16,
    activeFrames: 4,
    recoveryFrames: 16,
    hitstun: 24,
    blockstun: 14,
    onHit: HIT_RESULT.KNOCKBACK,
    pushback: 0.35,
    pushbackOnBlock: 0.4,
    animation: 'punch1',
    animSpeed: 1.0,
    hitboxOffset: { x: 0.7, y: 1.1, z: 0 },
    hitboxSize: { x: 0.5, y: 0.4, z: 0.5 },
    comboRoutes: ['rp'],
    canChainFrom: [],
    forwardLunge: 0.04,
  },

  // Forward + RP - Power Straight, mid
  f_rp: {
    name: 'Power Straight',
    command: 'rp',
    inputDir: 'forward',
    level: LEVEL.MID,
    damage: 24,
    chipDamage: 3,
    startupFrames: 20,
    activeFrames: 4,
    recoveryFrames: 20,
    hitstun: 28,
    blockstun: 16,
    onHit: HIT_RESULT.KNOCKBACK,
    pushback: 0.45,
    pushbackOnBlock: 0.5,
    animation: 'heavyPunch',
    animSpeed: 1.0,
    hitboxOffset: { x: 0.9, y: 1.3, z: 0 },
    hitboxSize: { x: 0.5, y: 0.4, z: 0.5 },
    comboRoutes: [],
    canChainFrom: [],
    forwardLunge: 0.05,
  },

  // Down-Forward + RP - Launcher Uppercut
  df_rp: {
    name: 'Launcher',
    command: 'rp',
    inputDir: 'df',
    level: LEVEL.MID,
    damage: 20,
    chipDamage: 3,
    startupFrames: 16,
    activeFrames: 4,
    recoveryFrames: 26,
    hitstun: 40,
    blockstun: 18,
    onHit: HIT_RESULT.LAUNCH,
    launchVelocity: 0.32,
    pushback: 0.15,
    pushbackOnBlock: 0.4,
    animation: 'heavyPunch',
    animSpeed: 1.1,
    hitboxOffset: { x: 0.7, y: 1.5, z: 0 },
    hitboxSize: { x: 0.5, y: 0.5, z: 0.5 },
    comboRoutes: [],
    canChainFrom: [],
    forwardLunge: 0.03,
  },

  // Down + RP - Uppercut from crouch, mid
  d_rp: {
    name: 'Rising Upper',
    command: 'rp',
    inputDir: 'down',
    level: LEVEL.MID,
    damage: 22,
    chipDamage: 3,
    startupFrames: 15,
    activeFrames: 4,
    recoveryFrames: 24,
    hitstun: 35,
    blockstun: 16,
    onHit: HIT_RESULT.LAUNCH,
    launchVelocity: 0.28,
    pushback: 0.1,
    pushbackOnBlock: 0.35,
    animation: 'heavyPunch',
    animSpeed: 1.2,
    hitboxOffset: { x: 0.6, y: 1.6, z: 0 },
    hitboxSize: { x: 0.4, y: 0.5, z: 0.4 },
    comboRoutes: [],
    canChainFrom: [],
    requiresCrouch: true,
  },

  // Left Kick - mid
  lk: {
    name: 'Left Kick',
    command: 'lk',
    inputDir: null,
    level: LEVEL.MID,
    damage: 14,
    chipDamage: 2,
    startupFrames: 13,
    activeFrames: 3,
    recoveryFrames: 14,
    hitstun: 20,
    blockstun: 12,
    onHit: HIT_RESULT.STAGGER,
    pushback: 0.2,
    pushbackOnBlock: 0.25,
    animation: 'kickRight',
    animSpeed: 1.0,
    hitboxOffset: { x: 0.8, y: 0.9, z: 0 },
    hitboxSize: { x: 0.5, y: 0.35, z: 0.5 },
    comboRoutes: ['rk', 'rp'],
    canChainFrom: ['lp', 'rp'],
  },

  // Right Kick - mid, slower, more powerful
  rk: {
    name: 'Right Kick',
    command: 'rk',
    inputDir: null,
    level: LEVEL.MID,
    damage: 20,
    chipDamage: 3,
    startupFrames: 18,
    activeFrames: 4,
    recoveryFrames: 18,
    hitstun: 26,
    blockstun: 14,
    onHit: HIT_RESULT.KNOCKBACK,
    pushback: 0.35,
    pushbackOnBlock: 0.4,
    animation: 'kickLeft',
    animSpeed: 1.0,
    hitboxOffset: { x: 0.9, y: 0.8, z: 0 },
    hitboxSize: { x: 0.5, y: 0.4, z: 0.5 },
    comboRoutes: [],
    canChainFrom: ['lk'],
  },

  // Down + LK - Low kick
  d_lk: {
    name: 'Low Kick',
    command: 'lk',
    inputDir: 'down',
    level: LEVEL.LOW,
    damage: 10,
    chipDamage: 1,
    startupFrames: 12,
    activeFrames: 3,
    recoveryFrames: 14,
    hitstun: 16,
    blockstun: 10,
    onHit: HIT_RESULT.STAGGER,
    pushback: 0.1,
    pushbackOnBlock: 0.15,
    animation: 'lowKick',
    animSpeed: 1.0,
    hitboxOffset: { x: 0.7, y: 0.3, z: 0 },
    hitboxSize: { x: 0.5, y: 0.3, z: 0.5 },
    comboRoutes: ['d_rk'],
    canChainFrom: [],
    requiresCrouch: true,
  },

  // Down + RK - Sweep, low, knockdown
  d_rk: {
    name: 'Sweep',
    command: 'rk',
    inputDir: 'down',
    level: LEVEL.LOW,
    damage: 18,
    chipDamage: 2,
    startupFrames: 20,
    activeFrames: 4,
    recoveryFrames: 28,
    hitstun: 30,
    blockstun: 18,
    onHit: HIT_RESULT.KNOCKDOWN,
    pushback: 0.2,
    pushbackOnBlock: 0.3,
    animation: 'sweepKick',
    animSpeed: 1.0,
    hitboxOffset: { x: 0.8, y: 0.2, z: 0 },
    hitboxSize: { x: 0.6, y: 0.3, z: 0.6 },
    comboRoutes: [],
    canChainFrom: ['d_lk'],
    requiresCrouch: true,
  },

  // Down + LP - Crouch Jab, low
  d_lp: {
    name: 'Crouch Jab',
    command: 'lp',
    inputDir: 'down',
    level: LEVEL.LOW,
    damage: 8,
    chipDamage: 1,
    startupFrames: 10,
    activeFrames: 3,
    recoveryFrames: 12,
    hitstun: 14,
    blockstun: 8,
    onHit: HIT_RESULT.STAGGER,
    pushback: 0.1,
    pushbackOnBlock: 0.12,
    animation: 'punch1',
    animSpeed: 1.4,
    hitboxOffset: { x: 0.6, y: 0.5, z: 0 },
    hitboxSize: { x: 0.4, y: 0.3, z: 0.4 },
    comboRoutes: ['d_rp', 'd_lk'],
    canChainFrom: [],
    requiresCrouch: true,
  },

  // Heavy Punch - big power move
  heavy: {
    name: 'Hammer Fist',
    command: 'rp',
    inputDir: null,
    isHeavy: true,
    level: LEVEL.MID,
    damage: 30,
    chipDamage: 5,
    startupFrames: 24,
    activeFrames: 5,
    recoveryFrames: 24,
    hitstun: 35,
    blockstun: 20,
    onHit: HIT_RESULT.CRUMPLE,
    pushback: 0.4,
    pushbackOnBlock: 0.5,
    animation: 'heavyPunch',
    animSpeed: 0.85,
    hitboxOffset: { x: 0.8, y: 1.3, z: 0 },
    hitboxSize: { x: 0.6, y: 0.5, z: 0.5 },
    comboRoutes: [],
    canChainFrom: [],
    forwardLunge: 0.03,
  },

  // Throw (LP + LK)
  throw_cmd: {
    name: 'Throw',
    command: 'throw',
    inputDir: null,
    level: LEVEL.THROW,
    damage: 35,
    chipDamage: 0,
    startupFrames: 12,
    activeFrames: 3,
    recoveryFrames: 30,
    hitstun: 0,
    blockstun: 0,
    onHit: HIT_RESULT.THROW_HIT,
    pushback: 0,
    pushbackOnBlock: 0,
    animation: 'heavyPunch',
    animSpeed: 0.9,
    hitboxOffset: { x: 0.5, y: 1.2, z: 0 },
    hitboxSize: { x: 0.5, y: 0.5, z: 0.5 },
    comboRoutes: [],
    canChainFrom: [],
    throwMove: true,
  },

  // While Running Attack
  running_attack: {
    name: 'Shoulder Tackle',
    command: 'auto',
    inputDir: 'run',
    level: LEVEL.MID,
    damage: 28,
    chipDamage: 4,
    startupFrames: 8,
    activeFrames: 6,
    recoveryFrames: 22,
    hitstun: 30,
    blockstun: 18,
    onHit: HIT_RESULT.KNOCKDOWN,
    pushback: 0.5,
    pushbackOnBlock: 0.6,
    animation: 'heavyPunch',
    animSpeed: 1.3,
    hitboxOffset: { x: 0.6, y: 1.0, z: 0 },
    hitboxSize: { x: 0.6, y: 0.6, z: 0.5 },
    comboRoutes: [],
    canChainFrom: [],
    forwardLunge: 0.08,
  },
};

// Combo string definitions
export const COMBO_STRINGS = [
  {
    name: '1-2 Combo',
    sequence: ['lp', 'rp'],
    timing: 24, // max frames between hits
  },
  {
    name: '1-2-3 String',
    sequence: ['lp', 'rp', 'lk'],
    timing: 24,
  },
  {
    name: '1-1-2 String',
    sequence: ['lp', 'lp', 'rp'],
    timing: 20,
  },
  {
    name: 'Kick Combo',
    sequence: ['lk', 'rk'],
    timing: 26,
  },
  {
    name: 'Rush Combo',
    sequence: ['lp', 'lk', 'rp', 'rk'],
    timing: 24,
  },
];


// ============================================================
// Combat Resolution
// ============================================================

export class CombatSystem {
  
  static resolveMove(input, fighter) {
    const { state, isCrouching } = fighter;
    
    // Can't attack during these states
    const noAttackStates = [
      FIGHTER_STATE.HIT_STUN, FIGHTER_STATE.BLOCK_STUN,
      FIGHTER_STATE.JUGGLE, FIGHTER_STATE.KNOCKDOWN,
      FIGHTER_STATE.GETUP, FIGHTER_STATE.LANDING,
      FIGHTER_STATE.VICTORY, FIGHTER_STATE.DEFEAT,
    ];
    if (noAttackStates.includes(state)) return null;

    // Currently attacking - check combo routes
    if (state === FIGHTER_STATE.ATTACKING && fighter.currentMove) {
      return this.resolveComboInput(input, fighter);
    }

    // Throw: LP + LK simultaneously
    if (input.lpJust && input.lkJust) {
      return MOVES.throw_cmd;
    }

    // Running attack
    if (state === FIGHTER_STATE.RUN && (input.lpJust || input.rpJust || input.lkJust || input.rkJust)) {
      return MOVES.running_attack;
    }

    // Directional + button commands
    // Down-Forward + RP = Launcher
    if (input.down && input.forward && input.rpJust) {
      return MOVES.df_rp;
    }

    // Crouching attacks
    if (isCrouching || input.down) {
      if (input.rpJust) return MOVES.d_rp;
      if (input.lpJust) return MOVES.d_lp;
      if (input.rkJust) return MOVES.d_rk;
      if (input.lkJust) return MOVES.d_lk;
    }

    // Forward + button
    if (input.forward) {
      if (input.rpJust) return MOVES.f_rp;
      if (input.lpJust) return MOVES.f_lp;
    }

    // Neutral attacks
    if (input.lpJust) return MOVES.lp;
    if (input.rpJust) return MOVES.rp;
    if (input.lkJust) return MOVES.lk;
    if (input.rkJust) return MOVES.rk;

    return null;
  }

  static resolveComboInput(input, fighter) {
    const currentMove = fighter.currentMove;
    const moveFrame = fighter.moveFrame;
    // Can only chain during recovery or late active frames
    const chainWindowStart = currentMove.startupFrames + currentMove.activeFrames - 2;
    if (moveFrame < chainWindowStart) return null;

    // Check if the pressed button leads to a valid combo route
    let nextMoveId = null;
    if (input.lpJust && currentMove.comboRoutes.includes('lp')) nextMoveId = 'lp';
    if (input.rpJust && currentMove.comboRoutes.includes('rp')) nextMoveId = 'rp';
    if (input.lkJust && currentMove.comboRoutes.includes('lk')) nextMoveId = 'lk';
    if (input.rkJust && currentMove.comboRoutes.includes('rk')) nextMoveId = 'rk';

    // Also check directional combos
    if (input.down) {
      if (input.rpJust && currentMove.comboRoutes.includes('d_rp')) nextMoveId = 'd_rp';
      if (input.lkJust && currentMove.comboRoutes.includes('d_lk')) nextMoveId = 'd_lk';
      if (input.rkJust && currentMove.comboRoutes.includes('d_rk')) nextMoveId = 'd_rk';
    }

    if (nextMoveId && MOVES[nextMoveId]) {
      return MOVES[nextMoveId];
    }

    return null;
  }

  // Determine if attack is blocked
  static isBlocked(attacker, defender, move) {
    // Can't block while in hitstun, juggle, knockdown, etc.
    const unblockableStates = [
      FIGHTER_STATE.HIT_STUN, FIGHTER_STATE.JUGGLE,
      FIGHTER_STATE.KNOCKDOWN, FIGHTER_STATE.GETUP,
    ];
    if (unblockableStates.includes(defender.state)) return false;
    
    // Must be holding back
    if (!defender.isBlocking) return false;

    // Throws can't be blocked (but can be ducked/thrown)
    if (move.level === LEVEL.THROW) return false;

    // Standing block: blocks high and mid, but not low
    if (!defender.isCrouching) {
      if (move.level === LEVEL.LOW) return false;
      return true;
    }

    // Crouching block: blocks low only. Mid attacks hit crouchers (Tekken-style).
    // High attacks whiff over crouchers (handled by highWhiffs).
    if (move.level === LEVEL.HIGH) return false;
    if (move.level === LEVEL.MID) return false;
    return true; // blocks LOW
  }

  // Check if high attack whiffs over crouching opponent
  static highWhiffs(move, defender) {
    if (move.level === LEVEL.HIGH && defender.isCrouching) {
      return true;
    }
    return false;
  }

  // Calculate actual damage with combo scaling
  static calculateDamage(baseDamage, comboHits) {
    if (comboHits <= 1) return baseDamage;
    const scaling = Math.max(
      GAME_CONSTANTS.MIN_COMBO_SCALING,
      Math.pow(GAME_CONSTANTS.COMBO_SCALING_PER_HIT, comboHits - 1)
    );
    return Math.round(baseDamage * scaling);
  }

  // Resolve a hit between attacker and defender
  static resolveHit(attacker, defender, move) {
    // Check if high attack whiffs over crouch
    if (this.highWhiffs(move, defender)) {
      return { type: 'whiff' };
    }

    // Check blocking
    if (this.isBlocked(attacker, defender, move)) {
      return {
        type: 'blocked',
        blockstun: move.blockstun,
        pushback: move.pushbackOnBlock,
        chipDamage: move.chipDamage,
      };
    }

    // Hit connects
    const comboHits = (defender.comboCount || 0) + 1;
    const damage = this.calculateDamage(move.damage, comboHits);

    return {
      type: 'hit',
      damage,
      hitstun: move.hitstun,
      pushback: move.pushback,
      onHit: move.onHit,
      launchVelocity: move.launchVelocity || 0,
      comboHits,
    };
  }

  // Check hitbox collision (AABB)
  static checkHitbox(attackerPos, attackerFacingAngle, move, defenderPos, defenderWidth = 0.5) {
    // Calculate hitbox world position by projecting offset along fight axis
    const cosA = Math.cos(attackerFacingAngle);
    const sinA = Math.sin(attackerFacingAngle);
    // hitboxOffset.x = forward distance, hitboxOffset.z = lateral distance
    const fwdOff = move.hitboxOffset.x;
    const latOff = move.hitboxOffset.z || 0;
    const hbx = attackerPos.x + fwdOff * cosA - latOff * sinA;
    const hby = attackerPos.y + move.hitboxOffset.y;
    const hbz = attackerPos.z + fwdOff * sinA + latOff * cosA;

    // Defender hurtbox (simplified as box around position)
    const defHalfW = defenderWidth;
    const defH = 1.8; // standing height
    const defHalfD = 0.4;

    // AABB collision
    const overlapX = Math.abs(hbx - defenderPos.x) < (move.hitboxSize.x + defHalfW);
    const overlapY = (hby + move.hitboxSize.y) > defenderPos.y && (hby - move.hitboxSize.y) < (defenderPos.y + defH);
    const overlapZ = Math.abs(hbz - defenderPos.z) < (move.hitboxSize.z + defHalfD);

    return overlapX && overlapY && overlapZ;
  }
}
