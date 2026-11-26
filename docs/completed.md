# Low Light: completed

## Prototype, weekend 1

- ✔ v0.1: One room with third-person movement (walk, run, crouch) and a shoulder camera that avoids walls.
- ✔ v0.1: Switchable lights (two ceiling groups plus a desk lamp) and a light meter sampled at feet, chest and head.
- ✔ v0.1: One patrolling guard with a 90° / 12 m view cone, line of sight and a 0–100 suspicion meter
  (patrol → suspicious → investigate → look around → alert; warier after an investigation).
- ✔ v0.1: Objective (take the files from the desk), spotted = fail, instant restart with R.

## Playtest round 1 notes

- ✔ v0.2: Noise: footsteps carry by stance and speed (crouch 1 m, walk 4 m, run 10 m, halved through walls);
  guards hear it, turn and investigate. Sound alone can't get you spotted (caps at 75). NOISE meter on the HUD.
- ✔ v0.2: Evidence, dead lights: a guard who can see a light that's off (14 m, no wall between) walks to its
  switch and turns it back on, then looks around and stays warier.
- ✔ v0.2: Guard pathfinding through doorways, so investigating and relighting work across rooms.
- ✔ v0.2: Night vision (N): green amplified view for dark rooms; doesn't change what guards see.

## Playtest round 2 notes

- ✔ v0.3: Guards walk to noises: a footstep heard once a guard has some suspicion makes him turn and walk to
  the sound, look around, then return to patrol warier. Hearing again while looking around sends him to the new spot.
- ✔ v0.3: First hand-to-hand takedown, grab and knockout: within 1.4 m in an unaware guard's rear arc (more than
  110° off his facing), press E to grab. Drag him slowly (1.1 m/s, 2.5 m noise) facing the camera; he breaks free
  after 8 s and counts as spotted. Press E again to knock him out: 3 s struggle (1.5 m noise), then he slumps and
  stays down. Takedown prompts take priority over switches. Capsule pose animation only, no animation assets.
- ✔ v0.3: Rating, Shadow or Ghost: finishing with a guard touched gives Shadow; untouched gives Ghost.
- ✔ v0.3.1: Fix: the interact prompt overlapped the top of the LIGHT/NOISE meter at the bottom of the screen.
- ✔ v0.4: Throwable distraction object: a bottle on the crate near the start. E picks it up, hold G to aim
  (arc line and landing ring), release to throw. It smashes on the first thing it hits with an 8 m noise
  (halved through walls); a guard who hears it turns to it, walks over and looks around.
- ✔ v0.4: Guard view cone widened from 90° to 120° to match the design doc.
- ✔ v0.5: Guard memory: guards remember spots where they heard a noise, saw the player or found a dead
  light (at its switch), for the rest of the mission. Nearby events stack onto one spot. Every 20 s of patrol
  he detours to the spot most worth checking, looks around for 3.5 s, then carries on. V shows the spots.
- ✔ v0.6: Ceiling pipe: climb a riser (E), hang legs-up under the ceiling and shimmy along it (WASD), climb
  down at either end (E) or drop anywhere (C, loud landing the guard can hear). Guards don't look more than 30°
  above eye level, so a player on the pipe close above or ahead of a guard isn't seen.
- ✔ v0.6.1: Pipe climbing is manual (E grabs the riser, W/S climb up and down, C lets go). While hanging, Space
  switches between legs-up and hanging by the hands. Dropping onto a guard knocks him out (drop attack from the
  design doc). Walking and shimmying are quieter.
