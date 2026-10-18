// Item registry (pure data, no three.js). Item ids 0-255 and from 1024 up
// are blocks (same id as the block, placeable); ids 256-1023 are plain
// items: tools, materials and food. Like block ids, item ids are saved with
// the player's inventory, so existing ids must never change meaning.
//
// (Round 11) The id space (js/content/base.js): 0-255 the original blocks,
// 256-1023 items (the core ones here, ITEM; the content modules' in their
// ranges, see js/content/index.js), 1024-4095 the new blocks, each its own
// item unless it counts as another. Never assume "id < 256 means a block":
// itemInfo(id).block says whether an item places a block.
import { BLOCK, BLOCK_INFO, ITEM_OF, BLOCK_LIMIT, isBlockId } from "./blocks.js";
import { ITEM, LIB } from "./content/base.js";
import { CONTENT_ITEMS, CONTENT_ORDER, BLOCK_DROPS } from "./content/index.js";
import * as V from "./content/ids.js";
import { isVanilla } from "./worldtype.js";
import { fortuneCount } from "./enchant.js";

export { ITEM };

// Tool materials: tier (what they can harvest), mining speed multiplier,
// durability (uses), and melee damage for a sword (other tools hit weaker).
// (Round 11) Gold, as in the classic game: the fastest, the weakest (a wooden
// tool's tier, 33 uses); its tools are the vanilla items' (js/content/items-vanilla.js).
export const MATERIALS = {
  wood: { tier: 1, speed: 2, durability: 60, sword: 4, color: "wood" },
  stone: { tier: 2, speed: 4, durability: 132, sword: 5, color: "stone" },
  iron: { tier: 3, speed: 6, durability: 251, sword: 6, color: "iron" },
  diamond: { tier: 4, speed: 8, durability: 1562, sword: 7, color: "diamond" },
  gold: { tier: 1, speed: 12, durability: 33, sword: 4, color: "gold" },
};

// (Round 11) Java's melee [damage, attacks a second] by tool, for a Survival
// world's hits (js/mobs.js: vDamage, vSpeed); a Missions world keeps `damage`.
const VANILLA_MELEE = {
  sword: { wood: [4, 1.6], stone: [5, 1.6], iron: [6, 1.6], diamond: [7, 1.6], gold: [4, 1.6] },
  axe: { wood: [7, 0.8], stone: [9, 0.8], iron: [9, 0.9], diamond: [9, 1], gold: [7, 1] },
  pickaxe: { wood: [2, 1.2], stone: [3, 1.2], iron: [4, 1.2], diamond: [5, 1.2], gold: [2, 1.2] },
  shovel: { wood: [2.5, 1], stone: [3.5, 1], iron: [4.5, 1], diamond: [5.5, 1], gold: [2.5, 1] },
  hoe: { wood: [1, 1], stone: [1, 2], iron: [1, 3], diamond: [1, 4], gold: [1, 1] },
};

// A tool of `type` made of `mat` (a MATERIALS key): what its item's `tool` is.
// (Hoes hit like a bare hand, as in the classic game.)
export function toolOf(type, mat) {
  const m = MATERIALS[mat];
  return {
    type,
    vDamage: VANILLA_MELEE[type]?.[mat]?.[0],
    vSpeed: VANILLA_MELEE[type]?.[mat]?.[1],
    tier: m.tier,
    speed: m.speed,
    durability: m.durability,
    damage: type === "sword" ? m.sword : type === "axe" ? m.sword - 1 : type === "hoe" ? HAND_DAMAGE : Math.max(2, m.sword - 3),
  };
}

const HAND_DAMAGE = 1;

// (Round 11) Food: `food` is { hunger, saturation } in the classic game's
// points (a Survival world's hunger bar eats them), with optional `effects`
// ([{ id, level, seconds, chance }]), `alwaysEat` (even when full), `returns`
// (the item left in hand: a bowl, a bucket). `heal` is what it heals at once
// in a Missions world (today's food; the hunger points when not given). An
// item's food object also reads as that heal amount where older code adds it.
const ITEM_DEFS = {
  [ITEM.STICK]: { name: "Stick", icon: "stick" },
  [ITEM.COAL]: { name: "Coal", icon: "coal" },
  [ITEM.GOLD_INGOT]: { name: "Gold Ingot", icon: "gold_ingot" },
  [ITEM.APPLE]: { name: "Apple", icon: "apple", food: { hunger: 4, saturation: 2.4 }, heal: 4 },
  // Heals fully and adds four golden (absorption) hearts on top (a Missions
  // world); in a Survival world, Regeneration II for 5 s and Absorption for 2 min.
  [ITEM.GOLDEN_APPLE]: {
    name: "Golden Apple",
    icon: "golden_apple",
    food: { hunger: 4, saturation: 9.6 },
    heal: 20,
    absorb: 8,
    alwaysEat: true,
    effects: [{ id: "regeneration", level: 2, seconds: 5, chance: 1 }, { id: "absorption", level: 1, seconds: 120, chance: 1 }],
  },
  [ITEM.RAW_MEAT]: { name: "Raw Meat", icon: "raw_meat", food: { hunger: 3, saturation: 1.8 }, heal: 2 },
  [ITEM.COOKED_MEAT]: { name: "Cooked Meat", icon: "cooked_meat", food: { hunger: 8, saturation: 12.8 }, heal: 8 },
  [ITEM.FLUFF]: { name: "Fluff", icon: "fluff" },
  // Weapons never run out of ammo, but each one reloads, recharges or cools
  // down (weapons.js WEAPON_STATS).
  [ITEM.GRENADE]: { name: "Grenade", icon: "grenade", stack: 1, weapon: { kind: "grenade" } },
  [ITEM.PISTOL]: { name: "Pistol", icon: "pistol", stack: 1, weapon: { kind: "pistol" } },
  [ITEM.BAZOOKA]: { name: "Bazooka", icon: "bazooka", stack: 1, weapon: { kind: "bazooka" } },
  [ITEM.MACHINE_GUN]: { name: "Machine Gun", icon: "machinegun", stack: 1, weapon: { kind: "machinegun" } },
  [ITEM.SNIPER_RIFLE]: { name: "Sniper Rifle", icon: "sniper", stack: 1, weapon: { kind: "sniper" } },
  [ITEM.AIRSTRIKE]: { name: "Airstrike Designator", icon: "airstrike", stack: 1, weapon: { kind: "airstrike" } },
  [ITEM.LASER_BLASTER]: { name: "Laser Blaster", icon: "blaster", stack: 1, weapon: { kind: "blaster" } },
  [ITEM.RAILGUN]: { name: "Railgun", icon: "railgun", stack: 1, weapon: { kind: "railgun" } },
  [ITEM.MINIGUN]: { name: "Laser Minigun", icon: "minigun", stack: 1, weapon: { kind: "minigun" } },
  // The skeletons' bow: hold right click to draw, let go to shoot. (Its
  // uses, vanilla's 384, wear only by its shots in a Survival world: weapons.js.)
  [ITEM.BOW]: { name: "Bow", icon: "bow", stack: 1, weapon: { kind: "bow" }, tool: { type: "bow", durability: 385, damage: HAND_DAMAGE } },
};

// Armor: four pieces of four materials, worn in the four armor slots (head,
// chest, legs, feet). Each piece gives defense points (like classic block
// games: every point turns away 4% of the damage that armor can stop, up to
// 80% with a full diamond set) and wears out as it takes hits.
export const ARMOR_SLOTS = ["head", "chest", "legs", "feet"];
export const ARMOR_REDUCTION_PER_POINT = 0.04;
export const ARMOR_TIERS = ["leather", "gold", "iron", "diamond"];
const ARMOR_POINTS = { leather: [1, 3, 2, 1], gold: [2, 5, 3, 1], iron: [2, 6, 5, 2], diamond: [3, 8, 6, 3] };
const ARMOR_DURABILITY = { leather: [55, 80, 75, 65], gold: [77, 112, 105, 91], iron: [165, 240, 225, 195], diamond: [363, 528, 495, 429] };
const ARMOR_NAMES = ["Helmet", "Chestplate", "Leggings", "Boots"];
const ARMOR_KEYS = ["HELMET", "CHESTPLATE", "LEGGINGS", "BOOTS"];
ARMOR_TIERS.forEach((tier, t) => {
  ARMOR_KEYS.forEach((key, s) => {
    const id = ITEM[`${tier.toUpperCase()}_${key}`];
    ITEM_DEFS[id] = {
      name: `${tier[0].toUpperCase() + tier.slice(1)} ${ARMOR_NAMES[s]}`,
      icon: `armor_${tier}_${key.toLowerCase()}`,
      stack: 1,
      armor: { slot: s, tier: t, points: ARMOR_POINTS[tier][s], durability: ARMOR_DURABILITY[tier][s] },
    };
  });
});
// The armor id of a tier (0-3) and slot (0-3).
export function armorId(tier, slot) {
  return ITEM[`${ARMOR_TIERS[tier].toUpperCase()}_${ARMOR_KEYS[slot]}`];
}

const TOOL_KINDS = [
  ["SWORD", "sword", "Sword"],
  ["PICKAXE", "pickaxe", "Pickaxe"],
  ["AXE", "axe", "Axe"],
  ["SHOVEL", "shovel", "Shovel"],
];
for (const matKey of Object.keys(MATERIALS)) {
  for (const [kindKey, type, label] of TOOL_KINDS) {
    const id = ITEM[`${matKey.toUpperCase()}_${kindKey}`];
    if (id === undefined) continue; // (gold's tools are content items)
    const matName = matKey === "wood" ? "Wooden" : matKey[0].toUpperCase() + matKey.slice(1);
    ITEM_DEFS[id] = { name: `${matName} ${label}`, icon: `${type}_${matKey}`, stack: 1, tool: toolOf(type, matKey) };
  }
}

// (Round 11) The content modules' items (their ids checked in js/content/index.js).
// A tool given as { type, material } gets that material's numbers.
for (const [id, def] of Object.entries(CONTENT_ITEMS)) {
  ITEM_DEFS[id] = def.tool?.material && MATERIALS[def.tool.material] ? { ...def, tool: toolOf(def.tool.type, def.tool.material) } : def;
}
for (const def of Object.values(ITEM_DEFS)) {
  if (!def.food || typeof def.food !== "object") continue;
  const heal = def.heal ?? def.food.hunger ?? 0;
  Object.defineProperty(def.food, "valueOf", { value: () => heal, enumerable: false, configurable: true });
}

// What eating the item heals at once (a Missions world), or 0.
export function foodHeal(info) {
  return info?.food ? info.heal ?? info.food.hunger ?? 0 : 0;
}

const itemCache = new Map();

// Info for any item id: { id, name, stack, icon, block?, tool?, food? }, or null.
export function itemInfo(id) {
  if (itemCache.has(id)) return itemCache.get(id);
  let info = null;
  // (A block that counts as another item, e.g. a wall torch, is no item itself.)
  if (id > 0 && isBlockId(id) && BLOCK_INFO[id] && ITEM_OF[id] === id) {
    const b = BLOCK_INFO[id];
    info = { id, name: b.name, stack: b.stack ?? 64, block: id, icon: null };
  } else if (ITEM_DEFS[id]) {
    info = { id, stack: 64, ...ITEM_DEFS[id] };
  }
  itemCache.set(id, info);
  return info;
}

export function maxStack(id) {
  return itemInfo(id)?.stack ?? 64;
}

export function isValidItem(id) {
  return itemInfo(id) !== null;
}

// ---------- Mining ----------

// (Round 11) Blocks shears cut fast and keep whole (leaves, plants, cobwebs,
// vines: the block itself drops, as in the classic game), and how fast:
// cobwebs and leaves 15, wool 5, vines 2.
const SHEARS_SPEED = new Float32Array(BLOCK_LIMIT);
const SHEARABLE = new Uint8Array(BLOCK_LIMIT);
// Hoes are the leaves', hay's and sponges' tool; swords cut cobwebs (15) and
// leaves, vines, pumpkins and melons a little faster (1.5) (Survival worlds).
const HOE_BLOCK = new Uint8Array(BLOCK_LIMIT);
const SWORD_SPEED = new Float32Array(BLOCK_LIMIT);
const VINES = [V.VINE, V.VINE + 1, V.VINE + 2, V.VINE + 3];
for (const b of Object.values(BLOCK_INFO)) {
  if (!b.leaves) continue;
  SHEARS_SPEED[b.id] = 15;
  SHEARABLE[b.id] = 1;
  HOE_BLOCK[b.id] = 1;
  SWORD_SPEED[b.id] = 1.5;
}
for (const id of [BLOCK.WOOL, V.ORANGE_WOOL, V.MAGENTA_WOOL, V.LIGHT_BLUE_WOOL, V.YELLOW_WOOL, V.LIME_WOOL, V.PINK_WOOL, V.GRAY_WOOL, V.LIGHT_GRAY_WOOL, V.CYAN_WOOL, V.PURPLE_WOOL, V.BLUE_WOOL, V.BROWN_WOOL, V.GREEN_WOOL, V.RED_WOOL, V.BLACK_WOOL]) SHEARS_SPEED[id] = 5;
SHEARS_SPEED[V.COBWEB] = 15;
SWORD_SPEED[V.COBWEB] = 15;
for (const id of VINES) {
  SHEARS_SPEED[id] = 2;
  SWORD_SPEED[id] = 1.5;
}
for (const id of [BLOCK.TALL_GRASS, BLOCK.DEAD_BUSH, BLOCK.SEAGRASS, V.FERN, V.COBWEB, ...VINES]) SHEARABLE[id] = 1;
for (const id of [V.HAY_BLOCK, V.SPONGE]) HOE_BLOCK[id] = 1;
for (const id of [V.PUMPKIN, V.MELON, V.CARVED_PUMPKIN, V.CARVED_PUMPKIN + 1, V.CARVED_PUMPKIN + 2, V.CARVED_PUMPKIN + 3]) SWORD_SPEED[id] = 1.5;
// Blocks of no tier that still need their tool (Survival worlds): a cobweb by
// hand is mined at the unharvestable rate (vanilla's 20 s) and drops nothing.
const NEEDS_TOOL = new Uint8Array(BLOCK_LIMIT);
NEEDS_TOOL[V.COBWEB] = 1;

// Whether `tool` (item info's .tool, or null for the bare hand) gets drops from the block.
export function canHarvest(blockId, tool) {
  const b = BLOCK_INFO[blockId];
  if (!b || b.hardness < 0) return false;
  if (b.minTier === 0) return !NEEDS_TOOL[blockId] || !isVanilla() || (!!tool && tool.type === b.tool);
  return !!tool && tool.type === b.tool && tool.tier >= b.minTier;
}

// The held tool's speed multiplier on the block.
function toolSpeed(b, tool) {
  if (!tool) return 1;
  // (Before the main tool's: a cobweb's tool is the sword, at 15 whatever its material.)
  if (tool.type === "sword" && SWORD_SPEED[b.id] && isVanilla()) return SWORD_SPEED[b.id];
  if (tool.type === b.tool) return tool.speed ?? 1;
  if (tool.type === "shears") return SHEARS_SPEED[b.id] || 1;
  if (tool.type === "hoe" && HOE_BLOCK[b.id]) return tool.speed ?? 1;
  return 1;
}

// Seconds to break the block in survival (Infinity if unbreakable):
// hardness * (harvestable ? 1.5 : 5) / tool speed, as in classic voxel games.
// (Round 11) bonus: Efficiency's (js/enchant.js efficiencyBonus), added to a
// tool working faster than a hand on the block, as vanilla.
export function breakTime(blockId, tool, bonus = 0) {
  const b = BLOCK_INFO[blockId];
  if (!b || b.hardness < 0) return Infinity;
  if (b.hardness === 0) return 0;
  let speed = toolSpeed(b, tool);
  if (bonus > 0 && speed > 1) speed += bonus;
  return (b.hardness * (canHarvest(blockId, tool) || (tool?.type === "shears" && SHEARABLE[blockId]) ? 1.5 : 5)) / speed;
}

// (Round 11) The enchantments' part in what a block drops (js/enchant.js):
// Silk Touch takes the block itself where vanilla lets it (not what turns
// into something else when placed: crops, farmland, a path); Fortune
// multiplies what ores give (vanilla's ore formula; redstone a few more),
// raises flint's chance from gravel and a melon's slices.
const FORTUNE_ORES = new Set([BLOCK.COAL_ORE, BLOCK.IRON_ORE, BLOCK.GOLD_ORE, BLOCK.DIAMOND_ORE, V.LAPIS_ORE, V.EMERALD_ORE, V.COPPER_ORE]);
const NO_SILK = new Set([V.FARMLAND, V.FARMLAND + 1, V.DIRT_PATH, V.FIRE, V.LAVA, BLOCK.WATER]);
function silkDrop(blockId) {
  if (NO_SILK.has(blockId)) return 0;
  if (blockId === V.REDSTONE_ORE + 1) return V.REDSTONE_ORE; // (lit redstone ore)
  return ITEM_OF[blockId] === blockId && itemInfo(blockId) ? blockId : 0;
}
function enchantedDrops(blockId, tool, rand, ench) {
  if (ench.silk && canHarvest(blockId, tool)) {
    const id = silkDrop(blockId);
    if (id) return [[id, 1]];
  }
  const L = ench.fortune | 0;
  if (L > 0 && blockId === BLOCK.GRAVEL && isVanilla() && itemInfo(V.FLINT) && canHarvest(blockId, tool)) {
    return [[rand() < [0.1, 0.14, 0.25, 1][Math.min(3, L)] ? V.FLINT : BLOCK.GRAVEL, 1]];
  }
  const out = blockDrops(blockId, tool, rand);
  if (L <= 0) return out;
  const redstone = blockId === V.REDSTONE_ORE || blockId === V.REDSTONE_ORE + 1;
  // (New pairs: a module's drops may hand out shared ones.)
  return out.map(([id, n]) => {
    if (id === blockId) return [id, n];
    if (FORTUNE_ORES.has(blockId)) return [id, fortuneCount(n, L, rand)];
    if (redstone) return [id, n + Math.floor(rand() * (L + 1))];
    if (blockId === V.MELON) return [id, Math.min(9, n + Math.floor(rand() * (L + 1)))];
    return [id, n];
  });
}

// Items dropped when a block is broken in survival: array of [itemId, count].
// (A content module's `drops` for the block come first: js/content/index.js;
// shears before them: what they cut drops whole.)
export function blockDrops(blockId, tool, rand = Math.random, ench = null) {
  if (ench && (ench.silk || ench.fortune)) return enchantedDrops(blockId, tool, rand, ench);
  if (tool?.type === "shears" && SHEARABLE[blockId]) {
    const item = ITEM_OF[blockId];
    return item && itemInfo(item) ? [[item, 1]] : [];
  }
  if (!canHarvest(blockId, tool)) return [];
  const custom = BLOCK_DROPS[blockId]?.(tool, rand);
  if (custom) return custom.filter(([id, n]) => n > 0 && itemInfo(id));
  // (Round 11) A Survival world's core blocks drop as in the classic game;
  // a Missions world's as before.
  if (isVanilla()) {
    const out = vanillaDrops(blockId, tool, rand);
    if (out) return out.filter(([id, n]) => n > 0 && itemInfo(id));
  }
  switch (blockId) {
    case BLOCK.GRASS:
      return [[BLOCK.DIRT, 1]];
    case BLOCK.STONE:
      return [[BLOCK.COBBLESTONE, 1]];
    case BLOCK.COAL_ORE:
      return [[ITEM.COAL, 1]];
    // Iron and diamond ore are gone from the world (Round 6: no use for the
    // items); blocks placed or generated by older versions still break, into stone.
    case BLOCK.DIAMOND_ORE:
    case BLOCK.IRON_ORE:
      return [[BLOCK.COBBLESTONE, 1]];
    // There is no smelting any more: ores give their ingots directly.
    case BLOCK.GOLD_ORE:
      return [[ITEM.GOLD_INGOT, 1]];
    case BLOCK.GLASS:
    case BLOCK.TALL_GRASS:
      return [];
    case BLOCK.LEAVES: {
      const r = rand();
      if (r < 0.06) return [[ITEM.APPLE, 1]];
      if (r < 0.1) return [[ITEM.STICK, 1]];
      return [];
    }
    case BLOCK.BIRCH_LEAVES:
    case BLOCK.PINE_LEAVES:
      return rand() < 0.05 ? [[ITEM.STICK, 1]] : [];
    default: {
      const item = ITEM_OF[blockId]; // (a wall torch gives a torch, any chest the chest)
      return item && itemInfo(item) ? [[item, 1]] : [];
    }
  }
}

// The classic game's drops of the core blocks that differ from "itself"
// (null: the default). Raw ores to smelt, flint from gravel, seeds from
// grass, sticks and apples from leaves (their saplings are the nature
// module's: its `drops` for a leaf block replace these).
function vanillaDrops(blockId, tool, rand) {
  switch (blockId) {
    case BLOCK.IRON_ORE:
      return [[V.RAW_IRON, 1]];
    case BLOCK.GOLD_ORE:
      return [[V.RAW_GOLD, 1]];
    case BLOCK.DIAMOND_ORE:
      return [[V.DIAMOND, 1]];
    case BLOCK.GRAVEL:
      return [[rand() < 0.1 ? V.FLINT : BLOCK.GRAVEL, 1]];
    case BLOCK.TALL_GRASS:
      return rand() < 0.125 ? [[V.WHEAT_SEEDS, 1]] : [];
    case BLOCK.DEAD_BUSH:
      return [[ITEM.STICK, Math.floor(rand() * 3)]];
    case BLOCK.SEAGRASS:
      return []; // (only shears keep it)
    case BLOCK.SNOW:
      // Four snowballs, with a shovel (by hand nothing); the block itself
      // while there are no snowballs.
      if (!itemInfo(V.SNOWBALL)) return null;
      return tool?.type === "shovel" ? [[V.SNOWBALL, 4]] : [];
    case BLOCK.LEAVES:
    case BLOCK.BIRCH_LEAVES:
    case BLOCK.PINE_LEAVES: {
      const out = [];
      if (rand() < 0.02) out.push([ITEM.STICK, 1 + Math.floor(rand() * 2)]);
      if (blockId === BLOCK.LEAVES && rand() < 0.005) out.push([ITEM.APPLE, 1]);
      return out;
    }
    default:
      return null;
  }
}

export function meleeDamage(tool) {
  return tool ? tool.damage : HAND_DAMAGE;
}

// Everything offered in the creative inventory, in display order.
export const CREATIVE_ITEMS = [
  BLOCK.GRASS, BLOCK.DIRT, BLOCK.STONE, BLOCK.COBBLESTONE, BLOCK.SAND, BLOCK.GRAVEL, BLOCK.WOOD, BLOCK.PLANKS,
  BLOCK.LEAVES, BLOCK.OAK_BARK, BLOCK.BIRCH_LOG, BLOCK.BIRCH_LEAVES, BLOCK.PINE_LOG, BLOCK.PINE_LEAVES, BLOCK.GLASS, BLOCK.BRICKS, BLOCK.WOOL, BLOCK.TORCH, BLOCK.LUMEN, BLOCK.CHEST, BLOCK.BEDROCK,
  BLOCK.COAL_ORE, BLOCK.GOLD_ORE, BLOCK.TALL_GRASS, BLOCK.FLOWER_RED, BLOCK.FLOWER_YELLOW,
  BLOCK.SNOW, BLOCK.TERRACOTTA, BLOCK.CACTUS, BLOCK.DEAD_BUSH, BLOCK.CORAL, BLOCK.SEAGRASS, BLOCK.KELP,
  ITEM.STICK, ITEM.COAL, ITEM.GOLD_INGOT, ITEM.FLUFF,
  ITEM.APPLE, ITEM.GOLDEN_APPLE, ITEM.RAW_MEAT, ITEM.COOKED_MEAT,
  ITEM.WOOD_SWORD, ITEM.STONE_SWORD, ITEM.IRON_SWORD, ITEM.DIAMOND_SWORD,
  ITEM.WOOD_PICKAXE, ITEM.STONE_PICKAXE, ITEM.IRON_PICKAXE, ITEM.DIAMOND_PICKAXE,
  ITEM.WOOD_AXE, ITEM.STONE_AXE, ITEM.IRON_AXE, ITEM.DIAMOND_AXE,
  ITEM.WOOD_SHOVEL, ITEM.STONE_SHOVEL, ITEM.IRON_SHOVEL, ITEM.DIAMOND_SHOVEL,
  ITEM.BOW,
  ITEM.PISTOL, ITEM.GRENADE, ITEM.BAZOOKA, ITEM.MACHINE_GUN, ITEM.SNIPER_RIFLE, ITEM.LASER_BLASTER, ITEM.RAILGUN, ITEM.MINIGUN, ITEM.AIRSTRIKE,
  ...ARMOR_TIERS.flatMap((_, t) => [0, 1, 2, 3].map((sl) => armorId(t, sl))),
  // (Round 11) The content modules' blocks and items, module by module.
  ...CONTENT_ORDER.flatMap((o) => [...o.blocks.filter((id) => BLOCK_INFO[id].creative !== false && itemInfo(id)), ...o.items.filter((id) => ITEM_DEFS[id].creative !== false)]),
];

// Every mod weapon and gadget, weakest first (the order of the creative
// palette and of the Creative loadout).
export const ALL_WEAPONS = [ITEM.PISTOL, ITEM.GRENADE, ITEM.BAZOOKA, ITEM.MACHINE_GUN, ITEM.SNIPER_RIFLE, ITEM.LASER_BLASTER, ITEM.RAILGUN, ITEM.MINIGUN, ITEM.AIRSTRIKE];

// A brand new Survival game starts with basic gear: a stone sword, a stone
// pickaxe and some apples. Everything else is found: the bow on the
// skeletons, guns in supply crates, alien weapons on the aliens (see
// progression.js). A new Creative game has every weapon (the hotbar first,
// the rest in the inventory).
export const SURVIVAL_LOADOUT = [ITEM.STONE_SWORD, ITEM.STONE_PICKAXE, [ITEM.APPLE, 5]];
export const CREATIVE_LOADOUT = [...ALL_WEAPONS, ITEM.BOW];
export const STARTING_WEAPONS = SURVIVAL_LOADOUT; // (older name)

// Items that exist only with mods on (guns, explosives, vehicles): put away
// while mods are off. Swords, tools, armor and the bow are vanilla.
export const MOD_ITEMS = new Set(ALL_WEAPONS);

// Whether mods are on (set by mods.js): gates mod items in crafting and the
// creative palette.
export const modState = { enabled: true };

export function itemAllowed(id) {
  return modState.enabled || !MOD_ITEMS.has(id);
}

// (For content code that runs later: see LIB in js/content/base.js.)
Object.assign(LIB, { itemInfo, maxStack, canHarvest, breakTime, blockDrops });
