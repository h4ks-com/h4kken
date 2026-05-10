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
  Effect,
  Engine,
  HemisphericLight,
  type LinesMesh,
  type Mesh,
  MeshBuilder,
  PointLight,
  Quaternion,
  Scene,
  SceneLoader,
  ShaderMaterial,
  type Skeleton,
  StandardMaterial,
  TransformNode,
  Vector3,
} from '@babylonjs/core';
import { ARENA_ORDER, ARENAS } from './arenas';
import { DragNumber } from './DragNumber';
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

    const idleKey = Object.keys(assets.animGroups).find((k) => k.toLowerCase().includes('idle'));
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

function buildDebugSky(
  scene: Scene,
  colors?: { top: Color3; horiz: Color3; bottom: Color3 },
): Mesh {
  if (!Effect.ShadersStore.skyVertexShader) {
    Effect.ShadersStore.skyVertexShader = `
      precision highp float;
      attribute vec3 position;
      uniform mat4 worldViewProjection;
      varying vec3 vWorldPosition;
      void main() {
        vWorldPosition = position;
        gl_Position = worldViewProjection * vec4(position, 1.0);
      }
    `;
    Effect.ShadersStore.skyFragmentShader = `
      precision highp float;
      uniform vec3 topColor;
      uniform vec3 horizColor;
      uniform vec3 bottomColor;
      varying vec3 vWorldPosition;
      void main() {
        float h = normalize(vWorldPosition).y;
        vec3 color;
        if (h > 0.0) {
          color = mix(horizColor, topColor, pow(h, 0.5));
        } else {
          color = mix(horizColor, bottomColor, pow(-h, 0.4));
        }
        gl_FragColor = vec4(color, 1.0);
      }
    `;
  }
  const sky = MeshBuilder.CreateSphere('debugSky', { diameter: 180, segments: 16 }, scene);
  const skyMat = new ShaderMaterial(
    'debugSkyMat',
    scene,
    { vertex: 'sky', fragment: 'sky' },
    {
      attributes: ['position'],
      uniforms: ['worldViewProjection', 'topColor', 'horizColor', 'bottomColor'],
    },
  );
  skyMat.setColor3('topColor', colors?.top ?? new Color3(0.2, 0.533, 0.8));
  skyMat.setColor3('horizColor', colors?.horiz ?? new Color3(0.6, 0.8, 0.933));
  skyMat.setColor3('bottomColor', colors?.bottom ?? new Color3(0.533, 0.667, 0.467));
  skyMat.backFaceCulling = false;
  sky.material = skyMat;
  sky.applyFog = false;
  return sky;
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

function _wrapAngle(a: number): number {
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
  const scDN = new DragNumber(
    document.getElementById('sc-val') as HTMLElement,
    1,
    0.03,
    0.001,
    3,
    0.001,
  );
  const rxDN = new DragNumber(document.getElementById('rx-val') as HTMLElement, 0, 1, 0.1, 1);
  const ryDN = new DragNumber(document.getElementById('ry-val') as HTMLElement, 0, 1, 0.1, 1);
  const rzDN = new DragNumber(document.getElementById('rz-val') as HTMLElement, 0, 1, 0.1, 1);
  const brDN = new DragNumber(
    document.getElementById('br-val') as HTMLElement,
    8,
    0.15,
    0.01,
    2,
    0.5,
  );
  const bhwDN = new DragNumber(
    document.getElementById('bhw-val') as HTMLElement,
    6,
    0.15,
    0.01,
    2,
    0.5,
  );
  const bhdDN = new DragNumber(
    document.getElementById('bhd-val') as HTMLElement,
    4,
    0.15,
    0.01,
    2,
    0.5,
  );

  const boundsTypeSelect = document.getElementById('bounds-type') as HTMLSelectElement;
  const boundsCircleSection = document.getElementById('bounds-circle-section') as HTMLDivElement;
  const boundsRectSection = document.getElementById('bounds-rect-section') as HTMLDivElement;

  const linearCb = document.getElementById('linear') as HTMLInputElement;
  const copyBtn = document.getElementById('copy-btn') as HTMLButtonElement;
  const output = document.getElementById('output') as HTMLDivElement;
  const resetCam = document.getElementById('reset-cam') as HTMLButtonElement;

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
    'cam',
    GAME_CAM_ALPHA,
    GAME_CAM_BETA,
    GAME_CAM_RADIUS,
    GAME_CAM_TARGET.clone(),
    scene,
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
        'boundsViz',
        { points: buildCirclePoints(brDN.get()) },
        scene,
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
  const p1Meta = CHARACTERS[p1Id] as (typeof CHARACTERS)[string];
  p1Assets.scale = p1Meta.scale;
  p1Assets.jiggle = p1Meta.jiggle;

  let p2Assets: SharedAssets;
  if (p2Id !== p1Id) {
    status.textContent = `loading ${p2Id}…`;
    p2Assets = await FighterClass.loadAssets(scene, p2Id);
    const p2Meta = CHARACTERS[p2Id] as (typeof CHARACTERS)[string];
    p2Assets.scale = p2Meta.scale;
    p2Assets.jiggle = p2Meta.jiggle;
  } else {
    p2Assets = p1Assets;
  }

  const f1 = new PlacementFighter(scene, p1Assets, -3, 0);
  const f2 = new PlacementFighter(scene, p2Assets, 3, Math.PI);
  status.textContent = 'fighters loaded — select an arena';

  let arenaRoot: TransformNode | null = null;
  let debugSkyMesh: Mesh | null = null;
  let debugLightMeshes: Mesh[] = [];
  let debugPointLights: PointLight[] = [];

  const DEFAULT_CLEAR = new Color4(0.1, 0.11, 0.13, 1);

  function clearArenaExtras(): void {
    debugSkyMesh?.dispose();
    debugSkyMesh = null;
    for (const m of debugLightMeshes) m.dispose();
    debugLightMeshes = [];
    for (const l of debugPointLights) l.dispose();
    debugPointLights = [];
    scene.clearColor = DEFAULT_CLEAR.clone();
  }

  // biome-ignore lint/complexity/noExcessiveCognitiveComplexity: debug arena loader
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
    clearArenaExtras();

    const cfg = ARENAS[id];
    if (!cfg?.scenery.glb) {
      status.textContent = `"${id}" has no scenery`;
      return;
    }

    // Apply arena-level scene settings
    if (cfg.clearColor) {
      scene.clearColor = cfg.clearColor.toColor4(1);
    }
    if (cfg.showSky) {
      debugSkyMesh = buildDebugSky(scene, cfg.skyColors);
    }

    arenaRoot = new TransformNode(`arenaRoot_${id}`, scene);
    applyTransform();

    status.textContent = `loading ${cfg.scenery.glb}…`;
    const glb = cfg.scenery.glb;
    const lastSlash = glb.lastIndexOf('/');
    const dir = lastSlash >= 0 ? glb.substring(0, lastSlash + 1) : '';
    const file = lastSlash >= 0 ? glb.substring(lastSlash + 1) : glb;
    try {
      const result = await SceneLoader.ImportMeshAsync(null, `/${dir}`, file, scene);
      for (const m of result.meshes) {
        if (m.parent === null) m.parent = arenaRoot;
        m.receiveShadows = true;
      }

      // Indoor lights: add PointLights + yellow marker spheres
      const lights = cfg.indoorLights;
      if (lights) {
        for (let i = 0; i < lights.length; i++) {
          const l = lights[i] as (typeof lights)[number];
          const pos = new Vector3(l.position.x, l.position.y, l.position.z);

          const pl = new PointLight(`dbgLight_${i}`, pos, scene);
          pl.intensity = l.intensity;
          pl.range = l.range;
          if (l.color) {
            pl.diffuse = l.color;
            pl.specular = l.color;
          }
          debugPointLights.push(pl);

          const marker = MeshBuilder.CreateSphere(`dbgLightMarker_${i}`, { diameter: 0.3 }, scene);
          marker.position.copyFrom(pos);
          const mat = new StandardMaterial(`dbgLightMarkerMat_${i}`, scene);
          mat.emissiveColor = l.color ?? new Color3(1, 1, 0.4);
          mat.disableLighting = true;
          marker.material = mat;
          debugLightMeshes.push(marker);
        }
      }

      status.textContent = `${cfg.name} loaded`;
    } catch (err) {
      console.error(err);
      status.textContent = `failed to load ${glb}`;
    }
  }

  const DEG = Math.PI / 180;

  function applyTransform(): void {
    if (!arenaRoot) return;
    arenaRoot.position.set(pxDN.get(), pyDN.get(), pzDN.get());
    arenaRoot.scaling.setAll(scDN.get());
    // XYZ extrinsic (each slider = independent world axis, no gimbal lock)
    arenaRoot.rotationQuaternion = Quaternion.RotationAxis(new Vector3(0, 0, 1), rzDN.get() * DEG)
      .multiply(Quaternion.RotationAxis(new Vector3(0, 1, 0), ryDN.get() * DEG))
      .multiply(Quaternion.RotationAxis(new Vector3(1, 0, 0), rxDN.get() * DEG));
  }

  function updateSnapHighlights(): void {
    const dnMap: Record<string, DragNumber> = { rx: rxDN, ry: ryDN, rz: rzDN };
    document.querySelectorAll<HTMLButtonElement>('.snap-btn').forEach((btn) => {
      const dn = dnMap[btn.dataset.dn ?? ''];
      const deg = parseFloat(btn.dataset.deg ?? '0');
      btn.classList.toggle('active', dn ? Math.abs(dn.get() - deg) < 0.5 : false);
    });
  }

  function seedFromArena(id: string): void {
    const cfg = ARENAS[id];
    if (!cfg) return;
    const s = cfg.scenery;
    pxDN.set(s.position?.x ?? 0);
    pyDN.set(s.position?.y ?? 0);
    pzDN.set(s.position?.z ?? 0);
    scDN.set(s.scale ?? 1);
    rxDN.set((s.rotationX ?? 0) / DEG);
    ryDN.set((s.rotationY ?? 0) / DEG);
    rzDN.set((s.rotationZ ?? 0) / DEG);
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
    updateSnapHighlights();
    snapCamera();
  }

  // Wire transform drag numbers
  for (const dn of [pxDN, pyDN, pzDN, scDN, rxDN, ryDN, rzDN]) {
    dn.onChange = () => {
      applyTransform();
      updateSnapHighlights();
    };
  }

  // Snap buttons
  const snapDnMap: Record<string, DragNumber> = { rx: rxDN, ry: ryDN, rz: rzDN };
  document.querySelectorAll<HTMLButtonElement>('.snap-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const dn = snapDnMap[btn.dataset.dn ?? ''];
      if (!dn) return;
      dn.set(parseFloat(btn.dataset.deg ?? '0'));
      applyTransform();
      updateSnapHighlights();
    });
  });

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
    const rxRad = rxDN.get() * DEG;
    const ryRad = ryDN.get() * DEG;
    const rzRad = rzDN.get() * DEG;
    const linear = linearCb.checked;
    const boundsType = boundsTypeSelect.value as 'circle' | 'rect';
    const br = brDN.get();
    const bhw = bhwDN.get();
    const bhd = bhdDN.get();

    const hasPos = px !== 0 || py !== 0 || pz !== 0;
    const f3 = (n: number) => n.toFixed(3);
    const f2 = (n: number) => n.toFixed(2);

    const sceneryPath = `    glb: '${cfg.scenery.glb}',`;

    const lines: string[] = [
      `  // Paste into the "${id}" entry in src/arenas/index.ts`,
      `  scenery: {`,
      sceneryPath,
      `    scale: ${f3(sc)},`,
    ];
    if (hasPos) lines.push(`    position: { x: ${f2(px)}, y: ${f2(py)}, z: ${f2(pz)} },`);
    if (Math.abs(rxRad) > 0.001) lines.push(`    rotationX: ${f3(rxRad)},`);
    if (Math.abs(ryRad) > 0.001) lines.push(`    rotationY: ${f3(ryRad)},`);
    if (Math.abs(rzRad) > 0.001) lines.push(`    rotationZ: ${f3(rzRad)},`);
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
      () => {
        status.textContent = 'copied — paste into src/arenas/index.ts';
      },
      () => {
        status.textContent = 'copy failed — see output box below';
      },
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
