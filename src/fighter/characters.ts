// ============================================================
// H4KKEN - Runtime character metadata
// ============================================================
// Per-character runtime knobs applied on top of the uniformly-built
// <id>.glb assets from scripts/characters.ts. Keep build-time inputs
// (FBX ingestion) separate from presentation/gameplay tweaks (scale,
// display name, thumbnails, future character-select metadata).

import type { AnimKey } from './animations';
import type { JiggleBoneConfig } from './JiggleSim';

/** Emit a symmetric L/R pair from a single config — `{S}` in the bone name
 * template is replaced with `L` then `R`. Avoids duplicating identical sim
 * params across both sides. */
const sym = (nameTemplate: string, cfg: Omit<JiggleBoneConfig, 'name'>): JiggleBoneConfig[] => [
  { ...cfg, name: nameTemplate.replace('{S}', 'L') },
  { ...cfg, name: nameTemplate.replace('{S}', 'R') },
];

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
  /** Spring-bone secondary motion configs. Only characters with dedicated jiggle bones in their GLB. */
  jiggleBones?: readonly JiggleBoneConfig[];
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
    jiggleBones: [
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
  handyc: {
    id: 'handyc',
    name: 'Handyc',
    // GLB has armature scale=0.01; scale=0.85 gives ~85% of beano's height (intentionally small).
    scale: 0.0085,
  },
  hanna: {
    id: 'hanna',
    name: 'Hanna',
    // export_mesh.py bakes the rest pose → armature scale=1.0, same as beano/mita.
    scale: 1.7,
    glowEmissive: true,
  },
};

export const DEFAULT_P1 = 'beano';
export const DEFAULT_P2 = 'mita';
