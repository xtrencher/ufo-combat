// The SR-71 Blackbird (Round 16): the Mach 3 reconnaissance jet, built
// procedurally like the B-2 (b2-model.js) from smooth lofted surfaces. The
// shape itself is sr71-shape.js (in metres; the model is scaled to the
// fighters' size: 26.3 blocks long, 13.6 across):
//
//   - the body: one smooth skin from the radome's tip to the tail cone, the
//     round core blended into the chines and the inboard wing, the tandem
//     canopies (the pilot's windscreen and canopy, the reconnaissance
//     systems officer's small windows behind) on their humps, the pitot boom;
//   - the nacelles: each a long body of revolution with its inlet lip (dark
//     inside), the spike's cone ahead of it with its bleed band, and the
//     ejector nozzle at the back (scalloped flaps, a burnt-metal interior,
//     the engine's glowing nozzle deep inside);
//   - the outboard wings, their leading edges swept 52 degrees and drooped
//     toward the tips (the conical camber), the nacelle chines, the elevons;
//   - the two all-moving fins canted 15 degrees inward (they turn for yaw);
//   - the matte blue-black finish in faint panel tones, red walkway lines,
//     red serials on the fins, the white insignia and lettering on the
//     nacelles;
//   - the afterburners' long plumes with shock diamonds (and the green
//     flash of the ignition), the hot skin and heat shimmer at Mach 3, the
//     gear (two nose wheels, three-wheel main bogies), the lights.
//
// The same interface as createJetModel / createB2Model.
import * as THREE from "three";
import { createEntityMaterial, bindEntityLight } from "./shaders.js";
import { LAYER_FX } from "./layers.js";
import * as S from "./sr71-shape.js";

export { SR71_GEAR_HEIGHT, SR71_LENGTH, SR71_SPAN } from "./sr71-shape.js";

// The "iron ball" paint: a blue-black, with its few markings.
const PAL = {
  base: 0x22252c,
  dark: 0x16181c,
  aft: 0x2a2c31, // (the nacelles' hot aft end: a little lighter, burnt)
  burnt: 0x4a3f38, // the ejector's inside
  spike: 0x2b2e35,
  bleed: 0x3d4047,
  red: 0xa01c16,
  white: 0xd6d6d0,
  glass: 0x0e141a,
  steel: 0xa8adb3,
  tyre: 0x141516,
};
// (Matte: a soft sheen, faint panel lines; no livery tones.)
const FINISH = { spec: 0.14, gloss: 12, env: 0.06, grain: 0.035, panel: 0.1, panelScale: 1.1, livery: 0.0, liveryScale: 0.3, skin: { tone: 0.05, soot: 0, sootZ: 99, streaks: 0.05 } };

// ---------- Building blocks ----------

function hash2(a, b) {
  const s = Math.sin(a * 127.1 + b * 311.7) * 43758.5453;
  return s - Math.floor(s);
}
// The panels' faint tone (by a coarse grid over the plan).
function tone(x, z) {
  return 1 + (hash2(Math.floor(x / 1.1), Math.floor(z / 1.6)) - 0.5) * 0.08;
}

// A grid surface: nu x nv points from at(i, j) -> [x, y, z], coloured by
// color(p, i, j) -> THREE.Color; wound to face along hint(p) (on average).
function grid(nu, nv, at, color, hint, keep = null) {
  const pos = [];
  const col = [];
  for (let i = 0; i < nu; i++) {
    for (let j = 0; j < nv; j++) {
      const p = at(i, j);
      pos.push(p[0], p[1], p[2]);
      const c = color(p, i, j);
      col.push(c.r, c.g, c.b);
    }
  }
  const idx = [];
  const id = (i, j) => i * nv + j;
  for (let i = 0; i < nu - 1; i++) {
    for (let j = 0; j < nv - 1; j++) {
      if (keep && !keep(i, j)) continue;
      idx.push(id(i, j), id(i + 1, j), id(i + 1, j + 1), id(i, j), id(i + 1, j + 1), id(i, j + 1));
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute("color", new THREE.Float32BufferAttribute(col, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  // Facing the right way? (Most normals along the hint.)
  const n = g.getAttribute("normal");
  let score = 0;
  for (let k = 0; k < idx.length; k += 3) {
    const v = idx[k];
    const h = hint([pos[v * 3], pos[v * 3 + 1], pos[v * 3 + 2]]);
    score += n.getX(v) * h[0] + n.getY(v) * h[1] + n.getZ(v) * h[2];
  }
  if (score < 0) {
    for (let k = 0; k < idx.length; k += 3) [idx[k + 1], idx[k + 2]] = [idx[k + 2], idx[k + 1]];
    g.setIndex(idx);
    g.computeVertexNormals();
  }
  return g;
}

// Flat triangles (decals, caps), each wound along a hint direction.
class Builder {
  constructor() {
    this.pos = [];
    this.nor = [];
    this.col = [];
  }
  tri(a, b, c, color, hint) {
    const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2];
    const vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
    let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const len = Math.hypot(nx, ny, nz);
    if (len < 1e-12) return;
    if (nx * hint[0] + ny * hint[1] + nz * hint[2] < 0) {
      [b, c] = [c, b];
      nx = -nx;
      ny = -ny;
      nz = -nz;
    }
    for (const p of [a, b, c]) {
      this.pos.push(p[0], p[1], p[2]);
      this.nor.push(nx / len, ny / len, nz / len);
      this.col.push(color.r, color.g, color.b);
    }
  }
  quad(a, b, c, d, color, hint) {
    this.tri(a, b, c, color, hint);
    this.tri(a, c, d, color, hint);
  }
  geometry() {
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute("normal", new THREE.Float32BufferAttribute(this.nor, 3));
    g.setAttribute("color", new THREE.Float32BufferAttribute(this.col, 3));
    return g;
  }
}

function colorize(geo, hex) {
  const c = new THREE.Color(hex);
  const pos = geo.getAttribute("position");
  const col = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) {
    col[i * 3] = c.r;
    col[i * 3 + 1] = c.g;
    col[i * 3 + 2] = c.b;
  }
  geo.setAttribute("color", new THREE.BufferAttribute(col, 3));
  return geo;
}

function merge(list) {
  const geos = list.map((g) => (g.index ? g.toNonIndexed() : g));
  let n = 0;
  for (const g of geos) n += g.getAttribute("position").count;
  const pos = new Float32Array(n * 3);
  const nor = new Float32Array(n * 3);
  const col = new Float32Array(n * 3);
  let o = 0;
  for (const g of geos) {
    if (!g.getAttribute("normal")) g.computeVertexNormals();
    const p = g.getAttribute("position");
    const nn = g.getAttribute("normal");
    const c = g.getAttribute("color");
    for (let i = 0; i < p.count; i++, o++) {
      pos[o * 3] = p.getX(i);
      pos[o * 3 + 1] = p.getY(i);
      pos[o * 3 + 2] = p.getZ(i);
      nor[o * 3] = nn.getX(i);
      nor[o * 3 + 1] = nn.getY(i);
      nor[o * 3 + 2] = nn.getZ(i);
      col[o * 3] = c ? c.getX(i) : 1;
      col[o * 3 + 1] = c ? c.getY(i) : 1;
      col[o * 3 + 2] = c ? c.getZ(i) : 1;
    }
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  out.setAttribute("normal", new THREE.BufferAttribute(nor, 3));
  out.setAttribute("color", new THREE.BufferAttribute(col, 3));
  return out;
}

const C = (hex, k = 1) => new THREE.Color(hex).multiplyScalar(k);
const BASE = new THREE.Color(PAL.base);
const _c = new THREE.Color();
function skinColor(x, z, extra = 1) {
  return _c.copy(BASE).multiplyScalar(tone(x, z) * extra);
}

// ---------- The body ----------

const NXB = 17; // columns a side
const NZB = 92; // rows along each column
// The columns' x (both sides, through the middle): dense near the middle
// and round the core's edge, sparser out to the nacelle.
const BODY_X = (() => {
  const half = [];
  for (let i = 0; i <= NXB; i++) half.push(S.XN * Math.pow(i / NXB, 1.45));
  return [...half.slice(1).reverse().map((x) => -x), ...half];
})();
// A column's row positions: closer together near both ends and round the canopies.
function rowZ(x, j) {
  const z0 = S.zStart(Math.abs(x));
  const z1 = S.zEnd(Math.abs(x));
  const t = j / NZB;
  const u = 0.5 - 0.5 * Math.cos(Math.PI * t);
  return z0 + (z1 - z0) * (0.55 * t + 0.45 * u);
}
function bodyGeometry() {
  const nu = BODY_X.length;
  const top = grid(nu, NZB + 1, (i, j) => {
    const x = BODY_X[i];
    const z = rowZ(x, j);
    return [x, S.bodyTop(x, z), z];
  }, (p) => skinColor(p[0], p[2]), () => [0, 1, 0]);
  const bot = grid(nu, NZB + 1, (i, j) => {
    const x = BODY_X[i];
    const z = rowZ(x, j);
    return [x, S.bodyBot(x, z), z];
  }, (p) => skinColor(p[0], p[2], 0.92), () => [0, -1, 0]);
  return [top, bot];
}

// The canopies' glass: a patch over the humps, only where the windows are
// (the pilot's three-pane windscreen and the canopy's side windows, the
// back seat's small side windows), just above the skin.
function windowAt(x, z) {
  const ax = Math.abs(x);
  if (S.canopyH(x, z) < 0.06) return false;
  if (z > 5.5 && z < 6.62) return ax < 0.43 && Math.abs(ax - 0.16) > 0.028; // the windscreen (a frame each side of the flat front pane)
  if (z > 6.74 && z < 8.35) return ax > 0.15 && ax < 0.46 && Math.abs(z - 7.55) > 0.04;
  if (z > 9.25 && z < 10.35) return ax > 0.17 && ax < 0.42;
  return false;
}
function windowsGeometry() {
  const nu = 41;
  const nv = 120;
  const xs = (i) => -0.5 + i / (nu - 1);
  const zs = (j) => 5.3 + (j / (nv - 1)) * 5.4;
  const at = (i, j) => [xs(i), S.bodyTop(xs(i), zs(j)) + 0.012, zs(j)];
  return grid(nu, nv, at, () => C(PAL.glass), () => [0, 1, 0], (i, j) => windowAt((xs(i) + xs(i + 1)) / 2, (zs(j) + zs(j + 1)) / 2));
}

// ---------- The nacelles ----------

// A body of revolution round the axis (cx, cy) along z from a profile of
// [z, r] points, `nt` round; colour(z, theta).
function lathe(cx, cy, profile, nt, color, outward = 1, petals = null) {
  const hintOf = typeof outward === "function" ? outward : (p) => [outward * (p[0] - cx), outward * (p[1] - cy), 0];
  const at = (i, j) => {
    const [z, r0] = profile[i];
    const th = (j / nt) * Math.PI * 2;
    const r = r0 * (petals ? 1 + petals(z) * Math.cos(th * 16) : 1);
    return [cx + Math.cos(th) * r, cy + Math.sin(th) * r, z];
  };
  return grid(profile.length, nt + 1, at, (p, i, j) => color(profile[i][0], (j / nt) * Math.PI * 2), hintOf);
}
function nacelleGeometry(s) {
  const cx = s * S.XN;
  const cy = S.YN;
  const parts = [];
  // The outer skin, lip to exit.
  const prof = [];
  const N = 46;
  for (let i = 0; i <= N; i++) {
    const t = i / N;
    const u = 0.5 - 0.5 * Math.cos(Math.PI * t);
    const z = S.LIP_Z + (S.EXIT_Z - S.LIP_Z) * (0.5 * t + 0.5 * u);
    prof.push([z, S.nacelleR(z)]);
  }
  const petals = (z) => 0.014 * S.smooth(30.25, 30.7, z);
  parts.push(lathe(cx, cy, prof, 30, (z, th) => {
    const aft = S.smooth(27.5, 30.2, z);
    const c = skinColor(cx + Math.cos(th), z, 1 - 0.04 * Math.sin(th));
    return c.lerp(C(PAL.aft), aft * 0.7).clone();
  }, 1, petals));
  // The lip's inside: a short dark tube into the inlet.
  parts.push(lathe(cx, cy, [[S.LIP_Z - 0.004, 0.7], [S.LIP_Z + 0.25, 0.665], [S.LIP_Z + 1.6, 0.62]], 30, () => C(PAL.dark, 0.6), -1));
  // The ejector's inside (burnt metal) and the engine's nozzle deep in it.
  parts.push(lathe(cx, cy, [[S.EXIT_Z - 0.003, 0.8], [S.EXIT_Z - 0.4, 0.77], [S.EXIT_Z - 1.0, 0.72]], 30, (z) => C(PAL.burnt, 0.7 + 0.3 * S.smooth(S.EXIT_Z - 1, S.EXIT_Z, z)), -1));
  parts.push(lathe(cx, cy, [[S.EXIT_Z - 1.0, 0.72], [S.EXIT_Z - 1.0, 0.56], [S.EXIT_Z - 1.15, 0.5], [S.EXIT_Z - 1.2, 0.02]], 24, () => C(0x1b1b1d), () => [0, 0, 1]));
  // The spike: its cone ahead of the lip (the porous bleed band round it), on into the inlet.
  const sp = [];
  for (let i = 0; i <= 22; i++) {
    const z = S.SPIKE_Z + (i / 22) * (S.LIP_Z + 1.4 - S.SPIKE_Z);
    sp.push([z, Math.max(0.003, S.spikeR(z))]);
  }
  parts.push(lathe(cx, cy, sp, 24, (z) => (z > 15.05 && z < 15.75 ? C(PAL.bleed) : C(PAL.spike, z < 13.8 ? 1.2 : 1)), 1));
  return parts;
}

// ---------- The outboard wings ----------

const XE0 = S.XN + 1.05; // the elevons' inboard end
const FH = 0.84; // the hinge line (chord fraction)
const OUT_X = (() => {
  const xs = [S.XN, S.XN + 0.35, S.XN + 0.68, S.XN + 0.78, S.XN + 0.9, XE0, S.OUT_ROOT[0]];
  const n = 13;
  for (let i = 1; i <= n; i++) xs.push(S.OUT_ROOT[0] + ((S.TIP_X - S.OUT_ROOT[0]) * i) / n);
  return xs;
})();
const OUT_F = (() => {
  const fs = [];
  const n = 14;
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    fs.push(FH * (0.35 * t + 0.65 * (1 - Math.cos((Math.PI * t) / 2))));
  }
  return fs;
})();
const ELEV_F = [FH, FH + (1 - FH) * 0.35, FH + (1 - FH) * 0.7, 1];
function outerPoint(x, f, side) {
  const w = S.outerWing(x, f);
  return [x, w.camber + side * w.t, w.z];
}
// One wing's surfaces between columns xs and chord fractions fs (both faces), mirrored by s.
function wingPatch(xs, fs, s, shade = 1) {
  const out = [];
  for (const side of [1, -1]) {
    out.push(grid(xs.length, fs.length, (i, j) => {
      const p = outerPoint(xs[i], fs[j], side);
      return [s * p[0], p[1], p[2]];
    }, (p) => skinColor(p[0], p[2], (side > 0 ? 1 : 0.92) * shade), () => [0, side, 0]));
  }
  return out;
}
function outerWingGeometry(s) {
  const parts = wingPatch(OUT_X, OUT_F, s);
  parts.push(...wingPatch(OUT_X.filter((x) => x <= XE0), ELEV_F, s));
  // The tip's edge.
  const B = new Builder();
  const fs = [...OUT_F, ...ELEV_F.slice(1)];
  for (let j = 0; j < fs.length - 1; j++) {
    const a = outerPoint(S.TIP_X, fs[j], 1);
    const b = outerPoint(S.TIP_X, fs[j + 1], 1);
    const c = outerPoint(S.TIP_X, fs[j + 1], -1);
    const d = outerPoint(S.TIP_X, fs[j], -1);
    B.quad(...[a, b, c, d].map((p) => [s * p[0], p[1], p[2]]), C(PAL.base), [s, 0, 0]);
  }
  parts.push(B.geometry());
  return parts;
}
// The elevon (one a side): built round its hinge's middle; returns the pivot and the hinge's axis.
function elevonGeometry(s) {
  const xs = OUT_X.filter((x) => x >= XE0);
  const parts = wingPatch(xs, ELEV_F, s, 0.97);
  const a = outerPoint(xs[0], FH, 1);
  const b = outerPoint(xs[xs.length - 1], FH, 1);
  const pivot = [s * (a[0] + b[0]) / 2, (outerPoint(xs[0], FH, 0)[1] + outerPoint(xs[xs.length - 1], FH, 0)[1]) / 2, (a[2] + b[2]) / 2];
  const axis = new THREE.Vector3(s * (b[0] - a[0]), 0, b[2] - a[2]).normalize();
  if (axis.x < 0) axis.negate();
  const geo = merge(parts);
  geo.translate(-pivot[0], -pivot[1], -pivot[2]);
  return { geo, pivot, axis };
}

// ---------- The fins ----------

const FIN_U = [0, 0.1, 0.25, 0.4, 0.55, 0.7, 0.85, 1];
const FIN_V = (() => {
  const v = [];
  for (let i = 0; i <= 12; i++) v.push(0.5 - 0.5 * Math.cos((Math.PI * i) / 12));
  return v;
})();
function finGeometry(s) {
  const c = Math.cos(S.FIN.cant);
  const sn = Math.sin(S.FIN.cant);
  // (The fin's sideways direction: + outboard of its plane.)
  const nrm = [s * c, sn, 0];
  const parts = [];
  for (const side of [1, -1]) {
    parts.push(grid(FIN_U.length, FIN_V.length, (i, j) => S.finPoint(FIN_U[i], FIN_V[j], side * S.finThickness(FIN_U[i], FIN_V[j]), s), (p, i) => skinColor(p[1] * 3, p[2], side > 0 ? 1 : 0.95), () => [nrm[0] * side, nrm[1] * side, 0]));
  }
  // The tip.
  const B = new Builder();
  for (let j = 0; j < FIN_V.length - 1; j++) {
    const t = (v, w) => S.finPoint(1, v, w * S.finThickness(1, v), s);
    B.quad(t(FIN_V[j], 1), t(FIN_V[j + 1], 1), t(FIN_V[j + 1], -1), t(FIN_V[j], -1), C(PAL.base), [-s * sn, c, 0]);
  }
  parts.push(B.geometry());
  parts.push(serialDecal(s));
  const pz = S.FIN.pivotZ;
  const pivot = S.finPoint(0, (pz - S.FIN.z0) / (S.FIN.z1 - S.FIN.z0), 0, s);
  const axis = new THREE.Vector3(-s * sn, c, 0).normalize();
  const geo = merge(parts);
  geo.translate(-pivot[0], -pivot[1], -pivot[2]);
  return { geo, pivot, axis };
}

// ---------- Markings ----------

// A tiny 3x5 pixel font for the serials and the lettering.
const FONT = {
  0: "111101101101111", 1: "010110010010111", 2: "111001111100111", 7: "111001010010010", 9: "111101111001111", 8: "111101111101111",
  U: "101101101101111", S: "111100111001111", A: "010101111101101", I: "111010010010111", R: "110101110101101", F: "111100110100100", O: "111101101101111", C: "111100100100111", E: "111100110100111", ".": "000000000000010", " ": "000000000000000",
};
// Lays out `text` in pixels: calls px(col, row) for each lit pixel (col across, row down), returns the width in pixels.
function pixels(text, px) {
  let col = 0;
  for (const ch of text) {
    const g = FONT[ch] || FONT[" "];
    const w = ch === "." ? 2 : ch === " " ? 2 : 3;
    for (let r = 0; r < 5; r++) for (let k = 0; k < 3; k++) if (g[r * 3 + k] === "1" && k < w) px(col + k, r);
    col += w + 1;
  }
  return col - 1;
}
// The fin's serial, in red, on both faces.
function serialDecal(s) {
  const B = new Builder();
  const red = C(PAL.red);
  const text = "17972";
  const cols = pixels(text, () => {});
  const ph = 0.075; // a pixel's height (m: the digits are 0.38 m tall)
  const u0 = 0.36;
  const vMid = 0.52;
  const zSpan = 0.072; // a pixel's width along the chord (m)
  const c = Math.cos(S.FIN.cant);
  const sn = Math.sin(S.FIN.cant);
  for (const side of [1, -1]) {
    pixels(text, (k, r) => {
      // (Read from the front on the right face, mirrored on the left: written along the chord.)
      const col = side * s > 0 ? cols - 1 - k : k;
      const corner = (dc, dr) => {
        const u = u0 + ((4 - r + 1 - dr) * ph) / S.FIN.h;
        const zc = (col + dc - cols / 2) * zSpan;
        const z0 = S.FIN.z0 + u * (S.FIN.tz0 - S.FIN.z0);
        const z1 = S.FIN.z1 + u * (S.FIN.tz1 - S.FIN.z1);
        const v = vMid + zc / (z1 - z0);
        const p = S.finPoint(u, v, side * (S.finThickness(u, v) + 0.006), s);
        return p;
      };
      B.quad(corner(0, 0), corner(1, 0), corner(1, 1), corner(0, 1), red, [s * c * side, sn * side, 0]);
    });
  }
  return B.geometry();
}
// A point on a nacelle's outboard face: a along z (m), b up round it (m along the surface).
function onNacelle(s, z, b, lift = 0.008) {
  const r = S.nacelleR(z) + lift;
  const th = b / r;
  return [s * (S.XN + Math.cos(th) * r), S.YN + Math.sin(th) * r, z];
}
function nacelleMarkings(s) {
  const B = new Builder();
  const white = C(PAL.white, 0.92);
  const red = C(PAL.red);
  const hint = (p) => [p[0] - s * S.XN, p[1] - S.YN, 0];
  const quadOn = (z0, z1, b0, b1, color, lift) => {
    const a = onNacelle(s, z0, b0, lift);
    B.quad(a, onNacelle(s, z1, b0, lift), onNacelle(s, z1, b1, lift), onNacelle(s, z0, b1, lift), color, hint(a));
  };
  // The national insignia (low-key: a white ring, the star in it, the bars).
  const zc = 24.8;
  const bc = 0.46;
  const R = 0.27;
  const n = 20;
  for (let i = 0; i < n; i++) {
    const a0 = (i / n) * Math.PI * 2;
    const a1 = ((i + 1) / n) * Math.PI * 2;
    const p = (a, r) => onNacelle(s, zc + Math.cos(a) * r, bc + Math.sin(a) * r, 0.008);
    B.quad(p(a0, R * 0.78), p(a1, R * 0.78), p(a1, R), p(a0, R), white, hint(p(a0, R)));
  }
  // The star: five points.
  for (let i = 0; i < 5; i++) {
    const a = -Math.PI / 2 + (i / 5) * Math.PI * 2;
    const p = (ang, r) => onNacelle(s, zc + Math.cos(ang) * r, bc - Math.sin(ang) * r, 0.01);
    B.tri(p(0, 0), p(a - 0.63, R * 0.28), p(a, R * 0.72), white, hint(p(0, 0)));
    B.tri(p(0, 0), p(a, R * 0.72), p(a + 0.63, R * 0.28), white, hint(p(0, 0)));
  }
  // The bars either side, with their red stripe.
  for (const d of [-1, 1]) {
    quadOn(zc + d * R, zc + d * (R + 0.42), bc - 0.1, bc + 0.1, white, 0.008);
    quadOn(zc + d * (R + 0.02), zc + d * (R + 0.4), bc - 0.035, bc + 0.035, red, 0.011);
  }
  // "U.S. AIR FORCE" along the nacelle's forward side.
  const text = "U.S. AIR FORCE";
  const ph = 0.05;
  const cols = pixels(text, () => {});
  const z0 = 19.7;
  const b0 = 0.4;
  pixels(text, (k, r) => {
    // (Read left to right from outside: the front is to the left on the right nacelle.)
    const col = s > 0 ? cols - 1 - k : k;
    const za = z0 + col * ph;
    quadOn(za, za + ph, b0 + (4 - r) * ph, b0 + (5 - r) * ph, white, 0.009);
  });
  return B.geometry();
}
// The red walkway lines on top (the "no step" edges): along the spine and
// round the inboard wings.
function walkwayLines() {
  const B = new Builder();
  const red = C(PAL.red, 0.7);
  const w = 0.022;
  const line = (pts) => {
    for (let i = 0; i < pts.length - 1; i++) {
      const [x0, z0] = pts[i];
      const [x1, z1] = pts[i + 1];
      const steps = Math.max(1, Math.ceil(Math.hypot(x1 - x0, z1 - z0) / 0.35));
      const dx = x1 - x0;
      const dz = z1 - z0;
      const l = Math.hypot(dx, dz);
      const nx = (-dz / l) * w;
      const nz = (dx / l) * w;
      for (let k = 0; k < steps; k++) {
        const pa = [x0 + (dx * k) / steps, z0 + (dz * k) / steps];
        const pb = [x0 + (dx * (k + 1)) / steps, z0 + (dz * (k + 1)) / steps];
        const y = (x, z) => S.bodyTop(x, z) + 0.01;
        const a = [pa[0] - nx, y(pa[0] - nx, pa[1] - nz), pa[1] - nz];
        const b = [pb[0] - nx, y(pb[0] - nx, pb[1] - nz), pb[1] - nz];
        const c = [pb[0] + nx, y(pb[0] + nx, pb[1] + nz), pb[1] + nz];
        const d = [pa[0] + nx, y(pa[0] + nx, pa[1] + nz), pa[1] + nz];
        B.quad(a, b, c, d, red, [0, 1, 0]);
      }
    }
  };
  for (const s of [1, -1]) {
    line([[s * 0.42, 12.2], [s * 0.5, 17], [s * 0.5, 26.5]]);
    line([[s * 0.75, 19.5], [s * 2.05, 20.4], [s * 2.05, 27.6], [s * 0.75, 27.6], [s * 0.75, 19.5]]);
  }
  return B.geometry();
}

// ---------- Gear ----------

function wheel(r, w, x, y, z) {
  return [
    colorize(new THREE.CylinderGeometry(r, r, w, 16).rotateZ(Math.PI / 2).translate(x, y, z), PAL.tyre),
    colorize(new THREE.CylinderGeometry(r * 0.55, r * 0.55, w + 0.02, 10).rotateZ(Math.PI / 2).translate(x, y, z), 0x8d939a),
  ];
}
function strut(a, b, r, hex) {
  const va = new THREE.Vector3(...a);
  const vb = new THREE.Vector3(...b);
  const g = new THREE.CylinderGeometry(r, r, va.distanceTo(vb), 8);
  g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), vb.clone().sub(va).normalize()));
  g.translate((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2);
  return colorize(g, hex);
}
// The nose leg (two wheels side by side, a landing light) from its pivot at the top.
function noseGearGeometry(len, r) {
  const parts = [strut([0, 0, 0], [0, -len * 0.6, 0], 0.09, 0x9aa0a7), strut([0, -len * 0.55, 0], [0, -len, 0], 0.065, PAL.steel)];
  parts.push(strut([0, -len * 0.45, 0], [0, -0.05, -0.9], 0.045, 0x8b9096));
  parts.push(colorize(new THREE.BoxGeometry(0.5, 0.08, 0.1).translate(0, -len, 0), 0x8b9096));
  parts.push(colorize(new THREE.BoxGeometry(0.18, 0.1, 0.08).translate(0, -len * 0.6, -0.1), 0xe8ecf0));
  for (const sx of [-0.2, 0.2]) parts.push(...wheel(r, 0.2, sx, -len, 0));
  return merge(parts);
}
// A main leg: the strut, a side brace and three wheels side by side.
function mainGearGeometry(len, r, side) {
  const parts = [strut([0, 0, 0], [0, -len * 0.6, 0], 0.12, 0x9aa0a7), strut([0, -len * 0.55, 0], [0, -len + 0.05, 0], 0.09, PAL.steel)];
  parts.push(strut([0, -len * 0.45, 0], [-side * 0.8, -0.05, 0], 0.05, 0x8b9096));
  parts.push(strut([0, -len * 0.4, 0], [0, -0.05, -0.85], 0.05, 0x8b9096));
  parts.push(colorize(new THREE.BoxGeometry(1.0, 0.1, 0.12).translate(0, -len, 0), 0x8b9096));
  for (const sx of [-0.36, 0, 0.36]) parts.push(...wheel(r, 0.24, sx, -len, 0));
  return merge(parts);
}

// ---------- Textures ----------

let glowTex = null;
function softGlowTexture() {
  if (glowTex) return glowTex;
  const c = document.createElement("canvas");
  c.width = c.height = 32;
  const ctx = c.getContext("2d");
  const g = ctx.createRadialGradient(16, 16, 0, 16, 16, 16);
  g.addColorStop(0, "rgba(255,255,255,1)");
  g.addColorStop(0.4, "rgba(255,255,255,0.35)");
  g.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 32, 32);
  glowTex = new THREE.CanvasTexture(c);
  return glowTex;
}
let flameTex = null;
function flameTexture() {
  if (flameTex) return flameTex;
  const c = document.createElement("canvas");
  c.width = 16;
  c.height = 64;
  const ctx = c.getContext("2d");
  const g = ctx.createLinearGradient(0, 64, 0, 0);
  g.addColorStop(0, "rgba(255,255,255,1)");
  g.addColorStop(0.12, "rgba(255,226,170,0.95)");
  g.addColorStop(0.45, "rgba(255,130,70,0.55)");
  g.addColorStop(0.8, "rgba(230,80,140,0.18)");
  g.addColorStop(1, "rgba(120,60,255,0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 16, 64);
  flameTex = new THREE.CanvasTexture(c);
  flameTex.colorSpace = THREE.SRGBColorSpace;
  return flameTex;
}

// ---------- The model ----------

let cached = null;
function buildGeometry() {
  if (cached) return cached;
  const hullParts = [...bodyGeometry(), walkwayLines()];
  for (const s of [-1, 1]) hullParts.push(...nacelleGeometry(s), ...outerWingGeometry(s), nacelleMarkings(s));
  // The pitot boom on the nose.
  hullParts.push(colorize(new THREE.CylinderGeometry(0.018, 0.035, 1.1, 8).rotateX(Math.PI / 2).translate(0, 0.0, -0.45), 0x5a5e64));
  const hull = merge(hullParts);
  const glass = windowsGeometry();
  const fins = [-1, 1].map((s) => ({ ...finGeometry(s), side: s }));
  const elevons = [-1, 1].map((s) => ({ ...elevonGeometry(s), side: s }));
  const noseTop = S.bodyBot(0, S.NOSE_GEAR_Z);
  const mainTop = S.bodyBot(S.MAIN_GEAR_X, S.MAIN_GEAR_Z);
  const rn = 0.34;
  const rm = 0.42;
  cached = {
    hull,
    glass,
    fins,
    elevons,
    noseTop,
    mainTop,
    nose: noseGearGeometry(noseTop - S.GROUND_Y - rn, rn),
    left: mainGearGeometry(mainTop - S.GROUND_Y - rm, rm, -1),
    right: mainGearGeometry(mainTop - S.GROUND_Y - rm, rm, 1),
  };
  return cached;
}

// The triangle count (for the tests).
export function sr71Triangles() {
  const g = buildGeometry();
  let n = g.hull.getAttribute("position").count / 3 + (g.glass.index.count / 3);
  for (const f of [...g.fins, ...g.elevons]) n += f.geo.getAttribute("position").count / 3;
  return Math.round(n);
}

export function createSR71Model() {
  const g = buildGeometry();
  const shared = new Set([g.hull, g.glass, g.nose, g.left, g.right, ...g.fins.map((f) => f.geo), ...g.elevons.map((e) => e.geo)]);
  const root = new THREE.Group();
  // (The parts are in metres: the body group scales them to blocks and puts the middle at the origin.)
  const body = new THREE.Group();
  body.scale.setScalar(S.K);
  body.position.z = -S.Z0 * S.K;
  root.add(body);
  const light = { sky: 15, block: 0, flash: new THREE.Color(0, 0, 0) };
  // (The hot skin at Mach 3 adds a dull glow to the hit flash.)
  const heatTint = new THREE.Color(0, 0, 0);
  const state = { sky: 15, block: 0, flash: new THREE.Color() };
  const getState = () => {
    state.sky = light.sky;
    state.block = light.block;
    state.flash.copy(light.flash).add(heatTint);
    return state;
  };
  const hullMat = createEntityMaterial("color", null, { finish: FINISH });
  hullMat.uniforms.uFill.value = 0.45;
  const hullMesh = new THREE.Mesh(g.hull, hullMat);
  hullMesh.castShadow = true;
  bindEntityLight(hullMesh, getState);
  body.add(hullMesh);
  const canopyMesh = new THREE.Mesh(g.glass, new THREE.MeshStandardMaterial({ color: PAL.glass, metalness: 0.9, roughness: 0.16, envMapIntensity: 1 }));
  body.add(canopyMesh);
  // The moving surfaces: the all-moving fins (yaw) and the outboard elevons (pitch and roll).
  const surfaces = [];
  for (const d of [...g.fins.map((f) => ({ ...f, kind: "fin" })), ...g.elevons.map((e) => ({ ...e, kind: "elevon" }))]) {
    const m = new THREE.Mesh(d.geo, hullMat);
    m.castShadow = true;
    bindEntityLight(m, getState);
    const group = new THREE.Group();
    group.position.fromArray(d.pivot);
    group.add(m);
    body.add(group);
    surfaces.push({ group, axis: d.axis, kind: d.kind, side: d.side });
  }
  // Gear.
  const gearMat = createEntityMaterial("color");
  const mkGear = (geo, x, y, z) => {
    const m = new THREE.Mesh(geo, gearMat);
    m.position.set(x, y, z);
    m.castShadow = true;
    bindEntityLight(m, () => light);
    body.add(m);
    return m;
  };
  const gear = {
    nose: mkGear(g.nose, 0, g.noseTop, S.NOSE_GEAR_Z),
    left: mkGear(g.left, -S.MAIN_GEAR_X, g.mainTop, S.MAIN_GEAR_Z),
    right: mkGear(g.right, S.MAIN_GEAR_X, g.mainTop, S.MAIN_GEAR_Z),
  };
  let gearT = 1;
  const sprite = (color, x, y, z, size, parent = body) => {
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: softGlowTexture(), color, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, fog: false }));
    sp.layers.set(LAYER_FX);
    sp.position.set(x, y, z);
    sp.scale.setScalar(size);
    parent.add(sp);
    return sp;
  };
  // The afterburners: layered additive cones out of each ejector, with the shock diamonds.
  const flames = [];
  const NR = 0.62;
  for (const s of [-1, 1]) {
    const nx = s * S.XN;
    const ny = S.YN;
    const nz = S.EXIT_Z - 0.05;
    const cone = new THREE.ConeGeometry(NR, 1, 14, 1, true).rotateX(Math.PI / 2).translate(0, 0, 0.5);
    const flame = new THREE.Mesh(cone, new THREE.MeshBasicMaterial({ map: flameTexture(), color: new THREE.Color(3, 2, 1.4), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: true }));
    flame.position.set(nx, ny, nz);
    flame.layers.set(LAYER_FX);
    flame.renderOrder = 12;
    body.add(flame);
    const core = new THREE.Mesh(new THREE.ConeGeometry(0.34, 1, 10, 1, true).rotateX(Math.PI / 2).translate(0, 0, 0.5), new THREE.MeshBasicMaterial({ color: new THREE.Color(4, 3.6, 3), transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: true }));
    core.position.set(nx, ny, nz);
    core.layers.set(LAYER_FX);
    core.renderOrder = 13;
    body.add(core);
    const diamonds = [];
    for (let i = 0; i < 7; i++) {
      const d = sprite(new THREE.Color(3.4, 3.0, 2.2), nx, ny, nz + 1.1 + i * 1.15, 1);
      d.visible = false;
      diamonds.push(d);
    }
    // The engine's nozzle glowing deep in the ejector, and a soft halo at the exit.
    const glow = new THREE.Mesh(new THREE.CircleGeometry(0.56, 20), new THREE.MeshBasicMaterial({ color: new THREE.Color(2.5, 1.2, 0.5), fog: true, side: THREE.DoubleSide }));
    glow.position.set(nx, ny, S.EXIT_Z - 1.12);
    body.add(glow);
    const halo = sprite(new THREE.Color(2, 1.1, 0.5), nx, ny, S.EXIT_Z + 0.3, 1.5);
    // Heat shimmer behind the exit (and over the hot skin at speed).
    const shimmer = sprite(new THREE.Color(0.3, 0.2, 0.15), nx, ny + 0.2, S.EXIT_Z + 1.2, 2.2);
    shimmer.visible = false;
    flames.push({ flame, core, glow, halo, diamonds, shimmer, s });
  }
  // Lights: red and green at the wingtips, white strobes on the spine and the belly.
  const tipZ = (S.TIP_LE + S.TIP_TE) / 2;
  const nav = [
    sprite(new THREE.Color(2.4, 0.15, 0.15), -S.TIP_X + 0.1, 0.0, tipZ, 0.4),
    sprite(new THREE.Color(0.15, 2.4, 0.2), S.TIP_X - 0.1, 0.0, tipZ, 0.4),
    sprite(new THREE.Color(2.6, 2.6, 3), 0, S.bodyTop(0, 21) + 0.08, 21, 0.36),
    sprite(new THREE.Color(2.6, 2.6, 3), 0, S.bodyBot(0, 18) - 0.08, 18, 0.36),
  ];
  const noseLen = g.noseTop - S.GROUND_Y - 0.34;
  const landing = sprite(new THREE.Color(2.2, 2.2, 2), 0, -noseLen * 0.6, -0.2, 0.7, gear.nose);
  const cockpitGlow = sprite(new THREE.Color(0.1, 0.35, 0.18), 0, S.bodyTop(0, 7.2) - 0.25, 7.2, 0.5);
  for (const o of [...nav, landing, cockpitGlow]) o.visible = false;
  let abT = 0; // seconds since the afterburner lit (the ignition's green flash)
  let abWas = false;
  let lastT = 0;
  let heatK = 0;
  return {
    root,
    body,
    light,
    hull: hullMesh,
    canopy: canopyMesh,
    type: "sr71",
    length: S.SR71_LENGTH,
    span: S.SR71_SPAN,
    // The afterburners: long orange plumes, bright shock diamonds; lit, the
    // ignition's chemical (TEB) flashes green for a moment.
    setThrottle(throttle, afterburner, t) {
      const dt = Math.max(0, Math.min(0.2, t - lastT));
      lastT = t;
      if (afterburner && !abWas) abT = 0;
      abWas = afterburner;
      abT += dt;
      const teb = afterburner ? Math.max(0, 1 - abT / 0.35) : 0;
      for (const f of flames) {
        const flicker = 0.9 + Math.sin(t * 41 + f.s * 3) * 0.1;
        const len = afterburner ? 8.6 + Math.sin(t * 29 + f.s) * 0.6 : 0.5 + throttle * 2.2;
        f.flame.scale.set(afterburner ? 1.05 : 0.8, afterburner ? 1.05 : 0.8, len * flicker);
        f.flame.visible = throttle > 0.05 || afterburner;
        if (teb > 0) f.flame.material.color.setRGB(0.6, 3.2 * teb + 1.2, 0.8);
        else f.flame.material.color.setRGB(afterburner ? 3 : 3, afterburner ? 1.9 : 1.5, afterburner ? 1.4 : 0.7);
        f.flame.material.opacity = afterburner ? 1 : 0.3 + throttle * 0.45;
        f.core.visible = f.flame.visible && throttle > 0.3;
        f.core.scale.set(afterburner ? 1 : 0.7, afterburner ? 1 : 0.7, len * 0.5 * flicker);
        f.core.material.opacity = afterburner ? 0.9 : 0.3 * throttle;
        for (let i = 0; i < f.diamonds.length; i++) {
          const d = f.diamonds[i];
          d.visible = afterburner && i * 1.15 + 1.1 < len * 0.92;
          if (d.visible) {
            d.scale.setScalar((1.25 - i * 0.1) * (0.85 + 0.25 * Math.sin(t * 57 + i * 2.1)));
            d.material.color.setRGB(5 - teb * 3, 4.4 + teb, 3 - i * 0.25);
          }
        }
        const gl = 0.4 + throttle * 1.6 + (afterburner ? 2 : 0) + heatK * 1.5;
        f.glow.material.color.setRGB(gl * 1.3, gl * 0.6, gl * 0.3);
        f.halo.visible = throttle > 0.05;
        f.halo.material.color.setRGB(gl * 0.7, gl * 0.38, gl * 0.22 + (afterburner ? 0.4 : 0));
        f.halo.scale.setScalar(1.1 + throttle * 0.8 + (afterburner ? 1.2 : 0));
      }
    },
    // (Round 16) The hot skin at Mach 3 (0-1): a dull red glow over the
    // airframe, the ejectors hotter, the air shimmering behind them.
    setHeat(k, t = 0) {
      heatK = k;
      heatTint.setRGB(0.032 * k, 0.008 * k, 0.002 * k);
      for (const f of flames) {
        f.shimmer.visible = k > 0.05;
        if (f.shimmer.visible) {
          const w = 0.5 + 0.5 * Math.sin(t * 13 + f.s * 2);
          f.shimmer.material.color.setRGB(0.22 * k + 0.04 * w, 0.12 * k, 0.07 * k);
          f.shimmer.scale.set(2.4 + 1.4 * k, 1.6 + 0.6 * w, 1);
        }
      }
    },
    // The elevons pitch together and roll against each other; the fins
    // turn whole for yaw and toe out a little as air brakes.
    setControls(pitch, roll, yaw, brake = 0) {
      for (const sf of surfaces) {
        let a = 0;
        if (sf.kind === "elevon") a = -0.38 * pitch - 0.4 * roll * sf.side - 0.25 * brake;
        else a = -0.35 * yaw + 0.25 * brake * sf.side;
        sf.group.quaternion.setFromAxisAngle(sf.axis, a);
      }
    },
    setBurnt(on, t = 0) {
      canopyMesh.visible = !on;
      if (!on) return;
      for (const f of flames) {
        f.flame.visible = f.core.visible = f.halo.visible = f.shimmer.visible = false;
        for (const d of f.diamonds) d.visible = false;
      }
      for (const o of [...nav, landing, cockpitGlow]) o.visible = false;
      heatTint.setRGB(0, 0, 0);
      hullMat.uniforms.uFill.value = 0.02;
      light.flash.setRGB(0.55 + 0.25 * Math.sin(t * 17), 0.16 + 0.1 * Math.sin(t * 23 + 1), 0.02);
    },
    // 1 = wheels down: the nose leg folds forward, the main legs inward.
    setGear(down) {
      gearT = down;
      const v = down > 0.02;
      for (const m of Object.values(gear)) m.visible = v;
      gear.nose.rotation.x = (1 - down) * 1.55;
      gear.left.rotation.z = (1 - down) * -1.45;
      gear.right.rotation.z = (1 - down) * 1.45;
    },
    get gear() {
      return gearT;
    },
    setLights(t, dark = 0, active = true) {
      const on = active;
      const k = 0.45 + 0.55 * Math.min(1, dark / 0.6);
      const strobe = t % 1.3 < 0.08 || (t % 1.3 > 0.42 && t % 1.3 < 0.49);
      nav[0].visible = nav[1].visible = on;
      nav[0].material.color.setRGB(2.4 * k, 0.15 * k, 0.15 * k);
      nav[1].material.color.setRGB(0.15 * k, 2.4 * k, 0.2 * k);
      nav[2].visible = nav[3].visible = on && strobe;
      landing.visible = on && dark > 0.25 && gearT > 0.9;
      cockpitGlow.visible = on && dark > 0.3;
      hullMat.uniforms.uFill.value = 0.1 + 0.5 * dark;
    },
    get lightsOn() {
      return nav[0].visible;
    },
    dispose() {
      root.traverse((o) => {
        if (o.geometry && !o.isSprite && !shared.has(o.geometry)) o.geometry.dispose();
        if (o.material) o.material.dispose();
      });
    },
  };
}
