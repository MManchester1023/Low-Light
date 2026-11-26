// Guard pathfinding: a small visibility graph over hand-placed nav nodes (doorways, room spots).
// Walk straight if the way is clear, otherwise take the shortest chain of clear hops between nodes.

import * as THREE from 'three';
import { segmentBlocked } from './collision.js';

const PROBE_Y = 1.0;  // height of the clearance test (above crates? no: crates are 1.1 high)
const HALF_WIDTH = 0.3; // side probes, a bit under the guard's radius

/** True if a body ~0.6 m wide can walk straight from a to b. */
export function walkable(a, b, boxes) {
  const dx = b.x - a.x;
  const dz = b.z - a.z;
  const len = Math.hypot(dx, dz);
  if (len < 1e-6) return true;
  const px = (-dz / len) * HALF_WIDTH;
  const pz = (dx / len) * HALF_WIDTH;
  for (const s of [0, 1, -1]) {
    const p = new THREE.Vector3(a.x + px * s, PROBE_Y, a.z + pz * s);
    const q = new THREE.Vector3(b.x + px * s, PROBE_Y, b.z + pz * s);
    if (segmentBlocked(p, q, boxes)) return false;
  }
  return true;
}

/** Points to walk through from `from` to `to` (excluding `from`, ending at `to`). */
export function findPath(from, to, nodes, boxes) {
  if (walkable(from, to, boxes)) return [to.clone ? to.clone() : new THREE.Vector3(to.x, 0, to.z)];

  // Dijkstra over [from, ...nodes, to].
  const pts = [from, ...nodes, to];
  const n = pts.length;
  const goal = n - 1;
  const dist = new Array(n).fill(Infinity);
  const prev = new Array(n).fill(-1);
  const done = new Array(n).fill(false);
  dist[0] = 0;
  for (;;) {
    let u = -1;
    for (let i = 0; i < n; i++) if (!done[i] && (u < 0 || dist[i] < dist[u])) u = i;
    if (u < 0 || dist[u] === Infinity) break;
    if (u === goal) break;
    done[u] = true;
    for (let v = 1; v < n; v++) {
      if (done[v] || v === u) continue;
      const d = Math.hypot(pts[v].x - pts[u].x, pts[v].z - pts[u].z);
      if (dist[u] + d >= dist[v]) continue;
      if (!walkable(pts[u], pts[v], boxes)) continue;
      dist[v] = dist[u] + d;
      prev[v] = u;
    }
  }
  if (prev[goal] < 0) return [new THREE.Vector3(to.x, 0, to.z)]; // no route found: head straight there
  const path = [];
  for (let i = goal; i > 0; i = prev[i]) path.unshift(new THREE.Vector3(pts[i].x, 0, pts[i].z));
  return path;
}
