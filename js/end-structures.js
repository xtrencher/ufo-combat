// The End's structures (Round 12): end cities (purpur towers, bridges and
// the end ship), the chorus trees of the outer islands, the end gateways'
// shape and their ring, and the loot of the cities' chests. Deterministic
// from the seed and pure (no three.js): js/dim-end.js runs it in the chunk
// workers too, so every generator agrees.
//
// As vanilla's (Java 1.20), simplified where noted:
// - End cities: one try per region of 20 x 20 chunks (vanilla's spacing,
//   11 apart at least), on the outer islands (1000 blocks and more from the
//   middle) where the ground is high enough (vanilla: 60 and up at the four
//   corners; here the islands are lower, 52 and up). A city is a base room
//   and a tower of three to five floors (purpur walls, purpur pillars at the
//   corners, end stone brick floors, magenta windows, a ladder up the inside,
//   end rods on the roof), most often a bridge to a second tower, and one
//   time in three an end ship moored at the city's edge: its hull of purpur,
//   a dragon head on the bow, two chests and the elytra's chest in its cabin
//   (vanilla's item frame: the game has none, so the elytra waits in a chest
//   of its own), a brewing stand. Chests: vanilla's end_city_treasure (its
//   enchanted gear comes plain). Shulkers sit where shulkerSpots says (the
//   creatures' part spawns them: a box attached to a wall or floor).
// - Chorus trees: vanilla's ChorusFlowerBlock.generatePlant (up to 8 blocks
//   out, four branchings), 0-3 a chunk on the outer islands.
// - Gateways: the 20 places on the ring of radius 96 at y 75 (vanilla's,
//   shuffled by the seed); a gateway is its block between bedrock, as
//   vanilla's EndGatewayFeature. They are made by edits (js/dragon.js), as
//   the dragon dies and as a player comes through one.
import { mulberry32, hash2 } from "./noise.js";
import { BLOCK, BLOCK_INFO, chest } from "./blocks.js";
import { CHUNK_SIZE, WORLD_HEIGHT, chunkKey } from "./constants.js";
import { ITEM } from "./content/base.js";
import * as V from "./content/ids.js";
import { STAINED_GLASS } from "./content/decor.js";

const S = CHUNK_SIZE;
const FX = [0, 0, 1, -1];
const FZ = [1, -1, 0, 0];
const OPP = [1, 0, 3, 2];
export const OUTER_START = 1000; // blocks from the middle where the outer islands begin

// ---------- Loot ----------

// (structures.js's format: pools of [rolls min, max, [[id, weight, min, max]]]; null: a thing the game lacks)
export const END_CITY_LOOT = {
  end_city_treasure: [
    [2, 6, [
      [V.DIAMOND, 5, 2, 7], [V.IRON_INGOT, 10, 4, 8], [ITEM.GOLD_INGOT, 15, 2, 7], [V.EMERALD, 2, 2, 6], [V.BEETROOT_SEEDS, 5, 1, 10],
      [null, 3], [null, 1], [null, 1], [null, 1], // (a saddle, horse armour)
      [ITEM.DIAMOND_SWORD, 3], [ITEM.DIAMOND_BOOTS, 3], [ITEM.DIAMOND_CHESTPLATE, 3], [ITEM.DIAMOND_LEGGINGS, 3], [ITEM.DIAMOND_HELMET, 3], [ITEM.DIAMOND_PICKAXE, 3], [ITEM.DIAMOND_SHOVEL, 3],
      [ITEM.IRON_SWORD, 3], [ITEM.IRON_BOOTS, 3], [ITEM.IRON_CHESTPLATE, 3], [ITEM.IRON_LEGGINGS, 3], [ITEM.IRON_HELMET, 3], [ITEM.IRON_PICKAXE, 3], [ITEM.IRON_SHOVEL, 3],
    ]],
    [1, 1, [[null, 1], [null, 14]]], // (the spire armour trim template)
  ],
  // (the ship's item frame, as a chest: the elytra)
  end_ship_elytra: [[1, 1, [[V.ELYTRA, 1, 1, 1]]]],
};

// ---------- Gateways ----------

export const GATEWAY_Y = 75;
export const GATEWAY_RING = 96;
// The 20 gateway places in the order they open (vanilla: the ring's
// positions shuffled by the world seed).
export function gatewayOrder(seed) {
  const list = [];
  for (let i = 0; i < 20; i++) {
    const a = 2 * (-Math.PI + 0.15707963267948966 * i);
    list.push([Math.floor(GATEWAY_RING * Math.cos(a)), GATEWAY_Y, Math.floor(GATEWAY_RING * Math.sin(a))]);
  }
  const rand = mulberry32((seed ^ 0x6a7e3a11) >>> 0);
  for (let i = list.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [list[i], list[j]] = [list[j], list[i]];
  }
  return list;
}
// A gateway at (x, y, z): its block, bedrock in a cross above and below and
// a cap on each, air around it (vanilla's EndGatewayFeature).
export function gatewayCells(x, y, z) {
  const out = [];
  for (let dx = -1; dx <= 1; dx++) {
    for (let dz = -1; dz <= 1; dz++) {
      for (let dy = -2; dy <= 2; dy++) {
        const cx = dx === 0;
        const cz = dz === 0;
        const far = Math.abs(dy) === 2;
        let id = BLOCK.AIR;
        if (cx && cz && dy === 0) id = V.END_GATEWAY;
        else if (dy === 0) id = BLOCK.AIR;
        else if (far && cx && cz) id = BLOCK.BEDROCK;
        else if ((cx || cz) && !far) id = BLOCK.BEDROCK;
        out.push(x + dx, y + dy, z + dz, id);
      }
    }
  }
  return out;
}

// ---------- Chorus trees ----------

// Vanilla's generatePlant: cells of one tree rooted at (x, y, z): a Map of
// "x,y,z" -> id. rand: its own random numbers.
export function chorusTree(x, y, z, rand, spread = 8) {
  const cells = new Map();
  const key = (a, b, c) => `${a},${b},${c}`;
  const empty = (a, b, c) => b < WORLD_HEIGHT && !cells.has(key(a, b, c));
  const around = (a, b, c, except) => {
    for (let d = 0; d < 4; d++) if (d !== except && !empty(a + FX[d], b, c + FZ[d])) return false;
    return true;
  };
  const set = (a, b, c, id) => b < WORLD_HEIGHT && cells.set(key(a, b, c), id);
  set(x, y, z, V.CHORUS_PLANT);
  const grow = (bx, by, bz, depth) => {
    let h = Math.floor(rand() * 4) + 1;
    if (depth === 0) h++;
    for (let j = 0; j < h; j++) {
      if (!around(bx, by + j + 1, bz, -1)) return;
      set(bx, by + j + 1, bz, V.CHORUS_PLANT);
      set(bx, by + j, bz, V.CHORUS_PLANT);
    }
    let grew = false;
    if (depth < 4) {
      let k = Math.floor(rand() * 4);
      if (depth === 0) k++;
      for (let l = 0; l < k; l++) {
        const d = Math.floor(rand() * 4);
        const nx = bx + FX[d];
        const ny = by + h;
        const nz = bz + FZ[d];
        if (Math.abs(nx - x) < spread && Math.abs(nz - z) < spread && empty(nx, ny, nz) && empty(nx, ny - 1, nz) && around(nx, ny, nz, OPP[d])) {
          grew = true;
          set(nx, ny, nz, V.CHORUS_PLANT);
          set(nx - FX[d], ny, nz - FZ[d], V.CHORUS_PLANT);
          grow(nx, ny, nz, depth + 1);
        }
      }
    }
    if (!grew) set(bx, by + h, bz, V.CHORUS_FLOWER + 5);
  };
  grow(x, y, z, 0);
  return cells;
}

// ---------- End cities ----------

const CITY_REGION = 20; // chunks (vanilla's spacing)
const CITY_SPREAD = 9; // chunks within a region a city may start (vanilla: spacing - separation)
const CITY_SALT = 0x10387312; // (vanilla's end city salt)
const CITY_REACH = 64; // blocks from its middle a city's cells may reach
const CITY_MIN_TOP = 52;

// A city's cells as it is planned: set(x, y, z, id) in world coordinates,
// then bucketed by chunk for the generator.
class Plan {
  constructor() {
    this.cells = new Map(); // "x,y,z" -> id
    this.chests = []; // [x, y, z, kind]
    this.shulkers = []; // [x, y, z]
    this.byChunk = null;
  }
  set(x, y, z, id) {
    if (y < 1 || y >= WORLD_HEIGHT) return;
    this.cells.set(`${x},${y},${z}`, id);
  }
  get(x, y, z) {
    return this.cells.get(`${x},${y},${z}`);
  }
  fill(x0, y0, z0, x1, y1, z1, id) {
    for (let x = Math.min(x0, x1); x <= Math.max(x0, x1); x++) for (let y = Math.min(y0, y1); y <= Math.max(y0, y1); y++) for (let z = Math.min(z0, z1); z <= Math.max(z0, z1); z++) this.set(x, y, z, id);
  }
  // (the four walls of a box, nothing on top or below)
  walls(x0, y0, z0, x1, y1, z1, id) {
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        this.set(x, y, z0, id);
        this.set(x, y, z1, id);
      }
      for (let z = z0; z <= z1; z++) {
        this.set(x0, y, z, id);
        this.set(x1, y, z, id);
      }
    }
  }
  finish() {
    const by = new Map();
    for (const [k, id] of this.cells) {
      const [x, y, z] = k.split(",").map(Number);
      const ck = chunkKey(x >> 4, z >> 4);
      let list = by.get(ck);
      if (!list) by.set(ck, (list = []));
      list.push((y << 8) | ((z & 15) << 4) | (x & 15), id);
    }
    this.byChunk = by;
    this.cells = null;
    return this;
  }
}

const has = (id) => !!BLOCK_INFO[id];
// (the blocks a city is built of, each with its stand-in while another part's is missing)
function palette() {
  return {
    wall: V.PURPUR_BLOCK,
    pillar: V.PURPUR_PILLAR,
    floor: V.END_STONE_BRICKS,
    slab: has(V.PURPUR_SLAB) ? V.PURPUR_SLAB : V.PURPUR_BLOCK,
    slabTop: has(V.PURPUR_SLAB) ? V.PURPUR_SLAB + 1 : V.PURPUR_BLOCK,
    stairs: (f, top = false) => (has(V.PURPUR_STAIRS) ? V.PURPUR_STAIRS + f + (top ? 4 : 0) : V.PURPUR_BLOCK),
    glass: has(STAINED_GLASS + 2) ? STAINED_GLASS + 2 : BLOCK.GLASS, // (magenta)
    rod: V.END_ROD + 2, // (pointing up)
    rodDown: V.END_ROD + 3,
    ladder: (f) => (has(V.LADDER) ? V.LADDER + f : BLOCK.AIR),
  };
}

export class EndCities {
  // gen: the End's generator (its column(x, z): [bottom, top] or null).
  constructor(gen) {
    this.gen = gen;
    this.seed = gen.seed;
    this._plans = new Map(); // "rx,rz" -> plan or null
    this._trees = new Map(); // "x,z" -> tree cells or null
  }

  // The city planned from region (rx, rz), or null.
  cityAt(rx, rz) {
    const key = `${rx},${rz}`;
    if (this._plans.has(key)) return this._plans.get(key);
    let plan = null;
    const rand = mulberry32((this.seed ^ Math.imul(rx, 341873128) ^ Math.imul(rz, 132897987) ^ CITY_SALT) >>> 0);
    const cx = rx * CITY_REGION + Math.floor(rand() * CITY_SPREAD);
    const cz = rz * CITY_REGION + Math.floor(rand() * CITY_SPREAD);
    const x = cx * S + 8;
    const z = cz * S + 8;
    if (Math.hypot(x, z) > OUTER_START + 40) {
      // (on high enough ground, at its middle and its four corners)
      const tops = [[0, 0], [-7, -7], [7, -7], [-7, 7], [7, 7]].map(([dx, dz]) => this.gen.column(x + dx, z + dz)?.[1] ?? -1);
      if (Math.min(...tops) >= CITY_MIN_TOP) plan = buildCity(x, Math.max(...tops) + 1, z, rand);
    }
    if (this._plans.size > 64) this._plans.delete(this._plans.keys().next().value);
    this._plans.set(key, plan);
    return plan;
  }

  _citiesNear(x0, z0, x1, z1) {
    const out = [];
    const span = CITY_REGION * S;
    for (let rz = Math.floor((z0 - CITY_REACH) / span); rz <= Math.floor((z1 + CITY_REACH) / span); rz++) {
      for (let rx = Math.floor((x0 - CITY_REACH) / span); rx <= Math.floor((x1 + CITY_REACH) / span); rx++) {
        const p = this.cityAt(rx, rz);
        if (p) out.push(p);
      }
    }
    return out;
  }

  // The chorus trees whose cells may reach chunk (cx, cz): each a Map.
  _treesNear(cx, cz) {
    const out = [];
    for (let dz = -1; dz <= 1; dz++) {
      for (let dx = -1; dx <= 1; dx++) {
        for (const t of this._chunkTrees(cx + dx, cz + dz)) out.push(t);
      }
    }
    return out;
  }

  _chunkTrees(cx, cz) {
    const key = `${cx},${cz}`;
    let list = this._trees.get(key);
    if (list) return list;
    list = [];
    const bx = cx * S;
    const bz = cz * S;
    if (Math.hypot(bx + 8, bz + 8) > OUTER_START) {
      const rand = mulberry32((this.seed ^ Math.imul(cx, 0x27d4eb2d) ^ Math.imul(cz, 0x165667b1) ^ 0x3c6ef372) >>> 0);
      const n = Math.floor(rand() * 4);
      for (let i = 0; i < n; i++) {
        const x = bx + Math.floor(rand() * S);
        const z = bz + Math.floor(rand() * S);
        const col = this.gen.column(x, z);
        if (!col || col[1] < 50 || col[1] - col[0] < 3) continue;
        list.push(chorusTree(x, col[1] + 1, z, mulberry32((rand() * 4294967296) >>> 0)));
      }
    }
    if (this._trees.size > 256) this._trees.delete(this._trees.keys().next().value);
    this._trees.set(key, list);
    return list;
  }

  // Into a chunk of the End (after its islands): chorus trees, then cities.
  placeInChunk(blocks, cx, cz) {
    const bx = cx * S;
    const bz = cz * S;
    if (Math.hypot(bx + 8, bz + 8) < OUTER_START - 80) return;
    for (const tree of this._treesNear(cx, cz)) {
      for (const [k, id] of tree) {
        const [x, y, z] = k.split(",").map(Number);
        if (x >> 4 !== cx || z >> 4 !== cz) continue;
        const i = (y << 8) | ((z & 15) << 4) | (x & 15);
        if (blocks[i] === BLOCK.AIR) blocks[i] = id;
      }
    }
    const ck = chunkKey(cx, cz);
    for (const p of this._citiesNear(bx, bz, bx + S - 1, bz + S - 1)) {
      const list = p.byChunk.get(ck);
      if (!list) continue;
      for (let i = 0; i < list.length; i += 2) blocks[list[i]] = list[i + 1];
    }
  }

  // "end_city_treasure", "end_ship_elytra" or null: a city's chest at (x, y, z).
  chestAt(x, y, z) {
    for (const p of this._citiesNear(x, z, x, z)) {
      for (const c of p.chests) if (c[0] === x && c[1] === y && c[2] === z) return c[3];
    }
    return null;
  }

  // Where a city's shulkers sit in chunk (cx, cz): [[x, y, z], ...] (the
  // creatures' part spawns one there the first time the chunk loads).
  shulkerSpots(cx, cz) {
    const out = [];
    const bx = cx * S;
    const bz = cz * S;
    for (const p of this._citiesNear(bx, bz, bx + S - 1, bz + S - 1)) for (const s of p.shulkers) if (s[0] >> 4 === cx && s[2] >> 4 === cz) out.push(s.slice());
    return out;
  }

  // The cities whose middle is within r blocks of (x, z): [{ x, y, z }] (tests, the creatures' part).
  citiesNear(x, z, r) {
    return this._citiesNear(x - r, z - r, x + r, z + r).filter((p) => Math.hypot(p.x - x, p.z - z) <= r).map((p) => ({ x: p.x, y: p.y, z: p.z, ship: p.ship }));
  }
}

// ---------- A city's pieces ----------

// A tower at (x, y, z) (its floor's middle): a 9 x 9 base room, then
// `stories` floors of 7 x 7 and the roof; `door`: the base room's doorway
// side (a facing). Its chests and shulkers go into the plan's lists.
function buildTower(p, x, y, z, stories, door, rand, P) {
  // The base room.
  p.fill(x - 4, y, z - 4, x + 4, y, z + 4, P.floor);
  p.fill(x - 3, y + 1, z - 3, x + 3, y + 4, z + 3, BLOCK.AIR);
  p.walls(x - 4, y + 1, z - 4, x + 4, y + 4, z + 4, P.wall);
  for (const [dx, dz] of [[-4, -4], [4, -4], [-4, 4], [4, 4]]) p.fill(x + dx, y + 1, z + dz, x + dx, y + 4, z + dz, P.pillar);
  p.fill(x - 4, y + 5, z - 4, x + 4, y + 5, z + 4, P.wall);
  // (a ledge of slabs round the roof of the base)
  for (let k = -5; k <= 5; k++) for (const [a, b] of [[k, -5], [k, 5], [-5, k], [5, k]]) p.set(x + a, y + 5, z + b, P.slab);
  // the doorway, 3 wide and 3 high
  const f = door;
  for (let k = -1; k <= 1; k++) for (let h = 1; h <= 3; h++) p.set(x + FX[f] * 4 + FZ[f] * k, y + h, z + FZ[f] * 4 + FX[f] * k, BLOCK.AIR);
  // windows of the base room
  for (let d = 0; d < 4; d++) if (d !== f) for (const k of [-2, 2]) p.set(x + FX[d] * 4 + FZ[d] * k, y + 2, z + FZ[d] * 4 + FX[d] * k, P.glass);
  // (the ladder's side: across from the doorway; its pillar in the base
  // room, the tower's wall above)
  const ld = OPP[f];
  const lx = x + FX[ld] * 2;
  const lz = z + FZ[ld] * 2;
  const top = y + 5 + stories * 4;
  p.fill(x + FX[ld] * 3, y + 1, z + FZ[ld] * 3, x + FX[ld] * 3, y + 4, z + FZ[ld] * 3, P.pillar);
  // The floors.
  for (let s = 0; s < stories; s++) {
    const by = y + 6 + s * 4; // (the first air row of the floor)
    p.fill(x - 2, by, z - 2, x + 2, by + 2, z + 2, BLOCK.AIR);
    p.walls(x - 3, by, z - 3, x + 3, by + 2, z + 3, P.wall);
    for (const [dx, dz] of [[-3, -3], [3, -3], [-3, 3], [3, 3]]) p.fill(x + dx, by, z + dz, x + dx, by + 2, z + dz, P.pillar);
    // its ceiling (the next one's floor)
    p.fill(x - 3, by + 3, z - 3, x + 3, by + 3, z + 3, P.floor);
    // windows in the middle of each side (not the ladder's)
    for (let d = 0; d < 4; d++) if (d !== ld) p.set(x + FX[d] * 3, by + 1, z + FZ[d] * 3, P.glass);
    // a shulker on every other floor, against a wall
    if (s % 2 === 0) p.shulkers.push([x + 2, by, z - 2]);
  }
  // The roof: a slab crown, pillars at its corners with end rods on them, a spire.
  p.fill(x - 4, top, z - 4, x + 4, top, z + 4, P.slab);
  p.fill(x - 3, top, z - 3, x + 3, top, z + 3, P.floor);
  // a ladder up the inside of that wall, from the base room's floor through every ceiling
  for (let h = y + 1; h <= top; h++) p.set(lx, h, lz, P.ladder(f));
  for (const [dx, dz] of [[-3, -3], [3, -3], [-3, 3], [3, 3]]) {
    p.fill(x + dx, top + 1, z + dz, x + dx, top + 2, z + dz, P.pillar);
    p.set(x + dx, top + 3, z + dz, P.rod);
  }
  for (let d = 0; d < 4; d++) for (let k = -2; k <= 2; k++) p.set(x + FX[d] * 3 + FZ[d] * k, top + 1, z + FZ[d] * 3 + FX[d] * k, P.stairs(OPP[d]));
  p.fill(x, top + 1, z, x, top + 3, z, P.pillar);
  p.set(x, top + 4, z, P.rod);
  // The top floor's treasure: two chests against its +X wall.
  const ty = y + 6 + (stories - 1) * 4;
  for (const dz of [-1, 1]) {
    p.set(x + 2, ty, z + dz, chest(-1, 0));
    p.chests.push([x + 2, ty, z + dz, "end_city_treasure"]);
  }
  p.shulkers.push([x, top + 1, z + 2]);
  return top;
}

// A bridge from (x, y, z) `len` blocks toward facing f: an end stone brick
// path three wide, purpur slab rails, an end rod lamp under it every 4.
function buildBridge(p, x, y, z, f, len, P) {
  for (let i = 0; i < len; i++) {
    const bx = x + FX[f] * i;
    const bz = z + FZ[f] * i;
    for (let k = -1; k <= 1; k++) {
      p.set(bx + FZ[f] * k, y, bz + FX[f] * k, P.floor);
      for (let h = 1; h <= 3; h++) p.set(bx + FZ[f] * k, y + h, bz + FX[f] * k, BLOCK.AIR);
    }
    for (const k of [-2, 2]) {
      p.set(bx + FZ[f] * k, y, bz + FX[f] * k, P.wall);
      p.set(bx + FZ[f] * k, y + 1, bz + FX[f] * k, P.slab);
    }
    if (i % 4 === 2) p.set(bx, y - 1, bz, P.rodDown);
  }
}

// The end ship, moored at (x, y, z) (its deck's middle, beside the city),
// its bow toward facing f: a hull of purpur stepping in to the keel, a deck,
// a cabin at the stern with the chests and the brewing stand, a mast, the
// dragon head on the bow.
function buildShip(p, x, y, z, f, P) {
  const L = 12; // (half its length)
  const at = (w, v, u) => [x + FX[f] * w + FZ[f] * u, y + v, z + FZ[f] * w + FX[f] * u];
  const put = (w, v, u, id) => {
    const [a, b, c] = at(w, v, u);
    p.set(a, b, c, id);
  };
  // the hull: wider toward the deck, narrower toward the bow and stern
  for (let w = -L; w <= L; w++) {
    const taper = Math.max(0, Math.abs(w) - (L - 4));
    for (let v = -4; v <= 0; v++) {
      const half = Math.max(0, 3 + Math.min(0, v + 1) - taper);
      if (v === -4 && Math.abs(w) > L - 3) continue;
      for (let u = -half; u <= half; u++) {
        const edge = Math.abs(u) === half || v === -4 || v === 0;
        put(w, v, u, edge ? (v === 0 ? P.floor : P.wall) : BLOCK.AIR);
      }
    }
    // the gunwales
    const half = Math.max(0, 3 - taper);
    for (const u of [-half, half]) put(w, 1, u, P.slab);
  }
  // a hatch down into the hold
  put(-2, 0, 0, BLOCK.AIR);
  // the bow: a beak of stairs, the dragon head on it
  put(L + 1, 0, 0, P.stairs(f));
  put(L + 1, 1, 0, has(V.DRAGON_HEAD) ? V.DRAGON_HEAD + f : P.wall);
  // the cabin at the stern
  for (let w = -L + 1; w <= -L + 6; w++) {
    for (let u = -2; u <= 2; u++) {
      for (let v = 1; v <= 4; v++) {
        const edge = w === -L + 1 || w === -L + 6 || Math.abs(u) === 2 || v === 4;
        put(w, v, u, edge ? (v === 4 ? P.slab : P.wall) : BLOCK.AIR);
      }
    }
  }
  // its door toward the bow, its windows
  put(-L + 6, 1, 0, BLOCK.AIR);
  put(-L + 6, 2, 0, BLOCK.AIR);
  for (const u of [-2, 2]) put(-L + 4, 2, u, P.glass);
  // the chests and the stand inside; the elytra's chest at the back
  const chestAt = (w, u, kind) => {
    const [a, b, c] = at(w, 1, u);
    // (facing into the cabin: toward the bow, or across it)
    const [fx, fz] = u === 0 ? [FX[f], FZ[f]] : [-FZ[f] * Math.sign(u), -FX[f] * Math.sign(u)];
    p.set(a, b, c, chest(fx, fz));
    p.chests.push([a, b, c, kind]);
  };
  chestAt(-L + 2, 0, "end_ship_elytra");
  chestAt(-L + 3, 1, "end_city_treasure");
  chestAt(-L + 3, -1, "end_city_treasure");
  if (has(V.BREWING_STAND)) put(-L + 5, 1, 1, V.BREWING_STAND);
  // the mast, an end rod at its top
  for (let v = 1; v <= 9; v++) put(2, v, 0, P.pillar);
  for (let u = -3; u <= 3; u++) put(2, 7, u, u === 0 ? P.pillar : P.slab);
  put(2, 10, 0, P.rod);
  // lamps under the keel
  put(0, -5, 0, P.rodDown);
  put(-6, -5, 0, P.rodDown);
  put(6, -5, 0, P.rodDown);
  // shulkers: the deck's two guards, one in the hold
  const s1 = at(6, 1, 1);
  const s2 = at(-4, 1, -2);
  const s3 = at(0, -3, 0);
  p.shulkers.push(s1, s2, s3);
}

// A whole city from its middle (x, ground y, z): one tower, often a bridge
// to a second one, sometimes the ship.
function buildCity(x, y, z, rand) {
  const P = palette();
  const p = new Plan();
  p.x = x;
  p.y = y;
  p.z = z;
  const f = Math.floor(rand() * 4);
  const stories = 3 + Math.floor(rand() * 3);
  buildTower(p, x, y, z, stories, f, rand, P);
  let far = null;
  if (rand() < 0.75) {
    // a bridge out of the doorway, a second (shorter) tower at its end
    const len = 12 + Math.floor(rand() * 8);
    buildBridge(p, x + FX[f] * 5, y, z + FZ[f] * 5, f, len, P);
    const tx = x + FX[f] * (len + 9);
    const tz = z + FZ[f] * (len + 9);
    buildTower(p, tx, y, tz, 2 + Math.floor(rand() * 2), OPP[f], rand, P);
    far = [tx, tz];
  }
  p.ship = false;
  if (rand() < 0.35) {
    // the ship moored beside the second tower (or the first), its bow along the bridge
    const side = rand() < 0.5 ? 1 : -1;
    const [ax, az] = far || [x, z];
    const g = side > 0 ? (f === 0 ? 2 : f === 1 ? 3 : f === 2 ? 1 : 0) : f === 0 ? 3 : f === 1 ? 2 : f === 2 ? 0 : 1;
    const sx = ax + FX[g] * 14;
    const sz = az + FZ[g] * 14;
    buildShip(p, sx, y + 6, sz, f, P);
    // a gangway from the tower's second floor to the ship's side
    buildBridge(p, ax + FX[g] * 4, y + 6, az + FZ[g] * 4, g, 7, P);
    for (let h = 0; h <= 2; h++) p.set(ax + FX[g] * 3, y + 6 + h, az + FZ[g] * 3, BLOCK.AIR);
    p.ship = true;
  }
  return p.finish();
}

// (For tests: a deterministic hash of a city's region.)
export const CITY_INFO = { CITY_REGION, CITY_SPREAD, CITY_MIN_TOP, hash: (seed, x, z) => hash2(seed, x, z) };
