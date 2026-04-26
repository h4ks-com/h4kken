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
  AnimatorAvatar,
  NullEngine,
  Quaternion,
  Scene,
  SceneLoader,
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

/**
 * Shifts every keyframe value of the `position` property on the Hips
 * TransformNode in an AnimationGroup by `deltaY` on the Y axis.
 *
 * After UAL→Mixamo retargeting, proportional rig differences cause ground-
 * contact poses (death, crouch, ground-sit) to float above or sink below Y=0.
 * Subtracting the measured float amount uniformly from all Hips Y keyframes
 * corrects this. The correction is imperceptible at the start of fall/death
 * anims due to blending, and makes the end-pose land on the floor correctly.
 *
 * @param ag       The retargeted AnimationGroup.
 * @param deltaY   Correction in world metres (as computed by Blender FK analysis).
 *                 Converted to GLB keyframe units via the armature's world scale.
 */
function applyHipsYCorrection(
  ag: ReturnType<AnimatorAvatar['retargetAnimationGroup']>,
  deltaY: number,
): void {
  for (const ta of ag.targetedAnimations) {
    const tgt = ta.target as TransformNode;
    if (!tgt?.name?.includes('Hips')) continue;
    if (ta.animation.targetProperty !== 'position') continue;

    // Keyframe values are in the armature's local space. Walk up the TN parent
    // chain to find the accumulated Y scale, then convert the metre correction
    // to keyframe units (e.g. handyc's armature has scale=0.01 → divide by 0.01).
    let scaleY = 1;
    let node: TransformNode | null = tgt.parent as TransformNode | null;
    while (node) {
      scaleY *= node.scaling.y;
      node = node.parent as TransformNode | null;
    }
    const deltaKeyframe = scaleY > 0 ? deltaY / scaleY : deltaY;

    for (const key of ta.animation.getKeys()) {
      (key.value as Vector3).y -= deltaKeyframe;
    }
    return;
  }
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
  for (const cfg of Object.values(ANIM_CONFIG)) {
    needed.add(`${cfg.src ?? 'ual1'}:${cfg.glb}`);
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
    const out = avatar.retargetAnimationGroup(found, {
      animationGroupName: clip,
      mapNodeNames: UAL_TO_MIXAMO_BONE_MAP,
      fixRootPosition: false,
      fixGroundReference: false,
    });
    out.stop();

    const groundDelta = char.groundCorrections?.[clip];
    if (groundDelta !== undefined && Math.abs(groundDelta) > 0.001) {
      applyHipsYCorrection(out, groundDelta);
      console.log(`[build:${char.id}] ground-corrected ${clip}: Hips Y ${groundDelta > 0 ? '-' : '+'}${Math.abs(groundDelta).toFixed(4)}m`);
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
