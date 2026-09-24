# Cat Battle Royale

A 2D multiplayer top-down battle royale browser game built in TypeScript.

Three cats battle on an island with solid cover using waterguns. Survivors collect Dreamies to automatically upgrade their weapons while avoiding a shrinking cat tornado. Eliminated players spectate as ghosts until an immediate rematch.

## Core Game Loop & Rules

- **Island Arena**: Bounded circular island surrounded by ocean, with solid cover obstacles (rocks and crates) blocking movement and watergun pellets.
- **Players**: Exactly 3 players per match. Each cat starts with 4 HP.
- **Controls**:
  - Movement: Arrow keys or `WASD`
  - Aim: Mouse cursor
  - Fire: `Space` (or mouse click)
  - Reload: `R` (or automatic when magazine is empty)
- **Watergun Combat**:
  - Deals 1 damage per pellet. 4 hits eliminate a full-health cat.
  - Friendly-fire immunity (pellets never damage the shooter).
  - Maximum rate of fire: 4 shots/second.
- **Dreamies & Upgrades**:
  - Collectible treats scattered across the island.
  - Automatic upgrades at **5** and **12** Dreamies:
    - **Tier 0** (Starter): 4 capacity, 2.0s reload
    - **Tier 1** (5 Dreamies): 6 capacity, 1.5s reload
    - **Tier 2** (12 Dreamies): 8 capacity, 1.0s reload
  - Eliminated cats drop all unspent Dreamies at their death location as a drop pile for survivors to collect.
- **Cat Tornado**:
  - Shrinking safe zone begins closing after 30 seconds and fully closes by 3 minutes.
  - 2-second grace period outside the eye.
  - Escalating exposure damage: 1 damage every 2 seconds, increasing to 1 damage every 1 second after 6 seconds of continuous exposure.
  - Returning inside the safe eye immediately resets exposure.
- **Match Lifecycle**:
  - Match starts automatically when 3 players connect.
  - Eliminated cats become free-roaming ghost spectators.
  - Simultaneous final deaths resolve deterministically as a Draw.
  - Disconnect grace window of 10 seconds allows reconnection before elimination.
  - Rematches reset all players, weapons, health, storm, and collectibles cleanly.

## Architecture

```text
src/
├── shared/         # Shared schemas, constants, geometry helpers, and types
│   ├── constants.ts
│   ├── geom.ts
│   └── types.ts
├── server/         # Authoritative simulation and Socket.IO networking
│   ├── game/
│   │   └── simulation.ts
│   ├── rooms/
│   │   └── room.ts
│   └── index.ts
└── client/         # Browser rendering, input capture, and HUD
    └── main.ts
```

- **Authoritative Server**: Node.js + Express + Socket.IO runs the deterministic simulation at 30 Hz and broadcasts snapshots at 15 Hz. Client inputs are validated intents; positions and damage are never client-authoritative.
- **Client**: Vite + Canvas2D + Socket.IO client interpolating state updates with real-time HUD and controls.

## Development & Commands

- **Install dependencies**:
  ```bash
  npm install
  ```
- **Start development server (watches and runs backend)**:
  ```bash
  npm run dev:server
  ```
- **Start Vite client development server**:
  ```bash
  npm run dev:client
  ```
- **Run all tests (Vitest deterministic rule suite)**:
  ```bash
  npm run test
  ```
- **Run typecheck and tests**:
  ```bash
  npm run check
  ```
- **Build production client and server**:
  ```bash
  npm run build
  ```
- **Run production server**:
  ```bash
  npm run start
  ```
