// The SR-71 Blackbird's shape (Round 16), as plain functions of the real
// aircraft's dimensions in metres (no three.js: hitboxes.js and Node tests
// use it as is). sr71-model.js lofts its skin from these; hitboxes.js cuts
// its hit volume from them.
//
// Metres: x to the right, y up (0 is the chine and wing plane), z back from
// the radome's tip (the pitot boom reaches 0.7 m ahead of it; the tail cone
// ends at 32.0: 32.7 m overall). The model is these times K, with its middle
// at z = Z0 (model space: nose toward -Z, up +Y, right +X), the same scale
// as the fighters (the F-22's 18.9 m is jet-model.js's 15.2 blocks).
//
//   - the forebody: a round core (an ogive nose, a long body, a tail cone)
//     blended into the chines, thin sharp ledges along its sides that grow
//     out (concave in plan) into the inboard wing;
//   - the delta wing: the inboard part between the body and the nacelles,
//     the outboard part beyond them, its leading edge swept 52 degrees and
//     drooped near the tip (the conical camber), both thin biconvex sections;
//   - the nacelles at mid-span: the inlet lip, the spike's cone ahead of it,
//     a chine along the outboard side, the ejector nozzle at the back;
//   - the two all-moving fins on the nacelles, canted 15 degrees inward.

export const K = 15.2 / 18.92; // blocks per metre (the F-22's scale)
export const Z0 = 17.4; // the model's middle (m from the nose)
export const SR71_LENGTH = 32.7 * K;
export const SR71_SPAN = 16.94 * K;

export const TAIL_Z = 32.0; // the tail cone's end
export const XN = 3.15; // the nacelles' axis: x ...
export const YN = 0.05; // ... and height
export const LIP_Z = 16.2; // the inlet lip
export const SPIKE_Z = 13.5; // the spike's tip
export const EXIT_Z = 31.0; // the ejector's exit
export const TIP_X = 16.94 / 2; // the wingtip
export const CHINE_Z = 16.6; // where the chine reaches the nacelle
export const TE_IN = 29.3; // the inboard trailing edge
export const OUT_ROOT = [XN + 1.18, 21.6]; // the outboard leading edge's root (x, z) beyond the nacelle chine
export const TIP_LE = 21.6 + (TIP_X - XN - 1.18) * Math.tan((52 * Math.PI) / 180); // the tip's leading edge (52 degrees)
export const TIP_TE = 28.9;
export const ROOT_TE = 30.0; // the outboard trailing edge at the nacelle
// The fins: root and tip chords (z) and height (m), on the nacelle's top.
export const FIN = { z0: 26.4, z1: 31.0, tz0: 28.75, tz1: 30.55, h: 2.15, cant: (15 * Math.PI) / 180, pivotZ: 28.9 };
// Gear (m): the nose leg's z; the main legs' x and z; the wheels' bottom below y = 0.
export const NOSE_GEAR_Z = 10.4;
export const MAIN_GEAR_X = 2.25;
export const MAIN_GEAR_Z = 21.9;
export const GROUND_Y = -2.7;
export const SR71_GEAR_HEIGHT = -GROUND_Y * K; // the centre's height over the wheels' bottom (blocks)

export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const smooth = (a, b, v) => {
  const t = clamp((v - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};
// A soft union of two non-negative heights (a fillet where they meet).
const P = 4;
export const union = (a, b) => (a <= 0 ? Math.max(0, b) : b <= 0 ? a : Math.pow(a ** P + b ** P, 1 / P));

// ---------- The body ----------

// The core's radius along the length: an ogive nose, the body, the tail cone.
export function coreR(z) {
  if (z <= 0) return 0;
  if (z < 9) return 0.8 * Math.pow(1 - (1 - z / 9) ** 2, 0.72);
  if (z < 24) return 0.8;
  if (z >= TAIL_Z) return 0;
  return 0.8 * Math.pow(1 - ((z - 24) / (TAIL_Z - 24)) ** 2, 0.55);
}
// The chines' own reach (concave in plan: slow at the nose, flaring into the wing).
function chineReach(z) {
  if (z <= 0.8) return 0;
  const t = (z - 0.8) / (CHINE_Z - 0.8);
  return 2.45 * (0.85 * t + 0.15 * t ** 3) + (z > CHINE_Z ? (XN - 2.45) * smooth(CHINE_Z, CHINE_Z + 1.6, z) : 0);
}
// The body's half width in plan: the core, then the chine edge, then (inside
// the nacelle) the nacelle's axis.
export function bodyEdge(z) {
  if (z >= CHINE_Z + 1.6) return XN;
  const a = coreR(z);
  const b = Math.min(XN, chineReach(z));
  return Math.pow(a ** 6 + b ** 6, 1 / 6);
}
// Where the body's edge reaches x (front) and where it ends at x (back).
const FRONT = [];
for (let i = 0; i <= 400; i++) FRONT.push(bodyEdge((i / 400) * (CHINE_Z + 1.6)));
export function zStart(x) {
  if (x <= 0) return 0;
  for (let i = 1; i <= 400; i++) {
    if (FRONT[i] >= x) {
      const f = (x - FRONT[i - 1]) / Math.max(1e-9, FRONT[i] - FRONT[i - 1]);
      return ((i - 1 + f) / 400) * (CHINE_Z + 1.6);
    }
  }
  return CHINE_Z + 1.6;
}
const R_TE = coreR(TE_IN);
export function zEnd(x) {
  if (x >= R_TE) return TE_IN;
  // (Behind the wing: where the tail cone's radius is x.)
  let lo = TE_IN;
  let hi = TAIL_Z;
  for (let i = 0; i < 30; i++) {
    const m = (lo + hi) / 2;
    if (coreR(m) > x) lo = m;
    else hi = m;
  }
  return (lo + hi) / 2;
}

// The canopies: the pilot's hump with its windscreen, the reconnaissance
// systems officer's lower one behind, and the fairing back along the spine.
function bump(z, z0, zp, z1) {
  if (z <= z0 || z >= z1) return 0;
  return z < zp ? Math.sqrt(smooth(z0, zp, z)) : smooth(z1, zp, z);
}
export function canopyH(x, z) {
  const w = 0.52;
  if (Math.abs(x) >= w) return 0;
  const across = Math.sqrt(1 - (x / w) ** 2);
  const along = Math.max(0.44 * bump(z, 5.3, 6.75, 9.0), 0.36 * bump(z, 8.4, 9.7, 11.2), 0.27 * bump(z, 9.5, 10.6, 15.5));
  return along * across;
}

// The core's top and bottom over the chine plane at (x, z) (0 off the core).
const KT = 0.98;
const KB = 0.7;
export function coreTop(x, z) {
  const r = coreR(z);
  return Math.abs(x) >= r ? 0 : KT * Math.sqrt(r * r - x * x);
}
export function coreBot(x, z) {
  const r = coreR(z);
  return Math.abs(x) >= r ? 0 : KB * Math.sqrt(r * r - x * x);
}
// The chine's and inboard wing's half thickness: a thin biconvex section
// from the edge (sharp) to the trailing edge (sharp).
export function innerWing(x, z) {
  const ax = Math.abs(x);
  const z0 = zStart(ax);
  const z1 = TE_IN;
  if (z <= z0 || z >= z1) return 0;
  const f = (z - z0) / (z1 - z0);
  const t = 0.24 - 0.06 * (ax / XN);
  return t * 4 * f * (1 - f) * (0.35 + 0.65 * Math.sqrt(f));
}
// The body's top and bottom surface heights at (x, z).
export function bodyTop(x, z) {
  return union(coreTop(x, z), innerWing(x, z)) + canopyH(x, z);
}
export function bodyBot(x, z) {
  return -union(coreBot(x, z), innerWing(x, z) * 0.8);
}

// ---------- The nacelles ----------

export function nacelleR(z) {
  if (z < LIP_Z) return 0;
  if (z < 19.8) return 0.7 + 0.16 * Math.sqrt(smooth(LIP_Z, 19.8, z));
  if (z < 28.6) return 0.86;
  return 0.86 - 0.06 * smooth(28.6, EXIT_Z, z);
}
// The spike's radius (its cone ahead of the lip; inside, it carries on).
export function spikeR(z) {
  if (z <= SPIKE_Z) return 0;
  const t = (z - SPIKE_Z) / (LIP_Z - SPIKE_Z);
  return Math.min(0.5, 0.46 * Math.pow(t, 0.92) + 0.06 * smooth(0.85, 1.25, t));
}

// ---------- The outboard wing ----------

// Its leading edge (z) at x: inside the nacelle, then the nacelle chine (a
// thin strake along the nacelle's outboard side), then swept 52 degrees.
export function outerLE(x) {
  const a = XN + 0.68;
  if (x <= a) return LIP_Z + 0.4;
  if (x <= OUT_ROOT[0]) return LIP_Z + 0.4 + ((x - a) / (OUT_ROOT[0] - a)) * (OUT_ROOT[1] - LIP_Z - 0.4);
  return OUT_ROOT[1] + ((x - OUT_ROOT[0]) / (TIP_X - OUT_ROOT[0])) * (TIP_LE - OUT_ROOT[1]);
}
export function outerTE(x) {
  return ROOT_TE + ((x - XN) / (TIP_X - XN)) * (TIP_TE - ROOT_TE);
}
// Its surface at (x, f: 0 the leading edge, 1 the trailing edge): the camber
// line (the conical camber: the leading edge droops toward the tip) and the
// half thickness.
export function outerWing(x, f) {
  const s = clamp((x - OUT_ROOT[0]) / (TIP_X - OUT_ROOT[0]), 0, 1);
  const camber = -0.2 * s ** 1.4 * (1 - f) ** 3.5 + 0.02 * (1 - s);
  const t = (0.15 - 0.11 * clamp((x - XN) / (TIP_X - XN), 0, 1)) * 4 * f * (1 - f) * (0.35 + 0.65 * Math.sqrt(f));
  return { camber, t, z: outerLE(x) + f * (outerTE(x) - outerLE(x)) };
}

// ---------- The fins ----------

// A point of the right fin (s = 1; s = -1 mirrors it): u up its span (0-1),
// v along its chord (0-1), w across (m, + outboard): its position in metres.
export function finPoint(u, v, w, s = 1) {
  const z0 = FIN.z0 + u * (FIN.tz0 - FIN.z0);
  const z1 = FIN.z1 + u * (FIN.tz1 - FIN.z1);
  const z = z0 + v * (z1 - z0);
  const h = u * FIN.h;
  const c = Math.cos(FIN.cant);
  const sn = Math.sin(FIN.cant);
  const baseY = YN + nacelleR(z) - 0.06;
  // (Canted inward: the top leans toward the fuselage.)
  return [s * (XN - h * sn + w * c), baseY + h * c + w * sn, z];
}
export function finThickness(u, v) {
  return (0.075 - 0.035 * u) * 4 * v * (1 - v) * (0.4 + 0.6 * Math.sqrt(v));
}

// The model-space point (blocks) of a point in metres.
export const toModel = (x, y, z) => [x * K, y * K, (z - Z0) * K];
