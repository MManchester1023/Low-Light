# Low Light: rules for Claude

## Project files

- `Low Light Stealth Game Design Doc.md`: the game design reference. Check it before making design decisions.
- `status.md`: the roadmap and priority list. Use it to pick "the next thing".
- `completed.md`: finished items, moved here from `status.md` with a ✔ and the version.
- `changelog.md`: one row per version for every change made during the project.
- `playtests.md`: short summaries of playtest notes, for reference and memory.
- `credits.md`: credits for models, animations and sounds.

Create these files when they're first needed. Only update the logs listed above. Don't create other log or
tracking files.


## Working with Mat

- **pass off lesser work to subagents**: have the subagent and effort model of your choice work on lesser, simple tasks while opus 5.5 handles all of the main, complex tasks.

- **No messages while working**: no progress lines, not even when the app asks for an update. Only when the
  work is done: one reply of a few short lines covering what was done (item numbers), and what Mat needs to do
  or decide. No per-item paragraphs unless he asks.
- Straightforward, honest answers; light-hearted is welcome. Say when something is a guess (most tuning
  numbers, like detection values, are until a playtest) and when you didn't check something.
- **No screenshots at all**: don't take them, not even private ones to check your own work (they cost usage).
  Check visuals with scripted browser checks and say what was checked; anything only eyes can judge, ask Mat
  to look at.
- **Mat decides difficulty and tuning from his own playtests.** Don't judge or retune difficulty (guard
  detection, suspicion rates, noise radii) from automated tests. Make the change asked for and let Mat
  playtest it. Automated checks are still fine as a quick "nothing broke" check.
- When asked for "the next thing", pick the most important thing overall from `status.md`, not every open note.
- After each piece of work:
  1. Mark the item ✔ with the version in `status.md`, then move it to `completed.md`.
  2. Add a version row to `changelog.md`.
  3. Add a row to `playtests.md` if the work closes a playtest note.
  4. Add new assets to `credits.md`.
  5. Commit and push, then send the short end-of-work reply (above).
