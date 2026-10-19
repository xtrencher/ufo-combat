// Inventory model and slot interactions (pure logic, no DOM or three.js).
//
// A stack is { id, count } plus `dur` (remaining uses) for tools, and
// (Round 11) `tag` for what the anvil and the enchanting table add: { ench:
// [[key, level], ...], name (a custom name), rc (the anvil's prior-work
// penalty) } (js/enchant.js; never changed in place, so copies may share it).
// Stacks with different tags don't merge. The player's inventory has 36
// slots: 0-8 are the hotbar, 9-35 the main area.
// UI screens hold one "cursor" stack (what the mouse is carrying) and call
// clickSlot()/quickMove() on arrays of slots (a crafting grid's, a furnace's).
import { maxStack, itemInfo, ARMOR_SLOTS, ARMOR_REDUCTION_PER_POINT } from "./items.js";
import { cleanTag, sameTag, unbreakingSaves } from "./enchant.js";
import { isVanilla } from "./worldtype.js";

export const HOTBAR_SIZE = 9;
export const INVENTORY_SIZE = 36;

export function makeStack(id, count = 1, dur, tag) {
  const stack = { id, count };
  const info = itemInfo(id);
  const wear = info?.tool || info?.armor;
  if (wear) stack.dur = dur ?? wear.durability;
  if (tag) stack.tag = tag;
  return stack;
}

export function canMerge(a, b) {
  return !!a && !!b && a.id === b.id && maxStack(a.id) > 1 && sameTag(a.tag, b.tag);
}

// (Round 11) A stack as saved and sent: [id, count], [id, count, dur], or
// with a tag [id, count, dur (0: none), tag] (older games read the first
// three and drop the tag); 0 for an empty slot.
export function encodeStack(s) {
  if (!s) return 0;
  if (s.tag) return [s.id, s.count, s.dur ?? 0, s.tag];
  return s.dur !== undefined ? [s.id, s.count, s.dur] : [s.id, s.count];
}

// The stack back (checked: a real item, a sane count, wear and tag), or null.
export function decodeStack(e) {
  if (!Array.isArray(e)) return null;
  const [id, count, dur, tag] = e;
  if (!Number.isInteger(id) || !itemInfo(id) || !Number.isInteger(count) || count < 1 || count > maxStack(id)) return null;
  return makeStack(id, count, Number.isInteger(dur) && dur > 0 ? dur : undefined, cleanTag(tag));
}

export function sameStack(a, b) {
  if (!a || !b) return !a && !b;
  return a.id === b.id && a.count === b.count && (a.dur ?? -1) === (b.dur ?? -1) && sameTag(a.tag, b.tag);
}

// Moves as much of `stack` as fits into slots[from..to) (merging into
// matching stacks first, then empty slots). Mutates `stack.count`; returns
// true if it was fully moved.
export function addToRange(slots, stack, from, to) {
  const limit = maxStack(stack.id);
  if (limit > 1) {
    for (let i = from; i < to && stack.count > 0; i++) {
      const s = slots[i];
      if (canMerge(s, stack) && s.count < limit) {
        const n = Math.min(stack.count, limit - s.count);
        s.count += n;
        stack.count -= n;
      }
    }
  }
  for (let i = from; i < to && stack.count > 0; i++) {
    if (slots[i]) continue;
    const n = Math.min(stack.count, limit);
    slots[i] = { ...stack, count: n };
    stack.count -= n;
  }
  return stack.count === 0;
}

// (Round 11) Vanilla's shift-click orders through the 36 slots: into the
// inventory from a crafting result, a furnace's output, a chest, a brewing
// stand or the enchanting table, the hotbar's right end first, then the main
// area from its bottom right (ORDER_RESULT); from a crafting grid, a furnace's
// input and fuel or the anvil, the main area from its top left, then the
// hotbar (ORDER_CONTAINER).
export const ORDER_RESULT = [];
for (let i = HOTBAR_SIZE - 1; i >= 0; i--) ORDER_RESULT.push(i);
for (let i = INVENTORY_SIZE - 1; i >= HOTBAR_SIZE; i--) ORDER_RESULT.push(i);
export const ORDER_CONTAINER = [];
for (let i = HOTBAR_SIZE; i < INVENTORY_SIZE; i++) ORDER_CONTAINER.push(i);
for (let i = 0; i < HOTBAR_SIZE; i++) ORDER_CONTAINER.push(i);

// Like addToRange, through the slots in `order` (merging into matching stacks
// first, then empty slots). Mutates `stack.count`; true if all of it moved.
export function addInOrder(slots, stack, order) {
  const limit = maxStack(stack.id);
  if (limit > 1) {
    for (let k = 0; k < order.length && stack.count > 0; k++) {
      const s = slots[order[k]];
      if (canMerge(s, stack) && s.count < limit) {
        const n = Math.min(stack.count, limit - s.count);
        s.count += n;
        stack.count -= n;
      }
    }
  }
  for (let k = 0; k < order.length && stack.count > 0; k++) {
    const i = order[k];
    if (slots[i]) continue;
    const n = Math.min(stack.count, limit);
    slots[i] = { ...stack, count: n };
    stack.count -= n;
  }
  return stack.count === 0;
}

// Of `amount` points of wear, the ones Unbreaking doesn't skip.
function wearPoints(stack, amount, armor) {
  if (!stack.tag?.ench) return amount;
  let n = 0;
  for (let k = 0; k < amount; k++) if (!unbreakingSaves(stack, armor)) n++;
  return n;
}

export class Inventory {
  constructor() {
    this.slots = new Array(INVENTORY_SIZE).fill(null);
    this.selected = 0;
    // The armor worn: one piece per slot (head, chest, legs, feet), or null.
    this.armor = new Array(ARMOR_SLOTS.length).fill(null);
    // The off hand (a Survival world: vanilla's, the shield's), or null.
    this.offhand = null;
  }

  // Swaps the selected hotbar stack with the off hand (vanilla's F).
  // Returns true if anything moved.
  swapOffhand() {
    const s = this.slots[this.selected];
    if (!s && !this.offhand) return false;
    this.slots[this.selected] = this.offhand;
    this.offhand = s;
    return true;
  }

  // Wears the off-hand item (the shield); returns true if it broke.
  damageOffhand(amount = 1) {
    const s = this.offhand;
    if (!s || s.dur === undefined) return false;
    s.dur -= wearPoints(s, amount, false);
    if (s.dur <= 0) {
      this.offhand = null;
      return true;
    }
    return false;
  }

  // The armor slot an item goes in (0-3), or -1 if it is not armor.
  static armorSlotOf(id) {
    const a = itemInfo(id)?.armor;
    return a ? a.slot : -1;
  }

  // Wears the selected hotbar item (armor), swapping with the piece in that
  // slot. Returns true if it moved.
  equipSelectedArmor() {
    const s = this.selectedStack;
    const slot = s ? Inventory.armorSlotOf(s.id) : -1;
    if (slot < 0) return false;
    this.slots[this.selected] = this.armor[slot];
    this.armor[slot] = s;
    return true;
  }

  // The defense points of everything worn.
  armorPoints() {
    let n = 0;
    for (const s of this.armor) if (s) n += itemInfo(s.id)?.armor?.points ?? 0;
    return n;
  }

  // The share of damage the armor worn turns away (0-0.8).
  armorReduction() {
    return Math.min(0.8, this.armorPoints() * ARMOR_REDUCTION_PER_POINT);
  }

  // Every worn piece but an elytra wears by `amount` (at least 1); returns the
  // names of the pieces that broke. (Unbreaking: some of the points are skipped.)
  damageArmor(amount = 1) {
    const broken = [];
    for (let i = 0; i < this.armor.length; i++) {
      const s = this.armor[i];
      if (!s || s.dur === undefined) continue;
      // (an elytra isn't armour to a hit, as vanilla's: it wears only in flight)
      if (itemInfo(s.id)?.elytra) continue;
      s.dur -= wearPoints(s, Math.max(1, Math.round(amount)), true);
      if (s.dur <= 0) {
        broken.push(itemInfo(s.id)?.name ?? "armor");
        this.armor[i] = null;
      }
    }
    return broken;
  }

  get selectedStack() {
    return this.slots[this.selected];
  }

  // Whether add() puts item `id` on at once: armor with its slot free (a
  // Missions-world convenience; in a Survival world it goes into the
  // inventory, as vanilla).
  wouldWear(id) {
    const aslot = isVanilla() ? -1 : Inventory.armorSlotOf(id);
    return aslot >= 0 && !this.armor[aslot];
  }

  // Adds items (hotbar first, then the main area). Returns the count that
  // didn't fit. (tag: the stack's enchantments and name, js/enchant.js.)
  add(id, count = 1, dur, tag) {
    if (count <= 0 || !itemInfo(id)) return count;
    // A piece of armor picked up with its slot free is put on at once.
    if (this.wouldWear(id)) {
      const aslot = Inventory.armorSlotOf(id);
      this.armor[aslot] = makeStack(id, 1, dur, tag);
      this.justWorn = id;
      if (count <= 1) return 0;
      count -= 1;
      dur = undefined;
      tag = undefined;
    }
    const stack = makeStack(id, count, dur, tag);
    // Merge into any existing stacks first, then fill empty slots.
    const limit = maxStack(id);
    if (limit > 1) {
      for (let i = 0; i < INVENTORY_SIZE && stack.count > 0; i++) {
        const s = this.slots[i];
        if (canMerge(s, stack) && s.count < limit) {
          const n = Math.min(stack.count, limit - s.count);
          s.count += n;
          stack.count -= n;
        }
      }
    }
    addToRange(this.slots, stack, 0, INVENTORY_SIZE);
    return stack.count;
  }

  // Whether `count` of item `id` would fit completely.
  canFit(id, count = 1, tag) {
    const limit = maxStack(id);
    let room = 0;
    for (const s of this.slots) {
      if (!s) room += limit;
      else if (s.id === id && limit > 1 && sameTag(s.tag, tag)) room += limit - s.count;
      if (room >= count) return true;
    }
    return false;
  }

  countItem(id) {
    let n = 0;
    for (const s of this.slots) if (s && s.id === id) n += s.count;
    for (const a of this.armor) if (a && a.id === id) n += a.count;
    if (this.offhand && this.offhand.id === id) n += this.offhand.count;
    return n;
  }

  // Removes up to n items from slot i; returns the removed stack (or null).
  takeFromSlot(i, n = 1) {
    const s = this.slots[i];
    if (!s) return null;
    const k = Math.min(n, s.count);
    s.count -= k;
    if (s.count <= 0) this.slots[i] = null;
    return { ...s, count: k };
  }

  consumeSelected(n = 1) {
    return this.takeFromSlot(this.selected, n);
  }

  // Wears the selected tool; returns true if it broke. (Unbreaking: some of
  // the points are skipped.)
  damageSelected(amount = 1) {
    const s = this.selectedStack;
    if (!s || s.dur === undefined) return false;
    s.dur -= wearPoints(s, amount, false);
    if (s.dur <= 0) {
      this.slots[this.selected] = null;
      return true;
    }
    return false;
  }

  isEmpty() {
    return this.slots.every((s) => !s) && this.armor.every((a) => !a) && !this.offhand;
  }

  clear() {
    this.slots.fill(null);
    this.armor.fill(null);
    this.offhand = null;
  }

  // The armor worn, for the save: per slot [id, count, dur(, tag)] or 0;
  // the off hand's stack after them when it holds one (older games read
  // only the four armor slots).
  serializeArmor() {
    const out = this.armor.map((s) => (s ? (s.tag ? [s.id, s.count, s.dur ?? 0, s.tag] : [s.id, s.count, s.dur]) : 0));
    if (this.offhand) out.push(encodeStack(this.offhand));
    return out;
  }

  // Loads the armor worn and the off hand (an old save has none).
  loadArmor(data) {
    this.armor.fill(null);
    this.offhand = null;
    if (!Array.isArray(data)) return;
    if (data.length > this.armor.length) this.offhand = decodeStack(data[this.armor.length]);
    for (let i = 0; i < Math.min(data.length, this.armor.length); i++) {
      const e = data[i];
      if (!Array.isArray(e)) continue;
      const [id, count, dur, tag] = e;
      if (!Number.isInteger(id) || Inventory.armorSlotOf(id) !== i) continue;
      this.armor[i] = makeStack(id, 1, Number.isInteger(dur) && dur > 0 ? dur : undefined, cleanTag(tag));
    }
  }

  serialize() {
    return this.slots.map(encodeStack);
  }

  load(data) {
    this.clear();
    if (!Array.isArray(data)) return;
    for (let i = 0; i < Math.min(data.length, INVENTORY_SIZE); i++) {
      const e = data[i];
      if (!Array.isArray(e)) continue;
      const [id, count, dur, tag] = e;
      if (!Number.isInteger(id) || !itemInfo(id) || !Number.isInteger(count) || count <= 0) continue;
      const stack = makeStack(id, Math.min(count, maxStack(id)), Number.isInteger(dur) && dur > 0 ? dur : undefined, cleanTag(tag));
      this.slots[i] = stack;
    }
  }
}

// Mouse click on slots[i] while carrying `cursor` (a stack or null).
// button 0 = left, 2 = right. Returns the new cursor. Mutates slots.
export function clickSlot(slots, i, cursor, button) {
  const slot = slots[i];
  if (button === 2) {
    if (!cursor) {
      if (!slot) return null;
      // Pick up half (rounded up).
      const half = Math.ceil(slot.count / 2);
      slot.count -= half;
      if (slot.count <= 0) slots[i] = null;
      return { ...slot, count: half };
    }
    if (!slot) {
      slots[i] = { ...cursor, count: 1 };
      cursor.count -= 1;
      return cursor.count > 0 ? cursor : null;
    }
    if (canMerge(slot, cursor) && slot.count < maxStack(slot.id)) {
      slot.count += 1;
      cursor.count -= 1;
      return cursor.count > 0 ? cursor : null;
    }
    slots[i] = cursor;
    return slot;
  }
  // Left click.
  if (!cursor) {
    slots[i] = null;
    return slot;
  }
  if (!slot) {
    slots[i] = cursor;
    return null;
  }
  if (canMerge(slot, cursor)) {
    const n = Math.min(cursor.count, maxStack(slot.id) - slot.count);
    slot.count += n;
    cursor.count -= n;
    return cursor.count > 0 ? cursor : null;
  }
  slots[i] = cursor;
  return slot;
}

// Shift-click on inventory slot i: moves the stack between the hotbar and
// the main area. Returns true if anything moved.
export function quickMove(inventory, i) {
  const slots = inventory.slots;
  const stack = slots[i];
  if (!stack) return false;
  const before = stack.count;
  const moving = { ...stack };
  if (i < HOTBAR_SIZE) addToRange(slots, moving, HOTBAR_SIZE, INVENTORY_SIZE);
  else addToRange(slots, moving, 0, HOTBAR_SIZE);
  if (moving.count === 0) slots[i] = null;
  else stack.count = moving.count;
  return moving.count !== before;
}
