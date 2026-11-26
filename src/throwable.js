// Throwable distraction: a bottle the player picks up (E), aims (hold G) and throws (release G).
// It flies on a simple gravity arc, smashes on the first thing it hits and makes a noise there.

import * as THREE from 'three';
import { segmentFirstHit } from './collision.js';

export const THROW_NOISE = 8;   // m: smash noise radius, halved through walls like footsteps (guess)
const THROW_SPEED = 10;         // m/s (guess)
const GRAVITY = 9.8;
const CEILING = 3.95;
const STEP = 1 / 120;           // s per flight sub-step

/** Launch velocity from the camera's yaw/pitch: a little above where the camera looks. */
export function throwVelocity(yaw, pitch) {
  const up = Math.max(-0.4, Math.min(1.1, pitch + 0.35));
  return new THREE.Vector3(
    -Math.sin(yaw) * Math.cos(up),
    Math.sin(up),
    -Math.cos(yaw) * Math.cos(up)
  ).multiplyScalar(THROW_SPEED);
}

/**
 * Advance a point one sub-step. Returns the impact point if it hit something, else null.
 * Mutates pos and vel.
 */
function flyStep(pos, vel, dt, boxes) {
  const next = pos.clone().addScaledVector(vel, dt);
  next.y -= 0.5 * GRAVITY * dt * dt;
  vel.y -= GRAVITY * dt;
  let t = segmentFirstHit(pos, next, boxes);
  if (next.y <= 0) t = Math.min(t, pos.y / Math.max(1e-6, pos.y - next.y));
  if (next.y >= CEILING) t = Math.min(t, (CEILING - pos.y) / Math.max(1e-6, next.y - pos.y));
  if (t < 1) {
    const hit = pos.clone().lerp(next, Math.max(0, t));
    hit.y = Math.max(0, Math.min(CEILING, hit.y));
    pos.copy(hit);
    return hit;
  }
  pos.copy(next);
  return null;
}

/** Points along the arc for the aim line, ending at the impact point (max 3 s of flight). */
export function predictArc(origin, vel, boxes, out = []) {
  out.length = 0;
  const p = origin.clone();
  const v = vel.clone();
  out.push(p.clone());
  for (let i = 0; i < 360; i++) {
    const hit = flyStep(p, v, STEP, boxes);
    if (i % 3 === 2 || hit) out.push(p.clone());
    if (hit) break;
  }
  return out;
}

export class Bottle {
  constructor(scene, rest) {
    this.rest = new THREE.Vector3(rest.x, rest.y, rest.z);
    this.mesh = new THREE.Group();
    const glass = new THREE.MeshStandardMaterial({ color: 0x2f6b3a, roughness: 0.25, metalness: 0.1,
      emissive: 0x0d2412, emissiveIntensity: 0.6 });
    const body = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.045, 0.18, 10), glass);
    body.position.y = 0.09;
    const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.03, 0.09, 8), glass);
    neck.position.y = 0.225;
    body.castShadow = true;
    this.mesh.add(body, neck);
    scene.add(this.mesh);
    this.pos = new THREE.Vector3();
    this.vel = new THREE.Vector3();
    this.reset();
  }

  reset() {
    this.state = 'rest'; // 'rest' | 'held' | 'flying' | 'broken'
    this.pos.copy(this.rest);
    this.vel.set(0, 0, 0);
    this.mesh.visible = true;
    this.mesh.rotation.set(0, 0, 0);
    this.mesh.position.copy(this.pos);
  }

  pickUp() {
    this.state = 'held';
    this.mesh.visible = false;
  }

  throw(origin, vel) {
    this.state = 'flying';
    this.pos.copy(origin);
    this.vel.copy(vel);
    this.mesh.visible = true;
  }

  /** Fly; returns the smash point on the frame it hits something, else null. */
  update(dt, boxes) {
    if (this.state !== 'flying') return null;
    let hit = null;
    const n = Math.max(1, Math.round(dt / STEP));
    for (let i = 0; i < n && !hit; i++) hit = flyStep(this.pos, this.vel, dt / n, boxes);
    this.mesh.position.copy(this.pos);
    this.mesh.rotation.x += 12 * dt; // tumble
    if (hit) {
      this.state = 'broken';
      this.mesh.visible = false;
    }
    return hit;
  }
}
