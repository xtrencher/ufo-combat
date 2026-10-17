// Survival-world rules (Round 11): what vanilla Minecraft's hunger, food,
// status effects and block hazards need to know, shared by player.js (which
// runs them), hud.js (which shows them) and main.js (saving, eating).
//
// - Food: an item's `food` is { hunger, saturation } in vanilla points
//   (bread 5 / 6), with optional `alwaysEat` (a golden apple), `returns` (the
//   bowl of a stew), `effects` and `eatTime` (seconds, default vanilla's 1.6).
//   The four core foods have vanilla values here too, so they work whatever
//   their items.js entry holds; in a Missions world food heals directly, as
//   before Round 11 (MISSIONS_HEAL).
// - Effects: [{ effect, level (1 = I), seconds, chance (0-1) }]. A def may
//   also say `id`, `name` or `type` for the effect, `amplifier` (0 = I) for
//   the level and `duration` for the seconds: effectsOf() reads them all.
// - Block flags read from the block defs (any module's): `lava: true`
//   (lava), `fire: true` (the fire block), `climbable: true` (ladders,
//   vines), `slows: true` (cobwebs), `fallDamage: k` (a landing's damage
//   scaled by k: hay 0.2, beds 0.5), `bed: true` and `head: true|false`
//   (beds, sleep.js). The nature and building parts' known ids count too,
//   in case a def leaves its flag out.
import { BLOCK, BLOCK_INFO, IS_SOLID, IS_OPAQUE, IS_LIQUID, COLLISION_BOXES } from "./blocks.js";
import { BLOCK_LIMIT, ITEM } from "./content/base.js";
import * as ID from "./content/ids.js";

export const MAX_FOOD = 20;
export const START_SATURATION = 5; // (a new or respawned player: vanilla's 5)
export const EAT_TIME = 1.6; // seconds (vanilla: 32 ticks)

// ---------- Blocks ----------
// Per-block flags (one table, read in the player's per-frame body scan).
export const BODY = Object.freeze({ LAVA: 1, FIRE: 2, WEB: 4, CACTUS: 8, CLIMB: 16 });
export const BODY_FLAGS = new Uint8Array(BLOCK_LIMIT);
// Opaque full cubes: the eyes inside one suffocate.
export const SUFFOCATES = new Uint8Array(BLOCK_LIMIT);
// A landing's damage, scaled (vanilla: hay bales 0.2, beds 0.5).
export const FALL_FACTOR = new Float32Array(BLOCK_LIMIT).fill(1);
// Beds (sleep.js): 1 the foot, 2 the head.
export const BED_PART = new Uint8Array(BLOCK_LIMIT);

const inRange = (id, base, n) => id >= base && id < base + n;
for (const info of Object.values(BLOCK_INFO)) {
  const id = info.id;
  const name = typeof info.name === "string" ? info.name : "";
  let f = 0;
  // (Lava may have several ids, one per flow level: the flag, else the name.)
  if (info.lava === true || id === ID.LAVA || (!info.solid && /\blava\b/i.test(name))) f |= BODY.LAVA;
  else if (info.fire === true || id === ID.FIRE) f |= BODY.FIRE;
  if (info.slows === true || id === ID.COBWEB) f |= BODY.WEB;
  if (id === BLOCK.CACTUS || info.cactus === true) f |= BODY.CACTUS;
  if (info.climbable === true || inRange(id, ID.LADDER, 4) || inRange(id, ID.VINE, 4)) f |= BODY.CLIMB;
  BODY_FLAGS[id] = f;
  if (IS_SOLID[id] && IS_OPAQUE[id] && !IS_LIQUID[id] && !COLLISION_BOXES[id]) SUFFOCATES[id] = 1;
  if (Number.isFinite(info.fallDamage)) FALL_FACTOR[id] = Math.max(0, info.fallDamage);
  else if (id === ID.HAY_BLOCK) FALL_FACTOR[id] = 0.2;
  const bed = info.bed === true || inRange(id, ID.RED_BED, 8);
  if (bed) {
    // (The building part's ids: facing (4) x head (2), the head ids second.)
    const head = typeof info.head === "boolean" ? info.head : id - ID.RED_BED >= 4;
    BED_PART[id] = head ? 2 : 1;
    if (!Number.isFinite(info.fallDamage)) FALL_FACTOR[id] = 0.5;
  }
}

// XP for mining an ore (vanilla; Survival worlds): the def's `xp` ([min,
// max], { min, max } or a number), else vanilla's for the known ores (coal
// 0-2, diamond and emerald 3-7, lapis 2-5, redstone 1-5; iron, gold and
// copper give theirs when smelted).
const ORE_XP = {
  [BLOCK.COAL_ORE]: [0, 2],
  [BLOCK.DIAMOND_ORE]: [3, 7],
  [ID.EMERALD_ORE]: [3, 7],
  [ID.LAPIS_ORE]: [2, 5],
  [ID.REDSTONE_ORE]: [1, 5],
  [ID.REDSTONE_ORE + 1]: [1, 5],
};
export function oreXp(id) {
  return BLOCK_INFO[id]?.xp ?? ORE_XP[id] ?? null;
}

// ---------- Food ----------
// Vanilla values for the core foods (their items.js `food` may still be a
// plain number of half-hearts, the Missions world's healing).
const CORE_FOOD = {
  [ITEM.APPLE]: { hunger: 4, saturation: 2.4 },
  [ITEM.GOLDEN_APPLE]: { hunger: 4, saturation: 9.6, alwaysEat: true },
  [ITEM.RAW_MEAT]: { hunger: 3, saturation: 1.8 },
  [ITEM.COOKED_MEAT]: { hunger: 8, saturation: 12.8 },
};
// What food heals in a Missions world (the game before Round 11).
const MISSIONS_HEAL = { [ITEM.APPLE]: 4, [ITEM.GOLDEN_APPLE]: 20, [ITEM.RAW_MEAT]: 2, [ITEM.COOKED_MEAT]: 8 };
// Vanilla's food effects, for a def that doesn't list its own.
const FOOD_EFFECTS = {
  [ITEM.GOLDEN_APPLE]: [
    { effect: "regeneration", level: 2, seconds: 5 },
    { effect: "absorption", level: 1, seconds: 120 },
  ],
  [ID.ROTTEN_FLESH]: [{ effect: "hunger", level: 1, seconds: 30, chance: 0.8 }],
  [ID.CHICKEN]: [{ effect: "hunger", level: 1, seconds: 30, chance: 0.3 }],
  [ID.SPIDER_EYE]: [{ effect: "poison", level: 1, seconds: 5 }],
  [ID.POISONOUS_POTATO]: [{ effect: "poison", level: 1, seconds: 5, chance: 0.6 }],
};
const FOOD_RETURNS = { [ID.MUSHROOM_STEW]: ID.BOWL, [ID.BEETROOT_SOUP]: ID.BOWL };

const num = (v, d = 0) => (Number.isFinite(v) ? v : d);

// An item's vanilla food values ({ hunger, saturation, alwaysEat, returns,
// eatTime }), or null when it isn't food.
export function foodOf(info, id) {
  if (!info?.food) return null;
  const f = info.food;
  const core = CORE_FOOD[id];
  if (typeof f !== "object") {
    const hunger = core ? core.hunger : Math.max(0, Math.round(num(f)));
    return { hunger, saturation: core ? core.saturation : hunger * 0.6, alwaysEat: !!(core?.alwaysEat || info.alwaysEat), returns: info.returns ?? FOOD_RETURNS[id] ?? 0, eatTime: EAT_TIME };
  }
  return {
    hunger: Math.max(0, num(f.hunger, core?.hunger ?? 0)),
    saturation: Math.max(0, num(f.saturation, core?.saturation ?? 0)),
    alwaysEat: !!(f.alwaysEat ?? info.alwaysEat ?? core?.alwaysEat),
    returns: f.returns ?? info.returns ?? FOOD_RETURNS[id] ?? 0,
    eatTime: num(f.eatTime ?? info.eatTime, EAT_TIME) > 0 ? num(f.eatTime ?? info.eatTime, EAT_TIME) : EAT_TIME,
  };
}

// Half-hearts the food heals in a Missions world.
export function missionsHeal(info, id) {
  if (!info?.food) return 0;
  if (typeof info.food === "number") return info.food;
  return num(info.heal, MISSIONS_HEAL[id] ?? num(info.food.heal, num(info.food.hunger)));
}

// The status effects a food gives (normalised; chance still to roll).
export function effectsOf(info, id) {
  const list = info?.food?.effects ?? info?.effects ?? FOOD_EFFECTS[id] ?? null;
  if (!Array.isArray(list)) return [];
  const out = [];
  for (const e of list) {
    const n = normalizeEffect(e);
    if (n) out.push(n);
  }
  return out;
}

// ---------- Status effects ----------
// The effects the game runs (player.js) and shows (hud.js): the vanilla name,
// the HUD's colour, an icon and whether it is instant.
export const EFFECTS = {
  regeneration: { name: "Regeneration", color: "#cd5cab", icon: "heart" },
  poison: { name: "Poison", color: "#4e9331", icon: "drop" },
  hunger: { name: "Hunger", color: "#587653", icon: "drumstick" },
  absorption: { name: "Absorption", color: "#2552a5", icon: "goldheart" },
  saturation: { name: "Saturation", color: "#f82423", icon: "drumstick", instant: true },
  instant_health: { name: "Instant Health", color: "#f82423", icon: "heart", instant: true },
  instant_damage: { name: "Instant Damage", color: "#430a09", icon: "heart", instant: true },
  fire_resistance: { name: "Fire Resistance", color: "#e49a3a", icon: "flame" },
  water_breathing: { name: "Water Breathing", color: "#2e5299", icon: "bubble" },
  speed: { name: "Speed", color: "#7cafc6", icon: "arrow" },
  slowness: { name: "Slowness", color: "#5a6c81", icon: "arrow" },
};
const EFFECT_ALIASES = { regen: "regeneration", heal: "instant_health", harm: "instant_damage", fire_res: "fire_resistance", haste: "speed", slow: "slowness" };

// { effect, level, seconds, chance } from any of the shapes a def may use,
// or null (an unknown effect is kept by name: it shows and runs out).
export function normalizeEffect(e) {
  if (!e) return null;
  if (typeof e === "string") e = { effect: e };
  let name = String(e.effect ?? e.id ?? e.name ?? e.type ?? "").toLowerCase().replace(/[\s-]+/g, "_");
  name = EFFECT_ALIASES[name] || name;
  if (!name) return null;
  const level = Math.max(1, Math.min(10, Math.round(Number.isFinite(e.level) ? e.level : Number.isFinite(e.amplifier) ? e.amplifier + 1 : 1)));
  const seconds = Math.max(0, num(e.seconds ?? e.duration ?? e.time, EFFECTS[name]?.instant ? 0 : 30));
  const chance = Math.max(0, Math.min(1, num(e.chance ?? e.probability, 1)));
  return { effect: name, level, seconds, chance };
}

// "0:05", "1:30" (an effect's time left).
export function formatEffectTime(seconds) {
  const s = Math.max(0, Math.ceil(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

// Roman numerals for the level (II, III...; level I shows none).
export function effectLevelName(level) {
  return ["", "", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX", "X"][level] ?? String(level);
}
