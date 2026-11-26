# Low Light: Stealth Game Design Doc

Nov 26, 2026 · @moot

## Pitch and pillars

Low Light (working title) is a third-person stealth puzzle game played level by level. Each level gives you an objective, and you work out the stealthiest way to complete it. There is no story; the feel comes from classic Splinter Cell, with original characters and gear. Everything here is a starting proposal.

1. **Tension first.** The player is strong up close but fragile once seen.
2. **Readable rules.** The player can always tell why a guard noticed them.
3. **Hands over guns.** Takedowns are the main tool, and each one leaves a problem behind.
4. **Small and dense.** One tight building beats a large empty map.

## Levels and scoring

Each level is a self-contained puzzle: one objective, at least two ways in but the levels should be able to be completed however the player wants within the confines of the game, and an instant restart. Replay comes from earning a better rating.

| Rating | How you earn it |
| --- | --- |
| Ghost | Never detected, no guard touched |
| Shadow | Never reached full alert, non-lethal takedowns only |
| Cleared | Objective completed by any means |

Each new level adds one idea, such as switchable lights, noisy floors or overlapping patrols.

## Tension and detection

Tension comes from guards noticing you gradually, so there is always a moment to react. Each guard has a suspicion meter from 0 to 100. Starting numbers below are guesses to tune in playtests. Guards should "remember" things that happen like heard noises, seen players or turned off lights, and patrol those areas more often

| Input | How it works | Starting value |
| --- | --- | --- |
| Sight | View cone plus line of sight; fills faster when closer and brighter | 120° cone, 12 m range |
| Light | Sampled at head, chest and feet; shown on a player light meter | Full dark nearly invisible beyond 2 m |
| Noise | Footsteps and impacts emit a radius based on speed and surface | Crouch 1 m, walk 4 m, run 10 m |
| Evidence | Bodies, dead lights and open doors raise suspicion | A found body triggers a search, there will be places to hide bodies |
| Decay | Meter drains after the guard loses the stimulus | 10 points per second |

Player tools: switch off or shoot out lights, throw a distraction object, hide bodies. Audio carries the mood, with quiet ambience and a layer that builds as suspicion rises. NVGs. A knife and pistol.

## Hand-to-hand combat

Close combat is fast and decisive when the player has the edge, and risky when they don't. One context button picks the move from position; holding it makes the takedown lethal.

| Move | When | Result | Cost or risk |
| --- | --- | --- | --- |
| Grab and hold | Behind an unaware guard | Move him, question him, use him as cover | Slow movement; he struggles free if held too long |
| Knockout | Behind or from a grab | Quiet, guard stays down | About 3 s; he can be found and woken |
| Lethal takedown | Same, button held | Quick and permanent | More noise; raises the mission alert level |
| Drop attack | From a ledge or pipe above | Instant knockdown | Loud landing |
| Corner pull | Guard passes your cover | Pulls him out of sight | Narrow timing window |
| Face-to-face strike | Guard is suspicious but not yet alert | Stuns, then allows a finisher | A miss triggers full alert |

No combo system or health-bar brawls. If a fight lasts more than a few seconds, the player should want to escape.

## Combat animations

Start with one grab and one knockout, then add moves once those feel good. Takedowns need paired clips: an attacker and a victim animation that line up.

| Source | Cost | Fit and caveat |
| --- | --- | --- |
| [Quaternius Universal Animation Library 2](https://quaternius.com/packs/universalanimationlibrary2.html) | Free tier, CC0 | Melee combos and GLB files; paired takedowns not confirmed |
| [Mixamo](https://app.cinevva.com/guides/mixamo-to-blender-2026) | Free with Adobe ID | Large library; raw files [can't be redistributed](https://community.adobe.com/questions-696/mixamo-faq-licensing-royalties-ownership-eula-and-tos-589400) |
| [Silent Takedown Animation Pack](https://www.fab.com/listings/a882f9ec-ee79-4acb-8fda-320edb319f67?lang=en) | Check listing | 23 takedowns with reactions; stylized |
| [Stealth Kills, Motion Cast #10](https://www.fab.com/listings/a37b4ff8-c9a8-4be6-8079-bd88ffeae825?lang=en) | Check listing | 42 paired kills, 9 bare-handed; needs retargeting from the Unreal skeleton |

- [ ] Test one paired clip in Three.js before buying a pack
- [ ] Check each license for browser delivery, where players can potentially extract model files

## Guard behavior

&#91;embedded content: guard states · 4 states and their triggers\]

A guard who has searched returns to patrol warier, with a faster-filling meter for the rest of the mission.

## Prototype scope

The first build answers one question in two weekends: is sneaking up on a single guard tense and satisfying? A proposed stack is Three.js with capsule characters.

- [ ] Weekend 1: one room, third-person movement, crouch, switchable lights, light meter
- [ ] Weekend 1: one patrolling guard with sight and suspicion meter
- [ ] Weekend 2: noise, search behavior, grab and knockout
- [ ] Weekend 2: hand it to someone else and watch them play

**Pass test:** the tester waits, plans an approach and reacts out loud to a near miss. If not, fix detection before adding content.

**Out of scope for now:** gadgets beyond a throwable, guns, multiplayer, final art and body hiding.
