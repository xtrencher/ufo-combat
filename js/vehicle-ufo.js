// The player's UFO: a crashed wreck boarded after a shoot-down (damaged but
// working, same shape), or one spawned from the Mods menu in Creative.
//
// No physics limits: it hovers perfectly still, moves instantly in any
// direction (W/S along the view, A/D sideways, Space/Shift up and down),
// and its cruising speed spans slow hovering to ludicrous (mouse wheel;
// Ctrl for a boost). Optional ghost mode flies through terrain, burning a
// tunnel. Weapons: a laser cannon (left click) and a tractor beam (hold
// right click) that lifts creatures, and optionally loose blocks, up into
// the ship. Third-person chase camera (F5: chase / far / belly view).
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

const _v = new THREE.Vector3();
const _w = new THREE.Vector3();
const _feet = new THREE.Vector3();

function sizeName(radius) {
  return radius < 5 ? "small" : radius < 9 ? "medium" : radius < 20 ? "large" : "mothership";
}

export class PilotUfo extends Vehicle {
  // data: { design, radius, pos, yaw, health, crashed }
  constructor(manager, data = {}) {
    const radius = Math.max(2.5, Math.min(45, Number(data.radius) || 5));
    super(manager, { type: "ufo", name: "UFO", radius, maxHealth: Math.round(120 + radius * 40) });
    this.design = data.design || "saucer";
    this.name = `${UFO_DESIGN_NAMES[this.design] || "UFO"} (${sizeName(radius)})`;
    this.model = createUfoModel(this.design, radius);
    this.root.add(this.model.root);
    this.info = designInfo(this.design);
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
    this.keep = true; // the player's ship is never cleaned up as clutter
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
      // Lifting out of the crater.
      this.crashed = false;
      this.boardedWreck = true;
      // Rise straight out of the crater first (clear of its rim).
      this.liftOff = this.radius * 0.5 + 5;
      this.manager.onMessage?.("The wreck still flies! Damaged, but working.");
    }
  }

  onExit() {
    this.beam.set(false);
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
    m.lightsOn = this.crashed ? (Math.sin(this.time * 9) > 0.6 ? 0.4 : 0.05) : 1;
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
    // Aim: whatever the camera's center ray hits.
    const cam = mgr.cameraRef;
    const eye = cam ? cam.position : this.pos;
    const dir = this._viewDir(_v).clone();
    const hit = mgr.world.raycast(eye, dir, 400, { solidOnly: true });
    this._aim.copy(eye).addScaledVector(dir, hit ? hit.distance : 400);
    if ((input.buttons[0] || input.pressed.has("mouse0")) && this._cannonT <= 0) {
      this._cannonT = 1 / CANNON_RATE;
      const from = this.pos.clone();
      from.y -= this.bottom * 0.6;
      const d = this._aim.clone().sub(from);
      if (d.lengthSq() < 1) d.copy(dir);
      d.normalize();
      from.addScaledVector(d, this.radius * 0.9);
      mgr.lasers.fire({ from, dir: d, color: LASER_COLORS.cyan, speed: 170, damage: CANNON_DAMAGE, owner: "playerufo", source: this, range: 420, radius: 0.13, length: 3.2, blast: CANNON_BLAST });
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
      weapon: `LMB laser cannon · RMB tractor beam${beam ? ` · <span class="vh-on">${beam}</span>` : ""}`,
      health: this.health / this.maxHealth,
      help: "WASD move · Space/Shift up/down · Ctrl boost · wheel speed · F5 camera · F leave",
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
    return { ...super.serialize(), design: this.design, radius: this.radius, yaw: Math.round(this.yaw * 100) / 100, crashed: this.crashed, tilt: [Math.round(this.tilt.x * 100) / 100, Math.round(this.tilt.z * 100) / 100] };
  }

  dispose() {
    super.dispose();
    this.beam.dispose();
    for (const b of this.lifted) this.manager.scene.remove(b.mesh);
    this.model.dispose();
  }
}

VehicleManager.register("ufo", PilotUfo);
