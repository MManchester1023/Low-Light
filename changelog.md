# Low Light: changelog

| Version | Date | Changes |
| --- | --- | --- |
| v0.1 | 2026-11-26 | Weekend 1 prototype: Three.js room with crates and a divider wall, third-person player with crouch and run, switchable light groups and desk lamp, light meter, patrolling guard with view cone, suspicion meter and investigate/look states, objective, spotted/complete screens, R restart, V shows guard view cone. Local server via `node serve.js`. |
| v0.1.1 | 2026-11-26 | Fix: "Click to play" did nothing when the browser refused mouse lock. Clicking now always starts play; without a lock you look by dragging the mouse or with the arrow keys. Esc or P pauses. The page now explains if the game fails to load (opened as a file, or Three.js couldn't download). |
| v0.2 | 2026-11-26 | Player footstep noise (crouch 1 m / walk 4 m / run 10 m, halved through walls) with a NOISE meter; guards hear and investigate sounds (sound caps suspicion at 75). Guards notice dead lights and walk over to switch them back on. Guard nav graph so they path through doorways. Night vision toggle (N) as a full-screen shader. V now also shows the noise ring. |
| v0.2.1 | 2026-11-26 | Night vision much brighter in dark rooms: log amplification curve instead of a flat gain (the dark room rendered ~200x dimmer than lit areas, so the old gain barely lifted it). |
