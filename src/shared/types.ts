// Shared type definitions

import { CollectibleType, MapId, ObstacleRect } from './constants.js';

export type PlayerStatus = 'alive' | 'ghost' | 'disconnected';
export type RoomPhase = 'lobby' | 'playing' | 'finished';

export interface PlayerState {
  id: string;
  name: string;
  slot: number; // 0, 1, 2
  status: PlayerStatus;
  ready: boolean;
  mapVote: MapId;
  x: number;
  y: number;
  aimAngle: number;
  hp: number;
  maxHp: number;
  ammo: number;
  maxAmmo: number;
  tier: number; // 0, 1, 2
  dreamies: number;
  isReloading: boolean;
  reloadProgress: number; // 0 to 1
  stormExposureSeconds: number;
  speedBoostSeconds: number;
}

export interface PelletState {
  id: string;
  shooterId: string;
  x: number;
  y: number;
  vx: number;
  vy: number;
}

export interface CollectibleState {
  id: string;
  x: number;
  y: number;
  type: CollectibleType;
  value: number;
  isDeathDrop: boolean;
}

export interface StormState {
  centerX: number;
  centerY: number;
  currentRadius: number;
  phase: 'waiting' | 'shrinking' | 'closed';
  timeUntilShrink: number;
}

export interface RoomSnapshot {
  tick: number;
  serverTime: number;
  phase: RoomPhase;
  mapId: MapId;
  mapVotes: Record<MapId, number>;
  players: PlayerState[];
  pellets: PelletState[];
  collectibles: CollectibleState[];
  storm: StormState;
  winnerSlot: number | null; // 0, 1, 2, or null
  winnerName: string | null; // player name, 'Draw', or null
  isDraw: boolean;
  rematchVotes: number;
  requiredVotes: number;
}

export interface PlayerInput {
  seq: number;
  moveX: number; // -1 to 1
  moveY: number; // -1 to 1
  aimAngle: number; // radians
  fire: boolean;
  reload: boolean;
}

export interface JoinRoomPayload {
  roomCode: string;
  playerName: string;
  reconnectToken?: string;
  preferredMap?: MapId;
}

export interface JoinRoomSuccess {
  playerId: string;
  reconnectToken: string;
  roomCode: string;
  slot: number;
  mapId: MapId;
  obstacles: ObstacleRect[];
}

export interface ErrorPayload {
  message: string;
  code?: string;
}
