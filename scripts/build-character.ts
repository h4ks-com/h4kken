/**
 * Character build pipeline — one command, end to end.
 *
 *   bun run build:character
 *
 * Steps per character in scripts/characters.ts:
 *   1. Blender headless: bake T-pose into Mixamo FBX → <id>_mesh.glb
 *   2. Blender headless (once): export UAL rigs + actions → ual{1,2}_anims.glb
 *   3. Babylon NullEngine: retarget every UAL clip in ANIM_CONFIG onto the
 *      character's Mixamo skeleton via AnimatorAvatar, serialize → <id>.glb
 *
 * No Blender addons required — only stock bpy.ops.
 *
 * Re-run whenever: Mixamo FBX updates, UAL packs update, ANIM_CONFIG or
 * boneMap.ts changes, or with --force.
 */

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import {
  type AbstractMesh,
  type AnimationGroup,
  AnimatorAvatar,
  NullEngine,
  Quaternion,
  Scene,
  SceneLoader,
  type Skeleton,
  type TransformNode,
  Vector3,
} from '@babylonjs/core';
import '@babylonjs/loaders/glTF';
import { GLTF2Export } from '@babylonjs/serializers';
import { ANIM_CONFIG } from '../src/fighter/animations';
import { UAL_TO_MIXAMO_BONE_MAP } from '../src/fighter/boneMap';
import { CHARACTERS, type CharacterSource } from './characters';

const BLENDER = process.env.BLENDER ?? '/opt/homebrew/bin/blender';
const UAL1_BLEND =
  process.env.UAL1_BLEND ??
  `${process.env.HOME}/Documents/Universal Animation Library[Source]/UAL1.blend`;
const UAL2_BLEND =
  process.env.UAL2_BLEND ??
  `${process.env.HOME}/Documents/Universal Animation Library 2[Source]/UAL2.blend`;

const ROOT = path.join(import.meta.dir, '..');
const SCRIPTS = path.join(ROOT, 'scripts');
const MODELS = path.join(ROOT, 'public/assets/models');

function runBlender(script: string, env: NodeJS.ProcessEnv): void {
  console.log(`[build] blender -b --factory-startup -P ${script}`);
  // --factory-startup: skip user addons (e.g. APIRC, BlenderMCP) that can hang
  // headless runs by trying to connect to non-existent IPC sockets.
  execFileSync(BLENDER, ['-b', '--factory-startup', '-P', path.join(SCRIPTS, script)], {
    stdio: 'inherit',
    env: { ...process.env, ...env },
  });
}

function needsRebuild(output: string, ...inputs: string[]): boolean {
  if (!fs.existsSync(output)) return true;
  const outMtime = fs.statSync(output).mtimeMs;
  return inputs.some(
    (i) => fs.existsSync(i) && fs.statSync(i).mtimeMs > outMtime,
  );
}

function glbToDataUrl(absPath: string): string {
  const buf = fs.readFileSync(absPath);
  return `data:application/octet-stream;base64,${buf.toString('base64')}`;
}

// Per-frame ground anchoring tunables (world metres).
// Anchor is the literal floor at Y=0; airborne kicks in when the lowest
// animated bone climbs `GROUND_CONTACT_THRESHOLD_M` above it. The smoothing
// window suppresses per-frame oscillation from alternating-foot gaits (run,
// jog) without losing slow trends (sit_enter, death).
const GROUND_CONTACT_THRESHOLD_M = 0.25;
const GROUND_TRANSITION_M = 0.15;
const GROUND_MIN_CORRECTION_M = 0.005;
const GROUND_SMOOTH_RADIUS = 6;

interface GroundCorrectionResult {
  contactFrames: number;
  totalFrames: number;
  minLowestM: number;
  maxLowestM: number;
}

/** Climb the TN parent chain accumulating Y scale — Hips keyframes live in
 * armature-local space, so a metre correction divides by this to reach key
 * units (e.g. handyc armature scale=0.01). */
function accumulatedYScale(tn: TransformNode): number {
  let scaleY = 1;
  let p: TransformNode | null = tn.parent as TransformNode | null;
  while (p) {
    scaleY *= p.scaling.y;
    p = p.parent as TransformNode | null;
  }
  return scaleY;
}

/** Linear-interp the Vector3 keyframe series at frame `f`. Clamps to ends. */
function interpVec3At(keys: readonly { frame: number; value: unknown }[], f: number): Vector3 {
  const first = keys[0]!;
  const last = keys[keys.length - 1]!;
  if (f <= first.frame) return (first.value as Vector3).clone();
  if (f >= last.frame) return (last.value as Vector3).clone();
  for (let k = 0; k < keys.length - 1; k++) {
    const a = keys[k]!;
    const b = keys[k + 1]!;
    if (f >= a.frame && f <= b.frame) {
      const span = b.frame - a.frame;
      const t = span > 0 ? (f - a.frame) / span : 0;
      const av = a.value as Vector3;
      const bv = b.value as Vector3;
      return new Vector3(
        av.x + (bv.x - av.x) * t,
        av.y + (bv.y - av.y) * t,
        av.z + (bv.z - av.z) * t,
      );
    }
  }
  return (first.value as Vector3).clone();
}

/** Sample the lowest world-Y across all sample TNs, evaluated at every
 * integer frame in [fStart, fEnd]. Drives the AG via goToFrame so each sample
 * reflects the retargeted pose, and restores the pre-sample TN state on exit
 * — without that, subsequent clips retarget from a corrupted base pose. */
function sampleLowestYPerFrame(
  ag: AnimationGroup,
  sampleTNs: readonly TransformNode[],
  meshRoot: TransformNode,
  fStart: number,
  fEnd: number,
): Float32Array {
  const snapshot = new Map<
    TransformNode,
    { pos: Vector3; rot: Quaternion | null; scale: Vector3 }
  >();
  for (const tn of sampleTNs) {
    snapshot.set(tn, {
      pos: tn.position.clone(),
      rot: tn.rotationQuaternion?.clone() ?? null,
      scale: tn.scaling.clone(),
    });
  }

  ag.start(false, 1.0, ag.from, ag.to);
  ag.pause();
  const out = new Float32Array(fEnd - fStart + 1);
  for (let f = fStart; f <= fEnd; f++) {
    ag.goToFrame(f);
    meshRoot.computeWorldMatrix(true);
    let lowest = Infinity;
    for (const tn of sampleTNs) {
      tn.computeWorldMatrix(true);
      const y = tn.getAbsolutePosition().y;
      if (y < lowest) lowest = y;
    }
    out[f - fStart] = lowest;
  }
  ag.stop();

  for (const [tn, snap] of snapshot) {
    tn.position.copyFrom(snap.pos);
    if (snap.rot && tn.rotationQuaternion) tn.rotationQuaternion.copyFrom(snap.rot);
    tn.scaling.copyFrom(snap.scale);
  }
  return out;
}

/** Symmetric moving-average over `radius` frames on each side. Suppresses
 * per-frame oscillation from alternating-foot gaits (run, jog) where lowest-Y
 * jumps between planted-foot and both-lifted within a single stride. Slower
 * trends (sit→stand transitions) survive intact.
 *
 * `circular=true` wraps neighbour sampling modulo the length so loop clips
 * produce smoothed[0] === smoothed[N-1], avoiding a Hips-Y discontinuity at
 * the loop seam (otherwise edge clipping leaves the two ends biased toward
 * different stride phases and the wrap-back ticks visibly each cycle). */
function smoothInPlace(arr: Float32Array, radius: number, circular: boolean): void {
  if (radius <= 0 || arr.length === 0) return;
  const src = new Float32Array(arr);
  const n = arr.length;
  for (let i = 0; i < n; i++) {
    let sum = 0;
    let count = 0;
    if (circular) {
      for (let k = -radius; k <= radius; k++) {
        const j = ((i + k) % n + n) % n;
        sum += src[j] ?? 0;
        count++;
      }
    } else {
      const lo = Math.max(0, i - radius);
      const hi = Math.min(n - 1, i + radius);
      for (let j = lo; j <= hi; j++) sum += src[j] ?? 0;
      count = hi - lo + 1;
    }
    arr[i] = sum / count;
  }
}

/** Linearly redistribute the seam delta (last - first) across the loop so
 * `keys[N-1] === keys[0]` exactly, with each intermediate frame absorbing a
 * proportional share. Source UAL run/jog loops have ~20mm built-in Hips Y
 * drift between first and last frame; on Babylon CYCLE playback this is a
 * one-frame snap each wrap, visible as a "tick" while running. Distributing
 * the delta tilts the trajectory by a fraction of a mm per frame —
 * imperceptible — and removes the seam. */
function distributeLoopSeam(keys: { frame: number; value: Vector3 }[]): void {
  const n = keys.length;
  if (n < 2) return;
  const first = keys[0]!.value;
  const last = keys[n - 1]!.value;
  const dx = last.x - first.x;
  const dy = last.y - first.y;
  const dz = last.z - first.z;
  if (dx === 0 && dy === 0 && dz === 0) return;
  for (let i = 0; i < n; i++) {
    const t = i / (n - 1);
    const v = keys[i]!.value;
    v.x -= dx * t;
    v.y -= dy * t;
    v.z -= dz * t;
  }
}

/** Smooth-blend between two correction modes, anchored to the rig's char
 * floor (idle pose's mesh-floor — see CharFloorRefs):
 *   contact  (lowest near char floor)        → snap that frame's lowest to 0
 *   airborne (lowest well above contact zone) → uniform char-floor shift so
 *                                                feet land on floor at next
 *                                                contact while preserving apex
 *
 * `lowestPerFrame` here is mesh-Y estimate (bone-Y already shifted by
 * meshBoneOffset), so "snap to 0" puts the rendered foot on the floor.
 *
 * Linear blend across the transition zone avoids one-frame Hips jumps at the
 * mode boundary. */
function buildCorrectionCurve(
  lowestPerFrame: Float32Array,
  invScaleY: number,
  charFloorM: number,
): { corrections: Float32Array; contactCount: number } {
  const corrections = new Float32Array(lowestPerFrame.length);
  let contactCount = 0;
  for (let i = 0; i < lowestPerFrame.length; i++) {
    const ly = lowestPerFrame[i] ?? 0;
    const distAbove = ly - charFloorM;
    const grounded = Math.max(
      0,
      Math.min(1, 1 - (distAbove - GROUND_CONTACT_THRESHOLD_M) / GROUND_TRANSITION_M),
    );
    if (grounded > 0.5) contactCount++;
    corrections[i] = (grounded * ly + (1 - grounded) * charFloorM) * invScaleY;
  }
  return { corrections, contactCount };
}

interface CharFloorRefs {
  /** Lowest bone world Y across idle frames. Anchors contact-zone classification. */
  boneFloorM: number;
  /** Lowest skinned-mesh world Y across idle frames. Where feet *visually* sit;
   * differs from boneFloorM when the foot bone is inside the mesh (toes/heel
   * extend below the joint). Used as the post-correction target so the rendered
   * mesh — not the bone — lands on the floor. */
  meshFloorM: number;
}

/** Measure both bone-floor and mesh-floor at the idle pose. The bone reference
 * keeps contact-zone classification stable across rigs (some have feet >0 even
 * at rest, e.g. handyc at +1m). The mesh reference closes the visual gap when
 * the foot bone sits inside the mesh: snapping the bone to Y=0 would leave the
 * toes/heel below the floor. We measure both at the same idle frames so their
 * delta — assumed roughly pose-invariant during ground contact — can be used
 * to shift corrections to land mesh-on-floor instead of bone-on-floor.
 * Returns zeros when no usable idle clip exists. */
function measureCharFloor(
  idleAg: AnimationGroup,
  skeleton: Skeleton,
  mesh: { meshes: AbstractMesh[] },
  meshRoot: TransformNode,
): CharFloorRefs {
  const animatedTNs = new Set<TransformNode>();
  for (const ta of idleAg.targetedAnimations) {
    const tgt = ta.target as TransformNode | null | undefined;
    if (tgt) animatedTNs.add(tgt);
  }
  const sampleTNs: TransformNode[] = [];
  for (const bone of skeleton.bones) {
    const tn = bone.getTransformNode();
    if (tn && animatedTNs.has(tn)) sampleTNs.push(tn);
  }
  if (sampleTNs.length === 0) return { boneFloorM: 0, meshFloorM: 0 };
  const fStart = Math.floor(idleAg.from);
  const fEnd = Math.ceil(idleAg.to);
  if (fEnd <= fStart) return { boneFloorM: 0, meshFloorM: 0 };

  const skinnedMeshes = mesh.meshes.filter(
    (m): m is AbstractMesh => !!m.skeleton && m.getTotalVertices?.() > 0,
  );

  const boneSamples = sampleLowestYPerFrame(idleAg, sampleTNs, meshRoot, fStart, fEnd);
  const meshSamples = sampleLowestMeshYPerFrame(idleAg, skinnedMeshes, meshRoot, fStart, fEnd);

  let boneFloor = Infinity;
  for (const v of boneSamples) if (v < boneFloor) boneFloor = v;
  let meshFloor = Infinity;
  for (const v of meshSamples) if (v < meshFloor) meshFloor = v;

  return {
    boneFloorM: boneFloor === Infinity ? 0 : boneFloor,
    meshFloorM: meshFloor === Infinity ? 0 : meshFloor,
  };
}

/** Same shape as sampleLowestYPerFrame but reads each skinned mesh's
 * pose-aware bounding box (refreshed with skeleton applied) instead of bone
 * positions. Captures the actual rendered foot extent — the toe/heel mesh that
 * dips below the foot bone. */
function sampleLowestMeshYPerFrame(
  ag: AnimationGroup,
  skinnedMeshes: readonly AbstractMesh[],
  meshRoot: TransformNode,
  fStart: number,
  fEnd: number,
): Float32Array {
  const out = new Float32Array(fEnd - fStart + 1);
  if (skinnedMeshes.length === 0) {
    out.fill(0);
    return out;
  }
  ag.start(false, 1.0, ag.from, ag.to);
  ag.pause();
  for (let f = fStart; f <= fEnd; f++) {
    ag.goToFrame(f);
    meshRoot.computeWorldMatrix(true);
    let lowest = Infinity;
    for (const m of skinnedMeshes) {
      m.refreshBoundingInfo({ applySkeleton: true });
      const minY = m.getBoundingInfo().boundingBox.minimumWorld.y;
      if (minY < lowest) lowest = minY;
    }
    out[f - fStart] = lowest === Infinity ? 0 : lowest;
  }
  ag.stop();
  return out;
}

/**
 * Per-frame ground anchoring for one retargeted clip.
 *
 * For each integer frame, samples the lowest world-Y across bones the clip
 * actually animates (no foot/hip naming, no static jiggle bones). Each frame
 * snaps that lowest bone toward the floor (Y=0) when it's within the contact
 * zone, fades to no-shift over a transition zone, and leaves true airborne
 * frames alone — so a standing-pose start frame stays at floor regardless of
 * how deep a lying-pose end frame goes, which a single constant offset can't
 * achieve for transitional clips (defeat: standing → lying).
 *
 * Returns null when no correction was needed (peak shift below threshold).
 */
function applyAutoGroundCorrection(
  ag: AnimationGroup,
  skeleton: Skeleton,
  meshRoot: TransformNode,
  charFloorM: number,
  meshBoneOffsetM: number,
  isLoop: boolean,
): GroundCorrectionResult | null {
  // Only sample bones this clip actually animates. Cloth / hair / breast
  // jiggle chains are skeleton bones too, but they're runtime-driven (no
  // keyframes) and sit at static T-pose offsets during build — sampling them
  // would let a cloth tip 50cm below the hips set the floor baseline.
  const animatedTNs = new Set<TransformNode>();
  for (const ta of ag.targetedAnimations) {
    const tgt = ta.target as TransformNode | null | undefined;
    if (tgt) animatedTNs.add(tgt);
  }
  const sampleTNs: TransformNode[] = [];
  for (const bone of skeleton.bones) {
    const tn = bone.getTransformNode();
    if (tn && animatedTNs.has(tn)) sampleTNs.push(tn);
  }
  if (sampleTNs.length === 0) return null;

  const hipsTA = ag.targetedAnimations.find((ta) => {
    const tgt = ta.target as TransformNode;
    return tgt?.name?.includes('Hips') && ta.animation.targetProperty === 'position';
  });
  if (!hipsTA) return null;
  const oldKeys = hipsTA.animation.getKeys();
  if (oldKeys.length === 0) return null;

  const fStart = Math.floor(ag.from);
  const fEnd = Math.ceil(ag.to);
  if (fEnd <= fStart) return null;

  const scaleY = accumulatedYScale(hipsTA.target as TransformNode);
  const invScaleY = scaleY > 0 ? 1 / scaleY : 1;

  const lowestPerFrame = sampleLowestYPerFrame(ag, sampleTNs, meshRoot, fStart, fEnd);
  smoothInPlace(lowestPerFrame, GROUND_SMOOTH_RADIUS, isLoop);

  // Shift bone-Y samples to estimated mesh-Y (lowest mesh sits meshBoneOffsetM
  // below lowest bone — measured once at idle, treated as pose-invariant
  // during contact). The contact/airborne formula then drives the *mesh*
  // toward floor, not the bone.
  if (meshBoneOffsetM !== 0) {
    for (let i = 0; i < lowestPerFrame.length; i++) {
      lowestPerFrame[i] -= meshBoneOffsetM;
    }
  }

  let minLowestM = Infinity;
  let maxLowestM = -Infinity;
  for (const v of lowestPerFrame) {
    if (v < minLowestM) minLowestM = v;
    if (v > maxLowestM) maxLowestM = v;
  }

  const { corrections, contactCount } = buildCorrectionCurve(
    lowestPerFrame,
    invScaleY,
    charFloorM,
  );

  let maxAbs = 0;
  for (const c of corrections) {
    const a = Math.abs(c);
    if (a > maxAbs) maxAbs = a;
  }
  if (maxAbs * scaleY < GROUND_MIN_CORRECTION_M) return null;

  const newKeys: { frame: number; value: Vector3 }[] = [];
  for (let f = fStart; f <= fEnd; f++) {
    const v = interpVec3At(oldKeys, f);
    v.y -= corrections[f - fStart] ?? 0;
    newKeys.push({ frame: f, value: v });
  }
  if (isLoop && newKeys.length > 1) {
    distributeLoopSeam(newKeys);
  }
  hipsTA.animation.setKeys(newKeys);

  return {
    contactFrames: contactCount,
    totalFrames: lowestPerFrame.length,
    minLowestM,
    maxLowestM,
  };
}

async function retargetAndSerialize(char: CharacterSource): Promise<void> {
  const meshGlb = path.join(MODELS, `${char.id}_mesh.glb`);
  const ual1Glb = path.join(MODELS, 'ual1_anims.glb');
  const ual2Glb = path.join(MODELS, 'ual2_anims.glb');
  const outGlb = path.join(MODELS, `${char.id}.glb`);

  const engine = new NullEngine();
  const scene = new Scene(engine);

  console.log(`[build:${char.id}] loading GLBs...`);
  const [mesh, ual1, ual2] = await Promise.all([
    SceneLoader.ImportMeshAsync(null, '', glbToDataUrl(meshGlb), scene, null, '.glb'),
    SceneLoader.ImportMeshAsync(null, '', glbToDataUrl(ual1Glb), scene, null, '.glb'),
    SceneLoader.ImportMeshAsync(null, '', glbToDataUrl(ual2Glb), scene, null, '.glb'),
  ]);

  for (const ag of ual1.animationGroups) ag.stop();
  for (const ag of ual2.animationGroups) ag.stop();

  const meshRoot = mesh.meshes.find(
    (m) => m.name === '__root__' || m.parent === null,
  ) as unknown as TransformNode | undefined;
  if (!meshRoot) throw new Error(`${meshGlb} missing root transform`);

  const avatar = new AnimatorAvatar(`${char.id}_avatar`, meshRoot, false, false);
  avatar.showWarnings = false;

  // Snapshot rest pose — retargetAnimationGroup leaves TransformNode values
  // at the last keyframe of the last retargeted animation.
  const rest = new Map<
    TransformNode,
    { pos: Vector3; rot: Quaternion | null; scale: Vector3 }
  >();
  for (const tn of mesh.transformNodes) {
    rest.set(tn, {
      pos: tn.position.clone(),
      rot: tn.rotationQuaternion?.clone() ?? null,
      scale: tn.scaling.clone(),
    });
  }

  const ual1ByClip = new Map(ual1.animationGroups.map((ag) => [ag.name, ag]));
  const ual2ByClip = new Map(ual2.animationGroups.map((ag) => [ag.name, ag]));
  const needed = new Set<string>();
  const loopByClip = new Map<string, boolean>();
  for (const cfg of Object.values(ANIM_CONFIG)) {
    needed.add(`${cfg.src ?? 'ual1'}:${cfg.glb}`);
    if (cfg.loop) loopByClip.set(cfg.glb, true);
  }

  // Pre-pass: retarget Idle_Loop first to measure the character's natural
  // floor (lowest bone Y in standing pose). Subtracted from every clip's
  // samples so contact-zone classification is anchored to the rig's actual
  // standing pose, not a hardcoded Y=0 (some rigs have feet >0 even at rest).
  const skeleton = mesh.skeletons[0];
  let charFloorM = 0;
  let meshBoneOffsetM = 0;
  const idleAg = (() => {
    const idleKey = needed.has('ual1:Idle_Loop') ? 'ual1:Idle_Loop' : null;
    if (!idleKey) return null;
    const found = ual1ByClip.get('Idle_Loop');
    if (!found) return null;
    return avatar.retargetAnimationGroup(found, {
      animationGroupName: 'Idle_Loop',
      mapNodeNames: UAL_TO_MIXAMO_BONE_MAP,
      fixRootPosition: false,
      fixGroundReference: false,
    });
  })();
  if (idleAg) {
    idleAg.stop();
    if (char.autoGroundCorrect !== false && skeleton) {
      const refs = measureCharFloor(idleAg, skeleton, mesh, meshRoot);
      // charFloorM is the per-frame mesh-Y reference: distance above this
      // governs contact-zone classification, and uniform airborne shift
      // targets it. Using mesh (not bone) so the rendered foot — not the
      // joint inside the foot — lands on the floor.
      charFloorM = refs.meshFloorM;
      meshBoneOffsetM = refs.boneFloorM - refs.meshFloorM;
      if (Math.abs(charFloorM) > 0.005 || Math.abs(meshBoneOffsetM) > 0.005) {
        console.log(
          `[build:${char.id}] char floor: bone=${(refs.boneFloorM * 1000).toFixed(0)}mm ` +
            `mesh=${(refs.meshFloorM * 1000).toFixed(0)}mm ` +
            `(offset=${(meshBoneOffsetM * 1000).toFixed(0)}mm)`,
        );
      }
    }
  }

  let retargeted = 0;
  let missing = 0;
  for (const key of needed) {
    const [src, clip] = key.split(':', 2) as ['ual1' | 'ual2', string];
    const found = (src === 'ual2' ? ual2ByClip : ual1ByClip).get(clip);
    if (!found) {
      console.warn(`[build:${char.id}] missing source clip: ${src}/${clip}`);
      missing++;
      continue;
    }
    const out =
      clip === 'Idle_Loop' && idleAg
        ? idleAg
        : avatar.retargetAnimationGroup(found, {
            animationGroupName: clip,
            mapNodeNames: UAL_TO_MIXAMO_BONE_MAP,
            fixRootPosition: false,
            fixGroundReference: false,
          });
    out.stop();

    if (char.autoGroundCorrect !== false && skeleton) {
      const isLoop = loopByClip.get(clip) ?? false;
      const result = applyAutoGroundCorrection(
        out,
        skeleton,
        meshRoot,
        charFloorM,
        meshBoneOffsetM,
        isLoop,
      );
      if (result) {
        const airborne = result.totalFrames - result.contactFrames;
        const mode = airborne === 0 ? 'always-contact' : result.contactFrames === 0 ? 'always-airborne' : 'mixed';
        console.log(
          `[build:${char.id}] ground-auto ${clip}: ${result.contactFrames}/${result.totalFrames} contact, ` +
            `lowest=[${(result.minLowestM * 1000).toFixed(0)}mm, ${(result.maxLowestM * 1000).toFixed(0)}mm], ${mode}`,
        );
      }
    }

    retargeted++;
  }

  for (const [tn, r] of rest) {
    tn.position.copyFrom(r.pos);
    if (r.rot && tn.rotationQuaternion) tn.rotationQuaternion.copyFrom(r.rot);
    tn.scaling.copyFrom(r.scale);
  }

  for (const ag of ual1.animationGroups) ag.dispose();
  for (const ag of ual2.animationGroups) ag.dispose();
  for (const sk of ual1.skeletons) sk.dispose();
  for (const sk of ual2.skeletons) sk.dispose();
  for (const tn of ual1.transformNodes) tn.dispose(false, true);
  for (const tn of ual2.transformNodes) tn.dispose(false, true);

  console.log(`[build:${char.id}] retargeted ${retargeted} clips (${missing} missing)`);

  const keep = new Set<unknown>([
    meshRoot,
    ...mesh.meshes,
    ...mesh.transformNodes,
  ]);

  const glb = await GLTF2Export.GLBAsync(scene, char.id, {
    shouldExportNode: (node) => keep.has(node),
  });
  const bytes = glb.glTFFiles[`${char.id}.glb`];
  if (!bytes) throw new Error('GLB export produced no file');
  const buf =
    bytes instanceof Blob
      ? Buffer.from(await bytes.arrayBuffer())
      : Buffer.from(bytes as ArrayBuffer);
  fs.writeFileSync(outGlb, buf);
  console.log(`[build:${char.id}] wrote ${outGlb} (${buf.length.toLocaleString()} bytes)`);

  engine.dispose();
}

async function main(): Promise<void> {
  fs.mkdirSync(MODELS, { recursive: true });
  const force = process.argv.includes('--force');
  const forceUal = process.argv.includes('--force-ual');
  const charArgIdx = process.argv.indexOf('--char');
  if (charArgIdx !== -1 && !process.argv[charArgIdx + 1]) {
    console.error('[build] --char requires a character id');
    process.exit(1);
  }
  const charArg = charArgIdx !== -1 ? process.argv[charArgIdx + 1] : null;

  if (charArg && !CHARACTERS.find((c) => c.id === charArg)) {
    console.error(`[build] unknown character: "${charArg}". Valid ids: ${CHARACTERS.map((c) => c.id).join(', ')}`);
    process.exit(1);
  }

  if (force) {
    const affected = charArg ? [charArg] : CHARACTERS.map((c) => c.id);
    console.warn(
      `[build] WARNING: --force will regenerate ${affected.map((id) => `${id}_mesh.glb`).join(', ')} from source FBX, overwriting any manual mesh edits.`,
    );
  }

  // Step 1: export UAL animation packs (shared across all characters).
  // --force only forces the selected character; use --force-ual to rebuild UAL packs too.
  const ual1Out = path.join(MODELS, 'ual1_anims.glb');
  const ualScript = path.join(SCRIPTS, 'export_ual_anims.py');
  if (forceUal || needsRebuild(ual1Out, UAL1_BLEND, ualScript)) {
    runBlender('export_ual_anims.py', { UAL_BLEND: UAL1_BLEND, UAL_OUT: ual1Out });
  } else {
    console.log('[build] ual1_anims.glb up to date');
  }

  const ual2Out = path.join(MODELS, 'ual2_anims.glb');
  if (forceUal || needsRebuild(ual2Out, UAL2_BLEND, ualScript)) {
    runBlender('export_ual_anims.py', { UAL_BLEND: UAL2_BLEND, UAL_OUT: ual2Out });
  } else {
    console.log('[build] ual2_anims.glb up to date');
  }

  // Step 2 + 3: per character, export/copy mesh + inject bones + retarget + serialize.
  const chars = charArg ? CHARACTERS.filter((c) => c.id === charArg) : CHARACTERS;
  for (const char of chars) {
    const meshOut = path.join(MODELS, `${char.id}_mesh.glb`);
    const meshScript = path.join(SCRIPTS, 'export_mesh.py');
    const rotateScript = path.join(SCRIPTS, 'rotate_glb.py');
    const injectScript = path.join(SCRIPTS, 'inject_bones.py');
    // Include all pipeline scripts that touch the mesh as rebuild triggers so
    // changes to rotate_glb.py, inject_bones.py, or characters.ts config
    // (preRotateXDeg, autoGround, injectBones) cause a fresh mesh build.
    const meshInputs = [
      char.source,
      meshScript,
      ...(char.preRotateXDeg || char.autoGround ? [rotateScript] : []),
      ...(char.injectBones?.length ? [injectScript] : []),
    ];
    if (force || needsRebuild(meshOut, ...meshInputs)) {
      // export_mesh.py bakes the T-pose into mesh verts and skeleton rest pose.
      // This is required for both FBX and GLB sources — raw GLBs from Mixamo have
      // an unbaked rest pose (armature scale=0.01, A-pose rest) that causes the
      // retargeter to produce wrong deformations (character gigantic / lying flat).
      runBlender('export_mesh.py', { MESH_FBX: char.source, MESH_OUT: meshOut });
      if (char.preRotateXDeg || char.autoGround) {
        console.log(
          `[build:${char.id}] pre-rotating ${char.preRotateXDeg ?? 0}° X${char.autoGround ? ' + auto-ground' : ''}...`,
        );
        runBlender('rotate_glb.py', {
          MESH_GLB: meshOut,
          ROT_X_DEG: String(char.preRotateXDeg ?? 0),
          AUTO_GROUND: char.autoGround ? '1' : '0',
        });
      }
      if (char.injectBones?.length) {
        console.log(`[build:${char.id}] injecting ${char.injectBones.length} extra bones...`);
        runBlender('inject_bones.py', {
          MESH_GLB: meshOut,
          BONES_JSON: JSON.stringify(char.injectBones),
        });
      }
    } else {
      console.log(`[build:${char.id}] mesh up to date`);
    }

    await retargetAndSerialize(char);
  }

  console.log('[build] done');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
