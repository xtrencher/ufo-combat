// Decoration (Round 11 wave C): dyes, signs, cakes, coloured beds, stained glass,
// flower pots and the like.
// Ids: blocks 2048-2303, items 704-767. What a content module may export, and its rules (imports only
// ./base.js and other content modules' id constants): see ./index.js.
//
// Vanilla in values and recipes: the sixteen dyes from their flowers, bone
// meal, lapis, cocoa, cactus and ink sacs and from mixing; wool, carpets,
// terracotta, glass, panes and beds dyed with them; concrete powder (sand,
// gravel, a dye) falling like sand and turning into concrete against water
// (js/decor-sim.js watches the edits); signs, standing (16 turns) or on a
// wall, whose text js/signs.js keeps, edits and draws; the cake, eaten in
// seven bites; flower pots. A sheep dyed with a dye is js/mobs.js's.
// Where the engine sets a limit: stained glass is cut out like the game's
// glass (no blended blocks), so its colour is in the frame and the streaks;
// signs come in oak, spruce and birch, the woods with doors (the other
// planks make oak ones), and pots hold the twelve flowers, five saplings,
// both mushrooms and a cactus (the module's 256 block ids).
import { BLOCK, ITEM, RENDER, FACE, LIB, BLOCK_LIMIT } from "./base.js";
import * as I from "./ids.js";

// ---------- Ids ----------
// Blocks (the colours in COLORS order).
export const STAINED_GLASS = 2048; // 16 ids: colour
export const STAINED_GLASS_PANE = 2064; // 16 ids: colour
export const CONCRETE_POWDER = 2080; // 16 ids: colour
export const CAKE_BLOCK = 2096; // 7 ids: bites eaten 0-6
export const BEDS = 2103; // 15 colours (red is building.js's RED_BED) x 8 ids: facing (4) x head (2), as the red one's
export const OAK_SIGN = 2223; // 20 ids: standing, turned 0-15 (sixteenths of a turn from +Z), then on a wall, facing 0-3 (ids.js facings)
export const SPRUCE_SIGN = 2243; // 20 ids, as the oak one
export const BIRCH_SIGN = 2263; // 20 ids, as the oak one
export const FLOWER_POT = 2283;
export const POTTED = 2284; // 20 ids: the plants in POTTABLE order
// (decor.js blocks: the range is full)
// Items.
export const WHITE_DYE = 704; // 16 ids: colour
export const INK_SAC = 720;
// (decor.js items: next free 721)

export const COLORS = ["white", "orange", "magenta", "light_blue", "yellow", "lime", "pink", "gray", "light_gray", "cyan", "purple", "blue", "brown", "green", "red", "black"];
export const COLOR_NAMES = COLORS.map((c) => c.split("_").map((w) => w[0].toUpperCase() + w.slice(1)).join(" "));
const C = Object.fromEntries(COLORS.map((c, i) => [c.toUpperCase(), i]));
export const RED = C.RED;
export const BLACK = C.BLACK;
export const DYES = COLORS.map((_, i) => WHITE_DYE + i);
// The coloured blocks of the other modules, by colour.
export const WOOLS = COLORS.map((_, i) => (i === 0 ? BLOCK.WOOL : I.ORANGE_WOOL + i - 1));
export const CARPETS = COLORS.map((_, i) => I.WHITE_CARPET + i);
export const TERRACOTTAS = COLORS.map((_, i) => I.WHITE_TERRACOTTA + i);
export const CONCRETES = COLORS.map((_, i) => I.WHITE_CONCRETE + i);
// The bed of a colour (its foot facing +Z: the item).
export const bedOf = (c) => (c === RED ? I.RED_BED : BEDS + 8 * (c < RED ? c : c - 1));
export const BED_ITEMS = COLORS.map((_, i) => bedOf(i));

// The colour (0-15) a dye item gives, or -1.
export function dyeColorOf(id) {
  return id >= WHITE_DYE && id < WHITE_DYE + 16 ? id - WHITE_DYE : -1;
}

// The colour two dyes mix into in the grid (vanilla's two-dye recipes), or
// -1: a lamb of two sheep of those colours is born that colour.
const MIX = [["RED", "YELLOW", "ORANGE"], ["PURPLE", "PINK", "MAGENTA"], ["BLUE", "WHITE", "LIGHT_BLUE"], ["GREEN", "WHITE", "LIME"], ["RED", "WHITE", "PINK"], ["BLACK", "WHITE", "GRAY"], ["GRAY", "WHITE", "LIGHT_GRAY"], ["BLUE", "GREEN", "CYAN"], ["BLUE", "RED", "PURPLE"]];
export function mixDyeColors(a, b) {
  for (const [x, y, r] of MIX) if ((C[x] === a && C[y] === b) || (C[x] === b && C[y] === a)) return C[r];
  return -1;
}

// Vanilla's sign text colours by dye (non-glowing text is drawn at 0.4 of them).
export const DYE_TEXT_RGB = [0xf9fffe, 0xf9801d, 0xc74ebd, 0x3ab3da, 0xfed83d, 0x80c71f, 0xf38baa, 0x474f52, 0x9d9d97, 0x169c9c, 0x8932b8, 0x3c44aa, 0x835432, 0x5e7c16, 0xb02e26, 0x1d1d21];

// ---------- Facings and boxes ----------

const S = 1 / 16;
const FX = [0, 0, 1, -1];
const FZ = [1, -1, 0, 0];
const OPP = [1, 0, 3, 2];
const LEFT = [2, 3, 1, 0];
const RIGHT = [3, 2, 0, 1];
const DIR_FACE = [FACE.PZ, FACE.NZ, FACE.PX, FACE.NX];
const bit = (face) => 1 << face;
const ALL = 63;
export function facingOf(dx, dz) {
  return Math.abs(dx) >= Math.abs(dz) ? (dx >= 0 ? 2 : 3) : dz >= 0 ? 0 : 1;
}
const look = (ctx) => facingOf(ctx.forward[0], ctx.forward[2]);
// The half of a cell toward a facing: [x0, z0, x1, z1].
const HALF = [
  [0, 0.5, 1, 1],
  [0, 0, 1, 0.5],
  [0.5, 0, 1, 1],
  [0, 0, 0.5, 1],
];
// A box along the cell's edge on side f, t thick, from y0 to y1.
function edgeBox(f, t, y0, y1) {
  if (f === 0) return [0, y0, 1 - t, 1, y1, 1];
  if (f === 1) return [0, y0, 0, 1, y1, t];
  if (f === 2) return [1 - t, y0, 0, 1, y1, 1];
  return [0, y0, 0, t, y1, 1];
}
// (128: the world's height, constants.js WORLD_HEIGHT)
const free = (world, x, y, z) => y >= 0 && y < 128 && LIB.IS_REPLACEABLE[world.getBlock(x, y, z)] === 1;
// A tile's quadrants (16 x 16 pixels, vanilla's own size): [u0, v0, u1, v1].
const Q = [
  [0, 0.5, 0.5, 1], // top left
  [0.5, 0.5, 1, 1], // top right
  [0, 0, 0.5, 0.5], // bottom left
  [0.5, 0, 1, 0.5], // bottom right
];
// Six tile layers of one block face, for m.box (built on first use, the
// same on the main thread and in the workers: FACE_TILES is blocks.js's).
const tileSets = new Map();
function tilesOf(blockId, face = FACE.PX) {
  const key = blockId * 8 + face;
  let t = tileSets.get(key);
  if (!t) tileSets.set(key, (t = new Array(6).fill(LIB.FACE_TILES[blockId * 6 + face])));
  return t;
}
// A drop's position for entities.spawn (a THREE.Vector3: cloned from the player's).
function dropAt(ctx, x, y, z, id, n) {
  if (!ctx.entities || n <= 0) return;
  const p = ctx.player.position.clone();
  p.set(x + 0.5, y + 0.5, z + 0.5);
  ctx.entities.spawn(id, n, p);
}
// An item given back to the player (the hand, the inventory, or the ground).
function giveBack(ctx, id, x, y, z) {
  if (ctx.creative && ctx.inventory.countItem?.(id)) return;
  const left = ctx.inventory.add(id, 1);
  if (left > 0) dropAt(ctx, x, y, z, id, left);
}
const useOne = (ctx) => {
  if (!ctx.creative) ctx.inventory.consumeSelected(1);
};

// ---------- What each id is (flat tables, the same in the workers) ----------

const K = { GLASS: 1, PANE: 2, POWDER: 3, CAKE: 4, BED: 5, SIGN: 6, POT: 7 };
const KIND = new Uint8Array(BLOCK_LIMIT);
const VAR = new Uint8Array(BLOCK_LIMIT); // colour, bites, bed variant, sign turn (16 + facing on a wall), pot plant + 1
const COLOR = new Uint8Array(BLOCK_LIMIT);
const WOOD = new Uint8Array(BLOCK_LIMIT);
function mark(id, kind, v, color = 0) {
  KIND[id] = kind;
  VAR[id] = v;
  COLOR[id] = color;
}
export const isStainedPane = (id) => KIND[id] === K.PANE;
export const isSign = (id) => KIND[id] === K.SIGN;
export const isCake = (id) => KIND[id] === K.CAKE;
export const isDecorBed = (id) => KIND[id] === K.BED;
// A sign's look: { wood (0 oak, 1 spruce, 2 birch), standing, turn (0-15), facing (0-3, on a wall) }, or null.
export function signInfo(id) {
  if (KIND[id] !== K.SIGN) return null;
  const v = VAR[id];
  return { wood: WOOD[id], standing: v < 16, turn: v < 16 ? v : 0, facing: v < 16 ? 0 : v - 16 };
}

// ---------- Defs ----------

export const blocks = {};
export const items = {};
export const blockUse = {};
export const itemUse = {};
export const drops = {};
export const randomTick = {};

// Dyes and the ink sac.
COLORS.forEach((c, i) => {
  items[WHITE_DYE + i] = { name: `${COLOR_NAMES[i]} Dye`, icon: `dye_${c}` };
});
items[INK_SAC] = { name: "Ink Sac", icon: "ink_sac" };

// Stained glass: cut out like glass; nothing drops without silk touch.
COLORS.forEach((c, i) => {
  const id = STAINED_GLASS + i;
  mark(id, K.GLASS, i, i);
  blocks[id] = { name: `${COLOR_NAMES[i]} Stained Glass`, faces: `stained_glass_${c}`, render: RENDER.CUTOUT, opaque: false, skyPass: true, hardness: 0.3, sound: "glass" };
  drops[id] = () => [];
});

// Stained glass panes: 2/16 thick, joined to panes, walls and full blocks
// around them (the building part's panes too), a straight run as one box.
const WALLS = new Set([I.COBBLESTONE_WALL, I.MOSSY_COBBLESTONE_WALL, I.STONE_BRICK_WALL, I.BRICK_WALL, I.SANDSTONE_WALL]);
const OTHER_PANES = new Set([I.GLASS_PANE, I.IRON_BARS]);
const isAnyPane = (n) => KIND[n] === K.PANE || OTHER_PANES.has(n);
// Solid full cubes (glass too, not leaves), built on first use (BLOCK_INFO
// is only there once blocks.js has loaded); concrete powder counts.
let FULL = null;
function fullTable() {
  if (FULL) return FULL;
  FULL = new Uint8Array(BLOCK_LIMIT);
  for (let id = 0; id < BLOCK_LIMIT; id++) {
    const b = LIB.BLOCK_INFO[id];
    FULL[id] = !b ? 1 : (b.solid && b.shape === 0 && !b.leaves && !b.liquid) || KIND[id] === K.POWDER ? 1 : 0;
  }
  return FULL;
}
const paneJoins = (n) => isAnyPane(n) || WALLS.has(n) || fullTable()[n] === 1;
// The neighbours joined (bit d: toward facing d), in the world or the mesh.
function paneMaskWorld(world, x, y, z) {
  let mask = 0;
  for (let d = 0; d < 4; d++) if (paneJoins(world.getBlock(x + FX[d], y, z + FZ[d]))) mask |= 1 << d;
  return mask;
}
function paneMaskMesh(m) {
  let mask = 0;
  for (let d = 0; d < 4; d++) if (paneJoins(m.neighbor(FX[d], 0, FZ[d]))) mask |= 1 << d;
  return mask;
}
// [x0, y0, z0, x1, y1, z1, skip, edge]: edge a mask of the faces on the
// cell's side left out when a pane carries on there.
const PANE_PARTS = [];
const PANE_BOXES = [];
for (let mask = 0; mask < 16; mask++) {
  const parts = [];
  const zs = mask & 3;
  const xs = mask & 12;
  const lo = 7 * S;
  const hi = 9 * S;
  const line = (b, skip, edge) => parts.push([...b, skip, edge]);
  if (xs || !zs) {
    line([mask & 8 ? 0 : lo, 0, lo, mask & 4 ? 1 : hi, 1, hi], 0, (mask & 4 ? bit(FACE.PX) : 0) | (mask & 8 ? bit(FACE.NX) : 0));
    if (mask & 1) line([lo, 0, hi, hi, 1, 1], bit(FACE.NZ), bit(FACE.PZ));
    if (mask & 2) line([lo, 0, 0, hi, 1, lo], bit(FACE.PZ), bit(FACE.NZ));
  } else {
    line([lo, 0, mask & 2 ? 0 : lo, hi, 1, mask & 1 ? 1 : hi], 0, (mask & 1 ? bit(FACE.PZ) : 0) | (mask & 2 ? bit(FACE.NZ) : 0));
  }
  PANE_PARTS[mask] = parts;
  PANE_BOXES[mask] = parts.map((p) => p.slice(0, 6));
}
const collidePane = (world, x, y, z) => PANE_BOXES[paneMaskWorld(world, x, y, z)];
COLORS.forEach((c, i) => {
  const id = STAINED_GLASS_PANE + i;
  mark(id, K.PANE, i, i);
  blocks[id] = {
    name: `${COLOR_NAMES[i]} Stained Glass Pane`,
    faces: `stained_glass_${c}`,
    shape: "decor_pane",
    render: RENDER.CUTOUT,
    opaque: false,
    skyPass: true,
    box: [0, 0, 0, 1, 1, 1],
    collision: [PANE_BOXES[0][0]],
    collide: collidePane,
    hardness: 0.3,
    sound: "glass",
  };
  drops[id] = () => [];
});
// (For the building part's panes and walls: they join these too.)
LIB.joinsPane = (id) => KIND[id] === K.PANE;

// Concrete powder: falls like sand; against water it is concrete
// (js/decor-sim.js; a random tick as well, for any it missed). Four colours
// share a tile, a quadrant each: drawn as a box with that quadrant.
// (water, or a plant standing in it: a flat table, built on first use)
let WATERY = null;
function isWaterId(id) {
  if (!WATERY) {
    WATERY = new Uint8Array(BLOCK_LIMIT);
    for (let i = 0; i < BLOCK_LIMIT; i++) WATERY[i] = i === BLOCK.WATER || LIB.BLOCK_INFO[i]?.waterlogged === true ? 1 : 0;
  }
  return WATERY[id] === 1;
}
// Whether the powder at (x, y, z) touches water: the four sides or above (vanilla's, not below).
export function powderTouchesWater(world, x, y, z) {
  return isWaterId(world.getBlock(x + 1, y, z)) || isWaterId(world.getBlock(x - 1, y, z)) || isWaterId(world.getBlock(x, y, z + 1)) || isWaterId(world.getBlock(x, y, z - 1)) || isWaterId(world.getBlock(x, y + 1, z));
}
export const isPowder = (id) => KIND[id] === K.POWDER;
export const concreteOf = (powderId) => I.WHITE_CONCRETE + COLOR[powderId];
export const isWater = isWaterId;
COLORS.forEach((c, i) => {
  const id = CONCRETE_POWDER + i;
  mark(id, K.POWDER, i, i);
  const uv = Q[i & 3];
  blocks[id] = {
    name: `${COLOR_NAMES[i]} Concrete Powder`,
    faces: `concrete_powder_${i >> 2}`,
    shape: "decor_quad_cube",
    hardness: 0.5,
    tool: "shovel",
    sound: "sand",
    gravity: true,
    itemBoxes: [[0, 0, 0, 1, 1, 1, uv]],
  };
  randomTick[id] = (world, x, y, z, bid) => {
    if (powderTouchesWater(world, x, y, z)) world.setBlock(x, y, z, concreteOf(bid));
  };
});

// The cake: seven bites (2 food, 0.4 saturation each); a bite is taken off
// its -X side. The cake item (items-vanilla.js) places it.
const CAKE_SLICE = { name: "Cake", food: { hunger: 2, saturation: 0.4 }, heal: 2 };
const CAKE_UV = { top: Q[0], side: Q[1], inner: Q[2], bottom: Q[3] };
const cakeX0 = (bites) => (1 + 2 * bites) * S;
function eatCake(ctx) {
  const p = ctx.player;
  if (!p || p.dead) return false;
  // (Creative: a bite comes off, as in vanilla; nothing is eaten.)
  if (!ctx.creative) {
    if (!p.canEat?.(CAKE_SLICE, 0)) return false;
    p.eat(CAKE_SLICE, 0);
  }
  const bites = VAR[ctx.id];
  ctx.world.setBlock(ctx.x, ctx.y, ctx.z, bites >= 6 ? BLOCK.AIR : ctx.id + 1);
  ctx.audio?.playEat?.();
  return true;
}
for (let b = 0; b < 7; b++) {
  const id = CAKE_BLOCK + b;
  mark(id, K.CAKE, b);
  const box = [cakeX0(b), 0, S, 15 * S, 0.5, 15 * S];
  blocks[id] = {
    name: "Cake",
    faces: "cake",
    shape: "decor_cake",
    opaque: false,
    skyPass: true,
    box,
    collision: [box],
    hardness: 0.5,
    sound: "cloth",
    item: I.CAKE,
    // (on a solid block; it goes, and drops nothing, when that goes)
    support: (below) => LIB.IS_SOLID[below] === 1,
  };
  blockUse[id] = eatCake;
  drops[id] = () => [];
}
// (The cake item is the classic game's block: it places the cake.)
itemUse[I.CAKE] = (ctx) => !!ctx.interaction?._place?.(CAKE_BLOCK);

// Beds in the other fifteen colours, laid out as the red one (building.js):
// facing + 4 * head, the foot where it's placed, the head on along its
// facing. Built of the wool of its colour on an oak frame, the head's sheet
// and pillow white (no tiles of their own).
const BED_BASES = [];
const bedFacing = (id) => VAR[id] & 3;
const bedHead = (id) => VAR[id] >> 2;
function decorBedAt(world, x, y, z) {
  const id = world.getBlock(x, y, z);
  if (KIND[id] !== K.BED) return null;
  const f = bedFacing(id);
  const s = bedHead(id) ? -1 : 1;
  const ox = x + FX[f] * s;
  const oz = z + FZ[f] * s;
  const other = world.getBlock(ox, y, oz);
  if (KIND[other] !== K.BED || COLOR[other] !== COLOR[id] || bedFacing(other) !== f || bedHead(other) === bedHead(id)) return null;
  const foot = bedHead(id) ? [ox, y, oz] : [x, y, z];
  const head = bedHead(id) ? [x, y, z] : [ox, y, oz];
  return { foot, head, facing: [FX[f], FZ[f]], id: bedOf(COLOR[id]) };
}
// (Sleeping is the survival part's: LIB.onBedUse, as the red bed's.)
function useBed(ctx) {
  const bed = decorBedAt(ctx.world, ctx.x, ctx.y, ctx.z);
  if (!bed || typeof LIB.onBedUse !== "function") return false;
  return !!LIB.onBedUse({ ...ctx, bed });
}
function placeBedHead(ctx, id, x, y, z) {
  const f = bedFacing(id);
  return free(ctx.world, x + FX[f], y, z + FZ[f]) ? [x + FX[f], y, z + FZ[f], id + 4] : null;
}
// A bed's parts: [box, tiles (0 frame, 1 blanket, 2 sheet), skip], per head * 4 + facing.
const BED_PARTS = [];
for (let head = 0; head < 2; head++) {
  for (let f = 0; f < 4; f++) {
    const toward = head ? OPP[f] : f; // (the other half)
    const outer = head ? f : OPP[f]; // (the bed's end in this cell)
    const list = [];
    for (const side of [LEFT[f], RIGHT[f]]) {
      const a = HALF[outer];
      const b = HALF[side];
      const lx = Math.max(a[0], b[0]) === 0 ? 0 : 1 - 3 * S;
      const lz = Math.max(a[1], b[1]) === 0 ? 0 : 1 - 3 * S;
      list.push([[lx, 0, lz, lx + 3 * S, 3 * S, lz + 3 * S], 0, bit(FACE.PY)]);
    }
    list.push([[0, 3 * S, 0, 1, 6 * S, 1], 0, bit(FACE.PY) | bit(DIR_FACE[toward])]);
    if (!head) list.push([[0, 6 * S, 0, 1, 9 * S, 1], 1, bit(FACE.NY) | bit(DIR_FACE[toward])]);
    else {
      // The blanket up to the middle, the white sheet on the head's half,
      // and the pillow on it (2/16 in from the sides and the end).
      const fb = HALF[OPP[f]];
      const hb = HALF[f];
      list.push([[fb[0], 6 * S, fb[1], fb[2], 9 * S, fb[3]], 1, bit(FACE.NY) | bit(DIR_FACE[OPP[f]]) | bit(DIR_FACE[f])]);
      list.push([[hb[0], 6 * S, hb[1], hb[2], 9 * S, hb[3]], 2, bit(FACE.NY) | bit(DIR_FACE[OPP[f]])]);
      const along = (lo, hi) => (f === 0 ? [1 - hi, 1 - lo] : f === 1 ? [lo, hi] : f === 2 ? [1 - hi, 1 - lo] : [lo, hi]);
      const [a0, a1] = along(S, 7 * S);
      const pillow = f < 2 ? [2 * S, 9 * S, a0, 14 * S, 10 * S, a1] : [a0, 9 * S, 2 * S, a1, 10 * S, 14 * S];
      list.push([pillow, 2, bit(FACE.NY)]);
    }
    BED_PARTS[head * 4 + f] = list;
  }
}
const woolTile = (c) => (c === 0 ? "wool" : `wool_${COLORS[c]}`);
COLORS.forEach((c, ci) => {
  if (ci === RED) return;
  const base = bedOf(ci);
  BED_BASES.push(base);
  for (let v = 0; v < 8; v++) {
    const id = base + v;
    const f = v & 3;
    const head = v >> 2;
    mark(id, K.BED, v, ci);
    const box = [0, 0, 0, 1, 9 * S, 1];
    blocks[id] = {
      name: `${COLOR_NAMES[ci]} Bed`,
      faces: { top: woolTile(ci), bottom: "planks", side: woolTile(ci) },
      shape: "decor_bed",
      opaque: false,
      skyPass: true,
      box,
      collision: [box],
      hardness: 0.2,
      sound: "cloth",
      stack: 1,
      // (the survival part's beds: sleeping, the spawn point, the soft landing)
      bed: true,
      head: !!head,
      partner: head ? [-FX[f], 0, -FZ[f]] : [FX[f], 0, FZ[f]],
      pairs: (other) => KIND[other] === K.BED && COLOR[other] === ci && bedFacing(other) === f && bedHead(other) !== head,
      placeMore: head ? null : placeBedHead,
      ...(v
        ? { item: base }
        : {
            placeAs: (ctx) => base + look(ctx),
            // (side on: the legs, the frame, the blanket and the white sheet and pillow at the head)
            itemSprite: [
              ["planks", 0, 0, 5, 5, 2, 24, 5, 5],
              ["planks", 0, 0, 5, 5, 25, 24, 5, 5],
              ["planks", 0, 8, 30, 6, 1, 18, 30, 6],
              [woolTile(ci), 0, 0, 19, 6, 1, 12, 19, 6],
              ["wool", 0, 0, 11, 6, 20, 12, 11, 6],
              ["wool", 4, 10, 9, 2, 21, 10, 9, 2],
            ],
          }),
    };
    blockUse[id] = useBed;
  }
});

// Signs: oak, spruce, birch; 16 turns standing on a solid block, or on the
// side of one facing out (and gone with it). The text is js/signs.js's (a
// right click edits it; a dye colours it).
export const SIGN_WOODS = [
  { key: "oak", name: "Oak", base: OAK_SIGN, planks: BLOCK.PLANKS, tile: "planks" },
  { key: "spruce", name: "Spruce", base: SPRUCE_SIGN, planks: I.SPRUCE_PLANKS, tile: "spruce_planks" },
  { key: "birch", name: "Birch", base: BIRCH_SIGN, planks: I.BIRCH_PLANKS, tile: "birch_planks" },
];
export const SIGN_ITEMS = SIGN_WOODS.map((w) => w.base);
const SIGN_T = 1.5 * S; // (the board's thickness)
// Where a sign's text goes: { x, y, z } the board's face centre in the
// cell, and the angle (radians about +Y, 0 facing +Z) it faces.
export function signFace(id) {
  const v = VAR[id];
  if (v < 16) {
    const a = (v * Math.PI) / 8;
    const d = SIGN_T / 2 + 0.004;
    return { x: 0.5 + Math.sin(a) * d, y: 0.75, z: 0.5 + Math.cos(a) * d, angle: a };
  }
  const f = v - 16;
  const d = -0.5 + SIGN_T + 0.004;
  return { x: 0.5 + FX[f] * d, y: (4.5 + 12.5) / 32, z: 0.5 + FZ[f] * d, angle: Math.atan2(FX[f], FZ[f]) };
}
// A sign placed now: on a block's side, the wall sign facing out; on top (or
// into a replaceable cell), the standing one turned to face the player.
function placeSign(ctx) {
  const base = ctx.stack.id;
  const n = ctx.normal;
  if (n && n[1] === 0 && !LIB.IS_REPLACEABLE[ctx.id]) return LIB.isWallSupportedBy(ctx.id) ? base + 16 + facingOf(n[0], n[2]) : null;
  if (n && n[1] < 0 && !LIB.IS_REPLACEABLE[ctx.id]) return null; // (under a block: a hanging sign's place, not in)
  const a = Math.atan2(-ctx.forward[0], -ctx.forward[2]);
  return base + (((Math.round(a / (Math.PI / 8)) % 16) + 16) % 16);
}
// Placing one opens its editor (js/signs.js sets LIB.openSignEditor).
function placeSignItem(ctx) {
  const t = ctx.interaction;
  if (!t?._place || !ctx.place) return false;
  const [px, py, pz] = LIB.IS_REPLACEABLE[ctx.id] ? [ctx.x, ctx.y, ctx.z] : ctx.place;
  if (!t._place(ctx.stack.id)) return false;
  if (KIND[ctx.world.getBlock(px, py, pz)] === K.SIGN) LIB.openSignEditor?.(px, py, pz, true);
  return true;
}
// A right click: a dye colours the text (one used); anything else edits it.
function useSign(ctx) {
  const dye = dyeColorOf(ctx.stack?.id ?? 0);
  if (dye >= 0) {
    if (!LIB.dyeSign?.(ctx.x, ctx.y, ctx.z, dye)) return false;
    useOne(ctx);
    return true;
  }
  return !!LIB.openSignEditor?.(ctx.x, ctx.y, ctx.z);
}
SIGN_WOODS.forEach((w, wi) => {
  for (let v = 0; v < 20; v++) {
    const id = w.base + v;
    mark(id, K.SIGN, v);
    WOOD[id] = wi;
    const standing = v < 16;
    const f = v - 16;
    const box = standing ? [4 * S, 0, 4 * S, 12 * S, 1, 12 * S] : edgeBox(OPP[f], 2 * S, 4.5 * S, 12.5 * S);
    blocks[id] = {
      name: `${w.name} Sign`,
      faces: w.tile,
      shape: "decor_sign",
      opaque: false,
      skyPass: true,
      solid: false,
      box,
      hardness: 1,
      tool: "axe",
      sound: "wood",
      stack: 16,
      ...(standing ? { support: (below) => LIB.IS_SOLID[below] === 1 } : { support: "wall", facing: [FX[f], FZ[f]] }),
      ...(v
        ? { item: w.base }
        : {
            placeAs: placeSign,
            // (the board on its post)
            itemSprite: [
              [w.tile, 0, 2, 30, 15, 1, 4, 30, 15],
              [w.tile, 12, 18, 5, 12, 13, 19, 5, 12],
            ],
          }),
    };
    blockUse[id] = useSign;
  }
  itemUse[w.base] = placeSignItem;
});

// Flower pots: right click with a flower, a sapling, a mushroom or a cactus
// puts it in; a right click on a potted one takes it out. Breaking one drops
// the pot and the plant.
export const POTTABLE = [
  BLOCK.FLOWER_RED, // (the poppy)
  BLOCK.FLOWER_YELLOW, // (the dandelion)
  I.BLUE_ORCHID,
  I.ALLIUM,
  I.AZURE_BLUET,
  I.RED_TULIP,
  I.ORANGE_TULIP,
  I.WHITE_TULIP,
  I.PINK_TULIP,
  I.OXEYE_DAISY,
  I.CORNFLOWER,
  I.LILY_OF_THE_VALLEY,
  I.OAK_SAPLING,
  I.SPRUCE_SAPLING,
  I.BIRCH_SAPLING,
  I.JUNGLE_SAPLING,
  I.ACACIA_SAPLING,
  I.RED_MUSHROOM,
  I.BROWN_MUSHROOM,
  BLOCK.CACTUS,
];
const POTTED_NAMES = ["Poppy", "Dandelion", "Blue Orchid", "Allium", "Azure Bluet", "Red Tulip", "Orange Tulip", "White Tulip", "Pink Tulip", "Oxeye Daisy", "Cornflower", "Lily of the Valley", "Oak Sapling", "Spruce Sapling", "Birch Sapling", "Jungle Sapling", "Acacia Sapling", "Red Mushroom", "Brown Mushroom", "Cactus"];
const POT_OF = new Map(POTTABLE.map((p, i) => [p, POTTED + i]));
export const pottedOf = (plant) => POT_OF.get(plant) ?? 0;
export const plantOf = (id) => (KIND[id] === K.POT && VAR[id] > 0 ? POTTABLE[VAR[id] - 1] : 0);
const POT_BOX = [5 * S, 0, 5 * S, 11 * S, 6 * S, 11 * S];
function usePot(ctx) {
  const plant = plantOf(ctx.id);
  if (plant) {
    giveBack(ctx, plant, ctx.x, ctx.y, ctx.z);
    ctx.world.setBlock(ctx.x, ctx.y, ctx.z, FLOWER_POT);
    ctx.audio?.playPlace?.("plant");
    return true;
  }
  const potted = pottedOf(ctx.stack?.id ?? 0);
  if (!potted || !LIB.BLOCK_INFO[potted]) return false;
  if (!ctx.world.setBlock(ctx.x, ctx.y, ctx.z, potted)) return false;
  useOne(ctx);
  ctx.audio?.playPlace?.("plant");
  return true;
}
for (let v = 0; v <= POTTABLE.length; v++) {
  const id = v ? POTTED + v - 1 : FLOWER_POT;
  const plant = v ? POTTABLE[v - 1] : 0;
  mark(id, K.POT, v);
  blocks[id] = {
    name: v ? `Potted ${POTTED_NAMES[v - 1]}` : "Flower Pot",
    faces: { top: "dirt", bottom: "terracotta", side: "terracotta" },
    shape: "decor_pot",
    render: RENDER.CUTOUT,
    opaque: false,
    skyPass: true,
    box: POT_BOX,
    collision: [POT_BOX],
    hardness: 0,
    sound: "stone",
    ...(v ? { item: FLOWER_POT } : { itemBoxes: [[5 * S, 0, 5 * S, 11 * S, 6 * S, 11 * S]] }),
  };
  blockUse[id] = usePot;
  if (v) drops[id] = () => [[FLOWER_POT, 1], [plant, 1]];
}

// ---------- Shapes (meshed the same on the main thread and in the workers) ----------

// A box turned `a` radians about the cell's vertical axis: local x across
// (u0-u1), y up, local z out of its front (w0-w1); each face a quad with
// the cell's light, lit as the axis face nearest its normal. uvOf(face, u,
// y, w) gives a corner's [u, v].
const LOCAL_FACES = [
  { n: [1, 0, 0], c: [[1, 0, 0], [1, 1, 0], [1, 1, 1], [1, 0, 1]] },
  { n: [-1, 0, 0], c: [[0, 0, 1], [0, 1, 1], [0, 1, 0], [0, 0, 0]] },
  { n: [0, 1, 0], c: [[0, 1, 1], [1, 1, 1], [1, 1, 0], [0, 1, 0]] },
  { n: [0, -1, 0], c: [[0, 0, 0], [1, 0, 0], [1, 0, 1], [0, 0, 1]] },
  { n: [0, 0, 1], c: [[0, 0, 1], [1, 0, 1], [1, 1, 1], [0, 1, 1]] },
  { n: [0, 0, -1], c: [[1, 0, 0], [0, 0, 0], [0, 1, 0], [1, 1, 0]] },
];
// (Every turn's corners worked out once: [turn][part] -> [{ face, corners, uvs }].)
function nearestFace(x, y, z) {
  const ax = Math.abs(x);
  const ay = Math.abs(y);
  const az = Math.abs(z);
  if (ay >= ax && ay >= az) return y > 0 ? FACE.PY : FACE.NY;
  if (ax >= az) return x > 0 ? FACE.PX : FACE.NX;
  return z > 0 ? FACE.PZ : FACE.NZ;
}
function turnedBox(a, [u0, y0, w0, u1, y1, w1], uvOf) {
  const cos = Math.cos(a);
  const sin = Math.sin(a);
  const out = [];
  LOCAL_FACES.forEach((lf, fi) => {
    const corners = [];
    const uvs = [];
    for (const [cu, cy, cw] of lf.c) {
      const u = cu ? u1 : u0;
      const y = cy ? y1 : y0;
      const w = cw ? w1 : w0;
      corners.push([0.5 + u * cos + w * sin, y, 0.5 - u * sin + w * cos]);
      uvs.push(uvOf(fi, u, y, w));
    }
    const [nx, , nz] = lf.n;
    out.push({ face: nearestFace(nx * cos + nz * sin, lf.n[1], -nx * sin + nz * cos), corners, uvs });
  });
  return out;
}
// The standing sign: a board 1 wide and 1/2 tall on a post, both planks.
const signUv = (fi, u, y, w) => (fi === 2 || fi === 3 ? [u + 0.5, w + 0.5] : fi < 2 ? [w + 0.5, y] : [fi === 4 ? u + 0.5 : 0.5 - u, y]);
const SIGN_QUADS = [];
for (let r = 0; r < 16; r++) {
  const a = (r * Math.PI) / 8;
  SIGN_QUADS[r] = [
    ...turnedBox(a, [-0.5, 0.5, -SIGN_T / 2, 0.5, 1, SIGN_T / 2], signUv),
    // (the post: no top inside the board, no bottom on the block it stands on)
    ...turnedBox(a, [-S, 0, -S, S, 0.5, S], signUv).filter((q) => q.face !== FACE.PY && q.face !== FACE.NY),
  ];
}

// The bed's tile layers: the frame's planks, the blanket's wool, the white sheet.
const bedTiles = [null, null, null];
function meshBed(m) {
  const c = COLOR[m.id];
  bedTiles[0] = tilesOf(BLOCK.PLANKS);
  bedTiles[1] = tilesOf(WOOLS[c]);
  bedTiles[2] = tilesOf(BLOCK.WOOL);
  const parts = BED_PARTS[bedHead(m.id) * 4 + bedFacing(m.id)];
  for (let i = 0; i < parts.length; i++) {
    const [b, t, skip] = parts[i];
    m.box(b[0], b[1], b[2], b[3], b[4], b[5], bedTiles[t], skip, null);
  }
}

// A plant in a pot: crossed quads of its own tile from the soil up (a
// cactus: a little column of it).
const POT_SOIL = 4 * S;
const CROSS = [];
{
  const lo = 0.18;
  const hi = 0.82;
  const h = 1 - POT_SOIL;
  for (const [x0, z0, x1, z1] of [[lo, lo, hi, hi], [lo, hi, hi, lo]]) {
    CROSS.push({
      corners: [[x0, POT_SOIL, z0], [x1, POT_SOIL, z1], [x1, POT_SOIL + h, z1], [x0, POT_SOIL + h, z0]],
      uvs: [[0, 0], [1, 0], [1, 1], [0, 1]],
    });
  }
}
function meshPot(m) {
  const pot = tilesOf(BLOCK.TERRACOTTA);
  // The pot: its walls 1/16 thick around the soil, 2/16 below the rim.
  m.box(5 * S, 0, 5 * S, 11 * S, POT_SOIL, 11 * S, pot, bit(FACE.PY), null);
  m.box(6 * S, POT_SOIL - 0.001, 6 * S, 10 * S, POT_SOIL, 10 * S, tilesOf(BLOCK.DIRT), ALL & ~bit(FACE.PY), null);
  m.box(5 * S, POT_SOIL, 5 * S, 6 * S, 6 * S, 11 * S, pot, bit(FACE.NY), null);
  m.box(10 * S, POT_SOIL, 5 * S, 11 * S, 6 * S, 11 * S, pot, bit(FACE.NY), null);
  m.box(6 * S, POT_SOIL, 5 * S, 10 * S, 6 * S, 6 * S, pot, bit(FACE.NY) | bit(FACE.PX) | bit(FACE.NX), null);
  m.box(6 * S, POT_SOIL, 10 * S, 10 * S, 6 * S, 11 * S, pot, bit(FACE.NY) | bit(FACE.PX) | bit(FACE.NX), null);
  const plant = plantOf(m.id);
  if (!plant) return;
  if (plant === BLOCK.CACTUS) {
    const side = LIB.FACE_TILES[BLOCK.CACTUS * 6 + FACE.PX];
    const top = LIB.FACE_TILES[BLOCK.CACTUS * 6 + FACE.PY];
    potCactus[0] = potCactus[1] = potCactus[4] = potCactus[5] = side;
    potCactus[2] = potCactus[3] = top;
    m.box(6 * S, POT_SOIL, 6 * S, 10 * S, POT_SOIL + 10 * S, 10 * S, potCactus, bit(FACE.NY), null);
    return;
  }
  const tile = LIB.FACE_TILES[plant * 6 + FACE.PY];
  for (let i = 0; i < CROSS.length; i++) m.quad(CROSS[i].corners, CROSS[i].uvs, FACE.PY, tile);
}
const potCactus = [0, 0, 0, 0, 0, 0];

export const shapes = {
  decor_pane: {
    mesh: (m) => {
      const parts = PANE_PARTS[paneMaskMesh(m)];
      // (panes stacked: no faces between them)
      const ends = (isAnyPane(m.neighbor(0, 1, 0)) ? bit(FACE.PY) : 0) | (isAnyPane(m.neighbor(0, -1, 0)) ? bit(FACE.NY) : 0);
      for (let i = 0; i < parts.length; i++) {
        const p = parts[i];
        let skip = p[6] | ends;
        for (let d = 0; d < 4; d++) if (p[7] & bit(DIR_FACE[d]) && isAnyPane(m.neighbor(FX[d], 0, FZ[d]))) skip |= bit(DIR_FACE[d]);
        m.box(p[0], p[1], p[2], p[3], p[4], p[5], null, skip, null);
      }
    },
  },
  decor_quad_cube: { mesh: (m) => m.box(0, 0, 0, 1, 1, 1, null, 0, Q[COLOR[m.id] & 3]) },
  decor_cake: {
    mesh: (m) => {
      const bites = VAR[m.id];
      const x0 = cakeX0(bites);
      m.box(x0, 0, S, 15 * S, 0.5, 15 * S, null, ALL & ~bit(FACE.PY), CAKE_UV.top);
      m.box(x0, 0, S, 15 * S, 0.5, 15 * S, null, bit(FACE.PY) | bit(FACE.NY) | (bites ? bit(FACE.NX) : 0), CAKE_UV.side);
      if (bites) m.box(x0, 0, S, 15 * S, 0.5, 15 * S, null, ALL & ~bit(FACE.NX), CAKE_UV.inner);
      m.box(x0, 0, S, 15 * S, 0.5, 15 * S, null, ALL & ~bit(FACE.NY), CAKE_UV.bottom);
    },
  },
  decor_bed: { mesh: meshBed },
  decor_sign: {
    mesh: (m) => {
      const v = VAR[m.id];
      const tile = m.tile(FACE.PX);
      if (v < 16) {
        const quads = SIGN_QUADS[v];
        for (let i = 0; i < quads.length; i++) m.quad(quads[i].corners, quads[i].uvs, quads[i].face, tile);
        return;
      }
      const b = edgeBox(OPP[v - 16], SIGN_T, 4.5 * S, 12.5 * S);
      m.box(b[0], b[1], b[2], b[3], b[4], b[5], null, 0, null);
    },
  },
  decor_pot: { mesh: meshPot },
};

// ---------- Recipes (vanilla's) ----------

export const recipes = () => {
  const out = [];
  const shaped = (pattern, key, result, count = 1) => out.push({ type: "shaped", pattern, key, result: [result, count] });
  const shapeless = (ingredients, result, count = 1) => out.push({ type: "shapeless", ingredients, result: [result, count] });
  const D = (c) => DYES[C[c]];
  // Dyes from plants and things.
  for (const [from, c, n] of [
    [I.BONE_MEAL, "WHITE", 1],
    [I.LILY_OF_THE_VALLEY, "WHITE", 1],
    [I.ORANGE_TULIP, "ORANGE", 1],
    [I.ALLIUM, "MAGENTA", 1],
    [I.BLUE_ORCHID, "LIGHT_BLUE", 1],
    [BLOCK.FLOWER_YELLOW, "YELLOW", 1],
    [I.PINK_TULIP, "PINK", 1],
    [I.AZURE_BLUET, "LIGHT_GRAY", 1],
    [I.OXEYE_DAISY, "LIGHT_GRAY", 1],
    [I.WHITE_TULIP, "LIGHT_GRAY", 1],
    [I.LAPIS_LAZULI, "BLUE", 1],
    [I.CORNFLOWER, "BLUE", 1],
    [I.COCOA_BEANS, "BROWN", 1],
    [BLOCK.FLOWER_RED, "RED", 1],
    [I.RED_TULIP, "RED", 1],
    [I.BEETROOT, "RED", 1],
    [INK_SAC, "BLACK", 1],
  ]) {
    shapeless([from], D(c), n);
  }
  out.push({ type: "smelting", input: BLOCK.CACTUS, result: [D("GREEN"), 1], xp: 1, time: 10 });
  // Mixing.
  for (const [ings, c, n] of [
    [["RED", "YELLOW"], "ORANGE", 2],
    [["PURPLE", "PINK"], "MAGENTA", 2],
    [["BLUE", "RED", "PINK"], "MAGENTA", 3],
    [["BLUE", "RED", "RED", "WHITE"], "MAGENTA", 4],
    [["BLUE", "WHITE"], "LIGHT_BLUE", 2],
    [["GREEN", "WHITE"], "LIME", 2],
    [["RED", "WHITE"], "PINK", 2],
    [["BLACK", "WHITE"], "GRAY", 2],
    [["GRAY", "WHITE"], "LIGHT_GRAY", 2],
    [["BLACK", "WHITE", "WHITE"], "LIGHT_GRAY", 3],
    [["BLUE", "GREEN"], "CYAN", 2],
    [["BLUE", "RED"], "PURPLE", 2],
  ]) {
    shapeless(ings.map(D), D(c), n);
  }
  const ANY_PLANKS = [BLOCK.PLANKS, I.SPRUCE_PLANKS, I.BIRCH_PLANKS, I.JUNGLE_PLANKS, I.ACACIA_PLANKS, I.DARK_OAK_PLANKS];
  COLORS.forEach((_, i) => {
    const dye = DYES[i];
    // Wool and beds of any colour take a dye (one each); eight carpets,
    // terracotta, glass or panes around one.
    shapeless([dye, WOOLS.filter((w) => w !== WOOLS[i])], WOOLS[i], 1);
    shapeless([dye, BED_ITEMS.filter((b) => b !== BED_ITEMS[i])], BED_ITEMS[i], 1);
    shaped(["###", "#D#", "###"], { "#": CARPETS.filter((x) => x !== CARPETS[i]), D: dye }, CARPETS[i], 8);
    shaped(["###", "#D#", "###"], { "#": BLOCK.TERRACOTTA, D: dye }, TERRACOTTAS[i], 8);
    shaped(["###", "#D#", "###"], { "#": BLOCK.GLASS, D: dye }, STAINED_GLASS + i, 8);
    shaped(["###", "#D#", "###"], { "#": I.GLASS_PANE, D: dye }, STAINED_GLASS_PANE + i, 8);
    shaped(["###", "###"], { "#": STAINED_GLASS + i }, STAINED_GLASS_PANE + i, 16);
    shapeless([dye, [BLOCK.SAND, I.RED_SAND], [BLOCK.SAND, I.RED_SAND], [BLOCK.SAND, I.RED_SAND], [BLOCK.SAND, I.RED_SAND], BLOCK.GRAVEL, BLOCK.GRAVEL, BLOCK.GRAVEL, BLOCK.GRAVEL], CONCRETE_POWDER + i, 8);
    // A bed of wool of one colour (the red one's recipe is the building part's).
    if (i !== RED) shaped(["WWW", "PPP"], { W: WOOLS[i], P: ANY_PLANKS }, bedOf(i), 1);
  });
  // Signs: six planks over a stick, three signs (the woods without signs make oak ones).
  for (const w of SIGN_WOODS) {
    shaped(["###", "###", " | "], { "#": w.planks, "|": ITEM.STICK }, w.base, 3);
    out.push({ type: "fuel", input: w.base, time: 10 });
  }
  shaped(["###", "###", " | "], { "#": ANY_PLANKS.slice(3), "|": ITEM.STICK }, OAK_SIGN, 3);
  shaped(["# #", " # "], { "#": I.BRICK }, FLOWER_POT, 1);
  return out;
};

// ---------- Textures (21 tiles: 16 stained glass, 4 of concrete powder, the cake) ----------

export const tiles = {};
export const tileRelief = {};

// Vanilla's stained glass and concrete powder colours.
const GLASS_RGB = [0xffffff, 0xd87f33, 0xb24cd8, 0x6699d8, 0xe5e533, 0x7fcc19, 0xf27fa5, 0x4c4c4c, 0x999999, 0x4c7f99, 0x7f3fb2, 0x334cb2, 0x664c33, 0x667f33, 0x993333, 0x191919];
const POWDER_RGB = [0xe1e3e4, 0xe3843c, 0xc154b9, 0x4ab4d5, 0xe8c736, 0x7dbd2a, 0xe499b5, 0x4c5154, 0x9a9a94, 0x25949d, 0x8438b2, 0x4649a7, 0x7d5536, 0x61772d, 0xa83633, 0x191b20];
export const POWDER_COLORS = POWDER_RGB;

// Stained glass: a frame in its colour (lit at the top left), streaks of
// colour across the clear middle, a glint or two.
COLORS.forEach((c, i) => {
  tiles[`stained_glass_${c}`] = (t, kit) => {
    const rgb = kit.hex(GLASS_RGB[i]);
    const light = kit.mixRgb(rgb, [255, 255, 255], 0.35);
    const dark = kit.scaleRgb(rgb, 0.72);
    t.forEach((x, y) => t.set(x, y, rgb, 0));
    for (let k = 0; k < 32; k++) {
      t.set(k, 0, light);
      t.set(0, k, light);
      t.set(k, 31, dark);
      t.set(31, k, dark);
      t.set(k, 1, rgb);
      t.set(1, k, rgb);
      t.set(k, 30, kit.scaleRgb(rgb, 0.85));
      t.set(30, k, kit.scaleRgb(rgb, 0.85));
    }
    // (wavy bands, as old coloured glass has)
    t.forEach((x, y) => {
      if (x < 2 || y < 2 || x > 29 || y > 29) return;
      const s = Math.sin((x + y) * 0.42 + t.fbm(x, y, 4, 2) * 5);
      if (s > 0.82) t.set(x, y, kit.mixRgb(rgb, light, 0.4));
    });
    for (let k = 0; k < 6; k++) t.set(5 + k, 10 - k, kit.mixRgb(light, [255, 255, 255], 0.5));
    for (let k = 0; k < 3; k++) t.set(5 + k, 15 - k, kit.mixRgb(light, [255, 255, 255], 0.5));
  };
  tileRelief[`stained_glass_${c}`] = [0.6, 0.08, 1];
});

// Concrete powder: fine grains, four colours to a tile (a quadrant each).
for (let k = 0; k < 4; k++) {
  tiles[`concrete_powder_${k}`] = (t, kit) => {
    t.forEach((x, y) => {
      const q = (y >> 4) * 2 + (x >> 4);
      const rgb = kit.hex(POWDER_RGB[k * 4 + q]);
      const r = t.rand();
      const f = r < 0.12 ? 0.86 : r > 0.9 ? 1.1 : 0.94 + t.rand() * 0.1;
      t.set(x, y, kit.scaleRgb(rgb, f));
    });
  };
  tileRelief[`concrete_powder_${k}`] = [1.4, 0.95, 1];
}

// The cake: its top (frosting, red sprinkles), side (frosting over the
// sponge, its lower half), inside (a layer of jam) and bottom, a quadrant each.
tiles.cake = (t, kit) => {
  const icing = [kit.hex(0xd9d4cc), kit.hex(0xeeeae4), kit.hex(0xfbf9f6)];
  const sponge = [kit.hex(0x9a5a2a), kit.hex(0xb9773d), kit.hex(0xcf9354), kit.hex(0xdcaa6a)];
  const red = [kit.hex(0x9c1b1b), kit.hex(0xd23b2e)];
  t.forEach((x, y) => {
    const qx = x & 15;
    const qy = y & 15;
    const top = y < 16;
    const left = x < 16;
    if (top && left) {
      // Frosting, the rim a shade darker, sprinkles.
      const rim = qx === 0 || qy === 0 || qx === 15 || qy === 15;
      t.set(x, y, rim ? icing[0] : icing[t.rand() < 0.25 ? 1 : 2]);
    } else if (top) {
      // The side: frosting dripping over the sponge (rows 8-15).
      const drip = qy === 9 && (qx * 7) % 5 < 2;
      if (qy < 8) t.set(x, y, icing[1]);
      else if (qy === 8 || drip) t.set(x, y, icing[qy === 8 ? 2 : 1]);
      else t.set(x, y, qy === 15 ? sponge[0] : sponge[1 + (t.rand() < 0.3 ? 1 : 0)]);
    } else if (left) {
      // Inside: frosting on top (rows 24-25), sponge, the jam between.
      if (qy < 8) t.set(x, y, sponge[2]);
      else if (qy === 8) t.set(x, y, icing[2]);
      else if (qy === 9) t.set(x, y, icing[1]);
      else if (qy === 12) t.set(x, y, red[1]);
      else t.set(x, y, sponge[qy === 15 ? 1 : 2 + (t.rand() < 0.25 ? 1 : 0)]);
    } else t.set(x, y, sponge[t.rand() < 0.3 ? 0 : 1]);
  });
  for (const [x, y] of [[3, 3], [10, 2], [6, 7], [12, 9], [2, 11], [8, 12], [13, 5]]) t.set(x, y, red[(x + y) & 1]);
};
tileRelief.cake = [1.2, 0.85, 1];

// ---------- Icons ----------

// A dye: a small heap of powder in its colour, lit from the top left.
function dyeIcon(kit, rgbHex) {
  const r = (rgbHex >> 16) & 255;
  const g = (rgbHex >> 8) & 255;
  const b = rgbHex & 255;
  const at = (f, w) => {
    const m = (v) => Math.max(0, Math.min(255, Math.round(v * f + 255 * w)));
    return (m(r) << 16) | (m(g) << 8) | m(b);
  };
  const ramp = kit.ramp(at(0.42, 0), at(0.66, 0), at(0.86, 0.02), at(1, 0.08), at(1, 0.3));
  const c = new kit.Canvas();
  c.poly(0, [[5, 25], [9, 15], [14, 9], [19, 9], [24, 15], [27, 25], [16, 28]], (x, y) => (x + y < 27 ? 0.5 : x + y > 40 ? -0.35 : 0));
  c.disc(0, 13, 13, 2.2, 1.6, () => 1);
  c.disc(0, 20, 22, 1.4, 1.2, () => -0.6);
  return c.render([ramp], [Math.round(r * 0.25), Math.round(g * 0.25), Math.round(b * 0.25)]);
}
export const icons = {};
// (The icons' colours: vanilla's dye colours, black a little lifted to read.)
const DYE_ICON_RGB = [0xf0f0f0, 0xf9801d, 0xc74ebd, 0x3ab3da, 0xfed83d, 0x80c71f, 0xf38baa, 0x6a7276, 0xb4b4ae, 0x169c9c, 0x8932b8, 0x3c44aa, 0x835432, 0x5e7c16, 0xb02e26, 0x34343a];
COLORS.forEach((c, i) => {
  icons[`dye_${c}`] = (kit) => dyeIcon(kit, DYE_ICON_RGB[i]);
});
icons.ink_sac = (kit) => {
  const c = new kit.Canvas();
  c.disc(0, 15, 18, 9, 8, (x, y) => (x + y < 30 ? 0.4 : -0.3));
  c.poly(0, [[11, 11], [15, 4], [19, 11]], () => 0.1);
  c.disc(1, 12, 15, 2, 1.6, () => 0.6);
  return c.render([kit.ramp(0x101018, 0x1c1c2a, 0x2c2c40, 0x41415c, 0x5a5a7c), kit.ramp(0x4a4a6a, 0x6c6c90, 0x8e8eb4, 0xb0b0d4, 0xd8d8f0)], [6, 6, 10]);
};
