// Patrolling guard with a view cone and a 0–100 suspicion meter.
// States: patrol → suspicious (stops, turns to look) → investigate (walks to last seen spot)
//         → look (scans around) → back to patrol, warier. 100 suspicion = alert (player spotted).
// Every number below is a starting guess to tune in playtests.

import * as THREE from 'three';
import { segmentBlocked, resolveCircle } from './collision.js';
import { clamp, turnToward, wrapAngle, yawFromDir } from './utils.js';

const EYE_H = 1.65;
const FOV_HALF = Math.PI / 4;   // 90° cone
const RANGE = 12;               // m
const FILL = 80;                // points/s at full visibility, point blank
const DECAY = 10;               // points/s once the stimulus is lost
const HOLD = 1.0;               // s before decay starts
const WARY_MUL = 1.3;           // fill multiplier after a guard has investigated
const SUSPICIOUS_AT = 25;
const INVESTIGATE_AT = 50;
const CALM_AT = 10;
const WALK = 1.4;
const INVESTIGATE_WALK = 1.3;

export class Guard {
  constructor(scene, route) {
    this.route = route;
    this.group = new THREE.Group();

    const body = new THREE.Mesh(
      new THREE.CapsuleGeometry(0.33, 1.1, 6, 12),
      new THREE.MeshStandardMaterial({ color: 0x6b2a22, roughness: 0.8 })
    );
    body.position.y = 0.88;
    body.castShadow = true;
    const visor = new THREE.Mesh(
      new THREE.BoxGeometry(0.34, 0.1, 0.14),
      new THREE.MeshStandardMaterial({ color: 0xccbb99, roughness: 0.5 })
    );
    visor.position.set(0, 1.55, -0.28);
    visor.castShadow = true;
    this.group.add(body, visor);

    // Debug view cone on the floor (V toggles). Circle sector centred on local -z.
    const cone = new THREE.Mesh(
      new THREE.CircleGeometry(RANGE, 32, Math.PI / 2 - FOV_HALF, FOV_HALF * 2),
      new THREE.MeshBasicMaterial({ color: 0xffcc44, transparent: true, opacity: 0.12, depthWrite: false })
    );
    cone.rotation.x = -Math.PI / 2;
    cone.position.y = 0.02;
    cone.visible = false;
    this.cone = cone;
    this.group.add(cone);

    scene.add(this.group);
    this.pos = new THREE.Vector3();
    this.lastSeen = new THREE.Vector3();
    this.reset();
  }

  reset() {
    const w = this.route[0];
    this.pos.set(w.x, 0, w.z);
    this.yaw = w.lookYaw ?? 0;
    this.wp = 0;
    this.pauseTimer = w.pause ?? 0;
    this.state = 'patrol';
    this.stateTime = 0;
    this.suspicion = 0;
    this.sinceSeen = 99;
    this.seeing = false;
    this.visibility = 0;
    this.wary = false;
    this.applyMesh();
  }

  toggleCone() {
    this.cone.visible = !this.cone.visible;
  }

  get icon() {
    if (this.state === 'alert') return '!';
    if (this.state === 'patrol') return '';
    return '?';
  }

  setState(s) {
    this.state = s;
    this.stateTime = 0;
  }

  /** How visible the player is to this guard right now, 0..1. */
  perceive(samples, sampleLight, boxes) {
    const eye = new THREE.Vector3(this.pos.x, EYE_H, this.pos.z);
    const fx = -Math.sin(this.yaw);
    const fz = -Math.cos(this.yaw);
    const cosHalf = Math.cos(FOV_HALF);
    let vis = 0;
    for (let i = 0; i < samples.length; i++) {
      const p = samples[i];
      const dx = p.x - eye.x;
      const dz = p.z - eye.z;
      const d = Math.hypot(dx, p.y - eye.y, dz);
      if (d > RANGE) continue;
      const hd = Math.hypot(dx, dz);
      if (hd > 0.01 && (dx * fx + dz * fz) / hd < cosHalf) continue;
      if (segmentBlocked(eye, p, boxes)) continue;
      // Darkness hides you beyond ~2 m; up close it doesn't.
      const close = clamp((2.5 - d) / 1.0, 0, 1);
      vis += Math.max(sampleLight[i], close);
    }
    return vis / samples.length;
  }

  update(dt, player, samples, sampleLight, level) {
    const boxes = level.boxes;

    // --- Perception and the suspicion meter ---
    this.visibility = this.perceive(samples, sampleLight, boxes);
    this.seeing = this.visibility > 0.02;
    if (this.seeing) {
      const d = Math.hypot(player.pos.x - this.pos.x, player.pos.z - this.pos.z);
      const distF = 1 - 0.6 * Math.min(d / RANGE, 1);
      const rate = FILL * this.visibility * distF * (this.wary ? WARY_MUL : 1);
      this.suspicion = Math.min(100, this.suspicion + rate * dt);
      this.sinceSeen = 0;
      this.lastSeen.set(player.pos.x, 0, player.pos.z);
    } else {
      this.sinceSeen += dt;
      if (this.sinceSeen > HOLD) this.suspicion = Math.max(0, this.suspicion - DECAY * dt);
    }

    // --- Behaviour ---
    this.stateTime += dt;
    if (this.suspicion >= 100 && this.state !== 'alert') this.setState('alert');

    switch (this.state) {
      case 'patrol':
        this.patrol(dt, boxes);
        if (this.suspicion >= SUSPICIOUS_AT) this.setState('suspicious');
        break;

      case 'suspicious':
        this.face(this.lastSeen, 2.5 * dt);
        if (this.suspicion >= INVESTIGATE_AT && this.stateTime > 0.8) this.setState('investigate');
        else if (this.suspicion < CALM_AT) this.setState('patrol');
        break;

      case 'investigate': {
        const arrived = this.moveTo(this.lastSeen, INVESTIGATE_WALK, dt, boxes, 0.9);
        if (arrived || this.stateTime > 10) this.setState('look');
        break;
      }

      case 'look':
        if (this.seeing) {
          this.face(this.lastSeen, 3 * dt);
          const far = Math.hypot(this.lastSeen.x - this.pos.x, this.lastSeen.z - this.pos.z) > 1.5;
          if (far && this.suspicion >= INVESTIGATE_AT) this.setState('investigate');
        } else {
          this.yaw = wrapAngle(this.yaw + Math.sin(this.stateTime * 1.4) * 1.3 * dt);
        }
        if (this.stateTime > 4 && this.suspicion < SUSPICIOUS_AT) {
          this.wary = true;
          this.setState('patrol');
        }
        break;

      case 'alert':
        this.face(player.pos, 4 * dt);
        break;
    }
    this.applyMesh();
  }

  patrol(dt, boxes) {
    const w = this.route[this.wp];
    if (this.pauseTimer > 0) {
      this.pauseTimer -= dt;
      if (w.lookYaw !== undefined) this.yaw = turnToward(this.yaw, w.lookYaw, 2 * dt);
      if (this.pauseTimer <= 0) this.wp = (this.wp + 1) % this.route.length;
      return;
    }
    if (this.moveTo(w, WALK, dt, boxes, 0.25)) {
      this.pauseTimer = w.pause ?? 0;
      if (this.pauseTimer <= 0) this.wp = (this.wp + 1) % this.route.length;
    }
  }

  face(target, maxStep) {
    const dx = target.x - this.pos.x;
    const dz = target.z - this.pos.z;
    if (Math.hypot(dx, dz) < 0.05) return;
    this.yaw = turnToward(this.yaw, yawFromDir(dx, dz), maxStep);
  }

  /** Turn toward and walk to target; true once within `arriveDist`. */
  moveTo(target, speed, dt, boxes, arriveDist) {
    const dx = target.x - this.pos.x;
    const dz = target.z - this.pos.z;
    const dist = Math.hypot(dx, dz);
    if (dist < arriveDist) return true;
    const want = yawFromDir(dx, dz);
    this.yaw = turnToward(this.yaw, want, 4 * dt);
    if (Math.abs(wrapAngle(want - this.yaw)) < 0.6) {
      const step = Math.min(speed * dt, dist);
      this.pos.x += (dx / dist) * step;
      this.pos.z += (dz / dist) * step;
      resolveCircle(this.pos, 0.35, boxes);
    }
    return false;
  }

  applyMesh() {
    this.group.position.copy(this.pos);
    this.group.rotation.y = this.yaw;
  }
}
