// Villages: a rare, deterministic structure (simple houses, paths and a
// small farm plot) placed like a giant "tree" — pure logic, chunk-spanning,
// no player/mob code here (see mobs.js for the villagers that walk around
// one once the player gets close). One village per world grid cell, at most,
// decided by a hash so no chunk needs to generate to know where they are.
import { hash2, mulberry32 } from "./noise.js";
import { BLOCK, wallTorch, chest } from "./blocks.js";
import { CHUNK_SIZE, WORLD_HEIGHT, SEA_LEVEL } from "./constants.js";
import { BIOME } from "./biomes.js";

const CELL = 320; // world grid cell size a village candidate is picked from
const CHANCE = 0.42; // fraction of cells that actually get a village
// Round 8: villages are bigger: a plaza with a well, gravel streets in a
// cross, six to ten houses of a few sizes on lots along the streets (doors on
// the street), farm plots and lamp posts.
const PAD_RADIUS = 28; // the flattened pad reaches this far from the center
export const VILLAGE_REACH = PAD_RADIUS + 2;
const MAX_SLOPE = 8; // the natural ground under the pad may not vary more than this
const GOOD_BIOMES = new Set([BIOME.PLAINS, BIOME.SAVANNA, BIOME.FOREST, BIOME.BIRCH_FOREST, BIOME.DESERT]);
// House lots per quadrant: (a, b) is the lot's nearest corner to the middle,
// |offset| from the two streets. Mirrored into the four quadrants.
const LOTS = [
  [4, 4],
  [14, 4],
  [4, 14],
  [14, 14],
];

const CENTER_SALT = 0x6a1f3c9b;
const PLACE_SALT = 0x2d84af11;

export class VillageGrower {
  // terrain: the TerrainGenerator (heightAt, biomeAt).
  constructor(terrain) {
    this.terrain = terrain;
    this.seed = terrain.seed;
    this._centers = new Map(); // "cellX,cellZ" -> center or null (cache)
    this._shapes = new Map(); // "x,z" -> flat [dx, dy, dz, id, ...]
  }

  _cellCenter(cellX, cellZ) {
    const key = `${cellX},${cellZ}`;
    if (this._centers.has(key)) return this._centers.get(key);
    let center = null;
    if (hash2((this.seed ^ CENTER_SALT) >>> 0, cellX, cellZ) < CHANCE) {
      // A few tries per cell for a spot that is dry, in a good biome and flat enough.
      for (let t = 0; t < 4 && !center; t++) {
        const jx = hash2((this.seed ^ PLACE_SALT) >>> 0, cellX * 8 + t, cellZ);
        const jz = hash2((this.seed ^ PLACE_SALT ^ 0x9e37) >>> 0, cellX * 8 + t, cellZ);
        const x = cellX * CELL + Math.floor(jx * (CELL - VILLAGE_REACH * 2)) + VILLAGE_REACH;
        const z = cellZ * CELL + Math.floor(jz * (CELL - VILLAGE_REACH * 2)) + VILLAGE_REACH;
        const h = this.terrain.heightAt(x, z);
        const biome = this.terrain.biomeAt(x, z);
        // (not on an airport or in a city: those have their own people)
        if (h <= SEA_LEVEL + 2 || !GOOD_BIOMES.has(biome) || this.terrain.sites.covers(x, z, VILLAGE_REACH + 40)) continue;
        let lo = h;
        let hi = h;
        for (let k = 0; k < 16; k++) {
          const a = (k / 16) * Math.PI * 2;
          for (const r of [PAD_RADIUS * 0.55, PAD_RADIUS]) {
            const hh = this.terrain.heightAt(Math.round(x + Math.cos(a) * r), Math.round(z + Math.sin(a) * r));
            lo = Math.min(lo, hh);
            hi = Math.max(hi, hh);
          }
        }
        if (hi - lo > MAX_SLOPE || lo <= SEA_LEVEL) continue;
        center = { x, z, groundY: h };
      }
    }
    this._centers.set(key, center);
    // (the oldest goes, not the lot: distant.js asks for up to ~730 cells a
    // second at the longest view, and a wholesale clear re-surveyed them all)
    if (this._centers.size > 2048) this._centers.delete(this._centers.keys().next().value);
    return center;
  }

  // Every village whose reach could overlap a box from (x0,z0) to (x1,z1).
  _villagesNear(x0, z0, x1, z1) {
    const out = [];
    const c0x = Math.floor((x0 - VILLAGE_REACH) / CELL);
    const c1x = Math.floor((x1 + VILLAGE_REACH) / CELL);
    const c0z = Math.floor((z0 - VILLAGE_REACH) / CELL);
    const c1z = Math.floor((z1 + VILLAGE_REACH) / CELL);
    for (let cz = c0z; cz <= c1z; cz++) {
      for (let cx = c0x; cx <= c1x; cx++) {
        const c = this._cellCenter(cx, cz);
        if (c) out.push(c);
      }
    }
    return out;
  }

  // The nearest village within maxDist of (wx, wz), or null. Used by the mob
  // system to spawn villagers once the player is close to one.
  nearestVillage(wx, wz, maxDist) {
    let best = null;
    let bestD = maxDist * maxDist;
    for (const c of this._villagesNear(wx - maxDist, wz - maxDist, wx + maxDist, wz + maxDist)) {
      const d = (c.x - wx) ** 2 + (c.z - wz) ** 2;
      if (d < bestD) {
        bestD = d;
        best = c;
      }
    }
    return best;
  }

  // Blocks of a village, relative to (center.x, center.groundY, center.z):
  // flat [dx, dy, dz, id, ...]. dy=0 is the pad surface itself.
  shape(center) {
    const key = `${center.x},${center.z}`;
    let s = this._shapes.get(key);
    if (s) return s;
    const rand = mulberry32((this.seed ^ Math.imul(center.x, 0x9e3779b1) ^ Math.imul(center.z, 0x85ebca6b) ^ 0x76a3) >>> 0);
    const out = [];
    const lay = this.layout(center);
    // The flattened pad: grass (or sand in the desert), gravel streets in a
    // cross through the middle, a cobbled plaza with a well at the center.
    const sandy = this.terrain.biomeAt(center.x, center.z) === BIOME.DESERT;
    const padTop = sandy ? BLOCK.SAND : BLOCK.GRASS;
    const padFill = sandy ? BLOCK.SAND : BLOCK.DIRT;
    const R = PAD_RADIUS;
    for (let dz = -R; dz <= R; dz++) {
      for (let dx = -R; dx <= R; dx++) {
        const d2 = dx * dx + dz * dz;
        if (d2 > R * R) continue;
        const plaza = Math.abs(dx) <= 3 && Math.abs(dz) <= 3;
        const onPath = Math.abs(dx) <= 1 || Math.abs(dz) <= 1;
        out.push(dx, 0, dz, plaza ? BLOCK.COBBLESTONE : onPath ? BLOCK.GRAVEL : padTop);
        // (deeper fill and more headroom near the middle; a gentle rim at the edge)
        const depth = d2 > (R - 3) * (R - 3) ? 4 : 8;
        for (let dy = -depth; dy < 0; dy++) out.push(dx, dy, dz, padFill);
        for (let dy = 1; dy <= 14; dy++) out.push(dx, dy, dz, BLOCK.AIR);
      }
    }
    // The well: a cobblestone ring around water, posts and a little roof.
    for (let dz = -1; dz <= 1; dz++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (dx === 0 && dz === 0) {
          for (let dy = -3; dy <= 0; dy++) out.push(0, dy, 0, BLOCK.WATER);
        } else out.push(dx, 1, dz, BLOCK.COBBLESTONE);
      }
    }
    for (const [px, pz] of [[-1, -1], [1, 1]]) for (let dy = 2; dy <= 3; dy++) out.push(px, dy, pz, BLOCK.WOOD);
    for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) out.push(dx, 4, dz, BLOCK.PLANKS);
    // Houses, doors on the street. (Round 10) Wall torches inside and beside
    // every door, and chests in about half the houses, one more in the
    // biggest: from a generator of their own, so the village's other random
    // choices (and old saves' villages) stay as they were.
    const furnish = mulberry32((this.seed ^ Math.imul(center.x, 0x632be5ab) ^ Math.imul(center.z, 0x2c1b3c6d) ^ 0x3c6ef3) >>> 0);
    let biggest = 0;
    lay.houses.forEach((h, i) => {
      const b = lay.houses[biggest];
      if (h.w * h.d > b.w * b.d) biggest = i;
    });
    // (a door torch with a lamp post right in front of it is left out: the lamp lights the door)
    const lampAt = new Set(lay.lamps.map(([lx, lz]) => `${lx},${lz}`));
    const blocked = (dx, dz) => lampAt.has(`${dx},${dz}`);
    lay.houses.forEach((h, i) => {
      const chestRoll = furnish();
      const torchRoll = furnish();
      house(out, h, { chests: (chestRoll < 0.5 ? 1 : 0) + (i === biggest ? 1 : 0), torches: torchRoll < 0.5 || h.w * h.d >= 48 ? 2 : 1, blocked });
    });
    // Farm plots: tilled rows of crops with a water channel down the middle.
    for (const f of lay.farms) {
      for (let dz = f.z; dz < f.z + f.d; dz++) {
        for (let dx = f.x; dx < f.x + f.w; dx++) {
          const mid = f.w >= f.d ? dz === f.z + (f.d >> 1) : dx === f.x + (f.w >> 1);
          if (mid) {
            out.push(dx, 0, dz, BLOCK.WATER);
            continue;
          }
          out.push(dx, 0, dz, BLOCK.DIRT);
          if (rand() < 0.8) out.push(dx, 1, dz, BLOCK.TALL_GRASS);
        }
      }
      // A log border.
      for (let dx = f.x - 1; dx <= f.x + f.w; dx++) for (const dz of [f.z - 1, f.z + f.d]) out.push(dx, 1, dz, BLOCK.OAK_BARK);
      for (let dz = f.z; dz < f.z + f.d; dz++) for (const dx of [f.x - 1, f.x + f.w]) out.push(dx, 1, dz, BLOCK.OAK_BARK);
    }
    // Lamp posts along the streets.
    for (const [lx, lz] of lay.lamps) {
      for (let dy = 1; dy <= 3; dy++) out.push(lx, dy, lz, BLOCK.WOOD);
      out.push(lx, 4, lz, BLOCK.TORCH);
    }
    s = Int16Array.from(out);
    if (this._shapes.size > 200) this._shapes.clear();
    this._shapes.set(key, s);
    return s;
  }

  // The plan of a village (deterministic from the seed and its place): house
  // footprints { x, z, w, d, h, door } (corner relative to the center, h the
  // wall height), farm plots { x, z, w, d } and lamp posts [dx, dz].
  layout(center) {
    if (center._layout) return center._layout;
    const rand = mulberry32((this.seed ^ Math.imul(center.x, 0x27d4eb2d) ^ Math.imul(center.z, 0x165667b1) ^ 0x51ed) >>> 0);
    const houses = [];
    const farms = [];
    const lamps = [];
    const slots = [];
    for (const [qx, qz] of [[1, 1], [-1, 1], [1, -1], [-1, -1]]) for (const [a, b] of LOTS) slots.push({ qx, qz, a, b });
    // Shuffle the lots, then houses on most, farms on a couple.
    for (let i = slots.length - 1; i > 0; i--) {
      const j = Math.floor(rand() * (i + 1));
      [slots[i], slots[j]] = [slots[j], slots[i]];
    }
    const nHouses = 6 + Math.floor(rand() * 5); // 6-10
    const nFarms = 2 + Math.floor(rand() * 2);
    for (const sl of slots) {
      const far = sl.a === 14 && sl.b === 14; // the outer corner lot: smaller
      if (houses.length < nHouses && !(far && rand() < 0.5)) {
        const w = far ? 6 : 6 + Math.floor(rand() * 3); // 6-8
        const d = far ? 6 : 6 + Math.floor(rand() * 2); // 6-7
        const h = rand() < 0.3 ? 5 : 4;
        // The lot's corner nearest the middle is (a, b) from the streets.
        const x = sl.qx > 0 ? sl.a : -sl.a - w + 1;
        const z = sl.qz > 0 ? sl.b : -sl.b - d + 1;
        // Door on the nearer street.
        let door;
        if (sl.b <= sl.a) door = sl.qz > 0 ? "z-" : "z+";
        else door = sl.qx > 0 ? "x-" : "x+";
        if (sl.a === sl.b) door = rand() < 0.5 ? (sl.qz > 0 ? "z-" : "z+") : sl.qx > 0 ? "x-" : "x+";
        houses.push({ x, z, w, d, h, door });
      } else if (!far && farms.length < nFarms) {
        const w = 8;
        const d = 6;
        farms.push({ x: sl.qx > 0 ? sl.a + 1 : -sl.a - w, z: sl.qz > 0 ? sl.b + 1 : -sl.b - d, w, d });
      }
    }
    for (const k of [7, 15, 23]) {
      lamps.push([2, k], [-2, -k], [k, -2], [-k, 2]);
    }
    center._layout = { houses, farms, lamps };
    return center._layout;
  }

  // The house footprints of a village (for the distant view, distant.js).
  houses(center) {
    return this.layout(center).houses;
  }

  // Places every village that overlaps chunk (cx, cz).
  placeInChunk(blocks, cx, cz) {
    const S = CHUNK_SIZE;
    const bx = cx * S;
    const bz = cz * S;
    const idx = (x, y, z) => (y * S + z) * S + x;
    for (const center of this._villagesNear(bx, bz, bx + S, bz + S)) {
      const shape = this.shape(center);
      for (let i = 0; i < shape.length; i += 4) {
        const wx = center.x + shape[i];
        const wz = center.z + shape[i + 2];
        const lx = wx - bx;
        const lz = wz - bz;
        if (lx < 0 || lx >= S || lz < 0 || lz >= S) continue;
        const y = center.groundY + shape[i + 1];
        if (y < 1 || y >= WORLD_HEIGHT) continue;
        blocks[idx(lx, y, lz)] = shape[i + 3];
      }
    }
  }

  // The nearest village center a mob spawner (or debug overlay) can use, or
  // null; a thin, more convenient wrapper over nearestVillage.
  villageBounds(center) {
    return { x: center.x, z: center.z, radius: PAD_RADIUS };
  }
}

// A house: footprint w x d with its corner at (x, z) relative to the village
// center, walls y 1..h (a cobblestone footing, plank walls with log corners
// and glass windows), a doorway on the `door` side and a stepped roof above.
// (Round 10) Furnished: a wall torch beside the doorway on each side, one or
// two inside at head height (on the back wall, and a side wall), and
// `chests` chests (0-2) in the back corners, their latches toward the room.
// blocked(dx, dz): whether something else of the village stands in that column.
function house(out, { x: ox, z: oz, w: W, d: D, h: H, door }, { chests = 0, torches = 1, blocked = null } = {}) {
  const midX = Math.floor((W - 1) / 2);
  const midZ = Math.floor((D - 1) / 2);
  const isDoor = (x, z) =>
    (door === "z+" && z === D - 1 && (x === midX || x === midX + 1)) ||
    (door === "z-" && z === 0 && (x === midX || x === midX + 1)) ||
    (door === "x+" && x === W - 1 && (z === midZ || z === midZ + 1)) ||
    (door === "x-" && x === 0 && (z === midZ || z === midZ + 1));
  // The wall's block at (x, y, z) of the footprint (0: the doorway, or no wall there).
  const wallAt = (x, y, z) => {
    const ex = x === 0 || x === W - 1;
    const ez = z === 0 || z === D - 1;
    if ((!ex && !ez) || x < 0 || x >= W || z < 0 || z >= D || y < 1 || y > H) return 0;
    const dr = isDoor(x, z);
    if (dr && y <= 2) return 0;
    if (ex && ez) return BLOCK.WOOD;
    if (y === 1) return BLOCK.COBBLESTONE;
    if (y === 2 && !dr && ((ex && z % 3 === 1 && z < D - 1) || (ez && x % 3 === 1 && x < W - 1))) return BLOCK.GLASS;
    return BLOCK.PLANKS;
  };
  for (let x = 0; x < W; x++) {
    for (let z = 0; z < D; z++) {
      const ex = x === 0 || x === W - 1;
      const ez = z === 0 || z === D - 1;
      // The floor inside.
      if (!ex && !ez) {
        out.push(ox + x, 0, oz + z, BLOCK.PLANKS);
        continue;
      }
      for (let y = 1; y <= H; y++) {
        const id = wallAt(x, y, z);
        if (id) out.push(ox + x, y, oz + z, id);
      }
    }
  }
  // A stepped roof.
  let k = 0;
  for (let y = H + 1; ; y++, k++) {
    const x0 = -1 + k;
    const x1 = W - k;
    const z0 = -1 + k;
    const z1 = D - k;
    if (x0 > x1 || z0 > z1) break;
    for (let x = x0; x <= x1; x++) for (let z = z0; z <= z1; z++) out.push(ox + x, y, oz + z, BLOCK.OAK_BARK);
    if (k >= 2) break;
  }
  // A wall torch at (x, y, z) facing (dx, dz), only on a real wall block
  // (never on glass or in a doorway: no floating torches).
  const torch = (x, y, z, dx, dz) => {
    const wall = wallAt(x - dx, y, z - dz);
    if (!wall || wall === BLOCK.GLASS || blocked?.(ox + x + dx, oz + z + dz)) return;
    out.push(ox + x, y, oz + z, wallTorch(dx, dz));
  };
  // The door's side: (fx, fz) points out through it. Beside the doorway, on
  // the outside, at the doorway's height (above it where a window is).
  const fx = door === "x+" ? 1 : door === "x-" ? -1 : 0;
  const fz = door === "z+" ? 1 : door === "z-" ? -1 : 0;
  const beside = fx ? [[fx > 0 ? W : -1, midZ - 1], [fx > 0 ? W : -1, midZ + 2]] : [[midX - 1, fz > 0 ? D : -1], [midX + 2, fz > 0 ? D : -1]];
  for (const [bx, bz] of beside) {
    const y = wallAt(bx - fx, 2, bz - fz) === BLOCK.GLASS ? 3 : 2;
    torch(bx, y, bz, fx, fz);
  }
  // Inside: the back wall's cells (along it, from one corner to the other),
  // facing the door.
  const back = [];
  if (fx) for (let z = 1; z <= D - 2; z++) back.push([fx > 0 ? 1 : W - 2, z]);
  else for (let x = 1; x <= W - 2; x++) back.push([x, fz > 0 ? 1 : D - 2]);
  const [cx, cz] = back[(back.length - 1) >> 1];
  torch(cx, 3, cz, fx, fz);
  // A second one on a side wall, facing across the room.
  if (torches > 1) {
    if (fx) torch(midX, 3, 1, 0, 1);
    else torch(1, 3, midZ, 1, 0);
  }
  // Chests in the back corners, on the floor against the back wall.
  for (let i = 0; i < Math.min(2, chests); i++) {
    const [qx, qz] = back[i === 0 ? 0 : back.length - 1];
    out.push(ox + qx, 1, oz + qz, chest(fx, fz));
  }
}
