// Two fighters, built from simple procedural pieces: a stealth fighter
// modelled on the F-22 Raptor (below) and a light fighter modelled on the
// F-16 Fighting Falcon (buildF16Geometry). The Raptor, built from simple
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
// `paint`: "raptor" (the player's grey) or "enemy" (charcoal with red);
// `type`: "f22" or "f16".
//
// Model space: nose toward -Z, up +Y, right +X; about 15 blocks long.
import * as THREE from "three";
import { createEntityMaterial, bindEntityLight } from "./shaders.js";
import { LAYER_FX } from "./layers.js";

const PAINTS = {
  raptor: { grey: 0x6f777f, dark: 0x535a62, light: 0x8d959c, accent: 0x3a3e44, canopy: 0xb89a3c },
  enemy: { grey: 0x4a4e56, dark: 0x2c2f35, light: 0x60646e, accent: 0x8a1c1c, canopy: 0x8a3030 },
  // The patrol fighters: slate blue-grey with a sand accent.
  patrol: { grey: 0x56606c, dark: 0x3d4550, light: 0x6c7784, accent: 0xa8842a, canopy: 0x6f7c88 },
  // The Falcon's two-tone air-superiority grey, a darker radome and a smoky gold canopy.
  falcon: { grey: 0x87909a, dark: 0x656d76, light: 0xa3abb3, accent: 0x4a5058, canopy: 0x9c8a4c },
  // (Round 8) More colour schemes for the aircraft at the airports.
  green: { grey: 0x5d6b4a, dark: 0x45503a, light: 0x76855f, accent: 0x353d2c, canopy: 0xa8933f },
  lightblue: { grey: 0x8eadc4, dark: 0x6d8ba3, light: 0xadc8db, accent: 0x55708a, canopy: 0x9c8a4c },
  desert: { grey: 0xb39a74, dark: 0x8f7a5a, light: 0xcbb592, accent: 0x6f5e44, canopy: 0x8f7d45 },
  navy: { grey: 0x4a5a72, dark: 0x36435a, light: 0x637590, accent: 0x283246, canopy: 0xb89a3c },
  arctic: { grey: 0xc4cbd2, dark: 0x9aa3ac, light: 0xdde2e7, accent: 0x7d8792, canopy: 0x8c7c48 },
};
// The schemes an aircraft can come in ("gray": the type's own grey).
export const PAINT_SCHEMES = ["gray", "green", "lightblue", "desert", "navy", "arctic"];
// The paint's surface: satin with a soft sheen (the sun and the moon glint
// on it), panel lines in a staggered grid, and a subtle two-tone livery.
// The skin: coating patches of slightly different shades, exhaust soot at
// the tail, faint grime streaks along the airflow.
const FINISH = {
  raptor: { spec: 0.75, gloss: 42, env: 0.3, grain: 0.025, panel: 0.3, panelScale: 0.9, livery: 0.16, liveryScale: 0.26, skin: { tone: 0.09, soot: 0.45, sootZ: 5.2, streaks: 0.06 } },
  enemy: { spec: 0.8, gloss: 50, env: 0.35, grain: 0.025, panel: 0.32, panelScale: 0.9, livery: 0.22, liveryScale: 0.3, skin: { tone: 0.08, soot: 0.4, sootZ: 5.2, streaks: 0.07 } },
  patrol: { spec: 0.8, gloss: 48, env: 0.33, grain: 0.025, panel: 0.3, panelScale: 0.9, livery: 0.2, liveryScale: 0.28, skin: { tone: 0.08, soot: 0.4, sootZ: 5.2, streaks: 0.07 } },
  falcon: { spec: 0.85, gloss: 55, env: 0.32, grain: 0.02, panel: 0.28, panelScale: 1.1, livery: 0.14, liveryScale: 0.3, skin: { tone: 0.07, soot: 0.5, sootZ: 4.6, streaks: 0.05 } },
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

// A movable control surface: its geometry (coloured, in body space) moved so
// that its hinge (`pivot`) is at the origin, the hinge axis, and what it does:
// kind "stab" (an all-moving tailplane: elevator and a little aileron),
// "ail" (a flaperon on the wing's trailing edge) or "rud" (a rudder). The
// axis always points the same way on both sides (outboard +X-ish, or up), so
// a positive deflection lowers the trailing edge: pitch up = negative.
function movable(geo, pivot, axis, kind, side) {
  const g = geo.clone().translate(-pivot.x, -pivot.y, -pivot.z);
  return { geo: merge([g]), pivot: pivot.toArray(), axis: axis.clone().normalize().toArray(), kind, side };
}

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
  // trailing edge), from the body out to the clipped tip, with a flaperon on
  // the trailing edge (it moves: see setControls). Tailplanes (all-moving),
  // and twin vertical tails canted outward ~28 degrees with rudders.
  const surfaces = [];
  const navTail = [];
  const stripPts = [];
  for (const s of [1, -1]) {
    const w = plate(
      [
        [s * 1.4, -2.2],
        [s * 6.6, 1.6],
        [s * 6.6, 2.4],
        [s * 6.2, 2.509],
        [s * 6.2, 2.009],
        [s * 2.0, 3.245],
        [s * 2.0, 3.745],
        [s * 1.5, 3.9],
      ],
      0.14
    );
    w.translate(0, -0.12, 0);
    parts.push(colorize(w, GREY, (x, y, z) => (y > -0.1 ? 1.02 : 0.84)));
    const flap = plate(
      [
        [s * 2.0, 3.245],
        [s * 2.0, 3.745],
        [s * 4.4, 3.0],
        [s * 6.2, 2.509],
        [s * 6.2, 2.009],
        [s * 4.4, 2.5],
      ],
      0.1
    );
    flap.translate(0, -0.12, 0);
    surfaces.push(movable(colorize(flap, GREY, (x, y, z) => (y > -0.1 ? 1.0 : 0.82)), new THREE.Vector3(s * 2.0, -0.12, 3.245), new THREE.Vector3(4.2, 0, 1.236 * (s > 0 ? -1 : 1) * 1), "ail", s));
    // Horizontal tailplanes: all-moving, hinged at about 40% of the chord.
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
    surfaces.push(movable(colorize(t, GREY), new THREE.Vector3(s * 1.2, -0.2, 5.9), new THREE.Vector3(1, 0, 0), "stab", s));
    // Vertical tails: the plate lies in X/Z; stand it up (X -> Y) and lean it
    // outward. The rudder is the trailing part of it.
    const M = new THREE.Matrix4().makeTranslation(s * 1.05, 0.35, 0).multiply(new THREE.Matrix4().makeRotationZ(-s * 0.49)).multiply(new THREE.Matrix4().makeRotationZ(Math.PI / 2));
    const fin = plate(
      [
        [0, 3.4],
        [0, 5.5],
        [3.1, 5.95],
        [3.1, 5.4],
      ],
      0.09
    ).applyMatrix4(M);
    parts.push(colorize(fin, GREY, () => 0.97));
    const rud = plate(
      [
        [0, 5.5],
        [0, 6.2],
        [3.1, 6.8],
        [3.1, 5.95],
      ],
      0.09
    ).applyMatrix4(M);
    const h0 = new THREE.Vector3(0, 0, 5.5).applyMatrix4(M);
    const h1 = new THREE.Vector3(3.1, 0, 5.95).applyMatrix4(M);
    surfaces.push(movable(colorize(rud, GREY, () => 0.93), h0, h1.clone().sub(h0), "rud", s));
    // The fin's tip light and the formation-light strip on its outer face.
    const tip = new THREE.Vector3(3.1, 0, 6.1).applyMatrix4(M);
    const out = new THREE.Vector3(0, 1, 0).transformDirection(M).multiplyScalar(0.07);
    navTail.push(tip.clone().add(new THREE.Vector3(0, 0.02, 0)).toArray());
    stripPts.push({ at: new THREE.Vector3(1.6, 0, 5.2).applyMatrix4(M).add(out), q: new THREE.Quaternion().setFromEuler(new THREE.Euler(0, 0, -s * 0.49)), s });
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
  // The "beaver tail" between the engines, intake splitter plates and a refuelling door.
  parts.push(colorize(new THREE.BoxGeometry(0.5, 0.34, 2.3).translate(0, 0.02, 6.2), 0x3a3e44));
  for (const s of [1, -1]) parts.push(colorize(new THREE.BoxGeometry(0.03, 0.62, 0.5).translate(s * 1.14, -0.1, -2.5), 0x2a2d32));
  parts.push(colorize(new THREE.BoxGeometry(0.5, 0.012, 0.9).translate(0, 0.64, -2.2), 0x3a3e44));
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
    // A dark accent on the tail fins (roundel-free markings), on the fin's own surface.
    const fm = new THREE.Matrix4().makeTranslation(s * 1.05, 0.35, 0).multiply(new THREE.Matrix4().makeRotationZ(-s * 0.49)).multiply(new THREE.Matrix4().makeRotationZ(Math.PI / 2));
    const stripe = new THREE.BoxGeometry(0.5, 0.14, 0.9).translate(1.9, 0, 5.1).applyMatrix4(fm);
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

  cachedByPaint[paint] = { hull, canopy, pal, surfaces, navTail, stripPts };
  return cachedByPaint[paint];
}

// The F-16 Fighting Falcon: a light single-engine fighter. A rounder
// fuselage with a dorsal spine, the chin intake under the cockpit, a big
// frameless bubble canopy, leading-edge root extensions blending into a
// cropped-delta wing with missile rails on the tips, one tall fin, ventral
// fins, all-moving tailplanes and a single round nozzle.
function buildF16Geometry(paint = "falcon") {
  const key = `f16:${paint}`;
  if (cachedByPaint[key]) return cachedByPaint[key];
  const pal = PAINTS[paint] || PAINTS.falcon;
  const G = pal.grey;
  const GD = pal.dark;
  const parts = [];
  const fus = loft([
    section(-7.0, 0.02, 0.02, 0.02),
    section(-6.3, 0.26, 0.24, 0.22),
    section(-5.2, 0.44, 0.42, 0.38),
    section(-4.2, 0.55, 0.52, 0.45),
    section(-2.8, 0.66, 0.66, 0.55),
    section(-1.2, 0.8, 0.74, 0.6, 0.05),
    section(1.0, 0.9, 0.76, 0.62, 0.1),
    section(3.2, 0.84, 0.7, 0.58, 0.06),
    section(5.0, 0.7, 0.6, 0.55),
    section(6.2, 0.56, 0.52, 0.52),
  ]);
  parts.push(colorize(fus, G, (x, y, z) => (y > 0.05 ? 1.04 : 0.88)));
  // The chin intake: a rounded duct under the cockpit, with a dark mouth.
  const intake = loft([
    { z: -3.05, pts: [[0, -0.42], [0.5, -0.48], [0.6, -0.78], [0.46, -1.02], [0, -1.07], [-0.46, -1.02], [-0.6, -0.78], [-0.5, -0.48]] },
    { z: -1.2, pts: [[0, -0.45], [0.52, -0.5], [0.6, -0.78], [0.46, -1.0], [0, -1.04], [-0.46, -1.0], [-0.6, -0.78], [-0.52, -0.5]] },
    { z: 1.4, pts: [[0, -0.45], [0.42, -0.48], [0.46, -0.64], [0.34, -0.74], [0, -0.76], [-0.34, -0.74], [-0.46, -0.64], [-0.42, -0.48]] },
  ]);
  parts.push(colorize(intake, GD, (x, y, z) => (z < -2.9 ? 0.7 : 1)));
  parts.push(colorize(new THREE.CircleGeometry(1, 16).scale(0.5, 0.26, 1).rotateY(Math.PI).translate(0, -0.76, -3.07), 0x0d0e11));
  const surfaces = [];
  const stripPts = [];
  for (const s of [1, -1]) {
    // Leading-edge root extension, blending the wing into the forebody.
    const lerx = plate(
      [
        [s * 0.5, -4.0],
        [s * 1.05, -1.4],
        [s * 1.6, 0.3],
        [s * 0.6, 0.4],
      ],
      0.08
    );
    lerx.translate(0, 0.04, 0);
    parts.push(colorize(lerx, G, (x, y, z) => (y > 0 ? 1.02 : 0.86)));
    // The cropped delta wing, with a flaperon on the trailing edge.
    const wing = plate(
      [
        [s * 0.75, -0.6],
        [s * 4.85, 2.3],
        [s * 4.85, 3.2],
        [s * 4.4, 3.22],
        [s * 4.4, 2.7],
        [s * 1.0, 2.9],
        [s * 1.0, 3.388],
        [s * 0.75, 3.4],
      ],
      0.12
    );
    wing.translate(0, -0.05, 0);
    parts.push(colorize(wing, G, (x, y, z) => (y > -0.04 ? 1.02 : 0.84)));
    const flap = plate(
      [
        [s * 1.0, 2.9],
        [s * 1.0, 3.388],
        [s * 4.4, 3.22],
        [s * 4.4, 2.7],
      ],
      0.1
    );
    flap.translate(0, -0.05, 0);
    surfaces.push(movable(colorize(flap, G, (x, y, z) => (y > -0.04 ? 1.0 : 0.82)), new THREE.Vector3(s * 1.0, -0.05, 2.9), new THREE.Vector3(3.4, 0, s > 0 ? -0.2 : 0.2), "ail", s));
    // Leading-edge flaps (a darker strip).
    parts.push(colorize(new THREE.BoxGeometry(4.8, 0.03, 0.18).rotateY(s * -0.62).translate(s * 2.8, 0.0, 0.85), GD));
    // Wingtip rails, each with a white heat-seeking missile.
    parts.push(colorize(new THREE.BoxGeometry(0.1, 0.12, 2.2).translate(s * 4.92, -0.06, 2.55), GD));
    parts.push(colorize(new THREE.CylinderGeometry(0.075, 0.075, 2.6, 8).rotateX(Math.PI / 2).translate(s * 4.98, -0.2, 2.4), 0xdfe1e3));
    parts.push(colorize(new THREE.ConeGeometry(0.075, 0.3, 8).rotateX(-Math.PI / 2).translate(s * 4.98, -0.2, 0.95), 0x3a3c40));
    for (const r of [0, Math.PI / 2]) parts.push(colorize(new THREE.BoxGeometry(0.42, 0.02, 0.26).rotateZ(r).translate(s * 4.98, -0.2, 3.55), 0x9aa0a6));
    // All-moving tailplanes.
    const stab = plate(
      [
        [s * 0.62, 4.6],
        [s * 3.0, 5.95],
        [s * 3.0, 6.6],
        [s * 0.62, 6.65],
      ],
      0.08
    );
    stab.translate(0, -0.12, 0);
    surfaces.push(movable(colorize(stab, G), new THREE.Vector3(s * 0.62, -0.12, 5.5), new THREE.Vector3(1, 0, 0), "stab", s));
    // Ventral fins under the tail, canted outward.
    const ventral = plate(
      [
        [0, 3.9],
        [0, 5.0],
        [0.65, 4.95],
        [0.65, 4.45],
      ],
      0.05
    );
    ventral.rotateZ(-Math.PI / 2);
    ventral.rotateZ(s * 0.5);
    ventral.translate(s * 0.42, -0.45, 0);
    parts.push(colorize(ventral, GD));
    // The split tail brakes: a panel on each side of the rear fuselage, hinged
    // at its front edge; they swing open like barn doors (see setControls).
    // Closed they lie against the fuselage like the real panel lines.
    {
      const panel = new THREE.BoxGeometry(0.05, 0.62, 1.2).translate(s * 0.03, 0, 0.6);
      surfaces.push(movable(colorize(panel, GD), new THREE.Vector3(s * 0.64, 0, 4.95), new THREE.Vector3(0, 1, 0), "brake", s));
    }
  }
  // The tall single fin, with its rudder, a tail flash and an antenna fairing.
  const fm = new THREE.Matrix4().makeTranslation(0, 0.55, 0).multiply(new THREE.Matrix4().makeRotationZ(Math.PI / 2));
  const fin = plate(
    [
      [0, 2.5],
      [0, 5.0],
      [3.15, 5.65],
      [3.15, 5.25],
    ],
    0.1
  ).applyMatrix4(fm);
  parts.push(colorize(fin, G, () => 0.98));
  const rud = plate(
    [
      [0, 5.0],
      [0, 6.1],
      [3.15, 6.35],
      [3.15, 5.65],
    ],
    0.1
  ).applyMatrix4(fm);
  const rh0 = new THREE.Vector3(0, 0, 5.0).applyMatrix4(fm);
  const rh1 = new THREE.Vector3(3.15, 0, 5.65).applyMatrix4(fm);
  surfaces.push(movable(colorize(rud, G, () => 0.93), rh0, rh1.clone().sub(rh0), "rud", 0));
  parts.push(colorize(new THREE.BoxGeometry(0.12, 0.55, 0.9).translate(0, 2.6, 4.8), pal.accent));
  parts.push(colorize(new THREE.BoxGeometry(0.14, 0.14, 0.9).translate(0, 3.66, 5.45), GD));
  stripPts.push({ at: new THREE.Vector3(0.056, 2.0, 4.6), q: new THREE.Quaternion(), s: 1 });
  // The round nozzle with its petals and a dark throat.
  parts.push(colorize(new THREE.CylinderGeometry(0.46, 0.54, 1.1, 16, 1, true).rotateX(Math.PI / 2).translate(0, 0, 6.72), 0x3a3d42));
  parts.push(colorize(new THREE.CircleGeometry(0.44, 16).translate(0, 0, 7.2), 0x0c0d0f));
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2;
    parts.push(colorize(new THREE.BoxGeometry(0.2, 0.03, 0.5).rotateZ(a + Math.PI / 2).translate(Math.cos(a) * 0.48, Math.sin(a) * 0.48, 7.1), 0x2a2d32));
  }
  // Radome, pitot probe, the gun port on the left shoulder, AoA probes and antennas.
  parts.push(colorize(new THREE.ConeGeometry(0.26, 1.3, 10).rotateX(-Math.PI / 2).translate(0, 0, -6.55), pal.accent));
  parts.push(colorize(new THREE.CylinderGeometry(0.022, 0.022, 1.0, 5).rotateX(Math.PI / 2).translate(0, 0, -7.6), 0xb8bcc2));
  parts.push(colorize(new THREE.BoxGeometry(0.06, 0.18, 0.5).translate(-0.7, 0.38, -2.4), 0x15171a));
  for (const s of [1, -1]) parts.push(colorize(new THREE.CylinderGeometry(0.014, 0.02, 0.3, 4).rotateZ(s * 1.2).translate(s * 0.38, 0.05, -5.5), 0xb8bcc2));
  for (const z of [-0.2, 2.4]) parts.push(colorize(new THREE.BoxGeometry(0.03, 0.26, 0.36).translate(0, -0.78, z), GD));
  parts.push(colorize(new THREE.BoxGeometry(0.03, 0.2, 0.3).translate(0, 0.86, 1.2), GD));
  // The canopy's rear frame, the pilot and the seat.
  parts.push(colorize(new THREE.TorusGeometry(1, 0.035, 5, 20, Math.PI).scale(0.46, 0.55, 1).translate(0, 0.5, -2.05), 0x2b2e33));
  parts.push(colorize(new THREE.BoxGeometry(0.4, 0.55, 0.3).translate(0, 0.62, -3.25), 0x202226));
  parts.push(colorize(new THREE.SphereGeometry(0.16, 10, 8).translate(0, 0.98, -3.45), 0x9ca2a8));
  parts.push(colorize(new THREE.SphereGeometry(0.13, 10, 8).scale(1, 0.7, 0.6).translate(0, 0.98, -3.57), 0x121417));
  const hull = merge(parts);
  const canopy = new THREE.SphereGeometry(1, 20, 10, 0, Math.PI * 2, 0, Math.PI / 2);
  canopy.scale(0.46, 0.55, 1.65);
  canopy.translate(0, 0.5, -3.65);
  cachedByPaint[key] = { hull, canopy, pal, surfaces, navTail: [[0, 3.7, 6.0]], stripPts };
  return cachedByPaint[key];
}

// Where the working parts sit on each airframe: gear legs, nozzles (with the
// flame's radius), navigation and formation lights, the cockpit glow.
const LAYOUTS = {
  f22: {
    nose: { at: [0, -0.5, -4.6], wheels: [-0.13, 0.13], r: 0.2, len: 0.65 },
    main: { at: [1.6, -0.45, 2.0], r: 0.3, len: 0.6 },
    nozzles: [[0.62, -0.02, 7.62, 0.34], [-0.62, -0.02, 7.62, 0.34]],
    wing: [[-6.55, -0.12, 2.0], [6.55, -0.12, 2.0]],
    belly: null,
    strips: [[0.8, 0.06, -4.4, 0]],
    cockpit: [0, 0.7, -4.2],
    length: 15.2,
    span: 13.2,
  },
  f16: {
    nose: { at: [0, -0.98, -2.4], wheels: [0], r: 0.19, len: 0.18 },
    main: { at: [1.05, -0.62, 1.0], r: 0.28, len: 0.45 },
    nozzles: [[0, 0, 7.25, 0.42]],
    wing: [[-5.06, -0.2, 2.4], [5.06, -0.2, 2.4]],
    belly: [0, -0.57, 4.2],
    strips: [[0.84, 0.12, -0.9, 0]],
    cockpit: [0, 0.74, -4.0],
    length: 14.8,
    span: 10.3,
  },
};

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
const NAV_SIZE = 0.32; // navigation light sprites (blocks)
const STROBE_SIZE = 0.28;

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
export function createJetModel(scale = 1, { paint = "raptor", type = "f22" } = {}) {
  const L = LAYOUTS[type] || LAYOUTS.f22;
  if (paint === "gray" || !PAINTS[paint]) paint = "raptor";
  if (type === "f16" && paint === "raptor") paint = "falcon";
  const { hull, canopy, pal, surfaces: surfDefs, navTail, stripPts } = type === "f16" ? buildF16Geometry(paint) : buildGeometry(paint);
  const shared = new Set([hull, canopy, ...surfDefs.map((d) => d.geo)]);
  const root = new THREE.Group();
  const body = new THREE.Group();
  body.scale.setScalar(scale);
  root.add(body);
  const light = { sky: 15, block: 0, flash: new THREE.Color(0, 0, 0) };
  const hullMat = createEntityMaterial("color", null, { finish: FINISH[paint] || (type === "f16" ? FINISH.falcon : FINISH.raptor) });
  // (A little ambient fill so it reads as a shape, not a hole, in the shade and at night.)
  hullMat.uniforms.uFill.value = 0.45;
  const hullMesh = new THREE.Mesh(hull, hullMat);
  hullMesh.castShadow = true;
  bindEntityLight(hullMesh, () => light);
  body.add(hullMesh);
  // The control surfaces: groups hinged at their pivots, turned by setControls.
  const surfaces = surfDefs.map((d) => {
    const m = new THREE.Mesh(d.geo, hullMat);
    m.castShadow = true;
    bindEntityLight(m, () => light);
    const group = new THREE.Group();
    group.position.fromArray(d.pivot);
    group.add(m);
    body.add(group);
    return { group, axis: new THREE.Vector3().fromArray(d.axis), kind: d.kind, side: d.side };
  });
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
  const noseGeo = gearLeg(L.nose.wheels, L.nose.r, L.nose.len, 0.5);
  const mainGeo = gearLeg([0], L.main.r, L.main.len, 0.5);
  const [mx, my, mz] = L.main.at;
  const gear = { nose: mkGear(noseGeo, ...L.nose.at), left: mkGear(mainGeo, -mx, my, mz), right: mkGear(mainGeo, mx, my, mz) };
  const noseY = L.nose.at[1];
  let gearT = 1;
  // Afterburner flames: layered additive cones out of each nozzle.
  if (!flameTex) flameTex = flameTexture();
  const flames = [];
  for (const [nx, ny, nz, nr] of L.nozzles) {
    const k = nr / 0.34;
    // Wide at the nozzle (z = 0), tapering to a point behind (z = 1).
    const cone = new THREE.ConeGeometry(nr, 1, 12, 1, true).rotateX(Math.PI / 2).translate(0, 0, 0.5);
    const mat = new THREE.MeshBasicMaterial({ map: flameTex, color: new THREE.Color(3, 2, 1.4), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: true });
    const flame = new THREE.Mesh(cone, mat);
    flame.position.set(nx, ny, nz);
    flame.layers.set(LAYER_FX);
    flame.renderOrder = 12;
    body.add(flame);
    // The white-hot core inside the plume.
    const core = new THREE.Mesh(new THREE.ConeGeometry(0.2 * k, 1, 10, 1, true).rotateX(Math.PI / 2).translate(0, 0, 0.5), new THREE.MeshBasicMaterial({ color: new THREE.Color(4, 4.2, 5), transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: true }));
    core.position.set(nx, ny, nz);
    core.layers.set(LAYER_FX);
    core.renderOrder = 13;
    body.add(core);
    // Shock diamonds: bright beads along the afterburner plume.
    const diamonds = [];
    for (let i = 0; i < 4; i++) {
      const d = new THREE.Sprite(new THREE.SpriteMaterial({ map: softGlowTexture(), color: new THREE.Color(3.2, 3.4, 5), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, fog: false }));
      d.layers.set(LAYER_FX);
      d.visible = false;
      d.position.set(nx, ny, nz + 0.8 + i * 0.95);
      body.add(d);
      diamonds.push(d);
    }
    // A hot glowing disc inside the nozzle, and a soft halo behind it.
    const glow = new THREE.Mesh(type === "f16" ? new THREE.CircleGeometry(nr * 0.95, 16) : new THREE.PlaneGeometry(0.7, 0.4).rotateY(Math.PI), new THREE.MeshBasicMaterial({ color: new THREE.Color(2.5, 1.2, 0.5), fog: true, side: THREE.DoubleSide }));
    glow.position.set(nx, ny, nz - 0.02);
    body.add(glow);
    const halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: softGlowTexture(), color: new THREE.Color(2, 1.1, 0.5), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, fog: false }));
    halo.layers.set(LAYER_FX);
    halo.position.set(nx, ny, nz + 0.28);
    halo.scale.setScalar(1.2);
    body.add(halo);
    flames.push({ flame, core, glow, halo, diamonds, k });
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
  // (Small points of light: a real navigation light is a pinpoint, not a
  // glowing ball; the bloom does the rest.)
  // (Every one sits on the airframe: wingtips at the tip edge, strobes on the
  // tops of the fins and under the belly.)
  const tails = navTail.map((p) => [p[0], p[1], p[2]]);
  const strobes = L.belly ? [...tails, L.belly] : tails;
  const nav = [navSprite(new THREE.Color(2.4, 0.15, 0.15), ...L.wing[0], NAV_SIZE), navSprite(new THREE.Color(0.15, 2.4, 0.2), ...L.wing[1], NAV_SIZE), navSprite(new THREE.Color(2.6, 2.6, 3), ...strobes[0], STROBE_SIZE), navSprite(new THREE.Color(2.6, 2.6, 3), ...strobes[1], STROBE_SIZE)];
  // Formation ("slime") lights: soft green strips on the fuselage sides and
  // the tails, and the cockpit's dim instrument glow; night only too.
  const stripGeo = new THREE.PlaneGeometry(0.05, 0.7);
  const stripMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(0.2, 1.0, 0.35), fog: true, side: THREE.DoubleSide });
  const strips = [];
  for (const s of [1, -1]) {
    for (const [x, y, z, cant] of L.strips) {
      const m = new THREE.Mesh(stripGeo, stripMat);
      m.rotation.set(Math.PI / 2, s > 0 ? Math.PI / 2 : -Math.PI / 2, 0);
      m.rotation.z = -s * cant;
      m.position.set(s * x, y, z);
      m.layers.set(LAYER_FX);
      body.add(m);
      strips.push(m);
    }
  }
  // The strips on the fins: thin boxes lying on the fin's surface.
  const finStripGeo = new THREE.BoxGeometry(0.03, 0.55, 0.05);
  for (const sp of stripPts) {
    for (const side of type === "f16" ? [1, -1] : [1]) {
      const m = new THREE.Mesh(finStripGeo, stripMat);
      m.position.copy(sp.at);
      if (type === "f16") m.position.x *= side;
      m.quaternion.copy(sp.q);
      m.layers.set(LAYER_FX);
      body.add(m);
      strips.push(m);
    }
  }
  const cockpitGlow = navSprite(new THREE.Color(0.1, 0.35, 0.18), ...L.cockpit, 0.4);
  // Off until setLights says it is night.
  for (const o of [...nav, ...strips, cockpitGlow]) o.visible = false;
  return {
    root,
    body,
    light,
    hull: hullMesh,
    canopy: canopyMesh,
    type,
    length: L.length * scale,
    span: L.span * scale,
    // throttle 0-1; afterburner: long, bright blue-white flames.
    setThrottle(throttle, afterburner, t) {
      for (const f of flames) {
        const flicker = 0.9 + Math.sin(t * 43 + f.flame.position.x * 7) * 0.1;
        const len = afterburner ? 5.6 + Math.sin(t * 31) * 0.5 : 0.4 + throttle * 1.8;
        f.flame.scale.set(afterburner ? 1.15 : 0.8, afterburner ? 1.15 : 0.8, len * flicker * (0.7 + 0.3 * f.k));
        f.flame.visible = throttle > 0.05 || afterburner;
        f.flame.material.color.setRGB(afterburner ? 2.2 : 3, afterburner ? 2.2 : 1.6, afterburner ? 3.2 : 0.8);
        f.flame.material.opacity = afterburner ? 1 : 0.35 + throttle * 0.5;
        f.core.visible = f.flame.visible && throttle > 0.3;
        f.core.scale.set(afterburner ? 1.05 : 0.7, afterburner ? 1.05 : 0.7, len * 0.55 * flicker);
        f.core.material.opacity = afterburner ? 0.95 : 0.35 * throttle;
        for (let i = 0; i < f.diamonds.length; i++) {
          const d = f.diamonds[i];
          d.visible = afterburner;
          if (afterburner) d.scale.setScalar((0.5 - i * 0.08) * f.k * (0.85 + 0.25 * Math.sin(t * 60 + i * 2)));
        }
        const g = 0.4 + throttle * 1.6 + (afterburner ? 2 : 0);
        f.glow.material.color.setRGB(g * 1.3, g * 0.6, g * 0.3);
        f.halo.visible = throttle > 0.05;
        f.halo.material.color.setRGB(g * 0.8, g * 0.4, g * 0.25 + (afterburner ? 0.5 : 0));
        f.halo.scale.setScalar((0.9 + throttle * 0.8 + (afterburner ? 1.1 : 0)) * f.k);
      }
    },
    // The control surfaces follow the stick (-1..1 each): the tailplanes move
    // together for pitch (trailing edge up to pull the nose up) and a little
    // differentially with the roll, the flaperons move opposite ways for roll
    // (and droop a little with the gear down, as flaps), the rudders for yaw.
    // `brake` (0-1) is the air brake: the F-16's split tail panels open
    // outward; the F-22 has no panels, it brakes with its control surfaces
    // (the twin rudders toe out, the flaperons droop, the tailplanes tilt).
    setControls(pitch, roll, yaw, brake = 0) {
      for (const sf of surfaces) {
        let a = 0;
        if (sf.kind === "stab") a = -0.42 * pitch - 0.2 * roll * sf.side - (type === "f22" ? 0.18 * brake : 0);
        else if (sf.kind === "ail") a = -0.5 * roll * sf.side + 0.2 * gearT + (type === "f22" ? 0.75 * brake : 0);
        else if (sf.kind === "brake") a = 0.95 * brake * sf.side;
        else a = -0.5 * yaw + (sf.side ? 0.6 * brake * sf.side : 0);
        sf.group.quaternion.setFromAxisAngle(sf.axis, a);
      }
    },
    // A burning wreck: no canopy, no flames, charred, glowing from inside.
    setBurnt(on, t = 0) {
      canopyMesh.visible = !on;
      if (!on) return;
      for (const f of flames) {
        f.flame.visible = f.core.visible = f.halo.visible = false;
        for (const d of f.diamonds) d.visible = false;
      }
      for (const o of [...nav, ...strips, cockpitGlow]) o.visible = false;
      hullMat.uniforms.uFill.value = 0.02;
      light.flash.setRGB(0.55 + 0.25 * Math.sin(t * 17), 0.16 + 0.1 * Math.sin(t * 23 + 1), 0.02);
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
      gear.nose.position.y = noseY + (1 - down) * 0.2;
    },
    get gear() {
      return gearT;
    },
    // Wingtip navigation lights, tail strobes, formation lights and the
    // cockpit glow (t: time; dark: 0-1 night). Round 8: the navigation lights
    // and strobes are on whenever the aircraft is in use (`active`: from the
    // takeoff roll on, all through the flight, day or night, brighter at
    // night) and off while it stands parked; the formation strips and the
    // cockpit glow are a night thing, as before.
    setLights(t, dark = 0, active = dark > 0.3) {
      const on = active;
      const night = dark > 0.3;
      const k = night ? 0.5 + 0.5 * Math.min(1, (dark - 0.3) / 0.25) : 0.45;
      const strobe = (t % 1.2) < 0.08 || ((t % 1.2) > 0.4 && (t % 1.2) < 0.47);
      nav[0].visible = nav[1].visible = on;
      nav[0].material.color.setRGB(2.4 * k, 0.15 * k, 0.15 * k);
      nav[1].material.color.setRGB(0.15 * k, 2.4 * k, 0.2 * k);
      nav[2].visible = nav[3].visible = on && strobe;
      for (const m of strips) m.visible = on && night;
      stripMat.color.setRGB(0.2 * k, 1.0 * k, 0.35 * k);
      cockpitGlow.visible = on && night;
      // The ambient fill (so the jet reads as a shape in the dark) is a night thing.
      hullMat.uniforms.uFill.value = 0.08 + 0.5 * dark;
      cockpitGlow.material.color.setRGB(0.1 * k, 0.35 * k, 0.18 * k);
    },
    get lightsOn() {
      return nav[0].visible;
    },
    // Frees what this model made for itself (not the geometry cached per
    // paint, the sprites' common quad or the textures).
    dispose() {
      root.traverse((o) => {
        if (o.geometry && !o.isSprite && !shared.has(o.geometry)) o.geometry.dispose();
        if (o.material) o.material.dispose();
      });
    },
  };
}
