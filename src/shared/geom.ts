// Geometry, collision, and vector math helpers

import { ObstacleRect } from './constants.js';

export interface Point {
  x: number;
  y: number;
}

export function distance(x1: number, y1: number, x2: number, y2: number): number {
  return Math.hypot(x2 - x1, y2 - y1);
}

export function clamp(val: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, val));
}

export function normalizeVector(x: number, y: number): Point {
  const len = Math.hypot(x, y);
  if (len === 0) return { x: 0, y: 0 };
  return { x: x / len, y: y / len };
}

// Circle vs AABB collision detection & resolution
// Returns the resolved position of the circle center
export function resolveCircleObstacle(
  cx: number,
  cy: number,
  radius: number,
  obs: ObstacleRect
): Point {
  const halfW = obs.width / 2;
  const halfH = obs.height / 2;
  const left = obs.x - halfW;
  const right = obs.x + halfW;
  const top = obs.y - halfH;
  const bottom = obs.y + halfH;

  // Closest point on rectangle to circle center
  const closestX = clamp(cx, left, right);
  const closestY = clamp(cy, top, bottom);

  const distX = cx - closestX;
  const distY = cy - closestY;
  const distSq = distX * distX + distY * distY;

  if (distSq < radius * radius) {
    const dist = Math.sqrt(distSq);
    if (dist === 0) {
      // Circle center is inside rectangle: push out in shortest direction
      const overlapLeft = cx - left;
      const overlapRight = right - cx;
      const overlapTop = cy - top;
      const overlapBottom = bottom - cy;
      const minOverlap = Math.min(overlapLeft, overlapRight, overlapTop, overlapBottom);
      if (minOverlap === overlapLeft) return { x: left - radius, y: cy };
      if (minOverlap === overlapRight) return { x: right + radius, y: cy };
      if (minOverlap === overlapTop) return { x: cx, y: top - radius };
      return { x: cx, y: bottom + radius };
    }
    const penetration = radius - dist;
    return {
      x: cx + (distX / dist) * penetration,
      y: cy + (distY / dist) * penetration,
    };
  }

  return { x: cx, y: cy };
}

// Keep circle inside circular island boundary
export function clampToIsland(
  cx: number,
  cy: number,
  radius: number,
  islandX: number,
  islandY: number,
  islandRadius: number
): Point {
  const maxDist = islandRadius - radius;
  const dist = distance(cx, cy, islandX, islandY);
  if (dist > maxDist) {
    if (dist === 0) return { x: islandX, y: islandY };
    return {
      x: islandX + ((cx - islandX) / dist) * maxDist,
      y: islandY + ((cy - islandY) / dist) * maxDist,
    };
  }
  return { x: cx, y: cy };
}

// Ray-box intersection (swept pellet against AABB)
// Checks if segment from p1 to p2 intersects obstacle box
// Returns fraction t in [0, 1] if hit, or null
export function segmentIntersectsBox(
  p1: Point,
  p2: Point,
  obs: ObstacleRect
): number | null {
  const left = obs.x - obs.width / 2;
  const right = obs.x + obs.width / 2;
  const top = obs.y - obs.height / 2;
  const bottom = obs.y + obs.height / 2;

  const dx = p2.x - p1.x;
  const dy = p2.y - p1.y;

  let tMin = 0;
  let tMax = 1;

  if (Math.abs(dx) < 1e-8) {
    if (p1.x < left || p1.x > right) return null;
  } else {
    let t1 = (left - p1.x) / dx;
    let t2 = (right - p1.x) / dx;
    if (t1 > t2) [t1, t2] = [t2, t1];
    tMin = Math.max(tMin, t1);
    tMax = Math.min(tMax, t2);
    if (tMin > tMax) return null;
  }

  if (Math.abs(dy) < 1e-8) {
    if (p1.y < top || p1.y > bottom) return null;
  } else {
    let t1 = (top - p1.y) / dy;
    let t2 = (bottom - p1.y) / dy;
    if (t1 > t2) [t1, t2] = [t2, t1];
    tMin = Math.max(tMin, t1);
    tMax = Math.min(tMax, t2);
    if (tMin > tMax) return null;
  }

  return tMin <= 1 && tMin >= 0 ? tMin : (t1_contains(p1, left, right, top, bottom) ? 0 : null);
}

function t1_contains(p: Point, left: number, right: number, top: number, bottom: number): boolean {
  return p.x >= left && p.x <= right && p.y >= top && p.y <= bottom;
}

// Swept segment vs circle (for pellet hitting cat)
// Returns fraction t in [0, 1] if segment hits circle of given radius, or null
export function segmentIntersectsCircle(
  p1: Point,
  p2: Point,
  center: Point,
  radius: number
): number | null {
  const dX = p2.x - p1.x;
  const dY = p2.y - p1.y;
  const fX = p1.x - center.x;
  const fY = p1.y - center.y;

  const a = dX * dX + dY * dY;
  if (a < 1e-8) {
    return (fX * fX + fY * fY <= radius * radius) ? 0 : null;
  }

  const b = 2 * (fX * dX + fY * dY);
  const c = (fX * fX + fY * fY) - radius * radius;

  const discriminant = b * b - 4 * a * c;
  if (discriminant < 0) return null;

  const sqrtDisc = Math.sqrt(discriminant);
  const t1 = (-b - sqrtDisc) / (2 * a);
  const t2 = (-b + sqrtDisc) / (2 * a);

  if (t1 >= 0 && t1 <= 1) return t1;
  if (t2 >= 0 && t2 <= 1) return t2;
  // If starting point is inside the circle
  if (c <= 0) return 0;

  return null;
}
