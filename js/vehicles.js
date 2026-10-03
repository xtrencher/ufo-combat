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
//     flying (the player is set down safely and the vehicles are put away).
// Vehicle types register themselves with VehicleManager.register().
import * as THREE from "three";
import { IS_SOLID, IS_WET } from "./blocks.js";
import { WORLD_HEIGHT } from "./constants.js";

const ENTER_REACH = 4.5; // blocks from a vehicle's hull
const MAX_VEHICLES = 12; // parked / wrecked vehicles kept in a world

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

  // Nearest hit of a ray on this vehicle (a sphere), or null.
  raycast(origin, dir, maxDist) {
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

  serialize() {
    return { type: this.type, pos: this.pos.toArray().map((v) => Math.round(v * 100) / 100), health: this.health };
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
    this.enabled = true;
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
    // Too many parked / wrecked vehicles: the oldest unused one goes.
    if (this.vehicles.length > MAX_VEHICLES) {
      const old = this.vehicles.find((v) => v !== this.active && !v.keep);
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
    return this.add(new cls(this, data));
  }

  // The vehicle the player could board right now, or null.
  nearestEnterable() {
    if (!this.enabled || this.active || this.player.dead) return null;
    const p = this.player.position;
    let best = null;
    let bestD = Infinity;
    for (const v of this.vehicles) {
      if (!v.alive || v.unusable) continue;
      const d = v.pos.distanceTo(p) - v.radius;
      const dCenter = Math.hypot(v.pos.x - p.x, v.pos.z - p.z);
      if ((d < ENTER_REACH || dCenter < v.radius + 1.5) && d < bestD) {
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
      if (v.pos.distanceTo(p) < (v.hitRadius ?? v.radius) + r) return v;
    }
    return null;
  }

  // Explosions hurt vehicles too.
  // cause: "explosion" (the player's) or "explosion_other" (anything else).
  explosion(center, radius, cause = "explosion") {
    for (const v of this.vehicles) this.explosionOn(v, center, radius, cause);
  }

  // One vehicle's share of a blast.
  explosionOn(v, center, radius, cause = "explosion") {
    if (!v.alive) return;
    const d = Math.max(0, v.pos.distanceTo(center) - v.radius * 0.6);
    const reach = radius * 1.8;
    if (d >= reach) return;
    const f = 1 - d / reach;
    v.damage(Math.floor(45 * Math.sqrt(radius / 7) * f), cause);
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
    const near = playing && !v ? this.nearestEnterable() : null;
    if (this.promptEl) {
      this.promptEl.classList.toggle("hidden", !near);
      if (near) this.promptEl.textContent = this.canBoard?.(near) ? `The ${near.name} is locked for now (a later mission)` : `Press F to board the ${near.name}`;
    }
    if (!v || !playing || this._hudTimer > 0 || !this.hudEl) return;
    this._hudTimer = 0.1;
    const h = v.hud();
    const rows = h.rows.map(([k, val]) => `<div class="vh-row"><span>${k}</span><b>${val}</b></div>`).join("");
    const bars = (h.bars || []).map((b) => `<div class="vh-bar-row"><span>${b.label}</span><div class="vh-bar"><div class="${b.hot ? "hot" : ""}" style="width:${Math.round(Math.max(0, Math.min(1, b.value)) * 100)}%"></div></div></div>`).join("");
    const hp = Math.max(0, Math.min(1, h.health));
    this.hudEl.innerHTML =
      `<div class="vh-title">${h.title}</div>${rows}${bars}` +
      `<div class="vh-health"><div style="width:${(hp * 100).toFixed(0)}%;background:${hp > 0.5 ? "#4fdc8a" : hp > 0.25 ? "#ffc94a" : "#ff4a3a"}"></div></div>` +
      (h.weapon ? `<div class="vh-weapon">${h.weapon}</div>` : "") +
      (h.warning ? `<div class="vh-warning">${h.warning}</div>` : "") +
      (h.help ? `<div class="vh-help">${this.exitLocked?.() ? h.help.replace(/F (EJECT|get out|exit)/i, "F: no getting out") : h.help}</div>` : "");
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
    el.innerHTML = `<h3>${info.title}</h3><h4>Stats</h4><table>${stats}</table><h4>Controls</h4><table>${controls}</table><div class="vi-close">Press I to close</div>`;
  }

  // Mods switched off: a seated player is set down safely (on the ground
  // below, no parachute), and every vehicle is put away until mods return.
  setEnabled(on) {
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
    this.enabled = on;
    for (const v of this.vehicles) v.root.visible = on;
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
      if (v && i === data.active) this.enter(v);
    });
  }
}
