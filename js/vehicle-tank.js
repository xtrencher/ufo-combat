// (Round 13) Tanks on the shared vehicle framework (vehicles.js), and what
// every ground vehicle shares (GroundVehicle: the enemy tanks and AA
// vehicles of tanks.js and the missile trucks of ballistic.js build on it).
//
// Driving: tracks on the blocks. The hull sits on the ground under its four
// corners (pitch and roll follow the slope), climbs a one-block step, drops
// off a ledge (and lands with a thump), is stopped by anything higher (a
// wall, a tree trunk), crushes the leaves and plants in its way, is slowed
// by water and won't go into water deeper than its hull. W/S throttle (S
// brakes, then backs up), A/D turn the hull (it turns on the spot too).
//
// The gun: the mouse aims; the turret traverses and the gun elevates toward
// the aim at their own (slow) rates, so a heavy turret takes a few seconds
// to come round. The fire control works out the range (what the crosshair
// is on) and the elevation the shell's arc needs; a circle shows where the
// shell will land right now, and slides onto the crosshair as the gun
// comes round. Left click fires the main gun (an HE shell on a ballistic
// arc: a tracer you can follow; reload 4-5 s), right click the coaxial
// machine gun, C pops the smoke launchers (a screen the enemy can't see
// through), V (or F5) the gunner's sight: a zoomed view along the gun with
// stadia and range marks and the rangefinder's reading. Firing: the barrel
// recoils, the hull rocks back, the muzzle flash, the dust ring off the
// ground around the tank and the muzzle smoke (effects.js tankFire).
//
// Armour: hits hurt the hull like any vehicle's (the HUD shows it); below
// half it smokes, below a quarter it burns; at nothing it cooks off: fire
// from the hatches, the big blast, the turret thrown off, a burning wreck.
//
// Online (js/net/vehicles.js, js/net/ground.js): the owner drives it and
// sends its pose (hull, turret, gun) with the vehicle states; its shots go
// to everyone as a "gfire" (the shell is flown everywhere, the owner's is
// the real one: its blast reaches everyone as an explosion).
import * as THREE from "three";
import { Vehicle, VehicleManager } from "./vehicles.js";
import { createTankModel } from "./tank-model.js";
import { IS_SOLID, IS_WET, IS_LEAVES, IS_REPLACEABLE, SHAPE_OF, BLOCK } from "./blocks.js";
import { effectsQuality } from "./effects.js";
import { WORLD_HEIGHT } from "./constants.js";

export const SHELL_G = 20; // gravity on a shell (blocks/s^2)
const STEP_UP = 1.15; // the highest step a hull climbs (blocks)
const DEEP_WATER = 2.4; // deeper than this it won't drive in
const WRECK_TIME = 40; // seconds a burnt-out wreck stays
const SMOKE_COOLDOWN = 25;
const CHASE_TILT = 0.12; // (the chase view's look down past the turret)

// The drivable tanks (and the specs every ground vehicle reads). speed and
// reverse in blocks/s, accel and brake in blocks/s^2, turn (hull) and
// traverse (turret) in rad/s, elev the gun's rate, pitch limits in
// radians, reload in seconds, shell speed in blocks/s; damage: a direct
// hit's extra on what it strikes (the blast does the rest); radius: the
// shell's blast (what it digs and hurts), look: how big it looks.
export const TANK_TYPES = {
  tiger: { id: "tiger", name: "Tiger heavy tank", short: "heavy WWII tank: thick armour, the long 88", paint: "grey", maxHealth: 460, speed: 8.5, reverse: 3.5, accel: 2.6, brake: 9, turn: 0.5, traverse: 0.42, elev: 0.28, minPitch: -0.14, maxPitch: 0.3, reload: 5, shellSpeed: 240, damage: 85, ufoDamage: 130, blast: 5.5, look: 9.5, zoom: 26, camBack: 13, camUp: 5.2, coax: 0.1, mass: 4 },
  mbt: { id: "mbt", name: "Main battle tank", short: "modern tank: fast, a stabilised 120 mm gun", paint: "olive", maxHealth: 400, speed: 14, reverse: 5.5, accel: 4.2, brake: 12, turn: 0.75, traverse: 0.85, elev: 0.45, minPitch: -0.16, maxPitch: 0.36, reload: 4, shellSpeed: 300, damage: 80, ufoDamage: 120, blast: 5, look: 9, zoom: 18, camBack: 14, camUp: 5.5, coax: 0.085, mass: 4 },
};

const _v = new THREE.Vector3();
const _w = new THREE.Vector3();
const _u = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _qi = new THREE.Quaternion();
const _e = new THREE.Euler();
const _m4 = new THREE.Matrix4();
// (The aim's ray: kept apart from the scratch vectors the hit tests use.)
const _cam = new THREE.Vector3();
const _bo = new THREE.Vector3(); // (the hit tests' own)
const _bd = new THREE.Vector3();
const _sd = new THREE.Vector3(); // (the shells' own)
const _sm = new THREE.Vector3();
const _sb = new THREE.Vector3();
const _ip = new THREE.Vector3(); // (impactPoint's own)
const _iv = new THREE.Vector3();
const _id = new THREE.Vector3();
const _look = new THREE.Vector3();

function clamp(v, a, b) {
  return v < a ? a : v > b ? b : v;
}
function wrapAngle(a) {
  return Math.atan2(Math.sin(a), Math.cos(a));
}
// Turns `cur` toward `want` (angles) by at most `rate`.
function slew(cur, want, rate) {
  const d = wrapAngle(want - cur);
  return cur + clamp(d, -rate, rate);
}

// The low-arc elevation (radians above the horizon) that puts a shell at
// speed v on a point dx away horizontally and dy higher; null out of range.
export function ballisticPitch(dx, dy, v, g = SHELL_G) {
  const v2 = v * v;
  const disc = v2 * v2 - g * (g * dx * dx + 2 * dy * v2);
  if (disc < 0 || dx < 1e-3) return dx < 1e-3 ? Math.atan2(dy, 1e-3) : null;
  return Math.atan((v2 - Math.sqrt(disc)) / (g * dx));
}

// ---------- Sounds (built here on the game's audio context) ----------

// A tank gun's report: a sharp crack, a deep boom, a rumble (falls off and
// lags with distance like an explosion's).
export function playTankGun(audio, distance = 0, size = 1) {
  if (!audio?.ctx) return;
  audio.playExplosion?.(distance, 0.9 * size);
  if (distance < 60) audio._hit?.({ type: "highpass", f: 2200, q: 0.7, d: 0.09, v: 0.5 * size * (1 - distance / 60), attack: 0.002 });
}

// The engine (a diesel's low thrum and the tracks' clatter) and the
// turret's traverse whine, for the vehicle the player drives: one loop.
class EngineSound {
  constructor(audio) {
    this.audio = audio;
    this.nodes = null;
  }
  _start() {
    const a = this.audio;
    const ctx = a?.ctx;
    if (!ctx || this.nodes) return;
    a._cat?.("weapons");
    const out = ctx.createGain();
    out.gain.value = 0;
    out.connect(a._out || a.master);
    const lp = ctx.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.value = 320;
    lp.connect(out);
    const o1 = ctx.createOscillator();
    o1.type = "sawtooth";
    o1.frequency.value = 34;
    const o2 = ctx.createOscillator();
    o2.type = "square";
    o2.frequency.value = 51;
    const g2 = ctx.createGain();
    g2.gain.value = 0.35;
    o1.connect(lp);
    o2.connect(g2).connect(lp);
    // The tracks: filtered noise, louder with speed.
    const noise = a._noise ? a._noise(ctx.currentTime, 60) : null;
    const bp = ctx.createBiquadFilter();
    bp.type = "bandpass";
    bp.frequency.value = 700;
    bp.Q.value = 0.8;
    const ng = ctx.createGain();
    ng.gain.value = 0;
    if (noise) {
      noise.loop = true;
      noise.connect(bp).connect(ng).connect(out);
    }
    // The traverse: a thin electric whine.
    const ow = ctx.createOscillator();
    ow.type = "triangle";
    ow.frequency.value = 820;
    const wg = ctx.createGain();
    wg.gain.value = 0;
    ow.connect(wg).connect(a._out || a.master);
    o1.start();
    o2.start();
    ow.start();
    this.nodes = { out, o1, o2, ng, ow, wg, noise };
  }
  set(on, rpm, speed, traverse) {
    if (!on) {
      if (this.nodes) {
        const n = this.nodes;
        const t = this.audio.ctx.currentTime;
        n.out.gain.setTargetAtTime(0, t, 0.15);
        n.wg.gain.setTargetAtTime(0, t, 0.05);
        setTimeout(() => {
          try {
            n.o1.stop();
            n.o2.stop();
            n.ow.stop();
            n.noise?.stop();
          } catch {}
        }, 600);
        this.nodes = null;
      }
      return;
    }
    this._start();
    const n = this.nodes;
    if (!n) return;
    const t = this.audio.ctx.currentTime;
    n.o1.frequency.setTargetAtTime(30 + rpm * 32, t, 0.12);
    n.o2.frequency.setTargetAtTime(45 + rpm * 48, t, 0.12);
    n.out.gain.setTargetAtTime(0.12 + rpm * 0.16, t, 0.12);
    n.ng.gain.setTargetAtTime(Math.min(0.35, speed * 0.03), t, 0.1);
    n.wg.gain.setTargetAtTime(Math.min(0.05, traverse * 0.12), t, 0.05);
    n.ow.frequency.setTargetAtTime(700 + traverse * 500, t, 0.05);
  }
}

// ---------- Shells ----------

// Every shell in flight (the main guns' HE, the enemy's): flown with
// gravity, a glowing tracer and a thin smoke trail; on what it strikes (the
// ground, a vehicle, a UFO, a creature, a player) it bursts. A shell of
// this machine's is real (its blast is the explosion everyone sees and
// feels; a direct hit adds its damage to what it struck); another
// machine's (`remote`) is drawn only, and vanishes where it lands.
export class ShellSystem {
  constructor(manager) {
    this.manager = manager;
    this.shells = [];
    this.driven = false; // (updated by the ground war each frame; else by the first tank)
    this.fired = 0;
    this.hits = []; // (tests: the last impacts { at, what, t })
    this._c = { hot: new THREE.Color(5, 3, 1.2), trail0: new THREE.Color(0.55, 0.53, 0.5), trail1: new THREE.Color(0.7, 0.69, 0.67) };
  }

  // o: { pos, vel, owner (a vehicle), cause, damage, ufoDamage, radius, look, remote, targets }
  fire(o) {
    const s = { pos: o.pos.clone(), vel: o.vel.clone(), owner: o.owner || null, cause: o.cause || "tankshell", damage: o.damage ?? 60, ufoDamage: o.ufoDamage ?? o.damage ?? 60, radius: o.radius ?? 4, look: o.look ?? 7, remote: !!o.remote, age: 0, trail: 0, player: !!o.player, foes: o.foes || null };
    this.shells.push(s);
    this.fired++;
    if (this.shells.length > 40) this.shells.shift();
    return s;
  }

  update(dt) {
    const mgr = this.manager;
    const fx = mgr.effects;
    const world = mgr.world;
    const c = this._c;
    for (let i = this.shells.length - 1; i >= 0; i--) {
      const s = this.shells[i];
      s.age += dt;
      s.vel.y -= SHELL_G * dt;
      const speed = s.vel.length();
      const step = speed * dt;
      const dir = _sd.copy(s.vel).divideScalar(speed || 1);
      let hit = null;
      let what = null;
      // The ground (and anything built).
      const bh = world.raycast(s.pos, dir, step, { solidOnly: true });
      if (bh) {
        hit = bh.distance;
        what = { kind: "ground" };
      }
      if (!s.remote) {
        // Vehicles (its own tank excepted), UFOs, creatures, players on foot.
        const vh = mgr.raycast(s.pos, dir, hit ?? step, s.owner);
      // (the hit tests keep to their own scratch vectors: dir is still the shell's)
        if (vh && (hit === null || vh.distance < hit)) {
          hit = vh.distance;
          what = { kind: "vehicle", ref: vh.vehicle };
        }
        const uh = mgr.ufos?.raycast(s.pos, dir, hit ?? step);
        if (uh && (hit === null || uh.distance < hit)) {
          hit = uh.distance;
          what = { kind: "ufo", ref: uh.ufo };
        }
        if (hit === null && s.age > 0.05) {
          const mid = _sm.copy(s.pos).addScaledVector(dir, step * 0.5);
          if (mgr.mobs?.sphereHit(mid, Math.max(0.8, step * 0.5))) {
            hit = step * 0.5;
            what = { kind: "mob" };
          }
          // (Players on foot: the shooter's foes, the local player, the remote ones as the AI sees them.)
          if (hit === null && s.foes) {
            for (const p of s.foes()) {
              if (p.dead || p.vehicle) continue;
              // (The body, as a 1-block sphere round the chest, against this step.)
              const pp = p.position;
              const t = clamp((pp.x - s.pos.x) * dir.x + (pp.y + 0.9 - s.pos.y) * dir.y + (pp.z - s.pos.z) * dir.z, 0, step);
              _sb.copy(s.pos).addScaledVector(dir, t);
              if (Math.hypot(_sb.x - pp.x, _sb.y - pp.y - 0.9, _sb.z - pp.z) < 1) {
                hit = t;
                what = { kind: "player" };
                break;
              }
            }
          }
        }
      }
      const tooFar = s.age > 9 || s.pos.y < -5 || s.pos.y > WORLD_HEIGHT + 300;
      if (hit !== null || tooFar) {
        const at = s.pos.clone().addScaledVector(dir, Math.max(0, (hit ?? 0) - 0.3));
        this.shells.splice(i, 1);
        if (hit !== null && !s.remote) this._impact(s, at, what);
        else if (hit !== null && s.remote) fx.glow.spawn({ x: at.x, y: at.y, z: at.z, life: 0.12, size0: 3, size1: 1, color0: c.hot, alpha: 0.8 });
        continue;
      }
      s.pos.addScaledVector(dir, step);
      // The tracer: a hot point and a streak behind it; a thin trail of smoke.
      fx.glow.spawn({ x: s.pos.x, y: s.pos.y, z: s.pos.z, life: Math.max(0.05, dt * 1.2), size0: 0.9, size1: 0.5, color0: c.hot, alpha: 0.95 });
      fx.glow.spawn({ x: s.pos.x - dir.x * step * 0.5, y: s.pos.y - dir.y * step * 0.5, z: s.pos.z - dir.z * step * 0.5, life: Math.max(0.05, dt * 1.2), size0: 0.6, size1: 0.3, color0: c.hot, alpha: 0.6 });
      s.trail += step;
      const spacing = 3.5 / Math.max(0.35, effectsQuality.scale);
      if (s.trail > spacing) {
        s.trail = 0;
        fx.smoke.spawn({ x: s.pos.x, y: s.pos.y, z: s.pos.z, vx: 0, vy: 0.3, vz: 0, life: 0.9, size0: 0.35, size1: 1.4, color0: c.trail0, color1: c.trail1, alpha: 0.28, drag: 1.2 });
      }
    }
  }

  _impact(s, at, what) {
    const mgr = this.manager;
    const fx = mgr.effects;
    this.hits.push({ at: at.clone(), what: what?.kind || "ground", t: performance.now() });
    if (this.hits.length > 8) this.hits.shift();
    if (what?.kind === "vehicle" && what.ref.alive) {
      const ok = what.ref.damage(s.damage, s.cause, s.player);
      if (ok && s.player && !what.ref.puppet) mgr.hitMarker?.();
    } else if (what?.kind === "ufo") {
      mgr.ufos.damage(what.ref, s.ufoDamage, s.player, at);
      if (s.player) mgr.hitMarker?.();
    }
    // (The blast: the crater, the fire, the shock; what it does to everyone near.)
    fx.explode(at, { radius: s.radius, source: s.cause, visual: s.look });
  }

  clear() {
    this.shells.length = 0;
  }
}

// The shell system of a vehicle manager (made on first use).
export function shellsOf(manager) {
  return manager.shells || (manager.shells = new ShellSystem(manager));
}

// ---------- The overlay (crosshair, gun reticle, the gunner's sight) ----------

let overlayEl = null;
function overlay() {
  if (overlayEl || typeof document === "undefined") return overlayEl;
  const el = document.createElement("div");
  el.id = "tank-overlay";
  el.style.cssText = "position:fixed;inset:0;pointer-events:none;z-index:9;display:none;font-family:monospace;";
  el.innerHTML = `
<div class="to-sight" style="position:absolute;inset:0;display:none;background:radial-gradient(circle at 50% 50%, rgba(0,0,0,0) 0, rgba(0,0,0,0) 38vmin, rgba(0,0,0,0.92) 39vmin);"></div>
<svg class="to-svg" width="100%" height="100%" style="position:absolute;inset:0;overflow:visible">
  <g class="to-cross" stroke="rgba(255,255,255,0.9)" stroke-width="1.5" fill="none">
    <path d="M-14 0 H-5 M5 0 H14 M0 -14 V-5 M0 5 V14"/>
    <circle r="1.5" fill="rgba(255,255,255,0.9)" stroke="none"/>
    <circle class="to-reload" r="22" stroke="rgba(255,200,80,0.85)" stroke-width="3" stroke-dasharray="0 999" transform="rotate(-90)"/>
  </g>
  <g class="to-gun" stroke="rgba(120,255,150,0.95)" stroke-width="2" fill="none">
    <circle r="11"/>
    <path d="M-17 0 H-11 M11 0 H17 M0 11 V17"/>
  </g>
  <g class="to-stadia" stroke="rgba(20,20,20,0.95)" stroke-width="2" fill="rgba(20,20,20,0.95)" style="display:none"></g>
</svg>
<div class="to-read" style="position:absolute;left:50%;top:50%;transform:translate(34px,-38px);color:#fff;font-size:13px;text-shadow:0 0 3px #000;white-space:nowrap"></div>`;
  document.body.appendChild(el);
  overlayEl = el;
  el._p = {
    sight: el.querySelector(".to-sight"),
    cross: el.querySelector(".to-cross"),
    reload: el.querySelector(".to-reload"),
    gun: el.querySelector(".to-gun"),
    stadia: el.querySelector(".to-stadia"),
    read: el.querySelector(".to-read"),
  };
  return el;
}

// The gunner's sight's stadia: the aiming triangles (Tiger) or the modern
// chevron and line, and the range marks down the side (where a shell
// falls short of the line of sight at 200-800 blocks without the fire
// control: the lead the old gunners worked with).
function stadiaSvg(kind, shellSpeed, fov, h) {
  const px = (ang) => (Math.tan(ang) / Math.tan((fov * Math.PI) / 360)) * (h / 2);
  let s = "";
  if (kind === "tiger") {
    s += `<path d="M-6 0 L0 -14 L6 0 Z"/>`;
    for (const k of [1, 2, 3]) s += `<path d="M${-k * 44 - 4} 0 L${-k * 44} -8 L${-k * 44 + 4} 0 Z"/><path d="M${k * 44 - 4} 0 L${k * 44} -8 L${k * 44 + 4} 0 Z"/>`;
  } else {
    s += `<path d="M-30 12 L0 0 L30 12" fill="none"/><path d="M-160 0 H-40 M40 0 H160" fill="none"/><path d="M0 18 V60" fill="none"/>`;
  }
  // The range marks: the drop at each range (an arc of speed v under SHELL_G).
  let marks = "";
  for (const r of [200, 400, 600, 800]) {
    const t = r / shellSpeed;
    const drop = 0.5 * SHELL_G * t * t;
    const y = px(Math.atan(drop / r));
    marks += `<path d="M-120 ${y.toFixed(1)} H-100" fill="none"/><text x="-136" y="${(y + 4).toFixed(1)}" font-size="11" stroke="none">${r / 100}</text>`;
  }
  return s + marks;
}

// ---------- The ground vehicle ----------

export class GroundVehicle extends Vehicle {
  constructor(manager, data = {}, opts = {}) {
    const spec = opts.spec || TANK_TYPES[data.kind] || TANK_TYPES.mbt;
    super(manager, { type: opts.type || "tank", name: opts.name || spec.name, radius: opts.radius ?? 3.6, maxHealth: opts.maxHealth ?? spec.maxHealth });
    this.spec = spec;
    this.kind = opts.kind || data.kind || spec.id;
    this.paint = data.paint || opts.paint || spec.paint || "olive";
    this.model = createTankModel(opts.model || this.kind, { paint: this.paint });
    this.root.add(this.model.root);
    this.hull = null; // (no aircraft hull: an oriented box, see raycast below)
    this.mass = spec.mass ?? 4;
    this.isGround = true;
    this.cameraModes = ["chase", "sight"];
    this.q = new THREE.Quaternion();
    if (Array.isArray(data.pos)) this.pos.fromArray(data.pos);
    if (Number.isFinite(data.health)) this.health = Math.max(1, Math.min(this.maxHealth, data.health));
    this.yaw = Number.isFinite(data.yaw) ? data.yaw : 0;
    this.pitch = 0;
    this.roll = 0;
    this.speed = 0;
    this.yawRate = 0;
    this.vy = 0;
    this.turretYaw = Number.isFinite(data.turret) ? data.turret : 0; // (relative to the hull)
    this.gunPitch = 0;
    this.trackL = 0;
    this.trackR = 0;
    this.recoil = 0;
    this.flashT = 9;
    this.kick = { x: 0, z: 0, vx: 0, vz: 0 }; // (the hull rocking: pitch, roll)
    this.reloadT = 0;
    this.coaxT = 0;
    this.smokeT = 0;
    this.time = Math.random() * 10;
    this.fxT = 0;
    this.onGround = true;
    this.inWater = false;
    this.half = { x: this.model.width / 2, y: this.model.height / 2, z: this.model.length / 2 };
    this.hitRadius = Math.hypot(this.half.x, this.half.z) * 0.85;
    this.enterRadius = this.half.z + 0.5;
    this.radius = Math.max(this.half.x, this.half.z);
    this.cookT = -1; // (destroyed: the cook-off's clock)
    this._lastRoll = { x: NaN, z: NaN, y: NaN };
    this.settle(true);
  }

  get bottom() {
    return 0;
  }
  get airborne() {
    return false;
  }

  seatPosition(out = new THREE.Vector3()) {
    // (The commander's hatch: the player's body rides inside, out of the way.)
    return out.set(this.pos.x, this.pos.y + 1.2, this.pos.z);
  }

  forward(out = new THREE.Vector3()) {
    return out.set(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
  }

  // ---------- The ground under it ----------

  // The ground's top at (x, z), searching down from y.
  _ground(x, z, y) {
    return this.manager.groundBelow(x, y, z);
  }

  // The heights under the four corners (front left, front right, back left,
  // back right) and the middle, for a hull at (x, z) heading yaw, searched
  // from height `from`.
  _footprint(x, z, yaw, from, out) {
    const fx = -Math.sin(yaw);
    const fz = -Math.cos(yaw);
    const rx = -fz;
    const rz = fx;
    const L = this.half.z * 0.86;
    const W = this.half.x * 0.8;
    out.fl = this._ground(x + fx * L - rx * W, z + fz * L - rz * W, from);
    out.fr = this._ground(x + fx * L + rx * W, z + fz * L + rz * W, from);
    out.bl = this._ground(x - fx * L - rx * W, z - fz * L - rz * W, from);
    out.br = this._ground(x - fx * L + rx * W, z - fz * L + rz * W, from);
    out.c = this._ground(x, z, from);
    out.ff = this._ground(x + fx * (L + 0.6), z + fz * (L + 0.6), from);
    out.bb = this._ground(x - fx * (L + 0.6), z - fz * (L + 0.6), from);
    return out;
  }

  // Sets it down on the ground where it is (a new or loaded vehicle).
  settle(force = false) {
    const w = this.manager.world;
    if (!w.getChunk(Math.floor(this.pos.x) >> 4, Math.floor(this.pos.z) >> 4) && !force) return;
    const fp = this._footprint(this.pos.x, this.pos.z, this.yaw, this.pos.y + 3, this._fp || (this._fp = {}));
    const g = Math.max(fp.c, (fp.fl + fp.fr + fp.bl + fp.br) / 4);
    if (Number.isFinite(g) && (force || g > this.pos.y)) this.pos.y = g;
    this._attitude(fp, 1);
    this._place();
  }

  _attitude(fp, k) {
    const L = this.half.z * 1.72;
    const W = this.half.x * 1.6;
    const front = (fp.fl + fp.fr) / 2;
    const back = (fp.bl + fp.br) / 2;
    const left = (fp.fl + fp.bl) / 2;
    const right = (fp.fr + fp.br) / 2;
    const p = clamp(Math.atan2(front - back, L), -0.5, 0.5);
    const r = clamp(Math.atan2(right - left, W), -0.4, 0.4);
    this.pitch += (p - this.pitch) * k;
    this.roll += (r - this.roll) * k;
  }

  // Leaves and plants inside the hull (a little ahead of it) are crushed.
  _crush(x, z, yaw) {
    const mgr = this.manager;
    const w = mgr.world;
    const fx = -Math.sin(yaw);
    const fz = -Math.cos(yaw);
    const rx = -fz;
    const rz = fx;
    const y0 = Math.floor(this.pos.y + 0.3);
    const edits = [];
    for (let a = -this.half.z; a <= this.half.z + 1.2; a += 0.9) {
      for (let b = -this.half.x; b <= this.half.x; b += 0.9) {
        const bx = Math.floor(x + fx * a + rx * b);
        const bz = Math.floor(z + fz * a + rz * b);
        for (let y = y0; y <= y0 + Math.ceil(this.model.height); y++) {
          const id = w.getBlock(bx, y, bz);
          if (!id || IS_WET[id]) continue;
          if (IS_LEAVES[id] || ((IS_REPLACEABLE[id] || SHAPE_OF[id] === 1) && !IS_SOLID[id])) {
            if (edits.length < 120) edits.push(bx, y, bz, BLOCK.AIR);
          }
        }
      }
    }
    if (edits.length) {
      w.setBlocks(edits);
      if (Math.random() < 0.3) mgr.audio?.playBreak?.("grass");
    }
  }

  // The water at (x, z): how deep it is over the ground (0: dry).
  _water(x, z, groundY) {
    const w = this.manager.world;
    let d = 0;
    const bx = Math.floor(x);
    const bz = Math.floor(z);
    for (let y = Math.floor(groundY); y < groundY + 4; y++) {
      if (!IS_WET[w.getBlock(bx, y, bz)]) break;
      d++;
    }
    return d;
  }

  // One step of driving: throttle -1..1, steer -1..1 (A +1: left).
  _drive(dt, throttle, steer, brake = false) {
    const S = this.spec;
    const mgr = this.manager;
    const water = this.inWater ? 0.45 : 1;
    let target = throttle > 0 ? throttle * S.speed * water : throttle < 0 ? throttle * S.reverse * water : 0;
    if (brake) target = 0;
    // (Braking or reversing against the motion is stronger than speeding up.)
    const against = Math.sign(target - this.speed) !== Math.sign(this.speed) && Math.abs(this.speed) > 0.1;
    const rate = (against || target === 0 ? S.brake : S.accel) * dt;
    this.speed += clamp(target - this.speed, -rate, rate);
    // The hull turns on its tracks (slower at speed, a little).
    const turn = steer * S.turn * (1 - Math.min(0.35, Math.abs(this.speed) / (S.speed * 3)));
    this.yawRate += (turn - this.yawRate) * Math.min(1, dt * 5);
    const yaw = this.yaw + this.yawRate * dt;
    const step = this.speed * dt;
    const nx = this.pos.x - Math.sin(yaw) * step;
    const nz = this.pos.z - Math.cos(yaw) * step;
    const moving = Math.abs(step) > 1e-4 || Math.abs(this.yawRate) > 1e-3;
    const fp = this._fp || (this._fp = {});
    if (moving) {
      // (The owner of the world's edits crushes what is in the way, then looks at the ground.)
      if (!this.puppet && (mgr.world.getChunk(Math.floor(nx) >> 4, Math.floor(nz) >> 4))) {
        this._crushT = (this._crushT || 0) - dt;
        if (this._crushT <= 0) {
          this._crushT = 0.25;
          this._crush(nx, nz, yaw);
        }
      }
      this._footprint(nx, nz, yaw, this.pos.y + STEP_UP + 0.9, fp);
      const lead = this.speed >= 0 ? Math.max(fp.fl, fp.fr, fp.ff) : Math.max(fp.bl, fp.br, fp.bb);
      const all = Math.max(fp.fl, fp.fr, fp.bl, fp.br, fp.c);
      const deep = this._water(nx, nz, fp.c) > DEEP_WATER;
      const blocked = lead - this.pos.y > STEP_UP || all - this.pos.y > STEP_UP + 0.3 || (deep && !this.inWater) || (deep && this._water(this.pos.x, this.pos.z, fp.c) <= DEEP_WATER && throttle !== 0);
      if (blocked) {
        // (Stopped by a wall: a jolt felt by the driver, no going through.)
        if (Math.abs(this.speed) > 3 && this === mgr.active) mgr.effects?.shake?.add?.(Math.min(0.25, Math.abs(this.speed) * 0.02));
        this.speed = 0;
        this.yawRate *= 0.3;
        this._footprint(this.pos.x, this.pos.z, this.yaw, this.pos.y + STEP_UP + 0.9, fp);
      } else {
        this.trackL += step - this.yawRate * dt * this.half.x;
        this.trackR += step + this.yawRate * dt * this.half.x;
        this.pos.x = nx;
        this.pos.z = nz;
        this.yaw = yaw;
      }
    } else if (!this._fpValid || this._fpT <= 0) {
      this._footprint(this.pos.x, this.pos.z, this.yaw, this.pos.y + STEP_UP + 0.9, fp);
      this._fpT = 0.5;
    }
    this._fpValid = true;
    this._fpT = (this._fpT || 0) - dt;
    // Up a step at once (smoothly), down a ledge with gravity.
    const g = Math.max(fp.c, (fp.fl + fp.fr + fp.bl + fp.br) / 4);
    if (g > this.pos.y + 0.01) {
      this.pos.y = Math.min(g, this.pos.y + Math.max(4, Math.abs(this.speed) * 1.2) * dt);
      this.vy = 0;
      this.onGround = true;
    } else {
      this.vy -= 25 * dt;
      this.pos.y += this.vy * dt;
      if (this.pos.y <= g) {
        if (this.vy < -9 && this === mgr.active) mgr.effects?.shake?.add?.(Math.min(0.4, -this.vy * 0.02));
        if (this.vy < -14) this.damage(Math.round((-this.vy - 14) * 6), "crash");
        this.pos.y = g;
        this.vy = 0;
        this.onGround = true;
      } else this.onGround = this.pos.y - g < 0.2;
    }
    if (this.pos.y < 1) this.pos.y = 1;
    this._attitude(fp, Math.min(1, dt * 6));
    this.inWater = IS_WET[mgr.world.getBlock(Math.floor(this.pos.x), Math.floor(this.pos.y + 0.4), Math.floor(this.pos.z))] === 1;
    this.vel.set(-Math.sin(this.yaw) * this.speed, this.vy, -Math.cos(this.yaw) * this.speed);
  }

  // ---------- Pose, model, effects ----------

  _updateKick(dt) {
    const k = this.kick;
    // (A damped spring: a sharp rock back and a couple of little bobs.)
    const K = 60;
    const C = 7;
    k.vx += (-K * k.x - C * k.vx) * dt;
    k.vz += (-K * k.z - C * k.vz) * dt;
    k.x += k.vx * dt;
    k.z += k.vz * dt;
  }

  _place() {
    const pitch = this.pitch + this.kick.x;
    const roll = this.roll + this.kick.z;
    this.q.setFromEuler(_e.set(pitch, this.yaw, roll, "YXZ"));
    this.root.position.copy(this.pos);
    this.root.quaternion.copy(this.q);
    const m = this.model;
    m.setTurret?.(this.turretYaw);
    m.setGun?.(this.gunPitch);
    m.setRecoil?.(this.recoil);
    const l = this.manager.world.lightAt(this.pos.x, this.pos.y + 2, this.pos.z);
    m.light.sky = l.sky;
    m.light.block = l.block;
    if (this.alive && this.cookT < 0) {
      if (this.hurtTime < 0.15) m.light.flash.setRGB(0.4 * (1 - this.hurtTime / 0.15), 0.08, 0);
      else m.light.flash.setRGB(0, 0, 0);
    }
  }

  // Tracks and wheels: laid out again only when they moved and the camera is near.
  _animateTracks() {
    const cam = this.manager.effects?.listener;
    const near = !cam || cam.distanceToSquared(this.pos) < 160 * 160;
    if (!near) return;
    const L = this._lastRoll;
    if (L.x === this.trackL && L.z === this.trackR) return;
    L.x = this.trackL;
    L.z = this.trackR;
    this.model.roll(this.trackL, this.trackR);
  }

  // Exhaust, dust off the tracks, damage smoke and fire.
  _effects(dt) {
    const fx = this.manager.effects;
    this.fxT -= dt;
    if (this.fxT > 0) return;
    const q = Math.max(0.3, effectsQuality.scale);
    this.fxT = 0.12 / q;
    const c = this._fxC || (this._fxC = { ex0: new THREE.Color(0.18, 0.17, 0.16), ex1: new THREE.Color(0.42, 0.41, 0.4), dust: new THREE.Color(0.56, 0.5, 0.4), dust1: new THREE.Color(0.66, 0.62, 0.55), fire: new THREE.Color(5, 2.4, 0.7), s0: new THREE.Color(0.08, 0.075, 0.07), s1: new THREE.Color(0.3, 0.29, 0.28) });
    const fwd = this.forward(_w);
    const back = this.half.z;
    const hp = this.health / this.maxHealth;
    // Exhaust at the back (more when pulling hard).
    const load = Math.min(1, Math.abs(this.speed) / this.spec.speed + Math.abs(this.yawRate));
    if (Math.random() < 0.35 + load * 0.5) fx.smoke.spawn({ x: this.pos.x - fwd.x * back, y: this.pos.y + 1.9, z: this.pos.z - fwd.z * back, vx: -fwd.x * 0.8 + (Math.random() - 0.5) * 0.4, vy: 1.4, vz: -fwd.z * 0.8 + (Math.random() - 0.5) * 0.4, life: 1.6 + load, size0: 0.35, size1: 1.6 + load, color0: c.ex0, color1: c.ex1, alpha: 0.25 + load * 0.25, drag: 1 });
    // Dust thrown up by the tracks.
    if (Math.abs(this.speed) > 2 && !this.inWater && this.onGround) {
      for (const s of [-1, 1]) {
        const rx = -fwd.z * s * this.half.x;
        const rz = fwd.x * s * this.half.x;
        fx.smoke.spawn({ x: this.pos.x + rx - fwd.x * back * Math.sign(this.speed), y: this.pos.y + 0.3, z: this.pos.z + rz - fwd.z * back * Math.sign(this.speed), vx: (Math.random() - 0.5) * 1.5, vy: 0.8 + Math.random(), vz: (Math.random() - 0.5) * 1.5, life: 1.4, size0: 0.8, size1: 2.6, color0: c.dust, color1: c.dust1, alpha: 0.3, drag: 1.5 });
      }
    }
    // Hurt: smoke from the engine deck; badly hurt: flames.
    if (hp < 0.5) fx.smoke.spawn({ x: this.pos.x - fwd.x * back * 0.5, y: this.pos.y + 2, z: this.pos.z - fwd.z * back * 0.5, vx: (Math.random() - 0.5) * 0.5, vy: 2, vz: (Math.random() - 0.5) * 0.5, life: 3, size0: 0.8, size1: 3.5, color0: c.s0, color1: c.s1, alpha: 0.55 - hp * 0.5, drag: 0.6 });
    if (hp < 0.25) fx.glow.spawn({ x: this.pos.x - fwd.x * back * 0.5 + (Math.random() - 0.5), y: this.pos.y + 1.9, z: this.pos.z - fwd.z * back * 0.5 + (Math.random() - 0.5), vx: 0, vy: 2.5, vz: 0, life: 0.4, size0: 1.1, size1: 0.4, color0: c.fire, alpha: 0.7, drag: 1 });
  }

  // ---------- The gun ----------

  // World position of the gun's trunnion (out) and the muzzle.
  muzzleWorld(out = new THREE.Vector3()) {
    const m = this.model.muzzle;
    if (!m) return out.copy(this.pos).setY(this.pos.y + 2);
    this.root.updateMatrixWorld(true);
    return m.getWorldPosition(out);
  }

  // The gun's world direction (out, unit).
  gunDir(out = new THREE.Vector3()) {
    _e.set(this.gunPitch, this.turretYaw, 0, "YXZ");
    _q.setFromEuler(_e);
    return out.set(0, 0, -1).applyQuaternion(_q).applyQuaternion(this.q);
  }

  // The turret yaw and gun pitch (hull frame) to fire along world direction d.
  _localAim(d) {
    _qi.copy(this.q).invert();
    const l = _u.copy(d).applyQuaternion(_qi);
    return { yaw: Math.atan2(-l.x, -l.z), pitch: Math.atan2(l.y, Math.hypot(l.x, l.z)) };
  }

  // Slews the turret and the gun toward the aim (a world direction).
  _traverse(dt, wantDir) {
    const S = this.spec;
    const a = this._localAim(wantDir);
    const before = this.turretYaw;
    this.turretYaw = wrapAngle(slew(this.turretYaw, a.yaw, S.traverse * dt));
    this.gunPitch = clamp(slew(this.gunPitch, clamp(a.pitch, S.minPitch, S.maxPitch), S.elev * dt), S.minPitch, S.maxPitch);
    this.traverseRate = Math.abs(wrapAngle(this.turretYaw - before)) / Math.max(dt, 1e-4);
    return Math.abs(wrapAngle(this.turretYaw - a.yaw)) + Math.abs(this.gunPitch - clamp(a.pitch, S.minPitch, S.maxPitch));
  }

  // The world direction to fire along to land on point p (the shell's arc
  // from the muzzle): the line of sight raised by the elevation the range
  // needs. Returns the elevation added (radians) in this.superElev.
  _aimAt(p, out) {
    const from = this.muzzleWorld(_w);
    const dx = p.x - from.x;
    const dz = p.z - from.z;
    const flat = Math.hypot(dx, dz);
    const los = Math.atan2(p.y - from.y, flat);
    const el = ballisticPitch(flat, p.y - from.y, this.spec.shellSpeed) ?? Math.PI / 4;
    this.superElev = el - los;
    const yaw = Math.atan2(-dx, -dz);
    return out.set(-Math.sin(yaw) * Math.cos(el), Math.sin(el), -Math.cos(yaw) * Math.cos(el));
  }

  // Where a shell fired now would come down (null: nowhere near): marched
  // along its arc against the ground and the vehicles.
  impactPoint(out = new THREE.Vector3(), maxT = 4) {
    const mgr = this.manager;
    const p = this.muzzleWorld(_ip);
    const vel = this.gunDir(_iv).multiplyScalar(this.spec.shellSpeed);
    const dt = 0.08;
    for (let t = 0; t < maxT; t += dt) {
      vel.y -= SHELL_G * dt * 0.5;
      const step = vel.length() * dt;
      const d = _id.copy(vel).normalize();
      const h = mgr.world.raycast(p, d, step, { solidOnly: true });
      if (h) return out.copy(p).addScaledVector(d, h.distance);
      p.addScaledVector(d, step);
      vel.y -= SHELL_G * dt * 0.5;
    }
    return null;
  }

  // Fires the main gun (o: overrides for the shell: cause, damage...).
  fireGun(o = {}) {
    const mgr = this.manager;
    const S = this.spec;
    const from = this.muzzleWorld(new THREE.Vector3());
    const dir = o.dir || this.gunDir(new THREE.Vector3());
    const vel = dir.clone().multiplyScalar(S.shellSpeed).add(_v.set(this.vel.x, 0, this.vel.z));
    const shell = shellsOf(mgr).fire({ pos: from, vel, owner: this, cause: o.cause || "tankshell", damage: o.damage ?? S.damage, ufoDamage: o.ufoDamage ?? S.ufoDamage, radius: o.radius ?? S.blast, look: o.look ?? S.look, player: o.player ?? true, foes: o.foes || null });
    this.reloadT = o.reload ?? S.reload;
    this.recoil = 1;
    this.flashT = 0;
    // The hull rocks back from the gun (along the turret's bearing).
    this.kick.vx += Math.cos(this.turretYaw) * (this.kind === "tiger" ? 0.9 : 0.7);
    this.kick.vz += -Math.sin(this.turretYaw) * 0.6;
    const ground = mgr.groundBelow(from.x, from.y, from.z);
    mgr.effects?.tankFire?.(from, dir, { size: this.kind === "tiger" ? 1.15 : 1, groundY: ground, hull: this.pos });
    const ears = mgr.effects?.listener;
    playTankGun(mgr.audio, ears ? from.distanceTo(ears) : 0, 1);
    mgr.onGroundFire?.(this, "shell", from, vel, shell);
    return shell;
  }

  // ---------- Hits (an oriented box: the hull, the turret on it) ----------

  _boxLocal(origin, dir) {
    _qi.copy(this.q).invert();
    const o = _bo.copy(origin).sub(this.pos).applyQuaternion(_qi);
    o.y -= this.half.y;
    const d = _bd.copy(dir).applyQuaternion(_qi);
    return [o, d];
  }

  // Ray vs the box (half sizes h, padded): the entry distance or null.
  _slab(o, d, maxDist, pad) {
    const h = this.half;
    let t0 = 0;
    let t1 = maxDist;
    for (const [oo, dd, hh] of [[o.x, d.x, h.x + pad], [o.y, d.y, h.y + pad], [o.z, d.z, h.z + pad]]) {
      if (Math.abs(dd) < 1e-9) {
        if (oo < -hh || oo > hh) return null;
        continue;
      }
      let a = (-hh - oo) / dd;
      let b = (hh - oo) / dd;
      if (a > b) [a, b] = [b, a];
      t0 = Math.max(t0, a);
      t1 = Math.min(t1, b);
      if (t0 > t1) return null;
    }
    return t0;
  }

  raycast(origin, dir, maxDist) {
    if (this.pos.distanceTo(origin) - maxDist > this.radius + 3) return null;
    const [o, d] = this._boxLocal(origin, dir);
    return this._slab(o, d, maxDist, 0);
  }

  sweptRaycast(origin, dir, step, pad = 0) {
    if (this.pos.distanceTo(origin) - step > this.radius + 3 + pad) return null;
    const [o, d] = this._boxLocal(origin, dir);
    return this._slab(o, d, step, pad);
  }

  segmentHit(a, b, pad = 0) {
    const len = a.distanceTo(b);
    if (len < 1e-6) return this.hullDistance(a, pad + 1) <= pad;
    return this.sweptRaycast(a, _sb.copy(b).sub(a).divideScalar(len), len, pad) !== null;
  }

  hullDistance(p, max = Infinity) {
    _qi.copy(this.q).invert();
    const o = _bo.copy(p).sub(this.pos).applyQuaternion(_qi);
    o.y -= this.half.y;
    const h = this.half;
    const dx = Math.max(0, Math.abs(o.x) - h.x);
    const dy = Math.max(0, Math.abs(o.y) - h.y);
    const dz = Math.max(0, Math.abs(o.z) - h.z);
    return Math.min(max, Math.hypot(dx, dy, dz));
  }

  // ---------- Damage, destruction ----------

  damage(amount, cause = "vehicle", byPlayer = false) {
    if (this.cookT >= 0) return false;
    return super.damage(amount, cause, byPlayer);
  }

  onDestroyed(cause) {
    const mgr = this.manager;
    this.cookT = 0;
    this.speed = 0;
    this.removeAt = WRECK_TIME;
    this._booms = 0;
    this.engine?.set(false);
    this.model.setBurnt(true, this.time);
    // (The big blast comes a moment later: the fire in the hatches first.)
    mgr.onGroundDown?.(this, cause);
  }

  // The cook-off and the burning wreck.
  _updateWreck(dt) {
    const mgr = this.manager;
    const fx = mgr.effects;
    this.cookT += dt;
    this.time += dt;
    const c = this._fxC || (this._fxC = {});
    const fire = c.fire || (c.fire = new THREE.Color(5, 2.4, 0.7));
    const s0 = c.s0 || (c.s0 = new THREE.Color(0.08, 0.075, 0.07));
    const s1 = c.s1 || (c.s1 = new THREE.Color(0.3, 0.29, 0.28));
    const top = this.pos.y + this.model.height;
    if (this._booms === 0 && this.cookT > 0.35) {
      this._booms = 1;
      // The blast: no crater of its own worth speaking of, a big fireball.
      if (!this.puppet) fx.explode(this.pos.clone().setY(this.pos.y + 1.5), { radius: 3.5, source: "tank_boom", visual: 12 });
      // The turret thrown off (a heavy tank's, end over end).
      const t = this.model.detachTurret?.();
      if (t) {
        mgr.scene.add(t);
        const out = this.forward(_v).multiplyScalar(-1);
        const side = Math.random() < 0.5 ? -1 : 1;
        this._turret = { obj: t, vel: new THREE.Vector3(out.z * side * 3 + (Math.random() - 0.5) * 3, 13 + Math.random() * 5, -out.x * side * 3 + (Math.random() - 0.5) * 3), spin: new THREE.Vector3((Math.random() - 0.5) * 4, (Math.random() - 0.5) * 3, (Math.random() - 0.5) * 4), landed: false };
      }
    }
    const tu = this._turret;
    if (tu && !tu.landed) {
      tu.vel.y -= 20 * dt;
      tu.obj.position.addScaledVector(tu.vel, dt);
      tu.obj.rotateX(tu.spin.x * dt);
      tu.obj.rotateY(tu.spin.y * dt);
      tu.obj.rotateZ(tu.spin.z * dt);
      const g = mgr.groundBelow(tu.obj.position.x, tu.obj.position.y + 1, tu.obj.position.z);
      if (tu.obj.position.y <= g + 0.3 && tu.vel.y < 0) {
        tu.landed = true;
        tu.obj.position.y = g + 0.3;
        mgr.audio?.playExplosion?.(tu.obj.position.distanceTo(fx.listener), 0.35);
        for (let i = 0; i < 12; i++) fx.smoke.spawn({ x: tu.obj.position.x, y: g + 0.5, z: tu.obj.position.z, vx: (Math.random() - 0.5) * 6, vy: Math.random() * 2, vz: (Math.random() - 0.5) * 6, life: 2, size0: 1, size1: 3.5, color0: s1, alpha: 0.4, drag: 1.5 });
      }
    }
    this.model.setBurnt(true, this.time);
    this.fxT -= dt;
    if (this.fxT <= 0 && this.root.visible) {
      const q = Math.max(0.3, effectsQuality.scale);
      const strong = this.cookT < 12;
      this.fxT = (strong ? 0.05 : 0.14) / q;
      const j = () => (Math.random() - 0.5) * this.half.x * 1.4;
      // Fire from the hatches (a jet of flame during the cook-off), then a smouldering burn.
      if (this.cookT < 0.4) fx.glow.spawn({ x: this.pos.x + j() * 0.3, y: top, z: this.pos.z + j() * 0.3, vx: j(), vy: 14 + Math.random() * 8, vz: j(), life: 0.5, size0: 1.6, size1: 3, color0: fire, alpha: 0.85, drag: 1.5 });
      if (strong || Math.random() < 0.5) fx.glow.spawn({ x: this.pos.x + j(), y: top - 0.6, z: this.pos.z + j(), vx: 0, vy: 2 + Math.random() * 2, vz: 0, life: 0.6, size0: 2.2, size1: 0.8, color0: fire, alpha: 0.6, drag: 1 });
      fx.smoke.spawn({ x: this.pos.x + j(), y: top, z: this.pos.z + j(), vx: (Math.random() - 0.5) * 0.6, vy: 2.5 + Math.random(), vz: (Math.random() - 0.5) * 0.6, life: 6 + Math.random() * 3, size0: 1.6, size1: 9, color0: s0, color1: s1, alpha: 0.7, drag: 0.4 });
    }
    // (Its blasts now and then: the ammunition going off.)
    if (this._booms === 1 && this.cookT > 1.6 && Math.random() < dt * 0.8) {
      for (let i = 0; i < 6; i++) fx.glow.spawn({ x: this.pos.x, y: top, z: this.pos.z, vx: (Math.random() - 0.5) * 12, vy: 6 + Math.random() * 10, vz: (Math.random() - 0.5) * 12, life: 0.7, size0: 0.3, size1: 0.1, color0: fire, alpha: 1, gravity: 0.8, drag: 0.5 });
      mgr.audio?.playExplosion?.(this.pos.distanceTo(fx.listener), 0.25);
    }
    this._place();
  }

  // ---------- Every frame ----------

  update(dt, input) {
    super.update(dt, input);
    this.time += dt;
    const shells = this.manager.shells;
    if (shells && !shells.driven) shells.update(dt);
    if (!this.alive) {
      if (this.cookT >= 0) this._updateWreck(dt);
      return;
    }
    this._control(dt, input);
    this._updateKick(dt);
    this.recoil = Math.max(0, this.recoil - dt * 1.6);
    this.flashT += dt;
    this.model.setFlash?.(this.flashT < 0.07 ? 1 - this.flashT / 0.07 : 0, this.kind === "tiger" ? 1.5 : 1.3);
    this.reloadT = Math.max(0, this.reloadT - dt);
    this.smokeT = Math.max(0, this.smokeT - dt);
    this._place();
    this._animateTracks();
    this.model.animate?.(this.time);
    this.model.setNight?.(this.manager.night ?? 0);
    this._effects(dt);
  }

  // What drives it (the player's input, or the AI in tanks.js).
  _control(dt, input) {
    this._drive(dt, 0, 0, true);
  }

  // ---------- Online (net/vehicles.js) ----------

  netState(s) {
    s.y = Math.round(this.yaw * 1000) / 1000;
    s.pr = [Math.round(this.pitch * 1000) / 1000, Math.round(this.roll * 1000) / 1000];
    s.tu = [Math.round(Math.cos(this.turretYaw) * 1000) / 1000, Math.round(Math.sin(this.turretYaw) * 1000) / 1000];
    s.gp = Math.round(this.gunPitch * 1000) / 1000;
    s.k = this.kind;
  }

  netPuppet(st, dt) {
    if (st) {
      if (Number.isFinite(st.y)) {
        const dy = wrapAngle(st.y - this.yaw);
        this.yawRate = dy / Math.max(dt, 1e-3);
        this.yaw = st.y;
      }
      if (Array.isArray(st.pr)) {
        this.pitch = st.pr[0];
        this.roll = st.pr[1];
      }
      if (Array.isArray(st.tu)) this.turretYaw = Math.atan2(st.tu[1], st.tu[0]);
      if (Number.isFinite(st.gp)) this.gunPitch = st.gp;
      // The tracks run by how far it moved.
      const fwd = this.forward(_w);
      const step = (this.pos.x - (this._netX ?? this.pos.x)) * fwd.x + (this.pos.z - (this._netZ ?? this.pos.z)) * fwd.z;
      this._netX = this.pos.x;
      this._netZ = this.pos.z;
      this.trackL += step - this.yawRate * dt * this.half.x;
      this.trackR += step + this.yawRate * dt * this.half.x;
      this.speed = step / Math.max(dt, 1e-3);
      this.netExtra?.(st);
    }
    this.time += dt;
    if (!this.alive) {
      if (this.cookT < 0) {
        this.cookT = 0;
        this._booms = 0;
      }
      this._updateWreck(dt);
      return;
    }
    this._updateKick(dt);
    this.recoil = Math.max(0, this.recoil - dt * 1.6);
    this.flashT += dt;
    this.model.setFlash?.(this.flashT < 0.07 ? 1 - this.flashT / 0.07 : 0, 1.3);
    this._place();
    this._animateTracks();
    this.model.animate?.(this.time);
    this.model.setNight?.(this.manager.night ?? 0);
    this._effects(dt);
  }

  // Another machine's shot from this vehicle, drawn here (net/ground.js).
  netFire(kind, from, vel) {
    if (kind !== "shell") return;
    this.recoil = 1;
    this.flashT = 0;
    this.kick.vx += Math.cos(this.turretYaw) * 0.7;
    shellsOf(this.manager).fire({ pos: from, vel, owner: this, remote: true });
    const fx = this.manager.effects;
    const dir = vel.clone().normalize();
    fx?.tankFire?.(from, dir, { size: this.kind === "tiger" ? 1.15 : 1, groundY: this.manager.groundBelow(from.x, from.y, from.z), hull: this.pos });
    playTankGun(this.manager.audio, fx ? from.distanceTo(fx.listener) : 0, 1);
  }

  serialize() {
    return { ...super.serialize(), kind: this.kind, paint: this.paint, yaw: Math.round(this.yaw * 1000) / 1000, turret: Math.round(this.turretYaw * 1000) / 1000 };
  }

  dispose() {
    super.dispose();
    if (this._turret) this.manager.scene.remove(this._turret.obj);
    this.engine?.set(false);
    this.model.dispose?.();
  }
}

// ---------- The player's tank ----------

export class Tank extends GroundVehicle {
  constructor(manager, data = {}, opts = {}) {
    super(manager, data, opts);
    this.lookYaw = this.yaw;
    this.lookPitch = -0.05;
    this.aimPoint = new THREE.Vector3();
    this.impact = null;
    this.range = 0;
    this.superElev = 0;
    this._camPos = new THREE.Vector3();
    this._hudSeen = 0;
    this.sight = 0; // 0 chase .. 1 the gunner's sight (eased)
  }

  get sighted() {
    return this.cameraModes[this.cameraMode] === "sight";
  }

  onEnter() {
    this.lookYaw = this.yaw + this.turretYaw;
    this.lookPitch = -0.05;
    this.camYaw = this.lookYaw;
    this.camPitch = this.lookPitch;
    if (!this.engine) this.engine = new EngineSound(this.manager.audio);
    this.manager.onMessage?.(`${this.spec.name}: W/S drive, A/D turn, the mouse aims, left click fires, right click the MG, V the gunner's sight, C smoke`);
  }

  onExit() {
    this.engine?.set(false);
    if (this.model.barrel) this.model.barrel.visible = true;
    this.cameraMode = 0;
    this.sight = 0;
    this.speed = 0;
    this.yawRate = 0;
    const cam = this.manager.camera;
    if (cam && this.manager.player) {
      cam.fov = this.manager.player.fov || cam.fov;
      cam.updateProjectionMatrix();
    }
    const el = overlay();
    if (el) el.style.display = "none";
  }

  // The player's controls.
  _control(dt, input) {
    const mgr = this.manager;
    if (!input) {
      this._drive(dt, 0, 0, true);
      return;
    }
    const k = input.keys;
    // The mouse turns the view (slower in the sight: it's zoomed in).
    const zoomK = this.sight > 0.5 ? this.spec.zoom / 70 : 1;
    const sens = 0.0022 * (mgr.mouseSensitivity ?? 0.6) * zoomK;
    this.lookYaw -= input.dx * sens;
    this.lookPitch = clamp(this.lookPitch - input.dy * sens * (mgr.invertY ? -1 : 1), -0.6, 0.5);
    if (input.pressed.has("KeyV")) this.cameraMode = this.cameraMode ? 0 : 1;
    const throttle = (k.has("KeyW") ? 1 : 0) - (k.has("KeyS") ? 1 : 0);
    const steer = (k.has("KeyA") ? 1 : 0) - (k.has("KeyD") ? 1 : 0);
    this._drive(dt, throttle, steer, k.has("Space"));
    // The aim: what the view's centre is on (the fire control's rangefinder).
    const cam = this._viewOrigin(_cam);
    // (The chase view looks a little below the mouse's line: the crosshair is the view's centre.)
    const vp = this.sighted ? this.lookPitch : this.lookPitch - CHASE_TILT;
    const look = _look.set(-Math.sin(this.lookYaw) * Math.cos(vp), Math.sin(vp), -Math.cos(this.lookYaw) * Math.cos(vp));
    const range = this._rangefind(cam, look, 1200);
    this.range = range;
    this.aimPoint.copy(cam).addScaledVector(look, range);
    const want = this._aimAt(this.aimPoint, new THREE.Vector3());
    this.aimError = this._traverse(dt, want);
    this.camYaw = this.lookYaw;
    this.camPitch = this.lookPitch;
    // Fire.
    if ((input.pressed.has("mouse0") || input.buttons[0]) && this.reloadT <= 0) {
      this.fireGun({ foes: null });
      this._reloadSound = true;
    }
    if (this._reloadSound && this.reloadT <= 0) {
      this._reloadSound = false;
      mgr.audio?._hit?.({ type: "bandpass", f: 1300, q: 3, d: 0.07, v: 0.28, n: 2, spread: 0.12 });
    }
    // The coaxial MG.
    this.coaxT -= dt;
    if (input.buttons[2] && this.coaxT <= 0 && mgr.lasers) {
      this.coaxT = this.spec.coax;
      const d = this.gunDir(new THREE.Vector3());
      d.x += (Math.random() - 0.5) * 0.012;
      d.y += (Math.random() - 0.5) * 0.012;
      d.z += (Math.random() - 0.5) * 0.012;
      const from = this.muzzleWorld(new THREE.Vector3()).addScaledVector(d, -(this.spec.coaxBack ?? 2.5));
      this._coaxN = (this._coaxN || 0) + 1;
      mgr.lasers.fire({ from, dir: d.normalize(), color: _coaxC, speed: 400, damage: 4, owner: "player", source: this, range: 380, radius: 0.05, length: 2.2, sound: false, tracer: this._coaxN % 3 !== 0, gun: "machinegun", scorch: false, hole: true });
      mgr.audio?.playMachineGun?.();
    }
    // Smoke screen.
    if (input.pressed.has("KeyC")) this.popSmoke();
    // The engine and the turret's whine.
    const rpm = clamp(Math.abs(throttle) * 0.6 + Math.abs(this.speed) / this.spec.speed * 0.5 + Math.abs(steer) * 0.3, 0, 1);
    this.engine?.set(true, rpm, Math.abs(this.speed), this.traverseRate || 0);
  }

  // From where the aim is taken: the camera's spot (chase) or the sight.
  _viewOrigin(out) {
    if (this.sighted) {
      this.root.updateMatrixWorld(true);
      // (The gunner's sight: beside the gun, a little above it.)
      return this.model.gun ? this.model.gun.localToWorld(out.set(0.75, 0.42, -0.6)) : out.copy(this.pos).setY(this.pos.y + 2.4);
    }
    return this._camPos.lengthSq() ? out.copy(this._camPos) : out.copy(this.pos).setY(this.pos.y + 4);
  }

  // How far along the ray the first thing is (ground, a vehicle, a UFO), up to max.
  _rangefind(from, dir, max) {
    const mgr = this.manager;
    let d = max;
    const h = mgr.world.raycast(from, dir, max, { solidOnly: true });
    if (h) d = h.distance;
    const vh = mgr.raycast(from, dir, d, this);
    if (vh) d = vh.distance;
    const uh = mgr.ufos?.raycast(from, dir, d);
    if (uh) d = uh.distance;
    return Math.max(8, d);
  }

  // Smoke grenades: a wall of white smoke in front of the turret.
  popSmoke() {
    if (this.smokeT > 0) {
      this.manager.onMessage?.(`Smoke launchers reloading (${Math.ceil(this.smokeT)} s)`);
      return;
    }
    this.smokeT = SMOKE_COOLDOWN;
    launchSmoke(this, this.manager);
  }

  updateCamera(camera, dt) {
    const mgr = this.manager;
    const want = this.sighted ? 1 : 0;
    this.sight += (want - this.sight) * Math.min(1, dt * 10);
    if (Math.abs(this.sight - want) < 0.02) this.sight = want;
    const fov = this.sight > 0.5 ? this.spec.zoom : mgr.player?.fov || 75;
    if (Math.abs(camera.fov - fov) > 0.05) {
      camera.fov += (fov - camera.fov) * Math.min(1, dt * 12);
      if (Math.abs(camera.fov - fov) < 0.1) camera.fov = fov;
      camera.updateProjectionMatrix();
    }
    // (In the sight the gun is out of view: hidden, so it doesn't fill the picture.)
    if (this.model.barrel) this.model.barrel.visible = this.sight <= 0.5;
    if (this.sight > 0.5) {
      // The sight: along the gun's line of sight (the bore less the
      // elevation the fire control has put on for the range).
      this._viewOrigin(camera.position);
      const d = this.gunDir(_v);
      const yaw = Math.atan2(-d.x, -d.z);
      const pitch = Math.asin(clamp(d.y, -1, 1)) - (this.superElev || 0);
      camera.quaternion.setFromEuler(_e.set(pitch, yaw, 0, "YXZ"));
      this._camPos.copy(camera.position);
    } else {
      // Chase: behind and above the turret, looking where the mouse aims.
      const S = this.spec;
      const back = _v.set(Math.sin(this.lookYaw) * Math.cos(this.lookPitch), -Math.sin(this.lookPitch), Math.cos(this.lookYaw) * Math.cos(this.lookPitch));
      const pivot = _w.copy(this.pos).setY(this.pos.y + 2.8);
      camera.position.copy(pivot).addScaledVector(back, S.camBack).setY(pivot.y + S.camUp + back.y * S.camBack * 0.6);
      const g = mgr.groundBelow(camera.position.x, camera.position.y + 2, camera.position.z);
      if (camera.position.y < g + 1.2) camera.position.y = g + 1.2;
      camera.quaternion.setFromEuler(_e.set(this.lookPitch - CHASE_TILT, this.lookYaw, 0, "YXZ"));
      this._camPos.copy(camera.position);
    }
    this._drawOverlay(camera);
  }

  _drawOverlay(camera) {
    const el = overlay();
    if (!el) return;
    // (The HUD asks the vehicle every frame it is drawn while playing: not behind a menu.
    // A slow machine's frames are far apart, hence the long grace.)
    const fresh = performance.now() - this._hudSeen < 2500;
    const show = this.occupied && this.alive && fresh && !document.body.classList.contains("hud-off"); // (F1 hides it with the rest)
    el.style.display = show ? "block" : "none";
    if (!show) return;
    const P = el._p;
    const W = window.innerWidth;
    const H = window.innerHeight;
    const sight = this.sight > 0.5;
    P.sight.style.display = sight ? "block" : "none";
    // The crosshair: the view's centre (where the aim is).
    P.cross.setAttribute("transform", `translate(${W / 2},${H / 2})`);
    const S = this.spec;
    const frac = this.reloadT > 0 ? 1 - this.reloadT / S.reload : 1;
    const circ = 2 * Math.PI * 22;
    P.reload.setAttribute("stroke-dasharray", this.reloadT > 0 ? `${(circ * frac).toFixed(1)} 999` : "0 999");
    // The gun's reticle: where a shell would land now.
    const ip = this.impactPoint(_u);
    let gx = W / 2;
    let gy = H / 2;
    if (ip) {
      const p = ip.project(camera);
      if (p.z < 1) {
        gx = ((p.x + 1) / 2) * W;
        gy = ((1 - p.y) / 2) * H;
      }
    }
    P.gun.setAttribute("transform", `translate(${gx.toFixed(1)},${gy.toFixed(1)})`);
    P.gun.style.display = sight ? "none" : "block";
    P.gun.setAttribute("stroke", this.reloadT > 0 ? "rgba(255,190,90,0.9)" : "rgba(120,255,150,0.95)");
    // The sight's stadia (rebuilt when the window's size changes).
    P.stadia.style.display = sight ? "block" : "none";
    if (sight) {
      const key = `${this.kind}:${H}`;
      if (P.stadia._key !== key) {
        P.stadia._key = key;
        P.stadia.innerHTML = stadiaSvg(this.kind, S.shellSpeed, S.zoom, H);
      }
      P.stadia.setAttribute("transform", `translate(${W / 2},${H / 2})`);
      P.cross.style.display = "none";
    } else P.cross.style.display = "block";
    const txt = `${sight ? `RANGE ${Math.round(this.range)} m  ` : ""}${this.reloadT > 0 ? `RELOAD ${this.reloadT.toFixed(1)}` : "HE READY"}`;
    if (P.read._t !== txt) {
      P.read._t = txt;
      P.read.textContent = txt;
    }
    P.read.style.transform = sight ? "translate(-50%, 90px)" : "translate(34px,-38px)";
  }

  hud() {
    this._hudSeen = performance.now();
    const S = this.spec;
    const kmh = Math.round(Math.abs(this.speed) * 3.6);
    const bearing = Math.round(((((-(this.yaw + this.turretYaw) * 180) / Math.PI) % 360) + 360) % 360);
    return {
      title: S.name,
      rows: [
        ["Speed", `${kmh} km/h${this.speed < -0.2 ? " (R)" : ""}`],
        ["Gun", this.reloadT > 0 ? `reloading ${this.reloadT.toFixed(1)} s` : "HE ready"],
        ["Turret", `${bearing}°`],
        ["Range", `${Math.round(this.range)} m`],
        ["Smoke", this.smokeT > 0 ? `${Math.ceil(this.smokeT)} s` : "ready"],
      ],
      bars: [{ label: "Reload", value: this.reloadT > 0 ? 1 - this.reloadT / S.reload : 1, hot: this.reloadT > 0 }],
      weapon: "HE shell",
      warning: this.health / this.maxHealth < 0.25 ? "ON FIRE: get out (F)!" : this.inWater ? "In the water: slow going" : "",
      health: this.health / this.maxHealth,
      help: "W/S drive, A/D turn, mouse aim, LMB fire, RMB MG, V sight, C smoke, F get out",
    };
  }

  infoPanel() {
    const S = this.spec;
    return {
      title: S.name,
      stats: [
        ["Armour", `${Math.round(this.health)} / ${this.maxHealth}`],
        ["Top speed", `${Math.round(S.speed * 3.6)} km/h (reverse ${Math.round(S.reverse * 3.6)})`],
        ["Turret traverse", `${Math.round((S.traverse * 180) / Math.PI)}° a second`],
        ["Main gun", `HE, reload ${S.reload} s, ${S.shellSpeed} m/s`],
        ["Gun elevation", `${Math.round((S.minPitch * 180) / Math.PI)}° to +${Math.round((S.maxPitch * 180) / Math.PI)}°`],
      ],
      controls: [
        ["W / S", "Forward / brake, reverse"],
        ["A / D", "Turn the hull"],
        ["Space", "Brake"],
        ["Mouse", "Aim (the turret follows at its own speed)"],
        ["Left click", "Main gun"],
        ["Right click", "Coaxial machine gun"],
        ["V / F5", "Gunner's sight"],
        ["C", "Smoke screen"],
        ["F", "Get out"],
      ],
    };
  }
}
const _coaxC = new THREE.Color(1.8, 1.4, 0.6);

// A smoke screen: grenades thrown out in a fan ahead of the turret, each a
// growing white cloud that hangs for a while. The enemy can't see through
// (tanks.js asks smokeBlocks()).
export const smokeClouds = [];
export function launchSmoke(v, mgr) {
  const fx = mgr.effects;
  const d = v.gunDir(new THREE.Vector3());
  d.y = 0;
  d.normalize();
  const c0 = new THREE.Color(0.86, 0.86, 0.84);
  const c1 = new THREE.Color(0.93, 0.93, 0.92);
  const now = performance.now() / 1000;
  for (let i = 0; i < 8; i++) {
    const a = (i / 7 - 0.5) * 1.4;
    const dir = d.clone().applyAxisAngle(_u.set(0, 1, 0), a);
    const at = v.pos.clone().addScaledVector(dir, 16 + Math.random() * 4);
    at.y = mgr.groundBelow(at.x, v.pos.y + 6, at.z) + 2;
    smokeClouds.push({ x: at.x, y: at.y, z: at.z, r: 6, until: now + 22 });
    for (let k = 0; k < Math.round(6 * Math.max(0.4, effectsQuality.scale)); k++) fx.smoke.spawn({ x: at.x + (Math.random() - 0.5) * 4, y: at.y + Math.random() * 3, z: at.z + (Math.random() - 0.5) * 4, vx: (Math.random() - 0.5) * 1.2, vy: 0.4 + Math.random() * 0.6, vz: (Math.random() - 0.5) * 1.2, life: 18 + Math.random() * 6, size0: 4, size1: 12, color0: c0, color1: c1, alpha: 0.85, drag: 0.6, hold: 0.6 });
    fx.glow.spawn({ x: at.x, y: at.y, z: at.z, life: 0.2, size0: 2, size1: 0.5, color0: new THREE.Color(3, 2.5, 1.5), alpha: 0.8 });
  }
  while (smokeClouds.length > 40) smokeClouds.shift();
  mgr.audio?._hit?.({ type: "bandpass", f: 500, q: 1, d: 0.25, v: 0.35, n: 8, spread: 0.05 });
}

// Does the segment a-b pass through a smoke cloud (still standing)?
export function smokeBlocks(a, b) {
  const now = performance.now() / 1000;
  for (let i = smokeClouds.length - 1; i >= 0; i--) {
    const c = smokeClouds[i];
    if (c.until < now) {
      smokeClouds.splice(i, 1);
      continue;
    }
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const dz = b.z - a.z;
    const L2 = dx * dx + dy * dy + dz * dz || 1;
    const t = clamp(((c.x - a.x) * dx + (c.y - a.y) * dy + (c.z - a.z) * dz) / L2, 0, 1);
    const px = a.x + dx * t - c.x;
    const py = a.y + dy * t - c.y;
    const pz = a.z + dz * t - c.z;
    if (px * px + py * py + pz * pz < c.r * c.r) return true;
  }
  return false;
}

VehicleManager.register("tank", Tank);

// Puts a drivable tank down (the Creative palette, a call-in, a mission):
// kind "tiger" | "mbt", at pos (a Vector3 on the ground), heading yaw.
export function summonTank(vehicles, kind = "mbt", pos, yaw = 0, extra = {}) {
  const v = vehicles.create("tank", { kind: TANK_TYPES[kind] ? kind : "mbt", pos: [pos.x, pos.y, pos.z], yaw, ...extra });
  if (v) v.settle(true);
  return v;
}
