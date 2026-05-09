// Arena placement debug — shows two fighters at real spawn positions (x=±3)
// plus a live-editable arena GLB. Adjust position/scale/rotation/bounds/camera
// settings, then copy the config snippet into src/arenas/index.ts.

import {
  type AbstractMesh,
  type AnimationGroup,
  ArcRotateCamera,
  Color3,
  Color4,
  DirectionalLight,
  Engine,
  HemisphericLight,
  type LinesMesh,
  MeshBuilder,
  Quaternion,
  Scene,
  SceneLoader,
  type Skeleton,
  StandardMaterial,
  TransformNode,
  Vector3,
} from '@babylonjs/core';
import { type ArenaBounds, ARENA_ORDER, ARENAS } from './arenas';
import { CHARACTERS } from './fighter/characters';
import {
  buildBoneMap,
  cloneAndPrepareSkeleton,
  remapAnimationTarget,
} from './fighter/cloneBindings';
import type { SharedAssets } from './fighter/Fighter';
import { Fighter as FighterClass } from './fighter/Fighter';

// ─── Blender-style drag number field ─────────────────────────────────────────
// Drag left/right on the value span to change it.
// Hold Shift for fine adjustment. Double-click to type a value directly.

class DragNumber {
  private _value: number;
  private dragging = false;
  private dragStartX = 0;
  private dragStartVal = 0;
  onChange: () => void = () => {};

  constructor(
    private readonly el: HTMLElement,
    init: number,
    /** Units per pixel in normal drag mode. */
    private readonly normalSpeed: number,
    /** Units per pixel when Shift is held. */
    private readonly fineSpeed: number,
    private readonly decimals: number,
    private readonly min = -Infinity,
    private readonly max = Infinity,
  ) {
    this._value = init;
    this._refresh();
    this._bind();
  }

  get(): number {
    return this._value;
  }

  set(v: number): void {
    this._value = Math.max(this.min, Math.min(this.max, v));
    this._refresh();
  }

  private _refresh(): void {
    this.el.textContent = this._value.toFixed(this.decimals);
  }

  private _bind(): void {
    const el = this.el;

    const onMove = (e: MouseEvent) => {
      if (!this.dragging) return;
      const dx = e.clientX - this.dragStartX;
      const speed = e.shiftKey ? this.fineSpeed : this.normalSpeed;
      this._value = Math.max(this.min, Math.min(this.max, this.dragStartVal + dx * speed));
      this._refresh();
      this.onChange();
    };

    const onUp = () => {
      if (!this.dragging) return;
      this.dragging = false;
      el.classList.remove('dragging');
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };

    el.addEventListener('mousedown', (e) => {
      if (e.button !== 0) return;
      e.preventDefault();
      this.dragging = true;
      this.dragStartX = e.clientX;
      this.dragStartVal = this._value;
      el.classList.add('dragging');
      window.addEventListener('mousemove', onMove);
      window.addEventListener('mouseup', onUp);
    });

    el.addEventListener('dblclick', () => this._showInput());
  }

  private _showInput(): void {
    const inp = document.createElement('input');
    inp.type = 'text';
    inp.value = this._value.toFixed(this.decimals);
    const rect = this.el.getBoundingClientRect();
    Object.assign(inp.style, {
      position: 'fixed',
      left: `${rect.left}px`,
      top: `${rect.top - 1}px`,
      width: `${Math.max(rect.width + 8, 72)}px`,
      fontSize: '10px',
      fontFamily: 'monospace',
      background: '#111',
      color: '#8cf',
      border: '1px solid #5af',
      padding: '2px 4px',
      zIndex: '9999',
      boxSizing: 'border-box',
      borderRadius: '2px',
      outline: 'none',
    });
    document.body.appendChild(inp);
    inp.focus();
    inp.select();

    const commit = () => {
      const v = parseFloat(inp.value);
      if (!isNaN(v)) this.set(v);
      this.onChange();
      inp.remove();
    };
    inp.addEventListener('keydown', (ev) => {
      if (ev.key === 'Enter') { ev.preventDefault(); commit(); }
      else if (ev.key === 'Escape') inp.remove();
      ev.stopPropagation();
    });
    inp.addEventListener('blur', commit);
  }
}

// ─────────────────────────────────────────────────────────────────────────────

class PlacementFighter {
  private rootNode: TransformNode;
  private skeleton: Skeleton | null = null;
  private animGroup: AnimationGroup | null = null;
  readonly meshes: AbstractMesh[] = [];

  constructor(scene: Scene, assets: SharedAssets, posX: number, facingAngle: number) {
    this.rootNode = new TransformNode('pf_root', scene);
    this.rootNode.position.set(posX, 0, 0);
    this.rootNode.rotationQuaternion = Quaternion.RotationAxis(Vector3.Up(), facingAngle);
    this.rootNode.scaling.setAll(assets.scale ?? 1.0);

    const cloned = cloneAndPrepareSkeleton(assets.baseSkeleton, 'pf_skel', 'pf');
    this.skeleton = cloned ?? null;
    const boneByName = buildBoneMap(cloned);

    for (const base of assets.baseMeshes) {
      const m = base.clone(`pf_${base.name}`, this.rootNode);
      if (!m) continue;
      m.setEnabled(true);
      if (cloned && m.skeleton) m.skeleton = cloned;
      this.meshes.push(m);
    }

    const idleKey = Object.keys(assets.animGroups).find((k) =>
      k.toLowerCase().includes('idle'),
    );
    const srcAg = idleKey ? assets.animGroups[idleKey] : Object.values(assets.animGroups)[0];
    if (srcAg) {
      this.animGroup = srcAg.clone('pf_anim', (t) => remapAnimationTarget(t, boneByName));
      this.animGroup.play(true);
    }
  }

  dispose(): void {
    this.animGroup?.stop();
    this.animGroup?.dispose();
    this.animGroup = null;
    this.skeleton?.dispose();
    this.skeleton = null;
    for (const m of this.meshes) m.dispose();
    this.meshes.length = 0;
    this.rootNode.dispose();
  }
}

const GAME_CAM_TARGET = new Vector3(0, 1.5, 0);
const GAME_CAM_ALPHA = -Math.PI / 2;
const GAME_CAM_BETA = 1.1;
const GAME_CAM_RADIUS = 10;
const BOUNDS_Y = 0.04;

function buildCirclePoints(radius: number, segments = 72): Vector3[] {
  const pts: Vector3[] = [];
  for (let i = 0; i <= segments; i++) {
    const a = (i / segments) * Math.PI * 2;
    pts.push(new Vector3(Math.cos(a) * radius, BOUNDS_Y, Math.sin(a) * radius));
  }
  return pts;
}

function buildRectPoints(hw: number, hd: number): Vector3[] {
  return [
    new Vector3(-hw, BOUNDS_Y, -hd),
    new Vector3(hw, BOUNDS_Y, -hd),
    new Vector3(hw, BOUNDS_Y, hd),
    new Vector3(-hw, BOUNDS_Y, hd),
    new Vector3(-hw, BOUNDS_Y, -hd),
  ];
}

function wrapAngle(a: number): number {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
}

async function main(): Promise<void> {
  const canvas = document.getElementById('canvas') as HTMLCanvasElement;
  const status = document.getElementById('status') as HTMLDivElement;
  const arenaSelect = document.getElementById('arena-select') as HTMLSelectElement;

  // ── Drag number fields ──────────────────────────────────────────────────────
  // Speed: units/px for normal drag, units/px for Shift+drag.
  const pxDN = new DragNumber(document.getElementById('px-val') as HTMLElement, 0, 0.1, 0.005, 2);
  const pyDN = new DragNumber(document.getElementById('py-val') as HTMLElement, 0, 0.1, 0.005, 2);
  const pzDN = new DragNumber(document.getElementById('pz-val') as HTMLElement, 0, 0.1, 0.005, 2);
  const scDN = new DragNumber(document.getElementById('sc-val') as HTMLElement, 1, 0.03, 0.001, 3, 0.001);
  const ryDN = new DragNumber(document.getElementById('ry-val') as HTMLElement, 0, 0.015, 0.001, 3);
  const brDN = new DragNumber(document.getElementById('br-val') as HTMLElement, 8, 0.15, 0.01, 2, 0.5);
  const bhwDN = new DragNumber(document.getElementById('bhw-val') as HTMLElement, 6, 0.15, 0.01, 2, 0.5);
  const bhdDN = new DragNumber(document.getElementById('bhd-val') as HTMLElement, 4, 0.15, 0.01, 2, 0.5);

  const boundsTypeSelect = document.getElementById('bounds-type') as HTMLSelectElement;
  const boundsCircleSection = document.getElementById('bounds-circle-section') as HTMLDivElement;
  const boundsRectSection = document.getElementById('bounds-rect-section') as HTMLDivElement;

  const linearCb = document.getElementById('linear') as HTMLInputElement;
  const copyBtn = document.getElementById('copy-btn') as HTMLButtonElement;
  const output = document.getElementById('output') as HTMLDivElement;
  const resetCam = document.getElementById('reset-cam') as HTMLButtonElement;
  const rotate180Btn = document.getElementById('rotate180') as HTMLButtonElement;

  const engine = new Engine(canvas, true, { stencil: true });
  const scene = new Scene(engine);
  scene.clearColor = new Color4(0.1, 0.11, 0.13, 1);

  const hemi = new HemisphericLight('hemi', new Vector3(0, 1, 0), scene);
  hemi.intensity = 0.35;
  hemi.diffuse = new Color3(0.8, 0.85, 1.0);
  hemi.groundColor = new Color3(0.15, 0.18, 0.08);
  hemi.specular = Color3.Black();
  const sun = new DirectionalLight('sun', new Vector3(-0.6, -1.0, -0.5).normalize(), scene);
  sun.diffuse = new Color3(1.0, 0.96, 0.88);
  sun.intensity = 1.6;
  sun.position = new Vector3(8, 18, 10);

  const floorSolid = MeshBuilder.CreateGround('floorSolid', { width: 60, height: 60 }, scene);
  const floorSolidMat = new StandardMaterial('floorSolidMat', scene);
  floorSolidMat.diffuseColor = new Color3(0.1, 0.12, 0.1);
  floorSolidMat.alpha = 0.6;
  floorSolid.material = floorSolidMat;
  floorSolid.position.y = -0.001;

  const floorGrid = MeshBuilder.CreateGround(
    'floorGrid',
    { width: 60, height: 60, subdivisions: 30 },
    scene,
  );
  const floorGridMat = new StandardMaterial('floorGridMat', scene);
  floorGridMat.wireframe = true;
  floorGridMat.emissiveColor = new Color3(0.1, 0.15, 0.1);
  floorGridMat.disableLighting = true;
  floorGrid.material = floorGridMat;

  const fightLine = MeshBuilder.CreateGround('fightLine', { width: 8, height: 0.04 }, scene);
  const fightLineMat = new StandardMaterial('fightLineMat', scene);
  fightLineMat.emissiveColor = new Color3(0.2, 0.45, 0.9);
  fightLineMat.disableLighting = true;
  fightLine.material = fightLineMat;
  fightLine.position.set(0, 0.002, 0);

  const camera = new ArcRotateCamera(
    'cam', GAME_CAM_ALPHA, GAME_CAM_BETA, GAME_CAM_RADIUS, GAME_CAM_TARGET.clone(), scene,
  );
  camera.attachControl(canvas, true);
  camera.minZ = 0.05;
  camera.maxZ = 300;
  camera.wheelPrecision = 20;
  camera.panningSensibility = 80;
  camera.lowerRadiusLimit = 2;
  camera.upperRadiusLimit = 80;

  function snapCamera(): void {
    camera.alpha = GAME_CAM_ALPHA;
    camera.beta = GAME_CAM_BETA;
    camera.radius = GAME_CAM_RADIUS;
    camera.target.copyFrom(GAME_CAM_TARGET);
  }
  resetCam.addEventListener('click', snapCamera);

  let boundsViz: LinesMesh | null = null;
  const BOUNDS_COLOR = new Color3(1, 0.8, 0.1);

  function rebuildBoundsViz(): void {
    boundsViz?.dispose();
    boundsViz = null;
    const type = boundsTypeSelect.value as 'circle' | 'rect';
    if (type === 'circle') {
      boundsViz = MeshBuilder.CreateLines(
        'boundsViz', { points: buildCirclePoints(brDN.get()) }, scene,
      );
    } else {
      boundsViz = MeshBuilder.CreateLines(
        'boundsViz',
        { points: buildRectPoints(bhwDN.get(), bhdDN.get()) },
        scene,
      );
    }
    boundsViz.color = BOUNDS_COLOR;
    boundsViz.isPickable = false;
  }

  // Load fighters
  const charIds = Object.keys(CHARACTERS);
  const p1Id = charIds[0] ?? 'beano';
  const p2Id = charIds[1] ?? p1Id;
  status.textContent = `loading ${p1Id}…`;
  const p1Assets = await FighterClass.loadAssets(scene, p1Id);
  const p1Meta = CHARACTERS[p1Id]!;
  p1Assets.scale = p1Meta.scale;
  p1Assets.jiggle = p1Meta.jiggle;

  let p2Assets: SharedAssets;
  if (p2Id !== p1Id) {
    status.textContent = `loading ${p2Id}…`;
    p2Assets = await FighterClass.loadAssets(scene, p2Id);
    const p2Meta = CHARACTERS[p2Id]!;
    p2Assets.scale = p2Meta.scale;
    p2Assets.jiggle = p2Meta.jiggle;
  } else {
    p2Assets = p1Assets;
  }

  const f1 = new PlacementFighter(scene, p1Assets, -3, 0);
  const f2 = new PlacementFighter(scene, p2Assets, 3, Math.PI);
  status.textContent = 'fighters loaded — select an arena';

  let arenaRoot: TransformNode | null = null;

  async function loadArena(id: string): Promise<void> {
    if (arenaRoot) {
      const prev = arenaRoot;
      const toDispose = scene.meshes.filter((m) => {
        let p: unknown = m.parent;
        while (p) {
          if (p === prev) return true;
          p = (p as { parent: unknown }).parent;
        }
        return false;
      });
      for (const n of toDispose.map((m) => m.name)) scene.getMeshByName(n)?.dispose();
      prev.dispose();
      arenaRoot = null;
    }

    const cfg = ARENAS[id];
    if (!cfg?.scenery.glb) {
      status.textContent = `"${id}" has no GLB scenery`;
      return;
    }

    status.textContent = `loading ${cfg.scenery.glb}…`;
    const glb = cfg.scenery.glb;
    const lastSlash = glb.lastIndexOf('/');
    const dir = lastSlash >= 0 ? glb.substring(0, lastSlash + 1) : '';
    const file = lastSlash >= 0 ? glb.substring(lastSlash + 1) : glb;

    try {
      const result = await SceneLoader.ImportMeshAsync(null, '/' + dir, file, scene);
      arenaRoot = new TransformNode(`arenaRoot_${id}`, scene);
      applyTransform();
      for (const m of result.meshes) {
        if (m.parent === null) m.parent = arenaRoot;
        m.receiveShadows = true;
      }
      status.textContent = `${cfg.name} loaded`;
    } catch (err) {
      console.error(err);
      status.textContent = `failed to load ${glb}`;
    }
  }

  function applyTransform(): void {
    if (!arenaRoot) return;
    arenaRoot.position.set(pxDN.get(), pyDN.get(), pzDN.get());
    arenaRoot.scaling.setAll(scDN.get());
    arenaRoot.rotation.set(0, ryDN.get(), 0);
  }

  function seedFromArena(id: string): void {
    const cfg = ARENAS[id];
    if (!cfg) return;
    const s = cfg.scenery;
    pxDN.set(s.position?.x ?? 0);
    pyDN.set(s.position?.y ?? 0);
    pzDN.set(s.position?.z ?? 0);
    scDN.set(s.scale ?? 1);
    ryDN.set(s.rotationY ?? 0);
    linearCb.checked = !!cfg.linear;

    const b = cfg.bounds;
    if (!b || b.kind === 'circle') {
      boundsTypeSelect.value = 'circle';
      brDN.set(b?.kind === 'circle' ? b.radius : 12);
      boundsCircleSection.style.display = '';
      boundsRectSection.style.display = 'none';
    } else {
      boundsTypeSelect.value = 'rect';
      bhwDN.set(b.halfWidth);
      bhdDN.set(b.halfDepth);
      boundsCircleSection.style.display = 'none';
      boundsRectSection.style.display = '';
    }

    rebuildBoundsViz();
    snapCamera();
  }

  // Wire transform drag numbers
  for (const dn of [pxDN, pyDN, pzDN, scDN, ryDN]) {
    dn.onChange = applyTransform;
  }

  // Wire bounds drag numbers
  for (const dn of [brDN, bhwDN, bhdDN]) {
    dn.onChange = rebuildBoundsViz;
  }

  // Populate dropdown
  for (const id of ARENA_ORDER) {
    const cfg = ARENAS[id];
    if (!cfg?.scenery.glb) continue;
    const opt = document.createElement('option');
    opt.value = id;
    opt.textContent = cfg.name;
    arenaSelect.appendChild(opt);
  }

  const firstId = ARENA_ORDER.find((id) => ARENAS[id]?.scenery.glb) ?? '';
  if (firstId) {
    arenaSelect.value = firstId;
    seedFromArena(firstId);
    void loadArena(firstId);
  }

  arenaSelect.addEventListener('change', () => {
    seedFromArena(arenaSelect.value);
    void loadArena(arenaSelect.value);
  });

  rotate180Btn.addEventListener('click', () => {
    ryDN.set(wrapAngle(ryDN.get() + Math.PI));
    applyTransform();
  });

  boundsTypeSelect.addEventListener('change', () => {
    const isCircle = boundsTypeSelect.value === 'circle';
    boundsCircleSection.style.display = isCircle ? '' : 'none';
    boundsRectSection.style.display = isCircle ? 'none' : '';
    rebuildBoundsViz();
  });

  copyBtn.addEventListener('click', () => {
    const id = arenaSelect.value;
    const cfg = ARENAS[id];
    if (!cfg?.scenery.glb) return;

    const px = pxDN.get();
    const py = pyDN.get();
    const pz = pzDN.get();
    const sc = scDN.get();
    const ry = ryDN.get();
    const linear = linearCb.checked;
    const boundsType = boundsTypeSelect.value as 'circle' | 'rect';
    const br = brDN.get();
    const bhw = bhwDN.get();
    const bhd = bhdDN.get();

    const hasPos = px !== 0 || py !== 0 || pz !== 0;
    const hasRot = Math.abs(ry) > 0.001;
    const f3 = (n: number) => n.toFixed(3);
    const f2 = (n: number) => n.toFixed(2);

    const lines: string[] = [
      `  // Paste into the "${id}" entry in src/arenas/index.ts`,
      `  scenery: {`,
      `    glb: '${cfg.scenery.glb}',`,
      `    scale: ${f3(sc)},`,
    ];
    if (hasPos) lines.push(`    position: { x: ${f2(px)}, y: ${f2(py)}, z: ${f2(pz)} },`);
    if (hasRot) lines.push(`    rotationY: ${f3(ry)},`);
    lines.push(`  },`);
    if (linear) lines.push(`  linear: true,`);
    if (boundsType === 'circle') {
      lines.push(`  bounds: { kind: 'circle', radius: ${f2(br)} },`);
    } else {
      lines.push(`  bounds: { kind: 'rect', halfWidth: ${f2(bhw)}, halfDepth: ${f2(bhd)} },`);
    }

    const text = lines.join('\n');
    output.textContent = text;
    output.style.display = 'block';

    navigator.clipboard.writeText(text).then(
      () => { status.textContent = 'copied — paste into src/arenas/index.ts'; },
      () => { status.textContent = 'copy failed — see output box below'; },
    );
  });

  engine.runRenderLoop(() => scene.render());
  window.addEventListener('resize', () => engine.resize());

  window.addEventListener('beforeunload', () => {
    f1.dispose();
    f2.dispose();
  });
}

main().catch((err) => {
  const s = document.getElementById('status');
  if (s) s.textContent = `ERROR: ${(err as Error).message ?? err}`;
  console.error(err);
});
