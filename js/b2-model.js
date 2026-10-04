// The B-2 Spirit stealth bomber (Round 8; Round 10: rebuilt after the real
// aircraft), built procedurally like the fighters (jet-model.js): a flying
// wing with no fuselage and no tail. The shape itself (the twelve-edge
// planform, the blended section) is in b2-shape.js; this builds it:
//
//   - the skin: a grid over the planform with spanwise stations through
//     every corner and feature and chordwise rows that follow the trailing
//     edge, smooth-shaded, the dark grey in subtle patches of tone;
//   - on top: the four-pane windscreen with its dark frame and the crew
//     hatches behind it, the two intake hoods with jagged lips beside the
//     hump (the auxiliary inlet doors on them), the recessed exhaust troughs
//     with their sooty heat-shield decks, sawtooth-edged access panels;
//   - control surfaces: per side two elevons on the outer segment and one on
//     the next, the split drag rudders on the outermost segment (the halves
//     open apart for yaw and as air brakes), the beaver tail in the middle;
//   - underneath: the sawtooth-edged weapon bay and gear doors; with the
//     gear down the doors hang open over dark wells, the nose gear (two
//     wheels, a landing light) and the main gears (four-wheel bogies, braces);
//   - lights: red and green at the wingtips, white strobes on the spine and
//     the belly, the cockpit's glow at night, the engines' heat shimmer.
//
// The same interface as createJetModel. Model space: nose toward -Z, up +Y,
// right +X; 44.5 blocks of span and 17.8 of length (the real thing is
// 52.4 m by 21.0 m: the same scale as the fighters).
import * as THREE from "three";
import { createEntityMaterial, bindEntityLight } from "./shaders.js";
import { LAYER_FX } from "./layers.js";
import { B2_SPAN, B2_LENGTH, S, K, TE, A1, A2, A3, A4, TIP_LE_Z, HINGE_Z, XT0, XT1, DN, XI0, XI1, LIP_Z, LIP_TEETH, leZ, teZ, b2Section, b2Surface, lipZ, intakeHood, intakeLipHeight } from "./b2-shape.js";

export { B2_SPAN, B2_LENGTH, b2Surface };

// The colour schemes (Round 8): the B-2's dark grey, and darker takes on
// the fighters' schemes.
export const B2_PAINTS = {
  gray: { base: 0x3d4248, dark: 0x2c3035, light: 0x575d64, deck: 0x7a7f86, glass: 0x1b2026 },
  green: { base: 0x3e4636, dark: 0x2c3227, light: 0x56604a, deck: 0x7c8270, glass: 0x1b2118 },
  lightblue: { base: 0x5f7180, dark: 0x485764, light: 0x7a8d9c, deck: 0x9aa7b2, glass: 0x1c2630 },
  desert: { base: 0x7d6e58, dark: 0x5f5444, light: 0x968771, deck: 0xa49784, glass: 0x231e18 },
  navy: { base: 0x2f3a4d, dark: 0x222a39, light: 0x45526a, deck: 0x6f7a8c, glass: 0x161c26 },
  arctic: { base: 0x9aa2aa, dark: 0x7b838b, light: 0xb7bec5, deck: 0xc4c9ce, glass: 0x1f262d },
};
// (The coating is smooth: faint generic panel lines, the B-2's own sawtooth
// panels drawn on; the soot is baked in around the exhaust decks.)
const FINISH = { spec: 0.22, gloss: 18, env: 0.08, grain: 0.03, panel: 0.06, panelScale: 0.8, livery: 0.07, liveryScale: 0.12, skin: { tone: 0.05, soot: 0, sootZ: 99, streaks: 0.04 } };

export const B2_GEAR_HEIGHT = 2.6; // the centre's height over the wheels' bottom
const NOSE_GEAR = [0, -4.6]; // x, z of the gear legs' pivots (vehicle-jet.js GEAR_LAYOUT)
const MAIN_GEAR = [5.2, 0.6];

// ---------- Building blocks ----------

// Triangles with flat normals and colours; each triangle is wound to face
// along `hint` (a rough outward direction), so callers needn't care.
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
    if (len < 1e-9) return;
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
  // A polygon (star-shaped around its centroid), as a fan.
  poly(pts, color, hint) {
    const m = [0, 0, 0];
    for (const p of pts) for (let k = 0; k < 3; k++) m[k] += p[k] / pts.length;
    for (let i = 0; i < pts.length; i++) this.tri(m, pts[i], pts[(i + 1) % pts.length], color, hint);
  }
  geometry() {
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute("normal", new THREE.Float32BufferAttribute(this.nor, 3));
    g.setAttribute("color", new THREE.Float32BufferAttribute(this.col, 3));
    return g;
  }
}

function colorize(geo, hex, shadeFn = null) {
  const c = new THREE.Color(hex);
  const pos = geo.getAttribute("position");
  const col = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) {
    const k = shadeFn ? shadeFn(pos.getX(i), pos.getY(i), pos.getZ(i)) : 1;
    col[i * 3] = c.r * k;
    col[i * 3 + 1] = c.g * k;
    col[i * 3 + 2] = c.b * k;
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

function hash2(a, b) {
  const s = Math.sin(a * 127.1 + b * 311.7) * 43758.5453;
  return s - Math.floor(s);
}
// The coating's patches: cells aligned with the two leading edges (like
// the real panels), each a shade lighter or darker.
function tone(x, z) {
  return 1 + (hash2(Math.floor((z - K * x) / 2.6), Math.floor((z + K * x) / 2.6)) - 0.5) * 0.07;
}

// ---------- The skin ----------

const EC = 1.35; // the elevons' chord (and the hinge row's depth where there are none)
// The hinge row's depth ahead of the trailing edge at |x|: the beaver
// tail's straight hinge in the middle, the elevons' chord, tapering over the
// drag rudders' segment to the cut tip.
function hingeDepth(ax) {
  if (ax < A4) return (A4 - ax) * K;
  if (ax <= A1) return EC;
  return Math.min(EC - ((EC - 0.6) * (ax - A1)) / (S - A1), 0.55 * (teZ(ax) - leZ(ax)));
}
const SEAM = (A2 + 0.3 + A1 - 0.35) / 2; // between the outboard and middle elevons
// The moving surfaces, by |x| span (the beaver tail spans both sides).
const SPANS = [
  { kind: "tail", lo: -(A4 - 0.25), hi: A4 - 0.25 },
  { kind: "elevon2", lo: A3 + 0.35, hi: A2 - 0.3 },
  { kind: "elevon", lo: A2 + 0.3, hi: SEAM - 0.03 },
  { kind: "elevon", lo: SEAM + 0.03, hi: A1 - 0.35 },
  { kind: "rudder", lo: A1 + 0.45, hi: S - 1.0 },
];
// The rows across the chord: fractions of the way from the leading edge to
// the hinge row (denser at the nose), with rows exactly at the exhaust
// nozzles (a double row: the colour changes there) and the deck's start;
// then the hinge row and two behind it.
const C4 = TE[4][1] - leZ(A4); // the chord along the inner segment (constant)
const wAt = (d) => (C4 - d) / (C4 - EC);
const ROWS = (() => {
  const w = [];
  const NF = 19;
  for (let j = 0; j <= NF; j++) w.push((j / NF) ** 1.75);
  const nozzle = [wAt(DN + 0.002), wAt(DN), wAt(DN - 0.06), wAt(DN - 0.3)];
  const all = [...w.filter((v) => nozzle.every((n) => Math.abs(v - n) > 0.012)), ...nozzle].sort((a, b) => a - b);
  return { front: all, nozzle, rear: [0.5, 1] };
})();
// The spanwise stations (positive x; mirrored): every corner and feature,
// filled in between (closer over the body).
const STATIONS = (() => {
  const feat = [0, A4 - 0.25, XT0, XT0 + 0.18, XT1 - 0.18, XT1, A3, A2, A1, S - 0.3, S];
  for (const sp of SPANS) if (sp.lo >= 0) feat.push(sp.lo, sp.hi);
  feat.push(SEAM);
  const xs = [...feat];
  for (let x = 0.45; x < 8; x += 0.45) if (feat.every((f) => Math.abs(f - x) > 0.18)) xs.push(x);
  for (let x = 8.8; x < S; x += 1.05) if (feat.every((f) => Math.abs(f - x) > 0.35)) xs.push(x);
  xs.sort((a, b) => a - b);
  const out = [];
  for (const x of xs) {
    // (The inner notch twice: the beaver tail's hinge ends there and the elevons' begins.)
    if (Math.abs(x - A4) < 1e-6) continue;
    if (x > A4 && (out.length === 0 || out[out.length - 1].x < A4)) {
      out.push({ x: A4, dh: 0 }, { x: A4, dh: EC });
    }
    out.push({ x, dh: hingeDepth(x) });
  }
  const neg = out
    .slice(1)
    .reverse()
    .map((s) => ({ x: -s.x, dh: s.dh }));
  return [...neg, ...out];
})();
function spanOf(x0, x1) {
  const lo = Math.min(x0, x1);
  const hi = Math.max(x0, x1);
  for (const sp of SPANS) {
    if (lo >= sp.lo - 1e-6 && hi <= sp.hi + 1e-6) return sp;
    if (sp.lo >= 0 && lo >= -sp.hi - 1e-6 && hi <= -sp.lo + 1e-6) return sp;
  }
  return null;
}
// The grid's points: [station][row] = { x, z, top, bot, deck, d }.
const GRID = STATIONS.map(({ x, dh }) => {
  const ax = Math.abs(x);
  const z0 = leZ(ax);
  const z1 = teZ(ax);
  const zh = z1 - dh;
  const zs = [...ROWS.front.map((w) => z0 + (zh - z0) * w), ...ROWS.rear.map((r) => zh + dh * r)];
  return zs.map((z) => {
    const s = b2Section(x, z);
    return { x, z, top: s.top, bot: s.bot, deck: s.deck, d: z1 - z };
  });
});
const NR = ROWS.front.length + ROWS.rear.length;
const JH = ROWS.front.length - 1; // the hinge row
const JN = ROWS.nozzle.map((w) => ROWS.front.indexOf(w)); // the nozzle rows

function skinGeometry(pal) {
  const cBase = new THREE.Color(pal.base);
  const cLight = new THREE.Color(pal.light);
  const cDark = new THREE.Color(pal.dark);
  const cDeck = new THREE.Color(pal.deck);
  const cSoot = new THREE.Color(0x1e1d1c);
  const cNozzle = new THREE.Color(0x0b0c0e);
  const tmp = new THREE.Color();
  const tmp2 = new THREE.Color();
  const topColor = (p, j) => {
    const ax = Math.abs(p.x);
    const u = j / (NR - 1);
    tmp.copy(cBase).multiplyScalar(tone(p.x, p.z));
    // A lighter leading edge strip; the aft areas a touch darker.
    if (j <= 1) tmp.lerp(cLight, j === 0 ? 0.6 : 0.3);
    else tmp.lerp(cDark, Math.max(0, u - 0.7) * 0.5);
    if (ax > A4 && ax < A3 && ax >= XT0 && ax <= XT1) {
      const side = Math.min(1, (ax - XT0) / 0.18, (XT1 - ax) / 0.18);
      if (j === JN[1] || j === JN[2]) tmp.lerp(cNozzle, side);
      else if (p.deck > 0) {
        // The heat-shield deck: sooty by the nozzles, lighter toward the edge, a few streaks.
        const clean = Math.min(1, Math.max(0, (DN - 0.3 - p.d) / 1.6));
        tmp2.copy(cSoot).lerp(cDeck, 0.3 + 0.45 * clean);
        tmp2.multiplyScalar(0.94 + 0.12 * hash2(Math.floor(ax * 2.2), 7));
        tmp.lerp(tmp2, p.deck);
      }
    }
    return tmp;
  };
  const botColor = (p) => tmp.copy(cDark).multiplyScalar(0.95 * tone(p.x, p.z + 1.3));
  const parts = [];
  for (const side of ["top", "bot"]) {
    const pos = [];
    const col = [];
    for (let i = 0; i < GRID.length; i++) {
      for (let j = 0; j < NR; j++) {
        const p = GRID[i][j];
        pos.push(p.x, side === "top" ? p.top : p.bot, p.z);
        const c = side === "top" ? topColor(p, j) : botColor(p);
        col.push(c.r, c.g, c.b);
      }
    }
    const idx = [];
    for (let i = 0; i < GRID.length - 1; i++) {
      if (GRID[i][0].x === GRID[i + 1][0].x) continue;
      const moving = spanOf(GRID[i][0].x, GRID[i + 1][0].x);
      const jEnd = moving ? JH : NR - 1;
      for (let j = 0; j < jEnd; j++) {
        const a = i * NR + j, b = (i + 1) * NR + j, c = (i + 1) * NR + j + 1, d = i * NR + j + 1;
        // (Winding: the top faces up, the bottom down.)
        if (side === "top") idx.push(a, d, b, b, d, c);
        else idx.push(a, b, d, b, c, d);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute("color", new THREE.Float32BufferAttribute(col, 3));
    g.setIndex(idx);
    g.computeVertexNormals();
    parts.push(g);
  }
  // Behind the moving surfaces: the hinge wall and the ends of the cut-out, dark.
  const B = new Builder();
  const cGap = new THREE.Color(pal.dark).multiplyScalar(0.55);
  const P = (p, y) => [p.x, y, p.z];
  for (let i = 0; i < GRID.length - 1; i++) {
    const g0 = GRID[i], g1 = GRID[i + 1];
    if (g0[0].x === g1[0].x) continue;
    const moving = spanOf(g0[0].x, g1[0].x);
    if (moving) B.quad(P(g0[JH], g0[JH].top), P(g1[JH], g1[JH].top), P(g1[JH], g1[JH].bot), P(g0[JH], g0[JH].bot), cGap, [0, 0, 1]);
    // An end of a cut-out: the section from the hinge back, facing into it.
    const prev = i > 0 && GRID[i - 1][0].x !== g0[0].x ? spanOf(GRID[i - 1][0].x, g0[0].x) : null;
    if (moving !== prev) {
      const hint = moving ? [1, 0, 0] : [-1, 0, 0];
      for (let j = JH; j < NR - 1; j++) B.quad(P(g0[j], g0[j].top), P(g0[j + 1], g0[j + 1].top), P(g0[j + 1], g0[j + 1].bot), P(g0[j], g0[j].bot), cGap, hint);
    }
  }
  parts.push(B.geometry());
  return parts;
}

// A moving surface over stations [i0, i1] of the grid, behind the hinge
// row: "full", or one half of a split rudder ("upper" / "lower", parted
// along the mid-plane). { geo (in hinge space), pivot, axis }.
function surfaceGeometry(pal, i0, i1, part) {
  const g0 = GRID[i0][JH];
  const g1 = GRID[i1][JH];
  const pivot = [(g0.x + g1.x) / 2, (g0.top + g0.bot + g1.top + g1.bot) / 4, (g0.z + g1.z) / 2];
  const axis = new THREE.Vector3(g1.x - g0.x, (g1.top + g1.bot - g0.top - g0.bot) / 2, g1.z - g0.z).normalize();
  const B = new Builder();
  const cTop = new THREE.Color(pal.base).multiplyScalar(0.93);
  const cBot = new THREE.Color(pal.dark).multiplyScalar(0.9);
  const cEdge = new THREE.Color(pal.dark).multiplyScalar(0.6);
  const mid = (p) => (p.top + p.bot) / 2;
  const hiY = (p) => (part === "lower" ? mid(p) : p.top);
  const loY = (p) => (part === "upper" ? mid(p) : p.bot);
  const R = (p, y) => [p.x - pivot[0], y - pivot[1], p.z - pivot[2]];
  // The upper and lower skins, smooth-shaded like the wing's.
  const skins = [];
  for (const up of [true, false]) {
    const c = up ? (part === "lower" ? cEdge : cTop) : part === "upper" ? cEdge : cBot;
    const pos = [];
    const col = [];
    const idx = [];
    const n = NR - JH;
    let cols = 0;
    for (let i = i0; i <= i1; i++) {
      if (i > i0 && GRID[i][0].x === GRID[i - 1][0].x) continue;
      for (let j = JH; j < NR; j++) {
        pos.push(...R(GRID[i][j], up ? hiY(GRID[i][j]) : loY(GRID[i][j])));
        col.push(c.r, c.g, c.b);
      }
      if (cols > 0) {
        for (let j = 0; j < n - 1; j++) {
          const a = (cols - 1) * n + j, b = cols * n + j, cc = cols * n + j + 1, d = (cols - 1) * n + j + 1;
          if (up) idx.push(a, d, b, b, d, cc);
          else idx.push(a, b, d, b, cc, d);
        }
      }
      cols++;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute("color", new THREE.Float32BufferAttribute(col, 3));
    g.setIndex(idx);
    g.computeVertexNormals();
    skins.push(g);
  }
  // The front face (seen when it's deflected).
  for (let i = i0; i < i1; i++) {
    if (GRID[i][0].x === GRID[i + 1][0].x) continue;
    const a = GRID[i][JH], b = GRID[i + 1][JH];
    B.quad(R(a, hiY(a)), R(b, hiY(b)), R(b, loY(b)), R(a, loY(a)), cEdge, [0, 0, -1]);
  }
  // The ends.
  for (const [i, hint] of [[i0, [-1, 0, 0]], [i1, [1, 0, 0]]]) {
    const g = GRID[i];
    for (let j = JH; j < NR - 1; j++) B.quad(R(g[j], hiY(g[j])), R(g[j + 1], hiY(g[j + 1])), R(g[j + 1], loY(g[j + 1])), R(g[j], loY(g[j])), cEdge, hint);
  }
  return { geo: merge([...skins, B.geometry()]), pivot, axis };
}

// ---------- Details on the skin ----------

const _sec = { top: 0, bot: 0, deck: 0 };
function topAt(x, z) {
  const s = b2Section(x, Math.min(teZ(Math.abs(x)), Math.max(leZ(Math.abs(x)), z)), _sec);
  return s ? s.top + intakeHood(x, z) : 0;
}
function botAt(x, z) {
  const s = b2Section(x, Math.min(teZ(Math.abs(x)), Math.max(leZ(Math.abs(x)), z)), _sec);
  return s ? s.bot : 0;
}
// A thin line drawn on the skin (on top or underneath) along a polyline of
// [x, z] points: panel seams, door outlines, the windscreen's frame.
function line(B, pts, w, side, color, lift = 0.022, closed = false) {
  const surf = side > 0 ? topAt : botAt;
  const list = closed ? [...pts, pts[0]] : pts;
  for (let k = 0; k < list.length - 1; k++) {
    const [ax, az] = list[k];
    const [bx, bz] = list[k + 1];
    const len = Math.hypot(bx - ax, bz - az);
    if (len < 1e-6) continue;
    const dx = (bx - ax) / len, dz = (bz - az) / len;
    const px = -dz * (w / 2), pz = dx * (w / 2);
    // (Each piece runs on half a width past its ends: no gaps at the corners.)
    const n = Math.max(1, Math.ceil(len / 0.4));
    for (let q = 0; q < n; q++) {
      const t0 = q === 0 ? -w / 2 / len : q / n;
      const t1 = q === n - 1 ? 1 + w / 2 / len : (q + 1) / n;
      const x0 = ax + (bx - ax) * t0, z0 = az + (bz - az) * t0;
      const x1 = ax + (bx - ax) * t1, z1 = az + (bz - az) * t1;
      const v = (x, z) => [x, surf(x, z) + side * lift, z];
      B.quad(v(x0 + px, z0 + pz), v(x1 + px, z1 + pz), v(x1 - px, z1 - pz), v(x0 - px, z0 - pz), color, [0, side, 0]);
    }
  }
}
// A panel outline with sawtooth front and back edges (the B-2's doors and
// access panels: every edge parallel to one of the leading edges), as a
// closed [x, z] polyline over [x0, x1] x [z0, z1].
function sawPanel(x0, x1, z0, z1, teeth = 2) {
  const w = (x1 - x0) / (teeth * 2);
  const depth = w * K;
  const front = [];
  const back = [];
  for (let k = 0; k <= teeth * 2; k++) {
    const x = x0 + k * w;
    front.push([x, z0 + (k % 2 ? 0 : depth)]);
    back.push([x, z1 - (k % 2 ? depth : 0)]);
  }
  return [...front, ...back.reverse()];
}

// The intake hoods: raised scoops on the shoulders, smooth, a lighter lip.
function hoodGeometry(pal) {
  const cLip = new THREE.Color(pal.light);
  const cHood = new THREE.Color(pal.base);
  const NSP = LIP_TEETH * 8;
  const ts = [0, 0.025, 0.07, 0.14, 0.24, 0.36, 0.5, 0.66, 0.82, 1];
  const parts = [];
  for (const s of [-1, 1]) {
    const pos = [];
    const col = [];
    for (let k = 0; k <= NSP; k++) {
      const ax = XI0 + ((XI1 - XI0) * k) / NSP;
      for (let q = 0; q < ts.length; q++) {
        const z = lipZ(ax) + ts[q] * 3.4;
        pos.push(s * ax, topAt(s * ax, z) + 0.006, z);
        const c = q === 0 ? cLip : cHood;
        col.push(c.r, c.g, c.b);
      }
    }
    const idx = [];
    const n = ts.length;
    for (let k = 0; k < NSP; k++) {
      for (let q = 0; q < n - 1; q++) {
        const a = k * n + q, b = (k + 1) * n + q, c = (k + 1) * n + q + 1, d = k * n + q + 1;
        // (Winding: up, mirrored on the left.)
        if (s > 0) idx.push(a, d, b, b, d, c);
        else idx.push(a, b, d, b, c, d);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute("color", new THREE.Float32BufferAttribute(col, 3));
    g.setIndex(idx);
    g.computeVertexNormals();
    parts.push(g);
  }
  return parts;
}

function detailGeometry(pal) {
  const B = new Builder();
  // (Faint seams on top, where the light falls; stronger underneath, in the shade.)
  const cLine = new THREE.Color(pal.dark).multiplyScalar(0.8);
  const cUnder = new THREE.Color(pal.dark).multiplyScalar(0.42);
  const cFrame = new THREE.Color(pal.dark).multiplyScalar(0.45);
  const cMouth = new THREE.Color(0x090a0c);
  for (const s of [-1, 1]) {
    const X = (pts) => pts.map(([x, z]) => [s * x, z]);
    // The windscreen's frame (see WINDOWS) and the two crew hatches behind it.
    for (const pane of WINDOWS) line(B, X(pane), 0.09, 1, cFrame, 0.045, true);
    line(B, X(sawPanel(0.25, 1.15, -5.0, -4.0, 2)), 0.04, 1, cLine, 0.022, true);
    // The intake hood (see hoodGeometry): its mouth, dark, from the jagged
    // lip down and back into the skin.
    const NSP = LIP_TEETH * 8;
    for (let k = 0; k < NSP; k++) {
      const lip = (q) => {
        const ax = XI0 + ((XI1 - XI0) * q) / NSP;
        const z = lipZ(ax);
        return [s * ax, topAt(s * ax, z) + 0.005, z];
      };
      const a = lip(k), b = lip(k + 1);
      const base = (p) => [p[0], p[1] - intakeLipHeight(Math.abs(p[0])) - 0.07, p[2] + 0.28];
      B.quad(a, b, base(b), base(a), cMouth, [0, 0.3, -1]);
    }
    // The auxiliary inlet doors on the hood, and its seam with the nacelle.
    line(B, X(sawPanel(XI0 + 0.75, XI1 - 0.75, LIP_Z + 0.9, LIP_Z + 1.6, 1)), 0.04, 1, cLine, 0.02, true);
    // Access panels on the nacelles and the wings.
    line(B, X(sawPanel(4.6, 6.2, -1.2, 0.6, 1)), 0.035, 1, cLine, 0.02, true);
    line(B, X(sawPanel(9.4, 10.8, -1.1, 0.4, 1)), 0.035, 1, cLine, 0.02, true);
    // The hinge lines of the moving surfaces, on top and underneath.
    for (const sp of SPANS) {
      if (sp.lo < 0) continue;
      for (const side of [1, -1]) {
        const pts = [];
        for (let x = sp.lo; x <= sp.hi + 1e-6; x += Math.max(0.2, (sp.hi - sp.lo) / 8)) pts.push([s * x, teZ(x) - hingeDepth(x) - 0.03]);
        line(B, pts, 0.035, side, side > 0 ? cLine : cUnder, 0.02);
      }
    }
    // Underneath: the main gear doors, the weapon bays (two doors each),
    // access panels.
    line(B, X(sawPanel(4.5, 5.9, 0.2, 2.9, 1)), 0.055, -1, cUnder, 0.02, true);
    line(B, X([[5.2, 0.45], [5.2, 2.65]]), 0.04, -1, cUnder, 0.02);
    line(B, X(sawPanel(0.2, 2.25, -3.9, 1.9, 2)), 0.055, -1, cUnder, 0.02, true);
    line(B, X([[1.225, -3.6], [1.225, 1.6]]), 0.04, -1, cUnder, 0.02);
    line(B, X(sawPanel(8.6, 10.2, -1.6, 0.2, 1)), 0.04, -1, cUnder, 0.02, true);
    line(B, X(sawPanel(14.0, 15.2, 2.4, 3.6, 1)), 0.04, -1, cUnder, 0.02, true);
  }
  for (const side of [1, -1]) line(B, [[-(A4 - 0.25), HINGE_Z - 0.03], [A4 - 0.25, HINGE_Z - 0.03]], 0.035, side, side > 0 ? cLine : cUnder, 0.02);
  // The nose gear doors.
  line(B, sawPanel(-0.55, 0.55, -6.9, -4.3, 1), 0.055, -1, cUnder, 0.02, true);
  line(B, [[0, -6.6], [0, -4.6]], 0.04, -1, cUnder, 0.02);
  // A spine panel.
  line(B, sawPanel(-0.9, 0.9, 0.4, 2.0, 2), 0.035, 1, cLine, 0.02, true);
  // The air refuelling receptacle's door on the spine behind the cockpit.
  line(B, [[-0.3, -3.3], [0.3, -3.3], [0.3, -2.6], [-0.3, -2.6]], 0.05, 1, cLine, 0.02, true);
  return B.geometry();
}

// The windscreen: two big front panes and two side panes each side of the
// centre line, their lower and upper edges parallel to the leading edges
// ([x, z] corners on the skin, right side).
const WS_Z = -6.68; // the lower frame's apex
const wsPane = (x0, x1, h0, h1) => [
  [x0, WS_Z + x0 * K],
  [x1, WS_Z + x1 * K],
  [x1, WS_Z + x1 * K + h1],
  [x0, WS_Z + x0 * K + h0],
];
const WINDOWS = [wsPane(0.1, 0.98, 0.86, 0.8), wsPane(1.1, 1.85, 0.74, 0.5)];
function windowsGeometry() {
  const B = new Builder();
  const white = new THREE.Color(1, 1, 1);
  for (const s of [-1, 1]) {
    for (const pane of WINDOWS) {
      // (Subdivided: it follows the curve of the nose.)
      const N = 4;
      const at = (u, v) => {
        const [a, b, c, d] = pane;
        const x = (a[0] * (1 - u) + b[0] * u) * (1 - v) + (d[0] * (1 - u) + c[0] * u) * v;
        const z = (a[1] * (1 - u) + b[1] * u) * (1 - v) + (d[1] * (1 - u) + c[1] * u) * v;
        return [s * x, topAt(s * x, z) + 0.032, z];
      };
      for (let i = 0; i < N; i++) for (let j = 0; j < N; j++) B.quad(at(i / N, j / N), at((i + 1) / N, j / N), at((i + 1) / N, (j + 1) / N), at(i / N, (j + 1) / N), white, [0, 1, -0.3]);
    }
  }
  return B.geometry();
}

// ---------- Gear ----------

function wheel(r, w, x, y, z) {
  return [
    colorize(new THREE.CylinderGeometry(r, r, w, 16).rotateZ(Math.PI / 2).translate(x, y, z), 0x161719),
    colorize(new THREE.CylinderGeometry(r * 0.55, r * 0.55, w + 0.02, 10).rotateZ(Math.PI / 2).translate(x, y, z), 0x8d939a),
  ];
}
function strut(a, b, r, hex) {
  const va = new THREE.Vector3(...a);
  const vb = new THREE.Vector3(...b);
  const len = va.distanceTo(vb);
  const g = new THREE.CylinderGeometry(r, r, len, 8);
  g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), vb.clone().sub(va).normalize()));
  g.translate((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2);
  return colorize(g, hex);
}
// The nose leg (pivot at the top, the wheels' bottom `len + r` below): an
// oleo strut, two wheels side by side, a drag brace and the landing lights.
function noseGearGeometry(len, r) {
  const steel = 0xb4b8be;
  const parts = [strut([0, 0, 0], [0, -len * 0.55, 0], 0.13, 0x9aa0a7), strut([0, -len * 0.5, 0], [0, -len, 0], 0.09, steel)];
  parts.push(strut([0, -len * 0.42, 0], [0, -0.05, -1.0], 0.06, 0x8b9096));
  parts.push(colorize(new THREE.BoxGeometry(0.62, 0.1, 0.12).translate(0, -len, 0), 0x8b9096));
  parts.push(colorize(new THREE.BoxGeometry(0.22, 0.12, 0.1).translate(0, -len * 0.62, -0.13), 0xe8ecf0));
  for (const sx of [-0.26, 0.26]) parts.push(...wheel(r, 0.24, sx, -len, 0));
  return merge(parts);
}
// A main leg: a stout strut, a side brace inboard, a drag brace forward,
// and a bogie of four wheels.
function mainGearGeometry(len, r, side) {
  const parts = [strut([0, 0, 0], [0, -len * 0.6, 0], 0.17, 0x9aa0a7), strut([0, -len * 0.55, 0], [0, -len + 0.05, 0], 0.12, 0xb4b8be)];
  parts.push(strut([0, -len * 0.45, 0], [-side * 0.95, -0.05, 0], 0.07, 0x8b9096));
  parts.push(strut([0, -len * 0.4, 0], [0, -0.05, -1.1], 0.07, 0x8b9096));
  parts.push(colorize(new THREE.BoxGeometry(0.2, 0.18, 1.55).translate(0, -len, 0), 0x8b9096));
  for (const z of [-0.6, 0.6]) {
    parts.push(colorize(new THREE.BoxGeometry(0.96, 0.1, 0.1).translate(0, -len, z), 0x8b9096));
    for (const sx of [-0.36, 0.36]) parts.push(...wheel(r, 0.3, sx, -len, z));
  }
  return merge(parts);
}
// The open gear doors (hanging from their hinges, sawtooth ends) and the
// dark wells between them: shown with the gear.
function doorsGeometry(pal) {
  const B = new Builder();
  const cDoor = new THREE.Color(pal.base);
  const cIn = new THREE.Color(pal.dark).multiplyScalar(0.8);
  const cWell = new THREE.Color(0x101113);
  const door = (xh, z0, z1, depth, out) => {
    // A plate hanging from a hinge along x = xh, from z0 to z1, `depth` down,
    // tilted out a little; its ends zigzag like the outline it closes.
    const pts = [];
    const n = 4;
    const tooth = 0.18;
    const top = (z) => botAt(xh, z) + 0.02;
    pts.push([xh, top(z0 + tooth), z0 + tooth]);
    pts.push([xh, top(z1 - tooth), z1 - tooth]);
    for (let k = 1; k <= n; k++) {
      const f = k / n;
      const zz = z1 - (k % 2 ? 0 : tooth);
      pts.push([xh + out * depth * 0.18 * f, top(z1) - depth * f, zz]);
    }
    for (let k = n; k >= 1; k--) {
      const f = k / n;
      const zz = z0 + (k % 2 ? 0 : tooth);
      pts.push([xh + out * depth * 0.18 * f, top(z0) - depth * f, zz]);
    }
    const shift = (p, d) => [p[0] + d, p[1], p[2]];
    B.poly(pts.map((p) => shift(p, 0.02 * out)), cDoor, [out, 0, 0]);
    B.poly(pts.map((p) => shift(p, -0.02 * out)), cIn, [-out, 0, 0]);
  };
  const well = (x0, x1, z0, z1) => {
    const N = 4;
    const M = 6;
    const at = (i, j) => {
      const x = x0 + ((x1 - x0) * i) / N;
      const z = z0 + ((z1 - z0) * j) / M;
      return [x, botAt(x, z) - 0.03, z];
    };
    for (let i = 0; i < N; i++) for (let j = 0; j < M; j++) B.quad(at(i, j), at(i + 1, j), at(i + 1, j + 1), at(i, j + 1), cWell, [0, -1, 0]);
  };
  well(-0.5, 0.5, -6.75, -4.45);
  door(-0.55, -6.9, -4.3, 0.55, -1);
  door(0.55, -6.9, -4.3, 0.55, 1);
  for (const s of [-1, 1]) {
    well(s * 4.55, s * 5.85, 0.35, 2.75);
    door(s * 4.5, 0.2, 2.9, 0.7, -s);
    door(s * 5.9, 0.2, 2.9, 0.7, s);
  }
  return B.geometry();
}

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

// The geometry, built once per paint (a B-2 is set out at every airport
// visit; the models share it), and the paint-free parts once.
const cachedByPaint = {};
let common = null;
function commonGeometry() {
  if (common) return common;
  const nb = botAt(NOSE_GEAR[0], NOSE_GEAR[1]);
  const mb = botAt(MAIN_GEAR[0], MAIN_GEAR[1]);
  const rn = 0.4;
  const rm = 0.5;
  common = {
    windows: windowsGeometry(),
    noseTop: nb,
    mainTop: mb,
    nose: noseGearGeometry(B2_GEAR_HEIGHT + nb - rn, rn),
    left: mainGearGeometry(B2_GEAR_HEIGHT + mb - rm, rm, -1),
    right: mainGearGeometry(B2_GEAR_HEIGHT + mb - rm, rm, 1),
  };
  return common;
}
function buildGeometry(key, pal) {
  if (cachedByPaint[key]) return cachedByPaint[key];
  const hull = merge([...skinGeometry(pal), ...hoodGeometry(pal), detailGeometry(pal)]);
  // The moving surfaces: per span, per side (the beaver tail once).
  const defs = [];
  const idx = (x) => GRID.findIndex((p) => Math.abs(p[0].x - x) < 1e-6);
  const idxLast = (x) => GRID.length - 1 - [...GRID].reverse().findIndex((p) => Math.abs(p[0].x - x) < 1e-6);
  for (const sp of SPANS) {
    for (const side of sp.lo < 0 ? [1] : [-1, 1]) {
      const xa = side > 0 ? sp.lo : -sp.hi;
      const xb = side > 0 ? sp.hi : -sp.lo;
      const i0 = idxLast(xa);
      const i1 = idx(xb);
      const parts = sp.kind === "rudder" ? ["upper", "lower"] : ["full"];
      for (const part of parts) {
        const d = surfaceGeometry(pal, i0, i1, part);
        // (The axis points to +x: a positive angle drops the trailing edge.)
        if (d.axis.x < 0) d.axis.negate();
        defs.push({ ...d, kind: sp.kind === "rudder" ? (part === "upper" ? "rudderUp" : "rudderDown") : sp.kind, side: sp.lo < 0 ? 0 : side });
      }
    }
  }
  // (The outboard and middle elevons move together: one mesh a side.)
  const merged = [];
  for (const d of defs) {
    const twin = d.kind === "elevon" && merged.find((m) => m.kind === "elevon" && m.side === d.side);
    if (!twin) {
      merged.push(d);
      continue;
    }
    // Re-base the second piece onto the first one's hinge (they share the segment's hinge line).
    const off = d.pivot.map((v, k) => v - twin.pivot[k]);
    d.geo.translate(off[0], off[1], off[2]);
    twin.geo = merge([twin.geo, d.geo]);
  }
  cachedByPaint[key] = { hull, doors: doorsGeometry(pal), defs: merged };
  return cachedByPaint[key];
}

export function createB2Model({ paint = "gray" } = {}) {
  const key = B2_PAINTS[paint] ? paint : "gray";
  const pal = B2_PAINTS[key];
  const { hull, doors, defs } = buildGeometry(key, pal);
  const cg = commonGeometry();
  const shared = new Set([hull, doors, cg.windows, cg.nose, cg.left, cg.right, ...defs.map((d) => d.geo)]);
  const root = new THREE.Group();
  const body = new THREE.Group();
  root.add(body);
  const light = { sky: 15, block: 0, flash: new THREE.Color(0, 0, 0) };
  const hullMat = createEntityMaterial("color", null, { finish: FINISH });
  hullMat.uniforms.uFill.value = 0.45;
  const hullMesh = new THREE.Mesh(hull, hullMat);
  hullMesh.castShadow = true;
  bindEntityLight(hullMesh, () => light);
  body.add(hullMesh);
  // The windscreen.
  const canopyMesh = new THREE.Mesh(cg.windows, new THREE.MeshStandardMaterial({ color: pal.glass, metalness: 0.9, roughness: 0.18, envMapIntensity: 1 }));
  body.add(canopyMesh);
  // The control surfaces (see buildGeometry), hinged at their pivots.
  const surfaces = defs.map((d) => {
    const m = new THREE.Mesh(d.geo, hullMat);
    m.castShadow = true;
    bindEntityLight(m, () => light);
    const group = new THREE.Group();
    group.position.fromArray(d.pivot);
    group.add(m);
    body.add(group);
    return { group, axis: d.axis, kind: d.kind, side: d.side };
  });
  // Gear: the nose leg under the cockpit, the main bogies under the inner wings.
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
    nose: mkGear(cg.nose, NOSE_GEAR[0], cg.noseTop, NOSE_GEAR[1]),
    left: mkGear(cg.left, -MAIN_GEAR[0], cg.mainTop, MAIN_GEAR[1]),
    right: mkGear(cg.right, MAIN_GEAR[0], cg.mainTop, MAIN_GEAR[1]),
    doors: mkGear(doors, 0, 0, 0),
  };
  const gearParts = Object.values(gear);
  let gearT = 1;
  // The engines' heat: a faint shimmer over each exhaust deck (no afterburner on a bomber).
  const heat = [];
  for (const side of [-1, 1]) {
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: softGlowTexture(), color: new THREE.Color(1.2, 0.7, 0.4), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, fog: false }));
    sp.layers.set(LAYER_FX);
    const x = (XT0 + XT1) / 2;
    const z = teZ(x) - DN * 0.6;
    sp.position.set(side * x, topAt(x, z) + 0.25, z);
    sp.visible = false;
    body.add(sp);
    heat.push(sp);
  }
  // Lights: red (left) and green (right) at the wingtips, white strobes on
  // the spine and the belly, the landing light on the nose leg.
  const navSprite = (color, x, y, z, size, parent = body) => {
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: softGlowTexture(), color, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, fog: false }));
    sp.layers.set(LAYER_FX);
    sp.position.set(x, y, z);
    sp.scale.setScalar(size);
    parent.add(sp);
    return sp;
  };
  const tipZ = TIP_LE_Z + 0.25;
  const nav = [
    navSprite(new THREE.Color(2.4, 0.15, 0.15), -S + 0.2, topAt(S - 0.2, tipZ) + 0.05, tipZ, 0.45),
    navSprite(new THREE.Color(0.15, 2.4, 0.2), S - 0.2, topAt(S - 0.2, tipZ) + 0.05, tipZ, 0.45),
    navSprite(new THREE.Color(2.6, 2.6, 3), 0, topAt(0, -1) + 0.12, -1, 0.4),
    navSprite(new THREE.Color(2.6, 2.6, 3), 0, botAt(0, 0) - 0.1, 0, 0.4),
  ];
  const noseLen = B2_GEAR_HEIGHT + cg.noseTop - 0.4;
  const landing = navSprite(new THREE.Color(2.2, 2.2, 2), 0, -noseLen * 0.62, -0.22, 0.7, gear.nose);
  const cockpitGlow = navSprite(new THREE.Color(0.1, 0.35, 0.18), 0, topAt(0, -5.9) - 0.2, -5.9, 0.6);
  for (const o of [...nav, landing, cockpitGlow]) o.visible = false;
  return {
    root,
    body,
    light,
    hull: hullMesh,
    canopy: canopyMesh,
    type: "b2",
    length: B2_LENGTH,
    span: B2_SPAN,
    // No afterburner: the exhausts only shimmer a little with the throttle.
    setThrottle(throttle, afterburner, t) {
      for (const h of heat) {
        h.visible = throttle > 0.05;
        const k = 0.3 + throttle * 0.7;
        h.scale.set(2.6 * k, 0.9 * k, 1);
        // (faint: a real B-2's exhaust shows no glow, only a little heat haze)
        h.material.color.setRGB(0.32 * k + Math.sin(t * 23) * 0.02, 0.18 * k, 0.1 * k);
      }
    },
    // Elevons: pitch together, roll against each other (the inboard ones
    // half as much); the split rudders open on one side for yaw, on both as
    // air brakes; the beaver tail trims with the pitch.
    setControls(pitch, roll, yaw, brake = 0) {
      for (const sf of surfaces) {
        let a = 0;
        if (sf.kind === "elevon" || sf.kind === "elevon2") a = -0.4 * pitch - 0.45 * roll * sf.side * (sf.kind === "elevon" ? 1 : 0.5);
        else if (sf.kind === "tail") a = -0.3 * pitch;
        else {
          const open = Math.min(1.1, Math.max(0, 0.6 * yaw * sf.side) + 0.8 * brake);
          a = sf.kind === "rudderUp" ? -open : open;
        }
        sf.group.quaternion.setFromAxisAngle(sf.axis, a);
      }
    },
    setBurnt(on, t = 0) {
      canopyMesh.visible = !on;
      if (!on) return;
      for (const h of heat) h.visible = false;
      for (const o of [...nav, landing, cockpitGlow]) o.visible = false;
      hullMat.uniforms.uFill.value = 0.02;
      light.flash.setRGB(0.55 + 0.25 * Math.sin(t * 17), 0.16 + 0.1 * Math.sin(t * 23 + 1), 0.02);
    },
    // 1 = wheels down; the nose leg folds forward, the main legs back; the
    // doors stand open while the gear is out.
    setGear(down) {
      gearT = down;
      const v = down > 0.02;
      for (const g of gearParts) g.visible = v;
      gear.nose.rotation.x = (1 - down) * 1.5;
      gear.left.rotation.x = (1 - down) * -1.5;
      gear.right.rotation.x = (1 - down) * -1.5;
    },
    get gear() {
      return gearT;
    },
    // The lights (see jet-model.js setLights): on while it is in use.
    setLights(t, dark = 0, active = true) {
      const on = active;
      const k = 0.45 + 0.55 * Math.min(1, dark / 0.6);
      const strobe = (t % 1.4) < 0.08 || ((t % 1.4) > 0.45 && (t % 1.4) < 0.52);
      nav[0].visible = nav[1].visible = on;
      nav[0].material.color.setRGB(2.4 * k, 0.15 * k, 0.15 * k);
      nav[1].material.color.setRGB(0.15 * k, 2.4 * k, 0.2 * k);
      nav[2].visible = nav[3].visible = on && strobe;
      landing.visible = on && dark > 0.25 && gearT > 0.9;
      cockpitGlow.visible = on && dark > 0.3;
      hullMat.uniforms.uFill.value = 0.08 + 0.5 * dark;
    },
    get lightsOn() {
      return nav[0].visible;
    },
    // Frees what this model made for itself (not the geometry shared per
    // paint, the sprites' common quad or the textures).
    dispose() {
      root.traverse((o) => {
        if (o.geometry && !o.isSprite && !shared.has(o.geometry)) o.geometry.dispose();
        if (o.material) o.material.dispose();
      });
    },
  };
}
