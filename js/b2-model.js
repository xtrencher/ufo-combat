// The B-2 Spirit stealth bomber (Round 8), built procedurally like the
// fighters (jet-model.js): a flying wing with no fuselage and no tail.
//
//   - planform: a straight leading edge swept back 33 degrees from the nose
//     to the small wingtips, and the famous double-W sawtooth trailing edge
//     (four edges a side, each parallel to the leading edge one way or the
//     other, the centre a pointed "beaver tail");
//   - section: a blended body: thick and humped in the middle (the cockpit
//     at the front of the hump), thinning smoothly out to knife-thin tips;
//   - on top: the four-pane cockpit windscreen, two raised engine intakes
//     with jagged lips on either side of the hump, and recessed exhaust
//     slots near the trailing edge with a light heat-shield deck behind;
//   - control surfaces: elevons along the outer and inner trailing edges,
//     split drag rudders at the wingtips (they open for yaw and as air
//     brakes); tall tricycle gear with four-wheel main bogies; navigation
//     lights at the wingtips, strobes on the spine and the belly.
//
// The same interface as createJetModel. Model space: nose toward -Z, up +Y,
// right +X; about 44 blocks of span and 18 of length (the real thing is
// 52 m by 21 m: the same scale as the fighters).
import * as THREE from "three";
import { createEntityMaterial, bindEntityLight } from "./shaders.js";
import { LAYER_FX } from "./layers.js";

export const B2_SPAN = 44.5;
export const B2_LENGTH = 17.6;
const S = B2_SPAN / 2; // half span
const NOSE_Z = -9.2;
const T33 = Math.tan((33 * Math.PI) / 180);
const TIP_LE_Z = NOSE_Z + S * T33; // the leading edge reaches the tip here
const TIP_TE_Z = TIP_LE_Z + 1.2; // the wingtip's short chord (~6.5)
// The sawtooth trailing edge (half, from the tip inward): x, z: the tip,
// the outer notch, the "W" point behind the engines, the inner notch, and
// the pointed centre ("beaver tail"). (Round 8 proportions after the real
// planform: broad outer wings, the notches well forward of the points.)
const TE = [
  [S, TIP_TE_Z + 0.15],
  [14.5, 4.6],
  [9.5, 7.6],
  [4.3, 4.6],
  [0, NOSE_Z + B2_LENGTH],
];

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
const FINISH = { spec: 0.22, gloss: 18, env: 0.08, grain: 0.03, panel: 0.22, panelScale: 1.6, livery: 0.08, liveryScale: 0.12, skin: { tone: 0.06, soot: 0.3, sootZ: 2.6, streaks: 0.05 } };

function teZ(ax) {
  // The trailing edge's z at |x| = ax (piecewise linear).
  for (let i = 0; i < TE.length - 1; i++) {
    const [x0, z0] = TE[i];
    const [x1, z1] = TE[i + 1];
    if (ax <= x0 && ax >= x1) return z0 + ((ax - x0) / (x1 - x0)) * (z1 - z0);
  }
  return TE[TE.length - 1][1];
}
function leZ(ax) {
  return NOSE_Z + ax * T33;
}
// The section's thickness at |x|: the humped middle blending into thin wings.
function thick(ax) {
  return 0.2 + 2.35 * Math.exp(-((ax / 4.3) ** 2)) + 0.5 * Math.max(0, 1 - ax / S);
}
// The section's shape (0 at the leading and trailing edges), max 1 near the front third.
const AMAX = (() => {
  let m = 0;
  for (let i = 0; i <= 100; i++) m = Math.max(m, Math.sqrt(i / 100) * (1 - i / 100) ** 1.15);
  return m;
})();
function shape(u) {
  return (Math.sqrt(u) * (1 - u) ** 1.15) / AMAX;
}
// The surface heights at (x, z): { top, bot } (y).
export function b2Surface(x, z) {
  const ax = Math.abs(x);
  const z0 = leZ(ax);
  const z1 = teZ(ax);
  if (z < z0 || z > z1 || ax > S) return null;
  const u = (z - z0) / Math.max(0.01, z1 - z0);
  const t = thick(ax) * shape(u);
  return { top: t * 0.72, bot: -t * 0.3 - 0.08 * Math.max(0, 1 - ax / 6) };
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
      pos.set([p.getX(i), p.getY(i), p.getZ(i)], o * 3);
      nor.set([nn.getX(i), nn.getY(i), nn.getZ(i)], o * 3);
      col.set(c ? [c.getX(i), c.getY(i), c.getZ(i)] : [1, 1, 1], o * 3);
    }
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  out.setAttribute("normal", new THREE.BufferAttribute(nor, 3));
  out.setAttribute("color", new THREE.BufferAttribute(col, 3));
  return out;
}

// The wing: a grid over the planform (spanwise stations through every
// corner of the sawtooth), top and bottom surfaces.
function wingGeometry(pal) {
  const xs = new Set([0]);
  for (const [x] of TE) xs.add(x);
  for (let i = 1; i <= 40; i++) xs.add(+(S * (i / 40) ** 1.25).toFixed(3));
  const stations = [...xs].sort((a, b) => a - b);
  const all = [...stations.slice(1).map((x) => -x).reverse(), ...stations];
  const NC = 22;
  const top = [];
  const bot = [];
  const cTop = new THREE.Color(pal.base);
  const cLight = new THREE.Color(pal.light);
  const cDark = new THREE.Color(pal.dark);
  const tmp = new THREE.Color();
  for (const x of all) {
    const ax = Math.abs(x);
    const z0 = leZ(ax);
    const z1 = teZ(ax);
    const rowT = [];
    const rowB = [];
    for (let j = 0; j <= NC; j++) {
      // (Denser near the leading edge, where the section curves most.)
      const u = (j / NC) ** 1.6;
      const z = z0 + (z1 - z0) * u;
      const t = thick(ax) * shape(u);
      rowT.push([x, t * 0.72, z, u]);
      rowB.push([x, -t * 0.3 - 0.08 * Math.max(0, 1 - ax / 6), z, u]);
    }
    top.push(rowT);
    bot.push(rowB);
  }
  const pos = [];
  const col = [];
  const push = (p, c) => {
    pos.push(p[0], p[1], p[2]);
    col.push(c.r, c.g, c.b);
  };
  const shadeTop = (p) => {
    // A lighter leading edge band, slightly darker trailing areas, the
    // panelling's two tones in broad spanwise bands.
    const band = Math.abs(Math.sin(p[0] * 0.21 + p[2] * 0.05)) < 0.12 ? 0.94 : 1;
    if (p[3] < 0.05) return tmp.copy(cLight).multiplyScalar(band);
    return tmp.copy(cTop).lerp(cDark, p[3] * 0.25).multiplyScalar(band);
  };
  const shadeBot = (p) => tmp.copy(cDark).multiplyScalar(0.92);
  for (let i = 0; i < all.length - 1; i++) {
    for (let j = 0; j < NC; j++) {
      const a = top[i][j], b = top[i + 1][j], c = top[i + 1][j + 1], d = top[i][j + 1];
      // (Winding: the top faces up.)
      for (const p of [a, d, b, b, d, c]) push(p, shadeTop(p));
      const e = bot[i][j], f = bot[i + 1][j], g = bot[i + 1][j + 1], h = bot[i][j + 1];
      for (const p of [e, f, h, f, g, h]) push(p, shadeBot(p));
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute("color", new THREE.Float32BufferAttribute(col, 3));
  geo.computeVertexNormals();
  return geo;
}

// A raised engine intake: a long low hump with a dark, jagged mouth facing forward.
function intakeGeometry(pal, side) {
  const x = side * 3.5;
  const z0 = -3.6;
  const len = 3.2;
  const parts = [];
  const s0 = b2Surface(x, z0 + len * 0.5);
  const base = s0 ? s0.top - 0.05 : 1.2;
  const hump = new THREE.CylinderGeometry(1, 1, len, 14, 1, false, -Math.PI / 2, Math.PI).rotateX(Math.PI / 2).rotateZ(0);
  hump.scale(1.25, 0.55, 1);
  hump.translate(x, base, z0 + len / 2);
  parts.push(colorize(hump, pal.base, (px, py, pz) => 0.95 + (pz - z0) * 0.02));
  // The mouth: a dark half-ellipse at the front, with a sawtooth lip.
  const mouth = new THREE.CircleGeometry(1, 14, 0, Math.PI).scale(1.15, 0.5, 1).rotateY(Math.PI).translate(x, base + 0.01, z0 - 0.01);
  parts.push(colorize(mouth, 0x0b0d10));
  for (let k = -2; k <= 2; k++) {
    const tooth = new THREE.ConeGeometry(0.16, 0.34, 3).rotateX(-Math.PI / 2).translate(x + k * 0.42, base + 0.42 - Math.abs(k) * 0.07, z0 - 0.12);
    parts.push(colorize(tooth, pal.dark));
  }
  return parts;
}

// An exhaust slot on top near the trailing edge, and the light heat-resistant deck behind it.
function exhaustGeometry(pal, side) {
  const parts = [];
  const xs = [side * 4.2, side * 6.0];
  const z = 1.8;
  for (let i = 0; i < 2; i++) {
    const x = (xs[0] + xs[1]) / 2;
    void i;
    const s = b2Surface(x, z);
    const y = s ? s.top + 0.03 : 0.4;
    const slot = new THREE.PlaneGeometry(2.2, 0.55).rotateX(-Math.PI / 2).translate(x, y, z);
    parts.push(colorize(slot, 0x0a0b0d));
    break;
  }
  // The deck: a lighter trapezoid behind the slot, down to the trailing edge.
  const x0 = Math.min(...xs.map(Math.abs));
  const x1 = Math.max(...xs.map(Math.abs));
  const pts = [];
  const cols = [];
  const c = new THREE.Color(pal.deck);
  const N = 6;
  for (let k = 0; k < N; k++) {
    const xa = side * (x0 - 0.2 + ((x1 - x0 + 0.4) * k) / N);
    const xb = side * (x0 - 0.2 + ((x1 - x0 + 0.4) * (k + 1)) / N);
    const za = z + 0.3;
    const zbA = teZ(Math.abs(xa)) - 0.15;
    const zbB = teZ(Math.abs(xb)) - 0.15;
    const ya = (b2Surface(xa, za)?.top ?? 0.3) + 0.025;
    const yb = (b2Surface(xb, za)?.top ?? 0.3) + 0.025;
    const yc = (b2Surface(xb, zbB)?.top ?? 0.05) + 0.025;
    const yd = (b2Surface(xa, zbA)?.top ?? 0.05) + 0.025;
    const quad = side > 0 ? [[xa, ya, za], [xb, yc, zbB], [xb, yb, za], [xa, ya, za], [xa, yd, zbA], [xb, yc, zbB]] : [[xa, ya, za], [xb, yb, za], [xb, yc, zbB], [xa, ya, za], [xb, yc, zbB], [xa, yd, zbA]];
    for (const p of quad) {
      pts.push(...p);
      cols.push(c.r, c.g, c.b);
    }
  }
  const deck = new THREE.BufferGeometry();
  deck.setAttribute("position", new THREE.Float32BufferAttribute(pts, 3));
  deck.setAttribute("color", new THREE.Float32BufferAttribute(cols, 3));
  deck.computeVertexNormals();
  parts.push(deck);
  return parts;
}

// The four-pane windscreen at the front of the hump.
function windowsGeometry() {
  const parts = [];
  for (const side of [-1, 1]) {
    for (const [x0, x1] of [[0.25, 0.85], [0.95, 1.5]]) {
      const pts = [];
      const z0 = -6.15;
      const z1 = -5.35;
      const corner = (x, z) => {
        const s = b2Surface(side * x, z);
        return [side * x, (s ? s.top : 1.6) + 0.035, z];
      };
      const a = corner(x0, z0), b = corner(x1, z0 + 0.12), c = corner(x1, z1), d = corner(x0, z1);
      const tri = side > 0 ? [a, c, b, a, d, c] : [a, b, c, a, c, d];
      for (const p of tri) pts.push(...p);
      const g = new THREE.BufferGeometry();
      g.setAttribute("position", new THREE.Float32BufferAttribute(pts, 3));
      g.computeVertexNormals();
      parts.push(g);
    }
  }
  return merge(parts.map((g) => colorize(g, 0xffffff)));
}

// An elevon or a rudder plate along a trailing edge segment (x0,z0)-(x1,z1)
// (on the edge itself), `chord` deep: a thin slab lying just over the wing's
// surfaces, hinged at its front edge. { geo (in hinge space), pivot, axis }.
function teSurface(pal, x0, z0, x1, z1, chord, kind, side) {
  const hx0 = x0;
  const hz0 = z0 - chord;
  const hx1 = x1;
  const hz1 = z1 - chord;
  const sA = b2Surface(hx0, hz0) || { top: 0.1, bot: -0.05 };
  const sB = b2Surface(hx1, hz1) || { top: 0.1, bot: -0.05 };
  const pivot = [(hx0 + hx1) / 2, (sA.top + sA.bot + sB.top + sB.bot) / 4, (hz0 + hz1) / 2];
  const rel = (x, y, z) => [x - pivot[0], y - pivot[1], z - pivot[2]];
  const A = rel(hx0, sA.top + 0.03, hz0), B = rel(hx1, sB.top + 0.03, hz1), C = rel(x1, 0.03, z1), D = rel(x0, 0.03, z0);
  const A2 = rel(hx0, sA.bot - 0.03, hz0), B2 = rel(hx1, sB.bot - 0.03, hz1), C2 = rel(x1, -0.03, z1), D2 = rel(x0, -0.03, z0);
  // (Winding by the side: the top faces up.)
  const cw = (x1 - x0) * side > 0;
  const top = cw ? [A, D, B, B, D, C] : [A, B, D, B, C, D];
  const bot = cw ? [A2, B2, D2, B2, C2, D2] : [A2, D2, B2, B2, D2, C2];
  const pts = [];
  for (const p of [...top, ...bot]) pts.push(...p);
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pts, 3));
  g.computeVertexNormals();
  colorize(g, pal.base, () => 0.9);
  const axis = new THREE.Vector3(hx1 - hx0, 0, hz1 - hz0).normalize();
  return { geo: g, pivot, axis, kind, side };
}

// Landing gear leg with wheels (n: wheel pairs along the leg's bogie).
function gearLeg(len, wheelR, pairs, spread) {
  const parts = [];
  parts.push(colorize(new THREE.CylinderGeometry(0.12, 0.12, len, 8).translate(0, -len / 2, 0), 0xb4b8be));
  parts.push(colorize(new THREE.BoxGeometry(0.22, 0.22, pairs > 1 ? 1.5 : 0.3).translate(0, -len, 0), 0x8b9096));
  for (let p = 0; p < pairs; p++) {
    const z = pairs > 1 ? (p - 0.5) * 1.1 : 0;
    for (const sx of [-spread, spread]) {
      parts.push(colorize(new THREE.CylinderGeometry(wheelR, wheelR, 0.3, 14).rotateZ(Math.PI / 2).translate(sx, -len, z), 0x16171a));
      parts.push(colorize(new THREE.CylinderGeometry(wheelR * 0.5, wheelR * 0.5, 0.32, 10).rotateZ(Math.PI / 2).translate(sx, -len, z), 0x9aa0a8));
    }
  }
  return merge(parts);
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

export const B2_GEAR_HEIGHT = 2.9; // the centre's height over the wheels' bottom

// The hull, the windscreen and the control surfaces, built once per paint (a
// B-2 is set out at every airport visit; the models share these).
const cachedByPaint = {};
function buildGeometry(key, pal) {
  if (cachedByPaint[key]) return cachedByPaint[key];
  const hull = merge([wingGeometry(pal), ...intakeGeometry(pal, -1), ...intakeGeometry(pal, 1), ...exhaustGeometry(pal, -1), ...exhaustGeometry(pal, 1)]);
  // Control surfaces: two elevons a side on the outer and inner trailing
  // edges (pitch together, roll opposite), split rudders at the tips.
  const defs = [];
  for (const side of [-1, 1]) {
    const tz = (x) => teZ(x);
    const xr0 = S - 0.3;
    const xr1 = S - 2.1;
    defs.push(teSurface(pal, side * xr0, tz(xr0), side * xr1, tz(xr1), 1.0, "rudder", side));
    const xe0 = S - 2.3;
    const xe1 = TE[1][0] + 0.6;
    defs.push(teSurface(pal, side * xe0, tz(xe0), side * xe1, tz(xe1), 1.4, "elevon", side));
    const xi0 = TE[2][0] - 0.4;
    const xi1 = TE[3][0] + 0.5;
    defs.push(teSurface(pal, side * xi0, tz(xi0), side * xi1, tz(xi1), 1.2, "elevon2", side));
  }
  cachedByPaint[key] = { hull, windows: windowsGeometry(), defs };
  return cachedByPaint[key];
}

export function createB2Model({ paint = "gray" } = {}) {
  const key = B2_PAINTS[paint] ? paint : "gray";
  const pal = B2_PAINTS[key];
  const { hull, windows, defs } = buildGeometry(key, pal);
  const shared = new Set([hull, windows, ...defs.map((d) => d.geo)]);
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
  const canopyMesh = new THREE.Mesh(windows, new THREE.MeshStandardMaterial({ color: pal.glass, metalness: 0.9, roughness: 0.18, envMapIntensity: 1 }));
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
  // Gear: the nose leg forward of the hump's middle, the main bogies under the inner wings.
  const gearMat = createEntityMaterial("color");
  const mkGear = (geo, x, y, z) => {
    const m = new THREE.Mesh(geo, gearMat);
    m.position.set(x, y, z);
    m.castShadow = true;
    bindEntityLight(m, () => light);
    body.add(m);
    return m;
  };
  const noseTop = b2Surface(0, -4.6)?.bot ?? -0.6;
  const mainTop = b2Surface(5.2, 0.6)?.bot ?? -0.5;
  const wheelR = 0.48;
  const gear = {
    nose: mkGear(gearLeg(B2_GEAR_HEIGHT + noseTop - wheelR, wheelR, 1, 0.22), 0, noseTop, -4.6),
    left: mkGear(gearLeg(B2_GEAR_HEIGHT + mainTop - wheelR, wheelR, 2, 0.32), -5.2, mainTop, 0.6),
    right: mkGear(gearLeg(B2_GEAR_HEIGHT + mainTop - wheelR, wheelR, 2, 0.32), 5.2, mainTop, 0.6),
  };
  let gearT = 1;
  // The engines' heat: a faint shimmer over each exhaust slot (no afterburner on a bomber).
  const heat = [];
  for (const side of [-1, 1]) {
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: softGlowTexture(), color: new THREE.Color(1.2, 0.7, 0.4), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, fog: false }));
    sp.layers.set(LAYER_FX);
    sp.position.set(side * 5.1, (b2Surface(side * 5.1, 1.8)?.top ?? 0.4) + 0.25, 2.2);
    sp.visible = false;
    body.add(sp);
    heat.push(sp);
  }
  // Lights: red (left) and green (right) at the wingtips, white strobes on the spine and the belly.
  const navSprite = (color, x, y, z, size) => {
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: softGlowTexture(), color, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, fog: false }));
    sp.layers.set(LAYER_FX);
    sp.position.set(x, y, z);
    sp.scale.setScalar(size);
    body.add(sp);
    return sp;
  };
  const nav = [
    navSprite(new THREE.Color(2.4, 0.15, 0.15), -S + 0.2, 0.15, TIP_LE_Z + 0.5, 0.45),
    navSprite(new THREE.Color(0.15, 2.4, 0.2), S - 0.2, 0.15, TIP_LE_Z + 0.5, 0.45),
    navSprite(new THREE.Color(2.6, 2.6, 3), 0, (b2Surface(0, -1)?.top ?? 1.4) + 0.12, -1, 0.4),
    navSprite(new THREE.Color(2.6, 2.6, 3), 0, (b2Surface(0, 0)?.bot ?? -0.7) - 0.1, 0, 0.4),
  ];
  const cockpitGlow = navSprite(new THREE.Color(0.1, 0.35, 0.18), 0, (b2Surface(0, -5.6)?.top ?? 1.5) - 0.2, -5.6, 0.6);
  for (const o of [...nav, cockpitGlow]) o.visible = false;
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
        h.scale.set(2.4 * k, 0.9 * k, 1);
        h.material.color.setRGB(0.9 * k + Math.sin(t * 23) * 0.05, 0.5 * k, 0.3 * k);
      }
    },
    // Elevons: pitch together, roll against each other; the split rudders
    // open on one side for yaw, on both as air brakes.
    setControls(pitch, roll, yaw, brake = 0) {
      for (const sf of surfaces) {
        let a = 0;
        if (sf.kind === "elevon" || sf.kind === "elevon2") a = (0.4 * pitch + 0.45 * roll * sf.side * (sf.kind === "elevon" ? 1 : 0.5)) * sf.side;
        else a = Math.max(0, 0.6 * yaw * sf.side) + 0.8 * brake;
        sf.group.quaternion.setFromAxisAngle(sf.axis, a);
      }
    },
    setBurnt(on, t = 0) {
      canopyMesh.visible = !on;
      if (!on) return;
      for (const h of heat) h.visible = false;
      for (const o of [...nav, cockpitGlow]) o.visible = false;
      hullMat.uniforms.uFill.value = 0.02;
      light.flash.setRGB(0.55 + 0.25 * Math.sin(t * 17), 0.16 + 0.1 * Math.sin(t * 23 + 1), 0.02);
    },
    setGear(down) {
      gearT = down;
      const v = down > 0.02;
      for (const g of Object.values(gear)) g.visible = v;
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
