// Procedural UFO models, in a clean, minimal style: they look real because
// they are plain. No lights, no panels, no portholes, no antennas: one
// smooth surface each, told apart by shape, proportions, size and finish.
//   - smooth saucers (the most common): lens-shaped, flat discs, and saucers
//     with a gentle raised centre, each with its own proportions, in
//     brushed metal, satin, glossy or matte finishes;
//   - spheres: pure balls, gray to black, with a subtle grainy surface;
//   - tic-tacs: smooth white or pale gray capsules;
//   - tori: a pure ring;
//   - after real sightings: a large flat black triangle with dim lights at
//     its corners (the "Belgian wave" ships), a boomerang / chevron with a row
//     of lights along its leading edge (the Phoenix lights), and a long
//     metallic cylinder with a few raised bands.
// A few carry a faint glow (a soft underside or all-over sheen and a halo at
// night); most don't glow at all. A shot-down UFO never glows again.
//
// A model is built at a radius of 1 and scaled to its size (a small scout is
// a few blocks across, a giant the size of a football field). Every model has
// a lit hull (geometry shared per variant, a material per finish), optional
// glow shells, a soft halo sprite for the glowing ones and a cheap "far"
// version. The same model is used for enemy UFOs, crashed wrecks and the
// player's own UFO, so a crashed UFO keeps its shape when boarded and flown.
// A wreck that blew up is charred.
import * as THREE from "three";
import { createEntityMaterial, bindEntityLight } from "./shaders.js";
import { LAYER_FX } from "./layers.js";

// Every design; the first ones are the saucer family (the most common).
export const UFO_DESIGNS = ["saucer", "saucer_disc", "saucer_domed", "sphere", "tictac", "torus", "triangle", "boomerang", "cylinder"];

export const UFO_DESIGN_NAMES = {
  saucer: "Lens saucer",
  saucer_disc: "Disc saucer",
  saucer_domed: "Domed saucer",
  sphere: "BALL UFO",
  tictac: "Tic-tac",
  torus: "Torus",
  triangle: "Black triangle",
  boomerang: "Boomerang",
  cylinder: "Cylinder",
};

// Designs with a front: they point where they fly. `YAW` is how far the
// model's own forward is turned from -Z (the tic-tac's long axis lies along
// X, the others are built pointing along -Z).
export const DIRECTIONAL_DESIGNS = { tictac: Math.PI / 2, triangle: 0, boomerang: 0, cylinder: 0 };
export function designFacingOffset(design) {
  return DIRECTIONAL_DESIGNS[family(design)] ?? null;
}

// How often each design appears (smooth saucers are by far the most common).
const DESIGN_WEIGHTS = { saucer: 24, saucer_disc: 16, saucer_domed: 16, sphere: 12, tictac: 12, torus: 6, triangle: 10, boomerang: 5, cylinder: 5 };

// Old designs (saved wrecks and UFOs from earlier versions) map onto the new ones.
const LEGACY = { saucer_tall: "saucer_domed", saucer_smooth: "saucer", saucer_dark: "saucer_disc", orb: "sphere", ring: "torus", cigar: "tictac", pyramid: "triangle", diamond: "saucer_disc", cubesphere: "sphere", cube: "saucer_disc", cubering: "torus" };

// How likely each family is to glow faintly (most don't).
const GLOW_ODDS = { saucer: 0.3, sphere: 0.08, tictac: 0.3, torus: 0.2, triangle: 0, boomerang: 0, cylinder: 0.25 };

function family(design) {
  if (design.startsWith("saucer")) return "saucer";
  return design;
}

// A random UFO look: { design, seed, glow }. glow: true/false forces it.
export function randomUfoSpec(rng = Math.random, { glow, design } = {}) {
  let d = design && LEGACY[design] ? LEGACY[design] : design;
  if (!d) {
    let total = 0;
    for (const k in DESIGN_WEIGHTS) total += DESIGN_WEIGHTS[k];
    let r = rng() * total;
    d = "saucer";
    for (const k in DESIGN_WEIGHTS) {
      r -= DESIGN_WEIGHTS[k];
      if (r <= 0) {
        d = k;
        break;
      }
    }
  }
  const seed = Math.floor(rng() * 1e6);
  const g = glow !== undefined ? glow : rng() < (GLOW_ODDS[family(d)] ?? 0.2);
  return { design: d, seed, glow: !!g };
}

// A saved or given look, with old design names mapped onto the new ones.
export function normalizeUfoSpec(spec) {
  return normSpec(spec);
}

function normSpec(spec) {
  if (typeof spec === "string") {
    const d = LEGACY[spec] || spec;
    return { design: BUILDERS[d] ? d : "saucer", seed: 0, glow: false };
  }
  const d = LEGACY[spec.design] || spec.design;
  const design = BUILDERS[d] ? d : "saucer";
  return { design, seed: spec.seed | 0, glow: !!spec.glow && spec.design !== "saucer_dark" };
}

// Which laser color a UFO of this look fires (the attack style decides it
// in ufos.js; this is the fallback).
export function ufoLaserKey(spec) {
  const s = normSpec(spec);
  return ["green", "cyan", "red", "magenta", "orange"][s.seed % 5];
}

// How each design sits in space: `h` is its height and `bottom` how far its
// underside hangs below its center (radius-1 units); halo color (linear).
export function designInfo(spec) {
  return designData(normSpec(spec)).info;
}

// ---------- Geometry helpers ----------

function rngFrom(seed) {
  let a = (seed * 2654435761) >>> 0 || 1;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const _col = new THREE.Color();

// Bakes a color into a geometry, optionally shaded per vertex:
// shadeFn(x, y, z) returns a brightness factor (or an [r, g, b] factor).
function colorize(geo, color, shadeFn = null) {
  const c = new THREE.Color(color);
  c.convertSRGBToLinear();
  const pos = geo.getAttribute("position");
  const arr = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) {
    const s = shadeFn ? shadeFn(pos.getX(i), pos.getY(i), pos.getZ(i)) : 1;
    if (Array.isArray(s)) {
      arr[i * 3] = c.r * s[0];
      arr[i * 3 + 1] = c.g * s[1];
      arr[i * 3 + 2] = c.b * s[2];
    } else {
      arr[i * 3] = c.r * s;
      arr[i * 3 + 1] = c.g * s;
      arr[i * 3 + 2] = c.b * s;
    }
  }
  geo.setAttribute("color", new THREE.BufferAttribute(arr, 3));
  return geo;
}

// Merges non-indexed copies of geometries with position/normal/color.
function merge(list) {
  const geos = list.map((g) => {
    const n = g.index ? g.toNonIndexed() : g;
    if (!n.getAttribute("normal")) n.computeVertexNormals();
    return n;
  });
  let n = 0;
  for (const g of geos) n += g.getAttribute("position").count;
  const pos = new Float32Array(n * 3);
  const nor = new Float32Array(n * 3);
  const col = new Float32Array(n * 3);
  let o = 0;
  for (const g of geos) {
    const c = g.getAttribute("position").count;
    pos.set(g.getAttribute("position").array, o * 3);
    nor.set(g.getAttribute("normal").array, o * 3);
    col.set(g.getAttribute("color").array, o * 3);
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

function lathe(points, segments = 64) {
  return new THREE.LatheGeometry(points.map(([x, y]) => new THREE.Vector2(x, y)), segments);
}

// ---------- Finishes ----------
// Surface finishes (see USE_SPEC in shaders.js): specular strength, gloss,
// sky reflection, grain, brushed streaks. One material per finish.
const FINISHES = {
  brushed: { spec: 0.9, gloss: 55, env: 0.55, grain: 0, brush: 0.9 },
  glossy: { spec: 1.5, gloss: 240, env: 0.95, grain: 0, brush: 0 },
  satin: { spec: 0.55, gloss: 28, env: 0.35, grain: 0.04, brush: 0 },
  matte: { spec: 0.12, gloss: 9, env: 0.1, grain: 0.06, brush: 0 },
  grain: { spec: 0.4, gloss: 22, env: 0.25, grain: 0.3, brush: 0 },
  charred: { spec: 0.05, gloss: 6, env: 0.04, grain: 0.35, brush: 0 },
};

// Hull colors (sRGB) per family, with the finishes that suit them.
const METALS = [
  { c: 0xb9bfc7, f: ["brushed", "glossy", "satin"] }, // silver
  { c: 0xdfe2e6, f: ["satin", "glossy", "matte"] }, // pale aluminium
  { c: 0x6a7079, f: ["brushed", "satin"] }, // gunmetal
  { c: 0x34373c, f: ["glossy", "satin", "matte"] }, // graphite
  { c: 0x1a1b1e, f: ["matte", "glossy"] }, // black
  { c: 0xc8bc9c, f: ["brushed", "satin"] }, // champagne
  { c: 0xeeeeec, f: ["glossy", "matte"] }, // white
];
const DARKS = [0x1c1d20, 0x232428, 0x2c2e32, 0x36383c, 0x141517];
const PALES = [0xf2f3f4, 0xe4e6e8, 0xd3d6d9, 0xc7cbcf];
const GLOW_TINTS = [[0.6, 0.85, 1.25], [1.1, 1.1, 1.2], [1.25, 1.0, 0.65], [0.65, 1.2, 0.95]];

function pick(rand, list) {
  return list[Math.floor(rand() * list.length) % list.length];
}

// A soft all-over glow: a slightly larger copy of the hull, additive.
function glowShell(geo, tint, strength = 0.35, scale = 1.015) {
  return { geometry: geo.clone().scale(scale, scale * 1.02, scale), color: [tint[0] * strength, tint[1] * strength, tint[2] * strength], pulse: 0.2, shell: true };
}

// ---------- Hull designs (radius 1) ----------
// Each returns { hull: BufferGeometry (with vertex colors), finish, glow:
// [{ geometry, color, pulse, shell }], info: { h, bottom, halo } }.

// A smooth saucer from a profile: the underside and the top as functions of
// the distance from the center (0-1), joined at a rounded rim. kind: "lens",
// "disc" or "domed".
function saucerHull(spec, kind) {
  const rand = rngFrom(spec.seed);
  let top;
  let bot;
  if (kind === "disc") {
    // A flat disc with a rounded edge: nearly flat top and bottom.
    const th = 0.06 + rand() * 0.05;
    const bulge = 0.02 + rand() * 0.04;
    top = (r) => th + bulge * (1 - r * r);
    bot = (r) => -(th * 0.9 + bulge * 0.7 * (1 - r * r));
  } else if (kind === "domed") {
    // A lens with a gentle raised centre (one continuous curve, no cockpit).
    const ht = 0.07 + rand() * 0.07;
    const hb = 0.06 + rand() * 0.08;
    const dh = 0.12 + rand() * 0.14;
    const dw = 0.28 + rand() * 0.16;
    top = (r) => ht * Math.pow(1 - r * r, 1.2) + dh * Math.exp(-Math.pow(r / dw, 2.4));
    bot = (r) => -hb * Math.pow(1 - r * r, 1.1);
  } else {
    // A lens: two smooth domes, the top one usually a little fuller.
    const ht = 0.12 + rand() * 0.14;
    const hb = 0.08 + rand() * 0.12;
    const pt = 1.4 + rand() * 1.4;
    const pb = 1.4 + rand() * 1.4;
    top = (r) => ht * Math.pow(1 - Math.pow(r, pt), 0.9);
    bot = (r) => -hb * Math.pow(1 - Math.pow(r, pb), 0.9);
  }
  // The rim: a small rounded edge joining the two at r = 1.
  const rimR = 0.02 + rand() * 0.02;
  const pts = [];
  const N = 40;
  for (let i = 0; i <= N; i++) {
    const r = (i / N) * (1 - rimR);
    pts.push([Math.max(0.0001, r), bot(r)]);
  }
  const yb = bot(1 - rimR);
  const yt = top(1 - rimR);
  const ym = (yb + yt) / 2;
  const hr = Math.max(0.001, (yt - yb) / 2);
  for (let i = 1; i < 10; i++) {
    const a = -Math.PI / 2 + (i / 10) * Math.PI;
    pts.push([1 - rimR + Math.cos(a) * rimR, ym + Math.sin(a) * hr]);
  }
  for (let i = N; i >= 0; i--) {
    const r = (i / N) * (1 - rimR);
    pts.push([Math.max(0.0001, r), top(r)]);
  }
  const m = pick(rand, METALS);
  const finish = pick(rand, m.f);
  const hull = colorize(lathe(pts, 96), m.c);
  const topY = top(0);
  const botY = -bot(0);
  const glow = [];
  let halo = [0, 0, 0];
  if (spec.glow) {
    const tint = pick(rand, GLOW_TINTS);
    // A faint glow from the underside (a flat disc just below the hull) and a soft sheen.
    const under = [];
    for (let i = 0; i <= 16; i++) {
      const r = (i / 16) * 0.75;
      under.push([Math.max(0.0001, r), bot(r) - 0.004]);
    }
    glow.push({ geometry: lathe(under, 48), color: [tint[0] * 0.9, tint[1] * 0.9, tint[2] * 0.9], pulse: 0.25, shell: true });
    glow.push(glowShell(hull, tint, 0.18, 1.02));
    halo = [tint[0] * 0.45, tint[1] * 0.45, tint[2] * 0.45];
  }
  return { hull, finish, glow, info: { h: topY + botY, bottom: botY, halo, top: topY } };
}

// The pure sphere: gray to black, a subtle grainy surface.
function sphereUfo(spec) {
  const rand = rngFrom(spec.seed);
  const hull = colorize(new THREE.SphereGeometry(1, 72, 48), pick(rand, DARKS));
  const finish = rand() < 0.65 ? "grain" : "satin";
  const glow = [];
  let halo = [0, 0, 0];
  if (spec.glow) {
    const tint = pick(rand, GLOW_TINTS);
    glow.push(glowShell(hull, tint, 0.12, 1.03));
    halo = [tint[0] * 0.25, tint[1] * 0.35, tint[2] * 0.35];
  }
  return { hull, finish, glow, info: { h: 2, bottom: 1, halo, top: 1 } };
}

// A tic-tac: a smooth capsule, white or pale gray (along X).
function tictac(spec) {
  const rand = rngFrom(spec.seed);
  const r = 0.22 + rand() * 0.08;
  const len = 2 - r * 2 - 0.04;
  const hull = colorize(new THREE.CapsuleGeometry(r, len, 16, 40).rotateZ(Math.PI / 2), pick(rand, PALES));
  const finish = pick(rand, ["satin", "matte", "glossy", "satin"]);
  const glow = [];
  let halo = [0, 0, 0];
  if (spec.glow) {
    glow.push(glowShell(hull, [1.2, 1.22, 1.3], 0.3, 1.06));
    halo = [0.8, 0.82, 0.9];
  }
  return { hull, finish, glow, info: { h: r * 2, bottom: r, halo, top: r } };
}

// A pure ring (lying flat).
function torus(spec) {
  const rand = rngFrom(spec.seed);
  const tube = 0.1 + rand() * 0.12;
  const m = pick(rand, METALS);
  const hull = colorize(new THREE.TorusGeometry(1 - tube, tube, 28, 120).rotateX(Math.PI / 2), m.c);
  const glow = [];
  let halo = [0, 0, 0];
  if (spec.glow) {
    const tint = pick(rand, GLOW_TINTS);
    glow.push(glowShell(hull, tint, 0.3, 1.03));
    halo = [tint[0] * 0.4, tint[1] * 0.4, tint[2] * 0.4];
  }
  return { hull, finish: pick(rand, m.f), glow, info: { h: tube * 2, bottom: tube, halo, top: tube } };
}

// A flat shape (x, y) with its corners rounded (radius `rc`), as a THREE.Shape.
function roundedShape(pts, rc) {
  const shape = new THREE.Shape();
  const n = pts.length;
  for (let i = 0; i < n; i++) {
    const p = pts[i];
    const a = pts[(i + n - 1) % n];
    const b = pts[(i + 1) % n];
    const toward = (q) => {
      const dx = q[0] - p[0];
      const dy = q[1] - p[1];
      const l = Math.hypot(dx, dy) || 1;
      const k = Math.min(rc, l * 0.4) / l;
      return [p[0] + dx * k, p[1] + dy * k];
    };
    const e = toward(a);
    const x = toward(b);
    if (i === 0) shape.moveTo(e[0], e[1]);
    else shape.lineTo(e[0], e[1]);
    shape.quadraticCurveTo(p[0], p[1], x[0], x[1]);
  }
  shape.closePath();
  return shape;
}

// A flat slab from a shape in the XZ plane (shape y = -z: shape +y is the
// front, toward -Z), `th` thick, centered on y = 0, with bevelled edges.
function slab(shape, th, bevel) {
  const g = new THREE.ExtrudeGeometry(shape, { depth: th, bevelEnabled: true, bevelThickness: bevel, bevelSize: bevel, bevelSegments: 3, curveSegments: 10 });
  g.rotateX(-Math.PI / 2); // shape y -> -z, extrusion z -> +y
  g.translate(0, -th / 2, 0);
  return g;
}

// A small light: a ball at (x, y, z).
function lightBalls(points, r) {
  return merge(points.map(([x, y, z]) => colorize(new THREE.SphereGeometry(r, 10, 8).translate(x, y, z), 0xffffff)));
}

const LIGHT_TINTS = [[2.4, 2.3, 2.0], [2.6, 1.7, 0.7], [2.0, 2.4, 2.6], [2.5, 0.5, 0.3]];

// The black triangle: a large flat, dark triangle, nose toward -Z, with a dim
// light at each corner and a faint red one in the middle of the underside.
function triangle(spec) {
  const rand = rngFrom(spec.seed);
  const wide = 0.92 + rand() * 0.2;
  const R = 1;
  const pts = [
    [0, R],
    [0.866 * R * wide, -0.5 * R],
    [-0.866 * R * wide, -0.5 * R],
  ].reverse(); // (counter-clockwise seen from above)
  const th = 0.07 + rand() * 0.04;
  const bevel = 0.03;
  const hull = colorize(slab(roundedShape(pts, 0.07), th, bevel), pick(rand, DARKS), (x, y) => (y > 0 ? 1 : 0.8));
  const tint = pick(rand, LIGHT_TINTS);
  const under = -(th / 2 + bevel + 0.004);
  const corners = [
    [0, under, -R * 0.9],
    [0.866 * R * wide * 0.9, under, 0.5 * R * 0.9],
    [-0.866 * R * wide * 0.9, under, 0.5 * R * 0.9],
  ];
  const glow = [
    { geometry: lightBalls(corners, 0.042), color: tint.slice(), pulse: 0.1, shell: true },
    { geometry: lightBalls([[0, under, 0.04]], 0.07), color: [1.6, 0.3, 0.12], pulse: 0.35, shell: true },
  ];
  const halo = [0.13, 0.12, 0.11];
  return { hull, finish: rand() < 0.5 ? "matte" : "grain", glow, info: { h: th + bevel * 2, bottom: th / 2 + bevel, halo, top: th / 2 + bevel } };
}

// The boomerang (chevron): a wide, flat V, dark, with a row of dim lights
// along its leading edge.
function boomerang(spec) {
  const rand = rngFrom(spec.seed);
  const sweep = 0.26 + rand() * 0.12; // how far the wing tips trail behind the nose
  const arm = 0.2 + rand() * 0.08; // chord of the arms
  const pts = [
    [0, 0.5],
    [1.0, 0.5 - sweep * 2],
    [0.9, 0.5 - sweep * 2 - arm],
    [0, 0.5 - arm * 1.45],
    [-0.9, 0.5 - sweep * 2 - arm],
    [-1.0, 0.5 - sweep * 2],
  ].reverse();
  const th = 0.05 + rand() * 0.03;
  const bevel = 0.022;
  const hull = colorize(slab(roundedShape(pts, 0.05), th, bevel), pick(rand, DARKS), (x, y) => (y > 0 ? 1 : 0.8));
  const tint = pick(rand, LIGHT_TINTS.slice(0, 3));
  const under = -(th / 2 + bevel + 0.003);
  const lights = [];
  for (const sx of [-1, 1]) {
    for (let i = 1; i <= 5; i++) {
      const t = i / 5.6;
      lights.push([sx * 1.0 * t * 0.97, under, -(0.5 + (-sweep * 2 * t) - 0.01)]);
    }
  }
  lights.push([0, under, -0.5 + 0.03]);
  const glow = [{ geometry: lightBalls(lights, 0.026), color: tint.slice(), pulse: 0.08, shell: true }];
  const halo = [0.12, 0.1, 0.07];
  return { hull, finish: rand() < 0.5 ? "matte" : "satin", glow, info: { h: th + bevel * 2, bottom: th / 2 + bevel, halo, top: th / 2 + bevel } };
}

// The cylinder: a long metallic can along Z, flat ends with rounded edges and
// a few raised bands.
function cylinder(spec) {
  const rand = rngFrom(spec.seed);
  const r = 0.17 + rand() * 0.07;
  const m = pick(rand, METALS.slice(0, 6));
  const half = 1;
  const edge = r * 0.28;
  const pts = [[0.0001, -half], [r - edge, -half]];
  for (let i = 1; i <= 5; i++) {
    const a = (i / 5) * (Math.PI / 2);
    pts.push([r - edge + Math.sin(a) * edge, -half + edge - Math.cos(a) * edge]);
  }
  const bands = [-0.62, -0.2, 0.2, 0.62].slice(0, 2 + Math.floor(rand() * 3));
  for (const b of bands) {
    pts.push([r, b - 0.05], [r + 0.018, b - 0.03], [r + 0.018, b + 0.03], [r, b + 0.05]);
  }
  for (let i = 4; i >= 0; i--) {
    const a = (i / 5) * (Math.PI / 2);
    pts.push([r - edge + Math.sin(a) * edge, half - edge + Math.cos(a) * edge]);
  }
  pts.push([r - edge, half], [0.0001, half]);
  const hull = colorize(lathe(pts, 48).rotateX(Math.PI / 2), m.c);
  const glow = [];
  let halo = [0, 0, 0];
  if (spec.glow) {
    const tint = pick(rand, GLOW_TINTS);
    glow.push(glowShell(hull, tint, 0.25, 1.03));
    halo = [tint[0] * 0.35, tint[1] * 0.35, tint[2] * 0.35];
  }
  return { hull, finish: pick(rand, m.f), glow, info: { h: r * 2.1, bottom: r * 1.05, halo, top: r * 1.05 } };
}

const BUILDERS = {
  saucer: (s) => saucerHull(s, "lens"),
  saucer_disc: (s) => saucerHull(s, "disc"),
  saucer_domed: (s) => saucerHull(s, "domed"),
  sphere: sphereUfo,
  tictac,
  torus,
  triangle,
  boomerang,
  cylinder,
};

// Shared per variant: geometries. (A design has a handful of variants; the
// hull materials are shared per finish.)
const cache = new Map();
const materials = new Map();
let haloTexture = null;

function hullMaterial(finish) {
  let m = materials.get(finish);
  if (!m) {
    m = createEntityMaterial("color", null, { finish: FINISHES[finish] || FINISHES.satin });
    m.uniforms.uFill.value = 0.5; // ships in shade (backlit) still read as metal, not black holes
    materials.set(finish, m);
  }
  return m;
}

function haloTex() {
  if (haloTexture) return haloTexture;
  const size = 64;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, "rgba(255,255,255,1)");
  g.addColorStop(0.18, "rgba(255,255,255,0.55)");
  g.addColorStop(0.5, "rgba(255,255,255,0.12)");
  g.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  haloTexture = new THREE.CanvasTexture(canvas);
  haloTexture.colorSpace = THREE.SRGBColorSpace;
  return haloTexture;
}

const VARIANTS = 12;
function designData(spec) {
  const key = `${spec.design}:${spec.seed % VARIANTS}:${spec.glow ? 1 : 0}`;
  let d = cache.get(key);
  if (!d) {
    d = BUILDERS[spec.design]({ ...spec, seed: (spec.seed % VARIANTS) + 17 * (VARIANTS + 1) });
    d.key = key;
    cache.set(key, d);
  }
  return d;
}

// A charred copy of a hull geometry (a UFO that blew up): darkened, with
// burn marks.
function charredGeometry(data) {
  if (data.charred) return data.charred;
  const g = data.hull.clone();
  const col = g.getAttribute("color");
  const pos = g.getAttribute("position");
  for (let i = 0; i < col.count; i++) {
    const n = Math.sin(pos.getX(i) * 9.1 + pos.getY(i) * 7.3) * Math.sin(pos.getZ(i) * 8.3 - pos.getY(i) * 5.7);
    const k = 0.16 + 0.1 * (n * 0.5 + 0.5);
    col.setXYZ(i, col.getX(i) * k, col.getY(i) * k * 0.95, col.getZ(i) * k * 0.9);
  }
  data.charred = g;
  return g;
}

// Creates a UFO model. spec: a { design, seed, glow } look (or a design
// name); radius: size in blocks. Returns an object with root (THREE.Group),
// body, hull, halo, animate(t, state), setDead(), setCharred(), setFar().
export function createUfoModel(specIn, radius = 5, { castShadow = true } = {}) {
  const spec = normSpec(specIn);
  const data = designData(spec);
  const info = data.info;
  const design = spec.design;

  const root = new THREE.Group();
  const body = new THREE.Group(); // tilts / spins (crashes)
  body.scale.setScalar(radius);
  root.add(body);
  const light = { sky: 15, block: 0, flash: new THREE.Color(0, 0, 0), glow: 0 };

  const hull = new THREE.Mesh(data.hull, hullMaterial(data.finish));
  hull.castShadow = castShadow;
  hull.receiveShadow = false;
  body.add(hull);
  bindEntityLight(hull, () => light);

  const glows = [];
  for (const g of data.glow) {
    const mat = new THREE.MeshBasicMaterial({
      color: new THREE.Color(g.color[0], g.color[1], g.color[2]),
      transparent: true,
      opacity: g.shell ? 0.35 : 1,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.FrontSide,
    });
    const mesh = new THREE.Mesh(g.geometry, mat);
    mesh.renderOrder = 11;
    mesh.layers.set(LAYER_FX); // (after the water on High/Ultra, which drew over them; see layers.js)
    body.add(mesh);
    glows.push({ mesh, base: g.color, pulse: g.pulse || 0, shell: !!g.shell });
  }

  // A soft halo, so a glowing one reads as a light in the sky at night.
  const haloOn = info.halo[0] + info.halo[1] + info.halo[2] > 0;
  const halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: haloTex(), color: new THREE.Color(info.halo[0], info.halo[1], info.halo[2]), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, fog: false }));
  halo.scale.setScalar(radius * 3.2);
  halo.renderOrder = 12;
  halo.layers.set(LAYER_FX);
  halo.visible = haloOn;
  root.add(halo);

  const model = {
    design,
    spec,
    radius,
    root,
    body,
    hull,
    halo,
    light,
    lights: null,
    glows,
    info,
    finish: data.finish,
    glowing: glows.length > 0,
    bottom: info.bottom * radius, // underside, below the center
    height: info.h * radius,
    phase: Math.random() * 100,
    lightsOn: 1, // 0 = dark (crashed)
    far: false,
    dead: false,
    charred: false,
    // Shot down: it never glows again.
    setDead(dead = true) {
      model.dead = dead;
      if (dead) model.lightsOn = 0;
      for (const gl of glows) gl.mesh.visible = !dead && !(model.far && !gl.shell);
      if (dead) halo.visible = false;
    },
    // A wreck that blew up: darkened and burnt.
    setCharred(on = true) {
      if (on === model.charred) return;
      model.charred = on;
      model.setDead(on || model.dead);
      hull.geometry = on ? charredGeometry(data) : data.hull;
      hull.material = hullMaterial(on ? "charred" : data.finish);
      bindEntityLight(hull, () => light);
      hull.castShadow = castShadow;
    },
    // t: time (s). night: 0-1 (brighter halo at night). damage: 0-1.
    animate(t, { night = 1, damage = 0, beam = 0 } = {}) {
      t += model.phase;
      const dead = model.dead;
      const on = dead ? 0 : model.lightsOn;
      // A dead ship is shaded like unlit metal and burnt.
      if (dead) light.sky = Math.min(light.sky, model.charred ? 6 : 9);
      for (const gl of glows) {
        if (dead) {
          gl.mesh.visible = false;
          continue;
        }
        // A faint glow: barely there by day, a soft light at night.
        let k = (1 - gl.pulse + gl.pulse * (0.5 + 0.5 * Math.sin(t * 1.6))) * (0.12 + 0.88 * night);
        // A damaged ship's glow stutters.
        if (damage > 0.5 && Math.sin(t * 29) > 1.6 - damage) k *= 0.3;
        k *= on;
        gl.mesh.material.color.setRGB(gl.base[0] * k, gl.base[1] * k, gl.base[2] * k);
      }
      // The halo: strong at night, faint by day, brighter under the beam;
      // gone once it is dead.
      const hk = dead || !haloOn ? 0 : (0.08 + 0.7 * night) * on * (1 + beam * 0.8);
      halo.material.opacity = Math.min(1, hk);
      halo.visible = haloOn && !dead;
    },
    // Far away only the hull and the halo are drawn.
    setFar(far) {
      if (far === model.far) return;
      model.far = far;
      for (const gl of glows) gl.mesh.visible = (!far || gl.shell) && !model.dead;
      hull.castShadow = !far && castShadow;
    },
    dispose() {
      for (const gl of glows) gl.mesh.material.dispose();
      halo.material.dispose();
    },
  };
  return model;
}
