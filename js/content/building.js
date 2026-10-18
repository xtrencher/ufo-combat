// Building blocks (Round 11): stairs, slabs, fences and gates, walls, doors,
// trapdoors, ladders, panes and bars, beds, wood types, stone variants, colours.
// Ids: blocks 1024-1535. What a content module may export, and its rules (imports only
// ./base.js and other content modules' id constants): see ./index.js.
//
// Vanilla in look, behaviour and recipe (the values are the game's: hardness,
// tools, stack sizes, recipe yields, smelting and fuel times). Where a block's
// look depends on its neighbours (a stair's corners, a fence's arms, a wall's
// post, a pane's arms) the shape reads them when the chunk is meshed, and the
// collision (physics.js, a def's `collide`) reads the same ones, so what you
// see is what you bump into. Facings follow ids.js: 0 +Z, 1 -Z, 2 +X, 3 -X.
//
// Hooks for the other areas: setDoorOpen / setOpen (the redstone part powers
// doors, trapdoors and gates), bedAt and LIB.onBedUse (the survival part's
// sleeping: a right click on a bed calls LIB.onBedUse(ctx) with ctx.bed =
// { foot, head, facing }), `climbable: true` on ladders (player.js climbs
// them), and isDoor / isOpenDoor (mob pathfinding).
import { BLOCK, ITEM, RENDER, FACE, LIB, BLOCK_LIMIT } from "./base.js";
import * as I from "./ids.js";

// (More ids in this module's range, after ids.js's: the doors hinged on the
// right, laid out as the doors' own 16, and the lantern hanging under a block.)
export const OAK_DOOR_RIGHT = 1401;
export const SPRUCE_DOOR_RIGHT = 1417;
export const BIRCH_DOOR_RIGHT = 1433;
export const IRON_DOOR_RIGHT = 1449;
export const LANTERN_HANGING = 1465;
// (building.js blocks: next free 1466)

// ---------- Facings ----------

const FX = [0, 0, 1, -1];
const FZ = [1, -1, 0, 0];
const OPP = [1, 0, 3, 2];
const LEFT = [2, 3, 1, 0]; // (the left hand of someone looking that way)
const RIGHT = [3, 2, 0, 1];
// The face (FACE order) that points along a facing.
const DIR_FACE = [FACE.PZ, FACE.NZ, FACE.PX, FACE.NX];
const bit = (face) => 1 << face;

// The facing nearest to a horizontal direction.
export function facingOf(dx, dz) {
  return Math.abs(dx) >= Math.abs(dz) ? (dx >= 0 ? 2 : 3) : dz >= 0 ? 0 : 1;
}

// ---------- What each id is (flat tables, the same in the workers) ----------

const K = { STAIRS: 1, SLAB: 2, FENCE: 3, GATE: 4, WALL: 5, DOOR: 6, TRAPDOOR: 7, LADDER: 8, PANE: 9, BED: 10, LANTERN: 11, CARPET: 12 };
const KIND = new Uint8Array(BLOCK_LIMIT);
const VAR = new Uint8Array(BLOCK_LIMIT); // the variant: id - the family's first id
const BASE = new Uint16Array(BLOCK_LIMIT); // the family's first id (a door's: the left-hinged one)
const HINGE_RIGHT = new Uint8Array(BLOCK_LIMIT);
const TOP_FULL = new Uint8Array(BLOCK_LIMIT); // a full top face (a top slab, an upside-down stair)
const IRON = new Uint8Array(BLOCK_LIMIT); // doors and trapdoors only redstone opens

function mark(id, kind, base, v) {
  KIND[id] = kind;
  BASE[id] = base;
  VAR[id] = v;
}

export function isDoor(id) {
  return KIND[id] === K.DOOR;
}
export function isOpenDoor(id) {
  return KIND[id] === K.DOOR && (VAR[id] & 4) !== 0;
}
export function isBed(id) {
  return KIND[id] === K.BED;
}

// Blocks a fence, wall or pane connects to, and that hold a door or a
// lantern: solid full cubes (glass too, not leaves). Built on first use
// (BLOCK_INFO is only there once blocks.js has loaded).
let FULL = null;
function fullTable() {
  if (FULL) return FULL;
  FULL = new Uint8Array(BLOCK_LIMIT);
  for (let id = 0; id < BLOCK_LIMIT; id++) {
    const b = LIB.BLOCK_INFO[id];
    FULL[id] = !b ? 1 : b.solid && b.shape === 0 && !b.leaves && !b.liquid ? 1 : 0;
  }
  return FULL;
}
const topSolid = (id) => fullTable()[id] === 1 || TOP_FULL[id] === 1;

// ---------- Boxes ----------

const S = 1 / 16;
// The half of a cell toward a facing, and the quarter toward two: [x0, z0, x1, z1].
const HALF = [
  [0, 0.5, 1, 1],
  [0, 0, 1, 0.5],
  [0.5, 0, 1, 1],
  [0, 0, 0.5, 1],
];
function quarter(a, b) {
  const p = HALF[a];
  const q = HALF[b];
  return [Math.max(p[0], q[0]), Math.max(p[1], q[1]), Math.min(p[2], q[2]), Math.min(p[3], q[3])];
}
// A box along the cell's edge on side f, t thick, from y0 to y1.
function edgeBox(f, t, y0 = 0, y1 = 1) {
  if (f === 0) return [0, y0, 1 - t, 1, y1, 1];
  if (f === 1) return [0, y0, 0, 1, y1, t];
  if (f === 2) return [1 - t, y0, 0, 1, y1, 1];
  return [0, y0, 0, t, y1, 1];
}
// A box given in sixteenths along a gate's width (w), up (y) and across (d):
// w runs along x for a gate facing along z, along z otherwise.
function wyd(alongZ, w0, y0, d0, w1, y1, d1) {
  return alongZ ? [w0 * S, y0 * S, d0 * S, w1 * S, y1 * S, d1 * S] : [d0 * S, y0 * S, w0 * S, d1 * S, y1 * S, w1 * S];
}

// A shape's parts for the mesher: [x0, y0, z0, x1, y1, z1, skip, edge] where
// skip is a face mask always left out, edge a mask of faces on the cell's
// side that are left out too when the neighbour there is of the same kind
// (fence rails meeting, panes in a row).
const part = (b, skip = 0, edge = 0) => [b[0], b[1], b[2], b[3], b[4], b[5], skip, edge];

// ---------- Stairs ----------
// Shapes as vanilla's: 0 straight, 1 outer left, 2 outer right, 3 inner left, 4 inner right.
const STAIR_PARTS = []; // [(top * 5 + shape) * 4 + facing] -> parts (the slab first)
const STAIR_BOXES = []; // the same, as collision boxes
for (let top = 0; top < 2; top++) {
  for (let shape = 0; shape < 5; shape++) {
    for (let f = 0; f < 4; f++) {
      const slab = top ? [0, 0.5, 0, 1, 1, 1] : [0, 0, 0, 1, 0.5, 1];
      const sy0 = top ? 0 : 0.5;
      const sy1 = top ? 0.5 : 1;
      const steps =
        shape === 0 ? [HALF[f]]
        : shape === 1 ? [quarter(f, LEFT[f])]
        : shape === 2 ? [quarter(f, RIGHT[f])]
        : shape === 3 ? [HALF[f], quarter(OPP[f], LEFT[f])]
        : [HALF[f], quarter(OPP[f], RIGHT[f])];
      const boxes = [slab, ...steps.map((q) => [q[0], sy0, q[1], q[2], sy1, q[3]])];
      STAIR_BOXES[(top * 5 + shape) * 4 + f] = boxes;
      // (a step's face on the slab is inside the stair)
      STAIR_PARTS[(top * 5 + shape) * 4 + f] = boxes.map((b, i) => part(b, i === 0 ? 0 : bit(top ? FACE.PY : FACE.NY)));
    }
  }
}
const stairFacing = (id) => VAR[id] & 3;
const stairTop = (id) => VAR[id] >> 2;

// Neighbour lookups for the shapes, without allocating: from the mesher's
// `m` or from the world (physics).
const NB = {
  m: null,
  world: null,
  x: 0,
  y: 0,
  z: 0,
  get(dx, dy, dz) {
    return this.m ? this.m.neighbor(dx, dy, dz) : this.world.getBlock(this.x + dx, this.y + dy, this.z + dz);
  },
};
function nbMesh(m) {
  NB.m = m;
  NB.world = null;
  return NB;
}
function nbWorld(world, x, y, z) {
  NB.m = null;
  NB.world = world;
  NB.x = x;
  NB.y = y;
  NB.z = z;
  return NB;
}

// Vanilla's corner rule: a stair whose tall side meets a stair turned across
// it makes an outer corner, one whose low side does an inner corner.
function stairShape(id, nb) {
  const f = stairFacing(id);
  const top = stairTop(id);
  const front = nb.get(FX[f], 0, FZ[f]);
  if (KIND[front] === K.STAIRS && stairTop(front) === top) {
    const f2 = stairFacing(front);
    if (f2 >> 1 !== f >> 1 && stairDiffers(nb, OPP[f2], f, top)) return f2 === LEFT[f] ? 1 : 2;
  }
  const back = nb.get(-FX[f], 0, -FZ[f]);
  if (KIND[back] === K.STAIRS && stairTop(back) === top) {
    const f3 = stairFacing(back);
    if (f3 >> 1 !== f >> 1 && stairDiffers(nb, f3, f, top)) return f3 === LEFT[f] ? 3 : 4;
  }
  return 0;
}
// (whether the neighbour toward d is anything but a stair like this one)
function stairDiffers(nb, d, f, top) {
  const n = nb.get(FX[d], 0, FZ[d]);
  return KIND[n] !== K.STAIRS || stairFacing(n) !== f || stairTop(n) !== top;
}
const stairIndex = (id, nb) => (stairTop(id) * 5 + stairShape(id, nb)) * 4 + stairFacing(id);

// ---------- Fences, walls, panes: connections ----------

const gateFacing = (id) => VAR[id] & 3;
const gateOpen = (id) => VAR[id] >> 2;
// (a gate joins a fence or wall running along its width)
const gateAcross = (n, d) => KIND[n] === K.GATE && gateFacing(n) >> 1 !== d >> 1;
const fenceJoins = (n, d) => KIND[n] === K.FENCE || gateAcross(n, d) || fullTable()[n] === 1;
// (LIB.joinsPane: the decor part's stained glass panes)
const wallJoins = (n, d) => KIND[n] === K.WALL || KIND[n] === K.PANE || LIB.joinsPane?.(n) || gateAcross(n, d) || fullTable()[n] === 1;
const paneJoins = (n) => KIND[n] === K.PANE || LIB.joinsPane?.(n) || KIND[n] === K.WALL || fullTable()[n] === 1;
// The neighbours joined (bit d: toward facing d).
function joinMask(kind, nb) {
  let mask = 0;
  for (let d = 0; d < 4; d++) {
    const n = nb.get(FX[d], 0, FZ[d]);
    if (kind === K.FENCE ? fenceJoins(n, d) : kind === K.WALL ? wallJoins(n, d) : paneJoins(n)) mask |= 1 << d;
  }
  return mask;
}

// Fence: a post and two rails toward each neighbour joined; collision 1.5 tall.
const FENCE_PARTS = [];
const FENCE_BOXES = [];
const FENCE_POST = [6 * S, 0, 6 * S, 10 * S, 1, 10 * S];
const FENCE_POST_TALL = [6 * S, 0, 6 * S, 10 * S, 1.5, 10 * S];
const ARM_XZ = (d, lo, hi) => (d === 0 ? [lo, 10 * S, hi, 1] : d === 1 ? [lo, 0, hi, 6 * S] : d === 2 ? [10 * S, lo, 1, hi] : [0, lo, 6 * S, hi]);
for (let mask = 0; mask < 16; mask++) {
  const parts = [part(FENCE_POST)];
  const boxes = [FENCE_POST_TALL];
  for (let d = 0; d < 4; d++) {
    if (!(mask & (1 << d))) continue;
    const a = ARM_XZ(d, 7 * S, 9 * S);
    for (const [y0, y1] of [[6 * S, 9 * S], [12 * S, 15 * S]]) parts.push(part([a[0], y0, a[1], a[2], y1, a[3]], bit(DIR_FACE[OPP[d]]), bit(DIR_FACE[d])));
    const c = ARM_XZ(d, 6 * S, 10 * S);
    boxes.push([c[0], 0, c[1], c[2], 1.5, c[3]]);
  }
  FENCE_PARTS[mask] = parts;
  FENCE_BOXES[mask] = boxes;
}

// Wall: a post (unless it runs straight on), arms 14/16 high (to the top
// under a block or wall); collision 1.5 tall.
const WALL_PARTS = []; // [tall * 16 + mask]
const WALL_BOXES = [];
for (let tall = 0; tall < 2; tall++) {
  for (let mask = 0; mask < 16; mask++) {
    const h = tall ? 1 : 14 * S;
    const straight = mask === 3 || mask === 12;
    const parts = [];
    const boxes = [];
    if (straight) {
      const b = mask === 3 ? [5 * S, 0, 0, 11 * S, h, 1] : [0, 0, 5 * S, 1, h, 11 * S];
      parts.push(part(b, 0, mask === 3 ? bit(FACE.PZ) | bit(FACE.NZ) : bit(FACE.PX) | bit(FACE.NX)));
      boxes.push([b[0], 0, b[2], b[3], 1.5, b[5]]);
    } else {
      parts.push(part([4 * S, 0, 4 * S, 12 * S, 1, 12 * S]));
      boxes.push([4 * S, 0, 4 * S, 12 * S, 1.5, 12 * S]);
      for (let d = 0; d < 4; d++) {
        if (!(mask & (1 << d))) continue;
        const a = d === 0 ? [5, 12, 11, 16] : d === 1 ? [5, 0, 11, 4] : d === 2 ? [12, 5, 16, 11] : [0, 5, 4, 11];
        parts.push(part([a[0] * S, 0, a[1] * S, a[2] * S, h, a[3] * S], bit(DIR_FACE[OPP[d]]), bit(DIR_FACE[d])));
        boxes.push([a[0] * S, 0, a[1] * S, a[2] * S, 1.5, a[3] * S]);
      }
    }
    WALL_PARTS[tall * 16 + mask] = parts;
    if (!tall) WALL_BOXES[mask] = boxes;
  }
}
const wallTall = (nb) => {
  const up = nb.get(0, 1, 0);
  return KIND[up] === K.WALL || fullTable()[up] === 1 ? 1 : 0;
};

// Pane (glass pane, iron bars): 2/16 thick, a straight run as one box, the
// arms across it beside it; collision as drawn.
const PANE_PARTS = [];
const PANE_BOXES = [];
for (let mask = 0; mask < 16; mask++) {
  const parts = [];
  const zs = mask & 3;
  const xs = mask & 12;
  const lo = 7 * S;
  const hi = 9 * S;
  const line = (b, skip, edge) => parts.push(part(b, skip, edge));
  if (xs || !zs) {
    // Along x (or the lone post): through the middle.
    const x0 = mask & 8 ? 0 : lo;
    const x1 = mask & 4 ? 1 : hi;
    line([x0, 0, lo, x1, 1, hi], 0, (mask & 4 ? bit(FACE.PX) : 0) | (mask & 8 ? bit(FACE.NX) : 0));
    if (mask & 1) line([lo, 0, hi, hi, 1, 1], bit(FACE.NZ), bit(FACE.PZ));
    if (mask & 2) line([lo, 0, 0, hi, 1, lo], bit(FACE.PZ), bit(FACE.NZ));
  } else {
    line([lo, 0, mask & 2 ? 0 : lo, hi, 1, mask & 1 ? 1 : hi], 0, (mask & 1 ? bit(FACE.PZ) : 0) | (mask & 2 ? bit(FACE.NZ) : 0));
  }
  PANE_PARTS[mask] = parts;
  PANE_BOXES[mask] = parts.map((p) => p.slice(0, 6));
}

// ---------- Gates ----------
// Posts at both ends of the width, two rails and a middle piece; open, the
// two halves swing toward where the gate faces.
const GATE_PARTS = []; // [open * 4 + facing]
for (let open = 0; open < 2; open++) {
  for (let f = 0; f < 4; f++) {
    const z = f < 2; // (facing along z: the width runs along x)
    const parts = [part(wyd(z, 0, 5, 7, 2, 16, 9)), part(wyd(z, 14, 5, 7, 16, 16, 9))];
    if (!open) {
      for (const [y0, y1] of [[6, 9], [12, 15]]) {
        parts.push(part(wyd(z, 2, y0, 7, 6, y1, 9)), part(wyd(z, 10, y0, 7, 14, y1, 9)));
      }
      parts.push(part(wyd(z, 6, 6, 7, 10, 15, 9)));
    } else {
      // (toward +z/+x for facings 0 and 2, else the other way)
      const pos = f === 0 || f === 2;
      const d0 = pos ? 9 : 1;
      const d1 = pos ? 15 : 7;
      const e0 = pos ? 13 : 1;
      const e1 = pos ? 15 : 3;
      for (const [w0, w1] of [[0, 2], [14, 16]]) {
        for (const [y0, y1] of [[6, 9], [12, 15]]) parts.push(part(wyd(z, w0, y0, d0, w1, y1, d1)));
        parts.push(part(wyd(z, w0, 9, e0, w1, 12, e1)));
      }
    }
    GATE_PARTS[open * 4 + f] = parts;
  }
}

// ---------- Doors and trapdoors ----------
// Variant bits: facing (0-3), open (4), upper half / top half (8). A door's
// facing is where its placer looked: closed, it stands on the near edge of
// its cell; open, along its hinge side. A trapdoor's facing points away from
// the block it is hinged on: open, it stands against that side.
const doorFacing = (id) => VAR[id] & 3;
const doorOpen = (id) => (VAR[id] >> 2) & 1;
const doorUpper = (id) => VAR[id] >> 3;
function doorBox(v, right) {
  const f = v & 3;
  if (!((v >> 2) & 1)) return edgeBox(OPP[f], 3 * S);
  return edgeBox(right ? RIGHT[f] : LEFT[f], 3 * S);
}
function trapdoorBox(v) {
  const f = v & 3;
  if ((v >> 2) & 1) return edgeBox(OPP[f], 3 * S);
  return v >> 3 ? [0, 13 * S, 0, 1, 1, 1] : [0, 0, 0, 1, 3 * S, 1];
}

// ---------- Packed tiles ----------
// Small things share a tile, a quadrant each (16 x 16 pixels, vanilla's own
// size), to keep to the texture budget: [u0, v0, u1, v1] of the tile.
const Q_TL = [0, 0.5, 0.5, 1];
const Q_TR = [0.5, 0.5, 1, 1];
const Q_BL = [0, 0, 0.5, 0.5];
const Q_BR = [0.5, 0, 1, 0.5];
// building_parts: the ladder, the lantern, the oak and iron trapdoors.
const UV_LADDER = Q_TL;
const UV_LANTERN = Q_TR;
const UV_LANTERN_LOW = [0.5, 0.5 - 1 / 32, 1, 1 - 1 / 32]; // (a hanging one's sides start 1/16 up: the same rows)
const UV_LANTERN_TOP = [0.5, 0.5 + 5 / 32, 1, 1 + 5 / 32]; // (its top and bottom: the quadrant's upper rows)
const UV_OAK_TRAPDOOR = Q_BL;
const UV_IRON_TRAPDOOR = Q_BR;
// doors_a: oak (left column), spruce (right); doors_b: birch, iron. The upper half on top.
const DOOR_UV = { lower: [Q_BL, Q_BR], upper: [Q_TL, Q_TR] };
// bed: the foot's and head's tops above, their sides below.
const BED_UV = { footTop: Q_TL, headTop: Q_TR, footSide: Q_BL, headSide: Q_BR };

// ---------- Beds ----------
// The foot where it's placed, the head one cell on along its facing. 9/16
// tall on 3/16 legs at the outer corners.
const bedFacing = (id) => VAR[id] & 3;
const bedHead = (id) => VAR[id] >> 2;
const BED_PARTS = []; // [head * 4 + facing]: [box, uv, skip][]
const BED_TOPS = []; // [head * 4 + facing]: { corners, uvs } of the top quad
for (let head = 0; head < 2; head++) {
  for (let f = 0; f < 4; f++) {
    const toward = head ? OPP[f] : f; // (the other half)
    const outer = head ? f : OPP[f]; // (the bed's end in this cell)
    const uv = head ? BED_UV.headSide : BED_UV.footSide;
    const list = [[[0, 3 * S, 0, 1, 9 * S, 1], uv, bit(FACE.PY) | bit(FACE.NY) | bit(DIR_FACE[toward])]];
    list.push([[0, 3 * S, 0, 1, 9 * S, 1], null, ~bit(FACE.NY) & 63]); // (the underside: planks)
    // The legs at the two corners of the outer end.
    for (const side of [LEFT[f], RIGHT[f]]) {
      const q = quarter(outer, side);
      const lx = q[0] === 0 ? 0 : 1 - 3 * S;
      const lz = q[1] === 0 ? 0 : 1 - 3 * S;
      list.push([[lx, 0, lz, lx + 3 * S, 3 * S, lz + 3 * S], uv, bit(FACE.PY)]);
    }
    BED_PARTS[head * 4 + f] = list;
    // The top: the texture's up toward the head, its right to the right of the facing.
    const tuv = head ? BED_UV.headTop : BED_UV.footTop;
    const corners = [[0, 9 * S, 1], [1, 9 * S, 1], [1, 9 * S, 0], [0, 9 * S, 0]];
    const uvs = corners.map(([x, , z]) => {
      const qv = (x - 0.5) * FX[f] + (z - 0.5) * FZ[f] + 0.5;
      const qu = (x - 0.5) * FX[RIGHT[f]] + (z - 0.5) * FZ[RIGHT[f]] + 0.5;
      return [tuv[0] + qu * (tuv[2] - tuv[0]), tuv[1] + qv * (tuv[3] - tuv[1])];
    });
    BED_TOPS[head * 4 + f] = { corners, uvs };
  }
}

// ---------- Lanterns ----------
const LANTERN_CHAIN = []; // the hanging one's chain: two crossed quads
{
  const y0 = 10 * S;
  const r = 1.5 * S;
  for (const [ax, az, bx, bz] of [[0.5 - r, 0.5 - r, 0.5 + r, 0.5 + r], [0.5 - r, 0.5 + r, 0.5 + r, 0.5 - r]]) {
    LANTERN_CHAIN.push({
      corners: [[ax, y0, az], [bx, y0, bz], [bx, 1, bz], [ax, 1, az]],
      uvs: [[17 / 32, 0.5], [19 / 32, 0.5], [19 / 32, 0.5 + 3 / 16], [17 / 32, 0.5 + 3 / 16]],
    });
    // (and its back, so it shows from both sides)
    LANTERN_CHAIN.push({
      corners: [[bx, y0, bz], [ax, y0, az], [ax, 1, az], [bx, 1, bz]],
      uvs: [[19 / 32, 0.5], [17 / 32, 0.5], [17 / 32, 0.5 + 3 / 16], [19 / 32, 0.5 + 3 / 16]],
    });
  }
}
const SIDES = bit(FACE.PX) | bit(FACE.NX) | bit(FACE.PZ) | bit(FACE.NZ);
const ENDS = bit(FACE.PY) | bit(FACE.NY);

// ---------- Shapes (meshed the same on the main thread and in the workers) ----------

function meshParts(m, parts, kind, uv = null, tiles = null) {
  for (let i = 0; i < parts.length; i++) {
    const p = parts[i];
    let skip = p[6];
    if (p[7]) {
      // (a face against a neighbour of the same kind, which carries on there)
      for (let d = 0; d < 4; d++) {
        if (!(p[7] & bit(DIR_FACE[d]))) continue;
        const n = m.neighbor(FX[d], 0, FZ[d]);
        if (KIND[n] === kind || (kind === K.FENCE && KIND[n] === K.GATE)) skip |= bit(DIR_FACE[d]);
      }
    }
    m.box(p[0], p[1], p[2], p[3], p[4], p[5], tiles, skip, uv);
  }
}

export const shapes = {
  stairs: { mesh: (m) => meshParts(m, STAIR_PARTS[stairIndex(m.id, nbMesh(m))], K.STAIRS) },
  slab: { mesh: (m) => (VAR[m.id] ? m.box(0, 0.5, 0, 1, 1, 1) : m.box(0, 0, 0, 1, 0.5, 1)) },
  fence: { mesh: (m) => meshParts(m, FENCE_PARTS[joinMask(K.FENCE, nbMesh(m))], K.FENCE) },
  fence_gate: { mesh: (m) => meshParts(m, GATE_PARTS[gateOpen(m.id) * 4 + gateFacing(m.id)], K.GATE) },
  wall: {
    mesh: (m) => {
      const nb = nbMesh(m);
      meshParts(m, WALL_PARTS[wallTall(nb) * 16 + joinMask(K.WALL, nb)], K.WALL);
    },
  },
  pane: {
    mesh: (m) => {
      const parts = PANE_PARTS[joinMask(K.PANE, nbMesh(m))];
      // (panes stacked: no faces between them)
      const ends = (KIND[m.neighbor(0, 1, 0)] === K.PANE ? bit(FACE.PY) : 0) | (KIND[m.neighbor(0, -1, 0)] === K.PANE ? bit(FACE.NY) : 0);
      for (let i = 0; i < parts.length; i++) {
        const p = parts[i];
        let skip = p[6] | ends;
        for (let d = 0; d < 4; d++) if (p[7] & bit(DIR_FACE[d]) && KIND[m.neighbor(FX[d], 0, FZ[d])] === K.PANE) skip |= bit(DIR_FACE[d]);
        m.box(p[0], p[1], p[2], p[3], p[4], p[5], null, skip, null);
      }
    },
  },
  door: {
    mesh: (m) => {
      const b = DOOR_GEOM[m.id];
      m.box(b[0], b[1], b[2], b[3], b[4], b[5], null, 0, DOOR_TEX[m.id]);
    },
  },
  trapdoor: {
    mesh: (m) => {
      const b = trapdoorBox(VAR[m.id]);
      m.box(b[0], b[1], b[2], b[3], b[4], b[5], null, 0, IRON[m.id] ? UV_IRON_TRAPDOOR : UV_OAK_TRAPDOOR);
    },
  },
  ladder: {
    mesh: (m) => {
      const b = edgeBox(OPP[VAR[m.id]], S);
      m.box(b[0], b[1], b[2], b[3], b[4], b[5], null, 0, UV_LADDER);
    },
  },
  bed: {
    mesh: (m) => {
      const k = bedHead(m.id) * 4 + bedFacing(m.id);
      const parts = BED_PARTS[k];
      for (let i = 0; i < parts.length; i++) {
        const [b, uv, skip] = parts[i];
        m.box(b[0], b[1], b[2], b[3], b[4], b[5], null, skip, uv);
      }
      const top = BED_TOPS[k];
      m.quad(top.corners, top.uvs, FACE.PY, m.tile(FACE.PY));
    },
  },
  lantern: {
    mesh: (m) => {
      const hang = VAR[m.id] ? S : 0;
      m.box(5 * S, hang, 5 * S, 11 * S, hang + 7 * S, 11 * S, null, ENDS, hang ? UV_LANTERN_LOW : UV_LANTERN);
      m.box(6 * S, hang + 7 * S, 6 * S, 10 * S, hang + 9 * S, 10 * S, null, ENDS, hang ? UV_LANTERN_LOW : UV_LANTERN);
      m.box(5 * S, hang, 5 * S, 11 * S, hang + 7 * S, 11 * S, null, SIDES, UV_LANTERN_TOP);
      m.box(6 * S, hang + 7 * S, 6 * S, 10 * S, hang + 9 * S, 10 * S, null, SIDES | bit(FACE.NY), UV_LANTERN_TOP);
      if (hang) for (let i = 0; i < LANTERN_CHAIN.length; i++) m.quad(LANTERN_CHAIN[i].corners, LANTERN_CHAIN[i].uvs, FACE.PZ, m.tile(FACE.PZ));
    },
  },
  carpet: { mesh: (m) => m.box(0, 0, 0, 1, S, 1) },
};

// Collision that depends on the neighbours (physics.js reads a def's
// `collide(world, x, y, z, id)`: a list of boxes, never a new one).
const collideStairs = (world, x, y, z, id) => STAIR_BOXES[stairIndex(id, nbWorld(world, x, y, z))];
const collideFence = (world, x, y, z) => FENCE_BOXES[joinMask(K.FENCE, nbWorld(world, x, y, z))];
const collideWall = (world, x, y, z) => WALL_BOXES[joinMask(K.WALL, nbWorld(world, x, y, z))];
const collidePane = (world, x, y, z) => PANE_BOXES[joinMask(K.PANE, nbWorld(world, x, y, z))];

// ---------- Materials ----------

const WOODS = [
  { key: "oak", name: "Oak", planks: BLOCK.PLANKS, tile: "planks", stairs: I.OAK_STAIRS, slab: I.OAK_SLAB, fence: I.OAK_FENCE, gate: I.OAK_FENCE_GATE },
  { key: "spruce", name: "Spruce", planks: I.SPRUCE_PLANKS, tile: "spruce_planks", stairs: I.SPRUCE_STAIRS, slab: I.SPRUCE_SLAB, fence: I.SPRUCE_FENCE, gate: I.SPRUCE_FENCE_GATE },
  { key: "birch", name: "Birch", planks: I.BIRCH_PLANKS, tile: "birch_planks", stairs: I.BIRCH_STAIRS, slab: I.BIRCH_SLAB, fence: I.BIRCH_FENCE, gate: I.BIRCH_FENCE_GATE },
  { key: "jungle", name: "Jungle", planks: I.JUNGLE_PLANKS, tile: "jungle_planks", stairs: I.JUNGLE_STAIRS, slab: I.JUNGLE_SLAB, fence: I.JUNGLE_FENCE, gate: I.JUNGLE_FENCE_GATE },
  { key: "acacia", name: "Acacia", planks: I.ACACIA_PLANKS, tile: "acacia_planks", stairs: I.ACACIA_STAIRS, slab: I.ACACIA_SLAB, fence: I.ACACIA_FENCE, gate: I.ACACIA_FENCE_GATE },
  { key: "dark_oak", name: "Dark Oak", planks: I.DARK_OAK_PLANKS, tile: "dark_oak_planks", stairs: I.DARK_OAK_STAIRS, slab: I.DARK_OAK_SLAB, fence: I.DARK_OAK_FENCE, gate: I.DARK_OAK_FENCE_GATE },
];
const ANY_PLANKS = WOODS.map((w) => w.planks);
const WOOD = { hardness: 2, tool: "axe", sound: "wood" };
const PICK = { tool: "pickaxe", minTier: 1, sound: "stone" };

// Stairs and slabs of stone: the material block, its faces, hardness (vanilla's).
const STONES = [
  { name: "Cobblestone", block: BLOCK.COBBLESTONE, faces: "cobblestone", hardness: 2, stairs: I.COBBLESTONE_STAIRS, slab: I.COBBLESTONE_SLAB, wall: I.COBBLESTONE_WALL },
  { name: "Stone", block: BLOCK.STONE, faces: "stone", hardness: 1.5, stairs: I.STONE_STAIRS, slab: I.STONE_SLAB },
  { name: "Stone Brick", block: I.STONE_BRICKS, faces: "stone_bricks", hardness: 1.5, stairs: I.STONE_BRICK_STAIRS, slab: I.STONE_BRICK_SLAB, wall: I.STONE_BRICK_WALL },
  { name: "Brick", block: BLOCK.BRICKS, faces: "bricks", hardness: 2, stairs: I.BRICK_STAIRS, slab: I.BRICK_SLAB, wall: I.BRICK_WALL },
  { name: "Sandstone", block: I.SANDSTONE, faces: { top: "sandstone_top", bottom: "sandstone_top", side: "sandstone_side" }, hardness: 0.8, stairs: I.SANDSTONE_STAIRS, slab: I.SANDSTONE_SLAB, wall: I.SANDSTONE_WALL },
  { name: "Mossy Cobblestone", block: I.MOSSY_COBBLESTONE, faces: "mossy_cobblestone", hardness: 2, stairs: I.MOSSY_COBBLESTONE_STAIRS, slab: I.MOSSY_COBBLESTONE_SLAB, wall: I.MOSSY_COBBLESTONE_WALL },
];

export const COLORS = ["white", "orange", "magenta", "light_blue", "yellow", "lime", "pink", "gray", "light_gray", "cyan", "purple", "blue", "brown", "green", "red", "black"];
const COLOR_NAMES = COLORS.map((c) => c.split("_").map((w) => w[0].toUpperCase() + w.slice(1)).join(" "));
// (white wool is the core WOOL; the coloured ones from ORANGE_WOOL on)
const WOOL_IDS = [BLOCK.WOOL, ...COLORS.slice(1).map((_, i) => I.ORANGE_WOOL + i)];
const woolTile = (c) => (c === 0 ? "wool" : `wool_${COLORS[c]}`);

// ---------- Placement helpers ----------

const look = (ctx) => facingOf(ctx.forward[0], ctx.forward[2]);
// Whether a block placed now goes into the upper half of its cell: under a
// block, or on the upper half of a block's side (vanilla).
function upperHalf(ctx) {
  const n = ctx.normal;
  if (!n || !ctx.hit) return false;
  if (n[1] !== 0) return n[1] < 0;
  return ctx.hit[1] - ctx.y > 0.5;
}
// (128: the world's height, constants.js WORLD_HEIGHT)
const free = (world, x, y, z) => y >= 0 && y < 128 && LIB.IS_REPLACEABLE[world.getBlock(x, y, z)] === 1;

// ---------- Defs ----------

export const blocks = {};
export const blockUse = {};
export const drops = {};

function full(id, name, faces, extra) {
  blocks[id] = { name, faces, hardness: 1.5, ...PICK, ...extra };
}

// Planks.
for (const w of WOODS.slice(1)) blocks[w.planks] = { name: `${w.name} Planks`, faces: w.tile, ...WOOD };

// Stairs: 8 ids each (facing + 4 * upside down).
function placeStairs(ctx) {
  return BASE[ctx.stack.id] + look(ctx) + (upperHalf(ctx) ? 4 : 0);
}
function addStairs(base, name, faces, mat) {
  for (let v = 0; v < 8; v++) {
    const id = base + v;
    mark(id, K.STAIRS, base, v);
    if (v >= 4) TOP_FULL[id] = 1;
    blocks[id] = {
      name: `${name} Stairs`,
      faces,
      shape: "stairs",
      opaque: false,
      box: [0, 0, 0, 1, 1, 1],
      collision: STAIR_BOXES[((v >> 2) * 5) * 4 + (v & 3)],
      collide: collideStairs,
      ...mat,
      ...(v ? { item: base } : { placeAs: placeStairs, itemBoxes: [[0, 0, 0, 1, 0.5, 1], [0, 0.5, 0, 0.5, 1, 1]] }),
    };
  }
}

// Slabs: bottom, top; one onto the other half makes the full block.
function slabMerge(ctx) {
  const base = ctx.stack.id;
  const fullId = blocks[base].fullBlock;
  // On a slab of its kind, from its open side.
  if (KIND[ctx.id] === K.SLAB && BASE[ctx.id] === base && ctx.normal && ctx.normal[1] === (VAR[ctx.id] ? -1 : 1)) return [ctx.x, ctx.y, ctx.z, fullId];
  // Into a cell holding the other half.
  const p = ctx.place;
  if (!p || LIB.IS_REPLACEABLE[ctx.id]) return null;
  const there = ctx.world.getBlock(p[0], p[1], p[2]);
  if (KIND[there] === K.SLAB && BASE[there] === base && VAR[there] !== (upperHalf(ctx) ? 1 : 0)) return [p[0], p[1], p[2], fullId];
  return null;
}
function addSlab(base, name, faces, fullBlock, mat) {
  for (let v = 0; v < 2; v++) {
    const id = base + v;
    mark(id, K.SLAB, base, v);
    if (v) TOP_FULL[id] = 1;
    const box = v ? [0, 0.5, 0, 1, 1, 1] : [0, 0, 0, 1, 0.5, 1];
    blocks[id] = {
      name: `${name} Slab`,
      faces,
      shape: "slab",
      opaque: false,
      box,
      collision: [box],
      ...mat,
      hardness: 2, // (every slab, vanilla)
      fullBlock,
      ...(v ? { item: base } : { placeAs: (ctx) => base + (upperHalf(ctx) ? 1 : 0), merge: slabMerge, itemBoxes: [[0, 0, 0, 1, 0.5, 1]] }),
    };
  }
}

for (const w of WOODS) {
  addStairs(w.stairs, w.name, w.tile, WOOD);
  addSlab(w.slab, w.name, w.tile, w.planks, WOOD);
}
for (const st of STONES) {
  const mat = { ...PICK, hardness: st.hardness };
  addStairs(st.stairs, st.name, st.faces, mat);
  addSlab(st.slab, st.name, st.faces, st.block, mat);
}
addSlab(I.SMOOTH_STONE_SLAB, "Smooth Stone", { top: "smooth_stone", bottom: "smooth_stone", side: "smooth_stone_slab_side" }, I.SMOOTH_STONE, PICK);

// Fences: one id each, joined to their neighbours when meshed.
for (const w of WOODS) {
  mark(w.fence, K.FENCE, w.fence, 0);
  blocks[w.fence] = {
    name: `${w.name} Fence`,
    faces: w.tile,
    shape: "fence",
    opaque: false,
    skyPass: true,
    box: [0, 0, 0, 1, 1, 1],
    collision: [FENCE_POST_TALL],
    collide: collideFence,
    ...WOOD,
    itemBoxes: [
      [2 * S, 0, 6 * S, 6 * S, 1, 10 * S],
      [10 * S, 0, 6 * S, 14 * S, 1, 10 * S],
      [6 * S, 6 * S, 7 * S, 10 * S, 9 * S, 9 * S],
      [6 * S, 12 * S, 7 * S, 10 * S, 15 * S, 9 * S],
    ],
  };
}

// Fence gates: facing + 4 * open. Open, they're walked through.
function useGate(ctx) {
  const id = ctx.id;
  const base = BASE[id];
  let f = gateFacing(id);
  const open = !gateOpen(id);
  // (vanilla: it opens away from whoever opens it)
  if (open) {
    const p = look(ctx);
    if (p === OPP[f]) f = p;
  }
  if (!ctx.world.setBlock(ctx.x, ctx.y, ctx.z, base + f + (open ? 4 : 0))) return false;
  ctx.audio?.playPlace?.("wood");
  return true;
}
for (const w of WOODS) {
  for (let v = 0; v < 8; v++) {
    const id = w.gate + v;
    mark(id, K.GATE, w.gate, v);
    const f = v & 3;
    const closedBox = f < 2 ? [0, 0, 6 * S, 1, 1, 10 * S] : [6 * S, 0, 0, 10 * S, 1, 1];
    blocks[id] = {
      name: `${w.name} Fence Gate`,
      faces: w.tile,
      shape: "fence_gate",
      opaque: false,
      skyPass: true,
      solid: v < 4,
      box: closedBox,
      collision: [[closedBox[0], 0, closedBox[2], closedBox[3], 1.5, closedBox[5]]],
      ...WOOD,
      ...(v ? { item: w.gate } : { placeAs: (ctx) => w.gate + look(ctx), itemBoxes: GATE_PARTS[0].map((p) => p.slice(0, 6)) }),
    };
    blockUse[id] = useGate;
  }
}

// Walls.
for (const st of STONES) {
  if (!st.wall) continue;
  mark(st.wall, K.WALL, st.wall, 0);
  blocks[st.wall] = {
    name: `${st.name} Wall`,
    faces: st.faces,
    shape: "wall",
    opaque: false,
    skyPass: true,
    box: [0, 0, 0, 1, 1, 1],
    collision: [[4 * S, 0, 4 * S, 12 * S, 1.5, 12 * S]],
    collide: collideWall,
    ...PICK,
    hardness: st.hardness,
    itemBoxes: [[4 * S, 0, 4 * S, 12 * S, 1, 12 * S], [0, 0, 5 * S, 4 * S, 14 * S, 11 * S], [12 * S, 0, 5 * S, 1, 14 * S, 11 * S]],
  };
}

// Doors: 16 ids (facing, open, upper half), and 16 more hinged on the right.
const DOORS = [
  { name: "Oak Door", base: I.OAK_DOOR, right: OAK_DOOR_RIGHT, tile: "doors_a", col: 0, mat: { ...WOOD, hardness: 3 } },
  { name: "Spruce Door", base: I.SPRUCE_DOOR, right: SPRUCE_DOOR_RIGHT, tile: "doors_a", col: 1, mat: { ...WOOD, hardness: 3 } },
  { name: "Birch Door", base: I.BIRCH_DOOR, right: BIRCH_DOOR_RIGHT, tile: "doors_b", col: 0, mat: { ...WOOD, hardness: 3 } },
  { name: "Iron Door", base: I.IRON_DOOR, right: IRON_DOOR_RIGHT, tile: "doors_b", col: 1, mat: { ...PICK, hardness: 5 }, iron: true },
];
const DOOR_GEOM = new Array(BLOCK_LIMIT).fill(null); // id -> its panel box
const DOOR_TEX = new Array(BLOCK_LIMIT).fill(null); // id -> its quadrant
// (vanilla's hinge rule: against a wall beside it, else away from a door
// beside it, else on the side of the cell that was clicked)
function doorHinge(ctx, f, x, y, z) {
  const w = ctx.world;
  const L = LEFT[f];
  const R = RIGHT[f];
  const full = fullTable();
  const solid = (d, dy) => full[w.getBlock(x + FX[d], y + dy, z + FZ[d])] === 1;
  const lowerDoor = (d) => {
    const n = w.getBlock(x + FX[d], y, z + FZ[d]);
    return KIND[n] === K.DOOR && !doorUpper(n);
  };
  const i = (solid(L, 0) ? -1 : 0) + (solid(L, 1) ? -1 : 0) + (solid(R, 0) ? 1 : 0) + (solid(R, 1) ? 1 : 0);
  const dl = lowerDoor(L);
  const dr = lowerDoor(R);
  if ((dl && !dr) || i > 0) return 1;
  if ((dr && !dl) || i < 0) return 0;
  if (!ctx.hit) return 0;
  const s = (ctx.hit[0] - x - 0.5) * FX[L] + (ctx.hit[2] - z - 0.5) * FZ[L];
  return s >= 0 ? 0 : 1;
}
function placeDoor(ctx) {
  const [x, y, z] = ctx.place;
  if (!free(ctx.world, x, y + 1, z)) return null;
  const f = look(ctx);
  const d = DOORS.find((e) => e.base === ctx.stack.id);
  return (doorHinge(ctx, f, x, y, z) ? d.right : d.base) + f;
}
// The upper half to go with a lower one.
const placeDoorTop = (ctx, id, x, y, z) => (free(ctx.world, x, y + 1, z) ? [x, y + 1, z, id + 8] : null);
for (const d of DOORS) {
  for (let hinge = 0; hinge < 2; hinge++) {
    const base = hinge ? d.right : d.base;
    for (let v = 0; v < 16; v++) {
      const id = base + v;
      mark(id, K.DOOR, d.base, v);
      HINGE_RIGHT[id] = hinge;
      if (d.iron) IRON[id] = 1;
      const box = doorBox(v, hinge);
      DOOR_GEOM[id] = box;
      DOOR_TEX[id] = (v >> 3 ? DOOR_UV.upper : DOOR_UV.lower)[d.col];
      const first = id === d.base;
      blocks[id] = {
        name: d.name,
        faces: d.tile,
        shape: "door",
        render: RENDER.CUTOUT,
        opaque: false,
        skyPass: true,
        box,
        collision: [box],
        ...d.mat,
        // (the lower half stands on a block; the upper goes with it, see `partner`)
        support: v >> 3 ? null : (below) => topSolid(below),
        partner: v >> 3 ? [0, -1, 0] : [0, 1, 0],
        pairs: (other) => KIND[other] === K.DOOR && BASE[other] === d.base && doorUpper(other) !== v >> 3,
        // (every lower half: placeAs picks the facing and hinge, then this adds the top)
        placeMore: v >> 3 ? null : placeDoorTop,
        ...(first
          ? {
              placeAs: placeDoor,
              itemSprite: [
                [d.tile, d.col * 16, 0, 16, 16, 8, 0, 16, 16],
                [d.tile, d.col * 16, 16, 16, 16, 8, 16, 16, 16],
              ],
            }
          : { item: d.base }),
      };
      blockUse[id] = useDoor;
    }
  }
}

// Opens or closes the door at (x, y, z) (either half): both halves. True if
// it changed. (Iron doors too: this is the redstone part's way in.)
export function setDoorOpen(world, x, y, z, open) {
  const id = world.getBlock(x, y, z);
  if (KIND[id] !== K.DOOR) return false;
  const ly = doorUpper(id) ? y - 1 : y;
  const lower = world.getBlock(x, ly, z);
  const upper = world.getBlock(x, ly + 1, z);
  const want = open ? 4 : 0;
  const list = [];
  if (KIND[lower] === K.DOOR && !doorUpper(lower) && (VAR[lower] & 4) !== want) list.push(x, ly, z, lower - (VAR[lower] & 4) + want);
  if (KIND[upper] === K.DOOR && doorUpper(upper) && (VAR[upper] & 4) !== want) list.push(x, ly + 1, z, upper - (VAR[upper] & 4) + want);
  return list.length > 0 && world.setBlocks(list) > 0;
}
function useDoor(ctx) {
  if (IRON[ctx.id]) return false; // (only redstone opens an iron door)
  if (!setDoorOpen(ctx.world, ctx.x, ctx.y, ctx.z, !doorOpen(ctx.id))) return false;
  ctx.audio?.playPlace?.("wood");
  return true;
}

// Trapdoors: 16 ids (facing, open, top half).
function placeTrapdoor(ctx) {
  const n = ctx.normal;
  const base = ctx.stack.id;
  // On a block's side: hinged on it, in the upper or lower half by where it
  // was clicked; on a top or bottom face: facing the player, to that face.
  if (n && n[1] === 0 && !LIB.IS_REPLACEABLE[ctx.id]) return base + facingOf(n[0], n[2]) + (upperHalf(ctx) ? 8 : 0);
  return base + OPP[look(ctx)] + (n && n[1] < 0 ? 8 : 0);
}
function useTrapdoor(ctx) {
  if (IRON[ctx.id]) return false;
  const id = ctx.id;
  if (!ctx.world.setBlock(ctx.x, ctx.y, ctx.z, id + (VAR[id] & 4 ? -4 : 4))) return false;
  ctx.audio?.playPlace?.("wood");
  return true;
}
for (const [base, name, iron] of [[I.OAK_TRAPDOOR, "Oak Trapdoor", false], [I.IRON_TRAPDOOR, "Iron Trapdoor", true]]) {
  for (let v = 0; v < 16; v++) {
    const id = base + v;
    mark(id, K.TRAPDOOR, base, v);
    if (iron) IRON[id] = 1;
    if (v >> 3 && !((v >> 2) & 1)) TOP_FULL[id] = 1;
    const box = trapdoorBox(v);
    blocks[id] = {
      name,
      faces: "building_parts",
      shape: "trapdoor",
      render: RENDER.CUTOUT,
      opaque: false,
      skyPass: true,
      box,
      collision: [box],
      ...(iron ? { ...PICK, hardness: 5 } : { ...WOOD, hardness: 3 }),
      ...(v ? { item: base } : { placeAs: placeTrapdoor, itemBoxes: [[0, 0, 0, 1, 3 * S, 1, iron ? UV_IRON_TRAPDOOR : UV_OAK_TRAPDOOR]] }),
    };
    blockUse[id] = useTrapdoor;
  }
}

// Opens or closes a door, trapdoor or fence gate (the redstone part's way in).
export function setOpen(world, x, y, z, open) {
  const id = world.getBlock(x, y, z);
  if (KIND[id] === K.DOOR) return setDoorOpen(world, x, y, z, open);
  if (KIND[id] !== K.TRAPDOOR && KIND[id] !== K.GATE) return false;
  const is = (VAR[id] & 4) !== 0;
  return is !== !!open && world.setBlock(x, y, z, id + (open ? 4 : -4));
}

// Ladder: on a wall, facing out from it (like a wall torch); climbed.
for (let f = 0; f < 4; f++) {
  const id = I.LADDER + f;
  mark(id, K.LADDER, I.LADDER, f);
  blocks[id] = {
    name: "Ladder",
    faces: "building_parts",
    shape: "ladder",
    render: RENDER.CUTOUT,
    opaque: false,
    skyPass: true,
    solid: false,
    climbable: true,
    support: "wall",
    facing: [FX[f], FZ[f]],
    box: edgeBox(OPP[f], 3 * S),
    hardness: 0.4,
    tool: "axe",
    sound: "wood",
    ...(f
      ? { item: I.LADDER }
      : {
          // (only on the side of a block that can hold it)
          placeAs: (ctx) => (ctx.normal && ctx.normal[1] === 0 && !LIB.IS_REPLACEABLE[ctx.id] && LIB.isWallSupportedBy(ctx.id) ? I.LADDER + facingOf(ctx.normal[0], ctx.normal[2]) : null),
          itemSprite: [["building_parts", 0, 0, 16, 16, 0, 0, 32, 32]],
        }),
  };
}

// Glass pane and iron bars.
for (const [id, name, tile, mat] of [
  [I.GLASS_PANE, "Glass Pane", "glass", { hardness: 0.3, sound: "glass" }],
  [I.IRON_BARS, "Iron Bars", "iron_bars", { ...PICK, hardness: 5 }],
]) {
  mark(id, K.PANE, id, 0);
  blocks[id] = {
    name,
    faces: tile,
    shape: "pane",
    render: RENDER.CUTOUT,
    opaque: false,
    skyPass: true,
    box: [0, 0, 0, 1, 1, 1],
    collision: [PANE_BOXES[0][0]],
    collide: collidePane,
    ...mat,
  };
}
drops[I.GLASS_PANE] = () => []; // (as glass: nothing without silk touch)

// The red bed: facing + 4 * head; the foot where it's placed, the head on along the facing.
function useBed(ctx) {
  const bed = bedAt(ctx.world, ctx.x, ctx.y, ctx.z);
  if (!bed || typeof LIB.onBedUse !== "function") return false;
  return !!LIB.onBedUse({ ...ctx, bed });
}
function placeBedHead(ctx, id, x, y, z) {
  const f = bedFacing(id);
  return free(ctx.world, x + FX[f], y, z + FZ[f]) ? [x + FX[f], y, z + FZ[f], id + 4] : null;
}
for (let v = 0; v < 8; v++) {
  const id = I.RED_BED + v;
  const f = v & 3;
  const head = v >> 2;
  mark(id, K.BED, I.RED_BED, v);
  const box = [0, 0, 0, 1, 9 * S, 1];
  blocks[id] = {
    name: "Red Bed",
    faces: { top: "bed", bottom: "planks", side: "bed" },
    shape: "bed",
    opaque: false,
    skyPass: true,
    box,
    collision: [box],
    hardness: 0.2,
    sound: "cloth",
    stack: 1,
    partner: head ? [-FX[f], 0, -FZ[f]] : [FX[f], 0, FZ[f]],
    pairs: (other) => KIND[other] === K.BED && bedFacing(other) === f && bedHead(other) !== head,
    // (every foot: the head goes on along its facing)
    placeMore: head ? null : placeBedHead,
    ...(v
      ? { item: I.RED_BED }
      : {
          placeAs: (ctx) => I.RED_BED + look(ctx),
          itemSprite: [
            ["bed", 16, 16, 16, 16, 0, 6, 16, 16],
            ["bed", 0, 16, 16, 16, 16, 6, 16, 16],
          ],
        }),
  };
  blockUse[id] = useBed;
}

// The bed at (x, y, z) (either half): { foot, head, facing, id }, or null
// (a half without its other half is no bed).
export function bedAt(world, x, y, z) {
  const id = world.getBlock(x, y, z);
  if (KIND[id] !== K.BED) return null;
  const f = bedFacing(id);
  const s = bedHead(id) ? -1 : 1;
  const ox = x + FX[f] * s;
  const oz = z + FZ[f] * s;
  const other = world.getBlock(ox, y, oz);
  if (KIND[other] !== K.BED || bedFacing(other) !== f || bedHead(other) === bedHead(id)) return null;
  const foot = bedHead(id) ? [ox, y, oz] : [x, y, z];
  const headCell = bedHead(id) ? [x, y, z] : [ox, y, oz];
  return { foot, head: headCell, facing: [FX[f], FZ[f]], id: I.RED_BED };
}

// Stone variants.
full(I.STONE_BRICKS, "Stone Bricks", "stone_bricks");
full(I.MOSSY_STONE_BRICKS, "Mossy Stone Bricks", "mossy_stone_bricks");
full(I.CRACKED_STONE_BRICKS, "Cracked Stone Bricks", "cracked_stone_bricks");
full(I.CHISELED_STONE_BRICKS, "Chiseled Stone Bricks", "chiseled_stone_bricks");
full(I.SMOOTH_STONE, "Smooth Stone", "smooth_stone", { hardness: 2 });
full(I.MOSSY_COBBLESTONE, "Mossy Cobblestone", "mossy_cobblestone", { hardness: 2 });
full(I.GRANITE, "Granite", "granite");
full(I.POLISHED_GRANITE, "Polished Granite", "polished_granite");
full(I.DIORITE, "Diorite", "diorite");
full(I.POLISHED_DIORITE, "Polished Diorite", "polished_diorite");
full(I.ANDESITE, "Andesite", "andesite");
full(I.POLISHED_ANDESITE, "Polished Andesite", "polished_andesite");
full(I.SANDSTONE, "Sandstone", { top: "sandstone_top", bottom: "sandstone_top", side: "sandstone_side" }, { hardness: 0.8 });
full(I.CUT_SANDSTONE, "Cut Sandstone", { top: "sandstone_top", bottom: "sandstone_top", side: "cut_sandstone" }, { hardness: 0.8 });
full(I.CHISELED_SANDSTONE, "Chiseled Sandstone", { top: "sandstone_top", bottom: "sandstone_top", side: "chiseled_sandstone" }, { hardness: 0.8 });
full(I.SMOOTH_SANDSTONE, "Smooth Sandstone", "sandstone_top", { hardness: 2 });
blocks[I.BOOKSHELF] = { name: "Bookshelf", faces: { top: "planks", bottom: "planks", side: "bookshelf" }, hardness: 1.5, tool: "axe", sound: "wood" };
drops[I.BOOKSHELF] = () => (LIB.itemInfo?.(I.BOOK) ? [[I.BOOK, 3]] : null);

// Lantern: standing on a block or hanging under one; light 15.
const ceilingHolds = (above) => LIB.IS_SOLID[above] === 1;
function placeLantern(ctx) {
  const [x, y, z] = ctx.place;
  const w = ctx.world;
  const canHang = ceilingHolds(w.getBlock(x, y + 1, z));
  if (ctx.normal && ctx.normal[1] < 0 && canHang) return LANTERN_HANGING;
  if (topSolid(w.getBlock(x, y - 1, z))) return I.LANTERN;
  return canHang ? LANTERN_HANGING : null;
}
for (const [id, hang] of [[I.LANTERN, 0], [LANTERN_HANGING, 1]]) {
  mark(id, K.LANTERN, I.LANTERN, hang);
  const box = [5 * S, hang * S, 5 * S, 11 * S, hang * S + 9 * S, 11 * S];
  blocks[id] = {
    name: "Lantern",
    faces: "building_parts",
    shape: "lantern",
    render: RENDER.CUTOUT,
    opaque: false,
    skyPass: true,
    emission: 15,
    emissive: true,
    box,
    collision: [box],
    ...PICK,
    hardness: 3.5,
    // (standing: on a block's top; hanging: under a solid block, see `ceiling`)
    support: hang ? null : (below) => topSolid(below),
    ...(hang
      ? { item: I.LANTERN, ceiling: ceilingHolds }
      : { placeAs: placeLantern, itemSprite: [["building_parts", 20, 6, 8, 10, 8, 6, 16, 20]] }),
  };
}

// Coloured blocks: 15 more wools (white is the core WOOL), 16 terracottas
// (the plain one is the core TERRACOTTA), 16 concretes, 16 carpets.
COLORS.forEach((c, i) => {
  if (i > 0) blocks[WOOL_IDS[i]] = { name: `${COLOR_NAMES[i]} Wool`, faces: woolTile(i), hardness: 0.8, sound: "cloth" };
  full(I.WHITE_TERRACOTTA + i, `${COLOR_NAMES[i]} Terracotta`, `terracotta_${c}`, { hardness: 1.25 });
  full(I.WHITE_CONCRETE + i, `${COLOR_NAMES[i]} Concrete`, `concrete_${c}`, { hardness: 1.8 });
  const carpet = I.WHITE_CARPET + i;
  mark(carpet, K.CARPET, carpet, 0);
  blocks[carpet] = {
    name: `${COLOR_NAMES[i]} Carpet`,
    faces: woolTile(i),
    shape: "carpet",
    opaque: false,
    skyPass: true,
    solid: false, // (1/16 thick: walked over, never a step)
    box: [0, 0, 0, 1, S, 1],
    support: (below) => below !== BLOCK.AIR && !LIB.BLOCK_INFO[below]?.liquid,
    hardness: 0.1,
    sound: "cloth",
    itemBoxes: [[0, 0, 0, 1, S, 1]],
  };
});

// (For the other areas' code, read at run time: see the header.)
Object.assign(LIB, { setDoorOpen, setOpen, bedAt, isDoor, isOpenDoor, isBed });

// ---------- Recipes (vanilla yields; dyes are not in yet: the coloured
// blocks come from Creative, loot and structures until they are) ----------

export const recipes = () => {
  const out = [];
  const shaped = (pattern, key, result, count = 1) => out.push({ type: "shaped", pattern, key, result: [result, count] });
  const shapeless = (ingredients, result, count = 1) => out.push({ type: "shapeless", ingredients, result: [result, count] });
  const smelt = (input, result, xp = 0.1) => out.push({ type: "smelting", input, result: [result, 1], xp, time: 10 });
  const fuel = (input, time) => out.push({ type: "fuel", input, time });
  const stairs = (mat, id) => shaped(["#  ", "## ", "###"], { "#": mat }, id, 4);
  const slab = (mat, id) => shaped(["###"], { "#": mat }, id, 6);
  for (const w of WOODS) {
    stairs(w.planks, w.stairs);
    slab(w.planks, w.slab);
    shaped(["W#W", "W#W"], { W: w.planks, "#": ITEM.STICK }, w.fence, 3);
    shaped(["#W#", "#W#"], { W: w.planks, "#": ITEM.STICK }, w.gate, 1);
    fuel(w.stairs, 15);
    fuel(w.slab, 7.5);
    fuel(w.fence, 15);
    fuel(w.gate, 15);
  }
  for (const w of WOODS.slice(1)) fuel(w.planks, 15);
  for (const st of STONES) {
    stairs(st.block, st.stairs);
    slab(st.block, st.slab);
    if (st.wall) shaped(["###", "###"], { "#": st.block }, st.wall, 6);
  }
  slab(I.SMOOTH_STONE, I.SMOOTH_STONE_SLAB);
  // Doors and trapdoors.
  for (const [planks, door] of [[BLOCK.PLANKS, I.OAK_DOOR], [I.SPRUCE_PLANKS, I.SPRUCE_DOOR], [I.BIRCH_PLANKS, I.BIRCH_DOOR]]) {
    shaped(["##", "##", "##"], { "#": planks }, door, 3);
    fuel(door, 10);
  }
  shaped(["##", "##", "##"], { "#": I.IRON_INGOT }, I.IRON_DOOR, 3);
  shaped(["###", "###"], { "#": BLOCK.PLANKS }, I.OAK_TRAPDOOR, 2);
  fuel(I.OAK_TRAPDOOR, 15);
  shaped(["##", "##"], { "#": I.IRON_INGOT }, I.IRON_TRAPDOOR, 1);
  shaped(["# #", "###", "# #"], { "#": ITEM.STICK }, I.LADDER, 3);
  fuel(I.LADDER, 15);
  shaped(["###", "###"], { "#": BLOCK.GLASS }, I.GLASS_PANE, 16);
  shaped(["###", "###"], { "#": I.IRON_INGOT }, I.IRON_BARS, 16);
  // (red wool: the other colours' beds are the decor part's)
  shaped(["WWW", "PPP"], { W: I.RED_WOOL, P: ANY_PLANKS }, I.RED_BED, 1);
  shaped(["NNN", "N#N", "NNN"], { N: I.IRON_NUGGET, "#": BLOCK.TORCH }, I.LANTERN, 1);
  shaped(["PPP", "BBB", "PPP"], { P: ANY_PLANKS, B: I.BOOK }, I.BOOKSHELF, 1);
  fuel(I.BOOKSHELF, 15);
  // Stone.
  shaped(["##", "##"], { "#": BLOCK.STONE }, I.STONE_BRICKS, 4);
  shapeless([I.STONE_BRICKS, I.VINE], I.MOSSY_STONE_BRICKS, 1);
  shapeless([BLOCK.COBBLESTONE, I.VINE], I.MOSSY_COBBLESTONE, 1);
  shaped(["#", "#"], { "#": I.STONE_BRICK_SLAB }, I.CHISELED_STONE_BRICKS, 1);
  smelt(I.STONE_BRICKS, I.CRACKED_STONE_BRICKS);
  smelt(BLOCK.STONE, I.SMOOTH_STONE);
  shaped(["##", "##"], { "#": I.GRANITE }, I.POLISHED_GRANITE, 4);
  shaped(["##", "##"], { "#": I.DIORITE }, I.POLISHED_DIORITE, 4);
  shaped(["##", "##"], { "#": I.ANDESITE }, I.POLISHED_ANDESITE, 4);
  shapeless([I.DIORITE, BLOCK.COBBLESTONE], I.ANDESITE, 2);
  shaped(["##", "##"], { "#": BLOCK.SAND }, I.SANDSTONE, 1);
  shaped(["##", "##"], { "#": I.SANDSTONE }, I.CUT_SANDSTONE, 4);
  shaped(["#", "#"], { "#": I.SANDSTONE_SLAB }, I.CHISELED_SANDSTONE, 1);
  smelt(I.SANDSTONE, I.SMOOTH_SANDSTONE);
  // Carpets: two wool of a colour, three carpets.
  COLORS.forEach((_, i) => {
    shaped(["##"], { "#": WOOL_IDS[i] }, I.WHITE_CARPET + i, 3);
    if (i > 0) fuel(WOOL_IDS[i], 5);
    fuel(I.WHITE_CARPET + i, 3.35);
  });
  return out;
};

// ---------- Textures (75 tiles: the budget) ----------

export const tiles = {};
export const tileRelief = {};

// Recolours a painted tile: every pixel's brightness (relative to the
// tile's mean) applied to `rgb`, so the pattern stays and the colour is new.
function tintTile(t, rgb, contrast = 1, lift = 0.06) {
  let sum = 0;
  const lum = new Float32Array(32 * 32);
  t.forEach((x, y) => {
    const c = t.get(x, y);
    const l = 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
    lum[y * 32 + x] = l;
    sum += l;
  });
  const mean = sum / 1024 || 1;
  t.forEach((x, y) => {
    const d = (lum[y * 32 + x] - mean) / mean;
    const k = 1 + d * contrast;
    const a = t.get(x, y)[3];
    t.set(x, y, [rgb[0] * k + 255 * d * lift, rgb[1] * k + 255 * d * lift, rgb[2] * k + 255 * d * lift], a);
  });
}
// Maps a tile's brightness onto a ramp (dark to light), keeping its pattern.
function rampTile(t, kit, pal) {
  let lo = 1e9;
  let hi = -1e9;
  const lum = new Float32Array(32 * 32);
  t.forEach((x, y) => {
    const c = t.get(x, y);
    const l = 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
    lum[y * 32 + x] = l;
    lo = Math.min(lo, l);
    hi = Math.max(hi, l);
  });
  const span = hi - lo || 1;
  t.forEach((x, y) => t.set(x, y, kit.ramp(pal, (lum[y * 32 + x] - lo) / span)));
}
const pal = (kit, list) => list.map(kit.hex);

// Planks of the other woods: oak's boards, recoloured.
const PLANK_RAMPS = {
  spruce_planks: [0x4a3320, 0x573d26, 0x65472c, 0x725233, 0x7f5c3a, 0x8c6741],
  birch_planks: [0x9a8857, 0xae9c66, 0xbfad74, 0xccba80, 0xd7c58b, 0xe1d096],
  jungle_planks: [0x7a5137, 0x8a5d40, 0x996949, 0xa67452, 0xb27f5b, 0xbd8a64],
  acacia_planks: [0x86412a, 0x984b2f, 0xa85636, 0xb6603d, 0xc26b44, 0xcd764c],
  dark_oak_planks: [0x2a1b0e, 0x342213, 0x3f2a18, 0x49321d, 0x543a22, 0x5e4228],
};
for (const [name, ramp] of Object.entries(PLANK_RAMPS)) {
  tiles[name] = (t, kit) => {
    kit.base("planks", t);
    rampTile(t, kit, pal(kit, ramp));
  };
}

const STONE_GREY = [0x5d5d62, 0x68686d, 0x737378, 0x7e7e83, 0x89898e, 0x949499, 0xa0a0a5];
// Stone bricks: two rows of bricks a block (the lower row offset by half), mortar between.
function stoneBricks(t, kit, salt = 0) {
  const grey = pal(kit, STONE_GREY);
  t.forEach((x, y) => {
    const row = y >> 4;
    const yy = y & 15;
    const xx = (x + (row ? 16 : 0)) & 31;
    if (yy === 15 || xx === 31) {
      t.set(x, y, kit.hex(0x3e3e42));
      return;
    }
    const brick = kit.hashInt(row, xx >> 5, t.seed + salt);
    let f = 0.42 + (brick - 0.5) * 0.12 + (t.fbm(x, y, 4, 3, salt) - 0.5) * 0.5 + (t.rand() - 0.5) * 0.12;
    if (yy === 0 || xx === 0) f += 0.2; // (the brick's top-left edge catches the light)
    if (yy === 14 || xx === 30) f -= 0.18;
    t.set(x, y, kit.ramp(grey, f));
  });
}
// Moss over a tile: green patches, thicker in the cracks.
function moss(t, kit, amount, salt) {
  const green = pal(kit, [0x3c5a22, 0x47692a, 0x557a31, 0x62893a, 0x6f9843]);
  t.forEach((x, y) => {
    const c = t.get(x, y);
    const dark = 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2] < 80 ? 0.18 : 0;
    const n = t.fbm(x, y, 4, 3, salt) + dark;
    if (n > 1 - amount) t.set(x, y, kit.ramp(green, (n - (1 - amount)) / amount * 0.7 + t.rand() * 0.3));
  });
}
tiles.stone_bricks = (t, kit) => stoneBricks(t, kit);
tiles.mossy_stone_bricks = (t, kit) => {
  stoneBricks(t, kit, 3);
  moss(t, kit, 0.42, 11);
};
tiles.cracked_stone_bricks = (t, kit) => {
  stoneBricks(t, kit, 5);
  // Cracks wandering across the bricks.
  for (let i = 0; i < 6; i++) {
    let x = Math.floor(t.rand() * 32);
    let y = Math.floor(t.rand() * 32);
    const len = 6 + Math.floor(t.rand() * 10);
    const dir = t.rand() < 0.5 ? 1 : -1;
    for (let k = 0; k < len; k++) {
      t.set(x, y, kit.hex(0x2f2f33));
      t.shade(x + 1, y, 0.82);
      y += 1;
      if (t.rand() < 0.55) x += dir;
    }
  }
};
tiles.chiseled_stone_bricks = (t, kit) => {
  const grey = pal(kit, STONE_GREY);
  t.forEach((x, y) => {
    let f = 0.5 + (t.fbm(x, y, 4, 3) - 0.5) * 0.4 + (t.rand() - 0.5) * 0.1;
    const e = Math.min(x, y, 31 - x, 31 - y);
    if (e === 0) f = 0.15;
    else if (e === 1) f += x === 1 || y === 1 ? 0.3 : -0.3; // (bevelled rim)
    else if (e === 4) f -= 0.35; // (the inner frame's groove)
    else if (e === 5) f += 0.25;
    // A carved ring in the middle.
    const r = Math.hypot(x - 15.5, y - 15.5);
    if (r > 5 && r < 6.5) f -= 0.35;
    else if (r >= 6.5 && r < 7.5) f += 0.2;
    t.set(x, y, kit.ramp(grey, f));
  });
  t.set(15, 15, kit.hex(0x3e3e42));
  t.set(16, 16, kit.hex(0x3e3e42));
};
function smoothStone(t, kit, slabSide) {
  const grey = pal(kit, [0x8a8a8a, 0x939393, 0x9c9c9c, 0xa5a5a5, 0xaeaeae]);
  t.forEach((x, y) => {
    let f = 0.5 + (t.fbm(x, y, 4, 2) - 0.5) * 0.35 + (t.rand() - 0.5) * 0.12;
    const e = Math.min(x, y, 31 - x, 31 - y);
    if (e === 0) f -= 0.45;
    if (slabSide && (y === 15 || y === 16)) f -= y === 15 ? 0.45 : -0.25; // (the line between the two slabs)
    t.set(x, y, kit.ramp(grey, f));
  });
}
tiles.smooth_stone = (t, kit) => smoothStone(t, kit, false);
tiles.smooth_stone_slab_side = (t, kit) => smoothStone(t, kit, true);
tiles.mossy_cobblestone = (t, kit) => {
  kit.base("cobblestone", t);
  moss(t, kit, 0.3, 7);
};
// Granite, diorite, andesite: speckled stone; polished, smoother with a bevel.
function speckled(t, kit, ramp, specks, polished) {
  const p = pal(kit, ramp);
  t.forEach((x, y) => {
    let f = polished ? 0.5 + (t.fbm(x, y, 2, 3) - 0.5) * 0.45 + (t.rand() - 0.5) * 0.18 : t.fbm(x, y, 8, 3) * 0.55 + t.rand() * 0.45;
    if (polished) {
      const e = Math.min(x, y, 31 - x, 31 - y);
      if (e === 0) f += x === 0 || y === 0 ? 0.35 : -0.5;
    }
    t.set(x, y, kit.ramp(p, f));
  });
  const n = polished ? specks.n >> 1 : specks.n;
  for (let i = 0; i < n; i++) {
    const x = 1 + Math.floor(t.rand() * 30);
    const y = 1 + Math.floor(t.rand() * 30);
    const c = kit.hex(specks.colors[Math.floor(t.rand() * specks.colors.length)]);
    t.set(x, y, c);
    if (!polished && t.rand() < 0.5) t.set(x + 1, y, c);
  }
}
const GRANITE = [0x7c5040, 0x8a5b49, 0x986653, 0xa5715d, 0xb27d68, 0xbe8a75];
const DIORITE = [0x9e9e9c, 0xadadab, 0xbbbbb9, 0xc8c8c6, 0xd4d4d2, 0xe0e0de];
const ANDESITE = [0x6c6c6c, 0x777777, 0x828282, 0x8c8c8c, 0x979797, 0xa2a2a2];
tiles.granite = (t, kit) => speckled(t, kit, GRANITE, { n: 40, colors: [0xd8a090, 0x5e3a2e, 0xc9937f] }, false);
tiles.polished_granite = (t, kit) => speckled(t, kit, GRANITE, { n: 40, colors: [0xd8a090, 0x6e4638] }, true);
tiles.diorite = (t, kit) => speckled(t, kit, DIORITE, { n: 60, colors: [0x5c5c5a, 0x787876, 0xf4f4f2] }, false);
tiles.polished_diorite = (t, kit) => speckled(t, kit, DIORITE, { n: 50, colors: [0x6a6a68, 0x8c8c8a] }, true);
tiles.andesite = (t, kit) => speckled(t, kit, ANDESITE, { n: 50, colors: [0x505050, 0xb2b2b2, 0x5d5d5d] }, false);
tiles.polished_andesite = (t, kit) => speckled(t, kit, ANDESITE, { n: 40, colors: [0x5a5a5a, 0xa8a8a8] }, true);

// Sandstone.
const SANDSTONE = [0xbfae7a, 0xcbb985, 0xd5c490, 0xdecd9a, 0xe6d6a5, 0xede0b2];
tiles.sandstone_top = (t, kit) => {
  const p = pal(kit, SANDSTONE);
  t.forEach((x, y) => t.set(x, y, kit.ramp(p, 0.35 + t.fbm(x, y, 4, 3) * 0.35 + t.rand() * 0.25)));
};
tiles.sandstone_side = (t, kit) => {
  const p = pal(kit, SANDSTONE);
  t.forEach((x, y) => {
    let f = 0.35 + t.fbm(x, y, 8, 2, 0, 2) * 0.3 + t.rand() * 0.2;
    if (y < 6) f += 0.18; // (the smooth top course)
    if (y === 6) f = 0.05;
    if (y >= 26) f -= 0.08;
    // Wavy bedding lines.
    const wave = Math.sin(x * 0.4 + y) * 0.6 + t.noise(x, y, 8, 3) * 1.4;
    if (y > 7 && (y + Math.round(wave)) % 6 === 0) f -= 0.22;
    t.set(x, y, kit.ramp(p, f));
  });
};
tiles.cut_sandstone = (t, kit) => {
  const p = pal(kit, SANDSTONE);
  t.forEach((x, y) => {
    let f = 0.45 + t.fbm(x, y, 4, 2) * 0.3 + t.rand() * 0.15;
    const yy = y & 15;
    if (yy === 0) f += 0.22;
    if (yy === 15) f = 0.05;
    if (x === 0) f += 0.15;
    if (x === 31) f -= 0.25;
    t.set(x, y, kit.ramp(p, f));
  });
};
tiles.chiseled_sandstone = (t, kit) => {
  const p = pal(kit, SANDSTONE);
  t.forEach((x, y) => {
    let f = 0.45 + t.fbm(x, y, 4, 2) * 0.25 + t.rand() * 0.15;
    if (y < 5 || y > 26) f += 0.15;
    if (y === 5 || y === 26) f = 0.05;
    t.set(x, y, kit.ramp(p, f));
  });
  // A carved glyph in the middle band: a face with an arch above it.
  const dark = kit.hex(0x8f7f52);
  const glyph = [
    "....########....",
    "...#........#...",
    "..#..##..##..#..",
    "..#..##..##..#..",
    "..#..........#..",
    "..#....##....#..",
    "..#...####...#..",
    "..#..#....#..#..",
    "...#........#...",
    "....########....",
  ];
  glyph.forEach((row, j) => {
    for (let i = 0; i < 16; i++) if (row[i] === "#") for (let k = 0; k < 2; k++) t.set(i * 2 + k, 10 + j * 1 + 1, dark);
  });
};

// Bookshelf: shelves of books between a planks top and bottom.
tiles.bookshelf = (t, kit) => {
  kit.base("planks", t);
  const covers = [0x8e2a24, 0x2f4f8a, 0x3d6b2f, 0x6e4a26, 0x6a2f6e, 0x9a7a2a, 0x2e6e6a].map(kit.hex);
  const shelf = kit.hex(0x4a3220);
  for (const [y0, y1] of [[3, 14], [18, 29]]) {
    let x = 1;
    while (x < 31) {
      const w = 2 + Math.floor(t.rand() * 2);
      const h = y1 - y0 - Math.floor(t.rand() * 3);
      const c = covers[Math.floor(t.rand() * covers.length)];
      for (let i = 0; i < w && x + i < 31; i++) {
        for (let y = y0; y <= y1; y++) {
          if (y < y1 - h) t.set(x + i, y, kit.hex(0x22160c));
          else t.set(x + i, y, kit.scaleRgb(c, i === 0 ? 1.25 : i === w - 1 ? 0.75 : 1));
        }
      }
      // (a band across the spine)
      for (let i = 0; i < w && x + i < 31; i++) t.set(x + i, y1 - 2, kit.hex(0xd8c070));
      x += w;
      if (t.rand() < 0.15) x++;
    }
    for (let x2 = 0; x2 < 32; x2++) {
      t.set(x2, y0 - 1, shelf);
      t.set(x2, y1 + 1, shelf);
    }
    for (let y = y0; y <= y1; y++) {
      t.set(0, y, shelf);
      t.set(31, y, shelf);
    }
  }
};

// Doors, a quadrant each half (painted 16 x 16 at (ox, oy) of the tile).
const CLEAR = [0, 0, 0];
function doorPanel(t, kit, ox, oy, wood, { upper, windows, iron }) {
  const p = pal(kit, wood);
  for (let y = 0; y < 16; y++) {
    for (let x = 0; x < 16; x++) {
      let f = iron ? 0.55 + (t.rand() - 0.5) * 0.12 : 0.45 + (t.fbm(ox + x, oy + y, 2, 2, 0, 8) - 0.5) * 0.45 + (t.rand() - 0.5) * 0.1;
      const edge = x === 0 || x === 15 || (upper ? y === 0 : y === 15);
      if (edge) f = iron ? 0.15 : 0.12;
      else if (x === 1 || (upper ? y === 1 : y === 14)) f += 0.2;
      if (!iron && !edge && (x === 5 || x === 10)) f -= 0.22; // (boards)
      if (!edge && (upper ? y === 15 : y === 0)) f -= 0.25; // (the rail where the halves meet)
      if (iron && !edge && (y === (upper ? 12 : 4) || y === (upper ? 13 : 5))) f -= 0.2;
      t.set(ox + x, oy + y, kit.ramp(p, f));
    }
  }
  if (iron) for (const [x, y] of [[2, 2], [13, 2], [2, 13], [13, 13]]) t.set(ox + x, oy + y, kit.hex(0xe8e8e8));
  for (const [x0, y0, x1, y1] of windows || []) {
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) t.set(ox + x, oy + y, CLEAR, 0);
  }
}
const OAK = [0x5c3f23, 0x7d5a34, 0x8e673c, 0x9d7445, 0xab804e, 0xb88c58];
const SPRUCE = PLANK_RAMPS.spruce_planks;
const BIRCH = PLANK_RAMPS.birch_planks;
const IRONS = [0x4a4a4e, 0x8c8c90, 0xa4a4a8, 0xb8b8bc, 0xcacace, 0xdadade];
tiles.doors_a = (t, kit) => {
  t.forEach((x, y) => t.set(x, y, CLEAR, 0));
  doorPanel(t, kit, 0, 0, OAK, { upper: true, windows: [[3, 3, 6, 7], [9, 3, 12, 7]] });
  doorPanel(t, kit, 0, 16, OAK, {});
  doorPanel(t, kit, 16, 0, SPRUCE, { upper: true });
  doorPanel(t, kit, 16, 16, SPRUCE, {});
};
tiles.doors_b = (t, kit) => {
  t.forEach((x, y) => t.set(x, y, CLEAR, 0));
  doorPanel(t, kit, 0, 0, BIRCH, { upper: true, windows: [[3, 3, 6, 6], [9, 3, 12, 6], [3, 9, 6, 12], [9, 9, 12, 12]] });
  doorPanel(t, kit, 0, 16, BIRCH, {});
  doorPanel(t, kit, 16, 0, IRONS, { upper: true, iron: true, windows: [[4, 3, 6, 7], [9, 3, 11, 7]] });
  doorPanel(t, kit, 16, 16, IRONS, { iron: true });
};
tileRelief.doors_a = [1.2, 0.7, 1];
tileRelief.doors_b = [1.2, 0.6, 1];

// building_parts: ladder (top left), lantern (top right), oak trapdoor
// (bottom left), iron trapdoor (bottom right).
tiles.building_parts = (t, kit) => {
  t.forEach((x, y) => t.set(x, y, CLEAR, 0));
  const oak = pal(kit, OAK);
  // Ladder: two rails, rungs every four pixels.
  for (let y = 0; y < 16; y++) {
    for (const x of [2, 3, 12, 13]) t.set(x, y, kit.ramp(oak, (x === 2 || x === 12 ? 0.75 : 0.4) + (t.rand() - 0.5) * 0.15));
    if (y % 4 === 1) for (let x = 4; x < 12; x++) t.set(x, y, kit.ramp(oak, 0.65 + (t.rand() - 0.5) * 0.2));
    if (y % 4 === 2) for (let x = 4; x < 12; x++) t.set(x, y, kit.ramp(oak, 0.3));
  }
  // Lantern (see the lantern's uv: its top in rows 0-5, the cap 7-8, the body 9-15).
  const iron = pal(kit, [0x262a30, 0x3a4048, 0x4f5660, 0x68707a]);
  const glow = pal(kit, [0xe08a2a, 0xf4b23e, 0xffd36a, 0xfff0b0]);
  for (let y = 0; y < 16; y++) {
    for (let x = 5; x <= 10; x++) {
      if (y <= 5) t.set(16 + x, y, iron[(x === 7 || x === 8) && y >= 1 && y <= 4 ? 3 : 1]);
      else if (y === 7 || y === 8) {
        if (x >= 6 && x <= 9) t.set(16 + x, y, iron[y === 7 ? 2 : 1]);
      } else if (y >= 9) {
        const frame = x === 5 || x === 10 || y === 9 || y === 15;
        if (frame) t.set(16 + x, y, iron[x === 5 || y === 9 ? 2 : 0]);
        else t.set(16 + x, y, glow[y === 10 || y === 14 ? 1 : x === 6 || x === 9 ? 2 : 3]);
      }
    }
    // The chain's links (columns 1-2).
    t.set(17, y, iron[y % 3 === 0 ? 3 : 1]);
    t.set(18, y, iron[y % 3 === 1 ? 3 : 0]);
  }
  // Oak trapdoor: a frame with four hatches.
  for (let y = 16; y < 32; y++) {
    for (let x = 0; x < 16; x++) {
      const lx = x;
      const ly = y - 16;
      const frame = lx < 2 || lx > 13 || ly < 2 || ly > 13 || lx === 7 || lx === 8 || ly === 7 || ly === 8;
      const hole = !frame && (lx === 3 || lx === 4 || lx === 11 || lx === 12) && (ly === 4 || ly === 11);
      if (hole) continue;
      t.set(x, y, kit.ramp(oak, (frame ? 0.55 : 0.35) + (t.fbm(x, y, 4, 2) - 0.5) * 0.3 + (lx === 0 || ly === 0 ? 0.25 : 0)));
    }
  }
  // Iron trapdoor: a plate with two rows of slits.
  const plate = pal(kit, IRONS);
  for (let y = 16; y < 32; y++) {
    for (let x = 16; x < 32; x++) {
      const lx = x - 16;
      const ly = y - 16;
      const slit = (ly === 4 || ly === 5 || ly === 10 || ly === 11) && lx >= 3 && lx <= 12 && lx % 3 !== 2;
      if (slit) continue;
      const e = Math.min(lx, ly, 15 - lx, 15 - ly);
      t.set(x, y, kit.ramp(plate, e === 0 ? 0.1 : 0.55 + (t.rand() - 0.5) * 0.15 + (e === 1 && (lx === 1 || ly === 1) ? 0.25 : 0)));
    }
  }
};
tileRelief.building_parts = [1.0, 0.55, 1];

// Iron bars: four bars with a rail along the top and bottom.
tiles.iron_bars = (t, kit) => {
  t.forEach((x, y) => t.set(x, y, CLEAR, 0));
  const iron = pal(kit, [0x3a3e44, 0x5a6068, 0x7c838c, 0xa2a9b2]);
  for (let y = 0; y < 32; y++) {
    for (const x0 of [3, 11, 19, 27]) {
      t.set(x0, y, iron[3]);
      t.set(x0 + 1, y, iron[1]);
    }
  }
  for (const y of [1, 30]) for (let x = 0; x < 32; x++) t.set(x, y, iron[y === 1 ? 2 : 1]);
};
tileRelief.iron_bars = [1.0, 0.45, 1];

// The bed: the tops above (the foot's blanket; the head's pillow at the
// top, toward the head end), the sides below (legs rows 0-2 from the
// bottom, the frame 3-5, the blanket or sheet 6-8).
tiles.bed = (t, kit) => {
  const red = pal(kit, [0x6e1612, 0x8a1d18, 0xa3261f, 0xb83027, 0xc93c31]);
  const white = pal(kit, [0xb8b4ac, 0xcdc9c1, 0xdfdbd3, 0xedeae4]);
  const wood = pal(kit, OAK);
  t.forEach((x, y) => t.set(x, y, kit.ramp(red, 0.5 + (t.fbm(x, y, 8, 2) - 0.5) * 0.4 + (t.rand() - 0.5) * 0.15)));
  // Foot top: a darker hem at the foot end (the quadrant's bottom rows).
  for (let x = 0; x < 16; x++) for (let y = 13; y < 16; y++) t.set(x, y, kit.ramp(red, y === 13 ? 0.95 : 0.15));
  // Head top: the pillow, then the blanket's folded edge.
  for (let x = 16; x < 32; x++) {
    for (let y = 0; y < 7; y++) {
      const lx = x - 16;
      const edge = lx === 1 || lx === 14 || y === 1 || y === 6;
      t.set(x, y, lx < 1 || lx > 14 || y < 1 ? kit.ramp(white, 0.1) : kit.ramp(white, edge ? 0.35 : 0.75 + (t.rand() - 0.5) * 0.2));
    }
    t.set(x, 7, kit.ramp(white, 0.9));
    t.set(x, 8, kit.ramp(red, 1));
  }
  // Sides: rows from the bottom r = 31 - y.
  for (let x = 0; x < 32; x++) {
    for (let y = 16; y < 32; y++) {
      const r = 31 - y;
      const head = x >= 16;
      if (r <= 2) t.set(x, y, kit.ramp(wood, 0.35 + (t.rand() - 0.5) * 0.2));
      else if (r <= 5) t.set(x, y, kit.ramp(wood, (r === 5 ? 0.85 : 0.55) + (t.rand() - 0.5) * 0.15));
      else if (r <= 8) {
        if (head) t.set(x, y, kit.ramp(white, r === 8 ? 0.8 : r === 6 ? 0.3 : 0.6));
        else t.set(x, y, kit.ramp(red, r === 8 ? 0.95 : r === 6 ? 0.2 : 0.55));
      }
    }
  }
};

// Wool, terracotta and concrete in the sixteen colours (vanilla's).
const WOOL_RGB = [0xe9ecec, 0xf07613, 0xbd44b3, 0x3aafd9, 0xf8c527, 0x70b919, 0xed8dac, 0x3e4447, 0x8e8e86, 0x158991, 0x792aac, 0x35399d, 0x724728, 0x546d1b, 0xa12722, 0x141519];
const TERRACOTTA_RGB = [0xd1b2a1, 0xa15325, 0x95586c, 0x716d8a, 0xba8523, 0x677534, 0xa14e4e, 0x392a23, 0x876b62, 0x565b5b, 0x764656, 0x4a3b5b, 0x4d3323, 0x4c532a, 0x8f3d2e, 0x251610];
const CONCRETE_RGB = [0xcfd5d6, 0xe06101, 0xa9309f, 0x2489c7, 0xf1af15, 0x5ea918, 0xd5658f, 0x373a3e, 0x7d7d73, 0x157788, 0x64209c, 0x2d2f8f, 0x603c20, 0x495b24, 0x8e2121, 0x080a0f];
COLORS.forEach((c, i) => {
  if (i > 0) {
    tiles[`wool_${c}`] = (t, kit) => {
      kit.base("wool", t);
      tintTile(t, kit.hex(WOOL_RGB[i]), 2.2, 0.12);
    };
    tileRelief[`wool_${c}`] = [1.4, 1.0, 1];
  }
  tiles[`terracotta_${c}`] = (t, kit) => {
    const rgb = kit.hex(TERRACOTTA_RGB[i]);
    t.forEach((x, y) => {
      const f = 0.92 + (t.fbm(x, y, 4, 3) - 0.5) * 0.16 + (t.rand() - 0.5) * 0.08;
      t.set(x, y, kit.scaleRgb(rgb, f));
    });
    for (let k = 0; k < 14; k++) t.set(Math.floor(t.rand() * 32), Math.floor(t.rand() * 32), kit.scaleRgb(rgb, t.rand() < 0.5 ? 0.86 : 1.1));
  };
  tileRelief[`terracotta_${c}`] = [1.0, 0.85, 1];
  tiles[`concrete_${c}`] = (t, kit) => {
    const rgb = kit.hex(CONCRETE_RGB[i]);
    t.forEach((x, y) => t.set(x, y, kit.scaleRgb(rgb, 0.97 + (t.fbm(x, y, 8, 2) - 0.5) * 0.06 + (t.rand() - 0.5) * 0.04)));
  };
  tileRelief[`concrete_${c}`] = [0.5, 0.75, 1];
});
Object.assign(tileRelief, {
  stone_bricks: [2.6, 0.78, 1],
  mossy_stone_bricks: [2.6, 0.82, 1],
  cracked_stone_bricks: [2.8, 0.8, 1],
  chiseled_stone_bricks: [2.6, 0.75, 1],
  smooth_stone: [1.0, 0.7, 1],
  smooth_stone_slab_side: [1.0, 0.7, 1],
  mossy_cobblestone: [3.2, 0.8, 1],
  granite: [1.8, 0.7, 1],
  diorite: [1.8, 0.7, 1],
  andesite: [1.8, 0.75, 1],
  polished_granite: [0.9, 0.45, 1],
  polished_diorite: [0.9, 0.45, 1],
  polished_andesite: [0.9, 0.5, 1],
  sandstone_top: [1.2, 0.9, 1],
  sandstone_side: [1.6, 0.9, 1],
  cut_sandstone: [1.4, 0.88, 1],
  chiseled_sandstone: [1.8, 0.88, 1],
  bookshelf: [2.0, 0.75, 1],
  bed: [1.2, 1.0, 1],
});
for (const name of Object.keys(PLANK_RAMPS)) tileRelief[name] = [2.0, 0.66, 1];
