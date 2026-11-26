# Low Light: status

Roadmap and priorities. Finished items move to `completed.md` with a ✔ and the version.

## Now: prototype, weekend 2

The prototype asks one question: is sneaking up on a single guard tense and satisfying?

The prototype's baseline items are done. The next pick comes from Next.

## Next: after the prototype passes

7. Check each animation license for browser delivery, where players can extract model files.
8. Knocked-out guards can be woken by the guard who finds them (finding bodies is done, v0.9).
9. Level design rule from the design doc: levels should be completable however the player wants within the
   game's rules, not just by the two planned routes. Keep this in mind when building the next level.

## Decisions

- Guard states: patrol → suspicious → investigate → look around → alert is fine (plus relight and memory
  check detours).
- Takedown: two presses, grab then knock out. Lethal (hold E) comes later.
- Body hiding is in the prototype, not later.
- Full alert is a guard hunt (done in v0.9): being seen no longer fails the level; getting shot does.
- The test level has two guards (v0.9): east room and the north half of the west room.
- Paired takedown clips: the pipeline works in Three.js (v0.11 test page, animtest.html); a pack is still to be picked and its license checked (#7).
