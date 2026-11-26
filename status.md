# Low Light: status

Roadmap and priorities. Finished items move to `completed.md` with a ✔ and the version.

## Now: prototype, weekend 2

The prototype asks one question: is sneaking up on a single guard tense and satisfying?

1. Noise: footsteps emit a radius by speed (crouch 1 m, walk 4 m, run 10 m) that guards can hear.
2. Search behavior: a guard at high suspicion searches the area, then returns to patrol warier.
3. Grab and knockout: one grab and one knockout from behind an unaware guard.
4. Hand it to someone else and watch them play. Pass test: the tester waits, plans an approach and reacts
   out loud to a near miss. If not, fix detection before adding content.

## Next: after the prototype passes

5. Evidence: dead lights, open doors and found bodies raise suspicion (guards don't react to lights going off yet).
6. Test one paired takedown clip in Three.js before buying an animation pack.
7. Check each animation license for browser delivery, where players can extract model files.
8. Throwable distraction object.

## Open questions for Mat

- Guard states diagram: the embedded diagram didn't come through in the design doc. The prototype uses
  patrol → suspicious → investigate → look around → alert; confirm or send the diagram.
- Being spotted fails the level in the prototype (there's no combat or escape yet). The design's "Cleared"
  rating implies the level can continue after an alert; decide what full alert does once combat exists.
- Body hiding: the design's Evidence row mentions places to hide bodies, but it's listed as out of scope for
  the prototype. Assumed: later, not now.
