# H4KKEN

A Tekken-inspired 3D browser fighting game built with Babylon.js and WebSockets/WebRTC.

## Features

- **3D Fighting** — Full 3D arena with punches, kicks, combos, juggling, and throws
- **Dynamic Camera** — Camera orbits to always follow the fight axis between players
- **Online Multiplayer** — Real-time matches via WebSocket + WebRTC DataChannel (UDP)
- **GGPO Rollback Netcode** — Deterministic simulation with rollback for smooth online play
- **Practice Mode** — Solo practice against a bot opponent
- **Sidestepping** — Full 3D movement with sidestep mechanics
- **Self-hosted TURN** — Optional coturn relay for players behind strict NAT
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
cp .env.example .env   # optional — only needed for TURN relay
bun run dev
```

Open http://localhost:3000

## Production

```bash
bun run build
bun dist/server.js
```

See [docs/deployment-guide.md](docs/deployment-guide.md) for full production setup (nginx, TLS, coturn, systemd/PM2).

## Docker

```bash
docker compose up --build
```

## Dev

```bash
bun run fix   # auto-format, lint, typecheck, dead-code check — run before committing
```

Pre-commit hooks are installed automatically by `bun install` (via the `prepare` script). Every commit runs `bun run fix` and is blocked if anything fails.

## Tech Stack

- **Engine**: Babylon.js 8 (WebGPU preferred, WebGL fallback)
- **Backend**: Bun, Express, WebSocket (`ws`)
- **Transport**: WebSocket (TCP) + WebRTC DataChannel (UDP, unordered)
- **Netcode**: GGPO-style rollback with deterministic simulation
- **Assets**: FBX character model and animations (AnimPack01)
- **Build**: Vite + TypeScript
- **Lint / Format**: Biome (strict), knip (dead-code)

## Documentation

| Document | Description |
|----------|-------------|
| [Architecture Analysis](docs/architecture-analysis.md) | Codebase deep-dive — modules, data flow, diagrams |
| [WebRTC Migration](docs/webrtc-migration.md) | TCP → UDP transport layer design and implementation |
| [TURN Setup](docs/turn-setup.md) | Self-hosted coturn relay configuration |
| [Deployment Guide](docs/deployment-guide.md) | Full production setup (nginx, TLS, systemd, PM2, Docker) |
| [Proposed Improvements](docs/proposed-improvements.md) | Roadmap and improvement status tracker |
| [References](docs/references.md) | Academic references cited in docs (with DOIs) |

## Environment Variables

Copy `.env.example` to `.env` and fill in values. The server works without any env vars — TURN is optional.

See [docs/deployment-guide.md §2](docs/deployment-guide.md) for the full variable reference.

## License

MIT
