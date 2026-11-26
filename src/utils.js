// Small math helpers shared across modules.

export const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
export const lerp = (a, b, t) => a + (b - a) * t;

/** Wrap an angle to (-PI, PI]. */
export function wrapAngle(a) {
  a = (a + Math.PI) % (Math.PI * 2);
  if (a < 0) a += Math.PI * 2;
  return a - Math.PI;
}

/** Rotate angle `from` toward `to` by at most `maxStep` radians. */
export function turnToward(from, to, maxStep) {
  const diff = wrapAngle(to - from);
  if (Math.abs(diff) <= maxStep) return to;
  return from + Math.sign(diff) * maxStep;
}

/** Yaw that faces along (dx, dz). Forward for yaw is (-sin yaw, -cos yaw). */
export const yawFromDir = (dx, dz) => Math.atan2(-dx, -dz);
