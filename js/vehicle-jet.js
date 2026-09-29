// The fighter jet: an F-22-style stealth fighter (jet-model.js) on the
// shared vehicle framework.
//
// Flight: throttle and thrust (afterburner on top), lift that grows with
// airspeed and angle of attack and collapses past the stall angle, drag,
// gravity, and pitch/roll/yaw rates that need airspeed to bite. It can't
// hover: slow down and it stalls and drops its nose. It takes off from the
// ground and lands on its gear (gently, level); hitting the terrain any
// other way destroys it (and the pilot, unless they ejected).
//
// Controls (flight assist, the default): the mouse moves where you want to
// fly (the crosshair) and the jet banks and pulls toward it by itself;
// W/S throttle, Shift afterburner, A/D roll, Q/E rudder, Space air brake.
// Without flight assist the mouse flies the stick directly (up/down pitch,
// left/right roll). Weapons: autocannon (left click), guided missiles
// (right click; they lock onto UFOs and creatures kept in front of the
// nose), and a nuclear bomb (B) on a drogue parachute. Views: chase and
// cockpit (F5). F on the ground gets out; in the air it ejects.
import * as THREE from "three";
import { Vehicle, VehicleManager } from "./vehicles.js";
import { createJetModel } from "./jet-model.js";
import { IS_SOLID, IS_WET } from "./blocks.js";
import { effectsQuality } from "./effects.js";
import { WORLD_HEIGHT } from "./constants.js";

export const JET_DEFAULTS = { maxSpeed: 160, accel: 1, turnRate: 1, stallSpeed: 42, assist: true, airborne: false };
const G = 14; // gravity on the jet (blocks/s^2)
const CL_SLOPE = 5; // lift coefficient per radian of angle of attack
const STALL_AOA = 0.3; // radians (~17 degrees)
const GEAR = 1.35; // center to wheels
const CANNON_RATE = 16;
const CANNON_DAMAGE = 5;
const MISSILE_COOLDOWN = 0.9;
const LOCK_TIME = 1.1; // seconds on target to lock
const LOCK_CONE = 0.24; // radians off the nose
const NUKE_COOLDOWN = 25;

const X = new THREE.Vector3(1, 0, 0);
const Y = new THREE.Vector3(0, 1, 0);
const _v = new THREE.Vector3();
const _w = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();

function clamp(v, a, b) {
  return v < a ? a : v > b ? b : v;
}

export class Jet extends Vehicle {
  // data: { pos, yaw, speed, throttle, airborne, health, q }
  constructor(manager, data = {}) {
    super(manager, { type: "jet", name: "F-22 Raptor", radius: 7.5, maxHealth: 160 });
    this.model = createJetModel(1);
    this.root.add(this.model.root);
    this.hitRadius = 5.5;
    this.cameraModes = ["chase", "cockpit"];
    if (Array.isArray(data.pos)) this.pos.fromArray(data.pos);
    else if (data.pos) this.pos.copy(data.pos);
    this.q = new THREE.Quaternion();
    if (Array.isArray(data.q) && data.q.length === 4 && data.q.every(Number.isFinite)) this.q.fromArray(data.q).normalize();
    else this.q.setFromAxisAngle(Y, Number(data.yaw) || 0);
    if (Number.isFinite(data.health)) this.health = Math.max(1, Math.min(this.maxHealth, data.health));
    this.throttle = Number.isFinite(data.throttle) ? data.throttle : 0;
    this.afterburner = false;
    this.brake = false;
    this.angVel = new THREE.Vector3(); // body rates: x pitch, y yaw, z roll
    this.onGround = !data.airborne;
    const fwd = this.forward(new THREE.Vector3());
    if (data.airborne || Number.isFinite(data.speed)) this.vel.copy(fwd).multiplyScalar(Number(data.speed) || 0);
    // Where the pilot wants to fly (flight assist): a direction, moved by the mouse.
    this.aimYaw = Math.atan2(-fwd.x, -fwd.z);
    this.aimPitch = Math.asin(clamp(fwd.y, -1, 1));
    this.camYaw = this.aimYaw;
    this.camPitch = this.aimPitch;
    this.camQ = this.q.clone(); // lagging chase camera (manual mode)
    this.time = 0;
    this.cannonT = 0;
    this.missileT = 0;
    this.nukeT = 0;
    this.rail = 1;
    this.lock = { target: null, progress: 0, locked: false, beepT: 0 };
    this.incoming = 0; // seconds of "incoming attack" warning left
    this.warnT = 0;
    this.stalled = false;
    this.missiles = [];
    this.bombs = [];
    this.keep = false;
    this._manualIn = new THREE.Vector2();
    this._place();
  }

  get cfg() {
    return this.manager.config.jet || JET_DEFAULTS;
  }

  get bottom() {
    return GEAR;
  }

  forward(out) {
    return out.set(0, 0, -1).applyQuaternion(this.q);
  }
  up(out) {
    return out.set(0, 1, 0).applyQuaternion(this.q);
  }
  right(out) {
    return out.set(1, 0, 0).applyQuaternion(this.q);
  }

  get speed() {
    return this.vel.length();
  }

  get airborne() {
    return !this.onGround;
  }

  seatPosition(out = new THREE.Vector3()) {
    return out.set(0, 0.8, -3.6).applyQuaternion(this.q).add(this.pos);
  }

  onEnter() {
    const fwd = this.forward(_v);
    this.aimYaw = Math.atan2(-fwd.x, -fwd.z);
    this.aimPitch = Math.asin(clamp(fwd.y, -1, 1));
    this.camQ.copy(this.q);
  }

  onExit() {
    this.lock.target = null;
    this.lock.progress = 0;
    this.lock.locked = false;
    this.afterburner = false;
    this.manager.audio?.setJetEngine?.(0, false, 0, false);
  }

  // ---------- Aerodynamics ----------

  _aero(dt, stick, input) {
    const cfg = this.cfg;
    const maxSpeed = Math.max(60, cfg.maxSpeed);
    const accel = 20 * cfg.accel;
    const vStall = Math.max(15, cfg.stallSpeed);
    const fwd = this.forward(new THREE.Vector3());
    const up = this.up(new THREE.Vector3());
    const right = this.right(new THREE.Vector3());
    const speed = this.vel.length();
    const vF = this.vel.dot(fwd);
    // Angle of attack (nose above the flight path = positive).
    const aoa = Math.atan2(-this.vel.dot(up), Math.max(1, vF));
    let cl = CL_SLOPE * aoa;
    const clMax = CL_SLOPE * STALL_AOA;
    this.stalled = false;
    if (Math.abs(aoa) > STALL_AOA) {
      cl = Math.sign(aoa) * clMax * Math.max(0.25, 1 - (Math.abs(aoa) - STALL_AOA) * 3);
      this.stalled = !this.onGround && speed > 3;
    }
    if (!this.onGround && speed < vStall * 0.95) this.stalled = true;
    // Lift: at the stall speed the best lift just holds the jet up.
    const kL = G / (clMax * vStall * vStall);
    const lift = kL * cl * Math.max(0, vF) * Math.max(0, vF);
    const liftDir = _v.copy(up);
    if (speed > 1) {
      const vd = _w.copy(this.vel).divideScalar(speed);
      liftDir.addScaledVector(vd, -liftDir.dot(vd)).normalize();
    }
    const acc = new THREE.Vector3().addScaledVector(liftDir, lift);
    // Thrust (the afterburner adds half again).
    // (A takeoff boost on the ground, so a ~60 block strip is enough.)
    const thrust = accel * this.throttle * (this.afterburner ? 1.55 : 1) * (this.onGround ? 1.4 : 1);
    acc.addScaledVector(fwd, thrust);
    // Drag: top speed with the afterburner lit is the max speed setting.
    const kD = (accel * 1.55) / (maxSpeed * maxSpeed);
    const drag = kD * speed * speed * (1 + 1.5 * cl * cl) * (this.brake ? 3.5 : 1);
    if (speed > 0.01) acc.addScaledVector(this.vel, -drag / speed);
    acc.y -= G;
    this.vel.addScaledVector(acc, dt);
    // Sideslip dies out (the fin weathervanes the jet into the airflow).
    const side = this.vel.dot(right);
    this.vel.addScaledVector(right, -side * Math.min(1, dt * 2.5));
    // Control rates: they need airspeed to work.
    const authority = clamp(speed / (vStall * 1.4), 0.15, 1) * (this.stalled ? 0.5 : 1);
    const turn = cfg.turnRate;
    const target = new THREE.Vector3(stick.x * 1.25 * turn, stick.y * 0.55 * turn, stick.z * 3.2 * turn).multiplyScalar(authority);
    if (this.onGround) {
      target.z = 0; // no rolling on the runway
      target.y = stick.y * 0.5 * clamp(speed / 10, 0, 1); // nosewheel steering
      if (speed < vStall * 0.75) target.x = Math.min(target.x, 0) * 0; // can't rotate before takeoff speed
    }
    // A stalled jet drops its nose.
    if (this.stalled) target.x -= 0.6;
    this.angVel.lerp(target, Math.min(1, dt * 5));
    _e.set(this.angVel.x * dt, -this.angVel.y * dt, -this.angVel.z * dt, "XYZ");
    this.q.multiply(_q.setFromEuler(_e)).normalize();
    return { speed, aoa, vF };
  }

  // Flight assist: fly toward the aim direction (after the "mouse flight"
  // idea): pitch and yaw toward it, and bank into the turn when it's off to
  // the side, rolling wings-level as the nose comes onto it.
  _assistStick(out) {
    const aim = _v.set(-Math.sin(this.aimYaw) * Math.cos(this.aimPitch), Math.sin(this.aimPitch), -Math.cos(this.aimYaw) * Math.cos(this.aimPitch));
    const local = _w.copy(aim).applyQuaternion(_q.copy(this.q).invert());
    if (local.z > 0.2) {
      // Aiming behind: bank hard toward that side and pull around.
      // Bank about 60 degrees toward that side, then pull hard.
      const side = local.x >= 0 ? 1 : -1;
      const right = this.right(new THREE.Vector3());
      const roll = clamp((right.y + 0.85 * side) * 3, -1, 1);
      out.set(Math.abs(right.y) > 0.5 ? 1 : 0.3, side * 0.5, roll);
      return out;
    }
    const fwd = this.forward(new THREE.Vector3());
    const angleOff = fwd.angleTo(aim);
    const right = this.right(new THREE.Vector3());
    const aggressiveRoll = clamp(local.x * 3.5, -1, 1);
    const wingsLevel = clamp(right.y * 3, -1, 1);
    const k = clamp(angleOff / THREE.MathUtils.degToRad(12), 0, 1);
    const roll = wingsLevel + (aggressiveRoll - wingsLevel) * k;
    out.set(clamp(local.y * 3.2, -1, 1), clamp(local.x * 1.5, -1, 1), roll);
    return out;
  }

  update(dt, input) {
    super.update(dt, input);
    this.time += dt;
    if (!this.alive) {
      this._updateMissiles(dt);
      return;
    }
    const cfg = this.cfg;
    const stick = new THREE.Vector3();
    this.brake = false;
    if (input) {
      const k = input.keys;
      const sens = 0.0022 * (this.manager.mouseSensitivity ?? 1);
      const inv = this.manager.invertY ? -1 : 1;
      if (k.has("KeyW")) this.throttle = Math.min(1, this.throttle + dt * 0.6);
      if (k.has("KeyS")) this.throttle = Math.max(0, this.throttle - dt * 0.6);
      const shift = k.has("ShiftLeft") || k.has("ShiftRight");
      this.afterburner = shift && (!this.onGround || this.throttle > 0.5);
      if (this.afterburner) this.throttle = 1;
      this.brake = k.has("Space");
      if (cfg.assist) {
        this.aimYaw -= input.dx * sens;
        this.aimPitch = clamp(this.aimPitch - input.dy * sens * inv, -1.45, 1.45);
        this._assistStick(stick);
        // Assist also rotates for takeoff once there's flying speed.
        if (this.onGround && this.throttle > 0.5 && this.vel.length() > cfg.stallSpeed * 1.05) stick.x = Math.max(stick.x, 0.6);
      } else {
        // Direct stick: mouse up/down pitches, left/right rolls.
        this._manualIn.x += (clamp(-input.dy * sens * inv * 12, -1, 1) - this._manualIn.x) * Math.min(1, dt * 12);
        this._manualIn.y += (clamp(input.dx * sens * 12, -1, 1) - this._manualIn.y) * Math.min(1, dt * 12);
        stick.set(this._manualIn.x, 0, this._manualIn.y);
      }
      if (k.has("KeyA")) stick.z = -1;
      if (k.has("KeyD")) stick.z = 1;
      if (k.has("KeyQ")) stick.y = -1;
      if (k.has("KeyE")) stick.y = 1;
      if (this.onGround && !cfg.assist) stick.y += stick.z * 0.5;
      this._weapons(dt, input);
    } else if (this.onGround) {
      this.throttle = Math.max(0, this.throttle - dt);
      this.brake = true;
    } else {
      // Nobody at the controls (the pilot ejected): the engines spool down
      // and the nose drops until it hits the ground.
      this.throttle = Math.max(0, this.throttle - dt * 0.25);
      stick.set(-0.25, 0, clamp(this.right(new THREE.Vector3()).y * 2, -1, 1) * 0.3);
      if (this.pos.distanceTo(this.manager.player.position) > 2500) this._crash("crash");
    }
    const aero = this._aero(dt, stick, input);
    this._groundAndCrash(dt, aero);
    if (!this.alive) return;
    this.pos.addScaledVector(this.vel, dt);
    this._updateMissiles(dt);
    this.incoming = Math.max(0, this.incoming - dt);
    this._place();
    this.model.setThrottle(this.throttle, this.afterburner, this.time);
    if (input) this.manager.audio?.setJetEngine?.(this.throttle, this.afterburner, this.speed, true);
    // The lagging chase camera (manual mode) and aim follow the nose.
    this.camQ.slerp(this.q, Math.min(1, dt * 4));
    if (!cfg.assist) {
      const f = this.forward(_v);
      this.aimYaw = Math.atan2(-f.x, -f.z);
      this.aimPitch = Math.asin(clamp(f.y, -1, 1));
    }
    this.camYaw = this.aimYaw;
    this.camPitch = this.aimPitch;
  }

  // Wheels on the ground, gentle landings, and crashes.
  _groundAndCrash(dt, aero) {
    const mgr = this.manager;
    const w = mgr.world;
    const ground = mgr.groundBelow(this.pos.x, this.pos.y, this.pos.z);
    const fwd = this.forward(new THREE.Vector3());
    const up = this.up(new THREE.Vector3());
    const pitch = Math.asin(clamp(fwd.y, -1, 1));
    const roll = Math.asin(clamp(this.right(_v).y, -1, 1));
    const wheels = this.pos.y - GEAR;
    const bx = Math.floor(this.pos.x);
    const bz = Math.floor(this.pos.z);
    const water = IS_WET[w.getBlock(bx, Math.floor(wheels), bz)];
    if (this.onGround) {
      // Rolling: on the wheels, level, with rolling friction and brakes.
      if (water) return this._crash("crash");
      const liftingOff = this.vel.y > 0.5 && aero.speed > this.cfg.stallSpeed * 0.9;
      if (!liftingOff) {
        const vy = Math.max(0, this.vel.y); // lift building up for the take-off
        this.pos.y = ground + GEAR;
        const fr = this.brake ? 12 : 0.6;
        const sp = Math.hypot(this.vel.x, this.vel.z);
        if (sp > 0) {
          const k = Math.max(0, sp - fr * dt) / sp;
          this.vel.x *= k;
          this.vel.z *= k;
        }
        // Keep the wings level and the nose between level and a take-off pitch.
        const yaw = Math.atan2(-fwd.x, -fwd.z);
        const p = clamp(pitch, 0, 0.3);
        this.q.setFromEuler(_e.set(p, yaw, 0, "YXZ"));
        // Roll along the nose on the runway.
        const along = Math.max(0, this.vel.dot(fwd));
        this.vel.set(fwd.x, 0, fwd.z).normalize().multiplyScalar(along);
        this.vel.y = vy;
      } else {
        this.onGround = false;
      }
      if (this.pos.y - GEAR > ground + 0.3) this.onGround = false;
    } else if (wheels <= ground + 0.05 || water) {
      // Touchdown: gentle, level and wheels first, or a crash.
      const gentle = this.vel.y > -7 && pitch > -0.12 && pitch < 0.4 && Math.abs(roll) < 0.3 && !water && aero.speed < this.cfg.maxSpeed * 0.8;
      if (!gentle) return this._crash("crash");
      this.onGround = true;
      this.pos.y = ground + GEAR;
      this.vel.y = 0;
      this.manager.audio?.playLanding?.();
    }
    // Any other part of the airframe hitting the terrain: nose, wingtips, tails.
    const right = this.right(_w);
    const probes = [
      [fwd, 7.4],
      [fwd, 3],
    ];
    const pts = probes.map(([d, l]) => this.pos.clone().addScaledVector(d, l));
    pts.push(this.pos.clone().addScaledVector(right, 6.2), this.pos.clone().addScaledVector(right, -6.2));
    pts.push(this.pos.clone().addScaledVector(fwd, -6).addScaledVector(up, 2.2));
    pts.push(this.pos.clone().addScaledVector(up, this.onGround ? 1.2 : -0.6));
    for (const p of pts) {
      if (p.y < 0 || p.y >= WORLD_HEIGHT) continue;
      if (IS_SOLID[w.getBlock(Math.floor(p.x), Math.floor(p.y), Math.floor(p.z))]) {
        if (this.speed > 8) return this._crash("crash");
        this.vel.multiplyScalar(0.2);
        return;
      }
    }
  }

  _crash(cause) {
    this.lastHitBy = cause;
    this.manager.destroy(this, cause);
  }

  // ---------- Weapons ----------

  _weapons(dt, input) {
    const mgr = this.manager;
    this.cannonT = Math.max(0, this.cannonT - dt);
    this.missileT = Math.max(0, this.missileT - dt);
    this.nukeT = Math.max(0, this.nukeT - dt);
    const fwd = this.forward(new THREE.Vector3());
    const right = this.right(new THREE.Vector3());
    // Autocannon: rapid fire with tracers.
    if ((input.buttons[0] || input.pressed.has("mouse0")) && this.cannonT <= 0) {
      this.cannonT = 1 / CANNON_RATE;
      const from = this.pos.clone().addScaledVector(fwd, 6.6).addScaledVector(right, 0.9).addScaledVector(this.up(_v), 0.35);
      const dir = fwd.clone();
      dir.x += (Math.random() - 0.5) * 0.008;
      dir.y += (Math.random() - 0.5) * 0.008;
      dir.z += (Math.random() - 0.5) * 0.008;
      dir.normalize();
      mgr.lasers.fire({ from, dir, color: this._tracer || (this._tracer = new THREE.Color(5, 3.4, 1.1)), speed: 700 + Math.max(0, this.vel.dot(fwd)), damage: CANNON_DAMAGE, owner: "jet", source: this, range: 1100, radius: 0.07, length: 9, scorch: true, sound: false });
      mgr.audio?.playCannon?.();
      mgr.effects.glow.spawn({ x: from.x, y: from.y, z: from.z, life: 0.05, size0: 1.4, size1: 0.3, color0: this._tracer, alpha: 0.9 });
    }
    this._updateLock(dt, fwd);
    // Missiles: guided when locked, straight ahead otherwise.
    if ((input.buttons[2] || input.pressed.has("mouse2")) && this.missileT <= 0) {
      this.missileT = MISSILE_COOLDOWN;
      this._launchMissile(this.lock.locked ? this.lock.target : null);
    }
    // The nuke.
    if (input.pressed.has("KeyB") && this.nukeT <= 0) {
      this.nukeT = NUKE_COOLDOWN;
      this._dropNuke();
    }
  }

  // Lock-on: the best target inside a cone off the nose, held there for
  // LOCK_TIME (a beeping tone that speeds up, then a solid tone).
  _updateLock(dt, fwd) {
    const mgr = this.manager;
    const lock = this.lock;
    let best = null;
    let bestScore = LOCK_CONE;
    const eye = this.pos;
    for (const u of mgr.ufos?.ufos ?? []) {
      if (u.falling || u.state === "gone" || u.state === "leave") continue;
      const d = _v.copy(u.pos).sub(eye);
      const dist = d.length();
      if (dist > 1400) continue;
      const ang = d.divideScalar(dist).angleTo(fwd);
      if (ang < bestScore) {
        bestScore = ang;
        best = { kind: "ufo", ref: u };
      }
    }
    if (!best) {
      for (const m of mgr.mobs.mobs) {
        if (m.dead) continue;
        const d = _v.copy(m.pos).sub(eye);
        const dist = d.length();
        if (dist > 450 || dist < 10) continue;
        const ang = d.divideScalar(dist).angleTo(fwd);
        if (ang < bestScore * 0.8) {
          bestScore = ang;
          best = { kind: "mob", ref: m };
        }
      }
    }
    if (best && lock.target && best.ref === lock.target.ref) {
      lock.progress = Math.min(1, lock.progress + dt / LOCK_TIME);
    } else if (best) {
      lock.target = best;
      lock.progress = 0;
    } else {
      lock.progress = Math.max(0, lock.progress - dt * 2);
      if (lock.progress <= 0) lock.target = null;
    }
    const wasLocked = lock.locked;
    lock.locked = !!lock.target && lock.progress >= 1;
    if (lock.locked && lock.target.kind === "ufo") lock.target.ref.lockedOn = mgr.ufos.time;
    // Tones.
    lock.beepT -= dt;
    if (lock.target && lock.beepT <= 0) {
      lock.beepT = lock.locked ? 0.09 : 0.32 - lock.progress * 0.2;
      mgr.audio?.playLockTone?.(lock.locked);
    }
    if (lock.locked && !wasLocked) mgr.onMessage?.("LOCKED");
  }

  _targetPos(t, out) {
    if (t.kind === "ufo") return out.copy(t.ref.pos);
    return out.set(t.ref.pos.x, t.ref.pos.y + t.ref.spec.h * 0.5, t.ref.pos.z);
  }

  _targetAlive(t) {
    if (!t) return false;
    if (t.kind === "ufo") return !t.ref.falling && t.ref.state !== "gone";
    return !t.ref.dead && this.manager.mobs.mobs.includes(t.ref);
  }

  _launchMissile(target) {
    const mgr = this.manager;
    const fwd = this.forward(new THREE.Vector3());
    const right = this.right(new THREE.Vector3());
    this.rail = -this.rail;
    const pos = this.pos.clone().addScaledVector(right, this.rail * 2.4).addScaledVector(this.up(_v), -0.7);
    const mesh = new THREE.Mesh(this._missileGeo || (this._missileGeo = missileGeometry()), this._missileMat || (this._missileMat = new THREE.MeshLambertMaterial({ vertexColors: true })));
    mesh.castShadow = true;
    mgr.scene.add(mesh);
    const m = { pos, vel: this.vel.clone().addScaledVector(fwd, 12), dir: fwd.clone(), target, age: 0, mesh, trail: 0 };
    this.missiles.push(m);
    mgr.audio?.playRocketLaunch?.();
  }

  _updateMissiles(dt) {
    const mgr = this.manager;
    const fx = mgr.effects;
    for (let i = this.missiles.length - 1; i >= 0; i--) {
      const m = this.missiles[i];
      m.age += dt;
      const speed = Math.min(420, m.vel.length() + 260 * dt);
      // Guidance: lead pursuit, with a turn-rate limit.
      if (m.target && this._targetAlive(m.target) && m.age > 0.15) {
        const tp = this._targetPos(m.target, _v);
        const tv = m.target.kind === "ufo" ? m.target.ref.vel : m.target.ref.vel;
        const tgo = tp.distanceTo(m.pos) / Math.max(50, speed);
        const want = tp.addScaledVector(tv, tgo).sub(m.pos).normalize();
        const ang = m.dir.angleTo(want);
        const maxTurn = 3.2 * dt;
        if (ang > 1e-4) m.dir.lerp(want, Math.min(1, maxTurn / ang)).normalize();
      }
      m.vel.copy(m.dir).multiplyScalar(speed);
      const step = speed * dt;
      // Hits: the target (proximity fuse), any UFO, creatures, or terrain.
      let boom = null;
      let direct = null;
      if (m.target && this._targetAlive(m.target)) {
        const tp = this._targetPos(m.target, _w);
        const r = m.target.kind === "ufo" ? m.target.ref.radius * 0.8 + 2 : 2.2;
        if (tp.distanceTo(m.pos) < r + step) {
          boom = m.pos.clone().lerp(tp, 0.7);
          direct = m.target;
        }
      }
      if (!boom) {
        const uh = mgr.ufos?.raycast(m.pos, m.dir, step);
        if (uh) {
          boom = m.pos.clone().addScaledVector(m.dir, uh.distance);
          direct = { kind: "ufo", ref: uh.ufo };
        }
      }
      if (!boom) {
        const bh = mgr.world.raycast(m.pos, m.dir, step, { solidOnly: true });
        if (bh) boom = m.pos.clone().addScaledVector(m.dir, Math.max(0, bh.distance - 0.5));
      }
      if (!boom && m.age > 0.3 && mgr.mobs.sphereHit(m.pos, 1)) boom = m.pos.clone();
      if (boom || m.age > 14 || m.pos.y < -10) {
        mgr.scene.remove(m.mesh);
        this.missiles.splice(i, 1);
        if (boom) {
          if (direct?.kind === "ufo") {
            mgr.ufos.damage(direct.ref, 190, true, boom);
            mgr.onMissileHit?.(direct.ref);
          }
          fx.explode(boom, { radius: 5, source: "missile" });
        }
        continue;
      }
      m.pos.addScaledVector(m.dir, step);
      m.mesh.position.copy(m.pos);
      m.mesh.quaternion.setFromUnitVectors(_w.set(0, 0, -1), m.dir);
      // Smoke trail and a bright motor.
      const c = this._trailC || (this._trailC = [new THREE.Color(0.75, 0.73, 0.7), new THREE.Color(0.9, 0.89, 0.87), new THREE.Color(4, 2.4, 1)]);
      m.trail += step;
      const spacing = 1.6 / Math.max(0.35, effectsQuality.scale);
      while (m.trail > spacing) {
        m.trail -= spacing;
        const back = m.pos.clone().addScaledVector(m.dir, -m.trail - 1);
        fx.smoke.spawn({ x: back.x, y: back.y, z: back.z, vx: (Math.random() - 0.5) * 0.5, vy: 0.3, vz: (Math.random() - 0.5) * 0.5, life: 2.2 + Math.random(), size0: 0.5, size1: 2.4, color0: c[0], color1: c[1], alpha: 0.5, drag: 0.8 });
      }
      fx.glow.spawn({ x: m.pos.x - m.dir.x, y: m.pos.y - m.dir.y, z: m.pos.z - m.dir.z, life: 0.08, size0: 1.3, size1: 0.4, color0: c[2], alpha: 0.9 });
    }
    this._updateBombs(dt);
  }

  // The nuclear bomb: dropped with the jet's speed, slowed by a drogue
  // parachute (time to get clear), goes off on impact.
  _dropNuke() {
    const mgr = this.manager;
    const pos = this.pos.clone().addScaledVector(this.up(_v), -1.6);
    const group = new THREE.Group();
    const body = new THREE.Mesh(nukeGeometry(), this._missileMat || (this._missileMat = new THREE.MeshLambertMaterial({ vertexColors: true })));
    body.castShadow = true;
    group.add(body);
    const chute = new THREE.Mesh(new THREE.SphereGeometry(1.6, 12, 5, 0, Math.PI * 2, 0, Math.PI / 2.4), new THREE.MeshLambertMaterial({ color: 0xd8d2c0, side: THREE.DoubleSide }));
    chute.position.y = 3.2;
    chute.visible = false;
    group.add(chute);
    mgr.scene.add(group);
    this.bombs.push({ pos, vel: this.vel.clone(), group, chute, age: 0 });
    mgr.onMessage?.("NUKE AWAY! Get clear!");
    mgr.audio?.playWarning?.();
    mgr.onNukeDropped?.();
  }

  _updateBombs(dt) {
    const mgr = this.manager;
    for (let i = this.bombs.length - 1; i >= 0; i--) {
      const b = this.bombs[i];
      b.age += dt;
      b.vel.y -= 20 * dt;
      if (b.age > 0.8) {
        // Drogue chute: horizontal speed bleeds off, falls at ~18 blocks/s.
        b.chute.visible = true;
        b.vel.x *= Math.exp(-1.2 * dt);
        b.vel.z *= Math.exp(-1.2 * dt);
        b.vel.y = Math.max(b.vel.y, -18);
      }
      const len = b.vel.length() * dt;
      const dir = b.vel.clone().normalize();
      const hit = mgr.world.raycast(b.pos, dir, len + 0.5, { solidOnly: true });
      const water = IS_WET[mgr.world.getBlock(Math.floor(b.pos.x), Math.floor(b.pos.y), Math.floor(b.pos.z))];
      if (hit || water || b.pos.y < 1 || b.age > 60) {
        const at = hit ? b.pos.clone().addScaledVector(dir, hit.distance) : b.pos.clone();
        mgr.scene.remove(b.group);
        this.bombs.splice(i, 1);
        mgr.nuke?.detonate(at);
        continue;
      }
      b.pos.addScaledVector(b.vel, dt);
      b.group.position.copy(b.pos);
      b.group.rotation.set(0, b.age * 0.8, 0);
    }
  }

  // Seconds until the next nuke is ready (0 = ready).
  get nukeReady() {
    return this.nukeT;
  }

  // ---------- Camera, HUD ----------

  _place() {
    this.root.position.copy(this.pos);
    this.root.quaternion.copy(this.q);
    const l = this.manager.world.lightAt(this.pos.x, this.pos.y + 1, this.pos.z);
    this.model.light.sky = Math.max(l.sky, this.pos.y > 64 ? 15 : 0);
    this.model.light.block = l.block;
    if (this.hurtTime < 0.2) this.model.light.flash.setRGB(0.5 * (1 - this.hurtTime / 0.2), 0.05, 0);
    else this.model.light.flash.setRGB(0, 0, 0);
  }

  updateCamera(camera, dt) {
    const mode = this.cameraModes[this.cameraMode];
    this.model.canopy.visible = mode !== "cockpit";
    if (mode === "cockpit") {
      camera.position.set(0, 0.95, -3.4).applyQuaternion(this.q).add(this.pos);
      camera.quaternion.copy(this.q);
      return;
    }
    const cfg = this.cfg;
    camera.rotation.order = "YXZ";
    if (cfg.assist) {
      // Look where you're steering; the jet flies into that view.
      const aim = _v.set(-Math.sin(this.aimYaw) * Math.cos(this.aimPitch), Math.sin(this.aimPitch), -Math.cos(this.aimYaw) * Math.cos(this.aimPitch));
      camera.position.copy(this.pos).addScaledVector(aim, -24).add(_w.set(0, 5.5, 0));
      camera.rotation.set(this.aimPitch - 0.08, this.aimYaw, 0);
    } else {
      // Behind the jet, following its attitude with a little lag.
      const back = _v.set(0, 5, 24).applyQuaternion(this.camQ);
      camera.position.copy(this.pos).add(back);
      camera.quaternion.copy(this.camQ);
      camera.rotateX(-0.12);
    }
    // Never under the ground.
    const g = this.manager.groundBelow(camera.position.x, camera.position.y + 3, camera.position.z);
    if (camera.position.y < g + 1) camera.position.y = g + 1;
  }

  hud() {
    const mgr = this.manager;
    const speed = this.speed;
    const ground = mgr.groundBelow(this.pos.x, this.pos.y - GEAR, this.pos.z);
    const agl = Math.max(0, this.pos.y - GEAR - ground);
    const fwd = this.forward(_v);
    let heading = ((Math.atan2(fwd.x, -fwd.z) * 180) / Math.PI + 360) % 360;
    const card = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"][Math.round(heading / 45) % 8];
    const lock = this.lock;
    const lockText = lock.locked ? `<span class="vh-lock">LOCKED ${lock.target.kind === "ufo" ? "UFO" : lock.target.ref.spec.name.toUpperCase()}</span>` : lock.target ? `locking ${Math.round(lock.progress * 100)}%` : "no target";
    const warnings = [];
    if (this.stalled) warnings.push("STALL");
    if (!this.onGround && agl < 35 && this.vel.y < -12) warnings.push("PULL UP");
    if (this.incoming > 0) warnings.push("INCOMING ATTACK");
    if (this.health < this.maxHealth * 0.3) warnings.push("DAMAGE CRITICAL");
    return {
      title: this.name,
      rows: [
        ["Speed", `${Math.round(speed * 3.6)} km/h (${Math.round(speed)} b/s)`],
        ["Altitude", `${Math.round(this.pos.y)} (${Math.round(agl)} above ground)`],
        ["Throttle", `${Math.round(this.throttle * 100)}%${this.afterburner ? " AFTERBURNER" : ""}`],
        ["Heading", `${Math.round(heading)}° ${card}`],
        ["Missile", lockText],
        ["Nuke", this.nukeT > 0 ? `reloading ${Math.ceil(this.nukeT)} s` : "READY (B)"],
      ],
      weapon: "LMB cannon · RMB missile · B nuke",
      warning: warnings.join(" · "),
      health: this.health / this.maxHealth,
      help: `${this.cfg.assist ? "Mouse: steer" : "Mouse: stick"} · W/S throttle · Shift afterburner · A/D roll · Q/E rudder · Space brake · F ${this.onGround ? "get out" : "EJECT"} · F5 view`,
    };
  }

  // Screen-space things for the HUD overlay: the lock box on the target
  // and where the nose points (vs. the crosshair, where you steer).
  overlay(camera) {
    const out = { lock: null, nose: null };
    if (this.lock.target && this._targetAlive(this.lock.target)) {
      const p = this._targetPos(this.lock.target, new THREE.Vector3()).project(camera);
      if (p.z < 1) out.lock = { x: p.x, y: p.y, locked: this.lock.locked, progress: this.lock.progress };
    }
    const nose = this.forward(new THREE.Vector3()).multiplyScalar(400).add(this.pos).project(camera);
    if (nose.z < 1) out.nose = { x: nose.x, y: nose.y };
    return out;
  }

  onDestroyed(cause) {
    const fx = this.manager.effects;
    fx.explode(this.pos.clone(), { radius: 8, source: "jet_boom" });
    this.root.visible = false;
    this.removeAt = 0.2;
    this.manager.audio?.setJetEngine?.(0, false, 0, false);
    for (const m of this.missiles) this.manager.scene.remove(m.mesh);
    this.missiles.length = 0;
  }

  serialize() {
    return { ...super.serialize(), q: this.q.toArray().map((v) => Math.round(v * 10000) / 10000), throttle: Math.round(this.throttle * 100) / 100, speed: Math.round(this.speed * 10) / 10, airborne: !this.onGround };
  }

  dispose() {
    super.dispose();
    for (const m of this.missiles) this.manager.scene.remove(m.mesh);
    for (const b of this.bombs) this.manager.scene.remove(b.group);
  }
}

// A missile: white body, grey fins, dark seeker head (along -Z).
function missileGeometry() {
  const parts = [
    [new THREE.CylinderGeometry(0.16, 0.16, 2.6, 8).rotateX(Math.PI / 2), 0xe8e8e8],
    [new THREE.ConeGeometry(0.16, 0.5, 8).rotateX(-Math.PI / 2).translate(0, 0, -1.55), 0x2a2d33],
    [new THREE.BoxGeometry(0.7, 0.03, 0.4).translate(0, 0, 1.1), 0x8a8f96],
    [new THREE.BoxGeometry(0.03, 0.7, 0.4).translate(0, 0, 1.1), 0x8a8f96],
  ];
  return mergeColored(parts);
}

// The bomb: a fat dark-green body with a yellow band and four fins.
function nukeGeometry() {
  const parts = [
    [new THREE.CylinderGeometry(0.45, 0.45, 2.4, 12), 0x3b4a2c],
    [new THREE.SphereGeometry(0.45, 12, 8).translate(0, -1.2, 0), 0x3b4a2c],
    [new THREE.CylinderGeometry(0.46, 0.46, 0.18, 12).translate(0, -0.4, 0), 0xe0c020],
    [new THREE.BoxGeometry(1.3, 0.5, 0.05).translate(0, 1.3, 0), 0x2a3320],
    [new THREE.BoxGeometry(0.05, 0.5, 1.3).translate(0, 1.3, 0), 0x2a3320],
  ];
  return mergeColored(parts);
}

function mergeColored(parts) {
  const geos = parts.map(([g, hex]) => {
    const n = g.index ? g.toNonIndexed() : g;
    const c = new THREE.Color(hex);
    const col = new Float32Array(n.getAttribute("position").count * 3);
    for (let i = 0; i < col.length; i += 3) col.set([c.r, c.g, c.b], i);
    n.setAttribute("color", new THREE.BufferAttribute(col, 3));
    return n;
  });
  let count = 0;
  for (const g of geos) count += g.getAttribute("position").count;
  const pos = new Float32Array(count * 3);
  const nor = new Float32Array(count * 3);
  const col = new Float32Array(count * 3);
  let o = 0;
  for (const g of geos) {
    const k = g.getAttribute("position").count;
    pos.set(g.getAttribute("position").array, o * 3);
    nor.set(g.getAttribute("normal").array, o * 3);
    col.set(g.getAttribute("color").array, o * 3);
    o += k;
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  out.setAttribute("normal", new THREE.BufferAttribute(nor, 3));
  out.setAttribute("color", new THREE.BufferAttribute(col, 3));
  return out;
}

VehicleManager.register("jet", Jet);
