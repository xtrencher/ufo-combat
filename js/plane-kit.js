// (Round 22) The building blocks of the new aircraft (js/plane-models.js):
// smooth lofted fuselages, lathed nacelles, airfoil wing / fin / blade
// panels, wheels, glass, all in metres (nose toward -Z, up +Y, right +X),
// with vertex colours from a paint function (x, y, z) => hex. Every closed
// piece is turned outward by its signed volume, so a panel can be built
// along any direction (a left wing, a canted fin, a propeller blade) and
// still face out. The model's body group scales metres to blocks (K: the
// F-22's 15.2 blocks per 18.9 m, as the B-2 and the SR-71).
import * as THREE from "three";
import { LAYER_FX } from "./layers.js";

export const K = 15.2 / 18.9;

const _c = new THREE.Color();
// A paint: a hex number, or a function (x, y, z) => hex; written as the
// geometry's colour attribute (THREE.Color(hex) is already linear).
function colorAttr(pos, paint) {
  const n = pos.length / 3;
  const col = new Float32Array(n * 3);
  let last = null;
  for (let i = 0; i < n; i++) {
    const hex = typeof paint === "function" ? paint(pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2]) : paint;
    if (hex !== last) {
      _c.set(hex);
      last = hex;
    }
    col[i * 3] = _c.r;
    col[i * 3 + 1] = _c.g;
    col[i * 3 + 2] = _c.b;
  }
  return col;
}

// A closed piece: positions (flat array) and triangles (index triples),
// turned outward (its signed volume), smooth normals; `flat` caps are
// appended as their own vertices (flat shaded). Returns a non-indexed
// BufferGeometry with colour and a zero uv.
function finish(pos, idx, paint, caps = []) {
  // (Which way the body's triangles face: their normals against the way out
  // from the piece's middle, by area. The caps face out on their own.)
  const [mx, my, mz] = centerOf(pos);
  let outward = 0;
  for (let i = 0; i < idx.length; i += 3) {
    const a = idx[i] * 3;
    const b = idx[i + 1] * 3;
    const c = idx[i + 2] * 3;
    const ux = pos[b] - pos[a], uy = pos[b + 1] - pos[a + 1], uz = pos[b + 2] - pos[a + 2];
    const vx = pos[c] - pos[a], vy = pos[c + 1] - pos[a + 1], vz = pos[c + 2] - pos[a + 2];
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const dx = (pos[a] + pos[b] + pos[c]) / 3 - mx, dy = (pos[a + 1] + pos[b + 1] + pos[c + 1]) / 3 - my, dz = (pos[a + 2] + pos[b + 2] + pos[c + 2]) / 3 - mz;
    outward += nx * dx + ny * dy + nz * dz;
  }
  const all = [[pos, idx], ...caps];
  const geos = [];
  for (let k = 0; k < all.length; k++) {
    const [p, ix] = all[k];
    const index = k === 0 && outward < 0 ? ix.map((_, i) => ix[i - (i % 3) + 2 - (i % 3)]) : ix;
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(p, 3));
    g.setIndex(index);
    g.computeVertexNormals();
    geos.push(g.toNonIndexed());
  }
  const out = geos.length === 1 ? geos[0] : mergeGeos(geos);
  out.setAttribute("color", new THREE.BufferAttribute(colorAttr(out.getAttribute("position").array, paint), 3));
  if (!out.getAttribute("uv")) out.setAttribute("uv", new THREE.BufferAttribute(new Float32Array(out.getAttribute("position").count * 2), 2));
  return out;
}

// A fan cap over a ring of vertex indices (its own copies: flat shaded).
function capOf(pos, ring) {
  const p = [];
  let cx = 0;
  let cy = 0;
  let cz = 0;
  for (const i of ring) {
    p.push(pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2]);
    cx += pos[i * 3] / ring.length;
    cy += pos[i * 3 + 1] / ring.length;
    cz += pos[i * 3 + 2] / ring.length;
  }
  p.push(cx, cy, cz);
  const m = ring.length;
  const ix = [];
  for (let i = 0; i < m; i++) ix.push(m, i, (i + 1) % m);
  // (Each cap is turned on its own: outward from the piece's middle, given later.)
  return [p, ix];
}

// Turns a cap so it faces away from `center`.
function orientCap(cap, center) {
  const [p, ix] = cap;
  const n = p.length / 3 - 1;
  // The cap's normal (first triangle) against the direction from the piece's middle.
  const a = ix[0] * 3;
  const b = ix[1] * 3;
  const c = ix[2] * 3;
  const ux = p[b] - p[a], uy = p[b + 1] - p[a + 1], uz = p[b + 2] - p[a + 2];
  const vx = p[c] - p[a], vy = p[c + 1] - p[a + 1], vz = p[c + 2] - p[a + 2];
  const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
  const dx = p[n * 3] - center[0], dy = p[n * 3 + 1] - center[1], dz = p[n * 3 + 2] - center[2];
  if (nx * dx + ny * dy + nz * dz < 0) for (let i = 0; i < ix.length; i += 3) [ix[i + 1], ix[i + 2]] = [ix[i + 2], ix[i + 1]];
  return cap;
}

export function mergeGeos(list) {
  const geos = list.filter(Boolean).map((g) => (g.index ? g.toNonIndexed() : g));
  let n = 0;
  for (const g of geos) n += g.getAttribute("position").count;
  const pos = new Float32Array(n * 3);
  const nor = new Float32Array(n * 3);
  const col = new Float32Array(n * 3);
  let o = 0;
  for (const g of geos) {
    if (!g.getAttribute("normal")) g.computeVertexNormals();
    const c = g.getAttribute("position").count;
    pos.set(g.getAttribute("position").array, o * 3);
    nor.set(g.getAttribute("normal").array, o * 3);
    const ca = g.getAttribute("color");
    if (ca) col.set(ca.array, o * 3);
    else col.fill(1, o * 3, (o + c) * 3);
    o += c;
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  out.setAttribute("normal", new THREE.BufferAttribute(nor, 3));
  out.setAttribute("color", new THREE.BufferAttribute(col, 3));
  out.setAttribute("uv", new THREE.BufferAttribute(new Float32Array(n * 2), 2));
  out.computeBoundingSphere();
  return out;
}

// Catmull-Rom through key values (an even spacing of the keys assumed).
function cr(p0, p1, p2, p3, t) {
  const t2 = t * t;
  const t3 = t2 * t;
  return 0.5 * (2 * p1 + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 + (-p0 + 3 * p1 - 3 * p2 + p3) * t3);
}

// Smooth stations between key stations (each { z, ...numbers }): `per`
// rings between two keys, every number interpolated (Catmull-Rom; z
// linearly, so the rings stay in order).
export function resample(keys, per = 3) {
  const out = [];
  const names = Object.keys(keys[0]).filter((k) => typeof keys[0][k] === "number");
  for (let i = 0; i < keys.length - 1; i++) {
    const k0 = keys[Math.max(0, i - 1)];
    const k1 = keys[i];
    const k2 = keys[i + 1];
    const k3 = keys[Math.min(keys.length - 1, i + 2)];
    for (let j = 0; j < per; j++) {
      const t = j / per;
      const s = {};
      for (const n of names) s[n] = n === "z" ? k1.z + (k2.z - k1.z) * t : cr(k0[n] ?? k1[n], k1[n], k2[n], k3[n] ?? k2[n], t);
      out.push(s);
    }
  }
  out.push({ ...keys[keys.length - 1] });
  return out;
}

// A point on a station's section at angle t (0 at the top, going toward +x):
// a superellipse of half width w, height ht above the centre line yc and hb
// below, exponent e (2 an ellipse, higher boxier), its middle at x = cx.
function sectionPoint(s, t) {
  const st = Math.sin(t);
  const ct = Math.cos(t);
  const e = s.e ?? 2.2;
  const px = Math.sign(st) * Math.pow(Math.abs(st), 2 / e);
  const py = Math.sign(ct) * Math.pow(Math.abs(ct), 2 / (s.eb && ct < 0 ? s.eb : e));
  const w = Math.max(0.005, s.w);
  return [(s.cx ?? 0) + w * px, (s.yc ?? 0) + (ct >= 0 ? s.ht : s.hb) * py];
}

// A smooth body lofted through stations ({ z, w, ht, hb, yc?, cx?, e? }),
// `seg` points round each, the ends capped (flat).
export function loftBody(stations, paint, { seg = 24, per = 3, smooth = true, capStart = true, capEnd = true, half = false } = {}) {
  const st = smooth ? resample(stations, per) : stations;
  const pos = [];
  const idx = [];
  // (half: only the right half, t from 0 to PI, open on the middle: a fairing on a flat side)
  const n = half ? seg + 1 : seg;
  for (const s of st) {
    for (let i = 0; i < n; i++) {
      const t = half ? (i / seg) * Math.PI : (i / seg) * Math.PI * 2;
      const [x, y] = sectionPoint(s, t);
      pos.push(x, y, s.z);
    }
  }
  for (let r = 0; r < st.length - 1; r++) {
    for (let i = 0; i < (half ? seg : n); i++) {
      const j = half ? i + 1 : (i + 1) % n;
      const a = r * n + i;
      const b = r * n + j;
      const c = (r + 1) * n + i;
      const d = (r + 1) * n + j;
      idx.push(a, c, b, b, c, d);
    }
  }
  const caps = [];
  const mid = centerOf(pos);
  if (!half) {
    if (capStart) caps.push(orientCap(capOf(pos, [...Array(n).keys()]), mid));
    if (capEnd) caps.push(orientCap(capOf(pos, [...Array(n).keys()].map((i) => (st.length - 1) * n + i)), mid));
  }
  return finish(pos, idx, paint, caps);
}

function centerOf(pos) {
  let x = 0;
  let y = 0;
  let z = 0;
  const n = pos.length / 3;
  for (let i = 0; i < pos.length; i += 3) {
    x += pos[i] / n;
    y += pos[i + 1] / n;
    z += pos[i + 2] / n;
  }
  return [x, y, z];
}

// A lathed body round an axis along Z through (cx, cy): profile [[z, r]],
// `seg` points round; `squash` scales it vertically (an oval nacelle).
export function lathe(profile, paint, { cx = 0, cy = 0, seg = 18, squash = 1, capStart = true, capEnd = true } = {}) {
  return loftBody(profile.map(([z, r]) => ({ z, w: r, ht: r * squash, hb: r * squash, yc: cy, cx, e: 2 })), paint, { seg, smooth: false, capStart, capEnd });
}

// A lathe along any axis: built along Z, then turned onto `dir` and moved to `at`.
export function latheAlong(profile, paint, at, dir, opts = {}) {
  const g = lathe(profile, paint, opts);
  const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), new THREE.Vector3(...dir).normalize());
  g.applyQuaternion(q);
  g.translate(at[0], at[1], at[2]);
  return g;
}

// A symmetric airfoil's half thickness at chord fraction u (NACA 00xx, t the thickness ratio).
function naca(u, t) {
  u = Math.max(0, Math.min(1, u));
  return 5 * t * (0.2969 * Math.sqrt(u) - 0.126 * u - 0.3516 * u * u + 0.2843 * u * u * u - 0.1036 * u * u * u * u);
}

// A lifting panel (a wing, a tail, a fin, a blade) through spanwise
// sections { le: [x, y, z] (the leading edge), chord, t (thickness ratio),
// dir?: the chord's direction (default +Z), thick?: the thickness's
// direction (default: chord x span) }; the chord fraction from..to (a
// control surface is the panel from 0.75 to 1, the fixed part 0 to 0.75);
// `camber` (fraction of the chord) bends it toward the thickness direction.
export function panel(sections, paint, { from = 0, to = 1, steps = 9, camber = 0, minT = 0.012, roundLE = true } = {}) {
  const pos = [];
  const idx = [];
  const us = [];
  for (let i = 0; i <= steps; i++) {
    const k = i / steps;
    us.push(from + (to - from) * (roundLE && from === 0 ? k * k * (1.4 - 0.4 * k) : k)); // (crowded at the nose)
  }
  const ring = [];
  for (let i = us.length - 1; i >= 0; i--) ring.push([us[i], 1]);
  for (let i = from === 0 ? 1 : 0; i < us.length; i++) ring.push([us[i], -1]);
  const m = ring.length;
  const V = (a) => new THREE.Vector3(...a);
  for (let si = 0; si < sections.length; si++) {
    const s = sections[si];
    const le = V(s.le);
    const dir = V(s.dir || [0, 0, 1]).normalize();
    // The span direction: toward the next section (the last: from the one before).
    const o = sections[si === sections.length - 1 ? si - 1 : si + 1];
    const span = si === sections.length - 1 ? le.clone().sub(V(o.le)) : V(o.le).sub(le);
    span.addScaledVector(dir, -span.dot(dir)).normalize();
    const th = s.thick ? V(s.thick).normalize() : new THREE.Vector3().crossVectors(dir, span).normalize();
    for (const [u, side] of ring) {
      const half = Math.max(naca(u, s.t), minT * s.chord * 0.5 / s.chord) * s.chord;
      const cam = camber * s.chord * 4 * u * (1 - u);
      const p = le.clone().addScaledVector(dir, u * s.chord).addScaledVector(th, cam + side * half);
      pos.push(p.x, p.y, p.z);
    }
  }
  for (let r = 0; r < sections.length - 1; r++) {
    for (let i = 0; i < m; i++) {
      const j = (i + 1) % m;
      idx.push(r * m + i, (r + 1) * m + i, r * m + j, r * m + j, (r + 1) * m + i, (r + 1) * m + j);
    }
  }
  const mid = centerOf(pos);
  const caps = [orientCap(capOf(pos, [...Array(m).keys()]), mid), orientCap(capOf(pos, [...Array(m).keys()].map((i) => (sections.length - 1) * m + i)), mid)];
  return finish(pos, idx, paint, caps);
}

// A box (centre, size), flat shaded.
export function box(cx, cy, cz, sx, sy, sz, paint) {
  const g = new THREE.BoxGeometry(sx, sy, sz).toNonIndexed();
  g.translate(cx, cy, cz);
  g.setAttribute("color", new THREE.BufferAttribute(colorAttr(g.getAttribute("position").array, paint), 3));
  g.deleteAttribute("uv");
  g.setAttribute("uv", new THREE.BufferAttribute(new Float32Array(g.getAttribute("position").count * 2), 2));
  return g;
}

// A flat polygon plate (outline [[a, b]] in a plane) `t` thick: `axes`
// picks the plane ("xz": a = x, b = z, thickness along y; "yz": a = y,
// b = z, thickness along x; "xy"), at `off` along the thickness axis.
export function plate(outline, t, paint, axes = "xz", off = 0) {
  const shape = new THREE.Shape(outline.map(([a, b]) => new THREE.Vector2(a, b)));
  const g = new THREE.ExtrudeGeometry(shape, { depth: t, bevelEnabled: false }).toNonIndexed();
  // Shape x/y, extruded along +z: put the thickness on the right axis.
  const p = g.getAttribute("position");
  for (let i = 0; i < p.count; i++) {
    const a = p.getX(i);
    const b = p.getY(i);
    const c = p.getZ(i) - t / 2 + off;
    if (axes === "xz") p.setXYZ(i, a, c, b);
    else if (axes === "yz") p.setXYZ(i, c, a, b);
    else p.setXYZ(i, a, b, c);
  }
  // (The swap of two axes mirrors it: turn the triangles back outward; "yz"
  // is a cyclic shift, a rotation.)
  if (axes === "xz") {
    for (let i = 0; i < p.count; i += 3) {
      const x = p.getX(i + 1), y = p.getY(i + 1), z = p.getZ(i + 1);
      p.setXYZ(i + 1, p.getX(i + 2), p.getY(i + 2), p.getZ(i + 2));
      p.setXYZ(i + 2, x, y, z);
    }
  }
  g.computeVertexNormals();
  g.setAttribute("color", new THREE.BufferAttribute(colorAttr(p.array, paint), 3));
  g.deleteAttribute("uv");
  g.setAttribute("uv", new THREE.BufferAttribute(new Float32Array(p.count * 2), 2));
  return g;
}

// A cylinder between two points (a strut, a barrel, a gear leg).
export function rod(a, b, r, paint, seg = 8, r2 = r) {
  const A = new THREE.Vector3(...a);
  const B = new THREE.Vector3(...b);
  const len = A.distanceTo(B);
  const g = new THREE.CylinderGeometry(r2, r, len, seg, 1, false).toNonIndexed();
  g.translate(0, len / 2, 0);
  g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), B.clone().sub(A).normalize()));
  g.translate(A.x, A.y, A.z);
  g.setAttribute("color", new THREE.BufferAttribute(colorAttr(g.getAttribute("position").array, paint), 3));
  g.deleteAttribute("uv");
  g.setAttribute("uv", new THREE.BufferAttribute(new Float32Array(g.getAttribute("position").count * 2), 2));
  return g;
}

// A sphere (a helmet, a sensor ball, a light housing).
export function ball(cx, cy, cz, r, paint, sy = 1) {
  const g = new THREE.SphereGeometry(r, 12, 8).toNonIndexed();
  g.scale(1, sy, 1);
  g.translate(cx, cy, cz);
  g.setAttribute("color", new THREE.BufferAttribute(colorAttr(g.getAttribute("position").array, paint), 3));
  g.deleteAttribute("uv");
  g.setAttribute("uv", new THREE.BufferAttribute(new Float32Array(g.getAttribute("position").count * 2), 2));
  return g;
}

// A wheel: the tyre (a torus-ish lathe) and the hub, its axle along X, centred at the origin.
export function wheel(r, w, tyre = 0x1d1d1e, hub = 0x8e9399) {
  const prof = [];
  const n = 10;
  for (let i = 0; i <= n; i++) {
    const a = (i / n) * Math.PI;
    prof.push([-Math.cos(a) * w * 0.5, r * (0.62 + 0.38 * Math.sin(a))]);
  }
  const g = lathe(prof, (x, y, z) => (Math.hypot(x, y) < r * 0.66 ? hub : tyre), { seg: 16 });
  g.rotateY(Math.PI / 2);
  return g;
}

// A five-pointed star outline (an insignia), radius r, centred.
export function starOutline(r, cx = 0, cy = 0, rot = 0) {
  const out = [];
  for (let i = 0; i < 10; i++) {
    const a = rot + (i * Math.PI) / 5;
    const rr = i % 2 ? r * 0.382 : r;
    out.push([cx + Math.sin(a) * rr, cy + Math.cos(a) * rr]);
  }
  return out;
}

// A disc outline (n points).
export function discOutline(r, cx = 0, cy = 0, n = 20) {
  const out = [];
  for (let i = 0; i < n; i++) out.push([cx + Math.cos((i / n) * Math.PI * 2) * r, cy + Math.sin((i / n) * Math.PI * 2) * r]);
  return out;
}

// Hash noise for camouflage: a value 0..1 per cell of size `s` (x, z), smooth-ish.
export function hash2(a, b) {
  const s = Math.sin(a * 127.1 + b * 311.7) * 43758.5453;
  return s - Math.floor(s);
}
export function vnoise(x, y) {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const xf = x - xi;
  const yf = y - yi;
  const u = xf * xf * (3 - 2 * xf);
  const v = yf * yf * (3 - 2 * yf);
  const a = hash2(xi, yi);
  const b = hash2(xi + 1, yi);
  const c = hash2(xi, yi + 1);
  const d = hash2(xi + 1, yi + 1);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}

// ---------- Effects: textures and sprites ----------

let glowTex = null;
export function softGlowTexture() {
  if (glowTex) return glowTex;
  const c = document.createElement("canvas");
  c.width = c.height = 32;
  const ctx = c.getContext("2d");
  const g = ctx.createRadialGradient(16, 16, 0, 16, 16, 16);
  g.addColorStop(0, "rgba(255,255,255,1)");
  g.addColorStop(0.3, "rgba(255,255,255,0.55)");
  g.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 32, 32);
  glowTex = new THREE.CanvasTexture(c);
  return glowTex;
}

let flameTex = null;
export function flameTexture() {
  if (flameTex) return flameTex;
  const c = document.createElement("canvas");
  c.width = 32;
  c.height = 64;
  const ctx = c.getContext("2d");
  const g = ctx.createLinearGradient(0, 0, 0, 64);
  g.addColorStop(0, "rgba(255,255,255,1)");
  g.addColorStop(0.35, "rgba(255,200,140,0.8)");
  g.addColorStop(1, "rgba(255,120,40,0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 32, 64);
  flameTex = new THREE.CanvasTexture(c);
  return flameTex;
}

// A blurred propeller disc's texture: faint, a little brighter toward the tips.
let discTex = null;
export function propDiscTexture() {
  if (discTex) return discTex;
  const c = document.createElement("canvas");
  c.width = c.height = 64;
  const ctx = c.getContext("2d");
  const g = ctx.createRadialGradient(32, 32, 4, 32, 32, 32);
  g.addColorStop(0, "rgba(40,40,40,0.0)");
  g.addColorStop(0.25, "rgba(40,40,40,0.35)");
  g.addColorStop(0.85, "rgba(60,60,60,0.5)");
  g.addColorStop(0.93, "rgba(230,200,60,0.55)");
  g.addColorStop(1, "rgba(60,60,60,0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 64, 64);
  discTex = new THREE.CanvasTexture(c);
  return discTex;
}

export function glowSprite(color, size) {
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: softGlowTexture(), color, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, fog: false }));
  sp.layers.set(LAYER_FX);
  sp.scale.setScalar(size);
  return sp;
}
