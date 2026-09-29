// A stealth fighter modelled on the F-22 Raptor, built from simple
// procedural pieces in the game's style: an angular, chined fuselage lofted
// from diamond-ish cross sections, a gold-tinted bubble canopy, caret
// intakes, diamond wings, all-moving tailplanes, twin vertical tails canted
// outward, and twin engines with square thrust-vectoring nozzles and an
// afterburner glow that grows with the throttle.
//
// Model space: nose toward -Z, up +Y, right +X; about 15 blocks long.
import * as THREE from "three";
import { createEntityMaterial, bindEntityLight } from "./shaders.js";
import { LAYER_FX } from "./layers.js";

const GREY = 0x7c848c;
const GREY_DARK = 0x5d646c;
const GREY_LIGHT = 0x9aa2a9;

function colorize(geo, hex, shade = null) {
  const c = new THREE.Color(hex).convertSRGBToLinear();
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

let cached = null;

function buildGeometry() {
  if (cached) return cached;
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
  const hull = merge(parts);

  // Canopy: a long, gold-tinted bubble.
  const canopy = new THREE.SphereGeometry(1, 20, 10, 0, Math.PI * 2, 0, Math.PI / 2);
  canopy.scale(0.52, 0.5, 1.9);
  canopy.translate(0, 0.42, -3.9);

  cached = { hull, canopy };
  return cached;
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

// Creates a jet model: { root, light, setThrottle(throttle, afterburner, t) }.
export function createJetModel(scale = 1) {
  const { hull, canopy } = buildGeometry();
  const root = new THREE.Group();
  const body = new THREE.Group();
  body.scale.setScalar(scale);
  root.add(body);
  const light = { sky: 15, block: 0, flash: new THREE.Color(0, 0, 0) };
  const hullMesh = new THREE.Mesh(hull, createEntityMaterial("color"));
  hullMesh.castShadow = true;
  bindEntityLight(hullMesh, () => light);
  body.add(hullMesh);
  const canopyMesh = new THREE.Mesh(canopy, new THREE.MeshStandardMaterial({ color: 0xb89a3c, metalness: 0.9, roughness: 0.15, envMapIntensity: 1, transparent: true, opacity: 0.85 }));
  body.add(canopyMesh);
  // Afterburner flames: additive cones out of each nozzle.
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
    // A hot glowing disc inside the nozzle.
    const glow = new THREE.Mesh(new THREE.PlaneGeometry(0.7, 0.4).rotateY(Math.PI), new THREE.MeshBasicMaterial({ color: new THREE.Color(2.5, 1.2, 0.5), fog: true }));
    glow.position.set(s * 0.62, -0.02, 7.6);
    body.add(glow);
    flames.push({ flame, glow });
  }
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
        const len = afterburner ? 4.5 + Math.sin(t * 31) * 0.4 : 0.4 + throttle * 1.6;
        f.flame.scale.set(afterburner ? 1.1 : 0.8, afterburner ? 1.1 : 0.8, len * flicker);
        f.flame.visible = throttle > 0.05 || afterburner;
        f.flame.material.color.setRGB(afterburner ? 2.2 : 3, afterburner ? 2.2 : 1.6, afterburner ? 3.2 : 0.8);
        f.flame.material.opacity = afterburner ? 1 : 0.35 + throttle * 0.5;
        const g = 0.4 + throttle * 1.6 + (afterburner ? 2 : 0);
        f.glow.material.color.setRGB(g * 1.3, g * 0.6, g * 0.3);
      }
    },
  };
}
