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
  /**
   * Constrain tail motion to a 2D plane in character-local space — so the bone
   * acts like a pendulum that swings only forward/back (or only sideways).
   *   'localX' = lock character-local X delta to rest (chain swings in YZ plane)
   *   'localY' = lock Y delta (X-Z plane swing)
   *   'localZ' = lock Z delta (X-Y plane swing)
   * Requires JiggleSim to be constructed with a rootNode.
   * Use 'localX' for cloth chains so they don't compress sideways into the mesh.
   */
  lockAxis?: 'localX' | 'localY' | 'localZ';
}

/** Sphere or capsule collider that pushes jiggle bone tails out. The bone
 * world position is tracked each frame (so it follows leg/arm motion).
 * If `toBone` is set, the collider becomes a CAPSULE between `bone` head
 * and `toBone` head with the given radius. */
export interface JiggleColliderConfig {
  /** Bone whose world position is the sphere center / capsule start. */
  bone: string;
  /** Sphere radius in world meters. */
  radius: number;
  /** If set, makes this a CAPSULE from `bone` head to `toBone` head. */
  toBone?: string;
  /** When set with `toBone`: trims the capsule start position along the
   * boneA→boneB segment. 0 = boneA.head (default), 0.5 = midpoint, 1 = boneB.head. */
  tStart?: number;
  /** When set with `toBone`: trims the capsule end position along the
   * boneA→boneB segment. 1 = boneB.head (default), 0.5 = midpoint. */
  tEnd?: number;
}

/** Lateral spring link between two parallel bone chains — for cloth-like
 * behaviour where adjacent grid columns shouldn't drift apart in X. Resolves
 * to N pairs (depth 1..N) connecting `${chainA}_i` ↔ `${chainB}_i`. Each pair
 * gets a spring that pulls tails toward their initial rest distance. Without
 * this, parallel cloth chains move independently and the mesh stretches. */
export interface JiggleLateralPairConfig {
  chainA: string;
  chainB: string;
  /** Number of bones in each chain (must match). */
  count: number;
  /** 0–1 — how strongly the link pulls toward rest distance per frame. Default 0.4. */
  stiffness?: number;
}

/** A small plate attached to a JIGGLE BONE — gives the cloth bone surface
 * area for collision detection (instead of a single point). Plate corners
 * get sampled vs capsule colliders each frame; when penetrating, the bone's
 * tail is pushed along the plate's normal to escape. The fixed-normal push
 * direction prevents the radial-sliding that single-point collisions suffer
 * from when cloth grazes the side of a leg. */
export interface JigglePlateColliderConfig {
  /** Jiggle bone name. The plate is attached to this bone's tail. */
  bone: string;
  /** Plate width in world meters (along bone-local X axis). */
  width: number;
  /** Plate height in world meters (along bone-local Z axis = up axis). */
  height: number;
  /** Plate normal direction in BONE-LOCAL space. The plate's outward face.
   * Push direction when collision is detected. Default [0, 0, 1]. */
  normal?: readonly [number, number, number];
}

/** Unified jiggle/cloth configuration for a character — single source of truth.
 * Plumbed through CharacterMeta → SharedAssets → JiggleSim. */
export interface JiggleConfig {
  /** Spring-bone configs for jiggle bones (breast, hair, cloth chains, etc.). */
  bones: readonly JiggleBoneConfig[];
  /** Sphere/capsule colliders. */
  colliders?: readonly JiggleColliderConfig[];
  /** Planar colliders (one-sided barriers tracking bones). */
  plateColliders?: readonly JigglePlateColliderConfig[];
  /** Lateral spring links between adjacent chains (cloth grid cohesion). */
  lateralPairs?: readonly JiggleLateralPairConfig[];
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
  /** Pendulum constraint axis index (0=localX,1=localY,2=localZ) or -1 = none. */
  lockAxisIdx: number;
  /** Rest tail position in character-local space (used to clamp locked axis). */
  restTailLocalChar: Vector3;
  /** Bone head position from previous frame — used to detect anim teleports. */
  prevHead: Vector3;
  /** Sticky cloth state: when a plate sample contacts a leg, the cloth bone
   * tail is soft-pinned to that leg bone (with frozen offset in leg-local
   * space) for a few frames. Eliminates the slip-around-leg artifact during
   * kicks. Null = no current sticky attachment. Weight decays when out of
   * contact, so cloth releases and swings free naturally. */
  stickyBone: Bone | null;
  stickyTn: TransformNode | null;
  /** Offset from sticky leg bone's world pos to cloth tail at moment of
   * first contact, expressed in leg-bone's local frame so it tracks rotation. */
  stickyOffsetLocal: Vector3;
  /** 0..1. 1 = full sticky, 0 = free physics. Snaps to 1 on contact, decays
   * when no contact (~5 frames to release). */
  stickyWeight: number;
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
interface ColliderState {
  bone: Bone;
  tn: TransformNode | null;
  radius: number;
  /** Capsule end bone (optional). When set, collider is a capsule. */
  toBone: Bone | null;
  toTn: TransformNode | null;
  /** Capsule trim along bone→toBone segment. Defaults [0, 1] (full). */
  tStart: number;
  tEnd: number;
}

interface PlateState {
  /** Index into `_bones` — which JIGGLE bone owns this plate. */
  boneIndex: number;
  /** Plate normal in bone-local space (unit). */
  normal: Vector3;
  /** Plate "up" axis in bone-local (perpendicular to normal). */
  up: Vector3;
  /** Plate right axis = normal × up. */
  right: Vector3;
  /** Half dimensions in skel-local (width/2 * invScale). */
  halfWidth: number;
  halfHeight: number;
}

interface LateralPairState {
  /** Index into _bones array for each side of the pair. */
  a: number;
  b: number;
  /** Initial rest distance between tails (in physics-space). */
  restDist: number;
  stiffness: number;
}

export class JiggleSim {
  private static readonly WARMUP_FRAMES = 15;

  private readonly _bones: BoneState[] = [];
  private readonly _colliders: ColliderState[] = [];
  private readonly _plates: PlateState[] = [];
  private readonly _lateralPairs: LateralPairState[] = [];
  private readonly _rootNode: TransformNode | null;
  /** Inverse of fighter root uniform scale. Physics + collisions run in
   * skeleton-local space, so a world-meter radius like 0.10 must be divided
   * by fighter scale internally to match the actual world boundary. */
  private readonly _invScale: number;
  private _frameCount = 0;

  constructor(skeleton: Skeleton, config: JiggleConfig, rootNode: TransformNode | null = null) {
    const { bones: configs, colliders = [], plateColliders = [], lateralPairs = [] } = config;
    this._rootNode = rootNode;
    this._invScale = rootNode ? 1 / Math.max(rootNode.scaling.x, 0.001) : 1;
    if (this._invScale !== 1) {
      console.log(
        `[JiggleSim] fighter scale=${rootNode!.scaling.x.toFixed(3)}, ` +
          `collider radii internally divided by it (config in world meters)`,
      );
    }
    for (const cc of colliders) {
      const bone = skeleton.bones.find((b) => b.name === cc.bone || b.name.endsWith(`-${cc.bone}`));
      if (!bone) {
        console.warn(`[JiggleSim] Collider bone "${cc.bone}" not found`);
        continue;
      }
      let toBone: Bone | null = null;
      let toTn: TransformNode | null = null;
      if (cc.toBone) {
        toBone =
          skeleton.bones.find((b) => b.name === cc.toBone || b.name.endsWith(`-${cc.toBone}`)) ??
          null;
        if (!toBone) {
          console.warn(`[JiggleSim] Capsule end bone "${cc.toBone}" not found`);
        } else {
          toTn = toBone.getTransformNode();
        }
      }
      this._colliders.push({
        bone,
        tn: bone.getTransformNode(),
        radius: cc.radius,
        toBone,
        toTn,
        tStart: cc.tStart ?? 0,
        tEnd: cc.tEnd ?? 1,
      });
    }

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

      const lockAxisIdx =
        cfg.lockAxis === 'localX'
          ? 0
          : cfg.lockAxis === 'localY'
            ? 1
            : cfg.lockAxis === 'localZ'
              ? 2
              : -1;
      // Rest tail captured in the SAME space as physics integration:
      // - Direct skeleton (linked TN): world space.
      // - Cloned skeleton (game path): skeleton-local space.
      // Lock applies in that same space each frame, so character movement /
      // rotation tracks naturally without any rootNode bookkeeping.
      const restTailLocalChar = tailWorld.clone();

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
        lockAxisIdx,
        restTailLocalChar,
        prevHead: head.clone(),
        stickyBone: null,
        stickyTn: null,
        stickyOffsetLocal: Vector3.Zero(),
        stickyWeight: 0,
      });
    }

    // Build bone-name → index map for plate + lateral pair resolution.
    const boneByName = new Map<string, number>();
    for (let i = 0; i < this._bones.length; i++) {
      boneByName.set(this._bones[i]!.bone.name, i);
    }

    // Resolve plate configs — each plate attached to a JIGGLE bone, gives
    // it surface-area collision detection vs capsules.
    for (const pc of plateColliders) {
      const idx = boneByName.get(pc.bone);
      if (idx === undefined) {
        console.warn(`[JiggleSim] Plate bone "${pc.bone}" is not a registered jiggle bone`);
        continue;
      }
      const normal = new Vector3(
        pc.normal?.[0] ?? 0,
        pc.normal?.[1] ?? 0,
        pc.normal?.[2] ?? 1,
      ).normalize();
      // Pick an "up" perpendicular to normal — default to bone Y axis (0,1,0).
      const up = new Vector3(0, 1, 0);
      up.subtractInPlace(normal.scale(Vector3.Dot(up, normal)));
      if (up.lengthSquared() < 1e-6) {
        // normal was nearly Y — use Z instead.
        up.set(0, 0, 1);
        up.subtractInPlace(normal.scale(Vector3.Dot(up, normal)));
      }
      up.normalize();
      const right = Vector3.Cross(normal, up).normalize();
      this._plates.push({
        boneIndex: idx,
        normal,
        up,
        right,
        halfWidth: pc.width * 0.5 * this._invScale,
        halfHeight: pc.height * 0.5 * this._invScale,
      });
    }
    if (this._plates.length > 0) {
      console.log(`[JiggleSim] resolved ${this._plates.length} cloth plates`);
    }

    for (const lp of lateralPairs) {
      for (let i = 1; i <= lp.count; i++) {
        const aIdx = boneByName.get(`${lp.chainA}_${i}`);
        const bIdx = boneByName.get(`${lp.chainB}_${i}`);
        if (aIdx === undefined || bIdx === undefined) continue;
        const a = this._bones[aIdx]!;
        const b = this._bones[bIdx]!;
        const dist = Vector3.Distance(a.currentTailWorld, b.currentTailWorld);
        this._lateralPairs.push({
          a: aIdx,
          b: bIdx,
          restDist: dist,
          stiffness: lp.stiffness ?? 0.4,
        });
      }
    }
    if (this._lateralPairs.length > 0) {
      console.log(`[JiggleSim] resolved ${this._lateralPairs.length} lateral pairs`);
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
    // Lateral constraint pass: pull paired bones toward their rest distance.
    // Acts AFTER all _step calls finish so pair members see each other's final
    // tails. Mutates currentTailWorld then rewrites rotation for affected bones.
    if (this.lateralPairsEnabled && this._lateralPairs.length > 0) {
      this._applyLateralPairs();
    }
    // Aggregate live stats for the debug panel.
    let speedSum = 0,
      speedMax = 0,
      worstName = '',
      worstSpeed = 0;
    for (const s of this._bones) {
      const dx = s.currentTailWorld.x - s.prevTailWorld.x;
      const dy = s.currentTailWorld.y - s.prevTailWorld.y;
      const dz = s.currentTailWorld.z - s.prevTailWorld.z;
      const speed = Math.sqrt(dx * dx + dy * dy + dz * dz);
      speedSum += speed;
      if (speed > speedMax) speedMax = speed;
      if (speed > worstSpeed) {
        worstSpeed = speed;
        worstName = s.bone.name;
      }
    }
    this.diagStats.bonesInContact = this._statsContactCount;
    this.diagStats.maxSpeed = speedMax;
    this.diagStats.avgSpeed = this._bones.length > 0 ? speedSum / this._bones.length : 0;
    this.diagStats.worstBone = worstName;
    this.diagStats.worstBoneSpeed = worstSpeed;
    this._statsContactCount = 0;
    this._frameCount++;
    if (this._diagEnabled) {
      this._diagFrames++;
      if (this._diagFrames >= 60) {
        if (this._diagCounts.size > 0) {
          const summary = Array.from(this._diagCounts.entries())
            .sort((a, b) => b[1] - a[1])
            .slice(0, 10)
            .map(([n, c]) => `${n}:${c}`)
            .join(' ');
          console.log(`[JiggleSim] collisions/s — ${summary}`);
        }
        this._diagCounts.clear();
        this._diagFrames = 0;
      }
    }
  }

  /** Re-snap all bones to bind rest and reset warmup counter. Call after
   * pausing/disabling the sim externally to avoid a kick from stale state. */
  reset(): void {
    this._frameCount = 0;
    for (const s of this._bones) this._resetBone(s);
  }

  // ---- Diagnostics ----
  private _diagEnabled = false;
  private _diagCounts = new Map<string, number>();
  private _diagFrames = 0;

  /** Toggle per-frame collision counter logs. Logs every ~1s when enabled. */
  setDiag(on: boolean): void {
    this._diagEnabled = on;
    this._diagCounts.clear();
    this._diagFrames = 0;
    if (on) {
      console.log(
        `[JiggleSim] diag ON. invScale=${this._invScale.toFixed(3)}, ` +
          `bones=${this._bones.length}, colliders=${this._colliders.length}`,
      );
      for (const c of this._colliders) {
        console.log(
          `  collider: bone=${c.bone.name}${c.toBone ? '→' + c.toBone.name : ''} ` +
            `radius=${c.radius.toFixed(3)}m (skel=${(c.radius * this._invScale).toFixed(4)})`,
        );
      }
    }
  }

  private _diagLogCollision(boneName: string): void {
    if (!this._diagEnabled) return;
    this._diagCounts.set(boneName, (this._diagCounts.get(boneName) ?? 0) + 1);
  }

  dispose(): void {
    // No allocated GPU resources to release.
  }

  // ---- Live tuning API (debug page) ----
  get colliderCount(): number {
    return this._colliders.length;
  }

  getColliderInfo(i: number): {
    boneName: string;
    toBoneName: string | null;
    radius: number;
    isCapsule: boolean;
  } | null {
    const c = this._colliders[i];
    if (!c) return null;
    return {
      boneName: c.bone.name,
      toBoneName: c.toBone?.name ?? null,
      radius: c.radius,
      isCapsule: c.toBone !== null,
    };
  }

  setColliderRadius(i: number, radius: number): void {
    const c = this._colliders[i];
    if (c) c.radius = radius;
  }

  get lateralPairCount(): number {
    return this._lateralPairs.length;
  }

  getLateralPairInfo(i: number): {
    aBoneName: string;
    bBoneName: string;
    restDist: number;
    stiffness: number;
  } | null {
    const lp = this._lateralPairs[i];
    if (!lp) return null;
    return {
      aBoneName: this._bones[lp.a]?.bone.name ?? '?',
      bBoneName: this._bones[lp.b]?.bone.name ?? '?',
      restDist: lp.restDist,
      stiffness: lp.stiffness,
    };
  }

  setLateralPairStiffness(i: number, stiffness: number): void {
    const lp = this._lateralPairs[i];
    if (lp) lp.stiffness = stiffness;
  }

  // ---- Runtime feature toggles for debug isolation ----
  collidersEnabled = true;
  platesEnabled = true;
  lateralPairsEnabled = true;
  stickyEnabled = true;
  collisionDampingEnabled = true;
  /** Stick strength (0=no sticky pull, 1=fully glued). */
  stickStrength = 0.6;
  /** When ≥ 0, all bones whose name starts with `Cloth_` get their tail
   * position locked along this character-local axis (0=X, 1=Y, 2=Z). The
   * rest tail position captured at init defines the lock plane. With
   * 0 (X-axis lock), cloth chains can only swing forward/back + up/down —
   * pure pendulum motion in the character's YZ plane, no sideways drift. */
  forceClothLockAxisIdx = -1;

  /** Live per-bone diagnostics. Updated each `update()`. */
  diagStats = {
    bonesInContact: 0,
    maxSpeed: 0,
    avgSpeed: 0,
    worstBone: '',
    worstBoneSpeed: 0,
  };
  private _statsContactCount = 0;

  get plateCount(): number {
    return this._plates.length;
  }

  getPlateInfo(i: number): {
    boneName: string;
    width: number;
    height: number;
  } | null {
    const p = this._plates[i];
    if (!p) return null;
    const b = this._bones[p.boneIndex];
    return {
      boneName: b?.bone.name ?? '?',
      // halfW is in skel-local; expose as world meters by *(1/invScale)
      width: (p.halfWidth * 2) / this._invScale,
      height: (p.halfHeight * 2) / this._invScale,
    };
  }

  setPlateSize(i: number, width: number, height: number): void {
    const p = this._plates[i];
    if (!p) return;
    // Config values are in world meters → store skel-local.
    p.halfWidth = width * 0.5 * this._invScale;
    p.halfHeight = height * 0.5 * this._invScale;
  }

  /** Snapshot of current bone tail world positions and collider world
   * geometry for debug rendering. Pass the skinned mesh so bone positions
   * resolve through its world matrix (cloned-skeleton path returns
   * skeleton-local positions otherwise). */
  getDebugSnapshot(refMesh?: import('@babylonjs/core').AbstractMesh): {
    bones: { name: string; head: Vector3; tail: Vector3 }[];
    colliders: { name: string; a: Vector3; b: Vector3 | null; radius: number }[];
    plates: {
      name: string;
      center: Vector3;
      normal: Vector3;
      up: Vector3;
      right: Vector3;
      width: number;
      height: number;
      twoSided: boolean;
    }[];
  } {
    const bones = this._bones.map((s) => {
      const head =
        s.tn?.getAbsolutePosition().clone() ??
        (refMesh
          ? s.bone.getAbsolutePosition(refMesh).clone()
          : s.bone.getAbsolutePosition().clone());
      let tail = s.currentTailWorld.clone();
      if (!s.tn && refMesh) {
        tail = Vector3.TransformCoordinates(s.currentTailWorld, refMesh.getWorldMatrix());
      }
      return { name: s.bone.name, head, tail };
    });
    const colliders = this._colliders.map((c) => {
      c.tn?.computeWorldMatrix(true);
      const aRaw =
        c.tn?.getAbsolutePosition().clone() ??
        (refMesh
          ? c.bone.getAbsolutePosition(refMesh).clone()
          : c.bone.getAbsolutePosition().clone());
      let a = aRaw;
      let b: Vector3 | null = null;
      if (c.toBone) {
        c.toTn?.computeWorldMatrix(true);
        const bRaw =
          c.toTn?.getAbsolutePosition().clone() ??
          (refMesh
            ? c.toBone.getAbsolutePosition(refMesh).clone()
            : c.toBone.getAbsolutePosition().clone());
        // Apply tStart/tEnd trim so debug viz matches the actual collision segment.
        a = new Vector3(
          aRaw.x + (bRaw.x - aRaw.x) * c.tStart,
          aRaw.y + (bRaw.y - aRaw.y) * c.tStart,
          aRaw.z + (bRaw.z - aRaw.z) * c.tStart,
        );
        b = new Vector3(
          aRaw.x + (bRaw.x - aRaw.x) * c.tEnd,
          aRaw.y + (bRaw.y - aRaw.y) * c.tEnd,
          aRaw.z + (bRaw.z - aRaw.z) * c.tEnd,
        );
      }
      return { name: c.bone.name, a, b, radius: c.radius };
    });
    // Plates live on JIGGLE bones — center is the bone's tail position;
    // axes are rotated by the bone's parent (so plate orientation rotates
    // naturally with the cloth chain).
    let meshScale = 1;
    if (refMesh) {
      const sv = new Vector3();
      refMesh.getWorldMatrix().decompose(sv, undefined, undefined);
      meshScale = sv.x || 1;
    }
    const plates = this._plates.map((p) => {
      const s = this._bones[p.boneIndex];
      if (!s) {
        return {
          name: '?',
          center: Vector3.Zero(),
          normal: new Vector3(0, 0, 1),
          up: new Vector3(0, 1, 0),
          right: new Vector3(1, 0, 0),
          width: 0,
          height: 0,
          twoSided: false,
        };
      }
      // Compute plate frame in skel-local: center = bone tail, axes from parent rotation.
      s.parentTN?.computeWorldMatrix(true);
      const parentMat = s.parentTN?.getWorldMatrix() ?? s.parent.getWorldMatrix();
      const parentRot = new Quaternion();
      parentMat.decompose(undefined, parentRot, undefined);
      const normalLocal = new Vector3();
      const upLocal = new Vector3();
      const rightLocal = new Vector3();
      rotateVectorByQuat(parentRot, p.normal, normalLocal);
      rotateVectorByQuat(parentRot, p.up, upLocal);
      rotateVectorByQuat(parentRot, p.right, rightLocal);
      let center = s.currentTailWorld.clone();
      let normal = normalLocal,
        up = upLocal,
        right = rightLocal;
      if (!s.tn && refMesh) {
        const meshMat = refMesh.getWorldMatrix();
        center = Vector3.TransformCoordinates(center, meshMat);
        normal = Vector3.TransformNormal(normal, meshMat);
        up = Vector3.TransformNormal(up, meshMat);
        right = Vector3.TransformNormal(right, meshMat);
      }
      normal.normalize();
      up.normalize();
      right.normalize();
      return {
        name: s.bone.name,
        center,
        normal,
        up,
        right,
        // skel-local half-extents → world meters: *2*meshScale.
        width: p.halfWidth * 2 * meshScale,
        height: p.halfHeight * 2 * meshScale,
        twoSided: false,
      };
    });
    return { bones, colliders, plates };
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

  /** Lateral pair constraint pass. For each pair, soft-pull both tails
   * toward their initial rest distance so adjacent chains stay coherent
   * (no mesh stretch). Re-clamps to bone length around head, then rewrites
   * rotation for affected bones. Jacobi-style — reads positions then writes;
   * may take a few frames to converge but stable. */
  private _applyLateralPairs(): void {
    // Track bones whose tails moved so we can rewrite their rotation.
    const moved = new Set<number>();
    for (const lp of this._lateralPairs) {
      const a = this._bones[lp.a];
      const b = this._bones[lp.b];
      if (!a || !b) continue;
      const ax = a.currentTailWorld.x,
        ay = a.currentTailWorld.y,
        az = a.currentTailWorld.z;
      const bx = b.currentTailWorld.x,
        by = b.currentTailWorld.y,
        bz = b.currentTailWorld.z;
      const dx = bx - ax,
        dy = by - ay,
        dz = bz - az;
      const d2 = dx * dx + dy * dy + dz * dz;
      if (d2 < 1e-10) continue;
      const d = Math.sqrt(d2);
      // diff > 0 = pair is too far apart; diff < 0 = too close.
      const diff = (d - lp.restDist) / d;
      // Apply half correction to each side so total motion = full correction.
      const k = lp.stiffness * 0.5;
      const cx = dx * diff * k;
      const cy = dy * diff * k;
      const cz = dz * diff * k;
      a.currentTailWorld.set(ax + cx, ay + cy, az + cz);
      b.currentTailWorld.set(bx - cx, by - cy, bz - cz);
      moved.add(lp.a);
      moved.add(lp.b);
    }
    // Re-clamp to bone length around head and rewrite rotation for moved bones.
    for (const idx of moved) {
      const s = this._bones[idx];
      if (!s) continue;
      s.parentTN?.computeWorldMatrix(true);
      s.tn?.computeWorldMatrix(true);
      const head = s.tn?.getAbsolutePosition() ?? s.bone.getAbsolutePosition();
      const toTail = s.currentTailWorld.subtract(head);
      const dist = toTail.length();
      if (dist > 0.001) toTail.scaleInPlace(s.boneLength / dist);
      s.currentTailWorld.copyFrom(head.add(toTail));
      // Rewrite rotation: bone Y axis points along (tail - head).
      const dirWorld = toTail.scale(1 / Math.max(toTail.length(), 1e-6));
      const parentRot = new Quaternion();
      const parentMat = s.parentTN?.getWorldMatrix() ?? s.parent.getWorldMatrix();
      parentMat.decompose(undefined, parentRot, undefined);
      this._writeRotationForWorldDir(s, parentRot, dirWorld);
    }
  }

  /** Linear lookup of plate by bone index. Plate count is small (≤ N bones)
   * so linear scan is fine; could cache as Map<idx, PlateState> if needed. */
  private _findPlateForBone(boneIdx: number): PlateState | null {
    if (boneIdx < 0) return null;
    for (const p of this._plates) {
      if (p.boneIndex === boneIdx) return p;
    }
    return null;
  }

  private _step(s: BoneState, dt: number): void {
    s.parentTN?.computeWorldMatrix(true);
    s.tn?.computeWorldMatrix(true);

    const head = s.tn?.getAbsolutePosition() ?? s.bone.getAbsolutePosition();
    const parentRot = new Quaternion();
    const parentMat = s.parentTN?.getWorldMatrix() ?? s.parent.getWorldMatrix();
    parentMat.decompose(undefined, parentRot, undefined);

    // Detect anim transition / teleport: if head jumped > 3× bone length in
    // one frame the parent animation discontinuously moved (e.g. anim swap in
    // char select). Soft-reset to rest so the spring doesn't whip violently.
    const headJump = head.subtract(s.prevHead).length();
    s.prevHead.copyFrom(head);
    if (headJump > s.boneLength * 3) {
      this._resetBone(s);
      return;
    }

    const restDirWorld = new Vector3();
    this._computeRestDirWorld(s, parentRot, restDirWorld);
    const restTailWorld = head.add(restDirWorld.scale(s.boneLength));

    // ROOT-CAUSE FIX for the in-contact oscillation:
    // If the rest target is INSIDE a leg capsule, the spring keeps trying
    // to pull cloth into the leg every frame, feeding the feedback loop
    // (spring pulls in → collision pushes out → spring pulls in →…).
    // Project the rest target out of any colliding capsule first, so the
    // spring pulls toward the LEG SURFACE instead of the leg's interior.
    if (this.collidersEnabled) {
      for (const c of this._colliders) {
        c.tn?.computeWorldMatrix(true);
        const Araw = c.tn?.getAbsolutePosition() ?? c.bone.getAbsolutePosition();
        let cx: number, cy: number, cz: number;
        if (c.toBone) {
          c.toTn?.computeWorldMatrix(true);
          const Braw = c.toTn?.getAbsolutePosition() ?? c.toBone.getAbsolutePosition();
          const Ax = Araw.x + (Braw.x - Araw.x) * c.tStart;
          const Ay = Araw.y + (Braw.y - Araw.y) * c.tStart;
          const Az = Araw.z + (Braw.z - Araw.z) * c.tStart;
          const Bx = Araw.x + (Braw.x - Araw.x) * c.tEnd;
          const By = Araw.y + (Braw.y - Araw.y) * c.tEnd;
          const Bz = Araw.z + (Braw.z - Araw.z) * c.tEnd;
          const abx = Bx - Ax,
            aby = By - Ay,
            abz = Bz - Az;
          const apx = restTailWorld.x - Ax,
            apy = restTailWorld.y - Ay,
            apz = restTailWorld.z - Az;
          const ab2 = abx * abx + aby * aby + abz * abz;
          let t = ab2 > 1e-8 ? (apx * abx + apy * aby + apz * abz) / ab2 : 0;
          if (t < 0) t = 0;
          else if (t > 1) t = 1;
          cx = Ax + abx * t;
          cy = Ay + aby * t;
          cz = Az + abz * t;
        } else {
          cx = Araw.x;
          cy = Araw.y;
          cz = Araw.z;
        }
        const dx = restTailWorld.x - cx,
          dy = restTailWorld.y - cy,
          dz = restTailWorld.z - cz;
        const d2 = dx * dx + dy * dy + dz * dz;
        const rLocal = c.radius * this._invScale;
        if (d2 < rLocal * rLocal && d2 > 1e-8) {
          const d = Math.sqrt(d2);
          const push = rLocal / d;
          restTailWorld.set(cx + dx * push, cy + dy * push, cz + dz * push);
        }
      }
    }

    // Mass-spring-damper integration step (mass=1). dt is normalised to
    // 60 fps units (1.0 = one 60 fps frame) so coefficients are frame-rate independent.
    const velocity = s.currentTailWorld.subtract(s.prevTailWorld);
    // Cap spring "want-to-move" magnitude per frame so violent rest-target
    // movements don't spike the spring force. Threshold = bone length.
    const springDelta = restTailWorld.subtract(s.currentTailWorld);
    const springDeltaLen = springDelta.length();
    const maxSpringDelta = s.boneLength;
    if (springDeltaLen > maxSpringDelta) {
      springDelta.scaleInPlace(maxSpringDelta / springDeltaLen);
    }
    const springForce = springDelta.scale(s.stiffness * dt);
    const dampingForce = velocity.scale(-s.drag * dt);
    const accel = springForce.add(dampingForce);
    accel.y -= s.gravityPower * dt;
    // Cap velocity gain per frame to prevent runaway after big delta.
    const accelLen = accel.length();
    const maxAccel = s.boneLength * 0.5;
    if (accelLen > maxAccel) {
      accel.scaleInPlace(maxAccel / accelLen);
    }
    const newVel = velocity.add(accel);
    const next = s.currentTailWorld.add(newVel);

    // Length constraint: clamp tail to sphere of boneLength around head.
    // Stops unbounded drift under low drag + spring oscillation.
    const toTailRaw = next.subtract(head);
    const distRaw = toTailRaw.length();
    if (distRaw > 0.001) toTailRaw.scaleInPlace(s.boneLength / distRaw);
    next.copyFrom(head.add(toTailRaw));

    // Snapshot pre-collision tail so we can compute the cumulative collision
    // displacement at end of frame. We then offset prevTail by that amount,
    // so the next frame's velocity (= current - prev) doesn't include the
    // collision push as motion — preventing the "kick out with momentum"
    // bounce. Without this fix, every collision contact accelerates the
    // cloth violently as the push gets reinterpreted as velocity.
    const preColX = next.x;
    const preColY = next.y;
    const preColZ = next.z;

    // Collider resolution: push tail out of any sphere or capsule collider.
    // Capsules use closest-point-on-segment so cloth can't slip over the top
    // of a thigh sphere — important for tall legs.
    if (this.collidersEnabled)
      for (const c of this._colliders) {
        c.tn?.computeWorldMatrix(true);
        const Araw = c.tn?.getAbsolutePosition() ?? c.bone.getAbsolutePosition();
        let cx: number, cy: number, cz: number;
        if (c.toBone) {
          c.toTn?.computeWorldMatrix(true);
          const Braw = c.toTn?.getAbsolutePosition() ?? c.toBone.getAbsolutePosition();
          // Trim segment by tStart/tEnd before doing closest-point check.
          const Ax = Araw.x + (Braw.x - Araw.x) * c.tStart;
          const Ay = Araw.y + (Braw.y - Araw.y) * c.tStart;
          const Az = Araw.z + (Braw.z - Araw.z) * c.tStart;
          const Bx = Araw.x + (Braw.x - Araw.x) * c.tEnd;
          const By = Araw.y + (Braw.y - Araw.y) * c.tEnd;
          const Bz = Araw.z + (Braw.z - Araw.z) * c.tEnd;
          const abx = Bx - Ax,
            aby = By - Ay,
            abz = Bz - Az;
          const apx = next.x - Ax,
            apy = next.y - Ay,
            apz = next.z - Az;
          const ab2 = abx * abx + aby * aby + abz * abz;
          let t = ab2 > 1e-8 ? (apx * abx + apy * aby + apz * abz) / ab2 : 0;
          if (t < 0) t = 0;
          else if (t > 1) t = 1;
          cx = Ax + abx * t;
          cy = Ay + aby * t;
          cz = Az + abz * t;
        } else {
          cx = Araw.x;
          cy = Araw.y;
          cz = Araw.z;
        }
        const dx = next.x - cx,
          dy = next.y - cy,
          dz = next.z - cz;
        const d2 = dx * dx + dy * dy + dz * dz;
        // Convert world-meter radius into the skel-local units where physics
        // runs (multiplied by inverse fighter scale).
        const rLocal = c.radius * this._invScale;
        const r2 = rLocal * rLocal;
        if (d2 < r2 && d2 > 1e-8) {
          const d = Math.sqrt(d2);
          const push = rLocal / d;
          next.set(cx + dx * push, cy + dy * push, cz + dz * push);
          this._diagLogCollision(s.bone.name);
        }
      }

    // Cloth plate collision + STICKY binding. If THIS bone has a plate, sample
    // 4 corners + center; check each vs capsules. On contact:
    //   1. Push tail along plate normal (existing behavior — keeps cloth out
    //      of the leg this frame).
    //   2. Capture sticky state: which leg bone hit + offset in leg-local.
    // After plate logic, we apply sticky binding: blend tail toward the leg-
    // bone-anchored target with weight that decays when out of contact. This
    // makes cloth "ride" the leg during contact and release smoothly after.
    const plateForBone = this.platesEnabled ? this._findPlateForBone(this._bones.indexOf(s)) : null;
    let contactCollider: ColliderState | null = null;
    let contactDeepest = 0;
    if (plateForBone) {
      const plateNormalW = new Vector3();
      const plateUpW = new Vector3();
      const plateRightW = new Vector3();
      rotateVectorByQuat(parentRot, plateForBone.normal, plateNormalW);
      rotateVectorByQuat(parentRot, plateForBone.up, plateUpW);
      rotateVectorByQuat(parentRot, plateForBone.right, plateRightW);
      const halfW = plateForBone.halfWidth;
      const halfH = plateForBone.halfHeight;
      const samples: [number, number][] = [
        [0, 0],
        [halfW, halfH],
        [-halfW, halfH],
        [halfW, -halfH],
        [-halfW, -halfH],
      ];
      let maxPush = 0;
      for (const [u, v] of samples) {
        const sx = next.x + plateRightW.x * u + plateUpW.x * v;
        const sy = next.y + plateRightW.y * u + plateUpW.y * v;
        const sz = next.z + plateRightW.z * u + plateUpW.z * v;
        for (const c of this._colliders) {
          c.tn?.computeWorldMatrix(true);
          const Araw = c.tn?.getAbsolutePosition() ?? c.bone.getAbsolutePosition();
          let cx: number, cy: number, cz: number;
          if (c.toBone) {
            c.toTn?.computeWorldMatrix(true);
            const Braw = c.toTn?.getAbsolutePosition() ?? c.toBone.getAbsolutePosition();
            const Ax = Araw.x + (Braw.x - Araw.x) * c.tStart;
            const Ay = Araw.y + (Braw.y - Araw.y) * c.tStart;
            const Az = Araw.z + (Braw.z - Araw.z) * c.tStart;
            const Bx = Araw.x + (Braw.x - Araw.x) * c.tEnd;
            const By = Araw.y + (Braw.y - Araw.y) * c.tEnd;
            const Bz = Araw.z + (Braw.z - Araw.z) * c.tEnd;
            const abx = Bx - Ax,
              aby = By - Ay,
              abz = Bz - Az;
            const apx = sx - Ax,
              apy = sy - Ay,
              apz = sz - Az;
            const ab2 = abx * abx + aby * aby + abz * abz;
            let t = ab2 > 1e-8 ? (apx * abx + apy * aby + apz * abz) / ab2 : 0;
            if (t < 0) t = 0;
            else if (t > 1) t = 1;
            cx = Ax + abx * t;
            cy = Ay + aby * t;
            cz = Az + abz * t;
          } else {
            cx = Araw.x;
            cy = Araw.y;
            cz = Araw.z;
          }
          const dx = sx - cx,
            dy = sy - cy,
            dz = sz - cz;
          const d2 = dx * dx + dy * dy + dz * dz;
          const rLocal = c.radius * this._invScale;
          if (d2 < rLocal * rLocal && d2 > 1e-8) {
            const nProj = dx * plateNormalW.x + dy * plateNormalW.y + dz * plateNormalW.z;
            const d = Math.sqrt(d2);
            const penetration = rLocal - d;
            const dir = nProj >= 0 ? 1 : -1;
            const push = dir * penetration;
            if (Math.abs(push) > Math.abs(maxPush)) maxPush = push;
            // Track which collider had the deepest penetration — that's the
            // one we'll attach sticky to.
            if (penetration > contactDeepest) {
              contactDeepest = penetration;
              contactCollider = c;
            }
          }
        }
      }
      if (maxPush !== 0) {
        next.set(
          next.x + plateNormalW.x * maxPush,
          next.y + plateNormalW.y * maxPush,
          next.z + plateNormalW.z * maxPush,
        );
        this._diagLogCollision(s.bone.name);
      }
    }

    // STICKY binding update. Re-set sticky state on contact; decay otherwise.
    const STICK_STRENGTH = this.stickStrength;
    const STICK_DECAY = 0.7;
    if (this.stickyEnabled && contactCollider) {
      // Capture offset of current tail position in leg bone's local frame,
      // so the cloth bone "rides" the leg as it rotates/moves.
      contactCollider.tn?.computeWorldMatrix(true);
      const legPos =
        contactCollider.tn?.getAbsolutePosition() ?? contactCollider.bone.getAbsolutePosition();
      const legMat = contactCollider.tn?.getWorldMatrix() ?? contactCollider.bone.getWorldMatrix();
      // Build leg's world rotation.
      const legRot = new Quaternion();
      legMat.decompose(undefined, legRot, undefined);
      // Offset = (next - legPos) in leg-local space.
      const wx = next.x - legPos.x,
        wy = next.y - legPos.y,
        wz = next.z - legPos.z;
      const inv = Quaternion.Inverse(legRot);
      const localOffset = new Vector3();
      rotateVectorByQuat(inv, new Vector3(wx, wy, wz), localOffset);
      s.stickyBone = contactCollider.bone;
      s.stickyTn = contactCollider.tn;
      s.stickyOffsetLocal.copyFrom(localOffset);
      s.stickyWeight = 1.0;
    } else if (s.stickyWeight > 0) {
      s.stickyWeight *= STICK_DECAY;
      if (s.stickyWeight < 0.01) s.stickyWeight = 0;
    }
    // Apply sticky pin: blend tail toward the leg-anchored target.
    if (s.stickyWeight > 0 && s.stickyBone) {
      s.stickyTn?.computeWorldMatrix(true);
      const legPos = s.stickyTn?.getAbsolutePosition() ?? s.stickyBone.getAbsolutePosition();
      const legMat = s.stickyTn?.getWorldMatrix() ?? s.stickyBone.getWorldMatrix();
      const legRot = new Quaternion();
      legMat.decompose(undefined, legRot, undefined);
      const offsetWorld = new Vector3();
      rotateVectorByQuat(legRot, s.stickyOffsetLocal, offsetWorld);
      const targetX = legPos.x + offsetWorld.x;
      const targetY = legPos.y + offsetWorld.y;
      const targetZ = legPos.z + offsetWorld.z;
      const blend = s.stickyWeight * STICK_STRENGTH;
      next.set(
        next.x + (targetX - next.x) * blend,
        next.y + (targetY - next.y) * blend,
        next.z + (targetZ - next.z) * blend,
      );
    }
    // Re-clamp to length after push-out so bone stays rigid
    const reTail = next.subtract(head);
    const reDist = reTail.length();
    if (reDist > 0.001) reTail.scaleInPlace(s.boneLength / reDist);
    next.copyFrom(head.add(reTail));

    // Pendulum constraint: lock the chosen axis directly in physics-space
    // (skeleton-local for cloned skeletons). Skeleton-local tracks character
    // motion automatically — the skeleton frame moves with the character,
    // so a fixed X coord here means "same X relative to character".
    // Effective lock = per-bone config OR runtime force-lock for cloth.
    let effectiveLockAxis = s.lockAxisIdx;
    if (this.forceClothLockAxisIdx >= 0 && s.bone.name.startsWith('Cloth_')) {
      effectiveLockAxis = this.forceClothLockAxisIdx;
    }
    if (effectiveLockAxis >= 0) {
      if (effectiveLockAxis === 0) next.x = s.restTailLocalChar.x;
      else if (effectiveLockAxis === 1) next.y = s.restTailLocalChar.y;
      else next.z = s.restTailLocalChar.z;
      const lTail = next.subtract(head);
      const lDist = lTail.length();
      if (lDist > 0.001) lTail.scaleInPlace(s.boneLength / lDist);
      next.copyFrom(head.add(lTail));
    }

    // Verlet save with COLLISION DAMPING. If any constraint pushed `next`
    // (capsule, plate, sticky), we halve the velocity carried to the next
    // frame. This dissipates the energy fed by the spring constantly pulling
    // toward a rest position inside the leg — without it, paused-animation
    // cloth shakes forever as spring force vs collision push exchange energy
    // each frame with no dissipation.
    const colPushX = next.x - preColX;
    const colPushY = next.y - preColY;
    const colPushZ = next.z - preColZ;
    const collisionPushMag2 = colPushX * colPushX + colPushY * colPushY + colPushZ * colPushZ;
    const inContact = collisionPushMag2 > 1e-10;
    if (inContact) this._statsContactCount++;
    // Zero velocity on contact (dampFactor 0): no inertia carried into the
    // next frame's integration. Combined with the rest-target projection
    // above, this stops the in-contact oscillation entirely — cloth settles
    // on the leg surface within ~1 frame instead of jittering forever.
    const dampFactor = inContact && this.collisionDampingEnabled ? 0.0 : 1.0;
    // velocity_next = next - prev_new. Want it = dampFactor * (next - current_old).
    // → prev_new = next - dampFactor * (next - current_old)
    //            = current_old + (1 - dampFactor) * (next - current_old)
    s.prevTailWorld.x = s.currentTailWorld.x + (1 - dampFactor) * (next.x - s.currentTailWorld.x);
    s.prevTailWorld.y = s.currentTailWorld.y + (1 - dampFactor) * (next.y - s.currentTailWorld.y);
    s.prevTailWorld.z = s.currentTailWorld.z + (1 - dampFactor) * (next.z - s.currentTailWorld.z);
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
