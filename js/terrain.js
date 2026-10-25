// Procedural terrain generation (pure JS, no three.js). A seed always
// produces the same landscape, so shared seed links work. (Round 3 rescaled
// the world: taller, bigger continents, oceans, mountain ranges and biomes,
// so a seed's landscape differs from earlier versions.)
import { Noise, hash2, mulberry32 } from "./noise.js";
import { TreeGrower } from "./trees.js";
import { BLOCK, BLOCK_INFO } from "./blocks.js";
import * as V from "./content/ids.js";
import { SNOWY_GRASS } from "./content/nature.js";
import { CHUNK_SIZE, WORLD_HEIGHT, SEA_LEVEL } from "./constants.js";
import { BIOME, BiomeSource, isSnowy, isOceanBiome } from "./biomes.js";
import { VillageGrower } from "./village.js";
import { SiteGrower } from "./sites.js";
import { StructureGrower } from "./structures.js";

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
// terrain, so both always agree. (Round 11) vanilla: a Survival world's
// terrain: red sand on the badlands, and snowy grass (under a layer of snow,
// added with the ground cover) in the snowy lowlands.
export function surfaceBlocks(biome, h, vanilla = false) {
  const isBeach = h <= SEA_LEVEL + 1;
  if (isBeach || isOceanBiome(biome) || biome === BIOME.RIVER || biome === BIOME.DESERT) return { top: BLOCK.SAND, sub: BLOCK.SAND };
  if (biome === BIOME.BADLANDS) return vanilla ? { top: V.RED_SAND, sub: BLOCK.TERRACOTTA } : { top: BLOCK.TERRACOTTA, sub: BLOCK.TERRACOTTA };
  if (biome === BIOME.MOUNTAINS && h > SNOW_LINE) return { top: BLOCK.SNOW, sub: BLOCK.STONE };
  if (biome === BIOME.MOUNTAINS && h > BARE_ROCK_LINE) return { top: BLOCK.STONE, sub: BLOCK.STONE };
  if (isSnowy(biome)) return { top: vanilla ? SNOWY_GRASS : BLOCK.SNOW, sub: BLOCK.DIRT };
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
// (Round 11) A Survival world's veins: vanilla's (1.17's counts and sizes),
// their heights squeezed into this world (bedrock at 0-1, the sea at 24
// where vanilla's is at 63): diamonds and redstone in the deepest 15 blocks,
// gold below 30, lapis around 15, iron and copper common to the sea and a
// little above, coal up into the hills, emeralds only in the mountains and
// more gold in the badlands (VANILLA_BIOME_VEINS); granite, diorite and
// andesite pockets where their blocks exist. The y range is uniform.
const VANILLA_VEINS = [
  [BLOCK.COAL_ORE, 20, 4, 16, 5, 90],
  [BLOCK.IRON_ORE, 18, 3, 9, 2, 56],
  [V.COPPER_ORE, 8, 4, 10, 10, 50],
  [BLOCK.GOLD_ORE, 2.5, 3, 8, 2, 30],
  [V.REDSTONE_ORE, 8, 3, 8, 2, 15],
  [V.LAPIS_ORE, 1.5, 3, 7, 4, 28],
  [BLOCK.DIAMOND_ORE, 0.9, 2, 8, 2, 14],
  [BLOCK.GRAVEL, 5, 8, 16, 4, 45],
  [BLOCK.DIRT, 6, 8, 20, 10, 70],
  [V.GRANITE, 4, 10, 30, 2, 70],
  [V.DIORITE, 4, 10, 30, 2, 70],
  [V.ANDESITE, 4, 10, 30, 2, 70],
];
// [block, veins per chunk, min size, max size, min y, max y, biome of the vein's column]
const VANILLA_BIOME_VEINS = [
  [V.EMERALD_ORE, 5.5, 1, 1, 4, 80, BIOME.MOUNTAINS],
  [BLOCK.GOLD_ORE, 12, 3, 8, 4, 34, BIOME.BADLANDS], // (in the stone and the bands under the mesas: vanilla's y 32-79 is mostly air here)
];
// Caves below this are filled with lava (vanilla's lava lakes at the bottom
// of the world: y 10 and under, before 1.18).
export const LAVA_LEVEL = 10;
const POOL_SALT = 0x41c64e6d;
const CLAY_SALT = 0x2f8a1b77;
const PATCH_SALT = 0x6c8e9cf5;
const VANILLA_PLANT_SALT = 0x0b4f3d2b;
const BAMBOO_SALT = 0x5d3a71e9;
// The flowers of a biome (vanilla's lists, with the core's red blossom and
// sunpetal for the poppy and the dandelion), for the ground cover and bone meal.
const FLOWERS = {
  [BIOME.PLAINS]: [BLOCK.FLOWER_YELLOW, BLOCK.FLOWER_RED, V.AZURE_BLUET, V.OXEYE_DAISY, V.CORNFLOWER, V.RED_TULIP, V.ORANGE_TULIP, V.WHITE_TULIP, V.PINK_TULIP],
  [BIOME.MEADOW]: [V.ALLIUM, V.AZURE_BLUET, V.CORNFLOWER, V.OXEYE_DAISY, V.RED_TULIP, V.ORANGE_TULIP, V.WHITE_TULIP, V.PINK_TULIP, V.LILY_OF_THE_VALLEY, BLOCK.FLOWER_YELLOW, BLOCK.FLOWER_RED],
  [BIOME.FOREST]: [BLOCK.FLOWER_YELLOW, BLOCK.FLOWER_RED, BLOCK.FLOWER_RED, V.LILY_OF_THE_VALLEY],
  [BIOME.BIRCH_FOREST]: [BLOCK.FLOWER_YELLOW, BLOCK.FLOWER_RED, V.LILY_OF_THE_VALLEY],
  [BIOME.SWAMP]: [V.BLUE_ORCHID],
};
const DEFAULT_FLOWERS = [BLOCK.FLOWER_YELLOW, BLOCK.FLOWER_RED];
// Badlands' terracotta bands (vanilla's colours), by height.
const BADLAND_BANDS = [V.ORANGE_TERRACOTTA, BLOCK.TERRACOTTA, V.YELLOW_TERRACOTTA, BLOCK.TERRACOTTA, V.BROWN_TERRACOTTA, V.RED_TERRACOTTA, BLOCK.TERRACOTTA, V.WHITE_TERRACOTTA, V.LIGHT_GRAY_TERRACOTTA, BLOCK.TERRACOTTA, V.ORANGE_TERRACOTTA, V.RED_TERRACOTTA];
const PUMPKIN_BIOMES = new Set([BIOME.PLAINS, BIOME.FOREST, BIOME.BIRCH_FOREST, BIOME.TAIGA, BIOME.MEADOW, BIOME.SAVANNA, BIOME.DARK_FOREST]);

function hash3(seed, x, y, z) {
  let h = (seed | 0) ^ Math.imul(x | 0, 374761393) ^ Math.imul(y | 0, 1103515245) ^ Math.imul(z | 0, 668265263);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

export class TerrainGenerator {
  // opts.sites: false for a terrain without airports and cities (a Survival world, Round 11).
  // opts.vanilla: the vanilla terrain (biomes' climate, ores, structures, vanilla
  // villages...): a Survival world's and (Round 13) a new Missions world's,
  // with its sites on it (worldtype.js terrainOptions); an old Missions
  // world's terrain is without (sites and the old features only).
  constructor(seed, opts = {}) {
    this.seed = seed >>> 0;
    // (by default the vanilla terrain when there are no sites)
    this.options = { sites: opts?.sites !== false, vanilla: opts?.vanilla ?? opts?.sites === false };
    this.noise = new Noise(this.seed);
    this.caveNoise = new Noise((this.seed ^ 0x6a09e667) >>> 0);
    this.biomes = new BiomeSource(this.seed, { vanilla: this.options.vanilla });
    this.sites = new SiteGrower(this, { off: !this.options.sites }); // airports and cities (sites.js): flat pads bend the terrain
    this.trees = new TreeGrower(this);
    this.villages = new VillageGrower(this);
    // (Round 11) The vanilla terrain's dungeons, mineshafts, temples, strongholds...
    this.structures = this.options.vanilla ? new StructureGrower(this) : null;
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

  // (Round 12) The top block of the land at (wx, wz), its ground at height h
  // (the villages' earthworks end in it).
  landTop(wx, wz, h = this.heightAt(wx, wz)) {
    return surfaceBlocks(this.biomeAt(wx, wz), h, this.options.vanilla).top;
  }

  // (Round 11) Whether a Survival world's water at (wx, wz) is frozen over:
  // the snowy climate's waters, in wide sheets with open leads between them.
  frozenAt(wx, wz) {
    if (!this.options.vanilla || !this.biomes.coldAt(wx, wz)) return false;
    return this.noise.perlin2(wx * 0.03 + 91.7, wz * 0.03 - 47.3) > -0.25;
  }

  // A flower of the biome at (wx, wz), picked by r in [0, 1) (bone meal, the ground cover).
  flowerAt(wx, wz, r = Math.random()) {
    const list = FLOWERS[this.biomeAt(wx, wz)] || DEFAULT_FLOWERS;
    return list[Math.min(list.length - 1, Math.floor(r * list.length))];
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
      // (a cave cutting into the surface: the player would start at the bottom of its shaft)
      if (this.isCarved(x, h, z) || this.isCarved(x, h - 1, z) || this.isCarved(x + 1, h, z) || this.isCarved(x - 1, h, z) || this.isCarved(x, h, z + 1) || this.isCarved(x, h, z - 1)) return false;
      // (Round 12) nor on a Survival world's village house (on its roof)
      if (this.options.vanilla && this.villages.pieceAt(x, z)) return false;
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
          const h = this.heightAt(x, z);
          if (h > SEA_LEVEL + 1 && !this.isCarved(x, h, z) && !this.isCarved(x, h - 1, z) && !this.trees.coversColumn(x, z)) return [x, z];
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
        const { top: topId, sub: subId } = surfaceBlocks(biome, h, this.options.vanilla);
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
    if (this.options.vanilla) {
      // (Round 11) A Survival world: vanilla's ores, its lakes and frozen
      // waters, and no alien crystals.
      this._vanillaColumns(blocks, baseX, baseZ, hAt, biomeAt);
      this._placeVanillaVeins(blocks, chunk.cx, chunk.cz, biomeAt);
      this._placeLavaPool(blocks, chunk.cx, chunk.cz, hAt, biomeAt);
      this._placeClay(blocks, chunk.cx, chunk.cz, hAt, biomeAt);
      this.structures.placeUnderground(blocks, chunk.cx, chunk.cz, hAt);
    } else {
      this._placeVeins(blocks, chunk.cx, chunk.cz);
      this._placeCrystals(blocks, baseX, baseZ);
    }

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
        // (Round 12) A Survival world's bamboo: thick in the bamboo jungle
        // (on podzol), a stalk now and then in the rest of the jungle.
        if (this.options.vanilla && blocks[ground] === BLOCK.GRASS && blocks[above] === BLOCK.AIR && biomeAt(lx, lz) === BIOME.JUNGLE && this._bamboo(blocks, idx, lx, lz, h, wx, wz)) continue;
        if (blocks[ground] === BLOCK.GRASS && blocks[above] === BLOCK.AIR) {
          const r = hash2(this.seed ^ PLANT_SALT, wx, wz);
          const patch = this.noise.perlin2(wx * 0.045 + 31.7, wz * 0.045 - 12.3); // -0.7..0.7
          const meadow = biomeAt(lx, lz) === BIOME.MEADOW;
          // (Round 12) a Survival world's jungle floor: thick with grass and ferns, few flowers
          const jungle = this.options.vanilla && biomeAt(lx, lz) === BIOME.JUNGLE;
          const flowerChance = meadow ? 0.06 + Math.max(0, patch) * 0.16 : Math.max(0, patch - 0.15) * (jungle ? 0.06 : 0.25);
          if (r < flowerChance) {
            const pick = hash2(this.seed ^ 0x2f6b, wx, wz);
            if (this.options.vanilla) {
              const list = FLOWERS[biomeAt(lx, lz)] || DEFAULT_FLOWERS;
              blocks[above] = list[Math.floor(pick * list.length)];
            } else blocks[above] = pick < 0.5 ? BLOCK.FLOWER_RED : BLOCK.FLOWER_YELLOW;
          } else if (r < flowerChance + (meadow ? 0.2 : jungle ? 0.3 : 0.11) + Math.max(0, -patch) * 0.1) {
            blocks[above] = BLOCK.TALL_GRASS;
            // (a Survival world's taigas and jungles: ferns among the grass)
            if (this.options.vanilla) {
              const b = biomeAt(lx, lz);
              const fern = b === BIOME.TAIGA ? 0.4 : b === BIOME.JUNGLE ? 0.25 : 0;
              if (fern && hash2(this.seed ^ VANILLA_PLANT_SALT, wx, wz) < fern) blocks[above] = V.FERN;
            }
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

    if (this.options.vanilla) {
      this._vanillaCover(blocks, chunk.cx, chunk.cz, hAt, biomeAt);
      this.structures.placeSurface(blocks, chunk.cx, chunk.cz, hAt, biomeAt);
    }

    // Villages: placed last so they overwrite any trees or ground cover in
    // their footprint with a flattened pad, houses, paths and a farm plot.
    this.villages.placeInChunk(blocks, chunk.cx, chunk.cz);
    // Airports and cities: levelled pads with runways, hangars, streets, towers.
    this.sites.placeInChunk(blocks, chunk.cx, chunk.cz, hAt); // (the heights computed above, not again)
  }

  // ---------- (Round 11) A Survival world's terrain ----------

  // Per column, before the trees: banded terracotta under the badlands' red
  // sand, and ice over the snowy climate's waters.
  _vanillaColumns(blocks, baseX, baseZ, hAt, biomeAt) {
    const S = CHUNK_SIZE;
    const bands = BADLAND_BANDS.filter((id) => BLOCK_INFO[id]);
    const shift = this.seed % 12;
    for (let lz = 0; lz < S; lz++) {
      for (let lx = 0; lx < S; lx++) {
        const h = hAt(lx, lz);
        if (h < SEA_LEVEL) {
          if (this.frozenAt(baseX + lx, baseZ + lz)) {
            const i = (SEA_LEVEL * S + lz) * S + lx;
            if (blocks[i] === BLOCK.WATER) blocks[i] = V.ICE;
          }
        } else if (biomeAt(lx, lz) === BIOME.BADLANDS && bands.length) {
          for (let y = Math.max(2, h - 12); y < h; y++) {
            const i = (y * S + lz) * S + lx;
            if (blocks[i] === BLOCK.STONE || blocks[i] === BLOCK.TERRACOTTA) blocks[i] = bands[(y + shift) % bands.length];
          }
        }
      }
    }
  }

  // Vanilla's veins (VANILLA_VEINS), in their own random stream.
  _placeVanillaVeins(blocks, cx, cz, biomeAt) {
    const S = CHUNK_SIZE;
    const rand = mulberry32((this.seed ^ Math.imul(cx, 0x27d4eb2f) ^ Math.imul(cz, 0x165667b1) ^ 0x0de5) >>> 0);
    const bandSet = new Set(BADLAND_BANDS); // (the badlands' own veins go through its terracotta too: _vanillaColumns ran first)
    const vein = (id, minSize, maxSize, minY, maxY, biome) => {
      let x = Math.floor(rand() * S);
      let y = minY + Math.floor(rand() * (maxY - minY + 1));
      let z = Math.floor(rand() * S);
      const size = minSize + Math.floor(rand() * (maxSize - minSize + 1));
      const here = (biome === undefined || biomeAt(x, z) === biome) && !!BLOCK_INFO[id];
      for (let k = 0; k < size; k++) {
        if (here && x >= 0 && x < S && z >= 0 && z < S && y >= 1 && y < WORLD_HEIGHT) {
          const i = (y * S + z) * S + x;
          if (blocks[i] === BLOCK.STONE || (biome === BIOME.BADLANDS && bandSet.has(blocks[i]))) blocks[i] = id;
        }
        const axis = Math.floor(rand() * 3);
        const step = rand() < 0.5 ? -1 : 1;
        if (axis === 0) x += step;
        else if (axis === 1) y += step;
        else z += step;
      }
    };
    for (const [id, perChunk, minSize, maxSize, minY, maxY, biome] of [...VANILLA_VEINS, ...VANILLA_BIOME_VEINS]) {
      const count = Math.floor(perChunk) + (rand() < perChunk % 1 ? 1 : 0);
      // (a block another part hasn't defined yet is skipped, its draws still made: the rest stay put)
      for (let v = 0; v < count; v++) vein(id, minSize, maxSize, minY, maxY, biome);
    }
  }

  // A rare lava pool sunk into level, dry ground (about one chunk in 90),
  // walled with stone; never at a village or under a tree.
  _placeLavaPool(blocks, cx, cz, hAt, biomeAt) {
    if (hash2((this.seed ^ POOL_SALT) >>> 0, cx, cz) >= 1 / 90) return;
    const S = CHUNK_SIZE;
    const rand = mulberry32((this.seed ^ Math.imul(cx, 0x3c6ef372) ^ Math.imul(cz, 0x1b873593)) >>> 0);
    const lx0 = 4 + Math.floor(rand() * 8);
    const lz0 = 4 + Math.floor(rand() * 8);
    const h0 = hAt(lx0, lz0);
    const b = biomeAt(lx0, lz0);
    if (h0 <= SEA_LEVEL + 2 || h0 >= WORLD_HEIGHT - 4 || isOceanBiome(b) || b === BIOME.RIVER || b === BIOME.BEACH || b === BIOME.SWAMP) return;
    const wx0 = cx * S + lx0;
    const wz0 = cz * S + lz0;
    if (this.villages.nearestVillage(wx0, wz0, this.villages.reach + 12) || this.structures.blocksTree(wx0, wz0, 9) || this.structures._onSite(wx0, wz0, 8)) return;
    const rx = 2 + rand() * 1.6;
    const rz = 2 + rand() * 1.6;
    const cells = [];
    for (let dz = -4; dz <= 4; dz++) {
      for (let dx = -4; dx <= 4; dx++) {
        const e = (dx / rx) ** 2 + (dz / rz) ** 2;
        if (e > 1.8) continue;
        const h = hAt(lx0 + dx, lz0 + dz);
        // (the pool and its rim on level ground, no tree trunk in it)
        if (h < h0 || h > h0 + 1) return;
        if (e > 1) continue;
        if (this.trees.rootAt(wx0 + dx, wz0 + dz)) return;
        cells.push(lx0 + dx, lz0 + dz, e < 0.35 ? 2 : 1, h);
      }
    }
    const idx = (x, y, z) => (y * S + z) * S + x;
    for (let i = 0; i < cells.length; i += 4) {
      const [x, z, depth, h] = cells.slice(i, i + 4);
      for (let y = h0; y <= h; y++) blocks[idx(x, y, z)] = BLOCK.AIR;
      for (let d = 1; d <= depth; d++) blocks[idx(x, h0 - d, z)] = V.LAVA;
      const below = idx(x, h0 - depth - 1, z);
      if (blocks[below] !== V.LAVA) blocks[below] = BLOCK.STONE;
    }
    // Stone walls where the lava meets earth (or a cave) beside it.
    for (let i = 0; i < cells.length; i += 4) {
      const x = cells[i];
      const z = cells[i + 1];
      for (let d = 1; d <= cells[i + 2]; d++) {
        const y = h0 - d;
        for (const [sx, sz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const nx = x + sx;
          const nz = z + sz;
          if (nx < 0 || nx >= S || nz < 0 || nz >= S) continue;
          const n = idx(nx, y, nz);
          if (blocks[n] !== V.LAVA) blocks[n] = BLOCK.STONE;
        }
      }
    }
  }

  // Clay in the beds of rivers, lakes and shallow seas: a few small disks.
  _placeClay(blocks, cx, cz, hAt, biomeAt) {
    const S = CHUNK_SIZE;
    const rand = mulberry32((this.seed ^ CLAY_SALT ^ Math.imul(cx, 0x7feb352d) ^ Math.imul(cz, 0x846ca68b)) >>> 0);
    const idx = (x, y, z) => (y * S + z) * S + x;
    const bed = (id) => id === BLOCK.SAND || id === BLOCK.DIRT || id === BLOCK.GRAVEL;
    for (let a = 0; a < 3; a++) {
      const lx = 3 + Math.floor(rand() * 10);
      const lz = 3 + Math.floor(rand() * 10);
      const r = 1 + Math.floor(rand() * 2.5);
      const deep = rand();
      const h = hAt(lx, lz);
      if (h >= SEA_LEVEL || h < SEA_LEVEL - 8 || !bed(blocks[idx(lx, h, lz)])) continue;
      const b = biomeAt(lx, lz);
      if (a > 0 && b !== BIOME.RIVER && b !== BIOME.SWAMP) continue; // (the extra ones in rivers)
      for (let dz = -r; dz <= r; dz++) {
        for (let dx = -r; dx <= r; dx++) {
          if (dx * dx + dz * dz > r * r) continue;
          const x = lx + dx;
          const z = lz + dz;
          const hh = hAt(x, z);
          if (hh >= SEA_LEVEL || !bed(blocks[idx(x, hh, z)])) continue;
          blocks[idx(x, hh, z)] = V.CLAY;
          if (deep < 0.6 && bed(blocks[idx(x, hh - 1, z)])) blocks[idx(x, hh - 1, z)] = V.CLAY;
        }
      }
    }
  }

  // After the trees and the grass: snow on the snowy ground, podzol in the
  // taiga, coarse dirt in the savanna, mushrooms in the shade and in caves,
  // sugar cane by the water, lily pads on swamp pools, pumpkin and melon
  // patches.
  _vanillaCover(blocks, cx, cz, hAt, biomeAt) {
    const S = CHUNK_SIZE;
    const baseX = cx * S;
    const baseZ = cz * S;
    const idx = (x, y, z) => (y * S + z) * S + x;
    for (let lz = 0; lz < S; lz++) {
      for (let lx = 0; lx < S; lx++) {
        const h = hAt(lx, lz);
        if (h + 3 >= WORLD_HEIGHT) continue;
        const wx = baseX + lx;
        const wz = baseZ + lz;
        const gi = idx(lx, h, lz);
        const ai = idx(lx, h + 1, lz);
        const g = blocks[gi];
        const a = blocks[ai];
        const b = biomeAt(lx, lz);
        const r = hash2((this.seed ^ VANILLA_PLANT_SALT) >>> 0, wx, wz);
        if (g === SNOWY_GRASS) {
          if (a === BLOCK.AIR) blocks[ai] = V.SNOW_LAYER;
          continue;
        }
        if (g === BLOCK.GRASS) {
          if (b === BIOME.TAIGA || b === BIOME.SAVANNA) {
            const patch = this.noise.perlin2(wx * 0.07 + 13.1, wz * 0.07 - 5.7);
            if (b === BIOME.TAIGA && patch > 0.22) {
              blocks[gi] = V.PODZOL;
              if (a === BLOCK.TALL_GRASS || a === BLOCK.FLOWER_RED || a === BLOCK.FLOWER_YELLOW) blocks[ai] = V.FERN;
              continue;
            }
            if (b === BIOME.SAVANNA && patch > 0.32) {
              blocks[gi] = V.COARSE_DIRT;
              if (a === BLOCK.TALL_GRASS || a === BLOCK.FLOWER_RED || a === BLOCK.FLOWER_YELLOW) blocks[ai] = BLOCK.AIR;
              continue;
            }
          }
          if (a === BLOCK.AIR && r < 0.006 && (b === BIOME.DARK_FOREST || b === BIOME.SWAMP || b === BIOME.TAIGA)) {
            blocks[ai] = r < 0.004 ? V.BROWN_MUSHROOM : V.RED_MUSHROOM;
            continue;
          }
        }
        // Sugar cane on soil or sand right beside water.
        if ((g === BLOCK.GRASS || g === BLOCK.SAND || g === BLOCK.DIRT) && (a === BLOCK.AIR || a === BLOCK.TALL_GRASS) && h <= SEA_LEVEL + 2 && r > 0.88) {
          let wet = false;
          for (const [sx, sz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
            const nx = lx + sx;
            const nz = lz + sz;
            if (nx >= 0 && nx < S && nz >= 0 && nz < S && blocks[idx(nx, h, nz)] === BLOCK.WATER) wet = true;
          }
          if (wet) {
            const tall = 1 + Math.floor(hash2((this.seed ^ VANILLA_PLANT_SALT ^ 0x51) >>> 0, wx, wz) * 3);
            for (let k = 1; k <= tall && blocks[idx(lx, h + k, lz)] === (k === 1 ? a : BLOCK.AIR); k++) blocks[idx(lx, h + k, lz)] = V.SUGAR_CANE;
          }
          continue;
        }
        // Lily pads on the shallow water of a swamp's climate (its pools and
        // shores are counted as beach, river or sea: biomes.js).
        if (r < 0.12 && h < SEA_LEVEL && h >= SEA_LEVEL - 4 && blocks[idx(lx, SEA_LEVEL, lz)] === BLOCK.WATER && blocks[idx(lx, SEA_LEVEL + 1, lz)] === BLOCK.AIR) {
          const { t, m } = this.biomes.climate(wx, wz);
          if (m > 0.4 && t >= -0.3 && t <= 0.16) blocks[idx(lx, SEA_LEVEL + 1, lz)] = V.LILY_PAD;
        }
      }
    }
    const rand = mulberry32((this.seed ^ PATCH_SALT ^ Math.imul(cx, 0x5bd1e995) ^ Math.imul(cz, 0x1b873593)) >>> 0);
    // Pumpkin patches in grassland and woods (about one chunk in 90), melons
    // in the jungle (one in 8).
    const patch = rand();
    const px = 3 + Math.floor(rand() * 10);
    const pz = 3 + Math.floor(rand() * 10);
    const pb = biomeAt(px, pz);
    const fruit = PUMPKIN_BIOMES.has(pb) && patch < 1 / 90 ? V.PUMPKIN : pb === BIOME.JUNGLE && patch < 1 / 8 ? V.MELON : 0;
    for (let i = 0; i < 10; i++) {
      const x = px + Math.floor(rand() * 7) - 3;
      const z = pz + Math.floor(rand() * 7) - 3;
      if (!fruit) continue;
      const h = hAt(x, z);
      if (h + 1 >= WORLD_HEIGHT || blocks[idx(x, h, z)] !== BLOCK.GRASS) continue;
      const a = blocks[idx(x, h + 1, z)];
      if (a === BLOCK.AIR || a === BLOCK.TALL_GRASS || a === V.FERN) blocks[idx(x, h + 1, z)] = fruit;
    }
    // Mushrooms on cave floors.
    for (let i = 0; i < 4; i++) {
      const x = Math.floor(rand() * S);
      const z = Math.floor(rand() * S);
      const top = Math.min(hAt(x, z) - 6, 50);
      const y = LAVA_LEVEL + 2 + Math.floor(rand() * Math.max(1, top - LAVA_LEVEL - 2));
      const pick = rand();
      if (y >= top || blocks[idx(x, y, z)] !== BLOCK.AIR || blocks[idx(x, y - 1, z)] !== BLOCK.STONE) continue;
      blocks[idx(x, y, z)] = pick < 0.6 ? V.BROWN_MUSHROOM : V.RED_MUSHROOM;
    }
  }

  // (Round 12) Bamboo in a jungle column (its ground grass, air over it),
  // as vanilla's BambooFeature: a thick stalk 5-16 tall (as far as there is
  // room), its top two blocks with large leaves and the next small. In the
  // bamboo jungle (biomes.js bambooField) about a third of the columns,
  // podzol under them and in patches round them; elsewhere in the jungle one
  // column in about 600. True if the column took it (no grass then).
  _bamboo(blocks, idx, lx, lz, h, wx, wz) {
    const field = this.biomes.bambooField(wx, wz);
    const r = hash2(this.seed ^ BAMBOO_SALT, wx, wz);
    const ground = idx(lx, h, lz);
    const inside = field > 0.5;
    if (inside && this.noise.perlin2(wx * 0.13 - 7.1, wz * 0.13 + 3.3) > 0.02) blocks[ground] = V.PODZOL;
    if (r >= (inside ? 0.34 * field : 0.0017)) return false;
    const want = 5 + Math.floor(hash2((this.seed ^ BAMBOO_SALT ^ 0x77) >>> 0, wx, wz) * 12);
    let n = 0;
    while (n < want && h + 1 + n < WORLD_HEIGHT && blocks[idx(lx, h + 1 + n, lz)] === BLOCK.AIR) n++;
    if (n < 3) return false;
    for (let k = 0; k < n; k++) blocks[idx(lx, h + 1 + k, lz)] = V.BAMBOO + 3 + (k >= n - 2 ? 2 : k === n - 3 ? 1 : 0);
    blocks[ground] = V.PODZOL;
    return true;
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
    const lavaBelow = this.options.vanilla; // (Round 11: lava lakes at the bottom of a Survival world's caves)
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
          if (carve) blocks[i] = lavaBelow && y <= LAVA_LEVEL ? V.LAVA : BLOCK.AIR;
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
