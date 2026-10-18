// The End's terrain (Round 12, wave A): a STAND-IN so the dimension engine
// (js/dimensions.js) can be travelled and tested before the End's own part
// (wave B) replaces this file with the real island, pillars, gateways and
// outer islands. It keeps the interface every dimension's generator has
// (js/dim-registry.js): generate(chunk), heightAt(x, z), biomeAt(x, z).
//
// What it makes, as vanilla's shape: one island of pale stone floating over
// the void around (0, 0), about 90 blocks across its middle, its top near
// y 60 and its underside tapering down; a few obsidian pillars on it.
// Nothing else: the arrival platform at (100, 48, 0) is built by the engine
// as vanilla does on every arrival. The stone is sandstone until the End's
// own end stone exists. Pure (no three.js): the workers run it too.
import { SANDSTONE, OBSIDIAN } from "./content/ids.js";
import { Noise } from "./noise.js";
import { CHUNK_SIZE, WORLD_HEIGHT } from "./constants.js";

const STONE = SANDSTONE;
const ISLAND_R = 90;
const TOP = 60;
const PILLARS = 6;
const PILLAR_RING = 42;

export class EndGenerator {
  constructor(seed) {
    this.seed = (seed ^ 0x454e44) >>> 0;
    this.noise = new Noise(this.seed);
    this.pillars = [];
    for (let i = 0; i < PILLARS; i++) {
      const a = (i / PILLARS) * Math.PI * 2;
      this.pillars.push({ x: Math.round(Math.cos(a) * PILLAR_RING), z: Math.round(Math.sin(a) * PILLAR_RING), r: 2 + (i % 3), h: 76 + i * 3 });
    }
  }

  // The island's top and bottom in column (x, z), or null (void).
  _column(x, z) {
    const n = this.noise.fbm2(x, z, 3, 0.5, 2, 1 / 40);
    const r = Math.hypot(x, z) / (ISLAND_R * (0.92 + n * 0.12));
    if (r >= 1) return null;
    const top = Math.round(TOP + n * 3 - r * r * 6);
    const bottom = Math.round(TOP - 6 - (1 - r * r) * 34 + n * 4);
    return bottom < top ? [bottom, top] : null;
  }

  generate(chunk) {
    const blocks = chunk.blocks;
    const bx = chunk.cx * CHUNK_SIZE;
    const bz = chunk.cz * CHUNK_SIZE;
    // (far from the island: the void, at once)
    if (Math.hypot(bx + 8, bz + 8) > ISLAND_R * 1.2 + 12) return;
    for (let z = 0; z < CHUNK_SIZE; z++) {
      for (let x = 0; x < CHUNK_SIZE; x++) {
        const wx = bx + x;
        const wz = bz + z;
        const col = this._column(wx, wz);
        if (col) for (let y = Math.max(0, col[0]); y <= col[1]; y++) blocks[(y << 8) | (z << 4) | x] = STONE;
        for (const p of this.pillars) {
          if ((wx - p.x) ** 2 + (wz - p.z) ** 2 > p.r * p.r + p.r) continue;
          const from = col ? col[1] + 1 : TOP;
          for (let y = from; y <= Math.min(p.h, WORLD_HEIGHT - 1); y++) blocks[(y << 8) | (z << 4) | x] = OBSIDIAN;
        }
      }
    }
  }

  // (The island's top, or -1 over the void.)
  heightAt(x, z) {
    const col = this._column(x, z);
    return col ? col[1] : -1;
  }

  biomeAt() {
    return -1;
  }
}
