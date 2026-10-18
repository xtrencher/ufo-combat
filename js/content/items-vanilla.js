// Vanilla items (Round 11): ingots and gems, mob drops, foods, buckets, flint
// and steel, shears, hoes, gold tools, arrows, fishing rods, the compass and
// the clock, chainmail, the shield; (Round 11, wave C) the potions (drunk,
// thrown as splash potions), the brewing ingredients, the enchanted book and
// the bottle o' enchanting, glass bottles filled at water.
// Ids: items 320-399 and 480-639. What a content module may export, and its rules (imports only
// ./base.js and other content modules' id constants): see ./index.js.
//
// Item fields used here beyond index.js's: food { hunger, saturation } (the
// classic game's points; items.js explains heal, effects, alwaysEat,
// returns), drink (drunk, not eaten), clearEffects (milk), throwable (an egg,
// a snowball, an ender pearl: js/entities.js Throwables), tool { type,
// material } (a material's numbers, filled in by items.js), shield.
// The uses that need the engine (the fishing bobber, thrown items) reach it
// through ctx.interaction.weapons (js/weapons.js builds both). Potions:
// `potion` { key, color, effects: [{ id, level, seconds }] } (drunk by
// js/interaction.js, in either world; `splash`: thrown instead, js/brewing.js
// through LIB.throwPotion, as the bottle o' enchanting).
import { BLOCK, LIB } from "./base.js";
import * as V from "./ids.js";
import { flammability } from "./nature.js";

// (Round 11, wave C) Brewing's two crafted ingredients, and the potions' ids
// (POTIONS below: 480 on).
export const FERMENTED_SPIDER_EYE = 394;
export const GLISTERING_MELON_SLICE = 395;
const POTION_FIRST = 480;

const food = (hunger, saturation) => ({ hunger, saturation });
const effect = (id, seconds, chance = 1, level = 1) => ({ id, level, seconds, chance });

export const items = {
  // ---- Materials ----
  [V.IRON_INGOT]: { name: "Iron Ingot", icon: "iron_ingot" },
  [V.IRON_NUGGET]: { name: "Iron Nugget", icon: "iron_nugget" },
  [V.GOLD_NUGGET]: { name: "Gold Nugget", icon: "gold_nugget" },
  [V.DIAMOND]: { name: "Diamond", icon: "diamond" },
  [V.EMERALD]: { name: "Emerald", icon: "emerald" },
  [V.LAPIS_LAZULI]: { name: "Lapis Lazuli", icon: "lapis_lazuli" },
  [V.REDSTONE]: { name: "Redstone Dust", icon: "redstone" },
  [V.COPPER_INGOT]: { name: "Copper Ingot", icon: "copper_ingot" },
  [V.RAW_IRON]: { name: "Raw Iron", icon: "raw_iron" },
  [V.RAW_GOLD]: { name: "Raw Gold", icon: "raw_gold" },
  [V.RAW_COPPER]: { name: "Raw Copper", icon: "raw_copper" },
  [V.FLINT]: { name: "Flint", icon: "flint" },
  [V.CHARCOAL]: { name: "Charcoal", icon: "charcoal" },
  [V.LEATHER]: { name: "Leather", icon: "leather" },
  [V.FEATHER]: { name: "Feather", icon: "feather" },
  [V.STRING]: { name: "String", icon: "string" },
  [V.BONE]: { name: "Bone", icon: "bone" },
  [V.GUNPOWDER]: { name: "Gunpowder", icon: "gunpowder" },
  [V.ROTTEN_FLESH]: { name: "Rotten Flesh", icon: "rotten_flesh", food: food(4, 0.8), effects: [effect("hunger", 30, 0.8)] },
  [V.EGG]: { name: "Egg", icon: "egg", stack: 16, throwable: true },
  [V.SLIME_BALL]: { name: "Slimeball", icon: "slime_ball" },
  [V.ENDER_PEARL]: { name: "Ender Pearl", icon: "ender_pearl", stack: 16, throwable: true },
  [V.SPIDER_EYE]: { name: "Spider Eye", icon: "spider_eye", food: food(2, 3.2), effects: [effect("poison", 5)] },
  [V.PAPER]: { name: "Paper", icon: "paper" },
  [V.BOOK]: { name: "Book", icon: "book" },
  [V.GLASS_BOTTLE]: { name: "Glass Bottle", icon: "glass_bottle" },
  [V.BOWL]: { name: "Bowl", icon: "bowl" },

  // ---- Food (the classic game's hunger points and saturation) ----
  [V.BREAD]: { name: "Bread", icon: "bread", food: food(5, 6) },
  [V.BEEF]: { name: "Raw Beef", icon: "beef", food: food(3, 1.8) },
  [V.COOKED_BEEF]: { name: "Steak", icon: "cooked_beef", food: food(8, 12.8) },
  [V.PORKCHOP]: { name: "Raw Porkchop", icon: "porkchop", food: food(3, 1.8) },
  [V.COOKED_PORKCHOP]: { name: "Cooked Porkchop", icon: "cooked_porkchop", food: food(8, 12.8) },
  [V.CHICKEN]: { name: "Raw Chicken", icon: "chicken", food: food(2, 1.2), effects: [effect("hunger", 30, 0.3)] },
  [V.COOKED_CHICKEN]: { name: "Cooked Chicken", icon: "cooked_chicken", food: food(6, 7.2) },
  [V.MUTTON]: { name: "Raw Mutton", icon: "mutton", food: food(2, 1.2) },
  [V.COOKED_MUTTON]: { name: "Cooked Mutton", icon: "cooked_mutton", food: food(6, 9.6) },
  [V.COD]: { name: "Raw Cod", icon: "cod", food: food(2, 0.4) },
  [V.COOKED_COD]: { name: "Cooked Cod", icon: "cooked_cod", food: food(5, 6) },
  [V.SALMON]: { name: "Raw Salmon", icon: "salmon", food: food(2, 0.4) },
  [V.COOKED_SALMON]: { name: "Cooked Salmon", icon: "cooked_salmon", food: food(6, 9.6) },
  [V.BAKED_POTATO]: { name: "Baked Potato", icon: "baked_potato", food: food(5, 6) },
  [V.COOKIE]: { name: "Cookie", icon: "cookie", food: food(2, 0.4) },
  [V.PUMPKIN_PIE]: { name: "Pumpkin Pie", icon: "pumpkin_pie", food: food(8, 4.8) },
  [V.MUSHROOM_STEW]: { name: "Mushroom Stew", icon: "mushroom_stew", stack: 1, food: food(6, 7.2), returns: V.BOWL },
  [V.BEETROOT_SOUP]: { name: "Beetroot Soup", icon: "beetroot_soup", stack: 1, food: food(6, 7.2), returns: V.BOWL },
  [V.GOLDEN_CARROT]: { name: "Golden Carrot", icon: "golden_carrot", food: food(6, 14.4) },

  // ---- Buckets ----
  [V.BUCKET]: { name: "Bucket", icon: "bucket", stack: 16 },
  [V.WATER_BUCKET]: { name: "Water Bucket", icon: "water_bucket", stack: 1 },
  [V.LAVA_BUCKET]: { name: "Lava Bucket", icon: "lava_bucket", stack: 1 },
  // (Drunk like food: no hunger, clears every status effect, gives the bucket back.)
  [V.MILK_BUCKET]: { name: "Milk Bucket", icon: "milk_bucket", stack: 1, food: food(0, 0), drink: true, alwaysEat: true, clearEffects: true, returns: V.BUCKET },

  // ---- Tools (durability: the classic game's uses) ----
  [V.FLINT_AND_STEEL]: { name: "Flint and Steel", icon: "flint_and_steel", stack: 1, tool: { type: "flint_and_steel", durability: 65, damage: 1 } },
  [V.SHEARS]: { name: "Shears", icon: "shears", stack: 1, tool: { type: "shears", durability: 239, damage: 1 } },
  [V.FISHING_ROD]: { name: "Fishing Rod", icon: "fishing_rod", stack: 1, tool: { type: "fishing_rod", durability: 65, damage: 1 } },
  [V.ARROW]: { name: "Arrow", icon: "arrow" },
  [V.COMPASS]: { name: "Compass", icon: "compass" },
  [V.CLOCK]: { name: "Clock", icon: "clock" },
  [V.GOLDEN_SWORD]: { name: "Golden Sword", icon: "sword_gold", stack: 1, tool: { type: "sword", material: "gold" } },
  [V.GOLDEN_PICKAXE]: { name: "Golden Pickaxe", icon: "pickaxe_gold", stack: 1, tool: { type: "pickaxe", material: "gold" } },
  [V.GOLDEN_AXE]: { name: "Golden Axe", icon: "axe_gold", stack: 1, tool: { type: "axe", material: "gold" } },
  [V.GOLDEN_SHOVEL]: { name: "Golden Shovel", icon: "shovel_gold", stack: 1, tool: { type: "shovel", material: "gold" } },
  // (Tilling is the nature module's itemUse for the hoes.)
  [V.GOLDEN_HOE]: { name: "Golden Hoe", icon: "hoe_gold", stack: 1, tool: { type: "hoe", material: "gold" } },
  [V.WOODEN_HOE]: { name: "Wooden Hoe", icon: "hoe_wood", stack: 1, tool: { type: "hoe", material: "wood" } },
  [V.STONE_HOE]: { name: "Stone Hoe", icon: "hoe_stone", stack: 1, tool: { type: "hoe", material: "stone" } },
  [V.IRON_HOE]: { name: "Iron Hoe", icon: "hoe_iron", stack: 1, tool: { type: "hoe", material: "iron" } },
  [V.DIAMOND_HOE]: { name: "Diamond Hoe", icon: "hoe_diamond", stack: 1, tool: { type: "hoe", material: "diamond" } },

  // ---- Chainmail (points 2/5/4/1, an iron set's wear; armor tier: between gold and iron) ----
  [V.CHAINMAIL_HELMET]: { name: "Chainmail Helmet", icon: "armor_chain_helmet", stack: 1, armor: { slot: 0, tier: 1, points: 2, durability: 165 } },
  [V.CHAINMAIL_CHESTPLATE]: { name: "Chainmail Chestplate", icon: "armor_chain_chestplate", stack: 1, armor: { slot: 1, tier: 1, points: 5, durability: 240 } },
  [V.CHAINMAIL_LEGGINGS]: { name: "Chainmail Leggings", icon: "armor_chain_leggings", stack: 1, armor: { slot: 2, tier: 1, points: 4, durability: 225 } },
  [V.CHAINMAIL_BOOTS]: { name: "Chainmail Boots", icon: "armor_chain_boots", stack: 1, armor: { slot: 3, tier: 1, points: 1, durability: 195 } },
  // Held up while right click is held (shieldRaised below; the hits it stops
  // are the damage code's).
  [V.SHIELD]: { name: "Shield", icon: "shield", stack: 1, shield: true, tool: { type: "shield", durability: 337, damage: 1 } },
  // (A cake is a block in the classic game, eaten in seven bites: this item
  // places the decor part's cake block, js/content/decor.js itemUse.)
  [V.CAKE]: { name: "Cake", icon: "cake", stack: 1 },
  // (An enchanted book holds its enchantments in the stack's tag, js/enchant.js:
  // made at the table or found; a plain one in the palette would be empty.)
  [V.ENCHANTED_BOOK]: { name: "Enchanted Book", icon: "enchanted_book", stack: 1, creative: false },
  // (The potion item is the water bottle; the brewed ones follow, POTIONS.)
  [V.POTION]: { name: "Water Bottle", icon: "potion_water", stack: 1, potion: { key: "water", color: 0x385dc6, effects: [] } },
  // Thrown: 3-11 experience where it breaks (vanilla).
  [V.EXPERIENCE_BOTTLE]: { name: "Bottle o' Enchanting", icon: "experience_bottle" },
  [FERMENTED_SPIDER_EYE]: { name: "Fermented Spider Eye", icon: "fermented_spider_eye" },
  [GLISTERING_MELON_SLICE]: { name: "Glistering Melon Slice", icon: "glistering_melon_slice" },
};

// ---------- Potions (Round 11) ----------
// Vanilla's potions of what exists here (no Nether: no awkward potion, the
// ingredients brew straight from a water bottle, js/brewing.js): each kind
// with its effect and colour, the base time, the long one (redstone; 0:
// none) and the strong one (II, IV for slowness; null: none). Times are Java's.
const POTION_KINDS = [
  // [key, name, colour, effect, base s, long s, [strong level, strong s] | null]
  ["healing", "Healing", 0xf82423, "instant_health", 0, 0, [2, 0]],
  ["harming", "Harming", 0x430a09, "instant_damage", 0, 0, [2, 0]],
  ["poison", "Poison", 0x4e9331, "poison", 45, 90, [2, 21.6]],
  ["regeneration", "Regeneration", 0xcd5cab, "regeneration", 45, 90, [2, 22.5]],
  ["swiftness", "Swiftness", 0x7cafc6, "speed", 180, 480, [2, 90]],
  ["slowness", "Slowness", 0x5a6c81, "slowness", 90, 240, [4, 20]],
  ["strength", "Strength", 0x932423, "strength", 180, 480, [2, 90]],
  ["weakness", "Weakness", 0x484d48, "weakness", 90, 240, null],
  ["night_vision", "Night Vision", 0x1f1fa1, "night_vision", 180, 480, null],
  ["invisibility", "Invisibility", 0x7f8392, "invisibility", 180, 480, null],
  ["fire_resistance", "Fire Resistance", 0xe49a3a, "fire_resistance", 180, 480, null],
  ["water_breathing", "Water Breathing", 0x2e5299, "water_breathing", 180, 480, null],
];
// Every brewed potion: { id, splash (its splash potion's id), key, kind
// ("base", "long", "strong"), name, color, effects }. Ids from 480 in this
// order, the splash potions after them (an id never changes meaning).
export const POTIONS = [];
{
  const list = [];
  for (const [key, name, color, effect, base, long, strong] of POTION_KINDS) {
    list.push({ key, kind: "base", name, color, effects: [{ id: effect, level: 1, seconds: base }] });
    if (long) list.push({ key, kind: "long", name, color, effects: [{ id: effect, level: 1, seconds: long }] });
    if (strong) list.push({ key, kind: "strong", name, color, effects: [{ id: effect, level: strong[0], seconds: strong[1] }] });
  }
  list.forEach((p, i) => POTIONS.push({ ...p, id: POTION_FIRST + i, splash: POTION_FIRST + list.length + i }));
}
export const SPLASH_FIRST = POTION_FIRST + POTIONS.length;
for (const p of POTIONS) {
  const potion = { key: p.key, kind: p.kind, color: p.color, effects: p.effects };
  items[p.id] = { name: `Potion of ${p.name}`, icon: `potion_${p.key}`, stack: 1, potion };
  items[p.splash] = { name: `Splash Potion of ${p.name}`, icon: `splash_potion_${p.key}`, stack: 1, potion, splash: true };
}
// (A potion by its kind and variant, for the brewing recipes: "swiftness", "long".)
export function potionId(key, kind = "base", splash = false) {
  if (key === "water") return splash ? 0 : V.POTION;
  const p = POTIONS.find((x) => x.key === key && x.kind === kind);
  return p ? (splash ? p.splash : p.id) : 0;
}

export const blocks = {};
export const tiles = {};
export const shapes = {};
// (Round 11) The brewing ingredients (vanilla's recipes).
export const recipes = () => [
  { type: "shapeless", ingredients: [V.SPIDER_EYE, V.BROWN_MUSHROOM, V.SUGAR], result: [FERMENTED_SPIDER_EYE, 1] },
  { type: "shaped", pattern: ["###", "#M#", "###"], key: { "#": V.GOLD_NUGGET, M: V.MELON_SLICE }, result: [GLISTERING_MELON_SLICE, 1] },
];
export const randomTick = {};
export const drops = {};

// ---------- Uses ----------

// Whether this right click is the button held down (the use repeating every
// 0.22 s) rather than a fresh press: a bucket or a fishing rod acts once per
// press. (A press is fresh when the right button was let go since the last
// use: the weapon system counts the releases. ctx.repeat, if interaction.js
// passes it, says so directly.)
const lastUse = new WeakMap();
function repeated(ctx) {
  if (typeof ctx.repeat === "boolean") return ctx.repeat;
  const it = ctx.interaction;
  const n = it?.weapons?.rightReleases;
  if (typeof n !== "number") return false;
  const last = lastUse.get(it);
  lastUse.set(it, n);
  return last === n;
}

// The first water or lava source along the view, the way an empty bucket
// sees them (through air, flowing water and lava, and nothing solid or
// selectable), or null.
function sourceAlongView(ctx, reach) {
  const { BLOCK_INFO } = LIB;
  const world = ctx.world;
  const eye = ctx.player.getEyePosition();
  const [dx, dy, dz] = ctx.forward;
  let x = Math.floor(eye.x);
  let y = Math.floor(eye.y);
  let z = Math.floor(eye.z);
  const sx = dx > 0 ? 1 : -1;
  const sy = dy > 0 ? 1 : -1;
  const sz = dz > 0 ? 1 : -1;
  const tdx = dx ? Math.abs(1 / dx) : Infinity;
  const tdy = dy ? Math.abs(1 / dy) : Infinity;
  const tdz = dz ? Math.abs(1 / dz) : Infinity;
  let tx = dx ? (sx > 0 ? x + 1 - eye.x : eye.x - x) * tdx : Infinity;
  let ty = dy ? (sy > 0 ? y + 1 - eye.y : eye.y - y) * tdy : Infinity;
  let tz = dz ? (sz > 0 ? z + 1 - eye.z : eye.z - z) * tdz : Infinity;
  let t = 0;
  while (t <= reach) {
    const id = world.getBlock(x, y, z);
    const b = BLOCK_INFO[id];
    if (id === BLOCK.WATER && isWaterSource(world, x, y, z)) return { x, y, z, id };
    if (id === V.LAVA) return { x, y, z, id }; // (flowing lava has ids of its own)
    if (id !== BLOCK.AIR && !b?.liquid && !b?.lava && (!b || b.selectable)) return null;
    if (tx < ty && tx < tz) {
      x += sx;
      t = tx;
      tx += tdx;
    } else if (ty < tz) {
      y += sy;
      t = ty;
      ty += tdy;
    } else {
      z += sz;
      t = tz;
      tz += tdz;
    }
  }
  return null;
}

// Water the flowing-water sim made (not a source): main.js gives the world
// its WaterSim (world.waterSim); without one every water cell is a source.
function isWaterSource(world, x, y, z) {
  return !world.waterSim?.meta?.has(`${x},${y},${z}`);
}

// The held item becomes `id` (one of a stack: the rest stays, the new one
// goes into the inventory or to the ground). In Creative the held item stays;
// an empty bucket filled there also gives the full one if there is none.
function exchangeHeld(ctx, id) {
  const inv = ctx.inventory;
  const s = inv.selectedStack;
  if (!s) return;
  if (ctx.creative) {
    if (s.id === V.BUCKET && id !== V.BUCKET && inv.countItem(id) === 0) inv.add(id, 1);
    return;
  }
  if (s.count <= 1) {
    inv.slots[inv.selected] = { id, count: 1 };
    return;
  }
  s.count -= 1;
  const left = inv.add(id, 1);
  if (left > 0) ctx.interaction.throwStack?.({ id, count: left });
}

// The cell a bucket pours into: the block aimed at if it can be replaced (a
// plant, flowing water), else the cell in front of the face aimed at.
function pourCell(ctx) {
  if (ctx.x === null) return null;
  const { IS_REPLACEABLE } = LIB;
  if (IS_REPLACEABLE[ctx.id]) return [ctx.x, ctx.y, ctx.z];
  const p = ctx.place;
  return p && IS_REPLACEABLE[ctx.world.getBlock(p[0], p[1], p[2])] ? p : null;
}

function pour(ctx, liquid) {
  if (!LIB.BLOCK_INFO[liquid]) return false;
  const cell = pourCell(ctx);
  if (!cell) return false;
  const [x, y, z] = cell;
  const world = ctx.world;
  const here = world.getBlock(x, y, z);
  if (here === liquid) {
    // Flowing water topped up into a source: the sim forgets its flow.
    const ws = world.waterSim;
    const key = `${x},${y},${z}`;
    if (liquid !== BLOCK.WATER || !ws?.meta?.has(key)) return false;
    ws.meta.delete(key);
    ws.metaVersion++;
    ws.active?.add(key);
  } else if (!world.setBlock(x, y, z, liquid)) return false;
  ctx.audio.playSplash?.();
  exchangeHeld(ctx, V.BUCKET);
  return true;
}

function fill(ctx) {
  const reach = ctx.interaction?.reach ?? 5;
  const hit = sourceAlongView(ctx, reach);
  const full = hit ? (hit.id === BLOCK.WATER ? V.WATER_BUCKET : V.LAVA_BUCKET) : null;
  if (!full || !LIB.itemInfo(full) || !ctx.world.setBlock(hit.x, hit.y, hit.z, BLOCK.AIR)) return false;
  ctx.audio.playSplash?.();
  exchangeHeld(ctx, full);
  return true;
}

// A worn use of the held tool (none in Creative); plays the break sound.
function wear(ctx, n = 1) {
  if (ctx.creative) return;
  if (ctx.inventory.damageSelected(n)) ctx.audio.playToolBreak?.();
}

// Fire stays on a solid floor or next to something that burns (the classic rule).
const SIDES = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];
function fireCanStay(world, x, y, z) {
  const { IS_SOLID, IS_OPAQUE } = LIB;
  const below = world.getBlock(x, y - 1, z);
  if (IS_SOLID[below] && IS_OPAQUE[below]) return true;
  const ignite = flammability?.().ignite;
  return !!ignite && SIDES.some(([dx, dy, dz]) => ignite[world.getBlock(x + dx, y + dy, z + dz)] > 0);
}

// Flint and steel: lights TNT (the redstone module's LIB.igniteTnt), or sets
// fire to the cell in front of the face clicked (the nature module's fire).
function strike(ctx) {
  if (ctx.x === null) return false;
  const { BLOCK_INFO, IS_REPLACEABLE, IS_SOLID, isSupportedBy } = LIB;
  if (ctx.id === V.TNT && LIB.igniteTnt) {
    if (!LIB.igniteTnt(ctx.world, ctx.x, ctx.y, ctx.z, ctx)) return false;
  } else {
    if (!BLOCK_INFO[V.FIRE] || !IS_SOLID[ctx.id] || !ctx.place) return false;
    const [x, y, z] = ctx.place;
    const here = ctx.world.getBlock(x, y, z);
    if (here !== BLOCK.AIR && !(IS_REPLACEABLE[here] && !BLOCK_INFO[here]?.liquid)) return false;
    if (!isSupportedBy(V.FIRE, ctx.world.getBlock(x, y - 1, z)) || !fireCanStay(ctx.world, x, y, z)) return false;
    if (!ctx.world.setBlock(x, y, z, V.FIRE)) return false;
  }
  (ctx.audio.playIgnite || ctx.audio.playClick)?.call(ctx.audio);
  wear(ctx);
  return true;
}

// Shears on a pumpkin carve its face toward you and drop four seeds (unless
// the nature module's pumpkin does it itself: its block use comes first).
function carve(ctx) {
  const { BLOCK_INFO } = LIB;
  const carved = BLOCK_INFO[V.CARVED_PUMPKIN];
  if (ctx.id !== V.PUMPKIN || !carved) return false;
  const id = carved.placeAs ? carved.placeAs({ ...ctx, place: [ctx.x, ctx.y, ctx.z] }) : V.CARVED_PUMPKIN;
  if (!id || !BLOCK_INFO[id] || !ctx.world.setBlock(ctx.x, ctx.y, ctx.z, id)) return false;
  if (LIB.itemInfo(V.PUMPKIN_SEEDS) && !ctx.creative) {
    const at = ctx.player.position.clone().set(ctx.x + 0.5 + (ctx.normal?.[0] ?? 0) * 0.6, ctx.y + 0.5, ctx.z + 0.5 + (ctx.normal?.[2] ?? 0) * 0.6);
    ctx.entities.spawn(V.PUMPKIN_SEEDS, 4, at);
  }
  ctx.audio.playBreak?.("plant");
  wear(ctx);
  return true;
}

// Seconds since the page started (the shield's clock).
const now = () => performance.now() / 1000;

// Right click held with a shield keeps it up (renewed by the repeating use;
// not while an axe's blow has it disabled).
function raiseShield(ctx) {
  const p = ctx.player;
  const t = now();
  if (p.shieldDisabledUntil > t) return false;
  if (!(p.shieldRaisedUntil > t)) p.shieldRaisedAt = t;
  p.shieldRaisedUntil = t + 0.35;
  return false; // (nothing else happens: no swing)
}

// Whether the player's shield is up and working (raised for 0.25 s, as in
// the classic game) and the shield still in hand (either hand): the damage
// code turns away the hits from in front.
export function shieldRaised(player, inventory) {
  const t = now();
  const held = inventory?.selectedStack?.id === V.SHIELD || inventory?.offhand?.id === V.SHIELD;
  return held && player.shieldRaisedUntil > t && t - player.shieldRaisedAt >= 0.25 && !(player.shieldDisabledUntil > t);
}

// Whether the raised shield is the off hand's (wear it there, not the main hand's).
export function shieldInOffhand(inventory) {
  return inventory?.selectedStack?.id !== V.SHIELD && inventory?.offhand?.id === V.SHIELD;
}

// An axe's blow on a raised shield (vanilla): down, and not raised again for 5 s.
export function disableShield(player, seconds = 5) {
  player.shieldRaisedUntil = 0;
  player.shieldDisabledUntil = now() + seconds;
}

// The off hand's use when the main hand's did nothing (vanilla): its shield
// raised. ctx is the main hand's use context (js/interaction.js _useCtx).
export function offhandUse(ctx) {
  if (ctx.inventory?.offhand?.id !== V.SHIELD || ctx.stack?.id === V.SHIELD) return false;
  raiseShield(ctx);
  return true;
}

let pearlReady = 0;
function throwIt(ctx) {
  const thrower = ctx.interaction?.weapons?.throwables;
  if (!thrower || ctx.player.vehicle) return false;
  const id = ctx.stack.id;
  // (An ender pearl has a second's cooldown, in Creative too.)
  if (id === V.ENDER_PEARL) {
    if (now() < pearlReady) return false;
    pearlReady = now() + 1;
  }
  if (!thrower.throw(id)) return false;
  if (!ctx.creative) ctx.inventory.consumeSelected(1);
  return true;
}

// (Round 11) A glass bottle at water (any water along the view, as vanilla:
// the water stays) becomes a water bottle.
function waterAlongView(ctx, reach) {
  const { BLOCK_INFO } = LIB;
  const eye = ctx.player.getEyePosition();
  const [dx, dy, dz] = ctx.forward;
  const len = Math.hypot(dx, dy, dz) || 1;
  for (let t = 0; t <= reach; t += 0.1) {
    const x = Math.floor(eye.x + (dx / len) * t);
    const y = Math.floor(eye.y + (dy / len) * t);
    const z = Math.floor(eye.z + (dz / len) * t);
    const id = ctx.world.getBlock(x, y, z);
    if (id === BLOCK.WATER) return true;
    const b = BLOCK_INFO[id];
    if (id !== BLOCK.AIR && (b?.solid || (b && b.selectable && !b.liquid))) return false;
  }
  return false;
}
function fillBottle(ctx) {
  if (!LIB.itemInfo(V.POTION) || !waterAlongView(ctx, ctx.interaction?.reach ?? 5)) return false;
  ctx.audio.playSplash?.();
  exchangeHeld(ctx, V.POTION);
  return true;
}

// A splash potion or a bottle o' enchanting: thrown (js/brewing.js).
function throwBottle(ctx) {
  if (repeated(ctx) || ctx.player.vehicle || typeof LIB.throwPotion !== "function") return false;
  if (!LIB.throwPotion(ctx.stack.id)) return false;
  if (!ctx.creative) ctx.inventory.consumeSelected(1);
  return true;
}

export const itemUse = {
  [V.GLASS_BOTTLE]: (ctx) => !repeated(ctx) && fillBottle(ctx),
  [V.EXPERIENCE_BOTTLE]: throwBottle,
  [V.BUCKET]: (ctx) => !repeated(ctx) && fill(ctx),
  [V.WATER_BUCKET]: (ctx) => !repeated(ctx) && pour(ctx, BLOCK.WATER),
  [V.LAVA_BUCKET]: (ctx) => !repeated(ctx) && pour(ctx, V.LAVA),
  [V.FLINT_AND_STEEL]: (ctx) => strike(ctx),
  [V.SHEARS]: (ctx) => carve(ctx),
  [V.FISHING_ROD]: (ctx) => {
    const fishing = ctx.interaction?.weapons?.fishing;
    if (!fishing || repeated(ctx)) return false;
    return fishing.use(ctx);
  },
  [V.EGG]: throwIt,
  [V.ENDER_PEARL]: throwIt,
  // (The snowball is the nature module's item; its throw is here, with the others.)
  [V.SNOWBALL]: throwIt,
  [V.SHIELD]: raiseShield,
};
for (const p of POTIONS) itemUse[p.splash] = throwBottle;

// ---------- Icons ----------
// Drawn like the core icons (itemtextures.js): shapes in a colour ramp, lit
// from the top left, outlined. Ramps are five steps, dark to light.

const lit = (k = 0.4, d = -0.2, s = 30) => (x, y) => (x + y < s ? k : d);

function ramps(kit) {
  const r = (...h) => kit.ramp(...h);
  return {
    copper: r(0x6b3518, 0x9c4f26, 0xc46a38, 0xe08a55, 0xf5b48a),
    emerald: r(0x0b5a2a, 0x138a3e, 0x1fbf5a, 0x5fe38c, 0xc6ffd9),
    lapis: r(0x102a6b, 0x1d43a3, 0x2e62d0, 0x5a8aeb, 0xa9c4ff),
    redstone: r(0x4a0606, 0x7d0b0b, 0xb31212, 0xe02a1e, 0xff7a5c),
    flint: r(0x1d1d22, 0x2e2e35, 0x45454e, 0x63636d, 0x8c8c96),
    charcoal: r(0x120e0b, 0x221a14, 0x34281f, 0x4c3c2e, 0x6c5844),
    bone: r(0x9e9a84, 0xc2bea6, 0xdcd8c2, 0xefecdc, 0xffffff),
    powder: r(0x2a2a2a, 0x3d3d3d, 0x555555, 0x707070, 0x8e8e8e),
    rotten: r(0x3f3a12, 0x5f5a1c, 0x7d7a2c, 0x9b8f3e, 0xb9a85e),
    egg: r(0xa8946a, 0xcdb88c, 0xe6d6ae, 0xf3e8cc, 0xfffbee),
    slime: r(0x2f7a22, 0x4ea83a, 0x74cf58, 0x9fe882, 0xd8ffc8),
    pearl: r(0x052a26, 0x0b4a42, 0x17705f, 0x2fa086, 0x7fe0c8),
    paper: r(0xb9b3a0, 0xd6d0bd, 0xe9e4d4, 0xf6f3ea, 0xffffff),
    glass: r(0x6f8ea0, 0x93b3c4, 0xb7d3e0, 0xd8eef6, 0xffffff),
    bread: r(0x6a3e12, 0x94591e, 0xbd7a31, 0xd99c4f, 0xf0c27e),
    pork: r(0x9b4a52, 0xc96a72, 0xe58f94, 0xf4b4b5, 0xffd8d6),
    porkCooked: r(0x5e3416, 0x86501f, 0xab7032, 0xc9924e, 0xe2b880),
    chicken: r(0xb88b78, 0xd7a996, 0xe9c3b2, 0xf5dcd0, 0xfff1ea),
    chickenCooked: r(0x6e3d14, 0x99591f, 0xbe7a32, 0xd89c52, 0xedc283),
    mutton: r(0x7a1e26, 0xa53238, 0xc94f52, 0xe27877, 0xf3a8a4),
    cod: r(0x5a5242, 0x7e735a, 0xa19473, 0xc2b693, 0xe1d8bd),
    salmon: r(0x7a2a1c, 0xab412a, 0xd2623e, 0xec8a62, 0xf9b99a),
    potato: r(0x6b4417, 0x946024, 0xb98238, 0xd4a356, 0xebc888),
    pumpkin: r(0x7a3a06, 0xb05a0c, 0xd97b18, 0xf09c34, 0xffc77a),
    stew: r(0x3e2412, 0x5c3a1e, 0x7a512c, 0x986a3e, 0xb88a5a),
    soup: r(0x4a0812, 0x7a0f1c, 0xa31a2a, 0xc8323e, 0xe8626a),
    water: r(0x1b3f9e, 0x2a5bd0, 0x3f7cf0, 0x6aa0ff, 0xb5d2ff),
    pink: r(0x7a1e55, 0xa8307a, 0xd04e9e, 0xec7cc0, 0xffb6e2),
    xp: r(0x2a5a0a, 0x3f8a12, 0x5cbf22, 0x8ae24a, 0xc8ff8a),
    purple: r(0x2e1446, 0x45206a, 0x5e3090, 0x8050b8, 0xb488e0),
    chain: r(0x2e3236, 0x4a4f55, 0x6e747b, 0x979da4, 0xc4c9ce),
    leaf: kit.RAMPS.leaf,
  };
}
let RAMP = null;
const R = (kit) => (RAMP ||= ramps(kit));

// A lumpy chunk (raw ore, flint, a nugget): overlapping discs.
function lumps(kit, ramp, blobs, outline, extra) {
  const c = new kit.Canvas();
  for (const [x, y, rx, ry] of blobs) c.disc(0, x, y, rx, ry ?? rx, (px, py) => (px + py < x + y - 1 ? 0.45 : -0.15));
  extra?.(c);
  return c.render([ramp, ...(extra?.ramps ?? [])], outline);
}

// A cut gem: a polygon with a lit upper facet.
function gem(kit, ramp, pts, facet, outline) {
  const c = new kit.Canvas();
  c.poly(0, pts, () => -0.1);
  c.poly(0, facet, () => 0.65);
  return c.render([ramp], outline);
}

// A fish, nose to the upper right; cooked: browner, with grill marks.
function fish(kit, ramp, cooked) {
  const c = new kit.Canvas();
  const BODY = 0;
  const FIN = 1;
  const EYE = 2;
  const ca = Math.cos(-0.45);
  const sa = Math.sin(-0.45);
  // (u along the body, nose at +u; v across it)
  const uv = (x, y) => [(x - 17) * ca + (y - 15) * sa, -(x - 17) * sa + (y - 15) * ca];
  const at = (u, v) => [17 + u * ca - v * sa, 15 + u * sa + v * ca];
  c.fill(BODY, (x, y) => {
    const [u, v] = uv(x, y);
    return (u / 10.5) ** 2 + (v / (u > 0 ? 6 : 5.2)) ** 2 <= 1;
  }, (x, y) => (uv(x, y)[1] < -1 ? 0.45 : uv(x, y)[1] > 2.5 ? -0.3 : 0.05));
  c.poly(FIN, [at(-8.5, 0), at(-14.5, -5.5), at(-13, 0), at(-14.5, 5.5)], () => -0.1); // the tail
  c.poly(FIN, [at(-2, -4.8), at(2.5, -8.5), at(4, -5)], () => 0.2); // the back fin
  c.poly(FIN, [at(-1, 4.5), at(1, 7.5), at(3, 5)], () => -0.2); // a belly fin
  if (cooked) for (const u of [-4, 0, 4]) c.line(EYE, ...at(u - 1.5, -3.5), ...at(u + 1.5, 3.5), 1.1, () => 0);
  else c.disc(EYE, ...at(6.5, -1.6), 1.2, 1.2, () => 0);
  return c.render([ramp, ramp, cooked ? kit.RAMPS.cooked : kit.RAMPS.coal]);
}

// A drumstick: a round of meat on a bone.
function drumstick(kit, ramp) {
  const c = new kit.Canvas();
  c.disc(0, 13, 13, 9, 8, lit(0.4, -0.15, 24));
  c.line(1, 18, 18, 25, 25, 3);
  c.disc(1, 26, 24, 2.2, 2.2);
  c.disc(1, 24, 27, 2.2, 2.2);
  return c.render([ramp, R(kit).bone]);
}

// A bowl seen from the side, with something in it (null: empty).
function bowl(kit, fillRamp, bits) {
  const c = new kit.Canvas();
  if (fillRamp) c.disc(1, 16, 15, 11, 3.5, () => 0.15);
  c.fill(0, (x, y) => y >= 15 && ((x - 16) / 12.5) ** 2 + ((y - 15) / 10) ** 2 <= 1, (x) => (x < 14 ? 0.35 : -0.15));
  if (!fillRamp) c.disc(0, 16, 15, 11, 3.2, () => -0.9); // the hollow
  bits?.(c);
  return c.render([kit.RAMPS.wood, fillRamp || kit.RAMPS.wood, kit.RAMPS.red, R(kit).bone]);
}

// A bucket; contents: a ramp for the liquid at its mouth (or null).
function bucket(kit, contents) {
  const c = new kit.Canvas();
  const METAL = 0;
  const FILL = 1;
  c.poly(METAL, [[7, 11], [25, 11], [22.5, 28], [9.5, 28]], (x) => (x < 13 ? 0.45 : x > 20 ? -0.3 : 0.05));
  c.fill(METAL, (x, y) => ((x - 16) / 9.5) ** 2 + ((y - 11) / 3.2) ** 2 <= 1, () => 0.3);
  c.fill(contents ? FILL : METAL, (x, y) => ((x - 16) / 7.8) ** 2 + ((y - 11) / 2.2) ** 2 <= 1, () => (contents ? 0.35 : -1));
  // The handle.
  c.fill(METAL, (x, y) => {
    const d = Math.hypot((x - 16) / 10, (y - 11) / 8.5);
    return y < 11 && d > 0.88 && d < 1.02;
  }, () => 0.2);
  return c.render([kit.RAMPS.iron, contents || kit.RAMPS.iron], [26, 28, 32]);
}

// A glass bottle with an optional liquid.
function bottle(kit, liquid) {
  const c = new kit.Canvas();
  const GLASS = 0;
  const FILL = 1;
  const CORK = 2;
  c.disc(GLASS, 16, 20, 8, 8, lit(0.5, 0, 34));
  c.poly(GLASS, [[13, 6], [19, 6], [19, 13], [13, 13]], () => 0.4);
  if (liquid) c.disc(FILL, 16, 21, 6.4, 6.2, lit(0.4, -0.1, 34));
  c.disc(GLASS, 13, 17, 1.6, 2.2, () => 1); // a glint
  if (liquid) c.poly(CORK, [[13.5, 3.5], [18.5, 3.5], [18.5, 6.5], [13.5, 6.5]], () => 0.2);
  return c.render([R(kit).glass, liquid || R(kit).glass, kit.RAMPS.wood], [30, 40, 48]);
}

// A five-step ramp around one colour (a potion's liquid).
function tintRamp(kit, color) {
  const at = (f) => {
    const ch = (sh) => {
      const v = (color >> sh) & 255;
      return Math.round(f < 1 ? v * f : v + (255 - v) * (f - 1));
    };
    return (ch(16) << 16) | (ch(8) << 8) | ch(0);
  };
  return kit.ramp(at(0.35), at(0.62), at(1), at(1.3), at(1.65));
}

// A splash potion's bottle: rounder, with a short flat neck and its lip.
function splashBottle(kit, liquid) {
  const c = new kit.Canvas();
  c.disc(0, 16, 19, 9, 8.5, lit(0.5, 0, 34));
  c.poly(0, [[12.5, 7], [19.5, 7], [19.5, 11.5], [12.5, 11.5]], () => 0.4);
  c.poly(0, [[11, 5], [21, 5], [21, 7.5], [11, 7.5]], () => 0.6);
  c.disc(1, 16, 20, 7.4, 6.8, lit(0.4, -0.1, 34));
  c.disc(0, 12.5, 16, 1.6, 2.4, () => 1);
  return c.render([R(kit).glass, liquid], [30, 40, 48]);
}

// A book: cover, pages and a spine band.
function book(kit, coverRamp, shine) {
  const c = new kit.Canvas();
  const COVER = 0;
  const PAGES = 1;
  c.poly(COVER, [[6, 9], [22, 5], [26, 22], [10, 27]], (x, y) => (x + y < 30 ? 0.35 : -0.05));
  c.poly(PAGES, [[10, 27], [26, 22], [26.5, 25], [10.5, 30]], () => 0.2);
  c.line(COVER, 8, 9, 12, 27, 2.6, () => -0.5); // the spine
  if (shine) for (const [x, y] of [[14, 12], [19, 15], [16, 19], [21, 10]]) c.disc(PAGES, x, y, 0.9, 0.9, () => 1.2);
  return c.render([coverRamp, R(kit).paper], [28, 16, 10]);
}

const P = (fn) => (kit) => fn(kit, R(kit));

export const icons = {
  // (Round 11) One drinkable and one splash icon per kind of potion, by its colour.
  ...Object.fromEntries(POTION_KINDS.flatMap(([key, , color]) => [
    [`potion_${key}`, (kit) => bottle(kit, tintRamp(kit, color))],
    [`splash_potion_${key}`, (kit) => splashBottle(kit, tintRamp(kit, color))],
  ])),
  iron_ingot: (kit) => kit.ingot(kit.RAMPS.iron),
  copper_ingot: P((kit, r) => kit.ingot(r.copper)),
  iron_nugget: P((kit) => lumps(kit, kit.RAMPS.iron, [[13, 17, 4.5, 3.8], [19, 15, 4, 3.6], [17, 20, 4, 3.4]], [26, 28, 32])),
  gold_nugget: P((kit) => lumps(kit, kit.RAMPS.gold, [[13, 17, 4.5, 3.8], [19, 15, 4, 3.6], [17, 20, 4, 3.4]], [40, 24, 4])),
  raw_iron: P((kit, r) => rawOre(kit, kit.ramp(0x6e5a4a, 0x977c66, 0xbfa386, 0xd9c2a6, 0xefe0cc), r.copper)),
  raw_gold: P((kit) => rawOre(kit, kit.RAMPS.gold, kit.RAMPS.amber)),
  raw_copper: P((kit, r) => rawOre(kit, r.copper, r.emerald)),
  diamond: P((kit) => gem(kit, kit.RAMPS.diamond, [[16, 4], [27, 12], [16, 29], [5, 12]], [[16, 4], [27, 12], [16, 14], [5, 12]], [6, 40, 46])),
  emerald: P((kit, r) => gem(kit, r.emerald, [[16, 3], [23, 8], [23, 22], [16, 29], [9, 22], [9, 8]], [[16, 3], [23, 8], [16, 11], [9, 8]], [4, 34, 14])),
  lapis_lazuli: P((kit, r) => lumps(kit, r.lapis, [[13, 15, 7, 6], [19, 18, 7, 6], [15, 21, 5]], [8, 16, 44], Object.assign((c) => {
    for (const [x, y] of [[12, 14], [18, 19], [20, 14], [14, 21]]) c.disc(1, x, y, 0.8, 0.8, () => 1);
  }, { ramps: [kit.RAMPS.gold] }))),
  redstone: P((kit, r) => {
    const c = new kit.Canvas();
    for (const [x, y, s] of [[10, 22, 4], [16, 19, 5], [22, 22, 4], [13, 25, 3.5], [20, 26, 3.5], [16, 14, 3], [26, 26, 2.5], [6, 26, 2.5]]) c.disc(0, x, y, s, s * 0.8, (px, py) => (py < y ? 0.5 : -0.1));
    return c.render([r.redstone], [40, 4, 4]);
  }),
  flint: P((kit, r) => {
    const c = new kit.Canvas();
    c.poly(0, [[9, 7], [21, 5], [26, 14], [22, 26], [11, 27], [6, 17]], (x, y) => (x + y < 26 ? 0.55 : x > 18 ? -0.2 : 0.05));
    c.line(0, 14, 9, 11, 20, 1, () => 1);
    return c.render([r.flint], [8, 8, 10]);
  }),
  charcoal: P((kit, r) => {
    const c = new kit.Canvas();
    c.disc(0, 14, 17, 8, 7, lit(0.4, -0.2, 28));
    c.disc(0, 20, 14, 6, 6, lit(0.5, 0, 30));
    c.disc(0, 18, 21, 6, 5);
    return c.render([r.charcoal], [8, 6, 4]);
  }),
  leather: P((kit) => {
    const c = new kit.Canvas();
    c.poly(0, [[6, 8], [12, 5], [20, 6], [26, 9], [24, 16], [27, 24], [20, 27], [12, 26], [5, 24], [8, 16]], lit(0.35, -0.1, 28));
    c.line(0, 11, 12, 20, 11, 0.8, () => -1); // stitches
    c.line(0, 12, 21, 21, 21, 0.8, () => -1);
    return c.render([kit.RAMPS.leather], [24, 12, 6]);
  }),
  feather: P((kit, r) => {
    const c = new kit.Canvas();
    c.fill(0, (x, y) => {
      const u = ((x - 16) + (16 - y)) / Math.SQRT2;
      const v = ((x - 16) - (16 - y)) / Math.SQRT2;
      return u > -9 && (u / 12) ** 2 + (v / 4.2) ** 2 <= 1;
    }, (x, y) => (x - y > 0 ? -0.15 : 0.45));
    c.line(1, 5, 27, 25, 7, 1.1, () => 0.3); // the quill
    return c.render([kit.RAMPS.cloth, r.bone], [96, 92, 84]);
  }),
  string: P((kit) => {
    const c = new kit.Canvas();
    let px = 5;
    let py = 26;
    for (let i = 1; i <= 24; i++) {
      const t = i / 24;
      const x = 5 + t * 22;
      const y = 26 - t * 20 + Math.sin(t * Math.PI * 3) * 3;
      c.line(0, px, py, x, y, 1.6, () => 0.3);
      px = x;
      py = y;
    }
    return c.render([kit.RAMPS.cloth], [90, 86, 80]);
  }),
  bone: P((kit, r) => {
    const c = new kit.Canvas();
    c.line(0, 9, 23, 23, 9, 3.6, () => 0.2);
    for (const [x, y] of [[6, 23], [9, 26], [23, 6], [26, 9]]) c.disc(0, x, y, 3, 3, lit(0.5, -0.1, x + y));
    return c.render([r.bone], [70, 66, 54]);
  }),
  gunpowder: P((kit, r) => {
    const c = new kit.Canvas();
    for (const [x, y, s] of [[11, 21, 5], [18, 18, 6], [23, 23, 4], [15, 25, 4], [8, 26, 3], [24, 27, 3]]) c.disc(0, x, y, s, s * 0.75, (px, py) => (py < y ? 0.45 : -0.15));
    return c.render([r.powder], [14, 14, 14]);
  }),
  rotten_flesh: P((kit, r) => {
    const c = new kit.Canvas();
    c.poly(0, [[5, 14], [11, 8], [19, 9], [27, 13], [25, 21], [17, 25], [8, 23]], lit(0.3, -0.15, 30));
    for (const [x, y, s] of [[12, 14, 2.5], [20, 15, 2], [15, 20, 2.2], [22, 19, 1.6]]) c.disc(1, x, y, s, s, () => 0);
    return c.render([r.rotten, kit.RAMPS.meat], [30, 26, 8]);
  }),
  egg: P((kit, r) => {
    const c = new kit.Canvas();
    c.fill(0, (x, y) => ((x - 16) / 8.5) ** 2 + ((y - 17) / (y < 17 ? 11 : 9)) ** 2 <= 1, lit(0.45, -0.15, 30));
    c.disc(0, 13, 12, 1.8, 2.6, () => 1);
    return c.render([r.egg], [80, 64, 40]);
  }),
  slime_ball: P((kit, r) => {
    const c = new kit.Canvas();
    c.disc(0, 16, 17, 10, 9.5, lit(0.3, -0.25, 30));
    c.disc(1, 15, 16, 5.5, 5, () => -0.3); // the darker core
    c.disc(0, 12, 12, 2, 2, () => 1);
    return c.render([r.slime, r.slime], [20, 60, 14]);
  }),
  ender_pearl: P((kit, r) => {
    const c = new kit.Canvas();
    c.disc(0, 16, 16, 10.5, 10.5, (x, y) => (Math.hypot(x - 13, y - 13) < 5 ? 0.7 : x + y < 32 ? 0.15 : -0.35));
    c.disc(1, 16, 16, 3.6, 3.6, () => -1);
    c.disc(0, 12, 12, 1.6, 1.6, () => 1.2);
    return c.render([r.pearl, kit.RAMPS.coal], [2, 16, 14]);
  }),
  spider_eye: P((kit) => {
    const c = new kit.Canvas();
    c.disc(0, 16, 16, 10, 9, lit(0.3, -0.25, 30));
    c.disc(1, 17, 17, 4, 4, () => -0.5);
    c.disc(0, 12, 12, 2, 1.6, () => 1.2);
    return c.render([kit.RAMPS.red, kit.RAMPS.coal], [40, 4, 8]);
  }),
  paper: P((kit, r) => {
    const c = new kit.Canvas();
    c.poly(0, [[5, 9], [22, 4], [27, 23], [10, 28]], (x, y) => (x + y < 30 ? 0.3 : -0.05));
    for (const t of [0.3, 0.5, 0.7]) c.line(0, 8 + t * 4, 12 + t * 14, 22 + t * 4, 8 + t * 14, 0.7, () => -0.7);
    return c.render([r.paper], [110, 104, 92]);
  }),
  book: P((kit) => book(kit, kit.RAMPS.leather, false)),
  enchanted_book: P((kit, r) => book(kit, r.purple, true)),
  glass_bottle: P((kit) => bottle(kit, null)),
  experience_bottle: P((kit, r) => bottle(kit, r.xp)),
  potion_water: P((kit) => bottle(kit, tintRamp(kit, 0x385dc6))),
  fermented_spider_eye: P((kit) => {
    const c = new kit.Canvas();
    c.disc(0, 16, 16, 10, 9, lit(0.3, -0.25, 30));
    c.disc(1, 17, 17, 4, 4, () => -0.5);
    // (the mushroom's cap and the sugar on it)
    c.disc(2, 21, 10, 6, 3.5, (x, y) => (y < 9 ? 0.4 : -0.1));
    for (const [x, y] of [[9, 18], [12, 23], [19, 22], [23, 17]]) c.disc(3, x, y, 1, 1, () => 1);
    return c.render([kit.ramp(0x5a1a2a, 0x7e2a3a, 0xa04252, 0xbd6270, 0xd98c96), kit.RAMPS.coal, kit.RAMPS.wood, kit.RAMPS.cloth], [36, 8, 14]);
  }),
  glistering_melon_slice: P((kit) => {
    const c = new kit.Canvas();
    // (a melon slice: the rind's arc and the red flesh, gold flecks over it)
    c.fill(0, (x, y) => y > 8 && Math.hypot(x - 16, y - 8) < 16 && Math.hypot(x - 16, y - 8) > 13, () => 0.1);
    c.fill(1, (x, y) => y > 8 && Math.hypot(x - 16, y - 8) <= 13, (x, y) => (y < 14 ? 0.4 : 0));
    for (const [x, y] of [[10, 12], [16, 15], [22, 12], [13, 18], [19, 19], [16, 10]]) c.disc(2, x, y, 1.3, 1.3, () => 1);
    return c.render([kit.RAMPS.leaf, kit.RAMPS.red, kit.RAMPS.gold], [20, 30, 8]);
  }),
  bowl: P((kit) => bowl(kit, null)),
  mushroom_stew: P((kit, r) => bowl(kit, r.stew, (c) => {
    c.disc(1, 12, 14, 2.5, 1.4, () => 0.6);
    c.disc(1, 20, 15, 2.2, 1.2, () => 0.6);
  })),
  beetroot_soup: P((kit, r) => bowl(kit, r.soup, (c) => c.disc(1, 15, 14, 3, 1.4, () => 0.8))),
  bread: P((kit, r) => {
    const c = new kit.Canvas();
    c.fill(0, (x, y) => {
      const u = ((x - 16) + (16 - y)) / Math.SQRT2;
      const v = ((x - 16) - (16 - y)) / Math.SQRT2;
      return (u / 12.5) ** 2 + (v / 6.5) ** 2 <= 1;
    }, (x, y) => (x - y < -2 ? 0.45 : -0.2));
    for (const t of [-5, 0, 5]) c.line(0, 16 + t * 0.7 - 2.5, 16 - t * 0.7 - 2.5, 16 + t * 0.7 + 0.5, 16 - t * 0.7 + 0.5, 1.2, () => -1.2); // the slashes
    return c.render([r.bread], [44, 24, 8]);
  }),
  beef: (kit) => kit.meat(kit.RAMPS.meat, false),
  cooked_beef: (kit) => kit.meat(kit.RAMPS.cooked, true),
  porkchop: P((kit, r) => kit.meat(r.pork, false)),
  cooked_porkchop: P((kit, r) => kit.meat(r.porkCooked, true)),
  mutton: P((kit, r) => kit.meat(r.mutton, false)),
  cooked_mutton: P((kit) => kit.meat(kit.RAMPS.cooked, true)),
  chicken: P((kit, r) => drumstick(kit, r.chicken)),
  cooked_chicken: P((kit, r) => drumstick(kit, r.chickenCooked)),
  cod: P((kit, r) => fish(kit, r.cod, false)),
  cooked_cod: P((kit, r) => fish(kit, r.chickenCooked, true)),
  salmon: P((kit, r) => fish(kit, r.salmon, false)),
  cooked_salmon: P((kit, r) => fish(kit, r.porkCooked, true)),
  baked_potato: P((kit, r) => {
    const c = new kit.Canvas();
    c.fill(0, (x, y) => ((x - 16) / 10.5) ** 2 + ((y - 17) / 7.5) ** 2 <= 1, lit(0.35, -0.2, 30));
    c.line(1, 11, 15, 20, 13, 2.2, () => 0.7); // the split, steaming
    return c.render([r.potato, kit.RAMPS.gold], [40, 24, 8]);
  }),
  cookie: P((kit, r) => {
    const c = new kit.Canvas();
    c.disc(0, 16, 16, 10, 9.5, lit(0.3, -0.2, 30));
    for (const [x, y] of [[12, 12], [19, 13], [14, 19], [21, 20], [10, 17]]) c.disc(1, x, y, 1.6, 1.4, () => 0);
    return c.render([r.bread, r.charcoal], [40, 20, 6]);
  }),
  pumpkin_pie: P((kit, r) => {
    const c = new kit.Canvas();
    c.poly(0, [[4, 18], [16, 7], [28, 18], [16, 27]], () => -0.1); // the crust
    c.poly(1, [[7, 18], [16, 10], [25, 18], [16, 24]], lit(0.35, -0.05, 30));
    return c.render([r.bread, r.pumpkin], [40, 20, 6]);
  }),
  golden_carrot: P((kit, r) => {
    const c = new kit.Canvas();
    c.poly(0, [[5, 27], [19, 11], [23, 15]], (x, y) => (x + y < 33 ? 0.5 : -0.1));
    c.disc(0, 21, 13, 3.6, 3.6, () => 0.3);
    for (const t of [0.35, 0.6]) c.line(0, 8 + t * 12, 22 - t * 12, 11 + t * 12, 25 - t * 12, 0.8, () => -1.2);
    c.line(1, 22, 11, 26, 4, 1.8, () => 0.3); // the greens
    c.line(1, 23, 12, 29, 8, 1.8, () => 0);
    return c.render([kit.RAMPS.gold, r.leaf], [40, 24, 4]);
  }),
  bucket: (kit) => bucket(kit, null),
  water_bucket: P((kit, r) => bucket(kit, r.water)),
  lava_bucket: P((kit) => bucket(kit, kit.RAMPS.amber)),
  milk_bucket: P((kit) => bucket(kit, kit.RAMPS.cloth)),
  flint_and_steel: P((kit, r) => {
    const c = new kit.Canvas();
    // The steel: a thick C, opening to the lower left.
    c.fill(0, (x, y) => {
      const d = Math.hypot(x - 19, y - 12);
      const a = Math.atan2(y - 12, x - 19);
      return d > 4.2 && d < 8 && !(a > 1.9 && a < 3.4);
    }, lit(0.4, -0.15, 31));
    c.poly(1, [[5, 20], [12, 17], [16, 23], [12, 28], [6, 27]], lit(0.5, -0.1, 33)); // the flint
    return c.render([kit.RAMPS.iron, r.flint], [20, 20, 24]);
  }),
  shears: P((kit) => {
    const c = new kit.Canvas();
    c.poly(0, [[14, 16], [26, 3], [28, 5], [17, 18]], () => 0.4); // the blades
    c.poly(0, [[16, 14], [27, 6], [29, 9], [17, 17]], () => -0.1);
    c.disc(1, 15, 17, 1.4, 1.4, () => 1); // the rivet
    for (const [x, y] of [[9, 18], [14, 24]]) {
      c.fill(1, (px, py) => {
        const d = Math.hypot(px - x, py - y);
        return d > 2 && d < 4.4;
      }, lit(0.4, -0.2, x + y));
    }
    c.line(1, 12, 19, 15, 17, 2.2);
    c.line(1, 15, 21, 16, 18, 2.2);
    return c.render([kit.RAMPS.iron, kit.RAMPS.stone], [24, 26, 30]);
  }),
  fishing_rod: P((kit) => fishingRod(kit, true)),
  fishing_rod_cast: P((kit) => fishingRod(kit, false)),
  arrow: P((kit, r) => {
    const c = new kit.Canvas();
    c.line(0, 7, 25, 23, 9, 1.8, () => 0.2); // the shaft
    c.poly(1, [[26.5, 5.5], [20, 8], [24, 12]], lit(0.5, -0.1, 31)); // the head
    c.poly(2, [[5, 22], [9, 22], [10, 27], [7, 29]], () => 0.4); // the fletching
    c.poly(2, [[10, 27], [10, 23], [5, 22], [3, 26]], () => -0.1);
    return c.render([kit.RAMPS.wood, r.flint, kit.RAMPS.cloth]);
  }),
  shield: P((kit) => {
    const c = new kit.Canvas();
    const shape = (x, y, inset) => x >= 7 + inset && x <= 25 - inset && y >= 4 + inset && (y <= 18 || ((x - 16) / (9 - inset)) ** 2 + ((y - 18) / (11 - inset)) ** 2 <= 1);
    c.fill(1, (x, y) => shape(x, y, 0), () => 0.1); // the iron rim
    c.fill(0, (x, y) => shape(x, y, 2), (x) => (x < 13 ? 0.3 : x > 19 ? -0.15 : 0.05));
    for (const x of [12, 16, 20]) c.line(0, x, 6, x, 26, 0.7, () => -1); // the planks
    c.disc(1, 16, 15, 2.3, 2.3, () => 0.5); // the boss
    return c.render([kit.RAMPS.wood, kit.RAMPS.iron], [26, 18, 10]);
  }),
  cake: P((kit, r) => {
    const c = new kit.Canvas();
    c.poly(0, [[4, 14], [16, 8], [28, 14], [16, 20]], () => 0.45); // the frosted top
    c.poly(1, [[4, 14], [16, 20], [16, 27], [4, 21]], () => 0.1); // the sides
    c.poly(1, [[16, 20], [28, 14], [28, 21], [16, 27]], () => -0.25);
    c.poly(0, [[4, 14], [16, 20], [16, 22], [4, 16]], () => 0.2); // the frosting's edge
    c.poly(0, [[16, 20], [28, 14], [28, 16], [16, 22]], () => -0.05);
    for (const [x, y] of [[12, 12], [19, 11], [16, 15], [22, 14]]) c.disc(2, x, y, 1.1, 0.8, () => 0.4);
    return c.render([kit.RAMPS.cloth, r.bread, kit.RAMPS.red], [60, 40, 24]);
  }),
};

// Raw ore: a rough chunk with a few specks.
function rawOre(kit, ramp, speck) {
  const c = new kit.Canvas();
  c.poly(0, [[7, 12], [13, 6], [22, 7], [27, 14], [25, 23], [17, 27], [8, 24], [5, 18]], (x, y) => (x + y < 26 ? 0.45 : x + y > 38 ? -0.25 : 0));
  c.line(0, 11, 18, 18, 13, 1, () => -1); // a crack
  for (const [x, y] of [[14, 20], [21, 17], [17, 10]]) c.disc(1, x, y, 1.3, 1.1, () => 0.2);
  return c.render([ramp, speck], [36, 26, 18]);
}

// A fishing rod: the rod from the lower left, the line hanging from its tip
// with the hook (cast: the line is out, only the rod).
function fishingRod(kit, line) {
  const c = new kit.Canvas();
  const ROD = 0;
  const LINE = 1;
  const HOOK = 2;
  c.line(ROD, 4, 28, 25, 5, 2.4, () => 0.2);
  c.line(ROD, 6, 26, 9, 23, 3.2, () => -0.5); // the grip
  if (line) {
    c.line(LINE, 25, 5, 25.5, 23, 0.8, () => 0.6);
    c.fill(HOOK, (x, y) => {
      const d = Math.hypot(x - 23.5, y - 24);
      return d > 1.4 && d < 2.6 && y > 23.5;
    }, () => 0.4);
  }
  return c.render([kit.RAMPS.wood, kit.RAMPS.cloth, kit.RAMPS.iron]);
}

for (const piece of ["helmet", "chestplate", "leggings", "boots"]) {
  icons[`armor_chain_${piece}`] = (kit) => {
    const px = kit.armor(piece, R(kit).chain, [20, 22, 26]);
    // Rings: a dark dot every few pixels inside the silhouette.
    const N = kit.N;
    for (let y = 1; y < N - 1; y++) {
      for (let x = 1; x < N - 1; x++) {
        if ((x + 2 * y) % 4 !== 0 || y % 2 !== 0) continue;
        const o = (y * N + x) * 4;
        const inside = [o - 4, o + 4, o - N * 4, o + N * 4].every((k) => px[k + 3] && px[k] > 40);
        if (!inside || !px[o + 3]) continue;
        px[o] *= 0.55;
        px[o + 1] *= 0.55;
        px[o + 2] *= 0.6;
      }
    }
    return px;
  };
}
