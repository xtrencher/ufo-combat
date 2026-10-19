// Chests (Round 10): storage blocks of 27 slots. Village houses have them,
// and a player can place one (Creative palette). A generated chest's
// contents are rolled the first time anyone opens it, from the progression's
// loot at the chain's current tier (a chest is worth less than a supply
// crate: food, torches, now and then a golden apple or a tool, sometimes a
// standard weapon the tier already allows, rarely armor), seeded by the world
// seed and the chest's place. A chest a player placed starts empty: it is a
// recorded edit, where a generated one is not. Breaking a chest, by hand, a
// blast or anyone online, drops what it holds. Only chests that were opened
// (or changed) are kept, and saved with the world (serialize / load).
//
// Online the host owns every chest (js/net/chests.js): a guest's screen
// shows the host's contents, and its clicks are asked of the host, applied
// in the host's order and passed on to everyone with that chest open.
//
// (Round 12) Every dimension's chests are in the one store: a chest of the
// Nether or the End is keyed "n:x,y,z" / "e:x,y,z" (js/dim-registry.js
// dimKey; the Overworld's keep "x,y,z"), so a chest at the same place in two
// dimensions is two chests, and the host keeps them all wherever it is.
//
// (Round 12) Every block that holds a chest's 27 slots is kept here: the
// chest, the barrel and the shulker box (js/content/containers.js,
// workstations.js: IS_STORAGE). Two chests side by side facing the same way
// join (placeChest): each half keeps its own slots, one screen (openView)
// shows both, the left half's on top; a half that goes leaves its other half
// a single chest (the edit of whoever broke it). A barrel or shulker box
// found in the world starts empty. A broken shulker box drops itself with
// what it held in it (its item's tag.items: [[slot, ...stack], ...]), which
// a box placed from it gets back (fillPlaced). The bell rings here too
// (ringBell: every player near hears it, online through js/net/chests.js).
//
// Pure logic (no three.js, no DOM): the game sets the hooks.
import { IS_CHEST, BLOCK, BLOCK_INFO, BLOCK_LIMIT } from "./blocks.js";
import { ITEM, itemInfo, maxStack, itemAllowed } from "./items.js";
import { makeStack, encodeStack, decodeStack, sameStack } from "./inventory.js";
import { pickCrateWeapon, pickTool, rollArmorDrop } from "./progression.js";
import { mulberry32 } from "./noise.js";
import { chunkKey, blockIndex } from "./constants.js";
import { isVanilla } from "./worldtype.js";
import * as V from "./content/ids.js";
import { structureLootAt } from "./structures.js";
import { dimKey, DIM_KEY_RE, OVERWORLD, codeOf, parseDimKey } from "./dim-registry.js";
import { isDoubleChest, chestHalf, chestPartner, doubleChestId, isShulkerBox } from "./content/workstations.js";
import { LIB } from "./content/base.js";

export const CHEST_SLOTS = 27;
// (Round 12) The blocks that hold a chest's slots: the chests (both halves
// of a double one), the barrel, the shulker box.
export const IS_STORAGE = new Uint8Array(BLOCK_LIMIT);
for (const info of Object.values(BLOCK_INFO)) if (IS_CHEST[info.id] || info.chest || info.storage) IS_STORAGE[info.id] = 1;
// The facings' fronts (js/content/workstations.js: 0 +Z, 1 -Z, 2 +X, 3 -X;
// the single chest of facing k is BLOCK.CHEST + k).
const FRONTS = [
  [0, 1],
  [0, -1],
  [1, 0],
  [-1, 0],
];
const BELL_HEAR = 64; // blocks
// (A batch this big is a big blast: the chests in it that were never opened
// burn with their loot instead of each spilling a fresh roll.)
const BIG_BATCH = 2048;

// A stack for the save and the wire, and back (Round 11: the inventory's,
// which carry a stack's tag: enchantments, a name).
export { encodeStack, decodeStack, sameStack };

// (Round 11) A Survival world's village chests hold the classic game's
// village loot: each chest is one of the village's buildings (a house most
// often, else a smith's, a butcher's...), and rolls that building's table
// (rolls: how many draws; entries [id, weight, min, max]). Items not built
// yet (another module's) are skipped.
const VILLAGE_LOOT = [
  // [share of chests, rolls [min, max], entries]
  [40, [3, 8], [[V.GOLD_NUGGET, 1, 1, 3], [BLOCK.FLOWER_YELLOW, 2, 1, 1], [BLOCK.FLOWER_RED, 1, 1, 1], [V.POTATO, 10, 1, 7], [V.BREAD, 10, 1, 4], [ITEM.APPLE, 10, 1, 5], [V.BOOK, 1, 1, 1], [V.FEATHER, 1, 1, 1], [V.EMERALD, 2, 1, 4], [V.OAK_SAPLING, 5, 1, 2]]], // a plains house
  [10, [3, 8], [[V.DIAMOND, 3, 1, 3], [V.IRON_INGOT, 10, 1, 5], [ITEM.GOLD_INGOT, 5, 1, 3], [V.BREAD, 15, 1, 3], [ITEM.APPLE, 15, 1, 3], [ITEM.IRON_PICKAXE, 5, 1, 1], [ITEM.IRON_SWORD, 5, 1, 1], [ITEM.IRON_CHESTPLATE, 5, 1, 1], [ITEM.IRON_HELMET, 5, 1, 1], [ITEM.IRON_LEGGINGS, 5, 1, 1], [ITEM.IRON_BOOTS, 5, 1, 1], [V.OBSIDIAN, 5, 3, 7], [V.OAK_SAPLING, 5, 3, 7]]], // a weaponsmith
  [10, [3, 8], [[V.DIAMOND, 1, 1, 3], [V.IRON_INGOT, 5, 1, 5], [ITEM.GOLD_INGOT, 1, 1, 3], [V.BREAD, 15, 1, 3], [ITEM.IRON_PICKAXE, 1, 1, 1], [ITEM.COAL, 1, 1, 3], [ITEM.STICK, 20, 1, 3], [ITEM.IRON_SHOVEL, 5, 1, 1]]], // a toolsmith
  [6, [1, 5], [[V.IRON_INGOT, 2, 1, 3], [V.BREAD, 4, 1, 4], [ITEM.IRON_HELMET, 1, 1, 1], [V.EMERALD, 1, 1, 1]]], // an armorer
  [8, [1, 5], [[V.EMERALD, 1, 1, 1], [V.PORKCHOP, 6, 1, 3], [V.WHEAT, 6, 1, 3], [V.BEEF, 6, 1, 3], [V.MUTTON, 6, 1, 3], [ITEM.COAL, 3, 1, 3]]], // a butcher
  [5, [1, 5], [[V.PAPER, 15, 1, 5], [V.COMPASS, 5, 1, 1], [V.BREAD, 15, 1, 4], [ITEM.STICK, 5, 1, 2]]], // a cartographer
  [6, [1, 5], [[V.EMERALD, 1, 1, 1], [V.COD, 2, 1, 3], [V.SALMON, 1, 1, 3], [V.WATER_BUCKET, 1, 1, 1], [V.WHEAT_SEEDS, 3, 1, 3], [ITEM.COAL, 2, 1, 3]]], // a fisherman
  [5, [1, 5], [[BLOCK.WOOL, 6, 1, 8], [V.BLACK_WOOL, 3, 1, 3], [V.GRAY_WOOL, 2, 1, 3], [V.BROWN_WOOL, 2, 1, 3], [V.LIGHT_GRAY_WOOL, 2, 1, 3], [V.EMERALD, 1, 1, 1], [V.SHEARS, 1, 1, 1], [V.WHEAT, 6, 1, 6]]], // a shepherd
  [4, [1, 5], [[V.CLAY_BALL, 1, 1, 3], [BLOCK.STONE, 2, 1, 1], [V.STONE_BRICKS, 2, 1, 1], [V.BREAD, 4, 1, 4], [V.SMOOTH_STONE, 1, 1, 1], [V.EMERALD, 1, 1, 1]]], // a mason
  [3, [1, 5], [[V.LEATHER, 1, 1, 3], [ITEM.LEATHER_CHESTPLATE, 2, 1, 1], [ITEM.LEATHER_BOOTS, 2, 1, 1], [ITEM.LEATHER_HELMET, 2, 1, 1], [V.BREAD, 5, 1, 4], [ITEM.LEATHER_LEGGINGS, 2, 1, 1], [V.EMERALD, 1, 1, 4]]], // a tanner
  [3, [3, 8], [[V.REDSTONE, 2, 1, 4], [V.BREAD, 7, 1, 4], [V.ROTTEN_FLESH, 7, 1, 4], [V.LAPIS_LAZULI, 1, 1, 4], [ITEM.GOLD_INGOT, 1, 1, 4], [V.EMERALD, 1, 1, 4]]], // a temple
];

export function rollVillageLoot(rand = Math.random) {
  let r = rand() * VILLAGE_LOOT.reduce((n, t) => n + t[0], 0);
  let table = VILLAGE_LOOT[0];
  for (const t of VILLAGE_LOOT) {
    r -= t[0];
    if (r < 0) {
      table = t;
      break;
    }
  }
  const [, [lo, hi], all] = table;
  const entries = all.filter(([id]) => itemInfo(id));
  const total = entries.reduce((n, e) => n + e[1], 0);
  const out = [];
  if (!total) return out;
  const rolls = lo + Math.floor(rand() * (hi - lo + 1));
  for (let k = 0; k < rolls; k++) {
    let w = rand() * total;
    for (const [id, weight, min, max] of entries) {
      w -= weight;
      if (w >= 0) continue;
      out.push([id, min + Math.floor(rand() * (max - min + 1))]);
      break;
    }
  }
  return out;
}

// What a chest holds when first opened: [[itemId, count], ...]. `owned`: a
// Set of the item ids the player (online: the group) has already.
// (A Survival world's: the classic village loot, rollVillageLoot.)
export function rollChestLoot(tier, owned, rand = Math.random) {
  if (isVanilla()) return rollVillageLoot(rand);
  const out = [];
  const have = new Set(owned);
  const add = (id, n = 1) => {
    if (id == null || n <= 0) return;
    out.push([id, n]);
    have.add(id);
  };
  // Some food, always.
  const foods = [ITEM.APPLE, ITEM.COOKED_MEAT, ITEM.RAW_MEAT, ITEM.APPLE];
  const nFood = 1 + Math.floor(rand() * 2);
  for (let i = 0; i < nFood; i++) add(foods[Math.floor(rand() * foods.length)], 1 + Math.floor(rand() * 3));
  // A village's odds and ends.
  if (rand() < 0.6) add(BLOCK.TORCH, 2 + Math.floor(rand() * 5));
  if (rand() < 0.35) add(rand() < 0.5 ? ITEM.COAL : ITEM.STICK, 1 + Math.floor(rand() * 4));
  // Now and then a golden apple (a little more often later in the chain).
  if (rand() < 0.16 + tier * 0.04) add(ITEM.GOLDEN_APPLE, 1);
  // A tool not owned yet, within the tier.
  if (rand() < 0.3) add(pickTool(tier, have, rand), 1);
  // Sometimes a standard weapon not owned yet that the tier already allows
  // (never before the chain's first crates: tier 0 has none).
  if (tier >= 1 && rand() < 0.15) {
    const w = pickCrateWeapon(tier, have, rand);
    if (w != null && itemAllowed(w)) add(w, 1);
  }
  // Rarely a piece of armor, of the materials the tier has reached (a
  // guard's drop table one stage back: the tier's own).
  if (rand() < 0.25) for (const [id] of rollArmorDrop("guard", tier - 1, have, rand)) add(id, 1);
  return out;
}

export class Chests {
  // world: the World (seed, edits, getBlock, setBlocks).
  constructor({ world }) {
    this.world = world;
    this.store = new Map(); // "x,y,z" -> Array(27) of stacks (null for empty)
    this.authority = true; // false on a guest: the host owns the contents
    this.remote = null; // a guest's link to the host (js/net/chests.js): open(view), close(view), op(view, groups, done), fill, bell
    this.view = null; // the chest open on this screen: { x, y, z, key, keys, parts, slots, ready, gone, onUpdate }
    this.pending = null; // a guest's click waiting for the host: { t, done }
    this._placing = null; // (Round 12) a shulker box being placed from an item that holds things: { key, slots }
    this._fills = new Map(); // (Round 12) the authority: a guest's box's contents that came before its block: key -> { slots, t }
    // Hooks set by the game.
    this.getTier = () => 0; // the loot tier (the chain's)
    this.getOwned = () => new Set(); // item ids already owned (online: the group's)
    this.onDrop = null; // (stack, x, y, z): a broken chest's contents into the world
    this.onChanged = null; // (key, [[i, stack]], fromPid): host, a chest changed (to everyone who has it open)
    this.onGone = null; // (key): host, a chest is gone
    this.audio = null; // (Round 12: the bell's sound; else the redstone's audio)
    this._wrapWorld();
    LIB.ringBell = (x, y, z) => this.ringBell(x, y, z);
  }

  // (The Overworld's key; a key in any dimension: keyOf.)
  static key(x, y, z) {
    return `${x},${y},${z}`;
  }

  // (Round 12) The chest at (x, y, z) in `dim` (default: the world's own).
  keyOf(x, y, z, dim = this.world.dim ?? OVERWORLD) {
    return dimKey(dim, x, y, z);
  }

  _edits(dim) {
    return this.world.editsOf ? this.world.editsOf(dim ?? this.world.dim) : this.world.edits;
  }

  // Whether the chest at (x, y, z) was placed by a player (an edit), not generated.
  isPlaced(x, y, z, dim = this.world.dim) {
    const id = this._edits(dim).get(chunkKey(x >> 4, z >> 4))?.get(blockIndex(x & 15, y, z & 15));
    return id !== undefined && IS_STORAGE[id] === 1;
  }

  // (Round 12) The block at (x, y, z) in `dim` where this peer knows it (its
  // ground loaded), else -1.
  _known(x, y, z, dim = this.world.dim) {
    const w = this.world;
    if ((dim ?? OVERWORLD) !== (w.dim ?? OVERWORLD) || !w.getChunk?.(x >> 4, z >> 4)) return -1;
    return w.getBlock(x, y, z);
  }

  // The contents of the chest at (x, y, z) (the authority only): rolled on
  // first open for a generated chest, empty for a placed one (Round 12: and
  // for a barrel or a shulker box).
  contents(x, y, z, dim = this.world.dim) {
    const key = this.keyOf(x, y, z, dim);
    let slots = this.store.get(key);
    if (!slots) {
      const id = this._known(x, y, z, dim);
      const empty = this.isPlaced(x, y, z, dim) || id === V.BARREL || isShulkerBox(id);
      slots = empty ? new Array(CHEST_SLOTS).fill(null) : this._roll(x, y, z, dim);
      this.store.set(key, slots);
    }
    return slots;
  }

  _roll(x, y, z, dim = this.world.dim) {
    // (Round 12: another dimension's chest at the same place rolls its own.)
    const seed = (this.world.seed ^ Math.imul(x, 0x2f6b1d35) ^ Math.imul(y, 0x5bd1e995) ^ Math.imul(z, 0x1b873593) ^ 0xc4e57a ^ Math.imul(codeOf(dim), 0x68e31da4)) >>> 0;
    const rand = mulberry32(seed);
    let owned;
    try {
      owned = this.getOwned() || new Set();
    } catch {
      owned = new Set();
    }
    const slots = new Array(CHEST_SLOTS).fill(null);
    // (Round 11) A Survival world's dungeons, mineshafts and desert temples
    // have vanilla's own tables (structures.js).
    // (Round 12: the chest's own dimension's structures, there or not.)
    const w = !this.world.dim || dim === this.world.dim ? this.world : { terrain: this.world.terrainOf(dim), getBlock: (bx, by, bz) => this.world.blockIn(dim, bx, by, bz) };
    const loot = (isVanilla() && structureLootAt(w, x, y, z, rand)) || rollChestLoot(this.getTier() | 0, owned, rand);
    for (const [id, n, tag] of loot) {
      let left = n;
      while (left > 0) {
        const k = Math.min(left, maxStack(id));
        left -= k;
        // (scattered over the slots, as a chest found in the world looks)
        const free = [];
        for (let i = 0; i < CHEST_SLOTS; i++) if (!slots[i]) free.push(i);
        if (!free.length) return slots;
        slots[free[Math.floor(rand() * free.length)]] = makeStack(id, k, undefined, tag);
      }
    }
    return slots;
  }

  // ---------- (Round 12) Double chests ----------

  // The cells of the chest at (x, y, z): itself, or a double chest's two
  // halves, the left one first (its slots are the screen's top three rows).
  cellsOf(x, y, z) {
    const w = this.world;
    const id = w.getBlock(x, y, z);
    if (!isDoubleChest(id)) return [[x, y, z]];
    const [px, pz] = chestPartner(id, x, z);
    const other = w.getBlock(px, y, pz);
    const a = chestHalf(id);
    const b = isDoubleChest(other) ? chestHalf(other) : null;
    if (!b || b.k !== a.k || b.right === a.right) return [[x, y, z]];
    return a.right ? [[px, y, pz], [x, y, z]] : [[x, y, z], [px, y, pz]];
  }

  // What placing a chest item at (x, y, z) with its front toward [fx, fz]
  // puts there (js/interaction.js): [id, more cells or null]. Beside a single
  // chest facing the same way it joins it (not while sneaking, as vanilla),
  // the new one on its left first.
  placeChest(x, y, z, fx, fz, sneaking = false) {
    const k = Math.abs(fx) >= Math.abs(fz) ? (fx >= 0 ? 2 : 3) : fz >= 0 ? 0 : 1;
    const single = BLOCK.CHEST + k;
    if (sneaking) return [single, null];
    const [dx, dz] = FRONTS[k];
    for (const right of [false, true]) {
      // (a left half's other half is on its right, seen from the front: [dz, -dx])
      const s = right ? -1 : 1;
      const nx = x + dz * s;
      const nz = z - dx * s;
      if (this.world.getBlock(nx, y, nz) !== single) continue;
      return [doubleChestId(k, right), [nx, y, nz, doubleChestId(k, !right)]];
    }
    return [single, null];
  }

  // Halves that changed (broken, blown up): the other half, still there, is a single chest again.
  _unpair(halves) {
    const w = this.world;
    const out = [];
    for (const [x, y, z, was] of halves) {
      if (w.getBlock(x, y, z) === was) continue;
      const [px, pz] = chestPartner(was, x, z);
      const o = w.getBlock(px, y, pz);
      if (!isDoubleChest(o)) continue;
      const [bx, bz] = chestPartner(o, px, pz);
      if (bx === x && bz === z) out.push(px, y, pz, BLOCK.CHEST + chestHalf(o).k);
    }
    if (out.length) w.setBlocks(out);
  }

  // ---------- (Round 12) Shulker boxes ----------

  // A shulker box is being placed at `place` from `stack` (js/content/
  // workstations.js placeAs): what the item holds goes into it.
  fillPlaced(place, stack) {
    this._placing = null;
    const items = stack?.tag?.items;
    if (!place || !Array.isArray(items) || !items.length) return;
    const slots = slotsOfItems(items);
    this._placing = { key: this.keyOf(place[0], place[1], place[2]), slots };
    // (placed within this click, or not at all)
    queueMicrotask(() => (this._placing = null));
  }

  // The authority: a guest's box placed with things in it (js/net/chests.js
  // "chfill"), before or after its block edit arrives.
  remoteFill(x, y, z, slots, dim = this.world.dim) {
    if (!this.authority || !Array.isArray(slots)) return;
    const key = this.keyOf(x, y, z, dim);
    const now = Date.now();
    for (const [k, f] of this._fills) if (now - f.t > 10000) this._fills.delete(k);
    const id = this._known(x, y, z, dim);
    const have = this.store.get(key);
    const empty = !have || have.every((s) => !s);
    if (isShulkerBox(id)) {
      if (empty) this.store.set(key, slots);
      return;
    }
    // (Its block not here yet: kept for when it comes; in ground not loaded
    // here, where the edit is only recorded, the record holds them meanwhile.)
    this._fills.set(key, { slots, t: now });
    if (id < 0 && empty) this.store.set(key, slots);
  }

  // A chest that appeared: a fresh record (a box placed from a full item: its things).
  _fresh(x, y, z, opts) {
    const key = this.keyOf(x, y, z);
    this.store.delete(key);
    let slots = null;
    if (!opts?.remote && this._placing?.key === key) {
      slots = this._placing.slots;
      this._placing = null;
      if (!this.authority) {
        this.remote?.fill?.(x, y, z, slots);
        return;
      }
    } else if (this._fills.has(key)) {
      slots = this._fills.get(key).slots;
      this._fills.delete(key);
    }
    if (slots && this.authority && isShulkerBox(this.world.getBlock(x, y, z))) this.store.set(key, slots);
  }

  // Whether the chest `key` is a shulker box (where this peer knows it).
  _isShulkerKey(key) {
    const p = parseDimKey(key);
    return !!p && isShulkerBox(this._known(p[0], p[1], p[2], p[3]));
  }

  // ---------- (Round 12) The bell ----------

  // The bell at (x, y, z) rings: heard here, and online by everyone near (remote: the ring came from the net).
  ringBell(x, y, z, remote = false) {
    const rs = LIB.redstoneSim;
    const l = rs?.effects?.listener;
    const dist = l ? Math.hypot(x + 0.5 - l.x, y + 0.5 - l.y, z + 0.5 - l.z) : 0;
    if (dist <= BELL_HEAR) bellSound(this.audio || rs?.sounds?.audio, dist);
    if (!remote) this.remote?.bell?.(x, y, z);
    return true;
  }

  // ---------- The chest open on this screen ----------

  // Opens the chest at (x, y, z) for this player's screen (Round 12: a
  // double chest's two halves, 54 slots); onUpdate() is called whenever its
  // contents change (or it is gone: view.gone).
  openView(x, y, z, onUpdate) {
    const cells = this.cellsOf(x, y, z);
    const keys = cells.map(([cx, cy, cz]) => this.keyOf(cx, cy, cz));
    if (this.view && this.view.keys.join("|") === keys.join("|")) {
      this.view.onUpdate = onUpdate;
      return this.view;
    }
    this.closeView();
    const parts = cells.map(([cx, cy, cz], i) => ({ x: cx, y: cy, z: cz, key: keys[i], slots: null, ready: false }));
    const view = { x, y, z, key: keys[0], keys, parts, slots: null, ready: false, gone: false, onUpdate };
    this.view = view;
    if (this.authority) {
      for (const p of parts) {
        p.slots = this.contents(p.x, p.y, p.z);
        p.ready = true;
      }
      this._sync(view);
    } else this.remote?.open(view);
    return view;
  }

  // The view's slots: its parts' in a row, once every part is in.
  _sync(v) {
    v.ready = v.parts.every((p) => p.ready);
    v.slots = v.ready ? v.parts.flatMap((p) => p.slots) : null;
  }

  _part(key) {
    return this.view?.parts.find((p) => p.key === key) || null;
  }

  closeView() {
    const v = this.view;
    if (!v) return;
    this.view = null;
    // (A click still with the host stays pending: its answer settles it,
    // screen or not, and no other click goes until then.)
    if (!this.authority) this.remote?.close(v);
  }

  // A click on the open chest: changes [[slot, before, after], ...] (stacks
  // or null; a double chest's slots 0-53). done(ok) once it is applied (at
  // once offline and on the host; when the host answers on a guest) or
  // refused (the chest changed meanwhile).
  submit(changes, done) {
    const v = this.view;
    if (!v || !v.ready || v.gone || this.pending) return done(false);
    const groups = [];
    for (const ch of changes) {
      const part = Math.floor(ch[0] / CHEST_SLOTS);
      if (!v.parts[part]) return done(false);
      let g = groups.find((e) => e[0] === part);
      if (!g) groups.push((g = [part, []]));
      g[1].push([ch[0] % CHEST_SLOTS, ch[1], ch[2]]);
    }
    if (!groups.length) return done(false);
    if (this.authority) return done(this.applyMulti(groups.map(([i, c]) => [v.parts[i].key, c]), 0));
    const p = (this.pending = { t: Date.now(), done });
    this.remote.op(v, groups, (ok) => {
      if (this.pending !== p) return;
      this.pending = null;
      done(ok);
    });
  }

  // A guest's click still unanswered after a while is given up (frame tick),
  // only once the session is gone: while it lasts the host answers every one.
  update() {
    if (this.pending && !this.remote?.mp?.active && Date.now() - this.pending.t > 4000) {
      const p = this.pending;
      this.pending = null;
      p.done(false);
    }
  }

  // The authority: applies changes to the stored chest `key` if every slot
  // still holds what the changes expect. fromPid: who asked (0: this player).
  apply(key, changes, fromPid = 0) {
    return this.applyMulti([[key, changes]], fromPid);
  }

  // (Round 12) The same for several chests at once (a double chest's
  // halves): all of it, or nothing. list: [[key, changes], ...].
  applyMulti(list, fromPid = 0) {
    const todo = [];
    for (const [key, changes] of list) {
      const slots = this.store.get(key);
      if (!slots || !Array.isArray(changes) || changes.length < 1 || changes.length > CHEST_SLOTS) return false;
      const shulker = this._isShulkerKey(key);
      const seen = new Set();
      const next = [];
      for (const ch of changes) {
        if (!Array.isArray(ch)) return false;
        const [i, before, after] = ch;
        if (!Number.isInteger(i) || i < 0 || i >= CHEST_SLOTS || seen.has(i)) return false;
        seen.add(i);
        if (!sameStack(slots[i], before || null)) return false;
        const a = after ? decodeStack(encodeStack(after)) : null;
        if (after && !a) return false;
        // (A shulker box holds anything but another shulker box.)
        if (a && shulker && isShulkerBox(a.id) && !sameStack(slots[i], a)) return false;
        next.push([i, a]);
      }
      todo.push([key, slots, next]);
    }
    for (const [key, slots, next] of todo) {
      for (const [i, a] of next) slots[i] = a;
      this.onChanged?.(key, next, fromPid);
    }
    const v = this.view;
    if (v && todo.some(([key]) => v.keys.includes(key))) {
      if (this.authority) this._sync(v);
      // (Someone else changed the chest this screen shows.)
      if (fromPid) v.onUpdate?.();
    }
    return true;
  }

  // A guest: the host's word on a part of the open chest (its whole
  // contents, or null: gone).
  remoteState(key, slots) {
    const v = this.view;
    const part = this._part(key);
    if (!v || !part) return;
    if (!slots) v.gone = true;
    else {
      part.slots = slots;
      part.ready = true;
      this._sync(v);
    }
    v.onUpdate?.();
  }

  // A guest: slots of the open chest changed at the host.
  remoteSet(key, list) {
    const v = this.view;
    const part = this._part(key);
    if (!v || !part || !part.ready) return;
    for (const [i, s] of list) if (Number.isInteger(i) && i >= 0 && i < CHEST_SLOTS) part.slots[i] = s;
    this._sync(v);
    v.onUpdate?.();
  }

  // ---------- Chests appearing and going ----------

  // Every edit batch is looked at before it applies (what was there): a
  // chest that goes drops its contents (the authority), and a chest put
  // where an old one's record lingered starts afresh. (Round 12) A generated
  // chest joined into a double one has its loot rolled before the edit makes
  // it a placed one; a double chest's half that changes leaves its other half
  // single (the peer that made the edit: it travels as one).
  _wrapWorld() {
    const world = this.world;
    if (!world || typeof world.setBlocks !== "function") return;
    const setBlocks = world.setBlocks.bind(world);
    world.setBlocks = (list, opts) => {
      let gone = null;
      let fresh = null;
      let halves = null;
      for (let i = 0; i < list.length; i += 4) {
        const was = world.getBlock(list[i], list[i + 1], list[i + 2]);
        const now = list[i + 3];
        const wasChest = IS_STORAGE[was];
        const isChest = IS_STORAGE[now];
        if (was === now || (!wasChest && !isChest)) continue;
        const x = Math.floor(list[i]);
        const y = Math.floor(list[i + 1]);
        const z = Math.floor(list[i + 2]);
        if (isDoubleChest(was) && !opts?.remote) (halves ||= []).push([x, y, z, was]);
        if (wasChest && isChest) {
          if (this.authority && !this.store.has(this.keyOf(x, y, z)) && !this.isPlaced(x, y, z)) this.contents(x, y, z);
          continue;
        }
        if (wasChest) (gone ||= []).push([x, y, z, this.isPlaced(x, y, z), was]);
        else (fresh ||= []).push([x, y, z]);
      }
      const n = setBlocks(list, opts);
      if (fresh) for (const [x, y, z] of fresh) if (IS_STORAGE[world.getBlock(x, y, z)]) this._fresh(x, y, z, opts);
      if (gone) for (const [x, y, z, placed, was] of gone) if (!IS_STORAGE[world.getBlock(x, y, z)]) this._gone(x, y, z, placed, list.length, opts?.remote, was);
      if (halves) this._unpair(halves);
      return n;
    };
    // (A chest blown up far out, in ground not loaded here: its record goes.
    // Round 12: or in another dimension.)
    const queueEdit = world.queueEdit?.bind(world);
    if (queueEdit) {
      world.queueEdit = (x, y, z, id, dim = world.dim) => {
        const here = dim === world.dim && world.getChunk?.(Math.floor(x) >> 4, Math.floor(z) >> 4);
        if (!IS_STORAGE[id] && !here) this.store.delete(this.keyOf(Math.floor(x), Math.floor(y), Math.floor(z), dim));
        return queueEdit(x, y, z, id, dim);
      };
    }
  }

  _gone(x, y, z, placed, batch, remote, was = BLOCK.CHEST) {
    const key = this.keyOf(x, y, z);
    const v = this.view;
    if (v && v.keys.includes(key)) {
      v.gone = true;
      v.onUpdate?.();
    }
    let slots = this.store.get(key);
    this.store.delete(key);
    if (!this.authority) {
      // (This guest broke a generated one: the host may not have that ground loaded.)
      if (!remote && !placed && batch <= BIG_BATCH && !isShulkerBox(was) && was !== V.BARREL) this.remote?.goneLocal?.(x, y, z);
      return;
    }
    this.onGone?.(key);
    // (Round 12) A shulker box: itself, with what it held.
    if (isShulkerBox(was)) {
      this.onDrop?.(shulkerStack(slots), x, y, z);
      return;
    }
    if (!slots) {
      if (placed || batch > BIG_BATCH || was === V.BARREL) return;
      slots = this._roll(x, y, z);
    }
    for (const s of slots) if (s) this.onDrop?.(s, x, y, z);
  }

  // The authority: a chest in ground not loaded here was replaced by a
  // remote edit (it never passes setBlocks): its stored contents spill
  // (Round 12: in its own dimension, the world there or not; a shulker box
  // as itself, with them in it).
  goneUnloaded(x, y, z, dim = this.world.dim) {
    if (!this.authority) return false;
    const key = this.keyOf(x, y, z, dim);
    const slots = this.store.get(key);
    if (!slots) return false;
    const was = this._edits(dim).get(chunkKey(x >> 4, z >> 4))?.get(blockIndex(x & 15, y, z & 15));
    this.store.delete(key);
    this.onGone?.(key);
    this._spill(isShulkerBox(was) ? [shulkerStack(slots)] : slots, x, y, z, dim);
    return true;
  }

  // The authority: a generated chest nobody opened, broken by a guest in
  // ground not loaded here: its loot rolls and spills as if seen.
  goneGenerated(x, y, z, dim = this.world.dim) {
    if (!this.authority || this.store.has(this.keyOf(x, y, z, dim))) return;
    this._spill(this._roll(x, y, z, dim), x, y, z, dim);
  }

  _spill(slots, x, y, z, dim) {
    const drop = () => {
      for (const s of slots) if (s) this.onDrop?.(s, x, y, z);
    };
    if (this.world.inDim && dim !== this.world.dim) this.world.inDim(dim, drop);
    else drop();
  }

  // ---------- Save ----------

  // The opened chests, for the world save: { "x,y,z": [[slot, id, count(, dur)], ...] }
  // (undefined on a guest, and when there are none).
  serialize() {
    if (!this.authority || !this.store.size) return undefined;
    const out = {};
    for (const [key, slots] of this.store) {
      const list = [];
      slots.forEach((s, i) => {
        if (s) list.push([i, ...encodeStack(s)]);
      });
      out[key] = list;
    }
    return out;
  }

  load(data) {
    this.store.clear();
    if (!data || typeof data !== "object") return;
    for (const [key, list] of Object.entries(data)) {
      if (!DIM_KEY_RE.test(key) || !Array.isArray(list)) continue;
      const slots = new Array(CHEST_SLOTS).fill(null);
      for (const e of list) {
        if (!Array.isArray(e) || !Number.isInteger(e[0]) || e[0] < 0 || e[0] >= CHEST_SLOTS) continue;
        slots[e[0]] = decodeStack(e.slice(1));
      }
      this.store.set(key, slots);
    }
  }
}

// (Round 12) A shulker box's item, holding `slots` (tag.items; none: a plain box).
export function shulkerStack(slots) {
  const items = [];
  (slots || []).forEach((s, i) => {
    if (s) items.push([i, ...encodeStack(s)]);
  });
  return makeStack(V.SHULKER_BOX, 1, undefined, items.length ? { items } : undefined);
}

// The 27 slots a shulker box item's tag.items holds (no box in a box).
export function slotsOfItems(items) {
  const slots = new Array(CHEST_SLOTS).fill(null);
  if (!Array.isArray(items)) return slots;
  for (const e of items) {
    if (!Array.isArray(e) || !Number.isInteger(e[0]) || e[0] < 0 || e[0] >= CHEST_SLOTS || slots[e[0]]) continue;
    const s = decodeStack(e.slice(1));
    if (s && !isShulkerBox(s.id)) slots[e[0]] = s;
  }
  return slots;
}

// (Round 12) The bell: a low struck tone with its inharmonic partials,
// ringing on (the game's audio, its blocks bus).
function bellSound(audio, dist) {
  const ctx = audio?.ctx;
  const gain = 0.6 / (1 + dist / 14);
  if (!ctx || gain < 0.01) return;
  const out = ctx.createGain();
  out.gain.value = gain;
  out.connect(audio.buses?.blocks || audio.master || ctx.destination);
  const t = ctx.currentTime;
  for (const [f, v, d] of [
    [392, 0.32, 2.6],
    [392 * 2, 0.14, 1.8],
    [392 * 2.4, 0.08, 1.2],
    [392 * 3.9, 0.05, 0.7],
    [196, 0.1, 2.2],
  ]) {
    const osc = ctx.createOscillator();
    osc.type = "sine";
    osc.frequency.setValueAtTime(f, t);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(v, t + 0.005);
    g.gain.exponentialRampToValueAtTime(0.0001, t + d);
    osc.connect(g).connect(out);
    osc.start(t);
    osc.stop(t + d + 0.05);
  }
}
