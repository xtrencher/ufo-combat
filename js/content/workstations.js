// Workstations (Round 12): the Minecraft staples the game lacked, vanilla
// Java 1.20's. Ids: blocks 2816-2879 (./ids.js). What a content module may
// export, and its rules: see ./index.js.
// - Double chests: two chests side by side, facing the same way, join (the
//   second one placed against the first, not while sneaking: js/chests.js
//   placeChest) into one model of two halves (8 ids: facing x which half);
//   each half keeps its own 27 slots, one screen shows the 54 (the left
//   half's on top, as vanilla). A half broken leaves a single chest.
// - The smoker and the blast furnace: the furnace's screen and rules, twice
//   as fast, food only / ores, raw metals and iron or gold gear only
//   (js/furnace.js).
// - The campfire and the soul campfire (light 15 / 10): up to four foods
//   laid on it cook in 30 s and pop off (js/furnace.js Campfires, the
//   host's online); smoke rises from it (a signal fire's far higher over a
//   hay bale); it burns whoever stands on it (not while sneaking: the
//   magma block's rule); a shovel or a water bucket puts it out, flint and
//   steel or a fire charge lights it again. Broken: 2 charcoal (the soul
//   one: soul soil), itself with silk touch.
// - The composter (9 ids: level 0-7, 8 ready): plant matter raises it by
//   vanilla's chances; full, it is ready a second later; a click then gives
//   bone meal.
// - The grindstone (a screen: disenchants, with the experience back, and
//   repairs two of a kind) and the stonecutter (a screen: one stone block
//   into its slabs, stairs, walls, bricks...): js/inventory-ui.js.
// - The lectern, the fletching table, the cartography table and the loom:
//   villages' job blocks (js/village.js), placeable with their looks (no
//   books, maps or banners in the game: nothing more to do with them yet).
// - The bell: rung by a right click (heard by everyone near, online too:
//   js/chests.js ringBell).
// - The shulker box: a chest that keeps what it holds when broken (the box
//   drops with its contents in it, tag.items: js/chests.js); a shulker box
//   doesn't go into another.
// (The barrel is ./containers.js's.)
import { BLOCK, ITEM, FACE, RENDER, LIB } from "./base.js";
import * as I from "./ids.js";
import {
  CHEST_DOUBLE,
  SMOKER,
  BLAST_FURNACE,
  CAMPFIRE,
  SOUL_CAMPFIRE,
  COMPOSTER,
  GRINDSTONE,
  STONECUTTER,
  LECTERN,
  FLETCHING_TABLE,
  CARTOGRAPHY_TABLE,
  LOOM,
  BELL,
  SHULKER_BOX,
} from "./ids.js";

const S16 = 1 / 16;
const px = (b) => b.map((v) => v * S16);

// Facing k: [dx, dz] of the front, and the face it is on (the furnace's).
const FACINGS = [
  [0, 1, FACE.PZ],
  [0, -1, FACE.NZ],
  [1, 0, FACE.PX],
  [-1, 0, FACE.NX],
];
// The facing toward a viewer looking along `forward` (the front looks back at them).
function facingToward(forward) {
  const dx = -(forward?.[0] ?? 0);
  const dz = -(forward?.[2] ?? 1);
  if (Math.abs(dx) > Math.abs(dz)) return dx > 0 ? 2 : 3;
  return dz >= 0 ? 0 : 1;
}
// The axis a viewer looks along: 0 x, 1 z.
const axisToward = (forward) => (Math.abs(forward?.[0] ?? 0) > Math.abs(forward?.[2] ?? 1) ? 0 : 1);
// A box given along z (vanilla's north-facing model) turned to lie along x.
const swapXZ = ([x0, y0, z0, x1, y1, z1]) => [z0, y0, x0, z1, y1, x1];

// ---------- What the engine asks about these blocks ----------

export const SHULKER_PLACED = SHULKER_BOX + 1;
export const isDoubleChest = (id) => id >= CHEST_DOUBLE && id < CHEST_DOUBLE + 8;
// A double chest half's facing (0-3) and whether it is the right half.
export const chestHalf = (id) => ({ k: (id - CHEST_DOUBLE) & 3, right: id - CHEST_DOUBLE >= 4 });
export const doubleChestId = (k, right) => CHEST_DOUBLE + k + (right ? 4 : 0);
// The cell of a half's other half: its left half's is on its right (seen
// from the front), and the other way round. The viewer's right of a front
// looking along [dx, dz] is [dz, -dx].
export function chestPartner(id, x, z) {
  const { k, right } = chestHalf(id);
  const [dx, dz] = FACINGS[k];
  const s = right ? -1 : 1;
  return [x + dz * s, z - dx * s];
}
export const isCampfire = (id) => id >= CAMPFIRE && id < SOUL_CAMPFIRE + 4;
export const isSoulCampfire = (id) => id >= SOUL_CAMPFIRE && id < SOUL_CAMPFIRE + 4;
export const campfireLit = (id) => isCampfire(id) && ((id - CAMPFIRE) & 2) === 0;
export function campfireAs(id, lit) {
  if (!isCampfire(id)) return id;
  const base = isSoulCampfire(id) ? SOUL_CAMPFIRE : CAMPFIRE;
  return base + ((id - base) & 1) + (lit ? 0 : 2);
}
export const campfireAxis = (id) => (id - CAMPFIRE) & 1;
export const isComposter = (id) => id >= COMPOSTER && id < COMPOSTER + 9;
export const isShulkerBox = (id) => id === SHULKER_BOX || id === SHULKER_PLACED;
export const isBell = (id) => id === BELL || id === BELL + 1;

// (Round 12) Vanilla's composting chances (ComposterBlock), for what the game has.
let COMPOST = null;
export function compostChance(id) {
  if (!COMPOST) {
    COMPOST = new Map();
    const add = (p, ids) => ids.forEach((i) => i != null && COMPOST.set(i, p));
    const leaves = [BLOCK.LEAVES, BLOCK.BIRCH_LEAVES, BLOCK.PINE_LEAVES, I.JUNGLE_LEAVES, I.ACACIA_LEAVES, I.DARK_OAK_LEAVES];
    const saplings = [I.OAK_SAPLING, I.SPRUCE_SAPLING, I.BIRCH_SAPLING, I.JUNGLE_SAPLING, I.ACACIA_SAPLING, I.DARK_OAK_SAPLING];
    add(0.3, [I.WHEAT_SEEDS, I.BEETROOT_SEEDS, I.MELON_SEEDS, I.PUMPKIN_SEEDS, ...leaves, ...saplings, BLOCK.TALL_GRASS, BLOCK.KELP, BLOCK.SEAGRASS]);
    add(0.5, [BLOCK.CACTUS, I.MELON_SLICE, I.SUGAR_CANE, I.VINE, I.NETHER_SPROUTS, I.WEEPING_VINES, I.TWISTING_VINES]);
    const flowers = [BLOCK.FLOWER_RED, BLOCK.FLOWER_YELLOW, I.BLUE_ORCHID, I.ALLIUM, I.AZURE_BLUET, I.RED_TULIP, I.ORANGE_TULIP, I.WHITE_TULIP, I.PINK_TULIP, I.OXEYE_DAISY, I.CORNFLOWER, I.LILY_OF_THE_VALLEY];
    add(0.65, [ITEM.APPLE, I.BEETROOT, I.CARROT, I.COCOA_BEANS, I.FERN, ...flowers, I.CRIMSON_FUNGUS, I.WARPED_FUNGUS, I.LILY_PAD, I.MELON, I.BROWN_MUSHROOM, I.RED_MUSHROOM, I.POTATO, I.PUMPKIN, I.CARVED_PUMPKIN, I.WHEAT, I.CRIMSON_ROOTS, I.WARPED_ROOTS, I.NETHER_WART]);
    add(0.85, [I.BAKED_POTATO, I.BREAD, I.COOKIE, I.HAY_BLOCK, I.NETHER_WART_BLOCK, I.WARPED_WART_BLOCK]);
    add(1, [I.CAKE, I.PUMPKIN_PIE]);
  }
  return COMPOST.get(id) || 0;
}

// (Round 12) The stonecutter's recipes, vanilla's for the blocks the game
// has: [input, output, count] (a slab: 2). Read by js/inventory-ui.js,
// which leaves out what isn't built.
let CUTS = null;
export function stonecutting() {
  if (CUTS) return CUTS;
  CUTS = [];
  const fam = (input, { slab, stairs, wall, more = [] }) => {
    if (slab) CUTS.push([input, slab, 2]);
    if (stairs) CUTS.push([input, stairs, 1]);
    if (wall) CUTS.push([input, wall, 1]);
    for (const [out, n] of more) CUTS.push([input, out, n ?? 1]);
  };
  const stoneBricks = { slab: I.STONE_BRICK_SLAB, stairs: I.STONE_BRICK_STAIRS, wall: I.STONE_BRICK_WALL };
  fam(BLOCK.STONE, { slab: I.STONE_SLAB, stairs: I.STONE_STAIRS, more: [[I.STONE_BRICKS], [I.STONE_BRICK_SLAB, 2], [I.STONE_BRICK_STAIRS], [I.STONE_BRICK_WALL], [I.CHISELED_STONE_BRICKS]] });
  fam(I.STONE_BRICKS, { ...stoneBricks, more: [[I.CHISELED_STONE_BRICKS]] });
  fam(BLOCK.COBBLESTONE, { slab: I.COBBLESTONE_SLAB, stairs: I.COBBLESTONE_STAIRS, wall: I.COBBLESTONE_WALL });
  fam(I.MOSSY_COBBLESTONE, { slab: I.MOSSY_COBBLESTONE_SLAB, stairs: I.MOSSY_COBBLESTONE_STAIRS, wall: I.MOSSY_COBBLESTONE_WALL });
  fam(I.SMOOTH_STONE, { slab: I.SMOOTH_STONE_SLAB });
  fam(I.SANDSTONE, { slab: I.SANDSTONE_SLAB, stairs: I.SANDSTONE_STAIRS, wall: I.SANDSTONE_WALL, more: [[I.CUT_SANDSTONE], [I.CHISELED_SANDSTONE]] });
  fam(BLOCK.BRICKS, { slab: I.BRICK_SLAB, stairs: I.BRICK_STAIRS, wall: I.BRICK_WALL });
  fam(I.GRANITE, { more: [[I.POLISHED_GRANITE]] });
  fam(I.DIORITE, { more: [[I.POLISHED_DIORITE]] });
  fam(I.ANDESITE, { more: [[I.POLISHED_ANDESITE]] });
  const pb = { slab: I.POLISHED_BLACKSTONE_SLAB, stairs: I.POLISHED_BLACKSTONE_STAIRS, wall: I.POLISHED_BLACKSTONE_WALL };
  const pbb = [[I.POLISHED_BLACKSTONE_BRICKS], [I.CHISELED_POLISHED_BLACKSTONE], [I.POLISHED_BLACKSTONE_BRICK_SLAB, 2], [I.POLISHED_BLACKSTONE_BRICK_STAIRS], [I.POLISHED_BLACKSTONE_BRICK_WALL]];
  fam(I.BLACKSTONE, { slab: I.BLACKSTONE_SLAB, stairs: I.BLACKSTONE_STAIRS, wall: I.BLACKSTONE_WALL, more: [[I.POLISHED_BLACKSTONE], [I.POLISHED_BLACKSTONE_SLAB, 2], [I.POLISHED_BLACKSTONE_STAIRS], [I.POLISHED_BLACKSTONE_WALL], ...pbb] });
  fam(I.POLISHED_BLACKSTONE, { ...pb, more: pbb });
  fam(I.POLISHED_BLACKSTONE_BRICKS, { slab: I.POLISHED_BLACKSTONE_BRICK_SLAB, stairs: I.POLISHED_BLACKSTONE_BRICK_STAIRS, wall: I.POLISHED_BLACKSTONE_BRICK_WALL });
  fam(I.NETHER_BRICKS, { slab: I.NETHER_BRICK_SLAB, stairs: I.NETHER_BRICK_STAIRS, wall: I.NETHER_BRICK_WALL, more: [[I.CHISELED_NETHER_BRICKS]] });
  fam(I.RED_NETHER_BRICKS, { slab: I.RED_NETHER_BRICK_SLAB, stairs: I.RED_NETHER_BRICK_STAIRS, wall: I.RED_NETHER_BRICK_WALL });
  fam(I.QUARTZ_BLOCK, { slab: I.QUARTZ_SLAB, stairs: I.QUARTZ_STAIRS, more: [[I.QUARTZ_PILLAR], [I.CHISELED_QUARTZ_BLOCK], [I.QUARTZ_BRICKS]] });
  fam(I.BASALT, { more: [[I.POLISHED_BASALT]] });
  const esb = { slab: I.END_STONE_BRICK_SLAB, stairs: I.END_STONE_BRICK_STAIRS, wall: I.END_STONE_BRICK_WALL };
  fam(I.END_STONE, { more: [[I.END_STONE_BRICKS], [esb.slab, 2], [esb.stairs], [esb.wall]] });
  fam(I.END_STONE_BRICKS, esb);
  fam(I.PURPUR_BLOCK, { slab: I.PURPUR_SLAB, stairs: I.PURPUR_STAIRS, more: [[I.PURPUR_PILLAR]] });
  CUTS = CUTS.filter(([a, b]) => a != null && b != null);
  return CUTS;
}

// ---------- Blocks ----------

export const blocks = {};
const WOOD = { hardness: 2.5, tool: "axe", sound: "wood" };
const PICK = { tool: "pickaxe", minTier: 1, sound: "stone" };

// The double chest's halves (as the chest: js/blocks.js's, which they count as).
const CHEST_FACES = { top: "chest_top", bottom: "chest_top", side: "chest_side", front: "chest_front" };
for (let right = 0; right < 2; right++) {
  FACINGS.forEach(([dx, dz, face], k) => {
    // (the half's box: out to the cell's edge on its other half's side)
    const s = right ? -1 : 1;
    const [rx, rz] = [dz * s, -dx * s];
    const box = [rx < 0 ? 0 : S16, 0, rz < 0 ? 0 : S16, rx > 0 ? 1 : 15 * S16, 14 * S16, rz > 0 ? 1 : 15 * S16];
    blocks[doubleChestId(k, right)] = {
      name: "Chest",
      faces: CHEST_FACES,
      frontFace: face,
      shape: "chest_double",
      opaque: false,
      facing: [dx, dz],
      box,
      item: BLOCK.CHEST,
      chest: true, // (js/blocks.js IS_CHEST; js/chests.js keeps its slots)
      creative: false,
      ...WOOD,
    };
  });
}

// The smoker and the blast furnace: the furnace's 8 ids each (facing x lit).
const OVENS = [
  [SMOKER, "Smoker", { top: "smoker_top", bottom: "furnace_top", side: "smoker_side" }, "smoker_front"],
  [BLAST_FURNACE, "Blast Furnace", { top: "blast_furnace_top", bottom: "blast_furnace_top", side: "blast_furnace_side" }, "blast_furnace_front"],
];
for (const [base, name, faces, front] of OVENS) {
  for (let lit = 0; lit < 2; lit++) {
    FACINGS.forEach(([dx, dz, face], k) => {
      const id = base + k + 4 * lit;
      blocks[id] = {
        name,
        faces: { ...faces, front: lit ? `${front}_lit` : front },
        frontFace: face,
        facing: [dx, dz],
        emission: lit ? 13 : 0,
        hardness: 3.5,
        ...PICK,
        item: id === base ? null : base,
        placeAs: (ctx) => base + facingToward(ctx.forward),
      };
    });
  }
}

// The campfire: four logs (two over two, crossed), an ember bed and the
// fire. (Vanilla's model: the lower logs along its facing.)
const CAMP_LOGS_Z = [[1, 0, 0, 5, 4, 16], [11, 0, 0, 15, 4, 16], [0, 3, 1, 16, 7, 5], [0, 3, 11, 16, 7, 15]].map(px);
const CAMP_BED_Z = px([5, 0, 0, 11, 1, 16]);
const CAMP_LOGS = [CAMP_LOGS_Z.map(swapXZ), CAMP_LOGS_Z];
const CAMP_BED = [swapXZ(CAMP_BED_Z), CAMP_BED_Z];
const CAMP_BOX = [0, 0, 0, 1, 7 * S16, 1];
for (const [base, name, litSide, fire, light] of [
  [CAMPFIRE, "Campfire", "campfire_log_lit", "fire", 15],
  [SOUL_CAMPFIRE, "Soul Campfire", "soul_campfire_log_lit", "soul_fire", 10],
]) {
  for (let v = 0; v < 4; v++) {
    const id = base + v;
    const lit = (v & 2) === 0;
    blocks[id] = {
      name,
      // (the fire's tile rides on the bottom face, which the mesh never draws as such)
      faces: { top: "campfire_log", bottom: "campfire_log", side: lit ? litSide : "campfire_log", front: lit ? fire : "campfire_log" },
      frontFace: FACE.NY,
      shape: "campfire",
      render: RENDER.CUTOUT,
      opaque: false,
      box: CAMP_BOX,
      collision: [CAMP_BOX],
      emission: lit ? light : 0,
      hotFloor: lit, // (js/player.js: it burns whoever stands on it, as the magma block)
      hardness: 2,
      tool: "axe",
      sound: "wood",
      ...(id === base ? { placeAs: (ctx) => base + axisToward(ctx.forward), itemBoxes: [...CAMP_LOGS[0], CAMP_BED[0]] } : { item: base }),
    };
  }
}

// The composter: plank walls round a floor, the compost rising inside.
const COMPOST_WALLS = [[0, 0, 0, 16, 16, 2], [0, 0, 14, 16, 16, 16], [0, 0, 2, 2, 16, 14], [14, 0, 2, 16, 16, 14], [2, 0, 2, 14, 2, 14]].map(px);
const COMPOST_TOP = [2, 3, 5, 7, 9, 11, 13, 15, 15]; // (sixteenths: the compost's top at each level; 2, the floor: none)
for (let lvl = 0; lvl < 9; lvl++) {
  blocks[COMPOSTER + lvl] = {
    name: "Composter",
    faces: { top: "composter_top", bottom: "spruce_planks", side: "composter_side", front: lvl === 8 ? "compost_ready" : "compost" },
    frontFace: FACE.NY,
    shape: "composter",
    opaque: false,
    box: [0, 0, 0, 1, 1, 1],
    collision: [[0, 0, 0, 1, 2 * S16, 1], ...COMPOST_WALLS.slice(0, 4)],
    hardness: 0.6,
    tool: "axe",
    sound: "wood",
    ...(lvl ? { item: COMPOSTER } : { itemBoxes: COMPOST_WALLS }),
  };
}

// The grindstone (on the floor): a stone wheel between two pivots on legs.
// (Vanilla's model, the axle along x.)
const GRIND_X = [[4, 4, 2, 12, 16, 14], [2, 7, 5, 4, 13, 11], [12, 7, 5, 14, 13, 11], [2, 0, 6, 4, 7, 10], [12, 0, 6, 14, 7, 10]].map(px);
const GRIND = [GRIND_X, GRIND_X.map(swapXZ)];
for (let a = 0; a < 2; a++) {
  const sel = [2 * S16, 0, 2 * S16, 14 * S16, 1, 14 * S16];
  blocks[GRINDSTONE + a] = {
    name: "Grindstone",
    faces: { top: "grindstone_round", bottom: "grindstone_pivot", side: "grindstone_side" },
    shape: "grindstone",
    opaque: false,
    box: sel,
    collision: [sel],
    hardness: 2,
    ...PICK,
    ...(a ? { item: GRINDSTONE } : { placeAs: (ctx) => GRINDSTONE + (axisToward(ctx.forward) ? 0 : 1), itemBoxes: GRIND_X }),
  };
}

// The stonecutter: a stone slab-high block with the saw standing in it.
const CUTTER_BOX = [0, 0, 0, 1, 9 * S16, 1];
for (let a = 0; a < 2; a++) {
  blocks[STONECUTTER + a] = {
    name: "Stonecutter",
    faces: { top: "stonecutter_top", bottom: "smooth_stone", side: "stonecutter_side", front: "stonecutter_saw" },
    frontFace: FACE.NY,
    shape: "stonecutter",
    render: RENDER.CUTOUT,
    opaque: false,
    box: CUTTER_BOX,
    collision: [CUTTER_BOX],
    hardness: 3.5,
    ...PICK,
    ...(a ? { item: STONECUTTER } : { placeAs: (ctx) => STONECUTTER + (axisToward(ctx.forward) ? 0 : 1), itemBoxes: [CUTTER_BOX] }),
  };
}

// The lectern: a base, a post and the sloping board (22.5 degrees, as vanilla's).
const LECTERN_BASE = [0, 0, 0, 1, 2 * S16, 1];
const LECTERN_POST = px([4, 2, 4, 12, 13, 12]);
FACINGS.forEach(([dx, dz, face], k) => {
  blocks[LECTERN + k] = {
    name: "Lectern",
    faces: { top: "lectern_top", bottom: "planks", side: "lectern_sides", front: "lectern_front" },
    frontFace: face,
    facing: [dx, dz],
    shape: "lectern",
    opaque: false,
    box: [0, 0, 0, 1, 1, 1],
    collision: [LECTERN_BASE, [4 * S16, 0, 4 * S16, 12 * S16, 14 * S16, 12 * S16]],
    ...WOOD,
    ...(k ? { item: LECTERN } : { placeAs: (ctx) => LECTERN + facingToward(ctx.forward), itemBoxes: [LECTERN_BASE, LECTERN_POST, [0, 12 * S16, S16, 1, 15 * S16, 15 * S16]] }),
  };
});

blocks[FLETCHING_TABLE] = { name: "Fletching Table", faces: { top: "fletching_table_top", bottom: "birch_planks", side: "fletching_table_side", front: "fletching_table_front" }, ...WOOD };
blocks[CARTOGRAPHY_TABLE] = { name: "Cartography Table", faces: { top: "cartography_table_top", bottom: "dark_oak_planks", side: "cartography_table_side" }, ...WOOD };
FACINGS.forEach(([dx, dz, face], k) => {
  blocks[LOOM + k] = {
    name: "Loom",
    faces: { top: "loom_top", bottom: "planks", side: "loom_side", front: "loom_front" },
    frontFace: face,
    facing: [dx, dz],
    ...WOOD,
    ...(k ? { item: LOOM } : { placeAs: (ctx) => LOOM + facingToward(ctx.forward) }),
  };
});

// The bell (standing on the floor): two stone posts, a bar across, the bell under it.
const BELL_X = [[0, 0, 6, 2, 16, 10], [14, 0, 6, 16, 16, 10], [2, 13, 7, 14, 15, 9], [5, 6, 5, 11, 13, 11], [4, 4, 4, 12, 6, 12], [7, 13, 7, 9, 13.5, 9]].map(px);
const BELL_PARTS = [BELL_X, BELL_X.map(swapXZ)];
for (let a = 0; a < 2; a++) {
  const sel = a ? [6 * S16, 0, 0, 10 * S16, 1, 1] : [0, 0, 6 * S16, 1, 1, 10 * S16];
  blocks[BELL + a] = {
    name: "Bell",
    faces: "bell_body",
    shape: "bell",
    opaque: false,
    box: [0, 0, 0, 1, 1, 1],
    collision: [sel, [4 * S16, 4 * S16, 4 * S16, 12 * S16, 13 * S16, 12 * S16]],
    hardness: 5,
    tool: "pickaxe",
    sound: "stone",
    ...(a ? { item: BELL } : { placeAs: (ctx) => BELL + (axisToward(ctx.forward) ? 0 : 1), itemBoxes: BELL_X.slice(3, 5) }),
  };
}

// The shulker box: the item (placed: the box, which drops nothing itself:
// js/chests.js gives it back with what it holds).
for (const id of [SHULKER_BOX, SHULKER_PLACED]) {
  blocks[id] = {
    name: "Shulker Box",
    faces: { top: "shulker_box_top", bottom: "shulker_box_top", side: "shulker_box_side" },
    hardness: 2,
    tool: "pickaxe",
    sound: "stone",
    chest: true,
    stack: 1,
    ...(id === SHULKER_BOX ? { placeAs: placeShulker } : { item: SHULKER_BOX }),
  };
}
// (A box placed from an item that holds things: they go into it, js/chests.js.)
function placeShulker(ctx) {
  ctx.interaction?.chests?.fillPlaced?.(ctx.place, ctx.stack);
  return SHULKER_PLACED;
}

// ---------- Shapes ----------

// The faces' uv in the cell, as the mesher's (+X, -X, +Y, -Y, +Z, -Z).
const FACE_UV = [(c) => [1 - c[2], c[1]], (c) => [c[2], c[1]], (c) => [c[0], 1 - c[2]], (c) => [c[0], c[2]], (c) => [c[0], c[1]], (c) => [1 - c[0], c[1]]];
const FACE_DIR = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];
// A double chest half's faces: [skip mask, uv rect] each, the face toward
// its other half left out. The chest's tiles are painted for one chest's
// box; along the pair the uv is stretched so the two halves show one chest
// twice as long: the tile's rim at the far ends, its middle (the latch) at
// the seam.
const DOUBLE_FACES = [];
for (let v = 0; v < 8; v++) {
  const { k, right } = chestHalf(CHEST_DOUBLE + v);
  const [dx, dz] = FACINGS[k];
  const s = right ? -1 : 1;
  const r = [dz * s, 0, -dx * s]; // (toward the other half)
  const axis = r[0] ? 0 : 2;
  const seam = r[axis] > 0 ? 1 : 0;
  const outer = r[axis] > 0 ? S16 : 15 * S16;
  const list = [];
  for (let f = 0; f < 6; f++) {
    const d = FACE_DIR[f];
    if (d[axis] === r[axis]) continue; // (the seam: against the other half)
    const cs = [0.5, 0.5, 0.5];
    const co = [0.5, 0.5, 0.5];
    cs[axis] = seam;
    co[axis] = outer;
    const us = FACE_UV[f](cs);
    const uo = FACE_UV[f](co);
    let rect = null;
    for (let j = 0; j < 2; j++) {
      if (Math.abs(us[j] - uo[j]) < 1e-6) continue;
      const B = (uo[j] - 0.5) / (uo[j] - us[j]);
      const A = uo[j] - B * uo[j];
      rect = j === 0 ? [A, 0, A + B, 1] : [0, A, 1, A + B];
    }
    list.push([63 & ~(1 << f), rect]);
  }
  DOUBLE_FACES.push(list);
}

// Per-id tile lists (the same in the mesh workers), made on first use.
const TILES6 = {};
const tiles6 = (key, make) => (TILES6[key] ||= make());
const all6 = (t) => [t, t, t, t, t, t];
const otherTile = (id, face) => LIB.FACE_TILES?.[id * 6 + face] ?? 0;

// One quad's corners turned for facing k (the model built facing +Z).
function turn(k, p) {
  const [x, y, z] = p;
  if (k === 0) return [x, y, z];
  if (k === 1) return [1 - x, y, 1 - z];
  if (k === 2) return [z, y, 1 - x];
  return [1 - z, y, x];
}
const FACE_TURN = [
  [FACE.PX, FACE.NX, FACE.PZ, FACE.NZ],
  [FACE.NX, FACE.PX, FACE.NZ, FACE.PZ],
  [FACE.NZ, FACE.PZ, FACE.PX, FACE.NX],
  [FACE.PZ, FACE.NZ, FACE.NX, FACE.PX],
];
// (the face a +X/-X/+Z/-Z face of the +Z model becomes at facing k)
const turnFace = (k, f) => (f === FACE.PX ? FACE_TURN[k][0] : f === FACE.NX ? FACE_TURN[k][1] : f === FACE.PZ ? FACE_TURN[k][2] : f === FACE.NZ ? FACE_TURN[k][3] : f);

const UV4 = [[0, 0], [1, 0], [1, 1], [0, 1]];
// The lectern's board, in the +Z model: from the front edge (z 15/16, top
// 10/16) up to the back (z 1/16, top 1); 4/16 thick.
const TAN = Math.tan(Math.PI / 8);
const BOARD_FRONT = 15 * S16;
const BOARD_BACK = S16;
const BOARD_HI = 1;
const BOARD_LO = BOARD_HI - (BOARD_FRONT - BOARD_BACK) * TAN;
const BOARD_T = 4 * S16;

export const shapes = {
  chest_double: {
    mesh: (m) => {
      const b = blocks[m.id]?.box;
      if (!b) return;
      for (const [skip, rect] of DOUBLE_FACES[m.id - CHEST_DOUBLE]) m.box(b[0], b[1], b[2], b[3], b[4], b[5], null, skip, rect);
    },
  },
  campfire: {
    mesh: (m) => {
      const a = campfireAxis(m.id);
      const side = m.tile(FACE.PX);
      const top = m.tile(FACE.PY);
      const logs = tiles6(`log${m.id}`, () => [side, side, top, top, side, side]);
      for (const b of CAMP_LOGS[a]) m.box(b[0], b[1], b[2], b[3], b[4], b[5], logs);
      const bed = CAMP_BED[a];
      m.box(bed[0], bed[1], bed[2], bed[3], bed[4], bed[5], tiles6(`bed${m.id}`, () => all6(side)));
      if (!campfireLit(m.id)) return;
      // The fire: two crossed planes, as vanilla's, a block high over the bed.
      const fire = m.tile(FACE.NY);
      const lo = S16;
      const hi = 1;
      const e = 0.12;
      m.quad([[e, lo, e], [1 - e, lo, 1 - e], [1 - e, hi, 1 - e], [e, hi, e]], UV4, FACE.PZ, fire);
      m.quad([[1 - e, lo, e], [e, lo, 1 - e], [e, hi, 1 - e], [1 - e, hi, e]], UV4, FACE.PX, fire);
    },
  },
  composter: {
    mesh: (m) => {
      const side = m.tile(FACE.PX);
      const walls = tiles6(`cw${m.id}`, () => [side, side, m.tile(FACE.PY), side, side, side]);
      for (const b of COMPOST_WALLS) m.box(b[0], b[1], b[2], b[3], b[4], b[5], walls);
      const lvl = m.id - COMPOSTER;
      if (lvl <= 0) return;
      const c = tiles6(`cc${m.id}`, () => all6(m.tile(FACE.NY)));
      m.box(2 * S16, 2 * S16, 2 * S16, 14 * S16, COMPOST_TOP[lvl] * S16, 14 * S16, c);
    },
  },
  grindstone: {
    mesh: (m) => {
      const a = m.id - GRINDSTONE;
      const face = m.tile(FACE.PX);
      const round = m.tile(FACE.PY);
      const pivot = m.tile(FACE.NY);
      const wheel = tiles6(`gw${m.id}`, () => (a ? [round, round, round, round, face, face] : [face, face, round, round, round, round]));
      const piv = tiles6(`gp${m.id}`, () => all6(pivot));
      const leg = tiles6(`gl${m.id}`, () => {
        const s = otherTile(I.DARK_OAK_LOG, FACE.PX);
        return [s, s, otherTile(I.DARK_OAK_LOG, FACE.PY), s, s, s];
      });
      GRIND[a].forEach((b, i) => m.box(b[0], b[1], b[2], b[3], b[4], b[5], i === 0 ? wheel : i < 3 ? piv : leg));
    },
  },
  stonecutter: {
    mesh: (m) => {
      const side = m.tile(FACE.PX);
      const base = tiles6(`sc${m.id}`, () => [side, side, m.tile(FACE.PY), otherTile(I.SMOOTH_STONE, FACE.NY), side, side]);
      m.box(0, 0, 0, 1, 9 * S16, 1, base);
      // The saw: a plane across the middle (the tile's top half: the blade).
      const saw = m.tile(FACE.NY);
      const y0 = 9 * S16;
      const uv = [[S16, y0], [15 * S16, y0], [15 * S16, 1], [S16, 1]];
      if (m.id - STONECUTTER === 0) m.quad([[S16, y0, 0.5], [15 * S16, y0, 0.5], [15 * S16, 1, 0.5], [S16, 1, 0.5]], uv, FACE.PZ, saw);
      else m.quad([[0.5, y0, 15 * S16], [0.5, y0, S16], [0.5, 1, S16], [0.5, 1, 15 * S16]], uv, FACE.PX, saw);
    },
  },
  lectern: {
    mesh: (m) => {
      const k = m.id - LECTERN;
      const side = m.tile(FACE.PX === FACINGS[k][2] ? FACE.NX : FACE.PX);
      const top = m.tile(FACE.PY);
      const planks = m.tile(FACE.NY);
      m.box(0, 0, 0, 1, 2 * S16, 1, tiles6(`lb${m.id}`, () => [side, side, planks, planks, side, side]));
      const p = LECTERN_POST;
      m.box(p[0], p[1], p[2], p[3], p[4], p[5]);
      // The board: its top, underside, two ends and two sides, turned to the facing.
      const q = (pts, uvs, f, tile) => m.quad(pts.map((c) => turn(k, c)), uvs, turnFace(k, f), tile);
      const zf = BOARD_FRONT;
      const zb = BOARD_BACK;
      const tf = BOARD_LO;
      const tb = BOARD_HI;
      q([[0, tf, zf], [1, tf, zf], [1, tb, zb], [0, tb, zb]], UV4, FACE.PY, top);
      q([[0, tb - BOARD_T, zb], [1, tb - BOARD_T, zb], [1, tf - BOARD_T, zf], [0, tf - BOARD_T, zf]], UV4, FACE.NY, planks);
      const sideUv = (t) => [[0, 0.5], [1, 0.5], [1, 0.5 + t], [0, 0.5 + t]];
      q([[0, tf - BOARD_T, zf], [1, tf - BOARD_T, zf], [1, tf, zf], [0, tf, zf]], sideUv(0.25), FACE.PZ, side);
      q([[1, tb - BOARD_T, zb], [0, tb - BOARD_T, zb], [0, tb, zb], [1, tb, zb]], sideUv(0.25), FACE.NZ, side);
      const su = [[zf, tf - BOARD_T], [zb, tb - BOARD_T], [zb, tb], [zf, tf]];
      q([[1, tf - BOARD_T, zf], [1, tb - BOARD_T, zb], [1, tb, zb], [1, tf, zf]], su, FACE.PX, side);
      q([[0, tb - BOARD_T, zb], [0, tf - BOARD_T, zf], [0, tf, zf], [0, tb, zb]], [su[1], su[0], su[3], su[2]], FACE.NX, side);
    },
  },
  bell: {
    mesh: (m) => {
      const a = m.id - BELL;
      const stone = tiles6("bs", () => {
        const s = otherTile(BLOCK.STONE, FACE.PX);
        return all6(s);
      });
      const wood = tiles6("bw", () => all6(otherTile(I.DARK_OAK_PLANKS, FACE.PX)));
      BELL_PARTS[a].forEach((b, i) => m.box(b[0], b[1], b[2], b[3], b[4], b[5], i < 2 ? stone : i === 2 || i === 5 ? wood : null));
    },
  },
};

// ---------- Textures (38 tiles: 3 of them the barrel's, ./containers.js) ----------

const lum = (c) => (0.299 * c[0] + 0.587 * c[1] + 0.114 * c[2]) / 255;
// Wood boards: `n` boards across (horizontal: rows), grain along them.
function boards(t, kit, colors, n = 4, vertical = false) {
  const ramp = colors.map(kit.hex);
  const w = 32 / n;
  t.forEach((x, y) => {
    const a = vertical ? x : y;
    const b = vertical ? y : x;
    const k = Math.floor(a / w);
    const edge = a % w === 0;
    const grain = t.noise(vertical ? x * 4 : x, vertical ? y : y * 4, 8, k + 3) * 0.5 + t.rand() * 0.2;
    let f = 0.45 + (grain - 0.35) * 0.7 + ((k * 37) % 5) * 0.03;
    if (edge) f = 0.05;
    else if (a % w === w - 1) f -= 0.12;
    if ((b + k * 11) % 23 === 0 && !edge) f -= 0.2; // (a board's end)
    t.set(x, y, kit.ramp(ramp, f));
  });
}
// A frame of `w` pixels round the tile.
function frame(t, kit, colors, w = 2) {
  const ramp = colors.map(kit.hex);
  t.forEach((x, y) => {
    const d = Math.min(x, y, 31 - x, 31 - y);
    if (d >= w) return;
    const f = (d === 0 ? 0.2 : 0.75) + (t.rand() - 0.5) * 0.15 - (x === 31 || y === 31 ? 0.15 : 0);
    t.set(x, y, kit.ramp(ramp, f));
  });
}
function stoneish(t, kit, colors, x, y, period = 8) {
  const f = t.fbm(x, y, period, 3, 5) * 0.75 + t.rand() * 0.25;
  return kit.ramp(colors.map(kit.hex), f);
}
const IRON = [0x2c2e33, 0x3e4148, 0x575b63, 0x737881, 0x969ba3, 0xbcc1c8];
const DARK_LOG = [0x1f150c, 0x2b1d10, 0x382614, 0x45301a, 0x523a20];
const SPRUCE = [0x3a2817, 0x4a3320, 0x573d26, 0x65472c, 0x725233, 0x7f5c3a];
const OAK = [0x6b5130, 0x7e6038, 0x907040, 0xa07c48, 0xb08a52, 0xbe985c];
const BIRCH = [0x9a8857, 0xae9c66, 0xbfad74, 0xccba80, 0xd7c58b, 0xe1d096];
const DARK_OAK = [0x2a1b0e, 0x342213, 0x3f2a18, 0x49321d, 0x543a22, 0x5e4228];
const STONE = [0x5c5c5c, 0x6c6c6c, 0x7a7a7a, 0x878787, 0x959595, 0xa4a4a4];
const SMOOTH = [0x7e7e7e, 0x8a8a8a, 0x969696, 0xa2a2a2, 0xaeaeae];

// A fire opening (x0..x1, y0..y1): dark, or flames over coals; a grate over it.
function opening(t, kit, x0, y0, x1, y1, lit, flameCols) {
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      if (y === y0 || x === x0 || x === x1) {
        t.set(x, y, [36, 34, 36]);
        continue;
      }
      if (!lit) {
        t.set(x, y, y > y1 - 2 ? [34, 30, 28] : [16, 15, 16]);
        continue;
      }
      const n = t.noise(x, y, 8, 3) * 0.6 + t.noise(x, y, 16, 4) * 0.4;
      const h = (y1 - y) / Math.max(1, y1 - y0) + (n - 0.5) * 0.7;
      t.set(x, y, kit.hex(flameCols[Math.max(0, Math.min(flameCols.length - 1, Math.floor(h * flameCols.length)))]));
    }
  }
}
const FLAMES = [0xfff0a0, 0xffd060, 0xff9a2a, 0xe8601a, 0x9a2c0e, 0x2a1410];

function smokerSide(t, kit) {
  // Dark spruce logs (vertical bark) over a smooth stone foot, an iron band.
  t.forEach((x, y) => {
    if (y >= 24) t.set(x, y, stoneish(t, kit, SMOOTH, x, y, 4));
    else {
      const bark = t.noise(x * 3, y, 8, 2) * 0.6 + t.rand() * 0.3;
      t.set(x, y, kit.ramp(DARK_LOG.map(kit.hex), bark + (x % 8 === 0 ? -0.4 : 0)));
    }
  });
  const iron = IRON.map(kit.hex);
  for (let x = 0; x < 32; x++) {
    t.set(x, 3, iron[4]);
    t.set(x, 4, iron[3]);
    t.set(x, 5, iron[1]);
    t.set(x, 23, iron[1]);
  }
  frame(t, kit, IRON, 1);
}
function blastSide(t, kit) {
  // Smooth stone with an iron plate and rivets.
  t.forEach((x, y) => t.set(x, y, stoneish(t, kit, SMOOTH, x, y, 4)));
  const iron = IRON.map(kit.hex);
  for (let y = 6; y < 26; y++) for (let x = 4; x < 28; x++) t.set(x, y, kit.scaleRgb(iron[2 + ((x + y) % 7 === 0 ? 1 : 0)], 0.9 + t.rand() * 0.15));
  for (const [x, y] of [[6, 8], [25, 8], [6, 23], [25, 23]]) t.set(x, y, iron[5]);
  frame(t, kit, [0x4a4a4a, 0x5e5e5e, 0x707070, 0x828282], 2);
}

export const tiles = {
  // The smoker: logs on stone, an iron grate on top, the fire's window.
  smoker_side: smokerSide,
  smoker_top: (t, kit) => {
    const iron = IRON.map(kit.hex);
    t.forEach((x, y) => t.set(x, y, kit.scaleRgb(iron[2], 0.85 + t.rand() * 0.2)));
    for (let y = 6; y < 26; y += 4) for (let x = 6; x < 26; x++) t.set(x, y, iron[0]);
    frame(t, kit, IRON, 3);
  },
  smoker_front: (t, kit) => {
    smokerSide(t, kit);
    opening(t, kit, 8, 10, 23, 22, false, FLAMES);
  },
  smoker_front_lit: (t, kit) => {
    smokerSide(t, kit);
    opening(t, kit, 8, 10, 23, 22, true, FLAMES);
  },
  // The blast furnace: smooth stone and iron; its window a grate of bars.
  blast_furnace_side: blastSide,
  blast_furnace_top: (t, kit) => {
    t.forEach((x, y) => t.set(x, y, stoneish(t, kit, SMOOTH, x, y, 4)));
    const iron = IRON.map(kit.hex);
    for (let y = 8; y < 24; y++) for (let x = 8; x < 24; x++) t.set(x, y, (x + y) % 4 < 2 ? iron[1] : iron[3]);
    frame(t, kit, [0x4a4a4a, 0x5e5e5e, 0x707070, 0x828282], 2);
  },
  blast_furnace_front: (t, kit) => {
    blastSide(t, kit);
    opening(t, kit, 8, 11, 23, 24, false, FLAMES);
    for (let y = 12; y < 24; y++) for (const x of [11, 15, 19]) t.set(x, y, kit.hex(IRON[3]));
  },
  blast_furnace_front_lit: (t, kit) => {
    blastSide(t, kit);
    opening(t, kit, 8, 11, 23, 24, true, [0xfff6c8, 0xffe08a, 0xffb84a, 0xff8a2a, 0xc04a14, 0x3a1810]);
    for (let y = 12; y < 24; y++) for (const x of [11, 15, 19]) t.set(x, y, kit.hex(IRON[2]));
  },
  // The campfire's logs: bark with its grain along x; lit, embers glowing in the cracks.
  campfire_log: (t, kit) => campLog(t, kit, null),
  campfire_log_lit: (t, kit) => campLog(t, kit, [0xff5a10, 0xff9a30, 0xffd060]),
  soul_campfire_log_lit: (t, kit) => campLog(t, kit, [0x10a0c8, 0x40d8f0, 0xa8f8ff]),
  // The composter: spruce boards with a dark frame; the compost, and ready (bone meal in it).
  composter_side: (t, kit) => {
    boards(t, kit, SPRUCE, 4, true);
    frame(t, kit, DARK_OAK, 2);
    for (let x = 2; x < 30; x++) t.set(x, 15, kit.hex(DARK_OAK[1]));
  },
  composter_top: (t, kit) => {
    boards(t, kit, SPRUCE, 4, false);
    frame(t, kit, DARK_OAK, 2);
  },
  compost: (t, kit) => compost(t, kit, false),
  compost_ready: (t, kit) => compost(t, kit, true),
  // The grindstone: the wheel's round face, its rim, the pivots.
  grindstone_side: (t, kit) => {
    t.forEach((x, y) => {
      const d = Math.hypot(x - 15.5, y - 15.5);
      let c = stoneish(t, kit, STONE, x, y, 4);
      if (d > 14) c = kit.scaleRgb(c, 0.7);
      else if (d > 12.5) c = kit.scaleRgb(c, 0.85);
      else if (d < 3) c = kit.hex(DARK_OAK[2]);
      else if (d < 4) c = kit.scaleRgb(c, 0.75);
      t.set(x, y, c);
    });
  },
  grindstone_round: (t, kit) => {
    t.forEach((x, y) => t.set(x, y, kit.scaleRgb(stoneish(t, kit, STONE, x, y, 4), y % 6 === 0 ? 0.8 : 1)));
  },
  grindstone_pivot: (t, kit) => {
    boards(t, kit, DARK_OAK, 2, true);
    const iron = IRON.map(kit.hex);
    for (let y = 12; y < 20; y++) for (let x = 12; x < 20; x++) t.set(x, y, iron[x === 12 || y === 12 ? 4 : 2]);
  },
  // The stonecutter: stone with its slot on top, an iron rim; the saw blade.
  stonecutter_top: (t, kit) => {
    t.forEach((x, y) => t.set(x, y, stoneish(t, kit, SMOOTH, x, y, 4)));
    frame(t, kit, IRON, 2);
    for (let x = 3; x < 29; x++) for (const y of [15, 16]) t.set(x, y, [24, 24, 26]);
  },
  stonecutter_side: (t, kit) => {
    t.forEach((x, y) => t.set(x, y, stoneish(t, kit, SMOOTH, x, y, 4)));
    const iron = IRON.map(kit.hex);
    // (the block is 9/16 high: its top rim at rows 14-17 of the tile)
    for (let x = 0; x < 32; x++) {
      t.set(x, 14, iron[5]);
      t.set(x, 15, iron[3]);
      t.set(x, 16, iron[1]);
      t.set(x, 31, iron[1]);
    }
    for (let y = 17; y < 31; y++) for (const x of [0, 31]) t.set(x, y, iron[2]);
  },
  stonecutter_saw: (t, kit) => {
    // (Only rows 0-13 are shown: the blade's upper half above the slot.)
    const iron = IRON.map(kit.hex);
    t.forEach((x, y) => {
      const d = Math.hypot(x - 15.5, y - 14.5);
      const ang = Math.atan2(y - 14.5, x - 15.5);
      const tooth = (Math.floor(((ang + Math.PI) / (2 * Math.PI)) * 40) & 1) === 0;
      if (y > 14 || d > (tooth ? 13.5 : 12.5)) return t.set(x, y, [0, 0, 0], 0);
      const c = d > 11 ? iron[2] : d < 2.5 ? iron[0] : d < 4 ? iron[1] : iron[4 - ((x + y) % 5 === 0 ? 1 : 0)];
      t.set(x, y, c);
    });
  },
  // The lectern: the board (oak boards, a lip at its low edge), the post's carved front, its sides.
  lectern_top: (t, kit) => {
    boards(t, kit, OAK, 4, false);
    frame(t, kit, [0x4a3418, 0x5e4422, 0x6e522a], 2);
    for (let x = 2; x < 30; x++) t.set(x, 28, kit.hex(0x3a2810));
  },
  lectern_front: (t, kit) => {
    boards(t, kit, OAK, 4, true);
    const dark = OAK.map((h) => kit.scaleRgb(kit.hex(h), 0.6));
    // (the post's front, x 8-23: an inset panel with a carved diamond)
    for (let y = 6; y < 26; y++) {
      for (let x = 11; x < 21; x++) {
        if (x === 11 || x === 20 || y === 6 || y === 25) t.set(x, y, dark[1]);
        else if (Math.abs(x - 15.5) + Math.abs(y - 15.5) < 5) t.set(x, y, dark[3]);
      }
    }
  },
  lectern_sides: (t, kit) => {
    boards(t, kit, OAK, 4, false);
    frame(t, kit, [0x4a3418, 0x5e4422, 0x6e522a], 1);
  },
  // The fletching table: birch boards with dark bands; on top flint and feathers, arrows on its front.
  fletching_table_top: (t, kit) => {
    boards(t, kit, BIRCH, 4, false);
    frame(t, kit, [0x3a2a18, 0x54402a, 0x6a5236], 2);
    for (let i = 0; i < 9; i++) {
      t.set(8 + i, 9 + i, [240, 240, 236]);
      t.set(9 + i, 9 + i, [210, 210, 206]);
      t.set(8 + i, 10 + i, [190, 190, 186]);
    }
    for (let y = 20; y < 26; y++) for (let x = 20; x < 26; x++) if (Math.abs(x - 22.5) + Math.abs(y - 22.5) < 3.5) t.set(x, y, [52, 52, 58]);
  },
  fletching_table_front: (t, kit) => {
    boards(t, kit, BIRCH, 4, true);
    frame(t, kit, [0x3a2a18, 0x54402a, 0x6a5236], 2);
    // Two arrows crossed: shafts, flint heads, white fletching.
    for (let i = 0; i < 18; i++) {
      t.set(7 + i, 7 + i, [110, 80, 46]);
      t.set(24 - i, 7 + i, [110, 80, 46]);
    }
    for (const [x, y] of [[7, 7], [24, 7]]) for (let d = -1; d <= 1; d++) t.set(x + d, y, [60, 60, 66]);
    for (const [x, y] of [[23, 23], [8, 23]]) for (let d = 0; d < 3; d++) t.set(x, y + d, [236, 236, 230]);
  },
  fletching_table_side: (t, kit) => {
    boards(t, kit, BIRCH, 4, true);
    frame(t, kit, [0x3a2a18, 0x54402a, 0x6a5236], 2);
    for (let x = 2; x < 30; x++) t.set(x, 16, kit.hex(0x54402a));
  },
  // The cartography table: a map pinned on dark oak; papers on its sides.
  cartography_table_top: (t, kit) => {
    boards(t, kit, DARK_OAK, 4, false);
    t.forEach((x, y) => {
      if (x < 4 || y < 4 || x > 27 || y > 27) return;
      const n = t.fbm(x, y, 4, 3, 9);
      let c = [224, 208, 160];
      if (n < 0.42) c = [92, 140, 196]; // (water)
      else if (n < 0.47) c = [210, 196, 140];
      else if (n > 0.62) c = [118, 160, 78];
      if (x === 4 || y === 4 || x === 27 || y === 27) c = [150, 120, 80];
      t.set(x, y, kit.scaleRgb(c, 0.95 + t.rand() * 0.08));
    });
    for (const [x, y] of [[5, 5], [26, 5], [5, 26], [26, 26]]) t.set(x, y, [180, 40, 30]);
  },
  cartography_table_side: (t, kit) => {
    boards(t, kit, DARK_OAK, 4, true);
    for (let y = 6; y < 20; y++) for (let x = 6; x < 18; x++) t.set(x, y, (y - 6) % 3 === 2 ? [168, 154, 120] : [222, 210, 174]);
    for (let y = 22; y < 26; y++) for (let x = 4; x < 28; x++) t.set(x, y, [168, 124, 72]);
  },
  // The loom: a wooden frame strung with threads; a cloth on its front.
  loom_top: (t, kit) => {
    boards(t, kit, OAK, 4, false);
    frame(t, kit, [0x4a3418, 0x5e4422, 0x6e522a], 3);
    for (let x = 5; x < 27; x += 3) for (let y = 4; y < 28; y++) t.set(x, y, [236, 232, 220]);
  },
  loom_front: (t, kit) => {
    boards(t, kit, OAK, 4, false);
    frame(t, kit, [0x4a3418, 0x5e4422, 0x6e522a], 3);
    for (let y = 6; y < 22; y++) for (let x = 6; x < 26; x++) t.set(x, y, (x + y) % 2 ? [200, 70, 64] : [176, 54, 50]);
    for (let x = 6; x < 26; x++) t.set(x, 22, [236, 232, 220]);
    for (let x = 4; x < 28; x++) for (const y of [24, 25]) t.set(x, y, kit.hex(0x5e4422));
  },
  loom_side: (t, kit) => {
    boards(t, kit, OAK, 4, true);
    frame(t, kit, [0x4a3418, 0x5e4422, 0x6e522a], 3);
    for (let y = 12; y < 20; y++) for (let x = 12; x < 20; x++) t.set(x, y, Math.hypot(x - 15.5, y - 15.5) < 3.5 ? [236, 232, 220] : [120, 88, 52]);
  },
  // The bell: gold, light at the top left.
  bell_body: (t, kit) => {
    const gold = [0x7a5410, 0x9a6c14, 0xc08c1c, 0xe0ac2a, 0xf6d050, 0xfff0a0].map(kit.hex);
    t.forEach((x, y) => {
      const f = 0.55 + (t.noise(x, y, 4, 2) - 0.5) * 0.4 - (x + y) / 160 + (y % 8 === 0 ? -0.2 : 0);
      t.set(x, y, kit.ramp(gold, f));
    });
  },
  // The shulker box: purple shell, the lid over the base (the seam a third down).
  shulker_box_side: (t, kit) => {
    const pur = [0x4a2a52, 0x5e3666, 0x744478, 0x8a548a, 0x9c66a0, 0xb07cb4].map(kit.hex);
    t.forEach((x, y) => {
      let f = 0.55 + (t.fbm(x, y, 8, 2, 3) - 0.5) * 0.4;
      if (y > 12) f -= 0.12;
      if (y === 12) f = 0.05;
      if (y === 13) f = 0.95;
      t.set(x, y, kit.ramp(pur, f));
    });
    frame(t, kit, [0x3a1e42, 0x4a2a52, 0x5e3666], 1);
  },
  shulker_box_top: (t, kit) => {
    const pur = [0x4a2a52, 0x5e3666, 0x744478, 0x8a548a, 0x9c66a0, 0xb07cb4].map(kit.hex);
    t.forEach((x, y) => {
      const d = Math.min(x, y, 31 - x, 31 - y);
      const f = 0.55 + (t.fbm(x, y, 8, 2, 4) - 0.5) * 0.4 + (d > 6 && d < 9 ? -0.25 : 0);
      t.set(x, y, kit.ramp(pur, f));
    });
    frame(t, kit, [0x3a1e42, 0x4a2a52, 0x5e3666], 1);
  },
};

function campLog(t, kit, embers) {
  const ramp = [0x2e2014, 0x3c2a18, 0x4c361e, 0x5c4226, 0x6a4e2e].map(kit.hex);
  t.forEach((x, y) => {
    const ring = y % 8; // (four logs' worth of bark rows)
    const grain = t.noise(x, y * 4, 8, 2) * 0.6 + t.rand() * 0.25;
    let f = 0.35 + (grain - 0.4) * 0.8;
    if (ring === 0 || ring === 7) f -= 0.3;
    t.set(x, y, kit.ramp(ramp, f));
    if (!embers) return;
    const crack = t.noise(x * 2, y, 16, 7);
    if (crack > 0.7 && ring > 1 && ring < 6) t.set(x, y, kit.hex(embers[crack > 0.82 ? 2 : crack > 0.76 ? 1 : 0]));
  });
}

function compost(t, kit, ready) {
  const ramp = (ready ? [0x3a2814, 0x4c3418, 0x5e421e, 0x6e5026, 0x7c5c2e] : [0x2a1c0c, 0x382610, 0x463016, 0x543a1c, 0x624422]).map(kit.hex);
  t.forEach((x, y) => {
    const f = t.fbm(x, y, 8, 3, 2) * 0.7 + t.rand() * 0.3;
    t.set(x, y, kit.ramp(ramp, f));
    if (!ready && t.rand() < 0.04) t.set(x, y, [70, 96, 34]); // (green bits)
    if (ready && t.rand() < 0.1) t.set(x, y, t.rand() < 0.5 ? [236, 236, 228] : [204, 204, 196]); // (bone meal)
  });
}

export const tileRelief = {
  smoker_side: [2, 0.7, 0.5],
  smoker_front: [2.2, 0.7, 0.6],
  smoker_front_lit: [2.2, 0.6, 0.6],
  blast_furnace_side: [2, 0.5, 0.5],
  blast_furnace_front: [2.2, 0.5, 0.6],
  blast_furnace_front_lit: [2.2, 0.5, 0.6],
  campfire_log: [2.4, 0.8, 0.6],
  campfire_log_lit: [2.4, 0.8, 0.6],
  soul_campfire_log_lit: [2.4, 0.8, 0.6],
  compost: [2.6, 0.9, 0.6],
  compost_ready: [2.6, 0.9, 0.6],
  grindstone_side: [2, 0.8, 0.5],
  grindstone_round: [2, 0.8, 0.5],
  stonecutter_top: [1.8, 0.6, 0.5],
  shulker_box_side: [1.4, 0.5, 0.4],
  shulker_box_top: [1.4, 0.5, 0.4],
  bell_body: [1.2, 0.3, 0.4],
};
void lum;

export const items = {};
export const icons = {};

// ---------- Recipes (vanilla's) ----------

export const recipes = () => {
  const LOGS = [BLOCK.WOOD, BLOCK.OAK_BARK, BLOCK.BIRCH_LOG, BLOCK.PINE_LOG, I.JUNGLE_LOG, I.ACACIA_LOG, I.DARK_OAK_LOG, I.CRIMSON_STEM, I.WARPED_STEM, I.STRIPPED_CRIMSON_STEM, I.STRIPPED_WARPED_STEM, I.CRIMSON_HYPHAE, I.WARPED_HYPHAE];
  const PLANKS = [BLOCK.PLANKS, I.SPRUCE_PLANKS, I.BIRCH_PLANKS, I.JUNGLE_PLANKS, I.ACACIA_PLANKS, I.DARK_OAK_PLANKS, I.CRIMSON_PLANKS, I.WARPED_PLANKS];
  const SLABS = [I.OAK_SLAB, I.SPRUCE_SLAB, I.BIRCH_SLAB, I.JUNGLE_SLAB, I.ACACIA_SLAB, I.DARK_OAK_SLAB, I.CRIMSON_SLAB, I.WARPED_SLAB];
  const ok = (list) => list.filter((id) => LIB.itemInfo?.(id));
  const shaped = (pattern, key, result) => ({ type: "shaped", pattern, key, result: [result, 1] });
  return [
    shaped([" L ", "LFL", " L "], { L: ok(LOGS), F: I.FURNACE }, SMOKER),
    shaped(["III", "IFI", "SSS"], { I: I.IRON_INGOT, F: I.FURNACE, S: I.SMOOTH_STONE }, BLAST_FURNACE),
    shaped([" S ", "SCS", "LLL"], { S: ITEM.STICK, C: [ITEM.COAL, I.CHARCOAL], L: ok(LOGS) }, CAMPFIRE),
    shaped([" S ", "SCS", "LLL"], { S: ITEM.STICK, C: ok([I.SOUL_SAND, I.SOUL_SOIL]), L: ok(LOGS) }, SOUL_CAMPFIRE),
    shaped(["S S", "S S", "SSS"], { S: ok(SLABS) }, COMPOSTER),
    shaped(["T#T", "P P"], { T: ITEM.STICK, "#": I.STONE_SLAB, P: ok(PLANKS) }, GRINDSTONE),
    shaped([" I ", "###"], { I: I.IRON_INGOT, "#": BLOCK.STONE }, STONECUTTER),
    shaped(["SSS", " B ", " S "], { S: ok(SLABS), B: I.BOOKSHELF }, LECTERN),
    shaped(["FF", "PP", "PP"], { F: I.FLINT, P: ok(PLANKS) }, FLETCHING_TABLE),
    shaped(["pp", "PP", "PP"], { p: I.PAPER, P: ok(PLANKS) }, CARTOGRAPHY_TABLE),
    shaped(["ss", "PP"], { s: I.STRING, P: ok(PLANKS) }, LOOM),
    shaped(["S", "C", "S"], { S: I.SHULKER_SHELL, C: BLOCK.CHEST }, SHULKER_BOX),
    // (Burnt as fuel: the wooden ones, vanilla's 15 s; the composter 15 s too.)
    { type: "fuel", input: [COMPOSTER, LECTERN, FLETCHING_TABLE, CARTOGRAPHY_TABLE, LOOM], time: 15 },
  ];
};

// ---------- Use ----------

// Opens a screen of the game (main.js sets interaction.onOpenScreen; the
// chest screen: interaction.onOpenChest).
function openScreen(ctx, kind) {
  const open = ctx.interaction?.onOpenScreen;
  if (typeof open !== "function") return false;
  ctx.audio?.playClick?.();
  open(kind, ctx.x, ctx.y, ctx.z);
  return true;
}
function openChest(ctx) {
  const open = ctx.interaction?.onOpenChest;
  if (typeof open !== "function") return false;
  ctx.audio?.playClick?.();
  open(ctx.x, ctx.y, ctx.z);
  return true;
}

// The held stack swapped for one of `id` (an emptied bucket); Creative keeps it.
function exchange(ctx, id) {
  const inv = ctx.inventory;
  const s = inv.selectedStack;
  if (!s || ctx.creative) return;
  if (s.count <= 1) {
    inv.slots[inv.selected] = { id, count: 1 };
    return;
  }
  s.count -= 1;
  const left = inv.add(id, 1);
  if (left > 0) ctx.interaction?.throwStack?.({ id, count: left });
}
function wear(ctx) {
  if (!ctx.creative && ctx.inventory.damageSelected?.(1)) ctx.audio?.playToolBreak?.();
}

// The campfire: put out (a shovel, a water bucket), lit (flint and steel, a
// fire charge), or food laid on it (js/furnace.js: LIB.campfires).
function useCampfire(ctx) {
  const held = ctx.stack;
  const lit = campfireLit(ctx.id);
  const to = (on) => ctx.world.setBlock(ctx.x, ctx.y, ctx.z, campfireAs(ctx.id, on));
  if (lit && held && (ctx.info?.tool?.type === "shovel" || held.id === I.WATER_BUCKET)) {
    if (!to(false)) return false;
    ctx.audio?.playSplash?.();
    if (held.id === I.WATER_BUCKET) exchange(ctx, I.BUCKET);
    else wear(ctx);
    return true;
  }
  if (!lit && held && (held.id === I.FLINT_AND_STEEL || held.id === I.FIRE_CHARGE)) {
    if (!to(true)) return false;
    (ctx.audio?.playIgnite || ctx.audio?.playClick)?.call(ctx.audio);
    if (held.id === I.FLINT_AND_STEEL) wear(ctx);
    else if (!ctx.creative) ctx.inventory.consumeSelected(1);
    return true;
  }
  return !!(held && LIB.campfires?.put?.(ctx));
}

// The composter: plant matter in (by its chance; an empty one always takes
// the first), full a second later; ready: bone meal out.
function useComposter(ctx) {
  const lvl = ctx.id - COMPOSTER;
  if (lvl === 8) {
    if (!ctx.world.setBlock(ctx.x, ctx.y, ctx.z, COMPOSTER)) return false;
    if (LIB.itemInfo?.(I.BONE_MEAL)) ctx.interaction?.chests?.onDrop?.({ id: I.BONE_MEAL, count: 1 }, ctx.x, ctx.y + 0.6, ctx.z);
    ctx.audio?.playPlace?.("plant");
    return true;
  }
  const held = ctx.stack;
  const p = held ? compostChance(held.id) : 0;
  if (!p || lvl >= 7) return false;
  if (!ctx.creative) ctx.inventory.consumeSelected(1);
  ctx.audio?.playPlace?.("plant");
  if (lvl > 0 && Math.random() >= p) return true;
  const next = lvl + 1;
  if (!ctx.world.setBlock(ctx.x, ctx.y, ctx.z, COMPOSTER + next)) return true;
  if (next === 7) {
    // (Vanilla: ready 20 ticks later; the random tick catches one left full.)
    const { world, x, y, z } = ctx;
    setTimeout(() => {
      if (world.getBlock(x, y, z) === COMPOSTER + 7) world.setBlock(x, y, z, COMPOSTER + 8);
    }, 1000);
  }
  return true;
}

export const blockUse = {
  [GRINDSTONE]: (ctx) => openScreen(ctx, "grindstone"),
  [GRINDSTONE + 1]: (ctx) => openScreen(ctx, "grindstone"),
  [STONECUTTER]: (ctx) => openScreen(ctx, "stonecutter"),
  [STONECUTTER + 1]: (ctx) => openScreen(ctx, "stonecutter"),
  [SHULKER_PLACED]: openChest,
  [BELL]: (ctx) => !!LIB.ringBell?.(ctx.x, ctx.y, ctx.z),
  [BELL + 1]: (ctx) => !!LIB.ringBell?.(ctx.x, ctx.y, ctx.z),
};
for (let v = 0; v < 8; v++) {
  blockUse[CHEST_DOUBLE + v] = openChest;
  blockUse[SMOKER + v] = (ctx) => openScreen(ctx, "furnace");
  blockUse[BLAST_FURNACE + v] = (ctx) => openScreen(ctx, "furnace");
}
for (let v = 0; v < 4; v++) {
  blockUse[CAMPFIRE + v] = useCampfire;
  blockUse[SOUL_CAMPFIRE + v] = useCampfire;
}
for (let l = 0; l < 9; l++) blockUse[COMPOSTER + l] = useComposter;

export const itemUse = {};
export const randomTick = {
  [COMPOSTER + 7]: (world, x, y, z) => world.setBlock(x, y, z, COMPOSTER + 8),
};
export const drops = {
  [SHULKER_BOX]: () => [],
  [SHULKER_PLACED]: () => [],
};
for (let v = 0; v < 4; v++) {
  drops[CAMPFIRE + v] = () => [[I.CHARCOAL, 2]];
  drops[SOUL_CAMPFIRE + v] = () => [[I.SOUL_SOIL, 1]];
}
