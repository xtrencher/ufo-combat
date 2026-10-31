// (Round 14) The helicopters, built from simple procedural pieces in the
// game's model style (flat-shaded lofts, boxes, wedges and cylinders with
// vertex colours, the entity shader's paint finish), like tank-model.js:
//   apache     an attack helicopter (an AH-64D Apache): the narrow faceted
//              fuselage with the tandem cockpit (the gunner in front, the
//              pilot raised behind) under flat glass panels, the nose's
//              sensor turret (it looks where the gun looks), the chin gun
//              on its turret, the side sponsons, the two engines with
//              their exhaust suppressors, the stub wings with a rocket pod
//              inboard and four Hellfires outboard on each side, the
//              Longbow radar dome on the mast, the four-blade main rotor,
//              the tail boom, the fin with the scissor tail rotor on its
//              left side, the stabilator, the main wheels and tail wheel;
//   blackhawk  a utility / transport helicopter (a UH-60 Black Hawk): the
//              wide cabin with big cockpit windows and the sliding doors,
//              a door gun each side, the engines on the roof, the long
//              boom with the canted tail rotor on the right, the stabilator,
//              the wheels.
// Paints: "army" (olive drab), "desert", "grey", "black" (the transport's),
// "enemy" (the aliens' hijacked machines: charcoal, red triangles).
//
// Moving parts: the main and tail rotors (blades while they turn slowly; a
// blurred disc once they're up to speed), the gun turret and the sensor
// turret (yaw, the gun's pitch), the stores (a Hellfire leaves its rail; the
// pods show empty tubes when the rockets are spent), the muzzle flash, the
// navigation lights and the beacon at night, a burnt wreck.
//
// Model space: the nose toward -Z, up +Y, right +X; y 0 is the bottom of the
// wheels (the ground); 1 unit is a block (a metre).
import * as THREE from "three";
import { createEntityMaterial, bindEntityLight } from "./shaders.js";
import { LAYER_FX } from "./layers.js";

export const HELI_PAINTS = {
  army: { base: 0x3e4535, dark: 0x2e3328, light: 0x535b48, camo: 0.12, mark: 0x1c1f1a },
  desert: { base: 0x9a8662, dark: 0x7b6a4d, light: 0xb19c78, camo: 0.18, mark: 0x3a3428 },
  grey: { base: 0x5b6168, dark: 0x45494f, light: 0x737a82, camo: 0.1, mark: 0x26292c },
  black: { base: 0x2f3330, dark: 0x232624, light: 0x3f4440, camo: 0.08, mark: 0x777a74 },
  enemy: { base: 0x2b2d32, dark: 0x1f2125, light: 0x3c3f46, camo: 0.3, mark: 0xa8241c },
};
const METAL = 0x4a4c4e;
const STEEL = 0x6f7275;
const RUBBER = 0x1d1d1f;
const SENSOR = 0x16191c;
const WHITE = 0xe2e0d8;
const RED = 0xa8241c;
const HELLFIRE = 0x6e7360;
const ROCKET = 0x5e624f;
const BLADE = 0x26282a;
const SOOT = 0x141313;
// The paint's finish (entity shader): matte, a little worn (army helicopters aren't glossy).
const FINISH = { spec: 0.22, gloss: 18, env: 0.1, grain: 0.04, panel: 0.22, panelScale: 1.1, livery: 0.2, liveryScale: 0.35 };

// The two kinds' sizes and where things are (model space). rotor: the main
// rotor's hub height, radius and blades; tail: the tail rotor's hub and
// radius and which side; gear: wheel contact points ([x, z]) for landing.
export const HELI_LAYOUT = {
  apache: { length: 15.6, width: 5.6, height: 4.4, rotor: { y: 3.78, z: 0.25, r: 6.4, blades: 4, chord: 0.5 }, tail: { x: -0.36, y: 3.55, z: 8.95, r: 1.4, side: -1 }, gun: [0, 0.82, -4.75], gunLen: 1.85, sensor: [0, 1.5, -6.55], gear: [[-1.12, -2.3], [1.12, -2.3], [0, 8.25]], seat: [0, 2.2, -2.3], pods: [[-1.38, 1.22, -0.1], [1.38, 1.22, -0.1]], rails: [[-2.38, 1.2, -0.1], [2.38, 1.2, -0.1]], exhaust: [[-1.15, 2.55, 2.6], [1.15, 2.55, 2.6]] },
  blackhawk: { length: 17.5, width: 4.6, height: 4.9, rotor: { y: 4.05, z: -0.2, r: 7.2, blades: 4, chord: 0.55 }, tail: { x: 0.42, y: 3.7, z: 10.3, r: 1.5, side: 1 }, gun: [1.38, 1.65, -2.35], gunLen: 1.0, gun2: [-1.38, 1.65, -2.35], sensor: null, gear: [[-1.5, -2.7], [1.5, -2.7], [0, 7.6]], seat: [0, 1.9, -3.2], pods: null, rails: null, exhaust: [[-0.75, 3.0, 1.9], [0.75, 3.0, 1.9]] },
};

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

  box(x, y, z, sx, sy, sz, c, rx = 0, ry = 0, rz = 0) {
    this._add(new THREE.BoxGeometry(sx, sy, sz), this._mat(x, y, z, rx, ry, rz), c);
  }

  // A cylinder along `axis` centred at (x, y, z) (along z: r at +z, r2 at -z).
  cyl(x, y, z, r, len, c, axis = "y", seg = 12, r2 = r, rx = 0, ry = 0, rz = 0) {
    const g = new THREE.CylinderGeometry(r2, r, len, seg);
    if (axis === "x") g.rotateZ(-Math.PI / 2);
    else if (axis === "z") g.rotateX(-Math.PI / 2);
    this._add(g, this._mat(x, y, z, rx, ry, rz), c);
  }

  sphere(x, y, z, r, c, sx = 1, sy = 1, sz = 1, seg = 12) {
    this._add(new THREE.SphereGeometry(r, seg, Math.max(6, seg >> 1)), this._mat(x, y, z, 0, 0, 0, sx, sy, sz), c);
  }

  // A solid from 8 corners (bottom loop then top loop); faces made to face out.
  hexa(pts, c) {
    const [b0, b1, b2, b3, t0, t1, t2, t3] = pts;
    const quads = [[b0, b1, b2, b3], [t0, t1, t2, t3], [b0, b1, t1, t0], [b1, b2, t2, t1], [b2, b3, t3, t2], [b3, b0, t0, t3]];
    const cx = pts.reduce((s, p) => s + p[0], 0) / 8;
    const cy = pts.reduce((s, p) => s + p[1], 0) / 8;
    const cz = pts.reduce((s, p) => s + p[2], 0) / 8;
    const pos = [];
    for (const [a, b0_, d0, e] of quads) {
      for (let [p, q, r] of [[a, b0_, d0], [a, d0, e]]) {
        const ux = q[0] - p[0], uy = q[1] - p[1], uz = q[2] - p[2];
        const vx = r[0] - p[0], vy = r[1] - p[1], vz = r[2] - p[2];
        const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
        if (nx * nx + ny * ny + nz * nz < 1e-12) continue;
        const mx = (p[0] + q[0] + r[0]) / 3 - cx, my = (p[1] + q[1] + r[1]) / 3 - cy, mz = (p[2] + q[2] + r[2]) / 3 - cz;
        if (nx * mx + ny * my + nz * mz < 0) [q, r] = [r, q];
        pos.push(...p, ...q, ...r);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    this._add(g, _m.identity(), c);
  }

  // A box from (x0, y0, z0) to (x1, y1, z1) whose top is pulled in by tf
  // (front, -z), tb (back) and ts (each side), its bottom by bf / bb.
  slab(x0, x1, y0, y1, z0, z1, c, { tf = 0, tb = 0, ts = 0, bf = 0, bb = 0, bs = 0 } = {}) {
    this.hexa([[x0 + bs, y0, z0 + bf], [x1 - bs, y0, z0 + bf], [x1 - bs, y0, z1 - bb], [x0 + bs, y0, z1 - bb], [x0 + ts, y1, z0 + tf], [x1 - ts, y1, z0 + tf], [x1 - ts, y1, z1 - tb], [x0 + ts, y1, z1 - tb]], c);
  }

  // A loft through cross sections [{ z, pts: [[x, y], ...] }] (the same
  // number of points, round the same way), the ends capped.
  loft(sections, c) {
    const n = sections[0].pts.length;
    const pos = [];
    const tri = (a, b, d) => pos.push(...a, ...b, ...d);
    for (let s = 0; s + 1 < sections.length; s++) {
      const A = sections[s];
      const B = sections[s + 1];
      for (let i = 0; i < n; i++) {
        const j = (i + 1) % n;
        const a0 = [A.pts[i][0], A.pts[i][1], A.z];
        const a1 = [A.pts[j][0], A.pts[j][1], A.z];
        const b0 = [B.pts[i][0], B.pts[i][1], B.z];
        const b1 = [B.pts[j][0], B.pts[j][1], B.z];
        tri(a0, b0, b1);
        tri(a0, b1, a1);
      }
    }
    // (The caps: fans from each end's middle.)
    for (const [S, flip] of [[sections[0], true], [sections[sections.length - 1], false]]) {
      let cx = 0;
      let cy = 0;
      for (const p of S.pts) {
        cx += p[0] / n;
        cy += p[1] / n;
      }
      for (let i = 0; i < n; i++) {
        const j = (i + 1) % n;
        const a = [S.pts[i][0], S.pts[i][1], S.z];
        const b = [S.pts[j][0], S.pts[j][1], S.z];
        if (flip) tri([cx, cy, S.z], b, a);
        else tri([cx, cy, S.z], a, b);
      }
    }
    // (Every face out: against the loft's own axis.)
    const out = [];
    let mz = 0;
    for (const S of sections) mz += S.z / sections.length;
    for (let i = 0; i < pos.length; i += 9) {
      let p = [pos[i], pos[i + 1], pos[i + 2]];
      let q = [pos[i + 3], pos[i + 4], pos[i + 5]];
      let r = [pos[i + 6], pos[i + 7], pos[i + 8]];
      const ux = q[0] - p[0], uy = q[1] - p[1], uz = q[2] - p[2];
      const vx = r[0] - p[0], vy = r[1] - p[1], vz = r[2] - p[2];
      const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
      if (nx * nx + ny * ny + nz * nz < 1e-14) continue;
      const fx = (p[0] + q[0] + r[0]) / 3;
      const fy = (p[1] + q[1] + r[1]) / 3;
      const fz = (p[2] + q[2] + r[2]) / 3;
      // (The axis point nearest this face: its section's middle.)
      const S = sections.reduce((best, s) => (Math.abs(s.z - fz) < Math.abs(best.z - fz) ? s : best), sections[0]);
      let sx = 0;
      let sy = 0;
      for (const pp of S.pts) {
        sx += pp[0] / n;
        sy += pp[1] / n;
      }
      const isCap = Math.abs(nz) > 0.98 * Math.hypot(nx, ny, nz) && (Math.abs(fz - sections[0].z) < 1e-6 || Math.abs(fz - sections[sections.length - 1].z) < 1e-6);
      const dot = isCap ? nz * (fz - mz) : nx * (fx - sx) + ny * (fy - sy);
      if (dot < 0) [q, r] = [r, q];
      out.push(...p, ...q, ...r);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(out, 3));
    this._add(g, _m.identity(), c);
  }

  // A flat triangle marking on a side (the aliens' sign).
  triX(x, y, z, r, c, sign = 1) {
    const shape = new THREE.Shape();
    shape.moveTo(0, r);
    shape.lineTo(r * 0.9, -r * 0.6);
    shape.lineTo(-r * 0.9, -r * 0.6);
    const g = new THREE.ShapeGeometry(shape);
    g.rotateY(sign > 0 ? Math.PI / 2 : -Math.PI / 2);
    this._add(g, this._mat(x + sign * 0.015, y, z), c);
  }

  // A five-pointed star on a side (ours).
  starX(x, y, z, r, c, sign = 1) {
    const shape = new THREE.Shape();
    for (let i = 0; i < 10; i++) {
      const a = (i / 10) * Math.PI * 2 - Math.PI / 2;
      const rr = i % 2 ? r * 0.4 : r;
      if (i) shape.lineTo(Math.cos(a) * rr, -Math.sin(a) * rr);
      else shape.moveTo(Math.cos(a) * rr, -Math.sin(a) * rr);
    }
    const g = new THREE.ShapeGeometry(shape);
    g.rotateY(sign > 0 ? Math.PI / 2 : -Math.PI / 2);
    this._add(g, this._mat(x + sign * 0.015, y, z), c);
  }

  empty() {
    return this.pos.length === 0;
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

function shade(hex, k) {
  const c = new THREE.Color(hex);
  return c.multiplyScalar(k).getHex();
}

// An octagonal cross section: half width w, from y0 to y1 (the corners
// chamfered: `low` how far up the lower side faces start, `top` the top's
// half width share).
function oct(z, w, y0, y1, low = 0.25, top = 0.6, bottom = 0.55) {
  const h = y1 - y0;
  return { z, pts: [[w * bottom, y0], [w, y0 + h * low], [w, y0 + h * 0.72], [w * top, y1], [-w * top, y1], [-w, y0 + h * 0.72], [-w, y0 + h * low], [-w * bottom, y0]] };
}

// ---------- The Apache ----------

function buildApache(pal) {
  const L = HELI_LAYOUT.apache;
  const body = new Kit();
  const glass = new Kit();
  const P = pal.base;
  const D = pal.dark;
  const Lt = pal.light;
  // The fuselage: the nose, the tandem cockpits, the engine deck, the boom.
  body.loft([
    oct(-6.25, 0.3, 1.3, 1.85, 0.3, 0.7),
    oct(-5.7, 0.5, 1.02, 2.02),
    oct(-4.3, 0.58, 0.92, 2.02),
    oct(-2.9, 0.62, 0.88, 2.12),
    oct(-1.3, 0.66, 0.88, 2.38),
    oct(0.5, 0.64, 0.96, 2.62),
    oct(2.3, 0.5, 1.22, 2.5),
    oct(3.6, 0.32, 1.62, 2.36),
    oct(6.0, 0.22, 1.86, 2.3),
    oct(8.5, 0.17, 1.95, 2.3),
  ], (x, y, z) => (y > 2.2 && z > -1 ? Lt : y < 1.1 ? D : P));
  // The tandem canopy: the gunner's in front, the pilot's raised behind it (flat panels).
  glass.slab(-0.55, 0.55, 2.0, 2.62, -5.55, -3.45, 0x000000, { tf: 0.85, tb: 0.05, ts: 0.2 });
  glass.slab(-0.6, 0.6, 2.05, 2.98, -3.45, -1.35, 0x000000, { tf: 0.5, tb: 0.25, ts: 0.22 });
  // The canopy's frames: a sill, the bows between the panes.
  body.box(0.6, 2.06, -3.45, 0.06, 0.08, 4.25, D);
  body.box(-0.6, 2.06, -3.45, 0.06, 0.08, 4.25, D);
  body.box(0, 2.7, -3.42, 1.0, 0.1, 0.08, D, 0.3);
  body.box(0, 2.95, -1.55, 0.95, 0.08, 0.1, D);
  body.box(0, 2.98, -2.4, 0.06, 0.06, 1.75, D);
  // The sponsons (avionics bays) along the sides, and the steps.
  for (const s of [-1, 1]) {
    body.slab(s > 0 ? 0.5 : -1.18, s > 0 ? 1.18 : -0.5, 0.98, 1.92, -3.4, 1.7, P, { tf: 0.6, bf: 0.3, ts: 0.1 });
    body.box(s * 1.19, 1.4, -1.0, 0.04, 0.5, 1.6, D); // (a bay door's seam)
    body.box(s * 0.98, 1.05, -2.6, 0.32, 0.06, 0.5, METAL); // (a step)
  }
  // The engines: nacelles on the shoulders, intakes in front, the exhaust
  // suppressors turned out at the back; the deck between them.
  for (const s of [-1, 1]) {
    body.cyl(s * 1.0, 2.5, 0.75, 0.43, 3.1, P, "z", 12, 0.4);
    body.cyl(s * 1.0, 2.5, -0.82, 0.36, 0.08, SENSOR, "z", 12);
    body.cyl(s * 1.0, 2.5, -0.9, 0.42, 0.14, D, "z", 12);
    body.box(s * 1.15, 2.55, 2.6, 0.5, 0.42, 0.9, D, 0, s * 0.35);
    body.box(s * 1.32, 2.55, 2.95, 0.2, 0.3, 0.12, SOOT, 0, s * 0.35);
  }
  body.slab(-0.7, 0.7, 2.55, 2.95, -0.6, 2.2, P, { tf: 0.3, tb: 0.6, ts: 0.2 });
  // The mast, the swashplate, the IR jammer behind it.
  body.cyl(0, 3.3, L.rotor.z, 0.17, 1.0, METAL, "y", 10);
  body.cyl(0, 3.1, L.rotor.z, 0.35, 0.22, STEEL, "y", 12);
  body.cyl(0, 3.02, 1.95, 0.17, 0.4, SENSOR, "y", 8);
  body.cyl(0, 2.85, 1.95, 0.09, 0.2, METAL, "y", 6);
  // The Longbow radar dome on the mast.
  body.sphere(0, 4.22, L.rotor.z, 0.6, D, 1, 0.42, 1);
  body.cyl(0, 4.0, L.rotor.z, 0.2, 0.2, METAL, "y", 8);
  // The stub wings, their pylons and wingtip dispensers.
  for (const s of [-1, 1]) {
    body.hexa([[s * 0.6, 1.86, -0.55], [s * 2.78, 1.8, -0.4], [s * 2.78, 1.8, 0.45], [s * 0.6, 1.86, 0.6], [s * 0.6, 2.02, -0.5], [s * 2.78, 1.94, -0.38], [s * 2.78, 1.94, 0.42], [s * 0.6, 2.02, 0.55]], P);
    body.box(s * 2.86, 1.86, 0.02, 0.18, 0.18, 0.75, D);
    for (const px of [1.38, 2.38]) body.slab(s * px - 0.08, s * px + 0.08, 1.48, 1.84, -0.35, 0.4, D, { tf: 0.1, bf: 0.15 });
  }
  // The rocket pods (19 tubes each) on the inner pylons.
  const pods = new Kit();
  for (const [x, y, z] of L.pods) {
    pods.cyl(x, y, z, 0.34, 1.7, ROCKET, "z", 14);
    pods.cyl(x, y, z - 0.86, 0.34, 0.04, shade(ROCKET, 0.7), "z", 14);
    pods.cyl(x, y, z + 0.86, 0.3, 0.08, shade(ROCKET, 0.8), "z", 14);
    pods.box(x, y + 0.34, z, 0.06, 0.05, 1.4, shade(ROCKET, 0.8));
    // The tube mouths: a ring of dark holes.
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2;
      pods.cyl(x + Math.cos(a) * 0.22, y + Math.sin(a) * 0.22, z - 0.865, 0.05, 0.03, SOOT, "z", 6);
    }
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      pods.cyl(x + Math.cos(a) * 0.1, y + Math.sin(a) * 0.1, z - 0.865, 0.045, 0.03, SOOT, "z", 6);
    }
    pods.cyl(x, y, z - 0.865, 0.045, 0.03, SOOT, "z", 6);
  }
  // The Hellfire rails on the outer pylons (the missiles themselves are their own meshes).
  for (const [x, y, z] of L.rails) {
    body.box(x, y + 0.24, z, 0.62, 0.08, 1.2, D);
    body.box(x, y + 0.02, z, 0.08, 0.4, 1.1, D);
  }
  // The nose: the sensor turret's housing (the turret itself turns: TADS/PNVS).
  body.cyl(0, 1.5, -6.22, 0.3, 0.3, D, "z", 10);
  // The chin gun's mount under the nose.
  body.slab(-0.3, 0.3, 0.92, 1.05, -5.0, -4.3, D, { tf: 0.1 });
  // The main gear: trailing arms down from the sponsons, the wheels; the tail wheel.
  const wheels = new Kit();
  for (const s of [-1, 1]) {
    body.box(s * 1.08, 0.75, -2.15, 0.12, 0.85, 0.12, METAL, 0.35);
    body.box(s * 1.0, 1.0, -2.4, 0.1, 0.5, 0.1, STEEL, -0.2);
    wheels.cyl(s * 1.12, 0.38, -2.3, 0.38, 0.24, RUBBER, "x", 14);
    wheels.cyl(s * 1.12 + s * 0.13, 0.38, -2.3, 0.2, 0.04, STEEL, "x", 10);
  }
  body.box(0, 1.15, 8.35, 0.1, 1.5, 0.12, METAL, 0.18);
  wheels.cyl(0, 0.3, 8.25, 0.3, 0.18, RUBBER, "x", 12);
  // The tail: the fin (swept), the stabilator, the tail rotor's gearbox.
  body.hexa([[-0.08, 2.15, 7.8], [0.08, 2.15, 7.8], [0.08, 2.15, 9.15], [-0.08, 2.15, 9.15], [-0.07, 4.05, 8.75], [0.07, 4.05, 8.75], [0.07, 4.05, 9.45], [-0.07, 4.05, 9.45]], P);
  body.hexa([[-1.75, 1.95, 8.35], [1.75, 1.95, 8.35], [1.75, 1.95, 9.05], [-1.75, 1.95, 9.05], [-1.75, 2.05, 8.45], [1.75, 2.05, 8.45], [1.75, 2.05, 9.05], [-1.75, 2.05, 9.05]], D);
  body.cyl(-0.18, L.tail.y, L.tail.z, 0.16, 0.3, METAL, "x", 8);
  // Antennas, the beacon's base, the wire cutters.
  body.box(0, 2.72, 3.2, 0.04, 0.5, 0.06, METAL, 0.4);
  body.box(0, 0.86, -1.6, 0.04, 0.3, 0.05, METAL, -0.3);
  body.box(0, 2.65, -5.0, 0.04, 0.42, 0.06, METAL, -0.5);
  body.box(0, 0.82, -3.6, 0.04, 0.28, 0.05, METAL, 0.5);
  // Markings: the star (ours) or the aliens' triangle on the boom, a number.
  const enemy = pal === HELI_PAINTS.enemy;
  for (const s of [-1, 1]) {
    if (enemy) body.triX(s * 0.26, 2.1, 4.8, 0.32, RED, s);
    else body.starX(s * 0.26, 2.1, 4.8, 0.26, pal.mark === 0x1c1f1a ? 0x1a1d18 : WHITE, s);
  }
  return { body, glass, pods, wheels };
}

// ---------- The Black Hawk ----------

function buildBlackhawk(pal) {
  const L = HELI_LAYOUT.blackhawk;
  const body = new Kit();
  const glass = new Kit();
  const P = pal.base;
  const D = pal.dark;
  const Lt = pal.light;
  // The fuselage: the nose, the wide cabin, the hump over it, the boom.
  body.loft([
    oct(-5.6, 0.35, 1.0, 1.7, 0.3, 0.7, 0.7),
    oct(-5.0, 0.82, 0.78, 2.2, 0.25, 0.7, 0.7),
    oct(-3.9, 1.12, 0.66, 2.62, 0.2, 0.75, 0.7),
    oct(-2.2, 1.2, 0.62, 2.72, 0.2, 0.78, 0.72),
    oct(0.6, 1.2, 0.62, 2.72, 0.2, 0.78, 0.72),
    oct(2.0, 1.0, 0.85, 2.7, 0.25, 0.7, 0.6),
    oct(3.2, 0.5, 1.35, 2.62, 0.3, 0.7),
    oct(6.5, 0.32, 1.62, 2.56, 0.3, 0.7),
    oct(9.6, 0.24, 1.9, 2.58, 0.3, 0.7),
  ], (x, y, z) => (y > 2.5 && z > -3 ? Lt : y < 0.9 ? D : P));
  // The windscreen and the cockpit's side windows; the cabin windows.
  glass.slab(-1.0, 1.0, 1.7, 2.55, -5.45, -4.1, 0x000000, { tf: 0.95, ts: 0.18, bf: 0.2 });
  for (const s of [-1, 1]) {
    glass.box(s * 1.13, 2.0, -3.75, 0.06, 0.75, 1.0, 0x000000);
    glass.box(s * 1.21, 2.05, -1.4, 0.04, 0.55, 0.62, 0x000000);
    glass.box(s * 1.21, 2.05, 0.1, 0.04, 0.55, 0.62, 0x000000);
    // The sliding door's rails and frame.
    body.box(s * 1.22, 2.42, -0.6, 0.05, 0.06, 3.2, D);
    body.box(s * 1.22, 0.9, -0.6, 0.05, 0.06, 3.2, D);
    body.box(s * 1.22, 1.66, -2.15, 0.05, 1.5, 0.06, D);
    body.box(s * 1.22, 1.66, 0.95, 0.05, 1.5, 0.06, D);
  }
  // The engines and the transmission fairing on the roof.
  body.slab(-0.95, 0.95, 2.62, 3.25, -2.6, 2.3, P, { tf: 0.6, tb: 0.9, ts: 0.25 });
  for (const s of [-1, 1]) {
    body.cyl(s * 0.75, 3.0, 0.3, 0.42, 3.0, P, "z", 12, 0.4);
    body.cyl(s * 0.75, 3.0, -1.22, 0.32, 0.06, SENSOR, "z", 12);
    body.box(s * 0.85, 3.05, 2.0, 0.45, 0.4, 0.6, D, 0, s * 0.4);
  }
  body.cyl(0, 3.6, L.rotor.z, 0.2, 0.9, METAL, "y", 10);
  body.cyl(0, 3.35, L.rotor.z, 0.42, 0.22, STEEL, "y", 12);
  // The fin (canted, swept) and the stabilator; the tail rotor's gearbox on the right.
  body.hexa([[-0.12, 2.3, 8.9], [0.12, 2.3, 8.9], [0.12, 2.3, 10.4], [-0.12, 2.3, 10.4], [-0.1, 4.3, 10.0], [0.1, 4.3, 10.0], [0.1, 4.3, 10.9], [-0.1, 4.3, 10.9]], P);
  body.hexa([[-1.85, 2.25, 9.6], [1.85, 2.25, 9.6], [1.85, 2.25, 10.35], [-1.85, 2.25, 10.35], [-1.85, 2.35, 9.7], [1.85, 2.35, 9.7], [1.85, 2.35, 10.35], [-1.85, 2.35, 10.35]], D);
  body.cyl(0.2, L.tail.y, L.tail.z, 0.17, 0.35, METAL, "x", 8);
  // The gear: the main legs out from the cabin, the wheels; the tail wheel.
  const wheels = new Kit();
  for (const s of [-1, 1]) {
    body.box(s * 1.35, 0.8, -2.55, 0.14, 0.95, 0.14, METAL, 0, 0, s * 0.35);
    body.box(s * 1.25, 1.05, -2.7, 0.5, 0.1, 0.1, STEEL);
    wheels.cyl(s * 1.5, 0.42, -2.7, 0.42, 0.26, RUBBER, "x", 14);
    wheels.cyl(s * 1.64, 0.42, -2.7, 0.22, 0.04, STEEL, "x", 10);
  }
  body.box(0, 1.0, 7.75, 0.12, 1.25, 0.12, METAL, 0.2);
  wheels.cyl(0, 0.32, 7.6, 0.32, 0.18, RUBBER, "x", 12);
  // The door guns' mounts (the guns turn: their own meshes), antennas, the nose's probe.
  for (const s of [-1, 1]) body.box(s * 1.32, 1.5, -2.35, 0.2, 0.08, 0.2, METAL);
  body.box(0, 2.95, 3.6, 0.04, 0.6, 0.06, METAL, 0.4);
  body.box(0, 0.6, -1.0, 0.04, 0.3, 0.05, METAL, -0.3);
  // Markings.
  const enemy = pal === HELI_PAINTS.enemy;
  for (const s of [-1, 1]) {
    if (enemy) body.triX(s * 0.33, 2.3, 5.2, 0.32, RED, s);
    else body.starX(s * 0.33, 2.3, 5.2, 0.26, WHITE, s);
  }
  return { body, glass, pods: null, wheels };
}

// ---------- Rotors ----------

// The main rotor's blades (in the rotor's frame: the hub at the origin).
function rotorBlades(R, n, chord, color, droop = 0.04) {
  const k = new Kit();
  k.cyl(0, 0, 0, 0.32, 0.26, STEEL, "y", 12);
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    const ca = Math.cos(a);
    const sa = Math.sin(a);
    // (Out along the blade: a slight droop and a twist; a darker tip cap.)
    const seg = 3;
    for (let s = 0; s < seg; s++) {
      const r0 = 0.3 + ((R - 0.3) * s) / seg;
      const r1 = 0.3 + ((R - 0.3) * (s + 1)) / seg;
      const rm = (r0 + r1) / 2;
      const len = r1 - r0;
      const y = -droop * (rm / R) * (rm / R) * R * 0.1;
      k.box(ca * rm, y, -sa * rm, len, 0.055, chord, s === seg - 1 ? shade(color, 0.85) : color, 0, a, 0);
    }
    k.box(ca * (R - 0.15), -droop * R * 0.1, -sa * (R - 0.15), 0.3, 0.06, chord * 1.02, 0x8c8a80, 0, a, 0);
    k.box(ca * 0.55, 0.05, -sa * 0.55, 0.5, 0.14, 0.22, METAL, 0, a, 0); // (the blade's root and pitch horn)
  }
  return k.geometry();
}

// The tail rotor (in its frame: the hub at the origin, the disc in the y-z plane).
function tailBlades(R, n, scissor) {
  const k = new Kit();
  k.cyl(0, 0, 0, 0.16, 0.2, STEEL, "x", 10);
  const angles = scissor ? [0.95, 0.95 + Math.PI, 2.2, 2.2 + Math.PI] : Array.from({ length: n }, (_, i) => (i / n) * Math.PI * 2);
  for (const a of angles) {
    const ca = Math.cos(a);
    const sa = Math.sin(a);
    k.box(0, sa * R * 0.5, ca * R * 0.5, 0.04, R * 0.95, 0.24, BLADE, a);
  }
  return k.geometry();
}

// A blurred disc for a rotor at speed: dark, faint, a little denser at the
// tips where the blades sweep fastest; streaks for the blades.
let discTex = null;
function discTexture() {
  if (discTex) return discTex;
  const c = document.createElement("canvas");
  c.width = c.height = 128;
  const ctx = c.getContext("2d");
  const g = ctx.createRadialGradient(64, 64, 4, 64, 64, 64);
  g.addColorStop(0, "rgba(40,40,40,0.1)");
  g.addColorStop(0.15, "rgba(40,40,40,0.35)");
  g.addColorStop(0.7, "rgba(35,35,35,0.42)");
  g.addColorStop(0.93, "rgba(30,30,30,0.55)");
  g.addColorStop(0.97, "rgba(120,118,110,0.45)");
  g.addColorStop(1, "rgba(30,30,30,0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 128, 128);
  // (Blade streaks: four soft wedges.)
  ctx.globalCompositeOperation = "source-atop";
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2;
    ctx.fillStyle = "rgba(10,10,10,0.25)";
    ctx.beginPath();
    ctx.moveTo(64, 64);
    ctx.arc(64, 64, 64, a, a + 0.35);
    ctx.closePath();
    ctx.fill();
  }
  discTex = new THREE.CanvasTexture(c);
  return discTex;
}

let glowTex = null;
function glowTexture() {
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

// A Hellfire (its own mesh: it leaves the rail), nose toward -z, the tail at z 0.8.
function hellfireGeometry() {
  const k = new Kit();
  k.cyl(0, 0, 0, 0.09, 1.3, HELLFIRE, "z", 10);
  k.cyl(0, 0, -0.78, 0.09, 0.26, shade(HELLFIRE, 0.9), "z", 10, 0.03);
  k.cyl(0, 0, -0.9, 0.03, 0.04, SENSOR, "z", 8);
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
    k.box(Math.cos(a) * 0.12, Math.sin(a) * 0.12, 0.5, 0.14, 0.02, 0.22, shade(HELLFIRE, 0.75), 0, 0, a);
    k.box(Math.cos(a) * 0.11, Math.sin(a) * 0.11, -0.35, 0.1, 0.02, 0.14, shade(HELLFIRE, 0.75), 0, 0, a);
  }
  k.box(0, 0, 0.66, 0.06, 0.06, 0.04, 0xd4c35a); // (the yellow band: live)
  return k.geometry();
}

// A rocket (Hydra 70) in flight, or a gun's barrel.
let _rocketGeo = null;
export function heliRocketGeometry() {
  if (_rocketGeo) return _rocketGeo;
  const k = new Kit();
  k.cyl(0, 0, 0, 0.055, 1.1, ROCKET, "z", 8);
  k.cyl(0, 0, -0.64, 0.055, 0.2, 0xbab49a, "z", 8, 0.015);
  for (let i = 0; i < 4; i++) k.box(0, 0, 0.5, 0.2, 0.015, 0.14, METAL, 0, 0, (i * Math.PI) / 4);
  _rocketGeo = k.geometry();
  return _rocketGeo;
}
let _hfGeo = null;
export function heliMissileGeometry() {
  return _hfGeo || (_hfGeo = hellfireGeometry());
}

// The chin gun (M230) on its turret, or a door gun (M134): the turret's yaw
// group holds a pitch group with the barrel along -z; the muzzle at -len.
function gunGeometry(kind, len) {
  const k = new Kit();
  if (kind === "apache") {
    // (The turret: a squat drum, the gun's breech and the feed chute.)
    k.cyl(0, 0.0, 0, 0.3, 0.32, 0x34372f, "y", 12);
    k.box(0, -0.18, -0.05, 0.36, 0.22, 0.62, 0x34372f);
    k.box(0, -0.2, 0.25, 0.16, 0.12, 0.4, METAL);
    k.cyl(0, -0.2, -len / 2 - 0.2, 0.065, len, STEEL, "z", 8);
    k.cyl(0, -0.2, -len - 0.22, 0.09, 0.22, METAL, "z", 8);
    k.box(0, -0.06, -0.55, 0.1, 0.1, 0.45, METAL);
  } else {
    // (A six-barrel minigun on its mount.)
    k.box(0, 0, 0.15, 0.18, 0.2, 0.5, METAL);
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      k.cyl(Math.cos(a) * 0.05, Math.sin(a) * 0.05, -len / 2, 0.018, len, STEEL, "z", 6);
    }
    k.cyl(0, 0, -len * 0.75, 0.08, 0.05, METAL, "z", 8);
    k.box(0, 0.15, 0.3, 0.06, 0.08, 0.28, METAL);
  }
  return k.geometry();
}

// The sensor turret (TADS/PNVS) on the Apache's nose.
function sensorGeometry() {
  const k = new Kit();
  k.cyl(0, 0, 0, 0.36, 0.5, SENSOR, "y", 12);
  k.box(0, -0.02, -0.3, 0.42, 0.3, 0.16, 0x1d2126);
  k.box(-0.1, -0.02, -0.39, 0.12, 0.1, 0.02, 0x3a5a6a);
  k.box(0.12, -0.02, -0.39, 0.1, 0.12, 0.02, 0x2f4a58);
  k.cyl(0, 0.38, -0.05, 0.16, 0.25, SENSOR, "y", 10); // (the night sight above)
  k.box(0, 0.38, -0.2, 0.18, 0.12, 0.08, 0x2f4a58);
  return k.geometry();
}

// ---------- The model ----------

const GEO = new Map();
function geometriesFor(kind, paint) {
  const key = `${kind}:${paint}`;
  if (GEO.has(key)) return GEO.get(key);
  const pal = HELI_PAINTS[paint];
  const L = HELI_LAYOUT[kind];
  const parts = kind === "blackhawk" ? buildBlackhawk(pal) : buildApache(pal);
  const g = {
    body: parts.body.geometry(),
    glass: parts.glass.geometry(),
    pods: parts.pods && !parts.pods.empty() ? parts.pods.geometry() : null,
    wheels: parts.wheels.geometry(),
    rotor: rotorBlades(L.rotor.r, L.rotor.blades, L.rotor.chord, BLADE),
    tail: tailBlades(L.tail.r, 4, kind === "apache"),
    gun: gunGeometry(kind, L.gunLen),
    sensor: kind === "apache" ? sensorGeometry() : null,
    camo: pal.camo,
  };
  GEO.set(key, g);
  return g;
}

// Creates a helicopter model. kind: "apache" | "blackhawk"; paint: a
// HELI_PAINTS key. Returns { root, body, light, layout, kind, paint, length,
// width, height, muzzle (the gun's), muzzles (all guns'), rocketMuzzles,
// missiles (the Hellfires on their rails), setRotor(angle, tailAngle, rpm),
// setGun(yaw, pitch), setFlash(k), setStores(rockets 0-1, missiles left),
// setLights(t, night, on), setBurnt(on, t), setNight(dark), dispose() }.
export function createHeliModel(kind = "apache", { paint = "army" } = {}) {
  if (!HELI_LAYOUT[kind]) kind = "apache";
  if (!HELI_PAINTS[paint]) paint = kind === "blackhawk" ? "black" : "army";
  const g = geometriesFor(kind, paint);
  const L = HELI_LAYOUT[kind];
  const root = new THREE.Group();
  const body = new THREE.Group(); // (tilts with the airframe; root carries the position and attitude)
  root.add(body);
  const light = { sky: 15, block: 0, flash: new THREE.Color(0, 0, 0) };
  const mat = createEntityMaterial("color", null, { finish: { ...FINISH, livery: g.camo } });
  mat.uniforms.uFill.value = 0.35;
  const plain = createEntityMaterial("color");
  plain.uniforms.uFill.value = 0.3;
  const glassMat = new THREE.MeshStandardMaterial({ color: kind === "blackhawk" ? 0x2a3640 : 0x33403a, metalness: 0.75, roughness: 0.12, transparent: true, opacity: 0.86 });
  const mats = [mat, plain, glassMat];
  const mesh = (geo, m = mat, parent = body, shadow = true) => {
    const o = new THREE.Mesh(geo, m);
    o.castShadow = shadow;
    if (m !== glassMat) bindEntityLight(o, () => light);
    parent.add(o);
    return o;
  };
  mesh(g.body);
  mesh(g.glass, glassMat, body, false);
  mesh(g.wheels, plain);
  if (g.pods) mesh(g.pods, plain);
  const model = { root, body, light, layout: L, kind, paint, length: L.length, width: L.width, height: L.height };

  // ---- The rotors ----
  const R = L.rotor;
  const rotor = new THREE.Group();
  rotor.position.set(0, R.y, R.z);
  body.add(rotor);
  const blades = mesh(g.rotor, plain, rotor);
  const discMat = new THREE.MeshBasicMaterial({ map: discTexture(), transparent: true, depthWrite: false, side: THREE.DoubleSide, fog: true, opacity: 0 });
  mats.push(discMat);
  const disc = new THREE.Mesh(new THREE.CircleGeometry(R.r, 40).rotateX(-Math.PI / 2), discMat);
  disc.position.y = -0.03;
  disc.renderOrder = 5;
  rotor.add(disc);
  const T = L.tail;
  const tail = new THREE.Group();
  tail.position.set(T.x, T.y, T.z);
  if (kind === "blackhawk") tail.rotation.z = -0.35; // (the Black Hawk's tail rotor is canted: some of its thrust lifts)
  body.add(tail);
  const tailBladesMesh = mesh(g.tail, plain, tail);
  const tdiscMat = discMat.clone();
  mats.push(tdiscMat);
  const tdisc = new THREE.Mesh(new THREE.CircleGeometry(T.r, 24).rotateY(Math.PI / 2), tdiscMat);
  tdisc.renderOrder = 5;
  tail.add(tdisc);
  model.rotor = rotor;
  model.tailRotor = tail;
  // angle: the main rotor's (radians), tailAngle the tail's; rpm 0-1: the
  // blades while slow, a blurred disc (and ghost blades) at speed.
  model.setRotor = (angle, tailAngle, rpm) => {
    rotor.rotation.y = angle;
    tail.rotation.x = tailAngle;
    const blur = Math.max(0, Math.min(1, (rpm - 0.35) / 0.4));
    discMat.opacity = blur * 0.85;
    tdiscMat.opacity = blur * 0.9;
    disc.visible = blur > 0.01;
    tdisc.visible = blur > 0.01;
    // (At speed the blades are a blur: hidden but for a faint ghost the disc's streaks give.)
    blades.visible = blur < 0.98;
    tailBladesMesh.visible = blur < 0.9;
  };

  // ---- The guns ----
  const guns = [];
  const addGun = (at, side = 0) => {
    const yawG = new THREE.Group();
    yawG.position.set(...at);
    body.add(yawG);
    const pitchG = new THREE.Group();
    yawG.add(pitchG);
    mesh(g.gun, plain, pitchG);
    const muzzle = new THREE.Object3D();
    muzzle.position.set(0, kind === "apache" ? -0.2 : 0, -L.gunLen - (kind === "apache" ? 0.3 : 0.05));
    pitchG.add(muzzle);
    guns.push({ yawG, pitchG, muzzle, side });
    return muzzle;
  };
  model.muzzle = addGun(L.gun, kind === "blackhawk" ? 1 : 0);
  if (L.gun2) addGun(L.gun2, -1);
  model.muzzles = guns.map((gg) => gg.muzzle);
  model.guns = guns;
  if (kind === "blackhawk") {
    // (The door guns rest pointing out of their doors.)
    guns[0].yawG.rotation.y = -Math.PI / 2;
    guns[1].yawG.rotation.y = Math.PI / 2;
  }
  let sensor = null;
  if (g.sensor) {
    sensor = new THREE.Group();
    sensor.position.set(...L.sensor);
    body.add(sensor);
    mesh(g.sensor, plain, sensor);
  }
  // yaw (relative to the nose; + left), pitch (+ up): the chin gun and the
  // sensor turret follow; a door gun only within its side's arc.
  model.setGun = (yaw, pitch, i = 0) => {
    const gg = guns[i];
    if (!gg) return;
    gg.yawG.rotation.y = yaw;
    gg.pitchG.rotation.x = pitch;
    if (sensor && i === 0) {
      sensor.rotation.y = yaw;
    }
  };
  // The muzzle flash.
  const fm = new THREE.SpriteMaterial({ map: flashTexture(), color: new THREE.Color(3, 2.4, 1.6), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, fog: true });
  mats.push(fm);
  const flashes = guns.map((gg) => {
    const sp = new THREE.Sprite(fm);
    sp.scale.setScalar(1.1);
    sp.layers.set(LAYER_FX);
    sp.visible = false;
    gg.muzzle.add(sp);
    return sp;
  });
  model.setFlash = (k, i = 0) => {
    const sp = flashes[i];
    if (!sp) return;
    sp.visible = k > 0;
    if (k > 0) {
      sp.scale.setScalar(0.7 + 0.9 * k);
      fm.rotation = Math.random() * 6.28;
    }
  };

  // ---- The stores: rockets' mouths, the Hellfires on their rails ----
  model.rocketMuzzles = (L.pods || []).map(([x, y, z]) => {
    const o = new THREE.Object3D();
    o.position.set(x, y, z - 0.9);
    body.add(o);
    return o;
  });
  model.missiles = [];
  if (L.rails) {
    const hg = heliMissileGeometry();
    for (const [x, y, z] of L.rails) {
      for (const [dx, dy] of [[-0.17, 0.0], [0.17, 0.0], [-0.17, -0.3], [0.17, -0.3]]) {
        const m = mesh(hg, plain, body);
        m.position.set(x + dx, y + dy + 0.07, z + 0.05);
        model.missiles.push(m);
      }
    }
    // (Fired from the outside in, left and right in turn.)
    model.missiles.sort((a, b) => Math.abs(b.position.x) - Math.abs(a.position.x) || a.position.y - b.position.y || a.position.x - b.position.x);
    const order = [];
    const left = model.missiles.filter((m) => m.position.x < 0);
    const right = model.missiles.filter((m) => m.position.x >= 0);
    for (let i = 0; i < Math.max(left.length, right.length); i++) {
      if (left[i]) order.push(left[i]);
      if (right[i]) order.push(right[i]);
    }
    model.missiles = order;
  }
  // missilesLeft: how many Hellfires are still on their rails (the first
  // ones of the firing order go first).
  model.setStores = (rocketShare, missilesLeft) => {
    const n = model.missiles.length;
    for (let i = 0; i < n; i++) model.missiles[i].visible = i >= n - missilesLeft;
  };

  // ---- Lights: navigation lights, the red beacon, the cockpit's glow ----
  const sprite = (color, x, y, z, size) => {
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture(), color, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, fog: false }));
    mats.push(sp.material);
    sp.layers.set(LAYER_FX);
    sp.position.set(x, y, z);
    sp.scale.setScalar(size);
    sp.visible = false;
    body.add(sp);
    return sp;
  };
  const wingX = kind === "apache" ? 2.96 : 1.3;
  const wingY = kind === "apache" ? 1.86 : 2.3;
  const wingZ = kind === "apache" ? 0.02 : -3.0;
  const nav = [sprite(new THREE.Color(2.4, 0.15, 0.15), -wingX, wingY, wingZ, 0.32), sprite(new THREE.Color(0.15, 2.4, 0.2), wingX, wingY, wingZ, 0.32), sprite(new THREE.Color(2.6, 2.6, 3), 0, T.y + 0.6, T.z + 0.4, 0.3)];
  const beacon = sprite(new THREE.Color(3, 0.25, 0.15), 0, kind === "apache" ? 2.98 : 3.3, kind === "apache" ? 2.6 : 2.8, 0.55);
  const cockpit = sprite(new THREE.Color(0.1, 0.35, 0.18), 0, L.seat[1] + 0.3, L.seat[2], 0.45);
  model.setLights = (t, night, on = true) => {
    const show = night > 0.3 && on;
    for (const s of nav) s.visible = show;
    cockpit.visible = show;
    // (The anti-collision beacon flashes day and night while the engine runs.)
    beacon.visible = on && Math.sin(t * 7.5) > 0.55;
    beacon.material.opacity = night > 0.3 ? 1 : 0.6;
  };

  // ---- Damage, night ----
  model.setBurnt = (on, t = 0) => {
    if (!on) {
      mat.uniforms.uFill.value = 0.35;
      light.flash.setRGB(0, 0, 0);
      return;
    }
    mat.uniforms.uFill.value = 0.02;
    plain.uniforms.uFill.value = 0.02;
    glassMat.color.setHex(0x050505);
    light.flash.setRGB(0.3 + 0.18 * Math.sin(t * 13), 0.09 + 0.06 * Math.sin(t * 19 + 1), 0.01);
  };
  model.setNight = (dark) => {
    mat.uniforms.uFill.value = 0.3 + 0.4 * dark;
    plain.uniforms.uFill.value = 0.25 + 0.35 * dark;
  };
  model.setRotor(0, 0, 0);
  model.dispose = () => {
    for (const m of mats) m.dispose();
    disc.geometry.dispose();
    tdisc.geometry.dispose();
  };
  return model;
}
