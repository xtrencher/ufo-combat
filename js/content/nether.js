// The Nether (Round 12): its blocks and items, as vanilla Java 1.20's.
// Ids: blocks 2304-2559, items 768-863 (./ids.js). What a content module may
// export, and its rules: see ./index.js. (It also uses building.js's
// addFamily for its stairs, slabs, fences, gates and walls: the very same
// shapes and behaviour as the Overworld's.)
//
// - The ground: netherrack (fire on it never goes out: `infiniburn`, js/nature-sim.js),
//   soul sand (14/16 high, slows whoever walks on it: `speedFactor`, js/player.js),
//   soul soil, glowstone (2-4 dust), nether quartz ore (quartz, 2-5 XP), nether
//   gold ore (2-6 nuggets), ancient debris (diamond pickaxe, blast proof;
//   smelted into netherite scrap), the magma block (`hotFloor`: it hurts
//   whoever stands on it without sneaking), basalt, blackstone and their
//   polished and brick kinds, bone blocks.
// - The forests: crimson and warped nylium (netherrack without silk touch;
//   back to netherrack under an opaque block), stems, hyphae and their
//   stripped kinds (an axe strips them), planks, fungi (bone meal on their
//   own nylium grows a huge fungus: js/dim-nether.js hugeFungus), roots,
//   nether sprouts (shears), wart blocks, shroomlight, weeping vines (hang,
//   grow down) and twisting vines (stand, grow up); both climbable.
// - Nether wart: planted on soul sand, 4 ages, grows on random ticks (one in
//   ten, vanilla), 2-4 when ripe; the brewing stand's base (js/brewing.js).
// - The nether portal block (2 ids, its plane's axis): purple, thin, light
//   11, no collision; js/portal.js lights it in an obsidian frame, breaks it
//   with its frame and sends whoever stands in it through. Crying obsidian.
//   The respawn anchor (charged with glowstone, sets the spawn in the Nether,
//   explodes elsewhere: js/portal.js through LIB.useRespawnAnchor).
// - Soul fire: blue, on soul sand and soil only (what is lit there turns into
//   it: js/portal.js), never spreads, burns harder (2).
// - Quartz blocks, nether bricks (and red), the blaze spawner (structures.js
//   runs it), the smithing table (a right click with a diamond tool or piece
//   of armor in hand and a netherite upgrade template and a netherite ingot
//   in the inventory makes it netherite, enchantments and wear kept: the
//   vanilla smithing screen is not built), netherite gear.
// - Items: quartz, glowstone dust, blaze rods and powder, ghast tears, magma
//   cream (the creatures' drops: js/mobs.js), nether bricks, netherite scrap
//   and ingots, the fire charge (lights a fire like flint and steel, used up),
//   the netherite upgrade template, the awkward, mundane and thick potions.
// Deviations: basalt and stems stand one way only (the game's logs too);
// the wooden nether things are not flammable (vanilla) and are no fuel; no
// crimson/warped doors, trapdoors, buttons, signs or pressure plates; no
// soul torches, lanterns or campfires.
import { BLOCK, ITEM, RENDER, FACE, LIB } from "./base.js";
import * as I from "./ids.js";
import * as building from "./building.js";

const {
  NETHERRACK, SOUL_SAND, SOUL_SOIL, GLOWSTONE, NETHER_QUARTZ_ORE, NETHER_GOLD_ORE, ANCIENT_DEBRIS, MAGMA_BLOCK,
  BASALT, POLISHED_BASALT, SMOOTH_BASALT, BLACKSTONE, GILDED_BLACKSTONE, POLISHED_BLACKSTONE, POLISHED_BLACKSTONE_BRICKS,
  CRACKED_POLISHED_BLACKSTONE_BRICKS, CHISELED_POLISHED_BLACKSTONE, NETHER_BRICKS, CRACKED_NETHER_BRICKS, CHISELED_NETHER_BRICKS,
  RED_NETHER_BRICKS, NETHER_WART, CRIMSON_NYLIUM, WARPED_NYLIUM, CRIMSON_STEM, WARPED_STEM, STRIPPED_CRIMSON_STEM,
  STRIPPED_WARPED_STEM, CRIMSON_HYPHAE, WARPED_HYPHAE, CRIMSON_PLANKS, WARPED_PLANKS, CRIMSON_FUNGUS, WARPED_FUNGUS,
  CRIMSON_ROOTS, WARPED_ROOTS, NETHER_SPROUTS, NETHER_WART_BLOCK, WARPED_WART_BLOCK, SHROOMLIGHT, WEEPING_VINES,
  TWISTING_VINES, CRYING_OBSIDIAN, RESPAWN_ANCHOR, NETHER_PORTAL, QUARTZ_BLOCK, CHISELED_QUARTZ_BLOCK, QUARTZ_PILLAR,
  QUARTZ_BRICKS, SMOOTH_QUARTZ, NETHERITE_BLOCK, SOUL_FIRE, BONE_BLOCK, BLAZE_SPAWNER, SMITHING_TABLE,
  QUARTZ, GLOWSTONE_DUST, BLAZE_ROD, BLAZE_POWDER, GHAST_TEAR, MAGMA_CREAM, NETHER_BRICK, NETHERITE_SCRAP,
  NETHERITE_INGOT, NETHERITE_SWORD, NETHERITE_PICKAXE, NETHERITE_AXE, NETHERITE_SHOVEL, NETHERITE_HOE,
  NETHERITE_HELMET, NETHERITE_CHESTPLATE, NETHERITE_LEGGINGS, NETHERITE_BOOTS, FIRE_CHARGE, NETHERITE_UPGRADE,
  AWKWARD_POTION, MUNDANE_POTION, THICK_POTION,
} = I;

export const NETHER_WART_AGES = 4;
export const RESPAWN_ANCHOR_CHARGES = 4;
export const isNetherWart = (id) => id >= NETHER_WART && id < NETHER_WART + NETHER_WART_AGES;
export const isNetherPortal = (id) => id === NETHER_PORTAL || id === NETHER_PORTAL + 1;
export const isRespawnAnchor = (id) => id >= RESPAWN_ANCHOR && id <= RESPAWN_ANCHOR + RESPAWN_ANCHOR_CHARGES;
export const anchorCharge = (id) => (isRespawnAnchor(id) ? id - RESPAWN_ANCHOR : -1);
export const isWeepingVines = (id) => id === WEEPING_VINES || id === WEEPING_VINES + 1;
export const isTwistingVines = (id) => id === TWISTING_VINES || id === TWISTING_VINES + 1;
// Soul fire's ground (vanilla's soul_fire_base_blocks).
export const isSoulFireBase = (id) => id === SOUL_SAND || id === SOUL_SOIL;
export const NYLIUMS = [CRIMSON_NYLIUM, WARPED_NYLIUM];
// The Overworld's planks and the Nether's: "any planks" in the recipes below
// (the core recipes' list leaves out the Nether's: they are no fuel).
const ALL_PLANKS = [BLOCK.PLANKS, I.SPRUCE_PLANKS, I.BIRCH_PLANKS, I.JUNGLE_PLANKS, I.ACACIA_PLANKS, I.DARK_OAK_PLANKS, CRIMSON_PLANKS, WARPED_PLANKS];
const NETHER_PLANKS = [CRIMSON_PLANKS, WARPED_PLANKS];

// ---------- Helpers ----------

const between = (a, b, rand) => a + Math.floor(rand() * (b - a + 1));
// The ground a fungus, a root or sprouts stand on (vanilla's: nylium, soul
// soil, and the Overworld's soils).
const FUNGUS_SOIL = new Set([CRIMSON_NYLIUM, WARPED_NYLIUM, SOUL_SOIL, BLOCK.GRASS, BLOCK.DIRT, I.PODZOL, I.MYCELIUM, I.COARSE_DIRT, I.FARMLAND, I.FARMLAND + 1]);
const fungusSoil = (below) => FUNGUS_SOIL.has(below);
// A full, solid face (what a vine or a fire stands on).
const sturdy = (id) => LIB.IS_SOLID?.[id] === 1 && LIB.IS_OPAQUE?.[id] === 1;
// A use of the held item (none in Creative).
function useOne(ctx) {
  if (ctx.creative) return;
  ctx.inventory?.consumeSelected?.(1);
}
const SPARKLE = { r: 0.35, g: 0.9, b: 0.3 };
function sparkle(ctx, x, y, z) {
  const glow = ctx.effects?.glow;
  if (!glow) return;
  for (let k = 0; k < 8; k++) glow.spawn({ x: x + Math.random(), y: y + 0.4 + Math.random() * 0.8, z: z + Math.random(), vy: 0.4, life: 0.8, size0: 0.14, size1: 0.04, color0: SPARKLE });
}

// ---------- Blocks ----------

export const blocks = {};
const def = (id, d) => (blocks[id] = d);
const PICK = { tool: "pickaxe", minTier: 1, sound: "stone" };

// The ground.
def(NETHERRACK, { name: "Netherrack", faces: "netherrack", hardness: 0.4, ...PICK, infiniburn: true });
def(SOUL_SAND, {
  name: "Soul Sand",
  faces: "soul_sand",
  hardness: 0.5,
  tool: "shovel",
  sound: "sand",
  speedFactor: 0.4, // (vanilla: whoever walks on it, at 40%)
  collision: [[0, 0, 0, 1, 14 / 16, 1]],
});
def(SOUL_SOIL, { name: "Soul Soil", faces: "soul_soil", hardness: 0.5, tool: "shovel", sound: "sand" });
def(GLOWSTONE, { name: "Glowstone", faces: "glowstone", hardness: 0.3, sound: "glass", emission: 15, emissive: true });
def(NETHER_QUARTZ_ORE, { name: "Nether Quartz Ore", faces: "nether_quartz_ore", hardness: 3, ...PICK, xp: [2, 5], fortune: "ore" });
def(NETHER_GOLD_ORE, { name: "Nether Gold Ore", faces: "nether_gold_ore", hardness: 3, ...PICK, xp: [0, 1], fortune: "ore" });
def(ANCIENT_DEBRIS, { name: "Ancient Debris", faces: { top: "ancient_debris_top", bottom: "ancient_debris_top", side: "ancient_debris_side" }, hardness: 30, tool: "pickaxe", minTier: 4, sound: "stone", blastResistance: 1200 });
def(MAGMA_BLOCK, { name: "Magma Block", faces: "magma", hardness: 0.5, ...PICK, emission: 3, emissive: true, hotFloor: true, infiniburn: true });
def(BASALT, { name: "Basalt", faces: { top: "basalt_top", bottom: "basalt_top", side: "basalt_side" }, hardness: 1.25, ...PICK });
def(POLISHED_BASALT, { name: "Polished Basalt", faces: { top: "polished_basalt_top", bottom: "polished_basalt_top", side: "polished_basalt_side" }, hardness: 1.25, ...PICK });
def(SMOOTH_BASALT, { name: "Smooth Basalt", faces: "smooth_basalt", hardness: 1.25, ...PICK });
def(BLACKSTONE, { name: "Blackstone", faces: { top: "blackstone_top", bottom: "blackstone_top", side: "blackstone" }, hardness: 1.5, ...PICK });
def(GILDED_BLACKSTONE, { name: "Gilded Blackstone", faces: "gilded_blackstone", hardness: 1.5, ...PICK });
def(POLISHED_BLACKSTONE, { name: "Polished Blackstone", faces: "polished_blackstone", hardness: 2, ...PICK });
def(POLISHED_BLACKSTONE_BRICKS, { name: "Polished Blackstone Bricks", faces: "polished_blackstone_bricks", hardness: 1.5, ...PICK });
def(CRACKED_POLISHED_BLACKSTONE_BRICKS, { name: "Cracked Polished Blackstone Bricks", faces: "cracked_polished_blackstone_bricks", hardness: 1.5, ...PICK });
def(CHISELED_POLISHED_BLACKSTONE, { name: "Chiseled Polished Blackstone", faces: "chiseled_polished_blackstone", hardness: 1.5, ...PICK });
def(NETHER_BRICKS, { name: "Nether Bricks", faces: "nether_bricks", hardness: 2, ...PICK });
def(CRACKED_NETHER_BRICKS, { name: "Cracked Nether Bricks", faces: "cracked_nether_bricks", hardness: 2, ...PICK });
def(CHISELED_NETHER_BRICKS, { name: "Chiseled Nether Bricks", faces: "chiseled_nether_bricks", hardness: 2, ...PICK });
def(RED_NETHER_BRICKS, { name: "Red Nether Bricks", faces: "red_nether_bricks", hardness: 2, ...PICK });
def(BONE_BLOCK, { name: "Bone Block", faces: { top: "bone_block_top", bottom: "bone_block_top", side: "bone_block_side" }, hardness: 2, ...PICK });

// Nether wart: 4 ages on soul sand (the first is the item).
const WART_TILES = ["nether_wart_0", "nether_wart_1", "nether_wart_1", "nether_wart_2"];
for (let a = 0; a < NETHER_WART_AGES; a++) {
  def(NETHER_WART + a, {
    name: "Nether Wart",
    faces: WART_TILES[a],
    render: RENDER.CUTOUT,
    shape: "nether_wart",
    solid: false,
    opaque: false,
    skyPass: true,
    hardness: 0,
    sound: "plant",
    support: (below) => below === SOUL_SAND,
    box: [0, 0, 0, 1, [0.25, 0.5, 0.5, 0.875][a], 1],
    ...(a ? { item: NETHER_WART, creative: false } : {}),
  });
}

// The forests.
def(CRIMSON_NYLIUM, { name: "Crimson Nylium", faces: { top: "crimson_nylium", bottom: "netherrack", side: "crimson_nylium_side" }, hardness: 0.4, ...PICK, sound: "stone" });
def(WARPED_NYLIUM, { name: "Warped Nylium", faces: { top: "warped_nylium", bottom: "netherrack", side: "warped_nylium_side" }, hardness: 0.4, ...PICK, sound: "stone" });
const STEM = { hardness: 2, tool: "axe", sound: "wood", log: true };
def(CRIMSON_STEM, { name: "Crimson Stem", faces: { top: "crimson_stem_top", bottom: "crimson_stem_top", side: "crimson_stem" }, ...STEM, strips: STRIPPED_CRIMSON_STEM });
def(WARPED_STEM, { name: "Warped Stem", faces: { top: "warped_stem_top", bottom: "warped_stem_top", side: "warped_stem" }, ...STEM, strips: STRIPPED_WARPED_STEM });
def(STRIPPED_CRIMSON_STEM, { name: "Stripped Crimson Stem", faces: { top: "crimson_stem_top", bottom: "crimson_stem_top", side: "stripped_crimson_stem" }, ...STEM });
def(STRIPPED_WARPED_STEM, { name: "Stripped Warped Stem", faces: { top: "warped_stem_top", bottom: "warped_stem_top", side: "stripped_warped_stem" }, ...STEM });
def(CRIMSON_HYPHAE, { name: "Crimson Hyphae", faces: "crimson_stem", ...STEM, strips: STRIPPED_CRIMSON_STEM });
def(WARPED_HYPHAE, { name: "Warped Hyphae", faces: "warped_stem", ...STEM, strips: STRIPPED_WARPED_STEM });
def(CRIMSON_PLANKS, { name: "Crimson Planks", faces: "crimson_planks", hardness: 2, tool: "axe", sound: "wood" });
def(WARPED_PLANKS, { name: "Warped Planks", faces: "warped_planks", hardness: 2, tool: "axe", sound: "wood" });
const NETHER_PLANT = { render: RENDER.CUTOUT, shape: "cross", solid: false, opaque: false, skyPass: true, hardness: 0, sound: "plant" };
def(CRIMSON_FUNGUS, { name: "Crimson Fungus", faces: "crimson_fungus", ...NETHER_PLANT, support: fungusSoil });
def(WARPED_FUNGUS, { name: "Warped Fungus", faces: "warped_fungus", ...NETHER_PLANT, support: fungusSoil });
def(CRIMSON_ROOTS, { name: "Crimson Roots", faces: "crimson_roots", ...NETHER_PLANT, replaceable: true, support: fungusSoil });
def(WARPED_ROOTS, { name: "Warped Roots", faces: "warped_roots", ...NETHER_PLANT, replaceable: true, support: fungusSoil });
def(NETHER_SPROUTS, { name: "Nether Sprouts", faces: "nether_sprouts", ...NETHER_PLANT, replaceable: true, support: fungusSoil, box: [0, 0, 0, 1, 3 / 16, 1] });
def(NETHER_WART_BLOCK, { name: "Nether Wart Block", faces: "nether_wart_block", hardness: 1, tool: "hoe", sound: "grass" });
def(WARPED_WART_BLOCK, { name: "Warped Wart Block", faces: "warped_wart_block", hardness: 1, tool: "hoe", sound: "grass" });
def(SHROOMLIGHT, { name: "Shroomlight", faces: "shroomlight", hardness: 1, tool: "hoe", sound: "grass", emission: 15, emissive: true });
// Vines: the tip (it grows on), the vine behind it. Weeping vines hang from
// the block above (js/portal.js takes them down when it goes), twisting
// vines stand on the block below (the world's support rule).
const VINE_DEF = { ...NETHER_PLANT, climbable: true, box: [0.25, 0, 0.25, 0.75, 1, 0.75] };
const weepingHolds = (above) => sturdy(above) || isWeepingVines(above) || above === NETHER_WART_BLOCK || above === WARPED_WART_BLOCK;
def(WEEPING_VINES, { name: "Weeping Vines", faces: "weeping_vines", ...VINE_DEF, placeAs: (ctx) => (weepingHolds(ctx.world.getBlock(ctx.place[0], ctx.place[1] + 1, ctx.place[2])) ? WEEPING_VINES : null) });
def(WEEPING_VINES + 1, { name: "Weeping Vines", faces: "weeping_vines_plant", ...VINE_DEF, item: WEEPING_VINES, creative: false });
const twistingHolds = (below) => sturdy(below) || isTwistingVines(below);
def(TWISTING_VINES, { name: "Twisting Vines", faces: "twisting_vines", ...VINE_DEF, support: twistingHolds });
def(TWISTING_VINES + 1, { name: "Twisting Vines", faces: "twisting_vines_plant", ...VINE_DEF, support: twistingHolds, item: TWISTING_VINES, creative: false });

// Obsidian's kin.
def(CRYING_OBSIDIAN, { name: "Crying Obsidian", faces: "crying_obsidian", hardness: 50, tool: "pickaxe", minTier: 4, sound: "stone", emission: 10, emissive: true, blastResistance: 1200 });
// (vanilla's light by charge: 0, 3, 7, 11, 15)
const ANCHOR_LIGHT = [0, 3, 7, 11, 15];
for (let c = 0; c <= RESPAWN_ANCHOR_CHARGES; c++) {
  def(RESPAWN_ANCHOR + c, {
    name: "Respawn Anchor",
    faces: { top: c ? "respawn_anchor_top" : "respawn_anchor_top_off", bottom: "obsidian", side: "respawn_anchor_side" },
    hardness: 50,
    tool: "pickaxe",
    minTier: 4,
    sound: "stone",
    emission: ANCHOR_LIGHT[c],
    emissive: c > 0,
    blastResistance: 1200,
    ...(c ? { item: RESPAWN_ANCHOR, creative: false } : {}),
  });
}
// The portal: a sheet 4/16 thick across its cell, along x (the first id) or z.
for (let a = 0; a < 2; a++) {
  def(NETHER_PORTAL + a, {
    name: "Nether Portal",
    faces: "nether_portal",
    render: RENDER.CUTOUT,
    shape: "nether_portal",
    solid: false,
    opaque: false,
    skyPass: true,
    emission: 11,
    emissive: true,
    hardness: -1, // (vanilla: only its frame breaking takes it down; Creative breaks it)
    blastResistance: 0,
    box: a ? [6 / 16, 0, 0, 10 / 16, 1, 1] : [0, 0, 6 / 16, 1, 1, 10 / 16],
    sound: "glass",
    portal: true,
    creative: false,
    ...(a ? { item: NETHER_PORTAL } : {}),
  });
}
def(QUARTZ_BLOCK, { name: "Block of Quartz", faces: { top: "quartz_block_top", bottom: "quartz_block_top", side: "quartz_block_side" }, hardness: 0.8, ...PICK });
def(CHISELED_QUARTZ_BLOCK, { name: "Chiseled Quartz Block", faces: { top: "quartz_pillar_top", bottom: "quartz_pillar_top", side: "chiseled_quartz_block" }, hardness: 0.8, ...PICK });
def(QUARTZ_PILLAR, { name: "Quartz Pillar", faces: { top: "quartz_pillar_top", bottom: "quartz_pillar_top", side: "quartz_pillar" }, hardness: 0.8, ...PICK });
def(QUARTZ_BRICKS, { name: "Quartz Bricks", faces: "quartz_bricks", hardness: 0.8, ...PICK });
def(SMOOTH_QUARTZ, { name: "Smooth Quartz Block", faces: "quartz_block_top", hardness: 2, ...PICK });
def(NETHERITE_BLOCK, { name: "Block of Netherite", faces: "netherite_block", hardness: 50, tool: "pickaxe", minTier: 4, sound: "stone", blastResistance: 1200 });
// Soul fire: the fire's shape and box, blue, on soul sand or soil only.
def(SOUL_FIRE, {
  name: "Soul Fire",
  faces: "soul_fire",
  render: RENDER.CUTOUT,
  shape: "fire",
  solid: false,
  opaque: false,
  skyPass: true,
  emission: 10,
  emissive: true,
  replaceable: true,
  hardness: 0,
  box: [0, 0, 0, 1, 1 / 16, 1],
  support: (below) => isSoulFireBase(below),
  fire: true,
  burns: true,
  fireDamage: 2, // (vanilla: soul fire hurts 2, fire 1)
  creative: false,
  sound: "cloth",
});
// The blaze spawner: as the Overworld's spawners (js/structures.js wakes and runs it).
def(BLAZE_SPAWNER, { name: "Blaze Spawner", faces: "spawner", render: RENDER.CUTOUT, opaque: false, skyPass: true, hardness: 5, tool: "pickaxe", minTier: 1, sound: "stone", xp: [15, 43], spawns: "blaze", creative: false });
def(SMITHING_TABLE, {
  name: "Smithing Table",
  faces: { top: "smithing_table_top", bottom: "dark_oak_planks", side: "smithing_table_side", front: "smithing_table_front" },
  hardness: 2.5,
  tool: "axe",
  sound: "wood",
});

// The families (building.js's shapes): stairs, slabs, fences, gates, walls.
const STONE_MAT = (hardness) => ({ ...PICK, hardness });
const WOOD_MAT = { hardness: 2, tool: "axe", sound: "wood" };
const FAMILIES = [
  { name: "Nether Brick", faces: "nether_bricks", mat: STONE_MAT(2), full: NETHER_BRICKS, stairs: I.NETHER_BRICK_STAIRS, slab: I.NETHER_BRICK_SLAB, fence: I.NETHER_BRICK_FENCE, wall: I.NETHER_BRICK_WALL },
  { name: "Red Nether Brick", faces: "red_nether_bricks", mat: STONE_MAT(2), full: RED_NETHER_BRICKS, stairs: I.RED_NETHER_BRICK_STAIRS, slab: I.RED_NETHER_BRICK_SLAB, wall: I.RED_NETHER_BRICK_WALL },
  { name: "Blackstone", faces: { top: "blackstone_top", bottom: "blackstone_top", side: "blackstone" }, mat: STONE_MAT(1.5), full: BLACKSTONE, stairs: I.BLACKSTONE_STAIRS, slab: I.BLACKSTONE_SLAB, wall: I.BLACKSTONE_WALL },
  { name: "Polished Blackstone", faces: "polished_blackstone", mat: STONE_MAT(2), full: POLISHED_BLACKSTONE, stairs: I.POLISHED_BLACKSTONE_STAIRS, slab: I.POLISHED_BLACKSTONE_SLAB, wall: I.POLISHED_BLACKSTONE_WALL },
  { name: "Polished Blackstone Brick", faces: "polished_blackstone_bricks", mat: STONE_MAT(1.5), full: POLISHED_BLACKSTONE_BRICKS, stairs: I.POLISHED_BLACKSTONE_BRICK_STAIRS, slab: I.POLISHED_BLACKSTONE_BRICK_SLAB, wall: I.POLISHED_BLACKSTONE_BRICK_WALL },
  { name: "Quartz", faces: { top: "quartz_block_top", bottom: "quartz_block_top", side: "quartz_block_side" }, mat: STONE_MAT(0.8), full: QUARTZ_BLOCK, stairs: I.QUARTZ_STAIRS, slab: I.QUARTZ_SLAB },
  { name: "Crimson", faces: "crimson_planks", mat: WOOD_MAT, full: CRIMSON_PLANKS, stairs: I.CRIMSON_STAIRS, slab: I.CRIMSON_SLAB, fence: I.CRIMSON_FENCE, gate: I.CRIMSON_FENCE_GATE },
  { name: "Warped", faces: "warped_planks", mat: WOOD_MAT, full: WARPED_PLANKS, stairs: I.WARPED_STAIRS, slab: I.WARPED_SLAB, fence: I.WARPED_FENCE, gate: I.WARPED_FENCE_GATE },
];
// (Without building.js's addFamily these blocks are not made, and the
// recipes and structures that use them leave them out.)
if (typeof building.addFamily === "function") for (const f of FAMILIES) building.addFamily(blocks, f);
export const HAS_FAMILIES = typeof building.addFamily === "function";

// ---------- Shapes ----------

const UV = [
  [0, 0],
  [0, 1],
  [1, 1],
  [1, 0],
];
function vquad(x0, z0, x1, z1, y0 = 0, y1 = 1) {
  return {
    c: [
      [x0, y0, z0],
      [x0, y1, z0],
      [x1, y1, z1],
      [x1, y0, z1],
    ],
    uv: UV,
  };
}
// Nether wart: four planes in a # (vanilla's crop model), the tile's full height.
const WART_QUADS = [vquad(0.25, 0, 0.25, 1), vquad(0.75, 0, 0.75, 1), vquad(0, 0.25, 1, 0.25), vquad(0, 0.75, 1, 0.75)];
// One face of a box in the cell, its texture cut to the box (as nature.js's).
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
function boxFace(m, f, b, tile) {
  for (let k = 0; k < 6; k++) BOX[k] = b[k];
  const d = FACE_DEFS[f];
  for (let c = 0; c < 4; c++) {
    const p = d.corners[c];
    for (let a = 0; a < 3; a++) QC[c][a] = BOX[p[a] ? a + 3 : a];
    const uv = d.uv(QC[c]);
    QU[c][0] = uv[0];
    QU[c][1] = uv[1];
  }
  m.quad(QC, QU, f, tile);
}
const PORTAL_BOX = [blocks[NETHER_PORTAL].box, blocks[NETHER_PORTAL + 1].box];
// (the edges of a sheet: drawn only where the next cell holds no portal of its plane)
const EDGE = [
  [FACE.PX, 1, 0, 0],
  [FACE.NX, -1, 0, 0],
  [FACE.PY, 0, 1, 0],
  [FACE.NY, 0, -1, 0],
  [FACE.PZ, 0, 0, 1],
  [FACE.NZ, 0, 0, -1],
];

export const shapes = {
  nether_wart: {
    mesh(m) {
      const t = m.tile(2);
      for (const q of WART_QUADS) m.quad(q.c, q.uv, 2, t);
    },
  },
  nether_portal: {
    mesh(m) {
      const a = m.id - NETHER_PORTAL;
      const b = PORTAL_BOX[a];
      const t = m.tile(2);
      // (its two big faces always; the thin edges against anything but more portal)
      for (const [f, dx, dy, dz] of EDGE) {
        const big = a ? f === FACE.PX || f === FACE.NX : f === FACE.PZ || f === FACE.NZ;
        if (!big) {
          const n = m.neighbor(dx, dy, dz);
          if (n === m.id || LIB.IS_OPAQUE[n]) continue;
        }
        boxFace(m, f, b, t);
      }
    },
  },
};

// ---------- Items ----------

const NETHERITE = { tier: 4, speed: 9, durability: 2031 };
const tool = (type, damage, vDamage, vSpeed) => ({ type, ...NETHERITE, damage, vDamage, vSpeed });
const ARMOR = (slot, points, durability) => ({ slot, tier: 4, points, durability, fireproof: true });
export const items = {
  [QUARTZ]: { name: "Nether Quartz", icon: "nether_quartz" },
  [GLOWSTONE_DUST]: { name: "Glowstone Dust", icon: "glowstone_dust" },
  [BLAZE_ROD]: { name: "Blaze Rod", icon: "blaze_rod" },
  [BLAZE_POWDER]: { name: "Blaze Powder", icon: "blaze_powder" },
  [GHAST_TEAR]: { name: "Ghast Tear", icon: "ghast_tear" },
  [MAGMA_CREAM]: { name: "Magma Cream", icon: "magma_cream" },
  [NETHER_BRICK]: { name: "Nether Brick", icon: "nether_brick" },
  [NETHERITE_SCRAP]: { name: "Netherite Scrap", icon: "netherite_scrap", fireproof: true },
  [NETHERITE_INGOT]: { name: "Netherite Ingot", icon: "netherite_ingot", fireproof: true },
  // (Java: sword 8 / 1.6 a second, axe 10 / 1, pickaxe 6 / 1.2, shovel 6.5 / 1, hoe 1 / 4; 2031 uses)
  [NETHERITE_SWORD]: { name: "Netherite Sword", icon: "sword_netherite", stack: 1, tool: tool("sword", 8, 8, 1.6), fireproof: true },
  [NETHERITE_PICKAXE]: { name: "Netherite Pickaxe", icon: "pickaxe_netherite", stack: 1, tool: tool("pickaxe", 5, 6, 1.2), fireproof: true },
  [NETHERITE_AXE]: { name: "Netherite Axe", icon: "axe_netherite", stack: 1, tool: tool("axe", 7, 10, 1), fireproof: true },
  [NETHERITE_SHOVEL]: { name: "Netherite Shovel", icon: "shovel_netherite", stack: 1, tool: tool("shovel", 5, 6.5, 1), fireproof: true },
  [NETHERITE_HOE]: { name: "Netherite Hoe", icon: "hoe_netherite", stack: 1, tool: tool("hoe", 1, 1, 4), fireproof: true },
  // (Java: 3, 8, 6, 3 points; 407, 592, 555, 481 uses; the toughness and the knockback resistance are not modelled)
  [NETHERITE_HELMET]: { name: "Netherite Helmet", icon: "armor_netherite_helmet", stack: 1, armor: ARMOR(0, 3, 407), fireproof: true },
  [NETHERITE_CHESTPLATE]: { name: "Netherite Chestplate", icon: "armor_netherite_chestplate", stack: 1, armor: ARMOR(1, 8, 592), fireproof: true },
  [NETHERITE_LEGGINGS]: { name: "Netherite Leggings", icon: "armor_netherite_leggings", stack: 1, armor: ARMOR(2, 6, 555), fireproof: true },
  [NETHERITE_BOOTS]: { name: "Netherite Boots", icon: "armor_netherite_boots", stack: 1, armor: ARMOR(3, 3, 481), fireproof: true },
  [FIRE_CHARGE]: { name: "Fire Charge", icon: "fire_charge" },
  [NETHERITE_UPGRADE]: { name: "Netherite Upgrade", icon: "netherite_upgrade" },
  // (vanilla's base potions: the colour of water; no effect)
  [AWKWARD_POTION]: { name: "Awkward Potion", icon: "potion_water", stack: 1, potion: { key: "awkward", color: 0x385dc6, effects: [] } },
  [MUNDANE_POTION]: { name: "Mundane Potion", icon: "potion_water", stack: 1, potion: { key: "mundane", color: 0x385dc6, effects: [] } },
  [THICK_POTION]: { name: "Thick Potion", icon: "potion_water", stack: 1, potion: { key: "thick", color: 0x385dc6, effects: [] } },
};

// ---------- Drops ----------

export const drops = {};
const isShears = (t) => t?.type === "shears";
// Glowstone: 2-4 dust (Fortune adds, at most 4: items.js reads `fortune`).
drops[GLOWSTONE] = (t, rand) => [[GLOWSTONE_DUST, between(2, 4, rand)]];
blocks[GLOWSTONE].fortune = "glowstone";
drops[NETHER_QUARTZ_ORE] = () => [[QUARTZ, 1]];
drops[NETHER_GOLD_ORE] = (t, rand) => [[I.GOLD_NUGGET, between(2, 6, rand)]];
// (vanilla: one time in ten 2-5 nuggets, else the block)
drops[GILDED_BLACKSTONE] = (t, rand) => (rand() < 0.1 ? [[I.GOLD_NUGGET, between(2, 5, rand)]] : [[GILDED_BLACKSTONE, 1]]);
drops[CRIMSON_NYLIUM] = () => [[NETHERRACK, 1]];
drops[WARPED_NYLIUM] = () => [[NETHERRACK, 1]];
for (let a = 0; a < NETHER_WART_AGES; a++) drops[NETHER_WART + a] = (t, rand) => [[NETHER_WART, a === NETHER_WART_AGES - 1 ? between(2, 4, rand) : 1]];
drops[NETHER_SPROUTS] = (t) => (isShears(t) ? [[NETHER_SPROUTS, 1]] : []);
// (vanilla: a third of the time, always with shears)
for (const v of [WEEPING_VINES, WEEPING_VINES + 1, TWISTING_VINES, TWISTING_VINES + 1]) {
  const item = isWeepingVines(v) ? WEEPING_VINES : TWISTING_VINES;
  drops[v] = (t, rand) => (isShears(t) || rand() < 1 / 3 ? [[item, 1]] : []);
}
drops[NETHER_PORTAL] = () => [];
drops[NETHER_PORTAL + 1] = () => [];
drops[SOUL_FIRE] = () => [];
drops[BLAZE_SPAWNER] = () => [];
for (let c = 0; c <= RESPAWN_ANCHOR_CHARGES; c++) drops[RESPAWN_ANCHOR + c] = () => [[RESPAWN_ANCHOR, 1]];

// ---------- Random ticks ----------

export const randomTick = {};
// Nether wart: one random tick in ten grows it an age (vanilla; light and
// water don't matter).
for (let a = 0; a < NETHER_WART_AGES - 1; a++) {
  randomTick[NETHER_WART + a] = (world, x, y, z, id, rand) => {
    if (rand() < 0.1) world.setBlock(x, y, z, id + 1);
  };
}
// Nylium under an opaque block turns back into netherrack (vanilla).
for (const n of NYLIUMS) {
  randomTick[n] = (world, x, y, z) => {
    const above = world.getBlock(x, y + 1, z);
    if (LIB.IS_OPAQUE[above] && LIB.IS_SOLID[above]) world.setBlock(x, y, z, NETHERRACK);
  };
}
// Vines grow at their tip, one random tick in ten (vanilla), up to 25 long.
const VINE_MAX = 25;
function growVine(world, x, y, z, base, dy, rand, force = false) {
  if (!force && rand() >= 0.1) return false;
  const ny = y + dy;
  if (ny < 1 || ny > 126 || world.getBlock(x, ny, z) !== BLOCK.AIR) return false;
  // (how long it is already, back from the tip)
  let n = 0;
  while (n < VINE_MAX) {
    const b = world.getBlock(x, y - dy * n, z);
    if (b !== base && b !== base + 1) break;
    n++;
  }
  if (n >= VINE_MAX) return false;
  world.setBlocks([x, y, z, base + 1, x, ny, z, base]);
  return true;
}
randomTick[WEEPING_VINES] = (world, x, y, z, id, rand) => growVine(world, x, y, z, WEEPING_VINES, -1, rand);
randomTick[TWISTING_VINES] = (world, x, y, z, id, rand) => growVine(world, x, y, z, TWISTING_VINES, 1, rand);

// ---------- Uses ----------

export const blockUse = {};
export const itemUse = {};
const holding = (ctx, id) => ctx.stack?.id === id;

// Bone meal (nature.js's item; these are its Nether uses, tried first).
// On a fungus planted on its own nylium: two in five grow a huge fungus
// (LIB.growHugeFungus, js/dim-nether.js); on netherrack beside nylium: the
// nylium spreads onto it; on nylium: plants around (vanilla's
// NetherForestVegetation); on vines: a few more.
function boneMeal(ctx, fn) {
  if (!holding(ctx, I.BONE_MEAL)) return false;
  if (!fn(ctx)) return false;
  sparkle(ctx, ctx.x, ctx.y, ctx.z);
  ctx.audio?.playPlace?.("plant");
  useOne(ctx);
  return true;
}
for (const [fungus, nylium] of [
  [CRIMSON_FUNGUS, CRIMSON_NYLIUM],
  [WARPED_FUNGUS, WARPED_NYLIUM],
]) {
  blockUse[fungus] = (ctx) =>
    boneMeal(ctx, (c) => {
      if (c.world.getBlock(c.x, c.y - 1, c.z) !== nylium) return false;
      if (Math.random() < 0.4) LIB.growHugeFungus?.(c.world, c.x, c.y, c.z, fungus === WARPED_FUNGUS, Math.random);
      return true;
    });
}
blockUse[NETHERRACK] = (ctx) =>
  boneMeal(ctx, (c) => {
    if (c.world.getBlock(c.x, c.y + 1, c.z) !== BLOCK.AIR) return false;
    let crimson = 0;
    let warped = 0;
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        for (let dz = -1; dz <= 1; dz++) {
          const b = c.world.getBlock(c.x + dx, c.y + dy, c.z + dz);
          if (b === CRIMSON_NYLIUM) crimson++;
          else if (b === WARPED_NYLIUM) warped++;
        }
      }
    }
    if (!crimson && !warped) return false;
    const pick = crimson && warped ? (Math.random() < 0.5 ? CRIMSON_NYLIUM : WARPED_NYLIUM) : crimson ? CRIMSON_NYLIUM : WARPED_NYLIUM;
    return c.world.setBlock(c.x, c.y, c.z, pick);
  });
for (const nylium of NYLIUMS) {
  blockUse[nylium] = (ctx) => boneMeal(ctx, (c) => forestVegetation(c.world, c.x, c.y + 1, c.z, nylium === WARPED_NYLIUM, Math.random, 3, 1) > 0);
}
blockUse[WEEPING_VINES] = (ctx) => boneMeal(ctx, (c) => growVineMore(c.world, c.x, c.y, c.z, WEEPING_VINES, -1));
blockUse[TWISTING_VINES] = (ctx) => boneMeal(ctx, (c) => growVineMore(c.world, c.x, c.y, c.z, TWISTING_VINES, 1));
function growVineMore(world, x, y, z, base, dy) {
  let ty = y;
  while (world.getBlock(x, ty + dy, z) === base || world.getBlock(x, ty + dy, z) === base + 1) ty += dy;
  if (world.getBlock(x, ty, z) !== base) return false;
  let grew = false;
  for (let k = 0, n = 1 + Math.floor(Math.random() * 4); k < n; k++) {
    if (!growVine(world, x, ty, z, base, dy, Math.random, true)) break;
    ty += dy;
    grew = true;
  }
  return grew;
}

// Vanilla's nether forest vegetation (bone meal on nylium, and the
// generator's ground cover): around (x, y, z), `spread` across and `up`
// high, plants on the nylium with air over them. Returns how many.
const CRIMSON_PLANTS = [
  [CRIMSON_ROOTS, 87],
  [CRIMSON_FUNGUS, 11],
  [WARPED_FUNGUS, 1],
];
const WARPED_PLANTS = [
  [WARPED_ROOTS, 85],
  [CRIMSON_ROOTS, 1],
  [WARPED_FUNGUS, 13],
  [CRIMSON_FUNGUS, 1],
];
export function pickForestPlant(warped, r) {
  const list = warped ? WARPED_PLANTS : CRIMSON_PLANTS;
  const total = list.reduce((n, e) => n + e[1], 0);
  let w = r * total;
  for (const [id, weight] of list) if ((w -= weight) < 0) return id;
  return list[0][0];
}
export function forestVegetation(world, x, y, z, warped, rand, spread = 3, up = 1) {
  const out = [];
  const tries = 32;
  for (let k = 0; k < tries; k++) {
    const px = x + Math.floor(rand() * (spread * 2 + 1)) - spread;
    const py = y + Math.floor(rand() * (up * 2 + 1)) - up;
    const pz = z + Math.floor(rand() * (spread * 2 + 1)) - spread;
    if (world.getBlock(px, py, pz) !== BLOCK.AIR) continue;
    const below = world.getBlock(px, py - 1, pz);
    if (below !== CRIMSON_NYLIUM && below !== WARPED_NYLIUM) continue;
    // (warped forests' sprouts too)
    const plant = warped && rand() < 0.3 ? NETHER_SPROUTS : pickForestPlant(warped, rand());
    if (out.some((v, i) => i % 4 === 0 && v === px && out[i + 1] === py && out[i + 2] === pz)) continue;
    out.push(px, py, pz, plant);
  }
  if (out.length) world.setBlocks(out);
  return out.length / 4;
}

// An axe strips a stem or hyphae (vanilla).
for (const id of [CRIMSON_STEM, WARPED_STEM, CRIMSON_HYPHAE, WARPED_HYPHAE]) {
  blockUse[id] = (ctx) => {
    if (ctx.info?.tool?.type !== "axe" && LIB.itemInfo?.(ctx.stack?.id)?.tool?.type !== "axe") return false;
    if (!ctx.world.setBlock(ctx.x, ctx.y, ctx.z, blocks[id].strips)) return false;
    ctx.audio?.playPlace?.("wood");
    if (!ctx.creative && ctx.inventory?.damageSelected?.(1)) ctx.audio?.playToolBreak?.();
    return true;
  };
}

// The respawn anchor: glowstone charges it (to 4); a charged one used sets
// the spawn in the Nether, and blows up anywhere else (js/portal.js's
// LIB.useRespawnAnchor does both).
for (let c = 0; c <= RESPAWN_ANCHOR_CHARGES; c++) {
  blockUse[RESPAWN_ANCHOR + c] = (ctx) => {
    if (holding(ctx, GLOWSTONE) && c < RESPAWN_ANCHOR_CHARGES) {
      if (!ctx.world.setBlock(ctx.x, ctx.y, ctx.z, RESPAWN_ANCHOR + c + 1)) return false;
      ctx.audio?.playPlace?.("glass");
      useOne(ctx);
      return true;
    }
    if (c === 0) return false;
    return !!LIB.useRespawnAnchor?.(ctx);
  };
}

// The smithing table: diamond gear in hand, a netherite upgrade and a
// netherite ingot in the inventory: netherite gear, its enchantments, name
// and wear kept (vanilla's smithing upgrade, without its screen).
export const NETHERITE_OF = {
  [ITEM.DIAMOND_SWORD]: NETHERITE_SWORD,
  [ITEM.DIAMOND_PICKAXE]: NETHERITE_PICKAXE,
  [ITEM.DIAMOND_AXE]: NETHERITE_AXE,
  [ITEM.DIAMOND_SHOVEL]: NETHERITE_SHOVEL,
  [I.DIAMOND_HOE]: NETHERITE_HOE,
  [ITEM.DIAMOND_HELMET]: NETHERITE_HELMET,
  [ITEM.DIAMOND_CHESTPLATE]: NETHERITE_CHESTPLATE,
  [ITEM.DIAMOND_LEGGINGS]: NETHERITE_LEGGINGS,
  [ITEM.DIAMOND_BOOTS]: NETHERITE_BOOTS,
};
// Takes one of `id` from anywhere in the inventory; false if there is none.
function takeOne(inv, id) {
  for (let i = 0; i < inv.slots.length; i++) {
    if (inv.slots[i]?.id === id) {
      inv.takeFromSlot(i, 1);
      return true;
    }
  }
  return false;
}
export function smithUpgrade(inv, creative = false) {
  const s = inv?.selectedStack ?? inv?.slots?.[inv.selected];
  const to = s ? NETHERITE_OF[s.id] : 0;
  if (!to || !LIB.itemInfo?.(to)) return false;
  if (!creative && (inv.countItem(NETHERITE_UPGRADE) < 1 || inv.countItem(NETHERITE_INGOT) < 1)) return false;
  if (!creative) {
    takeOne(inv, NETHERITE_UPGRADE);
    takeOne(inv, NETHERITE_INGOT);
  }
  const from = LIB.itemInfo(s.id);
  const info = LIB.itemInfo(to);
  const maxFrom = from?.tool?.durability ?? from?.armor?.durability;
  const maxTo = info?.tool?.durability ?? info?.armor?.durability;
  const next = { ...s, id: to };
  // (the wear carried over: the same uses gone)
  if (Number.isFinite(s.dur) && maxFrom && maxTo) next.dur = Math.max(1, maxTo - (maxFrom - s.dur));
  inv.slots[inv.selected] = next;
  return true;
}
blockUse[SMITHING_TABLE] = (ctx) => {
  if (!ctx.stack || !NETHERITE_OF[ctx.stack.id]) return false;
  if (!smithUpgrade(ctx.inventory, ctx.creative)) {
    LIB.toast?.("Needs a Netherite Upgrade and a Netherite Ingot", 2.5);
    return true;
  }
  ctx.audio?.playPlace?.("stone");
  ctx.audio?.playCraft?.();
  return true;
};

// The fire charge: a fire where flint and steel would light one (on the
// face clicked; soul fire on soul sand or soil), one used up.
itemUse[FIRE_CHARGE] = (ctx) => {
  if (ctx.x === null || !ctx.place) return false;
  const { BLOCK_INFO, IS_REPLACEABLE, IS_SOLID } = LIB;
  if (ctx.id === I.TNT && LIB.igniteTnt) {
    if (!LIB.igniteTnt(ctx.world, ctx.x, ctx.y, ctx.z, ctx)) return false;
  } else {
    if (!IS_SOLID[ctx.id]) return false;
    const [x, y, z] = ctx.place;
    const here = ctx.world.getBlock(x, y, z);
    if (here !== BLOCK.AIR && !(IS_REPLACEABLE[here] && !BLOCK_INFO[here]?.liquid)) return false;
    const below = ctx.world.getBlock(x, y - 1, z);
    const fire = isSoulFireBase(below) ? SOUL_FIRE : I.FIRE;
    if (!sturdy(below) && fire === I.FIRE) return false;
    if (!ctx.world.setBlock(x, y, z, fire)) return false;
  }
  (ctx.audio.playIgnite || ctx.audio.playClick)?.call(ctx.audio);
  useOne(ctx);
  return true;
};

// ---------- Recipes ----------

const shaped = (pattern, key, result, count = 1) => ({ type: "shaped", pattern, key, result: [result, count] });
const shapeless = (ingredients, result, count = 1) => ({ type: "shapeless", ingredients, result: [result, count] });
const smelt = (input, result, xp) => ({ type: "smelting", input, result: [result, 1], xp, time: 10 });
const famOf = (name) => FAMILIES.find((f) => f.name === name);
export const recipes = () => {
  const R = [];
  // Blocks of their items.
  R.push(shaped(["##", "##"], { "#": GLOWSTONE_DUST }, GLOWSTONE));
  R.push(shaped(["##", "##"], { "#": QUARTZ }, QUARTZ_BLOCK));
  R.push(shaped(["##", "##"], { "#": NETHER_BRICK }, NETHER_BRICKS));
  R.push(shaped(["###", "###", "###"], { "#": NETHERITE_INGOT }, NETHERITE_BLOCK), shapeless([NETHERITE_BLOCK], NETHERITE_INGOT, 9));
  R.push(shaped(["###", "###", "###"], { "#": NETHER_WART }, NETHER_WART_BLOCK));
  R.push(shaped(["###", "###", "###"], { "#": I.BONE_MEAL }, BONE_BLOCK), shapeless([BONE_BLOCK], I.BONE_MEAL, 9));
  R.push(shaped(["NW", "WN"], { N: NETHER_BRICK, W: NETHER_WART }, RED_NETHER_BRICKS));
  R.push(shaped(["#", "#"], { "#": QUARTZ_BLOCK }, QUARTZ_PILLAR, 2));
  R.push(shaped(["##", "##"], { "#": QUARTZ_BLOCK }, QUARTZ_BRICKS, 4));
  R.push(shaped(["##", "##"], { "#": BASALT }, POLISHED_BASALT, 4));
  R.push(shaped(["##", "##"], { "#": BLACKSTONE }, POLISHED_BLACKSTONE, 4));
  R.push(shaped(["##", "##"], { "#": POLISHED_BLACKSTONE }, POLISHED_BLACKSTONE_BRICKS, 4));
  // The woods.
  R.push(shapeless([[CRIMSON_STEM, STRIPPED_CRIMSON_STEM, CRIMSON_HYPHAE]], CRIMSON_PLANKS, 4));
  R.push(shapeless([[WARPED_STEM, STRIPPED_WARPED_STEM, WARPED_HYPHAE]], WARPED_PLANKS, 4));
  R.push(shaped(["##", "##"], { "#": CRIMSON_STEM }, CRIMSON_HYPHAE, 3), shaped(["##", "##"], { "#": WARPED_STEM }, WARPED_HYPHAE, 3));
  // (the Nether's planks as "any planks": what the core recipes make of planks)
  R.push(shaped(["#", "#"], { "#": ALL_PLANKS }, ITEM.STICK, 4));
  R.push(shaped(["##", "##"], { "#": ALL_PLANKS }, BLOCK.CRAFTING_TABLE));
  R.push(shaped(["###", "# #", "###"], { "#": ALL_PLANKS }, BLOCK.CHEST));
  R.push(shaped(["# #", " # "], { "#": ALL_PLANKS }, I.BOWL, 4));
  R.push(shaped(["###", " S ", " S "], { "#": NETHER_PLANKS, S: ITEM.STICK }, ITEM.WOOD_PICKAXE));
  R.push(shaped(["##", "#S", " S"], { "#": NETHER_PLANKS, S: ITEM.STICK }, ITEM.WOOD_AXE));
  R.push(shaped(["#", "S", "S"], { "#": NETHER_PLANKS, S: ITEM.STICK }, ITEM.WOOD_SHOVEL));
  R.push(shaped(["#", "#", "S"], { "#": NETHER_PLANKS, S: ITEM.STICK }, ITEM.WOOD_SWORD));
  R.push(shaped(["##", " S", " S"], { "#": NETHER_PLANKS, S: ITEM.STICK }, I.WOODEN_HOE));
  R.push(shaped(["II", "##", "##"], { I: I.IRON_INGOT, "#": ALL_PLANKS }, SMITHING_TABLE));
  // The families.
  if (HAS_FAMILIES) {
    for (const f of FAMILIES) {
      const key = { "#": f.full };
      if (f.stairs) R.push(shaped(["#  ", "## ", "###"], key, f.stairs, 4));
      if (f.slab) R.push(shaped(["###"], key, f.slab, 6));
      if (f.wall) R.push(shaped(["###", "###"], key, f.wall, 6));
      if (f.gate) R.push(shaped(["S#S", "S#S"], { "#": f.full, S: ITEM.STICK }, f.gate));
      if (f.fence && f.full !== NETHER_BRICKS) R.push(shaped(["#S#", "#S#"], { "#": f.full, S: ITEM.STICK }, f.fence, 3));
    }
    R.push(shaped(["#N#", "#N#"], { "#": NETHER_BRICKS, N: NETHER_BRICK }, famOf("Nether Brick").fence, 6));
    R.push(shaped(["#", "#"], { "#": famOf("Nether Brick").slab }, CHISELED_NETHER_BRICKS));
    R.push(shaped(["#", "#"], { "#": famOf("Quartz").slab }, CHISELED_QUARTZ_BLOCK));
    R.push(shaped(["#", "#"], { "#": famOf("Polished Blackstone").slab }, CHISELED_POLISHED_BLACKSTONE));
  }
  // The creatures' things.
  R.push(shapeless([BLAZE_ROD], BLAZE_POWDER, 2));
  R.push(shapeless([BLAZE_POWDER, I.SLIME_BALL], MAGMA_CREAM));
  R.push(shapeless([BLAZE_POWDER, [ITEM.COAL, I.CHARCOAL], I.GUNPOWDER], FIRE_CHARGE, 3));
  R.push(shaped(["##", "##"], { "#": MAGMA_CREAM }, MAGMA_BLOCK));
  // Netherite.
  R.push(shapeless([NETHERITE_SCRAP, NETHERITE_SCRAP, NETHERITE_SCRAP, NETHERITE_SCRAP, ITEM.GOLD_INGOT, ITEM.GOLD_INGOT, ITEM.GOLD_INGOT, ITEM.GOLD_INGOT], NETHERITE_INGOT));
  R.push(shaped(["DTD", "DND", "DDD"], { D: I.DIAMOND, T: NETHERITE_UPGRADE, N: NETHERRACK }, NETHERITE_UPGRADE, 2));
  // Smelting (vanilla's xp).
  R.push(smelt(NETHERRACK, NETHER_BRICK, 0.1));
  R.push(smelt(NETHER_BRICKS, CRACKED_NETHER_BRICKS, 0.1));
  R.push(smelt(POLISHED_BLACKSTONE_BRICKS, CRACKED_POLISHED_BLACKSTONE_BRICKS, 0.1));
  R.push(smelt(BASALT, SMOOTH_BASALT, 0.1));
  R.push(smelt(QUARTZ_BLOCK, SMOOTH_QUARTZ, 0.1));
  R.push(smelt(NETHER_QUARTZ_ORE, QUARTZ, 0.2));
  R.push(smelt(NETHER_GOLD_ORE, ITEM.GOLD_INGOT, 1));
  R.push(smelt(ANCIENT_DEBRIS, NETHERITE_SCRAP, 2));
  // (blaze rods burn 120 s, as vanilla)
  R.push({ type: "fuel", input: BLAZE_ROD, time: 120 });
  return R;
};

// ---------- Textures ----------

const lum = (c) => (c[0] * 0.3 + c[1] * 0.59 + c[2] * 0.11) / 255;
// A core or own painting again along a new ramp, by brightness.
function recolor(t, kit, colors) {
  const ramp = colors.map(kit.hex);
  let a = 1;
  let b = 0;
  t.forEach((x, y) => {
    const c = t.get(x, y);
    if (c[3] < 128) return;
    a = Math.min(a, lum(c));
    b = Math.max(b, lum(c));
  });
  t.forEach((x, y) => {
    const c = t.get(x, y);
    if (c[3] < 128) return;
    t.set(x, y, kit.ramp(ramp, (lum(c) - a) / Math.max(1e-3, b - a)), c[3]);
  });
}
const clear = (t) => t.forEach((x, y) => t.set(x, y, [0, 0, 0], 0));
const R = (kit, list) => list.map(kit.hex);

// Netherrack: lumpy dark red rock, little bright flecks.
function paintNetherrack(t, kit) {
  const ramp = R(kit, [0x3a0e0e, 0x521616, 0x681e1e, 0x7c2626, 0x903232, 0xa64444]);
  const v = t.voronoi(26, 3);
  t.forEach((x, y) => {
    const c = v(x, y);
    let f = 0.4 + (c.value - 0.5) * 0.35 + (t.fbm(x, y, 8, 2) - 0.5) * 0.35 + (t.rand() - 0.5) * 0.18;
    if (c.d2 - c.d1 < 1.1) f -= 0.3; // the cracks between the lumps
    t.set(x, y, kit.ramp(ramp, f));
  });
}
// Specks of an ore on netherrack: flat chips with a light top-left.
function netherOre(t, kit, colors, n, size) {
  paintNetherrack(t, kit);
  const [dark, mid, light] = R(kit, colors);
  const r = kit.makeRand(t.seed + 7);
  for (let i = 0; i < n; i++) {
    const cx = Math.floor(r() * 32);
    const cy = Math.floor(r() * 32);
    const len = 2 + Math.floor(r() * size);
    const horiz = r() < 0.5;
    for (let k = 0; k < len; k++) {
      const x = cx + (horiz ? k : Math.floor(r() * 2));
      const y = cy + (horiz ? Math.floor(r() * 2) : k);
      t.set(x, y, k === 0 ? light : r() < 0.3 ? dark : mid);
      t.set(x + 1, y + 1, kit.scaleRgb(dark, 0.7));
    }
  }
}
function paintSoulSand(t, kit, soil) {
  const ramp = R(kit, soil ? [0x231912, 0x30231a, 0x3d2e22, 0x4b3a2c, 0x5a4838] : [0x2e2219, 0x3f3024, 0x51402f, 0x63503d, 0x76624e]);
  t.forEach((x, y) => {
    let f = 0.45 + (t.fbm(x, y, 8, 3) - 0.5) * 0.55 + (t.rand() - 0.5) * 0.22;
    t.set(x, y, kit.ramp(ramp, f));
  });
  if (soil) return;
  // (the faces: two dark eyes over a dark open mouth, here and there)
  const r = kit.makeRand(t.seed + 5);
  for (let k = 0; k < 4; k++) {
    const fx = 3 + Math.floor(r() * 24);
    const fy = 3 + Math.floor(r() * 22);
    const dark = kit.hex(0x1a120c);
    for (const [dx, dy] of [[0, 0], [1, 0], [0, 1], [4, 0], [5, 0], [5, 1], [2, 4], [3, 4], [2, 5], [3, 5], [1, 5], [4, 5]]) t.set(fx + dx, fy + dy, dark);
  }
}
function paintGlowstone(t, kit) {
  const ramp = R(kit, [0x6a3e14, 0x9c6224, 0xd09038, 0xf4c25a, 0xffe08a, 0xfff4c8]);
  const v = t.voronoi(18, 2);
  t.forEach((x, y) => {
    const c = v(x, y);
    let f = 0.75 - c.d1 / 7 + (c.value - 0.5) * 0.4 + (t.rand() - 0.5) * 0.15;
    if (c.d2 - c.d1 < 1) f -= 0.35;
    t.set(x, y, kit.ramp(ramp, f));
  });
}
function paintMagma(t, kit) {
  const ramp = R(kit, [0x2a0804, 0x541008, 0x8a2008, 0xc0400c, 0xf07018, 0xffa030]);
  const v = t.voronoi(14, 4);
  t.forEach((x, y) => {
    const c = v(x, y);
    const edge = c.d2 - c.d1;
    let f = 0.25 + (t.fbm(x, y, 4, 2) - 0.5) * 0.3;
    if (edge < 1.6) f = 0.85 + (t.rand() - 0.5) * 0.2; // the glowing seams
    else if (edge < 2.4) f = 0.55;
    t.set(x, y, kit.ramp(ramp, f));
  });
}
// Stripes along the tile (basalt's, a stem's, bone's): `vertical` lines.
function striped(t, kit, colors, period, rough) {
  const ramp = R(kit, colors);
  t.forEach((x, y) => {
    const s = Math.sin((x + t.noise(x, y, 4, 1, 2) * rough) * ((Math.PI * 2) / period));
    let f = 0.5 + s * 0.22 + (t.noise(x, y, 8, 3, 2) - 0.5) * 0.35 + (t.rand() - 0.5) * 0.12;
    t.set(x, y, kit.ramp(ramp, f));
  });
}
// The end of a column: rings round the middle and a rim.
function ringsTop(t, kit, colors, rim) {
  const ramp = R(kit, colors);
  t.forEach((x, y) => {
    const d = Math.hypot(x - 15.5, y - 15.5);
    const edge = Math.min(x, y, 31 - x, 31 - y);
    let f = 0.45 + Math.sin(d * 1.1 + t.noise(x, y, 4, 2) * 2) * 0.15 + (t.rand() - 0.5) * 0.12;
    if (edge < 2) f = rim + (t.rand() - 0.5) * 0.1;
    t.set(x, y, kit.ramp(ramp, f));
  });
}
function speckled(t, kit, colors, contrast = 0.5) {
  const ramp = R(kit, colors);
  t.forEach((x, y) => {
    let f = 0.45 + (t.fbm(x, y, 8, 2) - 0.5) * contrast + (t.rand() - 0.5) * 0.25;
    if (t.rand() < 0.04) f += 0.35;
    t.set(x, y, kit.ramp(ramp, f));
  });
}
// A smooth slab with a bevelled rim (polished stone, a block of metal).
function polished(t, kit, colors, inner = true) {
  const ramp = R(kit, colors);
  t.forEach((x, y) => {
    let f = 0.45 + (t.fbm(x, y, 4, 2) - 0.5) * 0.18 + (t.rand() - 0.5) * 0.06;
    if (x <= 0 || y <= 0) f += 0.3;
    else if (x >= 31 || y >= 31) f -= 0.3;
    else if (inner && (x === 2 || y === 2)) f -= 0.12;
    else if (inner && (x === 29 || y === 29)) f += 0.08;
    t.set(x, y, kit.ramp(ramp, f));
  });
}
// Bricks: rows `h` high, bricks `w` wide, every other row half a brick along.
function bricks(t, kit, colors, mortar, w, h, cracked = false) {
  const ramp = R(kit, colors);
  const m = kit.hex(mortar);
  t.forEach((x, y) => {
    const row = Math.floor(y / h);
    const bx = (x + (row % 2 ? w / 2 : 0)) % w;
    const by = y % h;
    if (by === h - 1 || bx === w - 1) {
      t.set(x, y, kit.scaleRgb(m, 0.85 + t.rand() * 0.3));
      return;
    }
    const brick = Math.floor((x + (row % 2 ? w / 2 : 0)) / w) + row * 7;
    let f = 0.4 + ((brick * 37) % 11) / 30 + (t.rand() - 0.5) * 0.18;
    if (by === 0) f += 0.15;
    if (by === h - 2) f -= 0.1;
    t.set(x, y, kit.ramp(ramp, f));
  });
  if (cracked) crack(t, kit, mortar);
}
function crack(t, kit, color) {
  const r = kit.makeRand(t.seed + 11);
  const c = kit.hex(color);
  for (let k = 0; k < 3; k++) {
    let x = Math.floor(r() * 32);
    let y = Math.floor(r() * 32);
    for (let i = 0; i < 16; i++) {
      t.set(x, y, kit.scaleRgb(c, 0.6));
      x += Math.floor(r() * 3) - 1;
      y += 1;
    }
  }
}
function paintNylium(t, kit, colors) {
  const ramp = R(kit, colors);
  t.forEach((x, y) => {
    let f = 0.45 + (t.fbm(x, y, 8, 3) - 0.5) * 0.6 + (t.rand() - 0.5) * 0.25;
    t.set(x, y, kit.ramp(ramp, f));
  });
}
function paintNyliumSide(t, kit, colors) {
  paintNetherrack(t, kit);
  const ramp = R(kit, colors);
  for (let x = 0; x < 32; x++) {
    const h = 5 + Math.floor(t.noise(x, 0, 8, 4) * 6) + (t.rand() < 0.3 ? 2 : 0);
    for (let y = 0; y < h; y++) t.set(x, y, kit.ramp(ramp, 0.65 - y / (h * 2) + (t.rand() - 0.5) * 0.25));
  }
}
// A stem's bark: lengthwise fibres, and the glowing specks vanilla's shine.
function paintStem(t, kit, colors, glow) {
  striped(t, kit, colors, 5, 2);
  const g = kit.hex(glow);
  const r = kit.makeRand(t.seed + 3);
  for (let k = 0; k < 9; k++) {
    const x = Math.floor(r() * 32);
    const y = Math.floor(r() * 32);
    t.set(x, y, g);
    t.set(x, y + 1, kit.scaleRgb(g, 0.75));
  }
}
function paintWart(t, kit, colors) {
  const ramp = R(kit, colors);
  const v = t.voronoi(30, 5);
  t.forEach((x, y) => {
    const c = v(x, y);
    let f = 0.75 - c.d1 / 5 + (t.rand() - 0.5) * 0.18;
    if (c.d2 - c.d1 < 0.9) f -= 0.25;
    t.set(x, y, kit.ramp(ramp, f));
  });
}
// A fungus: a cap on a short stalk.
function paintFungus(t, kit, cap, stalk, spots) {
  clear(t);
  const C = R(kit, cap);
  const S = R(kit, stalk);
  for (let y = 16; y < 32; y++) {
    t.set(15, y, kit.ramp(S, 0.6));
    t.set(16, y, kit.ramp(S, 0.35));
  }
  for (let y = 6; y < 18; y++) {
    const w = y < 9 ? 3 + (y - 6) * 2 : 9 - Math.max(0, y - 14) * 2;
    for (let x = 16 - w; x < 16 + w; x++) t.set(x, y, kit.ramp(C, 0.85 - (y - 6) / 14 - (x < 16 ? 0 : 0.1) + (t.rand() - 0.5) * 0.15));
  }
  if (spots) {
    const sp = kit.hex(spots);
    for (const [x, y] of [[12, 9], [18, 8], [20, 12], [11, 13], [15, 11]]) t.set(x, y, sp);
  }
}
function paintRoots(t, kit, colors) {
  clear(t);
  const ramp = R(kit, colors);
  for (let k = 0; k < 7; k++) {
    const x0 = 3 + k * 4.2;
    const h = 14 + ((k * 5) % 11);
    for (let i = 0; i < h; i++) {
      const x = Math.round(x0 + Math.sin(i * 0.35 + k) * 1.3);
      t.set(x, 31 - i, kit.ramp(ramp, 0.25 + (i / h) * 0.65));
    }
  }
}
function paintVines(t, kit, colors, up, tip) {
  clear(t);
  const ramp = R(kit, colors);
  for (let k = 0; k < 5; k++) {
    const x0 = 7 + k * 4.5;
    const len = tip ? 18 + ((k * 7) % 10) : 32;
    for (let i = 0; i < len; i++) {
      const y = up ? 31 - i : i;
      const x = Math.round(x0 + Math.sin(i * 0.4 + k * 1.7) * 1.5);
      t.set(x, y, kit.ramp(ramp, 0.3 + ((i * 7) % 10) / 20));
      if (i % 5 === 2) t.set(x + (k % 2 ? 1 : -1), y, kit.ramp(ramp, 0.8));
    }
  }
}
// Nether wart: little bulbs on stalks, more and riper with age.
function paintNetherWart(t, kit, stage) {
  clear(t);
  const ramp = R(kit, stage === 2 ? [0x4a0404, 0x7a0a0a, 0xa61414, 0xc82424] : [0x5a1010, 0x8a2020, 0xb03030, 0xd04a4a]);
  const n = [3, 5, 7][stage];
  const h = [8, 14, 22][stage];
  for (let k = 0; k < n; k++) {
    const x0 = 4 + Math.floor((k * 24) / n);
    const top = 31 - h + ((k * 5) % 5);
    for (let y = top + 3; y < 32; y++) t.set(x0 + 1, y, kit.ramp(ramp, 0.3));
    for (let dy = 0; dy < 4; dy++) for (let dx = 0; dx < 4; dx++) if ((dx - 1.5) ** 2 + (dy - 1.5) ** 2 < 4.2) t.set(x0 + dx, top + dy, kit.ramp(ramp, 0.9 - dy / 5 - dx / 10));
  }
}
function paintFlamesBlue(t, kit) {
  clear(t);
  const ramp = R(kit, [0x063c5a, 0x0a6a8a, 0x18a8c8, 0x52d8f0, 0xb8f6ff, 0xf0ffff]);
  for (let x = 0; x < 32; x++) {
    const h = 10 + t.noise(x, 0, 6, 1) * 14 + t.noise(x, 0, 16, 2) * 6;
    for (let y = 0; y < 32; y++) {
      const up = 31 - y;
      if (up > h) continue;
      const tongue = t.noise(x, y, 8, 3, 4);
      if (up > h * 0.6 && tongue < 0.35) continue;
      t.set(x, y, kit.ramp(ramp, 1 - up / h + (tongue - 0.5) * 0.3 + 0.1));
    }
  }
}
function paintPortal(t, kit) {
  const ramp = R(kit, [0x2a0656, 0x4a0c96, 0x6a1ad0, 0x8a3af0, 0xb070ff, 0xd8b0ff]);
  t.forEach((x, y) => {
    const dx = x - 15.5;
    const dy = y - 15.5;
    const a = Math.atan2(dy, dx);
    const d = Math.hypot(dx, dy);
    const swirl = Math.sin(a * 3 + d * 0.45 + t.noise(x, y, 4, 1) * 3);
    const f = 0.45 + swirl * 0.3 + (t.fbm(x, y, 8, 2) - 0.5) * 0.3;
    // (a cut-out sheet: the darkest streaks are see-through, as vanilla's translucent swirl reads)
    t.set(x, y, kit.ramp(ramp, f), f < 0.24 ? 0 : 255);
  });
}
function paintCrying(t, kit) {
  const ramp = R(kit, [0x0a0710, 0x120c1c, 0x1a1228, 0x261a3a, 0x3a2a56, 0x5a4680]);
  t.forEach((x, y) => {
    let f = t.fbm(x, y, 4, 3) * 0.55 + t.rand() * 0.15;
    if (t.noise(x, y, 8, 4) > 0.72) f += 0.4;
    t.set(x, y, kit.ramp(ramp, f));
  });
  const tear = R(kit, [0x6a18c0, 0x9a40f0, 0xd090ff]);
  const r = kit.makeRand(t.seed + 9);
  for (let k = 0; k < 6; k++) {
    const x = Math.floor(r() * 30) + 1;
    const y0 = Math.floor(r() * 24);
    const len = 3 + Math.floor(r() * 6);
    for (let i = 0; i < len; i++) t.set(x, y0 + i, tear[Math.min(2, Math.floor((i / len) * 3))]);
  }
}

export const tiles = {
  netherrack: paintNetherrack,
  soul_sand: (t, kit) => paintSoulSand(t, kit, false),
  soul_soil: (t, kit) => paintSoulSand(t, kit, true),
  glowstone: paintGlowstone,
  nether_quartz_ore: (t, kit) => netherOre(t, kit, [0xb0a498, 0xe6ded2, 0xffffff], 10, 3),
  nether_gold_ore: (t, kit) => netherOre(t, kit, [0xa06a10, 0xf2c83a, 0xfff2a8], 12, 2),
  ancient_debris_side: (t, kit) => striped(t, kit, [0x3a2a26, 0x4e3a34, 0x5e4840, 0x6e5650, 0x8a7068], 7, 4),
  ancient_debris_top: (t, kit) => ringsTop(t, kit, [0x3a2a26, 0x4e3a34, 0x5e4840, 0x6e5650, 0x8a7068], 0.2),
  magma: paintMagma,
  basalt_side: (t, kit) => striped(t, kit, [0x2c2c32, 0x3c3c44, 0x4c4c56, 0x5c5c66, 0x707078], 4, 3),
  basalt_top: (t, kit) => ringsTop(t, kit, [0x2c2c32, 0x3c3c44, 0x4c4c56, 0x5c5c66, 0x707078], 0.3),
  polished_basalt_side: (t, kit) => striped(t, kit, [0x3a3a42, 0x4a4a54, 0x5a5a64, 0x6a6a74, 0x7c7c86], 8, 0.5),
  polished_basalt_top: (t, kit) => polished(t, kit, [0x3a3a42, 0x4a4a54, 0x5a5a64, 0x6a6a74, 0x7c7c86]),
  smooth_basalt: (t, kit) => speckled(t, kit, [0x2a2a2e, 0x34343a, 0x3e3e44, 0x48484e, 0x56565c], 0.25),
  blackstone: (t, kit) => speckled(t, kit, [0x110e14, 0x1a161e, 0x241f28, 0x2e2834, 0x3e3846]),
  blackstone_top: (t, kit) => ringsTop(t, kit, [0x110e14, 0x1a161e, 0x241f28, 0x2e2834, 0x3e3846], 0.25),
  gilded_blackstone: (t, kit) => {
    speckled(t, kit, [0x110e14, 0x1a161e, 0x241f28, 0x2e2834, 0x3e3846]);
    const gold = R(kit, [0xa06a10, 0xe0aa2a, 0xffe070]);
    t.forEach((x, y) => {
      const n = t.noise(x, y, 6, 8);
      if (n > 0.66) t.set(x, y, gold[Math.min(2, Math.floor((n - 0.66) * 9))]);
    });
  },
  polished_blackstone: (t, kit) => polished(t, kit, [0x1c1820, 0x26212a, 0x302a36, 0x3a3442, 0x4a4454]),
  polished_blackstone_bricks: (t, kit) => bricks(t, kit, [0x1c1820, 0x26212a, 0x302a36, 0x3a3442, 0x4a4454], 0x0c0a0e, 16, 8),
  cracked_polished_blackstone_bricks: (t, kit) => bricks(t, kit, [0x1c1820, 0x26212a, 0x302a36, 0x3a3442, 0x4a4454], 0x0c0a0e, 16, 8, true),
  chiseled_polished_blackstone: (t, kit) => {
    polished(t, kit, [0x1c1820, 0x26212a, 0x302a36, 0x3a3442, 0x4a4454]);
    // (a carved face, the bastion builders' mark)
    const d = kit.hex(0x0c0a0e);
    for (let k = 8; k < 24; k++) {
      t.set(k, 6, d);
      t.set(k, 25, d);
      t.set(6, k, d);
      t.set(25, k, d);
    }
    for (const [x, y] of [[11, 12], [12, 12], [19, 12], [20, 12], [11, 13], [20, 13], [14, 19], [15, 19], [16, 19], [17, 19]]) t.set(x, y, d);
  },
  nether_bricks: (t, kit) => bricks(t, kit, [0x1e0c10, 0x2a1216, 0x36181c, 0x441e24, 0x52262c], 0x0e0507, 16, 8),
  cracked_nether_bricks: (t, kit) => bricks(t, kit, [0x1e0c10, 0x2a1216, 0x36181c, 0x441e24, 0x52262c], 0x0e0507, 16, 8, true),
  chiseled_nether_bricks: (t, kit) => {
    polished(t, kit, [0x1e0c10, 0x2a1216, 0x36181c, 0x441e24, 0x52262c]);
    const d = kit.hex(0x0e0507);
    for (let k = 4; k < 28; k++) {
      if (k % 6 < 3) continue;
      t.set(k, 15, d);
      t.set(k, 16, d);
      t.set(15, k, d);
      t.set(16, k, d);
    }
  },
  red_nether_bricks: (t, kit) => bricks(t, kit, [0x3a0404, 0x4e0808, 0x620c0c, 0x761212, 0x8a1a1a], 0x1e0202, 16, 8),
  bone_block_side: (t, kit) => striped(t, kit, [0xb8b08c, 0xcac2a0, 0xd8d2b4, 0xe4dfc6, 0xf0ecd8], 8, 1),
  bone_block_top: (t, kit) => {
    ringsTop(t, kit, [0x8a8264, 0xb8b08c, 0xcac2a0, 0xd8d2b4, 0xe4dfc6], 0.85);
    const d = kit.hex(0x6a644c);
    t.forEach((x, y) => {
      if (Math.hypot(x - 15.5, y - 15.5) < 5) t.set(x, y, kit.scaleRgb(d, 0.9 + t.rand() * 0.2));
    });
  },
  nether_wart_0: (t, kit) => paintNetherWart(t, kit, 0),
  nether_wart_1: (t, kit) => paintNetherWart(t, kit, 1),
  nether_wart_2: (t, kit) => paintNetherWart(t, kit, 2),
  crimson_nylium: (t, kit) => paintNylium(t, kit, [0x5a0a0c, 0x780e12, 0x941418, 0xac1c1e, 0xc42a28]),
  crimson_nylium_side: (t, kit) => paintNyliumSide(t, kit, [0x5a0a0c, 0x780e12, 0x941418, 0xac1c1e, 0xc42a28]),
  warped_nylium: (t, kit) => paintNylium(t, kit, [0x0a4a44, 0x105e56, 0x167468, 0x1e8a7a, 0x2aa08e]),
  warped_nylium_side: (t, kit) => paintNyliumSide(t, kit, [0x0a4a44, 0x105e56, 0x167468, 0x1e8a7a, 0x2aa08e]),
  crimson_stem: (t, kit) => paintStem(t, kit, [0x3e1424, 0x501a2e, 0x62223a, 0x742c46, 0x883852], 0xff5a3a),
  crimson_stem_top: (t, kit) => ringsTop(t, kit, [0x5a1e34, 0x6e2840, 0x82324e, 0x983e5c, 0xae4c6c], 0.1),
  warped_stem: (t, kit) => paintStem(t, kit, [0x1a323e, 0x22424e, 0x2a525e, 0x34626e, 0x3e7480], 0x3affd8),
  warped_stem_top: (t, kit) => ringsTop(t, kit, [0x1e6a66, 0x248078, 0x2c9488, 0x36a898, 0x44bca8], 0.1),
  stripped_crimson_stem: (t, kit) => striped(t, kit, [0x6a2440, 0x7c2c4e, 0x8e3660, 0xa04070, 0xb44c80], 6, 1),
  stripped_warped_stem: (t, kit) => striped(t, kit, [0x247070, 0x2c8682, 0x349a92, 0x3eaea2, 0x4cc2b2], 6, 1),
  crimson_planks: (t, kit) => {
    kit.base("planks", t);
    recolor(t, kit, [0x3e1626, 0x52203a, 0x642848, 0x763256, 0x883c62, 0x9a4870]);
  },
  warped_planks: (t, kit) => {
    kit.base("planks", t);
    recolor(t, kit, [0x123e3a, 0x1a524c, 0x22665e, 0x2a7a6e, 0x348c7e, 0x40a090]);
  },
  crimson_fungus: (t, kit) => paintFungus(t, kit, [0x7a0e10, 0xa21818, 0xc82626, 0xe84a3a], [0xc89070, 0xe0b090, 0xf0d0b0], 0xffc040),
  warped_fungus: (t, kit) => paintFungus(t, kit, [0x0e5a54, 0x16786e, 0x22968a, 0x3ab4a4], [0xc89070, 0xe0b090, 0xf0d0b0], 0xf08a28),
  crimson_roots: (t, kit) => paintRoots(t, kit, [0x5a0a14, 0x84121c, 0xaa1c28, 0xd03038]),
  warped_roots: (t, kit) => paintRoots(t, kit, [0x0a4a4a, 0x126a66, 0x1a8c84, 0x26aea2]),
  nether_sprouts: (t, kit) => {
    clear(t);
    const ramp = R(kit, [0x0a4a4a, 0x126a66, 0x1a8c84, 0x26aea2]);
    for (let k = 0; k < 9; k++) {
      const x0 = 2 + k * 3.4;
      const h = 4 + ((k * 3) % 4);
      for (let i = 0; i < h; i++) t.set(Math.round(x0 + (i % 2)), 31 - i, kit.ramp(ramp, 0.3 + i / (h * 1.5)));
    }
  },
  nether_wart_block: (t, kit) => paintWart(t, kit, [0x4a0404, 0x6a0808, 0x880e0e, 0xa41616, 0xc02020]),
  warped_wart_block: (t, kit) => paintWart(t, kit, [0x064844, 0x0c605a, 0x127a72, 0x1a9488, 0x26ae9e]),
  shroomlight: (t, kit) => paintWart(t, kit, [0xa8401a, 0xd06424, 0xec8c34, 0xfab44e, 0xffdc86]),
  weeping_vines: (t, kit) => paintVines(t, kit, [0x6a0a12, 0x94141c, 0xbc2028, 0xe03a3a], false, true),
  weeping_vines_plant: (t, kit) => paintVines(t, kit, [0x6a0a12, 0x94141c, 0xbc2028, 0xe03a3a], false, false),
  twisting_vines: (t, kit) => paintVines(t, kit, [0x0a5a56, 0x127a74, 0x1a9c92, 0x2ec0b0], true, true),
  twisting_vines_plant: (t, kit) => paintVines(t, kit, [0x0a5a56, 0x127a74, 0x1a9c92, 0x2ec0b0], true, false),
  crying_obsidian: paintCrying,
  respawn_anchor_side: (t, kit) => {
    paintCrying(t, kit);
    const g = R(kit, [0x7a4a12, 0xc08a2a, 0xf0c050]);
    for (let x = 0; x < 32; x++) for (let y = 0; y < 3; y++) t.set(x, y, g[(x + y) % 3]);
  },
  respawn_anchor_top_off: (t, kit) => {
    polished(t, kit, [0x0a0710, 0x120c1c, 0x1a1228, 0x261a3a, 0x3a2a56]);
    const d = kit.hex(0x050308);
    t.forEach((x, y) => {
      if (Math.hypot(x - 15.5, y - 15.5) < 8) t.set(x, y, d);
    });
  },
  respawn_anchor_top: (t, kit) => {
    polished(t, kit, [0x0a0710, 0x120c1c, 0x1a1228, 0x261a3a, 0x3a2a56]);
    const g = R(kit, [0x9a40f0, 0xc070ff, 0xffb0ff, 0xfff0ff]);
    t.forEach((x, y) => {
      const d = Math.hypot(x - 15.5, y - 15.5);
      if (d < 8) t.set(x, y, g[Math.min(3, Math.floor((8 - d) / 2.2 + t.rand() * 0.6))]);
    });
  },
  nether_portal: paintPortal,
  quartz_block_side: (t, kit) => polished(t, kit, [0xc6bcae, 0xd6cec2, 0xe2dcd2, 0xece8e0, 0xf6f4ee], false),
  quartz_block_top: (t, kit) => polished(t, kit, [0xc6bcae, 0xd6cec2, 0xe2dcd2, 0xece8e0, 0xf6f4ee]),
  chiseled_quartz_block: (t, kit) => {
    polished(t, kit, [0xc6bcae, 0xd6cec2, 0xe2dcd2, 0xece8e0, 0xf6f4ee]);
    const d = kit.hex(0xa89e90);
    for (let y = 5; y < 27; y += 7) for (let x = 5; x < 27; x++) t.set(x, y, d);
    for (let x = 5; x < 27; x += 7) for (let y = 5; y < 27; y++) t.set(x, y, d);
  },
  quartz_pillar: (t, kit) => striped(t, kit, [0xc6bcae, 0xd6cec2, 0xe2dcd2, 0xece8e0, 0xf6f4ee], 8, 0.3),
  quartz_pillar_top: (t, kit) => ringsTop(t, kit, [0xc6bcae, 0xd6cec2, 0xe2dcd2, 0xece8e0, 0xf6f4ee], 0.95),
  quartz_bricks: (t, kit) => bricks(t, kit, [0xc6bcae, 0xd6cec2, 0xe2dcd2, 0xece8e0, 0xf6f4ee], 0xa89e90, 16, 8),
  netherite_block: (t, kit) => polished(t, kit, [0x2a2526, 0x363031, 0x433c3d, 0x524a4a, 0x645a5a]),
  soul_fire: paintFlamesBlue,
  smithing_table_top: (t, kit) => {
    polished(t, kit, [0x22222a, 0x2c2c36, 0x383842, 0x46464e, 0x56565e]);
    const w = R(kit, [0x4a2a1a, 0x6a4026, 0x8a5634]);
    for (let x = 0; x < 32; x++) for (let y = 0; y < 32; y++) if (x < 3 || x > 28) t.set(x, y, w[(y >> 2) % 3]);
  },
  smithing_table_side: (t, kit) => {
    kit.base("planks", t);
    recolor(t, kit, [0x2e1a10, 0x40261a, 0x543224, 0x683e2c, 0x7a4a36, 0x8a5a44]);
    const iron = R(kit, [0x3a3a42, 0x56565e, 0x7a7a84]);
    for (let x = 0; x < 32; x++) for (let y = 0; y < 6; y++) t.set(x, y, iron[y < 2 ? 2 : 1]);
  },
  smithing_table_front: (t, kit) => {
    kit.base("planks", t);
    recolor(t, kit, [0x2e1a10, 0x40261a, 0x543224, 0x683e2c, 0x7a4a36, 0x8a5a44]);
    const iron = R(kit, [0x3a3a42, 0x56565e, 0x7a7a84, 0xa0a0a8]);
    for (let x = 0; x < 32; x++) for (let y = 0; y < 6; y++) t.set(x, y, iron[y < 2 ? 2 : 1]);
    // (the tools hung on its front)
    for (let y = 10; y < 26; y++) {
      t.set(9, y, iron[3]);
      t.set(10, y, iron[1]);
      t.set(22, y, iron[2]);
    }
    for (let x = 6; x < 14; x++) t.set(x, 10, iron[3]);
    for (let x = 19; x < 26; x++) t.set(x, 24, iron[3]);
  },
};
export const tileRelief = {
  netherrack: [1.1, 0.85, 0.55],
  soul_sand: [0.9, 0.95, 0.5],
  glowstone: [0.8, 0.5, 0.4],
  nether_bricks: [1, 0.8, 0.55],
  red_nether_bricks: [1, 0.8, 0.55],
  basalt_side: [1, 0.9, 0.5],
  blackstone: [0.9, 0.9, 0.5],
  magma: [0.9, 0.7, 0.4],
};

// ---------- Icons ----------

const NETHERITE_RAMP = [0x231e21, 0x372f33, 0x4b4245, 0x655a5b, 0x857878];
// A diamond tool's painting with the diamond's colours swapped for netherite's.
function netheriteTool(kit, type) {
  const px = kit.tool(type, "diamond");
  const from = kit.RAMPS.diamond;
  const to = NETHERITE_RAMP.map(kit.hex);
  for (let i = 0; i < px.length; i += 4) {
    const k = from.findIndex((c) => c[0] === px[i] && c[1] === px[i + 1] && c[2] === px[i + 2]);
    if (k < 0) continue;
    px[i] = to[k][0];
    px[i + 1] = to[k][1];
    px[i + 2] = to[k][2];
  }
  return px;
}
function dust(kit, ramp) {
  const c = new kit.Canvas();
  c.poly(0, [[5, 26], [10, 17], [16, 13], [22, 16], [27, 26]], (x, y) => (Math.sin(x * 1.7) * Math.cos(y * 1.9)) * 0.6);
  c.disc(0, 11, 12, 2.2);
  c.disc(0, 21, 10, 1.8);
  return c.render([kit.ramp(...ramp)]);
}
export const icons = {
  nether_quartz: (kit) => {
    const c = new kit.Canvas();
    c.poly(0, [[8, 24], [12, 8], [17, 4], [22, 9], [25, 22], [17, 28]], (x, y) => (x - 16) * -0.05 + (y < 12 ? 0.4 : 0));
    c.line(0, 12, 8, 17, 28, 1, () => -0.5);
    return c.render([kit.ramp(0xa89c90, 0xd2cabe, 0xece6dc, 0xfaf8f4, 0xffffff)], [70, 60, 54]);
  },
  glowstone_dust: (kit) => dust(kit, [0x9c6224, 0xd09038, 0xf4c25a, 0xffe08a, 0xfff4c8]),
  blaze_powder: (kit) => dust(kit, [0x9a3a08, 0xd06010, 0xf09020, 0xffc040, 0xffe890]),
  blaze_rod: (kit) => {
    const c = new kit.Canvas();
    c.line(0, 7, 26, 25, 6, 4.4, (x, y) => (x - y) * 0.03);
    return c.render([kit.ramp(0xa04a08, 0xe08010, 0xffb020, 0xffe060, 0xfff8c0)], [70, 30, 4]);
  },
  ghast_tear: (kit) => {
    const c = new kit.Canvas();
    c.poly(0, [[16, 4], [22, 16], [23, 21], [20, 27], [12, 27], [9, 21], [10, 16]], (x, y) => (x < 15 && y < 18 ? 0.6 : 0) - (y > 24 ? 0.3 : 0));
    return c.render([kit.ramp(0x8aa8b4, 0xb4ccd4, 0xd6e8ec, 0xeef8fa, 0xffffff)], [60, 80, 90]);
  },
  magma_cream: (kit) => {
    const c = new kit.Canvas();
    c.disc(0, 16, 17, 10, 9, (x, y) => (Math.sin(x * 1.3 + y) > 0.6 ? 0.8 : -0.2));
    c.disc(1, 13, 14, 2.4);
    c.disc(1, 19, 19, 2);
    return c.render([kit.ramp(0x3a1a08, 0x6a3010, 0xa05018, 0xd07a20, 0xf0a030), kit.ramp(0xa04008, 0xe07010, 0xffa020, 0xffd050, 0xfff0a0)], [30, 12, 4]);
  },
  nether_brick: (kit) => {
    const c = new kit.Canvas();
    c.poly(0, [[4, 18], [20, 9], [28, 13], [12, 23]], (x, y) => (y < 14 ? 0.4 : -0.1));
    c.poly(0, [[12, 23], [28, 13], [28, 17], [12, 27]], () => -0.6);
    c.poly(0, [[4, 18], [12, 23], [12, 27], [4, 22]], () => -0.3);
    return c.render([kit.ramp(0x1e0c10, 0x2e1418, 0x401c22, 0x56262e, 0x6e3440)], [10, 4, 6]);
  },
  netherite_scrap: (kit) => {
    const c = new kit.Canvas();
    c.poly(0, [[7, 20], [11, 10], [20, 7], [26, 13], [24, 24], [14, 27]], (x, y) => Math.sin(x * 0.9 + y * 0.6) * 0.5);
    return c.render([kit.ramp(0x2e2220, 0x4a3632, 0x664a44, 0x86645a, 0xa88276)], [20, 14, 12]);
  },
  netherite_ingot: (kit) => kit.ingot(NETHERITE_RAMP.map(kit.hex)),
  sword_netherite: (kit) => netheriteTool(kit, "sword"),
  pickaxe_netherite: (kit) => netheriteTool(kit, "pickaxe"),
  axe_netherite: (kit) => netheriteTool(kit, "axe"),
  shovel_netherite: (kit) => netheriteTool(kit, "shovel"),
  hoe_netherite: (kit) => netheriteTool(kit, "hoe"),
  armor_netherite_helmet: (kit) => kit.armor("helmet", NETHERITE_RAMP.map(kit.hex), [16, 12, 14]),
  armor_netherite_chestplate: (kit) => kit.armor("chestplate", NETHERITE_RAMP.map(kit.hex), [16, 12, 14]),
  armor_netherite_leggings: (kit) => kit.armor("leggings", NETHERITE_RAMP.map(kit.hex), [16, 12, 14]),
  armor_netherite_boots: (kit) => kit.armor("boots", NETHERITE_RAMP.map(kit.hex), [16, 12, 14]),
  fire_charge: (kit) => {
    const c = new kit.Canvas();
    c.disc(0, 16, 16, 10, 10, (x, y) => (x + y < 28 ? 0.5 : -0.2));
    c.line(1, 10, 12, 18, 16, 1.6);
    c.line(1, 18, 16, 22, 24, 1.4);
    c.line(1, 15, 8, 20, 11, 1.2);
    return c.render([kit.ramp(0x140c08, 0x2a1a10, 0x40281a, 0x583824, 0x704830), kit.ramp(0xa03008, 0xe06010, 0xffa020, 0xffd860, 0xfff8c0)], [8, 4, 2]);
  },
  netherite_upgrade: (kit) => {
    const c = new kit.Canvas();
    c.poly(0, [[6, 6], [26, 6], [26, 26], [6, 26]], (x, y) => (x + y < 20 ? 0.4 : 0) - (x + y > 44 ? 0.4 : 0));
    c.poly(1, [[11, 21], [16, 10], [21, 21]], () => 0.2);
    return c.render([kit.ramp(0x1e1c22, 0x2c2a32, 0x3c3a44, 0x4e4c58, 0x62606c), kit.ramp(0x3a2e2c, 0x5a4642, 0x7a625a, 0x9a8072, 0xbaa08e)], [10, 8, 12]);
  },
};
