// Fishing (Round 11), as in the classic game: right click with a fishing rod
// casts the bobber (it flies with gravity and drag and floats where it lands
// in water); after 5-30 s (slower under a roof) a fish swims up, trailing
// bubbles, and bites: the bobber dips with a splash, and a right click
// within the next second or two reels in the catch, which flies to the
// player (the classic loot: fish 85%, junk 10%, treasure 5% in open water),
// with a little experience. Reeling in without a bite brings the bobber back
// (from the ground it costs the rod 2 uses, a catch 1). The bobber goes when
// the rod leaves the hand, the player gets more than 32 blocks away, dies or
// boards a vehicle.
//
// Online the bobber and the bite are the angler's own (nothing else depends
// on them); the catch drops like any other item (shared, js/net/items.js).
// Built by the weapon system (weapons.js), which updates it every frame; the
// rod's use (js/content/items-vanilla.js) calls use().
import * as THREE from "three";
import { BLOCK, IS_SOLID } from "./blocks.js";
import { ITEM, itemInfo, maxStack } from "./items.js";
import { FISHING_ROD, COD, SALMON, BOWL, LEATHER, ROTTEN_FLESH, STRING, BONE, LILY_PAD, LAVA } from "./content/ids.js";
import { createEntityMaterial, bindEntityLight } from "./shaders.js";

const GRAVITY = -12; // blocks/s² (the classic bobber's 0.03 a tick²)
const AIR_DRAG = 1.6; // 1/s (0.92 a tick)
const CAST_SPEED = 17; // blocks/s
const MAX_DISTANCE = 32;
const LINE_POINTS = 12;
const WAIT = [5, 30]; // seconds until a fish comes
const APPROACH = [1, 4]; // seconds a fish swims up
const NIBBLE = [1, 2]; // seconds to reel it in

// The classic loot (luck 0). Fish: cod 60, salmon 25 (the tropical fish and
// pufferfish have no items: their share goes to the two). Junk and treasure
// skip what doesn't exist here (ink sacs, tripwire hooks, water bottles,
// name tags, saddles, nautilus shells, enchanted books: none yet).
const FISH = [[COD, 60], [SALMON, 25]];
// (Worn items: [id, weight, least wear, most wear], as fractions of their uses.)
const JUNK = [[LILY_PAD, 17], [BOWL, 10], [LEATHER, 10], [ITEM.LEATHER_BOOTS, 10, 0.1, 0.9], [ROTTEN_FLESH, 10], [BONE, 10], [STRING, 5], [ITEM.STICK, 5], [FISHING_ROD, 2, 0.1, 0.9]];
const TREASURE = [[ITEM.BOW, 1], [FISHING_ROD, 1, 0, 0.25]];

const rnd = (a, b) => a + Math.random() * (b - a);

function pick(table) {
  const list = table.filter(([id]) => itemInfo(id));
  let total = 0;
  for (const e of list) total += e[1];
  let r = Math.random() * total;
  for (const e of list) {
    r -= e[1];
    if (r <= 0) return e;
  }
  return list[list.length - 1] || null;
}

// The bobber: a red-topped float with a white belly (built once, shared).
let bobberGeo = null;
function bobberGeometry() {
  if (bobberGeo) return bobberGeo;
  const parts = [
    [new THREE.BoxGeometry(0.16, 0.08, 0.16).translate(0, 0.04, 0), 0xc8202a],
    [new THREE.BoxGeometry(0.16, 0.08, 0.16).translate(0, -0.04, 0), 0xeeeeee],
    [new THREE.BoxGeometry(0.03, 0.1, 0.03).translate(0, 0.13, 0), 0x2a2a2a],
  ];
  const geos = parts.map(([g, hex]) => {
    const n = g.toNonIndexed();
    const c = new THREE.Color(hex);
    const col = new Float32Array(n.getAttribute("position").count * 3);
    for (let i = 0; i < col.length; i += 3) col.set([c.r, c.g, c.b], i);
    n.setAttribute("color", new THREE.BufferAttribute(col, 3));
    return n;
  });
  let count = 0;
  for (const g of geos) count += g.getAttribute("position").count;
  const out = new THREE.BufferGeometry();
  for (const [name, size] of [["position", 3], ["normal", 3], ["color", 3]]) {
    const arr = new Float32Array(count * size);
    let o = 0;
    for (const g of geos) {
      arr.set(g.getAttribute(name).array, o);
      o += g.getAttribute(name).array.length;
    }
    out.setAttribute(name, new THREE.BufferAttribute(arr, size));
  }
  bobberGeo = out;
  return out;
}

export class Fishing {
  constructor({ scene, world, player, audio, effects, held, inventory }) {
    this.scene = scene;
    this.world = world;
    this.player = player;
    this.audio = audio;
    this.effects = effects;
    this.held = held;
    this.inventory = inventory;
    this.bobber = null; // { pos, vel, inWater, onGround, wait, approach, nibble, entities, light }
    this.onXp = null; // (amount, pos): a catch's experience (the game's XP system, if any)
    this.onChange = null; // () => void: the rod wore
    this.caught = 0; // catches (stats / tests)
    this.material = createEntityMaterial("color");
    this.mesh = new THREE.Mesh(bobberGeometry(), this.material);
    this.mesh.visible = false;
    this.light = { sky: 15, block: 0 };
    bindEntityLight(this.mesh, () => this.light);
    scene.add(this.mesh);
    // The line: a sagging curve from the rod's tip to the bobber, its points rewritten in place.
    const geo = new THREE.BufferGeometry();
    this._linePos = new Float32Array(LINE_POINTS * 3);
    geo.setAttribute("position", new THREE.BufferAttribute(this._linePos, 3));
    this.line = new THREE.Line(geo, new THREE.LineBasicMaterial({ color: 0x1c1c1c }));
    this.line.frustumCulled = false;
    this.line.visible = false;
    scene.add(this.line);
    this._tip = new THREE.Vector3();
    this._step = new THREE.Vector3();
    this._dir = new THREE.Vector3();
    this._c = { splash: new THREE.Color(0.75, 0.85, 1), bubble: new THREE.Color(0.85, 0.92, 1) };
  }

  get cast() {
    return !!this.bobber;
  }

  // The rod used (a right click): casts, or reels in. True: something happened.
  use(ctx) {
    if (this.bobber) this.reel();
    else this.castOut(ctx?.entities);
    return true;
  }

  castOut(entities) {
    const p = this.player;
    if (p.vehicle || p.dead) return false;
    const dir = p.getForwardVector();
    const pos = this._rodTip(this._tip).clone();
    if (IS_SOLID[this.world.getBlock(Math.floor(pos.x), Math.floor(pos.y), Math.floor(pos.z))]) pos.copy(p.getEyePosition());
    // (a little up and a little random, like the classic cast; plus the angler's own motion)
    const vel = dir.multiplyScalar(CAST_SPEED);
    vel.y += 2.5;
    vel.x += rnd(-0.6, 0.6) + (p.velocity?.x ?? 0) * 0.5;
    vel.z += rnd(-0.6, 0.6) + (p.velocity?.z ?? 0) * 0.5;
    this.bobber = { pos, vel, inWater: false, onGround: false, wait: 0, approach: 0, nibble: 0, entities, age: 0, bubbleT: 0, fishAngle: 0 };
    this.mesh.visible = true;
    this.mesh.position.copy(pos);
    this.line.visible = true;
    this.audio.playThrow?.();
    if (this.held) this.held.rodCast = true;
    return true;
  }

  // Reels in: a fish on the hook is caught, a bobber on the ground costs wear.
  reel() {
    const b = this.bobber;
    if (!b) return;
    let wear = 0;
    if (b.nibble > 0) {
      this._catch(b);
      wear = 1;
    } else if (b.onGround) wear = 2;
    this._remove();
    if (wear && !this.player.creative) {
      if (this.inventory.damageSelected(wear)) this.audio.playToolBreak?.();
      this.onChange?.();
    }
    this.audio.playClick?.();
  }

  // Makes the fish bite now (tests): the bobber must be in water.
  forceBite() {
    const b = this.bobber;
    if (!b || !b.inWater) return false;
    this._bite(b);
    return true;
  }

  cancel() {
    if (this.bobber) this._remove();
  }

  _remove() {
    this.bobber = null;
    this.mesh.visible = false;
    this.line.visible = false;
    if (this.held) this.held.rodCast = false;
  }

  // The rod's tip, in the world (for the line).
  _rodTip(out) {
    const p = this.player;
    const eye = p.getEyePosition();
    const f = p.getForwardVector();
    out.copy(eye).addScaledVector(f, 0.75);
    out.x += Math.cos(p.yaw) * 0.32;
    out.y += 0.12;
    out.z -= Math.sin(p.yaw) * 0.32;
    return out;
  }

  // In open water (a 5x5 of water with air above, as the classic game asks
  // before it gives treasure).
  _openWater(x, y, z) {
    const w = this.world;
    for (let dx = -2; dx <= 2; dx++) {
      for (let dz = -2; dz <= 2; dz++) {
        if (w.getBlock(x + dx, y, z + dz) !== BLOCK.WATER) return false;
        if (w.getBlock(x + dx, y + 1, z + dz) !== BLOCK.AIR) return false;
      }
    }
    return true;
  }

  _catch(b) {
    const x = Math.floor(b.pos.x);
    const y = Math.floor(b.pos.y);
    const z = Math.floor(b.pos.z);
    const r = Math.random();
    const open = this._openWater(x, y, z);
    // (Not in open water, the treasure share goes to fish.)
    const e = pick(r < 0.85 || (!open && r >= 0.95) ? FISH : r < 0.95 ? JUNK : TREASURE);
    if (!e) return;
    const [id, , wearMin, wearMax] = e;
    const info = itemInfo(id);
    const wear = info?.tool || info?.armor;
    const dur = wear && wearMax !== undefined ? Math.max(1, Math.round(wear.durability * (1 - rnd(wearMin, wearMax)))) : undefined;
    // It flies from the water to the angler, landing at their feet in about a second.
    const p = this.player.position;
    const from = b.pos.clone();
    from.y += 0.5; // (out of the water, or it would float there)
    const t = 0.9;
    const vel = new THREE.Vector3((p.x - from.x) / t, (p.y + 0.5 - from.y) / t - 0.5 * -20 * t, (p.z - from.z) / t);
    const ents = b.entities;
    if (ents) ents.spawn(id, Math.min(1, maxStack(id)), from, vel, { dur, pickupDelay: 0 });
    else this.inventory.add(id, 1, dur);
    this.caught++;
    this.onXp?.(1 + Math.floor(Math.random() * 6), from);
    this._splash(b.pos, 10);
  }

  _bite(b) {
    b.approach = 0;
    b.wait = 0;
    b.nibble = rnd(NIBBLE[0], NIBBLE[1]);
    this.audio.playSplash?.();
    this._splash(b.pos, 8);
  }

  _splash(pos, n) {
    const d = this.effects?.debris;
    if (!d) return;
    for (let i = 0; i < n; i++) d.spawn(pos.x + rnd(-0.2, 0.2), pos.y + 0.1, pos.z + rnd(-0.2, 0.2), rnd(-1.2, 1.2), rnd(1.5, 3.5), rnd(-1.2, 1.2), 0.05, this._c.splash, 0.5);
  }

  update(dt) {
    const b = this.bobber;
    if (!b) return;
    const p = this.player;
    // The bobber goes with the rod (switched away, broken), the angler's death or a vehicle.
    if (this.inventory.selectedStack?.id !== FISHING_ROD || p.dead || p.vehicle || b.pos.distanceTo(p.position) > MAX_DISTANCE) {
      this._remove();
      return;
    }
    b.age += dt;
    const w = this.world;
    const id = w.getBlock(Math.floor(b.pos.x), Math.floor(b.pos.y), Math.floor(b.pos.z));
    if (id === LAVA) {
      // (burnt up)
      this._remove();
      return;
    }
    const wasInWater = b.inWater;
    b.inWater = id === BLOCK.WATER;
    if (b.inWater) {
      // Floats: springs toward the water's surface (dipping while a fish bites).
      let top = Math.floor(b.pos.y);
      while (top < Math.floor(b.pos.y) + 4 && w.getBlock(Math.floor(b.pos.x), top + 1, Math.floor(b.pos.z)) === BLOCK.WATER) top++;
      const surface = top + 1 - 0.12 - (b.nibble > 0 ? 0.28 : 0);
      b.vel.y += ((surface - b.pos.y) * 30 - b.vel.y * 6) * dt;
      const k = Math.exp(-4 * dt);
      b.vel.x *= k;
      b.vel.z *= k;
      if (!wasInWater) {
        this.audio.playSplash?.();
        this._splash(b.pos, 5);
        b.wait = rnd(WAIT[0], WAIT[1]);
      }
      this._fish(b, dt);
    } else {
      b.vel.y += GRAVITY * dt;
      const k = Math.exp(-AIR_DRAG * dt);
      b.vel.x *= k;
      b.vel.z *= k;
      b.vel.y *= k;
      if (wasInWater) b.nibble = b.approach = 0;
    }
    // Moves, stopping on blocks (it rests on top of what it lands on).
    const step = this._step.copy(b.vel).multiplyScalar(dt);
    const len = step.length();
    if (len > 1e-5) {
      const dir = this._dir.copy(step).divideScalar(len);
      const hit = w.raycast(b.pos, dir, len + 0.08, { solidOnly: true });
      if (hit) {
        b.pos.addScaledVector(dir, Math.max(0, hit.distance - 0.08));
        if (hit.normal[1] > 0) {
          b.onGround = true;
          b.vel.set(0, 0, 0);
        } else {
          b.vel.x *= hit.normal[0] ? -0.1 : 1;
          b.vel.z *= hit.normal[2] ? -0.1 : 1;
          if (hit.normal[1] < 0) b.vel.y = 0;
        }
      } else {
        b.pos.add(step);
        if (b.onGround && !IS_SOLID[w.getBlock(Math.floor(b.pos.x), Math.floor(b.pos.y - 0.1), Math.floor(b.pos.z))]) b.onGround = false;
      }
    }
    if (b.pos.y < -10) {
      this._remove();
      return;
    }
    this.mesh.position.copy(b.pos);
    this.light = w.lightAt(b.pos.x, b.pos.y + 0.2, b.pos.z);
    this._drawLine();
  }

  // The fish's side of it: waiting, swimming up, biting.
  _fish(b, dt) {
    if (b.nibble > 0) {
      b.nibble -= dt;
      if (b.nibble <= 0) {
        b.nibble = 0;
        b.wait = rnd(WAIT[0], WAIT[1]); // (it got away: wait for the next)
      }
      return;
    }
    if (b.approach > 0) {
      b.approach -= dt;
      // Bubbles trailing in toward the bobber.
      b.bubbleT -= dt;
      if (b.bubbleT <= 0 && this.effects?.debris) {
        b.bubbleT = 0.08;
        const r = Math.max(0.3, b.approach * 1.4);
        this.effects.debris.spawn(b.pos.x + Math.cos(b.fishAngle) * r, b.pos.y + 0.05, b.pos.z + Math.sin(b.fishAngle) * r, 0, 0.6, 0, 0.035, this._c.bubble, 0.4);
      }
      if (b.approach <= 0) this._bite(b);
      return;
    }
    // (Under a roof the fish come half as fast, as in the classic game.)
    const sky = this.world.lightAt(b.pos.x, b.pos.y + 1, b.pos.z).sky;
    b.wait -= sky >= 15 ? dt : dt * 0.5;
    if (b.wait <= 0) {
      b.approach = rnd(APPROACH[0], APPROACH[1]);
      b.fishAngle = Math.random() * Math.PI * 2;
    }
  }

  _drawLine() {
    const a = this._rodTip(this._tip);
    const b = this.bobber.pos;
    const arr = this._linePos;
    const dist = a.distanceTo(b);
    // (taut while a fish pulls, slack otherwise)
    const sag = this.bobber.nibble > 0 ? 0.05 : Math.min(1.6, dist * 0.08);
    for (let i = 0; i < LINE_POINTS; i++) {
      const t = i / (LINE_POINTS - 1);
      arr[i * 3] = a.x + (b.x - a.x) * t;
      arr[i * 3 + 1] = a.y + (b.y + 0.12 - a.y) * t - Math.sin(t * Math.PI) * sag;
      arr[i * 3 + 2] = a.z + (b.z - a.z) * t;
    }
    this.line.geometry.attributes.position.needsUpdate = true;
  }

  dispose() {
    this._remove();
    this.scene.remove(this.mesh);
    this.scene.remove(this.line);
  }
}
