// The id space and the core constants shared by the engine and the content
// modules (see ./index.js). A leaf module: it imports nothing, so a content
// module can import it at its top level without an import cycle (blocks.js
// and items.js import the content modules; they re-export everything here).
//
// Ids (blocks and items share one number space, saved in chunks, edits,
// inventories and chests, so an id never changes meaning):
//   0-255      the original blocks (unchanged meaning; one byte in old saves)
//   256-1023   items (tools, materials, food, weapons): never a block
//   1024-4095  the blocks added from Round 11 on (16-bit ids), by area:
//              1024-1535 building, 1536-1791 nature, 1792-1855 containers,
//              1856-2047 redstone, 2048-2303 decor, 2304-4063 free, 4064-4095 debug
// A block id is also the id of its item (when it is its own item: a wall
// torch counts as a torch). Chunks store ids in a Uint16Array; every
// per-block lookup table has BLOCK_LIMIT entries.

export const BLOCK_LIMIT = 4096;
export const ITEM_MIN = 256; // the first item id that is not a block
export const NEW_BLOCK_MIN = 1024; // the first of the 16-bit block ids

// An id that may be a block (0-255 or 1024-4095; 256-1023 are items).
export function isBlockId(id) {
  return Number.isInteger(id) && id >= 0 && id < BLOCK_LIMIT && (id < ITEM_MIN || id >= NEW_BLOCK_MIN);
}

export const BLOCK = Object.freeze({
  AIR: 0,
  GRASS: 1,
  DIRT: 2,
  STONE: 3,
  SAND: 4,
  WATER: 5,
  WOOD: 6,
  LEAVES: 7,
  PLANKS: 8,
  GLASS: 9,
  COBBLESTONE: 10,
  BEDROCK: 11,
  GRAVEL: 12,
  COAL_ORE: 13,
  IRON_ORE: 14,
  GOLD_ORE: 15,
  DIAMOND_ORE: 16,
  TORCH: 17,
  LUMEN: 18,
  CRAFTING_TABLE: 19,
  TALL_GRASS: 20,
  FLOWER_RED: 21,
  FLOWER_YELLOW: 22,
  BRICKS: 23,
  WOOL: 24,
  BIRCH_LOG: 25,
  BIRCH_LEAVES: 26,
  PINE_LOG: 27,
  PINE_LEAVES: 28,
  OAK_BARK: 29,
  SNOW: 30,
  TERRACOTTA: 31,
  CACTUS: 32,
  DEAD_BUSH: 33,
  CORAL: 34,
  SEAGRASS: 35,
  KELP: 36,
  // (Round 10) Wall torches and chests face one of four ways: one id per
  // facing (the block system has no metadata). See wallTorch() / chest().
  WALL_TORCH_PX: 37,
  WALL_TORCH_NX: 38,
  WALL_TORCH_PZ: 39,
  WALL_TORCH_NZ: 40,
  CHEST: 41, // (the item; its front faces +Z)
  CHEST_NZ: 42,
  CHEST_PX: 43,
  CHEST_NX: 44,
});

export const ITEM = Object.freeze({
  STICK: 256,
  COAL: 257,
  // 258 (iron ingot) and 260 (diamond) were removed in Round 6: nothing uses them. Never reuse the ids.
  GOLD_INGOT: 259,
  APPLE: 261,
  GOLDEN_APPLE: 262,
  RAW_MEAT: 263,
  COOKED_MEAT: 264,
  FLUFF: 265,
  WOOD_SWORD: 270,
  STONE_SWORD: 271,
  IRON_SWORD: 272,
  DIAMOND_SWORD: 273,
  WOOD_PICKAXE: 274,
  STONE_PICKAXE: 275,
  IRON_PICKAXE: 276,
  DIAMOND_PICKAXE: 277,
  WOOD_AXE: 278,
  STONE_AXE: 279,
  IRON_AXE: 280,
  DIAMOND_AXE: 281,
  WOOD_SHOVEL: 282,
  STONE_SHOVEL: 283,
  IRON_SHOVEL: 284,
  DIAMOND_SHOVEL: 285,
  GRENADE: 286,
  PISTOL: 287,
  BAZOOKA: 288,
  MACHINE_GUN: 289,
  SNIPER_RIFLE: 290,
  AIRSTRIKE: 291,
  LASER_BLASTER: 292,
  // 293 (the Jet Radio) was removed in Round 6: jets are taken from airports. Never reuse the id.
  RAILGUN: 294,
  MINIGUN: 295,
  // (296 was the shield, removed in Round 5: never reuse the id; old saves
  // that still hold one lose it on load.)
  BOW: 297,
  // Armor, four tiers of four pieces: leather, gold, iron, diamond.
  LEATHER_HELMET: 300,
  LEATHER_CHESTPLATE: 301,
  LEATHER_LEGGINGS: 302,
  LEATHER_BOOTS: 303,
  GOLD_HELMET: 304,
  GOLD_CHESTPLATE: 305,
  GOLD_LEGGINGS: 306,
  GOLD_BOOTS: 307,
  IRON_HELMET: 308,
  IRON_CHESTPLATE: 309,
  IRON_LEGGINGS: 310,
  IRON_BOOTS: 311,
  DIAMOND_HELMET: 312,
  DIAMOND_CHESTPLATE: 313,
  DIAMOND_LEGGINGS: 314,
  DIAMOND_BOOTS: 315,
});

// Render buckets and shapes (numeric for use in hot loops).
export const RENDER = Object.freeze({ NONE: 0, OPAQUE: 1, CUTOUT: 2, WATER: 3 });
// WALL_TORCH: a torch leaning out from the wall it hangs on; CHEST: a box a
// little smaller than a block (CHEST_BOX). A content module's own shapes
// (by name, see ./index.js) get the numbers from SHAPE_CUSTOM up.
export const SHAPE = Object.freeze({ CUBE: 0, CROSS: 1, TORCH: 2, WALL_TORCH: 3, CHEST: 4 });
export const SHAPE_CUSTOM = 16;

// Face order used everywhere: +X, -X, +Y (top), -Y (bottom), +Z, -Z.
export const FACE = Object.freeze({ PX: 0, NX: 1, PY: 2, NY: 3, PZ: 4, NZ: 5 });

// The engine's tables and helpers for content code that runs later (use
// handlers, random ticks, mesh shapes): a content module can't import
// blocks.js or items.js (they import it), so they fill this in as they load.
// blocks.js: BLOCK_INFO, IS_SOLID, IS_OPAQUE, IS_REPLACEABLE, ITEM_OF,
// FACE_TILES, isSupportedBy, isWallSupportedBy; items.js: itemInfo,
// maxStack, canHarvest, breakTime, blockDrops. (Only blocks.js in a worker:
// the mesher's shapes may use its part.) Read it only inside functions,
// never at a module's top level.
export const LIB = {};
