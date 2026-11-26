// Low Light prototype: game loop, camera, interaction, win/lose.

import * as THREE from 'three';
import { buildLevel } from './level.js';
import { Player, MAX_NOISE } from './player.js';
import { NightVision } from './nightvision.js';
import { Guard, makeSquad, resetSquad, updateSquad } from './guard.js';
import { lightAt } from './lighting.js';
import { Bottle, THROW_NOISE, throwVelocity, predictArc } from './throwable.js';
import { Hud } from './hud.js';
import { MAG_SIZE, START_RESERVE, RELOAD_TIME, SHOT_NOISE, IMPACT_NOISE, traceShot, makePistolMesh } from './pistol.js';
import { Input, NullInput, ACTIONS, keyLabel } from './input.js';
import { segmentFirstHit, resolveCircle } from './collision.js';
import { clamp, lerp } from './utils.js';

const canvas = document.getElementById('view');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x050608);
const camera = new THREE.PerspectiveCamera(65, 1, 0.05, 100);

const level = buildLevel(scene);
const player = new Player(scene);
for (const pipe of level.pipes) {
  for (const m of pipe.mounts()) {
    level.interactables.push({
      kind: 'pipe', pipe, pos: m.pos, range: 1.0,
      label: () => 'E: climb pipe',
      use: () => player.startClimb(pipe, m.s),
    });
  }
}
// While hanging at a pipe end, E climbs back down.
const pipeDown = { kind: 'pipeDown', label: () => 'E: climb down', use: () => player.climbDown() };
const DROP_NOISE = 6; // m: letting go of a pipe lands hard (design doc: loud landing; radius is a guess)
const DROP_KO_RANGE = 0.9; // m: land this close to a guard and he goes down (design doc: drop attack; guess)
// Guards share one squad: a full alert spreads to all of them (guard.js).
const squad = makeSquad();
const guards = level.guardRoutes.map((route) => new Guard(scene, route, squad));
const guard = guards[0]; // older code and tests talk about "the guard": the east room one
level.occupants = () => [player.pos, ...guards.filter((g) => g.active).map((g) => g.pos)]; // keep doors from closing on anyone
const GUARD_DAMAGE = 0.34; // share of the player's health one guard bullet takes: three hits and you're down (guess)
const hud = new Hud(camera);
const input = new Input(canvas);
const nv = new NightVision(renderer);
const bottle = new Bottle(scene, level.bottleSpot);
level.interactables.push({
  kind: 'pickup',
  pos: new THREE.Vector3(level.bottleSpot.x, 0, level.bottleSpot.z),
  range: 1.4,
  available: () => bottle.state === 'rest',
  label: () => 'E: pick up bottle',
  use: () => { bottle.pickUp(); game.holding = 'bottle'; },
});
// Cupboards: carrying a body, E shuts him in; empty-handed, E takes him back out.
for (const spot of level.hideSpots) {
  level.interactables.push({
    kind: 'hide', spot, pos: spot.pos, range: 1.2,
    available: () => (game.carried ? !spot.body : !!spot.body),
    label: () => (game.carried ? 'E: hide him in the cupboard' : 'E: take the body out'),
    use: () => {
      if (game.carried) {
        const g = game.carried;
        stopCarrying();
        spot.body = g;
        g.stow(spot);
        hearAll(spot.pos, STOW_NOISE);
      } else {
        const g = spot.body;
        spot.body = null;
        startCarrying(g);
      }
    },
  });
}

// Aim line for the throw (hold G), with a ring where it will land.
const MAX_ARC = 130;
const aimLine = new THREE.Line(
  new THREE.BufferGeometry().setAttribute('position', new THREE.BufferAttribute(new Float32Array(MAX_ARC * 3), 3)),
  new THREE.LineBasicMaterial({ color: 0xc8e0ff, transparent: true, opacity: 0.55, depthWrite: false })
);
aimLine.frustumCulled = false;
aimLine.visible = false;
scene.add(aimLine);
const aimMark = new THREE.Mesh(
  new THREE.RingGeometry(0.18, 0.24, 24),
  new THREE.MeshBasicMaterial({ color: 0xc8e0ff, transparent: true, opacity: 0.6, depthWrite: false, side: THREE.DoubleSide })
);
aimMark.visible = false;
scene.add(aimMark);
const arcPts = [];

// Pistol: model in the right hand while aiming, and a brief tracer for each shot.
// It hangs off a shoulder pivot that follows the stance (crouching lowers it) and tilts with the aim.
const pistolMesh = makePistolMesh();
pistolMesh.position.set(0.08, 0, -0.42);
const pistolPivot = new THREE.Group();
pistolPivot.add(pistolMesh);
pistolPivot.visible = false;
player.group.add(pistolPivot);
const SHOULDER_DROP = 0.17; // m below the eye pivot

/** Put the pistol at the shoulder for the current stance, pointing where the camera aims. */
function posePistol() {
  pistolPivot.position.set(0.2, player.eyeHeight - SHOULDER_DROP, 0);
  pistolPivot.rotation.x = game.cam.pitch;
  player.group.updateMatrixWorld(true);
}
const tracer = new THREE.Line(
  new THREE.BufferGeometry().setAttribute('position', new THREE.BufferAttribute(new Float32Array(6), 3)),
  new THREE.LineBasicMaterial({ color: 0xffe0a0, transparent: true, opacity: 0.7, depthWrite: false })
);
tracer.frustumCulled = false;
tracer.visible = false;
scene.add(tracer);
// One tracer per guard for their shots during a full alert.
const guardTracers = guards.map(() => {
  const line = new THREE.Line(
    new THREE.BufferGeometry().setAttribute('position', new THREE.BufferAttribute(new Float32Array(6), 3)),
    new THREE.LineBasicMaterial({ color: 0xffb070, transparent: true, opacity: 0.8, depthWrite: false })
  );
  line.frustumCulled = false;
  line.visible = false;
  line.userData.t = -1;
  scene.add(line);
  return line;
});
const crosshairEl = document.getElementById('crosshair');

// Debug noise ring around the player (shown with V, like the guard view cone).
const noiseRing = new THREE.Mesh(
  new THREE.RingGeometry(0.97, 1, 48),
  new THREE.MeshBasicMaterial({ color: 0x66aaff, transparent: true, opacity: 0.35, depthWrite: false, side: THREE.DoubleSide })
);
noiseRing.rotation.x = -Math.PI / 2;
noiseRing.visible = false;
scene.add(noiseRing);
let showDebug = false;

const CAM_DIST = 3.0;
const AIM_DIST = 1.6; // camera pulls in while aiming the pistol
const SHOULDER = 0.45;
const SENS = 0.0025;
const KEY_LOOK = 2.2; // rad/s for arrow-key look
const GLASS_MUL = 2.5; // footsteps on broken glass carry this much further (guess)

const game = {
  state: 'playing', // 'playing' | 'killed' | 'complete'
  time: 0,
  maxSuspicion: 0,
  cam: { yaw: 0, pitch: -0.2 },
  level, player, guard, guards, squad, camera, nv, bottle, input,
  noise: { pos: new THREE.Vector3(), radius: 0 },
  interact: null,
};
window.game = game; // for scripted checks
game.pistolMesh = pistolMesh;

function reset() {
  level.reset();
  player.reset(level.playerStart);
  for (const g of guards) g.reset();
  resetSquad(squad);
  for (const t of guardTracers) { t.visible = false; t.userData.t = -1; }
  game.cam.yaw = level.playerStart.yaw;
  game.cam.pitch = -0.2;
  game.state = 'playing';
  game.time = 0;
  game.maxSuspicion = 0;
  game.touched = false; // any guard grabbed or knocked out (affects the rating)
  game.noise = { pos: new THREE.Vector3(), radius: 0 };
  game.holding = null;   // 'bottle' while carrying it
  game.aiming = false;   // G held with something to throw
  game.impact = null;    // { pos, radius, t } last smash or hard landing, for the V debug ring
  game.dropHeard = false;
  game.dropKO = false;    // last drop landed on the guard
  game.mag = MAG_SIZE;        // rounds in the pistol
  game.reserve = START_RESERVE;
  game.reloading = 0;         // s left on a reload (0 = not reloading)
  game.pistolDrawn = false;   // toggled with 1
  game.pistolAim = false;     // drawn and able to shoot right now (not climbing, grabbing, ...)
  game.onGlass = false;
  game.lastShot = null;   // { kind, point, t, heard }
  game.killed = false;    // a guard was shot (rating: Cleared)
  game.camDist = CAM_DIST;
  game.health = 1;        // 0..1; guard bullets take GUARD_DAMAGE each
  game.hurt = 0;          // red screen flash after a hit, fades out
  game.held = null;       // the guard being grabbed or knocked out
  game.brokeFree = false; // a grabbed guard got loose (raises the full alert)
  game.takedownGuard = null;
  game.carried = null;    // the body over the player's shoulders
  game.guardShots = [];   // guard gunshots this run: { hit, t }
  bottle.reset();
  nv.enabled = false;
  closeMenu();
  if (input.active) hud.hideOverlay();
  else hud.showOverlay('Low Light', 'Click to play');
}

/** Bodies on the floor that can be picked up, as interactables (rebuilt each step: they move). */
function bodyInteractables() {
  return guards.filter((g) => g.lyingFree).map((g) => ({
    kind: 'body', guard: g, pos: g.bodyPoint(), range: 1.3,
    label: () => (g.state === 'dead' ? 'E: pick up the body' : 'E: pick him up'),
    use: () => startCarrying(g),
  }));
}

/** Nearest usable thing in reach. `kinds` limits it to those kinds (while carrying a body). */
function nearestInteractable(kinds = null) {
  let best = null;
  let bestD = Infinity;
  for (const it of kinds ? level.interactables : [...level.interactables, ...bodyInteractables()]) {
    if (kinds && !kinds.includes(it.kind)) continue;
    if (it.available && !it.available()) continue;
    const d = Math.hypot(it.pos.x - player.pos.x, it.pos.z - player.pos.z);
    if (d <= it.range && d < bestD) { best = it; bestD = d; }
  }
  return best;
}

function fmtTime(t) {
  const m = Math.floor(t / 60);
  const s = Math.floor(t % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

/** Key currently bound to an action, for prompts. */
function K(id) { return input.keyFor(id); }
function moveKeys() { return ['forward', 'left', 'back', 'right'].map(K).join(''); }

function onKilled() {
  game.state = 'killed';
  player.grabbing = false;
  player.locked = false;
  hud.showOverlay('Killed', 'The guards shot you during the full alert.', `Press ${K('reload')} to restart`);
}

function onComplete() {
  game.state = 'complete';
  // Ghost (no guard touched, no full alert), Shadow (non-lethal only, no full alert) or Cleared (anything else).
  const rating = game.killed || squad.alerted ? 'Cleared' : game.touched ? 'Shadow' : 'Ghost';
  hud.showOverlay(
    'Objective complete',
    `Rating: ${rating} · Time ${fmtTime(game.time)}`,
    `${squad.alerted ? 'Full alert reached · ' : ''}Highest guard suspicion: ${Math.round(game.maxSuspicion)}% · Press ${K('reload')} to play again`
  );
}

/** A one-off noise every guard gets a chance to hear. True if any of them did. */
function hearAll(pos, radius) {
  let heard = false;
  for (const g of guards) heard = g.hearImpact(pos, radius, level.boxes) || heard;
  return heard;
}

// ---------- Throwing ----------
function throwOrigin() {
  return new THREE.Vector3(player.pos.x - Math.sin(game.cam.yaw) * 0.35, player.eyeHeight + 0.1,
    player.pos.z - Math.cos(game.cam.yaw) * 0.35);
}

function updateThrow(dt, inp) {
  const canThrow = game.holding && !player.grabbing && !player.carrying && !player.locked && !player.climb;
  const gDown = inp.down('KeyG') && !game.pistolAim;
  if (canThrow && gDown) game.aiming = true;
  else if (game.aiming && canThrow && !gDown) {
    bottle.throw(throwOrigin(), throwVelocity(game.cam.yaw, game.cam.pitch));
    game.holding = null;
    game.aiming = false;
  } else game.aiming = false;

  const hit = bottle.update(dt, level.boxes);
  if (hit) {
    game.impact = { pos: hit.clone(), radius: THROW_NOISE, t: game.time };
    game.impactHeard = hearAll(hit, THROW_NOISE);
  }
}

// ---------- Pistol ----------
function cameraDir() {
  const { yaw, pitch } = game.cam;
  return new THREE.Vector3(-Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), -Math.cos(yaw) * Math.cos(pitch));
}

function updatePistol(dt, inp) {
  const busy = player.climb || player.grabbing || player.carrying || player.locked;
  if (busy) game.pistolDrawn = false; // hands full: put it away
  else if (inp.pressed('Digit1') && !game.aiming) game.pistolDrawn = !game.pistolDrawn;
  game.pistolAim = game.pistolDrawn && !busy && !game.aiming;
  player.aiming = game.pistolAim;

  if (game.reloading > 0) {
    game.reloading = Math.max(0, game.reloading - dt);
    if (game.reloading === 0) {
      const n = Math.min(MAG_SIZE - game.mag, game.reserve);
      game.mag += n;
      game.reserve -= n;
    }
  } else if (inp.pressed('KeyR') && !busy && game.mag < MAG_SIZE && game.reserve > 0) {
    game.reloading = RELOAD_TIME;
  }

  if (!game.pistolAim || !inp.pressed('Mouse0') || game.mag <= 0 || game.reloading > 0) return;
  game.mag--;
  updateCamera(); // shoot from where the crosshair is this step
  const dir = cameraDir();
  const hit = traceShot(camera.position.clone(), dir, level, guards);
  hit.point.addScaledVector(dir, -0.05); // just off the surface, so the wall it hit does not muffle it
  if (hit.kind === 'guard') {
    if (game.held === hit.guard) { releaseGuard(); game.held = null; }
    hit.guard.kill();
    game.killed = true;
    game.touched = true;
  }
  let heard = hearAll(player.pos, SHOT_NOISE);
  if (hit.kind === 'light') {
    level.breakLight(hit.light);
  }
  if (hit.kind !== 'miss' && hit.kind !== 'guard') {
    heard = hearAll(hit.point, IMPACT_NOISE) || heard;
    game.impact = { pos: hit.point.clone(), radius: IMPACT_NOISE, t: game.time };
  }
  game.lastShot = { kind: hit.kind, point: hit.point, t: game.time, heard };
  const arr = tracer.geometry.attributes.position.array;
  posePistol();
  const muzzle = pistolMesh.getWorldPosition(new THREE.Vector3());
  arr.set([muzzle.x, muzzle.y, muzzle.z, hit.point.x, hit.point.y, hit.point.z]);
  tracer.geometry.attributes.position.needsUpdate = true;
}

// ---------- Guard gunfire (full alert) ----------
function handleGuardShots() {
  for (const shot of squad.shots) {
    const line = guardTracers[guards.indexOf(shot.guard)];
    line.geometry.attributes.position.array.set([shot.from.x, shot.from.y, shot.from.z, shot.to.x, shot.to.y, shot.to.z]);
    line.geometry.attributes.position.needsUpdate = true;
    line.userData.t = game.time;
    game.guardShots.push({ hit: shot.hit, t: game.time, to: shot.to.clone() });
    if (shot.hit) { game.health = Math.max(0, game.health - GUARD_DAMAGE); game.hurt = 1; }
    hearAll(shot.from, shot.noise); // the others hear it (and come running if hunting)
  }
  squad.shots.length = 0;
}

// ---------- Takedowns ----------
const HOLD_DIST = 0.6;  // guard held this far in front of the player
const KO_NOISE = 1.5;   // m: a knockout is quiet but not silent (guess)

function grabGuard(guard) {
  game.held = guard;
  guard.grab();
  game.touched = true;
  player.grabbing = true;
  player.crouched = false;
  // Face the guard's back and pull him in front of you.
  player.facing = guard.yaw;
  game.cam.yaw = guard.yaw;
  holdGuard();
}

function holdGuard() {
  const guard = game.held;
  if (!guard || (guard.state !== 'grabbed' && guard.state !== 'ko')) return;
  const fx = -Math.sin(player.facing);
  const fz = -Math.cos(player.facing);
  guard.pos.set(player.pos.x + fx * HOLD_DIST, 0, player.pos.z + fz * HOLD_DIST);
  resolveCircle(guard.pos, 0.35, level.boxes);
  // If a wall shoved him, shove the player back too so the pair stays together.
  player.pos.set(guard.pos.x - fx * HOLD_DIST, 0, guard.pos.z - fz * HOLD_DIST);
  resolveCircle(player.pos, player.radius, level.boxes);
  guard.yaw = player.facing;
  guard.applyMesh();
  player.applyMesh();
}

function knockOutGuard() {
  game.held.knockOut();
  player.grabbing = false;
  player.locked = true;
}

function releaseGuard() {
  player.grabbing = false;
  player.locked = false;
}

// ---------- Carrying bodies ----------
const BODY_DROP_NOISE = 1.5; // m: putting a body down (guess)
const STOW_NOISE = 1.0;      // m: shutting him in a cupboard (guess)
const PUT_DOWN_DIST = 0.9;   // m in front of the player: the middle of the body

function startCarrying(g) {
  g.carry();
  game.carried = g;
  player.carrying = true;
  player.crouched = false;
  game.aiming = false;
  holdCarried();
}

function stopCarrying() {
  game.carried = null;
  player.carrying = false;
}

/** The carried guard follows the player (guard.js lays him across the shoulders). */
function holdCarried() {
  const g = game.carried;
  if (!g) return;
  g.pos.set(player.pos.x, 0, player.pos.z);
  g.yaw = player.facing;
  g.applyMesh();
}

/** Lay him on the floor in front of the player, across the way you face, short of any wall. */
function putDownBody() {
  const g = game.carried;
  const fx = -Math.sin(player.facing);
  const fz = -Math.cos(player.facing);
  const from = new THREE.Vector3(player.pos.x, 0.4, player.pos.z);
  const want = new THREE.Vector3(player.pos.x + fx * PUT_DOWN_DIST, 0.4, player.pos.z + fz * PUT_DOWN_DIST);
  const t = segmentFirstHit(from, want, level.boxes);
  const mid = from.clone().lerp(want, t >= 1 ? 1 : Math.max(0, t - 0.35 / PUT_DOWN_DIST));
  resolveCircle(mid, 0.3, level.boxes);
  const yaw = player.facing + Math.PI / 2;
  const feet = new THREE.Vector3(mid.x + Math.sin(yaw) * 0.88, 0, mid.z + Math.cos(yaw) * 0.88);
  stopCarrying();
  g.putDown(feet, yaw);
  hearAll(mid, BODY_DROP_NOISE);
}
const putDownAction = { kind: 'putDown', label: () => 'E: put him down', use: putDownBody };

/** One simulation step. */
function step(dt, inp) {
  if (game.state === 'playing') {
    const keyYaw = (inp.down('ArrowLeft') ? 1 : 0) - (inp.down('ArrowRight') ? 1 : 0) - (inp.edgeX || 0);
    const keyPitch = (inp.down('ArrowUp') ? 1 : 0) - (inp.down('ArrowDown') ? 1 : 0);
    game.cam.yaw -= inp.mouseDX * SENS - keyYaw * KEY_LOOK * dt;
    game.cam.pitch = clamp(game.cam.pitch - inp.mouseDY * SENS + keyPitch * KEY_LOOK * 0.6 * dt, -1.1, 0.6);

    player.update(dt, inp, game.cam.yaw, level.boxes);
    if (player.landed) {
      game.impact = { pos: player.pos.clone(), radius: DROP_NOISE, t: game.time };
      const under = guards.find((g) => g.active && !g.disabled
        && Math.hypot(g.pos.x - player.pos.x, g.pos.z - player.pos.z) <= DROP_KO_RANGE);
      if (under) { under.dropKnockOut(); game.touched = true; game.dropKO = true; }
      game.dropHeard = hearAll(player.pos, DROP_NOISE);
    }

    const samples = player.samplePoints();
    const sampleLight = samples.map((p) => lightAt(p, level));
    player.lightLevel = (sampleLight[0] + sampleLight[1] + sampleLight[2]) / 3;

    holdGuard();
    holdCarried();
    updateThrow(dt, inp);
    updatePistol(dt, inp);
    game.onGlass = !player.climb && level.onGlass(player.pos.x, player.pos.z);
    game.noise = { pos: player.pos.clone(), radius: player.locked ? KO_NOISE : player.noiseRadius * (game.onGlass ? GLASS_MUL : 1) };
    updateSquad(squad, dt);
    for (const g of guards) g.update(dt, player, samples, sampleLight, level, game.noise);
    if (game.held && game.held.state === 'down') { player.locked = false; game.held = null; } // knockout finished
    for (const g of guards) if (g.active) game.maxSuspicion = Math.max(game.maxSuspicion, g.suspicion);
    game.time += dt;
    handleGuardShots();

    // One context button: takedown moves win over switches when a guard is in reach.
    game.interact = null;
    game.takedown = null;
    game.takedownGuard = null;
    const reachable = !player.locked && !player.climb && !game.held && !game.carried
      ? guards.find((g) => g.canTakedown(player)) : null;
    if (game.held && game.held.state === 'grabbed') {
      game.takedown = 'knockout';
      if (game.held.grip <= 0) {
        const g = game.held;
        game.brokeFree = true;
        releaseGuard();
        game.held = null;
        game.takedown = null;
        g.breakFree(player.pos);
      }
    } else if (player.climb) {
      game.interact = player.atPipeEnd ? pipeDown : null;
    } else if (game.carried) {
      // Hands full: a cupboard or a door in reach, otherwise put him down.
      game.interact = nearestInteractable(['hide', 'door']) || putDownAction;
    } else if (reachable) {
      game.takedown = 'grab';
      game.takedownGuard = reachable;
    } else if (!player.locked) {
      game.interact = nearestInteractable();
    }
    if (inp.pressed('KeyE')) {
      if (game.takedown === 'grab') grabGuard(game.takedownGuard);
      else if (game.takedown === 'knockout') knockOutGuard();
      else if (game.interact) {
        game.interact.use();
        if (game.interact.kind === 'objective') onComplete();
      }
    }
    if (game.health <= 0 && game.state === 'playing') onKilled();
  }
  game.hurt = Math.max(0, game.hurt - dt * 1.5);
  if (game.state !== 'playing') { game.aiming = false; game.pistolAim = false; player.aiming = false; }
  if (game.state !== 'playing' && inp.pressed('KeyR')) reset(); // during play R reloads
  if (inp.pressed('KeyV')) { for (const g of guards) g.toggleCone(); showDebug = !showDebug; }
  if (inp.pressed('KeyN')) nv.toggle();
}

function updateCamera() {
  const { yaw, pitch } = game.cam;
  const dir = new THREE.Vector3(
    -Math.sin(yaw) * Math.cos(pitch),
    Math.sin(pitch),
    -Math.cos(yaw) * Math.cos(pitch)
  );
  const right = new THREE.Vector3(Math.cos(yaw), 0, -Math.sin(yaw));
  const pivot = new THREE.Vector3(player.pos.x, player.viewHeight, player.pos.z);

  // Shoulder offset, pulled in if a wall is right beside the player.
  const shoulderGoal = pivot.clone().addScaledVector(right, SHOULDER);
  const ts = segmentFirstHit(pivot, shoulderGoal, level.boxes);
  const shoulder = pivot.clone().addScaledVector(right, SHOULDER * Math.max(0, ts - 0.3));

  // Boom back from the shoulder, pulled in on walls.
  const boom = game.camDist;
  const desired = shoulder.clone().addScaledVector(dir, -boom);
  const t = segmentFirstHit(shoulder, desired, level.boxes);
  const dist = Math.max(0.3, boom * t - 0.2);
  camera.position.copy(shoulder).addScaledVector(dir, -dist);
  camera.position.y = clamp(camera.position.y, 0.15, 3.85);
  camera.lookAt(camera.position.clone().add(dir));
}

function updateHud() {
  pistolPivot.visible = game.pistolAim;
  if (game.pistolAim) posePistol();
  crosshairEl.classList.toggle('on', game.pistolAim);
  hud.update({
    light: player.lightLevel,
    noise: game.noise.radius / MAX_NOISE,
    noiseM: game.noise.radius,
    nv: nv.enabled,
    ammo: {
      mag: game.mag, size: MAG_SIZE, reserve: game.reserve,
      text: game.reloading > 0 ? 'RELOAD' : game.pistolDrawn ? 'DRAWN' : `[${K('pistol')}]`,
    },
    held: game.carried ? `BODY  [${K('use')}] put down`
      : game.holding ? (game.aiming ? 'BTL  AIMING' : `BTL  [${K('throw')}] throw`) : '',
    status: squad.hunt.active ? 'ALERT'
      : guards.some((g) => g.active && !g.disabled && g.icon === '?') ? 'CAUTION' : 'QUIET',
    dt: frameDt,
    stance: player.stance + (game.onGlass ? ' · ON GLASS' : ''),
    prompt: game.state !== 'playing' ? ''
      : game.pistolAim ? (game.reloading > 0 ? 'Reloading…'
        : game.mag > 0 ? `Click: fire · ${K('pistol')}: holster`
        : game.reserve > 0 ? `Empty · ${K('reload')}: reload` : 'Out of ammo')
      : game.takedown === 'grab' ? `${K('use')}: grab`
      : game.takedown === 'knockout' ? `${K('use')}: knock out · ${moveKeys()} drag him`
      : player.locked ? ''
      : player.hanging ? `${game.interact ? `${K('use')}: onto the riser · ` : ''}${K('crouch')}: drop · ${K('hang')}: ${player.tucked ? 'hang by hands' : 'legs up'}`
      : player.climb && player.climb.mode === 'riser' ? `${K('forward')} climb · ${K('back')} down · ${K('crouch')} drop`
      : player.climb ? ''
      : game.interact ? game.interact.label().replace(/^E:/, `${K('use')}:`) : '',
    health: game.health,
    hurt: game.hurt,
    alert: squad.hunt.active ? 'FULL ALERT · THEY ARE HUNTING YOU' : '',
    guards: guards.map((g) => ({
      pos: new THREE.Vector3(g.pos.x, 2.15, g.pos.z),
      suspicion: g.suspicion,
      icon: g.icon,
      grip: g.state === 'grabbed' ? g.grip : null,
      hidden: !g.active || g.state === 'ko' || g.state === 'down' || g.state === 'dead' || g.state === 'carried',
    })),
  });
}

function updateAim() {
  aimLine.visible = aimMark.visible = game.aiming;
  if (!game.aiming) return;
  predictArc(throwOrigin(), throwVelocity(game.cam.yaw, game.cam.pitch), level.boxes, arcPts);
  const n = Math.min(MAX_ARC, arcPts.length);
  const arr = aimLine.geometry.attributes.position.array;
  for (let i = 0; i < n; i++) { arr[i * 3] = arcPts[i].x; arr[i * 3 + 1] = arcPts[i].y; arr[i * 3 + 2] = arcPts[i].z; }
  aimLine.geometry.attributes.position.needsUpdate = true;
  aimLine.geometry.setDrawRange(0, n);
  const end = arcPts[n - 1];
  aimMark.position.set(end.x, Math.max(0.03, end.y + 0.02), end.z);
  aimMark.rotation.set(-Math.PI / 2, 0, 0); // flat; fine for floor landings, close enough on walls
}

function resize() {
  const w = window.innerWidth;
  const h = window.innerHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  nv.setSize(w, h);
}
window.addEventListener('resize', resize);

// ---------- Pause menu: resume, restart, settings (key bindings for now) ----------
// Click starts play; Esc or P pauses and opens the menu.
const menuEl = document.getElementById('menu');
const menuMain = menuEl.querySelector('.main');
const menuSettings = menuEl.querySelector('.settings');
const bindList = menuEl.querySelector('.binds');
let rebinding = null; // action id waiting for a key

function openMenu() {
  hud.hideOverlay();
  showMenuPage('main');
  menuEl.classList.remove('hidden');
}
function closeMenu() {
  rebinding = null;
  menuEl.classList.add('hidden');
}
function showMenuPage(page) {
  rebinding = null;
  menuMain.classList.toggle('hidden', page !== 'main');
  menuSettings.classList.toggle('hidden', page !== 'settings');
  if (page === 'settings') renderBinds();
}
function renderBinds() {
  bindList.textContent = '';
  const row = (label, key, id) => {
    const li = document.createElement('li');
    const name = document.createElement('span');
    name.textContent = label;
    const btn = document.createElement('button');
    btn.className = 'key';
    btn.textContent = rebinding === id ? 'Press a key…' : key;
    if (id) {
      btn.dataset.action = id;
      btn.addEventListener('click', () => { rebinding = id; renderBinds(); });
    } else btn.disabled = true; // fixed: mouse controls
    li.append(name, btn);
    bindList.append(li);
  };
  for (const a of ACTIONS) row(a.label, input.keyFor(a.id), a.id);
  row('Look', 'Mouse', null);
  row('Fire pistol (when drawn)', 'Left click', null);
}
// While waiting for a key, the next key press becomes the binding (Esc cancels). Runs before the game sees it.
window.addEventListener('keydown', (e) => {
  if (!rebinding) return;
  e.preventDefault();
  e.stopImmediatePropagation();
  if (e.code !== 'Escape') input.setBinding(rebinding, e.code);
  rebinding = null;
  renderBinds();
}, true);
menuEl.querySelector('[data-act=resume]').addEventListener('click', () => { closeMenu(); input.resume(); });
menuEl.querySelector('[data-act=restart]').addEventListener('click', () => { closeMenu(); input.resume(); reset(); });
menuEl.querySelector('[data-act=settings]').addEventListener('click', () => showMenuPage('settings'));
menuEl.querySelector('[data-act=back]').addEventListener('click', () => showMenuPage('main'));
menuEl.querySelector('[data-act=defaults]').addEventListener('click', () => { input.resetBindings(); renderBinds(); });
game.menu = { el: menuEl, open: openMenu, close: closeMenu };

input.onActiveChange = (active) => {
  if (game.state !== 'playing') return;
  if (active) { closeMenu(); hud.hideOverlay(); } else openMenu();
};

let last = performance.now();
let frameDt = 1 / 60; // for HUD animation (the wrist unit sound trace)
function frame(now) {
  const dt = Math.min(0.05, (now - last) / 1000);
  frameDt = dt;
  last = now;
  if (input.active || game.state !== 'playing') step(dt, input);
  input.endFrame();
  updateCamera();
  updateHud();
  const r = game.noise.radius;
  const imp = game.impact && game.time - game.impact.t < 0.8 ? game.impact : null;
  noiseRing.visible = showDebug && (r > 0 || !!imp);
  if (noiseRing.visible) {
    const src = imp ? imp.pos : player.pos;
    noiseRing.scale.setScalar(imp ? imp.radius : r);
    noiseRing.position.set(src.x, 0.03, src.z);
  }
  updateAim();
  game.camDist = lerp(game.camDist, game.pistolAim ? AIM_DIST : CAM_DIST, 1 - Math.exp(-12 * dt));
  tracer.visible = !!game.lastShot && game.time - game.lastShot.t < 0.06;
  for (const t of guardTracers) t.visible = t.userData.t >= 0 && game.time - t.userData.t < 0.08;
  nv.render(scene, camera, dt);
  requestAnimationFrame(frame);
}

// Scripted checks: run the simulation without the mouse. `drive` may set game state between steps.
const nullInput = new NullInput();
// Scripted key presses: game.debug.press('KeyE') fires on the next simulated step; hold(code) / release(code).
const scriptHeld = new Set();
let scriptPressed = new Set();
nullInput.down = (c) => scriptHeld.has(c);
nullInput.pressed = (c) => scriptPressed.has(c);
nullInput.endFrame = () => { scriptPressed = new Set(); };
game.debug = {
  simulate(seconds, drive) {
    const dt = 1 / 60;
    for (let i = 0; i < Math.round(seconds * 60); i++) {
      if (drive) drive(i * dt);
      step(dt, nullInput);
      nullInput.endFrame();
    }
    updateCamera();
    updateHud();
  },
  reset,
  press(c) { scriptPressed.add(c); },
  hold(c) { scriptHeld.add(c); },
  release(c) { scriptHeld.delete(c); },
};

resize();
reset();
requestAnimationFrame(frame);

// Regression tests: open with ?test (see src/tests.js).
if (new URLSearchParams(location.search).has('test')) {
  import('./tests.js').then(async ({ runTests }) => {
    const results = await runTests(game);
    window.testResults = results;
    const failed = results.filter((r) => !r.ok);
    hud.showOverlay(
      failed.length ? 'Tests failed' : 'Tests passed',
      `${results.length - failed.length} / ${results.length} passed`,
      failed.map((r) => `✘ ${r.name}: ${r.detail}`).join('\n')
    );
    console.log('[tests]', JSON.stringify(results));
  });
}
