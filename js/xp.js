// Experience (Round 11, Survival worlds): vanilla's levels and orbs.
//
// Levels: going from level L to L + 1 takes 2L + 7 points up to level 15,
// then 5L - 38 up to 30, then 9L - 158 (vanilla's curve). The player holds
// the level, the share of the way to the next one and the total
// (player.xpLevel, xpProgress, xpTotal; saved with the player).
//
// Orbs: dropped by mined ores (a block def's `xp`: [min, max], { min, max }
// or a number), killed creatures (killXp), smelting (the furnace's stored
// XP when its output is taken), breeding and death (7 per level, at most
// 100; the rest is lost). They split into vanilla's orb sizes, hop out,
// drift to a player within 8 blocks, merge when they touch, and are taken
// one every 0.1 s. Online they are local to whoever caused them (nothing is
// sent): only that player sees and collects them, so no orb is shared or
// counted twice. Other code gives XP with LIB.giveXp(amount, x, y, z)
// (content/base.js; main.js sets it).
import * as THREE from "three";

// The orb sizes vanilla splits a reward into (largest first).
const ORB_VALUES = [2477, 1237, 617, 307, 149, 73, 37, 17, 7, 3, 1];
const MAX_ORBS = 64;
const ORB_LIFE = 300; // seconds (vanilla: 6000 ticks)
const PULL_RANGE = 8;
const PICKUP_GAP = 0.1; // seconds between two orbs taken (vanilla: 2 ticks)
const ORB_R = 0.125;
const GRAVITY = 12; // blocks/s^2 (vanilla: 0.03 a tick)

// Points from level L to L + 1.
export function xpToNext(level) {
  if (level >= 30) return 112 + (level - 30) * 9;
  if (level >= 15) return 37 + (level - 15) * 5;
  return 7 + level * 2;
}

// Adds points to a player (vanilla's giveExperiencePoints). Returns the
// levels gained.
export function addXp(player, amount) {
  amount = Math.max(0, Math.floor(amount));
  if (!amount) return 0;
  const before = player.xpLevel;
  player.xpTotal = Math.min(2e9, player.xpTotal + amount);
  player.xpProgress += amount / xpToNext(player.xpLevel);
  while (player.xpProgress >= 1) {
    player.xpProgress = (player.xpProgress - 1) * xpToNext(player.xpLevel);
    player.xpLevel++;
    player.xpProgress /= xpToNext(player.xpLevel);
  }
  return player.xpLevel - before;
}

// Takes levels away (enchanting, an anvil); false if there aren't enough.
export function spendLevels(player, levels) {
  if (player.xpLevel < levels) return false;
  player.xpLevel -= levels;
  if (player.xpLevel === 0 && levels > 0) player.xpProgress = Math.min(player.xpProgress, 0.9999);
  return true;
}

// What dying drops (vanilla: 7 a level, at most 100); the rest is lost.
export function deathXp(player) {
  return Math.min(100, player.xpLevel * 7);
}

export function resetXp(player) {
  player.xpLevel = 0;
  player.xpProgress = 0;
  player.xpTotal = 0;
}

// A random whole amount from an `xp` field: [min, max], { min, max } or a number.
export function rollXp(spec, rand = Math.random) {
  if (spec == null) return 0;
  if (typeof spec === "number") return Math.max(0, Math.floor(spec + rand()));
  const lo = Array.isArray(spec) ? spec[0] : spec.min;
  const hi = Array.isArray(spec) ? spec[1] ?? lo : spec.max ?? lo;
  if (!Number.isFinite(lo)) return 0;
  return Math.max(0, Math.floor(lo + rand() * (Math.max(lo, hi) - lo + 1)));
}

// A fractional amount (smelting: 0.7 an ingot) as a whole one: the
// fraction is a chance of one more (vanilla).
export function wholeXp(amount, rand = Math.random) {
  if (!(amount > 0)) return 0;
  const n = Math.floor(amount);
  return n + (rand() < amount - n ? 1 : 0);
}

// Vanilla's kill rewards by creature kind (killed by a player): monsters 5,
// with a weapon 1-3 more, animals 1-3, a villager or golem nothing. A
// species' own `xp` (a number, [min, max] or (mob) => n) comes first.
const KILL_XP = {
  zombie: 5,
  husk: 5,
  drowned: 5,
  zombie_villager: 5,
  skeleton: [6, 8], // (its bow: 1-3 more)
  stray: [6, 8],
  spider: 5,
  cave_spider: 5,
  creeper: 5,
  enderman: 5,
  witch: 5,
  slime: 1, // (a big one 4, a medium one 2: its species says)
  villager: 0,
  iron_golem: 0,
  snow_golem: 0,
  butterfly: 0,
  bat: 0,
};
// (species: the kind's SPECIES entry, when the mob is only a kind and a
// place: a guest's kill of the host's creature.)
export function killXp(mob, species = null) {
  if (!mob || mob.isRemotePlayer) return 0;
  const spec = species || mob.spec || {};
  // (A baby known by its grown-up's spec, a guest's kill: an animal gives
  // nothing, a monster (a baby zombie) two and a half times a grown one's,
  // vanilla's 12. A baby's own spec says its own.)
  if (mob.baby && !spec.baby) return spec.hostile ? Math.floor(grownXp(mob, spec) * 2.5) : 0;
  return grownXp(mob, spec);
}

function grownXp(mob, spec) {
  if (typeof spec.xp === "function") return Math.max(0, Math.floor(spec.xp(mob) || 0));
  if (spec.xp != null) return rollXp(spec.xp);
  if (spec.alien || spec.special) return 0; // (the Missions world's foes give loot, not XP)
  if ("xp" in spec || spec.baby) return 0; // (a spec that says none: a baby animal's)
  const k = KILL_XP[mob.kind];
  if (k != null) return rollXp(k);
  return spec.hostile ? 5 : rollXp([1, 3]);
}

// A 16x16 pixel orb: a bright core, a darker rim (the colour comes from the sprite).
function orbTexture() {
  const c = document.createElement("canvas");
  c.width = c.height = 16;
  const ctx = c.getContext("2d");
  const img = ctx.createImageData(16, 16);
  for (let y = 0; y < 16; y++) {
    for (let x = 0; x < 16; x++) {
      const d = Math.hypot(x - 7.5, y - 7.5);
      if (d > 6.2) continue;
      const i = (y * 16 + x) * 4;
      const v = d > 5 ? 90 : d > 3.6 ? 190 : x < 7 && y < 7 && d < 2.6 ? 255 : 235;
      img.data[i] = img.data[i + 1] = img.data[i + 2] = v;
      img.data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c);
  t.magFilter = THREE.NearestFilter;
  t.minFilter = THREE.NearestFilter;
  t.generateMipmaps = false;
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export class XpOrbs {
  constructor({ scene, world, player, audio }) {
    this.scene = scene;
    this.world = world;
    this.player = player;
    this.audio = audio;
    this.orbs = []; // live orbs: { value, pos, vel, age, sprite, phase }
    this._pool = []; // sprites not in use
    this._texture = null;
    this._pickupT = 0;
    this._mergeT = 0;
    this._time = 0;
    this.enabled = true; // (main.js: Survival worlds)
    this.onCollect = null; // (value, levelsGained) => void
    this._tmp = new THREE.Vector3();
  }

  _sprite() {
    let s = this._pool.pop();
    if (!s) {
      this._texture ||= orbTexture();
      // (Its own material: each orb pulses on its own, green to yellow.)
      s = new THREE.Sprite(new THREE.SpriteMaterial({ map: this._texture, color: new THREE.Color(1, 1, 0.2), alphaTest: 0.5, fog: true }));
      s.renderOrder = 3;
    }
    this.scene.add(s);
    return s;
  }

  // Drops `amount` points at (x, y, z) as orbs of vanilla's sizes.
  spawn(x, y, z, amount) {
    amount = Math.floor(amount);
    if (!this.enabled || !(amount > 0) || !Number.isFinite(x + y + z)) return;
    while (amount > 0) {
      let value = 1;
      for (const v of ORB_VALUES) {
        if (amount >= v) {
          value = v;
          break;
        }
      }
      amount -= value;
      this._add(x, y, z, value);
    }
  }

  _add(x, y, z, value) {
    // (Too many already: the value joins the nearest orb.)
    if (this.orbs.length >= MAX_ORBS) {
      let best = this.orbs[0];
      let bd = Infinity;
      for (const o of this.orbs) {
        const d = (o.pos.x - x) ** 2 + (o.pos.y - y) ** 2 + (o.pos.z - z) ** 2;
        if (d < bd) {
          bd = d;
          best = o;
        }
      }
      best.value += value;
      best.age = 0;
      this._size(best);
      return;
    }
    const sprite = this._sprite();
    const o = {
      value,
      pos: new THREE.Vector3(x, y, z),
      // (vanilla: up to 0.2 a tick sideways, 0-0.4 up)
      vel: new THREE.Vector3((Math.random() * 0.2 - 0.1) * 40, Math.random() * 0.2 * 40, (Math.random() * 0.2 - 0.1) * 40),
      age: 0,
      sprite,
      phase: Math.random() * 6.28,
    };
    this._size(o);
    sprite.position.copy(o.pos);
    this.orbs.push(o);
  }

  // A bigger orb for a bigger value (vanilla's eleven icon sizes).
  _size(o) {
    let i = ORB_VALUES.length - 1;
    while (i > 0 && o.value >= ORB_VALUES[i - 1]) i--;
    const k = ORB_VALUES.length - 1 - i; // 0 (1 point) .. 10
    o.sprite.scale.setScalar(0.22 + k * 0.035);
  }

  _remove(i) {
    const o = this.orbs[i];
    this.scene.remove(o.sprite);
    this._pool.push(o.sprite);
    this.orbs[i] = this.orbs[this.orbs.length - 1];
    this.orbs.pop();
  }

  clear() {
    for (let i = this.orbs.length - 1; i >= 0; i--) this._remove(i);
  }

  // Total points still lying around (tests, the debug overlay).
  get pending() {
    let n = 0;
    for (const o of this.orbs) n += o.value;
    return n;
  }

  _solid(x, y, z) {
    return this.world.isSolidAt(Math.floor(x), Math.floor(y), Math.floor(z));
  }

  update(dt) {
    if (!this.orbs.length) return;
    this._time += dt;
    this._pickupT = Math.max(0, this._pickupT - dt);
    const p = this.player;
    const canTake = !p.dead && !p.vehicle && p.enabled !== false;
    // (The player's middle: vanilla aims at the eyes' height halved.)
    const tx = p.position.x;
    const ty = p.position.y + 0.81;
    const tz = p.position.z;
    const drag = Math.pow(0.98, dt * 20);
    for (let i = this.orbs.length - 1; i >= 0; i--) {
      const o = this.orbs[i];
      o.age += dt;
      if (o.age > ORB_LIFE) {
        this._remove(i);
        continue;
      }
      const v = o.vel;
      v.y -= GRAVITY * dt;
      // Pulled to a player within 8 blocks, harder the closer (vanilla).
      if (canTake) {
        const ddx = tx - o.pos.x;
        const ddy = ty - o.pos.y;
        const ddz = tz - o.pos.z;
        const d = Math.hypot(ddx, ddy, ddz);
        if (d < PULL_RANGE && d > 1e-3) {
          const f = 1 - d / PULL_RANGE;
          const a = (f * f * 40 * dt) / d;
          v.x += ddx * a;
          v.y += ddy * a;
          v.z += ddz * a;
        }
      }
      v.multiplyScalar(drag);
      // Moved one axis at a time, stopped by solid blocks.
      const pos = o.pos;
      let nx = pos.x + v.x * dt;
      if (this._solid(nx + Math.sign(v.x) * ORB_R, pos.y, pos.z)) {
        v.x = 0;
        nx = pos.x;
      }
      pos.x = nx;
      let ny = pos.y + v.y * dt;
      if (this._solid(pos.x, ny - ORB_R, pos.z) && v.y < 0) {
        // (on the ground: it stops, and slides only a little)
        ny = Math.floor(ny - ORB_R) + 1 + ORB_R;
        v.y *= -0.3;
        v.x *= Math.pow(0.2, dt * 20);
        v.z *= Math.pow(0.2, dt * 20);
      } else if (v.y > 0 && this._solid(pos.x, ny + ORB_R, pos.z)) {
        v.y = 0;
        ny = pos.y;
      }
      pos.y = ny;
      let nz = pos.z + v.z * dt;
      if (this._solid(pos.x, pos.y, nz + Math.sign(v.z) * ORB_R)) {
        v.z = 0;
        nz = pos.z;
      }
      pos.z = nz;
      // (Inside a block, e.g. one placed on it: pushed up out of it.)
      if (this._solid(pos.x, pos.y, pos.z)) {
        pos.y = Math.floor(pos.y) + 1 + ORB_R;
        v.y = Math.max(v.y, 0);
      }
      o.sprite.position.copy(pos);
      // (vanilla's pulse: green to yellow)
      const t = this._time * 6 + o.phase;
      o.sprite.material.color.setRGB(((Math.sin(t) + 1) * 0.5) * 1.1, 1.15, ((Math.sin(t + 4.19) + 1) * 0.1));
      // Taken when it reaches the player's box (grown by 1 sideways, 0.5 up and down).
      if (canTake && this._pickupT <= 0 && Math.abs(pos.x - p.position.x) < 1.3 && Math.abs(pos.z - p.position.z) < 1.3 && pos.y > p.position.y - 0.5 && pos.y < p.position.y + 2.3) {
        const value = o.value;
        this._remove(i);
        this._pickupT = PICKUP_GAP;
        this.collect(value);
      }
    }
    // Orbs that touch merge (checked once a second: a handful at most).
    this._mergeT += dt;
    if (this._mergeT >= 1 && this.orbs.length > 1) {
      this._mergeT = 0;
      for (let i = this.orbs.length - 1; i > 0; i--) {
        const a = this.orbs[i];
        for (let j = i - 1; j >= 0; j--) {
          const b = this.orbs[j];
          if (a.pos.distanceToSquared(b.pos) < 0.25) {
            b.value += a.value;
            b.age = Math.min(a.age, b.age);
            this._size(b);
            this._remove(i);
            break;
          }
        }
      }
    }
  }

  // Points into the player's bar, with vanilla's sounds: a ding for an orb,
  // a chime every fifth level.
  collect(value) {
    const levels = addXp(this.player, value);
    const a = this.audio;
    if (a?.ctx && a._tone) {
      a._cat?.("player");
      a._tone(1046 * (0.75 + Math.random() * 0.6), 0.14, { type: "sine", vol: 0.05 });
      if (levels > 0 && this.player.xpLevel % 5 === 0) {
        a._cat?.("player");
        for (const [f, at] of [[523, 0], [659, 0.09], [784, 0.18], [1046, 0.27]]) a._tone(f, 0.35, { type: "triangle", vol: 0.06, at });
      }
    }
    this.onCollect?.(value, levels);
  }
}
