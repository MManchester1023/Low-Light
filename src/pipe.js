// Ceiling pipe: climb a riser at either end, shimmy along under the ceiling, climb down or drop.
// The pipe is a polyline at PIPE_Y with a vertical riser at each end. Distances along it are `s` (m).

import * as THREE from 'three';

export const PIPE_Y = 3.7;     // m: just under the 4 m ceiling
export const END_PAD = 0.45;   // m: where you hang / climb, measured in from each end
const CORNER = 0.6;            // m either side of a bend where shimmying follows the bend, not one leg
const RADIUS = 0.06;

export class Pipe {
  /** points: [[x, z], ...] along the ceiling; risers stand at the first and last point. */
  constructor(scene, points) {
    this.pts = points.map(([x, z]) => new THREE.Vector3(x, PIPE_Y, z));
    this.lens = [];
    this.length = 0;
    for (let i = 1; i < this.pts.length; i++) {
      const l = this.pts[i].distanceTo(this.pts[i - 1]);
      this.lens.push(l);
      this.length += l;
    }

    const mat = new THREE.MeshStandardMaterial({ color: 0x6a7078, roughness: 0.45, metalness: 0.6 });
    const add = (geo, pos, quat) => {
      const m = new THREE.Mesh(geo, mat);
      m.position.copy(pos);
      if (quat) m.quaternion.copy(quat);
      m.castShadow = true;
      scene.add(m);
    };
    const up = new THREE.Vector3(0, 1, 0);
    for (let i = 1; i < this.pts.length; i++) {
      const a = this.pts[i - 1];
      const b = this.pts[i];
      const dir = b.clone().sub(a).normalize();
      add(new THREE.CylinderGeometry(RADIUS, RADIUS, this.lens[i - 1], 10),
        a.clone().add(b).multiplyScalar(0.5), new THREE.Quaternion().setFromUnitVectors(up, dir));
    }
    for (const p of this.pts) add(new THREE.SphereGeometry(RADIUS * 1.3, 10, 8), p); // elbows
    for (const p of [this.pts[0], this.pts[this.pts.length - 1]]) {
      add(new THREE.CylinderGeometry(RADIUS, RADIUS, PIPE_Y, 10), new THREE.Vector3(p.x, PIPE_Y / 2, p.z));
    }
  }

  /** Point on the pipe at distance s (clamped to the pipe). */
  pointAt(s) {
    s = Math.max(0, Math.min(this.length, s));
    for (let i = 0; i < this.lens.length; i++) {
      if (s <= this.lens[i] || i === this.lens.length - 1) {
        return this.pts[i].clone().lerp(this.pts[i + 1], Math.min(1, s / this.lens[i]));
      }
      s -= this.lens[i];
    }
    return this.pts[0].clone();
  }

  /** Direction of travel (increasing s) at s, flat. Near a bend it is the bisector of both legs. */
  dirAt(s) {
    let acc = 0;
    for (let i = 0; i < this.lens.length; i++) {
      const end = acc + this.lens[i];
      if (s <= end || i === this.lens.length - 1) {
        const leg = (k) => this.pts[k + 1].clone().sub(this.pts[k]).setY(0).normalize();
        const d = leg(i);
        if (i < this.lens.length - 1 && end - s < CORNER) return d.add(leg(i + 1)).normalize();
        if (i > 0 && s - acc < CORNER) return d.add(leg(i - 1)).normalize();
        return d;
      }
      acc = end;
    }
    return new THREE.Vector3(1, 0, 0);
  }

  /** Where the player stands to climb at each end: [{ s, pos }]. */
  mounts() {
    return [END_PAD, this.length - END_PAD].map((s) => ({ s, pos: this.pointAt(s).setY(0) }));
  }
}
