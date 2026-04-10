// ============================================================
// H4KKEN - Fighter (Model, Animation, State Machine, Physics)
// Babylon.js — GLB assets (Quaternius Universal Animation Library)
// ============================================================

// Side-effect import: registers the glTF/GLB loader plugin with SceneLoader
import '@babylonjs/loaders/glTF';
import {
  type AbstractMesh,
  type AnimationGroup,
  type Bone,
  Color3,
  PBRMaterial,
  Quaternion,
  type Scene,
  SceneLoader,
  type Skeleton,
  StandardMaterial,
  TransformNode,
  Vector3,
} from '@babylonjs/core';
import {
  CombatSystem,
  FIGHTER_STATE,
  GAME_CONSTANTS,
  HIT_RESULT,
  type HitResult,
  MOVES,
  type MoveData,
} from './Combat';
import type { InputState } from './Input';
import type { FighterStateSync } from './Network';

export interface SharedAssets {
  baseMeshes: AbstractMesh[];
  baseSkeleton: Skeleton | null;
  animGroups: Record<string, AnimationGroup>;
}

const GC = GAME_CONSTANTS;

// ── GLB clip name validation ──────────────────────────────────────────────
// Typed unions of every clip in each GLB. Using these in AnimConfig.glb gives
// compile-time errors when a clip name is misspelled or doesn't exist.
const UAL1_CLIPS = [
  'A_TPose',
  'BackFlip',
  'Celebration',
  'Crawl_Bwd_Loop',
  'Crawl_Enter',
  'Crawl_Exit',
  'Crawl_Fwd_Loop',
  'Crawl_Idle_Loop',
  'Crawl_Left_Loop',
  'Crawl_Right_Loop',
  'Crouch_Bwd_Loop',
  'Crouch_Enter',
  'Crouch_Exit',
  'Crouch_Fwd_Loop',
  'Crouch_Idle_Loop',
  'Crying',
  'Dance_Loop',
  'Death01',
  'Death02',
  'Dodge_Left',
  'Dodge_Right',
  'Drink',
  'Fixing_Kneeling',
  'GroundSit_Enter',
  'GroundSit_Exit',
  'GroundSit_Idle_Loop',
  'Hit_Chest',
  'Hit_Head',
  'Hit_Shoulder_L',
  'Hit_Shoulder_R',
  'Hit_Stomach',
  'Idle_LookAround_Loop',
  'Idle_Loop',
  'Idle_Talking_Loop',
  'Idle_Tired_Loop',
  'Interact',
  'Jog_Bwd_Loop',
  'Jog_Fwd_Loop',
  'Jog_Left_Loop',
  'Jog_Right_Loop',
  'Jump_Land',
  'Jump_Loop',
  'Jump_Start',
  'Kick',
  'Punch_Cross',
  'Punch_Jab',
  'PunchKick_Enter',
  'PunchKick_Exit',
  'Roll',
  'Sprint_Loop',
  'Spell_Double_Enter',
  'Spell_Double_Exit',
  'Spell_Double_Idle_Loop',
  'Spell_Double_Shoot_Loop',
  'Turn90_L',
  'Turn90_R',
  'Walk_Loop',
] as const;

const UAL2_CLIPS = [
  'Hit_Knockback',
  'Idle_FoldArms_Loop',
  'Idle_No_Loop',
  'IdleToLay',
  'KipUp',
  'LayToIdle',
  'LiftAir_Hit_L',
  'LiftAir_Hit_R',
  'Melee_Combo',
  'Melee_Hook',
  'Melee_Hook_Rec',
  'Melee_Knee',
  'Melee_Knee_Rec',
  'Melee_Uppercut',
  'Slide_Exit',
  'Slide_Loop',
  'Slide_Start',
  'Walk_Bwd_Loop',
  'Walk_Fwd_Loop',
  'Yes',
] as const;

type Ual1Clip = (typeof UAL1_CLIPS)[number];
type Ual2Clip = (typeof UAL2_CLIPS)[number];
type AnimClip = Ual1Clip | Ual2Clip;

// Animation configuration table — single source of truth for all animation bindings.
// glb:   exact clip name inside the GLB (typed — typos are compile errors)
// src:   'ual1' = character.glb (default), 'ual2' = UAL2.glb
// loop:  whether the clip loops (default false)
// speed: playback speed multiplier (default 1.0)
// blend: crossfade blend duration in seconds (default 0.15)
interface AnimConfig {
  glb: AnimClip;
  src?: 'ual1' | 'ual2';
  loop?: boolean;
  speed?: number;
  blend?: number;
}

const ANIM_CONFIG = {
  // ── Idle / neutral ──────────────────────────────────────────────────────
  idle: { glb: 'Idle_Loop', loop: true, blend: 0.2 },
  combatIdle: { glb: 'Idle_Loop', loop: true, blend: 0.2 },
  // ── Crouch ──────────────────────────────────────────────────────────────
  crouchIdle: { glb: 'Crouch_Idle_Loop', loop: true, blend: 0.15 },
  crouchEnter: { glb: 'Crouch_Enter', speed: 4.0, blend: 0.1 },
  crouchExit: { glb: 'Crouch_Exit', speed: 4.0, blend: 0.1 },
  crouchWalk: { glb: 'Crouch_Fwd_Loop', loop: true, blend: 0.2 },
  crouchWalkBack: { glb: 'Crouch_Bwd_Loop', loop: true, blend: 0.2 },
  // ── Locomotion ──────────────────────────────────────────────────────────
  walk: { glb: 'Walk_Loop', loop: true, blend: 0.2 },
  // UAL2 Walk_Bwd_Loop is a proper backward walk; Jog_Bwd_Loop looked like running
  walkBack: { glb: 'Walk_Bwd_Loop', src: 'ual2', loop: true, blend: 0.2 },
  walkLeft: { glb: 'Jog_Left_Loop', loop: true, blend: 0.2 },
  walkRight: { glb: 'Jog_Right_Loop', loop: true, blend: 0.2 },
  run: { glb: 'Jog_Fwd_Loop', loop: true, blend: 0.2 },
  runBack: { glb: 'Jog_Bwd_Loop', loop: true, speed: 1.5, blend: 0.1 },
  sprint: { glb: 'Sprint_Loop', loop: true, blend: 0.15 },
  // ── Air ─────────────────────────────────────────────────────────────────
  // jumpSquat plays a fast crouch anticipation (visual only, physics starts immediately)
  jumpSquat: { glb: 'Crouch_Enter', speed: 6.0, blend: 0.05 },
  jump: { glb: 'Jump_Start', blend: 0.1 },
  falling: { glb: 'Jump_Loop', loop: true, blend: 0.1 },
  landing: { glb: 'Jump_Land', blend: 0.1 },
  // ── Attacks ─────────────────────────────────────────────────────────────
  // speed for attacks is auto-calculated from frame data in startAttack()
  punch1: { glb: 'Punch_Jab', blend: 0.1 },
  punch2: { glb: 'Punch_Cross', blend: 0.1 },
  heavyPunch: { glb: 'Melee_Hook', src: 'ual2', blend: 0.1 },
  meleeUppercut: { glb: 'Melee_Uppercut', src: 'ual2', blend: 0.08 },
  meleeKnee: { glb: 'Melee_Knee', src: 'ual2', blend: 0.08 },
  kickRight: { glb: 'Kick', blend: 0.08 },
  kickLeft: { glb: 'Kick', blend: 0.08 },
  lowKick: { glb: 'Kick', blend: 0.08 },
  sweepKick: { glb: 'Kick', blend: 0.08 },
  // ── Sidestep / dodge ────────────────────────────────────────────────────
  dodgeLeft: { glb: 'Dodge_Left', blend: 0.1 },
  dodgeRight: { glb: 'Dodge_Right', blend: 0.1 },
  // ── Block ────────────────────────────────────────────────────────────────
  block: { glb: 'PunchKick_Enter', blend: 0.06 },
  blockExit: { glb: 'PunchKick_Exit', blend: 0.1 },
  // ── Hit reactions — light (body shots) ──────────────────────────────────
  hurt1: { glb: 'Hit_Chest', blend: 0.05 },
  hurt2: { glb: 'Hit_Head', blend: 0.05 },
  hurt3: { glb: 'Hit_Stomach', blend: 0.05 },
  hurt4: { glb: 'Hit_Shoulder_L', blend: 0.05 },
  hurt5: { glb: 'Hit_Shoulder_R', blend: 0.05 },
  // ── Hit reactions — heavy / airborne (UAL2) ─────────────────────────────
  hurtHeavy: { glb: 'Hit_Knockback', src: 'ual2', blend: 0.04 },
  hurtAir1: { glb: 'LiftAir_Hit_L', src: 'ual2', blend: 0.04 },
  hurtAir2: { glb: 'LiftAir_Hit_R', src: 'ual2', blend: 0.04 },
  // ── Get-up ───────────────────────────────────────────────────────────────
  kipUp: { glb: 'KipUp', src: 'ual2', blend: 0.15 },
  // ── Win / loss ──────────────────────────────────────────────────────────
  defeat: { glb: 'Death01', blend: 0.2 },
  defeatBig: { glb: 'Death02', blend: 0.2 },
  defeatMatch: { glb: 'Crying', blend: 0.3 },
  victory: { glb: 'Dance_Loop', loop: true, blend: 0.2 },
  victoryBackflip: { glb: 'BackFlip', blend: 0.2 },
  victoryCelebrate: { glb: 'Celebration', blend: 0.2 },
  victoryYes: { glb: 'Yes', src: 'ual2', blend: 0.2 },
  victorySmug: { glb: 'Idle_FoldArms_Loop', src: 'ual2', loop: true, blend: 0.3 },
  // ── Pre-fight intro / taunt animations ──────────────────────────────────
  introDrink: { glb: 'Drink', blend: 0.2 },
  introGroundSitEnter: { glb: 'GroundSit_Enter', blend: 0.2 },
  introGroundSitIdle: { glb: 'GroundSit_Idle_Loop', loop: true, blend: 0.1 },
  introGroundSitExit: { glb: 'GroundSit_Exit', blend: 0.1 },
  introTalking: { glb: 'Idle_Talking_Loop', loop: true, blend: 0.2 },
  introInteract: { glb: 'Interact', blend: 0.2 },
  introPunchKick: { glb: 'PunchKick_Enter', blend: 0.2 },
  introSpellEnter: { glb: 'Spell_Double_Enter', blend: 0.2 },
  introSpellIdle: { glb: 'Spell_Double_Idle_Loop', loop: true, blend: 0.1 },
  introSpellExit: { glb: 'Spell_Double_Exit', blend: 0.1 },
  introFixing: { glb: 'Fixing_Kneeling', blend: 0.2 },
} satisfies Record<string, AnimConfig>;

// Derive the union of all valid animation keys from ANIM_CONFIG for type-safe callers.
type AnimKey = keyof typeof ANIM_CONFIG;

// Animation pools and context-based selection.
const ANIM_POOLS = {
  hurtLight: ['hurt1', 'hurt3', 'hurt4', 'hurt5'] as AnimKey[],
  hurtAir: ['hurtAir1', 'hurtAir2'] as AnimKey[],
  victory: [
    'victory',
    'victoryBackflip',
    'victoryCelebrate',
    'victoryYes',
    'victorySmug',
  ] as AnimKey[],
  intro: [
    'introDrink',
    'introGroundSitEnter',
    'introTalking',
    'introInteract',
    'introPunchKick',
    'introSpellEnter',
    'introFixing',
  ] as AnimKey[],
};

function pickRandom<T>(pool: T[]): T {
  return pool[Math.floor(Math.random() * pool.length)] as T;
}

export class Fighter {
  playerIndex: number;
  scene: Scene;
  rootNode: TransformNode | null;
  meshes: AbstractMesh[];
  animGroups: Record<string, AnimationGroup>;
  currentAnimGroup: AnimationGroup | null;
  state: string;
  previousState: string;
  position: Vector3;
  velocity: Vector3;
  facing: number;
  facingAngle: number;
  health: number;
  maxHealth: number;
  currentMove: MoveData | null;
  moveFrame: number;
  hasHitThisMove: boolean;
  isBlocking: boolean;
  isCrouching: boolean;
  isGrounded: boolean;
  comboCount: number;
  comboDamage: number;
  comboTimer: number;
  stunFrames: number;
  wins: number;
  knockdownTimer: number;
  getupTimer: number;
  sideStepDir: number;
  sideStepTimer: number;
  dashTimer: number;
  isRunning: boolean;
  runFrames: number;
  landingTimer: number;
  hitFlash: number;
  private _rootRotY = 0;
  private _introActive = false;
  private _introTimeout: ReturnType<typeof setTimeout> | null = null;

  constructor(playerIndex: number, scene: Scene) {
    this.playerIndex = playerIndex;
    this.scene = scene;

    this.rootNode = null;
    this.meshes = [];
    this.animGroups = {};
    this.currentAnimGroup = null;

    this.state = FIGHTER_STATE.IDLE;
    this.previousState = FIGHTER_STATE.IDLE;
    // Camera at Z=-10 looks toward +Z. In Babylon left-handed: +X = screen RIGHT, -X = screen LEFT.
    // Player 0 (P1) spawns at X=-3 → screen LEFT (traditional fighting game convention).
    this.position = new Vector3(playerIndex === 0 ? -3 : 3, 0, 0);
    this.velocity = new Vector3(0, 0, 0);
    this.facing = 1;
    // P1 at X=-3 faces +X (toward opponent at X=+3) → angle = 0
    // P2 at X=+3 faces -X (toward opponent at X=-3) → angle = PI
    this.facingAngle = playerIndex === 0 ? 0 : Math.PI;
    this.health = GC.MAX_HEALTH;
    this.maxHealth = GC.MAX_HEALTH;

    this.currentMove = null;
    this.moveFrame = 0;
    this.hasHitThisMove = false;
    this.isBlocking = false;
    this.isCrouching = false;
    this.isGrounded = true;
    this.comboCount = 0;
    this.comboDamage = 0;
    this.comboTimer = 0;
    this.stunFrames = 0;
    this.wins = 0;

    this.knockdownTimer = 0;
    this.getupTimer = 0;

    this.sideStepDir = 0;
    this.sideStepTimer = 0;

    this.dashTimer = 0;
    this.isRunning = false;
    this.runFrames = 0;

    this.landingTimer = 0;

    this.hitFlash = 0;
  }

  // FBX loader prefixes every bone as "<meshName>-<boneName>".
  // Strip that prefix so we can match bones across different sources.
  private static _boneSuffix(name: string): string {
    const idx = name.indexOf('-');
    return idx >= 0 ? name.substring(idx + 1) : name;
  }

  // GLB (glTF) is Y-up by spec — no axis correction needed.
  // Only the Y rotation for facing direction is applied here.
  private static _makeRootQuat(rotY: number): Quaternion {
    return Quaternion.RotationAxis(Vector3.Up(), rotY);
  }

  private static _unlinkBonesFromTransformNodes(skeleton: Skeleton) {
    for (const bone of skeleton.bones) {
      bone.linkTransformNode(null);
    }
  }

  static async loadAssets(scene: Scene, onProgress?: (p: number) => void): Promise<SharedAssets> {
    // Load both packs in parallel — UAL2 shares the exact same 65-bone rig as UAL1.
    const [result, ual2] = await Promise.all([
      SceneLoader.ImportMeshAsync(null, '/assets/models/', 'character.glb', scene),
      SceneLoader.ImportMeshAsync(null, '/assets/models/', 'UAL2.glb', scene),
    ]);
    onProgress?.(1);

    // UAL2 is animation-only — hide its meshes and nodes entirely.
    for (const ag of ual2.animationGroups) ag.stop();
    for (const m of ual2.meshes) m.setEnabled(false);
    for (const n of ual2.transformNodes) n.setEnabled(false);

    // Stop UAL1 animations — each fighter drives its own cloned groups.
    for (const ag of result.animationGroups) ag.stop();

    // Build lookup tables keyed by clip name for fast resolution.
    const ual1ByClip = new Map(result.animationGroups.map((ag) => [ag.name, ag]));
    const ual2ByClip = new Map(ual2.animationGroups.map((ag) => [ag.name, ag]));

    const animGroups: Record<string, AnimationGroup> = {};
    for (const [gameName, cfg] of Object.entries(ANIM_CONFIG) as Array<[string, AnimConfig]>) {
      const src = cfg.src === 'ual2' ? ual2ByClip : ual1ByClip;
      const found = src.get(cfg.glb);
      if (found) {
        animGroups[gameName] = found;
      } else {
        console.warn(
          `[H4KKEN] Anim "${gameName}" (GLB: "${cfg.glb}", src: ${cfg.src ?? 'ual1'}) not found`,
        );
      }
    }

    const baseSkeleton = result.skeletons[0] ?? null;

    // Collect meshes that have geometry (skip the synthetic __root__ node).
    const baseMeshes: AbstractMesh[] = [];
    for (const m of result.meshes) {
      if (!m.getTotalVertices || m.getTotalVertices() === 0) continue;
      m.setEnabled(false);
      baseMeshes.push(m);
    }
    for (const n of result.transformNodes) n.setEnabled(false);

    return { baseMeshes, baseSkeleton, animGroups };
  }

  init(assets: SharedAssets) {
    const { baseMeshes, baseSkeleton, animGroups } = assets;

    // Each fighter gets a fresh root TransformNode as its positional anchor
    this.rootNode = new TransformNode(`fighter${this.playerIndex}_root`, this.scene);

    const clonedSkeleton = baseSkeleton
      ? baseSkeleton.clone(`skeleton_f${this.playerIndex}`, `skel_${this.playerIndex}`)
      : null;

    if (clonedSkeleton) {
      // Unlink bones from the base TransformNodes so animation drives them directly
      Fighter._unlinkBonesFromTransformNodes(clonedSkeleton);
    }

    // Clone each base mesh, parenting it to this fighter's root node
    this.meshes = [];
    for (const baseMesh of baseMeshes) {
      const cloned = baseMesh.clone(`f${this.playerIndex}_${baseMesh.name}`, this.rootNode);
      if (!cloned) continue;
      cloned.setEnabled(true);
      cloned.receiveShadows = true;
      if (clonedSkeleton && cloned.skeleton) cloned.skeleton = clonedSkeleton;
      this.meshes.push(cloned);
    }

    // Player 2 gets a red tint on its materials
    if (this.playerIndex === 1) {
      for (const mesh of this.meshes) {
        if (!mesh.material) continue;
        const mat = mesh.material.clone(`p2mat_${mesh.name}`);
        if (!mat) continue;
        if (mat instanceof PBRMaterial) {
          mat.albedoColor = new Color3(0.7, 0.3, 0.3);
          mat.emissiveColor = new Color3(0.15, 0.02, 0.02);
        } else if (mat instanceof StandardMaterial) {
          mat.diffuseColor = new Color3(0.7, 0.3, 0.3);
          mat.emissiveColor = new Color3(0.15, 0.02, 0.02);
        }
        mesh.material = mat;
      }
    }

    // Build suffix→Bone map so _cloneAnimGroups can remap targets to cloned bones
    const boneByName = new Map<string, Bone>();
    if (clonedSkeleton) {
      for (const bone of clonedSkeleton.bones) {
        boneByName.set(Fighter._boneSuffix(bone.name), bone);
      }
      console.log(
        `[H4KKEN] F${this.playerIndex} skeleton "${clonedSkeleton.name}":`,
        `${clonedSkeleton.bones.length} bones`,
        `meshes=${this.meshes.length}`,
      );
    }

    this._cloneAnimGroups(animGroups, boneByName);

    this.rootNode.position.copyFrom(this.position);
    // initRotY must match PI/2 - facingAngle used in updateVisuals().
    // P0 facingAngle=0  → PI/2;  P1 facingAngle=PI → -PI/2
    const initRotY = this.playerIndex === 0 ? Math.PI / 2 : -Math.PI / 2;
    this._rootRotY = initRotY;
    this.rootNode.rotationQuaternion = Fighter._makeRootQuat(initRotY);

    this.playAnimation('combatIdle');
  }

  private _cloneAnimGroups(
    animGroups: Record<string, AnimationGroup>,
    boneByName: Map<string, Bone>,
  ) {
    for (const [name, srcGroup] of Object.entries(animGroups)) {
      const clonedGroup = srcGroup.clone(`f${this.playerIndex}_${name}`, (target) => {
        if (target && typeof target === 'object' && 'name' in target) {
          const mapped = boneByName.get(Fighter._boneSuffix((target as { name: string }).name));
          if (mapped) return mapped;
        }
        return target;
      });
      clonedGroup.stop();
      clonedGroup.loopAnimation = (ANIM_CONFIG as Record<string, AnimConfig>)[name]?.loop ?? false;
      this.animGroups[name] = clonedGroup;
    }
  }

  playAnimation(name: string, speedOverride?: number, blendOverride?: number) {
    const cfg = (ANIM_CONFIG as Record<string, AnimConfig>)[name];
    const newGroup = this.animGroups[name];
    if (!newGroup) return;

    if (this.currentAnimGroup === newGroup && newGroup.isPlaying) return;

    if (this.currentAnimGroup && this.currentAnimGroup !== newGroup) {
      this.currentAnimGroup.stop();
    }

    const speed = speedOverride ?? cfg?.speed ?? 1.0;
    const blend = blendOverride ?? cfg?.blend ?? 0.15;

    const from = Math.min(newGroup.from, newGroup.to);
    const to = Math.max(newGroup.from, newGroup.to);

    newGroup.enableBlending = true;
    newGroup.blendingSpeed = blend;
    newGroup.speedRatio = speed;
    newGroup.start(newGroup.loopAnimation, speed, from, to);
    this.currentAnimGroup = newGroup;
  }

  reset(startX: number) {
    this.position.set(startX, 0, 0);
    this.velocity.set(0, 0, 0);
    this.health = GC.MAX_HEALTH;
    this.state = FIGHTER_STATE.IDLE;
    this.currentMove = null;
    this.moveFrame = 0;
    this.hasHitThisMove = false;
    this.isBlocking = false;
    this.isCrouching = false;
    this.isGrounded = true;
    this.comboCount = 0;
    this.comboDamage = 0;
    this.comboTimer = 0;
    this.stunFrames = 0;
    this.knockdownTimer = 0;
    this.getupTimer = 0;
    this.sideStepTimer = 0;
    this.dashTimer = 0;
    this.isRunning = false;
    this.runFrames = 0;
    this.landingTimer = 0;
    this.hitFlash = 0;
    this.facing = 1;
    this.facingAngle = startX > 0 ? Math.PI : 0;
    this._rootRotY = Math.PI / 2 - this.facingAngle;
    if (this.rootNode) {
      this.rootNode.rotationQuaternion = Fighter._makeRootQuat(this._rootRotY);
    }

    this.playAnimation('combatIdle');
  }

  processInput(input: InputState, opponentPos: Vector3) {
    const dxWorld = opponentPos.x - this.position.x;
    const dzWorld = opponentPos.z - this.position.z;
    const toOpponentAngle = Math.atan2(dzWorld, dxWorld);

    const canUpdateFacing =
      this.state !== FIGHTER_STATE.ATTACKING &&
      this.state !== FIGHTER_STATE.HIT_STUN &&
      this.state !== FIGHTER_STATE.JUGGLE &&
      this.state !== FIGHTER_STATE.KNOCKDOWN;
    if (canUpdateFacing) {
      this.facingAngle = toOpponentAngle;
    }

    const relInput = this.getRelativeInput(input);

    switch (this.state) {
      case FIGHTER_STATE.IDLE:
      case FIGHTER_STATE.WALK_FORWARD:
      case FIGHTER_STATE.WALK_BACKWARD:
        this.handleStandingState(relInput);
        break;
      case FIGHTER_STATE.CROUCH:
      case FIGHTER_STATE.CROUCH_WALK:
        this.handleCrouchState(relInput);
        break;
      case FIGHTER_STATE.JUMP:
      case FIGHTER_STATE.JUMP_FORWARD:
      case FIGHTER_STATE.JUMP_BACKWARD:
      case FIGHTER_STATE.FALLING:
        this.handleAirState(relInput);
        break;
      case FIGHTER_STATE.RUN:
        this.handleRunState(relInput);
        break;
      case FIGHTER_STATE.ATTACKING:
        this.handleAttackState(relInput);
        break;
      case FIGHTER_STATE.HIT_STUN:
      case FIGHTER_STATE.BLOCK_STUN:
        this.handleStunState(relInput);
        break;
      case FIGHTER_STATE.JUGGLE:
        this.handleJuggleState();
        break;
      case FIGHTER_STATE.KNOCKDOWN:
        this.handleKnockdownState();
        break;
      case FIGHTER_STATE.GETUP:
        this.handleGetupState();
        break;
      case FIGHTER_STATE.SIDESTEP:
        this.handleSidestepState();
        break;
      case FIGHTER_STATE.DASH_BACK:
        this.handleDashState();
        break;
      case FIGHTER_STATE.LANDING:
        this.handleLandingState();
        break;
      case FIGHTER_STATE.VICTORY:
      case FIGHTER_STATE.DEFEAT:
        break;
    }
  }

  getRelativeInput(input: InputState): InputState {
    const rel = { ...input };
    if (this.facing > 0) {
      rel.forward = input.right;
      rel.back = input.left;
      rel.forwardJust = input.rightJust;
      rel.backJust = input.leftJust;
    } else {
      rel.forward = input.left;
      rel.back = input.right;
      rel.forwardJust = input.leftJust;
      rel.backJust = input.rightJust;
    }
    if (this.facing > 0) {
      rel.dashForward = input.dashRight;
      rel.dashBack = input.dashLeft;
    } else {
      rel.dashForward = input.dashLeft;
      rel.dashBack = input.dashRight;
    }
    return rel;
  }

  handleStandingState(input: InputState) {
    this.isCrouching = false;
    this.isBlocking = input.back ?? false;

    const move = CombatSystem.resolveMove(input, this);
    if (move) {
      this.startAttack(move);
      return;
    }

    if (input.upJust) {
      // Physics starts immediately — no input lag
      this.velocity.y = GC.JUMP_VELOCITY;
      if (input.forward) {
        this.velocity.x = GC.JUMP_FORWARD_X;
        this.state = FIGHTER_STATE.JUMP_FORWARD;
      } else if (input.back) {
        this.velocity.x = -GC.JUMP_FORWARD_X;
        this.state = FIGHTER_STATE.JUMP_BACKWARD;
      } else {
        this.state = FIGHTER_STATE.JUMP;
      }
      this.isGrounded = false;
      // Quick anticipation squat (visual only) then transition to jump arc
      this.playAnimation('jumpSquat', 6.0, 0.05);
      this.animGroups.jumpSquat?.onAnimationGroupEndObservable.addOnce(() => {
        if (!this.isGrounded) this.playAnimation('jump');
      });
      return;
    }

    if (input.down) {
      this.state = FIGHTER_STATE.CROUCH;
      this.isCrouching = true;
      if (this.animGroups.crouchEnter) {
        this.playAnimation('crouchEnter');
        this.animGroups.crouchEnter.onAnimationGroupEndObservable.addOnce(() => {
          if (this.isCrouching && this.state === FIGHTER_STATE.CROUCH) {
            this.playAnimation('crouchIdle');
          }
        });
      } else {
        this.playAnimation('crouchIdle');
      }
      return;
    }

    if (input.sideStepUp) {
      this.startSidestep(-1);
      return;
    }
    if (input.sideStepDown) {
      this.startSidestep(1);
      return;
    }

    if (input.dashBack) {
      this.state = FIGHTER_STATE.DASH_BACK;
      this.dashTimer = GC.DASH_BACK_FRAMES;
      this.velocity.x = -GC.DASH_BACK_SPEED;
      this.playAnimation('runBack');
      return;
    }

    if (input.dashForward) {
      this.state = FIGHTER_STATE.RUN;
      this.isRunning = true;
      this.runFrames = 0;
      this.playAnimation('sprint');
      return;
    }

    if (input.forward) {
      this.velocity.x = GC.WALK_SPEED;
      this.state = FIGHTER_STATE.WALK_FORWARD;
      this.playAnimation('walk');
    } else if (input.back) {
      this.velocity.x = -GC.BACK_WALK_SPEED;
      this.state = FIGHTER_STATE.WALK_BACKWARD;
      this.playAnimation('walkBack');
    } else {
      this.velocity.x = 0;
      if (this.state !== FIGHTER_STATE.IDLE) {
        this.state = FIGHTER_STATE.IDLE;
        this.playAnimation('combatIdle');
      }
    }
  }

  handleCrouchState(input: InputState) {
    this.isCrouching = true;
    this.isBlocking = input.back ?? false;

    if (!input.down) {
      this.isCrouching = false;
      this.state = FIGHTER_STATE.IDLE;
      if (this.animGroups.crouchExit) {
        this.playAnimation('crouchExit');
        this.animGroups.crouchExit.onAnimationGroupEndObservable.addOnce(() => {
          if (!this.isCrouching && this.state === FIGHTER_STATE.IDLE) {
            this.playAnimation('combatIdle');
          }
        });
      } else {
        this.playAnimation('combatIdle');
      }
      return;
    }

    const move = CombatSystem.resolveMove(input, this);
    if (move) {
      this.startAttack(move);
      return;
    }

    if (input.forward) {
      this.velocity.x = GC.CROUCH_WALK_SPEED;
      if (
        this.state !== FIGHTER_STATE.CROUCH_WALK ||
        this.currentAnimGroup !== this.animGroups.crouchWalk
      ) {
        this.state = FIGHTER_STATE.CROUCH_WALK;
        this.playAnimation('crouchWalk');
      }
    } else if (input.back) {
      this.velocity.x = -GC.CROUCH_WALK_SPEED;
      if (
        this.state !== FIGHTER_STATE.CROUCH_WALK ||
        this.currentAnimGroup !== this.animGroups.crouchWalkBack
      ) {
        this.state = FIGHTER_STATE.CROUCH_WALK;
        this.playAnimation('crouchWalkBack');
      }
    } else {
      this.velocity.x = 0;
      if (this.state !== FIGHTER_STATE.CROUCH) {
        this.state = FIGHTER_STATE.CROUCH;
        this.playAnimation('crouchIdle');
      }
    }
  }

  handleAirState(_input: InputState) {
    this.velocity.y += GC.GRAVITY;

    if (this.position.y <= GC.GROUND_Y && this.velocity.y <= 0) {
      this.position.y = GC.GROUND_Y;
      this.velocity.y = 0;
      this.velocity.x = 0;
      this.isGrounded = true;
      this.state = FIGHTER_STATE.LANDING;
      this.landingTimer = GC.LANDING_FRAMES;
      this.playAnimation('landing');
    }
  }

  handleRunState(input: InputState) {
    this.isBlocking = false;
    this.runFrames++;

    if (input.lpJust || input.rpJust || input.lkJust || input.rkJust) {
      const move = CombatSystem.resolveMove(input, this);
      if (move) {
        this.isRunning = false;
        this.startAttack(move);
        return;
      }
    }

    if (!input.forward || input.back) {
      this.isRunning = false;
      this.state = FIGHTER_STATE.IDLE;
      this.velocity.x = 0;
      this.playAnimation('combatIdle');
      return;
    }

    this.velocity.x = GC.RUN_SPEED;
  }

  handleAttackState(input: InputState) {
    if (!this.currentMove) {
      this.state = FIGHTER_STATE.IDLE;
      this.playAnimation('combatIdle');
      return;
    }

    this.moveFrame++;
    const totalFrames =
      this.currentMove.startupFrames +
      this.currentMove.activeFrames +
      this.currentMove.recoveryFrames;

    if (this.currentMove.forwardLunge && this.moveFrame <= this.currentMove.startupFrames) {
      this.velocity.x = this.currentMove.forwardLunge;
    } else if (this.moveFrame > this.currentMove.startupFrames + this.currentMove.activeFrames) {
      this.velocity.x *= 0.9;
    }

    if (this.moveFrame >= this.currentMove.startupFrames + this.currentMove.activeFrames - 2) {
      const comboMove = CombatSystem.resolveComboInput(input, this);
      if (comboMove) {
        this.startAttack(comboMove, true);
        return;
      }
    }

    if (this.moveFrame >= totalFrames) {
      this.currentMove = null;
      this.moveFrame = 0;
      this.hasHitThisMove = false;
      this.state = FIGHTER_STATE.IDLE;
      this.velocity.x = 0;
      this.playAnimation('combatIdle');
    }
  }

  handleStunState(_input?: InputState) {
    this.stunFrames--;
    if (this.stunFrames <= 0) {
      this.state = FIGHTER_STATE.IDLE;
      this.velocity.x = 0;
      this.playAnimation('combatIdle');
    }
    this.velocity.x *= GC.PUSHBACK_DECAY;
  }

  handleJuggleState() {
    this.velocity.y += GC.JUGGLE_GRAVITY;
    this.velocity.x *= 0.98;

    if (this.position.y <= GC.GROUND_Y && this.velocity.y <= 0) {
      this.position.y = GC.GROUND_Y;
      this.velocity.y = 0;
      this.velocity.x = 0;
      this.state = FIGHTER_STATE.KNOCKDOWN;
      this.knockdownTimer = 40;
      this.playAnimation('falling');
      this.comboTimer = 0;
    }
  }

  handleKnockdownState() {
    if (this.position.y > GC.GROUND_Y || this.velocity.y > 0) {
      this.velocity.y += GC.JUGGLE_GRAVITY;
      if (this.position.y <= GC.GROUND_Y && this.velocity.y <= 0) {
        this.position.y = GC.GROUND_Y;
        this.velocity.y = 0;
        this.velocity.x = 0;
        this.isGrounded = true;
      }
    }

    this.knockdownTimer--;
    if (this.knockdownTimer <= 0) {
      this.position.y = GC.GROUND_Y;
      this.velocity.y = 0;
      this.isGrounded = true;
      this.state = FIGHTER_STATE.GETUP;
      this.getupTimer = GC.GETUP_FRAMES;
      this.playAnimation('kipUp');
    }
  }

  handleGetupState() {
    this.getupTimer--;
    if (this.getupTimer <= 0) {
      this.state = FIGHTER_STATE.IDLE;
      this.playAnimation('combatIdle');
    }
  }

  handleSidestepState() {
    this.sideStepTimer--;
    this.velocity.z = this.sideStepDir * GC.SIDESTEP_SPEED;

    if (this.sideStepTimer <= 0) {
      this.velocity.z = 0;
      this.state = FIGHTER_STATE.IDLE;
      this.playAnimation('combatIdle');
    }
  }

  handleDashState() {
    this.dashTimer--;
    if (this.dashTimer <= 0) {
      this.velocity.x = 0;
      this.state = FIGHTER_STATE.IDLE;
      this.playAnimation('combatIdle');
    }
  }

  handleLandingState() {
    this.landingTimer--;
    if (this.landingTimer <= 0) {
      this.state = FIGHTER_STATE.IDLE;
      this.playAnimation('combatIdle');
    }
  }

  startAttack(move: MoveData, isCombo = false) {
    this.currentMove = move;
    this.moveFrame = 0;
    this.hasHitThisMove = false;
    this.state = FIGHTER_STATE.ATTACKING;

    const animName = move.animation;
    const group = this.animGroups[animName];
    const totalFrames = move.startupFrames + move.activeFrames + move.recoveryFrames;
    const moveDuration = totalFrames / 60;
    let speed = move.animSpeed || 1.0;
    if (group) {
      // Math.abs handles GLBs where from > to (would otherwise produce negative speed)
      const groupDuration = Math.abs(group.to - group.from);
      if (groupDuration > 0 && moveDuration > 0) {
        speed = groupDuration / 60 / moveDuration;
        speed = Math.max(0.3, Math.min(speed, 4.0));
      }
    }

    // combo blend overrides the per-animation default for a tighter chain feel
    this.playAnimation(animName as AnimKey, speed, isCombo ? 0.08 : undefined);
  }

  startSidestep(direction: number) {
    this.state = FIGHTER_STATE.SIDESTEP;
    this.sideStepDir = direction;
    this.sideStepTimer = GC.SIDESTEP_FRAMES;
    this.playAnimation(direction < 0 ? 'dodgeLeft' : 'dodgeRight');
  }

  onHit(result: HitResult, _attackerFacing: number) {
    switch (result.type) {
      case 'hit': {
        this.isBlocking = false;
        this.health = Math.max(0, this.health - result.damage);
        this.comboCount = result.comboHits;
        this.comboDamage = (this.comboDamage || 0) + result.damage;
        this.comboTimer = 60;
        this.velocity.x = -result.pushback;
        this.hitFlash = 6;

        switch (result.onHit) {
          case HIT_RESULT.STAGGER:
            this.state = FIGHTER_STATE.HIT_STUN;
            this.stunFrames = result.hitstun;
            this.playAnimation(pickRandom(ANIM_POOLS.hurtLight));
            break;
          case HIT_RESULT.KNOCKBACK: {
            this.state = FIGHTER_STATE.HIT_STUN;
            this.stunFrames = result.hitstun;
            // UAL2 knockback stumble — visually distinct from light stagger
            this.playAnimation('hurtHeavy');
            break;
          }
          case HIT_RESULT.LAUNCH:
            this.state = FIGHTER_STATE.JUGGLE;
            this.velocity.y = result.launchVelocity;
            this.velocity.x = -result.pushback * 0.5;
            this.isGrounded = false;
            this.playAnimation(pickRandom(ANIM_POOLS.hurtAir));
            break;
          case HIT_RESULT.KNOCKDOWN:
            this.state = FIGHTER_STATE.KNOCKDOWN;
            this.knockdownTimer = 50;
            this.velocity.x = -result.pushback * 1.5;
            this.playAnimation('falling');
            break;
          case HIT_RESULT.CRUMPLE:
            this.state = FIGHTER_STATE.HIT_STUN;
            this.stunFrames = result.hitstun + 10;
            this.velocity.x = -result.pushback * 0.3;
            // Heavy stagger — reuse knockback animation at half speed for crumple feel
            this.playAnimation('hurtHeavy', 0.5);
            break;
          case HIT_RESULT.THROW_HIT:
            this.state = FIGHTER_STATE.KNOCKDOWN;
            this.knockdownTimer = 60;
            this.velocity.y = 0.15;
            this.velocity.x = -(result.pushback || 0.3);
            this.isGrounded = false;
            this.playAnimation('falling');
            break;
        }
        break;
      }
      case 'blocked': {
        this.health = Math.max(0, this.health - result.chipDamage);
        this.state = FIGHTER_STATE.BLOCK_STUN;
        this.stunFrames = result.blockstun;
        this.velocity.x = -result.pushback;
        this.isBlocking = true;
        // Guard-raise reaction: PunchKick_Enter snaps both arms up into block pose
        this.playAnimation('block', undefined, 0.05);
        break;
      }
    }
  }

  isAttackActive() {
    if (this.state !== FIGHTER_STATE.ATTACKING || !this.currentMove) return false;
    if (this.hasHitThisMove) return false;

    const { startupFrames, activeFrames } = this.currentMove;
    return this.moveFrame >= startupFrames && this.moveFrame < startupFrames + activeFrames;
  }

  updatePhysics() {
    const cosA = Math.cos(this.facingAngle);
    const sinA = Math.sin(this.facingAngle);
    const worldVx = this.velocity.x * cosA + this.velocity.z * -sinA;
    const worldVz = this.velocity.x * sinA + this.velocity.z * cosA;

    this.position.x += worldVx;
    this.position.y += this.velocity.y;
    this.position.z += worldVz;

    if (this.position.y < GC.GROUND_Y) {
      this.position.y = GC.GROUND_Y;
      this.velocity.y = 0;
    }

    const arenaRadius = GC.ARENA_WIDTH;
    const distFromCenter = Math.sqrt(
      this.position.x * this.position.x + this.position.z * this.position.z,
    );
    if (distFromCenter > arenaRadius) {
      const scale = arenaRadius / distFromCenter;
      this.position.x *= scale;
      this.position.z *= scale;
    }

    if (Math.abs(this.velocity.z) > 0.001) {
      this.velocity.z *= 0.9;
    } else {
      this.velocity.z = 0;
    }

    if (this.comboTimer > 0) {
      this.comboTimer--;
      if (this.comboTimer <= 0) {
        this.comboCount = 0;
        this.comboDamage = 0;
      }
    }

    if (this.hitFlash > 0) this.hitFlash--;
  }

  private _applyEmissiveFlash(flashActive: boolean) {
    const idleEmissive = this.playerIndex === 1 ? new Color3(0.15, 0.02, 0.02) : Color3.Black();
    const emissive = flashActive ? new Color3(0.5, 0.5, 0.5) : idleEmissive;
    for (const mesh of this.meshes) {
      const mat = mesh.material;
      if (mat instanceof PBRMaterial) {
        mat.emissiveColor = emissive;
      } else if (mat instanceof StandardMaterial) {
        mat.emissiveColor = emissive;
      }
    }
  }

  updateVisuals() {
    if (!this.rootNode) return;

    this.rootNode.position.copyFrom(this.position);

    // Quaternius character natively faces +Z. Facing angle is the world-space direction to opponent.
    // BabylonJS RotationAxis(Up, θ) maps +Z → (sin θ, 0, cos θ). To face direction (cos A, 0, sin A)
    // we need sin θ = cos A and cos θ = sin A, so θ = PI/2 - facingAngle (not PI/2 + facingAngle).
    const targetRotY = Math.PI / 2 - this.facingAngle;
    let diff = targetRotY - this._rootRotY;
    while (diff > Math.PI) diff -= 2 * Math.PI;
    while (diff < -Math.PI) diff += 2 * Math.PI;
    this._rootRotY += diff * 0.2;
    this.rootNode.rotationQuaternion = Fighter._makeRootQuat(this._rootRotY);

    if (this.hitFlash >= 0) {
      const flashActive = this.hitFlash > 0;
      this._applyEmissiveFlash(flashActive);
      if (!flashActive) this.hitFlash = -1;
    }

    if (this.state === FIGHTER_STATE.BLOCK_STUN) {
      this.rootNode.position.x -= Math.cos(this.facingAngle) * 0.05;
      this.rootNode.position.z -= Math.sin(this.facingAngle) * 0.05;
    }
  }

  serializeState() {
    let moveKey: string | null = null;
    if (this.currentMove) {
      for (const [k, v] of Object.entries(MOVES)) {
        if (v === this.currentMove) {
          moveKey = k;
          break;
        }
      }
    }
    return {
      px: this.position.x,
      py: this.position.y,
      pz: this.position.z,
      vx: this.velocity.x,
      vy: this.velocity.y,
      vz: this.velocity.z,
      state: this.state,
      facing: this.facing,
      facingAngle: this.facingAngle,
      health: this.health,
      moveId: moveKey,
      moveFrame: this.moveFrame,
      hasHitThisMove: this.hasHitThisMove,
      isCrouching: this.isCrouching,
      isBlocking: this.isBlocking,
      comboCount: this.comboCount,
      comboDamage: this.comboDamage,
      stunFrames: this.stunFrames,
      wins: this.wins,
    };
  }

  deserializeState(data: FighterStateSync) {
    this.position.set(data.px, data.py, data.pz);
    this.velocity.set(data.vx, data.vy, data.vz);
    this.facing = data.facing;
    this.facingAngle =
      data.facingAngle !== undefined ? data.facingAngle : this.playerIndex === 0 ? 0 : Math.PI;
    this.health = data.health;
    this.isCrouching = data.isCrouching;
    this.isBlocking = data.isBlocking;
    this.comboCount = data.comboCount;
    this.comboDamage = data.comboDamage;
    this.stunFrames = data.stunFrames;
    this.wins = data.wins;

    if (data.moveId && MOVES[data.moveId] !== undefined) {
      this.currentMove = MOVES[data.moveId] ?? null;
      this.moveFrame = data.moveFrame || 0;
      this.hasHitThisMove = !!data.hasHitThisMove;
    } else {
      this.currentMove = null;
      this.moveFrame = 0;
      this.hasHitThisMove = false;
    }

    if (data.state !== this.state) {
      this.state = data.state;
      this.updateAnimationForState();
    }
  }

  updateAnimationForState() {
    switch (this.state) {
      case FIGHTER_STATE.IDLE:
        this.playAnimation('combatIdle');
        break;
      case FIGHTER_STATE.WALK_FORWARD:
        this.playAnimation('walk');
        break;
      case FIGHTER_STATE.WALK_BACKWARD:
        this.playAnimation('walkBack');
        break;
      case FIGHTER_STATE.CROUCH:
        this.playAnimation('crouchIdle');
        break;
      case FIGHTER_STATE.RUN:
        this.playAnimation('sprint');
        break;
      case FIGHTER_STATE.JUMP:
      case FIGHTER_STATE.JUMP_FORWARD:
      case FIGHTER_STATE.JUMP_BACKWARD:
        this.playAnimation('jump');
        break;
      case FIGHTER_STATE.ATTACKING:
        if (this.currentMove) {
          const animName = this.currentMove.animation;
          const group = this.animGroups[animName];
          const totalFrames =
            this.currentMove.startupFrames +
            this.currentMove.activeFrames +
            this.currentMove.recoveryFrames;
          const moveDuration = totalFrames / 60;
          let speed = this.currentMove.animSpeed || 1.0;
          if (group) {
            const groupDuration = Math.abs(group.to - group.from);
            if (groupDuration > 0 && moveDuration > 0) {
              speed = groupDuration / 60 / moveDuration;
              speed = Math.max(0.3, Math.min(speed, 4.0));
            }
          }
          this.playAnimation(animName as AnimKey, speed);
        }
        break;
      case FIGHTER_STATE.HIT_STUN:
      case FIGHTER_STATE.BLOCK_STUN:
        this.playAnimation('hurt1');
        break;
      case FIGHTER_STATE.JUGGLE:
      case FIGHTER_STATE.KNOCKDOWN:
        this.playAnimation('falling');
        break;
      case FIGHTER_STATE.SIDESTEP:
        this.playAnimation(this.sideStepDir < 0 ? 'walkLeft' : 'walkRight');
        break;
      case FIGHTER_STATE.DASH_BACK:
        this.playAnimation('walkBack');
        break;
      case FIGHTER_STATE.LANDING:
        this.playAnimation('landing');
        break;
      case FIGHTER_STATE.GETUP:
        this.playAnimation('landing');
        break;
      case FIGHTER_STATE.VICTORY:
        this.playAnimation('victory');
        break;
      case FIGHTER_STATE.DEFEAT:
        this.playAnimation('falling');
        break;
    }
  }

  setVictory(animName?: string): string {
    this.state = FIGHTER_STATE.VICTORY;
    this.velocity.set(0, 0, 0);
    const chosen = animName ?? pickRandom(ANIM_POOLS.victory);
    this.playAnimation(chosen);
    return chosen;
  }

  setDefeat(animName?: string, matchOver = false): string {
    this.state = FIGHTER_STATE.DEFEAT;
    this.velocity.set(0, 0, 0);
    let chosen: string;
    if (animName) {
      chosen = animName;
    } else if (matchOver) {
      // Lost the whole match — they earned the Crying
      chosen = 'defeatMatch';
    } else if (this.comboCount >= 3 || this.comboDamage >= GC.MAX_HEALTH * 0.5) {
      // Ended by a big combo — more dramatic collapse
      chosen = 'defeatBig';
    } else {
      chosen = 'defeat';
    }
    this.playAnimation(chosen as AnimKey);
    return chosen;
  }

  // ── Pre-fight intro animations ──────────────────────────────────────────

  // Play a random intro animation. Returns the chosen key so the other player
  // can call playIntroAnimationExcluding() to guarantee different intros.
  playIntroAnimation(): AnimKey {
    this.cancelIntro();
    const chosen = pickRandom(ANIM_POOLS.intro);
    this._introActive = true;
    this._playIntroSequence(chosen);
    return chosen;
  }

  playIntroAnimationExcluding(exclude: AnimKey): AnimKey {
    this.cancelIntro();
    const filtered = ANIM_POOLS.intro.filter((k) => k !== exclude);
    const pool = filtered.length > 0 ? filtered : ANIM_POOLS.intro;
    const chosen = pickRandom(pool);
    this._introActive = true;
    this._playIntroSequence(chosen);
    return chosen;
  }

  private _playIntroSequence(key: AnimKey) {
    // snap = instant cut for the opening frame so there's no idle→intro blend
    const snap = 1.0;
    switch (key) {
      case 'introGroundSitEnter':
        // Start already sitting — idle first, then stand up before the fight
        this.playAnimation('introGroundSitIdle', undefined, snap);
        this._introTimeout = setTimeout(() => {
          if (!this._introActive) return;
          this.playAnimation('introGroundSitExit');
          this.animGroups.introGroundSitExit?.onAnimationGroupEndObservable.addOnce(() => {
            if (!this._introActive) return;
            this._introActive = false;
            this.playAnimation('combatIdle');
          });
        }, 1800);
        break;

      case 'introSpellEnter':
        this.playAnimation('introSpellEnter', undefined, snap);
        this.animGroups.introSpellEnter?.onAnimationGroupEndObservable.addOnce(() => {
          if (!this._introActive) return;
          this.playAnimation('introSpellIdle');
          this._introTimeout = setTimeout(() => {
            if (!this._introActive) return;
            this.playAnimation('introSpellExit');
            this.animGroups.introSpellExit?.onAnimationGroupEndObservable.addOnce(() => {
              if (!this._introActive) return;
              this._introActive = false;
              this.playAnimation('combatIdle');
            });
          }, 1200);
        });
        break;

      case 'introTalking':
        this.playAnimation('introTalking', undefined, snap);
        // Loop until countdown ends — cancelIntro() will snap back to idle
        this._introTimeout = setTimeout(() => {
          if (!this._introActive) return;
          this._introActive = false;
          this.playAnimation('combatIdle');
        }, 3000);
        break;

      default:
        // Single-play: returns to combatIdle automatically when done
        this.playAnimation(key, undefined, snap);
        this.animGroups[key]?.onAnimationGroupEndObservable.addOnce(() => {
          if (!this._introActive) return;
          this._introActive = false;
          this.playAnimation('combatIdle');
        });
        break;
    }
  }

  // Cancel any running intro and immediately return to combat idle.
  cancelIntro() {
    this._introActive = false;
    if (this._introTimeout !== null) {
      clearTimeout(this._introTimeout);
      this._introTimeout = null;
    }
    this.playAnimation('combatIdle', undefined, 0.2);
  }
}
