// Furnaces (Round 11): smelting, by vanilla's rules. A furnace has three
// slots (0 the input, 1 the fuel, 2 the output) and a fire. When something
// smeltable is in and the output has room, a fuel item is burnt for its burn
// time (coal 80 s, a log or planks 15 s, a stick 5 s, a lava bucket 1000 s,
// which leaves its bucket: js/crafting.js); while it burns an item cooks in
// 10 s, and the output stacks. Without fire the cooking cools back down. The
// experience of what was smelted is kept until someone takes from the output
// (onTakeXp) or the furnace goes (onDropXp). A burning furnace is its lit
// block (light 13). Furnaces tick at vanilla's 20 ticks a second while their
// ground is loaded (online: on the host, or near a guest), screen or no
// screen; one that goes (broken, blown up, by anyone) drops what it holds.
// Only furnaces that hold something are saved with the world (serialize /
// load), like the chests.
//
// Online the host owns every furnace (js/net/furnace.js): a guest's screen
// shows the host's furnace (and moves its bars along between the host's
// words), and its clicks are asked of the host, checked against what each
// slot held, applied in the host's order and passed on to everyone with that
// furnace open. Pure logic (no three.js, no DOM; Round 12: but the
// campfires' drawing): the game sets the hooks.
//
// (Round 12) Every dimension's furnaces are in the one store (a Nether
// furnace's key "n:x,y,z": js/dim-registry.js dimKey), each with its `dim`:
// the host smelts in the ground it has loaded in its own dimension and near
// every guest in theirs; a furnace of another dimension lights and goes out
// as an edit there (world.queueEdit's dim), and spills there when it goes.
//
// (Round 12) The smoker and the blast furnace are furnaces here too (kind 1
// and 2: js/content/workstations.js): food only / ores, raw metals and iron
// or gold gear only, cooked in half the time, their fuel burning twice as
// fast (vanilla's). And the campfires (Campfires, below: the one part of
// this file that draws, the food lying on them, and their smoke).
import * as THREE from "three";
import { FURNACE, BUCKET, SMOKER, BLAST_FURNACE, IRON_NUGGET, GOLD_NUGGET, RAW_IRON, RAW_GOLD, RAW_COPPER, COPPER_ORE, EMERALD_ORE, LAPIS_ORE, REDSTONE_ORE, NETHER_QUARTZ_ORE, NETHER_GOLD_ORE, ANCIENT_DEBRIS, HAY_BLOCK } from "./content/ids.js";
import { BLOCK } from "./blocks.js";
import { maxStack, itemInfo } from "./items.js";
import { itemModel } from "./models.js";
import { createEntityMaterial, bindEntityLight } from "./shaders.js";
import { isCampfire, campfireLit, campfireAxis } from "./content/workstations.js";
import { makeStack } from "./inventory.js";
import { encodeStack, decodeStack, sameStack } from "./chests.js";
import { smeltingOf, burnTicks, craftRemainder, TICKS_PER_SECOND } from "./crafting.js";
import { chunkKey, blockIndex } from "./constants.js";
import { LIB } from "./content/base.js";
import { dimKey, DIM_KEY_RE, parseDimKey, OVERWORLD, codeOf } from "./dim-registry.js";

export const FURNACE_SLOTS = 3; // input, fuel, output
const TICK = 1 / TICKS_PER_SECOND;
const MAX_TICKS = 20 * 60; // (at most a minute caught up in one step)
const COOK_TICKS = 200;
const CHECK_EVERY = 0.5; // seconds between looks at whether each furnace is still there
const NEAR_GUEST = 128; // blocks: a furnace in ground the host hasn't loaded still burns this near a guest

// (Round 12) The kinds: 0 the furnace, 1 the smoker, 2 the blast furnace (8 ids each: facing x lit).
const OVENS = [FURNACE, SMOKER, BLAST_FURNACE];
export const FURNACE_NAMES = ["Furnace", "Smoker", "Blast Furnace"];
export function furnaceKind(id) {
  for (let k = 0; k < 3; k++) if (id >= OVENS[k] && id < OVENS[k] + 8) return k;
  return -1;
}
export function isFurnace(id) {
  return furnaceKind(id) >= 0;
}
export const furnaceLit = (id) => isFurnace(id) && id - OVENS[furnaceKind(id)] >= 4;
// The furnace's id with the same facing (and kind), lit or not.
export function furnaceAs(id, lit) {
  const base = OVENS[Math.max(0, furnaceKind(id))];
  return base + ((id - base) & 3) + (lit ? 4 : 0);
}

// What a furnace of `kind` makes of item `id`: its smelting (with the kind's
// cooking time), or null. The smoker: food into food (vanilla's smoking
// recipes); the blast furnace: ores, raw metals, iron and gold gear (its
// blasting recipes).
let BLASTS = null;
export function smeltsIn(kind, id) {
  const rec = smeltingOf(id);
  if (!rec || !kind) return rec;
  if (kind === 1 && !(itemInfo(id)?.food && itemInfo(rec.result.id)?.food)) return null;
  if (kind === 2) {
    BLASTS ||= new Set([BLOCK.IRON_ORE, BLOCK.GOLD_ORE, BLOCK.COAL_ORE, BLOCK.DIAMOND_ORE, RAW_IRON, RAW_GOLD, RAW_COPPER, COPPER_ORE, EMERALD_ORE, LAPIS_ORE, REDSTONE_ORE, NETHER_QUARTZ_ORE, NETHER_GOLD_ORE, ANCIENT_DEBRIS]);
    if (!BLASTS.has(id) && rec.result.id !== IRON_NUGGET && rec.result.id !== GOLD_NUGGET) return null;
  }
  return rec;
}
// Cook and burn times by kind (the smoker's and the blast furnace's: half).
const cookTicks = (kind, rec) => (kind ? Math.max(1, rec.ticks >> 1) : rec.ticks);
const fuelTicks = (kind, id) => (kind ? burnTicks(id) >> 1 : burnTicks(id));

// Whether a stack of `id` may go in slot `i` (the output takes nothing; the
// fuel slot takes fuel, and an empty bucket as in vanilla).
export function furnaceAccepts(i, id) {
  if (i === 0) return true;
  if (i === 1) return burnTicks(id) > 0 || id === BUCKET;
  return false;
}

// The bars as sent and shown: [burn ticks left, of the fuel's whole, cook ticks, of the whole, cooking?].
const barsOf = (f) => [f.lit, f.litDur, f.prog, f.total, f.cooking ? 1 : 0];

export class Furnaces {
  // world: the World (getBlock, getChunk, setBlock, queueEdit, edits, changeListeners).
  constructor({ world, scene = null, effects = null }) {
    this.world = world;
    this.campfires = new Campfires({ world, scene, effects }); // (Round 12)
    this.store = new Map(); // "x,y,z" -> { x, y, z, key, slots, lit, litDur, prog, total, xp, cooking }
    this.authority = true; // false on a guest: the host owns them
    this.remote = null; // a guest's link to the host (js/net/furnace.js): open(view), close(view), op(view, changes, done)
    this.view = null; // the furnace on this screen: { x, y, z, key, slots, f, ready, gone, onUpdate }
    this.pending = null; // a guest's click waiting for the host
    this._acc = 0;
    this._check = 0;
    // Hooks set by the game (and the net module).
    this.onDrop = null; // (stack, x, y, z): a furnace that went, its contents into the world
    // (The experience: the survival part's orbs (LIB.giveXp, Survival worlds), at
    // the player who took from the output, as in vanilla; at a furnace that went.)
    this.onTakeXp = (amount) => LIB.giveXp?.(amount); // (amount, x, y, z): this player took from an output
    this.onDropXp = (amount, x, y, z) => LIB.giveXp?.(amount, x + 0.5, y + 0.5, z + 0.5); // the authority: a furnace went with experience in it
    this.onChanged = null; // (key, [[i, stack]], fromPid): the authority, slots changed (the bars may have too)
    this.onBars = null; // (key): the authority, the fire lit or went out, or cooking started or stopped
    this.onGone = null; // (key): the authority, a furnace went
    this.watched = null; // (key) => true while someone online has it open
    this.nearGuest = null; // (x, z, dim) => true when a guest is near (the host)
    world.changeListeners?.push((changed) => this._blocksChanged(changed));
  }

  // (Round 12: the campfires follow: they are the same peer's.)
  get authority() {
    return this._authority;
  }

  set authority(v) {
    this._authority = v;
    if (this.campfires) this.campfires.authority = v;
  }

  // (The Overworld's key; a key in any dimension: keyOf.)
  static key(x, y, z) {
    return `${x},${y},${z}`;
  }

  // (Round 12) The furnace at (x, y, z) in `dim` (default: the world's own).
  keyOf(x, y, z, dim = this.world.dim ?? OVERWORLD) {
    return dimKey(dim, x, y, z);
  }

  // The record of the furnace at (x, y, z), made empty on first use (the authority).
  contents(x, y, z, dim = this.world.dim ?? OVERWORLD) {
    const key = this.keyOf(x, y, z, dim);
    let f = this.store.get(key);
    if (!f) {
      this.store.set(key, (f = { x, y, z, dim, key, slots: new Array(FURNACE_SLOTS).fill(null), lit: 0, litDur: 0, prog: 0, total: COOK_TICKS, xp: 0, cooking: false, kind: 0 }));
      f.kind = Math.max(0, furnaceKind(this._blockAt(f)));
    }
    return f;
  }

  // (Round 12) Whether the furnace's ground is loaded here (its dimension's).
  _here(f) {
    const w = this.world;
    return (f.dim === (w.dim ?? OVERWORLD)) && !!w.getChunk(f.x >> 4, f.z >> 4);
  }

  // ---------- Smelting ----------

  // Whether the input's result fits the output.
  _fits(f, rec) {
    const out = f.slots[2];
    const r = rec.result;
    if (!out) return true;
    return out.id === r.id && out.count + r.count <= maxStack(r.id);
  }

  // One tick (vanilla's AbstractFurnaceBlockEntity). True if a slot changed.
  _tick(f) {
    let changed = false;
    if (f.lit > 0) f.lit--;
    const input = f.slots[0];
    const fuel = f.slots[1];
    const kind = f.kind | 0;
    const rec = input ? smeltsIn(kind, input.id) : null;
    f.total = rec ? cookTicks(kind, rec) : COOK_TICKS;
    let cooking = false;
    if (f.lit > 0 || (fuel && input)) {
      const can = !!rec && this._fits(f, rec);
      if (f.lit <= 0 && can) {
        const t = fuelTicks(kind, fuel.id);
        if (t > 0) {
          f.lit = f.litDur = t;
          const rem = craftRemainder(fuel.id);
          fuel.count -= 1;
          if (fuel.count <= 0) f.slots[1] = rem ? makeStack(rem, 1) : null;
          changed = true;
        }
      }
      if (f.lit > 0 && can) {
        cooking = true;
        if (++f.prog >= f.total) {
          f.prog = 0;
          const r = rec.result;
          const out = f.slots[2];
          if (out) out.count += r.count;
          else f.slots[2] = makeStack(r.id, r.count);
          input.count -= 1;
          if (input.count <= 0) f.slots[0] = null;
          f.xp += rec.xp;
          changed = true;
        }
      } else f.prog = 0;
    } else if (f.prog > 0) f.prog = Math.max(0, f.prog - 2);
    f.cooking = cooking;
    return changed;
  }

  // Whether ticking could change anything (no fire, no cooking, and nothing to light it with).
  static idle(f) {
    return f.lit <= 0 && f.prog <= 0 && !(f.slots[0] && f.slots[1]);
  }

  static empty(f) {
    return !f.slots[0] && !f.slots[1] && !f.slots[2] && f.lit <= 0 && f.xp <= 0;
  }

  // The block at the furnace's place: its id, or -1 when its ground isn't
  // loaded here and no recorded edit says what is there.
  _blockAt(f) {
    const world = this.world;
    if (this._here(f)) return world.getBlock(f.x, f.y, f.z);
    const edits = world.editsOf ? world.editsOf(f.dim) : world.edits;
    const id = edits?.get(chunkKey(f.x >> 4, f.z >> 4))?.get(blockIndex(f.x & 15, f.y, f.z & 15));
    return id === undefined ? -1 : id;
  }

  // The frame step: the authority's furnaces burn (whole ticks of game time);
  // a guest's open screen moves its bars along.
  update(dt) {
    this.campfires.update(dt);
    this._acc += dt;
    let n = Math.floor(this._acc / TICK + 1e-9);
    this._acc -= n * TICK;
    if (n > MAX_TICKS) n = MAX_TICKS;
    if (!this.authority) {
      if (this.pending && !this.remote?.mp?.active && Date.now() - this.pending.t > 4000) {
        const p = this.pending;
        this.pending = null;
        p.done(false);
      }
      const v = this.view;
      if (n > 0 && v?.ready && !v.gone && v.f) {
        const f = v.f;
        if (f.lit > 0) f.lit = Math.max(0, f.lit - n);
        if (f.cooking && f.lit > 0) f.prog = Math.min(f.total - 1, f.prog + n);
        else if (!f.cooking && f.prog > 0) f.prog = Math.max(0, f.prog - 2 * n);
      }
      return;
    }
    this._check -= dt;
    const look = this._check <= 0;
    if (look) this._check = CHECK_EVERY;
    if (!this.store.size) return;
    const world = this.world;
    for (const f of this.store.values()) {
      if (look) {
        const id = this._blockAt(f);
        if (id >= 0 && !isFurnace(id)) {
          this._gone(f);
          continue;
        }
        if (id >= 0) f.kind = furnaceKind(id);
        // (Empty and nobody looking: forgotten.)
        if (Furnaces.empty(f) && f.prog <= 0 && this.view?.key !== f.key && !this.watched?.(f.key)) {
          this.store.delete(f.key);
          continue;
        }
      }
      if (n <= 0 || Furnaces.idle(f)) continue;
      if (!this._here(f) && !this.nearGuest?.(f.x, f.z, f.dim)) continue;
      const wasLit = f.lit > 0;
      const wasCooking = f.cooking;
      let changed = false;
      for (let k = 0; k < n; k++) {
        if (this._tick(f)) changed = true;
        if (Furnaces.idle(f)) {
          f.cooking = false;
          break;
        }
      }
      const isLit = f.lit > 0;
      if (wasLit !== isLit) this._showLit(f, isLit);
      if (changed) {
        this.onChanged?.(f.key, f.slots.map((s, i) => [i, s]), 0);
        if (this.view?.key === f.key) this.view.onUpdate?.();
      }
      if (wasLit !== isLit || wasCooking !== f.cooking) this.onBars?.(f.key);
    }
  }

  // The lit or unlit block (an ordinary edit: online it reaches everyone).
  _showLit(f, lit) {
    const id = this._blockAt(f);
    if (!isFurnace(id) || furnaceLit(id) === lit) return;
    if (this._here(f)) this.world.setBlock(f.x, f.y, f.z, furnaceAs(id, lit));
    else this.world.queueEdit?.(f.x, f.y, f.z, furnaceAs(id, lit), f.dim);
  }

  // ---------- The furnace open on this screen ----------

  // Opens the furnace at (x, y, z) for this player's screen; onUpdate() when
  // its slots change (or it is gone: view.gone). view.f has the bars (lit,
  // litDur, prog, total).
  openView(x, y, z, onUpdate) {
    const key = this.keyOf(x, y, z);
    if (this.view && this.view.key === key) {
      this.view.onUpdate = onUpdate;
      return this.view;
    }
    this.closeView();
    const view = { x, y, z, key, slots: null, f: null, ready: false, gone: false, onUpdate };
    this.view = view;
    if (this.authority) {
      view.f = this.contents(x, y, z);
      view.slots = view.f.slots;
      view.ready = true;
    } else this.remote?.open(view);
    return view;
  }

  closeView() {
    const v = this.view;
    if (!v) return;
    this.view = null;
    if (!this.authority) this.remote?.close(v);
  }

  // A click on the open furnace: changes [[slot, before, after], ...]. done(ok)
  // once applied (at once offline and on the host; when the host answers on a
  // guest) or refused (the furnace changed meanwhile). Taking from the output
  // brings the smelting's experience (onTakeXp).
  submit(changes, done) {
    const v = this.view;
    if (!v || !v.ready || v.gone || this.pending) return done(false);
    if (this.authority) {
      const r = this.apply(v.key, changes, 0);
      if (r && r.xp > 0) this.onTakeXp?.(r.xp, v.x, v.y, v.z);
      return done(!!r);
    }
    const p = (this.pending = { t: Date.now(), done });
    this.remote.op(v, changes, (ok, xp) => {
      if (this.pending !== p) return;
      this.pending = null;
      if (ok && xp > 0) this.onTakeXp?.(xp, v.x, v.y, v.z);
      done(ok);
    });
  }

  // The authority: applies changes to the furnace `key` if every slot still
  // holds what they expect, and what goes in is allowed there (the output only
  // gives). Returns { xp } (the experience for taking from the output), or
  // null: refused. fromPid: who asked (0: this player).
  apply(key, changes, fromPid = 0) {
    const f = this.store.get(key);
    if (!f || !Array.isArray(changes) || changes.length < 1 || changes.length > FURNACE_SLOTS) return null;
    const seen = new Set();
    const next = [];
    let took = false;
    for (const ch of changes) {
      if (!Array.isArray(ch)) return null;
      const [i, before, after] = ch;
      if (!Number.isInteger(i) || i < 0 || i >= FURNACE_SLOTS || seen.has(i)) return null;
      seen.add(i);
      const cur = f.slots[i];
      if (!sameStack(cur, before || null)) return null;
      const a = after ? decodeStack(encodeStack(after)) : null;
      if (after && !a) return null;
      if (a && !sameStack(cur, a)) {
        if (i === 2 && !(cur && a.id === cur.id && a.count < cur.count && (a.dur ?? -1) === (cur.dur ?? -1))) return null;
        if (i === 1 && !furnaceAccepts(1, a.id)) return null;
      }
      if (i === 2 && cur && (!a || a.count < cur.count)) took = true;
      next.push([i, a]);
    }
    for (const [i, a] of next) {
      // (A different input starts its cooking over.)
      if (i === 0 && (!a || f.slots[0]?.id !== a.id)) f.prog = 0;
      f.slots[i] = a;
    }
    const xp = took ? this._takeXp(f) : 0;
    this.onChanged?.(key, next, fromPid);
    if (fromPid && this.view?.key === key) this.view.onUpdate?.();
    return { xp };
  }

  // The experience kept in a furnace, in whole points (the fraction a chance
  // of one more, as in vanilla), emptied.
  _takeXp(f) {
    const total = f.xp;
    f.xp = 0;
    let n = Math.floor(total);
    if (Math.random() < total - n) n++;
    return n;
  }

  // ---------- A guest: the host's word ----------

  // The open furnace's whole state (slots null: gone).
  remoteState(key, slots, bars) {
    const v = this.view;
    if (!v || v.key !== key) return;
    if (!slots) v.gone = true;
    else {
      v.slots = slots;
      v.f = { slots, lit: 0, litDur: 0, prog: 0, total: COOK_TICKS, cooking: false };
      this._bars(v.f, bars);
      v.ready = true;
    }
    v.onUpdate?.();
  }

  // Slots of the open furnace changed at the host.
  remoteSet(key, list, bars) {
    const v = this.view;
    if (!v || v.key !== key || !v.ready) return;
    for (const [i, s] of list) if (Number.isInteger(i) && i >= 0 && i < FURNACE_SLOTS) v.slots[i] = s;
    this._bars(v.f, bars);
    v.onUpdate?.();
  }

  remoteBars(key, bars) {
    const v = this.view;
    if (v && v.key === key && v.ready) this._bars(v.f, bars);
  }

  _bars(f, b) {
    if (!f || !Array.isArray(b) || b.length < 5 || !b.slice(0, 4).every((n) => Number.isInteger(n) && n >= 0 && n <= 100000)) return;
    [f.lit, f.litDur, f.prog, f.total] = b;
    f.total = Math.max(1, f.total);
    f.cooking = !!b[4];
  }

  // The authority's bars of furnace `key` (null: none).
  bars(key) {
    const f = this.store.get(key);
    return f ? barsOf(f) : null;
  }

  // ---------- Furnaces going ----------

  // After every edit batch: a furnace whose place no longer holds one goes
  // (the authority; a big batch, a blast, looks the other way round).
  _blocksChanged(changed) {
    if (!this.authority || !this.store.size) return;
    const world = this.world;
    if (changed.length / 3 > this.store.size * 4) {
      for (const f of this.store.values()) if (this._here(f) && !isFurnace(world.getBlock(f.x, f.y, f.z))) this._gone(f);
      return;
    }
    for (let i = 0; i < changed.length; i += 3) {
      const f = this.store.get(this.keyOf(changed[i], changed[i + 1], changed[i + 2]));
      if (f && !isFurnace(world.getBlock(f.x, f.y, f.z))) this._gone(f);
    }
  }

  _gone(f) {
    this.store.delete(f.key);
    const v = this.view;
    if (v && v.key === f.key) {
      v.gone = true;
      v.onUpdate?.();
    }
    this.onGone?.(f.key);
    // (Round 12: in its own dimension; its experience only where the world is.)
    const here = !this.world.inDim || f.dim === this.world.dim;
    const drop = () => {
      for (const s of f.slots) if (s) this.onDrop?.(s, f.x, f.y, f.z);
    };
    if (here) drop();
    else this.world.inDim(f.dim, drop);
    const xp = this._takeXp(f);
    if (xp > 0 && here) this.onDropXp?.(xp, f.x, f.y, f.z);
  }

  // ---------- Save ----------

  // The furnaces that hold something, for the world save:
  // { "x,y,z": [[input, fuel, output], lit, litDur, prog, xp] } (stacks as
  // [id, count(, dur)] or 0); undefined on a guest, and when there are none.
  serialize() {
    if (!this.authority || !this.store.size) return undefined;
    const out = {};
    let any = false;
    for (const f of this.store.values()) {
      if (Furnaces.empty(f)) continue;
      out[f.key] = [f.slots.map(encodeStack), f.lit, f.litDur, f.prog, Math.round(f.xp * 1000) / 1000, f.kind | 0];
      any = true;
    }
    // (Round 12) The campfires' food (a key no older game reads as a furnace's).
    const camp = this.campfires.serialize();
    if (camp) {
      out.campfires = camp;
      any = true;
    }
    return any ? out : undefined;
  }

  load(data) {
    this.store.clear();
    this.campfires.load(data?.campfires);
    if (!data || typeof data !== "object") return;
    const int = (n) => (Number.isInteger(n) && n >= 0 && n <= 1e6 ? n : 0);
    for (const [key, e] of Object.entries(data)) {
      if (!DIM_KEY_RE.test(key) || !Array.isArray(e) || !Array.isArray(e[0])) continue;
      const [x, y, z, dim] = parseDimKey(key);
      const f = this.contents(x, y, z, dim);
      for (let i = 0; i < FURNACE_SLOTS; i++) f.slots[i] = decodeStack(e[0][i]);
      f.lit = int(e[1]);
      f.litDur = Math.max(f.lit, int(e[2]));
      f.prog = Math.min(int(e[3]), COOK_TICKS - 1);
      f.xp = Number.isFinite(e[4]) && e[4] > 0 ? Math.min(e[4], 1e6) : 0;
      if (e[5] === 1 || e[5] === 2) f.kind = e[5];
    }
  }
}

// ---------- (Round 12) Campfires ----------
//
// Up to four foods lie on a campfire (vanilla's: what a smoker cooks), each
// cooked in 30 s while it burns (cooling back, two ticks a tick, while it
// doesn't) and popped off cooked; the campfire broken spills them raw. The
// host owns them, like the furnaces (online: js/net/furnace.js, everyone
// sees what lies on them); only ones with food are kept and saved. Each peer
// draws the food on the campfires of its dimension near it, and the smoke
// rising from the lit ones (far higher over a hay bale: a signal fire).
export const CAMP_SLOTS = 4;
const CAMP_TICKS = 600; // (30 s)
const CAMP_SEE = 64; // blocks: the food drawn this near
const SMOKE_EVERY = 0.4; // s between puffs of a campfire
const SMOKE_SCAN = 0.75; // s between looks for the lit campfires near
const SMOKE_NEAR = 3; // chunks round the camera looked in
const SMOKE_MAX = 24; // campfires smoking at once
// The food's places on top: the four quarters, turned with the logs.
const CAMP_SPOTS = [
  [-1, -1],
  [1, -1],
  [1, 1],
  [-1, 1],
];
const SMOKE_DARK = new THREE.Color(0.32, 0.31, 0.3);
const SMOKE_LIGHT = new THREE.Color(0.62, 0.61, 0.6);

// Whether item `id` cooks on a campfire (and into what).
export const campfireRecipe = (id) => smeltsIn(1, id);

export class Campfires {
  constructor({ world, scene = null, effects = null }) {
    this.world = world;
    this.scene = scene;
    this.effects = effects;
    this.store = new Map(); // key -> { x, y, z, dim, key, slots: [4 stacks or null], prog: [4 ticks], lit }
    this.authority = true; // (Furnaces sets it: a guest's store is the host's word, to draw)
    this.remote = null; // (js/net/furnace.js) put(x, y, z, id)
    this.onDrop = null; // (stack, x, y, z): food popping off, or spilled
    this.onChanged = null; // (record): the authority, what lies on a campfire changed
    this.nearGuest = null; // (x, z, dim) => a guest is near (the host)
    this._acc = 0;
    this._check = 0;
    this._group = null;
    this._materials = null;
    this._meshes = new Map(); // key -> [mesh]
    this._dirty = new Set();
    this._shownDim = null;
    this._scanT = 0;
    this._smoking = []; // [{ x, y, z, signal, t }]
    LIB.campfires = this;
    world.changeListeners?.push((changed) => this._blocksChanged(changed));
  }

  keyOf(x, y, z, dim = this.world.dim ?? OVERWORLD) {
    return dimKey(dim, x, y, z);
  }

  _record(x, y, z, dim = this.world.dim ?? OVERWORLD) {
    const key = this.keyOf(x, y, z, dim);
    let f = this.store.get(key);
    if (!f) this.store.set(key, (f = { x, y, z, dim, key, slots: new Array(CAMP_SLOTS).fill(null), prog: new Array(CAMP_SLOTS).fill(0), lit: true }));
    return f;
  }

  _here(f) {
    const w = this.world;
    return f.dim === (w.dim ?? OVERWORLD) && !!w.getChunk?.(f.x >> 4, f.z >> 4);
  }

  // The block at the campfire's place, or -1 (not known here).
  _blockAt(f) {
    const w = this.world;
    if (this._here(f)) return w.getBlock(f.x, f.y, f.z);
    const id = (w.editsOf ? w.editsOf(f.dim) : w.edits)?.get(chunkKey(f.x >> 4, f.z >> 4))?.get(blockIndex(f.x & 15, f.y, f.z & 15));
    return id === undefined ? -1 : id;
  }

  // A right click with food on the campfire at ctx's cell (js/content/
  // workstations.js): laid on it if there is room (a guest asks the host,
  // which drops it back if there wasn't). True if taken.
  put(ctx) {
    const s = ctx.stack;
    if (!s || !campfireRecipe(s.id) || !isCampfire(ctx.id)) return false;
    const { x, y, z } = ctx;
    if (this.authority) {
      const f = this._record(x, y, z);
      const i = f.slots.indexOf(null);
      if (i < 0) return false;
      f.slots[i] = makeStack(s.id, 1);
      f.prog[i] = 0;
      f.lit = campfireLit(ctx.id);
      this._changed(f);
    } else {
      // (What the host last said lies there: full, nothing to ask.)
      const f = this.store.get(this.keyOf(x, y, z));
      if (f && !f.slots.includes(null)) return false;
      this.remote?.put?.(x, y, z, s.id);
    }
    if (!ctx.creative) ctx.inventory.consumeSelected(1);
    ctx.audio?.playPlace?.("wood");
    return true;
  }

  // The authority: a guest laid item `id` on the campfire at (x, y, z) in `dim`.
  remotePut(x, y, z, dim, id) {
    if (!this.authority || !campfireRecipe(id)) return;
    const f = this._record(x, y, z, dim);
    const block = this._blockAt(f);
    const i = f.slots.indexOf(null);
    if (i < 0 || (block >= 0 && !isCampfire(block))) {
      // (No room after all: it comes back off.)
      if (!f.slots.some(Boolean)) this.store.delete(f.key);
      this._spill([makeStack(id, 1)], f);
      return;
    }
    f.slots[i] = makeStack(id, 1);
    f.prog[i] = 0;
    if (block >= 0) f.lit = campfireLit(block);
    this._changed(f);
  }

  // A guest: the host's word on a campfire (slots null or empty: nothing on it).
  remoteSet(x, y, z, dim, slots) {
    const key = this.keyOf(x, y, z, dim);
    if (!slots || !slots.some(Boolean)) this.store.delete(key);
    else this._record(x, y, z, dim).slots = slots;
    this._dirty.add(key);
  }

  // A guest: every campfire's food, as the host has it (joining).
  remoteAll(list) {
    for (const key of this.store.keys()) this._dirty.add(key);
    this.store.clear();
    for (const [x, y, z, dim, slots] of list) this.remoteSet(x, y, z, dim, slots);
  }

  _changed(f) {
    this._dirty.add(f.key);
    if (this.authority) this.onChanged?.(f);
    if (!f.slots.some(Boolean)) this.store.delete(f.key);
  }

  _spill(stacks, f) {
    const drop = () => {
      for (const s of stacks) if (s) this.onDrop?.(s, f.x, f.y + 0.2, f.z);
    };
    if (this.world.inDim && f.dim !== this.world.dim) this.world.inDim(f.dim, drop);
    else drop();
  }

  // After every edit batch: a campfire gone spills its food (the authority);
  // one put out or lit again cooks or cools.
  _blocksChanged(changed) {
    if (!this.store.size) return;
    const w = this.world;
    for (let i = 0; i < changed.length; i += 3) {
      const f = this.store.get(this.keyOf(changed[i], changed[i + 1], changed[i + 2]));
      if (!f) continue;
      const id = w.getBlock(f.x, f.y, f.z);
      if (isCampfire(id)) {
        f.lit = campfireLit(id);
        continue;
      }
      this.store.delete(f.key);
      this._dirty.add(f.key);
      if (!this.authority) continue;
      this._spill(f.slots, f);
      f.slots.fill(null);
      this.onChanged?.(f);
    }
  }

  // The frame step: the authority cooks (whole ticks); everyone draws.
  update(dt) {
    if (this.authority && this.store.size) this._cook(dt);
    this._draw();
    this._smoke(dt);
  }

  _cook(dt) {
    this._acc += dt;
    let n = Math.floor(this._acc / TICK + 1e-9);
    this._acc -= n * TICK;
    if (n > MAX_TICKS) n = MAX_TICKS;
    this._check -= dt;
    const look = this._check <= 0;
    if (look) this._check = CHECK_EVERY;
    for (const f of [...this.store.values()]) {
      if (look) {
        const id = this._blockAt(f);
        if (id >= 0 && !isCampfire(id)) {
          this.store.delete(f.key);
          this._spill(f.slots, f);
          f.slots.fill(null);
          this._changed(f);
          continue;
        }
        if (id >= 0) f.lit = campfireLit(id);
      }
      if (n <= 0 || (!this._here(f) && !this.nearGuest?.(f.x, f.z, f.dim))) continue;
      let changed = false;
      for (let i = 0; i < CAMP_SLOTS; i++) {
        const s = f.slots[i];
        if (!s) continue;
        if (!f.lit) {
          f.prog[i] = Math.max(0, f.prog[i] - 2 * n);
          continue;
        }
        f.prog[i] += n;
        if (f.prog[i] < CAMP_TICKS) continue;
        const rec = campfireRecipe(s.id);
        f.slots[i] = null;
        f.prog[i] = 0;
        if (rec) this._spill([makeStack(rec.result.id, rec.result.count)], f);
        changed = true;
      }
      if (changed) this._changed(f);
    }
  }

  // ---------- Drawing (each peer, its own dimension) ----------

  _scene() {
    return this.scene || LIB.redstoneSim?.group?.parent || null;
  }

  _draw() {
    const w = this.world;
    const dim = w.dim ?? OVERWORLD;
    if (dim !== this._shownDim) {
      this._shownDim = dim;
      for (const key of this._meshes.keys()) this._dirty.add(key);
      for (const key of this.store.keys()) this._dirty.add(key);
    }
    if (!this._dirty.size) return;
    const scene = this._scene();
    if (!scene) return;
    if (!this._group) {
      this._group = new THREE.Group();
      scene.add(this._group);
      this._materials = { array: createEntityMaterial("array", w.atlas), color: createEntityMaterial("color") };
    }
    for (const key of this._dirty) {
      for (const m of this._meshes.get(key) || []) this._group.remove(m);
      this._meshes.delete(key);
      const f = this.store.get(key);
      if (!f || f.dim !== dim) continue;
      const id = this._blockAt(f);
      const axis = isCampfire(id) ? campfireAxis(id) : 0;
      const light = w.lightAt ? w.lightAt(f.x + 0.5, f.y + 0.6, f.z + 0.5) : { sky: 15, block: 15 };
      const list = [];
      f.slots.forEach((s, i) => {
        const model = s ? itemModel(s.id) : null;
        if (!model) return;
        const mesh = new THREE.Mesh(model.geometry, this._materials[model.kind]);
        const [a, b] = CAMP_SPOTS[i];
        const [ox, oz] = axis ? [b, -a] : [a, b];
        mesh.position.set(f.x + 0.5 + ox * 0.25, f.y + 7 / 16 + 0.02, f.z + 0.5 + oz * 0.25);
        mesh.rotation.set(-Math.PI / 2, 0, (axis ? Math.PI / 2 : 0) + i * (Math.PI / 2));
        mesh.scale.setScalar(model.cube ? 0.22 : 0.375);
        bindEntityLight(mesh, () => light);
        this._group.add(mesh);
        list.push(mesh);
      });
      if (list.length) this._meshes.set(key, list);
    }
    this._dirty.clear();
  }

  // The smoke of the lit campfires round the camera (found among the edits:
  // a campfire is always placed).
  _smoke(dt) {
    const fx = this.effects || LIB.redstoneSim?.effects;
    const pool = fx?.smoke;
    const at = fx?.listener;
    if (!pool || !at) return;
    const w = this.world;
    this._scanT -= dt;
    if (this._scanT <= 0) {
      this._scanT = SMOKE_SCAN;
      const old = new Map(this._smoking.map((c) => [`${c.x},${c.y},${c.z}`, c]));
      this._smoking = [];
      const edits = w.editsOf ? w.editsOf(w.dim) : w.edits;
      const cx0 = Math.floor(at.x) >> 4;
      const cz0 = Math.floor(at.z) >> 4;
      for (let cx = cx0 - SMOKE_NEAR; cx <= cx0 + SMOKE_NEAR && this._smoking.length < SMOKE_MAX; cx++) {
        for (let cz = cz0 - SMOKE_NEAR; cz <= cz0 + SMOKE_NEAR && this._smoking.length < SMOKE_MAX; cz++) {
          const m = edits?.get(chunkKey(cx, cz));
          if (!m || !w.getChunk?.(cx, cz)) continue;
          for (const [index, id] of m) {
            if (!isCampfire(id) || !campfireLit(id)) continue;
            const x = cx * 16 + (index & 15);
            const z = cz * 16 + ((index >> 4) & 15);
            const y = index >> 8;
            if (w.getBlock(x, y, z) !== id) continue;
            const prev = old.get(`${x},${y},${z}`);
            this._smoking.push({ x, y, z, signal: w.getBlock(x, y - 1, z) === HAY_BLOCK, t: prev ? prev.t : Math.random() * SMOKE_EVERY });
            if (this._smoking.length >= SMOKE_MAX) break;
          }
        }
      }
    }
    for (const c of this._smoking) {
      c.t -= dt;
      if (c.t > 0) continue;
      c.t += SMOKE_EVERY * (0.7 + Math.random() * 0.6);
      const r = () => (Math.random() - 0.5) * 0.3;
      pool.spawn({
        x: c.x + 0.5 + r(),
        y: c.y + 0.5,
        z: c.z + 0.5 + r(),
        vx: r() * 0.4,
        vy: c.signal ? 2.3 : 0.9,
        vz: r() * 0.4,
        life: c.signal ? 7 : 3.5,
        size0: 0.3,
        size1: c.signal ? 1.8 : 1.1,
        color0: SMOKE_DARK,
        color1: SMOKE_LIGHT,
        alpha: 0.42,
        drag: 0.08,
      });
    }
  }

  // ---------- Save (the authority's) ----------

  // { "x,y,z": [[stacks], [progress]] } for the campfires with food on them.
  serialize() {
    if (!this.authority || !this.store.size) return undefined;
    const out = {};
    for (const f of this.store.values()) if (f.slots.some(Boolean)) out[f.key] = [f.slots.map(encodeStack), f.prog.slice()];
    return Object.keys(out).length ? out : undefined;
  }

  load(data) {
    for (const key of this.store.keys()) this._dirty.add(key);
    this.store.clear();
    if (!data || typeof data !== "object") return;
    for (const [key, e] of Object.entries(data)) {
      if (!DIM_KEY_RE.test(key) || !Array.isArray(e) || !Array.isArray(e[0])) continue;
      const [x, y, z, dim] = parseDimKey(key);
      const f = this._record(x, y, z, dim);
      for (let i = 0; i < CAMP_SLOTS; i++) {
        f.slots[i] = decodeStack(e[0][i]);
        const p = Array.isArray(e[1]) ? e[1][i] : 0;
        f.prog[i] = Number.isInteger(p) && p > 0 && p < CAMP_TICKS ? p : 0;
      }
      if (!f.slots.some(Boolean)) this.store.delete(key);
      this._dirty.add(key);
    }
  }

  // Every campfire with food, for the net: [[x, y, z, dim code, [stacks]], ...].
  list() {
    const out = [];
    for (const f of this.store.values()) if (f.slots.some(Boolean)) out.push([f.x, f.y, f.z, codeOf(f.dim), f.slots.map(encodeStack)]);
    return out;
  }
}

export { NEAR_GUEST, barsOf };
