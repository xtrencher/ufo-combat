// The shared vehicle framework, used by the player's UFO (vehicle-ufo.js)
// and the fighter jet (vehicle-jet.js):
//   - enter (F near a vehicle) and exit (F) with a safe exit spot: beside
//     the vehicle on the ground, in the water, out of a tunnel (or up to the
//     surface when it's buried), or, from high up, below it on a parachute
//     (a jet ejects its pilot upward first);
//   - input routing: while seated, the mouse, keys and buttons drive the
//     vehicle instead of the player;
//   - camera modes (F5 cycles them), a HUD panel and an "F to board" hint;
//   - damage: hits on a seated player hurt the vehicle; a destroyed vehicle
//     kills its pilot (unless they got out in time);
//   - saving: every vehicle in the world and the one the player is in;
//   - pausing (vehicles simply don't update), and mods switched off while
//     flying (the player is set down safely and the vehicles are put away);
//   - (Round 13) Creative's summons: the vehicle items of the Creative
//     palette (js/content/vehicles.js) put a vehicle on the ground aimed at,
//     or, aimed at the sky, the player straight into it in the air. In a
//     Survival world (no Mods there) the vehicles are on all the same, but
//     only a player in Creative summons or boards one (F swaps the hands
//     otherwise); vehicles are the Overworld's (hidden and still elsewhere).
// Vehicle types register themselves with VehicleManager.register(), and
// what Creative can summon with VehicleManager.registerSummon().
import * as THREE from "three";
import { IS_SOLID, IS_WET } from "./blocks.js";
import { WORLD_HEIGHT } from "./constants.js";
import { sweptSphere } from "./lasers.js";
import { hullRay, hullDistance, hullContact, discShape, CONTACT } from "./hitboxes.js";
import { LIB } from "./content/base.js";
import { isMissionsWorld } from "./worldtype.js";
import { UFO_DESIGNS } from "./ufo-models.js";

const ENTER_REACH = 4.5; // blocks from a vehicle's hull
const MAX_VEHICLES = 12; // parked / wrecked vehicles kept in a world
// Aircraft that touch (Round 10): below BUMP_SPEED (blocks/s, closing along
// the contact) they just stop and part with a knock; above it the damage
// grows, and at CRASH_SPEED two equal aircraft are both destroyed. The
// lighter one takes more (MASS: a B-2 shrugs off a fighter that a fighter
// would not).
const BUMP_SPEED = 4;
const CRASH_SPEED = 28;
const PAIR_COOLDOWN = 1; // seconds before the same two can hurt each other again
// (Round 13) Creative's summons: how far the aim reaches for the ground, the
// most summoned vehicles kept (the oldest empty one goes), the debounce of a
// held right button (an item's use repeats while it is held).
const SUMMON_REACH = 96;
const MAX_SUMMONED = 8;
const SUMMON_REPEAT = 0.8; // seconds (the item's use repeats every 0.22 s while held, or every frame at a low frame rate)
const SUMMON_UFO_RADIUS = 7; // a medium ship (sneaking: a small one)
const SUMMON_UFO_SMALL = 4.5;
const _dir = new THREE.Vector3();
// (Collision scratch: a pose for a ship (no quaternion of its own) and the contact normal.)
const _n = new THREE.Vector3();
const _pose = { pos: null, q: null, vel: null };
const _pose2 = { pos: null, q: null, vel: null };
const _lead = new THREE.Vector3();
const _lead2 = new THREE.Vector3();

// ---------- Base class ----------

export class Vehicle {
  constructor(manager, { type, name, radius = 3, maxHealth = 100 }) {
    this.manager = manager;
    this.type = type;
    this.name = name;
    this.radius = radius; // for hit tests and entering
    this.pos = new THREE.Vector3();
    this.vel = new THREE.Vector3();
    this.root = new THREE.Group();
    this.maxHealth = maxHealth;
    this.health = maxHealth;
    this.alive = true;
    this.occupied = false;
    this.cameraMode = 0;
    this.cameraModes = ["chase"];
    this.camYaw = 0;
    this.camPitch = -0.15;
    this.hurtTime = 99;
    this.lastHitBy = null; // cause of the last damage (death messages)
    this.hull = null; // the hit shape (hitboxes.js; aircraft), else a sphere of hitRadius
    this.mass = 1; // for collisions
    this.id = manager.nextId++;
  }

  // Where the pilot sits (the player's position follows it).
  seatPosition(out = new THREE.Vector3()) {
    return out.copy(this.pos);
  }

  // Height of the underside below this.pos (blocks).
  get bottom() {
    return this.radius * 0.3;
  }

  // Is the vehicle well up in the air (for exits)?
  get airborne() {
    const ground = this.manager.groundBelow(this.pos.x, this.pos.y - this.bottom, this.pos.z);
    return this.pos.y - this.bottom - ground > 5;
  }

  update(dt, input) {
    this.hurtTime += dt;
  }

  updateCamera(camera, dt) {
    camera.position.copy(this.pos);
  }

  cycleCamera() {
    this.cameraMode = (this.cameraMode + 1) % this.cameraModes.length;
    return this.cameraModes[this.cameraMode];
  }

  // HUD: { title, rows: [[label, value]], weapon, warning, health (0-1) }.
  hud() {
    return { title: this.name, rows: [], health: this.health / this.maxHealth };
  }

  // Damage from anything. Returns true if it was applied.
  damage(amount, cause = "vehicle", byPlayer = false) {
    if (!this.alive || amount <= 0) return false;
    this.health = Math.max(0, this.health - amount);
    this.hurtTime = 0;
    this.lastHitBy = cause;
    if (this.occupied && this.manager.onPilotHurt) this.manager.onPilotHurt(amount, cause);
    if (this.health <= 0) this.manager.destroy(this, cause);
    return true;
  }

  // Blown up (health gone, or a crash).
  onDestroyed() {}

  onEnter() {}
  onExit() {}

  // Nearest hit of a ray on this vehicle (its hull, or a sphere), or null.
  raycast(origin, dir, maxDist) {
    if (this.hull) {
      const t = hullRay(this.hull, this.pos, this.q, origin, dir, maxDist);
      return t < 0 ? null : t;
    }
    const r = this.hitRadius ?? this.radius;
    const ox = origin.x - this.pos.x;
    const oy = origin.y - this.pos.y;
    const oz = origin.z - this.pos.z;
    const b = ox * dir.x + oy * dir.y + oz * dir.z;
    const c = ox * ox + oy * oy + oz * oz - r * r;
    const disc = b * b - c;
    if (disc < 0) return null;
    const t = -b - Math.sqrt(disc);
    const tt = t >= 0 ? t : c < 0 ? 0 : null;
    if (tt === null || tt > maxDist) return null;
    return tt;
  }

  // Where along a bolt's step (0..step, or null) it comes within `pad` of the
  // vehicle (the bolt's glow), solved in the vehicle's frame of motion: it
  // moved vel*dt during the same step (a jet moves several blocks a frame).
  sweptRaycast(origin, dir, step, pad = 0, dt = 0) {
    if (this.hull) {
      const t = hullRay(this.hull, this.pos, this.q, origin, dir, step, pad, this.vel, dt);
      return t < 0 ? null : t;
    }
    return sweptSphere(origin, dir, step, this.pos, (this.hitRadius ?? this.radius) + pad, this.vel, dt);
  }

  // Does the segment a-b pass within `pad` of the vehicle? (a sweeping beam)
  segmentHit(a, b, pad = 0) {
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const dz = b.z - a.z;
    const len = Math.hypot(dx, dy, dz);
    if (len < 1e-6) return this.hullDistance(a, pad + 1) <= pad;
    _dir.set(dx / len, dy / len, dz / len);
    if (this.hull) return hullRay(this.hull, this.pos, this.q, a, _dir, len, pad) >= 0;
    return sweptSphere(a, _dir, len, this.pos, (this.hitRadius ?? this.radius) + pad) !== null;
  }

  // How far a point is from the vehicle's surface (0 inside). `max`: beyond
  // this it only needs to be known that it's at least that far.
  hullDistance(p, max = Infinity) {
    if (this.hull) return hullDistance(this.hull, this.pos, this.q, p, max);
    return Math.max(0, this.pos.distanceTo(p) - (this.hitRadius ?? this.radius));
  }

  // The shape it collides with (an aircraft's hull, a ship's disc), or null.
  get collider() {
    if (this.hull) return this.hull;
    // (A ship: a disc of its size, for collisions only; not a wreck in its crater.)
    if (this.type !== "ufo" || !this.info || this.crashed || this.wreck) return null;
    if (!this._disc) {
      this._disc = discShape(this.hitRadius ?? this.radius, -this.info.bottom * this.radius, (this.info.top ?? this.info.bottom) * this.radius);
      this.mass = Math.min(8, Math.max(0.6, (this.radius / 7) ** 2));
    }
    return this._disc;
  }

  serialize() {
    const data = { type: this.type, pos: this.pos.toArray().map((v) => Math.round(v * 100) / 100), health: this.health };
    // (A Creative call-in stays one after a reload: the next call-in removes it.)
    if (this.calledIn) data.calledIn = true;
    // (Round 13: and a Creative summon one, kept like a boat until taken away.)
    if (this.summoned) data.summoned = true;
    return data;
  }

  dispose() {
    this.manager.scene.remove(this.root);
  }
}

// ---------- Parachute ----------

// A striped canopy that opens above the player after ejecting or jumping
// out high up: a slow, steerable descent with no fall damage, packed away
// on landing (or in water).
export class Parachute {
  constructor(scene) {
    const canopy = new THREE.SphereGeometry(2.6, 16, 6, 0, Math.PI * 2, 0, Math.PI / 2.6).scale(1, 0.55, 1);
    const pos = canopy.getAttribute("position");
    const colors = new Float32Array(pos.count * 3);
    for (let i = 0; i < pos.count; i++) {
      const a = Math.atan2(pos.getZ(i), pos.getX(i));
      const stripe = Math.floor(((a + Math.PI) / (Math.PI * 2)) * 12) % 2 === 0;
      const c = stripe ? [0.95, 0.35, 0.12] : [0.95, 0.93, 0.88];
      colors.set(c, i * 3);
    }
    canopy.setAttribute("color", new THREE.BufferAttribute(colors, 3));
    this.group = new THREE.Group();
    this.canopy = new THREE.Mesh(canopy, new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide }));
    this.canopy.position.y = 4.2;
    this.canopy.castShadow = true;
    const lines = [];
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      lines.push(0, 1.3, 0, Math.cos(a) * 2.3, 4.2 + 0.5, Math.sin(a) * 2.3);
    }
    const lg = new THREE.BufferGeometry();
    lg.setAttribute("position", new THREE.Float32BufferAttribute(lines, 3));
    this.lines = new THREE.LineSegments(lg, new THREE.LineBasicMaterial({ color: 0x333333 }));
    this.group.add(this.canopy, this.lines);
    this.group.visible = false;
    scene.add(this.group);
    this.active = false;
    this.pending = 0; // seconds until it opens
    this.open = 0; // 0-1 opening animation
    this.time = 0;
  }

  // Opens after `delay` seconds (ejecting: a moment of free fall first).
  deploy(player, delay = 0) {
    this.active = true;
    this.pending = delay;
    this.open = 0;
    player.parachute = delay <= 0;
  }

  close(player) {
    this.active = false;
    this.group.visible = false;
    if (player) player.parachute = false;
  }

  update(dt, player, audio) {
    if (!this.active) return;
    this.time += dt;
    if (this.pending > 0) {
      this.pending -= dt;
      if (this.pending <= 0) {
        player.parachute = true;
        if (audio?.playParachute) audio.playParachute();
      }
      return;
    }
    if (player.dead || player.onGround || player.inWater || !player.parachute) {
      this.close(player);
      return;
    }
    this.open = Math.min(1, this.open + dt * 2.5);
    this.group.visible = true;
    this.group.position.copy(player.position);
    const s = 0.3 + 0.7 * this.open;
    this.group.scale.set(s, 0.5 + 0.5 * this.open, s);
    this.group.rotation.set(Math.sin(this.time * 1.3) * 0.08, player.yaw, Math.cos(this.time * 1.1) * 0.08);
  }
}

// ---------- Manager ----------

export class VehicleManager {
  static types = {};

  static register(type, cls) {
    VehicleManager.types[type] = cls;
  }

  // (Round 13) What Creative can summon (a vehicle item's `vehicle` key,
  // js/content/vehicles.js): key -> { type, data(mgr, ctx) (the creation data
  // without pos and yaw), alt (blocks above the ground a summon into the sky
  // starts at; 0: ground only), launch(v) (set it flying: a summon into the
  // sky) }. A new kind (a tank) registers itself next to its class.
  static summons = {};

  static registerSummon(key, def) {
    VehicleManager.summons[key] = def;
  }

  constructor({ scene, world, player, effects, audio, lasers, mobs, inventory, entities }) {
    this.scene = scene;
    this.world = world;
    this.player = player;
    this.effects = effects;
    this.audio = audio;
    this.lasers = lasers;
    this.mobs = mobs;
    this.inventory = inventory;
    this.entities = entities;
    this.vehicles = [];
    this.active = null;
    this.nextId = 1;
    this._on = true; // (the Mods' switch, setEnabled; see `enabled`)
    this.away = false; // (Round 13) the player is in the Nether or the End: the vehicles stay behind
    this._summonT = -99; // (the last summon's time, for the held button)
    this._ufoNext = Math.floor(Math.random() * UFO_DESIGNS.length); // (the UFO item's next design)
    this.restoring = false; // true while load() puts the player back in a saved seat
    this.config = {}; // per-type settings (Vehicles tab), filled in by main.js
    this.parachute = new Parachute(scene);
    this.input = { dx: 0, dy: 0, buttons: [false, false, false], wheel: 0, pressed: new Set(), keys: player.keys };
    // Hooks set by the game.
    this.onEnter = null; // (vehicle) => void
    this.onExit = null; // (vehicle) => void
    this.onPilotKilled = null; // (cause) => void
    this.onPilotHurt = null; // (amount, cause) => void
    this.onMessage = null; // (text) => void: a short HUD notice
    // Multiplayer (js/net/vehicles.js): every vehicle added, removed or destroyed.
    this.onAdded = null; // (vehicle) => void
    this.onRemoved = null; // (vehicle) => void
    this.onDestroyedHook = null; // (vehicle, cause) => void
    this.hudEl = document.getElementById("vehicle-hud");
    this.promptEl = document.getElementById("vehicle-prompt");
    this.infoEl = document.getElementById("vehicle-info");
    this.infoOpen = false;
    this.viewRange = 400; // how far you can see (blocks; set by the game)
    this.night = 0;
    this._hudTimer = 0;
    this._seat = new THREE.Vector3();
    this.contacts = 0; // aircraft that touched (tests)
    // (Round 13) The Creative palette's vehicle items place through this (js/content/vehicles.js).
    LIB.summonVehicle = (ctx, key) => this.summonFromItem(ctx, key);
  }

  // Whether vehicles exist and work here: with the Mods on, or in any world
  // that is not a Missions world (a Survival world has no Mods but has
  // Creative's vehicles), and only in the Overworld.
  get enabled() {
    return (this._on || !isMissionsWorld()) && !this.away;
  }

  set enabled(on) {
    this._on = !!on;
  }

  // (Round 13) A Survival world: only a player in Creative summons or boards
  // a vehicle (a Missions world has its own locks: canBoard).
  get creativeOnly() {
    return !isMissionsWorld() && !this.player.creative;
  }

  // (Round 13) Whether F is the vehicles' just now: seated, or a vehicle in
  // reach that this player may board (else F is the game's: the off hand;
  // a locked one says so on its prompt: canBoard's reason).
  wantsF() {
    if (!this.enabled) return false;
    if (this.active) return true;
    if (this.creativeOnly) return false;
    const v = this.nearestEnterable();
    return !!v && !this.canBoard?.(v);
  }

  // ---------- World helpers ----------

  // y of the top of the highest solid (or water) block at or below y in
  // column (x, z); the height map far away.
  groundBelow(x, y, z) {
    const bx = Math.floor(x);
    const bz = Math.floor(z);
    if (!this.world.getChunk(bx >> 4, bz >> 4)) return this.world.heightAt(bx, bz) + 1;
    for (let by = Math.min(WORLD_HEIGHT - 1, Math.floor(y)); by >= 0; by--) {
      const id = this.world.getBlock(bx, by, bz);
      if (IS_SOLID[id] || IS_WET[id]) return by + 1;
    }
    return 0;
  }

  _free(x, y, z) {
    const w = this.world;
    return !IS_SOLID[w.getBlock(x, y, z)] && !IS_SOLID[w.getBlock(x, y + 1, z)];
  }

  // A safe place to stand near vehicle `v`: a 2-block-high free space with
  // something to stand on (or water), beside the hull, as close as possible
  // to the vehicle's underside. { pos, airborne } or a spot on the surface.
  safeExit(v) {
    const w = this.world;
    const cx = v.pos.x;
    const cz = v.pos.z;
    const baseY = Math.floor(v.pos.y - v.bottom);
    const r0 = Math.ceil(v.radius * 0.5);
    let best = null;
    let bestScore = Infinity;
    const R = Math.ceil(v.radius) + 4;
    for (let dx = -R; dx <= R; dx++) {
      for (let dz = -R; dz <= R; dz++) {
        const d = Math.hypot(dx, dz);
        if (d > R) continue;
        const x = Math.floor(cx + dx);
        const z = Math.floor(cz + dz);
        for (let y = baseY + 2; y >= baseY - 4; y--) {
          if (y < 1 || y >= WORLD_HEIGHT - 2) continue;
          if (!this._free(x, y, z)) continue;
          const below = w.getBlock(x, y - 1, z);
          if (!IS_SOLID[below] && !IS_WET[below] && !IS_WET[w.getBlock(x, y, z)]) continue;
          // Prefer just outside the hull, near the underside's height.
          const score = Math.abs(d - (r0 + 1.5)) + Math.abs(y - baseY) * 0.7;
          if (score < bestScore) {
            bestScore = score;
            best = new THREE.Vector3(x + 0.5, y, z + 0.5);
          }
          break;
        }
      }
    }
    return best;
  }

  // ---------- Vehicles ----------

  add(vehicle) {
    this.vehicles.push(vehicle);
    this.scene.add(vehicle.root);
    vehicle.root.visible = this.enabled;
    // Too many parked / wrecked vehicles: the oldest unused one goes (never
    // the one being added, a living fighter or another peer's puppet; only
    // this peer's own vehicles count, so puppets don't push them out).
    // (Round 13: nor the AI's ground units and the bases' parked vehicles, `npc`: tanks.js keeps those in check.)
    if (this.vehicles.reduce((n, v) => n + (v.puppet || v.npc ? 0 : 1), 0) > MAX_VEHICLES) {
      const old = this.vehicles.find((v) => v !== vehicle && v !== this.active && !v.keep && !v.puppet && !v.npc && !(v.isEnemyJet && v.alive));
      if (old) this.remove(old);
    }
    this.onAdded?.(vehicle);
    return vehicle;
  }

  remove(vehicle) {
    if (vehicle === this.active) this.exit({ force: true });
    const i = this.vehicles.indexOf(vehicle);
    if (i >= 0) this.vehicles.splice(i, 1);
    vehicle.dispose();
    this.onRemoved?.(vehicle);
  }

  create(type, data) {
    const cls = VehicleManager.types[type];
    if (!cls) return null;
    const v = new cls(this, data);
    // (Round 13) A Creative summon stays one (a reload, another player's copy).
    if (data?.summoned) {
      v.summoned = true;
      v.keep = true;
    }
    return this.add(v);
  }

  // The vehicle the player could board right now, or null.
  nearestEnterable() {
    if (!this.enabled || this.active || this.player.dead) return null;
    const p = this.player.position;
    let best = null;
    let bestD = Infinity;
    for (const v of this.vehicles) {
      if (!v.alive || v.unusable) continue;
      const er = v.enterRadius ?? v.radius;
      const d = v.pos.distanceTo(p) - er;
      const dCenter = Math.hypot(v.pos.x - p.x, v.pos.z - p.z);
      if ((d < ENTER_REACH || dCenter < er + 1.5) && d < bestD) {
        best = v;
        bestD = d;
      }
    }
    return best;
  }

  // F: board a vehicle nearby, or get out of the one you're in.
  toggle() {
    if (!this.enabled) return false;
    if (this.active) {
      // (Online Dogfight: no getting out.)
      const why = this.exitLocked?.();
      if (why) {
        this.onMessage?.(why);
        return false;
      }
      return this.exit();
    }
    const v = this.nearestEnterable();
    if (!v) return false;
    if (this.creativeOnly) {
      this.onMessage?.("Vehicles are Creative's in a Survival world");
      return false;
    }
    // (Survival: the game can hold a vehicle back, e.g. jets before their mission.)
    const why = this.canBoard ? this.canBoard(v) : null;
    if (why) {
      this.onMessage?.(why);
      return false;
    }
    return this.enter(v);
  }

  enter(v) {
    if (!v || !v.alive || this.active) return false;
    this.active = v;
    v.occupied = true;
    const p = this.player;
    p.vehicle = v;
    p.velocity.set(0, 0, 0);
    p.knockback.set(0, 0, 0);
    this.parachute.close(p);
    v.camYaw = p.yaw;
    v.camPitch = Math.min(0, p.pitch);
    v.onEnter();
    this.input.buttons.fill(false);
    this.input.pressed.clear();
    if (this.audio?.playVehicleEnter) this.audio.playVehicleEnter(v.type);
    if (this.onEnter) this.onEnter(v);
    return true;
  }

  // Gets out: onto the ground beside the vehicle, into the water, out of a
  // tunnel or, from high up, below it on a parachute (a jet ejects its
  // pilot upward first). force: no ejection effects (mods off, death).
  exit({ force = false } = {}) {
    const v = this.active;
    if (!v) return false;
    const p = this.player;
    const airborne = v.airborne;
    v.occupied = false;
    this.active = null;
    p.vehicle = null;
    v.onExit();
    let spot = null;
    if (!airborne) spot = this.safeExit(v);
    if (spot) {
      p.position.copy(spot);
      p.velocity.set(0, 0, 0);
    } else if (airborne && !force) {
      // Out in the air: a jet fires its seat up and away; out of anything
      // else you drop through the floor. Either way a parachute opens.
      const eject = v.type === "jet";
      p.position.copy(v.pos);
      p.position.y -= eject ? -1.5 : v.bottom + 2.2;
      if (this._stuck(p.position)) p.position.y = this.groundBelow(p.position.x, WORLD_HEIGHT, p.position.z) + 0.05;
      p.velocity.set(0, eject ? 16 : 0, 0);
      if (eject) p.applyImpulse(new THREE.Vector3(v.vel.x * 0.35, 0, v.vel.z * 0.35));
      this.parachute.deploy(p, eject ? 0.9 : 0.35);
      if (eject && this.audio?.playEject) this.audio.playEject();
      if (eject) {
        const c = new THREE.Color(0.7, 0.68, 0.66);
        for (let i = 0; i < 16; i++) this.effects.smoke.spawn({ x: v.pos.x, y: v.pos.y + 1, z: v.pos.z, vx: (Math.random() - 0.5) * 4, vy: 2 + Math.random() * 3, vz: (Math.random() - 0.5) * 4, life: 1.5, size0: 0.8, size1: 2.5, color0: c, alpha: 0.6, drag: 1.5 });
      }
    } else {
      // Buried (a ghost-mode UFO deep in the rock) or forced: up to the
      // surface above.
      const x = Math.floor(v.pos.x) + 0.5;
      const z = Math.floor(v.pos.z) + 0.5;
      const top = this.world.surfaceY(Math.floor(x), Math.floor(z));
      p.position.set(x, (top >= 0 ? top : this.world.heightAt(Math.floor(x), Math.floor(z))) + 1.05, z);
      p.velocity.set(0, 0, 0);
    }
    p.yaw = v.camYaw;
    p.pitch = Math.max(-1.2, Math.min(1.2, v.camPitch));
    p.resetFall?.();
    if (this.audio?.playVehicleExit && !force) this.audio.playVehicleExit(v.type);
    if (this.onExit) this.onExit(v);
    return true;
  }

  _stuck(pos) {
    return IS_SOLID[this.world.getBlock(Math.floor(pos.x), Math.floor(pos.y), Math.floor(pos.z))] || IS_SOLID[this.world.getBlock(Math.floor(pos.x), Math.floor(pos.y + 1), Math.floor(pos.z))];
  }

  // A vehicle's health ran out (or it crashed): it blows up; a pilot still
  // inside dies with it.
  destroy(v, cause = "vehicle") {
    if (!v.alive) return;
    v.alive = false;
    const pilot = v === this.active;
    this.onDestroyedHook?.(v, cause);
    v.onDestroyed(cause);
    if (pilot) {
      this.active = null;
      v.occupied = false;
      this.player.vehicle = null;
      if (this.onExit) this.onExit(v);
      if (this.onPilotKilled) this.onPilotKilled(cause, v);
    }
    // The wreck stays a moment (it's removed by its own update when done).
    if (v.removeAt === undefined) v.removeAt = 1;
  }

  // Nearest vehicle hit along a ray (lasers, bullets), skipping `skip`.
  raycast(origin, dir, maxDist, skip = null) {
    let best = null;
    for (const v of this.vehicles) {
      if (!v.alive || v === skip || !this.enabled) continue;
      const t = v.raycast(origin, dir, maxDist);
      if (t !== null && (!best || t < best.distance)) best = { vehicle: v, distance: t };
    }
    return best;
  }

  sphereHit(p, r) {
    for (const v of this.vehicles) {
      if (!v.alive || !this.enabled) continue;
      if (v.hullDistance(p, r + 1) < r) return v;
    }
    return null;
  }

  // Explosions hurt vehicles too.
  // cause: "explosion" (the player's) or "explosion_other" (anything else).
  explosion(center, radius, cause = "explosion") {
    for (const v of this.vehicles) this.explosionOn(v, center, radius, cause);
  }

  // How far a blast at `center` is from the vehicle, for its damage: from an
  // aircraft's surface (a blast under the wing is close, one off the nose
  // isn't), from a ship's middle less most of its size.
  blastDistance(v, center, max = Infinity) {
    if (v.hull) return v.hullDistance(center, max);
    return Math.max(0, v.pos.distanceTo(center) - v.radius * 0.6);
  }

  // One vehicle's share of a blast.
  explosionOn(v, center, radius, cause = "explosion") {
    if (!v.alive) return;
    const reach = radius * 1.8;
    const d = this.blastDistance(v, center, reach);
    if (d >= reach) return;
    const f = 1 - d / reach;
    v.damage(Math.floor(45 * Math.sqrt(radius / 7) * f), cause);
  }

  // ---------- Creative's summons (Round 13) ----------

  // Why nothing can be summoned just now (the message), or null. seatedOk:
  // the caller takes the player out of a vehicle first (the call-ins).
  summonRefusal({ seatedOk = false } = {}) {
    if (!this.player.creative) return "Vehicles are summoned in Creative only";
    if (this.away) return "Vehicles fly in the Overworld only";
    if (!this.enabled) return "Switch the mods on first (Settings > Missions mods)";
    if (this.player.dead) return "Not now";
    if (this.active && !seatedOk) return "Get out of your vehicle first (F)";
    return null;
  }

  // A vehicle item used (right click, js/content/vehicles.js): the vehicle
  // on the ground aimed at (up to SUMMON_REACH away, its tail clear of the
  // player, facing the way the player looks), or, aimed at the sky, the
  // player straight into it up in the air. Always handled (true): a held
  // button doesn't summon a second one.
  summonFromItem(ctx, key) {
    // (The use repeats while the button is held: each repeat pushes the next summon on.)
    const now = performance.now() / 1000;
    const held = now - this._summonT < SUMMON_REPEAT;
    this._summonT = now;
    if (held) return true;
    const why = this.summonRefusal();
    const def = VehicleManager.summons[key];
    if (why || !def || !VehicleManager.types[def.type]) {
      this.onMessage?.(why || "That vehicle isn't here yet");
      return true;
    }
    const eye = this.player.getEyePosition();
    const f = Array.isArray(ctx?.forward) ? new THREE.Vector3().fromArray(ctx.forward) : this.player.getForwardVector();
    const hit = this._aimGround(eye, f.normalize());
    if (hit) this.summonOnGround(key, hit, ctx);
    else this.summonInAir(key, ctx);
    return true;
  }

  // The first solid or water cell along the aim: { x, y, z } where it is met, or null.
  _aimGround(eye, dir) {
    const w = this.world;
    for (let t = 0.3; t <= SUMMON_REACH; t += 0.3) {
      const x = eye.x + dir.x * t;
      const y = eye.y + dir.y * t;
      const z = eye.z + dir.z * t;
      if (y < 0 || y >= WORLD_HEIGHT) {
        if (dir.y >= 0) return null;
        continue;
      }
      const id = w.getBlock(Math.floor(x), Math.floor(y), Math.floor(z));
      if (IS_SOLID[id] || IS_WET[id]) return { x, y, z };
    }
    return null;
  }

  // A summoned vehicle parked at `at` ({ x, y, z }: on the ground there).
  // Returns it, or null (no room: a message says why).
  summonOnGround(key, at, ctx = null) {
    const def = VehicleManager.summons[key];
    const cls = def && VehicleManager.types[def.type];
    if (!cls) return null;
    const p = this.player.position;
    const yaw = this.player.yaw;
    const fx = -Math.sin(yaw);
    const fz = -Math.cos(yaw);
    const v = new cls(this, { ...(def.data?.(this, ctx) || {}), pos: [at.x, at.y, at.z], yaw });
    // Its tail (or rim) clear of the player: pushed on along the aim if the spot is too close.
    const back = (v.spec?.probes?.tail ?? v.hitRadius ?? v.radius) + 1.5;
    let cx = at.x;
    let cz = at.z;
    const along = (cx - p.x) * fx + (cz - p.z) * fz;
    if (along < back) {
      cx += fx * (back - along);
      cz += fz * (back - along);
    }
    const g = this.groundBelow(cx, Math.max(at.y, p.y) + 4, cz);
    const wet = !!IS_WET[this.world.getBlock(Math.floor(cx), Math.floor(g - 1), Math.floor(cz))];
    const fail = (text) => {
      v.dispose();
      this.onMessage?.(text);
      return null;
    };
    if (!this.world.getChunk(Math.floor(cx) >> 4, Math.floor(cz) >> 4)) return fail("Too far: that ground isn't loaded");
    v.pos.set(cx, g + v.bottom + (v.type === "jet" ? 0 : 0.3), cz);
    if (v.type === "jet") {
      // (On its three wheels, on dry ground: water under them would wreck it.)
      const c = typeof v._contacts === "function" ? v._contacts(yaw) : null;
      if (wet || c?.wet) return fail(`Not on the water: the ${v.name} needs dry ground (or aim at the sky to start in the air)`);
      if (c) v.pos.y = Math.max(v.pos.y, c.centerY);
    }
    if (!this._roomFor(v, yaw)) return fail(`No room for the ${v.name} there: aim at open, flat ground (or at the sky to start in the air)`);
    v._place?.();
    this._addSummoned(v);
    this.audio?.playNotice?.();
    this.onMessage?.(`${v.name} is ready: walk up to it and press F`);
    return v;
  }

  // Nothing solid where its airframe (an aircraft's nose, wingtips, tail and
  // back) or its rim and top (a ship) would be.
  _roomFor(v, yaw) {
    const w = this.world;
    const fx = -Math.sin(yaw);
    const fz = -Math.cos(yaw);
    const rx = Math.cos(yaw);
    const rz = -Math.sin(yaw);
    const solid = (x, y, z) => IS_SOLID[w.getBlock(Math.floor(x), Math.floor(y), Math.floor(z))];
    const { x, y, z } = v.pos;
    const pr = v.spec?.probes;
    if (pr) {
      const pts = [[pr.nose, 0, 0], [3, 0, 0], [0, pr.wing, 0], [0, -pr.wing, 0], [-pr.tail, 0, 2.2], [0, 0, 1.2], [pr.nose * 0.5, pr.wing * 0.5, 0], [pr.nose * 0.5, -pr.wing * 0.5, 0]];
      return !pts.some(([f, r, u]) => solid(x + fx * f + rx * r, y + u, z + fz * f + rz * r));
    }
    const r = (v.hitRadius ?? v.radius) * 0.85;
    const top = v.info ? (v.info.top ?? v.info.bottom) * v.radius : v.radius * 0.3;
    if (solid(x, y + top * 0.5, z)) return false;
    // (A ground vehicle climbs a block's step: its ring is checked a block up, over the bumps.)
    const yr = v.half ? y + 1.1 : y;
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      if (solid(x + Math.cos(a) * r, yr, z + Math.sin(a) * r) || solid(x + Math.cos(a) * r * 0.6, y + top * 0.5, z + Math.sin(a) * r * 0.6)) return false;
    }
    return true;
  }

  // A summon into the sky: high above the player, flying, with them at the
  // controls (a ground vehicle, alt 0, only goes on the ground).
  summonInAir(key, ctx = null) {
    const def = VehicleManager.summons[key];
    const cls = def && VehicleManager.types[def.type];
    if (!cls) return null;
    if (!def.alt) {
      this.onMessage?.("Aim at the ground to place it");
      return null;
    }
    if (this.active) this.exit({ force: true });
    const p = this.player.position;
    const ground = Math.max(this.world.heightAt(Math.floor(p.x), Math.floor(p.z)), 0);
    const y = Math.min(210, Math.max(ground + def.alt, p.y + 30));
    const v = new cls(this, { ...(def.data?.(this, ctx) || {}), pos: [p.x, y, p.z], yaw: this.player.yaw, airborne: true });
    def.launch?.(v);
    v._place?.();
    this._addSummoned(v);
    this.enter(v);
    this.audio?.playNotice?.();
    this.onMessage?.(`${v.name}: you're in the air!`);
    return v;
  }

  // Kept with the world like a boat (and never the vehicle cap's); past
  // MAX_SUMMONED of this player's own, the oldest empty one goes.
  _addSummoned(v) {
    v.summoned = true;
    v.keep = true;
    this.add(v);
    const mine = this.vehicles.filter((o) => o.summoned && !o.puppet && o.alive);
    let extra = mine.length - MAX_SUMMONED;
    for (const old of mine) {
      if (extra <= 0) break;
      if (old === v || old === this.active || old.occupied) continue;
      this.remove(old);
      extra--;
    }
  }

  // ---------- Collisions ----------

  // Aircraft touching each other (Round 10): any two alive aircraft or ships
  // whose shapes meet during the frame (swept: fast ones can't pass through
  // each other) part and, if they met hard enough, take damage by how fast
  // they closed along the contact. Online each machine moves apart only the
  // ones it simulates; the damage to both is dealt once, by the machine the
  // game says judges that pair (collisionJudge, see net/vehicles.js), the
  // other player's share sent through collisionHit.
  _collide(dt) {
    const list = this.vehicles;
    if (list.length < 2 || dt <= 0) return;
    this._colT = (this._colT || 0) + dt;
    // (The list is read afresh each time: a crash's blast can take a vehicle out of it.)
    for (let i = 0; i < list.length; i++) {
      const a = list[i];
      // (Not a ship mid-dash, ours or another player's (netDash): its ram is
      // its own, vehicle-ufo.js; nor a jet a tractor beam is drawing up: the
      // beam swallows it.)
      const sa = a.alive && !a.dashing && !a.netDash && !(a.beamHeld > 0) ? a.collider : null;
      if (!sa) continue;
      for (let j = i + 1; j < list.length && a.alive; j++) {
        const b = list[j];
        const sb = b.alive && !b.dashing && !b.netDash && !(b.beamHeld > 0) ? b.collider : null;
        // (Both another machine's: theirs to judge. An aircraft still parked
        // at an airport is every peer's own copy: only against our own.)
        if (!sb || (a.puppet && b.puppet) || (a.puppet && b.parkedAt) || (b.puppet && a.parkedAt)) continue;
        // Broad phase: within reach of each other this frame, and moving.
        const rvx = b.vel.x - a.vel.x;
        const rvy = b.vel.y - a.vel.y;
        const rvz = b.vel.z - a.vel.z;
        const rv = Math.hypot(rvx, rvy, rvz);
        if (rv < 0.05) continue;
        const reach = sa.r + sb.r + rv * dt;
        const pa = this._colPos(a, _lead);
        const pb = this._colPos(b, _lead2);
        const dx = pb.x - pa.x;
        const dy = pb.y - pa.y;
        const dz = pb.z - pa.z;
        if (dx * dx + dy * dy + dz * dz > reach * reach) continue;
        if (!hullContact(sa, this._colPose(a, _pose, pa), sb, this._colPose(b, _pose2, pb), dt)) continue;
        this._contact(a, b);
      }
    }
  }

  // Where a body is now: another machine's is drawn its interpolation delay
  // behind its owner (15-25 blocks at fighter speeds), so it is tested where
  // it has got to by now, as its owner sees it (no crashes into a ghost).
  _colPos(v, out) {
    if (!v.puppet || !v.interp) return v.pos;
    return out.copy(v.pos).addScaledVector(v.vel, Math.min(0.35, v.interp.delay));
  }

  // A body as hullContact wants it ({ pos, q, vel }; a ship has no attitude quaternion).
  _colPose(v, out, pos = v.pos) {
    out.pos = pos;
    out.q = v.q && v.q.isQuaternion ? v.q : null;
    out.vel = v.vel;
    return out;
  }

  // Two bodies touch (CONTACT): part them, then the damage, if any.
  _contact(a, b) {
    const n = _n.set(CONTACT.nx, CONTACT.ny, CONTACT.nz); // from a toward b
    const closing = -((b.vel.x - a.vel.x) * n.x + (b.vel.y - a.vel.y) * n.y + (b.vel.z - a.vel.z) * n.z);
    const ia = 1 / Math.max(0.1, a.mass);
    const ib = 1 / Math.max(0.1, b.mass);
    // Apart: out of each other along the normal and the closing speed taken
    // away (only the ones simulated here: a puppet follows its owner).
    const wa = a.puppet ? 0 : b.puppet ? 1 : ia / (ia + ib);
    const wb = b.puppet ? 0 : a.puppet ? 1 : ib / (ia + ib);
    const depth = CONTACT.depth + 0.02;
    if (wa) a.pos.addScaledVector(n, -depth * wa);
    if (wb) b.pos.addScaledVector(n, depth * wb);
    if (closing > 0) {
      const j = (closing * 1.15) / (ia + ib); // (a little bounce)
      if (!a.puppet) a.vel.addScaledVector(n, -j * ia);
      if (!b.puppet) b.vel.addScaledVector(n, j * ib);
    }
    // (Already overlapping at the start of the frame, e.g. two aircraft set
    // down touching: they only part. And the same two hurt each other once
    // per PAIR_COOLDOWN, whatever the frames in between say.)
    if (!CONTACT.entered || closing < BUMP_SPEED * 0.5) return;
    const now = this._colT;
    const pairs = this._pairs || (this._pairs = []);
    for (let k = pairs.length - 1; k >= 0; k--) {
      const p = pairs[k];
      if (now - p.t > PAIR_COOLDOWN || !p.a.alive || !p.b.alive) pairs.splice(k, 1);
      else if ((p.a === a && p.b === b) || (p.a === b && p.b === a)) return;
    }
    pairs.push({ a, b, t: now });
    this.contacts++;
    // The knock, felt and heard by a pilot in either.
    const mine = a === this.active || b === this.active;
    if (mine) this.effects?.shake?.add?.(Math.min(0.6, 0.12 + closing * 0.015));
    const at = this.player.position;
    this.audio?.playUfoHit?.(Math.min(a.pos.distanceTo(at), b.pos.distanceTo(at)), closing > CRASH_SPEED * 0.5);
    if (closing < BUMP_SPEED) return;
    if (this.collisionJudge && !this.collisionJudge(a, b)) return;
    // Damage: the share of each grows with the other's mass; at CRASH_SPEED
    // two of a kind are both lost, much faster and even a B-2 is. (But one
    // contact with a much lighter body takes at most a share of a heavy one's
    // hull, however fast: a fighter can't erase a B-2 or a big ship at once.)
    const s = (closing - BUMP_SPEED) / (CRASH_SPEED - BUMP_SPEED);
    const k = s * Math.sqrt(s);
    let da = Math.ceil(a.maxHealth * k * ((2 * b.mass) / (a.mass + b.mass)));
    let db = Math.ceil(b.maxHealth * k * ((2 * a.mass) / (a.mass + b.mass)));
    if (a.mass > b.mass * 2) da = Math.min(da, Math.ceil(a.maxHealth * Math.min(1, (3 * b.mass) / a.mass)));
    if (b.mass > a.mass * 2) db = Math.min(db, Math.ceil(b.maxHealth * Math.min(1, (3 * a.mass) / b.mass)));
    if (mine && s > 0.25) this.onMessage?.("COLLISION!");
    // (Whether a player flew each, read before either is lost.)
    const pilotA = !!a.occupied;
    const pilotB = !!b.occupied;
    this._collisionHit(a, da, b, pilotB);
    this._collisionHit(b, db, a, pilotA);
  }

  _collisionHit(v, amount, other = null, pilot = false) {
    if (!v.alive || amount <= 0) return;
    if (v.puppet) this.collisionHit?.(v, amount);
    else {
      // (What it met, while the damage lands: a fighter downed by an aircraft a
      // player flew is theirs, by another fighter isn't; enemy-jets.js.)
      v.bumpedBy = other;
      v.bumpedPilot = pilot;
      try {
        v.damage(amount, "crash");
      } finally {
        v.bumpedBy = null;
        v.bumpedPilot = false;
      }
    }
  }

  // ---------- Input ----------

  mouseMove(dx, dy) {
    this.input.dx += dx;
    this.input.dy += dy;
  }

  mouseDown(button) {
    this.input.buttons[button] = true;
    this.input.pressed.add(`mouse${button}`);
  }

  mouseUp(button) {
    this.input.buttons[button] = false;
  }

  wheel(delta) {
    this.input.wheel += delta;
  }

  keyDown(code) {
    this.input.pressed.add(code);
  }

  releaseAll() {
    this.input.buttons.fill(false);
    this.input.pressed.clear();
    this.input.dx = 0;
    this.input.dy = 0;
    this.input.wheel = 0;
  }

  // ---------- Per frame ----------

  update(dt) {
    const p = this.player;
    // (Round 13) In the Nether or the End the vehicles stay in the Overworld:
    // hidden and still until the player is back. (Nobody travels seated: dimensions.js.)
    const away = !!this.world.dim && this.world.dim !== "overworld";
    if (away !== this.away) {
      this.away = away;
      for (const v of this.vehicles) v.root.visible = this.enabled;
      if (away && this.active) this.exit({ force: true });
    }
    // (Round 13) Switched to Survival while flying in a Survival world: out (a parachute up high).
    if (this.active && this.creativeOnly && !p.dead) {
      this.onMessage?.("Vehicles are Creative's in a Survival world");
      this.exit();
    }
    for (let i = this.vehicles.length - 1; i >= 0; i--) {
      const v = this.vehicles[i];
      if (!this.enabled) continue;
      v.update(dt, v === this.active ? this.input : null);
      if (!v.alive && v.removeAt !== undefined) {
        v.removeAt -= dt;
        if (v.removeAt <= 0 && !v.keepWreck) {
          this.vehicles.splice(i, 1);
          v.dispose();
          this.onRemoved?.(v);
        }
      }
    }
    if (this.enabled) this._collide(dt);
    const v = this.active;
    if (v) {
      v.seatPosition(this._seat);
      p.position.copy(this._seat);
      p.velocity.set(0, 0, 0);
      p.knockback.set(0, 0, 0);
      p.yaw = v.camYaw;
      p.pitch = v.camPitch;
    }
    this.input.dx = 0;
    this.input.dy = 0;
    this.input.wheel = 0;
    this.input.pressed.clear();
    this.parachute.update(dt, p, this.audio);
  }

  updateCamera(camera, dt) {
    if (this.active) this.active.updateCamera(camera, dt);
  }

  // HUD panel and the boarding hint (throttled DOM updates).
  updateHud(dt, playing) {
    this._hudTimer -= dt;
    const v = this.active;
    if (this.hudEl) this.hudEl.classList.toggle("hidden", !v || !playing);
    const sig = `${this.infoOpen}:${v ? v.id : 0}:${playing}`;
    if (sig !== this._infoSig) {
      this._infoSig = sig;
      if (!playing || !v) this.infoOpen = this.infoOpen && !!v && playing;
      this.refreshInfo();
    }
    // (Round 13: no hint where boarding is Creative's and F swaps the hands.)
    const near = playing && !v && !this.creativeOnly ? this.nearestEnterable() : null;
    if (this.promptEl) {
      this.promptEl.classList.toggle("hidden", !near);
      // (Written only when it changes: no DOM work every frame.)
      const text = near ? (this.canBoard?.(near) ? `The ${near.name} is locked for now (a later mission)` : `Press F to board the ${near.name}`) : "";
      if (text !== this._promptText) {
        this._promptText = text;
        if (text) this.promptEl.textContent = text;
      }
    }
    if (!v || !playing || this._hudTimer > 0 || !this.hudEl) return;
    this._hudTimer = 0.1;
    // (Live rows such as hull and ghost mode stay current while I is open.)
    if (this.infoOpen) this.refreshInfo();
    const h = v.hud();
    const rows = h.rows.map(([k, val]) => `<div class="vh-row"><span>${k}</span><b>${val}</b></div>`).join("");
    const bars = (h.bars || []).map((b) => `<div class="vh-bar-row"><span>${b.label}</span><div class="vh-bar"><div class="${b.hot ? "hot" : ""}" style="width:${Math.round(Math.max(0, Math.min(1, b.value)) * 100)}%"></div></div></div>`).join("");
    const hp = Math.max(0, Math.min(1, h.health));
    const html =
      `<div class="vh-title">${h.title}</div>${rows}${bars}` +
      `<div class="vh-health"><div style="width:${(hp * 100).toFixed(0)}%;background:${hp > 0.5 ? "#4fdc8a" : hp > 0.25 ? "#ffc94a" : "#ff4a3a"}"></div></div>` +
      (h.weapon ? `<div class="vh-weapon">${h.weapon}</div>` : "") +
      (h.warning ? `<div class="vh-warning">${h.warning}</div>` : "") +
      (h.help ? `<div class="vh-help">${this.exitLocked?.() ? h.help.replace(/F (EJECT|get out|exit)/i, "F: no getting out") : h.help}</div>` : "");
    // (Written only when it changes: no rebuild of the panel 10 times a second.)
    if (html !== this._hudHtml) this.hudEl.innerHTML = this._hudHtml = html;
  }

  // The vehicle info panel (I): stats and controls of the vehicle you are in.
  toggleInfo(force) {
    this.infoOpen = force ?? !this.infoOpen;
    this.refreshInfo();
  }

  refreshInfo() {
    const el = this.infoEl;
    if (!el) return;
    const v = this.active;
    const show = this.infoOpen && !!v && typeof v.infoPanel === "function";
    el.classList.toggle("hidden", !show);
    if (!show) return;
    const info = v.infoPanel();
    const stats = info.stats.map(([k, val]) => `<tr><td>${k}</td><td>${val}</td></tr>`).join("");
    const controls = info.controls.map(([k, val]) => `<tr><td><kbd>${k}</kbd></td><td>${val}</td></tr>`).join("");
    const html = `<h3>${info.title}</h3><h4>Stats</h4><table>${stats}</table><h4>Controls</h4><table>${controls}</table><div class="vi-close">Press I to close</div>`;
    if (html !== this._infoHtml) el.innerHTML = this._infoHtml = html;
  }

  // Mods switched off: a seated player is set down safely (on the ground
  // below, no parachute), and every vehicle is put away until mods return.
  // (Round 13) The Mods' switch; a Survival world keeps its Creative vehicles
  // whatever it says (only `enabled` turning off puts them away).
  setEnabled(on) {
    const was = this.enabled;
    this._on = !!on;
    on = this.enabled;
    if (on && was) {
      for (const v of this.vehicles) v.root.visible = true;
      return;
    }
    if (!on && this.active) {
      const v = this.active;
      const p = this.player;
      v.occupied = false;
      this.active = null;
      p.vehicle = null;
      v.onExit();
      const spot = v.airborne ? null : this.safeExit(v);
      if (spot) p.position.copy(spot);
      else {
        const x = Math.floor(v.pos.x);
        const z = Math.floor(v.pos.z);
        const top = this.world.surfaceY(x, z);
        p.position.set(x + 0.5, (top >= 0 ? top : this.world.heightAt(x, z)) + 1.05, z + 0.5);
      }
      p.velocity.set(0, 0, 0);
      p.resetFall?.();
      if (this.onExit) this.onExit(v);
    }
    if (!on) this.parachute.close(this.player);
    for (const v of this.vehicles) {
      v.root.visible = on;
      if (!on) v.onDisabled?.();
    }
    this.releaseAll();
  }

  // ---------- Saving ----------

  serialize() {
    const list = [];
    let active = -1;
    for (const v of this.vehicles) {
      if (!v.alive || v.transient) continue;
      if (v === this.active) active = list.length;
      list.push(v.serialize());
    }
    return { list, active };
  }

  load(data) {
    if (!data || !Array.isArray(data.list)) return;
    data.list.forEach((d, i) => {
      if (!d || typeof d.type !== "string" || !Array.isArray(d.pos) || !d.pos.every(Number.isFinite)) return;
      const v = this.create(d.type, d);
      if (v && d.calledIn) {
        v.calledIn = true;
        v.keep = true;
        if (v.type === "jet") v.isPlayerJet = true;
      }
      if (v && i === data.active) {
        // (Back in the seat, not boarded anew: onEnter's stats skip it.)
        this.restoring = true;
        try {
          this.enter(v);
        } finally {
          this.restoring = false;
        }
      }
    });
    // (Saved seated, loaded with mods off: on the ground below, as switching
    // mods off does, not stuck in a hidden vehicle that won't let you out.)
    if (!this.enabled && this.active) this.setEnabled(false);
  }
}

// (Round 13) Creative's aircraft: the fighters and the B-2 (vehicle-jet.js:
// parked on the wheels, or launched at cruise speed into the sky), and a
// pilot UFO of the next design each time (vehicle-ufo.js; sneaking: a
// small one). (Data only: the classes are looked up when summoned.)
const jetSummon = (jetType, alt) => ({
  type: "jet",
  alt,
  data: () => ({ jetType }),
  launch(v) {
    v.vel.copy(v.forward(new THREE.Vector3())).multiplyScalar(v.cfg.maxSpeed * 0.62);
    v.throttle = 0.75;
  },
});
VehicleManager.registerSummon("f22", jetSummon("f22", 75));
VehicleManager.registerSummon("f16", jetSummon("f16", 75));
VehicleManager.registerSummon("b2", jetSummon("b2", 100));
VehicleManager.registerSummon("ufo", {
  type: "ufo",
  alt: 40,
  data: (mgr, ctx) => ({ design: UFO_DESIGNS[mgr._ufoNext++ % UFO_DESIGNS.length], seed: Math.floor(Math.random() * 1e6), radius: ctx?.sneaking ? SUMMON_UFO_SMALL : SUMMON_UFO_RADIUS }),
});
