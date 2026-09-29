// The Mods switch. On (the default): guns, explosives, the laser blaster,
// UFOs, aliens and vehicles. Off: vanilla survival/creative (swords and
// tools stay). Switching mid-game is clean in both directions:
//   - off: mod items leave the inventory into a stash (saved with the
//     player) and come back to their slots when mods return; mod items lying
//     in the world, projectiles in flight, pending airstrikes, UFOs, aliens
//     and vehicles are removed (a player flying a vehicle is set down
//     safely first, by the vehicle system's own listener);
//   - on: the stash returns, and UFOs etc. start appearing again.
// Other systems subscribe with onChange(fn(enabled)).
import { MOD_ITEMS, modState } from "./items.js";
import { makeStack } from "./inventory.js";

export class Mods {
  constructor({ inventory, weapons, lasers, entities }) {
    this.inventory = inventory;
    this.weapons = weapons;
    this.lasers = lasers;
    this.entities = entities;
    this.enabled = true;
    this.stash = []; // [{ slot, id, count, dur }]
    this._listeners = [];
  }

  onChange(fn) {
    this._listeners.push(fn);
  }

  // Applies the switch. `initial`: at startup (nothing to announce).
  set(enabled, { initial = false } = {}) {
    enabled = !!enabled;
    const changed = enabled !== this.enabled;
    this.enabled = enabled;
    modState.enabled = enabled;
    this.weapons.enabled = enabled;
    if (!enabled) {
      this.stashItems();
      this.weapons.cancel();
      this.weapons.clearProjectiles?.();
      this.lasers.clear();
      this.entities.removeWhere?.((item) => MOD_ITEMS.has(item.id));
    } else {
      this.restoreItems();
    }
    if (changed || initial) for (const fn of this._listeners) fn(enabled, { initial });
    return changed;
  }

  // Moves every mod item out of the inventory into the stash.
  stashItems() {
    const slots = this.inventory.slots;
    let moved = 0;
    for (let i = 0; i < slots.length; i++) {
      const s = slots[i];
      if (s && MOD_ITEMS.has(s.id)) {
        this.stash.push({ slot: i, id: s.id, count: s.count, dur: s.dur });
        slots[i] = null;
        moved++;
      }
    }
    return moved;
  }

  // Puts stashed items back (in their old slots when still free, else
  // wherever they fit; anything that doesn't fit stays stashed).
  restoreItems() {
    const slots = this.inventory.slots;
    const keep = [];
    for (const it of this.stash) {
      if (it.slot >= 0 && it.slot < slots.length && !slots[it.slot]) {
        slots[it.slot] = makeStack(it.id, it.count, it.dur);
        continue;
      }
      const rest = this.inventory.add(it.id, it.count, it.dur);
      if (rest > 0) keep.push({ ...it, count: rest, slot: -1 });
    }
    this.stash = keep;
    return keep.length === 0;
  }

  serialize() {
    return this.stash.map((it) => [it.slot, it.id, it.count, it.dur ?? null]);
  }

  load(data) {
    this.stash = [];
    if (!Array.isArray(data)) return;
    for (const e of data) {
      if (!Array.isArray(e) || !Number.isInteger(e[1]) || !MOD_ITEMS.has(e[1])) continue;
      this.stash.push({ slot: Number.isInteger(e[0]) ? e[0] : -1, id: e[1], count: Math.max(1, Math.min(64, e[2] | 0)), dur: Number.isFinite(e[3]) ? e[3] : undefined });
    }
  }
}
