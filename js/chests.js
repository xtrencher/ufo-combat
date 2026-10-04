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
// Pure logic (no three.js, no DOM): the game sets the hooks.
import { IS_CHEST, BLOCK } from "./blocks.js";
import { ITEM, itemInfo, maxStack, itemAllowed } from "./items.js";
import { makeStack } from "./inventory.js";
import { pickCrateWeapon, pickTool, rollArmorDrop } from "./progression.js";
import { mulberry32 } from "./noise.js";
import { chunkKey, blockIndex } from "./constants.js";

export const CHEST_SLOTS = 27;
// (A batch this big is a big blast: the chests in it that were never opened
// burn with their loot instead of each spilling a fresh roll.)
const BIG_BATCH = 2048;

// A stack for the save and the wire: [id, count] or [id, count, dur]; 0 for none.
export function encodeStack(s) {
  return s ? (s.dur !== undefined ? [s.id, s.count, s.dur] : [s.id, s.count]) : 0;
}

// The stack back (checked: a real item, a sane count and wear), or null.
export function decodeStack(e) {
  if (!Array.isArray(e)) return null;
  const [id, count, dur] = e;
  if (!Number.isInteger(id) || !itemInfo(id) || !Number.isInteger(count) || count < 1 || count > maxStack(id)) return null;
  return makeStack(id, count, Number.isInteger(dur) && dur > 0 ? dur : undefined);
}

export function sameStack(a, b) {
  if (!a || !b) return !a && !b;
  return a.id === b.id && a.count === b.count && (a.dur ?? -1) === (b.dur ?? -1);
}

// What a chest holds when first opened: [[itemId, count], ...]. `owned`: a
// Set of the item ids the player (online: the group) has already.
export function rollChestLoot(tier, owned, rand = Math.random) {
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
    this.remote = null; // a guest's link to the host (js/net/chests.js): open(view), close(view), op(view, changes, done)
    this.view = null; // the chest open on this screen: { x, y, z, key, slots, ready, gone, onUpdate }
    this.pending = null; // a guest's click waiting for the host: { t, done }
    // Hooks set by the game.
    this.getTier = () => 0; // the loot tier (the chain's)
    this.getOwned = () => new Set(); // item ids already owned (online: the group's)
    this.onDrop = null; // (stack, x, y, z): a broken chest's contents into the world
    this.onChanged = null; // (key, [[i, stack]], fromPid): host, a chest changed (to everyone who has it open)
    this.onGone = null; // (key): host, a chest is gone
    this._wrapWorld();
  }

  static key(x, y, z) {
    return `${x},${y},${z}`;
  }

  // Whether the chest at (x, y, z) was placed by a player (an edit), not generated.
  isPlaced(x, y, z) {
    const id = this.world.edits.get(chunkKey(x >> 4, z >> 4))?.get(blockIndex(x & 15, y, z & 15));
    return id !== undefined && IS_CHEST[id] === 1;
  }

  // The contents of the chest at (x, y, z) (the authority only): rolled on
  // first open for a generated chest, empty for a placed one.
  contents(x, y, z) {
    const key = Chests.key(x, y, z);
    let slots = this.store.get(key);
    if (!slots) {
      slots = this.isPlaced(x, y, z) ? new Array(CHEST_SLOTS).fill(null) : this._roll(x, y, z);
      this.store.set(key, slots);
    }
    return slots;
  }

  _roll(x, y, z) {
    const seed = (this.world.seed ^ Math.imul(x, 0x2f6b1d35) ^ Math.imul(y, 0x5bd1e995) ^ Math.imul(z, 0x1b873593) ^ 0xc4e57a) >>> 0;
    const rand = mulberry32(seed);
    let owned;
    try {
      owned = this.getOwned() || new Set();
    } catch {
      owned = new Set();
    }
    const slots = new Array(CHEST_SLOTS).fill(null);
    for (const [id, n] of rollChestLoot(this.getTier() | 0, owned, rand)) {
      let left = n;
      while (left > 0) {
        const k = Math.min(left, maxStack(id));
        left -= k;
        // (scattered over the slots, as a chest found in the world looks)
        const free = [];
        for (let i = 0; i < CHEST_SLOTS; i++) if (!slots[i]) free.push(i);
        if (!free.length) return slots;
        slots[free[Math.floor(rand() * free.length)]] = makeStack(id, k);
      }
    }
    return slots;
  }

  // ---------- The chest open on this screen ----------

  // Opens the chest at (x, y, z) for this player's screen; onUpdate() is
  // called whenever its contents change (or it is gone: view.gone).
  openView(x, y, z, onUpdate) {
    const key = Chests.key(x, y, z);
    if (this.view && this.view.key === key) {
      this.view.onUpdate = onUpdate;
      return this.view;
    }
    this.closeView();
    const view = { x, y, z, key, slots: null, ready: false, gone: false, onUpdate };
    this.view = view;
    if (this.authority) {
      view.slots = this.contents(x, y, z);
      view.ready = true;
    } else this.remote?.open(view);
    return view;
  }

  closeView() {
    const v = this.view;
    if (!v) return;
    this.view = null;
    if (!this.authority) this.remote?.close(v);
    if (this.pending) {
      const p = this.pending;
      this.pending = null;
      p.done(false);
    }
  }

  // A click on the open chest: changes [[slot, before, after], ...] (stacks
  // or null). done(ok) once it is applied (at once offline and on the host;
  // when the host answers on a guest) or refused (the chest changed meanwhile).
  submit(changes, done) {
    const v = this.view;
    if (!v || !v.ready || v.gone || this.pending) return done(false);
    if (this.authority) return done(this.apply(v.key, changes, 0));
    const p = (this.pending = { t: Date.now(), done });
    this.remote.op(v, changes, (ok) => {
      if (this.pending !== p) return;
      this.pending = null;
      done(ok);
    });
  }

  // A guest's click still unanswered after a while is given up (frame tick).
  update() {
    if (this.pending && Date.now() - this.pending.t > 4000) {
      const p = this.pending;
      this.pending = null;
      p.done(false);
    }
  }

  // The authority: applies changes to the stored chest `key` if every slot
  // still holds what the changes expect. fromPid: who asked (0: this player).
  apply(key, changes, fromPid = 0) {
    const slots = this.store.get(key);
    if (!slots || !Array.isArray(changes) || changes.length < 1 || changes.length > CHEST_SLOTS) return false;
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
      next.push([i, a]);
    }
    for (const [i, a] of next) slots[i] = a;
    this.onChanged?.(key, next, fromPid);
    // (Someone else changed the chest this screen shows.)
    if (fromPid && this.view?.key === key) this.view.onUpdate?.();
    return true;
  }

  // A guest: the host's word on the open chest (its whole contents, or null: gone).
  remoteState(key, slots) {
    const v = this.view;
    if (!v || v.key !== key) return;
    if (!slots) v.gone = true;
    else {
      v.slots = slots;
      v.ready = true;
    }
    v.onUpdate?.();
  }

  // A guest: slots of the open chest changed at the host.
  remoteSet(key, list) {
    const v = this.view;
    if (!v || v.key !== key || !v.ready) return;
    for (const [i, s] of list) if (Number.isInteger(i) && i >= 0 && i < CHEST_SLOTS) v.slots[i] = s;
    v.onUpdate?.();
  }

  // ---------- Chests appearing and going ----------

  // Every edit batch is looked at before it applies (what was there): a
  // chest that goes drops its contents (the authority), and a chest put
  // where an old one's record lingered starts afresh.
  _wrapWorld() {
    const world = this.world;
    if (!world || typeof world.setBlocks !== "function") return;
    const setBlocks = world.setBlocks.bind(world);
    world.setBlocks = (list, opts) => {
      let gone = null;
      let fresh = null;
      for (let i = 0; i < list.length; i += 4) {
        const wasChest = IS_CHEST[world.getBlock(list[i], list[i + 1], list[i + 2])];
        const isChest = IS_CHEST[list[i + 3]];
        if (wasChest === isChest) continue;
        const x = Math.floor(list[i]);
        const y = Math.floor(list[i + 1]);
        const z = Math.floor(list[i + 2]);
        if (wasChest) (gone ||= []).push([x, y, z, this.isPlaced(x, y, z)]);
        else (fresh ||= []).push([x, y, z]);
      }
      const n = setBlocks(list, opts);
      if (fresh) for (const [x, y, z] of fresh) if (IS_CHEST[world.getBlock(x, y, z)]) this.store.delete(Chests.key(x, y, z));
      if (gone) for (const [x, y, z, placed] of gone) if (!IS_CHEST[world.getBlock(x, y, z)]) this._gone(x, y, z, placed, list.length);
      return n;
    };
    // (A chest blown up far out, in ground not loaded here: its record goes.)
    const queueEdit = world.queueEdit?.bind(world);
    if (queueEdit) {
      world.queueEdit = (x, y, z, id) => {
        if (!IS_CHEST[id] && !world.getChunk?.(Math.floor(x) >> 4, Math.floor(z) >> 4)) this.store.delete(Chests.key(Math.floor(x), Math.floor(y), Math.floor(z)));
        return queueEdit(x, y, z, id);
      };
    }
  }

  _gone(x, y, z, placed, batch) {
    const key = Chests.key(x, y, z);
    const v = this.view;
    if (v && v.key === key) {
      v.gone = true;
      v.onUpdate?.();
    }
    let slots = this.store.get(key);
    this.store.delete(key);
    if (!this.authority) return;
    this.onGone?.(key);
    if (!slots) {
      if (placed || batch > BIG_BATCH) return;
      slots = this._roll(x, y, z);
    }
    for (const s of slots) if (s) this.onDrop?.(s, x, y, z);
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
      if (!/^-?\d+,-?\d+,-?\d+$/.test(key) || !Array.isArray(list)) continue;
      const slots = new Array(CHEST_SLOTS).fill(null);
      for (const e of list) {
        if (!Array.isArray(e) || !Number.isInteger(e[0]) || e[0] < 0 || e[0] >= CHEST_SLOTS) continue;
        slots[e[0]] = decodeStack(e.slice(1));
      }
      this.store.set(key, slots);
    }
  }
}
