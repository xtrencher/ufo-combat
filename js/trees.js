// Procedural trees: where they grow, which species, and their shapes. Pure
// JS (no three.js), shared by terrain generation, the distant-terrain
// worker and the unit tests.
//
// Species:
//   oak      a short trunk under an irregular crown of 2-3 overlapping blobs,
//            sometimes with a branch reaching into a side blob
//   birch    a tall, slender white trunk with a narrow crown
//   pine     a tall dark trunk with tiered, tapering rings of needles (on
//            high ground and in pine groves)
//   old oak  rare, in dense forests: a 2x2 trunk, roots spreading over the
//            ground, big crooked branches and a huge crown
// (Round 11) In a Survival world's terrain (terrain.options.vanilla) also:
//   jungle   a tall trunk hung with vines under a small crown
// (Round 12) and, as vanilla's jungles:
//   giant jungle  a 2x2 trunk 10-31 tall under a wide, flat canopy, its
//            branches ending in tufts of leaves, vines all over
//   jungle bush  a jungle log at the ground in a mound of oak leaves
// with vines hanging from the jungle trees' leaves.
//   acacia   the savanna's: a trunk that bends off sideways under flat,
//            wide layers of leaves, sometimes a second branch
//   dark oak a 2x2 trunk under a wide, low canopy (dark forests)
// and saplings grow into these shapes (saplingShape).
// Forests and meadows follow a low-frequency noise field; birches and pines
// grow in groves, and pines also take over high ground. Trees keep a minimum distance from each
// other (the one with the lower placement hash wins, which is symmetric and
// needs no generation order). Crowns may reach across chunk borders: every
// chunk places all trees whose reach overlaps it, in one fixed order, so
// each chunk gets exactly its share of every tree.
import { hash2, mulberry32 } from "./noise.js";
import { BLOCK, IS_LEAVES, IS_REPLACEABLE, IS_WET, IS_SOLID } from "./blocks.js";
import { CHUNK_SIZE, WORLD_HEIGHT, SEA_LEVEL } from "./constants.js";
import { BIOME } from "./biomes.js";
import { VILLAGE_REACH } from "./village.js";
import { JUNGLE_LOG, ACACIA_LOG, DARK_OAK_LOG, JUNGLE_LEAVES, ACACIA_LEAVES, DARK_OAK_LEAVES, VINE, MYCELIUM, FARMLAND } from "./content/ids.js";
import { SNOWY_GRASS, COCOA, COCOA_AGES, isCocoa } from "./content/nature.js";

export const TREE = Object.freeze({ OAK: 1, BIRCH: 2, PINE: 3, OLD_OAK: 4, JUNGLE: 5, ACACIA: 6, DARK_OAK: 7, MEGA_JUNGLE: 8, BUSH: 9 });
export const TREE_NAMES = { 1: "oak", 2: "birch", 3: "pine", 4: "old oak", 5: "jungle", 6: "acacia", 7: "dark oak", 8: "giant jungle", 9: "jungle bush" };
// No block of a tree is farther than this from its root column.
export const TREE_REACH = 9;

const PLACE_SALT = 0x2c1b3c6d;
const KIND_SALT = 0x297a2d39;
const MAX_DENSITY = 0.026;
// (Round 12) A Survival world's jungles are denser: up to this per column
// (vanilla's jungle floor is thick with bushes under the big trees).
const JUNGLE_DENSITY = 0.05;
const SPACING = { 1: 2, 2: 2, 3: 2, 4: 5, 5: 2, 6: 3, 7: 3, 8: 5, 9: 1 };
// (2x2 trunks: their root column is the trunk's -X -Z quarter)
const WIDE = { 4: true, 7: true, 8: true };

// Biomes with no trees at all.
const NO_TREE_BIOMES = new Set([BIOME.DESERT, BIOME.BADLANDS, BIOME.SNOWY_PLAINS, BIOME.MOUNTAINS, BIOME.BEACH, BIOME.OCEAN, BIOME.WARM_OCEAN, BIOME.DEEP_OCEAN, BIOME.RIVER]);
// Density multiplier per biome (<=1, since MAX_DENSITY is the global cap):
// open savanna and plains are sparse, swamps sparser still, jungles and dark
// forests are the densest.
const BIOME_DENSITY = {
  [BIOME.JUNGLE]: 1,
  [BIOME.MEADOW]: 0.05, // a lone tree here and there in the flowers
  [BIOME.DARK_FOREST]: 0.95,
  [BIOME.FOREST]: 0.7,
  [BIOME.BIRCH_FOREST]: 0.7,
  [BIOME.TAIGA]: 0.65,
  [BIOME.SNOWY_TAIGA]: 0.5,
  [BIOME.SWAMP]: 0.32,
  [BIOME.PLAINS]: 0.4,
  [BIOME.SAVANNA]: 0.14,
};
const LOG = { 1: BLOCK.WOOD, 2: BLOCK.BIRCH_LOG, 3: BLOCK.PINE_LOG, 4: BLOCK.WOOD, 5: JUNGLE_LOG, 6: ACACIA_LOG, 7: DARK_OAK_LOG, 8: JUNGLE_LOG, 9: JUNGLE_LOG };
// (a jungle bush's leaves are oak's, as vanilla's)
const LEAF = { 1: BLOCK.LEAVES, 2: BLOCK.BIRCH_LEAVES, 3: BLOCK.PINE_LEAVES, 4: BLOCK.LEAVES, 5: JUNGLE_LEAVES, 6: ACACIA_LEAVES, 7: DARK_OAK_LEAVES, 8: JUNGLE_LEAVES, 9: BLOCK.LEAVES };
// Branches and roots show bark all round (no sawn-off rings).
const BARK = { 1: BLOCK.OAK_BARK, 2: BLOCK.BIRCH_LOG, 3: BLOCK.PINE_LOG, 4: BLOCK.OAK_BARK, 5: JUNGLE_LOG, 6: ACACIA_LOG, 7: DARK_OAK_LOG, 8: JUNGLE_LOG, 9: JUNGLE_LOG };
// A sapling's tree (saplingShape).
const SAPLING_SPECIES = { oak: 1, birch: 2, spruce: 3, jungle: 5, acacia: 6, dark_oak: 7, mega_jungle: 8 };
// A vine on the side of a trunk: VINE + the side its wall is on (+Z, -Z,
// +X, -X: js/content/nature.js's order).
const isVine = (id) => id >= VINE && id < VINE + 4;
// (the walls of the vines' and cocoa pods' ids: +Z, -Z, +X, -X)
const FACINGS4 = [[0, 1], [0, -1], [1, 0], [-1, 0]];
// Ground a grown trunk turns to dirt.
const SOIL_TO_DIRT = new Set([BLOCK.GRASS, MYCELIUM, FARMLAND, FARMLAND + 1, SNOWY_GRASS]);

// Small integer hash in [0, 1) for per-voxel jitter.
function hash3(seed, x, y, z) {
  let h = (seed | 0) ^ Math.imul(x | 0, 374761393) ^ Math.imul(y | 0, 1103515245) ^ Math.imul(z | 0, 668265263);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

// (Round 12) Vanilla's LeaveVineDecorator: beside a jungle tree's leaves,
// on a side that is open, a vine one time in four, hanging down up to 4 more
// blocks (never through the tree itself or below its ground).
function leafVines(out, root, seed) {
  const leaves = [];
  const solid = new Set();
  for (let i = 0; i < out.length; i += 4) {
    const key = `${out[i]},${out[i + 1]},${out[i + 2]}`;
    if (out[i + 3] === root.leaf) leaves.push(out[i], out[i + 1], out[i + 2]);
    solid.add(key);
  }
  const vines = new Set();
  for (let i = 0; i < leaves.length; i += 3) {
    const x = leaves[i];
    const y = leaves[i + 1];
    const z = leaves[i + 2];
    FACINGS4.forEach(([dx, dz], f) => {
      const vx = x + dx;
      const vz = z + dz;
      if (solid.has(`${vx},${y},${vz}`) || hash3(seed ^ 0x51a7, vx * 4 + f, y, vz) >= 0.25) return;
      // (its wall, the leaf, is the other way: FACINGS4's opposite, f ^ 1)
      for (let k = 0; k <= 4; k++) {
        const vy = y - k;
        const key = `${vx},${vy},${vz}`;
        if (vy < 0 || solid.has(key)) break;
        if (vines.has(key)) continue;
        vines.add(key);
        out.push(vx, vy, vz, VINE + (f ^ 1));
      }
    });
  }
}

export class TreeGrower {
  // terrain: the TerrainGenerator (heightAt, isCarved, noise).
  constructor(terrain) {
    this.terrain = terrain;
    this.seed = terrain.seed;
    this.noise = terrain.noise;
    this._roots = new Map(); // "x,z" -> root or null (cache)
    this._shapes = new Map(); // "x,z" -> flat [dx, dy, dz, id, ...] (cache)
    this._cands = new Map(); // "x,z" -> candidate or null (cache: the spacing checks ask for each many times)
    // (Round 12) A Survival world's terrain: its dense jungles.
    this.vanilla = !!terrain.options?.vanilla;
    this._maxDensity = this.vanilla ? JUNGLE_DENSITY : MAX_DENSITY;
  }

  // Trees per column here: open areas with none, sparse single trees, and
  // dense forests, following a low-frequency noise field.
  _density(wx, wz) {
    const forest = this.noise.perlin2(wx * 0.011 + 17.3, wz * 0.011 - 9.1);
    const t = Math.min(1, Math.max(0, (forest + 0.12) / 0.62));
    const density = t <= 0 ? 0 : 0.0006 + (MAX_DENSITY - 0.0006) * t * t * (3 - 2 * t);
    return { density, forest };
  }

  // A column that may hold a tree (before spacing and ground checks):
  // { r, species, h } or null.
  _candidate(wx, wz) {
    const r = hash2((this.seed ^ PLACE_SALT) >>> 0, wx, wz);
    if (r >= this._maxDensity) return null;
    const key = `${wx},${wz}`;
    const known = this._cands.get(key);
    if (known !== undefined) return known;
    const c = this._findCandidate(wx, wz, r);
    if (this._cands.size > 40000) this._cands.clear();
    this._cands.set(key, c);
    return c;
  }

  _findCandidate(wx, wz, r) {
    // (the jungle's extra share: only where the climate is a jungle's, a cheap look first)
    if (r >= MAX_DENSITY && !this.terrain.biomes.hotWet(wx, wz)) return null;
    // No trees on airports and in cities (or leaning over them).
    if (this.terrain.sites.covers(wx, wz, 8)) return null;
    // Nor on a village's pad (it clears only so high above its ground: the
    // crown of a tree rooted on higher ground there was left floating).
    // (Round 12) A Survival world's village keeps its trees but off its
    // streets and buildings.
    const vg = this.terrain.villages;
    if (this.vanilla) {
      if (vg?.blocksTree(wx, wz) || this.terrain.structures?.blocksTree(wx, wz)) return null;
    } else {
      const v = vg?.nearestVillage(wx, wz, VILLAGE_REACH + 8);
      if (v && (v.x - wx) ** 2 + (v.z - wz) ** 2 <= (VILLAGE_REACH + 6) ** 2) return null;
    }
    // (the terrain info once, for both the height and the biome)
    const info = this.terrain._terrainInfo(wx, wz);
    const h = info.height;
    if (h <= SEA_LEVEL + 1 || h >= WORLD_HEIGHT - 16) return null;
    const biome = this.terrain.biomes.biomeAt(wx, wz, h, info.mountainT, info.river, info.flat);
    if (NO_TREE_BIOMES.has(biome)) return null;
    const k = hash2((this.seed ^ KIND_SALT) >>> 0, wx, wz);
    // (Round 12) A Survival world's jungle, as vanilla's: thick everywhere,
    // a third of its trees giants and half of them bushes (the giants'
    // spacing leaves fewer of them); thinner at its edges (the sparse
    // jungle: no giants there).
    if (this.vanilla && biome === BIOME.JUNGLE) {
      const deep = this.terrain.biomes.jungleDepth(wx, wz);
      if (r >= JUNGLE_DENSITY * (0.3 + 0.7 * deep)) return null;
      let species;
      if (deep > 0.4) species = k < 0.12 ? TREE.MEGA_JUNGLE : k < 0.4 ? TREE.JUNGLE : k < 0.47 ? TREE.OAK : TREE.BUSH;
      else species = k < 0.35 ? TREE.JUNGLE : k < 0.45 ? TREE.OAK : TREE.BUSH;
      return { r, species, h };
    }
    if (r >= MAX_DENSITY) return null;
    const { density, forest } = this._density(wx, wz);
    const scaled = density * (BIOME_DENSITY[biome] ?? 1);
    if (scaled <= 0 || r >= scaled) return null;
    let species = TREE.OAK;
    // (Round 11) A Survival world's jungles, savannas and dark forests grow their own woods.
    if (this.terrain.options?.vanilla) {
      if (biome === BIOME.SAVANNA) species = k < 0.8 ? TREE.ACACIA : TREE.OAK;
      else if (biome === BIOME.DARK_FOREST) species = k < 0.75 ? TREE.DARK_OAK : k < 0.85 ? TREE.BIRCH : TREE.OAK;
      if (species !== TREE.OAK || biome === BIOME.SAVANNA || biome === BIOME.DARK_FOREST) return { r, species, h };
    }
    if (biome === BIOME.TAIGA || biome === BIOME.SNOWY_TAIGA) species = TREE.PINE;
    else if (biome === BIOME.BIRCH_FOREST) species = TREE.BIRCH;
    else if (biome === BIOME.DARK_FOREST && k < 0.22) species = TREE.OLD_OAK;
    else if (biome === BIOME.JUNGLE && k < 0.35) species = TREE.OLD_OAK; // the jungle's giants
    else if ((biome === BIOME.FOREST || biome === BIOME.PLAINS) && forest > 0.28 && k < 0.12) species = TREE.OLD_OAK;
    return { r, species, h };
  }

  // The tree rooted in column (wx, wz): { x, z, h, species, log, leaf } or null.
  rootAt(wx, wz) {
    // Most columns are rejected by their hash alone (no caching needed).
    if (hash2((this.seed ^ PLACE_SALT) >>> 0, wx, wz) >= this._maxDensity) return null;
    const key = `${wx},${wz}`;
    if (this._roots.has(key)) return this._roots.get(key);
    let root = null;
    const c = this._candidate(wx, wz);
    if (c && !this.terrain.isCarved(wx, c.h, wz)) {
      // Keep clear of stronger neighbours (lower hash wins).
      let clear = true;
      const R = SPACING[TREE.OLD_OAK];
      for (let dz = -R; dz <= R && clear; dz++) {
        for (let dx = -R; dx <= R; dx++) {
          if (dx === 0 && dz === 0) continue;
          const d2 = dx * dx + dz * dz;
          if (d2 > R * R) continue;
          const o = this._candidate(wx + dx, wz + dz);
          if (!o) continue;
          // (a bush keeps clear of trunks only: it grows in under the big trees)
          const need = c.species === TREE.BUSH || o.species === TREE.BUSH ? (WIDE[c.species] || WIDE[o.species] ? 3 : 2) : Math.max(SPACING[c.species], SPACING[o.species]);
          if (d2 <= need * need && (o.r < c.r || (o.r === c.r && (dx < 0 || (dx === 0 && dz < 0))))) {
            clear = false;
            break;
          }
        }
      }
      if (clear) root = { x: wx, z: wz, h: c.h, species: c.species, log: LOG[c.species], bark: BARK[c.species], leaf: LEAF[c.species], wide: !!WIDE[c.species] };
    }
    if (this._roots.size > 20000) this._roots.clear();
    this._roots.set(key, root);
    return root;
  }

  // Blocks of a tree, relative to the block above its ground: flat
  // Int16Array [dx, dy, dz, id, ...] (16-bit block ids). dy = -1 is the
  // ground block itself (roots).
  shape(root) {
    const key = `${root.x},${root.z}`;
    let s = this._shapes.get(key);
    if (s) return s;
    const rand = mulberry32((this.seed ^ Math.imul(root.x, 0x9e3779b1) ^ Math.imul(root.z, 0x85ebca6b) ^ 0x51f15e) >>> 0);
    s = this._build(root, rand);
    if (this._shapes.size > 600) this._shapes.clear();
    this._shapes.set(key, s);
    return s;
  }

  // (Round 11) The tree a sapling of `kind` ("oak", "spruce", "birch",
  // "jungle", "acacia", "dark_oak", "mega_jungle": the last two from four
  // saplings, rooted at the -X -Z one) grows into at (wx, wz): { root, shape }
  // (shape as for shape(); never cached: a grown tree differs from what the
  // terrain would put there), or null for an unknown kind. `salt` varies it.
  saplingShape(kind, wx, wz, salt = 0) {
    const species = SAPLING_SPECIES[kind];
    if (!species) return null;
    const root = { x: wx, z: wz, h: 0, species, log: LOG[species], bark: BARK[species], leaf: LEAF[species], wide: !!WIDE[species] };
    const rand = mulberry32((this.seed ^ Math.imul(wx, 0x2c1b3c6d) ^ Math.imul(wz, 0x297a2d39) ^ Math.imul(salt | 0, 0x68e31da4) ^ 0x5a9117) >>> 0);
    return { root, shape: this._build(root, rand) };
  }

  // (Round 11) Grows the sapling `saplingId` (of `kind`, as saplingShape) at
  // (x, y, z) in the world into its tree, as one edit batch. Four dark oak
  // saplings in a square make a dark oak (a lone one never grows), four jungle
  // ones a giant jungle tree. The trunk must have room (air, leaves, plants,
  // the saplings), or nothing happens and false comes back; leaves only fill
  // air and plants; the ground under the trunk turns to dirt (vanilla).
  growTree(world, x, y, z, kind, saplingId, rand = Math.random) {
    let rx = x;
    let rz = z;
    if (kind === "dark_oak" || kind === "jungle") {
      const at = (ax, az) => world.getBlock(ax, y, az) === saplingId;
      let corner = null;
      for (const [ox, oz] of [[0, 0], [-1, 0], [0, -1], [-1, -1]]) {
        const cx = x + ox;
        const cz = z + oz;
        if (at(cx, cz) && at(cx + 1, cz) && at(cx, cz + 1) && at(cx + 1, cz + 1)) {
          corner = [cx, cz];
          break;
        }
      }
      if (corner) {
        [rx, rz] = corner;
        if (kind === "jungle") kind = "mega_jungle";
      } else if (kind === "dark_oak") return false;
    }
    const grown = this.saplingShape(kind, rx, rz, Math.floor(rand() * 2147483647));
    if (!grown) return false;
    const { root, shape } = grown;
    const free = (id) => id === BLOCK.AIR || IS_LEAVES[id] === 1 || id === saplingId || (IS_REPLACEABLE[id] === 1 && IS_WET[id] === 0 && IS_SOLID[id] === 0);
    const logs = [];
    const leaves = [];
    for (let i = 0; i < shape.length; i += 4) {
      const wx = rx + shape[i];
      const dy = shape[i + 1];
      const wy = y + dy;
      const wz = rz + shape[i + 2];
      const id = shape[i + 3];
      const crown = id === root.leaf || isVine(id) || isCocoa(id);
      if (wy < 1 || wy >= WORLD_HEIGHT) {
        if (!crown) return false;
        continue;
      }
      const cur = world.getBlock(wx, wy, wz);
      if (crown) {
        if (cur === BLOCK.AIR || (IS_REPLACEABLE[cur] === 1 && IS_WET[cur] === 0)) leaves.push(wx, wy, wz, id);
      } else if (dy === -1) {
        if (cur === BLOCK.GRASS || cur === BLOCK.DIRT) logs.push(wx, wy, wz, id);
      } else if (free(cur)) {
        logs.push(wx, wy, wz, id);
        if (dy === 0 && SOIL_TO_DIRT.has(world.getBlock(wx, wy - 1, wz))) logs.push(wx, wy - 1, wz, BLOCK.DIRT);
      } else return false; // (the trunk is blocked: the sapling waits)
    }
    // Logs first, and no leaf over a cell a log took.
    const taken = new Set();
    for (let i = 0; i < logs.length; i += 4) taken.add(`${logs[i]},${logs[i + 1]},${logs[i + 2]}`);
    for (let i = 0; i < leaves.length; i += 4) {
      const k = `${leaves[i]},${leaves[i + 1]},${leaves[i + 2]}`;
      if (taken.has(k)) continue;
      taken.add(k);
      logs.push(leaves[i], leaves[i + 1], leaves[i + 2], leaves[i + 3]);
    }
    return world.setBlocks(logs) > 0;
  }

  _build(root, rand) {
    const out = [];
    const log = root.log;
    const bark = root.bark;
    const leaf = root.leaf;
    const blobs = [];
    const jitterSeed = (this.seed ^ Math.imul(root.x, 7919) ^ Math.imul(root.z, 104729)) | 0;
    // Branch: logs from `from` stepping toward `to` (inclusive of the end).
    const branch = (fx, fy, fz, tx, ty, tz) => {
      const n = Math.max(Math.abs(tx - fx), Math.abs(tz - fz), Math.abs(ty - fy));
      for (let i = 1; i <= n; i++) {
        const t = i / n;
        out.push(Math.round(fx + (tx - fx) * t), Math.round(fy + (ty - fy) * t), Math.round(fz + (tz - fz) * t), bark);
      }
    };
    let trunkTop = 0;
    if (root.species === TREE.OAK) {
      const T = 4 + Math.floor(rand() * 3);
      trunkTop = T;
      for (let y = 0; y < T; y++) out.push(0, y, 0, log);
      const cy = T - 1 + rand() * 0.6;
      blobs.push({ x: 0, y: cy, z: 0, rx: 2.3 + rand() * 0.9, ry: 1.9 + rand() * 0.6, rz: 2.3 + rand() * 0.9 });
      const extra = 1 + Math.floor(rand() * 2);
      for (let i = 0; i < extra; i++) {
        const a = rand() * Math.PI * 2;
        const d = 1.4 + rand() * 1.0;
        const b = { x: Math.cos(a) * d, y: cy - 0.6 + rand() * 1.2, z: Math.sin(a) * d, rx: 1.6 + rand() * 0.7, ry: 1.5 + rand() * 0.5, rz: 1.6 + rand() * 0.7 };
        blobs.push(b);
        if (rand() < 0.6) branch(0, T - 2, 0, Math.round(b.x * 0.8), Math.round(b.y - 0.5), Math.round(b.z * 0.8));
      }
    } else if (root.species === TREE.BIRCH) {
      const T = 6 + Math.floor(rand() * 3);
      trunkTop = T;
      for (let y = 0; y < T; y++) out.push(0, y, 0, log);
      const r = 1.5 + rand() * 0.6;
      blobs.push({ x: 0, y: T - 1.2, z: 0, rx: r, ry: 2.6 + rand() * 0.8, rz: r });
      if (rand() < 0.5) {
        const a = rand() * Math.PI * 2;
        blobs.push({ x: Math.cos(a) * 1.2, y: T - 2.6, z: Math.sin(a) * 1.2, rx: 1.2, ry: 1.2, rz: 1.2 });
      }
    } else if (root.species === TREE.PINE) {
      const T = 8 + Math.floor(rand() * 4);
      trunkTop = T;
      for (let y = 0; y < T; y++) out.push(0, y, 0, log);
      const rmax = 2.5 + rand() * 0.9;
      const base = 2 + Math.floor(rand() * 2);
      for (let y = base; y <= T + 1; y++) {
        const t = (y - base) / (T + 1 - base);
        const tier = (y - base) % 2 === 0 ? 1 : 0.68;
        const radius = (rmax * (1 - t) + 0.45) * tier;
        const R = Math.ceil(radius);
        for (let dz = -R; dz <= R; dz++) {
          for (let dx = -R; dx <= R; dx++) {
            if (dx === 0 && dz === 0 && y < T) continue;
            const d = Math.sqrt(dx * dx + dz * dz);
            if (d <= radius + (hash3(jitterSeed, dx, y, dz) - 0.5) * 0.5) out.push(dx, y, dz, leaf);
          }
        }
      }
      out.push(0, T, 0, leaf, 0, T + 1, 0, leaf, 0, T + 2, 0, leaf);
    } else if (root.species === TREE.JUNGLE) {
      // A tall trunk with vines up its sides under a small, rounded crown.
      const T = 5 + Math.floor(rand() * 6);
      trunkTop = T;
      // Cocoa pods on one tree in 5, round its lowest 3 logs, a side in 4
      // (vanilla's CocoaDecorator; hashed, so the tree's other draws stay put).
      if (hash3(jitterSeed, 0, -7, 0) < 0.2) {
        FACINGS4.forEach(([dx, dz], k) => {
          for (let y = 0; y < 3; y++) {
            if (hash3(jitterSeed, dx, y - 11, dz) < 0.25) out.push(-dx, y, -dz, COCOA + Math.floor(hash3(jitterSeed, dz, y - 17, dx) * COCOA_AGES) * 4 + k);
          }
        });
      }
      for (let y = 0; y < T; y++) {
        out.push(0, y, 0, log);
        if (y < 1) continue;
        // (a vine on the -X side hangs on a wall at +X: VINE + 2, and so on)
        if (rand() < 0.3) out.push(-1, y, 0, VINE + 2);
        if (rand() < 0.3) out.push(1, y, 0, VINE + 3);
        if (rand() < 0.3) out.push(0, y, -1, VINE);
        if (rand() < 0.3) out.push(0, y, 1, VINE + 1);
      }
      // (Round 12) Vanilla's blob of leaves: two rows of radius 1 over two
      // of radius 2, their corners cut now and then (the top row's always).
      for (let j = 0; j >= -3; j--) {
        const r = j >= -1 ? 1 : 2;
        for (let dz = -r; dz <= r; dz++) {
          for (let dx = -r; dx <= r; dx++) {
            if (Math.abs(dx) === r && Math.abs(dz) === r && (j === 0 || hash3(jitterSeed, dx, j + 40, dz) < 0.5)) continue;
            if (dx === 0 && dz === 0 && T + j < T) continue; // (the trunk)
            out.push(dx, T + j, dz, leaf);
          }
        }
      }
      leafVines(out, root, jitterSeed);
    } else if (root.species === TREE.BUSH) {
      // (Round 12) Vanilla's jungle bush: a log at the ground under a mound
      // of oak leaves, radius 2, 1 and a single leaf on top.
      out.push(0, 0, 0, log);
      for (let y = 0; y <= 2; y++) {
        const r = 2 - y;
        for (let dz = -r; dz <= r; dz++) {
          for (let dx = -r; dx <= r; dx++) {
            if ((dx === 0 && dz === 0 && y === 0) || (r > 0 && Math.abs(dx) === r && Math.abs(dz) === r && hash3(jitterSeed, dx, y + 50, dz) < 0.5)) continue;
            out.push(dx, y, dz, leaf);
          }
        }
      }
    } else if (root.species === TREE.MEGA_JUNGLE) {
      // (Round 12) Vanilla's giant jungle tree (MegaJungleTrunkPlacer and its
      // foliage): a 2x2 trunk 10-31 tall (kept inside the world), branches
      // every few blocks down to half its height, each 5 logs rising out to
      // a tuft of leaves (radius 1 over 2, sometimes 3); at the top a flat
      // canopy of three rows, radius 3 over 4 over 5 (the diagonals cut).
      // Vines on the trunk's sides (two in three) and hanging from the leaves.
      let T = 10 + Math.floor(rand() * 3) + Math.floor(rand() * 20);
      if (root.h > 0) T = Math.max(8, Math.min(T, WORLD_HEIGHT - 4 - (root.h + 1)));
      trunkTop = T;
      for (let y = 0; y < T; y++) for (let k = 0; k < 4; k++) out.push(k & 1, y, k >> 1, log);
      // A row of leaves round (cx, cz) (a 2x2 trunk's: round its four columns), radius r.
      const row = (cx, y, cz, r, wide) => {
        for (let dz = -r; dz <= r + (wide ? 1 : 0); dz++) {
          for (let dx = -r; dx <= r + (wide ? 1 : 0); dx++) {
            const ax = wide && dx > 0 ? dx - 1 : Math.abs(dx);
            const az = wide && dz > 0 ? dz - 1 : Math.abs(dz);
            if (ax + az >= 7 || ax * ax + az * az > r * r) continue;
            if (wide && y < T && dx >= 0 && dx <= 1 && dz >= 0 && dz <= 1) continue; // (the trunk)
            out.push(cx + dx, y, cz + dz, leaf);
          }
        }
      };
      for (let y = T - 2 - Math.floor(rand() * 4); y > T / 2; y -= 2 + Math.floor(rand() * 4)) {
        const a = rand() * Math.PI * 2;
        let bx = 0;
        let bz = 0;
        for (let l = 0; l < 5; l++) {
          bx = Math.floor(1 + Math.cos(a) * l);
          bz = Math.floor(1 + Math.sin(a) * l);
          if (bx >= 0 && bx <= 1 && bz >= 0 && bz <= 1) continue; // (inside the trunk)
          out.push(bx, y - 3 + (l >> 1), bz, bark);
        }
        const layers = 1 + Math.floor(rand() * 2);
        for (let j = 0; j >= -layers; j--) row(bx, y + j, bz, 1 - j, false);
      }
      for (let j = 0; j >= -2; j--) row(0, T + j, 0, 3 - j, true);
      // Trunk vines: on each outer side of each trunk log, two in three.
      for (let y = 1; y < T; y++) {
        for (let k = 0; k < 4; k++) {
          const tx = k & 1;
          const tz = k >> 1;
          FACINGS4.forEach(([dx, dz], f) => {
            const vx = tx + dx;
            const vz = tz + dz;
            if (vx >= 0 && vx <= 1 && vz >= 0 && vz <= 1) return; // (another trunk log)
            // (a vine on the log's +Z side hangs on a wall at -Z: the facing the other way)
            if (hash3(jitterSeed, vx * 3 + f, y + 60, vz) < 2 / 3) out.push(vx, y, vz, VINE + (f ^ 1));
          });
        }
      }
      leafVines(out, root, jitterSeed);
    } else if (root.species === TREE.ACACIA) {
      // The trunk rises, then leans off diagonally 1-3 blocks under a flat
      // crown; half the trees fork with a lower, smaller crown the other way.
      const T = 5 + Math.floor(rand() * 3);
      const dirs = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];
      const [ddx, ddz] = dirs[Math.floor(rand() * 8)];
      const lean = 1 + Math.floor(rand() * 3);
      const bendAt = T - lean;
      let x = 0;
      let z = 0;
      for (let y = 0; y < T; y++) {
        if (y >= bendAt) {
          x += ddx;
          z += ddz;
        }
        out.push(x, y, z, log);
      }
      trunkTop = T;
      const canopy = (cx, cy, cz, r) => {
        for (let dz = -r; dz <= r; dz++) {
          for (let dx = -r; dx <= r; dx++) {
            if (Math.abs(dx) === r && Math.abs(dz) === r) continue; // (corners cut)
            out.push(cx + dx, cy, cz + dz, leaf);
          }
        }
        for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) out.push(cx + dx, cy + 1, cz + dz, leaf);
        out.push(cx + 2, cy + 1, cz, leaf, cx - 2, cy + 1, cz, leaf, cx, cy + 1, cz + 2, leaf, cx, cy + 1, cz - 2, leaf);
      };
      canopy(x, T - 1, z, 3);
      if (rand() < 0.5 && bendAt > 2) {
        let bx = 0;
        let bz = 0;
        let by = bendAt - 1 - Math.floor(rand() * 2);
        const len = 1 + Math.floor(rand() * 2);
        for (let i = 0; i < len; i++) {
          bx -= ddx;
          bz -= ddz;
          by += 1;
          out.push(bx, by, bz, bark);
        }
        canopy(bx, by + 1, bz, 2);
      }
    } else if (root.species === TREE.DARK_OAK) {
      // A 2x2 trunk under a wide, low canopy with a few lobes around it.
      const T = 6 + Math.floor(rand() * 3);
      trunkTop = T;
      for (let y = 0; y < T; y++) for (let k = 0; k < 4; k++) out.push(k & 1, y, k >> 1, log);
      blobs.push({ x: 0.5, y: T, z: 0.5, rx: 3.6 + rand() * 0.6, ry: 1.6 + rand() * 0.3, rz: 3.6 + rand() * 0.6 });
      const lobes = 2 + Math.floor(rand() * 2);
      for (let i = 0; i < lobes; i++) {
        const a = ((i + rand() * 0.6) / lobes) * Math.PI * 2;
        const d = 2.6 + rand() * 0.8;
        const bx = 0.5 + Math.cos(a) * d;
        const bz = 0.5 + Math.sin(a) * d;
        blobs.push({ x: bx, y: T - 1 + rand() * 0.8, z: bz, rx: 2.2, ry: 1.3, rz: 2.2 });
        branch(Math.round(0.5 + Math.cos(a) * 0.9 - 0.5), T - 3, Math.round(0.5 + Math.sin(a) * 0.9 - 0.5), Math.round(bx - 0.5), T - 1, Math.round(bz - 0.5));
      }
    } else {
      // Old oak: a 2x2 trunk, roots, crooked branches, a huge crown.
      const T = 7 + Math.floor(rand() * 3);
      trunkTop = T;
      for (let y = 0; y < T; y++) for (let k = 0; k < 4; k++) out.push(k & 1, y, k >> 1, log);
      const roots = 4 + Math.floor(rand() * 3);
      for (let i = 0; i < roots; i++) {
        const a = ((i + rand() * 0.6) / roots) * Math.PI * 2;
        const len = 2 + Math.floor(rand() * 3);
        for (let s = 1; s <= len; s++) {
          const px = Math.round(0.5 + Math.cos(a) * (1 + s));
          const pz = Math.round(0.5 + Math.sin(a) * (1 + s));
          out.push(px, -1, pz, bark);
          if (s === 1) out.push(px, 0, pz, bark);
        }
      }
      const branches = 3 + Math.floor(rand() * 3);
      for (let i = 0; i < branches; i++) {
        const a = ((i + rand() * 0.7) / branches) * Math.PI * 2;
        const y0 = T - 4 + Math.floor(rand() * 3);
        const len = 3 + Math.floor(rand() * 3);
        let px = 0.5;
        let py = y0;
        let pz = 0.5;
        for (let s = 0; s < len; s++) {
          px += Math.cos(a);
          pz += Math.sin(a);
          py += 0.45 + rand() * 0.35;
          out.push(Math.round(px - 0.5), Math.round(py), Math.round(pz - 0.5), bark);
        }
        const r = 2.0 + rand() * 0.8;
        blobs.push({ x: px - 0.5, y: py + 0.8, z: pz - 0.5, rx: r, ry: r * 0.75, rz: r });
      }
      blobs.push({ x: 0.5, y: T + 0.5, z: 0.5, rx: 3.3 + rand() * 1.0, ry: 2.3 + rand() * 0.6, rz: 3.3 + rand() * 1.0 });
    }
    // Leaves: the union of the blobs, with ragged, noisy edges and a few
    // gaps near the surface.
    if (blobs.length > 0) {
      let x0 = Infinity;
      let x1 = -Infinity;
      let y0 = Infinity;
      let y1 = -Infinity;
      let z0 = Infinity;
      let z1 = -Infinity;
      for (const b of blobs) {
        x0 = Math.min(x0, Math.floor(b.x - b.rx));
        x1 = Math.max(x1, Math.ceil(b.x + b.rx));
        y0 = Math.min(y0, Math.floor(b.y - b.ry));
        y1 = Math.max(y1, Math.ceil(b.y + b.ry));
        z0 = Math.min(z0, Math.floor(b.z - b.rz));
        z1 = Math.max(z1, Math.ceil(b.z + b.rz));
      }
      y0 = Math.max(y0, Math.min(2, trunkTop - 1));
      for (let y = y0; y <= y1; y++) {
        for (let z = z0; z <= z1; z++) {
          for (let x = x0; x <= x1; x++) {
            let e = Infinity;
            for (const b of blobs) {
              const dx = (x - b.x) / b.rx;
              const dy = (y - b.y) / b.ry;
              const dz = (z - b.z) / b.rz;
              e = Math.min(e, dx * dx + dy * dy + dz * dz);
            }
            const j = hash3(jitterSeed, x, y, z);
            if (e + j * 0.45 >= 1.05) continue;
            if (e > 0.6 && hash3(jitterSeed ^ 0x3a5, x, y, z) < 0.1) continue;
            out.push(x, y, z, leaf);
          }
        }
      }
    }
    return Int16Array.from(out); // (offsets and 16-bit ids: 8 bytes per block)
  }

  // Places every tree that reaches into chunk (cx, cz). Logs may replace
  // air, leaves and plants (and the ground block itself for roots); leaves
  // only fill air. Trees are applied in a fixed order (by root position), so
  // overlaps come out the same in every chunk.
  placeInChunk(blocks, cx, cz) {
    const S = CHUNK_SIZE;
    const bx = cx * S;
    const bz = cz * S;
    const R = TREE_REACH;
    const roots = [];
    for (let wz = bz - R; wz < bz + S + R; wz++) {
      for (let wx = bx - R; wx < bx + S + R; wx++) {
        const root = this.rootAt(wx, wz);
        if (root) roots.push(root);
      }
    }
    roots.sort((a, b) => a.x - b.x || a.z - b.z);
    for (const root of roots) {
      const shape = this.shape(root);
      const ox = root.x - bx;
      const oz = root.z - bz;
      const oy = root.h + 1;
      for (let i = 0; i < shape.length; i += 4) {
        const x = ox + shape[i];
        const z = oz + shape[i + 2];
        if (x < 0 || x >= S || z < 0 || z >= S) continue;
        const y = oy + shape[i + 1];
        if (y < 1 || y >= WORLD_HEIGHT) continue;
        const idx = (y * S + z) * S + x;
        const cur = blocks[idx];
        const id = shape[i + 3];
        if (id === root.leaf || isVine(id) || isCocoa(id)) {
          if (cur === BLOCK.AIR) blocks[idx] = id;
        } else if (shape[i + 1] === -1) {
          // Roots run through the ground's top block, never through the air.
          if (cur === BLOCK.GRASS || cur === BLOCK.DIRT) blocks[idx] = id;
        } else if (cur === BLOCK.AIR || isLeafOrPlant(cur)) {
          blocks[idx] = id;
        }
      }
    }
  }

  // Whether any tree (trunk, roots or crown) stands in column (wx, wz): used
  // to keep the world spawn off tree tops.
  coversColumn(wx, wz) {
    const R = TREE_REACH;
    for (let dz = -R; dz <= R; dz++) {
      for (let dx = -R; dx <= R; dx++) {
        const root = this.rootAt(wx + dx, wz + dz);
        if (!root) continue;
        const s = this.shape(root);
        for (let i = 0; i < s.length; i += 4) if (s[i] === -dx && s[i + 2] === -dz) return true;
      }
    }
    return false;
  }

  // Rough crown of a tree for distant terrain: { cy, rx, ry, top } in blocks
  // relative to the block above the ground (see lod-mesher.js).
  crown(root) {
    if (root.crown) return root.crown;
    const shape = this.shape(root);
    let lo = Infinity;
    let hi = -Infinity;
    let r = 0;
    // (a giant jungle tree's: its canopy only, the low tufts on its branches left out)
    let floor = -Infinity;
    if (root.species === TREE.MEGA_JUNGLE) {
      for (let i = 0; i < shape.length; i += 4) if (shape[i + 3] === root.leaf) floor = Math.max(floor, shape[i + 1] - 2);
    }
    for (let i = 0; i < shape.length; i += 4) {
      if (shape[i + 3] !== root.leaf || shape[i + 1] < floor) continue;
      lo = Math.min(lo, shape[i + 1]);
      hi = Math.max(hi, shape[i + 1]);
      r = Math.max(r, Math.abs(shape[i] + 0.5 - (root.wide ? 1 : 0.5)), Math.abs(shape[i + 2] + 0.5 - (root.wide ? 1 : 0.5)));
    }
    root.crown = { bottom: lo, top: hi + 1, radius: Math.max(1, r * 0.85) };
    return root.crown;
  }
}

function isLeafOrPlant(id) {
  return (
    id === BLOCK.LEAVES ||
    id === BLOCK.BIRCH_LEAVES ||
    id === BLOCK.PINE_LEAVES ||
    id === BLOCK.TALL_GRASS ||
    id === BLOCK.FLOWER_RED ||
    id === BLOCK.FLOWER_YELLOW ||
    id === JUNGLE_LEAVES ||
    id === ACACIA_LEAVES ||
    id === DARK_OAK_LEAVES ||
    isVine(id)
  );
}
