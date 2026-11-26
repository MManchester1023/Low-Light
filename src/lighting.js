// How lit a point is, 0 (dark) to 1 (fully lit). Drives the light meter and guard sight.
// Each light that is on adds a falloff term if nothing solid sits between it and the point.
// Falloff numbers are starting guesses; tune from playtests.

import { clamp } from './utils.js';
import { segmentBlocked } from './collision.js';

export function lightAt(p, level) {
  let sum = 0;
  for (const L of level.lights) {
    if (!L.on) continue;
    const d = p.distanceTo(L.pos);
    if (d >= L.range) continue;
    const f = Math.pow(clamp(1 - (d - L.near) / (L.range - L.near), 0, 1), 1.5) * L.strength;
    if (f < 0.005) continue;
    if (segmentBlocked(L.pos, p, level.boxes)) continue;
    sum += f;
  }
  return Math.min(1, sum);
}
