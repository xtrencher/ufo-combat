// Round 11 fixes (inventory, off hand, tabs, labels), in Node with a tiny
// stand-in DOM (no browser):
//  - closing the screen (or a late container answer) gives the cursor's
//    stack back with its tag (enchantments, name);
//  - a Survival world doesn't put picked-up armor on (a Missions world does);
//    shift-click armor goes on only into a free slot there (else it moves
//    like any item); number keys over an armor slot swap with the hotbar;
//  - shift-click out of a chest, a brewing stand or the enchanting table
//    fills from the hotbar's right end in a Survival world (a Missions
//    world's chest: the hotbar from the left, as before);
//  - the off hand: saved after the armor (old saves: none), F over a slot
//    swaps with it, a shift-clicked shield goes into it, the shield raised
//    from it blocks; an axe's blow disables it for 5 s;
//  - the enchanting seed can be set back (from a save);
//  - a food's label: "heals N" in a Missions world, the name alone in a
//    Survival world;
//  - the Creative palette: a Survival world's Combat tab, Blocks first, a
//    search box; a Missions world's tabs as before.
//
//   node r11-fixes-g1-tests.mjs
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { register } from "node:module";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
// (Node: "three" from this folder's node_modules, as the page's import map gives it.)
const THREE_URL = pathToFileURL(path.join(__dirname, "node_modules", "three", "build", "three.module.js")).href;
register(`data:text/javascript,${encodeURIComponent(`export async function resolve(s, c, n) { return s === "three" ? { url: ${JSON.stringify(THREE_URL)}, shortCircuit: true } : n(s, c); }`)}`, import.meta.url);
const mod = (p) => import(pathToFileURL(path.join(ROOT, p)).href);

// ---------- A stand-in DOM (just what the inventory screen touches) ----------
class FakeEl {
  constructor(tag) {
    this.tagName = tag;
    this.children = [];
    this.parentNode = null;
    this.style = {};
    this._cls = new Set();
    this.textContent = "";
    this.value = "";
    this.listeners = {};
    const self = this;
    this.classList = {
      add: (...c) => c.forEach((k) => self._cls.add(k)),
      remove: (...c) => c.forEach((k) => self._cls.delete(k)),
      toggle: (k, on) => {
        const want = on === undefined ? !self._cls.has(k) : !!on;
        if (want) self._cls.add(k);
        else self._cls.delete(k);
        return want;
      },
      contains: (k) => self._cls.has(k),
    };
  }
  set className(v) {
    this._cls = new Set(String(v).split(/\s+/).filter(Boolean));
  }
  get className() {
    return [...this._cls].join(" ");
  }
  set innerHTML(v) {
    this.children = [];
  }
  appendChild(c) {
    c.parentNode = this;
    this.children.push(c);
    return c;
  }
  append(...cs) {
    for (const c of cs) this.appendChild(c);
  }
  insertBefore(c) {
    return this.appendChild(c);
  }
  get firstChild() {
    return this.children[0] || null;
  }
  get lastChild() {
    return this.children[this.children.length - 1] || null;
  }
  get firstElementChild() {
    return this.firstChild;
  }
  addEventListener(type, fn) {
    (this.listeners[type] ||= []).push(fn);
  }
  dispatch(type, e = {}) {
    for (const fn of this.listeners[type] || []) fn({ preventDefault() {}, stopPropagation() {}, ...e });
  }
  focus() {
    globalThis.document.activeElement = this;
  }
  blur() {
    if (globalThis.document.activeElement === this) globalThis.document.activeElement = null;
  }
  getContext() {
    return { clearRect() {}, drawImage() {}, fillRect() {}, createLinearGradient: () => ({ addColorStop() {} }) };
  }
}
const byId = new Map();
globalThis.document = {
  activeElement: null,
  head: new FakeEl("head"),
  body: new FakeEl("body"),
  createElement: (t) => new FakeEl(t),
  getElementById(id) {
    if (!byId.has(id)) byId.set(id, new FakeEl("div"));
    return byId.get(id);
  },
};
globalThis.performance ||= { now: () => Date.now() };

let passed = 0;
let failed = 0;
async function check(name, fn) {
  try {
    await fn();
    passed++;
    console.log(`  PASS  ${name}`);
  } catch (err) {
    failed++;
    console.log(`  FAIL  ${name}\n        ${err.stack?.split("\n").slice(0, 3).join("\n        ")}`);
  }
}
function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

const WT = await mod("js/worldtype.js");
const { Inventory, INVENTORY_SIZE, HOTBAR_SIZE, makeStack } = await mod("js/inventory.js");
const { InventoryScreen } = await mod("js/inventory-ui.js");
const { stackLabel } = await mod("js/slot-view.js");
const { shieldRaised, disableShield, offhandUse, shieldInOffhand } = await mod("js/content/items-vanilla.js");
const { enchantSeed, setEnchantSeed } = await mod("js/enchant.js");
const { ITEM, itemInfo, CREATIVE_ITEMS } = await mod("js/items.js");
const V = await mod("js/content/ids.js");

const icons = { get: () => null, glint: () => null };
function screen() {
  const inventory = new Inventory();
  const s = new InventoryScreen({ icons, inventory, audio: null });
  s.dropped = [];
  s.onDrop = (st) => s.dropped.push(st);
  return s;
}
const SWORD = V.IRON_SWORD ?? ITEM.STONE_SWORD;
const HELMET = CREATIVE_ITEMS.find((id) => itemInfo(id)?.armor?.slot === 0);
const CHEST2 = CREATIVE_ITEMS.filter((id) => itemInfo(id)?.armor?.slot === 1);
const TAG = { ench: [["sharpness", 5]], name: "Named" }; // (in cleanTag's key order)

await check("closing the screen gives the cursor back with its tag (enchantments, name)", () => {
  for (const type of ["survival", "missions"]) {
    WT.setWorldType(type);
    const s = screen();
    s.open("inventory", false);
    s.cursor = { id: SWORD, count: 1, dur: 100, tag: TAG };
    s.close();
    const back = s.inventory.slots.find(Boolean);
    assert(back && back.id === SWORD && back.dur === 100 && JSON.stringify(back.tag) === JSON.stringify(TAG), `${type}: ${JSON.stringify(back)}`);
  }
});

await check("a late container answer gives the cursor back with its tag", () => {
  WT.setWorldType("survival");
  const s = screen();
  let answer = null;
  s.chests = { submit: (changes, cb) => (answer = cb), closeView() {}, world: null };
  s.kind = "inventory";
  s._submit([], () => (s.cursor = { id: SWORD, count: 1, dur: 50, tag: TAG }));
  s.kind = null; // (the screen closed meanwhile)
  answer(true);
  const back = s.inventory.slots.find(Boolean);
  assert(back && JSON.stringify(back.tag) === JSON.stringify(TAG) && back.dur === 50, JSON.stringify(back));
});

await check("picked-up armor: put on in a Missions world, into the inventory in a Survival world", () => {
  WT.setWorldType("missions");
  const a = new Inventory();
  a.add(HELMET, 1);
  assert(a.armor[0]?.id === HELMET && !a.slots[0], "Missions: worn at once");
  WT.setWorldType("survival");
  const b = new Inventory();
  b.add(HELMET, 1);
  assert(!b.armor[0] && b.slots[0]?.id === HELMET && !b.wouldWear(HELMET), "Survival: into the hotbar");
});

await check("shift-click armor: Survival only into a free slot; Missions swaps; number keys over an armor slot", () => {
  const [better, worse] = CHEST2;
  WT.setWorldType("survival");
  let s = screen();
  s.open("inventory", false);
  const inv = s.inventory;
  inv.armor[1] = makeStack(better);
  inv.slots[20] = makeStack(worse);
  s._click({ area: "inv", index: 20 }, 0, true);
  assert(inv.armor[1]?.id === better && inv.slots[20] === null && inv.slots.some((x) => x?.id === worse), "Survival: the worn piece stays, the other moves");
  inv.armor[1] = null;
  const at = inv.slots.findIndex((x) => x?.id === worse);
  s._click({ area: "inv", index: at }, 0, true);
  assert(inv.armor[1]?.id === worse, "Survival: into the free slot");
  // Number keys over the armor slot: the worn piece to an empty hotbar slot, and back.
  s.hover = { area: "armor", index: 1 };
  inv.slots[4] = null;
  s.handleKey("Digit5", false);
  assert(!inv.armor[1] && inv.slots[4]?.id === worse, "key 5: off into the hotbar");
  s.handleKey("Digit5", false);
  assert(inv.armor[1]?.id === worse && !inv.slots[4], "key 5: back on");
  inv.slots[4] = makeStack(SWORD);
  s.handleKey("Digit5", false);
  assert(inv.armor[1]?.id === worse && inv.slots[4]?.id === SWORD, "a sword doesn't go on");
  s.close();
  WT.setWorldType("missions");
  s = screen();
  s.open("inventory", false);
  s.inventory.armor[1] = makeStack(better);
  s.inventory.slots[20] = makeStack(worse);
  s._click({ area: "inv", index: 20 }, 0, true);
  assert(s.inventory.armor[1]?.id === worse && s.inventory.slots[20]?.id === better, "Missions: swapped as before");
});

await check("shift-click from the chest: the hotbar's right end first (Survival), the left (Missions)", () => {
  for (const [type, want] of [["survival", HOTBAR_SIZE - 1], ["missions", 0]]) {
    WT.setWorldType(type);
    const s = screen();
    const view = { ready: true, gone: false, slots: new Array(27).fill(null) };
    view.slots[3] = makeStack(ITEM.COAL, 10);
    s.chestView = view;
    s.chests = { submit: (changes, cb) => { for (const [i, , after] of changes) view.slots[i] = after; cb(true); }, closeView() {} };
    s._chestClick(3, 0, true);
    assert(s.inventory.slots[want]?.id === ITEM.COAL && !view.slots[3], `${type}: ${JSON.stringify(s.inventory.slots.slice(0, 9))}`);
  }
});

await check("shift-click off the enchanting table: the hotbar's right end; off the anvil: the main area first", () => {
  WT.setWorldType("survival");
  const s = screen();
  s.enchSlots[1] = makeStack(V.LAPIS_LAZULI, 5);
  s._localClick("ench", 1, 0, true);
  assert(s.inventory.slots[HOTBAR_SIZE - 1]?.id === V.LAPIS_LAZULI, "the lapis to slot 9");
  s.anvilSlots[0] = makeStack(SWORD);
  s._localClick("anvil", 0, 0, true);
  assert(s.inventory.slots[HOTBAR_SIZE]?.id === SWORD, "the anvil's input to the main area's first slot");
});

await check("the off hand: saved after the armor (an old save has none), worn, counted, cleared", () => {
  WT.setWorldType("survival");
  const a = new Inventory();
  a.offhand = { ...makeStack(V.SHIELD), tag: TAG };
  const data = a.serializeArmor();
  assert(data.length === 5, `five entries: ${JSON.stringify(data)}`);
  const b = new Inventory();
  b.loadArmor(data);
  assert(b.offhand?.id === V.SHIELD && JSON.stringify(b.offhand.tag) === JSON.stringify(TAG) && b.armor.every((x) => !x), "loaded");
  b.loadArmor([0, 0, 0, 0]);
  assert(b.offhand === null, "an old save: no off hand");
  assert(new Inventory().serializeArmor().length === 4, "nothing in the off hand: the old four entries");
  b.offhand = makeStack(V.SHIELD);
  assert(b.countItem(V.SHIELD) === 1 && !b.isEmpty(), "counted");
  b.offhand.dur = 2;
  assert(b.damageOffhand(3) === true && b.offhand === null, "breaks");
  b.offhand = makeStack(V.SHIELD);
  b.clear();
  assert(b.offhand === null, "cleared");
  b.slots[0] = makeStack(SWORD);
  b.offhand = makeStack(V.SHIELD);
  b.selected = 0;
  assert(b.swapOffhand() && b.slots[0]?.id === V.SHIELD && b.offhand?.id === SWORD, "swapped");
});

await check("the off hand in the screen: F over a slot swaps; a shift-clicked shield goes in; shift out of it", () => {
  WT.setWorldType("survival");
  const s = screen();
  s.open("inventory", false);
  assert(!s.offhandView.el.classList.contains("hidden"), "shown in a Survival world");
  const inv = s.inventory;
  inv.slots[12] = makeStack(V.SHIELD);
  s._click({ area: "inv", index: 12 }, 0, true);
  assert(inv.offhand?.id === V.SHIELD && !inv.slots[12], "shift: the shield into the off hand");
  s._click({ area: "offhand", index: 0 }, 0, true);
  assert(!inv.offhand && inv.slots[HOTBAR_SIZE]?.id === V.SHIELD, "shift: out into the main area");
  inv.slots[3] = makeStack(ITEM.TORCH ?? ITEM.COAL, 5);
  s.hover = { area: "inv", index: 3 };
  assert(s.handleKey("KeyF", false) === true && inv.offhand && !inv.slots[3], "F: into the off hand");
  s.close();
  WT.setWorldType("missions");
  const m = screen();
  m.open("inventory", false);
  assert(m.offhandView.el.classList.contains("hidden"), "hidden in a Missions world");
  m.hover = { area: "inv", index: 0 };
  assert(m.handleKey("KeyF", false) === false, "F does nothing there");
});

await check("the shield raised from the off hand blocks; an axe's blow disables it for 5 s", () => {
  const inv = new Inventory();
  inv.slots[0] = makeStack(SWORD);
  inv.offhand = makeStack(V.SHIELD);
  const player = {};
  const ctx = { player, inventory: inv, stack: inv.slots[0] };
  assert(offhandUse(ctx) === true && shieldInOffhand(inv), "raised from the off hand");
  player.shieldRaisedAt -= 0.3; // (raised a moment ago)
  assert(shieldRaised(player, inv), "blocks");
  disableShield(player);
  assert(!shieldRaised(player, inv), "disabled");
  offhandUse(ctx);
  assert(!(player.shieldRaisedUntil > performance.now() / 1000), "not raised again while disabled");
  inv.offhand = null;
  assert(offhandUse({ player: {}, inventory: inv, stack: inv.slots[0] }) === false, "no shield: nothing");
});

await check("the enchanting seed set back from a save", () => {
  setEnchantSeed(123456);
  assert(enchantSeed() === 123456, "set");
  setEnchantSeed("junk");
  setEnchantSeed(-5);
  assert(enchantSeed() === 123456, "junk ignored");
});

await check("food labels: 'heals N' in a Missions world, the name alone in a Survival world", () => {
  WT.setWorldType("missions");
  const m = [ITEM.APPLE, ITEM.GOLDEN_APPLE, ITEM.RAW_MEAT, ITEM.COOKED_MEAT].map((id) => stackLabel(makeStack(id)));
  assert(m.join("|") === "Apple (heals 2 ♥)|Golden Apple (heals 10 ♥)|Raw Meat (heals 1 ♥)|Cooked Meat (heals 4 ♥)", m.join("|"));
  WT.setWorldType("survival");
  assert(stackLabel(makeStack(ITEM.APPLE)) === "Apple", stackLabel(makeStack(ITEM.APPLE)));
});

await check("Creative palette: Survival opens on Blocks, a Combat tab, search; Missions as before", () => {
  const shown = (s) => s.paletteViews.filter((v) => !v.el.classList.contains("hidden")).map((v, k) => v);
  const ids = (s) => CREATIVE_ITEMS.filter((id, k) => !s.paletteViews[k].el.classList.contains("hidden"));
  WT.setWorldType("missions");
  let s = screen();
  s.open("inventory", true);
  assert(s.tab === 0 && s.tabBtns[0].textContent === "Weapons" && !s.tabBtns[3].classList.contains("hidden"), "Missions: Weapons first, an Armor tab");
  s.close();
  WT.setWorldType("survival");
  s = screen();
  s.open("inventory", true);
  assert(s.tab === 1 && s.tabBtns[0].textContent === "Combat" && s.tabBtns[3].classList.contains("hidden"), "Survival: opens on Blocks, Combat, no Armor tab");
  s.setTab(0);
  const combat = ids(s);
  assert(combat.includes(V.SHIELD) && combat.includes(V.ARROW) && combat.includes(HELMET) && combat.some((id) => itemInfo(id)?.tool?.type === "sword"), "Combat: shield, arrow, armor, swords");
  s.setTab(2);
  assert(!ids(s).some((id) => itemInfo(id)?.tool?.type === "sword" || id === V.SHIELD), "Tools: no swords or shield");
  const search = s.tabBtns.length - 1;
  s.setTab(search);
  assert(!s.searchEl.classList.contains("hidden") && ids(s).length === shown(s).length, "the search box shows");
  s.searchEl.value = "oak fence gate";
  s.searchEl.dispatch("input");
  const found = ids(s).map((id) => itemInfo(id).name);
  assert(found.length >= 1 && found.every((n) => /oak fence gate/i.test(n)), `found: ${found}`);
  s.setTab(1);
  assert(s.searchEl.classList.contains("hidden"), "hidden on the other tabs");
  s.close();
});

console.log(`\n${passed} passed, ${failed} failed.`);
process.exit(failed ? 1 : 0);
