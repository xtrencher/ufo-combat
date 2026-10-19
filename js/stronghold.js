// Strongholds (Round 12): the Overworld's 128 strongholds of a Survival
// world, as vanilla's (Java 1.20), deterministic from the seed and pure (no
// three.js: the chunk workers cut them through terrain.js and
// js/structures.js, which calls placeUnderground, chestAt and spawnerCells).
//
// - Where: vanilla's concentric rings (ConcentricRingsStructurePlacement:
//   distance 32, spread 3, count 128): 3 in the first ring (1280-2816 blocks
//   from the middle), 6 in the next, then 10, 15, 21, 28, 36 and 9; each moved
//   to land within 112 blocks (vanilla's biome bias: here the first column
//   above the sea on a spiral round it, sampled lazily). Their floors are
//   18-23 blocks under the ground there (5-24 up); nothing is cut within 2 of the surface
//   (as the mineshafts: the ocean floor is never opened).
// - What: vanilla's pieces, planned as a whole from the start (a crossing
//   room) and cut chunk by chunk: corridors (some with side doors, some with
//   a chest in an alcove), left and right turns, crossing rooms (a pillar
//   with torches, or a store room with a chest), stairs down, prison halls
//   (iron bars, iron doors), a library (bookshelves, cobwebs, a chest) and
//   the portal room, up to 40 pieces within 80 blocks; their stone bricks
//   mossy and cracked at random (vanilla's selector, no infested ones: the
//   silverfish are the creatures' part). Doors between pieces: an opening, a
//   wooden door, iron bars (grates) or an iron door with a stone button on
//   each side.
// - The portal room (vanilla's PortalRoom, 11 x 8 x 16): lava at its far
//   corners and under the portal, the stairs up to the dais with the
//   silverfish spawner on the top step, iron bar windows, twelve end portal
//   frames turned toward the 3 x 3 inside them, each with an eye one time in
//   ten (all twelve: the portal is open from the start).
// - Loot (chestAt): vanilla's stronghold_corridor, stronghold_crossing and
//   stronghold_library tables (an item the game lacks keeps its weight and
//   gives nothing, as structures.js's).
import { mulberry32 } from "./noise.js";
import { BLOCK, BLOCK_INFO, IS_WET, chest, wallTorch } from "./blocks.js";
import { CHUNK_SIZE, SEA_LEVEL } from "./constants.js";
import { ITEM } from "./content/base.js";
import * as V from "./content/ids.js";

const S = CHUNK_SIZE;
const FX = [0, 0, 1, -1];
const FZ = [1, -1, 0, 0];
const OPP = [1, 0, 3, 2];
export const STRONGHOLD_COUNT = 128;
const RING_DISTANCE = 32; // chunks (vanilla)
const RING_SPREAD = 3;
const LAND_SEARCH = 112; // blocks
const MAX_PIECES = 40;
const MAX_REACH = 80; // blocks from the start a piece may reach
const SALT = 0x5bd1e995;

// ---------- Loot ----------

// (structures.js's format; "book": an enchanted book)
export const STRONGHOLD_LOOT = {
  stronghold_corridor: [
    [2, 3, [
      [V.ENDER_PEARL, 10, 1, 1], [V.DIAMOND, 3, 1, 3], [V.IRON_INGOT, 10, 1, 5], [ITEM.GOLD_INGOT, 5, 1, 3], [V.REDSTONE, 5, 4, 9], [V.BREAD, 15, 1, 3], [ITEM.APPLE, 15, 1, 3],
      [ITEM.IRON_PICKAXE, 5], [ITEM.IRON_SWORD, 5], [ITEM.IRON_CHESTPLATE, 5], [ITEM.IRON_HELMET, 5], [ITEM.IRON_LEGGINGS, 5], [ITEM.IRON_BOOTS, 5],
      [ITEM.GOLDEN_APPLE, 1], [null, 1], [null, 1], [null, 1], [null, 1], ["book", 1], // (a saddle, horse armour)
    ]],
    [1, 1, [[null, 1], [null, 9]]], // (the eye armour trim template)
  ],
  stronghold_crossing: [[1, 4, [[V.IRON_INGOT, 10, 1, 5], [ITEM.GOLD_INGOT, 5, 1, 3], [V.REDSTONE, 5, 4, 9], [ITEM.COAL, 10, 3, 8], [V.BREAD, 15, 1, 3], [ITEM.APPLE, 15, 1, 3], [ITEM.IRON_PICKAXE, 1], ["book", 1]]]],
  stronghold_library: [
    [2, 10, [[V.BOOK, 20, 1, 3], [V.PAPER, 20, 2, 7], [null, 1], [V.COMPASS, 20], ["book", 10]]], // (a map)
    [1, 1, [[null, 1], [null, 9]]],
  ],
};

// ---------- Where they are ----------

// Vanilla's rings: [x, z] (block coordinates of each one's chunk middle).
export function strongholdRings(seed) {
  const rand = mulberry32((seed ^ SALT) >>> 0);
  const out = [];
  let angle = rand() * Math.PI * 2;
  let inRing = 0;
  let ring = 0;
  let spread = RING_SPREAD;
  for (let k = 0; k < STRONGHOLD_COUNT; k++) {
    const dist = 4 * RING_DISTANCE + RING_DISTANCE * ring * 6 + (rand() - 0.5) * RING_DISTANCE * 2.5;
    const cx = Math.round(Math.cos(angle) * dist);
    const cz = Math.round(Math.sin(angle) * dist);
    out.push([cx * S + 8, cz * S + 8]);
    angle += (Math.PI * 2) / spread;
    if (++inRing === spread) {
      ring++;
      inRing = 0;
      spread += Math.floor((2 * spread) / (ring + 1));
      spread = Math.min(spread, STRONGHOLD_COUNT - k);
      angle += rand() * Math.PI * 2;
    }
  }
  return out;
}

// ---------- The pieces ----------

// Each kind: its size across (W), up (H), along (L), the doorway's column
// (eu, default the middle) and floor row (ev, default 0); its exits are
// chosen when it is planned (see PIECE_EXITS).
const KINDS = {
  corridor: { W: 5, H: 5, L: 7, weight: 40 },
  chest_corridor: { W: 5, H: 5, L: 7, weight: 5 },
  left_turn: { W: 5, H: 5, L: 5, weight: 20 },
  right_turn: { W: 5, H: 5, L: 5, weight: 20 },
  crossing: { W: 11, H: 7, L: 11, weight: 10 },
  stairs: { W: 5, H: 11, L: 8, ev: 6, weight: 5 },
  prison: { W: 9, H: 5, L: 11, eu: 2, weight: 5 },
  library: { W: 13, H: 7, L: 15, weight: 10, max: 1 },
  portal: { W: 11, H: 8, L: 16, weight: 20, max: 1, minDepth: 3 },
};
const PICKS = ["corridor", "chest_corridor", "left_turn", "right_turn", "crossing", "stairs", "prison", "library", "portal"];
const DOORS = ["opening", "wood", "grates", "iron"];

// A piece planned at entry cell X (the doorway's floor-row cell, world),
// facing f (along its length).
class Piece {
  constructor(kind, X, f, depth) {
    const k = KINDS[kind];
    this.kind = kind;
    this.W = k.W;
    this.H = k.H;
    this.L = k.L;
    this.eu = k.eu ?? (k.W - 1) >> 1;
    this.ev = k.ev ?? 0;
    this.X = X;
    this.f = f;
    this.depth = depth;
    this.exits = []; // [{ u, v, w, du, dw }] (v: the exit's floor row)
    this.grid = null;
    const a = this.world(0, 0, 0);
    const b = this.world(this.W - 1, this.H - 1, this.L - 1);
    this.box = [Math.min(a[0], b[0]), a[1], Math.min(a[2], b[2]), Math.max(a[0], b[0]), b[1], Math.max(a[2], b[2])];
  }
  // local (u across, v up, w along) -> world [x, y, z]
  world(u, v, w) {
    const f = this.f;
    const du = u - this.eu;
    return [this.X[0] + FZ[f] * du + FX[f] * w, this.X[1] + v - this.ev, this.X[2] - FX[f] * du + FZ[f] * w];
  }
  // world -> local index in the grid, or -1 outside it
  index(x, y, z) {
    const f = this.f;
    const dx = x - this.X[0];
    const dz = z - this.X[2];
    const u = FZ[f] * dx - FX[f] * dz + this.eu;
    const w = FX[f] * dx + FZ[f] * dz;
    const v = y - this.X[1] + this.ev;
    if (u < 0 || u >= this.W || v < 0 || v >= this.H || w < 0 || w >= this.L) return -1;
    return (v * this.L + w) * this.W + u;
  }
  // a local direction (du across, dw along) as a world facing
  facing(du, dw) {
    const f = this.f;
    const dx = FZ[f] * du + FX[f] * dw;
    const dz = -FX[f] * du + FZ[f] * dw;
    return Math.abs(dx) >= Math.abs(dz) ? (dx >= 0 ? 2 : 3) : dz >= 0 ? 0 : 1;
  }
  overlaps(o) {
    const a = this.box;
    const b = o.box;
    return a[0] <= b[3] && a[3] >= b[0] && a[1] <= b[4] && a[4] >= b[1] && a[2] <= b[5] && a[5] >= b[2];
  }
}

// The exits a piece of a kind gets (rand: the plan's).
function pieceExits(p, rand) {
  const c = p.eu;
  const fwd = (u = c, v = 0) => p.exits.push({ u, v, w: p.L - 1, du: 0, dw: 1 });
  const left = (w, v = 0) => p.exits.push({ u: 0, v, w, du: -1, dw: 0 });
  const right = (w, v = 0) => p.exits.push({ u: p.W - 1, v, w, du: 1, dw: 0 });
  switch (p.kind) {
    case "corridor":
      fwd();
      if (rand() < 0.35) left(3);
      if (rand() < 0.35) right(3);
      break;
    case "chest_corridor":
      fwd();
      break;
    case "left_turn":
      left(2);
      break;
    case "right_turn":
      right(2);
      break;
    case "crossing":
      fwd();
      left(5);
      right(5);
      break;
    case "stairs":
      fwd(c, 0);
      break;
    case "prison":
      fwd(2);
      break;
    default:
      break; // (the library and the portal room are dead ends)
  }
}

// The plan of the stronghold whose start is at (x, y, z): its pieces (each
// with its cells in a grid), chests, spawner cells and portal room.
export function planStronghold(x, y, z, seed) {
  const rand = mulberry32(seed >>> 0);
  const pieces = [];
  const counts = {};
  const start = new Piece("crossing", [x, y, z], Math.floor(rand() * 4), 0);
  start.start = true;
  pieceExits(start, rand);
  pieces.push(start);
  const open = start.exits.map((e) => ({ parent: start, e }));
  // the connections: [parent, exit, child, door]
  const links = [];
  const fits = (p) => {
    const b = p.box;
    if (b[1] < 3 || b[4] > 60) return false;
    if (Math.max(Math.abs(b[0] - x), Math.abs(b[3] - x), Math.abs(b[2] - z), Math.abs(b[5] - z)) > MAX_REACH) return false;
    return !pieces.some((o) => o.overlaps(p));
  };
  const childAt = (parent, e, kind) => {
    const X = parent.world(e.u + e.du, e.v, e.w + e.dw);
    return new Piece(kind, X, parent.facing(e.du, e.dw), parent.depth + 1);
  };
  const attach = (parent, e, child) => {
    pieceExits(child, rand);
    pieces.push(child);
    counts[child.kind] = (counts[child.kind] || 0) + 1;
    // (the portal room's doorway: grates, as vanilla's)
    links.push([parent, e, child, child.kind === "portal" ? "grates" : DOORS[Math.floor(rand() * DOORS.length)]]);
    for (const ce of child.exits) open.push({ parent: child, e: ce });
  };
  const total = PICKS.reduce((n, k) => n + KINDS[k].weight, 0);
  while (open.length && pieces.length < MAX_PIECES) {
    // (breadth first, as vanilla's pending list, with a shuffle)
    const at = Math.floor(rand() * Math.min(open.length, 3));
    const { parent, e } = open.splice(at, 1)[0];
    if (parent.depth >= 50) continue;
    for (let tries = 0; tries < 5; tries++) {
      let r = rand() * total;
      let kind = PICKS[0];
      for (const k of PICKS) {
        r -= KINDS[k].weight;
        if (r < 0) {
          kind = k;
          break;
        }
      }
      const K = KINDS[kind];
      if ((K.max && (counts[kind] || 0) >= K.max) || (K.minDepth && parent.depth + 1 < K.minDepth)) continue;
      const child = childAt(parent, e, kind);
      if (!fits(child)) continue;
      attach(parent, e, child);
      break;
    }
  }
  // (No portal room yet: the deepest free exit with room for it; else a new
  // doorway in the middle of any piece's side or end wall: every stronghold has one.)
  if (!counts.portal) {
    const free = (p, e) => !links.some((l) => l[0] === p && l[1] === e);
    const ends = pieces.flatMap((p) => p.exits.filter((e) => free(p, e)).map((e) => [p, e]));
    ends.sort((a, b) => b[0].depth - a[0].depth);
    for (const p of [...pieces].sort((a, b) => b.depth - a.depth)) {
      if (p.kind === "stairs") continue;
      const m = (p.L - 1) >> 1;
      ends.push([p, { u: 0, v: 0, w: m, du: -1, dw: 0 }], [p, { u: p.W - 1, v: 0, w: m, du: 1, dw: 0 }], [p, { u: p.eu, v: 0, w: p.L - 1, du: 0, dw: 1 }]);
    }
    for (const [parent, e] of ends) {
      const child = childAt(parent, e, "portal");
      if (!fits(child)) continue;
      if (!parent.exits.includes(e)) parent.exits.push(e);
      attach(parent, e, child);
      break;
    }
  }
  const plan = { x, y, z, pieces, chests: [], spawners: [], portal: null, box: [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity] };
  for (const p of pieces) {
    p.grid = new Int32Array(p.W * p.H * p.L).fill(-1);
    paint(p, plan, rand);
    for (let i = 0; i < 6; i++) plan.box[i] = i < 3 ? Math.min(plan.box[i], p.box[i]) : Math.max(plan.box[i], p.box[i]);
  }
  for (const [parent, e, child, door] of links) {
    // (the parent's wall opened, the child's doorway as its door)
    for (let k = -1; k <= 1; k++) {
      for (let h = 1; h <= 3; h++) {
        const u = e.du ? e.u : e.u + k;
        const w = e.dw ? e.w : e.w + k;
        set(parent, u, e.v + h, w, BLOCK.AIR);
      }
    }
    doorway(child, door);
  }
  // (a closed exit stays wall: its door is never cut)
  return plan;
}

// ---------- Painting ----------

const has = (id) => !!BLOCK_INFO[id];
function set(p, u, v, w, id) {
  if (u < 0 || u >= p.W || v < 0 || v >= p.H || w < 0 || w >= p.L) return;
  p.grid[(v * p.L + w) * p.W + u] = id;
}
// Vanilla's stone selector: 20% cracked, 30% mossy, the rest plain.
function brick(rand) {
  const r = rand();
  return r < 0.2 ? V.CRACKED_STONE_BRICKS : r < 0.5 ? V.MOSSY_STONE_BRICKS : V.STONE_BRICKS;
}
// A box: its shell of stone bricks, the inside air.
function shell(p, rand, u0 = 0, v0 = 0, w0 = 0, u1 = p.W - 1, v1 = p.H - 1, w1 = p.L - 1) {
  for (let v = v0; v <= v1; v++) {
    for (let w = w0; w <= w1; w++) {
      for (let u = u0; u <= u1; u++) {
        const edge = u === u0 || u === u1 || v === v0 || v === v1 || w === w0 || w === w1;
        set(p, u, v, w, edge ? brick(rand) : BLOCK.AIR);
      }
    }
  }
}
function fill(p, u0, v0, w0, u1, v1, w1, id, rand = null) {
  for (let v = v0; v <= v1; v++) for (let w = w0; w <= w1; w++) for (let u = u0; u <= u1; u++) set(p, u, v, w, id === "brick" ? brick(rand) : id);
}
// A wall torch on the cell (u, v, w), on the wall toward local (du, dw).
function torch(p, u, v, w, du, dw) {
  const f = p.facing(-du, -dw);
  set(p, u, v, w, wallTorch(FX[f], FZ[f]));
}
// A chest at (u, v, w) whose front looks toward local (du, dw).
function putChest(p, plan, u, v, w, du, dw, kind) {
  const f = p.facing(du, dw);
  set(p, u, v, w, chest(FX[f], FZ[f]));
  const [x, y, z] = p.world(u, v, w);
  plan.chests.push([x, y, z, kind]);
}
// The doorway of a piece (its back wall, at its entry column): a door of a kind.
function doorway(p, door) {
  const c = p.eu;
  const v0 = p.ev;
  for (let k = -1; k <= 1; k++) for (let h = 1; h <= 3; h++) set(p, c + k, v0 + h, 0, BLOCK.AIR);
  const f = p.facing(0, 1);
  if (door === "wood" && has(V.OAK_DOOR)) {
    for (const k of [-1, 1]) for (let h = 1; h <= 3; h++) set(p, c + k, v0 + h, 0, V.STONE_BRICKS);
    set(p, c, v0 + 3, 0, V.STONE_BRICKS);
    set(p, c, v0 + 1, 0, V.OAK_DOOR + f);
    set(p, c, v0 + 2, 0, V.OAK_DOOR + f + 8);
  } else if (door === "grates" && has(V.IRON_BARS)) {
    for (const k of [-1, 1]) for (let h = 1; h <= 3; h++) set(p, c + k, v0 + h, 0, V.IRON_BARS);
    set(p, c, v0 + 3, 0, V.IRON_BARS);
  } else if (door === "iron" && has(V.IRON_DOOR) && has(V.STONE_BUTTON)) {
    for (const k of [-1, 1]) for (let h = 1; h <= 3; h++) set(p, c + k, v0 + h, 0, V.STONE_BRICKS);
    set(p, c, v0 + 3, 0, V.STONE_BRICKS);
    set(p, c, v0 + 1, 0, V.IRON_DOOR + f);
    set(p, c, v0 + 2, 0, V.IRON_DOOR + f + 8);
    // (a button on each side of the wall, beside the door: inside the piece, and
    // in the parent's doorway, outside the grid: the plan's extra cells)
    set(p, c + 1, v0 + 2, 1, V.STONE_BUTTON + f);
    p.outside = [...p.world(c + 1, v0 + 2, -1), V.STONE_BUTTON + OPP[f]];
  }
}

function paint(p, plan, rand) {
  const c = p.eu;
  switch (p.kind) {
    case "corridor":
    case "chest_corridor": {
      shell(p, rand);
      if (rand() < 0.5) torch(p, 1, 2, 3, -1, 0);
      if (p.kind === "chest_corridor") {
        // (an alcove in the right wall, the chest in it)
        set(p, 4, 1, 3, BLOCK.AIR);
        set(p, 4, 2, 3, BLOCK.AIR);
        if (has(V.STONE_BRICK_SLAB)) set(p, 4, 0, 3, V.STONE_BRICK_SLAB + 1);
        putChest(p, plan, 4, 1, 3, -1, 0, "stronghold_corridor");
      }
      break;
    }
    case "left_turn":
    case "right_turn":
      shell(p, rand);
      break;
    case "crossing": {
      shell(p, rand);
      if (p.start || rand() < 0.7) {
        // A pillar in the middle with a torch on each side.
        fill(p, 5, 1, 5, 5, 5, 5, "brick", rand);
        torch(p, 6, 3, 5, -1, 0);
        torch(p, 4, 3, 5, 1, 0);
        torch(p, 5, 3, 6, 0, -1);
        torch(p, 5, 3, 4, 0, 1);
      } else {
        // A store room: a loft of planks along the far wall, a ladder up to
        // it in the corner, a chest on it.
        fill(p, 2, 3, 7, 9, 3, 9, BLOCK.PLANKS);
        fill(p, 2, 4, 7, 9, 4, 7, has(V.OAK_FENCE) ? V.OAK_FENCE : BLOCK.AIR);
        if (has(V.LADDER)) for (let v = 1; v <= 4; v++) set(p, 1, v, 9, V.LADDER + p.facing(1, 0));
        putChest(p, plan, 6, 4, 9, 0, -1, "stronghold_crossing");
        torch(p, 1, 2, 2, -1, 0);
        torch(p, 9, 2, 2, 1, 0);
      }
      break;
    }
    case "stairs": {
      // Down 6 over 6 blocks: stone brick stairs climbing back toward the entry.
      shell(p, rand);
      fill(p, 1, 1, 1, 3, p.H - 2, p.L - 2, "brick", rand);
      for (let w = 1; w < p.L - 1; w++) {
        const floor = Math.max(0, Math.min(p.ev, p.ev - w + 1));
        for (let u = 1; u <= 3; u++) {
          for (let v = floor + 1; v <= Math.min(p.H - 2, floor + 4); v++) set(p, u, v, w, BLOCK.AIR);
          if (w >= 2 && floor > 0) set(p, u, floor, w, has(V.STONE_BRICK_STAIRS) ? V.STONE_BRICK_STAIRS + p.facing(0, -1) : V.STONE_BRICKS);
        }
      }
      // (the entry wall below the doorway, the exit wall above it: kept)
      break;
    }
    case "prison": {
      shell(p, rand);
      // the hall along u 1-3; the cells along u 5-7 behind iron bars, two of them
      fill(p, 4, 1, 1, 4, 3, p.L - 2, has(V.IRON_BARS) ? V.IRON_BARS : BLOCK.AIR);
      for (const w of [4, 8]) fill(p, 5, 1, w, 7, 3, w, "brick", rand);
      fill(p, 4, 1, 4, 4, 3, 4, "brick", rand);
      fill(p, 4, 1, 8, 4, 3, 8, "brick", rand);
      for (const w of [2, 6]) {
        if (!has(V.IRON_DOOR)) continue;
        const f = p.facing(1, 0);
        set(p, 4, 1, w, V.IRON_DOOR + f);
        set(p, 4, 2, w, V.IRON_DOOR + f + 8);
      }
      torch(p, 1, 2, 5, -1, 0);
      break;
    }
    case "library": {
      shell(p, rand);
      const shelf = has(V.BOOKSHELF) ? V.BOOKSHELF : BLOCK.PLANKS;
      // bookshelves along the walls (not over the doorway), two rows in the middle
      for (let v = 1; v <= 4; v++) {
        for (let w = 1; w <= p.L - 2; w++) {
          set(p, 1, v, w, shelf);
          set(p, p.W - 2, v, w, shelf);
        }
        for (let u = 1; u <= p.W - 2; u++) {
          set(p, u, v, p.L - 2, shelf);
          if (Math.abs(u - c) > 1) set(p, u, v, 1, shelf);
        }
      }
      for (const u of [4, 8]) for (let w = 3; w <= p.L - 4; w++) if (w !== 7) for (let v = 1; v <= 3; v++) set(p, u, v, w, shelf);
      // cobwebs in the air up high and in corners
      for (let v = 1; v <= 5; v++) for (let w = 1; w <= p.L - 2; w++) for (let u = 1; u <= p.W - 2; u++) {
        const i = (v * p.L + w) * p.W + u;
        if (p.grid[i] === BLOCK.AIR && rand() < (v >= 4 ? 0.07 : 0.015) && has(V.COBWEB)) p.grid[i] = V.COBWEB;
      }
      // lights over the shelves, the chest at the end of the middle aisle
      torch(p, c, 5, p.L - 2, 0, 1);
      torch(p, 1, 5, 7, -1, 0);
      torch(p, p.W - 2, 5, 7, 1, 0);
      putChest(p, plan, c, 1, p.L - 3, 0, -1, "stronghold_library");
      break;
    }
    case "portal":
      paintPortalRoom(p, plan, rand);
      break;
  }
}

// Vanilla's PortalRoom (11 wide, 8 high, 16 long), the doorway at its middle.
function paintPortalRoom(p, plan, rand) {
  shell(p, rand);
  // ledges round the walls up high
  fill(p, 1, 6, 1, 1, 6, 14, "brick", rand);
  fill(p, 9, 6, 1, 9, 6, 14, "brick", rand);
  fill(p, 2, 6, 1, 8, 6, 2, "brick", rand);
  fill(p, 2, 6, 14, 8, 6, 14, "brick", rand);
  // the corners by the door: steps, lava in them
  fill(p, 1, 1, 1, 2, 1, 4, "brick", rand);
  fill(p, 8, 1, 1, 9, 1, 4, "brick", rand);
  fill(p, 1, 1, 1, 1, 1, 3, V.LAVA);
  fill(p, 9, 1, 1, 9, 1, 3, V.LAVA);
  // the dais, lava under the portal
  fill(p, 3, 1, 8, 7, 2, 12, "brick", rand);
  fill(p, 4, 1, 9, 6, 1, 11, V.LAVA);
  fill(p, 4, 2, 9, 6, 2, 11, BLOCK.AIR);
  // iron bar windows
  if (has(V.IRON_BARS)) {
    for (let w = 3; w < 14; w += 2) {
      fill(p, 0, 3, w, 0, 4, w, V.IRON_BARS);
      fill(p, 10, 3, w, 10, 4, w, V.IRON_BARS);
    }
    for (let u = 2; u < 9; u += 2) fill(p, u, 3, 15, u, 4, 15, V.IRON_BARS);
  }
  // the stairs up to it (toward the far end), the spawner on the top step
  fill(p, 4, 1, 5, 6, 1, 7, "brick", rand);
  fill(p, 4, 2, 6, 6, 2, 7, "brick", rand);
  fill(p, 4, 3, 7, 6, 3, 7, "brick", rand);
  const up = has(V.STONE_BRICK_STAIRS) ? V.STONE_BRICK_STAIRS + p.facing(0, 1) : V.STONE_BRICKS;
  for (let u = 4; u <= 6; u++) {
    set(p, u, 1, 4, up);
    set(p, u, 2, 5, up);
    set(p, u, 3, 6, up);
  }
  // the frames, turned toward the middle (5, 10); an eye one time in ten
  const frames = [];
  for (let u = 4; u <= 6; u++) frames.push([u, 8, 0, 1], [u, 12, 0, -1]);
  for (let w = 9; w <= 11; w++) frames.push([3, w, 1, 0], [7, w, -1, 0]);
  let all = true;
  for (const [u, w, du, dw] of frames) {
    const eye = rand() > 0.9;
    all &&= eye;
    set(p, u, 3, w, V.END_PORTAL_FRAME + p.facing(du, dw) + (eye ? 4 : 0));
  }
  if (all) fill(p, 4, 3, 9, 6, 3, 11, V.END_PORTAL);
  if (has(V.SILVERFISH_SPAWNER)) {
    set(p, 5, 3, 6, V.SILVERFISH_SPAWNER);
    plan.spawners.push(p.world(5, 3, 6));
  }
  const portal = [];
  for (let u = 4; u <= 6; u++) for (let w = 9; w <= 11; w++) portal.push(p.world(u, 3, w));
  plan.portal = { cells: portal, center: p.world(5, 3, 10), frames: frames.map(([u, w]) => p.world(u, 3, w)) };
}

// ---------- In the world ----------

export class StrongholdGrower {
  // terrain: the Overworld's generator (heightAt).
  constructor(terrain) {
    this.terrain = terrain;
    this.seed = terrain.seed >>> 0;
    this.rings = strongholdRings(this.seed);
    this._sites = new Map(); // i -> { x, y, z }
    this._plans = new Map(); // i -> plan
  }

  // The stronghold i's start (moved to land), its floor's y.
  site(i) {
    let s = this._sites.get(i);
    if (s) return s;
    const [rx, rz] = this.rings[i];
    let at = [rx, rz];
    // (a spiral out to 112 blocks, every 16: the first column above the sea)
    search: for (let r = 0; r <= LAND_SEARCH; r += 16) {
      const n = r === 0 ? 1 : Math.round((Math.PI * 2 * r) / 16);
      for (let k = 0; k < n; k++) {
        const a = (k / n) * Math.PI * 2;
        const x = Math.round(rx + Math.cos(a) * r);
        const z = Math.round(rz + Math.sin(a) * r);
        if (this.terrain.heightAt(x, z) > SEA_LEVEL + 3) {
          at = [x, z];
          break search;
        }
      }
    }
    // (its floor 18-23 under the ground there, at most 24 up, at least 5;
    // then lower if a piece would come within 4 of the lowest ground over it)
    const rand = mulberry32((this.seed ^ Math.imul(i + 1, 0x632be59b) ^ SALT) >>> 0);
    const h = this.terrain.heightAt(at[0], at[1]);
    s = { x: at[0], y: Math.max(5, Math.min(24, h - 18 - Math.floor(rand() * 6))), z: at[1], i };
    let p = this._planAt(s);
    const over = p.box[4] - (this._lowestGround(p.box) - 4);
    const y = Math.max(5, s.y - Math.max(0, over));
    if (y !== s.y) {
      s.y = y;
      p = this._planAt(s);
    }
    this._sites.set(i, s);
    this._keep(i, p);
    return s;
  }

  _planAt(s) {
    return planStronghold(s.x, s.y, s.z, (this.seed ^ Math.imul(s.i + 7, 0x85ebca6b)) >>> 0);
  }

  // (the lowest ground over a box, every 8 blocks)
  _lowestGround(b) {
    let low = Infinity;
    for (let x = b[0]; x <= b[3] + 7; x += 8) for (let z = b[2]; z <= b[5] + 7; z += 8) low = Math.min(low, this.terrain.heightAt(Math.min(x, b[3]), Math.min(z, b[5])));
    return low;
  }

  _keep(i, p) {
    if (this._plans.size >= 8) this._plans.delete(this._plans.keys().next().value);
    this._plans.set(i, p);
  }

  plan(i) {
    let p = this._plans.get(i);
    if (p) return p;
    p = this._planAt(this.site(i));
    this._keep(i, p);
    return p;
  }

  // The strongholds whose pieces may reach (x0..x1, z0..z1).
  _near(x0, z0, x1, z1) {
    const out = [];
    const reach = MAX_REACH + LAND_SEARCH + 20;
    for (let i = 0; i < this.rings.length; i++) {
      const [rx, rz] = this.rings[i];
      if (rx + reach < x0 || rx - reach > x1 || rz + reach < z0 || rz - reach > z1) continue;
      const p = this.plan(i);
      const b = p.box;
      if (b[0] <= x1 + 1 && b[3] >= x0 - 1 && b[2] <= z1 + 1 && b[5] >= z0 - 1) out.push(p);
    }
    return out;
  }

  // The stronghold nearest (x, z): { x, y, z, i } (its start), the
  // eye of ender's target (vanilla: the nearest structure start).
  nearest(x, z) {
    // (by the rings first: a site is never more than 112 from its ring place)
    const order = this.rings.map(([rx, rz], i) => [Math.hypot(rx - x, rz - z), i]).sort((a, b) => a[0] - b[0]);
    let best = null;
    let bd = Infinity;
    for (const [d, i] of order) {
      if (d - LAND_SEARCH > bd) break;
      const s = this.site(i);
      const sd = Math.hypot(s.x - x, s.z - z);
      if (sd < bd) {
        bd = sd;
        best = s;
      }
    }
    return best;
  }

  // Into a chunk's blocks (js/structures.js, underground, with the mineshafts):
  // minH: the lowest ground of each column less 2, nothing is cut above it
  // (or a function that makes it: only called when a stronghold is there).
  placeUnderground(blocks, cx, cz, minH) {
    const bx = cx * S;
    const bz = cz * S;
    const near = this._near(bx, bz, bx + S - 1, bz + S - 1);
    if (!near.length) return;
    if (typeof minH === "function") minH = minH();
    for (const plan of near) {
      for (const p of plan.pieces) {
        const b = p.box;
        if (b[0] > bx + S - 1 || b[3] < bx || b[2] > bz + S - 1 || b[5] < bz) continue;
        for (let x = Math.max(b[0], bx); x <= Math.min(b[3], bx + S - 1); x++) {
          for (let z = Math.max(b[2], bz); z <= Math.min(b[5], bz + S - 1); z++) {
            const lim = minH ? minH[(z - bz) * S + (x - bx)] : 999;
            for (let y = b[1]; y <= b[4] && y < lim; y++) {
              const k = p.index(x, y, z);
              if (k < 0) continue;
              const id = p.grid[k];
              if (id < 0) continue;
              const i = (y << 8) | ((z - bz) << 4) | (x - bx);
              if (blocks[i] === BLOCK.BEDROCK || IS_WET[blocks[i]]) continue;
              blocks[i] = id;
            }
          }
        }
        // (the iron doors' outer buttons: in the parent's doorway)
        const o = p.outside;
        if (o && o[0] >> 4 === cx && o[2] >> 4 === cz && (!minH || o[1] < minH[(o[2] - bz) * S + (o[0] - bx)])) blocks[(o[1] << 8) | ((o[2] - bz) << 4) | (o[0] - bx)] = o[3];
      }
    }
  }

  // "stronghold_corridor" | "stronghold_crossing" | "stronghold_library" | null.
  chestAt(x, y, z) {
    for (const plan of this._near(x, z, x, z)) for (const c of plan.chests) if (c[0] === x && c[1] === y && c[2] === z) return c[3];
    return null;
  }

  // The spawners standing in chunk (cx, cz): [[x, y, z], ...] (js/structures.js Spawners).
  spawnerCells(cx, cz) {
    const out = [];
    const bx = cx * S;
    const bz = cz * S;
    for (const plan of this._near(bx, bz, bx + S - 1, bz + S - 1)) for (const s of plan.spawners) if (s[0] >> 4 === cx && s[2] >> 4 === cz) out.push(s.slice());
    return out;
  }
}
