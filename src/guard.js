// Patrolling guard with a view cone, hearing and a 0–100 suspicion meter.
// States: patrol → suspicious (stops, turns to the stimulus) → investigate (walks to it)
//         → look (scans around) → back to patrol, warier.
//         relight: a guard who sees a dead light walks to its switch and turns it back on.
//         alert: 100 suspicion = player spotted.
// Sight can fill the meter to 100; sound alone can only bring a guard to investigate (NOISE_CAP).
// Every number below is a starting guess to tune in playtests.

import * as THREE from 'three';
import { segmentBlocked, resolveCircle } from './collision.js';
import { findPath } from './nav.js';
import { clamp, turnToward, wrapAngle, yawFromDir } from './utils.js';

const EYE_H = 1.65;
const FOV_HALF = Math.PI / 3;   // 120° cone (design doc)
const RANGE = 12;               // m
const FILL = 80;                // points/s at full visibility, point blank
const NOISE_FILL = 60;          // points/s when a noise is right next to the guard
const NOISE_CAP = 75;           // sound alone never takes suspicion past this
const WALL_MUFFLE = 0.5;        // a wall between halves how far a noise carries
const DECAY = 10;               // points/s once the stimulus is lost
const HOLD = 1.0;               // s before decay starts
const WARY_MUL = 1.3;           // fill multiplier after a guard has investigated
const DARK_NOTICE = 14;         // m: a guard notices a dead light he has line of sight to within this range
const HEAR_REACT_AT = 12;       // a heard noise this loud (in suspicion) sends him to check it out
const SUSPICIOUS_AT = 25;
const IMPACT_SUSPICION = 20;    // added by a heard smash (thrown bottle), scaled by loudness
const GRAB_MAX = 8;             // s before a grabbed guard struggles free
export const KO_TIME = 3;       // s the knockout takes (design doc: about 3 s)
const TAKEDOWN_RANGE = 1.4;     // m
const REAR_COS = Math.cos((110 * Math.PI) / 180); // player must be in the rear arc (>110° off his facing)
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
    this.rig = new THREE.Group(); // pivot at the feet: lean back when grabbed, fall when knocked out
    this.rig.add(body, visor);
    this.group.add(this.rig);

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
    this.stimulus = new THREE.Vector3(); // where he last saw or heard the player
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
    this.sinceStimulus = 99;
    this.seeing = false;
    this.hearing = false;
    this.visibility = 0;
    this.wary = false;
    this.knownDark = new Set(); // ids of dead lights this guard has noticed
    this.relight = null;        // { group, sw, flipAt }
    this.path = null;
    this.pathTarget = null;
    this.stimulusKind = null;   // 'sight' | 'sound'
    this.grabTime = 0;
    this.koTime = 0;
    this.brokeFree = false;
    this.rig.rotation.set(0, 0, 0);
    this.rig.position.set(0, 0, 0);
    this.applyMesh();
  }

  /** Out of action or held: no senses, no patrol. */
  get disabled() {
    return this.state === 'grabbed' || this.state === 'ko' || this.state === 'down';
  }

  /** Player close behind an unaware guard. */
  canTakedown(player) {
    if (this.disabled || this.state === 'alert' || this.seeing) return false;
    const dx = player.pos.x - this.pos.x;
    const dz = player.pos.z - this.pos.z;
    const d = Math.hypot(dx, dz);
    if (d > TAKEDOWN_RANGE || d < 0.05) return false;
    return (dx * -Math.sin(this.yaw) + dz * -Math.cos(this.yaw)) / d < REAR_COS;
  }

  grab() { this.setState('grabbed'); this.grabTime = 0; this.suspicion = 0; }
  get grip() { return Math.max(0, 1 - this.grabTime / GRAB_MAX); }
  knockOut() { this.setState('ko'); this.koTime = 0; }
  breakFree() { this.rig.rotation.x = 0; this.suspicion = 100; this.setState('alert'); }

  toggleCone() {
    this.cone.visible = !this.cone.visible;
  }

  get icon() {
    if (this.state === 'alert') return '!';
    if (this.state === 'patrol' || this.disabled) return '';
    return '?';
  }

  setState(s) {
    this.state = s;
    this.stateTime = 0;
    this.path = null;
    this.pathTarget = null;
  }

  eye() {
    return new THREE.Vector3(this.pos.x, EYE_H, this.pos.z);
  }

  /** How visible the player is to this guard right now, 0..1. */
  perceive(samples, sampleLight, boxes) {
    const eye = this.eye();
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

  /** 0..1 loudness of the player's footsteps at this guard (0 = not heard). */
  listen(noise, boxes) {
    if (!noise || noise.radius <= 0) return 0;
    const d = Math.hypot(noise.pos.x - this.pos.x, noise.pos.z - this.pos.z);
    let reach = noise.radius;
    if (d > reach) return 0;
    const from = new THREE.Vector3(this.pos.x, 1.2, this.pos.z);
    const to = new THREE.Vector3(noise.pos.x, 1.2, noise.pos.z);
    if (segmentBlocked(from, to, boxes)) reach *= WALL_MUFFLE;
    if (d > reach) return 0;
    return 1 - 0.5 * (d / reach);
  }

  /**
   * A one-off loud noise (a thrown bottle smashing). If he hears it he turns to it, then walks over
   * to check it out. Sound alone still can't take suspicion past NOISE_CAP. Returns true if heard.
   */
  hearImpact(pos, radius, boxes) {
    if (this.disabled || this.state === 'alert') return false;
    const loud = this.listen({ pos, radius }, boxes);
    if (loud <= 0) return false;
    this.suspicion = Math.min(NOISE_CAP, Math.max(this.suspicion, SUSPICIOUS_AT) + IMPACT_SUSPICION * loud);
    this.stimulus.set(pos.x, 0, pos.z);
    this.stimulusKind = 'sound';
    this.sinceStimulus = 0;
    if (this.state === 'investigate' || this.state === 'look') this.setState('investigate');
    else if (this.state !== 'suspicious') { this.relight = null; this.setState('suspicious'); }
    return true;
  }

  /** Remember dead lights he can see; forget ones that came back on. */
  checkLights(level) {
    const eye = this.eye();
    for (const L of level.lights) {
      if (L.on) { this.knownDark.delete(L.id); continue; }
      if (this.knownDark.has(L.id)) continue;
      if (eye.distanceTo(L.pos) > DARK_NOTICE) continue;
      if (segmentBlocked(eye, L.pos, level.boxes)) continue;
      this.knownDark.add(L.id);
    }
  }

  /** Switch for the nearest dead light he knows about, or null. */
  pickRelight(level) {
    let best = null;
    let bestD = Infinity;
    for (const L of level.lights) {
      if (L.on || !this.knownDark.has(L.id)) continue;
      const sw = level.switchFor(L.group);
      if (!sw) continue;
      const d = Math.hypot(sw.pos.x - this.pos.x, sw.pos.z - this.pos.z);
      if (d < bestD) { bestD = d; best = { group: L.group, sw, flipAt: -1 }; }
    }
    return best;
  }

  update(dt, player, samples, sampleLight, level, noise) {
    const boxes = level.boxes;
    if (this.disabled) { this.updateDisabled(dt); this.applyMesh(); return; }

    // --- Senses and the suspicion meter ---
    const mul = this.wary ? WARY_MUL : 1;
    this.visibility = this.perceive(samples, sampleLight, boxes);
    this.seeing = this.visibility > 0.02;
    const loud = this.listen(noise, boxes);
    this.hearing = loud > 0;

    if (this.seeing) {
      const d = Math.hypot(player.pos.x - this.pos.x, player.pos.z - this.pos.z);
      const distF = 1 - 0.6 * Math.min(d / RANGE, 1);
      this.suspicion = Math.min(100, this.suspicion + FILL * this.visibility * distF * mul * dt);
    }
    if (this.hearing && this.suspicion < NOISE_CAP) {
      this.suspicion = Math.min(NOISE_CAP, this.suspicion + NOISE_FILL * loud * mul * dt);
    }
    if (this.seeing || this.hearing) {
      this.stimulusKind = this.seeing ? 'sight' : 'sound';
      this.sinceStimulus = 0;
      this.stimulus.set(player.pos.x, 0, player.pos.z);
    } else {
      this.sinceStimulus += dt;
      if (this.sinceStimulus > HOLD) this.suspicion = Math.max(0, this.suspicion - DECAY * dt);
    }

    if (this.state !== 'alert') this.checkLights(level);

    // --- Behaviour ---
    this.stateTime += dt;
    if (this.suspicion >= 100 && this.state !== 'alert') this.setState('alert');

    switch (this.state) {
      case 'patrol': {
        if (this.suspicion >= SUSPICIOUS_AT || (this.hearing && this.suspicion >= HEAR_REACT_AT)) { this.setState('suspicious'); break; }
        const job = this.pickRelight(level);
        if (job) { this.relight = job; this.setState('relight'); break; }
        this.patrol(dt, boxes, level);
        break;
      }

      case 'relight': {
        if (this.suspicion >= SUSPICIOUS_AT || (this.hearing && this.suspicion >= HEAR_REACT_AT)) { this.setState('suspicious'); break; }
        const job = this.relight;
        const groupOn = level.lights.some((l) => l.group === job.group && l.on);
        if (groupOn) { this.relight = null; this.setState('look'); break; } // someone else switched it on
        if (job.flipAt < 0) {
          if (this.moveTo(job.sw.pos, WALK, dt, boxes, level, 0.45)) job.flipAt = this.stateTime + 0.6;
        } else if (this.stateTime >= job.flipAt) {
          level.setGroup(job.group, true);
          this.relight = null;
          this.wary = true;
          this.setState('look');
        }
        break;
      }

      case 'suspicious':
        this.face(this.stimulus, 2.5 * dt);
        // A noise always gets checked out; a glimpse only once he is fairly sure.
        if (this.stimulusKind === 'sound' && this.stateTime > 0.7) this.setState('investigate');
        else if (this.suspicion >= INVESTIGATE_AT && this.stateTime > 0.8) this.setState('investigate');
        else if (this.suspicion < CALM_AT) this.setState('patrol');
        break;

      case 'investigate': {
        const arrived = this.moveTo(this.stimulus, INVESTIGATE_WALK, dt, boxes, level, 0.9);
        if (arrived || this.stateTime > 12) this.setState('look');
        break;
      }

      case 'look':
        if (this.seeing || this.hearing) {
          this.face(this.stimulus, 3 * dt);
          const far = Math.hypot(this.stimulus.x - this.pos.x, this.stimulus.z - this.pos.z) > 1.5;
          if (far && (this.hearing || this.suspicion >= INVESTIGATE_AT)) { this.setState('investigate'); break; }
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

  updateDisabled(dt) {
    this.seeing = false;
    this.hearing = false;
    this.visibility = 0;
    if (this.state === 'grabbed') {
      this.grabTime += dt;
      this.rig.rotation.x = 0.22 + Math.sin(this.grabTime * 9) * 0.05; // leaning back, squirming
      this.rig.rotation.z = Math.sin(this.grabTime * 6.3) * 0.08;
    } else if (this.state === 'ko') {
      this.koTime += dt;
      const fade = 1 - this.koTime / KO_TIME;  // struggle weakens
      this.rig.rotation.x = 0.3 + Math.sin(this.koTime * 11) * 0.09 * fade;
      this.rig.rotation.z = Math.sin(this.koTime * 8) * 0.12 * fade;
      if (this.koTime >= KO_TIME) { this.setState('down'); this.koTime = 0; }
    } else if (this.state === 'down') {
      // Slump forward onto the floor over ~0.6 s.
      this.koTime += dt;
      const t = Math.min(1, this.koTime / 0.6);
      const e = t * t;
      this.rig.rotation.x = 0.3 + (-Math.PI / 2 + 0.05 - 0.3) * e;
      this.rig.rotation.z = 0;
      this.rig.position.y = 0.33 * e; // capsule radius, so he lies on the floor rather than in it
    }
  }

  patrol(dt, boxes, level) {
    const w = this.route[this.wp];
    if (this.pauseTimer > 0) {
      this.pauseTimer -= dt;
      if (w.lookYaw !== undefined) this.yaw = turnToward(this.yaw, w.lookYaw, 2 * dt);
      if (this.pauseTimer <= 0) this.wp = (this.wp + 1) % this.route.length;
      return;
    }
    if (this.moveTo(w, WALK, dt, boxes, level, 0.25)) {
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

  /** Walk to target along a nav path; true once within `arriveDist`. */
  moveTo(target, speed, dt, boxes, level, arriveDist) {
    if (Math.hypot(target.x - this.pos.x, target.z - this.pos.z) < arriveDist) return true;

    // Re-plan when the target moves, and every second in case he got shoved off course.
    const moved = !this.pathTarget || Math.hypot(target.x - this.pathTarget.x, target.z - this.pathTarget.z) > 0.75;
    this.replanIn = (this.replanIn ?? 0) - dt;
    if (!this.path || moved || this.replanIn <= 0) {
      this.path = findPath(this.pos, target, level.navNodes, boxes);
      this.pathTarget = new THREE.Vector3(target.x, 0, target.z);
      this.replanIn = 1;
    }
    while (this.path.length > 1 && Math.hypot(this.path[0].x - this.pos.x, this.path[0].z - this.pos.z) < 0.3) {
      this.path.shift();
    }
    const next = this.path[0];
    const dx = next.x - this.pos.x;
    const dz = next.z - this.pos.z;
    const dist = Math.hypot(dx, dz);
    if (dist < 1e-4) return false;
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
