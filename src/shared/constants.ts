// Shared game constants, maps, and tuning parameters

export const SERVER_TICK_RATE = 60; // 60 Hz simulation for ultra-smooth responsiveness
export const SERVER_TICK_DT = 1 / SERVER_TICK_RATE; // ~0.0166s
export const SNAPSHOT_RATE = 30; // 30 Hz network snapshots
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
export const PLAYER_RADIUS = 22;
export const BASE_PLAYER_SPEED = 210; // pixels per second
export const CATNIP_SPEED_MULTIPLIER = 1.45; // 45% speed boost from catnip
export const CATNIP_DURATION_SECONDS = 5.0;
export const PLAYER_MAX_HP = 4;
export const DISCONNECT_GRACE_SECONDS = 10.0;

// Combat & Weapon tiers
export const PELLET_SPEED = 650; // pixels per second
export const PELLET_RADIUS = 5;
export const PELLET_DAMAGE = 1;
export const PELLET_MAX_LIFETIME = 2.0; // seconds
export const MAX_FIRE_RATE = 5; // max 5 shots per second
export const FIRE_COOLDOWN = 1 / MAX_FIRE_RATE; // 0.20s

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

// Collectibles & Upgrades
export type CollectibleType = 'dreamies' | 'catnip' | 'tuna';

export const DREAMIES_UPGRADE_TIER_1 = 5;
export const DREAMIES_UPGRADE_TIER_2 = 12;
export const COLLECTIBLE_RADIUS = 14;

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

export type MapId = 'atoll' | 'temple' | 'jungle';

export interface MapConfig {
  id: MapId;
  name: string;
  description: string;
  groundColor: string;
  beachColor: string;
  obstacleColor: string;
  obstacles: ObstacleRect[];
}

export const MAPS: Record<MapId, MapConfig> = {
  atoll: {
    id: 'atoll',
    name: 'Tropical Atoll',
    description: 'Classic sandy island with rugged sea rocks and scattered supply crates.',
    groundColor: '#4ade80',
    beachColor: '#fde68a',
    obstacleColor: '#78716c',
    obstacles: [
      { id: 'rock-nw', x: 420, y: 420, width: 80, height: 80 },
      { id: 'rock-ne', x: 780, y: 420, width: 80, height: 80 },
      { id: 'rock-sw', x: 420, y: 780, width: 80, height: 80 },
      { id: 'rock-se', x: 780, y: 780, width: 80, height: 80 },
      { id: 'barrier-n', x: 600, y: 350, width: 120, height: 35 },
      { id: 'barrier-s', x: 600, y: 850, width: 120, height: 35 },
      { id: 'crate-c1', x: 530, y: 600, width: 45, height: 45 },
      { id: 'crate-c2', x: 670, y: 600, width: 45, height: 45 },
    ],
  },
  temple: {
    id: 'temple',
    name: 'Temple of Bastet',
    description: 'Ancient stone temple ruins with colossal pillars and ceremonial altar.',
    groundColor: '#e0cda7',
    beachColor: '#d4b483',
    obstacleColor: '#60584c',
    obstacles: [
      { id: 'pillar-1', x: 480, y: 450, width: 60, height: 60 },
      { id: 'pillar-2', x: 720, y: 450, width: 60, height: 60 },
      { id: 'pillar-3', x: 480, y: 750, width: 60, height: 60 },
      { id: 'pillar-4', x: 720, y: 750, width: 60, height: 60 },
      { id: 'altar-center', x: 600, y: 600, width: 90, height: 90 },
      { id: 'wall-west', x: 370, y: 600, width: 40, height: 160 },
      { id: 'wall-east', x: 830, y: 600, width: 40, height: 160 },
    ],
  },
  jungle: {
    id: 'jungle',
    name: 'Catnip Jungle',
    description: 'Overgrown dense grove with winding thickets and wooden palisades.',
    groundColor: '#22c55e',
    beachColor: '#a7f3d0',
    obstacleColor: '#854d0e',
    obstacles: [
      { id: 'thicket-n', x: 600, y: 420, width: 160, height: 50 },
      { id: 'thicket-s', x: 600, y: 780, width: 160, height: 50 },
      { id: 'logs-w', x: 440, y: 600, width: 50, height: 140 },
      { id: 'logs-e', x: 760, y: 600, width: 50, height: 140 },
      { id: 'shrine-nw', x: 460, y: 460, width: 50, height: 50 },
      { id: 'shrine-se', x: 740, y: 740, width: 50, height: 50 },
    ],
  },
};

export const DEFAULT_OBSTACLES = MAPS.atoll.obstacles;
