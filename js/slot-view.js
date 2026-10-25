// Item icons and inventory slot widgets shared by the hotbar and the
// inventory / crafting screens. Icons are drawn once per item id and cached;
// a slot only redraws when its stack actually changes.
// (Round 11) An enchanted stack's icon has the glint (a purple sheen drawn
// once over the item's pixels, cached per id), its tooltip the enchantments
// (stackLines), a potion's its effects; a custom name (the anvil's) replaces
// the item's.
import { BLOCK_INFO } from "./blocks.js";
import { itemInfo, foodHeal } from "./items.js";
import { vanillaRules } from "./worldtype.js";
import { itemIconCanvas } from "./itemtextures.js";
import { drawBlockIcon } from "./textures.js";
import { enchantLines, isEnchanted } from "./enchant.js";
import { EFFECTS, effectLevelName, formatEffectTime } from "./survival.js";

const ICON = 32;

export class IconCache {
  constructor(tileCanvases) {
    this.tileCanvases = tileCanvases;
    this.cache = new Map();
  }

  // A 32x32 canvas for item `id` (block ids get an isometric cube), or null.
  get(id) {
    if (this.cache.has(id)) return this.cache.get(id);
    const info = itemInfo(id);
    let canvas = null;
    if (info?.block) canvas = drawBlockIcon(this.tileCanvases, BLOCK_INFO[info.block], ICON);
    else if (info) canvas = itemIconCanvas(id);
    this.cache.set(id, canvas);
    return canvas;
  }

  // The icon with the enchantment glint (made once per id).
  glint(id) {
    const key = -1 - id;
    if (this.cache.has(key)) return this.cache.get(key);
    const base = this.get(id);
    let canvas = null;
    if (base && typeof document !== "undefined") {
      canvas = document.createElement("canvas");
      canvas.width = ICON;
      canvas.height = ICON;
      const ctx = canvas.getContext("2d");
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(base, 0, 0, ICON, ICON);
      // (Diagonal bands of violet light, only over the item's own pixels.)
      ctx.globalCompositeOperation = "source-atop";
      const g = ctx.createLinearGradient(0, 0, ICON, ICON);
      for (let k = 0; k <= 6; k++) g.addColorStop(k / 6, k % 2 ? "rgba(190,110,255,0.42)" : "rgba(120,60,220,0.12)");
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, ICON, ICON);
      ctx.globalCompositeOperation = "lighter";
      ctx.fillStyle = "rgba(60,20,90,0.25)";
      ctx.fillRect(0, 0, ICON, ICON);
      ctx.globalCompositeOperation = "destination-in";
      ctx.drawImage(base, 0, 0, ICON, ICON);
    }
    this.cache.set(key, canvas);
    return canvas;
  }
}

// The stack's name: its custom name (the anvil's), else the item's.
export function stackName(stack) {
  const info = stack ? itemInfo(stack.id) : null;
  if (!info) return "";
  return stack.tag?.name || info.name;
}

export function stackLabel(stack) {
  if (!stack) return "";
  const info = itemInfo(stack.id);
  if (!info) return "";
  const name = stackName(stack);
  const wear = info.tool || info.armor; // (armor wears out too)
  if (stack.dur !== undefined && wear) return `${name} (${stack.dur}/${wear.durability})`;
  // (A food before Round 13's vanilla hunger in a Missions world: what it
  // healed at once; now the name alone, as vanilla.)
  const heal = !vanillaRules() ? foodHeal(info) : 0;
  if (heal > 0) return `${name} (heals ${heal / 2} ♥)`;
  return name;
}

// (Round 11) The tooltip's lines: [text, kind] with kind "name" (its first),
// "ench" (an enchantment), "good" / "bad" (a potion's effects), "note".
export function stackLines(stack) {
  const label = stackLabel(stack);
  if (!label) return [];
  const info = itemInfo(stack.id);
  const out = [[label, isEnchanted(stack) || stack.tag?.name ? "name ench-name" : "name"]];
  for (const line of enchantLines(stack)) out.push([line, "ench"]);
  const pot = info?.potion;
  if (pot) {
    if (!pot.effects?.length) out.push(["No Effects", "note"]);
    for (const e of pot.effects || []) {
      const def = EFFECTS[e.id];
      const lvl = effectLevelName(e.level ?? 1);
      const time = def?.instant || !(e.seconds > 0) ? "" : ` (${formatEffectTime(e.seconds)})`;
      out.push([`${def?.name ?? e.id}${lvl ? ` ${lvl}` : ""}${time}`, def?.bad ? "bad" : "good"]);
    }
  }
  return out;
}

// One slot: a square with the item icon, a stack count and a durability bar.
export class SlotView {
  constructor(icons, className = "slot") {
    this.icons = icons;
    this.el = document.createElement("div");
    this.el.className = className;
    this.canvas = document.createElement("canvas");
    this.canvas.width = ICON;
    this.canvas.height = ICON;
    this.ctx = this.canvas.getContext("2d");
    this.ctx.imageSmoothingEnabled = false;
    this.countEl = document.createElement("span");
    this.countEl.className = "slot-count";
    this.barEl = document.createElement("div");
    this.barEl.className = "slot-dur hidden";
    this.barFill = document.createElement("div");
    this.barEl.appendChild(this.barFill);
    this.el.append(this.canvas, this.countEl, this.barEl);
    this._sig = null;
    this.stack = null;
  }

  set(stack) {
    this.stack = stack;
    const sig = stack ? `${stack.id}:${stack.count}:${stack.dur ?? ""}:${isEnchanted(stack) ? 1 : 0}` : "";
    if (sig === this._sig) return;
    this._sig = sig;
    this.ctx.clearRect(0, 0, ICON, ICON);
    this.countEl.textContent = "";
    this.barEl.classList.add("hidden");
    if (!stack) return;
    const icon = isEnchanted(stack) ? this.icons.glint?.(stack.id) || this.icons.get(stack.id) : this.icons.get(stack.id);
    if (icon) this.ctx.drawImage(icon, 0, 0, ICON, ICON);
    if (stack.count > 1) this.countEl.textContent = String(stack.count);
    const info = itemInfo(stack.id);
    const wear = info?.tool || info?.armor;
    if (wear && stack.dur !== undefined && stack.dur < wear.durability) {
      const f = Math.max(0, stack.dur / wear.durability);
      this.barFill.style.width = `${Math.round(f * 100)}%`;
      this.barFill.style.background = `hsl(${Math.round(f * 120)}, 90%, 50%)`;
      this.barEl.classList.remove("hidden");
    }
  }
}
