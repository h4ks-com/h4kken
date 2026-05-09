// ============================================================
// H4KKEN — Arena registry
// ============================================================

import { Color3 } from '@babylonjs/core';

export type ArenaBounds =
  | { kind: 'circle'; radius: number }
  | { kind: 'rect'; halfWidth: number; halfDepth: number };

export interface SkyColors {
  top: Color3;
  horiz: Color3;
  bottom: Color3;
}

export interface ArenaScenery {
  /** Path to GLB, relative to public/. Omit for default scenery. */
  glb?: string;
  /** Uniform scale applied to imported root. */
  scale?: number;
  /** Offset applied to imported root after scale. */
  position?: { x: number; y: number; z: number };
  /** Y rotation (radians) for visual orientation. */
  rotationY?: number;
}

export interface ArenaConfig {
  id: string;
  name: string;
  scenery: ArenaScenery;
  /** Default trees + mountains backdrop. Off by default for non-default arenas. */
  showDefaultBackdrop?: boolean;
  /** Pillars with flame lights at the four cardinal points around the ring. */
  showPillars?: boolean;
  /** Sky dome. Off when the arena GLB has its own enclosing walls. */
  showSky?: boolean;
  /** Override sky gradient colours. Falls back to default cyan if omitted. */
  skyColors?: SkyColors;
  /** Linear fog tuning. Set start to a large value to effectively disable. */
  fog?: { start: number; end: number; color: Color3 };
  /** True for sceneries that look natural only from one side (dojo with a back
   * wall). The camera stays locked to the initial angle instead of orbiting
   * with fighter rotation so the audience never sees the unfinished back. */
  linear?: boolean;
  /** Skip the default sand platform / fight disk / ring / outer ring / ground.
   * Use when the arena GLB provides its own visible floor. */
  hideDefaultFloor?: boolean;
  /** Solid scene clear colour. Used when the sky dome is disabled. */
  clearColor?: Color3;
  /** Fighter movement constraint. Falls back to the default radial clamp
   * (radius 12) when omitted. */
  bounds?: ArenaBounds;
}

export const DEFAULT_ARENA_ID = 'default';

export const ARENAS: Record<string, ArenaConfig> = {
  default: {
    id: 'default',
    name: 'Mountain Field',
    scenery: {},
    showDefaultBackdrop: true,
    showPillars: true,
    showSky: true,
  },
  dojo: {
    id: 'dojo',
    name: 'Dojo',
    scenery: {
      glb: 'assets/arenas/dojo.glb',
      scale: 2.300,
      position: { x: 0.00, y: -0.69, z: 0.50 },
      rotationY: 3.150,
    },
    showDefaultBackdrop: false,
    showPillars: false,
    showSky: false,
    fog: { start: 60, end: 120, color: new Color3(0.18, 0.14, 0.10) },
    linear: true,
    hideDefaultFloor: true,
    clearColor: new Color3(0.06, 0.04, 0.03),
    bounds: { kind: 'rect', halfWidth: 8.0, halfDepth: 5.0 },
  },
  colosseum: {
    id: 'colosseum',
    name: 'Colosseum',
    scenery: {
      glb: 'assets/arenas/colosseum.glb',
      scale: 5.000,
      position: { x: 0.00, y: -0.09, z: 0.00 },
    },
    showDefaultBackdrop: false,
    showPillars: false,
    showSky: true,
    skyColors: {
      top: new Color3(0.35, 0.6, 0.85),
      horiz: new Color3(0.95, 0.78, 0.55),
      bottom: new Color3(0.45, 0.35, 0.25),
    },
    fog: { start: 60, end: 140, color: new Color3(0.95, 0.78, 0.55) },
    hideDefaultFloor: true,
    bounds: { kind: 'circle', radius: 18.0 },
  },
  temple: {
    id: 'temple',
    name: 'Sunrise Temple',
    scenery: {
      glb: 'assets/arenas/temple.glb',
      scale: 1.980,
      position: { x: -2.00, y: -3.15, z: 29.10 },
      rotationY: 3.142,
    },
    showDefaultBackdrop: false,
    showPillars: false,
    showSky: true,
    skyColors: {
      top: new Color3(0.28, 0.32, 0.55),
      horiz: new Color3(0.95, 0.55, 0.35),
      bottom: new Color3(0.30, 0.20, 0.18),
    },
    fog: { start: 50, end: 110, color: new Color3(0.6, 0.4, 0.35) },
    linear: true,
    hideDefaultFloor: true,
    bounds: { kind: 'rect', halfWidth: 10.85, halfDepth: 7.90 },
  },
  hell: {
    id: 'hell',
    name: 'Hell Arena',
    scenery: {
      glb: 'assets/arenas/hell.glb',
      scale: 16.660,
      position: { x: 0.00, y: -0.10, z: 0.00 },
    },
    showDefaultBackdrop: false,
    showPillars: false,
    showSky: true,
    skyColors: {
      // Near-black night with a cold violet tint at zenith
      top: new Color3(0.02, 0.01, 0.05),
      // Burning horizon — deep molten orange-red
      horiz: new Color3(0.60, 0.10, 0.02),
      // Dark crimson at the ground line
      bottom: new Color3(0.18, 0.03, 0.01),
    },
    fog: { start: 20, end: 60, color: new Color3(0.28, 0.05, 0.02) },
    hideDefaultFloor: true,
    clearColor: new Color3(0.04, 0.01, 0.01),
    bounds: { kind: 'circle', radius: 9.20 },
  },
};

/** Pickable arenas in display order — used by character-select. */
export const ARENA_ORDER: readonly string[] = [
  'default',
  'dojo',
  'colosseum',
  'temple',
  'hell',
];

export function getArenaConfig(id: string | undefined): ArenaConfig {
  if (id && ARENAS[id]) return ARENAS[id];
  return ARENAS[DEFAULT_ARENA_ID]!;
}
