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
// Takeoff is a real ground roll: the jet accelerates on its wheels (much
// faster with the afterburner), rotates its nose at about the stall speed
// and leaves the ground once the wings carry it; the gear folds away, and
// comes down again for landing. Runways (airports) make this easy.
//
// Controls (flight assist, the default): the mouse moves where you want to
// fly (the crosshair) and the jet banks and pulls toward it by itself;
// W/S throttle, Shift afterburner, A/D roll, Q/E rudder, Space air brake.
// Without flight assist the mouse flies the stick directly (up/down pitch,
// left/right roll). Weapons: autocannon (left click; aims a little for you
// and overheats if you hold it too long), guided missiles (hold right
// click: the target nearest the centre of the view, even behind you, is
// locked in about a second for one missile, three seconds for a salvo of
// four), flares (C) that fool missiles and seeking shots, and a nuclear
// bomb (B) on a drogue parachute. A warning shows where missiles are
// coming from. Views: chase and cockpit (F5). F on the ground gets out;
// in the air it ejects.
import * as THREE from "three";
import { Vehicle, VehicleManager } from "./vehicles.js";
import { createJetModel } from "./jet-model.js";
import { IS_SOLID, IS_WET } from "./blocks.js";
import { effectsQuality } from "./effects.js";
import { WORLD_HEIGHT } from "./constants.js";

export const JET_DEFAULTS = { maxSpeed: 160, accel: 1, turnRate: 1, stallSpeed: 42, assist: true, airborne: false, aimAssist: true };
const G = 14; // gravity on the jet (blocks/s^2)
const CL_SLOPE = 5; // lift coefficient per radian of angle of attack
const STALL_AOA = 0.3; // radians (~17 degrees)
const GEAR = 1.35; // center to wheels
const CANNON_RATE = 16;
const CANNON_DAMAGE = 5;
const HEAT_PER_SHOT = 0.05; // the cannon overheats after about 2 s of continuous fire
const HEAT_COOL = 0.28; // per second (it always cools)
const HEAT_RESUME = 0.4; // a jammed cannon works again below this
const ASSIST_CONE = 0.11; // radians: the cannon pulls toward a target this close to the nose
const MISSILE_COOLDOWN = 0.5;
const LOCK_TIME = 1.0; // seconds on target: one missile
const SALVO_TIME = 3.0; // seconds on target: a salvo of four
const SALVO_SIZE = 4;
const MISSILE_TURN = 3.2; // rad/s
const FLARE_COOLDOWN = 5;
const FLARE_BURST = 4;
const RUNWAY_THRUST = 0.7; // share of the thrust that pushes on the wheels (a roll of ~100 blocks to lift off, ~60 with the afterburner)
const ROTATE_SPEED = 1.2; // x the stall speed: the assist rotates for takeoff (lift-off with margin to climb away)
const NUKE_COOLDOWN = 0.5; // just a debounce: the nuke has no real cooldown
export const MISSILE_DAMAGE = 190;
const ROGUE_MISSILE_DAMAGE = 70; // an enemy fighter's missile at a UFO (they help, but never clear the sky for you)

const X = new THREE.Vector3(1, 0, 0);
const Y = new THREE.Vector3(0, 1, 0);
const _v = new THREE.Vector3();
const _w = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();

function clamp(v, a, b) {
  return v < a ? a : v > b ? b : v;
}

const _axis = new THREE.Vector3();

// Rotates the unit vector `dir` toward `want` by at most `maxAngle` radians
// (a real rotation about the axis between them: it also turns around a
// target dead astern, where a straight blend would not turn at all).
function turnToward(dir, want, maxAngle) {
  const ang = dir.angleTo(want);
  if (ang < 1e-5) return;
  if (ang <= maxAngle) {
    dir.copy(want);
    return;
  }
  _axis.crossVectors(dir, want);
  if (_axis.lengthSq() < 1e-8) _axis.set(0, 1, 0).cross(dir);
  if (_axis.lengthSq() < 1e-8) _axis.set(1, 0, 0);
  dir.applyAxisAngle(_axis.normalize(), maxAngle).normalize();
}

export class Jet extends Vehicle {
  // data: { pos, yaw, speed, throttle, airborne, health, q }
  constructor(manager, data = {}, opts = {}) {
    super(manager, { type: opts.type || "jet", name: opts.name || "F-22 Raptor", radius: 7.5, maxHealth: opts.maxHealth || 160 });
    this.model = createJetModel(1, { paint: opts.paint || "raptor" });
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
    // Missile lock (hold the right button): the target nearest the centre of
    // the view; `t` is how long it has been held (1 s: a missile, 3 s: a salvo).
    this.lock = { target: null, progress: 0, locked: false, salvo: false, t: 0, beepT: 0, holding: false, lookYaw: 0, lookPitch: 0, look: 0 };
    this.heat = 0; // the cannon (0-1)
    this.jammed = false;
    this.flareT = 0;
    this.flares = [];
    this.queued = []; // missiles waiting to be launched (a salvo): { t, target }
    this.incoming = 0; // seconds of "incoming attack" warning left
    this.warn = null; // the nearest missile/seeker coming at us: { dist, angle, kind }
    this.warnT = 0;
    this.gearT = data.airborne ? 0 : 1;
    this.rolled = 0; // distance rolled on the runway (HUD)
    this.sinceLiftoff = 99; // seconds since the wheels left the ground (takeoff aid)
    this.hostileTo = null;
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
    this.lock.salvo = false;
    this.lock.holding = false;
    this.lock.t = 0;
    this.lock.look = 0;
    this.queued.length = 0;
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
    // On the wheels only part of the thrust gets the jet rolling: a real
    // ground roll of about a hundred blocks (half that with the afterburner).
    const thrust = accel * this.throttle * (this.afterburner ? 1.55 : 1) * (this.onGround ? RUNWAY_THRUST : 1);
    acc.addScaledVector(fwd, thrust);
    // Drag: top speed with the afterburner lit is the max speed setting.
    const kD = (accel * 1.55) / (maxSpeed * maxSpeed);
    // (Induced drag from the wings' lift only once airborne: on the takeoff
    // roll a raised nose would otherwise eat the speed it needs to lift off.)
    const induced = this.onGround ? 0 : 1.5 * cl * cl;
    const drag = kD * speed * speed * (1 + induced) * (this.brake ? 3.5 : 1);
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
      this._updateFlares(dt);
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
      // While a missile lock is held on a target the jet flies straight and
      // the camera looks at it; the mouse is free again when it is let go.
      const looking = this.lock.holding && !!this.lock.target;
      if (looking) {
        const f = this.forward(_v);
        this.aimYaw = Math.atan2(-f.x, -f.z);
        this.aimPitch = Math.asin(clamp(f.y, -1, 1));
      }
      if (cfg.assist) {
        if (!looking) {
          this.aimYaw -= input.dx * sens;
          this.aimPitch = clamp(this.aimPitch - input.dy * sens * inv, -1.45, 1.45);
        }
        // For the first few seconds after the wheels leave a runway the
        // assist holds a gentle climb so the jet doesn't settle back. It is a
        // takeoff aid only: it never acts in normal flight or on landing.
        if (!this.onGround && this.sinceLiftoff < 3 && this.vel.y > -2 && this.speed < cfg.stallSpeed * 1.7) this.aimPitch = Math.max(this.aimPitch, 0.26);
        this._assistStick(stick);
        // Assist also rotates for takeoff once there's flying speed.
        if (this.onGround && this.throttle > 0.5 && this.vel.length() > cfg.stallSpeed * ROTATE_SPEED) stick.x = Math.max(stick.x, 0.6);
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
    } else if (this.ai) {
      this._autopilot(dt, stick);
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
    if (!input) {
      this.cannonT = Math.max(0, this.cannonT - dt);
      this.missileT = Math.max(0, this.missileT - dt);
    }
    // The cannon cools all the time (firing heats it faster than that).
    this.heat = Math.max(0, this.heat - HEAT_COOL * dt);
    if (this.jammed && this.heat < HEAT_RESUME) this.jammed = false;
    const aero = this._aero(dt, stick, input);
    const wasGround = this.onGround;
    this._groundAndCrash(dt, aero);
    if (!this.alive) return;
    if (this.onGround && !wasGround) this._touchdown();
    if (!this.onGround && wasGround && this.occupied && !this.isEnemyJet) this.manager.onTakeoff?.(this);
    this.sinceLiftoff = this.onGround ? 0 : wasGround ? 0.0001 : this.sinceLiftoff > 0 ? this.sinceLiftoff + dt : 99;
    if (this.onGround) this.rolled += Math.hypot(this.vel.x, this.vel.z) * dt;
    else this.rolled = 0;
    this.pos.addScaledVector(this.vel, dt);
    this._updateMissiles(dt);
    this._updateFlares(dt);
    this._updateQueue(dt);
    this._updateWarning(dt, !!input);
    this.incoming = Math.max(0, this.incoming - dt);
    this._place();
    this._effects(dt, aero);
    this.model.setThrottle(this.throttle, this.afterburner, this.time);
    this.model.setLights(this.time, this.manager.night ?? 0);
    // The gear: down on the ground and low and slow (landing), folded away otherwise.
    const agl = this.pos.y - GEAR - this.manager.groundBelow(this.pos.x, this.pos.y - GEAR, this.pos.z);
    const wantGear = this.onGround || (agl < 14 && this.speed < this.cfg.stallSpeed * 1.8) ? 1 : 0;
    this.gearT += clamp(wantGear - this.gearT, -dt * 1.1, dt * 1.1);
    this.model.setGear(this.gearT);
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

  // Touching down: tyre smoke, a chirp.
  _touchdown() {
    const fx = this.manager.effects;
    const c = this._dust || (this._dust = [new THREE.Color(0.75, 0.74, 0.72), new THREE.Color(0.9, 0.9, 0.9)]);
    const right = this.right(new THREE.Vector3());
    const fwd = this.forward(new THREE.Vector3());
    for (const sx of [-1.6, 1.6]) {
      const at = this.pos.clone().addScaledVector(right, sx).addScaledVector(fwd, 2.0);
      at.y -= GEAR;
      for (let i = 0; i < 8; i++) fx.smoke.spawn({ x: at.x, y: at.y + 0.1, z: at.z, vx: this.vel.x * 0.1 + (Math.random() - 0.5) * 3, vy: 0.6 + Math.random(), vz: this.vel.z * 0.1 + (Math.random() - 0.5) * 3, life: 1.2, size0: 0.5, size1: 2.2, color0: c[0], color1: c[1], alpha: 0.5, drag: 1.5 });
    }
  }

  // Visual extras per frame: tyre smoke when braking hard, wingtip vapour in
  // tight turns, a plume of engine haze.
  _effects(dt, aero) {
    const fx = this.manager.effects;
    this._fxT = (this._fxT || 0) - dt;
    if (this._fxT > 0) return;
    this._fxT = 0.05 / Math.max(0.4, effectsQuality.scale);
    const right = this.right(_v);
    const fwd = this.forward(_w);
    if (this.onGround && this.brake && this.speed > 12) {
      const c = this._dust || (this._dust = [new THREE.Color(0.75, 0.74, 0.72), new THREE.Color(0.9, 0.9, 0.9)]);
      for (const sx of [-1.6, 1.6]) {
        const at = this.pos.clone().addScaledVector(right, sx).addScaledVector(fwd, 2.0);
        fx.smoke.spawn({ x: at.x, y: at.y - GEAR + 0.1, z: at.z, vx: (Math.random() - 0.5), vy: 0.5, vz: (Math.random() - 0.5), life: 0.8, size0: 0.35, size1: 1.4, color0: c[0], color1: c[1], alpha: 0.4, drag: 1.5 });
      }
    }
    // Vapour off the wingtips when pulling hard at speed.
    const g = Math.abs(this.angVel.x) * this.speed;
    if (!this.onGround && this.speed > 60 && g > 55) {
      const c = this._vapor || (this._vapor = [new THREE.Color(0.95, 0.95, 1), new THREE.Color(1, 1, 1)]);
      for (const sx of [-6.4, 6.4]) {
        const at = this.pos.clone().addScaledVector(right, sx).addScaledVector(fwd, 2.4);
        fx.smoke.spawn({ x: at.x, y: at.y, z: at.z, vx: 0, vy: 0, vz: 0, life: 1.6, size0: 0.4, size1: 1.6, color0: c[0], color1: c[1], alpha: 0.4, drag: 0.6 });
      }
    }
    // Hot haze behind the nozzles under afterburner.
    if (this.afterburner) {
      const c = this._haze || (this._haze = new THREE.Color(1.6, 1.0, 0.6));
      for (const sx of [-0.62, 0.62]) {
        const at = this.pos.clone().addScaledVector(right, sx).addScaledVector(fwd, 8.2 + Math.random() * 3);
        fx.glow.spawn({ x: at.x, y: at.y, z: at.z, life: 0.16, size0: 0.9, size1: 0.2, color0: c, alpha: 0.45 });
      }
    }
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
    this.flareT = Math.max(0, this.flareT - dt);
    const fwd = this.forward(new THREE.Vector3());
    // Autocannon: rapid fire with tracers; it pulls toward a target near the
    // nose, and jams if it is fired too long (it must cool down).
    const firing = input.buttons[0] || input.pressed.has("mouse0");
    if (firing && this.jammed) {
      if (!this._jamT || this._jamT <= 0) {
        this._jamT = 0.6;
        mgr.onMessage?.("CANNON OVERHEATED: let it cool");
        mgr.audio?.playOverheat?.();
      }
    }
    this._jamT = Math.max(0, (this._jamT || 0) - dt);
    if (firing && !this.jammed && this.cannonT <= 0) this._fireCannon(fwd);
    this._updateLock(dt, input);
    // Flares (C).
    if (input.pressed.has("KeyC")) {
      if (this.flareT > 0) mgr.onMessage?.(`Flares reloading (${Math.ceil(this.flareT)} s)`);
      else this._launchFlares();
    }
    // The nuke.
    if (input.pressed.has("KeyB") && this.nukeT <= 0) {
      this.nukeT = NUKE_COOLDOWN;
      this._dropNuke();
    }
  }

  // The things a missile or the cannon assist can pick: UFOs, enemy jets and
  // hostile creatures. { kind, ref } (out is reused).
  _lockables(includeMobs = true) {
    const mgr = this.manager;
    const list = [];
    for (const u of mgr.ufos?.ufos ?? []) {
      if (u.falling || u.state === "gone" || u.state === "leave") continue;
      list.push({ kind: "ufo", ref: u, weight: 1 });
    }
    for (const v of mgr.vehicles) {
      if (v === this || !v.alive || !v.isEnemyJet) continue;
      list.push({ kind: "jet", ref: v, weight: 0.85 });
    }
    if (includeMobs) {
      for (const m of mgr.mobs.mobs) {
        if (m.dead || !(m.spec.alien || m.spec.hostile)) continue;
        list.push({ kind: "mob", ref: m, weight: 1.8 });
      }
    }
    return list;
  }

  _fireCannon(fwd) {
    const mgr = this.manager;
    const right = this.right(new THREE.Vector3());
    this.cannonT = 1 / CANNON_RATE;
    this.heat = Math.min(1, this.heat + HEAT_PER_SHOT);
    if (this.heat >= 1) this.jammed = true;
    const from = this.pos.clone().addScaledVector(fwd, 6.6).addScaledVector(right, 0.9).addScaledVector(this.up(_v), 0.35);
    const speed = 700 + Math.max(0, this.vel.dot(fwd));
    let dir = fwd.clone();
    if (this.cfg.aimAssist !== false) dir = this._assistDir(from, fwd, speed);
    dir.x += (Math.random() - 0.5) * 0.008;
    dir.y += (Math.random() - 0.5) * 0.008;
    dir.z += (Math.random() - 0.5) * 0.008;
    dir.normalize();
    mgr.lasers.fire({ from, dir, color: this._tracer || (this._tracer = new THREE.Color(5, 3.4, 1.1)), speed, damage: CANNON_DAMAGE * (this.cannonScale ?? 1), owner: this.cannonOwner || "jet", source: this, range: 1100, radius: 0.07, length: 9, scorch: true, sound: false });
    mgr.audio?.playCannon?.();
    mgr.effects.glow.spawn({ x: from.x, y: from.y, z: from.z, life: 0.05, size0: 1.4, size1: 0.3, color0: this._tracer, alpha: 0.9 });
  }

  // Aim assist: a target near the nose pulls the shots toward where it will
  // be when they arrive (lead), more strongly the closer it is to the nose.
  _assistDir(from, fwd, speed) {
    let best = null;
    let bestAng = ASSIST_CONE;
    const tp = new THREE.Vector3();
    for (const t of this._lockables(false)) {
      this._targetPos(t, tp);
      const d = tp.clone().sub(from);
      const dist = d.length();
      if (dist < 20 || dist > 1100) continue;
      const ang = d.divideScalar(dist).angleTo(fwd);
      if (ang < bestAng) {
        bestAng = ang;
        best = { t, dist };
      }
    }
    if (!best) return fwd.clone();
    const target = this._targetPos(best.t, new THREE.Vector3());
    const tv = best.t.ref.vel;
    if (tv) target.addScaledVector(tv, best.dist / speed);
    const aim = target.sub(from).normalize();
    const k = 1 - bestAng / ASSIST_CONE;
    return fwd.clone().lerp(aim, 0.4 + 0.6 * k).normalize();
  }

  // ---------- Missile lock ----------

  // Hold the right button: the target nearest the centre of the view (in any
  // direction, behind you too) is picked and tracked; the camera turns to
  // look at it. Let go after about a second for one guided missile, after
  // three seconds for a salvo of four. Let go before the lock is complete
  // and nothing is fired: the camera just returns to normal.
  _updateLock(dt, input) {
    const mgr = this.manager;
    const lock = this.lock;
    const held = !!input.buttons[2];
    const lookRate = Math.min(1, dt * 3.2);
    if (held) {
      if (!lock.holding) {
        lock.holding = true;
        lock.t = 0;
        lock.target = null;
        lock.progress = 0;
        lock.locked = false;
        lock.salvo = false;
      }
      // The view direction (where the crosshair points).
      const view = this.cfg.assist
        ? _v.set(-Math.sin(this.aimYaw) * Math.cos(this.aimPitch), Math.sin(this.aimPitch), -Math.cos(this.aimYaw) * Math.cos(this.aimPitch))
        : this.forward(_v);
      const tp = _w;
      let best = null;
      let bestScore = Infinity;
      let keepScore = Infinity;
      for (const c of this._lockables()) {
        this._targetPos(c, tp);
        const dv = tp.clone().sub(this.pos);
        const dist = dv.length();
        if (dist < 25 || dist > (c.kind === "mob" ? 450 : 1600)) continue;
        const ang = dv.divideScalar(dist).angleTo(view);
        const score = ang * c.weight;
        if (lock.target && c.ref === lock.target.ref) keepScore = score;
        if (score < bestScore) {
          bestScore = score;
          best = c;
        }
      }
      // Keep the current target unless something is clearly nearer the centre.
      if (lock.target && this._targetAlive(lock.target) && keepScore < bestScore + 0.3) best = lock.target;
      if (best && lock.target && best.ref === lock.target.ref) {
        lock.t += dt;
      } else if (best) {
        lock.target = { kind: best.kind, ref: best.ref };
        lock.t = 0;
        this._lockToneT = 0;
      } else {
        lock.target = null;
        lock.t = 0;
      }
      lock.progress = Math.min(1, lock.t / LOCK_TIME);
      const wasLocked = lock.locked;
      const wasSalvo = lock.salvo;
      lock.locked = !!lock.target && lock.t >= LOCK_TIME;
      lock.salvo = !!lock.target && lock.t >= SALVO_TIME;
      if (lock.target && lock.target.kind === "ufo") lock.target.ref.lockedOn = mgr.ufos.time;
      if (lock.target && lock.target.kind === "jet") lock.target.ref.lockedOn = mgr.ufos.time;
      // Look at it.
      if (lock.target) {
        const d = this._targetPos(lock.target, _w).sub(this.pos);
        lock.lookYaw = Math.atan2(-d.x, -d.z);
        lock.lookPitch = Math.asin(clamp(d.y / Math.max(1, d.length()), -1, 1));
        lock.look += (1 - lock.look) * lookRate;
      } else {
        lock.look += (0 - lock.look) * lookRate;
      }
      // Tones: ticks that speed up, a solid tone, a double tone for the salvo.
      lock.beepT -= dt;
      if (lock.target && lock.beepT <= 0) {
        lock.beepT = lock.salvo ? 0.06 : lock.locked ? 0.1 : 0.34 - lock.progress * 0.22;
        mgr.audio?.playLockTone?.(lock.locked);
      }
      if (lock.locked && !wasLocked) mgr.onMessage?.("LOCKED: release to fire (hold for a salvo)");
      if (lock.salvo && !wasSalvo) {
        mgr.onMessage?.(`SALVO READY x${SALVO_SIZE}`);
        mgr.audio?.playSalvoTone?.();
      }
    } else {
      if (lock.holding) {
        lock.holding = false;
        this._fireLock();
      }
      lock.look += (0 - lock.look) * lookRate;
      if (lock.look < 0.02) {
        lock.look = 0;
        if (!lock.holding) {
          lock.progress = 0;
          lock.locked = false;
          lock.salvo = false;
          lock.target = null;
          lock.t = 0;
        }
      }
    }
  }

  _fireLock() {
    const lock = this.lock;
    if (this.missileT > 0) return;
    const target = lock.target && this._targetAlive(lock.target) ? lock.target : null;
    if (target && lock.locked) {
      if (lock.salvo) {
        // Four missiles, a fraction of a second apart: at the target, and at
        // any others close to it.
        const targets = [target];
        const c0 = this._targetPos(target, new THREE.Vector3());
        for (const c of this._lockables()) {
          if (c.ref === target.ref || targets.length >= SALVO_SIZE) continue;
          if (this._targetPos(c, _w).distanceTo(c0) < 260) targets.push({ kind: c.kind, ref: c.ref });
        }
        for (let i = 0; i < SALVO_SIZE; i++) this.queued.push({ t: i * 0.14, target: targets[i % targets.length] });
        this.missileT = MISSILE_COOLDOWN + SALVO_SIZE * 0.14;
      } else {
        this._launchMissile(target);
        this.missileT = MISSILE_COOLDOWN;
      }
    } else if (lock.target || lock.progress > 0) {
      // Released before the lock completed: no missile.
      this.manager.onMessage?.("Lock cancelled");
    }
  }

  _updateQueue(dt) {
    for (let i = this.queued.length - 1; i >= 0; i--) {
      const q = this.queued[i];
      q.t -= dt;
      if (q.t > 0) continue;
      this.queued.splice(i, 1);
      this._launchMissile(q.target && this._targetAlive(q.target) ? q.target : null);
    }
  }

  // Where a target is (the aim point), written into `out`.
  _targetPos(t, out) {
    const r = t.ref;
    if (t.kind === "ufo" || t.kind === "jet" || t.kind === "vehicle") return out.copy(r.pos);
    if (t.kind === "player") return out.set(r.position.x, r.position.y + 0.9, r.position.z);
    if (t.kind === "decoy") return out.copy(r.pos);
    return out.set(r.pos.x, r.pos.y + r.spec.h * 0.5, r.pos.z);
  }

  _targetVel(t) {
    const r = t.ref;
    if (t.kind === "player") return r.vehicle ? r.vehicle.vel : r.velocity;
    return r.vel;
  }

  _targetAlive(t) {
    if (!t) return false;
    const r = t.ref;
    if (t.kind === "ufo") return !r.falling && r.state !== "gone";
    if (t.kind === "jet" || t.kind === "vehicle") return r.alive;
    if (t.kind === "player") return !r.dead;
    if (t.kind === "decoy") return r.life > 0;
    return !r.dead && this.manager.mobs.mobs.includes(r);
  }

  // Missile radar cross-section for the proximity fuse.
  _targetRadius(t) {
    const r = t.ref;
    if (t.kind === "ufo") return r.radius * 0.8 + 2;
    if (t.kind === "jet" || t.kind === "vehicle") return (r.hitRadius ?? r.radius) + 1.5;
    if (t.kind === "player") return 3.5;
    if (t.kind === "decoy") return 5;
    return 2.2;
  }

  // ---------- Missiles ----------

  // target: { kind, ref } or null (unguided). `hostile` missiles (an enemy
  // jet's) hunt the player, can be fooled by flares, and don't harm UFOs.
  _launchMissile(target, { hostile = false, rogue = false } = {}) {
    const mgr = this.manager;
    const fwd = this.forward(new THREE.Vector3());
    const right = this.right(new THREE.Vector3());
    this.rail = -this.rail;
    const pos = this.pos.clone().addScaledVector(right, this.rail * 2.4).addScaledVector(this.up(_v), -0.7);
    const mesh = new THREE.Mesh(this._missileGeo || (this._missileGeo = missileGeometry()), this._missileMat || (this._missileMat = new THREE.MeshLambertMaterial({ vertexColors: true })));
    mesh.castShadow = true;
    mgr.scene.add(mesh);
    // A target behind the jet: the missile makes a hard turn to get around.
    let behind = false;
    if (target) {
      const d = this._targetPos(target, _w).sub(this.pos).normalize();
      behind = d.dot(fwd) < 0.25;
    }
    const m = { pos, vel: this.vel.clone().addScaledVector(fwd, 12), dir: fwd.clone(), target, age: 0, mesh, trail: 0, hostile, rogue, behind, lostT: 0, launcher: this, decoyed: false };
    this.missiles.push(m);
    mgr.audio?.playRocketLaunch?.();
    if (target?.kind === "player" || target?.kind === "vehicle") this.manager.onMissileLaunched?.(m, this);
    return m;
  }

  // Flares fool a hostile missile: it turns on the nearest flare, and may
  // end up going back at whoever fired it.
  _checkDecoys(m) {
    const t = m.target;
    if (!t || t.kind === "decoy") return;
    const decoys = this.manager.lasers?.decoys ?? [];
    let best = null;
    let bestD = 650;
    for (const d of decoys) {
      if (d.life <= 0 || d.owner !== t.ref && !(t.kind === "player" && d.owner === t.ref.vehicle)) continue;
      const dd = d.pos.distanceTo(m.pos);
      if (dd < bestD) {
        const to = _w.copy(d.pos).sub(m.pos).normalize();
        if (to.angleTo(m.dir) < 1.1) {
          bestD = dd;
          best = d;
        }
      }
    }
    if (best && !m.decoyed) {
      m.decoyed = true;
      // Most (not all) seekers go for the flare.
      if (Math.random() < 0.85) m.target = { kind: "decoy", ref: best, was: t };
    }
  }

  _updateMissiles(dt) {
    const mgr = this.manager;
    const fx = mgr.effects;
    for (let i = this.missiles.length - 1; i >= 0; i--) {
      const m = this.missiles[i];
      m.age += dt;
      const maxSpeed = m.hostile ? 330 : 420;
      const speed = Math.min(maxSpeed, m.vel.length() + 260 * dt);
      if ((m.hostile || m.target?.kind === "jet") && m.age > 0.3) this._checkDecoys(m);
      // Guidance: lead pursuit, with a turn-rate limit. A rear shot gets a
      // hard turn at first. A target crossing the seeker's view too fast
      // (a sharp turn) is lost and the missile flies on.
      if (m.target && this._targetAlive(m.target) && m.age > 0.15) {
        const tp = this._targetPos(m.target, _v);
        const tv = this._targetVel(m.target);
        const tgo = tp.distanceTo(m.pos) / Math.max(50, speed);
        if (tv) tp.addScaledVector(tv, tgo);
        const want = tp.sub(m.pos).normalize();
        const ang = m.dir.angleTo(want);
        const boost = m.behind && m.age < 2.2 ? 2.3 : 1;
        const maxTurn = (m.hostile ? MISSILE_TURN * 0.85 : MISSILE_TURN) * boost * dt;
        turnToward(m.dir, want, maxTurn);
        // Lost track: the target is far outside what the missile can turn onto.
        if (ang > 1.05 && m.age > 2.4) m.lostT += dt;
        else m.lostT = Math.max(0, m.lostT - dt);
        if (m.lostT > 0.35) m.target = null;
      } else if (m.target && !this._targetAlive(m.target)) {
        // The flare burnt out (a decoyed missile flies on) or the target died.
        m.target = null;
      }
      m.vel.copy(m.dir).multiplyScalar(speed);
      const step = speed * dt;
      // Hits: the target (proximity fuse), any UFO, creatures, or terrain.
      let boom = null;
      let direct = null;
      if (m.target && this._targetAlive(m.target)) {
        const tp = this._targetPos(m.target, _w);
        const r = this._targetRadius(m.target);
        if (tp.distanceTo(m.pos) < r + step) {
          boom = m.pos.clone().lerp(tp, 0.7);
          direct = m.target;
        }
      }
      if (!boom && !m.hostile) {
        const uh = mgr.ufos?.raycast(m.pos, m.dir, step);
        if (uh) {
          boom = m.pos.clone().addScaledVector(m.dir, uh.distance);
          direct = { kind: "ufo", ref: uh.ufo };
        }
        const vh = m.rogue ? null : mgr.raycast(m.pos, m.dir, step, this);
        if (!boom && vh && vh.vehicle.isEnemyJet) {
          boom = m.pos.clone().addScaledVector(m.dir, vh.distance);
          direct = { kind: "jet", ref: vh.vehicle };
        }
      }
      if (!boom && m.hostile && m.age > 0.6) {
        // The player's vehicle or body along the way.
        const pv = mgr.raycast(m.pos, m.dir, step, this);
        if (pv && !pv.vehicle.isEnemyJet) {
          boom = m.pos.clone().addScaledVector(m.dir, pv.distance);
          direct = { kind: "vehicle", ref: pv.vehicle };
        }
      }
      if (!boom) {
        const bh = mgr.world.raycast(m.pos, m.dir, step, { solidOnly: true });
        if (bh) boom = m.pos.clone().addScaledVector(m.dir, Math.max(0, bh.distance - 0.5));
      }
      if (!boom && !m.hostile && m.age > 0.3 && mgr.mobs.sphereHit(m.pos, 1)) boom = m.pos.clone();
      if (boom && direct?.kind === "decoy" && m.launcher && m.launcher.alive && !m.turnedBack && Math.random() < 0.3 && m.launcher.pos.distanceTo(boom) < 420) {
        // Spent on a flare, this one comes back at whoever fired it.
        m.turnedBack = true;
        m.target = { kind: m.launcher.isEnemyJet ? "jet" : "vehicle", ref: m.launcher };
        m.hostile = false;
        m.behind = true;
        m.age = Math.min(m.age, 1.2);
        continue;
      }
      if (boom || m.age > (m.hostile ? 11 : 14) || m.pos.y < -10) {
        mgr.scene.remove(m.mesh);
        this.missiles.splice(i, 1);
        if (boom) {
          const src = m.rogue ? "roguemissile" : m.hostile ? "enemymissile" : "missile";
          if (direct?.kind === "ufo" && m.rogue) {
            // An enemy fighter's missile at a UFO (not the player's kill).
            mgr.ufos.damage(direct.ref, ROGUE_MISSILE_DAMAGE, false, boom, m.launcher);
          } else if (direct?.kind === "ufo") {
            mgr.ufos.damage(direct.ref, MISSILE_DAMAGE, true, boom);
            mgr.onMissileHit?.(direct.ref);
          } else if (direct?.kind === "jet" && m.rogue) {
            // (A fighter's missile never provokes the other fighters.)
          } else if (direct?.kind === "jet") {
            direct.ref.damage(MISSILE_DAMAGE, "missile", true);
            mgr.onMissileHit?.(direct.ref);
          } else if (direct?.kind === "vehicle" || direct?.kind === "player") {
            const v = direct.kind === "vehicle" ? direct.ref : direct.ref.vehicle;
            v?.damage?.(MISSILE_DAMAGE * 0.55, "enemymissile");
          }
          fx.explode(boom, { radius: src === "missile" ? 5 : 4.5, source: src });
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

  // ---------- Flares ----------

  _launchFlares() {
    const mgr = this.manager;
    this.flareT = FLARE_COOLDOWN;
    const fwd = this.forward(new THREE.Vector3());
    const up = this.up(new THREE.Vector3());
    const right = this.right(new THREE.Vector3());
    for (let i = 0; i < FLARE_BURST; i++) {
      const spread = (i - (FLARE_BURST - 1) / 2) * 0.55;
      const pos = this.pos.clone().addScaledVector(fwd, -3).addScaledVector(up, -0.9).addScaledVector(right, spread * 1.4);
      const vel = this.vel.clone().multiplyScalar(0.55).addScaledVector(up, -10).addScaledVector(right, spread * 14).addScaledVector(fwd, -14);
      const d = mgr.lasers.addDecoy(pos, vel, 6.5);
      d.owner = this;
      this.flares.push(d);
    }
    mgr.audio?.playFlare?.();
    mgr.onMessage?.("FLARES!");
  }

  _updateFlares(dt) {
    const fx = this.manager.effects;
    for (let i = this.flares.length - 1; i >= 0; i--) {
      const d = this.flares[i];
      if (d.life <= 0) {
        this.flares.splice(i, 1);
        continue;
      }
      const c = this._flareC || (this._flareC = [new THREE.Color(6, 4.4, 2.4), new THREE.Color(0.8, 0.78, 0.75), new THREE.Color(0.95, 0.94, 0.92)]);
      const f = Math.min(1, d.life / 1.2);
      fx.glow.spawn({ x: d.pos.x, y: d.pos.y, z: d.pos.z, life: 0.07, size0: 2.6 * f + 0.6, size1: 1.2 * f + 0.3, color0: c[0], alpha: 0.95 });
      if (Math.random() < 0.6) fx.smoke.spawn({ x: d.pos.x, y: d.pos.y, z: d.pos.z, vx: (Math.random() - 0.5) * 0.6, vy: 0.2, vz: (Math.random() - 0.5) * 0.6, life: 1.6 + Math.random(), size0: 0.5, size1: 2.2, color0: c[1], color1: c[2], alpha: 0.4, drag: 0.9 });
    }
  }

  // ---------- Incoming attack warning ----------

  // The nearest missile or seeking shot coming for this jet: where from
  // (relative to the nose) and how far. Beeps faster as it closes in.
  _updateWarning(dt, pilot) {
    const mgr = this.manager;
    let best = null;
    let bestD = Infinity;
    const consider = (pos, kind) => {
      const d = pos.distanceTo(this.pos);
      if (d < bestD) {
        bestD = d;
        best = { pos, kind };
      }
    };
    for (const v of mgr.vehicles) {
      if (!v.missiles || v === this) continue;
      for (const m of v.missiles) if (m.hostile && m.target && (m.target.ref === this || (m.target.kind === "player" && m.target.ref.vehicle === this) || (m.target.kind === "decoy" && m.target.ref.owner === this))) consider(m.pos, "missile");
    }
    for (const b of mgr.lasers.bolts) if (b.homing && !b.homing.returned && b.homing.target === this) consider(b.pos, "seeker");
    if (!best || bestD > 1500) {
      this.warn = null;
      this._warnPos = null;
      return;
    }
    const local = _w.copy(best.pos).sub(this.pos).applyQuaternion(_q.copy(this.q).invert());
    this.warn = { dist: bestD, angle: Math.atan2(local.x, -local.z), elev: Math.atan2(local.y, Math.hypot(local.x, local.z)), kind: best.kind };
    this._warnPos = (this._warnPos || new THREE.Vector3()).copy(best.pos);
    this.incoming = 1;
    this.warnT -= dt;
    if (pilot && this.warnT <= 0) {
      this.warnT = clamp(bestD / 900, 0.1, 0.8);
      mgr.audio?.playMissileWarning?.(bestD < 350);
    }
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
    this.model.light.sky = Math.max(l.sky, this.pos.y > WORLD_HEIGHT ? 15 : 0);
    this.model.light.block = l.block;
    if (this.hurtTime < 0.2) this.model.light.flash.setRGB(0.5 * (1 - this.hurtTime / 0.2), 0.05, 0);
    else this.model.light.flash.setRGB(0, 0, 0);
  }

  updateCamera(camera, dt) {
    const mode = this.cameraModes[this.cameraMode];
    this.model.canopy.visible = mode !== "cockpit";
    const look = this.lock.look; // 0-1: turned toward the locked target
    if (mode === "cockpit") {
      camera.position.set(0, 0.95, -3.4).applyQuaternion(this.q).add(this.pos);
      camera.quaternion.copy(this.q);
      if (look > 0.001) {
        _e.set(this.lock.lookPitch, this.lock.lookYaw, 0, "YXZ");
        camera.quaternion.slerp(_q.setFromEuler(_e), look * 0.9);
      }
      return;
    }
    const cfg = this.cfg;
    camera.rotation.order = "YXZ";
    if (cfg.assist || look > 0.001) {
      // Look where you're steering; the jet flies into that view. Locking a
      // missile turns the view (even to look back) at the target.
      let yaw = this.aimYaw;
      let pitch = this.aimPitch;
      if (!cfg.assist) {
        const f = this.forward(_v);
        yaw = Math.atan2(-f.x, -f.z);
        pitch = Math.asin(clamp(f.y, -1, 1));
      }
      if (look > 0.001) {
        let dy = this.lock.lookYaw - yaw;
        dy = Math.atan2(Math.sin(dy), Math.cos(dy));
        yaw += dy * look;
        pitch += (this.lock.lookPitch - pitch) * look;
      }
      const aim = _v.set(-Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), -Math.cos(yaw) * Math.cos(pitch));
      camera.position.copy(this.pos).addScaledVector(aim, -24).add(_w.set(0, 5.5, 0));
      camera.rotation.set(pitch - 0.08, yaw, 0);
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
    const nameOf = (t) => (t.kind === "ufo" ? "UFO" : t.kind === "jet" ? "ENEMY JET" : t.ref.spec.name.toUpperCase());
    const lockText = lock.salvo ? `<span class="vh-lock">SALVO x${SALVO_SIZE} ${nameOf(lock.target)}</span>` : lock.locked ? `<span class="vh-lock">LOCKED ${nameOf(lock.target)}</span>` : lock.target ? `locking ${Math.round(lock.progress * 100)}%` : lock.holding ? "searching..." : "hold RMB to lock";
    const warnings = [];
    if (this.stalled) warnings.push("STALL");
    if (!this.onGround && agl < 35 && this.vel.y < -12) warnings.push("PULL UP");
    if (this.warn) warnings.push(this.warn.kind === "missile" ? "MISSILE INCOMING" : "INCOMING ATTACK");
    else if (this.incoming > 0) warnings.push("INCOMING ATTACK");
    if (this.jammed) warnings.push("CANNON OVERHEATED");
    if (this.health < this.maxHealth * 0.3) warnings.push("DAMAGE CRITICAL");
    const cfg = this.cfg;
    const vr = cfg.stallSpeed * ROTATE_SPEED;
    const onRunway = this.onGround
      ? this.throttle < 0.2 && speed < 2
        ? "parked: W for throttle, Shift for afterburner"
        : speed < vr
          ? `rolling ${Math.round(this.rolled)} blocks: rotate at ${Math.round(vr * 3.6)} km/h`
          : "ROTATE: lift off!"
      : "";
    return {
      title: this.name,
      rows: [
        ["Speed", `${Math.round(speed * 3.6)} km/h (${Math.round(speed)} b/s)`],
        ["Altitude", `${Math.round(this.pos.y)} (${Math.round(agl)} above ground)`],
        ["Throttle", `${Math.round(this.throttle * 100)}%${this.afterburner ? " AFTERBURNER" : ""}`],
        ["Heading", `${Math.round(heading)}° ${card}`],
        ["Missile", lockText],
        ["Flares", this.flareT > 0 ? `reloading ${Math.ceil(this.flareT)} s` : "READY (C)"],
        ["Nuke", this.nukeT > 0 ? `reloading ${Math.ceil(this.nukeT)} s` : "READY (B)"],
        ...(onRunway ? [["Takeoff", onRunway]] : []),
      ],
      bars: [{ label: "Cannon heat", value: this.heat, hot: this.jammed || this.heat > 0.75 }],
      weapon: "LMB cannon · hold RMB missile lock · C flares · B nuke",
      warning: warnings.join(" · "),
      health: this.health / this.maxHealth,
      help: `${cfg.assist ? "Mouse: steer" : "Mouse: stick"} · W/S throttle · Shift afterburner · A/D roll · Q/E rudder · Space brake · F ${this.onGround ? "get out" : "EJECT"} · F5 view · I info`,
    };
  }

  // The vehicle info panel (I): stats and controls.
  infoPanel() {
    const cfg = this.cfg;
    return {
      title: `${this.name}: ${this.isEnemyJet ? "hostile fighter" : "your fighter jet"}`,
      stats: [
        ["Top speed (afterburner)", `${Math.round(cfg.maxSpeed * 3.6)} km/h (${Math.round(cfg.maxSpeed)} blocks/s)`],
        ["Stall speed", `${Math.round(cfg.stallSpeed * 3.6)} km/h: the wings stop lifting below it`],
        ["Takeoff run", "about 100 blocks (60 with the afterburner); rotate at the stall speed"],
        ["Armour", `${this.maxHealth} hit points (${Math.round(this.health)} left)`],
        ["Autocannon", `${CANNON_RATE} rounds/s, ${CANNON_DAMAGE} damage each; aims a little for you; overheats after ~${Math.round(1 / (HEAT_PER_SHOT * CANNON_RATE - HEAT_COOL))} s of fire`],
        ["Missiles", `${MISSILE_DAMAGE} damage; lock 1 s: one, 3 s: a salvo of ${SALVO_SIZE}; let go before the lock and nothing fires; can turn around to hit targets behind you`],
        ["Flares", `${FLARE_BURST} decoys per burst, ${FLARE_COOLDOWN} s to reload: fool missiles and seeking shots`],
        ["Nuke", "one big bomb on a parachute; no cooldown"],
        ["Flight assist", cfg.assist ? "on: the jet flies toward the crosshair" : "off: the mouse is the stick"],
      ],
      controls: [
        ["Mouse", cfg.assist ? "Steer (the jet flies toward the crosshair)" : "Stick: up/down pitch, left/right roll"],
        ["W / S", "Throttle up / down"],
        ["Shift", "Afterburner"],
        ["A / D", "Roll"],
        ["Q / E", "Rudder (yaw)"],
        ["Space", "Air brake / wheel brakes"],
        ["Left click", "Autocannon (hold; watch the heat bar)"],
        ["Right click (hold)", "Missile lock on the target nearest the view centre; release to fire"],
        ["C", "Flares"],
        ["B", "Drop the nuke"],
        ["F", "Get out on the ground / eject in the air"],
        ["F5", "Camera: chase / cockpit"],
        ["I", "This panel"],
      ],
    };
  }

  // Screen-space things for the HUD overlay: the lock box on the target,
  // where the nose points (vs. the crosshair, where you steer), and which way
  // the nearest incoming missile is coming from.
  overlay(camera) {
    const out = { lock: null, nose: null, warn: null };
    if (this.lock.target && this._targetAlive(this.lock.target)) {
      const p = this._targetPos(this.lock.target, new THREE.Vector3()).project(camera);
      if (p.z < 1) out.lock = { x: p.x, y: p.y, locked: this.lock.locked, salvo: this.lock.salvo, progress: this.lock.progress };
    }
    const nose = this.forward(new THREE.Vector3()).multiplyScalar(400).add(this.pos).project(camera);
    if (nose.z < 1) out.nose = { x: nose.x, y: nose.y };
    if (this.warn) {
      // The threat's direction in the camera's frame, as a bearing.
      const wp = this._warnPos;
      if (wp) {
        const d = wp.clone().sub(camera.position);
        const camDir = camera.getWorldDirection(new THREE.Vector3());
        const camRight = new THREE.Vector3().crossVectors(camDir, new THREE.Vector3(0, 1, 0)).normalize();
        out.warn = { angle: Math.atan2(d.dot(camRight), d.dot(camDir)), dist: this.warn.dist, kind: this.warn.kind };
      }
    }
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
    this.queued.length = 0;
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
