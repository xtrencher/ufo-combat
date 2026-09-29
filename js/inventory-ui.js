// The inventory screen (E): the player's 36 slots, and in creative mode a
// tabbed palette of every item (weapons first). There is no crafting: what
// you carry comes from the world (loot, supply crates, mining). Items are
// moved with the mouse like in classic voxel games: left click picks up /
// puts down a stack, right click splits or places one, shift-click moves
// between the hotbar and the main area, number keys swap with the hotbar.
import { itemInfo, maxStack, CREATIVE_ITEMS, ALL_WEAPONS, itemAllowed } from "./items.js";
import { HOTBAR_SIZE, INVENTORY_SIZE, makeStack, clickSlot, quickMove } from "./inventory.js";
import { SlotView, stackLabel } from "./slot-view.js";

function el(tag, className, parent) {
  const e = document.createElement(tag);
  if (className) e.className = className;
  if (parent) parent.appendChild(e);
  return e;
}

// Creative palette tabs: name -> predicate on the item id.
const WEAPON_SET = new Set(ALL_WEAPONS);
const TABS = [
  ["Weapons", (id) => WEAPON_SET.has(id)],
  ["Blocks", (id) => itemInfo(id)?.block !== undefined && !WEAPON_SET.has(id)],
  ["Tools", (id) => !!itemInfo(id)?.tool],
  ["Items", (id) => itemInfo(id)?.block === undefined && !itemInfo(id)?.tool && !WEAPON_SET.has(id)],
];

export class InventoryScreen {
  constructor({ icons, inventory, audio }) {
    this.icons = icons;
    this.inventory = inventory;
    this.audio = audio;
    this.onDrop = null; // (stack) => void: throw items out into the world
    this.onChange = null; // () => void: inventory contents changed

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

    el("div", "inv-label", left).textContent = "Inventory";
    this.mainEl = el("div", "inv-grid", left);
    this.hotbarEl = el("div", "inv-grid inv-hotbar", left);

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

  // kind: "inventory" (the only kind now). In creative the item palette shows.
  open(kind, creative) {
    this.kind = kind || "inventory";
    this.creative = creative;
    this.titleEl.textContent = creative ? "Creative Inventory" : "Inventory";
    this.tabsEl.classList.toggle("hidden", !creative);
    this.paletteEl.classList.toggle("hidden", !creative);
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
    for (const s of leftovers) if (this.onDrop) this.onDrop(s);
    this._changed();
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
    if (ref.area === "palette") return makeStack(CREATIVE_ITEMS[ref.index], 1);
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
    const inv = this.inventory;
    let sound = true;
    if (ref.area === "inv") {
      if (shift && !this.cursor) sound = quickMove(inv, ref.index);
      else this.cursor = clickSlot(inv.slots, ref.index, this.cursor, button);
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
    this.cursorView.set(this.cursor);
    this.cursorView.el.classList.toggle("hidden", !this.cursor);
  }
}
