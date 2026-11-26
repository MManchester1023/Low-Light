# Low Light: status

Roadmap and priorities. Finished items move to `completed.md` with a ✔ and the version.

## Now: prototype, weekend 2

The prototype asks one question: is sneaking up on a single guard tense and satisfying?

1. Search behavior: a guard at high suspicion searches the area, then returns to patrol warier.
2. Body hiding: carry a knocked-out guard and leave him in a hiding spot (dark corner, behind cover, a
   cupboard). Part of the prototype baseline (Mat, 2026-11-26). A found body triggers a search once
   evidence is in (item 5).
3. Hand it to someone else and watch them play. Pass test: the tester waits, plans an approach and reacts
   out loud to a near miss. If not, fix detection before adding content.

## Next: after the prototype passes

4. Full alert: instead of failing the level, guards share what they know with each other and hunt the
   player down to kill. Needs more than one guard and some combat or escape.
5. Evidence: open doors and found bodies raise suspicion (dead lights are done).
6. Test one paired takedown clip in Three.js before buying an animation pack.
7. Check each animation license for browser delivery, where players can extract model files.
8. Knocked-out guards can be found and woken (needs a second guard).
9. Level design rule from the design doc: levels should be completable however the player wants within the
   game's rules, not just by the two planned routes. Keep this in mind when building the next level.

## Decisions

- Guard states: patrol → suspicious → investigate → look around → alert is fine (plus relight and memory
  check detours).
- Takedown: two presses, grab then knock out. Lethal (hold E) comes later.
- Body hiding is in the prototype, not later.
- Full alert becomes a guard hunt (item 4); until then, being spotted fails the level.
