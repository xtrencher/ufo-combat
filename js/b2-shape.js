// The B-2 Spirit's shape (Round 10): the planform and the surfaces as plain
// functions of model-space x and z, shared by the model (b2-model.js) and
// anything that needs to know where the airframe is.
//
// Planform: the real twelve edges. Two straight leading edges swept 33
// degrees and ten trailing edge segments, each parallel to one of the two
// leading edges; per side from the cut wingtip inward: aft to the outer
// point, forward to the outer notch, aft to the inner point (behind the
// engines), forward to the inner notch, aft to the centre "beaver tail"
// point. With the real span (52.4 m), length (21.0 m) and sweep, the three
// aft points level and the notches midway between them, the outer point
// lands at 0.8 of the half span and the tip chord is short (0.5 m).
//
// Section: a blended body. A thin supercritical wing (flat-ish underside,
// sharp slightly drooped leading edge) thickening smoothly toward the middle;
// on it the deep centre body (the crew compartment at its front, the hump
// running back over the weapon bays), the engine nacelle shoulders either
// side, the intake hoods (separate pieces: see intakeHood) and the recessed
// exhaust troughs ahead of the inner trailing edges.
//
// Model space: nose toward -Z, up +Y, right +X; 44.5 blocks of span (the
// fighters' scale), 17.8 long.

export const B2_SPAN = 44.5;
export const B2_LENGTH = 17.8;
export const S = B2_SPAN / 2; // half span
export const NOSE_Z = -9.3;
export const TAIL_Z = NOSE_Z + B2_LENGTH;
export const K = Math.tan((33 * Math.PI) / 180);
export const TIP_LE_Z = NOSE_Z + S * K;
// The trailing edge's corners (half span): the outer point, the inner point
// and the notches midway between them.
export const A1 = 0.8 * S;
export const A3 = 0.345 * S;
export const A2 = (A1 + A3) / 2;
export const A4 = A3 / 2;
// From the tip inward: x, z.
export const TE = [
  [S, TAIL_Z - (S - A1) * K],
  [A1, TAIL_Z],
  [A2, TAIL_Z - (A1 - A2) * K],
  [A3, TAIL_Z],
  [A4, TAIL_Z - A4 * K],
  [0, TAIL_Z],
];
export const TIP_TE_Z = TE[0][1];
// The beaver tail (the gust load alleviation surface) hinges on a straight
// line across between the inner notches.
export const HINGE_Z = TE[4][1];
// The exhaust troughs: between these |x| (on the inner trailing edge segment,
// the inner notch to the inner point), from the nozzles DN ahead of the
// trailing edge back to it.
export const XT0 = 4.0;
export const XT1 = 7.4;
export const DN = 3.4;
const TROUGH_DEPTH = 0.24;
// The intakes: hoods between these |x|, their jagged lips at about LIP_Z.
export const XI0 = 2.2;
export const XI1 = 5.2;
export const LIP_Z = -4.3;
export const LIP_TEETH = 2;
const HOOD_H = 0.42;
const HOOD_LEN = 3.4;

export function leZ(ax) {
  return NOSE_Z + ax * K;
}
// The trailing edge's z at |x| = ax (piecewise linear).
export function teZ(ax) {
  for (let i = 0; i < TE.length - 1; i++) {
    const [x0, z0] = TE[i];
    const [x1, z1] = TE[i + 1];
    if (ax <= x0 && ax >= x1) return z0 + ((ax - x0) / (x1 - x0)) * (z1 - z0);
  }
  return TE[TE.length - 1][1];
}

// A smooth monotone curve through [x, y] points (piecewise cubic Hermite,
// Fritsch-Carlson slopes: no overshoot between the points).
function curve(pts) {
  const n = pts.length;
  const xs = pts.map((p) => p[0]);
  const ys = pts.map((p) => p[1]);
  const d = [];
  for (let i = 0; i < n - 1; i++) d.push((ys[i + 1] - ys[i]) / (xs[i + 1] - xs[i]));
  const m = [d[0]];
  for (let i = 1; i < n - 1; i++) {
    const h0 = xs[i] - xs[i - 1];
    const h1 = xs[i + 1] - xs[i];
    m.push(d[i - 1] * d[i] <= 0 ? 0 : (3 * (h0 + h1)) / ((2 * h1 + h0) / d[i - 1] + (h1 + 2 * h0) / d[i]));
  }
  m.push(d[n - 2]);
  return (x) => {
    if (x <= xs[0]) return ys[0];
    if (x >= xs[n - 1]) return ys[n - 1];
    let i = 0;
    while (x > xs[i + 1]) i++;
    const h = xs[i + 1] - xs[i];
    const t = (x - xs[i]) / h;
    const t2 = t * t;
    const t3 = t2 * t;
    return (2 * t3 - 3 * t2 + 1) * ys[i] + (t3 - 2 * t2 + t) * h * m[i] + (-2 * t3 + 3 * t2) * ys[i + 1] + (t3 - t2) * h * m[i + 1];
  };
}
function smoothstep(a, b, x) {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}
// A bump across its width: 1 in the middle, 0 (and flat) at |t| = 1.
function bump(t) {
  const q = 1 - t * t;
  return q <= 0 ? 0 : q ** 1.6;
}
function smin(a, b, k) {
  return -k * Math.log(Math.exp(-a / k) + Math.exp(-b / k));
}
// The airfoil's thickness shape along the chord (0 at the edges, 1 at its
// thickest, at fraction p): u^e1 (1-u)^e2; e1 < 1 rounds the nose, smaller is sharper.
function airfoil(e1, p) {
  const e2 = (e1 * (1 - p)) / p;
  const m = p ** e1 * (1 - p) ** e2;
  return (u) => (u <= 0 || u >= 1 ? 0 : (u ** e1 * (1 - u) ** e2) / m);
}
const FT = airfoil(0.6, 0.33); // upper surface: thickest a third back
const FB = airfoil(0.5, 0.45); // lower surface: flatter, further back
// The wing's own thickness along the span (smooth: the sawtooth trailing
// edge doesn't crease the surface), before the body and nacelles.
const THICK = curve([
  [0, 1.55],
  [4, 1.3],
  [8, 1.0],
  [12.7, 0.52],
  [17.8, 0.27],
  [S, 0.035],
]);
// The sharp leading edge sits a little below the chord line, most at the nose.
function droop(ax) {
  return -(0.04 + 0.17 * Math.exp(-((ax / 3) ** 2)));
}
// The centre line in side view: the upper surface (the beak of the nose,
// the windscreen, the hump over the bays, the long slope to the tail) and
// the lower (the nose curving up into the leading edge, the shallow belly).
const TOP_C = curve([
  [NOSE_Z, -0.21],
  [-8.9, 0.1],
  [-8.3, 0.46],
  [-7.5, 0.86],
  [-6.6, 1.2],
  [-5.6, 1.5],
  [-4.5, 1.72],
  [-3.0, 1.84],
  [-1.5, 1.84],
  [0.5, 1.7],
  [2.5, 1.42],
  [4.5, 1.02],
  [6.0, 0.66],
  [7.3, 0.32],
  [TAIL_Z, 0.06],
]);
const BOT_C = curve([
  [NOSE_Z, -0.21],
  [-8.8, -0.42],
  [-8.0, -0.6],
  [-6.8, -0.74],
  [-5.0, -0.84],
  [-2.5, -0.92],
  [1.0, -0.93],
  [3.5, -0.85],
  [5.5, -0.62],
  [7.2, -0.3],
  [TAIL_Z, -0.04],
]);
// The centre body's half width along z (the hump in front view), and the belly's.
const BODY_W = curve([
  [NOSE_Z, 2.0],
  [-7, 2.7],
  [-5, 3.5],
  [-3, 4.3],
  [0, 4.6],
  [4, 4.3],
  [TAIL_Z, 3.9],
]);
const BELLY_W = curve([
  [NOSE_Z, 2.6],
  [-6, 4.2],
  [-2, 5.6],
  [3, 5.6],
  [TAIL_Z, 4.6],
]);
// Never past the leading edge: the body fades out before it.
function leHalfWidth(z) {
  return (0.95 * (z - NOSE_Z)) / K;
}
function wingAt(ax, u, out) {
  const t = THICK(ax);
  const cam = droop(ax) * (1 - u) ** 3;
  out.top = cam + t * 0.62 * FT(u);
  out.bot = cam - t * 0.38 * FB(u);
  return out;
}
const _w0 = { top: 0, bot: 0 };
// The bumps that make the centre line what TOP_C / BOT_C say.
function centreBumps(z) {
  const c = TAIL_Z - NOSE_Z;
  wingAt(0, (z - NOSE_Z) / c, _w0);
  return { top: Math.max(0, TOP_C(z) - _w0.top), bot: Math.max(0, _w0.bot - BOT_C(z)) };
}
// (Tabulated along z: the section is evaluated thousands of times when the geometry is built.)
const BUMP_N = 400;
const BUMP_TOP = new Float32Array(BUMP_N + 1);
const BUMP_BOT = new Float32Array(BUMP_N + 1);
for (let i = 0; i <= BUMP_N; i++) {
  const b = centreBumps(NOSE_Z + (B2_LENGTH * i) / BUMP_N);
  BUMP_TOP[i] = b.top;
  BUMP_BOT[i] = b.bot;
}
function table(tab, z) {
  const f = Math.min(BUMP_N, Math.max(0, ((z - NOSE_Z) / B2_LENGTH) * BUMP_N));
  const i = Math.min(BUMP_N - 1, Math.floor(f));
  return tab[i] + (tab[i + 1] - tab[i]) * (f - i);
}
// The nacelle shoulders: over the ducts, which run from the intakes
// outward and back to the exhaust troughs.
function nacelle(ax, z) {
  const xn = 3.6 + 2.1 * smoothstep(-4.5, 3.5, z);
  const h = 0.36 * smoothstep(-5.2, -3.5, z) * (1 - 0.55 * smoothstep(-0.5, 4, z));
  return h * bump((ax - xn) / 1.8);
}

// The surfaces at (x, z): { top, bot, deck } (y; deck: 0-1, inside an
// exhaust trough), or null outside the planform. (`out` is reused if given.)
export function b2Section(x, z, out = { top: 0, bot: 0, deck: 0 }) {
  const ax = Math.abs(x);
  if (ax > S) return null;
  const z0 = leZ(ax);
  const z1 = teZ(ax);
  if (z < z0 - 1e-6 || z > z1 + 1e-6) return null;
  const c = Math.max(0.01, z1 - z0);
  const u = Math.min(1, Math.max(0, (z - z0) / c));
  wingAt(ax, u, out);
  // The body and nacelles fade out over the last stretch before the trailing edge.
  const dTE = z1 - z;
  const ramp = dTE >= 1.6 ? 1 : 1 - (1 - dTE / 1.6) ** 2;
  const hw = Math.max(0.05, smin(BODY_W(z), leHalfWidth(z), 0.4));
  const hb = Math.max(0.05, smin(BELLY_W(z), leHalfWidth(z), 0.4));
  out.top += (table(BUMP_TOP, z) * bump(ax / hw) + nacelle(ax, z)) * ramp;
  out.bot -= table(BUMP_BOT, z) * bump(ax / hb) * ramp;
  out.deck = 0;
  // The exhaust trough: recessed into the upper surface, deepest at the nozzles.
  if (ax > A4 && ax < A3 && dTE < DN) {
    const f = smoothstep(XT0, XT0 + 0.18, ax) * (1 - smoothstep(XT1 - 0.18, XT1, ax)) * (1 - smoothstep(DN - 0.06, DN, dTE));
    if (f > 0) {
      out.top = Math.max(out.bot + 0.04, out.top - f * TROUGH_DEPTH * (dTE / DN) ** 0.7);
      out.deck = f;
    }
  }
  return out;
}

// The intake hood's height over the surface at (x, z) (0 outside it): a
// raised scoop, rounded across, highest at the jagged lip,
// faired back into the nacelle.
export function lipZ(ax) {
  // Teeth pointing forward, their edges parallel to the leading edges.
  const q = ((ax - XI0) / (XI1 - XI0)) * LIP_TEETH * 2;
  const ph = q % 2;
  const tri = ph < 1 ? ph : 2 - ph;
  return LIP_Z - tri * ((XI1 - XI0) / (LIP_TEETH * 2)) * K;
}
export function intakeHood(x, z) {
  const ax = Math.abs(x);
  if (ax <= XI0 || ax >= XI1) return 0;
  const t = (z - lipZ(ax)) / HOOD_LEN;
  if (t < 0 || t > 1) return 0;
  const sp = ((ax - XI0) / (XI1 - XI0)) * 2 - 1;
  return HOOD_H * (1 - sp * sp) ** 0.7 * (1 - t) ** 2 * (1 + 2 * t);
}
export function intakeLipHeight(ax) {
  const sp = ((ax - XI0) / (XI1 - XI0)) * 2 - 1;
  return Math.abs(sp) >= 1 ? 0 : HOOD_H * (1 - sp * sp) ** 0.7;
}

// The outer skin's height at (x, z): the upper surface with the intake
// hoods, the lower surface: { top, bot } or null outside the planform.
const _s = { top: 0, bot: 0, deck: 0 };
export function b2Surface(x, z) {
  const s = b2Section(x, z, _s);
  if (!s) return null;
  return { top: s.top + intakeHood(x, z), bot: s.bot };
}

// Whether a model-space point is within the airframe (grown by `pad` blocks
// all round): for hit tests that follow the real shape rather than a sphere
// (the wing is thin, and most of a 44-block sphere around it is empty air).
export function b2Inside(x, y, z, pad = 0) {
  const ax = Math.abs(x);
  if (ax > S + pad) return false;
  const cx = Math.min(ax, S);
  const z0 = leZ(cx) - pad;
  const z1 = teZ(cx) + pad;
  if (z < z0 || z > z1) return false;
  const s = b2Section(cx, Math.min(teZ(cx), Math.max(leZ(cx), z)), _s);
  return !!s && y <= s.top + intakeHood(cx, z) + pad && y >= s.bot - pad;
}
