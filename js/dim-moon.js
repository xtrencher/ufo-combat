// The Moon's terrain (Round 15): a dimension's generator (js/dim-registry.js:
// generate(chunk), heightAt(x, z), biomeAt(x, z), structures). Pure (no
// three.js, no DOM): the chunk workers run it too, so a chunk is the same
// everywhere.
//
// - The ground: grey highlands of moon rock under a few blocks of regolith,
//   rolling gently; the maria, wide dark plains of basalt a few blocks
//   lower and smoother (a low-frequency noise picks them).
// - Craters everywhere, on three scales (a jittered grid each: big ones
//   20-46 blocks across the rim with a central peak, middle ones, and small
//   pits): a bowl, a raised rim and the ejecta's apron fading out; the
//   younger (smaller) ones dig into the older. The deepest big craters'
//   floors hold lunar ice (no sun reaches them).
// - Lunar crystal ore in the rock, rare, more often in the walls of the big
//   craters.
// - Things to find: crashed probes (gold plating, solar panel wings, a
//   glowing data core, a gouge in the ground) and the monoliths (a black
//   slab standing in a ring of glyph stones, an alien relic at its foot).
//   One of each is always near the landing zone (around 0, 0, kept free of
//   big craters: js/space.js lands there).
import { BLOCK } from "./content/base.js";
import { OBSIDIAN } from "./content/ids.js";
import { MOON_REGOLITH, MOON_ROCK, MARE_BASALT, LUNAR_CRYSTAL_ORE, LUNAR_ICE, ALIEN_GLYPH, ALIEN_RELIC, PROBE_PLATING, SOLAR_PANEL, PROBE_CORE, MOONSTONE_BRICKS } from "./content/space.js";
import { Noise, hash2 } from "./noise.js";
import { CHUNK_SIZE, WORLD_HEIGHT } from "./constants.js";

const S = CHUNK_SIZE;
const BASE = 72; // the highlands' mean height (above the Overworld's sea level: no water's mist over it)
// Crater scales: grid cell, chance a cell has one, rim radius range.
const SCALES = [
  { cell: 176, chance: 0.6, r0: 20, r1: 46, salt: 0x51 },
  { cell: 56, chance: 0.55, r0: 6, r1: 15, salt: 0x52 },
  { cell: 18, chance: 0.4, r0: 1.6, r1: 4.5, salt: 0x53 },
];
export const MOON_LANDING = { x: 0, z: 0, r: 70 }; // (js/space.js: where a rocket comes down)
const PROBE_CELL = 192;
const MONOLITH_CELL = 640;
const HOME_SITES = [[PROBE_CELL, "probe", 0.55, 14], [MONOLITH_CELL, "monolith", 0.6, 10]]; // (the kinds of site: grid cell, chance, reach)
const smooth = (a, b, v) => {
  const t = Math.max(0, Math.min(1, (v - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

export class MoonGenerator {
  constructor(seed) {
    this.seed = (seed ^ 0x4d4f4f4e) >>> 0;
    this.noise = new Noise(this.seed);
    this.mare = new Noise((this.seed ^ 0x3a7c11) >>> 0);
    this.detail = new Noise((this.seed ^ 0x9e3779b9) >>> 0);
    this._craters = new Map();
    this._sites = new Map();
    this.structures = {
      // (no chests, spawners or creatures: what there is to find is in the blocks)
      chestAt: () => null,
      spawnerSpots: () => ({ columns: [], cells: [] }),
    };
  }

  // The crater of grid cell (gx, gz) at scale k, or null: { x, z, r, depth, rim, peak }.
  _crater(k, gx, gz) {
    const key = `${k}:${gx},${gz}`;
    let c = this._craters.get(key);
    if (c !== undefined) return c;
    c = null;
    const sc = SCALES[k];
    const s = this.seed ^ sc.salt;
    if (hash2(s, gx, gz) < sc.chance) {
      const x = (gx + 0.15 + hash2(s ^ 0x11, gx, gz) * 0.7) * sc.cell;
      const z = (gz + 0.15 + hash2(s ^ 0x22, gx, gz) * 0.7) * sc.cell;
      // (sizes as a power law: many small, few big)
      const u = hash2(s ^ 0x33, gx, gz);
      const r = sc.r0 + (sc.r1 - sc.r0) * u * u;
      // (the landing zone keeps clear of the big ones, and the middle ones' rims)
      const dl = Math.hypot(x - MOON_LANDING.x, z - MOON_LANDING.z);
      if (!(k < 2 && dl < MOON_LANDING.r + r * (k === 0 ? 1.6 : 1.1))) {
        const depth = Math.min(k === 0 ? 17 : 9, r * (k === 2 ? 0.45 : 0.34));
        c = { x, z, r, depth, rim: r * (k === 2 ? 0.12 : 0.085), peak: k === 0 && r > 30, icy: k === 0 && hash2(s ^ 0x44, gx, gz) < 0.35 };
      }
    }
    if (this._craters.size > 6000) this._craters.clear();
    this._craters.set(key, c);
    return c;
  }

  // Height and ground kind of column (x, z): { h, mare (0-1), wall (0-1, a big crater's wall), ice }.
  column(x, z, out = {}) {
    const n = this.noise.fbm2(x, z, 4, 0.5, 2, 1 / 160);
    const d = this.detail.fbm2(x, z, 2, 0.5, 2, 1 / 23);
    const m = smooth(0.05, 0.22, this.mare.fbm2(x, z, 3, 0.5, 2, 1 / 520));
    // (the highlands roll; the maria lie lower, smoother)
    let h = BASE + n * 9 + d * 1.6;
    h = h * (1 - m) + (BASE - 6 + n * 2 + d * 0.5) * m;
    let wall = 0;
    let ice = false;
    for (let k = 0; k < SCALES.length; k++) {
      const cell = SCALES[k].cell;
      const gx = Math.floor(x / cell);
      const gz = Math.floor(z / cell);
      for (let dz = -1; dz <= 1; dz++) {
        for (let dx = -1; dx <= 1; dx++) {
          const c = this._crater(k, gx + dx, gz + dz);
          if (!c) continue;
          const ex = x - c.x;
          const ez = z - c.z;
          const reach = c.r * 2.3;
          if (ex > reach || ex < -reach || ez > reach || ez < -reach) continue;
          // (a slightly lumpy rim)
          const t = Math.hypot(ex, ez) / (c.r * (1 + d * 0.06));
          if (t >= 2.3) continue;
          if (t < 1) {
            // The bowl, its floor flattened in the big ones, and the rim; a
            // young crater digs into whatever was there.
            const bowl = c.depth * (Math.min(1, t * t * (k === 0 ? 1.25 : 1)) - 1) + c.rim * t ** 6;
            let dh = bowl;
            if (c.peak && t < 0.22) dh += c.depth * 0.55 * (1 - t / 0.22);
            h += dh;
            if (k === 0 && t > 0.55) wall = Math.max(wall, (t - 0.55) / 0.45);
            if (c.icy && t < 0.5) ice = true;
          } else {
            h += c.rim * Math.exp(-(t - 1) * 3.2);
          }
        }
      }
    }
    out.h = Math.max(6, Math.min(WORLD_HEIGHT - 8, Math.round(h)));
    out.mare = m;
    out.wall = wall;
    out.ice = ice;
    return out;
  }

  heightAt(x, z) {
    return this.column(x, z).h;
  }

  biomeAt() {
    return -1;
  }

  generate(chunk) {
    const blocks = chunk.blocks;
    const bx = chunk.cx * S;
    const bz = chunk.cz * S;
    const col = {};
    for (let z = 0; z < S; z++) {
      for (let x = 0; x < S; x++) {
        const wx = bx + x;
        const wz = bz + z;
        this.column(wx, wz, col);
        const top = col.h;
        const i0 = (z << 4) | x;
        blocks[i0] = BLOCK.BEDROCK;
        const dust = col.mare > 0.5 ? 1 : 2 + (hash2(this.seed, wx, wz) < 0.5 ? 1 : 0);
        const basaltTo = col.mare > 0.5 ? top - dust : -1;
        const basaltFrom = top - 6 - Math.floor(col.mare * 6);
        for (let y = 1; y <= top; y++) {
          let id;
          if (y > top - dust) id = MOON_REGOLITH;
          else if (y <= basaltTo && y > basaltFrom) id = MARE_BASALT;
          else id = MOON_ROCK;
          if (id === MOON_ROCK && y < top - 2) {
            // (crystal ore: rare, more often in the big craters' walls)
            const p = hash2(this.seed ^ 0x6f, wx * 131 + y, wz);
            if (p < 0.0016 + col.wall * 0.006) id = LUNAR_CRYSTAL_ORE;
          }
          blocks[(y << 8) | i0] = id;
        }
        if (col.ice) blocks[(top << 8) | i0] = LUNAR_ICE;
      }
    }
    this._stamp(blocks, bx, bz);
  }

  // ---------- Things to find ----------

  // The sites near chunk (bx, bz): probes and monoliths, each a list of cells.
  _sitesNear(bx, bz) {
    const out = [];
    for (const [cell, kind, chance, span] of HOME_SITES) {
      const g0x = Math.floor((bx - span) / cell);
      const g1x = Math.floor((bx + S + span) / cell);
      const g0z = Math.floor((bz - span) / cell);
      const g1z = Math.floor((bz + S + span) / cell);
      for (let gz = g0z; gz <= g1z; gz++) {
        for (let gx = g0x; gx <= g1x; gx++) {
          const site = this._site(kind, cell, chance, gx, gz);
          if (site && site.x + span >= bx && site.x - span < bx + S && site.z + span >= bz && site.z - span < bz + S) out.push(site);
        }
      }
    }
    // (the home cell's site, near the landing zone, may lie outside its own cell's square)
    for (const [cell, kind, chance, span] of HOME_SITES) {
      const site = this._site(kind, cell, chance, 0, 0);
      if (site && !out.includes(site) && site.x + span >= bx && site.x - span < bx + S && site.z + span >= bz && site.z - span < bz + S) out.push(site);
    }
    return out;
  }

  _site(kind, cell, chance, gx, gz) {
    const key = `${kind}:${gx},${gz}`;
    let site = this._sites.get(key);
    if (site !== undefined) return site;
    site = null;
    const s = this.seed ^ (kind === "probe" ? 0x7072 : 0x6d6f);
    // (one of each always near the landing zone: in the grid cell around it)
    const home = gx === 0 && gz === 0;
    if (home || hash2(s, gx, gz) < chance) {
      let x;
      let z;
      if (home) {
        x = kind === "probe" ? 46 : -84;
        z = kind === "probe" ? 31 : 118;
      } else {
        x = Math.floor((gx + 0.2 + hash2(s ^ 1, gx, gz) * 0.6) * cell);
        z = Math.floor((gz + 0.2 + hash2(s ^ 2, gx, gz) * 0.6) * cell);
      }
      const yaw = Math.floor(hash2(s ^ 3, gx, gz) * 4);
      site = { kind, x, z, yaw, cells: kind === "probe" ? this._probe(x, z, yaw) : this._monolith(x, z, yaw) };
    }
    if (this._sites.size > 2000) this._sites.clear();
    this._sites.set(key, site);
    return site;
  }

  // A crashed probe: its body (plating, the core showing at a torn side),
  // one solar wing bent into the ground and the other still out, a gouge it
  // dug coming down (regolith thrown up along it).
  _probe(x, z, yaw) {
    const cells = [];
    const g = this.column(x, z).h;
    const dir = [[1, 0], [0, 1], [-1, 0], [0, -1]][yaw];
    const side = [-dir[1], dir[0]];
    const at = (f, s, y, id) => cells.push(x + dir[0] * f + side[0] * s, y, z + dir[1] * f + side[1] * s, id);
    // the gouge behind it
    for (let f = -12; f < -1; f++) {
      for (let s = -1; s <= 1; s++) {
        const cx = x + dir[0] * f + side[0] * s;
        const cz = z + dir[1] * f + side[1] * s;
        const h = this.column(cx, cz).h;
        const dig = s === 0 ? 2 : 1;
        for (let k = 0; k < dig; k++) cells.push(cx, h - k, cz, BLOCK.AIR);
        if (Math.abs(s) === 1 && (f & 1)) cells.push(cx + side[0] * s, this.column(cx + side[0] * s, cz + side[1] * s).h + 1, cz + side[1] * s, MOON_REGOLITH);
      }
    }
    // the body: 3 x 3 x 3, sunk a block, the core in the torn front
    for (let f = -1; f <= 1; f++) for (let s = -1; s <= 1; s++) for (let y = 0; y < 3; y++) at(f, s, g + y, y === 2 && f === 1 && s === 1 ? BLOCK.AIR : PROBE_PLATING);
    at(1, 0, g + 1, PROBE_CORE);
    at(2, 0, g + 1, BLOCK.AIR);
    // the dish's mast
    at(0, 0, g + 3, PROBE_PLATING);
    at(0, 0, g + 4, PROBE_PLATING);
    // the wings: one out level, one broken and leaning into the dust
    for (let s = 2; s <= 6; s++) at(0, s, g + 1, SOLAR_PANEL);
    for (let s = 2; s <= 5; s++) at(0, -s, g + 1 - Math.floor((s - 2) / 2), SOLAR_PANEL);
    return cells;
  }

  // A monolith: a black slab 1 x 4 x 9 on a low platform of moonstone
  // bricks ringed by glyph stones, the relic at its foot.
  _monolith(x, z, yaw) {
    const cells = [];
    const g = this.column(x, z).h;
    for (let dz = -5; dz <= 5; dz++) {
      for (let dx = -5; dx <= 5; dx++) {
        const r = Math.hypot(dx, dz);
        if (r > 5.4) continue;
        const h = this.column(x + dx, z + dz).h;
        // (levelled: filled up to the platform, cleared above it)
        for (let y = Math.min(h, g) + 1; y <= g; y++) cells.push(x + dx, y, z + dz, MOON_ROCK);
        for (let y = g + 1; y <= Math.max(h, g + 1) + 1; y++) cells.push(x + dx, y, z + dz, BLOCK.AIR);
        cells.push(x + dx, g, z + dz, r > 4.4 && (Math.round(Math.atan2(dz, dx) * 4) & 1) === 0 ? ALIEN_GLYPH : MOONSTONE_BRICKS);
      }
    }
    const along = yaw & 1;
    for (let w = -2; w <= 1; w++) for (let y = 1; y <= 9; y++) cells.push(x + (along ? 0 : w), g + y, z + (along ? w : 0), OBSIDIAN);
    cells.push(x + (along ? 2 : 0), g + 1, z + (along ? 0 : 2), ALIEN_RELIC);
    return cells;
  }

  _stamp(blocks, bx, bz) {
    for (const site of this._sitesNear(bx, bz)) {
      const c = site.cells;
      for (let i = 0; i < c.length; i += 4) {
        const x = c[i] - bx;
        const z = c[i + 2] - bz;
        const y = c[i + 1];
        if (x < 0 || x >= S || z < 0 || z >= S || y < 1 || y >= WORLD_HEIGHT) continue;
        blocks[(y << 8) | (z << 4) | x] = c[i + 3];
      }
    }
  }
}
