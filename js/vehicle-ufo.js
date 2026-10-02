// The player's UFO: a crashed wreck boarded after a shoot-down (damaged but
// working, same shape), or one spawned from the Mods menu in Creative.
//
// No physics limits: it hovers perfectly still, moves instantly in any
// direction (W/S along the view, A/D sideways, Space/Shift up and down),
// and its cruising speed spans slow hovering to ludicrous (mouse wheel;
// Ctrl for a boost). Optional ghost mode flies through terrain, burning a
// tunnel. Weapons: the ship's own attack style (left click), the same one
// the enemy ships of its kind use (rapid bursts, heavy plasma, a spread
// fan, charged shots, a sweeping beam, seeking plasma or pulse bolts; big
// ships fire from around the hull, every shot aimed at what is under the
// crosshair), a tractor beam (hold right click) that lifts creatures, and
// optionally loose blocks, up into the ship, a teleport dash (R: the ship
// streaks along the view; held, it keeps streaking until you let go) and a
// superweapon (B): after a short charge a huge laser straight down that
// burns a shaft through the ground and everything in it. Third-person chase
// camera (F5: chase / far / belly view), set above the ship so the ship
// sits low on the screen and the crosshair is always on open view.
import * as THREE from "three";
import { Vehicle, VehicleManager } from "./vehicles.js";
import { createUfoModel, designInfo, designFacingOffset, UFO_DESIGN_NAMES, normalizeUfoSpec } from "./ufo-models.js";
import { TractorBeam } from "./tractor-beam.js";
import { LASER_COLORS } from "./lasers.js";
import { BLOCK, BLOCK_INFO, IS_SOLID } from "./blocks.js";
import { sweepAxis, boxInSolid } from "./physics.js";
import { blockDrops } from "./items.js";
import { blockCubeGeometry } from "./models.js";
import { createEntityMaterial, bindEntityLight } from "./shaders.js";
import { effectsQuality } from "./effects.js";
import { WORLD_HEIGHT } from "./constants.js";
import { pickUfoStyle } from "./ufos.js";

export const UFO_SPEED_DEFAULTS = { minSpeed: 2, maxSpeed: 300, ghost: false, beamBlocks: true };
const BEAM_LIFT = 6; // blocks per second
const MAX_LIFTED_BLOCKS = 12;
const DASH_COOLDOWN = 2.5;
const DASH_HOLD_COOLDOWN = 1.2; // after a held (continuous) dash
const DASH_SPEED = [900, 3500]; // blocks/s while R is held (from the dash settings), before the ship's own factor
const DASH_FACTOR = [1, 6]; // every ship has its own dash factor in this range (log scale): some are fast, some extreme
const DASH_GHOST_SPEED = 320; // ... and at most this in ghost mode (it burns a tunnel)

// The player's version of each enemy attack style (ufos.js STYLES): the
// same look and sound, balanced for the player. damage is per bolt (per
// second for the beam) for a small ship; bigger ships hit harder (SIZE_POWER)
// and fire from more points around the hull.
export const PILOT_STYLES = {
  rapid: { name: "Rapid bursts", color: "cyan", sound: "rapid", reload: 0.75, shots: 5, gap: 0.07, damage: 9, speed: 280, radius: 0.1, length: 3.2 },
  heavy: { name: "Heavy plasma", color: "orange", sound: "heavy", reload: 1.15, damage: 40, speed: 95, radius: 0.5, length: 1.5, blast: 3.0 },
  spread: { name: "Spread fan", color: "magenta", sound: "spread", reload: 0.8, count: 5, fan: 0.16, damage: 10, speed: 240, radius: 0.12, length: 2.6 },
  charged: { name: "Charged shot", color: "white", sound: "charged", reload: 1.4, charge: 0.9, damage: 150, speed: 480, radius: 0.24, length: 11, blast: 1.6 },
  sweep: { name: "Sweeping beam", color: "red", sound: "sweep", beam: true, damage: 52, heat: 3, cool: 1.6 },
  seeker: { name: "Seeker plasma", color: "lime", sound: "seeker", reload: 1.3, damage: 60, speed: 110, radius: 0.28, length: 2.6, blast: 1.8, homing: true },
  abductor: { name: "Pulse bolts", color: "green", sound: "volley", reload: 0.32, damage: 15, speed: 220, radius: 0.12, length: 2.6, beamBoost: 1.6 },
  volley: { name: "Pulse bolts", color: "green", sound: "volley", reload: 0.32, damage: 15, speed: 220, radius: 0.12, length: 2.6 },
  burst: { name: "Three-shot bursts", color: "green", sound: "rapid", reload: 0.65, shots: 3, gap: 0.09, damage: 12, speed: 240, radius: 0.1, length: 3 },
};
const SIZE_POWER = [1, 1.3, 1.7, 2.3, 3]; // small ... giant
const SUPER_CHARGE = 1.3; // seconds
const SUPER_TIME = 2.6; // seconds of beam
const SUPER_COOLDOWN = 15;
const SUPER_DIG_SPEED = 55; // blocks per second the shaft deepens

const _v = new THREE.Vector3();
const _w = new THREE.Vector3();
const _x1 = new THREE.Vector3();
const _feet = new THREE.Vector3();

function sizeName(radius) {
  return radius < 5 ? "small" : radius < 9 ? "medium" : radius < 20 ? "large" : radius < 50 ? "mothership" : "giant";
}
function sizeIndex(radius) {
  return radius < 5 ? 0 : radius < 9 ? 1 : radius < 20 ? 2 : radius < 50 ? 3 : 4;
}
// A small seeded random source (a ship keeps its style across saves).
function seeded(seed) {
  let a = (seed * 2654435761) >>> 0 || 7;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), a | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export class PilotUfo extends Vehicle {
  // data: { spec | design, radius, pos, yaw, health, crashed, wreck, tilt }
  constructor(manager, data = {}) {
    const radius = Math.max(2.5, Math.min(80, Number(data.radius) || 5));
    super(manager, { type: "ufo", name: "UFO", radius, maxHealth: Math.round(120 + radius * 40) });
    this.spec = normalizeUfoSpec(data.spec && data.spec.design ? { design: data.spec.design, seed: data.spec.seed | 0, glow: !!data.spec.glow } : { design: data.design || "saucer", seed: Number.isFinite(data.seed) ? data.seed : 0, glow: !!data.glow });
    this.design = this.spec.design;
    this.name = `${UFO_DESIGN_NAMES[this.design] || "UFO"} (${sizeName(radius)})`;
    this.model = createUfoModel(this.spec, radius);
    this.root.add(this.model.root);
    this.info = designInfo(this.spec);
    // Its weapon: the attack style of its kind (a wreck keeps the one it
    // fought with).
    this.style = PILOT_STYLES[data.style] ? data.style : pickUfoStyle(this.design, sizeIndex(radius), seeded((this.spec.seed | 0) + Math.round(radius * 10)));
    this.gun = { t: 0, queue: [], charge: 0, heat: 0, overheated: false, beam: null, tickT: 0 };
    // A wreck that blew up is burnt out for good: it can't be boarded.
    this.wreck = !!data.wreck;
    this.unusable = this.wreck;
    if (this.wreck) this.model.setCharred(true);
    this.cameraModes = ["chase", "far", "belly"];
    if (Array.isArray(data.pos)) this.pos.fromArray(data.pos);
    else if (data.pos) this.pos.copy(data.pos);
    this.yaw = Number(data.yaw) || 0;
    this.camYaw = this.yaw;
    if (Number.isFinite(data.health)) this.health = Math.max(1, Math.min(this.maxHealth, data.health));
    this.crashed = !!data.crashed; // a wreck in its crater until boarded
    // Shot down once: it never glows again, even when boarded and flown.
    this.downed = !!data.downed || this.crashed || this.wreck;
    this.tilt = new THREE.Euler(data.tilt?.[0] ?? 0, 0, data.tilt?.[1] ?? 0);
    if (this.crashed && !data.tilt) this.tilt.set((Math.random() - 0.5) * 0.5, 0, (Math.random() - 0.5) * 0.5);
    this.hitRadius = radius * 0.9;
    this.speedLevel = 0.3; // 0-1 over the min-max speed range (log scale)
    this.time = Math.random() * 10;
    this.beam = new TractorBeam(manager.scene, new THREE.Color(0.35, 0.8, 1.7));
    this._cannonT = 0;
    this._liftT = 0;
    this._carved = null; // last tunnel carve position (ghost mode)
    this._smokeT = 0;
    this.lifted = []; // blocks rising in the beam: { mesh, pos, id }
    this.abducted = 0;
    this._aim = new THREE.Vector3();
    // How fast this ship dashes: a fixed random factor per ship (from its look and size).
    this.dashMul = DASH_FACTOR[0] * Math.pow(DASH_FACTOR[1] / DASH_FACTOR[0], seeded((this.spec.seed | 0) * 7 + Math.round(radius * 13) + 5)());
    this.dashT = 0;
    this.dashing = null; // a dash under way: { from, to, t, dur }
    this.sw = { state: "idle", t: 0, cool: 0, depth: 0, hitT: 0, mesh: null, glow: null };
    this.keep = !this.wreck; // the player's ship is never cleaned up as clutter (a burnt-out wreck is)
    this._place();
  }

  get bottom() {
    return this.info.bottom * this.radius;
  }

  get cfg() {
    return this.manager.config.ufo || UFO_SPEED_DEFAULTS;
  }

  // Current cruising speed (blocks/s).
  get cruise() {
    const { minSpeed, maxSpeed } = this.cfg;
    const lo = Math.max(0.5, minSpeed);
    const hi = Math.max(lo + 1, maxSpeed);
    return lo * Math.pow(hi / lo, this.speedLevel);
  }

  // A wreck waiting in its crater can't be blown apart (stray shots at the
  // aliens around it would otherwise take away the ride home).
  damage(amount, cause, byPlayer) {
    if (this.crashed) return false;
    return super.damage(amount, cause, byPlayer);
  }

  seatPosition(out = new THREE.Vector3()) {
    return out.set(this.pos.x, this.pos.y - this.bottom + 0.2, this.pos.z);
  }

  onEnter() {
    if (this.crashed) {
      // Lifting out of the crater; the lights come back on.
      this.crashed = false;
      this.model.setDead(false);
      this.boardedWreck = true;
      // Rise straight out of the crater first (clear of its rim).
      this.liftOff = this.radius * 0.5 + 5;
      this.manager.onMessage?.("The wreck still flies! Damaged, but working.");
    }
  }

  onExit() {
    this.beam.set(false);
    // Whatever the gun was doing stops (a burst, a charge, the beam).
    this.gun.queue.length = 0;
    this.gun.charge = 0;
    if (this.gun.beam) this.gun.beam.visible = false;
    if (this.dashing?.cont) {
      this.dashing = null;
      this.vel.set(0, 0, 0);
    }
  }

  onDestroyedCleanup() {
    if (this.sw.mesh) this.manager.scene.remove(this.sw.mesh, this.sw.orb);
    const b = this.gun?.beam;
    if (b) {
      this.manager.scene.remove(b);
      b.material.dispose();
      b.children[0].material.dispose();
      this.gun.beam = null;
    }
  }

  // ---------- Flight ----------

  _viewDir(out) {
    const cp = Math.cos(this.camPitch);
    return out.set(-Math.sin(this.camYaw) * cp, Math.sin(this.camPitch), -Math.cos(this.camYaw) * cp);
  }

  _collide(delta) {
    const w = this.manager.world;
    const r = Math.min(6, this.radius * 0.6);
    const h = Math.min(6, Math.max(1, this.info.h * this.radius));
    _feet.set(this.pos.x, this.pos.y - this.bottom, this.pos.z);
    // A wreck half buried in its crater starts inside the ground: let it
    // move freely until it's clear, instead of being pushed deeper.
    if (boxInSolid(w, _feet, r * 0.8, h * 0.8)) {
      this.pos.add(delta);
      return;
    }
    for (const axis of ["x", "y", "z"]) {
      const d = delta[axis];
      if (d === 0) continue;
      let allowed = sweepAxis(w, _feet, r, h, axis, d);
      if (Math.sign(allowed) !== Math.sign(d)) allowed = 0; // never pushed backwards
      _feet[axis] += allowed;
      if (Math.abs(allowed - d) > 1e-6) this.vel[axis] = 0;
    }
    this.pos.set(_feet.x, _feet.y + this.bottom, _feet.z);
  }

  // Ghost mode: burns a tunnel along the path through anything solid.
  _burnTunnel(from, to) {
    const w = this.manager.world;
    const r = Math.min(7, Math.max(1.6, this.radius * 0.75));
    const len = from.distanceTo(to);
    const steps = Math.max(1, Math.ceil(len / (r * 0.5)));
    const edits = [];
    const seen = new Set();
    const removed = [];
    for (let s = 1; s <= steps; s++) {
      _v.lerpVectors(from, to, s / steps);
      const cx = Math.floor(_v.x);
      const cy = Math.floor(_v.y);
      const cz = Math.floor(_v.z);
      const R = Math.ceil(r);
      for (let x = cx - R; x <= cx + R; x++) {
        for (let y = Math.max(1, cy - R); y <= Math.min(WORLD_HEIGHT - 1, cy + R); y++) {
          for (let z = cz - R; z <= cz + R; z++) {
            const dx = x + 0.5 - _v.x;
            const dy = y + 0.5 - _v.y;
            const dz = z + 0.5 - _v.z;
            if (dx * dx + dy * dy + dz * dz > r * r) continue;
            const id = w.getBlock(x, y, z);
            if (!IS_SOLID[id] || id === BLOCK.BEDROCK) continue;
            const key = `${x},${y},${z}`;
            if (seen.has(key)) continue;
            seen.add(key);
            edits.push(x, y, z, BLOCK.AIR);
            removed.push(x, y, z, id);
          }
        }
      }
    }
    if (edits.length === 0) return 0;
    w.setBlocks(edits);
    this.manager.effects.floodInto(removed);
    // Glowing embers where the hull burns through.
    const fx = this.manager.effects;
    const n = Math.min(20, Math.ceil(removed.length / 30)) * effectsQuality.scale;
    for (let i = 0; i < n; i++) {
      const k = Math.floor(Math.random() * (removed.length / 4)) * 4;
      fx.glow.spawn({ x: removed[k] + 0.5, y: removed[k + 1] + 0.5, z: removed[k + 2] + 0.5, vx: (Math.random() - 0.5) * 3, vy: Math.random() * 3, vz: (Math.random() - 0.5) * 3, life: 0.5 + Math.random() * 0.6, size0: 0.35, size1: 0.05, color0: this._ember || (this._ember = new THREE.Color(3, 1.2, 0.3)), gravity: 0.3, drag: 2 });
    }
    return removed.length / 4;
  }

  update(dt, input) {
    super.update(dt, input);
    this.time += dt;
    const m = this.model;
    if (!this.alive) {
      this.beam.set(false);
      this.beam.update(dt, this.manager.effects);
      return;
    }
    if (input) {
      // Look around.
      const sens = 0.0022 * (this.manager.mouseSensitivity ?? 1);
      this.camYaw -= input.dx * sens;
      this.camPitch -= input.dy * sens * (this.manager.invertY ? -1 : 1);
      this.camPitch = Math.max(-1.5, Math.min(1.2, this.camPitch));
      // Cruising speed on the wheel (exponential steps).
      if (input.wheel) this.speedLevel = Math.max(0, Math.min(1, this.speedLevel - Math.sign(input.wheel) * 0.05));
      const k = input.keys;
      const view = this._viewDir(_v);
      const right = _w.set(Math.cos(this.camYaw), 0, -Math.sin(this.camYaw));
      const move = new THREE.Vector3();
      if (k.has("KeyW")) move.add(view);
      if (k.has("KeyS")) move.sub(view);
      if (k.has("KeyD")) move.add(right);
      if (k.has("KeyA")) move.sub(right);
      if (k.has("Space")) move.y += 1;
      if (k.has("ShiftLeft") || k.has("ShiftRight")) move.y -= 1;
      const boost = k.has("ControlLeft") || k.has("ControlRight") ? 3 : 1;
      // Instant: no inertia at all.
      if (move.lengthSq() > 0) this.vel.copy(move.normalize().multiplyScalar(this.cruise * boost));
      else this.vel.set(0, 0, 0);
      const before = this.pos.clone();
      const step = this.vel.clone().multiplyScalar(dt);
      if (this.dashing) {
        // A dash under way: the ship streaks along its path.
        this._updateDash(dt, input);
      } else if (this.liftOff > 0) {
        // Leaving the crater: straight up, through anything in the way.
        const up = Math.min(this.liftOff, 7 * dt);
        this.liftOff -= up;
        this.pos.y += up;
        this.vel.set(0, 7, 0);
      } else if (this.cfg.ghost) {
        this.pos.add(step);
        this.pos.y = Math.max(2 + this.bottom, Math.min(250, this.pos.y));
        if (this._carved === null || this._carved.distanceTo(this.pos) > 0.8) {
          this._burnTunnel(this._carved || before, this.pos);
          this._carved = this.pos.clone();
        }
      } else {
        this._collide(step);
        this.pos.y = Math.max(1 + this.bottom, Math.min(250, this.pos.y));
        this._carved = null;
      }
      this._weapons(dt, input);
      if (input.pressed.has("KeyR")) this._dash(view);
      if (input.pressed.has("KeyB")) this._startSuper();
      if (input.pressed.has("KeyG")) this._toggleGhost();
    } else if (this.crashed) {
      // A smoking wreck.
      this._smokeT -= dt;
      if (this._smokeT <= 0) {
        this._smokeT = 0.25;
        const c = this._smokeC || (this._smokeC = [new THREE.Color(0.12, 0.11, 0.1), new THREE.Color(0.4, 0.39, 0.37)]);
        this.manager.effects.smoke.spawn({ x: this.pos.x + (Math.random() - 0.5) * this.radius, y: this.pos.y + 0.5, z: this.pos.z + (Math.random() - 0.5) * this.radius, vx: 0, vy: 1.5 + Math.random(), vz: 0, life: 3 + Math.random() * 2, size0: 1, size1: 3 + this.radius * 0.3, color0: c[0], color1: c[1], alpha: 0.45, drag: 0.8 });
      }
    }
    if (!input && this.dashing) this._updateDash(dt, null);
    if (!input) this.beam.set(false);
    this.beam.update(dt, this.manager.effects);
    this._updateLifted(dt);
    this.dashT = Math.max(0, this.dashT - dt);
    this._updateDashFx(dt);
    this._updateSuper(dt, !!input);

    // The saucer turns slowly to its heading and banks with its motion.
    const target = input ? this.camYaw : this.yaw;
    this.yaw += Math.atan2(Math.sin(target - this.yaw), Math.cos(target - this.yaw)) * Math.min(1, dt * 2);
    if (!this.crashed) {
      const localV = this.vel.clone().applyAxisAngle(new THREE.Vector3(0, 1, 0), -this.yaw);
      const sp = Math.max(1, this.cruise);
      this.tilt.x += (THREE.MathUtils.clamp(-localV.z / sp, -1, 1) * -0.18 - this.tilt.x) * Math.min(1, dt * 4);
      this.tilt.z += (THREE.MathUtils.clamp(-localV.x / sp, -1, 1) * 0.18 - this.tilt.z) * Math.min(1, dt * 4);
    }
    this._place();
    const night = this.manager.night ?? 0;
    m.lightsOn = this.downed ? 0 : 1; // a shot-down UFO never glows again
    if (this.downed && !m.dead) m.setDead(true);
    m.animate(this.time, { night, damage: 1 - this.health / this.maxHealth, beam: this.beam.strength, speed: this.vel.length() });
  }

  _place() {
    this.root.position.copy(this.pos);
    // Parked in a hangar: a slow, gentle bob just above the floor.
    if (this.hangar && !this.occupied) this.root.position.y += Math.sin(this.time * 1.1) * 0.12;
    // (A design with a front, like the tic-tac, whose long axis lies sideways in
    // its model, is turned so that it points the way the ship flies.)
    this.model.body.rotation.set(this.tilt.x, this.yaw + (designFacingOffset(this.design) ?? 0), this.tilt.z, "YXZ");
    const l = this.manager.world.lightAt(this.pos.x, this.pos.y + 1, this.pos.z);
    this.model.light.sky = Math.max(l.sky, this.crashed ? 0 : 10);
    this.model.light.block = l.block;
    if (this.hurtTime < 0.25) this.model.light.flash.setRGB(0.6 * (1 - this.hurtTime / 0.25), 0.05, 0);
    else this.model.light.flash.setRGB(0, 0, 0);
  }

  // ---------- Weapons ----------

  get pilotStyle() {
    return PILOT_STYLES[this.style] || PILOT_STYLES.volley;
  }

  // Damage multiplier for the ship's size (bigger ships hit harder).
  get power() {
    return SIZE_POWER[sizeIndex(this.radius)];
  }

  // How many points around the hull a big ship fires from.
  get barrels() {
    const r = this.radius;
    return r < 5 ? 1 : r < 9 ? 2 : r < 20 ? 3 : r < 50 ? 4 : 6;
  }

  // Where the next shot leaves the hull: under it for a small ship, from a
  // point on the rim (turning round from shot to shot) for a big one.
  _muzzle(out = new THREE.Vector3()) {
    const r = this.radius;
    const n = this.barrels;
    out.copy(this.pos);
    out.y -= this.bottom * 0.5;
    if (n > 1) {
      this._barrel = ((this._barrel ?? -1) + 1) % n;
      const a = (this._barrel / n) * Math.PI * 2 + this.yaw;
      out.x += Math.cos(a) * r * 0.62;
      out.z += Math.sin(a) * r * 0.62;
    }
    return out;
  }

  // Fires one bolt of the ship's style from a muzzle at the aim point.
  _bolt(from, dirOverride = null) {
    const mgr = this.manager;
    const st = this.pilotStyle;
    const r = this.radius;
    const d = dirOverride ? dirOverride.clone() : this._aim.clone().sub(from);
    if (d.lengthSq() < 1) d.copy(this._viewDir(_w));
    d.normalize();
    // Never start inside the hull's own rim: step out along the shot.
    from.addScaledVector(d, Math.min(r * 0.35, 6));
    const bolt = mgr.lasers.fire({
      from,
      dir: d,
      color: LASER_COLORS[st.color] || LASER_COLORS.cyan,
      speed: st.speed + Math.min(160, r * 3),
      damage: Math.round(st.damage * this.power),
      owner: "playerufo",
      source: this,
      range: 520 + Math.min(300, r * 6),
      radius: (st.radius ?? 0.12) + Math.min(0.4, r * 0.008),
      length: (st.length ?? 2.6) + r * 0.05,
      blast: st.blast ? st.blast * (1 + Math.min(1.2, r * 0.015)) : 0,
      sound: false,
    });
    if (st.homing) {
      const t = this._seekTarget();
      if (t) bolt.homing = { target: t, turn: 2.4, life: 5 };
    }
    return bolt;
  }

  // What seeker plasma homes in on: the UFO, enemy aircraft or hostile
  // creature nearest the crosshair (within a small cone).
  _seekTarget() {
    const mgr = this.manager;
    const cam = mgr.cameraRef;
    const eye = cam ? cam.position : this.pos;
    const dir = this._viewDir(_w);
    let best = null;
    let bestA = 0.3;
    const consider = (obj, pos) => {
      const to = _feet.copy(pos).sub(eye);
      const dist = to.length();
      if (dist < 5 || dist > 700) return;
      const a = to.divideScalar(dist).angleTo(dir);
      if (a < bestA) {
        bestA = a;
        best = obj;
      }
    };
    for (const u of mgr.ufos?.ufos ?? []) if (!u.falling && u.state !== "gone") consider(u, u.pos);
    for (const v of mgr.vehicles) if (v !== this && v.alive && v.isEnemyJet) consider(v, v.pos);
    for (const m of mgr.mobs.mobs) if (!m.dead && m.spec.hostile) consider({ pos: m.pos, vel: m.vel }, m.pos);
    return best;
  }

  _weapons(dt, input) {
    const mgr = this.manager;
    const g = this.gun;
    const st = this.pilotStyle;
    g.t = Math.max(0, g.t - dt);
    // Aim: whatever the camera's centre ray hits first (terrain, a UFO, a
    // creature, a vehicle). Every shot is aimed at that point, so shots from
    // a huge ship converge on the crosshair instead of passing beside it.
    const cam = mgr.cameraRef;
    const eye = cam ? cam.position : this.pos;
    const dir = this._viewDir(_v).clone();
    let range = 600;
    const hit = mgr.world.raycast(eye, dir, range, { solidOnly: true });
    if (hit) range = hit.distance;
    const uh = mgr.ufos?.raycast(eye, dir, range, (u) => u.state !== "gone");
    if (uh) range = Math.min(range, uh.distance);
    const mh = mgr.mobs.raycast(eye, dir, range);
    if (mh) range = Math.min(range, mh.distance);
    const vh = mgr.raycast(eye, dir, range, this);
    if (vh) range = Math.min(range, vh.distance);
    // Nothing near: converge far out (the bolts are straight past that).
    this._aim.copy(eye).addScaledVector(dir, hit || uh || mh || vh ? range : 600);
    const held = !!input.buttons[0];
    const clicked = input.pressed.has("mouse0");
    // Bursts on their way (re-aimed shot by shot).
    for (let i = 0; i < g.queue.length; i++) {
      g.queue[i] -= dt;
      if (g.queue[i] > 0) continue;
      g.queue.splice(i--, 1);
      this._bolt(this._muzzle(_feet));
    }
    if (st.beam) {
      this._updateSweep(dt, held);
    } else if (st.charge) {
      // A click (or holding the button) starts the charge; it fires by itself.
      if (g.charge > 0) {
        g.charge += dt;
        const k = Math.min(1, g.charge / st.charge);
        const m = this._muzzle(_feet);
        mgr.effects.glow.spawn({ x: m.x, y: m.y, z: m.z, life: 0.06, size0: (0.5 + this.radius * 0.12) * (0.3 + k * 1.4), size1: 0.2, color0: LASER_COLORS.white, alpha: 0.35 + k * 0.6 });
        if (g.charge >= st.charge) {
          g.charge = 0;
          g.t = st.reload;
          this._bolt(this._muzzle(_feet));
          mgr.audio?.playUfoShot?.(st.sound, 0);
        }
      } else if ((held || clicked) && g.t <= 0) {
        g.charge = 0.0001;
        mgr.audio?.playUfoCharge?.(st.charge, 0);
      }
    } else if ((held || clicked) && g.t <= 0 && g.queue.length === 0) {
      g.t = st.reload + (st.shots ? st.shots * st.gap : 0);
      if (st.shots) {
        for (let k = 0; k < st.shots; k++) g.queue.push(k * st.gap);
      } else if (st.count > 1) {
        // A fan across the line of fire, level with the ground.
        const from = this._muzzle(new THREE.Vector3());
        const d = this._aim.clone().sub(from).normalize();
        const side = new THREE.Vector3(-d.z, 0, d.x);
        if (side.lengthSq() < 1e-6) side.set(1, 0, 0);
        side.normalize();
        for (let k = 0; k < st.count; k++) {
          const off = (k / (st.count - 1) - 0.5) * 2 * st.fan;
          this._bolt(from.clone(), d.clone().addScaledVector(side, Math.tan(off)).normalize());
        }
      } else {
        this._bolt(this._muzzle(_feet));
      }
      mgr.audio?.playUfoShot?.(st.sound, 0);
    }
    // Tractor beam: straight down to the ground below.
    const beaming = input.buttons[2];
    const top = this.pos.clone();
    top.y -= this.bottom;
    const ground = mgr.groundBelow(top.x, top.y - 0.5, top.z);
    const radius = Math.max(2.5, this.radius * 0.8) + Math.min(6, (top.y - ground) * 0.12);
    this.beam.set(beaming && top.y - ground < 90, top, ground, radius);
    if (this.beam.on && this.beam.strength > 0.5) {
      const took = mgr.mobs.beamLift(this.beam, BEAM_LIFT * (st.beamBoost ?? 1), top.y - 0.5);
      for (const mob of took) this._abducted(mob);
      if (this.cfg.beamBlocks) this._liftBlocks(dt, top, ground, radius);
    }
  }

  // The sweeping beam: a continuous red laser from the belly to whatever is
  // under the crosshair, burning what it touches, for a few seconds before
  // it has to cool down.
  _updateSweep(dt, held) {
    const mgr = this.manager;
    const g = this.gun;
    const st = this.pilotStyle;
    if (g.overheated) {
      g.heat = Math.max(0, g.heat - dt / st.cool);
      if (g.heat <= 0) g.overheated = false;
    }
    const on = held && !g.overheated;
    if (!on) {
      if (!g.overheated) g.heat = Math.max(0, g.heat - dt / st.cool);
      if (g.beam) g.beam.visible = false;
      return;
    }
    g.heat = Math.min(1, g.heat + dt / st.heat);
    if (g.heat >= 1) {
      g.overheated = true;
      mgr.onMessage?.("Beam overheated: let it cool");
    }
    const from = _feet.copy(this.pos);
    from.y -= this.bottom * 0.8;
    const dir = this._aim.clone().sub(from);
    let len = dir.length();
    if (len < 1e-3) return;
    dir.divideScalar(len);
    len = Math.min(600, len + 20);
    const wall = mgr.world.raycast(from, dir, len, { solidOnly: true });
    if (wall) len = wall.distance;
    // What it touches first: a UFO, an aircraft or a creature.
    const uh = mgr.ufos?.raycast(from, dir, len, (u) => u.state !== "gone");
    const vh = mgr.raycast(from, dir, uh ? uh.distance : len, this);
    const mh = mgr.mobs.raycast(from, dir, vh ? vh.distance : uh ? uh.distance : len);
    const stop = mh ? mh.distance : vh ? vh.distance : uh ? uh.distance : len;
    const end = from.clone().addScaledVector(dir, stop);
    if (!g.beam) {
      g.beam = mgr.ufos._sweepMesh();
      mgr.scene.add(g.beam);
    }
    const col = LASER_COLORS.red;
    const width = 0.2 + this.radius * 0.012;
    g.beam.visible = true;
    g.beam.position.copy(from);
    g.beam.lookAt(end);
    g.beam.scale.set(width, width, Math.max(0.5, stop));
    g.beam.material.color.copy(col).multiplyScalar(0.3).addScalar(1.2);
    g.beam.children[0].material.color.copy(col);
    const fx = mgr.effects;
    fx.glow.spawn({ x: end.x, y: end.y, z: end.z, life: 0.08, size0: 1.3, size1: 0.3, color0: col, alpha: 0.8 });
    g.tickT -= dt;
    if (g.tickT > 0) return;
    g.tickT = 0.1;
    const dmg = Math.max(1, Math.round(st.damage * this.power * 0.1));
    if (mh) mgr.mobs.shoot(mh.mob, dmg, dir, 1);
    else if (vh) vh.vehicle.damage(dmg, "player", true);
    else if (uh) mgr.ufos.damage(uh.ufo, dmg, true, end);
    else if (wall && mgr.lasers?.decals && mgr.world.getChunk(wall.block[0] >> 4, wall.block[2] >> 4)) mgr.lasers.decals.add(end, wall.block, wall.normal);
    if (!this._sweepSoundT || this.time - this._sweepSoundT > 1.5) {
      this._sweepSoundT = this.time;
      mgr.audio?.playUfoShot?.("sweep", 0);
    }
  }

  // Reload / charge / heat of the weapon, 0-1 (1 = ready), for the HUD.
  get weaponReady() {
    const st = this.pilotStyle;
    const g = this.gun;
    if (st.beam) return 1 - g.heat;
    if (g.charge > 0) return Math.min(1, g.charge / st.charge);
    const total = st.reload + (st.shots ? st.shots * st.gap : 0);
    return 1 - g.t / total;
  }

  // ---------- Ghost mode (G) ----------

  // Switches ghost mode (flying through terrain, burning a tunnel) on or off
  // while piloting. Off is refused while the ship is inside solid ground
  // (it would be stuck): fly out into the open first.
  _toggleGhost() {
    const mgr = this.manager;
    const on = !this.cfg.ghost;
    if (!on && this._embedded()) {
      mgr.onMessage?.("Ghost mode stays on: you are inside the ground. Fly out first (G).");
      return;
    }
    if (mgr.onGhostToggle) mgr.onGhostToggle(on);
    else mgr.config.ufo.ghost = on;
    this._carved = null;
    mgr.onMessage?.(on ? "GHOST MODE ON: the ship burns through terrain (G to switch off)" : "Ghost mode off");
  }

  // Is any part of the hull inside solid blocks?
  _embedded() {
    const w = this.manager.world;
    const r = Math.max(1, this.radius * 0.6);
    for (const [dx, dy, dz] of [[0, 0, 0], [r, 0, 0], [-r, 0, 0], [0, 0, r], [0, 0, -r], [0, -this.bottom * 0.8, 0], [0, this.bottom * 0.5, 0]]) {
      if (IS_SOLID[w.getBlock(Math.floor(this.pos.x + dx), Math.floor(this.pos.y + dy), Math.floor(this.pos.z + dz))]) return true;
    }
    return false;
  }

  // ---------- Teleport dash (R) ----------

  // A tap of R: the ship dashes a long way along the view at extreme speed
  // (it really travels there, in a fraction of a second, the camera riding
  // along), leaving a smear of fading copies of itself. Held: when that
  // dash is done it keeps streaking along the view (steer with the mouse)
  // for as long as R is held, with no distance limit. It stops short of
  // terrain in the way (unless in ghost mode). Settings > Vehicles: how far
  // (or off) and how long the tap's trip takes; the held speed follows them.
  get dashDistance() {
    const mult = this.cfg.dash ?? 1;
    // (A ship with a fast dash also goes farther on a tap.)
    return THREE.MathUtils.clamp(this.cruise * 1.6, 60, 700) * mult * Math.sqrt(this.dashMul);
  }

  // Speed of a dash (blocks/s): the settings' base, times this ship's own
  // dash factor (some ships are moderately fast, some extremely fast).
  get dashSpeed() {
    const time = Math.max(0.05, this.cfg.dashTime ?? 0.25);
    const v = THREE.MathUtils.clamp((this.dashDistance / Math.sqrt(this.dashMul) / time), DASH_SPEED[0], DASH_SPEED[1]) * this.dashMul;
    return this.cfg.ghost ? Math.min(v, DASH_GHOST_SPEED) : v;
  }

  // "Fast", "very fast" or "extreme", by this ship's dash factor.
  get dashClass() {
    const k = Math.log(this.dashMul / DASH_FACTOR[0]) / Math.log(DASH_FACTOR[1] / DASH_FACTOR[0]);
    return k < 0.34 ? "fast" : k < 0.67 ? "very fast" : "extreme";
  }

  // Is the ship (its underside) below the ground in a chunk that is not
  // loaded yet? (A long dash can outrun the world; it stops rather than
  // ending up inside terrain that loads under it.)
  _outrunsTerrain(pos) {
    const w = this.manager.world;
    const bx = Math.floor(pos.x);
    const bz = Math.floor(pos.z);
    if (w.getChunk(bx >> 4, bz >> 4)) return false;
    return pos.y - this.bottom < w.heightAt(bx, bz) + 3;
  }

  _dash(view) {
    const mgr = this.manager;
    if (this.dashT > 0 || this.liftOff > 0 || this.dashing) return;
    if ((this.cfg.dash ?? 1) <= 0) {
      mgr.onMessage?.("Teleport dash is off (Settings > Vehicles)");
      return;
    }
    this.dashT = DASH_COOLDOWN;
    const dist = this.dashDistance;
    const from = this.pos.clone();
    let d = dist;
    if (!this.cfg.ghost) {
      const hit = mgr.world.raycast(from, view, dist + this.radius, { solidOnly: true });
      if (hit) d = Math.max(0, hit.distance - this.radius - 1.5);
      // (Not into ground that has not loaded yet.)
      for (let k = 0; k < 8 && d > 3 && this._outrunsTerrain(_x1.copy(from).addScaledVector(view, d)); k++) d *= 0.7;
    }
    if (d < 3) {
      mgr.onMessage?.("No room to dash");
      this.dashT = 0.4;
      return;
    }
    const to = from.clone().addScaledVector(view, d);
    to.y = Math.max(1 + this.bottom, Math.min(250, to.y));
    this.dashing = { from, to, t: 0, dur: THREE.MathUtils.clamp(d / this.dashSpeed, 0.05, 1.2), last: from.clone(), cont: false, traveled: 0 };
    this._carved = null;
    mgr.audio?.playTeleport?.();
    mgr.effects.shake.add(0.2);
  }

  // The smear of hull copies between where the ship was and where it is.
  _dashSmear(from) {
    const trail = this.manager.ufos?.trail;
    const step = from.distanceTo(this.pos);
    if (!trail || step <= 0.5) return;
    this._place();
    const n = Math.min(10, Math.max(2, Math.round(step / Math.max(1.5, this.radius * 0.6))));
    const shade = this._ghostShade || (this._ghostShade = new THREE.Color());
    const day = 1 - (this.manager.night ?? 0) * 0.8;
    shade.setRGB(2.2 * day, 2.2 * day, 2.3 * day);
    trail.spawnPath(this.model.hull, from, this.pos, n, shade, 0.35);
  }

  _updateDash(dt, input = null) {
    const d = this.dashing;
    const mgr = this.manager;
    const holding = !!input && input.keys.has("KeyR") && (this.cfg.dash ?? 1) > 0;
    if (d.cont) {
      // Held: streaking along the view for as long as R is down.
      if (!holding) {
        this.dashing = null;
        this.vel.set(0, 0, 0);
        this.dashT = DASH_HOLD_COOLDOWN;
        return;
      }
      const view = this._viewDir(_w);
      let step = this.dashSpeed * dt;
      let blocked = false;
      if (!this.cfg.ghost) {
        const hit = mgr.world.raycast(this.pos, view, step + this.radius + 1.5, { solidOnly: true });
        if (hit) {
          step = Math.max(0, hit.distance - this.radius - 1.5);
          blocked = true;
        }
      }
      d.last.copy(this.pos);
      this.pos.addScaledVector(view, step);
      if (!this.cfg.ghost && this._outrunsTerrain(this.pos)) {
        // Ahead of the loaded world and heading into the ground: stop here.
        this.pos.copy(d.last);
        step = 0;
        blocked = true;
      }
      const lo = 1 + this.bottom;
      if (this.pos.y < lo || this.pos.y > 250) {
        this.pos.y = THREE.MathUtils.clamp(this.pos.y, lo, 250);
        blocked = blocked || step < 1;
      }
      d.traveled += step;
      this.vel.copy(view).multiplyScalar(step / Math.max(1e-4, dt));
      if (this.cfg.ghost) {
        this._burnTunnel(d.last, this.pos);
        this._carved = this.pos.clone();
      }
      this._dashSmear(d.last);
      if (blocked && step < 0.5) {
        this.dashing = null;
        this.vel.set(0, 0, 0);
        this.dashT = DASH_HOLD_COOLDOWN;
        mgr.onMessage?.("Dash stopped: terrain ahead");
      }
      return;
    }
    d.t += dt;
    const k = Math.min(1, d.t / d.dur);
    const e = k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2;
    this.pos.lerpVectors(d.from, d.to, e);
    this.vel.copy(d.to).sub(d.from).divideScalar(d.dur);
    this._dashSmear(d.last);
    d.last.copy(this.pos);
    if (k >= 1) {
      if (holding && d.to.distanceTo(d.from) >= this.dashDistance * 0.7) {
        // Still held: carry on streaking (no distance limit).
        d.cont = true;
        d.traveled = d.to.distanceTo(d.from);
        return;
      }
      this.dashing = null;
      this.vel.set(0, 0, 0);
    }
  }

  // (Kept for old callers: the dash no longer draws a light streak.)
  _updateDashFx() {}

  // ---------- Superweapon (B) ----------

  // Charges for a moment (the belly glows, a rising whine), then fires a
  // huge laser straight down that digs a shaft through the ground and
  // burns everything inside it.
  _startSuper() {
    const sw = this.sw;
    if (sw.state !== "idle") return;
    if (sw.cool > 0) {
      this.manager.onMessage?.(`Superweapon recharging (${Math.ceil(sw.cool)} s)`);
      return;
    }
    sw.state = "charge";
    sw.t = 0;
    this.manager.audio?.playSuperLaser?.(SUPER_CHARGE, SUPER_TIME);
    this.manager.onMessage?.("SUPERWEAPON CHARGING");
  }

  get superRadius() {
    return THREE.MathUtils.clamp(this.radius * 0.35, 3, 24);
  }

  _superMeshes() {
    const sw = this.sw;
    if (sw.mesh) return sw;
    const mgr = this.manager;
    const geo = new THREE.CylinderGeometry(1, 1, 1, 20, 1, true);
    const mk = (color, op) => new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color, transparent: true, opacity: op, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: false }));
    sw.mesh = new THREE.Group();
    sw.core = mk(new THREE.Color(8, 9, 10), 1);
    sw.halo = mk(new THREE.Color(1, 3, 7), 0.55);
    sw.mesh.add(sw.halo, sw.core);
    sw.mesh.visible = false;
    for (const m of [sw.mesh, sw.core, sw.halo]) m.frustumCulled = false;
    mgr.scene.add(sw.mesh);
    sw.orb = new THREE.Mesh(new THREE.SphereGeometry(1, 16, 10), new THREE.MeshBasicMaterial({ color: new THREE.Color(3, 6, 9), transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false, fog: false }));
    sw.orb.visible = false;
    sw.orb.frustumCulled = false;
    mgr.scene.add(sw.orb);
    return sw;
  }

  _updateSuper(dt, piloted) {
    const sw = this.sw;
    const mgr = this.manager;
    sw.cool = Math.max(0, sw.cool - dt);
    if (sw.state === "idle") {
      if (sw.mesh) {
        sw.mesh.visible = false;
        sw.orb.visible = false;
      }
      return;
    }
    if (!this.alive || (!piloted && sw.state === "charge")) {
      sw.state = "idle";
      return;
    }
    this._superMeshes();
    sw.t += dt;
    const top = this.pos.clone();
    top.y -= this.bottom;
    const R = this.superRadius;
    if (sw.state === "charge") {
      // A glowing orb gathers under the belly.
      const k = Math.min(1, sw.t / SUPER_CHARGE);
      sw.orb.visible = true;
      sw.orb.position.copy(top);
      sw.orb.scale.setScalar(R * (0.2 + 0.9 * k) * (0.9 + 0.1 * Math.sin(sw.t * 40)));
      if (Math.random() < 0.5) {
        const a = Math.random() * Math.PI * 2;
        const c = this._swC || (this._swC = new THREE.Color(1.5, 3.5, 6));
        mgr.effects.glow.spawn({ x: top.x + Math.cos(a) * R * 1.6, y: top.y - Math.random() * 3, z: top.z + Math.sin(a) * R * 1.6, vx: -Math.cos(a) * R * 1.4, vy: 0, vz: -Math.sin(a) * R * 1.4, life: 0.5, size0: 0.9, size1: 0.1, color0: c, alpha: 0.8 });
      }
      if (sw.t >= SUPER_CHARGE) {
        sw.state = "fire";
        sw.t = 0;
        sw.depth = 0;
        sw.cols = new Map(); // column -> the lowest y dug there so far
        sw.lastBottom = undefined;
        sw.hitT = 0;
        sw.floor = mgr.groundBelow(top.x, top.y - 0.5, top.z);
        mgr.effects.shake.add(0.6);
      }
      return;
    }
    // Firing: the beam from the belly down to the bottom of the shaft.
    sw.orb.visible = true;
    sw.orb.position.copy(top);
    sw.orb.scale.setScalar(R * 1.1);
    const groundTop = sw.floor ?? 0;
    sw.depth += SUPER_DIG_SPEED * dt;
    const bottomY = Math.max(1, groundTop - sw.depth);
    const flick = 0.92 + 0.08 * Math.sin(sw.t * 90);
    const fade = sw.t > SUPER_TIME - 0.5 ? Math.max(0, (SUPER_TIME - sw.t) / 0.5) : 1;
    const h = Math.max(1, top.y - bottomY);
    sw.mesh.visible = true;
    sw.mesh.position.set(top.x, (top.y + bottomY) / 2, top.z);
    sw.mesh.scale.set(1, h, 1); // the cylinders are unit-high along Y: the group stretches them to the beam's length
    sw.core.scale.set(R * 0.5 * flick * fade, 1, R * 0.5 * flick * fade);
    sw.halo.scale.set(R * 1.15 * fade, 1, R * 1.15 * fade);
    sw.core.material.opacity = fade;
    sw.halo.material.opacity = 0.55 * fade;
    // Dig: every column in the cylinder loses the blocks between the shaft depth reached.
    this._digShaft(top, R, bottomY);
    // Everything in the beam takes a beating.
    sw.hitT -= dt;
    if (sw.hitT <= 0) {
      sw.hitT = 0.12;
      this._superDamage(top, R, bottomY);
    }
    // Sparks and fire at the bottom.
    const fx = mgr.effects;
    const c = this._swFire || (this._swFire = [new THREE.Color(4, 3, 2), new THREE.Color(0.2, 0.19, 0.18), new THREE.Color(0.5, 0.48, 0.45)]);
    for (let i = 0; i < 5 * effectsQuality.scale; i++) {
      const a = Math.random() * Math.PI * 2;
      const rr = Math.random() * R;
      fx.glow.spawn({ x: top.x + Math.cos(a) * rr, y: bottomY + Math.random() * 2, z: top.z + Math.sin(a) * rr, vx: Math.cos(a) * 6, vy: 6 + Math.random() * 14, vz: Math.sin(a) * 6, life: 0.6, size0: 0.8, size1: 0.1, color0: c[0], gravity: 1, drag: 1 });
    }
    if (Math.random() < 0.5) fx.smoke.spawn({ x: top.x + (Math.random() - 0.5) * R, y: Math.min(top.y, bottomY + 2), z: top.z + (Math.random() - 0.5) * R, vx: 0, vy: 5 + Math.random() * 5, vz: 0, life: 2.5, size0: 2, size1: 8 + R * 0.5, color0: c[1], color1: c[2], alpha: 0.55, drag: 0.6 });
    fx.shake.add(0.03 * fade);
    if (sw.t >= SUPER_TIME) {
      sw.state = "idle";
      sw.cool = SUPER_COOLDOWN;
      sw.mesh.visible = false;
      sw.orb.visible = false;
    }
  }

  // Clears the cylinder under the ship: every solid block from the ship down
  // to the shaft depth reached so far, in every column it covers right now.
  // The laser keeps digging for its whole duration, so as the ship moves it
  // carves a trench along its path (a column new to the beam is cleared from
  // the top, a column it has been over only deeper as the shaft deepens).
  _digShaft(top, R, bottomY) {
    const w = this.manager.world;
    const sw = this.sw;
    const cols = sw.cols || (sw.cols = new Map());
    const yTop = Math.min(WORLD_HEIGHT - 1, Math.floor(top.y));
    const y0 = Math.max(1, Math.floor(bottomY));
    const cx = top.x;
    const cz = top.z;
    const ri = Math.ceil(R);
    const removed = [];
    const edits = [];
    for (let x = Math.floor(cx) - ri; x <= Math.floor(cx) + ri; x++) {
      for (let z = Math.floor(cz) - ri; z <= Math.floor(cz) + ri; z++) {
        const dx = x + 0.5 - cx;
        const dz = z + 0.5 - cz;
        if (dx * dx + dz * dz > R * R) continue;
        if (!w.getChunk(x >> 4, z >> 4)) continue;
        const key = x * 131071 + z;
        const last = cols.get(key);
        const from = last === undefined ? yTop : Math.min(yTop, last - 1);
        if (from < y0) continue;
        for (let y = from; y >= y0; y--) {
          const id = w.getBlock(x, y, z);
          if (!IS_SOLID[id] || id === BLOCK.BEDROCK) continue;
          removed.push(x, y, z, id);
          edits.push(x, y, z, BLOCK.AIR);
        }
        cols.set(key, y0);
      }
    }
    sw.lastBottom = Math.min(sw.lastBottom ?? yTop + 1, y0);
    if (edits.length) {
      w.setBlocks(edits);
      this.manager.effects.floodInto(removed);
    }
  }

  _superDamage(top, R, bottomY) {
    const mgr = this.manager;
    const out = [];
    for (const m of mgr.mobs.mobs) {
      if (m.dead) continue;
      if (Math.hypot(m.pos.x - top.x, m.pos.z - top.z) < R + 1.2 && m.pos.y < top.y && m.pos.y > bottomY - 2) out.push(m);
    }
    for (const m of out) mgr.mobs.shoot(m, 60, { x: 0, z: 0 }, 0);
    for (const u of mgr.ufos?.ufos ?? []) {
      if (u.state === "gone" || u.falling) continue;
      if (Math.hypot(u.pos.x - top.x, u.pos.z - top.z) < R + u.radius * 0.6 && u.pos.y < top.y && u.pos.y > bottomY - 5) mgr.ufos.damage(u, 90, true, u.pos);
    }
    for (const v of mgr.vehicles) {
      if (v === this || !v.alive) continue;
      if (Math.hypot(v.pos.x - top.x, v.pos.z - top.z) < R + v.radius * 0.5 && v.pos.y < top.y && v.pos.y > bottomY - 5) v.damage(120, "player", true);
    }
    // A blast ring where it meets the ground, now and then.
    if (Math.random() < 0.35) mgr.effects.explode(new THREE.Vector3(top.x, Math.max(bottomY + 2, 3), top.z), { radius: Math.min(9, 3 + R * 0.3), source: "ufocannon" });
  }

  // The vehicle info panel (I).
  infoPanel() {
    const cfg = this.cfg;
    const r = this.radius;
    return {
      title: `${this.name}: your UFO`,
      stats: [
        ["Design", `${UFO_DESIGN_NAMES[this.design] || "UFO"}, ${sizeName(r)} (${(r * 2).toFixed(0)} blocks across)`],
        ["Hull", `${Math.round(this.health)} / ${this.maxHealth}`],
        ["Cruise speed", `${cfg.minSpeed} to ${cfg.maxSpeed} blocks/s (mouse wheel), Ctrl boosts 3x`],
        ["Weapon", this._weaponText()],
        ["Teleport dash", (cfg.dash ?? 1) > 0 ? `R: streaks ~${Math.round(this.dashDistance)} blocks along the view at ${Math.round(this.dashSpeed)} blocks/s (this ship's dash is ${this.dashClass}); hold R to keep streaking, no distance limit; ${DASH_COOLDOWN} s cooldown; the base distance and speed are in Settings > Vehicles` : "off (Settings > Vehicles > Teleport dash distance)"],
        ["Superweapon", `B: charge ${SUPER_CHARGE} s, then a ${Math.round(this.superRadius * 2)}-block wide laser straight down for ${SUPER_TIME} s; ${SUPER_COOLDOWN} s cooldown`],
        ["Tractor beam", "hold RMB: lifts creatures (and loose blocks) into the ship"],
        ["Ghost mode", cfg.ghost ? "on: burns through terrain (G switches it off)" : "off (G switches it on; also in Settings > Vehicles)"],
      ],
      controls: [
        ["Mouse", "Look and steer"],
        ["W / S", "Fly along the view / back"],
        ["A / D", "Sideways"],
        ["Space / Shift", "Up / down"],
        ["Mouse wheel", "Cruising speed"],
        ["Ctrl", "Boost"],
        ["Left click", `${this.pilotStyle.name} (this ship's own weapon)`],
        ["Right click (hold)", "Tractor beam"],
        ["R", (cfg.dash ?? 1) > 0 ? "Teleport dash along the view (hold: keep streaking)" : "Teleport dash (off in Settings)"],
        ["B", "Superweapon: vertical laser (it carves a trench as the ship moves)"],
        ["G", "Ghost mode on / off"],
        ["F", "Get out"],
        ["F5", "Camera: chase / far / belly"],
        ["I", "This panel"],
      ],
    };
  }

  // One line about the ship's weapon (the I panel).
  _weaponText() {
    const st = this.pilotStyle;
    const dmg = Math.round(st.damage * this.power);
    const n = this.barrels;
    const from = n > 1 ? `, fired from ${n} points around the hull` : "";
    switch (this.style) {
      case "rapid":
      case "burst":
        return `${st.name}: ${st.shots} bolts of ${dmg} damage, ${st.reload} s between bursts${from}`;
      case "heavy":
        return `${st.name}: a slow ball of ${dmg} damage that explodes, every ${st.reload} s${from}`;
      case "spread":
        return `${st.name}: ${st.count} bolts of ${dmg} damage in a fan, every ${st.reload} s${from}`;
      case "charged":
        return `${st.name}: charges ${st.charge} s, then one very fast bolt of ${dmg} damage (it blasts); ${st.reload} s to recharge${from}`;
      case "sweep":
        return `${st.name}: hold for a continuous beam, ${dmg} damage a second to what it touches; ${st.heat} s before it overheats (${st.cool} s to cool)`;
      case "seeker":
        return `${st.name}: a homing ball of ${dmg} damage that blasts, at the UFO, aircraft or creature nearest the crosshair; every ${st.reload} s${from}`;
      default:
        return `${st.name}: ${dmg} damage, ${Math.round(1 / st.reload)} shots a second${from}${st.beamBoost ? "; a stronger tractor beam" : ""}`;
    }
  }

  // A creature pulled all the way up: it's "stored" (its drops go to the
  // player's inventory).
  _abducted(mob) {
    this.abducted++;
    const inv = this.manager.inventory;
    for (const [id, min, max, chance] of mob.spec.drops) {
      if (Math.random() > chance) continue;
      const n = min + Math.floor(Math.random() * (max - min + 1));
      if (n > 0) inv.add(id, n);
    }
    this.manager.onAbduct?.(mob);
    this.manager.onMessage?.(`Abducted: ${mob.spec.name}`);
  }

  // Loose surface blocks inside the beam are torn up and float into the ship.
  _liftBlocks(dt, top, ground, radius) {
    this._liftT -= dt;
    if (this._liftT > 0 || this.lifted.length >= MAX_LIFTED_BLOCKS) return;
    this._liftT = 0.35;
    const w = this.manager.world;
    const a = Math.random() * Math.PI * 2;
    const r = Math.sqrt(Math.random()) * radius * 0.85;
    const x = Math.floor(top.x + Math.cos(a) * r);
    const z = Math.floor(top.z + Math.sin(a) * r);
    const y = w.surfaceY(x, z);
    if (y < 1 || y >= top.y - 1) return;
    const id = w.getBlock(x, y, z);
    const info = BLOCK_INFO[id];
    if (!info || info.hardness < 0 || id === BLOCK.BEDROCK || !IS_SOLID[id]) return;
    if (!w.setBlock(x, y, z, BLOCK.AIR)) return;
    if (!this._blockMat) this._blockMat = createEntityMaterial("array", w.atlas);
    const mesh = new THREE.Mesh(blockCubeGeometry(id), this._blockMat);
    mesh.scale.setScalar(0.9);
    const item = { mesh, pos: new THREE.Vector3(x + 0.5, y + 0.5, z + 0.5), id, spin: Math.random() * 4 - 2, light: { sky: 15, block: 0 } };
    bindEntityLight(mesh, () => item.light);
    mesh.position.copy(item.pos);
    this.manager.scene.add(mesh);
    this.lifted.push(item);
  }

  _updateLifted(dt) {
    const top = this.pos.y - this.bottom;
    for (let i = this.lifted.length - 1; i >= 0; i--) {
      const b = this.lifted[i];
      b.pos.y += BEAM_LIFT * 1.2 * dt;
      b.pos.x += (this.pos.x - b.pos.x) * Math.min(1, dt * 0.8);
      b.pos.z += (this.pos.z - b.pos.z) * Math.min(1, dt * 0.8);
      b.mesh.position.copy(b.pos);
      b.mesh.rotation.x += b.spin * dt;
      b.mesh.rotation.y += b.spin * 0.7 * dt;
      if (b.pos.y >= top - 0.3 || !this.beam.on || !this.alive) {
        this.manager.scene.remove(b.mesh);
        b.mesh.geometry.dispose();
        this.lifted.splice(i, 1);
        // Into the hold: the block's drops go to the player.
        if (b.pos.y >= top - 0.3) for (const [itemId, n] of blockDrops(b.id, { type: "pickaxe", tier: 4, speed: 1 })) this.manager.inventory.add(itemId, n);
      }
    }
  }

  // ---------- Camera, HUD ----------

  updateCamera(camera, dt) {
    const mode = this.cameraModes[this.cameraMode];
    const view = this._viewDir(_v);
    camera.rotation.order = "YXZ";
    if (mode === "belly") {
      camera.position.set(this.pos.x, this.pos.y - this.bottom - 0.6, this.pos.z);
      camera.rotation.set(Math.min(this.camPitch, -0.2), this.camYaw, 0);
      return;
    }
    // Behind the ship and raised along the camera's own "up", so the ship
    // sits low on the screen and the line of sight through the crosshair
    // passes clear above it, whatever its size and however you pitch: what
    // you aim at is never hidden behind your own hull. (The raise is the
    // ship's extent across the view, which grows with the pitch for a flat
    // saucer seen from above or below, plus a margin.)
    const r = this.radius;
    const dist = (r * 2.3 + 6) * (mode === "far" ? 2.2 : 1);
    const p = this.camPitch;
    const sp = Math.sin(p);
    const cp = Math.cos(p);
    const camUp = _w.set(Math.sin(this.camYaw) * sp, cp, Math.cos(this.camYaw) * sp);
    const center = _feet.set(this.pos.x, this.pos.y + (this.info.h * 0.5 - this.info.bottom) * r, this.pos.z);
    const extent = this.info.h * 0.5 * r * Math.abs(cp) + r * Math.abs(sp);
    let raise = extent + 1.4 + r * 0.12;
    // Keep the camera out of the terrain (a ghost ship deep in a tunnel, a
    // low pass over a hill): first the raise, then the distance back.
    const w = this.manager.world;
    const up = w.raycast(center, camUp, raise + 0.6, { solidOnly: true });
    if (up) raise = Math.max(0.5, up.distance - 0.6);
    const pivot = center.clone().addScaledVector(camUp, raise);
    const back = view.clone().negate();
    let d = dist;
    const hit = w.raycast(pivot, back, dist, { solidOnly: true });
    if (hit) d = Math.max(r * 0.5, hit.distance - 0.6);
    camera.position.copy(pivot).addScaledVector(back, d);
    camera.rotation.set(p, this.camYaw, 0);
  }

  hud() {
    const mgr = this.manager;
    const speed = this.vel.length();
    const ground = mgr.groundBelow(this.pos.x, this.pos.y - this.bottom - 0.5, this.pos.z);
    const beam = this.beam.on ? "TRACTOR BEAM" : "";
    return {
      title: this.name,
      rows: [
        ["Speed", `${speed.toFixed(speed < 10 ? 1 : 0)} b/s (${Math.round(speed * 3.6)} km/h)`],
        ["Cruise", `${this.cruise.toFixed(this.cruise < 10 ? 1 : 0)} b/s`],
        ["Altitude", `${Math.round(this.pos.y)} (${Math.max(0, Math.round(this.pos.y - this.bottom - ground))} above ground)`],
        ["Ghost mode", this.cfg.ghost ? `<span class="vh-on">GHOST ON</span> (G: off)` : "off (G: on)"],
        ...(this.abducted ? [["Abducted", String(this.abducted)]] : []),
      ],
      bars: [
        { label: this.pilotStyle.beam ? `${this.pilotStyle.name} heat` : this.gun.charge > 0 ? "Charging" : this.pilotStyle.name, value: this.pilotStyle.beam ? this.gun.heat : this.weaponReady, hot: this.pilotStyle.beam ? this.gun.overheated || this.gun.heat > 0.75 : this.gun.charge > 0 },
        { label: (this.cfg.dash ?? 1) > 0 ? (this.dashing?.cont ? "DASHING (hold R)" : "Dash (R)") : "Dash (off)", value: (this.cfg.dash ?? 1) <= 0 ? 0 : this.dashing ? 1 : this.dashT > 0 ? 1 - this.dashT / (this.dashT > DASH_HOLD_COOLDOWN ? DASH_COOLDOWN : DASH_HOLD_COOLDOWN) : 1, hot: !!this.dashing },
        { label: "Superweapon (B)", value: this.sw.state === "charge" ? this.sw.t / SUPER_CHARGE : this.sw.state === "fire" ? 1 : this.sw.cool > 0 ? 1 - this.sw.cool / SUPER_COOLDOWN : 1, hot: this.sw.state !== "idle" },
      ],
      weapon: `LMB ${this.pilotStyle.name.toLowerCase()} · RMB tractor beam${beam ? ` · <span class="vh-on">${beam}</span>` : ""}`,
      health: this.health / this.maxHealth,
      help: "WASD move · Space/Shift up/down · Ctrl boost · wheel speed · R dash (hold: keep going) · B superweapon · G ghost mode · F5 camera · F leave · I info",
    };
  }

  // Blown up: a big explosion; the wreck is gone.
  onDestroyed(cause) {
    const fx = this.manager.effects;
    fx.explode(this.pos.clone(), { radius: Math.min(16, 4 + this.radius * 0.8), source: "ufo_boom" });
    this.root.visible = false;
    this.beam.set(false);
    if (this.gun.beam) this.gun.beam.visible = false;
    this.removeAt = 0.1;
  }

  serialize() {
    return { ...super.serialize(), design: this.design, spec: this.spec, style: this.style, wreck: this.wreck, radius: this.radius, yaw: Math.round(this.yaw * 100) / 100, crashed: this.crashed, downed: this.downed, tilt: [Math.round(this.tilt.x * 100) / 100, Math.round(this.tilt.z * 100) / 100] };
  }

  dispose() {
    super.dispose();
    this.onDestroyedCleanup();
    this.beam.dispose();
    for (const b of this.lifted) this.manager.scene.remove(b.mesh);
    this.model.dispose();
  }
}

VehicleManager.register("ufo", PilotUfo);
