import * as THREE from 'three';
import { Pipe } from './pipe.js';
import { resolveCircle } from './collision.js';

const GLASS_R = 0.8; // m: how far a shot-out light's glass spreads on the floor (guess)

// Builds the test level: two rooms, geometry, lights, switches, a door, objective, guard routes.
export function buildLevel(scene) {
  const boxes = [];
  const lights = [];
  const interactables = [];

  // ---------- Materials ----------
  const mat = (color, roughness = 0.9, extra = {}) =>
    new THREE.MeshStandardMaterial({ color, roughness, metalness: 0, ...extra });
  const floorMat = mat(0x3a3c40);
  const ceilMat = mat(0x34363a);
  const wallMat = mat(0x5a5f66);
  const crateMat = mat(0x6b5a3e);
  const shelfMat = mat(0x444a52);
  const deskMat = mat(0x4a3828);

  // Solid box helper: centred at (x, y0+h/2, z); registers an AABB for collision/LOS.
  function box(x, z, w, h, d, material, y0 = 0) {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material);
    mesh.position.set(x, y0 + h / 2, z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    scene.add(mesh);
    boxes.push({
      min: { x: x - w / 2, y: y0, z: z - d / 2 },
      max: { x: x + w / 2, y: y0 + h, z: z + d / 2 },
    });
    return mesh;
  }

  // ---------- Floor & ceiling ----------
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(24, 18), floorMat);
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  scene.add(floor);

  const ceiling = new THREE.Mesh(new THREE.PlaneGeometry(24, 18), ceilMat);
  ceiling.rotation.x = Math.PI / 2; // faces down
  ceiling.position.y = 4;
  ceiling.receiveShadow = true;
  scene.add(ceiling);

  // ---------- Walls ----------
  box(0, -9.15, 24.6, 4, 0.3, wallMat); // north
  box(0, 9.15, 24.6, 4, 0.3, wallMat); // south
  box(-12.15, 0, 0.3, 4, 18, wallMat); // west
  box(12.15, 0, 0.3, 4, 18, wallMat); // east
  // Divider at x=2: open doorway at z -3..0, a door at z 6.4..7.6
  box(2, -6, 0.3, 4, 6, wallMat);
  box(2, 2.5, 0.3, 4, 5, wallMat);
  box(2, 5.7, 0.3, 4, 1.4, wallMat);
  box(2, 8.3, 0.3, 4, 1.4, wallMat);
  box(2, 7, 0.3, 1.8, 1.2, wallMat, 2.2); // above the door

  // ---------- Cover ----------
  box(-6, 4, 1.2, 1.1, 1.2, crateMat);
  box(-4, -5, 2, 1.1, 1, crateMat);
  box(-8, -2, 1.2, 1.1, 1.2, crateMat);
  box(7, 1, 1.5, 1.1, 1.5, crateMat);
  box(11.3, -5, 1.2, 1.1, 1.2, crateMat);
  box(-1, 4, 0.8, 4, 0.8, wallMat); // pillar
  box(4.5, 7, 1, 2.2, 3, shelfMat); // shelf
  box(9, -7.4, 2.2, 0.8, 1, deskMat); // desk

  // ---------- Hiding spots: cupboards a body can be shut in (main.js handles carrying) ----------
  // Solid, against a wall. faceX/faceZ: the way its doors face (into the room).
  const hideSpots = [];
  const cupboardMat = mat(0x3c4a44, 0.75);
  const cupboardDoorMat = mat(0x46564e, 0.7);
  function cupboard(id, x, z, faceX, faceZ) {
    const along = faceX !== 0; // doors face along x: the cupboard is wide in z
    const w = along ? 0.7 : 1.1;
    const d = along ? 1.1 : 0.7;
    box(x, z, w, 2.1, d, cupboardMat);
    for (const side of [-1, 1]) { // two door panels and handles on the front
      const panel = new THREE.Mesh(new THREE.BoxGeometry(along ? 0.03 : 0.52, 1.95, along ? 0.52 : 0.03), cupboardDoorMat);
      const off = side * 0.27;
      panel.position.set(x + faceX * 0.36 + (along ? 0 : off), 1.05, z + faceZ * 0.36 + (along ? off : 0));
      const handle = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.18, 0.03), mat(0x9a9a8a, 0.4, { metalness: 0.6 }));
      handle.position.set(x + faceX * 0.39 + (along ? 0 : side * 0.04), 1.05, z + faceZ * 0.39 + (along ? side * 0.04 : 0));
      scene.add(panel, handle);
    }
    hideSpots.push({
      id,
      pos: new THREE.Vector3(x + faceX * 0.9, 0, z + faceZ * 0.9), // where you stand to use it
      inside: new THREE.Vector3(x, 0, z),
      yaw: Math.atan2(-faceZ, faceX), // a body inside lies across it (never seen anyway)
      body: null,                      // the guard shut in it
    });
  }
  cupboard('west', -11.65, 1.5, 1, 0);  // west wall, south of the crates
  cupboard('east', 8, 8.65, 0, -1);     // south wall of the east room

  // ---------- Ceiling pipe ----------
  // Riser by the west wall, along the ceiling over the middle doorway (the guard's route), then north and
  // east along the north wall to a riser behind the desk. Not solid: it never blocks sight or movement.
  const pipes = [new Pipe(scene, [[-11.6, -2.6], [3.5, -2.6], [3.5, -8.5], [7.6, -8.5]])];

  // ---------- Objective files (not solid) ----------
  const filesMat = mat(0xd8d0b8, 0.8, { emissive: 0xffb060, emissiveIntensity: 0.6 });
  const files = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.04, 0.3), filesMat);
  files.position.set(8.6, 0.82, -7.3);
  files.castShadow = true;
  scene.add(files);

  // ---------- Lights ----------
  const FIXTURE_ON = 2;

  function addLight({ id, group, x, y, z, light, near, range, strength, fixture }) {
    light.position.set(x, y, z);
    scene.add(light);
    fixture.castShadow = false;
    scene.add(fixture);
    const entry = {
      id, group, pos: new THREE.Vector3(x, y, z), near, range, strength,
      on: true, light, fixture,
      baseIntensity: light.intensity, // remembered so we can restore it
    };
    lights.push(entry);
    return entry;
  }

  function ceilingLight(id, group, x, z) {
    const light = new THREE.PointLight(0xffe2b0, 14, 10, 2);
    light.castShadow = true;
    light.shadow.mapSize.set(512, 512);
    light.shadow.bias = -0.003;
    light.shadow.camera.near = 0.1;
    light.shadow.camera.far = 12;
    const fixture = new THREE.Mesh(
      new THREE.BoxGeometry(0.6, 0.08, 0.6),
      mat(0x888070, 0.6, { emissive: 0xffe2b0, emissiveIntensity: FIXTURE_ON })
    );
    fixture.position.set(x, 3.6, z); // just above the light
    return addLight({ id, group, x, y: 3.55, z, light, near: 1.5, range: 9, strength: 1, fixture });
  }

  ceilingLight('A1', 'A', -7, 3);
  ceilingLight('A2', 'A', -6, -5);
  ceilingLight('B1', 'B', 6, -1);
  ceilingLight('B2', 'B', 9, 5);

  // Desk lamp (no shadows); the lamp shade is the fixture
  const lampLight = new THREE.PointLight(0xffd090, 4, 4.5, 2);
  const lampFixture = new THREE.Mesh(
    new THREE.CylinderGeometry(0.1, 0.18, 0.22, 12),
    mat(0x3a5a40, 0.6, { emissive: 0xffd090, emissiveIntensity: FIXTURE_ON })
  );
  lampFixture.position.set(9.6, 1.1, -7.3); // on the desk top (0.8)
  const lamp = addLight({
    id: 'lamp', group: 'lamp', x: 9.6, y: 1.3, z: -7.3,
    light: lampLight, near: 0.4, range: 4, strength: 0.9, fixture: lampFixture,
  });

  // Toggle one light without touching `visible` (avoids shader recompiles)
  function setLightOn(l, on) {
    if (l.broken) on = false; // shot out: no switch brings it back
    l.on = on;
    l.light.intensity = on ? l.baseIntensity : 0;
    l.fixture.material.emissiveIntensity = on ? FIXTURE_ON : 0;
  }

  // Dim fill so dark areas stay readable (visual only)
  scene.add(new THREE.HemisphereLight(0x8090b0, 0x202020, 0.25));

  // ---------- Switches ----------
  const ledOn = 0x20ff40;
  const ledOff = 0xff2020;
  const groupLeds = {}; // group -> LED material

  function updateLeds() {
    for (const g in groupLeds) {
      const on = lights.some((l) => l.group === g && l.on);
      const m = groupLeds[g];
      m.color.setHex(on ? ledOn : ledOff);
      m.emissive.setHex(on ? ledOn : ledOff);
    }
  }

  function setGroup(group, on) {
    for (const l of lights) if (l.group === group) setLightOn(l, on);
    updateLeds();
  }

  function groupIsOn(group) {
    return lights.some((l) => l.group === group && l.on);
  }

  // Wall switch: plate + LED. nx/nz = direction the plate faces (into the room).
  function wallSwitch(group, x, y, z, faceX, ipos) {
    const plate = new THREE.Mesh(
      new THREE.BoxGeometry(0.08, 0.2, 0.14),
      mat(0x25272b, 0.7)
    );
    plate.position.set(x, y, z);
    scene.add(plate);
    const ledMat = mat(ledOn, 0.5, { emissive: ledOn, emissiveIntensity: 2 });
    const led = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.04, 0.04), ledMat);
    led.position.set(x + faceX * 0.05, y + 0.06, z);
    scene.add(led);
    groupLeds[group] = ledMat;
    interactables.push({
      kind: 'switch',
      group,
      pos: new THREE.Vector3(ipos[0], 0, ipos[1]),
      range: 1.4,
      label: () => (groupIsOn(group) ? 'E: turn lights off' : 'E: turn lights on'),
      use: () => setGroup(group, !groupIsOn(group)),
    });
  }

  wallSwitch('A', -11.95, 1.3, 5.5, 1, [-11.4, 5.5]); // west wall, faces +x
  wallSwitch('B', 2.2, 1.3, 3.5, 1, [2.7, 3.5]); // east face of divider

  // Lamp is its own switch, with a small LED on the desk beside it
  const lampLedMat = mat(ledOn, 0.5, { emissive: ledOn, emissiveIntensity: 2 });
  const lampLed = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.04, 0.04), lampLedMat);
  lampLed.position.set(9.6, 0.82, -6.95);
  scene.add(lampLed);
  groupLeds.lamp = lampLedMat;
  interactables.push({
    kind: 'switch',
    group: 'lamp',
    pos: new THREE.Vector3(9.9, 0, -6.6),
    range: 1.4,
    label: () => (lamp.on ? 'E: turn lamp off' : 'E: turn lamp on'),
    use: () => setGroup('lamp', !lamp.on),
  });

  // ---------- Objective ----------
  interactables.push({
    kind: 'objective',
    pos: new THREE.Vector3(8.6, 0, -6.6),
    range: 1.4,
    label: () => 'E: take the files',
    use: () => { files.visible = false; },
  });

  // ---------- Door ----------
  // Starts closed. Closed, it is solid: blocks movement, sight, light and halves noise like a wall.
  // Guards walk through it (they open it and shut it behind them); one the player leaves open is evidence.
  const navBoxes = boxes.slice(); // guard paths ignore doors (they open them on the way)
  const doors = [];
  const doorMat = mat(0x5a4632, 0.7);
  function addDoor(x, z0, z1) {
    const pivot = new THREE.Group(); // hinge at z0
    pivot.position.set(x, 0, z0);
    const leaf = new THREE.Mesh(new THREE.BoxGeometry(0.08, 2.2, z1 - z0 - 0.04), doorMat);
    leaf.position.set(0, 1.1, (z1 - z0) / 2);
    leaf.castShadow = true;
    leaf.receiveShadow = true;
    const knob = new THREE.Mesh(new THREE.SphereGeometry(0.04, 8, 6), mat(0xb0a070, 0.4, { metalness: 0.6 }));
    knob.position.set(0.07, 1.0, z1 - z0 - 0.15);
    pivot.add(leaf, knob);
    scene.add(pivot);
    const door = {
      center: new THREE.Vector3(x, 1.1, (z0 + z1) / 2),
      box: { min: { x: x - 0.05, y: 0, z: z0 }, max: { x: x + 0.05, y: 2.2, z: z1 } },
      normal: { x: 1, z: 0 }, // the door faces along x
      open: false, openedBy: null, pivot,
    };
    doors.push(door);
    interactables.push({
      kind: 'door', door,
      pos: new THREE.Vector3(x, 0, door.center.z),
      range: 1.4,
      label: () => (door.open ? 'E: close door' : 'E: open door'),
      use: () => setDoor(door, !door.open, 'player'),
    });
    return door;
  }
  const level = { occupants: () => [] }; // main.js fills this in: positions that stop a door closing

  /** Open or close a door. Closing fails (returns false) if someone is standing in the doorway. */
  function setDoor(door, open, by = 'player') {
    if (door.open === open) return true;
    if (!open) {
      const b = door.box;
      for (const p of level.occupants()) {
        if (p.x > b.min.x - 0.4 && p.x < b.max.x + 0.4 && p.z > b.min.z - 0.3 && p.z < b.max.z + 0.3) return false;
      }
      boxes.push(door.box);
    } else {
      boxes.splice(boxes.indexOf(door.box), 1);
    }
    door.open = open;
    door.openedBy = open ? by : null;
    door.pivot.rotation.y = open ? Math.PI / 2 : 0; // swings into the east room
    return true;
  }
  addDoor(2, 6.4, 7.6);
  for (const d of doors) boxes.push(d.box); // closed to start

  // ---------- Guard routes ----------
  const guardRoute = [
    { x: 6, z: -6, pause: 2, lookYaw: 0 },
    { x: 4, z: -1.5 },
    { x: -3, z: -1.5, pause: 2.5, lookYaw: Math.PI / 2 },
    { x: 4, z: -1.5 },
    { x: 6, z: 6, pause: 1.5, lookYaw: Math.PI },
    { x: 10, z: 6 },
    { x: 10, z: -2, pause: 2, lookYaw: Math.PI / 2 },
  ];
  // Second guard: the north half of the west room.
  const guardRoute2 = [
    { x: -10, z: -5, pause: 2.5, lookYaw: -Math.PI / 2 },
    { x: -7, z: -7 },
    { x: -1, z: -7, pause: 2, lookYaw: Math.PI / 2 },
    { x: -7, z: -7 },
  ];

  // ---------- Guard nav nodes (doorways and open floor spots, all clear of furniture) ----------
  const navNodes = [
    [2, -1.5], [0.5, -1.5], [3.5, -1.5],            // middle doorway
    [2, 7], [0.5, 7], [3.3, 7], [3, 4.7],            // south door
    [-3, -1.5], [-9, 0.5], [-10, 5], [-3, 6.5], [-7, -7], [-1, -7], [-10, -5],  // west room
    [6, -6], [10, -2], [10, 6], [6, 6], [8.5, -4], [11, 2], [5, 3],            // east room
  ].map(([x, z]) => new THREE.Vector3(x, 0, z));

  const switchFor = (group) => interactables.find((i) => i.kind === 'switch' && i.group === group);

  // Broken glass left on the floor under shot-out lights: walking over it is louder (main.js).
  const glass = []; // [{ x, z, r, mesh }]
  const glassMat = mat(0xb8d8e8, 0.15, { metalness: 0.3, emissive: 0x405868, emissiveIntensity: 0.5, side: THREE.DoubleSide });
  const shardGeo = new THREE.CircleGeometry(0.05, 3);

  function spillGlass(l) {
    // Straight down from the fixture, nudged off any furniture it would land on (the lamp sits on the desk).
    const spot = new THREE.Vector3(l.fixture.position.x, 0, l.fixture.position.z);
    resolveCircle(spot, 0.4, boxes);
    const mesh = new THREE.Group();
    for (let i = 0; i < 26; i++) {
      const s = new THREE.Mesh(shardGeo, glassMat);
      const a = Math.random() * Math.PI * 2;
      const d = Math.sqrt(Math.random()) * GLASS_R * 0.9;
      s.position.set(Math.cos(a) * d, 0.006, Math.sin(a) * d);
      s.rotation.set(-Math.PI / 2, 0, Math.random() * Math.PI * 2);
      s.scale.setScalar(0.5 + Math.random());
      mesh.add(s);
    }
    mesh.position.copy(spot);
    scene.add(mesh);
    glass.push({ x: spot.x, z: spot.z, r: GLASS_R, mesh });
  }

  /** True if (x, z) is on broken glass. */
  function onGlass(x, z) {
    return glass.some((g) => Math.hypot(x - g.x, z - g.z) <= g.r);
  }

  /** A light shot out with the pistol: off for the rest of the mission, glass on the floor below. */
  function breakLight(l) {
    if (l.broken) return;
    setLightOn(l, false);
    l.broken = true;
    updateLeds();
    spillGlass(l);
  }

  function reset() {
    for (const d of doors) {
      if (d.open) { boxes.push(d.box); d.open = false; d.openedBy = null; d.pivot.rotation.y = 0; }
    }
    for (const l of lights) { l.broken = false; setLightOn(l, true); }
    for (const g of glass) scene.remove(g.mesh);
    glass.length = 0;
    updateLeds();
    files.visible = true;
    for (const h of hideSpots) h.body = null;
  }

  return Object.assign(level, {
    boxes,
    navBoxes,
    doors,
    setDoor,
    lights,
    interactables,
    bottleSpot: { x: -6, y: 1.1, z: 4 }, // on the crate near the start
    playerStart: { x: -10, z: 7, yaw: -Math.PI / 3 },
    guardRoutes: [guardRoute, guardRoute2],
    navNodes,
    pipes,
    hideSpots,
    switchFor,
    setGroup,
    breakLight,
    glass,
    onGlass,
    reset,
  });
}
