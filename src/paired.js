// Paired takedown test (status #6): can Three.js play an attacker clip and a victim clip that line up,
// before we pay for an animation pack?
//
// What's here:
//   makeRig()        a stand-in skinned humanoid (boxes on a 17-bone skeleton), built in code, so no asset
//                    files are needed. A bought pack's GLB replaces it.
//   makeTakedownClips()  one placeholder paired clip (rear choke, then lowered to the floor), authored the way
//                    packs author theirs: both clips share one "pair space" (origin at the victim's feet,
//                    -z his forward), and the root bone carries the root motion.
//   PairedTakedown   plays both clips from one clock (no drift), anchors the pair on the victim, and warps the
//                    attacker from wherever he really started onto the clip's start over WARP_TIME, so he
//                    doesn't need to be standing in exactly the right spot. Fires timed events (grab, limp, down).
//   roundTripGLB()   exports the rig and both clips to a GLB, loads it back with GLTFLoader and clones it for
//                    two characters with SkeletonUtils: the same path a pack's GLB takes.
// The test page is animtest.html; tests.js checks the alignment and the GLB round trip.
// The choreography is a rough placeholder: it's here to prove the pipeline, not to look good.

import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';

export const WARP_TIME = 0.3; // s to pull the attacker from where he stood onto the clip's start (guess)
const HIPS_Y = 0.95;

// name, parent, rest offset from the parent, and the box that rides on it: [size, centre in bone space]
const BONES = [
  ['root', null, [0, 0, 0]],
  ['hips', 'root', [0, HIPS_Y, 0], [[0.32, 0.16, 0.2], [0, 0, 0]]],
  ['spine', 'hips', [0, 0.12, 0], [[0.3, 0.2, 0.18], [0, 0.08, 0]]],
  ['chest', 'spine', [0, 0.18, 0], [[0.38, 0.26, 0.21], [0, 0.11, 0]]],
  ['neck', 'chest', [0, 0.24, 0], [[0.09, 0.09, 0.09], [0, 0.03, 0]]],
  ['head', 'neck', [0, 0.08, 0], [[0.2, 0.24, 0.22], [0, 0.11, 0]]],
  ['upperArmL', 'chest', [-0.21, 0.17, 0], [[0.09, 0.28, 0.09], [0, -0.14, 0]]],
  ['foreArmL', 'upperArmL', [0, -0.28, 0], [[0.08, 0.26, 0.08], [0, -0.13, 0]]],
  ['handL', 'foreArmL', [0, -0.26, 0], [[0.06, 0.09, 0.09], [0, -0.045, 0]]],
  ['upperArmR', 'chest', [0.21, 0.17, 0], [[0.09, 0.28, 0.09], [0, -0.14, 0]]],
  ['foreArmR', 'upperArmR', [0, -0.28, 0], [[0.08, 0.26, 0.08], [0, -0.13, 0]]],
  ['handR', 'foreArmR', [0, -0.26, 0], [[0.06, 0.09, 0.09], [0, -0.045, 0]]],
  ['thighL', 'hips', [-0.1, -0.04, 0], [[0.13, 0.45, 0.13], [0, -0.225, 0]]],
  ['shinL', 'thighL', [0, -0.45, 0], [[0.11, 0.44, 0.11], [0, -0.22, 0]]],
  ['footL', 'shinL', [0, -0.44, 0], [[0.1, 0.06, 0.24], [0, -0.01, -0.06]]],
  ['thighR', 'hips', [0.1, -0.04, 0], [[0.13, 0.45, 0.13], [0, -0.225, 0]]],
  ['shinR', 'thighR', [0, -0.45, 0], [[0.11, 0.44, 0.11], [0, -0.22, 0]]],
  ['footR', 'shinR', [0, -0.44, 0], [[0.1, 0.06, 0.24], [0, -0.01, -0.06]]],
];
export const BONE_NAMES = BONES.map((b) => b[0]);

/** Stand-in skinned character: a Group holding one SkinnedMesh, bones named as in BONES. Faces -z. */
export function makeRig(color = 0x2a3340, visorColor = 0x22ff44) {
  const bones = {};
  const list = BONES.map(([name, parent, off]) => {
    const b = new THREE.Bone();
    b.name = name;
    b.position.fromArray(off);
    if (parent) bones[parent].add(b);
    bones[name] = b;
    return b;
  });
  bones.root.updateMatrixWorld(true);
  const body = new THREE.Color(color);
  const visor = new THREE.Color(visorColor);
  const part = (size, centre, boneIndex, col) => {
    const g = new THREE.BoxGeometry(...size);
    g.translate(...centre);
    g.applyMatrix4(list[boneIndex].matrixWorld);
    const n = g.attributes.position.count;
    const idx = new Uint16Array(n * 4);
    const wt = new Float32Array(n * 4);
    const cols = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      idx[i * 4] = boneIndex;
      wt[i * 4] = 1; // rigid: each box follows one bone
      cols.set([col.r, col.g, col.b], i * 3);
    }
    g.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(idx, 4));
    g.setAttribute('skinWeight', new THREE.Float32BufferAttribute(wt, 4));
    g.setAttribute('color', new THREE.Float32BufferAttribute(cols, 3));
    return g;
  };
  const geos = [];
  BONES.forEach(([, , , box], i) => { if (box) geos.push(part(box[0], box[1], i, body)); });
  geos.push(part([0.18, 0.06, 0.06], [0, 0.14, -0.11], BONE_NAMES.indexOf('head'), visor)); // shows which way he faces
  const mesh = new THREE.SkinnedMesh(mergeGeometries(geos),
    new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.8 }));
  mesh.name = 'body';
  mesh.castShadow = true;
  mesh.frustumCulled = false;
  mesh.add(bones.root);
  mesh.bind(new THREE.Skeleton(list));
  const rig = new THREE.Group();
  rig.name = 'rig';
  rig.add(mesh);
  return rig;
}

/**
 * Wraps a loaded or built model for paired play: group (placed on the pair anchor) > warp > model.
 * Clips bind to bones by name inside the model.
 */
export function makeActor(model) {
  const group = new THREE.Group();
  const warp = new THREE.Object3D();
  group.add(warp);
  warp.add(model);
  return { group, warp, model, mixer: new THREE.AnimationMixer(model), bone: (n) => model.getObjectByName(n) };
}

// ---------- Placeholder choreography ----------
const DEG = Math.PI / 180;

/** Keyframes → clip. Each key inherits the previous key's pose; rot is degrees (XYZ), root in pair space. */
function buildClip(name, keys) {
  let prev = { root: [0, 0, 0], hipsY: HIPS_Y, rot: {} };
  const full = keys.map((k) => (prev = { ...prev, ...k, rot: { ...prev.rot, ...(k.rot || {}) } }));
  const times = full.map((k) => k.t);
  const tracks = [
    new THREE.VectorKeyframeTrack('root.position', times, full.flatMap((k) => k.root)),
    new THREE.VectorKeyframeTrack('hips.position', times, full.flatMap((k) => [0, k.hipsY, 0])),
  ];
  const e = new THREE.Euler();
  const q = new THREE.Quaternion();
  const names = BONE_NAMES.filter((n) => full.some((k) => k.rot[n]));
  for (const n of names) {
    const vals = [];
    for (const k of full) {
      const r = k.rot[n] || [0, 0, 0];
      q.setFromEuler(e.set(r[0] * DEG, r[1] * DEG, r[2] * DEG));
      vals.push(q.x, q.y, q.z, q.w);
    }
    tracks.push(new THREE.QuaternionKeyframeTrack(`${n}.quaternion`, times, vals));
  }
  return new THREE.AnimationClip(name, times[times.length - 1], tracks);
}

/** Timed moments in the pair clip, for gameplay to hook (glTF has no events, so they live here). */
export const TAKEDOWN_EVENTS = [
  { t: 0.55, name: 'grab' },  // arm round the neck: from here the victim can't call out
  { t: 2.5, name: 'limp' },   // out cold
  { t: 3.4, name: 'down' },   // on the floor; hand control back
];
export const HOLD = [0.75, 2.3]; // s: the stretch where the attacker's arm must stay on the victim's neck

/** Rear choke, then lowered to the floor. Both clips in pair space; the attacker starts 0.95 m behind. */
export function makeTakedownClips() {
  const arm = (x, z = 0) => [x, 0, z];
  const attacker = buildClip('takedown_attacker', [
    { t: 0, root: [0, 0, 0.95], rot: { upperArmL: arm(15), upperArmR: arm(15) } },
    { t: 0.35, root: [0, 0, 0.66], rot: { spine: [-6, 0, 0], thighL: [25, 0, 0], shinL: [-30, 0, 0],
      upperArmR: arm(70), upperArmL: arm(55, 10), foreArmR: [0, 0, -40] } },
    { t: 0.55, root: [0, 0, 0.48], rot: { spine: [-3, 0, 0], thighL: [5, 0, 0], shinL: [-8, 0, 0],
      upperArmR: arm(104), foreArmR: [0, 0, -90], upperArmL: arm(85, 22), foreArmL: [80, 0, 0] } },
    { t: 0.9, root: [0, 0, 0.49], rot: { spine: [5, 0, 0], thighL: [0, 0, 0], shinL: [0, 0, 0] } },
    { t: 1.4, root: [0.03, 0, 0.5], rot: { spine: [6, 6, 0] } },
    { t: 1.9, root: [-0.03, 0, 0.5], rot: { spine: [6, -6, 0] } },
    { t: 2.3, root: [0, 0, 0.5], rot: { spine: [4, 0, 0] } },
    { t: 2.5, hipsY: 0.86, rot: { thighL: [30, 0, 0], thighR: [30, 0, 0], shinL: [-55, 0, 0], shinR: [-55, 0, 0] } },
    { t: 2.9, root: [0, 0, 0.6], hipsY: 0.64, rot: { spine: [-15, 0, 0], thighL: [62, 0, 0], thighR: [62, 0, 0],
      shinL: [-100, 0, 0], shinR: [-100, 0, 0], upperArmR: arm(65), foreArmR: [0, 0, -70], upperArmL: arm(60, 15),
      foreArmL: [50, 0, 0] } },
    { t: 3.4, root: [0, 0, 0.66], hipsY: 0.5, rot: { spine: [-22, 0, 0], thighL: [80, 0, 0], thighR: [80, 0, 0],
      shinL: [-120, 0, 0], shinR: [-120, 0, 0], upperArmR: arm(40, -10), foreArmR: [20, 0, 0],
      upperArmL: arm(40, 10), foreArmL: [20, 0, 0] } },
  ]);
  const grabbing = { upperArmL: arm(100, 30), foreArmL: [70, 0, 0], upperArmR: arm(100, -30), foreArmR: [70, 0, 0] };
  const victim = buildClip('takedown_victim', [
    { t: 0 },
    { t: 0.5, rot: { neck: [0, 0, 0] } },
    { t: 0.75, root: [0, 0, 0.1], rot: { spine: [10, 0, 0], chest: [8, 0, 0], neck: [6, 0, 0], head: [8, 0, 0], ...grabbing } },
    { t: 1.1, root: [0.03, 0, 0.1], rot: { spine: [10, 8, 0], thighL: [35, 0, 0], shinL: [-45, 0, 0] } },
    { t: 1.5, root: [-0.03, 0, 0.1], rot: { spine: [10, -8, 0], thighL: [0, 0, 0], shinL: [0, 0, 0],
      thighR: [30, 0, 0], shinR: [-40, 0, 0] } },
    { t: 1.9, root: [0.02, 0, 0.1], rot: { spine: [10, 4, 0], thighR: [10, 0, 0], shinR: [-15, 0, 0], thighL: [15, 0, 0] } },
    { t: 2.3, root: [0, 0, 0.1], rot: { spine: [10, 0, 0], thighL: [0, 0, 0], thighR: [0, 0, 0], shinR: [0, 0, 0] } },
    { t: 2.5, hipsY: 0.86, rot: { neck: [-12, 0, 0], head: [-15, 0, 0], upperArmL: arm(30, 10), foreArmL: [20, 0, 0],
      upperArmR: arm(30, -10), foreArmR: [20, 0, 0], thighL: [25, 0, 0], thighR: [25, 0, 0], shinL: [-50, 0, 0], shinR: [-50, 0, 0] } },
    { t: 2.9, root: [0, 0, -0.1], hipsY: 0.5, rot: { hips: [45, 0, 0], spine: [0, 0, 0], chest: [0, 0, 0],
      thighL: [45, 0, 0], thighR: [45, 0, 0], shinL: [-60, 0, 0], shinR: [-60, 0, 0] } },
    { t: 3.4, root: [0, 0, -0.55], hipsY: 0.14, rot: { hips: [88, 0, 0], neck: [0, 0, 0], head: [-5, 0, 0],
      thighL: [0, 0, 4], thighR: [0, 0, -4], shinL: [-5, 0, 0], shinR: [-5, 0, 0],
      upperArmL: arm(10, -20), upperArmR: arm(10, 20), foreArmL: [0, 0, 0], foreArmR: [0, 0, 0] } },
  ]);
  return { attacker, victim, events: TAKEDOWN_EVENTS };
}

/** Root position at t = 0 from a clip's root.position track. */
function rootStart(clip) {
  const tr = clip.tracks.find((t) => t.name === 'root.position');
  return tr ? new THREE.Vector3(tr.values[0], tr.values[1], tr.values[2]) : new THREE.Vector3();
}

const smooth = (x) => x * x * (3 - 2 * x);

/** Plays an attacker clip and a victim clip together, lined up on the victim. */
export class PairedTakedown {
  constructor(attacker, victim, clips) {
    this.a = attacker;
    this.v = victim;
    this.clips = clips;
    this.events = clips.events || TAKEDOWN_EVENTS;
    this.duration = Math.max(clips.attacker.duration, clips.victim.duration);
    this.aAction = attacker.mixer.clipAction(clips.attacker);
    this.vAction = victim.mixer.clipAction(clips.victim);
    for (const act of [this.aAction, this.vAction]) { act.setLoop(THREE.LoopOnce, 1); act.clampWhenFinished = true; }
    this.p0 = rootStart(clips.attacker);
    this.delta = new THREE.Vector3();
    this.dyaw = 0;
    this.t = 0;
    this.running = false;
  }

  /**
   * Begin. The victim stands at anchorPos facing anchorYaw (the pair is placed on him); the attacker is
   * wherever he really is, and gets warped onto the clip's start.
   */
  start({ anchorPos, anchorYaw, attackerPos, attackerYaw }) {
    for (const actor of [this.a, this.v]) {
      actor.group.position.set(anchorPos.x, 0, anchorPos.z);
      actor.group.rotation.y = anchorYaw;
    }
    // The attacker's real start in pair space (rotate the world offset by -anchorYaw).
    const dx = attackerPos.x - anchorPos.x;
    const dz = attackerPos.z - anchorPos.z;
    const c = Math.cos(-anchorYaw);
    const s = Math.sin(-anchorYaw);
    this.delta.set(dx * c + dz * s - this.p0.x, 0, -dx * s + dz * c - this.p0.z);
    this.dyaw = Math.atan2(Math.sin(attackerYaw - anchorYaw), Math.cos(attackerYaw - anchorYaw));
    this.aAction.reset().play();
    this.vAction.reset().play();
    this.running = true;
    this.setTime(0);
  }

  /** Jump both clips to time t (one clock for both, so they can't drift apart). */
  setTime(t) {
    this.t = Math.min(Math.max(t, 0), this.duration);
    for (const act of [this.aAction, this.vAction]) { act.enabled = true; act.paused = false; }
    this.a.mixer.setTime(this.t);
    this.v.mixer.setTime(this.t);
    // Warp: full offset at t = 0, none from WARP_TIME on. Rotates about the clip's start point.
    const w = 1 - smooth(Math.min(1, this.t / WARP_TIME));
    const ang = this.dyaw * w;
    const c = Math.cos(ang);
    const s = Math.sin(ang);
    const p = this.p0;
    this.a.warp.rotation.y = ang;
    this.a.warp.position.set(p.x + this.delta.x * w - (p.x * c + p.z * s), 0, p.z + this.delta.z * w - (-p.x * s + p.z * c));
    this.a.group.updateMatrixWorld(true);
    this.v.group.updateMatrixWorld(true);
  }

  /** Advance; returns the events passed this step. */
  update(dt) {
    if (!this.running) return [];
    const from = this.t;
    this.setTime(this.t + dt);
    const fired = this.events.filter((e) => e.t > from && e.t <= this.t);
    if (this.t >= this.duration) this.running = false;
    return fired;
  }

  /** Gap between the clips' clocks (should always be 0). */
  get drift() {
    return Math.abs(this.aAction.time - this.vAction.time);
  }

  /** m from the victim's throat to the attacker's right forearm: how well the hold lines up right now. */
  contactError() {
    const P = (actor, n) => actor.bone(n).getWorldPosition(new THREE.Vector3());
    const throat = this.v.bone('neck').localToWorld(new THREE.Vector3(0, 0.04, 0));
    const a = P(this.a, 'foreArmR');
    const b = P(this.a, 'handR');
    return new THREE.Line3(a, b).closestPointToPoint(throat, true, new THREE.Vector3()).distanceTo(throat);
  }

  /** Where gameplay takes over at the end: the attacker's feet and the victim's hips (the body), in world space. */
  endPlacement() {
    return {
      attacker: this.a.bone('root').getWorldPosition(new THREE.Vector3()),
      victimHips: this.v.bone('hips').getWorldPosition(new THREE.Vector3()),
    };
  }
}

/**
 * Export one rig with both clips to a GLB (in memory), load it back, and clone it for two characters:
 * the path a pack's GLB would take. Resolves to { bytes, attacker, victim, clips }.
 */
export async function roundTripGLB(clips = makeTakedownClips()) {
  const rig = makeRig();
  const glb = await new GLTFExporter().parseAsync(rig, { binary: true, animations: [clips.attacker, clips.victim] });
  const gltf = await new GLTFLoader().parseAsync(glb, '');
  const byName = (n) => gltf.animations.find((c) => c.name === n);
  const loaded = { attacker: byName('takedown_attacker'), victim: byName('takedown_victim'), events: clips.events };
  return {
    bytes: glb.byteLength,
    attacker: makeActor(SkeletonUtils.clone(gltf.scene)),
    victim: makeActor(SkeletonUtils.clone(gltf.scene)),
    clips: loaded,
  };
}
