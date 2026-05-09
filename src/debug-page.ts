// Standalone debug viewer — orbit/pan/zoom around a single character, swap
// character + animation via dropdowns, toggle the JiggleSim debug overlay.
// Reuses Fighter.loadAssets, JiggleSim, JiggleDebug, cloneBindings.

import {
  type AbstractMesh,
  type AnimationGroup,
  ArcRotateCamera,
  Color3,
  Color4,
  Engine,
  HemisphericLight,
  MeshBuilder,
  Quaternion,
  Scene,
  type Skeleton,
  StandardMaterial,
  TransformNode,
  Vector3,
} from '@babylonjs/core';
import { JiggleDebug } from './debug/JiggleDebug';
import { ANIM_CONFIG, type AnimKey } from './fighter/animations';
import { CHARACTERS } from './fighter/characters';
import {
  buildBoneMap,
  cloneAndPrepareSkeleton,
  remapAnimationTarget,
} from './fighter/cloneBindings';
import type { Fighter, SharedAssets } from './fighter/Fighter';
import { Fighter as FighterClass } from './fighter/Fighter';
import { JiggleSim } from './fighter/JiggleSim';

const DEFAULT_CHAR = 'liu';
const DEFAULT_ANIM: AnimKey = 'walk';

/** Minimal character preview — clones a single character at origin, runs
 * one anim at a time, owns its JiggleSim. Implements the parts of `Fighter`
 * that JiggleDebug pokes at (`jiggleSim`, `meshes`). */
class DebugCharacter implements Pick<Fighter, 'jiggleSim' | 'meshes'> {
  jiggleSim: JiggleSim | null = null;
  meshes: AbstractMesh[] = [];

  private rootNode: TransformNode;
  private clonedSkeleton: Skeleton | null = null;
  private animGroups: Record<string, AnimationGroup> = {};
  private currentAnim: AnimationGroup | null = null;
  private lastFrameMs = 0;
  private renderObserverRunning = false;
  /** Time scale — affects both animation playback and JiggleSim dt so cloth
   * physics slows with the animation. 1 = normal, 0.1 = slow-mo. */
  speedRatio = 1.0;

  constructor(private readonly scene: Scene) {
    this.rootNode = new TransformNode('debug_root', scene);
    this.rootNode.rotationQuaternion = Quaternion.Identity();
  }

  setCharacter(charId: string, assets: SharedAssets): void {
    this.dispose();
    const meta = CHARACTERS[charId];
    const scale = meta?.scale ?? 1.0;
    this.rootNode = new TransformNode('debug_root', this.scene);
    this.rootNode.rotationQuaternion = Quaternion.RotationAxis(Vector3.Up(), Math.PI);
    this.rootNode.scaling.setAll(scale);

    const clonedSkeleton = cloneAndPrepareSkeleton(
      assets.baseSkeleton,
      'debug_skeleton',
      'debug_skel',
    );
    this.clonedSkeleton = clonedSkeleton ?? null;
    const boneByName = buildBoneMap(clonedSkeleton);

    for (const baseMesh of assets.baseMeshes) {
      const clone = baseMesh.clone(`debug_${baseMesh.name}`, this.rootNode);
      if (!clone) continue;
      clone.setEnabled(true);
      if (clonedSkeleton && clone.skeleton) clone.skeleton = clonedSkeleton;
      this.meshes.push(clone);
    }

    for (const [name, src] of Object.entries(assets.animGroups)) {
      const cloned = src.clone(`debug_${name}`, (target) =>
        remapAnimationTarget(target, boneByName),
      );
      cloned.stop();
      this.animGroups[name] = cloned;
    }

    if (assets.jiggle?.bones.length && clonedSkeleton) {
      this.jiggleSim = new JiggleSim(clonedSkeleton, assets.jiggle, this.rootNode);
      if (!this.renderObserverRunning) {
        this.lastFrameMs = performance.now();
        this.scene.onBeforeRenderObservable.add(() => {
          if (!this.jiggleSim) return;
          const now = performance.now();
          const dt = now - this.lastFrameMs;
          this.lastFrameMs = now;
          // Scale jiggle dt by speedRatio so cloth physics slows with animation.
          this.jiggleSim.update(dt * this.speedRatio);
        });
        this.renderObserverRunning = true;
      }
    }
  }

  playAnim(name: string, loop = true): void {
    const next = this.animGroups[name];
    if (!next) return;
    if (this.currentAnim && this.currentAnim !== next) this.currentAnim.stop();
    next.speedRatio = this.speedRatio;
    next.play(loop);
    this.currentAnim = next;
  }

  setSpeed(ratio: number): void {
    this.speedRatio = ratio;
    if (this.currentAnim) this.currentAnim.speedRatio = ratio;
  }

  setPaused(paused: boolean): void {
    if (!this.currentAnim) return;
    if (paused) this.currentAnim.pause();
    else this.currentAnim.play(true);
  }

  availableAnimNames(): string[] {
    return Object.keys(this.animGroups);
  }

  dispose(): void {
    if (this.currentAnim) {
      this.currentAnim.stop();
      this.currentAnim = null;
    }
    for (const ag of Object.values(this.animGroups)) ag.dispose();
    this.animGroups = {};
    this.jiggleSim?.dispose();
    this.jiggleSim = null;
    this.clonedSkeleton?.dispose();
    this.clonedSkeleton = null;
    for (const m of this.meshes) m.dispose();
    this.meshes = [];
    this.rootNode.dispose();
  }
}

async function main(): Promise<void> {
  const canvas = document.getElementById('canvas') as HTMLCanvasElement;
  const status = document.getElementById('status') as HTMLDivElement;
  const charSelect = document.getElementById('char-select') as HTMLSelectElement;
  const animSelect = document.getElementById('anim-select') as HTMLSelectElement;
  const showDebug = document.getElementById('show-debug') as HTMLInputElement;
  const paused = document.getElementById('paused') as HTMLInputElement;
  const speedSlider = document.getElementById('speed') as HTMLInputElement;
  const speedVal = document.getElementById('speed-val') as HTMLSpanElement;
  const resetCam = document.getElementById('reset-cam') as HTMLButtonElement;
  const tColliders = document.getElementById('t-colliders') as HTMLInputElement;
  const tPlates = document.getElementById('t-plates') as HTMLInputElement;
  const tLateral = document.getElementById('t-lateral') as HTMLInputElement;
  const tSticky = document.getElementById('t-sticky') as HTMLInputElement;
  const tDamping = document.getElementById('t-damping') as HTMLInputElement;
  const tPendulum = document.getElementById('t-pendulum') as HTMLInputElement;
  const tContactSoft = document.getElementById('t-contact-soft') as HTMLInputElement;
  const stickSlider = document.getElementById('stick') as HTMLInputElement;
  const softFactorSlider = document.getElementById('soft-factor') as HTMLInputElement;
  const softFactorVal = document.getElementById('soft-factor-val') as HTMLSpanElement;
  const softAttackSlider = document.getElementById('soft-attack') as HTMLInputElement;
  const softAttackVal = document.getElementById('soft-attack-val') as HTMLSpanElement;
  const softReleaseSlider = document.getElementById('soft-release') as HTMLInputElement;
  const softReleaseVal = document.getElementById('soft-release-val') as HTMLSpanElement;
  const stickVal = document.getElementById('stick-val') as HTMLSpanElement;
  const liveStats = document.getElementById('live-stats') as HTMLPreElement;
  const collidersList = document.getElementById('colliders-list') as HTMLDivElement;
  const collidersCount = document.getElementById('colliders-count') as HTMLSpanElement;
  const platesList = document.getElementById('plates-list') as HTMLDivElement;
  const platesCount = document.getElementById('plates-count') as HTMLSpanElement;
  const pairsList = document.getElementById('pairs-list') as HTMLDivElement;
  const pairsCount = document.getElementById('pairs-count') as HTMLSpanElement;
  const copyConfig = document.getElementById('copy-config') as HTMLButtonElement;

  const engine = new Engine(canvas, true, { stencil: true, preserveDrawingBuffer: true });
  const scene = new Scene(engine);
  scene.clearColor = new Color4(0.12, 0.12, 0.14, 1);

  // Lighting
  const hemi = new HemisphericLight('hemi', new Vector3(0, 1, 0), scene);
  hemi.intensity = 1.1;

  // Ground for visual reference
  const ground = MeshBuilder.CreateGround('ground', { width: 6, height: 6 }, scene);
  const groundMat = new StandardMaterial('groundMat', scene);
  groundMat.diffuseColor = new Color3(0.15, 0.15, 0.18);
  groundMat.specularColor = Color3.Black();
  ground.material = groundMat;
  // Faint grid lines via wireframe overlay
  const grid = MeshBuilder.CreateGround('grid', { width: 6, height: 6, subdivisions: 12 }, scene);
  const gridMat = new StandardMaterial('gridMat', scene);
  gridMat.wireframe = true;
  gridMat.emissiveColor = new Color3(0.25, 0.25, 0.3);
  gridMat.disableLighting = true;
  grid.material = gridMat;
  grid.position.y = 0.001;

  // Orbit camera
  const camera = new ArcRotateCamera(
    'cam',
    -Math.PI / 2,
    Math.PI / 2.4,
    3.5,
    new Vector3(0, 1.0, 0),
    scene,
  );
  camera.attachControl(canvas, true);
  camera.minZ = 0.05;
  camera.maxZ = 100;
  camera.wheelPrecision = 30;
  camera.panningSensibility = 80;
  camera.lowerRadiusLimit = 0.3;
  camera.upperRadiusLimit = 20;
  const camDefaultAlpha = camera.alpha;
  const camDefaultBeta = camera.beta;
  const camDefaultRadius = camera.radius;
  const camDefaultTarget = camera.target.clone();
  resetCam.addEventListener('click', () => {
    camera.alpha = camDefaultAlpha;
    camera.beta = camDefaultBeta;
    camera.radius = camDefaultRadius;
    camera.target.copyFrom(camDefaultTarget);
  });

  // Pre-load all character assets up front so swapping is instant.
  const assetsByChar = new Map<string, SharedAssets>();
  const charIds = Object.keys(CHARACTERS);
  for (let i = 0; i < charIds.length; i++) {
    const id = charIds[i]!;
    status.textContent = `loading ${id} (${i + 1}/${charIds.length})...`;
    const assets = await FighterClass.loadAssets(scene, id);
    const meta = CHARACTERS[id]!;
    assets.scale = meta.scale;
    assets.jiggle = meta.jiggle;
    assets.glowEmissive = meta.glowEmissive;
    assetsByChar.set(id, assets);
  }
  status.textContent = `loaded ${charIds.length} characters`;

  // Populate character dropdown
  for (const id of charIds) {
    const opt = document.createElement('option');
    opt.value = id;
    opt.textContent = CHARACTERS[id]?.name ?? id;
    charSelect.appendChild(opt);
  }
  charSelect.value = assetsByChar.has(DEFAULT_CHAR) ? DEFAULT_CHAR : (charIds[0] ?? DEFAULT_CHAR);

  // Character preview + jiggle debug
  const debugChar = new DebugCharacter(scene);
  const jiggleDebug = new JiggleDebug(scene, () => [debugChar as unknown as Fighter]);

  function repopulateAnims(): void {
    animSelect.innerHTML = '';
    const names = debugChar.availableAnimNames();
    // Sort with common ones first
    const priority = ['walk', 'idle', 'combatIdle', 'run', 'jump', 'crouchIdle'];
    names.sort((a, b) => {
      const pa = priority.indexOf(a);
      const pb = priority.indexOf(b);
      if (pa !== -1 && pb !== -1) return pa - pb;
      if (pa !== -1) return -1;
      if (pb !== -1) return 1;
      return a.localeCompare(b);
    });
    for (const n of names) {
      const opt = document.createElement('option');
      opt.value = n;
      opt.textContent = n;
      animSelect.appendChild(opt);
    }
    const want = (Object.keys(ANIM_CONFIG) as string[]).includes(DEFAULT_ANIM)
      ? DEFAULT_ANIM
      : names[0];
    if (want) animSelect.value = want;
  }

  /** Build the live collider + lateral-pair tuning UI for the active character. */
  function rebuildTuningUI(): void {
    collidersList.innerHTML = '';
    pairsList.innerHTML = '';
    const sim = debugChar.jiggleSim;
    const cCount = sim?.colliderCount ?? 0;
    const pCount = sim?.lateralPairCount ?? 0;
    collidersCount.textContent = cCount > 0 ? `(${cCount})` : '';
    pairsCount.textContent = pCount > 0 ? `(${pCount})` : '';

    if (!sim || cCount === 0) {
      const e = document.createElement('div');
      e.className = 'empty';
      e.textContent = 'No colliders for this character';
      collidersList.appendChild(e);
    } else {
      // Detect L↔R mirror pairs by name and render ONE slider that updates both.
      const mirrorName = (n: string): string | null => {
        if (n.includes('Left')) return n.replace('Left', 'Right');
        if (n.includes('Right')) return n.replace('Right', 'Left');
        return null;
      };
      const mirrorOf = new Map<number, number>();
      for (let i = 0; i < cCount; i++) {
        const info = sim.getColliderInfo(i);
        if (!info) continue;
        const mBone = mirrorName(info.boneName);
        const mTo = info.toBoneName ? mirrorName(info.toBoneName) : null;
        if (!mBone) continue;
        for (let j = 0; j < cCount; j++) {
          if (i === j) continue;
          const info2 = sim.getColliderInfo(j);
          if (!info2) continue;
          if (info2.boneName === mBone && info2.toBoneName === mTo) {
            mirrorOf.set(i, j);
            break;
          }
        }
      }
      const visited = new Set<number>();
      for (let i = 0; i < cCount; i++) {
        if (visited.has(i)) continue;
        const info = sim.getColliderInfo(i);
        if (!info) continue;
        const partner = mirrorOf.get(i);
        const indices: number[] = [i];
        // Only render the "Left" side as primary; skip the "Right" partner.
        if (partner !== undefined) {
          // If this is the "Right" side, skip — its Left counterpart will render it.
          if (info.boneName.includes('Right')) {
            visited.add(i);
            continue;
          }
          indices.push(partner);
          visited.add(partner);
        }
        visited.add(i);

        const row = document.createElement('div');
        row.className = 'row';
        const short = (s: string) =>
          s
            .replace('mixamorig:', '')
            .replace(/^Left/, '')
            .replace(/^Right/, '');
        const label = document.createElement('label');
        const baseName = `${short(info.boneName)}${info.toBoneName ? '→' + short(info.toBoneName) : ''}`;
        label.textContent = partner !== undefined ? `L/R ${baseName}` : baseName;
        const slider = document.createElement('input');
        slider.type = 'range';
        slider.min = '0.01';
        slider.max = '0.30';
        slider.step = '0.005';
        slider.value = info.radius.toFixed(3);
        const val = document.createElement('span');
        val.className = 'val';
        val.textContent = `${info.radius.toFixed(3)}m`;
        slider.addEventListener('input', () => {
          const r = parseFloat(slider.value);
          for (const idx of indices) sim.setColliderRadius(idx, r);
          val.textContent = `${r.toFixed(3)}m`;
        });
        row.appendChild(label);
        row.appendChild(val);
        const sliderRow = document.createElement('div');
        sliderRow.style.gridColumn = '1 / -1';
        sliderRow.appendChild(slider);
        collidersList.appendChild(row);
        collidersList.appendChild(sliderRow);
      }
    }

    // Plates section
    const plCount = sim?.plateCount ?? 0;
    platesList.innerHTML = '';
    platesCount.textContent = plCount > 0 ? `(${plCount})` : '';
    if (!sim || plCount === 0) {
      const e = document.createElement('div');
      e.className = 'empty';
      e.textContent = 'No plate colliders for this character';
      platesList.appendChild(e);
    } else {
      // Group plates by bone — front/back pair on same bone share a row.
      // Also auto-mirror Left↔Right.
      const mirrorBoneName = (n: string): string | null => {
        if (n.includes('Left')) return n.replace('Left', 'Right');
        if (n.includes('Right')) return n.replace('Right', 'Left');
        return null;
      };
      const visited = new Set<number>();
      for (let i = 0; i < plCount; i++) {
        if (visited.has(i)) continue;
        const info = sim.getPlateInfo(i);
        if (!info) continue;
        // Find all plates on the same bone (front + back) and on mirror bone.
        const indices: number[] = [];
        const mirror = mirrorBoneName(info.boneName);
        const isLeft = info.boneName.includes('Left');
        const isRight = info.boneName.includes('Right');
        // Skip Right side — its Left counterpart will render it.
        if (isRight && mirror) {
          visited.add(i);
          continue;
        }
        for (let j = 0; j < plCount; j++) {
          const inf = sim.getPlateInfo(j);
          if (!inf) continue;
          if (inf.boneName === info.boneName) {
            if (!visited.has(j)) {
              indices.push(j);
              visited.add(j);
            }
          } else if (mirror && inf.boneName === mirror) {
            if (!visited.has(j)) {
              indices.push(j);
              visited.add(j);
            }
          }
        }

        const short = (s: string) =>
          s
            .replace('mixamorig:', '')
            .replace(/^Left/, '')
            .replace(/^Right/, '');
        const labelText = (mirror && isLeft ? 'L/R ' : '') + short(info.boneName);

        // Width slider
        const wRow = document.createElement('div');
        wRow.className = 'row';
        const wLab = document.createElement('label');
        wLab.textContent = `${labelText} width`;
        const wSlider = document.createElement('input');
        wSlider.type = 'range';
        wSlider.min = '0.02';
        wSlider.max = '0.5';
        wSlider.step = '0.005';
        wSlider.value = info.width.toFixed(3);
        const wVal = document.createElement('span');
        wVal.className = 'val';
        wVal.textContent = `${info.width.toFixed(3)}m`;
        wRow.appendChild(wLab);
        wRow.appendChild(wVal);
        const wSliderRow = document.createElement('div');
        wSliderRow.style.gridColumn = '1 / -1';
        wSliderRow.appendChild(wSlider);

        // Height slider
        const hRow = document.createElement('div');
        hRow.className = 'row';
        const hLab = document.createElement('label');
        hLab.textContent = `${labelText} height`;
        const hSlider = document.createElement('input');
        hSlider.type = 'range';
        hSlider.min = '0.02';
        hSlider.max = '0.5';
        hSlider.step = '0.005';
        hSlider.value = info.height.toFixed(3);
        const hVal = document.createElement('span');
        hVal.className = 'val';
        hVal.textContent = `${info.height.toFixed(3)}m`;
        hRow.appendChild(hLab);
        hRow.appendChild(hVal);
        const hSliderRow = document.createElement('div');
        hSliderRow.style.gridColumn = '1 / -1';
        hSliderRow.appendChild(hSlider);

        const apply = (): void => {
          const w = parseFloat(wSlider.value);
          const h = parseFloat(hSlider.value);
          for (const idx of indices) sim.setPlateSize(idx, w, h);
          wVal.textContent = `${w.toFixed(3)}m`;
          hVal.textContent = `${h.toFixed(3)}m`;
        };
        wSlider.addEventListener('input', apply);
        hSlider.addEventListener('input', apply);

        platesList.appendChild(wRow);
        platesList.appendChild(wSliderRow);
        platesList.appendChild(hRow);
        platesList.appendChild(hSliderRow);
      }
    }

    if (!sim || pCount === 0) {
      const e = document.createElement('div');
      e.className = 'empty';
      e.textContent = 'No lateral pairs for this character';
      pairsList.appendChild(e);
    } else {
      // Group pairs by chain-pair name (e.g. "Cloth_Front_L↔Cloth_Front_C") and
      // expose ONE slider per chain pair (since they all share the same stiffness).
      const groups = new Map<string, number[]>();
      for (let i = 0; i < pCount; i++) {
        const info = sim.getLateralPairInfo(i);
        if (!info) continue;
        // Strip trailing _N from bone name to get the chain prefix.
        const aChain = info.aBoneName.replace(/_\d+$/, '');
        const bChain = info.bBoneName.replace(/_\d+$/, '');
        const key = `${aChain}↔${bChain}`;
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key)!.push(i);
      }
      for (const [key, indices] of groups) {
        const firstIdx = indices[0]!;
        const info = sim.getLateralPairInfo(firstIdx)!;
        const row = document.createElement('div');
        row.className = 'row';
        const label = document.createElement('label');
        label.textContent = key.replace(/Cloth_/g, '');
        const slider = document.createElement('input');
        slider.type = 'range';
        slider.min = '0';
        slider.max = '1';
        slider.step = '0.05';
        slider.value = info.stiffness.toFixed(2);
        const val = document.createElement('span');
        val.className = 'val';
        val.textContent = info.stiffness.toFixed(2);
        slider.addEventListener('input', () => {
          const k = parseFloat(slider.value);
          for (const i of indices) sim.setLateralPairStiffness(i, k);
          val.textContent = k.toFixed(2);
        });
        row.appendChild(label);
        row.appendChild(val);
        const sliderRow = document.createElement('div');
        sliderRow.style.gridColumn = '1 / -1';
        sliderRow.appendChild(slider);
        pairsList.appendChild(row);
        pairsList.appendChild(sliderRow);
      }
    }
  }

  // Forward UI toggle/slider state to the active JiggleSim. Defined before
  // loadCharacter so the initial-load path can call it.
  const applyToggles = (): void => {
    const sim = debugChar.jiggleSim;
    if (!sim) return;
    sim.collidersEnabled = tColliders.checked;
    sim.platesEnabled = tPlates.checked;
    sim.lateralPairsEnabled = tLateral.checked;
    sim.stickyEnabled = tSticky.checked;
    sim.collisionDampingEnabled = tDamping.checked;
    sim.stickStrength = parseFloat(stickSlider.value);
    sim.contactSofteningEnabled = tContactSoft.checked;
    sim.contactSoftFactor = parseFloat(softFactorSlider.value);
    sim.contactSoftAttack = parseFloat(softAttackSlider.value);
    sim.contactSoftRelease = parseFloat(softReleaseSlider.value);
    // Pendulum toggle: lock all cloth bones to character YZ plane (axis 0 = X).
    sim.forceClothLockAxisIdx = tPendulum.checked ? 0 : -1;
  };

  function loadCharacter(id: string): void {
    const assets = assetsByChar.get(id);
    if (!assets) return;
    const wasDebug = jiggleDebug.enabled;
    if (wasDebug) jiggleDebug.setEnabled(false);
    debugChar.setCharacter(id, assets);
    repopulateAnims();
    debugChar.playAnim(animSelect.value, true);
    debugChar.setPaused(paused.checked);
    if (wasDebug) jiggleDebug.setEnabled(true);
    rebuildTuningUI();
    applyToggles();
    status.textContent = `${id} — ${animSelect.value}`;
  }

  loadCharacter(charSelect.value);

  charSelect.addEventListener('change', () => loadCharacter(charSelect.value));
  animSelect.addEventListener('change', () => {
    debugChar.playAnim(animSelect.value, true);
    status.textContent = `${charSelect.value} — ${animSelect.value}`;
  });
  showDebug.addEventListener('change', () => jiggleDebug.setEnabled(showDebug.checked));
  paused.addEventListener('change', () => debugChar.setPaused(paused.checked));
  speedSlider.addEventListener('input', () => {
    const r = parseFloat(speedSlider.value);
    debugChar.setSpeed(r);
    speedVal.textContent = `${r.toFixed(2)}×`;
  });

  // Wire toggle change events.
  for (const cb of [tColliders, tPlates, tLateral, tSticky, tDamping, tPendulum, tContactSoft]) {
    cb.addEventListener('change', applyToggles);
  }
  stickSlider.addEventListener('input', () => {
    stickVal.textContent = parseFloat(stickSlider.value).toFixed(2);
    applyToggles();
  });
  softFactorSlider.addEventListener('input', () => {
    softFactorVal.textContent = parseFloat(softFactorSlider.value).toFixed(2);
    applyToggles();
  });
  softAttackSlider.addEventListener('input', () => {
    softAttackVal.textContent = parseFloat(softAttackSlider.value).toFixed(2);
    applyToggles();
  });
  softReleaseSlider.addEventListener('input', () => {
    softReleaseVal.textContent = parseFloat(softReleaseSlider.value).toFixed(2);
    applyToggles();
  });

  // Live stats readout — updates every frame.
  scene.onBeforeRenderObservable.add(() => {
    const sim = debugChar.jiggleSim;
    if (!sim) return;
    const s = sim.diagStats;
    liveStats.textContent =
      `bones in contact: ${s.bonesInContact}\n` +
      `max speed:   ${(s.maxSpeed * 1000).toFixed(2)} mm/frame\n` +
      `avg speed:   ${(s.avgSpeed * 1000).toFixed(2)} mm/frame\n` +
      `worst bone:  ${s.worstBone || '—'}\n` +
      `worst speed: ${(s.worstBoneSpeed * 1000).toFixed(2)} mm/frame`;
  });

  copyConfig.addEventListener('click', () => {
    const sim = debugChar.jiggleSim;
    if (!sim) return;
    const lines: string[] = [];
    lines.push(`// === Tuned values for "${charSelect.value}" — paste into characters.ts ===`);
    if (sim.colliderCount > 0) {
      lines.push('jiggleColliders: [');
      for (let i = 0; i < sim.colliderCount; i++) {
        const info = sim.getColliderInfo(i);
        if (!info) continue;
        if (info.toBoneName) {
          lines.push(
            `  { bone: '${info.boneName}', toBone: '${info.toBoneName}', radius: ${info.radius.toFixed(3)} },`,
          );
        } else {
          lines.push(`  { bone: '${info.boneName}', radius: ${info.radius.toFixed(3)} },`);
        }
      }
      lines.push('],');
    }
    if (sim.lateralPairCount > 0) {
      // Re-group like rebuildTuningUI does so we emit chain-pair entries.
      const groups = new Map<string, number>();
      for (let i = 0; i < sim.lateralPairCount; i++) {
        const info = sim.getLateralPairInfo(i);
        if (!info) continue;
        const aChain = info.aBoneName.replace(/_\d+$/, '');
        const bChain = info.bBoneName.replace(/_\d+$/, '');
        const key = `${aChain}|${bChain}`;
        if (!groups.has(key)) groups.set(key, i);
      }
      lines.push('jiggleLateralPairs: [');
      for (const [key, firstIdx] of groups) {
        const [a, b] = key.split('|') as [string, string];
        const info = sim.getLateralPairInfo(firstIdx)!;
        // Count how many bones share this chain-pair (= chain length).
        let count = 0;
        for (let i = 0; i < sim.lateralPairCount; i++) {
          const inf = sim.getLateralPairInfo(i);
          if (!inf) continue;
          if (inf.aBoneName.replace(/_\d+$/, '') === a && inf.bBoneName.replace(/_\d+$/, '') === b)
            count++;
        }
        lines.push(
          `  { chainA: '${a}', chainB: '${b}', count: ${count}, stiffness: ${info.stiffness.toFixed(2)} },`,
        );
      }
      lines.push('],');
    }
    const text = lines.join('\n');
    navigator.clipboard.writeText(text).then(
      () => {
        status.textContent = `copied tuned values for ${charSelect.value}`;
      },
      () => {
        console.log(text);
        status.textContent = 'copy failed — see console';
      },
    );
  });

  scene.onBeforeRenderObservable.add(() => jiggleDebug.update());

  engine.runRenderLoop(() => scene.render());
  window.addEventListener('resize', () => engine.resize());
}

main().catch((err) => {
  const status = document.getElementById('status');
  if (status) status.textContent = `ERROR: ${err.message ?? err}`;
  console.error(err);
});
