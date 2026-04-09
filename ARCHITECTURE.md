# H4KKEN Architecture

## Stack

- **Runtime / package manager**: Bun
- **Bundler**: Vite
- **Renderer**: Babylon.js 8 (left-handed coordinate system, Y-up)
- **Language**: TypeScript (`strict: true`, `noUncheckedIndexedAccess: true`, no `any`)
- **Lint / format / typecheck**: `bun run fix` (biome → tsc → tsc server → knip), stops on first failure

---

## Coordinate system

Babylon.js is **left-handed, Y-up**. Do not set `scene.useRightHandedSystem`.

```
Camera at Z = -10, looking toward +Z.
+X = screen RIGHT   -X = screen LEFT
+Y = up             -Y = down
```

Player 0 spawns at X = -3 (screen left), Player 1 at X = +3 (screen right).

---

## Source files

| File | Responsibility |
|------|----------------|
| `main.ts` | Entry point — creates `Game`, calls `game.init()` |
| `Game.ts` | Game loop, state machine (LOADING → MENU → FIGHTING …), round logic, post-processing |
| `Fighter.ts` | Character: asset loading, mesh cloning, skeleton, animation, physics, state machine |
| `Stage.ts` | Arena geometry, lighting, shadow generator, sky shader |
| `Camera.ts` | Orbiting fight camera — stays perpendicular to the fight axis on the -Z side |
| `Combat.ts` | Move data, hitbox resolution, combo system, constants |
| `Input.ts` | Keyboard input, double-tap detection |
| `Network.ts` | WebSocket matchmaking and state sync |
| `UI.ts` | DOM HUD (health bars, timer, announcements) |

---

## GLB / character pipeline

### Asset file
`public/assets/models/character.glb` — Quaternius Universal Animation Library (CC0).  
Contains: `Armature` root, `Mannequin` mesh, `Icosphere` mesh, 46 named animation groups.

### Loading (one-time, shared)
`Fighter.loadAssets(scene)` uses `SceneLoader.ImportMeshAsync` from `@babylonjs/loaders/glTF` (registered via side-effect import at the top of `Fighter.ts`).

Returns `SharedAssets`:
```ts
interface SharedAssets {
  baseMeshes: AbstractMesh[];   // meshes with geometry, disabled
  baseSkeleton: Skeleton | null;
  animGroups: Record<string, AnimationGroup>; // keyed by game name (ANIM_MAP)
}
```

All base meshes are immediately disabled (`setEnabled(false)`) — they are never rendered directly.

### Per-fighter init
`fighter.init(assets)`:
1. Creates a `TransformNode` as the positional root.
2. Clones each base mesh → parents to root node.
3. Clones the skeleton → reassigns to cloned meshes.
4. Calls `_cloneAnimGroups` → clones every animation group, remapping bone targets to the cloned skeleton.
5. Sets initial Y rotation via `_makeRootQuat(rotY)`.

Player 1 gets a red tint by cloning and modifying `PBRMaterial.albedoColor`.

### Animation mapping
`ANIM_MAP` in `Fighter.ts` maps game state names → GLB animation names.  
`LOOP_ANIMS` lists which ones loop. Everything else plays once.

```ts
const ANIM_MAP = {
  idle: 'Idle_Loop',
  walk: 'Walk_Loop',
  punch1: 'Punch_Jab',
  // …
};
```

To add a new animation: add an entry to `ANIM_MAP`, add to `LOOP_ANIMS` if it loops, then call `playAnimation('yourName')`.

### Facing / rotation
The Quaternius mannequin natively faces **+Z**.  
Facing angle is the world-space direction toward the opponent (from `Math.atan2`).

```ts
targetRotY = Math.PI / 2 + facingAngle;
```

This rotates the +Z-facing model to point in `facingAngle` direction.

---

## Lighting & shadows

Defined in `Stage.setupLighting()`:
- `HemisphericLight` — low intensity (0.25), **no specular** (`Color3.Black()`). Specular on hemisphere = plastic look.
- `DirectionalLight` — sun, drives the `ShadowGenerator`.
- `ShadowGenerator` — 2048 map, PCF filtering (`usePercentageCloserFiltering`).

Arena floors use `PBRMaterial` (roughness ~0.9, metallic 0).  
Background geometry (trees, mountains, pillars) uses `StandardMaterial` with `specularColor = Color3.Black()`.

Fighter meshes are registered as shadow casters in `Game.createFighters()` via `stage.shadowGenerator`.

Post-processing in `Game.ts`:
- `DefaultRenderingPipeline` — bloom.
- `ImageProcessingConfiguration` — ACES tone mapping, contrast 1.2.

---

## Game loop

Fixed timestep at 60 Hz via accumulator in `Game._gameLoop()`:
1. Accumulate `engine.getDeltaTime()`.
2. While accumulator ≥ tick duration: run one logic tick (input → `processInput` → `updatePhysics` → collision → combat).
3. Every frame: `updateVisuals()` on each fighter, `Stage.update()` (flame flicker), `fightCamera.update()`.

---

## Multiplayer

Player 0 is authoritative. Each frame Player 0 sends its full game state to Player 1 via the server (`Network`). Player 1 applies received state via `fighter.deserializeState()`. Both players send their local input every tick.
