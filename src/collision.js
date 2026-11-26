// Axis-aligned box collision and line-of-sight.
// Boxes are {min:{x,y,z}, max:{x,y,z}}.

const AXES = ['x', 'y', 'z'];

/** Entry fraction (0..1) of segment a→b into box, or Infinity if it misses. */
function segmentBoxT(a, b, box) {
  let tmin = 0;
  let tmax = 1;
  for (const k of AXES) {
    const d = b[k] - a[k];
    if (Math.abs(d) < 1e-9) {
      if (a[k] < box.min[k] || a[k] > box.max[k]) return Infinity;
    } else {
      let t1 = (box.min[k] - a[k]) / d;
      let t2 = (box.max[k] - a[k]) / d;
      if (t1 > t2) [t1, t2] = [t2, t1];
      if (t1 > tmin) tmin = t1;
      if (t2 < tmax) tmax = t2;
      if (tmin > tmax) return Infinity;
    }
  }
  return tmin;
}

/** True if anything solid lies between a and b. */
export function segmentBlocked(a, b, boxes) {
  for (const box of boxes) if (segmentBoxT(a, b, box) !== Infinity) return true;
  return false;
}

/** Fraction along a→b of the first hit (1 if clear). */
export function segmentFirstHit(a, b, boxes) {
  let best = 1;
  for (const box of boxes) {
    const t = segmentBoxT(a, b, box);
    if (t < best) best = t;
  }
  return best;
}

/** Push a circle (on the XZ plane) out of every box. Mutates pos. */
export function resolveCircle(pos, r, boxes) {
  for (let pass = 0; pass < 2; pass++) {
    for (const b of boxes) {
      if (b.max.y < 0.3) continue; // too low to block
      const cx = Math.min(b.max.x, Math.max(b.min.x, pos.x));
      const cz = Math.min(b.max.z, Math.max(b.min.z, pos.z));
      const dx = pos.x - cx;
      const dz = pos.z - cz;
      const d2 = dx * dx + dz * dz;
      if (d2 >= r * r) continue;
      if (d2 > 1e-10) {
        const d = Math.sqrt(d2);
        pos.x += (dx / d) * (r - d);
        pos.z += (dz / d) * (r - d);
      } else {
        // Centre is inside the box: leave along the shallowest side.
        const opts = [
          [b.min.x - r - pos.x, 0],
          [b.max.x + r - pos.x, 0],
          [0, b.min.z - r - pos.z],
          [0, b.max.z + r - pos.z],
        ];
        opts.sort((p, q) => Math.abs(p[0] + p[1]) - Math.abs(q[0] + q[1]));
        pos.x += opts[0][0];
        pos.z += opts[0][1];
      }
    }
  }
}
