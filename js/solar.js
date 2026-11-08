// The solar system (Round 16): flying in space, for real, with no cutscene.
//
// A rocket or a UFO (the Warp Saucer too) that climbs past a planet's space
// line (js/solar-data.js: 6,000 blocks over the Overworld, 3,000 over the
// Moon, 4,500 over Mars) hands over to this, the same frame: the same
// camera, the same craft (its very model, moved into space's own scene),
// the same velocity, now over a round planet in the solar system (js/
// solar-render.js draws it). The world behind is put on hold: nothing
// streams, nothing is drawn (main.js asks `worldIdle`).
//
// The craft:
//   rocket   Newton's laws: thrust along the nose, the pull of the body
//            whose sphere of influence it is in (patched conics: the path
//            is a conic, stepped exactly while coasting). Space / Shift the
//            throttle (Z full, X off), W A S D tilt the nose (as the camera
//            sees it), Q / E roll, the mouse turns the camera. R: the assist,
//            which points the nose and tells you when to burn and when to
//            cut the engine: into orbit after the climb; to the target (a
//            transfer worked out by Lambert's method, re-planned all the way,
//            so a burn off course is put right); down to a landing. The
//            spent core stage falls away a few seconds after the climb.
//   ufo      arcade, as in the world: W A S D along the view, Space / Shift
//            up and down (up: away from the planet below), the wheel's
//            cruising speed now reaching a fifth of the speed of light out
//            in space (slower near the ground). No orbits.
//   warp     the Warp Saucer (js/warp-saucer.js): a UFO with a warp drive.
//            J: warp on / off; the wheel: the warp factor (1c to 10,000c);
//            the mouse steers. The drive slows down near a planet (the
//            closer, the slower) and drops out by itself in front of it.
// Time warp (, and .; / back to 1x): 1x to 100,000x for the rocket and the
// UFOs (not at warp); it drops by itself on thrust and near a planet, so a
// trip to the Moon is minutes of real time and Mars possible.
// Guides (N): every planet's marker with its name, distance and the time to
// get there at this speed, an arrow at the edge for the ones off screen,
// and the target (T: the next; Shift+T: the one before) marked. The map (M):
// the planets' orbits, the ship's predicted path, the target.
//
// Down again: below a planet's entry altitude the solar system hands back:
// the world goes to that planet's dimension (js/dimensions.js travel: its
// loading screen hidden, the ground loading while the ship holds), the same
// craft is made again there, high up over the spot it came down on, moving
// as it was (an entry slows it to a speed the rocket's descent can land
// from: js/rocket.js's autopilot, or the player), with the player aboard.
// (Round 17: Mercury and Venus have ground too.) A gas giant has none (the ship is
// turned away), nor has the Sun (its heat pushes you back).
//
// Saving: the solar clock, the planets' turn, the guides, and the ship's
// place in space (a UFO saved up there comes back up there; a rocket is put
// back on the ground: js/rocket.js serialize). Online: each player flies on
// their own (the world they left holds their craft, still, up at the space
// line; the dimensions engine takes them alone to the planet they land on).
import * as THREE from "three";
import { SolarView } from "./solar-render.js";
import { SolarUI } from "./solar-ui.js";
import { createRocketModel } from "./rocket.js";
import { voice } from "./voice.js";
import { worldUniforms } from "./shaders.js";
import { designFacingOffset } from "./ufo-models.js";
import "./warp-saucer.js"; // (the Warp Saucer: its look, sound, summon)
import {
  BODIES,
  BODY_IDS,
  BODY_OF_DIM,
  BASE_Y,
  C_LIGHT,
  absState,
  localState,
  kepler,
  elements,
  lambert,
  worldToLatLon,
  latLonToWorld,
  surfaceFrame,
  spinVec,
  localFrame,
  spaceLineY,
  add,
  sub,
  scale,
  dot,
  len,
  norm,
} from "./solar-data.js";

export const TIME_WARPS = [1, 10, 100, 1000, 10000, 100000];
export const WARP_FACTORS = [1, 2, 5, 10, 20, 50, 100, 200, 500, 1000, 2000, 5000, 10000];
const THRUST = 45; // the ship's engine in space, m/s^2 at full throttle
const CORE_THRUST = 30; // the core stage's (the ship still on it)
const ENTRY_SPEED = { earth: 300, mars: 300, moon: 220, mercury: 220, venus: 260 }; // the most a ship comes into the world at (Round 17: Mercury, Venus)
const UFO_SPACE_TOP = 0.2 * C_LIGHT; // the UFO's cruise, out in space
const WARP_NEAR = 2; // at warp, the most the ship covers a second: this times the distance to the nearest ground (beyond 1.5 radii)
const WARP_DROP = 0.5 * C_LIGHT; // below this the drive drops out
const SEP_TIME = 3; // the core stage falls away this long into space
const _v = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _v3 = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _q2 = new THREE.Quaternion();
const _m = new THREE.Matrix4();
const X = new THREE.Vector3(1, 0, 0);
const Y = new THREE.Vector3(0, 1, 0);
const Z = new THREE.Vector3(0, 0, 1);
const smooth = (a, b, v) => {
  const t = Math.max(0, Math.min(1, (v - a) / (b - a)));
  return t * t * (3 - 2 * t);
};
const toV = (a, o = new THREE.Vector3()) => o.set(a[0], a[1], a[2]);
const toA = (v) => [v.x, v.y, v.z];

// A quaternion turning the world's axes (east, up, south) onto the frame's.
function frameQuat(f, out = new THREE.Quaternion()) {
  _m.makeBasis(toV(f.east, _v), toV(f.up, _v2), toV(f.south, _v3));
  return out.setFromRotationMatrix(_m);
}

export class SolarSystem {
  // space: js/space.js's SpaceSystem (captions, the game)
  constructor(space) {
    this.space = space;
    this.game = space.game;
    this.vehicles = space.vehicles;
    this.player = space.player;
    this.world = space.world;
    this.dims = space.dims;
    this.mp = space.mp;
    this.view = new SolarView();
    this.active = false;
    this.craft = null;
    this.t = 0; // the solar clock (s)
    this.spins = {}; // body -> its turn (radians), set when a ship leaves it
    this.warpIndex = 0; // the time warp
    this.guides = true;
    this.target = null;
    this.mapOpen = false;
    this.mapZoom = 1;
    this.pending = null; // a landing waiting for the world's ground
    this.resume = null; // (a save made in space: where the ship was)
    this._prewarmed = new WeakSet();
    this.inp = { dx: 0, dy: 0, wheel: 0, pressed: new Set(), buttons: [false, false, false] };
    this.stats = { exits: 0, entries: 0, lastEntry: null, maxWarp: 1 };
    this.ui = typeof document !== "undefined" ? new SolarUI(this) : null;
    // (the vehicles' hooks: while in space, the solar system flies the craft, and nobody gets out)
    const vm = this.vehicles;
    vm.spaceStep = (dt, input) => this._take(input);
    vm.spaceLock = () => (this.active ? "No getting out in space: fly down to a planet first" : null);
    if (typeof window !== "undefined") {
      window.addEventListener("keydown", (e) => {
        // (while the ground loads under a landing nobody is in a vehicle: the keys come here)
        if (this.active && !this.vehicles.active && !e.repeat) this.inp.pressed.add(e.code);
      });
    }
  }

  get timeWarp() {
    return TIME_WARPS[this.warpIndex];
  }

  // ---------- Input ----------

  // (the vehicles' update, while in space: their input is the ship's)
  _take(input) {
    if (!this.active) return false;
    const i = this.inp;
    i.dx += input.dx;
    i.dy += input.dy;
    i.wheel += input.wheel;
    for (const k of input.pressed) i.pressed.add(k);
    for (let b = 0; b < 3; b++) i.buttons[b] = input.buttons[b];
    return true;
  }

  get keys() {
    return this.player.keys || new Set();
  }

  // ---------- Leaving a world for space ----------

  // Whether vehicle v may climb into space from here (a rocket climbing, any UFO).
  canLeave(v) {
    if (!v || v.puppet || !v.alive) return false;
    const dim = this.world.dim || "overworld";
    if (!BODY_OF_DIM[dim]) return false;
    return v.type === "ufo" || (v.type === "rocket" && v.phase === "ascent");
  }

  // Readies the scene (textures, shaders) while a craft climbs toward the line.
  prewarm(v, renderer) {
    this.view.prepare(false);
    if (!renderer || this._prewarmed.has(v)) return;
    this._prewarmed.add(v);
    for (const id of BODY_IDS) this.view._body(id);
    try {
      const parent = v.root.parent;
      this.view.craft.add(v.root);
      renderer.compile(this.view.far, this.view.farCam);
      renderer.compile(this.view.near, this.view.nearCam);
      if (parent) parent.add(v.root);
      else this.view.craft.remove(v.root);
    } catch (err) {
      console.warn("MINECLAUDE: space's shaders weren't compiled ahead", err);
    }
  }

  // The world hands over: v (the player's craft) crossed the space line.
  enter(v) {
    if (this.active) return false;
    const dim = this.world.dim || "overworld";
    const body = BODY_OF_DIM[dim];
    const B = BODIES[body];
    this.view.prepare(true);
    for (const id of BODY_IDS) this.view._body(id);
    // The planet's turn: the sun where the world's sun is (day stays day).
    const { lat, lon } = worldToLatLon(body, v.pos.x, v.pos.z);
    const f0 = surfaceFrame(lat, lon);
    const sw = this._worldSun();
    const sb = [f0.east[0] * sw[0] + f0.up[0] * sw[1] + f0.south[0] * sw[2], f0.east[1] * sw[0] + f0.up[1] * sw[1] + f0.south[1] * sw[2], f0.east[2] * sw[0] + f0.up[2] * sw[1] + f0.south[2] * sw[2]];
    const bp = absState(body, this.t);
    const sun = norm(scale(bp, -1));
    // (turned about +y so the sun's bearing in the body's frame meets the real one)
    this.spins[body] = Math.atan2(sun[0], sun[2]) - Math.atan2(sb[0], sb[2]);
    const spin = this.spins[body];
    const f = { east: spinVec(f0.east, spin), up: spinVec(f0.up, spin), south: spinVec(f0.south, spin) };
    const alt = v.pos.y - BASE_Y;
    const fq = frameQuat(f);
    const c = {
      v,
      kind: v.type === "rocket" ? "rocket" : "warp", // (Round 16 follow-up: every UFO has the warp drive)
      ref: body,
      r: scale(f.up, B.r + alt),
      vel: [0, 0, 0],
      q: new THREE.Quaternion(),
      frameQ: fq.clone(),
      camYaw: v.camYaw,
      camPitch: v.camPitch,
      camDist: null,
      throttle: 1,
      assist: false,
      spaceT: 0,
      warpOn: false,
      warpFactor: 1000, // (Round 16 follow-up: fast from the start; the wheel goes 1c to 10,000c)
      warpK: 0,
      warpDir: new THREE.Vector3(0, 0, -1),
      speedLevel: v.speedLevel ?? 0.5,
      fromDim: dim,
      exit: [v.pos.x, v.pos.y, v.pos.z],
      camOff: new THREE.Vector3(),
      look: null,
    };
    // velocity: the world's, turned into space's axes
    const wv = v.vel;
    c.vel = add(add(scale(f.east, wv.x), scale(f.up, wv.y)), scale(f.south, wv.z));
    if (c.kind === "rocket") {
      c.q.copy(fq).multiply(v.q);
      c.throttle = 1;
      c.assist = true;
      c.assistMode = "orbit";
      v.phase = "space";
      c.camYaw = v.camYaw;
      c.camPitch = v.camPitch;
    }
    // (a save made out here: back where it was)
    const R = this.resume;
    if (R && c.kind !== "rocket" && performance.now() - R.at < 30000 && BODIES[R.ref]) {
      c.ref = R.ref;
      c.r = R.r.slice();
      c.vel = [0, 0, 0];
      c.speedLevel = R.speedLevel ?? c.speedLevel;
      c.warpFactor = R.warpFactor ?? c.warpFactor;
      c.camYaw = R.camYaw ?? c.camYaw;
      c.camPitch = R.camPitch ?? c.camPitch;
      c.frameQ.copy(frameQuat(localFrame(c.r)));
    }
    this.resume = null;
    this.craft = c;
    this._camQ = null;
    this._plan = null;
    // the craft's model into space's scene; nothing can harm it out here
    this.view.craft.add(v.root);
    v.root.position.set(0, 0, 0);
    v.root.visible = true;
    v._spaceDamage = v.damage;
    v.damage = () => false;
    this.active = true;
    this.warpIndex = 0;
    this.mapOpen = false;
    this.inp.dx = this.inp.dy = this.inp.wheel = 0;
    this.inp.pressed.clear();
    this.fov = this.game.camera?.fov || 70;
    this.stats.exits++;
    if (!this.target || this.target === body) this.target = body === "earth" ? "moon" : "earth";
    document.body?.classList.add("in-space");
    // (Round 16 follow-up) A UFO comes out at a fast cruise (the wheel still
    // sets it), and after J's jump from the ground the warp drive lights.
    if (c.kind === "warp") c.speedLevel = Math.max(c.speedLevel, 1.35);
    if (c.kind === "warp" && v.spaceJump) {
      v.spaceJump = false;
      this.toggleWarp();
    }
    this.space.caption("SPACE", "big", 2.5);
    this.space.caption(c.kind === "rocket" ? "R: assist · M: map · N: guides · T: target · , and . time warp" : c.kind === "warp" ? "J: warp drive · M: map · N: guides · T: target · , and . time warp" : "M: map · N: guides · T: target · , and . time warp · wheel: speed", "hint", 7);
    if (c.kind === "rocket") voice.say("rocket_space", { text: "We are in space" });
    this.ui?.show(true);
    return true;
  }

  // The world's sun direction (world axes).
  _worldSun() {
    const u = worldUniforms.uSunDir.value;
    return [u.x, u.y, u.z];
  }

  // ---------- Every frame ----------

  // dt: the game's step (real time); paused alone: drawn, not moved.
  update(dt, running) {
    if (!this.active) return;
    const c = this.craft;
    const inp = this.inp;
    if (running) {
      this._keys(inp);
      if (this.pending) this._waitLanding(dt);
      else if (c.kind === "rocket") this._rocket(dt, inp);
      else this._ufo(dt, inp);
    }
    if (!this.active) return;
    this._camera(dt);
    this._draw(dt);
    inp.dx = inp.dy = inp.wheel = 0;
    inp.pressed.clear();
  }

  _keys(inp) {
    const p = inp.pressed;
    if (p.has("KeyN")) {
      this.guides = !this.guides;
      this.space.caption(this.guides ? "Guides on" : "Guides off (N)", "hint", 1.5);
    }
    if (p.has("KeyM")) this.mapOpen = !this.mapOpen;
    if (p.has("KeyT")) this.cycleTarget(this.keys.has("ShiftLeft") || this.keys.has("ShiftRight") ? -1 : 1);
    if (p.has("Period")) this.setWarp(this.warpIndex + 1);
    if (p.has("Comma")) this.setWarp(this.warpIndex - 1);
    if (p.has("Slash")) this.setWarp(0);
    if (this.mapOpen && inp.wheel) {
      this.mapZoom = Math.max(0.02, Math.min(5000, this.mapZoom * (inp.wheel > 0 ? 1.25 : 0.8)));
      inp.wheel = 0;
    }
  }

  // The next body to aim for (dir: 1 the next, -1 the one before).
  cycleTarget(dir = 1) {
    const list = BODY_IDS.filter((id) => id !== "sun");
    const i = list.indexOf(this.target);
    this.target = list[(i + dir + list.length) % list.length];
    this.space.caption(`Target: ${BODIES[this.target].label}`, "hint", 1.5);
    this._plan = null;
    return this.target;
  }

  setWarp(i) {
    const c = this.craft;
    i = Math.max(0, Math.min(TIME_WARPS.length - 1, i));
    if (i > 0 && c?.warpOn) {
      this.space.caption("No time warp at warp speed", "hint", 1.5);
      i = 0;
    }
    if (i > 0 && c?.kind === "rocket" && c.throttle > 0.001) {
      this.space.caption("No time warp with the engine burning (X: cut the engine)", "hint", 2);
      i = 0;
    }
    const cap = this._warpCap();
    if (i > cap) {
      if (i > this.warpIndex) this.space.caption(`Too near ${BODIES[c.ref].name} for more time warp`, "hint", 1.5);
      i = cap;
    }
    if (i !== this.warpIndex) this.space.caption(`Time warp ${TIME_WARPS[i].toLocaleString("en-US")}x`, "stage", 1.2);
    this.warpIndex = i;
    this.stats.maxWarp = Math.max(this.stats.maxWarp, TIME_WARPS[i]);
  }

  // The highest time warp allowed just now: not at warp, not on thrust; near
  // a body, only as fast as keeps a few seconds before the entry altitude.
  _warpCap() {
    const c = this.craft;
    if (!c || c.warpOn) return 0;
    if (c.kind === "rocket" && c.throttle > 0.001) return 0;
    const B = BODIES[c.ref];
    const r = len(c.r);
    const alt = r - B.r;
    const floor = B.r * ((B.keepOut || 1) - 1) + (B.entry || 0);
    const room = Math.max(0, alt - floor);
    let closing;
    if (c.kind === "rocket") {
      const el = elements(c.r, c.vel, B.gm);
      // (a path that stays clear of the ground: orbits may be warped through)
      if (el.rp > B.r + floor * 1.05) return TIME_WARPS.length - 1;
      closing = Math.max(1, -dot(c.r, c.vel) / r);
    } else closing = Math.max(1, len(c.vel));
    const secs = room / closing; // (game seconds to the entry)
    let i = 0;
    while (i < TIME_WARPS.length - 1 && secs / TIME_WARPS[i + 1] > 6) i++;
    return i;
  }

  // ---------- The rocket ----------

  _rocket(dt, inp) {
    const c = this.craft;
    const v = c.v;
    const keys = this.keys;
    // the camera: the mouse turns it round the ship, the wheel zooms
    if (inp.dx || inp.dy) {
      c.camYaw -= inp.dx * 0.0035;
      c.camPitch = Math.max(-1.45, Math.min(1.45, c.camPitch - inp.dy * 0.0035));
    }
    if (inp.wheel) c.camDist = Math.max(8, Math.min(400, (c.camDist ?? this._rocketDist()) * (inp.wheel > 0 ? 1.12 : 0.89)));
    // throttle
    const p = inp.pressed;
    if (keys.has("Space")) c.throttle = Math.min(1, c.throttle + dt * 0.8);
    if (keys.has("ShiftLeft") || keys.has("ShiftRight")) c.throttle = Math.max(0, c.throttle - dt * 0.8);
    if (p.has("KeyZ")) c.throttle = 1;
    if (p.has("KeyX")) c.throttle = 0;
    if (c.throttle > 0.001 && this.warpIndex > 0) {
      this.warpIndex = 0;
      this.space.caption("Time warp off: engine burning", "hint", 1.5);
    }
    if (p.has("KeyR")) {
      c.assist = !c.assist;
      this._plan = null;
      this.space.caption(c.assist ? "Assist on: it points the nose (follow its cues)" : "Assist off", "hint", 2);
    }
    // attitude: W A S D tilt the nose the way the camera sees it, Q / E roll
    const fw = (keys.has("KeyW") ? 1 : 0) - (keys.has("KeyS") ? 1 : 0);
    const rt = (keys.has("KeyD") ? 1 : 0) - (keys.has("KeyA") ? 1 : 0);
    const roll = (keys.has("KeyE") ? 1 : 0) - (keys.has("KeyQ") ? 1 : 0);
    const manual = fw || rt || roll;
    if (manual && c.assist) {
      c.assist = false;
      this.space.caption("Assist off: manual (R: assist)", "hint", 2);
    }
    const rate = 0.9 * dt;
    const camQ = this._camQ || c.frameQ;
    if (fw) c.q.premultiply(_q.setFromAxisAngle(_v.copy(X).applyQuaternion(camQ), -fw * rate));
    if (rt) c.q.premultiply(_q.setFromAxisAngle(_v.copy(Z).applyQuaternion(camQ), -rt * rate));
    if (roll) c.q.premultiply(_q.setFromAxisAngle(_v.copy(Y).applyQuaternion(c.q), roll * rate));
    // the assist
    const plan = c.assist ? this._assist(dt) : this._idlePlan();
    c.plan = plan;
    if (c.assist && plan.dir) {
      const nose = _v.copy(Y).applyQuaternion(c.q);
      const want = toV(plan.dir, _v2).normalize();
      const ang = Math.acos(Math.max(-1, Math.min(1, nose.dot(want))));
      if (ang > 1e-4) {
        const axis = _v3.crossVectors(nose, want);
        if (axis.lengthSq() < 1e-12) axis.copy(X).applyQuaternion(c.q);
        c.q.premultiply(_q.setFromAxisAngle(axis.normalize(), Math.min(ang, 1.1 * dt)));
      }
      plan.aligned = ang < 0.12;
    }
    c.q.normalize();
    // the core stage falls away
    c.spaceT += dt;
    if (v.stack !== "ship" && c.spaceT > SEP_TIME) this._separate();
    // physics
    const thrust = v.stack === "ship" ? THRUST : CORE_THRUST;
    const nose = toA(_v.copy(Y).applyQuaternion(c.q));
    const acc = c.throttle > 0.001 ? scale(nose, thrust * c.throttle) : null;
    this._move(dt, acc);
    c.accel = acc;
    // the engine's look and sound
    v.time = (v.time || 0) + dt;
    const pw = c.throttle;
    v.power = { core: v.stack === "ship" ? 0 : pw, boost: 0, ship: v.stack === "ship" ? pw : 0 };
    v.throttle = pw;
    v.model.setStack(v.stack);
    v.model.setFlames(v.power, v.time, 1);
    v.model.setLegs(0);
    v.model.light.sky = 15;
    v.model.light.block = Math.round(12 * pw);
    v.sound?.set?.(pw, 0, true, 1);
  }

  _rocketDist() {
    return this.craft?.v?.stack === "ship" ? 26 : 50;
  }

  // The core stage away: it tumbles off, the ship's engine lights.
  _separate() {
    const c = this.craft;
    const v = c.v;
    v.stack = "ship";
    v.name = "Ship";
    v.model.setStack("ship");
    // (the ship's bottom was 25.4 up the stack: the craft is there now)
    const nose = _v.copy(Y).applyQuaternion(c.q);
    c.r = add(c.r, toA(_v2.copy(nose).multiplyScalar(25.4)));
    try {
      const core = createRocketModel({ standard: true });
      core.setStack("core");
      core.ship.visible = false;
      core.root.quaternion.copy(c.q);
      core.setFlames({ core: 0, boost: 0, ship: 0 }, 0, 1);
      const rel = _v3.copy(nose).multiplyScalar(-25.4);
      this.view.addDebris(core.root, rel, _v2.copy(nose).multiplyScalar(-4).add(new THREE.Vector3(1.2, 0.3, 0.8)), new THREE.Vector3(0.12, 0.05, 0.2));
    } catch (err) {
      console.warn("MINECLAUDE: the spent stage wasn't drawn", err);
    }
    this.space.caption("Stage separation", "stage", 2.5);
    voice.say("rocket_sep", { text: "Stage separation. Ship engine on" });
  }

  // ---------- The UFOs ----------

  _ufo(dt, inp) {
    const c = this.craft;
    const v = c.v;
    const keys = this.keys;
    const sens = 0.0022 * (this.vehicles.mouseSensitivity ?? 0.6);
    c.camYaw -= inp.dx * sens;
    c.camPitch = Math.max(-1.5, Math.min(1.5, c.camPitch - inp.dy * sens * (this.vehicles.invertY ? -1 : 1)));
    const p = inp.pressed;
    // the warp drive (the Warp Saucer)
    if (c.kind === "warp" && p.has("KeyJ")) this.toggleWarp();
    if (c.kind !== "warp" && p.has("KeyJ")) this.space.caption("The rocket has no warp drive: fly a UFO for that", "hint", 2.5);
    if (inp.wheel) {
      if (c.warpOn) {
        const i = WARP_FACTORS.indexOf(c.warpFactor);
        const j = Math.max(0, Math.min(WARP_FACTORS.length - 1, (i < 0 ? 3 : i) - Math.sign(inp.wheel)));
        c.warpFactor = WARP_FACTORS[j];
        this.space.caption(`Warp factor ${c.warpFactor.toLocaleString("en-US")}c`, "stage", 1);
      } else c.speedLevel = Math.max(0, Math.min(2, c.speedLevel - Math.sign(inp.wheel) * 0.05));
    }
    // (the frame the controls work in: up away from the body below, eased round)
    const want = frameQuat(localFrame(c.r), _q2);
    c.frameQ.slerp(want, Math.min(1, dt * 2.5));
    const view = this._viewDir(c, _v);
    const right = _v2.set(Math.cos(c.camYaw), 0, -Math.sin(c.camYaw)).applyQuaternion(c.frameQ);
    const up = _v3.copy(Y).applyQuaternion(c.frameQ);
    const move = new THREE.Vector3();
    if (keys.has("KeyW")) move.add(view);
    if (keys.has("KeyS")) move.sub(view);
    if (keys.has("KeyD")) move.add(right);
    if (keys.has("KeyA")) move.sub(right);
    if (keys.has("Space")) move.add(up);
    if (keys.has("ShiftLeft") || keys.has("ShiftRight")) move.sub(up);
    const boost = keys.has("ControlLeft") || keys.has("ControlRight") ? 3 : 1;
    let speed = this.cruise(c) * boost;
    // (slower near the ground: never more than this share of the way to it a second)
    const near = this._nearest(c);
    speed = Math.min(speed, Math.max(this._ufoTop() * 3, near.d * 0.8));
    c.topSpeed = speed;
    if (c.warpOn) {
      // at warp: along the view, the drive slowing by itself near a planet
      c.warpDir.lerp(view, Math.min(1, dt * 3)).normalize();
      // (Round 16 follow-up) It holds back only while heading toward the
      // nearest body: leaving a planet, the full warp at once.
      const me = this.absOf(c);
      const toB = norm(sub(absState(near.id, this.t), me));
      const toward = c.warpDir.x * toB[0] + c.warpDir.y * toB[1] + c.warpDir.z * toB[2];
      const cap = toward > 0.25 ? Math.max(0, near.dEff) * WARP_NEAR : Infinity;
      c.warpK = Math.min(1, c.warpK + dt / 1.2);
      const ramp = Math.pow(c.warpK, 2);
      const vw = Math.min(c.warpFactor * C_LIGHT, cap) * ramp + UFO_SPACE_TOP * (1 - ramp);
      c.vel = toA(_v3.copy(c.warpDir).multiplyScalar(vw));
      c.warpSpeed = vw;
      if (c.warpK > 0.9 && toward > 0.25 && vw < WARP_DROP) this.dropWarp(`Dropped out of warp: ${BODIES[near.id].name} ahead`);
    } else {
      c.warpK = Math.max(0, c.warpK - dt * 1.5);
      if (move.lengthSq() > 0) c.vel = toA(move.normalize().multiplyScalar(speed));
      else c.vel = [0, 0, 0];
    }
    this._move(dt, null, true);
    // the saucer turns to its heading and banks with its motion (in the frame)
    v.yaw += Math.atan2(Math.sin(c.camYaw - v.yaw), Math.cos(c.camYaw - v.yaw)) * Math.min(1, dt * 2);
    const lv = toV(c.vel, _v).applyQuaternion(_q.copy(c.frameQ).invert()).applyAxisAngle(Y, -v.yaw);
    const sp = Math.max(1, speed);
    v.tilt.x += (THREE.MathUtils.clamp(-lv.z / sp, -1, 1) * -0.18 - v.tilt.x) * Math.min(1, dt * 4);
    v.tilt.z += (THREE.MathUtils.clamp(-lv.x / sp, -1, 1) * 0.18 - v.tilt.z) * Math.min(1, dt * 4);
    v.time = (v.time || 0) + dt;
    v.camYaw = c.camYaw;
    v.camPitch = c.camPitch;
    try {
      v.model.body.rotation.set(v.tilt.x, v.yaw + (designFacingOffset(v.design) ?? 0), v.tilt.z, "YXZ");
      v.model.light.sky = 15;
      v.model.light.block = 0;
      v.model.animate(v.time, { night: 0, damage: 1 - v.health / v.maxHealth, beam: 0, speed: Math.min(len(c.vel), 300) });
      v.warpFx?.(dt, c.warpK, c.warpOn);
    } catch (err) {
      // (a model without these parts: still flown)
    }
  }

  // The UFO's cruise in space: the world's range, then on up to a fifth of
  // light's speed (the wheel's second half).
  cruise(c) {
    const cfg = c.v.cfg || { minSpeed: 2, maxSpeed: 300 };
    const lo = Math.max(0.5, cfg.minSpeed);
    const hi = Math.max(lo + 1, cfg.maxSpeed);
    const k = Math.min(1, c.speedLevel);
    const base = lo * Math.pow(hi / lo, k);
    return base * Math.pow(UFO_SPACE_TOP / hi, Math.max(0, c.speedLevel - 1));
  }

  _ufoTop() {
    const cfg = this.craft?.v?.cfg || { maxSpeed: 300 };
    return cfg.maxSpeed;
  }

  // The view direction (the frame's axes).
  _viewDir(c, out) {
    const cp = Math.cos(c.camPitch);
    return out.set(-Math.sin(c.camYaw) * cp, Math.sin(c.camPitch), -Math.cos(c.camYaw) * cp).applyQuaternion(c.frameQ);
  }

  toggleWarp() {
    const c = this.craft;
    if (!c || c.kind !== "warp") return false;
    if (c.warpOn) return this.dropWarp("Warp drive off");
    // (Round 16 follow-up: anywhere in space, even just over a planet; the
    // drive only holds back while it heads toward one)
    c.warpOn = true;
    c.warpK = 0;
    c.warpDir.copy(this._viewDir(c, _v));
    this.warpIndex = 0;
    this.stats.warps = (this.stats.warps || 0) + 1;
    this.space.caption(`WARP ${c.warpFactor.toLocaleString("en-US")}c`, "big", 1.6);
    this.space.caption("Mouse: steer · wheel: warp factor · J: drop out", "hint", 4);
    c.v.warpSound?.(true);
    return true;
  }

  dropWarp(text) {
    const c = this.craft;
    if (!c?.warpOn) return false;
    c.warpOn = false;
    // (sub-light again: the cruise the drive dropped to)
    c.speedLevel = Math.min(c.speedLevel, 1.6);
    if (text) this.space.caption(text, "stage", 2.5);
    c.v.warpSound?.(false);
    return true;
  }

  // The nearest ground: { id, d (to its surface), dc (to its middle), dEff (beyond 1.5 radii) }.
  _nearest(c) {
    const me = this.absOf(c);
    let best = null;
    for (const id of BODY_IDS) {
      const B = BODIES[id];
      const a = absState(id, this.t);
      const dc = Math.hypot(me[0] - a[0], me[1] - a[1], me[2] - a[2]);
      const d = dc - B.r;
      const dEff = dc - B.r * 1.5;
      if (!best || dEff < best.dEff) best = { id, d, dc, dEff };
    }
    // (d: to the nearest surface of any body, the one by the reference too)
    const B = BODIES[c.ref];
    best.d = Math.min(best.d, len(c.r) - B.r);
    return best;
  }

  // ---------- Motion: steps, spheres of influence, the ground ----------

  // Moves the craft dt (real) seconds, time-warped: thrust (acc, m/s^2,
  // the scene's axes) or a coast; arcade: the velocity is the pilot's.
  _move(dt, acc, arcade = false) {
    const c = this.craft;
    // (time warp: what the room near a body allows, now)
    const cap = this._warpCap();
    if (this.warpIndex > cap) {
      this.warpIndex = cap;
      this.space.caption(`Time warp ${TIME_WARPS[cap].toLocaleString("en-US")}x: nearing ${BODIES[c.ref].name}`, "hint", 2);
    }
    let left = dt * this.timeWarp;
    let guard = 0;
    while (left > 1e-9 && guard++ < 400) {
      const B = BODIES[c.ref];
      const r = len(c.r);
      const sp = Math.max(1, len(c.vel));
      let h;
      if (arcade) {
        // (no more than a tenth of the way to the nearest edge a step)
        h = Math.min(left, (0.1 * Math.max(1000, r - B.r)) / sp, 0.25 * dt * this.timeWarp + 1e-9);
        add(c.r, scale(c.vel, h), c.r);
      } else if (acc) {
        h = Math.min(left, 1 / 120);
        const g = scale(c.r, -B.gm / (r * r * r));
        const a = add(g, acc);
        add(c.vel, scale(a, h), c.vel);
        add(c.r, scale(c.vel, h), c.r);
      } else {
        h = Math.min(left, (0.15 * r) / sp, this._soiStep(c));
        // (not past the edge of this sphere, nor through the ground, in one step)
        if (B.soi < Infinity) h = Math.min(h, Math.max(1, (0.5 * (B.soi - r)) / sp));
        const vr = dot(c.r, c.vel) / r;
        if (vr < 0) h = Math.min(h, Math.max(0.05, (0.5 * (r - B.r - (B.entry || 0))) / -vr));
        kepler(c.r, c.vel, h, B.gm);
      }
      left -= h;
      this.t += h;
      this._soi(c);
      if (this._ground(c)) return;
    }
    if (left > 1e-9) this.t += left;
  }

  // (a coast's step: short enough not to jump over a child's sphere)
  _soiStep(c, t = this.t) {
    const B = BODIES[c.ref];
    const sp = Math.max(1, len(c.vel));
    let h = Infinity;
    for (const id of B.children) {
      const pos = localState(id, t);
      const d = Math.hypot(c.r[0] - pos[0], c.r[1] - pos[1], c.r[2] - pos[2]) - BODIES[id].soi;
      h = Math.min(h, Math.max(1, (0.5 * Math.max(d, BODIES[id].soi * 0.05)) / sp));
    }
    return h;
  }

  // Into a child's sphere of influence, or out of this one into the parent's.
  // (quiet: a prediction's, no captions)
  _soi(c, t = this.t, quiet = false) {
    const B = BODIES[c.ref];
    if (B.parent && len(c.r) > B.soi) {
      const p = [0, 0, 0];
      const vv = [0, 0, 0];
      localState(c.ref, t, p, vv);
      add(c.r, p, c.r);
      if (c.kind === "rocket") add(c.vel, vv, c.vel);
      const from = c.ref;
      c.ref = B.parent;
      if (quiet) return;
      this._plan = null;
      this.space.caption(`Leaving ${BODIES[from].name}'s pull`, "hint", 2);
      return;
    }
    for (const id of B.children) {
      const p = [0, 0, 0];
      const vv = [0, 0, 0];
      localState(id, t, p, vv);
      if (Math.hypot(c.r[0] - p[0], c.r[1] - p[1], c.r[2] - p[2]) < BODIES[id].soi) {
        sub(c.r, p, c.r);
        if (c.kind === "rocket") sub(c.vel, vv, c.vel);
        c.ref = id;
        if (quiet) return;
        this._plan = null;
        this.space.caption(`Near ${BODIES[id].name}`, "stage", 2.5);
        return;
      }
    }
  }

  // Down past the entry altitude: a landing (or turned away). True if the craft stops here.
  _ground(c) {
    const B = BODIES[c.ref];
    const r = len(c.r);
    const alt = r - B.r;
    if (B.dim && alt < B.entry) {
      this.land(B.id);
      return true;
    }
    const keep = B.r * ((B.keepOut || 1) - 1) + (B.dim ? 0 : 4000);
    if (!B.dim && alt < keep) {
      // (no ground here: turned back up)
      const up = norm(c.r);
      c.r = scale(up, B.r + keep + 1);
      const vr = dot(c.vel, up);
      if (vr < 0) c.vel = sub(c.vel, scale(up, vr * 1.5));
      if (this.warpIndex) this.warpIndex = 0;
      if (c.warpOn) this.dropWarp();
      const now = performance.now();
      if (now - (this._turnedT || 0) > 3000) {
        this._turnedT = now;
        this.space.caption(B.star ? "Too hot! The Sun's heat pushes you back" : B.gas ? `${B.name} is a ball of gas: no ground to land on` : `No landing on ${B.name}`, "hint", 3);
      }
    }
    return false;
  }

  // ---------- Down to a planet ----------

  // The craft goes down into body's world: the same craft, made again there.
  land(bodyId) {
    const c = this.craft;
    const B = BODIES[bodyId];
    const spin = this.spins[bodyId] ?? (this.spins[bodyId] = 0);
    const up = norm(c.r);
    const ub = spinVec(up, -spin);
    const lat = Math.asin(Math.max(-1, Math.min(1, ub[1])));
    const lon = Math.atan2(ub[0], ub[2]);
    const { x, z } = latLonToWorld(bodyId, lat, lon);
    const alt = Math.min(B.entry - 20, Math.max(B.entry * 0.5, len(c.r) - B.r));
    const y = BASE_Y + alt;
    const f = localFrame(c.r);
    let wv = [dot(c.vel, f.east), dot(c.vel, f.up), dot(c.vel, f.south)];
    const top = ENTRY_SPEED[bodyId] || 300;
    if (len(wv) > top) wv = scale(wv, top / len(wv));
    // (the camera's turn, in the world's axes there)
    // (a UFO's view as yaw and pitch there; the rocket's camera keeps its own angles)
    const fq = frameQuat(f);
    const camQ = (this._camQ || c.frameQ).clone();
    const local = _q.copy(fq).invert().multiply(camQ);
    const e = new THREE.Euler().setFromQuaternion(local, "YXZ");
    const rocket = c.kind === "rocket";
    this.warpIndex = 0;
    if (c.warpOn) this.dropWarp();
    this.pending = { body: bodyId, dim: B.dim, x, y, z, vel: wv, yaw: rocket ? c.camYaw : e.y, pitch: rocket ? c.camPitch : e.x, started: performance.now(), travelled: false };
    this.stats.entries++;
    this.space.caption(`Entering ${B.name}'s ${B.atmo ? "atmosphere" : "approach"}`, "stage", 2.5);
    const vm = this.vehicles;
    const v = c.v;
    // (straight back into the same world: no travel needed when the dimensions are off)
    if (!this.dims?.enabled) {
      if (B.dim !== (this.world.dim || "overworld")) {
        this.pending = null;
        this.space.caption(`No way down to ${B.name} in this world: it has no other dimensions`, "hint", 3);
        c.r = scale(up, B.r + B.entry + 400);
        c.vel = scale(up, 50);
        return false;
      }
      this._arrive(true);
      return true;
    }
    // The craft out of the world it left (still drawn up here), the player
    // to the planet's dimension: the ground there loads meanwhile.
    if (vm.active === v) vm.exit({ force: true });
    const i = vm.vehicles.indexOf(v);
    if (i >= 0) {
      vm.vehicles.splice(i, 1);
      vm.onRemoved?.(v);
    }
    const j = vm.elsewhere.indexOf(v);
    if (j >= 0) vm.elsewhere.splice(j, 1);
    this.pending.detached = true;
    const fromDim = this.world.dim || "overworld";
    const p = this.player;
    const ok = this.dims.travel(B.dim, x, y, z, { place: "exact", from: { dim: fromDim, x: Math.floor(p.position.x), y: p.position.y, z: Math.floor(p.position.z) } });
    if (!ok) {
      // (refused: back where it left, the same world)
      console.warn("MINECLAUDE: the landing's travel was refused");
      this.pending.dim = fromDim;
      this._arrive(true, true);
      return false;
    }
    this.pending.travelled = true;
    this._hideLoading();
    this._mouseWhileLoading(true);
    return true;
  }

  _hideLoading() {
    const el = typeof document !== "undefined" ? document.getElementById("dim-loading") : null;
    if (el && el.style.display !== "none") el.style.display = "none";
  }

  // (no vehicle while the ground loads: the mouse still turns the view)
  _mouseWhileLoading(on) {
    const p = this.player;
    if (on) p.mouseCapture = (e) => {
      this.inp.dx += e.movementX;
      this.inp.dy += e.movementY;
    };
    else if (!this.vehicles.active) p.mouseCapture = null;
  }

  _waitLanding(dt) {
    this._hideLoading();
    const c = this.craft;
    // (the ship holds, turning the camera only)
    const sens = 0.0022 * (this.vehicles.mouseSensitivity ?? 0.6);
    c.camYaw -= this.inp.dx * sens;
    c.camPitch = Math.max(-1.45, Math.min(1.45, c.camPitch - this.inp.dy * sens));
    if (this.dims?.pending && performance.now() - this.pending.started < 20000) return;
    this._arrive(false);
  }

  // The world has its ground: the craft made again there, the player aboard.
  _arrive(direct, refused = false) {
    const pd = this.pending;
    const c = this.craft;
    const old = c.v;
    const vm = this.vehicles;
    this.pending = null;
    this.view.craft.remove(old.root);
    if (old._spaceDamage) {
      old.damage = old._spaceDamage;
      delete old._spaceDamage;
    }
    const pos = refused ? c.exit.slice() : [pd.x, pd.y, pd.z];
    if (refused) pos[1] = Math.min(pos[1], spaceLineY(pd.dim) - 200);
    let v = null;
    if (direct && !pd.detached) {
      // (the same vehicle, moved: it never left the world)
      v = old;
      vm.scene.add(v.root);
      v.pos.fromArray(pos);
      v.vel.fromArray(pd.vel);
    } else {
      old.dispose?.();
      if (c.kind === "rocket") {
        v = vm.create("rocket", { stack: "ship", phase: "descent", pos, vel: pd.vel, yaw: 0, health: old.health, summoned: true });
      } else {
        const data = { ...old.serialize(), pos, dim: undefined, crashed: false };
        delete data.dim;
        v = vm.create("ufo", { ...data, summoned: !!old.summoned });
      }
      if (v) {
        v.keep = true;
        v.calledIn = old.calledIn;
      }
    }
    if (v && c.kind === "rocket") {
      v.phase = "descent";
      v.stack = "ship";
      v.name = "Ship";
      v.model.setStack("ship");
      v.autopilot = true;
      v.target = null;
      v.vel.fromArray(pd.vel);
      v.root.visible = true;
    }
    if (v && c.kind !== "rocket") {
      v.speedLevel = Math.min(1, c.speedLevel);
      v.yaw = pd.yaw;
    }
    this._end();
    if (v) {
      v._place?.();
      if (vm.active !== v) vm.enter(v);
      v.camYaw = pd.yaw;
      v.camPitch = Math.max(-1.4, Math.min(1.1, pd.pitch));
      if (c.kind === "rocket") v._camManual = true;
    }
    const B = BODIES[pd.body];
    this.stats.lastEntry = { body: pd.body, dim: this.world.dim, x: pd.x, z: pd.z };
    if (!refused) {
      this.space.caption(pd.body === "earth" ? "Welcome back to Earth" : `${B.name}`, "big", 3);
      this.space.caption(c.kind === "rocket" ? "The autopilot is landing it (or take over: Space/Shift throttle, W A S D tilt; R: autopilot)" : "Fly down and land anywhere", "hint", 6);
    }
    return v;
  }

  // Out of space (landed, or called off): the world drawn again.
  _end() {
    const c = this.craft;
    this.active = false;
    this.craft = null;
    this.pending = null;
    this.mapOpen = false;
    this.warpIndex = 0;
    this.view.clearDebris();
    if (c?.v?.sound) c.v.sound.set?.(0);
    c?.v?.warpSound?.(false);
    this._mouseWhileLoading(false);
    document.body?.classList.remove("in-space");
    this.ui?.show(false);
  }

  // (Round 16 follow-up) Creative's call-in in space: the craft swapped for a
  // new UFO right here, at once (make: () => the new vehicle, in the world).
  swapCraft(make) {
    const c = this.craft;
    if (!this.active || !c || this.pending) return null;
    const vm = this.vehicles;
    const old = c.v;
    if (c.warpOn) this.dropWarp(null);
    this.view.craft.remove(old.root);
    if (old._spaceDamage) {
      old.damage = old._spaceDamage;
      delete old._spaceDamage;
    }
    old.occupied = false;
    if (vm.active === old) vm.active = null;
    this.player.vehicle = null;
    try {
      old.onExit?.();
    } catch {}
    vm.remove(old);
    const nv = make([c.exit[0], Math.min(c.exit[1], spaceLineY(c.fromDim) - 100), c.exit[2]]);
    if (!nv) return null;
    vm.enter(nv);
    this.view.craft.add(nv.root);
    nv.root.position.set(0, 0, 0);
    nv.root.visible = true;
    nv._spaceDamage = nv.damage;
    nv.damage = () => false;
    nv.camYaw = c.camYaw;
    nv.camPitch = c.camPitch;
    c.v = nv;
    c.kind = nv.type === "rocket" ? "rocket" : "warp";
    c.throttle = 1;
    c.assist = false;
    c.speedLevel = Math.max(nv.speedLevel ?? 0.5, 1.35);
    c.vel = [0, 0, 0];
    this.warpIndex = 0;
    this.space.caption("J: warp drive (faster than light) · wheel: speed · N: guides · T: target · M: map", "hint", 6);
    return nv;
  }

  // Back to the world at once (a mode change, death, a reload): the craft
  // where it left the world, a little under the line.
  abort() {
    if (!this.active) return;
    const c = this.craft;
    const v = c.v;
    if (this.pending?.detached) {
      // (already out of the world it left: the travel goes on; the craft is lost)
      this.view.craft.remove(v.root);
      v.dispose?.();
      this._end();
      return;
    }
    this.view.craft.remove(v.root);
    this.vehicles.scene.add(v.root);
    if (v._spaceDamage) {
      v.damage = v._spaceDamage;
      delete v._spaceDamage;
    }
    v.pos.set(c.exit[0], Math.min(c.exit[1], spaceLineY(c.fromDim) - 300), c.exit[2]);
    v.vel.set(0, 0, 0);
    if (v.type === "rocket") {
      v.phase = "descent";
      v.stack = "ship";
      v.model.setStack("ship");
      v.autopilot = true;
    }
    v._place?.();
    this._end();
  }

  // Turns the view (a UFO) or the nose (the rocket) toward a body (the tests).
  aimAt(id) {
    const c = this.craft;
    if (!c || !BODIES[id]) return false;
    const me = this.absOf(c);
    const a = absState(id, this.t);
    const d = toV(norm(sub(a, me)), new THREE.Vector3());
    if (c.kind === "rocket") {
      c.q.setFromUnitVectors(Y, d);
      return true;
    }
    c.frameQ.copy(frameQuat(localFrame(c.r)));
    d.applyQuaternion(_q.copy(c.frameQ).invert());
    c.camYaw = Math.atan2(-d.x, -d.z);
    c.camPitch = Math.asin(Math.max(-1, Math.min(1, d.y)));
    if (c.warpOn) c.warpDir.copy(this._viewDir(c, _v));
    return true;
  }

  // ---------- Positions ----------

  // The craft's position relative to the Sun (doubles).
  absOf(c = this.craft) {
    return add(absState(c.ref, this.t), c.r);
  }

  // ---------- The assist (the rocket) ----------

  // { mode, dir (where to point), cue ("burn" | "cut" | "wait" | null), text, dv, eta }
  _idlePlan() {
    return { mode: "off", dir: null, cue: null, text: "", dv: 0 };
  }

  _assist(dt) {
    const c = this.craft;
    const B = BODIES[c.ref];
    const r = len(c.r);
    const alt = r - B.r;
    const el = elements(c.r, c.vel, B.gm);
    const up = norm(c.r);
    const vr = dot(c.vel, up);
    const T = this.target;
    // into orbit: just off the ground, the path still coming down into it
    const low = el.rp < B.r + (B.entry || 0) * 1.25 + (B.dim ? 0 : B.r * 0.1);
    if (c.assistMode === "orbit" && !low) {
      c.assistMode = null;
      this.space.caption("ORBIT", "big", 2.5);
      this.space.caption(`In orbit round ${B.name}. Pick a target (T) and follow the assist's cues`, "hint", 5);
      voice.say("rocket_orbit", { text: "Orbit achieved" });
      c.throttle = 0;
    }
    if (c.assistMode === "orbit" || (low && vr > -5 && (T === c.ref || !T) && alt < (B.line || 6000) * 4)) {
      c.assistMode = "orbit";
      // (along the ground, the way it is already going, a little up while low)
      let h = sub(c.vel, scale(up, vr));
      if (len(h) < 30) h = localFrame(c.r).east;
      const pitch = alt < (B.entry || 0) * 1.4 ? 0.25 : 0.05;
      const dir = norm(add(norm(h), scale(up, Math.tan(pitch))));
      return { mode: "orbit", dir, cue: "burn", text: `Into orbit: burn until the low point is clear of ${B.name}`, dv: Math.sqrt(B.gm / r) - len(sub(c.vel, scale(up, vr))) };
    }
    if (!T || (T === c.ref && !B.dim)) return { mode: "idle", dir: null, cue: null, text: "Pick a target with T", dv: 0 };
    if (T === c.ref) return this._landPlan(c, B, el, alt, up);
    // a transfer: re-planned twice a second
    this._planT = (this._planT || 0) - dt;
    if (!this._plan || this._planT <= 0 || this._plan.ref !== c.ref || this._plan.target !== T) {
      this._planT = 0.5;
      this._plan = this._transfer(c, T);
    }
    const P = this._plan;
    if (!P || !P.dv) return { mode: "transfer", dir: null, cue: null, text: P?.text || `No way to ${BODIES[T].name} worked out from here`, dv: 0 };
    const dvn = len(P.dv);
    // (burning: what is left of the burn, from the velocity now)
    const left = P.vNeed ? len(sub(P.vNeed, c.vel)) : dvn;
    if (left < 2.5) return { mode: "transfer", dir: norm(c.vel), cue: "cut", text: `On the way to ${BODIES[P.toward].name}: cut the engine, then time warp (.)${P.eta ? `. Arrival in ${fmtT(P.eta)}` : ""}`, dv: left, eta: P.eta };
    const dir = P.vNeed ? norm(sub(P.vNeed, c.vel)) : norm(P.dv);
    return { mode: "transfer", dir, cue: "burn", text: `${P.label}: point along the marker and burn ${Math.round(left).toLocaleString("en-US")} m/s`, dv: left, eta: P.eta };
  }

  // Coming down onto the body the ship is round: retrograde, and the burn's cue.
  _landPlan(c, B, el, alt, up) {
    const sp = len(c.vel);
    const dir = sp > 1 ? scale(c.vel, -1 / sp) : up;
    if (el.rp > B.r + B.entry * 0.8) {
      // (not coming down yet: slow down until the path meets the ground)
      return { mode: "land", dir, cue: "burn", text: `To land on ${B.name}: burn backward until the path comes down`, dv: sp };
    }
    const g = B.gm / ((B.r + alt) * (B.r + alt));
    const stop = Math.max(0, sp * sp - (ENTRY_SPEED[B.id] || 250) ** 2) / (2 * Math.max(1, THRUST - g));
    const down = Math.max(0.1, -dot(norm(c.vel), up));
    const room = (alt - B.entry) / down;
    if (sp <= (ENTRY_SPEED[B.id] || 250)) return { mode: "land", dir, cue: "cut", text: `Slow enough: let it fall to ${B.name}`, dv: 0 };
    return { mode: "land", dir, cue: stop > room * 0.8 ? "burn" : "wait", text: stop > room * 0.8 ? "BURN to slow down for the landing" : `Landing burn in ${fmtT(Math.max(0, (room - stop / 0.8) / Math.max(1, sp)))}`, dv: sp };
  }

  // A transfer toward T from where the ship is: { dv, vNeed, eta, label, toward }.
  _transfer(c, T) {
    const ref = c.ref;
    const B = BODIES[ref];
    const TB = BODIES[T];
    const step = this._towards(ref, T);
    if (!step) return null;
    const { kind, toward } = step;
    const now = this.t;
    if (kind === "child") {
      // Lambert in this body's frame, to where the child will be.
      const C = BODIES[toward];
      const best = this._lambertBest(c.r, c.vel, B.gm, (tof) => localState(toward, now + tof), hohmann(len(c.r), C.a, B.gm), B.r + (B.entry || 0) * 1.1);
      if (!best) return { text: `No transfer to ${C.name} from here: try again a little later` };
      return { dv: sub(best.v1, c.vel), vNeed: best.v1, eta: best.tof, label: `Transfer to ${C.name}`, toward, ref, target: T };
    }
    if (kind === "parent") {
      // (back down to the body this one goes round: lose the orbit's speed round it)
      const P = BODIES[B.parent];
      const p = [0, 0, 0];
      const vv = [0, 0, 0];
      localState(ref, now, p, vv);
      const rP = add(c.r, p);
      const vP = add(c.vel, vv);
      const inward = scale(norm(rP), -Math.sqrt(P.gm / len(rP)) * 0.15);
      const vNeedP = inward;
      const vNeed = sub(vNeedP, vv);
      return { dv: sub(vNeed, c.vel), vNeed, eta: Math.sqrt((len(rP) ** 3) / (2 * P.gm)) * 1.1, label: `Back to ${P.name}`, toward: P.id, ref, target: T };
    }
    if (kind === "sibling") {
      // Leaving a planet for another round the same star: the speed out of
      // its pull that a Lambert transfer between the two wants, then a path
      // out of this planet's pull along it.
      const C = BODIES[B.parent];
      const D = BODIES[toward];
      const rRef = localState(ref, now);
      const vRef = [0, 0, 0];
      localState(ref, now, [0, 0, 0], vRef);
      const best = this._lambertBest(rRef, vRef, C.gm, (tof) => localState(toward, now + tof), hohmann(len(rRef), D.a, C.gm), C.r * 2);
      if (!best) return { text: `No transfer to ${D.name} worked out` };
      const vInf = sub(best.v1, vRef);
      const vi = len(vInf);
      const far = B.soi * 1.6;
      const aim = scale(norm(vInf), far);
      const tofE = far / Math.max(vi, 1) + Math.sqrt((len(c.r) ** 3) / B.gm) * 0.8;
      const L = lambert(c.r, aim, tofE, B.gm);
      if (!L) return { text: `No way out of ${B.name}'s pull toward ${D.name} from here: in a little while` };
      return { dv: sub(L.v1, c.vel), vNeed: L.v1, eta: tofE + best.tof, label: `Transfer to ${D.name}`, toward, ref, target: T };
    }
    if (kind === "direct") {
      // round the Sun already: Lambert straight to the planet
      const D = BODIES[toward];
      const best = this._lambertBest(c.r, c.vel, B.gm, (tof) => localState(toward, now + tof), hohmann(len(c.r), D.a, B.gm), B.r * 2);
      if (!best) return { text: `No path to ${D.name} worked out` };
      return { dv: sub(best.v1, c.vel), vNeed: best.v1, eta: best.tof, label: `Course to ${D.name}`, toward, ref, target: T };
    }
    return { text: `Head for ${TB.name}` };
  }

  // What leg comes next on the way from ref to T.
  _towards(ref, T) {
    const B = BODIES[ref];
    const TB = BODIES[T];
    if (TB.parent === ref) return { kind: "child", toward: T };
    if (B.parent === T) return { kind: "parent", toward: T };
    if (B.parent && TB.parent === B.parent) return B.parent === "sun" ? { kind: "sibling", toward: T } : { kind: "parent", toward: B.parent };
    if (ref === "sun") return TB.parent === "sun" ? { kind: "direct", toward: T } : this._towards(ref, TB.parent);
    // (a moon of another planet: that planet first; from a moon: its planet first)
    if (TB.parent && TB.parent !== "sun") return this._towards(ref, TB.parent);
    if (B.parent && B.parent !== "sun") return { kind: "parent", toward: B.parent };
    return null;
  }

  // The cheapest Lambert transfer from (r, v) to where(tof), over a spread
  // of flight times round the guess; its path must keep above minR.
  _lambertBest(r, v, mu, where, guess, minR) {
    let best = null;
    const tries = [];
    for (let k = 0.35; k <= 2.01; k += 0.08) tries.push(guess * k);
    const test = (tof) => {
      const r2 = where(tof);
      const L = lambert(r, r2, tof, mu);
      if (!L) return null;
      const el = elements(r, L.v1, mu);
      // (a path that dips into the ground on the way: no good, unless it's arriving there anyway)
      const dipping = el.rp < minR && dot(r, L.v1) < 0;
      if (dipping) return null;
      return { ...L, tof, cost: len(sub(L.v1, v)) };
    };
    for (const tof of tries) {
      const s = test(tof);
      if (s && (!best || s.cost < best.cost)) best = s;
    }
    if (!best) return null;
    // (refined round the best)
    let span = guess * 0.08;
    for (let i = 0; i < 12; i++) {
      for (const tof of [best.tof - span, best.tof + span]) {
        if (tof <= 1) continue;
        const s = test(tof);
        if (s && s.cost < best.cost) best = s;
      }
      span *= 0.6;
    }
    return best;
  }

  // ---------- The camera ----------

  _camera(dt) {
    const c = this.craft;
    const v = c.v;
    const cam = _camScratch;
    if (c.kind === "rocket") {
      // round the ship, as in the world, the frame's "up" away from the body below
      const want = frameQuat(localFrame(c.r), _q2);
      c.frameQ.slerp(want, Math.min(1, dt * 2));
      const height = v.stack === "ship" ? 15.2 : 41.5;
      const mid = _v.copy(Y).applyQuaternion(c.q).multiplyScalar(height * 0.55);
      const dist = c.camDist ?? this._rocketDist();
      const cp = Math.cos(c.camPitch);
      const off = _v2.set(Math.sin(c.camYaw) * cp, -Math.sin(c.camPitch), Math.cos(c.camYaw) * cp).multiplyScalar(dist).applyQuaternion(c.frameQ);
      cam.position.copy(mid).add(off);
      cam.up.copy(Y).applyQuaternion(c.frameQ);
      cam.lookAt(mid);
      v.root.quaternion.copy(c.q);
      v.root.position.set(0, 0, 0);
    } else {
      // the UFO's own chase camera, worked out in its world, turned into space
      v.camYaw = c.camYaw;
      v.camPitch = c.camPitch;
      const pos = v.pos.clone();
      v.updateCamera(cam, dt);
      const off = cam.position.sub(pos);
      off.applyQuaternion(c.frameQ);
      cam.quaternion.premultiply(c.frameQ);
      cam.position.copy(off);
      v.root.quaternion.copy(c.frameQ);
      v.root.position.set(0, 0, 0);
    }
    c.camOff.copy(cam.position);
    this._camQ = cam.quaternion.clone();
  }

  // ---------- Drawing ----------

  _draw(dt) {
    const c = this.craft;
    const t = this.t;
    const cache = {};
    const abs = (id) => cache[id] || (cache[id] = absState(id, t));
    const me = this.absOf(c);
    const camAbs = [me[0] + c.camOff.x, me[1] + c.camOff.y, me[2] + c.camOff.z];
    const w = window.innerWidth || 960;
    const h = window.innerHeight || 540;
    // the entry's glow: fast and low over a planet with air
    const B = BODIES[c.ref];
    let entryK = 0;
    const sp = len(c.vel);
    if (B.atmo && B.dim && c.kind === "rocket") {
      const alt = len(c.r) - B.r;
      entryK = smooth(B.entry * 3, B.entry * 1.1, alt) * smooth(500, 1400, sp) * Math.max(0, -dot(norm(c.vel), norm(c.r)));
    }
    const fov = this.fov + (c.warpK || 0) * 18;
    this.view.update(
      {
        camAbs,
        camQuat: this._camQ,
        fov,
        aspect: w / h,
        height: h,
        abs,
        craftOffset: c.camOff,
        warpK: c.warpOn ? c.warpK : c.warpK * 0.5,
        warpDir: c.warpDir,
        entryK,
        entryDir: toV(c.vel, new THREE.Vector3()).normalize(),
        entrySize: c.kind === "rocket" ? 6 : (c.v.radius || 5) * 1.2,
        shipAccel: c.accel ? toV(c.accel, new THREE.Vector3()) : null,
      },
      dt
    );
    this.ui?.update(dt);
  }

  render(renderer, postfx) {
    return this.view.render(renderer, postfx);
  }

  // ---------- The path ahead (the map) ----------

  // Where the ship will be, n points ahead: [{ t, abs }]. A rocket's coast
  // (patched conics: into and out of the spheres of influence; up to one
  // turn of an orbit, or the trip out of this sphere and some way on); a
  // UFO's straight line at its speed.
  predict(c = this.craft, n = 300) {
    if (!c) return [];
    const out = [];
    let t = this.t;
    if (c.kind !== "rocket") {
      const sp = len(c.vel);
      if (sp < 1) return [];
      const span = Math.max(60, (len(c.r) * 0.5) / sp);
      for (let i = 0; i <= 20; i++) {
        const tt = t + (span * i) / 20;
        out.push({ t: tt, abs: add(absState(c.ref, tt), add(c.r, scale(c.vel, tt - t))) });
      }
      return out;
    }
    const s = { kind: "rocket", ref: c.ref, r: c.r.slice(), vel: c.vel.slice() };
    const el = elements(s.r, s.vel, BODIES[s.ref].gm);
    const horizon = el.e < 1 ? Math.min(el.period * 1.02, 4e7) : 3e7;
    const end = t + horizon;
    for (let i = 0; i < n && t < end; i++) {
      out.push({ t, abs: add(absState(s.ref, t), s.r) });
      const B = BODIES[s.ref];
      const r = len(s.r);
      if (r - B.r < (B.entry || 0)) break;
      let h = Math.min(end - t, (0.08 * r) / Math.max(1, len(s.vel)), this._soiStep(s, t));
      if (B.soi < Infinity) h = Math.min(h, Math.max(1, (0.5 * (B.soi - r)) / Math.max(1, len(s.vel))));
      h = Math.max(h, horizon / (n * 4));
      kepler(s.r, s.vel, h, B.gm);
      t += h;
      this._soi(s, t, true);
    }
    return out;
  }

  // ---------- Saving ----------

  serialize() {
    const out = { t: Math.round(this.t), spins: { ...this.spins }, guides: this.guides, target: this.target };
    const c = this.craft;
    if (this.active && c && c.kind !== "rocket" && !this.pending) out.resume = { ref: c.ref, r: c.r.map((x) => Math.round(x)), speedLevel: c.speedLevel, warpFactor: c.warpFactor, camYaw: c.camYaw, camPitch: c.camPitch };
    return out;
  }

  init(s) {
    if (!s || typeof s !== "object") return;
    if (Number.isFinite(s.t)) this.t = s.t;
    if (s.spins && typeof s.spins === "object") for (const [k, a] of Object.entries(s.spins)) if (BODIES[k] && Number.isFinite(a)) this.spins[k] = a;
    if (typeof s.guides === "boolean") this.guides = s.guides;
    if (BODIES[s.target]) this.target = s.target;
    const R = s.resume;
    if (R && BODIES[R.ref] && Array.isArray(R.r) && R.r.length === 3 && R.r.every(Number.isFinite)) this.resume = { ...R, at: performance.now() };
  }
}

const _camScratch = new THREE.PerspectiveCamera(70, 1, 0.1, 1000);
_camScratch.rotation.order = "YXZ";

// The Hohmann half-orbit's time between radii r1 and r2 round mu.
function hohmann(r1, r2, mu) {
  const a = (r1 + r2) / 2;
  return Math.PI * Math.sqrt((a * a * a) / mu);
}

function fmtT(s) {
  if (s < 60) return `${Math.round(s)} s`;
  if (s < 3600) return `${Math.round(s / 60)} min`;
  if (s < 172800) return `${(s / 3600).toFixed(1)} h`;
  return `${(s / 86400).toFixed(1)} days`;
}

