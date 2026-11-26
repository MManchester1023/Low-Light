// Suppressed pistol: hold F to aim, click to fire. Hitscan from the camera through the crosshair.
// A hit guard dies (lethal: the rating drops to Cleared). A hit light breaks for good (no switch fixes it).
// Every number here is a starting guess to tune in playtests.

import * as THREE from 'three';
import { segmentFirstHit } from './collision.js';

export const PISTOL_AMMO = 3;
export const SHOT_NOISE = 3;    // m at the shooter: suppressed, but not silent
export const IMPACT_NOISE = 4;  // m where the round lands (wall, glass, body)
const RANGE = 40;               // m
const GUARD_R = 0.35;           // guard hit cylinder
const GUARD_H = 1.8;
const LIGHT_R = 0.3;            // light fixture hit sphere

/** Fraction along a→b where it first enters a sphere, or Infinity. */
function segmentSphereT(a, ab, len2, c, r) {
  const ax = a.x - c.x, ay = a.y - c.y, az = a.z - c.z;
  const b = ax * ab.x + ay * ab.y + az * ab.z;
  const cc = ax * ax + ay * ay + az * az - r * r;
  const disc = b * b - len2 * cc;
  if (disc < 0) return Infinity;
  const t = (-b - Math.sqrt(disc)) / len2;
  return t >= 0 && t <= 1 ? t : Infinity;
}

/** Fraction along a→b where it first enters an upright cylinder (feet at c), or Infinity. */
function segmentCylinderT(a, ab, c, r, h) {
  const ax = a.x - c.x, az = a.z - c.z;
  const A = ab.x * ab.x + ab.z * ab.z;
  if (A < 1e-9) return Infinity;
  const B = ax * ab.x + az * ab.z;
  const C = ax * ax + az * az - r * r;
  const disc = B * B - A * C;
  if (disc < 0) return Infinity;
  const t = (-B - Math.sqrt(disc)) / A;
  if (t < 0 || t > 1) return Infinity;
  const y = a.y + ab.y * t;
  return y >= 0 && y <= h ? t : Infinity;
}

/**
 * Trace one shot from `origin` along unit `dir`. Returns { kind: 'guard' | 'light' | 'wall' | 'miss', point, light }.
 * A guard counts as a target unless he's already lying on the floor.
 */
export function traceShot(origin, dir, level, guard) {
  const end = origin.clone().addScaledVector(dir, RANGE);
  const ab = end.clone().sub(origin);
  const len2 = ab.lengthSq();
  let best = segmentFirstHit(origin, end, level.boxes);
  let kind = best < 1 ? 'wall' : 'miss';
  let light = null;
  for (const L of level.lights) {
    if (L.broken) continue;
    const t = segmentSphereT(origin, ab, len2, L.fixture.position, LIGHT_R);
    if (t < best) { best = t; kind = 'light'; light = L; }
  }
  if (guard.state !== 'down' && guard.state !== 'dead') {
    const t = segmentCylinderT(origin, ab, guard.pos, GUARD_R, GUARD_H);
    if (t < best) { best = t; kind = 'guard'; light = null; }
  }
  return { kind, light, point: origin.clone().addScaledVector(ab, Math.min(best, 1)) };
}

/** Small gun model the player holds up while aiming. */
export function makePistolMesh() {
  const g = new THREE.Group();
  const m = new THREE.MeshStandardMaterial({ color: 0x1a1c20, roughness: 0.5, metalness: 0.6 });
  const slide = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.06, 0.32), m); // barrel + suppressor
  slide.position.z = -0.12;
  const grip = new THREE.Mesh(new THREE.BoxGeometry(0.045, 0.12, 0.06), m);
  grip.position.set(0, -0.07, 0);
  grip.rotation.x = -0.25;
  g.add(slide, grip);
  return g;
}
