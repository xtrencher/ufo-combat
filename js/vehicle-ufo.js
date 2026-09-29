// The player's UFO: a crashed wreck boarded after a shoot-down (damaged but
// working, same shape), or one spawned from the Mods menu in Creative.
//
// No physics limits: it hovers perfectly still, moves instantly in any
// direction (W/S along the view, A/D sideways, Space/Shift up and down),
// and its cruising speed spans slow hovering to ludicrous (mouse wheel;
// Ctrl for a boost). Optional ghost mode flies through terrain, burning a
// tunnel. Weapons: a laser cannon (left click; big ships fire from several
// barrels, all aimed at what is under the crosshair), a tractor beam (hold
// right click) that lifts creatures, and optionally loose blocks, up into
// the ship, a teleport dash (R: a bright streak, then you are there) and a
// superweapon (B): after a short charge a huge laser straight down that
// burns a shaft through the ground and everything in it. Third-person chase
// camera (F5: chase / far / belly view).
import * as THREE from "three";
import { Vehicle, VehicleManager } from "./vehicles.js";
import { createUfoModel, designInfo, UFO_DESIGN_NAMES } from "./ufo-models.js";
import { TractorBeam } from "./tractor-beam.js";
import { LASER_COLORS } from "./lasers.js";
import { BLOCK, BLOCK_INFO, IS_SOLID } from "./blocks.js";
import { sweepAxis, boxInSolid } from "./physics.js";
import { blockDrops } from "./items.js";
import { blockCubeGeometry } from "./models.js";
import { createEntityMaterial, bindEntityLight } from "./shaders.js";
import { effectsQuality } from "./effects.js";
import { WORLD_HEIGHT } from "./constants.js";

export const UFO_SPEED_DEFAULTS = { minSpeed: 2, maxSpeed: 300, ghost: false, beamBlocks: true };
const CANNON_RATE = 6; // shots per second
const CANNON_DAMAGE = 16;
const CANNON_BLAST = 1.7;
const BEAM_LIFT = 6; // blocks per second
const MAX_LIFTED_BLOCKS = 12;
const DASH_COOLDOWN = 2.5;
const SUPER_CHARGE = 1.3; // seconds
const SUPER_TIME = 2.6; // seconds of beam
const SUPER_COOLDOWN = 15;
const SUPER_DIG_SPEED = 55; // blocks per second the shaft deepens

const _v = new THREE.Vector3();
const _w = new THREE.Vector3();
const _feet = new THREE.Vector3();

function sizeName(radius) {
  return radius < 5 ? "small" : radius < 9 ? "medium" : radius < 20 ? "large" : radius < 50 ? "mothership" : "giant";
}

export class PilotUfo extends Vehicle {
  // data: { spec | design, radius, pos, yaw, health, crashed, wreck, tilt }
  constructor(manager, data = {}) {
    const radius = Math.max(2.5, Math.min(80, Number(data.radius) || 5));
    super(manager, { type: "ufo", name: "UFO", radius, maxHealth: Math.round(120 + radius * 40) });
    this.spec = data.spec && data.spec.design ? { design: data.spec.design, seed: data.spec.seed | 0, glow: !!data.spec.glow } : { design: data.design || "saucer", seed: Number.isFinite(data.seed) ? data.seed : 0, glow: data.glow ?? !String(data.design || "").includes("dark") };
    this.design = this.spec.design;
    this.name = `${UFO_DESIGN_NAMES[this.design] || "UFO"} (${sizeName(radius)})`;
    this.model = createUfoModel(this.spec, radius);
    this.root.add(this.model.root);
    this.info = designInfo(this.spec);
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
    this.dashT = 0;
    this.dashFx = null; // the streak left by a dash
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
  }

  onDestroyedCleanup() {
    if (this.sw.mesh) this.manager.scene.remove(this.sw.mesh, this.sw.orb);
    if (this.dashFx) this.manager.scene.remove(this.dashFx.group);
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
      if (this.liftOff > 0) {
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
    } else if (this.crashed) {
      // A smoking wreck.
      this._smokeT -= dt;
      if (this._smokeT <= 0) {
        this._smokeT = 0.25;
        const c = this._smokeC || (this._smokeC = [new THREE.Color(0.12, 0.11, 0.1), new THREE.Color(0.4, 0.39, 0.37)]);
        this.manager.effects.smoke.spawn({ x: this.pos.x + (Math.random() - 0.5) * this.radius, y: this.pos.y + 0.5, z: this.pos.z + (Math.random() - 0.5) * this.radius, vx: 0, vy: 1.5 + Math.random(), vz: 0, life: 3 + Math.random() * 2, size0: 1, size1: 3 + this.radius * 0.3, color0: c[0], color1: c[1], alpha: 0.45, drag: 0.8 });
      }
    }
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
    m.lightsOn = this.crashed ? 0 : 1; // a wreck never glows: every light is off
    if (this.crashed) m.setDead(true);
    m.animate(this.time, { night, damage: 1 - this.health / this.maxHealth, beam: this.beam.strength, speed: this.vel.length() });
  }

  _place() {
    this.root.position.copy(this.pos);
    this.model.body.rotation.set(this.tilt.x, this.design === "diamond" ? this.model.body.rotation.y : this.yaw, this.tilt.z, "YXZ");
    const l = this.manager.world.lightAt(this.pos.x, this.pos.y + 1, this.pos.z);
    this.model.light.sky = Math.max(l.sky, this.crashed ? 0 : 10);
    this.model.light.block = l.block;
    if (this.hurtTime < 0.25) this.model.light.flash.setRGB(0.6 * (1 - this.hurtTime / 0.25), 0.05, 0);
    else this.model.light.flash.setRGB(0, 0, 0);
  }

  // ---------- Weapons ----------

  _weapons(dt, input) {
    const mgr = this.manager;
    this._cannonT = Math.max(0, this._cannonT - dt);
    // Aim: whatever the camera's centre ray hits first (terrain, a UFO, a
    // creature, a vehicle). Every barrel then fires at that point, so shots
    // from a huge ship converge on the crosshair instead of passing beside it.
    const cam = mgr.cameraRef;
    const eye = cam ? cam.position : this.pos;
    const dir = this._viewDir(_v).clone();
    let range = 500;
    const hit = mgr.world.raycast(eye, dir, range, { solidOnly: true });
    if (hit) range = hit.distance;
    const uh = mgr.ufos?.raycast(eye, dir, range, (u) => u.state !== "gone");
    if (uh) range = Math.min(range, uh.distance);
    const mh = mgr.mobs.raycast(eye, dir, range);
    if (mh) range = Math.min(range, mh.distance);
    const vh = mgr.raycast(eye, dir, range, this);
    if (vh) range = Math.min(range, vh.distance);
    // Nothing near: converge far out (the bolts are straight past that).
    this._aim.copy(eye).addScaledVector(dir, hit || uh || mh || vh ? range : 500);
    if ((input.buttons[0] || input.pressed.has("mouse0")) && this._cannonT <= 0) {
      this._cannonT = 1 / CANNON_RATE;
      const r = this.radius;
      // Bigger ships: more barrels, faster and fatter bolts.
      const barrels = r < 5 ? 1 : r < 9 ? 2 : r < 20 ? 3 : r < 50 ? 4 : 6;
      const speed = 170 + Math.min(220, r * 4);
      const boltR = 0.13 + Math.min(0.5, r * 0.01);
      this._barrel = ((this._barrel ?? -1) + 1) % barrels;
      const list = barrels > 2 ? [this._barrel, (this._barrel + Math.floor(barrels / 2)) % barrels] : [this._barrel];
      for (const b of list) {
        const a = (b / barrels) * Math.PI * 2 + this.yaw;
        const from = this.pos.clone();
        from.y -= this.bottom * 0.5;
        if (barrels > 1) {
          from.x += Math.cos(a) * r * 0.62;
          from.z += Math.sin(a) * r * 0.62;
        }
        const d = this._aim.clone().sub(from);
        if (d.lengthSq() < 1) d.copy(dir);
        d.normalize();
        // Never start inside the hull's own rim: step out along the shot.
        from.addScaledVector(d, Math.min(r * 0.35, 6));
        mgr.lasers.fire({ from, dir: d, color: LASER_COLORS.cyan, speed, damage: CANNON_DAMAGE, owner: "playerufo", source: this, range: 500 + Math.min(300, r * 6), radius: boltR, length: 3.2 + r * 0.06, blast: CANNON_BLAST * (1 + Math.min(1.5, r * 0.02)) });
      }
    }
    // Tractor beam: straight down to the ground below.
    const beaming = input.buttons[2];
    const top = this.pos.clone();
    top.y -= this.bottom;
    const ground = mgr.groundBelow(top.x, top.y - 0.5, top.z);
    const radius = Math.max(2.5, this.radius * 0.8) + Math.min(6, (top.y - ground) * 0.12);
    this.beam.set(beaming && top.y - ground < 90, top, ground, radius);
    if (this.beam.on && this.beam.strength > 0.5) {
      const took = mgr.mobs.beamLift(this.beam, BEAM_LIFT, top.y - 0.5);
      for (const mob of took) this._abducted(mob);
      if (this.cfg.beamBlocks) this._liftBlocks(dt, top, ground, radius);
    }
  }

  // ---------- Teleport dash (R) ----------

  // Jump a long way along the view in an instant: a bright streak marks the
  // path, and you arrive at its end (short of any terrain in the way, unless
  // in ghost mode).
  _dash(view) {
    const mgr = this.manager;
    if (this.dashT > 0 || this.liftOff > 0) return;
    this.dashT = DASH_COOLDOWN;
    const dist = THREE.MathUtils.clamp(this.cruise * 1.6, 60, 700);
    const from = this.pos.clone();
    let d = dist;
    if (!this.cfg.ghost) {
      const hit = mgr.world.raycast(from, view, dist + this.radius, { solidOnly: true });
      if (hit) d = Math.max(0, hit.distance - this.radius - 1.5);
    }
    if (d < 3) {
      mgr.onMessage?.("No room to dash");
      this.dashT = 0.4;
      return;
    }
    const to = from.clone().addScaledVector(view, d);
    to.y = Math.max(1 + this.bottom, Math.min(250, to.y));
    this.pos.copy(to);
    this._carved = null;
    this._streak(from, to);
    mgr.audio?.playTeleport?.();
    mgr.effects.shake.add(0.25);
    // A flash of light at both ends.
    const c = this._dashC || (this._dashC = new THREE.Color(1.6, 4.2, 6));
    for (const p of [from, to]) mgr.effects.glow.spawn({ x: p.x, y: p.y, z: p.z, life: 0.5, size0: this.radius * 2.6, size1: this.radius * 0.5, color0: c, alpha: 0.9 });
  }

  _streak(from, to) {
    const mgr = this.manager;
    if (!this.dashFx) {
      const geo = new THREE.CylinderGeometry(1, 1, 1, 12, 1, true).rotateX(Math.PI / 2);
      const mk = (color, op) => {
        const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color, transparent: true, opacity: op, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: false }));
        m.frustumCulled = false;
        return m;
      };
      const group = new THREE.Group();
      const core = mk(new THREE.Color(5, 8, 10), 1);
      const halo = mk(new THREE.Color(0.5, 2.2, 5), 0.6);
      group.add(halo, core);
      mgr.scene.add(group);
      this.dashFx = { group, core, halo, age: 99, w: 1 };
    }
    const fx = this.dashFx;
    const len = from.distanceTo(to);
    fx.group.position.copy(from).add(to).multiplyScalar(0.5);
    fx.group.lookAt(to);
    fx.group.scale.set(1, 1, len);
    fx.w = Math.max(0.5, this.radius * 0.45);
    fx.age = 0;
    fx.group.visible = true;
  }

  _updateDashFx(dt) {
    const fx = this.dashFx;
    if (!fx || !fx.group.visible) return;
    fx.age += dt;
    const k = fx.age / 0.7;
    if (k >= 1) {
      fx.group.visible = false;
      return;
    }
    const fade = (1 - k) * (1 - k);
    fx.core.material.opacity = fade;
    fx.halo.material.opacity = 0.6 * fade;
    fx.core.scale.x = fx.core.scale.y = fx.w * 0.35 * (1 - k * 0.8);
    fx.halo.scale.x = fx.halo.scale.y = fx.w * (1 + k * 1.2);
  }

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
    this._digShaft(top, R, groundTop, bottomY);
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

  // Clears the cylinder of every solid block between the ship and the shaft
  // bottom reached so far (only the newly reached depths after the first frame).
  _digShaft(top, R, groundTop, bottomY) {
    const w = this.manager.world;
    const sw = this.sw;
    const yTop = Math.min(WORLD_HEIGHT - 1, Math.floor(top.y), Math.floor(groundTop + 40));
    const from = Math.min(yTop, (sw.lastBottom ?? yTop + 1) - 1);
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
        for (let y = from; y >= y0; y--) {
          const id = w.getBlock(x, y, z);
          if (!IS_SOLID[id] || id === BLOCK.BEDROCK) continue;
          removed.push(x, y, z, id);
          edits.push(x, y, z, BLOCK.AIR);
        }
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
        ["Laser cannon", `${CANNON_RATE} shots/s, ${CANNON_DAMAGE} damage + blast; ${r < 5 ? 1 : r < 9 ? 2 : r < 20 ? 3 : r < 50 ? 4 : 6} barrels, all aimed at the crosshair`],
        ["Teleport dash", `R: jump ~${Math.round(THREE.MathUtils.clamp(this.cruise * 1.6, 60, 700))} blocks along the view; ${DASH_COOLDOWN} s cooldown`],
        ["Superweapon", `B: charge ${SUPER_CHARGE} s, then a ${Math.round(this.superRadius * 2)}-block wide laser straight down for ${SUPER_TIME} s; ${SUPER_COOLDOWN} s cooldown`],
        ["Tractor beam", "hold RMB: lifts creatures (and loose blocks) into the ship"],
        ["Ghost mode", cfg.ghost ? "on: burns through terrain" : "off (Mods menu)"],
      ],
      controls: [
        ["Mouse", "Look and steer"],
        ["W / S", "Fly along the view / back"],
        ["A / D", "Sideways"],
        ["Space / Shift", "Up / down"],
        ["Mouse wheel", "Cruising speed"],
        ["Ctrl", "Boost"],
        ["Left click", "Laser cannon"],
        ["Right click (hold)", "Tractor beam"],
        ["R", "Teleport dash"],
        ["B", "Superweapon: vertical laser"],
        ["F", "Get out"],
        ["F5", "Camera: chase / far / belly"],
        ["I", "This panel"],
      ],
    };
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
    const dist = (this.radius * 2.3 + 6) * (mode === "far" ? 2.2 : 1);
    const target = this.pos.clone().add(new THREE.Vector3(0, this.radius * 0.35 + 1.5, 0));
    // Keep the camera out of the terrain (a ghost ship deep in a tunnel).
    const back = view.clone().negate();
    let d = dist;
    const hit = this.manager.world.raycast(target, back, dist, { solidOnly: true });
    if (hit) d = Math.max(this.radius * 0.5, hit.distance - 0.6);
    camera.position.copy(target).addScaledVector(back, d);
    camera.rotation.set(this.camPitch, this.camYaw, 0);
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
        ["Ghost mode", this.cfg.ghost ? "ON: burns through terrain" : "off"],
        ...(this.abducted ? [["Abducted", String(this.abducted)]] : []),
      ],
      bars: [
        { label: "Dash (R)", value: this.dashT > 0 ? 1 - this.dashT / DASH_COOLDOWN : 1 },
        { label: "Superweapon (B)", value: this.sw.state === "charge" ? this.sw.t / SUPER_CHARGE : this.sw.state === "fire" ? 1 : this.sw.cool > 0 ? 1 - this.sw.cool / SUPER_COOLDOWN : 1, hot: this.sw.state !== "idle" },
      ],
      weapon: `LMB laser cannon · RMB tractor beam${beam ? ` · <span class="vh-on">${beam}</span>` : ""}`,
      health: this.health / this.maxHealth,
      help: "WASD move · Space/Shift up/down · Ctrl boost · wheel speed · R dash · B superweapon · F5 camera · F leave · I info",
    };
  }

  // Blown up: a big explosion; the wreck is gone.
  onDestroyed(cause) {
    const fx = this.manager.effects;
    fx.explode(this.pos.clone(), { radius: Math.min(16, 4 + this.radius * 0.8), source: "ufo_boom" });
    this.root.visible = false;
    this.beam.set(false);
    this.removeAt = 0.1;
  }

  serialize() {
    return { ...super.serialize(), design: this.design, spec: this.spec, wreck: this.wreck, radius: this.radius, yaw: Math.round(this.yaw * 100) / 100, crashed: this.crashed, tilt: [Math.round(this.tilt.x * 100) / 100, Math.round(this.tilt.z * 100) / 100] };
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
