// The Nether's air (Round 12): each biome's fog colour (vanilla's: the
// wastes' dark red, the soul sand valleys' cyan-grey, the crimson forests'
// red, the warped forests' dark purple, the basalt deltas' grey), blended
// over a few seconds as you walk from one into another, and what floats in
// it: the deltas' white ash, the valleys' ash, the forests' crimson and
// warped spores. The sky reads the Nether's sky entry every frame (sky.js
// _applyDimension), so the colours are changed in place there.
// Cheap: one biome lookup when the player moves a block, a few billboards a
// second from the effects' pools; nothing at all outside the Nether.
import { DIMS, NETHER } from "./dim-registry.js";
import { NETHER_BIOME } from "./dim-nether.js";

const toLin = (h) => [16, 8, 0].map((s) => {
  const c = ((h >> s) & 255) / 255;
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
});
const scale = (v, k) => v.map((c) => c * k);
// Each biome's sky (linear HDR, as dim-registry.js's): the fog colour on the
// horizon, a darker zenith, the ambient light's tint.
const SKIES = {
  [NETHER_BIOME.WASTES]: { fog: 0x330808, ambSky: [0.07, 0.035, 0.03], ambGround: [0.05, 0.025, 0.02] },
  [NETHER_BIOME.SOUL_SAND_VALLEY]: { fog: 0x1b4745, ambSky: [0.04, 0.06, 0.06], ambGround: [0.03, 0.042, 0.042] },
  [NETHER_BIOME.CRIMSON_FOREST]: { fog: 0x330303, ambSky: [0.075, 0.03, 0.026], ambGround: [0.055, 0.02, 0.018] },
  [NETHER_BIOME.WARPED_FOREST]: { fog: 0x1a051a, ambSky: [0.045, 0.045, 0.055], ambGround: [0.032, 0.034, 0.04] },
  [NETHER_BIOME.BASALT_DELTAS]: { fog: 0x685f70, ambSky: [0.08, 0.075, 0.085], ambGround: [0.06, 0.055, 0.065] },
};
for (const s of Object.values(SKIES)) {
  const f = toLin(s.fog);
  s.horizon = scale(f, 1.2);
  s.zenith = scale(f, 0.75);
}
// What the air carries: [per second, pool, colour, size, fall speed, life].
const AIR = {
  [NETHER_BIOME.SOUL_SAND_VALLEY]: [6, "smoke", { r: 0.75, g: 0.78, b: 0.8 }, 0.05, -0.15, 5],
  [NETHER_BIOME.CRIMSON_FOREST]: [9, "glow", { r: 1.4, g: 0.12, b: 0.1 }, 0.045, -0.08, 5],
  [NETHER_BIOME.WARPED_FOREST]: [9, "glow", { r: 0.2, g: 0.9, b: 1.2 }, 0.045, 0.06, 5],
  [NETHER_BIOME.BASALT_DELTAS]: [16, "smoke", { r: 0.92, g: 0.92, b: 0.94 }, 0.06, -0.3, 4.5],
};
const FIELDS = ["zenith", "horizon", "ambSky", "ambGround"];

export class NetherAtmosphere {
  constructor(game, dims) {
    this.game = game;
    this.dims = dims;
    this.biome = -1;
    this._key = "";
    this._acc = 0;
    this.enabled = true; // (tests may turn the particles off)
    dims?.onChange?.push(() => this.reset());
  }

  update(dt) {
    const d = this.dims;
    if (!d?.enabled || d.dim !== NETHER) {
      this._key = "";
      return;
    }
    const p = this.game.player.position;
    const key = `${Math.floor(p.x)},${Math.floor(p.z)}`;
    const terrain = this.game.world.terrain;
    if (key !== this._key && terrain?.biomeAt) {
      this._key = key;
      this.biome = terrain.biomeAt(Math.floor(p.x), Math.floor(p.z));
    }
    const want = SKIES[this.biome] || SKIES[NETHER_BIOME.WASTES];
    const sky = DIMS[NETHER].sky;
    // (a jump on arrival, a blend while walking: vanilla's fog follows the biome over a few seconds)
    const k = this._fresh ? 1 - Math.exp(-dt * 1.2) : 1;
    this._fresh = true;
    for (const f of FIELDS) for (let i = 0; i < 3; i++) sky[f][i] += (want[f][i] - sky[f][i]) * k;
    this._particles(dt, p);
  }

  _particles(dt, p) {
    const a = AIR[this.biome];
    const fx = this.game.effects;
    if (!a || !this.enabled || !fx) return;
    const [rate, poolName, color, size, fall, life] = a;
    const pool = fx[poolName];
    if (!pool) return;
    this._acc += dt * rate;
    let n = 0;
    while (this._acc >= 1 && n++ < 8) {
      this._acc -= 1;
      pool.spawn({
        x: p.x + (Math.random() - 0.5) * 22,
        y: p.y + 1 + (Math.random() - 0.4) * 10,
        z: p.z + (Math.random() - 0.5) * 22,
        vx: (Math.random() - 0.5) * 0.3,
        vy: fall * (0.6 + Math.random() * 0.8),
        vz: (Math.random() - 0.5) * 0.3,
        life,
        size0: size,
        size1: size * 0.7,
        color0: color,
        alpha: 0.8,
        drag: 0.2,
      });
    }
    if (this._acc > 4) this._acc = 0;
  }

  // (Leaving the Nether: the next arrival jumps to its biome's colours.)
  reset() {
    this._fresh = false;
    this._key = "";
  }
}
