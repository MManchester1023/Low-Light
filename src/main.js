// Low Light prototype: game loop, camera, interaction, win/lose.

import * as THREE from 'three';
import { buildLevel } from './level.js';
import { Player, MAX_NOISE } from './player.js';
import { NightVision } from './nightvision.js';
import { Guard, KO_TIME } from './guard.js';
import { lightAt } from './lighting.js';
import { Hud } from './hud.js';
import { Input, NullInput } from './input.js';
import { segmentFirstHit, resolveCircle } from './collision.js';
import { clamp } from './utils.js';

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
const guard = new Guard(scene, level.guardRoute);
const hud = new Hud(camera);
const input = new Input(canvas);
const nv = new NightVision(renderer);

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
const SHOULDER = 0.45;
const SENS = 0.0025;
const KEY_LOOK = 2.2; // rad/s for arrow-key look

const game = {
  state: 'playing', // 'playing' | 'spotted' | 'complete'
  time: 0,
  maxSuspicion: 0,
  cam: { yaw: 0, pitch: -0.2 },
  level, player, guard, camera, nv,
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
  nv.enabled = false;
  if (input.active) hud.hideOverlay();
  else hud.showOverlay('Low Light', 'Click to play');
}

function nearestInteractable() {
  let best = null;
  let bestD = Infinity;
  for (const it of level.interactables) {
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
  // Being spotted ends the run, so a finish is Ghost (no guard touched) or Shadow (non-lethal takedown).
  const rating = game.touched ? 'Shadow' : 'Ghost';
  hud.showOverlay(
    'Objective complete',
    `Rating: ${rating} · Time ${fmtTime(game.time)}`,
    `Guard's highest suspicion: ${Math.round(game.maxSuspicion)}% · Press R to play again`
  );
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

    const samples = player.samplePoints();
    const sampleLight = samples.map((p) => lightAt(p, level));
    player.lightLevel = (sampleLight[0] + sampleLight[1] + sampleLight[2]) / 3;

    holdGuard();
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
  const pivot = new THREE.Vector3(player.pos.x, player.eyeHeight, player.pos.z);

  // Shoulder offset, pulled in if a wall is right beside the player.
  const shoulderGoal = pivot.clone().addScaledVector(right, SHOULDER);
  const ts = segmentFirstHit(pivot, shoulderGoal, level.boxes);
  const shoulder = pivot.clone().addScaledVector(right, SHOULDER * Math.max(0, ts - 0.3));

  // Boom back from the shoulder, pulled in on walls.
  const desired = shoulder.clone().addScaledVector(dir, -CAM_DIST);
  const t = segmentFirstHit(shoulder, desired, level.boxes);
  const dist = Math.max(0.3, CAM_DIST * t - 0.2);
  camera.position.copy(shoulder).addScaledVector(dir, -dist);
  camera.position.y = clamp(camera.position.y, 0.15, 3.85);
  camera.lookAt(camera.position.clone().add(dir));
}

function updateHud() {
  hud.update({
    light: player.lightLevel,
    noise: game.noise.radius / MAX_NOISE,
    nv: nv.enabled,
    stance: player.stance,
    prompt: game.state !== 'playing' ? ''
      : game.takedown === 'grab' ? 'E: grab'
      : game.takedown === 'knockout' ? 'E: knock out · WASD drag him'
      : player.locked ? ''
      : game.interact ? game.interact.label() : '',
    guard: {
      pos: new THREE.Vector3(guard.pos.x, 2.15, guard.pos.z),
      suspicion: guard.suspicion,
      icon: guard.icon,
      grip: guard.state === 'grabbed' ? guard.grip : null,
      hidden: guard.state === 'ko' || guard.state === 'down',
    },
  });
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
  noiseRing.visible = showDebug && r > 0;
  if (noiseRing.visible) {
    noiseRing.scale.setScalar(r);
    noiseRing.position.set(player.pos.x, 0.03, player.pos.z);
  }
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
