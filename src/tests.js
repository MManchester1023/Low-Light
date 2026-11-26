// Regression tests: open http://localhost:8080/?test to run them. Results show on the start screen and in
// window.testResults. They check that features still WORK (a guard hears a bottle, a takedown finishes),
// not how hard the game is: no test asserts tuning numbers like suspicion rates or noise radii.
// Every test starts from a fresh reset and uses the fixed-step simulation, so results are repeatable.
// Add a test here for every new feature.

const HIDE = { x: -60, z: -60 }; // far outside the level: no guard can see or hear the player here

export function runTests(game) {
  const { level, player, guard, bottle, debug: d } = game;
  const results = [];

  const hide = () => player.pos.set(HIDE.x, 0, HIDE.z);
  const place = (x, z) => { player.pos.set(x, 0, z); player.vel.set(0, 0, 0); };
  const groupOn = (g) => level.lights.some((l) => l.group === g && l.on);
  const near = (a, b, r) => Math.hypot(a.x - b.x, a.z - b.z) <= r;

  function fresh() {
    for (const k of ['KeyW', 'KeyA', 'KeyS', 'KeyD', 'KeyG', 'ShiftLeft', 'Space']) d.release(k);
    d.reset();
  }

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
    d.reset();
    const s = level.playerStart;
    check(near(player.pos, s, 0.01), `player at (${player.pos.x.toFixed(1)}, ${player.pos.z.toFixed(1)}), not the start`);
    check(game.state === 'playing', `game state ${game.state}`);
    check(level.lights.every((l) => l.on), 'a light is still off');
    check(bottle.state === 'rest' && !game.holding, 'bottle not back on the crate');
    check(guard.state === 'patrol' && guard.suspicion === 0, `guard ${guard.state} at ${guard.suspicion}`);
    check(guard.memory.length === 0, 'guard memory not cleared');
    check(!player.climb && player.pos.y === 0, 'player still on the pipe');
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

  test('Guard spots a player standing in front of him', () => {
    // He starts paused at his first waypoint facing -z.
    d.simulate(1 / 60);
    const fx = guard.pos.x - Math.sin(guard.yaw) * 2;
    const fz = guard.pos.z - Math.cos(guard.yaw) * 2;
    d.simulate(4, () => place(fx, fz));
    check(game.state === 'spotted', `not spotted (suspicion ${guard.suspicion.toFixed(0)})`);
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

  fresh();
  return results;
}
