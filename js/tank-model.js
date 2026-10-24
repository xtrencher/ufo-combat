// (Round 13) The ground war's vehicles, built from simple procedural pieces
// in the game's model style (flat-shaded boxes, wedges and cylinders with
// vertex colours, the entity shader's paint finish):
//   tiger  a heavy WWII tank (a Tiger I): a boxy hull with the superstructure
//          over the tracks, a big turret with a rounded mantlet, the long
//          88 with its double-baffle muzzle brake, interleaved road wheels,
//          the commander's cupola, hatches, tools, tow cables, exhausts;
//   mbt    a modern main battle tank (Leopard 2 style): a low hull with a
//          steep glacis, side skirts, a wedge-armoured turret, the 120 mm
//          smoothbore with its thermal sleeve and fume extractor, smoke
//          launchers, sights, a roof MG, a bustle rack, antennas;
//   aa     an anti-aircraft vehicle (Tunguska style): a tracked chassis, a
//          turret with twin cannons, SAM tubes above them, a spinning
//          search radar and a tracking radar dish;
//   tel    the ballistic missile truck (MAZ-543 style TEL): eight wheels,
//          the split cab with the missile's nose between, an erector arm
//          that raises the long missile upright, four outrigger jacks.
// Camouflage: the paint's base colour, darker patches from the shader's
// livery (model space, so every tank of a scheme has the same pattern),
// vertex-coloured details and markings (a white star and turret numbers
// for ours, a red triangle for the aliens' hijacked machines).
//
// Moving parts: the turret's traverse, the gun's elevation and recoil, the
// tracks (every link follows the belt path round the sprocket, road wheels
// and idler: they really run) and the wheels turning, the radar spinning,
// the erector, the jacks, the missile on its arm.
//
// Model space: the front toward -Z, up +Y, right +X; y 0 is the bottom of
// the tracks (the ground); 1 unit is a block (a metre).
import * as THREE from "three";
import { createEntityMaterial, bindEntityLight } from "./shaders.js";
import { LAYER_FX } from "./layers.js";

// Paint schemes: base, darker shade, lighter shade, and the camo patches'
// strength (the shader's livery: patches that much lighter than the base).
export const TANK_PAINTS = {
  grey: { base: 0x464b4e, dark: 0x363a3d, light: 0x5d6468, camo: 0.16 }, // (panzer grey, as in the owner's picture)
  yellow: { base: 0x7f7144, dark: 0x5f5432, light: 0x9a8a58, camo: 0.45 }, // (olive over dunkelgelb: the patches are the light tone)
  olive: { base: 0x4a5335, dark: 0x3a4129, light: 0x5d6844, camo: 0.42 },
  desert: { base: 0x9c8762, dark: 0x7d6b4c, light: 0xb39d77, camo: 0.24 },
  winter: { base: 0x9ea3a6, dark: 0x7c8185, light: 0xb4b9bc, camo: 0.32 },
  enemy: { base: 0x2c2e33, dark: 0x202226, light: 0x3e4148, camo: 0.38 }, // (the aliens' hijacked machines: charcoal, red markings)
};
const METAL = 0x4a4c4e;
const STEEL = 0x6c6f72;
const RUBBER = 0x1f1f21;
const TRACK = 0x3a3632;
const GLASS = 0x1b2630;
const WHITE = 0xe8e6dc;
const RED = 0xa8241c;
const WOOD = 0x7a5a36;
const SOOT = 0x232120;
// The paint's finish (entity shader): a matte, slightly worn surface.
const FINISH = { spec: 0.18, gloss: 14, env: 0.08, grain: 0.05, panel: 0.12, panelScale: 1.4, livery: 0.3, liveryScale: 0.42 };

// ---------- A small kit of shapes (merged, vertex-coloured) ----------

const _m = new THREE.Matrix4();
const _e = new THREE.Euler();
const _q = new THREE.Quaternion();
const _s = new THREE.Vector3();
const _p = new THREE.Vector3();

class Kit {
  constructor() {
    this.pos = [];
    this.col = [];
  }

  // A geometry moved by matrix m, coloured c (a hex, or (x, y, z) => hex).
  _add(geo, m, c) {
    const g = (geo.index ? geo.toNonIndexed() : geo).applyMatrix4(m);
    const pos = g.getAttribute("position");
    const col = typeof c === "function" ? null : new THREE.Color(c);
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      const y = pos.getY(i);
      const z = pos.getZ(i);
      this.pos.push(x, y, z);
      const k = col || new THREE.Color(c(x, y, z));
      this.col.push(k.r, k.g, k.b);
    }
    g.dispose();
    geo.dispose();
  }

  _mat(x, y, z, rx = 0, ry = 0, rz = 0, sx = 1, sy = 1, sz = 1) {
    return _m.compose(_p.set(x, y, z), _q.setFromEuler(_e.set(rx, ry, rz, "YXZ")), _s.set(sx, sy, sz));
  }

  // A box centred at (x, y, z), sized (sx, sy, sz), turned (rx, ry, rz).
  box(x, y, z, sx, sy, sz, c, rx = 0, ry = 0, rz = 0) {
    this._add(new THREE.BoxGeometry(sx, sy, sz), this._mat(x, y, z, rx, ry, rz), c);
  }

  // A cylinder along `axis` ("x", "y", "z") centred at (x, y, z).
  cyl(x, y, z, r, len, c, axis = "y", seg = 12, r2 = r, rx = 0, ry = 0, rz = 0) {
    const g = new THREE.CylinderGeometry(r2, r, len, seg);
    if (axis === "x") g.rotateZ(-Math.PI / 2);
    else if (axis === "z") g.rotateX(-Math.PI / 2); // (r at +z, r2 at -z)
    this._add(g, this._mat(x, y, z, rx, ry, rz), c);
  }

  // A solid from 8 corners: the bottom loop then the top loop, in the same
  // order. Faces are made to face out whatever the order.
  hexa(pts, c) {
    const [b0, b1, b2, b3, t0, t1, t2, t3] = pts;
    const quads = [[b0, b1, b2, b3], [t0, t1, t2, t3], [b0, b1, t1, t0], [b1, b2, t2, t1], [b2, b3, t3, t2], [b3, b0, t0, t3]];
    const cx = pts.reduce((s, p) => s + p[0], 0) / 8;
    const cy = pts.reduce((s, p) => s + p[1], 0) / 8;
    const cz = pts.reduce((s, p) => s + p[2], 0) / 8;
    const tri = [];
    for (const [a, b, d, e] of quads) tri.push([a, b, d], [a, d, e]);
    const pos = [];
    for (let [a, b, d] of tri) {
      // (outward: the normal away from the middle)
      const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2];
      const vx = d[0] - a[0], vy = d[1] - a[1], vz = d[2] - a[2];
      const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
      if (nx * nx + ny * ny + nz * nz < 1e-12) continue;
      const mx = (a[0] + b[0] + d[0]) / 3 - cx, my = (a[1] + b[1] + d[1]) / 3 - cy, mz = (a[2] + b[2] + d[2]) / 3 - cz;
      if (nx * mx + ny * my + nz * mz < 0) [b, d] = [d, b];
      pos.push(...a, ...b, ...d);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    this._add(g, _m.identity(), c);
  }

  // A sloped-top box: a box from y0 to y1 whose top face is pulled in by
  // (fx front, bx back, sx each side) at the top: armour plates, cabs.
  slab(x0, x1, y0, y1, z0, z1, c, { tf = 0, tb = 0, ts = 0, bf = 0, bb = 0 } = {}) {
    this.hexa([[x0, y0, z0 + bf], [x1, y0, z0 + bf], [x1, y0, z1 - bb], [x0, y0, z1 - bb], [x0 + ts, y1, z0 + tf], [x1 - ts, y1, z0 + tf], [x1 - ts, y1, z1 - tb], [x0 + ts, y1, z1 - tb]], c);
  }

  // A five-pointed star (a marking) on a side: in the plane x = x (normal
  // toward sign), centred at (y, z).
  starX(x, y, z, r, c, sign = 1) {
    const shape = new THREE.Shape();
    for (let i = 0; i < 10; i++) {
      const a = (i / 10) * Math.PI * 2 - Math.PI / 2;
      const rr = i % 2 ? r * 0.4 : r;
      const px = Math.cos(a) * rr;
      const py = -Math.sin(a) * rr;
      if (i) shape.lineTo(px, py);
      else shape.moveTo(px, py);
    }
    const g = new THREE.ShapeGeometry(shape);
    g.rotateY(sign > 0 ? Math.PI / 2 : -Math.PI / 2);
    this._add(g, this._mat(x + sign * 0.012, y, z), c);
  }

  // A flat triangle marking on a side (the aliens' sign).
  triX(x, y, z, r, c, sign = 1) {
    const shape = new THREE.Shape();
    shape.moveTo(0, r);
    shape.lineTo(r * 0.9, -r * 0.6);
    shape.lineTo(-r * 0.9, -r * 0.6);
    const g = new THREE.ShapeGeometry(shape);
    g.rotateY(sign > 0 ? Math.PI / 2 : -Math.PI / 2);
    this._add(g, this._mat(x + sign * 0.012, y, z), c);
  }

  // Blocky turret numbers ("1", "2"...: seven-segment style) on a side.
  numberX(x, y, z, text, h, c, sign = 1) {
    const SEG = { 0: "abcdef", 1: "bc", 2: "abged", 3: "abgcd", 4: "fgbc", 5: "afgcd", 6: "afgedc", 7: "abc", 8: "abcdefg", 9: "abcfgd" };
    const w = h * 0.55;
    const t = h * 0.14;
    const dirZ = -sign; // (read from outside: left to right along the side)
    let off = -((text.length - 1) * (w + t * 2)) / 2;
    for (const ch of text) {
      const segs = SEG[ch] || "";
      const cz = z + off * dirZ;
      const put = (dy, dz, horiz) => this.box(x + sign * 0.015, y + dy, cz + dz * dirZ, 0.02, horiz ? t : h / 2, horiz ? w : t, c);
      if (segs.includes("a")) put(h / 2, 0, true);
      if (segs.includes("g")) put(0, 0, true);
      if (segs.includes("d")) put(-h / 2, 0, true);
      if (segs.includes("f")) put(h / 4, -w / 2, false);
      if (segs.includes("b")) put(h / 4, w / 2, false);
      if (segs.includes("e")) put(-h / 4, -w / 2, false);
      if (segs.includes("c")) put(-h / 4, w / 2, false);
      off += w + t * 2;
    }
  }

  geometry() {
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute("color", new THREE.Float32BufferAttribute(this.col, 3));
    g.setAttribute("uv", new THREE.Float32BufferAttribute(new Float32Array((this.pos.length / 3) * 2), 2));
    g.computeVertexNormals();
    g.computeBoundingSphere();
    return g;
  }
}

// ---------- Tracks ----------

// The belt round a side's wheels: circles [[z, y, r], ...] in order round
// the loop (front sprocket, front road wheel, rear road wheel, rear idler:
// counter-clockwise seen from the right, z to the right, y up). Returns
// { length, at(s, out) } where out gets { z, y, a } (a: the belt's angle).
function beltPath(circles, thick) {
  const C = circles.map(([z, y, r]) => ({ z, y, r: r + thick }));
  const n = C.length;
  const segs = [];
  const tangent = (a, b) => {
    const dz = b.z - a.z;
    const dy = b.y - a.y;
    const L = Math.hypot(dz, dy);
    const ux = dz / L;
    const uy = dy / L;
    // (the outside is to the right of the way round)
    const rx = uy;
    const ry = -ux;
    const ca = (a.r - b.r) / L;
    const sa = Math.sqrt(Math.max(0, 1 - ca * ca));
    const nx = ux * ca + rx * sa;
    const ny = uy * ca + ry * sa;
    return [{ z: a.z + nx * a.r, y: a.y + ny * a.r }, { z: b.z + nx * b.r, y: b.y + ny * b.r }, Math.atan2(ny, nx)];
  };
  const lines = [];
  for (let i = 0; i < n; i++) lines.push(tangent(C[i], C[(i + 1) % n]));
  let len = 0;
  for (let i = 0; i < n; i++) {
    // The arc on circle i from where the last line arrives to where the next leaves.
    const c = C[i];
    // (round each wheel the way the loop goes: counter-clockwise, the angle growing)
    const aIn = lines[(i + n - 1) % n][2];
    const aOut = lines[i][2];
    let d = aOut - aIn;
    while (d < 0) d += Math.PI * 2;
    while (d >= Math.PI * 2) d -= Math.PI * 2;
    const arcLen = d * c.r;
    segs.push({ kind: "arc", c, a0: aIn, d, len: arcLen, s0: len });
    len += arcLen;
    const [p, q] = lines[i];
    const L = Math.hypot(q.z - p.z, q.y - p.y);
    segs.push({ kind: "line", p, q, len: L, s0: len, ang: Math.atan2(q.y - p.y, q.z - p.z) });
    len += L;
  }
  return {
    length: len,
    at(s, out) {
      s = ((s % len) + len) % len;
      for (const g of segs) {
        if (s > g.s0 + g.len && g !== segs[segs.length - 1]) continue;
        const k = g.len > 0 ? (s - g.s0) / g.len : 0;
        if (g.kind === "line") {
          out.z = g.p.z + (g.q.z - g.p.z) * k;
          out.y = g.p.y + (g.q.y - g.p.y) * k;
          out.a = g.ang;
        } else {
          const a = g.a0 + g.d * k;
          out.z = g.c.z + Math.cos(a) * g.c.r;
          out.y = g.c.y + Math.sin(a) * g.c.r;
          out.a = a + Math.PI / 2;
        }
        return out;
      }
      return out;
    },
  };
}

// One track link (along z): a plate with grousers and the guide horn.
function linkGeometry(width, pitch, thick, col) {
  const k = new Kit();
  k.box(0, 0, 0, width, thick, pitch * 0.92, col);
  k.box(0, -thick * 0.55, 0, width * 0.96, thick * 0.35, pitch * 0.3, 0x2e2b28); // (the grouser)
  k.box(0, thick * 0.75, 0, width * 0.14, thick * 0.9, pitch * 0.5, 0x4a4540); // (the guide horn, between the wheels)
  return k.geometry();
}

// A road wheel (along x): a rubber tyre, a steel disc, a hub, bolts that
// show it turning.
function wheelGeometry(r, w, paint, spokes = 6) {
  const k = new Kit();
  k.cyl(0, 0, 0, r, w, RUBBER, "x", 18);
  k.cyl(0, 0, 0, r * 0.82, w * 1.06, paint, "x", 18);
  k.cyl(0, 0, 0, r * 0.3, w * 1.25, METAL, "x", 10);
  for (let i = 0; i < spokes; i++) {
    const a = (i / spokes) * Math.PI * 2;
    k.box(w * 0.55, Math.cos(a) * r * 0.55, Math.sin(a) * r * 0.55, 0.04, r * 0.12, r * 0.12, METAL);
    k.box(-w * 0.55, Math.cos(a) * r * 0.55, Math.sin(a) * r * 0.55, 0.04, r * 0.12, r * 0.12, METAL);
  }
  return k.geometry();
}

// A truck wheel (along x): a big tyre with tread blocks and a hub.
function truckWheelGeometry(r, w) {
  const k = new Kit();
  k.cyl(0, 0, 0, r, w, RUBBER, "x", 20);
  for (let i = 0; i < 16; i++) {
    const a = (i / 16) * Math.PI * 2;
    k.box(0, Math.cos(a) * r, Math.sin(a) * r, w * 0.9, 0.09, 0.16, 0x18181a, a);
  }
  k.cyl(w * 0.05, 0, 0, r * 0.55, w * 1.02, 0x4c5236, "x", 14);
  k.cyl(w * 0.1, 0, 0, r * 0.22, w * 1.04, METAL, "x", 10);
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    k.box(w * 0.53, Math.cos(a) * r * 0.38, Math.sin(a) * r * 0.38, 0.03, 0.07, 0.07, STEEL);
  }
  return k.geometry();
}

// ---------- The models ----------

const GEO = new Map(); // `${kind}:${paint}` -> the built geometries (shared by every model of it)

function shade(base, k) {
  const c = new THREE.Color(base);
  return c.multiplyScalar(k).getHex();
}

// The Tiger: returns the parts' geometries and the layout.
function buildTiger(pal, enemy) {
  const P = pal.base;
  const D = pal.dark;
  const L = pal.light;
  const hull = new Kit();
  // Lower hull between the tracks, the sloped lower front.
  hull.slab(-1.05, 1.05, 0.42, 1.12, -2.95, 2.85, D, { bf: 0.45, bb: 0.1 });
  // The superstructure over the tracks: vertical sides, a vertical front plate.
  hull.box(0, 1.47, -0.02, 3.56, 0.74, 5.62, P);
  hull.slab(-1.78, 1.78, 1.1, 1.84, -2.95, -2.81, P); // (the front plate's lip)
  // The glacis: from the lower nose up to the front plate.
  hull.hexa([[-1.05, 0.6, -3.12], [1.05, 0.6, -3.12], [1.05, 1.1, -2.83], [-1.05, 1.1, -2.83], [-1.05, 0.78, -3.18], [1.05, 0.78, -3.18], [1.05, 1.14, -2.86], [-1.05, 1.14, -2.86]], L);
  // Mudguards over the tracks at the front and the rear, the side fenders.
  for (const s of [-1, 1]) {
    hull.box(s * 1.42, 1.13, -3.0, 0.74, 0.05, 0.42, D, -0.35);
    hull.box(s * 1.42, 1.12, 2.95, 0.74, 0.05, 0.3, D, 0.25);
    hull.box(s * 1.79, 1.1, 0, 0.04, 0.06, 5.6, D); // (the fender's edge)
    // Tow cable along the side, its eyes.
    hull.box(s * 1.8, 1.32, -0.3, 0.05, 0.06, 4.6, METAL);
    hull.box(s * 1.81, 1.3, -2.55, 0.05, 0.12, 0.12, METAL);
    hull.box(s * 1.81, 1.3, 1.95, 0.05, 0.12, 0.12, METAL);
    // Spare track links on the front plate's sides.
    for (let i = 0; i < 3; i++) hull.box(s * 1.1, 1.3 + i * 0.16, -2.97, 0.62, 0.14, 0.05, TRACK);
    // Exhaust pipes and their guards at the rear.
    hull.cyl(s * 0.55, 1.55, 2.92, 0.09, 0.7, SOOT, "y", 10);
    hull.box(s * 0.55, 1.5, 2.99, 0.28, 0.5, 0.05, D);
    // Air filters on the rear deck.
    hull.cyl(s * 0.95, 1.92, 2.6, 0.17, 0.18, D, "y", 12);
  }
  // Engine deck: louvres, grilles.
  for (let i = 0; i < 4; i++) hull.box(0, 1.85, 1.3 + i * 0.32, 2.1, 0.03, 0.18, SOOT);
  hull.box(-1.25, 1.85, 1.75, 0.6, 0.03, 1.2, D);
  hull.box(1.25, 1.85, 1.75, 0.6, 0.03, 1.2, D);
  // Driver's visor, the bow MG in its ball mount, the headlight.
  hull.box(-0.62, 1.55, -2.96, 0.5, 0.12, 0.06, GLASS);
  hull.box(-0.62, 1.62, -2.97, 0.62, 0.05, 0.07, METAL);
  hull.cyl(0.62, 1.48, -3.0, 0.17, 0.12, D, "z", 12);
  hull.cyl(0.62, 1.48, -3.18, 0.035, 0.42, METAL, "z", 8);
  hull.cyl(-1.42, 1.92, -2.82, 0.09, 0.14, METAL, "z", 10);
  hull.cyl(-1.42, 1.92, -2.9, 0.07, 0.02, 0xd8d2a0, "z", 10);
  // Driver's and radio operator's hatches.
  hull.cyl(-0.62, 1.86, -2.25, 0.32, 0.05, L, "y", 14);
  hull.cyl(0.62, 1.86, -2.25, 0.32, 0.05, L, "y", 14);
  // Tools on the deck: a shovel, an axe, the jack, the cleaning rods.
  hull.box(1.45, 1.86, -1.1, 0.12, 0.04, 1.1, WOOD);
  hull.box(1.45, 1.86, -1.75, 0.22, 0.03, 0.28, METAL);
  hull.box(-1.45, 1.86, -1.3, 0.09, 0.05, 0.9, WOOD);
  hull.box(-1.45, 1.87, -0.8, 0.22, 0.04, 0.12, METAL);
  hull.cyl(-1.48, 1.92, 0.4, 0.1, 0.42, METAL, "z", 8);
  hull.box(1.55, 1.86, 0.5, 0.05, 0.04, 1.8, WOOD);
  // The antenna at the rear right.
  hull.box(1.4, 3.0, 2.4, 0.03, 2.3, 0.03, METAL);
  // Markings on the hull sides.
  for (const s of [-1, 1]) {
    if (enemy) hull.triX(s * 1.785, 1.47, 0.3, 0.32, RED, s);
    else hull.starX(s * 1.785, 1.47, 0.3, 0.33, WHITE, s);
  }

  // The turret (round the turret ring's centre: x 0, z 0, from y 1.84).
  const tur = new Kit();
  const ty = 1.84;
  // The horseshoe sides: a box with sloped sides, rounded at the front corners.
  tur.slab(-1.18, 1.18, ty, ty + 0.92, -1.05, 1.42, P, { ts: 0.06, tb: 0.05 });
  tur.cyl(-0.98, ty + 0.46, -1.05, 0.2, 0.92, P, "y", 10);
  tur.cyl(0.98, ty + 0.46, -1.05, 0.2, 0.92, P, "y", 10);
  tur.box(0, ty + 0.46, -1.15, 1.95, 0.92, 0.2, P);
  // The roof, the commander's cupola with its vision slits, the loader's hatch, the vents.
  tur.box(0, ty + 0.94, 0.15, 2.24, 0.05, 2.5, L);
  tur.cyl(0.55, ty + 1.08, 0.75, 0.4, 0.28, P, "y", 16);
  for (let i = 0; i < 7; i++) {
    const a = (i / 7) * Math.PI * 2;
    tur.box(0.55 + Math.cos(a) * 0.4, ty + 1.1, 0.75 + Math.sin(a) * 0.4, 0.08, 0.06, 0.08, GLASS);
  }
  tur.cyl(0.55, ty + 1.25, 0.75, 0.34, 0.05, L, "y", 16);
  tur.box(-0.5, ty + 0.98, 0.55, 0.55, 0.05, 0.7, L);
  tur.cyl(-0.2, ty + 0.98, -0.45, 0.1, 0.08, D, "y", 8);
  // The stowage bin at the back.
  tur.box(0, ty + 0.52, 1.72, 1.5, 0.5, 0.55, D);
  tur.box(0, ty + 0.78, 1.72, 1.52, 0.04, 0.57, P);
  // Smoke dischargers on the front corners (three each side).
  for (const s of [-1, 1]) for (let i = 0; i < 3; i++) tur.cyl(s * 1.08, ty + 0.78, -0.65 + i * 0.16, 0.05, 0.22, METAL, "y", 8, 0.05, 0, 0, s * 0.5);
  // Pistol ports and spare links on the sides, the numbers.
  for (const s of [-1, 1]) {
    tur.cyl(s * 1.18, ty + 0.45, 0.5, 0.08, 0.05, METAL, "x", 8);
    for (let i = 0; i < 2; i++) tur.box(s * 1.19, ty + 0.3 + i * 0.16, -0.3, 0.05, 0.14, 0.62, TRACK);
    tur.numberX(s * 1.18, ty + 0.55, 0.95, enemy ? "666" : "121", 0.26, enemy ? RED : WHITE, s);
  }

  // The mantlet and the gun (round the trunnion: z -1.25, y ty + 0.48).
  const gun = new Kit();
  gun.box(0, 0, -0.08, 1.7, 0.72, 0.18, P);
  gun.cyl(0, 0, -0.22, 0.32, 0.2, P, "x", 14);
  gun.box(0.62, 0.12, -0.2, 0.18, 0.24, 0.12, D); // (the gunner's sight aperture)
  gun.cyl(-0.42, 0.05, -0.22, 0.06, 0.12, METAL, "z", 8); // (the coax MG)
  const brl = new Kit();
  // The barrel: thicker at the breech, the long tube, the muzzle brake.
  brl.cyl(0, 0, -0.75, 0.17, 1.1, P, "z", 14, 0.14);
  brl.cyl(0, 0, -3.1, 0.12, 3.6, P, "z", 12, 0.1);
  brl.cyl(0, 0, -4.98, 0.1, 0.32, P, "z", 12);
  brl.cyl(0, 0, -5.28, 0.19, 0.28, D, "z", 12);
  brl.box(0, 0, -5.2, 0.42, 0.12, 0.05, D);
  brl.box(0, 0, -5.36, 0.42, 0.12, 0.05, D);
  brl.cyl(0, 0, -5.45, 0.13, 0.08, SOOT, "z", 12);
  // Kill rings painted on the barrel (white).
  for (let i = 0; i < 4; i++) brl.cyl(0, 0, -3.95 - i * 0.12, 0.114, 0.05, WHITE, "z", 12);
  return {
    hull: hull.geometry(),
    turret: tur.geometry(),
    gun: gun.geometry(),
    barrel: brl.geometry(),
    layout: {
      length: 6.3, width: 3.56, height: 2.9,
      turretY: 0, gunAt: [0, ty + 0.48, -1.28], muzzle: 5.5,
      track: { x: 1.42, w: 0.74, thick: 0.08, pitch: 0.27, circles: [[-2.92, 0.86, 0.36], [-2.15, 0.44, 0.42], [2.15, 0.44, 0.42], [2.85, 0.78, 0.33]] },
      wheels: { r: 0.42, w: 0.18, list: [-2.15, -1.53, -0.92, -0.31, 0.31, 0.92, 1.53, 2.15].map((z, i) => [z, 0.44, i % 2 ? -0.15 : 0.15]), extra: [[-2.92, 0.86, 0, 0.3], [2.85, 0.78, 0, 0.3]] },
    },
  };
}

// The modern tank.
function buildMbt(pal, enemy) {
  const P = pal.base;
  const D = pal.dark;
  const L = pal.light;
  const hull = new Kit();
  // Lower hull, the upper deck over the tracks, the steep glacis.
  hull.slab(-1.25, 1.25, 0.42, 1.2, -3.75, 3.7, D, { bf: 0.6, bb: 0.2 });
  hull.box(0, 1.34, 0.15, 3.66, 0.3, 6.95, P);
  hull.hexa([[-1.83, 1.19, -3.25], [1.83, 1.19, -3.25], [1.83, 1.49, -3.2], [-1.83, 1.49, -3.2], [-1.25, 0.95, -3.98], [1.25, 0.95, -3.98], [1.4, 1.42, -3.3], [-1.4, 1.42, -3.3]], L);
  hull.hexa([[-1.25, 0.6, -3.8], [1.25, 0.6, -3.8], [1.25, 0.95, -3.98], [-1.25, 0.95, -3.98], [-1.25, 0.42, -3.35], [1.25, 0.42, -3.35], [1.25, 0.6, -3.8], [-1.25, 0.6, -3.8]], D);
  // Side skirts: armoured panels over the upper wheels, the front ones thicker.
  for (const s of [-1, 1]) {
    for (let i = 0; i < 6; i++) {
      const z0 = -3.2 + i * 1.08;
      const front = i < 2;
      hull.box(s * (1.87 + (front ? 0.04 : 0)), 0.88, z0 + 0.53, front ? 0.12 : 0.05, 0.62, 1.04, front ? L : P);
      hull.box(s * (1.9 + (front ? 0.04 : 0)), 0.6, z0 + 0.53, 0.03, 0.05, 1.02, D);
    }
    // Towing eyes, the rear lights, the stowage boxes.
    hull.box(s * 0.9, 1.0, -3.95, 0.16, 0.2, 0.12, METAL);
    hull.box(s * 1.45, 1.38, 3.67, 0.22, 0.12, 0.05, 0xb02020);
    hull.box(s * 1.4, 1.58, 3.1, 0.5, 0.25, 0.9, D);
    // Headlights with their guards.
    hull.box(s * 1.5, 1.6, -3.15, 0.2, 0.15, 0.12, METAL);
    hull.box(s * 1.5, 1.6, -3.22, 0.14, 0.09, 0.02, 0xd8d2a0);
  }
  // The engine deck grilles, the driver's hatch and periscopes.
  for (let i = 0; i < 5; i++) hull.box(0, 1.5, 1.9 + i * 0.32, 2.4, 0.025, 0.16, SOOT);
  hull.box(-0.62, 1.5, -2.55, 0.75, 0.04, 0.65, L);
  for (let i = 0; i < 3; i++) hull.box(-0.85 + i * 0.22, 1.54, -2.92, 0.14, 0.08, 0.08, GLASS);
  // Markings.
  for (const s of [-1, 1]) {
    if (enemy) hull.triX(s * 1.94, 0.9, 1.2, 0.26, RED, s);
    else hull.starX(s * 1.92, 0.9, 1.2, 0.27, WHITE, s);
  }

  // The turret (centre over the ring: z 0.2).
  const tur = new Kit();
  const ty = 1.49;
  // The main block, the wedge armour at the front (arrow-shaped from above).
  tur.slab(-1.72, 1.72, ty, ty + 0.78, -1.0, 1.55, P, { ts: 0.12, tb: 0.06 });
  tur.hexa([[-1.72, ty, -1.0], [-0.42, ty, -1.0], [-0.42, ty, -2.0], [-1.72, ty, -1.05], [-1.6, ty + 0.78, -1.0], [-0.42, ty + 0.78, -1.0], [-0.42, ty + 0.74, -1.92], [-1.6, ty + 0.74, -1.05]], L);
  tur.hexa([[0.42, ty, -1.0], [1.72, ty, -1.0], [1.72, ty, -1.05], [0.42, ty, -2.0], [0.42, ty + 0.78, -1.0], [1.6, ty + 0.78, -1.0], [1.6, ty + 0.74, -1.05], [0.42, ty + 0.74, -1.92]], L);
  // The bustle and its rack at the back.
  tur.box(0, ty + 0.36, 1.85, 2.9, 0.6, 0.6, D);
  for (const s of [-1, 0, 1]) tur.box(s * 1.35, ty + 0.55, 2.3, 0.05, 0.4, 0.05, METAL);
  tur.box(0, ty + 0.75, 2.3, 2.75, 0.04, 0.04, METAL);
  tur.box(0, ty + 0.35, 2.3, 2.75, 0.04, 0.04, METAL);
  tur.box(0, ty + 0.5, 2.15, 2.4, 0.3, 0.3, 0x5a5440); // (a tarp roll)
  // Roof: the gunner's sight box, the commander's panoramic sight, hatches, the MG.
  tur.box(0.85, ty + 0.92, -0.65, 0.42, 0.3, 0.42, D);
  tur.box(0.85, ty + 0.95, -0.87, 0.34, 0.18, 0.03, GLASS);
  tur.cyl(-0.75, ty + 1.05, 0.15, 0.12, 0.5, D, "y", 10);
  tur.box(-0.75, ty + 1.32, 0.15, 0.32, 0.22, 0.32, D);
  tur.box(-0.75, ty + 1.32, -0.02, 0.26, 0.12, 0.02, GLASS);
  tur.cyl(-0.85, ty + 0.81, 0.85, 0.34, 0.05, L, "y", 14);
  tur.cyl(0.55, ty + 0.81, 0.75, 0.32, 0.05, L, "y", 14);
  tur.box(0.55, ty + 0.98, 0.75, 0.08, 0.3, 0.08, METAL);
  tur.box(0.55, ty + 1.13, 0.5, 0.07, 0.07, 0.9, METAL); // (the roof MG)
  // Smoke grenade launchers: four tubes each side, angled out and up.
  for (const s of [-1, 1]) for (let i = 0; i < 4; i++) tur.cyl(s * 1.62, ty + 0.62 + (i % 2) * 0.15, 0.3 + Math.floor(i / 2) * 0.17, 0.065, 0.32, METAL, "y", 8, 0.065, -0.4, 0, s * 0.7);
  // Antennas at the back.
  tur.box(-1.15, ty + 2.0, 1.4, 0.03, 2.5, 0.03, METAL);
  tur.box(1.15, ty + 1.7, 1.4, 0.03, 1.9, 0.03, METAL);
  for (const s of [-1, 1]) tur.numberX(s * 1.69, ty + 0.4, 0.55, enemy ? "13" : "24", 0.24, enemy ? RED : WHITE, s);

  // The mantlet and the gun (the trunnion at z -1.15, y ty + 0.42).
  const gun = new Kit();
  gun.box(0, 0, -0.15, 0.78, 0.6, 0.45, P);
  gun.box(0, 0, -0.42, 0.62, 0.5, 0.1, D);
  gun.cyl(0.32, 0.05, -0.45, 0.05, 0.15, METAL, "z", 8);
  const brl = new Kit();
  brl.cyl(0, 0, -0.85, 0.14, 0.9, D, "z", 14, 0.13);
  // The thermal sleeve in sections, the fume extractor, the muzzle reference box.
  brl.cyl(0, 0, -3.95, 0.112, 4.9, P, "z", 12);
  for (let i = 0; i < 6; i++) brl.cyl(0, 0, -1.55 - i * 0.98, 0.125, 0.06, D, "z", 12);
  brl.cyl(0, 0, -2.3, 0.165, 0.7, D, "z", 14);
  brl.cyl(0, 0, -6.35, 0.1, 0.5, P, "z", 12);
  brl.box(0, 0.16, -6.45, 0.12, 0.1, 0.18, D);
  brl.cyl(0, 0, -6.62, 0.08, 0.05, SOOT, "z", 12);
  return {
    hull: hull.geometry(),
    turret: tur.geometry(),
    gun: gun.geometry(),
    barrel: brl.geometry(),
    layout: {
      length: 7.7, width: 3.8, height: 2.6,
      turretZ: 0.2, gunAt: [0, ty + 0.42, -1.15], muzzle: 6.65,
      track: { x: 1.5, w: 0.64, thick: 0.08, pitch: 0.26, circles: [[-3.38, 0.82, 0.32], [-2.75, 0.36, 0.36], [2.75, 0.36, 0.36], [3.42, 0.75, 0.3]] },
      wheels: { r: 0.36, w: 0.22, list: [-2.75, -1.84, -0.92, 0, 0.92, 1.84, 2.75].map((z) => [z, 0.36, 0]), extra: [[-3.38, 0.82, 0, 0.27], [3.42, 0.75, 0, 0.27]] },
    },
  };
}

// The AA vehicle: a tracked chassis, a turret with twin cannons, SAM tubes, radars.
function buildAA(pal, enemy) {
  const P = pal.base;
  const D = pal.dark;
  const L = pal.light;
  const hull = new Kit();
  hull.slab(-1.2, 1.2, 0.42, 1.15, -3.3, 3.2, D, { bf: 0.5, bb: 0.15 });
  hull.slab(-1.7, 1.7, 1.05, 1.62, -3.25, 3.25, P, { tf: 0.55, ts: 0.08, tb: 0.1 });
  for (const s of [-1, 1]) {
    hull.box(s * 1.72, 0.9, 0, 0.05, 0.4, 6.0, P);
    hull.box(s * 1.35, 1.75, 2.4, 0.6, 0.25, 1.1, D);
    hull.box(s * 1.45, 1.45, -3.0, 0.2, 0.12, 0.1, 0xd8d2a0);
    if (enemy) hull.triX(s * 1.75, 0.95, -0.8, 0.24, RED, s);
    else hull.starX(s * 1.75, 0.95, -0.8, 0.25, WHITE, s);
  }
  for (let i = 0; i < 4; i++) hull.box(0, 1.63, 1.6 + i * 0.32, 2.2, 0.02, 0.16, SOOT);
  hull.box(-0.7, 1.64, -2.5, 0.6, 0.04, 0.55, L);
  const tur = new Kit();
  const ty = 1.62;
  tur.slab(-1.15, 1.15, ty, ty + 1.05, -1.2, 1.4, P, { ts: 0.15, tf: 0.25, tb: 0.1 });
  tur.box(0, ty + 1.1, 0.2, 1.7, 0.06, 1.8, L);
  // The tracking radar's mount at the front, the search radar's mast at the back.
  tur.cyl(0, ty + 1.2, -0.95, 0.12, 0.3, D, "y", 10);
  tur.cyl(0, ty + 1.3, 1.1, 0.12, 0.45, D, "y", 10);
  for (const s of [-1, 1]) tur.numberX(s * 1.1, ty + 0.55, 0.3, enemy ? "7" : "3", 0.26, enemy ? RED : WHITE, s);
  // The guns' cradle: the cannons on both sides, the SAM tubes above them.
  const gun = new Kit();
  for (const s of [-1, 1]) {
    gun.box(s * 1.3, 0, -0.1, 0.32, 0.38, 1.1, D);
    gun.cyl(s * 1.3, 0.03, -1.6, 0.06, 2.4, METAL, "z", 10);
    gun.cyl(s * 1.3, 0.03, -2.9, 0.1, 0.3, SOOT, "z", 10);
    // Two SAM tubes each side.
    for (const k of [0, 1]) {
      gun.cyl(s * (1.25 + k * 0.32), 0.48, -0.2, 0.15, 1.9, L, "z", 12);
      gun.cyl(s * (1.25 + k * 0.32), 0.48, -1.16, 0.12, 0.04, SOOT, "z", 12);
    }
  }
  gun.box(0, 0, 0, 2.3, 0.16, 0.4, D);
  // The barrels are the cradle's: no separate recoil part (a quick shake instead).
  const brl = new Kit();
  brl.box(0, 0, 0, 0.01, 0.01, 0.01, D);
  // The search radar: a lattice dish (spins), the tracking dish (round, on the front).
  const radar = new Kit();
  radar.box(0, 0, 0, 2.0, 0.62, 0.07, 0x3e4240, -0.25);
  for (let i = -4; i <= 4; i++) radar.box(i * 0.24, 0, 0.05, 0.035, 0.62, 0.05, 0x8a8e8a, -0.25);
  radar.box(0, 0, 0.05, 2.0, 0.04, 0.05, 0x8a8e8a, -0.25);
  radar.box(0, -0.25, -0.1, 0.12, 0.12, 0.3, D);
  const dish = new Kit();
  dish.cyl(0, 0, 0, 0.42, 0.08, L, "z", 18);
  dish.cyl(0, 0, -0.08, 0.08, 0.2, D, "z", 8);
  return {
    hull: hull.geometry(),
    turret: tur.geometry(),
    gun: gun.geometry(),
    barrel: brl.geometry(),
    radar: radar.geometry(),
    dish: dish.geometry(),
    layout: {
      length: 6.6, width: 3.4, height: 3.2,
      gunAt: [0, ty + 0.55, -0.6], muzzle: 3.0,
      guns: [[-1.3, 0.03, -3.05], [1.3, 0.03, -3.05]],
      sams: [[-1.25, 0.48, -1.2], [1.25, 0.48, -1.2], [-1.57, 0.48, -1.2], [1.57, 0.48, -1.2]],
      radarAt: [0, ty + 1.6, 1.1], dishAt: [0, ty + 1.42, -1.0],
      track: { x: 1.35, w: 0.6, thick: 0.08, pitch: 0.26, circles: [[-3.0, 0.8, 0.3], [-2.35, 0.36, 0.36], [2.35, 0.36, 0.36], [3.0, 0.72, 0.3]] },
      wheels: { r: 0.36, w: 0.2, list: [-2.35, -1.41, -0.47, 0.47, 1.41, 2.35].map((z) => [z, 0.36, 0]), extra: [[-3.0, 0.8, 0, 0.25], [3.0, 0.72, 0, 0.25]] },
    },
  };
}

// The ballistic missile: body, warhead, fins (along -z from its tail at z 0).
export const MISSILE_LENGTH = 11.2;
export const MISSILE_RADIUS = 0.46;
function buildMissile() {
  const k = new Kit();
  const R = MISSILE_RADIUS;
  const body = 8.6;
  // (A light grey body with the black roll bands near the tail and a red nose band.)
  k.cyl(0, 0, -body / 2, R, body, (x, y, z) => (z > -2.6 && z < -0.5 && Math.sin(Math.atan2(y, x) * 2) > 0 ? 0x22231f : 0xd8d6cc), "z", 16);
  k.cyl(0, 0, -body - 0.9, R * 0.98, 1.8, 0xcfcdc4, "z", 16, R * 0.62);
  k.cyl(0, 0, -body - 2.15, R * 0.62, 0.7, RED, "z", 16, R * 0.18);
  k.cyl(0, 0, -body - 2.55, R * 0.18, 0.12, 0x3a3a3a, "z", 10, 0.02);
  // The fins at the tail, a nozzle.
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
    k.box(Math.cos(a) * (R + 0.35), Math.sin(a) * (R + 0.35), -0.6, 0.06, 0.75, 1.15, 0x3c3f38, 0, 0, a + Math.PI / 2);
  }
  k.cyl(0, 0, 0.12, R * 0.66, 0.28, SOOT, "z", 12, R * 0.48);
  // Panel lines.
  for (const z of [-3.4, -5.6, -7.6]) k.cyl(0, 0, z, R * 1.01, 0.03, 0x8a8880, "z", 16);
  return k.geometry();
}

// The TEL: the truck, its erector and the jacks.
function buildTel(pal, enemy) {
  const P = pal.base;
  const D = pal.dark;
  const L = pal.light;
  const hull = new Kit();
  // The chassis frame, the deck, the fenders over the wheels.
  hull.box(0, 1.15, 0.2, 2.6, 0.45, 12.6, D);
  hull.box(0, 1.5, 1.4, 3.0, 0.22, 9.6, P);
  for (const s of [-1, 1]) {
    for (const z of [-4.0, -2.4, 1.0, 2.6]) hull.box(s * 1.32, 1.72, z, 0.6, 0.06, 1.7, D);
    // Side boxes and the fuel tanks between the axles.
    hull.box(s * 1.3, 1.25, -0.7, 0.42, 0.55, 2.1, P);
    hull.cyl(s * 1.25, 1.2, 4.3, 0.32, 1.3, METAL, "z", 12);
    hull.box(s * 1.42, 1.0, 5.5, 0.12, 0.22, 0.1, 0xb02020);
    if (enemy) hull.triX(s * 1.52, 1.25, -0.7, 0.22, RED, s);
    else hull.starX(s * 1.52, 1.25, -0.7, 0.24, WHITE, s);
  }
  // The split cab: two cabins with the missile's nose between them.
  for (const s of [-1, 1]) {
    const x0 = s > 0 ? 0.55 : -1.5;
    const x1 = s > 0 ? 1.5 : -0.55;
    hull.slab(x0, x1, 1.0, 2.75, -6.55, -4.9, P, { tf: 0.45, ts: 0.05 });
    // Windscreen, side windows, the grille, the lights.
    hull.hexa([[x0 + 0.08, 1.95, -6.56], [x1 - 0.08, 1.95, -6.56], [x1 - 0.08, 1.95, -6.5], [x0 + 0.08, 1.95, -6.5], [x0 + 0.1, 2.62, -6.12], [x1 - 0.1, 2.62, -6.12], [x1 - 0.1, 2.62, -6.06], [x0 + 0.1, 2.62, -6.06]], GLASS);
    hull.box(s > 0 ? x1 + 0.01 : x0 - 0.01, 2.3, -5.45, 0.02, 0.45, 0.65, GLASS);
    hull.box((x0 + x1) / 2, 1.4, -6.57, x1 - x0 - 0.2, 0.5, 0.04, SOOT);
    hull.box((x0 + x1) / 2, 1.05, -6.6, x1 - x0, 0.14, 0.12, METAL);
    hull.cyl(s > 0 ? x1 - 0.2 : x0 + 0.2, 1.75, -6.58, 0.1, 0.05, 0xd8d2a0, "z", 10);
    hull.box((x0 + x1) / 2, 2.78, -5.6, x1 - x0 - 0.1, 0.05, 1.0, L);
  }
  // The missile's cradle at the front (where its nose rests), the engine box behind the cabs.
  hull.box(0, 1.75, -5.9, 0.7, 0.55, 0.4, D);
  hull.box(0, 1.95, -4.3, 2.6, 0.7, 0.9, P);
  for (let i = 0; i < 3; i++) hull.box(0, 2.31, -4.55 + i * 0.25, 2.2, 0.02, 0.12, SOOT);
  // The erector's base at the rear, the launch table under the missile's tail.
  hull.box(0, 1.9, 5.35, 2.4, 0.55, 0.8, D);
  hull.cyl(0, 1.75, 6.1, 0.75, 0.2, METAL, "y", 16);
  // The four jacks' housings.
  for (const s of [-1, 1]) for (const z of [-3.2, 5.0]) hull.box(s * 1.45, 1.35, z, 0.3, 0.4, 0.3, D);
  // The erector: a beam frame along the missile, pivoting at the rear (z 5.6, y 2.05).
  const er = new Kit();
  for (const s of [-1, 1]) {
    er.box(s * 0.62, 0.05, -5.0, 0.16, 0.3, 10.2, D);
    for (let i = 0; i < 6; i++) er.box(s * 0.62, 0.1, -1.2 - i * 1.6, 0.18, 0.5, 0.12, P);
  }
  for (let i = 0; i < 5; i++) er.box(0, -0.05, -1.0 - i * 2.0, 1.4, 0.12, 0.14, D);
  // The hydraulic ram's cylinder (fixed to the arm; a second piece rides on the truck).
  er.cyl(0, -0.25, -3.2, 0.14, 2.6, METAL, "z", 10);
  // Clamps round the missile.
  for (const z of [-2.0, -6.0]) er.cyl(0, 0.55, z, MISSILE_RADIUS + 0.06, 0.18, D, "z", 16);
  const jack = new Kit();
  jack.box(0, -0.5, 0, 0.14, 1.0, 0.14, STEEL);
  jack.box(0, -1.0, 0, 0.5, 0.06, 0.5, METAL);
  return {
    hull: hull.geometry(),
    erector: er.geometry(),
    jack: jack.geometry(),
    missile: buildMissile(),
    layout: {
      length: 13.3, width: 3.0, height: 3.2,
      pivot: [0, 2.05, 5.6], missileAt: [0, 0.55, 0.2],
      jacks: [[-1.45, 1.35, -3.2], [1.45, 1.35, -3.2], [-1.45, 1.35, 5.0], [1.45, 1.35, 5.0]],
      wheels: { r: 0.78, w: 0.55, list: [-4.0, -2.4, 1.0, 2.6].flatMap((z) => [[z, 0.78, -1.2], [z, 0.78, 1.2]]) },
    },
  };
}

function geometriesFor(kind, paint) {
  const key = `${kind}:${paint}`;
  if (GEO.has(key)) return GEO.get(key);
  const pal = TANK_PAINTS[paint] || TANK_PAINTS.olive;
  const enemy = paint === "enemy";
  const g = kind === "tiger" ? buildTiger(pal, enemy) : kind === "aa" ? buildAA(pal, enemy) : kind === "tel" ? buildTel(pal, enemy) : buildMbt(pal, enemy);
  const lay = g.layout;
  if (lay.track) g.link = linkGeometry(lay.track.w, lay.track.pitch, lay.track.thick, TRACK);
  if (lay.wheels) g.wheel = kind === "tel" ? truckWheelGeometry(lay.wheels.r, lay.wheels.w) : wheelGeometry(lay.wheels.r, lay.wheels.w, shade(pal.base, 0.95));
  if (lay.wheels?.extra) g.small = wheelGeometry(0.3, 0.2, shade(pal.dark, 1), 8);
  g.camo = pal.camo;
  GEO.set(key, g);
  return g;
}

// A muzzle flash quad (additive), for the moment a gun fires.
let flashTex = null;
function flashTexture() {
  if (flashTex) return flashTex;
  const c = document.createElement("canvas");
  c.width = c.height = 64;
  const ctx = c.getContext("2d");
  const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, "rgba(255,255,240,1)");
  g.addColorStop(0.25, "rgba(255,210,120,0.9)");
  g.addColorStop(0.6, "rgba(255,120,30,0.35)");
  g.addColorStop(1, "rgba(255,80,0,0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 64, 64);
  flashTex = new THREE.CanvasTexture(c);
  return flashTex;
}

// Creates a ground vehicle model. kind: "tiger" | "mbt" | "aa" | "tel";
// paint: a TANK_PAINTS key. Returns the model: { root, light, layout,
// muzzle (Object3D at the gun's muzzle), setTurret(yaw), setGun(pitch),
// setRecoil(0-1), roll(dist), animate(t, opts), setBurnt(on, t),
// setErector(0-1), setJacks(0-1), setMissile(visible), missileWorld(out
// matrix), turretOff(Object3D or null), dispose() }.
export function createTankModel(kind = "mbt", { paint = "olive" } = {}) {
  if (!TANK_PAINTS[paint]) paint = "olive";
  const g = geometriesFor(kind, paint);
  const lay = g.layout;
  const root = new THREE.Group();
  const light = { sky: 15, block: 0, flash: new THREE.Color(0, 0, 0) };
  const mat = createEntityMaterial("color", null, { finish: { ...FINISH, livery: g.camo } });
  mat.uniforms.uFill.value = 0.35;
  const plain = createEntityMaterial("color");
  plain.uniforms.uFill.value = 0.3;
  const mats = [mat, plain];
  const mesh = (geo, m = mat, parent = root, shadow = true) => {
    const o = new THREE.Mesh(geo, m);
    o.castShadow = shadow;
    bindEntityLight(o, () => light);
    parent.add(o);
    return o;
  };
  const hull = new THREE.Group();
  root.add(hull);
  mesh(g.hull, mat, hull);
  const model = { root, hull, light, layout: lay, kind, paint, length: lay.length, width: lay.width, height: lay.height };

  // ---- Tracks and wheels ----
  let links = null;
  let wheels = null;
  let smalls = null;
  const _o = new THREE.Object3D();
  const belt = { z: 0, y: 0, a: 0 };
  if (lay.track) {
    const T = lay.track;
    const path = beltPath(T.circles, T.thick / 2);
    const perSide = Math.round(path.length / T.pitch);
    links = new THREE.InstancedMesh(g.link, plain, perSide * 2);
    links.castShadow = true;
    bindEntityLight(links, () => light);
    links.frustumCulled = false;
    hull.add(links);
    model._path = path;
    model._perSide = perSide;
    model._pitch = path.length / perSide;
  }
  if (lay.wheels) {
    const W = lay.wheels;
    const n = kind === "tel" ? W.list.length : W.list.length * 2;
    wheels = new THREE.InstancedMesh(g.wheel, kind === "tel" ? plain : mat, n);
    wheels.castShadow = true;
    bindEntityLight(wheels, () => light);
    wheels.frustumCulled = false;
    hull.add(wheels);
    if (W.extra) {
      smalls = new THREE.InstancedMesh(g.small, mat, W.extra.length * 2);
      bindEntityLight(smalls, () => light);
      smalls.frustumCulled = false;
      hull.add(smalls);
    }
  }
  let rollL = 0;
  let rollR = 0;
  // Lays out the links and turns the wheels for track distances l (left), r (right).
  model.roll = (l, r = l) => {
    rollL = l;
    rollR = r;
    if (links) {
      const T = lay.track;
      const pitch = model._pitch;
      for (let side = 0; side < 2; side++) {
        const d = side ? rollR : rollL;
        const x = side ? T.x : -T.x;
        for (let i = 0; i < model._perSide; i++) {
          model._path.at(i * pitch + d, belt);
          _o.position.set(x, belt.y, belt.z);
          // (the link lies along the belt, its guide horn toward the inside of the loop)
          _o.rotation.set(-belt.a, 0, 0);
          _o.updateMatrix();
          links.setMatrixAt(side * model._perSide + i, _o.matrix);
        }
      }
      links.instanceMatrix.needsUpdate = true;
    }
    if (wheels) {
      const W = lay.wheels;
      let k = 0;
      if (kind === "tel") {
        for (const [z, y, x] of W.list) {
          _o.position.set(x, y, z);
          _o.rotation.set(-(x < 0 ? rollL : rollR) / W.r, 0, 0);
          _o.updateMatrix();
          wheels.setMatrixAt(k++, _o.matrix);
        }
      } else {
        const T = lay.track;
        for (let side = 0; side < 2; side++) {
          const d = side ? rollR : rollL;
          const sx = side ? 1 : -1;
          for (const [z, y, off] of W.list) {
            _o.position.set(sx * (T.x + off), y, z);
            _o.rotation.set(-d / W.r, 0, 0);
            _o.updateMatrix();
            wheels.setMatrixAt(k++, _o.matrix);
          }
        }
        if (smalls) {
          let j = 0;
          for (let side = 0; side < 2; side++) {
            const d = side ? rollR : rollL;
            for (const [z, y, , r] of W.extra) {
              _o.position.set((side ? 1 : -1) * T.x, y, z);
              _o.rotation.set(-d / r, 0, 0);
              _o.updateMatrix();
              smalls.setMatrixAt(j++, _o.matrix);
            }
          }
          smalls.instanceMatrix.needsUpdate = true;
        }
      }
      wheels.instanceMatrix.needsUpdate = true;
    }
  };

  // ---- Turret, gun, barrel ----
  if (g.turret) {
    const turret = new THREE.Group();
    turret.position.z = lay.turretZ || 0;
    hull.add(turret);
    mesh(g.turret, mat, turret);
    const gun = new THREE.Group();
    gun.position.set(lay.gunAt[0], lay.gunAt[1], lay.gunAt[2]);
    turret.add(gun);
    mesh(g.gun, mat, gun);
    const barrel = new THREE.Group();
    gun.add(barrel);
    mesh(g.barrel, mat, barrel);
    const muzzle = new THREE.Object3D();
    muzzle.position.set(0, 0, -lay.muzzle);
    barrel.add(muzzle);
    model.turret = turret;
    model.gun = gun;
    model.barrel = barrel;
    model.muzzle = muzzle;
    // The muzzle flash: two crossed additive quads and a star, shown a moment.
    const fm = new THREE.MeshBasicMaterial({ map: flashTexture(), color: new THREE.Color(3, 2.4, 1.6), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: true });
    mats.push(fm);
    const flash = new THREE.Group();
    for (const r of [0, Math.PI / 2]) {
      const q = new THREE.Mesh(new THREE.PlaneGeometry(1, 3).translate(0, 1.4, 0).rotateX(-Math.PI / 2), fm);
      q.rotation.z = r;
      q.layers.set(LAYER_FX);
      flash.add(q);
    }
    // (The star: a sprite, so it faces the camera from any side.)
    const sm = new THREE.SpriteMaterial({ map: flashTexture(), color: new THREE.Color(3, 2.4, 1.6), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, fog: true });
    mats.push(sm);
    const star = new THREE.Sprite(sm);
    star.scale.setScalar(2.6);
    star.layers.set(LAYER_FX);
    flash.add(star);
    flash.visible = false;
    muzzle.add(flash);
    model._flash = flash;
    model._star = star;
    // Extra muzzles (the AA's cannons), its radars.
    if (lay.guns) model.guns = lay.guns.map(([x, y, z]) => {
      const o = new THREE.Object3D();
      o.position.set(x, y, z);
      gun.add(o);
      return o;
    });
    if (lay.sams) model.sams = lay.sams.map(([x, y, z]) => {
      const o = new THREE.Object3D();
      o.position.set(x, y, z);
      gun.add(o);
      return o;
    });
    if (g.radar) {
      const rg = new THREE.Group();
      rg.position.set(...lay.radarAt);
      turret.add(rg);
      mesh(g.radar, mat, rg);
      model._radar = rg;
      const dg = new THREE.Group();
      dg.position.set(...lay.dishAt);
      turret.add(dg);
      mesh(g.dish, mat, dg);
      model._dish = dg;
    }
  }
  model.setTurret = (yaw) => {
    if (model.turret) model.turret.rotation.y = yaw;
  };
  model.setGun = (pitch) => {
    if (model.gun) model.gun.rotation.x = pitch;
  };
  // Recoil: 1 the moment it fires (the barrel all the way back), easing to 0.
  model.setRecoil = (k) => {
    if (!model.barrel) return;
    const back = kind === "tiger" ? 0.62 : kind === "mbt" ? 0.55 : 0.12;
    model.barrel.position.z = back * Math.max(0, k) * Math.max(0, k);
  };
  // The flash at the muzzle (0-1 of its short life; 0 hides it).
  model.setFlash = (k, size = 1) => {
    const f = model._flash;
    if (!f) return;
    f.visible = k > 0;
    if (k > 0) {
      const s = size * (0.6 + 0.6 * k);
      f.scale.set(s, s, s * (0.8 + Math.random() * 0.4));
      model._star.material.rotation = Math.random() * 6.28;
    }
  };

  // ---- The TEL's erector, jacks and missile ----
  if (kind === "tel") {
    const er = new THREE.Group();
    er.position.set(...lay.pivot);
    hull.add(er);
    // (The arm's beams run forward from the pivot along -z.)
    const arm = mesh(g.erector, mat, er);
    arm.position.set(0, 0, 0);
    const mount = new THREE.Group();
    mount.position.set(...lay.missileAt);
    er.add(mount);
    const missile = mesh(g.missile, plain, mount);
    model.erector = er;
    model.missileMount = mount;
    model.missileMesh = missile;
    // The ram on the truck: a cylinder from the deck to the arm (stretched as the arm rises).
    const ram = mesh(new THREE.CylinderGeometry(0.1, 0.1, 1, 8).translate(0, 0.5, 0), plain, hull, false);
    model._ram = ram;
    model.jacks = lay.jacks.map(([x, y, z]) => {
      const o = mesh(g.jack, plain, hull);
      o.position.set(x, y, z);
      return o;
    });
  }
  // a: 0 lying on the truck, 1 upright.
  model.setErector = (a) => {
    if (!model.erector) return;
    const ang = Math.max(0, Math.min(1, a)) * (Math.PI / 2);
    model.erector.rotation.x = ang;
    // The ram: from a point on the deck to a point on the arm.
    const base = _p.set(0, 1.7, 1.6);
    const tip = _s.set(0, -0.25, -3.2).applyAxisAngle(_v1.set(1, 0, 0), ang).add(_v2.set(...lay.pivot));
    const r = model._ram;
    r.position.copy(base);
    const d = tip.sub(base);
    r.scale.set(1, d.length(), 1);
    r.quaternion.setFromUnitVectors(_v1.set(0, 1, 0), d.normalize());
  };
  // k: 0 jacks up (driving), 1 down on the ground.
  model.setJacks = (k) => {
    if (!model.jacks) return;
    for (const j of model.jacks) j.scale.y = 0.15 + 0.85 * Math.max(0, Math.min(1, k));
  };
  model.setMissile = (on) => {
    if (model.missileMesh) model.missileMesh.visible = on;
  };
  // The missile's world matrix on the arm (its tail at the origin, nose toward -z).
  model.missileWorld = (out = new THREE.Matrix4()) => {
    root.updateMatrixWorld(true);
    return out.copy(model.missileMount.matrixWorld);
  };

  // ---- Per frame: the radar, the flash, a burning wreck ----
  model.animate = (t, { radar = true } = {}) => {
    if (model._radar && radar) model._radar.rotation.y = t * 2.4;
    if (model._dish) model._dish.rotation.y = Math.sin(t * 0.7) * 0.4;
  };
  model.setBurnt = (on, t = 0) => {
    if (!on) {
      mat.uniforms.uFill.value = 0.35;
      light.flash.setRGB(0, 0, 0);
      return;
    }
    mat.uniforms.uFill.value = 0.02;
    plain.uniforms.uFill.value = 0.02;
    // (charred: the paint near black, a glow of the fire inside)
    light.flash.setRGB(0.32 + 0.18 * Math.sin(t * 13), 0.1 + 0.06 * Math.sin(t * 19 + 1), 0.01);
  };
  // Night: a little ambient so it reads as a shape.
  model.setNight = (dark) => {
    mat.uniforms.uFill.value = 0.25 + 0.4 * dark;
    plain.uniforms.uFill.value = 0.2 + 0.35 * dark;
  };
  // The turret blown off a destroyed tank: it becomes its own object (returned), the hull keeps the rest.
  model.detachTurret = () => {
    const t = model.turret;
    if (!t) return null;
    root.updateMatrixWorld(true);
    const m = t.matrixWorld.clone();
    hull.remove(t);
    m.decompose(t.position, t.quaternion, t.scale);
    return t;
  };
  model.roll(0, 0);
  model.setErector(0);
  model.setJacks(0);
  model.dispose = () => {
    for (const m of mats) m.dispose();
    links?.dispose?.();
    wheels?.dispose?.();
    smalls?.dispose?.();
    if (model._ram) model._ram.geometry.dispose();
    if (model._flash) for (const c of model._flash.children) if (!c.isSprite) c.geometry.dispose();
  };
  return model;
}
const _v1 = new THREE.Vector3();
const _v2 = new THREE.Vector3();

// A flying ballistic missile's mesh (the same model, its own material).
export function createMissileMesh() {
  const g = geometriesFor("tel", "olive");
  const m = createEntityMaterial("color");
  m.uniforms.uFill.value = 0.35;
  const mesh = new THREE.Mesh(g.missile, m);
  mesh.castShadow = true;
  const light = { sky: 15, block: 0 };
  bindEntityLight(mesh, () => light);
  mesh.userData.light = light;
  return mesh;
}
