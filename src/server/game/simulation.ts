// Authoritative, deterministic game simulation engine

import {
  COLLECTIBLE_RADIUS,
  DEFAULT_OBSTACLES,
  DISCONNECT_GRACE_SECONDS,
  DREAMIES_UPGRADE_TIER_1,
  DREAMIES_UPGRADE_TIER_2,
  FIRE_COOLDOWN,
  ISLAND_CENTER_X,
  ISLAND_CENTER_Y,
  ISLAND_RADIUS,
  MAX_PLAYERS,
  ObstacleRect,
  PELLET_DAMAGE,
  PELLET_MAX_LIFETIME,
  PELLET_SPEED,
  PLAYER_MAX_HP,
  PLAYER_RADIUS,
  PLAYER_SPEED,
  STORM_FINAL_RADIUS,
  STORM_GRACE_SECONDS,
  STORM_INITIAL_RADIUS,
  STORM_SHRINK_END_SECONDS,
  STORM_SHRINK_START_SECONDS,
  STORM_STAGE1_INTERVAL,
  STORM_STAGE2_INTERVAL,
  STORM_STAGE2_THRESHOLD,
  WEAPON_TIERS,
} from '../../shared/constants.js';
import {
  clamp,
  clampToIsland,
  distance,
  normalizeVector,
  Point,
  resolveCircleObstacle,
  segmentIntersectsBox,
  segmentIntersectsCircle,
} from '../../shared/geom.js';
import {
  CollectibleState,
  PelletState,
  PlayerInput,
  PlayerState,
  RoomPhase,
  RoomSnapshot,
  StormState,
} from '../../shared/types.js';

export interface InternalPlayer extends PlayerState {
  fireCooldown: number;
  reloadTimeRemaining: number;
  disconnectSeconds: number;
  lastStormDamageTime: number; // exposure time when last storm damage tick occurred
  reconnectToken: string;
}

export interface InternalPellet extends PelletState {
  lifetime: number;
}

export class GameSimulation {
  public tickCount = 0;
  public elapsedTime = 0;
  public phase: RoomPhase = 'lobby';
  public stormTimer = 0;
  public obstacles: ObstacleRect[] = [...DEFAULT_OBSTACLES];
  public players: Map<string, InternalPlayer> = new Map();
  public pellets: InternalPellet[] = [];
  public collectibles: CollectibleState[] = [];
  public winnerSlot: number | null = null;
  public winnerName: string | null = null;
  public isDraw = false;
  public rematchVotes: Set<string> = new Set();
  private nextPelletId = 1;
  private nextCollectibleId = 1;

  constructor() {
    this.resetCollectibles();
  }

  // Pre-determined symmetric spawn points for 3 players
  public static getSpawnPoint(slot: number): Point {
    const angle = -Math.PI / 2 + (slot * 2 * Math.PI) / 3; // 120 deg apart, slot 0 at top
    const radius = 320;
    return {
      x: ISLAND_CENTER_X + Math.cos(angle) * radius,
      y: ISLAND_CENTER_Y + Math.sin(angle) * radius,
    };
  }

  public resetCollectibles(): void {
    this.collectibles = [];
    // Place standard Dreamies around the island
    const standardPositions: Point[] = [
      { x: 600, y: 480 },
      { x: 600, y: 720 },
      { x: 480, y: 600 },
      { x: 720, y: 600 },
      { x: 500, y: 500 },
      { x: 700, y: 500 },
      { x: 500, y: 700 },
      { x: 700, y: 700 },
      { x: 600, y: 220 },
      { x: 600, y: 980 },
      { x: 220, y: 600 },
      { x: 980, y: 600 },
      { x: 380, y: 320 },
      { x: 820, y: 320 },
      { x: 600, y: 600 }, // center
    ];

    for (const pos of standardPositions) {
      this.collectibles.push({
        id: `c-${this.nextCollectibleId++}`,
        x: pos.x,
        y: pos.y,
        value: 1,
        isDeathDrop: false,
      });
    }
  }

  public addPlayer(id: string, name: string, reconnectToken: string): InternalPlayer | null {
    if (this.players.size >= MAX_PLAYERS) {
      return null;
    }

    const slot = this.players.size;
    const spawn = GameSimulation.getSpawnPoint(slot);
    const starterTier = WEAPON_TIERS[0];

    const player: InternalPlayer = {
      id,
      name,
      slot,
      status: 'alive',
      x: spawn.x,
      y: spawn.y,
      aimAngle: 0,
      hp: PLAYER_MAX_HP,
      maxHp: PLAYER_MAX_HP,
      ammo: starterTier.magCapacity,
      maxAmmo: starterTier.magCapacity,
      tier: 0,
      dreamies: 0,
      isReloading: false,
      reloadProgress: 0,
      stormExposureSeconds: 0,
      fireCooldown: 0,
      reloadTimeRemaining: 0,
      disconnectSeconds: 0,
      lastStormDamageTime: 0,
      reconnectToken,
    };

    this.players.set(id, player);

    // Auto-start game if exactly 3 players join
    if (this.players.size === MAX_PLAYERS && this.phase === 'lobby') {
      this.phase = 'playing';
      this.stormTimer = 0;
    }

    return player;
  }

  public markDisconnected(id: string): void {
    const player = this.players.get(id);
    if (!player) return;
    if (player.status === 'alive') {
      player.status = 'disconnected';
      player.disconnectSeconds = 0;
    }
  }

  public reconnectPlayer(id: string, newToken: string): boolean {
    const player = this.players.get(id);
    if (!player) return false;
    if (player.status === 'disconnected') {
      player.status = 'alive';
      player.disconnectSeconds = 0;
      player.reconnectToken = newToken;
      return true;
    }
    return true;
  }

  public voteRematch(id: string): void {
    if (this.phase !== 'finished') return;
    this.rematchVotes.add(id);

    // If all current players voted, restart
    if (this.rematchVotes.size >= this.players.size && this.players.size >= 1) {
      this.startRematch();
    }
  }

  public startRematch(): void {
    this.phase = 'playing';
    this.stormTimer = 0;
    this.pellets = [];
    this.winnerSlot = null;
    this.winnerName = null;
    this.isDraw = false;
    this.rematchVotes.clear();
    this.resetCollectibles();

    for (const player of this.players.values()) {
      const spawn = GameSimulation.getSpawnPoint(player.slot);
      const starterTier = WEAPON_TIERS[0];
      player.x = spawn.x;
      player.y = spawn.y;
      player.status = 'alive';
      player.hp = PLAYER_MAX_HP;
      player.tier = 0;
      player.ammo = starterTier.magCapacity;
      player.maxAmmo = starterTier.magCapacity;
      player.dreamies = 0;
      player.isReloading = false;
      player.reloadProgress = 0;
      player.reloadTimeRemaining = 0;
      player.fireCooldown = 0;
      player.stormExposureSeconds = 0;
      player.lastStormDamageTime = 0;
      player.disconnectSeconds = 0;
    }
  }

  public getStormState(): StormState {
    let currentRadius: number;
    let phase: 'waiting' | 'shrinking' | 'closed';
    let timeUntilShrink = 0;

    if (this.stormTimer < STORM_SHRINK_START_SECONDS) {
      currentRadius = STORM_INITIAL_RADIUS;
      phase = 'waiting';
      timeUntilShrink = STORM_SHRINK_START_SECONDS - this.stormTimer;
    } else if (this.stormTimer < STORM_SHRINK_END_SECONDS) {
      const progress =
        (this.stormTimer - STORM_SHRINK_START_SECONDS) /
        (STORM_SHRINK_END_SECONDS - STORM_SHRINK_START_SECONDS);
      currentRadius =
        STORM_INITIAL_RADIUS + progress * (STORM_FINAL_RADIUS - STORM_INITIAL_RADIUS);
      phase = 'shrinking';
    } else {
      currentRadius = STORM_FINAL_RADIUS;
      phase = 'closed';
    }

    return {
      centerX: ISLAND_CENTER_X,
      centerY: ISLAND_CENTER_Y,
      currentRadius: Math.max(0, currentRadius),
      phase,
      timeUntilShrink: Math.max(0, timeUntilShrink),
    };
  }

  // Deterministic single simulation tick
  public step(dt: number, inputs: Map<string, PlayerInput>): void {
    this.tickCount++;
    this.elapsedTime += dt;

    if (this.phase === 'playing') {
      this.stormTimer += dt;
    }

    // 1. Advance disconnected players timers
    for (const player of this.players.values()) {
      if (player.status === 'disconnected') {
        player.disconnectSeconds += dt;
        if (player.disconnectSeconds >= DISCONNECT_GRACE_SECONDS) {
          // Eliminate disconnected player
          player.status = 'ghost';
          player.hp = 0;
          this.dropDeathLoot(player);
        }
      }
    }

    if (this.phase !== 'playing') {
      return;
    }

    // 2. Process player movement & aim
    for (const [id, player] of this.players.entries()) {
      const input = inputs.get(id);

      if (input && Number.isFinite(input.aimAngle)) {
        player.aimAngle = input.aimAngle;
      }

      if (input && (player.status === 'alive' || player.status === 'ghost')) {
        let moveX = clamp(input.moveX || 0, -1, 1);
        let moveY = clamp(input.moveY || 0, -1, 1);
        const norm = normalizeVector(moveX, moveY);

        if (norm.x !== 0 || norm.y !== 0) {
          let newX = player.x + norm.x * PLAYER_SPEED * dt;
          let newY = player.y + norm.y * PLAYER_SPEED * dt;

          if (player.status === 'alive') {
            // Collide with solid rectangular cover
            for (const obs of this.obstacles) {
              const resolved = resolveCircleObstacle(newX, newY, PLAYER_RADIUS, obs);
              newX = resolved.x;
              newY = resolved.y;
            }
            // Collide with circular island bounds
            const bounded = clampToIsland(
              newX,
              newY,
              PLAYER_RADIUS,
              ISLAND_CENTER_X,
              ISLAND_CENTER_Y,
              ISLAND_RADIUS
            );
            newX = bounded.x;
            newY = bounded.y;
          } else {
            // Ghost roaming bounded by map area
            newX = clamp(newX, PLAYER_RADIUS, 1200 - PLAYER_RADIUS);
            newY = clamp(newY, PLAYER_RADIUS, 1200 - PLAYER_RADIUS);
          }

          player.x = newX;
          player.y = newY;
        }
      }
    }

    // 3. Process weapons, reloads, and firing
    for (const [id, player] of this.players.entries()) {
      if (player.status !== 'alive') continue;

      const input = inputs.get(id);
      const tierConfig = WEAPON_TIERS[player.tier];

      // Update reload timer
      if (player.isReloading) {
        player.reloadTimeRemaining -= dt;
        player.reloadProgress = 1 - Math.max(0, player.reloadTimeRemaining / tierConfig.reloadSeconds);
        if (player.reloadTimeRemaining <= 0) {
          player.isReloading = false;
          player.reloadProgress = 0;
          player.reloadTimeRemaining = 0;
          player.ammo = player.maxAmmo;
        }
      }

      // Decrement fire cooldown
      if (player.fireCooldown > 0) {
        player.fireCooldown = Math.max(0, player.fireCooldown - dt);
      }

      // Check manual reload request
      if (input?.reload && !player.isReloading && player.ammo < player.maxAmmo) {
        player.isReloading = true;
        player.reloadTimeRemaining = tierConfig.reloadSeconds;
        player.reloadProgress = 0;
      }

      // Check firing
      if (input?.fire && !player.isReloading && player.fireCooldown <= 0 && player.ammo > 0) {
        // Fire pellet
        player.ammo--;
        player.fireCooldown = FIRE_COOLDOWN;

        const spawnDist = PLAYER_RADIUS + 6;
        const spawnX = player.x + Math.cos(player.aimAngle) * spawnDist;
        const spawnY = player.y + Math.sin(player.aimAngle) * spawnDist;

        this.pellets.push({
          id: `p-${this.nextPelletId++}`,
          shooterId: player.id,
          x: spawnX,
          y: spawnY,
          vx: Math.cos(player.aimAngle) * PELLET_SPEED,
          vy: Math.sin(player.aimAngle) * PELLET_SPEED,
          lifetime: 0,
        });

        // Auto reload when magazine empty
        if (player.ammo === 0) {
          player.isReloading = true;
          player.reloadTimeRemaining = tierConfig.reloadSeconds;
          player.reloadProgress = 0;
        }
      }
    }

    // 4. Update Pellets & Collisions
    const damageEvents: { targetId: string; amount: number }[] = [];
    const remainingPellets: InternalPellet[] = [];

    for (const pellet of this.pellets) {
      pellet.lifetime += dt;
      if (pellet.lifetime >= PELLET_MAX_LIFETIME) {
        continue; // Expired
      }

      const p1: Point = { x: pellet.x, y: pellet.y };
      const p2: Point = { x: pellet.x + pellet.vx * dt, y: pellet.y + pellet.vy * dt };

      // Find earliest hit against obstacles or living cats
      let earliestT = 1.0;
      let hitTargetId: string | null = null;
      let hitObstacle = false;

      // Check solid obstacles
      for (const obs of this.obstacles) {
        const t = segmentIntersectsBox(p1, p2, obs);
        if (t !== null && t < earliestT) {
          earliestT = t;
          hitObstacle = true;
          hitTargetId = null;
        }
      }

      // Check living players (except shooter)
      for (const target of this.players.values()) {
        if (target.status !== 'alive' || target.id === pellet.shooterId) continue;
        const t = segmentIntersectsCircle(p1, p2, { x: target.x, y: target.y }, PLAYER_RADIUS);
        if (t !== null && t < earliestT) {
          earliestT = t;
          hitTargetId = target.id;
          hitObstacle = false;
        }
      }

      if (hitTargetId) {
        damageEvents.push({ targetId: hitTargetId, amount: PELLET_DAMAGE });
      } else if (!hitObstacle) {
        // Keep pellet alive if within island range
        pellet.x = p2.x;
        pellet.y = p2.y;
        if (distance(pellet.x, pellet.y, ISLAND_CENTER_X, ISLAND_CENTER_Y) <= ISLAND_RADIUS + 50) {
          remainingPellets.push(pellet);
        }
      }
    }
    this.pellets = remainingPellets;

    // 5. Collectibles & Upgrades
    const remainingCollectibles: CollectibleState[] = [];
    for (const item of this.collectibles) {
      // Find living player closest to collectible within pickup radius
      let pickedUpBy: InternalPlayer | null = null;
      let minDistance = Number.POSITIVE_INFINITY;

      for (const player of this.players.values()) {
        if (player.status !== 'alive') continue;
        const d = distance(player.x, player.y, item.x, item.y);
        if (d <= PLAYER_RADIUS + COLLECTIBLE_RADIUS) {
          if (d < minDistance || (d === minDistance && (!pickedUpBy || player.slot < pickedUpBy.slot))) {
            minDistance = d;
            pickedUpBy = player;
          }
        }
      }

      if (pickedUpBy) {
        pickedUpBy.dreamies += item.value;
        // Re-evaluate weapon tier
        this.updatePlayerTier(pickedUpBy);
      } else {
        remainingCollectibles.push(item);
      }
    }
    this.collectibles = remainingCollectibles;

    // 6. Storm / Tornado exposure and damage
    const storm = this.getStormState();
    for (const player of this.players.values()) {
      if (player.status !== 'alive') continue;

      const distFromCenter = distance(player.x, player.y, storm.centerX, storm.centerY);
      const isOutside = distFromCenter > storm.currentRadius;

      if (isOutside) {
        player.stormExposureSeconds += dt;
        const exposure = player.stormExposureSeconds;

        if (exposure >= STORM_GRACE_SECONDS) {
          let interval = STORM_STAGE1_INTERVAL;

          if (exposure >= STORM_STAGE2_THRESHOLD) {
            interval = STORM_STAGE2_INTERVAL;
          }

          // Trigger damage at interval crossings
          if (player.lastStormDamageTime === 0) {
            // First hit after grace
            damageEvents.push({ targetId: player.id, amount: 1 });
            player.lastStormDamageTime = exposure;
          } else if (exposure - player.lastStormDamageTime >= interval) {
            damageEvents.push({ targetId: player.id, amount: 1 });
            player.lastStormDamageTime = exposure;
          }
        }
      } else {
        // Reset exposure when safely inside
        player.stormExposureSeconds = 0;
        player.lastStormDamageTime = 0;
      }
    }

    // 7. Apply accumulated damage & handle single-shot eliminations
    for (const event of damageEvents) {
      const target = this.players.get(event.targetId);
      if (target && target.status === 'alive') {
        target.hp -= event.amount;
      }
    }

    for (const player of this.players.values()) {
      if (player.status === 'alive' && player.hp <= 0) {
        player.hp = 0;
        player.status = 'ghost';
        this.dropDeathLoot(player);
      }
    }

    // 8. Winner / Draw Resolution
    const livingPlayers = Array.from(this.players.values()).filter((p) => p.status === 'alive');
    if (livingPlayers.length === 1 && this.players.size >= 2) {
      this.phase = 'finished';
      this.winnerSlot = livingPlayers[0].slot;
      this.winnerName = livingPlayers[0].name;
      this.isDraw = false;
    } else if (livingPlayers.length === 0 && this.players.size >= 1) {
      this.phase = 'finished';
      this.winnerSlot = null;
      this.winnerName = 'Draw';
      this.isDraw = true;
    }
  }

  private updatePlayerTier(player: InternalPlayer): void {
    let newTier = 0;
    if (player.dreamies >= DREAMIES_UPGRADE_TIER_2) {
      newTier = 2;
    } else if (player.dreamies >= DREAMIES_UPGRADE_TIER_1) {
      newTier = 1;
    }

    if (newTier !== player.tier) {
      player.tier = newTier;
      const config = WEAPON_TIERS[newTier];
      player.maxAmmo = config.magCapacity;
      // If magazine was full, grant upgrade capacity
      if (player.ammo >= WEAPON_TIERS[newTier - 1]?.magCapacity) {
        player.ammo = player.maxAmmo;
      }
    }
  }

  private dropDeathLoot(player: InternalPlayer): void {
    if (player.dreamies > 0) {
      this.collectibles.push({
        id: `drop-${this.nextCollectibleId++}`,
        x: player.x,
        y: player.y,
        value: player.dreamies,
        isDeathDrop: true,
      });
      player.dreamies = 0;
      player.tier = 0;
      player.maxAmmo = WEAPON_TIERS[0].magCapacity;
      player.ammo = Math.min(player.ammo, player.maxAmmo);
    }
  }

  public getSnapshot(): RoomSnapshot {
    const storm = this.getStormState();
    return {
      tick: this.tickCount,
      serverTime: this.elapsedTime,
      phase: this.phase,
      players: Array.from(this.players.values()).map((p) => ({
        id: p.id,
        name: p.name,
        slot: p.slot,
        status: p.status,
        x: Math.round(p.x * 10) / 10,
        y: Math.round(p.y * 10) / 10,
        aimAngle: Math.round(p.aimAngle * 100) / 100,
        hp: p.hp,
        maxHp: p.maxHp,
        ammo: p.ammo,
        maxAmmo: p.maxAmmo,
        tier: p.tier,
        dreamies: p.dreamies,
        isReloading: p.isReloading,
        reloadProgress: Math.round(p.reloadProgress * 100) / 100,
        stormExposureSeconds: Math.round(p.stormExposureSeconds * 10) / 10,
      })),
      pellets: this.pellets.map((pellet) => ({
        id: pellet.id,
        shooterId: pellet.shooterId,
        x: Math.round(pellet.x * 10) / 10,
        y: Math.round(pellet.y * 10) / 10,
        vx: Math.round(pellet.vx),
        vy: Math.round(pellet.vy),
      })),
      collectibles: this.collectibles.map((c) => ({
        id: c.id,
        x: Math.round(c.x),
        y: Math.round(c.y),
        value: c.value,
        isDeathDrop: c.isDeathDrop,
      })),
      storm,
      winnerSlot: this.winnerSlot,
      winnerName: this.winnerName,
      isDraw: this.isDraw,
      rematchVotes: this.rematchVotes.size,
      requiredVotes: this.players.size,
    };
  }
}
