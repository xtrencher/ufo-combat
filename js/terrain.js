// Procedural terrain generation (pure JS, no three.js). A seed always
// produces the same landscape, so shared seed links work. (Round 3 rescaled
// the world: taller, bigger continents, oceans, mountain ranges and biomes,
// so a seed's landscape differs from earlier versions.)
import { Noise, hash2, mulberry32 } from "./noise.js";
import { TreeGrower } from "./trees.js";
import { BLOCK } from "./blocks.js";
import { CHUNK_SIZE, WORLD_HEIGHT, SEA_LEVEL } from "./constants.js";
import { BIOME, BiomeSource, isSnowy, isOceanBiome } from "./biomes.js";
import { VillageGrower } from "./village.js";
import { SiteGrower } from "./sites.js";

const BASE_HEIGHT = 26;
const AMPLITUDE = 11; // (Round 9: was 14, gentler hills)
const PLANT_SALT = 0x5bd1e995;
const SWAMP_SALT = 0x7a2f19c3;
const DESERT_SALT = 0x1e5f9b4a;
const REEF_SALT = 0x3c8de061;

// Large-scale shape of the world (Round 3: at the scale of classic block
// games): continents and oceans thousands of blocks across, long mountain
// ranges rising up to ~100 blocks above the sea (a masked, ridged field, so
// ranges are localized: wide lowlands between them), and winding rivers (a
// thin band where a low-frequency noise field crosses near zero). Round 5:
// the ranges are bigger: more of the land is mountainous, the massifs are
// lifted as a whole, the ridges are broader and the crests reach the top of
// the world (~120 blocks, snow-capped) far more often. Round 9: the other
// way again, for the jets, the vehicles and the fights: about two thirds of
// the land is flat, gentler hills, and mountains on roughly a seventh of it
// (half as much as before), but where a range rises it is as big as ever.
const CONTINENT_FREQ = 1 / 2600;
const CONTINENT_AMP = 36;
const MOUNTAIN_MASK_FREQ = 1 / 1400; // Round 6: bigger ranges...
const MOUNTAIN_MASK_LO = 0.1; // (Round 9: was -0.03 / 0.2: ranges only where the mask is high...)
const MOUNTAIN_MASK_HI = 0.3; // (...full strength in their cores)
const MOUNTAIN_RIDGE_FREQ = 1 / 430; // ...with broader massifs and ridges...
const MOUNTAIN_PEAK_FREQ = 1 / 75;
const MOUNTAIN_AMP = 135; // ...and taller crests (the soft cap below still keeps them inside the world)
const RIVER_FREQ = 1 / 420;
// Round 6 landforms: a low-frequency "relief" field decides where the land is
// very flat (wide meadows and plains, deserts as flat as a table) and where it
// is rugged; a second, ridged field cuts long, wide valleys that sink toward the
// sea level, so a mountain range gets deep valleys between its massifs.
const RELIEF_FREQ = 1 / 1900;
const FLAT_LO = 0.08; // relief below this: flat country (fully flat at FLAT_LO - FLAT_SPAN). (Round 9: was -0.02)
const FLAT_SPAN = 0.2;
const VALLEY_FREQ = 1 / 820;
const VALLEY_FLOOR = SEA_LEVEL + 4; // the valley floor (a little above the sea)
function smooth01(t) {
  t = Math.max(0, Math.min(1, t));
  return t * t * (3 - 2 * t);
}
const RIVER_WIDTH = 0.045;
export const SNOW_LINE = 98; // mountain peaks above this height are snow-capped
export const BARE_ROCK_LINE = 72; // mountain slopes above this are exposed stone
// The raw height field can overshoot the top of the world in the biggest
// ranges. Cutting it off there made flat stone plateaus in the full-detail
// chunks while the distant (LOD) terrain, sampled from the same field, still
// drew the full peaks, so a mountain changed shape when you flew closer.
// Heights above SOFT_CAP_START are smoothly compressed toward the world's
// ceiling instead (slope 1 at the start, flattening gently), so peaks keep
// their shape, and the height every system samples is inside the world.
const SOFT_CAP_START = 100;
const SOFT_CAP_RANGE = 24; // asymptote: SOFT_CAP_START + SOFT_CAP_RANGE (124)

// The block that tops a land column of biome `biome` at height `h`, and the
// block just below it. One function for chunk generation and for the distant
// terrain, so both always agree.
export function surfaceBlocks(biome, h) {
  const isBeach = h <= SEA_LEVEL + 1;
  if (isBeach || isOceanBiome(biome) || biome === BIOME.RIVER || biome === BIOME.DESERT) return { top: BLOCK.SAND, sub: BLOCK.SAND };
  if (biome === BIOME.BADLANDS) return { top: BLOCK.TERRACOTTA, sub: BLOCK.TERRACOTTA };
  if (biome === BIOME.MOUNTAINS && h > SNOW_LINE) return { top: BLOCK.SNOW, sub: BLOCK.STONE };
  if (biome === BIOME.MOUNTAINS && h > BARE_ROCK_LINE) return { top: BLOCK.STONE, sub: BLOCK.STONE };
  if (isSnowy(biome)) return { top: BLOCK.SNOW, sub: BLOCK.DIRT };
  return { top: BLOCK.GRASS, sub: BLOCK.DIRT };
}

// Caves: tunnels where two independent 3D noise fields are both near zero
// (their intersection forms long winding "spaghetti" worms), plus rare large
// caverns where a third field is high. Sampled on a coarse lattice and
// trilinearly interpolated (noise is the expensive part).
const CAVE_STEP = 4;
const TUNNEL_FREQ_XZ = 0.021;
const TUNNEL_FREQ_Y = 0.032;
const TUNNEL_WIDTH = 0.068;
const CAVERN_FREQ_XZ = 0.012;
const CAVERN_FREQ_Y = 0.022;
const CAVERN_THRESHOLD = 0.56;

// Ore veins (iron and diamond were removed in Round 6: no use for them; the
// stone they would have been stays stone). [block, veins per chunk, min size, max size, min y, max y].
const VEINS = [
  [BLOCK.COAL_ORE, 16, 3, 9, 5, 50],
  [BLOCK.GOLD_ORE, 3, 3, 6, 2, 22],
  [BLOCK.GRAVEL, 5, 8, 16, 4, 45],
];

function hash3(seed, x, y, z) {
  let h = (seed | 0) ^ Math.imul(x | 0, 374761393) ^ Math.imul(y | 0, 1103515245) ^ Math.imul(z | 0, 668265263);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

export class TerrainGenerator {
  constructor(seed) {
    this.seed = seed >>> 0;
    this.noise = new Noise(this.seed);
    this.caveNoise = new Noise((this.seed ^ 0x6a09e667) >>> 0);
    this.biomes = new BiomeSource(this.seed);
    this.sites = new SiteGrower(this); // airports and cities (sites.js): flat pads bend the terrain
    this.trees = new TreeGrower(this);
    this.villages = new VillageGrower(this);
  }

  // Height plus the two other large-scale fields the biome map needs
  // (mountainT: 0-1 how mountainous; river: whether this column is in a
  // river channel), computed together so callers that need both (chunk
  // generation) don't pay for the noise twice.
  _terrainInfo(wx, wz) {
    const info = this._baseInfo(wx, wz);
    info.height = this.sites.adjust(wx, wz, info.height);
    return info;
  }

  // The natural terrain, before airports and cities flatten their pads.
  _baseInfo(wx, wz) {
    const n = this.noise;
    const continent = n.fbm2(wx, wz, 4, 0.5, 2, CONTINENT_FREQ);
    const detail = n.fbm2(wx, wz, 4, 0.5, 2, 1 / 80);
    const relief = n.fbm2(wx - 7000, wz + 5000, 3, 0.5, 2, RELIEF_FREQ);
    // Mountain ranges only on land, fading out toward the coast.
    const mask = n.fbm2(wx + 500, wz - 500, 3, 0.5, 2, MOUNTAIN_MASK_FREQ);
    const land = Math.max(0, Math.min(1, (continent + 0.02) / 0.14));
    const mountainT = Math.max(0, Math.min(1, (mask - MOUNTAIN_MASK_LO) / (MOUNTAIN_MASK_HI - MOUNTAIN_MASK_LO))) * land;
    let mountains = 0;
    if (mountainT > 0) {
      // Long ridges (ridged noise: sharp crests, broad valleys), with
      // smaller peaks and gullies along them.
      const r = n.fbm2(wx + 1000, wz + 1000, 4, 0.5, 2, MOUNTAIN_RIDGE_FREQ);
      const ridged = Math.pow(1 - Math.abs(r), 1.8);
      const peaks = n.fbm2(wx - 3000, wz + 700, 3, 0.5, 2, MOUNTAIN_PEAK_FREQ);
      mountains = mountainT * (ridged * MOUNTAIN_AMP * (0.55 + 0.45 * mountainT) + ridged * peaks * 20 + mountainT * 24);
    }
    // The coast: a quick step from the sea floor up to the land (a tanh
    // across the coastline), so shores are beaches, not wide marshy flats.
    // Detail hills are gentler out at sea, fuller on land.
    const coast = 6 * Math.tanh(continent * 22);
    // Flat country: where the relief field is low, the hills die away (down to a
    // tenth) and the mountains are held back, leaving wide, nearly level plains.
    const flatT = smooth01((FLAT_LO - relief) / FLAT_SPAN) * land;
    mountains *= 1 - 0.85 * flatT;
    let height = BASE_HEIGHT + continent * CONTINENT_AMP + coast + detail * AMPLITUDE * (0.55 + 0.45 * land) * (1 - 0.92 * flatT) + mountains;
    // Deep valleys: long winding channels (a ridged field again) that cut the high
    // ground down toward the sea. Barely there on the lowlands (nothing to cut),
    // dramatic between the massifs of a mountain range.
    if (height > VALLEY_FLOOR + 3 && land > 0) {
      const vn = n.fbm2(wx + 3000, wz - 6000, 3, 0.5, 2, VALLEY_FREQ);
      const vBand = 1 - Math.abs(vn);
      const valleyT = smooth01((vBand - 0.915) / 0.06) * land * (1 - flatT);
      if (valleyT > 0) {
        const floorY = VALLEY_FLOOR + 3 * detail;
        height = height * (1 - valleyT) + Math.min(height, floorY) * valleyT;
      }
    }
    if (height > SOFT_CAP_START) height = SOFT_CAP_START + SOFT_CAP_RANGE * Math.tanh((height - SOFT_CAP_START) / (SOFT_CAP_RANGE + 2));
    const riverN = n.fbm2(wx - 2000, wz + 2000, 2, 0.5, 2, RIVER_FREQ);
    const riverBand = 1 - Math.abs(riverN);
    let river = false;
    if (riverBand > 1 - RIVER_WIDTH && continent > -0.02 && mountainT < 0.3) {
      river = true;
      const k = Math.min(1, (riverBand - (1 - RIVER_WIDTH)) / RIVER_WIDTH);
      height = height * (1 - k) + (SEA_LEVEL - 3) * k;
    }
    return { height: Math.floor(Math.max(3, height)), mountainT, river, flat: flatT };
  }

  heightAt(wx, wz) {
    return this._terrainInfo(wx, wz).height;
  }

  // The biome at any column (pure, independent of chunk generation, like
  // heightAt): used by tree placement and by the game for the F3 debug overlay.
  biomeAt(wx, wz) {
    const info = this._terrainInfo(wx, wz);
    return this.biomes.biomeAt(wx, wz, info.height, info.mountainT, info.river, info.flat);
  }

  // Where new players start: the first land column along a diagonal from the
  // origin, moved to the nearest land column that no tree stands in (so
  // nobody starts on top of a canopy). (Round 9) On flat ground: the nearest
  // spot whose surroundings (9x9) are level within a block, dry and open.
  // Returns [wx, wz].
  spawnColumn() {
    let bx = 0;
    let bz = 0;
    // Continents are now large (see CONTINENT_FREQ), so a coarse search needs
    // real range to escape starting inside a big ocean.
    // (Oceans can be thousands of blocks across: spiral out until land.)
    for (let i = 0; i < 400 && this.heightAt(bx, bz) <= SEA_LEVEL + 1; i++) {
      const a = i * 0.5;
      const r = 40 + i * 18;
      bx = Math.round(Math.cos(a) * r);
      bz = Math.round(Math.sin(a) * r);
    }
    const flatAt = (x, z) => {
      const h = this.heightAt(x, z);
      if (h <= SEA_LEVEL + 1) return false;
      for (let dx = -4; dx <= 4; dx += 2) {
        for (let dz = -4; dz <= 4; dz += 2) {
          const hh = this.heightAt(x + dx, z + dz);
          if (hh <= SEA_LEVEL + 1 || Math.abs(hh - h) > 1) return false;
        }
      }
      return !this.trees.coversColumn(x, z);
    };
    for (let r = 0; r <= 240; r += 3) {
      for (let dz = -r; dz <= r; dz += 3) {
        for (let dx = -r; dx <= r; dx += 3) {
          if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue;
          if (flatAt(bx + dx, bz + dz)) return [bx + dx, bz + dz];
        }
      }
    }
    for (let r = 0; r <= 16; r++) {
      for (let dz = -r; dz <= r; dz++) {
        for (let dx = -r; dx <= r; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue;
          const x = bx + dx;
          const z = bz + dz;
          if (this.heightAt(x, z) > SEA_LEVEL + 1 && !this.trees.coversColumn(x, z)) return [x, z];
        }
      }
    }
    return [bx, bz];
  }

  // Whether a cave would open up under or beside a puddle at (wx, h, wz)
  // (caves are carved after the puddles, and would drain them into thin air).
  _caveBesidePuddle(wx, h, wz) {
    return (
      this.isCarved(wx, h - 1, wz) ||
      this.isCarved(wx + 1, h, wz) ||
      this.isCarved(wx - 1, h, wz) ||
      this.isCarved(wx, h, wz + 1) ||
      this.isCarved(wx, h, wz - 1)
    );
  }

  // Whether the cave carver removes solid terrain at (wx, y, wz) above sea
  // level. Samples the same noise lattice as _carveCaves (lattice points sit
  // at world multiples of CAVE_STEP, stored as 32-bit floats there, so the
  // result is identical), which lets trees rooted in a neighbouring chunk
  // know whether their ground exists without generating that chunk.
  isCarved(wx, y, wz) {
    const n = this.caveNoise;
    const fx = wx / CAVE_STEP;
    const fy = y / CAVE_STEP;
    const fz = wz / CAVE_STEP;
    const i = Math.floor(fx);
    const j = Math.floor(fy);
    const k = Math.floor(fz);
    const tx = fx - i;
    const ty = fy - j;
    const tz = fz - k;
    const sample = (fn) => {
      const at = (ii, jj, kk) => Math.fround(fn(ii * CAVE_STEP, jj * CAVE_STEP, kk * CAVE_STEP));
      const c00 = at(i, j, k) + (at(i + 1, j, k) - at(i, j, k)) * tx;
      const c10 = at(i, j, k + 1) + (at(i + 1, j, k + 1) - at(i, j, k + 1)) * tx;
      const c01 = at(i, j + 1, k) + (at(i + 1, j + 1, k) - at(i, j + 1, k)) * tx;
      const c11 = at(i, j + 1, k + 1) + (at(i + 1, j + 1, k + 1) - at(i, j + 1, k + 1)) * tx;
      const c0 = c00 + (c10 - c00) * tz;
      const c1 = c01 + (c11 - c01) * tz;
      return c0 + (c1 - c0) * ty;
    };
    const a = sample((x, yy, z) => n.perlin3(x * TUNNEL_FREQ_XZ, yy * TUNNEL_FREQ_Y, z * TUNNEL_FREQ_XZ));
    const b = sample((x, yy, z) => n.perlin3(x * TUNNEL_FREQ_XZ + 71.3, yy * TUNNEL_FREQ_Y - 33.1, z * TUNNEL_FREQ_XZ + 19.7));
    if (a * a + b * b < TUNNEL_WIDTH * TUNNEL_WIDTH) return true;
    if (y >= 34) return false;
    const c = sample((x, yy, z) => n.perlin3(x * CAVERN_FREQ_XZ - 51.9, yy * CAVERN_FREQ_Y + 12.4, z * CAVERN_FREQ_XZ - 83.2));
    return c > CAVERN_THRESHOLD + Math.max(0, y - 20) * 0.012;
  }

  // Fills a zeroed chunk.blocks array for the chunk at (chunk.cx, chunk.cz).
  generate(chunk) {
    const S = CHUNK_SIZE;
    const blocks = chunk.blocks;
    const baseX = chunk.cx * S;
    const baseZ = chunk.cz * S;
    const idx = (x, y, z) => (y * S + z) * S + x;

    // Heights for this chunk plus a 1-column border (needed by the cave rule
    // below), and each interior column's biome computed in the same pass
    // (both come from the same underlying noise fields; see _terrainInfo).
    const H = new Int16Array((S + 2) * (S + 2));
    const hAt = (lx, lz) => H[(lz + 1) * (S + 2) + (lx + 1)];
    const Biome = new Uint8Array(S * S);
    for (let lz = -1; lz <= S; lz++) {
      for (let lx = -1; lx <= S; lx++) {
        const info = this._terrainInfo(baseX + lx, baseZ + lz);
        H[(lz + 1) * (S + 2) + (lx + 1)] = info.height;
        if (lx >= 0 && lx < S && lz >= 0 && lz < S) {
          Biome[lz * S + lx] = this.biomes.biomeAt(baseX + lx, baseZ + lz, info.height, info.mountainT, info.river, info.flat);
        }
      }
    }
    const biomeAt = (lx, lz) => Biome[lz * S + lx];

    for (let lz = 0; lz < S; lz++) {
      for (let lx = 0; lx < S; lx++) {
        const h = hAt(lx, lz);
        const biome = biomeAt(lx, lz);
        const isBeach = h <= SEA_LEVEL + 1;
        const top = Math.min(WORLD_HEIGHT - 1, Math.max(h, SEA_LEVEL));
        const { top: topId, sub: subId } = surfaceBlocks(biome, h);
        for (let y = 0; y <= top; y++) {
          let id;
          if (y > h) id = BLOCK.WATER;
          else if (y === h) id = topId;
          else if (y > h - 4) id = subId;
          else id = BLOCK.STONE;
          blocks[idx(lx, y, lz)] = id;
        }
        // Swamps get scattered shallow puddles sunk into the ground: the
        // water replaces the top block (it used to sit on top of it, a lone
        // water block standing on dry land), and only where every side
        // neighbour is at least as high, so the puddle is walled in.
        if (
          biome === BIOME.SWAMP &&
          !isBeach &&
          h > SEA_LEVEL + 1 &&
          hash2(this.seed ^ SWAMP_SALT, baseX + lx, baseZ + lz) < 0.16 &&
          Math.min(hAt(lx + 1, lz), hAt(lx - 1, lz), hAt(lx, lz + 1), hAt(lx, lz - 1)) >= h &&
          !this._caveBesidePuddle(baseX + lx, h, baseZ + lz)
        ) {
          blocks[idx(lx, h - 1, lz)] = BLOCK.DIRT;
          blocks[idx(lx, h, lz)] = BLOCK.WATER;
        }
        // Bedrock floor: solid at y=0, ragged at y=1.
        blocks[idx(lx, 0, lz)] = BLOCK.BEDROCK;
        if (hash3(this.seed, baseX + lx, 1, baseZ + lz) < 0.5) blocks[idx(lx, 1, lz)] = BLOCK.BEDROCK;
      }
    }

    this._carveCaves(blocks, baseX, baseZ, hAt);
    this._placeVeins(blocks, chunk.cx, chunk.cz);
    this._placeCrystals(blocks, baseX, baseZ);

    // Trees (trees.js): every tree whose crown or roots reach into this
    // chunk, including trees rooted in neighbouring chunks.
    this.trees.placeInChunk(blocks, chunk.cx, chunk.cz);

    // Ground cover: tall grass and flowers on grass, cacti and dead bushes in
    // deserts, and coral/seagrass/kelp on warm ocean floors.
    for (let lz = 0; lz < S; lz++) {
      for (let lx = 0; lx < S; lx++) {
        const h = hAt(lx, lz);
        if (h + 1 >= WORLD_HEIGHT) continue;
        const ground = idx(lx, h, lz);
        const above = idx(lx, h + 1, lz);
        const wx = baseX + lx;
        const wz = baseZ + lz;
        if (blocks[ground] === BLOCK.GRASS && blocks[above] === BLOCK.AIR) {
          const r = hash2(this.seed ^ PLANT_SALT, wx, wz);
          const patch = this.noise.perlin2(wx * 0.045 + 31.7, wz * 0.045 - 12.3); // -0.7..0.7
          const meadow = biomeAt(lx, lz) === BIOME.MEADOW;
          const flowerChance = meadow ? 0.06 + Math.max(0, patch) * 0.16 : Math.max(0, patch - 0.15) * 0.25;
          if (r < flowerChance) {
            blocks[above] = hash2(this.seed ^ 0x2f6b, wx, wz) < 0.5 ? BLOCK.FLOWER_RED : BLOCK.FLOWER_YELLOW;
          } else if (r < flowerChance + (meadow ? 0.2 : 0.11) + Math.max(0, -patch) * 0.1) {
            blocks[above] = BLOCK.TALL_GRASS;
          }
        } else if (blocks[ground] === BLOCK.SAND && blocks[above] === BLOCK.AIR && biomeAt(lx, lz) === BIOME.DESERT) {
          const r = hash2(this.seed ^ DESERT_SALT, wx, wz);
          if (r < 0.003) {
            const ch = 2 + Math.floor(hash2(this.seed ^ DESERT_SALT ^ 0x91, wx, wz) * 2);
            for (let k = 0; k < ch && h + 1 + k < WORLD_HEIGHT; k++) blocks[idx(lx, h + 1 + k, lz)] = BLOCK.CACTUS;
          } else if (r < 0.012) {
            blocks[above] = BLOCK.DEAD_BUSH;
          }
        } else if (blocks[ground] === BLOCK.SAND && blocks[above] === BLOCK.WATER && biomeAt(lx, lz) === BIOME.WARM_OCEAN) {
          const r = hash2(this.seed ^ REEF_SALT, wx, wz);
          if (r < 0.05) {
            blocks[above] = BLOCK.CORAL;
          } else if (r < 0.11) {
            blocks[above] = BLOCK.SEAGRASS;
          } else if (r < 0.16) {
            const kh = 2 + Math.floor(hash2(this.seed ^ REEF_SALT ^ 0x91, wx, wz) * 3);
            for (let k = 0; k < kh; k++) {
              const cell = idx(lx, h + 1 + k, lz);
              if (h + 1 + k >= WORLD_HEIGHT || blocks[cell] !== BLOCK.WATER) break;
              blocks[cell] = BLOCK.KELP;
            }
          }
        }
      }
    }

    // Villages: placed last so they overwrite any trees or ground cover in
    // their footprint with a flattened pad, houses, paths and a farm plot.
    this.villages.placeInChunk(blocks, chunk.cx, chunk.cz);
    // Airports and cities: levelled pads with runways, hangars, streets, towers.
    this.sites.placeInChunk(blocks, chunk.cx, chunk.cz);
  }

  _carveCaves(blocks, baseX, baseZ, hAt) {
    const S = CHUNK_SIZE;
    const n = this.caveNoise;
    const NX = S / CAVE_STEP + 1;
    const NY = Math.ceil(WORLD_HEIGHT / CAVE_STEP) + 1;
    const lattice = (fn) => {
      const a = new Float32Array(NX * NY * NX);
      for (let j = 0; j < NY; j++) {
        for (let k = 0; k < NX; k++) {
          for (let i = 0; i < NX; i++) a[(j * NX + k) * NX + i] = fn(baseX + i * CAVE_STEP, j * CAVE_STEP, baseZ + k * CAVE_STEP);
        }
      }
      return a;
    };
    const A = lattice((x, y, z) => n.perlin3(x * TUNNEL_FREQ_XZ, y * TUNNEL_FREQ_Y, z * TUNNEL_FREQ_XZ));
    const B = lattice((x, y, z) => n.perlin3(x * TUNNEL_FREQ_XZ + 71.3, y * TUNNEL_FREQ_Y - 33.1, z * TUNNEL_FREQ_XZ + 19.7));
    const C = lattice((x, y, z) => n.perlin3(x * CAVERN_FREQ_XZ - 51.9, y * CAVERN_FREQ_Y + 12.4, z * CAVERN_FREQ_XZ - 83.2));
    const sample = (a, x, y, z) => {
      const fx = x / CAVE_STEP;
      const fy = y / CAVE_STEP;
      const fz = z / CAVE_STEP;
      const i = Math.floor(fx);
      const j = Math.floor(fy);
      const k = Math.floor(fz);
      const tx = fx - i;
      const ty = fy - j;
      const tz = fz - k;
      const at = (ii, jj, kk) => a[(jj * NX + kk) * NX + ii];
      const c00 = at(i, j, k) + (at(i + 1, j, k) - at(i, j, k)) * tx;
      const c10 = at(i, j, k + 1) + (at(i + 1, j, k + 1) - at(i, j, k + 1)) * tx;
      const c01 = at(i, j + 1, k) + (at(i + 1, j + 1, k) - at(i, j + 1, k)) * tx;
      const c11 = at(i, j + 1, k + 1) + (at(i + 1, j + 1, k + 1) - at(i, j + 1, k + 1)) * tx;
      const c0 = c00 + (c10 - c00) * tz;
      const c1 = c01 + (c11 - c01) * tz;
      return c0 + (c1 - c0) * ty;
    };
    const w2 = TUNNEL_WIDTH * TUNNEL_WIDTH;
    for (let lz = 0; lz < S; lz++) {
      for (let lx = 0; lx < S; lx++) {
        const h = hAt(lx, lz);
        // Water never flows in this game, so a cave cell must never touch
        // water: below sea level, only carve where this column and its four
        // neighbors have at least 2 blocks of ground above the cell.
        const m = Math.min(h, hAt(lx + 1, lz), hAt(lx - 1, lz), hAt(lx, lz + 1), hAt(lx, lz - 1));
        const top = Math.min(h, WORLD_HEIGHT - 1);
        for (let y = 2; y <= top; y++) {
          if (y <= SEA_LEVEL && y > m - 2) continue;
          const i = (y * S + lz) * S + lx;
          const id = blocks[i];
          if (id === BLOCK.AIR || id === BLOCK.WATER || id === BLOCK.BEDROCK) continue;
          const a = sample(A, lx, y, lz);
          const b = sample(B, lx, y, lz);
          let carve = a * a + b * b < w2;
          if (!carve && y < 34) carve = sample(C, lx, y, lz) > CAVERN_THRESHOLD + Math.max(0, y - 20) * 0.012;
          if (carve) blocks[i] = BLOCK.AIR;
        }
      }
    }
  }

  // Blobby ore/gravel veins made by short random walks through stone.
  _placeVeins(blocks, cx, cz) {
    const S = CHUNK_SIZE;
    const rand = mulberry32((this.seed ^ Math.imul(cx, 0x9e3779b1) ^ Math.imul(cz, 0x85ebca6b)) >>> 0);
    for (const [id, perChunk, minSize, maxSize, minY, maxY] of VEINS) {
      const count = Math.floor(perChunk) + (rand() < perChunk % 1 ? 1 : 0);
      for (let v = 0; v < count; v++) {
        let x = Math.floor(rand() * S);
        let y = minY + Math.floor(rand() * (maxY - minY + 1));
        let z = Math.floor(rand() * S);
        const size = minSize + Math.floor(rand() * (maxSize - minSize + 1));
        for (let k = 0; k < size; k++) {
          if (x >= 0 && x < S && z >= 0 && z < S && y >= 1 && y < WORLD_HEIGHT) {
            const i = (y * S + z) * S + x;
            if (blocks[i] === BLOCK.STONE) blocks[i] = id;
          }
          const axis = Math.floor(rand() * 3);
          const step = rand() < 0.5 ? -1 : 1;
          if (axis === 0) x += step;
          else if (axis === 1) y += step;
          else z += step;
        }
      }
    }
  }

  // Glowing Lumen crystals embedded in the ceilings of deep caves.
  _placeCrystals(blocks, baseX, baseZ) {
    const S = CHUNK_SIZE;
    for (let y = 3; y < 22; y++) {
      for (let z = 0; z < S; z++) {
        for (let x = 0; x < S; x++) {
          const i = (y * S + z) * S + x;
          if (blocks[i] !== BLOCK.AIR) continue;
          const above = i + S * S;
          if (blocks[above] !== BLOCK.STONE) continue;
          if (hash3(this.seed ^ 0x51ed27, baseX + x, y, baseZ + z) > 0.022) continue;
          blocks[above] = BLOCK.LUMEN;
          // A small cluster around it.
          if (x + 1 < S && blocks[above + 1] === BLOCK.STONE && hash3(this.seed, baseX + x, y + 1, baseZ + z) < 0.5) blocks[above + 1] = BLOCK.LUMEN;
          if (z + 1 < S && blocks[above + S] === BLOCK.STONE && hash3(this.seed, baseX + x, y + 2, baseZ + z) < 0.4) blocks[above + S] = BLOCK.LUMEN;
        }
      }
    }
  }
}
