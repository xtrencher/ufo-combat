// The inventory screen (E): the player's 36 slots, and in creative mode a
// tabbed palette of every item (weapons first). Items are moved with the
// mouse like in classic voxel games: left click picks up / puts down a stack,
// right click splits or places one, shift-click moves between the hotbar and
// the main area, number keys swap with the hotbar.
// (Round 10) The chest screen is this screen too: the chest's 27 slots
// above the inventory, with the same clicks (shift-click moves between the
// chest and the inventory). Its clicks go through js/chests.js, which online
// asks the host first: until it answers, the screen takes no more clicks.
// (Round 11) In a Survival world the inventory has vanilla's 2x2 crafting
// grid and its result (not in Creative, as in vanilla), and the crafting
// table's screen ("table") the 3x3 one; the recipes are js/crafting.js's.
// What is left in a grid goes back into the inventory when the screen closes.
// A Missions world keeps its loot economy: no grid. The furnace's screen
// ("furnace": input, fuel, output, the flame and the arrow) works like the
// chest's, through js/furnace.js (online: the host's).
// (Round 11, magic) The enchanting table ("enchanting": the item, the lapis,
// three offers from js/enchant.js by the bookshelves around), the anvil
// ("anvil": two inputs, a name box, the result and its cost in levels; the
// anvil may wear when used) and the brewing stand ("brewing": three bottles
// under the ingredient, its bubbling arrow; js/brewing.js, online the
// host's, like the furnace). The table's and the anvil's slots are this
// screen's own, like the crafting grid (given back when it closes).
import { BLOCK } from "./blocks.js";
import { itemInfo, maxStack, CREATIVE_ITEMS, ALL_WEAPONS, itemAllowed, ARMOR_SLOTS } from "./items.js";
import { HOTBAR_SIZE, INVENTORY_SIZE, makeStack, clickSlot, quickMove, addToRange, addInOrder, canMerge, ORDER_RESULT, ORDER_CONTAINER, Inventory } from "./inventory.js";
import { SlotView, stackLines, stackName } from "./slot-view.js";
import { CHEST_SLOTS } from "./chests.js";
import { sameStack } from "./inventory.js";
import { craftResult, gridIds, consumeGrid, smeltingOf, isFuel } from "./crafting.js";
import { FURNACE_SLOTS, furnaceAccepts } from "./furnace.js";
import { isVanilla } from "./worldtype.js";
import { tableOffers, applyOffer, countBookshelves, enchantSeed, nextEnchantSeed, anvilResult, enchantName } from "./enchant.js";
import { BREWING_SLOTS, BREW_TICKS, brewingAccepts, isBottle, isIngredient } from "./brewing.js";
import { spendLevels } from "./xp.js";
import { ENCHANTING_TABLE, LAPIS_LAZULI } from "./content/ids.js";
import { isAnvil, wornAnvil } from "./content/containers.js";

function el(tag, className, parent) {
  const e = document.createElement(tag);
  if (className) e.className = className;
  if (parent) parent.appendChild(e);
  return e;
}

// (Round 11) The crafting and furnace parts' layout (index.html styles the
// slots themselves).
const CRAFT_CSS = `
.inv-craftbox { display: flex; flex-direction: column; align-items: flex-end; margin: 0 0 10px; }
.inv-craftbox.wide { align-items: center; }
.inv-craft { display: flex; align-items: center; gap: 12px; }
.craft-grid { display: grid; gap: 2px; }
.craft-arrow { font-size: 24px; line-height: 1; opacity: 0.6; }
.inv-furnace { display: flex; align-items: center; justify-content: center; gap: 18px; margin: 0 0 12px; }
.furnace-col { display: flex; flex-direction: column; align-items: center; gap: 5px; }
.furnace-flame, .furnace-arrow { position: relative; background: rgba(140,140,150,0.35); overflow: hidden; }
.furnace-flame { width: 20px; height: 22px; clip-path: polygon(50% 0, 80% 34%, 100% 66%, 86% 100%, 14% 100%, 0 66%, 20% 34%); }
.furnace-flame > div { position: absolute; left: 0; right: 0; bottom: 0; height: 0; background: linear-gradient(#ffe066, #ff7a1a 70%, #e0440e); }
.furnace-arrow { width: 44px; height: 22px; clip-path: polygon(0 34%, 62% 34%, 62% 4%, 100% 50%, 62% 96%, 62% 66%, 0 66%); }
.furnace-arrow > div { position: absolute; left: 0; top: 0; bottom: 0; width: 0; background: #f4f4f4; }
.inv-tooltip .tt { white-space: nowrap; }
.inv-tooltip .tt-ench, .inv-tooltip .tt-note { color: #b4b4b4; }
.inv-tooltip .tt-ench-name { color: #6ff3f3; }
.inv-tooltip .tt-good { color: #7a8cff; }
.inv-tooltip .tt-bad { color: #ff6a6a; }
.inv-magic { display: flex; align-items: center; justify-content: center; gap: 14px; margin: 0 0 12px; }
.ench-slots { display: flex; gap: 6px; }
.ench-offers { display: flex; flex-direction: column; gap: 4px; }
.ench-offer { width: 236px; height: 30px; box-sizing: border-box; display: flex; align-items: center; justify-content: space-between; padding: 0 8px; font: inherit; font-size: 12px; background: #8b6fb0; color: #f2ecff; border: 2px solid; border-color: #c9b7e8 #3e2a5c #3e2a5c #c9b7e8; cursor: pointer; text-align: left; }
.ench-offer.off { background: #7a7a7a; color: #c8c8c8; border-color: #a0a0a0 #505050 #505050 #a0a0a0; cursor: default; }
.ench-offer.none { visibility: hidden; }
.ench-offer b { color: #9cff6a; font-size: 13px; }
.ench-offer.off b { color: #3d6b2a; }
.ench-level { font-size: 12px; text-align: center; margin-top: 4px; }
.anvil-row { display: flex; align-items: center; gap: 8px; }
.anvil-col { display: flex; flex-direction: column; align-items: center; gap: 6px; }
.anvil-name { width: 180px; font: inherit; font-size: 13px; padding: 3px 6px; background: #1e1e1e; color: #fff; border: 2px solid #555; }
.anvil-cost { font-size: 12px; min-height: 15px; color: #3a7a1a; font-weight: 600; }
.anvil-cost.bad { color: #c03030; }
.brew-box { display: flex; flex-direction: column; align-items: center; gap: 4px; }
.brew-bottles { display: flex; gap: 10px; }
.brew-arrow { position: relative; width: 12px; height: 26px; background: rgba(140,140,150,0.35); overflow: hidden; clip-path: polygon(30% 0, 70% 0, 70% 62%, 100% 62%, 50% 100%, 0 62%, 30% 62%); }
.brew-arrow > div { position: absolute; left: 0; right: 0; top: 0; height: 0; background: #f4f4f4; }
.brew-bubbles { width: 14px; height: 26px; position: relative; overflow: hidden; }
.brew-bubbles > div { position: absolute; left: 0; right: 0; bottom: 0; height: 0; background: radial-gradient(circle at 30% 70%, #fff 0 2px, transparent 3px), radial-gradient(circle at 70% 40%, #fff 0 2px, transparent 3px), radial-gradient(circle at 40% 15%, #fff 0 1.5px, transparent 2.5px); }
`;
function injectCraftCss() {
  if (typeof document === "undefined" || document.getElementById("inv-craft-css")) return;
  const s = document.createElement("style");
  s.id = "inv-craft-css";
  s.textContent = CRAFT_CSS;
  document.head.appendChild(s);
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

const copyStack = (s) => (s ? { ...s } : null);
const copySlots = (slots) => slots.map(copyStack);

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
    // (Round 11)
    this.furnaces = null; // the furnaces (js/furnace.js), for the furnace screen
    this.screenPos = null; // [x, y, z] of the table or furnace the next open("table" / "furnace") shows
    this.world = null; // (to see that the table is still there; else the chests' world)
    // (Round 11, magic)
    this.brewing = null; // the brewing stands (js/brewing.js), for the brewing screen
    this.player = null; // (the levels the table and the anvil cost: player.xpLevel)

    injectCraftCss();
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
    this.busy = false; // a chest (or furnace) click waiting for the host

    // (Round 11) The crafting grid (2x2 or 3x3) and its result.
    this.craftBox = el("div", "inv-craftbox hidden", left);
    this.craftLabel = el("div", "inv-label", this.craftBox);
    this.craftLabel.textContent = "Crafting";
    const craftRow = el("div", "inv-craft", this.craftBox);
    this.craftGridEl = el("div", "craft-grid", craftRow);
    this.gridViews = [];
    for (let i = 0; i < 9; i++) {
      const v = new SlotView(icons);
      this.craftGridEl.appendChild(v.el);
      this._bindSlot(v.el, { area: "craft", index: i });
      this.gridViews.push(v);
    }
    el("div", "craft-arrow", craftRow).textContent = "➜";
    this.resultView = new SlotView(icons, "slot result-slot");
    craftRow.appendChild(this.resultView.el);
    this._bindSlot(this.resultView.el, { area: "result", index: 0 });
    this.grid = []; // the grid's stacks (row-major), gridWidth x gridWidth
    this.gridWidth = 0; // 0: no grid on this screen
    this._result = null; // the grid's result { id, count } (null: none)
    this._resultStack = null;
    this._gridDirty = true;
    this._ids = [];

    // (Round 11) The furnace: input over the flame over the fuel, the arrow, the output.
    this.furnaceEl = el("div", "inv-furnace hidden", left);
    const fcol = el("div", "furnace-col", this.furnaceEl);
    this.furnaceViews = [];
    const fslot = (parent, i) => {
      const v = new SlotView(icons, i === 2 ? "slot result-slot" : "slot");
      parent.appendChild(v.el);
      this._bindSlot(v.el, { area: "furnace", index: i });
      this.furnaceViews[i] = v;
    };
    fslot(fcol, 0);
    this.flameFill = el("div", "", el("div", "furnace-flame", fcol));
    fslot(fcol, 1);
    this.arrowFill = el("div", "", el("div", "furnace-arrow", this.furnaceEl));
    fslot(this.furnaceEl, 2);
    this.furnaceView = null; // the open furnace (js/furnace.js openView)
    this._flame = -1;
    this._arrow = -1;

    // (Round 11) The enchanting table: the item and the lapis, the three offers.
    this.enchEl = el("div", "inv-magic hidden", left);
    const ecol = el("div", "anvil-col", this.enchEl);
    const eslots = el("div", "ench-slots", ecol);
    this.enchSlots = [null, null];
    this.enchViews = [0, 1].map((i) => {
      const v = new SlotView(icons);
      v.el.title = i ? "Lapis Lazuli" : "Item to enchant";
      eslots.appendChild(v.el);
      this._bindSlot(v.el, { area: "ench", index: i });
      return v;
    });
    this.enchLevelEl = el("div", "ench-level", ecol);
    const offersEl = el("div", "ench-offers", this.enchEl);
    this.offerEls = [0, 1, 2].map((i) => {
      const b = el("button", "ench-offer none", offersEl);
      b.append(el("span", "", null), el("b", "", null));
      b.addEventListener("mousedown", (e) => {
        e.preventDefault();
        e.stopPropagation();
        this._enchant(i);
      });
      return b;
    });
    this._offers = null;
    this._offersFor = null;
    this._shelves = 0;

    // (Round 11) The anvil: two inputs, the name, the result and its cost.
    this.anvilEl = el("div", "inv-magic hidden", left);
    const acol = el("div", "anvil-col", this.anvilEl);
    this.anvilName = el("input", "anvil-name", acol);
    this.anvilName.type = "text";
    this.anvilName.maxLength = 50;
    this.anvilName.placeholder = "Name";
    // (Typing here is text, not the game's keys: E, Q, digits.)
    this.anvilName.addEventListener("keydown", (e) => {
      e.stopPropagation();
      if (e.code === "Escape" || e.code === "Enter") this.anvilName.blur();
    });
    this.anvilName.addEventListener("keyup", (e) => e.stopPropagation());
    this.anvilName.addEventListener("mousedown", (e) => e.stopPropagation());
    this.anvilName.addEventListener("input", () => {
      this._anvilDirty = true;
      this.refresh();
    });
    const arow = el("div", "anvil-row", acol);
    this.anvilSlots = [null, null];
    this.anvilViews = [0, 1].map((i) => {
      const v = new SlotView(icons);
      arow.appendChild(v.el);
      this._bindSlot(v.el, { area: "anvil", index: i });
      if (!i) el("div", "craft-arrow", arow).textContent = "+";
      return v;
    });
    el("div", "craft-arrow", arow).textContent = "➜";
    this.anvilOutView = new SlotView(icons, "slot result-slot");
    arow.appendChild(this.anvilOutView.el);
    this._bindSlot(this.anvilOutView.el, { area: "anvilOut", index: 0 });
    this.anvilCostEl = el("div", "anvil-cost", acol);
    this._anvil = null; // anvilResult of the inputs (worked out again when they change)
    this._anvilDirty = true;

    // (Round 11) The brewing stand: the ingredient over the arrow over three bottles.
    this.brewEl = el("div", "inv-magic hidden", left);
    const bbox = el("div", "brew-box", this.brewEl);
    this.brewViews = [];
    const bslot = (parent, i) => {
      const v = new SlotView(icons);
      parent.appendChild(v.el);
      this._bindSlot(v.el, { area: "brew", index: i });
      this.brewViews[i] = v;
    };
    const brow = el("div", "anvil-row", bbox);
    this.bubbleFill = el("div", "", el("div", "brew-bubbles", brow));
    bslot(brow, 3);
    this.brewArrowFill = el("div", "", el("div", "brew-arrow", brow));
    const bottles = el("div", "brew-bottles", bbox);
    for (let i = 0; i < 3; i++) bslot(bottles, i);
    this.brewView = null; // the open stand (js/brewing.js openView)
    this._brewArrow = -1;

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

  // kind: "inventory", "chest" (the chest at chestPos, above the inventory),
  // "table" (the crafting table at screenPos: the 3x3 grid) or "furnace" (the
  // furnace at screenPos). In creative the item palette shows (on the
  // inventory only); in a Survival world's survival the inventory has the
  // 2x2 grid. (Opened again while open, e.g. the mode switched: a grid that
  // stays keeps what is in it.)
  open(kind, creative) {
    this.kind = kind || "inventory";
    const chest = this.kind === "chest" && !!this.chests && !!this.chestPos;
    const table = this.kind === "table" && !!this.screenPos;
    const furnace = this.kind === "furnace" && !!this.furnaces && !!this.screenPos;
    const enchanting = this.kind === "enchanting" && !!this.screenPos;
    const anvil = this.kind === "anvil" && !!this.screenPos;
    const brewing = this.kind === "brewing" && !!this.brewing && !!this.screenPos;
    if ((this.kind === "chest" && !chest) || (this.kind === "table" && !table) || (this.kind === "furnace" && !furnace) || (this.kind === "enchanting" && !enchanting) || (this.kind === "anvil" && !anvil) || (this.kind === "brewing" && !brewing)) this.kind = "inventory";
    this.creative = creative;
    const palette = creative && this.kind === "inventory";
    const width = table ? 3 : this.kind === "inventory" && !creative && isVanilla() ? 2 : 0;
    if (width !== this.gridWidth) {
      this._returnGrid();
      this.gridWidth = width;
      this.grid = new Array(width * width).fill(null);
      this._gridDirty = true;
    }
    this.tabsEl.classList.toggle("hidden", !palette);
    this.paletteEl.classList.toggle("hidden", !palette);
    this.chestEl.classList.toggle("hidden", !chest);
    this.armorRow.classList.toggle("hidden", this.kind !== "inventory");
    this.craftBox.classList.toggle("hidden", !width);
    this.craftBox.classList.toggle("wide", width === 3);
    this.craftLabel.classList.toggle("hidden", width === 3);
    this.furnaceEl.classList.toggle("hidden", !furnace);
    this.enchEl.classList.toggle("hidden", !enchanting);
    this.anvilEl.classList.toggle("hidden", !anvil);
    this.brewEl.classList.toggle("hidden", !brewing);
    if (!enchanting) this._returnLocal(this.enchSlots);
    if (!anvil) this._returnLocal(this.anvilSlots);
    if (enchanting) {
      const world = this.world || this.chests?.world;
      const [x, y, z] = this.screenPos;
      this._shelves = world ? countBookshelves(world, x, y, z) : 0;
      this._offersFor = null;
    }
    if (anvil) {
      this.anvilName.value = this.anvilSlots[0] ? stackName(this.anvilSlots[0]) : "";
      this._anvilDirty = true;
    }
    if (width) {
      this.craftGridEl.style.gridTemplateColumns = `repeat(${width}, 38px)`;
      this.gridViews.forEach((v, i) => v.el.classList.toggle("hidden", i >= width * width));
    }
    if (chest) {
      const [x, y, z] = this.chestPos;
      this.chestView = this.chests.openView(x, y, z, () => this._containerUpdated());
    } else if (this.chestView) {
      this.chests.closeView();
      this.chestView = null;
    }
    if (furnace) {
      const [x, y, z] = this.screenPos;
      this.furnaceView = this.furnaces.openView(x, y, z, () => this._containerUpdated());
    } else if (this.furnaceView) {
      this.furnaces.closeView();
      this.furnaceView = null;
    }
    if (brewing) {
      const [x, y, z] = this.screenPos;
      this.brewView = this.brewing.openView(x, y, z, () => this._containerUpdated());
    } else if (this.brewView) {
      this.brewing.closeView();
      this.brewView = null;
    }
    this._title();
    this.setTab(this.tab);
    this.root.classList.remove("hidden");
    this.refresh();
  }

  // Puts the carried stack and the crafting grid back into the inventory
  // (anything that doesn't fit is dropped) and hides the screen. (A chest or
  // furnace click still with the host: its answer decides what the hand
  // holds, and puts that back.)
  close() {
    if (!this.isOpen) return;
    const leftovers = [];
    if (this.cursor && !this.busy) {
      const s = this.cursor;
      const left = this.inventory.add(s.id, s.count, s.dur);
      if (left > 0) leftovers.push({ ...s, count: left });
      this.cursor = null;
    }
    this._returnGrid(leftovers);
    this._returnLocal(this.enchSlots, leftovers);
    this._returnLocal(this.anvilSlots, leftovers);
    this.anvilName.blur();
    this.gridWidth = 0;
    this.grid = [];
    this._gridDirty = true;
    this.kind = null;
    this.hover = null;
    this.root.classList.add("hidden");
    this.tooltipEl.classList.add("hidden");
    if (this.chestView) {
      this.chestView = null;
      this.chests.closeView();
    }
    if (this.furnaceView) {
      this.furnaceView = null;
      this.furnaces.closeView();
    }
    if (this.brewView) {
      this.brewView = null;
      this.brewing.closeView();
    }
    for (const s of leftovers) if (this.onDrop) this.onDrop(s);
    this._changed();
  }

  // What this screen holds outside the inventory (the cursor, the crafting
  // grid): for a save made while it is open (main.js puts them in free slots).
  heldStacks() {
    if (!this.isOpen) return [];
    const out = [];
    if (this.cursor) out.push(this.cursor);
    for (const s of this.grid) if (s) out.push(s);
    for (const s of [...this.enchSlots, ...this.anvilSlots]) if (s) out.push(s);
    return out;
  }

  // (Round 11) The table's or the anvil's own slots back into the inventory
  // (what doesn't fit into `leftovers`, or thrown out at once).
  _returnLocal(slots, leftovers = null) {
    for (let i = 0; i < slots.length; i++) {
      const s = slots[i];
      if (!s) continue;
      slots[i] = null;
      const left = { ...s };
      addToRange(this.inventory.slots, left, 0, INVENTORY_SIZE);
      if (left.count > 0) {
        if (leftovers) leftovers.push(left);
        else this.onDrop?.(left);
      }
    }
    this._anvilDirty = true;
    this._offersFor = null;
  }

  // The grid's items into the inventory; what doesn't fit into `leftovers`
  // (or thrown out at once).
  _returnGrid(leftovers = null) {
    let any = false;
    for (let i = 0; i < this.grid.length; i++) {
      const s = this.grid[i];
      if (!s) continue;
      this.grid[i] = null;
      any = true;
      const left = { ...s };
      addToRange(this.inventory.slots, left, 0, INVENTORY_SIZE);
      if (left.count > 0) {
        if (leftovers) leftovers.push(left);
        else this.onDrop?.(left);
      }
    }
    if (any) this._gridDirty = true;
  }

  _title() {
    const v = this.chestView || this.furnaceView || this.brewView;
    const name = this.chestView ? "Chest" : this.furnaceView ? "Furnace" : "Brewing Stand";
    const local = { table: "Crafting Table", enchanting: "Enchant", anvil: "Repair & Name" }[this.kind];
    const text = v ? (v.ready ? name : `${name} (opening...)`) : local || (this.creative ? "Creative Inventory" : "Inventory");
    if (this.titleEl.textContent !== text) this.titleEl.textContent = text;
  }

  // The open chest or furnace changed (someone else's click, the host's
  // answer, smelting), or is gone.
  _containerUpdated() {
    const v = this.chestView || this.furnaceView || this.brewView;
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
    if (ref.area === "craft") return this.grid[ref.index] || null;
    if (ref.area === "result") return this._craftStack();
    if (ref.area === "furnace") return this.furnaceView?.ready ? this.furnaceView.slots[ref.index] : null;
    if (ref.area === "brew") return this.brewView?.ready ? this.brewView.slots[ref.index] : null;
    if (ref.area === "ench") return this.enchSlots[ref.index];
    if (ref.area === "anvil") return this.anvilSlots[ref.index];
    if (ref.area === "anvilOut") return this._anvilResult()?.out ?? null;
    return null;
  }

  // (Round 11: a line each, the name, its enchantments, a potion's effects.)
  _showTooltip() {
    const stack = this.hover ? this._stackAt(this.hover) : null;
    const lines = stackLines(stack);
    const key = lines.map((l) => l.join("\u0001")).join("\u0002");
    if (key !== this._ttKey) {
      this._ttKey = key;
      this.tooltipEl.textContent = "";
      for (const [text, kind] of lines) {
        const d = document.createElement("div");
        d.className = `tt ${kind.split(" ").map((k) => `tt-${k}`).join(" ")}`;
        d.textContent = text;
        this.tooltipEl.appendChild(d);
      }
    }
    this.tooltipEl.classList.toggle("hidden", !lines.length || !!this.cursor);
  }

  _moveCursor(x, y) {
    this._mx = x;
    this._my = y;
    this.cursorView.el.style.transform = `translate(${x - 20}px, ${y - 20}px)`;
    this.tooltipEl.style.transform = `translate(${x + 16}px, ${y - 30}px)`;
  }

  _click(ref, button, shift) {
    if (button !== 0 && button !== 2) return;
    if (this.busy) return; // (a chest or furnace click is still with the host)
    const inv = this.inventory;
    let sound = true;
    if (ref.area === "chest") {
      sound = this._chestClick(ref.index, button, shift);
    } else if (ref.area === "furnace") {
      sound = this._furnaceClick(ref.index, button, shift);
    } else if (ref.area === "brew") {
      sound = this._brewClick(ref.index, button, shift);
    } else if (ref.area === "ench" || ref.area === "anvil") {
      sound = this._localClick(ref.area, ref.index, button, shift);
    } else if (ref.area === "anvilOut") {
      sound = this._takeAnvil(shift);
    } else if (ref.area === "craft") {
      if (ref.index >= this.grid.length) sound = false;
      else if (shift && !this.cursor) sound = this._gridToInventory(ref.index);
      else this.cursor = clickSlot(this.grid, ref.index, this.cursor, button);
      this._gridDirty = true;
    } else if (ref.area === "result") {
      // (Its own sound: the craft's.)
      if (this._takeResult(shift) && this.audio) this.audio.playCraft?.();
      sound = false;
    } else if (ref.area === "inv" && shift && !this.cursor && this.chestView) {
      sound = this._moveToChest(ref.index);
    } else if (ref.area === "inv" && shift && !this.cursor && this.furnaceView) {
      sound = this._moveToFurnace(ref.index);
    } else if (ref.area === "inv" && shift && !this.cursor && this.brewView) {
      sound = this._moveToBrewing(ref.index);
    } else if (ref.area === "inv" && shift && !this.cursor && (this.kind === "enchanting" || this.kind === "anvil") && inv.slots[ref.index]) {
      sound = this._moveToLocal(ref.index) || quickMove(inv, ref.index);
    } else if (ref.area === "inv" && shift && !this.cursor && this.gridWidth === 3 && inv.slots[ref.index]) {
      // The table: into its grid first (vanilla), else between the hotbar and the main area.
      sound = this._moveToGrid(ref.index) || quickMove(inv, ref.index);
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

  // ---------- Crafting (Round 11) ----------

  // The grid's result as a stack (null: none), worked out again only after the grid changed.
  _craftStack() {
    if (this._gridDirty) {
      this._gridDirty = false;
      this._result = this.gridWidth ? craftResult(gridIds(this.grid, this._ids), this.gridWidth) : null;
      this._resultStack = this._result ? makeStack(this._result.id, this._result.count) : null;
    }
    return this._resultStack;
  }

  // One craft is taken: an item from each filled slot (containers left in the grid, or given).
  _consumeGrid() {
    for (const rem of consumeGrid(this.grid)) this._give(rem);
    this._gridDirty = true;
  }

  // A click on the result. Left or right: one craft onto the cursor (or onto
  // the same item there, if all of it fits); shift: as many crafts as fit
  // into the inventory, while the result stays the same item. True if crafted.
  _takeResult(shift) {
    const first = this._craftStack();
    if (!first) return false;
    if (shift) {
      let n = 0;
      for (let guard = 0; guard < 64; guard++) {
        const st = this._craftStack();
        if (!st || st.id !== first.id) break;
        // (Only when the whole craft fits.)
        if (!addInOrder(copySlots(this.inventory.slots), { ...st }, ORDER_RESULT)) break;
        addInOrder(this.inventory.slots, { ...st }, ORDER_RESULT);
        this._consumeGrid();
        n++;
      }
      return n > 0;
    }
    const c = this.cursor;
    if (!c) this.cursor = { ...first };
    else if (canMerge(c, first) && c.count + first.count <= maxStack(first.id)) c.count += first.count;
    else return false;
    this._consumeGrid();
    return true;
  }

  // Shift-click on a grid slot: into the inventory (the main area first).
  _gridToInventory(i) {
    const s = this.grid[i];
    if (!s) return false;
    const moving = { ...s };
    addInOrder(this.inventory.slots, moving, ORDER_CONTAINER);
    if (moving.count === s.count) return false;
    if (moving.count > 0) s.count = moving.count;
    else this.grid[i] = null;
    return true;
  }

  // Shift-click on inventory slot `index` at the table: into the grid.
  _moveToGrid(index) {
    const st = this.inventory.slots[index];
    if (!st) return false;
    const moving = { ...st };
    addToRange(this.grid, moving, 0, this.grid.length);
    if (moving.count === st.count) return false;
    if (moving.count > 0) st.count = moving.count;
    else this.inventory.slots[index] = null;
    this._gridDirty = true;
    return true;
  }

  // ---------- The chest and the furnace ----------

  // Sends a change of the open chest's or furnace's slots ([[slot, before,
  // after], ...]); onOk() makes this player's side of it (the cursor, the
  // inventory) once it is applied. Refused: nothing changes here (the screen
  // shows what it holds now).
  _submit(changes, onOk) {
    const store = this.furnaceView ? this.furnaces : this.brewView ? this.brewing : this.chests;
    this.busy = true;
    store.submit(changes, (ok) => {
      this.busy = false;
      if (ok) onOk();
      // (The screen closed meanwhile: what the hand holds goes back into the inventory.)
      if (!this.isOpen && this.cursor) {
        const s = this.cursor;
        this.cursor = null;
        const left = this.inventory.add(s.id, s.count, s.dur);
        if (left > 0) this.onDrop?.({ ...s, count: left });
      }
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

  _furnaceOpen() {
    const v = this.furnaceView;
    return v && v.ready && !v.gone ? v : null;
  }

  // A click on furnace slot i (0 input, 1 fuel, 2 output), vanilla's rules:
  // the fuel slot takes only fuel (and a bucket), the output only gives
  // (all, half with the right button, or onto the same item in the hand).
  _furnaceClick(i, button, shift) {
    const v = this._furnaceOpen();
    if (!v) return false;
    const before = copyStack(v.slots[i]);
    if (shift) {
      // Into the inventory (the output from the hotbar's end, as a crafting result).
      if (!before || this.cursor) return false;
      const order = i === 2 ? ORDER_RESULT : ORDER_CONTAINER;
      const moving = { ...before };
      addInOrder(copySlots(this.inventory.slots), moving, order);
      if (moving.count === before.count) return false;
      const taken = { ...before, count: before.count - moving.count };
      this._submit([[i, before, moving.count > 0 ? { ...before, count: moving.count } : null]], () => this._give(taken, order));
      return true;
    }
    const cur = this.cursor;
    let after;
    let cursor;
    if (i === 2) {
      if (!before) return false;
      let n;
      if (!cur) {
        n = button === 2 ? Math.ceil(before.count / 2) : before.count;
        cursor = { ...before, count: n };
      } else if (canMerge(cur, before)) {
        n = Math.min(before.count, maxStack(cur.id) - cur.count);
        if (n <= 0) return false;
        cursor = { ...cur, count: cur.count + n };
      } else return false;
      after = n < before.count ? { ...before, count: before.count - n } : null;
    } else {
      if (cur && !furnaceAccepts(i, cur.id)) return false;
      const copy = copySlots(v.slots);
      cursor = clickSlot(copy, i, copyStack(cur), button);
      after = copy[i];
    }
    if (sameStack(before, after)) return false;
    this._submit([[i, before, after]], () => (this.cursor = cursor));
    return true;
  }

  // Shift-click on inventory slot `index` with a furnace open (vanilla): what
  // smelts into the input, else a fuel into the fuel slot, else between the
  // hotbar and the main area.
  _moveToFurnace(index) {
    const v = this._furnaceOpen();
    const st = this.inventory.slots[index];
    if (!v || !st) return false;
    const t = smeltingOf(st.id) ? 0 : isFuel(st.id) ? 1 : -1;
    if (t < 0) return quickMove(this.inventory, index);
    const copy = copySlots(v.slots);
    const moving = { ...st };
    addToRange(copy, moving, t, t + 1);
    const moved = st.count - moving.count;
    if (moved <= 0) return false;
    const { id, dur } = st;
    this._submit([[t, copyStack(v.slots[t]), copy[t]]], () => this._take(index, id, dur, moved));
    return true;
  }

  // ---------- The brewing stand (Round 11) ----------

  _brewOpen() {
    const v = this.brewView;
    return v && v.ready && !v.gone ? v : null;
  }

  // A click on stand slot i (0-2 the bottles: one each; 3 the ingredient),
  // asked of the stand's owner like the furnace's.
  _brewClick(i, button, shift) {
    const v = this._brewOpen();
    if (!v) return false;
    const before = copyStack(v.slots[i]);
    if (shift) {
      if (!before || this.cursor) return false;
      const moving = { ...before };
      addInOrder(copySlots(this.inventory.slots), moving, ORDER_CONTAINER);
      if (moving.count === before.count) return false;
      const taken = { ...before, count: before.count - moving.count };
      this._submit([[i, before, moving.count > 0 ? { ...before, count: moving.count } : null]], () => this._give(taken, ORDER_CONTAINER));
      return true;
    }
    const cur = this.cursor;
    if (cur && !brewingAccepts(i, cur.id)) return false;
    let after;
    let cursor;
    if (i < 3 && cur) {
      // (One bottle a slot: one goes in, or a single one swaps.)
      if (!before) {
        after = { ...cur, count: 1 };
        cursor = cur.count > 1 ? { ...cur, count: cur.count - 1 } : null;
      } else if (cur.count === 1) {
        after = { ...cur };
        cursor = before;
      } else return false;
    } else {
      const copy = copySlots(v.slots);
      cursor = clickSlot(copy, i, copyStack(cur), button);
      after = copy[i];
    }
    if (sameStack(before, after)) return false;
    this._submit([[i, before, after]], () => (this.cursor = cursor));
    return true;
  }

  // Shift-click on inventory slot `index` at the stand: an ingredient onto
  // the ingredient slot, a bottle into the first free bottle slot.
  _moveToBrewing(index) {
    const v = this._brewOpen();
    const st = this.inventory.slots[index];
    if (!v || !st) return false;
    let t = -1;
    if (isIngredient(st.id) && (!v.slots[3] || (canMerge(v.slots[3], st) && v.slots[3].count < maxStack(st.id)))) t = 3;
    else if (isBottle(st.id)) for (let i = 0; i < 3 && t < 0; i++) if (!v.slots[i]) t = i;
    if (t < 0) return quickMove(this.inventory, index);
    const copy = copySlots(v.slots);
    const moving = t < 3 ? { ...st, count: 1 } : { ...st };
    const want = moving.count;
    addToRange(copy, moving, t, t + 1);
    const moved = want - moving.count;
    if (moved <= 0) return false;
    const { id, dur } = st;
    this._submit([[t, copyStack(v.slots[t]), copy[t]]], () => this._take(index, id, dur, moved));
    return true;
  }

  // ---------- The enchanting table and the anvil (Round 11) ----------

  // A click on the table's slots (0 the item: one only; 1 the lapis: lapis
  // only) or the anvil's two inputs.
  _localClick(area, i, button, shift) {
    const slots = area === "ench" ? this.enchSlots : this.anvilSlots;
    const cur = this.cursor;
    if (shift) {
      const s = slots[i];
      if (!s || cur) return false;
      const moving = { ...s };
      addInOrder(this.inventory.slots, moving, ORDER_CONTAINER);
      if (moving.count === s.count) return false;
      slots[i] = moving.count > 0 ? moving : null;
      this._localChanged();
      return true;
    }
    if (area === "ench" && i === 1 && cur && cur.id !== LAPIS_LAZULI) return false;
    if (area === "ench" && i === 0 && cur) {
      const s = slots[0];
      if (!s) {
        slots[0] = { ...cur, count: 1 };
        this.cursor = cur.count > 1 ? { ...cur, count: cur.count - 1 } : null;
      } else if (cur.count === 1) {
        slots[0] = cur;
        this.cursor = s;
      } else if (canMerge(cur, s) && cur.count < maxStack(cur.id)) {
        cur.count += 1;
        slots[0] = null;
      } else return false;
      this._localChanged();
      return true;
    }
    this.cursor = clickSlot(slots, i, cur, button);
    this._localChanged();
    return true;
  }

  // Shift-click from the inventory onto the table (lapis to its slot, else
  // one item) or the anvil (the first free input).
  _moveToLocal(index) {
    const inv = this.inventory.slots;
    const st = inv[index];
    if (!st) return false;
    if (this.kind === "enchanting") {
      const t = st.id === LAPIS_LAZULI ? 1 : 0;
      const moving = t ? { ...st } : { ...st, count: 1 };
      const want = moving.count;
      addToRange(this.enchSlots, moving, t, t + 1);
      const moved = want - moving.count;
      if (moved <= 0) return false;
      st.count -= moved;
      if (st.count <= 0) inv[index] = null;
    } else {
      const t = !this.anvilSlots[0] ? 0 : !this.anvilSlots[1] ? 1 : -1;
      if (t < 0) return false;
      this.anvilSlots[t] = st;
      inv[index] = null;
    }
    this._localChanged();
    return true;
  }

  _localChanged() {
    this._anvilDirty = true;
    this._offersFor = null;
    // (A new item on the anvil: its name in the box, as vanilla.)
    if (this.kind === "anvil") {
      const left = this.anvilSlots[0];
      if (left !== this._anvilLeft) {
        this._anvilLeft = left;
        this.anvilName.value = left ? stackName(left) : "";
      }
    }
  }

  // The table's three offers for what is on it (the same until something is enchanted).
  _enchantOffers() {
    const item = this.enchSlots[0];
    const key = item ? `${item.id}:${item.count}:${JSON.stringify(item.tag ?? 0)}:${this._shelves}:${enchantSeed()}` : "";
    if (key !== this._offersFor) {
      this._offersFor = key;
      this._offers = item ? tableOffers(item, this._shelves, (enchantSeed() ^ (item.id * 2654435761)) >>> 0) : null;
    }
    return this._offers;
  }

  // Whether offer i can be taken now (levels and lapis; Creative: free).
  _canEnchant(o) {
    if (!o || !o.cost) return false;
    if (this.creative) return true;
    const lvl = this.player?.xpLevel ?? 0;
    const lapis = this.enchSlots[1]?.id === LAPIS_LAZULI ? this.enchSlots[1].count : 0;
    return lvl >= o.cost && lvl >= o.lapis && lapis >= o.lapis;
  }

  _enchant(i) {
    if (this.kind !== "enchanting" || this.busy) return;
    const offers = this._enchantOffers();
    const o = offers?.[i];
    if (!this._canEnchant(o)) return;
    const item = this.enchSlots[0];
    if (!this.creative) {
      if (!this.player || !spendLevels(this.player, o.lapis)) return;
      const lapis = this.enchSlots[1];
      lapis.count -= o.lapis;
      if (lapis.count <= 0) this.enchSlots[1] = null;
    }
    this.enchSlots[0] = applyOffer(item, o);
    nextEnchantSeed();
    this._offersFor = null;
    this.audio?.playPickup?.();
    this.audio?.playCraft?.();
    this.onEnchanted?.();
    this.refresh();
    this._changed();
    this._showTooltip();
  }

  _anvilResult() {
    if (this._anvilDirty) {
      this._anvilDirty = false;
      const [l, r] = this.anvilSlots;
      this._anvil = this.kind === "anvil" ? anvilResult(l, r, this.anvilName.value, this.creative) : null;
    }
    return this._anvil;
  }

  // Takes the anvil's result (levels permitting): onto the hand (or with
  // shift into the inventory); the inputs are used up, and the anvil may
  // wear (vanilla: 12% a use, not in Creative).
  _takeAnvil(shift) {
    const r = this._anvilResult();
    if (!r || r.tooExpensive) return false;
    if (!this.creative && (this.player?.xpLevel ?? 0) < r.cost) return false;
    if (shift) {
      if (!addInOrder(copySlots(this.inventory.slots), { ...r.out }, ORDER_RESULT)) return false;
    } else if (this.cursor) return false;
    if (!this.creative && (!this.player || !spendLevels(this.player, r.cost))) return false;
    if (shift) addInOrder(this.inventory.slots, { ...r.out }, ORDER_RESULT);
    else this.cursor = { ...r.out };
    this.anvilSlots[0] = null;
    const right = this.anvilSlots[1];
    if (right) {
      right.count -= r.use;
      if (right.count <= 0) this.anvilSlots[1] = null;
    }
    this._localChanged();
    this.audio?.playPlace?.("stone");
    this.audio?.playBreak?.("stone");
    if (!this.creative && Math.random() < 0.12) this._wearAnvil();
    return false;
  }

  // The anvil one step more worn (its last step: it breaks, and the screen closes).
  _wearAnvil() {
    const world = this.world || this.chests?.world;
    if (!world || !this.screenPos) return;
    const [x, y, z] = this.screenPos;
    const id = world.getBlock(x, y, z);
    if (!isAnvil(id)) return;
    const next = wornAnvil(id);
    world.setBlock(x, y, z, next);
    if (next === BLOCK.AIR) this.audio?.playToolBreak?.();
  }

  // Into the inventory (what doesn't fit is thrown out).
  _give(stack, order = null) {
    const left = { ...stack };
    if (order) addInOrder(this.inventory.slots, left, order);
    else addToRange(this.inventory.slots, left, 0, INVENTORY_SIZE);
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

  // Keys over a chest or furnace slot: 1-9 swaps it with that hotbar slot
  // (what the slot may take: a furnace's output only gives, into an empty
  // one), Q drops from it.
  _containerKey(i, code, ctrl) {
    const furnace = !!this.furnaceView;
    const brew = !!this.brewView;
    const v = furnace ? this._furnaceOpen() : brew ? this._brewOpen() : this._chestOpen();
    if (!v || this.busy) return;
    const before = v.slots[i] ? { ...v.slots[i] } : null;
    const m = /^Digit([1-9])$/.exec(code);
    if (m) {
      const h = Number(m[1]) - 1;
      const sent = this.inventory.slots[h] ? { ...this.inventory.slots[h] } : null;
      if (!before && !sent) return;
      if (furnace && sent && !furnaceAccepts(i, sent.id)) return;
      if (brew && sent && (!brewingAccepts(i, sent.id) || (i < 3 && sent.count > 1))) return;
      this._submit([[i, before, sent]], () => {
        const slots = this.inventory.slots;
        if (sameStack(slots[h], sent)) {
          slots[h] = before; // unchanged meanwhile: a plain swap
          return;
        }
        // (The slot changed while the host answered, e.g. a pickup: only what
        // was sent leaves the inventory, and the container's stack is added.)
        if (sent) this._take(h, sent.id, sent.dur, sent.count);
        if (before) this._give(before);
      });
    } else if (code === "KeyQ" && before) {
      const n = ctrl ? before.count : 1;
      this._submit([[i, before, before.count > n ? { ...before, count: before.count - n } : null]], () => this.onDrop?.({ ...before, count: n }));
    }
  }

  // Keys over the crafting grid or its result. Grid: 1-9 swaps with that
  // hotbar slot, Q drops one (Ctrl: the stack). Result: 1-9 crafts one into
  // that hotbar slot if it is empty; Q crafts one and throws it (Ctrl: as many
  // as the grid makes).
  _craftKey(ref, code, ctrl) {
    const m = /^Digit([1-9])$/.exec(code);
    const slots = this.inventory.slots;
    if (ref.area === "craft") {
      const i = ref.index;
      if (i >= this.grid.length) return;
      if (m) {
        const h = Number(m[1]) - 1;
        const tmp = slots[h];
        slots[h] = this.grid[i];
        this.grid[i] = tmp;
      } else if (code === "KeyQ" && this.grid[i]) {
        const s = this.grid[i];
        const n = ctrl ? s.count : 1;
        s.count -= n;
        if (s.count <= 0) this.grid[i] = null;
        this.onDrop?.({ ...s, count: n });
      }
      this._gridDirty = true;
      return;
    }
    const first = this._craftStack();
    if (!first) return;
    if (m) {
      const h = Number(m[1]) - 1;
      if (slots[h]) return;
      slots[h] = { ...first };
      this._consumeGrid();
      this.audio?.playCraft?.();
    } else if (code === "KeyQ") {
      for (let guard = 0; guard < (ctrl ? 64 : 1); guard++) {
        const st = this._craftStack();
        if (!st || st.id !== first.id) break;
        this.onDrop?.({ ...st });
        this._consumeGrid();
      }
      this.audio?.playCraft?.();
    }
  }

  // (Round 11) Keys over the table's or the anvil's slots: 1-9 swaps with the
  // hotbar (what the slot takes), Q drops from it.
  _localKey(ref, code, ctrl) {
    const slots = ref.area === "ench" ? this.enchSlots : this.anvilSlots;
    const i = ref.index;
    const m = /^Digit([1-9])$/.exec(code);
    if (m) {
      const h = Number(m[1]) - 1;
      const hot = this.inventory.slots[h];
      if (hot && ref.area === "ench" && (i === 1 ? hot.id !== LAPIS_LAZULI : hot.count > 1)) return;
      this.inventory.slots[h] = slots[i];
      slots[i] = hot;
    } else if (code === "KeyQ" && slots[i]) {
      const s = slots[i];
      const n = ctrl ? s.count : 1;
      s.count -= n;
      if (s.count <= 0) slots[i] = null;
      this.onDrop?.({ ...s, count: n });
    }
    this._localChanged();
  }

  // Throws the carried stack (or one item of it) out of the screen.
  _dropCursor(one) {
    if (!this.cursor || this.busy) return; // (a chest click still with the host decides the hand)
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
    const key = /^Digit[1-9]$/.test(code) || code === "KeyQ";
    if (this.hover && (this.hover.area === "chest" || this.hover.area === "furnace" || this.hover.area === "brew") && key) {
      this._containerKey(this.hover.index, code, ctrl);
      return true;
    }
    if (this.hover && (this.hover.area === "ench" || this.hover.area === "anvil") && key) {
      this._localKey(this.hover, code, ctrl);
      this.refresh();
      this._changed();
      this._showTooltip();
      return true;
    }
    if (this.hover && (this.hover.area === "craft" || this.hover.area === "result") && key) {
      this._craftKey(this.hover, code, ctrl);
      this.refresh();
      this._changed();
      this._showTooltip();
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

  // (Round 11) The table's slots, the offers (dimmed when they can't be taken) and the level.
  _refreshEnchanting() {
    this.enchViews.forEach((v, i) => v.set(this.enchSlots[i]));
    const offers = this._enchantOffers();
    for (let i = 0; i < 3; i++) {
      const o = offers?.[i];
      const b = this.offerEls[i];
      const text = o?.cost ? `${enchantName(o.clue[0], o.clue[1])} . . . ?` : "";
      const sig = o?.cost ? `${text}|${o.cost}|${this._canEnchant(o) ? 1 : 0}` : "";
      if (b._sig === sig) continue;
      b._sig = sig;
      b.classList.toggle("none", !o?.cost);
      b.classList.toggle("off", !!o?.cost && !this._canEnchant(o));
      b.firstChild.textContent = text;
      b.lastChild.textContent = o?.cost ? String(o.cost) : "";
      b.title = o?.cost ? `${o.lapis} Lapis Lazuli, ${o.lapis} level${o.lapis > 1 ? "s" : ""} (needs level ${o.cost})` : "";
    }
    const lvl = this.creative ? "Creative: free" : `Your level: ${this.player?.xpLevel ?? 0}  ·  bookshelves: ${this._shelves}`;
    if (lvl !== this._enchLevelText) this.enchLevelEl.textContent = this._enchLevelText = lvl;
  }

  _refreshAnvil() {
    this.anvilViews.forEach((v, i) => v.set(this.anvilSlots[i]));
    const r = this._anvilResult();
    this.anvilOutView.set(r && !r.tooExpensive ? r.out : null);
    let text = "";
    let bad = false;
    if (r) {
      bad = r.tooExpensive || (!this.creative && (this.player?.xpLevel ?? 0) < r.cost);
      text = r.tooExpensive ? "Too Expensive!" : `Enchantment Cost: ${r.cost}`;
    }
    if (text !== this._anvilText || bad !== this._anvilBad) {
      this._anvilText = text;
      this._anvilBad = bad;
      this.anvilCostEl.textContent = text;
      this.anvilCostEl.classList.toggle("bad", bad);
    }
  }

  refresh() {
    if (!this.isOpen) return;
    // (The crafting table broken meanwhile, by anyone: the screen closes, as in vanilla.)
    // (Round 11: the enchanting table and the anvil too.)
    const BLOCK_OF = { table: (id) => id === BLOCK.CRAFTING_TABLE, enchanting: (id) => id === ENCHANTING_TABLE, anvil: isAnvil };
    if (BLOCK_OF[this.kind]) {
      const world = this.world || this.chests?.world;
      const [x, y, z] = this.screenPos;
      if (world && world.getChunk?.(x >> 4, z >> 4) && !BLOCK_OF[this.kind](world.getBlock(x, y, z))) {
        this.onCloseRequest?.();
        if (this.isOpen) this.close();
        return;
      }
    }
    for (let i = 0; i < INVENTORY_SIZE; i++) this.invViews[i].set(this.inventory.slots[i]);
    const cv = this.chestView;
    if (cv) {
      for (let i = 0; i < CHEST_SLOTS; i++) this.chestViews[i].set(cv.ready && !cv.gone ? cv.slots[i] : null);
      this._title();
    }
    if (this.gridWidth) {
      for (let i = 0; i < this.grid.length; i++) this.gridViews[i].set(this.grid[i]);
      this.resultView.set(this._craftStack());
    }
    const fv = this.furnaceView;
    if (fv) {
      const ok = fv.ready && !fv.gone;
      for (let i = 0; i < FURNACE_SLOTS; i++) this.furnaceViews[i].set(ok ? fv.slots[i] : null);
      const f = ok ? fv.f : null;
      // (Vanilla's bars: the flame is the fuel's burn time left, the arrow the cooking.)
      const flame = f && f.lit > 0 ? Math.max(1, Math.round((f.lit / Math.max(1, f.litDur)) * 14)) : 0;
      const arrow = f && f.prog > 0 ? Math.round((f.prog / Math.max(1, f.total)) * 24) : 0;
      if (flame !== this._flame) this.flameFill.style.height = `${((this._flame = flame) / 14) * 100}%`;
      if (arrow !== this._arrow) this.arrowFill.style.width = `${((this._arrow = arrow) / 24) * 100}%`;
      this._title();
    }
    if (this.kind === "enchanting") this._refreshEnchanting();
    if (this.kind === "anvil") this._refreshAnvil();
    const bv = this.brewView;
    if (bv) {
      const ok = bv.ready && !bv.gone;
      for (let i = 0; i < BREWING_SLOTS; i++) this.brewViews[i].set(ok ? bv.slots[i] : null);
      const t = ok && bv.b?.brew > 0 ? Math.round(((BREW_TICKS - bv.b.brew) / BREW_TICKS) * 26) : 0;
      if (t !== this._brewArrow) {
        this._brewArrow = t;
        this.brewArrowFill.style.height = `${(t / 26) * 100}%`;
        this.bubbleFill.style.height = t ? `${((t * 7) % 26) / 26 * 100}%` : "0%";
      }
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
