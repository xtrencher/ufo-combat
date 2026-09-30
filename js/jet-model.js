// A stealth fighter modelled on the F-22 Raptor, built from simple
// procedural pieces in the game's style: an angular, chined fuselage lofted
// from diamond-ish cross sections, a gold-tinted bubble canopy, caret
// intakes, diamond wings, all-moving tailplanes, twin vertical tails canted
// outward, and twin engines with square thrust-vectoring nozzles and an
// afterburner glow that grows with the throttle.
//
// Detail: a dark radome and pitot probe, weapon-bay and panel lines,
// leading-edge flaps, engine nozzle petals, retractable landing gear (down
// on the ground, folded away in the air), wingtip navigation lights and a
// layered afterburner (white-hot core, orange plume, shock diamonds).
// `paint`: "raptor" (the player's grey) or "enemy" (charcoal with red).
//
// Model space: nose toward -Z, up +Y, right +X; about 15 blocks long.
import * as THREE from "three";
import { createEntityMaterial, bindEntityLight } from "./shaders.js";
import { LAYER_FX } from "./layers.js";

const PAINTS = {
  raptor: { grey: 0x6f777f, dark: 0x535a62, light: 0x8d959c, accent: 0x3a3e44, canopy: 0xb89a3c },
  enemy: { grey: 0x4a4e56, dark: 0x2c2f35, light: 0x60646e, accent: 0x8a1c1c, canopy: 0x8a3030 },
};
// The paint's surface: satin with a soft sheen (the sun and the moon glint
// on it), panel lines in a staggered grid, and a subtle two-tone livery.
const FINISH = {
  raptor: { spec: 0.75, gloss: 42, env: 0.3, grain: 0.02, panel: 0.3, panelScale: 0.9, livery: 0.16, liveryScale: 0.26 },
  enemy: { spec: 0.8, gloss: 50, env: 0.35, grain: 0.02, panel: 0.32, panelScale: 0.9, livery: 0.22, liveryScale: 0.3 },
};
let GREY = PAINTS.raptor.grey;
let GREY_DARK = PAINTS.raptor.dark;
let GREY_LIGHT = PAINTS.raptor.light;

function colorize(geo, hex, shade = null) {
  // (new THREE.Color(hex) is already linear: converting it again made the
  // whole jet nearly black, which is why it was a silhouette at night.)
  const c = new THREE.Color(hex);
  const pos = geo.getAttribute("position");
  const col = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) {
    const k = shade ? shade(pos.getX(i), pos.getY(i), pos.getZ(i)) : 1;
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

// A faceted (flat-shaded) solid lofted through cross sections along Z.
// sections: [{ z, pts: [[x, y], ...] }] with the same point count, going
// around the section; the ends are capped.
function loft(sections) {
  const pos = [];
  const tri = (a, b, c) => pos.push(...a, ...b, ...c);
  for (let s = 0; s < sections.length - 1; s++) {
    const A = sections[s];
    const B = sections[s + 1];
    const n = A.pts.length;
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      const a0 = [A.pts[i][0], A.pts[i][1], A.z];
      const a1 = [A.pts[j][0], A.pts[j][1], A.z];
      const b0 = [B.pts[i][0], B.pts[i][1], B.z];
      const b1 = [B.pts[j][0], B.pts[j][1], B.z];
      tri(a0, b0, a1);
      tri(a1, b0, b1);
    }
  }
  // End caps (fans), facing out: -Z at the first section, +Z at the last
  // (the points go clockwise seen from +Z).
  for (const [sec, flip] of [[sections[0], true], [sections[sections.length - 1], false]]) {
    const c = sec.pts.reduce((acc, p) => [acc[0] + p[0] / sec.pts.length, acc[1] + p[1] / sec.pts.length], [0, 0]);
    for (let i = 0; i < sec.pts.length; i++) {
      const j = (i + 1) % sec.pts.length;
      const a = [sec.pts[i][0], sec.pts[i][1], sec.z];
      const b = [sec.pts[j][0], sec.pts[j][1], sec.z];
      const m = [c[0], c[1], sec.z];
      if (flip) tri(m, a, b);
      else tri(m, b, a);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.computeVertexNormals();
  return g;
}

// A flat plate (wing, tail) from an outline in its own plane, `t` thick,
// with bevelled edges; returned lying in X/Z (y = thickness).
function plate(outline, t) {
  const shape = new THREE.Shape(outline.map(([x, z]) => new THREE.Vector2(x, z)));
  const g = new THREE.ExtrudeGeometry(shape, { depth: t, bevelEnabled: true, bevelThickness: t * 0.4, bevelSize: t * 0.6, bevelSegments: 1 });
  g.rotateX(Math.PI / 2); // shape x/y -> x/z, extrusion downward
  g.translate(0, t / 2, 0);
  return g;
}

// Fuselage cross section: a flattened hexagon with sharp chines at the
// sides (w = half width, h = half height, c = chine height).
function section(z, w, top, bottom, chine = 0) {
  return {
    z,
    pts: [
      [0, top],
      [w * 0.55, top * 0.8],
      [w, chine],
      [w * 0.7, -bottom * 0.75],
      [0, -bottom],
      [-w * 0.7, -bottom * 0.75],
      [-w, chine],
      [-w * 0.55, top * 0.8],
    ],
  };
}

const cachedByPaint = {};

function buildGeometry(paint = "raptor") {
  if (cachedByPaint[paint]) return cachedByPaint[paint];
  const pal = PAINTS[paint] || PAINTS.raptor;
  GREY = pal.grey;
  GREY_DARK = pal.dark;
  GREY_LIGHT = pal.light;
  const parts = [];
  // Fuselage: the pointed nose, the widening chined forebody, the broad
  // body between the intakes and engines, and the tail end.
  const fus = loft([
    section(-7.6, 0.02, 0.02, 0.02),
    section(-6.6, 0.32, 0.26, 0.2),
    section(-5.2, 0.62, 0.48, 0.34, 0.05),
    section(-3.6, 0.95, 0.66, 0.44, 0.08),
    section(-1.8, 1.45, 0.72, 0.55, 0.06),
    section(0.8, 1.7, 0.66, 0.6, 0.04),
    section(3.6, 1.6, 0.56, 0.52, 0.02),
    section(5.6, 1.35, 0.42, 0.42, 0.0),
    section(6.6, 1.25, 0.36, 0.36, 0.0),
  ]);
  parts.push(colorize(fus, GREY, (x, y, z) => (y > 0 ? 1.05 : 0.86) * (Math.abs(x) > 1.2 && z > -2 && z < 3 ? 0.95 : 1)));
  // Caret intakes on both sides, just behind the cockpit.
  for (const s of [1, -1]) {
    // Mirrored points run the other way round: reverse them on the left so
    // the faces still point outward.
    const ring = (pts) => (s > 0 ? pts : pts.slice().reverse());
    const intake = loft([
      { z: -2.6, pts: ring([[s * 1.1, 0.45], [s * 1.75, 0.2], [s * 1.75, -0.45], [s * 1.1, -0.5]]) },
      { z: 0.6, pts: ring([[s * 1.35, 0.5], [s * 2.0, 0.3], [s * 2.0, -0.55], [s * 1.35, -0.6]]) },
      { z: 2.4, pts: ring([[s * 1.3, 0.35], [s * 1.7, 0.2], [s * 1.7, -0.45], [s * 1.3, -0.5]]) },
    ]);
    parts.push(colorize(intake, GREY_DARK));
    // The dark intake mouth.
    parts.push(colorize(new THREE.PlaneGeometry(0.62, 0.9).rotateY(s > 0 ? 0.35 : -0.35).translate(s * 1.44, -0.12, -2.62), 0x101216));
  }
  // Wings: the Raptor's diamond planform (swept leading edge, forward-swept
  // trailing edge), from the body out to the clipped tip.
  for (const s of [1, -1]) {
    const w = plate(
      [
        [s * 1.4, -2.2],
        [s * 6.6, 1.6],
        [s * 6.6, 2.4],
        [s * 4.4, 3.0],
        [s * 1.5, 3.9],
      ],
      0.14
    );
    w.translate(0, -0.12, 0);
    parts.push(colorize(w, GREY, (x, y, z) => (y > -0.1 ? 1.02 : 0.84)));
    // Horizontal tailplanes.
    const t = plate(
      [
        [s * 1.2, 4.7],
        [s * 4.3, 6.3],
        [s * 4.3, 6.95],
        [s * 1.2, 7.3],
      ],
      0.1
    );
    t.translate(0, -0.2, 0);
    parts.push(colorize(t, GREY));
    // Vertical tails, canted outward ~28 degrees.
    const fin = plate(
      [
        [0, 3.4],
        [0, 6.2],
        [3.1, 6.8],
        [3.1, 5.4],
      ],
      0.09
    );
    // The plate lies in X/Z; stand it up (X -> Y) and lean it outward.
    fin.rotateZ(Math.PI / 2);
    fin.rotateZ(-s * 0.49);
    fin.translate(s * 1.05, 0.35, 0);
    parts.push(colorize(fin, GREY, () => 0.97));
  }
  // Engine nozzles: square, two-dimensional thrust vectoring.
  for (const s of [1, -1]) {
    const noz = new THREE.BoxGeometry(0.95, 0.62, 1.2);
    noz.translate(s * 0.62, -0.02, 7.0);
    parts.push(colorize(noz, 0x3a3e44));
    const inner = new THREE.PlaneGeometry(0.72, 0.42).rotateY(Math.PI);
    inner.translate(s * 0.62, -0.02, 7.61);
    parts.push(colorize(inner, 0x0c0d0f));
  }
  // Landing gear doors / belly details (a darker strip) and a probe light.
  parts.push(colorize(new THREE.BoxGeometry(1.2, 0.05, 5).translate(0, -0.58, 0.8), GREY_DARK));
  // Radome (dark nose cone) and the pitot probe.
  parts.push(colorize(new THREE.ConeGeometry(0.3, 1.5, 8).rotateX(-Math.PI / 2).translate(0, 0, -6.95), pal.accent));
  parts.push(colorize(new THREE.CylinderGeometry(0.025, 0.025, 1.3, 5).rotateX(Math.PI / 2).translate(0, 0, -8.05), 0xb8bcc2));
  // Weapon bays (long dark outlines under the belly) and panel lines on the back.
  for (const x of [-0.42, 0.42]) parts.push(colorize(new THREE.BoxGeometry(0.03, 0.02, 3.2).translate(x, -0.6, -0.9), 0x22252a));
  parts.push(colorize(new THREE.BoxGeometry(0.9, 0.02, 0.03).translate(0, -0.6, -2.5), 0x22252a));
  parts.push(colorize(new THREE.BoxGeometry(0.9, 0.02, 0.03).translate(0, -0.6, 0.7), 0x22252a));
  for (const z of [-1.2, 1.5, 3.4]) parts.push(colorize(new THREE.BoxGeometry(2.4, 0.015, 0.03).translate(0, 0.62, z), GREY_DARK));
  parts.push(colorize(new THREE.BoxGeometry(0.03, 0.015, 6).translate(0, 0.66, 0.4), GREY_DARK));
  // Wing leading-edge flaps and trailing-edge flaperons (darker strips).
  for (const s of [1, -1]) {
    parts.push(colorize(new THREE.BoxGeometry(4.6, 0.03, 0.22).rotateY(s * -0.62).translate(s * 4.0, -0.04, 0.05), GREY_DARK));
    parts.push(colorize(new THREE.BoxGeometry(3.4, 0.03, 0.35).rotateY(s * 0.2).translate(s * 3.4, -0.04, 3.55), GREY_DARK));
    // A red / dark accent on the tail fins (roundel-free markings).
    const stripe = new THREE.BoxGeometry(0.03, 0.5, 0.9).rotateZ(-s * 0.49).translate(s * 2.1, 1.75, 6.0);
    parts.push(colorize(stripe, pal.accent));
  }
  // Engine nozzle petals: a ring of small plates around each nozzle.
  for (const s of [1, -1]) {
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      const petal = new THREE.BoxGeometry(0.2, 0.03, 0.55).rotateZ(a).translate(s * 0.62 + Math.cos(a) * 0.5, -0.02 + Math.sin(a) * 0.34, 7.45);
      parts.push(colorize(petal, 0x2a2d32));
    }
  }
  // More detail: the gun port on the right shoulder, AoA probes, antenna
  // blades under the belly, static wicks on the wing and tail tips, light
  // intake lips, and the canopy frame and bow.
  parts.push(colorize(new THREE.BoxGeometry(0.22, 0.05, 0.5).translate(1.25, 0.52, -1.6), 0x15171a));
  for (const s of [1, -1]) {
    parts.push(colorize(new THREE.CylinderGeometry(0.015, 0.02, 0.35, 4).rotateZ(s * 1.2).translate(s * 0.42, 0.05, -5.9), 0xb8bcc2));
    parts.push(colorize(new THREE.BoxGeometry(0.06, 0.04, 2.1).translate(s * 1.46, 0.46, -1.55), pal.light));
    for (const [x, z] of [[6.55, 2.35], [4.25, 6.9]]) parts.push(colorize(new THREE.CylinderGeometry(0.012, 0.012, 0.45, 4).rotateX(Math.PI / 2).translate(s * x, -0.1, z + 0.2), 0x2a2d32));
  }
  for (const z of [-0.6, 2.2]) parts.push(colorize(new THREE.BoxGeometry(0.03, 0.28, 0.4).translate(0, -0.72, z), GREY_DARK));
  // The canopy frame: a dark rim around its base and a bow across it.
  parts.push(colorize(new THREE.TorusGeometry(1, 0.035, 5, 40).rotateX(Math.PI / 2).scale(0.53, 1, 1.91).translate(0, 0.43, -3.9), 0x2b2e33));
  parts.push(colorize(new THREE.TorusGeometry(1, 0.035, 5, 20, Math.PI).scale(0.52, 0.49, 1).translate(0, 0.42, -3.05), 0x2b2e33));
  // The pilot: a seat, a grey helmet with a dark visor.
  parts.push(colorize(new THREE.BoxGeometry(0.42, 0.55, 0.3).translate(0, 0.55, -3.35), 0x202226));
  parts.push(colorize(new THREE.SphereGeometry(0.17, 10, 8).translate(0, 0.86, -3.6), 0x9ca2a8));
  parts.push(colorize(new THREE.SphereGeometry(0.14, 10, 8).scale(1, 0.7, 0.6).translate(0, 0.86, -3.72), 0x121417));
  const hull = merge(parts);

  // Canopy: a long, gold-tinted bubble.
  const canopy = new THREE.SphereGeometry(1, 20, 10, 0, Math.PI * 2, 0, Math.PI / 2);
  canopy.scale(0.52, 0.5, 1.9);
  canopy.translate(0, 0.42, -3.9);

  cachedByPaint[paint] = { hull, canopy, pal };
  return cachedByPaint[paint];
}

// Landing gear: strut, wheel(s) and a door plate, hanging down from a pivot
// at the origin (the strut's top). Returns { group, wheelGeo shared }.
function gearLeg(wheels, wheelR, len, spread) {
  const parts = [];
  parts.push(colorize(new THREE.CylinderGeometry(0.07, 0.07, len, 6).translate(0, -len / 2, 0), 0xb8bcc2));
  for (const w of wheels) {
    parts.push(colorize(new THREE.CylinderGeometry(wheelR, wheelR, 0.2, 12).rotateZ(Math.PI / 2).translate(w, -len, 0), 0x16171a));
    parts.push(colorize(new THREE.CylinderGeometry(wheelR * 0.5, wheelR * 0.5, 0.22, 8).rotateZ(Math.PI / 2).translate(w, -len, 0), 0x9aa0a8));
  }
  parts.push(colorize(new THREE.BoxGeometry(spread, 0.05, 0.3).translate(0, -0.3, 0), GREY_DARK));
  return merge(parts);
}

function flameTexture() {
  const w = 16;
  const h = 64;
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  // Bright at the nozzle (the cone's base, v = 0: the bottom of the canvas).
  const g = ctx.createLinearGradient(0, h, 0, 0);
  g.addColorStop(0, "rgba(255,255,255,1)");
  g.addColorStop(0.15, "rgba(255,230,180,0.95)");
  g.addColorStop(0.45, "rgba(255,140,60,0.6)");
  g.addColorStop(1, "rgba(120,60,255,0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
  const t = new THREE.CanvasTexture(canvas);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

let flameTex = null;

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

// Creates a jet model: { root, light, setThrottle(throttle, afterburner, t),
// setGear(0-1, 1 = down), setLights(t, night) }.
export function createJetModel(scale = 1, { paint = "raptor" } = {}) {
  const { hull, canopy, pal } = buildGeometry(paint);
  const root = new THREE.Group();
  const body = new THREE.Group();
  body.scale.setScalar(scale);
  root.add(body);
  const light = { sky: 15, block: 0, flash: new THREE.Color(0, 0, 0) };
  const hullMat = createEntityMaterial("color", null, { finish: FINISH[paint] || FINISH.raptor });
  // (A little ambient fill so it reads as a shape, not a hole, in the shade and at night.)
  hullMat.uniforms.uFill.value = 0.45;
  const hullMesh = new THREE.Mesh(hull, hullMat);
  hullMesh.castShadow = true;
  bindEntityLight(hullMesh, () => light);
  body.add(hullMesh);
  const canopyMesh = new THREE.Mesh(canopy, new THREE.MeshStandardMaterial({ color: pal.canopy, metalness: 0.9, roughness: 0.15, envMapIntensity: 1, transparent: true, opacity: 0.85 }));
  body.add(canopyMesh);
  // Landing gear: nose leg forward, main legs under the intakes.
  GREY_DARK = pal.dark;
  const gearMat = createEntityMaterial("color");
  const mkGear = (geo, x, y, z) => {
    const m = new THREE.Mesh(geo, gearMat);
    m.position.set(x, y, z);
    m.castShadow = true;
    bindEntityLight(m, () => light);
    body.add(m);
    return m;
  };
  const noseGeo = gearLeg([-0.13, 0.13], 0.2, 0.65, 0.5);
  const mainGeo = gearLeg([0], 0.3, 0.6, 0.5);
  const gear = { nose: mkGear(noseGeo, 0, -0.5, -4.6), left: mkGear(mainGeo, -1.6, -0.45, 2.0), right: mkGear(mainGeo, 1.6, -0.45, 2.0) };
  let gearT = 1;
  // Afterburner flames: layered additive cones out of each nozzle.
  if (!flameTex) flameTex = flameTexture();
  const flames = [];
  for (const s of [1, -1]) {
    // Wide at the nozzle (z = 0), tapering to a point behind (z = 1).
    const cone = new THREE.ConeGeometry(0.34, 1, 12, 1, true).rotateX(Math.PI / 2).translate(0, 0, 0.5);
    const mat = new THREE.MeshBasicMaterial({ map: flameTex, color: new THREE.Color(3, 2, 1.4), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: true });
    const flame = new THREE.Mesh(cone, mat);
    flame.position.set(s * 0.62, -0.02, 7.62);
    flame.layers.set(LAYER_FX);
    flame.renderOrder = 12;
    body.add(flame);
    // The white-hot core inside the plume.
    const core = new THREE.Mesh(new THREE.ConeGeometry(0.2, 1, 10, 1, true).rotateX(Math.PI / 2).translate(0, 0, 0.5), new THREE.MeshBasicMaterial({ color: new THREE.Color(4, 4.2, 5), transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: true }));
    core.position.set(s * 0.62, -0.02, 7.62);
    core.layers.set(LAYER_FX);
    core.renderOrder = 13;
    body.add(core);
    // Shock diamonds: bright beads along the afterburner plume.
    const diamonds = [];
    for (let i = 0; i < 4; i++) {
      const d = new THREE.Sprite(new THREE.SpriteMaterial({ map: softGlowTexture(), color: new THREE.Color(3.2, 3.4, 5), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, fog: false }));
      d.layers.set(LAYER_FX);
      d.visible = false;
      d.position.set(s * 0.62, -0.02, 8.4 + i * 0.95);
      body.add(d);
      diamonds.push(d);
    }
    // A hot glowing disc inside the nozzle, and a soft halo behind it.
    const glow = new THREE.Mesh(new THREE.PlaneGeometry(0.7, 0.4).rotateY(Math.PI), new THREE.MeshBasicMaterial({ color: new THREE.Color(2.5, 1.2, 0.5), fog: true }));
    glow.position.set(s * 0.62, -0.02, 7.6);
    body.add(glow);
    const halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: softGlowTexture(), color: new THREE.Color(2, 1.1, 0.5), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, fog: false }));
    halo.layers.set(LAYER_FX);
    halo.position.set(s * 0.62, -0.02, 7.9);
    halo.scale.setScalar(1.5);
    body.add(halo);
    flames.push({ flame, core, glow, halo, diamonds });
  }
  // Navigation lights: red (left) and green (right) wingtips, white tail strobes.
  const navSprite = (color, x, y, z, size) => {
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: softGlowTexture(), color, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, fog: false }));
    sp.layers.set(LAYER_FX);
    sp.position.set(x, y, z);
    sp.scale.setScalar(size);
    body.add(sp);
    return sp;
  };
  const nav = [navSprite(new THREE.Color(4, 0.2, 0.2), -6.6, -0.05, 2.0, 0.9), navSprite(new THREE.Color(0.2, 4, 0.3), 6.6, -0.05, 2.0, 0.9), navSprite(new THREE.Color(4, 4, 4.5), -3.6, 2.2, 6.4, 0.8), navSprite(new THREE.Color(4, 4, 4.5), 3.6, 2.2, 6.4, 0.8)];
  // Formation ("slime") lights: soft green strips on the fuselage sides and
  // the tails, and the cockpit's dim instrument glow; night only too.
  const stripGeo = new THREE.PlaneGeometry(0.08, 0.9);
  const stripMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(0.3, 1.6, 0.5), fog: true, side: THREE.DoubleSide });
  const strips = [];
  for (const s of [1, -1]) {
    for (const [x, y, z, rz] of [[1.72, 0.05, 0.8, 0], [2.3, 1.4, 5.3, -s * 0.49]]) {
      const m = new THREE.Mesh(stripGeo, stripMat);
      m.rotation.set(Math.PI / 2, s > 0 ? Math.PI / 2 : -Math.PI / 2, 0);
      m.rotation.z = rz;
      m.position.set(s * x, y, z);
      m.layers.set(LAYER_FX);
      body.add(m);
      strips.push(m);
    }
  }
  const cockpitGlow = navSprite(new THREE.Color(0.15, 0.5, 0.25), 0, 0.7, -4.2, 0.9);
  // Off until setLights says it is night.
  for (const o of [...nav, ...strips, cockpitGlow]) o.visible = false;
  return {
    root,
    body,
    light,
    hull: hullMesh,
    canopy: canopyMesh,
    length: 15.2 * scale,
    span: 13.2 * scale,
    // throttle 0-1; afterburner: long, bright blue-white flames.
    setThrottle(throttle, afterburner, t) {
      for (const f of flames) {
        const flicker = 0.9 + Math.sin(t * 43 + f.flame.position.x * 7) * 0.1;
        const len = afterburner ? 5.6 + Math.sin(t * 31) * 0.5 : 0.4 + throttle * 1.8;
        f.flame.scale.set(afterburner ? 1.15 : 0.8, afterburner ? 1.15 : 0.8, len * flicker);
        f.flame.visible = throttle > 0.05 || afterburner;
        f.flame.material.color.setRGB(afterburner ? 2.2 : 3, afterburner ? 2.2 : 1.6, afterburner ? 3.2 : 0.8);
        f.flame.material.opacity = afterburner ? 1 : 0.35 + throttle * 0.5;
        f.core.visible = f.flame.visible && throttle > 0.3;
        f.core.scale.set(afterburner ? 1.05 : 0.7, afterburner ? 1.05 : 0.7, len * 0.55 * flicker);
        f.core.material.opacity = afterburner ? 0.95 : 0.35 * throttle;
        for (let i = 0; i < f.diamonds.length; i++) {
          const d = f.diamonds[i];
          d.visible = afterburner;
          if (afterburner) d.scale.setScalar((0.55 - i * 0.09) * (0.85 + 0.25 * Math.sin(t * 60 + i * 2)));
        }
        const g = 0.4 + throttle * 1.6 + (afterburner ? 2 : 0);
        f.glow.material.color.setRGB(g * 1.3, g * 0.6, g * 0.3);
        f.halo.visible = throttle > 0.05;
        f.halo.material.color.setRGB(g * 0.8, g * 0.4, g * 0.25 + (afterburner ? 0.5 : 0));
        f.halo.scale.setScalar(1.2 + throttle * 1.2 + (afterburner ? 1.6 : 0));
      }
    },
    // 1 = wheels down (on the ground, taking off), 0 = folded away.
    setGear(down) {
      gearT = down;
      const v = down > 0.02;
      for (const g of Object.values(gear)) g.visible = v;
      // The nose leg folds forward, the main legs inward.
      gear.nose.rotation.x = (1 - down) * 1.5;
      gear.left.rotation.z = (1 - down) * -1.4;
      gear.right.rotation.z = (1 - down) * 1.4;
      gear.nose.position.y = -0.5 + (1 - down) * 0.2;
    },
    get gear() {
      return gearT;
    },
    // Wingtip navigation lights, tail strobes, formation lights and the
    // cockpit glow: switched on only at night (t: time; dark: 0-1 night).
    setLights(t, dark = 0) {
      const on = dark > 0.3;
      const k = Math.min(1, (dark - 0.3) / 0.25);
      const strobe = (t % 1.2) < 0.08 || ((t % 1.2) > 0.4 && (t % 1.2) < 0.47);
      nav[0].visible = nav[1].visible = on;
      nav[0].material.color.setRGB(4 * k, 0.2 * k, 0.2 * k);
      nav[1].material.color.setRGB(0.2 * k, 4 * k, 0.3 * k);
      nav[2].visible = nav[3].visible = on && strobe;
      for (const m of strips) m.visible = on;
      stripMat.color.setRGB(0.3 * k, 1.6 * k, 0.5 * k);
      cockpitGlow.visible = on;
      // The ambient fill (so the jet reads as a shape in the dark) is a night thing.
      hullMat.uniforms.uFill.value = 0.08 + 0.5 * dark;
      cockpitGlow.material.color.setRGB(0.15 * k, 0.5 * k, 0.25 * k);
    },
    get lightsOn() {
      return nav[0].visible;
    },
  };
}
