// Biome classification: smooth, low-frequency temperature and moisture
// fields (plus the column's height and how mountainous the terrain is
// there) pick a biome for any column. Pure logic (no three.js), callable
// independently per-column exactly like TerrainGenerator.heightAt, so trees
// and decoration can query it for any column without generating a chunk.
import { Noise } from "./noise.js";
import { SEA_LEVEL } from "./constants.js";

export const BIOME = Object.freeze({
  DEEP_OCEAN: 0,
  OCEAN: 1,
  WARM_OCEAN: 2,
  BEACH: 3,
  RIVER: 4,
  PLAINS: 5,
  FOREST: 6,
  BIRCH_FOREST: 7,
  DARK_FOREST: 8,
  TAIGA: 9,
  SNOWY_TAIGA: 10,
  SNOWY_PLAINS: 11,
  DESERT: 12,
  SAVANNA: 13,
  JUNGLE: 14,
  SWAMP: 15,
  BADLANDS: 16,
  MOUNTAINS: 17,
  MEADOW: 18, // Round 6: very flat, flowery grassland (the flat country of the temperate zone)
});

export const BIOME_NAMES = {
  [BIOME.DEEP_OCEAN]: "Deep Ocean",
  [BIOME.OCEAN]: "Ocean",
  [BIOME.WARM_OCEAN]: "Warm Ocean",
  [BIOME.BEACH]: "Beach",
  [BIOME.RIVER]: "River",
  [BIOME.PLAINS]: "Plains",
  [BIOME.FOREST]: "Forest",
  [BIOME.BIRCH_FOREST]: "Birch Forest",
  [BIOME.DARK_FOREST]: "Dark Forest",
  [BIOME.TAIGA]: "Taiga",
  [BIOME.SNOWY_TAIGA]: "Snowy Taiga",
  [BIOME.SNOWY_PLAINS]: "Snowy Plains",
  [BIOME.DESERT]: "Desert",
  [BIOME.SAVANNA]: "Savanna",
  [BIOME.JUNGLE]: "Jungle",
  [BIOME.SWAMP]: "Swamp",
  [BIOME.BADLANDS]: "Badlands",
  [BIOME.MOUNTAINS]: "Mountains",
  [BIOME.MEADOW]: "Meadow",
};

// Biomes cold enough that their ground is snow-capped and their trees (if
// any) are pines.
export function isSnowy(biome) {
  return biome === BIOME.SNOWY_PLAINS || biome === BIOME.SNOWY_TAIGA || biome === BIOME.MOUNTAINS;
}

export function isOceanBiome(biome) {
  return biome === BIOME.DEEP_OCEAN || biome === BIOME.OCEAN || biome === BIOME.WARM_OCEAN;
}

// (Round 12) A Survival world's jungles: the hot zone's share of wet
// ground (moisture over JUNGLE_M is jungle), and how far into a jungle a
// column is (jungleDepth: 0 at its edge, the sparse jungle, 1 inside).
export const JUNGLE_M = 0.22;
const JUNGLE_DEEP = 0.12; // (moisture above JUNGLE_M at which the jungle is full)

export class BiomeSource {
  // opts.vanilla: a Survival world's climate (its wet regions, see climate).
  constructor(seed, opts = {}) {
    this.tempNoise = new Noise((seed ^ 0x1a2b3c4d) >>> 0);
    this.moistNoise = new Noise((seed ^ 0x5e6f7081) >>> 0);
    this.dryNoise = new Noise((seed ^ 0x3d5a9e17) >>> 0);
    this.vanilla = !!opts.vanilla;
    this.wetNoise = this.vanilla ? new Noise((seed ^ 0x6b43a9b5) >>> 0) : null;
    this.bambooNoise = this.vanilla ? new Noise((seed ^ 0x2e9b5c17) >>> 0) : null;
  }

  // Smooth climate fields, roughly in [-0.7, 0.7]: t = cold..hot, m = dry..wet.
  climate(wx, wz) {
    // Big biomes (Round 3: several hundred to a couple of thousand blocks
    // across, like classic block games), with a little wobble at the edges.
    // (Round 6: bigger again, so a desert or a jungle is a region you travel through for a long time.)
    const t = this.tempNoise.fbm2(wx, wz, 3, 0.45, 2, 1 / 2200) * 1.2;
    const m = this.moistNoise.fbm2(wx + 4000, wz - 4000, 3, 0.45, 2, 1 / 1900) * 1.2;
    // Round 8: now and then a very large dry region: a very-low-frequency
    // field that, where it is high, makes the climate hot and dry, so a
    // desert can stretch for many kilometres (most worlds have one within
    // a few kilometres of the start).
    const dry = this.dryNoise.fbm2(wx - 9000, wz + 7000, 1, 0.5, 2, 1 / 7000) * 0.85;
    const k = Math.min(1, Math.max(0, (dry - 0.3) / 0.15));
    let w = 0;
    if (k > 0) {
      w = k * k * (3 - 2 * k);
      if (!this.vanilla) return { t: t + (0.42 - t) * w * (t < 0.42 ? 1 : 0), m: m + (-0.35 - m) * w * (m > -0.35 ? 1 : 0) };
    }
    let tt = t + (0.42 - t) * w * (t < 0.42 ? 1 : 0);
    let mm = m + (-0.35 - m) * w * (m > -0.35 ? 1 : 0);
    // (Round 12) A Survival world: wet regions in the hot zone (a field of
    // their own, about a thousand blocks across, never in the great dry
    // regions), so jungles are no rarity: about one land column in twelve
    // instead of one in twenty-five, the nearest mostly within a kilometre or
    // two of the start.
    if (this.vanilla && tt > 0.16 && w < 1) {
      const wet = this.wetNoise.fbm2(wx + 6100, wz - 2700, 2, 0.5, 2, 1 / 1300);
      const kw = Math.min(1, Math.max(0, (wet - 0.06) / 0.16)) * (1 - w);
      if (kw > 0 && mm < 0.36) mm += (0.36 - mm) * kw * kw * (3 - 2 * kw);
    }
    return { t: tt, m: mm };
  }

  // (Round 12) How far into a jungle (wx, wz) is: 0 at its edge (vanilla's
  // sparse jungle: fewer trees, no giants) to 1 well inside; 0 outside one.
  jungleDepth(wx, wz) {
    const { t, m } = this.climate(wx, wz);
    if (t <= 0.16 || m <= JUNGLE_M) return 0;
    return Math.min(1, (m - JUNGLE_M) / JUNGLE_DEEP);
  }

  // (Round 12) Vanilla's bamboo jungle: patches of a Survival world's
  // jungles (a field of their own, a few hundred blocks across, about a
  // third of a jungle) thick with bamboo on podzol, their trees fewer. How
  // much of one (wx, wz) is, 0-1 (over 0.5: inside one), wherever it is
  // (the terrain asks it of jungle columns only); 0 in a Missions world.
  bambooField(wx, wz) {
    if (!this.bambooNoise) return 0;
    const n = this.bambooNoise.fbm2(wx - 3300, wz + 5100, 2, 0.5, 2, 1 / 420);
    return Math.min(1, Math.max(0, (n - 0.06) / 0.1));
  }

  // (Round 12) Whether the climate at (wx, wz) is a jungle's (whatever the
  // ground: a cheap test before the terrain's own).
  hotWet(wx, wz) {
    const { t, m } = this.climate(wx, wz);
    return t > 0.16 && m > JUNGLE_M;
  }

  // (Round 11) Whether the climate at (wx, wz) is the snowy zone's (where a
  // Survival world's waters freeze over). Cheap where it is warm: the
  // temperature alone first (the dry regions only ever warm a place up).
  coldAt(wx, wz) {
    const t = this.tempNoise.fbm2(wx, wz, 3, 0.45, 2, 1 / 2200) * 1.2;
    if (t >= -0.3) return false;
    return this.climate(wx, wz).t < -0.3;
  }

  // h: terrain height at (wx, wz). mountainT: 0-1, how mountainous. river:
  // whether this column sits in a river channel (both from terrain.js, which
  // already computes them while finding the height).
  biomeAt(wx, wz, h, mountainT, river, flat = 0) {
    if (h < SEA_LEVEL - 1) {
      const { t } = this.climate(wx, wz);
      if (h < SEA_LEVEL - 12) return BIOME.DEEP_OCEAN;
      return t > 0.25 ? BIOME.WARM_OCEAN : BIOME.OCEAN;
    }
    if (river && h <= SEA_LEVEL + 3) return BIOME.RIVER;
    if (h <= SEA_LEVEL + 1) return BIOME.BEACH;
    if (mountainT > 0.45 && h > SEA_LEVEL + 14) return BIOME.MOUNTAINS;
    const { t, m } = this.climate(wx, wz);
    if (t < -0.3) return m > -0.05 ? BIOME.SNOWY_TAIGA : BIOME.SNOWY_PLAINS;
    // The hot zone is wide: deserts take the dry half of it, jungles the wet third, savanna between.
    if (t > 0.16) {
      // (Round 8: deserts take a bigger share of the hot zone.)
      if (m > JUNGLE_M) return BIOME.JUNGLE;
      if (m > 0.07) return BIOME.SAVANNA;
      return BIOME.DESERT;
    }
    if (t > 0.08 && m < -0.3) return BIOME.BADLANDS;
    if (m > 0.4) return BIOME.SWAMP;
    if (m > 0.12) {
      if (t < -0.1) return BIOME.TAIGA;
      return flat > 0.5 ? BIOME.MEADOW : m > 0.3 ? BIOME.DARK_FOREST : BIOME.FOREST;
    }
    if (m > -0.1) return flat > 0.5 ? BIOME.MEADOW : BIOME.BIRCH_FOREST;
    return flat > 0.4 ? BIOME.MEADOW : BIOME.PLAINS;
  }
}
