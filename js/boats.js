// Boats, and the vehicles of wood and iron in general (Round 12): the boats
// and minecarts in the world (js/minecarts.js is the carts' own physics and
// the rails' redstone; js/content/transport.js their blocks and items),
// riding them, hitting them, their chests, saves and the hooks for online
// (js/net/transport.js). Vanilla Java 1.20's.
//
// A boat (Boat.tick, 20 a second): it floats where its bottom is under the
// surface, rows with the rider's W/S/A/D (0.04 a tick forward, 0.005 back
// or turning on the spot, turns of a degree a tick, friction 0.9 on water,
// the ground's own on land: halved under a player, ice 0.98, so a boat
// flies along ice), carries two (the second sits behind; a creature it
// bumps into gets in while no player steers it, an animal sits sideways in
// a full boat), throws its riders out after 3 s under water, breaks into 3
// planks and 2 sticks falling more than 3 blocks onto land (its riders take
// the fall), burns up in lava. The rider's view turns with it, at most 105
// degrees off its bow. A minecart: js/minecarts.js. Either is broken by
// hits (vanilla's damage x 10 over 40, healing 1 a tick; at once in
// Creative, without the item), dropping its item (and a chest's contents).
// Right click gets in (sneaking, a chest boat's chest; a chest minecart's
// chest opens), Shift gets out beside it. Players and creatures push the
// empty ones, carts bump carts along the line, a cart rolling past a
// creature picks it up. (Where it differs: players are pushed off a boat or
// a cart, not stood on; a rider gets out where the vehicle is, through no
// portal.)
//
// Who runs one: its driver (the first rider, a player), else the peer that
// runs its dimension's world (the host; js/dimensions.js simulatesWorld).
// The others draw it from that peer's states. The host keeps every
// vehicle (and saves them, with their chests); a guest asks it to ride, to
// hit, to place, and for a chest's contents (js/net/transport.js).
import * as THREE from "three";
import { BLOCK, BLOCK_INFO, IS_SOLID, IS_WET, TILE } from "./blocks.js";
import { itemInfo, meleeDamage, maxStack } from "./items.js";
import { sweepAxis, boxInSolid, rayAabb } from "./physics.js";
import { createEntityMaterial, bindEntityLight } from "./shaders.js";
import { blockCubeGeometry } from "./models.js";
import { encodeStack, decodeStack, sameStack } from "./inventory.js";
import { PICKUP_DELAY } from "./entities.js";
import { WATER_SURFACE_HEIGHT } from "./mesher.js";
import { isVanilla } from "./worldtype.js";
import { LIB } from "./content/base.js";
import * as I from "./content/ids.js";
import { WOODS, boatItem, cartItem, isRail, RAIL_SHAPE, isAscending, EW, ASC_E, ASC_W } from "./content/transport.js";
import { isLava } from "./content/nature.js";
import { cartTick, cartGeometry, boxesGeometry, RailSystem, CART_R, CART_H, CART_FLOOR, chestSignal } from "./minecarts.js";
import { codeOf, OVERWORLD } from "./dim-registry.js";

export const TICK = 0.05;
export const BOAT_R = 0.6875; // (half of vanilla's 1.375)
export const BOAT_H = 0.5625;
export const BOAT_FLOOR = 0.42; // (the model's floor, over the water line it floats at)
export const CHEST_SLOTS = 27;
export const MAX_VEHICLES = 256;
const VIEW = 128; // blocks: drawn this near
const REACH = 5; // (placing a boat on the water: vanilla's 5)
const SIT_BOAT = -0.3; // a seated player's feet under the boat's bottom
const SIT_CART = -0.35;
const STATUS = { WATER: 0, UNDER: 1, LAND: 2, AIR: 3 };
const DEG = Math.PI / 180;
const _v = new THREE.Vector3();
const _o = new THREE.Vector3();

const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));
const fwdX = (yaw) => -Math.sin(yaw);
const fwdZ = (yaw) => -Math.cos(yaw);

// ---------- The boat's physics (Boat) ----------

// The surface of the water in a cell (0.875 of it: as drawn; the whole cell under more water).
function fluidTop(w, x, y, z) {
  return IS_WET[w.getBlock(x, y + 1, z)] ? y + 1 : y + WATER_SURFACE_HEIGHT;
}

function boatStatus(v, w) {
  const p = v.pos;
  const x0 = Math.floor(p.x - BOAT_R);
  const x1 = Math.floor(p.x + BOAT_R);
  const z0 = Math.floor(p.z - BOAT_R);
  const z1 = Math.floor(p.z + BOAT_R);
  const top = p.y + BOAT_H;
  // Under water: the top below the surface.
  for (let x = x0; x <= x1; x++) {
    for (let z = z0; z <= z1; z++) {
      for (let y = Math.floor(top); y <= Math.floor(top + 0.001); y++) {
        if (IS_WET[w.getBlock(x, y, z)] && top + 0.001 < fluidTop(w, x, y, z)) {
          v.waterLevel = top;
          return STATUS.UNDER;
        }
      }
    }
  }
  // In the water: its bottom under the surface.
  let level = -Infinity;
  let wet = false;
  for (let x = x0; x <= x1; x++) {
    for (let z = z0; z <= z1; z++) {
      for (let y = Math.floor(p.y); y <= Math.floor(p.y + 0.001); y++) {
        if (!IS_WET[w.getBlock(x, y, z)]) continue;
        const t = fluidTop(w, x, y, z);
        level = Math.max(level, t);
        if (p.y < t) wet = true;
      }
    }
  }
  if (wet) {
    v.waterLevel = level;
    return STATUS.WATER;
  }
  // On the ground: its friction (vanilla's mean over the blocks under it; 0.6 unless ice or slime).
  let sum = 0;
  let n = 0;
  const y = Math.floor(p.y - 0.001);
  for (let x = x0; x <= x1; x++) {
    for (let z = z0; z <= z1; z++) {
      const id = w.getBlock(x, y, z);
      if (!IS_SOLID[id]) continue;
      sum += BLOCK_INFO[id]?.slipperiness || 0.6;
      n++;
    }
  }
  if (n && p.y - (y + 1) < 0.01) {
    v.landFriction = sum / n;
    return STATUS.LAND;
  }
  return STATUS.AIR;
}

// One tick of a boat. T: the Transport (its world, input, riders).
function boatTick(v, T) {
  const w = T.world;
  v.oldStatus = v.status;
  v.status = boatStatus(v, w);
  v.outOfControl = v.status === STATUS.UNDER ? v.outOfControl + 1 : 0;
  if (v.outOfControl >= 60 && v.riders.length) T.ejectAll(v);
  if (v.hurtTime > 0) v.hurtTime--;
  if (v.damage > 0) v.damage--;
  const vel = v.vel;
  // floatBoat
  let gravity = -0.04;
  let buoy = 0;
  let inv = 0.05;
  if (v.oldStatus === STATUS.AIR && v.status !== STATUS.AIR && v.status !== STATUS.LAND) {
    // (landing on the water: on its surface)
    v.pos.y = v.waterLevel - BOAT_H + 0.101;
    vel.y = 0;
    v.status = STATUS.WATER;
  } else {
    if (v.status === STATUS.WATER) {
      buoy = (v.waterLevel - v.pos.y) / BOAT_H;
      inv = 0.9;
    } else if (v.status === STATUS.UNDER) {
      buoy = 0.01;
      inv = 0.45;
    } else if (v.status === STATUS.AIR) inv = 0.9;
    else if (v.status === STATUS.LAND) {
      inv = v.landFriction;
      if (T.playerDriven(v)) v.landFriction /= 2;
    }
    vel.x *= inv;
    vel.z *= inv;
    vel.y += gravity;
    v.dRot *= inv;
    if (buoy > 0) vel.y = (vel.y + buoy * 0.06153846016296973) * 0.75;
  }
  // controlBoat: the driver's keys.
  const k = T.boatInput(v);
  v.rowing = 0;
  if (k && v.riders.length) {
    let f = 0;
    if (k.left) v.dRot -= 1;
    if (k.right) v.dRot += 1;
    if (k.right !== k.left && !k.up && !k.down) f += 0.005;
    v.yaw -= v.dRot * DEG;
    if (k.up) f += 0.04;
    if (k.down) f -= 0.005;
    vel.x += fwdX(v.yaw) * f;
    vel.z += fwdZ(v.yaw) * f;
    v.rowing = ((k.right && !k.left) || k.up ? 1 : 0) | ((k.left && !k.right) || k.up ? 2 : 0);
  } else if (v.riders.length) v.yaw -= v.dRot * DEG;
  // move
  const y0 = v.pos.y;
  let ground = false;
  const p = v.pos;
  const dy = sweepAxis(w, p, BOAT_R, BOAT_H, "y", vel.y);
  p.y += dy;
  if (Math.abs(dy - vel.y) > 1e-7) {
    if (vel.y < 0) ground = true;
    vel.y = 0;
  }
  const dx = sweepAxis(w, p, BOAT_R, BOAT_H, "x", vel.x);
  p.x += dx;
  if (Math.abs(dx - vel.x) > 1e-7) vel.x = 0;
  const dz = sweepAxis(w, p, BOAT_R, BOAT_H, "z", vel.z);
  p.z += dz;
  if (Math.abs(dz - vel.z) > 1e-7) vel.z = 0;
  v.onGround = ground;
  // The oars (vanilla: an eighth of a turn a tick while rowing).
  for (let i = 0; i < 2; i++) v.paddle[i] = v.rowing & (1 << i) ? v.paddle[i] + Math.PI / 8 : 0;
  // A fall onto land breaks it (vanilla's checkFallDamage).
  if (v.status === STATUS.WATER || v.status === STATUS.UNDER) v.fall = 0;
  else if (p.y < y0) v.fall += y0 - p.y;
  if (ground) {
    if (v.fall > 3 && boatStatus(v, w) === STATUS.LAND) v.fallBreak = v.fall;
    v.fall = 0;
  }
  v.inLava = isLava(w.getBlock(Math.floor(p.x), Math.floor(p.y + 0.2), Math.floor(p.z)));
}

// ---------- Models ----------

// A boat: its hull of the wood's planks (the floor over its water line),
// 1.75 long and 1.375 wide, the bow toward -Z.
function boatGeometry(layer) {
  const X = BOAT_R;
  const Xi = BOAT_R - 0.125;
  const Z = 0.875;
  const B = -0.0625;
  const F = BOAT_FLOOR;
  const H = 0.75;
  return boxesGeometry([
    [-Xi, B, -Z, Xi, F, 0, layer],
    [-Xi, B, 0, Xi, F, Z, layer],
    [-X, B + 0.125, -Z, -Xi, H, 0, layer],
    [-X, B + 0.125, 0, -Xi, H, Z, layer],
    [Xi, B + 0.125, -Z, X, H, 0, layer],
    [Xi, B + 0.125, 0, X, H, Z, layer],
    [-Xi, F, -Z, Xi, H - 0.0625, -Z + 0.125, layer],
    [-Xi, F, Z - 0.125, Xi, H - 0.0625, Z, layer],
  ]);
}
function oarGeometry(layer) {
  return boxesGeometry([
    [-0.03, -0.03, -0.1, 0.03, 0.03, 0.95, layer],
    [-0.015, -0.12, 0.62, 0.015, 0.12, 1.02, layer],
  ]);
}

// The rider's seat pose on a player model (vanilla's riding pose: the legs
// out in front a little apart, the arms forward).
export function sitPose(avatar) {
  const P = avatar?.model?.parts;
  if (!P || !avatar.root.visible) return;
  P.legL.rotation.set(-1.4137, -0.3142, -0.0785);
  P.legR.rotation.set(-1.4137, 0.3142, 0.0785);
  P.armL.rotation.x += -0.6283;
  P.armR.rotation.x += -0.6283;
}

// ---------- The vehicles ----------

export class Transport {
  // game: world, scene, player, mobs, entities, inventory, audio, interaction, toast, GUEST.
  // extra: dims (who runs a dimension), mp (online), invScreen / chests /
  // openInventory / closeInventory (a chest's screen).
  constructor(game, { dims = null, mp = null, invScreen = null, chests = null, openInventory = null, closeInventory = null } = {}) {
    this.game = game;
    this.world = game.world;
    this.player = game.player;
    this.dims = dims;
    this.mp = mp;
    this.invScreen = invScreen;
    this.chests = chests;
    this.openInventory = openInventory;
    this.closeInventory = closeInventory;
    this.vehicles = new Map(); // id -> vehicle
    this.authority = true; // false on a guest: the host keeps them
    this.remote = null; // js/net/transport.js
    this.mounted = null; // { v, placed, lastYaw }: what this player sits in
    this.handle = { ride: (p, dt) => this._ride(p, dt) }; // (player.mount)
    this.view = null; // the chest open on the screen
    this.frame = 0;
    this._pendingMount = null; // (a save made riding: in again once it is there)
    this._claim = null; // { id, t }: a guest asked to ride
    this._pending = null; // a guest's chest click with the host
    this._q = 0;
    this._checkT = 0;
    this.stats = { ticks: 0, placed: 0, broken: 0 };
    this.group = new THREE.Group();
    game.scene?.add(this.group);
    this.material = game.scene ? createEntityMaterial("array", this.world.atlas) : null;
    this._geo = new Map();
    this.rails = new RailSystem({ world: this.world, simulates: () => this.worldSim() });
    const T = this;
    // (the carts' physics' view of the world and of the riders)
    this.env = {
      world: this.world,
      inWater: (v) => IS_WET[T.world.getBlock(Math.floor(v.pos.x), Math.floor(v.pos.y + 0.2), Math.floor(v.pos.z))] === 1,
      riderPush: (v) => T._riderPush(v),
      ridden: (v) => v.riders.length > 0,
      eject: (v) => T.ejectAll(v),
      signal: (v) => chestSignal(v.slots, maxStack),
    };
    LIB.transport = this;
    // (another dimension: the rails' memory of this one's detectors and junctions goes)
    if (Array.isArray(dims?.onChange)) dims.onChange.push(() => this.rails.clear());
    // (an edit beside a resting one wakes it: its water or its ground may be gone)
    this.world.changeListeners.push((changed) => this._wake(changed));
  }

  // ---------- Who ----------

  get me() {
    return this.mp?.active ? this.mp.net.pid : 1;
  }
  get here() {
    return codeOf(this.world.dim ?? OVERWORLD);
  }
  // This peer runs this dimension's world (alone: always; online the host, js/dimensions.js).
  worldSim() {
    if (this.dims) return this.dims.simulatesWorld();
    return !this.game.GUEST;
  }
  // Whether this peer runs the vehicle: its driver's, else the world's runner's.
  simulates(v) {
    const d = v.riders[0];
    if (d && d.p) return d.p === this.me;
    return v.dim === this.here && this.worldSim();
  }
  playerDriven(v) {
    return !!v.riders[0]?.p;
  }
  // Whether a player sits in it (the ones being pushed and picking up need none).
  ridden(v) {
    return v.riders.length > 0;
  }

  // ---------- Making them ----------

  _newId() {
    let id;
    do id = 1 + Math.floor(Math.random() * 2147483646);
    while (this.vehicles.has(id));
    return id;
  }

  // A vehicle from its record ({ i, k: "b" | "c", w, c, d, p, y, s? }).
  make(r) {
    if (!r || !Array.isArray(r.p) || r.p.length !== 3 || !r.p.every(Number.isFinite)) return null;
    const id = Number.isInteger(r.i) && r.i > 0 ? r.i : this._newId();
    const old = this.vehicles.get(id);
    if (old) this._remove(old);
    const kind = r.k === "c" ? "cart" : "boat";
    const [x, y, z] = r.p;
    const v = {
      id,
      kind,
      wood: Math.max(0, Math.min(5, r.w | 0)),
      chest: !!r.c,
      dim: r.d | 0,
      pos: new THREE.Vector3(x, y, z),
      prev: new THREE.Vector3(x, y, z),
      vel: new THREE.Vector3(),
      yaw: Number.isFinite(r.y) ? r.y : 0,
      prevYaw: Number.isFinite(r.y) ? r.y : 0,
      pitch: 0,
      riders: [],
      damage: 0,
      hurtTime: 0,
      hurtDir: 1,
      slots: null,
      acc: 0,
      stepped: -1,
      rest: 0,
      // a boat's
      status: STATUS.AIR,
      oldStatus: STATUS.AIR,
      waterLevel: 0,
      landFriction: 0.6,
      outOfControl: 0,
      dRot: 0,
      fall: 0,
      fallBreak: 0,
      rowing: 0,
      paddle: [0, 0],
      // a cart's
      onRail: false,
      onGround: false,
      shape: -1,
      lastX: x,
      lastZ: z,
      inLava: false,
      // drawing, online
      model: null,
      light: { sky: 15, block: 0, flash: null },
      renderPos: new THREE.Vector3(x, y, z),
      renderYaw: Number.isFinite(r.y) ? r.y : 0,
      interp: null,
      sentT: 0,
      isTransport: true,
    };
    if (Array.isArray(r.s) && v.chest) v.slots = Array.from({ length: CHEST_SLOTS }, (_, i) => decodeStack(r.s[i] ?? 0) || null);
    if (Array.isArray(r.r)) this.setRiders(v, r.r);
    this.vehicles.set(id, v);
    return v;
  }

  // How many it seats: a boat two, a chest boat and a minecart one, a chest minecart none.
  seats(v) {
    return v.kind === "boat" ? (v.chest ? 1 : 2) : v.chest ? 0 : 1;
  }

  record(v, slots = false) {
    const r = { i: v.id, k: v.kind === "cart" ? "c" : "b", p: [r3(v.pos.x), r3(v.pos.y), r3(v.pos.z)], y: r3(v.yaw) };
    if (v.kind === "boat") r.w = v.wood;
    if (v.chest) r.c = 1;
    if (v.dim) r.d = v.dim;
    if (slots && v.chest && v.slots) r.s = v.slots.map((s) => (s ? encodeStack(s) : 0));
    return r;
  }

  // Riders on the wire: [1, pid] a player, [2, creature id] a creature.
  writeRiders(v) {
    return v.riders.map((e) => (e.p ? [1, e.p] : [2, e.m]));
  }
  // The riders the host says (a guest; this player's own seat follows them).
  setRiders(v, list) {
    const out = [];
    for (const e of Array.isArray(list) ? list.slice(0, 2) : []) {
      if (!Array.isArray(e) || !Number.isInteger(e[1])) continue;
      if (e[0] === 1) out.push({ p: e[1] });
      else if (e[0] === 2) out.push({ m: e[1] });
    }
    for (const e of v.riders) if (e.m && !out.some((o) => o.m === e.m)) this._releaseMob(e);
    v.riders = out;
    v.mobs = out.some((e) => e.m);
    v.rest = 0;
    const mine = out.some((e) => e.p === this.me);
    if (this.mounted?.v === v && !mine) this.dismount(true);
    else if (!this.mounted && mine && this._claim?.id === v.id) this._seat(v);
  }

  // Puts a new vehicle down: kept (the host's) or asked of the host (a guest's).
  add(r) {
    if (this.vehicles.size >= MAX_VEHICLES) {
      this.game.toast?.("Too many boats and minecarts in this world: break some first.", 3);
      return null;
    }
    const v = this.make(r);
    if (!v) return null;
    this.stats.placed++;
    this.remote?.added(v);
    return v;
  }

  _remove(v) {
    if (!this.vehicles.has(v.id) || this.vehicles.get(v.id) !== v) return;
    this.vehicles.delete(v.id);
    for (const e of v.riders) if (e.m) this._releaseMob(e);
    if (this.mounted?.v === v) this.dismount(true);
    if (this.view?.v === v) {
      this.view.gone = true;
      this.view.onUpdate?.();
    }
    this._hide(v);
  }

  clear() {
    for (const v of [...this.vehicles.values()]) this._remove(v);
    this.vehicles.clear();
  }

  // ---------- Placing (the items' use, js/content/transport.js) ----------

  // A boat on the water (or the ground) aimed at, facing the way the player looks.
  placeBoat(ctx, wood, chest) {
    if (this.mounted) return false;
    const at = this._aimWater(ctx);
    if (!at) return false;
    const pos = new THREE.Vector3(at[0], at[1], at[2]);
    if (boxInSolid(this.world, pos, BOAT_R - 0.05, BOAT_H) || this._occupied(pos, BOAT_R)) return false;
    const v = this.add({ k: "b", w: wood, c: chest ? 1 : 0, d: this.here, p: [pos.x, pos.y, pos.z], y: this.player.yaw });
    if (!v) return false;
    if (!ctx.creative) ctx.inventory?.consumeSelected(1);
    if (at[3]) this.game.audio?.playSplash?.();
    else this.game.audio?.playPlace?.("wood");
    return true;
  }

  // Where the view meets water (its surface) or the top of a block, within reach:
  // [x, y, z, on water].
  _aimWater(ctx) {
    const w = this.world;
    const eye = this.player.getEyePosition();
    const f = ctx.forward || [0, 0, -1];
    const hitT = ctx.hit ? Math.hypot(ctx.hit[0] - eye.x, ctx.hit[1] - eye.y, ctx.hit[2] - eye.z) : Infinity;
    for (let t = 0; t <= REACH && t <= hitT + 0.01; t += 0.05) {
      const x = eye.x + f[0] * t;
      const y = eye.y + f[1] * t;
      const z = eye.z + f[2] * t;
      const bx = Math.floor(x);
      const by = Math.floor(y);
      const bz = Math.floor(z);
      if (!IS_WET[w.getBlock(bx, by, bz)]) continue;
      const top = fluidTop(w, bx, by, bz);
      if (y <= top) return [x, IS_WET[w.getBlock(bx, by + 1, bz)] ? by + 1 : top, z, true];
    }
    if (ctx.hit && ctx.normal && ctx.normal[1] > 0 && hitT <= REACH) return [ctx.hit[0], ctx.hit[1], ctx.hit[2], false];
    return null;
  }

  // A minecart on the rail aimed at.
  placeCart(ctx, chest) {
    if (ctx.id == null || !isRail(ctx.id)) return false;
    const shape = RAIL_SHAPE[ctx.id];
    const p = [ctx.x + 0.5, ctx.y + 0.0625 + (isAscending(shape) ? 0.5 : 0), ctx.z + 0.5];
    const along = shape === EW || shape === ASC_E || shape === ASC_W;
    if (this._occupied(_v.set(p[0], p[1], p[2]), CART_R)) return false;
    const v = this.add({ k: "c", c: chest ? 1 : 0, d: this.here, p, y: along ? Math.PI / 2 : 0 });
    if (!v) return false;
    if (!ctx.creative) ctx.inventory?.consumeSelected(1);
    this.game.audio?.playPlace?.("stone");
    return true;
  }

  // Whether a vehicle is already where a new one would go (a held button
  // doesn't stack them up).
  _occupied(pos, r) {
    const here = this.here;
    for (const v of this.vehicles.values()) {
      if (v.dim !== here) continue;
      const R = v.kind === "boat" ? BOAT_R : CART_R;
      if (Math.abs(v.pos.x - pos.x) < R + r - 0.1 && Math.abs(v.pos.z - pos.z) < R + r - 0.1 && Math.abs(v.pos.y - pos.y) < 0.9) return true;
    }
    return false;
  }

  // ---------- Riding ----------

  // Right click on a vehicle (interaction.onUseMob): in, or its chest.
  use(v, stack) {
    const p = this.player;
    if (!v || v.dead || p.dead) return false;
    if (v.kind === "cart" && v.chest) return this.openChest(v);
    if (p.sneaking) return v.kind === "boat" && v.chest ? this.openChest(v) : false;
    return this.mount(v);
  }

  mount(v) {
    if (this.mounted || this.player.vehicle || this.player.sleeping) return false;
    if (v.riders.length >= this.seats(v) || v.riders.some((e) => e.p === this.me)) return false;
    if (this.remote && !this.authority) {
      this._claim = { id: v.id, t: performance.now() };
      this.remote.ride(v);
      return true;
    }
    v.riders.push({ p: this.me });
    this.remote?.ridersChanged(v);
    this._seat(v);
    return true;
  }

  // This player is in `v` now (the host said so, or alone).
  _seat(v) {
    const p = this.player;
    this._claim = null;
    this._pose(v, 1);
    this.mounted = { v, placed: new THREE.Vector3(), lastYaw: v.renderYaw, rode: 0 };
    p.mount = this.handle;
    p.flying = false;
    this.game.interaction?.release?.();
    this._placeRider(v, p);
    this.game.toast?.("Press Shift to get out", 2.5);
    this.game.audio?.playClick?.();
  }

  // Out (stay: where the player is now, e.g. teleported away or the vehicle gone).
  dismount(stay = false) {
    const m = this.mounted;
    if (!m) return;
    this.mounted = null;
    const p = this.player;
    if (p.mount === this.handle) p.mount = null;
    const v = m.v;
    const i = v.riders.findIndex((e) => e.p === this.me);
    if (i >= 0) v.riders.splice(i, 1);
    v.interp = null; // (the states from before this player drove it are old: the next ones come)
    v.rest = 0;
    if (!stay && this.vehicles.get(v.id) === v) {
      const spot = this._exitSpot(v);
      p.position.copy(spot);
    }
    p.velocity.set(0, 0, 0);
    p.resetFall?.();
    p.syncCamera?.();
    if (this.vehicles.get(v.id) === v) this.remote?.left(v);
  }

  // Out beside it (vanilla's dismount spots: the sides first, then the
  // ends, then on top), where a player fits with ground under them.
  _exitSpot(v) {
    const w = this.world;
    const side = v.kind === "boat" ? 1.2 : 1;
    const fx = fwdX(v.yaw);
    const fz = fwdZ(v.yaw);
    const spots = [[fz, -fx], [-fz, fx], [fx * 1.4, fz * 1.4], [-fx * 1.4, -fz * 1.4], [fz + fx, -fx + fz], [-fz + fx, fx + fz], [fz - fx, -fx - fz], [-fz - fx, fx - fz]];
    // (dry ground first; out of a boat in open water, into the water beside it)
    let wet = null;
    for (const [dx, dz] of spots) {
      for (const dy of [0, 0.6, 1.1, -0.5, -1]) {
        _o.set(v.pos.x + dx * side, v.pos.y + dy, v.pos.z + dz * side);
        if (boxInSolid(w, _o, 0.3, 1.8)) continue;
        // (feet on what is under it: a block's top, a slab's)
        const down = sweepAxis(w, _o, 0.3, 1.8, "y", -1.5);
        const water = IS_WET[w.getBlock(Math.floor(_o.x), Math.floor(_o.y + down + 0.1), Math.floor(_o.z))] || IS_WET[w.getBlock(Math.floor(_o.x), Math.floor(_o.y - 0.5), Math.floor(_o.z))];
        if (down <= -1.5 + 1e-6 && !water) continue;
        if (water) {
          wet ||= new THREE.Vector3(_o.x, _o.y + down, _o.z);
          continue;
        }
        _o.y += down;
        return _o.clone();
      }
    }
    if (wet) return wet;
    return new THREE.Vector3(v.pos.x, v.pos.y + (v.kind === "boat" ? BOAT_H : CART_H) + 0.05, v.pos.z);
  }

  // Everyone out (an activator rail, a sunk boat): the players this peer
  // has, the creatures if it runs them.
  ejectAll(v) {
    let changed = false;
    for (const e of [...v.riders]) {
      if (e.p === this.me && this.mounted?.v === v) this.dismount();
      else if (e.m && this.mobAuthority()) {
        this._releaseMob(e);
        v.riders.splice(v.riders.indexOf(e), 1);
        changed = true;
      }
    }
    if (changed) this.remote?.ridersChanged(v);
  }

  mobAuthority() {
    return !this.game.mobs?.puppets;
  }

  // player.mount.ride (js/player.js, every frame while seated): the vehicle
  // runs (when it is this player's to run), the player sits in it.
  _ride(p, dt) {
    const m = this.mounted;
    if (!m) {
      if (p.mount === this.handle) p.mount = null;
      return;
    }
    const v = m.v;
    if (this.vehicles.get(v.id) !== v || v.dim !== this.here || p.dead) {
      this.dismount(true);
      return;
    }
    // (moved by something else since the last frame: a teleport, a respawn)
    if (m.rode && p.position.distanceToSquared(m.placed) > 4) {
      this.dismount(true);
      return;
    }
    if (p.keys.has("ShiftLeft") || p.keys.has("ShiftRight")) {
      this.dismount();
      return;
    }
    if (this.simulates(v)) this._step(v, dt);
    else this._follow(v, dt);
    if (this.mounted?.v !== v) return; // (thrown out meanwhile)
    this._pose(v);
    if (v.kind === "boat") {
      // The view turns with the boat, at most 105 degrees off its bow.
      p.yaw += wrap(v.renderYaw - m.lastYaw);
      const off = wrap(p.yaw - v.renderYaw);
      const lim = 105 * DEG;
      if (off > lim) p.yaw -= off - lim;
      else if (off < -lim) p.yaw -= off + lim;
    }
    m.lastYaw = v.renderYaw;
    this._placeRider(v, p);
    p.velocity.set(v.vel.x * 20, 0, v.vel.z * 20);
    m.rode++;
  }

  _placeRider(v, p) {
    const i = Math.max(0, v.riders.findIndex((e) => e.p === this.me));
    this.seatPos(v, i, false, p.position);
    this.mounted?.placed.copy(p.position);
  }

  // The seat `i`'s place (a player's feet, or a creature's): the boat's two
  // (0.2 forward and 0.6 back when two sit in it, an animal 0.2 further
  // forward), the cart's one.
  seatPos(v, i, mob, out) {
    const P = v.renderPos;
    if (v.kind === "cart") return out.set(P.x, P.y + (mob ? CART_FLOOR : SIT_CART), P.z);
    let f = 0;
    if (v.riders.length > 1) f = (i === 0 ? 0.2 : -0.6) + (mob ? 0.2 : 0);
    return out.set(P.x + fwdX(v.renderYaw) * f, P.y + (mob ? BOAT_FLOOR - 0.02 : SIT_BOAT), P.z + fwdZ(v.renderYaw) * f);
  }

  // The driver's keys, for a boat this player steers.
  boatInput(v) {
    const d = v.riders[0];
    if (!d || d.p !== this.me || this.mounted?.v !== v) return null;
    const k = this.player.keys;
    const g = this.game;
    if (g.gameState && g.gameState !== "playing") return { left: false, right: false, up: false, down: false };
    return { left: k.has("KeyA"), right: k.has("KeyD"), up: k.has("KeyW"), down: k.has("KeyS") };
  }

  // A cart's rider walking forward (vanilla: the rider's motion x 0.1 nudges a cart nearly at rest).
  _riderPush(v) {
    const d = v.riders[0];
    if (!d || d.p !== this.me || this.mounted?.v !== v || !this.player.keys.has("KeyW")) return null;
    if (this.game.gameState && this.game.gameState !== "playing") return null;
    const y = this.player.yaw;
    return [fwdX(y) * 0.1, fwdZ(y) * 0.1];
  }

  // ---------- Every frame ----------

  update(dt) {
    const here = this.here;
    const p = this.player;
    const m = this.mounted;
    if (m && (p.dead || p.sleeping || p.vehicle || this.vehicles.get(m.v.id) !== m.v || m.v.dim !== here)) this.dismount(true);
    if (this._claim && performance.now() - this._claim.t > 3000) this._claim = null;
    if (this._pendingMount && !this.mounted) {
      const v = this.vehicles.get(this._pendingMount);
      if (!v) this._pendingMount = null;
      else if (v.dim === here && this.world.getChunk(Math.floor(v.pos.x) >> 4, Math.floor(v.pos.z) >> 4)) {
        this._pendingMount = null;
        if (!p.dead && p.position.distanceTo(v.pos) < 3 && v.riders.length < this.seats(v)) {
          v.riders.push({ p: this.me });
          this._seat(v);
        }
      }
    }
    this._checkT -= dt;
    const check = this._checkT <= 0;
    if (check) this._checkT = 0.25;
    const carts = [];
    for (const v of [...this.vehicles.values()]) {
      if (v.dim !== here) {
        if (v.model) this._hide(v);
        continue;
      }
      const loaded = !!this.world.getChunk(Math.floor(v.pos.x) >> 4, Math.floor(v.pos.z) >> 4);
      if (this.simulates(v)) {
        if (v.stepped !== this.frame && loaded) this._step(v, dt);
      } else {
        this._follow(v, dt);
        // (the hurt wobble and the damage heal here too)
        v.damage = Math.max(0, v.damage - dt * 20);
        v.hurtTime = Math.max(0, v.hurtTime - dt * 20);
        // (the host: a vehicle someone else runs burns up in lava all the same)
        if (check && this.authority && loaded && isLava(this.world.getBlock(Math.floor(v.pos.x), Math.floor(v.pos.y + 0.2), Math.floor(v.pos.z)))) this.destroy(v, { drop: false });
      }
      if (!this.vehicles.has(v.id)) continue;
      if (v.kind === "cart") carts.push(v);
      if (this.mounted?.v !== v) this._pose(v);
      if (v.mobs) this._pinMobs(v, check);
      this._draw(v, loaded);
    }
    this.rails.update(dt, carts);
    // A chest open on the screen: closed when it goes, or too far.
    const view = this.view;
    if (view && (!this.vehicles.has(view.v.id) || view.v.dim !== here || view.v.pos.distanceTo(p.position) > 8)) {
      if (this.invScreen?.isOpen && this.invScreen.chests?.__transport) this.closeInventory?.();
      else this.view = null;
    }
    if (this._pending && !this.mp?.active && performance.now() - this._pending.t > 4000) {
      const q = this._pending;
      this._pending = null;
      q.done(false);
    }
    this.frame++;
  }

  // The vehicle's ticks for the time that passed (at most 5 a frame).
  _step(v, dt) {
    v.stepped = this.frame;
    // Resting, with nobody near: a tick a second (its ground or water may change: _wake).
    if (v.rest > 40 && !this._near(v)) {
      v.acc = 0;
      if ((this.frame + v.id) % 30 !== 0) return;
      v.acc = TICK;
    }
    v.acc = Math.min(v.acc + dt, TICK * 5);
    while (v.acc >= TICK) {
      v.acc -= TICK;
      v.prev.copy(v.pos);
      v.prevYaw = v.yaw;
      this._tick(v);
      if (!this.vehicles.has(v.id)) return;
    }
  }

  _tick(v) {
    this.stats.ticks++;
    if (v.kind === "boat") boatTick(v, this);
    else cartTick(v, this.env);
    this._collide(v);
    const moving = v.vel.lengthSq() > 1e-6 || v.riders.length || v.status === STATUS.AIR || (v.kind === "cart" && !v.onRail && !v.onGround);
    v.rest = moving ? 0 : v.rest + 1;
    if (v.inLava && !v.dying) {
      if (this.mounted?.v === v) this.dismount();
      this.destroy(v, { drop: false });
      return;
    }
    if (v.fallBreak && !v.dying) {
      const fall = v.fallBreak;
      v.fallBreak = 0;
      if (this.mounted?.v === v) {
        this.dismount(true);
        this.player.damage(Math.ceil(fall - 3), "fall");
      }
      this.destroy(v, { drop: false, planks: true, fall });
    }
  }

  // Is any player or vehicle close (a resting one wakes)?
  _near(v) {
    const R = 3;
    const p = this.player.position;
    if (Math.abs(p.x - v.pos.x) < R && Math.abs(p.z - v.pos.z) < R && Math.abs(p.y - v.pos.y) < R) return true;
    if (this.mp?.active) for (const r of this.mp.players.active()) if (Math.abs(r.livePos.x - v.pos.x) < R && Math.abs(r.livePos.z - v.pos.z) < R && Math.abs(r.livePos.y - v.pos.y) < R) return true;
    for (const o of this.vehicles.values()) if (o !== v && o.rest < 40 && o.dim === v.dim && Math.abs(o.pos.x - v.pos.x) < R && Math.abs(o.pos.z - v.pos.z) < R) return true;
    return false;
  }

  _wake(changed) {
    if (!this.vehicles.size) return;
    for (const v of this.vehicles.values()) {
      if (v.rest <= 40) continue;
      for (let i = 0; i < changed.length; i += 3) {
        if (Math.abs(changed[i] + 0.5 - v.pos.x) < 2.5 && Math.abs(changed[i + 2] + 0.5 - v.pos.z) < 2.5 && Math.abs(changed[i + 1] - v.pos.y) < 3) {
          v.rest = 0;
          break;
        }
      }
    }
  }

  // Pushes: the players and creatures beside an empty vehicle, carts on
  // carts, boats on boats; a creature it touches gets in (a boat nobody
  // steers, a rolling empty cart).
  _collide(v) {
    const R = v.kind === "boat" ? BOAT_R : CART_R;
    const H = v.kind === "boat" ? BOAT_H : CART_H;
    const pushable = !v.riders.length;
    const P = v.pos;
    const near = (x, y, z, r, h, grow = 0.2) => Math.abs(x - P.x) < R + r + grow && Math.abs(z - P.z) < R + r + grow && y < P.y + H && y + h > P.y;
    // (Entity.push: 0.05 a tick apart, more the closer)
    const push = (ox, oz) => {
      let dx = ox - P.x;
      let dz = oz - P.z;
      let d = Math.max(Math.abs(dx), Math.abs(dz));
      if (d < 0.01) return null;
      d = Math.sqrt(d);
      dx /= d;
      dz /= d;
      const k = Math.min(1, 1 / d) * 0.05;
      return [dx * k, dz * k];
    };
    const me = this.player;
    // Players.
    if (pushable || this.mounted?.v !== v) {
      const bodies = [];
      if (this.mounted?.v !== v && !me.dead && !me.mount && !me.vehicle) bodies.push([me.position, true]);
      if (this.mp?.active) for (const r of this.mp.players.active()) if (!r.dead && !v.riders.some((e) => e.p === r.pid)) bodies.push([r.livePos, false]);
      for (const [b, local] of bodies) {
        if (!near(b.x, b.y, b.z, 0.3, 1.8)) continue;
        const k = push(b.x, b.z);
        if (!k) continue;
        if (pushable) {
          v.vel.x -= k[0];
          v.vel.z -= k[1];
        }
        // (the player is pushed back a little: no standing inside it)
        if (local) {
          me.knockback.x += k[0] * 20 * (v.kind === "cart" ? 0.25 : 1);
          me.knockback.z += k[1] * 20 * (v.kind === "cart" ? 0.25 : 1);
        }
      }
    }
    // Creatures: pushing, or getting in.
    const mobs = this.game.mobs;
    if (mobs && this.mobAuthority()) {
      const pick = this._canPick(v);
      for (const m of mobs.mobs) {
        if (m.dead || m.rideVehicle || m.spec.projectile || m.spec.still) continue;
        const r = m.spec.r;
        if (!near(m.pos.x, m.pos.y, m.pos.z, r, m.spec.h)) continue;
        if (pick && this._fits(v, m)) {
          this._takeMob(v, m);
          continue;
        }
        if (!pushable) continue;
        const k = push(m.pos.x, m.pos.z);
        if (!k) continue;
        v.vel.x -= k[0];
        v.vel.z -= k[1];
      }
    }
    // Vehicles of the same kind.
    for (const o of this.vehicles.values()) {
      if (o === v || o.kind !== v.kind || o.dim !== v.dim) continue;
      if (Math.abs(o.pos.x - P.x) > 2 * R + 0.2 || Math.abs(o.pos.z - P.z) > 2 * R + 0.2 || Math.abs(o.pos.y - P.y) > H) continue;
      const both = this.simulates(o);
      if (both && o.id < v.id) continue; // (that pair is done from the other)
      if (v.kind === "cart") this._cartBump(v, o, both);
      else {
        const k = push(o.pos.x, o.pos.z);
        if (!k) continue;
        if (!v.riders.length) {
          v.vel.x -= k[0];
          v.vel.z -= k[1];
        }
        if (both && !o.riders.length) {
          o.vel.x += k[0];
          o.vel.z += k[1];
        }
      }
    }
  }

  // Two carts on one line (vanilla's minecart.push): their speeds shared.
  _cartBump(v, o, both) {
    let dx = o.pos.x - v.pos.x;
    let dz = o.pos.z - v.pos.z;
    let d = dx * dx + dz * dz;
    if (d < 1e-4) return;
    d = Math.sqrt(d);
    dx /= d;
    dz /= d;
    const along = Math.abs(dx * fwdX(v.yaw) + dz * fwdZ(v.yaw));
    if (along < 0.8) return;
    const k = Math.min(1, 1 / d) * 0.05;
    const ax = (o.vel.x + v.vel.x) / 2;
    const az = (o.vel.z + v.vel.z) / 2;
    v.vel.x = v.vel.x * 0.2 + ax - dx * k;
    v.vel.z = v.vel.z * 0.2 + az - dz * k;
    if (both) {
      o.vel.x = o.vel.x * 0.2 + ax + dx * k;
      o.vel.z = o.vel.z * 0.2 + az + dz * k;
    }
  }

  // Whether a creature that touches it gets in: a boat no player steers with
  // a seat free, an empty minecart rolling (vanilla's).
  _canPick(v) {
    if (v.kind === "boat") return !this.playerDriven(v) && v.riders.length < this.seats(v);
    return !v.chest && !v.riders.length && v.vel.x * v.vel.x + v.vel.z * v.vel.z > 0.01;
  }
  _fits(v, m) {
    const s = m.spec;
    if (s.flies || s.floats || s.still || s.projectile || m.kind === "iron_golem" || m.kind === "ender_dragon") return false;
    return v.kind === "boat" ? s.r * 2 < BOAT_R * 2 && !s.swims : s.r * 2 < 1.4;
  }

  _takeMob(v, m) {
    const e = { m: m.id, ref: m };
    v.riders.push(e);
    v.mobs = true;
    m.rideVehicle = v.id;
    this.remote?.ridersChanged(v);
  }

  _releaseMob(e) {
    const m = e.ref || this._puppet(e.m);
    if (m) {
      m.rideVehicle = 0;
      m.peakY = null;
    }
  }

  _puppet(id) {
    if (this.mobAuthority()) {
      for (const m of this.game.mobs?.mobs || []) if (m.id === id) return m;
      return null;
    }
    return this.mp?.entities?.mobById?.get(id) || null;
  }

  // The creatures riding it: on their seats (the host's own creatures, a guest's copies).
  _pinMobs(v, check) {
    let any = false;
    let changed = false;
    for (let i = 0; i < v.riders.length; i++) {
      const e = v.riders[i];
      if (!e.m) continue;
      any = true;
      let m = e.ref;
      if (!m || (check && !this.mobAuthority())) m = e.ref = this._puppet(e.m);
      if (!m || m.dead || (check && this.mobAuthority() && !this.game.mobs.mobs.includes(m))) {
        if (this.mobAuthority()) {
          v.riders.splice(i--, 1);
          changed = true;
        }
        continue;
      }
      m.rideVehicle = v.id;
      this.seatPos(v, i, true, m.pos);
      m.vel.set(0, 0, 0);
      m.knock?.set(0, 0, 0);
      m.peakY = null;
      m.onGround = true;
      // (facing the bow; an animal in a full boat sits across it, as vanilla's)
      m.yaw = v.renderYaw + Math.PI + (v.kind === "boat" && v.riders.length > 1 && !m.spec.hostile ? (m.id % 2 ? Math.PI / 2 : -Math.PI / 2) : 0);
      this.game.mobs._place?.(m);
    }
    if (!any) v.mobs = false;
    if (changed) this.remote?.ridersChanged(v);
  }

  // ---------- Online: another peer runs it ----------

  _follow(v, dt) {
    v.stepped = this.frame;
    v.acc = 0;
    const st = v.interp && this.mp?.active ? v.interp.sample(this.mp.net.time) : null;
    if (st) {
      v.pos.fromArray(st.p);
      v.yaw = st.y;
      v.pitch = st.pi || 0;
      v.rowing = st.f | 0;
      if (st.v) v.vel.set(st.v[0] / 20, st.v[1] / 20, st.v[2] / 20);
    }
    v.prev.copy(v.pos);
    v.prevYaw = v.yaw;
    for (let i = 0; i < 2; i++) v.paddle[i] = v.rowing & (1 << i) ? v.paddle[i] + (Math.PI / 8) * dt * 20 : 0;
  }

  // ---------- Hitting, breaking ----------

  // The player hits it (interaction's attack on a vehicle: no tool wear).
  attack(v, tool) {
    const mobs = this.game.mobs;
    const charge = mobs ? mobs.charge(tool) : 1;
    mobs?.swing();
    const base = isVanilla() && tool?.vDamage != null ? tool.vDamage : meleeDamage(tool);
    const amount = Math.max(0.5, base) * (0.2 + 0.8 * charge * charge);
    const creative = !!this.player.creative;
    this.game.audio?.playDig?.(v.kind === "boat" ? "wood" : "stone");
    if (this.authority) this.hit(v, amount, creative);
    else {
      this.wobble(v);
      this.remote?.hit(v, amount, creative);
    }
    return false;
  }

  wobble(v, dir = -v.hurtDir) {
    v.hurtDir = dir;
    v.hurtTime = 10;
    v.damage = Math.max(v.damage, 10);
  }

  // The keeper: a blow of `amount` (Creative: it breaks at once, nothing dropped).
  hit(v, amount, creative = false) {
    if (!this.vehicles.has(v.id)) return;
    v.hurtDir = -v.hurtDir;
    v.hurtTime = 10;
    v.damage += amount * 10;
    v.rest = 0;
    this.remote?.hurt(v);
    if (creative || v.damage > 40) this.destroy(v, { drop: !creative });
  }

  // Gone: its item (or a fallen boat's planks and sticks) and its chest's
  // contents dropped (the keeper's; a guest asks the host).
  destroy(v, { drop = true, planks = false, fall = 0 } = {}) {
    if (!this.vehicles.has(v.id)) return;
    if (!this.authority) {
      // (asked once: the host's answer removes it)
      if (!v.dying) this.remote?.destroyed(v, { drop, planks, fall });
      v.dying = true;
      return;
    }
    const at = v.pos.clone();
    at.y += 0.3;
    const ents = this.game.entities;
    const spawn = (id, n) => {
      if (!ents || !itemInfo(id)) return;
      const vel = new THREE.Vector3((Math.random() - 0.5) * 2, 2 + Math.random() * 2, (Math.random() - 0.5) * 2);
      ents.spawn(id, n, at.clone(), vel, { pickupDelay: PICKUP_DELAY });
    };
    if (planks) {
      spawn(WOODS[v.wood].planks, 3);
      spawn(256, 2); // (sticks)
      if (v.chest) spawn(BLOCK.CHEST, 1);
    } else if (drop) spawn(v.kind === "boat" ? boatItem(v.wood, v.chest) : cartItem(v.chest), 1);
    // (a chest's contents spill, whatever broke it, but in lava)
    if (v.slots && !v.inLava) {
      for (const s of v.slots) {
        if (!s || !ents) continue;
        const vel = new THREE.Vector3((Math.random() - 0.5) * 3, 2 + Math.random() * 2, (Math.random() - 0.5) * 3);
        ents.spawn(s.id, s.count, at.clone(), vel, { dur: s.dur, tag: s.tag, pickupDelay: PICKUP_DELAY });
      }
    }
    this.stats.broken++;
    this.game.audio?.playBreak?.(v.kind === "boat" ? "wood" : "stone");
    this._remove(v);
    this.remote?.gone(v, fall);
  }

  // Another peer said it is gone (fall: a fallen boat, its riders take the fall).
  removedRemote(id, fall = 0) {
    const v = this.vehicles.get(id);
    if (!v) return;
    const riding = this.mounted?.v === v;
    this._remove(v);
    if (riding && fall > 3) this.player.damage(Math.ceil(fall - 3), "fall");
  }

  // ---------- Aiming at them (interaction's combat) ----------

  // The nearest vehicle under the crosshair within `reach`: { mob, distance }.
  raycast(origin, dir, reach) {
    let best = null;
    const here = this.here;
    const lo = _v;
    const hi = _o;
    for (const v of this.vehicles.values()) {
      if (v.dim !== here || this.mounted?.v === v || !v.model?.visible) continue;
      const R = v.kind === "boat" ? BOAT_R : CART_R;
      const H = v.kind === "boat" ? BOAT_H : CART_H;
      const P = v.renderPos;
      if (Math.abs(P.x - origin.x) > reach + 2 || Math.abs(P.z - origin.z) > reach + 2) continue;
      lo.set(P.x - R, P.y, P.z - R);
      hi.set(P.x + R, P.y + H, P.z + R);
      const t = rayAabb(origin, dir, lo, hi, reach);
      if (t !== null && (!best || t < best.distance)) best = { mob: v, distance: t };
    }
    return best;
  }

  overlapsBlock(x, y, z) {
    const here = this.here;
    for (const v of this.vehicles.values()) {
      if (v.dim !== here) continue;
      const R = v.kind === "boat" ? BOAT_R : CART_R;
      const H = v.kind === "boat" ? BOAT_H : CART_H;
      if (x + 1 > v.pos.x - R && x < v.pos.x + R && z + 1 > v.pos.z - R && z < v.pos.z + R && y + 1 > v.pos.y && y < v.pos.y + H) return true;
    }
    return false;
  }

  // The mob system with the vehicles in it, for interaction.combat.
  combat(mobs) {
    return {
      raycast: (o, d, reach, filter) => {
        const a = mobs.raycast(o, d, reach, filter);
        const b = this.raycast(o, d, reach);
        return !b ? a : !a || b.distance < a.distance ? b : a;
      },
      attack: (target, tool, extra) => (target?.isTransport ? this.attack(target, tool) : mobs.attack(target, tool, extra)),
      charge: (tool) => mobs.charge(tool),
      swing: () => mobs.swing(),
      overlapsBlock: (x, y, z) => mobs.overlapsBlock(x, y, z) || this.overlapsBlock(x, y, z),
    };
  }

  // ---------- Chests (a chest boat's, a chest minecart's) ----------

  // Its chest on the chest screen (js/inventory-ui.js): the screen's chests
  // stand-in for the time it is open, the vehicle's contents behind it.
  openChest(v) {
    const scr = this.invScreen;
    const real = this.chests;
    if (!scr || !real || !this.openInventory || !v.chest) return false;
    const proxy = Object.create(real);
    proxy.__transport = true;
    proxy.openView = (x, y, z, onUpdate) => this._openView(v, onUpdate);
    proxy.closeView = () => this._closeView(proxy);
    proxy.submit = (changes, done) => this._submit(v, changes, done);
    scr.chests = proxy;
    scr.chestPos = [Math.floor(v.pos.x), Math.floor(v.pos.y), Math.floor(v.pos.z)];
    this.openInventory("chest");
    if (!scr.isOpen || scr.kind !== "chest") {
      if (scr.chests === proxy) scr.chests = real;
      this.view = null;
      return false;
    }
    return true;
  }

  _openView(v, onUpdate) {
    const view = { key: `tv:${v.id}`, x: Math.floor(v.pos.x), y: Math.floor(v.pos.y), z: Math.floor(v.pos.z), slots: null, ready: false, gone: false, onUpdate, v };
    this.view = view;
    if (this.authority) {
      v.slots ||= new Array(CHEST_SLOTS).fill(null);
      view.slots = v.slots;
      view.ready = true;
    } else this.remote?.openChest(v);
    return view;
  }

  _closeView(proxy) {
    const v = this.view?.v;
    this.view = null;
    if (this.invScreen?.chests === proxy) this.invScreen.chests = this.chests;
    if (v) this.remote?.closeChest(v);
  }

  _submit(v, changes, done) {
    const view = this.view;
    if (!view || view.v !== v || !view.ready || view.gone || this._pending) return done(false);
    if (this.authority) return done(this.applyChest(v.id, changes, 0));
    const q = ++this._q;
    this._pending = { q, done, t: performance.now() };
    this.remote?.chestOp(v, q, changes);
  }

  // A guest's click answered by the host.
  chestAnswer(q, ok) {
    const p = this._pending;
    if (!p || p.q !== q) return;
    this._pending = null;
    p.done(!!ok);
  }

  // The keeper: changes [[slot, before, after], ...] to the vehicle's chest,
  // if every slot still holds what they expect.
  applyChest(id, changes, fromPid = 0) {
    const v = this.vehicles.get(id);
    if (!v?.chest || !Array.isArray(changes) || changes.length < 1 || changes.length > CHEST_SLOTS) return false;
    const slots = (v.slots ||= new Array(CHEST_SLOTS).fill(null));
    const seen = new Set();
    const next = [];
    for (const ch of changes) {
      if (!Array.isArray(ch)) return false;
      const [i, before, after] = ch;
      if (!Number.isInteger(i) || i < 0 || i >= CHEST_SLOTS || seen.has(i)) return false;
      seen.add(i);
      if (!sameStack(slots[i], before || null)) return false;
      const a = after ? decodeStack(encodeStack(after)) : null;
      if (after && !a) return false;
      next.push([i, a]);
    }
    for (const [i, a] of next) slots[i] = a;
    this.remote?.chestChanged(v, next);
    if (fromPid && this.view?.v === v) this.view.onUpdate?.();
    return true;
  }

  // A guest: the host's word on the open chest (its contents, or a change).
  chestState(id, slots) {
    const view = this.view;
    if (!view || view.v.id !== id) return;
    if (!slots) view.gone = true;
    else {
      view.slots = slots;
      view.ready = true;
    }
    view.onUpdate?.();
  }
  chestSet(id, list) {
    const view = this.view;
    if (!view || view.v.id !== id || !view.ready) return;
    for (const [i, s] of list) if (Number.isInteger(i) && i >= 0 && i < CHEST_SLOTS) view.slots[i] = s;
    view.onUpdate?.();
  }

  // ---------- Drawing ----------

  // Where it is drawn this frame (between its last two ticks; alpha 1: the newest).
  _pose(v, alpha = null) {
    const k = alpha ?? Math.min(1, v.acc / TICK);
    v.renderPos.lerpVectors(v.prev, v.pos, k);
    v.renderYaw = v.prevYaw + wrap(v.yaw - v.prevYaw) * k;
  }

  _geometry(key, make) {
    let g = this._geo.get(key);
    if (!g) this._geo.set(key, (g = make()));
    return g;
  }

  _build(v) {
    const root = new THREE.Group();
    root.rotation.order = "YXZ";
    const mat = this.material;
    if (v.kind === "boat") {
      const layer = BLOCK_INFO[WOODS[v.wood].planks]?.faceTiles?.[2] ?? 0;
      root.add(new THREE.Mesh(this._geometry(`boat${v.wood}`, () => boatGeometry(layer)), mat));
      const oars = [];
      for (const side of [1, -1]) {
        const pivot = new THREE.Group();
        pivot.rotation.order = "YXZ";
        pivot.position.set(side * (BOAT_R + 0.02), 0.62, -0.05);
        const oar = new THREE.Mesh(this._geometry(`oar${v.wood}`, () => oarGeometry(layer)), mat);
        pivot.add(oar);
        root.add(pivot);
        oars.push({ pivot, side });
      }
      root.userData.oars = oars;
      if (v.chest) {
        const c = new THREE.Mesh(this._geometry("chest", () => blockCubeGeometry(BLOCK.CHEST)), mat);
        c.scale.setScalar(0.85);
        c.position.set(0, BOAT_FLOOR + 0.37, 0.38);
        c.rotation.y = Math.PI;
        root.add(c);
      }
    } else {
      root.add(new THREE.Mesh(this._geometry("cart", () => cartGeometry(TILE.minecart ?? 0)), mat));
      if (v.chest) {
        const c = new THREE.Mesh(this._geometry("chest", () => blockCubeGeometry(BLOCK.CHEST)), mat);
        c.scale.setScalar(0.75);
        c.position.set(0, CART_FLOOR + 0.375, 0);
        root.add(c);
      }
    }
    root.traverse((o) => {
      if (o.isMesh) {
        o.castShadow = true;
        o.receiveShadow = true;
      }
    });
    bindEntityLight(root, () => v.light);
    this.group.add(root);
    v.model = root;
  }

  _hide(v) {
    if (!v.model) return;
    this.group.remove(v.model);
    v.model = null;
  }

  _draw(v, loaded) {
    if (!this.material) return;
    const cam = this.player.position;
    const far = Math.abs(v.pos.x - cam.x) > VIEW || Math.abs(v.pos.z - cam.z) > VIEW;
    if (!loaded || far) {
      if (v.model) this._hide(v);
      return;
    }
    if (!v.model) this._build(v);
    const root = v.model;
    root.position.copy(v.renderPos);
    // (A hit rocks it about its length, as vanilla's.)
    const h = v.hurtTime;
    const roll = h > 0 ? ((Math.sin(h) * h * Math.min(v.damage, 40)) / 10) * v.hurtDir * DEG : 0;
    root.rotation.set(v.pitch, v.renderYaw, roll);
    const oars = root.userData.oars;
    if (oars) {
      for (const { pivot, side } of oars) {
        // (rowing: vanilla's animatePaddle, the blade swept forward out of the
        // water and pulled back through it; resting: along the side, dipped)
        const t = v.paddle[side > 0 ? 1 : 0];
        if (t) {
          const s = (Math.sin(-t) + 1) / 2;
          const c = (Math.sin(-t + 1) + 1) / 2;
          pivot.rotation.set(0.15 + 0.55 * s, side * (0.3 + 1.0 * c), 0);
        } else pivot.rotation.set(0.35, side * 0.3, 0);
      }
    }
    const l = this.world.lightAt(v.renderPos.x, v.renderPos.y + 0.5, v.renderPos.z);
    v.light.sky = l.sky;
    v.light.block = l.block;
  }

  // The local player's own body, seated (main.js: after the avatar's update).
  poseAvatar(avatar) {
    if (this.mounted) sitPose(avatar);
  }

  // ---------- Saves ----------

  // Every vehicle (every dimension's) with its chest, and the one this player
  // sits in (undefined on a guest, and when there are none).
  serialize() {
    if (!this.authority || !this.vehicles.size) return undefined;
    const out = { v: [...this.vehicles.values()].map((v) => this.record(v, true)) };
    if (this.mounted) out.ride = this.mounted.v.id;
    return out;
  }

  load(data) {
    this.clear();
    if (!data || typeof data !== "object" || !Array.isArray(data.v)) return;
    for (const r of data.v.slice(0, MAX_VEHICLES)) this.make(r);
    this._pendingMount = Number.isInteger(data.ride) ? data.ride : null;
  }
}

const r3 = (v) => Math.round(v * 1000) / 1000;
