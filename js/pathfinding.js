// Pathfinding on the voxel world for the smarter creatures (aliens, guards,
// skeletons): A* over the cells a body can stand on, so they climb out of
// caves and holes, go around walls and buildings and actually reach the
// player, or a spot with a clear line of fire to them.
//
// A node is a feet cell (x, y, z): the body's cells (h of them) are free of
// solid blocks and the cell below is solid (or, for swimmers, the cell is
// water). From a node a creature can walk to the 8 neighbouring columns,
// stepping up by at most `step` blocks (a 1-block rise is a jump, more needs
// a big jump: aliens have one), or down by at most `drop`. Diagonals never
// cut a corner. The search is capped (maxNodes) so a hopeless one can't stall
// a frame: it then returns the best partial path (toward the target) instead.
import { IS_SOLID, IS_WET } from "./blocks.js";

const DIRS = [
  [1, 0], [-1, 0], [0, 1], [0, -1],
  [1, 1], [1, -1], [-1, 1], [-1, -1],
];

// A small binary min-heap of nodes ordered by f.
class Heap {
  constructor() {
    this.a = [];
  }
  get size() {
    return this.a.length;
  }
  clear() {
    this.a.length = 0;
  }
  push(n) {
    const a = this.a;
    a.push(n);
    let i = a.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (a[p].f <= n.f) break;
      a[i] = a[p];
      i = p;
    }
    a[i] = n;
  }
  pop() {
    const a = this.a;
    const top = a[0];
    const last = a.pop();
    if (a.length) {
      let i = 0;
      const n = a.length;
      for (;;) {
        let c = 2 * i + 1;
        if (c >= n) break;
        if (c + 1 < n && a[c + 1].f < a[c].f) c++;
        if (a[c].f >= last.f) break;
        a[i] = a[c];
        i = c;
      }
      a[i] = last;
    }
    return top;
  }
}

export class Pathfinder {
  constructor(world) {
    this.world = world;
    this.heap = new Heap();
    this.searches = 0; // (for tests and the debug overlay)
    this.expanded = 0;
  }

  _free(x, y, z) {
    return IS_SOLID[this.world.getBlock(x, y, z)] !== 1;
  }

  // Can a body of height h stand with its feet in cell (x, y, z)? 1: on the
  // ground, 2: swimming in water (only when `swim`), 0: no.
  standable(x, y, z, h, swim = false) {
    const w = this.world;
    if (y < 1) return 0;
    for (let k = 0; k < h; k++) if (IS_SOLID[w.getBlock(x, y + k, z)] === 1) return 0;
    const below = w.getBlock(x, y - 1, z);
    if (IS_SOLID[below] === 1) return IS_WET[w.getBlock(x, y, z)] ? (swim ? 2 : 0) : 1;
    if (swim && IS_WET[w.getBlock(x, y, z)]) return 2;
    return 0;
  }

  // The feet cell a body standing near (x, y, z) occupies: the cell itself,
  // or the nearest standable one just above or below. null if none.
  groundCell(x, y, z, h, swim = false) {
    x = Math.floor(x);
    z = Math.floor(z);
    y = Math.floor(y + 0.05);
    for (const dy of [0, -1, 1, -2, 2, -3]) if (this.standable(x, y + dy, z, h, swim)) return [x, y + dy, z];
    return null;
  }

  // Finds a path from the feet cell `from` ([x, y, z]) toward `target`
  // ({ x, y, z }, world coordinates).
  //   h: body height (cells), step: the highest rise (blocks), drop: the
  //   deepest fall, swim: water cells count, maxNodes: search cap,
  //   goalFn(x, y, z): optional, a cell that will do (default: within `radius`
  //   blocks of the target, at about its height); heuristic: false for an
  //   uninformed search (goalFn only, "get out of here").
  // Returns { path: [[x, y, z] ...] (cells after the start), reached, nodes }.
  // When the goal is not reached the path leads to the cell that got closest
  // to the target (empty if the start already is that cell).
  find(from, target, { h = 2, step = 1, drop = 3, swim = false, maxNodes = 1500, goalFn = null, radius = 1.6, heuristic = true } = {}) {
    this.searches++;
    const heap = this.heap;
    heap.clear();
    const tx = target ? Math.floor(target.x) : 0;
    const ty = target ? Math.floor(target.y) : 0;
    const tz = target ? Math.floor(target.z) : 0;
    const hf = (x, y, z) => (heuristic && target ? Math.hypot(x - tx, (y - ty) * 0.6, z - tz) : 0);
    const key = (x, y, z) => ((y + 64) * 65536 + (z + 32768)) * 65536 + (x + 32768);
    const best = new Map(); // key -> node
    const start = { x: from[0], y: from[1], z: from[2], g: 0, f: hf(from[0], from[1], from[2]), parent: null, closed: false };
    best.set(key(start.x, start.y, start.z), start);
    heap.push(start);
    let closest = start;
    let closestH = hf(start.x, start.y, start.z);
    let nodes = 0;
    let goal = null;
    const isGoal = (n) => {
      if (goalFn) return goalFn(n.x, n.y, n.z);
      if (!target) return false;
      return Math.hypot(n.x + 0.5 - target.x, n.z + 0.5 - target.z) <= radius && Math.abs(n.y - ty) <= 2;
    };
    while (heap.size && nodes < maxNodes) {
      const n = heap.pop();
      if (n.closed || best.get(key(n.x, n.y, n.z)) !== n) continue; // (stale: a cheaper node for this cell replaced it)
      n.closed = true;
      nodes++;
      if (isGoal(n)) {
        goal = n;
        break;
      }
      const hn = hf(n.x, n.y, n.z);
      if (hn < closestH) {
        closestH = hn;
        closest = n;
      }
      for (let d = 0; d < 8; d++) {
        const dx = DIRS[d][0];
        const dz = DIRS[d][1];
        const nx = n.x + dx;
        const nz = n.z + dz;
        if (d >= 4 && (!this._passable(n.x + dx, n.y, n.z, h) || !this._passable(n.x, n.y, n.z + dz, h))) continue; // no corner cutting
        // The cell the creature ends up in: level, up by a jump, or down a drop.
        let ny = null;
        let cost = d < 4 ? 1 : 1.414;
        let kind = this.standable(nx, n.y, nz, h, swim);
        if (kind) ny = n.y;
        else {
          // Up: it needs head room over the cell it leaves for the rise.
          for (let up = 1; up <= step && ny === null; up++) {
            let room = true;
            for (let k = 0; k < up && room; k++) if (!this._free(n.x, n.y + h + k, n.z)) room = false;
            if (!room) break;
            kind = this.standable(nx, n.y + up, nz, h, swim);
            if (kind) {
              ny = n.y + up;
              cost += 0.7 * up;
            }
          }
          // Down: it walks off the edge into free cells and lands.
          if (ny === null && this._passable(nx, n.y, nz, h)) {
            for (let dn = 1; dn <= drop; dn++) {
              if (!this._passable(nx, n.y - dn, nz, h)) break;
              kind = this.standable(nx, n.y - dn, nz, h, swim);
              if (kind) {
                ny = n.y - dn;
                cost += 0.2 * dn;
                break;
              }
            }
          }
        }
        if (ny === null) continue;
        if (kind === 2) cost += 1.2; // swimming is slow
        const k = key(nx, ny, nz);
        const g = n.g + cost;
        const old = best.get(k);
        if (old && old.g <= g) continue;
        const node = { x: nx, y: ny, z: nz, g, f: g + hf(nx, ny, nz), parent: n, closed: false };
        best.set(k, node);
        heap.push(node);
      }
    }
    this.expanded += nodes;
    const end = goal || closest;
    const path = [];
    for (let n = end; n && n.parent; n = n.parent) path.push([n.x, n.y, n.z]);
    path.reverse();
    return { path, reached: !!goal, nodes };
  }

  // A cell the body fits through (no solid in its cells), standing or not.
  _passable(x, y, z, h) {
    const w = this.world;
    for (let k = 0; k < h; k++) if (IS_SOLID[w.getBlock(x, y + k, z)] === 1) return false;
    return true;
  }
}
