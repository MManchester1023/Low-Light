// Third-person player: capsule body, walk / run / crouch, collision against level boxes.

import * as THREE from 'three';
import { resolveCircle } from './collision.js';
import { lerp, turnToward } from './utils.js';

const SPEED = { crouch: 1.5, crouchRun: 2.4, walk: 3.0, run: 5.5 }; // m/s, guesses
const NOISE = { crouch: 1, walk: 4, run: 10 }; // m, design doc values
export const MAX_NOISE = NOISE.run;
const BODY_H = 1.74;

export class Player {
  constructor(scene) {
    this.group = new THREE.Group();
    this.body = new THREE.Mesh(
      new THREE.CapsuleGeometry(0.32, BODY_H - 0.64, 6, 12),
      new THREE.MeshStandardMaterial({ color: 0x2a3340, roughness: 0.8 })
    );
    this.body.castShadow = true;
    const goggles = new THREE.Mesh(
      new THREE.BoxGeometry(0.3, 0.08, 0.12),
      new THREE.MeshStandardMaterial({ color: 0x113311, emissive: 0x22ff44, emissiveIntensity: 0.6 })
    );
    goggles.position.set(0, 0.62, -0.27);
    this.body.add(goggles);
    this.group.add(this.body);
    scene.add(this.group);

    this.pos = new THREE.Vector3();
    this.vel = new THREE.Vector3();
    this.radius = 0.35;
    this.lightLevel = 0;
  }

  reset(start) {
    this.pos.set(start.x, 0, start.z);
    this.vel.set(0, 0, 0);
    this.facing = start.yaw;
    this.crouched = false;
    this.crouchBlend = 0;
    this.running = false;
    this.applyMesh();
  }

  get speed() {
    return Math.hypot(this.vel.x, this.vel.z);
  }

  get stance() {
    if (this.crouched) return 'CROUCHED';
    return this.running && this.speed > 3.2 ? 'RUNNING' : 'STANDING';
  }

  update(dt, input, camYaw, boxes) {
    if (input.pressed('KeyC')) this.crouched = !this.crouched;

    const f = (input.down('KeyW') ? 1 : 0) - (input.down('KeyS') ? 1 : 0);
    const s = (input.down('KeyD') ? 1 : 0) - (input.down('KeyA') ? 1 : 0);
    let mx = -Math.sin(camYaw) * f + Math.cos(camYaw) * s;
    let mz = -Math.cos(camYaw) * f - Math.sin(camYaw) * s;
    const len = Math.hypot(mx, mz);
    if (len > 0) { mx /= len; mz /= len; }

    this.running = input.down('ShiftLeft') || input.down('ShiftRight');
    const speed = this.crouched
      ? (this.running ? SPEED.crouchRun : SPEED.crouch)
      : (this.running ? SPEED.run : SPEED.walk);

    const k = 1 - Math.exp(-12 * dt);
    this.vel.x += (mx * speed - this.vel.x) * k;
    this.vel.z += (mz * speed - this.vel.z) * k;
    this.pos.x += this.vel.x * dt;
    this.pos.z += this.vel.z * dt;
    resolveCircle(this.pos, this.radius, boxes);

    if (len > 0) this.facing = turnToward(this.facing, Math.atan2(-mx, -mz), 12 * dt);
    this.crouchBlend += ((this.crouched ? 1 : 0) - this.crouchBlend) * (1 - Math.exp(-10 * dt));
    this.applyMesh();
  }

  applyMesh() {
    const h = 1 - 0.42 * this.crouchBlend;
    this.body.scale.set(1, h, 1);
    this.body.position.y = (BODY_H / 2) * h;
    this.group.position.copy(this.pos);
    this.group.rotation.y = this.facing;
  }

  /** Feet, chest, head: where light and guard sight are sampled. */
  samplePoints() {
    const c = this.crouchBlend;
    const { x, z } = this.pos;
    return [
      new THREE.Vector3(x, 0.25, z),
      new THREE.Vector3(x, lerp(1.2, 0.7, c), z),
      new THREE.Vector3(x, lerp(1.65, 0.98, c), z),
    ];
  }

  /**
   * Footstep noise radius in metres (0 when still). Full radius at the stance's full speed:
   * crouch 1 m, walk 4 m, run 10 m (design doc starting values).
   */
  get noiseRadius() {
    const v = this.speed;
    if (v < 0.2) return 0;
    let radius, full;
    if (this.crouched) { radius = NOISE.crouch; full = SPEED.crouch; }
    else if (this.running && v > SPEED.walk + 0.2) { radius = NOISE.run; full = SPEED.run; }
    else { radius = NOISE.walk; full = SPEED.walk; }
    return radius * Math.min(1, v / full);
  }

  /** Camera pivot height above the feet. */
  get eyeHeight() {
    return lerp(1.55, 1.05, this.crouchBlend);
  }
}
