// Third-person player: capsule body, walk / run / crouch, collision against level boxes,
// and climbing pipes: hold W/S on a riser, hang (legs up or by the hands) and shimmy along the ceiling, drop.

import * as THREE from 'three';
import { resolveCircle } from './collision.js';
import { lerp, turnToward } from './utils.js';
import { PIPE_Y, END_PAD } from './pipe.js';

const SPEED = { crouch: 1.5, crouchRun: 2.4, walk: 3.0, run: 5.5, drag: 1.1 }; // m/s, guesses
const NOISE = { crouch: 1, walk: 3, run: 10, drag: 2.5 }; // m, design doc values (walk was 4)
export const MAX_NOISE = NOISE.run;
const BODY_H = 1.74;

// Pipes (all guesses): climb a riser by hand (W/S), hang legs-up or by the hands, shimmy, drop.
const CLIMB_SPEED = 1.6;           // m/s up or down a riser
const SHIMMY_SPEED = { legs: 1.2, hands: 1.6 }; // m/s: by the hands is quicker but hangs lower, easier to see
const CLIMB_NOISE = 0.6;           // m: quieter than crouching
const CLIMB_TOP = PIPE_Y - BODY_H; // feet height when the hands reach the pipe
const HANG_Y = PIPE_Y - 0.4;       // body centreline while hanging
const GRAVITY = 9.8;

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
    this.grabbing = false; // holding a guard: slow, faces where the camera looks
    this.locked = false;   // mid-knockout: can't move
    this.aiming = false;   // pistol up: faces where the camera looks
    this.climb = null;     // on a pipe: { pipe, s, mode: 'riser' | 'hang' | 'drop', style: 'legs' | 'hands' }
    this.climbSpeed = 0;
    this.vy = 0;
    this.landed = false;   // true for the step a drop hits the floor
    this.applyMesh();
  }

  get speed() {
    return Math.hypot(this.vel.x, this.vel.z);
  }

  get stance() {
    if (this.climb) {
      const c = this.climb;
      if (c.mode === 'hang') return c.style === 'hands' ? 'HANGING · HANDS' : 'HANGING · LEGS UP';
      return c.mode === 'drop' ? 'DROPPING' : 'CLIMBING';
    }
    if (this.crouched) return 'CROUCHED';
    return this.running && this.speed > 3.2 ? 'RUNNING' : 'STANDING';
  }

  get hanging() {
    return !!this.climb && this.climb.mode === 'hang';
  }

  /** Hanging legs-up: body tucked along the pipe. */
  get tucked() {
    return this.hanging && this.climb.style === 'legs';
  }

  /** Hanging at either end of the pipe, where a riser goes down. */
  get atPipeEnd() {
    const c = this.climb;
    return this.hanging && (c.s <= END_PAD + 0.05 || c.s >= c.pipe.length - END_PAD - 0.05);
  }

  /** Grab a pipe's riser from the floor, at distance s along the pipe. W climbs, S climbs down. */
  startClimb(pipe, s) {
    const p = pipe.pointAt(s);
    this.climb = { pipe, s, mode: 'riser', style: 'legs' };
    this.pos.set(p.x, 0, p.z);
    this.vel.set(0, 0, 0);
    this.crouched = false;
    this.crouchBlend = 0;
    const d = pipe.dirAt(s);
    if (s > pipe.length / 2) d.negate();
    this.facing = Math.atan2(-d.x, -d.z); // face along the pipe, ready to shimmy
    this.applyMesh();
  }

  /** Hanging at a pipe end: swing back onto the riser (then S climbs down). */
  climbDown() {
    if (!this.atPipeEnd) return;
    this.climb.mode = 'riser';
    this.pos.y = CLIMB_TOP - 0.05;
  }

  /** Let go (of the pipe or the riser) and fall to the floor. */
  drop() {
    const c = this.climb;
    if (!c || c.mode === 'drop') return;
    if (c.mode === 'hang') this.pos.y = CLIMB_TOP;
    c.mode = 'drop';
    this.vy = 0;
  }

  update(dt, input, camYaw, boxes) {
    this.landed = false;
    if (input.pressed('KeyC') && !this.grabbing && !this.locked && !this.climb) this.crouched = !this.crouched;

    const f = (input.down('KeyW') ? 1 : 0) - (input.down('KeyS') ? 1 : 0);
    const s = (input.down('KeyD') ? 1 : 0) - (input.down('KeyA') ? 1 : 0);
    let mx = -Math.sin(camYaw) * f + Math.cos(camYaw) * s;
    let mz = -Math.cos(camYaw) * f - Math.sin(camYaw) * s;
    if (this.locked) { mx = 0; mz = 0; }
    const len = Math.hypot(mx, mz);
    if (len > 0) { mx /= len; mz /= len; }
    if (this.climb) { this.updateClimb(dt, input, f, mx, mz, boxes); return; }

    this.running = !this.grabbing && (input.down('ShiftLeft') || input.down('ShiftRight'));
    const speed = this.grabbing ? SPEED.drag : this.crouched
      ? (this.running ? SPEED.crouchRun : SPEED.crouch)
      : (this.running ? SPEED.run : SPEED.walk);

    const k = 1 - Math.exp(-12 * dt);
    this.vel.x += (mx * speed - this.vel.x) * k;
    this.vel.z += (mz * speed - this.vel.z) * k;
    this.pos.x += this.vel.x * dt;
    this.pos.z += this.vel.z * dt;
    resolveCircle(this.pos, this.radius, boxes);

    if (this.grabbing) this.facing = turnToward(this.facing, camYaw, 3 * dt);
    else if (this.aiming) this.facing = turnToward(this.facing, camYaw, 14 * dt);
    else if (len > 0 && !this.locked) this.facing = turnToward(this.facing, Math.atan2(-mx, -mz), 12 * dt);
    this.crouchBlend += ((this.crouched ? 1 : 0) - this.crouchBlend) * (1 - Math.exp(-10 * dt));
    this.applyMesh();
  }

  /**
   * Pipe movement. f is W/S (+1/-1) for the riser; mx/mz is the move input on the floor plane
   * (camera-relative, unit length or 0) for shimmying.
   */
  updateClimb(dt, input, f, mx, mz, boxes) {
    const c = this.climb;
    this.vel.set(0, 0, 0);
    this.running = false;
    this.climbSpeed = 0;
    if (c.mode === 'riser') {
      // Hand over hand: nothing happens until you push W or S.
      this.pos.y = Math.max(0, Math.min(CLIMB_TOP, this.pos.y + f * CLIMB_SPEED * dt));
      this.climbSpeed = Math.abs(f) * CLIMB_SPEED;
      if (this.pos.y >= CLIMB_TOP && f > 0) c.mode = 'hang';
      else if (this.pos.y <= 0 && f < 0) this.leavePipe(boxes);
      else if (input.pressed('KeyC')) this.drop();
    } else if (c.mode === 'hang') {
      if (input.pressed('Space')) c.style = c.style === 'legs' ? 'hands' : 'legs';
      // Whatever part of the input points along the pipe moves you along it.
      const d = c.pipe.dirAt(c.s);
      const along = mx * d.x + mz * d.z;
      const s0 = c.s;
      c.s = Math.max(END_PAD, Math.min(c.pipe.length - END_PAD, c.s + along * SHIMMY_SPEED[c.style] * dt));
      this.climbSpeed = Math.abs(c.s - s0) / dt;
      const p = c.pipe.pointAt(c.s);
      this.pos.set(p.x, CLIMB_TOP, p.z);
      if (this.climbSpeed > 0.05) {
        const sgn = along > 0 ? 1 : -1;
        this.facing = turnToward(this.facing, Math.atan2(-d.x * sgn, -d.z * sgn), 10 * dt);
      }
      if (input.pressed('KeyC')) this.drop();
    } else if (c.mode === 'drop') {
      this.vy -= GRAVITY * dt;
      this.pos.y += this.vy * dt;
      if (this.pos.y <= 0) { this.leavePipe(boxes); this.landed = true; }
    }
    this.applyMesh();
  }

  leavePipe(boxes) {
    this.climb = null;
    this.pos.y = 0;
    this.vy = 0;
    resolveCircle(this.pos, this.radius, boxes);
  }

  applyMesh() {
    if (this.tucked) {
      // Legs up: body lies along the pipe, head toward where he faces.
      this.body.scale.set(1, 1, 1);
      this.body.rotation.x = -Math.PI / 2;
      this.body.position.y = 0;
      this.group.position.set(this.pos.x, HANG_Y, this.pos.z);
      this.group.rotation.y = this.facing;
      return;
    }
    this.body.rotation.x = 0;
    const h = 1 - 0.42 * this.crouchBlend;
    this.body.scale.set(1, h, 1);
    this.body.position.y = (BODY_H / 2) * h;
    this.group.position.copy(this.pos);
    this.group.rotation.y = this.facing;
  }

  /** Feet, chest, head: where light and guard sight are sampled. */
  samplePoints() {
    const c = this.crouchBlend;
    const { x, y, z } = this.pos;
    if (this.tucked) {
      const fx = -Math.sin(this.facing) * 0.7;
      const fz = -Math.cos(this.facing) * 0.7;
      return [
        new THREE.Vector3(x - fx, HANG_Y, z - fz),
        new THREE.Vector3(x, HANG_Y, z),
        new THREE.Vector3(x + fx, HANG_Y + 0.05, z + fz),
      ];
    }
    return [
      new THREE.Vector3(x, y + 0.25, z),
      new THREE.Vector3(x, y + lerp(1.2, 0.7, c), z),
      new THREE.Vector3(x, y + lerp(1.65, 0.98, c), z),
    ];
  }

  /**
   * Footstep noise radius in metres (0 when still). Full radius at the stance's full speed:
   * crouch 1 m, walk 4 m, run 10 m (design doc starting values). Climbing and shimmying are crouch-quiet.
   */
  get noiseRadius() {
    if (this.climb) {
      if (this.climb.mode === 'drop') return 0; // the landing is a one-off noise (main.js)
      return CLIMB_NOISE * Math.min(1, this.climbSpeed / SHIMMY_SPEED.legs);
    }
    const v = this.speed;
    if (v < 0.2) return 0;
    let radius, full;
    if (this.grabbing) { radius = NOISE.drag; full = SPEED.drag; }
    else if (this.crouched) { radius = NOISE.crouch; full = SPEED.crouch; }
    else if (this.running && v > SPEED.walk + 0.2) { radius = NOISE.run; full = SPEED.run; }
    else { radius = NOISE.walk; full = SPEED.walk; }
    return radius * Math.min(1, v / full);
  }

  /** Camera pivot height above the feet (standing / crouching). */
  get eyeHeight() {
    return lerp(1.55, 1.05, this.crouchBlend);
  }

  /** Camera pivot height above the floor: follows climbs and hangs. */
  get viewHeight() {
    return this.tucked ? HANG_Y + 0.15 : this.pos.y + this.eyeHeight;
  }
}
