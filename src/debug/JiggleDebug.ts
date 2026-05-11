// Debug renderer for JiggleSim — shows bone segments + sphere/capsule colliders
// always-on-top in real world positions. Toggled via F3 menu checkbox.
//
// Capsule colliders render as actual capsule shapes (cylinder body + 2 hemisphere
// endcaps) so the collision boundary is visually accurate. The cylinder body is
// rebuilt each frame to follow the moving endpoints.

import {
  Color3,
  type LinesMesh,
  type Mesh,
  MeshBuilder,
  Quaternion,
  type Scene,
  StandardMaterial,
  Vector3,
} from '@babylonjs/core';
import type { Fighter } from '../fighter/Fighter';

interface BoneViz {
  line: LinesMesh;
}

interface ColliderViz {
  meshA: Mesh;
  meshB: Mesh | null;
  tube: Mesh | null;
  radius: number;
  isCapsule: boolean;
}

interface PlateViz {
  /** Plane mesh sized 1×1; scaled to current width/height each frame. */
  plate: Mesh;
  /** Small arrow line indicating normal direction. */
  arrow: LinesMesh;
}

interface FighterViz {
  bones: BoneViz[];
  colliders: ColliderViz[];
  plates: PlateViz[];
}

const Y_AXIS = new Vector3(0, 1, 0);

export class JiggleDebug {
  private _enabled = false;
  private _vizs: FighterViz[] = [];
  private _wireMat: StandardMaterial | null = null;
  private _plateMat: StandardMaterial | null = null;
  private _fighterColors = [Color3.Yellow(), Color3.FromHexString('#00ffff')];

  constructor(
    private readonly _scene: Scene,
    private readonly _getFighters: () => readonly (Fighter | null)[],
  ) {}

  get enabled(): boolean {
    return this._enabled;
  }

  setEnabled(on: boolean): void {
    if (on === this._enabled) return;
    this._enabled = on;
    if (on) this._build();
    else this._destroy();
    for (const f of this._getFighters()) {
      f?.jiggleSim?.setDiag(on);
    }
  }

  /** Position+orient a unit-Y, unit-diameter cylinder mesh between two
   * world-space endpoints with the given radius. */
  private _orientTube(tube: Mesh, a: Vector3, b: Vector3, radius: number): void {
    const mid = a.add(b).scaleInPlace(0.5);
    tube.position.copyFrom(mid);
    const dir = b.subtract(a);
    const len = dir.length();
    if (len < 1e-6) {
      tube.scaling.set(0, 0, 0);
      return;
    }
    dir.scaleInPlace(1 / len);
    const dot = Vector3.Dot(Y_AXIS, dir);
    if (dot > 0.9999) {
      tube.rotationQuaternion = Quaternion.Identity();
    } else if (dot < -0.9999) {
      tube.rotationQuaternion = Quaternion.RotationAxis(new Vector3(1, 0, 0), Math.PI);
    } else {
      const axis = Vector3.Cross(Y_AXIS, dir).normalize();
      const angle = Math.acos(dot);
      tube.rotationQuaternion = Quaternion.RotationAxis(axis, angle);
    }
    // Unit cylinder (diameter=1, height=1): X/Z scale by 2*radius (diameter),
    // Y scales to endpoint distance.
    tube.scaling.set(radius * 2, len, radius * 2);
  }

  // biome-ignore lint/complexity/noExcessiveCognitiveComplexity: debug visualizer
  update(): void {
    if (!this._enabled) return;
    const fighters = this._getFighters();
    for (let fi = 0; fi < this._vizs.length; fi++) {
      const viz = this._vizs[fi];
      if (!viz) continue;
      const f = fighters[fi];
      const sim = f?.jiggleSim ?? null;
      if (!sim) continue;
      const refMesh = f?.meshes?.[0];
      const snap = sim.getDebugSnapshot(refMesh);

      for (let i = 0; i < viz.bones.length && i < snap.bones.length; i++) {
        const b = snap.bones[i];
        const v = viz.bones[i];
        if (!b || !v) continue;
        v.line = MeshBuilder.CreateLines(
          v.line.name,
          { points: [b.head, b.tail], updatable: true, instance: v.line },
          this._scene,
        );
      }
      for (let i = 0; i < viz.colliders.length && i < snap.colliders.length; i++) {
        const c = snap.colliders[i];
        const v = viz.colliders[i];
        if (!c || !v) continue;
        v.meshA.position.copyFrom(c.a);
        v.meshA.scaling.setAll(c.radius * 2);
        if (v.isCapsule && c.b && v.meshB && v.tube) {
          v.meshB.position.copyFrom(c.b);
          v.meshB.scaling.setAll(c.radius * 2);
          this._orientTube(v.tube, c.a, c.b, c.radius);
        }
      }
      for (let i = 0; i < viz.plates.length && i < snap.plates.length; i++) {
        const p = snap.plates[i];
        const v = viz.plates[i];
        if (!p || !v) continue;
        // Position plate at center, orient via right/up basis, scale to dims.
        v.plate.position.copyFrom(p.center);
        // Build rotation matrix from (right, up, normal) basis. Babylon meshes
        // built with default ground (Y-up plane) have local Y as the normal —
        // align local +Y with world normal, +X with right, +Z with up.
        const q = Quaternion.RotationQuaternionFromAxis(p.right, p.normal, p.up);
        v.plate.rotationQuaternion = q;
        v.plate.scaling.set(p.width, 1, p.height);
        // Arrow showing normal direction.
        const tip = p.center.add(p.normal.scale(0.05));
        v.arrow = MeshBuilder.CreateLines(
          v.arrow.name,
          { points: [p.center, tip], updatable: true, instance: v.arrow },
          this._scene,
        );
      }
    }
  }

  dispose(): void {
    this._destroy();
  }

  private _build(): void {
    if (!this._wireMat) {
      const m = new StandardMaterial('jiggleDebugWire', this._scene);
      m.wireframe = true;
      m.emissiveColor = Color3.Magenta();
      m.disableDepthWrite = true;
      m.disableLighting = true;
      m.backFaceCulling = false;
      this._wireMat = m;
    }
    if (!this._plateMat) {
      // Plates use a distinct color (green) so they're easy to tell apart
      // from sphere/capsule colliders (magenta).
      const pm = new StandardMaterial('jiggleDebugPlate', this._scene);
      pm.wireframe = true;
      pm.emissiveColor = Color3.FromHexString('#00ff66');
      pm.disableDepthWrite = true;
      pm.disableLighting = true;
      pm.backFaceCulling = false;
      this._plateMat = pm;
    }
    const fighters = this._getFighters();
    for (let fi = 0; fi < fighters.length; fi++) {
      const f = fighters[fi];
      const sim = f?.jiggleSim ?? null;
      if (!sim) {
        this._vizs.push({ bones: [], colliders: [], plates: [] });
        continue;
      }
      const refMesh = f?.meshes?.[0];
      const snap = sim.getDebugSnapshot(refMesh);
      const color = this._fighterColors[fi % this._fighterColors.length] ?? Color3.White();

      const bones: BoneViz[] = snap.bones.map((b, i) => {
        const line = MeshBuilder.CreateLines(
          `jiggleBone_f${fi}_${i}`,
          { points: [b.head, b.tail], updatable: true },
          this._scene,
        );
        line.color = color;
        line.renderingGroupId = 3;
        line.isPickable = false;
        return { line };
      });

      const colliders: ColliderViz[] = snap.colliders.map((c, i) => {
        // All meshes built at unit size; scaled per-frame from live radius.
        const meshA = MeshBuilder.CreateSphere(
          `jiggleCollider_f${fi}_${i}_a`,
          { diameter: 1, segments: 8 },
          this._scene,
        );
        meshA.material = this._wireMat;
        meshA.position.copyFrom(c.a);
        meshA.scaling.setAll(c.radius * 2);
        meshA.renderingGroupId = 3;
        meshA.isPickable = false;
        let meshB: Mesh | null = null;
        let tube: Mesh | null = null;
        if (c.b) {
          meshB = MeshBuilder.CreateSphere(
            `jiggleCollider_f${fi}_${i}_b`,
            { diameter: 1, segments: 8 },
            this._scene,
          );
          meshB.material = this._wireMat;
          meshB.position.copyFrom(c.b);
          meshB.scaling.setAll(c.radius * 2);
          meshB.renderingGroupId = 3;
          meshB.isPickable = false;
          tube = MeshBuilder.CreateCylinder(
            `jiggleCollider_f${fi}_${i}_tube`,
            { diameter: 1, height: 1, tessellation: 12 },
            this._scene,
          );
          tube.material = this._wireMat;
          tube.renderingGroupId = 3;
          tube.isPickable = false;
          this._orientTube(tube, c.a, c.b, c.radius);
        }
        return { meshA, meshB, tube, radius: c.radius, isCapsule: c.b !== null };
      });

      const plates: PlateViz[] = snap.plates.map((p, i) => {
        const plate = MeshBuilder.CreateBox(
          `jigglePlate_f${fi}_${i}`,
          { width: 1, height: 0.01, depth: 1 },
          this._scene,
        );
        plate.material = this._plateMat;
        plate.renderingGroupId = 3;
        plate.isPickable = false;
        plate.position.copyFrom(p.center);
        plate.scaling.set(p.width, 1, p.height);
        const arrow = MeshBuilder.CreateLines(
          `jigglePlateArrow_f${fi}_${i}`,
          { points: [p.center, p.center.add(p.normal.scale(0.06))], updatable: true },
          this._scene,
        );
        arrow.color = Color3.FromHexString('#ffaa00');
        arrow.renderingGroupId = 3;
        arrow.isPickable = false;
        return { plate, arrow };
      });

      this._vizs.push({ bones, colliders, plates });
    }
  }

  private _destroy(): void {
    for (const viz of this._vizs) {
      for (const b of viz.bones) b.line.dispose();
      for (const c of viz.colliders) {
        c.meshA.dispose();
        c.meshB?.dispose();
        c.tube?.dispose();
      }
      for (const p of viz.plates) {
        p.plate.dispose();
        p.arrow.dispose();
      }
    }
    this._vizs = [];
  }
}
