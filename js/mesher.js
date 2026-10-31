// Chunk mesher: turns a chunk's blocks + light (and a 1-block border from
// its 8 neighbors) into compact vertex buffers, with per-vertex ambient
// occlusion and smooth lighting. Pure JS (no three.js): returns typed
// arrays that world.js wraps in BufferGeometry.
//
// Per-vertex attributes:
//   position  Float32 x3  chunk-local position
//   uv        Float32 x2  texture coordinate within the block's tile
//   aData     Uint8   x4  [normalIndex * 4 + ao (0-3), sky light * 17, block light * 17, flags]
//   aExtra    Uint8   x4  [texture layer (low byte), water depth * 16, color tint (128 = none), texture layer (high byte)]
//             (Round 12: on an animated face, not water, the second byte is
//             its flipbook (FLAG.ANIM) or its flow direction (FLAG.FLOW);
//             Round 14: on lava's top the tint byte holds its shore edges,
//             and on the haze's sheet the second byte its strength * 16)
//
// (Round 11) Block ids are 16-bit (the padded volume is a Uint16Array) and
// the texture layer takes two bytes (Round 12: TILE_CAPACITY layers, see
// js/content/base.js). A content module's shapes (SHAPE_MESH, see
// js/content/index.js) are meshed here through `shapeApi`, the same on the
// main thread and in the workers.
import { CHUNK_SIZE, WORLD_HEIGHT } from "./constants.js";
import {
  BLOCK,
  IS_OPAQUE,
  IS_SOLID,
  RENDER_TYPE,
  RENDER,
  SHAPE_OF,
  SHAPE,
  FACE_TILES,
  WAVES,
  EMISSIVE,
  IS_LEAVES,
  IS_WET,
  IS_WATERLOGGED,
  BLOCK_INFO,
  CHEST_BOX,
  BLOCK_LIMIT,
  SHAPE_CUSTOM,
  SHAPE_MESH,
  TILE,
} from "./blocks.js";
import { TILE_CAPACITY, TILE_FLIPBOOKS, TILE_FLOWING } from "./content/base.js";
import { isLava, lavaLevel } from "./content/nature.js";

// FOLIAGE: leaves and plants (sunlight shines through them). (Round 12)
// ANIM: a flipbook tile (the shader plays its frames); FLOW: a flowing
// liquid's tile (lava: drawn moving, along its flow direction). (Round 14)
// HAZE: the heat haze's sheet above lava (in the water's bucket, see emitLava).
export const FLAG = Object.freeze({ WAVE: 1, EMISSIVE: 2, SURFACE: 4, UNDERWATER: 8, FOLIAGE: 16, ANIM: 32, FLOW: 64, HAZE: 128 });

// (Round 12) Per texture layer: 0, a flipbook's index + 1, or ANIM_FLOW.
const ANIM_FLOW = 255;
const TILE_ANIM = new Uint8Array(TILE_CAPACITY);
TILE_FLIPBOOKS.forEach((f, k) => {
  if (TILE[f.tile] !== undefined) TILE_ANIM[TILE[f.tile]] = k + 1;
});
for (const name of TILE_FLOWING) if (TILE[name] !== undefined) TILE_ANIM[TILE[name]] = ANIM_FLOW;
export const WATER_SURFACE_HEIGHT = 0.875;

const S = CHUNK_SIZE;
const H = WORLD_HEIGHT;
const P = S + 2; // padded width
const PY = H + 2; // padded height
const OX = 1;
const OZ = P;
const OY = P * P;

function pidx(x, y, z) {
  return ((y + 1) * P + (z + 1)) * P + (x + 1);
}

const padBlocks = new Uint16Array(P * P * PY);
const padLight = new Uint8Array(P * P * PY);

// Faces in FACE order (+X, -X, +Y, -Y, +Z, -Z). Corners are counter-
// clockwise seen from outside; uv(c) gives an upright texture on sides.
const FACE_DEFS = [
  { n: [1, 0, 0], corners: [[1, 0, 0], [1, 1, 0], [1, 1, 1], [1, 0, 1]], uv: (c) => [1 - c[2], c[1]] },
  { n: [-1, 0, 0], corners: [[0, 0, 1], [0, 1, 1], [0, 1, 0], [0, 0, 0]], uv: (c) => [c[2], c[1]] },
  { n: [0, 1, 0], corners: [[0, 1, 1], [1, 1, 1], [1, 1, 0], [0, 1, 0]], uv: (c) => [c[0], 1 - c[2]] },
  { n: [0, -1, 0], corners: [[0, 0, 0], [1, 0, 0], [1, 0, 1], [0, 0, 1]], uv: (c) => [c[0], c[2]] },
  { n: [0, 0, 1], corners: [[1, 0, 1], [1, 1, 1], [0, 1, 1], [0, 0, 1]], uv: (c) => [c[0], c[1]] },
  { n: [0, 0, -1], corners: [[0, 0, 0], [0, 1, 0], [1, 1, 0], [1, 0, 0]], uv: (c) => [1 - c[0], c[1]] },
];

const offsetOf = (dx, dy, dz) => dx * OX + dy * OY + dz * OZ;

// Precomputed per face: neighbor offset, and per corner: position, uv and
// the padded-index offsets of the (side1, side2, corner) cells in the
// neighbor layer that shade that vertex.
const FACES = FACE_DEFS.map((def, f) => {
  const [nx, ny, nz] = def.n;
  const axis = nx !== 0 ? 0 : ny !== 0 ? 1 : 2;
  const tangents = [0, 1, 2].filter((a) => a !== axis);
  const unit = (a, s) => [a === 0 ? s : 0, a === 1 ? s : 0, a === 2 ? s : 0];
  const corners = def.corners.map((c) => {
    const s1 = c[tangents[0]] === 1 ? 1 : -1;
    const s2 = c[tangents[1]] === 1 ? 1 : -1;
    const t1 = unit(tangents[0], s1);
    const t2 = unit(tangents[1], s2);
    return {
      pos: c,
      uv: def.uv(c),
      side1: offsetOf(nx + t1[0], ny + t1[1], nz + t1[2]),
      side2: offsetOf(nx + t2[0], ny + t2[1], nz + t2[2]),
      corner: offsetOf(nx + t1[0] + t2[0], ny + t1[1] + t2[1], nz + t1[2] + t2[2]),
    };
  });
  // (axis, positive: the side of the cell the face is on, for boxes)
  return { index: f, n: def.n, axis, positive: nx + ny + nz > 0, neighbor: offsetOf(nx, ny, nz), corners, uvOf: def.uv };
});

// ---------- Growable vertex buffer builder (reused between chunks) ----------
class GeoBuilder {
  constructor(capacity = 16384) {
    this._alloc(capacity);
    this.vc = 0;
    this.ic = 0;
    this.lc = 0; // (Round 14) the lava's indices, kept apart (see quad)
    this.tint = 128; // color tint written with every vertex (128 = none)
    this.flow = 0; // (Round 12) the flow written on a flowing tile's vertices (Round 14: per vertex, see lavaCornerFlow)
  }
  _alloc(cap) {
    const old = this.cap ? this : null;
    this.cap = cap;
    const pos = new Float32Array(cap * 3);
    const uv = new Float32Array(cap * 2);
    const data = new Uint8Array(cap * 4);
    const extra = new Uint8Array(cap * 4);
    const index = new Uint32Array(cap * 1.5);
    const lavaIndex = new Uint32Array(cap * 1.5);
    if (old) {
      pos.set(old.pos.subarray(0, this.vc * 3));
      uv.set(old.uv.subarray(0, this.vc * 2));
      data.set(old.data.subarray(0, this.vc * 4));
      extra.set(old.extra.subarray(0, this.vc * 4));
      index.set(old.index.subarray(0, this.ic));
      lavaIndex.set(old.lavaIndex.subarray(0, this.lc));
    }
    this.pos = pos;
    this.uv = uv;
    this.data = data;
    this.extra = extra;
    this.index = index;
    this.lavaIndex = lavaIndex;
  }
  reset() {
    this.vc = 0;
    this.ic = 0;
    this.lc = 0;
  }
  vertex(x, y, z, u, v, d0, sky, blk, flags, layer, depth) {
    if (this.vc >= this.cap) this._alloc(this.cap * 2);
    const anim = TILE_ANIM[layer] | 0; // (| 0: a layer past the table)
    if (anim !== 0) {
      if (anim === ANIM_FLOW) {
        flags |= FLAG.FLOW;
        depth = this.flow;
      } else {
        flags |= FLAG.ANIM;
        depth = anim - 1;
      }
    }
    const i = this.vc++;
    this.pos[i * 3] = x;
    this.pos[i * 3 + 1] = y;
    this.pos[i * 3 + 2] = z;
    this.uv[i * 2] = u;
    this.uv[i * 2 + 1] = v;
    this.data[i * 4] = d0;
    this.data[i * 4 + 1] = sky;
    this.data[i * 4 + 2] = blk;
    this.data[i * 4 + 3] = flags;
    this.extra[i * 4] = layer & 255;
    this.extra[i * 4 + 1] = depth;
    this.extra[i * 4 + 2] = this.tint;
    this.extra[i * 4 + 3] = layer >> 8;
  }
  // Indices for the last 4 vertices; `flip` picks the other diagonal.
  // (Round 14) A flowing tile's quad (lava) goes after all the others: the
  // chunk draws that range with lava's own material (result's lavaStart,
  // chunk.js), so the rest of the terrain's shader doesn't carry lava's.
  quad(flip) {
    const b = this.vc - 4;
    const lava = (this.data[b * 4 + 3] & FLAG.FLOW) !== 0;
    const idx = lava ? this.lavaIndex : this.index;
    const i = lava ? this.lc : this.ic;
    if (flip) {
      idx[i] = b + 1; idx[i + 1] = b + 2; idx[i + 2] = b + 3;
      idx[i + 3] = b + 1; idx[i + 4] = b + 3; idx[i + 5] = b;
    } else {
      idx[i] = b; idx[i + 1] = b + 1; idx[i + 2] = b + 2;
      idx[i + 3] = b; idx[i + 4] = b + 2; idx[i + 5] = b + 3;
    }
    if (lava) this.lc += 6;
    else this.ic += 6;
  }
  result() {
    if (this.vc === 0) return null;
    const vc = this.vc;
    const n = this.ic + this.lc;
    const index = vc > 65535 ? new Uint32Array(n) : new Uint16Array(n);
    index.set(this.index.subarray(0, this.ic));
    if (this.lc) index.set(this.lavaIndex.subarray(0, this.lc), this.ic);
    const out = {
      vertexCount: vc,
      position: this.pos.slice(0, vc * 3),
      uv: this.uv.slice(0, vc * 2),
      data: this.data.slice(0, vc * 4),
      extra: this.extra.slice(0, vc * 4),
      index,
    };
    if (this.lc) out.lavaStart = this.ic; // (the lava's quads from here on)
    return out;
  }
}

const builders = {
  [RENDER.OPAQUE]: new GeoBuilder(),
  [RENDER.CUTOUT]: new GeoBuilder(4096),
  [RENDER.WATER]: new GeoBuilder(4096),
};

// Copies the chunk and a 1-block border of its neighbors into the padded
// scratch volume. `neighbors[(dz + 1) * 3 + (dx + 1)]` is the chunk at
// offset (dx, dz) (index 4 is the chunk itself); missing ones read as open
// sky. Returns the highest y containing any non-air block.
function fillPadded(neighbors) {
  let maxY = -1;
  const center = neighbors[4];
  for (let pz = -1; pz <= S; pz++) {
    const nzi = pz < 0 ? 0 : pz >= S ? 2 : 1;
    const sz = pz & 15;
    for (let px = -1; px <= S; px++) {
      const src = neighbors[nzi * 3 + (px < 0 ? 0 : px >= S ? 2 : 1)];
      const sx = px & 15;
      let pi = pidx(px, 0, pz);
      if (src) {
        const blocks = src.blocks;
        const light = src.light;
        let si = (sz << 4) | sx;
        for (let y = 0; y < H; y++, pi += OY, si += 256) {
          padBlocks[pi] = blocks[si];
          padLight[pi] = light[si];
        }
      } else {
        for (let y = 0; y < H; y++, pi += OY) {
          padBlocks[pi] = BLOCK.AIR;
          padLight[pi] = 0xf0;
        }
      }
      // Below the world: solid and dark. Above: open sky.
      padBlocks[pidx(px, -1, pz)] = BLOCK.BEDROCK;
      padLight[pidx(px, -1, pz)] = 0;
      padBlocks[pidx(px, H, pz)] = BLOCK.AIR;
      padLight[pidx(px, H, pz)] = 0xf0;
    }
  }
  const blocks = center.blocks;
  for (let i = blocks.length - 1; i >= 0; i--) {
    if (blocks[i] !== BLOCK.AIR) {
      maxY = i >> 8;
      break;
    }
  }
  return maxY;
}

function hash01(x, y, z) {
  let h = Math.imul(x | 0, 374761393) ^ Math.imul(y | 0, 668265263) ^ Math.imul(z | 0, 2147483647);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

// Smooth value noise (0-1) over the ground, with lattice cells `cell` blocks wide.
function smooth01(x, z, cell, salt) {
  const fx = x / cell;
  const fz = z / cell;
  const ix = Math.floor(fx);
  const iz = Math.floor(fz);
  let tx = fx - ix;
  let tz = fz - iz;
  tx = tx * tx * (3 - 2 * tx);
  tz = tz * tz * (3 - 2 * tz);
  const a = hash01(ix, salt, iz);
  const b = hash01(ix + 1, salt, iz);
  const c = hash01(ix, salt, iz + 1);
  const d = hash01(ix + 1, salt, iz + 1);
  return a + (b - a) * tx + (c - a) * tz + (a - b - c + d) * tx * tz;
}

// Natural color variation: leaves differ from tree to tree and block to
// block, grass drifts in broad patches across a meadow (128 = no tint).
function foliageTint(wx, y, wz) {
  const v = smooth01(wx, wz, 7, 3) * 0.65 + hash01(wx, y, wz) * 0.35;
  return Math.max(16, Math.min(240, Math.round(128 + (v - 0.5) * 230)));
}
export function grassTint(wx, wz) {
  const v = smooth01(wx, wz, 11, 5) * 0.75 + smooth01(wx, wz, 3, 9) * 0.25;
  return Math.max(24, Math.min(232, Math.round(128 + (v - 0.5) * 200)));
}

// Depth of water in the column at padded (x, z) starting at y and going
// down (0 if that cell isn't water).
function waterDepth(x, y, z) {
  let d = 0;
  let pi = pidx(x, y, z);
  while (d < 15 && IS_WET[padBlocks[pi]]) {
    d++;
    pi -= OY;
  }
  return d;
}

const aoVals = [0, 0, 0, 0];
const skyVals = [0, 0, 0, 0];
const blkVals = [0, 0, 0, 0];

// Computes AO (0-3) and averaged sky/block light for the 4 corners of face
// `face` of the block at padded index `pi`.
function shadeCorners(pi, face) {
  const npi = pi + face.neighbor;
  const nl = padLight[npi];
  for (let c = 0; c < 4; c++) {
    const corner = face.corners[c];
    const i1 = npi - face.neighbor + corner.side1;
    const i2 = npi - face.neighbor + corner.side2;
    const i3 = npi - face.neighbor + corner.corner;
    const o1 = IS_OPAQUE[padBlocks[i1]];
    const o2 = IS_OPAQUE[padBlocks[i2]];
    const o3 = IS_OPAQUE[padBlocks[i3]];
    aoVals[c] = o1 && o2 ? 0 : 3 - (o1 + o2 + o3);
    let sky = nl >> 4;
    let blk = nl & 15;
    let n = 1;
    if (!o1) {
      sky += padLight[i1] >> 4;
      blk += padLight[i1] & 15;
      n++;
    }
    if (!o2) {
      sky += padLight[i2] >> 4;
      blk += padLight[i2] & 15;
      n++;
    }
    if (!o3 && !(o1 && o2)) {
      sky += padLight[i3] >> 4;
      blk += padLight[i3] & 15;
      n++;
    }
    skyVals[c] = Math.round((sky / n) * 17);
    blkVals[c] = Math.round((blk / n) * 17);
  }
}

function emitCubeFace(b, face, x, y, z, layer, flags, topY, depths) {
  const fi = face.index;
  for (let c = 0; c < 4; c++) {
    const corner = face.corners[c];
    const p = corner.pos;
    let vy = y + p[1];
    let vflags = flags;
    if (topY !== 1 && p[1] === 1) {
      vy = y + topY; // lowered water surface
      vflags |= FLAG.SURFACE;
    }
    b.vertex(x + p[0], vy, z + p[2], corner.uv[0], corner.uv[1], fi * 4 + aoVals[c], skyVals[c], blkVals[c], vflags, layer, depths ? depths[c] : 0);
  }
  // Split the quad along the diagonal that keeps dark corners contained.
  const a02 = aoVals[0] + aoVals[2];
  const a13 = aoVals[1] + aoVals[3];
  b.quad(a02 < a13 || (a02 === a13 && skyVals[0] + skyVals[2] + blkVals[0] + blkVals[2] < skyVals[1] + skyVals[3] + blkVals[1] + blkVals[3]));
}

function emitCross(b, x, y, z, wx, wz, id, pi) {
  const layer = FACE_TILES[id * 6 + 2];
  const l = padLight[pi];
  const sky = (l >> 4) * 17;
  const blk = (l & 15) * 17;
  // Jitter the plant's position a little so fields of grass look natural.
  const jx = (hash01(wx, y, wz) - 0.5) * 0.3;
  const jz = (hash01(wz, y, wx) - 0.5) * 0.3;
  const height = 0.85 + hash01(wx + 7, y, wz - 3) * 0.2;
  const lo = 0.15;
  const hi = 0.85;
  const top = WAVES[id] ? FLAG.WAVE : 0;
  b.tint = id === BLOCK.TALL_GRASS ? grassTint(wx, wz) : 128;
  const up = 2 * 4 + 3; // normal index "up", no AO
  const quads = [
    [lo, lo, hi, hi],
    [lo, hi, hi, lo],
  ];
  for (const [x0, z0, x1, z1] of quads) {
    const ax = x + x0 + jx;
    const az = z + z0 + jz;
    const bx = x + x1 + jx;
    const bz = z + z1 + jz;
    b.vertex(ax, y, az, 0, 0, up, sky, blk, FLAG.FOLIAGE, layer, 0);
    b.vertex(ax, y + height, az, 0, 1, up, sky, blk, top | FLAG.FOLIAGE, layer, 0);
    b.vertex(bx, y + height, bz, 1, 1, up, sky, blk, top | FLAG.FOLIAGE, layer, 0);
    b.vertex(bx, y, bz, 1, 0, up, sky, blk, FLAG.FOLIAGE, layer, 0);
    b.quad(false);
  }
  b.tint = 128;
}

// Fancy leaves (High/Ultra): two extra leaf "cards" through every leaf
// block on the outside of a canopy, turned to a random angle and a little
// larger than the block, so canopies look fuller and their silhouettes
// break up instead of reading as stacked cubes. They sway with the leaves
// and take the brightest light around the block (leaves themselves block
// sky light).
const NEIGHBOR_STEPS = [OX, -OX, OY, -OY, OZ, -OZ];
function emitLeafCards(b, x, y, z, wx, wz, id, pi) {
  const layer = FACE_TILES[id * 6 + 2];
  let sky = 0;
  let blk = 0;
  for (const step of NEIGHBOR_STEPS) {
    const l = padLight[pi + step];
    sky = Math.max(sky, l >> 4);
    blk = Math.max(blk, l & 15);
  }
  sky *= 17;
  blk *= 17;
  const flags = (WAVES[id] ? FLAG.WAVE : 0) | FLAG.FOLIAGE;
  const up = 2 * 4 + 3;
  const angle = hash01(wx, y, wz) * Math.PI;
  // Within the block's height (no fins above a flat canopy top), but wider
  // than the block, so the cards poke out past its edges and corners.
  const half = 0.66 + hash01(wz, y, wx) * 0.1;
  const cx = x + 0.5 + (hash01(wx + 3, y, wz) - 0.5) * 0.16;
  const cz = z + 0.5 + (hash01(wx, y, wz + 5) - 0.5) * 0.16;
  const y0 = y + 0.02;
  const y1 = y + 0.98;
  for (let k = 0; k < 2; k++) {
    const a = angle + k * (Math.PI / 2);
    const dx = Math.cos(a) * half;
    const dz = Math.sin(a) * half;
    b.vertex(cx - dx, y0, cz - dz, 0, 0, up, sky, blk, flags, layer, 0);
    b.vertex(cx - dx, y1, cz - dz, 0, 1, up, sky, blk, flags, layer, 0);
    b.vertex(cx + dx, y1, cz + dz, 1, 1, up, sky, blk, flags, layer, 0);
    b.vertex(cx + dx, y0, cz + dz, 1, 0, up, sky, blk, flags, layer, 0);
    b.quad(false);
  }
}

// Torch: a thin stick (2x10 sixteenths of a block) textured from the middle
// 4-pixel column of the 32x32 torch tile, whose flame sits at the top.
const TORCH_MIN = 7 / 16;
const TORCH_MAX = 9 / 16;
const TORCH_H = 10 / 16;
const TU0 = 14 / 32;
const TU1 = 18 / 32;
function emitTorch(b, x, y, z, id, pi) {
  const layer = FACE_TILES[id * 6 + 2];
  const l = padLight[pi];
  const sky = (l >> 4) * 17;
  const blk = (l & 15) * 17;
  const flags = FLAG.EMISSIVE;
  for (const face of FACES) {
    const fi = face.index;
    for (let c = 0; c < 4; c++) {
      const p = face.corners[c].pos;
      const px = x + (p[0] ? TORCH_MAX : TORCH_MIN);
      const py = y + p[1] * TORCH_H;
      const pz = z + (p[2] ? TORCH_MAX : TORCH_MIN);
      let u;
      let v;
      const [fu, fv] = face.corners[c].uv;
      if (fi === 2) {
        u = TU0 + fu * (TU1 - TU0); // flame top
        v = 16 / 32 + fv * (4 / 32);
      } else if (fi === 3) {
        u = TU0 + fu * (TU1 - TU0);
        v = fv * (4 / 32);
      } else {
        u = TU0 + fu * (TU1 - TU0);
        v = fv * (20 / 32);
      }
      b.vertex(px, py, pz, u, v, fi * 4 + 3, sky, blk, flags, layer, 0);
    }
    b.quad(false);
  }
}

// (Round 10) Wall torch: the standing torch's stick, leaned 22.5 degrees out
// from the wall with its foot against it, 3.5/16 up (as in classic block
// games). The geometry of each facing is worked out once here: the same
// numbers on the main thread and in the workers.
const WALL_TORCH_TILT = Math.PI / 8;
const WALL_TORCH_GEOM = [];
for (let id = 0; id < BLOCK_LIMIT; id++) {
  const facing = SHAPE_OF[id] === SHAPE.WALL_TORCH ? BLOCK_INFO[id].facing : null;
  if (!facing) continue;
  const [dx, dz] = facing;
  // Local frame: x out from the wall, y up, z along the wall (px, pz: x and
  // z in the block); the stick is 2/16 square and 10/16 tall about its foot.
  const cos = Math.cos(WALL_TORCH_TILT);
  const sin = Math.sin(WALL_TORCH_TILT);
  const footX = 0.5 - dx * (0.5 - 1 / 16);
  const footZ = 0.5 - dz * (0.5 - 1 / 16);
  const toBlock = (lx, ly, lz) => {
    const rx = lx * cos + ly * sin; // (leaning out: the top moves away from the wall)
    const ry = -lx * sin + ly * cos;
    return [footX + rx * dx - lz * dz, 3.5 / 16 + ry, footZ + rx * dz + lz * dx];
  };
  // A local face normal, in block axes: the face index lighting uses.
  const faceOf = (n) => {
    const w = [n[0] * dx - n[2] * dz, n[1], n[0] * dz + n[2] * dx];
    return w[0] > 0.5 ? 0 : w[0] < -0.5 ? 1 : w[1] > 0.5 ? 2 : w[1] < -0.5 ? 3 : w[2] > 0.5 ? 4 : 5;
  };
  const faces = [];
  for (const face of FACES) {
    const fi = face.index;
    const corners = [];
    for (let c = 0; c < 4; c++) {
      const p = face.corners[c].pos;
      const [fu, fv] = face.corners[c].uv;
      const u = TU0 + fu * (TU1 - TU0);
      const v = fi === 2 ? 16 / 32 + fv * (4 / 32) : fi === 3 ? fv * (4 / 32) : fv * (20 / 32);
      corners.push([...toBlock(p[0] ? 1 / 16 : -1 / 16, p[1] * TORCH_H, p[2] ? 1 / 16 : -1 / 16), u, v]);
    }
    faces.push({ normal: faceOf(face.n), corners });
  }
  WALL_TORCH_GEOM[id] = faces;
}

function emitWallTorch(b, x, y, z, id, pi) {
  const layer = FACE_TILES[id * 6 + 2];
  const l = padLight[pi];
  const sky = (l >> 4) * 17;
  const blk = (l & 15) * 17;
  for (const face of WALL_TORCH_GEOM[id]) {
    for (const c of face.corners) b.vertex(x + c[0], y + c[1], z + c[2], c[3], c[4], face.normal * 4 + 3, sky, blk, FLAG.EMISSIVE, layer, 0);
    b.quad(false);
  }
}

// (Round 10) Chest: a box a little smaller than the block (CHEST_BOX), its
// faces lit and shaded like a cube's from the cells around it. Its textures
// are painted to that size, so the uv is the corner's place in the block.
const CHEST_LO = [CHEST_BOX[0], CHEST_BOX[1], CHEST_BOX[2]];
const CHEST_HI = [CHEST_BOX[3], CHEST_BOX[4], CHEST_BOX[5]];
const chestCorner = [0, 0, 0];
function emitChest(b, x, y, z, id, pi) {
  for (let f = 0; f < 6; f++) {
    const face = FACES[f];
    const nid = padBlocks[pi + face.neighbor];
    if (f === 3 && IS_OPAQUE[nid]) continue; // (standing on the floor)
    shadeCorners(pi, face);
    const flags = IS_WET[nid] ? FLAG.UNDERWATER : 0;
    const layer = FACE_TILES[id * 6 + f];
    for (let c = 0; c < 4; c++) {
      const p = face.corners[c].pos;
      for (let a = 0; a < 3; a++) chestCorner[a] = p[a] ? CHEST_HI[a] : CHEST_LO[a];
      const [u, v] = face.uvOf(chestCorner);
      b.vertex(x + chestCorner[0], y + chestCorner[1], z + chestCorner[2], u, v, f * 4 + aoVals[c], skyVals[c], blkVals[c], flags, layer, 0);
    }
    const a02 = aoVals[0] + aoVals[2];
    const a13 = aoVals[1] + aoVals[3];
    b.quad(a02 < a13 || (a02 === a13 && skyVals[0] + skyVals[2] + blkVals[0] + blkVals[2] < skyVals[1] + skyVals[3] + blkVals[1] + blkVals[3]));
  }
}

// (Round 11) A box inside the cell (a content shape's m.box): each face lit
// and shaded like a cube's from the cells around it, or, for a face inside
// the cell (a slab's top), from the block's own cell; a face on the cell's
// side is skipped against an opaque neighbour. The uv is the corner's place
// in the block, so the texture is cut to the box (as in vanilla). skip: a
// bit mask (1 << face) of faces left out (one hidden inside another box);
// uv: [u0, v0, u1, v1], the part of the tile the cell's 0-1 uv maps onto
// (a tile holding a door's two halves, or a few small things).
const boxLo = [0, 0, 0];
const boxHi = [0, 0, 0];
const boxCorner = [0, 0, 0];
function emitBox(b, x, y, z, id, pi, x0, y0, z0, x1, y1, z1, tiles, skip, uv) {
  boxLo[0] = x0;
  boxLo[1] = y0;
  boxLo[2] = z0;
  boxHi[0] = x1;
  boxHi[1] = y1;
  boxHi[2] = z1;
  const base = (WAVES[id] ? FLAG.WAVE : 0) | (EMISSIVE[id] ? FLAG.EMISSIVE : 0);
  for (let f = 0; f < 6; f++) {
    if (skip & (1 << f)) continue;
    const face = FACES[f];
    const onSide = face.positive ? boxHi[face.axis] >= 1 : boxLo[face.axis] <= 0;
    const nid = padBlocks[pi + face.neighbor];
    if (onSide && IS_OPAQUE[nid]) continue;
    shadeCorners(onSide ? pi : pi - face.neighbor, face);
    const flags = onSide && IS_WET[nid] ? base | FLAG.UNDERWATER : base;
    const layer = tiles ? tiles[f] : FACE_TILES[id * 6 + f];
    for (let c = 0; c < 4; c++) {
      const p = face.corners[c].pos;
      for (let a = 0; a < 3; a++) boxCorner[a] = p[a] ? boxHi[a] : boxLo[a];
      let [u, v] = face.uvOf(boxCorner);
      if (uv) {
        u = uv[0] + u * (uv[2] - uv[0]);
        v = uv[1] + v * (uv[3] - uv[1]);
      }
      b.vertex(x + boxCorner[0], y + boxCorner[1], z + boxCorner[2], u, v, f * 4 + aoVals[c], skyVals[c], blkVals[c], flags, layer, 0);
    }
    const a02 = aoVals[0] + aoVals[2];
    const a13 = aoVals[1] + aoVals[3];
    b.quad(a02 < a13 || (a02 === a13 && skyVals[0] + skyVals[2] + blkVals[0] + blkVals[2] < skyVals[1] + skyVals[3] + blkVals[1] + blkVals[3]));
  }
}

// What a content shape's mesh(m) gets (see js/content/index.js): the cell
// being meshed and a few ways to emit geometry into its block's bucket.
const shapeApi = {
  id: 0,
  x: 0,
  y: 0,
  z: 0,
  wx: 0,
  wz: 0,
  _pi: 0,
  _b: null,
  box(x0, y0, z0, x1, y1, z1, tiles = null, skip = 0, uv = null) {
    emitBox(this._b, this.x, this.y, this.z, this.id, this._pi, x0, y0, z0, x1, y1, z1, tiles, skip, uv);
  },
  quad(corners, uvs, face, tile) {
    const l = padLight[this._pi];
    const flags = (WAVES[this.id] ? FLAG.WAVE : 0) | (EMISSIVE[this.id] ? FLAG.EMISSIVE : 0);
    for (let c = 0; c < 4; c++) {
      const p = corners[c];
      this._b.vertex(this.x + p[0], this.y + p[1], this.z + p[2], uvs[c][0], uvs[c][1], face * 4 + 3, (l >> 4) * 17, (l & 15) * 17, flags, tile, 0);
    }
    this._b.quad(false);
  },
  neighbor(dx, dy, dz) {
    return padBlocks[this._pi + dx * OX + dy * OY + dz * OZ];
  },
  tile(face) {
    return FACE_TILES[this.id * 6 + face];
  },
};

// (Round 12) Lava's surface height in the padded cell pi (as js/content/
// nature.js draws it: 8/9 for a source, 2/9 less a block of flow, the full
// cell under more lava), or -1 if it isn't lava.
function lavaSurface(pi) {
  const id = padBlocks[pi];
  if (!isLava(id)) return -1;
  return isLava(padBlocks[pi + OY]) ? 1 : (8 - 2 * lavaLevel(id)) / 9;
}

// (Round 14) Lava, meshed here rather than by its content shape: vanilla's
// sloped surface (each corner of the top the weighted average of the lava
// around it, as vanilla's LiquidBlockRenderer: a cell 0.8 high or more
// counts ten times, an open cell beside it pulls the corner down, a solid
// one doesn't count, lava above any of them lifts it to the top), so a flow
// runs down in one smooth sheet instead of stairs, and between two lava
// cells no step is drawn. Every vertex carries the flow there (the downhill
// slope of the four cells around its corner), so the shader moves the
// crust along a smooth flow field across cells and chunks; the top's tint
// byte holds which of its edges meet something else (the glowing rim, see
// shaders.js lavaColor). With `haze` (the High/Ultra meshing) a sheet above
// a lava surface out in the open, in the water's pass, shimmers what is
// seen through it (shaders.js, the water's haze).
const CORNER_CELLS = [0, OX, OZ, OX + OZ]; // the 2x2 cells around a corner, from its (-x, -z) cell
// Corner (cx, cz) of the cell at pi: the padded index of the (-x, -z) cell of the four around it.
const cornerBase = (pi, cx, cz) => pi + (cx - 1) * OX + (cz - 1) * OZ;
function lavaCornerHeight(p0) {
  let sum = 0;
  let w = 0;
  for (const o of CORNER_CELLS) {
    const c = p0 + o;
    const id = padBlocks[c];
    if (isLava(id)) {
      if (isLava(padBlocks[c + OY])) return 1;
      const h = (8 - 2 * lavaLevel(id)) / 9;
      const k = h >= 0.8 ? 10 : 1;
      sum += h * k;
      w += k;
    } else if (!IS_SOLID[id]) w += 1;
  }
  return w > 0 ? sum / w : 1;
}
// The height the flow sees in cell c: its surface, or for an open cell the
// surface of lava under it less a block (it falls there); NaN for neither.
function lavaFlowHeight(c) {
  const h = lavaSurface(c);
  if (h >= 0) return h;
  if (IS_OPAQUE[padBlocks[c]]) return NaN;
  const below = lavaSurface(c - OY);
  return below >= 0 ? below - 1 : NaN;
}
// The flow at a corner as a byte: 0 still, else 1 + one of 16 directions
// (around from +X toward +Z) + 16 x speed (1-14).
function lavaCornerFlow(p0) {
  const h00 = lavaFlowHeight(p0);
  const h10 = lavaFlowHeight(p0 + OX);
  const h01 = lavaFlowHeight(p0 + OZ);
  const h11 = lavaFlowHeight(p0 + OX + OZ);
  let gx = 0;
  let gz = 0;
  let nx = 0;
  let nz = 0;
  if (h00 === h00 && h10 === h10) (gx += h10 - h00), nx++;
  if (h01 === h01 && h11 === h11) (gx += h11 - h01), nx++;
  if (h00 === h00 && h01 === h01) (gz += h01 - h00), nz++;
  if (h10 === h10 && h11 === h11) (gz += h11 - h10), nz++;
  const fx = nx ? -gx / nx : 0;
  const fz = nz ? -gz / nz : 0;
  const m = Math.hypot(fx, fz);
  if (m < 0.02) return 0;
  const speed = Math.max(1, Math.min(14, Math.round((m / 0.9) * 14)));
  return 1 + (Math.round(Math.atan2(fz, fx) / (Math.PI / 8)) & 15) + 16 * speed;
}
// A lava cell with open air above (a surface the haze rises from).
const lavaOpen = (c) => isLava(padBlocks[c]) && padBlocks[c + OY] === BLOCK.AIR;
// The top's corners in FACES[2] order ([0, 1, 1], [1, 1, 1], [1, 1, 0], [0, 1, 0]), and the sides'.
const LAVA_TOP = [[0, 1], [1, 1], [1, 0], [0, 0]];
const CORNER_OF = [3, 0, 2, 1]; // LAVA_TOP's index of corner (x, z), by x * 2 + z
const LAVA_SIDES = [
  [0, OX],
  [1, -OX],
  [4, OZ],
  [5, -OZ],
];
// Shore bits on the top's tint: +X 1, -X 2, +Z 4, -Z 8, then the corners
// (+X+Z 16, -X+Z 32, -X-Z 64, +X-Z 128) where both sides beside it are lava.
const SHORE_CORNERS = [
  [16, OX + OZ, 1, 4],
  [32, -OX + OZ, 2, 4],
  [64, -OX - OZ, 2, 8],
  [128, OX - OZ, 1, 8],
];
const lavaH = [0, 0, 0, 0];
const lavaF = [0, 0, 0, 0];
function emitLava(b, wb, x, y, z, id, pi, haze) {
  const layer = FACE_TILES[id * 6 + 2];
  const flags = FLAG.EMISSIVE;
  const l = padLight[pi];
  const sky = (l >> 4) * 17;
  const blk = (l & 15) * 17;
  const full = isLava(padBlocks[pi + OY]); // (falling, or under more lava: no top)
  const up = 2 * 4 + 3;
  if (full) lavaH.fill(1);
  else {
    for (let c = 0; c < 4; c++) {
      const [cx, cz] = LAVA_TOP[c];
      const p0 = cornerBase(pi, cx, cz);
      lavaH[c] = lavaCornerHeight(p0);
      lavaF[c] = lavaCornerFlow(p0);
    }
    let shore = 0;
    for (let s = 0; s < 4; s++) if (!isLava(padBlocks[pi + LAVA_SIDES[s][1]])) shore |= 1 << s;
    for (const [bit, step, a, c] of SHORE_CORNERS) if (!(shore & (a | c)) && !isLava(padBlocks[pi + step])) shore |= bit;
    const la = padLight[pi + OY];
    const topSky = IS_OPAQUE[padBlocks[pi + OY]] ? sky : Math.max(l >> 4, la >> 4) * 17;
    b.tint = shore;
    for (let c = 0; c < 4; c++) {
      const [cx, cz] = LAVA_TOP[c];
      b.flow = lavaF[c];
      b.vertex(x + cx, y + lavaH[c], z + cz, cx, 1 - cz, up, topSky, blk, flags, layer, 0);
    }
    b.quad(lavaH[0] + lavaH[2] > lavaH[1] + lavaH[3]);
    b.tint = 128;
    if (haze && padBlocks[pi + OY] === BLOCK.AIR) {
      // (faded out toward the edge of the open lava, so the sheet has no rim)
      for (let c = 0; c < 4; c++) {
        const [cx, cz] = LAVA_TOP[c];
        const p0 = cornerBase(pi, cx, cz);
        let n = 0;
        for (const o of CORNER_CELLS) n += lavaOpen(p0 + o) ? 1 : 0;
        wb.vertex(x + cx, y + 1.3, z + cz, cx, 1 - cz, up, topSky, blk, FLAG.HAZE, 0, Math.round((n / 4) * (n / 4) * 16));
      }
      wb.quad(false);
    }
  }
  // The sides: none against lava (the slopes meet) or a solid face; down
  // from the corners' heights to the cell's bottom.
  b.flow = 0;
  for (let s = 0; s < 4; s++) {
    const [f, step] = LAVA_SIDES[s];
    const nid = padBlocks[pi + step];
    if (isLava(nid) || IS_OPAQUE[nid]) continue;
    const face = FACES[f];
    const nl = padLight[pi + step];
    const ssky = Math.max(l >> 4, nl >> 4) * 17;
    for (let c = 0; c < 4; c++) {
      const p = face.corners[c].pos;
      b.vertex(x + p[0], y + (p[1] ? lavaH[CORNER_OF[p[0] * 2 + p[2]]] : 0), z + p[2], face.corners[c].uv[0], face.corners[c].uv[1], f * 4 + 3, ssky, blk, flags, layer, 0);
    }
    b.quad(false);
  }
  const below = padBlocks[pi - OY];
  if (!isLava(below) && !IS_OPAQUE[below]) {
    const face = FACES[3];
    for (let c = 0; c < 4; c++) {
      const p = face.corners[c].pos;
      b.vertex(x + p[0], y, z + p[2], face.corners[c].uv[0], face.corners[c].uv[1], 3 * 4 + 3, sky, blk, flags, layer, 0);
    }
    b.quad(false);
  }
}

function emitShape(b, x, y, z, wx, wz, id, pi, shape) {
  const m = shapeApi;
  m.id = id;
  m.x = x;
  m.y = y;
  m.z = z;
  m.wx = wx;
  m.wz = wz;
  m._pi = pi;
  m._b = b;
  SHAPE_MESH[shape](m);
  b.tint = 128;
}

// neighbors: 9 chunks as described in fillPadded (center at index 4).
// options: { fancyLeaves } (see emitLeafCards).
// Returns { opaque, cutout, water } where each is null or a buffer set.
export function meshChunk(neighbors, options = {}) {
  const maxY = fillPadded(neighbors);
  return meshBody(neighbors[4].cx, neighbors[4].cz, maxY, options);
}

// (Perf) Meshing in two halves, for a worker (see world.js): the padded
// volume (the chunk, its border and light) taken on the main thread, where
// the chunks live; then meshPadded, the costly part, in the worker. The same
// buffers as meshChunk, byte for byte.
export function padChunk(neighbors) {
  const maxY = fillPadded(neighbors);
  return { maxY, blocks: padBlocks.slice(), light: padLight.slice() };
}

export function meshPadded(blocks, light, cx, cz, maxY, options = {}) {
  padBlocks.set(blocks);
  padLight.set(light);
  return meshBody(cx, cz, maxY, options);
}

function meshBody(cx, cz, maxY, options) {
  const fancyLeaves = !!options.fancyLeaves;
  for (const b of Object.values(builders)) b.reset();
  const baseX = cx * S;
  const baseZ = cz * S;
  const depths = [0, 0, 0, 0];

  for (let y = 0; y <= maxY; y++) {
    for (let z = 0; z < S; z++) {
      let pi = pidx(0, y, z);
      for (let x = 0; x < S; x++, pi++) {
        const id = padBlocks[pi];
        if (id === BLOCK.AIR) continue;
        const rt = RENDER_TYPE[id];
        if (rt === RENDER.NONE) continue;
        const b = builders[rt];
        const shape = SHAPE_OF[id];
        if (shape !== SHAPE.CUBE) {
          if (shape === SHAPE.CROSS) {
            emitCross(b, x, y, z, baseX + x, baseZ + z, id, pi);
            // A waterlogged plant (seagrass, kelp) stands in water: its cell
            // is drawn as water too, so it never looks like an air pocket.
            if (IS_WATERLOGGED[id]) emitCube(builders[RENDER.WATER], BLOCK.WATER, RENDER.WATER, x, y, z, baseX, baseZ, pi, depths, fancyLeaves);
          } else if (shape === SHAPE.TORCH) emitTorch(b, x, y, z, id, pi);
          else if (shape === SHAPE.WALL_TORCH) emitWallTorch(b, x, y, z, id, pi);
          else if (shape === SHAPE.CHEST) emitChest(b, x, y, z, id, pi);
          else if (isLava(id)) emitLava(b, builders[RENDER.WATER], x, y, z, id, pi, fancyLeaves);
          else if (shape >= SHAPE_CUSTOM) {
            emitShape(b, x, y, z, baseX + x, baseZ + z, id, pi, shape);
            if (IS_WATERLOGGED[id]) emitCube(builders[RENDER.WATER], BLOCK.WATER, RENDER.WATER, x, y, z, baseX, baseZ, pi, depths, fancyLeaves);
          }
          continue;
        }
        emitCube(b, id, rt, x, y, z, baseX, baseZ, pi, depths, fancyLeaves);
      }
    }
  }

  return {
    opaque: builders[RENDER.OPAQUE].result(),
    cutout: builders[RENDER.CUTOUT].result(),
    water: builders[RENDER.WATER].result(),
  };
}

// The visible faces of a full cube block `id` (render type `rt`) at padded
// (x, y, z) / index pi, into builder b.
function emitCube(b, id, rt, x, y, z, baseX, baseZ, pi, depths, fancyLeaves) {
  const isWater = rt === RENDER.WATER;
  let topY = 1;
  if (isWater && !IS_WET[padBlocks[pi + OY]]) topY = WATER_SURFACE_HEIGHT;
  let baseFlags = 0;
  if (WAVES[id]) baseFlags |= FLAG.WAVE;
  if (EMISSIVE[id]) baseFlags |= FLAG.EMISSIVE;
  const leaves = IS_LEAVES[id] === 1;
  if (leaves) {
    baseFlags |= FLAG.FOLIAGE;
    b.tint = foliageTint(baseX + x, y, baseZ + z);
  }
  let exposed = false;

  for (let f = 0; f < 6; f++) {
    const face = FACES[f];
    const nid = padBlocks[pi + face.neighbor];
    if (IS_OPAQUE[nid]) continue;
    if (rt !== RENDER.OPAQUE && nid === id) continue; // glass-glass, leaf-leaf, water-water
    if (isWater && IS_WET[nid]) continue; // water next to a waterlogged plant's water
    // Water's top face is visible from below the lowered surface even
    // if something non-opaque (e.g. a plant) sits on top; other faces
    // of water next to water were skipped above.
    exposed = true;
    shadeCorners(pi, face);
    let flags = baseFlags;
    if (id === BLOCK.GRASS) b.tint = f === 2 ? grassTint(baseX + x, baseZ + z) : 128;
    let faceDepths = null;
    if (isWater) {
      if (f === 2) {
        for (let c = 0; c < 4; c++) {
          const cp = face.corners[c].pos;
          // Average the depth of the (up to) 4 water columns meeting at this corner.
          let sum = 0;
          for (let k = 0; k < 4; k++) {
            const cx = x + cp[0] - (k & 1);
            const cz = z + cp[2] - (k >> 1);
            sum += waterDepth(cx, y, cz);
          }
          depths[c] = Math.min(255, Math.round((sum / 4) * 16));
        }
      } else {
        depths[0] = depths[1] = depths[2] = depths[3] = 16;
      }
      faceDepths = depths;
    } else if (IS_WET[nid]) {
      flags |= FLAG.UNDERWATER;
    }
    emitCubeFace(b, face, x, y, z, FACE_TILES[id * 6 + f], flags, isWater ? topY : 1, faceDepths);
  }
  if (fancyLeaves && exposed && leaves) emitLeafCards(b, x, y, z, baseX + x, baseZ + z, id, pi);
  b.tint = 128;
}
