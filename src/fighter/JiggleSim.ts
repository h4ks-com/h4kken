import {
  type Bone,
  Quaternion,
  type Skeleton,
  Space,
  type TransformNode,
  Vector3,
} from '@babylonjs/core';

export interface JiggleBoneConfig {
  /** Bone name as exported from Blender/GLB (exact match or suffix after `-`). */
  name: string;
  /** Spring stiffness 0–1: lower = laggier/jigglier, higher = follows tight. Default 0.3 */
  stiffness?: number;
  /** Drag 0–1: higher = velocity decays faster (settles fast, less bounce). Default 0.3 */
  drag?: number;
  /** Downward gravity per frame in WORLD -Y. Default 0.0005 */
  gravityPower?: number;
  /**
   * How much the bone's REST direction tracks its parent's rotation.
   *   1.0 = fully follow parent (default Babylon skinning behaviour)
   *   0.0 = locked to world direction recorded at init (T-pose)
   *   0.5 = halfway — useful for Breast_Jiggle so it leans with chest but
   *         not as much, keeping silhouette intact in combat stance.
   * Default 1.0
   */
  parentFollow?: number;
}

interface BoneState {
  bone: Bone;
  parent: Bone;
  /** Linked TransformNode if present (GLB-loaded direct skeleton). When the
   * skeleton was CLONED (game's Fighter does this), TN linkage is lost and
   * we write to bone.rotationQuaternion directly instead. */
  tn: TransformNode | null;
  parentTN: TransformNode | null;
  /** Bone bind/rest local rotation (in parent space). */
  initialLocalRot: Quaternion;
  /** Bone +Y axis at rest, in parent-local space. */
  restDirLocal: Vector3;
  boneLength: number;
  stiffness: number;
  drag: number;
  gravityPower: number;
  parentFollow: number;
  /** Parent's world rotation at init (T-pose). Used to compute the
   * "delta" rotation parent has rotated since bind, which we then partially
   * apply to the rest direction based on parentFollow. */
  parentRotAtInit: Quaternion;
  /** Fixed world direction recorded at bind/init time. */
  restDirWorldFixed: Vector3;
  /** Tail position in WORLD space (verlet integrated). World frame is what
   * gives jiggle its inertia: when parent moves, world tail stays put briefly. */
  prevTailWorld: Vector3;
  currentTailWorld: Vector3;
}

const BONE_AXIS = Vector3.Up();

// Quaternion taking unit `from` → unit `to` via cross-product formula.
// Handles antiparallel case (180° rotation around any perpendicular axis).
function rotationBetweenUnitVectors(from: Vector3, to: Vector3, out: Quaternion): void {
  const dot = Vector3.Dot(from, to);
  if (dot < -0.9999) {
    const perp =
      Math.abs(from.x) < 0.9
        ? Vector3.Cross(from, Vector3.Right())
        : Vector3.Cross(from, Vector3.Up());
    perp.normalize();
    out.set(perp.x, perp.y, perp.z, 0);
    return;
  }
  const cross = Vector3.Cross(from, to);
  out.set(cross.x, cross.y, cross.z, 1 + dot).normalize();
}

// v' = q * v * q^-1, written out for hot-path performance (avoids Matrix alloc).
function rotateVectorByQuat(q: Quaternion, v: Vector3, out: Vector3): void {
  const cx = q.y * v.z - q.z * v.y;
  const cy = q.z * v.x - q.x * v.z;
  const cz = q.x * v.y - q.y * v.x;
  const ix = cx + q.w * v.x;
  const iy = cy + q.w * v.y;
  const iz = cz + q.w * v.z;
  out.set(
    v.x + 2 * (q.y * iz - q.z * iy),
    v.y + 2 * (q.z * ix - q.x * iz),
    v.z + 2 * (q.x * iy - q.y * ix),
  );
}

/**
 * Spring-bone secondary motion for jiggle bones (e.g. breasts, hair tips).
 *
 * Algorithm: world-space mass-spring-damper on each bone's tail position.
 * Each frame the tail is pulled toward its rigid-follow rest position by a
 * spring force, opposed by drag, with optional gravity bias. The bone's local
 * rotation is then computed to make BONE_AXIS point at the simulated tail
 * direction in parent-local space, preserving rest twist.
 *
 * Warmup: for the first 15 frames the sim ONLY writes the bind rotation,
 * skipping physics, to prevent a startup kick before linked-TN matrices have
 * settled into a stable state.
 *
 * Babylon-specific: Babylon's GLB loader links each bone to a TransformNode.
 * Skinning reads matrices from the linked TN, NOT the bone directly, so the
 * sim must read parent rotation from `parentTN.getWorldMatrix()` and write
 * the new rotation to `bone.linkedTN.rotationQuaternion`.
 */
export class JiggleSim {
  private static readonly WARMUP_FRAMES = 15;

  private readonly _bones: BoneState[] = [];
  private _frameCount = 0;

  constructor(skeleton: Skeleton, configs: readonly JiggleBoneConfig[]) {
    for (const cfg of configs) {
      const bone = skeleton.bones.find(
        (b) => b.name === cfg.name || b.name.endsWith(`-${cfg.name}`),
      );
      if (!bone) {
        console.warn(`[JiggleSim] Bone "${cfg.name}" not found in skeleton`);
        continue;
      }
      const parent = bone.getParent() as Bone | null;
      if (!parent) {
        console.warn(`[JiggleSim] Bone "${cfg.name}" has no parent`);
        continue;
      }
      // Try linked TN (GLB-loaded direct skeletons). Cloned skeletons (game
      // path) have no linkage — fall back to writing the bone directly.
      const tn = bone.getTransformNode();
      const parentTN = parent.getTransformNode();

      // Authoritative rest local rotation. Prefer linked TN's rotationQuaternion
      // when present (what skinning reads in GLB-direct path), else read from
      // the bone itself (cloned-skeleton path — Babylon updates skinning from
      // bone's own _localMatrix which is composed from rotationQuaternion).
      const initialLocalRot = new Quaternion();
      if (tn?.rotationQuaternion) {
        initialLocalRot.copyFrom(tn.rotationQuaternion);
      } else {
        bone.getLocalMatrix().decompose(undefined, initialLocalRot, undefined);
        if (tn && !tn.rotationQuaternion) tn.rotationQuaternion = initialLocalRot.clone();
        if (!bone.rotationQuaternion) bone.rotationQuaternion = initialLocalRot.clone();
      }

      const restDirLocal = new Vector3();
      rotateVectorByQuat(initialLocalRot, BONE_AXIS, restDirLocal);
      restDirLocal.normalize();

      // Bone length from local position (head offset from parent).
      const localPos = tn?.position ?? bone.position;
      const boneLength = Math.max(localPos.length(), 0.05);

      // Initial world tail position.
      parentTN?.computeWorldMatrix(true);
      tn?.computeWorldMatrix(true);
      const head = (tn?.getAbsolutePosition() ?? bone.getAbsolutePosition()).clone();
      const parentRot = new Quaternion();
      const parentMat = parentTN?.getWorldMatrix() ?? parent.getWorldMatrix();
      parentMat.decompose(undefined, parentRot, undefined);

      const restDirWorld = new Vector3();
      rotateVectorByQuat(parentRot, restDirLocal, restDirWorld);
      restDirWorld.normalize();
      const tailWorld = head.add(restDirWorld.scale(boneLength));

      this._bones.push({
        bone,
        parent,
        tn,
        parentTN,
        initialLocalRot,
        restDirLocal,
        boneLength,
        stiffness: cfg.stiffness ?? 0.3,
        drag: cfg.drag ?? 0.3,
        gravityPower: cfg.gravityPower ?? 0.0005,
        parentFollow: cfg.parentFollow ?? 1.0,
        parentRotAtInit: parentRot.clone(),
        restDirWorldFixed: restDirWorld.clone(),
        prevTailWorld: tailWorld.clone(),
        currentTailWorld: tailWorld.clone(),
      });
    }
  }

  update(deltaTimeMs: number): void {
    // Tab backgrounded for too long — reset to rest to avoid spring explosion.
    if (deltaTimeMs > 100) {
      for (const s of this._bones) this._resetBone(s);
      return;
    }
    // Warmup: keep bones at exact bind rotation while linked-TN matrices settle.
    if (this._frameCount < JiggleSim.WARMUP_FRAMES) {
      for (const s of this._bones) this._resetBone(s);
      this._frameCount++;
      return;
    }
    for (const s of this._bones) this._step(s, deltaTimeMs / 16.667);
    this._frameCount++;
  }

  /** Re-snap all bones to bind rest and reset warmup counter. Call after
   * pausing/disabling the sim externally to avoid a kick from stale state. */
  reset(): void {
    this._frameCount = 0;
    for (const s of this._bones) this._resetBone(s);
  }

  dispose(): void {
    // No allocated GPU resources to release.
  }

  /** Compute the rest direction in world space, blended between fully-following
   * parent (parentFollow=1) and fully-fixed-at-bind (parentFollow=0). */
  private _computeRestDirWorld(s: BoneState, parentRot: Quaternion, out: Vector3): void {
    if (s.parentFollow >= 0.999) {
      rotateVectorByQuat(parentRot, s.restDirLocal, out);
    } else if (s.parentFollow <= 0.001) {
      out.copyFrom(s.restDirWorldFixed);
    } else {
      const delta = parentRot.multiply(Quaternion.Inverse(s.parentRotAtInit));
      const partial = Quaternion.Slerp(Quaternion.Identity(), delta, s.parentFollow);
      rotateVectorByQuat(partial, s.restDirWorldFixed, out);
    }
    out.normalize();
  }

  private _resetBone(s: BoneState): void {
    s.parentTN?.computeWorldMatrix(true);
    s.tn?.computeWorldMatrix(true);
    const head = s.tn?.getAbsolutePosition() ?? s.bone.getAbsolutePosition();
    const parentRot = new Quaternion();
    const parentMat = s.parentTN?.getWorldMatrix() ?? s.parent.getWorldMatrix();
    parentMat.decompose(undefined, parentRot, undefined);
    const dir = new Vector3();
    this._computeRestDirWorld(s, parentRot, dir);
    const tail = head.add(dir.scale(s.boneLength));
    s.prevTailWorld.copyFrom(tail);
    s.currentTailWorld.copyFrom(tail);
    this._writeRotationForWorldDir(s, parentRot, dir);
  }

  /** Set bone's local rotation so its world Y-axis points along `dirWorld`,
   * preserving rest twist. */
  private _writeRotationForWorldDir(s: BoneState, parentRot: Quaternion, dirWorld: Vector3): void {
    const parentInv = Quaternion.Inverse(parentRot);
    const dirLocal = new Vector3();
    rotateVectorByQuat(parentInv, dirWorld, dirLocal);
    dirLocal.normalize();
    const swing = new Quaternion();
    rotationBetweenUnitVectors(BONE_AXIS, dirLocal, swing);
    const swingRest = new Quaternion();
    rotationBetweenUnitVectors(BONE_AXIS, s.restDirLocal, swingRest);
    const twistRest = Quaternion.Inverse(swingRest).multiply(s.initialLocalRot);
    this._writeRotation(s, swing.multiply(twistRest));
  }

  /** Write a local rotation to bone — to linked TN if present, else direct
   * to the bone via Babylon's official API (cloned-skeleton path). */
  private _writeRotation(s: BoneState, q: Quaternion): void {
    if (s.tn?.rotationQuaternion) {
      s.tn.rotationQuaternion.copyFrom(q);
    } else {
      // Babylon's setRotationQuaternion handles matrix invalidation for both
      // direct bones and bones inside a cloned skeleton.
      s.bone.setRotationQuaternion(q, Space.LOCAL);
    }
  }

  private _step(s: BoneState, dt: number): void {
    s.parentTN?.computeWorldMatrix(true);
    s.tn?.computeWorldMatrix(true);

    const head = s.tn?.getAbsolutePosition() ?? s.bone.getAbsolutePosition();
    const parentRot = new Quaternion();
    const parentMat = s.parentTN?.getWorldMatrix() ?? s.parent.getWorldMatrix();
    parentMat.decompose(undefined, parentRot, undefined);

    const restDirWorld = new Vector3();
    this._computeRestDirWorld(s, parentRot, restDirWorld);
    const restTailWorld = head.add(restDirWorld.scale(s.boneLength));

    // Mass-spring-damper integration step (mass=1). dt is normalised to
    // 60 fps units (1.0 = one 60 fps frame) so coefficients are frame-rate independent.
    const velocity = s.currentTailWorld.subtract(s.prevTailWorld);
    const springForce = restTailWorld.subtract(s.currentTailWorld).scale(s.stiffness * dt);
    const dampingForce = velocity.scale(-s.drag * dt);
    const accel = springForce.add(dampingForce);
    accel.y -= s.gravityPower * dt;
    const newVel = velocity.add(accel);
    const next = s.currentTailWorld.add(newVel);

    // Length constraint: clamp tail to sphere of boneLength around head.
    // Stops unbounded drift under low drag + spring oscillation.
    const toTailRaw = next.subtract(head);
    const distRaw = toTailRaw.length();
    if (distRaw > 0.001) toTailRaw.scaleInPlace(s.boneLength / distRaw);
    next.copyFrom(head.add(toTailRaw));

    s.prevTailWorld.copyFrom(s.currentTailWorld);
    s.currentTailWorld.copyFrom(next);

    // Compute bone's new local rotation: map BONE_AXIS to actual tail direction
    // in parent-local space, preserving rest twist around the bone axis.
    const toTail = next.subtract(head);
    const dist = toTail.length();
    if (dist < 1e-6) return;
    const dirWorld = toTail.scaleInPlace(1 / dist);
    const parentInv = Quaternion.Inverse(parentRot);
    const dirLocal = new Vector3();
    rotateVectorByQuat(parentInv, dirWorld, dirLocal);
    dirLocal.normalize();

    const swing = new Quaternion();
    rotationBetweenUnitVectors(BONE_AXIS, dirLocal, swing);
    const swingRest = new Quaternion();
    rotationBetweenUnitVectors(BONE_AXIS, s.restDirLocal, swingRest);
    const twistRest = Quaternion.Inverse(swingRest).multiply(s.initialLocalRot);
    const finalRot = swing.multiply(twistRest);
    this._writeRotation(s, finalRot);
  }
}
