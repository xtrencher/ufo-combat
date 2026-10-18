// The Nether's terrain (Round 12), as vanilla Java 1.20's: 128 blocks high
// between a bedrock floor (y 0-4) and a bedrock roof (y 123-127), carved
// into vast caverns by 3D noise, a lava sea up to y 31, and five biomes
// (vanilla's multi-noise points on two 2D noises, sharp borders):
// - Nether wastes: netherrack, glowstone hanging from the roofs, nether quartz
//   and gold ores, lava falls out of the walls, fire on the floors, soul
//   sand and gravel at the lava sea's shores, now and then a mushroom.
// - Soul sand valleys: floors of soul sand and soul soil, basalt pillars
//   from roof to floor, bone fossils, soul fire.
// - Crimson forests: crimson nylium, huge crimson fungi (nether wart caps,
//   shroomlights, weeping vines hanging from them and the roofs), roots
//   and fungi on the ground.
// - Warped forests: the same in warped (twisting vines up from the floor,
//   nether sprouts).
// - Basalt deltas: basalt and blackstone, basalt columns, lava pools rimmed
//   with magma, twice the ores.
// Everywhere: magma, gravel and blackstone blobs, ancient debris (never
// touching the air: one vein of 3 low down, one of 2 anywhere, a chunk),
// and the structures (js/nether-structures.js: fortresses, bastions,
// ruined portals). Vanilla's ore counts and heights.
//
// Speed: the density is sampled every 4 blocks across and 8 up and
// interpolated (a few hundred noise samples a chunk); a feature that can
// cross into the next chunk (a huge fungus, a lava delta) is replayed from
// its own chunk's seed by every chunk it reaches, its ground found from the
// same density (each chunk's sample grid is kept a while), so chunks agree
// wherever they are made (the workers, the main thread, blockIn).
// Pure (no three.js): the chunk workers run it.
import { BLOCK } from "./content/base.js";
import * as I from "./content/ids.js";
import { LAVA, OBSIDIAN, FIRE } from "./content/ids.js";
import { lavaFlowId } from "./content/nature.js";
import { pickForestPlant } from "./content/nether.js";
import { LIB } from "./content/base.js";
import { Noise, hash2, mulberry32 } from "./noise.js";
import { CHUNK_SIZE, WORLD_HEIGHT } from "./constants.js";
import { NetherStructures } from "./nether-structures.js";

export const NETHER_LAVA_LEVEL = 31;
export const NETHER_ROOF = 123; // (the lowest the bedrock roof reaches; vanilla's logical height is 128)

// The biomes (biomeAt's numbers).
export const NETHER_BIOME = Object.freeze({ WASTES: 0, SOUL_SAND_VALLEY: 1, CRIMSON_FOREST: 2, WARPED_FOREST: 3, BASALT_DELTAS: 4 });
export const NETHER_BIOME_NAMES = ["Nether Wastes", "Soul Sand Valley", "Crimson Forest", "Warped Forest", "Basalt Deltas"];
// Vanilla's fog colours (and what the air carries: js/nether-fx.js).
export const NETHER_FOG = [0x330808, 0x1b4745, 0x330303, 0x1a051a, 0x685f70];
// The creatures of each biome (vanilla's spawn lists: [kind, weight, min,
// max]; "monster" spawns in the dark, which is everywhere here, "creature"
// on lava: the strider), and of the fortresses' and bastions' bounds, for
// the creatures' part (js/mobs.js: DIMS.nether.spawnMobs, world.terrain.biomeAt
// and world.terrain.structures.fortressAt / bastionAt).
export const NETHER_SPAWNS = {
  [NETHER_BIOME.WASTES]: { monster: [["ghast", 50, 4, 4], ["zombified_piglin", 100, 4, 4], ["magma_cube", 2, 4, 4], ["enderman", 1, 4, 4], ["piglin", 15, 4, 4]], creature: [["strider", 60, 1, 2]] },
  [NETHER_BIOME.SOUL_SAND_VALLEY]: { monster: [["skeleton", 20, 5, 5], ["ghast", 50, 4, 4], ["enderman", 1, 4, 4]], creature: [["strider", 60, 1, 2]] },
  [NETHER_BIOME.CRIMSON_FOREST]: { monster: [["zombified_piglin", 1, 2, 4], ["hoglin", 9, 3, 4], ["piglin", 5, 3, 4]], creature: [["strider", 60, 1, 2]] },
  [NETHER_BIOME.WARPED_FOREST]: { monster: [["enderman", 1, 4, 4]], creature: [["strider", 60, 1, 2]] },
  [NETHER_BIOME.BASALT_DELTAS]: { monster: [["ghast", 40, 1, 1], ["magma_cube", 100, 2, 5]], creature: [["strider", 60, 1, 2]] },
  fortress: { monster: [["blaze", 10, 2, 3], ["zombified_piglin", 5, 4, 4], ["wither_skeleton", 8, 5, 5], ["skeleton", 2, 5, 5], ["magma_cube", 3, 4, 4]] },
};

const S = CHUNK_SIZE;
const H = WORLD_HEIGHT;
const SX = 4;
const SY = 8;
const NX = S / SX + 1;
const NY = H / SY + 1;
const GRID = NX * NY * NX;
const GRID_CACHE = 96; // chunks' density grids kept (the neighbours' features read them)

const AIR = BLOCK.AIR;
const BEDROCK = BLOCK.BEDROCK;
const ROCK = I.NETHERRACK;
const FLOW1 = lavaFlowId(1);
const isLavaId = (id) => id === LAVA || (id >= FLOW1 && id < FLOW1 + 3);
// The rock the features cut, grow from and stand on (vanilla's base stone of the Nether).
const BASE_STONE = new Uint8Array(4096);
for (const id of [ROCK, I.BASALT, I.BLACKSTONE, I.SOUL_SAND, I.SOUL_SOIL, I.CRIMSON_NYLIUM, I.WARPED_NYLIUM, BLOCK.GRAVEL, I.MAGMA_BLOCK]) BASE_STONE[id] = 1;

// Vanilla's nether biome points: [temperature, humidity, offset].
const BIOME_POINTS = [
  [0, 0, 0],
  [0, -0.5, 0],
  [0.4, 0, 0],
  [0, 0.5, 0.375],
  [-0.5, 0, 0.175],
];

const salted = (seed, cx, cz, salt) => mulberry32((seed ^ Math.imul(cx, 0x2545f491) ^ Math.imul(cz, 0x9e3779b9) ^ salt) >>> 0);
const between = (r, a, b) => a + Math.floor(r() * (b - a + 1));

export class NetherGenerator {
  constructor(seed, opts = {}) {
    this.seed = (seed ^ 0x4e455448) >>> 0;
    this.opts = opts;
    this.noise = new Noise(this.seed);
    this.detail = new Noise((this.seed ^ 0x9e3779b9) >>> 0);
    this.tempNoise = new Noise((this.seed ^ 0x7e3a11c5) >>> 0);
    this.humNoise = new Noise((this.seed ^ 0x51ed270b) >>> 0);
    this.patch = new Noise((this.seed ^ 0x2b1a4f9d) >>> 0);
    this._grids = new Map(); // "cx,cz" -> Float32Array (the density samples)
    this._bio = new Uint8Array(S * S);
    this.structures = new NetherStructures(this);
  }

  // ---------- Biomes ----------

  biomeAt(x, z) {
    const t = this.tempNoise.fbm2(x / 260, z / 260, 2) * 1.35;
    const h = this.humNoise.fbm2(x / 260, z / 260, 2) * 1.35;
    let best = 0;
    let bd = Infinity;
    for (let i = 0; i < BIOME_POINTS.length; i++) {
      const p = BIOME_POINTS[i];
      const d = (t - p[0]) ** 2 + (h - p[1]) ** 2 + p[2] * p[2];
      if (d < bd) {
        bd = d;
        best = i;
      }
    }
    return best;
  }

  // ---------- The density ----------

  // Solid (> 0) or open: big caverns and smaller passages, the rock closing
  // in toward the lava sea's bottom and the roof.
  _density(x, y, z) {
    const big = this.noise.perlin3(x / 72, y / 44, z / 72);
    const small = this.detail.perlin3(x / 26, y / 15, z / 26);
    const floor = y < 26 ? (26 - y) / 11 : 0;
    const roof = y > 98 ? (y - 98) / 13 : 0;
    // (a little more rock in the middle heights: shelves and bridges between the caverns)
    const mid = 0.08 - Math.abs(y - 62) / 400;
    return big * 1.05 + small * 0.48 + floor + roof + mid - 0.06;
  }

  _grid(cx, cz) {
    const key = `${cx},${cz}`;
    let g = this._grids.get(key);
    if (g) return g;
    g = new Float32Array(GRID);
    const bx = cx * S;
    const bz = cz * S;
    for (let iz = 0; iz < NX; iz++) for (let iy = 0; iy < NY; iy++) for (let ix = 0; ix < NX; ix++) g[(iz * NY + iy) * NX + ix] = this._density(bx + ix * SX, iy * SY, bz + iz * SX);
    this._grids.set(key, g);
    if (this._grids.size > GRID_CACHE) this._grids.delete(this._grids.keys().next().value);
    return g;
  }

  // The interpolated density at a block (any chunk's).
  densityAt(x, y, z) {
    if (y < 0 || y >= H) return 1;
    const cx = x >> 4;
    const cz = z >> 4;
    const g = this._grid(cx, cz);
    const lx = x & 15;
    const lz = z & 15;
    const ix = lx >> 2;
    const iz = lz >> 2;
    const iy = y >> 3;
    const fx = (lx & 3) / SX;
    const fz = (lz & 3) / SX;
    const fy = (y & 7) / SY;
    const at = (a, b, c) => g[(c * NY + b) * NX + a];
    const c00 = at(ix, iy, iz) + (at(ix + 1, iy, iz) - at(ix, iy, iz)) * fx;
    const c10 = at(ix, iy + 1, iz) + (at(ix + 1, iy + 1, iz) - at(ix, iy + 1, iz)) * fx;
    const c01 = at(ix, iy, iz + 1) + (at(ix + 1, iy, iz + 1) - at(ix, iy, iz + 1)) * fx;
    const c11 = at(ix, iy + 1, iz + 1) + (at(ix + 1, iy + 1, iz + 1) - at(ix, iy + 1, iz + 1)) * fx;
    return (c00 + (c10 - c00) * fy) * (1 - fz) + (c01 + (c11 - c01) * fy) * fz;
  }

  // Whether the generated cell is rock (before the features: the noise's
  // own answer, the bedrock counted as rock).
  solidAt(x, y, z) {
    if (y <= 0 || y >= H - 1) return true;
    return this.densityAt(x, y, z) > 0;
  }

  // The floor nearest under y in the column: the first open cell (air, not
  // the lava sea) with rock under it, scanning down at most `reach`; -1.
  floorBelow(x, y, z, reach = 48) {
    let open = !this.solidAt(x, y, z);
    for (let k = 1; k <= reach; k++) {
      const yy = y - k;
      if (yy <= NETHER_LAVA_LEVEL) return -1;
      const s = this.solidAt(x, yy, z);
      if (s && open) return yy + 1;
      open = !s;
    }
    return -1;
  }

  // ---------- A chunk ----------

  generate(chunk) {
    const blocks = chunk.blocks;
    const cx = chunk.cx;
    const cz = chunk.cz;
    const bx = cx * S;
    const bz = cz * S;
    const bio = this._bio;
    for (let z = 0; z < S; z++) for (let x = 0; x < S; x++) bio[z * S + x] = this.biomeAt(bx + x, bz + z);
    this._shape(blocks, cx, cz);
    this._surface(blocks, cx, cz);
    this._ores(blocks, cx, cz);
    this._springs(blocks, cx, cz);
    this._glowstone(blocks, cx, cz);
    this._biomeFeatures(blocks, cx, cz);
    this.structures.place(blocks, cx, cz);
  }

  // The rock, the bedrock and the lava sea.
  _shape(blocks, cx, cz) {
    const g = this._grid(cx, cz);
    const bx = cx * S;
    const bz = cz * S;
    const seed = this.seed;
    const at = (ix, iy, iz) => g[(iz * NY + iy) * NX + ix];
    for (let z = 0; z < S; z++) {
      const iz = z >> 2;
      const fz = (z & 3) / SX;
      for (let x = 0; x < S; x++) {
        const ix = x >> 2;
        const fx = (x & 3) / SX;
        const wx = bx + x;
        const wz = bz + z;
        const col = (z << 4) | x;
        for (let y = 0; y < H; y++) {
          const i = (y << 8) | col;
          // (vanilla's bedrock: y 0 and 127 always, thinning out over four layers)
          if (y < 5 || y >= H - 5) {
            const k = y < 5 ? y : H - 1 - y;
            if (k === 0 || hash2(seed ^ (y * 0x9e37), wx, wz) < (5 - k) / 5) {
              blocks[i] = BEDROCK;
              continue;
            }
          }
          const iy = y >> 3;
          const fy = (y & 7) / SY;
          const c00 = at(ix, iy, iz) + (at(ix + 1, iy, iz) - at(ix, iy, iz)) * fx;
          const c10 = at(ix, iy + 1, iz) + (at(ix + 1, iy + 1, iz) - at(ix, iy + 1, iz)) * fx;
          const c01 = at(ix, iy, iz + 1) + (at(ix + 1, iy, iz + 1) - at(ix, iy, iz + 1)) * fx;
          const c11 = at(ix, iy + 1, iz + 1) + (at(ix + 1, iy + 1, iz + 1) - at(ix, iy + 1, iz + 1)) * fx;
          const d = (c00 + (c10 - c00) * fy) * (1 - fz) + (c01 + (c11 - c01) * fy) * fz;
          blocks[i] = d > 0 ? ROCK : y <= NETHER_LAVA_LEVEL ? LAVA : AIR;
        }
      }
    }
  }

  // Each biome's ground and roof (vanilla's surface rules).
  _surface(blocks, cx, cz) {
    const bx = cx * S;
    const bz = cz * S;
    const pn = this.patch;
    for (let z = 0; z < S; z++) {
      for (let x = 0; x < S; x++) {
        const col = (z << 4) | x;
        const b = this._bio[z * S + x];
        const wx = bx + x;
        const wz = bz + z;
        const patchA = pn.perlin2(wx / 9, wz / 9);
        const patchB = pn.perlin2(wx / 7 + 31.7, wz / 7 - 12.3);
        let depth = -1; // solid cells since the last open one, going down (0: an exposed top)
        for (let y = H - 6; y >= 1; y--) {
          const i = (y << 8) | col;
          const id = blocks[i];
          if (id !== ROCK) {
            depth = -1;
            continue;
          }
          const above = blocks[i + 256];
          depth = above === AIR || isLavaId(above) ? 0 : depth < 0 ? -1 : depth + 1;
          const lavaTop = isLavaId(above);
          const below = blocks[i - 256];
          const ceiling = below === AIR;
          if (b === NETHER_BIOME.WASTES) {
            // (the lava sea's shores: soul sand and gravel patches)
            if (depth >= 0 && depth <= 1 && y >= NETHER_LAVA_LEVEL - 3 && y <= NETHER_LAVA_LEVEL + 4) {
              if (patchA > 0.22) blocks[i] = I.SOUL_SAND;
              else if (patchB > 0.26) blocks[i] = BLOCK.GRAVEL;
            }
          } else if (b === NETHER_BIOME.SOUL_SAND_VALLEY) {
            if (depth >= 0 && depth <= 2) blocks[i] = patchA > -0.12 ? I.SOUL_SAND : I.SOUL_SOIL;
            else if (depth >= 3 && depth <= 4) blocks[i] = I.SOUL_SOIL;
            else if (ceiling && patchB > 0.3) blocks[i] = I.SOUL_SOIL;
          } else if (b === NETHER_BIOME.CRIMSON_FOREST || b === NETHER_BIOME.WARPED_FOREST) {
            if (depth === 0 && !lavaTop) blocks[i] = b === NETHER_BIOME.CRIMSON_FOREST ? I.CRIMSON_NYLIUM : I.WARPED_NYLIUM;
          } else if (b === NETHER_BIOME.BASALT_DELTAS) {
            const near = (depth >= 0 && depth <= 3) || ceiling || blocks[i - 512] === AIR;
            if (near) blocks[i] = patchA + (depth === 0 ? 0.12 : 0) > -0.05 ? I.BASALT : I.BLACKSTONE;
            else if (patchB > 0.45) blocks[i] = I.BLACKSTONE;
          }
        }
      }
    }
  }

  // ---------- Ores and blobs ----------

  // Vanilla's OreFeature: `size` blocks in a run of spheres along a short
  // line, replacing what `can` allows (kept inside the chunk). exposed:
  // false: never a cell next to the air (ancient debris).
  _vein(blocks, rand, lx, y, lz, size, id, can, exposed = true) {
    const ang = rand() * Math.PI;
    const span = size / 8;
    const x0 = lx + Math.sin(ang) * span;
    const x1 = lx - Math.sin(ang) * span;
    const z0 = lz + Math.cos(ang) * span;
    const z1 = lz - Math.cos(ang) * span;
    const y0 = y + rand() * 2 - 1;
    const y1 = y + rand() * 2 - 1;
    let n = 0;
    for (let k = 0; k < size; k++) {
      const t = k / size;
      const px = x0 + (x1 - x0) * t;
      const py = y0 + (y1 - y0) * t;
      const pz = z0 + (z1 - z0) * t;
      const r = ((Math.sin(Math.PI * t) + 1) * rand() * size) / 32 + 0.5;
      const ax = Math.max(0, Math.floor(px - r));
      const bx = Math.min(S - 1, Math.floor(px + r));
      const ay = Math.max(1, Math.floor(py - r));
      const by = Math.min(H - 2, Math.floor(py + r));
      const az = Math.max(0, Math.floor(pz - r));
      const bz = Math.min(S - 1, Math.floor(pz + r));
      for (let xx = ax; xx <= bx; xx++) {
        for (let zz = az; zz <= bz; zz++) {
          for (let yy = ay; yy <= by; yy++) {
            const dx = (xx + 0.5 - px) / r;
            const dy = (yy + 0.5 - py) / r;
            const dz = (zz + 0.5 - pz) / r;
            if (dx * dx + dy * dy + dz * dz >= 1) continue;
            const i = (yy << 8) | (zz << 4) | xx;
            if (!can[blocks[i]]) continue;
            if (!exposed) {
              if (xx === 0 || xx === S - 1 || zz === 0 || zz === S - 1) continue;
              if (blocks[i + 1] === AIR || blocks[i - 1] === AIR || blocks[i + 16] === AIR || blocks[i - 16] === AIR || blocks[i + 256] === AIR || blocks[i - 256] === AIR) continue;
            }
            blocks[i] = id;
            n++;
          }
        }
      }
    }
    return n;
  }

  _ores(blocks, cx, cz) {
    const r = salted(this.seed, cx, cz, 0x0e5);
    const deltas = this._bio[136] === NETHER_BIOME.BASALT_DELTAS;
    const valley = this._bio[136] === NETHER_BIOME.SOUL_SAND_VALLEY;
    const ROCKY = ONLY_ROCK;
    const at = (lo, hi) => between(r, lo, hi);
    // (vanilla: quartz 16 veins of 14, gold 10 of 10, both from y 10 to 117; deltas twice)
    for (let k = 0, n = deltas ? 32 : 16; k < n; k++) this._vein(blocks, r, at(0, 15), at(10, 117), at(0, 15), 14, I.NETHER_QUARTZ_ORE, ROCKY);
    for (let k = 0, n = deltas ? 20 : 10; k < n; k++) this._vein(blocks, r, at(0, 15), at(10, 117), at(0, 15), 10, I.NETHER_GOLD_ORE, ROCKY);
    // (magma: 4 of 33 round the lava sea's level; gravel 2 of 33 low down; blackstone 2 of 33)
    for (let k = 0; k < 4; k++) this._vein(blocks, r, at(0, 15), at(27, 36), at(0, 15), 33, I.MAGMA_BLOCK, ROCKY);
    for (let k = 0; k < 2; k++) this._vein(blocks, r, at(0, 15), at(5, 41), at(0, 15), 33, BLOCK.GRAVEL, ROCKY);
    for (let k = 0; k < 2; k++) this._vein(blocks, r, at(0, 15), at(5, 31), at(0, 15), 33, I.BLACKSTONE, ROCKY);
    if (valley) for (let k = 0; k < 12; k++) this._vein(blocks, r, at(0, 15), at(0, 31), at(0, 15), 12, I.SOUL_SAND, ROCKY);
    // (ancient debris: one of 3 from y 8 to 24, mostly about 16, one of 2 anywhere from 8 to 119; never in the open)
    this._vein(blocks, r, at(1, 14), 8 + Math.round((r() + r()) * 8), at(1, 14), 3, I.ANCIENT_DEBRIS, DEBRIS_IN, false);
    this._vein(blocks, r, at(1, 14), at(8, 119), at(1, 14), 2, I.ANCIENT_DEBRIS, DEBRIS_IN, false);
  }

  // Lava falls: a source in a wall with one side open, its fall down to the
  // floor and a short spread there (vanilla's open springs flowing).
  _springs(blocks, cx, cz) {
    const r = salted(this.seed, cx, cz, 0x5b1);
    const fall = [];
    for (let k = 0; k < 6; k++) {
      const x = between(r, 1, 14);
      const z = between(r, 1, 14);
      const y = between(r, 34, 118);
      const i = (y << 8) | (z << 4) | x;
      if (!BASE_STONE[blocks[i]] || !BASE_STONE[blocks[i + 256]] || !BASE_STONE[blocks[i - 256]]) continue;
      let open = -1;
      let walls = 0;
      const nb = [1, -1, 16, -16];
      for (let d = 0; d < 4; d++) {
        const n = blocks[i + nb[d]];
        if (n === AIR) open = open < 0 ? d : 9;
        else if (BASE_STONE[n]) walls++;
      }
      if (open < 0 || open === 9 || walls !== 3) continue;
      blocks[i] = LAVA;
      const ox = x + (open === 0 ? 1 : open === 1 ? -1 : 0);
      const oz = z + (open === 2 ? 1 : open === 3 ? -1 : 0);
      if (ox < 0 || ox >= S || oz < 0 || oz >= S) continue;
      blocks[(y << 8) | (oz << 4) | ox] = FLOW1;
      fall.length = 0;
      let yy = y - 1;
      for (; yy > 1 && y - yy < 64; yy--) {
        const j = (yy << 8) | (oz << 4) | ox;
        if (blocks[j] !== AIR) break;
        blocks[j] = FLOW1;
      }
      // (where it lands: a spread of lower levels on the floor)
      const fy = yy + 1;
      if (yy <= 1 || isLavaId(blocks[(yy << 8) | (oz << 4) | ox]) || fy === y) continue;
      for (let dx = -2; dx <= 2; dx++) {
        for (let dz = -2; dz <= 2; dz++) {
          const dist = Math.abs(dx) + Math.abs(dz);
          if (!dist || dist > 2) continue;
          const sx = ox + dx;
          const sz = oz + dz;
          if (sx < 0 || sx >= S || sz < 0 || sz >= S) continue;
          const j = (fy << 8) | (sz << 4) | sx;
          if (blocks[j] === AIR && BASE_STONE[blocks[j - 256]]) blocks[j] = lavaFlowId(1 + dist);
        }
      }
    }
  }

  // Glowstone hanging from the roofs (vanilla's GlowstoneFeature: a cluster
  // grown down from a ceiling cell, each new crystal touching one other).
  _glowstone(blocks, cx, cz) {
    const r = salted(this.seed, cx, cz, 0x61b);
    const deltas = this._bio[136] === NETHER_BIOME.BASALT_DELTAS;
    const tries = deltas ? 2 : 6;
    const ceilings = [];
    for (let k = 0; k < tries; k++) {
      const x = between(r, 3, 12);
      const z = between(r, 3, 12);
      ceilings.length = 0;
      for (let y = NETHER_ROOF - 1; y > NETHER_LAVA_LEVEL + 6; y--) {
        const i = (y << 8) | (z << 4) | x;
        if (blocks[i] === AIR && BASE_STONE[blocks[i + 256]]) ceilings.push(y);
      }
      if (!ceilings.length || r() < 0.35) continue;
      // (high roofs more often, as vanilla's glowstone_extra)
      const oy = ceilings[Math.floor(r() * r() * ceilings.length)];
      blocks[(oy << 8) | (z << 4) | x] = I.GLOWSTONE;
      const n = 120 + Math.floor(r() * 220);
      for (let t = 0; t < n; t++) {
        const px = x + Math.floor(r() * 4) - Math.floor(r() * 4);
        const py = oy - Math.floor(r() * 10);
        const pz = z + Math.floor(r() * 4) - Math.floor(r() * 4);
        if (py < 2) continue;
        const i = (py << 8) | (pz << 4) | px;
        if (blocks[i] !== AIR) continue;
        let touch = 0;
        if (px < S - 1 && blocks[i + 1] === I.GLOWSTONE) touch++;
        if (px > 0 && blocks[i - 1] === I.GLOWSTONE) touch++;
        if (pz < S - 1 && blocks[i + 16] === I.GLOWSTONE) touch++;
        if (pz > 0 && blocks[i - 16] === I.GLOWSTONE) touch++;
        if (blocks[i + 256] === I.GLOWSTONE) touch++;
        if (blocks[i - 256] === I.GLOWSTONE) touch++;
        if (touch === 1) blocks[i] = I.GLOWSTONE;
      }
    }
  }

  // ---------- The biomes' own ----------

  _biomeFeatures(blocks, cx, cz) {
    const B = NETHER_BIOME;
    const has = new Uint8Array(5);
    for (let k = 0; k < 256; k++) has[this._bio[k]] = 1;
    // (the features that reach into the next chunks: replayed from each neighbour's seed)
    if (has[B.CRIMSON_FOREST] || has[B.WARPED_FOREST] || this._forestNear(cx, cz)) this._fungi(blocks, cx, cz);
    if (has[B.BASALT_DELTAS] || this._biomeNear(cx, cz, B.BASALT_DELTAS)) this._deltas(blocks, cx, cz);
    const r = salted(this.seed, cx, cz, 0xb10);
    if (has[B.CRIMSON_FOREST] || has[B.WARPED_FOREST]) this._forestFloor(blocks, cx, cz, r);
    if (has[B.SOUL_SAND_VALLEY]) this._valley(blocks, cx, cz, r);
    if (has[B.BASALT_DELTAS]) this._columns(blocks, cx, cz, r);
    if (has[B.WASTES]) this._wastes(blocks, cx, cz, r);
  }

  _biomeNear(cx, cz, b) {
    for (const [dx, dz] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) if (this.biomeAt((cx + dx) * S + 8, (cz + dz) * S + 8) === b) return true;
    return false;
  }

  _forestNear(cx, cz) {
    return this._biomeNear(cx, cz, NETHER_BIOME.CRIMSON_FOREST) || this._biomeNear(cx, cz, NETHER_BIOME.WARPED_FOREST);
  }

  // A chunk's huge fungi: [x, y, z, warped, seed] where each stands
  // (deterministic: its own chunk's seed and the density).
  fungiOf(cx, cz) {
    const r = salted(this.seed, cx, cz, 0xf06);
    const out = [];
    for (let k = 0; k < 8; k++) {
      const x = cx * S + Math.floor(r() * S);
      const z = cz * S + Math.floor(r() * S);
      const top = between(r, NETHER_LAVA_LEVEL + 4, NETHER_ROOF - 4);
      const s = (r() * 0x7fffffff) | 0;
      const b = this.biomeAt(x, z);
      if (b !== NETHER_BIOME.CRIMSON_FOREST && b !== NETHER_BIOME.WARPED_FOREST) continue;
      const y = this.floorBelow(x, top, z, 64);
      if (y < 0) continue;
      out.push([x, y, z, b === NETHER_BIOME.WARPED_FOREST, s]);
    }
    return out;
  }

  _fungi(blocks, cx, cz) {
    const x0 = cx * S;
    const z0 = cz * S;
    const put = (x, y, z, id) => {
      const lx = x - x0;
      const lz = z - z0;
      if (lx < 0 || lx >= S || lz < 0 || lz >= S || y < 1 || y >= H - 1) return;
      const i = (y << 8) | (lz << 4) | lx;
      if (blocks[i] === AIR) blocks[i] = id;
    };
    const free = (x, y, z) => {
      const lx = x - x0;
      const lz = z - z0;
      if (lx < 0 || lx >= S || lz < 0 || lz >= S) return !this.solidAt(x, y, z);
      return blocks[(y << 8) | (lz << 4) | lx] === AIR;
    };
    for (let dz = -1; dz <= 1; dz++) {
      for (let dx = -1; dx <= 1; dx++) {
        for (const [x, y, z, warped, s] of this.fungiOf(cx + dx, cz + dz)) {
          if (Math.abs(x - (x0 + 7.5)) > 12 || Math.abs(z - (z0 + 7.5)) > 12) continue;
          // (the ground must be the nylium of its forest: in this chunk, as made; else from the density)
          hugeFungus(put, free, x, y, z, warped, mulberry32(s), false);
        }
      }
    }
  }

  // Lava deltas (vanilla's DeltaFeature): flat pools of lava on the floor,
  // rimmed with magma, where the ground holds them.
  deltasOf(cx, cz) {
    const r = salted(this.seed, cx, cz, 0xde1);
    const out = [];
    for (let k = 0; k < 3; k++) {
      const x = cx * S + Math.floor(r() * S);
      const z = cz * S + Math.floor(r() * S);
      const rad = between(r, 3, 7);
      const rim = between(r, 0, 2);
      if (this.biomeAt(x, z) !== NETHER_BIOME.BASALT_DELTAS) continue;
      const y = this.floorBelow(x, between(r, NETHER_LAVA_LEVEL + 4, 90), z, 50);
      if (y < 0) continue;
      out.push([x, y, z, rad, rim]);
    }
    return out;
  }

  _deltas(blocks, cx, cz) {
    const x0 = cx * S;
    const z0 = cz * S;
    for (let dz = -1; dz <= 1; dz++) {
      for (let dx = -1; dx <= 1; dx++) {
        for (const [x, y, z, rad, rim] of this.deltasOf(cx + dx, cz + dz)) {
          if (Math.abs(x - (x0 + 7.5)) > rad + 9 || Math.abs(z - (z0 + 7.5)) > rad + 9) continue;
          const fy = y - 1; // (the floor's own layer becomes the pool)
          for (let ox = -rad - rim; ox <= rad + rim; ox++) {
            for (let oz = -rad - rim; oz <= rad + rim; oz++) {
              const d = Math.hypot(ox, oz);
              if (d > rad + rim) continue;
              const wx = x + ox;
              const wz = z + oz;
              const lx = wx - x0;
              const lz = wz - z0;
              if (lx < 0 || lx >= S || lz < 0 || lz >= S) continue;
              // (a cell of the pool: solid under it, open over it, held all round)
              if (!this.solidAt(wx, fy, wz) || this.solidAt(wx, fy + 1, wz) || !this.solidAt(wx, fy - 1, wz)) continue;
              const held = this.solidAt(wx + 1, fy, wz) && this.solidAt(wx - 1, fy, wz) && this.solidAt(wx, fy, wz + 1) && this.solidAt(wx, fy, wz - 1);
              const i = (fy << 8) | (lz << 4) | lx;
              if (!BASE_STONE[blocks[i]]) continue;
              if (d <= rad && held) blocks[i] = LAVA;
              else if (d <= rad + rim || !held) blocks[i] = I.MAGMA_BLOCK;
            }
          }
        }
      }
    }
  }

  // Ground cover, vines: kept inside the chunk.
  _forestFloor(blocks, cx, cz, r) {
    const bio = this._bio;
    for (let z = 0; z < S; z++) {
      for (let x = 0; x < S; x++) {
        const b = bio[z * S + x];
        if (b !== NETHER_BIOME.CRIMSON_FOREST && b !== NETHER_BIOME.WARPED_FOREST) continue;
        const warped = b === NETHER_BIOME.WARPED_FOREST;
        const col = (z << 4) | x;
        for (let y = NETHER_LAVA_LEVEL + 1; y < NETHER_ROOF; y++) {
          const i = (y << 8) | col;
          if (blocks[i] !== AIR) continue;
          const below = blocks[i - 256];
          if (below !== I.CRIMSON_NYLIUM && below !== I.WARPED_NYLIUM) continue;
          const roll = r();
          if (roll < 0.3) blocks[i] = warped && r() < 0.32 ? I.NETHER_SPROUTS : pickForestPlant(warped, r());
          // (twisting vines up from the warped floor)
          else if (warped && roll > 0.985) this._vine(blocks, x, y, z, I.TWISTING_VINES, 1, between(r, 1, 9));
        }
      }
    }
    // Weeping vines from the crimson forests' roofs.
    for (let k = 0; k < 14; k++) {
      const x = between(r, 0, 15);
      const z = between(r, 0, 15);
      if (bio[z * S + x] !== NETHER_BIOME.CRIMSON_FOREST) continue;
      const y = between(r, NETHER_LAVA_LEVEL + 8, NETHER_ROOF - 1);
      for (let yy = y; yy < NETHER_ROOF; yy++) {
        const i = (yy << 8) | (z << 4) | x;
        if (blocks[i] !== AIR) break;
        const above = blocks[i + 256];
        if (BASE_STONE[above] || above === I.NETHER_WART_BLOCK) {
          this._vine(blocks, x, yy, z, I.WEEPING_VINES, -1, between(r, 1, 8));
          break;
        }
      }
    }
  }

  // A vine from (x, y, z) `n` long (dy: -1 hanging, +1 standing), the tip last.
  _vine(blocks, x, y, z, base, dy, n) {
    let k = 0;
    let yy = y;
    for (; k < n; k++, yy += dy) {
      if (yy < 1 || yy >= H - 1 || blocks[(yy << 8) | (z << 4) | x] !== AIR) break;
      blocks[(yy << 8) | (z << 4) | x] = base + 1;
    }
    if (k) blocks[((yy - dy) << 8) | (z << 4) | x] = base;
  }

  // Soul sand valleys: basalt pillars, bone fossils, soul fire.
  _valley(blocks, cx, cz, r) {
    const bio = this._bio;
    const V = NETHER_BIOME.SOUL_SAND_VALLEY;
    for (let k = 0; k < 3; k++) {
      const x = between(r, 1, 14);
      const z = between(r, 1, 14);
      if (bio[z * S + x] !== V) continue;
      const y0 = between(r, NETHER_LAVA_LEVEL + 10, NETHER_ROOF - 2);
      // (from a roof down to the floor: vanilla's BasaltPillarFeature)
      let top = -1;
      for (let y = y0; y < NETHER_ROOF; y++) {
        const i = (y << 8) | (z << 4) | x;
        if (blocks[i] !== AIR) {
          if (BASE_STONE[blocks[i]]) top = y - 1;
          break;
        }
      }
      if (top < 0) continue;
      let y = top;
      for (; y > NETHER_LAVA_LEVEL && blocks[(y << 8) | (z << 4) | x] === AIR; y--) {
        blocks[(y << 8) | (z << 4) | x] = I.BASALT;
        if (r() < 0.12) {
          const d = [1, -1, 16, -16][Math.floor(r() * 4)];
          const j = ((y << 8) | (z << 4) | x) + d;
          if (blocks[j] === AIR) blocks[j] = I.BASALT;
        }
      }
    }
    // Fossils (vanilla's nether fossils, smaller): a spine and ribs of bone on a soul sand floor.
    if (r() < 0.3) {
      const x = between(r, 4, 11);
      const z = between(r, 4, 11);
      const y = this._floorIn(blocks, x, z, between(r, NETHER_LAVA_LEVEL + 2, 90));
      if (y > 0 && bio[z * S + x] === V) {
        const alongX = r() < 0.5;
        const len = between(r, 3, 6);
        for (let k = -len; k <= len; k++) {
          const sx = alongX ? x + Math.max(-4, Math.min(4, k)) : x;
          const sz = alongX ? z : z + Math.max(-4, Math.min(4, k));
          const put = (px, py, pz) => {
            if (px < 0 || px >= S || pz < 0 || pz >= S || py < 1 || py >= H - 1) return;
            const i = (py << 8) | (pz << 4) | px;
            if (blocks[i] === AIR || BASE_STONE[blocks[i]]) blocks[i] = I.BONE_BLOCK;
          };
          put(sx, y + 3, sz);
          if (k % 2 === 0 && Math.abs(k) < len) {
            for (let h = 0; h <= 3; h++) {
              const w = h < 2 ? 2 : 1;
              put(alongX ? sx : sx + w, y + h, alongX ? sz + w : sz);
              put(alongX ? sx : sx - w, y + h, alongX ? sz - w : sz);
            }
          }
        }
      }
    }
    this._fires(blocks, r, V, I.SOUL_FIRE, (b) => b === I.SOUL_SAND || b === I.SOUL_SOIL, 2);
  }

  // Fire patches on the floors (vanilla's patch_fire / patch_soul_fire).
  _fires(blocks, r, biome, fire, on, patches) {
    const bio = this._bio;
    for (let k = 0; k < patches; k++) {
      if (r() < 0.5) continue;
      const x = between(r, 2, 13);
      const z = between(r, 2, 13);
      if (bio[z * S + x] !== biome) continue;
      const y = this._floorIn(blocks, x, z, between(r, NETHER_LAVA_LEVEL + 2, NETHER_ROOF - 2));
      if (y < 0) continue;
      for (let t = 0; t < 16; t++) {
        const px = x + between(r, -2, 2);
        const pz = z + between(r, -2, 2);
        const py = y + between(r, -1, 1);
        if (px < 0 || px >= S || pz < 0 || pz >= S) continue;
        const i = (py << 8) | (pz << 4) | px;
        if (blocks[i] === AIR && on(blocks[i - 256])) blocks[i] = fire;
      }
    }
  }

  // The first floor at or under y in a local column (an air cell over a block of the ground), or -1.
  _floorIn(blocks, x, z, y) {
    for (let yy = y; yy > NETHER_LAVA_LEVEL; yy--) {
      const i = (yy << 8) | (z << 4) | x;
      if (blocks[i] === AIR && BASE_STONE[blocks[i - 256]]) return yy;
    }
    return -1;
  }

  // Basalt deltas' columns (vanilla's BasaltColumnsFeature: clusters of
  // columns standing on the floor, small and large).
  _columns(blocks, cx, cz, r) {
    const bio = this._bio;
    for (let k = 0; k < 6; k++) {
      const x = between(r, 2, 13);
      const z = between(r, 2, 13);
      if (bio[z * S + x] !== NETHER_BIOME.BASALT_DELTAS) continue;
      const big = r() < 0.3;
      const y = this._floorIn(blocks, x, z, between(r, NETHER_LAVA_LEVEL + 2, 100));
      if (y < 0) continue;
      const reach = big ? 3 : 2;
      for (let n = 0; n < (big ? 8 : 4); n++) {
        const px = Math.max(0, Math.min(15, x + between(r, -reach, reach)));
        const pz = Math.max(0, Math.min(15, z + between(r, -reach, reach)));
        const py = this._floorIn(blocks, px, pz, y + 3);
        if (py < 0 || Math.abs(py - y) > 4) continue;
        const h = big ? between(r, 5, 10) : between(r, 1, 4);
        for (let t = 0; t < h; t++) {
          const i = ((py + t) << 8) | (pz << 4) | px;
          if (py + t >= NETHER_ROOF || blocks[i] !== AIR) break;
          blocks[i] = I.BASALT;
        }
      }
    }
  }

  // Nether wastes: fire on the netherrack, a mushroom now and then.
  _wastes(blocks, cx, cz, r) {
    this._fires(blocks, r, NETHER_BIOME.WASTES, FIRE, (b) => b === ROCK, 3);
    const bio = this._bio;
    for (let k = 0; k < 2; k++) {
      const x = between(r, 0, 15);
      const z = between(r, 0, 15);
      if (bio[z * S + x] !== NETHER_BIOME.WASTES || r() < 0.5) continue;
      const y = this._floorIn(blocks, x, z, between(r, NETHER_LAVA_LEVEL + 2, 110));
      if (y > 0 && blocks[((y - 1) << 8) | (z << 4) | x] === ROCK) blocks[(y << 8) | (z << 4) | x] = r() < 0.5 ? I.BROWN_MUSHROOM : I.RED_MUSHROOM;
    }
  }

  // ---------- Questions from the game ----------

  // The highest floor under the roof (as world.surfaceY there), else the lava sea's level.
  heightAt(x, z) {
    x = Math.floor(x);
    z = Math.floor(z);
    for (let y = NETHER_ROOF - 2; y > NETHER_LAVA_LEVEL; y--) if (this.solidAt(x, y, z) && !this.solidAt(x, y + 1, z) && !this.solidAt(x, y + 2, z)) return y;
    return NETHER_LAVA_LEVEL;
  }
}

// What ores replace: the base stones (vanilla's netherrack test; the
// deltas' basalt and blackstone too for their own ores).
const ONLY_ROCK = new Uint8Array(4096);
ONLY_ROCK[ROCK] = 1;
const DEBRIS_IN = new Uint8Array(4096);
for (const id of [ROCK, I.BASALT, I.BLACKSTONE, I.SOUL_SOIL, I.SOUL_SAND]) DEBRIS_IN[id] = 1;

// ---------- Huge fungi ----------

// Vanilla's HugeFungusFeature: a stem 4-13 high (doubled one time in 12;
// three by three one time in 16 when not planted), a hat of wart blocks
// (the crimson's with weeping vines under its rim), shroomlights in it.
// put(x, y, z, id) writes where it may (into air), free(x, y, z): the cell
// is open. The same for the generator and bone meal.
export function hugeFungus(put, free, x, y, z, warped, rand, planted = true) {
  let height = 4 + Math.floor(rand() * 10);
  if (Math.floor(rand() * 12) === 0) height *= 2;
  if (y + height + 1 >= NETHER_ROOF + 4 || y + height + 1 >= H - 1) return false;
  // (room for the stem: vanilla stops a planted fungus that would grow into a block)
  for (let k = 1; k <= height; k++) {
    if (!free(x, y + k, z)) {
      if (planted) return false;
      height = k - 1;
      break;
    }
  }
  if (height < 4) return false;
  const thick = !planted && Math.floor(rand() * 16) === 0;
  const stem = warped ? I.WARPED_STEM : I.CRIMSON_STEM;
  const wart = warped ? I.WARPED_WART_BLOCK : I.NETHER_WART_BLOCK;
  for (let k = 0; k < height; k++) {
    if (thick) {
      for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) if (Math.abs(dx) + Math.abs(dz) < 2 || rand() < 0.7) put(x + dx, y + k, z + dz, stem);
    } else put(x, y + k, z, stem);
  }
  const hatH = Math.min(Math.floor(rand() * (1 + Math.floor(height / 3))) + 5, height);
  const hatStart = height - hatH;
  for (let ly = hatStart; ly <= height; ly++) {
    let rad = ly < height - Math.floor(rand() * 3) ? 2 : 1;
    if (hatH > 8 && ly < hatStart + 4) rad = 3;
    if (thick) rad++;
    for (let dx = -rad; dx <= rad; dx++) {
      for (let dz = -rad; dz <= rad; dz++) {
        const edgeX = Math.abs(dx) === rad;
        const edgeZ = Math.abs(dz) === rad;
        const corner = edgeX && edgeZ;
        const edge = edgeX || edgeZ;
        const px = x + dx;
        const py = y + ly;
        const pz = z + dz;
        const top = ly === height;
        if (top) {
          // (the top: full, but its corners)
          if (!corner || rand() < 0.1) put(px, py, pz, wart);
          continue;
        }
        if (corner) continue;
        if (edge) {
          // (the rim: mostly wart, the bottom ring with vines hanging off the crimson's)
          if (rand() < 0.98) put(px, py, pz, wart);
          if (!warped && ly === hatStart && rand() < 0.15) {
            const n = 1 + Math.floor(rand() * 4);
            for (let v = 1; v <= n; v++) put(px, py - v, pz, v === n ? I.WEEPING_VINES : I.WEEPING_VINES + 1);
          }
        } else if (rand() < 0.1) put(px, py, pz, rand() < 0.5 ? I.SHROOMLIGHT : wart);
      }
    }
  }
  return true;
}

// Bone meal on a fungus (js/content/nether.js): the huge one grown in the world.
LIB.growHugeFungus = (world, x, y, z, warped, rand = Math.random) => {
  const list = [];
  const set = new Set();
  const free = (px, py, pz) => {
    const id = world.getBlock(px, py, pz);
    return id === AIR || id === (warped ? I.WARPED_FUNGUS : I.CRIMSON_FUNGUS) || !!LIB.IS_REPLACEABLE?.[id];
  };
  const put = (px, py, pz, id) => {
    const k = `${px},${py},${pz}`;
    if (set.has(k) || (!free(px, py, pz) && !(px === x && py === y && pz === z))) return;
    set.add(k);
    list.push(px, py, pz, id);
  };
  if (!hugeFungus(put, free, x, y, z, warped, rand, true)) return false;
  world.setBlocks(list);
  return true;
};
