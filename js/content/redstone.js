// Redstone (Round 11): dust, torches, levers, buttons, pressure plates, lamps,
// repeaters, pistons, TNT and note blocks. Ids: blocks 1856-2047. What a
// content module may export, and its rules (imports only ./base.js and other
// content modules' id constants): see ./index.js.
//
// Here: what each id is (flat tables the simulation reads, the same in the
// mesh workers), the blocks, their shapes, placing and right clicks, the
// textures and the recipes, all as vanilla's (hardness, delays, recipes,
// power 15 falling by one a block along dust). The power itself is
// js/redstone-sim.js (the host's, online): a lever's or button's click here
// only changes the block, and the edit reaches the simulation like any other.
//
// Ids (beside ids.js's): a wire's id is its power (0-15); a standing torch
// lit, unlit; a wall torch facing (0 +Z, 1 -Z, 2 +X, 3 -X, as building.js)
// + 4 when unlit; a lever or button its attachment (0-3 on a wall facing
// that way, 4/5 on a floor along z/x, 6/7 under a ceiling along z/x) + 8
// when on (pressed); a repeater facing + 4 * (delay - 1) + 16 when powered;
// a piston its facing (FACE order: +X, -X, +Y, -Y, +Z, -Z) + 6 when
// extended; a piston head its facing + 6 when sticky; a note block
// NOTE_BLOCK + its pitch (0-24).
import { BLOCK, ITEM, RENDER, SHAPE, FACE, LIB, BLOCK_LIMIT } from "./base.js";
import * as I from "./ids.js";

// (More ids in this module's range, after ids.js's.)
export const NOTE_PITCHES = 25; // NOTE_BLOCK + pitch: 2005-2029
export const TNT_LIT = 2030; // TNT lit on a guest's machine: the host primes it (4 s)
export const TNT_LIT_SHORT = 2031; // TNT a guest's blast reached: the host primes it (0.5-1.5 s)
// (redstone.js blocks: next free 2032)

const S = 1 / 16;

// ---------- Directions ----------

// FACE order: +X, -X, +Y, -Y, +Z, -Z.
export const DX = [1, -1, 0, 0, 0, 0];
export const DY = [0, 0, 1, -1, 0, 0];
export const DZ = [0, 0, 0, 0, 1, -1];
export const OPP = [1, 0, 3, 2, 5, 4];
// The four sides of a wire's link bits (bit i: H4[i]), and back.
export const H4 = [FACE.PX, FACE.NX, FACE.PZ, FACE.NZ];
export const HBIT = [1, 2, 0, 0, 4, 8];
// building.js's four facings (0 +Z, 1 -Z, 2 +X, 3 -X): offsets and FACE.
const FX = [0, 0, 1, -1];
const FZ = [1, -1, 0, 0];
const F4 = [FACE.PZ, FACE.NZ, FACE.PX, FACE.NX];

export function facingOf(dx, dz) {
  return Math.abs(dx) >= Math.abs(dz) ? (dx >= 0 ? 2 : 3) : dz >= 0 ? 0 : 1;
}
// The FACE nearest to a direction.
function face6(dx, dy, dz) {
  const ax = Math.abs(dx);
  const ay = Math.abs(dy);
  const az = Math.abs(dz);
  if (ay >= ax && ay >= az) return dy >= 0 ? FACE.PY : FACE.NY;
  return ax >= az ? (dx >= 0 ? FACE.PX : FACE.NX) : dz >= 0 ? FACE.PZ : FACE.NZ;
}

// ---------- What each id is ----------

export const K = Object.freeze({ WIRE: 1, TORCH: 2, LEVER: 3, BUTTON: 4, PLATE: 5, LAMP: 6, REPEATER: 7, PISTON: 8, HEAD: 9, TNT: 10, NOTE: 11, RBLOCK: 12 });
export const KIND = new Uint8Array(BLOCK_LIMIT);
export const VAR = new Uint8Array(BLOCK_LIMIT); // a wire's power, a repeater's delay, a note block's pitch
export const ON = new Uint8Array(BLOCK_LIMIT); // lit, on, pressed, powered, extended
export const FLIP = new Uint16Array(BLOCK_LIMIT); // the same block with ON the other way
export const ATTACH = new Uint8Array(BLOCK_LIMIT).fill(255); // the FACE toward the block it hangs on
export const FACING = new Uint8Array(BLOCK_LIMIT).fill(255); // a repeater's output, a piston's front
export const WOOD = new Uint8Array(BLOCK_LIMIT); // wooden buttons and plates (items press these plates too)
export const STICKY = new Uint8Array(BLOCK_LIMIT);
export const FUSE = new Uint8Array(BLOCK_LIMIT); // TNT: 1 a block, 2 lit by a guest, 3 reached by a guest's blast

function mark(id, kind, v = 0, on = 0, flip = 0) {
  KIND[id] = kind;
  VAR[id] = v;
  ON[id] = on;
  FLIP[id] = flip;
}
KIND[I.REDSTONE_BLOCK] = K.RBLOCK;

export const pistonId = (sticky, face, ext) => (sticky ? I.STICKY_PISTON : I.PISTON) + face + (ext ? 6 : 0);
export const headId = (sticky, face) => I.PISTON_HEAD + face + (sticky ? 6 : 0);
export const repeaterId = (f, delay, powered) => I.REPEATER + f + 4 * (delay - 1) + (powered ? 16 : 0);

// Redstone conductors: the solid full blocks power passes through (not
// glass, slabs or leaves; nor a block of redstone or a piston, as vanilla).
// Built on first use (BLOCK_INFO is only there once blocks.js has loaded).
let COND = null;
export function conductors() {
  if (COND) return COND;
  COND = new Uint8Array(BLOCK_LIMIT);
  for (let id = 0; id < BLOCK_LIMIT; id++) {
    const b = LIB.BLOCK_INFO[id];
    COND[id] = b && b.solid && b.opaque && !b.liquid && KIND[id] !== K.RBLOCK && KIND[id] !== K.PISTON ? 1 : 0;
  }
  return COND;
}
// Blocks with a whole top face to stand dust, plates and repeaters on (a
// full block, glass, a top slab, an upside-down stair, a piston).
let TOP = null;
function topTable() {
  if (TOP) return TOP;
  TOP = new Uint8Array(BLOCK_LIMIT);
  for (let id = 0; id < BLOCK_LIMIT; id++) {
    const b = LIB.BLOCK_INFO[id];
    if (!b || !b.solid || b.liquid) continue;
    const full = (c) => c[0] <= 0 && c[2] <= 0 && c[3] >= 1 && c[5] >= 1 && c[4] === 1;
    TOP[id] = (b.collision ? b.collision.some(full) : b.shape === SHAPE.CUBE) ? 1 : 0;
  }
  return TOP;
}
const onTop = (below) => topTable()[below] === 1;

// ---------- Dust ----------

// A wire's links, from its neighbours (nb.get(dx, dy, dz)): bit i (side
// H4[i]) a line toward that side, bit 4 + i the line climbing the block
// there. Dust links to dust beside it, a step up (over a conductor, when no
// conductor is on top of it) or a step down, and to the things that give
// power (a repeater only along its line). The mesher and the simulation
// read the same links.
export function wireLinks(nb) {
  const cond = conductors();
  const open = !cond[nb.get(0, 1, 0)];
  let mask = 0;
  for (let i = 0; i < 4; i++) {
    const f = H4[i];
    const n = nb.get(DX[f], 0, DZ[f]);
    if (KIND[n] === K.WIRE || linksTo(n, f)) mask |= 1 << i;
    else if (cond[n]) {
      if (open && KIND[nb.get(DX[f], 1, DZ[f])] === K.WIRE) mask |= 17 << i;
    } else if (KIND[nb.get(DX[f], -1, DZ[f])] === K.WIRE) mask |= 1 << i;
  }
  return mask;
}
function linksTo(n, f) {
  const k = KIND[n];
  if (k === K.TORCH || k === K.LEVER || k === K.BUTTON || k === K.PLATE || k === K.RBLOCK) return true;
  return k === K.REPEATER && FACING[n] >> 1 === f >> 1;
}
// The sides a wire powers (bits as above): its lines (one line runs on
// through the wire); with none, all four (vanilla's lone dust is a cross).
export function wirePoints(mask) {
  const s = mask & 15;
  if (!s) return 15;
  if (s & (s - 1)) return s;
  return s | (s & 5 ? s << 1 : s >> 1);
}

for (let p = 0; p < 16; p++) mark(I.REDSTONE_WIRE + p, K.WIRE, p, p > 0 ? 1 : 0);

// The dust's colour by power, in eight steps: one tile of eight cells, two
// across and four down (16 x 8 pixels: the speckles are painted for it).
const dustLevel = (p) => Math.ceil((p * 7) / 15);
const DUST_UV = [];
for (let p = 0; p < 16; p++) {
  const l = dustLevel(p);
  const u0 = (l & 1) * 0.5;
  const v1 = 1 - (l >> 1) * 0.25;
  DUST_UV[p] = [u0, v1 - 0.25, u0 + 0.5, v1];
}

// ---------- Torches ----------

mark(I.REDSTONE_TORCH, K.TORCH, 0, 1, I.REDSTONE_TORCH + 1);
mark(I.REDSTONE_TORCH + 1, K.TORCH, 0, 0, I.REDSTONE_TORCH);
ATTACH[I.REDSTONE_TORCH] = ATTACH[I.REDSTONE_TORCH + 1] = FACE.NY;
for (let f = 0; f < 4; f++) {
  const lit = I.REDSTONE_WALL_TORCH + f;
  mark(lit, K.TORCH, 0, 1, lit + 4);
  mark(lit + 4, K.TORCH, 0, 0, lit);
  ATTACH[lit] = ATTACH[lit + 4] = OPP[F4[f]];
}

// ---------- Levers and buttons: a thing on a face ----------

// The frame of a thing on a face, by attachment: C the face's centre in the
// cell, N out of the face, U along the thing's length, W across it.
function frameOf(att) {
  if (att < 4) {
    const fx = FX[att];
    const fz = FZ[att];
    return { C: [0.5 - fx / 2, 0.5, 0.5 - fz / 2], N: [fx, 0, fz], U: [0, 1, 0], W: [Math.abs(fz), 0, Math.abs(fx)] };
  }
  const alongX = (att & 1) === 1;
  const ceiling = att >= 6;
  return { C: [0.5, ceiling ? 1 : 0, 0.5], N: [0, ceiling ? -1 : 1, 0], U: alongX ? [1, 0, 0] : [0, 0, 1], W: alongX ? [0, 0, 1] : [1, 0, 0] };
}
const attachFace = (att) => (att < 4 ? OPP[F4[att]] : att >= 6 ? FACE.PY : FACE.NY);
const at = (fr, w, n, u) => [0, 1, 2].map((a) => fr.C[a] + w * fr.W[a] + n * fr.N[a] + u * fr.U[a]);
// The cell box spanned by a box in the frame (w0-w1 across, n0-n1 out, u0-u1 along).
function frameBox(fr, w0, w1, n0, n1, u0, u1) {
  const a = at(fr, w0, n0, u0);
  const b = at(fr, w1, n1, u1);
  return [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.min(a[2], b[2]), Math.max(a[0], b[0]), Math.max(a[1], b[1]), Math.max(a[2], b[2])];
}
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
// Quads of a stick (a box with axes A along it, P and Q across, its foot at
// `base`), for m.quad: counter-clockwise seen from outside, textured from a
// torch tile's 4-pixel stick column starting at u0: the sides from v0 to v1
// along it, the far end (and the near one, if asked) from the rows given.
function stickQuads(base, A, P, Q2, half, len, u0, v0, v1, far, near = null) {
  const c = (p, q, l) => [0, 1, 2].map((k) => base[k] + p * P[k] + q * Q2[k] + l * A[k]);
  const out = [];
  const add = (corners, uvs, normal) => {
    const n = cross(sub(corners[1], corners[0]), sub(corners[2], corners[0]));
    if (dot(n, normal) < 0) {
      corners.reverse();
      uvs.reverse();
    }
    out.push({ corners, uvs, face: face6(normal[0], normal[1], normal[2]) });
  };
  const u1 = u0 + 4 / 32;
  // (the sides toward +P, -P, +Q and -Q)
  for (const [s, onP] of [[1, true], [-1, true], [1, false], [-1, false]]) {
    const corner = (o, l) => (onP ? c(s * half, o, l) : c(o, s * half, l));
    const normal = (onP ? P : Q2).map((k) => k * s);
    add([corner(-half, 0), corner(half, 0), corner(half, len), corner(-half, len)], [[u0, v0], [u1, v0], [u1, v1], [u0, v1]], normal);
  }
  const end = (l, [va, vb], normal) => add([c(-half, -half, l), c(half, -half, l), c(half, half, l), c(-half, half, l)], [[u0, va], [u1, va], [u1, vb], [u0, vb]], normal);
  if (far) end(len, far, A);
  if (near) end(0, near, A.map((k) => -k));
  return out;
}

const LEVER_BASE = []; // id -> the base's box
const LEVER_HANDLE = []; // id -> the handle's quads (tilted 45 degrees: toward -U off, +U on)
const BUTTON_BOX = []; // id -> its box
function attachBoxes() {
  for (let v = 0; v < 16; v++) {
    const att = v & 7;
    const on = v >> 3;
    const fr = frameOf(att);
    const lever = I.LEVER + v;
    mark(lever, K.LEVER, att, on, I.LEVER + (v ^ 8));
    ATTACH[lever] = attachFace(att);
    LEVER_BASE[lever] = frameBox(fr, -3 * S, 3 * S, 0, 3 * S, -4 * S, 4 * S);
    const a = ((on ? 1 : -1) * Math.PI) / 4;
    const A = [0, 1, 2].map((k) => Math.cos(a) * fr.N[k] + Math.sin(a) * fr.U[k]);
    const P = [0, 1, 2].map((k) => -Math.sin(a) * fr.N[k] + Math.cos(a) * fr.U[k]);
    // (pivoting in the base; the stick rows of the torch tile, 15 of them)
    LEVER_HANDLE[lever] = stickQuads(at(fr, 0, S, 0), A, P, fr.W, S, 9 * S, 14 / 32, 0, 15 / 32, [14 / 32, 15 / 32]);
    for (const [base, wood] of [[I.STONE_BUTTON, 0], [I.OAK_BUTTON, 1]]) {
      const id = base + v;
      mark(id, K.BUTTON, att, on, base + (v ^ 8));
      ATTACH[id] = attachFace(att);
      WOOD[id] = wood;
      BUTTON_BOX[id] = frameBox(fr, -3 * S, 3 * S, 0, on ? S : 2 * S, -2 * S, 2 * S);
    }
  }
}
attachBoxes();

// ---------- Plates, lamps, repeaters, pistons, TNT, note blocks ----------

for (const [base, wood] of [[I.STONE_PRESSURE_PLATE, 0], [I.OAK_PRESSURE_PLATE, 1]]) {
  mark(base, K.PLATE, 0, 0, base + 1);
  mark(base + 1, K.PLATE, 0, 1, base);
  WOOD[base] = WOOD[base + 1] = wood;
}
mark(I.REDSTONE_LAMP, K.LAMP, 0, 0, I.REDSTONE_LAMP + 1);
mark(I.REDSTONE_LAMP + 1, K.LAMP, 0, 1, I.REDSTONE_LAMP);
for (let v = 0; v < 32; v++) {
  const id = I.REPEATER + v;
  mark(id, K.REPEATER, ((v >> 2) & 3) + 1, v >> 4, I.REPEATER + (v ^ 16));
  FACING[id] = F4[v & 3];
}
for (const [base, sticky] of [[I.PISTON, 0], [I.STICKY_PISTON, 1]]) {
  for (let v = 0; v < 12; v++) {
    mark(base + v, K.PISTON, 0, v >= 6 ? 1 : 0);
    FACING[base + v] = v % 6;
    STICKY[base + v] = sticky;
  }
}
for (let v = 0; v < 12; v++) {
  mark(I.PISTON_HEAD + v, K.HEAD);
  FACING[I.PISTON_HEAD + v] = v % 6;
  STICKY[I.PISTON_HEAD + v] = v >= 6 ? 1 : 0;
}
for (const [id, fuse] of [[I.TNT, 1], [TNT_LIT, 2], [TNT_LIT_SHORT, 3]]) {
  mark(id, K.TNT);
  FUSE[id] = fuse;
}
for (let p = 0; p < NOTE_PITCHES; p++) mark(I.NOTE_BLOCK + p, K.NOTE, p);

// ---------- Shapes (meshed the same on the main thread and in the workers) ----------

// Neighbour lookups for wireLinks, without allocating: the mesher's `m`.
const NBM = {
  m: null,
  get(dx, dy, dz) {
    return this.m.neighbor(dx, dy, dz);
  },
};
const ALL = 63;
const only = (face) => ALL & ~(1 << face);
const H = 1 / 64; // (dust lies this thin on its block)
const DUST_DOT = [5 * S, 0, 5 * S, 11 * S, H, 11 * S];
const DUST_LINE_X = [0, 0, 5 * S, 1, H, 11 * S];
const DUST_LINE_Z = [5 * S, 0, 0, 11 * S, H, 1];
const DUST_ARM = [
  [11 * S, 0, 5 * S, 1, H, 11 * S],
  [0, 0, 5 * S, 5 * S, H, 11 * S],
  [5 * S, 0, 11 * S, 11 * S, H, 1],
  [5 * S, 0, 0, 11 * S, H, 5 * S],
];
// Up the side of the block beside it: [box, the face shown].
const DUST_CLIMB = [
  [[1 - H, 0, 5 * S, 1, 1, 11 * S], FACE.NX],
  [[0, 0, 5 * S, H, 1, 11 * S], FACE.PX],
  [[5 * S, 0, 1 - H, 11 * S, 1, 1], FACE.NZ],
  [[5 * S, 0, 0, 11 * S, 1, H], FACE.PZ],
];
const TOP_ONLY = only(FACE.PY);
function dust(m, b, uv, skip = TOP_ONLY) {
  m.box(b[0], b[1], b[2], b[3], b[4], b[5], null, skip, uv);
}

// One layer on all six faces (for m.box's tiles), cached.
const LAYERS = new Map();
function layer6(layer) {
  let t = LAYERS.get(layer);
  if (!t) LAYERS.set(layer, (t = new Uint16Array(6).fill(layer)));
  return t;
}
const tileOf = (id, face) => LIB.FACE_TILES[id * 6 + face];

// Redstone torches: the core torch's stick (standing, or leaning out from
// its wall 22.5 degrees), from one tile holding both: lit in the middle
// column, unlit in the one at u 6/32. (Their own shape, so an unlit one
// doesn't glow: m.quad takes the block's emissive flag.)
const TORCH_U = [6 / 32, 14 / 32]; // [lit]
const TORCH_QUADS = []; // [lit]
const WALL_TORCH_QUADS = []; // [facing * 2 + lit]
for (let lit = 0; lit < 2; lit++) {
  TORCH_QUADS[lit] = stickQuads([0.5, 0, 0.5], [0, 1, 0], [1, 0, 0], [0, 0, 1], S, 10 * S, TORCH_U[lit], 0, 20 / 32, [16 / 32, 20 / 32], [0, 4 / 32]);
  const cos = Math.cos(Math.PI / 8);
  const sin = Math.sin(Math.PI / 8);
  for (let f = 0; f < 4; f++) {
    const dx = FX[f];
    const dz = FZ[f];
    const foot = [0.5 - dx * (0.5 - S), 3.5 * S, 0.5 - dz * (0.5 - S)];
    WALL_TORCH_QUADS[f * 2 + lit] = stickQuads(foot, [sin * dx, cos, sin * dz], [cos * dx, -sin, cos * dz], [-dz, 0, dx], S, 10 * S, TORCH_U[lit], 0, 20 / 32, [16 / 32, 20 / 32], [0, 4 / 32]);
  }
}
function quads(m, list, tile) {
  for (let i = 0; i < list.length; i++) m.quad(list[i].corners, list[i].uvs, list[i].face, tile);
}

// Repeaters: a smooth stone slab with a line of dust along it (bright when
// powered) and two little torches: one by the output, one that moves back
// with the delay.
const REPEATER_LINE = []; // [facing] -> the dust's box
const REPEATER_TORCHES = []; // [(facing * 4 + delay - 1) * 2 + lit] -> quads
for (let f = 0; f < 4; f++) {
  const fx = FX[f];
  const fz = FZ[f];
  const h = 2 * S;
  REPEATER_LINE[f] = fx ? [2 * S, h, 7 * S, 14 * S, h + H, 9 * S] : [7 * S, h, 2 * S, 9 * S, h + H, 14 * S];
  for (let d = 1; d <= 4; d++) {
    for (let lit = 0; lit < 2; lit++) {
      const list = [];
      for (const depth of [3 * S, (5 + 2 * d) * S]) {
        const cx = 0.5 + (0.5 - depth) * fx;
        const cz = 0.5 + (0.5 - depth) * fz;
        // (the torch's head and the top of its stick: rows 12-21)
        list.push(...stickQuads([cx, h, cz], [0, 1, 0], [1, 0, 0], [0, 0, 1], S, 5 * S, TORCH_U[lit], 10 / 32, 20 / 32, [19 / 32, 20 / 32]));
      }
      REPEATER_TORCHES[(f * 4 + d - 1) * 2 + lit] = list;
    }
  }
}

// Pistons: every face of the cube by itself, its texture turned the way the
// piston faces: the front (the wooden face, sticky or not), the back, and
// the sides with the wooden band toward the front (the side tile, upside
// down or not, or the turned one, mirrored or not).
const FACE_UV = [
  (c) => [1 - c[2], c[1]],
  (c) => [c[2], c[1]],
  (c) => [c[0], 1 - c[2]],
  (c) => [c[0], c[2]],
  (c) => [c[0], c[1]],
  (c) => [1 - c[0], c[1]],
];
const UV_PLAIN = [0, 0, 1, 1];
const UV_FLIP_V = [0, 1, 1, 0];
const UV_FLIP_U = [1, 0, 0, 1];
const PF_KIND = new Uint8Array(36); // [facing * 6 + face]: 0 front, 1 back, 2 side, 3 turned side
const PF_UV = [];
for (let f = 0; f < 6; f++) {
  for (let fi = 0; fi < 6; fi++) {
    const k = f * 6 + fi;
    if (fi === f || fi === OPP[f]) {
      PF_KIND[k] = fi === f ? 0 : 1;
      PF_UV[k] = UV_PLAIN;
      continue;
    }
    // (where the middle of the face's front edge lands in its uv)
    const p = [0.5, 0.5, 0.5];
    p[fi >> 1] = fi & 1 ? 0 : 1;
    p[f >> 1] = f & 1 ? 0 : 1;
    const [u, v] = FACE_UV[fi](p);
    PF_KIND[k] = Math.abs(v - 0.5) > 0.25 ? 2 : 3;
    PF_UV[k] = v > 0.75 ? UV_PLAIN : v < 0.25 ? UV_FLIP_V : u > 0.75 ? UV_PLAIN : UV_FLIP_U;
  }
}
// A box along a facing: d0-d1 from the back to the front, the cross
// section a0-a1 on both other axes.
function alongBox(f, d0, d1, a0 = 0, a1 = 1) {
  const axis = f >> 1;
  const lo = f & 1 ? 1 - d1 : d0;
  const hi = f & 1 ? 1 - d0 : d1;
  const b = [a0, a0, a0, a1, a1, a1];
  b[axis] = lo;
  b[axis + 3] = hi;
  return b;
}
const PISTON_BASE = []; // [facing]: the extended piston's base, 12/16 deep
const HEAD_PLATE = [];
const HEAD_ROD = []; // (reaching 4/16 back into the base's cell)
const HEAD_ROD_IN = []; // (the rod within the head's cell: its collision)
for (let f = 0; f < 6; f++) {
  PISTON_BASE[f] = alongBox(f, 0, 12 * S);
  HEAD_PLATE[f] = alongBox(f, 12 * S, 1);
  HEAD_ROD[f] = alongBox(f, -4 * S, 12 * S, 6 * S, 10 * S);
  HEAD_ROD_IN[f] = alongBox(f, 0, 12 * S, 6 * S, 10 * S);
}
// The piston's tiles: the head's defs carry the turned side tile (as their
// bottom: a head is never an item, so no icon shows it).
function pistonLayer(kind, sticky) {
  if (kind === 0) return tileOf(headId(sticky, 0), FACE.PY);
  if (kind === 1) return tileOf(I.PISTON, FACE.NY);
  if (kind === 2) return tileOf(I.PISTON_HEAD, FACE.PX);
  return tileOf(I.PISTON_HEAD, FACE.NY);
}
function pistonBox(m, b, f, sticky, kinds = null) {
  for (let fi = 0; fi < 6; fi++) {
    const k = f * 6 + fi;
    const kind = kinds ? kinds[fi === f ? 0 : fi === OPP[f] ? 1 : 2] ?? PF_KIND[k] : PF_KIND[k];
    m.box(b[0], b[1], b[2], b[3], b[4], b[5], layer6(pistonLayer(kind, sticky)), only(fi), PF_UV[k]);
  }
}
const FULL = [0, 0, 0, 1, 1, 1];
const BASE_KINDS = [1, 1, null]; // (the extended base's front: the back's tile, the rod comes out of it)
const PLATE_KINDS = [0, 0, null]; // (the head's plate: the wooden face on both sides)

export const shapes = {
  rs_wire: {
    mesh(m) {
      NBM.m = m;
      const mask = wireLinks(NBM);
      const uv = DUST_UV[VAR[m.id]];
      let arms = mask & 15;
      if (!arms) arms = 15;
      else if (!(arms & (arms - 1))) arms |= arms & 5 ? arms << 1 : arms >> 1;
      if (arms === 3) dust(m, DUST_LINE_X, uv);
      else if (arms === 12) dust(m, DUST_LINE_Z, uv);
      else {
        dust(m, DUST_DOT, uv);
        for (let i = 0; i < 4; i++) if (arms & (1 << i)) dust(m, DUST_ARM[i], uv);
      }
      for (let i = 0; i < 4; i++) if (mask & (16 << i)) dust(m, DUST_CLIMB[i][0], uv, only(DUST_CLIMB[i][1]));
    },
  },
  rs_lever: {
    mesh(m) {
      const b = LEVER_BASE[m.id];
      m.box(b[0], b[1], b[2], b[3], b[4], b[5]);
      quads(m, LEVER_HANDLE[m.id], tileOf(BLOCK.TORCH, FACE.PY));
    },
  },
  rs_button: {
    mesh(m) {
      const b = BUTTON_BOX[m.id];
      m.box(b[0], b[1], b[2], b[3], b[4], b[5]);
    },
  },
  rs_plate: { mesh: (m) => m.box(S, 0, S, 15 * S, ON[m.id] ? S / 2 : S, 15 * S) },
  rs_repeater: {
    mesh(m) {
      const id = m.id;
      const f = (id - I.REPEATER) & 3;
      m.box(0, 0, 0, 1, 2 * S, 1);
      const line = REPEATER_LINE[f];
      m.box(line[0], line[1], line[2], line[3], line[4], line[5], layer6(tileOf(I.REDSTONE_WIRE, FACE.PY)), TOP_ONLY, DUST_UV[ON[id] ? 15 : 0]);
      quads(m, REPEATER_TORCHES[(f * 4 + VAR[id] - 1) * 2 + ON[id]], tileOf(I.REDSTONE_TORCH, FACE.PY));
    },
  },
  rs_torch: { mesh: (m) => quads(m, TORCH_QUADS[ON[m.id]], m.tile(FACE.PY)) },
  rs_wall_torch: { mesh: (m) => quads(m, WALL_TORCH_QUADS[((m.id - I.REDSTONE_WALL_TORCH) & 3) * 2 + ON[m.id]], m.tile(FACE.PY)) },
  rs_piston: {
    mesh(m) {
      const f = FACING[m.id];
      if (ON[m.id]) pistonBox(m, PISTON_BASE[f], f, STICKY[m.id], BASE_KINDS);
      else pistonBox(m, FULL, f, STICKY[m.id]);
    },
  },
  rs_piston_head: {
    mesh(m) {
      const f = FACING[m.id];
      pistonBox(m, HEAD_PLATE[f], f, STICKY[m.id], PLATE_KINDS);
      const r = HEAD_ROD[f];
      const ends = (1 << f) | (1 << OPP[f]);
      m.box(r[0], r[1], r[2], r[3], r[4], r[5], layer6(tileOf(BLOCK.PLANKS, FACE.PX)), ends, null);
    },
  },
};

// ---------- Placing ----------

const look = (ctx) => facingOf(ctx.forward[0], ctx.forward[2]);
// A lever's or button's attachment for a click (see the header), or -1: on
// the face clicked (a wall's side, a floor, a ceiling), along the player's
// view on a floor or ceiling; into tall grass and the like, on the floor.
function attachment(ctx) {
  const n = ctx.normal;
  if (!n) return -1;
  const alongX = Math.abs(ctx.forward[0]) >= Math.abs(ctx.forward[2]);
  if (LIB.IS_REPLACEABLE[ctx.id] || n[1] > 0) return alongX ? 5 : 4;
  if (!LIB.isWallSupportedBy(ctx.id)) return -1;
  if (n[1] < 0) return alongX ? 7 : 6;
  return facingOf(n[0], n[2]);
}
const placeAttached = (base) => (ctx) => {
  const att = attachment(ctx);
  return att < 0 ? null : base + att;
};
// A torch: on top it stands, on a side it hangs on the wall, under a block it doesn't go.
function placeTorch(ctx) {
  const n = ctx.normal;
  if (!n) return null;
  if (LIB.IS_REPLACEABLE[ctx.id] || n[1] > 0) return I.REDSTONE_TORCH;
  if (n[1] < 0 || !LIB.isWallSupportedBy(ctx.id)) return null;
  return I.REDSTONE_WALL_TORCH + facingOf(n[0], n[2]);
}
// A piston faces the player (up or down when looked at from above or below).
const placePiston = (base) => (ctx) => base + face6(-ctx.forward[0], -ctx.forward[1], -ctx.forward[2]);

// ---------- Defs ----------

export const blocks = {};
export const blockUse = {};
export const itemUse = {};
export const drops = {};
const floorSolid = (below) => LIB.isWallSupportedBy(below);
const ceilingSolid = (above) => LIB.isWallSupportedBy(above);
const flat = { solid: false, opaque: false, skyPass: true };

// Dust: placed from the redstone item, on a block with a whole top.
for (let p = 0; p < 16; p++) {
  blocks[I.REDSTONE_WIRE + p] = {
    name: "Redstone Dust",
    faces: "rs_dust",
    shape: "rs_wire",
    ...flat,
    box: [0, 0, 0, 1, S, 1],
    support: onTop,
    hardness: 0,
    sound: "stone",
    item: I.REDSTONE,
    creative: false,
  };
}
itemUse[I.REDSTONE] = (ctx) => (ctx.interaction?._place && ctx.place ? !!ctx.interaction._place(I.REDSTONE_WIRE) : false);

// Redstone torches: light 7 when lit.
const TORCH = { render: RENDER.CUTOUT, ...flat, hardness: 0, sound: "wood" };
const TORCH_ITEM = { itemSprite: [["rs_torch", 14, 10, 4, 22, 14, 10, 4, 22]] }; // (the lit torch alone)
blocks[I.REDSTONE_TORCH] = { name: "Redstone Torch", faces: "rs_torch", shape: "rs_torch", ...TORCH, box: [6 * S, 0, 6 * S, 10 * S, 11 * S, 10 * S], emission: 7, emissive: true, support: "solid", placeAs: placeTorch, ...TORCH_ITEM };
blocks[I.REDSTONE_TORCH + 1] = { name: "Redstone Torch", faces: "rs_torch", shape: "rs_torch", ...TORCH, box: [6 * S, 0, 6 * S, 10 * S, 11 * S, 10 * S], support: "solid", item: I.REDSTONE_TORCH };
for (let f = 0; f < 4; f++) {
  const [dx, dz] = [FX[f], FZ[f]];
  // (the core wall torch's box: from the wall out to the leaning head)
  const a = [dx > 0 ? 0 : dx < 0 ? 11 * S : 5.5 * S, 3 * S, dz > 0 ? 0 : dz < 0 ? 11 * S : 5.5 * S];
  const b = [dx > 0 ? 5 * S : dx < 0 ? 1 : 10.5 * S, 13 * S, dz > 0 ? 5 * S : dz < 0 ? 1 : 10.5 * S];
  const wall = { faces: "rs_torch", shape: "rs_wall_torch", ...TORCH, support: "wall", facing: [dx, dz], box: [...a, ...b], item: I.REDSTONE_TORCH };
  blocks[I.REDSTONE_WALL_TORCH + f] = { name: "Redstone Torch", ...wall, emission: 7, emissive: true };
  blocks[I.REDSTONE_WALL_TORCH + f + 4] = { name: "Redstone Torch", ...wall };
}

// Levers and buttons: on a wall (hung on it like a torch), a floor or a ceiling.
function attachedDefs(base, name, extra, boxOf, placeAs, firstExtra) {
  for (let v = 0; v < 16; v++) {
    const id = base + v;
    const att = v & 7;
    blocks[id] = {
      name,
      ...flat,
      box: boxOf(id),
      hardness: 0.5,
      ...extra,
      ...(att < 4 ? { support: "wall", facing: [FX[att], FZ[att]] } : att < 6 ? { support: floorSolid } : { ceiling: ceilingSolid }),
      ...(v ? { item: base } : { placeAs, ...firstExtra }),
    };
  }
}
const leverBox = (id) => frameBox(frameOf(VAR[id]), -3 * S, 3 * S, 0, 10 * S, -5 * S, 5 * S);
attachedDefs(I.LEVER, "Lever", { faces: "cobblestone", shape: "rs_lever", sound: "stone" }, leverBox, placeAttached(I.LEVER), {
  // (the flat item: a stick on its cobblestone base)
  itemSprite: [
    ["torch", 14, 17, 4, 15, 14, 5, 4, 20],
    ["cobblestone", 4, 8, 16, 6, 8, 23, 16, 6],
  ],
});
const BUTTON_ITEM = { itemBoxes: [[3 * S, 0, 5 * S, 13 * S, 4 * S, 11 * S]] };
attachedDefs(I.STONE_BUTTON, "Stone Button", { faces: "stone", shape: "rs_button", sound: "stone", tool: "pickaxe" }, (id) => BUTTON_BOX[id], placeAttached(I.STONE_BUTTON), BUTTON_ITEM);
attachedDefs(I.OAK_BUTTON, "Oak Button", { faces: "planks", shape: "rs_button", sound: "wood", tool: "axe" }, (id) => BUTTON_BOX[id], placeAttached(I.OAK_BUTTON), BUTTON_ITEM);

// Pressure plates: stone (players and creatures), oak (items too).
for (const [base, name, faces, mat] of [
  [I.STONE_PRESSURE_PLATE, "Stone Pressure Plate", "stone", { sound: "stone", tool: "pickaxe", minTier: 1 }],
  [I.OAK_PRESSURE_PLATE, "Oak Pressure Plate", "planks", { sound: "wood", tool: "axe" }],
]) {
  for (let v = 0; v < 2; v++) {
    blocks[base + v] = {
      name,
      faces,
      shape: "rs_plate",
      ...flat,
      box: [S, 0, S, 15 * S, v ? S / 2 : S, 15 * S],
      support: onTop,
      hardness: 0.5,
      ...mat,
      ...(v ? { item: base } : { itemBoxes: [[S, 0, S, 15 * S, 2 * S, 15 * S]] }),
    };
  }
}

// The redstone lamp: light 15 when powered.
blocks[I.REDSTONE_LAMP] = { name: "Redstone Lamp", faces: "rs_lamp_off", hardness: 0.3, sound: "glass" };
blocks[I.REDSTONE_LAMP + 1] = { name: "Redstone Lamp", faces: "rs_lamp_on", hardness: 0.3, sound: "glass", emission: 15, emissive: true, item: I.REDSTONE_LAMP };

// Repeaters: a slab with two torches; a right click sets the delay (1-4 ticks).
// (The flat item: the slab seen from the side, its torches on it.)
const REPEATER_ITEM = [
  ["smooth_stone", 0, 0, 32, 32, 2, 21, 28, 7],
  ["rs_torch", 6, 10, 4, 14, 8, 8, 4, 14],
  ["rs_torch", 6, 10, 4, 14, 20, 10, 4, 12],
];
for (let v = 0; v < 32; v++) {
  const id = I.REPEATER + v;
  const box = [0, 0, 0, 1, 2 * S, 1];
  blocks[id] = {
    name: "Redstone Repeater",
    faces: "smooth_stone",
    shape: "rs_repeater",
    opaque: false,
    skyPass: true,
    emissive: v >= 16,
    box,
    collision: [box],
    support: onTop,
    hardness: 0,
    sound: "stone",
    ...(v ? { item: I.REPEATER } : { placeAs: (ctx) => I.REPEATER + look(ctx), itemSprite: REPEATER_ITEM }),
  };
  blockUse[id] = (ctx) => {
    const d = VAR[ctx.id] % 4;
    if (!ctx.world.setBlock(ctx.x, ctx.y, ctx.z, repeaterId(v & 3, d + 1, ON[ctx.id]))) return false;
    LIB.redstoneSim?.click?.(ctx.x, ctx.y, ctx.z, d === 0);
    return true;
  };
}

// Pistons and sticky pistons; the head of an extended one in front of it.
// The base and its head go together (a `partner`: breaking either takes both
// and drops one piston).
const MAT_PISTON = { hardness: 1.5, tool: "pickaxe", sound: "stone" };
for (const [base, name, top, sticky] of [[I.PISTON, "Piston", "piston_top", 0], [I.STICKY_PISTON, "Sticky Piston", "piston_top_sticky", 1]]) {
  for (let v = 0; v < 12; v++) {
    const id = base + v;
    const f = v % 6;
    const ext = v >= 6;
    const box = ext ? PISTON_BASE[f] : [0, 0, 0, 1, 1, 1];
    blocks[id] = {
      name,
      faces: { top, bottom: "piston_bottom", side: "piston_side" },
      shape: "rs_piston",
      // (a full cube while in: hides its neighbours' faces and blocks light like one)
      opaque: !ext,
      box,
      collision: [box],
      ...MAT_PISTON,
      ...(ext ? { partner: [DX[f], DY[f], DZ[f]], pairs: (other) => KIND[other] === K.HEAD && FACING[other] === f && STICKY[other] === sticky } : {}),
      ...(v ? { item: base } : { placeAs: placePiston(base), itemBoxes: [[0, 0, 0, 1, 1, 1]] }),
    };
  }
}
for (let v = 0; v < 12; v++) {
  const id = I.PISTON_HEAD + v;
  const f = v % 6;
  const sticky = v >= 6 ? 1 : 0;
  blocks[id] = {
    name: sticky ? "Sticky Piston" : "Piston",
    faces: { top: sticky ? "piston_top_sticky" : "piston_top", bottom: "piston_side_turned", side: "piston_side" },
    shape: "rs_piston_head",
    opaque: false,
    box: HEAD_PLATE[f],
    collision: [HEAD_PLATE[f], HEAD_ROD_IN[f]],
    ...MAT_PISTON,
    partner: [-DX[f], -DY[f], -DZ[f]],
    pairs: (other) => KIND[other] === K.PISTON && ON[other] === 1 && FACING[other] === f && STICKY[other] === sticky,
    item: sticky ? I.STICKY_PISTON : I.PISTON,
    creative: false,
  };
}

// TNT: fire never burns it away, it goes off (js/redstone-sim.js); so do
// the two ids a guest leaves for the host to prime.
const TNT_FACES = { top: "tnt_top", bottom: "tnt_top", side: "tnt_side" };
blocks[I.TNT] = { name: "TNT", faces: TNT_FACES, hardness: 0, sound: "grass", flammable: [15, 0] };
for (const id of [TNT_LIT, TNT_LIT_SHORT]) blocks[id] = { name: "TNT", faces: TNT_FACES, hardness: 0, sound: "grass", flammable: [15, 0], item: I.TNT, creative: false };
// Flint and steel (js/content/items-vanilla.js) lights TNT through this.
LIB.igniteTnt = (world, x, y, z) => {
  if (KIND[world.getBlock(x, y, z)] !== K.TNT) return false;
  const sim = LIB.redstoneSim;
  if (sim?.enabled()) return sim.prime(x, y, z, 4);
  return world.setBlock(x, y, z, TNT_LIT);
};

// Note blocks: a right click raises the pitch a semitone (two octaves round) and plays it.
for (let p = 0; p < NOTE_PITCHES; p++) {
  const id = I.NOTE_BLOCK + p;
  blocks[id] = { name: "Note Block", faces: "note_block", hardness: 0.8, tool: "axe", sound: "wood", ...(p ? { item: I.NOTE_BLOCK } : {}) };
  blockUse[id] = (ctx) => {
    const next = I.NOTE_BLOCK + ((p + 1) % NOTE_PITCHES);
    if (!ctx.world.setBlock(ctx.x, ctx.y, ctx.z, next)) return false;
    LIB.redstoneSim?.playNote?.(ctx.x, ctx.y, ctx.z, next);
    return true;
  };
}

// Right clicks: a lever flips, a button goes in (the simulation lets it out).
for (let v = 0; v < 16; v++) {
  blockUse[I.LEVER + v] = (ctx) => {
    if (!ctx.world.setBlock(ctx.x, ctx.y, ctx.z, FLIP[ctx.id])) return false;
    LIB.redstoneSim?.click?.(ctx.x, ctx.y, ctx.z, !ON[ctx.id]);
    return true;
  };
  for (const base of [I.STONE_BUTTON, I.OAK_BUTTON]) {
    blockUse[base + v] = (ctx) => {
      if (ON[ctx.id]) return true;
      if (!ctx.world.setBlock(ctx.x, ctx.y, ctx.z, FLIP[ctx.id])) return false;
      LIB.redstoneSim?.click?.(ctx.x, ctx.y, ctx.z, true);
      return true;
    };
  }
}

// ---------- Recipes (vanilla's) ----------

export const recipes = () => {
  const out = [];
  const shaped = (pattern, key, result, count = 1) => out.push({ type: "shaped", pattern, key, result: [result, count] });
  const shapeless = (ingredients, result, count = 1) => out.push({ type: "shapeless", ingredients, result: [result, count] });
  const fuel = (input, time) => out.push({ type: "fuel", input, time });
  const planks = [BLOCK.PLANKS, I.SPRUCE_PLANKS, I.BIRCH_PLANKS, I.JUNGLE_PLANKS, I.ACACIA_PLANKS, I.DARK_OAK_PLANKS];
  shaped(["R", "S"], { R: I.REDSTONE, S: ITEM.STICK }, I.REDSTONE_TORCH);
  shaped(["S", "C"], { S: ITEM.STICK, C: BLOCK.COBBLESTONE }, I.LEVER);
  shapeless([BLOCK.STONE], I.STONE_BUTTON);
  shapeless([planks], I.OAK_BUTTON);
  shaped(["##"], { "#": BLOCK.STONE }, I.STONE_PRESSURE_PLATE);
  shaped(["##"], { "#": planks }, I.OAK_PRESSURE_PLATE);
  // (glowstone in the middle, as vanilla, once the game has it; a torch until then)
  const glow = Number.isInteger(I.GLOWSTONE) && LIB.BLOCK_INFO?.[I.GLOWSTONE] ? I.GLOWSTONE : BLOCK.TORCH;
  shaped([" R ", "RGR", " R "], { R: I.REDSTONE, G: glow }, I.REDSTONE_LAMP);
  shaped(["TRT", "SSS"], { T: I.REDSTONE_TORCH, R: I.REDSTONE, S: BLOCK.STONE }, I.REPEATER);
  shaped(["PPP", "CIC", "CRC"], { P: planks, C: BLOCK.COBBLESTONE, I: I.IRON_INGOT, R: I.REDSTONE }, I.PISTON);
  shaped(["S", "P"], { S: I.SLIME_BALL, P: I.PISTON }, I.STICKY_PISTON);
  shaped(["PPP", "PRP", "PPP"], { P: planks, R: I.REDSTONE }, I.NOTE_BLOCK);
  // (TNT's recipe is a core one: js/crafting.js)
  fuel(I.OAK_BUTTON, 5);
  fuel(I.OAK_PRESSURE_PLATE, 15);
  fuel(I.NOTE_BLOCK, 15);
  return out;
};

// ---------- Textures (12 tiles) ----------

export const tiles = {};
export const tileRelief = {};

// Vanilla's dust colour for a power (0-15), 0-255.
export function dustColor(p) {
  const f = p / 15;
  return [Math.round((p ? f * 0.6 + 0.4 : 0.3) * 255), Math.round(Math.max(0, f * f * 0.7 - 0.5) * 255), Math.round(Math.max(0, f * f * 0.6 - 0.7) * 255)];
}
// Dust: the eight power steps, a cell each (16 pixels across, 8 down: the
// mesher stretches a cell over the block, so the speckles are drawn half
// as tall).
tiles.rs_dust = (t, kit) => {
  for (let l = 0; l < 8; l++) {
    const c = dustColor(Math.round((l * 15) / 7));
    const ox = (l & 1) * 16;
    const oy = (l >> 1) * 8;
    for (let y = 0; y < 8; y++) {
      for (let x = 0; x < 16; x++) {
        const n = t.noise(x * 2, y * 4, 8, l) * 0.5 + t.rand() * 0.5;
        const f = n < 0.18 ? 0.62 : 0.8 + n * 0.32;
        t.set(ox + x, oy + y, kit.scaleRgb(c, f).map((v) => Math.min(255, v)));
      }
    }
  }
};
tileRelief.rs_dust = [0.4, 0.8, 0.6];

// The torches: the core torch with a redstone head, glowing (the middle
// column) and dull (the column at x 6).
tiles.rs_torch = (t, kit) => {
  kit.base("torch", t);
  const heads = [
    [[0x5a1410, 0x6e1a14, 0x6e1a14, 0x5a1410], [0x4e100c, 0x641612, 0x641612, 0x4e100c], [0x440e0a, 0x58120e, 0x58120e, 0x440e0a], [0x3a0c08, 0x4a100c, 0x4a100c, 0x3a0c08], [0x5e3a22, 0x6a4428, 0x6a4428, 0x5e3a22]],
    [[0xff4a3a, 0xffb4a0, 0xffb4a0, 0xff4a3a], [0xf02a1a, 0xff7a64, 0xff7a64, 0xf02a1a], [0xd81c10, 0xff4a36, 0xff4a36, 0xd81c10], [0xb8140c, 0xe82a1c, 0xe82a1c, 0xb8140c], [0x8a3a22, 0xa8442a, 0xa8442a, 0x8a3a22]],
  ];
  t.set(15, 11, [0, 0, 0], 0);
  t.set(16, 10, [0, 0, 0], 0);
  for (let y = 17; y < 32; y++) for (let i = 0; i < 4; i++) t.set(6 + i, y, t.get(14 + i, y));
  for (let lit = 0; lit < 2; lit++) {
    const x0 = lit ? 14 : 6;
    for (let r = 0; r < 5; r++) for (let i = 0; i < 4; i++) t.set(x0 + i, 12 + r, kit.hex(heads[lit][r][i]));
  }
  t.set(15, 11, kit.hex(0xff8a74));
  t.set(16, 10, kit.hex(0xffc8b8));
};

// The lamp: a frame round glass panes over a glowing filament, dim or bright.
const paintLamp = (lit) => (t, kit) => {
  const frame = lit ? [0x6a4a26, 0x8a6232, 0xa47a40] : [0x3e2a18, 0x52381e, 0x664626];
  const glow = lit ? [0xc8781c, 0xe8a032, 0xf8c454, 0xffe28a, 0xfff4c8] : [0x3a2410, 0x4e3218, 0x62401e, 0x6e4a24, 0x7a5430];
  const fr = frame.map(kit.hex);
  const gl = glow.map(kit.hex);
  t.forEach((x, y) => {
    const edge = Math.min(x, y, 31 - x, 31 - y);
    if (edge < 2) {
      t.set(x, y, kit.ramp(fr, edge === 0 ? 0.1 : 0.5 + t.rand() * 0.4));
      return;
    }
    // (panes 6 px across with 2 px leading between them)
    const mx = (x - 2) % 7;
    const my = (y - 2) % 7;
    if (mx === 6 || my === 6) {
      t.set(x, y, kit.ramp(fr, 0.3 + t.rand() * 0.3));
      return;
    }
    const v = t.fbm(x, y, 4, 2) * 0.6 + t.rand() * 0.25 + (mx === 0 || my === 0 ? 0.15 : 0);
    t.set(x, y, kit.ramp(gl, v));
  });
};
tiles.rs_lamp_off = paintLamp(false);
tiles.rs_lamp_on = paintLamp(true);
tileRelief.rs_lamp_off = tileRelief.rs_lamp_on = [1, 0.4, 0.8];

// Pistons: the wooden face (with slime for the sticky one), the side (its
// top quarter the head's wooden band), the same turned a quarter (the band
// on the right), and the back.
const paintPistonFace = (sticky) => (t, kit) => {
  kit.base("planks", t);
  const rim = [0x5a5a5e, 0x6a6a6e, 0x7a7a7e].map(kit.hex);
  t.forEach((x, y) => {
    const edge = Math.min(x, y, 31 - x, 31 - y);
    if (edge < 2) t.set(x, y, kit.ramp(rim, t.rand() * 0.6 + (edge ? 0.4 : 0)));
    else if (sticky && edge >= 4) {
      const v = t.fbm(x, y, 4, 3) * 0.7 + t.rand() * 0.2;
      t.set(x, y, kit.ramp([0x4a8a32, 0x5aa03c, 0x6cb84a, 0x84cc5e, 0xa0dc7a].map(kit.hex), v));
    }
  });
};
function paintPistonSide(t, kit) {
  kit.base("planks", t);
  const band = [];
  for (let y = 0; y < 8; y++) for (let x = 0; x < 32; x++) band.push(t.get(x, y));
  kit.base("cobblestone", t);
  // (the stone part a little darker, the band's rows put back over it)
  t.forEach((x, y) => {
    if (y >= 8) t.shade(x, y, 0.82);
  });
  let i = 0;
  for (let y = 0; y < 8; y++) for (let x = 0; x < 32; x++) t.set(x, y, band[i++]);
  for (let x = 0; x < 32; x++) {
    t.set(x, 8, kit.hex(0x3a2a1a));
    t.set(x, 0, kit.hex(0x5a5a5e));
  }
}
tiles.piston_top = paintPistonFace(false);
tiles.piston_top_sticky = paintPistonFace(true);
tiles.piston_side = paintPistonSide;
tiles.piston_side_turned = (t, kit) => {
  paintPistonSide(t, kit);
  const px = [];
  for (let y = 0; y < 32; y++) for (let x = 0; x < 32; x++) px.push(t.get(x, y));
  // (a quarter turn clockwise: the top rows become the right-hand columns)
  for (let y = 0; y < 32; y++) for (let x = 0; x < 32; x++) {
    const p = px[(31 - x) * 32 + y];
    t.set(x, y, [p[0], p[1], p[2]], p[3]);
  }
};
tiles.piston_bottom = (t, kit) => {
  kit.base("cobblestone", t);
  t.forEach((x, y) => {
    const edge = Math.min(x, y, 31 - x, 31 - y);
    t.shade(x, y, edge < 2 ? 0.6 : edge < 10 ? 0.78 : 0.9);
  });
};
tileRelief.piston_side = tileRelief.piston_side_turned = tileRelief.piston_bottom = [1.2, 0.7, 1];

// TNT: red sticks bound by a paper band with "TNT" on it; the top with its fuse.
const TNT_RED = [0x8a160a, 0xa81c0e, 0xc42412, 0xd8301a, 0xe84a2c];
tiles.tnt_side = (t, kit) => {
  const red = TNT_RED.map(kit.hex);
  t.forEach((x, y) => {
    const stick = x % 8;
    t.set(x, y, kit.ramp(red, stick === 0 ? 0.05 : stick === 1 ? 0.3 : 0.45 + t.noise(x, y, 4, 1) * 0.35 + t.rand() * 0.15));
  });
  for (let y = 10; y < 22; y++) {
    for (let x = 0; x < 32; x++) {
      const v = y === 10 || y === 21 ? 0.62 : 0.86 + t.rand() * 0.1;
      t.set(x, y, [v * 240, v * 236, v * 226]);
    }
  }
  // (a 7x7 pixel font: T, N, T)
  const T = ["#######", "   #   ", "   #   ", "   #   ", "   #   ", "   #   ", "   #   "];
  const N = ["#     #", "##    #", "# #   #", "#  #  #", "#   # #", "#    ##", "#     #"];
  [T, N, T].forEach((g, k) => {
    for (let r = 0; r < 7; r++) for (let c = 0; c < 7; c++) if (g[r][c] === "#") t.set(3 + k * 9 + c, 12 + r, kit.hex(0x1a1a1a));
  });
};
tiles.tnt_top = (t, kit) => {
  const red = TNT_RED.map(kit.hex);
  t.forEach((x, y) => {
    const edge = Math.min(x, y, 31 - x, 31 - y);
    if (edge < 3) {
      t.set(x, y, kit.ramp(red, 0.3 + t.rand() * 0.4));
      return;
    }
    const d = Math.hypot(x - 15.5, y - 15.5);
    const v = 0.72 + t.noise(x, y, 6, 2) * 0.16 + t.rand() * 0.06 - (d > 11 ? 0.12 : 0);
    t.set(x, y, [v * 200, v * 190, v * 170]);
    if (d < 2.6) t.set(x, y, kit.hex(d < 1.3 ? 0x141414 : 0x3a3430));
  });
};

// The note block: a dark wooden box with a lighter frame and a speaker grille.
tiles.note_block = (t, kit) => {
  kit.base("planks", t);
  t.forEach((x, y) => {
    const edge = Math.min(x, y, 31 - x, 31 - y);
    if (edge < 2) t.shade(x, y, edge ? 0.72 : 0.55);
    else if (edge >= 6 && ((x + y) & 3) === 0) t.shade(x, y, 0.34);
    else t.shade(x, y, edge >= 5 ? 0.48 : 0.58);
  });
};
tileRelief.note_block = [1, 0.7, 1];
