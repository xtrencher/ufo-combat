// Shared voxel collision for the player and mobs: an upright box (feet
// center `pos`, half-width `r`, height `h`) moved one axis at a time.
//
// (Round 11) A solid block may collide with boxes smaller than its cell (a
// content block's `collision`: a slab, stairs, a fence up to 1.5 tall; see
// blocks.js COLLISION_BOXES), or with boxes that depend on its neighbours (a
// def's `collide(world, x, y, z, id)`: a fence's arms, a stair's corners,
// the same ones its shape draws). Full cells collide exactly as before.
import { IS_SOLID, COLLISION_BOXES, TALL_COLLISION, BLOCK_INFO, BLOCK_LIMIT } from "./blocks.js";

const COLLIDE = new Array(BLOCK_LIMIT).fill(null);
for (const info of Object.values(BLOCK_INFO)) if (info.solid && typeof info.collide === "function") COLLIDE[info.id] = info.collide;

const EPS = 1e-4;
// A box the mover already overlaps by more than this is ignored (so it can step out of it).
const INSIDE = 1e-3;

// What collides at a cell: NONE, FULL (the whole cell) or a list of boxes.
// (One block lookup per cell; a world with only isSolidAt has full cells.)
const NONE = 0;
const FULL = 1;
function collisionAt(world, bx, by, bz) {
  if (!world.getBlock) return world.isSolidAt(bx, by, bz) ? FULL : NONE;
  const id = world.getBlock(bx, by, bz);
  if (!IS_SOLID[id]) return NONE;
  if (COLLIDE[id]) return COLLIDE[id](world, bx, by, bz, id) || COLLISION_BOXES[id] || FULL;
  return COLLISION_BOXES[id] || FULL;
}

// How far the box (feet `pos`, r, h) may move along `axis` toward `delta`
// before it meets one of `boxes` (cell bx, by, bz): `allowed` narrowed.
function sweepBoxes(boxes, bx, by, bz, pos, r, h, axis, delta, allowed) {
  for (const b of boxes) {
    const x0 = bx + b[0];
    const x1 = bx + b[3];
    const y0 = by + b[1];
    const y1 = by + b[4];
    const z0 = bz + b[2];
    const z1 = bz + b[5];
    if (axis !== "x" && !(pos.x + r > x0 + EPS && pos.x - r < x1 - EPS)) continue;
    if (axis !== "y" && !(pos.y + h > y0 + EPS && pos.y < y1 - EPS)) continue;
    if (axis !== "z" && !(pos.z + r > z0 + EPS && pos.z - r < z1 - EPS)) continue;
    if (axis === "x") {
      if (delta > 0 && x0 >= pos.x + r - INSIDE) allowed = Math.min(allowed, x0 - (pos.x + r) - EPS);
      else if (delta < 0 && x1 <= pos.x - r + INSIDE) allowed = Math.max(allowed, x1 - (pos.x - r) + EPS);
    } else if (axis === "y") {
      if (delta > 0 && y0 >= pos.y + h - INSIDE) allowed = Math.min(allowed, y0 - (pos.y + h) - EPS);
      else if (delta < 0 && y1 <= pos.y + INSIDE) allowed = Math.max(allowed, y1 - pos.y + EPS);
    } else {
      if (delta > 0 && z0 >= pos.z + r - INSIDE) allowed = Math.min(allowed, z0 - (pos.z + r) - EPS);
      else if (delta < 0 && z1 <= pos.z - r + INSIDE) allowed = Math.max(allowed, z1 - (pos.z - r) + EPS);
    }
  }
  return allowed;
}

// Whether any of `boxes` (cell bx, by, bz) overlaps the box at `pos`.
function overlapsBoxes(boxes, bx, by, bz, pos, r, h) {
  for (const b of boxes) {
    if (pos.x + r > bx + b[0] + EPS && pos.x - r < bx + b[3] - EPS && pos.y + h > by + b[1] + EPS && pos.y < by + b[4] - EPS && pos.z + r > bz + b[2] + EPS && pos.z - r < bz + b[5] - EPS) return true;
  }
  return false;
}

// (A box taller than its cell reaches into the cell above: the layer under
// the mover is checked for those too.)
function isTall(boxes) {
  return !!boxes && boxes.some((b) => b[4] > 1);
}

// Returns how far the box may move along `axis` ("x" | "y" | "z") toward
// `delta` (same sign, magnitude <= |delta|) before it would overlap a solid
// block, given its current position on the other two axes.
export function sweepAxis(world, pos, r, h, axis, delta) {
  if (delta === 0) return 0;
  let minX = pos.x - r;
  let maxX = pos.x + r;
  let minY = pos.y;
  let maxY = pos.y + h;
  let minZ = pos.z - r;
  let maxZ = pos.z + r;

  if (axis === "x") {
    if (delta > 0) maxX += delta;
    else minX += delta;
  } else if (axis === "y") {
    if (delta > 0) maxY += delta;
    else minY += delta;
  } else {
    if (delta > 0) maxZ += delta;
    else minZ += delta;
  }

  const bx0 = Math.floor(minX);
  const bx1 = Math.floor(maxX - EPS);
  const by0 = Math.floor(minY);
  const by1 = Math.floor(maxY - EPS);
  const bz0 = Math.floor(minZ);
  const bz1 = Math.floor(maxZ - EPS);

  let allowed = delta;
  const tall = TALL_COLLISION && !!world.getBlock;
  for (let bx = bx0; bx <= bx1; bx++) {
    for (let by = tall ? by0 - 1 : by0; by <= by1; by++) {
      for (let bz = bz0; bz <= bz1; bz++) {
        const c = collisionAt(world, bx, by, bz);
        if (c === NONE) continue;
        if (by < by0) {
          if (c !== FULL && isTall(c)) allowed = sweepBoxes(c, bx, by, bz, pos, r, h, axis, delta, allowed);
          continue;
        }
        if (c !== FULL) {
          allowed = sweepBoxes(c, bx, by, bz, pos, r, h, axis, delta, allowed);
          continue;
        }
        if (axis === "x") {
          if (delta > 0) allowed = Math.min(allowed, bx - (pos.x + r) - EPS);
          else allowed = Math.max(allowed, bx + 1 - (pos.x - r) + EPS);
        } else if (axis === "y") {
          if (delta > 0) allowed = Math.min(allowed, by - (pos.y + h) - EPS);
          else allowed = Math.max(allowed, by + 1 - pos.y + EPS);
        } else {
          if (delta > 0) allowed = Math.min(allowed, bz - (pos.z + r) - EPS);
          else allowed = Math.max(allowed, bz + 1 - (pos.z - r) + EPS);
        }
      }
    }
  }
  return allowed;
}

// Whether the box at `pos` overlaps any solid block.
export function boxInSolid(world, pos, r, h) {
  const by0 = Math.floor(pos.y);
  const tall = TALL_COLLISION && !!world.getBlock;
  for (let bx = Math.floor(pos.x - r); bx <= Math.floor(pos.x + r - EPS); bx++) {
    for (let by = tall ? by0 - 1 : by0; by <= Math.floor(pos.y + h - EPS); by++) {
      for (let bz = Math.floor(pos.z - r); bz <= Math.floor(pos.z + r - EPS); bz++) {
        const c = collisionAt(world, bx, by, bz);
        if (c === NONE) continue;
        if (c === FULL ? by >= by0 : (by >= by0 || isTall(c)) && overlapsBoxes(c, bx, by, bz, pos, r, h)) return true;
      }
    }
  }
  return false;
}

// Ray vs. axis-aligned box; returns the entry distance along the (unit)
// direction, or null if the ray misses within maxDist.
export function rayAabb(origin, dir, min, max, maxDist) {
  let tmin = 0;
  let tmax = maxDist;
  for (const a of ["x", "y", "z"]) {
    const o = origin[a];
    const d = dir[a];
    if (Math.abs(d) < 1e-9) {
      if (o < min[a] || o > max[a]) return null;
      continue;
    }
    let t1 = (min[a] - o) / d;
    let t2 = (max[a] - o) / d;
    if (t1 > t2) [t1, t2] = [t2, t1];
    tmin = Math.max(tmin, t1);
    tmax = Math.min(tmax, t2);
    if (tmin > tmax) return null;
  }
  return tmin;
}
