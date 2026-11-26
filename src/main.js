// Low Light prototype: game loop, camera, interaction, win/lose.

import * as THREE from 'three';
import { buildLevel } from './level.js';
import { Player, MAX_NOISE } from './player.js';
import { NightVision } from './nightvision.js';
import { Guard, KO_TIME } from './guard.js';
import { lightAt } from './lighting.js';
import { Bottle, THROW_NOISE, throwVelocity, predictArc } from './throwable.js';
import { Hud } from './hud.js';
import { PISTOL_AMMO, SHOT_NOISE, IMPACT_NOISE, traceShot, makePistolMesh } from './pistol.js';
import { Input, NullInput } from './input.js';
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
const guard = new Guard(scene, level.guardRoute);
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
const pistolMesh = makePistolMesh();
pistolMesh.position.set(0.28, 1.38, -0.42);
pistolMesh.visible = false;
player.group.add(pistolMesh);
const tracer = new THREE.Line(
  new THREE.BufferGeometry().setAttribute('position', new THREE.BufferAttribute(new Float32Array(6), 3)),
  new THREE.LineBasicMaterial({ color: 0xffe0a0, transparent: true, opacity: 0.7, depthWrite: false })
);
tracer.frustumCulled = false;
tracer.visible = false;
scene.add(tracer);
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

const game = {
  state: 'playing', // 'playing' | 'spotted' | 'complete'
  time: 0,
  maxSuspicion: 0,
  cam: { yaw: 0, pitch: -0.2 },
  level, player, guard, camera, nv, bottle,
  noise: { pos: new THREE.Vector3(), radius: 0 },
  interact: null,
};
window.game = game; // for scripted checks

function reset() {
  level.reset();
  player.reset(level.playerStart);
  guard.reset();
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
  game.ammo = PISTOL_AMMO;
  game.pistolAim = false; // F held: pistol up
  game.lastShot = null;   // { kind, point, t, heard }
  game.killed = false;    // a guard was shot (rating: Cleared)
  game.camDist = CAM_DIST;
  bottle.reset();
  nv.enabled = false;
  if (input.active) hud.hideOverlay();
  else hud.showOverlay('Low Light', 'Click to play');
}

function nearestInteractable() {
  let best = null;
  let bestD = Infinity;
  for (const it of level.interactables) {
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

function onSpotted() {
  game.state = 'spotted';
  player.grabbing = false;
  player.locked = false;
  const why = guard.brokeFree ? 'The guard broke free of your grip.' : 'The guard saw you.';
  hud.showOverlay('Spotted', why, 'Press R to restart');
}

function onComplete() {
  game.state = 'complete';
  // Being spotted ends the run: Ghost (no guard touched), Shadow (non-lethal only) or Cleared (a kill).
  const rating = game.killed ? 'Cleared' : game.touched ? 'Shadow' : 'Ghost';
  hud.showOverlay(
    'Objective complete',
    `Rating: ${rating} · Time ${fmtTime(game.time)}`,
    `Guard's highest suspicion: ${Math.round(game.maxSuspicion)}% · Press R to play again`
  );
}

// ---------- Throwing ----------
function throwOrigin() {
  return new THREE.Vector3(player.pos.x - Math.sin(game.cam.yaw) * 0.35, player.eyeHeight + 0.1,
    player.pos.z - Math.cos(game.cam.yaw) * 0.35);
}

function updateThrow(dt, inp) {
  const canThrow = game.holding && !player.grabbing && !player.locked && !player.climb;
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
    game.impactHeard = guard.hearImpact(hit, THROW_NOISE, level.boxes);
  }
}

// ---------- Pistol ----------
function cameraDir() {
  const { yaw, pitch } = game.cam;
  return new THREE.Vector3(-Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), -Math.cos(yaw) * Math.cos(pitch));
}

function updatePistol(inp) {
  const canAim = !player.climb && !player.grabbing && !player.locked && !game.aiming;
  game.pistolAim = canAim && inp.down('KeyF');
  player.aiming = game.pistolAim;
  if (!game.pistolAim || !inp.pressed('Mouse0') || game.ammo <= 0) return;
  game.ammo--;
  updateCamera(); // shoot from where the crosshair is this step
  const dir = cameraDir();
  const hit = traceShot(camera.position.clone(), dir, level, guard);
  hit.point.addScaledVector(dir, -0.05); // just off the surface, so the wall it hit does not muffle it
  let heard = guard.hearImpact(player.pos, SHOT_NOISE, level.boxes);
  if (hit.kind === 'guard') {
    if (guard.state === 'grabbed' || guard.state === 'ko') releaseGuard();
    guard.kill();
    game.killed = true;
    game.touched = true;
    heard = false;
  } else if (hit.kind === 'light') {
    level.breakLight(hit.light);
  }
  if (hit.kind !== 'miss' && hit.kind !== 'guard') {
    heard = guard.hearImpact(hit.point, IMPACT_NOISE, level.boxes) || heard;
    game.impact = { pos: hit.point.clone(), radius: IMPACT_NOISE, t: game.time };
  }
  game.lastShot = { kind: hit.kind, point: hit.point, t: game.time, heard };
  const arr = tracer.geometry.attributes.position.array;
  const muzzle = pistolMesh.getWorldPosition(new THREE.Vector3());
  arr.set([muzzle.x, muzzle.y, muzzle.z, hit.point.x, hit.point.y, hit.point.z]);
  tracer.geometry.attributes.position.needsUpdate = true;
}

// ---------- Takedowns ----------
const HOLD_DIST = 0.6;  // guard held this far in front of the player
const KO_NOISE = 1.5;   // m: a knockout is quiet but not silent (guess)

function grabGuard() {
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
  if (guard.state !== 'grabbed' && guard.state !== 'ko') return;
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
  guard.knockOut();
  player.grabbing = false;
  player.locked = true;
}

function releaseGuard() {
  player.grabbing = false;
  player.locked = false;
}

/** One simulation step. */
function step(dt, inp) {
  if (game.state === 'playing') {
    const keyYaw = (inp.down('ArrowLeft') ? 1 : 0) - (inp.down('ArrowRight') ? 1 : 0);
    const keyPitch = (inp.down('ArrowUp') ? 1 : 0) - (inp.down('ArrowDown') ? 1 : 0);
    game.cam.yaw -= inp.mouseDX * SENS - keyYaw * KEY_LOOK * dt;
    game.cam.pitch = clamp(game.cam.pitch - inp.mouseDY * SENS + keyPitch * KEY_LOOK * 0.6 * dt, -1.1, 0.6);

    player.update(dt, inp, game.cam.yaw, level.boxes);
    if (player.landed) {
      game.impact = { pos: player.pos.clone(), radius: DROP_NOISE, t: game.time };
      const onGuard = !guard.disabled && guard.state !== 'alert'
        && Math.hypot(guard.pos.x - player.pos.x, guard.pos.z - player.pos.z) <= DROP_KO_RANGE;
      if (onGuard) { guard.dropKnockOut(); game.touched = true; game.dropKO = true; }
      game.dropHeard = guard.hearImpact(player.pos, DROP_NOISE, level.boxes);
    }

    const samples = player.samplePoints();
    const sampleLight = samples.map((p) => lightAt(p, level));
    player.lightLevel = (sampleLight[0] + sampleLight[1] + sampleLight[2]) / 3;

    holdGuard();
    updateThrow(dt, inp);
    updatePistol(inp);
    game.noise = { pos: player.pos.clone(), radius: player.locked ? KO_NOISE : player.noiseRadius };
    guard.update(dt, player, samples, sampleLight, level, game.noise);
    if (player.locked && guard.state === 'down') player.locked = false; // knockout finished
    game.maxSuspicion = Math.max(game.maxSuspicion, guard.suspicion);
    game.time += dt;

    // One context button: takedown moves win over switches when a guard is in reach.
    game.interact = null;
    game.takedown = null;
    if (guard.state === 'grabbed') {
      game.takedown = 'knockout';
      if (guard.grip <= 0) { guard.brokeFree = true; releaseGuard(); guard.breakFree(); }
    } else if (player.climb) {
      game.interact = player.atPipeEnd ? pipeDown : null;
    } else if (!player.locked && guard.canTakedown(player)) {
      game.takedown = 'grab';
    } else if (!player.locked) {
      game.interact = nearestInteractable();
    }
    if (inp.pressed('KeyE')) {
      if (game.takedown === 'grab') grabGuard();
      else if (game.takedown === 'knockout') knockOutGuard();
      else if (game.interact) {
        game.interact.use();
        if (game.interact.kind === 'objective') onComplete();
      }
    }
    if (guard.suspicion >= 100) onSpotted();
  }
  if (game.state !== 'playing') { game.aiming = false; game.pistolAim = false; player.aiming = false; }
  if (inp.pressed('KeyR')) reset();
  if (inp.pressed('KeyV')) { guard.toggleCone(); showDebug = !showDebug; }
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
  pistolMesh.visible = game.pistolAim;
  crosshairEl.classList.toggle('on', game.pistolAim);
  hud.update({
    light: player.lightLevel,
    noise: game.noise.radius / MAX_NOISE,
    nv: nv.enabled,
    held: [
      game.ammo > 0 ? `PISTOL ${game.ammo}${game.pistolAim ? ' · AIMING' : ' · F'}` : 'PISTOL EMPTY',
      game.holding ? (game.aiming ? 'BOTTLE · AIMING' : 'BOTTLE · G') : '',
    ].filter(Boolean).join('\n'),
    stance: player.stance,
    prompt: game.state !== 'playing' ? ''
      : game.pistolAim ? (game.ammo > 0 ? 'Click: fire' : 'Out of ammo')
      : game.takedown === 'grab' ? 'E: grab'
      : game.takedown === 'knockout' ? 'E: knock out · WASD drag him'
      : player.locked ? ''
      : player.hanging ? `${game.interact ? 'E: onto the riser · ' : ''}C: drop · Space: ${player.tucked ? 'hang by hands' : 'legs up'}`
      : player.climb && player.climb.mode === 'riser' ? 'W climb · S down · C drop'
      : player.climb ? ''
      : game.interact ? game.interact.label() : '',
    guard: {
      pos: new THREE.Vector3(guard.pos.x, 2.15, guard.pos.z),
      suspicion: guard.suspicion,
      icon: guard.icon,
      grip: guard.state === 'grabbed' ? guard.grip : null,
      hidden: guard.state === 'ko' || guard.state === 'down' || guard.state === 'dead',
    },
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

// Click starts play; Esc or P pauses.
const helpEl = document.getElementById('help');
const helpBase = helpEl.textContent;
input.onActiveChange = (active) => {
  if (game.state !== 'playing') return;
  if (active) hud.hideOverlay();
  else hud.showOverlay('Paused', 'Click to play', 'Esc or P pauses');
};
document.addEventListener('pointerlockchange', () => {
  helpEl.textContent = input.locked ? helpBase : `${helpBase} · Drag the mouse or use arrow keys to look`;
});
helpEl.textContent = `${helpBase} · Drag the mouse or use arrow keys to look`;

let last = performance.now();
function frame(now) {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  if (input.active || game.state !== 'playing') step(dt, input);
  else if (input.pressed('KeyR')) reset();
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
  import('./tests.js').then(({ runTests }) => {
    const results = runTests(game);
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
