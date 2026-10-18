// Nature (Round 11): ores, lava and obsidian, fire, clay, sugar cane,
// pumpkins and melons, saplings and the three new woods, crops and
// farmland, bone meal, hoes and shovel paths, ice and snow, mushrooms,
// flowers, vines, lily pads, cobwebs, podzol, mycelium, hay.
// Ids: blocks 1536-1791, items 400-479 (./ids.js; LAVA_FLOWING below is
// this module's own, after the listed ones). What a content module may
// export, and its rules: see ./index.js.
//
// Vanilla values throughout (hardness, tiers shifted by one: wood 1,
// stone 2, iron 3, diamond 4; drops; growth by random ticks; food), with the
// deviations named where they are made. Systems that need more than a
// random tick (lava flow, fire spread) are js/lavasim.js and
// js/nature-sim.js; leaf decay is the leaves' random tick here; the
// terrain's ores, lava lakes and plants are js/terrain.js (Survival worlds
// only) and the trees js/trees.js.
import { BLOCK, ITEM, RENDER, FACE, LIB } from "./base.js";
import * as ID from "./ids.js";
import { isVanilla } from "../worldtype.js";

const {
  REDSTONE_ORE, LAPIS_ORE, EMERALD_ORE, COPPER_ORE,
  IRON_BLOCK, GOLD_BLOCK, DIAMOND_BLOCK, EMERALD_BLOCK, LAPIS_BLOCK, REDSTONE_BLOCK, COAL_BLOCK, COPPER_BLOCK,
  LAVA, OBSIDIAN, FIRE, CLAY, RED_SAND, ICE, PACKED_ICE, SNOW_LAYER, FARMLAND,
  WHEAT_CROP, CARROTS, POTATOES, BEETROOTS, SUGAR_CANE, PUMPKIN, CARVED_PUMPKIN, JACK_O_LANTERN, MELON,
  PUMPKIN_STEM, MELON_STEM,
  OAK_SAPLING, SPRUCE_SAPLING, BIRCH_SAPLING, JUNGLE_SAPLING, ACACIA_SAPLING, DARK_OAK_SAPLING,
  JUNGLE_LOG, ACACIA_LOG, DARK_OAK_LOG, JUNGLE_LEAVES, ACACIA_LEAVES, DARK_OAK_LEAVES,
  BROWN_MUSHROOM, RED_MUSHROOM,
  BLUE_ORCHID, ALLIUM, AZURE_BLUET, RED_TULIP, ORANGE_TULIP, WHITE_TULIP, PINK_TULIP, OXEYE_DAISY, CORNFLOWER, LILY_OF_THE_VALLEY,
  FERN, LILY_PAD, VINE, COBWEB, PODZOL, MYCELIUM, COARSE_DIRT, DIRT_PATH, HAY_BLOCK,
  WHEAT_SEEDS, WHEAT, BEETROOT_SEEDS, BEETROOT, CARROT, POTATO, POISONOUS_POTATO, MELON_SEEDS, PUMPKIN_SEEDS,
  MELON_SLICE, SUGAR, BONE_MEAL, CLAY_BALL, BRICK, SNOWBALL, COCOA_BEANS,
} = ID;

// Flowing lava: 3 ids, levels 1-3 (the distance from its source; vanilla
// lava reaches 3 blocks on land). LAVA itself is the source. (A flowing cell
// with lava above it is falling lava: drawn full height, spreading like a
// source where it lands.)
export const LAVA_FLOWING = 1651;
export const LAVA_MAX_LEVEL = 3;
export function isLava(id) {
  return id === LAVA || (id >= LAVA_FLOWING && id < LAVA_FLOWING + LAVA_MAX_LEVEL);
}
export function lavaLevel(id) {
  return id === LAVA ? 0 : id - LAVA_FLOWING + 1;
}
export function lavaFlowId(level) {
  return LAVA_FLOWING + level - 1;
}
// Grass under snow (a Survival world's snowy ground: the core's snow block
// look, but it is grass: drops dirt, turns back to grass when the snow goes).
export const SNOWY_GRASS = 1654;
// Leaves a player placed (Survival worlds): 6 ids, oak, spruce, birch,
// jungle, acacia, dark oak; they look and drop like the natural ones but
// never decay (vanilla's persistent leaves).
export const PERSISTENT_LEAVES = 1655;
// (nature.js blocks: next free 1661)
const NATURAL_LEAVES = [BLOCK.LEAVES, BLOCK.PINE_LEAVES, BLOCK.BIRCH_LEAVES, JUNGLE_LEAVES, ACACIA_LEAVES, DARK_OAK_LEAVES];

// The same id ranges as numbers (hot paths).
export const CROP_STAGES = { [WHEAT_CROP]: 8, [CARROTS]: 4, [POTATOES]: 4, [BEETROOTS]: 4 };
export const CROPS = [WHEAT_CROP, CARROTS, POTATOES, BEETROOTS];
const isFarmland = (id) => id === FARMLAND || id === FARMLAND + 1;
const isSnowLayer = (id) => id >= SNOW_LAYER && id < SNOW_LAYER + 8;
const isStem = (id) => (id >= PUMPKIN_STEM && id < PUMPKIN_STEM + 8) || (id >= MELON_STEM && id < MELON_STEM + 8);
const isVine = (id) => id >= VINE && id < VINE + 4;
function cropBase(id) {
  for (const c of CROPS) if (id >= c && id < c + CROP_STAGES[c]) return c;
  return 0;
}
export const SAPLINGS = {
  [OAK_SAPLING]: "oak",
  [SPRUCE_SAPLING]: "spruce",
  [BIRCH_SAPLING]: "birch",
  [JUNGLE_SAPLING]: "jungle",
  [ACACIA_SAPLING]: "acacia",
  [DARK_OAK_SAPLING]: "dark_oak",
};
export const NEW_FLOWERS = [BLUE_ORCHID, ALLIUM, AZURE_BLUET, RED_TULIP, ORANGE_TULIP, WHITE_TULIP, PINK_TULIP, OXEYE_DAISY, CORNFLOWER, LILY_OF_THE_VALLEY];

// ---------- Small helpers (no allocation in the per-tick paths) ----------

// Light at a cell: the brighter of sky and block light (0-15), read straight
// from the chunk (vanilla's "raw brightness": the time of day doesn't count).
function lightAt(world, x, y, z) {
  if (y < 0) return 0;
  const c = world.getChunk(x >> 4, z >> 4);
  if (!c) return 0;
  if (y >= c.blocks.length >> 8) return 15;
  const v = c.light[(y << 8) | ((z & 15) << 4) | (x & 15)];
  return Math.max(v >> 4, v & 15);
}
function blockLightAt(world, x, y, z) {
  const c = y >= 0 ? world.getChunk(x >> 4, z >> 4) : null;
  if (!c || y >= c.blocks.length >> 8) return 0;
  return c.light[(y << 8) | ((z & 15) << 4) | (x & 15)] & 15;
}
// Water (sources and flow; seagrass and kelp stand in water), not ice.
export function isWater(id) {
  return id === BLOCK.WATER || id === BLOCK.SEAGRASS || id === BLOCK.KELP;
}
const solidOpaque = (id) => LIB.IS_SOLID[id] === 1 && LIB.IS_OPAQUE[id] === 1;
const between = (a, b, rand) => a + Math.floor(rand() * (b - a + 1));
function binomial(n, p, rand) {
  let k = 0;
  for (let i = 0; i < n; i++) if (rand() < p) k++;
  return k;
}
const SIDES = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
];
// The four facings of a block with variants: 0 +Z, 1 -Z, 2 +X, 3 -X (as the
// stairs in ./ids.js), with the face that points that way.
const FACINGS = [
  [0, 1, FACE.PZ],
  [0, -1, FACE.NZ],
  [1, 0, FACE.PX],
  [-1, 0, FACE.NX],
];
function facingOf(dx, dz) {
  return Math.abs(dx) >= Math.abs(dz) ? (dx >= 0 ? 2 : 3) : dz >= 0 ? 0 : 1;
}
// A drop's position for entities.spawn (a THREE.Vector3: cloned from the player's).
function dropAt(ctx, x, y, z, id, n) {
  if (!ctx.entities || n <= 0) return;
  const p = ctx.player.position.clone();
  p.set(x + 0.5, y + 0.5, z + 0.5);
  ctx.entities.spawn(id, n, p);
}
// Green sparkles where bone meal worked (the effects' debris particles).
const SPARKLE = { r: 0.35, g: 0.9, b: 0.3 };
function sparkle(ctx, x, y, z) {
  const d = ctx.effects?.debris;
  if (!d) return;
  for (let i = 0; i < 10; i++) d.spawn(x + Math.random(), y + Math.random() * 0.8, z + Math.random(), (Math.random() - 0.5) * 0.6, 1 + Math.random(), (Math.random() - 0.5) * 0.6, 0.05, SPARKLE, 0.8 + Math.random() * 0.5);
}
// A tool or held item used once (not in Creative).
function useItem(ctx, wear) {
  if (ctx.creative) return;
  if (wear) {
    if (ctx.inventory.damageSelected(1)) ctx.audio?.playToolBreak?.();
  } else ctx.inventory.consumeSelected(1);
}
const isShears = (tool) => tool?.type === "shears";

// ---------- Soils ----------

// What saplings, flowers, ferns and mushrooms (on podzol, mycelium) grow on.
const PLANT_SOIL = new Set([BLOCK.GRASS, BLOCK.DIRT, PODZOL, COARSE_DIRT, MYCELIUM, FARMLAND, FARMLAND + 1, SNOWY_GRASS]);
const plantSoil = (below) => PLANT_SOIL.has(below);
const CANE_SOIL = new Set([BLOCK.GRASS, BLOCK.DIRT, BLOCK.SAND, RED_SAND, PODZOL, COARSE_DIRT, MYCELIUM, SNOWY_GRASS]);
// Ground a pumpkin or melon may grow onto.
const FRUIT_SOIL = new Set([BLOCK.GRASS, BLOCK.DIRT, PODZOL, COARSE_DIRT, MYCELIUM, FARMLAND, FARMLAND + 1, SNOWY_GRASS]);

// Water beside a block (sugar cane needs it next to its ground).
function waterBeside(world, x, y, z) {
  for (const [dx, dz] of SIDES) {
    const id = world.getBlock(x + dx, y, z + dz);
    if (isWater(id) || id === ICE) return true;
  }
  return false;
}

// ---------- Flammability (fire spread, js/nature-sim.js) ----------

// [chance to catch fire from a neighbour, chance to burn away] per block,
// vanilla's FireBlock table; a def's own `flammable: [a, b]` wins. Built on
// the first call (other modules' blocks are known by then).
let flameTable = null;
export function flammability() {
  if (flameTable) return flameTable;
  const ignite = new Uint8Array(4096);
  const burn = new Uint8Array(4096);
  const set = (ids, a, b) => {
    for (const id of ids) {
      ignite[id] = a;
      burn[id] = b;
    }
  };
  const range = (from, n) => Array.from({ length: n }, (_, i) => from + i);
  set([BLOCK.PLANKS, ...range(ID.SPRUCE_PLANKS, 5)], 5, 20);
  set(range(ID.OAK_STAIRS, 6 * 8), 5, 20); // the six wooden stairs (8 ids each)
  set(range(ID.OAK_SLAB, 12), 5, 20); // the six wooden slabs (2 ids each)
  set(range(ID.OAK_FENCE, 6), 5, 20);
  set(range(ID.OAK_FENCE_GATE, 6 * 8), 5, 20);
  set([BLOCK.WOOD, BLOCK.BIRCH_LOG, BLOCK.PINE_LOG, BLOCK.OAK_BARK, JUNGLE_LOG, ACACIA_LOG, DARK_OAK_LOG], 5, 5);
  set([...NATURAL_LEAVES, ...range(PERSISTENT_LEAVES, 6)], 30, 60);
  set([ID.BOOKSHELF], 30, 20);
  set([ID.TNT], 15, 100);
  set([BLOCK.TALL_GRASS, BLOCK.FLOWER_RED, BLOCK.FLOWER_YELLOW, BLOCK.DEAD_BUSH, FERN, ...NEW_FLOWERS], 60, 100);
  set([BLOCK.WOOL, ...range(ID.ORANGE_WOOL, 15)], 30, 60);
  set(range(ID.WHITE_CARPET, 16), 60, 20);
  set(range(VINE, 4), 15, 100);
  set([HAY_BLOCK], 60, 20);
  set([COAL_BLOCK], 5, 5);
  for (const info of Object.values(LIB.BLOCK_INFO || {})) {
    if (Array.isArray(info.flammable)) set([info.id], info.flammable[0], info.flammable[1]);
  }
  flameTable = { ignite, burn };
  return flameTable;
}

// XP from mining an ore (vanilla, uniform between the two; raw-metal ores
// give none), for the survival part: a block def's `xp` [min, max], or this
// table for the core ores.
export const ORE_XP = {
  [BLOCK.COAL_ORE]: [0, 2],
  [BLOCK.DIAMOND_ORE]: [3, 7],
  [EMERALD_ORE]: [3, 7],
  [LAPIS_ORE]: [2, 5],
  [REDSTONE_ORE]: [1, 5],
  [REDSTONE_ORE + 1]: [1, 5],
};
export function blockXp(id, rand = Math.random) {
  const r = LIB.BLOCK_INFO?.[id]?.xp || ORE_XP[id];
  return r ? between(r[0], r[1], rand) : 0;
}

// ---------- Blocks ----------

export const blocks = {};
const def = (id, d) => (blocks[id] = d);

// Ores (mining tiers: iron/copper/lapis need stone, gold/diamond/redstone/
// emerald need iron, as vanilla).
def(REDSTONE_ORE, { name: "Redstone Ore", faces: "redstone_ore", hardness: 3, tool: "pickaxe", minTier: 3, xp: [1, 5] });
// (lit for a while after being clicked or walked on: a little light, as vanilla)
def(REDSTONE_ORE + 1, { name: "Redstone Ore", faces: "redstone_ore", hardness: 3, tool: "pickaxe", minTier: 3, xp: [1, 5], emission: 9, item: REDSTONE_ORE });
def(LAPIS_ORE, { name: "Lapis Lazuli Ore", faces: "lapis_ore", hardness: 3, tool: "pickaxe", minTier: 2, xp: [2, 5] });
def(EMERALD_ORE, { name: "Emerald Ore", faces: "emerald_ore", hardness: 3, tool: "pickaxe", minTier: 3, xp: [3, 7] });
def(COPPER_ORE, { name: "Copper Ore", faces: "copper_ore", hardness: 3, tool: "pickaxe", minTier: 2 });
// Blocks of the minerals (their 9-to-1 recipes are the crafting part's).
def(IRON_BLOCK, { name: "Block of Iron", faces: "iron_block", hardness: 5, tool: "pickaxe", minTier: 2 });
def(GOLD_BLOCK, { name: "Block of Gold", faces: "gold_block", hardness: 3, tool: "pickaxe", minTier: 3 });
def(DIAMOND_BLOCK, { name: "Block of Diamond", faces: "diamond_block", hardness: 5, tool: "pickaxe", minTier: 3 });
def(EMERALD_BLOCK, { name: "Block of Emerald", faces: "emerald_block", hardness: 5, tool: "pickaxe", minTier: 3 });
def(LAPIS_BLOCK, { name: "Block of Lapis Lazuli", faces: "lapis_block", hardness: 3, tool: "pickaxe", minTier: 2 });
def(REDSTONE_BLOCK, { name: "Block of Redstone", faces: "redstone_block", hardness: 5, tool: "pickaxe", minTier: 1 });
def(COAL_BLOCK, { name: "Block of Coal", faces: "coal_block", hardness: 5, tool: "pickaxe", minTier: 1 });
def(COPPER_BLOCK, { name: "Block of Copper", faces: "copper_block", hardness: 3, tool: "pickaxe", minTier: 2 });

// Lava: glowing, burns (the survival part reads `lava` and `burns`: damage,
// setting players alight), flows (js/lavasim.js). Not a `liquid` (that is
// water's: swimming, drowning, the water shader).
const LAVA_DEF = {
  name: "Lava",
  faces: "lava",
  render: RENDER.OPAQUE,
  shape: "lava",
  solid: false,
  opaque: false,
  lightFilter: 2,
  emission: 15,
  emissive: true,
  selectable: false,
  replaceable: true,
  hardness: -1,
  lava: true,
  burns: true,
  creative: false,
  sound: "stone",
};
def(LAVA, LAVA_DEF);
for (let l = 1; l <= LAVA_MAX_LEVEL; l++) def(lavaFlowId(l), { ...LAVA_DEF, name: "Flowing Lava", item: LAVA });
def(OBSIDIAN, { name: "Obsidian", faces: "obsidian", hardness: 50, tool: "pickaxe", minTier: 4, blastResistance: 1200 });
// Fire: a flat box to punch out (instant), drawn as flames. Spreads and burns
// out in js/nature-sim.js; `fire` and `burns` for the survival part.
def(FIRE, {
  name: "Fire",
  faces: "fire",
  render: RENDER.CUTOUT,
  shape: "fire",
  solid: false,
  opaque: false,
  skyPass: true,
  emission: 15,
  emissive: true,
  replaceable: true,
  hardness: 0,
  box: [0, 0, 0, 1, 1 / 16, 1],
  fire: true,
  burns: true,
  creative: false,
  sound: "cloth",
});
def(CLAY, { name: "Clay", faces: "clay", hardness: 0.6, tool: "shovel", sound: "dirt" });
def(RED_SAND, { name: "Red Sand", faces: "red_sand", hardness: 0.5, tool: "shovel", sound: "sand", gravity: true });
// Ice: lets some light through, slippery (`slipperiness`, vanilla's 0.98),
// melts by bright block light. Broken over the sea, the sea fills it again
// (the game's flooding of a mined cell at sea level); elsewhere it leaves
// nothing (deviation: vanilla leaves water over any solid ground). Not
// `waterlogged`: that would make it count as water (swimming, the water
// drawn inside it).
def(ICE, { name: "Ice", faces: "ice", render: RENDER.CUTOUT, opaque: false, lightFilter: 2, hardness: 0.5, tool: "pickaxe", sound: "glass", slipperiness: 0.98 });
// (the ice tile again: packed ice is a block of the same look that never melts)
def(PACKED_ICE, { name: "Packed Ice", faces: "ice", hardness: 0.5, tool: "pickaxe", sound: "glass", slipperiness: 0.98 });
// Snow layers: 1-8 (8 is a full block). One layer is replaceable and has no
// collision, n layers collide up to (n - 1) / 8 (vanilla).
const snowSupport = (below) => (solidOpaque(below) && below !== PACKED_ICE) || LIB.BLOCK_INFO?.[below]?.leaves === true || below === SNOW_LAYER + 7;
for (let n = 1; n <= 8; n++) {
  const full = n === 8;
  def(SNOW_LAYER + n - 1, {
    name: "Snow",
    faces: "snow_top",
    ...(full ? {} : { shape: "snow_layer" }), // (8 layers: a plain cube)
    opaque: full,
    solid: n > 1,
    collision: n > 1 && !full ? [[0, 0, 0, 1, (n - 1) / 8, 1]] : null,
    box: full ? null : [0, 0, 0, 1, n / 8, 1],
    replaceable: n === 1,
    support: snowSupport,
    hardness: 0.1,
    tool: "shovel",
    minTier: 1,
    sound: "cloth",
    item: n > 1 ? SNOW_LAYER : null,
    layers: n,
  });
}
// Farmland: dry and wet (a darker top). 15/16 tall, drops dirt.
for (let wet = 0; wet < 2; wet++) {
  def(FARMLAND + wet, {
    name: "Farmland",
    faces: { top: wet ? "farmland_wet" : "farmland_dry", bottom: "dirt", side: "dirt" },
    shape: "farmland",
    opaque: false,
    box: [0, 0, 0, 1, 15 / 16, 1],
    collision: [[0, 0, 0, 1, 15 / 16, 1]],
    hardness: 0.6,
    tool: "shovel",
    sound: "dirt",
    item: wet ? FARMLAND : null,
  });
}
// Crops: their seeds are their item (planted with the seeds' itemUse).
const cropSupport = (below) => isFarmland(below);
const CROP_TILES = {
  [WHEAT_CROP]: (s) => (s < 7 ? "wheat_green" : "wheat_ripe"),
  [CARROTS]: (s) => (s < 3 ? "crop_leafy" : "carrots_ripe"),
  [POTATOES]: (s) => (s < 3 ? "crop_leafy" : "potatoes_ripe"),
  [BEETROOTS]: (s) => (s < 3 ? "crop_leafy" : "beetroots_ripe"),
};
// Heights by stage, in sixteenths (vanilla's crop shapes; carrots and potatoes
// have 8 ages in vanilla shown as 4 pictures: here 4 stages of 2 ages each).
const CROP_HEIGHTS = {
  [WHEAT_CROP]: [2, 4, 6, 8, 10, 12, 14, 16],
  [CARROTS]: [3, 5, 7, 9],
  [POTATOES]: [3, 5, 7, 9],
  [BEETROOTS]: [2, 4, 6, 8],
};
const CROP_NAMES = { [WHEAT_CROP]: "Wheat Crops", [CARROTS]: "Carrots", [POTATOES]: "Potatoes", [BEETROOTS]: "Beetroots" };
const CROP_ITEM = { [WHEAT_CROP]: WHEAT_SEEDS, [CARROTS]: CARROT, [POTATOES]: POTATO, [BEETROOTS]: BEETROOT_SEEDS };
const CROP_H = new Float32Array(4096); // crop/stem id -> height (shapes, boxes)
for (const c of CROPS) {
  for (let s = 0; s < CROP_STAGES[c]; s++) {
    const h = CROP_HEIGHTS[c][s] / 16;
    CROP_H[c + s] = h;
    def(c + s, {
      name: CROP_NAMES[c],
      faces: CROP_TILES[c](s),
      render: RENDER.CUTOUT,
      shape: "crop",
      solid: false,
      opaque: false,
      skyPass: true,
      wave: true,
      support: cropSupport,
      box: [0, 0, 0, 1, Math.max(h, 2 / 16), 1],
      hardness: 0,
      sound: "plant",
      item: CROP_ITEM[c],
      crop: c,
      stage: s,
    });
  }
}
// Stems: 8 stages; the ripe one grows its fruit beside it.
for (const [stem, name, seeds] of [
  [PUMPKIN_STEM, "Pumpkin Stem", PUMPKIN_SEEDS],
  [MELON_STEM, "Melon Stem", MELON_SEEDS],
]) {
  for (let s = 0; s < 8; s++) {
    const h = (2 + 2 * s) / 16;
    CROP_H[stem + s] = h;
    def(stem + s, {
      name,
      faces: "stem",
      render: RENDER.CUTOUT,
      shape: "stem",
      solid: false,
      opaque: false,
      skyPass: true,
      wave: true,
      support: cropSupport,
      box: [0.375, 0, 0.375, 0.625, h, 0.625],
      hardness: 0,
      sound: "plant",
      item: seeds,
      stage: s,
    });
  }
}
def(SUGAR_CANE, {
  name: "Sugar Cane",
  faces: "sugar_cane",
  render: RENDER.CUTOUT,
  shape: "cane",
  solid: false,
  opaque: false,
  skyPass: true,
  support: (below) => below === SUGAR_CANE || CANE_SOIL.has(below),
  box: [2 / 16, 0, 2 / 16, 14 / 16, 1, 14 / 16],
  hardness: 0,
  sound: "plant",
});
def(PUMPKIN, { name: "Pumpkin", faces: { top: "pumpkin_top", bottom: "pumpkin_top", side: "pumpkin_side" }, hardness: 1, tool: "axe", sound: "wood" });
def(MELON, { name: "Melon", faces: { top: "melon_top", bottom: "melon_top", side: "melon_side" }, hardness: 1, tool: "axe", sound: "wood" });
// Carved pumpkins and jack o'lanterns face one of four ways (the face
// toward the player who places them).
const facePlace = (base) => (ctx) => {
  const f = ctx.forward || [0, 0, 1];
  return base + facingOf(-f[0], -f[2]);
};
FACINGS.forEach(([dx, dz, face], k) => {
  def(CARVED_PUMPKIN + k, {
    name: "Carved Pumpkin",
    faces: { top: "pumpkin_top", bottom: "pumpkin_top", side: "pumpkin_side", front: "carved_pumpkin" },
    frontFace: face,
    facing: [dx, dz],
    hardness: 1,
    tool: "axe",
    sound: "wood",
    item: k ? CARVED_PUMPKIN : null,
    placeAs: facePlace(CARVED_PUMPKIN),
  });
  def(JACK_O_LANTERN + k, {
    name: "Jack o'Lantern",
    faces: { top: "pumpkin_top", bottom: "pumpkin_top", side: "pumpkin_side", front: "jack_o_lantern" },
    frontFace: face,
    facing: [dx, dz],
    emission: 15,
    hardness: 1,
    tool: "axe",
    sound: "wood",
    item: k ? JACK_O_LANTERN : null,
    placeAs: facePlace(JACK_O_LANTERN),
  });
});
// Saplings (grow into their tree: trees.js growTree).
const PLANT = { render: RENDER.CUTOUT, shape: "cross", solid: false, opaque: false, skyPass: true, wave: true, hardness: 0, sound: "plant" };
const SAPLING_NAMES = { oak: "Oak", spruce: "Spruce", birch: "Birch", jungle: "Jungle", acacia: "Acacia", dark_oak: "Dark Oak" };
for (const [id, kind] of Object.entries(SAPLINGS)) def(Number(id), { ...PLANT, name: `${SAPLING_NAMES[kind]} Sapling`, faces: `${kind}_sapling`, support: plantSoil, sapling: kind });
// The three new woods (oak, birch and spruce are the core's).
def(JUNGLE_LOG, { name: "Jungle Log", faces: { top: "jungle_log_top", bottom: "jungle_log_top", side: "jungle_log" }, hardness: 2, tool: "axe", sound: "wood", log: true });
def(ACACIA_LOG, { name: "Acacia Log", faces: { top: "acacia_log_top", bottom: "acacia_log_top", side: "acacia_log" }, hardness: 2, tool: "axe", sound: "wood", log: true });
def(DARK_OAK_LOG, { name: "Dark Oak Log", faces: { top: "dark_oak_log_top", bottom: "dark_oak_log_top", side: "dark_oak_log" }, hardness: 2, tool: "axe", sound: "wood", log: true });
const LEAF = { render: RENDER.CUTOUT, opaque: false, lightFilter: 1, wave: true, hardness: 0.2, sound: "grass", leaves: true };
def(JUNGLE_LEAVES, { ...LEAF, name: "Jungle Leaves", faces: "jungle_leaves" });
def(ACACIA_LEAVES, { ...LEAF, name: "Acacia Leaves", faces: "acacia_leaves" });
def(DARK_OAK_LEAVES, { ...LEAF, name: "Dark Oak Leaves", faces: "dark_oak_leaves" });
[
  ["Leaves", "leaves"],
  ["Pine Needles", "pine_leaves"],
  ["Birch Leaves", "birch_leaves"],
  ["Jungle Leaves", "jungle_leaves"],
  ["Acacia Leaves", "acacia_leaves"],
  ["Dark Oak Leaves", "dark_oak_leaves"],
].forEach(([name, tile], i) => def(PERSISTENT_LEAVES + i, { ...LEAF, name, faces: tile, item: NATURAL_LEAVES[i], creative: false }));
def(SNOWY_GRASS, { name: "Grass Block", faces: { top: "snow_top", bottom: "dirt", side: "snow_side" }, hardness: 0.6, tool: "shovel", sound: "grass", creative: false });
// Mushrooms: on solid ground in the dark (placeAs checks the light), or on
// podzol and mycelium in any light.
const mushroomPlace = (id) => (ctx) => {
  const [x, y, z] = ctx.place;
  const below = ctx.world.getBlock(x, y - 1, z);
  if (below === PODZOL || below === MYCELIUM) return id;
  return lightAt(ctx.world, x, y, z) < 13 ? id : null;
};
def(BROWN_MUSHROOM, { ...PLANT, name: "Brown Mushroom", faces: "brown_mushroom", wave: false, emission: 1, support: solidOpaque, placeAs: mushroomPlace(BROWN_MUSHROOM), box: [5 / 16, 0, 5 / 16, 11 / 16, 6 / 16, 11 / 16] });
def(RED_MUSHROOM, { ...PLANT, name: "Red Mushroom", faces: "red_mushroom", wave: false, support: solidOpaque, placeAs: mushroomPlace(RED_MUSHROOM), box: [5 / 16, 0, 5 / 16, 11 / 16, 6 / 16, 11 / 16] });
// The ten new flowers (the core's red blossom and sunpetal stand for the
// poppy and the dandelion).
const FLOWER_NAMES = ["Blue Orchid", "Allium", "Azure Bluet", "Red Tulip", "Orange Tulip", "White Tulip", "Pink Tulip", "Oxeye Daisy", "Cornflower", "Lily of the Valley"];
const FLOWER_TILES = ["blue_orchid", "allium", "azure_bluet", "red_tulip", "orange_tulip", "white_tulip", "pink_tulip", "oxeye_daisy", "cornflower", "lily_of_the_valley"];
NEW_FLOWERS.forEach((id, i) => def(id, { ...PLANT, name: FLOWER_NAMES[i], faces: FLOWER_TILES[i], support: plantSoil }));
def(FERN, { ...PLANT, name: "Fern", faces: "fern", replaceable: true, support: plantSoil });
// Lily pads float on water (placed by aiming at the water: itemUse). Not
// solid here (deviation: vanilla's can be stood on; mobs would spawn on them).
def(LILY_PAD, {
  name: "Lily Pad",
  faces: "lily_pad",
  render: RENDER.CUTOUT,
  shape: "lily_pad",
  solid: false,
  opaque: false,
  skyPass: true,
  support: (below) => below === BLOCK.WATER,
  box: [0, 0, 0, 1, 1 / 16, 1],
  hardness: 0,
  sound: "plant",
});
// Vines: 4 ids, by the wall they cling to (FACINGS order: 0 the wall at +Z,
// 1 -Z, 2 +X, 3 -X); climbable (the survival part reads `climbable`). They
// hang on their wall like a ladder (`support: "wall"`, `facing` away from
// it: interaction.js pops them when it goes).
FACINGS.forEach(([dx, dz], k) => {
  const t = 1 / 16;
  def(VINE + k, {
    name: "Vines",
    faces: "vine",
    render: RENDER.CUTOUT,
    shape: "vine",
    solid: false,
    opaque: false,
    skyPass: true,
    wave: true,
    replaceable: true,
    climbable: true,
    box: [dx > 0 ? 1 - t : 0, 0, dz > 0 ? 1 - t : 0, dx < 0 ? t : 1, 1, dz < 0 ? t : 1],
    hardness: 0.2,
    sound: "plant",
    item: k ? VINE : null,
    wall: [dx, dz],
    support: "wall",
    facing: [-dx, -dz],
    placeAs: (ctx) => {
      const n = ctx.normal;
      if (!n || n[1] !== 0) return null; // (on a wall's side only)
      return VINE + facingOf(-n[0], -n[2]);
    },
  });
});
// Cobweb: slows whatever moves through it (`slows` for the survival part);
// a sword cuts it fast and gets string, shears get the web.
def(COBWEB, { ...PLANT, name: "Cobweb", faces: "cobweb", wave: false, lightFilter: 1, hardness: 4, tool: "sword", sound: "cloth", slows: true });
def(PODZOL, { name: "Podzol", faces: { top: "podzol_top", bottom: "dirt", side: "podzol_side" }, hardness: 0.5, tool: "shovel", sound: "dirt" });
// (Mycelium's sides are plain dirt: it only grows where players spread it.)
def(MYCELIUM, { name: "Mycelium", faces: { top: "mycelium_top", bottom: "dirt", side: "dirt" }, hardness: 0.6, tool: "shovel", sound: "grass" });
def(COARSE_DIRT, { name: "Coarse Dirt", faces: "coarse_dirt", hardness: 0.5, tool: "shovel", sound: "dirt" });
def(DIRT_PATH, {
  name: "Dirt Path",
  faces: { top: "dirt_path_top", bottom: "dirt", side: "dirt" },
  shape: "farmland",
  opaque: false,
  box: [0, 0, 0, 1, 15 / 16, 1],
  collision: [[0, 0, 0, 1, 15 / 16, 1]],
  hardness: 0.65,
  tool: "shovel",
  sound: "dirt",
});
// Hay: falls hurt less on it (`fallDamage` 0.2 for the survival part).
def(HAY_BLOCK, { name: "Hay Bale", faces: { top: "hay_top", bottom: "hay_top", side: "hay_side" }, hardness: 0.5, tool: "hoe", sound: "grass", fallDamage: 0.2 });
// (Sponge and the moss id are left for later: no tiles in this wave's budget.)

// ---------- Shapes (the mesher's, the same on the main thread and in the workers) ----------

// Quads are precomputed here (shapes run per cell on every rebuild).
const UV = [
  [0, 0],
  [0, 1],
  [1, 1],
  [1, 0],
];
// A vertical quad from (x0, z0) to (x1, z1), y from y0 to y1, its texture's
// v from v0 to v1.
function vquad(x0, z0, x1, z1, y0, y1, v0 = y0, v1 = y1) {
  return {
    c: [
      [x0, y0, z0],
      [x0, y1, z0],
      [x1, y1, z1],
      [x1, y0, z1],
    ],
    uv: [
      [0, v0],
      [0, v1],
      [1, v1],
      [1, v0],
    ],
  };
}
function hquad(y, uv = UV) {
  return {
    c: [
      [0, y, 0],
      [0, y, 1],
      [1, y, 1],
      [1, y, 0],
    ],
    uv,
  };
}
// Crops: four planes in a # (vanilla's crop model). The tile is squashed at
// most two times into a short crop, then cut.
const CROP_QUADS = new Array(4096);
for (let id = 0; id < 4096; id++) {
  const h = CROP_H[id];
  if (!h || isStem(id)) continue;
  const v1 = Math.min(1, h * 2);
  CROP_QUADS[id] = [vquad(0.25, 0, 0.25, 1, 0, h, 0, v1), vquad(0.75, 0, 0.75, 1, 0, h, 0, v1), vquad(0, 0.25, 1, 0.25, 0, h, 0, v1), vquad(0, 0.75, 1, 0.75, 0, h, 0, v1)];
}
// Crossed planes (stems, sugar cane), with no jitter: cane stacks line up.
const crossQuads = (h, lo = 0.15, hi = 0.85) => [vquad(lo, lo, hi, hi, 0, h, 0, Math.min(1, h * 2)), vquad(lo, hi, hi, lo, 0, h, 0, Math.min(1, h * 2))];
const STEM_QUADS = new Array(4096);
for (let id = 0; id < 4096; id++) if (isStem(id)) STEM_QUADS[id] = crossQuads(CROP_H[id], 0.2, 0.8);
const CANE_QUADS = crossQuads(1, 0.1, 0.9);
// Fire: four flame sheets just inside the sides, and two across the middle.
const FIRE_QUADS = [
  vquad(0.06, 0, 0.06, 1, 0, 1),
  vquad(0.94, 0, 0.94, 1, 0, 1),
  vquad(0, 0.06, 1, 0.06, 0, 1),
  vquad(0, 0.94, 1, 0.94, 0, 1),
  vquad(0, 0, 1, 1, 0, 1),
  vquad(0, 1, 1, 0, 0, 1),
];
// Vines: a sheet against their wall.
const VINE_QUADS = FACINGS.map(([dx, dz]) => {
  const t = 0.05;
  if (dx) return [vquad(dx > 0 ? 1 - t : t, 0, dx > 0 ? 1 - t : t, 1, 0, 1)];
  return [vquad(0, dz > 0 ? 1 - t : t, 1, dz > 0 ? 1 - t : t, 0, 1)];
});
// Lily pads: flat on the water, turned one of four ways by position.
const LILY_QUADS = [0, 1, 2, 3].map((r) => hquad(0.015, [0, 1, 2, 3].map((k) => UV[(k + r) & 3])));
// Lava: its surface at the level's height (vanilla 8/9 for a source, 2/9
// less per block of flow), full height under more lava; the sides drawn down
// to a lower lava neighbour's surface, none against lava as high or a
// solid block.
const LAVA_TOPS = [8 / 9, 6 / 9, 4 / 9, 2 / 9];
const LAVA_HEIGHTS = [0, ...LAVA_TOPS.slice().reverse(), 1]; // the heights a side can run between
const hIndex = (h) => LAVA_HEIGHTS.indexOf(h);
const LAVA_SIDE = []; // [side][from][to] quads
SIDES.forEach(([dx, dz], s) => {
  LAVA_SIDE[s] = LAVA_HEIGHTS.map((y0) =>
    LAVA_HEIGHTS.map((y1) => {
      if (y1 <= y0) return null;
      if (dx) return vquad(dx > 0 ? 1 : 0, 0, dx > 0 ? 1 : 0, 1, y0, y1);
      return vquad(0, dz > 0 ? 1 : 0, 1, dz > 0 ? 1 : 0, y0, y1);
    })
  );
});
const SIDE_FACE = [FACE.PX, FACE.NX, FACE.PZ, FACE.NZ];
const LAVA_TOP_QUADS = LAVA_HEIGHTS.map((h) => hquad(h));
const LAVA_BOTTOM = hquad(0);
function lavaTop(m, id) {
  return isLava(m.neighbor(0, 1, 0)) ? 1 : LAVA_TOPS[lavaLevel(id)];
}
// One face `f` of the box lo-hi in the cell, its texture cut to the box (the
// cube's corners and uvs, as mesher.js; scratch arrays: no allocation).
const FACE_DEFS = [
  { corners: [[1, 0, 0], [1, 1, 0], [1, 1, 1], [1, 0, 1]], uv: (c) => [1 - c[2], c[1]] },
  { corners: [[0, 0, 1], [0, 1, 1], [0, 1, 0], [0, 0, 0]], uv: (c) => [c[2], c[1]] },
  { corners: [[0, 1, 1], [1, 1, 1], [1, 1, 0], [0, 1, 0]], uv: (c) => [c[0], 1 - c[2]] },
  { corners: [[0, 0, 0], [1, 0, 0], [1, 0, 1], [0, 0, 1]], uv: (c) => [c[0], c[2]] },
  { corners: [[1, 0, 1], [1, 1, 1], [0, 1, 1], [0, 0, 1]], uv: (c) => [c[0], c[1]] },
  { corners: [[0, 0, 0], [0, 1, 0], [1, 1, 0], [1, 0, 0]], uv: (c) => [1 - c[0], c[1]] },
];
const QC = [[0, 0, 0], [0, 0, 0], [0, 0, 0], [0, 0, 0]];
const QU = [[0, 0], [0, 0], [0, 0], [0, 0]];
const BOX = [0, 0, 0, 0, 0, 0];
function boxFace(m, f, x0, y0, z0, x1, y1, z1, tile) {
  BOX[0] = x0;
  BOX[1] = y0;
  BOX[2] = z0;
  BOX[3] = x1;
  BOX[4] = y1;
  BOX[5] = z1;
  const def = FACE_DEFS[f];
  for (let c = 0; c < 4; c++) {
    const p = def.corners[c];
    for (let a = 0; a < 3; a++) QC[c][a] = BOX[p[a] ? a + 3 : a];
    const uv = def.uv(QC[c]);
    QU[c][0] = uv[0];
    QU[c][1] = uv[1];
  }
  m.quad(QC, QU, f, tile);
}
const SNOW_H = new Float32Array(4096);
for (let n = 1; n <= 8; n++) SNOW_H[SNOW_LAYER + n - 1] = n / 8;

export const shapes = {
  crop: {
    mesh(m) {
      const t = m.tile(2);
      for (const q of CROP_QUADS[m.id]) m.quad(q.c, q.uv, 2, t);
    },
  },
  stem: {
    mesh(m) {
      const t = m.tile(2);
      for (const q of STEM_QUADS[m.id]) m.quad(q.c, q.uv, 2, t);
    },
  },
  cane: {
    mesh(m) {
      const t = m.tile(2);
      for (const q of CANE_QUADS) m.quad(q.c, q.uv, 2, t);
    },
  },
  fire: {
    mesh(m) {
      const t = m.tile(2);
      for (const q of FIRE_QUADS) m.quad(q.c, q.uv, 2, t);
    },
  },
  vine: {
    mesh(m) {
      const t = m.tile(2);
      const k = m.id - VINE;
      const q = VINE_QUADS[k][0];
      m.quad(q.c, q.uv, FACINGS[k ^ 1][2], t); // (lit as the face looking away from its wall)
    },
  },
  lily_pad: {
    mesh(m) {
      const q = LILY_QUADS[((m.wx * 7) ^ (m.wz * 13)) & 3];
      m.quad(q.c, q.uv, 2, m.tile(2));
    },
  },
  farmland: { mesh: (m) => m.box(0, 0, 0, 1, 15 / 16, 1) },
  // (the top, and sides only where the neighbour is lower: a snowfield costs
  // one quad a column, not a box's five)
  snow_layer: {
    mesh(m) {
      const opaque = LIB.IS_OPAQUE;
      const h = SNOW_H[m.id];
      const t = m.tile(2);
      boxFace(m, FACE.PY, 0, 0, 0, 1, h, 1, t);
      for (let s = 0; s < 4; s++) {
        const n = m.neighbor(SIDES[s][0], 0, SIDES[s][1]);
        if (opaque[n]) continue;
        const nh = SNOW_H[n];
        if (nh >= h) continue;
        boxFace(m, SIDE_FACE[s], 0, nh, 0, 1, h, 1, t);
      }
      if (!opaque[m.neighbor(0, -1, 0)]) boxFace(m, FACE.NY, 0, 0, 0, 1, h, 1, t);
    },
  },
  lava: {
    mesh(m) {
      const id = m.id;
      const t = m.tile(2);
      const top = lavaTop(m, id);
      const ti = hIndex(top);
      if (ti < LAVA_HEIGHTS.length - 1) {
        const q = LAVA_TOP_QUADS[ti];
        m.quad(q.c, q.uv, 2, t);
      }
      for (let s = 0; s < 4; s++) {
        const n = m.neighbor(SIDES[s][0], 0, SIDES[s][1]);
        let from = 0;
        if (isLava(n)) {
          // (a lava neighbour's surface: the step up to this one is drawn)
          const nt = isLava(m.neighbor(SIDES[s][0], 1, SIDES[s][1])) ? 1 : LAVA_TOPS[lavaLevel(n)];
          from = hIndex(nt);
        } else if (LIB.IS_OPAQUE[n]) continue;
        const q = LAVA_SIDE[s][from][ti];
        if (q) m.quad(q.c, q.uv, SIDE_FACE[s], t);
      }
      const below = m.neighbor(0, -1, 0);
      if (!isLava(below) && !LIB.IS_OPAQUE[below]) m.quad(LAVA_BOTTOM.c, LAVA_BOTTOM.uv, FACE.NY, t);
    },
  },
};

// ---------- Items ----------

export const items = {
  [WHEAT_SEEDS]: { name: "Wheat Seeds", icon: "wheat_seeds" },
  [WHEAT]: { name: "Wheat", icon: "wheat" },
  [BEETROOT_SEEDS]: { name: "Beetroot Seeds", icon: "beetroot_seeds" },
  [BEETROOT]: { name: "Beetroot", icon: "beetroot", food: { hunger: 1, saturation: 1.2 } },
  [CARROT]: { name: "Carrot", icon: "carrot", food: { hunger: 3, saturation: 3.6 } },
  [POTATO]: { name: "Potato", icon: "potato", food: { hunger: 1, saturation: 0.6 } },
  // (60%: Poison for 5 s, as vanilla; the survival part's effects)
  [POISONOUS_POTATO]: { name: "Poisonous Potato", icon: "poisonous_potato", food: { hunger: 2, saturation: 1.2 }, effects: [{ type: "poison", seconds: 5, level: 1, chance: 0.6 }] },
  [MELON_SEEDS]: { name: "Melon Seeds", icon: "melon_seeds" },
  [PUMPKIN_SEEDS]: { name: "Pumpkin Seeds", icon: "pumpkin_seeds" },
  [MELON_SLICE]: { name: "Melon Slice", icon: "melon_slice", food: { hunger: 2, saturation: 1.2 } },
  [SUGAR]: { name: "Sugar", icon: "sugar" },
  [BONE_MEAL]: { name: "Bone Meal", icon: "bone_meal" },
  [CLAY_BALL]: { name: "Clay Ball", icon: "clay_ball" },
  [BRICK]: { name: "Brick", icon: "brick" },
  [SNOWBALL]: { name: "Snowball", icon: "snowball", stack: 16 },
  // (Cocoa pods on jungle trees are not in this wave: Creative only for now.)
  [COCOA_BEANS]: { name: "Cocoa Beans", icon: "cocoa_beans" },
};

// ---------- Drops ----------

export const drops = {};
const fixed = (list) => () => list;
for (let l = 0; l <= LAVA_MAX_LEVEL; l++) drops[l ? lavaFlowId(l) : LAVA] = fixed([]);
drops[FIRE] = fixed([]);
drops[ICE] = fixed([]);
drops[PACKED_ICE] = fixed([]);
drops[REDSTONE_ORE] = drops[REDSTONE_ORE + 1] = (tool, rand) => [[ID.REDSTONE, between(4, 5, rand)]];
drops[LAPIS_ORE] = (tool, rand) => [[ID.LAPIS_LAZULI, between(4, 9, rand)]];
drops[EMERALD_ORE] = () => [[ID.EMERALD, 1]];
drops[COPPER_ORE] = (tool, rand) => [[ID.RAW_COPPER, between(2, 5, rand)]];
drops[CLAY] = fixed([[CLAY_BALL, 4]]);
drops[FARMLAND] = drops[FARMLAND + 1] = fixed([[BLOCK.DIRT, 1]]);
drops[DIRT_PATH] = fixed([[BLOCK.DIRT, 1]]);
drops[PODZOL] = fixed([[BLOCK.DIRT, 1]]);
drops[MYCELIUM] = fixed([[BLOCK.DIRT, 1]]);
drops[MELON] = (tool, rand) => [[MELON_SLICE, between(3, 7, rand)]];
for (let n = 1; n <= 8; n++) drops[SNOW_LAYER + n - 1] = fixed([[SNOWBALL, n]]);
// Crops: one seed (or the root) until ripe; then the harvest (vanilla: the
// seeds are 1 + binomial(3, 4/7), so are the extra carrots and potatoes on
// top of the first: 2-5; a ripe potato also gives a poisonous one 2% of the time).
for (const c of CROPS) {
  const last = CROP_STAGES[c] - 1;
  for (let s = 0; s <= last; s++) {
    const ripe = s === last;
    drops[c + s] = (tool, rand) => {
      const extra = 1 + binomial(3, 4 / 7, rand);
      if (c === WHEAT_CROP) return ripe ? [[WHEAT, 1], [WHEAT_SEEDS, extra]] : [[WHEAT_SEEDS, 1]];
      if (c === BEETROOTS) return ripe ? [[BEETROOT, 1], [BEETROOT_SEEDS, extra]] : [[BEETROOT_SEEDS, 1]];
      const root = c === CARROTS ? CARROT : POTATO;
      if (!ripe) return [[root, 1]];
      const out = [[root, 1 + extra]]; // (vanilla's two pools: one root, and 1 + binomial more: 2-5)
      if (c === POTATOES && rand() < 0.02) out.push([POISONOUS_POTATO, 1]);
      return out;
    };
  }
}
// Stems: up to 3 seeds, more as they grow (vanilla).
for (const [stem, seeds] of [
  [PUMPKIN_STEM, PUMPKIN_SEEDS],
  [MELON_STEM, MELON_SEEDS],
]) {
  for (let s = 0; s < 8; s++) drops[stem + s] = (tool, rand) => [[seeds, binomial(3, (s + 1) / 15, rand)]];
}
// Leaves: shears take the block; otherwise a sapling now and then (1 in 20,
// jungle 1 in 40), sticks (2%: 1-2) and from oak and dark oak an apple (1 in
// 200), as vanilla. The core leaves keep their old drops in a Missions world.
function leafDrops(leaf, sapling, chance, apples) {
  return (tool, rand) => {
    if (leaf < 1024 && !isVanilla()) return null;
    if (isShears(tool)) return [[leaf, 1]];
    const out = [];
    if (rand() < chance) out.push([sapling, 1]);
    if (rand() < 0.02) out.push([ITEM.STICK, between(1, 2, rand)]);
    if (apples && rand() < 0.005) out.push([ITEM.APPLE, 1]);
    return out;
  };
}
drops[BLOCK.LEAVES] = leafDrops(BLOCK.LEAVES, OAK_SAPLING, 1 / 20, true);
drops[BLOCK.BIRCH_LEAVES] = leafDrops(BLOCK.BIRCH_LEAVES, BIRCH_SAPLING, 1 / 20, false);
drops[BLOCK.PINE_LEAVES] = leafDrops(BLOCK.PINE_LEAVES, SPRUCE_SAPLING, 1 / 20, false);
drops[JUNGLE_LEAVES] = leafDrops(JUNGLE_LEAVES, JUNGLE_SAPLING, 1 / 40, false);
drops[ACACIA_LEAVES] = leafDrops(ACACIA_LEAVES, ACACIA_SAPLING, 1 / 20, false);
drops[DARK_OAK_LEAVES] = leafDrops(DARK_OAK_LEAVES, DARK_OAK_SAPLING, 1 / 20, true);
NATURAL_LEAVES.forEach((leaf, i) => (drops[PERSISTENT_LEAVES + i] = drops[leaf]));
drops[SNOWY_GRASS] = fixed([[BLOCK.DIRT, 1]]);
// Ferns: shears take them, otherwise wheat seeds 1 in 8 (like grass).
drops[FERN] = (tool, rand) => (isShears(tool) ? [[FERN, 1]] : rand() < 0.125 ? [[WHEAT_SEEDS, 1]] : []);
for (let k = 0; k < 4; k++) drops[VINE + k] = (tool) => (isShears(tool) ? [[VINE, 1]] : []);
drops[COBWEB] = (tool) => (isShears(tool) ? [[COBWEB, 1]] : tool?.type === "sword" ? [[ID.STRING, 1]] : []);

// ---------- Growth (random ticks: the host's, online) ----------

export const randomTick = {};

// Vanilla's crop growth speed: 1, plus 1 for dry farmland under it or 3 for
// wet (a quarter of that for each of the 8 around), halved when the same crop
// grows in two directions around it (rows grow faster than blocks).
function growthSpeed(world, x, y, z, base, span) {
  let f = 1;
  for (let dz = -1; dz <= 1; dz++) {
    for (let dx = -1; dx <= 1; dx++) {
      const b = world.getBlock(x + dx, y - 1, z + dz);
      let g = b === FARMLAND ? 1 : b === FARMLAND + 1 ? 3 : 0;
      if (dx || dz) g /= 4;
      f += g;
    }
  }
  const same = (dx, dz) => {
    const id = world.getBlock(x + dx, y, z + dz);
    return id >= base && id < base + span;
  };
  const ew = same(1, 0) || same(-1, 0);
  const ns = same(0, 1) || same(0, -1);
  if (ew && ns) f /= 2;
  else if (same(1, 1) || same(-1, 1) || same(1, -1) || same(-1, -1)) f /= 2;
  return f;
}
const growsNow = (f, rand) => Math.floor(rand() * (Math.floor(25 / f) + 1)) === 0;

for (const c of CROPS) {
  const n = CROP_STAGES[c];
  for (let s = 0; s < n - 1; s++) {
    randomTick[c + s] = (world, x, y, z, id, rand) => {
      if (lightAt(world, x, y + 1, z) < 9) return;
      // (beetroots grow only on 2 ticks in 3; carrots and potatoes have half
      // as many pictures as vanilla ages: a stage takes two)
      if (c === BEETROOTS && rand() < 1 / 3) return;
      if ((c === CARROTS || c === POTATOES) && rand() < 0.5) return;
      if (growsNow(growthSpeed(world, x, y, z, c, n), rand)) world.setBlock(x, y, z, id + 1);
    };
  }
}
// Stems grow like crops; ripe, they set a fruit on a free side.
for (const [stem, fruit] of [
  [PUMPKIN_STEM, PUMPKIN],
  [MELON_STEM, MELON],
]) {
  for (let s = 0; s < 8; s++) {
    randomTick[stem + s] = (world, x, y, z, id, rand) => {
      if (lightAt(world, x, y + 1, z) < 9 || !growsNow(growthSpeed(world, x, y, z, stem, 8), rand)) return;
      if (s < 7) {
        world.setBlock(x, y, z, id + 1);
        return;
      }
      // (a stem already attached to its fruit grows no other: vanilla's attached stem)
      for (const [sx, sz] of SIDES) if (world.getBlock(x + sx, y, z + sz) === fruit) return;
      const [dx, dz] = SIDES[Math.floor(rand() * 4)];
      if (world.getBlock(x + dx, y, z + dz) !== BLOCK.AIR || !FRUIT_SOIL.has(world.getBlock(x + dx, y - 1, z + dz))) return;
      world.setBlock(x + dx, y, z + dz, fruit);
    };
  }
}
// Sugar cane (and the core's cactus, in a Survival world) grows a block every
// 16 ticks on average, up to 3 tall; cane dries out without water by its
// root (deviation: vanilla notices at once, here on its next tick).
function columnTick(id0, needsWater) {
  return (world, x, y, z, id, rand) => {
    if (id0 === BLOCK.CACTUS && !isVanilla()) return;
    let bottom = y;
    while (bottom > 0 && y - bottom < 3 && world.getBlock(x, bottom - 1, z) === id0) bottom--;
    if (needsWater && !waterBeside(world, x, bottom - 1, z)) {
      world.setBlock(x, bottom, z, BLOCK.AIR); // (the rest pops off: world.js)
      world.onBlockPopped?.(x, bottom, z, id0);
      return;
    }
    if (world.getBlock(x, y + 1, z) !== BLOCK.AIR || y + 1 - bottom >= 3 || rand() >= 1 / 16) return;
    world.setBlock(x, y + 1, z, id0);
  };
}
randomTick[SUGAR_CANE] = columnTick(SUGAR_CANE, true);
randomTick[BLOCK.CACTUS] = columnTick(BLOCK.CACTUS, false);

// Saplings: two steps (1 in 7 per tick in light 9+, vanilla), the second
// grows the tree. The first step is kept here (by position; not saved: a
// reload only resets it).
const SAPLING_STAGE = new Set();
export function advanceSapling(world, x, y, z, id, rand = Math.random) {
  const key = `${x},${y},${z}`;
  if (!SAPLING_STAGE.has(key)) {
    if (SAPLING_STAGE.size > 4096) SAPLING_STAGE.clear();
    SAPLING_STAGE.add(key);
    return true;
  }
  const grown = !!world.terrain?.trees?.growTree?.(world, x, y, z, SAPLINGS[id], id, rand);
  if (grown) SAPLING_STAGE.delete(key);
  return grown;
}
for (const id of Object.keys(SAPLINGS)) {
  randomTick[id] = (world, x, y, z, sid, rand) => {
    if (lightAt(world, x, y + 1, z) >= 9 && rand() < 1 / 7) advanceSapling(world, x, y, z, sid, rand);
  };
}
// Farmland: wet with water within 4 blocks (at its level or one up), dry
// without; dry and bare it turns back into dirt, and under a solid block too.
function waterNear(world, x, y, z) {
  for (let dy = 0; dy <= 1; dy++) {
    for (let dz = -4; dz <= 4; dz++) {
      for (let dx = -4; dx <= 4; dx++) if (isWater(world.getBlock(x + dx, y + dy, z + dz))) return true;
    }
  }
  return false;
}
for (let wet = 0; wet < 2; wet++) {
  randomTick[FARMLAND + wet] = (world, x, y, z, id) => {
    const above = world.getBlock(x, y + 1, z);
    if (LIB.IS_SOLID[above] && LIB.IS_OPAQUE[above]) {
      world.setBlock(x, y, z, BLOCK.DIRT);
      return;
    }
    if (waterNear(world, x, y, z)) {
      if (!wet) world.setBlock(x, y, z, FARMLAND + 1);
    } else if (wet) world.setBlock(x, y, z, FARMLAND);
    else if (!cropBase(above) && !isStem(above)) world.setBlock(x, y, z, BLOCK.DIRT);
  };
}
// Grass spreads to dirt nearby in the light and dies under a block (Survival
// worlds; vanilla), mycelium the same.
function spreadingTick(self) {
  return (world, x, y, z, id, rand) => {
    if (self === BLOCK.GRASS && !isVanilla()) return;
    const above = world.getBlock(x, y + 1, z);
    if (LIB.IS_OPAQUE[above] || isWater(above) || isLava(above)) {
      world.setBlock(x, y, z, BLOCK.DIRT);
      return;
    }
    if (self === BLOCK.GRASS && isSnowLayer(above)) {
      world.setBlock(x, y, z, SNOWY_GRASS);
      return;
    }
    if (lightAt(world, x, y + 1, z) < 9) return;
    for (let k = 0; k < 4; k++) {
      const tx = x + Math.floor(rand() * 3) - 1;
      const ty = y + Math.floor(rand() * 5) - 3;
      const tz = z + Math.floor(rand() * 3) - 1;
      if (world.getBlock(tx, ty, tz) !== BLOCK.DIRT) continue;
      const up = world.getBlock(tx, ty + 1, tz);
      if (LIB.IS_OPAQUE[up] || isWater(up) || lightAt(world, tx, ty + 1, tz) < 4) continue;
      world.setBlock(tx, ty, tz, self);
    }
  };
}
randomTick[BLOCK.GRASS] = spreadingTick(BLOCK.GRASS);
randomTick[MYCELIUM] = spreadingTick(MYCELIUM);
// Snowy grass is grass again once its snow is gone (and dirt under a block).
randomTick[SNOWY_GRASS] = (world, x, y, z) => {
  const above = world.getBlock(x, y + 1, z);
  if (LIB.IS_OPAQUE[above] && !isSnowLayer(above)) world.setBlock(x, y, z, BLOCK.DIRT);
  else if (!isSnowLayer(above) && above !== BLOCK.SNOW) world.setBlock(x, y, z, BLOCK.GRASS);
};
// Leaf decay (Survival worlds): natural leaves more than 6 steps (through
// leaves) from a log fall on their random tick, dropping what a leaf broken
// by hand drops (vanilla; a player's leaves are PERSISTENT_LEAVES).
const DECAY = 6;
const DW = DECAY * 2 + 1;
const decayMark = new Uint32Array(DW * DW * DW);
const decayQueue = new Int8Array(DW * DW * DW * 4);
let decayGen = 0;
const STEPS6 = [
  [1, 0, 0],
  [-1, 0, 0],
  [0, 1, 0],
  [0, -1, 0],
  [0, 0, 1],
  [0, 0, -1],
];
export function leavesHeld(world, x, y, z) {
  const info = LIB.BLOCK_INFO;
  decayGen = (decayGen + 1) >>> 0 || 1;
  const at = (dx, dy, dz) => ((dx + DECAY) * DW + (dy + DECAY)) * DW + (dz + DECAY);
  let head = 0;
  let tail = 0;
  decayMark[at(0, 0, 0)] = decayGen;
  decayQueue[tail++] = 0;
  decayQueue[tail++] = 0;
  decayQueue[tail++] = 0;
  decayQueue[tail++] = 0;
  while (head < tail) {
    const dx = decayQueue[head++];
    const dy = decayQueue[head++];
    const dz = decayQueue[head++];
    const d = decayQueue[head++];
    for (const [sx, sy, sz] of STEPS6) {
      const nx = dx + sx;
      const ny = dy + sy;
      const nz = dz + sz;
      if (nx < -DECAY || nx > DECAY || ny < -DECAY || ny > DECAY || nz < -DECAY || nz > DECAY) continue;
      const k = at(nx, ny, nz);
      if (decayMark[k] === decayGen) continue;
      decayMark[k] = decayGen;
      const b = world.getBlock(x + nx, y + ny, z + nz);
      const bi = info[b];
      if (!bi) continue;
      if (bi.log) return true;
      if (bi.leaves && d + 1 < DECAY) {
        decayQueue[tail++] = nx;
        decayQueue[tail++] = ny;
        decayQueue[tail++] = nz;
        decayQueue[tail++] = d + 1;
      }
    }
  }
  return false;
}
for (const leaf of NATURAL_LEAVES) {
  randomTick[leaf] = (world, x, y, z, id) => {
    // (a log beside it: the common case, without the search)
    if (!isVanilla() || !world.getChunk(x >> 4, z >> 4)) return;
    for (const [sx, sy, sz] of STEPS6) if (LIB.BLOCK_INFO[world.getBlock(x + sx, y + sy, z + sz)]?.log) return;
    if (leavesHeld(world, x, y, z)) return;
    if (world.setBlock(x, y, z, BLOCK.AIR)) world.onBlockPopped?.(x, y, z, id);
  };
}
// Ice and snow melt by a bright lamp (block light above 11), as vanilla.
randomTick[ICE] = (world, x, y, z) => {
  if (blockLightAt(world, x, y, z) > 11 || maxNeighbourBlockLight(world, x, y, z) > 11) world.setBlock(x, y, z, BLOCK.WATER);
};
function maxNeighbourBlockLight(world, x, y, z) {
  let m = 0;
  for (const [dx, dz] of SIDES) m = Math.max(m, blockLightAt(world, x + dx, y, z + dz));
  return Math.max(m, blockLightAt(world, x, y + 1, z));
}
for (let n = 1; n <= 8; n++) {
  randomTick[SNOW_LAYER + n - 1] = (world, x, y, z) => {
    if (blockLightAt(world, x, y, z) > 11 || (n === 8 && maxNeighbourBlockLight(world, x, y, z) > 11)) world.setBlock(x, y, z, BLOCK.AIR);
  };
}
// Lit redstone ore goes dark again.
randomTick[REDSTONE_ORE + 1] = (world, x, y, z) => world.setBlock(x, y, z, REDSTONE_ORE);
// Mushrooms spread slowly in the dark (1 in 25 ticks, at most 5 around).
for (const m of [BROWN_MUSHROOM, RED_MUSHROOM]) {
  randomTick[m] = (world, x, y, z, id, rand) => {
    if (rand() >= 1 / 25) return;
    let n = 0;
    for (let dy = -1; dy <= 1; dy++) {
      for (let dz = -4; dz <= 4; dz++) {
        for (let dx = -4; dx <= 4; dx++) if (world.getBlock(x + dx, y + dy, z + dz) === id && ++n >= 5) return;
      }
    }
    const tx = x + Math.floor(rand() * 3) - 1;
    const ty = y + Math.floor(rand() * 2) - Math.floor(rand() * 2);
    const tz = z + Math.floor(rand() * 3) - 1;
    if (world.getBlock(tx, ty, tz) !== BLOCK.AIR) return;
    const below = world.getBlock(tx, ty - 1, tz);
    if (below === PODZOL || below === MYCELIUM || (solidOpaque(below) && lightAt(world, tx, ty, tz) < 13)) world.setBlock(tx, ty, tz, id);
  };
}
// Vines creep down into the air below them (vanilla grows them in every
// direction; down only here).
for (let k = 0; k < 4; k++) {
  randomTick[VINE + k] = (world, x, y, z, id, rand) => {
    if (rand() >= 0.25 || y < 1 || world.getBlock(x, y - 1, z) !== BLOCK.AIR) return;
    let len = 1;
    while (len < 8 && isVine(world.getBlock(x, y + len, z))) len++;
    if (len < 8) world.setBlock(x, y - 1, z, id);
  };
}
// Fire's own spreading runs in js/nature-sim.js (vanilla fire ticks every
// 1.5-2 s, not on random ticks); a random tick hands it a fire it doesn't
// know (one saved with the world, or lit while nobody simulated it).
randomTick[FIRE] = (world, x, y, z) => world.natureSim?.fire?.adopt(x, y, z);
// Lava sets fire to flammable things near it (vanilla's lava random tick),
// and a flow wakes (js/lavasim.js) in case it was left mid-flow.
function lavaTick(world, x, y, z, id, rand) {
  if (id !== LAVA) world.lavaSim?.wake(x, y, z); // (a source only moves after an edit, which wakes it)
  const { ignite } = flammability();
  const i = Math.floor(rand() * 3);
  if (i > 0) {
    let px = x;
    let py = y;
    let pz = z;
    for (let j = 0; j < i; j++) {
      px += Math.floor(rand() * 3) - 1;
      py += 1;
      pz += Math.floor(rand() * 3) - 1;
      if (!world.getChunk(px >> 4, pz >> 4)) return;
      const b = world.getBlock(px, py, pz);
      if (b === BLOCK.AIR) {
        if (
          ignite[world.getBlock(px + 1, py, pz)] || ignite[world.getBlock(px - 1, py, pz)] ||
          ignite[world.getBlock(px, py + 1, pz)] || ignite[world.getBlock(px, py - 1, pz)] ||
          ignite[world.getBlock(px, py, pz + 1)] || ignite[world.getBlock(px, py, pz - 1)]
        ) {
          world.setBlock(px, py, pz, FIRE);
          return;
        }
      } else if (LIB.IS_SOLID[b]) return;
    }
  } else {
    for (let k = 0; k < 3; k++) {
      const px = x + Math.floor(rand() * 3) - 1;
      const pz = z + Math.floor(rand() * 3) - 1;
      if (world.getBlock(px, y + 1, pz) === BLOCK.AIR && ignite[world.getBlock(px, y, pz)]) world.setBlock(px, y + 1, pz, FIRE);
    }
  }
}
for (let l = 0; l <= LAVA_MAX_LEVEL; l++) randomTick[l ? lavaFlowId(l) : LAVA] = lavaTick;

// ---------- Uses ----------

export const blockUse = {};
export const itemUse = {};

// Seeds and roots plant on farmland (the cell above the farmland aimed at,
// or the cell the crosshair's face leads to); carrots and potatoes are eaten
// when not aimed at farmland.
function plantOn(crop) {
  return (ctx) => {
    if (!ctx.place) return false;
    let [x, y, z] = ctx.place;
    if (isFarmland(ctx.id) && ctx.normal && ctx.normal[1] === 1) [x, y, z] = [ctx.x, ctx.y + 1, ctx.z];
    const world = ctx.world;
    if (!isFarmland(world.getBlock(x, y - 1, z)) || world.getBlock(x, y, z) !== BLOCK.AIR) return false;
    if (!world.setBlock(x, y, z, crop)) return false;
    ctx.audio?.playPlace?.("plant");
    useItem(ctx, false);
    return true;
  };
}
itemUse[WHEAT_SEEDS] = plantOn(WHEAT_CROP);
itemUse[CARROT] = plantOn(CARROTS);
itemUse[POTATO] = plantOn(POTATOES);
itemUse[BEETROOT_SEEDS] = plantOn(BEETROOTS);
itemUse[PUMPKIN_SEEDS] = plantOn(PUMPKIN_STEM);
itemUse[MELON_SEEDS] = plantOn(MELON_STEM);

// Hoes till grass, dirt and paths into farmland (and coarse dirt into dirt)
// when the cell above is open; any face but the bottom.
const TILLS = new Map([
  [BLOCK.GRASS, FARMLAND],
  [SNOWY_GRASS, FARMLAND],
  [BLOCK.DIRT, FARMLAND],
  [DIRT_PATH, FARMLAND],
  [COARSE_DIRT, BLOCK.DIRT],
]);
function till(ctx) {
  const to = TILLS.get(ctx.id);
  if (!to || !ctx.normal || ctx.normal[1] === -1) return false;
  const world = ctx.world;
  if (world.getBlock(ctx.x, ctx.y + 1, ctx.z) !== BLOCK.AIR) return false;
  if (!world.setBlock(ctx.x, ctx.y, ctx.z, to)) return false;
  ctx.audio?.playPlace?.("dirt");
  useItem(ctx, true);
  return true;
}
for (const hoe of [ID.WOODEN_HOE, ID.STONE_HOE, ID.IRON_HOE, ID.GOLDEN_HOE, ID.DIAMOND_HOE]) itemUse[hoe] = till;
// Shovels flatten grass and dirt into a path (vanilla 1.17+), under open air
// (Survival worlds: a Missions world's shovel does what it always did).
const PATHS = new Set([BLOCK.GRASS, BLOCK.DIRT, PODZOL, MYCELIUM, COARSE_DIRT, SNOWY_GRASS]);
function flatten(ctx) {
  if (!isVanilla() || !PATHS.has(ctx.id) || !ctx.normal || ctx.normal[1] === -1) return false;
  const world = ctx.world;
  if (world.getBlock(ctx.x, ctx.y + 1, ctx.z) !== BLOCK.AIR) return false;
  if (!world.setBlock(ctx.x, ctx.y, ctx.z, DIRT_PATH)) return false;
  ctx.audio?.playPlace?.("dirt");
  useItem(ctx, true);
  return true;
}
for (const shovel of [ITEM.WOOD_SHOVEL, ITEM.STONE_SHOVEL, ITEM.IRON_SHOVEL, ITEM.DIAMOND_SHOVEL, ID.GOLDEN_SHOVEL]) itemUse[shovel] = flatten;

// Bone meal: crops +2-5 ages (beetroots a third of that, carrots and potatoes
// half: their stages are two ages), stems +2-5, saplings a step 45% of the
// time, and on a grass block a spray of grass and flowers. Used up whenever
// the target could grow.
export function applyBoneMeal(world, x, y, z, rand = Math.random) {
  const id = world.getBlock(x, y, z);
  const c = cropBase(id);
  if (c) {
    const n = CROP_STAGES[c];
    if (id - c >= n - 1) return false;
    let k = between(2, 5, rand);
    if (c === BEETROOTS) k = Math.floor(k / 3);
    else if (n === 4) k = Math.round(k / 2);
    if (k > 0) world.setBlock(x, y, z, Math.min(c + n - 1, id + k));
    return true;
  }
  if (isStem(id)) {
    const base = id >= MELON_STEM ? MELON_STEM : PUMPKIN_STEM;
    if (id - base >= 7) return false;
    world.setBlock(x, y, z, Math.min(base + 7, id + between(2, 5, rand)));
    return true;
  }
  if (SAPLINGS[id]) {
    if (rand() < 0.45) advanceSapling(world, x, y, z, id, rand);
    return true;
  }
  if (id === BLOCK.GRASS && world.getBlock(x, y + 1, z) === BLOCK.AIR) {
    // (vanilla: 128 short random walks from the block above, grass mostly,
    // a flower of the biome now and then)
    const list = [];
    const seen = new Set();
    for (let i = 0; i < 64; i++) {
      let tx = x;
      let ty = y + 1;
      let tz = z;
      const steps = Math.floor(i / 16);
      let ok = true;
      for (let j = 0; j < steps; j++) {
        tx += Math.floor(rand() * 3) - 1;
        ty += Math.trunc(((Math.floor(rand() * 3) - 1) * Math.floor(rand() * 3)) / 2); // (Java's integer division)
        tz += Math.floor(rand() * 3) - 1;
        if (world.getBlock(tx, ty - 1, tz) !== BLOCK.GRASS || LIB.IS_OPAQUE[world.getBlock(tx, ty, tz)]) {
          ok = false;
          break;
        }
      }
      const key = `${tx},${ty},${tz}`;
      if (!ok || seen.has(key) || world.getBlock(tx, ty, tz) !== BLOCK.AIR || world.getBlock(tx, ty - 1, tz) !== BLOCK.GRASS) continue;
      seen.add(key);
      const flower = rand() < 0.125 ? world.terrain?.flowerAt?.(tx, tz, rand()) : 0;
      list.push(tx, ty, tz, flower || BLOCK.TALL_GRASS);
    }
    if (list.length) world.setBlocks(list);
    return true;
  }
  return false;
}
itemUse[BONE_MEAL] = (ctx) => {
  if (ctx.x === null || !applyBoneMeal(ctx.world, ctx.x, ctx.y, ctx.z)) return false;
  sparkle(ctx, ctx.x, ctx.y, ctx.z);
  ctx.audio?.playPlace?.("plant");
  useItem(ctx, false);
  return true;
};

// Leaves a player places never decay (Survival worlds): placed as their
// persistent ids, through the game's own placing.
NATURAL_LEAVES.forEach((leaf, i) => {
  itemUse[leaf] = (ctx) => (isVanilla() && ctx.interaction?._place ? !!ctx.interaction._place(PERSISTENT_LEAVES + i) : false);
});

// Lily pads go on the water's surface: the first water cell along the view
// (water can't be aimed at) with air above it.
itemUse[LILY_PAD] = (ctx) => {
  const world = ctx.world;
  const eye = ctx.player.getEyePosition();
  const f = ctx.forward;
  const reach = ctx.creative ? 6 : 4.5;
  for (let t = 0; t <= reach; t += 0.1) {
    const x = Math.floor(eye.x + f[0] * t);
    const y = Math.floor(eye.y + f[1] * t);
    const z = Math.floor(eye.z + f[2] * t);
    const id = world.getBlock(x, y, z);
    if (id === BLOCK.WATER) {
      if (world.getBlock(x, y + 1, z) !== BLOCK.AIR || !world.setBlock(x, y + 1, z, LILY_PAD)) return false;
      ctx.audio?.playPlace?.("plant");
      useItem(ctx, false);
      return true;
    }
    if (LIB.IS_SOLID[id]) return false;
  }
  return false;
};

// Sugar cane: on sand or soil with water beside that ground, or on cane.
blocks[SUGAR_CANE].placeAs = (ctx) => {
  const [x, y, z] = ctx.place;
  const below = ctx.world.getBlock(x, y - 1, z);
  if (below === SUGAR_CANE) return SUGAR_CANE;
  return CANE_SOIL.has(below) && waterBeside(ctx.world, x, y - 1, z) ? SUGAR_CANE : null;
};

// Snow on snow: another layer (clicking the top), up to a full block.
for (let n = 1; n < 8; n++) {
  blockUse[SNOW_LAYER + n - 1] = (ctx) => {
    if (ctx.stack?.id !== SNOW_LAYER || !ctx.normal || ctx.normal[1] !== 1) return false;
    if (!ctx.world.setBlock(ctx.x, ctx.y, ctx.z, ctx.id + 1)) return false;
    ctx.audio?.playPlace?.("cloth");
    useItem(ctx, false);
    return true;
  };
}
// Shears carve a pumpkin (the face toward the side clicked, or toward the
// player on its top) and give 4 seeds.
blockUse[PUMPKIN] = (ctx) => {
  if (ctx.stack?.id !== ID.SHEARS && !isShears(ctx.info?.tool)) return false;
  const n = ctx.normal || [0, 0, 0];
  const k = n[1] !== 0 || (!n[0] && !n[2]) ? facingOf(-ctx.forward[0], -ctx.forward[2]) : facingOf(n[0], n[2]);
  if (!ctx.world.setBlock(ctx.x, ctx.y, ctx.z, CARVED_PUMPKIN + k)) return false;
  const [dx, dz] = FACINGS[k];
  dropAt(ctx, ctx.x + dx * 0.6, ctx.y, ctx.z + dz * 0.6, PUMPKIN_SEEDS, 4);
  ctx.audio?.playBreak?.("wood");
  useItem(ctx, true);
  return true;
};
// Redstone ore lights up when touched (and goes on with the click: a block
// in hand is still placed against it).
blockUse[REDSTONE_ORE] = (ctx) => {
  ctx.world.setBlock(ctx.x, ctx.y, ctx.z, REDSTONE_ORE + 1);
  return false;
};

// ---------- Recipes ----------

// This module's crafting and smelting (hay bales, sugar, melons, seeds, bone
// meal, bricks, clay, snow, packed ice, coarse dirt, the jack o'lantern; clay
// into bricks and terracotta, red sand into glass, the ores; saplings as
// fuel) are in js/crafting.js's core list with vanilla's values, so none are
// repeated here (a content recipe is tried first: a second copy could only
// disagree with it).
export const recipes = () => [];

// ---------- Textures ----------

const lum = (c) => (c[0] * 0.3 + c[1] * 0.59 + c[2] * 0.11) / 255;
// Repaints a tile's pixels along a new ramp by their brightness (a core
// painting in another colour: the new woods and leaves).
function recolor(t, kit, colors, lo = null, hi = null) {
  const ramp = colors.map(kit.hex);
  let a = 1;
  let b = 0;
  t.forEach((x, y) => {
    const c = t.get(x, y);
    if (c[3] < 128) return;
    a = Math.min(a, lum(c));
    b = Math.max(b, lum(c));
  });
  if (lo !== null) a = lo;
  if (hi !== null) b = hi;
  t.forEach((x, y) => {
    const c = t.get(x, y);
    if (c[3] < 128) return;
    t.set(x, y, kit.ramp(ramp, (lum(c) - a) / Math.max(1e-3, b - a)), c[3]);
  });
}
const clear = (t) => t.forEach((x, y) => t.set(x, y, [0, 0, 0], 0));
// A block of a mineral: a bevelled plate (iron, gold, diamond, copper) or a
// speckled cake (lapis, redstone, coal, emerald).
function mineralBlock(t, kit, colors, speckled) {
  const ramp = colors.map(kit.hex);
  t.forEach((x, y) => {
    let f = 0.45 + (t.fbm(x, y, 8, 2) - 0.5) * 0.35 + (t.rand() - 0.5) * 0.12;
    if (speckled) f += (t.noise(x, y, 16, 3) - 0.5) * 0.6;
    else {
      const ex = Math.min(x, 31 - x);
      const ey = Math.min(y, 31 - y);
      if (x <= 1 || y <= 1) f += 0.35;
      else if (x >= 30 || y >= 30) f -= 0.35;
      else if ((ex === 3 || ey === 3) && ex >= 3 && ey >= 3) f -= 0.12; // the inner panel's line
      if (ex > 4 && ey > 4 && (x + y) % 9 === 0) f += 0.1;
    }
    t.set(x, y, kit.ramp(ramp, f));
  });
}
function paintSapling(t, kit, leaf, bark, form) {
  clear(t);
  const L = leaf.map(kit.hex);
  const stem = kit.hex(bark);
  for (let y = 18; y < 32; y++) {
    t.set(15, y, stem);
    t.set(16, y, kit.scaleRgb(stem, 0.8));
  }
  const r = kit.makeRand(t.seed + 3);
  const blob = (cx, cy, rx, ry) => {
    for (let y = Math.floor(cy - ry); y <= cy + ry; y++) {
      for (let x = Math.floor(cx - rx); x <= cx + rx; x++) {
        const d = ((x + 0.5 - cx) / rx) ** 2 + ((y + 0.5 - cy) / ry) ** 2;
        if (d > 1 || r() < 0.15) continue;
        t.set(x, y, kit.ramp(L, 0.25 + (1 - d) * 0.45 + (y < cy ? 0.15 : 0) + r() * 0.2));
      }
    }
  };
  if (form === "cone") {
    for (let k = 0; k < 3; k++) blob(15.5, 8 + k * 5, 3 + k * 2.2, 2.6);
    blob(15.5, 4, 1.6, 2.4);
  } else if (form === "flat") {
    blob(15.5, 12, 9, 3);
    blob(10, 16, 4, 2);
    blob(21, 16, 4, 2);
  } else if (form === "tall") {
    blob(15.5, 9, 4.5, 8);
  } else if (form === "big") {
    blob(15.5, 11, 9, 7);
    blob(9, 16, 4, 3);
    blob(22, 16, 4, 3);
  } else {
    blob(15.5, 11, 7.5, 7);
  }
}
function paintCropPlant(t, kit, ripe) {
  // Leafy rows (carrots, potatoes, beetroots), with the crop showing at
  // the bottom when ripe.
  clear(t);
  const leaf = [0x1f5a17, 0x2b7322, 0x3a8c2c, 0x4ea33a, 0x66b84a].map(kit.hex);
  const r = kit.makeRand(t.seed + 9);
  for (let k = 0; k < 6; k++) {
    const x0 = 3 + k * 5 + Math.floor(r() * 2);
    const h = 14 + Math.floor(r() * 12);
    for (let i = 0; i < h; i++) {
      const y = 31 - i;
      const sway = Math.round(Math.sin(i * 0.35 + k) * 1.2);
      t.set(x0 + sway, y, kit.ramp(leaf, 0.2 + (i / h) * 0.6));
      if (i > 4 && i % 3 === 0) {
        t.set(x0 + sway - 1, y, kit.ramp(leaf, 0.5));
        t.set(x0 + sway + 1, y - 1, kit.ramp(leaf, 0.7));
      }
      if (ripe === "beet" && i < 8) t.set(x0 + sway, y, kit.hex(0x9e1b3a));
    }
  }
  if (!ripe) return;
  const col = ripe === "carrot" ? [0xb5520f, 0xe57a1e, 0xffa040] : ripe === "potato" ? [0x8a6a2a, 0xc09a4a, 0xdcbc6a] : [0x5e0b22, 0x8e1638, 0xbe2a50];
  for (let k = 0; k < 5; k++) {
    const cx = 4 + k * 6;
    for (let dy = 0; dy < 4; dy++) {
      for (let dx = -2; dx <= 2; dx++) {
        if (Math.abs(dx) + dy > 3) continue;
        t.set(cx + dx, 31 - dy, kit.hex(col[dx < 0 ? 2 : dy === 0 ? 0 : 1]));
      }
    }
  }
}
function paintPumpkinSide(t, kit, rough = 0) {
  const ramp = [0x8a4a0a, 0xb0620e, 0xcf7a14, 0xe0901c, 0xeea32a].map(kit.hex);
  t.forEach((x, y) => {
    const rib = Math.abs(((x + 2) % 8) - 4) / 4; // 0 in the groove, 1 on the rib
    let f = 0.3 + rib * 0.45 + (t.fbm(x, y, 4, 2) - 0.5) * 0.25 + (t.rand() - 0.5) * 0.08 - rough;
    if (y === 0 || y === 31) f -= 0.2;
    t.set(x, y, kit.ramp(ramp, f));
  });
}
function paintPumpkinFace(t, kit, lit) {
  paintPumpkinSide(t, kit);
  const hole = lit ? [0xffd24a, 0xfff08a] : [0x2a1404, 0x3a1e08];
  const fill = (pts) => {
    t.forEach((x, y) => {
      let inside = false;
      for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
        const [xi, yi] = pts[i];
        const [xj, yj] = pts[j];
        if (yi > y + 0.5 !== yj > y + 0.5 && x + 0.5 < ((xj - xi) * (y + 0.5 - yi)) / (yj - yi) + xi) inside = !inside;
      }
      if (inside) t.set(x, y, kit.hex(hole[(x + y) % 5 === 0 ? 1 : 0]));
    });
  };
  fill([[6, 13], [10, 7], [14, 13]]); // the eyes
  fill([[18, 13], [22, 7], [26, 13]]);
  fill([[5, 18], [27, 18], [24, 25], [20, 22], [16, 26], [12, 22], [8, 25]]); // the grin
}
function paintMelon(t, kit, top) {
  const ramp = [0x2f5a10, 0x3d7316, 0x4d8a1c, 0x5f9e24, 0x76b32e].map(kit.hex);
  t.forEach((x, y) => {
    const stripe = top ? Math.abs(Math.sin(Math.atan2(y - 15.5, x - 15.5) * 6)) : Math.abs(Math.sin((x + t.noise(x, y, 4, 1) * 3) * 0.55));
    const f = 0.2 + stripe * 0.55 + (t.rand() - 0.5) * 0.15;
    t.set(x, y, kit.ramp(ramp, f));
  });
  if (top) for (let k = 0; k < 4; k++) t.set(15 + (k & 1), 15 + (k >> 1), kit.hex(0x5a4a1a));
}
function paintMushroom(t, kit, red) {
  clear(t);
  const stem = [0xc9bfa6, 0xe0d8c2].map(kit.hex);
  for (let y = 20; y < 32; y++) for (let x = 14; x <= 17; x++) t.set(x, y, stem[x < 16 ? 1 : 0]);
  const cap = red ? [0x8a1010, 0xc41f1f, 0xe8403a].map(kit.hex) : [0x6e4a30, 0x8f6644, 0xa98060].map(kit.hex);
  for (let y = 12; y < 21; y++) {
    const w = red ? 8 - Math.abs(y - 16) * 0.6 : 10 - Math.max(0, 16 - y) * 1.4;
    for (let x = Math.round(16 - w); x < 16 + w; x++) t.set(x, y, cap[y < 15 ? 2 : y > 18 ? 0 : 1]);
  }
  if (red) for (const [x, y] of [[11, 15], [16, 13], [20, 16], [14, 18], [19, 19]]) t.set(x, y, kit.hex(0xf4f0e8));
}
function paintStraw(t, kit, top) {
  const ramp = [0x8a6a10, 0xa8861a, 0xc4a228, 0xdabc3c, 0xead058].map(kit.hex);
  t.forEach((x, y) => {
    let f;
    if (top) {
      const a = Math.atan2(y - 15.5, x - 15.5);
      const d = Math.hypot(x - 15.5, y - 15.5);
      f = 0.35 + Math.sin(a * 7 + d * 0.9) * 0.25 + (t.rand() - 0.5) * 0.3;
    } else {
      f = 0.35 + (t.noise(x, y, 32, 2, 2) - 0.5) * 0.7 + (t.rand() - 0.5) * 0.15;
      if (y === 6 || y === 7 || y === 24 || y === 25) {
        t.set(x, y, kit.hex(y % 2 ? 0x5e2a10 : 0x7a3a18)); // the bands
        return;
      }
    }
    t.set(x, y, kit.ramp(ramp, f));
  });
}
function paintSoil(t, kit, colors, specks) {
  const ramp = colors.map(kit.hex);
  t.forEach((x, y) => t.set(x, y, kit.ramp(ramp, t.fbm(x, y, 4, 3) * 0.7 + t.rand() * 0.3)));
  for (let i = 0; i < specks.n; i++) t.set(Math.floor(t.rand() * 32), Math.floor(t.rand() * 32), kit.hex(specks.colors[i % specks.colors.length]));
}
function paintSoilSide(t, kit, colors, depth) {
  kit.base("dirt", t);
  const ramp = colors.map(kit.hex);
  for (let x = 0; x < 32; x++) {
    const d = depth + Math.floor(t.noise(x, 0, 8, 5) * 3) + (t.rand() < 0.2 ? 2 : 0);
    for (let y = 0; y < d; y++) t.set(x, y, kit.ramp(ramp, 0.3 + t.rand() * 0.5 - (y === d - 1 ? 0.25 : 0)));
  }
}
function paintFlames(t, kit) {
  clear(t);
  const ramp = [0x8a1a04, 0xc83a08, 0xf06a10, 0xffa424, 0xffd65a, 0xfff6c0].map(kit.hex);
  for (let x = 0; x < 32; x++) {
    const h = 10 + t.noise(x, 0, 6, 1) * 14 + t.noise(x, 0, 16, 2) * 6;
    for (let y = 0; y < 32; y++) {
      const up = 31 - y; // height above the bottom
      if (up > h) continue;
      const tongue = t.noise(x, y, 8, 3, 4);
      if (up > h * 0.6 && tongue < 0.35) continue;
      const f = 1 - up / h + (tongue - 0.5) * 0.3;
      t.set(x, y, kit.ramp(ramp, f + 0.1));
    }
  }
}

export const tiles = {
  redstone_ore: (t, kit) => kit.ore(t, [0x8a0b0b, 0xd41c1c, 0xff6a5a]),
  lapis_ore: (t, kit) => kit.ore(t, [0x13307a, 0x1f4fbf, 0x5f8ff0]),
  emerald_ore: (t, kit) => kit.ore(t, [0x0b6b2e, 0x17b04a, 0x7ef09f]),
  copper_ore: (t, kit) => kit.ore(t, [0x8f4a25, 0xd27a45, 0x6fc49e]),
  iron_block: (t, kit) => mineralBlock(t, kit, [0x8f949a, 0xb4b9bf, 0xd4d8dc, 0xe8ebee, 0xf8f9fa], false),
  gold_block: (t, kit) => mineralBlock(t, kit, [0xb07a12, 0xd8a420, 0xf2c83a, 0xfde068, 0xfff2a8], false),
  diamond_block: (t, kit) => mineralBlock(t, kit, [0x1f9aa2, 0x3fc6cc, 0x6ae0e2, 0x9ef2f2, 0xd8ffff], false),
  emerald_block: (t, kit) => mineralBlock(t, kit, [0x0b6b2e, 0x14954a, 0x22b85e, 0x4fd882, 0x8ef2b0], true),
  lapis_block: (t, kit) => mineralBlock(t, kit, [0x10286a, 0x173a92, 0x1f4fbf, 0x3366d8, 0x5a88ee], true),
  redstone_block: (t, kit) => mineralBlock(t, kit, [0x6a0606, 0x980c0c, 0xc01414, 0xe02a22, 0xff5a44], true),
  coal_block: (t, kit) => mineralBlock(t, kit, [0x0e0e10, 0x18181c, 0x222228, 0x2e2e36, 0x40404a], true),
  copper_block: (t, kit) => mineralBlock(t, kit, [0x8a4426, 0xb05e34, 0xc87444, 0xe08c58, 0xf0a878], false),
  lava: (t, kit) => {
    // (darker than it looks: it is drawn glowing, which brightens it a lot)
    const ramp = [0x561000, 0x8a2200, 0xb83a00, 0xd85808, 0xec7812, 0xf89a26, 0xffc04e].map(kit.hex);
    t.forEach((x, y) => {
      let f = t.fbm(x, y, 4, 3) * 0.8 + t.noise(x, y, 8, 2) * 0.3 - 0.05;
      if (t.noise(x, y, 4, 7) < 0.28) f -= 0.45; // the darker crust drifting on it
      t.set(x, y, kit.ramp(ramp, f));
    });
  },
  obsidian: (t, kit) => {
    const ramp = [0x0a0710, 0x120c1c, 0x1a1228, 0x261a3a, 0x3a2a56, 0x5a4680].map(kit.hex);
    t.forEach((x, y) => {
      let f = t.fbm(x, y, 4, 3) * 0.55 + t.rand() * 0.15;
      if (t.noise(x, y, 8, 4) > 0.72) f += 0.4; // purple glints
      t.set(x, y, kit.ramp(ramp, f));
    });
  },
  fire: paintFlames,
  clay: (t, kit) => paintSoil(t, kit, [0x868b9b, 0x949aaa, 0xa0a5b5, 0xabb0bf, 0xb6bbc8], { n: 8, colors: [0x7a7f8e] }),
  red_sand: (t, kit) => {
    kit.base("sand", t);
    recolor(t, kit, [0x96440f, 0xaa5418, 0xbc6422, 0xca722c, 0xd68038, 0xe09048]);
  },
  ice: (t, kit) => {
    const ramp = [0x6f9ad8, 0x80a8e2, 0x92b8ec, 0xa6c8f2, 0xbcd8f8].map(kit.hex);
    t.forEach((x, y) => {
      let f = 0.35 + (t.fbm(x, y, 2, 2) - 0.5) * 0.5;
      if (Math.abs(((x + y * 0.6 + t.noise(x, y, 4, 2) * 6) % 13) - 6) < 0.6) f += 0.45; // cracks catching the light
      t.set(x, y, kit.ramp(ramp, f));
    });
  },
  farmland_dry: (t, kit) => {
    kit.base("dirt", t);
    t.forEach((x, y) => {
      if (y % 4 === 3) t.shade(x, y, 0.62); // the furrows
      else if (y % 4 === 0) t.shade(x, y, 1.12);
    });
  },
  farmland_wet: (t, kit) => {
    kit.base("dirt", t);
    t.forEach((x, y) => t.shade(x, y, y % 4 === 3 ? 0.36 : y % 4 === 0 ? 0.62 : 0.55));
  },
  wheat_green: (t, kit) => {
    clear(t);
    const ramp = [0x2f5a14, 0x3f741a, 0x548f22, 0x6aa82c, 0x86c03a].map(kit.hex);
    for (let k = 0; k < 8; k++) {
      const x0 = 2 + k * 4;
      const h = 22 + ((k * 7) % 9);
      for (let i = 0; i < h; i++) {
        const x = x0 + Math.round(Math.sin(i * 0.2 + k) * 0.8);
        t.set(x, 31 - i, kit.ramp(ramp, 0.2 + (i / h) * 0.7));
        if (i > 6 && i % 5 === 0) t.set(x + (k % 2 ? 1 : -1), 31 - i, kit.ramp(ramp, 0.6));
      }
    }
  },
  wheat_ripe: (t, kit) => {
    clear(t);
    const stalk = [0x8a6a14, 0xa8861e, 0xc4a22c].map(kit.hex);
    const head = [0x9c7414, 0xc8981e, 0xe8bc3a, 0xf8d860].map(kit.hex);
    for (let k = 0; k < 8; k++) {
      const x0 = 2 + k * 4;
      const h = 24 + ((k * 7) % 7);
      for (let i = 0; i < h; i++) {
        const x = x0 + Math.round(Math.sin(i * 0.2 + k) * 0.8);
        const y = 31 - i;
        if (i > h - 9) {
          t.set(x, y, head[(i + k) % 2 ? 2 : 1]);
          t.set(x - 1, y, head[i % 3 === 0 ? 3 : 0]);
          if (i % 2) t.set(x + 1, y, head[1]);
        } else t.set(x, y, stalk[i % 3 === 0 ? 0 : 1]);
      }
    }
  },
  crop_leafy: (t, kit) => paintCropPlant(t, kit, null),
  carrots_ripe: (t, kit) => paintCropPlant(t, kit, "carrot"),
  potatoes_ripe: (t, kit) => paintCropPlant(t, kit, "potato"),
  beetroots_ripe: (t, kit) => paintCropPlant(t, kit, "beet"),
  sugar_cane: (t, kit) => {
    clear(t);
    const ramp = [0x5a8a2a, 0x74a834, 0x8cc040, 0xa4d452].map(kit.hex);
    for (const x0 of [6, 15, 24]) {
      for (let y = 0; y < 32; y++) {
        const node = y % 8 === 2;
        t.set(x0, y, node ? kit.hex(0x4a7020) : ramp[2]);
        t.set(x0 + 1, y, node ? kit.hex(0x3e601a) : ramp[1]);
        t.set(x0 - 1, y, ramp[3]);
      }
      for (let i = 0; i < 6; i++) t.set(x0 + 2 + (i >> 1), 10 + i, ramp[0]);
    }
  },
  pumpkin_side: (t, kit) => paintPumpkinSide(t, kit),
  pumpkin_top: (t, kit) => {
    paintPumpkinSide(t, kit, 0.05);
    t.forEach((x, y) => {
      const d = Math.hypot(x - 15.5, y - 15.5);
      if (d < 3) t.set(x, y, kit.hex(d < 1.5 ? 0x6a8a2a : 0x4a3a12));
      else if (Math.abs(Math.sin(Math.atan2(y - 15.5, x - 15.5) * 4)) < 0.15) t.shade(x, y, 0.8);
    });
  },
  carved_pumpkin: (t, kit) => paintPumpkinFace(t, kit, false),
  jack_o_lantern: (t, kit) => paintPumpkinFace(t, kit, true),
  melon_side: (t, kit) => paintMelon(t, kit, false),
  melon_top: (t, kit) => paintMelon(t, kit, true),
  stem: (t, kit) => {
    clear(t);
    const ramp = [0x4a7a1a, 0x5f9422, 0x76aa2e].map(kit.hex);
    for (let y = 0; y < 32; y++) {
      const x = 15 + Math.round(Math.sin(y * 0.4) * 1.5);
      t.set(x, y, ramp[1]);
      t.set(x + 1, y, ramp[0]);
      if (y % 7 === 3) {
        t.set(x - 1, y, ramp[2]);
        t.set(x - 2, y - 1, ramp[2]);
        t.set(x + 2, y + 1, ramp[2]);
      }
    }
  },
  oak_sapling: (t, kit) => paintSapling(t, kit, [0x1f5a17, 0x2e7a22, 0x46a034, 0x66bc4c], 0x6b4726, "round"),
  spruce_sapling: (t, kit) => paintSapling(t, kit, [0x0f2f25, 0x1e5139, 0x2a6648, 0x3c7c58], 0x4d3122, "cone"),
  birch_sapling: (t, kit) => paintSapling(t, kit, [0x3f6a1f, 0x5a8a2c, 0x76a83a, 0x9ac25a], 0xd8d3c8, "tall"),
  jungle_sapling: (t, kit) => paintSapling(t, kit, [0x1a6a14, 0x2a8a1e, 0x40a82c, 0x5cc040], 0x5a4a26, "big"),
  acacia_sapling: (t, kit) => paintSapling(t, kit, [0x4a5a1c, 0x627424, 0x7a8e2e, 0x94a83c], 0x6a6258, "flat"),
  dark_oak_sapling: (t, kit) => paintSapling(t, kit, [0x12380e, 0x1c4a14, 0x285e1c, 0x387428], 0x3a2814, "round"),
  jungle_log: (t, kit) => {
    kit.base("wood_side", t);
    recolor(t, kit, [0x3a2a12, 0x4f3c1a, 0x645022, 0x56602a, 0x7a6a34, 0x8f7c40]);
  },
  jungle_log_top: (t, kit) => {
    kit.base("wood_top", t);
    recolor(t, kit, [0x4a3418, 0x7a5a2e, 0x9a7a44, 0xb59456, 0xc8a868]);
  },
  acacia_log: (t, kit) => {
    kit.base("wood_side", t);
    recolor(t, kit, [0x3c3833, 0x504b44, 0x625c54, 0x746d64, 0x878076]);
  },
  acacia_log_top: (t, kit) => {
    kit.base("wood_top", t);
    recolor(t, kit, [0x5e2e14, 0x8c4420, 0xae5a2c, 0xc8703a, 0xd88648]);
  },
  dark_oak_log: (t, kit) => {
    kit.base("wood_side", t);
    recolor(t, kit, [0x1e140a, 0x2c1e10, 0x3a2816, 0x48331c, 0x584022]);
  },
  dark_oak_log_top: (t, kit) => {
    kit.base("wood_top", t);
    recolor(t, kit, [0x2c1e10, 0x4a3420, 0x5e442a, 0x725434, 0x86643e]);
  },
  jungle_leaves: (t, kit) => {
    kit.base("leaves", t);
    recolor(t, kit, [0x154a10, 0x1e6216, 0x2a7c1e, 0x389628, 0x4aae34, 0x62c444]);
  },
  acacia_leaves: (t, kit) => {
    kit.base("leaves", t);
    recolor(t, kit, [0x343e14, 0x45521a, 0x586a22, 0x6c802c, 0x809638, 0x96aa48]);
  },
  dark_oak_leaves: (t, kit) => {
    kit.base("leaves", t);
    recolor(t, kit, [0x0e2a0a, 0x15380f, 0x1e4816, 0x285a1e, 0x346c28, 0x447e34]);
  },
  brown_mushroom: (t, kit) => paintMushroom(t, kit, false),
  red_mushroom: (t, kit) => paintMushroom(t, kit, true),
  blue_orchid: (t, kit) => kit.flower(t, [0x1b5a9e, 0x2e86d8, 0x7cc4ff, 0x9fe0ff]),
  allium: (t, kit) => kit.flower(t, [0x6a2a8e, 0x9b4fc4, 0xd09cf0, 0xb070e0]),
  azure_bluet: (t, kit) => kit.flower(t, [0xa9b2b8, 0xdce2e6, 0xffffff, 0xf2d23a]),
  red_tulip: (t, kit) => kit.flower(t, [0x7e1010, 0xc82424, 0xff6a5a, 0xa01818]),
  orange_tulip: (t, kit) => kit.flower(t, [0x9a3e08, 0xe0701a, 0xffb05a, 0xc85a10]),
  white_tulip: (t, kit) => kit.flower(t, [0xa0a4a0, 0xe0e4e0, 0xffffff, 0xc8d0c8]),
  pink_tulip: (t, kit) => kit.flower(t, [0xa04a6a, 0xe08aa8, 0xffc4d8, 0xc86a90]),
  oxeye_daisy: (t, kit) => kit.flower(t, [0xb8b8b0, 0xecece4, 0xffffff, 0xf2c230]),
  cornflower: (t, kit) => kit.flower(t, [0x22368a, 0x3e5ad8, 0x7a98ff, 0x2a3f9e]),
  lily_of_the_valley: (t, kit) => kit.flower(t, [0xc0c4bc, 0xeef0ea, 0xffffff, 0xe8f0e0]),
  vine: (t, kit) => {
    clear(t);
    const ramp = [0x1a4a12, 0x24601a, 0x2e7622, 0x3a8c2c].map(kit.hex);
    t.forEach((x, y) => {
      const v = t.noise(x, y, 8, 1);
      if (v > 0.52 || (x % 11 === 3 && t.noise(x, y, 4, 2) > 0.3)) t.set(x, y, kit.ramp(ramp, v + (t.rand() - 0.5) * 0.3));
    });
  },
  cobweb: (t, kit) => {
    clear(t);
    const c = kit.hex(0xe8e8ec);
    t.forEach((x, y) => {
      const dx = x - 15.5;
      const dy = y - 15.5;
      const a = Math.atan2(dy, dx);
      const d = Math.hypot(dx, dy);
      const spoke = Math.abs(Math.sin(a * 4)) < 0.08;
      const ring = Math.abs((d % 5) - 2.5) < 0.45 && d < 15;
      if (spoke || ring) t.set(x, y, c, 220);
    });
  },
  podzol_top: (t, kit) => paintSoil(t, kit, [0x4a2e12, 0x5e3c18, 0x704a20, 0x825a2a, 0x946a34], { n: 40, colors: [0x9a7a3a, 0x3a240e, 0xa8884a] }),
  podzol_side: (t, kit) => paintSoilSide(t, kit, [0x4a2e12, 0x5e3c18, 0x704a20, 0x825a2a], 4),
  mycelium_top: (t, kit) => paintSoil(t, kit, [0x5e5260, 0x6e6070, 0x7c6e80, 0x8a7c8e, 0x9a8c9c], { n: 30, colors: [0xb8acc0, 0x4a3e4e] }),
  coarse_dirt: (t, kit) => {
    kit.base("dirt", t);
    for (let i = 0; i < 70; i++) t.set(Math.floor(t.rand() * 32), Math.floor(t.rand() * 32), kit.hex(i % 3 ? 0x6a5a4a : 0x8a7a68));
  },
  dirt_path_top: (t, kit) => paintSoil(t, kit, [0x7a5c30, 0x8a6a3a, 0x9a7a45, 0xa8884f, 0xb5955a], { n: 20, colors: [0x6a4e28, 0xc0a068] }),
  hay_side: (t, kit) => paintStraw(t, kit, false),
  hay_top: (t, kit) => paintStraw(t, kit, true),
};
export const tileRelief = {
  lava: [0.8, 0.5, 1],
  obsidian: [2.0, 0.25, 1],
  ice: [0.8, 0.12, 1],
  iron_block: [1.6, 0.35, 1],
  gold_block: [1.6, 0.3, 1],
  diamond_block: [1.6, 0.25, 1],
  copper_block: [1.6, 0.35, 1],
};

// ---------- Item icons ----------

const ICON = {
  seed: [0x4a4a14, 0x6e6a1e, 0x949028, 0xb8b23a, 0xdcd65a],
  wheat: [0x8a6410, 0xb48a1c, 0xd8ac30, 0xf0cc50, 0xfff0a0],
  beet: [0x4a0614, 0x780e22, 0xa41a36, 0xcc3250, 0xee6a80],
  carrot: [0x8a3a06, 0xc0580e, 0xe8781e, 0xffa040, 0xffd090],
  potato: [0x6a4a1a, 0x94702a, 0xbc963e, 0xd8b45a, 0xf0d488],
  poison: [0x3e4a12, 0x5a6a1a, 0x78882a, 0x98a63e, 0xc0c860],
  melon: [0x9a1410, 0xc8241c, 0xec4434, 0xff7a64, 0xffb0a0],
  rind: [0x1e4a0e, 0x2e6a16, 0x449222, 0x6ab838, 0xa8e070],
  white: [0x9a9aa4, 0xbcbcc4, 0xdadae0, 0xf0f0f4, 0xffffff],
  clay: [0x5e6474, 0x7a8090, 0x989eac, 0xb4b9c6, 0xd2d6e0],
  brick: [0x5a2014, 0x7e2e1c, 0xa04028, 0xbe5638, 0xd8785a],
  leaf: [0x1f5a17, 0x2f7d22, 0x46a034, 0x6cc24c, 0x9be07a],
  snow: [0xa8b8c4, 0xc8d4dc, 0xe0e8ee, 0xf2f6f8, 0xffffff],
  cocoa: [0x2e1608, 0x4a2410, 0x6a3618, 0x8a4a22, 0xaa6232],
};
const ramps = (...names) => names.map((n) => ICON[n].map((h) => [(h >> 16) & 255, (h >> 8) & 255, h & 255]));
function seedsIcon(kit, color) {
  const c = new kit.Canvas();
  for (const [x, y, a] of [[10, 12, 0.4], [18, 9, -0.5], [21, 18, 0.2], [12, 21, -0.3], [16, 15, 0.9], [24, 24, 0.6]]) {
    c.poly(0, [[x - 2 * Math.cos(a), y - 2 * Math.sin(a) - 1], [x + 2.5 * Math.cos(a), y + 2.5 * Math.sin(a)], [x - 2 * Math.cos(a), y - 2 * Math.sin(a) + 2]], () => 0.2);
    c.disc(0, x, y, 2, 1.6);
  }
  return c.render(ramps(color));
}
export const icons = {
  wheat_seeds: (kit) => seedsIcon(kit, "seed"),
  beetroot_seeds: (kit) => seedsIcon(kit, "beet"),
  melon_seeds: (kit) => seedsIcon(kit, "cocoa"),
  pumpkin_seeds: (kit) => seedsIcon(kit, "white"),
  wheat: (kit) => {
    const c = new kit.Canvas();
    for (const [x0, x1] of [[9, 14], [16, 16], [23, 18]]) {
      c.line(0, x0 - 2, 29, x1, 6, 1.6);
      for (let k = 0; k < 4; k++) c.disc(0, x0 + (x1 - x0) * (0.55 + k * 0.12) - 2 * (1 - 0.55 - k * 0.12), 16 - k * 3.2, 2, 1.4, () => 0.4);
    }
    return c.render(ramps("wheat"));
  },
  beetroot: (kit) => {
    const c = new kit.Canvas();
    c.disc(0, 16, 19, 8, 8);
    c.poly(0, [[12, 24], [20, 24], [16, 31]]);
    c.line(1, 16, 12, 12, 3, 2.4);
    c.line(1, 16, 12, 20, 3, 2.4);
    return c.render(ramps("beet", "leaf"));
  },
  carrot: (kit) => {
    const c = new kit.Canvas();
    c.poly(0, [[19, 8], [25, 13], [7, 28]], (x, y) => ((x + y) % 5 === 0 ? -0.5 : 0.2));
    c.line(1, 22, 9, 27, 3, 2);
    c.line(1, 22, 9, 25, 2, 2);
    c.line(1, 22, 9, 29, 6, 2);
    return c.render(ramps("carrot", "leaf"));
  },
  potato: (kit) => {
    const c = new kit.Canvas();
    c.disc(0, 16, 17, 10, 7.5, (x, y) => (Math.hypot(x - 12, y - 14) < 1.2 || Math.hypot(x - 20, y - 19) < 1.2 ? -0.8 : 0));
    return c.render(ramps("potato"));
  },
  poisonous_potato: (kit) => {
    const c = new kit.Canvas();
    c.disc(0, 16, 17, 10, 7.5, (x, y) => (Math.hypot(x - 12, y - 14) < 1.4 || Math.hypot(x - 20, y - 19) < 1.4 ? -0.9 : 0));
    return c.render(ramps("poison"));
  },
  melon_slice: (kit) => {
    const c = new kit.Canvas();
    c.poly(1, [[4, 24], [28, 24], [16, 6]]);
    c.poly(0, [[7, 22], [25, 22], [16, 9]], (x, y) => ((x * 7 + y * 3) % 11 === 0 ? -1 : 0.1));
    return c.render(ramps("melon", "rind"));
  },
  sugar: (kit) => {
    const c = new kit.Canvas();
    c.poly(0, [[5, 26], [27, 26], [20, 16], [12, 15]], (x, y) => ((x + y * 3) % 4 === 0 ? 0.6 : -0.1));
    return c.render(ramps("white"));
  },
  bone_meal: (kit) => {
    const c = new kit.Canvas();
    c.poly(0, [[4, 27], [28, 27], [22, 16], [15, 12], [9, 17]], (x, y) => ((x * 3 + y) % 5 === 0 ? 0.6 : 0));
    return c.render(ramps("white"));
  },
  clay_ball: (kit) => {
    const c = new kit.Canvas();
    c.disc(0, 16, 17, 10, 9, (x, y) => -((x - 16) + (y - 17)) / 30);
    return c.render(ramps("clay"));
  },
  brick: (kit) => {
    const c = new kit.Canvas();
    c.poly(0, [[3, 18], [19, 10], [29, 15], [13, 23]], () => 0.3);
    c.poly(0, [[3, 18], [13, 23], [13, 27], [3, 22]], () => -0.4);
    c.poly(0, [[13, 23], [29, 15], [29, 19], [13, 27]], () => -0.1);
    return c.render(ramps("brick"));
  },
  snowball: (kit) => {
    const c = new kit.Canvas();
    c.disc(0, 16, 16, 10, 10, (x, y) => -((x - 16) + (y - 16)) / 26);
    return c.render(ramps("snow"));
  },
  cocoa_beans: (kit) => {
    const c = new kit.Canvas();
    c.disc(0, 12, 18, 6, 4.5);
    c.disc(0, 20, 13, 6, 4.5);
    c.line(0, 8, 18, 16, 18, 0.8, () => -1);
    c.line(0, 16, 13, 24, 13, 0.8, () => -1);
    return c.render(ramps("cocoa"));
  },
};
