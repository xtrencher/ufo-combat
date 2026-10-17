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
import { BLOCK, BLOCK_INFO, ITEM_OF, isBlockId } from "./blocks.js";
import { ITEM, LIB } from "./content/base.js";
import { CONTENT_ITEMS, CONTENT_ORDER, BLOCK_DROPS } from "./content/index.js";

export { ITEM };

// Tool materials: tier (what they can harvest), mining speed multiplier,
// durability (uses), and melee damage for a sword (other tools hit weaker).
export const MATERIALS = {
  wood: { tier: 1, speed: 2, durability: 60, sword: 4, color: "wood" },
  stone: { tier: 2, speed: 4, durability: 132, sword: 5, color: "stone" },
  iron: { tier: 3, speed: 6, durability: 251, sword: 6, color: "iron" },
  diamond: { tier: 4, speed: 8, durability: 1562, sword: 7, color: "diamond" },
};

const HAND_DAMAGE = 1;

const ITEM_DEFS = {
  [ITEM.STICK]: { name: "Stick", icon: "stick" },
  [ITEM.COAL]: { name: "Coal", icon: "coal" },
  [ITEM.GOLD_INGOT]: { name: "Gold Ingot", icon: "gold_ingot" },
  [ITEM.APPLE]: { name: "Apple", icon: "apple", food: 4 },
  // Heals fully and adds four golden (absorption) hearts on top.
  [ITEM.GOLDEN_APPLE]: { name: "Golden Apple", icon: "golden_apple", food: 20, absorb: 8 },
  [ITEM.RAW_MEAT]: { name: "Raw Meat", icon: "raw_meat", food: 2 },
  [ITEM.COOKED_MEAT]: { name: "Cooked Meat", icon: "cooked_meat", food: 8 },
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
  // The skeletons' bow: hold right click to draw, let go to shoot.
  [ITEM.BOW]: { name: "Bow", icon: "bow", stack: 1, weapon: { kind: "bow" } },
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
for (const [matKey, mat] of Object.entries(MATERIALS)) {
  for (const [kindKey, type, label] of TOOL_KINDS) {
    const id = ITEM[`${matKey.toUpperCase()}_${kindKey}`];
    const matName = matKey === "wood" ? "Wooden" : matKey[0].toUpperCase() + matKey.slice(1);
    ITEM_DEFS[id] = {
      name: `${matName} ${label}`,
      icon: `${type}_${matKey}`,
      stack: 1,
      tool: {
        type,
        tier: mat.tier,
        speed: mat.speed,
        durability: mat.durability,
        damage: type === "sword" ? mat.sword : type === "axe" ? mat.sword - 1 : Math.max(2, mat.sword - 3),
      },
    };
  }
}

// (Round 11) The content modules' items (their ids checked in js/content/index.js).
for (const [id, def] of Object.entries(CONTENT_ITEMS)) ITEM_DEFS[id] = def;

const itemCache = new Map();

// Info for any item id: { id, name, stack, icon, block?, tool?, food? }, or null.
export function itemInfo(id) {
  if (itemCache.has(id)) return itemCache.get(id);
  let info = null;
  // (A block that counts as another item, e.g. a wall torch, is no item itself.)
  if (id > 0 && isBlockId(id) && BLOCK_INFO[id] && ITEM_OF[id] === id) {
    const b = BLOCK_INFO[id];
    info = { id, name: b.name, stack: 64, block: id, icon: null };
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

// Whether `tool` (item info's .tool, or null for the bare hand) gets drops from the block.
export function canHarvest(blockId, tool) {
  const b = BLOCK_INFO[blockId];
  if (!b || b.hardness < 0) return false;
  if (b.minTier === 0) return true;
  return !!tool && tool.type === b.tool && tool.tier >= b.minTier;
}

// Seconds to break the block in survival (Infinity if unbreakable):
// hardness * (harvestable ? 1.5 : 5) / tool speed, as in classic voxel games.
export function breakTime(blockId, tool) {
  const b = BLOCK_INFO[blockId];
  if (!b || b.hardness < 0) return Infinity;
  if (b.hardness === 0) return 0;
  const speed = tool && b.tool && tool.type === b.tool ? tool.speed : 1;
  return (b.hardness * (canHarvest(blockId, tool) ? 1.5 : 5)) / speed;
}

// Items dropped when a block is broken in survival: array of [itemId, count].
// (A content module's `drops` for the block come first: js/content/index.js.)
export function blockDrops(blockId, tool, rand = Math.random) {
  if (!canHarvest(blockId, tool)) return [];
  const custom = BLOCK_DROPS[blockId]?.(tool, rand);
  if (custom) return custom.filter(([id, n]) => n > 0 && itemInfo(id));
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
