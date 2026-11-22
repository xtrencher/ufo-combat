// (Round 22) What the new aircraft do beyond the jet's own flight model
// (js/vehicle-jet.js calls these; the numbers are js/plane-specs.js's):
//   - the F-14's wing sweep (with the Mach number, or V: forward / back):
//     wings forward fly slower and turn tighter, swept they go fastest;
//   - the F-35B's hover (V): the nozzle swivels down and the lift fan's
//     doors open; Space / Shift climb and sink, W / S and Q / E move it, the
//     mouse turns it and lifts its nose a little; it lands and takes off
//     straight up; back to wing-borne flight (V) the lift fan carries it
//     until the wings do;
//   - the AC-130's orbit (V): it circles the point in the crosshair (or the
//     locked target) on its own, banked, and the view is the gunner's,
//     looking down at it out of the left side: the mouse aims the guns;
//   - the guns: the A-10's GAU-8, the P-51's six .50s, the AC-130's 25 mm
//     gatling out of the left side; the AC-130's 40 mm and 105 mm;
//   - rockets and free-fall bombs (the HUD's pipper shows where a bomb
//     would land), in the jet's `missiles` list as `ballistic` (online they
//     go out as projectiles: net/fx.js `netKind`).
import * as THREE from "three";
import { HOVER, SWEEP, ORBIT, ROCKETS, BOMBS, SIDE_GUNS, PLANE_GUNS, P51_BOMB, HVAR } from "./plane-specs.js";
import { effectsQuality } from "./effects.js";
import { IS_WET } from "./blocks.js";
import { MACH1 } from "./air-fx.js";

export const OWN_WEAPONS = new Set(["rockets", "bombs", "gun40", "gun105"]);
export const WEAPON_LABELS = { rockets: "ROCKETS", bombs: "BOMBS", gun40: "40 MM GUN", gun105: "105 MM HOWITZER" };
const BOMB_G = 20; // (the nukes' too)

const _v = new THREE.Vector3();
const _w = new THREE.Vector3();
const _u = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const Y = new THREE.Vector3(0, 1, 0);
const NO_KEYS = new Set();

function clamp(v, a, b) {
  return v < a ? a : v > b ? b : v;
}

// ---------- Setup, saving ----------

export function initPlane(jet, data = {}) {
  const sp = jet.spec;
  const pf = data && typeof data.pf === "object" && data.pf ? data.pf : {};
  const int = (v, max) => (Number.isFinite(v) ? clamp(Math.round(v), 0, max) : max);
  jet.bombsMax = sp.bombs || 0;
  jet.bombsLeft = int(pf.b, jet.bombsMax);
  jet.rocketsMax = sp.rockets || 0;
  jet.rocketsLeft = int(pf.r, jet.rocketsMax);
  jet.ownT = 0; // the selected weapon's next shot (s)
  jet.storeT = 0; // the bombs' and rockets' rearm (s)
  jet.stallMul = 1;
  jet.dragMul = 1;
  jet.turnMul = 1;
  jet.vtolLift = 0;
  if (sp.sweep) {
    jet.sweepMode = ["auto", "fwd", "back"].includes(pf.sw) ? pf.sw : "auto";
    jet.sweep = data.airborne ? SWEEP.fwd : SWEEP.parked;
  }
  if (sp.hover) {
    jet.hoverOn = !!pf.h;
    jet.nozzle = jet.hoverOn ? 1 : 0;
    jet.hoverYaw = 0;
    jet.hoverPitch = 0;
  }
  if (sp.orbit) {
    jet.orbit = null;
    jet.gunYaw = 0;
    jet.gunPitch = 0;
  }
}

export function savePlane(jet) {
  const out = {};
  if (jet.bombsMax) out.b = jet.bombsLeft;
  if (jet.rocketsMax) out.r = jet.rocketsLeft;
  if (jet.spec.sweep) out.sw = jet.sweepMode;
  if (jet.spec.hover && jet.hoverOn) out.h = 1;
  return Object.keys(out).length ? out : undefined;
}

// (Hacks' "No reload") Everything aboard again.
export function refill(jet) {
  jet.bombsLeft = jet.bombsMax;
  jet.rocketsLeft = jet.rocketsMax;
  jet.ownT = Math.min(jet.ownT, 0.1);
}

// ---------- V: the special ----------

export function hasSpecial(sp) {
  return !!(sp.hover || sp.sweep || sp.orbit);
}

export function special(jet) {
  const sp = jet.spec;
  const mgr = jet.manager;
  const say = (t) => jet === mgr.active && mgr.onMessage?.(t);
  if (sp.sweep) {
    jet.sweepMode = { auto: "fwd", fwd: "back", back: "auto" }[jet.sweepMode] || "auto";
    say({ auto: "WINGS: AUTO (they sweep back with the Mach number)", fwd: "WINGS: FORWARD (20 degrees: slow and tight turns, more drag)", back: "WINGS: BACK (68 degrees: fast, a higher stall speed)" }[jet.sweepMode]);
    mgr.audio?.playSalvoPip?.(jet.sweepMode === "auto" ? 1 : jet.sweepMode === "fwd" ? 2 : 3, 4);
    return;
  }
  if (sp.hover) {
    if (!jet.hoverOn) {
      const lim = HOVER.enter * jet.cfg.stallSpeed;
      if (!jet.onGround && jet.speed > lim) {
        say(`Too fast for the hover: slow down below ${Math.round(lim * 3.6)} km/h (S, Space for the air brakes), then V`);
        return;
      }
      jet.hoverOn = true;
      jet.hoverYaw = Math.atan2(-jet.forward(_v).x, -_v.z);
      jet.hoverPitch = 0;
      jet.setAbLatch?.(false);
      say("HOVER: Space up, Shift down, W / S forward / back, Q / E sideways, the mouse turns · V: back to wing-borne flight");
    } else {
      jet.hoverOn = false;
      jet.throttle = Math.max(jet.throttle, 0.9);
      jet._levelAim();
      say("WING-BORNE: the lift fan holds you up until the wings fly (keep W on)");
    }
    mgr.audio?.playAirbrake?.(jet.hoverOn);
    return;
  }
  if (sp.orbit) {
    if (jet.orbit) return endOrbit(jet, "ORBIT OFF: flying again");
    if (jet.onGround) {
      say("Take off first: the orbit circles a point on the ground from the air");
      return;
    }
    startOrbit(jet);
  }
}

// ---------- Per frame: the sweep, the hover, the orbit ----------

// Before the flight model: the sweep's effect, the lift fan; the hover or
// the orbit fly the aircraft themselves (they return the flight state the
// rest of update needs), else null (the jet's own flight model).
export function fly(jet, dt, stick, input) {
  const sp = jet.spec;
  if (sp.sweep) updateSweep(jet, dt);
  if (sp.hover) {
    jet.nozzle += clamp((jet.hoverOn ? 1 : 0) - jet.nozzle, -dt / HOVER.convert, dt / HOVER.convert);
    if (jet.hoverOn && jet.alive) return hoverFly(jet, dt, input);
    const vS = Math.max(15, jet.cfg.stallSpeed);
    jet.vtolLift = jet.nozzle > 0.01 ? jet.nozzle * clamp(1.15 - Math.max(0, jet.vel.dot(jet.forward(_v))) / (vS * 1.25), 0, 1) : 0;
  }
  if (sp.orbit && jet.orbit) {
    if (!input || !jet.alive) {
      jet.orbit = null;
      return null;
    }
    const k = input.keys;
    if (k.has("KeyA") || k.has("KeyD")) return endOrbit(jet, "ORBIT OFF (A / D): flying again"), null;
    return orbitFly(jet, dt, input);
  }
  return null;
}

function updateSweep(jet, dt) {
  const M = jet.speed / MACH1;
  let want;
  if (jet.onGround && jet.speed < 3 && !jet.occupied && !jet.puppet) want = SWEEP.parked;
  else if (jet.sweepMode === "fwd") want = SWEEP.fwd;
  else if (jet.sweepMode === "back") want = SWEEP.back;
  else want = SWEEP.fwd + (SWEEP.back - SWEEP.fwd) * clamp((M - SWEEP.m0) / (SWEEP.m1 - SWEEP.m0), 0, 1);
  jet.sweep += clamp(want - jet.sweep, -SWEEP.rate * dt, SWEEP.rate * dt);
  const k = clamp((jet.sweep - SWEEP.fwd) / (SWEEP.back - SWEEP.fwd), 0, 1);
  jet.stallMul = 1 + 0.35 * k; // (swept: less lift, a higher stall speed)
  jet.dragMul = 1 + 0.65 * (1 - k); // (forward: more drag, the top speed held down)
  jet.turnMul = 1.12 - 0.2 * k; // (forward: tighter turns)
}

// The F-35B in the hover.
function hoverFly(jet, dt, input) {
  const k = input?.keys || NO_KEYS;
  const mgr = jet.manager;
  jet.afterburner = false;
  jet.stalled = false;
  jet.vtolLift = 0;
  if (input) {
    const sens = 0.0022 * (mgr.mouseSensitivity ?? 0.6);
    const inv = mgr.invertY ? -1 : 1;
    if (!jet.freeLook) {
      jet.hoverYaw -= input.dx * sens;
      jet.hoverPitch = clamp(jet.hoverPitch - input.dy * sens * inv, -HOVER.pitch, HOVER.pitch);
    }
  }
  const yaw = jet.hoverYaw;
  const fwd = k.has("KeyW") ? HOVER.forward : k.has("KeyS") ? -HOVER.back : 0;
  const side = k.has("KeyE") ? HOVER.side : k.has("KeyQ") ? -HOVER.side : 0;
  let up = k.has("Space") ? HOVER.climb : k.has("ShiftLeft") || k.has("ShiftRight") ? -HOVER.sink : 0;
  // (Close to the ground the sink eases off: a gentle touchdown.)
  if (up < 0 && !jet.onGround) {
    const agl = jet.pos.y - jet.gearH - jet.manager.groundBelow(jet.pos.x, jet.pos.y, jet.pos.z);
    up = Math.max(up, -(2 + agl * 0.8));
  }
  const hx = -Math.sin(yaw);
  const hz = -Math.cos(yaw);
  const rx = Math.cos(yaw);
  const rz = -Math.sin(yaw);
  // The speed eases toward what the keys ask (altitude held with none).
  const dvx = hx * fwd + rx * side - jet.vel.x;
  const dvz = hz * fwd + rz * side - jet.vel.z;
  const dh = Math.hypot(dvx, dvz);
  const maxH = HOVER.decel * dt;
  const kh = dh > maxH ? maxH / dh : 1;
  const ax = (dvx * kh) / Math.max(dt, 1e-4);
  const az = (dvz * kh) / Math.max(dt, 1e-4);
  jet.vel.x += dvx * kh;
  jet.vel.z += dvz * kh;
  jet.vel.y += clamp(up - jet.vel.y, -HOVER.decel * 1.4 * dt, HOVER.decel * 1.4 * dt);
  // The attitude: heading from the mouse, the nose up or down a little (to
  // aim), tilted a touch into the acceleration (as a real one leans).
  const lean = clamp(-(ax * hx + az * hz) * 0.012, -0.12, 0.12);
  const bank = clamp((ax * rx + az * rz) * 0.012, -0.15, 0.15);
  _q.setFromEuler(_e.set(jet.hoverPitch + lean, yaw, -bank, "YXZ"));
  jet.q.slerp(_q, Math.min(1, dt * 5));
  jet.angVel.set(0, 0, 0);
  jet.aimQ.setFromEuler(_e.set(jet.hoverPitch, yaw, 0, "YXZ"));
  jet.throttle += (0.62 + 0.25 * clamp(up / HOVER.climb, -1, 1) - jet.throttle) * Math.min(1, dt * 3);
  return { speed: jet.vel.length(), aoa: 0, vF: jet.vel.dot(jet.forward(_v)), vtol: true };
}

// ---------- The AC-130's orbit ----------

function startOrbit(jet) {
  const mgr = jet.manager;
  const look = _v.set(0, 0, -1).applyQuaternion(jet.aimQ);
  let c = null;
  const lk = jet.lock?.target && jet._targetAlive(jet.lock.target) ? jet._targetPos(jet.lock.target, new THREE.Vector3()) : null;
  if (lk) c = lk;
  else {
    const hit = mgr.world.raycast(jet.pos, look, 3000, { solidOnly: true });
    if (hit) c = jet.pos.clone().addScaledVector(look, hit.distance);
  }
  if (!c) {
    // (Nothing under the crosshair: the ground off the left wing.)
    const left = jet.right(_w).multiplyScalar(-1);
    left.y = 0;
    left.normalize();
    c = jet.pos.clone().addScaledVector(left, ORBIT.radius);
    c.y = mgr.groundBelow(c.x, jet.pos.y, c.z);
  }
  const dx = jet.pos.x - c.x;
  const dz = jet.pos.z - c.z;
  const d = Math.max(20, Math.hypot(dx, dz));
  const ground = mgr.groundBelow(c.x, c.y + 40, c.z);
  jet.orbit = {
    c,
    r: d,
    R: clamp(d, ORBIT.minR, ORBIT.maxR),
    alt: Math.max(jet.pos.y, ground + ORBIT.minAgl),
    theta: Math.atan2(dz, dx),
    v: clamp(jet.speed, jet.cfg.stallSpeed * 1.6, ORBIT.speed + 25),
    t: 0,
  };
  jet.gunYaw = 0;
  jet.gunPitch = 0;
  jet.setAbLatch?.(false);
  if (jet === mgr.active) mgr.onMessage?.(`ORBIT: circling the target ${Math.round(Math.hypot(dx, dz))} blocks off, guns on it · the mouse aims, LMB 25 mm, RMB the ${WEAPON_LABELS[jet.weapon] || "weapon"} · V or A / D: break off`);
  mgr.audio?.playNotice?.();
}

function endOrbit(jet, msg) {
  jet.orbit = null;
  jet._levelAim();
  jet.camView?.copy(jet.aimQ);
  if (jet === jet.manager.active && msg) jet.manager.onMessage?.(msg);
}

// The orbit flown on rails: round the centre (left-hand: the centre off the
// left wing), the radius easing to its own, the height held (clear of the
// ground under it), banked, the throttle on its own.
function orbitFly(jet, dt, input) {
  const o = jet.orbit;
  const mgr = jet.manager;
  o.t += dt;
  o.r += (o.R - o.r) * Math.min(1, dt * 0.25);
  o.v += (ORBIT.speed - o.v) * Math.min(1, dt * 0.3);
  o.theta -= (o.v / Math.max(30, o.r)) * dt;
  const ground = mgr.groundBelow(jet.pos.x, jet.pos.y, jet.pos.z);
  const alt = Math.max(o.alt, ground + ORBIT.minAgl * 0.6);
  const px = o.c.x + Math.cos(o.theta) * o.r;
  const pz = o.c.z + Math.sin(o.theta) * o.r;
  // The tangent (forward), and a pull onto the circle.
  const fx = Math.sin(o.theta);
  const fz = -Math.cos(o.theta);
  jet.vel.set(fx * o.v + (px - jet.pos.x) * 1.5, clamp((alt - jet.pos.y) * 0.8, -15, 15), fz * o.v + (pz - jet.pos.z) * 1.5);
  const bank = Math.min(ORBIT.bank, Math.atan((o.v * o.v) / (14 * Math.max(30, o.r))));
  _q.setFromEuler(_e.set(clamp(jet.vel.y / Math.max(30, o.v), -0.2, 0.2), Math.atan2(-fx, -fz), bank, "YXZ"));
  jet.q.slerp(_q, Math.min(1, dt * (o.t < 3 ? 1.2 : 3)));
  jet.angVel.set(0, 0, 0);
  jet.stalled = false;
  jet.afterburner = false;
  jet.throttle += (0.62 - jet.throttle) * Math.min(1, dt);
  // The gunner's aim: the mouse moves it round the line to the centre.
  if (input && !jet.freeLook) {
    const sens = 0.0016 * (mgr.mouseSensitivity ?? 0.6);
    const inv = mgr.invertY ? -1 : 1;
    jet.gunYaw = clamp(jet.gunYaw - input.dx * sens, -ORBIT.look, ORBIT.look);
    jet.gunPitch = clamp(jet.gunPitch - input.dy * sens * inv, -ORBIT.look, ORBIT.look);
  }
  gunnerDir(jet, _u);
  jet.aimQ.setFromUnitVectors(_w.set(0, 0, -1), _u);
  return { speed: jet.vel.length(), aoa: 0, vF: o.v, orbit: true };
}

// Where the AC-130's guns point (a unit vector, into `out`): in the orbit at
// the centre, turned by the gunner's aim; otherwise out of the left side,
// 25 degrees down.
export function gunnerDir(jet, out = new THREE.Vector3()) {
  const o = jet.orbit;
  if (o) {
    const from = gunStation(jet, _w);
    out.copy(o.c).sub(from).normalize();
    // (Yaw round the vertical, pitch round the horizontal across the line.)
    out.applyAxisAngle(Y, jet.gunYaw);
    const across = _v.crossVectors(out, Y);
    if (across.lengthSq() > 1e-6) out.applyAxisAngle(across.normalize(), jet.gunPitch);
    return out.normalize();
  }
  return out.set(-Math.cos(0.44), -Math.sin(0.44), 0).applyQuaternion(jet.q).normalize();
}

// The gunner's station (the camera in the orbit): out of the left side.
function gunStation(jet, out) {
  return out.set(-3.2, -0.6, -4.0).applyQuaternion(jet.q).add(jet.pos);
}

// The camera in the orbit: the gunner's view along the guns (true: done).
export function camera(jet, cam) {
  if (!jet.orbit) return false;
  gunStation(jet, cam.position);
  const d = gunnerDir(jet, _u);
  cam.up.set(0, 1, 0);
  cam.lookAt(_w.copy(cam.position).add(d));
  return true;
}

// The camera mode word (the HUD).
export function inOrbit(jet) {
  return !!jet.orbit;
}

// ---------- The guns (the left button) ----------

const _tracers = {};
function tracer(kind) {
  const g = PLANE_GUNS[kind];
  return _tracers[kind] || (_tracers[kind] = new THREE.Color(g.color[0], g.color[1], g.color[2]));
}

// One round from the aircraft's own gun (the cannon's rate, heat and jam are vehicle-jet.js's).
export function fireGun(jet, fwd) {
  const mgr = jet.manager;
  const sp = jet.spec;
  const G = PLANE_GUNS[sp.gun];
  jet.cannonT += 1 / sp.cannonRate; // (several rounds a frame at the GAU-8's rate: vehicle-jet.js _weapons)
  jet.heat = Math.min(1, jet.heat + sp.heatPerShot);
  if (jet.heat >= 1) jet.jammed = true;
  jet._gunN = (jet._gunN || 0) + 1;
  const n = jet._gunN;
  const up = jet.up(_v);
  const right = jet.right(_w);
  let from;
  let dir;
  if (sp.gun === "side25") {
    dir = gunnerDir(jet, new THREE.Vector3());
    from = new THREE.Vector3(-2.4, -0.68, -4.9).applyQuaternion(jet.q).add(jet.pos);
  } else {
    if (G.wings) {
      // (The six wing guns in turn, converging ahead.)
      const side = n % 2 ? 1 : -1;
      const gx = G.wings[Math.floor(n / 2) % G.wings.length];
      from = jet.pos.clone().addScaledVector(right, side * gx).addScaledVector(up, -0.25).addScaledVector(fwd, 0.9);
    } else from = jet.pos.clone().addScaledVector(fwd, 6.9).addScaledVector(up, -0.24).addScaledVector(right, -0.06);
    dir = jet.pos.clone().addScaledVector(fwd, 7 + jet._gunRange(fwd)).sub(from).normalize();
  }
  const speed = G.speed + Math.max(0, jet.vel.dot(dir));
  if (jet.cfg.aimAssist !== false) {
    if (sp.gun === "side25") {
      const a = jet._laserAssist(from, dir);
      if (a) dir.copy(a.dir);
    } else dir = jet._assistDir(from, dir, speed);
  }
  dir.x += (Math.random() - 0.5) * G.spread;
  dir.y += (Math.random() - 0.5) * G.spread;
  dir.z += (Math.random() - 0.5) * G.spread;
  dir.normalize();
  const c = tracer(sp.gun);
  const hei = sp.gun === "gau8" && n % 3 === 0;
  mgr.lasers.fire({ from, dir, color: c, speed, damage: sp.cannonDamage * (jet.cannonScale ?? 1), owner: jet.cannonOwner || "jet", source: jet, range: G.range, radius: G.radius, length: G.length, scorch: true, sound: false, onHit: hei ? (b, hit, point) => heiFlash(mgr, point) : null });
  if (n % G.sound === 0) jet._sound(() => (sp.gun === "gau8" ? mgr.audio?.playGau8?.() : mgr.audio?.playCannon?.()));
  mgr.effects.glow.spawn({ x: from.x, y: from.y, z: from.z, life: 0.05, size0: sp.gun === "gau8" ? 2.4 : 1.1, size1: 0.3, color0: c, alpha: 0.9 });
  if (sp.gun === "gau8" && n % 4 === 0) mgr.effects.smoke.spawn({ x: from.x, y: from.y, z: from.z, vx: jet.vel.x * 0.6, vy: jet.vel.y * 0.6 + 0.5, vz: jet.vel.z * 0.6, life: 1.2, size0: 0.6, size1: 2.6, color0: _gunSmoke, color1: _gunSmoke2, alpha: 0.5, drag: 1.2 });
}
const _gunSmoke = new THREE.Color(0.55, 0.55, 0.55);
const _gunSmoke2 = new THREE.Color(0.75, 0.75, 0.75);
const _hei = new THREE.Color(5, 3.2, 1.2);
const _dust = new THREE.Color(0.55, 0.5, 0.44);
function heiFlash(mgr, p) {
  const fx = mgr.effects;
  fx.glow.spawn({ x: p.x, y: p.y, z: p.z, life: 0.12, size0: 2.6, size1: 0.6, color0: _hei, alpha: 0.9 });
  fx.smoke.spawn({ x: p.x, y: p.y, z: p.z, vx: (Math.random() - 0.5) * 2, vy: 1.5, vz: (Math.random() - 0.5) * 2, life: 1.3, size0: 0.8, size1: 3, color0: _dust, color1: _gunSmoke2, alpha: 0.55, drag: 1.4 });
}

// ---------- Rockets, bombs, the side guns (the right button) ----------

let _rocketGeo = null;
let _bombGeo = null;
let _mat = null;
function shotMaterial() {
  return _mat || (_mat = new THREE.MeshLambertMaterial({ vertexColors: true }));
}
function colored(g, hex) {
  const n = g.index ? g.toNonIndexed() : g;
  const c = new THREE.Color(hex);
  const col = new Float32Array(n.getAttribute("position").count * 3);
  for (let i = 0; i < col.length; i += 3) col.set([c.r, c.g, c.b], i);
  n.setAttribute("color", new THREE.BufferAttribute(col, 3));
  return n;
}
function mergeColored(list) {
  let count = 0;
  for (const g of list) count += g.getAttribute("position").count;
  const pos = new Float32Array(count * 3);
  const nor = new Float32Array(count * 3);
  const col = new Float32Array(count * 3);
  let o = 0;
  for (const g of list) {
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
// A rocket (along -Z): a thin olive tube, a dark head, small fins.
export function rocketGeometry() {
  return (_rocketGeo ||= mergeColored([
    colored(new THREE.CylinderGeometry(0.06, 0.06, 1.3, 8).rotateX(Math.PI / 2), 0x7a7f6a),
    colored(new THREE.ConeGeometry(0.06, 0.3, 8).rotateX(-Math.PI / 2).translate(0, 0, -0.8), 0x2a2d30),
    colored(new THREE.BoxGeometry(0.3, 0.02, 0.18).translate(0, 0, 0.55), 0x5d6258),
    colored(new THREE.BoxGeometry(0.02, 0.3, 0.18).translate(0, 0, 0.55), 0x5d6258),
  ]));
}
// A low-drag bomb (along -Z): olive, a yellow band, box fins.
export function bombGeometry() {
  return (_bombGeo ||= mergeColored([
    colored(new THREE.CylinderGeometry(0.17, 0.17, 1.3, 10).rotateX(Math.PI / 2), 0x4b5236),
    colored(new THREE.ConeGeometry(0.17, 0.45, 10).rotateX(-Math.PI / 2).translate(0, 0, -0.87), 0x4b5236),
    colored(new THREE.CylinderGeometry(0.175, 0.175, 0.08, 10).rotateX(Math.PI / 2).translate(0, 0, -0.5), 0xd8b22a),
    colored(new THREE.ConeGeometry(0.17, 0.5, 10).rotateX(Math.PI / 2).translate(0, 0, 0.9), 0x4b5236),
    colored(new THREE.BoxGeometry(0.5, 0.03, 0.3).translate(0, 0, 1.0), 0x3d432b),
    colored(new THREE.BoxGeometry(0.03, 0.5, 0.3).translate(0, 0, 1.0), 0x3d432b),
  ]));
}

// The selected own weapon (rockets, bombs, the 40 mm, the 105 mm): the right
// button (held: again each time it is ready). Clears the missile lock's
// state as the laser does.
export function weaponInput(jet, dt, input) {
  jet._laserLock(dt);
  jet.ownT = Math.max(0, jet.ownT - dt);
  const both = !!input.buttons[0] && !!input.buttons[2];
  const pressed = input.pressed.has("mouse2");
  if (!input.buttons[2] && !pressed) {
    jet._ownBlock = false;
    return;
  }
  if (jet._ownBlock || jet.freeLook || both) return;
  if (jet.ownT > 0) return;
  fireOwn(jet, pressed);
}

function fireOwn(jet, click) {
  const mgr = jet.manager;
  const me = jet === mgr.active;
  const w = jet.weapon;
  const say = (t) => me && mgr.onMessage?.(t);
  if (w === "rockets") {
    if (jet.rocketsLeft <= 0) {
      if (click) say(`ROCKETS: none left (${ROCKETS.reload} s in the air for more, or land and stop)`);
      jet._ownBlock = true;
      return;
    }
    launch(jet, "rocket");
    if (jet.rocketsLeft > 0 && jet.spec.id !== "p51") launch(jet, "rocket");
    jet.ownT = jet.spec.id === "p51" ? 0.35 : ROCKETS.interval * 2;
    return;
  }
  if (w === "bombs") {
    if (jet.bombsLeft <= 0) {
      if (click) say(`BOMBS: none left (${BOMBS.reload} s in the air for more, or land and stop)`);
      jet._ownBlock = true;
      return;
    }
    if (jet.onGround) {
      if (click) say("BOMBS: not on the ground");
      jet._ownBlock = true;
      return;
    }
    launch(jet, "bomb");
    jet.ownT = BOMBS.interval;
    if (me) say(`BOMB AWAY (${jet.bombsLeft} left)`);
    return;
  }
  const S = SIDE_GUNS[w];
  if (S) {
    fireShell(jet, w, S);
    jet.ownT = 1 / S.rate;
  }
}

// A rocket or a bomb leaves the aircraft (into its `missiles`, ballistic).
function launch(jet, kind) {
  const mgr = jet.manager;
  const fwd = jet.forward(new THREE.Vector3());
  const right = jet.right(_w);
  const up = jet.up(_u);
  const p51 = jet.spec.id === "p51";
  jet.rail = -(jet.rail || 1);
  let m;
  if (kind === "rocket") {
    jet.rocketsLeft--;
    const off = p51 ? 2.7 + (jet.rocketsLeft % 3) * 0.36 : 4.8;
    const pos = jet.pos.clone().addScaledVector(right, jet.rail * off).addScaledVector(up, -0.6).addScaledVector(fwd, 1.5);
    // (Fired along the nose, converging a little on what it points at.)
    const aim = jet.pos.clone().addScaledVector(fwd, 7 + jet._gunRange(fwd)).sub(pos).normalize();
    const vel = aim.multiplyScalar(ROCKETS.speed + Math.max(0, jet.vel.dot(fwd)) * 0.8);
    m = { pos, vel, dir: vel.clone().normalize(), age: 0, ballistic: "rocket", netKind: "rk", radius: p51 ? HVAR.radius : ROCKETS.radius, damage: p51 ? HVAR.damage : ROCKETS.damage, life: ROCKETS.life, trail: 0, launcher: jet, target: null };
    m.mesh = new THREE.Mesh(rocketGeometry(), shotMaterial());
    jet._sound(() => mgr.audio?.playRocketLaunch?.());
  } else {
    jet.bombsLeft--;
    const pos = jet.pos.clone().addScaledVector(up, -1.4).addScaledVector(right, jet.rail * (p51 ? 2.1 : 1.2));
    const vel = jet.vel.clone().addScaledVector(up, -3);
    m = { pos, vel, dir: vel.clone().normalize(), age: 0, ballistic: "bomb", netKind: "nb", radius: p51 ? P51_BOMB.radius : BOMBS.radius, damage: p51 ? P51_BOMB.damage : BOMBS.damage, life: 40, trail: 0, launcher: jet, target: null };
    m.mesh = new THREE.Mesh(bombGeometry(), shotMaterial());
    jet._sound(() => mgr.audio?.playAirbrake?.(false));
  }
  m.mesh.castShadow = true;
  m.mesh.position.copy(m.pos);
  mgr.scene.add(m.mesh);
  jet.missiles.push(m);
  return m;
}

// The AC-130's 40 mm or 105 mm: an explosive shell (a fast bolt) at the gunner's aim.
const _shellC = { gun40: new THREE.Color(6, 4, 1.5), gun105: new THREE.Color(7, 4.5, 2) };
function fireShell(jet, w, S) {
  const mgr = jet.manager;
  const dir = gunnerDir(jet, new THREE.Vector3());
  const from = (w === "gun105" ? new THREE.Vector3(-2.75, -1.09, 3.18) : new THREE.Vector3(-2.4, -0.24, -1.8)).applyQuaternion(jet.q).add(jet.pos);
  if (jet.cfg.aimAssist !== false) {
    const a = jet._laserAssist(from, dir);
    if (a) dir.copy(a.dir);
  }
  const mine = !jet.puppet;
  mgr.lasers.fire({ from, dir, color: _shellC[w], speed: S.speed, damage: S.damage, owner: jet.cannonOwner || "jet", source: jet, range: S.range, radius: w === "gun105" ? 0.22 : 0.13, length: w === "gun105" ? 6 : 5, scorch: true, sound: false, onHit: mine ? (b, hit, point) => mgr.effects.explode(point, { radius: S.blast, source: "tankshell" }) : null });
  jet.shellsFired = (jet.shellsFired || 0) + 1;
  const fx = mgr.effects;
  fx.glow.spawn({ x: from.x, y: from.y, z: from.z, life: 0.12, size0: w === "gun105" ? 6 : 3.5, size1: 0.8, color0: _shellC[w], alpha: 1 });
  for (let i = 0; i < (w === "gun105" ? 8 : 3); i++) fx.smoke.spawn({ x: from.x, y: from.y, z: from.z, vx: dir.x * 6 + jet.vel.x * 0.7, vy: dir.y * 6 + jet.vel.y * 0.7, vz: dir.z * 6 + jet.vel.z * 0.7, life: 1.6, size0: 0.8, size1: w === "gun105" ? 5 : 3, color0: _gunSmoke, color1: _gunSmoke2, alpha: 0.6, drag: 1.4 });
  jet._sound(() => (w === "gun105" ? mgr.audio?.playExplosion?.(30, 0.8) : mgr.audio?.playCannon?.()));
  if (jet === mgr.active) mgr.effects?.shake?.add?.(w === "gun105" ? 0.25 : 0.06);
}

// One step of a rocket or a bomb (from the jet's _updateMissiles); true: it is done.
export function stepShot(jet, m, dt) {
  const mgr = jet.manager;
  const fx = mgr.effects;
  m.age += dt;
  if (m.ballistic === "bomb") {
    m.vel.y -= BOMB_G * dt;
    m.vel.multiplyScalar(1 - BOMBS.drag * dt);
  } else m.vel.y -= 2 * dt;
  const speed = m.vel.length();
  const step = speed * dt;
  const dir = m.dir.copy(m.vel).divideScalar(Math.max(1e-4, speed));
  let boom = null;
  let direct = null;
  const uh = mgr.ufos?.raycast(m.pos, dir, step);
  if (uh) {
    boom = m.pos.clone().addScaledVector(dir, uh.distance);
    direct = { kind: "ufo", ref: uh.ufo };
  }
  const vh = mgr.raycast?.(m.pos, dir, step, jet);
  if (vh && (!boom || vh.distance < boom.distanceTo(m.pos)) && (vh.vehicle.isEnemyJet || vh.vehicle.isEnemyGround || (mgr.pvp && vh.vehicle.puppet && vh.vehicle.netOcc))) {
    boom = m.pos.clone().addScaledVector(dir, vh.distance);
    direct = { kind: vh.vehicle.isEnemyGround ? "vehicle" : "jet", ref: vh.vehicle };
  }
  if (!boom) {
    const bh = mgr.world.raycast(m.pos, dir, step, { solidOnly: true });
    if (bh) boom = m.pos.clone().addScaledVector(dir, Math.max(0, bh.distance - 0.3));
  }
  if (!boom && IS_WET[mgr.world.getBlock(Math.floor(m.pos.x), Math.floor(m.pos.y), Math.floor(m.pos.z))]) boom = m.pos.clone();
  if (!boom && m.age > 0.25 && mgr.mobs?.sphereHit?.(m.pos, 1)) boom = m.pos.clone();
  if (!boom && m.ballistic === "rocket" && m.age > m.life) boom = m.pos.clone();
  if (boom || m.pos.y < -10 || m.age > 60) {
    if (boom) {
      if (direct?.kind === "ufo") {
        mgr.ufos.damage(direct.ref, m.damage, true, boom);
        mgr.onMissileHit?.(direct.ref);
      } else if (direct?.kind === "jet") {
        direct.ref.damage(m.damage, "missile", true);
        mgr.onMissileHit?.(direct.ref);
      } else if (direct?.kind === "vehicle") direct.ref.damage?.(m.damage * 0.55, "missile");
      fx.explode(boom, { radius: m.radius, source: "missile" });
      if (m.ballistic === "bomb") (jet.bombHits ||= []).push(boom.clone());
    }
    return true;
  }
  m.pos.addScaledVector(m.vel, dt);
  m.mesh.position.copy(m.pos);
  m.mesh.quaternion.setFromUnitVectors(_w.set(0, 0, -1), dir);
  if (m.ballistic === "rocket") {
    // A short smoke trail and the motor's glow.
    m.trail += step;
    const spacing = 2.2 / Math.max(0.35, effectsQuality.scale);
    while (m.trail > spacing) {
      m.trail -= spacing;
      const k = -m.trail - 0.8;
      fx.smoke.spawn({ x: m.pos.x + dir.x * k, y: m.pos.y + dir.y * k, z: m.pos.z + dir.z * k, vx: 0, vy: 0.3, vz: 0, life: 1.2 + Math.random() * 0.6, size0: 0.35, size1: 1.6, color0: _gunSmoke2, color1: _gunSmoke2, alpha: 0.45, drag: 0.8 });
    }
    fx.glow.spawn({ x: m.pos.x - dir.x * 0.8, y: m.pos.y - dir.y * 0.8, z: m.pos.z - dir.z * 0.8, life: 0.06, size0: 1.1, size1: 0.3, color0: _hei, alpha: 0.9 });
  }
  return false;
}

// Rockets and bombs come back: all of them stopped on the ground a few
// seconds, or one load in the air after a long while.
export function rearm(jet, dt) {
  if (jet.bombsLeft >= jet.bombsMax && jet.rocketsLeft >= jet.rocketsMax) {
    jet.storeT = 0;
    return;
  }
  if (jet.onGround && jet.speed < 3) {
    jet._storeRest = (jet._storeRest || 0) + dt;
    if (jet._storeRest >= 4) {
      refill(jet);
      jet._storeRest = 0;
    }
    return;
  }
  jet._storeRest = 0;
  jet.storeT += dt;
  if (jet.rocketsLeft < jet.rocketsMax && jet.storeT >= ROCKETS.reload && jet.rocketsLeft === 0) {
    jet.rocketsLeft = jet.rocketsMax;
    jet.storeT = 0;
    if (jet === jet.manager.active) jet.manager.onMessage?.("ROCKETS reloaded");
  } else if (jet.bombsLeft < jet.bombsMax && jet.storeT >= BOMBS.reload && jet.bombsLeft === 0) {
    jet.bombsLeft = jet.bombsMax;
    jet.storeT = 0;
    if (jet === jet.manager.active) jet.manager.onMessage?.("BOMBS reloaded");
  }
}

// Where a bomb dropped now would land (the HUD's pipper), or null: the
// fall stepped with gravity and drag to the ground under it.
export function bombImpact(jet, out = new THREE.Vector3()) {
  if (jet.onGround) return null;
  const mgr = jet.manager;
  const up = jet.up(_u);
  const p = out.copy(jet.pos).addScaledVector(up, -1.4);
  const v = _v.copy(jet.vel).addScaledVector(up, -3);
  const dt = 0.08;
  for (let i = 0; i < 400; i++) {
    v.y -= BOMB_G * dt;
    v.multiplyScalar(1 - BOMBS.drag * dt);
    p.addScaledVector(v, dt);
    const g = mgr.groundBelow(p.x, p.y + 2, p.z);
    if (p.y <= g) {
      p.y = g;
      return p;
    }
  }
  return null;
}

// ---------- The HUD and the panels ----------

// The HUD's weapon box for an own weapon.
export function hudWeapon(jet) {
  const w = jet.weapon;
  if (w === "rockets") return { kind: w, name: `RKT ${jet.rocketsLeft}`, ready: jet.rocketsLeft > 0 ? 1 - jet.ownT / 0.3 : jet.storeT / ROCKETS.reload, left: 0, ammo: jet.rocketsLeft };
  if (w === "bombs") return { kind: w, name: `BOMB ${jet.bombsLeft}`, ready: jet.bombsLeft > 0 ? 1 - jet.ownT / BOMBS.interval : jet.storeT / BOMBS.reload, left: 0, ammo: jet.bombsLeft };
  const S = SIDE_GUNS[w];
  if (S) return { kind: w, name: S.name, ready: 1 - jet.ownT * S.rate, left: jet.ownT };
  return null;
}

// The flight panel's row for an own weapon (the "Missile" row's place).
export function statusRow(jet) {
  const w = jet.weapon;
  if (w === "rockets") return ["Rockets", jet.rocketsLeft > 0 ? `${jet.rocketsLeft} left · RMB fires ${jet.spec.id === "p51" ? "one" : "a pair"} (hold: a ripple)` : `NONE LEFT (more in ${Math.ceil(ROCKETS.reload - jet.storeT)} s; land and stop: all)`];
  if (w === "bombs") return ["Bombs", jet.bombsLeft > 0 ? `${jet.bombsLeft} left · RMB drops one where the pipper is` : `NONE LEFT (more in ${Math.ceil(BOMBS.reload - jet.storeT)} s; land and stop: all)`];
  const S = SIDE_GUNS[w];
  if (S) return ["Gun", `${S.name} ${jet.ownT > 0 ? `loading ${jet.ownT.toFixed(1)} s` : "READY"} · ${jet.orbit ? "on the orbit's target (the mouse aims)" : "out of the left side (V: orbit a target)"}`];
  return null;
}

// Extra rows of the flight panel: the hover, the wings, the orbit.
export function hudRows(jet) {
  const rows = [];
  const sp = jet.spec;
  if (sp.hover) rows.push(["Hover (V)", jet.hoverOn ? `<span class="vh-on">${jet.nozzle < 0.98 ? "CONVERTING" : "HOVER"}</span> · Space up, Shift down, W / S, Q / E` : jet.nozzle > 0.02 ? `<span class="vh-on">TO WING-BORNE</span> (the lift fan ${Math.round(jet.vtolLift * 100)}%)` : `off (V below ${Math.round(HOVER.enter * jet.cfg.stallSpeed * 3.6)} km/h)`]);
  if (sp.sweep) rows.push(["Wings (V)", `${Math.round((jet.sweep * 180) / Math.PI)}° · ${jet.sweepMode === "auto" ? "AUTO" : jet.sweepMode === "fwd" ? "<span class=\"vh-on\">FORWARD</span>" : "<span class=\"vh-on\">BACK</span>"}`]);
  if (sp.orbit) rows.push(["Orbit (V)", jet.orbit ? `<span class="vh-on">ORBITING</span> ${Math.round(jet.orbit.r)} blocks out, ${Math.round(jet.pos.y - jet.orbit.c.y)} above · the mouse aims` : "off: V circles the point in the crosshair"]);
  if (sp.stealth) rows.push(["Stealth", "radar and the UFOs' aim struggle to track you"]);
  if (sp.tvc && jet.stalled) rows.push(["Thrust vectoring", "<span class=\"vh-on\">POST-STALL</span>: the nozzles still turn you"]);
  return rows;
}

// The keys in the help line.
export function helpKeys(jet) {
  const sp = jet.spec;
  if (sp.hover) return " · V hover";
  if (sp.sweep) return " · V wings";
  if (sp.orbit) return " · V orbit";
  return "";
}

// The info panel's extra stats and controls.
export function infoStats(jet) {
  const sp = jet.spec;
  const out = [];
  if (sp.gun === "gau8") out.push(["GAU-8 Avenger", `the 30 mm gatling (LMB): ${sp.cannonRate} rounds/s, ${sp.cannonDamage} damage each (${sp.cannonRate * sp.cannonDamage} a second), explosive rounds; overheats after a few seconds`]);
  if (sp.gun === "m2") out.push(["Guns", `six .50 calibre machine guns in the wings (LMB), ${sp.cannonRate} rounds/s together`]);
  if (sp.gun === "side25") out.push(["Side guns", "out of the left side: LMB the 25 mm gatling, RMB the 40 mm Bofors or the 105 mm howitzer (X); aimed by the gunner in the orbit (V), else 25 degrees down off the left wing"]);
  if (sp.rockets) out.push(["Rockets", `${sp.rockets} unguided (${sp.id === "p51" ? "HVARs" : "Hydras"}): RMB fires ${sp.id === "p51" ? "one" : "a pair"} along the nose (hold: a ripple), a ${sp.id === "p51" ? HVAR.radius : ROCKETS.radius}-block blast each`]);
  if (sp.bombs) out.push(["Bombs", `${sp.bombs} free-fall bombs: RMB drops one; the pipper on the HUD shows where it will land; a ${sp.id === "p51" ? P51_BOMB.radius : BOMBS.radius}-block blast`]);
  if (sp.hover) out.push(["Hover (STOVL)", `V below ${Math.round(HOVER.enter * jet.cfg.stallSpeed * 3.6)} km/h: the nozzle swivels down and the lift fan opens; take off and land straight up and down`]);
  if (sp.sweep) out.push(["Swing wings", "20 degrees forward at low speed (tight turns, a low stall), sweeping back to 68 with the Mach number (the top speed); V: auto / forward / back"]);
  if (sp.tvc) out.push(["Thrust vectoring", "the nozzles turn with the stick: control slow and past the stall; the flight control keeps the wing flying, but with the air brakes open (Space) the nose goes where you pull it (a cobra, a post-stall turn)"]);
  if (sp.orbit) out.push(["Orbit", "V circles the point in the crosshair (or the locked target) on its own; the view is the gunner's"]);
  if (sp.stealth) out.push(["Stealth", "enemy fighters lock on later, the UFOs' aim is much worse"]);
  if (sp.prop) out.push(["Engines", sp.prop === "piston" ? "a Packard Merlin V-12 and a four-blade propeller; Shift: war emergency power" : "four turboprops with six-blade propellers"]);
  return out;
}

export function infoControls(jet) {
  const sp = jet.spec;
  const out = [];
  if (sp.hover) out.push(["V", "Hover on / off (STOVL); in the hover: Space up, Shift down, W / S forward / back, Q / E sideways, the mouse turns"]);
  if (sp.sweep) out.push(["V", "Wings: auto / forward / back"]);
  if (sp.orbit) out.push(["V", "Orbit the point in the crosshair (the gunner's view; the mouse aims); V or A / D breaks off"]);
  return out;
}

// ---------- Online: the moving parts ----------

// Into the jet's state: [sweep, nozzle, orbit] compactly ("pf").
export function netState(jet, s) {
  const sp = jet.spec;
  if (sp.sweep) s.pf = Math.round(jet.sweep * 100) / 100;
  else if (sp.hover) s.pf = Math.round(jet.nozzle * 100) / 100;
  if (jet.bombsMax || jet.rocketsMax) s.pst = jet.bombsLeft * 100 + jet.rocketsLeft;
}

export function netRead(jet, st) {
  if (!st) return;
  const sp = jet.spec;
  if (Number.isFinite(st.pf)) {
    if (sp.sweep) jet.sweep = st.pf;
    else if (sp.hover) jet.nozzle = st.pf;
  }
  if (Number.isFinite(st.pst)) {
    jet.bombsLeft = Math.floor(st.pst / 100);
    jet.rocketsLeft = st.pst % 100;
  }
}

// What the model's moving parts follow.
const _ms = { running: false, throttle: 0, speed: 0, onGround: true, stall: 40, sweep: NaN, nozzle: 0, stores: { bombs: 0, rockets: 0 } };
export function modelState(jet) {
  _ms.running = jet.alive && (jet.occupied || jet.puppet ? jet.throttle > 0.01 || jet.occupied || !!jet.netOcc : jet.throttle > 0.01);
  _ms.throttle = jet.throttle;
  _ms.speed = jet.speed;
  _ms.onGround = jet.onGround;
  _ms.stall = Math.max(15, jet.cfg.stallSpeed);
  _ms.sweep = jet.spec.sweep ? jet.sweep : NaN;
  _ms.nozzle = jet.spec.hover ? jet.nozzle : 0;
  _ms.stores.bombs = jet.bombsLeft;
  _ms.stores.rockets = jet.rocketsLeft;
  return _ms;
}
