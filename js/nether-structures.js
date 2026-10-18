// The Nether's structures (Round 12): nether fortresses, bastion remnants
// and ruined portals (in the Nether and, through js/structures.js, in a
// Survival world's Overworld), as vanilla Java 1.20's as far as they go.
// Pure logic (no three.js): planned from the seed, built chunk by chunk
// into the generator's blocks (js/dim-nether.js, the workers too).
//
// - Placement: vanilla's nether_complexes set: one start per region of
//   27 x 27 chunks (4 apart at least), two in five a fortress, three in five
//   a bastion (never in the basalt deltas).
// - Fortresses (vanilla's NetherFortressPieces, simplified): from a bridge
//   crossing at y 48-68, bridges (5 wide, railed with nether brick fences,
//   standing on pillars down to the ground or the lava), crossings, blaze
//   thrones (a raised platform with the blaze spawner: one at least, two at
//   most), and through an entrance the enclosed castle: corridors with fence
//   windows, crossings, turns with a chest one time in two, and nether wart
//   rooms (soul sand beds). Up to 8 pieces deep and 112 blocks out.
// - Bastion remnants (one kind: the treasure keep): a ruined square of
//   polished blackstone bricks round a keep of three floors with a lava pit
//   and gold below, the treasure chest at the top, chests on the ramparts,
//   gilded blackstone and gold blocks about. (Vanilla's four bastion kinds,
//   their jigsaw pieces and the piglins standing in them are not built: the
//   creatures' part spawns piglins inside bastionAt.)
// - Ruined portals: a broken obsidian frame, some of it crying obsidian, on
//   a patch of netherrack and magma, a chest beside it; one try per 40 x 40
//   chunks (vanilla's spacing).
// Chests are the vanilla tables (NETHER_LOOT: js/structures.js merges them
// with the Overworld's), asked when first opened (chestAt). The blaze
// spawners are found through spawnerSpots (js/structures.js Spawners).
import { mulberry32, hash2 } from "./noise.js";
import { BLOCK, BLOCK_INFO, IS_SOLID, chest } from "./blocks.js";
import { CHUNK_SIZE, WORLD_HEIGHT, SEA_LEVEL } from "./constants.js";
import { ITEM } from "./content/base.js";
import * as I from "./content/ids.js";
import { GLISTERING_MELON_SLICE } from "./content/items-vanilla.js";

const S = CHUNK_SIZE;
const H = WORLD_HEIGHT;
const AIR = BLOCK.AIR;
// A block if the game has it (the building part's families), else a stand-in.
const has = (id, alt) => (BLOCK_INFO[id] ? id : alt);
const FENCE = () => has(I.NETHER_BRICK_FENCE, I.NETHER_BRICKS);
const BRICK = I.NETHER_BRICKS;

// ---------- Placement ----------

const REGION = 27;
const SEPARATION = 4;
const COMPLEX_SALT = 30084232; // (vanilla's)
const FORTRESS_REACH = 9; // chunks a fortress reaches from its start
const BASTION_REACH = 2;

// ---------- Loot (vanilla 1.20: [rolls min, max, [[id, weight, min, max]]]; null: not in the game) ----------

export const NETHER_LOOT = {
  nether_bridge: [
    [2, 4, [[I.DIAMOND, 5, 1, 3], [I.IRON_INGOT, 5, 1, 5], [ITEM.GOLD_INGOT, 15, 1, 3], [I.GOLDEN_SWORD, 5], [ITEM.GOLD_CHESTPLATE, 5], [I.FLINT_AND_STEEL, 5], [I.NETHER_WART, 5, 3, 7], [null, 10], [null, 8], [null, 5], [null, 3], [I.OBSIDIAN, 2, 2, 4]]],
  ],
  bastion_treasure: [
    [3, 3, [[I.NETHERITE_INGOT, 15], [I.ANCIENT_DEBRIS, 10], [I.NETHERITE_SCRAP, 8], [I.ANCIENT_DEBRIS, 4, 2, 2], [ITEM.DIAMOND_SWORD, 6], [ITEM.DIAMOND_CHESTPLATE, 6], [ITEM.DIAMOND_HELMET, 6], [ITEM.DIAMOND_LEGGINGS, 6], [ITEM.DIAMOND_BOOTS, 6], [I.DIAMOND, 5, 2, 6], [null, 2]]],
    [3, 4, [[null, 12], [I.GOLD_BLOCK, 16, 2, 5], [ITEM.GOLD_INGOT, 15, 3, 9], [I.IRON_INGOT, 15, 3, 9], [I.CRYING_OBSIDIAN, 15, 3, 5], [I.QUARTZ, 12, 8, 23], [I.GILDED_BLACKSTONE, 15, 5, 15], [I.MAGMA_CREAM, 15, 3, 8]]],
    [1, 1, [[I.NETHERITE_UPGRADE, 1]]],
  ],
  bastion_other: [
    [1, 1, [[ITEM.DIAMOND_PICKAXE, 6], [ITEM.DIAMOND_SHOVEL, 6], [null, 6], [I.ANCIENT_DEBRIS, 12], [I.NETHERITE_SCRAP, 4], [null, 10], [null, 9], [null, 5], [I.GOLDEN_CARROT, 12, 6, 17], [ITEM.GOLDEN_APPLE, 9], ["book", 10]]],
    [2, 2, [[ITEM.IRON_SWORD, 2], [I.IRON_BLOCK, 2], [ITEM.GOLD_BOOTS, 1], [I.GOLDEN_AXE, 1], [I.GOLD_BLOCK, 2], [null, 1], [ITEM.GOLD_INGOT, 2, 1, 6], [I.IRON_INGOT, 2, 1, 6], [I.GOLDEN_SWORD, 2], [ITEM.GOLD_CHESTPLATE, 2], [ITEM.GOLD_HELMET, 2], [ITEM.GOLD_LEGGINGS, 2], [ITEM.GOLD_BOOTS, 2]]],
    [3, 4, [[I.CRYING_OBSIDIAN, 2, 1, 5], [I.GILDED_BLACKSTONE, 2, 1, 5], [null, 2], [I.MAGMA_CREAM, 2, 2, 6], [I.BONE_BLOCK, 2, 3, 6], [I.IRON_NUGGET, 2, 2, 8], [I.OBSIDIAN, 2, 4, 6], [I.GOLD_NUGGET, 2, 2, 8], [I.STRING, 1, 4, 6], [I.ARROW, 2, 5, 17], [I.COOKED_PORKCHOP, 1]]],
    // (1.20: one chest in ten holds the netherite upgrade)
    [1, 1, [[I.NETHERITE_UPGRADE, 1], [null, 9]]],
  ],
  ruined_portal: [
    [4, 8, [[I.OBSIDIAN, 40, 1, 2], [I.FLINT, 40, 1, 4], [I.IRON_NUGGET, 40, 9, 18], [I.FLINT_AND_STEEL, 40], [I.FIRE_CHARGE, 40], [ITEM.GOLDEN_APPLE, 15], [I.GOLD_NUGGET, 15, 4, 24], [I.GOLDEN_SWORD, 15], [I.GOLDEN_AXE, 15], [I.GOLDEN_HOE, 15], [I.GOLDEN_SHOVEL, 15], [I.GOLDEN_PICKAXE, 15], [ITEM.GOLD_BOOTS, 15], [ITEM.GOLD_CHESTPLATE, 15], [ITEM.GOLD_HELMET, 15], [ITEM.GOLD_LEGGINGS, 15], [GLISTERING_MELON_SLICE, 5, 4, 12], [null, 5], [null, 5], [I.GOLDEN_CARROT, 5, 4, 12], [I.CLOCK, 5], [ITEM.GOLD_INGOT, 5, 2, 8], [null, 1], [null, 1], [I.GOLD_BLOCK, 1, 1, 2]]],
  ],
};

// ---------- Pieces ----------

// Directions: 0 +z, 1 +x, 2 -z, 3 -x (a turn right is +1).
const DIRS = [
  [0, 1],
  [1, 0],
  [0, -1],
  [-1, 0],
];
// A piece's frame: local u across (to the right), v along, w up, from its
// entry cell (ox, oy, oz) going `dir`.
function frameOf(ox, oy, oz, dir) {
  const [dx, dz] = DIRS[dir & 3];
  const [px, pz] = DIRS[(dir + 1) & 3];
  return { ox, oy, oz, dir: dir & 3, dx, dz, px, pz };
}
const wx = (f, u, v) => f.ox + f.dx * v + f.px * u;
const wz = (f, u, v) => f.oz + f.dz * v + f.pz * u;

// Each kind: len (along), half (across, each side), down / up (its box
// below and above the deck), exits [u, v, turn] (the next piece's entry cell
// and direction: 0 on, -1 left, +1 right), net: "bridge" | "castle".
const KINDS = {
  crossing: { len: 19, half: 9, down: 4, up: 5, net: "bridge", exits: [[0, 19, 0], [-10, 9, -1], [10, 9, 1]] },
  bridge: { len: 19, half: 2, down: 3, up: 4, net: "bridge", exits: [[0, 19, 0]] },
  throne: { len: 9, half: 3, down: 2, up: 5, net: "bridge", exits: [] },
  bridge_end: { len: 3, half: 2, down: 3, up: 3, net: "bridge", exits: [] },
  entrance: { len: 9, half: 4, down: 3, up: 8, net: "castle", exits: [[0, 9, 0]] },
  corridor: { len: 5, half: 2, down: 1, up: 6, net: "castle", exits: [[0, 5, 0]] },
  corridor_cross: { len: 5, half: 2, down: 1, up: 6, net: "castle", exits: [[0, 5, 0], [-3, 2, -1], [3, 2, 1]] },
  turn_left: { len: 5, half: 2, down: 1, up: 6, net: "castle", exits: [[-3, 2, -1]] },
  turn_right: { len: 5, half: 2, down: 1, up: 6, net: "castle", exits: [[3, 2, 1]] },
  wart_room: { len: 13, half: 6, down: 1, up: 8, net: "castle", exits: [[0, 13, 0]] },
  corridor_end: { len: 1, half: 2, down: 1, up: 6, net: "castle", exits: [] },
};
// (vanilla's weights, for what exists here)
const NEXT = {
  bridge: [["bridge", 30], ["crossing", 10], ["throne", 6], ["entrance", 7]],
  castle: [["corridor", 25], ["corridor_cross", 15], ["turn_left", 6], ["turn_right", 6], ["wart_room", 5]],
};
const MAX_PIECES = 64;
const MAX_DEPTH = 8;
const MAX_REACH = 112;

function boxOf(kind, f) {
  const k = KINDS[kind];
  const xs = [wx(f, -k.half, 0), wx(f, k.half, 0), wx(f, -k.half, k.len - 1), wx(f, k.half, k.len - 1)];
  const zs = [wz(f, -k.half, 0), wz(f, k.half, 0), wz(f, -k.half, k.len - 1), wz(f, k.half, k.len - 1)];
  return { x0: Math.min(...xs), x1: Math.max(...xs), y0: f.oy - k.down, y1: f.oy + k.up, z0: Math.min(...zs), z1: Math.max(...zs) };
}
const overlaps = (a, b) => a.x0 <= b.x1 && a.x1 >= b.x0 && a.y0 <= b.y1 && a.y1 >= b.y0 && a.z0 <= b.z1 && a.z1 >= b.z0;

// The whole plan of a fortress from (sx, sy, sz): { pieces, box, chests, spawners }.
export function planFortress(rand, sx, sy, sz) {
  const pieces = [];
  const chests = [];
  const spawners = [];
  let thrones = 0;
  let rooms = 0;
  const fits = (box) => box.y0 > 6 && box.y1 < 118 && !pieces.some((p) => overlaps(p.box, box));
  const add = (kind, f, depth) => {
    const box = boxOf(kind, f);
    if (!fits(box)) return null;
    const p = { kind, f, box, depth, chest: null, seed: (rand() * 0x7fffffff) | 0 };
    pieces.push(p);
    if (kind === "throne") {
      thrones++;
      spawners.push([wx(f, 0, 5), f.oy + 3, wz(f, 0, 5)]);
    }
    if (kind === "wart_room") rooms++;
    if ((kind === "turn_left" || kind === "turn_right") && rand() < 0.5) {
      // (in the corner across from the opening, facing into the corridor)
      const u = kind === "turn_left" ? 1 : -1;
      p.chest = [wx(f, u, 3), f.oy + 1, wz(f, u, 3)];
      chests.push(p.chest);
    }
    return p;
  };
  const start = add("crossing", frameOf(sx, sy, sz, 0), 0);
  const queue = [];
  const exitsOf = (p, back = false) => {
    const k = KINDS[p.kind];
    const list = k.exits.slice();
    if (back) list.push([0, -1, 2]);
    for (const [u, v, turn] of list) {
      const dir = (p.f.dir + turn + 4) & 3;
      queue.push({ x: wx(p.f, u, v), y: p.f.oy, z: wz(p.f, u, v), dir, net: k.net, depth: p.depth + 1 });
    }
  };
  exitsOf(start, true);
  while (queue.length && pieces.length < MAX_PIECES) {
    const e = queue.splice(Math.floor(rand() * queue.length), 1)[0];
    const f = frameOf(e.x, e.y, e.z, e.dir);
    const far = Math.max(Math.abs(e.x - sx), Math.abs(e.z - sz)) > MAX_REACH;
    let placed = null;
    if (e.depth <= MAX_DEPTH && !far) {
      const list = NEXT[e.net].filter(([kind]) => (kind !== "throne" || thrones < 2) && (kind !== "wart_room" || rooms < 2));
      for (let attempt = 0; attempt < 5 && !placed; attempt++) {
        // (a fortress without a throne asks for one more and more)
        const weights = list.map(([kind, w]) => (kind === "throne" && !thrones && pieces.length > 6 ? w * 4 : w));
        let w = rand() * weights.reduce((a, b) => a + b, 0);
        let kind = list[0][0];
        for (let i = 0; i < list.length; i++) if ((w -= weights[i]) < 0) {
          kind = list[i][0];
          break;
        }
        placed = add(kind, f, e.depth);
      }
    }
    if (placed) exitsOf(placed);
    else add(e.net === "castle" ? "corridor_end" : "bridge_end", f, e.depth);
  }
  // (still no throne: one at the end of the first bridge that has room for it)
  if (!thrones) {
    for (const p of pieces) {
      if (p.kind !== "bridge_end") continue;
      const i = pieces.indexOf(p);
      pieces.splice(i, 1);
      if (add("throne", p.f, p.depth)) break;
      pieces.splice(i, 0, p);
    }
  }
  const box = { x0: Infinity, y0: Infinity, z0: Infinity, x1: -Infinity, y1: -Infinity, z1: -Infinity };
  for (const p of pieces) {
    box.x0 = Math.min(box.x0, p.box.x0);
    box.y0 = Math.min(box.y0, p.box.y0);
    box.z0 = Math.min(box.z0, p.box.z0);
    box.x1 = Math.max(box.x1, p.box.x1);
    box.y1 = Math.max(box.y1, p.box.y1);
    box.z1 = Math.max(box.z1, p.box.z1);
  }
  return { kind: "fortress", pieces, box, chests, spawners };
}

// ---------- Building into a chunk ----------

// The writer for one chunk: put (clipped to it), fillDown (a pillar down
// through air and liquids to the ground), get.
function chunkWriter(blocks, cx, cz) {
  const x0 = cx * S;
  const z0 = cz * S;
  const inside = (x, z) => x >= x0 && x < x0 + S && z >= z0 && z < z0 + S;
  const idx = (x, y, z) => (y << 8) | ((z - z0) << 4) | (x - x0);
  return {
    inside,
    get(x, y, z) {
      return inside(x, z) && y >= 0 && y < H ? blocks[idx(x, y, z)] : -1;
    },
    put(x, y, z, id) {
      if (!inside(x, z) || y < 1 || y >= H - 1) return;
      const i = idx(x, y, z);
      if (blocks[i] === BLOCK.BEDROCK) return;
      blocks[i] = id;
    },
    fillDown(x, y, z, id) {
      if (!inside(x, z)) return;
      for (let yy = y; yy > 1; yy--) {
        const i = idx(x, yy, z);
        const b = blocks[i];
        if (IS_SOLID[b] && !BLOCK_INFO[b]?.lava) break;
        blocks[i] = id;
      }
    },
  };
}
// A piece's local writer.
function local(w, f) {
  return {
    put: (u, wy, v, id) => w.put(wx(f, u, v), f.oy + wy, wz(f, u, v), id),
    get: (u, wy, v) => w.get(wx(f, u, v), f.oy + wy, wz(f, u, v)),
    down: (u, wy, v, id) => w.fillDown(wx(f, u, v), f.oy + wy, wz(f, u, v), id),
    x: (u, v) => wx(f, u, v),
    z: (u, v) => wz(f, u, v),
  };
}
// Mostly nether bricks, a cracked one now and then (by position: the same in every chunk).
const brickAt = (seed, x, y, z) => (hash2(seed ^ (y * 0x2f1), x, z) < 0.06 ? has(I.CRACKED_NETHER_BRICKS, BRICK) : BRICK);

// A deck: the cells `isDeck(u, v)`, railed where the next cell (inside the
// piece) is not deck, cleared above, a beam under it.
function deck(L, k, seed, isDeck) {
  for (let v = 0; v < k.len; v++) {
    for (let u = -k.half; u <= k.half; u++) {
      if (!isDeck(u, v)) continue;
      const x = L.x(u, v);
      const z = L.z(u, v);
      L.put(u, 0, v, brickAt(seed, x, 0, z));
      L.put(u, -1, v, BRICK);
      const rim = [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([du, dv]) => {
        const nu = u + du;
        const nv = v + dv;
        return Math.abs(nu) <= k.half && nv >= 0 && nv < k.len && !isDeck(nu, nv);
      });
      if (rim) {
        L.put(u, 1, v, BRICK);
        L.put(u, 2, v, FENCE());
        for (let h = 3; h <= 4; h++) L.put(u, h, v, AIR);
      } else for (let h = 1; h <= 4; h++) L.put(u, h, v, AIR);
    }
  }
}

function buildPiece(w, p, seed) {
  const f = p.f;
  const k = KINDS[p.kind];
  const L = local(w, f);
  const s = p.seed;
  switch (p.kind) {
    case "crossing": {
      const isDeck = (u, v) => Math.abs(u) <= 2 || Math.abs(v - 9) <= 2 || (Math.abs(u) <= 3 && Math.abs(v - 9) <= 3);
      deck(L, k, s, isDeck);
      // (the pillars: under the middle's corners and each arm's end, down to the ground)
      for (const [u, v] of [[-3, 6], [3, 6], [-3, 12], [3, 12], [-2, 0], [2, 0], [-2, 18], [2, 18], [-9, 7], [-9, 11], [9, 7], [9, 11]]) L.down(u, -2, v, BRICK);
      break;
    }
    case "bridge": {
      deck(L, k, s, () => true);
      // (arches under it, and their pillars)
      for (const v0 of [4, 14]) {
        for (let dv = -2; dv <= 2; dv++) {
          const h = Math.abs(dv) === 2 ? 2 : Math.abs(dv) === 1 ? 3 : 3;
          for (const u of [-2, 2]) for (let d = 2; d <= h; d++) L.put(u, -d, v0 + dv, BRICK);
        }
        for (const u of [-2, 0, 2]) L.down(u, -2, v0, BRICK);
      }
      break;
    }
    case "bridge_end": {
      // (where a bridge stops: its end railed across)
      deck(L, { ...k, len: k.len + 1 }, s, (u, v) => v < k.len);
      break;
    }
    case "throne": {
      deck(L, { ...k, len: k.len + 1 }, s, (u, v) => v < k.len);
      // (the raised platform: a step, the 3 x 3 top, the spawner in the middle, fences round it)
      L.put(0, 1, 3, BRICK);
      for (let u = -1; u <= 1; u++) for (let v = 4; v <= 6; v++) {
        L.put(u, 1, v, BRICK);
        L.put(u, 2, v, BRICK);
      }
      L.put(0, 3, 5, I.BLAZE_SPAWNER);
      for (const [u, v] of [[-1, 4], [1, 4], [-1, 6], [0, 6], [1, 6], [-1, 5], [1, 5]]) L.put(u, 3, v, FENCE());
      for (const u of [-3, 3]) for (const v of [0, 8]) L.down(u, -2, v, BRICK);
      break;
    }
    case "entrance": {
      // (the castle's gate: a hall of nether bricks with fence windows)
      hall(L, k, s, 7);
      for (const u of [-1, 0, 1]) for (let h = 1; h <= 3; h++) L.put(u, h, 0, AIR);
      for (const u of [-k.half, k.half]) for (const v of [0, k.len - 1]) L.down(u, -2, v, BRICK);
      break;
    }
    case "corridor":
    case "corridor_cross":
    case "turn_left":
    case "turn_right":
    case "corridor_end": {
      hall(L, k, s, 5);
      if (p.kind === "corridor_end") {
        for (let u = -1; u <= 1; u++) for (let h = 1; h <= 4; h++) L.put(u, h, 0, BRICK);
        break;
      }
      const open = (u, v) => {
        for (let h = 1; h <= 4; h++) L.put(u, h, v, AIR);
      };
      if (p.kind === "corridor_cross" || p.kind === "turn_left") for (let v = 1; v <= 3; v++) open(-2, v);
      if (p.kind === "corridor_cross" || p.kind === "turn_right") for (let v = 1; v <= 3; v++) open(2, v);
      if (p.kind === "turn_left" || p.kind === "turn_right") for (let u = -1; u <= 1; u++) for (let h = 1; h <= 4; h++) L.put(u, h, k.len - 1, BRICK);
      else if (p.kind === "corridor") for (const u of [-2, 2]) for (let h = 2; h <= 3; h++) L.put(u, h, 2, FENCE());
      if (p.chest) {
        const [cx, cy, cz] = p.chest;
        // (facing across the corridor)
        const face = p.kind === "turn_left" ? -1 : 1;
        w.put(cx, cy, cz, chest(f.px * face, f.pz * face));
      }
      for (const u of [-2, 2]) for (const v of [0, k.len - 1]) L.down(u, -1, v, BRICK);
      break;
    }
    case "wart_room": {
      hall(L, k, s, 7);
      // (soul sand beds along both walls, nether wart growing in them)
      for (const side of [-1, 1]) {
        for (let v = 3; v <= 9; v++) {
          for (const du of [4, 5]) {
            const u = side * du;
            L.put(u, 0, v, I.SOUL_SAND);
            L.put(u, 1, v, I.NETHER_WART + Math.floor(hash2(s, L.x(u, v), L.z(u, v)) * 4));
          }
          L.put(side * 3, 1, v, BRICK);
        }
        for (let v = 2; v <= 10; v += 4) for (let h = 3; h <= 4; h++) L.put(side * k.half, h, v, FENCE());
      }
      for (const u of [-k.half, k.half]) for (const v of [0, k.len - 1]) L.down(u, -1, v, BRICK);
      break;
    }
  }
}

// An enclosed hall: floor, walls, roof, `h` high inside, open at both ends' middles.
function hall(L, k, seed, h) {
  for (let v = 0; v < k.len; v++) {
    for (let u = -k.half; u <= k.half; u++) {
      const x = L.x(u, v);
      const z = L.z(u, v);
      L.put(u, 0, v, brickAt(seed, x, 0, z));
      L.put(u, -1, v, BRICK);
      const wall = Math.abs(u) === k.half;
      for (let y = 1; y < h; y++) L.put(u, y, v, wall ? brickAt(seed, x, y, z) : AIR);
      L.put(u, h, v, brickAt(seed, x, h, z));
    }
  }
  // (the ends' doorways: 3 wide, 4 high)
  for (const v of [0, k.len - 1]) for (let u = -1; u <= 1; u++) for (let y = 1; y <= 4; y++) L.put(u, y, v, AIR);
}

// ---------- Bastions ----------

// The plan of a bastion remnant round (x, y, z): { box, chests, treasure }.
function planBastion(rand, x, y, z) {
  const R = 11;
  const box = { x0: x - R, x1: x + R, y0: y - 2, y1: y + 16, z0: z - R, z1: z + R };
  const chests = [[x, y + 11, z, "bastion_treasure"]];
  // (the ramparts' chests, in two to four of the corners)
  const corners = [[-9, -9], [9, -9], [-9, 9], [9, 9]];
  for (const [dx, dz] of corners) if (rand() < 0.6) chests.push([x + dx, y + 7, z + dz, "bastion_other"]);
  if (chests.length < 3) chests.push([x - 9, y + 7, z - 9, "bastion_other"]);
  return { kind: "bastion", x, y, z, R, box, chests, seed: (rand() * 0x7fffffff) | 0 };
}

function buildBastion(w, b) {
  const { x, y, z, R, seed } = b;
  const brick = (bx, by, bz) => {
    const h = hash2(seed ^ (by * 0x5bd1), bx, bz);
    return h < 0.18 ? I.CRACKED_POLISHED_BLACKSTONE_BRICKS : h < 0.26 ? I.BLACKSTONE : h < 0.275 ? I.GILDED_BLACKSTONE : I.POLISHED_BLACKSTONE_BRICKS;
  };
  // (ruined: holes in the upper walls, by position)
  const gone = (bx, by, bz, from) => by - y > from && hash2(seed ^ 0x77 ^ (by * 0x31), bx, bz) < 0.12 + (by - y - from) * 0.03;
  for (let dx = -R; dx <= R; dx++) {
    for (let dz = -R; dz <= R; dz++) {
      const bx = x + dx;
      const bz = z + dz;
      if (!w.inside(bx, bz)) continue;
      const ring = Math.max(Math.abs(dx), Math.abs(dz));
      // The floor over a blackstone base.
      w.put(bx, y, bz, ring <= 4 ? I.POLISHED_BLACKSTONE : brick(bx, y, bz));
      w.put(bx, y - 1, bz, I.BLACKSTONE);
      for (let h = 1; h <= 14; h++) w.put(bx, y + h, bz, AIR);
      if (ring === R || ring === 4) w.fillDown(bx, y - 2, bz, I.BLACKSTONE);
      // The outer wall, its battlements and three-wide gates.
      if (ring === R) {
        const gate = Math.abs(dx) <= 1 || Math.abs(dz) <= 1;
        for (let h = 1; h <= 10; h++) {
          if (gate && h <= 4) continue;
          if (!gone(bx, y + h, bz, 5)) w.put(bx, y + h, bz, brick(bx, y + h, bz));
        }
        if ((dx + dz) % 2 === 0 && !gone(bx, y + 11, bz, 5)) w.put(bx, y + 11, bz, I.POLISHED_BLACKSTONE_BRICKS);
        // (basalt pillars at the corners)
        if (Math.abs(dx) === R && Math.abs(dz) === R) for (let h = 1; h <= 13; h++) w.put(bx, y + h, bz, I.BASALT);
      }
      // The ramparts: a walk two wide inside the wall.
      if (ring === R - 1 || ring === R - 2) w.put(bx, y + 6, bz, has(I.POLISHED_BLACKSTONE_SLAB + 1, I.POLISHED_BLACKSTONE));
      // The keep: walls 15 high, floors at 5 and 10, a door each side.
      if (ring === 4) {
        const door = Math.abs(dx) === 0 || Math.abs(dz) === 0;
        for (let h = 1; h <= 15; h++) {
          if (door && h <= 3 && (Math.abs(dx) <= 0 || Math.abs(dz) <= 0)) continue;
          if (!gone(bx, y + h, bz, 11)) w.put(bx, y + h, bz, brick(bx, y + h, bz));
        }
      } else if (ring < 4) {
        w.put(bx, y + 5, bz, I.POLISHED_BLACKSTONE);
        w.put(bx, y + 10, bz, I.POLISHED_BLACKSTONE);
      }
    }
  }
  // (the ladder up the keep's west wall, holes in its floors)
  for (let h = 1; h <= 10; h++) {
    w.put(x - 3, y + h, z, I.LADDER + 2);
  }
  for (const fy of [5, 10]) w.put(x - 3, y + fy, z, I.LADDER + 2);
  // (the treasure below: a lava pit, gold round it)
  for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) {
    w.put(x + dx, y, z + dz, dx || dz ? I.MAGMA_BLOCK : I.LAVA);
    w.put(x + dx, y - 1, z + dz, I.BLACKSTONE);
  }
  for (let k = 0; k < 12; k++) {
    const gx = x + Math.floor(hash2(seed + k, 1, 2) * 7) - 3;
    const gz = z + Math.floor(hash2(seed + k, 3, 4) * 7) - 3;
    if (Math.max(Math.abs(gx - x), Math.abs(gz - z)) <= 1 || Math.max(Math.abs(gx - x), Math.abs(gz - z)) >= 4 || gx === x - 3) continue;
    w.put(gx, y + 1, gz, k % 3 ? I.GOLD_BLOCK : I.GILDED_BLACKSTONE);
  }
  // (the chests: the treasure on the top floor, the rest on the ramparts)
  for (const [cx, cy, cz] of b.chests) {
    const [dx, dz] = cx === x && cz === z ? [0, 1] : [Math.sign(x - cx), 0];
    w.put(cx, cy, cz, chest(dx, dz));
  }
}

// ---------- Ruined portals ----------

// A broken frame: 4 x 5 obsidian (some crying), on a netherrack patch.
export class RuinedPortals {
  // terrain: the generator (heightAt; the Nether's floorBelow); dim: "overworld" | "nether".
  constructor(terrain, dim = "overworld") {
    this.terrain = terrain;
    this.dim = dim;
    this.seed = ((terrain.seed ?? 0) ^ 0x3c1f9d2e) >>> 0;
    this._plans = new Map();
  }

  // The portal of region (rx, rz) (40 x 40 chunks), or null.
  planOf(rx, rz) {
    const key = `${rx},${rz}`;
    if (this._plans.has(key)) return this._plans.get(key);
    const r = mulberry32((this.seed ^ Math.imul(rx, 0x1b873593) ^ Math.imul(rz, 0x2c1b3c6d)) >>> 0);
    const cx = rx * 40 + Math.floor(r() * 25);
    const cz = rz * 40 + Math.floor(r() * 25);
    const x = cx * S + 4 + Math.floor(r() * 8);
    const z = cz * S + 4 + Math.floor(r() * 8);
    let plan = null;
    let y = -1;
    if (this.dim === "nether") y = this.terrain.floorBelow?.(x, 64 + Math.floor(r() * 40), z, 60) ?? -1;
    else {
      const h = this.terrain.heightAt(x, z);
      if (h > SEA_LEVEL + 1 && h < H - 12) y = h + 1;
    }
    if (y > 0) {
      const alongX = r() < 0.5;
      const missing = [];
      // (which of the frame's 14 cells are gone or crying)
      const cells = [];
      for (let a = 0; a < 4; a++) for (let h = 0; h < 5; h++) if (a === 0 || a === 3 || h === 0 || h === 4) cells.push([a - 1, h]);
      const frame = [];
      for (const [a, h] of cells) {
        const roll = r();
        if (roll < 0.25 + h * 0.06) missing.push([a, h]);
        else frame.push([a, h, roll > 0.86 ? I.CRYING_OBSIDIAN : I.OBSIDIAN]);
      }
      const side = r() < 0.5 ? -1 : 1;
      const chestAt = alongX ? [x + 3 * side, y, z + 2] : [x + 2, y, z + 3 * side];
      plan = { x, y, z, alongX, frame, chest: chestAt, seed: (r() * 0x7fffffff) | 0, gold: r() < 0.3 };
    }
    this._plans.set(key, plan);
    if (this._plans.size > 64) this._plans.delete(this._plans.keys().next().value);
    return plan;
  }

  // The portals whose ground (8 blocks round) reaches the box.
  near(x0, z0, x1, z1) {
    const out = [];
    const R = 40 * S;
    for (let rx = Math.floor((x0 - 10) / R); rx <= Math.floor((x1 + 10) / R); rx++) {
      for (let rz = Math.floor((z0 - 10) / R); rz <= Math.floor((z1 + 10) / R); rz++) {
        const p = this.planOf(rx, rz);
        if (p && p.x + 8 >= x0 && p.x - 8 <= x1 && p.z + 8 >= z0 && p.z - 8 <= z1) out.push(p);
      }
    }
    return out;
  }

  // Into chunk (cx, cz)'s blocks (the Overworld's: after its ground cover).
  place(blocks, cx, cz) {
    for (const p of this.near(cx * S, cz * S, cx * S + S - 1, cz * S + S - 1)) this._build(chunkWriter(blocks, cx, cz), p);
  }

  _build(w, p) {
    const { x, y, z, seed } = p;
    // (the ground round it turned to netherrack, thinning out; a little magma)
    for (let dx = -6; dx <= 6; dx++) {
      for (let dz = -6; dz <= 6; dz++) {
        const bx = x + dx;
        const bz = z + dz;
        if (!w.inside(bx, bz)) continue;
        const d = Math.hypot(dx, dz);
        const h = hash2(seed, bx, bz);
        if (h > 1.15 - d / 6) continue;
        // (the top of the ground in this column, near the portal's floor)
        let gy = -1;
        for (let yy = y + 2; yy >= y - 4; yy--) {
          const b = w.get(bx, yy, bz);
          if (b > 0 && IS_SOLID[b] && !BLOCK_INFO[b]?.leaves && !BLOCK_INFO[b]?.log) {
            gy = yy;
            break;
          }
        }
        if (gy < 0) continue;
        w.put(bx, gy, bz, h < 0.08 ? I.MAGMA_BLOCK : I.NETHERRACK);
        const above = w.get(bx, gy + 1, bz);
        if (above > 0 && !IS_SOLID[above] && BLOCK_INFO[above]?.support) w.put(bx, gy + 1, bz, AIR);
      }
    }
    // (a floor under the frame, the frame's broken remains, the space inside cleared)
    const at = (a, h) => (p.alongX ? [x + a, y + h, z] : [x, y + h, z + a]);
    for (let a = -1; a <= 2; a++) {
      const [bx, by, bz] = at(a, -1);
      w.put(bx, by, bz, I.OBSIDIAN);
      w.fillDown(bx, by - 1, bz, this.dim === "nether" ? I.NETHERRACK : BLOCK.STONE);
      for (let h = 0; h < 5; h++) {
        const [px, py, pz] = at(a, h);
        w.put(px, py, pz, AIR);
      }
    }
    for (const [a, h, id] of p.frame) {
      const [bx, by, bz] = at(a, h);
      w.put(bx, by, bz, id);
    }
    if (p.gold) {
      const [bx, by, bz] = at(0, -1);
      w.put(bx, by, bz, I.GOLD_BLOCK);
    }
    // (broken pieces of the frame lying about)
    for (let k = 0; k < 3; k++) {
      const ox = x + Math.floor(hash2(seed + k, 5, 6) * 9) - 4;
      const oz = z + Math.floor(hash2(seed + k, 7, 8) * 9) - 4;
      if (Math.abs(ox - x) <= 2 && Math.abs(oz - z) <= 2) continue;
      for (let yy = y + 2; yy >= y - 3; yy--) {
        const b = w.get(ox, yy, oz);
        if (b > 0 && IS_SOLID[b]) {
          if (w.get(ox, yy + 1, oz) === AIR) w.put(ox, yy + 1, oz, k ? I.OBSIDIAN : I.CRYING_OBSIDIAN);
          break;
        }
      }
    }
    // (the chest beside it, on the ground)
    const [qx, qy, qz] = p.chest;
    if (w.inside(qx, qz)) {
      let gy = qy;
      for (let yy = qy + 2; yy >= qy - 3; yy--) {
        const b = w.get(qx, yy, qz);
        if (b > 0 && IS_SOLID[b] && b !== BLOCK.CHEST) {
          gy = yy + 1;
          break;
        }
      }
      w.put(qx, gy, qz, p.alongX ? chest(0, 1) : chest(1, 0));
      if (!IS_SOLID[w.get(qx, gy - 1, qz)]) w.put(qx, gy - 1, qz, I.NETHERRACK);
    }
  }

  // "ruined_portal" if a ruined portal's chest stands at (x, y, z).
  chestAt(x, y, z) {
    for (const p of this.near(x, z, x, z)) {
      const [qx, , qz] = p.chest;
      if (qx === x && qz === z && Math.abs(y - p.y) <= 4) return "ruined_portal";
    }
    return null;
  }
}

// ---------- The Nether's structures (js/dim-nether.js: generator.structures) ----------

export class NetherStructures {
  constructor(gen) {
    this.gen = gen;
    this.seed = gen.seed;
    this._starts = new Map(); // "rx,rz" -> plan or null
    this.ruined = new RuinedPortals(gen, "nether");
  }

  // The structure of region (rx, rz): a fortress or a bastion, or null.
  startOf(rx, rz) {
    const key = `${rx},${rz}`;
    if (this._starts.has(key)) return this._starts.get(key);
    const r = mulberry32((this.seed ^ COMPLEX_SALT ^ Math.imul(rx, 341873128712 | 0) ^ Math.imul(rz, 132897987541 | 0)) >>> 0);
    const cx = rx * REGION + Math.floor(r() * (REGION - SEPARATION));
    const cz = rz * REGION + Math.floor(r() * (REGION - SEPARATION));
    const fortress = Math.floor(r() * 5) < 2;
    let plan = null;
    const x = cx * S + 8;
    const z = cz * S + 8;
    if (fortress) plan = planFortress(r, cx * S + 2, 48 + Math.floor(r() * 21), cz * S + 2);
    else if (this.gen.biomeAt(x, z) !== 4) {
      // (on the floor in the middle, above the lava sea; over open lava, at its surface)
      let y = this.gen.floorBelow(x, 100, z, 68);
      if (y < 34) y = 34;
      plan = planBastion(r, x, y, z);
    }
    this._starts.set(key, plan);
    if (this._starts.size > 32) this._starts.delete(this._starts.keys().next().value);
    return plan;
  }

  // The structures reaching chunk (cx, cz).
  _near(cx, cz) {
    const out = [];
    const reach = FORTRESS_REACH;
    for (let rx = Math.floor((cx - reach) / REGION); rx <= Math.floor((cx + reach) / REGION); rx++) {
      for (let rz = Math.floor((cz - reach) / REGION); rz <= Math.floor((cz + reach) / REGION); rz++) {
        const p = this.startOf(rx, rz);
        if (!p) continue;
        const b = p.box;
        if (b.x1 < cx * S || b.x0 > cx * S + S - 1 || b.z1 < cz * S || b.z0 > cz * S + S - 1) continue;
        out.push(p);
      }
    }
    return out;
  }

  place(blocks, cx, cz) {
    const x0 = cx * S;
    const z0 = cz * S;
    for (const plan of this._near(cx, cz)) {
      const w = chunkWriter(blocks, cx, cz);
      if (plan.kind === "fortress") {
        for (const p of plan.pieces) {
          const b = p.box;
          // (a piece's pillars go down from its box: only its own columns matter)
          if (b.x1 < x0 || b.x0 > x0 + S - 1 || b.z1 < z0 || b.z0 > z0 + S - 1) continue;
          buildPiece(w, p, this.seed);
        }
      } else buildBastion(w, plan);
    }
    this.ruined.place(blocks, cx, cz);
  }

  // ---------- Questions from the game ----------

  // Which structure's chest stands at (x, y, z): "nether_bridge",
  // "bastion_treasure", "bastion_other", "ruined_portal" or null.
  chestAt(x, y, z) {
    for (const plan of this._near(x >> 4, z >> 4)) {
      if (plan.kind === "fortress") {
        if (plan.chests.some((c) => c[0] === x && c[1] === y && c[2] === z)) return "nether_bridge";
      } else {
        const c = plan.chests.find((c) => c[0] === x && c[1] === y && c[2] === z);
        if (c) return c[3];
      }
    }
    return this.ruined.chestAt(x, y, z);
  }

  // The blaze spawners standing in chunk (cx, cz) (js/structures.js Spawners).
  spawnerSpots(cx, cz) {
    const cells = [];
    for (const plan of this._near(cx, cz)) {
      if (plan.kind !== "fortress") continue;
      for (const s of plan.spawners) if (s[0] >> 4 === cx && s[2] >> 4 === cz) cells.push(s.slice());
    }
    return { columns: [], cells };
  }

  // Whether (x, y, z) is inside a fortress's pieces (vanilla's fortress spawns:
  // blazes, wither skeletons... NETHER_SPAWNS.fortress) / a bastion's walls.
  fortressAt(x, y, z) {
    for (const plan of this._near(x >> 4, z >> 4)) {
      if (plan.kind !== "fortress") continue;
      for (const p of plan.pieces) {
        const b = p.box;
        if (x >= b.x0 && x <= b.x1 && y >= b.y0 - 1 && y <= b.y1 && z >= b.z0 && z <= b.z1) return true;
      }
    }
    return false;
  }

  bastionAt(x, y, z) {
    for (const plan of this._near(x >> 4, z >> 4)) {
      const b = plan.box;
      if (plan.kind === "bastion" && x >= b.x0 && x <= b.x1 && y >= b.y0 && y <= b.y1 && z >= b.z0 && z <= b.z1) return true;
    }
    return false;
  }

  // The nearest structure of `kind` ("fortress" | "bastion") to (x, z) within
  // `r` blocks: { x, y, z } of its start, or null (tests, /locate-style help).
  nearest(kind, x, z, r = 600) {
    let best = null;
    let bd = Infinity;
    const R = REGION * S;
    for (let rx = Math.floor((x - r) / R); rx <= Math.floor((x + r) / R); rx++) {
      for (let rz = Math.floor((z - r) / R); rz <= Math.floor((z + r) / R); rz++) {
        const p = this.startOf(rx, rz);
        if (!p || p.kind !== kind) continue;
        const s = kind === "fortress" ? p.pieces[0].f : p;
        const px = kind === "fortress" ? s.ox : s.x;
        const pz = kind === "fortress" ? s.oz : s.z;
        const py = kind === "fortress" ? s.oy : s.y;
        const d = Math.hypot(px - x, pz - z);
        if (d < bd && d <= r) {
          bd = d;
          best = { x: px, y: py, z: pz };
        }
      }
    }
    return best;
  }
}
