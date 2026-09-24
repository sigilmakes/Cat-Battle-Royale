import { describe, expect, it } from 'vitest';
import {
  clamp,
  clampToIsland,
  distance,
  normalizeVector,
  resolveCircleObstacle,
  segmentIntersectsBox,
  segmentIntersectsCircle,
} from '../src/shared/geom.js';
import { ObstacleRect } from '../src/shared/constants.js';

describe('Geometry & Math Helpers', () => {
  it('clamps values within range', () => {
    expect(clamp(5, 0, 10)).toBe(5);
    expect(clamp(-2, 0, 10)).toBe(0);
    expect(clamp(15, 0, 10)).toBe(10);
  });

  it('normalizes vectors and clamps diagonal magnitude', () => {
    const zero = normalizeVector(0, 0);
    expect(zero).toEqual({ x: 0, y: 0 });

    const diag = normalizeVector(1, 1);
    expect(Math.hypot(diag.x, diag.y)).toBeCloseTo(1.0, 5);
    expect(diag.x).toBeCloseTo(Math.SQRT1_2, 5);
    expect(diag.y).toBeCloseTo(Math.SQRT1_2, 5);
  });

  it('calculates Euclidean distance correctly', () => {
    expect(distance(0, 0, 3, 4)).toBe(5);
    expect(distance(100, 100, 100, 100)).toBe(0);
  });

  it('resolves circle collision against rectangular obstacles', () => {
    const obstacle: ObstacleRect = {
      id: 'rock',
      x: 500,
      y: 500,
      width: 100,
      height: 100,
    };
    // Obstacle bounds: [450, 550] in X and Y
    const radius = 20;

    // Center at (440, 500) -> circle penetrates left edge (450 - 440 = 10, radius 20 -> pushed out to 430)
    const resolved = resolveCircleObstacle(440, 500, radius, obstacle);
    expect(resolved.x).toBeLessThanOrEqual(430);
    expect(resolved.y).toBe(500);

    // Non-colliding position remains unchanged
    const free = resolveCircleObstacle(300, 300, radius, obstacle);
    expect(free.x).toBe(300);
    expect(free.y).toBe(300);
  });

  it('clamps circle center to stay inside circular island boundary', () => {
    const islandX = 600;
    const islandY = 600;
    const islandRadius = 500;
    const catRadius = 20;

    // Point far beyond boundary (1200, 600)
    const clamped = clampToIsland(1200, 600, catRadius, islandX, islandY, islandRadius);
    const distFromCenter = distance(clamped.x, clamped.y, islandX, islandY);
    expect(distFromCenter).toBeCloseTo(islandRadius - catRadius, 4);

    // Inside island point remains untouched
    const inside = clampToIsland(650, 650, catRadius, islandX, islandY, islandRadius);
    expect(inside.x).toBe(650);
    expect(inside.y).toBe(650);
  });

  it('detects swept segment intersection with AABB obstacle box', () => {
    const obs: ObstacleRect = {
      id: 'box',
      x: 500,
      y: 500,
      width: 100,
      height: 100,
    };
    // Ray from (400, 500) to (600, 500) passes through box [450, 550]
    const hitT = segmentIntersectsBox({ x: 400, y: 500 }, { x: 600, y: 500 }, obs);
    expect(hitT).not.toBeNull();
    expect(hitT).toBeCloseTo(0.25, 4); // hits at x=450, which is (450-400)/200 = 0.25

    // Ray that misses the box
    const missT = segmentIntersectsBox({ x: 400, y: 300 }, { x: 600, y: 300 }, obs);
    expect(missT).toBeNull();
  });

  it('detects swept segment intersection with circular cat', () => {
    const catCenter = { x: 500, y: 500 };
    const catRadius = 20;

    // Ray passing directly through cat
    const hitT = segmentIntersectsCircle({ x: 400, y: 500 }, { x: 600, y: 500 }, catCenter, catRadius);
    expect(hitT).not.toBeNull();
    expect(hitT).toBeCloseTo(0.4, 4); // hits at x=480, (480-400)/200 = 0.4

    // Ray that misses cat
    const missT = segmentIntersectsCircle({ x: 400, y: 550 }, { x: 600, y: 550 }, catCenter, catRadius);
    expect(missT).toBeNull();
  });
});
