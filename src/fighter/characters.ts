// ============================================================
// H4KKEN - Runtime character metadata
// ============================================================
// Per-character runtime knobs applied on top of the uniformly-built
// <id>.glb assets from scripts/characters.ts. Keep build-time inputs
// (FBX ingestion) separate from presentation/gameplay tweaks (scale,
// display name, thumbnails, future character-select metadata).

import type { AnimKey } from './animations';
import type { JiggleBoneConfig } from './JiggleSim';

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
      { name: 'Breast_Jiggle_L', stiffness: 0.7, drag: 0.4, gravityPower: 0.0005 },
      { name: 'Breast_Jiggle_R', stiffness: 0.7, drag: 0.4, gravityPower: 0.0005 },
    ],
  },
  handyc: {
    id: 'handyc',
    name: 'Handyc',
    scale: 0.0085,
  },
};

export const DEFAULT_P1 = 'beano';
export const DEFAULT_P2 = 'mita';
