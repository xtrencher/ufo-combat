// In-game HUD: the inventory-backed hotbar, health hearts, air bubbles, the
// name of the selected item, a red flash when hurt, and the death screen.
// (Round 11, Survival worlds) The hunger bar right of the hearts, the XP bar
// and level over the hotbar, status effects top right, the burning overlay.
// All pixel art (hearts, bubbles, drumsticks, effect icons) is drawn in code.
import { HOTBAR_SIZE } from "./inventory.js";
import { MAX_HEALTH, MAX_AIR } from "./player.js";
import { SlotView, stackLabel } from "./slot-view.js";
import { isVanilla } from "./worldtype.js";
import { EFFECTS, MAX_FOOD, formatEffectTime, effectLevelName } from "./survival.js";

const PX = 2; // screen pixels per art pixel

// 9x8 heart: k outline, r red, h highlight, d shade, . empty.
const HEART = [
  ".kkk.kkk.",
  "krrrkrrrk",
  "krhrrrrrk",
  "krrrrrrdk",
  ".krrrrdk.",
  "..krrdk..",
  "...kdk...",
  "....k....",
];

const BUBBLE = [
  "..kkkkk..",
  ".kbbbbbk.",
  "kbwwbbbbk",
  "kbwbbbbbk",
  "kbbbbbbbk",
  "kbbbbbbck",
  "kbbbbbcck",
  ".kbbbcck.",
  "..kkkkk..",
];

// 9x9 drumstick (the hunger bar): M meat, H highlight, D shade, W bone.
const DRUMSTICK = [
  "..kkkk...",
  ".kMMHHk..",
  "kMMMMHMk.",
  "kMMMMMMk.",
  "kDMMMMDk.",
  ".kDDDDWk.",
  "..kkkWWWk",
  ".....kWWk",
  "......kk.",
];

// Status effect icons (9x9): a drop (poison), a flame, an arrow (speed).
const DROP = [
  "....k....",
  "...kSk...",
  "..kSTSk..",
  ".kSTSSSk.",
  ".kSTSSSk.",
  "kSSSSSSUk",
  "kSSSSSUUk",
  ".kSSUUUk.",
  "..kkkkk..",
];
const FLAME = [
  "....k....",
  "...kFk...",
  "..kFOFk..",
  ".kFOFOFk.",
  "kFOOyOOFk",
  "kFOyyyOFk",
  "kFOyyyOFk",
  ".kFOOOFk.",
  "..kkkkk..",
];
const ARROW = [
  "....k....",
  "...kXk...",
  "..kXXXk..",
  ".kXXXXXk.",
  "kkkXXXkkk",
  "...kXk...",
  "...kXk...",
  "...kXk...",
  "...kkk...",
];

const COLORS = {
  k: "#1a0606",
  M: "#c4702c",
  H: "#eaa45e",
  D: "#7a3e14",
  W: "#efe6cf",
  P: "#7d9a3a",
  Q: "#a9c25c",
  R: "#4b5e1e",
  S: "#8f9e24",
  T: "#d2dc78",
  U: "#5a6414",
  F: "#e8501a",
  O: "#ff9a1a",
  X: "#9fd4ff",
  r: "#e3222c",
  h: "#ffb7b0",
  d: "#9e1119",
  e: "#3a2a2a",
  w: "#ffffff",
  b: "#4aa8ff",
  c: "#2c6fc9",
  A: "#c8ced6",
  a: "#8c95a1",
  x: "#444b55",
  G: "#ffd23a",
  g: "#c8890a",
  y: "#fff3a0",
};

// Draws pixel art rows; `fill(x, ch)` may substitute colors per column.
function drawArt(rows, fill = (x, ch) => ch) {
  const canvas = document.createElement("canvas");
  canvas.width = rows[0].length * PX;
  canvas.height = rows.length * PX;
  const ctx = canvas.getContext("2d");
  rows.forEach((row, y) => {
    for (let x = 0; x < row.length; x++) {
      const ch = fill(x, row[x]);
      if (ch === "." || !COLORS[ch]) continue;
      ctx.fillStyle = COLORS[ch];
      ctx.fillRect(x * PX, y * PX, PX, PX);
    }
  });
  return canvas;
}

// 9x9 chestplate for the armor bar: k outline, A plate, a shade, . empty.
const ARMOR_ICON = [
  "kk.....kk",
  "kAkkkkkAk",
  "kAAAAAAAk",
  "kAAAkAAAk",
  "kAAAkAAAk",
  ".kAAAAAk.",
  ".kAAaAAk.",
  ".kAaaaAk.",
  "..kkkkk..",
];

function armorArt(kind) {
  return drawArt(ARMOR_ICON, (x, ch) => {
    if (ch === ".") return ".";
    if (kind === "empty" || (kind === "half" && x > 4)) return ch === "k" ? "k" : "x";
    return ch;
  });
}

function heartArt(kind, flash = false) {
  const inner = (x, ch) => {
    if (ch === "k") return flash ? "w" : "k";
    if (ch === ".") return ".";
    if (kind === "empty" || (kind === "half" && x > 4)) return "e";
    return ch;
  };
  return drawArt(HEART, inner);
}

// (Round 11) A poisoned heart: the red turned sickly green, as vanilla's.
function poisonHeartArt(kind, flash = false) {
  return drawArt(HEART, (x, ch) => {
    if (ch === "k") return flash ? "w" : "k";
    if (ch === ".") return ".";
    if (kind === "empty" || (kind === "half" && x > 4)) return "e";
    return ch === "r" ? "S" : ch === "h" ? "T" : ch === "d" ? "U" : ch;
  });
}

// A drumstick: full, half (the bar fills from the right, so the right half)
// or empty; green with the hunger effect.
function foodArt(kind, hungry = false) {
  return drawArt(DRUMSTICK, (x, ch) => {
    if (ch === "." || ch === "k") return ch;
    if (kind === "empty" || (kind === "half" && x < 4)) return "e";
    if (hungry) return ch === "M" ? "P" : ch === "H" ? "Q" : ch === "D" ? "R" : ch;
    return ch;
  });
}

// A status effect's icon, by survival.js EFFECTS[...].icon.
function effectArt(icon) {
  if (icon === "drop") return drawArt(DROP);
  if (icon === "flame") return drawArt(FLAME);
  if (icon === "arrow") return drawArt(ARROW);
  if (icon === "bubble") return drawArt(BUBBLE);
  if (icon === "drumstick") return foodArt("full", true);
  if (icon === "goldheart") return goldHeartArt();
  // (regeneration and the rest: a pink heart)
  return drawArt(HEART, (x, ch) => (ch === "r" ? "h" : ch === "h" ? "w" : ch));
}

// A golden heart (absorption): the red shades swapped for gold.
function goldHeartArt(half = false) {
  return drawArt(HEART, (x, ch) => {
    if (ch === ".") return ".";
    if (half && x > 4 && ch !== "k") return "e";
    if (ch === "r") return "G";
    if (ch === "d") return "g";
    if (ch === "h") return "y";
    return ch;
  });
}

export class Hud {
  constructor({ icons, inventory }) {
    this.icons = icons;
    this.inventory = inventory;
    this.rootEl = document.getElementById("hud");
    this.hotbarEl = document.getElementById("hotbar");
    this.heartsEl = document.getElementById("hearts");
    this.bubblesEl = document.getElementById("bubbles");
    this.itemNameEl = document.getElementById("item-name");
    this.damageEl = document.getElementById("damage-flash");
    this.modeEl = document.getElementById("mode-badge");
    this.deathEl = document.getElementById("death-screen");
    this.deathCauseEl = document.getElementById("death-cause");
    this.respawnBtn = document.getElementById("respawn-btn");
    this.throwEl = document.getElementById("throw-charge");
    this.throwFill = this.throwEl.firstElementChild;
    this._throw = 0;
    this.chargeEl = document.getElementById("attack-charge");
    this.chargeFill = this.chargeEl.firstElementChild;
    this._charge = 1;

    this.art = {
      full: heartArt("full"),
      half: heartArt("half"),
      empty: heartArt("empty"),
      fullFlash: heartArt("full", true),
      halfFlash: heartArt("half", true),
      emptyFlash: heartArt("empty", true),
      bubble: drawArt(BUBBLE),
    };

    this.hearts = [];
    for (let i = 0; i < MAX_HEALTH / 2; i++) {
      const c = document.createElement("canvas");
      c.width = this.art.full.width;
      c.height = this.art.full.height;
      c.className = "heart";
      this.heartsEl.appendChild(c);
      this.hearts.push({ el: c, ctx: c.getContext("2d"), shown: "" });
    }
    // Golden hearts (absorption), a second row above the hearts.
    this.goldEl = document.getElementById("absorb");
    this.goldArt = { full: goldHeartArt(), half: goldHeartArt(true) };
    this.gold = [];
    for (let i = 0; i < 10; i++) {
      const c = document.createElement("canvas");
      c.width = this.art.full.width;
      c.height = this.art.full.height;
      c.className = "heart";
      this.goldEl.appendChild(c);
      this.gold.push({ el: c, ctx: c.getContext("2d"), shown: -1 });
    }
    this._shownGold = -1;
    // The armor bar (a row of ten chestplates, above the hearts) and the weapon status (rounds, reload).
    this.armorEl = document.getElementById("armor-bar");
    this.armorArt = { full: armorArt("full"), half: armorArt("half"), empty: armorArt("empty") };
    this.armorIcons = [];
    for (let i = 0; i < 10; i++) {
      const c = document.createElement("canvas");
      c.width = this.armorArt.full.width;
      c.height = this.armorArt.full.height;
      c.className = "heart";
      this.armorEl.appendChild(c);
      this.armorIcons.push({ el: c, ctx: c.getContext("2d") });
    }
    this._shownArmor = -1;
    this.weaponEl = document.getElementById("weapon-status");
    this.weaponLabel = this.weaponEl.querySelector(".ws-label");
    this.weaponAmmo = this.weaponEl.querySelector(".ws-ammo");
    this.weaponFill = this.weaponEl.querySelector(".ws-bar > div");
    this.reloadEl = document.getElementById("reload-bar");
    this.reloadFill = this.reloadEl.firstElementChild;
    this.bubbles = [];
    for (let i = 0; i < MAX_AIR; i++) {
      const c = document.createElement("canvas");
      c.width = this.art.bubble.width;
      c.height = this.art.bubble.height;
      c.getContext("2d").drawImage(this.art.bubble, 0, 0);
      c.className = "bubble";
      this.bubblesEl.appendChild(c);
      this.bubbles.push(c);
    }

    // (Round 11) The hunger bar: ten drumsticks right of the hearts, filling
    // from the right (mirrored to the hearts, as vanilla's).
    this.foodEl = document.getElementById("food");
    this.art.poison = {};
    for (const k of ["full", "half", "empty"]) {
      this.art.poison[k] = poisonHeartArt(k);
      this.art.poison[`${k}Flash`] = poisonHeartArt(k, true);
    }
    this.foodArt = {};
    for (const k of ["full", "half", "empty"]) {
      this.foodArt[k] = foodArt(k);
      this.foodArt[`${k}Hungry`] = foodArt(k, true);
    }
    this.food = [];
    for (let i = 0; i < MAX_FOOD / 2; i++) {
      const c = document.createElement("canvas");
      c.width = this.foodArt.full.width;
      c.height = this.foodArt.full.height;
      c.className = "heart";
      this.foodEl.appendChild(c);
      this.food.push({ el: c, ctx: c.getContext("2d"), y: 0 });
    }
    this._shownFood = "";
    this._foodShake = 0;
    // The XP bar and level, over the hotbar.
    this.xpEl = document.getElementById("xp-bar");
    this.xpFill = this.xpEl.querySelector(".xp-fill");
    this.xpLevelEl = this.xpEl.querySelector(".xp-level");
    this._shownXp = "";
    // Status effects (top right) and the burning overlay.
    this.effectsEl = document.getElementById("effects-bar");
    this._effectViews = new Map(); // effect name -> { el, time, shown }
    this._effectArt = {};
    this._effectsT = 0;
    this.fireEl = document.getElementById("fire-overlay");
    this._burning = false;
    this._survivalHud = null;
    this._regenWave = false;

    this.slots = [];
    this.hotbarEl.innerHTML = "";
    for (let i = 0; i < HOTBAR_SIZE; i++) {
      const view = new SlotView(icons, "hotbar-slot");
      const label = document.createElement("div");
      label.className = "key-label";
      label.textContent = String(i + 1);
      view.el.appendChild(label);
      this.hotbarEl.appendChild(view.el);
      this.slots.push(view);
    }
    // (A Survival world) The off hand, left of the hotbar as vanilla's (shown
    // while it holds something).
    this.offhandView = new SlotView(icons, "hotbar-slot hidden");
    this.offhandView.el.id = "offhand-slot";
    this.offhandView.el.style.cssText = "position: fixed; bottom: 14px; left: calc(50% - 318px); z-index: 10; pointer-events: none;";
    this.hotbarEl.parentNode?.insertBefore(this.offhandView.el, this.hotbarEl);
    if (!document.getElementById("offhand-css")) {
      const st = document.createElement("style");
      st.id = "offhand-css";
      st.textContent = "body.in-vehicle #offhand-slot { display: none; }";
      document.head.appendChild(st);
    }
    this._offhandShown = false;
    this._selected = -1;
    this._nameTimer = 0;
    this._lastName = "";
    this._shownHealth = -1;
    this._shownAir = -1;
    this._flashTime = 99;
    this._mode = null;
    this._wasLow = false;
  }

  show(visible) {
    this.rootEl.classList.toggle("hidden", !visible);
  }

  // The item name sits above the extra rows (golden hearts, armor).
  _nameLift() {
    const rows = (this._hasGold ? 1 : 0) + (this._hasArmor ? 1 : 0);
    const xp = this._survivalHud ? 12 : 0; // (the XP bar lifts the rows above it)
    this.itemNameEl.style.bottom = rows === 0 && !xp ? "" : `${94 + rows * 24 + xp}px`;
  }

  // Refreshes the hotbar slots and selection (cheap when nothing changed).
  refreshHotbar() {
    const inv = this.inventory;
    for (let i = 0; i < HOTBAR_SIZE; i++) this.slots[i].set(inv.slots[i]);
    this.offhandView.set(inv.offhand || null);
    if (!!inv.offhand !== this._offhandShown) this.offhandView.el.classList.toggle("hidden", !(this._offhandShown = !!inv.offhand));
    // The armor bar: ten chestplates, two defense points each.
    const pts = inv.armorPoints();
    let sig = pts; // (a number built in a loop: this runs every frame)
    for (const a of inv.armor) sig = sig * 256 + (a ? Math.ceil(a.dur / 8) % 256 : 0);
    if (sig !== this._shownArmor) {
      this._shownArmor = sig;
      this.armorEl.classList.toggle("hidden", pts <= 0);
      this._hasArmor = pts > 0;
      this._nameLift();
      for (let i = 0; i < this.armorIcons.length; i++) {
        const v = pts - i * 2;
        const a = this.armorIcons[i];
        a.ctx.clearRect(0, 0, a.el.width, a.el.height);
        a.ctx.drawImage(v >= 2 ? this.armorArt.full : v === 1 ? this.armorArt.half : this.armorArt.empty, 0, 0);
      }
    }
    if (inv.selected !== this._selected && this.slots[inv.selected]) {
      if (this._selected >= 0) this.slots[this._selected].el.classList.remove("selected");
      this._selected = inv.selected;
      this.slots[this._selected].el.classList.add("selected");
    }
    // Show the item's name briefly whenever the held item changes.
    const id = inv.selectedStack ? inv.selectedStack.id : 0;
    const key = `${this._selected}:${id}`;
    if (key !== this._lastName) {
      this._lastName = key;
      const name = stackLabel(inv.selectedStack);
      if (name) {
        this.itemNameEl.textContent = name;
        this._nameTimer = 2.2;
      } else {
        this._nameTimer = 0;
      }
    }
  }

  // Attack recharge (0-1): a small bar under the crosshair while < 1.
  setAttackCharge(charge) {
    const shown = charge >= 1 ? 1 : Math.round(charge * 20) / 20;
    if (shown === this._charge) return;
    this._charge = shown;
    this.chargeEl.classList.toggle("hidden", shown >= 1);
    this.chargeFill.style.width = `${Math.round(shown * 100)}%`;
  }

  // Throw strength (0-1) while a grenade is drawn back: a bar under the crosshair.
  setThrowCharge(charge) {
    const shown = Math.round(charge * 40) / 40;
    if (shown === this._throw) return;
    this._throw = shown;
    this.throwEl.classList.toggle("hidden", shown <= 0);
    this.throwFill.style.width = `${Math.round(shown * 100)}%`;
    this.throwEl.classList.toggle("full", shown >= 1);
  }

  hurt() {
    this._flashTime = 0;
  }

  update(dt, player) {
    this._time = (this._time || 0) + dt;
    this.refreshHotbar();
    this._nameTimer -= dt;
    const nameOpacity = String(Math.max(0, Math.min(1, this._nameTimer / 0.4)));
    if (nameOpacity !== this._nameOpacity) {
      this._nameOpacity = nameOpacity; // (written only on a change: mostly it stays "0")
      this.itemNameEl.style.opacity = nameOpacity;
    }

    if (player.mode !== this._mode) {
      this._mode = player.mode;
      this.modeEl.textContent = player.creative ? "Creative" : "";
      this.modeEl.classList.toggle("hidden", !player.creative);
      this.heartsEl.classList.toggle("hidden", player.creative);
      this._shownHealth = -1;
    }
    // (Round 11) A Survival world's bars: hunger and XP (not in Creative).
    const survival = isVanilla() && !player.creative;
    if (survival !== this._survivalHud) {
      this._survivalHud = survival;
      this.foodEl.classList.toggle("hidden", !survival);
      this.xpEl.classList.toggle("hidden", !survival);
      document.body.classList.toggle("xp-on", survival);
      this._shownFood = this._shownXp = "";
      this._nameLift();
    }

    // Hearts: re-drawn when health changes or while flashing after damage.
    this._flashTime += dt;
    const flashing = this._flashTime < 0.6 && Math.floor(this._flashTime * 10) % 2 === 0;
    const hp = Math.ceil(player.health);
    const poisoned = player.effects?.length ? player.effectLevel("poison") > 0 : false;
    const sig = `${hp}:${flashing}:${poisoned}`;
    if (sig !== this._shownHealth && !player.creative) {
      this._shownHealth = sig;
      const set = poisoned ? this.art.poison : this.art;
      for (let i = 0; i < this.hearts.length; i++) {
        const h = this.hearts[i];
        const v = hp - i * 2;
        const kind = v >= 2 ? "full" : v === 1 ? "half" : "empty";
        const art = set[flashing ? `${kind}Flash` : kind];
        h.ctx.clearRect(0, 0, h.el.width, h.el.height);
        h.ctx.drawImage(art, 0, 0);
      }
    }
    // Golden hearts.
    const gold = player.creative ? 0 : Math.ceil(player.absorption || 0);
    if (gold !== this._shownGold) {
      this._shownGold = gold;
      this.goldEl.classList.toggle("hidden", gold <= 0);
      this._hasGold = gold > 0;
      this._nameLift();
      for (let i = 0; i < this.gold.length; i++) {
        const v = gold - i * 2;
        const g = this.gold[i];
        g.ctx.clearRect(0, 0, g.el.width, g.el.height);
        if (v >= 1) g.ctx.drawImage(v >= 2 ? this.goldArt.full : this.goldArt.half, 0, 0);
      }
    }
    // Low health: the hearts jitter. (Regeneration: a wave runs along them, as vanilla's.)
    const low = !player.creative && !player.dead && hp <= 4;
    const regen = !player.creative && !player.dead && player.effects?.length > 0 && player.effectLevel("regeneration") > 0;
    if (low || regen || this._wasLow) {
      const wave = regen ? Math.floor(this._time * 20) % (this.hearts.length + 5) : -1;
      for (let i = 0; i < this.hearts.length; i++) {
        const y = (low ? Math.round((Math.random() - 0.5) * 3) : 0) - (i === wave ? 3 : 0);
        const t = y ? `translateY(${y}px)` : "";
        if (this.hearts[i].el.style.transform !== t) this.hearts[i].el.style.transform = t;
      }
      this._wasLow = low || regen;
    }
    if (this._survivalHud) this._updateSurvival(dt, player);
    this._updateEffects(dt, player);
    const burning = !player.creative && !player.dead && player.fireTime > 0 && !player.vehicle;
    if (burning !== this._burning) {
      this._burning = burning;
      this.fireEl.classList.toggle("hidden", !burning);
    }

    // Air bubbles: only while breath is being used.
    const showAir = !player.creative && (player.headInWater || player.air < MAX_AIR - 0.01);
    this.bubblesEl.classList.toggle("hidden", !showAir);
    if (showAir) {
      const n = Math.ceil(player.air - 0.001);
      if (n !== this._shownAir) {
        this._shownAir = n;
        this.bubbles.forEach((b, i) => (b.style.visibility = i < n ? "visible" : "hidden"));
      }
    }

    // Red vignette flash when hurt.
    // (plus a slow pulse while health is low).
    const f = Math.max(0, 1 - this._flashTime / 0.5) * 0.8;
    const pulse = low ? 0.22 + 0.12 * Math.sin(this._time * 5) : 0;
    const opacity = Math.round(Math.max(f, pulse) * 100) / 100;
    if (opacity !== this._shownFlash) {
      this._shownFlash = opacity;
      this.damageEl.style.opacity = String(opacity);
    }
  }

  // (Round 11) The hunger and XP bars (a Survival world in survival mode).
  _updateSurvival(dt, player) {
    // Drumsticks: redrawn when the food changes; green with the hunger
    // effect. With no saturation left they shake (vanilla: more often the
    // lower the food).
    const food = Math.max(0, Math.min(MAX_FOOD, Math.ceil(player.food)));
    const hungry = player.effects.length > 0 && player.effectLevel("hunger") > 0;
    const sig = `${food}:${hungry}`;
    if (sig !== this._shownFood) {
      this._shownFood = sig;
      for (let i = 0; i < this.food.length; i++) {
        const f = this.food[i];
        const v = food - i * 2;
        const kind = v >= 2 ? "full" : v === 1 ? "half" : "empty";
        f.ctx.clearRect(0, 0, f.el.width, f.el.height);
        f.ctx.drawImage(this.foodArt[hungry ? `${kind}Hungry` : kind], 0, 0);
      }
    }
    // (A jolt of one frame, every food * 3 + 1 ticks, as vanilla's.)
    const shake = !player.dead && player.saturation <= 0;
    this._foodShake += dt;
    const jolt = shake && this._foodShake >= (food * 3 + 1) / 20;
    if (jolt) this._foodShake = 0;
    for (const f of this.food) {
      const y = jolt ? Math.round(Math.random() * 3) - 1 : 0;
      if (y !== f.y) {
        f.y = y;
        f.el.style.transform = y ? `translateY(${y}px)` : "";
      }
    }
    // The XP bar (the way to the next level) and the level, in green.
    const fill = Math.round(Math.max(0, Math.min(1, player.xpProgress)) * 182);
    const xsig = `${player.xpLevel}:${fill}`;
    if (xsig !== this._shownXp) {
      this._shownXp = xsig;
      this.xpFill.style.width = `${(fill / 182) * 100}%`;
      this.xpLevelEl.textContent = player.xpLevel > 0 ? String(player.xpLevel) : "";
    }
  }

  // Status effects, top right: an icon each, its level and time left (it
  // blinks in its last 10 s, as vanilla's). Refreshed 4 times a second.
  _updateEffects(dt, player) {
    this._effectsT -= dt;
    if (this._effectsT > 0) return;
    this._effectsT = 0.25;
    const list = player.creative || player.dead ? [] : player.effects || [];
    const views = this._effectViews;
    for (const [name, v] of views) {
      if (list.some((e) => e.effect === name)) continue;
      v.el.remove();
      views.delete(name);
    }
    for (const e of list) {
      let v = views.get(e.effect);
      if (!v) {
        const info = EFFECTS[e.effect] || { name: e.effect, color: "#9aa", icon: "heart" };
        const el = document.createElement("div");
        el.className = "fx";
        el.style.borderColor = info.color;
        el.title = info.name;
        const icon = info.icon;
        this._effectArt[icon] ||= effectArt(icon);
        const c = document.createElement("canvas");
        c.width = this._effectArt[icon].width;
        c.height = this._effectArt[icon].height;
        c.getContext("2d").drawImage(this._effectArt[icon], 0, 0);
        const time = document.createElement("span");
        el.append(c, time);
        this.effectsEl.appendChild(el);
        v = { el, time, shown: "" };
        views.set(e.effect, v);
      }
      const text = `${effectLevelName(e.level)}${e.level > 1 ? " " : ""}${formatEffectTime(e.time)}`;
      if (text !== v.shown) {
        v.shown = text;
        v.time.textContent = text;
      }
      v.el.classList.toggle("ending", e.time < 10);
    }
    this.effectsEl.classList.toggle("hidden", list.length === 0);
  }

  // The weapon in hand: rounds left and the reload / cooldown (st from
  // weapons.status(), or null for no weapon).
  setWeaponStatus(st) {
    const sig = st ? `${st.kind}:${st.ammo ?? ""}:${Math.round((st.reload ?? 1) * 40)}:${Math.round((st.heat ?? 0) * 40)}:${st.overheated ? 1 : 0}` : "";
    if (sig === this._weaponSig) return;
    this._weaponSig = sig;
    this.weaponEl.classList.toggle("hidden", !st);
    const busy = !!st && (st.reloading || st.overheated);
    this.reloadEl.classList.toggle("hidden", !busy);
    if (!st) return;
    this.reloadFill.style.width = `${Math.round((st.reload ?? 1) * 100)}%`;
    if (st.heat !== undefined) {
      this.weaponLabel.textContent = st.overheated ? st.label : "Heat";
      this.weaponAmmo.textContent = "";
      this.weaponFill.style.width = `${Math.round(st.heat * 100)}%`;
      this.weaponEl.classList.toggle("hot", st.overheated || st.heat > 0.75);
      return;
    }
    this.weaponEl.classList.remove("hot");
    this.weaponLabel.textContent = st.reloading ? st.label : "";
    this.weaponAmmo.innerHTML = st.mag > 1 ? `${st.ammo}<small> / ${st.mag}</small>` : st.reloading ? "" : "READY";
    this.weaponFill.style.width = `${Math.round((st.reloading ? st.reload : st.ammo / st.mag) * 100)}%`;
  }

  showDeath(message) {
    this.deathCauseEl.textContent = message;
    this.deathEl.classList.remove("hidden");
    // Replaying the entrance animation.
    this.deathEl.classList.remove("show");
    void this.deathEl.offsetWidth;
    this.deathEl.classList.add("show");
    // The button unlocks after a moment so a panicked click doesn't skip the screen.
    this.respawnBtn.disabled = true;
    clearTimeout(this._respawnTimer);
    this._respawnTimer = setTimeout(() => (this.respawnBtn.disabled = false), 900);
  }

  hideDeath() {
    this.deathEl.classList.add("hidden");
    this.deathEl.classList.remove("show");
  }
}
