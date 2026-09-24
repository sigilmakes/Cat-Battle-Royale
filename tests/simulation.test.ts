import { describe, expect, it } from 'vitest';
import { GameSimulation } from '../src/server/game/simulation.js';
import {
  DISCONNECT_GRACE_SECONDS,
  FIRE_COOLDOWN,
  PLAYER_MAX_HP,
  SERVER_TICK_DT,
  STORM_GRACE_SECONDS,
  STORM_SHRINK_START_SECONDS,
  WEAPON_TIERS,
} from '../src/shared/constants.js';
import type { PlayerInput } from '../src/shared/types.js';

function advanceTime(sim: GameSimulation, seconds: number, inputs = new Map<string, PlayerInput>()): void {
  const steps = Math.round(seconds / SERVER_TICK_DT);
  for (let i = 0; i < steps; i++) {
    sim.step(SERVER_TICK_DT, inputs);
  }
}

describe('GameSimulation Deterministic Engine', () => {
  it('enforces lobby phase and starts game only when 3 players connect', () => {
    const sim = new GameSimulation();
    expect(sim.phase).toBe('lobby');

    const p1 = sim.addPlayer('p1', 'Cat1', 'token-1');
    expect(p1).not.toBeNull();
    expect(sim.players.size).toBe(1);
    expect(sim.phase).toBe('lobby');

    const p2 = sim.addPlayer('p2', 'Cat2', 'token-2');
    expect(p2).not.toBeNull();
    expect(sim.phase).toBe('lobby');

    const p3 = sim.addPlayer('p3', 'Cat3', 'token-3');
    expect(p3).not.toBeNull();
    expect(sim.players.size).toBe(3);
    expect(sim.phase).toBe('playing');

    // 4th player must be rejected
    const p4 = sim.addPlayer('p4', 'Cat4', 'token-4');
    expect(p4).toBeNull();
    expect(sim.players.size).toBe(3);
  });

  it('moves player and prevents walking through solid cover obstacles', () => {
    const sim = new GameSimulation();
    sim.addPlayer('p1', 'Cat1', 'tok1');
    sim.addPlayer('p2', 'Cat2', 'tok2');
    sim.addPlayer('p3', 'Cat3', 'tok3');

    const player = sim.players.get('p1')!;
    // Place player near rock-nw (x: 420, y: 420, width: 80, height: 80) -> rock covers [380, 460]
    player.x = 350;
    player.y = 420;

    const inputs = new Map<string, PlayerInput>();
    inputs.set('p1', {
      seq: 1,
      moveX: 1, // Moving right towards rock
      moveY: 0,
      aimAngle: 0,
      fire: false,
      reload: false,
    });

    // Advance 1 second (at 200px/s, would reach x: 550 without collision)
    advanceTime(sim, 1.0, inputs);

    // Player radius is 20, rock left boundary is 380 -> player.x must be blocked at 360
    expect(player.x).toBeLessThanOrEqual(361);
    expect(player.y).toBe(420);
  });

  it('handles firing, ammo depletion, rate limit, and auto-reload', () => {
    const sim = new GameSimulation();
    sim.addPlayer('p1', 'Cat1', 'tok1');
    sim.addPlayer('p2', 'Cat2', 'tok2');
    sim.addPlayer('p3', 'Cat3', 'tok3');

    const p1 = sim.players.get('p1')!;
    expect(p1.ammo).toBe(4);
    expect(p1.isReloading).toBe(false);

    const inputs = new Map<string, PlayerInput>();
    inputs.set('p1', {
      seq: 1,
      moveX: 0,
      moveY: 0,
      aimAngle: 0,
      fire: true,
      reload: false,
    });

    // 1 tick of fire
    sim.step(SERVER_TICK_DT, inputs);
    expect(p1.ammo).toBe(3);
    expect(sim.pellets.length).toBe(1);
    expect(p1.fireCooldown).toBeGreaterThan(0);

    // Immediate next tick firing should be rate-limited by fireCooldown
    sim.step(SERVER_TICK_DT, inputs);
    expect(p1.ammo).toBe(3);
    expect(sim.pellets.length).toBe(1);

    // Fire remaining 3 shots by advancing past cooldown each time
    for (let shot = 0; shot < 3; shot++) {
      advanceTime(sim, FIRE_COOLDOWN, inputs);
    }

    // Magazine was 4 shots total -> now 0, triggers automatic reload!
    expect(p1.ammo).toBe(0);
    expect(p1.isReloading).toBe(true);

    // While reloading, firing is blocked
    sim.step(SERVER_TICK_DT, inputs);
    expect(p1.ammo).toBe(0);

    // Wait reload duration (Tier 0: 2.0s)
    advanceTime(sim, WEAPON_TIERS[0].reloadSeconds + 0.1);
    expect(p1.isReloading).toBe(false);
    expect(p1.ammo).toBe(4);
  });

  it('watergun pellet damages target, ignores shooter, and blocks on cover', () => {
    const sim = new GameSimulation();
    sim.addPlayer('p1', 'Shooter', 'tok1');
    sim.addPlayer('p2', 'Target', 'tok2');
    sim.addPlayer('p3', 'Other', 'tok3');

    const p1 = sim.players.get('p1')!;
    const p2 = sim.players.get('p2')!;

    // Position p1 at (500, 500) and p2 at (600, 500), aiming directly at p2 (angle 0)
    p1.x = 500;
    p1.y = 500;
    p1.aimAngle = 0;

    p2.x = 600;
    p2.y = 500;
    p2.hp = PLAYER_MAX_HP;

    const fireInput = new Map<string, PlayerInput>();
    fireInput.set('p1', {
      seq: 1,
      moveX: 0,
      moveY: 0,
      aimAngle: 0,
      fire: true,
      reload: false,
    });

    // Fire 1 pellet
    sim.step(SERVER_TICK_DT, fireInput);
    expect(sim.pellets.length).toBe(1);

    // Let pellet travel (distance 100px at 600px/s takes ~0.17s)
    advanceTime(sim, 0.25);

    // Target should take 1 damage; shooter takes 0 damage
    expect(p2.hp).toBe(PLAYER_MAX_HP - 1);
    expect(p1.hp).toBe(PLAYER_MAX_HP);
    // Pellet consumed on hit
    expect(sim.pellets.length).toBe(0);
  });

  it('4 hits eliminate cat, drop Dreamies loot pile, and turn cat into ghost', () => {
    const sim = new GameSimulation();
    sim.addPlayer('p1', 'Shooter', 'tok1');
    sim.addPlayer('p2', 'Victim', 'tok2');
    sim.addPlayer('p3', 'Spectator', 'tok3');

    sim.collectibles = [];
    const p1 = sim.players.get('p1')!;
    const p2 = sim.players.get('p2')!;
    p2.x = 600;
    p2.y = 500;
    p2.dreamies = 7; // Has 7 Dreamies
    p2.hp = 1; // 1 hit away from death

    p1.x = 500;
    p1.y = 500;
    p1.aimAngle = 0;

    const fireInput = new Map<string, PlayerInput>();
    fireInput.set('p1', {
      seq: 1,
      moveX: 0,
      moveY: 0,
      aimAngle: 0,
      fire: true,
      reload: false,
    });

    // Fire final hit
    sim.step(SERVER_TICK_DT, fireInput);
    advanceTime(sim, 0.25);

    // Victim eliminated
    expect(p2.hp).toBe(0);
    expect(p2.status).toBe('ghost');
    expect(p2.dreamies).toBe(0);

    // Death drop spawned at victim's coordinates with value 7
    const deathDrop = sim.collectibles.find((c) => c.isDeathDrop);
    expect(deathDrop).toBeDefined();
    expect(deathDrop!.value).toBe(7);
    expect(deathDrop!.x).toBe(p2.x);
    expect(deathDrop!.y).toBe(p2.y);
  });

  it('collecting Dreamies upgrades weapon tier at 5 and 12', () => {
    const sim = new GameSimulation();
    sim.addPlayer('p1', 'Collector', 'tok1');
    sim.addPlayer('p2', 'Other1', 'tok2');
    sim.addPlayer('p3', 'Other2', 'tok3');

    const p1 = sim.players.get('p1')!;
    expect(p1.tier).toBe(0);
    expect(p1.maxAmmo).toBe(4);

    // Place a collectible of value 5 directly at p1 position
    sim.collectibles.push({
      id: 'test-c1',
      x: p1.x,
      y: p1.y,
      value: 5,
      isDeathDrop: false,
    });

    sim.step(SERVER_TICK_DT, new Map());
    expect(p1.dreamies).toBe(5);
    expect(p1.tier).toBe(1);
    expect(p1.maxAmmo).toBe(6);

    // Place another collectible of value 7 (total 12)
    sim.collectibles.push({
      id: 'test-c2',
      x: p1.x,
      y: p1.y,
      value: 7,
      isDeathDrop: false,
    });

    sim.step(SERVER_TICK_DT, new Map());
    expect(p1.dreamies).toBe(12);
    expect(p1.tier).toBe(2);
    expect(p1.maxAmmo).toBe(8);
  });

  it('shrinking tornado deals escalating damage outside eye and resets on re-entry', () => {
    const sim = new GameSimulation();
    sim.addPlayer('p1', 'StormCat', 'tok1');
    sim.addPlayer('p2', 'SafeCat1', 'tok2');
    sim.addPlayer('p3', 'SafeCat2', 'tok3');

    const p1 = sim.players.get('p1')!;
    // Advance past initial 30s storm wait
    advanceTime(sim, STORM_SHRINK_START_SECONDS + 5);

    const storm = sim.getStormState();
    expect(storm.phase).toBe('shrinking');
    expect(storm.currentRadius).toBeLessThan(500);

    // Position p1 far outside storm radius
    p1.x = 1100;
    p1.y = 1100;
    p1.hp = PLAYER_MAX_HP;

    // Advance 1.5s -> within 2s grace, no damage
    advanceTime(sim, 1.5);
    expect(p1.stormExposureSeconds).toBeCloseTo(1.5, 1);
    expect(p1.hp).toBe(PLAYER_MAX_HP);

    // Advance past 2s grace -> receives first damage hit
    advanceTime(sim, STORM_GRACE_SECONDS - 1.5 + 0.1);
    expect(p1.hp).toBe(PLAYER_MAX_HP - 1);

    // Move p1 back inside storm safe eye
    p1.x = storm.centerX;
    p1.y = storm.centerY;
    sim.step(SERVER_TICK_DT, new Map());

    // Exposure timer resets to 0
    expect(p1.stormExposureSeconds).toBe(0);
  });

  it('resolves match to single winner or draw on simultaneous death, then rematches cleanly', () => {
    const sim = new GameSimulation();
    sim.addPlayer('p1', 'Cat1', 'tok1');
    sim.addPlayer('p2', 'Cat2', 'tok2');
    sim.addPlayer('p3', 'Cat3', 'tok3');

    const p1 = sim.players.get('p1')!;
    const p2 = sim.players.get('p2')!;
    const p3 = sim.players.get('p3')!;

    // Eliminate p2 and p3
    p2.hp = 0;
    p2.status = 'ghost';
    p3.hp = 0;
    p3.status = 'ghost';

    sim.step(SERVER_TICK_DT, new Map());
    expect(sim.phase).toBe('finished');
    expect(sim.winnerSlot).toBe(p1.slot);
    expect(sim.winnerName).toBe('Cat1');
    expect(sim.isDraw).toBe(false);

    // All players vote rematch
    sim.voteRematch('p1');
    sim.voteRematch('p2');
    sim.voteRematch('p3');

    // Round resets to fresh playing state
    expect(sim.phase).toBe('playing');
    expect(sim.winnerSlot).toBeNull();
    expect(sim.stormTimer).toBe(0);
    expect(p1.hp).toBe(PLAYER_MAX_HP);
    expect(p2.hp).toBe(PLAYER_MAX_HP);
    expect(p3.hp).toBe(PLAYER_MAX_HP);
    expect(p1.status).toBe('alive');
    expect(p2.status).toBe('alive');
    expect(p3.status).toBe('alive');
  });

  it('disconnects player with 10s grace before elimination, reconnect restores player', () => {
    const sim = new GameSimulation();
    sim.addPlayer('p1', 'Cat1', 'tok1');
    sim.addPlayer('p2', 'Cat2', 'tok2');
    sim.addPlayer('p3', 'Cat3', 'tok3');

    const p1 = sim.players.get('p1')!;
    sim.markDisconnected('p1');
    expect(p1.status).toBe('disconnected');

    // Reconnecting after 5s (< 10s) restores player
    advanceTime(sim, 5.0);
    expect(p1.status).toBe('disconnected');
    const restored = sim.reconnectPlayer('p1', 'new-token');
    expect(restored).toBe(true);
    expect(p1.status).toBe('alive');

    // If disconnected again and 10s expires
    sim.markDisconnected('p1');
    advanceTime(sim, DISCONNECT_GRACE_SECONDS + 0.5);
    expect(p1.status).toBe('ghost');
    expect(p1.hp).toBe(0);
  });
});
