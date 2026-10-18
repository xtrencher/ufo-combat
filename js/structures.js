// Structures (Round 11): a Survival world's dungeons, abandoned mineshafts,
// desert temples and desert wells, as vanilla's, deterministic from the seed
// like the villages (pure logic, no three.js: the chunk workers and the
// distant terrain's edited chunks run it through terrain.js, so every
// generator agrees). A Missions world has none (terrain.js only calls this
// for a vanilla terrain).
// - Dungeons (vanilla's monster room): eight tries a chunk, kept inside their
//   chunk; a room is built only where its floor and ceiling are solid and a
//   cave opens into it 1-5 times. Mossy cobblestone floor, cobblestone walls,
//   a monster spawner (zombie 1/2, skeleton or spider 1/4 each) and up to two
//   chests against the walls.
// - Mineshafts: about one start in two regions of 12 x 12 chunks, under
//   land. From a dirt-floored room, corridors (3 wide, 3 high, oak plank and
//   fence supports every 5 blocks, cobwebs), crossings and stairs branch out
//   up to 8 pieces deep and 80 blocks away (vanilla's limits), planned as a
//   whole and cut chunk by chunk. A corridor in 23 is a spider's: thick with
//   cobwebs round a spider spawner (no cave spiders here: the game's spider).
//   A chest stands now and then by a corridor's wall (vanilla's minecart
//   with a chest, 1% a side every 5 blocks; there are no rails).
// - Desert temples: one try per 32 x 32 chunks (vanilla's spacing, 8 apart
//   at least), in the desert: a stepped sandstone pyramid with two towers, a
//   terracotta floor and under its blue centre a shaft down to the hidden
//   room: four chests, and nine TNT under a stone pressure plate when the
//   redstone part's blocks exist.
// - Desert wells: one desert chunk in 1000.
// Chest loot (structureLootAt: chests.js asks when a chest is first opened)
// is vanilla's tables; an item the game doesn't have keeps its weight and
// gives nothing, so the odds of the rest stay vanilla's. Monster spawners
// run in the game through Spawners (below).
import { hash2, mulberry32 } from "./noise.js";
import { BLOCK, BLOCK_INFO, IS_SOLID, IS_WET, chest } from "./blocks.js";
import { CHUNK_SIZE, WORLD_HEIGHT, SEA_LEVEL, chunkKey } from "./constants.js";
import { BIOME } from "./biomes.js";
import { VILLAGE_REACH } from "./village.js";
import { SPAWNER, SPAWNER_KINDS } from "./content/nature.js";
import { LIB, ITEM } from "./content/base.js";
import * as V from "./content/ids.js";
import { enchantedBook } from "./enchant.js";

const S = CHUNK_SIZE;
const idx = (x, y, z) => (y * S + z) * S + x;

export function isSpawner(id) {
  return id >= SPAWNER && id < SPAWNER + SPAWNER_KINDS.length;
}

// ---------- Dungeons ----------
const DUNGEON_SALT = 0x2c1b3c6d;
const DUNGEON_TRIES = 48; // (vanilla 1.17: 8 a chunk; this world's caves are sparser: see _buildDungeon)
const DUNGEON_MAX_Y = 64; // (tries above the ground fail, as in vanilla)
// vanilla's mob picks: skeleton, zombie, zombie, spider
const DUNGEON_MOBS = [1, 0, 0, 2];

// ---------- Mineshafts ----------
const MINE_SALT = 0x5f3759df;
const MINE_REGION = 12; // chunks
const MINE_CHANCE = 0.5;
const MINE_REACH = 80;
const MINE_DEPTH = 8;
const MINE_MAX_PIECES = 90;
const MINE_MIN_Y = 12; // (corridor floors: the lava lakes stay below, at 10 and under)
const MINE_MAX_Y = 24;
const ROOM = 0;
const CORRIDOR = 1;
const CROSSING = 2;
const STAIRS = 3;
const DIRS = [
  [1, 0],
  [0, 1],
  [-1, 0],
  [0, -1],
];

// ---------- Desert temples and wells ----------
const TEMPLE_SALT = 0x14057b7e;
const WELL_SALT = 0x3b9aca07;
const TEMPLE_SPACING = 32; // chunks (vanilla)
const TEMPLE_SEPARATION = 8;
const TEMPLE_SIZE = 21;
const TEMPLE_DEPTH = 14; // blocks below the floor its hidden room reaches
const TEMPLE_HEIGHT = 14;
const CHEST_MARK = 0x10000; // a temple cell that is a chest: + its local facing (0-3)

// A cache that forgets its oldest entry past `max` (the generators ask for
// the same plans again and again as neighbouring chunks come in).
function remember(map, key, value, max) {
  map.set(key, value);
  if (map.size > max) map.delete(map.keys().next().value);
  return value;
}

export class StructureGrower {
  // terrain: the TerrainGenerator (heightAt, biomeAt, villages).
  constructor(terrain) {
    this.terrain = terrain;
    this.seed = terrain.seed;
    this._dungeons = new Map(); // "cx,cz" -> candidates
    this._mines = new Map(); // "rx,rz" -> plan or null
    this._temples = new Map(); // "rx,rz" -> temple or null
  }

  // ---------- In a chunk (terrain.js) ----------

  // Underground, after the caves and ores: mineshafts, then dungeons (as
  // vanilla: structures before features).
  placeUnderground(blocks, cx, cz, hAt) {
    const mines = this._minesNear(cx * S, cz * S, cx * S + S - 1, cz * S + S - 1);
    if (mines.length) {
      const minH = this._minHeights(hAt);
      for (const plan of mines) this._cutMineshaft(blocks, cx, cz, plan, minH, false);
      for (const plan of mines) this._cutMineshaft(blocks, cx, cz, plan, minH, true);
    }
    for (const d of this.dungeonCandidates(cx, cz)) this._buildDungeon(blocks, cx, cz, d, hAt);
  }

  // On the ground, after the ground cover and before the villages: desert
  // temples and wells.
  placeSurface(blocks, cx, cz, hAt, biomeAt) {
    for (const t of this._templesNear(cx * S, cz * S, cx * S + S - 1, cz * S + S - 1)) this._buildTemple(blocks, cx, cz, t);
    this._placeWell(blocks, cx, cz, hAt, biomeAt);
  }

  // The lowest ground of each column and its four neighbours, less 2: a
  // mineshaft never cuts above it, so it never breaks into the open, the sea
  // or a lake (the generator's water doesn't flow until a player touches it).
  _minHeights(hAt) {
    const m = new Int16Array(S * S);
    for (let lz = 0; lz < S; lz++) {
      for (let lx = 0; lx < S; lx++) m[lz * S + lx] = Math.min(hAt(lx, lz), hAt(lx + 1, lz), hAt(lx - 1, lz), hAt(lx, lz + 1), hAt(lx, lz - 1)) - 2;
    }
    return m;
  }

  // ---------- Dungeons ----------

  // A chunk's dungeon tries, from the seed: { x, z, h (0-1: how high up
  // between the bottom of the world and its ground), rx, rz, kind, chests:
  // [[dx, dz] x 6] }. Whether each is built depends on the chunk's caves.
  dungeonCandidates(cx, cz) {
    const key = chunkKey(cx, cz);
    const known = this._dungeons.get(key);
    if (known) return known;
    const rand = mulberry32((this.seed ^ Math.imul(cx, 0x2545f491) ^ Math.imul(cz, 0x9e3779b9) ^ DUNGEON_SALT) >>> 0);
    const list = [];
    for (let a = 0; a < DUNGEON_TRIES; a++) {
      const lx = 4 + Math.floor(rand() * 8);
      const lz = 4 + Math.floor(rand() * 8);
      const h = rand();
      const rx = 2 + Math.floor(rand() * 2);
      const rz = 2 + Math.floor(rand() * 2);
      const kind = DUNGEON_MOBS[Math.floor(rand() * 4)];
      const chests = [];
      for (let k = 0; k < 6; k++) chests.push([Math.floor(rand() * (rx * 2 + 1)) - rx, Math.floor(rand() * (rz * 2 + 1)) - rz]);
      list.push({ x: cx * S + lx, z: cz * S + lz, h, rx, rz, kind, chests });
    }
    // (cheap to make again: only the chunks being asked about now are kept)
    return remember(this._dungeons, key, list, 64);
  }

  // Vanilla's MonsterRoomFeature, on the chunk's own blocks.
  // (The tries are spread between the bottom of the world and 5 under the
  // ground: this world is shallower than vanilla's, its caves sparser, so
  // tries in the open sky would only waste them.)
  _buildDungeon(blocks, cx, cz, d, hAt) {
    const lx = d.x - cx * S;
    const lz = d.z - cz * S;
    const { rx, rz } = d;
    const span = Math.min(DUNGEON_MAX_Y, hAt(lx, lz) - 5) - 2;
    if (span < 1) return;
    const y = 2 + Math.floor(d.h * span);
    const x0 = lx - rx - 1;
    const x1 = lx + rx + 1;
    const z0 = lz - rz - 1;
    const z1 = lz + rz + 1;
    let openings = 0;
    for (let x = x0; x <= x1; x++) {
      for (let z = z0; z <= z1; z++) {
        if (!IS_SOLID[blocks[idx(x, y - 1, z)]] || !IS_SOLID[blocks[idx(x, y + 4, z)]]) return;
        const wall = x === x0 || x === x1 || z === z0 || z === z1;
        if (wall && blocks[idx(x, y, z)] === BLOCK.AIR && blocks[idx(x, y + 1, z)] === BLOCK.AIR) openings++;
      }
    }
    if (openings < 1 || openings > 5) return;
    for (let x = x0; x <= x1; x++) {
      for (let z = z0; z <= z1; z++) {
        const wall = x === x0 || x === x1 || z === z0 || z === z1;
        for (let dy = 3; dy >= -1; dy--) {
          const i = idx(x, y + dy, z);
          const id = blocks[i];
          if (id === BLOCK.BEDROCK) continue;
          if (!wall && dy >= 0) blocks[i] = BLOCK.AIR;
          else if (y + dy >= 1 && !IS_SOLID[blocks[idx(x, y + dy - 1, z)]]) blocks[i] = BLOCK.AIR;
          else if (IS_SOLID[id]) {
            const mossy = dy === -1 && hash2((this.seed ^ DUNGEON_SALT) >>> 0, cx * S + x, cz * S + z + y * 977) < 0.75;
            blocks[i] = mossy && BLOCK_INFO[V.MOSSY_COBBLESTONE] ? V.MOSSY_COBBLESTONE : BLOCK.COBBLESTONE;
          }
        }
      }
    }
    // Two chests, three tries each: on the floor, against exactly one wall.
    for (let c = 0; c < 2; c++) {
      for (let t = 0; t < 3; t++) {
        const x = lx + d.chests[c * 3 + t][0];
        const z = lz + d.chests[c * 3 + t][1];
        const wy = y;
        if (blocks[idx(x, wy, z)] !== BLOCK.AIR) continue;
        let walls = 0;
        let fx = 0;
        let fz = 0;
        for (const [sx, sz] of DIRS) {
          if (!IS_SOLID[blocks[idx(x + sx, wy, z + sz)]]) continue;
          walls++;
          fx = -sx;
          fz = -sz;
        }
        if (walls !== 1) continue;
        blocks[idx(x, wy, z)] = chest(fx, fz);
        break;
      }
    }
    if (BLOCK_INFO[SPAWNER]) blocks[idx(lx, y, lz)] = SPAWNER + d.kind;
  }

  // ---------- Mineshafts ----------

  // The mineshaft planned from region (rx, rz), or null: { x, y, z, pieces,
  // chests, spawners, box: [x0, z0, x1, z1] }.
  minePlan(rx, rz) {
    const key = `${rx},${rz}`;
    if (this._mines.has(key)) return this._mines.get(key);
    let plan = null;
    if (hash2((this.seed ^ MINE_SALT) >>> 0, rx, rz) < MINE_CHANCE) {
      const rand = mulberry32((this.seed ^ Math.imul(rx, 0x632be59b) ^ Math.imul(rz, 0x85157af5) ^ MINE_SALT) >>> 0);
      const sx = (rx * MINE_REGION + Math.floor(rand() * MINE_REGION)) * S + 4 + Math.floor(rand() * 8);
      const sz = (rz * MINE_REGION + Math.floor(rand() * MINE_REGION)) * S + 4 + Math.floor(rand() * 8);
      const h = this.terrain.heightAt(sx, sz);
      const top = Math.min(MINE_MAX_Y, h - 12);
      if (top >= MINE_MIN_Y && h > SEA_LEVEL + 2) plan = buildMineshaft(sx, MINE_MIN_Y + Math.floor(rand() * (top - MINE_MIN_Y + 1)), sz, rand);
    }
    return remember(this._mines, key, plan, 256);
  }

  _minesNear(x0, z0, x1, z1) {
    const out = [];
    const span = MINE_REGION * S;
    const reach = MINE_REACH + 16;
    for (let rz = Math.floor((z0 - reach) / span); rz <= Math.floor((z1 + reach) / span); rz++) {
      for (let rx = Math.floor((x0 - reach) / span); rx <= Math.floor((x1 + reach) / span); rx++) {
        const p = this.minePlan(rx, rz);
        if (p && p.box[0] <= x1 + 1 && p.box[2] >= x0 - 1 && p.box[1] <= z1 + 1 && p.box[3] >= z0 - 1) out.push(p);
      }
    }
    return out;
  }

  // Cuts a mineshaft's pieces into a chunk: the air first (decorate false),
  // then the floors, supports, cobwebs, chests and spawners.
  _cutMineshaft(blocks, cx, cz, plan, minH, decorate) {
    const bx = cx * S;
    const bz = cz * S;
    const ok = (lx, y, lz) => y >= 2 && y < minH[lz * S + lx] && blocks[idx(lx, y, lz)] !== BLOCK.BEDROCK && !IS_WET[blocks[idx(lx, y, lz)]];
    const inChunk = (wx, wz) => wx >= bx && wx < bx + S && wz >= bz && wz < bz + S;
    for (const p of plan.pieces) {
      if (p.x0 > bx + S || p.x1 < bx - 1 || p.z0 > bz + S || p.z1 < bz - 1) continue;
      if (!decorate) {
        for (let wx = Math.max(p.x0, bx); wx <= Math.min(p.x1, bx + S - 1); wx++) {
          for (let wz = Math.max(p.z0, bz); wz <= Math.min(p.z1, bz + S - 1); wz++) {
            const lx = wx - bx;
            const lz = wz - bz;
            let lo = p.y0;
            let hi = p.y1;
            if (p.kind === STAIRS) {
              // (the floor steps down 5 over the stair's middle, 4 high above each step)
              const k = p.dx ? (wx - p.ex) * p.dx : (wz - p.ez) * p.dz;
              lo = p.y - Math.max(0, Math.min(5, k - 1));
              hi = lo + 3;
            }
            for (let y = lo; y <= hi; y++) if (ok(lx, y, lz)) blocks[idx(lx, y, lz)] = BLOCK.AIR;
            if (p.kind === ROOM && ok(lx, lo - 1, lz)) blocks[idx(lx, lo - 1, lz)] = BLOCK.DIRT;
          }
        }
        continue;
      }
      if (p.kind !== CORRIDOR) continue;
      const fence = BLOCK_INFO[V.OAK_FENCE] ? V.OAK_FENCE : BLOCK.PLANKS;
      const salt = (this.seed ^ MINE_SALT ^ 0x7f4a7c15) >>> 0;
      // Along the corridor: a (0 .. len - 1) from its entry, w (-1, 0, 1) across.
      for (let a = 0; a < p.len; a++) {
        for (let w = -1; w <= 1; w++) {
          const wx = p.ex + p.dx * a - p.dz * w;
          const wz = p.ez + p.dz * a + p.dx * w;
          if (!inChunk(wx, wz)) continue;
          const lx = wx - bx;
          const lz = wz - bz;
          const y = p.y;
          // (only where the corridor is open)
          if (blocks[idx(lx, y, lz)] !== BLOCK.AIR) continue;
          const below = idx(lx, y - 1, lz);
          if (!IS_SOLID[blocks[below]] && blocks[below] !== BLOCK.BEDROCK) blocks[below] = BLOCK.PLANKS;
          const support = a % 5 === 2;
          if (support) {
            if (w !== 0) {
              blocks[idx(lx, y, lz)] = fence;
              if (blocks[idx(lx, y + 1, lz)] === BLOCK.AIR) blocks[idx(lx, y + 1, lz)] = fence;
            }
            if (blocks[idx(lx, y + 2, lz)] === BLOCK.AIR) blocks[idx(lx, y + 2, lz)] = BLOCK.PLANKS;
            continue;
          }
          const r = hash2(salt, wx * 31 + y, wz);
          if (p.spider) {
            // (vanilla: 60% of the lower two rows)
            const wy = w === 0 ? y + 1 : y + (r < 0.3 ? 0 : 1);
            if (r < 0.6 && blocks[idx(lx, wy, lz)] === BLOCK.AIR) blocks[idx(lx, wy, lz)] = V.COBWEB;
          } else if (w !== 0 && blocks[idx(lx, y + 2, lz)] === BLOCK.AIR) {
            // (vanilla's: in the top corners beside a support, 10% next to it, 5% one further)
            const off = Math.abs((a % 5) - 2);
            if (r < (off === 1 ? 0.1 : off === 2 ? 0.05 : 0)) blocks[idx(lx, y + 2, lz)] = V.COBWEB;
          }
        }
      }
    }
    if (!decorate) return;
    for (const [x, y, z, fx, fz] of plan.chests) {
      if (!inChunk(x, z)) continue;
      const i = idx(x - bx, y, z - bz);
      if (blocks[i] === BLOCK.AIR || blocks[i] === V.COBWEB) {
        if (IS_SOLID[blocks[idx(x - bx, y - 1, z - bz)]]) blocks[i] = chest(fx, fz);
      }
    }
    for (const [x, y, z, kind] of plan.spawners) {
      if (!inChunk(x, z) || !BLOCK_INFO[SPAWNER]) continue;
      const i = idx(x - bx, y, z - bz);
      if (blocks[i] === BLOCK.AIR || blocks[i] === V.COBWEB) blocks[i] = SPAWNER + kind;
    }
  }

  // ---------- Desert temples ----------

  // The temple tried in region (rx, rz) if it stands: { x0, z0, floor, rot, chests }.
  templeAt(rx, rz) {
    const key = `${rx},${rz}`;
    if (this._temples.has(key)) return this._temples.get(key);
    let t = null;
    const rand = mulberry32((this.seed ^ Math.imul(rx, 0x1b873593) ^ Math.imul(rz, 0xcc9e2d51) ^ TEMPLE_SALT) >>> 0);
    const ccx = rx * TEMPLE_SPACING + Math.floor(rand() * (TEMPLE_SPACING - TEMPLE_SEPARATION));
    const ccz = rz * TEMPLE_SPACING + Math.floor(rand() * (TEMPLE_SPACING - TEMPLE_SEPARATION));
    const rot = Math.floor(rand() * 4);
    const x0 = ccx * S;
    const z0 = ccz * S;
    const tr = this.terrain;
    const mid = Math.floor(TEMPLE_SIZE / 2);
    if (tr.biomeAt(x0 + mid, z0 + mid) === BIOME.DESERT) {
      const hs = [[0, 0], [TEMPLE_SIZE - 1, 0], [0, TEMPLE_SIZE - 1], [TEMPLE_SIZE - 1, TEMPLE_SIZE - 1], [mid, mid]].map(([u, v]) => tr.heightAt(x0 + u, z0 + v));
      const lo = Math.min(...hs);
      const hi = Math.max(...hs);
      // (on fairly level, dry sand, never in a village)
      if (hi - lo <= 4 && lo > SEA_LEVEL + 1 && lo - TEMPLE_DEPTH > 3 && lo + TEMPLE_HEIGHT < WORLD_HEIGHT && !tr.villages.nearestVillage(x0 + mid, z0 + mid, VILLAGE_REACH + 20)) {
        t = { x0, z0, floor: lo, rot, chests: [] };
        for (const [u, v, f] of TEMPLE_CHESTS) {
          const [x, z] = templeWorld(t, u, v);
          const [fx, fz] = rotateDir(rot, DIRS[f][0], DIRS[f][1]);
          t.chests.push([x, lo - 11, z, fx, fz]);
        }
      }
    }
    return remember(this._temples, key, t, 256);
  }

  _templesNear(x0, z0, x1, z1) {
    const out = [];
    const span = TEMPLE_SPACING * S;
    for (let rz = Math.floor((z0 - TEMPLE_SIZE) / span); rz <= Math.floor(z1 / span); rz++) {
      for (let rx = Math.floor((x0 - TEMPLE_SIZE) / span); rx <= Math.floor(x1 / span); rx++) {
        const t = this.templeAt(rx, rz);
        if (t && t.x0 <= x1 && t.x0 + TEMPLE_SIZE > x0 && t.z0 <= z1 && t.z0 + TEMPLE_SIZE > z0) out.push(t);
      }
    }
    return out;
  }

  _buildTemple(blocks, cx, cz, t) {
    const bx = cx * S;
    const bz = cz * S;
    const F = t.floor;
    const sandstone = BLOCK_INFO[V.SANDSTONE] ? V.SANDSTONE : BLOCK.SAND;
    const tnt = !!BLOCK_INFO[V.TNT];
    const plate = tnt && !!BLOCK_INFO[V.STONE_PRESSURE_PLATE];
    for (let u = 0; u < TEMPLE_SIZE; u++) {
      for (let v = 0; v < TEMPLE_SIZE; v++) {
        const [wx, wz] = templeWorld(t, u, v);
        const lx = wx - bx;
        const lz = wz - bz;
        if (lx < 0 || lx >= S || lz < 0 || lz >= S) continue;
        for (let dy = -TEMPLE_DEPTH; dy <= TEMPLE_HEIGHT; dy++) {
          let id = templeCell(u, dy, v, tnt, plate);
          if (id < 0) continue;
          if (id >= CHEST_MARK) {
            const [fx, fz] = rotateDir(t.rot, DIRS[id - CHEST_MARK][0], DIRS[id - CHEST_MARK][1]);
            id = chest(fx, fz);
          } else if (id !== BLOCK.AIR && !BLOCK_INFO[id]) id = sandstone;
          blocks[idx(lx, F + dy, lz)] = id;
        }
        // Sandstone under the floor down to the ground (a dip under its edge;
        // not down the hidden room's shaft).
        if (Math.abs(u - 10) <= 3 && Math.abs(v - 10) <= 3) continue;
        for (let y = F - 1; y >= 1 && !IS_SOLID[blocks[idx(lx, y, lz)]]; y--) blocks[idx(lx, y, lz)] = sandstone;
      }
    }
  }

  // ---------- Desert wells ----------

  // Vanilla's DesertWellFeature, inside one chunk.
  _placeWell(blocks, cx, cz, hAt, biomeAt) {
    if (hash2((this.seed ^ WELL_SALT) >>> 0, cx, cz) >= 1 / 1000) return;
    const lx = 3 + Math.floor(hash2((this.seed ^ WELL_SALT ^ 0x51) >>> 0, cx, cz) * 10);
    const lz = 3 + Math.floor(hash2((this.seed ^ WELL_SALT ^ 0x93) >>> 0, cx, cz) * 10);
    const y = hAt(lx, lz);
    if (biomeAt(lx, lz) !== BIOME.DESERT || y + 5 >= WORLD_HEIGHT || y <= SEA_LEVEL + 1 || blocks[idx(lx, y, lz)] !== BLOCK.SAND) return;
    for (let dx = -2; dx <= 2; dx++) {
      for (let dz = -2; dz <= 2; dz++) if (!IS_SOLID[blocks[idx(lx + dx, y - 1, lz + dz)]] && !IS_SOLID[blocks[idx(lx + dx, y - 2, lz + dz)]]) return;
    }
    const slab = BLOCK_INFO[V.SANDSTONE_SLAB] ? V.SANDSTONE_SLAB : V.SANDSTONE;
    const set = (dx, dy, dz, id) => (blocks[idx(lx + dx, y + dy, lz + dz)] = id);
    for (let dx = -2; dx <= 2; dx++) {
      for (let dz = -2; dz <= 2; dz++) {
        set(dx, -1, dz, V.SANDSTONE);
        set(dx, 0, dz, V.SANDSTONE);
        for (let dy = 1; dy <= 4; dy++) set(dx, dy, dz, BLOCK.AIR);
        if (Math.abs(dx) === 2 || Math.abs(dz) === 2) set(dx, 1, dz, V.SANDSTONE);
      }
    }
    set(0, 0, 0, BLOCK.WATER);
    for (const [dx, dz] of DIRS) {
      set(dx, 0, dz, BLOCK.WATER);
      set(dx * 2, 1, dz * 2, slab);
    }
    for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) set(dx, 4, dz, dx || dz ? slab : V.SANDSTONE);
    for (let dy = 1; dy <= 3; dy++) for (const [dx, dz] of [[-1, -1], [-1, 1], [1, -1], [1, 1]]) set(dx, dy, dz, V.SANDSTONE);
  }

  // ---------- Questions from the game ----------

  // Which structure's chest stands at (x, y, z), if any: "dungeon",
  // "mineshaft", "desert_pyramid" or null (generated chests only; chests.js
  // asks only about those). getBlock(x, y, z): the world's (a dungeon's chest
  // is the one with a spawner beside it on its floor).
  chestAt(x, y, z, getBlock) {
    for (const p of this._minesNear(x, z, x, z)) {
      if (p.chests.some((c) => c[0] === x && c[1] === y && c[2] === z)) return "mineshaft";
    }
    for (const t of this._templesNear(x, z, x, z)) {
      if (t.chests.some((c) => c[0] === x && c[1] === y && c[2] === z)) return "desert_pyramid";
    }
    // A dungeon's chest: on a try's floor inside its walls, the try's
    // spawner in the generated blocks (so one a player broke, or ground the
    // host hasn't loaded, still counts; rooms are kept inside their chunk).
    let gen = null;
    for (const d of this.dungeonCandidates(x >> 4, z >> 4)) {
      if (Math.abs(x - d.x) > d.rx || Math.abs(z - d.z) > d.rz) continue;
      const span = Math.min(DUNGEON_MAX_Y, this.terrain.heightAt(d.x, d.z) - 5) - 2;
      if (span < 1 || y !== 2 + Math.floor(d.h * span)) continue;
      if (getBlock && isSpawner(getBlock(d.x, y, d.z))) return "dungeon";
      if (!gen) {
        gen = new Uint16Array(S * S * WORLD_HEIGHT); // (as Chunk.blocks; only on a chest's first open)
        this.terrain.generate({ cx: x >> 4, cz: z >> 4, blocks: gen });
      }
      if (isSpawner(gen[idx(d.x & 15, y, d.z & 15)])) return "dungeon";
    }
    if (getBlock) {
      for (let dx = -3; dx <= 3; dx++) for (let dz = -3; dz <= 3; dz++) if (isSpawner(getBlock(x + dx, y, z + dz))) return "dungeon";
    }
    return null;
  }

  // The columns of chunk (cx, cz) where a dungeon's spawner may stand
  // ([[x, z], ...]), and the mineshafts' spawners there ([[x, y, z], ...]).
  spawnerSpots(cx, cz) {
    const columns = this.dungeonCandidates(cx, cz).map((d) => [d.x, d.z]);
    const cells = [];
    const x0 = cx * S;
    const z0 = cz * S;
    for (const p of this._minesNear(x0, z0, x0 + S - 1, z0 + S - 1)) {
      for (const [x, y, z] of p.spawners) if (x >> 4 === cx && z >> 4 === cz) cells.push([x, y, z]);
    }
    return { columns, cells };
  }
}

// ---------- The mineshaft's plan ----------

// Vanilla's MineShaftPieces, simplified: a room, then pieces added depth
// first, each kept clear of the others (boxes are the pieces' air).
function buildMineshaft(sx, sy, sz, rand) {
  const pieces = [];
  const chests = [];
  const spawners = [];
  const collides = (b) => pieces.some((p) => b.x0 <= p.x1 && b.x1 >= p.x0 && b.y0 <= p.y1 && b.y1 >= p.y0 && b.z0 <= p.z1 && b.z1 >= p.z0);
  const far = (x, z) => Math.abs(x - sx) > MINE_REACH || Math.abs(z - sz) > MINE_REACH;
  // A box along direction (dx, dz) from entry (x, y, z): `len` long, 1 to each side.
  const boxAlong = (x, y, z, dx, dz, len, h) => {
    const ax = x + dx * (len - 1);
    const az = z + dz * (len - 1);
    return { x0: Math.min(x, ax) - Math.abs(dz), x1: Math.max(x, ax) + Math.abs(dz), y0: y, y1: y + h - 1, z0: Math.min(z, az) - Math.abs(dx), z1: Math.max(z, az) + Math.abs(dx) };
  };
  const add = (depth, x, y, z, dx, dz) => {
    if (depth > MINE_DEPTH || pieces.length >= MINE_MAX_PIECES || far(x, z)) return;
    const r = rand();
    if (r >= 0.8) crossing(depth, x, y, z, dx, dz);
    else if (r >= 0.7 && y - 5 >= MINE_MIN_Y) stairs(depth, x, y, z, dx, dz);
    else corridor(depth, x, y, z, dx, dz);
  };
  const corridor = (depth, x, y, z, dx, dz) => {
    // (vanilla: 2-4 sections of 5, shorter until it fits)
    let len = 0;
    let box = null;
    for (let n = 2 + Math.floor(rand() * 3); n > 0; n--) {
      const b = boxAlong(x, y, z, dx, dz, n * 5, 3);
      if (!collides(b)) {
        len = n * 5;
        box = b;
        break;
      }
    }
    if (!box) return;
    const p = { kind: CORRIDOR, ...box, ex: x, ez: z, y, dx, dz, len, spider: rand() < 1 / 23 };
    pieces.push(p);
    for (let s = 0; s < len / 5; s++) {
      for (const w of [-1, 1]) {
        if (rand() >= 0.01) continue;
        const a = s * 5 + (rand() < 0.5 ? 1 : 3);
        chests.push([x + dx * a - dz * w, y, z + dz * a + dx * w, dz * w, -dx * w]);
      }
    }
    if (p.spider) {
      const a = Math.floor(rand() * len);
      spawners.push([x + dx * a, y, z + dz * a, 2]);
    }
    // At the end: on (half the time), or turning left or right.
    const end = rand();
    if (end < 0.5) add(depth + 1, x + dx * len, y, z + dz * len, dx, dz);
    else {
      const w = end < 0.75 ? 1 : -1;
      add(depth + 1, x + dx * (len - 2) - dz * w * 2, y, z + dz * (len - 2) + dx * w * 2, -dz * w, dx * w);
    }
    // Side branches now and then, every 5 blocks.
    for (let a = 3; a + 3 <= len; a += 5) {
      const k = rand();
      if (k >= 0.4) continue;
      const w = k < 0.2 ? 1 : -1;
      add(depth + 1, x + dx * a - dz * w * 2, y, z + dz * a + dx * w * 2, -dz * w, dx * w);
    }
  };
  const crossing = (depth, x, y, z, dx, dz) => {
    const box = boxAlong(x, y, z, dx, dz, 3, 3);
    if (collides(box)) return;
    pieces.push({ kind: CROSSING, ...box });
    const mx = x + dx;
    const mz = z + dz;
    add(depth + 1, x + dx * 3, y, z + dz * 3, dx, dz);
    add(depth + 1, mx - dz * 2, y, mz + dx * 2, -dz, dx);
    add(depth + 1, mx + dz * 2, y, mz - dx * 2, dz, -dx);
  };
  const stairs = (depth, x, y, z, dx, dz) => {
    const box = boxAlong(x, y - 5, z, dx, dz, 9, 9);
    if (collides(box)) return;
    pieces.push({ kind: STAIRS, ...box, ex: x, ez: z, y, dx, dz });
    add(depth + 1, x + dx * 9, y - 5, z + dz * 9, dx, dz);
  };
  // The room, and corridors out of each side.
  const w = 7 + Math.floor(rand() * 6);
  const d = 7 + Math.floor(rand() * 6);
  const h = 4 + Math.floor(rand() * 3);
  const room = { kind: ROOM, x0: sx - (w >> 1), x1: sx - (w >> 1) + w - 1, y0: sy, y1: sy + h - 1, z0: sz - (d >> 1), z1: sz - (d >> 1) + d - 1 };
  pieces.push(room);
  for (let side = 0; side < 4; side++) {
    const [dx, dz] = DIRS[side];
    const along = dx ? d : w;
    for (let t = 1 + Math.floor(rand() * 3); t < along - 1; t += 4 + Math.floor(rand() * 4)) {
      const x = dx > 0 ? room.x1 + 1 : dx < 0 ? room.x0 - 1 : room.x0 + t;
      const z = dz > 0 ? room.z1 + 1 : dz < 0 ? room.z0 - 1 : room.z0 + t;
      add(1, x, sy, z, dx, dz);
    }
  }
  let x0 = Infinity;
  let z0 = Infinity;
  let x1 = -Infinity;
  let z1 = -Infinity;
  for (const p of pieces) {
    x0 = Math.min(x0, p.x0);
    z0 = Math.min(z0, p.z0);
    x1 = Math.max(x1, p.x1);
    z1 = Math.max(z1, p.z1);
  }
  return { x: sx, y: sy, z: sz, pieces, chests, spawners, box: [x0, z0, x1, z1] };
}

// ---------- The desert temple's shape ----------

// The four chests of the hidden room: [u, v, facing (DIRS index)], at floor - 11.
const TEMPLE_CHESTS = [
  [10, 12, 3],
  [10, 8, 1],
  [8, 10, 0],
  [12, 10, 2],
];

// A temple cell's block in its own frame (u, v 0-20 across, the entrance at
// v = 0; dy up from the floor), or -1 to leave the ground as it is.
function templeCell(u, dy, v, tnt, plate) {
  const c = 10;
  const du = Math.abs(u - c);
  const dv = Math.abs(v - c);
  if (dy < 0) {
    if (du > 3 || dv > 3) return -1;
    if (du <= 1 && dv <= 1) {
      if (dy >= -11) return dy === -11 && plate && u === c && v === c ? V.STONE_PRESSURE_PLATE : BLOCK.AIR;
      if (dy === -13 && tnt) return V.TNT;
      return V.SANDSTONE;
    }
    if ((dy === -11 || dy === -10) && ((du === 0 && dv === 2) || (du === 2 && dv === 0))) {
      if (dy === -10) return BLOCK.AIR;
      for (let i = 0; i < TEMPLE_CHESTS.length; i++) if (TEMPLE_CHESTS[i][0] === u && TEMPLE_CHESTS[i][1] === v) return CHEST_MARK + TEMPLE_CHESTS[i][2];
    }
    return dy >= -TEMPLE_DEPTH ? V.SANDSTONE : -1;
  }
  if (dy === 0) {
    if (u === c && v === c) return V.BLUE_TERRACOTTA;
    if (du + dv === 2 && du < 2 && dv < 2) return V.ORANGE_TERRACOTTA;
    if (du + dv === 3 && du <= 2 && dv <= 2) return V.ORANGE_TERRACOTTA;
    return V.SANDSTONE;
  }
  // The towers at the front corners, striped with orange terracotta.
  const tower = v <= 4 && (u <= 4 || u >= 16);
  if (tower && dy <= 10) {
    const tu = u <= 4 ? u : u - 16;
    if (dy === 10) return tu === 0 || tu === 4 || v === 0 || v === 4 ? V.CUT_SANDSTONE : BLOCK.AIR;
    if (v === 0 && (dy === 6 || dy === 8) && tu >= 1 && tu <= 3) return V.ORANGE_TERRACOTTA;
    if (v === 0 && dy === 7 && tu === 2) return V.CHISELED_SANDSTONE;
    return V.SANDSTONE;
  }
  // The doorway through the front of the pyramid.
  if (v <= 4 && du <= 1 && dy <= 3) return BLOCK.AIR;
  // The stepped pyramid: one ring a layer, hollow inside.
  const k = dy;
  if (k <= 9) {
    if (u < k || u > 20 - k || v < k || v > 20 - k) return BLOCK.AIR;
    if (k === 9) return V.CUT_SANDSTONE;
    if (u === k || u === 20 - k || v === k || v === 20 - k) return dy === 1 ? V.CUT_SANDSTONE : V.SANDSTONE;
    return BLOCK.AIR;
  }
  return BLOCK.AIR;
}

function templeWorld(t, u, v) {
  const n = TEMPLE_SIZE - 1;
  switch (t.rot) {
    case 1:
      return [t.x0 + n - v, t.z0 + u];
    case 2:
      return [t.x0 + n - u, t.z0 + n - v];
    case 3:
      return [t.x0 + v, t.z0 + n - u];
    default:
      return [t.x0 + u, t.z0 + v];
  }
}

function rotateDir(rot, du, dv) {
  if (rot === 1) return [-dv, du];
  if (rot === 2) return [-du, -dv];
  if (rot === 3) return [dv, -du];
  return [du, dv];
}

// ---------- Loot ----------

// Vanilla's chest tables (1.17): pools of [rolls min, max, entries [id,
// weight, min, max]]; id "book": an enchanted book (one random
// enchantment); id null: an item the game doesn't have (a saddle, a name
// tag, horse armour, music discs, rails), which takes its share and gives
// nothing.
const LOOT = {
  dungeon: [
    [1, 3, [[null, 20], [ITEM.GOLDEN_APPLE, 15, 1, 1], [null, 2], [null, 15], [null, 15], [null, 20], [null, 10], [null, 15], [null, 5], ["book", 10]]],
    [1, 4, [[V.IRON_INGOT, 10, 1, 4], [ITEM.GOLD_INGOT, 5, 1, 4], [V.BREAD, 20, 1, 1], [V.WHEAT, 20, 1, 4], [V.BUCKET, 10, 1, 1], [V.REDSTONE, 15, 1, 4], [ITEM.COAL, 15, 1, 4], [V.MELON_SEEDS, 10, 2, 4], [V.PUMPKIN_SEEDS, 10, 2, 4], [V.BEETROOT_SEEDS, 10, 2, 4]]],
    [3, 3, [[V.BONE, 10, 1, 8], [V.GUNPOWDER, 10, 1, 8], [V.ROTTEN_FLESH, 10, 1, 8], [V.STRING, 10, 1, 8]]],
  ],
  mineshaft: [
    [1, 1, [[ITEM.GOLDEN_APPLE, 20, 1, 1], [null, 1], [null, 30], ["book", 10], [ITEM.IRON_PICKAXE, 5, 1, 1], [null, 5]]],
    [2, 4, [[V.IRON_INGOT, 10, 1, 5], [ITEM.GOLD_INGOT, 5, 1, 3], [V.REDSTONE, 5, 4, 9], [V.LAPIS_LAZULI, 5, 4, 9], [V.DIAMOND, 3, 1, 2], [ITEM.COAL, 10, 3, 8], [V.BREAD, 15, 1, 3], [null, 15], [V.MELON_SEEDS, 10, 2, 4], [V.PUMPKIN_SEEDS, 10, 2, 4], [V.BEETROOT_SEEDS, 10, 2, 4]]],
    [3, 3, [[null, 20], [null, 5], [null, 5], [null, 5], [BLOCK.TORCH, 15, 1, 16]]],
  ],
  desert_pyramid: [
    [2, 4, [[V.DIAMOND, 5, 1, 3], [V.IRON_INGOT, 15, 1, 5], [ITEM.GOLD_INGOT, 15, 2, 7], [V.EMERALD, 15, 1, 3], [V.BONE, 25, 4, 6], [V.SPIDER_EYE, 25, 1, 3], [V.ROTTEN_FLESH, 25, 3, 7], [null, 20], [null, 15], [null, 10], [null, 5], ["book", 20], [ITEM.GOLDEN_APPLE, 20, 1, 1], [null, 2], [null, 15]]],
    [4, 4, [[V.BONE, 10, 1, 8], [V.GUNPOWDER, 10, 1, 8], [V.ROTTEN_FLESH, 10, 1, 8], [V.STRING, 10, 1, 8], [BLOCK.SAND, 10, 1, 8]]],
  ],
};
// Rolls a structure's table: [[id, count, tag?], ...].
export function rollStructureLoot(kind, rand = Math.random) {
  const pools = LOOT[kind];
  if (!pools) return null;
  const out = [];
  const have = (id) => id != null && (LIB.itemInfo ? !!LIB.itemInfo(id) : true);
  for (const [lo, hi, entries] of pools) {
    const total = entries.reduce((n, e) => n + e[1], 0);
    const rolls = lo + Math.floor(rand() * (hi - lo + 1));
    for (let k = 0; k < rolls; k++) {
      let w = rand() * total;
      for (const [id, weight, min = 1, max = 1] of entries) {
        w -= weight;
        if (w >= 0) continue;
        if (id === "book") {
          const b = enchantedBook(rand);
          if (b && have(b.id)) out.push([b.id, 1, b.tag]);
        } else if (have(id)) out.push([id, min + Math.floor(rand() * (max - min + 1))]);
        break;
      }
    }
  }
  return out;
}

// What a generated chest at (x, y, z) of a Survival world holds when first
// opened, if it is a structure's (chests.js), else null.
export function structureLootAt(world, x, y, z, rand = Math.random) {
  const kind = world?.terrain?.structures?.chestAt(x, y, z, (bx, by, bz) => world.getBlock(bx, by, bz));
  return kind ? rollStructureLoot(kind, rand) : null;
}

// ---------- Monster spawners in the game ----------

const SPAWNER_RANGE = 16; // a player this close wakes it (vanilla)
const SPAWN_REACH = 4; // spawns within 4 blocks across, 1 up or down
const SPAWN_COUNT = 4;
const MAX_NEARBY = 6;
const SCAN_EVERY = 0.5;
const LIGHT_LIMIT = 11; // (vanilla's classic spawner rule: light 11 or less)

// Monster spawners (vanilla's): a player within 16 blocks wakes one; every
// 10-40 s (the first time after 1 s) it tries to spawn 4 of its creature
// within 4 blocks, in light of 11 or less, unless 6 of them are already near.
// The host runs them (online every player wakes them; their creatures are
// the host's like any other); everyone sees the little flames in the cage
// of a spawner near them. The world's generated spawners are known from the
// seed (StructureGrower.spawnersIn); a player's (Creative) from the edits.
export class Spawners {
  // deps: { world, mobs, effects }
  constructor({ world, mobs = null, effects = null }) {
    this.world = world;
    this.mobs = mobs;
    this.effects = effects;
    this.active = []; // [{ x, y, z, kind, key, near (the local player is in range) }]
    this.state = new Map(); // key -> { delay }
    this._scanT = 0;
    this._flameT = 0;
    this._found = new Map(); // chunk key -> [[x, y, z]] (cache)
    this.rand = Math.random;
    world.changeListeners?.push((changed) => {
      for (let i = 0; i < changed.length; i += 3) {
        if (isSpawner(world.getBlock(changed[i], changed[i + 1], changed[i + 2]))) this._found.delete(chunkKey(changed[i] >> 4, changed[i + 2] >> 4));
      }
    });
  }

  // centers: the players' positions (the first: this player's); authority:
  // whether this peer spawns (the host, or a single player).
  update(dt, centers, authority = true) {
    if (!centers?.length) return;
    this._scanT -= dt;
    if (this._scanT <= 0) {
      this._scanT = SCAN_EVERY;
      this._scan(authority ? centers : centers.slice(0, 1));
    }
    if (!this.active.length) return;
    if (authority) {
      for (const s of this.active) {
        let st = this.state.get(s.key);
        if (!st) this.state.set(s.key, (st = { delay: 1 }));
        st.delay -= dt;
        if (st.delay > 0) continue;
        st.delay = this._spawn(s) ? 10 + this.rand() * 30 : 1;
      }
    }
    this._flames(dt);
  }

  // The spawners within reach of a player, still standing.
  _scan(centers) {
    const w = this.world;
    const seen = new Set();
    this.active.length = 0;
    const local = centers[0];
    for (const c of centers) {
      const pcx = Math.floor(c.x) >> 4;
      const pcz = Math.floor(c.z) >> 4;
      for (let dz = -1; dz <= 1; dz++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (!w.getChunk(pcx + dx, pcz + dz)) continue;
          for (const [x, y, z] of this._spawnersIn(pcx + dx, pcz + dz)) {
            const key = `${x},${y},${z}`;
            if (seen.has(key)) continue;
            const id = w.getBlock(x, y, z);
            if (!isSpawner(id)) continue;
            const d2 = (x + 0.5 - c.x) ** 2 + (y + 0.5 - c.y) ** 2 + (z + 0.5 - c.z) ** 2;
            if (d2 > SPAWNER_RANGE * SPAWNER_RANGE) continue;
            seen.add(key);
            const near = (x + 0.5 - local.x) ** 2 + (y + 0.5 - local.y) ** 2 + (z + 0.5 - local.z) ** 2 <= SPAWNER_RANGE * SPAWNER_RANGE;
            this.active.push({ x, y, z, kind: SPAWNER_KINDS[id - SPAWNER], key, near });
          }
        }
      }
    }
    // (asleep again: the next waking waits its first second again)
    for (const key of this.state.keys()) if (!seen.has(key)) this.state.delete(key);
  }

  // The spawners standing in chunk (cx, cz) (generated ones: in the columns
  // the seed gives, found once; a player's: from the chunk's edits).
  _spawnersIn(cx, cz) {
    const key = chunkKey(cx, cz);
    let list = this._found.get(key);
    if (!list) {
      list = [];
      const spots = this.world.terrain?.structures?.spawnerSpots(cx, cz);
      if (spots) {
        for (const [x, z] of spots.columns) {
          for (let y = 2; y <= DUNGEON_MAX_Y; y++) if (isSpawner(this.world.getBlock(x, y, z))) list.push([x, y, z]);
        }
        list.push(...spots.cells);
      }
      const edits = this.world.edits?.get(key);
      if (edits) {
        for (const [i, id] of edits) if (isSpawner(id)) list.push([cx * S + (i & 15), i >> 8, cz * S + ((i >> 4) & 15)]);
      }
      remember(this._found, key, list, 512);
    }
    return list;
  }

  // One round of spawning; true if anything came of it.
  _spawn(s) {
    const mobs = this.mobs;
    const w = this.world;
    if (!LIB.spawnMob) return false;
    let near = 0;
    for (const m of mobs?.mobs || []) {
      if (!m.dead && m.kind === s.kind && Math.abs(m.pos.x - s.x - 0.5) <= SPAWN_REACH + 1 && Math.abs(m.pos.y - s.y) <= SPAWN_REACH + 1 && Math.abs(m.pos.z - s.z - 0.5) <= SPAWN_REACH + 1) near++;
    }
    if (near >= MAX_NEARBY) return true; // (vanilla: full, the wait starts over)
    const tall = s.kind === "spider" ? 1 : 2;
    const daylight = mobs?.sky?.daylight ?? 1;
    let spawned = false;
    for (let k = 0; k < SPAWN_COUNT; k++) {
      const x = s.x + 0.5 + (this.rand() - this.rand()) * SPAWN_REACH;
      const y = s.y + Math.floor(this.rand() * 3) - 1;
      const z = s.z + 0.5 + (this.rand() - this.rand()) * SPAWN_REACH;
      const bx = Math.floor(x);
      const bz = Math.floor(z);
      let free = true;
      for (let h = 0; h < tall && free; h++) {
        const id = w.getBlock(bx, y + h, bz);
        free = !IS_SOLID[id] && !IS_WET[id] && !isSpawner(id);
      }
      if (!free) continue;
      const l = w.lightAt(bx, y, bz);
      if (Math.max(l.block, l.sky * daylight) > LIGHT_LIMIT) continue;
      if (!LIB.spawnMob(s.kind, x, y, z)) continue;
      spawned = true;
      this.effects?.smoke?.spawn({ x, y: y + 0.6, z, vy: 0.4, life: 0.8, size0: 0.5, size1: 1.1, color0: SMOKE, alpha: 0.6, drag: 1.5 });
    }
    return spawned;
  }

  // Little flames and smoke in the cages near this player (as vanilla's).
  _flames(dt) {
    const fx = this.effects;
    if (!fx?.glow) return;
    this._flameT -= dt;
    if (this._flameT > 0) return;
    this._flameT = 0.15;
    let n = 0;
    for (const s of this.active) {
      if (!s.near || n++ >= 4) continue;
      const r = this.rand;
      fx.glow.spawn({ x: s.x + 0.2 + r() * 0.6, y: s.y + 0.15 + r() * 0.5, z: s.z + 0.2 + r() * 0.6, vy: 0.5, life: 0.45, size0: 0.16, size1: 0.04, color0: FLAME, color1: FLAME_END });
      if (r() < 0.5) fx.smoke?.spawn({ x: s.x + 0.5, y: s.y + 0.8, z: s.z + 0.5, vy: 0.6, life: 0.9, size0: 0.15, size1: 0.35, color0: SMOKE, alpha: 0.5, drag: 1 });
    }
  }
}

// (Plain colour objects: the particle pools only read r, g, b.)
const FLAME = { r: 3.2, g: 1.4, b: 0.35 };
const FLAME_END = { r: 0.9, g: 0.18, b: 0.04 };
const SMOKE = { r: 0.3, g: 0.3, b: 0.32 };

// (For tests: the shapes' cells and constants.)
export const STRUCTURE_INFO = { TEMPLE_SIZE, TEMPLE_SPACING, MINE_REGION, templeCell };
