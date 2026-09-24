// Shared game constants and tuning parameters

export const SERVER_TICK_RATE = 30; // 30 Hz simulation
export const SERVER_TICK_DT = 1 / SERVER_TICK_RATE; // ~0.0333s
export const SNAPSHOT_RATE = 15; // 15 Hz network snapshots
export const SNAPSHOT_INTERVAL_TICKS = Math.round(SERVER_TICK_RATE / SNAPSHOT_RATE); // every 2 ticks

// Map & Arena geometry
export const MAP_WIDTH = 1200;
export const MAP_HEIGHT = 1200;
export const ISLAND_CENTER_X = 600;
export const ISLAND_CENTER_Y = 600;
export const ISLAND_RADIUS = 500;

// Player settings
export const REQUIRED_PLAYERS = 3;
export const MAX_PLAYERS = 3;
export const PLAYER_RADIUS = 20;
export const PLAYER_SPEED = 200; // pixels per second
export const PLAYER_MAX_HP = 4;
export const DISCONNECT_GRACE_SECONDS = 10.0;

// Combat & Weapon tiers
export const PELLET_SPEED = 600; // pixels per second
export const PELLET_RADIUS = 5;
export const PELLET_DAMAGE = 1;
export const PELLET_MAX_LIFETIME = 2.0; // seconds
export const MAX_FIRE_RATE = 4; // max shots per second
export const FIRE_COOLDOWN = 1 / MAX_FIRE_RATE; // 0.25s

export interface WeaponTierConfig {
  tier: number;
  magCapacity: number;
  reloadSeconds: number;
}

export const WEAPON_TIERS: WeaponTierConfig[] = [
  { tier: 0, magCapacity: 4, reloadSeconds: 2.0 },
  { tier: 1, magCapacity: 6, reloadSeconds: 1.5 },
  { tier: 2, magCapacity: 8, reloadSeconds: 1.0 },
];

// Dreamies & Upgrades
export const DREAMIES_UPGRADE_TIER_1 = 5;
export const DREAMIES_UPGRADE_TIER_2 = 12;
export const COLLECTIBLE_RADIUS = 12;
export const COLLECTIBLE_RESPAWN_COUNT = 15;

// Storm / Tornado
export const STORM_SHRINK_START_SECONDS = 30;
export const STORM_SHRINK_END_SECONDS = 180; // 3 minutes
export const STORM_INITIAL_RADIUS = 500;
export const STORM_FINAL_RADIUS = 0;
export const STORM_GRACE_SECONDS = 2.0;
export const STORM_STAGE1_INTERVAL = 2.0; // 1 damage every 2s
export const STORM_STAGE2_THRESHOLD = 6.0; // after 6s continuous exposure
export const STORM_STAGE2_INTERVAL = 1.0; // 1 damage every 1s

// Cover obstacles (solid rectangles)
export interface ObstacleRect {
  id: string;
  x: number; // center x
  y: number; // center y
  width: number;
  height: number;
}

export const DEFAULT_OBSTACLES: ObstacleRect[] = [
  { id: 'rock-nw', x: 420, y: 420, width: 80, height: 80 },
  { id: 'rock-ne', x: 780, y: 420, width: 80, height: 80 },
  { id: 'rock-sw', x: 420, y: 780, width: 80, height: 80 },
  { id: 'rock-se', x: 780, y: 780, width: 80, height: 80 },
  { id: 'barrier-n', x: 600, y: 350, width: 120, height: 40 },
  { id: 'barrier-s', x: 600, y: 850, width: 120, height: 40 },
  { id: 'crate-c1', x: 530, y: 600, width: 50, height: 50 },
  { id: 'crate-c2', x: 670, y: 600, width: 50, height: 50 },
];
