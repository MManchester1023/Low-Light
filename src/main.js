// Low Light prototype: game loop, camera, interaction, win/lose.

import * as THREE from 'three';
import { buildLevel } from './level.js';
import { Player } from './player.js';
import { Guard } from './guard.js';
import { lightAt } from './lighting.js';
import { Hud } from './hud.js';
import { Input, NullInput } from './input.js';
import { segmentFirstHit } from './collision.js';
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

const CAM_DIST = 3.0;
const SHOULDER = 0.45;
const SENS = 0.0025;

const game = {
  state: 'playing', // 'playing' | 'spotted' | 'complete'
  time: 0,
  maxSuspicion: 0,
  cam: { yaw: 0, pitch: -0.2 },
  level, player, guard, camera,
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
  if (input.locked) hud.hideOverlay();
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
  hud.showOverlay('Spotted', 'The guard saw you.', 'Press R to restart');
}

function onComplete() {
  game.state = 'complete';
  // Prototype: being spotted ends the run, so any finish is a Ghost (no takedowns exist yet).
  hud.showOverlay(
    'Objective complete',
    `Rating: Ghost · Time ${fmtTime(game.time)}`,
    `Guard's highest suspicion: ${Math.round(game.maxSuspicion)}% · Press R to play again`
  );
}

/** One simulation step. */
function step(dt, inp) {
  if (game.state === 'playing') {
    game.cam.yaw -= inp.mouseDX * SENS;
    game.cam.pitch = clamp(game.cam.pitch - inp.mouseDY * SENS, -1.1, 0.6);

    player.update(dt, inp, game.cam.yaw, level.boxes);

    const samples = player.samplePoints();
    const sampleLight = samples.map((p) => lightAt(p, level));
    player.lightLevel = (sampleLight[0] + sampleLight[1] + sampleLight[2]) / 3;

    guard.update(dt, player, samples, sampleLight, level);
    game.maxSuspicion = Math.max(game.maxSuspicion, guard.suspicion);
    game.time += dt;

    game.interact = nearestInteractable();
    if (game.interact && inp.pressed('KeyE')) {
      game.interact.use();
      if (game.interact.kind === 'objective') onComplete();
    }
    if (guard.suspicion >= 100) onSpotted();
  }
  if (inp.pressed('KeyR')) reset();
  if (inp.pressed('KeyV')) guard.toggleCone();
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
    stance: player.stance,
    prompt: game.state === 'playing' && game.interact ? game.interact.label() : '',
    guard: {
      pos: new THREE.Vector3(guard.pos.x, 2.15, guard.pos.z),
      suspicion: guard.suspicion,
      icon: guard.icon,
    },
  });
}

function resize() {
  const w = window.innerWidth;
  const h = window.innerHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}
window.addEventListener('resize', resize);

// Pause while the mouse isn't captured.
document.addEventListener('pointerlockchange', () => {
  if (game.state !== 'playing') return;
  if (input.locked) hud.hideOverlay();
  else hud.showOverlay('Paused', 'Click to play');
});

let last = performance.now();
function frame(now) {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  if (input.locked || game.state !== 'playing') step(dt, input);
  else if (input.pressed('KeyR')) reset();
  input.endFrame();
  updateCamera();
  updateHud();
  renderer.render(scene, camera);
  requestAnimationFrame(frame);
}

// Scripted checks: run the simulation without the mouse. `drive` may set game state between steps.
const nullInput = new NullInput();
game.debug = {
  simulate(seconds, drive) {
    const dt = 1 / 60;
    for (let i = 0; i < Math.round(seconds * 60); i++) {
      if (drive) drive(i * dt);
      step(dt, nullInput);
    }
    updateCamera();
    updateHud();
  },
  reset,
};

resize();
reset();
requestAnimationFrame(frame);
