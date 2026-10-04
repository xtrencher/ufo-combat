// The inventory screen (E): the player's 36 slots, and in creative mode a
// tabbed palette of every item (weapons first). There is no crafting: what
// you carry comes from the world (loot, supply crates, mining). Items are
// moved with the mouse like in classic voxel games: left click picks up /
// puts down a stack, right click splits or places one, shift-click moves
// between the hotbar and the main area, number keys swap with the hotbar.
// (Round 10) The chest screen is this screen too: the chest's 27 slots
// above the inventory, with the same clicks (shift-click moves between the
// chest and the inventory). Its clicks go through js/chests.js, which online
// asks the host first: until it answers, the screen takes no more clicks.
import { itemInfo, maxStack, CREATIVE_ITEMS, ALL_WEAPONS, itemAllowed, ARMOR_SLOTS } from "./items.js";
import { HOTBAR_SIZE, INVENTORY_SIZE, makeStack, clickSlot, quickMove, addToRange, Inventory } from "./inventory.js";
import { SlotView, stackLabel } from "./slot-view.js";
import { CHEST_SLOTS, sameStack } from "./chests.js";

function el(tag, className, parent) {
  const e = document.createElement(tag);
  if (className) e.className = className;
  if (parent) parent.appendChild(e);
  return e;
}

// Creative palette tabs: name -> predicate on the item id.
const WEAPON_SET = new Set(ALL_WEAPONS);
const TABS = [
  ["Weapons", (id) => WEAPON_SET.has(id) || !!itemInfo(id)?.weapon],
  ["Blocks", (id) => itemInfo(id)?.block !== undefined && !WEAPON_SET.has(id)],
  ["Tools", (id) => !!itemInfo(id)?.tool && !itemInfo(id)?.weapon],
  ["Armor", (id) => !!itemInfo(id)?.armor],
  ["Items", (id) => itemInfo(id)?.block === undefined && !itemInfo(id)?.tool && !itemInfo(id)?.weapon && !itemInfo(id)?.armor && !WEAPON_SET.has(id)],
];

export class InventoryScreen {
  constructor({ icons, inventory, audio }) {
    this.icons = icons;
    this.inventory = inventory;
    this.audio = audio;
    this.onDrop = null; // (stack) => void: throw items out into the world
    this.onChange = null; // () => void: inventory contents changed
    this.chests = null; // the chests (js/chests.js), for the chest screen
    this.chestPos = null; // [x, y, z] of the chest the next open("chest") shows
    this.onCloseRequest = null; // () => void: the chest went (broken): close the screen

    this.root = document.getElementById("inventory-screen");
    this.root.innerHTML = "";
    this.panel = el("div", "inv-panel", this.root);
    this.titleEl = el("div", "inv-title", this.panel);
    const body = el("div", "inv-body", this.panel);
    const left = el("div", "inv-left", body);

    this.tabsEl = el("div", "inv-tabs", left);
    this.paletteEl = el("div", "inv-palette", left);
    this.tabBtns = TABS.map(([name], i) => {
      const b = el("button", "inv-tab", this.tabsEl);
      b.textContent = name;
      b.addEventListener("mousedown", (e) => {
        e.preventDefault();
        e.stopPropagation();
        this.setTab(i);
        if (this.audio) this.audio.playClick();
      });
      return b;
    });

    // (Round 10) The chest's slots (the chest screen only).
    this.chestEl = el("div", "inv-chest hidden", left);
    const chestGrid = el("div", "inv-grid", this.chestEl);
    this.chestViews = [];
    for (let i = 0; i < CHEST_SLOTS; i++) {
      const v = new SlotView(icons);
      chestGrid.appendChild(v.el);
      this._bindSlot(v.el, { area: "chest", index: i });
      this.chestViews.push(v);
    }
    this.chestView = null; // the open chest (js/chests.js openView)
    this.busy = false; // a chest click waiting for the host

    el("div", "inv-label", left).textContent = "Inventory";
    this.mainEl = el("div", "inv-grid", left);
    this.hotbarEl = el("div", "inv-grid inv-hotbar", left);
    // The armor worn: head, chest, legs and feet, in a row under the hotbar.
    const armorRow = (this.armorRow = el("div", "inv-armor", left));
    el("span", "inv-label", armorRow).textContent = "Armor";
    this.armorViews = ARMOR_SLOTS.map((name, i) => {
      const v = new SlotView(icons);
      v.el.title = name[0].toUpperCase() + name.slice(1);
      armorRow.appendChild(v.el);
      this._bindSlot(v.el, { area: "armor", index: i });
      return v;
    });
    this.armorPointsEl = el("span", "inv-label inv-armor-points", armorRow);

    this.invViews = [];
    for (let i = 0; i < INVENTORY_SIZE; i++) {
      const v = new SlotView(icons);
      (i < HOTBAR_SIZE ? this.hotbarEl : this.mainEl).appendChild(v.el);
      this._bindSlot(v.el, { area: "inv", index: i });
      this.invViews.push(v);
    }
    // Main area first (rows 1-3), hotbar last, as in the classic layout.
    this.mainEl.append(...this.invViews.slice(HOTBAR_SIZE).map((v) => v.el));

    this.paletteViews = CREATIVE_ITEMS.map((id, i) => {
      const v = new SlotView(icons);
      v.set(makeStack(id, 1));
      this.paletteEl.appendChild(v.el);
      this._bindSlot(v.el, { area: "palette", index: i });
      return v;
    });

    this.cursorView = new SlotView(icons, "slot cursor-slot");
    this.root.appendChild(this.cursorView.el);
    this.tooltipEl = el("div", "inv-tooltip hidden", this.root);

    this.cursor = null;
    this.kind = null;
    this.creative = false;
    this.hover = null;
    this.tab = 0;

    this.root.addEventListener("mousedown", (e) => {
      if (e.target === this.root) this._dropCursor(e.button === 2);
    });
    this.root.addEventListener("contextmenu", (e) => e.preventDefault());
    this.root.addEventListener("mousemove", (e) => this._moveCursor(e.clientX, e.clientY));
  }

  get isOpen() {
    return this.kind !== null;
  }

  setTab(i) {
    this.tab = i;
    this.tabBtns.forEach((b, k) => b.classList.toggle("active", k === i));
    const pred = TABS[i][1];
    this.paletteViews.forEach((v, k) => {
      const id = CREATIVE_ITEMS[k];
      v.el.classList.toggle("hidden", !itemAllowed(id) || !pred(id));
    });
  }

  // kind: "inventory", or "chest" (the chest at chestPos, above the
  // inventory). In creative the item palette shows (not with a chest).
  open(kind, creative) {
    this.kind = kind || "inventory";
    const chest = this.kind === "chest" && !!this.chests && !!this.chestPos;
    if (this.kind === "chest" && !chest) this.kind = "inventory";
    this.creative = creative;
    const palette = creative && !chest;
    this.tabsEl.classList.toggle("hidden", !palette);
    this.paletteEl.classList.toggle("hidden", !palette);
    this.chestEl.classList.toggle("hidden", !chest);
    this.armorRow.classList.toggle("hidden", chest);
    if (chest) {
      const [x, y, z] = this.chestPos;
      this.chestView = this.chests.openView(x, y, z, () => this._chestUpdated());
    } else if (this.chestView) {
      this.chests.closeView();
      this.chestView = null;
    }
    this._title();
    this.setTab(this.tab);
    this.root.classList.remove("hidden");
    this.refresh();
  }

  // Puts the carried stack back into the inventory (anything that doesn't
  // fit is dropped) and hides the screen.
  close() {
    if (!this.isOpen) return;
    const leftovers = [];
    if (this.cursor) {
      const s = this.cursor;
      const left = this.inventory.add(s.id, s.count, s.dur);
      if (left > 0) leftovers.push({ ...s, count: left });
    }
    this.cursor = null;
    this.kind = null;
    this.hover = null;
    this.root.classList.add("hidden");
    this.tooltipEl.classList.add("hidden");
    if (this.chestView) {
      this.chestView = null;
      this.chests.closeView();
    }
    for (const s of leftovers) if (this.onDrop) this.onDrop(s);
    this._changed();
  }

  _title() {
    const v = this.chestView;
    const text = v ? (v.ready ? "Chest" : "Chest (opening...)") : this.creative ? "Creative Inventory" : "Inventory";
    if (this.titleEl.textContent !== text) this.titleEl.textContent = text;
  }

  // The open chest changed (someone else's click, the host's answer), or is gone.
  _chestUpdated() {
    const v = this.chestView;
    if (!v) return;
    if (v.gone) {
      if (this.onCloseRequest) this.onCloseRequest();
      else this.refresh();
      return;
    }
    this.refresh();
    this._showTooltip();
  }

  _changed() {
    if (this.onChange) this.onChange();
  }

  _bindSlot(elem, ref) {
    elem.addEventListener("mousedown", (e) => {
      e.preventDefault();
      e.stopPropagation();
      this._click(ref, e.button, e.shiftKey);
    });
    elem.addEventListener("mouseenter", () => {
      this.hover = ref;
      this._showTooltip();
    });
    elem.addEventListener("mouseleave", () => {
      if (this.hover === ref) this.hover = null;
      this.tooltipEl.classList.add("hidden");
    });
  }

  _stackAt(ref) {
    if (ref.area === "inv") return this.inventory.slots[ref.index];
    if (ref.area === "armor") return this.inventory.armor[ref.index];
    if (ref.area === "palette") return makeStack(CREATIVE_ITEMS[ref.index], 1);
    if (ref.area === "chest") return this.chestView?.ready ? this.chestView.slots[ref.index] : null;
    return null;
  }

  _showTooltip() {
    const stack = this.hover ? this._stackAt(this.hover) : null;
    const text = stackLabel(stack);
    this.tooltipEl.textContent = text;
    this.tooltipEl.classList.toggle("hidden", !text || !!this.cursor);
  }

  _moveCursor(x, y) {
    this._mx = x;
    this._my = y;
    this.cursorView.el.style.transform = `translate(${x - 20}px, ${y - 20}px)`;
    this.tooltipEl.style.transform = `translate(${x + 16}px, ${y - 30}px)`;
  }

  _click(ref, button, shift) {
    if (button !== 0 && button !== 2) return;
    if (this.busy) return; // (a chest click is still with the host)
    const inv = this.inventory;
    let sound = true;
    if (ref.area === "chest") {
      sound = this._chestClick(ref.index, button, shift);
    } else if (ref.area === "inv" && shift && !this.cursor && this.chestView) {
      sound = this._moveToChest(ref.index);
    } else if (ref.area === "inv") {
      const st = inv.slots[ref.index];
      const slot = st && !this.cursor ? Inventory.armorSlotOf(st.id) : -1;
      if (shift && slot >= 0) {
        // Shift-click armor: onto the body (swapping places with what is worn).
        inv.slots[ref.index] = inv.armor[slot];
        inv.armor[slot] = st;
      } else if (shift && !this.cursor) sound = quickMove(inv, ref.index);
      else this.cursor = clickSlot(inv.slots, ref.index, this.cursor, button);
    } else if (ref.area === "armor") {
      const worn = inv.armor[ref.index];
      if (this.cursor && Inventory.armorSlotOf(this.cursor.id) !== ref.index) {
        sound = false; // only the right piece goes in a slot
      } else if (shift && !this.cursor && worn) {
        const moving = { ...worn };
        if (addToRange(inv.slots, moving, 0, INVENTORY_SIZE)) inv.armor[ref.index] = null;
      } else if (this.cursor) {
        // Put the piece on (the one worn comes into the hand).
        const old = worn;
        inv.armor[ref.index] = { ...this.cursor, count: 1 };
        this.cursor = old;
      } else if (worn) {
        this.cursor = worn;
        inv.armor[ref.index] = null;
      } else sound = false;
    } else if (ref.area === "palette") {
      const id = CREATIVE_ITEMS[ref.index];
      if (this.cursor) this.cursor = null; // dropping onto the palette deletes the stack
      else if (shift) inv.add(id, maxStack(id));
      else this.cursor = makeStack(id, button === 2 ? 1 : maxStack(id));
    }
    if (sound && this.audio) this.audio.playClick();
    this.refresh();
    this._changed();
    this._showTooltip();
  }

  // ---------- The chest ----------

  // Sends a change of the chest's slots ([[slot, before, after], ...]);
  // onOk() makes this player's side of it (the cursor, the inventory) once
  // it is applied. Refused: nothing changes here (the chest shows what it
  // holds now).
  _submit(changes, onOk) {
    this.busy = true;
    this.chests.submit(changes, (ok) => {
      this.busy = false;
      if (ok) onOk();
      this.refresh();
      this._changed();
      this._showTooltip();
    });
  }

  _chestOpen() {
    const v = this.chestView;
    return v && v.ready && !v.gone ? v : null;
  }

  // A click on chest slot i: the inventory's rules, worked out on copies.
  _chestClick(i, button, shift) {
    const v = this._chestOpen();
    if (!v) return false;
    const before = v.slots[i] ? { ...v.slots[i] } : null;
    if (shift) {
      // Into the inventory, as much as fits.
      if (!before || this.cursor) return false;
      const moving = { ...before };
      addToRange(this.inventory.slots.map((s) => (s ? { ...s } : null)), moving, 0, INVENTORY_SIZE);
      if (moving.count === before.count) return false;
      const taken = { ...before, count: before.count - moving.count };
      this._submit([[i, before, moving.count > 0 ? { ...before, count: moving.count } : null]], () => this._give(taken));
      return true;
    }
    const copy = v.slots.map((s) => (s ? { ...s } : null));
    const cursor = clickSlot(copy, i, this.cursor ? { ...this.cursor } : null, button);
    if (sameStack(before, copy[i])) return false;
    this._submit([[i, before, copy[i]]], () => (this.cursor = cursor));
    return true;
  }

  // Shift-click on inventory slot `index` with a chest open: into the chest.
  _moveToChest(index) {
    const v = this._chestOpen();
    const st = this.inventory.slots[index];
    if (!v || !st) return false;
    const copy = v.slots.map((s) => (s ? { ...s } : null));
    const moving = { ...st };
    addToRange(copy, moving, 0, CHEST_SLOTS);
    const moved = st.count - moving.count;
    if (moved <= 0) return false;
    const changes = [];
    for (let i = 0; i < CHEST_SLOTS; i++) if (!sameStack(v.slots[i], copy[i])) changes.push([i, v.slots[i] ? { ...v.slots[i] } : null, copy[i]]);
    const { id, dur } = st;
    this._submit(changes, () => this._take(index, id, dur, moved));
    return true;
  }

  // Into the inventory (what doesn't fit is thrown out).
  _give(stack) {
    const left = { ...stack };
    addToRange(this.inventory.slots, left, 0, INVENTORY_SIZE);
    if (left.count > 0) this.onDrop?.(left);
  }

  // Takes n of item id (with that wear) out of the inventory, slot `index` first.
  _take(index, id, dur, n) {
    const slots = this.inventory.slots;
    for (let k = -1; k < INVENTORY_SIZE && n > 0; k++) {
      const j = k < 0 ? index : k;
      if (k === index) continue;
      const s = slots[j];
      if (!s || s.id !== id || (s.dur ?? -1) !== (dur ?? -1)) continue;
      const t = Math.min(n, s.count);
      s.count -= t;
      n -= t;
      if (s.count <= 0) slots[j] = null;
    }
  }

  // Keys over a chest slot: 1-9 swaps it with that hotbar slot, Q drops from it.
  _chestKey(i, code, ctrl) {
    const v = this._chestOpen();
    if (!v || this.busy) return;
    const before = v.slots[i] ? { ...v.slots[i] } : null;
    const m = /^Digit([1-9])$/.exec(code);
    if (m) {
      const h = Number(m[1]) - 1;
      const sent = this.inventory.slots[h] ? { ...this.inventory.slots[h] } : null;
      if (!before && !sent) return;
      this._submit([[i, before, sent]], () => {
        const slots = this.inventory.slots;
        const cur = slots[h];
        // (picked something up meanwhile into that slot: only what was sent leaves it)
        if (cur && sent && cur.id === sent.id && cur.count > sent.count) {
          cur.count -= sent.count;
          if (before) this._give(before);
        } else slots[h] = before;
      });
    } else if (code === "KeyQ" && before) {
      const n = ctrl ? before.count : 1;
      this._submit([[i, before, before.count > n ? { ...before, count: before.count - n } : null]], () => this.onDrop?.({ ...before, count: n }));
    }
  }

  // Throws the carried stack (or one item of it) out of the screen.
  _dropCursor(one) {
    if (!this.cursor) return;
    let dropped;
    if (one && this.cursor.count > 1) {
      dropped = { ...this.cursor, count: 1 };
      this.cursor.count -= 1;
    } else {
      dropped = this.cursor;
      this.cursor = null;
    }
    if (this.onDrop) this.onDrop(dropped);
    this.refresh();
  }

  // Keyboard while the screen is open: 1-9 swaps the hovered slot with that
  // hotbar slot, Q drops from the hovered slot. Returns true if handled.
  handleKey(code, ctrl) {
    if (this.busy) return /^Digit[1-9]$/.test(code) || code === "KeyQ";
    if (this.hover && this.hover.area === "chest" && (/^Digit[1-9]$/.test(code) || code === "KeyQ")) {
      this._chestKey(this.hover.index, code, ctrl);
      return true;
    }
    const m = /^Digit([1-9])$/.exec(code);
    if (m && this.hover && this.hover.area === "inv") {
      const h = Number(m[1]) - 1;
      const i = this.hover.index;
      if (i === h) return true;
      const slots = this.inventory.slots;
      const tmp = slots[h];
      slots[h] = slots[i];
      slots[i] = tmp;
      this.refresh();
      this._changed();
      return true;
    }
    if (m && this.hover && this.hover.area === "palette") {
      const id = CREATIVE_ITEMS[this.hover.index];
      this.inventory.slots[Number(m[1]) - 1] = makeStack(id, maxStack(id));
      this.refresh();
      this._changed();
      return true;
    }
    if (code === "KeyQ" && this.hover && this.hover.area === "inv") {
      const s = this.inventory.takeFromSlot(this.hover.index, ctrl ? 64 : 1);
      if (s && this.onDrop) this.onDrop(s);
      this.refresh();
      this._changed();
      return true;
    }
    return false;
  }

  refresh() {
    if (!this.isOpen) return;
    for (let i = 0; i < INVENTORY_SIZE; i++) this.invViews[i].set(this.inventory.slots[i]);
    const cv = this.chestView;
    if (cv) {
      for (let i = 0; i < CHEST_SLOTS; i++) this.chestViews[i].set(cv.ready && !cv.gone ? cv.slots[i] : null);
      this._title();
    }
    this.armorViews.forEach((v, i) => v.set(this.inventory.armor[i]));
    const pts = this.inventory.armorPoints();
    const text = pts > 0 ? `${pts} defense (${Math.round(this.inventory.armorReduction() * 100)}% less damage)` : "no armor";
    // (Every frame while open: the DOM only when something changed.)
    if (text !== this._armorText) this.armorPointsEl.textContent = this._armorText = text;
    this.cursorView.set(this.cursor);
    if (!this.cursor !== this._cursorHidden) this.cursorView.el.classList.toggle("hidden", (this._cursorHidden = !this.cursor));
  }
}
