// Brewing (Round 11): the brewing stand's potions, by vanilla's rules where
// the ingredients exist, and the thrown bottles (splash potions, the bottle
// o' enchanting).
//
// A brewing stand has five slots: 0-2 the bottles (glass bottles, water
// bottles, potions), 3 the ingredient, 4 the fuel (blaze powder). While the
// ingredient turns at least one bottle into something and there is fuel, it
// brews for vanilla's 20 s (400 ticks), then every bottle it acts on changes
// and one ingredient is used up. Taking the ingredient out (or a change that
// leaves nothing to brew) stops it.
// (Round 12) Vanilla's chain, the Nether's ingredients real: one blaze
// powder fuels 20 brews (each brew started takes one); nether wart makes a
// water bottle awkward, glowstone dust thick, redstone (and the other
// ingredients) mundane, a fermented spider eye weakness; the awkward potion
// takes sugar (swiftness), a glistering melon slice (healing), a spider eye
// (poison), a ghast tear (regeneration), magma cream (fire resistance),
// blaze powder (strength), a golden carrot (night vision); redstone makes a
// potion longer, glowstone dust stronger (II), gunpowder a splash potion; a
// fermented spider eye turns healing and poison into harming, swiftness into
// slowness, night vision into invisibility. The pufferfish isn't in the
// game: raw salmon stays its stand-in (water breathing). The Round 11
// stand-ins (no fuel; a golden apple, an ender pearl, a slimeball, a lumen
// crystal; straight from a water bottle) are gone: an old save's stand-in
// potions are ordinary potions, and an old stand's ingredient stays in its
// slot (it brews nothing) until taken out.
//
// Brewing stands work like the furnaces (js/furnace.js): they tick at 20 a
// second while their ground is loaded (online: on the host, which owns them,
// js/net/brewing.js), drop what they hold when they go, and are saved with
// the world when they hold something. Thrown bottles (PotionThrows) are each
// player's own: the thrower's game flies it and says where it broke; every
// game applies the splash to its own player, the host to the creatures.
import * as THREE from "three";
import { itemInfo } from "./items.js";
import { makeStack, encodeStack, decodeStack, sameStack } from "./inventory.js";
import { itemModel } from "./models.js";
import { createEntityMaterial, bindEntityLight } from "./shaders.js";
import { chunkKey, blockIndex } from "./constants.js";
import { LIB } from "./content/base.js";
import { dimKey, DIM_KEY_RE, parseDimKey, OVERWORLD } from "./dim-registry.js";
import * as V from "./content/ids.js";
import { POTIONS, potionId, FERMENTED_SPIDER_EYE, GLISTERING_MELON_SLICE } from "./content/items-vanilla.js";
import { isUndead } from "./enchant.js";
import { EFFECTS } from "./survival.js";

export const BREWING_SLOTS = 5; // three bottles, the ingredient, the fuel
export const BREWING_FUEL = 20; // brews from one blaze powder (vanilla)
const TICK = 1 / 20;
const MAX_TICKS = 20 * 60;
export const BREW_TICKS = 400; // (vanilla: 20 s)
const CHECK_EVERY = 0.5;
const NEAR_GUEST = 128;

export const isBrewingStand = (id) => id === V.BREWING_STAND;

// ---------- Recipes ----------

// What each ingredient makes of an awkward potion (vanilla's; raw salmon
// for the pufferfish).
const FROM_AWKWARD = {
  [V.SUGAR]: "swiftness",
  [V.SPIDER_EYE]: "poison",
  [GLISTERING_MELON_SLICE]: "healing",
  [V.GOLDEN_CARROT]: "night_vision",
  [V.GHAST_TEAR]: "regeneration",
  [V.BLAZE_POWDER]: "strength",
  [V.MAGMA_CREAM]: "fire_resistance",
  [V.SALMON]: "water_breathing",
};
// What a water bottle becomes (vanilla: the base potions).
const FROM_WATER = {
  [V.NETHER_WART]: V.AWKWARD_POTION,
  [V.GLOWSTONE_DUST]: V.THICK_POTION,
  [V.REDSTONE]: V.MUNDANE_POTION,
  [V.SUGAR]: V.MUNDANE_POTION,
  [GLISTERING_MELON_SLICE]: V.MUNDANE_POTION,
  [V.SPIDER_EYE]: V.MUNDANE_POTION,
  [V.GHAST_TEAR]: V.MUNDANE_POTION,
  [V.BLAZE_POWDER]: V.MUNDANE_POTION,
  [V.MAGMA_CREAM]: V.MUNDANE_POTION,
};
// The fermented spider eye's corruptions: [from key, from kind, to key, to kind].
const CORRUPT = [
  ["healing", "base", "harming", "base"],
  ["healing", "strong", "harming", "strong"],
  ["poison", "base", "harming", "base"],
  ["poison", "long", "harming", "base"],
  ["poison", "strong", "harming", "strong"],
  ["swiftness", "base", "slowness", "base"],
  ["swiftness", "long", "slowness", "long"],
  ["swiftness", "strong", "slowness", "base"],
  ["night_vision", "base", "invisibility", "base"],
  ["night_vision", "long", "invisibility", "long"],
];
const BREW = new Map(); // "potion,ingredient" -> result id
{
  const put = (from, ing, to) => from && to && BREW.set(`${from},${ing}`, to);
  for (const [ing, to] of Object.entries(FROM_WATER)) put(V.POTION, Number(ing), to);
  put(V.POTION, FERMENTED_SPIDER_EYE, potionId("weakness"));
  for (const [ing, key] of Object.entries(FROM_AWKWARD)) put(V.AWKWARD_POTION, Number(ing), potionId(key));
  for (const p of POTIONS) {
    for (const splash of [false, true]) {
      const from = splash ? p.splash : p.id;
      if (p.kind === "base") {
        put(from, V.REDSTONE, potionId(p.key, "long", splash));
        put(from, V.GLOWSTONE_DUST, potionId(p.key, "strong", splash));
      }
      if (!splash) put(from, V.GUNPOWDER, p.splash);
    }
  }
  for (const [k0, v0, k1, v1] of CORRUPT) {
    put(potionId(k0, v0), FERMENTED_SPIDER_EYE, potionId(k1, v1));
    put(potionId(k0, v0, true), FERMENTED_SPIDER_EYE, potionId(k1, v1, true));
  }
}
const INGREDIENTS = new Set([...BREW.keys()].map((k) => Number(k.split(",")[1])));

// What brewing `ingredient` makes of a bottle of `id` (0: nothing).
export function brewResult(id, ingredient) {
  return BREW.get(`${id},${ingredient}`) || 0;
}
export const isIngredient = (id) => INGREDIENTS.has(id);
const BOTTLES = new Set([V.GLASS_BOTTLE, V.POTION, V.AWKWARD_POTION, V.MUNDANE_POTION, V.THICK_POTION, ...POTIONS.flatMap((p) => [p.id, p.splash])]);
export const isBottle = (id) => BOTTLES.has(id);
export const isBrewingFuel = (id) => id === V.BLAZE_POWDER;

// Whether a stack of `id` may go in slot `i`.
export function brewingAccepts(i, id) {
  if (i < 3) return isBottle(id);
  if (i === 4) return isBrewingFuel(id);
  return i === 3 && isIngredient(id);
}

// ---------- Brewing stands ----------
// (Round 12) As the furnaces (js/furnace.js): every dimension's stands in the
// one store ("n:x,y,z" for the Nether's, js/dim-registry.js), each with its
// `dim`; the host brews in its own loaded ground and near every guest in theirs.

export class BrewingStands {
  constructor({ world }) {
    this.world = world;
    this.store = new Map(); // "x,y,z" -> { x, y, z, key, slots, brew, ing }
    this.authority = true;
    this.remote = null; // a guest's link to the host (js/net/brewing.js)
    this.view = null;
    this.pending = null;
    this._acc = 0;
    this._check = 0;
    this.onDrop = null; // (stack, x, y, z)
    this.onChanged = null; // (key, [[i, stack]], fromPid)
    this.onBars = null; // (key)
    this.onGone = null; // (key)
    this.onBrewed = null; // (x, y, z): a brew finished (a sound)
    this.watched = null;
    this.nearGuest = null;
    world.changeListeners?.push((changed) => this._blocksChanged(changed));
  }

  // (The Overworld's key; a key in any dimension: keyOf.)
  static key(x, y, z) {
    return `${x},${y},${z}`;
  }

  keyOf(x, y, z, dim = this.world.dim ?? OVERWORLD) {
    return dimKey(dim, x, y, z);
  }

  contents(x, y, z, dim = this.world.dim ?? OVERWORLD) {
    const key = this.keyOf(x, y, z, dim);
    let b = this.store.get(key);
    if (!b) this.store.set(key, (b = { x, y, z, dim, key, slots: new Array(BREWING_SLOTS).fill(null), brew: 0, ing: 0, fuel: 0 }));
    return b;
  }

  // Whether the stand's ground is loaded here (its dimension's).
  _here(b) {
    const w = this.world;
    return b.dim === (w.dim ?? OVERWORLD) && !!w.getChunk(b.x >> 4, b.z >> 4);
  }

  // Whether the stand's ingredient acts on any of its bottles.
  static canBrew(b) {
    const ing = b.slots[3];
    if (!ing) return false;
    for (let i = 0; i < 3; i++) if (b.slots[i] && brewResult(b.slots[i].id, ing.id)) return true;
    return false;
  }

  // One tick (vanilla's BrewingStandBlockEntity). True if a slot changed.
  _tick(b) {
    let fueled = false;
    // (out of fuel: a blaze powder from the fuel slot, 20 brews' worth)
    if (b.fuel <= 0 && b.slots[4] && isBrewingFuel(b.slots[4].id)) {
      b.fuel = BREWING_FUEL;
      b.slots[4].count -= 1;
      if (b.slots[4].count <= 0) b.slots[4] = null;
      fueled = true;
    }
    const can = BrewingStands.canBrew(b);
    if (b.brew > 0) {
      if (!can || b.slots[3].id !== b.ing) {
        b.brew = 0;
        return fueled;
      }
      if (--b.brew > 0) return fueled;
      const ing = b.slots[3];
      for (let i = 0; i < 3; i++) {
        const s = b.slots[i];
        const r = s ? brewResult(s.id, ing.id) : 0;
        if (r) b.slots[i] = makeStack(r, 1);
      }
      ing.count -= 1;
      if (ing.count <= 0) b.slots[3] = null;
      this.onBrewed?.(b.x, b.y, b.z);
      return true;
    }
    if (can && b.fuel > 0) {
      b.fuel -= 1;
      b.brew = BREW_TICKS;
      b.ing = b.slots[3].id;
    }
    return fueled;
  }

  // (nothing to brew, or nothing to brew it with)
  static idle(b) {
    if (b.brew > 0) return false;
    // (a blaze powder goes in as fuel at once, as vanilla's)
    if (b.fuel <= 0 && b.slots[4] && isBrewingFuel(b.slots[4].id)) return false;
    return b.fuel <= 0 || !BrewingStands.canBrew(b);
  }

  static empty(b) {
    return b.slots.every((s) => !s) && b.brew <= 0 && !(b.fuel > 0);
  }

  _blockAt(b) {
    const world = this.world;
    if (this._here(b)) return world.getBlock(b.x, b.y, b.z);
    const edits = world.editsOf ? world.editsOf(b.dim) : world.edits;
    const id = edits?.get(chunkKey(b.x >> 4, b.z >> 4))?.get(blockIndex(b.x & 15, b.y, b.z & 15));
    return id === undefined ? -1 : id;
  }

  update(dt) {
    this._acc += dt;
    let n = Math.floor(this._acc / TICK + 1e-9);
    this._acc -= n * TICK;
    if (n > MAX_TICKS) n = MAX_TICKS;
    if (!this.authority) {
      if (this.pending && !this.remote?.mp?.active && Date.now() - this.pending.t > 4000) {
        const p = this.pending;
        this.pending = null;
        p.done(false);
      }
      const v = this.view;
      if (n > 0 && v?.ready && !v.gone && v.b && v.b.brew > 1) v.b.brew = Math.max(1, v.b.brew - n);
      return;
    }
    this._check -= dt;
    const look = this._check <= 0;
    if (look) this._check = CHECK_EVERY;
    if (!this.store.size) return;
    const world = this.world;
    for (const b of this.store.values()) {
      if (look) {
        const id = this._blockAt(b);
        if (id >= 0 && !isBrewingStand(id)) {
          this._gone(b);
          continue;
        }
        if (BrewingStands.empty(b) && this.view?.key !== b.key && !this.watched?.(b.key)) {
          this.store.delete(b.key);
          continue;
        }
      }
      if (n <= 0 || BrewingStands.idle(b)) {
        if (b.brew > 0 && !BrewingStands.canBrew(b)) {
          b.brew = 0;
          this.onBars?.(b.key);
        }
        continue;
      }
      if (!this._here(b) && !this.nearGuest?.(b.x, b.z, b.dim)) continue;
      const was = b.brew > 0;
      let changed = false;
      for (let k = 0; k < n; k++) {
        if (this._tick(b)) changed = true;
        if (BrewingStands.idle(b)) break;
      }
      if (changed) {
        this.onChanged?.(b.key, b.slots.map((s, i) => [i, s]), 0);
        if (this.view?.key === b.key) this.view.onUpdate?.();
      }
      if (changed || was !== b.brew > 0) this.onBars?.(b.key);
    }
  }

  // ---------- The stand open on this screen ----------

  openView(x, y, z, onUpdate) {
    const key = this.keyOf(x, y, z);
    if (this.view && this.view.key === key) {
      this.view.onUpdate = onUpdate;
      return this.view;
    }
    this.closeView();
    const view = { x, y, z, key, slots: null, b: null, ready: false, gone: false, onUpdate };
    this.view = view;
    if (this.authority) {
      view.b = this.contents(x, y, z);
      view.slots = view.b.slots;
      view.ready = true;
    } else this.remote?.open(view);
    return view;
  }

  closeView() {
    const v = this.view;
    if (!v) return;
    this.view = null;
    if (!this.authority) this.remote?.close(v);
  }

  // A click on the open stand: changes [[slot, before, after], ...]; done(ok).
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

  // The authority: applies changes if every slot still holds what they
  // expect and what goes in is allowed there (one bottle a slot). True if applied.
  apply(key, changes, fromPid = 0) {
    const b = this.store.get(key);
    if (!b || !Array.isArray(changes) || changes.length < 1 || changes.length > BREWING_SLOTS) return false;
    const seen = new Set();
    const next = [];
    for (const ch of changes) {
      if (!Array.isArray(ch)) return false;
      const [i, before, after] = ch;
      if (!Number.isInteger(i) || i < 0 || i >= BREWING_SLOTS || seen.has(i)) return false;
      seen.add(i);
      if (!sameStack(b.slots[i], before || null)) return false;
      const a = after ? decodeStack(encodeStack(after)) : null;
      if (after && !a) return false;
      if (a && !sameStack(b.slots[i], a) && (!brewingAccepts(i, a.id) || (i < 3 && a.count > 1))) return false;
      next.push([i, a]);
    }
    for (const [i, a] of next) b.slots[i] = a;
    this.onChanged?.(key, next, fromPid);
    this.onBars?.(key);
    if (fromPid && this.view?.key === key) this.view.onUpdate?.();
    return true;
  }

  // ---------- A guest: the host's word ----------

  remoteState(key, slots, bars) {
    const v = this.view;
    if (!v || v.key !== key) return;
    if (!slots) v.gone = true;
    else {
      v.slots = slots;
      v.b = { slots, brew: 0 };
      this._bars(v.b, bars);
      v.ready = true;
    }
    v.onUpdate?.();
  }

  remoteSet(key, list, bars) {
    const v = this.view;
    if (!v || v.key !== key || !v.ready) return;
    for (const [i, s] of list) if (Number.isInteger(i) && i >= 0 && i < BREWING_SLOTS) v.slots[i] = s;
    this._bars(v.b, bars);
    v.onUpdate?.();
  }

  remoteBars(key, bars) {
    const v = this.view;
    if (v && v.key === key && v.ready) this._bars(v.b, bars);
  }

  _bars(b, bars) {
    if (!b || !Array.isArray(bars)) return;
    if (Number.isInteger(bars[0]) && bars[0] >= 0 && bars[0] <= BREW_TICKS) b.brew = bars[0];
    if (Number.isInteger(bars[1]) && bars[1] >= 0 && bars[1] <= BREWING_FUEL) b.fuel = bars[1];
  }

  // [brew ticks left, fuel left] (online: the stand's bars).
  bars(key) {
    const b = this.store.get(key);
    return b ? [b.brew, b.fuel | 0] : null;
  }

  // ---------- Stands going ----------

  _blocksChanged(changed) {
    if (!this.authority || !this.store.size) return;
    const world = this.world;
    if (changed.length / 3 > this.store.size * 4) {
      for (const b of this.store.values()) if (this._here(b) && !isBrewingStand(world.getBlock(b.x, b.y, b.z))) this._gone(b);
      return;
    }
    for (let i = 0; i < changed.length; i += 3) {
      const b = this.store.get(this.keyOf(changed[i], changed[i + 1], changed[i + 2]));
      if (b && !isBrewingStand(world.getBlock(b.x, b.y, b.z))) this._gone(b);
    }
  }

  _gone(b) {
    this.store.delete(b.key);
    const v = this.view;
    if (v && v.key === b.key) {
      v.gone = true;
      v.onUpdate?.();
    }
    this.onGone?.(b.key);
    // (Round 12: in its own dimension.)
    const drop = () => {
      for (const s of b.slots) if (s) this.onDrop?.(s, b.x, b.y, b.z);
    };
    if (!this.world.inDim || b.dim === this.world.dim) drop();
    else this.world.inDim(b.dim, drop);
  }

  // ---------- Save ----------

  // { "x,y,z": [[slots], brew, fuel] } for the stands that hold something.
  serialize() {
    if (!this.authority || !this.store.size) return undefined;
    const out = {};
    let any = false;
    for (const b of this.store.values()) {
      if (BrewingStands.empty(b)) continue;
      out[b.key] = [b.slots.map(encodeStack), b.brew, b.fuel | 0];
      any = true;
    }
    return any ? out : undefined;
  }

  load(data) {
    this.store.clear();
    if (!data || typeof data !== "object") return;
    for (const [key, e] of Object.entries(data)) {
      if (!DIM_KEY_RE.test(key) || !Array.isArray(e) || !Array.isArray(e[0])) continue;
      const [x, y, z, dim] = parseDimKey(key);
      const b = this.contents(x, y, z, dim);
      for (let i = 0; i < BREWING_SLOTS; i++) {
        const s = decodeStack(e[0][i]);
        // (an older stand's ingredient that brews nothing now stays, to be taken out)
        b.slots[i] = s && (brewingAccepts(i, s.id) || i === 3) ? s : null;
      }
      b.brew = Number.isInteger(e[1]) && e[1] > 0 && e[1] <= BREW_TICKS ? e[1] : 0;
      b.fuel = Number.isInteger(e[2]) && e[2] > 0 && e[2] <= BREWING_FUEL ? e[2] : 0;
      b.ing = b.slots[3]?.id ?? 0;
    }
  }
}

export { NEAR_GUEST as BREWING_NEAR_GUEST };

// ---------- Thrown bottles ----------

const SPLASH_RADIUS = 4;
const POTION_BY_ID = new Map();
for (const p of POTIONS) {
  POTION_BY_ID.set(p.id, p);
  POTION_BY_ID.set(p.splash, p);
}
const THROWS = { potion: { speed: 10, gravity: 20 }, xp: { speed: 14, gravity: 28 } };
export const isThrownBottle = (id) => id === V.EXPERIENCE_BOTTLE || !!itemInfo(id)?.splash;

// What a splash does to a player at distance `d` (vanilla: the effect scaled
// by 1 - d/4; instant ones by their amount, the rest by their time).
export function splashOnPlayer(player, id, d) {
  const p = POTION_BY_ID.get(id);
  if (!p || !player || player.dead || d >= SPLASH_RADIUS) return false;
  const f = 1 - d / SPLASH_RADIUS;
  let any = false;
  for (const e of p.effects) {
    const L = e.level || 1;
    if (e.id === "instant_health") any = player.heal?.(Math.round(f * (4 << (L - 1)))) > 0 || any;
    else if (e.id === "instant_damage") any = !!player.damage?.(Math.round(f * (6 << (L - 1))), "magic") || any;
    else if (f * e.seconds >= 1) any = !!player.addEffect?.(e.id, f * e.seconds, L) || any;
  }
  return any;
}

// What a splash does to the creatures near `at` (the authority over them):
// healing and harming (the undead the other way round). The other effects
// are the players' (the creatures have no effects to run them).
export function splashOnMobs(mobs, id, at) {
  const p = POTION_BY_ID.get(id);
  if (!p || !mobs?.mobs) return;
  const e = p.effects[0];
  if (e.id !== "instant_health" && e.id !== "instant_damage") return;
  const L = e.level || 1;
  for (const m of mobs.mobs) {
    if (m.dead || m.net) continue;
    const d = Math.hypot(m.pos.x - at.x, m.pos.y + m.spec.h * 0.5 - at.y, m.pos.z - at.z);
    if (d >= SPLASH_RADIUS) continue;
    const f = 1 - d / SPLASH_RADIUS;
    const hurt = (e.id === "instant_damage") !== isUndead(m.kind);
    if (hurt) {
      m.invulnerable = 0;
      mobs._hurt(m, Math.round(f * (6 << (L - 1))), null, 0, true);
    } else m.health = Math.min(m.maxHealth ?? m.health, m.health + Math.round(f * (4 << (L - 1))));
  }
}

export class PotionThrows {
  constructor({ scene, world, player, effects, audio, mobs }) {
    this.scene = scene;
    this.world = world;
    this.player = player;
    this.effects = effects;
    this.audio = audio;
    this.mobs = mobs;
    this.list = []; // { id, pos, vel, gravity, age, mesh, light, own, key }
    this.material = createEntityMaterial("color");
    this._n = 1;
    this._dir = new THREE.Vector3();
    this._step = new THREE.Vector3();
    this._color = new THREE.Color();
    this._color2 = new THREE.Color();
    // Online (js/net/brewing.js): a throw of ours (to draw it elsewhere), and where one broke.
    this.onThrow = null; // (id, pos, vel, key)
    this.onSplash = null; // (id, at, key)
    this.authorityOverMobs = () => true; // (the host or offline: the creatures are ours)
    this.othersMayHarm = () => true; // (online: the host's PvP rule, for another player's harmful splash)
    // (For the content modules' item uses: js/content/items-vanilla.js.)
    LIB.throwPotion = (id) => !!this.throw(id);
  }

  // Throws one bottle of `id` from the player's eye (20 degrees up, as vanilla). Returns it, or null.
  throw(id) {
    if (!isThrownBottle(id) || this.player.dead) return null;
    const kind = id === V.EXPERIENCE_BOTTLE ? THROWS.xp : THROWS.potion;
    const p = this.player;
    const pos = p.getEyePosition();
    pos.y -= 0.1;
    const f = p.getForwardVector();
    const pitch = Math.asin(Math.max(-1, Math.min(1, f.y)));
    const h = Math.hypot(f.x, f.z) || 1;
    const up = Math.min(Math.PI / 2, pitch + (20 * Math.PI) / 180);
    const vel = new THREE.Vector3((f.x / h) * Math.cos(up), Math.sin(up), (f.z / h) * Math.cos(up)).multiplyScalar(kind.speed);
    if (p.velocity) vel.add(p.velocity.clone().setY(p.onGround ? 0 : p.velocity.y));
    const t = this._add(id, pos, vel, true, `${this._n++}`);
    if (!t) return null;
    this.audio.playThrow?.();
    this.onThrow?.(id, t.pos, t.vel, t.key);
    return t;
  }

  _add(id, pos, vel, own, key) {
    const model = itemModel(id);
    if (!model) return null;
    const mesh = new THREE.Mesh(model.geometry, this.material);
    mesh.scale.setScalar(0.32);
    const g = id === V.EXPERIENCE_BOTTLE ? THROWS.xp.gravity : THROWS.potion.gravity;
    const t = { id, pos: pos.clone(), vel: vel.clone(), gravity: g, age: 0, mesh, light: { sky: 15, block: 0 }, own, key };
    bindEntityLight(mesh, () => t.light);
    mesh.position.copy(t.pos);
    this.scene.add(mesh);
    this.list.push(t);
    return t;
  }

  // Another player's throw (online): drawn here, its splash comes from them.
  remoteThrow(id, pos, vel, key) {
    if (!isThrownBottle(id)) return;
    this._add(id, pos, vel, false, key);
  }

  // Another player's bottle broke at `at`: its puff, and (a potion) its effect on this player.
  remoteSplash(id, at, key) {
    for (let i = this.list.length - 1; i >= 0; i--) {
      const t = this.list[i];
      if (!t.own && t.key === key) {
        this.scene.remove(t.mesh);
        this.list.splice(i, 1);
      }
    }
    this._burst(id, at);
    if (id === V.EXPERIENCE_BOTTLE) return;
    this._apply(id, at, true);
  }

  // The splash on this player (another's harmful one only where PvP is on) and, if ours, the creatures.
  _apply(id, at, remote = false) {
    const p = this.player;
    const pot = POTION_BY_ID.get(id);
    const harmful = !!pot?.effects.some((e) => EFFECTS[e.id]?.bad);
    if (p && !p.dead && !p.creative && !(remote && harmful && !this.othersMayHarm())) splashOnPlayer(p, id, Math.hypot(p.position.x - at.x, p.position.y + 0.9 - at.y, p.position.z - at.z));
    if (this.authorityOverMobs()) splashOnMobs(this.mobs, id, at);
  }

  clear() {
    for (const t of this.list) this.scene.remove(t.mesh);
    this.list.length = 0;
  }

  update(dt) {
    for (let i = this.list.length - 1; i >= 0; i--) {
      const t = this.list[i];
      t.age += dt;
      t.vel.y -= t.gravity * dt;
      t.vel.multiplyScalar(Math.exp(-0.2 * dt));
      const step = this._step.copy(t.vel).multiplyScalar(dt);
      const len = step.length();
      const dir = this._dir.copy(step).divideScalar(len || 1);
      const block = this.world.raycast(t.pos, dir, len, { solidOnly: true });
      const mob = this.mobs?.raycast?.(t.pos, dir, block ? block.distance : len);
      if (block || mob || t.age > 12 || t.pos.y < -20) {
        if (t.own && (block || mob)) {
          const d = mob ? mob.distance : block.distance;
          const at = t.pos.clone().addScaledVector(dir, Math.max(0, d - 0.05));
          this._land(t, at);
        }
        // (Another player's bottle: its splash comes with their word; this copy just goes.)
        this.scene.remove(t.mesh);
        this.list.splice(i, 1);
        continue;
      }
      t.pos.add(step);
      t.mesh.position.copy(t.pos);
      t.mesh.rotation.y = this.player.yaw;
      t.light = this.world.lightAt(t.pos.x, t.pos.y, t.pos.z);
    }
  }

  // Our bottle broke: the puff, its effects here, experience orbs (a bottle
  // o' enchanting: 3-11, vanilla), and the word to everyone else.
  _land(t, at) {
    this._burst(t.id, at);
    if (t.id === V.EXPERIENCE_BOTTLE) LIB.giveXp?.(3 + Math.floor(Math.random() * 5) + Math.floor(Math.random() * 5), at.x, at.y + 0.2, at.z);
    else this._apply(t.id, at);
    this.onSplash?.(t.id, at, t.key);
  }

  _burst(id, at) {
    const p = POTION_BY_ID.get(id);
    const hex = p ? p.color : 0x8ae24a;
    const c = this._color.setHex(hex, THREE.SRGBColorSpace).multiplyScalar(3);
    const c2 = this._color2.setHex(0xffffff, THREE.SRGBColorSpace);
    const glow = this.effects?.glow;
    if (glow) {
      for (let k = 0; k < 18; k++) {
        glow.spawn({ x: at.x, y: at.y + 0.2, z: at.z, vx: (Math.random() - 0.5) * 5, vy: Math.random() * 3, vz: (Math.random() - 0.5) * 5, life: 0.7, size0: 0.22, size1: 0.05, color0: k % 3 ? c : c2, drag: 2.5, gravity: 0.4 });
      }
    }
    const d = this.player.position.distanceTo(at);
    if (d < 30) this.audio.playBreak?.("glass");
  }
}

// (For tests: the whole recipe list, [from, ingredient, to].)
export function brewingRecipes() {
  return [...BREW.entries()].map(([k, to]) => [...k.split(",").map(Number), to]);
}
