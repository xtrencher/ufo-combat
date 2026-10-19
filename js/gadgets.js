// The gadgets at run time (Round 12; their blocks: js/content/gadgets.js,
// their power: js/redstone-sim.js), as vanilla's:
//   - Hoppers (5 slots), droppers and dispensers (9) hold items, kept per
//     cell like the chests (the "box" screen: js/inventory-ui.js), saved
//     with the world, dropped when the block goes.
//   - A hopper, every game tick its cooldown allows (8 ticks after a move),
//     passes one item on (down or to its side) into the container there,
//     and takes one from the container above (through its bottom), or picks
//     up the items lying in its bowl (unless a full block covers it); a
//     powered hopper is locked. Containers: chests, furnaces (input from
//     the top, fuel from the sides, the output and an empty bucket from
//     below), brewing stands (the ingredient from the top, bottles and blaze
//     powder from the sides, bottles from below), hoppers, droppers and
//     dispensers (any slot, any side).
//   - A dropper fired by power puts one item (from a random slot) into the
//     container in front, or throws it out; a dispenser shoots arrows, fire
//     charges, snowballs and eggs, places and takes water and lava, uses
//     bone meal and flint and steel, primes TNT, puts armor on the player or
//     the armor stand in front, and throws anything else out.
//   - An item frame shows the item put in it, turned an eighth a click; an
//     armor stand wears the armor put on it (drawn near the camera); both
//     drop what they hold when broken (with the frame or the stand).
//   - Scaffolding keeps its distance from what holds it up (0-6, from the
//     block under it or the scaffolding beside it); at 7 it falls (drops).
//
// Online (GadgetSync below): the host owns what boxes, frames and stands
// hold. A guest's box screen is asked of the host like a chest's ("gbopen",
// "gbop": changes checked against what each slot held, "gbst", "gbset",
// "gbres", "gbclose"); a guest's click on a frame or a stand is asked too
// ("gsop" -> "gsres"), and the host tells everyone what each frame and
// stand shows ("gsset"; all of them with the world for a joiner). Hoppers,
// droppers and dispensers work on the host, in the ground it has loaded of
// its own dimension; their arrows and fireballs fly on the host (they hurt
// there) and are drawn on the guests ("ga" with the host's "rs"). Peers
// without gadgets ignore all of it.
import * as THREE from "three";
import { BLOCK, BLOCK_INFO, IS_SOLID, IS_OPAQUE, IS_REPLACEABLE, IS_CHEST } from "./blocks.js";
import { itemInfo, maxStack } from "./items.js";
import { makeStack, encodeStack, decodeStack, sameStack, Inventory } from "./inventory.js";
import { itemModel } from "./models.js";
import { createEntityMaterial, bindEntityLight } from "./shaders.js";
import { chunkKey, blockIndex, WORLD_HEIGHT } from "./constants.js";
import { LIB } from "./content/base.js";
import * as V from "./content/ids.js";
import {
  boxSlots,
  boxKind,
  hopperOut,
  dispenserFace,
  isHopper,
  isFrame,
  isStand,
  frameFace,
  standAngle,
  isScaffolding,
  scaffoldDistance,
  scaffoldDistanceAt,
  SCAFFOLD_MAX,
  boneMealBambooAt,
} from "./content/gadgets.js";
import { applyBoneMeal } from "./content/nature.js";
import { isFurnace, furnaceAccepts } from "./furnace.js";
import { isBrewingStand, brewingAccepts } from "./brewing.js";
import { dimKey, DIM_KEY_RE, parseDimKey, OVERWORLD, dimOfCode, dmOf } from "./dim-registry.js";

const TICK = 1 / 20;
const MAX_TICKS = 20; // (a slow frame catches up at most a second)
const HOPPER_COOL = 8; // game ticks between a hopper's moves (vanilla's)
const CHECK_EVERY = 1; // s: boxes in ground not loaded here looked at
const VIEW = 32; // blocks: what frames and stands hold is drawn this near
const REFRESH = 0.25;
const MAX_SHOTS = 64;
// (FACE order: +X, -X, +Y, -Y, +Z, -Z)
const DX = [1, -1, 0, 0, 0, 0];
const DY = [0, 0, 1, -1, 0, 0];
const DZ = [0, 0, 0, 0, 1, -1];
const OPP = [1, 0, 3, 2, 5, 4];
const UP = 2;
const DOWN = 3;
// Vanilla's projectiles, per second: arrows 1.1 blocks a tick, snowballs and
// eggs the same, a fire charge straight on; the arrow 3 damage.
const SHOT = {
  arrow: { speed: 22, gravity: 20, drag: 0.99, spread: 0.1, damage: 3 },
  fire: { speed: 18, gravity: 0, drag: 1, spread: 0.08, damage: 5 },
  snowball: { speed: 22, gravity: 12, drag: 0.99, spread: 0.1, damage: 0 },
  egg: { speed: 22, gravity: 12, drag: 0.99, spread: 0.1, damage: 0 },
};
const SHOT_KINDS = Object.keys(SHOT);
const SHOT_LIFE = 8;
const SHOT_OF = { [V.ARROW]: "arrow", [V.FIRE_CHARGE]: "fire", [V.SNOWBALL]: "snowball", [V.EGG]: "egg" };

const posOf = (p) => (Array.isArray(p) && p.length === 3 && p.every(Number.isInteger) && p[1] >= 0 && p[1] < WORLD_HEIGHT ? p : null);
const copy = (s) => (s ? { ...s } : null);
const one = (s) => makeStack(s.id, 1, s.dur, s.tag);
// Whether a stack of one more `s` can go onto `slot` (empty or the same, with room).
const fits = (slot, s) => !slot || (slot.id === s.id && slot.count < maxStack(s.id) && (slot.dur ?? -1) === (s.dur ?? -1) && JSON.stringify(slot.tag ?? null) === JSON.stringify(s.tag ?? null));

// ---------- The armor drawn on a stand (as js/player-avatar.js draws a player's) ----------

const PX = 1 / 16;
const ARMOR_COLORS = { leather: 0xa06540, chain: 0x8a8d91, gold: 0xf2cf45, iron: 0xd6d6d6, diamond: 0x4fd8cf, netherite: 0x4a4246, turtle: 0x47a046 };
// [part, box in the part's pixels]: the avatar's armor boxes.
const ARMOR_BOXES = [
  [["head", -4.6, 5.6, -4.6, 4.6, 8.6, 4.6], ["head", -4.6, 1, -4.6, 4.6, 5.6, -3.4], ["head", -4.6, 2, -3.4, -3.4, 5.6, 4.6], ["head", 3.4, 2, -3.4, 4.6, 5.6, 4.6]],
  [["body", -4.5, 1.8, -2.5, 4.5, 12.5, 2.5], ["armL", -2.5, -3.5, -2.5, 2.5, 2.5, 2.5], ["armR", -2.5, -3.5, -2.5, 2.5, 2.5, 2.5]],
  [["body", -4.3, -0.3, -2.3, 4.3, 2.4, 2.3], ["legL", -2.3, -8.5, -2.3, 2.3, 0.3, 2.3], ["legR", -2.3, -8.5, -2.3, 2.3, 0.3, 2.3]],
  [["legL", -2.6, -12.4, -2.6, 2.6, -7.6, 2.6], ["legR", -2.6, -12.4, -2.6, 2.6, -7.6, 2.6]],
];
// The stand's parts' pivots (pixels from its foot): a player's, as tall.
const PIVOTS = { head: [0, 24, 0], body: [0, 12, 0], armL: [6, 22, 0], armR: [-6, 22, 0], legL: [2, 12, 0], legR: [-2, 12, 0] };
const armorGeo = new Map(); // "slot:colour" -> geometry (in the stand's own pixels)
function armorGeometry(slot, hex) {
  const key = `${slot}:${hex}`;
  let g = armorGeo.get(key);
  if (g) return g;
  const parts = [];
  const base = new THREE.Color(hex);
  for (const [part, x0, y0, z0, x1, y1, z1] of ARMOR_BOXES[slot]) {
    const [px, py, pz] = PIVOTS[part];
    const b = new THREE.BoxGeometry((x1 - x0) * PX, (y1 - y0) * PX, (z1 - z0) * PX);
    b.translate(((x0 + x1) / 2 + px) * PX, ((y0 + y1) / 2 + py) * PX, ((z0 + z1) / 2 + pz) * PX);
    const pos = b.getAttribute("position");
    const n = b.getAttribute("normal");
    const colors = [];
    const c = new THREE.Color();
    for (let i = 0; i < pos.count; i++) {
      const k = (n.getY(i) > 0.5 ? 1.08 : n.getY(i) < -0.5 ? 0.7 : 0.94) * (pos.getY(i) <= (y0 + py + 0.4) * PX ? 0.82 : 1);
      c.copy(base).multiplyScalar(k);
      colors.push(c.r, c.g, c.b);
    }
    b.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
    parts.push(b);
  }
  g = mergeBoxes(parts);
  armorGeo.set(key, g);
  return g;
}
function mergeBoxes(list) {
  const pos = [];
  const nor = [];
  const col = [];
  const idx = [];
  let base = 0;
  for (const g of list) {
    const p = g.getAttribute("position");
    pos.push(...p.array);
    nor.push(...g.getAttribute("normal").array);
    col.push(...g.getAttribute("color").array);
    for (const i of g.getIndex().array) idx.push(i + base);
    base += p.count;
    g.dispose();
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  out.setAttribute("normal", new THREE.Float32BufferAttribute(nor, 3));
  out.setAttribute("color", new THREE.Float32BufferAttribute(col, 3));
  out.setIndex(idx);
  return out;
}
function armorColor(id) {
  const icon = itemInfo(id)?.icon;
  const m = typeof icon === "string" ? /^armor_([a-z]+)_/.exec(icon) : null;
  return ARMOR_COLORS[m?.[1]] ?? 0x9a9a9a;
}

export class Gadgets {
  // The game's systems: world, entities (dropped items), chests, furnaces,
  // brewing (their stores), mobs, player, inventory, audio, effects,
  // redstone (the simulation: its locks, firings and events).
  constructor({ scene = null, world, entities = null, chests = null, furnaces = null, brewing = null, mobs = null, player = null, inventory = null, audio = null, effects = null, redstone = null } = {}) {
    this.world = world;
    this.entities = entities;
    this.chests = chests;
    this.furnaces = furnaces;
    this.brewing = brewing;
    this.mobs = mobs;
    this.player = player;
    this.inventory = inventory;
    this.audio = audio;
    this.effects = effects;
    this.redstone = redstone;
    this.boxes = new Map(); // key -> { x, y, z, dim, key, kind, slots }
    this.shows = new Map(); // key -> { x, y, z, dim, key, kind: "frame" | "stand", slots, rot, mesh, shownId, drawn }
    this.authority = true; // false on a guest: the host owns what they hold
    this.remote = null; // js/net (GadgetSync): open/close/op for boxes, showOp for frames and stands
    this.view = null; // the box open on this screen (as js/chests.js's view)
    this.pending = null; // a guest's click waiting for the host
    this.broadcast = null; // (msg): the host, online (GadgetSync)
    // Hooks set by the game.
    this.onDrop = null; // (stack, x, y, z): what a box, frame or stand held, into the world
    this.onInventory = null; // (): this player's inventory changed (armor put on by a dispenser, a guest's frame or stand click answered)
    this.simulates = () => true; // (main.js: this peer simulates its dimension's world: scaffolding)
    this.isChestStore = (id) => IS_CHEST[id] === 1; // (the blocks whose items js/chests.js keeps, per cell)
    this._hoppers = new Map(); // key -> { x, y, z, dim, cool } (seen by the simulation)
    this._acc = 0;
    this._check = 0;
    this._t = REFRESH;
    this._scaffold = new Set(); // cell keys to look at (scaffolding's distance)
    this._itemCells = null; // (per tick: dropped items by cell, for the hoppers)
    this.shots = []; // arrows and the like in flight: { kind, pos, vel, age, mesh, visual, light }
    this.stats = { moved: 0, fired: 0 };
    this.group = null;
    if (scene) {
      this.group = new THREE.Group();
      scene.add(this.group);
      this.materials = { array: createEntityMaterial("array", world.atlas), color: createEntityMaterial("color") };
    }
    world.changeListeners?.push((changed, opts) => this._changed(changed, opts));
    if (redstone) {
      redstone.onHopper = (x, y, z) => this._seeHopper(x, y, z);
      redstone.onDispense = (x, y, z, id) => this.dispense(x, y, z, id);
      redstone.onEvent = (e) => this._onEvent(e);
    }
    LIB.gadgets = this;
  }

  // ---------- Keys ----------

  get _dim() {
    return this.world.dim ?? OVERWORLD;
  }

  keyOf(x, y, z, dim = this._dim) {
    return dimKey(dim, x, y, z);
  }

  // The block at a record's place (loaded here, else its recorded edit, -1: unknown).
  _blockAt(r) {
    const w = this.world;
    if (r.dim === this._dim && w.getChunk(r.x >> 4, r.z >> 4)) return w.getBlock(r.x, r.y, r.z);
    const edits = w.editsOf ? w.editsOf(r.dim) : w.edits;
    const id = edits?.get(chunkKey(r.x >> 4, r.z >> 4))?.get(blockIndex(r.x & 15, r.y, r.z & 15));
    return id === undefined ? -1 : id;
  }

  // ---------- Boxes: what hoppers, droppers and dispensers hold ----------

  // The record of the box at (x, y, z) (made empty on first use; the authority).
  contents(x, y, z, dim = this._dim, id = -1) {
    const key = this.keyOf(x, y, z, dim);
    let b = this.boxes.get(key);
    if (!b) {
      if (id < 0) id = dim === this._dim ? this.world.getBlock(x, y, z) : this.world.blockIn?.(dim, x, y, z) ?? -1;
      const n = boxSlots(id);
      if (!n) return null;
      b = { x, y, z, dim, key, kind: boxKind(id), slots: new Array(n).fill(null) };
      this.boxes.set(key, b);
    }
    return b;
  }

  // Slots of box `b` changed (moved items, a click): to whoever has it open.
  _boxChanged(b, list) {
    this.remote?.boxChanged?.(b.key, list.map((i) => [i, b.slots[i]]));
    if (this.view?.key === b.key) this.view.onUpdate?.();
  }

  // Opens the box at (x, y, z) for this player's screen (js/inventory-ui.js:
  // the chest's area with view.size slots, view.cols across, view.title).
  openView(x, y, z, onUpdate) {
    const key = this.keyOf(x, y, z);
    if (this.view && this.view.key === key) {
      this.view.onUpdate = onUpdate;
      return this.view;
    }
    this.closeView();
    const id = this.world.getBlock(x, y, z);
    const size = boxSlots(id) || 9;
    const kind = boxKind(id) || "dispenser";
    const view = { x, y, z, key, kind, size, cols: size === 5 ? 5 : 3, title: kind[0].toUpperCase() + kind.slice(1), store: this, slots: null, ready: false, gone: false, onUpdate };
    this.view = view;
    if (this.authority) {
      const b = this.contents(x, y, z, this._dim, id);
      if (b) {
        view.slots = b.slots;
        view.ready = true;
      } else view.gone = true;
    } else this.remote?.open(view);
    return view;
  }

  closeView() {
    const v = this.view;
    if (!v) return;
    this.view = null;
    if (!this.authority) this.remote?.close(v);
  }

  // A click on the open box: changes [[slot, before, after], ...]; done(ok)
  // once applied (at once offline and on the host; when the host answers).
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

  // The authority: applies changes to box `key` if each slot still holds
  // what they expect. fromPid: who asked (0: this player).
  apply(key, changes, fromPid = 0) {
    const b = this.boxes.get(key);
    if (!b || !Array.isArray(changes) || changes.length < 1 || changes.length > b.slots.length) return false;
    const seen = new Set();
    const next = [];
    for (const ch of changes) {
      if (!Array.isArray(ch)) return false;
      const [i, before, after] = ch;
      if (!Number.isInteger(i) || i < 0 || i >= b.slots.length || seen.has(i)) return false;
      seen.add(i);
      if (!sameStack(b.slots[i], before || null)) return false;
      const a = after ? decodeStack(encodeStack(after)) : null;
      if (after && !a) return false;
      next.push([i, a]);
    }
    for (const [i, a] of next) b.slots[i] = a;
    this.remote?.boxChanged?.(key, next, fromPid);
    if (fromPid && this.view?.key === key) this.view.onUpdate?.();
    return true;
  }

  // A guest: the host's word on the open box (its slots, or null: gone).
  remoteState(key, slots) {
    const v = this.view;
    if (!v || v.key !== key) return;
    if (!slots) v.gone = true;
    else {
      v.slots = slots;
      v.size = slots.length;
      v.ready = true;
    }
    v.onUpdate?.();
  }

  remoteSet(key, list) {
    const v = this.view;
    if (!v || v.key !== key || !v.ready) return;
    for (const [i, s] of list) if (Number.isInteger(i) && i >= 0 && i < v.slots.length) v.slots[i] = s;
    v.onUpdate?.();
  }

  // ---------- Containers (the hoppers' and droppers' side of them) ----------

  // What the block at (x, y, z) holds, as the hoppers see it: { slots,
  // canPut(i, stack, face), canTake(i, face), done(indices) } (face: the
  // side of the container the item goes in or out by), or null.
  container(x, y, z) {
    const w = this.world;
    const id = w.getBlock(x, y, z);
    if (boxSlots(id)) {
      const b = this.contents(x, y, z, this._dim, id);
      return b && { slots: b.slots, canPut: () => true, canTake: () => true, done: (list) => this._boxChanged(b, list) };
    }
    if (this.chests && this.isChestStore(id)) {
      const ch = this.chests;
      const slots = ch.contents(x, y, z);
      const key = ch.keyOf(x, y, z);
      return {
        slots,
        canPut: () => true,
        canTake: () => true,
        done: (list) => {
          ch.onChanged?.(key, list.map((i) => [i, slots[i]]), 0);
          if (ch.view?.key === key) ch.view.onUpdate?.();
        },
      };
    }
    if (this.furnaces && isFurnace(id)) {
      const fs = this.furnaces;
      const f = fs.contents(x, y, z);
      return {
        slots: f.slots,
        // (vanilla's: the input from the top, fuel from the sides; the output
        // and a bucket left from the fuel out of the bottom)
        canPut: (i, s, face) => (face === UP ? i === 0 : face !== DOWN && i === 1 && furnaceAccepts(1, s.id)),
        canTake: (i, face) => face === DOWN && (i === 2 || (i === 1 && f.slots[1]?.id === V.BUCKET)),
        done: (list) => {
          fs.onChanged?.(f.key, list.map((i) => [i, f.slots[i]]), 0);
          if (fs.view?.key === f.key) fs.view.onUpdate?.();
        },
      };
    }
    if (this.brewing && isBrewingStand(id)) {
      const bs = this.brewing;
      const b = bs.contents(x, y, z);
      return {
        slots: b.slots,
        // (vanilla's: the ingredient from the top; bottles, one a slot, and
        // blaze powder from the sides; the bottles out of the bottom)
        canPut: (i, s, face) => (face === UP ? i === 3 && brewingAccepts(3, s.id) : face !== DOWN && i !== 3 && brewingAccepts(i, s.id) && (i === 4 || !b.slots[i])),
        canTake: (i, face) => face === DOWN && i < 3,
        done: (list) => {
          bs.onChanged?.(b.key, list.map((i) => [i, b.slots[i]]), 0);
          if (bs.view?.key === b.key) bs.view.onUpdate?.();
        },
      };
    }
    return null;
  }

  // One of stack `s` into container `c` by `face` (the first slot that takes
  // it, in order: vanilla's). True if it went in.
  _putOne(c, s, face) {
    for (let i = 0; i < c.slots.length; i++) {
      if (!c.canPut(i, s, face) || !fits(c.slots[i], s)) continue;
      if (c.slots[i]) c.slots[i] = { ...c.slots[i], count: c.slots[i].count + 1 };
      else c.slots[i] = one(s);
      c.done([i]);
      return true;
    }
    return false;
  }

  // One item out of slot i of a record's slots (the stack shrinks).
  static _takeOne(slots, i) {
    const s = slots[i];
    slots[i] = s.count > 1 ? { ...s, count: s.count - 1 } : null;
    return one(s);
  }

  // ---------- Hoppers ----------

  _seeHopper(x, y, z) {
    if (!this.authority) return;
    const key = this.keyOf(x, y, z);
    if (!this._hoppers.has(key)) this._hoppers.set(key, { x, y, z, dim: this._dim, key, cool: 0 });
  }

  // Every game tick: each hopper off its cooldown passes an item on and takes one in.
  _tickHoppers() {
    const w = this.world;
    const here = this._dim;
    this._itemCells = null;
    for (const h of this._hoppers.values()) {
      if (h.dim !== here) continue;
      if (h.cool > 0) {
        h.cool--;
        continue;
      }
      if (!w.getChunk(h.x >> 4, h.z >> 4)) continue;
      const id = w.getBlock(h.x, h.y, h.z);
      if (!isHopper(id)) {
        this._hoppers.delete(h.key);
        continue;
      }
      if (this.redstone?.powered?.(h.x, h.y, h.z)) continue;
      const b = this.boxes.get(h.key);
      let moved = false;
      if (b && b.slots.some(Boolean)) moved = this._push(h, b, hopperOut(id));
      if (this._pull(h, b)) moved = true;
      if (moved) {
        h.cool = HOPPER_COOL;
        this.stats.moved++;
      }
    }
  }

  // One item from the hopper into the container it points at.
  _push(h, b, out) {
    const c = this.container(h.x + DX[out], h.y + DY[out], h.z + DZ[out]);
    if (!c) return false;
    for (let i = 0; i < b.slots.length; i++) {
      const s = b.slots[i];
      if (!s || !this._putOne(c, s, OPP[out])) continue;
      Gadgets._takeOne(b.slots, i);
      this._boxChanged(b, [i]);
      return true;
    }
    return false;
  }

  // One item into the hopper from the container above, or the items in its bowl.
  _pull(h, b) {
    const w = this.world;
    const above = w.getBlock(h.x, h.y + 1, h.z);
    const c = this.container(h.x, h.y + 1, h.z);
    if (c) {
      for (let i = 0; i < c.slots.length; i++) {
        const s = c.slots[i];
        if (!s || !c.canTake(i, DOWN)) continue;
        b ||= this.contents(h.x, h.y, h.z, h.dim);
        if (!b || !this._putOne({ slots: b.slots, canPut: () => true, done: (list) => this._boxChanged(b, list) }, s, UP)) return false;
        Gadgets._takeOne(c.slots, i);
        c.done([i]);
        return true;
      }
      return false;
    }
    // (a full block over it: nothing falls in)
    if (IS_SOLID[above] && IS_OPAQUE[above]) return false;
    const items = this._itemsAt(h.x, h.z);
    if (!items) return false;
    for (const it of items) {
      if (it.taken || it.pos.y < h.y + 0.6 || it.pos.y >= h.y + 2) continue;
      b ||= this.contents(h.x, h.y, h.z, h.dim);
      if (!b) return false;
      if (this._absorb(b, it)) return true;
    }
    return false;
  }

  // The dropped items lying over column (x, z) this tick (indexed once a tick).
  _itemsAt(x, z) {
    const ents = this.entities;
    if (!ents?.items.length) return null;
    if (!this._itemCells) {
      this._itemCells = new Map();
      const code = this.world.dimInfo?.code ?? 0;
      for (const it of ents.items) {
        if ((it.dim ?? 0) !== code) continue;
        const k = `${Math.floor(it.pos.x)},${Math.floor(it.pos.z)}`;
        const list = this._itemCells.get(k);
        if (list) list.push(it);
        else this._itemCells.set(k, [it]);
      }
    }
    return this._itemCells.get(`${x},${z}`) || null;
  }

  // As much of dropped item `it` as fits goes into box `b` (vanilla takes
  // the whole stack at once); what doesn't fit stays where it lay.
  _absorb(b, it) {
    const s = makeStack(it.id, it.count, it.dur, it.tag);
    const changed = [];
    let left = s.count;
    for (let i = 0; i < b.slots.length && left > 0; i++) {
      const cur = b.slots[i];
      if (cur && !fits(cur, s)) continue;
      const room = cur ? maxStack(s.id) - cur.count : maxStack(s.id);
      const n = Math.min(room, left);
      if (n <= 0) continue;
      b.slots[i] = cur ? { ...cur, count: cur.count + n } : { ...s, count: n };
      left -= n;
      changed.push(i);
    }
    if (!changed.length) return false;
    // (taken out of everyone's world: online the host says so, as a pickup by nobody)
    it.taken = -1;
    if (it.shared) this.broadcast?.({ t: "itaken", k: it.shared, by: 0, n: 0 });
    this.entities.collect(it, null);
    if (left > 0) this.entities.spawn(it.id, left, it.pos, new THREE.Vector3(), { dur: it.dur, tag: it.tag, pickupDelay: 0 });
    this._boxChanged(b, changed);
    return true;
  }

  // ---------- Droppers and dispensers ----------

  // Fired by power (js/redstone-sim.js): one item out of a random slot.
  dispense(x, y, z, id) {
    if (!this.authority) return;
    const b = this.contents(x, y, z, this._dim, id);
    const full = b ? b.slots.map((s, i) => (s ? i : -1)).filter((i) => i >= 0) : [];
    if (!full.length) {
      this._click(x, y, z, false); // (vanilla's "fail" click)
      return;
    }
    const i = full[Math.floor(Math.random() * full.length)];
    const f = dispenserFace(id);
    const fx = x + DX[f];
    const fy = y + DY[f];
    const fz = z + DZ[f];
    const s = b.slots[i];
    let ok;
    if (boxKind(id) === "dropper") ok = this._drop(b, i, x, y, z, f);
    else ok = this._dispense(b, i, s, x, y, z, f, fx, fy, fz);
    if (ok) this.stats.fired++;
    this._click(x, y, z, ok);
  }

  _click(x, y, z, ok) {
    const r = this.redstone;
    if (r?._sound) r._sound("click", x, y, z, ok ? 1 : 0);
    else this.audio?.playClick?.();
  }

  // A dropper: into the container in front (one item), else thrown out.
  _drop(b, i, x, y, z, f) {
    const c = this.container(x + DX[f], y + DY[f], z + DZ[f]);
    if (c) {
      if (!this._putOne(c, b.slots[i], OPP[f])) return false;
      Gadgets._takeOne(b.slots, i);
      this._boxChanged(b, [i]);
      return true;
    }
    this._throwOut(Gadgets._takeOne(b.slots, i), x, y, z, f);
    this._boxChanged(b, [i]);
    return true;
  }

  // An item out of the front (vanilla's DefaultDispenseItemBehavior: from
  // the face, about 6 blocks a second that way, a little up and wide).
  _throwOut(stack, x, y, z, f) {
    const p = new THREE.Vector3(x + 0.5 + DX[f] * 0.7, y + 0.5 + DY[f] * 0.7 - (f === UP || f === DOWN ? 0.125 : 0.15625), z + 0.5 + DZ[f] * 0.7);
    const speed = 2 + Math.random() * 2;
    const v = new THREE.Vector3(DX[f] * speed + (Math.random() - 0.5) * 0.7, DY[f] * speed + 4, DZ[f] * speed + (Math.random() - 0.5) * 0.7);
    this.entities?.spawn(stack.id, stack.count, p, v, { dur: stack.dur, tag: stack.tag, pickupDelay: 0.5 });
    this._smoke(x, y, z, f);
  }

  _smoke(x, y, z, f) {
    const d = this.effects?.debris;
    if (!d) return;
    this._smokeC ||= new THREE.Color(0.55, 0.55, 0.57);
    for (let k = 0; k < 5; k++) d.spawn(x + 0.5 + DX[f] * 0.6, y + 0.5 + DY[f] * 0.6, z + 0.5 + DZ[f] * 0.6, DX[f] * 1.5 + (Math.random() - 0.5), DY[f] * 1.5 + Math.random() * 0.8, DZ[f] * 1.5 + (Math.random() - 0.5), 0.05, this._smokeC, 0.5);
  }

  // A dispenser: what the item does (vanilla's DispenseItemBehavior), else as a dropper.
  _dispense(b, i, s, x, y, z, f, fx, fy, fz) {
    const w = this.world;
    const front = w.getBlock(fx, fy, fz);
    const take = () => {
      const out = Gadgets._takeOne(b.slots, i);
      this._boxChanged(b, [i]);
      return out;
    };
    // (an item back into the dispenser where the used one was, or anywhere, else thrown out)
    const giveBack = (id) => {
      const st = makeStack(id, 1);
      if (!b.slots[i]) b.slots[i] = st;
      else if (!this._putOne({ slots: b.slots, canPut: () => true, done: () => {} }, st, UP)) this._throwOut(st, x, y, z, f);
      this._boxChanged(b, b.slots.map((_, k) => k));
    };
    const shot = SHOT_OF[s.id];
    if (shot) {
      take();
      this._shoot(shot, x, y, z, f);
      return true;
    }
    const info = itemInfo(s.id);
    if (s.id === V.WATER_BUCKET || s.id === V.LAVA_BUCKET) {
      // (into air, a plant or flowing liquid; a source there already: thrown out instead)
      if (!IS_REPLACEABLE[front] || (front === BLOCK.WATER && this._waterSource(fx, fy, fz)) || front === V.LAVA) return this._fallback(b, i, x, y, z, f);
      if (!w.setBlock(fx, fy, fz, s.id === V.WATER_BUCKET ? BLOCK.WATER : V.LAVA)) return false;
      b.slots[i] = makeStack(V.BUCKET, 1);
      this._boxChanged(b, [i]);
      return true;
    }
    if (s.id === V.BUCKET) {
      const water = front === BLOCK.WATER && this._waterSource(fx, fy, fz);
      const lava = front === V.LAVA;
      if (!water && !lava) return this._fallback(b, i, x, y, z, f);
      if (!w.setBlock(fx, fy, fz, BLOCK.AIR)) return false;
      take();
      giveBack(water ? V.WATER_BUCKET : V.LAVA_BUCKET);
      return true;
    }
    if (s.id === V.BONE_MEAL) {
      if (!applyBoneMeal(w, fx, fy, fz) && !boneMealBambooAt(w, fx, fy, fz)) return false;
      take();
      return true;
    }
    if (s.id === V.FLINT_AND_STEEL) {
      let lit = false;
      if (LIB.igniteTnt?.(w, fx, fy, fz)) lit = true;
      else if (front === BLOCK.AIR && IS_SOLID[w.getBlock(fx, fy - 1, fz)]) lit = w.setBlock(fx, fy, fz, V.FIRE);
      if (!lit) return false;
      // (it wears by one, and breaks)
      const st = b.slots[i];
      const dur = (st.dur ?? info?.tool?.durability ?? 64) - 1;
      b.slots[i] = dur > 0 ? { ...st, dur } : null;
      this._boxChanged(b, [i]);
      return true;
    }
    if (s.id === V.TNT) {
      const r = this.redstone;
      if (!r?._spawnTnt) return this._fallback(b, i, x, y, z, f);
      take();
      r._spawnTnt(fx + 0.5, fy, fz + 0.5, 4);
      return true;
    }
    const slot = info?.armor ? Inventory.armorSlotOf(s.id) : -1;
    if (slot >= 0 && this._equip(b, i, s, slot, fx, fy, fz)) return true;
    return this._fallback(b, i, x, y, z, f);
  }

  _fallback(b, i, x, y, z, f) {
    this._throwOut(Gadgets._takeOne(b.slots, i), x, y, z, f);
    this._boxChanged(b, [i]);
    return true;
  }

  // Water the flowing-water sim made is no source (as js/content/items-vanilla.js).
  _waterSource(x, y, z) {
    return !this.world.waterSim?.meta?.has(`${x},${y},${z}`);
  }

  // Armor onto the player standing in front (this machine's; a guest's is
  // thrown out to them instead) or the armor stand there, if that slot is free.
  _equip(b, i, s, slot, fx, fy, fz) {
    const p = this.player;
    const inv = this.inventory;
    if (p && inv && !p.dead && !inv.armor[slot]) {
      const q = p.position;
      if (q.x + 0.3 > fx && q.x - 0.3 < fx + 1 && q.z + 0.3 > fz && q.z - 0.3 < fz + 1 && q.y < fy + 1 && q.y + 1.8 > fy) {
        inv.armor[slot] = Gadgets._takeOne(b.slots, i);
        this._boxChanged(b, [i]);
        this.audio?.playClick?.();
        this.onInventory?.();
        return true;
      }
    }
    for (const sy of [fy, fy - 1]) {
      if (!isStand(this.world.getBlock(fx, sy, fz))) continue;
      const r = this._show(fx, sy, fz, "stand");
      if (r.slots[slot]) return false;
      const next = r.slots.slice();
      next[slot] = Gadgets._takeOne(b.slots, i);
      this._boxChanged(b, [i]);
      this._setShow(r, next, r.rot);
      return true;
    }
    return false;
  }

  // ---------- Shots: arrows, fire charges, snowballs, eggs ----------

  _shoot(kind, x, y, z, f, visual = false, at = null, vel = null) {
    if (this.shots.length >= MAX_SHOTS) return;
    const spec = SHOT[kind];
    let pos;
    let v;
    if (at) {
      pos = new THREE.Vector3(at[0], at[1], at[2]);
      v = new THREE.Vector3(vel[0], vel[1], vel[2]);
    } else {
      pos = new THREE.Vector3(x + 0.5 + DX[f] * 0.7, y + 0.5 + DY[f] * 0.7, z + 0.5 + DZ[f] * 0.7);
      // (vanilla's: along the face, a little up for a level shot, a little scattered)
      const d = new THREE.Vector3(DX[f], DY[f] + (f === UP || f === DOWN ? 0 : 0.1), DZ[f]);
      d.x += (Math.random() - 0.5) * spec.spread;
      d.y += (Math.random() - 0.5) * spec.spread;
      d.z += (Math.random() - 0.5) * spec.spread;
      v = d.normalize().multiplyScalar(spec.speed);
    }
    const t = { kind, pos, vel: v, age: 0, mesh: null, visual, light: { sky: 15, block: 0 } };
    if (this.group) {
      const model = kind === "arrow" ? null : itemModel(kind === "fire" ? V.FIRE_CHARGE : kind === "egg" ? V.EGG : V.SNOWBALL);
      if (kind === "arrow") t.mesh = new THREE.Mesh(this._arrowGeometry(), this.materials.color);
      else if (model) {
        t.mesh = new THREE.Mesh(model.geometry, this.materials[model.kind]);
        t.mesh.scale.setScalar(0.32);
      }
      if (t.mesh) {
        bindEntityLight(t.mesh, () => t.light);
        t.mesh.position.copy(pos);
        this.group.add(t.mesh);
      }
    }
    this.shots.push(t);
    if (!visual) {
      const r2 = (n) => Math.round(n * 100) / 100;
      this.redstone?.event?.(["ga", SHOT_KINDS.indexOf(kind), r2(pos.x), r2(pos.y), r2(pos.z), r2(v.x), r2(v.y), r2(v.z)]);
      if (kind !== "fire") this.audio?.playBowShot?.(0.6);
    }
  }

  _arrowGeometry() {
    if (this._arrowGeo) return this._arrowGeo;
    const shaft = new THREE.CylinderGeometry(0.022, 0.022, 0.72, 5).rotateX(Math.PI / 2);
    const colors = [];
    for (let i = 0; i < shaft.getAttribute("position").count; i++) colors.push(0.54, 0.42, 0.24);
    shaft.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
    this._arrowGeo = shaft;
    return shaft;
  }

  _updateShots(dt) {
    const w = this.world;
    for (let i = this.shots.length - 1; i >= 0; i--) {
      const t = this.shots[i];
      const spec = SHOT[t.kind];
      t.age += dt;
      t.vel.y -= spec.gravity * dt;
      if (spec.drag < 1) t.vel.multiplyScalar(Math.pow(spec.drag, dt * 20));
      const step = t.vel.clone().multiplyScalar(dt);
      const len = step.length() || 1e-4;
      const dir = step.clone().divideScalar(len);
      const block = w.raycast(t.pos, dir, len, { solidOnly: true });
      let hit = block ? block.distance : Infinity;
      let mob = null;
      let target = null;
      if (!t.visual) {
        const m = this.mobs?.raycast?.(t.pos, dir, Math.min(len, hit));
        if (m) {
          mob = m.mob;
          hit = m.distance;
        }
        for (const p of this.mobs?.targets ? this.mobs.targets() : this.player ? [this.player] : []) {
          const d = this._hitsBody(t.pos, dir, Math.min(len, hit), p);
          if (d !== null) {
            target = p;
            mob = null;
            hit = d;
          }
        }
      }
      if (hit <= len || t.age > SHOT_LIFE || t.pos.y < -16) {
        if (hit <= len) this._land(t, t.pos.clone().addScaledVector(dir, Math.max(0, hit - 0.05)), dir, block && !mob && !target ? block : null, mob, target);
        if (t.mesh) this.group.remove(t.mesh);
        this.shots.splice(i, 1);
        continue;
      }
      t.pos.add(step);
      if (t.mesh) {
        t.mesh.position.copy(t.pos);
        if (t.kind === "arrow") {
          t.mesh.lookAt(t.pos.x + dir.x, t.pos.y + dir.y, t.pos.z + dir.z);
        } else t.mesh.rotation.y += dt * 6;
        t.light = w.lightAt(t.pos.x, t.pos.y, t.pos.z);
      }
    }
  }

  // Where along a step (0..max) a shot enters a player's body box, or null.
  _hitsBody(o, d, max, p) {
    if (!p || p.dead || p.creative || !p.position) return null;
    const q = p.position;
    const lo = [q.x - 0.35, q.y - 0.1, q.z - 0.35];
    const hi = [q.x + 0.35, q.y + 1.9, q.z + 0.35];
    const oo = [o.x, o.y, o.z];
    const dd = [d.x, d.y, d.z];
    let t0 = 0;
    let t1 = max;
    for (let k = 0; k < 3; k++) {
      if (Math.abs(dd[k]) < 1e-9) {
        if (oo[k] < lo[k] || oo[k] > hi[k]) return null;
        continue;
      }
      let a = (lo[k] - oo[k]) / dd[k];
      let b = (hi[k] - oo[k]) / dd[k];
      if (a > b) [a, b] = [b, a];
      t0 = Math.max(t0, a);
      t1 = Math.min(t1, b);
      if (t0 > t1) return null;
    }
    return t0;
  }

  // What a shot does where it lands (the host's; a guest's copy only stops).
  _land(t, at, dir, block, mob, target) {
    const spec = SHOT[t.kind];
    const d = this.effects?.debris;
    if (d && t.kind !== "arrow") {
      this._shardC ||= { snowball: new THREE.Color(0.95, 0.97, 1), egg: new THREE.Color(0.93, 0.88, 0.74), fire: new THREE.Color(1, 0.55, 0.15) };
      for (let k = 0; k < 6; k++) d.spawn(at.x, at.y, at.z, (Math.random() - 0.5) * 3, Math.random() * 2.5, (Math.random() - 0.5) * 3, 0.05, this._shardC[t.kind], 0.6);
    }
    if (t.visual) return;
    if (t.kind === "arrow") this.audio?.playArrowHit?.(this.player ? at.distanceTo(this.player.position) : 0);
    if (mob) {
      if (t.kind === "fire" && this.mobs) this.mobs.attackExtras = { fire: 5 };
      try {
        if (spec.damage > 0) this.mobs.shoot(mob, spec.damage, dir, t.kind === "arrow" ? 2 : 0.5, false);
        else if (t.kind === "snowball") this.mobs.snowballHit?.(mob, dir);
      } finally {
        if (this.mobs) this.mobs.attackExtras = null;
      }
      return;
    }
    if (target) {
      if (spec.damage > 0 && target.damage(spec.damage, t.kind === "fire" ? "fireball" : "arrow", { from: at.clone().addScaledVector(dir, -3), projectile: true })) {
        if (t.kind === "fire") {
          if (typeof target.fireTime === "number") target.fireTime = Math.max(target.fireTime, 5);
          else target.setFire?.(5);
        } else target.applyImpulse?.(new THREE.Vector3(dir.x * 3, 1.5, dir.z * 3));
      }
      return;
    }
    if (!block) return;
    if (t.kind === "fire") {
      // (it sets fire where it lands)
      const [x, y, z] = block.place;
      if (this.world.getBlock(x, y, z) === BLOCK.AIR) this.world.setBlock(x, y, z, V.FIRE);
    } else if (t.kind === "arrow") {
      // (an arrow that hit a block can be picked up, as an item where it fell)
      this.entities?.spawn(V.ARROW, 1, at.clone().addScaledVector(dir, -0.2), new THREE.Vector3(), { pickupDelay: 0.5 });
    } else if (t.kind === "egg" && Math.random() < 1 / 8) LIB.spawnMob?.("chicken", at.x, at.y, at.z, { baby: true });
  }

  // A guest: the host's event ("ga": a shot to draw).
  _onEvent(e) {
    if (e[0] !== "ga" || this.authority) return;
    const kind = SHOT_KINDS[e[1]];
    const num = (n) => typeof n === "number" && Number.isFinite(n);
    if (!kind || !e.slice(2, 8).every(num)) return;
    const vel = e.slice(5, 8).map((n) => Math.max(-60, Math.min(60, n)));
    this._shoot(kind, 0, 0, 0, 0, true, e.slice(2, 5), vel);
  }

  // ---------- Item frames and armor stands ----------

  // The record of the frame or stand at (x, y, z) (made empty: a stand
  // wears nothing, a frame holds nothing).
  _show(x, y, z, kind, dim = this._dim) {
    const key = this.keyOf(x, y, z, dim);
    let r = this.shows.get(key);
    if (!r) {
      r = { x, y, z, dim, key, kind, slots: new Array(kind === "stand" ? 4 : 1).fill(null), rot: 0, mesh: null, shownId: -1, drawn: null, light: { sky: 15, block: 0 } };
      this.shows.set(key, r);
    }
    return r;
  }

  showAt(x, y, z, dim = this._dim) {
    return this.shows.get(this.keyOf(x, y, z, dim)) || null;
  }

  // Sets what a frame or stand holds (the authority: and tells everyone).
  _setShow(r, slots, rot) {
    r.slots = slots;
    r.rot = rot & 7;
    r.drawn = null;
    this._t = REFRESH;
    if (this.authority) this.remote?.showSet?.(r);
  }

  _removeShow(key) {
    const r = this.shows.get(key);
    if (!r) return;
    this._dropMesh(r);
    this.shows.delete(key);
  }

  // A right click on an item frame (js/content/gadgets.js): an item in hand
  // goes in (one of it); a frame holding something turns it an eighth.
  useFrame(ctx) {
    const { x, y, z } = ctx;
    const r = this.showAt(x, y, z);
    const held = ctx.stack;
    if (r?.slots[0]) return this._op(ctx, x, y, z, "frame", [], (r.rot + 1) & 7, null, () => this.audio?.playClick?.());
    if (!held) return false;
    const put = one(held);
    return this._op(ctx, x, y, z, "frame", [[0, null, put]], 0, () => {
      if (!ctx.creative) ctx.inventory.consumeSelected(1);
    }, () => this.audio?.playPlace?.("wood"));
  }

  // A right click on an armor stand (its lower block at x, y, z): armor in
  // hand goes on (swapped with what it wore there); an empty hand takes the
  // piece aimed at (vanilla's heights: the feet, chest, legs, head).
  useStand(ctx, x, y, z) {
    if (!isStand(this.world.getBlock(x, y, z))) return false;
    const r = this.showAt(x, y, z);
    const worn = r ? r.slots : [null, null, null, null];
    const held = ctx.stack;
    const slot = held ? Inventory.armorSlotOf(held.id) : -1;
    if (held && slot < 0) return true; // (nothing else goes on a stand without arms)
    if (held) {
      const before = copy(worn[slot]);
      return this._op(ctx, x, y, z, "stand", [[slot, before, one(held)]], 0, () => {
        const inv = ctx.inventory;
        if (ctx.creative) return;
        inv.consumeSelected(1);
        if (before) {
          if (!inv.selectedStack) inv.slots[inv.selected] = before;
          else if (inv.add(before.id, 1, before.dur, before.tag) > 0) ctx.interaction?.throwStack?.(before);
        }
      }, () => this.audio?.playClick?.());
    }
    const h = ctx.hit ? ctx.hit[1] - y : 1;
    const pick = h >= 0.1 && h < 0.55 && worn[3] ? 3 : h >= 0.9 && h < 1.6 && worn[1] ? 1 : h >= 0.4 && h < 1.2 && worn[2] ? 2 : h >= 1.6 && worn[0] ? 0 : -1;
    if (pick < 0) return false;
    const taken = copy(worn[pick]);
    return this._op(ctx, x, y, z, "stand", [[pick, taken, null]], 0, () => {
      const inv = ctx.inventory;
      if (inv.add(taken.id, 1, taken.dur, taken.tag) > 0) ctx.interaction?.throwStack?.(taken);
    }, () => this.audio?.playClick?.());
  }

  // A frame's or stand's change: changes [[slot, before, after]] and the
  // turn; mine() makes this player's side of it (the hand) once it is done.
  // At once on the authority; a guest asks the host first.
  _op(ctx, x, y, z, kind, changes, rot, mine, sound) {
    if (this.authority) {
      const ok = this.applyShow(this._dim, x, y, z, kind, changes, rot);
      if (ok) {
        mine?.();
        sound?.();
      }
      return ok;
    }
    if (this.pending || !this.remote) return true;
    const p = (this.pending = { t: Date.now(), done: null });
    p.done = (ok) => {
      if (this.pending === p) this.pending = null;
      if (!ok) return;
      mine?.();
      sound?.();
      this.onInventory?.();
    };
    this.remote.showOp(this._dim, x, y, z, kind, changes, rot, p.done);
    return true;
  }

  // The authority: a frame's or stand's change, if the block is there and
  // each slot holds what the change expects. True if applied.
  applyShow(dim, x, y, z, kind, changes, rot) {
    const id = dim === this._dim ? this.world.getBlock(x, y, z) : this.world.blockIn?.(dim, x, y, z) ?? -1;
    if (kind === "frame" ? !isFrame(id) : !isStand(id)) return false;
    if (!Array.isArray(changes) || changes.length > 4 || !Number.isInteger(rot)) return false;
    const r = this.shows.get(this.keyOf(x, y, z, dim));
    const cur = r ? r.slots.slice() : new Array(kind === "stand" ? 4 : 1).fill(null);
    for (const ch of changes) {
      if (!Array.isArray(ch)) return false;
      const [i, before, after] = ch;
      if (!Number.isInteger(i) || i < 0 || i >= cur.length || !sameStack(cur[i], before || null)) return false;
      const a = after ? decodeStack(encodeStack(after)) : null;
      if (after && (!a || a.count !== 1)) return false;
      // (a stand's slot only takes its own piece of armor)
      if (a && kind === "stand" && Inventory.armorSlotOf(a.id) !== i) return false;
      cur[i] = a;
    }
    if (!changes.length && !cur[0]) return false;
    this._setShow(r || this._show(x, y, z, kind, dim), cur, rot);
    return true;
  }

  // A guest: the host's word on a frame or stand (slots null: gone).
  remoteShow(dim, x, y, z, kind, slots, rot) {
    const key = this.keyOf(x, y, z, dim);
    if (!slots) {
      this._removeShow(key);
      return;
    }
    const r = this._show(x, y, z, kind, dim);
    r.slots = slots;
    r.rot = rot & 7;
    r.drawn = null;
    this._t = REFRESH;
  }

  // ---------- Blocks changing ----------

  // A box, frame or stand gone: what it held drops (the authority; a
  // guest's records just go); scaffolding near a change looks at its distance.
  _changed(changed, opts) {
    const w = this.world;
    const auth = this.authority;
    for (let i = 0; i < changed.length; i += 3) {
      const x = changed[i];
      const y = changed[i + 1];
      const z = changed[i + 2];
      const id = w.getBlock(x, y, z);
      if (this.boxes.size || this.view) {
        const key = this.keyOf(x, y, z);
        const b = this.boxes.get(key);
        if (b && boxSlots(id) !== b.slots.length) this._boxGone(b, auth);
        else if (!b && this.view?.key === key && !boxSlots(id)) {
          this.view.gone = true;
          this.view.onUpdate?.();
        }
      }
      if (this.shows.size) {
        const key = this.keyOf(x, y, z);
        const r = this.shows.get(key);
        if (r && (r.kind === "frame" ? !isFrame(id) : !isStand(id))) this._showGone(r, auth);
      }
      if (isScaffolding(id) || this._scaffoldNear(x, y, z)) this._scaffold.add(`${x},${y},${z}`);
    }
  }

  _boxGone(b, auth) {
    this.boxes.delete(b.key);
    this._hoppers.delete(b.key);
    const v = this.view;
    if (v && v.key === b.key) {
      v.gone = true;
      v.onUpdate?.();
    }
    if (!auth) return;
    this.remote?.boxGone?.(b.key);
    this._spill(b.slots, b.x, b.y, b.z, b.dim);
  }

  _showGone(r, auth) {
    this._removeShow(r.key);
    if (!auth) return;
    this.remote?.showSet?.({ ...r, slots: null });
    this._spill(r.slots, r.x, r.y, r.z, r.dim);
  }

  _spill(slots, x, y, z, dim) {
    const drop = () => {
      for (const s of slots) if (s) this.onDrop?.(s, x, y, z);
    };
    if (this.world.inDim && dim !== this._dim) this.world.inDim(dim, drop);
    else drop();
  }

  // ---------- Scaffolding ----------

  _scaffoldNear(x, y, z) {
    const w = this.world;
    if (isScaffolding(w.getBlock(x, y + 1, z))) return true;
    return isScaffolding(w.getBlock(x + 1, y, z)) || isScaffolding(w.getBlock(x - 1, y, z)) || isScaffolding(w.getBlock(x, y, z + 1)) || isScaffolding(w.getBlock(x, y, z - 1));
  }

  // The cells queued last frame: scaffolding there and beside them takes its
  // distance; at 7 it falls (drops as an item). (A tick later, as vanilla's.)
  _updateScaffold() {
    if (!this._scaffold.size) return;
    const cells = [...this._scaffold];
    this._scaffold.clear();
    if (!this.simulates()) return;
    const w = this.world;
    const seen = new Set();
    const list = [];
    const fall = [];
    const look = (x, y, z) => {
      const k = `${x},${y},${z}`;
      if (seen.has(k)) return;
      seen.add(k);
      const id = w.getBlock(x, y, z);
      if (!isScaffolding(id)) return;
      const d = scaffoldDistanceAt(w, x, y, z);
      if (d >= SCAFFOLD_MAX) fall.push(x, y, z);
      else if (d !== scaffoldDistance(id)) list.push(x, y, z, V.SCAFFOLDING + d);
    };
    for (const k of cells.slice(0, 2048)) {
      const [x, y, z] = k.split(",").map(Number);
      look(x, y, z);
      look(x, y + 1, z);
      look(x + 1, y, z);
      look(x - 1, y, z);
      look(x, y, z + 1);
      look(x, y, z - 1);
    }
    if (list.length) w.setBlocks(list);
    if (fall.length) {
      const air = [];
      for (let i = 0; i < fall.length; i += 3) air.push(fall[i], fall[i + 1], fall[i + 2], BLOCK.AIR);
      w.setBlocks(air);
      for (let i = 0; i < fall.length; i += 3) if (w.getBlock(fall[i], fall[i + 1], fall[i + 2]) === BLOCK.AIR) w.onBlockPopped?.(fall[i], fall[i + 1], fall[i + 2], V.SCAFFOLDING);
    }
  }

  // ---------- Every frame ----------

  update(dt, eye = null) {
    if (this.pending && !this.remote?.mp?.active && Date.now() - this.pending.t > 4000) {
      const p = this.pending;
      this.pending = null;
      p.done?.(false);
    }
    this._updateScaffold();
    if (this.shots.length) this._updateShots(dt);
    if (this.authority) {
      this._acc += dt;
      let n = Math.floor(this._acc / TICK + 1e-9);
      this._acc -= n * TICK;
      if (n > MAX_TICKS) n = MAX_TICKS;
      if (this._hoppers.size) for (let k = 0; k < n; k++) this._tickHoppers();
      this._check -= dt;
      if (this._check <= 0 && this.boxes.size) {
        this._check = CHECK_EVERY;
        // (a box whose block went where this machine had no ground loaded:
        // a guest's edit far away, or in another dimension)
        for (const b of [...this.boxes.values()]) {
          const id = this._blockAt(b);
          if (id >= 0 && boxSlots(id) !== b.slots.length) this._boxGone(b, true);
          else if (!b.slots.some(Boolean) && this.view?.key !== b.key && !this.remote?.watched?.(b.key)) this.boxes.delete(b.key);
        }
      }
    }
    this._draw(dt, eye);
  }

  // What frames and stands near `eye` hold, drawn; the others' let go.
  _draw(dt, eye) {
    if (!this.group || !eye) return;
    this._t += dt;
    if (this._t < REFRESH) return;
    this._t = 0;
    const w = this.world;
    const here = this._dim;
    for (const r of this.shows.values()) {
      const d = Math.max(Math.abs(r.x + 0.5 - eye.x), Math.abs(r.y + 0.5 - eye.y), Math.abs(r.z + 0.5 - eye.z));
      const id = r.dim === here && d < VIEW ? w.getBlock(r.x, r.y, r.z) : 0;
      const ok = r.kind === "frame" ? isFrame(id) : isStand(id);
      if (!ok || !r.slots.some(Boolean)) {
        this._dropMesh(r);
        continue;
      }
      const l = w.lightAt(r.x, r.y + (r.kind === "stand" ? 1 : 0), r.z);
      r.light.sky = l.sky;
      r.light.block = l.block;
      const sig = `${id}|${r.rot}|${r.slots.map((s) => s?.id ?? 0).join(",")}`;
      if (r.drawn === sig) continue;
      this._dropMesh(r);
      r.drawn = sig;
      r.mesh = r.kind === "frame" ? this._frameMesh(r, id) : this._standMesh(r, id);
      if (r.mesh) this.group.add(r.mesh);
    }
  }

  _frameMesh(r, id) {
    const s = r.slots[0];
    const model = s ? itemModel(s.id) : null;
    if (!model) return null;
    const mesh = new THREE.Mesh(model.geometry, this.materials[model.kind]);
    const f = frameFace(id);
    const k = model.cube ? 0.3 : 0.5;
    mesh.scale.setScalar(k);
    // (just off the board, the item's face out; turned an eighth a click, clockwise)
    const off = 0.5 - S16 - (model.cube ? k / 2 + 0.005 : 0.03);
    mesh.position.set(r.x + 0.5 - DX[f] * off, r.y + 0.5 - DY[f] * off, r.z + 0.5 - DZ[f] * off);
    const yaw = f === 0 ? Math.PI / 2 : f === 1 ? -Math.PI / 2 : f === 5 ? Math.PI : 0;
    const pitch = f === UP ? -Math.PI / 2 : f === DOWN ? Math.PI / 2 : 0;
    mesh.rotation.set(pitch, yaw, (-r.rot * Math.PI) / 4, "YXZ");
    mesh.castShadow = true;
    bindEntityLight(mesh, () => r.light);
    return mesh;
  }

  _standMesh(r, id) {
    const g = new THREE.Group();
    g.position.set(r.x + 0.5, r.y, r.z + 0.5);
    g.rotation.y = standAngle(id);
    for (let slot = 0; slot < 4; slot++) {
      const s = r.slots[slot];
      if (!s || itemInfo(s.id)?.elytra) continue;
      const mesh = new THREE.Mesh(armorGeometry(slot, armorColor(s.id)), this.materials.color);
      mesh.castShadow = true;
      bindEntityLight(mesh, () => r.light);
      g.add(mesh);
    }
    return g.children.length ? g : null;
  }

  _dropMesh(r) {
    if (!r.mesh) return;
    this.group?.remove(r.mesh);
    r.mesh = null;
    r.drawn = null;
  }

  // How many frames' and stands' things are drawn now (tests).
  get drawnCount() {
    let n = 0;
    for (const r of this.shows.values()) if (r.mesh) n++;
    return n;
  }

  // Everything in flight goes (a new world, a change of dimension).
  clear() {
    for (const t of this.shots) if (t.mesh) this.group?.remove(t.mesh);
    this.shots.length = 0;
    this._hoppers.clear();
    this._scaffold.clear();
  }

  // ---------- Save ----------

  // { b: { key: [slots, [[slot, id, count(, dur, tag)], ...]] }, s: { key: [kind, rot, [[slot, ...stack]]] } }
  // (undefined on a guest, and when there is nothing).
  serialize() {
    if (!this.authority) return undefined;
    const out = {};
    const b = {};
    let nb = 0;
    for (const [key, r] of this.boxes) {
      const list = [];
      r.slots.forEach((s, i) => s && list.push([i, ...encodeStack(s)]));
      if (!list.length) continue;
      b[key] = [r.slots.length, list];
      nb++;
    }
    if (nb) out.b = b;
    const s = this.serializeShows();
    if (s) out.s = s;
    return nb || s ? out : undefined;
  }

  serializeShows() {
    let n = 0;
    const out = {};
    for (const [key, r] of this.shows) {
      const list = [];
      r.slots.forEach((st, i) => st && list.push([i, ...encodeStack(st)]));
      if (!list.length) continue;
      out[key] = [r.kind === "stand" ? 1 : 0, r.rot, list];
      n++;
    }
    return n ? out : undefined;
  }

  load(data) {
    this.boxes.clear();
    for (const r of this.shows.values()) this._dropMesh(r);
    this.shows.clear();
    this._hoppers.clear();
    if (!data || typeof data !== "object") return;
    for (const [key, e] of Object.entries(data.b || {})) {
      const p = parseDimKey(key);
      if (!p || !Array.isArray(e) || ![5, 9].includes(e[0]) || !Array.isArray(e[1])) continue;
      const [x, y, z, dim] = p;
      const slots = new Array(e[0]).fill(null);
      for (const it of e[1]) if (Array.isArray(it) && Number.isInteger(it[0]) && it[0] >= 0 && it[0] < e[0]) slots[it[0]] = decodeStack(it.slice(1));
      this.boxes.set(key, { x, y, z, dim, key, kind: e[0] === 5 ? "hopper" : "dispenser", slots });
    }
    this.loadShows(data.s);
  }

  loadShows(data) {
    if (!data || typeof data !== "object") return;
    for (const [key, e] of Object.entries(data)) {
      const p = parseDimKey(key);
      if (!p || !DIM_KEY_RE.test(key) || !Array.isArray(e) || !Array.isArray(e[2])) continue;
      const [x, y, z, dim] = p;
      const r = this._show(x, y, z, e[0] === 1 ? "stand" : "frame", dim);
      for (const it of e[2]) if (Array.isArray(it) && Number.isInteger(it[0]) && it[0] >= 0 && it[0] < r.slots.length) r.slots[it[0]] = decodeStack(it.slice(1));
      r.rot = Number.isInteger(e[1]) ? e[1] & 7 : 0;
    }
  }
}
const S16 = 1 / 16;

// ---------- Online ----------

// The multiplayer module (main.js adds it: mp.addModule).
export class GadgetSync {
  constructor(mp, gadgets) {
    this.mp = mp;
    this.net = mp.net;
    this.g = gadgets;
    this.watchers = new Map(); // host: box key -> Set of pids with it open
    this._ops = new Map(); // guest: op number -> done(ok)
    this._n = 1;
    if (!gadgets) return;
    if (mp.game?.GUEST) gadgets.authority = false;
    gadgets.remote = this;
    const net = this.net;
    net.on("gbopen", (m, from) => this._onOpen(m, from));
    net.on("gbclose", (m, from) => this._onClose(m, from));
    net.on("gbop", (m, from) => this._onOp(m, from));
    net.on("gbst", (m) => this._onState(m));
    net.on("gbset", (m) => this._onSet(m));
    net.on("gbres", (m) => this._onResult(m));
    net.on("gsop", (m, from) => this._onShowOp(m, from));
    net.on("gsset", (m, from) => from === 1 && this._onShowSet(m));
    net.on("gsres", (m) => this._onResult(m));
    net.registerSync("gadgets", {
      save: () => gadgets.serializeShows() || {},
      load: (data) => gadgets.loadShows(data),
    });
  }

  start() {
    const g = this.g;
    if (!g) return;
    g.authority = this.net.isHost;
    g.broadcast = (m) => this.mp.active && this.net.isHost && this.net.broadcast(m);
    // (a guest keeps nothing of its own: what it shows comes from the host)
    if (!this.net.isHost) {
      g.boxes.clear();
      for (const r of g.shows.values()) g._dropMesh(r);
      g.shows.clear();
      g._hoppers.clear();
    }
  }

  stop() {
    this.watchers.clear();
    for (const done of this._ops.values()) done(false);
    this._ops.clear();
    if (this.g) this.g.broadcast = null;
  }

  playerLeft(p) {
    for (const set of this.watchers.values()) set.delete(p.pid);
  }

  watched(key) {
    return !!this.watchers.get(key)?.size;
  }

  _keyDm(key) {
    return dmOf(parseDimKey(key)?.[3]);
  }

  // ---------- A guest asking (js/gadgets.js calls these) ----------

  open(view) {
    if (this.mp.active) this.net.toHost({ t: "gbopen", p: [view.x, view.y, view.z], ...this._keyDm(view.key) });
  }

  close(view) {
    if (this.mp.active) this.net.toHost({ t: "gbclose", p: [view.x, view.y, view.z], ...this._keyDm(view.key) });
  }

  op(view, changes, done) {
    if (!this.mp.active) return done(false);
    const n = this._n++;
    this._ops.set(n, done);
    this.net.toHost({ t: "gbop", p: [view.x, view.y, view.z], n, c: changes.map(([i, b, a]) => [i, encodeStack(b), encodeStack(a)]), ...this._keyDm(view.key) });
  }

  showOp(dim, x, y, z, kind, changes, rot, done) {
    if (!this.mp.active) return done(false);
    const n = this._n++;
    this._ops.set(n, done);
    this.net.toHost({ t: "gsop", p: [x, y, z], n, k: kind === "stand" ? 1 : 0, c: changes.map(([i, b, a]) => [i, encodeStack(b), encodeStack(a)]), r: rot, ...dmOf(dim) });
  }

  // ---------- The host ----------

  // (A guest's word on a place: within reach of where they are.)
  _near(from, x, y, z) {
    const at = this.mp.players?.get(from)?.livePos;
    return !!at && Math.abs(at.x - x - 0.5) <= 16 && Math.abs(at.y - y) <= 16 && Math.abs(at.z - z - 0.5) <= 16;
  }

  _onOpen(m, from) {
    if (!this.net.isHost || !this.g) return;
    const p = posOf(m.p);
    if (!p) return;
    const dim = dimOfCode(m.dm);
    const b = this.g.contents(p[0], p[1], p[2], dim);
    if (!b) {
      this.net.send(from, { t: "gbst", p, s: 0, ...dmOf(dim) });
      return;
    }
    let set = this.watchers.get(b.key);
    if (!set) this.watchers.set(b.key, (set = new Set()));
    set.add(from);
    this.net.send(from, { t: "gbst", p, s: b.slots.map(encodeStack), ...dmOf(dim) });
  }

  _onClose(m, from) {
    if (!this.net.isHost || !this.g) return;
    const p = posOf(m.p);
    if (!p) return;
    const key = this.g.keyOf(p[0], p[1], p[2], dimOfCode(m.dm));
    const set = this.watchers.get(key);
    if (!set) return;
    set.delete(from);
    if (!set.size) this.watchers.delete(key);
  }

  _decode(c, max) {
    if (!Array.isArray(c) || c.length > max) return null;
    const out = [];
    for (const ch of c) {
      if (!Array.isArray(ch)) return null;
      const b = decodeStack(ch[1]);
      const a = decodeStack(ch[2]);
      if ((ch[1] && !b) || (ch[2] && !a)) return null;
      out.push([ch[0], b, a]);
    }
    return out;
  }

  _onOp(m, from) {
    if (!this.net.isHost || !this.g) return;
    const p = posOf(m.p);
    if (!p || !Number.isInteger(m.n)) return;
    const dim = dimOfCode(m.dm);
    const key = this.g.keyOf(p[0], p[1], p[2], dim);
    let ok = false;
    const changes = this.watchers.get(key)?.has(from) ? this._decode(m.c, 9) : null;
    if (changes) ok = this.g.apply(key, changes, from);
    if (ok) this.net.send(from, { t: "gbres", p, n: m.n, ok: 1, ...dmOf(dim) });
    else {
      const b = this.g.boxes.get(key);
      this.net.send(from, { t: "gbres", p, n: m.n, ok: 0, s: b ? b.slots.map(encodeStack) : 0, ...dmOf(dim) });
    }
  }

  // A box changed (anyone's click, a hopper's move): to the others with it open.
  boxChanged(key, list, fromPid = 0) {
    if (!this.mp.active || !this.net.isHost) return;
    const set = this.watchers.get(key);
    if (!set?.size) return;
    const p = parseDimKey(key);
    const msg = { t: "gbset", p: p.slice(0, 3), c: list.map(([i, s]) => [i, encodeStack(s)]), ...dmOf(p[3]) };
    for (const pid of set) if (pid !== this.net.pid) this.net.send(pid, msg);
  }

  boxGone(key) {
    if (!this.mp.active || !this.net.isHost) return;
    const set = this.watchers.get(key);
    this.watchers.delete(key);
    if (!set?.size) return;
    const p = parseDimKey(key);
    for (const pid of set) this.net.send(pid, { t: "gbst", p: p.slice(0, 3), s: 0, ...dmOf(p[3]) });
  }

  _onShowOp(m, from) {
    if (!this.net.isHost || !this.g) return;
    const p = posOf(m.p);
    if (!p || !Number.isInteger(m.n)) return;
    const dim = dimOfCode(m.dm);
    const changes = this._near(from, p[0], p[1], p[2]) ? this._decode(m.c, 4) : null;
    const ok = !!changes && this.g.applyShow(dim, p[0], p[1], p[2], m.k === 1 ? "stand" : "frame", changes, Number.isInteger(m.r) ? m.r & 7 : 0);
    this.net.send(from, { t: "gsres", n: m.n, ok: ok ? 1 : 0 });
  }

  // The host: what a frame or stand shows now (slots null: gone), to everyone.
  showSet(r) {
    if (!this.mp.active || !this.net.isHost) return;
    this.net.broadcast({ t: "gsset", p: [r.x, r.y, r.z], k: r.kind === "stand" ? 1 : 0, s: r.slots ? r.slots.map(encodeStack) : 0, r: r.rot, ...dmOf(r.dim) });
  }

  // ---------- A guest: the host's answers ----------

  _slots(s, sizes) {
    if (!Array.isArray(s) || !sizes.includes(s.length)) return null;
    return s.map((e) => decodeStack(e));
  }

  _onState(m) {
    if (this.net.isHost || !this.g) return;
    const p = posOf(m.p);
    if (p) this.g.remoteState(this.g.keyOf(p[0], p[1], p[2], dimOfCode(m.dm)), this._slots(m.s, [5, 9]));
  }

  _onSet(m) {
    if (this.net.isHost || !this.g) return;
    const p = posOf(m.p);
    if (!p || !Array.isArray(m.c) || m.c.length > 9) return;
    const list = [];
    for (const ch of m.c) if (Array.isArray(ch) && Number.isInteger(ch[0])) list.push([ch[0], decodeStack(ch[1])]);
    this.g.remoteSet(this.g.keyOf(p[0], p[1], p[2], dimOfCode(m.dm)), list);
  }

  _onResult(m) {
    if (this.net.isHost || !this.g) return;
    const done = this._ops.get(m.n);
    this._ops.delete(m.n);
    const p = posOf(m.p);
    if (m.t === "gbres" && !m.ok && p && m.s !== undefined) this.g.remoteState(this.g.keyOf(p[0], p[1], p[2], dimOfCode(m.dm)), this._slots(m.s, [5, 9]));
    done?.(!!m.ok);
  }

  _onShowSet(m) {
    if (this.net.isHost || !this.g) return;
    const p = posOf(m.p);
    if (!p) return;
    const kind = m.k === 1 ? "stand" : "frame";
    this.g.remoteShow(dimOfCode(m.dm), p[0], p[1], p[2], kind, m.s ? this._slots(m.s, [kind === "stand" ? 4 : 1]) : null, Number.isInteger(m.r) ? m.r : 0);
  }
}
