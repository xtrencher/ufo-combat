// Hit volumes that follow the aircraft (Round 10). Every type is a handful
// of convex pieces in model space (nose toward -Z, up +Y, right +X), each a
// set of planes n.p <= d: for the F-22 and the F-16 (jet-model.js's
// dimensions) the fuselage lofted from its cross sections, the cockpit, the
// intakes, each wing panel, the tailplanes, the fins and the tail; for the
// B-2 its twelve-edge planform (b2-shape.js) cut into spanwise strips and
// chord pieces, each as thick as the real section there. Shots, blasts,
// missile fuses and collisions all meet the same shape, so a shot that
// passes beside the nose or under a wing misses, and one that touches the
// wing tip hits. Plain numbers only (no three.js): Node tests use it as is.
//
// Queries, against a pose (pos { x, y, z }, q { x, y, z, w }), each after a
// cheap bounding-sphere test (no allocations: results in HIT and CONTACT):
//   hullRay(shape, pos, q, origin, dir, len, pad, vel, dt)
//       where (0..len, or -1) a segment first comes within `pad` of it;
//       with vel and dt, solved in its own frame of motion (it moved vel*dt
//       during the step), so a fast jet can't slip between two bolt steps;
//   hullDistance(shape, pos, q, p, max)
//       how far a point is from its surface (0 inside; at least `max` far
//       away is just reported as that much or more);
//   hullContact(shapeA, a, shapeB, b, dt)
//       whether two bodies ({ pos, q, vel }) touch during the frame (each
//       one's corners swept along the other's relative motion, then edges
//       crossing): the earliest contact, its normal (from a toward b), how
//       deep and whether it began this frame.
import { S as B2_S, A1, A2, A3, A4, leZ, teZ, b2Section, intakeHood } from "./b2-shape.js";

// ---------- Building ----------

// A convex piece: the points it spans and the outward directions of its
// faces; each plane is pushed out to the farthest point (so it always holds
// every point, even if the outline isn't quite convex). The last `caps`
// directions are the two ends (a plate's top and bottom, a loft's ends):
// the distance to a piece treats them apart from the sides.
function piece(pts, normals, caps, edges) {
  const n = [];
  const d = [];
  for (const nn of normals) {
    const l = Math.hypot(nn[0], nn[1], nn[2]);
    if (l < 1e-9) continue;
    const x = nn[0] / l;
    const y = nn[1] / l;
    const z = nn[2] / l;
    let m = -Infinity;
    for (const p of pts) m = Math.max(m, x * p[0] + y * p[1] + z * p[2]);
    n.push(x, y, z);
    d.push(m);
  }
  let cx = 0;
  let cy = 0;
  let cz = 0;
  for (const p of pts) {
    cx += p[0] / pts.length;
    cy += p[1] / pts.length;
    cz += p[2] / pts.length;
  }
  let r = 0;
  for (const p of pts) r = Math.max(r, Math.hypot(p[0] - cx, p[1] - cy, p[2] - cz));
  return { n: Float64Array.from(n), d: Float64Array.from(d), k: d.length, side: d.length - caps, pts, c: [cx, cy, cz], r, edges };
}

// A rigid transform (a turn about Z, then a move) for the fins.
function finMatrix(angle, tx, ty, tz) {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  return {
    p: (p) => [p[0] * c - p[1] * s + tx, p[0] * s + p[1] * c + ty, p[2] + tz],
    n: (n) => [n[0] * c - n[1] * s, n[0] * s + n[1] * c, n[2]],
  };
}

// A flat plate: an outline in X/Z ([[x, z], ...]) between heights y0 and y1,
// optionally turned and moved by M.
function plate(outline, y0, y1, M = null) {
  const m = outline.length;
  let cx = 0;
  let cz = 0;
  for (const [x, z] of outline) {
    cx += x / m;
    cz += z / m;
  }
  const pts = [];
  for (const [x, z] of outline) pts.push([x, y0, z], [x, y1, z]);
  const normals = [];
  const edges = [];
  const ym = (y0 + y1) / 2;
  const mid = [];
  for (let i = 0; i < m; i++) {
    const [ax, az] = outline[i];
    const [bx, bz] = outline[(i + 1) % m];
    let nx = bz - az;
    let nz = -(bx - ax);
    if (nx * ((ax + bx) / 2 - cx) + nz * ((az + bz) / 2 - cz) < 0) {
      nx = -nx;
      nz = -nz;
    }
    normals.push([nx, 0, nz]);
    mid.push([ax, ym, az]);
  }
  normals.push([0, -1, 0], [0, 1, 0]);
  for (let i = 0; i < m; i++) edges.push([mid[i], mid[(i + 1) % m]]);
  if (M) return piece(pts.map(M.p), normals.map(M.n), 2, edges.map(([a, b]) => [M.p(a), M.p(b)]));
  return piece(pts, normals, 2, edges);
}

function box(x0, x1, y0, y1, z0, z1) {
  return plate([[x0, z0], [x1, z0], [x1, z1], [x0, z1]], y0, y1);
}

// A stretch of a loft between two cross sections ({ z, pts: [[x, y], ...]},
// the same number of points, going round): its faces through the quads.
function loft(A, B) {
  const m = A.pts.length;
  const pts = [];
  for (const [x, y] of A.pts) pts.push([x, y, A.z]);
  for (const [x, y] of B.pts) pts.push([x, y, B.z]);
  let cx = 0;
  let cy = 0;
  let cz = 0;
  for (const p of pts) {
    cx += p[0] / pts.length;
    cy += p[1] / pts.length;
    cz += p[2] / pts.length;
  }
  const normals = [];
  const edges = [];
  for (let i = 0; i < m; i++) {
    const j = (i + 1) % m;
    const a0 = pts[i];
    const a1 = pts[j];
    const b0 = pts[m + i];
    const b1 = pts[m + j];
    // (the quad's normal from its diagonals, turned outward)
    const ux = b1[0] - a0[0], uy = b1[1] - a0[1], uz = b1[2] - a0[2];
    const vx = b0[0] - a1[0], vy = b0[1] - a1[1], vz = b0[2] - a1[2];
    let nx = uy * vz - uz * vy;
    let ny = uz * vx - ux * vz;
    let nz = ux * vy - uy * vx;
    const qx = (a0[0] + a1[0] + b0[0] + b1[0]) / 4 - cx;
    const qy = (a0[1] + a1[1] + b0[1] + b1[1]) / 4 - cy;
    const qz = (a0[2] + a1[2] + b0[2] + b1[2]) / 4 - cz;
    if (nx * qx + ny * qy + nz * qz < 0) {
      nx = -nx;
      ny = -ny;
      nz = -nz;
    }
    normals.push([nx, ny, nz]);
    edges.push([a0, b0]);
  }
  normals.push([0, 0, -1], [0, 0, 1]);
  return piece(pts, normals, 2, edges);
}

function loftAll(sections) {
  const out = [];
  for (let i = 0; i < sections.length - 1; i++) out.push(loft(sections[i], sections[i + 1]));
  return out;
}

// jet-model.js's fuselage cross section (w half width, top, bottom, chine height).
function section(z, w, top, bottom, chine = 0) {
  return { z, pts: [[0, top], [w * 0.55, top * 0.8], [w, chine], [w * 0.7, -bottom * 0.75], [0, -bottom], [-w * 0.7, -bottom * 0.75], [-w, chine], [-w * 0.55, top * 0.8]] };
}

// A bubble canopy (half an ellipsoid on y = base): sections along its length.
function canopy(cz, rx, ry, rz, base) {
  const out = [];
  for (const f of [-0.97, -0.6, 0, 0.6, 0.97]) {
    const k = Math.sqrt(1 - f * f);
    const w = Math.max(0.06, rx * k);
    const top = base + ry * k;
    out.push({ z: cz + f * rz, pts: [[0, top], [w * 0.7, base + (top - base) * 0.72], [w, base], [-w, base], [-w * 0.7, base + (top - base) * 0.72]] });
  }
  return out;
}

function buildF22() {
  const parts = loftAll([
    section(-7.75, 0.02, 0.02, 0.02),
    section(-6.6, 0.32, 0.26, 0.2),
    section(-5.2, 0.62, 0.48, 0.34, 0.05),
    section(-3.6, 0.95, 0.66, 0.44, 0.08),
    section(-1.8, 1.45, 0.72, 0.55, 0.06),
    section(0.8, 1.7, 0.66, 0.6, 0.04),
    section(3.6, 1.6, 0.56, 0.52, 0.02),
    section(5.6, 1.35, 0.42, 0.42, 0.0),
    section(6.6, 1.25, 0.36, 0.36, 0.0),
  ]);
  parts.push(...loftAll(canopy(-3.9, 0.52, 0.5, 1.9, 0.42)));
  // The nozzles and the beaver tail between them.
  parts.push(box(-1.15, 1.15, -0.36, 0.32, 6.3, 7.75));
  for (const s of [1, -1]) {
    // Caret intakes.
    parts.push(
      ...loftAll([
        { z: -2.6, pts: [[s * 1.1, 0.45], [s * 1.75, 0.2], [s * 1.75, -0.45], [s * 1.1, -0.5]] },
        { z: 0.6, pts: [[s * 1.35, 0.5], [s * 2.0, 0.3], [s * 2.0, -0.55], [s * 1.35, -0.6]] },
        { z: 2.4, pts: [[s * 1.3, 0.35], [s * 1.7, 0.2], [s * 1.7, -0.45], [s * 1.3, -0.5]] },
      ])
    );
    // The diamond wing (flaperon included), the tailplane and the canted fin with its rudder.
    parts.push(plate([[s * 1.4, -2.2], [s * 6.6, 1.6], [s * 6.6, 2.4], [s * 6.2, 2.509], [s * 2.0, 3.745], [s * 1.5, 3.9]], -0.26, 0.02));
    parts.push(plate([[s * 1.2, 4.7], [s * 4.3, 6.3], [s * 4.3, 6.95], [s * 1.2, 7.3]], -0.3, -0.1));
    parts.push(plate([[0, 3.4], [0, 6.2], [3.1, 6.8], [3.1, 5.4]], -0.1, 0.1, finMatrix(Math.PI / 2 - s * 0.49, s * 1.05, 0.35, 0)));
  }
  return parts;
}

function buildF16() {
  const parts = loftAll([
    section(-7.2, 0.02, 0.02, 0.02),
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
  parts.push(...loftAll(canopy(-3.65, 0.46, 0.55, 1.65, 0.5)));
  // The round nozzle.
  parts.push(box(-0.56, 0.56, -0.56, 0.56, 6.1, 7.3));
  // The chin intake.
  parts.push(
    ...loftAll([
      { z: -3.05, pts: [[0, -0.42], [0.5, -0.48], [0.6, -0.78], [0.46, -1.02], [0, -1.07], [-0.46, -1.02], [-0.6, -0.78], [-0.5, -0.48]] },
      { z: -1.2, pts: [[0, -0.45], [0.52, -0.5], [0.6, -0.78], [0.46, -1.0], [0, -1.04], [-0.46, -1.0], [-0.6, -0.78], [-0.52, -0.5]] },
      { z: 1.4, pts: [[0, -0.45], [0.42, -0.48], [0.46, -0.64], [0.34, -0.74], [0, -0.76], [-0.34, -0.74], [-0.46, -0.64], [-0.42, -0.48]] },
    ])
  );
  for (const s of [1, -1]) {
    // The leading-edge root extension, the cropped delta (flaperon included)
    // with the wingtip rail and its missile, the tailplane.
    parts.push(plate([[s * 0.5, -4.0], [s * 1.6, 0.3], [s * 0.6, 0.4]], -0.04, 0.12));
    parts.push(plate([[s * 0.75, -0.6], [s * 4.85, 2.3], [s * 4.85, 3.2], [s * 4.4, 3.22], [s * 1.0, 3.388], [s * 0.75, 3.4]], -0.2, 0.1));
    parts.push(box(s > 0 ? 4.8 : -5.08, s > 0 ? 5.08 : -4.8, -0.3, 0.0, 0.8, 3.7));
    parts.push(plate([[s * 0.62, 4.6], [s * 3.0, 5.95], [s * 3.0, 6.6], [s * 0.62, 6.65]], -0.2, -0.04));
  }
  // The tall fin with its rudder.
  parts.push(plate([[0, 2.5], [0, 6.1], [3.15, 6.35], [3.15, 5.25]], -0.1, 0.1, finMatrix(Math.PI / 2, 0, 0.55, 0)));
  return parts;
}

// The B-2: spanwise strips between stations through the trailing edge's
// corners (so each strip's leading and trailing edges are straight), cut
// along the chord into pieces, each as thick as the airframe within it.
function buildB2() {
  const xs = [];
  const breaks = [0, A4, A3, A2, A1, B2_S];
  for (let i = 0; i < breaks.length - 1; i++) {
    const n = Math.max(1, Math.ceil((breaks[i + 1] - breaks[i]) / 2.5));
    for (let k = 0; k < n; k++) xs.push(breaks[i] + ((breaks[i + 1] - breaks[i]) * k) / n);
  }
  xs.push(B2_S);
  const parts = [];
  const sec = { top: 0, bot: 0, deck: 0 };
  for (let i = 0; i < xs.length - 1; i++) {
    const xa = xs[i];
    const xb = xs[i + 1];
    const za0 = leZ(xa), za1 = teZ(xa), zb0 = leZ(xb), zb1 = teZ(xb);
    const us = xa < 4 ? [0, 0.12, 0.35, 0.65, 1] : [0, 0.25, 0.6, 1];
    for (let j = 0; j < us.length - 1; j++) {
      const u0 = us[j];
      const u1 = us[j + 1];
      let top = -Infinity;
      let bot = Infinity;
      for (let a = 0; a <= 3; a++) {
        const x = xa + ((xb - xa) * a) / 3;
        const z0 = leZ(x);
        const z1 = teZ(x);
        for (let b = 0; b <= 5; b++) {
          const u = u0 + ((u1 - u0) * b) / 5;
          const z = Math.min(z1 - 1e-4, Math.max(z0 + 1e-4, z0 + (z1 - z0) * u));
          const s = b2Section(Math.min(x, B2_S - 1e-4), z, sec);
          if (!s) continue;
          top = Math.max(top, s.top + intakeHood(x, z));
          bot = Math.min(bot, s.bot);
        }
      }
      if (!(top > bot)) continue;
      top += 0.08;
      bot -= 0.08;
      const zA0 = za0 + (za1 - za0) * u0, zA1 = za0 + (za1 - za0) * u1;
      const zB0 = zb0 + (zb1 - zb0) * u0, zB1 = zb0 + (zb1 - zb0) * u1;
      for (const s of [1, -1]) parts.push(plate([[s * xa, zA0], [s * xb, zB0], [s * xb, zB1], [s * xa, zA1]], bot, top));
    }
  }
  return parts;
}

// A shape: its pieces, its bounding radius about the origin, and (for
// collisions) its points and edges, flattened.
function shapeFrom(parts) {
  let r = 0;
  const pts = [];
  const seen = new Set();
  const edges = [];
  for (const p of parts) {
    for (const q of p.pts) {
      r = Math.max(r, Math.hypot(q[0], q[1], q[2]));
      const key = `${q[0].toFixed(3)},${q[1].toFixed(3)},${q[2].toFixed(3)}`;
      if (seen.has(key)) continue;
      seen.add(key);
      pts.push(q[0], q[1], q[2]);
    }
    for (const [a, b] of p.edges) edges.push(a[0], a[1], a[2], b[0], b[1], b[2]);
  }
  return { parts, r, pts: Float64Array.from(pts), edges: Float64Array.from(edges) };
}

const SHAPES = {};
const BUILD = { f22: buildF22, f16: buildF16, b2: buildB2 };

// The shape of an aircraft type ("f22", "f16", "b2"), built once; null for anything else.
export function hullShape(type) {
  if (!BUILD[type]) return null;
  return SHAPES[type] || (SHAPES[type] = shapeFrom(BUILD[type]()));
}

// A flying saucer for collisions only (its shots keep their own shape): a
// twelve-sided disc of radius r from y0 to y1.
export function discShape(r, y0, y1) {
  const key = `disc:${r.toFixed(2)}:${y0.toFixed(2)}:${y1.toFixed(2)}`;
  if (SHAPES[key]) return SHAPES[key];
  const outline = [];
  for (let i = 0; i < 12; i++) outline.push([Math.cos((i / 12) * Math.PI * 2) * r, Math.sin((i / 12) * Math.PI * 2) * r]);
  return (SHAPES[key] = shapeFrom([plate(outline, y0, y1)]));
}

// ---------- Queries ----------

// The vector (x, y, z) turned by the quaternion (qx, qy, qz, qw), into V.
const V = new Float64Array(3);
function rot(qx, qy, qz, qw, x, y, z) {
  const tx = 2 * (qy * z - qz * y);
  const ty = 2 * (qz * x - qx * z);
  const tz = 2 * (qx * y - qy * x);
  V[0] = x + qw * tx + (qy * tz - qz * ty);
  V[1] = y + qw * ty + (qz * tx - qx * tz);
  V[2] = z + qw * tz + (qx * ty - qy * tx);
}

// Where (0..1 along s, or -1) the segment o + t s first comes within `pad`
// of a piece (0 when it starts inside); the face it came in by in CLIP.
const CLIP = { plane: -1 };
function clip(part, ox, oy, oz, sx, sy, sz, pad) {
  let t0 = 0;
  let t1 = 1;
  let enter = -1;
  const n = part.n;
  const d = part.d;
  for (let i = 0, j = 0; i < part.k; i++, j += 3) {
    const den = n[j] * sx + n[j + 1] * sy + n[j + 2] * sz;
    const num = d[i] + pad - (n[j] * ox + n[j + 1] * oy + n[j + 2] * oz);
    if (den > -1e-12 && den < 1e-12) {
      if (num < 0) return -1;
      continue;
    }
    const t = num / den;
    if (den < 0) {
      if (t > t0) {
        t0 = t;
        enter = i;
      }
    } else if (t < t1) t1 = t;
    if (t0 > t1) return -1;
  }
  CLIP.plane = enter;
  return t0;
}

// The closest distance from point (px, py, pz) to the segment o + t s, t in 0..1, squared.
function segDist2(px, py, pz, ox, oy, oz, sx, sy, sz) {
  const ss = sx * sx + sy * sy + sz * sz;
  let t = ss > 1e-12 ? ((px - ox) * sx + (py - oy) * sy + (pz - oz) * sz) / ss : 0;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  const dx = ox + sx * t - px;
  const dy = oy + sy * t - py;
  const dz = oz + sz * t - pz;
  return dx * dx + dy * dy + dz * dz;
}

// The segment (local, o + t s) against every piece: the earliest t, or -1.
// HIT.part / HIT.plane tell which piece and face.
export const HIT = { nx: 0, ny: 0, nz: 0, part: null, plane: -1 };
function rayLocal(shape, ox, oy, oz, sx, sy, sz, pad) {
  let best = 2;
  for (const part of shape.parts) {
    const rr = part.r + pad;
    if (segDist2(part.c[0], part.c[1], part.c[2], ox, oy, oz, sx, sy, sz) > rr * rr) continue;
    const t = clip(part, ox, oy, oz, sx, sy, sz, pad);
    if (t >= 0 && t < best) {
      best = t;
      HIT.part = part;
      HIT.plane = CLIP.plane;
    }
  }
  return best <= 1 ? best : -1;
}

const Q0 = { x: 0, y: 0, z: 0, w: 1 };

export function hullRay(shape, pos, q, origin, dir, len, pad = 0, vel = null, dt = 0) {
  q = q || Q0;
  let ox = origin.x - pos.x;
  let oy = origin.y - pos.y;
  let oz = origin.z - pos.z;
  let sx = dir.x * len;
  let sy = dir.y * len;
  let sz = dir.z * len;
  if (vel && dt > 0) {
    // (Where the target was at the start of the step.)
    ox += vel.x * dt;
    oy += vel.y * dt;
    oz += vel.z * dt;
    sx -= vel.x * dt;
    sy -= vel.y * dt;
    sz -= vel.z * dt;
  }
  const R = shape.r + pad;
  if (segDist2(0, 0, 0, ox, oy, oz, sx, sy, sz) > R * R) return -1;
  rot(-q.x, -q.y, -q.z, q.w, ox, oy, oz);
  const lx = V[0], ly = V[1], lz = V[2];
  rot(-q.x, -q.y, -q.z, q.w, sx, sy, sz);
  const t = rayLocal(shape, lx, ly, lz, V[0], V[1], V[2], pad);
  if (t < 0) return -1;
  const part = HIT.part;
  const i = HIT.plane;
  if (i >= 0) {
    rot(q.x, q.y, q.z, q.w, part.n[i * 3], part.n[i * 3 + 1], part.n[i * 3 + 2]);
    HIT.nx = V[0];
    HIT.ny = V[1];
    HIT.nz = V[2];
  } else {
    // (Started inside: straight back along the segment.)
    const l = Math.hypot(dir.x, dir.y, dir.z) || 1;
    HIT.nx = -dir.x / l;
    HIT.ny = -dir.y / l;
    HIT.nz = -dir.z / l;
  }
  return t * len;
}

// The distance from a local point to one piece: past its side faces and its
// end faces taken apart (exact for a box's faces and edges along its
// length; a little short at the corners of an outline, never long).
function pieceDist(part, x, y, z) {
  const n = part.n;
  const d = part.d;
  let side = -Infinity;
  let cap = -Infinity;
  for (let i = 0, j = 0; i < part.k; i++, j += 3) {
    const e = n[j] * x + n[j + 1] * y + n[j + 2] * z - d[i];
    if (i < part.side) {
      if (e > side) side = e;
    } else if (e > cap) cap = e;
  }
  if (side <= 0 && cap <= 0) return 0;
  if (side <= 0) return cap;
  if (cap <= 0) return side;
  return Math.hypot(side, cap);
}

export function hullDistance(shape, pos, q, p, max = Infinity) {
  q = q || Q0;
  const dx = p.x - pos.x;
  const dy = p.y - pos.y;
  const dz = p.z - pos.z;
  const far = Math.hypot(dx, dy, dz) - shape.r;
  if (far >= max) return far;
  rot(-q.x, -q.y, -q.z, q.w, dx, dy, dz);
  const x = V[0], y = V[1], z = V[2];
  let best = Infinity;
  for (const part of shape.parts) {
    const c = part.c;
    const lower = Math.hypot(x - c[0], y - c[1], z - c[2]) - part.r;
    if (lower >= best) continue;
    const e = pieceDist(part, x, y, z);
    if (e < best) {
      best = e;
      if (best <= 0) return 0;
    }
  }
  return best;
}

// ---------- Contact ----------

export const CONTACT = { t: 0, nx: 0, ny: 0, nz: 0, depth: 0, entered: false };
let _best = 2;
let _bestEntered = false;
let _bestDepth = 0;
const _bn = new Float64Array(3);

// One body's points (g, shape G) swept against the other's pieces (h, shape
// H) along g's motion relative to h this frame (world rx, ry, rz). `sign`:
// +1 when h is the first body (its faces point toward the second), -1 when
// it is the second.
function sweepPoints(H, h, G, g, rx, ry, rz, sign) {
  const hq = h.q || Q0;
  const gq = g.q || Q0;
  rot(-hq.x, -hq.y, -hq.z, hq.w, rx, ry, rz);
  const sx = V[0], sy = V[1], sz = V[2];
  const sl = Math.hypot(sx, sy, sz);
  const reach = H.r + sl;
  const offx = g.pos.x - h.pos.x;
  const offy = g.pos.y - h.pos.y;
  const offz = g.pos.z - h.pos.z;
  const P = G.pts;
  for (let i = 0; i < P.length; i += 3) {
    rot(gq.x, gq.y, gq.z, gq.w, P[i], P[i + 1], P[i + 2]);
    rot(-hq.x, -hq.y, -hq.z, hq.w, V[0] + offx, V[1] + offy, V[2] + offz);
    const ex = V[0], ey = V[1], ez = V[2];
    if (ex * ex + ey * ey + ez * ez > reach * reach) continue;
    // (from where the point was at the start of the frame to where it is now)
    const t = rayLocal(H, ex - sx, ey - sy, ez - sz, sx, sy, sz, 0);
    if (t < 0 || t >= _best) continue;
    const part = HIT.part;
    let k = HIT.plane;
    const entered = k >= 0;
    if (!entered) {
      // Already inside at the start: out by the nearest face.
      let m = -Infinity;
      for (let j = 0; j < part.k; j++) {
        const e = part.n[j * 3] * (ex - sx) + part.n[j * 3 + 1] * (ey - sy) + part.n[j * 3 + 2] * (ez - sz) - part.d[j];
        if (e > m) {
          m = e;
          k = j;
        }
      }
    }
    const nx = part.n[k * 3], ny = part.n[k * 3 + 1], nz = part.n[k * 3 + 2];
    _best = t;
    _bestEntered = entered;
    _bestDepth = Math.max(0, part.d[k] - (nx * ex + ny * ey + nz * ez));
    rot(hq.x, hq.y, hq.z, hq.w, nx, ny, nz);
    _bn[0] = V[0] * sign;
    _bn[1] = V[1] * sign;
    _bn[2] = V[2] * sign;
  }
}

// One body's edges (at the end of the frame) crossing the other's pieces.
// Returns true if one does; whether it already did at the start of the frame
// decides `entered`.
function crossEdges(H, h, G, g, rx, ry, rz, sign) {
  const hq = h.q || Q0;
  const gq = g.q || Q0;
  rot(-hq.x, -hq.y, -hq.z, hq.w, rx, ry, rz);
  const sx = V[0], sy = V[1], sz = V[2];
  const offx = g.pos.x - h.pos.x;
  const offy = g.pos.y - h.pos.y;
  const offz = g.pos.z - h.pos.z;
  const E = G.edges;
  const R2 = H.r * H.r;
  for (let i = 0; i < E.length; i += 6) {
    rot(gq.x, gq.y, gq.z, gq.w, E[i], E[i + 1], E[i + 2]);
    rot(-hq.x, -hq.y, -hq.z, hq.w, V[0] + offx, V[1] + offy, V[2] + offz);
    const ax = V[0], ay = V[1], az = V[2];
    rot(gq.x, gq.y, gq.z, gq.w, E[i + 3], E[i + 4], E[i + 5]);
    rot(-hq.x, -hq.y, -hq.z, hq.w, V[0] + offx, V[1] + offy, V[2] + offz);
    const bx = V[0] - ax, by = V[1] - ay, bz = V[2] - az;
    if (segDist2(0, 0, 0, ax, ay, az, bx, by, bz) > R2) continue;
    const t = rayLocal(H, ax, ay, az, bx, by, bz, 0);
    if (t < 0) continue;
    const part = HIT.part;
    let k = HIT.plane;
    if (k < 0) k = part.side; // (the edge starts inside: by its end face)
    const nx = part.n[k * 3], ny = part.n[k * 3 + 1], nz = part.n[k * 3 + 2];
    const before = rayLocal(H, ax - sx, ay - sy, az - sz, bx, by, bz, 0) >= 0;
    _best = 1;
    _bestEntered = !before;
    _bestDepth = 0.15;
    rot(hq.x, hq.y, hq.z, hq.w, nx, ny, nz);
    _bn[0] = V[0] * sign;
    _bn[1] = V[1] * sign;
    _bn[2] = V[2] * sign;
    return true;
  }
  return false;
}

export function hullContact(A, a, B, b, dt) {
  const rx = (b.vel.x - a.vel.x) * dt;
  const ry = (b.vel.y - a.vel.y) * dt;
  const rz = (b.vel.z - a.vel.z) * dt;
  _best = 2;
  sweepPoints(A, a, B, b, rx, ry, rz, 1);
  sweepPoints(B, b, A, a, -rx, -ry, -rz, -1);
  if (_best > 1 && !crossEdges(A, a, B, b, rx, ry, rz, 1) && !crossEdges(B, b, A, a, -rx, -ry, -rz, -1)) return false;
  CONTACT.t = _best;
  CONTACT.nx = _bn[0];
  CONTACT.ny = _bn[1];
  CONTACT.nz = _bn[2];
  CONTACT.depth = Math.min(3, _bestDepth);
  CONTACT.entered = _bestEntered;
  return true;
}
