# H4KKEN

A Tekken-inspired 3D browser fighting game built with Three.js and WebSockets.

## Features

- **3D Fighting** — Full 3D arena with punches, kicks, combos, juggling, and throws
- **Dynamic Camera** — Camera orbits to always follow the fight axis between players
- **Online Multiplayer** — Real-time matches via WebSocket with matchmaking
- **Practice Mode** — Solo practice against a bot opponent
- **Sidestepping** — Full 3D movement with sidestep mechanics

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
npm install
npm start
```

Open http://localhost:3000

## Docker

```bash
docker compose up --build
```

## Tech Stack

- **Frontend**: Three.js (3D), vanilla JS modules
- **Backend**: Node.js, Express, WebSocket (`ws`)
- **Assets**: FBX character model and animations (AnimPack01)

## License

MIT
