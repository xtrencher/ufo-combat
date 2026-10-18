// Dropped item entities: blocks and items lying in the world that the player
// can pick up. They fall and bounce, float in water, bob and spin, merge
// with identical stacks nearby, and despawn after a while. Items in unloaded
// chunks simply wait (no physics).
// (Round 12) Picked up as vanilla's: once the player's box grown by 1 block
// sideways and 0.5 up and down touches the item (checked every frame, along
// the whole of the frame's move, so walking or sprinting past one takes it),
// after vanilla's pickup delay (0.5 s; 2 s for what a player throws), and
// the item flies into the player (vanilla's 3-tick pickup animation). A
// cactus destroys items that touch it (vanilla). (A Missions world keeps its
// pull toward a nearby player.)
import * as THREE from "three";
import { BLOCK, IS_SOLID, IS_WET } from "./blocks.js";
import { maxStack } from "./items.js";
import { itemModel } from "./models.js";
import { createEntityMaterial, bindEntityLight } from "./shaders.js";
import { EGG, SNOWBALL, ENDER_PEARL } from "./content/ids.js";
import { LIB } from "./content/base.js";
import { BODY, BODY_FLAGS } from "./survival.js";
import { isVanilla } from "./worldtype.js";

const GRAVITY = -20;
const DESPAWN_SECONDS = 300;
const MAGNET_RADIUS = 2.6;
const MAX_ITEMS = 300;
const SIZE = 0.25; // half-extent used for collision
// (Round 12) Vanilla's pickup: the player's box (0.6 x 1.8) grown by 1
// sideways and 0.5 up and down, against the item's own (0.25 x 0.25).
export const PICKUP_DELAY = 0.5; // (10 ticks; a player's throw: THROWN_PICKUP_DELAY)
export const THROWN_PICKUP_DELAY = 2; // (40 ticks)
const PLAYER_R = 0.3;
const PLAYER_H = 1.8;
const REACH_XZ = PLAYER_R + 1 + 0.125;
const REACH_DOWN = 0.5 + 0.25; // (the item's top must be above the grown box's bottom)
const REACH_UP = PLAYER_H + 0.5;
const FLY_TIME = 0.15; // (the pickup animation: 3 ticks)

export class ItemEntities {
  constructor(scene, world) {
    this.scene = scene;
    this.world = world;
    this.items = [];
    this.group = new THREE.Group();
    scene.add(this.group);
    this.materials = {
      array: createEntityMaterial("array", world.atlas),
      color: createEntityMaterial("color"),
    };
    this._mergeTimer = 0;
    this.onPickup = null; // (item) => leftover count
    this._flying = []; // picked-up items flying in: { mesh, from, to (a position), t, light }
    this._prev = new THREE.Vector3(); // (the player's feet last frame: the pickup box sweeps the move)
    this._hasPrev = false;
  }

  // Spawns a stack at `pos` with velocity `vel`. pickupDelay: seconds before
  // it can be collected (longer for items the player throws).
  // keep: never despawns (a mission's weapon drop).
  // (Round 12) dim: the dimension it lies in (a code, js/dim-registry.js;
  // default: where things drop now, world.itemDim).
  spawn(id, count, pos, vel = null, { dur, tag, pickupDelay = PICKUP_DELAY, keep = false, dim } = {}) {
    const model = itemModel(id);
    if (!model || count <= 0) return null;
    if (this.items.length >= MAX_ITEMS) {
      const old = this.items.findIndex((x) => !x.keep);
      this._remove(old >= 0 ? old : 0);
    }
    const mesh = new THREE.Mesh(model.geometry, this.materials[model.kind]);
    mesh.scale.setScalar(model.cube ? 0.3 : 0.45);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    const item = {
      id,
      count,
      dur,
      tag, // (Round 11: enchantments, a custom name: js/inventory.js)
      mesh,
      pos: pos.clone(),
      vel: vel ? vel.clone() : new THREE.Vector3((Math.random() - 0.5) * 2, 3 + Math.random() * 1.5, (Math.random() - 0.5) * 2),
      age: 0,
      pickupDelay,
      spin: Math.random() * Math.PI * 2,
      light: { sky: 15, block: 0 },
      onGround: false,
      keep,
      dim: dim ?? this.world.itemDim ?? 0,
    };
    bindEntityLight(mesh, () => item.light);
    this.group.add(mesh);
    this.items.push(item);
    this._place(item);
    return item;
  }

  _remove(i) {
    const item = this.items[i];
    this.group.remove(item.mesh);
    this.items.splice(i, 1);
  }

  clear() {
    while (this.items.length) this._remove(this.items.length - 1);
    for (const f of this._flying) this.group.remove(f.mesh);
    this._flying.length = 0;
    this._hasPrev = false;
  }

  // (Round 12) Takes item `it` out of the world with vanilla's pickup
  // animation: it flies to `to` (a position that may move: the taker's feet,
  // 0.5 up) in 3 ticks. Online the item a host gives to someone flies to them.
  collect(it, to) {
    const i = this.items.indexOf(it);
    if (i < 0) return;
    this.items.splice(i, 1);
    if (!to || this._flying.length > 24) {
      this.group.remove(it.mesh);
      return;
    }
    const f = { mesh: it.mesh, from: it.mesh.position.clone(), to, t: 0, light: it.light };
    bindEntityLight(it.mesh, () => f.light);
    this._flying.push(f);
  }

  _updateFlying(dt) {
    for (let i = this._flying.length - 1; i >= 0; i--) {
      const f = this._flying[i];
      f.t += dt / FLY_TIME;
      if (f.t >= 1) {
        this.group.remove(f.mesh);
        this._flying.splice(i, 1);
        continue;
      }
      const k = f.t * f.t; // (vanilla: eased in)
      f.mesh.position.set(f.from.x + (f.to.x - f.from.x) * k, f.from.y + (f.to.y + 0.5 - f.from.y) * k, f.from.z + (f.to.z - f.from.z) * k);
    }
  }

  // Whether the player (feet now at `p`, at `q` last frame) can reach item
  // `it`: vanilla's grown box, swept along the frame's move.
  _reaches(it, p, q) {
    const x = it.pos.x;
    const y = it.pos.y;
    const z = it.pos.z;
    if (x < Math.min(p.x, q.x) - REACH_XZ || x > Math.max(p.x, q.x) + REACH_XZ) return false;
    if (z < Math.min(p.z, q.z) - REACH_XZ || z > Math.max(p.z, q.z) + REACH_XZ) return false;
    return y > Math.min(p.y, q.y) - REACH_DOWN && y < Math.max(p.y, q.y) + REACH_UP;
  }

  // (Round 12) Whether a cactus touches the item: against a side (it bounces
  // off at SIZE) or lying on top.
  _onCactus(p) {
    const w = this.world;
    const e = SIZE + 0.05;
    for (let bx = Math.floor(p.x - e); bx <= Math.floor(p.x + e); bx++) {
      for (let bz = Math.floor(p.z - e); bz <= Math.floor(p.z + e); bz++) {
        for (let by = Math.floor(p.y - 0.05); by <= Math.floor(p.y + 0.25); by++) if (BODY_FLAGS[w.getBlock(bx, by, bz)] & BODY.CACTUS) return true;
      }
    }
    return false;
  }

  // Removes the dropped items for which pred(item) is true.
  removeWhere(pred) {
    for (let i = this.items.length - 1; i >= 0; i--) if (pred(this.items[i])) this._remove(i);
  }

  _solid(x, y, z) {
    return IS_SOLID[this.world.getBlock(Math.floor(x), Math.floor(y), Math.floor(z))] === 1;
  }

  _place(item) {
    const bob = item.onGround ? Math.sin(item.age * 2.5) * 0.06 + 0.1 : 0;
    item.mesh.position.set(item.pos.x, item.pos.y + SIZE + bob, item.pos.z);
    item.mesh.rotation.y = item.spin + item.age * 1.4;
  }

  update(dt, player) {
    const world = this.world;
    const center = player ? new THREE.Vector3(player.position.x, player.position.y + 0.9, player.position.z) : null;
    // (The move since last frame: a teleport, a respawn or a vehicle isn't swept.)
    const feet = player?.position;
    if (feet && (!this._hasPrev || player.vehicle || this._prev.distanceToSquared(feet) > 16)) this._prev.copy(feet);
    this._hasPrev = !!feet;
    const magnet = !isVanilla();
    this._updateFlying(dt);
    for (let i = this.items.length - 1; i >= 0; i--) {
      const it = this.items[i];
      // (Round 12) Another dimension's item waits there, unseen (and doesn't age, as in unloaded ground).
      if (it.dim !== (world.dimCode ?? 0)) {
        it.mesh.visible = false;
        continue;
      }
      it.mesh.visible = true;
      it.age += dt;
      if (it.age > DESPAWN_SECONDS && !it.keep) {
        this._remove(i);
        continue;
      }
      const p = it.pos;
      if (!world.getChunk(Math.floor(p.x) >> 4, Math.floor(p.z) >> 4)) continue; // frozen until loaded
      it.pickupDelay -= dt;

      // Picked up once collectable.
      if (center && !player.dead && it.pickupDelay <= 0) {
        if (this._reaches(it, feet, this._prev)) {
          const before = it.count;
          const left = this.onPickup ? this.onPickup(it) : it.count;
          if (this.items[i] !== it) continue; // (online: the host's own grab, already handed over)
          if (left <= 0) {
            this.collect(it, feet);
            continue;
          }
          if (left < before && this._flying.length < 24) this._ghost(it, feet);
          it.count = left;
          it.pickupDelay = Math.max(it.pickupDelay, 0.25); // inventory full: try again in a moment
        } else if (magnet && !it.shared && center.distanceToSquared(p) < MAGNET_RADIUS * MAGNET_RADIUS) {
          // (A Missions world's pull. A shared item online stays put until the
          // host gives it to someone: pulled toward each player on their own
          // screen, it would be in different places for everyone.)
          const pull = new THREE.Vector3().subVectors(center, p).normalize().multiplyScalar(14 * dt);
          it.vel.add(pull);
        }
      }

      // Physics: gravity (buoyant in water), axis-by-axis collision with blocks.
      const inWater = IS_WET[world.getBlock(Math.floor(p.x), Math.floor(p.y + 0.1), Math.floor(p.z))] === 1;
      if (inWater) {
        it.vel.y += (4 - it.vel.y * 2) * dt;
        it.vel.x *= Math.exp(-2 * dt);
        it.vel.z *= Math.exp(-2 * dt);
      } else {
        it.vel.y = Math.max(it.vel.y + GRAVITY * dt, -30);
      }
      it.onGround = false;
      const nx = p.x + it.vel.x * dt;
      if (this._solid(nx + Math.sign(it.vel.x) * SIZE, p.y + 0.05, p.z)) it.vel.x *= -0.3;
      else p.x = nx;
      const nz = p.z + it.vel.z * dt;
      if (this._solid(p.x, p.y + 0.05, nz + Math.sign(it.vel.z) * SIZE)) it.vel.z *= -0.3;
      else p.z = nz;
      const ny = p.y + it.vel.y * dt;
      if (it.vel.y <= 0) {
        // (Every cell passed, not just the one landed in: at 30 blocks/s a
        // slow frame moves more than a block, through a thin roof.)
        let land = null;
        for (let c = Math.floor(p.y); c >= Math.floor(ny); c--) {
          if (this._solid(p.x, c + 0.5, p.z)) {
            land = c + 1;
            break;
          }
        }
        if (land !== null) {
          p.y = land;
          it.vel.y = 0;
          it.onGround = true;
        } else p.y = ny;
      } else if (this._solid(p.x, ny + SIZE * 2, p.z)) {
        it.vel.y = 0;
      } else {
        p.y = ny;
      }
      // Stuck inside a block (e.g. one was placed on it): pop up.
      if (this._solid(p.x, p.y + 0.05, p.z)) {
        p.y = Math.floor(p.y + 0.05) + 1;
        it.vel.y = 0;
      }
      if (it.onGround) {
        const f = Math.exp(-8 * dt);
        it.vel.x *= f;
        it.vel.z *= f;
      }
      if (p.y < -20) {
        this._remove(i);
        continue;
      }
      // (Round 12) A cactus destroys it (not a mission's weapon drop; nor in
      // its first half second: a mined cactus's own drop, popping up into the
      // one above, isn't lost).
      if (!it.keep && it.age > PICKUP_DELAY && this._onCactus(p)) {
        this._remove(i);
        continue;
      }
      it.light = world.lightAt(p.x, p.y + 0.3, p.z);
      this._place(it);
    }
    if (feet) this._prev.copy(feet);

    // Merge identical nearby stacks every so often.
    this._mergeTimer += dt;
    if (this._mergeTimer > 0.5) {
      this._mergeTimer = 0;
      this._merge();
    }
  }

  // A copy of the item's look flies in (part of a stack taken: the rest stays).
  _ghost(it, to) {
    const mesh = new THREE.Mesh(it.mesh.geometry, it.mesh.material);
    mesh.scale.copy(it.mesh.scale);
    mesh.position.copy(it.mesh.position);
    mesh.rotation.copy(it.mesh.rotation);
    this.group.add(mesh);
    const f = { mesh, from: mesh.position.clone(), to, t: 0, light: it.light };
    bindEntityLight(mesh, () => f.light);
    this._flying.push(f);
  }

  _merge() {
    for (let i = 0; i < this.items.length; i++) {
      const a = this.items[i];
      // (Items shared online keep to themselves: each is one claim at the host.)
      if (a.dur !== undefined || a.tag || a.count >= maxStack(a.id) || a.shared) continue;
      for (let j = this.items.length - 1; j > i; j--) {
        const b = this.items[j];
        if (b.id !== a.id || b.dur !== undefined || b.tag || b.shared || b.dim !== a.dim) continue;
        if (a.pos.distanceToSquared(b.pos) > 0.8 * 0.8) continue;
        const room = maxStack(a.id) - a.count;
        const n = Math.min(room, b.count);
        a.count += n;
        b.count -= n;
        if (b.count <= 0) this._remove(j);
        if (a.count >= maxStack(a.id)) break;
      }
    }
  }
}

// ---------- Thrown items (Round 11) ----------
// Eggs, snowballs and ender pearls, thrown as in the classic game (30
// blocks/s, gravity 12, a little drag; the thrower's own motion added). They
// break on the first block or creature they meet: an egg hatches a chick one
// time in eight (four chicks one time in 256: onHatch, else the creatures'
// LIB.spawnMob, which online asks the host), a
// snowball does nothing but shatter, an ender pearl takes the thrower there
// (5 damage, as a fall: armor doesn't help). Each throw is the thrower's own
// (online: their pearl moves only them; a chick is the host's to spawn).
const THROW_SPEED = 30;
const THROW_GRAVITY = -12;
const THROW_DRAG = 0.2; // 1/s (0.99 a tick)
const THROW_LIFE = 12;
const THROWN = { [EGG]: "egg", [SNOWBALL]: "snowball", [ENDER_PEARL]: "pearl" };
const SHARDS = { egg: new THREE.Color(0.93, 0.88, 0.74), snowball: new THREE.Color(0.95, 0.97, 1), pearl: new THREE.Color(0.1, 0.45, 0.38) };

export class Throwables {
  constructor({ scene, world, player, audio, effects, mobs }) {
    this.scene = scene;
    this.world = world;
    this.player = player;
    this.audio = audio;
    this.effects = effects;
    this.mobs = mobs;
    this.list = []; // { id, kind, pos, vel, age, mesh, light }
    this.material = createEntityMaterial("color");
    this.onHatch = null; // (pos, count): an egg hatched chicks (the creatures spawn them)
    this.onTeleport = null; // (pos): an ender pearl took the player there
    this._dir = new THREE.Vector3();
    this._step = new THREE.Vector3();
  }

  // Throws one of item `id` from the player's eye. Returns the throw (or null).
  throw(id) {
    const kind = THROWN[id];
    const model = kind ? itemModel(id) : null;
    if (!model) return null;
    const p = this.player;
    const pos = p.getEyePosition();
    pos.y -= 0.1;
    const vel = p.getForwardVector().multiplyScalar(THROW_SPEED);
    if (p.velocity) vel.add(p.velocity.clone().setY(p.onGround ? 0 : p.velocity.y));
    const mesh = new THREE.Mesh(model.geometry, this.material);
    mesh.scale.setScalar(0.32);
    const t = { id, kind, pos, vel, age: 0, mesh, light: { sky: 15, block: 0 } };
    bindEntityLight(mesh, () => t.light);
    mesh.position.copy(pos);
    this.scene.add(mesh);
    this.list.push(t);
    this.audio.playThrow?.();
    return t;
  }

  clear() {
    for (const t of this.list) this.scene.remove(t.mesh);
    this.list.length = 0;
  }

  update(dt) {
    for (let i = this.list.length - 1; i >= 0; i--) {
      const t = this.list[i];
      t.age += dt;
      t.vel.y += THROW_GRAVITY * dt;
      t.vel.multiplyScalar(Math.exp(-THROW_DRAG * dt));
      const step = this._step.copy(t.vel).multiplyScalar(dt);
      const len = step.length();
      const dir = this._dir.copy(step).divideScalar(len || 1);
      const block = this.world.raycast(t.pos, dir, len, { solidOnly: true });
      const mob = this.mobs?.raycast(t.pos, dir, block ? block.distance : len);
      if (block || mob) {
        const d = mob ? mob.distance : block.distance;
        const at = t.pos.clone().addScaledVector(dir, Math.max(0, d - 0.05));
        this._land(t, at, mob ? null : block);
        this.scene.remove(t.mesh);
        this.list.splice(i, 1);
        continue;
      }
      t.pos.add(step);
      if (t.age > THROW_LIFE || t.pos.y < -20) {
        this.scene.remove(t.mesh);
        this.list.splice(i, 1);
        continue;
      }
      t.mesh.position.copy(t.pos);
      t.mesh.rotation.y = this.player.yaw; // (a flat icon: kept facing the view)
      t.light = this.world.lightAt(t.pos.x, t.pos.y, t.pos.z);
    }
  }

  _land(t, at, block) {
    const d = this.effects?.debris;
    if (d) for (let k = 0; k < 8; k++) d.spawn(at.x, at.y, at.z, (Math.random() - 0.5) * 3, Math.random() * 2.5, (Math.random() - 0.5) * 3, 0.05, SHARDS[t.kind], 0.6);
    if (t.kind === "egg") {
      if (Math.random() < 1 / 8) this.hatch(at, Math.random() < 1 / 32 ? 4 : 1);
    } else if (t.kind === "pearl") this._teleport(at, block);
  }

  hatch(at, n) {
    if (this.onHatch) return this.onHatch(at, n);
    for (let k = 0; k < n; k++) LIB.spawnMob?.("chicken", at.x + (Math.random() - 0.5) * 0.4, at.y + 0.05, at.z + (Math.random() - 0.5) * 0.4, { baby: true });
  }

  // Takes the player to where the pearl broke: onto the face it hit, in a
  // cell with room to stand (the cell itself, or one above).
  _teleport(at, block) {
    const p = this.player;
    if (p.dead || p.vehicle) return;
    let x = at.x;
    let y = at.y;
    let z = at.z;
    if (block) {
      const [nx, ny, nz] = block.normal;
      if (ny > 0) y = block.block[1] + 1;
      else {
        x += nx * 0.35;
        z += nz * 0.35;
        y = Math.floor(y);
      }
    }
    const fx = Math.floor(x);
    const fz = Math.floor(z);
    let fy = Math.floor(y);
    for (let k = 0; k < 3 && (IS_SOLID[this.world.getBlock(fx, fy, fz)] || IS_SOLID[this.world.getBlock(fx, fy + 1, fz)]); k++) fy++;
    p.position.set(x, Math.max(y, fy), z);
    p.velocity?.set(0, 0, 0);
    p.resetFall?.();
    this.audio.playTeleport?.();
    p.damage?.(5, "fall");
    this.onTeleport?.(p.position);
  }

  // Online (net/fx.js): a throw's kind for the wire, and the mesh another
  // player's throw of that kind is drawn with.
  netKind(t) {
    return t.kind === "egg" ? "eg" : t.kind === "snowball" ? "sb" : "ep";
  }

  remoteMesh(kind) {
    const id = kind === "eg" ? EGG : kind === "sb" ? SNOWBALL : kind === "ep" ? ENDER_PEARL : 0;
    const model = id ? itemModel(id) : null;
    if (!model) return null;
    const mesh = new THREE.Mesh(model.geometry, this.material);
    mesh.scale.setScalar(0.32);
    return mesh;
  }
}
