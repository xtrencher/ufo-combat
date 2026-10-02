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
// W/S throttle, Shift afterburner, A/D roll, Q/E rudder, Space (held) air brakes.
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

export const JET_DEFAULTS = { maxSpeed: 300, accel: 1, turnRate: 1, stallSpeed: 42, assist: true, airborne: false, aimAssist: true };
const G = 14; // gravity on the jet (blocks/s^2)
const CL_SLOPE = 5; // lift coefficient per radian of angle of attack
const STALL_AOA = 0.3; // radians (~17 degrees)
const GEAR = 1.35; // center to wheels
const HEAT_COOL = 0.28; // per second (it always cools)
const HEAT_RESUME = 0.4; // a jammed cannon works again below this
const ASSIST_CONE = 0.11; // radians: the cannon pulls toward a target this close to the nose
const LOCK_TIME = 1.0; // seconds on target: one missile
const TAP_TIME = 0.25; // seconds: a right click shorter than this fires an unguided missile
const LOCK_LOSE_RANGE = 2200; // a tracked target is lost only beyond this (blocks)
const LOCK_PEACEFUL = 0.6; // lock score penalty (radians off the view centre) for targets not attacking you
const FOLLOW_AFTER = 0.8; // seconds the camera stays on the target after the missile got there
const MISSILE_TURN = 3.2; // rad/s
const FLARE_COOLDOWN = 5;
const FLARE_BURST = 4;
const THRUST_AIR = 36; // blocks/s^2 of thrust at 100% throttle in the air (x the thrust setting)
const THRUST_GROUND = 16; // ... on the wheels (a roll of ~110 blocks to lift off, ~75 with the afterburner)
const AB_THRUST = 1.3; // the afterburner's thrust (x): the top speed setting is reached with it lit, 100% throttle alone gives 1/sqrt(1.3) of it
const MAX_BANK = 1.13; // radians (65 degrees): the most flight assist banks in a turn
const ROLL_GAIN = 3; // roll rate (rad/s) per radian of bank error
const ROLL_DAMP = 0.4; // minus this much per rad/s of roll rate: no overshoot
const PITCH_RATE = 1.7; // rad/s at full stick (x the turn setting, up to 1.6x more at speed)
const YAW_RATE = 0.8;
const ROLL_RATE = 4.2; // a full roll in 1.5 s
const AIM_LEVEL = 1.3; // 1/s: the aim (the crosshair) levels its own roll out, so the jet comes back to wings level
const LOOK_DELAY = 0.07; // seconds both mouse buttons are held before free look starts
const GEAR_LAYOUT = { f22: { noseF: 4.6, mainB: 2.0, track: 1.6 }, f16: { noseF: 2.4, mainB: 1.0, track: 1.05 } };
const TOUCH_SAFE_SINK = 9; // blocks/s: a landing harder than this damages the jet
const TOUCH_MAX_SINK = 17; // ... and this much breaks it
const WRECK_LIFE = 45; // seconds a falling wreck is kept at most
const REVERSE_SPEED = 5; // blocks/s: backing up on the ground
const ROTATE_PITCH = 0.24; // radians: the most the nose rises on the wheels (below the stall angle)
const ROTATE_SPEED = 1.2; // x the stall speed: the assist rotates for takeoff (lift-off with margin to climb away)
// Air brakes (Space held in the air): a lot of drag (a few seconds from top speed to a crawl),
// a flat extra deceleration (so they bite at low speed too), some lift lost, and the flight
// path swinging onto the nose (rad/s) for much tighter turns. Brake too much and slow, and the
// jet stalls (the usual stall, below the stall speed).
const AIRBRAKE_DRAG = 5;
const AIRBRAKE_DECEL = 12;
const AIRBRAKE_LIFT_LOSS = 0.22;
const AIRBRAKE_ALIGN = 1.5;
const AIRBRAKE_OPEN_TIME = 0.45; // seconds to open fully
const AIRBRAKE_CLOSE_TIME = 0.35;
// Rolling away from a missile: when a hostile missile closes to this range and the jet has
// rolled by more than ~85 degrees (to either side) in the last moments, the missile loses its
// lock and passes right next to the jet. Once used it needs a few seconds to be available again
// (a jet that rolls all the time can not shrug off every missile).
const ROLL_EVADE_RANGE = 130;
const ROLL_EVADE_ANGLE = 1.45; // radians rolled
const ROLL_EVADE_WINDOW = 2.2; // s: the roll counts for this long
const ROLL_EVADE_COOLDOWN = 4.5;
const ROLL_EVADE_MISS = 9; // blocks: how close the missile passes
const NUKE_COOLDOWN = 0.5; // just a debounce: the nuke has no real cooldown
export const MISSILE_DAMAGE = 190;

// The two jets you can call in. The Raptor is the heavy one (more armour, a
// salvo of four, the higher top speed); the Falcon is lighter and nimbler:
// it turns and rolls faster, stalls later (a shorter takeoff roll),
// accelerates a little quicker and has a faster-firing cannon and quicker
// missile reloads, but less armour, a slightly lower top speed and a
// salvo of two. (The multipliers apply on top of Settings > Vehicles.)
export const JET_TYPES = {
  f22: { id: "f22", name: "F-22 Raptor", short: "heavy stealth fighter", takeoff: "about 120 blocks (100 with the afterburner)", maxHealth: 160, speed: 1, stall: 1, accel: 1, turn: 1, roll: 1, cannonRate: 16, cannonDamage: 5, heatPerShot: 0.05, salvo: 4, salvoTime: 3, missileCooldown: 0.5, probes: { nose: 7.4, wing: 6.2, tail: 6 } },
  f16: { id: "f16", name: "F-16 Fighting Falcon", short: "light, agile fighter", takeoff: "about 90 blocks (75 with the afterburner)", maxHealth: 130, speed: 0.92, stall: 0.9, accel: 1.1, turn: 1.18, roll: 1.3, cannonRate: 20, cannonDamage: 4, heatPerShot: 0.042, salvo: 2, salvoTime: 2, missileCooldown: 0.35, probes: { nose: 7.2, wing: 5.0, tail: 6 } },
};
const ROGUE_MISSILE_DAMAGE = 70; // an enemy fighter's missile at a UFO (they help, but never clear the sky for you)

const X = new THREE.Vector3(1, 0, 0);
const Y = new THREE.Vector3(0, 1, 0);
const _v = new THREE.Vector3();
const _w = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _q2 = new THREE.Quaternion();
const _e = new THREE.Euler();
const Z = new THREE.Vector3(0, 0, 1);
const _a = [0, 1, 2, 3, 4, 5].map(() => new THREE.Vector3());

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
    const spec = JET_TYPES[data.jetType] || JET_TYPES[opts.jetType] || JET_TYPES.f22;
    super(manager, { type: opts.type || "jet", name: opts.name || spec.name, radius: 7.5, maxHealth: opts.maxHealth || spec.maxHealth });
    this.spec = spec;
    this.jetType = spec.id;
    this.model = createJetModel(1, { paint: opts.paint || "raptor", type: spec.id });
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
    this.beamHeld = 0; // seconds left in a UFO's tractor beam
    this.rollAcc = 0; // signed roll (rad) done recently, fading over ROLL_EVADE_WINDOW
    this.rollEvadeT = 0; // cooldown of the roll evasion
    this.airbrake = 0; // 0-1: how far the air brakes are open (Space held in the air: panels / control surfaces, a lot of drag)
    this._abWant = false;
    this.angVel = new THREE.Vector3(); // body rates: x pitch, y yaw, z roll
    this.onGround = !data.airborne;
    const fwd = this.forward(new THREE.Vector3());
    if (data.airborne || Number.isFinite(data.speed)) this.vel.copy(fwd).multiplyScalar(Number(data.speed) || 0);
    // Where the pilot wants to fly (flight assist): a direction, moved by the mouse.
    this.aimQ = new THREE.Quaternion(); // the aim: where the crosshair points (a quaternion: no gimbal lock, loops and rolls work)
    this._levelAim();
    this.camYaw = this.aimYaw;
    this.camPitch = this.aimPitch;
    this.camQ = this.q.clone(); // lagging chase camera (manual mode)
    this.camView = this.q.clone(); // where the camera looks (smoothed)
    this.camSmooth = 0;
    this.freeLook = false; // both mouse buttons: the controls are frozen and the mouse looks around
    this.bothT = 0;
    this.lookYaw = 0;
    this.lookPitch = 0;
    this.fireBlock = false;
    this.surf = { pitch: 0, roll: 0, yaw: 0 }; // control surface deflections (-1..1), smoothed
    this.reversing = false;
    this.wreck = null;
    this.time = 0;
    this.cannonT = 0;
    this.missileT = 0;
    this.nukeT = 0;
    this.rail = 1;
    // Missile lock (hold the right button): the target nearest the centre of
    // the view; `t` is how long it has been held (1 s: a missile, 3 s: a salvo).
    this.lock = { target: null, progress: 0, locked: false, salvo: false, t: 0, held: 0, beepT: 0, holding: false, lookYaw: 0, lookPitch: 0, look: 0, follow: null, suppress: false };
    this.heat = 0; // the cannon (0-1)
    this.jammed = false;
    this.flareT = 0;
    this.flares = [];
    this.queued = []; // missiles waiting to be launched (a salvo): { t, target }
    this.incoming = 0; // seconds of "incoming attack" warning left
    this.warn = null; // the nearest missile/seeker coming at us: { dist, angle, kind }
    this.warnT = 0;
    this.gearT = data.airborne ? 0 : 1;
    this.stickX = 0;
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
    const base = this.manager.config.jet || JET_DEFAULTS;
    const sp = this.spec;
    if (!sp || sp === JET_TYPES.f22) return base;
    // (Cached until the settings object or its numbers change.)
    const key = `${base.maxSpeed}|${base.stallSpeed}|${base.accel}|${base.turnRate}|${base.assist}|${base.aimAssist}|${base.airborne}`;
    if (this._cfgKey !== key || this._cfgBase !== base) {
      this._cfgKey = key;
      this._cfgBase = base;
      this._cfg = { ...base, maxSpeed: base.maxSpeed * sp.speed, stallSpeed: base.stallSpeed * sp.stall, accel: base.accel * sp.accel, turnRate: base.turnRate * sp.turn };
    }
    return this._cfg;
  }

  get bottom() {
    return GEAR;
  }

  // The aim as a yaw and a pitch (derived from the aim quaternion; setting one
  // keeps the other and drops any roll). The autopilots and the tests steer
  // with these.
  get aimYaw() {
    const f = _w.set(0, 0, -1).applyQuaternion(this.aimQ);
    return Math.atan2(-f.x, -f.z);
  }
  set aimYaw(v) {
    this.aimQ.setFromEuler(_e.set(this.aimPitch, v, 0, "YXZ"));
  }
  get aimPitch() {
    const f = _w.set(0, 0, -1).applyQuaternion(this.aimQ);
    return Math.asin(clamp(f.y, -1, 1));
  }
  set aimPitch(v) {
    this.aimQ.setFromEuler(_e.set(clamp(v, -1.5, 1.5), this.aimYaw, 0, "YXZ"));
  }

  // The aim straight along the nose, wings level (kept as it is when the nose
  // is nearly vertical).
  _levelAim() {
    const f = this.forward(_v);
    if (Math.abs(f.y) < 0.97) this.aimQ.setFromEuler(_e.set(Math.asin(clamp(f.y, -1, 1)), Math.atan2(-f.x, -f.z), 0, "YXZ"));
    else this.aimQ.copy(this.q);
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
    this._levelAim();
    this.camQ.copy(this.q);
    this.camView.copy(this.aimQ);
    this.freeLook = false;
    this.bothT = 0;
    this.lookYaw = this.lookPitch = 0;
    this.fireBlock = false;
  }

  onExit() {
    this.lock.target = null;
    this.lock.progress = 0;
    this.lock.locked = false;
    this.lock.salvo = false;
    this.lock.holding = false;
    this.lock.t = 0;
    this.lock.look = 0;
    this.lock.follow = null;
    this.lock.suppress = false;
    this.queued.length = 0;
    this.afterburner = false;
    this.freeLook = false;
    this.lookYaw = this.lookPitch = 0;
    this.manager.audio?.setJetEngine?.(0, false, 0, false);
  }

  // ---------- Aerodynamics ----------

  _aero(dt, stick, input) {
    const cfg = this.cfg;
    const maxSpeed = Math.max(60, cfg.maxSpeed);
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
    // Lift: at the stall speed the best lift just holds the jet up. (On the
    // wheels only while the nose is raised for takeoff: a jet rolling out
    // after landing, or braking, dumps its lift.)
    const kL = G / (clMax * vStall * vStall);
    // (Open air brakes spoil some of the lift: the jet sinks faster, as a real one does.)
    let lift = kL * cl * Math.max(0, vF) * Math.max(0, vF) * (1 - AIRBRAKE_LIFT_LOSS * this.airbrake);
    if (this.onGround && !this._rot) lift = 0;
    const liftDir = _v.copy(up);
    if (speed > 1) {
      const vd = _w.copy(this.vel).divideScalar(speed);
      liftDir.addScaledVector(vd, -liftDir.dot(vd)).normalize();
    }
    const acc = new THREE.Vector3().addScaledVector(liftDir, lift);
    // Thrust grows with the square of the throttle, so the speed you settle
    // at is in proportion to it (50% throttle: half the speed); the
    // afterburner adds to it. On the wheels only part of the thrust gets the
    // jet rolling: a real ground roll of about a hundred blocks.
    const ab = this.afterburner ? (this.onGround ? 1.55 : AB_THRUST) : 1;
    const thrust = (this.onGround ? THRUST_GROUND : THRUST_AIR) * cfg.accel * this.throttle * this.throttle * ab;
    acc.addScaledVector(fwd, thrust);
    // Drag: top speed with the afterburner lit is the max speed setting.
    const kD = (THRUST_AIR * cfg.accel * AB_THRUST) / (maxSpeed * maxSpeed);
    // (Induced drag from the wings' lift only once airborne: on the takeoff
    // roll a raised nose would otherwise eat the speed it needs to lift off.)
    const induced = this.onGround ? 0 : 1.5 * cl * cl;
    const abOpen = this.onGround ? 0 : this.airbrake;
    const drag = kD * speed * speed * (1 + induced) * (this.onGround && this.brake ? 3.5 : 1 + AIRBRAKE_DRAG * abOpen) + AIRBRAKE_DECEL * abOpen;
    if (speed > 0.01) acc.addScaledVector(this.vel, -drag / speed);
    acc.y -= G;
    this.vel.addScaledVector(acc, dt);
    // Open air brakes also bite the airflow into line with the nose: the flight
    // path follows the nose around much faster, which is what lets a braking
    // jet turn so tight (not while stalled: the wings must still be flying).
    if (abOpen > 0.05 && !this.stalled && !this.onGround) {
      const sp = this.vel.length();
      if (sp > 8) {
        const ang = Math.acos(clamp(this.vel.dot(fwd) / sp, -1, 1));
        if (ang > 0.002) {
          const step = Math.min(ang, AIRBRAKE_ALIGN * abOpen * dt);
          const axis = _v.crossVectors(this.vel, fwd);
          if (axis.lengthSq() > 1e-8) this.vel.applyAxisAngle(axis.normalize(), step);
        }
      }
    }
    // Sideslip dies out (the fin weathervanes the jet into the airflow).
    const side = this.vel.dot(right);
    this.vel.addScaledVector(right, -side * Math.min(1, dt * 2.5));
    // Control rates: they need airspeed to work (and bite harder at speed, so
    // the wide turns at a thousand km/h stay flyable).
    const authority = clamp(speed / (vStall * 1.4), 0.15, 1) * (this.stalled ? 0.5 : 1);
    const hi = 1 + 0.6 * clamp((speed - 110) / 190, 0, 1);
    const turn = cfg.turnRate;
    const target = _w.set(stick.x * PITCH_RATE * turn * hi, stick.y * YAW_RATE * turn * hi, stick.z * ROLL_RATE * turn * (this.spec?.roll ?? 1)).multiplyScalar(authority);
    if (this.onGround) {
      target.z = 0; // no rolling on the runway
      target.y = stick.y * 0.5 * clamp(speed / 10, 0, 1); // nosewheel steering
      // Only the takeoff roll rotates the nose (throttle up, no brakes, at
      // speed); otherwise the nose stays on the wheels whatever the crosshair says.
      if (speed < vStall * 0.75 || this.throttle <= 0.45 || this.brake) target.x = 0;
      else target.x = Math.max(0, target.x);
    }
    // A stalled jet drops its nose.
    if (this.stalled && !this.freeLook) target.x -= 0.6;
    // (The roll axis answers fastest: letting go of A/D stops the roll at once.)
    const kA = Math.min(1, dt * 7);
    const kR = Math.min(1, dt * 14);
    this.angVel.x += (target.x - this.angVel.x) * kA;
    this.angVel.y += (target.y - this.angVel.y) * kA;
    this.angVel.z += (target.z - this.angVel.z) * kR;
    // Turn by the body rates as a rotation about their axis: a quaternion, so
    // there is no gimbal lock and no limit on pitch or roll (full loops and
    // barrel rolls).
    const wx = this.angVel.x;
    const wy = -this.angVel.y;
    const wz = -this.angVel.z;
    const mag = Math.hypot(wx, wy, wz);
    if (mag > 1e-5) {
      _axis.set(wx / mag, wy / mag, wz / mag);
      this.q.multiply(_q.setFromAxisAngle(_axis, mag * dt)).normalize();
    }
    return { speed, aoa, vF };
  }

  // The air brakes open while Space is held (the panels / surfaces animate on the
  // ground too, where the wheel brakes do the braking) and close when it is let go.
  _updateAirbrake(dt, want) {
    if (want && !this._abWant) this.manager.audio?.playAirbrake?.(true);
    else if (!want && this._abWant && this.airbrake > 0.3) this.manager.audio?.playAirbrake?.(false);
    this._abWant = want;
    const rate = want ? 1 / AIRBRAKE_OPEN_TIME : -1 / AIRBRAKE_CLOSE_TIME;
    this.airbrake = clamp(this.airbrake + rate * dt, 0, 1);
  }

  // Flight assist: fly toward the aim (the crosshair), which is a quaternion
  // of its own (see update): the jet pitches and yaws toward it, and banks
  // into the turn when it is off to the side, rolling back to the aim's own
  // wings-level as the nose comes onto it. The bank is limited (MAX_BANK) and
  // flown by a damped controller (angle error minus roll rate), so the jet
  // never rolls past its bank limit in a turn and comes back to level without
  // tilting over the other way. An aim that has gone over the top (a loop)
  // pulls the jet through it. rollKey (A/D: -1/1) rolls the jet itself,
  // continuously.
  _assistStick(out, rollKey = 0) {
    const aq = this.aimQ;
    const aimF = _a[0].set(0, 0, -1).applyQuaternion(aq);
    const aimU = _a[1].set(0, 1, 0).applyQuaternion(aq);
    const local = _w.copy(aimF).applyQuaternion(_q2.copy(this.q).invert());
    const fwd = this.forward(_a[2]);
    const right = this.right(_a[3]);
    const up = this.up(_a[4]);
    const bank = Math.atan2(-right.dot(aimU), up.dot(aimU)); // + = right wing down, against the aim's own up
    let want = 0;
    if (local.z > 0.2) {
      // Aiming behind: bank toward that side and pull hard around; straight
      // behind and well above (or below) in the vertical plane it is a loop (or a
      // split-S); behind and level it is a hard banked turn, as ever.
      if (Math.abs(local.x) > 0.25 || Math.abs(local.y) < 0.5) {
        const side = local.x >= 0 ? 1 : -1;
        want = side * MAX_BANK;
        out.set(Math.abs(bank) > 0.8 ? 1 : 0.3, side * 0.5, 0);
      } else {
        out.set(local.y >= -0.05 ? 1 : -1, 0, 0);
      }
    } else {
      // Bank toward the aim's heading (none when flying straight up or down,
      // where the heading means nothing).
      const fH = _v.copy(fwd).addScaledVector(aimU, -fwd.dot(aimU));
      const level = clamp((0.97 - Math.abs(fwd.dot(aimU))) / 0.25, 0, 1);
      if (level > 0 && fH.lengthSq() > 1e-6) {
        fH.normalize();
        const dyaw = Math.atan2(aimU.dot(_a[5].crossVectors(fH, aimF)), fH.dot(aimF));
        want = clamp(-dyaw * 3, -MAX_BANK, MAX_BANK) * level;
      }
      out.set(clamp(local.y * 3.2, -1, 1), clamp(local.x * 1.5, -1, 1), 0);
    }
    if (rollKey) {
      out.z = rollKey;
      return out;
    }
    let err = want - bank;
    err = Math.atan2(Math.sin(err), Math.cos(err));
    const rate = ROLL_GAIN * err - ROLL_DAMP * this.angVel.z;
    out.z = clamp(rate / (ROLL_RATE * Math.max(0.3, this.cfg.turnRate) * (this.spec?.roll ?? 1)), -1, 1);
    return out;
  }

  update(dt, input) {
    super.update(dt, input);
    this.time += dt;
    if (!this.alive) {
      this._updateMissiles(dt);
      this._updateFlares(dt);
      this._updateWreck(dt);
      return;
    }
    // Held in a UFO's tractor beam: no flying, drawn along by the beam (it sets `vel`).
    if (this.beamHeld > 0) {
      this.beamHeld -= dt;
      this.afterburner = false;
      this.throttle = Math.max(0, this.throttle - dt);
      this.q.multiply(_q.setFromAxisAngle(Z, 0.9 * dt)).normalize();
      this.angVel.set(0, 0, 0);
      this.pos.addScaledVector(this.vel, dt);
      this._updateMissiles(dt);
      this._updateFlares(dt);
      this._place();
      this.model.setThrottle(this.throttle, false, this.time);
      return;
    }
    const cfg = this.cfg;
    const stick = new THREE.Vector3();
    this.brake = false;
    this.reversing = false;
    if (input) {
      const k = input.keys;
      const sens = 0.0022 * (this.manager.mouseSensitivity ?? 1);
      const inv = this.manager.invertY ? -1 : 1;
      const wKey = k.has("KeyW");
      const sKey = k.has("KeyS");
      if (wKey) this.throttle = Math.min(1, this.throttle + dt * 0.6);
      if (sKey) this.throttle = Math.max(0, this.throttle - dt * 0.6);
      // Parked or taxiing with the throttle at 0%: S backs the jet up, slowly.
      this.reversing = sKey && !wKey && this.onGround && this.throttle <= 0.001;
      const shift = k.has("ShiftLeft") || k.has("ShiftRight");
      this.afterburner = shift && (!this.onGround || this.throttle > 0.5);
      if (this.afterburner) this.throttle = 1;
      this.brake = k.has("Space");
      // Free look: both mouse buttons freeze the controls (the jet holds its
      // attitude) and the mouse looks around; letting go flies on from there.
      const both = !!input.buttons[0] && !!input.buttons[2];
      this.bothT = both ? this.bothT + dt : 0;
      const wasFree = this.freeLook;
      if (this.bothT > LOOK_DELAY) this.freeLook = true;
      else if (!both) this.freeLook = false;
      if (this.freeLook && !wasFree) this._startFreeLook();
      if (!this.freeLook && wasFree) this._endFreeLook();
      if (this.fireBlock && !input.buttons[0]) this.fireBlock = false;
      // While a missile lock is being held on a target the camera looks at
      // it, but the jet is flown exactly as always: the mouse still steers
      // (a ring on the HUD shows where), and every key works. The same goes
      // for following a launched missile: see _updateLock.
      if (this.freeLook) {
        this.lookYaw -= input.dx * sens;
        this.lookPitch = clamp(this.lookPitch - input.dy * sens * inv, -1.5, 1.5);
        this.lookYaw = Math.atan2(Math.sin(this.lookYaw), Math.cos(this.lookYaw));
      } else {
        const rollKey = (k.has("KeyD") ? 1 : 0) - (k.has("KeyA") ? 1 : 0);
        if (cfg.assist) {
          // The mouse turns the aim about its own axes (so it can go over the top).
          this.aimQ.multiply(_q.setFromAxisAngle(Y, -input.dx * sens));
          this.aimQ.multiply(_q.setFromAxisAngle(X, -input.dy * sens * inv));
          // For the first few seconds after the wheels leave a runway the
          // assist holds a gentle climb so the jet doesn't settle back. It is a
          // takeoff aid only: it never acts in normal flight or on landing.
          if (!this.onGround && this.sinceLiftoff < 3 && this.vel.y > -2 && this.speed < cfg.stallSpeed * 1.7 && this.aimPitch < 0.26) this.aimPitch = 0.26;
          // The aim levels its own roll out (the jet follows it back to wings level).
          const af = _a[0].set(0, 0, -1).applyQuaternion(this.aimQ);
          if (Math.abs(af.y) < 0.985) {
            const ar = _a[1].set(1, 0, 0).applyQuaternion(this.aimQ);
            this.aimQ.multiply(_q.setFromAxisAngle(Z, -AIM_LEVEL * ar.y * dt));
          }
          this.aimQ.normalize();
          this._assistStick(stick, this.onGround ? 0 : rollKey);
          // Assist also rotates for takeoff once there's flying speed.
          if (this.onGround && this.throttle > 0.5 && this.vel.length() > cfg.stallSpeed * ROTATE_SPEED) stick.x = Math.max(stick.x, 0.6);
        } else {
          // Direct stick: mouse up/down pitches, left/right rolls.
          this._manualIn.x += (clamp(-input.dy * sens * inv * 12, -1, 1) - this._manualIn.x) * Math.min(1, dt * 12);
          this._manualIn.y += (clamp(input.dx * sens * 12, -1, 1) - this._manualIn.y) * Math.min(1, dt * 12);
          stick.set(this._manualIn.x, 0, this._manualIn.y);
          if (rollKey) stick.z = rollKey;
        }
        if (k.has("KeyQ")) stick.y = -1;
        if (k.has("KeyE")) stick.y = 1;
        if (this.onGround && !cfg.assist) stick.y += stick.z * 0.5;
      }
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
    this.stickX = stick.x;
    // The cannon cools all the time (firing heats it faster than that).
    this.heat = Math.max(0, this.heat - HEAT_COOL * dt);
    if (this.jammed && this.heat < HEAT_RESUME) this.jammed = false;
    this._updateAirbrake(dt, !!input && this.brake);
    const aero = this._aero(dt, stick, input);
    this.rollAcc = this.rollAcc * Math.exp(-dt / ROLL_EVADE_WINDOW) + (this.onGround ? 0 : this.angVel.z * dt);
    this.rollEvadeT = Math.max(0, this.rollEvadeT - dt);
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
    // Control surfaces follow the stick (ailerons roll, elevators pitch,
    // rudders yaw), smoothed like a real hydraulic actuator.
    const sf = Math.min(1, dt * 10);
    this.surf.pitch += (clamp(stick.x, -1, 1) - this.surf.pitch) * sf;
    this.surf.roll += (clamp(stick.z, -1, 1) - this.surf.roll) * sf;
    this.surf.yaw += (clamp(stick.y, -1, 1) - this.surf.yaw) * sf;
    this.model.setControls?.(this.surf.pitch, this.surf.roll, this.surf.yaw, this.airbrake);
    // The gear: down on the ground and low and slow (landing), folded away otherwise.
    const agl = this.pos.y - GEAR - this.manager.groundBelow(this.pos.x, this.pos.y - GEAR, this.pos.z);
    const wantGear = this.onGround || (agl < 30 && this.speed < this.cfg.stallSpeed * 3) ? 1 : 0;
    this.gearT += clamp(wantGear - this.gearT, -dt * 1.1, dt * 1.1);
    this.model.setGear(this.gearT);
    if (input) this.manager.audio?.setJetEngine?.(this.throttle, this.afterburner, this.speed, true);
    this._updateView(dt);
  }

  // Free look begins: no weapon fires from the press that started it.
  _startFreeLook() {
    const lock = this.lock;
    lock.holding = false;
    lock.target = null;
    lock.progress = 0;
    lock.locked = false;
    lock.salvo = false;
    lock.t = 0;
    lock.follow = null;
    lock.suppress = true;
    this.fireBlock = true;
    this.angVel.set(0, 0, 0); // the attitude is held from this moment
  }

  // Free look ends: the aim is where the nose points, wings level, and the
  // camera comes back smoothly.
  _endFreeLook() {
    this._levelAim();
    this.camSmooth = 0.6;
  }

  // The camera's orientation: the aim (assist) or the lagging attitude
  // (manual), turned to the locked target, or looking around freely.
  _updateView(dt) {
    const cfg = this.cfg;
    this.camQ.slerp(this.q, Math.min(1, dt * 4));
    if (!cfg.assist && !this.freeLook) {
      // (Direct stick: the aim just follows the nose.)
      this._levelAim();
    }
    let target;
    if (this.freeLook || Math.abs(this.lookYaw) + Math.abs(this.lookPitch) > 0.01) {
      target = _q2.copy(this.q).multiply(_q.setFromEuler(_e.set(this.lookPitch, this.lookYaw, 0, "YXZ")));
      if (!this.freeLook) {
        const d = Math.exp(-dt * 7);
        this.lookYaw *= d;
        this.lookPitch *= d;
      }
    } else {
      target = _q2.copy(cfg.assist ? this.aimQ : this.camQ);
    }
    const look = this.lock.look;
    if (look > 0.001) {
      const tq = _q.setFromEuler(_e.set(this.lock.lookPitch, this.lock.lookYaw, 0, "YXZ"));
      target.slerp(tq, look);
    }
    this.camSmooth = Math.max(0, this.camSmooth - dt);
    this.camView.slerp(target, Math.min(1, dt * (this.freeLook ? 40 : this.camSmooth > 0 ? 7 : 60)));
    const f = _v.set(0, 0, -1).applyQuaternion(this.camView);
    this.camYaw = Math.atan2(-f.x, -f.z);
    this.camPitch = Math.asin(clamp(f.y, -1, 1));
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

  // Where the wheels meet the ground: the ground's height under the nose
  // wheel and each main wheel (measured along the level heading), from which
  // the ground's slope and tilt follow, and where the jet's centre sits.
  _contacts(yaw) {
    const mgr = this.manager;
    const lay = GEAR_LAYOUT[this.jetType] || GEAR_LAYOUT.f22;
    const hx = -Math.sin(yaw);
    const hz = -Math.cos(yaw);
    const rx = Math.cos(yaw);
    const rz = -Math.sin(yaw);
    const ref = this.pos.y + 3;
    const at = (f, s) => {
      const x = this.pos.x + hx * f + rx * s;
      const z = this.pos.z + hz * f + rz * s;
      const y = mgr.groundBelow(x, ref, z);
      const wet = IS_WET[mgr.world.getBlock(Math.floor(x), Math.floor(y - 1), Math.floor(z))];
      return { y, wet: !!wet };
    };
    const n = at(lay.noseF, 0);
    const l = at(-lay.mainB, -lay.track);
    const r = at(-lay.mainB, lay.track);
    const gm = (l.y + r.y) / 2;
    const slope = clamp(Math.atan2(n.y - gm, lay.noseF + lay.mainB), -0.4, 0.4);
    const tilt = clamp(Math.atan2(l.y - r.y, 2 * lay.track), -0.4, 0.4); // + = right wing down
    return { slope, tilt, centerY: gm + lay.mainB * Math.tan(slope) + GEAR, gm, wet: n.wet || l.wet || r.wet, mainWet: l.wet || r.wet };
  }

  // Wheels on the ground, landings, and crashes.
  //
  // On the wheels the jet sits level on its three wheels (it follows the
  // slope and tilt of the ground under them), rolls along its heading with
  // rolling friction, wheel brakes (Space) and, at 0% throttle, a slow
  // reverse (S). Takeoff: the nose may rise by up to ROTATE_PITCH above the
  // ground once there's speed; below that it settles back onto the nose wheel.
  // A landing is gentle, hard (it damages the jet) or a crash, by the sink
  // rate and how crooked the jet is to the ground; only extreme cases crash.
  _groundAndCrash(dt, aero) {
    const mgr = this.manager;
    const w = mgr.world;
    const cfg = this.cfg;
    const fwd = this.forward(new THREE.Vector3());
    const up = this.up(new THREE.Vector3());
    const right = this.right(new THREE.Vector3());
    const pitch = Math.asin(clamp(fwd.y, -1, 1));
    const bank = Math.atan2(-right.y, up.y);
    const yaw = Math.atan2(-fwd.x, -fwd.z);
    const center = mgr.groundBelow(this.pos.x, this.pos.y, this.pos.z);
    const low = this.onGround || this.pos.y - GEAR - center < 16;
    const c = low ? this._contacts(yaw) : null;
    if (this.onGround) {
      // Rolling: on the wheels, with rolling friction and brakes.
      if (c.wet) {
        this.crashWhy = "water under the wheels";
        return this._crash("crash");
      }
      const hx = -Math.sin(yaw);
      const hz = -Math.cos(yaw);
      const liftingOff = this.vel.y > 0.5 && aero.speed > cfg.stallSpeed * 0.9;
      const dropped = this.pos.y - c.centerY > 1.6;
      if (!liftingOff && !dropped) {
        const vy = Math.max(0, this.vel.y); // lift building up for the take-off
        // Follow the ground: up at once (a kerb), down at a steady rate.
        this.pos.y = c.centerY > this.pos.y ? c.centerY : Math.max(c.centerY, this.pos.y - 10 * dt);
        // Along the nose's heading. (The speed is measured along the level
        // heading: measuring it along the raised nose lost a few percent of
        // it every frame while rotating, so at a real frame rate the jet
        // could never reach flying speed.)
        let along = this.vel.x * hx + this.vel.z * hz;
        if (this.reversing) {
          // Backing up: first stop, then slowly rearward.
          along = along > 0.05 ? Math.max(0, along - 14 * dt) : Math.max(-REVERSE_SPEED, along - 3.5 * dt);
        } else {
          const fr = this.brake ? 26 : 0.7 + 0.03 * Math.abs(along);
          along = along > 0 ? Math.max(0, along - fr * dt) : Math.min(0, along + fr * dt);
          if (this.throttle < 0.02 && Math.abs(along) < 0.15) along = 0;
        }
        // The nose: level with the ground, raised for takeoff only while
        // pulling and fast enough; otherwise it settles back onto the nose
        // wheel (a jet never sits tilted on the runway).
        let rel = clamp(pitch - c.slope, 0, ROTATE_PITCH);
        // (Only with the throttle up and no brakes on: a jet rolling out after
        // landing never holds its nose up, whatever the crosshair does.)
        const pulling = this.stickX > 0.1 && aero.speed > cfg.stallSpeed * 0.75 && this.throttle > 0.45 && !this.brake;
        if (!pulling) rel = Math.max(0, rel - (aero.speed < cfg.stallSpeed * 0.75 ? 1.2 : 0.8) * dt);
        this._rot = rel > 0.04 && this.throttle > 0.45 && !this.brake;
        // (No leftover rotation from the air: the wheels stop it.)
        if (!pulling) this.angVel.x = 0;
        this.angVel.z = 0;
        _q2.setFromEuler(_e.set(c.slope + rel, yaw, -c.tilt, "YXZ"));
        this.q.slerp(_q2, Math.min(1, dt * 10));
        this.vel.set(hx * along, vy, hz * along);
      } else {
        this.onGround = false;
        this._rot = false;
      }
    } else if (c) {
      // Any wheel below the ground? (Only checked low down: the three ground
      // scans aren't needed up in the air.)
      const lay = GEAR_LAYOUT[this.jetType] || GEAR_LAYOUT.f22;
      let pen = -Infinity;
      for (const [lx, lz] of [[0, -lay.noseF], [-lay.track, lay.mainB], [lay.track, lay.mainB]]) {
        const p = _w.set(lx, -GEAR, lz).applyQuaternion(this.q).add(this.pos);
        const g = mgr.groundBelow(p.x, p.y + 4, p.z);
        pen = Math.max(pen, g - p.y);
      }
      if (pen > -0.05) {
        if (this.vel.y > 0.2 && !c.wet) {
          // Just lifted off (or climbing away from a bump): the wheels skim
          // the ground on the way up; that's not a touchdown.
          this.pos.y += Math.max(0, pen);
        } else {
          // Touchdown.
          const sink = Math.max(0, -this.vel.y);
          let rollRel = bank - c.tilt;
          rollRel = Math.abs(Math.atan2(Math.sin(rollRel), Math.cos(rollRel)));
          const pitchRel = pitch - c.slope;
          const sideways = Math.abs(this.vel.dot(right));
          const broken = c.wet || sink > TOUCH_MAX_SINK || rollRel > 0.6 || pitchRel < -0.3 || pitchRel > 0.62 || sideways > 22 || aero.speed > 220;
          if (broken) {
            this.crashWhy = `touchdown: wet ${c.wet} sink ${sink.toFixed(1)} roll ${rollRel.toFixed(2)} pitchRel ${pitchRel.toFixed(2)} side ${sideways.toFixed(1)} speed ${aero.speed.toFixed(0)}`;
            return this._crash("crash");
          }
          this.onGround = true;
          this.pos.y = Math.max(this.pos.y, c.centerY);
          this.vel.y = 0;
          this._rot = false;
          this.manager.audio?.playLanding?.();
          // A hard landing hurts (never kills outright: the limit above does).
          const hard = Math.max(0, sink - TOUCH_SAFE_SINK) * 7 + Math.max(0, rollRel - 0.35) * 40;
          if (hard > 0) {
            this.manager.onMessage?.("HARD LANDING");
            this.damage(Math.min(hard, this.health - 1), "crash");
          }
        }
      }
    }
    // Any other part of the airframe hitting the terrain: nose, wingtips, tails.
    const right2 = this.right(_w);
    const pr = this.spec.probes;
    const probes = [
      [fwd, pr.nose],
      [fwd, 3],
    ];
    const pts = probes.map(([d, l]) => this.pos.clone().addScaledVector(d, l));
    pts.push(this.pos.clone().addScaledVector(right2, pr.wing), this.pos.clone().addScaledVector(right2, -pr.wing));
    pts.push(this.pos.clone().addScaledVector(fwd, -pr.tail).addScaledVector(up, 2.2));
    pts.push(this.pos.clone().addScaledVector(up, this.onGround ? 1.2 : -0.6));
    for (const p of pts) {
      if (p.y < 0 || p.y >= WORLD_HEIGHT) continue;
      if (IS_SOLID[w.getBlock(Math.floor(p.x), Math.floor(p.y), Math.floor(p.z))]) {
        if (this.speed > 8) {
          this.crashWhy = `airframe at ${p.x.toFixed(1)},${p.y.toFixed(1)},${p.z.toFixed(1)} block ${w.getBlock(Math.floor(p.x), Math.floor(p.y), Math.floor(p.z))}`;
          return this._crash("crash");
        }
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
    const both = !!input.buttons[0] && !!input.buttons[2];
    const firing = (input.buttons[0] || input.pressed.has("mouse0")) && !this.freeLook && !this.fireBlock && !(both && this.bothT > LOOK_DELAY * 0.5);
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

  // The things a missile lock or the cannon assist can pick: UFOs and enemy
  // aircraft only (never creatures on the ground). { kind, ref, weight,
  // attacking } where `attacking` marks the ones fighting the player now.
  _lockables() {
    const mgr = this.manager;
    const list = [];
    for (const u of mgr.ufos?.ufos ?? []) {
      if (u.falling || u.state === "gone" || u.state === "leave") continue;
      list.push({ kind: "ufo", ref: u, weight: 1, attacking: u.hostile && u.state === "attack" });
    }
    for (const v of mgr.vehicles) {
      if (v === this || !v.alive || !v.isEnemyJet) continue;
      list.push({ kind: "jet", ref: v, weight: 0.85, attacking: !this.isEnemyJet && (v.hostile || v.provoked > 0) });
    }
    return list;
  }

  _fireCannon(fwd) {
    const mgr = this.manager;
    const right = this.right(new THREE.Vector3());
    this.cannonT = 1 / this.spec.cannonRate;
    this.heat = Math.min(1, this.heat + this.spec.heatPerShot);
    if (this.heat >= 1) this.jammed = true;
    const from = this.pos.clone().addScaledVector(fwd, 6.6).addScaledVector(right, 0.9).addScaledVector(this.up(_v), 0.35);
    const speed = 700 + Math.max(0, this.vel.dot(fwd));
    let dir = fwd.clone();
    if (this.cfg.aimAssist !== false) dir = this._assistDir(from, fwd, speed);
    dir.x += (Math.random() - 0.5) * 0.008;
    dir.y += (Math.random() - 0.5) * 0.008;
    dir.z += (Math.random() - 0.5) * 0.008;
    dir.normalize();
    mgr.lasers.fire({ from, dir, color: this._tracer || (this._tracer = new THREE.Color(5, 3.4, 1.1)), speed, damage: this.spec.cannonDamage * (this.cannonScale ?? 1), owner: this.cannonOwner || "jet", source: this, range: 1100, radius: 0.07, length: 9, scorch: true, sound: false });
    mgr.audio?.playCannon?.();
    mgr.effects.glow.spawn({ x: from.x, y: from.y, z: from.z, life: 0.05, size0: 1.4, size1: 0.3, color0: this._tracer, alpha: 0.9 });
  }

  // Aim assist: a target near the nose pulls the shots toward where it will
  // be when they arrive (lead), more strongly the closer it is to the nose.
  _assistDir(from, fwd, speed) {
    let best = null;
    let bestAng = ASSIST_CONE;
    const tp = new THREE.Vector3();
    for (const t of this._lockables()) {
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

  // Right mouse button:
  //  - a quick click fires an unguided missile straight ahead (as does
  //    letting go when there was nothing to lock on to);
  //  - hold it: the UFO or enemy aircraft nearest the centre of the view (in
  //    any direction, behind you too; ones attacking you first) is tracked
  //    and the camera turns to look at it. Let go after about a second for
  //    one guided missile, after three for a salvo of four. Let go while the
  //    lock is still building and nothing is fired.
  //  - after a guided launch the camera stays on the target until the
  //    missile hits (or misses), then comes back; a click brings it back at
  //    once.
  _updateLock(dt, input) {
    const mgr = this.manager;
    const lock = this.lock;
    const held = !!input.buttons[2];
    const lookRate = Math.min(1, dt * 3.2);
    const pressed = input.pressed.has("mouse2");
    // Free look (both mouse buttons): no lock, no missile.
    if (this.freeLook) {
      lock.look += (0 - lock.look) * lookRate;
      if (lock.look < 0.02) lock.look = 0;
      return;
    }
    // Following a launched missile's target: a click returns the camera (and
    // that press doesn't start a new lock).
    if (lock.follow) {
      if (pressed) {
        this._endFollow(true);
        lock.suppress = true;
      } else if (!this._followActive()) {
        lock.follow.after -= dt;
        if (lock.follow.after <= 0) this._endFollow(false);
      }
      if (lock.follow) {
        const t = lock.follow.target;
        if (this._targetAlive(t) || lock.follow.last) {
          const tp = this._targetAlive(t) ? this._targetPos(t, _w) : lock.follow.last;
          if (this._targetAlive(t)) lock.follow.last = (lock.follow.last || new THREE.Vector3()).copy(tp);
          const d = _v.copy(tp).sub(this.pos);
          lock.lookYaw = Math.atan2(-d.x, -d.z);
          lock.lookPitch = Math.asin(clamp(d.y / Math.max(1, d.length()), -1, 1));
        }
        lock.look += (1 - lock.look) * lookRate;
        return;
      }
    }
    if (lock.suppress) {
      if (!held) lock.suppress = false;
      lock.look += (0 - lock.look) * Math.min(1, dt * 14);
      if (lock.look < 0.02) lock.look = 0;
      return;
    }
    if (held) {
      if (!lock.holding) {
        lock.holding = true;
        lock.t = 0;
        lock.held = 0;
        lock.target = null;
        lock.progress = 0;
        lock.locked = false;
        lock.salvo = false;
        lock.pip = 0;
      }
      lock.held += dt;
      // The view direction (where the crosshair points).
      const view = this.cfg.assist ? _v.set(0, 0, -1).applyQuaternion(this.aimQ) : this.forward(_v);
      const tp = _w;
      let best = null;
      let bestScore = Infinity;
      let current = null; // the target already being tracked, if it is still there
      for (const c of this._lockables()) {
        this._targetPos(c, tp);
        const dv = tp.clone().sub(this.pos);
        const dist = dv.length();
        const isCurrent = !!lock.target && c.ref === lock.target.ref;
        // (A tracked target is only lost when it is far out of range.)
        if (isCurrent && dist >= 25 && dist <= LOCK_LOSE_RANGE) current = c;
        if (dist < 25 || dist > 1600) continue;
        // Nearest the view centre, and whatever is attacking you first (a
        // bonus worth about 35 degrees off the centre).
        const ang = dv.divideScalar(dist).angleTo(view);
        const score = ang * c.weight + (c.attacking ? 0 : LOCK_PEACEFUL);
        if (score < bestScore) {
          bestScore = score;
          best = c;
        }
      }
      // Once a target is being tracked it stays the target until the button is
      // let go, it is destroyed, or it is lost: never a switch to something else.
      if (current) best = current;
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
      lock.salvo = !!lock.target && lock.t >= this.spec.salvoTime;
      // (Only the one being tracked, and only once the lock is really building.)
      if (lock.target && lock.t > 0.3) lock.target.ref.lockedOn = mgr.ufos.time;
      // Look at it (not for a quick click, which fires straight ahead).
      if (lock.target && lock.held > TAP_TIME) {
        const d = this._targetPos(lock.target, _w).sub(this.pos);
        lock.lookYaw = Math.atan2(-d.x, -d.z);
        lock.lookPitch = Math.asin(clamp(d.y / Math.max(1, d.length()), -1, 1));
        lock.look += (1 - lock.look) * lookRate;
      } else {
        lock.look += (0 - lock.look) * lookRate;
      }
      // Tones: ticks that speed up, a solid tone, a double tone for the salvo.
      lock.beepT -= dt;
      if (lock.target && lock.held > TAP_TIME && lock.beepT <= 0) {
        lock.beepT = lock.salvo ? 0.06 : lock.locked ? 0.1 : 0.34 - lock.progress * 0.22;
        mgr.audio?.playLockTone?.(lock.locked);
      }
      // The salvo charges pip by pip (one click per missile, each higher than the last).
      const n = this.spec.salvo;
      const pip = lock.locked ? Math.min(n, Math.floor(((lock.t - LOCK_TIME) / Math.max(0.1, this.spec.salvoTime - LOCK_TIME)) * n)) : 0;
      if (pip > (lock.pip || 0) && pip < n) mgr.audio?.playSalvoPip?.(pip, n);
      lock.pip = pip;
      if (lock.locked && !wasLocked) mgr.onMessage?.("LOCKED: release to fire (hold for a salvo)");
      if (lock.salvo && !wasSalvo) {
        mgr.onMessage?.(`SALVO READY x${this.spec.salvo}`);
        mgr.audio?.playSalvoTone?.();
        mgr.effects?.shake?.add?.(0.08);
      }
    } else {
      if (lock.holding) {
        lock.holding = false;
        this._fireLock();
      }
      if (lock.follow) return;
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

  // Is a missile launched at the followed target still on its way?
  _followActive() {
    const f = this.lock.follow;
    if (!f) return false;
    if (this.queued.length) return true;
    return this.missiles.some((m) => f.missiles.includes(m));
  }

  // Stops following the target: the camera comes back (at once for a click).
  _endFollow(now) {
    const lock = this.lock;
    lock.follow = null;
    lock.target = null;
    lock.locked = false;
    lock.salvo = false;
    lock.progress = 0;
    lock.t = 0;
    if (now) lock.look = Math.min(lock.look, 0.35);
  }

  _fireLock() {
    const lock = this.lock;
    if (this.missileT > 0) return;
    const target = lock.target && this._targetAlive(lock.target) ? lock.target : null;
    if (target && lock.locked) {
      const follow = { target, missiles: [], after: FOLLOW_AFTER, last: null };
      if (lock.salvo) {
        // Four missiles, a fraction of a second apart: at the target, and at
        // any others close to it.
        const targets = [target];
        const c0 = this._targetPos(target, new THREE.Vector3());
        for (const c of this._lockables()) {
          if (c.ref === target.ref || targets.length >= this.spec.salvo) continue;
          if (this._targetPos(c, _w).distanceTo(c0) < 260) targets.push({ kind: c.kind, ref: c.ref });
        }
        for (let i = 0; i < this.spec.salvo; i++) this.queued.push({ t: i * 0.14, target: targets[i % targets.length], follow });
        this.missileT = this.spec.missileCooldown + this.spec.salvo * 0.14;
      } else {
        follow.missiles.push(this._launchMissile(target));
        this.missileT = this.spec.missileCooldown;
      }
      // The camera stays on the target until the missile gets there.
      lock.follow = follow;
    } else if (lock.held <= TAP_TIME || !lock.target) {
      // A quick click, or nothing to lock on to: an unguided missile,
      // straight ahead.
      this._launchMissile(null);
      this.missileT = this.spec.missileCooldown;
    } else {
      // Released while the lock was still building: no missile.
      this.manager.onMessage?.("Lock cancelled");
    }
  }

  _updateQueue(dt) {
    for (let i = this.queued.length - 1; i >= 0; i--) {
      const q = this.queued[i];
      q.t -= dt;
      if (q.t > 0) continue;
      this.queued.splice(i, 1);
      const m = this._launchMissile(q.target && this._targetAlive(q.target) ? q.target : null);
      if (q.follow) q.follow.missiles.push(m);
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
      // An evaded missile flies on past the jet and burns out a moment later (no blast).
      if (m.evaded) {
        const rel = _v.copy(m.evaded.jet.pos).sub(m.pos);
        if (!m.evaded.passed && rel.dot(m.dir) < 0) {
          m.evaded.passed = true;
          m.evaded.t = m.age;
          mgr.audio?.playFlyBy?.();
        }
        if (m.evaded.passed && m.age - m.evaded.t > 2) {
          fx.glow.spawn({ x: m.pos.x, y: m.pos.y, z: m.pos.z, life: 0.25, size0: 3, size1: 0.5, color0: this._trailC?.[2] || new THREE.Color(4, 2.4, 1), alpha: 0.8 });
          mgr.scene.remove(m.mesh);
          this.missiles.splice(i, 1);
          continue;
        }
      }
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
        // The target rolled away at the last moment: the missile loses it and goes by.
        if (m.hostile && !m.evaded && m.age > 0.8) {
          const tj = m.target.kind === "vehicle" ? m.target.ref : m.target.kind === "player" ? m.target.ref.vehicle : null;
          if (tj?.tryRollEvade?.(m)) this._evadeMissile(m, tj, speed);
        }
        if (m.target) {
          const want = tp.sub(m.pos).normalize();
          const ang = m.dir.angleTo(want);
          const boost = m.behind && m.age < 2.2 ? 2.3 : 1;
          const maxTurn = (m.hostile ? MISSILE_TURN * 0.85 : MISSILE_TURN) * boost * dt;
          turnToward(m.dir, want, maxTurn);
          // Lost track: the target is far outside what the missile can turn onto.
          if (ang > 1.05 && m.age > 2.4) m.lostT += dt;
          else m.lostT = Math.max(0, m.lostT - dt);
          if (m.lostT > 0.35) m.target = null;
        }
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
      if (!boom && m.hostile && m.age > 0.6 && !m.evaded) {
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

  // Can this jet shrug off the hostile missile `m` by rolling? (Called by the
  // missile's launcher when it is close.) True: the roll counts, and the
  // evasion is used up for a few seconds.
  tryRollEvade(m) {
    if (!this.alive || this.onGround || this.rollEvadeT > 0) return false;
    if (Math.abs(this.rollAcc) < ROLL_EVADE_ANGLE) return false;
    if (this.pos.distanceTo(m.pos) > ROLL_EVADE_RANGE) return false;
    this.rollEvadeT = ROLL_EVADE_COOLDOWN;
    return true;
  }

  // The missile loses its lock and is sent past the jet, ~9 blocks to the side
  // (on the side the jet is rolling away from): the aim point is where the jet
  // will be when the missile gets there, moved sideways.
  _evadeMissile(m, jet, speed) {
    const tgo = jet.pos.distanceTo(m.pos) / Math.max(60, speed);
    const aim = jet.pos.clone().addScaledVector(jet.vel, tgo);
    const side = _w.crossVectors(m.dir, Y).normalize();
    if (side.lengthSq() < 0.1) side.set(1, 0, 0);
    const sign = jet.rollAcc >= 0 ? 1 : -1;
    aim.addScaledVector(side, sign * ROLL_EVADE_MISS);
    m.dir.copy(aim.sub(m.pos)).normalize();
    m.evaded = { jet, passed: false, t: 0 };
    m.target = null;
    const mgr = this.manager;
    if (jet.occupied) mgr.onMessage?.("MISSILE EVADED!");
    if (jet.occupied) mgr.effects?.shake?.add?.(0.12);
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
    if (mode === "cockpit") {
      camera.position.set(0, 0.95, -3.4).applyQuaternion(this.q).add(this.pos);
      // The cockpit looks along the nose; free look and a locked target turn the view.
      camera.quaternion.copy(this.q);
      if (this.freeLook || Math.abs(this.lookYaw) + Math.abs(this.lookPitch) > 0.01) camera.quaternion.multiply(_q.setFromEuler(_e.set(this.lookPitch, this.lookYaw, 0, "YXZ")));
      const look = this.lock.look; // 0-1: turned toward the locked target
      if (look > 0.001) {
        _e.set(this.lock.lookPitch, this.lock.lookYaw, 0, "YXZ");
        camera.quaternion.slerp(_q.setFromEuler(_e), look * 0.9);
      }
      return;
    }
    // Chase: behind the jet along the view direction (the aim, a free look,
    // or the camera turned to a locked target), a little above it, in the
    // view's own "up" (so a loop is seen right round).
    camera.quaternion.copy(this.camView);
    const back = _v.set(0, 0, 1).applyQuaternion(this.camView);
    const upv = _w.set(0, 1, 0).applyQuaternion(this.camView);
    camera.position.copy(this.pos).addScaledVector(back, 24).addScaledVector(upv, 5.5);
    camera.rotateX(-0.08);
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
    const nameOf = (t) => (t.kind === "ufo" ? "UFO" : "ENEMY JET");
    const lockText = lock.follow
      ? `<span class="vh-lock">TRACKING ${nameOf(lock.follow.target)}</span> (RMB: view back)`
      : lock.salvo
        ? `<span class="vh-lock">SALVO x${this.spec.salvo} ${nameOf(lock.target)}</span>`
        : lock.locked
          ? `<span class="vh-lock">LOCKED ${nameOf(lock.target)}</span>`
          : lock.target && lock.held > TAP_TIME
            ? `locking ${Math.round(lock.progress * 100)}%`
            : lock.holding && lock.held > TAP_TIME
              ? "searching..."
              : this.missileT > 0
                ? "reloading"
                : "RMB click: fire · hold: lock";
    const warnings = [];
    if (this.stalled) warnings.push("STALL");
    else if (this.airbrake > 0.3 && !this.onGround && speed < this.cfg.stallSpeed * 1.35) warnings.push("LOW SPEED: BRAKES OPEN");
    if (!this.onGround && agl < 35 && this.vel.y < -12) warnings.push("PULL UP");
    if (this.warn) warnings.push(this.warn.kind === "missile" ? "MISSILE INCOMING" : "INCOMING ATTACK");
    else if (this.incoming > 0) warnings.push("INCOMING ATTACK");
    if (this.jammed) warnings.push("CANNON OVERHEATED");
    if (this.health < this.maxHealth * 0.3) warnings.push("DAMAGE CRITICAL");
    const cfg = this.cfg;
    const vr = cfg.stallSpeed * ROTATE_SPEED;
    const onRunway = this.onGround
      ? this.throttle < 0.2 && speed < 2 && !this.reversing
        ? "parked: W for throttle, Shift for afterburner, S (at 0%) reverses"
        : this.reversing
          ? "reversing (release S to stop)"
          : speed < vr
          ? `rolling ${Math.round(this.rolled)} blocks: rotate at ${Math.round(vr * 3.6)} km/h`
          : "ROTATE: lift off!"
      : "";
    return {
      title: this.name,
      rows: [
        ["Speed", `${Math.round(speed * 3.6)} km/h (${Math.round(speed)} b/s)`],
        ["Altitude", `${Math.round(this.pos.y)} (${Math.round(agl)} above ground)`],
        ["Throttle", `${Math.round(this.throttle * 100)}%${this.afterburner ? " AFTERBURNER" : ""}${this.brake && this.onGround ? " · BRAKES" : ""}`],
        ...(this.airbrake > 0.02 ? [["Air brakes", `<span class="vh-on">${this.airbrake > 0.97 ? "OPEN" : this.onGround ? "wheel brakes" : "OPENING"}</span> ${"▮".repeat(Math.round(this.airbrake * 5))}${"▯".repeat(5 - Math.round(this.airbrake * 5))}`]] : []),
        ...(this.freeLook ? [["View", `<span class="vh-lock">FREE LOOK</span> (controls held)`]] : []),
        ["Heading", `${Math.round(heading)}° ${card}`],
        ["Missile", lockText],
        ["Flares", this.flareT > 0 ? `reloading ${Math.ceil(this.flareT)} s` : "READY (C)"],
        ["Nuke", this.nukeT > 0 ? `reloading ${Math.ceil(this.nukeT)} s` : "READY (B)"],
        ...(onRunway ? [["Takeoff", onRunway]] : []),
      ],
      bars: [{ label: "Cannon heat", value: this.heat, hot: this.jammed || this.heat > 0.75 }],
      weapon: "LMB cannon · RMB missile (hold to lock) · C flares · B nuke",
      warning: warnings.join(" · "),
      health: this.health / this.maxHealth,
      help: `${cfg.assist ? "Mouse: steer" : "Mouse: stick"} · W/S throttle · Shift afterburner · A/D roll · Q/E rudder · Space air brakes · both mouse buttons: look around · F ${this.onGround ? "get out" : "EJECT"} · F5 view · I info`,
    };
  }

  // The vehicle info panel (I): stats and controls.
  infoPanel() {
    const cfg = this.cfg;
    return {
      title: `${this.name}: ${this.isEnemyJet ? "hostile fighter" : "your fighter jet"}`,
      stats: [
        ["Top speed", `${Math.round(cfg.maxSpeed * 3.6)} km/h with the afterburner (${Math.round((cfg.maxSpeed / Math.sqrt(AB_THRUST)) * 3.6)} km/h at 100% throttle); speed follows the throttle, 0% to 100%`],
        ["Stall speed", `${Math.round(cfg.stallSpeed * 3.6)} km/h: the wings stop lifting below it`],
        ["Takeoff run", `${this.spec.takeoff}; the nose rises at 1.2x the stall speed`],
        ["Armour", `${this.maxHealth} hit points (${Math.round(this.health)} left)`],
        ["Autocannon", `${this.spec.cannonRate} rounds/s, ${this.spec.cannonDamage} damage each; aims a little for you; overheats after ~${(1 / (this.spec.heatPerShot * this.spec.cannonRate - HEAT_COOL)).toFixed(1)} s of fire`],
        ["Missiles", `${MISSILE_DAMAGE} damage; a click fires one straight ahead (unguided); hold to lock on a UFO or enemy aircraft (ones attacking you first): 1 s for one, ${this.spec.salvoTime} s for a salvo of ${this.spec.salvo}; the view follows the target until the hit (RMB brings it back); let go before the lock and nothing fires`],
        ["Flares", `${FLARE_BURST} decoys per burst, ${FLARE_COOLDOWN} s to reload: fool missiles and seeking shots`],
        ["Nuke", "one big bomb on a parachute; no cooldown"],
        ["Flight assist", cfg.assist ? "on: the jet flies toward the crosshair" : "off: the mouse is the stick"],
      ],
      controls: [
        ["Mouse", cfg.assist ? "Steer (the jet flies toward the crosshair)" : "Stick: up/down pitch, left/right roll"],
        ["W / S", "Throttle up / down"],
        ["Shift", "Afterburner"],
        ["A / D", "Roll (hold for a full roll; let go and it stops without overshoot)"],
        ["Mouse: pull right through", "Loops and barrel rolls: the aim goes over the top, the jet follows"],
        ["Both mouse buttons", "Free look: the controls freeze (the jet holds its attitude) and the mouse looks around"],
        ["S at 0% (on the ground)", "Reverse, slowly"],
        ["Q / E", "Rudder (yaw)"],
        ["Space (hold)", "Air brakes: panels / control surfaces open, the jet sheds speed very fast and turns much tighter (too slow and it stalls); on the ground the wheel brakes"],
        ["Left click", "Autocannon (hold; watch the heat bar)"],
        ["Right click", "Unguided missile straight ahead"],
        ["Right click (hold)", "Missile lock on the UFO or aircraft nearest the view centre (attackers first); release to fire; click again to bring the view back"],
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
    const out = { lock: null, nose: null, warn: null, aim: null };
    if (this.lock.target && this._targetAlive(this.lock.target)) {
      const p = this._targetPos(this.lock.target, new THREE.Vector3()).project(camera);
      if (p.z < 1) {
        const l = this.lock;
        // The salvo charges from the moment the lock is solid until the salvo time: 0-1.
        const charge = l.locked && l.holding ? clamp((l.t - LOCK_TIME) / Math.max(0.1, this.spec.salvoTime - LOCK_TIME), 0, 1) : l.salvo ? 1 : 0;
        out.lock = { x: p.x, y: p.y, locked: l.locked, salvo: l.salvo, progress: l.progress, charge, pips: this.spec.salvo };
      }
    }
    const nose = this.forward(new THREE.Vector3()).multiplyScalar(400).add(this.pos).project(camera);
    if (nose.z < 1) out.nose = { x: nose.x, y: nose.y };
    // Where the mouse is steering (the aim) while the view is turned away from
    // it (a locked target, a launched missile being followed).
    if (this.cfg.assist && !this.freeLook && this.lock.look > 0.05) {
      const aim = _v.set(0, 0, -1).applyQuaternion(this.aimQ).multiplyScalar(400).add(this.pos).project(camera);
      if (aim.z < 1) out.aim = { x: aim.x, y: aim.y };
    }
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

  // Shot down (or broken up) in the air: a big blast, then the burning wreck
  // keeps its heading, tumbles and falls, trailing fire and smoke, and goes
  // off again where it hits. Hitting the ground itself is one blast, as before.
  onDestroyed(cause) {
    const mgr = this.manager;
    const fx = mgr.effects;
    mgr.audio?.setJetEngine?.(0, false, 0, false);
    for (const m of this.missiles) mgr.scene.remove(m.mesh);
    this.missiles.length = 0;
    this.queued.length = 0;
    this.lock.holding = false;
    this.lock.follow = null;
    if (this.absorbedBy) {
      // Swallowed by a tractor beam: a flash, no wreck, no blast.
      fx.glow.spawn({ x: this.pos.x, y: this.pos.y, z: this.pos.z, life: 0.5, size0: 14, size1: 2, color0: new THREE.Color(0.5, 1.2, 2), alpha: 0.9 });
      this.root.visible = false;
      this.removeAt = 0.2;
      return;
    }
    const ground = mgr.groundBelow(this.pos.x, this.pos.y, this.pos.z);
    const inAir = !this.onGround && cause !== "crash" && this.pos.y - GEAR - ground > 8;
    if (!inAir) {
      fx.explode(this.pos.clone(), { radius: 8, source: "jet_boom" });
      this.root.visible = false;
      this.removeAt = 0.2;
      return;
    }
    fx.explode(this.pos.clone(), { radius: 11, source: "jet_boom" });
    this._airBlast(this.pos);
    const sgn = () => (Math.random() < 0.5 ? -1 : 1);
    this.wreck = { age: 0, fxT: 0, boomT: 0.5 + Math.random() * 0.6, spin: new THREE.Vector3((0.4 + Math.random() * 0.8) * sgn(), (Math.random() - 0.5) * 0.6, (1.0 + Math.random() * 1.6) * sgn()) };
    this.throttle = 0;
    this.afterburner = false;
    this.vel.multiplyScalar(0.85);
    this.vel.y += 4;
    this.model.setThrottle(0, false, this.time);
    this.model.setBurnt?.(true);
    this.removeAt = WRECK_LIFE;
  }

  // The big mid-air explosion: a fireball, a smoke cloud and pieces of the
  // airframe thrown out (scaled by the effects setting).
  _airBlast(at) {
    const fx = this.manager.effects;
    const c = this._blastC || (this._blastC = { hot: new THREE.Color(6, 4.2, 1.8), mid: new THREE.Color(3.2, 1.2, 0.4), smoke0: new THREE.Color(0.1, 0.095, 0.09), smoke1: new THREE.Color(0.32, 0.3, 0.28), metal: new THREE.Color(0.34, 0.36, 0.4) });
    const q = effectsQuality.scale;
    const rnd = (a, b) => a + Math.random() * (b - a);
    const dir = () => new THREE.Vector3(rnd(-1, 1), rnd(-1, 1), rnd(-1, 1)).normalize();
    for (let i = 0; i < Math.round(60 * q); i++) {
      const d = dir().multiplyScalar(rnd(3, 26));
      fx.glow.spawn({ x: at.x, y: at.y, z: at.z, vx: d.x + this.vel.x * 0.5, vy: d.y + this.vel.y * 0.5, vz: d.z + this.vel.z * 0.5, life: rnd(0.5, 1.3), size0: rnd(5, 9), size1: rnd(10, 18), color0: c.hot, color1: Math.random() < 0.5 ? c.mid : c.hot, alpha: 0.5, drag: 2.2 });
    }
    for (let i = 0; i < Math.round(30 * q); i++) {
      const d = dir().multiplyScalar(rnd(2, 14));
      fx.smoke.spawn({ x: at.x, y: at.y, z: at.z, vx: d.x, vy: d.y + 2, vz: d.z, life: rnd(3, 5), size0: rnd(4, 7), size1: rnd(14, 24), color0: c.smoke0, color1: c.smoke1, alpha: 0.8, drag: 0.8 });
    }
    for (let i = 0; i < Math.round(26 * q); i++) {
      const d = dir().multiplyScalar(rnd(10, 34));
      fx.debris.spawn(at.x, at.y, at.z, d.x + this.vel.x * 0.4, d.y + 4, d.z + this.vel.z * 0.4, rnd(0.25, 0.7), c.metal, rnd(2.5, 5));
    }
  }

  // The falling wreck: gravity, a tumble, a trail of fire and smoke, small
  // secondary blasts, and the big one on impact (the ground, or the water).
  _updateWreck(dt) {
    const wk = this.wreck;
    if (!wk) return;
    const mgr = this.manager;
    const fx = mgr.effects;
    wk.age += dt;
    this.vel.y = Math.max(-110, this.vel.y - 20 * dt);
    this.vel.multiplyScalar(Math.exp(-0.04 * dt));
    const tumble = _axis.copy(wk.spin).multiplyScalar(dt);
    const mag = tumble.length();
    if (mag > 1e-6) this.q.multiply(_q.setFromAxisAngle(tumble.normalize(), mag)).normalize();
    const step = this.vel.length() * dt;
    const dir = _v.copy(this.vel).normalize();
    const hit = mgr.world.raycast(this.pos, dir, step + 2, { solidOnly: true });
    const wet = IS_WET[mgr.world.getBlock(Math.floor(this.pos.x), Math.floor(this.pos.y), Math.floor(this.pos.z))];
    if (hit || wet || this.pos.y < 2 || wk.age > WRECK_LIFE) {
      const at = hit ? this.pos.clone().addScaledVector(dir, Math.max(0, hit.distance - 0.5)) : this.pos.clone();
      this.wreck = null;
      fx.explode(at, { radius: 10, source: "jet_boom" });
      this._airBlast(at);
      this.root.visible = false;
      this.removeAt = 0.05;
      return;
    }
    this.pos.addScaledVector(this.vel, dt);
    // (Gone far from the player for good.)
    if (this.pos.distanceTo(mgr.player.position) > 3000) {
      this.wreck = null;
      this.root.visible = false;
      this.removeAt = 0.05;
      return;
    }
    this._place();
    this.model.setBurnt?.(true, this.time);
    wk.fxT -= dt;
    if (wk.fxT <= 0) {
      wk.fxT = 0.04 / Math.max(0.4, effectsQuality.scale);
      const c = this._wreckC || (this._wreckC = { fire: new THREE.Color(5, 2.6, 0.9), smoke0: new THREE.Color(0.06, 0.055, 0.05), smoke1: new THREE.Color(0.28, 0.27, 0.26) });
      const j = () => (Math.random() - 0.5) * 2.5;
      fx.glow.spawn({ x: this.pos.x + j(), y: this.pos.y + j() * 0.5, z: this.pos.z + j(), vx: j(), vy: 1 + Math.random(), vz: j(), life: 0.45, size0: 3.4, size1: 1, color0: c.fire, alpha: 0.65, drag: 1.5 });
      fx.smoke.spawn({ x: this.pos.x + j(), y: this.pos.y + j() * 0.5, z: this.pos.z + j(), vx: j() * 0.4, vy: 0.5, vz: j() * 0.4, life: 3.5 + Math.random() * 1.5, size0: 2.2, size1: 10, color0: c.smoke0, color1: c.smoke1, alpha: 0.75, drag: 0.5 });
    }
    wk.boomT -= dt;
    if (wk.boomT <= 0) {
      // A secondary blast in the wreck (a flash and a smoke ball: no crater).
      wk.boomT = 0.5 + Math.random() * 0.9;
      const hot = this._wreckC?.fire || new THREE.Color(5, 2.6, 0.9);
      for (let i = 0; i < Math.round(8 * effectsQuality.scale) + 2; i++) fx.glow.spawn({ x: this.pos.x, y: this.pos.y, z: this.pos.z, vx: (Math.random() - 0.5) * 14, vy: (Math.random() - 0.5) * 14, vz: (Math.random() - 0.5) * 14, life: 0.5, size0: 4, size1: 8, color0: hot, alpha: 0.5, drag: 2 });
      mgr.audio?.playExplosion?.(this.pos.distanceTo(fx.listener), 0.5);
    }
  }

  serialize() {
    return { ...super.serialize(), jetType: this.jetType, q: this.q.toArray().map((v) => Math.round(v * 10000) / 10000), throttle: Math.round(this.throttle * 100) / 100, speed: Math.round(this.speed * 10) / 10, airborne: !this.onGround };
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
