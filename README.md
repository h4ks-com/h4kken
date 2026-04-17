# H4KKEN

A Tekken-inspired 3D browser fighting game built with Babylon.js and WebSockets/WebRTC.

## Features

- **3D Fighting** — Full 3D arena with punches, kicks, combos, juggling, and throws
- **Dynamic Camera** — Camera orbits to always follow the fight axis between players
- **Online Multiplayer** — Real-time matches via WebSocket + WebRTC DataChannel (UDP)
- **GGPO Rollback Netcode** — Deterministic simulation with rollback for smooth online play
- **Practice Mode** — Solo practice against a bot opponent
- **Sidestepping** — Full 3D movement with sidestep mechanics
- **Network Debug HUD** — Press `F3` in-game to see real-time ping, jitter, and rollback stats

## Controls

| Action | Key |
|---|---|
| Move Left / Right | `A` / `D` |
| Jump | `W` |
| Crouch | `S` |
| Light Punch | `U` |
| Heavy Punch | `I` |
| Light Kick | `J` |
| Heavy Kick | `K` |
| Sidestep | `Shift` + `W` / `S` |
| Dash Back | Double-tap `Back` |

## Quick Start

```bash
bun install
cp .env.example .env   # optional — only needed for coturn relay
bun run dev
```

Open http://localhost:3000

## Production

```bash
bun run build
bun dist/server.js
```

TURN is optional. When configured, the server issues ephemeral coturn credentials; when not configured, the game stays on STUN/WebSocket fallback.

## Docker

```bash
docker compose up --build
```

## Dev

```bash
bun run fix   # auto-format, lint, typecheck, dead-code check — run before committing
```

Pre-commit hooks are installed automatically by `bun install` (via the `prepare` script). Every commit runs `bun run fix` and is blocked if anything fails.

## Testing

```bash
bun run tests/net-sim/run-sim.ts
```

The headless network simulation is a local regression harness for rollback, prediction, determinism, and synthetic lag/loss profiles. It is useful before browser or deployment tests, but it does not validate TURN, ICE, or real cross-network WebRTC behavior.

## Tech Stack

- **Engine**: Babylon.js 8 (WebGPU preferred, WebGL fallback)
- **Backend**: Bun, Express, WebSocket (`ws`)
- **Transport**: WebSocket (TCP) + WebRTC DataChannel (UDP, unordered)
- **Netcode**: GGPO-style rollback with deterministic simulation
- **Assets**: FBX character model and animations (AnimPack01)
- **Build**: Vite + TypeScript
- **Lint / Format**: Biome (strict), knip (dead-code)

## Architecture

See [ARCHITECTURE.md](ARCHITECTURE.md) for the current codebase layout, networking model, and operational notes.

## Environment Variables

Copy `.env.example` to `.env` and fill in values. The server works without any env vars — TURN is optional.

## License

MIT
