// Villages: a rare, deterministic structure (simple houses, paths and a
// small farm plot) placed like a giant "tree" — pure logic, chunk-spanning,
// no player/mob code here (see mobs.js for the villagers that walk around
// one once the player gets close). One village per world grid cell, at most,
// decided by a hash so no chunk needs to generate to know where they are.
//
// (Round 11) In a Survival world (vanilla) a village has vanilla's touches:
// wooden doors in the doorways, beds (and a carpet) in some houses, glass
// panes for windows, stair-edged roofs, fence posts under the well's roof
// and farmland with wheat. They come from a generator of their own, so the
// village's layout is the same as without them; a Missions world's villages
// (old saves' too) are exactly as before.
//
// (Round 12) A Survival world's villages are vanilla's (1.14 on) instead, from
// a generator of their own (the second half of this file): a meeting point
// with a well, streets of dirt path branching out over the land as it lies
// (bridges over water), and along them houses of five styles by biome
// (plains, desert, savanna, taiga, snowy) standing on foundations at their
// street's level: small, medium and big houses with beds, farms, animal
// pens, a library, a church, a blacksmith and the other trades' houses, each
// with its job's block and a chest of vanilla's loot, lamp posts and hay.
//
// (Round 13) A new Missions world's terrain is the vanilla one: its villages
// are these too, kept off its airports and cities (_onSite).
import { hash2, mulberry32 } from "./noise.js";
import { BLOCK, BLOCK_INFO, wallTorch, chest } from "./blocks.js";
import * as V from "./content/ids.js";
import { OAK_DOOR_RIGHT, SPRUCE_DOOR_RIGHT, LANTERN_HANGING } from "./content/building.js";
import { SNOWY_GRASS } from "./content/nature.js";
import { bedOf, pottedOf } from "./content/decor.js";
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
    // (vanilla: the vanilla terrain's villages, a Survival world's and, from
    // Round 13, a new Missions world's; an old Missions world's are its own.)
    const o = terrain.options || {};
    this.vanilla = o.vanilla ?? o.sites === false;
    // (Round 12) How far a village reaches from its middle (a Survival world's are bigger).
    this.reach = this.vanilla ? VANILLA_VILLAGE_REACH : VILLAGE_REACH;
  }

  _cellCenter(cellX, cellZ) {
    const key = `${cellX},${cellZ}`;
    if (this._centers.has(key)) return this._centers.get(key);
    let center = null;
    if (this.vanilla) center = this._vanillaCenter(cellX, cellZ);
    else if (hash2((this.seed ^ CENTER_SALT) >>> 0, cellX, cellZ) < CHANCE) {
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
    const R = this.reach;
    const c0x = Math.floor((x0 - R) / CELL);
    const c1x = Math.floor((x1 + R) / CELL);
    const c0z = Math.floor((z0 - R) / CELL);
    const c1z = Math.floor((z1 + R) / CELL);
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
    if (center.style) return this._vanillaShape(center);
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
    const fencePost = this.vanilla && BLOCK_INFO[V.OAK_FENCE] ? V.OAK_FENCE : BLOCK.WOOD;
    for (const [px, pz] of [[-1, -1], [1, 1]]) for (let dy = 2; dy <= 3; dy++) out.push(px, dy, pz, fencePost);
    for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) out.push(dx, 4, dz, BLOCK.PLANKS);
    // Houses, doors on the street. (Round 10) Wall torches inside and beside
    // every door, and chests in about half the houses, one more in the
    // biggest: from a generator of their own, so the village's other random
    // choices (and old saves' villages) stay as they were.
    const furnish = mulberry32((this.seed ^ Math.imul(center.x, 0x632be5ab) ^ Math.imul(center.z, 0x2c1b3c6d) ^ 0x3c6ef3) >>> 0);
    // (Round 11) The vanilla touches' own generator (null in a Missions world).
    const touch = this.vanilla ? mulberry32((this.seed ^ Math.imul(center.x, 0x4cf5ad43) ^ Math.imul(center.z, 0x7feb352d) ^ 0x5bd1e9) >>> 0) : null;
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
      house(out, h, { chests: (chestRoll < 0.5 ? 1 : 0) + (i === biggest ? 1 : 0), torches: torchRoll < 0.5 || h.w * h.d >= 48 ? 2 : 1, blocked, touch });
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
      // (Round 11) Vanilla: tilled farmland (moist by the channel) and wheat
      // at every stage, where the nature blocks are there.
      if (touch && BLOCK_INFO[V.FARMLAND] && BLOCK_INFO[V.WHEAT_CROP]) {
        const farmland = BLOCK_INFO[V.FARMLAND + 1] ? V.FARMLAND + 1 : V.FARMLAND;
        for (let dz = f.z; dz < f.z + f.d; dz++) {
          for (let dx = f.x; dx < f.x + f.w; dx++) {
            if (f.w >= f.d ? dz === f.z + (f.d >> 1) : dx === f.x + (f.w >> 1)) continue;
            out.push(dx, 0, dz, farmland);
            const stage = Math.floor(touch() * 8);
            out.push(dx, 1, dz, BLOCK_INFO[V.WHEAT_CROP + stage] ? V.WHEAT_CROP + stage : BLOCK.AIR);
          }
        }
      }
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
    if (center.style) return (center._layout = new VillagePlan(this, center).build());
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
      if (center.style) {
        // (Round 12) a Survival world's village: its blocks in this chunk, in order
        const cells = this.shape(center).get(`${cx},${cz}`);
        if (!cells) continue;
        for (let i = 0; i < cells.length; i += 4) {
          const y = cells[i + 1];
          if (y >= 1 && y < WORLD_HEIGHT) blocks[idx(cells[i], y, cells[i + 2])] = cells[i + 3];
        }
        continue;
      }
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
    return { x: center.x, z: center.z, radius: center.style ? V_RADIUS : PAD_RADIUS };
  }

  // ---------- (Round 12) A Survival world's villages ----------

  // The village tried in cell (cellX, cellZ), or null: a few tries for a
  // spot on land in a village biome, level enough over the middle (the rest
  // of the village takes the ground as it comes, as vanilla's).
  _vanillaCenter(cellX, cellZ) {
    if (hash2((this.seed ^ CENTER_SALT) >>> 0, cellX, cellZ) >= V_CHANCE) return null;
    const R = this.reach;
    for (let t = 0; t < 4; t++) {
      const jx = hash2((this.seed ^ PLACE_SALT) >>> 0, cellX * 8 + t, cellZ);
      const jz = hash2((this.seed ^ PLACE_SALT ^ 0x9e37) >>> 0, cellX * 8 + t, cellZ);
      const x = cellX * CELL + Math.floor(jx * (CELL - R * 2)) + R;
      const z = cellZ * CELL + Math.floor(jz * (CELL - R * 2)) + R;
      const h = this.terrain.heightAt(x, z);
      const style = V_STYLES[this.terrain.biomeAt(x, z)];
      // (Round 13: a Missions world's vanilla villages keep off its airports and cities)
      if (h <= SEA_LEVEL + 2 || !style || this._onSite(x, z, R + 40)) continue;
      let lo = h;
      let hi = h;
      let wet = 0;
      for (let k = 0; k < 16; k++) {
        const a = (k / 16) * Math.PI * 2;
        for (const r of [10, 24, 40]) {
          const hh = this.terrain.heightAt(Math.round(x + Math.cos(a) * r), Math.round(z + Math.sin(a) * r));
          if (hh < SEA_LEVEL) wet++;
          else if (r < 40) {
            lo = Math.min(lo, hh);
            hi = Math.max(hi, hh);
          }
        }
      }
      if (hi - lo > V_SLOPE || wet > 12) continue;
      return { x, z, groundY: h, style };
    }
    return null;
  }

  // (Round 13) Whether a site (an airport or a city: sites.js) comes within
  // `r` of (x, z): its middle and eight points round it (a site is found from
  // the column asked about, and a village's edge can reach a site its middle
  // is outside of). Never in a Survival world (no sites).
  _onSite(x, z, r) {
    const sites = this.terrain.sites;
    if (!sites || sites.off) return false;
    if (sites.covers(x, z, r)) return true;
    for (let k = 0; k < 8; k++) {
      const a = (k / 8) * Math.PI * 2;
      if (sites.covers(Math.round(x + Math.cos(a) * r), Math.round(z + Math.sin(a) * r), 0)) return true;
    }
    return false;
  }

  // A Survival world's village's blocks, by chunk: Map "cx,cz" -> Int16Array
  // [lx, y, lz, id, ...] in the order they go down.
  _vanillaShape(center) {
    const key = `${center.x},${center.z}`;
    const lay = this.layout(center);
    const ops = lay.ops;
    const lists = new Map();
    for (let i = 0; i < ops.length; i += 4) {
      const wx = center.x + ops[i];
      const wz = center.z + ops[i + 2];
      const k = `${wx >> 4},${wz >> 4}`;
      let l = lists.get(k);
      if (!l) lists.set(k, (l = []));
      l.push(wx & 15, ops[i + 1], wz & 15, ops[i + 3]);
    }
    const out = new Map();
    for (const [k, l] of lists) out.set(k, Int16Array.from(l));
    if (this._shapes.size > 48) this._shapes.delete(this._shapes.keys().next().value);
    this._shapes.set(key, out);
    return out;
  }

  // (Round 12) Whether a tree may not grow at (wx, wz): on a Survival
  // world's village's streets and pieces, or right beside them (a Missions
  // world's: anywhere on its pad, see trees.js).
  blocksTree(wx, wz) {
    for (const c of this._villagesNear(wx, wz, wx, wz)) {
      if (!c.style) continue;
      if (Math.abs(wx - c.x) > V_RADIUS + 3 || Math.abs(wz - c.z) > V_RADIUS + 3) continue;
      if (this.layout(c).clearAt(wx - c.x, wz - c.z)) return true;
    }
    return false;
  }

  // (Round 12) Whether a Survival world's village has a building, farm or
  // pen on column (wx, wz) (or the ring round one).
  pieceAt(wx, wz) {
    for (const c of this._villagesNear(wx, wz, wx, wz)) {
      if (c.style && Math.abs(wx - c.x) <= V_RADIUS && Math.abs(wz - c.z) <= V_RADIUS && this.layout(c).occAt(wx - c.x, wz - c.z) === 2) return true;
    }
    return false;
  }

  // (Round 12) The loot table of a Survival world's village chest at
  // (x, y, z) ("village_plains_house", "village_weaponsmith", ...), or null.
  chestLoot(x, y, z) {
    for (const c of this._villagesNear(x, z, x, z)) {
      if (!c.style) continue;
      const kind = this.layout(c).chests.get(`${x - c.x},${y},${z - c.z}`);
      if (kind) return kind;
    }
    return null;
  }

  // (Round 12) A Survival world's village's people: one a bed, each standing
  // at the door of a house ({ x, y, z } of the cell, world coordinates),
  // with the trade of a job's block in the village (profession: trading.js's
  // PROFESSIONS index) while there are jobs to go round, else -1 (any).
  // [] for a Missions world's village.
  residents(center) {
    return center.style ? this.layout(center).residents.map((r) => ({ x: center.x + r.x, y: r.y, z: center.z + r.z, profession: r.profession })) : [];
  }

  // (Round 12) A Survival world's village's animal pens: [{ x, y, z (the
  // middle, world coordinates), r (half its inside), animal }].
  pens(center) {
    return center.style ? this.layout(center).pens.map((p) => ({ x: center.x + p.x, y: p.y, z: center.z + p.z, r: p.r, animal: p.animal })) : [];
  }

  // (Round 12) A random spot on a Survival world's village's streets (an
  // iron golem's, a wanderer's): { x, y (the cell above the street), z }, or null.
  streetSpot(center, rand = Math.random) {
    const cells = center.style ? this.layout(center).streetCells : null;
    if (!cells?.length) return null;
    const i = Math.floor(rand() * (cells.length / 3)) * 3;
    return { x: center.x + cells[i], y: cells[i + 1] + 1, z: center.z + cells[i + 2] };
  }
}

// A house: footprint w x d with its corner at (x, z) relative to the village
// center, walls y 1..h (a cobblestone footing, plank walls with log corners
// and glass windows), a doorway on the `door` side and a stepped roof above.
// (Round 10) Furnished: a wall torch beside the doorway on each side, one or
// two inside at head height (on the back wall, and a side wall), and
// `chests` chests (0-2) in the back corners, their latches toward the room.
// blocked(dx, dz): whether something else of the village stands in that column.
// (Round 11) touch: the vanilla touches' generator, or null (see the top).
function house(out, { x: ox, z: oz, w: W, d: D, h: H, door }, { chests = 0, torches = 1, blocked = null, touch = null } = {}) {
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
    if (y === 2 && !dr && ((ex && z % 3 === 1 && z < D - 1) || (ez && x % 3 === 1 && x < W - 1))) return touch ? V.GLASS_PANE : BLOCK.GLASS;
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
  // A stepped roof. (Round 11: in vanilla, each step's edge is spruce stairs
  // rising inward; the corners make themselves, see building.js.)
  let k = 0;
  for (let y = H + 1; ; y++, k++) {
    const x0 = -1 + k;
    const x1 = W - k;
    const z0 = -1 + k;
    const z1 = D - k;
    if (x0 > x1 || z0 > z1) break;
    for (let x = x0; x <= x1; x++) {
      for (let z = z0; z <= z1; z++) {
        let id = BLOCK.OAK_BARK;
        if (touch && x1 - x0 >= 2 && z1 - z0 >= 2) {
          if (x === x0) id = V.SPRUCE_STAIRS + 2;
          else if (x === x1) id = V.SPRUCE_STAIRS + 3;
          else if (z === z0) id = V.SPRUCE_STAIRS + 0;
          else if (z === z1) id = V.SPRUCE_STAIRS + 1;
        }
        out.push(ox + x, y, oz + z, id);
      }
    }
    if (k >= 2) break;
  }
  // A wall torch at (x, y, z) facing (dx, dz), only on a real wall block
  // (never on glass or in a doorway: no floating torches).
  const torch = (x, y, z, dx, dz) => {
    const wall = wallAt(x - dx, y, z - dz);
    if (!wall || wall === BLOCK.GLASS || wall === V.GLASS_PANE || blocked?.(ox + x + dx, oz + z + dz)) return;
    out.push(ox + x, y, oz + z, wallTorch(dx, dz));
  };
  // The door's side: (fx, fz) points out through it. Beside the doorway, on
  // the outside, at the doorway's height (above it where a window is).
  const fx = door === "x+" ? 1 : door === "x-" ? -1 : 0;
  const fz = door === "z+" ? 1 : door === "z-" ? -1 : 0;
  const beside = fx ? [[fx > 0 ? W : -1, midZ - 1], [fx > 0 ? W : -1, midZ + 2]] : [[midX - 1, fz > 0 ? D : -1], [midX + 2, fz > 0 ? D : -1]];
  for (const [bx, bz] of beside) {
    const win = wallAt(bx - fx, 2, bz - fz);
    const y = win === BLOCK.GLASS || win === V.GLASS_PANE ? 3 : 2;
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
  if (touch) vanillaHouse(out, { ox, oz, W, D, door, fx, fz, midX, midZ }, touch);
}

// (Round 11) A house's vanilla touches: oak doors in the doorway (a double
// door, both facing in, hinged at the two sides), and in some houses a bed
// along a side wall with its head to the back wall, a carpet beside it.
// Facings as building.js's: 0 +Z, 1 -Z, 2 +X, 3 -X.
const FACING_X = [0, 0, 1, -1];
const FACING_Z = [1, -1, 0, 0];
const LEFT_OF = [2, 3, 1, 0];
function vanillaHouse(out, { ox, oz, W, D, door, fx, fz, midX, midZ }, touch) {
  const bedRoll = touch();
  const sideRoll = touch();
  const carpetRoll = touch();
  // In: the way through the door into the house.
  const inward = fx > 0 ? 3 : fx < 0 ? 2 : fz > 0 ? 1 : 0;
  if (BLOCK_INFO[V.OAK_DOOR]) {
    const cells = fx ? [[fx > 0 ? W - 1 : 0, midZ], [fx > 0 ? W - 1 : 0, midZ + 1]] : [[midX, fz > 0 ? D - 1 : 0], [midX + 1, fz > 0 ? D - 1 : 0]];
    const L = LEFT_OF[inward];
    const cx = (cells[0][0] + cells[1][0]) / 2;
    const cz = (cells[0][1] + cells[1][1]) / 2;
    for (const [x, z] of cells) {
      // (the cell on the left, seen from outside, hinged on the left)
      const left = (x - cx) * FACING_X[L] + (z - cz) * FACING_Z[L] > 0;
      const base = left ? V.OAK_DOOR : OAK_DOOR_RIGHT;
      out.push(ox + x, 1, oz + z, base + inward, ox + x, 2, oz + z, base + inward + 8);
    }
  }
  if (bedRoll < 0.6 && BLOCK_INFO[V.RED_BED]) {
    // House frame: a runs from the back wall toward the door, c across.
    const across = fx ? D : W;
    const at = (a, c) => (fx > 0 ? [a, c] : fx < 0 ? [W - 1 - a, c] : fz > 0 ? [c, a] : [c, D - 1 - a]);
    const c = sideRoll < 0.5 ? 1 : across - 2;
    // (its head toward the back wall: the way in)
    const [hx, hz] = at(2, c);
    const [fx2, fz2] = at(3, c);
    out.push(ox + hx, 1, oz + hz, V.RED_BED + inward + 4, ox + fx2, 1, oz + fz2, V.RED_BED + inward);
    if (carpetRoll < 0.7 && BLOCK_INFO[V.WHITE_CARPET]) {
      const [kx, kz] = at(3, c === 1 ? 2 : across - 3);
      out.push(ox + kx, 1, oz + kz, V.WHITE_CARPET + Math.floor(touch() * 16));
    }
  }
}

// ---------- (Round 12) A Survival world's villages: the plan ----------
//
// Vanilla's villages (1.14 on), built in the generator's terms: the plan is
// made once per village from the seed and the terrain's own heights (so every
// chunk, worker and the distant view agree), then cut chunk by chunk.
// - The meeting point: a well in the middle of a square of path.
// - Streets: 3 wide, out from the square in up to four directions, 10-27
//   blocks a stretch, going on, turning or forking up to three times, with
//   side streets now and then; each block on the ground where it lies (a
//   street stops where the land steps more than 2), planks over water.
// - Along them on both sides, a block back from the street: houses facing it
//   (small, medium and big houses, a library, a church, a blacksmith, the
//   armorer's, toolsmith's, butcher's, fletcher's, shepherd's, mason's and
//   fisher's houses and a tannery), farms (wheat, carrots, potatoes or
//   beetroots by a water channel) and animal pens. Each stands level at its
//   street's height by its door: a foundation down to the ground under it,
//   the ground cut away above, a ring of earth round it to meet the land
//   (a piece needs ground within 3 of that height all over).
// - Lamp posts along the streets, hay bales here and there.
// Job's blocks: vanilla's (Round 12: js/content/workstations.js), a
// composter by a farm (farmer), a lectern (librarian), a blast furnace
// (armorer), a smithing table (toolsmith), a smoker (butcher), a brewing
// stand (cleric), a barrel (fisherman), a loom (shepherd), a fletching table
// (fletcher), a stonecutter (mason), a cauldron (leatherworker) and a
// grindstone (weaponsmith).
const V_CHANCE = 0.5; // (of the cells, before the biome and the ground: about a village every 500-700 blocks of village country)
const V_RADIUS = 60; // no piece of a village reaches farther from its middle
export const VANILLA_VILLAGE_REACH = V_RADIUS + 4;
const V_SLOPE = 9; // the ground within 24 blocks of the middle may vary this much
const V_STYLES = { [BIOME.PLAINS]: "plains", [BIOME.MEADOW]: "plains", [BIOME.DESERT]: "desert", [BIOME.SAVANNA]: "savanna", [BIOME.TAIGA]: "taiga", [BIOME.SNOWY_PLAINS]: "snowy" };
const V_GRID = V_RADIUS * 2 + 1;

// (trading.js's PROFESSIONS order)
const JOB = { farmer: 0, librarian: 1, armorer: 2, toolsmith: 3, butcher: 4, cleric: 5, fisherman: 6, shepherd: 7, fletcher: 8, cartographer: 9, mason: 10, leatherworker: 11, weaponsmith: 12 };
// Bed colours by style (decor.js's colour order: white 0, yellow 4, red 14...).
const C = { white: 0, orange: 1, light_blue: 3, yellow: 4, lime: 5, gray: 7, cyan: 9, purple: 10, blue: 11, brown: 12, green: 13, red: 14 };

// The materials of a style. (Desert streets are smooth sandstone; acacia
// has no door in the game: oak ones; the snowy houses' white walls are
// white terracotta: the game's snow block has earthen sides.)
const STYLE = {
  plains: { found: BLOCK.COBBLESTONE, floor: BLOCK.PLANKS, wall: BLOCK.PLANKS, frame: BLOCK.WOOD, stairs: V.OAK_STAIRS, slab: V.OAK_SLAB, roofBlock: BLOCK.PLANKS, door: [V.OAK_DOOR, OAK_DOOR_RIGHT], fence: V.OAK_FENCE, gate: V.OAK_FENCE_GATE, path: V.DIRT_PATH, top: BLOCK.GRASS, fill: BLOCK.DIRT, beds: [C.yellow, C.white, C.red, C.light_blue], lamp: "wool", plants: [BLOCK.FLOWER_RED, BLOCK.FLOWER_YELLOW, V.AZURE_BLUET, V.OXEYE_DAISY, V.CORNFLOWER] },
  desert: { found: V.SANDSTONE, floor: V.SMOOTH_SANDSTONE, wall: V.SANDSTONE, frame: V.CUT_SANDSTONE, stairs: V.SANDSTONE_STAIRS, slab: V.SANDSTONE_SLAB, roofBlock: V.SMOOTH_SANDSTONE, door: [V.OAK_DOOR, OAK_DOOR_RIGHT], fence: V.OAK_FENCE, gate: V.OAK_FENCE_GATE, path: V.SMOOTH_SANDSTONE, top: BLOCK.SAND, fill: BLOCK.SAND, beds: [C.green, C.yellow, C.orange, C.cyan], lamp: "desert", flat: true, accents: [V.YELLOW_TERRACOTTA, V.GREEN_TERRACOTTA, V.ORANGE_TERRACOTTA, V.CYAN_TERRACOTTA, V.RED_TERRACOTTA, V.LIGHT_BLUE_TERRACOTTA], plants: [BLOCK.CACTUS, BLOCK.DEAD_BUSH] },
  savanna: { found: BLOCK.COBBLESTONE, floor: V.ACACIA_PLANKS, wall: V.ACACIA_PLANKS, frame: V.ACACIA_LOG, stairs: V.ACACIA_STAIRS, slab: V.ACACIA_SLAB, roofBlock: V.ACACIA_PLANKS, door: [V.OAK_DOOR, OAK_DOOR_RIGHT], fence: V.ACACIA_FENCE, gate: V.ACACIA_FENCE_GATE, path: V.DIRT_PATH, top: BLOCK.GRASS, fill: BLOCK.DIRT, beds: [C.orange, C.red, C.yellow, C.brown], lamp: "wool", accent: V.ORANGE_TERRACOTTA, plants: [V.ACACIA_SAPLING, BLOCK.FLOWER_YELLOW, BLOCK.FLOWER_RED] },
  taiga: { found: BLOCK.COBBLESTONE, mossy: true, floor: V.SPRUCE_PLANKS, wall: V.SPRUCE_PLANKS, frame: BLOCK.PINE_LOG, stairs: V.SPRUCE_STAIRS, slab: V.SPRUCE_SLAB, roofBlock: V.SPRUCE_PLANKS, door: [V.SPRUCE_DOOR, SPRUCE_DOOR_RIGHT], fence: V.SPRUCE_FENCE, gate: V.SPRUCE_FENCE_GATE, path: V.DIRT_PATH, top: BLOCK.GRASS, fill: BLOCK.DIRT, beds: [C.brown, C.green, C.red, C.gray], lamp: "lantern", plants: [V.FERN, V.SPRUCE_SAPLING, V.BROWN_MUSHROOM] },
  snowy: { found: BLOCK.COBBLESTONE, floor: V.SPRUCE_PLANKS, wall: V.WHITE_TERRACOTTA, frame: BLOCK.PINE_LOG, stairs: V.SPRUCE_STAIRS, slab: V.SPRUCE_SLAB, roofBlock: V.SPRUCE_PLANKS, door: [V.SPRUCE_DOOR, SPRUCE_DOOR_RIGHT], fence: V.SPRUCE_FENCE, gate: V.SPRUCE_FENCE_GATE, path: V.DIRT_PATH, top: SNOWY_GRASS, fill: BLOCK.DIRT, beds: [C.blue, C.light_blue, C.white, C.cyan], lamp: "lantern", snow: true, plants: [V.SPRUCE_SAPLING, V.LILY_OF_THE_VALLEY] },
};

// The pieces: [width along the street, depth from it], how often each comes
// up (houses always; the others at most `max` a village), and its builder.
const PIECES = {
  small: { w: 5, d: 5, weight: 9 },
  medium: { w: 7, d: 6, weight: 7 },
  large: { w: 9, d: 7, weight: 3 },
  farm: { w: 7, d: 9, weight: 5, max: 4 },
  bigfarm: { w: 13, d: 9, weight: 2, max: 2 },
  pen: { w: 7, d: 7, weight: 2, max: 2 },
  library: { w: 9, d: 7, weight: 2, max: 1 },
  temple: { w: 7, d: 10, weight: 2, max: 1 },
  smith: { w: 9, d: 7, weight: 2, max: 1 },
  armorer: { w: 7, d: 6, weight: 1, max: 1 },
  toolsmith: { w: 7, d: 6, weight: 1, max: 1 },
  butcher: { w: 7, d: 6, weight: 1, max: 1 },
  fletcher: { w: 7, d: 6, weight: 1, max: 1 },
  shepherd: { w: 7, d: 6, weight: 1, max: 1 },
  tannery: { w: 7, d: 6, weight: 1, max: 1 },
  mason: { w: 7, d: 6, weight: 1, max: 1 },
  fisher: { w: 5, d: 6, weight: 1, max: 1 },
};
const PIECE_NAMES = Object.keys(PIECES);
// The four facings (building.js's: 0 +Z, 1 -Z, 2 +X, 3 -X).
const FXS = [0, 0, 1, -1];
const FZS = [1, -1, 0, 0];
const facingOf = (dx, dz) => (dx > 0 ? 2 : dx < 0 ? 3 : dz < 0 ? 1 : 0);
const key2 = (x, z) => (x + V_RADIUS) * V_GRID + (z + V_RADIUS);

class VillagePlan {
  constructor(grower, center) {
    this.terrain = grower.terrain;
    this.center = center;
    this.st = STYLE[center.style];
    this.rand = mulberry32((grower.seed ^ Math.imul(center.x, 0x3c6ef372) ^ Math.imul(center.z, 0x0b4f3d2b) ^ 0x7a11a9) >>> 0);
    this.heights = new Int16Array(V_GRID * V_GRID).fill(-1);
    this.occ = new Uint8Array(V_GRID * V_GRID); // 0 free, 1 street, 2 a piece (and its ring), 3 a lamp or decoration
    this.shaping = []; // the ground's changes first (foundations, earth, clearing), then
    this.paths = []; //   the streets, then
    this.blocks = []; //  the pieces and their furnishings
    this.pieces = [];
    this.houses = [];
    this.chests = new Map();
    this.residents = [];
    this.jobs = [];
    this.pens = [];
    this.streetCells = [];
    this.counts = {};
  }

  inside(x, z) {
    return Math.abs(x) <= V_RADIUS - 1 && Math.abs(z) <= V_RADIUS - 1 && x * x + z * z <= (V_RADIUS - 1) * (V_RADIUS - 1);
  }

  // The natural ground's height at (x, z) from the middle (cached).
  ground(x, z) {
    const k = key2(x, z);
    let h = this.heights[k];
    if (h < 0) h = this.heights[k] = this.terrain.heightAt(this.center.x + x, this.center.z + z);
    return h;
  }

  occAt(x, z) {
    return this.inside(x, z) ? this.occ[key2(x, z)] : 255;
  }

  build() {
    this._meetingPoint();
    this._streets();
    this._placePieces();
    this._lamps();
    // Its people: one a bed, at the door of their house; a trade's house's
    // first has its trade, the farms' go to others (the rest: any trade).
    const jobs = this.jobs.slice();
    for (const r of this.residents) if (r.profession < 0 && jobs.length) r.profession = jobs.shift();
    // Trees keep off the streets and the pieces (and a couple of blocks round them).
    const clear = new Uint8Array(V_GRID * V_GRID);
    for (let x = -V_RADIUS; x <= V_RADIUS; x++) {
      for (let z = -V_RADIUS; z <= V_RADIUS; z++) {
        if (!this.occ[key2(x, z)]) continue;
        for (let dx = -2; dx <= 2; dx++) for (let dz = -2; dz <= 2; dz++) if (Math.abs(x + dx) <= V_RADIUS && Math.abs(z + dz) <= V_RADIUS) clear[key2(x + dx, z + dz)] = 1;
      }
    }
    // (kept compact: a worker holds the plans of every village it has met)
    const ops = Int16Array.from(this.shaping.concat(this.paths, this.blocks));
    this.shaping = this.paths = this.blocks = this.heights = null;
    return {
      ops,
      houses: this.houses,
      farms: [],
      lamps: [],
      chests: this.chests,
      residents: this.residents,
      pens: this.pens,
      streetCells: Int16Array.from(this.streetCells),
      pieces: this.pieces.map((p) => ({ kind: p.kind, x: p.ox, z: p.oz, w: p.W, d: p.D, y: p.F })),
      clearAt: (x, z) => Math.abs(x) <= V_RADIUS && Math.abs(z) <= V_RADIUS && clear[key2(x, z)] === 1,
      occAt: (x, z) => this.occAt(x, z),
    };
  }

  // ---------- The meeting point ----------

  _meetingPoint() {
    // A square of path round a well (4 x 4, its 2 x 2 of water 3 deep).
    for (let x = -2; x <= 1; x++) for (let z = -2; z <= 1; z++) this.occ[key2(x, z)] = 2;
    for (let x = -4; x <= 4; x++) for (let z = -4; z <= 4; z++) this._streetCell(x, z);
    const F = Math.max(SEA_LEVEL + 1, Math.round((this.ground(-1, -1) + this.ground(0, 0) + this.ground(-1, 0) + this.ground(0, -1)) / 4));
    const st = this.st;
    const put = (x, y, z, id) => this.blocks.push(x, y, z, id);
    const stone = st.flat ? V.SANDSTONE : BLOCK.COBBLESTONE;
    for (let x = -2; x <= 1; x++) {
      for (let z = -2; z <= 1; z++) {
        for (let y = this.ground(x, z) + 1; y < F; y++) this.shaping.push(x, y, z, stone);
        for (let y = F + 1; y <= F + 6; y++) this.shaping.push(x, y, z, BLOCK.AIR);
        const ring = x === -2 || x === 1 || z === -2 || z === 1;
        if (!ring) {
          for (let y = F - 3; y <= F; y++) put(x, y, z, BLOCK.WATER);
          put(x, F - 4, z, stone);
          continue;
        }
        for (let y = F - 4; y <= F; y++) put(x, y, z, stone);
        const corner = (x === -2 || x === 1) && (z === -2 || z === 1);
        put(x, F + 1, z, stone);
        if (corner) for (let y = F + 2; y <= F + 3; y++) put(x, y, z, st.flat ? V.CUT_SANDSTONE : st.fence);
        put(x, F + 4, z, st.flat ? V.SANDSTONE_SLAB : st.slab);
      }
    }
    // (the roof's middle)
    for (let x = -1; x <= 0; x++) for (let z = -1; z <= 0; z++) put(x, F + 4, z, st.flat ? V.CUT_SANDSTONE : st.roofBlock);
    if (st.lamp === "lantern") put(-1, F + 3, -1, LANTERN_HANGING);
    this.houses.push({ x: -2, z: -2, w: 4, d: 4, h: 3, y: F, door: "z-", kind: "well", wall: stone, roof: st.flat ? V.CUT_SANDSTONE : st.roofBlock });
    // Lamps at the square's corners.
    for (const [x, z] of [[-4, -4], [4, 4], [-4, 4], [4, -4]]) if (this.rand() < 0.6) this._lamp(x, z);
  }

  // ---------- Streets ----------

  // A cell of street at (x, z): path at the ground's height (planks over water).
  _streetCell(x, z) {
    if (!this.inside(x, z) || this.occ[key2(x, z)]) return;
    this.occ[key2(x, z)] = 1;
    const g = this.ground(x, z);
    if (g < SEA_LEVEL) {
      this.paths.push(x, SEA_LEVEL, z, this.st.flat ? V.SMOOTH_SANDSTONE : this.st.roofBlock);
      for (let y = SEA_LEVEL + 1; y <= SEA_LEVEL + 3; y++) this.paths.push(x, y, z, BLOCK.AIR);
      this.streetCells.push(x, SEA_LEVEL, z);
      return;
    }
    this.paths.push(x, g, z, this.st.path);
    for (let y = g + 1; y <= g + 4; y++) this.paths.push(x, y, z, BLOCK.AIR);
    this.streetCells.push(x, g, z);
  }

  _streets() {
    const queue = [];
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) if (this.rand() < 0.9) queue.push({ x: dx * 5, z: dz * 5, dx, dz, depth: 0 });
    this.streets = [];
    for (let n = 0; n < 40 && queue.length; n++) this._street(queue.shift(), queue);
  }

  // One stretch of street from (s.x, s.z) along (s.dx, s.dz), then what comes off it.
  _street(s, queue) {
    const { dx, dz } = s;
    const ax = -dz;
    const az = dx;
    const want = 9 + Math.floor(this.rand() * 15);
    let len = 0;
    let prev = this.ground(s.x, s.z);
    for (let t = 0; t < want; t++) {
      const x = s.x + dx * t;
      const z = s.z + dz * t;
      let ok = true;
      for (let w = -1; w <= 1 && ok; w++) {
        const cx = x + ax * w;
        const cz = z + az * w;
        // (it stops at the edge, at a piece, at another street (joining it) or a step over 2)
        if (!this.inside(cx, cz) || this.occ[key2(cx, cz)] || Math.abs(Math.max(SEA_LEVEL, this.ground(cx, cz)) - Math.max(SEA_LEVEL, prev)) > 2) ok = false;
      }
      // (keep a block clear ahead, unless it meets a street there)
      if (ok && this.occAt(x + dx, z + dz) > 1) ok = false;
      if (!ok) break;
      prev = this.ground(x, z);
      len++;
      for (let w = -1; w <= 1; w++) this._streetCell(x + ax * w, z + az * w);
    }
    if (len < 4) return;
    const seg = { x: s.x, z: s.z, dx, dz, len };
    this.streets.push(seg);
    if (s.depth >= 2) return;
    const ex = s.x + dx * (len - 1);
    const ez = s.z + dz * (len - 1);
    const r = this.rand();
    if (len === want) {
      if (r < 0.45) queue.push({ x: ex + dx, z: ez + dz, dx, dz, depth: s.depth + 1 });
      else {
        // (a turn, or a fork both ways)
        const both = r > 0.8;
        const w = this.rand() < 0.5 ? 1 : -1;
        for (const k of both ? [1, -1] : [w]) queue.push({ x: ex + ax * k * 2, z: ez + az * k * 2, dx: ax * k, dz: az * k, depth: s.depth + 1 });
      }
    }
    // Side streets now and then.
    for (let t = 6; t < len - 5; t += 7 + Math.floor(this.rand() * 6)) {
      if (this.rand() >= 0.2) continue;
      const w = this.rand() < 0.5 ? 1 : -1;
      queue.push({ x: s.x + dx * t + ax * w * 2, z: s.z + dz * t + az * w * 2, dx: ax * w, dz: az * w, depth: s.depth + 2 });
    }
  }

  // ---------- Pieces ----------

  _placePieces() {
    const order = this.streets.slice();
    for (let i = order.length - 1; i > 0; i--) {
      const j = Math.floor(this.rand() * (i + 1));
      [order[i], order[j]] = [order[j], order[i]];
    }
    // (vanilla's villages: a dozen to twenty-odd pieces)
    const most = 12 + Math.floor(this.rand() * 11);
    for (const seg of order) {
      for (const side of [1, -1]) {
        let tries = 0;
        for (let t = Math.floor(this.rand() * 2); t < seg.len && tries < 12 && this.pieces.length < most; tries++) {
          const kind = this._pick();
          const pc = PIECES[kind];
          if (this._tryPiece(seg, side, t, kind, pc.w, pc.d)) {
            this.counts[kind] = (this.counts[kind] || 0) + 1;
            t += pc.w + 2 + Math.floor(this.rand() * 3);
          } else t += 2;
        }
      }
    }
  }

  _pick() {
    let total = 0;
    for (const k of PIECE_NAMES) {
      const pc = PIECES[k];
      if (!pc.max || (this.counts[k] || 0) < pc.max) total += pc.weight;
    }
    let r = this.rand() * total;
    for (const k of PIECE_NAMES) {
      const pc = PIECES[k];
      if (pc.max && (this.counts[k] || 0) >= pc.max) continue;
      if ((r -= pc.weight) < 0) return k;
    }
    return "small";
  }

  // A piece `kind` (W along the street, D deep) on `side` of street `seg`
  // from t along it, if it fits; true if placed.
  _tryPiece(seg, side, t, kind, W, D) {
    const ax = -seg.dz * side;
    const az = seg.dx * side;
    // Its frame: u along the street, v away from it (v 0 is its front, 3 out from the street's middle).
    const p = { kind, W, D, ux: seg.dx, uz: seg.dz, vx: ax, vz: az, ox: seg.x + seg.dx * t + ax * 3, oz: seg.z + seg.dz * t + az * 3 };
    const at = (u, v) => [p.ox + p.ux * u + p.vx * v, p.oz + p.uz * u + p.vz * v];
    // Level with the street at its door.
    const du = (W - 1) >> 1;
    const [sx, sz] = at(du, -2);
    if (this.occAt(sx, sz) !== 1) return false;
    const F = Math.max(SEA_LEVEL + 1, this.ground(sx, sz));
    // Its footprint and a ring round it free, on land within 3 of its floor.
    for (let u = -1; u <= W; u++) {
      for (let v = -1; v <= D; v++) {
        const [x, z] = at(u, v);
        if (this.occAt(x, z)) return false;
        const g = this.ground(x, z);
        if (g <= SEA_LEVEL || Math.abs(g - F) > 3) return false;
      }
    }
    // (and a block more between it and another piece: their eaves never touch)
    for (let u = -2; u <= W + 1; u++) {
      for (let v = -1; v <= D + 1; v++) {
        if (u > -2 && u < W + 1 && v <= D) continue;
        const [x, z] = at(u, v);
        if (this.occAt(x, z) === 2) return false;
      }
    }
    p.F = F;
    p.du = du;
    for (let u = -1; u <= W; u++) {
      for (let v = -1; v <= D; v++) {
        const [x, z] = at(u, v);
        this.occ[key2(x, z)] = 2;
      }
    }
    this.pieces.push(p);
    this._buildPiece(p, at);
    return true;
  }

  // The ground under and round a piece: foundation (`found`) up to its floor
  // under it, earth round it (topped with the land's own top), and air above
  // both up to `top` over the floor.
  _shapeGround(p, at, found, top) {
    const st = this.st;
    for (let u = -1; u <= p.W; u++) {
      for (let v = -1; v <= p.D; v++) {
        const [x, z] = at(u, v);
        const g = this.ground(x, z);
        const ring = u < 0 || v < 0 || u >= p.W || v >= p.D;
        for (let y = g + 1; y < p.F; y++) this.shaping.push(x, y, z, ring ? st.fill : found);
        // (the ring's top: the land's own there, snow and all)
        const land = ring ? this._landTop(x, z) : found;
        this.shaping.push(x, p.F, z, land);
        for (let y = p.F + 1; y <= p.F + top; y++) this.shaping.push(x, y, z, BLOCK.AIR);
        if (land === SNOWY_GRASS) this.shaping.push(x, p.F + 1, z, V.SNOW_LAYER);
      }
    }
  }

  // The land's top block at (x, z) (the terrain's, by its biome: grass, sand, snowy grass...).
  _landTop(x, z) {
    const wx = this.center.x + x;
    const wz = this.center.z + z;
    const id = this.terrain.landTop(wx, wz, this.ground(x, z));
    return id === BLOCK.STONE || id === BLOCK.SNOW ? this.st.top : id;
  }

  _buildPiece(p, at) {
    const st = this.st;
    const rand = this.rand;
    // In the piece's frame: put(u, dy, v, id) with dy over its floor; dir(du, dv) the facing of a direction in it.
    const put = (u, dy, v, id) => {
      const [x, z] = at(u, v);
      this.blocks.push(x, p.F + dy, z, id);
    };
    const dir = (du, dv) => facingOf(p.ux * du + p.vx * dv, p.uz * du + p.vz * dv);
    const vec = (du, dv) => [p.ux * du + p.vx * dv, p.uz * du + p.vz * dv];
    const ctx = { p, at, put, dir, vec, st, rand, plan: this };
    const kind = p.kind;
    if (kind === "farm" || kind === "bigfarm") return this._farm(ctx);
    if (kind === "pen") return this._pen(ctx);
    if (kind === "temple") return this._temple(ctx);
    // A house: the trade's materials, furnishings and chest.
    const spec = HOUSE_SPECS[kind] || HOUSE_SPECS.small;
    this._house(ctx, spec);
  }

  // A building's box for the distant view (distant.js): corner, size along
  // x and z, wall height, floor, materials.
  _record(ctx, h, wall, roof, kind) {
    const { p, at } = ctx;
    const [x0, z0] = at(0, 0);
    const [x1, z1] = at(p.W - 1, p.D - 1);
    this.houses.push({ x: Math.min(x0, x1), z: Math.min(z0, z1), w: Math.abs(x1 - x0) + 1, d: Math.abs(z1 - z0) + 1, h, y: p.F, kind, wall, roof });
  }

  // A chest at (u, dy, v) facing the room's front, rolling loot table `table`.
  _chest(ctx, u, dy, v, table, face = [0, -1]) {
    const [fx, fz] = ctx.vec(face[0], face[1]);
    ctx.put(u, dy, v, chest(fx, fz));
    const [x, z] = ctx.at(u, v);
    this.chests.set(`${x},${ctx.p.F + dy},${z}`, table);
  }

  // A bed along a side wall at u, its head against the back wall.
  _bed(ctx, u, color) {
    const { p, put, dir } = ctx;
    const f = dir(0, 1);
    const base = bedOf(color);
    put(u, 1, p.D - 2, base + f + 4);
    put(u, 1, p.D - 3, base + f);
  }

  // A resident at the piece's door (with trade `job`, or -1: one of the
  // village's free jobs, or any).
  _resident(ctx, job = -1) {
    const [x, z] = ctx.at(ctx.p.du, -1);
    this.residents.push({ x, y: ctx.p.F + 1, z, profession: job });
  }

  // A wall torch at (u, dy, v) hanging on the wall behind it at (u - du, v - dv).
  _torch(ctx, u, dy, v, du, dv) {
    const [fx, fz] = ctx.vec(du, dv);
    ctx.put(u, dy, v, wallTorch(fx, fz));
  }

  // A house: walls round W x D (corners of the frame, a footing of the
  // foundation, windows), a door in the middle of its front, a roof (gable,
  // or flat in the desert), then its spec's furnishings.
  _house(ctx, spec) {
    const { p, put, dir, st, rand } = ctx;
    const W = p.W;
    const D = p.D;
    const H = spec.h ?? (W >= 9 ? 5 : 4);
    const wall = spec.wall?.(st) ?? st.wall;
    const found = spec.found?.(st) ?? st.found;
    const flat = st.flat || spec.flat;
    const roofTop = flat ? H + 2 : H + Math.ceil(Math.min(W, D) / 2) + 2;
    this._shapeGround(p, ctx.at, found, roofTop + 1);
    const du = p.du;
    const mossy = (u, y, v) => (st.mossy && hash2(0x2d7a, u * 31 + v, y + p.ox * 7 + p.oz * 13) < 0.3 ? V.MOSSY_COBBLESTONE : found);
    const accent = st.accents ? st.accents[Math.floor(rand() * st.accents.length)] : st.accent;
    for (let u = 0; u < W; u++) {
      for (let v = 0; v < D; v++) {
        const edge = u === 0 || v === 0 || u === W - 1 || v === D - 1;
        if (!edge) {
          put(u, 0, v, spec.floor?.(st) ?? st.floor);
          continue;
        }
        const corner = (u === 0 || u === W - 1) && (v === 0 || v === D - 1);
        put(u, 0, v, mossy(u, 0, v));
        for (let y = 1; y <= H; y++) {
          let id = corner ? (spec.corner?.(st) ?? st.frame) : y === 1 ? mossy(u, y, v) : wall;
          if (!corner && y === H && accent) id = accent; // (a band of terracotta under the roof: the desert's and the savanna's)
          if (!corner && y === 2 && this._window(u, v, W, D, du)) id = V.GLASS_PANE;
          if (u === du && v === 0 && y <= 2) id = BLOCK.AIR;
          put(u, y, v, id);
        }
      }
    }
    // The door, facing in (vanilla's single door, hinged on its left).
    const inward = dir(0, 1);
    put(du, 1, 0, st.door[0] + inward);
    put(du, 2, 0, st.door[0] + inward + 8);
    // The step out to the street: path.
    put(du, 0, -1, st.path);
    put(du, 1, -1, BLOCK.AIR); // (no snow on the step)
    // The roof.
    const roofBlock = st.flat ? st.roofBlock : spec.roofBlock?.(st) ?? st.roofBlock;
    if (flat) this._flatRoof(ctx, H, roofBlock);
    else this._gableRoof(ctx, H, wall);
    this._record(ctx, H, wall, flat ? roofBlock : st.stairs, p.kind);
    // Torches by the door, outside, and inside on the back wall.
    if (W >= 5) {
      this._torch(ctx, du - 1, 2, -1, 0, -1);
      if (W >= 7 || rand() < 0.5) this._torch(ctx, du + 1, 2, -1, 0, -1);
    }
    this._torch(ctx, du, 3, D - 2, 0, -1);
    spec.furnish(ctx, this);
  }

  _window(u, v, W, D, du) {
    if (v === 0) return W >= 7 && (u === du - 2 || u === du + 2);
    if (v === D - 1) return W >= 7 && (u === 2 || u === W - 3);
    return (u === 0 || u === W - 1) && v >= 2 && v <= D - 3 && (v - 2) % 2 === 0;
  }

  // A gable roof of stairs over the house (an eave out over every side), its
  // ridge along the longer side, the gables filled with `fill`.
  _gableRoof(ctx, H, fill) {
    const { p, put, dir, st } = ctx;
    const alongU = p.W >= p.D;
    const N = alongU ? p.D : p.W; // across
    const M = alongU ? p.W : p.D; // along
    const cell = (a, b) => (alongU ? [b, a] : [a, b]); // (across, along) -> (u, v)
    const up = (s) => (alongU ? dir(0, s) : dir(s, 0)); // a stair rising toward the ridge
    for (let k = 0; ; k++) {
      const y = H + 1 + k;
      const a0 = -1 + k;
      const a1 = N - k;
      if (a0 > a1) break;
      for (let b = -1; b <= M; b++) {
        if (a0 === a1) {
          const [u, v] = cell(a0, b);
          put(u, y, v, st.slab);
          continue;
        }
        let [u, v] = cell(a0, b);
        put(u, y, v, st.stairs + up(1));
        [u, v] = cell(a1, b);
        put(u, y, v, st.stairs + up(-1));
        // The gables: the end walls' triangles.
        if (b === 0 || b === M - 1) {
          for (let a = a0 + 1; a < a1; a++) {
            const [gu, gv] = cell(a, b);
            put(gu, y, gv, fill);
          }
        }
      }
      if (a1 - a0 <= 1) break;
    }
  }

  // A flat roof over the walls (and a rim of slabs in the desert).
  _flatRoof(ctx, H, block) {
    const { p, put, st } = ctx;
    for (let u = 0; u < p.W; u++) {
      for (let v = 0; v < p.D; v++) {
        put(u, H + 1, v, block);
        if (st.flat && (u === 0 || v === 0 || u === p.W - 1 || v === p.D - 1)) put(u, H + 2, v, V.SANDSTONE_SLAB);
      }
    }
  }

  // ---------- Farms and pens ----------

  _farm(ctx) {
    const { p, put, st, rand } = ctx;
    this._shapeGround(p, ctx.at, st.fill, 3);
    const crops = [[V.WHEAT_CROP, 8], [V.WHEAT_CROP, 8], [V.WHEAT_CROP, 8], [V.CARROTS, 4], [V.POTATOES, 4], [V.BEETROOTS, 4]];
    const [crop, stages] = crops[Math.floor(rand() * crops.length)];
    const water = p.W >= 13 ? [4, 8] : [3];
    const border = st.flat ? V.CUT_SANDSTONE : st.frame;
    for (let u = 0; u < p.W; u++) {
      for (let v = 0; v < p.D; v++) {
        if (u === 0 || v === 0 || u === p.W - 1 || v === p.D - 1) {
          put(u, 0, v, border);
          continue;
        }
        if (water.includes(u)) {
          put(u, 0, v, BLOCK.WATER);
          put(u, -1, v, st.fill === BLOCK.SAND ? V.SANDSTONE : BLOCK.DIRT);
          continue;
        }
        put(u, 0, v, V.FARMLAND + 1);
        put(u, 1, v, crop + Math.floor(rand() * stages));
      }
    }
    // (the composter, at a corner of the border: the farmer's job)
    put(p.W - 1, 1, 0, V.COMPOSTER);
    this.jobs.push(JOB.farmer);
  }

  _pen(ctx) {
    const { p, put, dir, st, rand } = ctx;
    this._shapeGround(p, ctx.at, st.fill, 3);
    for (let u = 0; u < p.W; u++) {
      for (let v = 0; v < p.D; v++) {
        put(u, 0, v, st.top);
        if (u === 0 || v === 0 || u === p.W - 1 || v === p.D - 1) put(u, 1, v, u === p.du && v === 0 ? st.gate + dir(0, 1) : st.fence);
      }
    }
    put(p.W - 2, 1, p.D - 2, V.HAY_BLOCK);
    if (rand() < 0.5) put(p.W - 2, 2, p.D - 2, V.HAY_BLOCK);
    put(p.du, 0, -1, st.path);
    const [x, z] = ctx.at(p.du, (p.D - 1) >> 1);
    const animals = st.flat ? ["sheep", "cow"] : ["sheep", "cow", "pig"];
    this.pens.push({ x, y: p.F + 1, z, r: (p.W - 3) >> 1, animal: animals[Math.floor(rand() * animals.length)] });
  }

  // ---------- The church ----------

  // Cobblestone (sandstone in the desert) walls 6 high under a roof, a tower
  // at the back 5 higher with open windows; inside, the cleric's brewing
  // stand on an altar and a chest.
  _temple(ctx) {
    const { p, put, dir, st } = ctx;
    const W = p.W;
    const D = p.D;
    const stone = st.flat ? V.SANDSTONE : BLOCK.COBBLESTONE;
    const H = 6;
    const T = 11; // the tower's top
    const tower = (v) => v >= D - 4;
    this._shapeGround(p, ctx.at, stone, T + 3);
    for (let u = 0; u < W; u++) {
      for (let v = 0; v < D; v++) {
        const edge = u === 0 || v === 0 || u === W - 1 || v === D - 1;
        const tEdge = tower(v) && (u === 1 || u === W - 2 || v === D - 4 || v === D - 1);
        put(u, 0, v, edge ? stone : st.flat ? V.SMOOTH_SANDSTONE : BLOCK.COBBLESTONE);
        if (edge) {
          for (let y = 1; y <= H; y++) {
            let id = stone;
            if ((u === 0 || u === W - 1) && (y === 3 || y === 4) && v % 3 === 1 && v < D - 1) id = V.GLASS_PANE;
            if (u === p.du && v === 0 && y <= 2) id = BLOCK.AIR;
            put(u, y, v, id);
          }
        }
        // The tower above the back.
        if (tower(v) && u >= 1 && u <= W - 2) {
          for (let y = H + 1; y <= T; y++) {
            const open = tEdge && y >= T - 2 && y < T && (u === p.du || v === D - 2 || v === D - 3);
            put(u, y, v, tEdge && !open ? stone : BLOCK.AIR);
          }
          put(u, T + 1, v, u === 1 || u === W - 2 || v === D - 4 || v === D - 1 ? (st.flat ? V.SANDSTONE_SLAB : V.COBBLESTONE_SLAB) : stone);
          // (its floor over the nave: the walls' top)
          if (!edge) put(u, H, v, stone);
        }
      }
    }
    // The nave's roof: stairs over its front part, rising to a ridge along it.
    const stairs = st.flat ? V.SANDSTONE_STAIRS : V.COBBLESTONE_STAIRS;
    for (let k = 0; ; k++) {
      const a0 = -1 + k;
      const a1 = W - k;
      if (a0 > a1) break;
      for (let v = -1; v < D - 4; v++) {
        const y = H + 1 + k;
        if (a0 === a1) {
          put(a0, y, v, st.flat ? V.SANDSTONE_SLAB : V.COBBLESTONE_SLAB);
          continue;
        }
        put(a0, y, v, stairs + dir(1, 0));
        put(a1, y, v, stairs + dir(-1, 0));
        if (v === 0) for (let u = a0 + 1; u < a1; u++) put(u, y, v, stone);
      }
      if (a1 - a0 <= 1) break;
    }
    const inward = dir(0, 1);
    put(p.du, 1, 0, st.door[0] + inward);
    put(p.du, 2, 0, st.door[0] + inward + 8);
    put(p.du, 0, -1, st.path);
    // The altar, the brewing stand on it, a chest beside.
    put(p.du, 1, D - 3, stone);
    put(p.du, 2, D - 3, V.BREWING_STAND);
    this._chest(ctx, p.du - 2, 1, D - 2, "village_temple");
    // Benches: stairs facing the altar.
    for (let v = 2; v <= D - 6; v += 2) {
      put(1, 1, v, st.stairs + dir(0, -1));
      put(W - 2, 1, v, st.stairs + dir(0, -1));
    }
    this._torch(ctx, p.du - 1, 2, -1, 0, -1);
    this._torch(ctx, p.du + 1, 2, -1, 0, -1);
    this._torch(ctx, 1, 4, 2, 1, 0);
    this._torch(ctx, W - 2, 4, 2, -1, 0);
    this._resident(ctx, JOB.cleric);
    this._record(ctx, H, stone, stone, "temple");
  }

  // ---------- Lamps ----------

  _lamps() {
    for (const seg of this.streets) {
      const ax = -seg.dz;
      const az = seg.dx;
      let side = this.rand() < 0.5 ? 1 : -1;
      for (let t = 3 + Math.floor(this.rand() * 6); t < seg.len; t += 11 + Math.floor(this.rand() * 5)) {
        const x = seg.x + seg.dx * t + ax * side * 2;
        const z = seg.z + seg.dz * t + az * side * 2;
        if (!this._lamp(x, z)) {
          const x2 = seg.x + seg.dx * t - ax * side * 2;
          const z2 = seg.z + seg.dz * t - az * side * 2;
          this._lamp(x2, z2);
        }
        side = -side;
      }
      // Hay bales by the street now and then (not in the desert).
      if (!this.st.flat && this.rand() < 0.25) {
        const t = Math.floor(this.rand() * seg.len);
        const s2 = this.rand() < 0.5 ? 2 : -2;
        const x = seg.x + seg.dx * t + ax * s2;
        const z = seg.z + seg.dz * t + az * s2;
        if (this.occAt(x, z) === 0 && this.ground(x, z) > SEA_LEVEL) {
          this.occ[key2(x, z)] = 3;
          const g = this.ground(x, z);
          this.blocks.push(x, g + 1, z, V.HAY_BLOCK);
          if (this.rand() < 0.5) this.blocks.push(x, g + 2, z, V.HAY_BLOCK);
        }
      }
    }
  }

  // A lamp post at (x, z) if the cell is free and dry; true if it stands.
  _lamp(x, z) {
    if (this.occAt(x, z) === 255) return false;
    const o = this.occ[key2(x, z)];
    const g = this.ground(x, z);
    if (g <= SEA_LEVEL || (o !== 0 && !(o === 1 && Math.max(Math.abs(x), Math.abs(z)) === 4))) return false;
    if (o === 0) this.occ[key2(x, z)] = 3;
    const st = this.st;
    const put = (y, id) => this.blocks.push(x, g + y, z, id);
    for (let y = 1; y <= 4; y++) put(y, BLOCK.AIR);
    if (st.lamp === "wool") {
      // (vanilla's old street lamp: fence posts, a block of black wool, a torch on each side)
      for (let y = 1; y <= 3; y++) put(y, st.fence);
      put(4, V.BLACK_WOOL);
      for (let f = 0; f < 4; f++) if (this.occAt(x + FXS[f], z + FZS[f]) !== 2) this.blocks.push(x + FXS[f], g + 4, z + FZS[f], wallTorch(FXS[f], FZS[f]));
    } else if (st.lamp === "desert") {
      put(1, V.CUT_SANDSTONE);
      put(2, V.CHISELED_SANDSTONE);
      put(3, V.LANTERN);
    } else {
      put(1, st.frame);
      put(2, st.fence);
      put(3, V.LANTERN);
    }
    return true;
  }
}

// Each house kind's furnishings (and its materials where they differ):
// furnish(ctx, plan) puts the beds, the job's block, the chest...
const HOUSE_SPECS = {
  small: {
    furnish(ctx, plan) {
      const { p, put, rand, st } = ctx;
      plan._bed(ctx, 1, st.beds[Math.floor(rand() * st.beds.length)]);
      plan._resident(ctx);
      if (rand() < 0.6) plan._chest(ctx, p.W - 2, 1, p.D - 2, `village_${plan.center.style}_house`);
      else put(p.W - 2, 1, p.D - 2, BLOCK.CRAFTING_TABLE);
      if (rand() < 0.5) put(p.W - 2, 1, 1, pottedOf(st.plants[Math.floor(rand() * st.plants.length)]) || BLOCK.AIR);
    },
  },
  medium: {
    furnish(ctx, plan) {
      const { p, put, rand, st } = ctx;
      plan._bed(ctx, 1, st.beds[Math.floor(rand() * st.beds.length)]);
      plan._bed(ctx, p.W - 2, st.beds[Math.floor(rand() * st.beds.length)]);
      plan._resident(ctx);
      plan._resident(ctx);
      plan._chest(ctx, p.du + 1, 1, p.D - 2, `village_${plan.center.style}_house`);
      put(p.du - 1, 1, p.D - 2, BLOCK.CRAFTING_TABLE);
      if (rand() < 0.6) put(1, 1, 1, pottedOf(st.plants[Math.floor(rand() * st.plants.length)]) || BLOCK.AIR);
      if (rand() < 0.5) put(p.du, 1, (p.D - 1) >> 1, V.WHITE_CARPET + st.beds[0]);
    },
  },
  large: {
    h: 5,
    furnish(ctx, plan) {
      const { p, put, rand, st, dir } = ctx;
      for (const u of [1, 3, p.W - 2]) {
        plan._bed(ctx, u, st.beds[Math.floor(rand() * st.beds.length)]);
        plan._resident(ctx);
      }
      plan._chest(ctx, p.W - 4, 1, p.D - 2, `village_${plan.center.style}_house`);
      put(p.W - 2, 1, 1, BLOCK.CRAFTING_TABLE);
      put(p.W - 3, 1, 1, V.FURNACE + dir(0, 1));
      put(1, 1, 1, pottedOf(st.plants[Math.floor(rand() * st.plants.length)]) || BLOCK.AIR);
      for (let u = 2; u <= p.W - 3; u++) if (u !== p.du) put(u, 1, (p.D - 1) >> 1, V.WHITE_CARPET + st.beds[1]);
      ctx.plan._torch(ctx, 1, 3, 2, 1, 0);
    },
  },
  // The library: bookshelves along the walls, the lectern, windows high up.
  library: {
    h: 5,
    furnish(ctx, plan) {
      const { p, put, st } = ctx;
      for (let u = 1; u < p.W - 1; u++) {
        for (const y of [1, 2]) put(u, y, p.D - 2, V.BOOKSHELF);
      }
      for (let v = 2; v < p.D - 2; v++) {
        for (const y of [1, 2]) {
          put(1, y, v, V.BOOKSHELF);
          put(p.W - 2, y, v, V.BOOKSHELF);
        }
      }
      put(p.du - 2, 1, 1, V.LECTERN + ctx.dir(0, 1));
      put(p.du, 1, (p.D - 1) >> 1, V.WHITE_CARPET + C.red);
      put(p.du, 1, ((p.D - 1) >> 1) + 1, V.WHITE_CARPET + C.red);
      plan._resident(ctx, JOB.librarian);
      void st;
    },
  },
  // The blacksmith (weaponsmith): stone walls, a flat roof of slabs, two
  // furnaces, the grindstone, a crafting table and its chest.
  smith: {
    flat: true,
    wall: () => BLOCK.COBBLESTONE,
    corner: () => BLOCK.COBBLESTONE,
    floor: () => BLOCK.COBBLESTONE,
    roofBlock: () => V.STONE_SLAB,
    furnish(ctx, plan) {
      const { p, put, dir } = ctx;
      put(1, 1, p.D - 2, V.FURNACE + dir(0, -1));
      put(2, 1, p.D - 2, V.FURNACE + dir(0, -1));
      put(p.W - 2, 1, p.D - 2, V.GRINDSTONE + (dir(1, 0) < 2 ? 1 : 0));
      put(p.W - 2, 1, 1, BLOCK.CRAFTING_TABLE);
      plan._chest(ctx, p.du + 1, 1, p.D - 2, "village_weaponsmith");
      plan._resident(ctx, JOB.weaponsmith);
    },
  },
  armorer: {
    wall: (st) => (st.flat ? st.wall : BLOCK.COBBLESTONE),
    furnish(ctx, plan) {
      const { p, put, dir, rand, st } = ctx;
      put(1, 1, p.D - 2, V.BLAST_FURNACE + dir(0, -1));
      plan._chest(ctx, 2, 1, p.D - 2, "village_armorer");
      plan._bed(ctx, p.W - 2, st.beds[Math.floor(rand() * st.beds.length)]);
      plan._resident(ctx, JOB.armorer);
    },
  },
  toolsmith: {
    furnish(ctx, plan) {
      const { p, put, rand, st } = ctx;
      put(1, 1, p.D - 2, V.SMITHING_TABLE); // (Round 12: the Nether's smithing table, js/content/nether.js)
      plan._chest(ctx, 2, 1, p.D - 2, "village_toolsmith");
      plan._bed(ctx, p.W - 2, st.beds[Math.floor(rand() * st.beds.length)]);
      plan._resident(ctx, JOB.toolsmith);
    },
  },
  butcher: {
    wall: (st) => (st.flat ? st.wall : BLOCK.COBBLESTONE),
    furnish(ctx, plan) {
      const { p, put, dir, rand, st } = ctx;
      put(1, 1, p.D - 2, V.SMOKER + dir(0, -1));
      put(2, 1, p.D - 2, V.HAY_BLOCK);
      plan._chest(ctx, p.W - 2, 1, 1, "village_butcher", [-1, 0]);
      plan._bed(ctx, p.W - 2, st.beds[Math.floor(rand() * st.beds.length)]);
      plan._resident(ctx, JOB.butcher);
    },
  },
  fletcher: {
    furnish(ctx, plan) {
      const { p, put, rand, st } = ctx;
      put(p.W - 2, 1, p.D - 2, V.FLETCHING_TABLE);
      plan._chest(ctx, p.W - 3, 1, p.D - 2, "village_fletcher");
      plan._bed(ctx, 1, st.beds[Math.floor(rand() * st.beds.length)]);
      plan._resident(ctx, JOB.fletcher);
    },
  },
  shepherd: {
    furnish(ctx, plan) {
      const { p, put, rand, st, dir } = ctx;
      put(p.W - 2, 1, p.D - 2, V.LOOM + dir(0, -1));
      put(p.W - 3, 1, p.D - 2, V.LIGHT_GRAY_WOOL);
      plan._chest(ctx, p.W - 2, 1, 1, "village_shepherd", [-1, 0]);
      plan._bed(ctx, 1, st.beds[Math.floor(rand() * st.beds.length)]);
      plan._resident(ctx, JOB.shepherd);
    },
  },
  tannery: {
    furnish(ctx, plan) {
      const { p, put, rand, st } = ctx;
      put(p.W - 2, 1, p.D - 2, V.CAULDRON + 3);
      plan._chest(ctx, p.W - 3, 1, p.D - 2, "village_tannery");
      plan._bed(ctx, 1, st.beds[Math.floor(rand() * st.beds.length)]);
      plan._resident(ctx, JOB.leatherworker);
    },
  },
  mason: {
    wall: (st) => (st.flat ? V.CUT_SANDSTONE : V.STONE_BRICKS),
    furnish(ctx, plan) {
      const { p, put, rand, st, dir } = ctx;
      put(p.W - 2, 1, p.D - 2, V.STONECUTTER + (dir(0, -1) < 2 ? 0 : 1));
      plan._chest(ctx, p.W - 3, 1, p.D - 2, "village_mason");
      plan._bed(ctx, 1, st.beds[Math.floor(rand() * st.beds.length)]);
      plan._resident(ctx, JOB.mason);
    },
  },
  fisher: {
    furnish(ctx, plan) {
      const { p, put, rand, st } = ctx;
      put(p.W - 2, 1, p.D - 2, V.BARREL);
      plan._chest(ctx, p.W - 2, 1, 1, "village_fisher", [-1, 0]);
      plan._bed(ctx, 1, st.beds[Math.floor(rand() * st.beds.length)]);
      plan._resident(ctx, JOB.fisherman);
    },
  },
};
