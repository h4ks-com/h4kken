// ============================================================
// H4KKEN - Runtime character metadata
// ============================================================
// Per-character runtime knobs applied on top of the uniformly-built
// <id>.glb assets from scripts/characters.ts. Keep build-time inputs
// (FBX ingestion) separate from presentation/gameplay tweaks (scale,
// display name, thumbnails, future character-select metadata).

import type { AnimKey } from './animations';
import type { JiggleBoneConfig, JiggleConfig, JigglePlateColliderConfig } from './JiggleSim';

/** Emit a symmetric L/R pair from a single config — `{S}` in the bone name
 * template is replaced with `L` then `R`. Avoids duplicating identical sim
 * params across both sides. */
const sym = (nameTemplate: string, cfg: Omit<JiggleBoneConfig, 'name'>): JiggleBoneConfig[] => [
  { ...cfg, name: nameTemplate.replace('{S}', 'L') },
  { ...cfg, name: nameTemplate.replace('{S}', 'R') },
];

/** Expand a single chain prefix into N JiggleBoneConfigs named `{prefix}_1` …
 * `{prefix}_N`. Optional gradient interpolates stiffness/drag between the
 * root (i=1) and tip (i=N), giving a natural "stiff at top, floppy at end"
 * feel without writing per-bone configs. */
interface ChainGradient {
  tipStiffness?: number;
  tipDrag?: number;
  tipParentFollow?: number;
}

const chain = (
  prefix: string,
  count: number,
  base: Omit<JiggleBoneConfig, 'name'>,
  gradient?: ChainGradient,
): JiggleBoneConfig[] => {
  const out: JiggleBoneConfig[] = [];
  for (let i = 1; i <= count; i++) {
    const t = count > 1 ? (i - 1) / (count - 1) : 0;
    const cfg: JiggleBoneConfig = { ...base, name: `${prefix}_${i}` };
    if (gradient?.tipStiffness !== undefined && base.stiffness !== undefined) {
      cfg.stiffness = base.stiffness + (gradient.tipStiffness - base.stiffness) * t;
    }
    if (gradient?.tipDrag !== undefined && base.drag !== undefined) {
      cfg.drag = base.drag + (gradient.tipDrag - base.drag) * t;
    }
    if (gradient?.tipParentFollow !== undefined && base.parentFollow !== undefined) {
      cfg.parentFollow = base.parentFollow + (gradient.tipParentFollow - base.parentFollow) * t;
    }
    out.push(cfg);
  }
  return out;
};

/** Expand multiple chain prefixes (sharing the same params) into a flat
 * array of JiggleBoneConfigs. Useful for cloth panels with N parallel chains. */
const chains = (
  prefixes: readonly string[],
  count: number,
  base: Omit<JiggleBoneConfig, 'name'>,
  gradient?: ChainGradient,
): JiggleBoneConfig[] => prefixes.flatMap((p) => chain(p, count, base, gradient));

/** Generate small cloth plates for every bone in N chains. Each plate gives
 * its bone surface area for collision detection vs capsule colliders. The
 * plate's normal is the cloth surface's "outward" direction in bone-local
 * space. Default normal `[0, 0, 1]` works for chains whose bone-local +Z
 * axis points away from the body at rest. */
const chainPlates = (
  prefixes: readonly string[],
  count: number,
  opts: { width: number; height: number; normal?: readonly [number, number, number] },
): JigglePlateColliderConfig[] => {
  const out: JigglePlateColliderConfig[] = [];
  for (const prefix of prefixes) {
    for (let i = 1; i <= count; i++) {
      out.push({
        bone: `${prefix}_${i}`,
        width: opts.width,
        height: opts.height,
        normal: opts.normal,
      });
    }
  }
  return out;
};

interface CharacterMeta {
  /** Must match a build entry id → public/assets/models/<id>.glb */
  id: string;
  /** Display name for UI */
  name: string;
  /** Uniform scale applied to the fighter's root node at runtime */
  scale?: number;
  /** Path to a UI thumbnail (future character-select screen) */
  thumbnail?: string;
  /** Animation cycle shown in the character selection screen */
  selectAnims?: readonly AnimKey[];
  /** Unified jiggle/cloth simulation config — bones, colliders (sphere/capsule
   * + plate), lateral pairs. Single source of truth, plumbed through
   * SharedAssets → Fighter/CharSelect/debug-page → JiggleSim. */
  jiggle?: JiggleConfig;
  /** If true, meshes with emissive material will be registered with the scene GlowLayer. */
  glowEmissive?: boolean;
}

export const CHARACTERS: Record<string, CharacterMeta> = {
  beano: {
    id: 'beano',
    name: 'Beano',
    scale: 1.0,
  },
  mita: {
    id: 'mita',
    name: 'Mita',
    scale: 0.85,
    selectAnims: ['introSpellIdle', 'victoryYes'],
    jiggle: {
      bones: [
        ...sym('Breast_Jiggle_{S}', {
          stiffness: 0.9,
          drag: 0.3,
          gravityPower: 0.01,
          parentFollow: 0.5,
        }),
        ...sym('Hair_Jiggle_1.{S}', {
          stiffness: 0.6,
          drag: 0.5,
          gravityPower: 0.005,
          parentFollow: 0.7,
        }),
        ...sym('Hair_Jiggle_2.{S}', {
          stiffness: 0.4,
          drag: 0.3,
          gravityPower: 0.005,
          parentFollow: 0.7,
        }),
        ...sym('Hair_Jiggle_3.{S}', {
          stiffness: 0.4,
          drag: 0.3,
          gravityPower: 0.005,
          parentFollow: 0.7,
        }),
      ],
    },
  },
  handyc: {
    id: 'handyc',
    name: 'Handyc',
    // GLB has armature scale=0.01; scale=0.85 gives ~85% of beano's height (intentionally small).
    scale: 0.0085,
  },
  hanna: {
    id: 'hanna',
    name: 'Hanna',
    scale: 1.7,
    glowEmissive: true,
  },
  liu: {
    id: 'liu',
    name: 'Liu',
    scale: 1.85,
    jiggle: {
      bones: [
        ...sym('Breast_Jiggle_{S}', {
          stiffness: 0.8,
          drag: 0.3,
          gravityPower: 0.01,
          parentFollow: 0.5,
        }),
        ...sym('Hair_Jiggle_1.{S}', {
          stiffness: 0.6,
          drag: 0.5,
          gravityPower: 0.005,
          parentFollow: 0.7,
        }),
        ...sym('Hair_Jiggle_2.{S}', {
          stiffness: 0.5,
          drag: 0.4,
          gravityPower: 0.005,
          parentFollow: 0.7,
        }),
        ...sym('Hair_Jiggle_3.{S}', {
          stiffness: 0.4,
          drag: 0.3,
          gravityPower: 0.005,
          parentFollow: 0.7,
        }),
        ...sym('Hair_Jiggle_4.{S}', {
          stiffness: 0.3,
          drag: 0.3,
          gravityPower: 0.005,
          parentFollow: 0.7,
        }),
        ...chains(
          [
            'Cloth_Front_L',
            'Cloth_Front_C',
            'Cloth_Front_R',
            'Cloth_Back_L',
            'Cloth_Back_C',
            'Cloth_Back_R',
          ],
          5,
          {
            stiffness: 1.0,
            drag: 0.6,
            gravityPower: 0.003,
            parentFollow: 1.0,
          },
          { tipStiffness: 0.15, tipDrag: 0.25, tipParentFollow: 0.4 },
        ),
      ],
      colliders: [
        { bone: 'mixamorig:LeftUpLeg', toBone: 'mixamorig:LeftLeg', radius: 0.055, tStart: 0.5 },
        { bone: 'mixamorig:LeftLeg', toBone: 'mixamorig:LeftFoot', radius: 0.14 },
        { bone: 'mixamorig:RightUpLeg', toBone: 'mixamorig:RightLeg', radius: 0.055, tStart: 0.5 },
        { bone: 'mixamorig:RightLeg', toBone: 'mixamorig:RightFoot', radius: 0.14 },
      ],
      // Plate height oversized vs bone segment (~0.062m) so consecutive
      // plates along a chain overlap → no vertical gap for legs to slip through.
      plateColliders: [
        ...chainPlates(['Cloth_Front_L', 'Cloth_Front_C', 'Cloth_Front_R'], 5, {
          width: 0.085,
          height: 0.10,
          normal: [0, 0, 1],
        }),
        ...chainPlates(['Cloth_Back_L', 'Cloth_Back_C', 'Cloth_Back_R'], 5, {
          width: 0.105,
          height: 0.09,
          normal: [0, 0, -1],
        }),
      ],
      lateralPairs: [
        { chainA: 'Cloth_Front_L', chainB: 'Cloth_Front_C', count: 5, stiffness: 0.15 },
        { chainA: 'Cloth_Front_C', chainB: 'Cloth_Front_R', count: 5, stiffness: 0.15 },
        { chainA: 'Cloth_Back_L', chainB: 'Cloth_Back_C', count: 5, stiffness: 0.15 },
        { chainA: 'Cloth_Back_C', chainB: 'Cloth_Back_R', count: 5, stiffness: 0.15 },
      ],
    },
  },
};

export const DEFAULT_P1 = 'beano';
export const DEFAULT_P2 = 'mita';
