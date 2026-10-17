// Crafting and smelting recipes (Round 11, Survival worlds), vanilla rules:
// a shaped recipe matches anywhere in the grid (the box of its filled cells,
// the empty rows and columns around it trimmed) and mirrored left to right;
// a shapeless one in any order; an ingredient may be any of several ids
// ("any planks", "any log", "any wool"). The core recipes are here (the
// game's own blocks, the tools and armor, the vanilla items); the content
// modules add theirs (js/content/index.js recipes()), tried first. A recipe
// whose result doesn't exist (another module's item not in yet, or a mod item
// with Mods off) is skipped, so a later one can stand in (birch planks from a
// birch log, else oak). The furnace (js/furnace.js) reads the smelting
// recipes and the fuels from the same lists. Pure logic (no DOM).
import { BLOCK } from "./blocks.js";
import { ITEM, itemInfo, maxStack, itemAllowed } from "./items.js";
import { makeStack } from "./inventory.js";
import * as ID from "./content/ids.js";
import { recipes as contentRecipes } from "./content/index.js";

export const TICKS_PER_SECOND = 20; // (vanilla's game ticks: burn and cook times are counted in them)
const SMELT_SECONDS = 10; // (vanilla: 200 ticks per item)

// n consecutive ids from `first` (none when the constant isn't there).
const run = (first, n) => (Number.isInteger(first) ? Array.from({ length: n }, (_, i) => first + i) : []);
const ids = (...list) => list.filter((id) => Number.isInteger(id));

export const PLANKS = ids(BLOCK.PLANKS, ID.SPRUCE_PLANKS, ID.BIRCH_PLANKS, ID.JUNGLE_PLANKS, ID.ACACIA_PLANKS, ID.DARK_OAK_PLANKS);
export const LOGS = ids(BLOCK.WOOD, BLOCK.OAK_BARK, BLOCK.BIRCH_LOG, BLOCK.PINE_LOG, ID.JUNGLE_LOG, ID.ACACIA_LOG, ID.DARK_OAK_LOG);
export const WOOLS = ids(BLOCK.WOOL, ...run(ID.ORANGE_WOOL, 15));
const CARPETS = run(ID.WHITE_CARPET, 16);
const SAPLINGS = run(ID.OAK_SAPLING, 6);
const WOOD_SLABS = ids(ID.OAK_SLAB, ID.SPRUCE_SLAB, ID.BIRCH_SLAB, ID.JUNGLE_SLAB, ID.ACACIA_SLAB, ID.DARK_OAK_SLAB);
const WOOD_STAIRS = ids(ID.OAK_STAIRS, ID.SPRUCE_STAIRS, ID.BIRCH_STAIRS, ID.JUNGLE_STAIRS, ID.ACACIA_STAIRS, ID.DARK_OAK_STAIRS);
const WOOD_FENCES = ids(ID.OAK_FENCE, ID.SPRUCE_FENCE, ID.BIRCH_FENCE, ID.JUNGLE_FENCE, ID.ACACIA_FENCE, ID.DARK_OAK_FENCE);
const WOOD_GATES = ids(ID.OAK_FENCE_GATE, ID.SPRUCE_FENCE_GATE, ID.BIRCH_FENCE_GATE, ID.JUNGLE_FENCE_GATE, ID.ACACIA_FENCE_GATE, ID.DARK_OAK_FENCE_GATE);
const WOOD_DOORS = ids(ID.OAK_DOOR, ID.SPRUCE_DOOR, ID.BIRCH_DOOR);
const COALS = ids(ITEM.COAL, ID.CHARCOAL);

// Items that leave something in the grid when used (the cake's milk leaves its
// buckets; a lava bucket burnt as fuel leaves the bucket in the fuel slot).
// A content item may say so itself (craftRemainder).
const REMAINDERS = new Map(ids(ID.MILK_BUCKET, ID.WATER_BUCKET, ID.LAVA_BUCKET).map((id) => [id, ID.BUCKET]));
export function craftRemainder(id) {
  const own = itemInfo(id)?.craftRemainder;
  if (Number.isInteger(own)) return own;
  return REMAINDERS.get(id) ?? 0;
}

const shaped = (pattern, key, result, count = 1) => ({ type: "shaped", pattern, key, result: [result, count] });
const shapeless = (ingredients, result, count = 1) => ({ type: "shapeless", ingredients, result: [result, count] });
const smelt = (input, result, xp) => ({ type: "smelting", input, result: [result, 1], xp, time: SMELT_SECONDS });
const fuel = (input, seconds) => ({ type: "fuel", input, time: seconds });

// The core recipes (vanilla's, for the things that exist).
function coreRecipes() {
  const R = [];
  // Planks: four from a log of each wood (its own planks; oak while that wood's planks aren't in).
  R.push(shapeless([BLOCK.WOOD], BLOCK.PLANKS, 4), shapeless([BLOCK.OAK_BARK], BLOCK.PLANKS, 4));
  for (const [log, planks] of [
    [BLOCK.BIRCH_LOG, ID.BIRCH_PLANKS],
    [BLOCK.PINE_LOG, ID.SPRUCE_PLANKS],
    [ID.JUNGLE_LOG, ID.JUNGLE_PLANKS],
    [ID.ACACIA_LOG, ID.ACACIA_PLANKS],
    [ID.DARK_OAK_LOG, ID.DARK_OAK_PLANKS],
  ]) {
    R.push(shapeless([log], planks, 4), shapeless([log], BLOCK.PLANKS, 4));
  }
  // (Oak wood, bark all round, from four logs.)
  R.push(shaped(["##", "##"], { "#": BLOCK.WOOD }, BLOCK.OAK_BARK, 3));
  R.push(shaped(["#", "#"], { "#": PLANKS }, ITEM.STICK, 4));
  R.push(shaped(["##", "##"], { "#": PLANKS }, BLOCK.CRAFTING_TABLE));
  R.push(shaped(["###", "# #", "###"], { "#": PLANKS }, BLOCK.CHEST));
  R.push(shaped(["###", "# #", "###"], { "#": BLOCK.COBBLESTONE }, ID.FURNACE));
  R.push(shaped(["X", "#"], { X: COALS, "#": ITEM.STICK }, BLOCK.TORCH, 4));
  // Tools and weapons: wood (any planks), stone (cobblestone), iron, gold, diamond.
  const mats = [
    [PLANKS, ITEM.WOOD_SWORD, ITEM.WOOD_PICKAXE, ITEM.WOOD_AXE, ITEM.WOOD_SHOVEL, ID.WOODEN_HOE],
    [BLOCK.COBBLESTONE, ITEM.STONE_SWORD, ITEM.STONE_PICKAXE, ITEM.STONE_AXE, ITEM.STONE_SHOVEL, ID.STONE_HOE],
    [ID.IRON_INGOT, ITEM.IRON_SWORD, ITEM.IRON_PICKAXE, ITEM.IRON_AXE, ITEM.IRON_SHOVEL, ID.IRON_HOE],
    [ITEM.GOLD_INGOT, ID.GOLDEN_SWORD, ID.GOLDEN_PICKAXE, ID.GOLDEN_AXE, ID.GOLDEN_SHOVEL, ID.GOLDEN_HOE],
    [ID.DIAMOND, ITEM.DIAMOND_SWORD, ITEM.DIAMOND_PICKAXE, ITEM.DIAMOND_AXE, ITEM.DIAMOND_SHOVEL, ID.DIAMOND_HOE],
  ];
  for (const [m, sword, pick, axe, shovel, hoe] of mats) {
    const key = { X: m, "#": ITEM.STICK };
    R.push(shaped(["X", "X", "#"], key, sword));
    R.push(shaped(["XXX", " # ", " # "], key, pick));
    R.push(shaped(["XX", "X#", " #"], key, axe));
    R.push(shaped(["X", "#", "#"], key, shovel));
    R.push(shaped(["XX", " #", " #"], key, hoe));
  }
  // Armor (chainmail can't be crafted in vanilla).
  const armor = [
    [ID.LEATHER, "LEATHER"],
    [ID.IRON_INGOT, "IRON"],
    [ITEM.GOLD_INGOT, "GOLD"],
    [ID.DIAMOND, "DIAMOND"],
  ];
  for (const [m, tier] of armor) {
    const key = { X: m };
    R.push(shaped(["XXX", "X X"], key, ITEM[`${tier}_HELMET`]));
    R.push(shaped(["X X", "XXX", "XXX"], key, ITEM[`${tier}_CHESTPLATE`]));
    R.push(shaped(["XXX", "X X", "X X"], key, ITEM[`${tier}_LEGGINGS`]));
    R.push(shaped(["X X", "X X"], key, ITEM[`${tier}_BOOTS`]));
  }
  R.push(shaped(["W#W", "WWW", " W "], { W: PLANKS, "#": ID.IRON_INGOT }, ID.SHIELD));
  // Storage blocks and back to nine; nuggets and ingots.
  const nine = ["###", "###", "###"];
  for (const [block, item] of [
    [ID.IRON_BLOCK, ID.IRON_INGOT],
    [ID.GOLD_BLOCK, ITEM.GOLD_INGOT],
    [ID.DIAMOND_BLOCK, ID.DIAMOND],
    [ID.EMERALD_BLOCK, ID.EMERALD],
    [ID.LAPIS_BLOCK, ID.LAPIS_LAZULI],
    [ID.REDSTONE_BLOCK, ID.REDSTONE],
    [ID.COAL_BLOCK, ITEM.COAL],
    [ID.COPPER_BLOCK, ID.COPPER_INGOT],
    [ID.HAY_BLOCK, ID.WHEAT],
  ]) {
    R.push(shaped(nine, { "#": item }, block), shapeless([block], item, 9));
  }
  R.push(shaped(nine, { "#": ID.IRON_NUGGET }, ID.IRON_INGOT), shapeless([ID.IRON_INGOT], ID.IRON_NUGGET, 9));
  R.push(shaped(nine, { "#": ID.GOLD_NUGGET }, ITEM.GOLD_INGOT), shapeless([ITEM.GOLD_INGOT], ID.GOLD_NUGGET, 9));
  R.push(shaped(nine, { "#": ID.MELON_SLICE }, ID.MELON));
  // Iron and odds and ends.
  R.push(shaped(["# #", " # "], { "#": ID.IRON_INGOT }, ID.BUCKET));
  R.push(shaped([" #", "# "], { "#": ID.IRON_INGOT }, ID.SHEARS));
  R.push(shapeless([ID.IRON_INGOT, ID.FLINT], ID.FLINT_AND_STEEL));
  R.push(shaped([" # ", "#X#", " # "], { "#": ID.IRON_INGOT, X: ID.REDSTONE }, ID.COMPASS));
  R.push(shaped([" # ", "#X#", " # "], { "#": ITEM.GOLD_INGOT, X: ID.REDSTONE }, ID.CLOCK));
  R.push(shaped(["###", "###"], { "#": ID.IRON_INGOT }, ID.IRON_BARS, 16));
  R.push(shaped(["# #", "# #", "###"], { "#": ID.IRON_INGOT }, ID.CAULDRON));
  R.push(shaped(["III", " i ", "iii"], { I: ID.IRON_BLOCK, i: ID.IRON_INGOT }, ID.ANVIL));
  R.push(shaped([" #X", "# X", " #X"], { "#": ITEM.STICK, X: ID.STRING }, ITEM.BOW));
  R.push(shaped(["X", "#", "Y"], { X: ID.FLINT, "#": ITEM.STICK, Y: ID.FEATHER }, ID.ARROW, 4));
  R.push(shaped(["  #", " #X", "# X"], { "#": ITEM.STICK, X: ID.STRING }, ID.FISHING_ROD));
  R.push(shaped(["###"], { "#": ID.SUGAR_CANE }, ID.PAPER, 3));
  R.push(shapeless([ID.PAPER, ID.PAPER, ID.PAPER, ID.LEATHER], ID.BOOK));
  R.push(shaped(["###", "XXX", "###"], { "#": PLANKS, X: ID.BOOK }, ID.BOOKSHELF));
  R.push(shaped([" B ", "D#D", "###"], { B: ID.BOOK, D: ID.DIAMOND, "#": ID.OBSIDIAN }, ID.ENCHANTING_TABLE));
  R.push(shaped(["PSP", "P P", "PSP"], { P: PLANKS, S: WOOD_SLABS }, ID.BARREL));
  R.push(shaped(["# #", " # "], { "#": PLANKS }, ID.BOWL, 4));
  R.push(shaped(["# #", " # "], { "#": BLOCK.GLASS }, ID.GLASS_BOTTLE, 3));
  R.push(shaped(["###", "###"], { "#": BLOCK.GLASS }, ID.GLASS_PANE, 16));
  R.push(shaped(["# #", "###", "# #"], { "#": ITEM.STICK }, ID.LADDER, 3));
  // (Only the red bed exists: any wool makes it.)
  R.push(shaped(["###", "XXX"], { "#": WOOLS, X: PLANKS }, ID.RED_BED));
  R.push(shaped(["##", "##"], { "#": ID.STRING }, BLOCK.WOOL));
  R.push(shaped(["##", "##"], { "#": BLOCK.STONE }, ID.STONE_BRICKS, 4));
  R.push(shaped(["##", "##"], { "#": ID.SNOWBALL }, BLOCK.SNOW));
  R.push(shaped(["###"], { "#": BLOCK.SNOW }, ID.SNOW_LAYER, 6));
  R.push(shaped(["##", "##"], { "#": ID.BRICK }, BLOCK.BRICKS));
  R.push(shaped(["##", "##"], { "#": ID.CLAY_BALL }, ID.CLAY));
  R.push(shaped(nine, { "#": ID.ICE }, ID.PACKED_ICE));
  R.push(shaped(["DG", "GD"], { D: BLOCK.DIRT, G: BLOCK.GRAVEL }, ID.COARSE_DIRT, 4));
  R.push(shaped(["A", "B"], { A: ID.CARVED_PUMPKIN, B: BLOCK.TORCH }, ID.JACK_O_LANTERN));
  R.push(shaped(["X#X", "#X#", "X#X"], { X: ID.GUNPOWDER, "#": BLOCK.SAND }, ID.TNT));
  // Food.
  R.push(shaped(["###"], { "#": ID.WHEAT }, ID.BREAD));
  R.push(shaped(["AAA", "BEB", "CCC"], { A: ID.MILK_BUCKET, B: ID.SUGAR, E: ID.EGG, C: ID.WHEAT }, ID.CAKE));
  R.push(shaped(["#X#"], { "#": ID.WHEAT, X: ID.COCOA_BEANS }, ID.COOKIE, 8));
  R.push(shapeless([ID.PUMPKIN, ID.SUGAR, ID.EGG], ID.PUMPKIN_PIE));
  R.push(shaped(["###", "#X#", "###"], { "#": ITEM.GOLD_INGOT, X: ITEM.APPLE }, ITEM.GOLDEN_APPLE));
  R.push(shaped(["###", "#X#", "###"], { "#": ID.GOLD_NUGGET, X: ID.CARROT }, ID.GOLDEN_CARROT));
  R.push(shapeless([ID.BOWL, ID.BROWN_MUSHROOM, ID.RED_MUSHROOM], ID.MUSHROOM_STEW));
  R.push(shaped(["OOO", "OOO", " B "], { O: ID.BEETROOT, B: ID.BOWL }, ID.BEETROOT_SOUP));
  R.push(shapeless([ID.SUGAR_CANE], ID.SUGAR));
  R.push(shapeless([ID.BONE], ID.BONE_MEAL, 3));
  R.push(shapeless([ID.MELON_SLICE], ID.MELON_SEEDS));
  R.push(shapeless([ID.PUMPKIN], ID.PUMPKIN_SEEDS, 4));

  // Smelting (vanilla's experience per item; 10 s each).
  for (const [input, out, xp] of [
    [ID.RAW_IRON, ID.IRON_INGOT, 0.7],
    [BLOCK.IRON_ORE, ID.IRON_INGOT, 0.7],
    [ID.RAW_GOLD, ITEM.GOLD_INGOT, 1],
    [BLOCK.GOLD_ORE, ITEM.GOLD_INGOT, 1],
    [ID.RAW_COPPER, ID.COPPER_INGOT, 0.7],
    [ID.COPPER_ORE, ID.COPPER_INGOT, 0.7],
    [BLOCK.DIAMOND_ORE, ID.DIAMOND, 1],
    [ID.EMERALD_ORE, ID.EMERALD, 1],
    [ID.LAPIS_ORE, ID.LAPIS_LAZULI, 0.2],
    [ID.REDSTONE_ORE, ID.REDSTONE, 0.3],
    [BLOCK.COAL_ORE, ITEM.COAL, 0.1],
    [BLOCK.SAND, BLOCK.GLASS, 0.1],
    [ID.RED_SAND, BLOCK.GLASS, 0.1],
    [BLOCK.COBBLESTONE, BLOCK.STONE, 0.1],
    [BLOCK.STONE, ID.SMOOTH_STONE, 0.1],
    [ID.STONE_BRICKS, ID.CRACKED_STONE_BRICKS, 0.1],
    [ID.SANDSTONE, ID.SMOOTH_SANDSTONE, 0.1],
    [ID.CLAY, BLOCK.TERRACOTTA, 0.35],
    [ID.CLAY_BALL, ID.BRICK, 0.3],
    [ID.WET_SPONGE, ID.SPONGE, 0.15],
    [ITEM.RAW_MEAT, ITEM.COOKED_MEAT, 0.35],
    [ID.BEEF, ID.COOKED_BEEF, 0.35],
    [ID.PORKCHOP, ID.COOKED_PORKCHOP, 0.35],
    [ID.CHICKEN, ID.COOKED_CHICKEN, 0.35],
    [ID.MUTTON, ID.COOKED_MUTTON, 0.35],
    [ID.COD, ID.COOKED_COD, 0.35],
    [ID.SALMON, ID.COOKED_SALMON, 0.35],
    [ID.POTATO, ID.BAKED_POTATO, 0.35],
    [BLOCK.CACTUS, ID.GREEN_DYE, 1],
  ]) {
    R.push(smelt(input, out, xp));
  }
  R.push(smelt(LOGS, ID.CHARCOAL, 0.15));
  // (Iron and gold tools, weapons and armor melt down to a nugget.)
  const ironGear = ids(ITEM.IRON_SWORD, ITEM.IRON_PICKAXE, ITEM.IRON_AXE, ITEM.IRON_SHOVEL, ID.IRON_HOE, ITEM.IRON_HELMET, ITEM.IRON_CHESTPLATE, ITEM.IRON_LEGGINGS, ITEM.IRON_BOOTS, ...run(ID.CHAINMAIL_HELMET, 4));
  const goldGear = ids(ID.GOLDEN_SWORD, ID.GOLDEN_PICKAXE, ID.GOLDEN_AXE, ID.GOLDEN_SHOVEL, ID.GOLDEN_HOE, ITEM.GOLD_HELMET, ITEM.GOLD_CHESTPLATE, ITEM.GOLD_LEGGINGS, ITEM.GOLD_BOOTS);
  R.push(smelt(ironGear, ID.IRON_NUGGET, 0.1), smelt(goldGear, ID.GOLD_NUGGET, 0.1));

  // Fuel (vanilla burn times: 20 ticks a second).
  R.push(fuel(ID.LAVA_BUCKET, 1000), fuel(ID.COAL_BLOCK, 800), fuel(COALS, 80));
  R.push(fuel([...LOGS, ...PLANKS, ...WOOD_STAIRS, ...WOOD_FENCES, ...WOOD_GATES], 15));
  R.push(fuel(ids(BLOCK.CRAFTING_TABLE, BLOCK.CHEST, ID.BOOKSHELF, ID.BARREL, ID.NOTE_BLOCK, ID.LADDER, ID.OAK_TRAPDOOR, ID.OAK_PRESSURE_PLATE), 15));
  R.push(fuel(ids(ITEM.BOW, ID.FISHING_ROD), 15));
  R.push(fuel(WOOD_SLABS, 7.5), fuel(WOOD_DOORS, 10));
  R.push(fuel(ids(ITEM.WOOD_SWORD, ITEM.WOOD_PICKAXE, ITEM.WOOD_AXE, ITEM.WOOD_SHOVEL, ID.WOODEN_HOE), 10));
  R.push(fuel(ids(ITEM.STICK, ID.BOWL, ID.OAK_BUTTON, BLOCK.DEAD_BUSH, ...SAPLINGS, ...WOOLS), 5));
  R.push(fuel(CARPETS, 3.35));
  return R;
}

// ---------- The compiled lists ----------

// An ingredient as a Set of the ids it takes (null: nothing can match it).
function ingredient(ing) {
  const list = Array.isArray(ing) ? ing : [ing];
  const set = new Set(list.filter((id) => Number.isInteger(id) && itemInfo(id)));
  return set.size ? set : null;
}

// [id, count] -> { id, count } (null: no such item, or a mod item with Mods off).
function resultOf(r) {
  const [id, count = 1] = Array.isArray(r.result) ? r.result : [r.result, r.count];
  if (!Number.isInteger(id) || !itemInfo(id) || !(count >= 1)) return null;
  return { id, count: Math.min(Math.floor(count), maxStack(id)) };
}

let compiled = null;
function compile() {
  if (compiled) return compiled;
  const shapedList = [];
  const shapelessList = [];
  const smelting = new Map(); // input id -> { result: { id, count }, xp, ticks }
  const fuels = new Map(); // id -> burn ticks
  let all;
  try {
    all = [...contentRecipes(), ...coreRecipes()];
  } catch (err) {
    console.error(err);
    all = coreRecipes();
  }
  for (const r of all) {
    if (!r || typeof r !== "object") continue;
    if (r.type === "fuel") {
      const set = ingredient(r.input);
      const ticks = Math.round(Number(r.time) * TICKS_PER_SECOND);
      if (set && ticks > 0) for (const id of set) if (!fuels.has(id)) fuels.set(id, ticks);
      continue;
    }
    const result = resultOf(r);
    if (!result) continue;
    if (r.type === "smelting") {
      const set = ingredient(r.input);
      if (!set) continue;
      const entry = { result, xp: Math.max(0, Number(r.xp) || 0), ticks: Math.max(1, Math.round((Number(r.time) || SMELT_SECONDS) * TICKS_PER_SECOND)) };
      for (const id of set) if (!smelting.has(id)) smelting.set(id, entry);
    } else if (r.type === "shaped" && Array.isArray(r.pattern) && r.pattern.length) {
      const rows = r.pattern.map(String);
      const h = rows.length;
      const w = Math.max(...rows.map((s) => s.length));
      if (h > 3 || w > 3 || w < 1) continue;
      const cells = [];
      let ok = true;
      for (let y = 0; y < h && ok; y++) {
        for (let x = 0; x < w; x++) {
          const ch = rows[y][x] ?? " ";
          if (ch === " " || ch === ".") cells.push(null);
          else {
            const set = r.key ? ingredient(r.key[ch]) : null;
            if (!set) ok = false;
            cells.push(set);
          }
        }
      }
      if (ok && cells.some(Boolean)) shapedList.push({ w, h, cells, result, recipe: r });
    } else if (r.type === "shapeless" && Array.isArray(r.ingredients) && r.ingredients.length >= 1 && r.ingredients.length <= 9) {
      const ings = r.ingredients.map(ingredient);
      if (ings.every(Boolean)) shapelessList.push({ ings, result, recipe: r });
    }
  }
  compiled = { shaped: shapedList, shapeless: shapelessList, smelting, fuels };
  return compiled;
}

// (Tests, or a module that adds recipes late: the lists are built again on the next use.)
export function resetRecipes() {
  compiled = null;
}

export function recipeCount() {
  const c = compile();
  return c.shaped.length + c.shapeless.length;
}

// ---------- Matching ----------

function matchShaped(rec, ids, width, x0, y0, mirrored) {
  for (let y = 0; y < rec.h; y++) {
    for (let x = 0; x < rec.w; x++) {
      const want = rec.cells[y * rec.w + (mirrored ? rec.w - 1 - x : x)];
      const id = ids[(y0 + y) * width + x0 + x];
      if (want ? !want.has(id) : id !== 0) return false;
    }
  }
  return true;
}

// Each item to its own ingredient (any order; alternatives may overlap).
function matchShapeless(ings, items, used, k = 0) {
  if (k === items.length) return true;
  for (let i = 0; i < ings.length; i++) {
    if (used[i] || !ings[i].has(items[k])) continue;
    used[i] = true;
    if (matchShapeless(ings, items, used, k + 1)) return true;
    used[i] = false;
  }
  return false;
}

// The recipe for a grid: `ids` row-major (0: empty), `width` columns (2: the
// inventory's grid, 3: the table's). Returns { id, count } or null.
export function craftResult(ids, width) {
  const c = compile();
  const height = Math.ceil(ids.length / width);
  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;
  const items = [];
  for (let i = 0; i < ids.length; i++) {
    if (!ids[i]) continue;
    const x = i % width;
    const y = (i / width) | 0;
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
    items.push(ids[i]);
  }
  if (!items.length) return null;
  const w = maxX - minX + 1;
  const h = maxY - minY + 1;
  for (const rec of c.shaped) {
    if (rec.w !== w || rec.h !== h || !itemAllowed(rec.result.id)) continue;
    if (matchShaped(rec, ids, width, minX, minY, false) || matchShaped(rec, ids, width, minX, minY, true)) return rec.result;
  }
  for (const rec of c.shapeless) {
    if (rec.ings.length !== items.length || !itemAllowed(rec.result.id)) continue;
    if (matchShapeless(rec.ings, items, new Array(rec.ings.length).fill(false))) return rec.result;
  }
  return null;
}

// The grid's ids (0 for an empty slot), into `out` (reused).
export function gridIds(grid, out = []) {
  out.length = grid.length;
  for (let i = 0; i < grid.length; i++) out[i] = grid[i] ? grid[i].id : 0;
  return out;
}

// One craft taken: every filled slot of the grid (stacks or null) loses one
// item; a container left behind (a milk bucket's bucket) takes the emptied
// slot, or is returned in the list when the slot still holds items.
export function consumeGrid(grid) {
  const left = [];
  for (let i = 0; i < grid.length; i++) {
    const s = grid[i];
    if (!s) continue;
    const rem = craftRemainder(s.id);
    s.count -= 1;
    if (s.count <= 0) grid[i] = null;
    if (rem && itemInfo(rem)) {
      if (!grid[i]) grid[i] = makeStack(rem, 1);
      else left.push(makeStack(rem, 1));
    }
  }
  return left;
}

// ---------- Smelting and fuel ----------

// What item `id` smelts into: { result: { id, count }, xp, ticks }, or null.
export function smeltingOf(id) {
  return compile().smelting.get(id) || null;
}

// How long item `id` burns, in ticks (0: not a fuel).
export function burnTicks(id) {
  return compile().fuels.get(id) || 0;
}

export function isFuel(id) {
  return burnTicks(id) > 0;
}
