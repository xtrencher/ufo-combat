// (Round 14) The helicopter on the shared vehicle framework (vehicles.js):
// the AH-64 Apache (attack) and the UH-60 Black Hawk (transport), flown by a
// player; the aliens' hijacked gunships (helis.js) fly the same machine.
//
// Flying: the rotor's thrust is along the airframe's up; tilting the disc
// (the airframe) is how it moves. W/S pitch the nose down / up (forward,
// back: the further it tilts the faster it goes, 300 km/h at most), A/D the
// pedals (yaw; at speed it banks into the turn and the tail's fin swings the
// nose into the wind), Q/E roll (a sidestep), Space / Shift the collective
// (climb / sink; let go and it holds its height: the flight assist does what
// a pilot's hand on the collective does). The mouse aims the chin gun and
// the camera (the view turns, the gun turret follows; flying forward with W,
// the nose comes round to where you look). Attitude and speed change with
// inertia: it leans into a move, overshoots a little, coasts.
//
// The engine: boarding starts it (the rotor spins up for a few seconds: no
// lift until it's near flight speed); getting out on the ground shuts it
// down (the rotor winds down). It takes off, hovers and lands anywhere:
// on its wheels, gently and fairly level (a hard or tilted landing hurts
// it, a crash destroys it); the rotor wash raises dust (spray over water)
// below it. The main rotor chops leaves; anything harder is a rotor strike.
//
// Weapons (the Apache): the 30 mm chin gun (left click; its turret follows
// the aim at its own speed, tracers; it overheats), Hydra rockets (right
// click: a salvo of four from the pods, toward the crosshair when it's near
// the nose), Hellfire missiles (X / the wheel selects them for the right
// button; auto aim: keep a target round the crosshair for 1.5 s to lock it,
// then it homes), flares (C). The Black Hawk: a door gun each side, flares.
// V (or F5): the gunner's view through the nose sight (zoomed).
//
// Damage: hits hurt the airframe like any vehicle's; below half the engines
// smoke, below a quarter they burn (less lift). Destroyed in the air it goes
// into a spin, trailing fire and smoke, and blows up where it comes down;
// on the ground it blows up where it stands. A burnt wreck stays a while.
//
// Online: the owner flies it and sends its state (attitude, rotor speed,
// the gun's turret, the stores) with the vehicle states (net/vehicles.js:
// netState / netPuppet); the gun's tracers, the rockets and missiles in
// flight and the blasts reach everyone (net/fx.js: lasers, v.missiles,
// explosions); flares too (js/net/heli.js).
import * as THREE from "three";
import { Vehicle, VehicleManager } from "./vehicles.js";
import { createHeliModel, HELI_LAYOUT, heliRocketGeometry, heliMissileGeometry } from "./heli-model.js";
import { IS_SOLID, IS_WET, IS_LEAVES, BLOCK } from "./blocks.js";
import { effectsQuality } from "./effects.js";
import { WORLD_HEIGHT } from "./constants.js";
import { discShape } from "./hitboxes.js";
import { voice } from "./voice.js";

const G = 14; // gravity on the helicopter (blocks/s^2: the jets' too)
const CENTER_Y = 1.7; // the fuselage's middle above the wheels (pos is the middle)
const MAX_TILT = 0.48; // radians the nose goes down / up at full stick (27 degrees)
const MAX_ROLL = 0.38;
const TILT_RATE = 2.4; // 1/s: how fast the attitude follows the stick (inertia)
const THRUST_MAX = 2.15; // x the weight, at full rotor speed
const CLIMB = 13; // blocks/s up at full collective (down: SINK)
const SINK = 10;
const DRAG_LIN = 0.02;
const DRAG_QUAD = 0.00088; // (with MAX_TILT: about 82 blocks/s, 295 km/h, flat out)
const SPIN_UP = 5.5; // seconds from a standing rotor to flight speed
const SPIN_DOWN = 9;
const LIFT_RPM = 0.68; // below this the rotor can't hold it up
const SAFE_SINK = 7; // blocks/s: a landing harder than this hurts
const CRASH_SINK = 16; // ... and this destroys it
const SAFE_TILT = 0.5; // radians of pitch or roll on touching down
const STRIKE_SPEED = 7; // blocks/s into something solid: damage from here on
const CRASH_SPEED = 30;
const WASH_HEIGHT = 24; // the rotor wash raises dust below this height
const WRECK_TIME = 30;
const LOCK_TIME = 1.5; // seconds a target is kept round the crosshair to lock (the Hellfire)
const LOCK_CONE = 0.14; // radians: the seeker's circle
const LOCK_HOLD = 0.24;
const LOCK_RANGE = 1300;
const FLARE_COOLDOWN = 6;
const FLARE_SALVO = 6;
const HEAT_COOL = 0.3;
// Ordnance. Rockets: unguided, a small blast; Hellfires: guided, a tank killer.
export const ROCKET = { speed: 230, damage: 26, radius: 2.8, spread: 0.012, gravity: 6, life: 5 };
export const HELLFIRE = { speed0: 70, speed: 290, accel: 260, turn: 2.6, damage: 200, radius: 4.5, life: 11, fuse: 3 };

// The kinds: speed in blocks/s, the gun (rounds/s, damage, speed, heat a
// shot), the stores; cam: the chase camera's distance and height.
export const HELI_TYPES = {
  apache: { id: "apache", name: "AH-64 Apache", short: "attack helicopter: chin gun, rockets, Hellfires", probes: { nose: 6.6, wing: 6.2, tail: 9.3 }, maxHealth: 260, mass: 1.6, yaw: 1.25, gun: { rate: 10, damage: 7, speed: 650, range: 900, heat: 0.011, spread: 0.006 }, rockets: 38, salvo: 4, rocketCooldown: 1.2, missiles: 8, missileCooldown: 1.2, camBack: 18, camUp: 6.5, zoom: 28 },
  blackhawk: { id: "blackhawk", name: "UH-60 Black Hawk", short: "transport helicopter: door guns", probes: { nose: 5.8, wing: 7, tail: 10.6 }, maxHealth: 320, mass: 2, yaw: 1.05, gun: { rate: 18, damage: 3.5, speed: 620, range: 650, heat: 0.007, spread: 0.012 }, rockets: 0, salvo: 0, rocketCooldown: 1, missiles: 0, missileCooldown: 1, camBack: 20, camUp: 7, zoom: 40 },
};

const _v = new THREE.Vector3();
const _w = new THREE.Vector3();
const _u = new THREE.Vector3();
const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _c = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _qi = new THREE.Quaternion();
const _e = new THREE.Euler();
const _aimD = new THREE.Vector3();
const _bo = new THREE.Vector3();
const _bd = new THREE.Vector3();
const _ord = new THREE.Vector3(); // (the ordnance's own)
const _ord2 = new THREE.Vector3();
const NEG_Z = new THREE.Vector3(0, 0, -1);

function clamp(v, a, b) {
  return v < a ? a : v > b ? b : v;
}
function wrap(a) {
  return Math.atan2(Math.sin(a), Math.cos(a));
}
function rand(a, b) {
  return a + Math.random() * (b - a);
}

// The hit boxes (body frame, from pos): the cabin and the tail boom.
const BOXES = {
  apache: [{ c: [0, 0.05, -1.6], h: [1.3, 0.95, 4.9] }, { c: [0, 0.55, 5.6], h: [0.45, 0.75, 3.8] }],
  blackhawk: [{ c: [0, 0.1, -1.6], h: [1.35, 1.15, 4.2] }, { c: [0, 0.6, 6.0], h: [0.45, 0.8, 4.6] }],
};

// ---------- Sound: the rotor's thump, the turbines' whine ----------

let soundsOn = 0; // (rotor sounds playing at once: a few at most)
export class RotorSound {
  constructor(audio) {
    this.audio = audio;
    this.nodes = null;
  }
  _start() {
    const a = this.audio;
    const ctx = a?.ctx;
    if (!ctx || this.nodes || !a._noiseBuffer || soundsOn >= 3) return;
    soundsOn++;
    a._cat?.("player");
    const out = ctx.createGain();
    out.gain.value = 0;
    out.connect(a._out || a.master);
    a._out = a.master;
    // The thump: low noise whose loudness beats at the blade-passing rate.
    const noise = ctx.createBufferSource();
    noise.buffer = a._noiseBuffer;
    noise.loop = true;
    const lp = ctx.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.value = 170;
    lp.Q.value = 0.9;
    const beat = ctx.createGain();
    beat.gain.value = 0.35;
    const lfo = ctx.createOscillator();
    lfo.type = "sawtooth";
    lfo.frequency.value = 1;
    const depth = ctx.createGain();
    depth.gain.value = 0.32;
    lfo.connect(depth).connect(beat.gain);
    noise.connect(lp).connect(beat).connect(out);
    // The slap of the blades (a higher, sharper layer of the same beat).
    const bp = ctx.createBiquadFilter();
    bp.type = "bandpass";
    bp.frequency.value = 520;
    bp.Q.value = 1.2;
    const slap = ctx.createGain();
    slap.gain.value = 0.04;
    const depth2 = ctx.createGain();
    depth2.gain.value = 0.05;
    lfo.connect(depth2).connect(slap.gain);
    noise.connect(bp).connect(slap).connect(out);
    // The turbines' whine and the tail rotor's buzz.
    const whine = ctx.createOscillator();
    whine.type = "sine";
    whine.frequency.value = 400;
    const wg = ctx.createGain();
    wg.gain.value = 0;
    whine.connect(wg).connect(out);
    const buzz = ctx.createOscillator();
    buzz.type = "square";
    buzz.frequency.value = 40;
    const blp = ctx.createBiquadFilter();
    blp.type = "lowpass";
    blp.frequency.value = 380;
    const bg = ctx.createGain();
    bg.gain.value = 0;
    buzz.connect(blp).connect(bg).connect(out);
    noise.start();
    lfo.start();
    whine.start();
    buzz.start();
    this.nodes = { out, noise, lfo, whine, wg, buzz, bg, lp };
  }
  // rpm 0-1, load 0-1 (the collective's work), gain (distance) 0-1.
  set(on, rpm = 0, load = 0, gain = 1) {
    if (!on || gain < 0.02 || rpm < 0.02) {
      this.stop();
      return;
    }
    this._start();
    const n = this.nodes;
    if (!n) return;
    const t = this.audio.ctx.currentTime;
    // (Four blades at ~5 turns a second at flight speed: ~19 beats a second.)
    n.lfo.frequency.setTargetAtTime(Math.max(0.5, rpm * 19), t, 0.1);
    n.lp.frequency.setTargetAtTime(140 + load * 90 + rpm * 40, t, 0.1);
    n.whine.frequency.setTargetAtTime(300 + rpm * 1500, t, 0.15);
    n.wg.gain.setTargetAtTime(0.018 * rpm * gain, t, 0.1);
    n.buzz.frequency.setTargetAtTime(Math.max(8, rpm * 92), t, 0.1);
    n.bg.gain.setTargetAtTime(0.03 * rpm * gain, t, 0.1);
    n.out.gain.setTargetAtTime((0.25 + 0.35 * rpm * rpm + 0.15 * load) * gain, t, 0.12);
  }
  stop() {
    const n = this.nodes;
    if (!n) return;
    this.nodes = null;
    soundsOn = Math.max(0, soundsOn - 1);
    try {
      n.out.gain.setTargetAtTime(0, this.audio.ctx.currentTime, 0.2);
    } catch {}
    setTimeout(() => {
      try {
        n.noise.stop();
        n.lfo.stop();
        n.whine.stop();
        n.buzz.stop();
        n.out.disconnect();
      } catch {}
    }, 900);
  }
}

// ---------- The overlay: the crosshair and the gun's pipper ----------

let overlayEl = null;
function overlay() {
  if (overlayEl || typeof document === "undefined") return overlayEl;
  const el = document.createElement("div");
  el.id = "heli-overlay";
  el.style.cssText = "position:fixed;inset:0;pointer-events:none;z-index:9;display:none;font-family:monospace;";
  el.innerHTML = `
<div class="ho-sight" style="position:absolute;inset:0;display:none;background:radial-gradient(circle at 50% 50%, rgba(0,0,0,0) 0, rgba(0,0,0,0) 40vmin, rgba(0,0,0,0.85) 41vmin);"></div>
<svg width="100%" height="100%" style="position:absolute;inset:0;overflow:visible">
  <g class="ho-cross" stroke="rgba(255,255,255,0.9)" stroke-width="1.5" fill="none">
    <path d="M-13 0 H-5 M5 0 H13 M0 -13 V-5 M0 5 V13"/>
    <circle r="1.4" fill="rgba(255,255,255,0.9)" stroke="none"/>
  </g>
  <g class="ho-gun" stroke="rgba(130,255,160,0.95)" stroke-width="1.6" fill="none">
    <circle r="7"/>
    <path d="M-11 0 H-7 M7 0 H11"/>
  </g>
  <g class="ho-rkt" stroke="rgba(255,210,110,0.95)" stroke-width="1.6" fill="none">
    <path d="M0 -8 L8 0 L0 8 L-8 0 Z"/>
  </g>
  <g class="ho-horizon" stroke="rgba(130,255,160,0.55)" stroke-width="1.2" fill="none">
    <path d="M-90 0 H-36 M36 0 H90"/>
  </g>
</svg>
<div class="ho-read" style="position:absolute;left:50%;top:50%;transform:translate(26px,22px);color:#fff;font-size:12px;text-shadow:0 0 3px #000;white-space:nowrap"></div>`;
  document.body.appendChild(el);
  overlayEl = el;
  el._p = { sight: el.querySelector(".ho-sight"), cross: el.querySelector(".ho-cross"), gun: el.querySelector(".ho-gun"), rkt: el.querySelector(".ho-rkt"), horizon: el.querySelector(".ho-horizon"), read: el.querySelector(".ho-read") };
  return el;
}

// Shared meshes for the ordnance in flight.
let _ordMat = null;
function ordMaterial() {
  return _ordMat || (_ordMat = new THREE.MeshLambertMaterial({ vertexColors: true }));
}

// ---------- The helicopter ----------

export class Heli extends Vehicle {
  // data: { kind, paint, pos, yaw, q, health, airborne, rpm, rockets, missiles }
  constructor(manager, data = {}, opts = {}) {
    const kind = HELI_TYPES[data.kind] ? data.kind : HELI_TYPES[opts.kind] ? opts.kind : "apache";
    const spec = HELI_TYPES[kind];
    super(manager, { type: opts.type || "heli", name: opts.name || spec.name, radius: HELI_LAYOUT[kind].rotor.r, maxHealth: opts.maxHealth ?? spec.maxHealth });
    this.kind = kind;
    this.spec = spec;
    this.layout = HELI_LAYOUT[kind];
    this.paint = data.paint || opts.paint || (kind === "blackhawk" ? "black" : "army");
    this.model = createHeliModel(kind, { paint: this.paint });
    this.root.add(this.model.root);
    this.isHeli = true;
    this.mass = spec.mass;
    this.hitRadius = 4.2;
    this.enterRadius = 4.2;
    this.cameraModes = ["chase", "gunner"];
    this.q = new THREE.Quaternion();
    if (Array.isArray(data.pos)) this.pos.fromArray(data.pos);
    if (Number.isFinite(data.health)) this.health = Math.max(1, Math.min(this.maxHealth, data.health));
    this.yaw = Number.isFinite(data.yaw) ? data.yaw : 0;
    this.pitch = 0;
    this.roll = 0;
    if (Array.isArray(data.q) && data.q.length === 4 && data.q.every(Number.isFinite)) {
      this.q.fromArray(data.q).normalize();
      _e.setFromQuaternion(this.q, "YXZ");
      this.pitch = _e.x;
      this.yaw = _e.y;
      this.roll = _e.z;
    }
    this.yawRate = 0;
    this.airborneStart = !!data.airborne;
    this.onGround = !data.airborne;
    this.rpm = Number.isFinite(data.rpm) ? clamp(data.rpm, 0, 1) : data.airborne ? 1 : 0;
    this.engineOn = !!data.airborne;
    this.rotorA = Math.random() * 6;
    this.tailA = 0;
    this.collective = 0; // -1..1 the last command
    this.load = 0; // 0-1 how hard the rotor works (the sound)
    this.lookYaw = this.yaw;
    this.lookPitch = -0.12;
    this.gunYaw = 0; // (relative to the nose)
    this.gunPitch = -0.1;
    this.heat = 0;
    this.jammed = false;
    this.gunT = 0;
    this.flashT = 9;
    this.flashI = 0;
    this.rocketT = 0;
    this.missileT = 0;
    this.rockets = Number.isFinite(data.rockets) ? clamp(data.rockets | 0, 0, spec.rockets) : spec.rockets;
    this.missilesLeft = Number.isFinite(data.missiles) ? clamp(data.missiles | 0, 0, spec.missiles) : spec.missiles;
    this.rearmT = 0;
    this.weapon = spec.missiles ? "rockets" : "gun"; // what the right button fires
    this.missiles = []; // rockets and missiles in flight (net/fx.js sends them)
    this.queued = []; // a salvo's next rockets
    this.flares = [];
    this.flareT = 0;
    this._salvo = null;
    this.lock = { target: null, t: 0, locked: false, progress: 0, out: 0 };
    this.aimPoint = new THREE.Vector3();
    this.range = 0;
    this.warn = null;
    this.warnT = 0;
    this.time = Math.random() * 10;
    this.fxT = 0;
    this.washT = 0;
    this.chopT = 0;
    this.agl = 0;
    this.crashing = false;
    this.wreck = false;
    this._camPos = new THREE.Vector3();
    this._hudSeen = 0;
    this._prev = new THREE.Vector3();
    if (typeof data.tookKey === "string") this.tookKey = data.tookKey;
    if (data.missionHeli) this.missionHeli = true;
    this._place();
    this.model.setStores(1, this.missilesLeft);
  }

  // ---------- Frames and places ----------

  get bottom() {
    return CENTER_Y;
  }

  get airborne() {
    return !this.onGround && this.agl > 4;
  }

  forward(out = new THREE.Vector3()) {
    return out.set(0, 0, -1).applyQuaternion(this.q);
  }
  up(out = new THREE.Vector3()) {
    return out.set(0, 1, 0).applyQuaternion(this.q);
  }
  right(out = new THREE.Vector3()) {
    return out.set(1, 0, 0).applyQuaternion(this.q);
  }

  // A point of the model (model space: y 0 at the wheels) in the world.
  toWorld(x, y, z, out = new THREE.Vector3()) {
    return out.set(x, y - CENTER_Y, z).applyQuaternion(this.q).add(this.pos);
  }

  seatPosition(out = new THREE.Vector3()) {
    const s = this.layout.seat;
    return this.toWorld(s[0], s[1] - 1.2, s[2], out);
  }

  // (Aircraft collisions: a disc round the rotor's sweep, low and flat.)
  get collider() {
    if (!this.alive || this.wreck) return null;
    return this._disc || (this._disc = discShape(this.layout.rotor.r * 0.8, -1.4, 2.4));
  }

  _place() {
    this.q.setFromEuler(_e.set(this.pitch, this.yaw, this.roll, "YXZ"));
    this.root.position.copy(this.pos);
    this.root.quaternion.copy(this.q);
    this.model.root.position.set(0, -CENTER_Y, 0);
    const l = this.manager.world.lightAt(this.pos.x, this.pos.y + 1, this.pos.z);
    this.model.light.sky = l.sky;
    this.model.light.block = l.block;
    if (this.alive) {
      if (this.hurtTime < 0.15) this.model.light.flash.setRGB(0.4 * (1 - this.hurtTime / 0.15), 0.08, 0);
      else this.model.light.flash.setRGB(0, 0, 0);
    }
  }

  // The ground's top under a world point (searched from a little above it).
  _groundAt(x, z, y) {
    return this.manager.groundBelow(x, y, z);
  }

  // Sets it down on the ground where it stands (a new or placed helicopter).
  settle() {
    const g = this._groundAt(this.pos.x, this.pos.z, this.pos.y + 3);
    if (Number.isFinite(g)) this.pos.y = g + CENTER_Y;
    this.onGround = true;
    this.vel.set(0, 0, 0);
    this.agl = 0;
    this._place();
  }

  // ---------- Every frame ----------

  update(dt, input) {
    super.update(dt, input);
    this.time += dt;
    if (!this.alive) {
      this._updateWreck(dt);
      this._updateOrdnance(dt);
      this._updateFlares(dt);
      return;
    }
    // (Parked with the engine off and nobody at the controls: asleep, but
    // for a look at the ground under it now and then.)
    if (!input && this.onGround && this._settled && this.rpm <= 0 && !this.isEnemyHeli && this.vel.lengthSq() < 0.01) {
      this._sleepT = (this._sleepT ?? 0) - dt;
      if (this._sleepT > 0) return;
      this._sleepT = 0.5;
    }
    const ctl = input ? this._pilot(dt, input) : this._control(dt);
    this._flight(dt, ctl);
    if (!this.alive) return; // (a crash in the flight step)
    this._weapons(dt, input, ctl);
    this._updateQueue(dt);
    this._updateOrdnance(dt);
    this._updateFlares(dt);
    this._updateWarning(dt, !!input);
    this._place();
    this._animate(dt);
    this._effects(dt);
    this._sound(!!input);
  }

  // No pilot: on the ground it winds down; in the air it settles down
  // gently on its own (and lands, if it can).
  _control(dt) {
    return { fwd: 0, strafe: 0, yaw: 0, coll: this.onGround ? -1 : -0.45, engine: false };
  }

  // The pilot's controls.
  _pilot(dt, input) {
    const mgr = this.manager;
    const k = input.keys;
    const zoomK = this.cameraMode === 1 ? this.spec.zoom / 70 : 1;
    const sens = 0.0022 * (mgr.mouseSensitivity ?? 0.6) * zoomK;
    this.lookYaw -= input.dx * sens;
    this.lookPitch = clamp(this.lookPitch - input.dy * sens * (mgr.invertY ? -1 : 1), -1.25, 0.6);
    if (input.pressed.has("KeyV")) this.cameraMode = this.cameraMode ? 0 : 1;
    if (input.pressed.has("KeyX") || (input.wheel && Math.abs(input.wheel) > 0)) this._nextWeapon();
    for (const [code, w] of [["Digit1", "gun"], ["Digit2", "rockets"], ["Digit3", "missiles"]]) if (input.pressed.has(code)) this._selectWeapon(w);
    const fwd = (k.has("KeyW") ? 1 : 0) - (k.has("KeyS") ? 1 : 0);
    const strafe = (k.has("KeyE") ? 1 : 0) - (k.has("KeyQ") ? 1 : 0);
    let yaw = (k.has("KeyA") ? 1 : 0) - (k.has("KeyD") ? 1 : 0);
    const coll = (k.has("Space") ? 1 : 0) - (k.has("ShiftLeft") || k.has("ShiftRight") ? 1 : 0);
    // (Flight assist: flying forward with the pedals left alone, the nose
    // comes round to where the pilot looks.)
    if (!yaw && fwd > 0 && !this.onGround) {
      const d = wrap(this.lookYaw - this.yaw);
      yaw = clamp(d * 1.6, -0.85, 0.85);
    }
    this.camYaw = this.lookYaw;
    this.camPitch = this.lookPitch;
    return { fwd, strafe, yaw, coll, engine: true };
  }

  // ---------- The flight model ----------

  _flight(dt, ctl) {
    const mgr = this.manager;
    const S = this.spec;
    // The engine and the rotor's speed.
    this.engineOn = ctl.engine !== false && this.alive;
    const was = this.rpm;
    if (this.engineOn) this.rpm = Math.min(1, this.rpm + dt / SPIN_UP);
    else this.rpm = Math.max(0, this.rpm - dt / SPIN_DOWN);
    if (was < 1 && this.rpm >= 1 && this === mgr.active) mgr.onMessage?.(`${this.spec.name}: rotor at flight speed. Space climbs.`);
    const hp = this.health / this.maxHealth;
    // (A burning engine gives less.)
    const power = this.rpm * this.rpm * (hp < 0.25 ? 0.82 : 1);
    // The attitude follows the stick (and on the ground, the ground).
    const vh = Math.hypot(this.vel.x, this.vel.z);
    const speedK = Math.min(1, vh / 40);
    let pT = -ctl.fwd * MAX_TILT;
    let rT = -ctl.strafe * MAX_ROLL - ctl.yaw * 0.32 * speedK;
    if (this.onGround) {
      pT = this._groundPitch ?? 0;
      rT = this._groundRoll ?? 0;
    }
    const k = Math.min(1, dt * TILT_RATE);
    this.pitch += clamp((pT - this.pitch) * k, -1.3 * dt, 1.3 * dt);
    this.roll += clamp((rT - this.roll) * k, -1.5 * dt, 1.5 * dt);
    // The pedals (slow on the ground, none without the rotor); the fin
    // swings the nose into the wind at speed.
    let yawWant = ctl.yaw * S.yaw * Math.min(1, this.rpm * 1.4) * (this.onGround ? 0.35 : 1);
    if (!ctl.yaw && vh > 18 && !this.onGround) {
      const track = Math.atan2(-this.vel.x, -this.vel.z);
      yawWant += clamp(wrap(track - this.yaw), -0.6, 0.6) * 0.5 * Math.min(1, (vh - 18) / 30);
    }
    this.yawRate += (yawWant - this.yawRate) * Math.min(1, dt * 3);
    this.yaw = wrap(this.yaw + this.yawRate * dt);
    this.q.setFromEuler(_e.set(this.pitch, this.yaw, this.roll, "YXZ"));
    const up = this.up(_u);
    // The collective: the climb rate asked for (held at zero with no key).
    let vyWant = ctl.coll > 0 ? ctl.coll * CLIMB : ctl.coll * SINK;
    // (The last few blocks down: the assist eases the sink, as a pilot
    // flares for the touchdown; a dive at speed still lands hard.)
    if (vyWant < 0 && !this.onGround && this.agl < 9) vyWant = Math.max(vyWant, -(1.6 + this.agl * 0.7));
    const aWant = clamp((vyWant - this.vel.y) * 2.2, -G, G * 1.2);
    // (Ground effect: a little more lift in the last few blocks.)
    const ge = 1 + 0.12 * clamp(1 - this.agl / (this.layout.rotor.r * 1.6), 0, 1);
    const need = (G + aWant) / Math.max(0.35, up.y);
    const T = clamp(need, 0, G * THRUST_MAX * power * ge);
    this.collective = ctl.coll;
    this.load = clamp(T / (G * THRUST_MAX), 0, 1);
    // Forces: the thrust, gravity, drag.
    const ax = up.x * T - this.vel.x * (DRAG_LIN + DRAG_QUAD * vh);
    const az = up.z * T - this.vel.z * (DRAG_LIN + DRAG_QUAD * vh);
    const ay = up.y * T - G - this.vel.y * 0.35;
    this.vel.x += ax * dt;
    this.vel.y += ay * dt;
    this.vel.z += az * dt;
    // (A helicopter turns with its nose: the sideways slip dies away.)
    if (!this.onGround && vh > 4) {
      const rx = Math.cos(this.yaw);
      const rz = -Math.sin(this.yaw);
      const side = this.vel.x * rx + this.vel.z * rz;
      const keep = Math.abs(ctl.strafe) > 0 ? 0.25 : 1.1;
      const d = side * (1 - Math.exp(-dt * keep));
      this.vel.x -= rx * d;
      this.vel.z -= rz * d;
    }
    this._prev.copy(this.pos);
    this.pos.addScaledVector(this.vel, dt);
    if (this.pos.y > WORLD_HEIGHT + 60) {
      this.pos.y = WORLD_HEIGHT + 60;
      this.vel.y = Math.min(0, this.vel.y);
    }
    this._ground(dt, T);
    if (this.alive) this._strikes(dt);
  }

  // The wheels on the ground: landing (hard, tilted: damage), sitting, lifting off.
  _ground(dt, T) {
    const mgr = this.manager;
    const L = this.layout;
    let gmax = -Infinity;
    const hs = this._gh || (this._gh = [0, 0, 0]);
    // (The ground under each wheel, levelled to the airframe's yaw only.)
    const sy = Math.sin(this.yaw);
    const cy = Math.cos(this.yaw);
    for (let i = 0; i < 3; i++) {
      const [x, z] = L.gear[i];
      const wx = this.pos.x + x * cy + z * sy;
      const wz = this.pos.z - x * sy + z * cy;
      hs[i] = this._groundAt(wx, wz, this.pos.y + 1);
      gmax = Math.max(gmax, hs[i]);
    }
    const gc = this._groundAt(this.pos.x, this.pos.z, this.pos.y + 1);
    const ground = Math.max(gmax, gc - 0.5);
    this.agl = this.pos.y - CENTER_Y - ground;
    const wasGround = this.onGround;
    if (this.pos.y - CENTER_Y <= ground + 0.02) {
      const sink = -this.vel.y;
      const vh = Math.hypot(this.vel.x, this.vel.z);
      if (!wasGround) {
        // Touchdown.
        const tilt = Math.max(Math.abs(this.pitch), Math.abs(this.roll));
        if (sink > CRASH_SINK || vh > 34 || tilt > SAFE_TILT * 1.8) {
          this.pos.y = ground + CENTER_Y;
          this.damage(this.maxHealth * 2, "crash");
          return;
        }
        let dmg = 0;
        if (sink > SAFE_SINK) dmg += (sink - SAFE_SINK) * 14;
        if (tilt > SAFE_TILT) dmg += (tilt - SAFE_TILT) * 260;
        if (vh > 16) dmg += (vh - 16) * 6;
        if (this === mgr.active) mgr.effects?.shake?.add?.(Math.min(0.5, 0.05 + sink * 0.03));
        if (sink > 3) mgr.audio?._hit?.({ type: "lowpass", f: 180, q: 1, d: 0.25, v: Math.min(0.6, sink * 0.05) });
        if (dmg > 0) {
          if (this === mgr.active) mgr.onMessage?.(sink > SAFE_SINK ? "HARD LANDING!" : "Land level and slow!");
          this.damage(Math.round(dmg), "crash");
          if (!this.alive) return;
        }
      }
      this.pos.y = ground + CENTER_Y;
      if (this.vel.y < 0) this.vel.y = 0;
      this._settled = true;
      // On the wheels: they brake it (unless it's lifting off).
      const lifting = T > G * 1.02;
      if (!lifting) {
        this.vel.x *= Math.exp(-dt * 3.5);
        this.vel.z *= Math.exp(-dt * 3.5);
        this.onGround = true;
      } else this.onGround = false;
      // The airframe sits on the slope under its wheels.
      const front = (hs[0] + hs[1]) / 2;
      const back = hs[2];
      const len = Math.abs(L.gear[2][1] - L.gear[0][1]);
      this._groundPitch = clamp(Math.atan2(front - back, len), -0.35, 0.35);
      this._groundRoll = clamp(Math.atan2(hs[0] - hs[1], Math.abs(L.gear[1][0] - L.gear[0][0])), -0.3, 0.3);
      // (Sitting in the water: it floods.)
      if (this.onGround && IS_WET[mgr.world.getBlock(Math.floor(this.pos.x), Math.floor(ground - 0.5), Math.floor(this.pos.z))]) {
        this._wetT = (this._wetT || 0) + dt;
        if (this._wetT > 1.5) {
          if (this === mgr.active && !this._toldWet) {
            this._toldWet = true;
            mgr.onMessage?.("You've ditched in the water: take off or it sinks!");
          }
          this.damage(28 * dt, "crash");
        }
      } else {
        this._wetT = 0;
        this._toldWet = false;
      }
    } else {
      this.onGround = false;
      this._settled = false;
      this._wetT = 0;
    }
  }

  // The airframe and the rotor against the blocks: leaves are chopped, the
  // rest is a strike (damage by how fast it hit; it's pushed back out).
  _strikes(dt) {
    const mgr = this.manager;
    const w = mgr.world;
    const L = this.layout;
    const R = L.rotor;
    const speed = this.vel.length();
    let hitBody = false;
    let hitRotor = false;
    const chop = [];
    const mx = this.pos.x - this._prev.x;
    const my = this.pos.y - this._prev.y;
    const mz = this.pos.z - this._prev.z;
    const solidAt = (x, y, z) => {
      const by = Math.floor(y);
      if (by < 0 || by >= WORLD_HEIGHT) return 0;
      return w.getBlock(Math.floor(x), by, Math.floor(z));
    };
    const test = (x, y, z, rotor) => {
      const p = this.toWorld(x, y, z, _c);
      if (!w.getChunk(Math.floor(p.x) >> 4, Math.floor(p.z) >> 4)) return;
      const id = solidAt(p.x, p.y, p.z);
      if (!IS_SOLID[id]) return;
      if (IS_LEAVES[id] && rotor && this.rpm > 0.5) {
        if (chop.length < 48) chop.push(Math.floor(p.x), Math.floor(p.y), Math.floor(p.z), BLOCK.AIR);
        return;
      }
      if (IS_LEAVES[id] && !rotor) return; // (the body pushes through foliage)
      // (Already in it before this step, e.g. set down on a step: it may move out, only not further in.)
      if (IS_SOLID[solidAt(p.x - mx, p.y - my, p.z - mz)]) return;
      if (rotor) hitRotor = true;
      else hitBody = true;
    };
    // The body: nose, belly, tail, fin, wingtips.
    test(0, 1.5, -6.3, false);
    test(0, 1.0, -2, false);
    test(0, 2.1, 8.8, false);
    test(0, 3.9, 9.1, false);
    test(-2.8, 1.9, 0, false);
    test(2.8, 1.9, 0, false);
    test(0, 2.4, 2.5, false);
    // The rotor's sweep: its rim and half way out (in the air: on the
    // ground a slow rotor over a log only stops the take-off, below).
    if (this.rpm > 0.15 && !this.onGround) {
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * Math.PI * 2;
        test(Math.cos(a) * R.r * 0.97, R.y, R.z + Math.sin(a) * R.r * 0.97, true);
        if (i % 2 === 0) test(Math.cos(a) * R.r * 0.55, R.y, R.z + Math.sin(a) * R.r * 0.55, true);
      }
    }
    if (chop.length && !this.puppet) {
      this.chopT -= dt;
      if (this.chopT <= 0) {
        this.chopT = 0.15;
        w.setBlocks(chop);
        mgr.audio?.playBreak?.("grass");
        const c = this._leafC || (this._leafC = new THREE.Color(0.25, 0.45, 0.18));
        for (let i = 0; i < Math.min(6, chop.length / 4); i++) mgr.effects.smoke.spawn({ x: chop[i * 4] + 0.5, y: chop[i * 4 + 1] + 0.5, z: chop[i * 4 + 2] + 0.5, vx: rand(-3, 3), vy: rand(-1, 2), vz: rand(-3, 3), life: 0.9, size0: 0.4, size1: 0.9, color0: c, alpha: 0.7, drag: 1.5 });
      }
    }
    if (!hitBody && !hitRotor) return;
    // Back out, the way it came; the impact's speed sets the damage.
    this.pos.copy(this._prev);
    const into = speed;
    this.vel.multiplyScalar(-0.25);
    this.yawRate *= 0.5;
    this._strikeT = (this._strikeT ?? 0) - dt;
    if (this._strikeT > 0) return;
    this._strikeT = 0.35;
    let dmg = 0;
    if (hitRotor) {
      dmg += 18 + into * 2.2;
      if (this === mgr.active) mgr.onMessage?.("ROTOR STRIKE!");
      mgr.audio?._hit?.({ type: "bandpass", f: 900, q: 2, d: 0.2, v: 0.5, n: 3, spread: 0.05 });
      const c = this._sparkC || (this._sparkC = new THREE.Color(4, 3, 1.5));
      const tip = this.toWorld(0, R.y, R.z - R.r, _c);
      for (let i = 0; i < 6; i++) mgr.effects.glow.spawn({ x: tip.x, y: tip.y, z: tip.z, vx: rand(-6, 6), vy: rand(0, 6), vz: rand(-6, 6), life: 0.3, size0: 0.3, size1: 0.1, color0: c, alpha: 1, gravity: 1 });
    }
    if (hitBody && into > STRIKE_SPEED) dmg += (into - STRIKE_SPEED) * 7;
    if (hitBody && into > CRASH_SPEED) dmg = this.maxHealth * 2;
    if (this === mgr.active && dmg > 0) mgr.effects?.shake?.add?.(Math.min(0.6, 0.1 + dmg * 0.004));
    if (dmg > 0) this.damage(Math.round(dmg), "crash");
  }

  // ---------- Weapons ----------

  _selectWeapon(w) {
    const S = this.spec;
    const ok = w === "gun" || (w === "rockets" && S.rockets > 0) || (w === "missiles" && S.missiles > 0);
    if (!ok || this.weapon === w) return;
    this.weapon = w;
    if (this === this.manager.active) this.manager.onMessage?.(w === "missiles" ? "HELLFIRE: keep a target round the crosshair to lock it, right click fires" : w === "rockets" ? "ROCKETS: right click fires a salvo" : "Right click: the gun");
  }

  _nextWeapon() {
    const order = ["rockets", "missiles"].filter((w) => (w === "rockets" ? this.spec.rockets : this.spec.missiles) > 0);
    if (order.length < 2) return;
    this._selectWeapon(order[(order.indexOf(this.weapon) + 1) % order.length]);
  }

  // What the crosshair is on (the view's centre): the first block, vehicle,
  // UFO or creature along it, up to `max`.
  _rangefind(from, dir, max) {
    const mgr = this.manager;
    let d = max;
    const h = mgr.world.raycast(from, dir, max, { solidOnly: true });
    if (h) d = h.distance;
    const vh = mgr.raycast(from, dir, d, this);
    if (vh) d = vh.distance;
    const uh = mgr.ufos?.raycast(from, dir, d);
    if (uh) d = uh.distance;
    const mh = mgr.mobs?.raycast?.(from, dir, d);
    if (mh && mh.distance < d) d = mh.distance;
    return Math.max(10, d);
  }

  // The look direction (where the crosshair is).
  _lookDir(out) {
    return out.set(-Math.sin(this.lookYaw) * Math.cos(this.lookPitch), Math.sin(this.lookPitch), -Math.cos(this.lookYaw) * Math.cos(this.lookPitch));
  }

  // The gun i's muzzle (world) and the direction it points.
  muzzleWorld(i = 0, out = new THREE.Vector3()) {
    const m = this.model.muzzles[i] || this.model.muzzle;
    this.root.updateMatrixWorld(true);
    return m.getWorldPosition(out);
  }

  gunDir(i = 0, out = new THREE.Vector3()) {
    const gg = this.model.guns[i];
    if (!gg) return this.forward(out);
    _e.set(gg.pitchG.rotation.x, gg.yawG.rotation.y, 0, "YXZ");
    return out.set(0, 0, -1).applyQuaternion(_q.setFromEuler(_e)).applyQuaternion(this.q);
  }

  // The turret's yaw and pitch (nose frame) to point along world direction d.
  _localAim(d) {
    _qi.copy(this.q).invert();
    const l = _w.copy(d).applyQuaternion(_qi);
    return { yaw: Math.atan2(-l.x, -l.z), pitch: Math.atan2(l.y, Math.hypot(l.x, l.z)) };
  }

  // Slews gun i toward the aim point (its limits: the chin gun turns 110
  // degrees each way and looks down a lot; a door gun covers its side).
  // Returns how far off it still is (radians), or Infinity out of its arc.
  _slewGun(i, at, dt) {
    const gg = this.model.guns[i];
    if (!gg) return Infinity;
    const from = this.muzzleWorld(i, _a);
    const d = _b.copy(at).sub(from).normalize();
    const a = this._localAim(d);
    let yawMin = -1.92;
    let yawMax = 1.92;
    if (this.kind === "blackhawk") {
      // (Right door: -90 degrees +- 70; left: +90.)
      const c = i === 0 ? -Math.PI / 2 : Math.PI / 2;
      yawMin = c - 1.25;
      yawMax = c + 1.25;
    }
    const pMin = -1.05;
    const pMax = this.kind === "apache" ? 0.2 : 0.5;
    const inArc = a.yaw >= yawMin && a.yaw <= yawMax && a.pitch >= pMin - 0.05 && a.pitch <= pMax + 0.05;
    const wantY = clamp(a.yaw, yawMin, yawMax);
    const wantP = clamp(a.pitch, pMin, pMax);
    const rate = (this.kind === "apache" ? 2.6 : 3.2) * dt;
    const cy = gg.yawG.rotation.y;
    const cp = gg.pitchG.rotation.x;
    const ny = cy + clamp(wantY - cy, -rate, rate);
    const np = cp + clamp(wantP - cp, -rate, rate);
    this.model.setGun(ny, np, i);
    if (i === 0) {
      this.gunYaw = ny;
      this.gunPitch = np;
    }
    if (!inArc) return Infinity;
    return Math.abs(wantY - ny) + Math.abs(wantP - np);
  }

  _weapons(dt, input, ctl) {
    const mgr = this.manager;
    const S = this.spec;
    this.gunT -= dt;
    this.rocketT = Math.max(0, this.rocketT - dt);
    this.missileT = Math.max(0, this.missileT - dt);
    this.flareT = Math.max(0, this.flareT - dt);
    this.flashT += dt;
    this.heat = Math.max(0, this.heat - HEAT_COOL * dt);
    if (this.jammed && this.heat < 0.4) this.jammed = false;
    this.model.setFlash(this.flashT < 0.05 ? 1 - this.flashT / 0.05 : 0, this.flashI);
    // Rearming: on the ground with the stores spent (a ground crew's job),
    // or slowly in the air once a store is empty.
    if ((this.rockets < S.rockets || this.missilesLeft < S.missiles) && (this.onGround || this.rockets === 0 || this.missilesLeft === 0)) {
      this.rearmT += dt * (this.onGround ? 3 : 1);
      if (this.rearmT > 30) {
        this.rearmT = 0;
        this.rockets = S.rockets;
        this.missilesLeft = S.missiles;
        this.model.setStores(1, this.missilesLeft);
        if (this === mgr.active) mgr.onMessage?.("Rearmed: rockets and missiles");
      }
    } else this.rearmT = 0;
    if (!input) return;
    // The aim: what the crosshair is on.
    const from = this._viewOrigin(_v);
    const look = this._lookDir(_aimD);
    this.range = this._rangefind(from, look, 1400);
    this.aimPoint.copy(from).addScaledVector(look, this.range);
    // The gun(s) follow the aim.
    const errs = [this._slewGun(0, this.aimPoint, dt)];
    if (this.model.guns.length > 1) errs.push(this._slewGun(1, this.aimPoint, dt));
    // Left click: the gun.
    const firing = input.buttons[0] || input.pressed.has("mouse0");
    if (firing && this.jammed) {
      if (!this._jamT || this._jamT <= 0) {
        this._jamT = 0.8;
        mgr.onMessage?.("GUN OVERHEATED: let it cool");
        mgr.audio?.playOverheat?.();
      }
    }
    this._jamT = Math.max(0, (this._jamT || 0) - dt);
    if (firing && !this.jammed && this.gunT <= 0) {
      // (The gun whose arc has the aim; the chin gun always.)
      let gi = 0;
      if (errs.length > 1 && errs[1] < errs[0]) gi = 1;
      if (errs[gi] === Infinity && this.kind === "blackhawk") {
        if (!this._arcT || this._arcT <= 0) {
          this._arcT = 1.5;
          mgr.onMessage?.("The door guns can't reach there: turn the side to it");
        }
      } else this._fireGun(gi);
    }
    this._arcT = Math.max(0, (this._arcT || 0) - dt);
    // The Hellfire's seeker (auto aim) while they're selected.
    if (this.weapon === "missiles" && this.missilesLeft > 0) this._seek(dt, look);
    else this._clearLock();
    // Right click: rockets or a missile.
    if (input.pressed.has("mouse2")) {
      if (this.weapon === "rockets") this._fireRockets();
      else if (this.weapon === "missiles") this._fireMissile();
    }
    if (input.pressed.has("KeyC")) {
      if (this.flareT > 0) mgr.onMessage?.(`Flares reloading (${Math.ceil(this.flareT)} s)`);
      else this._launchFlares();
    }
  }

  _fireGun(i = 0, opts = {}) {
    const mgr = this.manager;
    const G_ = this.spec.gun;
    this.gunT = 1 / G_.rate;
    this.heat = Math.min(1, this.heat + G_.heat);
    if (this.heat >= 1) this.jammed = true;
    const from = this.muzzleWorld(i, new THREE.Vector3());
    const d = opts.dir ? opts.dir.clone() : this.gunDir(i, new THREE.Vector3());
    const sp = opts.spread ?? G_.spread;
    d.x += rand(-sp, sp);
    d.y += rand(-sp, sp);
    d.z += rand(-sp, sp);
    d.normalize();
    this._gunN = (this._gunN || 0) + 1;
    const c = this._tracer || (this._tracer = new THREE.Color(4.5, 2.6, 0.9));
    mgr.lasers?.fire({ from, dir: d, color: c, speed: G_.speed, damage: opts.damage ?? G_.damage, owner: opts.owner || "player", source: this, range: G_.range, radius: this.kind === "apache" ? 0.07 : 0.05, length: this.kind === "apache" ? 4 : 3, sound: false, tracer: this._gunN % 2 === 0 || this.kind === "apache", gun: "machinegun", scorch: this.kind === "apache", hole: true, cause: opts.cause || null });
    this.flashT = 0;
    this.flashI = i;
    // (Every round's report: our own loud, another's by distance.)
    if (this === mgr.active) {
      if (this.kind === "apache") mgr.audio?.playCannon?.();
      else mgr.audio?.playMachineGun?.();
    } else if (this._gunN % 2 === 0) {
      const ears = mgr.effects?.listener;
      mgr.audio?.playDistant?.(ears ? from.distanceTo(ears) : 0, () => (this.kind === "apache" ? mgr.audio.playCannon?.() : mgr.audio.playMachineGun?.()));
    }
    // (The 30 mm's little puff at the muzzle.)
    if (this.kind === "apache" && this._gunN % 3 === 0) mgr.effects.smoke.spawn({ x: from.x, y: from.y, z: from.z, vx: d.x * 2 + this.vel.x * 0.5, vy: 0.4, vz: d.z * 2 + this.vel.z * 0.5, life: 0.8, size0: 0.3, size1: 1.2, color0: this._puffC || (this._puffC = new THREE.Color(0.6, 0.58, 0.55)), alpha: 0.35, drag: 2 });
  }

  // A salvo of rockets: toward the crosshair when it is near the nose, else straight ahead.
  _fireRockets(opts = {}) {
    const mgr = this.manager;
    const S = this.spec;
    if (this.rocketT > 0 || this.rockets <= 0 || !this.model.rocketMuzzles.length) {
      if (this.rockets <= 0 && this === mgr.active && !opts.ai) mgr.onMessage?.("Rockets spent: they rearm on the ground (or in 30 s)");
      return false;
    }
    const n = Math.min(S.salvo, this.rockets);
    this.rocketT = S.rocketCooldown + n * 0.11;
    for (let i = 0; i < n; i++) this.queued.push({ t: i * 0.11, kind: "rocket", aim: opts.aim ? opts.aim.clone() : null, hostile: !!opts.hostile, target: opts.target || null, foes: opts.foes || null });
    this.rockets -= n;
    return true;
  }

  _fireMissile(opts = {}) {
    const mgr = this.manager;
    if (this.missileT > 0 || this.missilesLeft <= 0) {
      if (this.missilesLeft <= 0 && this === mgr.active && !opts.ai) mgr.onMessage?.("Hellfires spent: they rearm on the ground (or in 30 s)");
      return null;
    }
    this.missileT = this.spec.missileCooldown;
    const target = opts.target || (this.lock.locked && this._targetAlive(this.lock.target) ? this.lock.target : null);
    const m = this._launch("missile", { target, hostile: !!opts.hostile, foes: opts.foes || null });
    this.missilesLeft--;
    this.model.setStores(1, this.missilesLeft);
    if (this === mgr.active && target) voice.say("fox2");
    if (target?.kind === "ufo") target.ref.lockedOn = mgr.ufos?.time ?? 0;
    return m;
  }

  _updateQueue(dt) {
    for (let i = this.queued.length - 1; i >= 0; i--) {
      const q = this.queued[i];
      q.t -= dt;
      if (q.t > 0) continue;
      this.queued.splice(i, 1);
      if (this.alive) this._launch(q.kind, q);
    }
  }

  // One rocket or missile leaves its pod or rail.
  _launch(kind, o = {}) {
    const mgr = this.manager;
    const fwd = this.forward(_v);
    let from;
    let dir;
    if (kind === "rocket") {
      const ms = this.model.rocketMuzzles;
      this._podI = ((this._podI ?? -1) + 1) % Math.max(1, ms.length);
      this.root.updateMatrixWorld(true);
      from = ms[this._podI] ? ms[this._podI].getWorldPosition(new THREE.Vector3()) : this.toWorld(0, 1.2, -1, new THREE.Vector3());
      dir = fwd.clone();
      // (Toward the aim when it is within 20 degrees of the nose: the pylons
      // and the fire control's elevation.)
      const aim = o.aim || (this === mgr.active ? this.aimPoint : null);
      if (aim) {
        const want = _w.copy(aim).sub(from).normalize();
        // (Gravity drop: a little high over the range.)
        const range = aim.distanceTo(from);
        const t = range / ROCKET.speed;
        want.y += (0.5 * ROCKET.gravity * t * t) / Math.max(10, range);
        want.normalize();
        if (want.angleTo(fwd) < 0.35) dir.copy(want);
      }
      dir.x += rand(-ROCKET.spread, ROCKET.spread);
      dir.y += rand(-ROCKET.spread, ROCKET.spread);
      dir.z += rand(-ROCKET.spread, ROCKET.spread);
      dir.normalize();
    } else {
      const ms = this.model.missiles;
      const n = this.model.missiles.length;
      const rail = ms[n - 1 - this.missilesLeft] || ms[0];
      this.root.updateMatrixWorld(true);
      from = rail ? rail.getWorldPosition(new THREE.Vector3()) : this.toWorld(0, 1.2, -1, new THREE.Vector3());
      from.addScaledVector(fwd, -0.8);
      dir = fwd.clone();
      // (A slight loft: it climbs off the rail, then dives on its target.)
      dir.y += 0.05;
      dir.normalize();
    }
    const geo = kind === "rocket" ? heliRocketGeometry() : heliMissileGeometry();
    const mesh = new THREE.Mesh(geo, ordMaterial());
    mesh.position.copy(from);
    mgr.scene.add(mesh);
    const speed0 = kind === "rocket" ? ROCKET.speed * 0.6 : HELLFIRE.speed0;
    const m = { kind, pos: from, dir, vel: dir.clone().multiplyScalar(speed0).add(this.vel), speed: speed0, target: o.target || null, age: 0, mesh, trail: 0, hostile: !!o.hostile, foes: o.foes || null, launcher: this, decoyed: false, dead: false, lostT: 0 };
    this.missiles.push(m);
    this._ordSound(() => mgr.audio?.playRocketLaunch?.());
    // (The launch's flash and smoke at the pod.)
    const fx = mgr.effects;
    fx.glow.spawn({ x: from.x, y: from.y, z: from.z, life: 0.08, size0: 1.6, size1: 0.4, color0: this._hotC || (this._hotC = new THREE.Color(5, 3, 1.2)), alpha: 0.9 });
    for (let i = 0; i < 3; i++) fx.smoke.spawn({ x: from.x, y: from.y, z: from.z, vx: -dir.x * 4 + rand(-1, 1), vy: rand(-0.5, 1), vz: -dir.z * 4 + rand(-1, 1), life: rand(1.2, 2), size0: 0.6, size1: 2.4, color0: this._smokeC || (this._smokeC = new THREE.Color(0.8, 0.79, 0.76)), alpha: 0.45, drag: 1.6 });
    if (m.target && (m.target.kind === "player" || m.target.kind === "vehicle")) mgr.onMissileLaunched?.(m, this);
    return m;
  }

  // A sound of this helicopter's weapons: full from our own, by distance from
  // anyone else's (net/fx.js picks the place up from `soundAt`).
  _ordSound(fn) {
    const mgr = this.manager;
    if (this === mgr.active || !mgr.audio?.playDistant) return fn();
    mgr.soundAt = this.pos;
    try {
      mgr.audio.playDistant(Math.min(320, this.pos.distanceTo(mgr.effects.listener)), fn);
    } finally {
      mgr.soundAt = null;
    }
  }

  // ---------- The Hellfire's lock (auto aim) ----------

  // What can be locked: UFOs, the aliens' aircraft and ground vehicles
  // (their gunships too), enemy fighters. { kind, ref }.
  _lockables() {
    const mgr = this.manager;
    const out = [];
    for (const u of mgr.ufos?.ufos ?? []) {
      if (u.falling || u.state === "gone" || u.state === "leave") continue;
      out.push({ kind: "ufo", ref: u });
    }
    for (const v of mgr.vehicles) {
      if (v === this || !v.alive) continue;
      if (v.isEnemyGround) out.push({ kind: "vehicle", ref: v });
      else if (v.isEnemyJet) out.push({ kind: "jet", ref: v });
    }
    return out;
  }

  _targetPos(t, out) {
    const r = t.ref;
    if (t.kind === "player") return out.set(r.position.x, r.position.y + 0.9, r.position.z);
    if (r.isGround) return out.copy(r.pos).setY(r.pos.y + 1.3);
    return out.copy(r.pos);
  }

  _targetVel(t) {
    const r = t.ref;
    if (t.kind === "player") return r.vehicle ? r.vehicle.vel : r.velocity;
    return r.vel || null;
  }

  _targetAlive(t) {
    if (!t) return false;
    const r = t.ref;
    if (t.kind === "ufo") return !r.falling && r.state !== "gone";
    if (t.kind === "player") return !r.dead;
    if (t.kind === "decoy") return r.life > 0;
    return r.alive && this.manager.vehicles.includes(r);
  }

  // The seeker: the target nearest the crosshair within LOCK_CONE starts
  // it; kept within LOCK_HOLD it locks in LOCK_TIME (a slip drains it);
  // a lock is held anywhere in front of the view, lost out of range.
  _seek(dt, view) {
    const mgr = this.manager;
    const L = this.lock;
    const tp = _w;
    if (L.target && !this._targetAlive(L.target)) L.target = null;
    if (L.target) {
      const dv = this._targetPos(L.target, tp).sub(this.pos);
      const dist = dv.length();
      const ang = dist > 1e-3 ? dv.divideScalar(dist).angleTo(view) : 0;
      const inRange = dist > 30 && dist < LOCK_RANGE;
      if (L.locked) {
        if (inRange && ang < 1.0) L.out = 0;
        else if ((L.out += dt) > 0.5) L.target = null;
      } else if (inRange && ang < LOCK_HOLD) L.t += dt;
      else {
        L.t -= dt * 1.5;
        if (L.t <= 0 || !inRange) L.target = null;
      }
    }
    if (!L.target) {
      L.t = 0;
      L.out = 0;
      L.locked = false;
      let best = null;
      let ba = LOCK_CONE;
      for (const c of this._lockables()) {
        const dv = this._targetPos(c, tp).sub(this.pos);
        const dist = dv.length();
        if (dist < 30 || dist > LOCK_RANGE) continue;
        const ang = dv.divideScalar(dist).angleTo(view);
        if (ang < ba) {
          ba = ang;
          best = c;
        }
      }
      if (best) L.target = { kind: best.kind, ref: best.ref };
    }
    const was = L.locked;
    L.locked = !!L.target && (L.locked || L.t >= LOCK_TIME);
    L.progress = L.target ? (L.locked ? 1 : Math.min(1, L.t / LOCK_TIME)) : 0;
    if (L.locked && !was) mgr.audio?.playSalvoPip?.(1, 2);
    if (L.target) mgr.audio?.setSeekerTone?.(L.locked ? 2 : 1, L.progress);
    else if (this._toneOn) mgr.audio?.setSeekerTone?.(0, 0);
    this._toneOn = !!L.target;
  }

  _clearLock() {
    const L = this.lock;
    if (L.target && this._toneOn) this.manager.audio?.setSeekerTone?.(0, 0);
    this._toneOn = false;
    L.target = null;
    L.t = 0;
    L.locked = false;
    L.progress = 0;
  }

  // ---------- Ordnance in flight ----------

  _updateOrdnance(dt) {
    const mgr = this.manager;
    const fx = mgr.effects;
    for (let i = this.missiles.length - 1; i >= 0; i--) {
      const m = this.missiles[i];
      m.age += dt;
      if (m.kind === "rocket") {
        m.speed = Math.min(ROCKET.speed, m.speed + 500 * dt);
        m.dir.y -= (ROCKET.gravity / Math.max(60, m.speed)) * dt;
        m.dir.normalize();
      } else {
        m.speed = Math.min(HELLFIRE.speed, m.speed + HELLFIRE.accel * dt);
        if (m.hostile && m.age > 0.5) this._checkDecoys(m);
        const t = m.target;
        if (t && this._targetAlive(t) && m.age > 0.25) {
          const tp = this._targetPos(t, _ord);
          const tv = t.kind === "decoy" ? t.ref.vel : this._targetVel(t);
          const tgo = tp.distanceTo(m.pos) / Math.max(60, m.speed);
          if (tv) tp.addScaledVector(tv, tgo * 0.9);
          const want = tp.sub(m.pos).normalize();
          const ang = m.dir.angleTo(want);
          const max = HELLFIRE.turn * (m.hostile ? 0.85 : 1) * dt;
          if (ang > 1e-4) m.dir.lerp(want, Math.min(1, max / ang)).normalize();
          if (ang > 1.2 && m.age > 2) m.lostT += dt;
          if (m.lostT > 0.4) m.target = null;
        } else if (t && !this._targetAlive(t)) m.target = null;
      }
      m.vel.copy(m.dir).multiplyScalar(m.speed);
      const step = m.speed * dt;
      let boom = null;
      let direct = null;
      // The target's fuse (a guided missile), then what's in the way.
      const t = m.target;
      if (m.kind === "missile" && t && this._targetAlive(t)) {
        const tp = this._targetPos(t, _ord2);
        const r = t.kind === "decoy" ? 4 : t.kind === "ufo" ? t.ref.radius * 0.8 + 2 : t.kind === "player" ? 2.2 : (t.ref.hitRadius ?? t.ref.radius ?? 3) + 1;
        if (tp.distanceTo(m.pos) < r + step * 0.6) {
          boom = m.pos.clone().lerp(tp, 0.6);
          direct = t;
        }
      }
      if (!boom && m.age > 0.06) {
        const bh = mgr.world.raycast(m.pos, m.dir, step, { solidOnly: true });
        let best = bh ? bh.distance : step;
        if (bh) boom = m.pos.clone().addScaledVector(m.dir, Math.max(0, bh.distance - 0.4));
        const vh = mgr.raycast(m.pos, m.dir, best, this);
        if (vh && !(m.hostile && vh.vehicle.isEnemyGround) && vh.distance <= best) {
          best = vh.distance;
          boom = m.pos.clone().addScaledVector(m.dir, vh.distance);
          direct = { kind: "vehicle", ref: vh.vehicle };
        }
        if (!m.hostile) {
          const uh = mgr.ufos?.raycast(m.pos, m.dir, best);
          if (uh && uh.distance <= best) {
            best = uh.distance;
            boom = m.pos.clone().addScaledVector(m.dir, uh.distance);
            direct = { kind: "ufo", ref: uh.ufo };
          }
          if (m.age > 0.15 && !direct && mgr.mobs?.sphereHit(m.pos, 0.8)) boom = m.pos.clone();
        } else if (m.foes) {
          // (An enemy's rocket: the players on foot it flies past.)
          for (const p of m.foes()) {
            if (p.dead || p.vehicle) continue;
            const pp = p.position;
            if (Math.hypot(pp.x - m.pos.x, pp.y + 0.9 - m.pos.y, pp.z - m.pos.z) < 1.4 + step * 0.5) {
              boom = m.pos.clone();
              break;
            }
          }
        }
      }
      if (boom || m.age > (m.kind === "rocket" ? ROCKET.life : HELLFIRE.life) || m.pos.y < -10) {
        this.missiles.splice(i, 1);
        m.dead = true;
        mgr.scene.remove(m.mesh);
        if (boom) this._detonate(m, boom, direct);
        continue;
      }
      m.pos.addScaledVector(m.dir, step);
      m.mesh.position.copy(m.pos);
      m.mesh.quaternion.setFromUnitVectors(NEG_Z, m.dir);
      // The motor's glow and the smoke trail.
      const c = this._trailC || (this._trailC = [new THREE.Color(0.78, 0.77, 0.74), new THREE.Color(0.92, 0.91, 0.89), new THREE.Color(4, 2.4, 1)]);
      m.trail += step;
      const spacing = (m.kind === "rocket" ? 2.2 : 1.6) / Math.max(0.35, effectsQuality.scale);
      while (m.trail > spacing) {
        m.trail -= spacing;
        const back = _ord.copy(m.pos).addScaledVector(m.dir, -m.trail - 0.7);
        fx.smoke.spawn({ x: back.x, y: back.y, z: back.z, vx: rand(-0.3, 0.3), vy: 0.3, vz: rand(-0.3, 0.3), life: m.kind === "rocket" ? rand(1.2, 1.8) : rand(2, 3), size0: 0.4, size1: m.kind === "rocket" ? 1.6 : 2.2, color0: c[0], color1: c[1], alpha: 0.45, drag: 0.9 });
      }
      fx.glow.spawn({ x: m.pos.x - m.dir.x * 0.7, y: m.pos.y - m.dir.y * 0.7, z: m.pos.z - m.dir.z * 0.7, life: 0.06, size0: m.kind === "rocket" ? 0.9 : 1.2, size1: 0.3, color0: c[2], alpha: 0.9 });
    }
  }

  // A rocket's or missile's blast: what it struck takes a direct hit too.
  _detonate(m, at, direct) {
    const mgr = this.manager;
    const rocket = m.kind === "rocket";
    const dmg = rocket ? ROCKET.damage : HELLFIRE.damage;
    const mine = !m.hostile && !this.isEnemyHeli;
    if (direct?.kind === "ufo") {
      mgr.ufos.damage(direct.ref, rocket ? dmg * 1.5 : dmg, mine, at);
      if (mine) mgr.hitMarker?.();
    } else if (direct?.kind === "vehicle" || direct?.kind === "jet") {
      const ok = direct.ref.damage(dmg * (direct.ref.isEnemyJet && rocket ? 2 : 1), m.hostile ? "enemymissile" : "missile", mine);
      if (ok && mine && !direct.ref.puppet) mgr.hitMarker?.();
    } else if (direct?.kind === "player" && direct.ref.vehicle) {
      direct.ref.vehicle.damage(dmg * 0.6, "enemymissile");
    }
    // (Ours: a player's weapon; the aliens': the world's, which never credits anyone.)
    const source = m.hostile ? (rocket ? "enemyrocket" : "enemymissile") : rocket ? "bazooka" : "missile";
    mgr.effects.explode(at, { radius: rocket ? ROCKET.radius : HELLFIRE.radius, source, visual: rocket ? 4.5 : 7 });
  }

  // Flares fool a hostile missile (the aliens' Hellfire, a SAM) after this
  // helicopter: it turns on the nearest of them.
  _checkDecoys(m) {
    const t = m.target;
    if (!t || t.kind === "decoy" || m.decoyed) return;
    const owner = t.kind === "player" ? t.ref.vehicle : t.ref;
    if (!owner) return;
    let best = null;
    let bd = 600;
    for (const d of this.manager.lasers?.decoys ?? []) {
      if (d.life <= 0 || d.owner !== owner) continue;
      const dd = d.pos.distanceTo(m.pos);
      if (dd < bd && _ord2.copy(d.pos).sub(m.pos).normalize().angleTo(m.dir) < 1.1) {
        bd = dd;
        best = d;
      }
    }
    if (best) {
      m.decoyed = true;
      if (Math.random() < 0.85) m.target = { kind: "decoy", ref: best };
    }
  }

  // ---------- Flares ----------

  _launchFlares() {
    const mgr = this.manager;
    this.flareT = FLARE_COOLDOWN;
    this._salvo = { left: FLARE_SALVO, t: 0, n: 0 };
    this._releaseFlare();
    if (this === mgr.active) mgr.onMessage?.("FLARES!");
  }

  _releaseFlare() {
    const mgr = this.manager;
    const s = this._salvo;
    const i = s.n++;
    s.left--;
    const side = i % 2 ? 1 : -1;
    const pos = this.toWorld(side * 0.9, 1.2, 2.2, new THREE.Vector3());
    const right = this.right(_w);
    const vel = this.vel.clone().multiplyScalar(0.5).addScaledVector(right, side * rand(6, 12)).add(_b.set(rand(-2, 2), rand(-6, -2), rand(-2, 2)));
    const d = mgr.lasers?.addDecoy?.(pos, vel, 6);
    if (!d) return;
    d.owner = this;
    this.flares.push(d);
    if (mgr.audio?.playFlarePop) this._ordSound(() => mgr.audio.playFlarePop());
  }

  _updateFlares(dt) {
    const fx = this.manager.effects;
    const s = this._salvo;
    if (s) {
      s.t += dt;
      while (this.alive && s.left > 0 && s.t >= 0.12) {
        s.t -= 0.12;
        this._releaseFlare();
      }
      if (!this.alive || s.left <= 0) this._salvo = null;
    }
    for (let i = this.flares.length - 1; i >= 0; i--) {
      const d = this.flares[i];
      if (d.life <= 0) {
        this.flares.splice(i, 1);
        continue;
      }
      const c = this._flareC || (this._flareC = [new THREE.Color(6, 4.4, 2.4), new THREE.Color(0.8, 0.78, 0.75)]);
      const f = Math.min(1, d.life / 1.2);
      fx.glow.spawn({ x: d.pos.x, y: d.pos.y, z: d.pos.z, life: 0.07, size0: 2.2 * f + 0.5, size1: f + 0.3, color0: c[0], alpha: 0.95 });
      if (Math.random() < 0.5) fx.smoke.spawn({ x: d.pos.x, y: d.pos.y, z: d.pos.z, vx: rand(-0.3, 0.3), vy: 0.2, vz: rand(-0.3, 0.3), life: 1.6, size0: 0.5, size1: 2, color0: c[1], alpha: 0.4, drag: 0.9 });
    }
  }

  // ---------- Incoming missiles ----------

  _updateWarning(dt, pilot) {
    const mgr = this.manager;
    let best = null;
    let bd = 1500;
    const mine = (m) => m.hostile && m.target && (m.target.ref === this || (m.target.kind === "player" && m.target.ref.vehicle === this) || (m.target.kind === "decoy" && m.target.ref.owner === this));
    for (const v of mgr.vehicles) {
      if (!v.missiles || v === this) continue;
      for (const m of v.missiles) {
        if (!mine(m)) continue;
        const d = m.pos.distanceTo(this.pos);
        if (d < bd) {
          bd = d;
          best = m.pos;
        }
      }
    }
    if (mgr.remoteMissiles && !this.puppet) {
      for (const p of mgr.remoteMissiles(this)) {
        const d = p.distanceTo(this.pos);
        if (d < bd) {
          bd = d;
          best = p;
        }
      }
    }
    if (!best) {
      this.warn = null;
      this._warnPos = null;
      return;
    }
    if (pilot && !this.warn) voice.say("missile");
    this.warn = { dist: bd, kind: "missile" };
    this._warnPos = (this._warnPos || new THREE.Vector3()).copy(best);
    this.warnT -= dt;
    if (pilot && this.warnT <= 0) {
      this.warnT = clamp(bd / 900, 0.1, 0.8);
      mgr.audio?.playMissileWarning?.(bd < 350);
    }
  }

  // ---------- Looks: the rotors, the lights, the wash, damage ----------

  _animate(dt) {
    const m = this.model;
    this.rotorA += this.rpm * 31 * dt; // (about 5 turns a second at flight speed)
    this.tailA += this.rpm * 140 * dt;
    m.setRotor(this.rotorA, this.tailA, this.rpm);
    m.setLights(this.time, this.manager.night ?? 0, this.engineOn || this.rpm > 0.2);
    m.setNight(this.manager.night ?? 0);
  }

  _effects(dt) {
    const mgr = this.manager;
    const fx = mgr.effects;
    const q = Math.max(0.3, effectsQuality.scale);
    const cam = fx.listener;
    if (cam && cam.distanceToSquared(this.pos) > 260 * 260) return;
    // The rotor wash: dust (or spray) thrown out from under the rotor.
    this.washT -= dt;
    if (this.rpm > 0.45 && this.agl < WASH_HEIGHT && this.washT <= 0) {
      this.washT = 0.07 / q;
      const k = this.rpm * (1 - this.agl / WASH_HEIGHT);
      const gx = this.pos.x;
      const gz = this.pos.z;
      const gy = this.pos.y - CENTER_Y - this.agl;
      const below = mgr.world.getBlock(Math.floor(gx), Math.floor(gy - 0.5), Math.floor(gz));
      const wet = IS_WET[below];
      const col = wet ? this._sprayC || (this._sprayC = new THREE.Color(0.85, 0.9, 0.95)) : this._dustColor(below);
      const n = Math.max(1, Math.round(4 * k * q));
      for (let i = 0; i < n; i++) {
        const a = Math.random() * Math.PI * 2;
        const r = rand(1, this.layout.rotor.r * 0.9);
        const sp = rand(7, 13) * k + 2;
        fx.smoke.spawn({ x: gx + Math.cos(a) * r, y: gy + 0.3, z: gz + Math.sin(a) * r, vx: Math.cos(a) * sp, vy: rand(0.3, 1.6), vz: Math.sin(a) * sp, life: rand(0.9, 1.6), size0: 0.7, size1: 2.8 + k * 1.5, color0: col, alpha: (wet ? 0.45 : 0.35) * Math.min(1, k * 1.6), drag: 1.8 });
      }
    }
    // Damage: smoke from the engines below half, fire below a quarter.
    this.fxT -= dt;
    if (this.fxT > 0) return;
    this.fxT = 0.1 / q;
    const hp = this.health / this.maxHealth;
    if (hp < 0.5) {
      const c = this._dmgC || (this._dmgC = { s0: new THREE.Color(0.08, 0.075, 0.07), s1: new THREE.Color(0.3, 0.29, 0.28), fire: new THREE.Color(5, 2.4, 0.7) });
      for (const [x, y, z] of this.layout.exhaust) {
        const p = this.toWorld(x, y, z, _c);
        fx.smoke.spawn({ x: p.x, y: p.y, z: p.z, vx: rand(-0.4, 0.4), vy: 1.5, vz: rand(-0.4, 0.4), life: 2.5, size0: 0.6, size1: 3, color0: c.s0, color1: c.s1, alpha: 0.6 - hp * 0.6, drag: 0.7 });
        if (hp < 0.25) fx.glow.spawn({ x: p.x, y: p.y, z: p.z, vx: 0, vy: 2, vz: 0, life: 0.35, size0: 1.1, size1: 0.4, color0: c.fire, alpha: 0.75, drag: 1 });
      }
    }
  }

  _dustColor(id) {
    const rgb = this.manager.world.blockColors?.[id];
    const c = this._dustC || (this._dustC = new THREE.Color());
    if (rgb) c.setRGB(0.45 + rgb[0] * 0.35, 0.42 + rgb[1] * 0.3, 0.36 + rgb[2] * 0.25);
    else c.setRGB(0.62, 0.57, 0.48);
    return c;
  }

  _sound(pilot) {
    const mgr = this.manager;
    if (!mgr.audio?.ctx) return;
    if (!this.sound) this.sound = new RotorSound(mgr.audio);
    const ears = mgr.effects?.listener;
    const d = pilot || !ears ? 0 : this.pos.distanceTo(ears);
    const gain = pilot ? 1 : clamp(1 / (1 + d / 28), 0, 1) * (d > 320 ? 0 : 1);
    this.sound.set(this.rpm > 0.02 && this.root.visible, this.rpm, this.load, gain);
  }

  // ---------- Damage, destruction, the wreck ----------

  onDestroyed(cause) {
    const mgr = this.manager;
    if (this.occupied && !this.puppet) this.onExit();
    this.wreck = true;
    this.engineOn = false;
    this.crashing = !this.onGround && this.agl > 2;
    this.removeAt = 90; // (set again when it comes down)
    this.keepWreck = this.crashing;
    this._spin = rand(1.6, 2.6) * (Math.random() < 0.5 ? -1 : 1);
    this.queued.length = 0;
    this._clearLock();
    this.model.setBurnt(true, this.time);
    if (this === mgr.active || this.occupied) mgr.onMessage?.("MAYDAY! MAYDAY!");
    if (!this.crashing) this._impact();
    this.manager.onHeliDown?.(this, cause);
  }

  // The blast where the wreck comes down; the rotor breaks up.
  _impact() {
    const mgr = this.manager;
    this.crashing = false;
    this.keepWreck = false;
    this.removeAt = WRECK_TIME;
    this.vel.set(0, 0, 0);
    this._burnT = 0;
    this.model.rotor.visible = false;
    if (!this.puppet) mgr.effects.explode(this.pos.clone(), { radius: 3.5, source: "heli_boom", visual: 11 });
    // (Rotor pieces thrown out.)
    const fx = mgr.effects;
    const c = this._sootC || (this._sootC = new THREE.Color(0.12, 0.12, 0.12));
    for (let i = 0; i < 10; i++) fx.smoke.spawn({ x: this.pos.x, y: this.pos.y + 1, z: this.pos.z, vx: rand(-14, 14), vy: rand(4, 12), vz: rand(-14, 14), life: 1.4, size0: 0.5, size1: 0.3, color0: c, alpha: 1, gravity: 1, drag: 0.2 });
  }

  _updateWreck(dt) {
    const mgr = this.manager;
    const fx = mgr.effects;
    this.rpm = Math.max(0, this.rpm - dt * (this.crashing ? 0.25 : 1.5));
    if (this.crashing && !this.puppet) {
      // Autorotation of a sort: the tail gone, it spins, sinks and drifts on.
      this.yawRate += (this._spin * 2.4 - this.yawRate) * Math.min(1, dt * 1.2);
      this.yaw = wrap(this.yaw + this.yawRate * dt);
      this.pitch += (0.25 - this.pitch) * Math.min(1, dt * 0.8);
      this.roll += (this._spin * 0.12 - this.roll) * Math.min(1, dt * 0.8);
      this.vel.y -= G * 0.55 * dt;
      this.vel.x *= Math.exp(-dt * 0.3);
      this.vel.z *= Math.exp(-dt * 0.3);
      this.pos.addScaledVector(this.vel, dt);
      const g = this._groundAt(this.pos.x, this.pos.z, this.pos.y + 1);
      const solid = IS_SOLID[mgr.world.getBlock(Math.floor(this.pos.x), Math.floor(this.pos.y), Math.floor(this.pos.z))];
      if (this.pos.y - CENTER_Y <= g || solid || this.pos.y < -5) {
        this.pos.y = Math.max(this.pos.y, g + CENTER_Y * 0.6);
        this.pitch = 0.1;
        this.roll = this._spin * 0.15;
        this._impact();
      }
    }
    this.time += dt;
    this.rotorA += this.rpm * 31 * dt;
    this.model.setRotor(this.rotorA, this.rotorA * 4, this.rpm);
    this.model.setLights(this.time, 0, false);
    this.model.setBurnt(true, this.time);
    this._place();
    this.sound?.set(this.crashing && this.root.visible, this.rpm, 0.2, this === mgr.active ? 1 : clamp(1 / (1 + this.pos.distanceTo(fx.listener) / 28), 0, 1));
    // Fire and smoke: a trail while it falls, a burning wreck after.
    this.fxT -= dt;
    if (this.fxT > 0 || !this.root.visible) return;
    const q = Math.max(0.3, effectsQuality.scale);
    this.fxT = (this.crashing ? 0.04 : 0.12) / q;
    const c = this._wC || (this._wC = { fire: new THREE.Color(5, 2.4, 0.7), s0: new THREE.Color(0.07, 0.065, 0.06), s1: new THREE.Color(0.3, 0.29, 0.28) });
    const j = () => rand(-1, 1);
    const p = this.toWorld(0, 2.4, 1.2, _c);
    this._burnT = (this._burnT || 0) + dt;
    if (this.crashing || this._burnT < 20 || Math.random() < 0.4) fx.glow.spawn({ x: p.x + j(), y: p.y + j() * 0.5, z: p.z + j(), vx: j(), vy: 2, vz: j(), life: 0.45, size0: this.crashing ? 2.6 : 2, size1: 0.8, color0: c.fire, alpha: 0.7, drag: 1.2 });
    fx.smoke.spawn({ x: p.x + j(), y: p.y, z: p.z + j(), vx: j() * 0.5, vy: this.crashing ? 0.5 : 2.4, vz: j() * 0.5, life: this.crashing ? 3 : 6, size0: 1.4, size1: this.crashing ? 5 : 8, color0: c.s0, color1: c.s1, alpha: 0.7, drag: 0.5 });
  }

  // ---------- The camera, the HUD ----------

  onEnter() {
    this.lookYaw = this.yaw;
    this.lookPitch = -0.12;
    this.camYaw = this.lookYaw;
    this.camPitch = this.lookPitch;
    this.engineOn = true;
    const mgr = this.manager;
    if (!mgr.restoring) {
      if (this.rpm < 0.9) mgr.onMessage?.(`${this.spec.name}: engine start... the rotor spins up (a few seconds), then Space to lift off`);
      else mgr.onMessage?.(`${this.spec.name}: W/S tilt, A/D turn, Space/Shift up/down, mouse aims, LMB gun${this.spec.rockets ? ", RMB rockets (X: Hellfires)" : ""}, C flares`);
    }
  }

  onExit() {
    this.cameraMode = 0;
    this._clearLock();
    this.engineOn = false;
    const cam = this.manager.camera;
    if (cam && this.manager.player) {
      cam.fov = this.manager.player.fov || cam.fov;
      cam.updateProjectionMatrix();
    }
    const el = overlay();
    if (el) el.style.display = "none";
  }

  // From where the aim is taken: the chase camera, or the nose's sight.
  _viewOrigin(out) {
    if (this.cameraMode === 1) {
      const s = this.layout.sensor || [0, 1.2, this.layout.seat[2] - 2.5];
      return this.toWorld(s[0], s[1] - 0.45, s[2] - 0.5, out);
    }
    return this._camPos.lengthSq() ? out.copy(this._camPos) : out.copy(this.pos).setY(this.pos.y + 4);
  }

  updateCamera(camera, dt) {
    const mgr = this.manager;
    const S = this.spec;
    const sight = this.cameraMode === 1;
    const fov = sight ? S.zoom : mgr.player?.fov || 75;
    if (Math.abs(camera.fov - fov) > 0.05) {
      camera.fov += (fov - camera.fov) * Math.min(1, dt * 10);
      if (Math.abs(camera.fov - fov) < 0.1) camera.fov = fov;
      camera.updateProjectionMatrix();
    }
    if (sight) {
      this._viewOrigin(camera.position);
      camera.quaternion.setFromEuler(_e.set(this.lookPitch, this.lookYaw, 0, "YXZ"));
    } else {
      // Behind and above the helicopter, looking where the mouse aims (the
      // camera's pivot follows the airframe with a little lag).
      const back = _v.set(Math.sin(this.lookYaw) * Math.cos(this.lookPitch), -Math.sin(this.lookPitch), Math.cos(this.lookYaw) * Math.cos(this.lookPitch));
      const pivot = _w.copy(this.pos).setY(this.pos.y + 1.5);
      const want = _c.copy(pivot).addScaledVector(back, S.camBack);
      want.y += S.camUp * (1 - Math.max(0, -this.lookPitch) * 0.6);
      if (!this._camInit) {
        this._camInit = true;
        this._camLag = want.clone();
      }
      this._camLag.lerp(want, Math.min(1, dt * 9));
      camera.position.copy(this._camLag);
      const g = mgr.groundBelow(camera.position.x, camera.position.y + 2, camera.position.z);
      if (camera.position.y < g + 1.2) camera.position.y = g + 1.2;
      const look = _b.copy(pivot).addScaledVector(this._lookDir(_a), 40).sub(camera.position).normalize();
      camera.quaternion.setFromUnitVectors(NEG_Z, look);
      // (No roll: set from yaw and pitch.)
      camera.quaternion.setFromEuler(_e.set(Math.asin(clamp(look.y, -1, 1)), Math.atan2(-look.x, -look.z), 0, "YXZ"));
    }
    this._camPos.copy(camera.position);
    // (While the camera looks along the crosshair's ray, keep the look and the
    // camera agreeing: the aim is the screen's centre.)
    this._drawOverlay(camera);
  }

  _drawOverlay(camera) {
    const el = overlay();
    if (!el) return;
    const fresh = performance.now() - this._hudSeen < 2500;
    const show = this.occupied && this.alive && fresh && !document.body.classList.contains("hud-off");
    el.style.display = show ? "block" : "none";
    if (!show) return;
    const P = el._p;
    const W = window.innerWidth;
    const H = window.innerHeight;
    const sight = this.cameraMode === 1;
    P.sight.style.display = sight ? "block" : "none";
    P.cross.setAttribute("transform", `translate(${W / 2},${H / 2})`);
    // The gun's pipper: where its rounds go now (it slides onto the crosshair as the turret comes round).
    const place = (g, p, show) => {
      if (!show) {
        g.style.display = "none";
        return;
      }
      const s = p.project(camera);
      if (s.z >= 1 || Math.abs(s.x) > 1.2 || Math.abs(s.y) > 1.2) {
        g.style.display = "none";
        return;
      }
      g.style.display = "block";
      g.setAttribute("transform", `translate(${(((s.x + 1) / 2) * W).toFixed(1)},${(((1 - s.y) / 2) * H).toFixed(1)})`);
    };
    const gi = this.flashI || 0;
    const mz = this.muzzleWorld(gi, _a);
    place(P.gun, _b.copy(mz).addScaledVector(this.gunDir(gi, _c), Math.min(this.range, 600)), true);
    P.gun.setAttribute("stroke", this.jammed ? "rgba(255,90,60,0.95)" : this.heat > 0.7 ? "rgba(255,200,90,0.95)" : "rgba(130,255,160,0.95)");
    // The rockets' cue: where a salvo would go (the nose's line, near the aim).
    if (this.spec.rockets && this.weapon === "rockets") {
      const fwd = this.forward(_c);
      const dir = _a.copy(this.aimPoint).sub(this.pos).normalize();
      if (dir.angleTo(fwd) >= 0.35) dir.copy(fwd);
      place(P.rkt, _b.copy(this.pos).addScaledVector(dir, Math.min(this.range, 500)), true);
    } else place(P.rkt, _b, false);
    // The horizon bars: the airframe's roll.
    P.horizon.setAttribute("transform", `translate(${W / 2},${H / 2}) rotate(${((-this.roll * 180) / Math.PI).toFixed(1)})`);
    const txt = `${this.rpm < 0.98 ? `ROTOR ${Math.round(this.rpm * 100)}%  ` : ""}${this.weapon === "missiles" ? `HELLFIRE ${this.missilesLeft}${this.lock.locked ? "  LOCK" : ""}` : this.weapon === "rockets" ? `ROCKETS ${this.rockets}` : "GUN"}  ${Math.round(this.range)} m`;
    if (P.read._t !== txt) {
      P.read._t = txt;
      P.read.textContent = txt;
    }
  }

  // What the fighter HUD draws (js/fighter-hud.js, as a jet's: vehicle-jet.js
  // _hudData): the boresight, the seeker's circle while the Hellfires are
  // selected, the locked target, our missiles on their way, the threat.
  overlay(camera) {
    const L = this.lock;
    const look = this._lookDir(_v);
    const bore = (this._hudBore ||= new THREE.Vector3()).copy(this._camPos.lengthSq() ? this._camPos : this.pos).addScaledVector(look, 600);
    const t = L.target && this._targetAlive(L.target) ? L.target : null;
    let target = null;
    if (t) {
      const pos = this._targetPos(t, (this._hudTp ||= new THREE.Vector3()));
      const r = t.ref;
      const d = _w.copy(pos).sub(this.pos);
      const dist = d.length();
      const tv = this._targetVel(t);
      const closure = dist > 1e-3 ? (this.vel.dot(d) - (tv ? tv.dot(d) : 0)) / dist : 0;
      const name = t.kind === "ufo" ? (r.boss ? String(r.bossName || "BOSS").toUpperCase() : "UFO") : r.isGunship ? "GUNSHIP" : r.isEnemyJet ? "BANDIT" : r.type === "aa" ? "AA" : r.type === "enemytel" ? "LAUNCHER" : "TANK";
      target = { pos, radius: t.kind === "ufo" ? r.radius : (r.hitRadius ?? r.radius ?? 4), name, dist, closure, progress: L.progress, locked: L.locked, salvo: false, charge: 0, n: 0, pips: 0, holding: false, auto: true };
    }
    const missiles = [];
    for (const m of this.missiles) {
      if (m.kind !== "missile" || !m.target || m.hostile || m.target.kind === "decoy") continue;
      const tp = this._targetPos(m.target, _w);
      missiles.push({ pos: m.pos, ttg: tp.distanceTo(m.pos) / Math.max(40, m.speed), onTarget: !!t && m.target.ref === t.ref });
    }
    return {
      lock: null,
      nose: null,
      warn: null,
      aim: null,
      hud: {
        bore,
        cone: this.weapon === "missiles" && this.missilesLeft > 0 ? LOCK_CONE : 0,
        target,
        missiles,
        threat: this.warn && this._warnPos ? { pos: this._warnPos, dist: this.warn.dist, kind: this.warn.kind } : null,
        spiked: null,
      },
    };
  }

  hud() {
    this._hudSeen = performance.now();
    const S = this.spec;
    const kmh = Math.round(Math.hypot(this.vel.x, this.vel.z) * 3.6);
    const vs = this.vel.y;
    const w = this.weapon === "missiles" ? `Hellfire x${this.missilesLeft}${this.lock.locked ? " (LOCKED)" : this.lock.target ? " (locking)" : ""}` : this.weapon === "rockets" ? `Rockets x${this.rockets}` : "Gun";
    const rows = [
      ["Speed", `${kmh} km/h`],
      ["Height", `${Math.max(0, Math.round(this.agl))} m`],
      ["Climb", `${vs >= 0 ? "+" : ""}${vs.toFixed(1)} m/s`],
      ["Rotor", `${Math.round(this.rpm * 100)}%`],
    ];
    if (S.rockets) rows.push(["Stores", `${this.rockets} rockets, ${this.missilesLeft} Hellfires`]);
    rows.push(["Flares", this.flareT > 0 ? `${Math.ceil(this.flareT)} s` : "ready"]);
    const hp = this.health / this.maxHealth;
    return {
      title: S.name,
      rows,
      bars: [{ label: "Gun heat", value: this.heat, hot: this.jammed || this.heat > 0.7 }],
      weapon: w,
      warning: this.warn ? `MISSILE ${Math.round(this.warn.dist)} m: flares (C)!` : hp < 0.25 ? "ENGINE FIRE: land now!" : this.rpm < LIFT_RPM && !this.onGround ? "LOW ROTOR!" : this.onGround && this.rpm < 0.98 ? "Engine starting..." : "",
      health: hp,
      help: `W/S tilt, A/D turn, Q/E sidestep, Space/Shift up/down, LMB gun${S.rockets ? ", RMB fire, X weapon" : ""}, C flares, V sight, F get out`,
    };
  }

  infoPanel() {
    const S = this.spec;
    return {
      title: S.name,
      stats: [
        ["Armour", `${Math.round(this.health)} / ${this.maxHealth}`],
        ["Top speed", `about ${Math.round(82 * 3.6)} km/h (tilted all the way)`],
        ["Climb", `${CLIMB} m/s up, ${SINK} m/s down`],
        ["Gun", `${S.gun.rate} rounds/s, ${S.gun.damage} damage each; overheats`],
        ...(S.rockets ? [["Rockets", `${S.rockets} in two pods, salvos of ${S.salvo}`], ["Hellfires", `${S.missiles}, guided: lock in ${LOCK_TIME} s round the crosshair`]] : []),
        ["Flares", `a salvo of ${FLARE_SALVO}, ${FLARE_COOLDOWN} s to reload`],
        ["Rearming", "on the ground, or 30 s after a store runs out"],
      ],
      controls: [
        ["W / S", "Nose down / up: forward, back"],
        ["A / D", "Turn (the pedals)"],
        ["Q / E", "Roll: sidestep"],
        ["Space / Shift", "Climb / sink (let go: hold the height)"],
        ["Mouse", "Aim the gun and the view (flying forward, the nose follows)"],
        ["Left click", "Gun"],
        ...(S.rockets ? [["Right click", "Rockets or a Hellfire"], ["X / wheel / 2 / 3", "Rockets or Hellfires"]] : []),
        ["C", "Flares"],
        ["V / F5", "Gunner's sight"],
        ["F", "Get out (on the ground: the engine stops)"],
      ],
    };
  }

  // ---------- Hits: two boxes (the cabin, the boom), in its own frame of motion ----------

  _boxes() {
    return BOXES[this.kind] || BOXES.apache;
  }

  sweptRaycast(origin, dir, step, pad = 0, dt = 0) {
    if (this.pos.distanceTo(origin) - step > 12 + pad + this.vel.length() * dt) return null;
    _qi.copy(this.q).invert();
    // (The segment as seen from the moving helicopter: it moved vel*dt meanwhile.)
    const o = _bo.copy(origin).sub(this.pos).applyQuaternion(_qi);
    const e = _bd.copy(dir).multiplyScalar(step);
    if (dt) e.addScaledVector(this.vel, -dt);
    e.applyQuaternion(_qi);
    let best = null;
    for (const b of this._boxes()) {
      const t = slab(o.x - b.c[0], o.y - b.c[1], o.z - b.c[2], e.x, e.y, e.z, b.h[0] + pad, b.h[1] + pad, b.h[2] + pad);
      if (t !== null && (best === null || t < best)) best = t;
    }
    return best === null ? null : best * step;
  }

  raycast(origin, dir, maxDist) {
    return this.sweptRaycast(origin, dir, maxDist, 0, 0);
  }

  segmentHit(a, b, pad = 0) {
    const len = a.distanceTo(b);
    if (len < 1e-6) return this.hullDistance(a, pad + 1) <= pad;
    return this.sweptRaycast(a, _c.copy(b).sub(a).divideScalar(len), len, pad) !== null;
  }

  hullDistance(p, max = Infinity) {
    _qi.copy(this.q).invert();
    const o = _bo.copy(p).sub(this.pos).applyQuaternion(_qi);
    let best = Infinity;
    for (const b of this._boxes()) {
      const dx = Math.max(0, Math.abs(o.x - b.c[0]) - b.h[0]);
      const dy = Math.max(0, Math.abs(o.y - b.c[1]) - b.h[1]);
      const dz = Math.max(0, Math.abs(o.z - b.c[2]) - b.h[2]);
      best = Math.min(best, Math.hypot(dx, dy, dz));
    }
    return Math.min(max, best);
  }

  // ---------- Online (net/vehicles.js) ----------

  netState(s) {
    s.q = this.q.toArray().map((x) => Math.round(x * 1000) / 1000);
    s.k = this.kind;
    s.r = Math.round(this.rpm * 100) / 100;
    s.g = [Math.round(this.gunYaw * 100) / 100, Math.round(this.gunPitch * 100) / 100];
    s.f = (this.flashT < 0.1 ? 1 : 0) | (this.onGround ? 2 : 0) | (this.crashing ? 4 : 0) | (this.flashI ? 8 : 0);
    s.st = [this.rockets, this.missilesLeft];
    s.ag = Math.round(this.agl * 10) / 10;
  }

  netPuppet(st, dt) {
    if (st) {
      if (Array.isArray(st.q) && st.q.length === 4) {
        this.q.fromArray(st.q).normalize();
        _e.setFromQuaternion(this.q, "YXZ");
        this.pitch = _e.x;
        this.yaw = _e.y;
        this.roll = _e.z;
      }
      if (Number.isFinite(st.r)) this.rpm = st.r;
      if (Array.isArray(st.g)) {
        this.gunYaw = st.g[0];
        this.gunPitch = st.g[1];
        this.model.setGun(st.g[0], st.g[1], 0);
      }
      const f = st.f | 0;
      this.onGround = !!(f & 2);
      if (f & 1) {
        this.flashT = 0;
        this.flashI = f & 8 ? 1 : 0;
      }
      if (Number.isFinite(st.ag)) this.agl = st.ag;
      if (Array.isArray(st.st) && Number.isFinite(st.st[1]) && st.st[1] !== this.missilesLeft) {
        this.missilesLeft = st.st[1] | 0;
        this.model.setStores(1, this.missilesLeft);
      }
      if (!this.alive && !(f & 4) && !this.wreck) {
        this.wreck = true;
        this.model.setBurnt(true, this.time);
      }
      if (!this.alive && !(f & 4) && this.crashing) this.crashing = false;
      if (!this.alive && f & 4) this.crashing = true;
    }
    this.time += dt;
    this.flashT += dt;
    this.engineOn = this.rpm > 0.05;
    this.root.position.copy(this.pos);
    if (!this.alive) {
      if (!this.wreck) {
        this.wreck = true;
        this.crashing = true;
      }
      this.model.setBurnt(true, this.time);
      if (!this.crashing) this.model.rotor.visible = false;
      this.rotorA += this.rpm * 31 * dt;
      this.model.setRotor(this.rotorA, this.rotorA * 4, this.rpm);
      this._place();
      this._wreckPuppetFx(dt);
      this.sound?.set(false);
      this._updateOrdnance(dt);
      this._updateFlares(dt);
      return;
    }
    this.model.setFlash(this.flashT < 0.05 ? 1 - this.flashT / 0.05 : 0, this.flashI);
    this._place();
    this._animate(dt);
    this._effects(dt);
    this._sound(false);
    this._updateOrdnance(dt);
    this._updateFlares(dt);
  }

  // Another machine's falling or burning wreck, drawn here.
  _wreckPuppetFx(dt) {
    const fx = this.manager.effects;
    this.fxT -= dt;
    if (this.fxT > 0 || !this.root.visible) return;
    const q = Math.max(0.3, effectsQuality.scale);
    this.fxT = (this.crashing ? 0.05 : 0.14) / q;
    const c = this._wC || (this._wC = { fire: new THREE.Color(5, 2.4, 0.7), s0: new THREE.Color(0.07, 0.065, 0.06), s1: new THREE.Color(0.3, 0.29, 0.28) });
    const p = this.toWorld(0, 2.4, 1.2, _c);
    fx.glow.spawn({ x: p.x, y: p.y, z: p.z, vx: rand(-1, 1), vy: 2, vz: rand(-1, 1), life: 0.4, size0: 2.2, size1: 0.8, color0: c.fire, alpha: 0.7, drag: 1.2 });
    fx.smoke.spawn({ x: p.x, y: p.y, z: p.z, vx: rand(-0.5, 0.5), vy: 2, vz: rand(-0.5, 0.5), life: 5, size0: 1.4, size1: 7, color0: c.s0, color1: c.s1, alpha: 0.7, drag: 0.5 });
  }

  serialize() {
    const data = { ...super.serialize(), kind: this.kind, paint: this.paint, yaw: Math.round(this.yaw * 1000) / 1000, q: this.q.toArray().map((x) => Math.round(x * 10000) / 10000), rockets: this.rockets, missiles: this.missilesLeft };
    if (!this.onGround) {
      data.airborne = true;
      data.rpm = Math.round(this.rpm * 100) / 100;
    }
    if (this.tookKey) data.tookKey = this.tookKey;
    if (this.missionHeli) data.missionHeli = true;
    return data;
  }

  dispose() {
    super.dispose();
    for (const m of this.missiles) this.manager.scene.remove(m.mesh);
    this.missiles.length = 0;
    this.sound?.stop();
    this.model.dispose?.();
    if (this === this.manager.active || this.occupied) {
      const el = overlay();
      if (el) el.style.display = "none";
    }
  }
}

// Ray (o + t e, t 0..1) against a box of half sizes (hx, hy, hz) at the
// origin: the entry t, or null.
function slab(ox, oy, oz, ex, ey, ez, hx, hy, hz) {
  let t0 = 0;
  let t1 = 1;
  for (const [o, e, h] of [[ox, ex, hx], [oy, ey, hy], [oz, ez, hz]]) {
    if (Math.abs(e) < 1e-9) {
      if (o < -h || o > h) return null;
      continue;
    }
    let a = (-h - o) / e;
    let b = (h - o) / e;
    if (a > b) [a, b] = [b, a];
    if (a > t0) t0 = a;
    if (b < t1) t1 = b;
    if (t0 > t1) return null;
  }
  return t0;
}

VehicleManager.register("heli", Heli);

// Creative's helicopters (the palette's Vehicles tab: js/content/vehicles.js;
// the pause menu's call-in, `ground`: parked a few blocks ahead with the
// engine off, the player straight in it). Aimed at the sky: in the air,
// hovering, the rotor at speed. (Sneaking: the Black Hawk.)
VehicleManager.registerSummon("heli", {
  type: "heli",
  alt: 35,
  ground: true,
  data: (mgr, ctx) => ({ kind: ctx?.sneaking ? "blackhawk" : "apache" }),
  launch(v) {
    v.rpm = 1;
    v.engineOn = true;
    v.onGround = false;
    v.agl = 30;
  },
});
VehicleManager.registerSummon("blackhawk", {
  type: "heli",
  alt: 35,
  ground: true,
  data: () => ({ kind: "blackhawk" }),
  launch(v) {
    v.rpm = 1;
    v.engineOn = true;
    v.onGround = false;
    v.agl = 30;
  },
});

// Puts a helicopter down (a mission, the airports): kind "apache" | "blackhawk", at pos (on the ground), heading yaw.
export function placeHeli(vehicles, kind = "apache", pos, yaw = 0, extra = {}) {
  const v = vehicles.create("heli", { kind, pos: [pos.x, pos.y + CENTER_Y, pos.z], yaw, ...extra });
  if (v) v.settle();
  return v;
}
