// Gadgets (Round 12): vanilla's hoppers, droppers, dispensers, observers,
// tripwire hooks and tripwire, item frames, armor stands, the flower pot's
// missing plants, bamboo (and the bamboo jungle's: js/terrain.js) and
// scaffolding. Ids: blocks 2944-3071 (ids.js). What a content module may
// export, and its rules (imports only ./base.js and other content modules'
// id constants): see ./index.js.
//
// Here: the blocks, their shapes, placing and right clicks, the textures and
// the recipes, all as vanilla's. What they do at run time is elsewhere:
//   - the power side (an observer's pulse, a hook's line, a dropper's or
//     dispenser's firing, a hopper locked by power) is js/redstone-sim.js,
//     what each id is for it js/content/redstone.js;
//   - what hoppers, droppers and dispensers hold, the items they move and
//     throw, an item frame's item and an armor stand's armor (and their
//     screens' contents, saves and online part) are js/gadgets.js, reached
//     through LIB.gadgets (null until the game has made it);
//   - bamboo grows here (random ticks), scaffolding's distance is
//     js/gadgets.js's (it needs the block updates around it).
import { BLOCK, ITEM, RENDER, FACE, LIB } from "./base.js";
import * as I from "./ids.js";
import { FLOWER_POT } from "./decor.js";

const S = 1 / 16;

// ---------- Directions ----------

// FACE order: +X, -X, +Y, -Y, +Z, -Z.
const DX = [1, -1, 0, 0, 0, 0];
const DY = [0, 0, 1, -1, 0, 0];
const DZ = [0, 0, 0, 0, 1, -1];
const OPP = [1, 0, 3, 2, 5, 4];
// building.js's four facings (0 +Z, 1 -Z, 2 +X, 3 -X): offsets and FACE.
const FX = [0, 0, 1, -1];
const FZ = [1, -1, 0, 0];
const F4 = [FACE.PZ, FACE.NZ, FACE.PX, FACE.NX];

const facingOf = (dx, dz) => (Math.abs(dx) >= Math.abs(dz) ? (dx >= 0 ? 2 : 3) : dz >= 0 ? 0 : 1);
function face6(dx, dy, dz) {
  const ax = Math.abs(dx);
  const ay = Math.abs(dy);
  const az = Math.abs(dz);
  if (ay >= ax && ay >= az) return dy >= 0 ? FACE.PY : FACE.NY;
  return ax >= az ? (dx >= 0 ? FACE.PX : FACE.NX) : dz >= 0 ? FACE.PZ : FACE.NZ;
}
const bit = (f) => 1 << f;
const ALL = 63;
const tileOf = (id, face) => LIB.FACE_TILES[id * 6 + face];
// A box along a facing: d0-d1 from the back to the front, a0-a1 across.
function alongBox(f, d0, d1, a0 = 0, a1 = 1) {
  const axis = f >> 1;
  const b = [a0, a0, a0, a1, a1, a1];
  b[axis] = f & 1 ? 1 - d1 : d0;
  b[axis + 3] = f & 1 ? 1 - d0 : d1;
  return b;
}
const px = (b) => b.map((v) => v * S);

// ---------- What each id is ----------

export const isHopper = (id) => id >= I.HOPPER && id < I.HOPPER + 5;
export const isDropper = (id) => id >= I.DROPPER && id < I.DROPPER + 6;
export const isDispenser = (id) => id >= I.DISPENSER && id < I.DISPENSER + 6;
export const isObserver = (id) => id >= I.OBSERVER && id < I.OBSERVER + 12;
export const isHook = (id) => id >= I.TRIPWIRE_HOOK && id < I.TRIPWIRE_HOOK + 16;
export const isString = (id) => id === I.TRIPWIRE || id === I.TRIPWIRE + 1;
export const isFrame = (id) => id >= I.ITEM_FRAME && id < I.ITEM_FRAME + 6;
export const isStand = (id) => id >= I.ARMOR_STAND && id < I.ARMOR_STAND + 8;
export const isStandPart = (id) => isStand(id) || id === I.ARMOR_STAND_TOP;
export const isBamboo = (id) => id >= I.BAMBOO && id < I.BAMBOO + 6;
export const isScaffolding = (id) => id >= I.SCAFFOLDING && id < I.SCAFFOLDING + 7;
// The containers of this module (js/gadgets.js keeps what they hold): their slots.
export function boxSlots(id) {
  if (isHopper(id)) return 5;
  return isDropper(id) || isDispenser(id) ? 9 : 0;
}
export const boxKind = (id) => (isHopper(id) ? "hopper" : isDropper(id) ? "dropper" : isDispenser(id) ? "dispenser" : null);
// The FACE a hopper passes its items to (down or a side).
export const hopperOut = (id) => (id === I.HOPPER ? FACE.NY : F4[id - I.HOPPER - 1]);
// The FACE a dropper or dispenser throws to.
export const dispenserFace = (id) => (isDropper(id) ? id - I.DROPPER : id - I.DISPENSER);
// An item frame's facing (the way it looks, FACE order).
export const frameFace = (id) => id - I.ITEM_FRAME;
// An armor stand's turn (radians from +Z toward +X).
export const standAngle = (id) => ((id - I.ARMOR_STAND) * Math.PI) / 4;
// Bamboo: its leaves (0-2) and whether it is thick.
export const bambooLeaves = (id) => (id - I.BAMBOO) % 3;
export const bambooThick = (id) => id - I.BAMBOO >= 3;
export const bambooId = (leaves, thick) => I.BAMBOO + leaves + (thick ? 3 : 0);
export const scaffoldDistance = (id) => id - I.SCAFFOLDING;
export const SCAFFOLD_MAX = 7; // (vanilla: at 7 from its support it falls)

// What bamboo and its shoot grow on (vanilla's bamboo_plantable_on).
let SOIL = null;
export function bambooSoil(id) {
  SOIL ||= new Set([BLOCK.GRASS, BLOCK.DIRT, BLOCK.SAND, BLOCK.GRAVEL, I.PODZOL, I.COARSE_DIRT, I.MYCELIUM, I.RED_SAND, I.ROOTED_DIRT, I.MOSS_BLOCK, I.MUD].filter((b) => Number.isInteger(b)));
  return SOIL.has(id);
}
const bambooSupport = (below) => bambooSoil(below) || isBamboo(below) || below === I.BAMBOO_SAPLING;

// ---------- Shapes (meshed the same on the main thread and in the workers) ----------

// One layer on all six faces, and six given, cached.
const LAYERS = new Map();
function tiles6(a, b = a, c = a, d = a, e = a, f = a) {
  const k = `${a},${b},${c},${d},${e},${f}`;
  let t = LAYERS.get(k);
  if (!t) LAYERS.set(k, (t = Uint16Array.of(a, b, c, d, e, f)));
  return t;
}

// The hopper: its bowl (a rim 2/16 thick round a floor at 10/16), the
// middle part and the spout down or to the side.
const HOPPER_RIM = [
  [0, 11, 0, 2, 16, 16, FACE.PX],
  [14, 11, 0, 16, 16, 16, FACE.NX],
  [2, 11, 0, 14, 16, 2, FACE.PZ],
  [2, 11, 14, 14, 16, 16, FACE.NZ],
].map(([a, b, c, d, e, f, inner]) => [...px([a, b, c, d, e, f]), inner]);
const HOPPER_FLOOR = px([0, 10, 0, 16, 11, 16]);
const HOPPER_MID = px([4, 4, 4, 12, 10, 12]);
const SPOUT = [px([6, 0, 6, 10, 4, 10]), px([6, 4, 12, 10, 8, 16]), px([6, 4, 0, 10, 8, 4]), px([12, 4, 6, 16, 8, 10]), px([0, 4, 6, 4, 8, 10])];
function meshHopper(m) {
  const out = tileOf(I.HOPPER, FACE.PX);
  const top = tileOf(I.HOPPER, FACE.PY);
  const inside = tileOf(I.HOPPER, FACE.NY);
  for (const [x0, y0, z0, x1, y1, z1, inner] of HOPPER_RIM) {
    const t = [out, out, top, out, out, out];
    t[inner] = inside;
    m.box(x0, y0, z0, x1, y1, z1, tiles6(...t), bit(FACE.NY), null);
  }
  const f = HOPPER_FLOOR;
  m.box(f[0], f[1], f[2], f[3], f[4], f[5], tiles6(out, out, inside, out, out, out), 0, null);
  const c = HOPPER_MID;
  m.box(c[0], c[1], c[2], c[3], c[4], c[5], tiles6(out), bit(FACE.PY), null);
  const s = SPOUT[m.id - I.HOPPER];
  m.box(s[0], s[1], s[2], s[3], s[4], s[5], tiles6(out), 0, null);
}

// The observer: its face, its back (a red dot while the pulse is on) and
// four plain sides, each face turned with it.
function meshObserver(m) {
  const v = m.id - I.OBSERVER;
  const f = v % 6;
  const side = tileOf(I.OBSERVER, FACE.PX);
  const t = [side, side, side, side, side, side];
  t[f] = tileOf(I.OBSERVER, FACE.NY);
  t[OPP[f]] = tileOf(v >= 6 ? I.OBSERVER + 6 : I.OBSERVER, FACE.PY);
  m.box(0, 0, 0, 1, 1, 1, tiles6(...t), 0, null);
}

// The tripwire hook: a board on the wall, its hook out from the board's
// middle (lower when its string is strung, lower still when pulled) and
// the ring at the hook's end.
const HOOK_BOARD = [];
const HOOK_PARTS = []; // [facing * 4 + state] -> boxes [x0..z1] (the metal)
for (let f = 0; f < 4; f++) {
  const fo = F4[f];
  // (the board: 2/16 out from the wall, 4/16 across, 1/16 to 9/16 up... vanilla's)
  const b = alongBox(fo, 0, 2 * S, 6 * S, 10 * S);
  b[1] = 1 * S;
  b[4] = 9 * S;
  HOOK_BOARD[f] = b;
  for (let st = 0; st < 4; st++) {
    const attached = st & 1;
    const pulled = st & 2;
    const y = (attached ? (pulled ? 3 : 4) : 6) * S;
    const stick = alongBox(fo, 2 * S, 7 * S, 7.5 * S, 8.5 * S);
    stick[1] = y;
    stick[4] = y + S;
    const ring = alongBox(fo, 7 * S, 10 * S, 6.5 * S, 9.5 * S);
    ring[1] = y - S;
    ring[4] = y + 2 * S;
    HOOK_PARTS[f * 4 + st] = [stick, ring];
  }
}
const hookState = (id) => (id - I.TRIPWIRE_HOOK) >> 2;
const hookFacing = (id) => (id - I.TRIPWIRE_HOOK) & 3;
export { hookState, hookFacing };
export const hookId = (f, attached, pulled) => I.TRIPWIRE_HOOK + f + (attached ? 4 : 0) + (pulled ? 8 : 0);
function meshHook(m) {
  const f = hookFacing(m.id);
  const b = HOOK_BOARD[f];
  m.box(b[0], b[1], b[2], b[3], b[4], b[5], null, 0, null);
  const metal = tiles6(tileOf(I.IRON_BLOCK, FACE.PX));
  for (const p of HOOK_PARTS[f * 4 + hookState(m.id)]) m.box(p[0], p[1], p[2], p[3], p[4], p[5], metal, 0, null);
}

// Tripwire: a thread a little above the ground (lower when strung) toward
// the string and the hooks beside it (a hook only along its own line).
const STRING_ARMS = []; // [attached][dir 0 +X,1 -X,2 +Z,3 -Z]
for (let a = 0; a < 2; a++) {
  const y0 = (a ? 1 : 1.5) * S;
  const y1 = y0 + 0.4 * S;
  STRING_ARMS[a] = [
    [0.5, y0, 7.6 * S, 1, y1, 8.4 * S],
    [0, y0, 7.6 * S, 0.5, y1, 8.4 * S],
    [7.6 * S, y0, 0.5, 8.4 * S, y1, 1],
    [7.6 * S, y0, 0, 8.4 * S, y1, 0.5],
  ];
}
const DIR_FACE = [FACE.PX, FACE.NX, FACE.PZ, FACE.NZ];
// Whether the block `n` beside a string (toward FACE d) is one it joins.
export function stringJoins(n, d) {
  if (isString(n)) return true;
  return isHook(n) && F4[hookFacing(n)] === OPP[d];
}
function meshString(m) {
  const arms = STRING_ARMS[m.id - I.TRIPWIRE];
  let mask = 0;
  for (let i = 0; i < 4; i++) if (stringJoins(m.neighbor(DX[DIR_FACE[i]], 0, DZ[DIR_FACE[i]]), DIR_FACE[i])) mask |= 1 << i;
  // (alone or at a line's end: across the cell, along the side it joins)
  if (!(mask & 3) && !(mask & 12)) mask = 15;
  if ((mask & 3) && !(mask & 12)) mask |= 3;
  else if ((mask & 12) && !(mask & 3)) mask |= 12;
  for (let i = 0; i < 4; i++) {
    if (!(mask & (1 << i))) continue;
    const b = arms[i];
    m.box(b[0], b[1], b[2], b[3], b[4], b[5], null, 0, null);
  }
}

// The item frame: a 12/16 board 1/16 thick on its wall (or floor, or
// ceiling). What it holds is drawn by js/gadgets.js.
export const FRAME_BOX = [];
for (let f = 0; f < 6; f++) FRAME_BOX[f] = alongBox(f, 0, S, 2 * S, 14 * S);

// A box turned `a` radians about the cell's vertical axis: [x0, y0, z0, x1,
// y1, z1] in 1/16ths about the cell's middle (x and z from -8 to 8, y from
// the floor), each face a quad with the cell's light, lit as the axis face
// nearest its normal; uv from the box's own size (the texture's corner at
// its low corner), so a stick shows a strip of its tile.
const LOCAL_FACES = [
  { n: [1, 0, 0], c: [[1, 0, 0], [1, 1, 0], [1, 1, 1], [1, 0, 1]], uv: (q) => [q[2], q[1]] },
  { n: [-1, 0, 0], c: [[0, 0, 1], [0, 1, 1], [0, 1, 0], [0, 0, 0]], uv: (q) => [1 - q[2], q[1]] },
  { n: [0, 1, 0], c: [[0, 1, 1], [1, 1, 1], [1, 1, 0], [0, 1, 0]], uv: (q) => [q[0], q[2]] },
  { n: [0, -1, 0], c: [[0, 0, 0], [1, 0, 0], [1, 0, 1], [0, 0, 1]], uv: (q) => [q[0], q[2]] },
  { n: [0, 0, 1], c: [[0, 0, 1], [1, 0, 1], [1, 1, 1], [0, 1, 1]], uv: (q) => [q[0], q[1]] },
  { n: [0, 0, -1], c: [[1, 0, 0], [0, 0, 0], [0, 1, 0], [1, 1, 0]], uv: (q) => [1 - q[0], q[1]] },
];
function turnedBox(a, [x0, y0, z0, x1, y1, z1], skip = 0) {
  const cos = Math.cos(a);
  const sin = Math.sin(a);
  const size = [(x1 - x0) * S, (y1 - y0) * S, (z1 - z0) * S];
  const out = [];
  LOCAL_FACES.forEach((lf, fi) => {
    if (skip & bit(fi)) return;
    const corners = [];
    const uvs = [];
    for (const c of lf.c) {
      const x = (c[0] ? x1 : x0) * S;
      const y = (c[1] ? y1 : y0) * S;
      const z = (c[2] ? z1 : z0) * S;
      // (turned toward +X from +Z: local +Z is the stand's front)
      corners.push([0.5 + x * cos + z * sin, y, 0.5 - x * sin + z * cos]);
      const [u, v] = lf.uv([c[0] * size[0], c[1] * size[1], c[2] * size[2]]);
      uvs.push([u + 0.02, v + 0.02]);
    }
    const [nx, ny, nz] = lf.n;
    out.push({ corners, uvs, face: face6(nx * cos + nz * sin, ny, -nx * sin + nz * cos) });
  });
  return out;
}

// The armor stand (vanilla's, without its arms): a smooth stone base,
// two legs, the hips, two body sticks, the shoulders and the neck, all
// drawn from its lower block (its upper one only takes the room).
const STAND_BASE = [-6, 0, -6, 6, 1, 6];
const STAND_STICKS = [
  [-3, 1, -1, -1, 12, 1],
  [1, 1, -1, 3, 12, 1],
  [-4, 12, -1, 4, 14, 1],
  [-3, 14, -1, -1, 21, 1],
  [1, 14, -1, 3, 21, 1],
  [-6, 21, -1.5, 6, 24, 1.5],
  [-1, 24, -1, 1, 31, 1],
];
const STAND_QUADS = []; // [turn] -> { base, sticks }
for (let r = 0; r < 8; r++) {
  const a = (r * Math.PI) / 4;
  STAND_QUADS[r] = { base: turnedBox(a, STAND_BASE, bit(FACE.NY)), sticks: STAND_STICKS.flatMap((b) => turnedBox(a, b)) };
}
function quads(m, list, tile) {
  for (let i = 0; i < list.length; i++) m.quad(list[i].corners, list[i].uvs, list[i].face, tile);
}
function meshStand(m) {
  const q = STAND_QUADS[m.id - I.ARMOR_STAND];
  quads(m, q.base, m.tile(FACE.PY));
  quads(m, q.sticks, m.tile(FACE.PX));
}

// The flower pot (decor.js's, drawn the same) with this module's plants.
const POT_SOIL = 4 * S;
export const POTTED_PLANTS = [I.DARK_OAK_SAPLING, I.FERN, BLOCK.DEAD_BUSH, I.BAMBOO, I.CRIMSON_FUNGUS, I.WARPED_FUNGUS, I.CRIMSON_ROOTS, I.WARPED_ROOTS];
const POTTED_NAMES = ["Dark Oak Sapling", "Fern", "Dead Bush", "Bamboo", "Crimson Fungus", "Warped Fungus", "Crimson Roots", "Warped Roots"];
export const pottedPlant = (id) => (id >= I.POTTED_MORE && id < I.POTTED_MORE + POTTED_PLANTS.length ? POTTED_PLANTS[id - I.POTTED_MORE] : 0);
const POT_CROSS = [];
for (const [x0, z0, x1, z1] of [[0.18, 0.18, 0.82, 0.82], [0.18, 0.82, 0.82, 0.18]]) {
  POT_CROSS.push({ corners: [[x0, POT_SOIL, z0], [x1, POT_SOIL, z1], [x1, 1, z1], [x0, 1, z0]], uvs: [[0, 0], [1, 0], [1, 1], [0, 1]] });
}
function meshPot(m) {
  const pot = tiles6(tileOf(I.POTTED_MORE, FACE.PX));
  const dirt = tiles6(tileOf(I.POTTED_MORE, FACE.PY));
  m.box(5 * S, 0, 5 * S, 11 * S, POT_SOIL, 11 * S, pot, bit(FACE.PY), null);
  m.box(6 * S, POT_SOIL - 0.001, 6 * S, 10 * S, POT_SOIL, 10 * S, dirt, ALL & ~bit(FACE.PY), null);
  m.box(5 * S, POT_SOIL, 5 * S, 6 * S, 6 * S, 11 * S, pot, bit(FACE.NY), null);
  m.box(10 * S, POT_SOIL, 5 * S, 11 * S, 6 * S, 11 * S, pot, bit(FACE.NY), null);
  m.box(6 * S, POT_SOIL, 5 * S, 10 * S, 6 * S, 6 * S, pot, bit(FACE.NY) | bit(FACE.PX) | bit(FACE.NX), null);
  m.box(6 * S, POT_SOIL, 10 * S, 10 * S, 6 * S, 11 * S, pot, bit(FACE.NY) | bit(FACE.PX) | bit(FACE.NX), null);
  const plant = pottedPlant(m.id);
  if (plant === I.BAMBOO) {
    // (vanilla's potted bamboo: a thin stalk with a few leaves at its top)
    m.box(7 * S, POT_SOIL, 7 * S, 9 * S, POT_SOIL + 12 * S, 9 * S, tiles6(tileOf(I.BAMBOO, FACE.PX)), bit(FACE.NY), null);
    const leaf = tileOf(I.BAMBOO + 1, FACE.PY);
    for (const q of BAMBOO_LEAF_QUADS) m.quad(q.corners.map(([x, y, z]) => [x, y * 0.5 + 0.5, z]), q.uvs, FACE.PY, leaf);
    return;
  }
  const tile = tileOf(plant, FACE.PY);
  for (let i = 0; i < POT_CROSS.length; i++) m.quad(POT_CROSS[i].corners, POT_CROSS[i].uvs, FACE.PY, tile);
}

// Bamboo: a stalk 2/16 across (3/16 when thick) and, near the top, its
// leaves as two crossed cards.
const BAMBOO_LEAF_QUADS = [];
for (const [x0, z0, x1, z1] of [[0, 0, 1, 1], [0, 1, 1, 0]]) {
  BAMBOO_LEAF_QUADS.push({ corners: [[x0, 0, z0], [x1, 0, z1], [x1, 1, z1], [x0, 1, z0]], uvs: [[0, 0], [1, 0], [1, 1], [0, 1]] });
  BAMBOO_LEAF_QUADS.push({ corners: [[x1, 0, z1], [x0, 0, z0], [x0, 1, z0], [x1, 1, z1]], uvs: [[1, 0], [0, 0], [0, 1], [1, 1]] });
}
const STALK = [px([7, 0, 7, 9, 16, 9]), px([6.5, 0, 6.5, 9.5, 16, 9.5])];
function meshBamboo(m) {
  const b = STALK[bambooThick(m.id) ? 1 : 0];
  // (stalk on stalk: no faces between them)
  const skip = (isBamboo(m.neighbor(0, 1, 0)) ? bit(FACE.PY) : 0) | (isBamboo(m.neighbor(0, -1, 0)) || m.neighbor(0, -1, 0) === I.BAMBOO_SAPLING ? bit(FACE.NY) : 0);
  m.box(b[0], b[1], b[2], b[3], b[4], b[5], null, skip, null);
  const leaves = bambooLeaves(m.id);
  if (!leaves) return;
  const tile = tileOf(I.BAMBOO + leaves, FACE.NY);
  for (const q of BAMBOO_LEAF_QUADS) m.quad(q.corners, q.uvs, FACE.PY, tile);
}

// Scaffolding: its frame's faces on all six sides (the tiles hold the gaps).
function meshScaffold(m) {
  m.box(0, 0, 0, 1, 1, 1, null, 0, null);
  // (and seen from inside: the faces again just within, the other way round)
  const e = 0.001;
  const top = tileOf(I.SCAFFOLDING, FACE.PY);
  const side = tileOf(I.SCAFFOLDING, FACE.PX);
  for (let f = 0; f < 6; f++) {
    if (isScaffolding(m.neighbor(DX[f], DY[f], DZ[f]))) continue;
    const q = INNER_FACES[f];
    m.quad(q.corners.map((c) => c.map((v) => (v === 0 ? e : v === 1 ? 1 - e : v))), q.uvs, OPP[f], f === FACE.PY || f === FACE.NY ? top : side);
  }
}
// (each face of the cell, wound to be seen from inside)
const INNER_FACES = [
  { corners: [[1, 0, 0], [1, 0, 1], [1, 1, 1], [1, 1, 0]], uvs: [[1, 0], [0, 0], [0, 1], [1, 1]] },
  { corners: [[0, 0, 1], [0, 0, 0], [0, 1, 0], [0, 1, 1]], uvs: [[0, 0], [1, 0], [1, 1], [0, 1]] },
  { corners: [[0, 1, 0], [1, 1, 0], [1, 1, 1], [0, 1, 1]], uvs: [[0, 1], [1, 1], [1, 0], [0, 0]] },
  { corners: [[0, 0, 1], [1, 0, 1], [1, 0, 0], [0, 0, 0]], uvs: [[0, 1], [1, 1], [1, 0], [0, 0]] },
  { corners: [[1, 0, 1], [0, 0, 1], [0, 1, 1], [1, 1, 1]], uvs: [[1, 0], [0, 0], [0, 1], [1, 1]] },
  { corners: [[0, 0, 0], [1, 0, 0], [1, 1, 0], [0, 1, 0]], uvs: [[1, 0], [0, 0], [0, 1], [1, 1]] },
];

export const shapes = {
  gd_hopper: { mesh: meshHopper },
  gd_observer: { mesh: meshObserver },
  gd_hook: { mesh: meshHook },
  gd_string: { mesh: meshString },
  gd_frame: {
    mesh(m) {
      const b = FRAME_BOX[frameFace(m.id)];
      m.box(b[0], b[1], b[2], b[3], b[4], b[5], null, 0, null);
    },
  },
  gd_stand: { mesh: meshStand },
  gd_none: { mesh() {} },
  gd_pot: { mesh: meshPot },
  gd_bamboo: { mesh: meshBamboo },
  gd_scaffold: { mesh: meshScaffold },
};

// ---------- Placing ----------

// A dropper, dispenser or piston faces the player; an observer looks away
// from them (they see its back, as vanilla's).
const facingPlayer = (base) => (ctx) => base + face6(-ctx.forward[0], -ctx.forward[1], -ctx.forward[2]);
// A hopper points into the block whose side was clicked; on a top or a
// bottom (or into tall grass), down.
function placeHopper(ctx) {
  const n = ctx.normal;
  if (!n || n[1] !== 0 || LIB.IS_REPLACEABLE[ctx.id]) return I.HOPPER;
  return I.HOPPER + 1 + facingOf(-n[0], -n[2]);
}
// A tripwire hook goes on a wall's side, pointing out of it.
function placeHook(ctx) {
  const n = ctx.normal;
  if (!n || n[1] !== 0 || LIB.IS_REPLACEABLE[ctx.id] || !LIB.isWallSupportedBy(ctx.id)) return null;
  return I.TRIPWIRE_HOOK + facingOf(n[0], n[2]);
}
// An item frame goes on any face of a solid block, facing out of it.
function placeFrame(ctx) {
  const n = ctx.normal;
  if (!n || LIB.IS_REPLACEABLE[ctx.id] || !LIB.isWallSupportedBy(ctx.id)) return null;
  return I.ITEM_FRAME + face6(n[0], n[1], n[2]);
}
// An armor stand faces the player who places it, turned in eighths (vanilla's
// 45 degrees), with room above it.
function placeStand(ctx) {
  const a = Math.atan2(-ctx.forward[0], -ctx.forward[2]);
  return I.ARMOR_STAND + (((Math.round(a / (Math.PI / 4)) % 8) + 8) % 8);
}
function placeStandTop(ctx, id, x, y, z) {
  const above = ctx.world.getBlock(x, y + 1, z);
  return y + 1 < 128 && LIB.IS_REPLACEABLE[above] ? [x, y + 1, z, I.ARMOR_STAND_TOP] : null;
}
// Bamboo from its item: on bamboo it grows the stalk (thick as the one
// below), on soil it is a shoot.
function placeBamboo(ctx) {
  const [x, y, z] = ctx.place;
  const below = ctx.world.getBlock(x, y - 1, z);
  if (isBamboo(below)) return bambooId(bambooLeaves(below) ? 1 : 0, bambooThick(below));
  if (below === I.BAMBOO_SAPLING) return bambooId(1, false);
  return bambooSoil(below) ? I.BAMBOO_SAPLING : null;
}

// Scaffolding's distance at a cell: 0 on a solid block (or what the
// scaffolding under it has), else one more than the nearest beside it
// (vanilla's ScaffoldingBlock.getDistance); 7 means it can't stand.
export function scaffoldDistanceAt(world, x, y, z) {
  const below = world.getBlock(x, y - 1, z);
  let d = SCAFFOLD_MAX;
  if (isScaffolding(below)) d = scaffoldDistance(below);
  else if (LIB.IS_SOLID[below] && LIB.IS_OPAQUE[below]) return 0;
  for (let i = 0; i < 4; i++) {
    const n = world.getBlock(x + FX[i], y, z + FZ[i]);
    if (isScaffolding(n)) d = Math.min(d, scaffoldDistance(n) + 1);
    if (d === 1) break;
  }
  return d;
}
function placeScaffold(ctx) {
  const [x, y, z] = ctx.place;
  const d = scaffoldDistanceAt(ctx.world, x, y, z);
  return d < SCAFFOLD_MAX ? I.SCAFFOLDING + d : null;
}

// ---------- Defs ----------

export const blocks = {};
export const blockUse = {};
export const itemUse = {};
export const drops = {};
export const randomTick = {};
const flat = { solid: false, opaque: false, skyPass: true };
const MAT_STONE = { hardness: 3.5, blastResistance: 3.5, tool: "pickaxe", minTier: 1, sound: "stone" };
// (A right click opens the container's screen: main.js's onOpenScreen,
// "box"; js/inventory-ui.js shows js/gadgets.js's contents.)
function openBox(ctx) {
  const open = ctx.interaction?.onOpenScreen;
  if (typeof open !== "function") return false;
  ctx.audio?.playClick?.();
  open("box", ctx.x, ctx.y, ctx.z);
  return true;
}

// Hoppers: down or to a side.
const HOPPER_ITEM = [px([0, 10, 0, 16, 16, 16]), px([4, 4, 4, 12, 10, 12]), px([6, 0, 6, 10, 4, 10])];
for (let k = 0; k < 5; k++) {
  const id = I.HOPPER + k;
  const parts = [...HOPPER_RIM.map((b) => b.slice(0, 6)), HOPPER_FLOOR, HOPPER_MID, SPOUT[k]];
  blocks[id] = {
    name: "Hopper",
    // (the outside on the sides, the rim's top, the bowl's inside underneath: the shape picks them)
    faces: { top: "hopper_top", bottom: "hopper_inside", side: "hopper_outside" },
    shape: "gd_hopper",
    opaque: false,
    box: [0, 0, 0, 1, 1, 1],
    collision: parts,
    hardness: 3,
    blastResistance: 4.8,
    tool: "pickaxe",
    minTier: 1,
    sound: "stone",
    ...(k ? { item: I.HOPPER } : { placeAs: placeHopper, itemBoxes: HOPPER_ITEM }),
  };
  blockUse[id] = openBox;
}

// Droppers and dispensers: a stone box with a face.
for (const [base, name, front] of [
  [I.DROPPER, "Dropper", "dropper"],
  [I.DISPENSER, "Dispenser", "dispenser"],
]) {
  for (let f = 0; f < 6; f++) {
    const id = base + f;
    const vertical = f === FACE.PY || f === FACE.NY;
    blocks[id] = {
      name,
      faces: vertical
        ? { top: f === FACE.PY ? `${front}_front_vertical` : "furnace_top", bottom: f === FACE.NY ? `${front}_front_vertical` : "furnace_top", side: "furnace_top" }
        : { top: "furnace_top", bottom: "furnace_top", side: "furnace_side", front: `${front}_front` },
      ...(vertical ? {} : { frontFace: f }),
      ...MAT_STONE,
      ...(f !== FACE.PZ ? { item: base } : { placeAs: facingPlayer(base) }),
    };
    blockUse[id] = openBox;
  }
}
// (The item: the one facing +Z, so its icon shows the face.)

// Observers: the face watches the block in front; the pulse comes out of the back.
for (let v = 0; v < 12; v++) {
  const id = I.OBSERVER + v;
  blocks[id] = {
    name: "Observer",
    // (the face is the bottom tile, the back the top one, the sides the side: the shape turns them)
    faces: { top: v >= 6 ? "observer_back_on" : "observer_back", bottom: "observer_front", side: "observer_side" },
    shape: "gd_observer",
    ...MAT_STONE,
    hardness: 3,
    blastResistance: 3,
    ...(v ? { item: I.OBSERVER } : { placeAs: (ctx) => I.OBSERVER + face6(ctx.forward[0], ctx.forward[1], ctx.forward[2]), itemBoxes: [[0, 0, 0, 1, 1, 1]] }),
  };
}

// Tripwire hooks: on a wall's side; tripwire from string between two of them.
for (let v = 0; v < 16; v++) {
  const id = I.TRIPWIRE_HOOK + v;
  const f = v & 3;
  const b = HOOK_BOARD[f];
  blocks[id] = {
    name: "Tripwire Hook",
    faces: "planks",
    shape: "gd_hook",
    ...flat,
    box: [Math.min(b[0], 0.5), 0, Math.min(b[2], 0.5), Math.max(b[3], 0.5), 10 * S, Math.max(b[5], 0.5)].map((x, i) => (i === 1 ? S : x)),
    support: "wall",
    facing: [FX[f], FZ[f]],
    hardness: 0,
    sound: "wood",
    ...(v
      ? { item: I.TRIPWIRE_HOOK }
      : {
          placeAs: placeHook,
          // (the flat item: the board, the hook and its ring)
          itemSprite: [
            ["planks", 12, 4, 8, 24, 6, 6, 6, 22],
            ["iron_block", 0, 0, 32, 32, 12, 12, 12, 3],
            ["iron_block", 0, 0, 32, 32, 22, 9, 6, 9],
          ],
        }),
  };
  // (fix the box: from the wall out to the ring's end, 1/16 to 10/16 up)
  const bx = alongBox(F4[f], 0, 10 * S, 5 * S, 11 * S);
  bx[1] = S;
  bx[4] = 10 * S;
  blocks[id].box = bx;
}
for (let a = 0; a < 2; a++) {
  blocks[I.TRIPWIRE + a] = {
    name: "Tripwire",
    faces: "tripwire",
    shape: "gd_string",
    render: RENDER.CUTOUT,
    ...flat,
    box: [0, 0, 0, 1, 2.5 * S, 1],
    hardness: 0,
    sound: "cloth",
    item: I.STRING,
    creative: false,
  };
}
// String is placed as tripwire (vanilla's: anywhere, even in the air).
itemUse[I.STRING] = (ctx) => (ctx.interaction?._place && ctx.place ? !!ctx.interaction._place(I.TRIPWIRE) : false);

// Item frames: on any face.
for (let f = 0; f < 6; f++) {
  const id = I.ITEM_FRAME + f;
  const support = f === FACE.PY ? { support: (below) => LIB.isWallSupportedBy(below) } : f === FACE.NY ? { ceiling: (above) => LIB.isWallSupportedBy(above) } : { support: "wall", facing: [DX[f], DZ[f]] };
  blocks[id] = {
    name: "Item Frame",
    faces: "item_frame",
    shape: "gd_frame",
    ...flat,
    box: FRAME_BOX[f],
    ...support,
    hardness: 0,
    sound: "wood",
    ...(f === FACE.PZ ? { placeAs: placeFrame, itemSprite: [["item_frame", 4, 4, 24, 24, 4, 4, 24, 24]] } : { item: I.ITEM_FRAME + FACE.PZ }),
  };
  blockUse[id] = (ctx) => !!LIB.gadgets?.useFrame?.(ctx);
}

// Armor stands: two blocks tall (the lower one drawn whole), facing eight ways.
const STAND_BOX = [3 * S, 0, 3 * S, 13 * S, 1, 13 * S];
for (let r = 0; r < 8; r++) {
  const id = I.ARMOR_STAND + r;
  blocks[id] = {
    name: "Armor Stand",
    faces: { top: "smooth_stone", bottom: "smooth_stone", side: "planks" },
    shape: "gd_stand",
    ...flat,
    box: STAND_BOX,
    support: (below) => LIB.IS_SOLID[below] === 1,
    partner: [0, 1, 0],
    pairs: (other) => other === I.ARMOR_STAND_TOP,
    placeMore: placeStandTop,
    hardness: 0,
    sound: "wood",
    ...(r
      ? { item: I.ARMOR_STAND }
      : {
          placeAs: placeStand,
          // (the flat item: the sticks on the base)
          itemSprite: [
            ["planks", 0, 0, 4, 28, 14, 2, 4, 26],
            ["planks", 0, 0, 20, 4, 6, 8, 20, 3],
            ["planks", 0, 0, 12, 3, 10, 17, 12, 3],
            ["planks", 0, 0, 3, 10, 10, 17, 3, 11],
            ["planks", 0, 0, 3, 10, 19, 17, 3, 11],
            ["smooth_stone", 0, 0, 32, 4, 4, 28, 24, 3],
          ],
        }),
  };
  blockUse[id] = (ctx) => !!LIB.gadgets?.useStand?.(ctx, ctx.x, ctx.y, ctx.z);
}
blocks[I.ARMOR_STAND_TOP] = {
  name: "Armor Stand",
  faces: "planks",
  shape: "gd_none",
  ...flat,
  box: [3 * S, 0, 3 * S, 13 * S, 15 * S, 13 * S],
  partner: [0, -1, 0],
  pairs: isStand,
  hardness: 0,
  sound: "wood",
  item: I.ARMOR_STAND,
  creative: false,
};
blockUse[I.ARMOR_STAND_TOP] = (ctx) => !!LIB.gadgets?.useStand?.(ctx, ctx.x, ctx.y - 1, ctx.z);

// The flower pot's other plants (decor.js has the pot and the first twenty):
// a right click with one of these on an empty pot puts it in, a right click
// on the potted one takes it out, breaking it drops both.
const POT_BOX = [5 * S, 0, 5 * S, 11 * S, 6 * S, 11 * S];
POTTED_PLANTS.forEach((plant, i) => {
  const id = I.POTTED_MORE + i;
  blocks[id] = {
    name: `Potted ${POTTED_NAMES[i]}`,
    faces: { top: "dirt", bottom: "terracotta", side: "terracotta" },
    shape: "gd_pot",
    render: RENDER.CUTOUT,
    opaque: false,
    skyPass: true,
    box: POT_BOX,
    collision: [POT_BOX],
    hardness: 0,
    sound: "stone",
    item: FLOWER_POT,
    creative: false,
  };
  drops[id] = () => [[FLOWER_POT, 1], [plant, 1]];
  blockUse[id] = (ctx) => {
    if (!ctx.world.setBlock(ctx.x, ctx.y, ctx.z, FLOWER_POT)) return false;
    giveBack(ctx, plant);
    ctx.audio?.playPlace?.("plant");
    return true;
  };
  // (the plant in hand on an empty pot; decor.js's pot takes its own twenty first)
  const prev = itemUse[plant];
  itemUse[plant] = (ctx) => {
    if (ctx.id === FLOWER_POT && !ctx.sneaking) {
      if (!ctx.world.setBlock(ctx.x, ctx.y, ctx.z, id)) return false;
      useOne(ctx);
      ctx.audio?.playPlace?.("plant");
      return true;
    }
    return prev ? prev(ctx) : false;
  };
});
// One of the held item used up (not in Creative).
function useOne(ctx) {
  if (!ctx.creative) ctx.inventory?.consumeSelected?.(1);
}
// A plant back to the player (into the hand if it's empty), or thrown out.
function giveBack(ctx, id) {
  if (ctx.creative && ctx.inventory?.countItem?.(id) > 0) return;
  const inv = ctx.inventory;
  if (!inv) return;
  if (!inv.selectedStack) inv.slots[inv.selected] = { id, count: 1 };
  else if (inv.add(id, 1) > 0) ctx.interaction?.throwStack?.({ id, count: 1 });
}

// Bamboo: the shoot, the stalk (thin, then thick; leaves near the top) and
// the block of bamboo; scaffolding from bamboo and string.
blocks[I.BAMBOO_SAPLING] = {
  name: "Bamboo Shoot",
  faces: "bamboo_sapling",
  shape: "cross",
  render: RENDER.CUTOUT,
  ...flat,
  box: [4 * S, 0, 4 * S, 12 * S, 12 * S, 12 * S],
  support: bambooSupport,
  hardness: 1,
  tool: "axe",
  sound: "plant",
  item: I.BAMBOO,
  creative: false,
  flammable: [60, 60],
};
const BAMBOO_BOX = [px([5, 0, 5, 11, 16, 11]), px([3, 0, 3, 13, 16, 13])];
const BAMBOO_COLLISION = [px([6.5, 0, 6.5, 9.5, 16, 9.5])];
for (let v = 0; v < 6; v++) {
  const id = I.BAMBOO + v;
  blocks[id] = {
    name: "Bamboo",
    // (the stalk's tile on every face; the small and the large leaves are
    // the second and third ids' bottom tiles, which no stalk shows)
    faces: { top: "bamboo_stalk", bottom: v % 3 === 2 ? "bamboo_large_leaves" : v % 3 === 1 ? "bamboo_leaves" : "bamboo_stalk", side: "bamboo_stalk" },
    shape: "gd_bamboo",
    render: RENDER.CUTOUT,
    opaque: false,
    skyPass: true,
    box: BAMBOO_BOX[v >= 3 ? 1 : 0],
    collision: BAMBOO_COLLISION,
    support: bambooSupport,
    hardness: 1,
    tool: "axe",
    sound: "wood",
    flammable: [60, 60],
    ...(v
      ? { item: I.BAMBOO }
      : {
          placeAs: placeBamboo,
          itemSprite: [["bamboo_stalk", 13, 0, 6, 32, 13, 0, 6, 32], ["bamboo_large_leaves", 0, 0, 32, 16, 6, 2, 20, 10]],
        }),
  };
}
blocks[I.BAMBOO_BLOCK] = { name: "Block of Bamboo", faces: { top: "bamboo_block_top", bottom: "bamboo_block_top", side: "bamboo_block" }, hardness: 2, tool: "axe", sound: "wood", flammable: [5, 20] };
for (let d = 0; d < 7; d++) {
  const id = I.SCAFFOLDING + d;
  blocks[id] = {
    name: "Scaffolding",
    faces: { top: "scaffolding_top", bottom: "scaffolding_top", side: "scaffolding_side" },
    shape: "gd_scaffold",
    render: RENDER.CUTOUT,
    ...flat,
    climbable: true,
    box: [0, 0, 0, 1, 1, 1],
    hardness: 0,
    sound: "wood",
    flammable: [60, 60],
    ...(d ? { item: I.SCAFFOLDING } : { placeAs: placeScaffold, itemBoxes: [[0, 0, 0, 1, 1, 1]] }),
  };
}
// Scaffolding on scaffolding (vanilla's ScaffoldingBlockItem): a click on a
// side builds the tower up, on the top out the way the player looks (up to
// 7 along); sneaking places it as any block.
itemUse[I.SCAFFOLDING] = (ctx) => {
  if (!isScaffolding(ctx.id ?? -1) || ctx.sneaking || !ctx.normal) return false;
  const w = ctx.world;
  let dx = 0;
  let dy = 1;
  let dz = 0;
  if (ctx.normal[1] > 0) {
    const f = facingOf(ctx.forward[0], ctx.forward[2]);
    [dx, dy, dz] = [FX[f], 0, FZ[f]];
  }
  let x = ctx.x;
  let y = ctx.y;
  let z = ctx.z;
  for (let i = 0; i < SCAFFOLD_MAX; i++) {
    x += dx;
    y += dy;
    z += dz;
    if (y >= 128) return false;
    const b = w.getBlock(x, y, z);
    if (isScaffolding(b)) continue;
    if (!LIB.IS_REPLACEABLE[b]) return false;
    const d = scaffoldDistanceAt(w, x, y, z);
    if (d >= SCAFFOLD_MAX || !w.setBlock(x, y, z, I.SCAFFOLDING + d)) return false;
    ctx.audio?.playPlace?.("wood");
    useOne(ctx);
    return true;
  }
  return false;
};

// ---------- Bamboo growing ----------

// How tall the bamboo at (x, z) grows: 12-16 (vanilla stops each stalk by
// chance from 11 up, and always at 16).
export function bambooMax(x, z) {
  let h = Math.imul(x, 0x27d4eb2d) ^ Math.imul(z, 0x165667b1);
  h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d);
  return 12 + (((h ^ (h >>> 12)) >>> 0) % 5);
}
// The bamboo under the top at (x, y, z), counted (up to 16).
function heightBelow(world, x, y, z) {
  let n = 0;
  while (n < 16 && isBamboo(world.getBlock(x, y - 1 - n, z))) n++;
  return n;
}
// One more block on top of the stalk whose top is (x, y, z): vanilla's
// BambooStalkBlock.growBamboo (the top two leafy and large, the one under
// them small; thick from the third block up). False: it can't.
export function growBamboo(world, x, y, z) {
  const top = world.getBlock(x, y, z);
  if (!isBamboo(top) || world.getBlock(x, y + 1, z) !== BLOCK.AIR || y + 1 >= 128) return false;
  const height = heightBelow(world, x, y, z) + 1;
  if (height >= bambooMax(x, z)) return false;
  const below = world.getBlock(x, y - 1, z);
  const below2 = world.getBlock(x, y - 2, z);
  let leaves = 0;
  const list = [];
  if (!isBamboo(below) || bambooLeaves(below) === 0) leaves = 1;
  else {
    leaves = 2;
    if (isBamboo(below2)) list.push(x, y - 1, z, bambooId(1, bambooThick(below)), x, y - 2, z, bambooId(0, bambooThick(below2)));
  }
  const thick = bambooThick(top) || isBamboo(below2);
  // (the top keeps its leaves: large under the new top, as vanilla's two large ones)
  list.push(x, y, z, bambooId(Math.max(bambooLeaves(top), isBamboo(below) && bambooLeaves(below) ? 2 : 1), bambooThick(top)), x, y + 1, z, bambooId(leaves === 2 ? 2 : leaves, thick));
  return world.setBlocks(list) > 0;
}
// The top of the bamboo stalk through (x, y, z) (or null: none there).
function stalkTop(world, x, y, z) {
  if (!isBamboo(world.getBlock(x, y, z))) return null;
  let ty = y;
  while (ty + 1 < 128 && isBamboo(world.getBlock(x, ty + 1, z))) ty++;
  return ty;
}
// A shoot becomes bamboo: itself a stalk, with a small leafy one on top.
function growShoot(world, x, y, z) {
  if (world.getBlock(x, y + 1, z) !== BLOCK.AIR || y + 1 >= 128) return false;
  return world.setBlocks([x, y, z, bambooId(0, false), x, y + 1, z, bambooId(1, false)]) > 0;
}
// (The light the top gets: vanilla's 9 and over.)
const litEnough = (world, x, y, z) => {
  const l = world.lightAt?.(x, y, z);
  return !l || Math.max(l.sky, l.block) >= 9;
};
// Random ticks (vanilla's: a third of a stalk's top's ticks grow it, and a
// shoot's always).
randomTick[I.BAMBOO_SAPLING] = (world, x, y, z, id, rand) => {
  if (litEnough(world, x, y + 1, z)) growShoot(world, x, y, z);
};
for (let v = 0; v < 6; v++) {
  randomTick[I.BAMBOO + v] = (world, x, y, z, id, rand) => {
    if (rand() < 1 / 3 && world.getBlock(x, y + 1, z) === BLOCK.AIR && litEnough(world, x, y + 1, z)) growBamboo(world, x, y, z);
  };
}
// Bone meal on bamboo or its shoot: one or two more blocks on top (vanilla's).
function boneMealBamboo(ctx) {
  if (ctx.stack?.id !== I.BONE_MEAL) return false;
  const w = ctx.world;
  let grew = false;
  if (ctx.id === I.BAMBOO_SAPLING) grew = growShoot(w, ctx.x, ctx.y, ctx.z);
  else {
    const n = 1 + (Math.random() < 0.5 ? 1 : 0);
    for (let i = 0; i < n; i++) {
      const top = stalkTop(w, ctx.x, ctx.y, ctx.z);
      if (top === null || !growBamboo(w, ctx.x, top, ctx.z)) break;
      grew = true;
    }
  }
  if (!grew) return false;
  ctx.audio?.playPlace?.("plant");
  useOne(ctx);
  return true;
}
blockUse[I.BAMBOO_SAPLING] = boneMealBamboo;
for (let v = 0; v < 6; v++) blockUse[I.BAMBOO + v] = boneMealBamboo;
// (A dispenser's bone meal: js/gadgets.js.)
export function boneMealBambooAt(world, x, y, z) {
  const id = world.getBlock(x, y, z);
  if (id === I.BAMBOO_SAPLING) return growShoot(world, x, y, z);
  const top = stalkTop(world, x, y, z);
  return top !== null && growBamboo(world, x, top, z);
}

// ---------- Recipes (vanilla's) ----------

export const recipes = () => {
  const out = [];
  const shaped = (pattern, key, result, count = 1) => out.push({ type: "shaped", pattern, key, result: [result, count] });
  const fuel = (input, time) => out.push({ type: "fuel", input, time });
  const planks = [BLOCK.PLANKS, I.SPRUCE_PLANKS, I.BIRCH_PLANKS, I.JUNGLE_PLANKS, I.ACACIA_PLANKS, I.DARK_OAK_PLANKS, I.CRIMSON_PLANKS, I.WARPED_PLANKS].filter((p) => LIB.BLOCK_INFO?.[p]);
  shaped(["I I", "ICI", " I "], { I: I.IRON_INGOT, C: BLOCK.CHEST }, I.HOPPER);
  shaped(["CCC", "C C", "CRC"], { C: BLOCK.COBBLESTONE, R: I.REDSTONE }, I.DROPPER);
  shaped(["CCC", "CBC", "CRC"], { C: BLOCK.COBBLESTONE, B: ITEM.BOW, R: I.REDSTONE }, I.DISPENSER + FACE.PZ);
  shaped([" ST", "SDT", " ST"], { S: ITEM.STICK, T: I.STRING, D: I.DROPPER + FACE.PZ }, I.DISPENSER + FACE.PZ);
  shaped(["CCC", "RRQ", "CCC"], { C: BLOCK.COBBLESTONE, R: I.REDSTONE, Q: I.QUARTZ }, I.OBSERVER);
  shaped(["I", "S", "P"], { I: I.IRON_INGOT, S: ITEM.STICK, P: planks }, I.TRIPWIRE_HOOK, 2);
  shaped(["SSS", "SLS", "SSS"], { S: ITEM.STICK, L: I.LEATHER }, I.ITEM_FRAME + FACE.PZ);
  shaped(["SSS", " S ", "SXS"], { S: ITEM.STICK, X: I.SMOOTH_STONE_SLAB }, I.ARMOR_STAND);
  shaped(["B", "B"], { B: I.BAMBOO }, ITEM.STICK);
  shaped(["BBB", "BBB", "BBB"], { B: I.BAMBOO }, I.BAMBOO_BLOCK);
  shaped(["BSB", "B B", "B B"], { B: I.BAMBOO, S: I.STRING }, I.SCAFFOLDING, 6);
  // (vanilla's: bamboo and scaffolding burn 2.5 s, the block 15 s)
  fuel(I.BAMBOO, 2.5);
  fuel(I.SCAFFOLDING, 2.5);
  fuel(I.BAMBOO_BLOCK, 15);
  return out;
};
// (The dropper's and dispenser's items are the ones facing +Z.)
blocks[I.DROPPER + FACE.PZ].name = "Dropper";

// ---------- Textures (21 tiles) ----------

export const tiles = {};
export const tileRelief = {};

// Dark iron, a little blue (the hopper's, vanilla's #3b3b3f-ish).
function ironDark(t, x, y, k = 1) {
  const n = t.fbm(x, y, 8, 2, 5) * 0.55 + t.rand() * 0.45;
  const v = Math.min(255, Math.round((50 + n * 30) * k));
  return [v, v, Math.min(255, v + 6)];
}
tiles.hopper_outside = (t) => {
  t.forEach((x, y) => {
    const edge = Math.min(x, y, 31 - x, 31 - y);
    t.set(x, y, ironDark(t, x, y, edge < 2 ? 0.7 : edge < 3 ? 1.25 : 1));
  });
  // (rivets at the corners)
  for (const [x, y] of [[5, 5], [26, 5], [5, 26], [26, 26]]) {
    t.set(x, y, [118, 118, 124]);
    t.set(x + 1, y + 1, [28, 28, 32]);
  }
};
tiles.hopper_top = (t) => {
  t.forEach((x, y) => {
    const edge = Math.min(x, y, 31 - x, 31 - y);
    t.set(x, y, edge < 4 ? ironDark(t, x, y, edge === 0 ? 0.8 : 1.35) : ironDark(t, x, y, 0.45));
  });
};
tiles.hopper_inside = (t) => {
  t.forEach((x, y) => {
    const grate = x % 6 === 0 || y % 6 === 0;
    t.set(x, y, ironDark(t, x, y, grate ? 0.85 : 0.5));
  });
};
tileRelief.hopper_outside = tileRelief.hopper_top = tileRelief.hopper_inside = [1.4, 0.35, 0.7];

// The dropper's and dispenser's faces: the furnace's stone with a face
// round an opening (the dispenser's a wide round mouth, the dropper's a
// narrow one), or seen from above (vertical: the opening alone).
function stoneFace(t, kit) {
  kit.base("cobblestone", t);
  t.forEach((x, y) => {
    const edge = Math.min(x, y, 31 - x, 31 - y);
    if (edge < 2) t.shade(x, y, 0.72);
  });
}
function mouth(t, cx, cy, r, round) {
  for (let y = 0; y < 32; y++) {
    for (let x = 0; x < 32; x++) {
      const d = round ? Math.hypot(x + 0.5 - cx, y + 0.5 - cy) : Math.max(Math.abs(x + 0.5 - cx), Math.abs(y + 0.5 - cy));
      if (d < r - 1) t.set(x, y, [18 + (y & 1) * 4, 17, 19]);
      else if (d < r) t.set(x, y, [58, 56, 58]);
      else if (d < r + 1.2) t.shade(x, y, 1.25);
    }
  }
}
function eyes(t) {
  for (const ex of [8, 21]) for (let y = 8; y < 11; y++) for (let x = ex; x < ex + 3; x++) t.set(x, y, [24, 23, 25]);
}
tiles.dispenser_front = (t, kit) => {
  stoneFace(t, kit);
  eyes(t);
  mouth(t, 16, 20.5, 6, true);
};
tiles.dispenser_front_vertical = (t, kit) => {
  stoneFace(t, kit);
  mouth(t, 16, 16, 7, true);
};
tiles.dropper_front = (t, kit) => {
  stoneFace(t, kit);
  eyes(t);
  mouth(t, 16, 20.5, 4, false);
};
tiles.dropper_front_vertical = (t, kit) => {
  stoneFace(t, kit);
  mouth(t, 16, 16, 5, false);
};
tileRelief.dispenser_front = tileRelief.dispenser_front_vertical = tileRelief.dropper_front = tileRelief.dropper_front_vertical = [2.2, 0.72, 0.5];

// The observer: a stone face with two dark eyes over a slot, the back with
// its output (a dull dot, red while its pulse is on), plain grilled sides.
function observerStone(t, kit) {
  t.forEach((x, y) => {
    const n = t.fbm(x, y, 6, 3, 2) * 0.6 + t.rand() * 0.4;
    const v = Math.round(92 + n * 34);
    t.set(x, y, [v, v, v + 2]);
    const edge = Math.min(x, y, 31 - x, 31 - y);
    if (edge < 2) t.shade(x, y, 0.62);
  });
}
tiles.observer_front = (t, kit) => {
  observerStone(t, kit);
  for (let y = 9; y < 23; y++) for (let x = 4; x < 28; x++) t.set(x, y, y === 9 || y === 22 ? [52, 52, 54] : [30, 30, 32]);
  // (its two eyes: grey irises)
  for (const ex of [8, 19]) for (let y = 12; y < 18; y++) for (let x = ex; x < ex + 5; x++) t.set(x, y, y < 14 ? [150, 150, 154] : [104, 104, 108]);
  // (the slot it looks through: a row of teeth)
  for (let x = 6; x < 26; x += 3) t.set(x, 20, [80, 80, 84]);
};
const observerBack = (on) => (t, kit) => {
  observerStone(t, kit);
  for (let y = 4; y < 28; y++) for (let x = 4; x < 28; x++) if (Math.min(x - 4, y - 4, 27 - x, 27 - y) < 2) t.shade(x, y, 0.75);
  for (let y = 0; y < 32; y++) {
    for (let x = 0; x < 32; x++) {
      const d = Math.hypot(x + 0.5 - 16, y + 0.5 - 16);
      if (d < 3.2) t.set(x, y, on ? (d < 1.6 ? [255, 120, 96] : [228, 32, 20]) : d < 1.6 ? [86, 36, 32] : [62, 26, 24]);
      else if (d < 4.4) t.set(x, y, [40, 40, 42]);
    }
  }
};
tiles.observer_back = observerBack(false);
tiles.observer_back_on = observerBack(true);
tiles.observer_side = (t, kit) => {
  observerStone(t, kit);
  // (a grille the same whichever way it is turned)
  for (let y = 6; y < 26; y++) for (let x = 6; x < 26; x++) if (((x - 6) % 5 === 0 || (y - 6) % 5 === 0) && x < 26 && y < 26) t.set(x, y, [48, 48, 50]);
};
tileRelief.observer_front = tileRelief.observer_back = tileRelief.observer_back_on = tileRelief.observer_side = [1.8, 0.6, 0.6];

// Tripwire: a pale thread.
tiles.tripwire = (t) => {
  t.forEach((x, y) => {
    const v = 196 + Math.round(t.noise(x, y, 8, 1) * 40 + t.rand() * 12);
    t.set(x, y, [v, v - 4, v - 12]);
  });
};

// The item frame: a birch frame (the 12/16 board's outer 2/16) round leather.
tiles.item_frame = (t) => {
  t.forEach((x, y) => {
    const edge = Math.min(x, y, 31 - x, 31 - y);
    if (edge < 8) {
      const n = t.noise(x, y, 8, 2, 2) * 0.5 + t.rand() * 0.3;
      const k = edge === 4 ? 1.1 : edge === 7 ? 0.78 : 1;
      t.set(x, y, [Math.round((176 + n * 40) * k), Math.round((152 + n * 34) * k), Math.round((104 + n * 26) * k)]);
    } else {
      const n = t.fbm(x, y, 8, 3, 4) * 0.6 + t.rand() * 0.4;
      t.set(x, y, [Math.round(120 + n * 34), Math.round(66 + n * 20), Math.round(38 + n * 14)]);
    }
  });
};
tileRelief.item_frame = [1.2, 0.7, 0.8];

// Bamboo: the stalk (green, a pale ring at each joint), its leaves (a few
// small ones, or a big fan), the shoot, the block of bamboo (stalks side by
// side, their cut ends on top).
const BAMBOO_GREEN = [[78, 126, 34], [94, 146, 40], [112, 164, 48], [132, 180, 60]];
tiles.bamboo_stalk = (t, kit) => {
  t.forEach((x, y) => {
    const col = x % 4;
    const joint = y % 16 === 0 || y % 16 === 1;
    const base = BAMBOO_GREEN[col === 0 ? 0 : col === 3 ? 1 : col === 1 ? 3 : 2];
    const n = 0.9 + t.rand() * 0.16;
    t.set(x, y, joint ? kit.scaleRgb([186, 196, 112], n) : kit.scaleRgb(base, n));
  });
};
function leafFan(t, kit, big) {
  t.forEach((x, y) => t.set(x, y, [0, 0, 0], 0));
  // (leaves from the stalk out and down: long narrow blades)
  const blades = big ? [[16, 6, -11, 9], [16, 6, 11, 9], [16, 10, -9, 15], [16, 10, 10, 16], [16, 3, -5, 1], [16, 3, 6, 0]] : [[16, 12, -8, 17], [16, 12, 8, 18], [16, 16, -5, 22]];
  for (const [x0, y0, dx, dy] of blades) {
    const len = Math.hypot(dx, dy);
    for (let s = 0; s <= len; s += 0.4) {
      const k = s / len;
      const cx = x0 + dx * k;
      const cy = y0 + dy * k * k * 0.6 + dy * k * 0.4;
      const w = (big ? 1.6 : 1.2) * Math.sin(Math.PI * Math.min(1, k * 1.15 + 0.05));
      for (let o = -Math.ceil(w); o <= Math.ceil(w); o++) {
        if (Math.abs(o) > w + 0.2) continue;
        const xx = Math.round(cx + (dy / len) * o * 0.6);
        const yy = Math.round(cy - (dx / len) * o * 0.6);
        if (xx < 0 || xx > 31 || yy < 0 || yy > 31) continue;
        t.set(xx, yy, kit.scaleRgb(BAMBOO_GREEN[o < 0 ? 1 : 2 + (k > 0.6 ? 1 : 0)], 0.92 + t.rand() * 0.14));
      }
    }
  }
}
tiles.bamboo_leaves = (t, kit) => leafFan(t, kit, false);
tiles.bamboo_large_leaves = (t, kit) => leafFan(t, kit, true);
tiles.bamboo_sapling = (t, kit) => {
  t.forEach((x, y) => t.set(x, y, [0, 0, 0], 0));
  // (a short shoot, two leaves at its tip; v runs up: row 31 is the ground)
  for (let y = 18; y < 32; y++) for (let x = 15; x < 17; x++) t.set(x, y, kit.scaleRgb(BAMBOO_GREEN[x === 15 ? 1 : 2], 0.95 + t.rand() * 0.1));
  for (let i = 0; i < 9; i++) {
    t.set(15 - i, 19 - Math.round(i * 0.7), BAMBOO_GREEN[2]);
    t.set(15 - i, 20 - Math.round(i * 0.7), BAMBOO_GREEN[1]);
    t.set(16 + i, 17 - Math.round(i * 0.8), BAMBOO_GREEN[3]);
    t.set(16 + i, 18 - Math.round(i * 0.8), BAMBOO_GREEN[2]);
  }
};
tiles.bamboo_block = (t, kit) => {
  t.forEach((x, y) => {
    const s = x % 8;
    const joint = (y + (x >> 3) * 5) % 16 < 2;
    const base = s === 0 ? [62, 96, 30] : s === 7 ? [84, 126, 38] : s < 3 ? [128, 172, 56] : [108, 156, 46];
    t.set(x, y, kit.scaleRgb(joint ? [170, 182, 96] : base, 0.92 + t.rand() * 0.12));
  });
};
tiles.bamboo_block_top = (t, kit) => {
  t.forEach((x, y) => {
    const cx = (x % 8) - 3.5;
    const cy = (y % 8) - 3.5;
    const d = Math.hypot(cx, cy);
    const c = d > 3.4 ? [70, 102, 32] : d > 2.4 ? [118, 164, 50] : [210, 196, 124];
    t.set(x, y, kit.scaleRgb(c, 0.92 + t.rand() * 0.12));
  });
};
tileRelief.bamboo_block = tileRelief.bamboo_block_top = [1, 0.6, 0.9];

// Scaffolding: bamboo poles round the edge, a cross bar and lashings, open
// between; its top a lattice of slats.
const POLE = [[150, 132, 64], [178, 158, 78], [200, 182, 96]];
tiles.scaffolding_side = (t, kit) => {
  t.forEach((x, y) => {
    const edge = Math.min(x, y, 31 - x, 31 - y);
    const bar = y >= 14 && y <= 17;
    if (edge < 3 || bar) t.set(x, y, kit.scaleRgb(POLE[edge === 0 || y === 14 ? 0 : edge === 2 || y === 17 ? 1 : 2], 0.92 + t.rand() * 0.12));
    else t.set(x, y, [0, 0, 0], 0);
  });
  // (string round the joints)
  for (const [x, y] of [[1, 15], [30, 15], [1, 1], [30, 30]]) for (let k = -1; k <= 1; k++) t.set(x, y + k, [214, 210, 196]);
};
tiles.scaffolding_top = (t, kit) => {
  t.forEach((x, y) => {
    const edge = Math.min(x, y, 31 - x, 31 - y);
    const slat = y % 8 >= 2 && y % 8 <= 5;
    if (edge < 3) t.set(x, y, kit.scaleRgb(POLE[edge === 0 ? 0 : 2], 0.92 + t.rand() * 0.12));
    else if (slat) t.set(x, y, kit.scaleRgb(POLE[y % 8 === 2 ? 2 : 1], 0.9 + t.rand() * 0.14));
    else t.set(x, y, [0, 0, 0], 0);
  });
};
