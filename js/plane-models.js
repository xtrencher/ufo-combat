// (Round 22) Six more aircraft, each built in metres from the real one's
// dimensions and scaled like the others (K: js/plane-kit.js), with its
// moving parts:
//   A-10C Thunderbolt II  16.26 m long, 17.53 m span: the straight wing, the
//     two TF34 pods high on the rear fuselage, twin fins on the tailplane's
//     tips, the GAU-8's seven barrels in the nose, gear pods under the wing
//     (the wheels stay half out folded), the split decelerons (the air
//     brakes), bombs, rocket pods, Mavericks and Sidewinders on the pylons;
//   F-35B Lightning II  15.6 x 10.7 m: the chined nose, the diverterless
//     intakes, the canted fins, the swivelling three-bearing nozzle, the
//     lift fan's big top door and the doors under it (STOVL: they open for
//     the hover);
//   Su-57  20.1 x 14.1 m: the flat lifting body between the widely spaced
//     nacelles, the moving leading-edge root extensions (LEVCONs), all-
//     moving fins, the vectoring nozzles (they deflect with the stick), the
//     sting between them, the splinter camouflage;
//   F-14D Tomcat  19.1 m, 19.55 m span (11.65 swept): the glove, the
//     swinging outer wings (20 to 68 degrees, 75 parked), the boxy intakes,
//     the pancake between the nacelles, the twin fins, two seats;
//   P-51D Mustang  9.83 x 11.28 m: the four-blade Hamilton Standard prop
//     (spinning), the Merlin's exhaust stacks, the bubble canopy, the belly
//     scoop, natural metal with invasion stripes, the tail-down sit on its
//     tailwheel (the tail comes up on the takeoff roll), bombs and HVARs;
//   AC-130J Ghostrider  29.8 x 40.4 m: the high wing, four turboprops with
//     six-blade scimitar props, the upswept tail, the gear sponsons, the
//     gunship's side guns (30 mm, 105 mm) and sensor balls, all on the left.
// createPlaneModel(type, { paint }) returns the same interface as
// jet-model.js (root, body, light, canopy, setThrottle, setControls,
// setGear, setLights, setBurnt, dispose) plus update(state, dt) for the
// moving parts (props, wing sweep, nozzles, doors, the tail-down sit).
import * as THREE from "three";
import { createEntityMaterial, bindEntityLight } from "./shaders.js";
import { LAYER_FX } from "./layers.js";
import { K, loftBody, lathe, latheAlong, panel, box, plate, rod, ball, wheel, mergeGeos, starOutline, discOutline, vnoise, hash2, flameTexture, softGlowTexture, propDiscTexture, glowSprite } from "./plane-kit.js";

// The other colour schemes an aircraft can come in (airports.js paintFor):
// the main colour and a darker one.
const SCHEMES = {
  green: [0x5d6b4a, 0x45503a],
  lightblue: [0x8eadc4, 0x6d8ba3],
  desert: [0xb39a74, 0x8f7a5a],
  navy: [0x4a5a72, 0x36435a],
  arctic: [0xc4cbd2, 0x9aa3ac],
};
const TYRE = 0x1b1b1c;
const STRUT = 0xb9bec4;
const BAY = 0xc9c9bf; // (gear bays and doors' insides: white-ish)
const DARK = 0x18191b;
const INTAKE = 0x101113;
const BURNT = 0x3a332d;
const RED = 0xa8231c;
const WHITE = 0xe2e2dc;
const BLUE = 0x23376e;
const BLACK = 0x121212;
const YELLOW = 0xd8b22a;
const HELMET = 0x6f7368;

const S = (x, y, z, chord, t = 0.08, extra = null) => ({ le: [x, y, z], chord, t, ...(extra || {}) });

function lerpSec(a, b, k) {
  return { le: [0, 1, 2].map((i) => a.le[i] + (b.le[i] - a.le[i]) * k), chord: a.chord + (b.chord - a.chord) * k, t: a.t + (b.t - a.t) * k, dir: a.dir, thick: a.thick };
}
// A section at span parameter u (0..1 over the sections' indices).
function secAt(secs, u) {
  const f = Math.max(0, Math.min(1, u)) * (secs.length - 1);
  const i = Math.min(secs.length - 2, Math.floor(f));
  return lerpSec(secs[i], secs[i + 1], f - i);
}

// A wing (or tail, or fin) through sections, with control surfaces cut out
// of it: cuts [{ a, b (span parameter 0..1), f (the hinge's chord fraction),
// kind, side }]. Returns { fixed: [geo], surfaces: [{ geo (round its
// pivot), pivot, axis (inboard to outboard, x >= 0 or up), kind, side }] }.
function lifting(secs, paint, cuts = [], opts = {}) {
  const breaks = new Set([0, 1]);
  for (const c of cuts) {
    breaks.add(c.a);
    breaks.add(c.b);
  }
  for (let i = 1; i < secs.length - 1; i++) breaks.add(i / (secs.length - 1));
  // (Paint edges along the span, at these distances from the middle: a ring
  // just either side of each, so a stripe's edge is sharp.)
  for (const xb of opts.xBreaks || []) {
    for (let i = 0; i < secs.length - 1; i++) {
      const x0 = Math.abs(secs[i].le[0]);
      const x1 = Math.abs(secs[i + 1].le[0]);
      for (const e of [-0.006, 0.006]) {
        const x = xb + e;
        if ((x - x0) * (x - x1) < 0) breaks.add((i + (x - x0) / (x1 - x0)) / (secs.length - 1));
      }
    }
  }
  const bs = [...breaks].sort((a, b) => a - b);
  const { xBreaks, ...popts } = opts;
  const fixed = [];
  const surfaces = [];
  for (let i = 0; i < bs.length - 1; i++) {
    const p = bs[i];
    const q = bs[i + 1];
    if (q - p < 1e-6) continue;
    const list = [secAt(secs, p), secAt(secs, q)];
    const cut = cuts.find((c) => c.a <= p + 1e-6 && c.b >= q - 1e-6);
    if (!cut) {
      fixed.push(panel(list, paint, popts));
      continue;
    }
    fixed.push(panel(list, paint, { ...popts, to: cut.f }));
    const geo = panel(list, cut.paint ?? paint, { ...popts, from: cut.f + (cut.gap ?? 0.004), roundLE: false });
    const hinge = (s) => {
      const d = new THREE.Vector3(...(s.dir || [0, 0, 1])).normalize();
      return new THREE.Vector3(...s.le).addScaledVector(d, s.chord * cut.f);
    };
    const h0 = hinge(list[0]);
    const h1 = hinge(list[1]);
    const axis = h1.clone().sub(h0).normalize();
    if (Math.abs(axis.x) >= Math.abs(axis.y) ? axis.x < 0 : axis.y < 0) axis.negate();
    geo.translate(-h0.x, -h0.y, -h0.z);
    surfaces.push({ geo, pivot: h0.toArray(), axis: axis.toArray(), kind: cut.kind, side: cut.side ?? 0 });
  }
  return { fixed, surfaces };
}

// A propeller: n blades of radius R round the Z axis (the disc at z = 0),
// twisted (pitch at the root `p0`, at the tip `p1`), chord c0 -> c1, a
// scimitar sweep, painted by `paint(r)`; `hand` the turning sense (+1:
// clockwise seen from behind).
function propeller(n, R, { c0 = 0.28, c1 = 0.16, p0 = 0.95, p1 = 0.32, root = 0.25, sweep = 0, paint = () => BLACK, hand = 1 } = {}) {
  const geos = [];
  for (let k = 0; k < n; k++) {
    const a = (k / n) * Math.PI * 2;
    const secs = [];
    const m = 5;
    for (let i = 0; i <= m; i++) {
      const f = i / m;
      const r = root + (R - root) * f;
      const sw = sweep * f * f;
      const span = new THREE.Vector3(Math.cos(a), Math.sin(a), 0);
      const tan = new THREE.Vector3(-Math.sin(a), Math.cos(a), 0).multiplyScalar(hand);
      const pitch = p0 + (p1 - p0) * f;
      const chord = (c0 + (c1 - c0) * f) * (f > 0.92 ? 0.75 : 1);
      // The chord runs from the leading edge (turning into the air, ahead in -z) back.
      const dir = tan.clone().multiplyScalar(-Math.cos(pitch)).addScaledVector(new THREE.Vector3(0, 0, 1), Math.sin(pitch)).normalize();
      const le = span.clone().multiplyScalar(r).addScaledVector(tan, chord * 0.45 * Math.cos(pitch) + sw).addScaledVector(new THREE.Vector3(0, 0, 1), -chord * 0.4 * Math.sin(pitch));
      const thick = new THREE.Vector3().crossVectors(dir, span).normalize();
      secs.push({ le: le.toArray(), chord, t: 0.07, dir: dir.toArray(), thick: thick.toArray() });
    }
    geos.push(panel(secs, (x, y) => paint(Math.hypot(x, y)), { steps: 5 }));
  }
  return mergeGeos(geos);
}

// A pilot (helmet, visor, shoulders) sitting at (x, y, z) (the head).
function pilot(x, y, z, suit = 0x55593f) {
  return [ball(x, y, z, 0.15, HELMET, 1.08), box(x, y - 0.03, z - 0.11, 0.2, 0.08, 0.06, 0x1d2228), box(x, y - 0.34, z + 0.06, 0.42, 0.34, 0.3, suit), box(x, y - 0.22, z + 0.32, 0.5, 0.75, 0.16, 0x2c2c2c)];
}

// The USAF star-and-bar (white star on a disc, bars), flat: on a side
// (face "x": outlines in (up, along), at x = at[0], `side` the way out) or
// on a top (face "y": (across, along)); `low`: the low-visibility greys.
function insignia(at, face, side) {
  const geos = [];
  const put = (outline, paint, lift) => {
    if (face === "x") geos.push(plate(outline.map(([a, b]) => [a + at[1], b + at[2]]), 0.012, paint, "yz", at[0] + side * lift));
    else geos.push(plate(outline.map(([a, b]) => [a + at[0], b + at[2]]), 0.012, paint, "xz", at[1] + lift));
  };
  // (A star's point: up on a side, forward on a top; (u, v) from starOutline.)
  const star = (r) => starOutline(r).map(([u, v]) => (face === "x" ? [v, u] : [u, -v]));
  return { put, star, geos };
}
function starAndBar(r, at, face = "x", low = false, side = 1) {
  const { put, star, geos } = insignia(at, face, side);
  const disc = low ? 0x4a4f55 : BLUE;
  const white = low ? 0x7c8288 : WHITE;
  put(discOutline(r, 0, 0, 20), disc, 0.01);
  put(star(r * 0.95), white, 0.02);
  const bw = r * 0.95;
  const bh = r * 0.42;
  // (A bar: across "up" bh, along the body from r*0.75 to r*0.75 + bw.)
  const bar = (s, h, a0, a1) => (face === "x" ? [[-h / 2, s * a0], [h / 2, s * a0], [h / 2, s * a1], [-h / 2, s * a1]] : [[s * a0, -h / 2], [s * a0, h / 2], [s * a1, h / 2], [s * a1, -h / 2]]);
  for (const s of [1, -1]) {
    put(bar(s, bh, r * 0.75, r * 0.75 + bw), white, 0.015);
    if (!low) put(bar(s, bh * 0.36, r * 0.8, r * 0.75 + bw - 0.05), RED, 0.02);
  }
  return geos;
}

// The Russian air force's red star (white and red edges), on a side or a top.
function redStar(r, at, face = "x", side = 1) {
  const { put, star, geos } = insignia(at, face, side);
  put(star(r), RED, 0.01);
  put(star(r * 0.86), WHITE, 0.018);
  put(star(r * 0.72), RED, 0.026);
  return geos;
}

// A store on a pylon: the pylon from the wing down to it, the store along Z.
function mk82(x, y, z) {
  // (A low-drag bomb: olive, a yellow nose band, conical fins.)
  return [box(x, y + 0.2, z, 0.08, 0.3, 1.2, 0x5d6268), latheAlong([[-1.1, 0.02], [-0.95, 0.13], [-0.6, 0.18], [0.5, 0.18], [0.9, 0.12], [1.1, 0.05]], (px, py, pz) => (pz < z - 0.78 && pz > z - 0.92 ? YELLOW : 0x4b5236), [x, y - 0.06, z], [0, 0, 1], { seg: 10 }), box(x, y - 0.06, z + 1.0, 0.5, 0.03, 0.3, 0x4b5236), box(x, y - 0.06, z + 1.0, 0.03, 0.5, 0.3, 0x4b5236)];
}
function rocketPod(x, y, z, len = 2.5, r = 0.22, col = 0x6b7074) {
  return [box(x, y + r + 0.1, z, 0.08, 0.25, 1.2, 0x5d6268), latheAlong([[-len / 2, r * 0.5], [-len / 2 + 0.25, r], [len / 2 - 0.1, r], [len / 2, r * 0.8]], (px, py, pz) => (pz < z - len / 2 + 0.03 ? DARK : col), [x, y, z], [0, 0, 1], { seg: 12 })];
}
function aim9(x, y, z, len = 2.85) {
  return [latheAlong([[-len / 2, 0.01], [-len / 2 + 0.2, 0.065], [len / 2, 0.065]], (px, py, pz) => (pz < z - len / 2 + 0.18 ? 0x3a3e40 : 0xdedfd9), [x, y, z], [0, 0, 1], { seg: 8 }), box(x, y, z - len / 2 + 0.5, 0.3, 0.02, 0.15, 0xbfc0bb), box(x, y, z - len / 2 + 0.5, 0.02, 0.3, 0.15, 0xbfc0bb), box(x, y, z + len / 2 - 0.2, 0.5, 0.02, 0.3, 0xbfc0bb), box(x, y, z + len / 2 - 0.2, 0.02, 0.5, 0.3, 0xbfc0bb)];
}
function maverick(x, y, z) {
  return [box(x, y + 0.3, z, 0.08, 0.3, 1.0, 0x5d6268), latheAlong([[-1.25, 0.05], [-1.15, 0.15], [-1.05, 0.15], [1.25, 0.15]], (px, py, pz) => (pz < z - 1.1 ? 0x2b2f33 : 0x8a8d7c), [x, y, z], [0, 0, 1], { seg: 10 }), box(x, y, z + 0.3, 0.75, 0.02, 0.9, 0x7c7f70), box(x, y, z + 0.3, 0.02, 0.75, 0.9, 0x7c7f70)];
}

// ---------- The aircraft ----------

// Each builder returns the parts in metres (see assemble).
const BUILD = {};

// The A-10C: two greys ("Compass Ghost"), the gun's dark nose, low-vis markings.
BUILD.a10 = (pal) => {
  const top = pal.main;
  const dark = pal.dark;
  const skin = (x, y, z) => (z < -7.55 ? DARK : y > 0.55 && z < -6.0 && z > -7.6 ? 0x3c4045 : vnoise(x * 0.5 + 3, z * 0.4) > 0.62 ? dark : top);
  const hull = [];
  const glass = [];
  // Fuselage.
  hull.push(
    loftBody(
      [
        { z: -7.95, w: 0.3, ht: 0.3, hb: 0.32, yc: -0.28, e: 2 },
        { z: -7.5, w: 0.62, ht: 0.62, hb: 0.55, yc: -0.12, e: 2.2 },
        { z: -6.4, w: 0.84, ht: 0.85, hb: 0.74, yc: 0, e: 2.5 },
        { z: -5.0, w: 0.9, ht: 1.02, hb: 0.82, yc: 0, e: 2.8 },
        { z: -3.4, w: 0.93, ht: 1.0, hb: 0.86, yc: 0, e: 3 },
        { z: -1.4, w: 0.9, ht: 0.92, hb: 0.9, yc: 0, e: 3.2 },
        { z: 1.0, w: 0.85, ht: 0.85, hb: 0.85, yc: 0.02, e: 3 },
        { z: 3.5, w: 0.62, ht: 0.68, hb: 0.6, yc: 0.15, e: 2.6 },
        { z: 6.0, w: 0.4, ht: 0.46, hb: 0.36, yc: 0.36, e: 2.3 },
        { z: 7.6, w: 0.2, ht: 0.25, hb: 0.2, yc: 0.5, e: 2 },
        { z: 8.05, w: 0.04, ht: 0.05, hb: 0.05, yc: 0.55, e: 2 },
      ],
      skin,
      { seg: 26 }
    )
  );
  // The GAU-8's barrels (seven in a ring) out of the nose, a little left of the middle.
  for (let k = 0; k < 7; k++) {
    const a = (k / 7) * Math.PI * 2;
    hull.push(rod([-0.08 + Math.cos(a) * 0.1, -0.3 + Math.sin(a) * 0.1, -7.7], [-0.08 + Math.cos(a) * 0.1, -0.3 + Math.sin(a) * 0.1, -8.45], 0.035, 0x2a2b2d, 6));
  }
  hull.push(latheAlong([[-0.25, 0.2], [0.1, 0.2]], 0x2b2c2e, [-0.08, -0.3, -7.85], [0, 0, 1], { seg: 12 }));
  // The canopy (a bubble on the high cockpit) and its frame; the pilot.
  glass.push(loftBody([{ z: -6.2, w: 0.12, ht: 0.1, hb: 0.12, yc: 0.82 }, { z: -5.6, w: 0.48, ht: 0.42, hb: 0.15, yc: 0.86 }, { z: -4.6, w: 0.55, ht: 0.62, hb: 0.15, yc: 0.88 }, { z: -3.7, w: 0.5, ht: 0.5, hb: 0.15, yc: 0.86 }, { z: -3.2, w: 0.3, ht: 0.18, hb: 0.15, yc: 0.86 }], 0xffffff, { seg: 18, per: 3 }));
  hull.push(box(0, 1.35, -5.55, 0.9, 0.06, 0.06, 0x2f3236), ...pilot(0, 1.12, -4.7));
  // The wing: a flat centre section, then the outer panels with dihedral and drooped tips.
  const wingSecs = [S(0.9, -0.5, -1.4, 3.05, 0.16), S(3.6, -0.5, -1.32, 2.85, 0.15), S(8.45, 0.06, -1.0, 1.62, 0.12), S(8.78, -0.02, -0.92, 1.4, 0.1)];
  for (const sd of [1, -1]) {
    const secs = wingSecs.map((s) => ({ ...s, le: [s.le[0] * sd, s.le[1], s.le[2]] }));
    const w = lifting(secs, (x, y, z) => skin(x, y, z), [
      { a: 0.0, b: 0.333, f: 0.76, kind: "flap", side: sd },
      { a: 0.43, b: 0.64, f: 0.74, kind: "split", side: sd },
    ]);
    hull.push(...w.fixed);
    W.surf.push(...w.surfaces);
    // (The deceleron's lower half: a second surface under the first, so the pair can split open.)
    const half = w.surfaces.find((s) => s.kind === "split");
    if (half) {
      const whole = half.geo;
      half.geo = whole.clone().scale(1, 0.5, 1).translate(0, 0.034, 0);
      W.surf.push({ ...half, geo: whole.clone().scale(1, 0.5, 1).translate(0, -0.034, 0), kind: "splitlow" });
    }
    // The main gear pods.
    hull.push(loftBody([{ z: -2.9, w: 0.08, ht: 0.06, hb: 0.08, yc: -0.62, cx: sd * 2.62 }, { z: -2.4, w: 0.38, ht: 0.25, hb: 0.42, yc: -0.62, cx: sd * 2.62 }, { z: -1.0, w: 0.45, ht: 0.25, hb: 0.55, yc: -0.62, cx: sd * 2.62 }, { z: 0.6, w: 0.35, ht: 0.2, hb: 0.3, yc: -0.55, cx: sd * 2.62 }, { z: 1.2, w: 0.08, ht: 0.06, hb: 0.06, yc: -0.5, cx: sd * 2.62 }], skin, { seg: 14 }));
    // The engine pods on their pylons, the fan face, the exhaust.
    hull.push(lathe([[0.25, 0.5], [0.4, 0.63], [0.9, 0.68], [2.5, 0.66], [3.6, 0.57], [4.4, 0.44], [4.6, 0.41]], (x, y, z) => (z < 0.3 ? INTAKE : z > 4.5 ? BURNT : skin(x, y, z)), { cx: sd * 1.62, cy: 1.28, seg: 20 }));
    hull.push(latheAlong([[0, 0.02], [0.25, 0.16], [0.3, 0.18]], 0x55595e, [sd * 1.62, 1.28, 0.28], [0, 0, 1], { seg: 10 }));
    hull.push(panel([S(sd * 0.5, 0.72, 1.2, 2.8, 0.12), S(sd * 1.25, 0.95, 1.4, 2.4, 0.12)], skin));
    // The tailplane, its elevators; the fin and rudder on its tip.
    const tail = lifting([S(0, 0.55, 6.05, 1.98, 0.09), S(sd * 2.95, 0.55, 6.15, 1.8, 0.08)], skin, [{ a: 0.05, b: 0.92, f: 0.68, kind: "elev", side: sd }]);
    hull.push(...tail.fixed);
    W.surf.push(...tail.surfaces);
    const fin = lifting([S(sd * 2.95, -0.62, 6.0, 1.9, 0.08), S(sd * 2.95, 0.55, 5.95, 2.0, 0.08), S(sd * 2.95, 2.05, 6.0, 1.95, 0.08), S(sd * 2.95, 2.4, 6.25, 1.5, 0.07), S(sd * 2.95, 2.52, 6.55, 0.95, 0.06)], skin, [{ a: 0.28, b: 0.8, f: 0.66, kind: "rud", side: sd }]);
    hull.push(...fin.fixed);
    W.surf.push(...fin.surfaces);
    // Stores: Mk-82s, a rocket pod, a Maverick, a pair of Sidewinders (the right) and an ECM pod (the left).
    hull.push(...mk82(sd * 3.95, -1.0, -0.6), ...mk82(sd * 4.95, -0.92, -0.55), ...rocketPod(sd * 5.95, -0.75, -0.5), ...maverick(sd * 6.95, -0.62, -0.45));
    if (sd > 0) hull.push(box(7.85, -0.18, -0.4, 0.08, 0.22, 1.0, 0x5d6268), ...aim9(7.75, -0.42, -0.3), ...aim9(7.95, -0.42, -0.3));
    else hull.push(...rocketPod(-7.85, -0.45, -0.35, 2.6, 0.16, 0x7a7e72));
    // Low-vis star-and-bar on the nacelle's outer side, the tail code band.
    hull.push(...starAndBar(0.28, [sd * 0.72, 0.1, 2.75], "x", true, sd));
  }
  // Wingtip and tail lights; the antennae.
  hull.push(box(0, 1.0, 1.5, 0.04, 0.35, 0.3, 0x2b2d30), box(0, -0.92, -2.5, 0.04, 0.3, 0.25, 0x2b2d30));
  // The gear: the nose leg (offset right), the mains out of the pods.
  const gear = [
    gearUnit({ at: [0.34, -0.7, -5.0], len: 0.95, r: 0.3, w: 0.2, axis: [1, 0, 0], ret: 1.7, wheels: [0], door: true }),
    ...[1, -1].map((sd) => gearUnit({ at: [sd * 2.62, -0.95, 0.3], len: 0.7, r: 0.42, w: 0.3, axis: [1, 0, 0], ret: 1.55, wheels: [0], fork: 0.1 })),
  ];
  return {
    hull,
    glass,
    surf: W.flush(),
    gear,
    finish: { spec: 0.35, gloss: 22, env: 0.12, grain: 0.03, panel: 0.28, panelScale: 1.1, livery: 0.08, liveryScale: 0.25, skin: { tone: 0.08, soot: 0.5, sootZ: 4.5, streaks: 0.1 } },
    nozzles: [],
    fans: [1, -1].map((sd) => ({ at: [sd * 1.62, 1.28, 4.55], r: 0.38 })),
    lights: { left: [-8.75, -0.05, -0.2], right: [8.75, -0.05, -0.2], strobes: [[2.95, 2.55, 7.2], [-2.95, 2.55, 7.2]] },
    pilot: [0, 1.12, -4.7],
    groundY: -2.06,
    length: 16.26,
    span: 17.53,
  };
};

// A gear leg (the strut and its wheels, a door), round its pivot at the top:
// { geo, pivot, axis, ret (radians folded), lift? }.
function gearUnit({ at, len, r, w, axis, ret, wheels = [0], fork = 0, door = false, lift = null, twin = 0, tandem = 0 }) {
  const geos = [rod([0, 0, 0], [0, -len, fork], Math.max(0.05, r * 0.2), STRUT, 8)];
  const ys = -len;
  for (const dx of wheels) {
    for (const t of tandem ? [-tandem / 2, tandem / 2] : [0]) {
      for (const tw of twin ? [-twin / 2, twin / 2] : [0]) {
        geos.push(wheel(r, w).translate(dx + tw, ys, fork + t));
      }
    }
  }
  if (twin || tandem) geos.push(rod([-(twin || 0) / 2 - 0.05, ys, fork], [(twin || 0) / 2 + 0.05, ys, fork], 0.05, STRUT, 6));
  if (door) geos.push(box(r * 0.6 + 0.06, -len * 0.45, fork * 0.5, 0.03, len * 0.8, Math.max(0.5, r * 2), BAY));
  return { geo: mergeGeos(geos), pivot: at, axis, ret, lift };
}

// A small collector the builders push their control surfaces into.
const W = {
  surf: [],
  flush() {
    const s = this.surf;
    this.surf = [];
    return s;
  },
};

// The F-35B: the radar-absorbent grey, a darker edge, low-vis markings.
BUILD.f35 = (pal) => {
  const g0 = pal.main;
  const g1 = pal.dark;
  const skin = (x, y, z) => (hash2(Math.floor(x * 1.2), Math.floor(z * 0.9)) > 0.86 ? g1 : g0);
  const hull = [];
  const glass = [];
  hull.push(
    loftBody(
      [
        { z: -7.8, w: 0.03, ht: 0.03, hb: 0.03, yc: -0.1, e: 2 },
        { z: -7.0, w: 0.36, ht: 0.32, hb: 0.3, yc: -0.1, e: 2.6 },
        { z: -6.0, w: 0.68, ht: 0.55, hb: 0.48, yc: -0.05, e: 2.9 },
        { z: -5.0, w: 0.88, ht: 0.7, hb: 0.6, yc: 0, e: 3.1 },
        { z: -3.8, w: 1.12, ht: 0.8, hb: 0.68, yc: 0, e: 3.3 },
        { z: -2.6, w: 1.5, ht: 0.85, hb: 0.75, yc: 0, e: 3.7 },
        { z: -1.0, w: 1.74, ht: 0.9, hb: 0.84, yc: 0, e: 3.9 },
        { z: 1.0, w: 1.74, ht: 0.8, hb: 0.8, yc: 0, e: 3.9 },
        { z: 3.0, w: 1.55, ht: 0.68, hb: 0.72, yc: 0, e: 3.5 },
        { z: 4.8, w: 1.2, ht: 0.55, hb: 0.6, yc: 0, e: 3 },
        { z: 6.0, w: 0.8, ht: 0.5, hb: 0.52, yc: 0, e: 2.4 },
        { z: 6.55, w: 0.64, ht: 0.5, hb: 0.5, yc: 0, e: 2.1 },
      ],
      skin,
      { seg: 28 }
    )
  );
  // The diverterless intakes (a bump, a dark mouth), each side behind the cockpit.
  for (const sd of [1, -1]) {
    hull.push(loftBody([{ z: -3.3, w: 0.28, ht: 0.36, hb: 0.36, yc: 0.02, cx: sd * 1.12, e: 3 }, { z: -2.4, w: 0.38, ht: 0.44, hb: 0.42, yc: 0.02, cx: sd * 1.3, e: 3 }, { z: -0.8, w: 0.36, ht: 0.42, hb: 0.42, yc: 0.02, cx: sd * 1.42, e: 3 }], (x, y, z) => (z < -3.25 ? INTAKE : skin(x, y, z)), { seg: 14 }));
    hull.push(ball(sd * 0.95, 0.05, -3.15, 0.2, g0, 0.9)); // (the DSI bump)
  }
  // The canopy: one frameless bubble with the gold-tinted coating; the pilot.
  glass.push(loftBody([{ z: -5.35, w: 0.1, ht: 0.06, hb: 0.08, yc: 0.6 }, { z: -4.7, w: 0.42, ht: 0.36, hb: 0.12, yc: 0.62 }, { z: -3.8, w: 0.5, ht: 0.5, hb: 0.12, yc: 0.66 }, { z: -2.8, w: 0.42, ht: 0.36, hb: 0.12, yc: 0.7 }, { z: -2.3, w: 0.15, ht: 0.08, hb: 0.1, yc: 0.72 }], 0xffffff, { seg: 18 }));
  hull.push(...pilot(0, 0.95, -3.9));
  // The wings, the all-moving tails, the canted fins.
  for (const sd of [1, -1]) {
    const w = lifting([S(sd * 1.55, 0.0, -1.25, 4.95, 0.05), S(sd * 3.2, 0.02, -0.15, 3.3, 0.05), S(sd * 5.35, 0.05, 1.25, 1.35, 0.045)], skin, [{ a: 0.12, b: 0.88, f: 0.78, kind: "ail", side: sd }]);
    hull.push(...w.fixed);
    W.surf.push(...w.surfaces);
    // (The whole tailplane turns: its pivot at the root's 40%.)
    const tp = panel([S(sd * 1.1, 0.0, 4.4, 3.0, 0.045), S(sd * 3.4, 0.02, 5.85, 1.5, 0.04)], skin);
    tp.translate(-sd * 1.1, 0, -5.6);
    W.surf.push({ geo: tp, pivot: [sd * 1.1, 0, 5.6], axis: [1, 0, 0], kind: "stab", side: sd });
    const cant = 0.44;
    const fh = 2.3;
    const fin = lifting([S(sd * 1.15, 0.55, 3.55, 3.05, 0.05), S(sd * (1.15 + Math.sin(cant) * fh), 0.55 + Math.cos(cant) * fh, 5.25, 1.25, 0.045)], skin, [{ a: 0.05, b: 0.7, f: 0.72, kind: "rud", side: sd }]);
    hull.push(...fin.fixed);
    W.surf.push(...fin.surfaces);
    hull.push(...starAndBar(0.26, [sd * 3.6, 0.07, 1.6], "y", true));
  }
  // The lift fan's top door (hinged at its back, opens up for the hover),
  // the auxiliary inlet doors behind it, the fan doors under the belly,
  // the roll posts' doors under the wings.
  const fanDoor = plate([[-0.55, -2.35], [0.55, -2.35], [0.62, -0.45], [-0.62, -0.45]], 0.06, (x, y, z) => (y < 0.86 ? BAY : g0), "xz", 0.87);
  fanDoor.translate(0, -0.87, 0.45);
  const auxL = plate([[-0.42, -0.4], [-0.05, -0.4], [-0.05, 0.6], [-0.42, 0.6]], 0.04, g0, "xz", 0.86);
  auxL.translate(0.05, -0.86, -0.6);
  const auxR = plate([[0.05, -0.4], [0.42, -0.4], [0.42, 0.6], [0.05, 0.6]], 0.04, g0, "xz", 0.86);
  auxR.translate(-0.05, -0.86, -0.6);
  const belly = [1, -1].map((sd) => {
    const d = plate([[0, -2.2], [sd * 0.55, -2.2], [sd * 0.55, -0.6], [0, -0.6]], 0.04, (x, y, z) => (y > -0.8 ? BAY : g0), "xz", -0.8);
    d.translate(-sd * 0.58, 0.8, 0);
    return { geo: d, pivot: [sd * 0.58, -0.8, 0], axis: [0, 0, sd], kind: "bellydoor" };
  });
  // The three-bearing swivel nozzle: its own group, turning down for the hover.
  const nozzle = lathe([[0, 0.6], [0.5, 0.6], [1.1, 0.55], [1.15, 0.5]], (x, y, z) => (z > 1.1 ? BURNT : 0x4e5257), { cx: 0, cy: 0, seg: 20, capEnd: true });
  const nozzleIn = lathe([[1.05, 0.48], [1.12, 0.46]], BURNT, { seg: 16 });
  // The gear.
  const gear = [gearUnit({ at: [0, -0.41, -5.2], len: 1.05, r: 0.28, w: 0.18, axis: [1, 0, 0], ret: 1.65, door: true }), ...[1, -1].map((sd) => gearUnit({ at: [sd * 1.55, -0.54, 0.9], len: 0.84, r: 0.36, w: 0.26, axis: [0, 0, -sd], ret: 1.5 }))];
  return {
    hull,
    glass,
    glassTint: 0xc8a850,
    surf: [...W.flush(), ...belly],
    gear,
    finish: { spec: 0.3, gloss: 18, env: 0.1, grain: 0.03, panel: 0.22, panelScale: 1.0, livery: 0.12, liveryScale: 0.35, skin: { tone: 0.1, soot: 0.3, sootZ: 5.5, streaks: 0.05 } },
    nozzles: [{ at: [0, 0, 7.6], r: 0.5, group: "nozzle" }],
    groups: {
      nozzle: { geo: mergeGeos([nozzle, nozzleIn]), pivot: [0, 0, 6.5] },
      fanDoor: { geo: fanDoor, pivot: [0, 0.87, -0.45] },
      auxL: { geo: auxL, pivot: [-0.05, 0.86, 0.6] },
      auxR: { geo: auxR, pivot: [0.05, 0.86, 0.6] },
    },
    lights: { left: [-5.35, 0.08, 1.9], right: [5.35, 0.08, 1.9], strobes: [[2.12, 2.6, 5.9], [-2.12, 2.6, 5.9]] },
    pilot: [0, 0.95, -3.9],
    groundY: -1.74,
    length: 15.6,
    span: 10.7,
  };
};

// The Su-57: splinter camouflage of light and blue-greys, a lighter belly, red stars.
BUILD.su57 = (pal) => {
  const c0 = pal.light ?? 0xa9b5be;
  const c1 = pal.main;
  const c2 = pal.dark;
  const camo = (x, y, z) => {
    if (y < -0.35) return 0xb9c3ca;
    const n = vnoise(Math.round(x * 2.2) * 0.17 + 7, Math.round(z * 2.2) * 0.17);
    return n < 0.44 ? c2 : n < 0.62 ? c1 : c0;
  };
  const hull = [];
  const glass = [];
  hull.push(
    loftBody(
      [
        { z: -10.0, w: 0.03, ht: 0.03, hb: 0.03, yc: 0.1, e: 2 },
        { z: -9.0, w: 0.4, ht: 0.34, hb: 0.32, yc: 0.1, e: 2.7 },
        { z: -7.8, w: 0.64, ht: 0.55, hb: 0.47, yc: 0.12, e: 2.9 },
        { z: -6.4, w: 0.78, ht: 0.8, hb: 0.52, yc: 0.1, e: 3.1 },
        { z: -5.0, w: 0.88, ht: 0.85, hb: 0.52, yc: 0.08, e: 3.4 },
        { z: -3.6, w: 1.45, ht: 0.72, hb: 0.42, yc: 0.06, e: 4.2 },
        { z: -2.0, w: 2.15, ht: 0.58, hb: 0.33, yc: 0.05, e: 5 },
        { z: 0.0, w: 2.35, ht: 0.52, hb: 0.3, yc: 0.05, e: 5 },
        { z: 2.5, w: 2.25, ht: 0.46, hb: 0.3, yc: 0.05, e: 5 },
        { z: 4.6, w: 1.75, ht: 0.4, hb: 0.26, yc: 0.05, e: 4 },
        { z: 6.6, w: 0.85, ht: 0.34, hb: 0.25, yc: 0.08, e: 3 },
        { z: 8.6, w: 0.42, ht: 0.28, hb: 0.24, yc: 0.1, e: 2.4 },
        { z: 9.9, w: 0.12, ht: 0.1, hb: 0.1, yc: 0.1, e: 2 },
      ],
      camo,
      { seg: 28 }
    )
  );
  hull.push(rod([0, 0.1, -10.0], [0, 0.1, -10.55], 0.02, 0x8d9296, 4));
  for (const sd of [1, -1]) {
    // The nacelles under the body, the trapezoid intakes under the LEVCONs.
    hull.push(
      loftBody(
        [
          { z: -3.7, w: 0.5, ht: 0.42, hb: 0.5, yc: -0.52, cx: sd * 1.62, e: 3.5 },
          { z: -1.0, w: 0.6, ht: 0.5, hb: 0.56, yc: -0.52, cx: sd * 1.6, e: 3 },
          { z: 3.0, w: 0.64, ht: 0.55, hb: 0.56, yc: -0.45, cx: sd * 1.55, e: 2.4 },
          { z: 6.0, w: 0.6, ht: 0.56, hb: 0.56, yc: -0.4, cx: sd * 1.5, e: 2.1 },
          { z: 6.55, w: 0.56, ht: 0.54, hb: 0.54, yc: -0.4, cx: sd * 1.5, e: 2 },
        ],
        (x, y, z) => (z < -3.65 ? INTAKE : camo(x, y, z)),
        { seg: 18 }
      )
    );
    // The wing, the LEVCON ahead of it, the stabilators, the small all-moving fins.
    const w = lifting([S(sd * 2.2, 0.1, -2.25, 6.0, 0.045), S(sd * 4.6, 0.12, 0.45, 3.65, 0.04), S(sd * 7.05, 0.14, 3.05, 1.55, 0.035)], camo, [
      { a: 0.04, b: 0.5, f: 0.8, kind: "flap", side: sd },
      { a: 0.52, b: 0.94, f: 0.76, kind: "ail", side: sd },
    ]);
    hull.push(...w.fixed);
    W.surf.push(...w.surfaces);
    const lev = panel([S(sd * 0.85, 0.12, -6.1, 3.85, 0.03), S(sd * 2.25, 0.1, -2.6, 0.5, 0.03)], camo);
    lev.translate(-sd * 0.85, -0.12, 2.25);
    W.surf.push({ geo: lev, pivot: [sd * 0.85, 0.12, -2.25], axis: [1, 0, 0], kind: "lev", side: sd });
    const st = panel([S(sd * 2.35, -0.05, 4.65, 2.85, 0.04), S(sd * 5.1, -0.03, 6.65, 1.3, 0.035)], camo);
    st.translate(-sd * 2.35, 0.05, -5.85);
    W.surf.push({ geo: st, pivot: [sd * 2.35, -0.05, 5.85], axis: [1, 0, 0], kind: "stab", side: sd });
    const cant = 0.45;
    const fh = 2.25;
    const fin = panel([S(0, 0, -1.3, 2.65, 0.05), S(sd * Math.sin(cant) * fh, Math.cos(cant) * fh, 0.5, 1.1, 0.04)], camo);
    // (Built round its pivot: the whole fin turns, on an axis along its cant.)
    W.surf.push({ geo: mergeGeos([fin, ...redStar(0.36, [sd * 0.05, 0, 0.4], "x", sd).map((g) => g.rotateZ(-sd * cant).translate(sd * Math.sin(cant) * 1.1, Math.cos(cant) * 1.1, 0))]), pivot: [sd * 2.0, 0.32, 5.2], axis: [sd * Math.sin(cant), Math.cos(cant), 0], kind: "tvfin", side: sd });
    hull.push(...redStar(0.42, [sd * 4.9, 0.16, 1.3], "y"));
  }
  glass.push(loftBody([{ z: -7.7, w: 0.1, ht: 0.06, hb: 0.08, yc: 0.62 }, { z: -6.9, w: 0.46, ht: 0.38, hb: 0.12, yc: 0.64 }, { z: -5.9, w: 0.52, ht: 0.52, hb: 0.12, yc: 0.68 }, { z: -4.8, w: 0.44, ht: 0.38, hb: 0.12, yc: 0.7 }, { z: -4.3, w: 0.15, ht: 0.1, hb: 0.1, yc: 0.72 }], 0xffffff, { seg: 18 }));
  hull.push(box(0, 1.17, -5.6, 0.95, 0.05, 0.06, 0x2f3236), ...pilot(0, 1.0, -5.95, 0x3e4a3a));
  // The vectoring nozzles: their own groups (they deflect with the stick).
  const noz = lathe([[0, 0.56], [0.6, 0.56], [1.25, 0.5], [1.3, 0.47]], (x, y, z) => (z > 1.25 ? BURNT : 0x55585c), { seg: 18 });
  const gear = [gearUnit({ at: [0, -0.55, -5.7], len: 1.5, r: 0.33, w: 0.2, axis: [1, 0, 0], ret: 1.6, twin: 0.42, wheels: [0], door: true }), ...[1, -1].map((sd) => gearUnit({ at: [sd * 1.95, -0.7, 0.95], len: 1.25, r: 0.45, w: 0.32, axis: [0, 0, -sd], ret: 1.55 }))];
  return {
    hull,
    glass,
    glassTint: 0xd0b060,
    surf: W.flush(),
    gear,
    finish: { spec: 0.4, gloss: 26, env: 0.16, grain: 0.025, panel: 0.25, panelScale: 1.0, livery: 0.06, liveryScale: 0.3, skin: { tone: 0.06, soot: 0.4, sootZ: 6.5, streaks: 0.05 } },
    nozzles: [1, -1].map((sd) => ({ at: [sd * 1.5, -0.4, 7.85], r: 0.47, group: sd > 0 ? "nozR" : "nozL" })),
    groups: { nozR: { geo: noz, pivot: [1.5, -0.4, 6.55] }, nozL: { geo: noz.clone(), pivot: [-1.5, -0.4, 6.55] } },
    lights: { left: [-7.05, 0.16, 3.9], right: [7.05, 0.16, 3.9], strobes: [[0, 0.4, 9.6], [0, -0.3, 0.5]] },
    pilot: [0, 1.0, -5.95],
    groundY: -2.23,
    length: 20.1,
    span: 14.1,
  };
};

// The F-14D: gull grey over white, a dark radome tip, Navy markings.
BUILD.f14 = (pal) => {
  const top = pal.main;
  const dark = pal.dark;
  const skin = (x, y, z) => (y < -0.3 && Math.abs(x) < 3.2 ? 0xdcdcd6 : z < -9.4 ? 0x3d3f42 : top);
  const hull = [];
  const glass = [];
  hull.push(
    loftBody(
      [
        { z: -10.05, w: 0.04, ht: 0.04, hb: 0.04, yc: 0, e: 2 },
        { z: -9.0, w: 0.42, ht: 0.42, hb: 0.42, yc: 0, e: 2 },
        { z: -7.6, w: 0.63, ht: 0.62, hb: 0.56, yc: 0.02, e: 2.2 },
        { z: -6.0, w: 0.72, ht: 0.84, hb: 0.62, yc: 0.02, e: 2.6 },
        { z: -4.0, w: 0.8, ht: 0.9, hb: 0.62, yc: 0.02, e: 2.8 },
        { z: -2.6, w: 0.86, ht: 0.78, hb: 0.6, yc: 0.02, e: 3 },
        { z: -1.0, w: 1.1, ht: 0.62, hb: 0.42, yc: 0.05, e: 4 },
        { z: 1.0, w: 1.25, ht: 0.52, hb: 0.3, yc: 0.06, e: 5 },
        { z: 4.0, w: 1.2, ht: 0.46, hb: 0.3, yc: 0.06, e: 5 },
        { z: 6.6, w: 0.95, ht: 0.32, hb: 0.2, yc: 0.06, e: 4 },
        { z: 8.35, w: 0.6, ht: 0.1, hb: 0.08, yc: 0.06, e: 3 },
      ],
      skin,
      { seg: 28 }
    )
  );
  hull.push(rod([0, 0, -10.0], [0, 0, -10.6], 0.02, 0x8d9296, 4));
  for (const sd of [1, -1]) {
    // The nacelles with their boxy, raked intakes; the gloves.
    hull.push(
      loftBody(
        [
          { z: -3.0, w: 0.52, ht: 0.62, hb: 0.6, yc: -0.28, cx: sd * 1.62, e: 6 },
          { z: -1.6, w: 0.58, ht: 0.64, hb: 0.62, yc: -0.27, cx: sd * 1.6, e: 5 },
          { z: 1.5, w: 0.64, ht: 0.62, hb: 0.6, yc: -0.25, cx: sd * 1.55, e: 3 },
          { z: 5.0, w: 0.62, ht: 0.6, hb: 0.6, yc: -0.22, cx: sd * 1.5, e: 2.4 },
          { z: 6.85, w: 0.58, ht: 0.58, hb: 0.58, yc: -0.22, cx: sd * 1.48, e: 2 },
        ],
        (x, y, z) => (z < -2.95 ? INTAKE : skin(x, y, z)),
        { seg: 18 }
      )
    );
    hull.push(lathe([[6.8, 0.58], [7.4, 0.56], [7.85, 0.52]], (x, y, z) => (z > 7.8 ? BURNT : 0x5a5d60), { cx: sd * 1.48, cy: -0.22, seg: 18 }));
    hull.push(panel([S(sd * 0.95, 0.28, -4.8, 6.4, 0.04), S(sd * 2.95, 0.28, -0.95, 2.65, 0.06)], skin));
    // The stabilators (all moving), the twin fins with their rudders, the ventral fins.
    const st = panel([S(sd * 2.05, -0.2, 5.05, 3.55, 0.04), S(sd * 5.0, -0.2, 7.65, 1.2, 0.035)], skin);
    st.translate(-sd * 2.05, 0.2, -6.4);
    W.surf.push({ geo: st, pivot: [sd * 2.05, -0.2, 6.4], axis: [1, 0, 0], kind: "stab", side: sd });
    const cant = 0.09;
    const fh = 3.05;
    const fin = lifting([S(sd * 1.55, 0.35, 3.15, 3.7, 0.05), S(sd * (1.55 + Math.sin(cant) * fh), 0.35 + fh, 6.35, 1.35, 0.045)], (x, y, z) => (y > 2.6 ? 0x2b2d30 : skin(x, y, z)), [{ a: 0.05, b: 0.85, f: 0.7, kind: "rud", side: sd }]);
    hull.push(...fin.fixed);
    W.surf.push(...fin.surfaces);
    hull.push(panel([S(sd * 1.65, -0.82, 4.8, 1.5, 0.05), S(sd * 1.75, -1.35, 5.6, 0.8, 0.05)], skin));
    hull.push(...starAndBar(0.36, [sd * 2.2, -0.2, 0.4], "x", false, sd));
  }
  // The canopy: tandem seats under a long bubble, a bow between them.
  glass.push(loftBody([{ z: -7.35, w: 0.1, ht: 0.06, hb: 0.08, yc: 0.66 }, { z: -6.6, w: 0.46, ht: 0.4, hb: 0.12, yc: 0.68 }, { z: -5.4, w: 0.54, ht: 0.56, hb: 0.12, yc: 0.72 }, { z: -4.2, w: 0.52, ht: 0.52, hb: 0.12, yc: 0.74 }, { z: -3.3, w: 0.36, ht: 0.3, hb: 0.12, yc: 0.74 }, { z: -2.8, w: 0.1, ht: 0.06, hb: 0.1, yc: 0.72 }], 0xffffff, { seg: 18 }));
  hull.push(box(0, 1.25, -4.95, 1.0, 0.05, 0.07, 0x2f3236), ...pilot(0, 1.07, -5.75), ...pilot(0, 1.12, -4.1));
  // The outer wings: their own groups, swinging round the pivots (see update).
  // (Built at 20 degrees of sweep, the pivot at the origin.)
  const wings = {};
  for (const sd of [1, -1]) {
    const L = 7.35;
    const sw = 0.349;
    const secs = [S(sd * 0.1, 0, -0.75, 3.15, 0.1), S(sd * (0.1 + Math.cos(sw) * L), -0.08, -0.75 + Math.sin(sw) * L, 1.25, 0.09)];
    const w = lifting(secs, skin, [{ a: 0.15, b: 0.92, f: 0.74, kind: "flap", side: sd }]);
    const fixed = mergeGeos([...w.fixed, ...starAndBar(0.3, [sd * 5.4, 0.08, 1.25], "y", false)]);
    wings[sd > 0 ? "wingR" : "wingL"] = { geo: fixed, pivot: [sd * 2.75, 0.24, -0.2], surfaces: w.surfaces };
  }
  const gear = [gearUnit({ at: [0, -0.55, -6.6], len: 1.12, r: 0.28, w: 0.18, axis: [1, 0, 0], ret: 1.65, twin: 0.36, door: true }), ...[1, -1].map((sd) => gearUnit({ at: [sd * 2.55, -0.2, 1.1], len: 1.25, r: 0.45, w: 0.3, axis: [1, 0, 0], ret: -1.5, fork: 0.15 }))];
  return {
    hull,
    glass,
    surf: W.flush(),
    gear,
    finish: { spec: 0.45, gloss: 26, env: 0.16, grain: 0.025, panel: 0.26, panelScale: 1.0, livery: 0.06, liveryScale: 0.3, skin: { tone: 0.07, soot: 0.45, sootZ: 6.5, streaks: 0.07 } },
    nozzles: [1, -1].map((sd) => ({ at: [sd * 1.48, -0.22, 7.85], r: 0.5 })),
    groups: { wingR: wings.wingR, wingL: wings.wingL },
    lights: { left: [-9.7, 0.0, 2.0], right: [9.7, 0.0, 2.0], strobes: [[1.85, 3.45, 6.8], [-1.85, 3.45, 6.8]], tipsOn: "wings" },
    pilot: [0, 1.07, -5.75],
    groundY: -1.76,
    length: 19.1,
    span: 19.55,
  };
};

// The P-51D: natural metal, the olive drab anti-glare panel, a red nose,
// invasion stripes, a yellow-tipped prop.
BUILD.p51 = (pal) => {
  const metal = pal.metal ?? 0xb9bfc5;
  const od = 0x4a4f2e;
  // (D-Day's invasion stripes on the wings: five bands, white-black-white-black-white.)
  const STRIPE0 = 1.55;
  const STRIPE = 0.36;
  const stripes = (x) => {
    const u = (Math.abs(x) - STRIPE0) / STRIPE;
    if (u < 0 || u >= 5) return null;
    return Math.floor(u) % 2 ? BLACK : WHITE;
  };
  const skin = (x, y, z) => (z < -4.15 ? RED : y > 0.42 && z < -0.6 && Math.abs(x) < 0.38 ? od : metal);
  const wingSkin = (x, y, z) => (Math.abs(x) > 5.4 ? YELLOW : stripes(x) ?? metal);
  const hull = [];
  const glass = [];
  hull.push(
    loftBody(
      [
        { z: -4.55, w: 0.46, ht: 0.52, hb: 0.52, yc: 0.1, e: 2 },
        { z: -4.0, w: 0.52, ht: 0.58, hb: 0.6, yc: 0.08, e: 2.1 },
        { z: -2.6, w: 0.5, ht: 0.62, hb: 0.62, yc: 0.05, e: 2.3 },
        { z: -1.2, w: 0.52, ht: 0.68, hb: 0.66, yc: 0.04, e: 2.4 },
        { z: -0.2, w: 0.52, ht: 0.72, hb: 0.7, yc: 0.02, e: 2.4 },
        { z: 1.0, w: 0.48, ht: 0.68, hb: 0.75, yc: 0.0, e: 2.4 },
        { z: 2.4, w: 0.36, ht: 0.58, hb: 0.62, yc: 0.02, e: 2.3 },
        { z: 3.6, w: 0.22, ht: 0.5, hb: 0.44, yc: 0.1, e: 2.2 },
        { z: 4.6, w: 0.08, ht: 0.3, hb: 0.2, yc: 0.2, e: 2 },
        { z: 4.92, w: 0.03, ht: 0.05, hb: 0.05, yc: 0.25, e: 2 },
      ],
      skin,
      { seg: 24 }
    )
  );
  // The belly scoop (the radiator) and the chin intake.
  hull.push(loftBody([{ z: 0.1, w: 0.3, ht: 0.22, hb: 0.3, yc: -0.86, e: 2.6 }, { z: 1.2, w: 0.33, ht: 0.26, hb: 0.34, yc: -0.88, e: 2.6 }, { z: 2.6, w: 0.28, ht: 0.2, hb: 0.24, yc: -0.78, e: 2.4 }, { z: 3.2, w: 0.12, ht: 0.08, hb: 0.08, yc: -0.62, e: 2 }], (x, y, z) => (z < 0.15 ? INTAKE : metal), { seg: 16 }));
  hull.push(loftBody([{ z: -3.75, w: 0.14, ht: 0.12, hb: 0.12, yc: -0.62 }, { z: -3.0, w: 0.18, ht: 0.14, hb: 0.16, yc: -0.66 }, { z: -2.0, w: 0.1, ht: 0.08, hb: 0.08, yc: -0.6 }], (x, y, z) => (z < -3.7 ? INTAKE : metal), { seg: 12 }));
  // The exhaust stacks, six a side.
  for (const sd of [1, -1]) for (let i = 0; i < 6; i++) hull.push(box(sd * 0.5, 0.2, -3.85 + i * 0.27, 0.12, 0.12, 0.15, 0x2a2420));
  // The bubble canopy, the windscreen frame, the pilot.
  glass.push(loftBody([{ z: -1.25, w: 0.12, ht: 0.08, hb: 0.1, yc: 0.64 }, { z: -0.6, w: 0.36, ht: 0.42, hb: 0.12, yc: 0.66 }, { z: 0.4, w: 0.4, ht: 0.6, hb: 0.12, yc: 0.68 }, { z: 1.3, w: 0.34, ht: 0.42, hb: 0.12, yc: 0.66 }, { z: 1.85, w: 0.1, ht: 0.06, hb: 0.1, yc: 0.64 }], 0xffffff, { seg: 18 }));
  hull.push(box(0, 1.0, -0.85, 0.62, 0.05, 0.06, 0x8a9096), ...pilot(0, 1.02, 0.3, 0x6d5a3c));
  // The wings (dihedral, the rounded tips), the guns in the leading edges.
  for (const sd of [1, -1]) {
    const w = lifting([S(sd * 0.45, -0.45, -0.85, 2.65, 0.15), S(sd * 2.6, -0.26, -0.68, 2.0, 0.14), S(sd * 5.45, 0.02, -0.42, 1.18, 0.11), S(sd * 5.64, 0.04, -0.3, 0.95, 0.1)], wingSkin, [
      { a: 0.04, b: 0.33, f: 0.76, kind: "flap", side: sd },
      { a: 0.4, b: 0.95, f: 0.78, kind: "ail", side: sd },
    ], { xBreaks: [0, 1, 2, 3, 4, 5].map((k) => STRIPE0 + k * STRIPE).concat([5.4]) });
    hull.push(...w.fixed);
    W.surf.push(...w.surfaces);
    for (const gx of [2.2, 2.45, 2.7]) hull.push(rod([sd * gx, -0.3 + (gx - 2.2) * 0.04, -0.6], [sd * gx, -0.3 + (gx - 2.2) * 0.04, -1.15], 0.035, 0x2a2b2d, 6));
    const tail = lifting([S(sd * 0.15, 0.18, 3.55, 1.45, 0.09), S(sd * 1.6, 0.18, 3.8, 1.05, 0.08), S(sd * 2.05, 0.18, 4.05, 0.7, 0.07)], skin, [{ a: 0.05, b: 0.9, f: 0.62, kind: "elev", side: sd }]);
    hull.push(...tail.fixed);
    W.surf.push(...tail.surfaces);
    hull.push(...starAndBar(0.25, [sd * 0.37, 0.05, 2.45], "x", false, sd));
    if (sd < 0) hull.push(...starAndBar(0.42, [-4.2, -0.1, -0.05], "y", false));
  }
  const fin = lifting([S(0, 0.38, 3.1, 1.75, 0.09), S(0, 1.3, 3.75, 1.25, 0.08), S(0, 1.75, 4.2, 0.8, 0.07), S(0, 1.9, 4.45, 0.45, 0.06)], skin, [{ a: 0.0, b: 0.9, f: 0.6, kind: "rud", side: 0 }]);
  hull.push(...fin.fixed);
  W.surf.push(...fin.surfaces);
  hull.push(panel([S(0, 0.45, 2.2, 1.0, 0.08), S(0, 0.6, 3.15, 0.2, 0.06)], skin));
  // The spinner and the propeller (its own group).
  hull.push(latheAlong([[-0.05, 0.47], [0.3, 0.42], [0.62, 0.26], [0.78, 0.04]], RED, [0, 0.1, -4.55], [0, 0, -1], { seg: 16 }));
  const prop = propeller(4, 1.7, { c0: 0.26, c1: 0.18, paint: (r) => (r > 1.5 ? YELLOW : BLACK), hand: 1 });
  // Stores: a 500 lb bomb under each wing, three HVARs each side.
  const stores = { bombs: [], rockets: [] };
  for (const sd of [1, -1]) {
    stores.bombs.push(mergeGeos([box(sd * 2.6, -0.52, -0.2, 0.08, 0.16, 0.9, 0x8e9399), latheAlong([[-0.9, 0.02], [-0.7, 0.16], [0.45, 0.17], [0.9, 0.06]], (x, y, z) => (z < -0.85 && z > -0.98 ? YELLOW : 0x4b5236), [sd * 2.6, -0.82, -0.25], [0, 0, 1], { seg: 10 })]));
    for (const rx of [3.3, 3.75, 4.2]) stores.rockets.push(mergeGeos([box(sd * rx, -0.38, -0.5, 0.05, 0.12, 0.4, 0x8e9399), latheAlong([[-0.85, 0.02], [-0.7, 0.065], [0.8, 0.065]], (x, y, z) => (z < -1.2 ? 0x3d4a2a : 0x7a7f74), [sd * rx, -0.5, -0.55], [0, 0, 1], { seg: 8 })]));
  }
  const gear = [
    ...[1, -1].map((sd) => gearUnit({ at: [sd * 1.8, -0.5, -1.15], len: 1.05, r: 0.37, w: 0.2, axis: [0, 0, sd], ret: -1.55, door: true })),
    gearUnit({ at: [0, -0.3, 4.1], len: 0.45, r: 0.15, w: 0.08, axis: [1, 0, 0], ret: -1.4 }),
  ];
  return {
    hull,
    glass,
    surf: W.flush(),
    gear,
    finish: { spec: 0.45, gloss: 40, env: 0.1, grain: 0.02, brush: 0.3, panel: 0.3, panelScale: 1.4, livery: 0.03, liveryScale: 0.3, skin: { tone: 0.06, soot: 0.6, sootZ: -2.0, streaks: 0.12 } },
    nozzles: [],
    props: [{ geo: prop, at: [0, 0.1, -4.62], r: 1.7, hand: 1 }],
    exhausts: [1, -1].map((sd) => [sd * 0.57, 0.2, -3.2]),
    stores,
    lights: { left: [-5.6, 0.05, -0.0], right: [5.6, 0.05, -0.0], strobes: [[0, 1.85, 4.65], [0, -0.85, 2.2]] },
    pilot: [0, 1.02, 0.3],
    groundY: -1.92,
    sit: { angle: 0.19, pivot: [0, -1.92, -1.15] },
    length: 9.83,
    span: 11.28,
  };
};

// The AC-130J: gunship grey, black props, low-vis markings, the guns on the left.
BUILD.ac130 = (pal) => {
  const grey = pal.main;
  const dark = pal.dark;
  const windows = (x, y, z) => z > -14.55 && z < -12.85 && y > 0.42 && y < 1.35 && (Math.abs(x) < 1.0 || z < -13.6);
  const skin = (x, y, z) => (windows(x, y, z) ? 0x14181c : z < -14.85 ? 0x3e4246 : y < -1.9 ? dark : grey);
  const hull = [];
  const glass = [];
  hull.push(
    loftBody(
      [
        { z: -15.4, w: 0.12, ht: 0.12, hb: 0.12, yc: -0.3, e: 2 },
        { z: -14.85, w: 1.0, ht: 0.96, hb: 1.02, yc: -0.28, e: 2 },
        { z: -14.2, w: 1.45, ht: 1.5, hb: 1.42, yc: -0.18, e: 2 },
        { z: -13.5, w: 1.75, ht: 1.9, hb: 1.7, yc: -0.08, e: 2.05 },
        { z: -12.4, w: 2.05, ht: 2.15, hb: 2.05, yc: 0, e: 2.1 },
        { z: -10.5, w: 2.15, ht: 2.2, hb: 2.25, yc: 0, e: 2.15 },
        { z: 0.0, w: 2.15, ht: 2.2, hb: 2.3, yc: 0, e: 2.15 },
        { z: 5.0, w: 2.15, ht: 2.2, hb: 2.3, yc: 0, e: 2.15 },
        { z: 7.5, w: 2.05, ht: 2.15, hb: 1.6, yc: 0.4, e: 2.1 },
        { z: 10.5, w: 1.7, ht: 2.0, hb: 0.78, yc: 1.12, e: 2.1 },
        { z: 13.0, w: 1.0, ht: 1.55, hb: 0.42, yc: 1.6, e: 2 },
        { z: 14.4, w: 0.42, ht: 1.0, hb: 0.26, yc: 1.88, e: 2 },
        { z: 14.95, w: 0.1, ht: 0.3, hb: 0.1, yc: 2.0, e: 2 },
      ],
      skin,
      { seg: 32, per: 3 }
    )
  );
  // The wing's root fairing on top, the dorsal fin.
  hull.push(loftBody([{ z: -3.0, w: 0.4, ht: 0.12, hb: 0.1, yc: 2.05 }, { z: -1.6, w: 1.4, ht: 0.32, hb: 0.1, yc: 2.08 }, { z: 2.0, w: 1.4, ht: 0.3, hb: 0.1, yc: 2.08 }, { z: 4.0, w: 0.5, ht: 0.12, hb: 0.1, yc: 2.05 }], skin, { seg: 16 }));
  // The vertical tail and rudder, the dorsal fillet.
  const fin = lifting([S(0, 1.9, 8.9, 5.6, 0.12), S(0, 4.5, 10.6, 3.95, 0.11), S(0, 8.4, 12.35, 2.35, 0.1), S(0, 8.6, 12.7, 1.8, 0.09)], skin, [{ a: 0.08, b: 0.92, f: 0.66, kind: "rud", side: 0 }]);
  hull.push(...fin.fixed);
  W.surf.push(...fin.surfaces);
  hull.push(panel([S(0, 1.95, 6.0, 3.3, 0.1), S(0, 2.9, 9.3, 0.5, 0.08)], skin));
  // The gunship's sensors and guns (the left side).
  hull.push(ball(-1.2, -1.95, -11.4, 0.42, 0x2c3034), ball(-1.62, -1.9, 5.3, 0.46, 0x2c3034));
  hull.push(rod([-2.0, -0.85, -6.1], [-2.95, -0.85, -6.1], 0.07, 0x26282a, 8), latheAlong([[0, 0.16], [0.5, 0.16]], 0x34373a, [-2.0, -0.85, -6.1], [-1, 0, 0], { seg: 10 }));
  hull.push(rod([-2.0, -0.3, -2.24], [-3.0, -0.3, -2.24], 0.09, 0x26282a, 8), latheAlong([[0, 0.2], [0.45, 0.2]], 0x34373a, [-2.0, -0.3, -2.24], [-1, 0, 0], { seg: 10 }));
  hull.push(rod([-1.95, -1.35, 3.95], [-3.35, -1.35, 3.95], 0.14, 0x26282a, 10), latheAlong([[0, 0.24], [0.35, 0.24]], 0x34373a, [-3.3, -1.35, 3.95], [-1, 0, 0], { seg: 10 }), latheAlong([[0, 0.35], [0.4, 0.35]], 0x34373a, [-1.95, -1.35, 3.95], [-1, 0, 0], { seg: 12 }));
  for (const sd of [1, -1]) {
    // The wing: a slight taper, dihedral, rounded tips; ailerons and flaps.
    const w = lifting([S(sd * 0.0, 2.1, -2.48, 4.95, 0.17), S(sd * 10.2, 2.45, -2.15, 4.15, 0.15), S(sd * 19.9, 2.92, -1.45, 2.45, 0.12), S(sd * 20.2, 2.93, -1.2, 1.9, 0.1)], skin, [
      { a: 0.08, b: 0.6, f: 0.74, kind: "flap", side: sd },
      { a: 0.7, b: 0.98, f: 0.74, kind: "ail", side: sd },
    ]);
    hull.push(...w.fixed);
    W.surf.push(...w.surfaces);
    // The tailplane and elevators.
    const tail = lifting([S(sd * 0.3, 2.2, 11.3, 3.65, 0.1), S(sd * 8.0, 2.25, 12.75, 1.9, 0.09)], skin, [{ a: 0.04, b: 0.94, f: 0.7, kind: "elev", side: sd }]);
    hull.push(...tail.fixed);
    W.surf.push(...tail.surfaces);
    // The gear sponsons.
    hull.push(loftBody([{ z: -3.9, w: 0.2, ht: 0.4, hb: 0.3, yc: -1.5, cx: sd * 1.95 }, { z: -3.0, w: 0.62, ht: 0.95, hb: 0.85, yc: -1.45, cx: sd * 2.0, e: 3 }, { z: 3.2, w: 0.62, ht: 0.95, hb: 0.85, yc: -1.45, cx: sd * 2.0, e: 3 }, { z: 4.6, w: 0.2, ht: 0.4, hb: 0.3, yc: -1.4, cx: sd * 1.95 }], skin, { seg: 16 }));
    // The four nacelles (oval, under the wing), the spinners; the props are their own groups.
    for (const nx of [5.15, 10.25]) {
      hull.push(lathe([[-6.3, 0.5], [-5.9, 0.76], [-4.6, 0.82], [-2.0, 0.85], [0.2, 0.8], [1.8, 0.58], [3.0, 0.25]], skin, { cx: sd * nx, cy: 1.48, seg: 18, squash: 1.28 }));
      hull.push(latheAlong([[-0.05, 0.5], [0.4, 0.42], [0.8, 0.2], [0.95, 0.03]], 0x2e3134, [sd * nx, 1.48, -6.3], [0, 0, -1], { seg: 14 }));
      hull.push(box(sd * nx, 0.38, -4.6, 0.5, 0.25, 1.0, 0x2a2c2e)); // (the intake under the spinner)
    }
    hull.push(...starAndBar(0.55, [sd * 2.16, 0.3, 7.0], "x", true, sd));
  }
  hull.push(...pilot(-0.55, 0.95, -13.4, 0x50553a), ...pilot(0.55, 0.95, -13.4, 0x50553a));
  const props = [];
  for (const sd of [1, -1]) for (const nx of [5.15, 10.25]) props.push({ geo: propeller(6, 2.05, { c0: 0.36, c1: 0.2, sweep: 0.35, paint: (r) => (r > 1.95 ? YELLOW : BLACK), hand: 1 }), at: [sd * nx, 1.48, -6.42], r: 2.05, hand: 1 });
  const gear = [
    gearUnit({ at: [0, -1.6, -12.0], len: 1.05, r: 0.45, w: 0.28, axis: [1, 0, 0], ret: 1.5, twin: 0.62, door: false }),
    ...[1, -1].map((sd) => gearUnit({ at: [sd * 2.2, -1.75, 0.3], len: 1.0, r: 0.58, w: 0.42, axis: [1, 0, 0], ret: 0, tandem: 2.2, lift: [0, 1.15, 0] })),
  ];
  return {
    hull,
    glass,
    glassTint: 0x2a3a48,
    surf: W.flush(),
    gear,
    finish: { spec: 0.22, gloss: 14, env: 0.06, grain: 0.03, panel: 0.25, panelScale: 0.8, livery: 0.06, liveryScale: 0.2, skin: { tone: 0.07, soot: 0.3, sootZ: 1.5, streaks: 0.1 } },
    nozzles: [],
    props,
    exhausts: [],
    lights: { left: [-20.2, 2.95, -0.3], right: [20.2, 2.95, -0.3], strobes: [[0, 8.65, 13.3], [0, -2.3, 1.0]] },
    pilot: [-0.55, 0.95, -13.4],
    groundY: -3.33,
    length: 29.8,
    span: 40.4,
  };
};

// ---------- Assembly ----------

const PALETTES = {
  a10: { main: 0x6f767c, dark: 0x5a6066 },
  f35: { main: 0x5f666e, dark: 0x545a61 },
  su57: { main: 0x66788a, dark: 0x3c4856, light: 0x95a3ae },
  f14: { main: 0x8f969c, dark: 0x767d84 },
  p51: { main: 0xb9bfc5, dark: 0x8d9399, metal: 0xb9bfc5 },
  ac130: { main: 0x51585e, dark: 0x464c52 },
};
const cache = new Map();

function buildDef(type, paint) {
  const key = `${type}:${paint}`;
  if (cache.has(key)) return cache.get(key);
  const base = PALETTES[type];
  const sc = SCHEMES[paint];
  const pal = sc ? { ...base, main: sc[0], dark: sc[1], light: base.light ? sc[0] : undefined, metal: sc[0] } : base;
  W.surf = [];
  const d = BUILD[type](pal);
  const def = {
    ...d,
    hullGeo: mergeGeos(d.hull),
    glassGeo: d.glass.length ? mergeGeos(d.glass) : null,
  };
  delete def.hull;
  delete def.glass;
  cache.set(key, def);
  return def;
}

export const PLANE_MODEL_TYPES = Object.keys(BUILD);

// Creates an aircraft model of `type` (one of PLANE_MODEL_TYPES).
export function createPlaneModel(type, { paint = "gray" } = {}) {
  const def = buildDef(type, SCHEMES[paint] ? paint : "gray");
  const root = new THREE.Group();
  // (The pivot of the tail-down sit (a taildragger): the body turns round
  // the main wheels' contact; everything else hangs on `body`.)
  const sitGroup = new THREE.Group();
  root.add(sitGroup);
  const body = new THREE.Group();
  body.scale.setScalar(K);
  sitGroup.add(body);
  const light = { sky: 15, block: 0, flash: new THREE.Color(0, 0, 0) };
  const getLight = () => light;
  const hullMat = createEntityMaterial("color", null, { finish: def.finish });
  hullMat.uniforms.uFill.value = 0.45;
  const own = []; // (materials and geometries this model made for itself)
  const meshOf = (geo, mat = hullMat, parent = body) => {
    const m = new THREE.Mesh(geo, mat);
    m.castShadow = true;
    bindEntityLight(m, getLight);
    parent.add(m);
    return m;
  };
  const hullMesh = meshOf(def.hullGeo);
  const glassMat = new THREE.MeshStandardMaterial({ color: def.glassTint ?? 0x9fb4c4, metalness: 0.85, roughness: 0.12, envMapIntensity: 1, transparent: true, opacity: 0.72 });
  own.push(glassMat);
  const canopy = def.glassGeo ? new THREE.Mesh(def.glassGeo, glassMat) : new THREE.Group();
  body.add(canopy);
  // A group hinged at a pivot holding a geometry built round it.
  const hinged = (geo, pivot, parent = body) => {
    const g = new THREE.Group();
    g.position.fromArray(pivot);
    parent.add(g);
    if (geo) meshOf(geo, hullMat, g);
    return g;
  };
  // Special moving groups (the F-14's wings, the F-35's nozzle and doors, the Su-57's nozzles).
  const groups = {};
  for (const [name, gd] of Object.entries(def.groups || {})) {
    groups[name] = hinged(gd.geo, gd.pivot);
    // (A wing's own control surfaces ride on it: built round the wing's own origin, its pivot.)
    for (const s of gd.surfaces || []) def.surf.push({ ...s, parent: name });
  }
  const surfaces = def.surf.map((s) => {
    const parent = s.parent ? groups[s.parent] : body;
    const g = hinged(s.geo, s.pivot, parent);
    return { group: g, axis: new THREE.Vector3().fromArray(s.axis), kind: s.kind, side: s.side };
  });
  // (Each def is cached: the wings' surfaces were added to it once above; keep them from piling up.)
  def.surf = def.surf.filter((s) => !s.parent);
  // The gear.
  const gear = def.gear.map((u) => ({ group: hinged(u.geo, u.pivot), axis: new THREE.Vector3().fromArray(u.axis), ret: u.ret, lift: u.lift, pivot: u.pivot }));
  let gearT = 1;
  // The propellers: groups spinning round Z, with a blurred disc.
  const props = (def.props || []).map((p) => {
    const g = hinged(p.geo, p.at);
    const discMat = new THREE.MeshBasicMaterial({ map: propDiscTexture(), transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide, fog: true });
    own.push(discMat);
    const disc = new THREE.Mesh(new THREE.CircleGeometry(p.r, 28), discMat);
    own.push(disc.geometry);
    disc.position.fromArray(p.at);
    disc.position.z -= 0.05;
    disc.renderOrder = 5;
    body.add(disc);
    return { group: g, disc, hand: p.hand || 1, angle: Math.random() * 6 };
  });
  // Stores that go as they are used (the P-51's bombs and rockets).
  const stores = {};
  for (const [k, list] of Object.entries(def.stores || {})) stores[k] = list.map((geo) => meshOf(geo));
  // The jets' flames (from their nozzles, or a nozzle group).
  const flames = [];
  for (const n of def.nozzles || []) {
    const parent = n.group ? groups[n.group] : body;
    const at = n.group ? n.at.map((v, i) => v - def.groups[n.group].pivot[i]) : n.at;
    const cone = new THREE.ConeGeometry(n.r, 1, 14, 1, true).rotateX(Math.PI / 2).translate(0, 0, 0.5);
    own.push(cone);
    const mat = new THREE.MeshBasicMaterial({ map: flameTexture(), color: new THREE.Color(3, 2, 1.4), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: true });
    own.push(mat);
    const flame = new THREE.Mesh(cone, mat);
    flame.position.fromArray(at);
    flame.layers.set(LAYER_FX);
    flame.renderOrder = 12;
    parent.add(flame);
    const halo = glowSprite(new THREE.Color(2, 1.1, 0.5), n.r * 2.6);
    own.push(halo.material);
    halo.position.fromArray(at);
    halo.position.z += 0.3;
    parent.add(halo);
    const diamonds = [];
    for (let i = 0; i < 4; i++) {
      const d = glowSprite(new THREE.Color(3.2, 3.4, 5), n.r * 1.6);
      own.push(d.material);
      d.visible = false;
      parent.add(d);
      diamonds.push(d);
    }
    flames.push({ flame, halo, diamonds, at, r: n.r });
  }
  // The A-10's fan exhausts: a faint heat glow only.
  const fans = (def.fans || []).map((f) => {
    const s = glowSprite(new THREE.Color(0.6, 0.35, 0.2), f.r * 2.4);
    own.push(s.material);
    s.position.fromArray(f.at);
    body.add(s);
    return s;
  });
  // The P-51's exhaust stacks: a blue-orange flicker with the throttle.
  const exhausts = (def.exhausts || []).map((p) => {
    const s = glowSprite(new THREE.Color(1.2, 0.8, 1.4), 0.9);
    own.push(s.material);
    s.position.fromArray(p);
    s.visible = false;
    body.add(s);
    return s;
  });
  // Navigation lights and strobes.
  const L = def.lights;
  const nav = [];
  const addLight = (color, at, size) => {
    const s = glowSprite(color, size);
    own.push(s.material);
    s.position.fromArray(at);
    // (The F-14's wingtip lights ride on its swinging wings.)
    const onWing = L.tipsOn === "wings" && Math.abs(at[0]) > 5;
    if (onWing) {
      const g = groups[at[0] > 0 ? "wingR" : "wingL"];
      s.position.sub(new THREE.Vector3().fromArray(def.groups[at[0] > 0 ? "wingR" : "wingL"].pivot));
      // (Its tip at 20 degrees of sweep, from the wing's pivot.)
      s.position.set(at[0] > 0 ? 7.0 : -7.0, -0.1, 1.9);
      g.add(s);
    } else body.add(s);
    s.visible = false;
    nav.push(s);
    return s;
  };
  addLight(new THREE.Color(2.4, 0.15, 0.15), L.left, 0.5);
  addLight(new THREE.Color(0.15, 2.4, 0.2), L.right, 0.5);
  for (const p of L.strobes) addLight(new THREE.Color(2.6, 2.6, 3), p, 0.45);
  const cockpitGlow = glowSprite(new THREE.Color(0.1, 0.35, 0.18), 0.6);
  own.push(cockpitGlow.material);
  cockpitGlow.position.fromArray(def.pilot).add(new THREE.Vector3(0, -0.2, -0.5));
  cockpitGlow.visible = false;
  body.add(cockpitGlow);
  // The taildragger's sit (radians, nose up) and its pivot (blocks).
  const sitDef = def.sit;
  let sit = sitDef ? sitDef.angle : 0;
  if (sitDef) {
    const pv = new THREE.Vector3().fromArray(sitDef.pivot).multiplyScalar(K);
    sitGroup.position.copy(pv);
    body.position.copy(pv).negate();
  }
  let throttle = 0;
  let ab = false;
  let abWas = false;
  let abT = 0;
  let burnt = false;
  const st = { sweepK: 0, nozzle: 0, door: 0, tvp: 0, tvy: 0 };
  const applySit = () => {
    sitGroup.rotation.x = sit;
  };
  applySit();
  const model = {
    root,
    body,
    light,
    hull: hullMesh,
    canopy,
    type,
    length: def.length * K,
    span: def.span * K,
    groups,
    props,
    get sit() {
      return sit;
    },
    setThrottle(th, afterburner, t) {
      throttle = th;
      ab = !!afterburner;
      if (ab && !abWas) abT = t;
      abWas = ab;
      const lit = ab ? Math.max(0, 1 - (t - abT) / 0.3) : 0;
      for (const f of flames) {
        const flicker = 0.9 + Math.sin(t * 43 + f.at[0] * 7) * 0.1;
        const len = (ab ? 8.5 + Math.sin(t * 31) * 0.8 + lit * 3 : 0.4 + th * 1.8) / K;
        const wide = ab ? 1.4 + lit * 0.5 : 0.8;
        f.flame.scale.set(wide, wide, len * flicker * 0.55);
        f.flame.visible = !burnt && (th > 0.05 || ab);
        f.flame.material.color.setRGB(ab ? 2.2 : 3, ab ? 2.2 : 1.6, ab ? 3.2 : 0.8);
        f.flame.material.opacity = ab ? 1 : 0.35 + th * 0.5;
        f.halo.visible = !burnt && th > 0.05;
        const g = 0.4 + th * 1.6 + (ab ? 2 : 0);
        f.halo.material.color.setRGB(g * 0.8, g * 0.4, g * 0.25 + (ab ? 0.5 : 0));
        f.halo.scale.setScalar(f.r * (2 + th * 1.5 + (ab ? 3 + lit * 4 : 0)));
        for (let i = 0; i < f.diamonds.length; i++) {
          const d = f.diamonds[i];
          d.visible = ab && !burnt;
          if (d.visible) {
            d.position.set(f.at[0], f.at[1], f.at[2] + (1.2 + i * 1.9) / K * 0.8);
            d.scale.setScalar(f.r * (1.5 - i * 0.22) * (0.85 + 0.25 * Math.sin(t * 60 + i * 2)));
          }
        }
      }
      for (const s of fans) {
        s.visible = !burnt && th > 0.05;
        s.material.color.setRGB(0.3 + th * 0.6, 0.18 + th * 0.3, 0.1 + th * 0.12);
      }
      for (const s of exhausts) {
        s.visible = !burnt && th > 0.05;
        const k = 0.25 + th * (0.4 + 0.25 * Math.sin(t * 50 + s.position.x));
        s.material.color.setRGB(k * 1.4, k * 0.7, k * (ab ? 1.6 : 1.0));
        s.scale.setScalar(0.25 + th * 0.3);
      }
    },
    // Ailerons (roll), elevators or all-moving tails (pitch, a little with
    // the roll), rudders or all-moving fins (yaw); flaps with the gear;
    // `brake` (0-1): the A-10's decelerons split, the others' surfaces as
    // the F-22's do (rudders toe out, flaps droop).
    setControls(pitch, roll, yaw, brake = 0) {
      for (const s of surfaces) {
        const sd = s.side || 1;
        let a = 0;
        switch (s.kind) {
          case "ail":
            a = -0.45 * roll * sd + 0.15 * brake;
            break;
          case "split":
            a = -0.45 * roll * sd - 0.85 * brake;
            break;
          case "splitlow":
            a = -0.45 * roll * sd + 0.85 * brake;
            break;
          case "flap":
            a = 0.5 * gearT * (1 - st.sweepK) + 0.3 * brake;
            break;
          case "elev":
            a = -0.4 * pitch - 0.1 * roll * sd;
            break;
          case "stab":
            a = -0.32 * pitch - 0.16 * roll * sd;
            break;
          case "rud":
            a = 0.42 * yaw * (s.axis.y >= 0 ? 1 : -1) + (s.side ? 0.4 * brake * s.side : 0);
            break;
          case "tvfin":
            a = 0.3 * yaw + 0.25 * brake * sd;
            break;
          case "lev":
            a = -0.35 * Math.max(0, pitch) - 0.1 * roll * sd;
            break;
          case "bellydoor":
            a = 1.45 * st.door;
            break;
          default:
            a = 0;
        }
        s.group.quaternion.setFromAxisAngle(s.axis, a);
      }
      // (Thrust vectoring: the Su-57's nozzles follow the stick.)
      if (groups.nozR) {
        st.tvp += (-0.26 * pitch - st.tvp) * 0.3;
        st.tvy += (0.14 * yaw - st.tvy) * 0.3;
        groups.nozR.rotation.set(st.tvp - 0.1 * roll, st.tvy, 0);
        groups.nozL.rotation.set(st.tvp + 0.1 * roll, st.tvy, 0);
      }
    },
    setBurnt(on, t = 0) {
      burnt = !!on;
      canopy.visible = !on;
      if (!on) return;
      for (const f of flames) {
        f.flame.visible = f.halo.visible = false;
        for (const d of f.diamonds) d.visible = false;
      }
      for (const o of [...nav, cockpitGlow, ...fans, ...exhausts]) o.visible = false;
      for (const p of props) p.disc.visible = false;
      hullMat.uniforms.uFill.value = 0.02;
      light.flash.setRGB(0.55 + 0.25 * Math.sin(t * 17), 0.16 + 0.1 * Math.sin(t * 23 + 1), 0.02);
    },
    // 1 = down, 0 = folded away (a rotation round each leg's pivot, or a lift into the sponson).
    setGear(down) {
      gearT = down;
      for (const g of gear) {
        g.group.visible = down > 0.02 || (type === "a10" && g.pivot[0] !== 0.34); // (the A-10's main wheels stay half out)
        g.group.quaternion.setFromAxisAngle(g.axis, (1 - down) * g.ret);
        g.group.position.fromArray(g.pivot);
        if (g.lift) g.group.position.add(new THREE.Vector3().fromArray(g.lift).multiplyScalar(1 - down));
      }
    },
    get gear() {
      return gearT;
    },
    setLights(t, dark = 0, active = dark > 0.3) {
      const night = dark > 0.3;
      const k = night ? 0.5 + 0.5 * Math.min(1, (dark - 0.3) / 0.25) : 0.45;
      const strobe = (t % 1.2) < 0.08 || ((t % 1.2) > 0.4 && (t % 1.2) < 0.47);
      nav[0].visible = nav[1].visible = active && !burnt;
      nav[0].material.color.setRGB(2.4 * k, 0.15 * k, 0.15 * k);
      nav[1].material.color.setRGB(0.15 * k, 2.4 * k, 0.2 * k);
      for (let i = 2; i < nav.length; i++) nav[i].visible = active && strobe && !burnt;
      cockpitGlow.visible = active && night && !burnt;
      hullMat.uniforms.uFill.value = 0.08 + 0.5 * dark;
    },
    get lightsOn() {
      return nav[0].visible;
    },
    // The moving parts, from the aircraft's state each frame: { running,
    // throttle, speed, onGround, stall (the stall speed), sweep (radians),
    // nozzle (0-1: the F-35B's hover), stores: { bombs, rockets } }.
    update(s, dt) {
      // Propellers: idle to full revs with the throttle (shown spinning at up
      // to ~30 rad/s, the blur disc thickening with the revs).
      for (const p of props) {
        const rate = s.running && !burnt ? 9 + 22 * s.throttle : 0;
        p.rate = (p.rate ?? 0) + (rate - (p.rate ?? 0)) * Math.min(1, dt * 1.5);
        p.angle += p.rate * dt * p.hand;
        p.group.rotation.z = -p.angle;
        p.disc.material.opacity = Math.min(0.55, Math.max(0, (p.rate - 6) / 30));
        p.disc.visible = p.disc.material.opacity > 0.01 && !burnt;
      }
      // The F-14's wings (20 degrees forward; the pivot built at 20).
      st.sweepK = 0;
      if (groups.wingR && Number.isFinite(s.sweep)) {
        const d = s.sweep - 0.349;
        groups.wingR.rotation.y = -d;
        groups.wingL.rotation.y = d;
        st.sweepK = Math.min(1, Math.max(0, (s.sweep - 0.4) / 0.4));
      }
      // The F-35B's hover: the nozzle swivels down, the doors open.
      if (groups.nozzle) {
        const n = s.nozzle || 0;
        st.door = Math.min(1, n * 1.6);
        groups.nozzle.rotation.x = n * 1.5;
        groups.fanDoor.rotation.x = st.door * 1.15;
        groups.auxL.rotation.z = -st.door * 0.9;
        groups.auxR.rotation.z = st.door * 0.9;
      }
      // Stores used up.
      for (const [k, list] of Object.entries(stores)) {
        const n = s.stores?.[k];
        if (Number.isFinite(n)) for (let i = 0; i < list.length; i++) list[i].visible = i < n;
      }
      // The taildragger sits tail down, until the tail flies on the takeoff roll.
      if (sitDef) {
        const want = s.onGround ? sitDef.angle * Math.max(0, Math.min(1, 1 - (s.speed - s.stall * 0.35) / (s.stall * 0.45))) : 0;
        sit += (want - sit) * Math.min(1, dt * 3);
        applySit();
      }
    },
    dispose() {
      for (const o of own) o.dispose?.();
      hullMat.dispose();
    },
  };
  model.setGear(1);
  return model;
}

// The tail-down sit's angle at rest (radians; 0 for a nose-wheel aircraft).
export function planeSit(type) {
  return BUILD[type] && type === "p51" ? 0.19 : 0;
}
