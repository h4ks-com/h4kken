// ============================================================
// H4KKEN — Arena registry
// ============================================================

import { Color3, Vector3 } from '@babylonjs/core';

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
  /** X rotation in radians (pitch). */
  rotationX?: number;
  /** Y rotation in radians (yaw). */
  rotationY?: number;
  /** Z rotation in radians (roll). */
  rotationZ?: number;
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
  /** Extra point lights for enclosed/indoor arenas that the directional sun can't reach. */
  indoorLights?: Array<{
    position: { x: number; y: number; z: number };
    intensity: number;
    range: number;
    color?: Color3;
  }>;
  /** Override sun direction (normalized). Default is (-0.6, -1.0, -0.5). */
  sunDirection?: Vector3;
  /** Extra camera pitch in radians. Positive = higher angle looking down. */
  cameraPitch?: number;
  /** Multiplier on ambient light intensity. Default 1.0. */
  ambientBoost?: number;
  /** Multiplier on sun light intensity. Default 1.0. */
  sunBoost?: number;
}

export const DEFAULT_ARENA_ID = 'default';

export const ARENAS: Record<string, ArenaConfig> = {
  default: {
    id: 'default',
    name: 'Mountain Field',
    scenery: {
      glb: 'assets/arenas/default.glb',
      scale: 1.443,
      position: { x: 0.0, y: -0.25, z: 0.0 },
    },
    showDefaultBackdrop: false,
    showPillars: false,
    showSky: true,
    hideDefaultFloor: true,
    bounds: { kind: 'circle', radius: 10.0 },
  },
  japan_street: {
    id: 'japan_street',
    name: 'Japan Street',
    scenery: {
      glb: 'assets/arenas/japan_street.glb',
      scale: Math.LOG2E,
      position: { x: -5.3, y: 0.0, z: -7.6 },
      rotationY: 1.571,
    },
    showDefaultBackdrop: false,
    showPillars: false,
    showSky: true,
    hideDefaultFloor: true,
    linear: true,
    fog: { start: 30, end: 80, color: new Color3(0.6, 0.75, 0.9) },
    bounds: { kind: 'rect', halfWidth: 9.8, halfDepth: 3.7 },
    sunDirection: new Vector3(0.5, -1.0, 0.6).normalize(),
    cameraPitch: (20 * Math.PI) / 180,
    ambientBoost: 2.0,
    sunBoost: 1.5,
  },
  warehouse: {
    id: 'warehouse',
    name: 'Warehouse',
    scenery: {
      glb: 'assets/arenas/warehouse.glb',
      scale: 2.05,
      position: { x: -17.0, y: 0.0, z: -75.79 },
      rotationY: Math.PI,
    },
    showDefaultBackdrop: false,
    showPillars: false,
    showSky: false,
    hideDefaultFloor: true,
    linear: true,
    clearColor: new Color3(0.05, 0.05, 0.06),
    fog: { start: 20, end: 60, color: new Color3(0.05, 0.05, 0.06) },
    bounds: { kind: 'rect', halfWidth: 13.5, halfDepth: 13.45 },
    indoorLights: [
      {
        position: { x: -8, y: 8, z: -3 },
        intensity: 80.0,
        range: 80,
        color: new Color3(1.0, 0.92, 0.78),
      },
      {
        position: { x: 8, y: 8, z: -3 },
        intensity: 80.0,
        range: 80,
        color: new Color3(1.0, 0.92, 0.78),
      },
      {
        position: { x: -8, y: 8, z: 7 },
        intensity: 80.0,
        range: 80,
        color: new Color3(1.0, 0.92, 0.78),
      },
      {
        position: { x: 8, y: 8, z: 7 },
        intensity: 80.0,
        range: 80,
        color: new Color3(1.0, 0.92, 0.78),
      },
      {
        position: { x: -8, y: 8, z: 17 },
        intensity: 80.0,
        range: 80,
        color: new Color3(1.0, 0.92, 0.78),
      },
      {
        position: { x: 8, y: 8, z: 17 },
        intensity: 80.0,
        range: 80,
        color: new Color3(1.0, 0.92, 0.78),
      },
    ],
  },
  colosseum: {
    id: 'colosseum',
    name: 'Colosseum',
    scenery: {
      glb: 'assets/arenas/colosseum.glb',
      scale: 5.0,
      position: { x: 0.0, y: -0.09, z: 0.0 },
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
      scale: 1.98,
      position: { x: -2.0, y: -3.15, z: 29.1 },
      rotationY: Math.PI,
    },
    showDefaultBackdrop: false,
    showPillars: false,
    showSky: true,
    skyColors: {
      top: new Color3(0.28, 0.32, 0.55),
      horiz: new Color3(0.95, 0.55, 0.35),
      bottom: new Color3(0.3, 0.2, 0.18),
    },
    fog: { start: 50, end: 110, color: new Color3(0.6, 0.4, 0.35) },
    linear: true,
    hideDefaultFloor: true,
    bounds: { kind: 'rect', halfWidth: 10.85, halfDepth: 7.9 },
  },
  hell: {
    id: 'hell',
    name: 'Hell Arena',
    scenery: {
      glb: 'assets/arenas/hell.glb',
      scale: 16.66,
      position: { x: 0.0, y: -0.1, z: 0.0 },
    },
    showDefaultBackdrop: false,
    showPillars: false,
    showSky: true,
    skyColors: {
      // Near-black night with a cold violet tint at zenith
      top: new Color3(0.02, 0.01, 0.05),
      // Burning horizon — deep molten orange-red
      horiz: new Color3(0.6, 0.1, 0.02),
      // Dark crimson at the ground line
      bottom: new Color3(0.18, 0.03, 0.01),
    },
    fog: { start: 20, end: 60, color: new Color3(0.28, 0.05, 0.02) },
    hideDefaultFloor: true,
    clearColor: new Color3(0.04, 0.01, 0.01),
    bounds: { kind: 'circle', radius: 9.2 },
  },
};

/** Pickable arenas in display order — used by character-select. */
export const ARENA_ORDER: readonly string[] = [
  'default',
  'japan_street',
  'warehouse',
  'colosseum',
  'temple',
  'hell',
];

export function getArenaConfig(id: string | undefined): ArenaConfig {
  if (id && ARENAS[id]) return ARENAS[id];
  return ARENAS[DEFAULT_ARENA_ID] as ArenaConfig;
}
