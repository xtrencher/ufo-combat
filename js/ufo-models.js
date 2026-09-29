// Procedural UFO models. The classic flying saucer is the most common shape,
// with lots of variety between individual saucers (dome height, hull
// profile, colors, portholes, rims, antennas, landing gear), plus a saucer
// with a very tall cockpit dome. There are two contrasting styles:
//   - detailed ships (grooved hulls with panel seams, domes, portholes,
//     rings of lights, engines), and
//   - perfectly smooth minimal ones: a plain lens-shaped saucer, or a pure
//     sphere that is nothing but a sphere (one mesh, no lights, no halo).
// Some UFOs glow (lights, glowing domes, an underside glow, a halo at night);
// others are dark and give off no light at all (matte black, no lights).
// Then the odd shapes: orbs, tic-tacs, pyramids, black triangles, cigars,
// rings, spinning diamonds and a cube inside a sphere.
//
// A model is built at a radius of 1 and scaled to its size (a small scout is
// a few blocks across, a giant the size of a football field). Every model has
// a lit hull (geometry shared per variant), its lights as ONE instanced mesh
// (blinking / chasing / color-cycling patterns are written into the instance
// colors each frame), optional glowing parts, a soft halo sprite that makes
// it read as a light in the sky at night, and a cheap "far" version. The same
// model is used for enemy UFOs, crashed wrecks and the player's own UFO, so a
// crashed UFO keeps its shape when boarded and flown. A shot-down UFO goes
// dark for good (setDead) and a wreck that blew up is charred and broken.
import * as THREE from "three";
import { createEntityMaterial, bindEntityLight } from "./shaders.js";

// Every design; the first ones are the saucer family (the most common).
export const UFO_DESIGNS = ["saucer", "saucer_tall", "saucer_smooth", "saucer_dark", "sphere", "orb", "tictac", "pyramid", "triangle", "cigar", "ring", "diamond", "cubesphere"];

export const UFO_DESIGN_NAMES = {
  saucer: "Flying saucer",
  saucer_tall: "Tall-dome saucer",
  saucer_smooth: "Smooth saucer",
  saucer_dark: "Dark saucer",
  sphere: "Sphere",
  orb: "Orb",
  tictac: "Tic-tac",
  pyramid: "Pyramid",
  triangle: "Black triangle",
  cigar: "Cigar",
  ring: "Ring",
  diamond: "Diamond",
  cubesphere: "Cube in a sphere",
};

// How often each design appears (saucers are by far the most common).
const DESIGN_WEIGHTS = { saucer: 30, saucer_tall: 8, saucer_smooth: 9, saucer_dark: 8, sphere: 7, orb: 4, tictac: 5, pyramid: 5, triangle: 5, cigar: 4, ring: 4, diamond: 3, cubesphere: 3 };

// Designs that never glow (matte black, no lights).
const ALWAYS_DARK = new Set(["saucer_dark"]);

// A random UFO look: { design, seed, glow }. glow: true/false forces it.
export function randomUfoSpec(rng = Math.random, { glow, design } = {}) {
  let d = design;
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
  const g = glow !== undefined ? glow : ALWAYS_DARK.has(d) ? false : rng() < 0.62;
  return { design: d, seed, glow: ALWAYS_DARK.has(d) ? false : g };
}

function normSpec(spec) {
  if (typeof spec === "string") return { design: BUILDERS[spec] ? spec : "saucer", seed: 0, glow: !ALWAYS_DARK.has(spec) && !spec.includes("dark") };
  const design = BUILDERS[spec.design] ? spec.design : "saucer";
  return { design, seed: spec.seed | 0, glow: ALWAYS_DARK.has(design) ? false : !!spec.glow };
}

// Which laser color a UFO of this look fires (see ufos.js).
export function ufoLaserKey(spec) {
  const s = normSpec(spec);
  const lists = s.glow ? ["green", "cyan", "blue", "magenta", "green"] : ["red", "orange", "red", "magenta"];
  if (s.design === "sphere" || s.design === "orb") return ["orange", "magenta", "cyan"][s.seed % 3];
  return lists[s.seed % lists.length];
}

// How each design sits in space: `h` is its height and `bottom` how far its
// underside hangs below its center (radius-1 units); halo color (linear).
// Saucers compute theirs per variant.
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

// Radial panel seams (darker narrow bands between panels) around Y, and an
// optional soft vertical gradient (brighter on top).
function seams(count, dark = 0.8, grad = 0.18) {
  return (x, y, z) => {
    const a = Math.atan2(z, x);
    const f = (a / (Math.PI * 2)) * count;
    const near = Math.abs(f - Math.round(f));
    const seam = near < 0.035 ? dark : 1;
    return seam * (1 + grad * Math.max(-1, Math.min(1, y * 3)));
  };
}

// A ring of lights: [{ pos, size, color }] around Y at radius r, height y.
function lightRing(n, r, y, size, color = null, phase = 0) {
  const out = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 + phase;
    out.push({ pos: [Math.cos(a) * r, y, Math.sin(a) * r], size, color });
  }
  return out;
}

// ---------- Palettes ----------

// [hull, underside, trim, dome glow (HDR, linear), underglow]
const LIGHT_PALETTES = [
  { hull: 0xb9c6d4, under: 0x6f7f92, trim: 0x8aa0b4, dome: [0.35, 1.5, 1.2], under_glow: [0.5, 2.6, 2.4] }, // silver and teal
  { hull: 0xd9dde2, under: 0x8e959d, trim: 0xa9b1ba, dome: [0.5, 1.2, 2.4], under_glow: [0.6, 1.4, 3] }, // pearl and blue
  { hull: 0xc8b070, under: 0x7a6a3f, trim: 0xe0c878, dome: [2.4, 1.6, 0.4], under_glow: [3, 1.8, 0.5] }, // brushed gold
  { hull: 0xb87a55, under: 0x6a4030, trim: 0xd99a70, dome: [2.6, 1.0, 0.4], under_glow: [3, 1.2, 0.4] }, // copper
  { hull: 0x9fb8a8, under: 0x55705f, trim: 0x7fa090, dome: [0.5, 2.4, 0.9], under_glow: [0.6, 3, 1.1] }, // jade
  { hull: 0xb9b0d8, under: 0x655d88, trim: 0x8f86b8, dome: [1.6, 0.6, 2.6], under_glow: [2, 0.7, 3] }, // violet
  { hull: 0xe8e8ec, under: 0xa0a4ab, trim: 0xc0c4cb, dome: [1.6, 1.6, 1.6], under_glow: [2, 2, 2] }, // white
];
const DARK_PALETTES = [
  { hull: 0x18191c, under: 0x0d0e10, trim: 0x25272b }, // matte black
  { hull: 0x272b31, under: 0x14171b, trim: 0x353a42 }, // gunmetal
  { hull: 0x1c1f1c, under: 0x0e100e, trim: 0x2a2e2a }, // dark olive
  { hull: 0x211a1c, under: 0x100c0d, trim: 0x2f2528 }, // dark maroon
];

function palette(rand, glowing) {
  const list = glowing ? LIGHT_PALETTES : DARK_PALETTES;
  return list[Math.floor(rand() * list.length)];
}

// ---------- Hull designs (radius 1) ----------
// Each returns { hull: BufferGeometry, glow: [{ geometry, color, pulse }],
// lights: [{ pos: [x,y,z], size, color: [r,g,b] (linear, HDR) or null (cycling) }],
// pattern, info: { h, bottom, halo } } where pattern names how the lights animate.

// The classic detailed saucer. opts: { glowing, dome: "low" | "mid" | "tall" }.
function saucer(spec, opts) {
  const rand = rngFrom(spec.seed);
  const glowing = spec.glow;
  const pal = palette(rand, glowing);
  const dome = opts.dome || ["low", "mid", "mid", "bubble"][Math.floor(rand() * 4)];
  const thick = 0.2 + rand() * 0.12; // how deep the underside bulges
  const rimY = 0.0;
  const panelCount = [8, 12, 16, 20][Math.floor(rand() * 4)];
  // Underside: a shallow bowl with a rounded rim and a few grooves.
  const under = [[0, -thick], [0.16, -thick + 0.005], [0.2, -thick + 0.03], [0.28, -thick + 0.03], [0.32, -thick + 0.012]];
  const steps = 5;
  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    const r = 0.32 + t * 0.62;
    const y = -thick * (1 - Math.pow(t, 1.5)) - (i % 2 === 0 ? 0.006 : 0);
    under.push([r, y]);
  }
  under.push([1.0, -0.035], [1.015, -0.01], [1.015, 0.012]);
  // Upper hull: a sloping shoulder up to the dome's base, with a raised ring.
  const domeR = dome === "tall" ? 0.28 : dome === "bubble" ? 0.36 : 0.34;
  const shoulder = 0.13 + rand() * 0.05;
  const top = [[1.015, 0.012], [0.99, 0.035], [0.9, 0.07], [0.78, 0.095], [0.7, 0.088], [0.68, 0.11], [0.62, 0.115], [0.55, 0.13], [0.42, shoulder + 0.02], [domeR + 0.04, shoulder + 0.05], [domeR, shoulder + 0.05]];
  const lowerG = colorize(lathe(under), pal.under, seams(panelCount, 0.8, 0));
  const upperG = colorize(lathe(top), pal.hull, seams(panelCount, 0.78, 0.5));
  const rimBand = colorize(new THREE.CylinderGeometry(1.02, 1.02, 0.03, 64, 1, true), pal.trim);
  const parts = [lowerG, upperG, rimBand];
  const glow = [];
  const lights = [];
  const domeBaseY = shoulder + 0.05;
  let domeH = 0.2;
  if (dome === "tall") domeH = 0.62 + rand() * 0.1;
  else if (dome === "mid") domeH = 0.27;
  else if (dome === "bubble") domeH = 0.34;
  // The cockpit dome (glass): a lathe from the base up to the point/curve.
  const dp = [];
  const N = 14;
  for (let i = 0; i <= N; i++) {
    const t = i / N;
    const shape = dome === "tall" ? Math.pow(1 - t * t, 0.55) : Math.sqrt(1 - t * t);
    dp.push([Math.max(0.0001, domeR * shape), domeBaseY + domeH * t]);
  }
  dp.reverse();
  const domeGeo = lathe(dp, 40);
  if (glowing) {
    glow.push({ geometry: domeGeo, color: pal.dome, pulse: 0.15 });
    // A bright inner core so the dome looks lit from within.
    glow.push({ geometry: new THREE.SphereGeometry(domeR * 0.32, 12, 8).translate(0, domeBaseY + domeH * 0.35, 0), color: [pal.dome[0] * 1.6, pal.dome[1] * 1.6, pal.dome[2] * 1.6], pulse: 0.3 });
    glow.push({ geometry: new THREE.CircleGeometry(0.42, 40).rotateX(Math.PI / 2).translate(0, -thick - 0.004, 0), color: pal.under_glow, pulse: 0.35 });
    glow.push({ geometry: new THREE.RingGeometry(0.55, 0.62, 48).rotateX(Math.PI / 2).translate(0, -thick * 0.62, 0), color: [pal.under_glow[0] * 0.7, pal.under_glow[1] * 0.7, pal.under_glow[2] * 0.7], pulse: 0.5 });
  } else {
    parts.push(colorize(domeGeo, 0x14181d, (x, y) => 0.7 + y * 0.6));
  }
  // Dome ribs on tall domes: thin tubes following the dome's curve.
  if (dome === "tall") {
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
      const pts = dp.map(([r, y]) => new THREE.Vector3(Math.cos(a) * (r + 0.004), y, Math.sin(a) * (r + 0.004)));
      pts.reverse();
      parts.push(colorize(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 18, 0.008, 5), pal.trim));
    }
  }
  // A ring of small portholes on the shoulder and a ring of big lights on the rim.
  const rimN = glowing ? 14 + Math.floor(rand() * 3) * 4 : 0;
  lights.push(...lightRing(rimN, 1.0, 0.0, glowing ? 0.05 : 0, null));
  if (glowing && rand() < 0.75) lights.push(...lightRing(panelCount, 0.75, 0.098, 0.022, [1.8, 2.2, 3], Math.PI / panelCount));
  // Dark ships: a few dim cold blinkers only... none at all (no light).
  // Landing gear: three struts with pads.
  const legR = 0.5 + rand() * 0.12;
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2 + 0.4;
    const x = Math.cos(a) * legR;
    const z = Math.sin(a) * legR;
    const y0 = -thick + 0.05;
    const strut = colorize(new THREE.CylinderGeometry(0.012, 0.018, 0.13, 6).translate(x, y0 - 0.05, z), pal.trim);
    const pad = colorize(new THREE.CylinderGeometry(0.05, 0.06, 0.018, 12).translate(x, y0 - 0.125, z), pal.under);
    parts.push(strut, pad);
  }
  // An antenna on the shoulder, on some.
  if (rand() < 0.55 && dome !== "tall") {
    const ax = 0.5;
    parts.push(colorize(new THREE.CylinderGeometry(0.006, 0.01, 0.22, 5).translate(ax, shoulder + 0.15, 0.1), pal.trim));
    parts.push(colorize(new THREE.SphereGeometry(0.02, 8, 6).translate(ax, shoulder + 0.26, 0.1), pal.trim));
    if (glowing) lights.push({ pos: [ax, shoulder + 0.26, 0.1], size: 0.026, color: [3, 0.4, 0.3] });
  }
  // A second, raised ring on some.
  if (rand() < 0.5) {
    parts.push(colorize(new THREE.TorusGeometry(0.66, 0.018, 8, 64).rotateX(Math.PI / 2).translate(0, 0.115, 0), pal.trim));
  }
  const top_h = domeBaseY + domeH;
  return {
    hull: merge(parts),
    glow,
    lights,
    pattern: glowing ? "chase-cycle" : "none",
    info: { h: top_h + thick, bottom: thick + 0.13, halo: glowing ? [pal.dome[0] * 0.5, pal.dome[1] * 0.5, pal.dome[2] * 0.5] : [0, 0, 0], top: top_h },
    dark: !glowing,
  };
}

// The perfectly smooth, minimal saucer: one lens-shaped surface.
function saucerSmooth(spec) {
  const rand = rngFrom(spec.seed);
  const glowing = spec.glow;
  const h = 0.13 + rand() * 0.13;
  const pts = [];
  const N = 36;
  for (let i = 0; i <= N; i++) {
    const t = (i / N) * Math.PI; // bottom (0) to top (PI) along the profile
    // A lens: radius follows sin, height a flattened cosine.
    pts.push([Math.max(0.0001, Math.sin(t)), -Math.cos(t) * h * (t < Math.PI / 2 ? 1 : 1.25)]);
  }
  const shades = [0xc4cbd2, 0xe6e8ea, 0x9aa3ad, 0xd8c99a, 0x8ea6b8, 0x1a1b1e];
  const color = glowing ? shades[Math.floor(rand() * 5)] : 0x151619;
  const hull = colorize(lathe(pts, 72), color, (x, y) => 0.88 + Math.max(-0.12, Math.min(0.25, y / h) * 0.14));
  const glow = [];
  if (glowing) {
    // A soft glow all over (a slightly larger, additive lens).
    const gp = pts.map(([x, y]) => [x * 1.012 + 0.0001, y * 1.03]);
    const tint = [[0.6, 1.2, 1.6], [1.2, 1.2, 1.4], [1.6, 1.1, 0.5], [0.6, 1.6, 0.9]][Math.floor(rand() * 4)];
    glow.push({ geometry: lathe(gp, 48), color: [tint[0] * 0.5, tint[1] * 0.5, tint[2] * 0.5], pulse: 0.25, shell: true });
  }
  return { hull: merge([hull]), glow, lights: [], pattern: "none", info: { h: h * 2.25, bottom: h, halo: glowing ? [0.5, 0.8, 1.1] : [0, 0, 0] }, dark: !glowing, smooth: true };
}

// The pure sphere: nothing but a sphere. One mesh. A "glowing" one is a
// sphere that itself gives off light (its material, not an extra part).
function sphereUfo(spec) {
  const rand = rngFrom(spec.seed);
  const glowing = spec.glow;
  const options = glowing ? [[1.6, 1.0, 0.35], [0.5, 1.5, 2.2], [1.7, 0.5, 1.6], [1.4, 1.5, 1.5]] : [null];
  const chrome = [0xc9ced4, 0x9aa1a9, 0x2a2c30, 0xd8d2c0];
  const tint = glowing ? options[Math.floor(rand() * options.length)] : null;
  const color = glowing ? 0xffffff : [0x18191c, 0x1f2124, 0x2a2c30, 0x121316][Math.floor(rand() * 4)];
  const geo = colorize(new THREE.SphereGeometry(1, 72, 48), color, (x, y) => 1);
  geo.setAttribute("uv", new THREE.BufferAttribute(new Float32Array(geo.getAttribute("position").count * 2), 2));
  return { hull: geo, glow: [], lights: [], pattern: "none", info: { h: 2, bottom: 1, halo: [0, 0, 0] }, dark: !glowing, sphere: true, sphereGlow: tint, noHalo: true };
}

function tictac(spec) {
  const rand = rngFrom(spec.seed);
  const glowing = spec.glow;
  const body = colorize(new THREE.CapsuleGeometry(0.28, 1.44, 12, 32).rotateZ(Math.PI / 2), 0xf2f4f6, (x, y) => 0.9 + y * 0.28);
  const seam = colorize(new THREE.TorusGeometry(0.281, 0.004, 6, 32).rotateY(Math.PI / 2).translate(0.3, 0, 0), 0xc4c8cc);
  const seam2 = colorize(new THREE.TorusGeometry(0.281, 0.004, 6, 32).rotateY(Math.PI / 2).translate(-0.3, 0, 0), 0xc4c8cc);
  const lights = [
    { pos: [0, -0.2, 0], size: 0.1, color: [1.2, 1.2, 1.3] },
    { pos: [0.98, 0, 0], size: 0.05, color: [1.5, 1.5, 2] },
    { pos: [-0.98, 0, 0], size: 0.05, color: [1.5, 1.5, 2] },
  ];
  return { hull: merge([body, seam, seam2]), glow: [], lights: glowing ? lights : [], pattern: "breathe", info: { h: 0.56, bottom: 0.28, halo: glowing ? [1.2, 1.2, 1.25] : [0, 0, 0] }, dark: !glowing };
}

function orb(spec) {
  return {
    hull: merge([colorize(new THREE.SphereGeometry(0.2, 12, 8), 0x333333)]),
    glow: [
      { geometry: new THREE.SphereGeometry(0.6, 32, 20), color: [1.8, 0.95, 0.3], pulse: 0.3, cycle: true },
      { geometry: new THREE.TorusGeometry(0.75, 0.018, 8, 64).rotateX(Math.PI / 2), color: [2.2, 1.6, 0.6], pulse: 0.5, cycle: true },
      { geometry: new THREE.TorusGeometry(0.75, 0.014, 8, 64).rotateX(Math.PI / 2 + 0.6), color: [2.2, 1.6, 0.6], pulse: 0.5, cycle: true },
    ],
    lights: [],
    pattern: "none",
    info: { h: 1.2, bottom: 0.6, halo: [1.6, 0.9, 0.25] },
  };
}

function pyramid(spec) {
  const glowing = spec.glow;
  const body = colorize(new THREE.ConeGeometry(0.95, 1.1, 4, 1).rotateY(Math.PI / 4).translate(0, 0.45, 0), 0x2a2a31, (x, y) => 0.8 + y * 0.35);
  const base = colorize(new THREE.BoxGeometry(1.34, 0.1, 1.34).translate(0, -0.05, 0), 0x1c1c22);
  const tip = colorize(new THREE.ConeGeometry(0.1, 0.16, 4, 1).rotateY(Math.PI / 4).translate(0, 1.05, 0), 0x3a3a44);
  // Edge ridges up the four corners.
  const ridges = [];
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2;
    const rx = Math.cos(a) * 0.475;
    const rz = Math.sin(a) * 0.475;
    ridges.push(colorize(new THREE.CylinderGeometry(0.008, 0.016, 1.12, 5).translate(rx, 0.45, rz).rotateY(0), 0x4a4a55));
  }
  const lights = [];
  for (const [x, z] of [[0.67, 0.67], [-0.67, 0.67], [0.67, -0.67], [-0.67, -0.67]]) lights.push({ pos: [x, -0.08, z], size: 0.09, color: [3, 3, 2.6] });
  lights.push({ pos: [0, 1.0, 0], size: 0.08, color: [0.4, 3, 0.6] });
  return {
    hull: merge([body, base, tip, ...ridges]),
    glow: glowing ? [{ geometry: new THREE.PlaneGeometry(0.9, 0.9).rotateX(Math.PI / 2).translate(0, -0.105, 0), color: [0.3, 1.8, 0.5], pulse: 0.4 }] : [],
    lights: glowing ? lights : [],
    pattern: "corners",
    info: { h: 1.1, bottom: 0.1, halo: glowing ? [0.3, 1.4, 0.4] : [0, 0, 0] },
    dark: !glowing,
  };
}

function triangle(spec) {
  const shape = new THREE.Shape();
  const r = 1.0;
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2 + Math.PI / 2;
    if (i === 0) shape.moveTo(Math.cos(a) * r, Math.sin(a) * r);
    else shape.lineTo(Math.cos(a) * r, Math.sin(a) * r);
  }
  shape.closePath();
  const body = colorize(new THREE.ExtrudeGeometry(shape, { depth: 0.12, bevelEnabled: true, bevelThickness: 0.04, bevelSize: 0.05, bevelSegments: 2 }).rotateX(-Math.PI / 2).translate(0, -0.06, 0), 0x16171b, (x, y) => 0.9 + y * 1.2);
  const lights = [];
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2 + Math.PI / 2;
    lights.push({ pos: [Math.cos(a) * 0.86, -0.1, -Math.sin(a) * 0.86], size: 0.1, color: [3, 2.9, 2.6] });
  }
  lights.push({ pos: [0, -0.12, 0], size: 0.14, color: [3.2, 0.25, 0.15] });
  return { hull: merge([body]), glow: [], lights: spec.glow ? lights : [], pattern: "triangle", info: { h: 0.2, bottom: 0.12, halo: spec.glow ? [1.2, 0.25, 0.2] : [0, 0, 0] }, dark: !spec.glow };
}

function cigar(spec) {
  const glowing = spec.glow;
  const body = colorize(new THREE.CapsuleGeometry(0.23, 1.5, 12, 32).rotateZ(Math.PI / 2), 0x8d9299, (x, y) => (Math.abs(y) < 0.02 ? 0.7 : 0.9 + y * 0.3));
  const fin = colorize(new THREE.BoxGeometry(0.28, 0.02, 0.16).translate(-0.9, 0.1, 0), 0x5a5f66);
  const fin2 = colorize(new THREE.BoxGeometry(0.28, 0.16, 0.02).translate(-0.9, 0.06, 0), 0x5a5f66);
  const lights = [];
  for (let i = 0; i < 9; i++) {
    const x = -0.72 + (i / 8) * 1.44;
    lights.push({ pos: [x, 0.02, 0.228], size: 0.035, color: [3, 2.2, 0.8] });
    lights.push({ pos: [x, 0.02, -0.228], size: 0.035, color: [3, 2.2, 0.8] });
  }
  lights.push({ pos: [-1.0, 0, 0], size: 0.09, color: [3, 1.2, 0.3] });
  return { hull: merge([body, fin, fin2]), glow: [], lights: glowing ? lights : [], pattern: "windows", info: { h: 0.46, bottom: 0.23, halo: glowing ? [1.4, 1.1, 0.4] : [0, 0, 0] }, dark: !glowing };
}

function ring(spec) {
  const glowing = spec.glow;
  const torus = colorize(new THREE.TorusGeometry(0.82, 0.13, 14, 64).rotateX(Math.PI / 2), 0x6e6a78, (x, y) => 0.85 + y * 0.8);
  const spokes = [];
  for (let i = 0; i < 3; i++) spokes.push(colorize(new THREE.BoxGeometry(1.6, 0.04, 0.06).rotateY((i / 3) * Math.PI), 0x4a4652));
  const lights = [];
  for (let i = 0; i < 16; i++) {
    const a = (i / 16) * Math.PI * 2;
    lights.push({ pos: [Math.cos(a) * 0.82, -0.12, Math.sin(a) * 0.82], size: 0.045, color: null });
  }
  return {
    hull: merge([torus, ...spokes]),
    glow: glowing ? [{ geometry: new THREE.SphereGeometry(0.24, 20, 12), color: [1.6, 0.5, 2.2], pulse: 0.5, cycle: true }] : [],
    lights: glowing ? lights : [],
    pattern: "chase-cycle",
    info: { h: 0.3, bottom: 0.15, halo: glowing ? [0.9, 0.3, 1.4] : [0, 0, 0] },
    dark: !glowing,
  };
}

function diamond(spec) {
  const glowing = spec.glow;
  const body = colorize(new THREE.OctahedronGeometry(0.8, 0).scale(1, 1.0, 1), 0x6a4f8c, (x, y) => 0.7 + Math.abs(y) * 0.5);
  return {
    hull: merge([body]),
    glow: glowing ? [{ geometry: new THREE.OctahedronGeometry(0.34, 0).scale(1, 1.6, 1), color: [1.4, 0.6, 2.6], pulse: 0.4, cycle: true }] : [],
    lights: glowing
      ? [
          { pos: [0, 0.82, 0], size: 0.06, color: [2.8, 2.6, 3] },
          { pos: [0, -0.82, 0], size: 0.06, color: [2.8, 2.6, 3] },
          { pos: [0.8, 0, 0], size: 0.05, color: null },
          { pos: [-0.8, 0, 0], size: 0.05, color: null },
          { pos: [0, 0, 0.8], size: 0.05, color: null },
          { pos: [0, 0, -0.8], size: 0.05, color: null },
        ]
      : [],
    pattern: "cycle",
    info: { h: 1.6, bottom: 0.8, halo: glowing ? [0.8, 0.4, 1.6] : [0, 0, 0] },
    dark: !glowing,
  };
}

function cubesphere(spec) {
  const cube = colorize(new THREE.BoxGeometry(0.62, 0.62, 0.62).rotateX(0.6).rotateZ(0.6), 0x101014);
  return {
    hull: merge([cube]),
    glow: [{ geometry: new THREE.SphereGeometry(0.8, 32, 20), color: [0.12, 0.25, 0.5], pulse: 0.3, shell: true }],
    lights: [{ pos: [0, 0, 0], size: 0.02, color: [0.2, 0.3, 0.6] }],
    pattern: "breathe",
    info: { h: 1.6, bottom: 0.8, halo: [0.5, 0.8, 1.6] },
    keepGlow: true, // its shell is a shadow-like dark sphere, not a light
  };
}

const BUILDERS = {
  saucer: (s) => saucer(s, {}),
  saucer_tall: (s) => saucer(s, { dome: "tall" }),
  saucer_smooth: saucerSmooth,
  saucer_dark: (s) => saucer({ ...s, glow: false }, {}),
  sphere: sphereUfo,
  orb,
  tictac,
  pyramid,
  triangle,
  cigar,
  ring,
  diamond,
  cubesphere,
};

// Shared per variant: geometries. (A design has a handful of variants; the
// hull material is shared.)
const cache = new Map();
let hullMaterial = null;
let lightGeometry = null;
let haloTexture = null;

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

const VARIANTS = 10;
function designData(spec) {
  const key = `${spec.design}:${spec.seed % VARIANTS}:${spec.glow ? 1 : 0}`;
  let d = cache.get(key);
  if (!d) {
    d = BUILDERS[spec.design]({ ...spec, seed: spec.seed % VARIANTS + 17 * (VARIANTS + 1) });
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

const _c = new THREE.Color();
const _m = new THREE.Matrix4();

// Creates a UFO model. spec: a { design, seed, glow } look (or a design
// name); radius: size in blocks. Returns an object with root (THREE.Group),
// body, hull, halo, animate(t, state), setDead(), setCharred(), setFar().
export function createUfoModel(specIn, radius = 5, { castShadow = true } = {}) {
  const spec = normSpec(specIn);
  const data = designData(spec);
  const info = data.info;
  const design = spec.design;
  if (!hullMaterial) {
    hullMaterial = createEntityMaterial("color");
    hullMaterial.uniforms.uFill.value = 0.55; // ships in shade (backlit) still read as metal, not black holes
  }
  if (!lightGeometry) lightGeometry = new THREE.SphereGeometry(1, 8, 6);

  const root = new THREE.Group();
  const body = new THREE.Group(); // tilts / spins (crashes, the orb's spin)
  body.scale.setScalar(radius);
  root.add(body);
  const light = { sky: 15, block: 0, flash: new THREE.Color(0, 0, 0), glow: 0 };

  let hullMat = hullMaterial;
  let sphereMat = null;
  if (data.sphere && data.sphereGlow) {
    // A glowing sphere: its own material is the light (nothing else is added).
    sphereMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(data.sphereGlow[0], data.sphereGlow[1], data.sphereGlow[2]) });
    hullMat = sphereMat;
  }
  const hull = new THREE.Mesh(data.hull, hullMat);
  hull.castShadow = castShadow && !(data.sphere && data.sphereGlow);
  hull.receiveShadow = false;
  body.add(hull);
  bindEntityLight(hull, () => light);

  const glows = [];
  for (const g of data.glow) {
    const mat = new THREE.MeshBasicMaterial({
      color: new THREE.Color(g.color[0], g.color[1], g.color[2]),
      transparent: !!g.shell,
      opacity: g.shell ? 0.35 : 1,
      blending: g.shell ? THREE.AdditiveBlending : THREE.NormalBlending,
      depthWrite: !g.shell,
      side: g.shell ? THREE.DoubleSide : THREE.FrontSide,
    });
    const mesh = new THREE.Mesh(g.geometry, mat);
    body.add(mesh);
    glows.push({ mesh, base: g.color, pulse: g.pulse || 0, cycle: !!g.cycle, shell: !!g.shell, keep: !!data.keepGlow });
  }

  let lights = null;
  if (data.lights.length) {
    const mat = new THREE.MeshBasicMaterial({ color: 0xffffff });
    lights = new THREE.InstancedMesh(lightGeometry, mat, data.lights.length);
    lights.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(data.lights.length * 3), 3);
    data.lights.forEach((l, i) => {
      _m.makeScale(l.size, l.size, l.size).setPosition(l.pos[0], l.pos[1], l.pos[2]);
      lights.setMatrixAt(i, _m);
      lights.setColorAt(i, _c.setRGB(1, 1, 1));
    });
    lights.frustumCulled = false;
    body.add(lights);
  }

  // A soft halo, so it reads as a light in the sky from far away (not on
  // dark ships or the pure sphere).
  const haloOn = !data.noHalo && !data.dark && info.halo[0] + info.halo[1] + info.halo[2] > 0;
  const halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: haloTex(), color: new THREE.Color(info.halo[0], info.halo[1], info.halo[2]), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, fog: false }));
  halo.scale.setScalar(radius * 3.2);
  halo.renderOrder = 12;
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
    lights,
    glows,
    info,
    bottom: info.bottom * radius, // underside, below the center
    height: info.h * radius,
    phase: Math.random() * 100,
    hue: Math.random(),
    lightsOn: 1, // 0 = dark (crashed), flickers in between
    far: false,
    dead: false,
    charred: false,
    // Shot down: every light goes off for good.
    setDead(dead = true) {
      model.dead = dead;
      if (dead) model.lightsOn = 0;
    },
    // A wreck that blew up: darkened and burnt, its dome gone.
    setCharred(on = true) {
      if (on === model.charred) return;
      model.charred = on;
      model.setDead(on || model.dead);
      hull.geometry = on ? charredGeometry(data) : data.hull;
      for (const gl of glows) gl.mesh.visible = !on;
      if (sphereMat) sphereMat.color.setRGB(0.05, 0.05, 0.05);
      hull.castShadow = castShadow;
    },
    // t: time (s). night: 0-1 (brighter halo at night). damage: 0-1.
    animate(t, { night = 1, damage = 0, beam = 0, speed = 0 } = {}) {
      t += model.phase;
      const dead = model.dead;
      const on = dead ? 0 : model.lightsOn;
      // A dead ship is shaded like unlit metal and burnt.
      if (dead) light.sky = Math.min(light.sky, model.charred ? 6 : 9);
      if (sphereMat && !model.charred) {
        const k = dead ? 0.03 : 0.85 + 0.15 * Math.sin(t * 1.7);
        sphereMat.color.setRGB(data.sphereGlow[0] * k, data.sphereGlow[1] * k, data.sphereGlow[2] * k);
      }
      // Lights.
      if (lights) {
        const n = data.lights.length;
        for (let i = 0; i < n; i++) {
          const l = data.lights[i];
          let k = 1;
          let r = l.color ? l.color[0] : 1;
          let g = l.color ? l.color[1] : 1;
          let b = l.color ? l.color[2] : 1;
          switch (data.pattern) {
            case "chase-cycle": {
              k = 0.25 + 0.75 * Math.max(0, Math.cos(((i / n) * Math.PI * 2 - t * (3 + speed * 0.05)) * 1)) ** 3;
              if (!l.color) {
                _c.setHSL((model.hue + i / n + t * 0.05) % 1, 1, 0.5);
                r = _c.r * 3.2;
                g = _c.g * 3.2;
                b = _c.b * 3.2;
              }
              break;
            }
            case "corners":
              k = i === 4 ? 0.6 + 0.4 * Math.sin(t * 3) : (t * 0.9 + i * 0.25) % 1 < 0.18 ? 1 : 0.15;
              break;
            case "triangle":
              k = i === n - 1 ? 0.5 + 0.5 * Math.sin(t * 5) : 0.85 + 0.15 * Math.sin(t * 1.3 + i);
              break;
            case "windows":
              k = 0.35 + 0.65 * (Math.sin(t * 4 - (i >> 1) * 0.7) > 0.3 ? 1 : 0.2);
              break;
            case "cycle": {
              if (!l.color) {
                _c.setHSL((model.hue + t * 0.12 + i * 0.25) % 1, 1, 0.5);
                r = _c.r * 3;
                g = _c.g * 3;
                b = _c.b * 3;
              }
              k = 0.6 + 0.4 * Math.sin(t * 2 + i);
              break;
            }
            case "breathe":
              k = 0.6 + 0.4 * Math.sin(t * 1.5);
              break;
            default:
              break;
          }
          // Damage: lights stutter.
          if (damage > 0.5 && Math.sin(t * 37 + i * 11) > 1.6 - damage) k *= 0.1;
          k *= on;
          lights.setColorAt(i, _c.setRGB(r * k, g * k, b * k));
        }
        lights.instanceColor.needsUpdate = true;
      }
      for (const gl of glows) {
        if (dead && !gl.keep) {
          gl.mesh.visible = false;
          continue;
        }
        let k = 1 - gl.pulse + gl.pulse * (0.5 + 0.5 * Math.sin(t * 2.2));
        k *= 0.15 + 0.85 * on;
        if (gl.cycle) {
          _c.setHSL((model.hue + t * 0.07) % 1, 0.85, 0.55);
          const bright = Math.max(gl.base[0], gl.base[1], gl.base[2]);
          gl.mesh.material.color.setRGB(_c.r * bright * k, _c.g * bright * k, _c.b * bright * k);
        } else {
          gl.mesh.material.color.setRGB(gl.base[0] * k, gl.base[1] * k, gl.base[2] * k);
        }
      }
      // The halo: strong at night, faint by day, brighter under the beam;
      // gone once it is dead.
      const hk = dead ? 0 : (0.12 + 0.7 * night) * (0.2 + 0.8 * on) * (1 + beam * 0.8);
      halo.material.opacity = Math.min(1, hk);
      if (design === "diamond") model.body.rotation.y = t * 0.6;
      if (design === "ring" && glows[0]) glows[0].mesh.position.y = Math.sin(t * 1.3) * 0.05;
      if (design === "cubesphere") hull.rotation.y = t * 0.25;
    },
    // Far away only the hull and the halo are drawn (2 draw calls).
    setFar(far) {
      if (far === model.far) return;
      model.far = far;
      if (lights) lights.visible = !far;
      for (const gl of glows) gl.mesh.visible = (!far || gl.shell) && !(model.dead && !gl.keep);
      hull.castShadow = !far && castShadow && !(data.sphere && data.sphereGlow);
    },
    dispose() {
      for (const gl of glows) gl.mesh.material.dispose();
      if (sphereMat) sphereMat.dispose();
      if (lights) {
        lights.material.dispose();
        lights.dispose();
      }
      halo.material.dispose();
    },
  };
  return model;
}
