// Regression tests: open http://localhost:8080/?test to run them. Results show on the start screen and in
// window.testResults. They check that features still WORK (a guard hears a bottle, a takedown finishes),
// not how hard the game is: no test asserts tuning numbers like suspicion rates or noise radii.
// Every test starts from a fresh reset and uses the fixed-step simulation, so results are repeatable.
// Add a test here for every new feature.
// Most tests are about one guard, so fresh() takes the other guards out of the level; tests about several
// guards bring them back with both().

const HIDE = { x: -60, z: -60 }; // far outside the level: no guard can see or hear the player here

export function runTests(game) {
  const { level, player, guard, guards, squad, bottle, camera, debug: d } = game;
  const guard2 = guards[1];
  const door = level.doors[0];
  const results = [];

  const hide = () => player.pos.set(HIDE.x, 0, HIDE.z);
  const place = (x, z) => { player.pos.set(x, 0, z); player.vel.set(0, 0, 0); };
  const groupOn = (g) => level.lights.some((l) => l.group === g && l.on);
  const near = (a, b, r) => Math.hypot(a.x - b.x, a.z - b.z) <= r;

  function fresh() {
    for (const k of ['KeyW', 'KeyA', 'KeyS', 'KeyD', 'KeyG', 'ShiftLeft', 'Space']) d.release(k);
    d.reset();
    for (const g of guards.slice(1)) g.setActive(false);
  }
  const both = () => { for (const g of guards) g.setActive(true); };
  const yawTo = (from, to) => Math.atan2(-(to.x - from.x), -(to.z - from.z));

  function check(cond, msg) {
    if (!cond) throw new Error(msg);
  }

  function test(name, fn) {
    fresh();
    try {
      fn();
      results.push({ name, ok: true });
    } catch (e) {
      results.push({ name, ok: false, detail: e.message });
    }
  }

  /** Throw the bottle from (x, z) toward yaw; returns the impact point or null. */
  function throwFrom(x, z, yaw, pitch = -0.1) {
    bottle.pickUp();
    game.holding = 'bottle';
    place(x, z);
    game.cam.yaw = yaw;
    game.cam.pitch = pitch;
    d.hold('KeyG');
    d.simulate(0.1);
    d.release('KeyG');
    d.simulate(1 / 60); // the throw leaves from where the player stands on this step
    hide();
    d.simulate(2, hide);
    return game.impact ? game.impact.pos : null;
  }

  // ---------- Tests ----------

  test('Restart puts everything back', () => {
    // Mess things up first, then reset.
    level.setGroup('A', false);
    bottle.pickUp();
    game.holding = 'bottle';
    guard.remember({ x: 0, z: 0 }, 'sound');
    player.startClimb(level.pipes[0], 5);
    game.mag = 0;
    game.pistolDrawn = true;
    level.breakLight(level.lights[0]);
    level.setDoor(door, true, 'player');
    guard.joinHunt();
    guard.raiseAlert({ x: 0, z: 0 });
    game.health = 0.3;
    d.reset();
    const s = level.playerStart;
    check(near(player.pos, s, 0.01), `player at (${player.pos.x.toFixed(1)}, ${player.pos.z.toFixed(1)}), not the start`);
    check(game.state === 'playing', `game state ${game.state}`);
    check(level.lights.every((l) => l.on), 'a light is still off');
    check(bottle.state === 'rest' && !game.holding, 'bottle not back on the crate');
    check(guard.state === 'patrol' && guard.suspicion === 0, `guard ${guard.state} at ${guard.suspicion}`);
    check(guard.memory.length === 0, 'guard memory not cleared');
    check(!player.climb && player.pos.y === 0, 'player still on the pipe');
    check(game.mag > 0 && !game.killed && !game.pistolDrawn, 'pistol not reset');
    check(level.lights.every((l) => !l.broken), 'a shot-out light is still broken');
    check(level.glass.length === 0 && !level.onGlass(level.lights[0].pos.x, level.lights[0].pos.z), 'broken glass still on the floor');
    check(!door.open && level.boxes.includes(door.box), 'door not closed again');
    check(!squad.alerted && !squad.hunt.active, 'full alert not cleared');
    check(guards.length >= 2 && guards.every((g) => g.active && g.state === 'patrol'), 'not every guard back on patrol');
    check(game.health === 1, `health ${game.health}`);
  });

  test('Player starts inside the level and can walk', () => {
    const s = level.playerStart;
    check(Math.abs(s.x) < 12 && Math.abs(s.z) < 9, 'start is outside the walls');
    game.cam.yaw = 0;
    d.hold('KeyW');
    d.simulate(0.5);
    d.release('KeyW');
    check(player.pos.z < s.z - 0.5, 'W did not move the player forward');
  });

  test('Crouch toggles', () => {
    d.press('KeyC');
    d.simulate(0.3);
    check(player.crouched && player.stance === 'CROUCHED', 'C did not crouch');
    d.press('KeyC');
    d.simulate(0.3);
    check(!player.crouched, 'C did not stand back up');
  });

  test('Bottom HUD: prompt sits above the meter', () => {
    place(2.7, 3.5); // by switch B
    d.simulate(0.05);
    const p = document.getElementById('prompt');
    check(p.textContent.length > 0, 'no prompt by the switch');
    const a = p.getBoundingClientRect();
    const b = document.getElementById('meter').getBoundingClientRect();
    check(a.bottom <= b.top, `prompt overlaps the meter by ${(a.bottom - b.top).toFixed(0)} px`);
    check(b.bottom <= window.innerHeight, 'meter runs off the bottom of the screen');
  });

  test('Light switch turns its lights off and on', () => {
    place(2.7, 3.5);
    d.simulate(0.05);
    check(game.interact && game.interact.kind === 'switch', 'no switch in reach');
    d.press('KeyE');
    d.simulate(0.05);
    check(!groupOn('B'), 'lights B still on');
    d.press('KeyE');
    d.simulate(0.05);
    check(groupOn('B'), 'lights B did not come back on');
  });

  test('Guard relights a dead light', () => {
    hide();
    level.setGroup('B', false);
    d.simulate(45, hide);
    check(groupOn('B'), `lights B still off after 45 s (guard ${guard.state})`);
  });

  test('Guard spots a player standing in front of him: full alert, not game over', () => {
    // He starts paused at his first waypoint facing -z.
    d.simulate(1 / 60);
    const fx = guard.pos.x - Math.sin(guard.yaw) * 2;
    const fz = guard.pos.z - Math.cos(guard.yaw) * 2;
    let alertAt = -1;
    d.simulate(4, (t) => { place(fx, fz); if (alertAt < 0 && squad.hunt.active) alertAt = t; });
    check(alertAt >= 0 && squad.alerted, `no full alert (suspicion ${guard.suspicion.toFixed(0)})`);
    check(guard.state === 'hunt' && guard.icon === '!', `guard ${guard.state}`);
    check(game.state === 'playing', `game state ${game.state}: being seen should not end the level`);
    check(document.getElementById('alert').textContent.includes('ALERT'), 'no full alert banner');
  });

  test('Guard hears footsteps behind him and turns to check', () => {
    d.simulate(1 / 60);
    const bx = guard.pos.x + Math.sin(guard.yaw) * 1.5;
    const bz = guard.pos.z + Math.cos(guard.yaw) * 1.5;
    place(bx, bz);
    game.cam.yaw = guard.yaw + Math.PI; // walk away from him, staying behind
    d.hold('KeyW');
    d.simulate(0.5);
    d.release('KeyW');
    hide();
    d.simulate(0.5, hide);
    check(guard.state !== 'patrol', `guard still patrolling (suspicion ${guard.suspicion.toFixed(0)})`);
  });

  test('Grab and knockout from behind', () => {
    d.simulate(1 / 60);
    place(guard.pos.x + Math.sin(guard.yaw) * 1, guard.pos.z + Math.cos(guard.yaw) * 1);
    d.simulate(0.05);
    check(game.takedown === 'grab', `no grab prompt (takedown ${game.takedown})`);
    d.press('KeyE');
    d.simulate(0.1);
    check(guard.state === 'grabbed', `guard ${guard.state} after grab`);
    d.press('KeyE');
    d.simulate(4);
    check(guard.state === 'down', `guard ${guard.state} after knockout`);
    check(game.touched && game.state === 'playing', 'run not marked as touched, or it ended');
    check(!player.locked, 'player still locked after the knockout');
  });

  test('Taking the files completes the level (Ghost)', () => {
    place(8.6, -6.6);
    d.simulate(0.05);
    check(game.interact && game.interact.kind === 'objective', 'files not in reach');
    d.press('KeyE');
    d.simulate(0.05);
    check(game.state === 'complete', `game state ${game.state}`);
    check(document.querySelector('#overlay .msg').textContent.includes('Ghost'), 'rating is not Ghost');
  });

  test('Bottle: pick up, aim, throw, smash', () => {
    const s = level.bottleSpot;
    place(s.x, s.z + 1.1);
    d.simulate(0.05);
    check(game.interact && game.interact.kind === 'pickup', 'bottle not in reach');
    d.press('KeyE');
    d.simulate(0.05);
    check(game.holding === 'bottle' && bottle.state === 'held', 'bottle not picked up');
    d.hold('KeyG');
    d.simulate(0.1);
    check(game.aiming, 'holding G does not aim');
    d.release('KeyG');
    d.simulate(0.05);
    check(bottle.state === 'flying' && !game.holding, 'bottle not thrown');
    d.simulate(3);
    check(bottle.state === 'broken' && game.impact, 'bottle never landed');
    d.simulate(0.05);
    check(!game.interact || game.interact.kind !== 'pickup', 'broken bottle can still be picked up');
  });

  test('Guard hears a bottle smash nearby and walks to it', () => {
    const hit = throwFrom(-2, -1.5, -Math.PI / 2);
    check(hit, 'bottle never landed');
    check(game.impactHeard, 'guard did not hear the smash');
    let closest = Infinity;
    d.simulate(10, () => { hide(); closest = Math.min(closest, Math.hypot(guard.pos.x - hit.x, guard.pos.z - hit.z)); });
    check(closest <= 2.5, `guard got no closer than ${closest.toFixed(1)} m to the smash`);
  });

  test('Guard does not hear a bottle smash far away', () => {
    throwFrom(-10, 7, Math.PI / 2, 0); // into the west wall by the start
    check(game.impact, 'bottle never landed');
    check(!game.impactHeard && guard.state === 'patrol', 'guard heard a far-off smash');
  });

  // ---------- Second guard ----------
  test('Level has a second guard who patrols the west room', () => {
    both();
    check(guards.length >= 2 && guard2.active, 'no second guard');
    const start = guard2.pos.clone();
    check(start.x < 2, 'second guard does not start in the west room');
    hide();
    let moved = 0;
    d.simulate(12, () => { hide(); moved = Math.max(moved, Math.hypot(guard2.pos.x - start.x, guard2.pos.z - start.z)); });
    check(moved > 3, `second guard only moved ${moved.toFixed(1)} m`);
    check(guard2.state === 'patrol' && guard.state === 'patrol', `guards ${guard.state} / ${guard2.state}`);
    check(document.querySelectorAll('.guardTag').length >= 2, 'only one guard tag on the HUD');
  });

  test('Second guard can be shot and taken down too', () => {
    both();
    d.simulate(1 / 60);
    // grab from behind
    place(guard2.pos.x + Math.sin(guard2.yaw) * 1, guard2.pos.z + Math.cos(guard2.yaw) * 1);
    d.simulate(0.05);
    check(game.takedown === 'grab' && game.takedownGuard === guard2, `no grab prompt on guard 2 (${game.takedown})`);
    d.press('KeyE');
    d.simulate(0.1);
    d.press('KeyE');
    d.simulate(4);
    check(guard2.state === 'down' && guard.state !== 'down', `guards ${guard.state} / ${guard2.state}`);
  });

  // ---------- Full alert ----------
  test('Full alert: the guard who spots you radios the other, who joins the hunt', () => {
    both();
    d.simulate(1 / 60);
    const fx = guard.pos.x - Math.sin(guard.yaw) * 2;
    const fz = guard.pos.z - Math.cos(guard.yaw) * 2;
    d.simulate(4, () => place(fx, fz));
    check(guard.state === 'hunt' && guard2.state === 'hunt', `guards ${guard.state} / ${guard2.state}`);
    check(near(squad.hunt.pos, { x: fx, z: fz }, 1), 'shared position is not where the player was seen');
  });

  test('Full alert: a guard shoots a player in plain sight; enough hits kill him', () => {
    d.simulate(1 / 60);
    const fx = guard.pos.x - Math.sin(guard.yaw) * 2;
    const fz = guard.pos.z - Math.cos(guard.yaw) * 2;
    place(fx, fz);
    guard.joinHunt(); // straight to the full alert: this test is about the shooting
    guard.raiseAlert(player.pos);
    let hurt = false;
    d.simulate(20, () => { if (game.state === 'playing') place(fx, fz); if (game.health < 1) hurt = true; });
    check(game.guardShots.length > 0, 'guard never fired');
    check(hurt, 'no shot ever hit');
    check(game.state === 'killed', `game state ${game.state}, health ${game.health.toFixed(2)}`);
    check(document.querySelector('#overlay h1').textContent === 'Killed', 'no Killed screen');
    d.press('KeyR');
    d.simulate(1 / 60);
    check(game.state === 'playing' && game.health === 1, 'R did not restart after being killed');
  });

  test('Full alert: hunters run to the last known position', () => {
    both();
    hide();
    const spot = { x: -3, z: 6.5 };
    guard.joinHunt();
    guard.raiseAlert(spot);
    let c1 = Infinity;
    let c2 = Infinity;
    d.simulate(15, () => {
      hide();
      c1 = Math.min(c1, Math.hypot(guard.pos.x - spot.x, guard.pos.z - spot.z));
      c2 = Math.min(c2, Math.hypot(guard2.pos.x - spot.x, guard2.pos.z - spot.z));
    });
    check(c1 <= 1.5 && c2 <= 1.5, `closest ${c1.toFixed(1)} m / ${c2.toFixed(1)} m`);
  });

  test('Full alert ends if nobody finds the player; rating is Cleared', () => {
    hide();
    guard.joinHunt();
    guard.raiseAlert({ x: 6, z: 3 });
    let ended = -1;
    d.simulate(90, (t) => { hide(); if (ended < 0 && !squad.hunt.active) ended = t; });
    check(ended > 0, 'alert never ended');
    check(guard.state !== 'hunt', `guard still ${guard.state}`);
    check(guard.memory.some((m) => near(m.pos, { x: 6, z: 3 }, 3)), 'he does not remember where the player was');
    check(document.getElementById('alert').textContent === '', 'alert banner still up');
    place(8.6, -6.6);
    d.simulate(0.05, () => place(8.6, -6.6));
    d.press('KeyE');
    d.simulate(0.05);
    check(game.state === 'complete', `game state ${game.state}`);
    check(document.querySelector('#overlay .msg').textContent.includes('Cleared'), 'rating is not Cleared after a full alert');
  });

  test('Full alert: a grabbed guard breaking free raises it', () => {
    d.simulate(1 / 60);
    place(guard.pos.x + Math.sin(guard.yaw) * 1, guard.pos.z + Math.cos(guard.yaw) * 1);
    d.simulate(0.05);
    d.press('KeyE');
    d.simulate(10);
    check(game.brokeFree && squad.hunt.active && guard.state === 'hunt', `guard ${guard.state}, alert ${squad.hunt.active}`);
    check(!player.grabbing && game.state === 'playing', 'player still grabbing, or the level ended');
  });

  // ---------- Doors ----------
  test('Door: E opens and closes it; closed, it blocks the way and sight', () => {
    hide();
    place(1.3, 7);
    d.simulate(0.05, () => place(1.3, 7));
    check(game.interact && game.interact.kind === 'door', `no door prompt (${game.interact && game.interact.kind})`);
    d.press('KeyE');
    d.simulate(0.05, () => place(1.3, 7));
    check(door.open && door.openedBy === 'player' && !level.boxes.includes(door.box), 'door did not open');
    d.press('KeyE');
    d.simulate(0.05, () => place(1.3, 7));
    check(!door.open && level.boxes.includes(door.box), 'door did not close');
    place(1.3, 7);
    game.cam.yaw = -Math.PI / 2; // facing +x, through the door
    d.hold('KeyW');
    d.simulate(1);
    d.release('KeyW');
    check(player.pos.x < 2, 'walked through a closed door');
    guard.pos.set(3.3, 0, 7);
    guard.yaw = Math.PI / 2; // facing -x, at the door
    check(!guard.canSee(new (player.pos.constructor)(0.5, 1.1, 7), level.boxes), 'guard sees through a closed door');
    level.setDoor(door, true, 'player');
    check(guard.canSee(new (player.pos.constructor)(0.5, 1.1, 7), level.boxes), 'guard cannot see through the open door');
  });

  test('Door: it will not close on someone standing in it', () => {
    hide();
    level.setDoor(door, true, 'player');
    place(2, 7);
    check(!level.setDoor(door, false) && door.open, 'door closed on the player');
    hide();
    check(level.setDoor(door, false) && !door.open, 'door would not close with the doorway clear');
  });

  test('Guard opens a closed door on his way and shuts it behind him', () => {
    hide();
    guard.pos.set(3.3, 0, 4.5);
    const spot = { pos: new (player.pos.constructor)(-3, 0, 7), weight: 1, lastChecked: 0 };
    guard.checkSpot = spot;
    guard.setState('check');
    let opened = false;
    let shut = false;
    d.simulate(12, () => {
      hide();
      if (door.open && door.openedBy === 'guard') opened = true;
      if (opened && !door.open && guard.pos.x < 1) shut = true;
    });
    check(opened, `guard never opened the door (at ${guard.pos.x.toFixed(1)}, ${guard.pos.z.toFixed(1)})`);
    check(shut, 'guard did not shut the door behind him');
    check(guard.suspicion < 25, 'guard got suspicious of a door he opened himself');
  });

  test('Evidence: a guard notices a door left open and goes to shut it', () => {
    hide();
    level.setDoor(door, true, 'player');
    guard.pos.set(5, 0, 2.5);
    guard.yaw = yawTo(guard.pos, door.center);
    guard.route = [{ x: 5, z: 2.5, pause: 99, lookYaw: guard.yaw }];
    guard.wp = 0;
    guard.pauseTimer = 99;
    let reacted = false;
    try {
      d.simulate(15, () => {
        hide();
        if (guard.state === 'suspicious' || guard.state === 'investigate') reacted = true;
      });
    } finally {
      guard.route = level.guardRoutes[0];
    }
    check(reacted, `guard did not react to the open door (${guard.state}, suspicion ${guard.suspicion.toFixed(0)})`);
    check(!door.open, 'guard left the door open');
  });

  test('Evidence: a guard finds a knocked-out guard and goes to the body', () => {
    both();
    d.simulate(1 / 60, hide); // guard 1 paused at his first waypoint, facing the north wall
    hide();
    guard2.pos.set(guard.pos.x - Math.sin(guard.yaw) * 2, 0, guard.pos.z - Math.cos(guard.yaw) * 2);
    guard2.dropKnockOut();
    let reacted = false;
    d.simulate(4, () => { hide(); if (guard.state === 'suspicious' || guard.state === 'investigate') reacted = true; });
    check(guard.knownBodies.has(guard2), 'body not noticed');
    check(reacted, `guard did not react (${guard.state})`);
    check(!squad.hunt.active, 'a body alone raised the full alert');
  });

  test('Evidence: a body in the dark is not seen from far off', () => {
    both();
    hide();
    for (const g of ['A', 'B', 'lamp']) level.setGroup(g, false);
    guard.pos.set(6, 0, 6);
    guard.yaw = 0; // facing north up the east room
    guard2.pos.set(6, 0, -1);
    guard2.dropKnockOut();
    d.simulate(1, () => { guard2.pos.set(6, 0, -1); });
    guard.knownBodies.clear();
    guard.pos.set(6, 0, 6);
    guard.yaw = 0;
    guard.checkBodies(level);
    check(!guard.knownBodies.has(guard2), 'saw a body 7 m away in the dark');
    for (const g of ['A', 'B', 'lamp']) level.setGroup(g, true);
    guard.checkBodies(level);
    check(guard.knownBodies.has(guard2), 'did not see the same body with the lights on');
  });

  test('Guard memory: he goes back to check a spot later', () => {
    const hit = throwFrom(-2, -1.5, -Math.PI / 2);
    check(guard.memory.length > 0, 'nothing remembered after investigating');
    let checked = false;
    d.simulate(60, () => { hide(); if (guard.state === 'check') checked = true; });
    check(checked, 'no check detour within 60 s');
    check(near(guard.memory[0].pos, hit, 3), 'remembered spot is not where the bottle smashed');
    check(game.state === 'playing', `game state ${game.state}`);
  });

  // ---------- Pipe ----------
  const pipe = level.pipes[0];
  /** Hang from the pipe at distance s along it (skips the climb). */
  function hangAt(s) {
    player.startClimb(pipe, s);
    player.climb.mode = 'hang';
    d.simulate(1 / 60);
  }
  const alongPipe = () => { const v = pipe.dirAt(player.climb.s); game.cam.yaw = Math.atan2(-v.x, -v.z); };

  test('Pipe: climb up, shimmy the whole way, climb down the far end', () => {
    guard.setState('down'); // out of the way: this test is about movement
    const [a, b] = pipe.mounts();
    place(a.pos.x, a.pos.z);
    d.simulate(0.05);
    check(game.interact && game.interact.kind === 'pipe', 'no climb prompt at the riser');
    d.press('KeyE');
    d.simulate(1);
    check(player.climb && player.climb.mode === 'riser' && player.pos.y === 0, 'climbed without pressing W');
    d.hold('KeyW');
    d.simulate(2);
    check(player.hanging, `not hanging after holding W (stance ${player.stance})`);
    check(player.viewHeight > 3, 'camera did not go up with the player');
    d.hold('KeyW');
    d.simulate(40, () => { if (player.climb) alongPipe(); });
    d.release('KeyW');
    check(player.atPipeEnd && near(player.pos, b.pos, 0.1), `stuck at s=${player.climb && player.climb.s.toFixed(1)} of ${pipe.length.toFixed(1)}`);
    d.simulate(0.05);
    check(game.interact && game.interact.kind === 'pipeDown', 'no climb-down prompt at the far end');
    d.press('KeyE');
    d.simulate(0.5);
    check(player.climb && player.climb.mode === 'riser' && player.pos.y > 1, 'did not swing onto the riser');
    d.hold('KeyS');
    d.simulate(3, () => { if (!player.climb) d.release('KeyS'); });
    d.release('KeyS');
    check(!player.climb && player.pos.y === 0, `not back on the floor (stance ${player.stance})`);
    check(near(player.pos, b.pos, 0.5), 'climbed down somewhere other than the far riser');
  });

  test('Guard does not see a player hanging above and ahead of him', () => {
    d.simulate(1 / 60); // he starts paused at his first waypoint facing the north wall
    hangAt(23.5);       // on the pipe along that wall, about 2.5 m in front of him
    check(player.hanging, 'not hanging');
    let seen = 0;
    d.simulate(1.5, () => { seen = Math.max(seen, guard.visibility); });
    check(seen === 0, `guard saw the player on the pipe (visibility ${seen.toFixed(2)})`);
    check(game.state === 'playing', `game state ${game.state}`);
  });

  test('Dropping from the pipe lands with a noise the guard hears', () => {
    d.simulate(1 / 60);
    hangAt(23.5);
    d.press('KeyC');
    d.simulate(1.5);
    check(!player.climb && player.pos.y === 0, `still in the air (stance ${player.stance})`);
    check(game.impact && game.dropHeard, 'guard did not hear the landing');
    check(guard.state !== 'patrol', `guard still patrolling (${guard.state})`);
  });

  test('Space switches between legs-up and hanging by the hands', () => {
    hangAt(8);
    const lowest = () => Math.min(...player.samplePoints().map((p) => p.y));
    const tuckedLow = lowest();
    d.press('Space');
    d.simulate(0.05);
    check(player.hanging && player.climb.style === 'hands', `style ${player.climb && player.climb.style}`);
    check(lowest() < tuckedLow, 'hanging by the hands does not hang lower than legs-up');
    const s0 = player.climb.s;
    alongPipe();
    d.hold('KeyW');
    d.simulate(0.5);
    d.release('KeyW');
    check(player.climb.s > s0 + 0.2, 'cannot shimmy while hanging by the hands');
    d.press('Space');
    d.simulate(0.05);
    check(player.tucked, 'Space did not go back to legs-up');
  });

  test('Dropping onto a guard knocks him out', () => {
    d.simulate(1 / 60);
    hangAt(23.5);
    guard.pos.set(player.pos.x, 0, player.pos.z); // right underneath
    d.press('KeyC');
    d.simulate(1.5);
    check(game.dropKO && guard.state === 'down', `guard ${guard.state} after the drop`);
    check(game.touched && game.state === 'playing', 'run not marked as touched, or it ended');
  });

  test('No takedowns or switches from the pipe', () => {
    hangAt(8); // mid-pipe, away from both ends
    d.simulate(0.05);
    check(!game.takedown && !game.interact, `got ${game.takedown || (game.interact && game.interact.kind)} while hanging`);
    check(document.getElementById('prompt').textContent.includes('C: drop'), 'no drop prompt while hanging');
  });

  // ---------- Pistol ----------
  /** Draw the pistol (1) and turn the camera until the crosshair sits on target (x, y, z). */
  function aimAt(x, y, z, drive) {
    if (!game.pistolDrawn) { d.press('Digit1'); d.simulate(1 / 60, drive); }
    for (let i = 0; i < 12; i++) {
      const c = camera.position;
      game.cam.yaw = Math.atan2(-(x - c.x), -(z - c.z));
      game.cam.pitch = Math.atan2(y - c.y, Math.hypot(x - c.x, z - c.z));
      d.simulate(1 / 60, drive);
    }
  }
  function fire(drive) {
    d.press('Mouse0');
    d.simulate(1 / 60, drive);
  }

  test('Pistol: shoot the guard, rating drops to Cleared', () => {
    d.simulate(1 / 60); // paused at his first waypoint, facing the north wall
    const stay = () => place(guard.pos.x, guard.pos.z + 4); // behind him
    stay();
    aimAt(guard.pos.x, 1.2, guard.pos.z, stay);
    check(game.pistolAim && document.getElementById('crosshair').classList.contains('on'), '1 does not draw the pistol (no crosshair)');
    const ammo = game.mag;
    fire(stay);
    check(game.lastShot && game.lastShot.kind === 'guard', `shot hit ${game.lastShot && game.lastShot.kind}`);
    check(guard.state === 'dead' && game.mag === ammo - 1, `guard ${guard.state}, ammo ${game.mag}`);
    d.press('Digit1');
    d.simulate(1 / 60, stay);
    check(!game.pistolDrawn && !game.pistolAim, '1 does not holster the pistol');
    d.simulate(2, stay);
    check(guard.state === 'dead' && !guard.seeing, 'dead guard got back up or can still see');
    place(8.6, -6.6);
    d.simulate(0.05);
    d.press('KeyE');
    d.simulate(0.05);
    check(game.state === 'complete', `game state ${game.state}`);
    check(document.querySelector('#overlay .msg').textContent.includes('Cleared'), 'rating is not Cleared');
  });

  test('Pistol: shoot out a light, its switch cannot bring it back', () => {
    hide();
    const L = level.lights.find((l) => l.id === 'A1');
    const stay = () => place(-9, 6);
    stay();
    aimAt(L.fixture.position.x, L.fixture.position.y, L.fixture.position.z, stay);
    fire(stay);
    check(game.lastShot && game.lastShot.kind === 'light', `shot hit ${game.lastShot && game.lastShot.kind}`);
    check(L.broken && !L.on, 'light still working');
    level.setGroup('A', true);
    check(!L.on && groupOn('A'), 'switch relit a shot-out light (or the rest of its group is off)');
    check(level.onGlass(L.pos.x, L.pos.z), 'no broken glass under the light');
  });

  test('Pistol: a shot hitting the wall near the guard draws him', () => {
    d.simulate(1 / 60);
    const stay = () => place(9, -2);
    stay();
    aimAt(6, 1.5, -9, stay); // north wall, about 3 m in front of him
    fire(stay);
    check(game.lastShot && game.lastShot.kind === 'wall', `shot hit ${game.lastShot && game.lastShot.kind}`);
    check(game.lastShot.heard && guard.state !== 'patrol', `guard ${guard.state}, heard ${game.lastShot.heard}`);
  });

  test('Pistol: no shots when out of ammo', () => {
    hide();
    game.mag = 0;
    aimAt(0, 1, -9, hide);
    fire(hide);
    check(!game.lastShot && game.mag === 0, 'fired with an empty magazine');
  });

  test('Pistol: R reloads from the spare rounds, no firing mid-reload', () => {
    hide();
    aimAt(0, 1, -9, hide);
    fire(hide);
    const mag = game.mag;
    const reserve = game.reserve;
    d.press('KeyR');
    d.simulate(0.1, hide);
    check(game.reloading > 0, 'R did not start a reload');
    game.lastShot = null;
    fire(hide);
    check(!game.lastShot, 'fired while reloading');
    d.simulate(3, hide);
    check(game.reloading === 0 && game.mag === mag + 1 && game.reserve === reserve - 1, `mag ${game.mag}, spare ${game.reserve}`);
    check(game.state === 'playing', 'R restarted or ended the game instead of reloading');
  });

  test('Broken glass makes footsteps louder', () => {
    hide();
    const L = level.lights.find((l) => l.id === 'A1');
    level.breakLight(L);
    const g = level.glass[0];
    const walk = (x, z) => {
      place(x, z);
      game.cam.yaw = 0;
      d.hold('KeyW');
      d.simulate(0.3, () => { player.pos.z = z; }); // walking on the spot
      d.release('KeyW');
      return game.noise.radius;
    };
    const onGlass = walk(g.x, g.z);
    check(game.onGlass, 'not standing on the glass');
    const offGlass = walk(g.x + 3, g.z);
    check(onGlass > offGlass && offGlass > 0, `glass ${onGlass.toFixed(1)} m vs floor ${offGlass.toFixed(1)} m`);
  });

  test('Guard notices a shot-out light and goes to look', () => {
    hide();
    d.simulate(1 / 60, hide);
    level.breakLight(level.lights.find((l) => l.id === 'B1')); // over the east room, in his sight
    let reacted = false;
    let relit = false;
    d.simulate(6, () => {
      hide();
      if (guard.state === 'suspicious' || guard.state === 'investigate') reacted = true;
      if (guard.state === 'relight') relit = true;
    });
    check(reacted, `guard did not react (state ${guard.state}, suspicion ${guard.suspicion.toFixed(0)})`);
    check(!relit, 'guard tried to switch a shot-out light back on');
  });

  // ---------- Pause menu ----------
  test('Pause menu: restart, settings list the key bindings', () => {
    const input = game.input;
    const resume = input.resume;
    input.resume = () => {}; // no pointer lock or live play during tests
    try {
      const menu = game.menu.el;
      place(5, 5);
      game.menu.open();
      check(!menu.classList.contains('hidden'), 'menu not shown');
      const btn = (act) => menu.querySelector(`[data-act=${act}]`);
      check(btn('resume') && btn('restart') && btn('settings'), 'missing a menu button');
      btn('settings').click();
      const rows = menu.querySelectorAll('.binds li');
      check(rows.length >= 15, `only ${rows.length} bindings listed`);
      check([...rows].some((r) => r.textContent.includes('Reload') && r.textContent.includes('R')), 'reload binding not listed');
      btn('back').click();
      btn('restart').click();
      check(menu.classList.contains('hidden'), 'menu still open after restart');
      check(near(player.pos, level.playerStart, 0.01) && game.state === 'playing', 'restart did not reset the level');
      check(!document.getElementById('help'), 'key help text still at the top of the screen');
    } finally {
      input.resume = resume;
      game.menu.close();
    }
  });

  test('Mouse look: moving the mouse turns the camera with no button held', () => {
    const input = game.input;
    const move = (dx, clientX) => window.dispatchEvent(new MouseEvent('mousemove', { movementX: dx, movementY: 0, clientX, clientY: 300 }));
    try {
      input._setActive(true); // playing, without pointer lock (tests can't get one)
      check(document.body.classList.contains('playing'), 'cursor not hidden while playing');
      move(40, window.innerWidth / 2);
      check(input.mouseDX === 40, `mouse movement not picked up without a click (dx ${input.mouseDX})`);
      input.endFrame();
      move(0, 2);
      check(input.edgeX === -1, 'cursor at the left edge does not keep turning');
      move(0, window.innerWidth - 2);
      check(input.edgeX === 1, 'cursor at the right edge does not keep turning');
      move(0, window.innerWidth / 2);
      check(input.edgeX === 0, 'still turning away from the edge');
    } finally {
      input._setActive(false);
      input.endFrame();
      game.menu.close();
    }
    check(!document.body.classList.contains('playing') && input.edgeX === 0, 'pausing did not reset mouse look');
  });

  test('Rebinding a key in settings moves the action to the new key', () => {
    const input = game.input;
    const key = (type, code) => window.dispatchEvent(new KeyboardEvent(type, { code }));
    try {
      game.menu.open();
      game.menu.el.querySelector('[data-act=settings]').click();
      game.menu.el.querySelector('.key[data-action=forward]').click();
      key('keydown', 'KeyI');
      key('keyup', 'KeyI');
      check(input.bindings.forward === 'KeyI', `forward bound to ${input.bindings.forward}`);
      check(game.menu.el.querySelector('.key[data-action=forward]').textContent === 'I', 'button does not show the new key');
      key('keydown', 'KeyI');
      check(input.down('KeyW'), 'the new key does not move forward');
      key('keyup', 'KeyI');
      key('keydown', 'KeyW');
      check(!input.down('KeyW'), 'the old key still moves forward');
      key('keyup', 'KeyW');
      input.setBinding('forward', 'KeyS'); // taken by back: they swap
      check(input.bindings.back === 'KeyI', `back not swapped (${input.bindings.back})`);
    } finally {
      input.resetBindings();
      game.menu.close();
    }
    check(input.bindings.forward === 'KeyW' && input.bindings.back === 'KeyS', 'defaults not restored');
  });

  fresh();
  return results;
}
