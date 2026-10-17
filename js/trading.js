// Villager trading (Round 11, Survival worlds): what each profession buys
// and sells (vanilla's trades and prices, an emerald the currency), and the
// trade screen (right click on a villager): the villager's offers in a list
// beside the inventory. A click makes one trade (the price leaves the
// inventory, the goods come in), shift-click as many as the stock and the
// inventory allow. Each offer has a stock (uses, vanilla's 12 or 16) that the
// villager restocks now and then (mobs.js).
//
// Online the villagers are the host's, and so is their stock: a guest's
// screen asks the host for a villager's offers and for each trade, and only
// pays and takes the goods once the host says yes (js/net/entities.js). The
// inventory is always the trader's own.
//
// Deviations from vanilla: no villager levels or experience (every villager
// offers the trades of its first three levels at once, two of each), fixed
// prices (no demand, reputation or discounts), no enchanted goods, no
// workstations (a villager's profession is picked when it appears).
import { ITEM, isValidItem, itemInfo } from "./items.js";
import { BLOCK } from "./blocks.js";
import * as V from "./content/ids.js";
import { SlotView } from "./slot-view.js";
import { HOTBAR_SIZE, INVENTORY_SIZE } from "./inventory.js";
import { LIB } from "./content/base.js";

// (The order of the villagers' outfits, mob-models.js VILLAGER_DRESS.)
export const PROFESSIONS = ["farmer", "librarian", "armorer", "toolsmith", "butcher", "cleric", "fisherman", "shepherd", "fletcher", "cartographer", "mason", "leatherworker", "weaponsmith", "nitwit"];
export const PROFESSION_NAMES = ["Farmer", "Librarian", "Armorer", "Toolsmith", "Butcher", "Cleric", "Fisherman", "Shepherd", "Fletcher", "Cartographer", "Mason", "Leatherworker", "Weaponsmith", "Nitwit"];
export const NITWIT = PROFESSIONS.indexOf("nitwit");

const E = V.EMERALD;
// [price id, n, second price id or 0, n, goods id, n, stock]: what the
// villager wants and what it gives. By level (novice, apprentice, journeyman).
const buy = (id, n, stock = 16) => [id, n, 0, 0, E, 1, stock]; // the villager buys
const sell = (emeralds, id, n = 1, stock = 12) => [E, emeralds, 0, 0, id, n, stock]; // the villager sells
const TRADES = {
  farmer: [
    [buy(V.WHEAT, 20), buy(V.POTATO, 26), buy(V.CARROT, 22), buy(V.BEETROOT, 15), sell(1, V.BREAD, 6, 16)],
    [buy(V.PUMPKIN, 6, 12), sell(1, V.PUMPKIN_PIE, 4), sell(1, ITEM.APPLE, 4, 16)],
    [buy(V.MELON, 4, 12), sell(3, V.COOKIE, 18)],
  ],
  librarian: [
    [buy(V.PAPER, 24), sell(9, V.BOOKSHELF)],
    [buy(V.BOOK, 4, 12), sell(1, V.LANTERN)],
    [sell(1, BLOCK.GLASS, 4), sell(5, V.CLOCK), sell(4, V.COMPASS)],
  ],
  armorer: [
    [buy(ITEM.COAL, 15), sell(7, ITEM.IRON_LEGGINGS), sell(4, ITEM.IRON_BOOTS), sell(5, ITEM.IRON_HELMET), sell(9, ITEM.IRON_CHESTPLATE)],
    [buy(V.IRON_INGOT, 4, 12), sell(1, V.CHAINMAIL_BOOTS), sell(3, V.CHAINMAIL_LEGGINGS)],
    [buy(V.LAVA_BUCKET, 1, 12), buy(V.DIAMOND, 1, 12), sell(1, V.CHAINMAIL_HELMET), sell(4, V.CHAINMAIL_CHESTPLATE), sell(5, V.SHIELD)],
  ],
  toolsmith: [
    [buy(ITEM.COAL, 15), sell(1, ITEM.STONE_AXE), sell(1, ITEM.STONE_SHOVEL), sell(1, ITEM.STONE_PICKAXE), sell(1, V.STONE_HOE)],
    [buy(V.IRON_INGOT, 4, 12)],
    [buy(V.FLINT, 30, 12), sell(1, ITEM.IRON_AXE, 1, 3), sell(2, ITEM.IRON_SHOVEL, 1, 3), sell(3, ITEM.IRON_PICKAXE, 1, 3), sell(4, V.DIAMOND_HOE, 1, 3)],
  ],
  weaponsmith: [
    [buy(ITEM.COAL, 15), sell(3, ITEM.IRON_AXE), sell(2, ITEM.IRON_SWORD)],
    [buy(V.IRON_INGOT, 4, 12)],
    [buy(V.FLINT, 24, 12)],
  ],
  butcher: [
    [buy(V.CHICKEN, 14), buy(V.PORKCHOP, 7)],
    [buy(ITEM.COAL, 15), sell(1, V.COOKED_PORKCHOP, 5, 16), sell(1, V.COOKED_CHICKEN, 8, 16)],
    [buy(V.MUTTON, 7), buy(V.BEEF, 10)],
  ],
  cleric: [
    [buy(V.ROTTEN_FLESH, 32), sell(1, V.REDSTONE, 2)],
    [buy(ITEM.GOLD_INGOT, 3, 12), sell(1, V.LAPIS_LAZULI)],
    [buy(V.GLASS_BOTTLE, 9, 12), sell(5, V.ENDER_PEARL, 1, 4)],
  ],
  fisherman: [
    [buy(V.STRING, 20), buy(ITEM.COAL, 10), [E, 1, V.COD, 6, V.COOKED_COD, 6, 16]],
    [buy(V.COD, 15), [E, 1, V.SALMON, 6, V.COOKED_SALMON, 6, 16]],
    [buy(V.SALMON, 13), sell(3, V.FISHING_ROD, 1, 3)],
  ],
  shepherd: [
    [buy(BLOCK.WOOL, 18), buy(V.BROWN_WOOL, 18), buy(V.BLACK_WOOL, 18), buy(V.GRAY_WOOL, 18), sell(2, V.SHEARS)],
    [sell(1, BLOCK.WOOL, 1, 16), sell(1, V.WHITE_CARPET, 4, 16)],
    [sell(3, V.RED_BED)],
  ],
  fletcher: [
    [buy(ITEM.STICK, 32), sell(1, V.ARROW, 16), [E, 1, BLOCK.GRAVEL, 10, V.FLINT, 10, 12]],
    [buy(V.FLINT, 26, 12), sell(2, ITEM.BOW)],
    [buy(V.STRING, 14), buy(V.FEATHER, 24)],
  ],
  cartographer: [[buy(V.PAPER, 24)], [buy(V.GLASS_PANE, 11)], [buy(V.COMPASS, 1, 12)]],
  mason: [
    [buy(V.CLAY_BALL, 10), sell(1, V.BRICK, 10, 16)],
    [buy(BLOCK.STONE, 20), sell(1, V.CHISELED_STONE_BRICKS, 4, 16)],
    [buy(V.GRANITE, 16), buy(V.ANDESITE, 16), buy(V.DIORITE, 16), sell(1, V.POLISHED_GRANITE, 4, 16), sell(1, V.POLISHED_DIORITE, 4, 16), sell(1, V.POLISHED_ANDESITE, 4, 16)],
  ],
  leatherworker: [
    [buy(V.LEATHER, 6), sell(3, ITEM.LEATHER_LEGGINGS), sell(7, ITEM.LEATHER_CHESTPLATE)],
    [buy(V.FLINT, 26, 12), sell(5, ITEM.LEATHER_HELMET), sell(4, ITEM.LEATHER_BOOTS)],
    [],
  ],
  nitwit: [],
};

// A new villager's offers: two of each level's trades (only ones whose items
// exist), in level order. Each offer: { a: [id, n], b: [id, n] | null,
// out: [id, n], uses, max }.
export function makeOffers(profession, rand = Math.random) {
  const levels = TRADES[PROFESSIONS[profession]] || [];
  const out = [];
  for (const pool of levels) {
    const ok = pool.filter((t) => isValidItem(t[0]) && (!t[2] || isValidItem(t[2])) && isValidItem(t[4]));
    for (let k = 0; k < 2 && ok.length; k++) {
      const t = ok.splice(Math.floor(rand() * ok.length), 1)[0];
      out.push({ a: [t[0], t[1]], b: t[2] ? [t[2], t[3]] : null, out: [t[4], t[5]], uses: 0, max: t[6] });
    }
  }
  return out;
}

// Offers on the wire (host -> guest): flat [a id, a n, b id, b n, out id, out n, uses, max] each.
export function encodeOffers(offers) {
  return (offers || []).map((o) => [o.a[0], o.a[1], o.b ? o.b[0] : 0, o.b ? o.b[1] : 0, o.out[0], o.out[1], o.uses, o.max]);
}

export function decodeOffers(list) {
  if (!Array.isArray(list)) return [];
  const out = [];
  for (const t of list) {
    if (!Array.isArray(t) || t.length < 8) continue;
    const [a, an, b, bn, o, on, uses, max] = t.map((x) => Number(x) || 0);
    if (!isValidItem(a) || !isValidItem(o) || (b && !isValidItem(b))) continue;
    out.push({ a: [a, Math.max(1, an)], b: b ? [b, Math.max(1, bn)] : null, out: [o, Math.max(1, on)], uses, max });
  }
  return out;
}

// How many of `id` the inventory's slots hold (not the armor worn).
function held(inventory, id) {
  let n = 0;
  for (const s of inventory.slots) if (s && s.id === id) n += s.count;
  return n;
}

export function canAfford(inventory, offer) {
  if (!offer) return false;
  if (offer.b && offer.b[0] === offer.a[0]) return held(inventory, offer.a[0]) >= offer.a[1] + offer.b[1];
  return held(inventory, offer.a[0]) >= offer.a[1] && (!offer.b || held(inventory, offer.b[0]) >= offer.b[1]);
}

// Takes n of `id` out of the slots (the main area first, then the hotbar).
function take(inventory, id, n) {
  for (let pass = 0; pass < 2 && n > 0; pass++) {
    const from = pass ? 0 : HOTBAR_SIZE;
    const to = pass ? HOTBAR_SIZE : INVENTORY_SIZE;
    for (let i = to - 1; i >= from && n > 0; i--) {
      const s = inventory.slots[i];
      if (!s || s.id !== id) continue;
      n -= inventory.takeFromSlot(i, n)?.count ?? 0;
    }
  }
}

// One trade on the inventory: the price taken, the goods added. Returns the
// goods that didn't fit ({ id, count } to drop) or null; false if it can't be paid.
export function applyTrade(inventory, offer) {
  if (!canAfford(inventory, offer)) return false;
  take(inventory, offer.a[0], offer.a[1]);
  if (offer.b) take(inventory, offer.b[0], offer.b[1]);
  const left = inventory.add(offer.out[0], offer.out[1]);
  return left > 0 ? { id: offer.out[0], count: left } : null;
}

// ---------- The screen ----------

function el(tag, className, parent) {
  const e = document.createElement(tag);
  if (className) e.className = className;
  if (parent) parent.appendChild(e);
  return e;
}

const STYLE = `
.trade-panel { margin-right: 14px; min-width: 230px; max-height: 80vh; overflow-y: auto; }
.trade-panel.hidden { display: none; }
.trade-row { display: flex; align-items: center; gap: 4px; padding: 3px 4px; margin: 2px 0; border-radius: 7px; cursor: pointer; border: 1px solid transparent; }
.trade-row:hover { background: rgba(255,255,255,0.10); border-color: rgba(61,155,255,0.5); }
.trade-row.poor { opacity: 0.55; }
.trade-row.out { opacity: 0.4; cursor: default; }
.trade-row .slot { pointer-events: none; }
.trade-row .trade-plus, .trade-row .trade-arrow { width: 14px; text-align: center; font-weight: 700; opacity: 0.8; }
.trade-row .trade-gap { width: 38px; }
.trade-row .trade-stock { margin-left: 6px; font-size: 11px; opacity: 0.75; min-width: 34px; }
.trade-row.out .trade-stock { color: #e05050; opacity: 1; }
.trade-note { font-size: 12px; opacity: 0.8; margin: 6px 2px; }
`;

export class TradeScreen {
  // root: the inventory screen's element (the list sits beside its panel).
  constructor({ icons, inventory, audio, mobs, player, root = document.getElementById("inventory-screen") }) {
    this.icons = icons;
    this.inventory = inventory;
    this.audio = audio;
    this.mobs = mobs;
    this.player = player;
    this.onChange = null; // () => void: the inventory changed
    this.onDrop = null; // (stack) => void: goods that didn't fit
    // The trader's experience (vanilla: 3-6 a trade), as orbs at their feet (xp.js).
    this.onXp = (n) => LIB.giveXp?.(n, player.position.x, player.position.y + 0.5, player.position.z);
    this.onCloseRequest = null; // () => void: the villager went (or walked off): close the screen
    this.session = null;
    this.busy = false;
    if (!document.getElementById("trade-style")) {
      const st = document.createElement("style");
      st.id = "trade-style";
      st.textContent = STYLE;
      document.head.appendChild(st);
    }
    this.root = root;
    this.panel = el("div", "inv-panel trade-panel hidden");
    this.titleEl = el("div", "inv-title", this.panel);
    this.listEl = el("div", "trade-list", this.panel);
    this.noteEl = el("div", "trade-note", this.panel);
    root?.insertBefore(this.panel, root.firstChild);
    this.rows = [];
    this._sig = "";
    this._raf = 0;
  }

  get isOpen() {
    return !!this.session;
  }

  // session: mobs.js openTrade's ({ mob, title, offers, remote, onUpdate }).
  open(session) {
    this.session = session;
    this.busy = false;
    session.onUpdate = () => this._render(true);
    this.titleEl.textContent = session.title || "Villager";
    this.panel.classList.remove("hidden");
    this._render(true);
    const tick = () => {
      if (!this.session) return;
      // (The inventory screen closed, however: so does this.)
      if (this.root?.classList.contains("hidden")) {
        this.close();
        return;
      }
      this._watch();
      this._render(false);
      this._raf = requestAnimationFrame(tick);
    };
    cancelAnimationFrame(this._raf);
    this._raf = requestAnimationFrame(tick);
  }

  close() {
    if (!this.session) return;
    cancelAnimationFrame(this._raf);
    this.mobs?.closeTrade?.(this.session);
    this.session = null;
    this.busy = false;
    this.panel.classList.add("hidden");
  }

  // The villager died or went, or the player walked off (vanilla: 8 blocks).
  _watch() {
    const m = this.session.mob;
    const gone = m.dead || !this.mobs?.mobs.includes(m);
    const far = this.player && m.pos.distanceTo(this.player.position) > 8;
    if (gone || far) {
      if (this.onCloseRequest) this.onCloseRequest();
      else this.close();
    }
  }

  _render(force) {
    const s = this.session;
    if (!s) return;
    const offers = s.offers;
    // (Only redrawn when something it shows changed: the stock, what's affordable.)
    const sig = offers ? offers.map((o) => `${o.uses}/${o.max}${canAfford(this.inventory, o) ? "+" : "-"}`).join(",") + (this.busy ? "b" : "") : "?";
    if (!force && sig === this._sig) return;
    this._sig = sig;
    this.listEl.textContent = "";
    this.rows = [];
    if (!offers) {
      this.noteEl.textContent = "Asking the villager...";
      return;
    }
    this.noteEl.textContent = offers.length ? "Click to trade, shift-click for as many as you can." : "This villager has nothing to trade.";
    offers.forEach((o, i) => {
      const row = el("div", "trade-row", this.listEl);
      const slot = (st) => {
        const v = new SlotView(this.icons);
        v.set(st);
        row.appendChild(v.el);
        return v;
      };
      slot({ id: o.a[0], count: o.a[1] });
      if (o.b) {
        el("span", "trade-plus", row).textContent = "+";
        slot({ id: o.b[0], count: o.b[1] });
      } else el("span", "trade-gap", row);
      el("span", "trade-arrow", row).textContent = "→";
      slot({ id: o.out[0], count: o.out[1] });
      const stock = el("span", "trade-stock", row);
      const out = o.uses >= o.max;
      stock.textContent = out ? "sold out" : `${o.max - o.uses} left`;
      row.classList.toggle("out", out);
      row.classList.toggle("poor", !out && !canAfford(this.inventory, o));
      row.title = `${itemInfo(o.a[0])?.name} x${o.a[1]}${o.b ? ` + ${itemInfo(o.b[0])?.name} x${o.b[1]}` : ""} for ${itemInfo(o.out[0])?.name} x${o.out[1]}`;
      row.addEventListener("mousedown", (e) => {
        e.preventDefault();
        e.stopPropagation();
        this._trade(i, e.shiftKey);
      });
      this.rows.push(row);
    });
  }

  // One trade (or, with `all`, trades until the stock, the price or the room runs out).
  _trade(i, all, done = 0) {
    const s = this.session;
    if (!s || !s.offers || this.busy) return;
    const o = s.offers[i];
    if (!o || o.uses >= o.max || !canAfford(this.inventory, o)) {
      if (!done) this.audio?.playClick?.();
      return;
    }
    // (Shift-click stops when the goods would no longer fit.)
    if (done && !this.inventory.canFit(o.out[0], o.out[1])) return;
    this.busy = true;
    this.mobs.tradeRequest(s, i, (ok) => {
      this.busy = false;
      if (this.session !== s) return;
      const offer = s.offers?.[i];
      if (!ok || !offer) {
        this._render(true);
        return;
      }
      const left = applyTrade(this.inventory, offer);
      if (left === false) return; // (moved out of reach meanwhile: the host's stock is spent, nothing changes hands)
      if (left && this.onDrop) this.onDrop(left);
      this.audio?.playPickup?.();
      this.onXp?.(3 + Math.floor(Math.random() * 4));
      this.onChange?.();
      this._render(true);
      if (all && done < 63) this._trade(i, true, done + 1);
    });
  }
}
