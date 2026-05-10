// ============================================================
// H4KKEN - Stage (Arena, Lighting, Environment) — Babylon.js
// ============================================================

import {
  Color3,
  DirectionalLight,
  Effect,
  HemisphericLight,
  MeshBuilder,
  PBRMaterial,
  PointLight,
  Quaternion,
  Scene,
  SceneLoader,
  ShaderMaterial,
  ShadowGenerator,
  StandardMaterial,
  TransformNode,
  Vector3,
} from '@babylonjs/core';
import { type ArenaConfig, DEFAULT_ARENA_ID, getArenaConfig } from './arenas';
import { isTouchDevice } from './MobileControls';

export class Stage {
  scene: Scene;
  flameLights: PointLight[];
  time: number;
  arena: ArenaConfig;

  constructor(scene: Scene, arenaId: string = DEFAULT_ARENA_ID) {
    this.scene = scene;
    this.flameLights = [];
    this.time = 0;
    this.arena = getArenaConfig(arenaId);
    this.build();
  }

  build() {
    this.setupLighting();
    this.buildArena();
    if (this.arena.showDefaultBackdrop) {
      this.createBackdrop();
    }
    if (this.arena.showSky) {
      this.buildSky();
    }
    if (this.arena.scenery.glb) {
      void this.loadArenaGlb();
    }

    if (this.arena.clearColor) {
      // Re-enable per-frame clear when there's no full-screen sky dome to
      // overwrite the framebuffer; otherwise garbage pixels accumulate.
      this.scene.autoClear = true;
      this.scene.autoClearDepthAndStencil = true;
      this.scene.clearColor = this.arena.clearColor.toColor4(1);
    }

    this.scene.fogMode = Scene.FOGMODE_LINEAR;
    const fog = this.arena.fog;
    if (fog) {
      this.scene.fogColor = fog.color;
      this.scene.fogStart = fog.start;
      this.scene.fogEnd = fog.end;
    } else {
      this.scene.fogColor = new Color3(0.6, 0.8, 0.933);
      this.scene.fogStart = 40;
      this.scene.fogEnd = 90;
    }

    for (let i = 0; i < (this.arena.indoorLights?.length ?? 0); i++) {
      const l = this.arena.indoorLights![i]!;
      const light = new PointLight(
        `indoorLight_${i}`,
        new Vector3(l.position.x, l.position.y, l.position.z),
        this.scene,
      );
      light.intensity = l.intensity;
      light.range = l.range;
      if (l.color) {
        light.diffuse = l.color;
        light.specular = l.color;
      }
    }

    this._freezeStatics();
  }

  private _freezeStatics(): void {
    // All stage meshes are constructed before any Fighter is added to the scene,
    // so everything in the scene at this point is a static stage mesh. Freeze
    // their world matrices and materials to eliminate per-frame recalculation.
    for (const mesh of this.scene.meshes) {
      mesh.freezeWorldMatrix();
      mesh.doNotSyncBoundingInfo = true;
      // Prevent frustum cull checks — every stage mesh is always visible.
      mesh.alwaysSelectAsActiveMesh = true;
      if (mesh.material && !mesh.material.isFrozen) {
        mesh.material.freeze();
      }
    }
  }

  setupLighting() {
    // Low ambient so the directional light provides clear shading and shadow contrast
    const ambient = new HemisphericLight('ambient', new Vector3(0, 1, 0), this.scene);
    ambient.intensity = 0.25 * (this.arena.ambientBoost ?? 1.0);
    ambient.diffuse = new Color3(0.8, 0.85, 1.0);
    ambient.groundColor = new Color3(0.15, 0.18, 0.08);
    // No specular from hemisphere — prevents the plastic sheen
    ambient.specular = Color3.Black();

    const sunDir = this.arena.sunDirection ?? new Vector3(-0.6, -1.0, -0.5).normalize();
    const sun = new DirectionalLight('sun', sunDir, this.scene);
    sun.diffuse = new Color3(1.0, 0.96, 0.88);
    sun.intensity = 1.8 * (this.arena.sunBoost ?? 1.0);
    sun.position = new Vector3(8, 18, 10);

    // Mobile: 1024px shadow map + QUALITY_LOW (4× fewer texels, fewer PCF samples).
    // Desktop: 2048px + QUALITY_MEDIUM for smooth soft shadows.
    const mobile = isTouchDevice();
    const shadowMapSize = mobile ? 1024 : 2048;
    const shadowGen = new ShadowGenerator(shadowMapSize, sun);
    shadowGen.usePercentageCloserFiltering = true;
    shadowGen.filteringQuality = mobile
      ? ShadowGenerator.QUALITY_LOW
      : ShadowGenerator.QUALITY_MEDIUM;
    shadowGen.bias = 0.002;
    shadowGen.normalBias = 0.08;
    shadowGen.forceBackFacesOnly = true;

    this._shadowGen = shadowGen;
  }

  private _shadowGen: ShadowGenerator | null = null;

  get shadowGenerator(): ShadowGenerator | null {
    return this._shadowGen;
  }

  buildArena() {
    const arenaRadius = 14;

    if (this.arena.hideDefaultFloor) {
      // Skip cosmetic platform/ring/ground — the arena GLB supplies its own floor.
      // Pillars are controlled separately via showPillars.
      this._buildPillars(arenaRadius);
      return;
    }

    // Main platform
    const platform = MeshBuilder.CreateCylinder(
      'platform',
      {
        diameter: (arenaRadius + 0.3) * 2,
        diameterTop: arenaRadius * 2,
        height: 0.6,
        tessellation: 32,
      },
      this.scene,
    );
    platform.position.y = -0.3;
    platform.receiveShadows = true;
    const platMat = new PBRMaterial('platMat', this.scene);
    platMat.albedoColor = new Color3(0.784, 0.722, 0.604);
    platMat.roughness = 0.95;
    platMat.metallic = 0;
    platform.material = platMat;
    this._shadowGen?.addShadowCaster(platform);

    // Fight area disk
    const fightArea = MeshBuilder.CreateCylinder(
      'fightArea',
      { diameter: 20, height: 0.08, tessellation: 32 },
      this.scene,
    );
    fightArea.position.y = -0.039;
    fightArea.receiveShadows = true;
    const faMat = new PBRMaterial('faMat', this.scene);
    faMat.albedoColor = new Color3(0.545, 0.451, 0.333);
    faMat.roughness = 0.9;
    faMat.metallic = 0;
    fightArea.material = faMat;

    // Gold ring at edge of fight area
    const ring = MeshBuilder.CreateTorus(
      'ring',
      { diameter: 20, thickness: 0.16, tessellation: 32 },
      this.scene,
    );
    ring.position.y = 0.001;
    const ringMat = new StandardMaterial('ringMat', this.scene);
    ringMat.diffuseColor = new Color3(1, 0.843, 0);
    ringMat.emissiveColor = new Color3(0.267, 0.2, 0);
    ringMat.specularPower = 128;
    ring.material = ringMat;

    // Outer ring
    const outerRing = MeshBuilder.CreateTorus(
      'outerRing',
      { diameter: arenaRadius * 2, thickness: 0.24, tessellation: 32 },
      this.scene,
    );
    outerRing.position.y = -0.039;
    const outerRingMat = new StandardMaterial('outerRingMat', this.scene);
    outerRingMat.diffuseColor = new Color3(0.6, 0.467, 0.267);
    outerRing.material = outerRingMat;

    // Ground plane
    const ground = MeshBuilder.CreateGround('ground', { width: 200, height: 200 }, this.scene);
    ground.position.y = -0.6;
    ground.receiveShadows = true;
    const groundMat = new PBRMaterial('groundMat', this.scene);
    groundMat.albedoColor = new Color3(0.38, 0.52, 0.33);
    groundMat.roughness = 1.0;
    groundMat.metallic = 0;
    ground.material = groundMat;

    this._buildPillars(arenaRadius);
  }

  private _buildPillars(arenaRadius: number) {
    if (!this.arena.showPillars) {
      return;
    }

    const pillarAngles = [0, Math.PI / 2, Math.PI, Math.PI * 1.5];
    const pillarDist = arenaRadius + 1.5;

    pillarAngles.forEach((angle, i) => {
      const px = Math.cos(angle) * pillarDist;
      const pz = Math.sin(angle) * pillarDist;

      const base = MeshBuilder.CreateCylinder(
        `pillarBase${i}`,
        { diameterTop: 0.9, diameterBottom: 1.1, height: 0.8, tessellation: 6 },
        this.scene,
      );
      base.position.set(px, 0.0, pz);
      const baseMat = new StandardMaterial(`pillarBaseMat${i}`, this.scene);
      baseMat.diffuseColor = new Color3(0.533, 0.467, 0.4);
      baseMat.specularColor = Color3.Black();
      base.material = baseMat;

      const col = MeshBuilder.CreateCylinder(
        `pillarCol${i}`,
        { diameterTop: 0.6, diameterBottom: 0.7, height: 5, tessellation: 6 },
        this.scene,
      );
      col.position.set(px, 3, pz);
      const colMat = new StandardMaterial(`pillarColMat${i}`, this.scene);
      colMat.diffuseColor = new Color3(0.6, 0.533, 0.467);
      colMat.specularColor = Color3.Black();
      col.material = colMat;

      const cap = MeshBuilder.CreateCylinder(
        `pillarCap${i}`,
        { diameterTop: 1.0, diameterBottom: 0.7, height: 0.4, tessellation: 6 },
        this.scene,
      );
      cap.position.set(px, 5.7, pz);
      const capMat = new StandardMaterial(`pillarCapMat${i}`, this.scene);
      capMat.diffuseColor = new Color3(0.667, 0.6, 0.467);
      capMat.specularColor = Color3.Black();
      cap.material = capMat;

      const flameColor = i % 2 === 0 ? new Color3(1, 0.4, 0.133) : new Color3(1, 0.533, 0.267);
      const flame = new PointLight(`flame${i}`, new Vector3(px, 6.3, pz), this.scene);
      flame.diffuse = flameColor;
      flame.intensity = 1.2;
      flame.range = 18;
      this.flameLights.push(flame);
    });
  }

  createBackdrop() {
    const mountainDefs = [
      { x: -45, z: -55, h: 22, r: 14, c: new Color3(0.4, 0.467, 0.4) },
      { x: -25, z: -60, h: 30, r: 18, c: new Color3(0.353, 0.42, 0.353) },
      { x: 5, z: -65, h: 35, r: 20, c: new Color3(0.333, 0.4, 0.333) },
      { x: 30, z: -58, h: 25, r: 15, c: new Color3(0.376, 0.439, 0.376) },
      { x: 50, z: -55, h: 20, r: 12, c: new Color3(0.42, 0.482, 0.42) },
      { x: -55, z: -50, h: 18, r: 11, c: new Color3(0.439, 0.502, 0.439) },
      { x: 55, z: -60, h: 24, r: 16, c: new Color3(0.369, 0.431, 0.369) },
    ];

    mountainDefs.forEach((m) => {
      const mesh = MeshBuilder.CreateCylinder(
        'mountain',
        { diameterTop: 0, diameterBottom: m.r * 2, height: m.h, tessellation: 5 },
        this.scene,
      );
      mesh.position.set(m.x, m.h / 2 - 2, m.z);
      mesh.rotation.y = Math.random() * Math.PI;
      const mat = new StandardMaterial('mountainMat', this.scene);
      mat.diffuseColor = m.c;
      mat.specularColor = Color3.Black();
      mesh.material = mat;

      if (m.h > 25) {
        const cap = MeshBuilder.CreateCylinder(
          'mountainCap',
          { diameterTop: 0, diameterBottom: m.r * 0.7, height: m.h * 0.2, tessellation: 5 },
          this.scene,
        );
        cap.position.set(m.x, m.h - 2, m.z);
        cap.rotation.y = Math.random() * Math.PI;
        const capMat = new StandardMaterial('mountainCapMat', this.scene);
        capMat.diffuseColor = new Color3(0.867, 0.91, 0.867);
        capMat.specularColor = Color3.Black();
        cap.material = capMat;
      }
    });

    const treeCount = 14;
    const trunkColor = new Color3(0.4, 0.267, 0.133);
    const leafColors = [
      new Color3(0.18, 0.42, 0.118),
      new Color3(0.22, 0.522, 0.149),
      new Color3(0.259, 0.624, 0.18),
    ];

    for (let i = 0; i < treeCount; i++) {
      const angle = (i / treeCount) * Math.PI * 2 + (Math.random() - 0.5) * 0.3;
      const dist = 20 + Math.random() * 12;
      const tx = Math.cos(angle) * dist;
      const tz = Math.sin(angle) * dist;
      const s = 0.7 + Math.random() * 0.8;

      const trunk = MeshBuilder.CreateCylinder(
        'trunk',
        { diameterTop: 0.3 * s, diameterBottom: 0.5 * s, height: 3 * s, tessellation: 5 },
        this.scene,
      );
      trunk.position.set(tx, 1.5 * s - 0.6, tz);
      const trunkMat = new StandardMaterial('trunkMat', this.scene);
      trunkMat.diffuseColor = trunkColor;
      trunkMat.specularColor = Color3.Black();
      trunk.material = trunkMat;

      for (let j = 0; j < 3; j++) {
        const r = (2.2 - j * 0.5) * s;
        const h = (2.0 - j * 0.3) * s;
        const y = (2.5 + j * 1.4) * s - 0.6;
        const leaf = MeshBuilder.CreateCylinder(
          'leaf',
          { diameterTop: 0, diameterBottom: r * 2, height: h, tessellation: 5 },
          this.scene,
        );
        leaf.position.set(tx, y, tz);
        leaf.rotation.y = Math.random() * Math.PI;
        const leafMat = new StandardMaterial('leafMat', this.scene);
        leafMat.diffuseColor = leafColors[j] ?? new Color3(0.18, 0.42, 0.118);
        leafMat.specularColor = Color3.Black();
        leaf.material = leafMat;
      }
    }
  }

  buildSky() {
    // Custom shader sky sphere — Babylon left-handed, BackSide equivalent is
    // achieved by setting backFaceCulling = false and sideOrientation = BACKSIDE
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

    const sky = MeshBuilder.CreateSphere('sky', { diameter: 180, segments: 16 }, this.scene);
    const skyMat = new ShaderMaterial(
      'skyMat',
      this.scene,
      { vertex: 'sky', fragment: 'sky' },
      {
        attributes: ['position'],
        uniforms: ['worldViewProjection', 'topColor', 'horizColor', 'bottomColor'],
      },
    );
    const colors = this.arena.skyColors;
    if (colors) {
      skyMat.setColor3('topColor', colors.top);
      skyMat.setColor3('horizColor', colors.horiz);
      skyMat.setColor3('bottomColor', colors.bottom);
    } else {
      skyMat.setColor3('topColor', new Color3(0.2, 0.533, 0.8));
      skyMat.setColor3('horizColor', new Color3(0.6, 0.8, 0.933));
      skyMat.setColor3('bottomColor', new Color3(0.533, 0.667, 0.467));
    }
    skyMat.backFaceCulling = false;
    sky.material = skyMat;
    sky.applyFog = false;
  }

  private async loadArenaGlb(): Promise<void> {
    const scenery = this.arena.scenery;
    if (!scenery.glb) return;
    try {
      const lastSlash = scenery.glb.lastIndexOf('/');
      const dir = lastSlash >= 0 ? scenery.glb.substring(0, lastSlash + 1) : '';
      const file = lastSlash >= 0 ? scenery.glb.substring(lastSlash + 1) : scenery.glb;
      const result = await SceneLoader.ImportMeshAsync(null, '/' + dir, file, this.scene);

      const root = new TransformNode(`arenaRoot_${this.arena.id}`, this.scene);
      const scale = scenery.scale ?? 1;
      root.scaling.set(scale, scale, scale);
      if (scenery.position) {
        root.position.set(scenery.position.x, scenery.position.y, scenery.position.z);
      }
      root.rotationQuaternion = Quaternion.RotationAxis(new Vector3(0, 0, 1), scenery.rotationZ ?? 0)
        .multiply(Quaternion.RotationAxis(new Vector3(0, 1, 0), scenery.rotationY ?? 0))
        .multiply(Quaternion.RotationAxis(new Vector3(1, 0, 0), scenery.rotationX ?? 0));

      for (const m of result.meshes) {
        if (m.parent === null) m.parent = root;
        m.receiveShadows = true;
        m.alwaysSelectAsActiveMesh = true;
        m.doNotSyncBoundingInfo = true;
        // Do NOT freeze materials — they were compiled by the GLB loader before
        // receiveShadows was set, so they need one recompile to include shadow
        // sampling code. Freezing here would permanently lock out shadows.
        // The world matrix is still frozen since the scenery never moves.
        m.freezeWorldMatrix();
        // Register as shadow caster so walls/columns/floor cast shadows on each
        // other. _shadowGen is already sized for the device (1024 mobile / 2048 desktop).
        this._shadowGen?.addShadowCaster(m, true);
      }
    } catch (err) {
      console.error(`[Stage] failed to load arena ${this.arena.id}:`, err);
    }
  }

  update(deltaTime: number) {
    this.time += deltaTime;

    for (const light of this.flameLights) {
      light.intensity =
        1.0 +
        Math.sin(this.time * 6 + light.position.x) * 0.3 +
        Math.sin(this.time * 9.7 + light.position.z) * 0.15;
    }
  }
}
