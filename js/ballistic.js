// (Round 13) Ballistic missiles and their launchers (TELs: transporter-
// erector-launchers, the missile trucks).
//
// A launch, as the owner asked for it ("very slow and then go up in the
// sky, realistic and really cool"): the truck lowers its four jacks onto the
// ground, the erector's hydraulics lift the long missile upright over
// several seconds (a whine), a pause with vapour venting from the missile,
// then ignition: a cloud of smoke and dust bursts out round the base, the
// engine's flame grows, and the missile leaves the arm *very* slowly, gains
// speed (the thrust grows as the fuel burns off: a cubic climb), arcs over
// high into the sky toward its target far away (a lofted arc: straight up,
// over, and steeply down), trailing a long bright flame and a thick white
// smoke trail that stays and drifts for half a minute, and comes down on
// its target in a huge blast (effects.js: "ballistic"). Then the erector
// comes back down; a launcher of the aliens' reloads after a while.
//
// The flight is a curve fixed at launch (from the missile's tail on the
// arm to the target, with a height for the arc), flown by a speed profile:
// every peer can fly the same missile from the same numbers (net/ground.js
// sends them once); only its owner's warhead is real.
//
// In Creative a TEL can be put down and driven (W/S, A/D); the mouse aims,
// left click marks the target under the crosshair and launches at it,
// right click calls a launch off (before ignition). (Round 14) Any point
// is a target: whatever the crosshair is on (a hill, the water, a roof, a
// tree) out to the launcher's reach, or, aimed farther (a far hill, over
// the horizon, the sky), the ground at its full reach on that bearing; a
// ring on the ground (the warhead's blast) and the range show where it
// will go before the launch. In a Missions world the
// aliens' launchers (tanks.js) fire at the players' airport or at them,
// with a warning: destroy them first.
import * as THREE from "three";
import { VehicleManager } from "./vehicles.js";
import { GroundVehicle } from "./vehicle-tank.js";
import { createMissileMesh, MISSILE_LENGTH } from "./tank-model.js";
import { effectsQuality } from "./effects.js";
import { LAYER_FX } from "./layers.js";
import { IS_LIQUID } from "./blocks.js";
import { SEA_LEVEL } from "./constants.js";

export const TEL_SPEC = { id: "tel", name: "Missile launcher (TEL)", short: "a truck with a ballistic missile", paint: "olive", maxHealth: 320, speed: 11, reverse: 4, accel: 2.4, brake: 8, turn: 0.42, traverse: 0, elev: 0, minPitch: 0, maxPitch: 0, reload: 0, shellSpeed: 1, mass: 5 };
// The launch's steps (seconds).
export const LAUNCH_TIMES = { jacks: 2.5, raise: 9, ready: 2.8, ignite: 1.6, lower: 7 };
const JERK = 6; // the climb: v(t) = A0 t + JERK t^2 / 2 (blocks/s), up to VMAX
const A0 = 1.2;
const VMAX = 270;
const WARHEAD_RADIUS = 11; // what it digs and hurts
const WARHEAD_LOOK = 32; // how big it looks
const TRAIL_LIFE = 32; // seconds the smoke trail hangs
// (Round 14) The launcher's reach: on the map, from the truck to the target (blocks).
export const TEL_RANGE = { min: 120, max: 2000 };
const CAM_TILT = 0.1; // (the chase view looks this far below the mouse's line: the crosshair is the view's centre)
const WATER_TOP = SEA_LEVEL + 0.85; // (the sea's surface where the map has no blocks, as the far terrain draws it)

const _v = new THREE.Vector3();
const _w = new THREE.Vector3();
const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();

function clamp(v, a, b) {
  return v < a ? a : v > b ? b : v;
}

// The distance covered t seconds after ignition (the speed profile).
export function boostDistance(t) {
  const tc = (-A0 + Math.sqrt(A0 * A0 + 2 * JERK * VMAX)) / JERK; // (when it reaches VMAX)
  if (t <= tc) return 0.5 * A0 * t * t + (JERK * t * t * t) / 6;
  const sc = 0.5 * A0 * tc * tc + (JERK * tc * tc * tc) / 6;
  return sc + VMAX * (t - tc);
}
export function boostSpeed(t) {
  return Math.min(VMAX, A0 * t + 0.5 * JERK * t * t);
}

// The flight's path: a cubic curve from S (straight up) over an arc of
// height H to T (straight down), with an arc-length table.
export function flightPath(S, T, H) {
  const P0 = new THREE.Vector3().copy(S);
  const P1 = new THREE.Vector3(S.x, S.y + H, S.z);
  const P2 = new THREE.Vector3(T.x, Math.max(T.y, S.y) + H * 0.85, T.z);
  const P3 = new THREE.Vector3().copy(T);
  const at = (u, out) => {
    const a = (1 - u) ** 3;
    const b = 3 * (1 - u) ** 2 * u;
    const c = 3 * (1 - u) * u * u;
    const d = u ** 3;
    return out.set(P0.x * a + P1.x * b + P2.x * c + P3.x * d, P0.y * a + P1.y * b + P2.y * c + P3.y * d, P0.z * a + P1.z * b + P2.z * c + P3.z * d);
  };
  const N = 96;
  const s = new Float64Array(N + 1);
  const p = new THREE.Vector3();
  const q = new THREE.Vector3().copy(P0);
  for (let i = 1; i <= N; i++) {
    at(i / N, p);
    s[i] = s[i - 1] + p.distanceTo(q);
    q.copy(p);
  }
  return {
    length: s[N],
    // The point and the direction of travel `dist` blocks along it.
    point(dist, out, dir = null) {
      const L = s[N];
      const d = clamp(dist, 0, L);
      let lo = 0;
      let hi = N;
      while (hi - lo > 1) {
        const m = (lo + hi) >> 1;
        if (s[m] < d) lo = m;
        else hi = m;
      }
      const k = (d - s[lo]) / Math.max(1e-9, s[hi] - s[lo]);
      const u = (lo + k) / N;
      at(u, out);
      if (dir) {
        at(Math.min(1, u + 0.004), dir);
        const back = at(Math.max(0, u - 0.004), _w);
        dir.sub(back).normalize();
      }
      return out;
    },
  };
}

// The arc's height for a flight of `flat` blocks: high, as a ballistic
// missile's (it leaves the view straight up before it comes over).
export function arcHeight(flat) {
  return clamp(220 + flat * 0.32, 260, 900);
}

// (Round 14) The top of the water (or lava) a ray came through to (x, y, z),
// as a height, or null when that block isn't a liquid.
function liquidTop(world, x, y, z) {
  if (!IS_LIQUID[world.getBlock(x, y, z)]) return null;
  let top = y;
  while (top - y < 64 && IS_LIQUID[world.getBlock(x, top + 1, z)]) top++;
  return top + 0.85;
}

// (Round 14) The ground's top at (x, z): the highest solid block (or the
// water over it); the height map beyond the loaded land (the sea's level
// over the sea); `fallback` with neither (the Nether's, the End's void).
function groundTop(world, x, z, fallback) {
  const y = world.surfaceY(x, z);
  if (y >= 0) return liquidTop(world, Math.floor(x), y + 1, Math.floor(z)) ?? y + 1;
  if (world.getChunk(Math.floor(x) >> 4, Math.floor(z) >> 4) || !world.dimInfo?.heightfield) return fallback;
  return Math.max(world.heightAt(Math.floor(x), Math.floor(z)) + 1, WATER_TOP);
}

// (Round 14) Where a launch from `origin` (the truck) goes for the
// crosshair's ray (from, dir): the first thing the ray meets (the ground, a
// hill, a building, a tree, the surface of water or lava) within the
// launcher's reach; a ray that meets nothing in reach (a far mountain, over
// the horizon, the sky) marks the ground at the full reach on its bearing
// ("capped"). Fills `out`: { point, dist (on the map, from the truck), ok,
// why ("" | "near" | "up"), capped }. Only too close is refused (and a ray
// straight up, which has no bearing).
export function telAim(world, origin, from, dir, out = {}) {
  const p = (out.point ||= new THREE.Vector3());
  const max = TEL_RANGE.max;
  const h = world.raycast(from, dir, max + Math.max(0, from.distanceTo(origin)) + 40, { solidOnly: true });
  out.capped = false;
  if (h) {
    p.copy(from).addScaledVector(dir, h.distance);
    // (Through water or lava to the bottom: the target is their surface.)
    const top = liquidTop(world, h.place[0], h.place[1], h.place[2]) ?? (!world.getChunk(h.block[0] >> 4, h.block[2] >> 4) && world.dimInfo?.heightfield && p.y < WATER_TOP ? WATER_TOP : null);
    if (top !== null && top > p.y) {
      const t = dir.y < -1e-4 ? (top - from.y) / dir.y : -1;
      if (t > 0 && t < h.distance) p.copy(from).addScaledVector(dir, t);
      else p.y = top;
    }
  }
  if (!h || Math.hypot(p.x - origin.x, p.z - origin.z) > max) {
    // (Out of reach: the ground at the full reach, on the ray's bearing from the truck.)
    const bx = h ? p.x - origin.x : dir.x;
    const bz = h ? p.z - origin.z : dir.z;
    const hl = Math.hypot(bx, bz);
    if (hl < 0.05) {
      out.dist = 0;
      out.why = "up";
      out.ok = false;
      return out;
    }
    p.set(origin.x + (bx / hl) * max, 0, origin.z + (bz / hl) * max);
    p.y = groundTop(world, p.x, p.z, origin.y);
    out.capped = true;
  }
  out.dist = Math.hypot(p.x - origin.x, p.z - origin.z);
  out.why = out.dist < TEL_RANGE.min ? "near" : "";
  out.ok = !out.why;
  return out;
}

// A range as the HUD writes it: metres, kilometres from 1 km.
export function fmtRange(d) {
  return d >= 1000 ? `${(d / 1000).toFixed(d >= 10000 ? 1 : 2)} km` : `${Math.round(d)} m`;
}

let _flameTex = null;
function flameTexture() {
  if (_flameTex) return _flameTex;
  const c = document.createElement("canvas");
  c.width = 16;
  c.height = 64;
  const ctx = c.getContext("2d");
  const g = ctx.createLinearGradient(0, 0, 0, 64);
  g.addColorStop(0, "rgba(255,255,235,1)");
  g.addColorStop(0.15, "rgba(255,225,140,0.95)");
  g.addColorStop(0.5, "rgba(255,140,40,0.55)");
  g.addColorStop(1, "rgba(255,70,10,0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 16, 64);
  const h = ctx.createLinearGradient(0, 0, 16, 0);
  h.addColorStop(0, "rgba(0,0,0,0.6)");
  h.addColorStop(0.5, "rgba(0,0,0,0)");
  h.addColorStop(1, "rgba(0,0,0,0.6)");
  ctx.globalCompositeOperation = "destination-out";
  ctx.fillStyle = h;
  ctx.fillRect(0, 0, 16, 64);
  _flameTex = new THREE.CanvasTexture(c);
  return _flameTex;
}

// The flame behind a missile's nozzle: two crossed additive cones (a white
// core and the long orange plume), grown and flickered by the caller.
function flameMesh() {
  const g = new THREE.Group();
  const tex = flameTexture();
  const mk = (r, color, order) => {
    const cone = new THREE.ConeGeometry(r, 1, 12, 1, true).rotateX(-Math.PI / 2).translate(0, 0, 0.5);
    const m = new THREE.Mesh(cone, new THREE.MeshBasicMaterial({ map: tex, color, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: true }));
    m.layers.set(LAYER_FX);
    m.renderOrder = order;
    g.add(m);
    return m;
  };
  g.userData.plume = mk(0.55, new THREE.Color(3.2, 2, 0.9), 12);
  g.userData.core = mk(0.28, new THREE.Color(4, 3.8, 3.2), 13);
  // (The cones point toward +z from the nozzle: the missile's tail is +z.)
  return g;
}

// ---------- The missile in flight ----------

class Ballistic {
  constructor(sys, { S, T, H, owner = null, remote = false, id = 0, by = 0 }) {
    this.sys = sys;
    this.S = S.clone();
    this.T = T.clone();
    this.H = H;
    this.path = flightPath(this.S, this.T, H);
    this.t = 0;
    this.dist = 0;
    this.owner = owner;
    this.remote = remote;
    this.id = id;
    this.by = by;
    this.pos = this.S.clone();
    this.dir = new THREE.Vector3(0, 1, 0);
    this.vel = new THREE.Vector3();
    this.mesh = createMissileMesh();
    this.flame = flameMesh();
    this.flame.position.set(0, 0, 0.3);
    this.mesh.add(this.flame);
    sys.scene.add(this.mesh);
    this.trail = 0;
    this.done = false;
    this.speeds = []; // (tests: the speed profile, sampled)
  }

  update(dt) {
    const fx = this.sys.effects;
    this.t += dt;
    const speed = boostSpeed(this.t);
    this.dist = boostDistance(this.t);
    const L = this.path.length;
    if (this.speeds.length < 400 && (this.speeds.length === 0 || this.t - this.speeds[this.speeds.length - 1][0] > 0.25)) this.speeds.push([Math.round(this.t * 100) / 100, Math.round(speed * 10) / 10, Math.round(this.dist * 10) / 10]);
    const prev = _v.copy(this.pos);
    this.path.point(this.dist, this.pos, this.dir);
    this.vel.copy(this.dir).multiplyScalar(speed);
    // The mesh: its tail at pos, the nose along the flight.
    this.mesh.position.copy(this.pos);
    this.mesh.quaternion.setFromUnitVectors(_w.set(0, 0, -1), this.dir);
    const l = this.sys.world.lightAt(this.pos.x, this.pos.y, this.pos.z);
    this.mesh.userData.light.sky = Math.max(10, l.sky);
    this.mesh.userData.light.block = l.block;
    // The flame: short and fat leaving the arm, long and bright at speed.
    const k = clamp(speed / 120, 0, 1);
    const flick = 0.9 + Math.random() * 0.2;
    // (Leaving the arm the flame is short and fat, splashing on the ground; at speed long and bright.)
    const fl = (9 + k * 22) * flick;
    const w = 2.8 - k * 0.8;
    this.flame.userData.plume.scale.set(w, w, fl);
    this.flame.userData.core.scale.set(w * 0.75, w * 0.75, fl * 0.5);
    if (this.t < 5) {
      // The glare round the nozzle while it is low (a bright light on the ground under it).
      fx.glow.spawn({ x: this.pos.x - this.dir.x * 2, y: this.pos.y - this.dir.y * 2, z: this.pos.z - this.dir.z * 2, life: Math.max(0.06, dt * 1.5), size0: 9 - this.t, size1: 4, color0: this.sys._c.hot, alpha: 0.55 });
    }
    // The smoke trail: thick and white, hanging in the sky.
    const moved = prev.distanceTo(this.pos);
    this.trail += moved;
    const q = Math.max(0.35, effectsQuality.scale);
    // (Round 13: farther apart at speed, the puffs grow to 9-13 blocks anyway,
    // and twice as far once the pool is filling: a long flight, or two at once,
    // used to overflow its 900 and cut the trail's far end off.)
    const pool = fx.trail.particles?.length / (fx.trail.capacity || 900) || 0;
    const spacing = ((this.t < 4 ? 0.8 : 3 + speed * 0.02) / q) * (pool > 0.7 ? 2 : 1);
    const c = this.sys._c;
    let guard = 0;
    while (this.trail > spacing && guard++ < 40) {
      this.trail -= spacing;
      const back = _w.copy(this.pos).addScaledVector(this.dir, -(this.trail + 1.5));
      const young = this.t < 6;
      fx.trail.spawn({ x: back.x + (Math.random() - 0.5) * 0.6, y: back.y, z: back.z + (Math.random() - 0.5) * 0.6, vx: (Math.random() - 0.5) * 0.8 + this.sys.wind.x, vy: young ? 0.6 : 0.15, vz: (Math.random() - 0.5) * 0.8 + this.sys.wind.z, life: TRAIL_LIFE * (0.75 + Math.random() * 0.4), size0: young ? 2.8 : 2.4, size1: young ? 13 : 9 + Math.random() * 4, color0: c.trail0, color1: c.trail1, alpha: 0.85, drag: 0.5, hold: 0.55 });
    }
    // The nozzle's glow.
    fx.glow.spawn({ x: this.pos.x - this.dir.x * 0.5, y: this.pos.y - this.dir.y * 0.5, z: this.pos.z - this.dir.z * 0.5, life: Math.max(0.05, dt * 1.4), size0: 3.5 + k * 3, size1: 1.5, color0: c.hot, alpha: 0.9 });
    // Down on the target.
    if (this.dist >= L - 0.5) {
      this.done = true;
      this.sys.scene.remove(this.mesh);
      this.mesh.material.dispose();
      for (const ch of this.flame.children) ch.material.dispose();
      if (!this.remote) this.sys.impact(this);
    }
  }

  dispose() {
    this.sys.scene.remove(this.mesh);
  }
}

// Every ballistic missile in flight, and the launches' effects.
export class BallisticSystem {
  constructor({ scene, world, effects, audio, vehicles }) {
    this.scene = scene;
    this.world = world;
    this.effects = effects;
    this.audio = audio;
    this.vehicles = vehicles;
    this.missiles = [];
    this.wind = new THREE.Vector3(0.6, 0, 0.25);
    this._id = 1;
    this.launched = 0;
    this.impacts = []; // (tests: [{ at, t }])
    this.onLaunch = null; // (missile) => void: online, tell the others (net/ground.js)
    this.onImpact = null; // (missile, at) => void
    this._c = { trail0: new THREE.Color(0.9, 0.9, 0.88), trail1: new THREE.Color(0.97, 0.97, 0.96), hot: new THREE.Color(6, 4.6, 2.4), dust: new THREE.Color(0.6, 0.53, 0.42), s0: new THREE.Color(0.8, 0.79, 0.77) };
    vehicles.ballistics = this;
  }

  // A missile leaves from S (its tail) for T over an arc of height H.
  launch({ S, T, H = null, owner = null, remote = false, id = null, by = 0 }) {
    const flat = Math.hypot(T.x - S.x, T.z - S.z);
    const m = new Ballistic(this, { S, T, H: H ?? arcHeight(flat), owner, remote, id: id ?? this._id++, by });
    this.missiles.push(m);
    this.launched++;
    if (!remote) this.onLaunch?.(m);
    return m;
  }

  // The warhead goes off.
  impact(m) {
    const at = m.T.clone();
    this.impacts.push({ at: at.clone(), t: performance.now() });
    if (this.impacts.length > 6) this.impacts.shift();
    // (An enemy launcher's is not a player's: no PvP rule, no kill credit, its own death message.)
    this.effects.explode(at, { radius: WARHEAD_RADIUS, source: m.owner?.enemy ? "enemyballistic" : "ballistic", visual: WARHEAD_LOOK });
    this.onImpact?.(m, at);
  }

  // The ignition at the launcher's base: smoke and dust bursting out all
  // round, a flash, the roar.
  ignition(at) {
    const fx = this.effects;
    const q = Math.max(0.3, effectsQuality.scale);
    const c = this._c;
    for (let i = 0; i < Math.round(46 * q) + 8; i++) {
      const a = Math.random() * Math.PI * 2;
      const sp = 6 + Math.random() * 16;
      fx.trail.spawn({ x: at.x + Math.cos(a) * 1.5, y: at.y + 0.5 + Math.random() * 1.5, z: at.z + Math.sin(a) * 1.5, vx: Math.cos(a) * sp, vy: 0.5 + Math.random() * 3, vz: Math.sin(a) * sp, life: 10 + Math.random() * 8, size0: 2.5, size1: 11 + Math.random() * 6, color0: Math.random() < 0.35 ? c.dust : c.s0, color1: c.trail1, alpha: 0.85, drag: 1.4, hold: 0.4 });
    }
    for (let i = 0; i < Math.round(20 * q) + 4; i++) {
      const a = Math.random() * Math.PI * 2;
      fx.glow.spawn({ x: at.x, y: at.y + 0.6, z: at.z, vx: Math.cos(a) * (8 + Math.random() * 10), vy: Math.random() * 3, vz: Math.sin(a) * (8 + Math.random() * 10), life: 0.5 + Math.random() * 0.4, size0: 2.5, size1: 5, color0: c.hot, alpha: 0.5, drag: 3 });
    }
    fx.muzzleFlash?.(at, 8);
    const d = at.distanceTo(fx.listener);
    fx.shake?.add?.(Math.max(0, 0.45 - d / 260));
    playRoar(this.audio, d, 5);
  }

  update(dt) {
    for (let i = this.missiles.length - 1; i >= 0; i--) {
      const m = this.missiles[i];
      m.update(dt);
      if (m.done) this.missiles.splice(i, 1);
    }
  }

  clear() {
    for (const m of this.missiles) m.dispose();
    this.missiles.length = 0;
  }
}

// A rocket engine's roar: a long, low, crackling rumble (seconds), lagging
// and falling off with distance.
export function playRoar(audio, distance = 0, seconds = 4) {
  const ctx = audio?.ctx;
  if (!ctx || !audio._noise) return;
  const k = 1 / (1 + distance / 60);
  if (k < 0.03) return;
  audio._cat?.("weapons");
  const t = ctx.currentTime + distance / 340;
  const src = audio._noise(t, seconds + 0.5);
  const lp = ctx.createBiquadFilter();
  lp.type = "lowpass";
  lp.frequency.setValueAtTime(420, t);
  lp.frequency.linearRampToValueAtTime(900, t + seconds * 0.4);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(0.7 * k, t + 0.8);
  g.gain.setValueAtTime(0.7 * k, t + seconds * 0.6);
  g.gain.exponentialRampToValueAtTime(0.0001, t + seconds + 0.4);
  src.connect(lp).connect(g).connect(audio._out || audio.master);
}

// The erector's hydraulics: a rising whine for `seconds`.
export function playHydraulics(audio, distance = 0, seconds = 8) {
  const ctx = audio?.ctx;
  if (!ctx) return;
  const k = 1 / (1 + distance / 25);
  if (k < 0.04) return;
  audio._cat?.("weapons");
  const t = ctx.currentTime;
  const o = ctx.createOscillator();
  o.type = "sawtooth";
  o.frequency.setValueAtTime(140, t);
  o.frequency.linearRampToValueAtTime(230, t + seconds);
  const bp = ctx.createBiquadFilter();
  bp.type = "bandpass";
  bp.frequency.value = 600;
  bp.Q.value = 2;
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(0.07 * k, t + 0.4);
  g.gain.setValueAtTime(0.07 * k, t + seconds - 0.4);
  g.gain.exponentialRampToValueAtTime(0.0001, t + seconds);
  o.connect(bp).connect(g).connect(audio._out || audio.master);
  o.start(t);
  o.stop(t + seconds + 0.1);
}

// ---------- The launcher ----------

const STATES = ["travel", "jacks", "raise", "ready", "ignite", "lower", "empty"];

export class Tel extends GroundVehicle {
  constructor(manager, data = {}) {
    super(manager, { ...data, kind: "tel" }, { type: "tel", name: TEL_SPEC.name, spec: TEL_SPEC, kind: "tel", model: "tel", maxHealth: TEL_SPEC.maxHealth });
    this.cameraModes = ["chase"];
    this.state = "travel";
    this.stateT = 0;
    this.erect = 0;
    this.jacks = 0;
    this.loaded = data.loaded !== false;
    this.target = null; // the launch's target (a Vector3)
    this.telReloadT = 0;
    this.lookYaw = this.yaw;
    this.lookPitch = -0.1;
    this.aimPoint = new THREE.Vector3();
    this.aim = { point: this.aimPoint, dist: 0, ok: false, why: "", capped: false }; // (Round 14: telAim's)
    this._aimFrom = new THREE.Vector3(NaN, 0, 0);
    this._aimDir = new THREE.Vector3();
    this._aimAge = 0;
    this._hudSeen = 0;
    this.enemy = !!data.enemy;
    this._unusable = false;
    this.model.setMissile(this.loaded);
  }

  // Creative only (and never the aliens'): a launcher is no Missions weapon.
  get unusable() {
    return this._unusable || this.enemy || !this.manager.player?.creative;
  }
  set unusable(v) {
    this._unusable = !!v;
  }

  get busy() {
    return this.state !== "travel" && this.state !== "empty";
  }

  // Starts the launch at `target` (a point): false if it can't now.
  startLaunch(target) {
    if (!this.alive || !this.loaded || this.busy) return false;
    this.target = target.clone();
    this._setState("jacks");
    this.speed = 0;
    return true;
  }

  // Calls a launch off before the engine lights.
  abort() {
    if (this.state === "jacks" || this.state === "raise" || this.state === "ready") this._setState("lower");
  }

  _setState(s) {
    this.state = s;
    this.stateT = 0;
    const mgr = this.manager;
    const ears = mgr.effects?.listener;
    const d = ears ? this.pos.distanceTo(ears) : 0;
    if (s === "raise") playHydraulics(mgr.audio, d, LAUNCH_TIMES.raise);
    if (s === "lower") playHydraulics(mgr.audio, d, LAUNCH_TIMES.lower * 0.8);
    this.onState?.(s);
  }

  // The missile's tail, upright on the arm (where it leaves from).
  _tail(out) {
    this.model.missileWorld(_m);
    return out.setFromMatrixPosition(_m);
  }

  _advance(dt) {
    const T = LAUNCH_TIMES;
    this.stateT += dt;
    const mgr = this.manager;
    const fx = mgr.effects;
    switch (this.state) {
      case "jacks":
        this.jacks = Math.min(1, this.stateT / T.jacks);
        if (this.stateT >= T.jacks) this._setState("raise");
        break;
      case "raise": {
        // (Slow to start and to stop, as hydraulics are.)
        const u = clamp(this.stateT / T.raise, 0, 1);
        this.erect = u * u * (3 - 2 * u);
        if (u >= 1) this._setState("ready");
        break;
      }
      case "ready":
        // Vapour venting off the fuelled missile.
        if (Math.random() < dt * 6) {
          const p = this._tail(_v);
          const h = 2 + Math.random() * (MISSILE_LENGTH - 3);
          fx.smoke.spawn({ x: p.x + (Math.random() - 0.5), y: p.y + h, z: p.z + (Math.random() - 0.5), vx: (Math.random() - 0.5) * 1.5, vy: -0.3, vz: (Math.random() - 0.5) * 1.5, life: 2, size0: 0.5, size1: 2.5, color0: this._vapC || (this._vapC = new THREE.Color(0.95, 0.96, 0.98)), alpha: 0.5, drag: 1 });
        }
        if (this.stateT >= T.ready) {
          this._setState("ignite");
          mgr.ballistics?.ignition(this._tail(_v));
        }
        break;
      case "ignite": {
        // The engine lit and building up, the missile still held: fire and smoke under it.
        const p = this._tail(_v);
        if (Math.random() < 0.8) fx.glow.spawn({ x: p.x, y: p.y + 0.2, z: p.z, vx: (Math.random() - 0.5) * 6, vy: -2, vz: (Math.random() - 0.5) * 6, life: 0.3, size0: 3, size1: 5, color0: mgr.ballistics?._c.hot || new THREE.Color(5, 3, 1), alpha: 0.6, drag: 2 });
        if (this.stateT >= T.ignite) {
          // Away: the missile leaves the arm (owned here: its warhead is ours).
          const S = this._tail(new THREE.Vector3());
          this.loaded = false;
          this.model.setMissile(false);
          this.lastMissile = mgr.ballistics?.launch({ S, T: this.target, owner: this, by: this.netBy || 0 });
          this.onLaunched?.(this.lastMissile);
          this._setState("lower");
        }
        break;
      }
      case "lower": {
        const u = clamp(this.stateT / T.lower, 0, 1);
        this.erect = Math.min(this.erect, 1 - u * u * (3 - 2 * u));
        if (u >= 1) {
          this.jacks = Math.max(0, this.jacks - dt / 1.5);
          if (this.jacks <= 0) this._setState(this.loaded ? "travel" : "empty");
        }
        break;
      }
      case "empty":
        // (Reloaded: a fresh missile after a while; at once in Creative.)
        this.telReloadT -= dt;
        if (this.telReloadT <= 0) {
          this.loaded = true;
          this.model.setMissile(true);
          this._setState("travel");
        }
        break;
    }
  }

  _control(dt, input) {
    const mgr = this.manager;
    if (this.state === "empty" && !this._reloading) {
      this._reloading = true;
      this.telReloadT = this.enemy ? this.reloadTime ?? 90 : 6;
    }
    if (this.state !== "empty") this._reloading = false;
    if (this.busy || this.state === "empty") {
      this._drive(dt, 0, 0, true);
      this._advance(dt);
    } else if (input) {
      const k = input.keys;
      const throttle = (k.has("KeyW") ? 1 : 0) - (k.has("KeyS") ? 1 : 0);
      const steer = (k.has("KeyA") ? 1 : 0) - (k.has("KeyD") ? 1 : 0);
      this._drive(dt, throttle, steer, k.has("Space"));
    } else this._drive(dt, 0, 0, true);
    if (input) {
      const sens = 0.0022 * (mgr.mouseSensitivity ?? 0.6);
      this.lookYaw -= input.dx * sens;
      this.lookPitch = clamp(this.lookPitch - input.dy * sens * (mgr.invertY ? -1 : 1), -0.9, 0.4);
      this.camYaw = this.lookYaw;
      this.camPitch = this.lookPitch;
      // (Round 14) The aim: what the crosshair is on (the view's centre: the
      // camera's tilt included, as the old aim's wasn't), at any range.
      const from = this._cam || _v.copy(this.pos).setY(this.pos.y + 3);
      const vp = this.lookPitch - CAM_TILT;
      this._aimAt(from, _w.set(-Math.sin(this.lookYaw) * Math.cos(vp), Math.sin(vp), -Math.cos(this.lookYaw) * Math.cos(vp)), dt);
      if (input.pressed.has("mouse0")) {
        const a = this.aim;
        if (!this.loaded) mgr.onMessage?.("Reloading the launcher...");
        else if (this.busy) mgr.onMessage?.("Already launching");
        else if (a.why === "near") mgr.onMessage?.(`Too close: ${fmtRange(a.dist)} away, the target must be at least ${fmtRange(TEL_RANGE.min)} out`);
        else if (!a.ok) mgr.onMessage?.("Aim lower: at the ground or the horizon");
        else if (this.startLaunch(this.aimPoint)) mgr.onMessage?.(`LAUNCH SEQUENCE: target ${fmtRange(a.dist)} out`);
      }
      if (input.pressed.has("mouse2")) this.abort();
    } else this._showAim(false); // (not driven by us: no marker)
    this.model.setErector(this.erect);
    this.model.setJacks(this.jacks);
  }

  // (Round 14) Updates the aim for the crosshair's ray: cast again when the
  // view turns, ten times a second while driving, now and then otherwise
  // (the land changing), the long cast being the costly part.
  _aimAt(from, dir, dt) {
    this._aimAge += dt;
    if (this._aimAge < 0.4 && dir.dot(this._aimDir) > 0.9999985 && (this._aimAge < 0.1 || from.distanceToSquared(this._aimFrom) < 0.04)) return;
    this._aimAge = 0;
    this._aimFrom.copy(from);
    this._aimDir.copy(dir);
    telAim(this.manager.world, this.pos, from, dir, this.aim);
    this.aimValid = this.aim.ok;
  }

  // (Round 14) The target marker while we drive it: a ring on the ground
  // round the aim (the warhead's blast, never smaller than a few pixels
  // far away), and over it a small ring on the screen (a flat ring far off
  // is seen edge on) with the range (MAX at the full reach); green for a
  // target, red too close, amber on the launch's own target while it goes.
  _drawAim(camera) {
    const fresh = performance.now() - this._hudSeen < 2500; // (the HUD asks every frame it shows: not behind a menu)
    const show = this.occupied && this.alive && fresh && typeof document !== "undefined" && !document.body.classList.contains("hud-off");
    this._showAim(show);
    if (!show) return;
    const launching = this.busy && this.target;
    const at = launching ? this.target : this.aimPoint;
    const a = this.aim;
    const why = launching ? "" : a.why;
    const color = launching ? 0xffc35a : why ? 0xff4a3a : 0x8dffb8;
    const M = this._mark;
    M.position.set(at.x, at.y + 0.25, at.z);
    M.scale.setScalar(Math.max(WARHEAD_RADIUS, at.distanceTo(camera.position) * 0.022));
    for (const ch of M.children) ch.material.color.setHex(color);
    const p = _v.copy(at).project(camera);
    const L = this._label;
    if (p.z > 1 || Math.abs(p.x) > 1.2 || Math.abs(p.y) > 1.2) {
      L.style.display = "none";
      return;
    }
    L.style.display = "block";
    const d = launching ? Math.hypot(at.x - this.pos.x, at.z - this.pos.z) : a.dist;
    const txt = launching ? `TARGET ${fmtRange(d)}` : why === "near" ? `TOO CLOSE ${fmtRange(d)} (MIN ${fmtRange(TEL_RANGE.min)})` : why ? "AIM LOWER" : `${a.capped ? "MAX RANGE " : ""}${fmtRange(d)}`;
    if (L._t !== txt) {
      L._t = txt;
      L._text.textContent = txt;
    }
    if (L._c !== color) {
      L._c = color;
      L.style.color = `#${color.toString(16).padStart(6, "0")}`;
    }
    const x = clamp(((p.x + 1) / 2) * window.innerWidth, 8, window.innerWidth - 8);
    const y = clamp(((1 - p.y) / 2) * window.innerHeight, 8, window.innerHeight - 8);
    L.style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px)`;
  }

  _showAim(on) {
    if (on && !this._mark) {
      // (The ring drawn over the land: on a hill or a roof it would sink in.)
      const mat = () => new THREE.MeshBasicMaterial({ color: 0x8dffb8, transparent: true, opacity: 0.85, depthTest: false, depthWrite: false, fog: false, side: THREE.DoubleSide });
      const g = new THREE.Group();
      g.add(new THREE.Mesh(new THREE.RingGeometry(0.93, 1, 64).rotateX(-Math.PI / 2), mat()));
      g.add(new THREE.Mesh(new THREE.RingGeometry(0.05, 0.11, 16).rotateX(-Math.PI / 2), mat()));
      for (const ch of g.children) {
        ch.renderOrder = 30;
        ch.frustumCulled = false;
      }
      this._mark = g;
      const L = document.createElement("div");
      L.className = "tel-aim";
      L.innerHTML = "<i></i><span></span>";
      L._text = L.lastChild;
      (document.getElementById("hud") || document.body).appendChild(L);
      this._label = L;
    }
    if (!this._mark || on === this._aimShown) return;
    this._aimShown = on;
    if (on) this.manager.scene.add(this._mark);
    else this.manager.scene.remove(this._mark);
    this._label.style.display = on ? "block" : "none";
  }

  onExit() {
    super.onExit?.();
    this._showAim(false);
  }

  dispose() {
    super.dispose();
    this._showAim(false);
    if (this._mark) {
      for (const ch of this._mark.children) {
        ch.geometry.dispose();
        ch.material.dispose();
      }
      this._label.remove();
      this._mark = null;
    }
  }

  netState(s) {
    super.netState(s);
    s.er = Math.round(this.erect * 1000) / 1000;
    s.jk = Math.round(this.jacks * 100) / 100;
    s.f = (this.loaded ? 1 : 0) | (STATES.indexOf(this.state) << 1);
  }

  netExtra(st) {
    if (Number.isFinite(st.er)) this.erect = st.er;
    if (Number.isFinite(st.jk)) this.jacks = st.jk;
    const f = st.f | 0;
    const loaded = !!(f & 1);
    const state = STATES[f >> 1] || "travel";
    // (The launch's moments seen from here: the hydraulics, the ignition.)
    if (state !== this.state) {
      if (state === "ignite") this.manager.ballistics?.ignition(this._tail(_v));
      const ears = this.manager.effects?.listener;
      if (state === "raise") playHydraulics(this.manager.audio, ears ? this.pos.distanceTo(ears) : 0, LAUNCH_TIMES.raise);
      this.state = state;
    }
    if (loaded !== this.loaded) {
      this.loaded = loaded;
      this.model.setMissile(loaded);
    }
    this.model.setErector(this.erect);
    this.model.setJacks(this.jacks);
  }

  updateCamera(camera, dt) {
    const back = _v.set(Math.sin(this.lookYaw) * Math.cos(this.lookPitch), -Math.sin(this.lookPitch), Math.cos(this.lookYaw) * Math.cos(this.lookPitch));
    const pivot = _w.copy(this.pos).setY(this.pos.y + 3);
    camera.position.copy(pivot).addScaledVector(back, 22).setY(pivot.y + 7 + back.y * 12);
    const g = this.manager.groundBelow(camera.position.x, camera.position.y + 2, camera.position.z);
    if (camera.position.y < g + 1.2) camera.position.y = g + 1.2;
    camera.quaternion.setFromEuler(_e.set(this.lookPitch - CAM_TILT, this.lookYaw, 0, "YXZ"));
    (this._cam || (this._cam = new THREE.Vector3())).copy(camera.position);
    const cam = this.manager.camera;
    if (cam && Math.abs(cam.fov - (this.manager.player?.fov || cam.fov)) > 0.1) {
      cam.fov = this.manager.player.fov;
      cam.updateProjectionMatrix();
    }
    this._drawAim(camera);
  }

  hud() {
    this._hudSeen = performance.now();
    const st = { travel: this.loaded ? "ready to launch" : "empty", jacks: "lowering the jacks", raise: `raising the missile ${Math.round(this.erect * 100)}%`, ready: "fuelled: ignition in a moment", ignite: "IGNITION", lower: "lowering the arm", empty: `reloading ${Math.max(0, Math.ceil(this.telReloadT))} s` }[this.state];
    return {
      title: TEL_SPEC.name,
      rows: [
        ["Speed", `${Math.round(Math.abs(this.speed) * 3.6)} km/h`],
        ["Launcher", st],
        ["Target", this.aim.why === "near" ? `${fmtRange(this.aim.dist)}: too close` : this.aim.ok ? `${fmtRange(this.aim.dist)}${this.aim.capped ? " (max range)" : ""}` : "aim lower"],
        ["Reach", `${fmtRange(TEL_RANGE.min)} to ${fmtRange(TEL_RANGE.max)}`],
      ],
      weapon: "Ballistic missile",
      warning: this.state === "ignite" ? "LAUNCH!" : "",
      health: this.health / this.maxHealth,
      help: "W/S drive, A/D turn, mouse aim (the ring marks the target), LMB launch at it, RMB call it off, F get out",
    };
  }

  infoPanel() {
    return {
      title: TEL_SPEC.name,
      stats: [["Armour", `${Math.round(this.health)} / ${this.maxHealth}`], ["Missile", "one ballistic missile, a huge blast"], ["Launch", "jacks, erector, ignition: about 16 s"], ["Reach", `${fmtRange(TEL_RANGE.min)} to ${fmtRange(TEL_RANGE.max)}`]],
      controls: [["W / S", "Drive"], ["A / D", "Turn"], ["Mouse", "Aim"], ["Left click", "Launch at what the crosshair is on (or, over the horizon, at full reach)"], ["Right click", "Call the launch off"], ["F", "Get out"]],
    };
  }

  serialize() {
    return { ...super.serialize(), loaded: this.loaded || this.busy, enemy: this.enemy || undefined };
  }
}

VehicleManager.register("tel", Tel);

// (Round 13) Creative's launcher (the palette's Vehicles tab): on the ground only.
VehicleManager.registerSummon?.("tel", { type: "tel", alt: 0, data: () => ({}) });

// Puts a TEL down (the Creative palette, a mission).
export function summonTel(vehicles, pos, yaw = 0, extra = {}) {
  const v = vehicles.create("tel", { pos: [pos.x, pos.y, pos.z], yaw, ...extra });
  if (v) v.settle(true);
  return v;
}
