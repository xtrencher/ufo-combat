// Enchanting (Round 11): vanilla's enchantments, the enchanting table's
// offers, the anvil's combining, and what each enchantment does, as numbers
// the game's systems ask for (mining, melee, the bow, armor, fishing).
//
// A stack's enchantments are its tag (js/inventory.js): stack.tag.ench, a
// list of [key, level] (keys as below: "efficiency", "sharpness"...). A
// custom name from the anvil is tag.name, its prior-work penalty tag.rc
// (vanilla's RepairCost: 0, 1, 3, 7...). An enchanted book holds its
// enchantments the same way. Tags are never changed in place: a change makes
// a new tag (stacks share them when copied).
//
// Values are Java Edition's (1.20): weights, level ranges (min/max power by
// level), which items each applies to (the table's primary items, and what
// an anvil may add on top), exclusive groups, enchantability by material,
// the offer costs from up to 15 bookshelves, the anvil's costs (level x the
// rarity's multiplier, halved for books, the prior-work penalty 2^n - 1,
// "Too Expensive!" from 40). Mending (a treasure enchantment found only in
// loot) is left out: XP orbs are xp.js's and repair nothing.
// Pure logic (no three.js, no DOM). Item info comes through LIB (items.js),
// so items.js can import this module.
import { LIB, ITEM, BLOCK } from "./content/base.js";
import * as V from "./content/ids.js";

const lin = (a, b) => (L) => a + (L - 1) * b;
const plus = (min, d) => (L) => min(L) + d;

// key -> { name, max, weight, min(L), max(L) power, on: table items, anvil:
// extra items an anvil may put it on, group (exclusive with the others of
// it), treasure }. Item kinds: sword, axe, pickaxe, shovel, hoe, bow,
// fishing_rod, shears, flint_and_steel, shield, helmet, chestplate,
// leggings, boots ("armor" for every piece).
const E = (name, max, weight, min, maxP, on, extra = {}) => ({ name, max, weight, min, maxP, on, ...extra });
const TOOLS = ["pickaxe", "shovel", "axe", "hoe"];
const ARMOR = ["helmet", "chestplate", "leggings", "boots"];
const DURABLE = [...TOOLS, "sword", "fishing_rod", ...ARMOR];
const DAMAGE = { on: ["sword"], anvil: ["axe"], group: "damage" };
export const ENCHANTMENTS = {
  protection: E("Protection", 4, 10, lin(1, 11), plus(lin(1, 11), 11), ARMOR, { group: "protection" }),
  fire_protection: E("Fire Protection", 4, 5, lin(10, 8), plus(lin(10, 8), 8), ARMOR, { group: "protection" }),
  feather_falling: E("Feather Falling", 4, 5, lin(5, 6), plus(lin(5, 6), 6), ["boots"]),
  blast_protection: E("Blast Protection", 4, 2, lin(5, 8), plus(lin(5, 8), 8), ARMOR, { group: "protection" }),
  projectile_protection: E("Projectile Protection", 4, 5, lin(3, 6), plus(lin(3, 6), 6), ARMOR, { group: "protection" }),
  respiration: E("Respiration", 3, 2, (L) => 10 * L, (L) => 10 * L + 30, ["helmet"]),
  aqua_affinity: E("Aqua Affinity", 1, 2, () => 1, () => 41, ["helmet"]),
  thorns: E("Thorns", 3, 1, lin(10, 20), plus(lin(10, 20), 50), ["chestplate"], { anvil: ARMOR }),
  sharpness: E("Sharpness", 5, 10, lin(1, 11), plus(lin(1, 11), 20), DAMAGE.on, { anvil: DAMAGE.anvil, group: "damage" }),
  smite: E("Smite", 5, 5, lin(5, 8), plus(lin(5, 8), 20), DAMAGE.on, { anvil: DAMAGE.anvil, group: "damage" }),
  bane_of_arthropods: E("Bane of Arthropods", 5, 5, lin(5, 8), plus(lin(5, 8), 20), DAMAGE.on, { anvil: DAMAGE.anvil, group: "damage" }),
  knockback: E("Knockback", 2, 5, lin(5, 20), plus(lin(5, 20), 50), ["sword"]),
  fire_aspect: E("Fire Aspect", 2, 2, lin(10, 20), plus(lin(10, 20), 50), ["sword"]),
  looting: E("Looting", 3, 2, lin(15, 9), plus(lin(15, 9), 50), ["sword"]),
  efficiency: E("Efficiency", 5, 10, lin(1, 10), plus(lin(1, 10), 50), TOOLS, { anvil: ["shears"] }),
  silk_touch: E("Silk Touch", 1, 1, () => 15, () => 65, TOOLS, { group: "harvest" }),
  unbreaking: E("Unbreaking", 3, 5, lin(5, 8), plus(lin(5, 8), 50), DURABLE, { anvil: ["shears", "flint_and_steel", "shield"] }),
  fortune: E("Fortune", 3, 2, lin(15, 9), plus(lin(15, 9), 50), TOOLS, { group: "harvest" }),
  power: E("Power", 5, 10, lin(1, 10), plus(lin(1, 10), 15), ["bow"]),
  punch: E("Punch", 2, 2, lin(12, 20), plus(lin(12, 20), 25), ["bow"]),
  flame: E("Flame", 1, 2, () => 20, () => 50, ["bow"]),
  infinity: E("Infinity", 1, 1, () => 20, () => 50, ["bow"]),
  luck_of_the_sea: E("Luck of the Sea", 3, 2, lin(15, 9), plus(lin(15, 9), 50), ["fishing_rod"]),
  lure: E("Lure", 3, 2, lin(15, 9), plus(lin(15, 9), 50), ["fishing_rod"]),
};
export const ENCHANT_KEYS = Object.keys(ENCHANTMENTS);
const MAX_ENCHANT_LEVEL = 10; // (a saved or sent level is clamped to this)

// The anvil's multiplier by rarity (weight 10 common, 5 uncommon, 2 rare, 1 very rare).
const RARITY_COST = { 10: 1, 5: 2, 2: 4, 1: 8 };

// Roman numerals for the levels (vanilla shows "I" too, except on one-level enchantments).
const ROMAN = ["", "I", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX", "X"];
export function enchantName(key, level) {
  const e = ENCHANTMENTS[key];
  if (!e) return key;
  return e.max === 1 && level === 1 ? e.name : `${e.name} ${ROMAN[level] ?? level}`;
}

// ---------- What an item is, for enchanting ----------

const ARMOR_SLOT_KIND = ["helmet", "chestplate", "leggings", "boots"];
// Enchantability (vanilla): tools by material (told apart by their uses),
// armor by tier; the bow, the rod and a book 1.
const TOOL_ENCHANTABILITY = { 60: 15, 132: 5, 251: 14, 1562: 10, 33: 22 };
const TOOL_MATERIAL = { 60: "wood", 132: "stone", 251: "iron", 1562: "diamond", 33: "gold" };
const ARMOR_ENCHANTABILITY = [15, 25, 9, 10]; // leather, gold, iron, diamond (items.js ARMOR_TIERS)
const ARMOR_MATERIAL = ["leather", "gold", "iron", "diamond"];
const CHAIN = new Set([V.CHAINMAIL_HELMET, V.CHAINMAIL_CHESTPLATE, V.CHAINMAIL_LEGGINGS, V.CHAINMAIL_BOOTS]);

const kindCache = new Map();
// { kind, armor (true for a piece of armor), material, enchantability } or
// null: what can't be enchanted at all (blocks, food, guns...).
export function enchantKind(id) {
  if (kindCache.has(id)) return kindCache.get(id);
  const info = LIB.itemInfo?.(id);
  let k = null;
  if (id === V.BOOK) k = { kind: "book", enchantability: 1 };
  else if (id === V.ENCHANTED_BOOK) k = { kind: "enchanted_book", enchantability: 0 };
  else if (info?.weapon?.kind === "bow") k = { kind: "bow", enchantability: 1 };
  else if (info?.armor) {
    const chain = CHAIN.has(id);
    const t = info.armor.tier;
    k = { kind: ARMOR_SLOT_KIND[info.armor.slot], armor: true, material: chain ? "chain" : ARMOR_MATERIAL[t], enchantability: chain ? 12 : ARMOR_ENCHANTABILITY[t] ?? 0 };
  } else if (info?.tool && !info.weapon) {
    const type = info.tool.type;
    if (type === "fishing_rod") k = { kind: type, enchantability: 1 };
    else if (["sword", ...TOOLS].includes(type)) k = { kind: type, material: TOOL_MATERIAL[info.tool.durability], enchantability: TOOL_ENCHANTABILITY[info.tool.durability] ?? 0 };
    else if (["shears", "flint_and_steel", "shield"].includes(type)) k = { kind: type, material: type === "shield" ? "wood" : null, enchantability: 0 };
  }
  // (Before items.js has loaded nothing is cached: asked again later.)
  if (LIB.itemInfo) kindCache.set(id, k);
  return k;
}

// Whether enchantment `key` may go on items of `kind` (an enchantKind):
// at the table (primary items), or with an anvil (those and its extras).
// A book takes anything; an enchanted book (at the anvil) anything too.
export function canEnchant(key, kind, anvil = false) {
  const e = ENCHANTMENTS[key];
  if (!e || !kind) return false;
  if (kind.kind === "book" || kind.kind === "enchanted_book") return true;
  const k = kind.kind;
  const ok = (list) => !!list && (list.includes(k) || (kind.armor && list === ARMOR));
  if (ok(e.on)) return true;
  return anvil && ok(e.anvil);
}

// Two enchantments that can't be on one item (the same group: the
// protections, the damage ones, silk touch and fortune; infinity is fine
// without mending).
export function compatible(a, b) {
  if (a === b) return false;
  const ga = ENCHANTMENTS[a]?.group;
  return !ga || ga !== ENCHANTMENTS[b]?.group;
}

// ---------- Tags ----------

// A clean copy of a tag from a save or the network, or undefined (nothing in it).
export function cleanTag(t) {
  if (!t || typeof t !== "object") return undefined;
  const out = {};
  if (Array.isArray(t.ench)) {
    const seen = new Set();
    const list = [];
    for (const e of t.ench) {
      if (!Array.isArray(e) || typeof e[0] !== "string" || !ENCHANTMENTS[e[0]] || seen.has(e[0])) continue;
      const lvl = Math.round(Number(e[1]));
      if (!(lvl >= 1)) continue;
      seen.add(e[0]);
      list.push([e[0], Math.min(MAX_ENCHANT_LEVEL, lvl)]);
      if (list.length >= 16) break;
    }
    if (list.length) out.ench = list;
  }
  if (typeof t.name === "string") {
    const name = t.name.replace(/[\u0000-\u001f\u007f<>]/g, "").trim().slice(0, 50);
    if (name) out.name = name;
  }
  if (Number.isInteger(t.rc) && t.rc > 0) out.rc = Math.min(t.rc, 2 ** 31 - 1);
  return out.ench || out.name || out.rc ? out : undefined;
}

const tagKey = (t) => (t ? JSON.stringify([t.ench ?? 0, t.name ?? 0, t.rc ?? 0]) : "");
// Whether two tags say the same (stacks with different ones don't merge).
export function sameTag(a, b) {
  if (a === b) return true;
  if (!a || !b) return !cleanTag(a) && !cleanTag(b);
  return tagKey(a) === tagKey(b);
}

// The level of enchantment `key` on a stack (0: none).
export function enchLevel(stack, key) {
  const list = stack?.tag?.ench;
  if (!list) return 0;
  for (let i = 0; i < list.length; i++) if (list[i][0] === key) return list[i][1];
  return 0;
}

export function isEnchanted(stack) {
  return !!stack?.tag?.ench?.length;
}

// A tag with the enchantments `list` ([[key, level], ...]) in place of the old ones.
export function withEnchants(tag, list) {
  const t = { ...(tag || {}) };
  if (list && list.length) t.ench = list.map(([k, l]) => [k, l]);
  else delete t.ench;
  return cleanTag(t);
}

// The lines a tooltip shows under the name: the enchantments, in order.
export function enchantLines(stack) {
  const list = stack?.tag?.ench;
  return list ? list.map(([k, l]) => enchantName(k, l)) : [];
}

// ---------- A seeded random (the table's offers stay put until you enchant) ----------

export function seededRandom(seed) {
  let s = seed >>> 0;
  const next = () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return { float: next, int: (n) => (n > 0 ? Math.floor(next() * n) : 0) };
}

// ---------- The enchanting table ----------

// Bookshelves around a table at (x, y, z) (vanilla's 5x5 ring, one and two
// blocks up, with air between: at most 15 count).
export function countBookshelves(world, x, y, z) {
  const shelf = (dx, dy, dz) => (world.getBlock(x + dx, y + dy, z + dz) === V.BOOKSHELF ? 1 : 0);
  const open = (dx, dy, dz) => {
    const id = world.getBlock(x + dx, y + dy, z + dz);
    return id === BLOCK.AIR || !!LIB.IS_REPLACEABLE?.[id];
  };
  let n = 0;
  for (let dz = -1; dz <= 1; dz++) {
    for (let dx = -1; dx <= 1; dx++) {
      if ((dx === 0 && dz === 0) || !open(dx, 0, dz) || !open(dx, 1, dz)) continue;
      for (let dy = 0; dy <= 1; dy++) {
        n += shelf(dx * 2, dy, dz * 2);
        if (dx !== 0 && dz !== 0) n += shelf(dx * 2, dy, dz) + shelf(dx, dy, dz * 2);
      }
    }
  }
  return Math.min(15, n);
}

// The level an offer in slot `slot` (0-2) costs (vanilla's getEnchantmentCost; 0: none).
function offerCost(rand, slot, shelves, enchantability) {
  if (enchantability <= 0) return 0;
  const p = Math.min(15, shelves);
  const j = rand.int(8) + 1 + (p >> 1) + rand.int(p + 1);
  if (slot === 0) return Math.max(Math.floor(j / 3), 1);
  if (slot === 1) return Math.floor((j * 2) / 3) + 1;
  return Math.max(j, p * 2);
}

function weightedPick(rand, list) {
  let total = 0;
  for (const e of list) total += ENCHANTMENTS[e[0]].weight;
  let r = rand.int(total);
  for (const e of list) {
    r -= ENCHANTMENTS[e[0]].weight;
    if (r < 0) return e;
  }
  return list[list.length - 1];
}

// The enchantments of `power` an item of `kind` can get (the highest level
// of each whose range holds the power), treasure ones never.
function available(kind, power, treasure = false) {
  const out = [];
  for (const key of ENCHANT_KEYS) {
    const e = ENCHANTMENTS[key];
    if ((e.treasure && !treasure) || !canEnchant(key, kind)) continue;
    for (let L = e.max; L >= 1; L--) {
      if (power >= e.min(L) && power <= e.maxP(L)) {
        out.push([key, L]);
        break;
      }
    }
  }
  return out;
}

// Vanilla's selectEnchantment: the power from the level and the item's
// enchantability, one pick by weight, then more while a roll under the
// power (halved each time) says so, never two that conflict.
export function rollEnchantments(rand, kind, level, treasure = false) {
  const ench = kind?.enchantability ?? 0;
  if (ench <= 0) return [];
  let power = level + 1 + rand.int(Math.floor(ench / 4) + 1) + rand.int(Math.floor(ench / 4) + 1);
  const f = (rand.float() + rand.float() - 1) * 0.15;
  power = Math.max(1, Math.round(power + power * f));
  let list = available(kind, power, treasure);
  const out = [];
  if (!list.length) return out;
  out.push(weightedPick(rand, list));
  while (rand.int(50) <= power) {
    const last = out[out.length - 1][0];
    list = list.filter((e) => compatible(e[0], last) && out.every((o) => compatible(e[0], o[0])));
    if (!list.length) break;
    out.push(weightedPick(rand, list));
    power = Math.floor(power / 2);
  }
  return out;
}

// The three offers for a stack on the table with `shelves` bookshelves
// around: [{ cost (levels needed; 0: none), lapis (and levels spent: 1-3),
// list (what it gives), clue ([key, level]: what the screen shows) }], or
// null when the item can't be enchanted (or already is).
export function tableOffers(stack, shelves, seed) {
  if (!stack || stack.count < 1 || isEnchanted(stack)) return null;
  const kind = enchantKind(stack.id);
  if (!kind || kind.enchantability <= 0 || kind.kind === "enchanted_book") return null;
  const r = seededRandom(seed);
  const costs = [0, 1, 2].map((i) => offerCost(r, i, shelves, kind.enchantability));
  return costs.map((c, i) => {
    const cost = c < i + 1 ? 0 : c;
    if (!cost) return { cost: 0, lapis: i + 1, list: [], clue: null };
    const rr = seededRandom((seed + i * 7919) >>> 0);
    const list = rollEnchantments(rr, kind, cost);
    // (A book gets one fewer when it would get several: vanilla.)
    if (kind.kind === "book" && list.length > 1) list.splice(rr.int(list.length), 1);
    if (!list.length) return { cost: 0, lapis: i + 1, list: [], clue: null };
    return { cost, lapis: i + 1, list, clue: list[rr.int(list.length)] };
  });
}

// The stack an offer makes of `stack` (a book: an enchanted book).
export function applyOffer(stack, offer) {
  const id = stack.id === V.BOOK ? V.ENCHANTED_BOOK : stack.id;
  const tag = withEnchants(stack.tag, offer.list);
  const out = { id, count: 1 };
  if (stack.dur !== undefined && id === stack.id) out.dur = stack.dur;
  if (tag) out.tag = tag;
  return out;
}

// Each player's enchanting seed (vanilla: it changes after every enchant, so
// the table's offers stay the same until then).
const seedState = { seed: (Math.random() * 2 ** 31) >>> 0 };
export function enchantSeed() {
  return seedState.seed;
}
export function nextEnchantSeed() {
  seedState.seed = (Math.random() * 2 ** 31) >>> 0;
  return seedState.seed;
}
// (The saved seed back: a reload doesn't re-roll the offers for free.)
export function setEnchantSeed(s) {
  if (Number.isInteger(s) && s >= 0) seedState.seed = s >>> 0;
}

// ---------- Loot: a random enchantment (books in chests, the treasure of fishing) ----------

// Vanilla's enchant_randomly (books: one enchantment, any level), or
// enchant_with_levels (level: 30 for a fishing treasure, 5-15 for dungeon
// loot...): the tag for item `id`, or undefined.
export function randomEnchantTag(id, rand = Math.random, level = 0) {
  const kind = enchantKind(id === V.ENCHANTED_BOOK ? V.BOOK : id);
  if (!kind) return undefined;
  const r = { float: rand, int: (n) => (n > 0 ? Math.floor(rand() * n) : 0) };
  if (level > 0) return withEnchants(undefined, rollEnchantments(r, kind, level, true));
  const keys = ENCHANT_KEYS.filter((k) => canEnchant(k, kind));
  if (!keys.length) return undefined;
  const key = keys[r.int(keys.length)];
  return withEnchants(undefined, [[key, 1 + r.int(ENCHANTMENTS[key].max)]]);
}

// An enchanted book stack for a loot table (one random enchantment, as vanilla's chests).
export function enchantedBook(rand = Math.random, level = 0) {
  const tag = randomEnchantTag(V.BOOK, rand, level);
  return tag ? { id: V.ENCHANTED_BOOK, count: 1, tag } : null;
}

// ---------- The anvil ----------

// The material that repairs an item at the anvil (an id, or a list: any planks).
const PLANKS = [BLOCK.PLANKS, V.SPRUCE_PLANKS, V.BIRCH_PLANKS, V.JUNGLE_PLANKS, V.ACACIA_PLANKS, V.DARK_OAK_PLANKS];
const REPAIR = { wood: PLANKS, stone: [BLOCK.COBBLESTONE], iron: [V.IRON_INGOT], gold: [ITEM.GOLD_INGOT], diamond: [V.DIAMOND], leather: [V.LEATHER], chain: [V.IRON_INGOT] };
function repairsWith(kind, id) {
  const list = kind?.material ? REPAIR[kind.material] : null;
  return !!list && list.includes(id);
}

const maxDur = (id) => {
  const info = LIB.itemInfo?.(id);
  return (info?.tool || info?.armor)?.durability ?? 0;
};

// The anvil's result for `left` with `right` (either may be null) and the
// name typed (`name`: the text in the box; "" clears a custom name): {
// out (the stack made), cost (levels), use (how many of `right` it takes),
// tooExpensive } or null (nothing to make). creative: never too expensive.
export function anvilResult(left, right, name = "", creative = false) {
  if (!left) return null;
  const kindL = enchantKind(left.id);
  const max = maxDur(left.id);
  let out = { id: left.id, count: left.count };
  if (left.dur !== undefined) out.dur = left.dur;
  let ench = left.tag?.ench ? left.tag.ench.map(([k, l]) => [k, l]) : [];
  let cost = 0;
  let use = 0;
  const base = (left.tag?.rc ?? 0) + (right?.tag?.rc ?? 0);
  if (right) {
    const book = right.id === V.ENCHANTED_BOOK && !!right.tag?.ench?.length;
    if (max > 0 && out.dur !== undefined && repairsWith(kindL, right.id)) {
      // Repair with the material: a quarter of the uses each, a level each.
      let dur = out.dur;
      if (dur >= max) return null;
      const per = Math.max(1, Math.floor(max / 4));
      while (dur < max && use < right.count) {
        dur = Math.min(max, dur + per);
        use++;
        cost++;
      }
      out.dur = dur;
    } else {
      if ((!book && right.id !== left.id) || left.id === V.BOOK) return null;
      if (left.count > 1 || right.count > 1) return null; // (stacks: vanilla combines single items only)
      if (!book && max > 0 && left.dur !== undefined && right.dur !== undefined && left.dur < max) {
        // Two of the same: their uses added, 12% of the whole on top.
        out.dur = Math.min(max, left.dur + right.dur + Math.floor((max * 12) / 100));
        cost += 2;
      }
      let applied = false;
      let refused = false;
      for (const [key, lvl] of right.tag?.ench ?? []) {
        const e = ENCHANTMENTS[key];
        if (!e) continue;
        const cur = ench.find((x) => x[0] === key)?.[1] ?? 0;
        const level = Math.min(e.max, cur === lvl ? lvl + 1 : Math.max(cur, lvl));
        let ok = left.id === V.ENCHANTED_BOOK || canEnchant(key, kindL, true);
        for (const [other] of ench) {
          if (other !== key && !compatible(key, other)) {
            ok = false;
            cost++;
          }
        }
        if (!ok) {
          refused = true;
          continue;
        }
        applied = true;
        if (cur) ench = ench.map((x) => (x[0] === key ? [key, level] : x));
        else ench.push([key, level]);
        const mul = RARITY_COST[e.weight] ?? 1;
        cost += level * (book ? Math.max(1, mul >> 1) : mul);
      }
      if (refused && !applied) return null;
      use = 1;
    }
  }
  // The name: a new one costs a level; an empty box takes a custom name off.
  const was = left.tag?.name ?? "";
  const typed = String(name ?? "").replace(/[\u0000-\u001f\u007f<>]/g, "").slice(0, 50);
  const defaultName = LIB.itemInfo?.(left.id)?.name ?? "";
  let rename = 0;
  let newName = was;
  if (typed.trim() && typed.trim() !== (was || defaultName)) {
    newName = typed.trim();
    rename = 1;
  } else if (!typed.trim() && was) {
    newName = "";
    rename = 1;
  }
  const work = cost;
  cost += rename + base;
  if (work + rename <= 0) return null;
  // (Renaming alone is never too expensive: vanilla caps it at 39.)
  if (rename && !work && cost >= 40) cost = 39;
  let rc = Math.max(left.tag?.rc ?? 0, right?.tag?.rc ?? 0);
  if (work > 0) rc = rc * 2 + 1;
  const tag = cleanTag({ ench, name: newName || undefined, rc });
  if (tag) out.tag = tag;
  return { out, cost, use, tooExpensive: cost >= 40 && !creative };
}

// ---------- What enchantments do (asked by the game's systems) ----------

// Undead and arthropods (Smite, Bane of Arthropods).
const UNDEAD = new Set(["zombie", "skeleton", "husk", "drowned", "stray", "zombie_villager", "wither_skeleton", "phantom"]);
const ARTHROPODS = new Set(["spider", "cave_spider", "silverfish", "endermite", "bee"]);
export const isUndead = (kind) => UNDEAD.has(kind);

// The extra damage of a melee blow with `stack` on a creature of `kind`
// (Java's: Sharpness 0.5 x level + 0.5, Smite and Bane 2.5 a level).
export function meleeBonus(stack, kind) {
  let d = 0;
  const s = enchLevel(stack, "sharpness");
  if (s) d += 0.5 * s + 0.5;
  if (UNDEAD.has(kind)) d += 2.5 * enchLevel(stack, "smite");
  if (ARTHROPODS.has(kind)) d += 2.5 * enchLevel(stack, "bane_of_arthropods");
  return d;
}

// Mining speed: Efficiency adds level^2 + 1 to a tool working at its own
// speed (vanilla: only when the tool is faster than a hand on the block).
export function efficiencyBonus(stack) {
  const L = enchLevel(stack, "efficiency");
  return L ? L * L + 1 : 0;
}

// Unbreaking: whether one point of wear is skipped (tools: kept with a
// chance of L/(L+1); armor: worn 60% + 40%/(L+1) of the time).
export function unbreakingSaves(stack, armor = false, rand = Math.random) {
  const L = enchLevel(stack, "unbreaking");
  if (!L) return false;
  if (armor) return rand() >= 0.6 + 0.4 / (L + 1);
  return rand() >= 1 / (L + 1);
}

// The drops' Fortune bonus, vanilla's ore formula: count x (max(0, rand(L+2) - 1) + 1).
export function fortuneCount(count, L, rand = Math.random) {
  if (!(L > 0)) return count;
  return count * (Math.max(0, Math.floor(rand() * (L + 2)) - 1) + 1);
}

// The Protection family on the armor worn against a hurt of `cause`: the
// share of the damage it takes away (vanilla: points (EPF) per level:
// Protection 1, the special ones 2, Feather Falling 3 on falls; at most 20
// points = 80%).
const FIRE_CAUSES = new Set(["fire", "lava", "burn"]);
const BLAST_CAUSES = new Set(["creeper", "explosion", "grenade", "bazooka", "airstrike", "missile", "tnt", "ufo_blast", "ufo_boom", "jet_boom", "cannon", "ufocannon"]);
const PROJECTILE_CAUSES = new Set(["skeleton", "arrow", "bow", "witch_potion"]);
// (Hurts nothing stops: the void, starving, the game's own crashes and the nuke.)
const UNPROTECTED = new Set(["void", "starve", "jet_crash", "jet_down", "ufo_down", "abducted", "nuke"]);
export function protectionShare(armor, cause) {
  if (!armor) return 0;
  const c = typeof cause === "string" ? cause.split("@")[0] : "";
  if (UNPROTECTED.has(c)) return 0;
  const fall = c === "fall" || c.endsWith("_fall");
  const base = fall ? c.slice(0, -5) : c;
  let epf = 0;
  for (const s of armor) {
    if (!s?.tag?.ench) continue;
    epf += enchLevel(s, "protection");
    if (FIRE_CAUSES.has(c)) epf += 2 * enchLevel(s, "fire_protection");
    if (BLAST_CAUSES.has(base)) epf += 2 * enchLevel(s, "blast_protection");
    if (PROJECTILE_CAUSES.has(c)) epf += 2 * enchLevel(s, "projectile_protection");
    if (fall) epf += 3 * enchLevel(s, "feather_falling");
  }
  return Math.min(20, epf) * 0.04;
}

// The highest level of `key` on any piece worn (Respiration, Aqua Affinity, Thorns).
export function armorLevel(armor, key) {
  let n = 0;
  if (armor) for (const s of armor) n = Math.max(n, enchLevel(s, key));
  return n;
}

// Thorns: the pieces that strike back at a melee attacker (vanilla: 15% a
// level, 1-4 damage, the piece worn 2 more). Returns the damage (0: none);
// wear(i, n) wears armor piece i.
export function thornsDamage(armor, rand = Math.random, wear = null) {
  let dmg = 0;
  if (!armor) return 0;
  for (let i = 0; i < armor.length; i++) {
    const L = enchLevel(armor[i], "thorns");
    if (!L || rand() >= 0.15 * L) continue;
    dmg += 1 + Math.floor(rand() * 4);
    wear?.(i, 2);
  }
  return dmg;
}

// The fishing rod (fishing.js): Lure takes 5 s a level off the wait; Luck of
// the Sea moves the odds (vanilla weights + quality x luck: fish 85 - L, junk 10 - 2L, treasure 5 + 2L).
export function lureSeconds(stack) {
  return 5 * enchLevel(stack, "lure");
}
export function fishingOdds(stack) {
  const L = enchLevel(stack, "luck_of_the_sea");
  const fish = 85 - L;
  const junk = Math.max(0, 10 - 2 * L);
  const treasure = 5 + 2 * L;
  const t = fish + junk + treasure;
  return { fish: fish / t, junk: junk / t, treasure: treasure / t };
}
