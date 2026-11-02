// The solar system's numbers and its orbital mechanics (Round 16). Pure
// JavaScript (no three.js), so the unit tests run it in Node.
//
// Scale: one block is one metre, and the solar system is shrunk into
// something you can fly across. The Earth's radius is 60 km (a hundredth
// of the real one), the Moon a quarter of that, Mars
// about half; the Moon orbits 30 Earth radii out (60 really), an
// "astronomical unit" is 90,000 km (1,500 Earth radii; 23,500 really), the
// Sun's radius is 20 Earth radii (109 really, so it doesn't swallow the
// inner planets), Jupiter and Saturn are 5 and 4 Earth radii. The year is
// 36.5 days (a tenth of a real one), which sets the Sun's gravity; each
// planet's gravity is its surface gravity in the game (the Earth's 26
// blocks/s^2, the Moon's a sixth of it, Mars' 0.38), so a ship lands where
// it took off with the same pull. Light is 300,000 m/s (real), so one
// "astronomical unit" is 5 light minutes away at 1c; the warp drive goes to
// 10,000c. Orbits are circles in one plane (the ecliptic: x and z, +y is
// "north"); every planet turns the same way round the Sun, the Moon round
// the Earth.
//
// Flight: patched conics. A ship is inside one body's sphere of influence
// at a time (its "reference"), pulled by that body alone; out past it, the
// parent's. With no thrust its path is a conic, stepped exactly (kepler,
// universal variables), so time warp can run a hundred thousand times
// faster than real time without the orbit drifting. Thrust is stepped in
// small steps.
//
// The ground of each planet you can land on is a dimension (js/dim-*.js):
// above its "space line" (an altitude, in the world's blocks) the world
// hands over to the solar system's scene (js/solar.js), and down past its
// entry altitude the solar system hands back. A spot on a planet (latitude,
// longitude) is a spot in its world (x, z): one block a metre near the
// middle of the world, squeezed further out, so the whole globe fits into
// the world (worldToLatLon, latLonToWorld).

export const G_EARTH = 26; // the Overworld's gravity (player.js), blocks/s^2
export const C_LIGHT = 299792; // m/s
export const AU = 9e7;
export const YEAR = 3.15e6; // s
export const GM_SUN = (4 * Math.PI * Math.PI * AU * AU * AU) / (YEAR * YEAR);
export const BASE_Y = 64; // a planet's "sea level" in its world (altitude 0)

// The heights over the ground of the Overworld's sky and air (Round 16: well
// above the planes): the sky darkens from SKY_DARK[0] and is black by
// SKY_DARK[1]; the air thins from AIR_THIN[0] and is gone by AIR_THIN[1]
// (the jets' engines and wings lose their bite: a ceiling about 1,500 up).
export const SKY_DARK = { overworld: [2200, 5400], mars: [1400, 4000], moon: [0, 1] };
// (The Moon has no air, but Round 15 lets the jets fly there: they get the
// Overworld's ceiling, so they still can't reach space.)
export const AIR_THIN = { overworld: [900, 2000], mars: [700, 1900], moon: [900, 2000] };

// The bodies. a: orbit radius (round `parent`), th0: where it is at time 0
// (radians), r: radius, gm: gravity (G times mass), soi: its sphere of
// influence, dim: the dimension of its ground (if you can land), line: the
// altitude the world hands over at (blocks over BASE_Y), entry: the altitude
// the solar system hands back at, color: its marker's, atmo: an atmosphere
// (the entry's glow, the haze), gas: no ground at all.
const R_E = 60000;
export const BODIES = {
  sun: { id: "sun", name: "the Sun", label: "Sun", parent: null, a: 0, th0: 0, r: 1.2e6, gm: GM_SUN, soi: Infinity, color: "#ffd27a", star: true, keepOut: 1.6 },
  mercury: { id: "mercury", name: "Mercury", label: "Mercury", parent: "sun", a: 0.39 * AU, th0: 2.1, r: 0.38 * R_E, gm: 9.9 * (0.38 * R_E) ** 2, soi: 2.5e6, color: "#b5aca2", keepOut: 1.08 },
  venus: { id: "venus", name: "Venus", label: "Venus", parent: "sun", a: 0.72 * AU, th0: 4.0, r: 0.95 * R_E, gm: 23.4 * (0.95 * R_E) ** 2, soi: 5e6, color: "#f0d9a0", atmo: true, keepOut: 1.12 },
  earth: { id: "earth", name: "Earth", label: "Earth", parent: "sun", a: AU, th0: 0, r: R_E, gm: G_EARTH * R_E * R_E, soi: 1.8e7, dim: "overworld", line: 6000, entry: 5400, color: "#7fb8ff", atmo: true },
  moon: { id: "moon", name: "the Moon", label: "Moon", parent: "earth", a: 1.8e6, th0: 1.2, r: 16400, gm: (G_EARTH / 6) * 16400 * 16400, soi: 3e5, dim: "moon", line: 3000, entry: 2600, color: "#d8d8d8" },
  mars: { id: "mars", name: "Mars", label: "Mars", parent: "sun", a: 1.52 * AU, th0: 0.75, r: 31900, gm: 0.38 * G_EARTH * 31900 * 31900, soi: 1.2e7, dim: "mars", line: 4500, entry: 4000, color: "#ff8f5e", atmo: true },
  jupiter: { id: "jupiter", name: "Jupiter", label: "Jupiter", parent: "sun", a: 5.2 * AU, th0: 3.3, r: 5 * R_E, gm: GM_SUN / 1047, soi: 3e7, color: "#e3c39a", gas: true, keepOut: 1.06 },
  saturn: { id: "saturn", name: "Saturn", label: "Saturn", parent: "sun", a: 9.54 * AU, th0: 5.4, r: 4.2 * R_E, gm: GM_SUN / 3498, soi: 3e7, color: "#ecd9a8", gas: true, rings: [1.25, 2.3], keepOut: 1.06 },
};
export const BODY_IDS = Object.keys(BODIES);
// The body whose ground each dimension is.
export const BODY_OF_DIM = { overworld: "earth", moon: "moon", mars: "mars" };
for (const b of Object.values(BODIES)) b.children = BODY_IDS.filter((id) => BODIES[id].parent === b.id);

// ---------- Small vector helpers (arrays [x, y, z]) ----------

export const v3 = (x = 0, y = 0, z = 0) => [x, y, z];
export const add = (a, b, o = [0, 0, 0]) => ((o[0] = a[0] + b[0]), (o[1] = a[1] + b[1]), (o[2] = a[2] + b[2]), o);
export const sub = (a, b, o = [0, 0, 0]) => ((o[0] = a[0] - b[0]), (o[1] = a[1] - b[1]), (o[2] = a[2] - b[2]), o);
export const scale = (a, k, o = [0, 0, 0]) => ((o[0] = a[0] * k), (o[1] = a[1] * k), (o[2] = a[2] * k), o);
export const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const len = (a) => Math.hypot(a[0], a[1], a[2]);
export const cross = (a, b, o = [0, 0, 0]) => {
  const x = a[1] * b[2] - a[2] * b[1];
  const y = a[2] * b[0] - a[0] * b[2];
  const z = a[0] * b[1] - a[1] * b[0];
  o[0] = x;
  o[1] = y;
  o[2] = z;
  return o;
};
export const norm = (a, o = [0, 0, 0]) => {
  const l = len(a) || 1;
  return scale(a, 1 / l, o);
};
const smooth = (a, b, v) => {
  const t = Math.max(0, Math.min(1, (v - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

// ---------- The air and the sky by height (the worlds) ----------

// 0-1: how much air is left at world height y in `dim` (1 down low).
export function airDensity(y, dim = "overworld") {
  const t = AIR_THIN[dim];
  if (!t) return 1;
  return 1 - smooth(t[0], t[1], y - BASE_Y);
}

// 0-1: how far into the black the sky is at world height y in `dim`.
export function skyDark(y, dim = "overworld") {
  const t = SKY_DARK[dim];
  if (!t) return 0;
  return smooth(t[0], t[1], y - BASE_Y);
}

// The world height (blocks) above which `dim` hands over to space, or Infinity.
export function spaceLineY(dim) {
  const b = BODIES[BODY_OF_DIM[dim]];
  return b ? BASE_Y + b.line : Infinity;
}

// ---------- Where the bodies are ----------

// The body's position relative to its parent at time t (s), and velocity.
export function localState(id, t, pos = [0, 0, 0], vel = null) {
  const b = BODIES[id];
  if (!b.parent) {
    pos[0] = pos[1] = pos[2] = 0;
    if (vel) vel[0] = vel[1] = vel[2] = 0;
    return pos;
  }
  const n = Math.sqrt(BODIES[b.parent].gm / (b.a * b.a * b.a));
  const th = b.th0 + n * t;
  pos[0] = b.a * Math.cos(th);
  pos[1] = 0;
  pos[2] = -b.a * Math.sin(th);
  if (vel) {
    vel[0] = -b.a * n * Math.sin(th);
    vel[1] = 0;
    vel[2] = -b.a * n * Math.cos(th);
  }
  return pos;
}

// Its position (and velocity) relative to the Sun at time t.
export function absState(id, t, pos = [0, 0, 0], vel = null) {
  pos[0] = pos[1] = pos[2] = 0;
  if (vel) vel[0] = vel[1] = vel[2] = 0;
  const p = [0, 0, 0];
  const v = [0, 0, 0];
  for (let b = BODIES[id]; b && b.parent; b = BODIES[b.parent]) {
    localState(b.id, t, p, v);
    add(pos, p, pos);
    if (vel) add(vel, v, vel);
  }
  return pos;
}

// The orbital period of a body round its parent (s).
export function period(id) {
  const b = BODIES[id];
  return b.parent ? 2 * Math.PI * Math.sqrt((b.a * b.a * b.a) / BODIES[b.parent].gm) : Infinity;
}

// ---------- Kepler's problem (universal variables) ----------

function stumpC(z) {
  if (z > 1e-6) return (1 - Math.cos(Math.sqrt(z))) / z;
  if (z < -1e-6) return (Math.cosh(Math.sqrt(-z)) - 1) / -z;
  return 0.5 - z / 24 + (z * z) / 720;
}
function stumpS(z) {
  if (z > 1e-6) {
    const s = Math.sqrt(z);
    return (s - Math.sin(s)) / (s * s * s);
  }
  if (z < -1e-6) {
    const s = Math.sqrt(-z);
    return (Math.sinh(s) - s) / (s * s * s);
  }
  return 1 / 6 - z / 120 + (z * z) / 5040;
}

// Moves state (r, v: arrays, changed in place) along its conic round a body
// of gravity mu for dt seconds. Exact for any dt (an ellipse's whole turns
// are dropped first); the caller keeps steps short for anything else that
// has to be checked along the way (the spheres of influence, the ground).
export function kepler(r, v, dt, mu, depth = 0) {
  if (dt === 0) return;
  const e0 = (dot(v, v) / 2 - mu / len(r));
  const r1 = r.slice();
  const v1 = v.slice();
  keplerStep(r1, v1, dt, mu);
  const e1 = dot(v1, v1) / 2 - mu / len(r1);
  // (a long step on an open path can lose Newton's way: checked by the
  // energy it should keep, and split in two if it didn't)
  if (depth < 14 && !(Math.abs(e1 - e0) <= 1e-6 * Math.max(Math.abs(e0), (mu / len(r)) * 1e-3))) {
    kepler(r, v, dt / 2, mu, depth + 1);
    kepler(r, v, dt / 2, mu, depth + 1);
    return;
  }
  r[0] = r1[0];
  r[1] = r1[1];
  r[2] = r1[2];
  v[0] = v1[0];
  v[1] = v1[1];
  v[2] = v1[2];
}

function keplerStep(r, v, dt, mu) {
  const r0 = len(r);
  const v0 = len(v);
  const sq = Math.sqrt(mu);
  const vr0 = dot(r, v) / r0;
  const alpha = 2 / r0 - (v0 * v0) / mu;
  if (alpha > 1e-15) {
    const P = (2 * Math.PI) / (sq * Math.pow(alpha, 1.5));
    if (Math.abs(dt) > P) dt = dt % P;
  }
  let x = (sq * dt) / r0;
  if (alpha > 1e-15) x = sq * alpha * dt;
  else if (alpha < -1e-15) {
    // (an open path: Vallado's first guess)
    const a = 1 / alpha;
    const sg = Math.sign(dt);
    const q = (-2 * mu * alpha * dt) / (dot(r, v) + sg * Math.sqrt(-mu * a) * (1 - r0 * alpha));
    if (q > 0 && Number.isFinite(q)) x = sg * Math.sqrt(-a) * Math.log(q);
  }
  let C = 0.5;
  let S = 1 / 6;
  for (let i = 0; i < 60; i++) {
    const z = alpha * x * x;
    C = stumpC(z);
    S = stumpS(z);
    const F = ((r0 * vr0) / sq) * x * x * C + (1 - alpha * r0) * x * x * x * S + r0 * x - sq * dt;
    const dF = ((r0 * vr0) / sq) * x * (1 - alpha * x * x * S) + (1 - alpha * r0) * x * x * C + r0;
    const step = F / dF;
    x -= step;
    if (!Number.isFinite(x)) return;
    if (Math.abs(step) < 1e-10 * Math.max(1, Math.abs(x))) break;
  }
  const z = alpha * x * x;
  C = stumpC(z);
  S = stumpS(z);
  const f = 1 - ((x * x) / r0) * C;
  const g = dt - (x * x * x * S) / sq;
  const nr = [f * r[0] + g * v[0], f * r[1] + g * v[1], f * r[2] + g * v[2]];
  const rn = len(nr);
  const fd = (sq / (rn * r0)) * (alpha * x * x * x * S - x);
  const gd = 1 - ((x * x) / rn) * C;
  const nv = [fd * r[0] + gd * v[0], fd * r[1] + gd * v[1], fd * r[2] + gd * v[2]];
  if (![...nr, ...nv].every(Number.isFinite)) return;
  r[0] = nr[0];
  r[1] = nr[1];
  r[2] = nr[2];
  v[0] = nv[0];
  v[1] = nv[1];
  v[2] = nv[2];
}

// The conic's shape: { a, e, rp (periapsis), ra (apoapsis, Infinity when
// open), energy, h (angular momentum vector), period }.
export function elements(r, v, mu) {
  const rn = len(r);
  const vn = len(v);
  const energy = (vn * vn) / 2 - mu / rn;
  const h = cross(r, v);
  const hn = len(h);
  const evec = sub(scale(cross(v, h), 1 / mu), scale(r, 1 / rn));
  const e = len(evec);
  const a = Math.abs(energy) > 1e-12 ? -mu / (2 * energy) : Infinity;
  const p = (hn * hn) / mu;
  const rp = p / (1 + e);
  const ra = e < 1 ? p / (1 - e) : Infinity;
  const per = e < 1 && a > 0 ? 2 * Math.PI * Math.sqrt((a * a * a) / mu) : Infinity;
  return { a, e, rp, ra, energy, h, hn, evec, period: per };
}

// ---------- Lambert's problem ----------

// The velocity needed at r1 to be at r2 after dt seconds, turning round
// the body the way the planets go (+y), and the velocity on arrival:
// { v1, v2 } or null (no solution: too short a time, a straight line).
export function lambert(r1, r2, dt, mu) {
  const n1 = len(r1);
  const n2 = len(r2);
  const c12 = cross(r1, r2);
  let cosd = dot(r1, r2) / (n1 * n2);
  cosd = Math.max(-1, Math.min(1, cosd));
  let dth = Math.acos(cosd);
  if (c12[1] < 0) dth = 2 * Math.PI - dth;
  if (Math.abs(Math.sin(dth)) < 1e-6 || dt <= 0) return null;
  const A = Math.sin(dth) * Math.sqrt((n1 * n2) / (1 - Math.cos(dth)));
  const sq = Math.sqrt(mu);
  const y = (z) => n1 + n2 + (A * (z * stumpS(z) - 1)) / Math.sqrt(stumpC(z));
  const F = (z) => {
    const yz = y(z);
    if (yz < 0) return NaN;
    return Math.pow(yz / stumpC(z), 1.5) * stumpS(z) + A * Math.sqrt(yz) - sq * dt;
  };
  // (F rises with z: a bracket, then bisection)
  let lo = -4 * Math.PI * Math.PI;
  let hi = 4 * Math.PI * Math.PI * 0.999;
  // (the low end must have y >= 0: walked up until it has)
  while (lo < hi && !(y(lo) >= 0)) lo += 0.1;
  const flo = F(lo);
  const fhi = F(hi);
  if (!(flo <= 0) || !(fhi >= 0)) return null;
  let z = 0;
  for (let i = 0; i < 100; i++) {
    z = (lo + hi) / 2;
    const f = F(z);
    if (!Number.isFinite(f)) {
      lo = z;
      continue;
    }
    if (f > 0) hi = z;
    else lo = z;
    if (hi - lo < 1e-10) break;
  }
  const yz = y(z);
  const f = 1 - yz / n1;
  const g = A * Math.sqrt(yz / mu);
  const gd = 1 - yz / n2;
  if (!Number.isFinite(g) || Math.abs(g) < 1e-12) return null;
  const v1 = [(r2[0] - f * r1[0]) / g, (r2[1] - f * r1[1]) / g, (r2[2] - f * r1[2]) / g];
  const v2 = [(gd * r2[0] - r1[0]) / g, (gd * r2[1] - r1[1]) / g, (gd * r2[2] - r1[2]) / g];
  if (![...v1, ...v2].every(Number.isFinite)) return null;
  return { v1, v2 };
}

// ---------- A spot on a planet <-> a spot in its world ----------

// One block a metre within L of the world's middle; further out the globe
// is squeezed ten to one, so the whole of it is within the world's reach.
const SQUEEZE = 10;
function edgeOf(b) {
  return Math.min(20000, b.r * 0.6);
}
// world distance -> distance over the ground
function unsqueeze(d, L) {
  const a = Math.abs(d);
  return a <= L ? d : Math.sign(d) * (L + (a - L) * SQUEEZE);
}
// distance over the ground -> world distance
function squeeze(s, L) {
  const a = Math.abs(s);
  return a <= L ? s : Math.sign(s) * (L + (a - L) / SQUEEZE);
}

// (x, z) in body's world -> { lat, lon } (radians).
export function worldToLatLon(bodyId, x, z) {
  const b = BODIES[bodyId];
  const L = edgeOf(b);
  // (beyond the squeezed globe's edge, the edge: no wrapping round)
  const lon = Math.max(-3.14, Math.min(3.14, unsqueeze(x, L) / b.r));
  const lat = Math.max(-1.5, Math.min(1.5, -unsqueeze(z, L) / b.r));
  return { lat, lon };
}

// { lat, lon } -> (x, z) in the body's world.
export function latLonToWorld(bodyId, lat, lon) {
  const b = BODIES[bodyId];
  const L = edgeOf(b);
  lon = Math.atan2(Math.sin(lon), Math.cos(lon));
  return { x: squeeze(lon * b.r, L), z: squeeze(-lat * b.r, L) };
}

// The unit vector of (lat, lon) in the body's own (unturned) frame, and
// the local east, up and south there: a world's +x, +y and +z.
export function surfaceFrame(lat, lon) {
  const cl = Math.cos(lat);
  const sl = Math.sin(lat);
  const co = Math.cos(lon);
  const so = Math.sin(lon);
  const up = [cl * so, sl, cl * co];
  const east = [co, 0, -so];
  const north = [-sl * so, cl, -sl * co];
  return { up, east, south: [-north[0], -north[1], -north[2]] };
}

// The body's turn about its axis (+y) by `spin` radians, applied to v.
export function spinVec(v, spin, o = [0, 0, 0]) {
  const c = Math.cos(spin);
  const s = Math.sin(spin);
  const x = v[0] * c + v[2] * s;
  const z = -v[0] * s + v[2] * c;
  o[0] = x;
  o[1] = v[1];
  o[2] = z;
  return o;
}

// The local frame (east, up, south: the world's x, y, z) at a position r
// relative to a body (any frame turning with it about +y).
export function localFrame(r) {
  const up = norm(r);
  let east = cross([0, 1, 0], up);
  if (len(east) < 1e-6) east = [1, 0, 0];
  else norm(east, east);
  const south = cross(east, up);
  return { east, up, south };
}

// ---------- The sphere of influence a ship is in ----------

// The innermost body whose sphere of influence holds the absolute position p
// at time t.
export function soiAt(p, t) {
  let ref = "sun";
  for (;;) {
    let next = null;
    for (const c of BODIES[ref].children) {
      const cp = absState(c, t);
      if (Math.hypot(p[0] - cp[0], p[1] - cp[1], p[2] - cp[2]) < BODIES[c].soi) {
        next = c;
        break;
      }
    }
    if (!next) return ref;
    ref = next;
  }
}

// ---------- Formatting for the HUD ----------

export function fmtDist(m) {
  const a = Math.abs(m);
  if (a < 10000) return `${Math.round(m).toLocaleString("en-US")} m`;
  if (a < 1e9) return `${Math.round(m / 1000).toLocaleString("en-US")} km`;
  return `${(m / 1e9).toFixed(a < 1e10 ? 2 : 1)} million km`;
}

export function fmtSpeed(v) {
  const a = Math.abs(v);
  if (a >= C_LIGHT * 0.5) return `${(v / C_LIGHT).toFixed(v / C_LIGHT < 10 ? 1 : 0)}c`;
  if (a < 1000) return `${Math.round(v)} m/s`;
  return `${(v / 1000).toFixed(a < 1e5 ? 2 : 0)} km/s`;
}

export function fmtTime(s) {
  if (!Number.isFinite(s) || s < 0) return "--";
  if (s < 60) return `${Math.round(s)} s`;
  if (s < 3600) return `${Math.floor(s / 60)} min ${Math.round(s % 60)} s`;
  if (s < 86400 * 2) return `${Math.floor(s / 3600)} h ${Math.round((s % 3600) / 60)} min`;
  return `${(s / 86400).toFixed(s < 86400 * 20 ? 1 : 0)} days`;
}
