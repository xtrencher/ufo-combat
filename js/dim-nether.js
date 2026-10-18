// The Nether's terrain (Round 12, wave A): a STAND-IN so the dimension
// engine (js/dimensions.js) can be travelled and tested before the Nether's
// own part (wave B) replaces this file with the real generator, blocks and
// structures. It keeps the interface every dimension's generator has
// (js/dim-registry.js): generate(chunk), heightAt(x, z), biomeAt(x, z).
//
// What it makes, as vanilla's shape: a bedrock floor (y 0-4) and roof
// (y 123-127), the space between carved by 3D noise into vast caves, a lava
// sea up to y 31, glowing clusters hanging from the roofs. The rock is red
// terracotta and the clusters lumen crystal until the Nether's own blocks
// (netherrack, glowstone) exist. Pure (no three.js): the workers run it too.
import { BLOCK } from "./content/base.js";
import { RED_TERRACOTTA, LAVA } from "./content/ids.js";
import { Noise, hash2 } from "./noise.js";
import { CHUNK_SIZE, WORLD_HEIGHT } from "./constants.js";

export const NETHER_LAVA_LEVEL = 31;
const ROCK = RED_TERRACOTTA;
const GLOW = BLOCK.LUMEN;
// (the density field is sampled every 4 blocks across and 8 up, then
// interpolated: a chunk costs a few hundred noise samples, not 32 000)
const SX = 4;
const SY = 8;
const NX = CHUNK_SIZE / SX + 1;
const NY = WORLD_HEIGHT / SY + 1;

export class NetherGenerator {
  constructor(seed) {
    this.seed = (seed ^ 0x4e455448) >>> 0;
    this.noise = new Noise(this.seed);
    this.detail = new Noise((this.seed ^ 0x9e3779b9) >>> 0);
    this._grid = new Float32Array(NX * NY * NX);
  }

  // Solid (> 0) or open: big caverns, smaller passages, and the rock
  // closing in toward the floor and the roof.
  _density(x, y, z) {
    const big = this.noise.perlin3(x / 56, y / 30, z / 56);
    const small = this.detail.perlin3(x / 18, y / 12, z / 18);
    const floor = Math.max(0, (24 - y) / 24) * 0.9;
    const roof = Math.max(0, (y - 96) / 28) * 1.1;
    return big * 0.9 + small * 0.35 + floor + roof - 0.12;
  }

  generate(chunk) {
    const blocks = chunk.blocks;
    const bx = chunk.cx * CHUNK_SIZE;
    const bz = chunk.cz * CHUNK_SIZE;
    const g = this._grid;
    for (let iz = 0; iz < NX; iz++) for (let iy = 0; iy < NY; iy++) for (let ix = 0; ix < NX; ix++) g[(iz * NY + iy) * NX + ix] = this._density(bx + ix * SX, iy * SY, bz + iz * SX);
    const at = (ix, iy, iz) => g[(iz * NY + iy) * NX + ix];
    for (let z = 0; z < CHUNK_SIZE; z++) {
      const iz = z >> 2;
      const fz = (z & 3) / SX;
      for (let x = 0; x < CHUNK_SIZE; x++) {
        const ix = x >> 2;
        const fx = (x & 3) / SX;
        const wx = bx + x;
        const wz = bz + z;
        const floorTop = 1 + Math.floor(hash2(this.seed, wx, wz) * 4);
        const roofLow = WORLD_HEIGHT - 2 - Math.floor(hash2(this.seed ^ 77, wx, wz) * 4);
        for (let y = 0; y < WORLD_HEIGHT; y++) {
          const i = (y << 8) | (z << 4) | x;
          if (y <= floorTop || y >= roofLow) {
            blocks[i] = BLOCK.BEDROCK;
            continue;
          }
          const iy = y >> 3;
          const fy = (y & 7) / SY;
          const c00 = at(ix, iy, iz) + (at(ix + 1, iy, iz) - at(ix, iy, iz)) * fx;
          const c10 = at(ix, iy + 1, iz) + (at(ix + 1, iy + 1, iz) - at(ix, iy + 1, iz)) * fx;
          const c01 = at(ix, iy, iz + 1) + (at(ix + 1, iy, iz + 1) - at(ix, iy, iz + 1)) * fx;
          const c11 = at(ix, iy + 1, iz + 1) + (at(ix + 1, iy + 1, iz + 1) - at(ix, iy + 1, iz + 1)) * fx;
          const d = (c00 + (c10 - c00) * fy) * (1 - fz) + (c01 + (c11 - c01) * fy) * fz;
          blocks[i] = d > 0 ? ROCK : y <= NETHER_LAVA_LEVEL ? LAVA : BLOCK.AIR;
        }
        // Glowing clusters under the roofs (vanilla's glowstone, high up).
        if (hash2(this.seed ^ 0x51ab, wx, wz) < 0.012) {
          for (let y = roofLow - 1; y > 64; y--) {
            const i = (y << 8) | (z << 4) | x;
            if (blocks[i] !== BLOCK.AIR) continue;
            if (blocks[i + 256] !== ROCK && blocks[i + 256] !== BLOCK.BEDROCK) break;
            const n = 1 + Math.floor(hash2(this.seed ^ 0x77, wx, wz) * 3);
            for (let k = 0; k < n && y - k > NETHER_LAVA_LEVEL + 1; k++) blocks[i - k * 256] = GLOW;
            break;
          }
        }
      }
    }
  }

  // (No height map: the lava sea's level, for anything that asks.)
  heightAt() {
    return NETHER_LAVA_LEVEL;
  }

  biomeAt() {
    return -1;
  }
}
