// Patrolling guard with a view cone, hearing and a 0–100 suspicion meter.
// States: patrol → suspicious (stops, turns to the stimulus) → investigate (walks to it)
//         → look (scans around) → back to patrol, warier.
//         search: after a close call (suspicion got high, or he found a body) he doesn't just look around,
//                 he walks a few spots around where it happened, looking at each, then patrols warier.
//         relight: a guard who sees a dead light walks to its switch and turns it back on.
//         check: on patrol, detours to a remembered spot (noise heard, player seen, dead light found),
//                looks around, then carries on with the route.
//         hunt: 100 suspicion = full alert. He radios the others; every guard hunts the player, sharing
//               where he was last seen or heard, and shoots on sight. If nobody finds him for a while the
//               alert ends and they go back to patrol, warier.
// Evidence: a shot-out light, a door the player left open, or a guard lying on the floor makes him
// suspicious and sends him to look (capped at NOISE_CAP like sound).
// Sight can fill the meter to 100; sound alone can only bring a guard to investigate (NOISE_CAP).
// Every number below is a starting guess to tune in playtests.

import * as THREE from 'three';
import { segmentBlocked, resolveCircle } from './collision.js';
import { findPath } from './nav.js';
import { lightAt } from './lighting.js';
import { clamp, turnToward, wrapAngle, yawFromDir } from './utils.js';

const EYE_H = 1.65;
const FOV_HALF = Math.PI / 3;   // 120° cone (design doc)
const RANGE = 12;               // m
const LOOK_UP = Math.tan((30 * Math.PI) / 180); // guards don't look up: nothing more than 30° above eye level is seen (guess)
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
const EVIDENCE_SUSPICION = 25;  // added when he spots a shot-out light (guess)
const GRAB_MAX = 8;             // s before a grabbed guard struggles free
export const KO_TIME = 3;       // s the knockout takes (design doc: about 3 s)
const TAKEDOWN_RANGE = 1.4;     // m
const REAR_COS = Math.cos((110 * Math.PI) / 180); // player must be in the rear arc (>110° off his facing)
const INVESTIGATE_AT = 50;
const CALM_AT = 10;
const WALK = 1.4;
const MEMORY_MERGE = 3;         // m: events this close count as the same remembered spot
const CHECK_EVERY = 20;         // s of patrol between detours to remembered spots (guess)
const CHECK_LOOK = 3.5;         // s spent looking around at a remembered spot
const MEMORY_WEIGHT = { sound: 1, sight: 2, light: 1 }; // how much each event makes a spot worth checking
const INVESTIGATE_WALK = 1.3;
const DOOR_SUSPICION = 20;      // added when he spots a door the player left open (guess)
const BODY_SUSPICION = 45;      // added when he finds a guard lying on the floor (guess)
const BODY_SEEN_LIGHT = 0.15;   // a body in darker light than this is only seen up close (guess)
const SEARCH_AT = 55;           // peak suspicion that turns "look around" into a search (guess)
const SEARCH_AREA = 8;          // m: search spots are nav nodes this close to where it happened (guess)
const SEARCH_SPOTS = 3;         // spots he walks to (guess)
const SEARCH_LOOK = 2.5;        // s looking around at each (guess)
// Full alert (all guesses):
const HUNT_RUN = 3.0;           // m/s while hunting
const HUNT_LOOK = 3;            // s spent looking around at each search spot
export const HUNT_GIVE_UP = 40; // s with nobody seeing or hearing the player before the alert ends
const SEARCH_R = 10;            // m: search spots are nav nodes this close to the last known position
const FIRE_RANGE = 10;          // m: closer than this he stands and shoots; further, he closes in
const AIM_TIME = 0.8;           // s from seeing the player to the first shot
const FIRE_EVERY = 1.1;         // s between shots
const GUN_NOISE = 12;           // m: an unsuppressed guard pistol

/** Shared knowledge for all guards: one full alert at a time. Created once in main.js. */
export function makeSquad() {
  return {
    guards: [],
    time: 0,
    alerted: false, // full alert reached at some point this run (rating)
    hunt: { active: false, pos: new THREE.Vector3(), t: 0, version: 0, searched: new Map() },
    shots: [],      // guard gunshots this step: { from, to, hit, guard, noise }, read by main.js
  };
}

export function resetSquad(squad) {
  squad.time = 0;
  squad.alerted = false;
  squad.hunt.active = false;
  squad.hunt.version = 0;
  squad.hunt.searched.clear();
  squad.shots.length = 0;
}

/** Ends the alert once nobody has seen or heard the player for HUNT_GIVE_UP s (or nobody is left to hunt). */
export function updateSquad(squad, dt) {
  squad.time += dt;
  const h = squad.hunt;
  if (!h.active) return;
  const hunters = squad.guards.filter((g) => g.active && g.state === 'hunt');
  if (hunters.length && squad.time - h.t < HUNT_GIVE_UP) return;
  h.active = false;
  for (const g of hunters) g.standDown();
}

export class Guard {
  constructor(scene, route, squad) {
    this.route = route;
    this.squad = squad;
    squad.guards.push(this);
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
    // Debug markers for remembered spots (shown with the view cone on V).
    this.markerGroup = new THREE.Group();
    this.markerGroup.visible = false;
    scene.add(this.markerGroup);
    this.markerGeo = new THREE.RingGeometry(0.35, 0.45, 20);
    this.markerMat = new THREE.MeshBasicMaterial({ color: 0xff8844, transparent: true, opacity: 0.5,
      depthWrite: false, side: THREE.DoubleSide });
    this.pos = new THREE.Vector3();
    this.stimulus = new THREE.Vector3(); // where he last saw or heard the player
    this.reset();
  }

  reset() {
    this.active = true;
    this.group.visible = true;
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
    this.knownDoors = new Set(); // doors he has seen left open (forgotten once closed)
    this.knownBodies = new Set(); // guards he has found on the floor
    this.closeDoor = null;      // a player-opened door he means to shut once he gets there
    this.openedDoor = null;     // a door he opened himself to walk through; he shuts it behind him
    this.aim = 0;               // s spent aiming at the player during a hunt
    this.accuracy = 0;          // hit-chance accumulator (deterministic: a hit each time it passes 1)
    this.huntGoal = null;
    this.huntVersion = -1;
    this.huntLookAt = null;
    this.huntGoalTime = 0;
    this.peak = 0;              // highest suspicion since he was last on patrol
    this.mustSearch = false;    // found a body: always search afterwards
    this.searchSpots = [];
    this.searchCentre = new THREE.Vector3();
    this.searchLookAt = null;
    this.searchGoalTime = 0;
    this.relight = null;        // { group, sw, flipAt }
    this.path = null;
    this.pathTarget = null;
    this.stimulusKind = null;   // 'sight' | 'sound' | 'evidence' (a shot-out light)
    this.grabTime = 0;
    this.koTime = 0;
    this.brokeFree = false;
    this.clock = 0;
    this.memory = [];           // [{ pos, weight, lastChecked }] spots worth patrolling (for the whole mission)
    this.checkCooldown = CHECK_EVERY;
    this.checkSpot = null;
    this.markerGroup.clear();
    this.rig.rotation.set(0, 0, 0);
    this.rig.position.set(0, 0, 0);
    this.applyMesh();
  }

  /** Take him out of the level entirely (used by tests that need a single guard). */
  setActive(on) {
    this.active = on;
    this.group.visible = on;
    if (!on) this.markerGroup.visible = false;
  }

  /** Out of action or held: no senses, no patrol. */
  get disabled() {
    return this.state === 'grabbed' || this.state === 'ko' || this.state === 'down' || this.state === 'dead';
  }

  /** Player close behind an unaware guard. */
  canTakedown(player) {
    if (!this.active || this.disabled || this.seeing) return false;
    const dx = player.pos.x - this.pos.x;
    const dz = player.pos.z - this.pos.z;
    const d = Math.hypot(dx, dz);
    if (d > TAKEDOWN_RANGE || d < 0.05) return false;
    return (dx * -Math.sin(this.yaw) + dz * -Math.cos(this.yaw)) / d < REAR_COS;
  }

  grab() { this.setState('grabbed'); this.grabTime = 0; this.suspicion = 0; }
  get grip() { return Math.max(0, 1 - this.grabTime / GRAB_MAX); }
  knockOut() { this.setState('ko'); this.koTime = 0; }
  /** Landed on from above (dropped from a pipe): straight down, no struggle. */
  dropKnockOut() { this.suspicion = 0; this.setState('down'); this.koTime = 0; }
  /** Shot: falls and stays down for good. */
  kill() { this.suspicion = 0; this.setState('dead'); this.koTime = 0; this.rig.rotation.set(0.3, 0, 0); }
  breakFree(playerPos) {
    this.rig.rotation.set(0, 0, 0);
    this.stimulus.set(playerPos.x, 0, playerPos.z);
    this.joinHunt();
    this.raiseAlert(playerPos);
  }

  /** Full alert: this guard radios the player's position and every guard who can joins the hunt. */
  raiseAlert(pos) {
    const sq = this.squad;
    const h = sq.hunt;
    sq.alerted = true;
    if (!h.active) h.searched.clear();
    h.active = true;
    this.report(pos);
    for (const g of sq.guards) if (g.active && !g.disabled && g.state !== 'hunt') g.joinHunt();
  }

  /** Share a sighting or a heard noise with the other hunters. */
  report(pos) {
    const h = this.squad.hunt;
    h.pos.set(pos.x, 0, pos.z);
    h.t = this.squad.time;
    h.version++;
  }

  joinHunt() {
    this.relight = null;
    this.checkSpot = null;
    this.suspicion = 100;
    this.wary = true;
    this.aim = 0;
    this.huntGoal = null;
    this.huntVersion = -1;
    this.setState('hunt');
  }

  /** Alert over: back to patrol, warier, remembering where the player was last known to be. */
  standDown() {
    this.remember(this.squad.hunt.pos, 'sight');
    this.suspicion = SUSPICIOUS_AT + 15;
    this.stimulus.copy(this.squad.hunt.pos);
    this.stimulusKind = 'sight';
    this.wary = true;
    this.setState('look');
  }

  toggleCone() {
    this.cone.visible = !this.cone.visible;
    this.markerGroup.visible = this.cone.visible && this.active;
  }

  get icon() {
    if (this.state === 'hunt') return '!';
    if (this.state === 'patrol' || this.state === 'check' || this.disabled) return '';
    return '?';
  }

  /** Remember a spot where something happened; nearby events stack onto the same spot. */
  remember(pos, kind) {
    const w = MEMORY_WEIGHT[kind] ?? 1;
    let spot = this.memory.find((m) => Math.hypot(m.pos.x - pos.x, m.pos.z - pos.z) < MEMORY_MERGE);
    if (spot) spot.weight += w;
    else {
      spot = { pos: new THREE.Vector3(pos.x, 0, pos.z), weight: w, lastChecked: this.clock };
      this.memory.push(spot);
      const marker = new THREE.Mesh(this.markerGeo, this.markerMat);
      marker.rotation.x = -Math.PI / 2;
      marker.position.set(pos.x, 0.04, pos.z);
      this.markerGroup.add(marker);
      spot.marker = marker;
    }
    spot.lastChecked = this.clock; // he has just been dealing with it
    spot.marker.scale.setScalar(Math.min(2, 0.8 + 0.2 * spot.weight));
    this.checkCooldown = Math.max(this.checkCooldown, CHECK_EVERY);
  }

  /** Remembered spot most worth a look: busy spots and ones not checked for a while win. */
  pickMemory() {
    let best = null;
    let bestScore = 0;
    for (const m of this.memory) {
      const score = m.weight * (this.clock - m.lastChecked + 5);
      if (score > bestScore) { bestScore = score; best = m; }
    }
    return best;
  }

  setState(s) {
    if (s === 'investigate') this.remember(this.stimulus, this.stimulusKind === 'sight' ? 'sight' : 'sound');
    else if (s === 'suspicious' && this.stimulusKind === 'sight') this.remember(this.stimulus, 'sight');
    if (s === 'patrol') { this.peak = 0; this.mustSearch = false; }
    this.state = s;
    this.checkLookFrom = undefined;
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
      if (p.y - eye.y > hd * LOOK_UP) continue;
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
    if (!this.active || this.disabled) return false;
    const loud = this.listen({ pos, radius }, boxes);
    if (loud <= 0) return false;
    if (this.state === 'hunt') { this.report(pos); return true; }
    this.suspicion = Math.min(NOISE_CAP, Math.max(this.suspicion, SUSPICIOUS_AT) + IMPACT_SUSPICION * loud);
    this.stimulus.set(pos.x, 0, pos.z);
    this.stimulusKind = 'sound';
    this.sinceStimulus = 0;
    if (this.state === 'investigate' || this.state === 'look') this.setState('investigate');
    else if (this.state !== 'suspicious') { this.relight = null; this.setState('suspicious'); }
    return true;
  }

  /**
   * Something is wrong (a shot-out light, an open door, a body): he gets suspicious, walks over to look and
   * searches. Like sound, this alone can't take suspicion past NOISE_CAP.
   */
  noticeEvidence(pos, amount = EVIDENCE_SUSPICION) {
    if (!this.active || this.disabled || this.state === 'hunt') return;
    this.wary = true;
    this.suspicion = Math.min(NOISE_CAP, Math.max(this.suspicion, SUSPICIOUS_AT) + amount);
    this.stimulus.set(pos.x, 0, pos.z);
    this.stimulusKind = 'evidence';
    this.sinceStimulus = 0;
    this.relight = null;
    if (this.state === 'investigate' || this.state === 'look') this.setState('investigate');
    else if (this.state !== 'suspicious') this.setState('suspicious');
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
      const sw = L.broken ? null : level.switchFor(L.group); // a shot-out light: remember the light itself
      this.remember(sw ? sw.pos : L.pos, 'light');
      if (L.broken) this.noticeEvidence(L.pos);
    }
  }

  /** True if point p (at any height) is inside his view cone and range, with nothing solid in the way. */
  canSee(p, boxes, range = RANGE) {
    const eye = this.eye();
    const dx = p.x - eye.x;
    const dz = p.z - eye.z;
    const hd = Math.hypot(dx, dz);
    if (Math.hypot(hd, p.y - eye.y) > range) return false;
    if (hd > 0.01 && (dx * -Math.sin(this.yaw) + dz * -Math.cos(this.yaw)) / hd < Math.cos(FOV_HALF)) return false;
    return !segmentBlocked(eye, p, boxes);
  }

  /** Doors the player left open, seen for the first time: suspicious, he goes over and shuts them. */
  checkDoors(level) {
    for (const door of level.doors) {
      if (!door.open || door.openedBy !== 'player') { this.knownDoors.delete(door); continue; }
      if (this.knownDoors.has(door)) continue;
      if (!this.canSee(door.center, level.boxes, DARK_NOTICE)) continue;
      this.knownDoors.add(door);
      // Look from his own side of the doorway (walking to the middle of it would take him through).
      const n = door.normal;
      const side = Math.sign((this.pos.x - door.center.x) * n.x + (this.pos.z - door.center.z) * n.z) || 1;
      const spot = new THREE.Vector3(door.center.x + n.x * side * 0.9, 0, door.center.z + n.z * side * 0.9);
      this.remember(spot, 'light');
      this.closeDoor = door;
      this.noticeEvidence(spot, DOOR_SUSPICION);
    }
  }

  /** Guards lying on the floor (knocked out or dead) he can see: suspicious, he goes to the body. */
  checkBodies(level) {
    for (const g of this.squad.guards) {
      if (g === this || !g.active || (g.state !== 'down' && g.state !== 'dead')) continue;
      if (this.knownBodies.has(g)) continue;
      const p = new THREE.Vector3(g.pos.x, 0.35, g.pos.z);
      const d = Math.hypot(p.x - this.pos.x, p.z - this.pos.z);
      if (d > 2.5 && lightAt(p, level) < BODY_SEEN_LIGHT) continue; // dark hides a body, except up close
      if (!this.canSee(p, level.boxes)) continue;
      this.knownBodies.add(g);
      this.remember(g.pos, 'sight');
      this.noticeEvidence(g.pos, BODY_SUSPICION);
      this.mustSearch = true;
    }
  }

  /** Doors: open a closed one that's in his way, shut the one he came through, shut one the player left open. */
  handleDoors(level) {
    for (const door of level.doors) {
      if (door.open) continue;
      const next = this.path && this.path[0];
      if (!next || Math.hypot(door.center.x - this.pos.x, door.center.z - this.pos.z) > 1.1) continue;
      const a = new THREE.Vector3(this.pos.x, 1, this.pos.z);
      const b = new THREE.Vector3(next.x, 1, next.z);
      if (!segmentBlocked(a, b, [door.box])) continue;
      level.setDoor(door, true, 'guard');
      this.openedDoor = door;
    }
    const mine = this.openedDoor;
    if (mine && (!mine.open || mine.openedBy !== 'guard')) this.openedDoor = null;
    else if (mine && this.state !== 'hunt'
      && Math.hypot(mine.center.x - this.pos.x, mine.center.z - this.pos.z) > 1.6) {
      if (level.setDoor(mine, false)) this.openedDoor = null;
    }
    const left = this.closeDoor;
    if (left && !left.open) this.closeDoor = null;
    else if (left && this.state !== 'hunt'
      && Math.hypot(left.center.x - this.pos.x, left.center.z - this.pos.z) < 2.0) {
      if (level.setDoor(left, false)) this.closeDoor = null;
    }
  }

  /** Switch for the nearest dead light he knows about, or null. */
  pickRelight(level) {
    let best = null;
    let bestD = Infinity;
    for (const L of level.lights) {
      if (L.on || L.broken || !this.knownDark.has(L.id)) continue;
      const sw = level.switchFor(L.group);
      if (!sw) continue;
      const d = Math.hypot(sw.pos.x - this.pos.x, sw.pos.z - this.pos.z);
      if (d < bestD) { bestD = d; best = { group: L.group, sw, flipAt: -1 }; }
    }
    return best;
  }

  update(dt, player, samples, sampleLight, level, noise) {
    const boxes = level.boxes;
    if (!this.active) return;
    this.clock += dt;
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
      if (this.state === 'hunt') this.report(player.pos);
    } else if (this.state === 'hunt') {
      this.sinceStimulus += dt;
    } else {
      this.sinceStimulus += dt;
      if (this.sinceStimulus > HOLD) this.suspicion = Math.max(0, this.suspicion - DECAY * dt);
    }

    if (this.state !== 'hunt') {
      this.checkLights(level);
      this.checkDoors(level);
      this.checkBodies(level);
    }

    // --- Behaviour ---
    this.stateTime += dt;
    this.peak = Math.max(this.peak, this.suspicion);
    if (this.suspicion >= 100 && this.state !== 'hunt') { this.joinHunt(); this.raiseAlert(player.pos); }

    switch (this.state) {
      case 'patrol': {
        if (this.suspicion >= SUSPICIOUS_AT || (this.hearing && this.suspicion >= HEAR_REACT_AT)) { this.setState('suspicious'); break; }
        const job = this.pickRelight(level);
        if (job) { this.relight = job; this.setState('relight'); break; }
        this.checkCooldown -= dt;
        if (this.checkCooldown <= 0 && this.pauseTimer <= 0) {
          const spot = this.pickMemory();
          if (spot) { this.checkSpot = spot; this.setState('check'); break; }
        }
        this.patrol(dt, boxes, level);
        break;
      }

      case 'check': {
        // Calm detour to a remembered spot: walk there, look around, back to the route.
        if (this.suspicion >= SUSPICIOUS_AT || (this.hearing && this.suspicion >= HEAR_REACT_AT)) { this.setState('suspicious'); break; }
        const spot = this.checkSpot;
        if (this.checkLookFrom === undefined) {
          if (this.moveTo(spot.pos, WALK, dt, boxes, level, 1.0) || this.stateTime > 15) this.checkLookFrom = this.stateTime;
        } else {
          this.yaw = wrapAngle(this.yaw + Math.sin((this.stateTime - this.checkLookFrom) * 1.6) * 1.4 * dt);
          if (this.stateTime - this.checkLookFrom > CHECK_LOOK) {
            spot.lastChecked = this.clock;
            this.checkSpot = null;
            this.checkCooldown = CHECK_EVERY;
            this.setState('patrol');
          }
        }
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
        if ((this.stimulusKind === 'sound' || this.stimulusKind === 'evidence') && this.stateTime > 0.7) this.setState('investigate');
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
          if (this.peak >= SEARCH_AT || this.mustSearch) this.startSearch(level);
          else this.setState('patrol');
        }
        break;

      case 'search': {
        if (this.suspicion >= SUSPICIOUS_AT || (this.hearing && this.suspicion >= HEAR_REACT_AT)) { this.setState('suspicious'); break; }
        const spot = this.searchSpots[0];
        if (!spot) { this.wary = true; this.setState('patrol'); break; }
        if (this.searchLookAt === null) {
          const there = this.moveTo(spot, INVESTIGATE_WALK, dt, boxes, level, 0.6);
          if (there || this.stateTime - this.searchGoalTime > 12) this.searchLookAt = this.stateTime;
        } else {
          this.yaw = wrapAngle(this.yaw + Math.sin((this.stateTime - this.searchLookAt) * 1.6) * 1.5 * dt);
          if (this.stateTime - this.searchLookAt > SEARCH_LOOK) {
            this.searchSpots.shift();
            this.searchLookAt = null;
            this.searchGoalTime = this.stateTime;
          }
        }
        break;
      }

      case 'hunt':
        this.suspicion = 100;
        this.hunt(dt, player, level);
        break;
    }
    this.handleDoors(level);
    this.applyMesh();
  }

  /** Pick up to SEARCH_SPOTS nav nodes around where it happened, nearest first, and start walking them. */
  startSearch(level) {
    const c = this.searchCentre.copy(this.stimulus);
    const pool = level.navNodes
      .filter((n) => Math.hypot(n.x - c.x, n.z - c.z) <= SEARCH_AREA)
      .sort((a, b) => Math.hypot(a.x - c.x, a.z - c.z) - Math.hypot(b.x - c.x, b.z - c.z))
      .slice(0, SEARCH_SPOTS + 1)
      .filter((n) => Math.hypot(n.x - this.pos.x, n.z - this.pos.z) > 1.2); // not the spot he's standing on
    // Walk them in a chain: always the nearest one left.
    const order = [];
    let from = this.pos;
    while (pool.length && order.length < SEARCH_SPOTS) {
      let bi = 0;
      for (let i = 1; i < pool.length; i++) {
        if (Math.hypot(pool[i].x - from.x, pool[i].z - from.z) < Math.hypot(pool[bi].x - from.x, pool[bi].z - from.z)) bi = i;
      }
      from = pool.splice(bi, 1)[0];
      order.push(from.clone());
    }
    this.setState('search');
    this.searchSpots = order;
    this.searchLookAt = null;
    this.searchGoalTime = 0;
  }

  /** Full alert: shoot the player on sight, otherwise run to where he was last known to be and search around it. */
  hunt(dt, player, level) {
    const boxes = level.boxes;
    const h = this.squad.hunt;
    if (this.seeing) {
      const d = Math.hypot(player.pos.x - this.pos.x, player.pos.z - this.pos.z);
      this.huntGoal = null;
      if (d > FIRE_RANGE) { this.moveTo(player.pos, HUNT_RUN, dt, boxes, level, FIRE_RANGE * 0.8); this.aim = 0; return; }
      this.path = null;
      this.face(player.pos, 5 * dt);
      const want = yawFromDir(player.pos.x - this.pos.x, player.pos.z - this.pos.z);
      this.aim += dt;
      if (this.aim >= AIM_TIME && Math.abs(wrapAngle(want - this.yaw)) < 0.25) {
        this.aim = AIM_TIME - FIRE_EVERY;
        this.shoot(player, d);
      }
      return;
    }
    this.aim = Math.min(this.aim, 0);
    // New information from anyone: drop the search and go there.
    if (!this.huntGoal || this.huntVersion !== h.version) {
      this.huntGoal = h.pos.clone();
      this.huntVersion = h.version;
      this.huntLookAt = null;
      this.huntGoalTime = this.stateTime;
    }
    if (this.huntLookAt === null) {
      const there = this.moveTo(this.huntGoal, HUNT_RUN, dt, boxes, level, 0.8);
      if (there || this.stateTime - this.huntGoalTime > 15) this.huntLookAt = this.stateTime;
      return;
    }
    this.yaw = wrapAngle(this.yaw + Math.sin((this.stateTime - this.huntLookAt) * 1.8) * 1.6 * dt);
    if (this.stateTime - this.huntLookAt < HUNT_LOOK) return;
    // Next search spot: the nearest nav node around the last known position nobody has searched lately.
    let best = -1;
    let bestD = Infinity;
    level.navNodes.forEach((n, i) => {
      if (Math.hypot(n.x - h.pos.x, n.z - h.pos.z) > SEARCH_R) return;
      if (h.searched.has(i) && this.squad.time - h.searched.get(i) < 25) return;
      const dd = Math.hypot(n.x - this.pos.x, n.z - this.pos.z);
      if (dd < bestD) { bestD = dd; best = i; }
    });
    if (best < 0) { h.searched.clear(); this.huntLookAt = this.stateTime; return; }
    h.searched.set(best, this.squad.time);
    this.huntGoal = level.navNodes[best].clone();
    this.huntLookAt = null;
    this.huntGoalTime = this.stateTime;
  }

  /** One shot at the player. Hits come from an accumulator so results are repeatable; chance is a guess. */
  shoot(player, d) {
    const chance = clamp(1 - d / 16, 0.25, 0.85) * (0.5 + 0.5 * Math.min(1, this.visibility * 1.5));
    this.accuracy += chance;
    const hit = this.accuracy >= 1;
    if (hit) this.accuracy -= 1;
    const from = new THREE.Vector3(this.pos.x - Math.sin(this.yaw) * 0.4, 1.35, this.pos.z - Math.cos(this.yaw) * 0.4);
    const to = new THREE.Vector3(player.pos.x, player.pos.y + 1.2, player.pos.z);
    if (!hit) { to.x += (this.accuracy - 0.5) * 1.2; to.y += 0.5; } // a near miss
    this.squad.shots.push({ from, to, hit, guard: this, noise: GUN_NOISE });
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
    } else if (this.state === 'down' || this.state === 'dead') {
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
      this.path = findPath(this.pos, target, level.navNodes, level.navBoxes || boxes); // guards open doors on the way
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
