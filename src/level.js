import * as THREE from 'three';

// Builds the single-room level: geometry, lights, switches, objective, guard route.
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
  // Divider at x=2 with gaps at z -3..0 and z 5..9
  box(2, -6, 0.3, 4, 6, wallMat);
  box(2, 2.5, 0.3, 4, 5, wallMat);

  // ---------- Cover ----------
  box(-6, 4, 1.2, 1.1, 1.2, crateMat);
  box(-4, -5, 2, 1.1, 1, crateMat);
  box(-8, -2, 1.2, 1.1, 1.2, crateMat);
  box(7, 1, 1.5, 1.1, 1.5, crateMat);
  box(11.3, -5, 1.2, 1.1, 1.2, crateMat);
  box(-1, 4, 0.8, 4, 0.8, wallMat); // pillar
  box(4.5, 7, 1, 2.2, 3, shelfMat); // shelf
  box(9, -7.4, 2.2, 0.8, 1, deskMat); // desk

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

  // ---------- Guard route ----------
  const guardRoute = [
    { x: 6, z: -6, pause: 2, lookYaw: 0 },
    { x: 4, z: -1.5 },
    { x: -3, z: -1.5, pause: 2.5, lookYaw: Math.PI / 2 },
    { x: 4, z: -1.5 },
    { x: 6, z: 6, pause: 1.5, lookYaw: Math.PI },
    { x: 10, z: 6 },
    { x: 10, z: -2, pause: 2, lookYaw: Math.PI / 2 },
  ];

  // ---------- Guard nav nodes (doorways and open floor spots, all clear of furniture) ----------
  const navNodes = [
    [2, -1.5], [0.5, -1.5], [3.5, -1.5],            // middle doorway
    [2, 7], [0.5, 7], [3, 4.7],                      // south doorway
    [-3, -1.5], [-9, 0.5], [-10, 5], [-3, 6.5], [-7, -7], [-1, -7], [-10, -5],  // west room
    [6, -6], [10, -2], [10, 6], [6, 6], [8.5, -4], [11, 2], [5, 3],            // east room
  ].map(([x, z]) => new THREE.Vector3(x, 0, z));

  const switchFor = (group) => interactables.find((i) => i.kind === 'switch' && i.group === group);

  function reset() {
    for (const l of lights) setLightOn(l, true);
    updateLeds();
    files.visible = true;
  }

  return {
    boxes,
    lights,
    interactables,
    bottleSpot: { x: -6, y: 1.1, z: 4 }, // on the crate near the start
    playerStart: { x: -10, z: 7, yaw: -Math.PI / 3 },
    guardRoute,
    navNodes,
    switchFor,
    setGroup,
    reset,
  };
}
