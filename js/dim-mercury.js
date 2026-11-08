// Mercury's terrain (Round 17): a dimension's generator (js/dim-registry.js:
// generate(chunk), heightAt(x, z), biomeAt(x, z), lodColumn(x, z, out),
// structures). Pure (no three.js, no DOM): the chunk workers and the far
// terrain's builders (js/lod-mesher.js) run it too.
//
// - The ground: grey-brown, under a few blocks of regolith; the old
//   intercrater highlands roll, the smooth plains (old lava, darker) lie
//   lower and flatter, with fewer craters (they are younger).
// - Craters everywhere, on four scales, more of them than on the Moon (a
//   jittered grid each): great basins 50-110 blocks across the rim with a
//   ring of peaks, big ones with a central peak, middle ones, small pits;
//   bowl, raised rim, ejecta apron. The big ones' floors have the bright
//   bluish "hollows" crumbling out of them.
// - Lobate scarps: long curved cliffs where the crust was pushed up as the
//   planet shrank: a steep face 6-16 blocks high, a long gentle back.
// - Iron (hematite ore, raw iron) in the rock, rare.
// - A crashed probe near the landing zone (around 0, 0, kept free of big
//   craters and scarps: js/solar.js brings a ship down anywhere, but this is
//   where a save from space comes back to).
import { BLOCK } from "./content/base.js";
import { MERCURY_REGOLITH, MERCURY_ROCK, MERCURY_PLAINS, MERCURY_HOLLOWS, HEMATITE_ORE, PROBE_PLATING, SOLAR_PANEL, PROBE_CORE } from "./content/space.js";
import { Noise, hash2 } from "./noise.js";
import { CHUNK_SIZE, WORLD_HEIGHT } from "./constants.js";

const S = CHUNK_SIZE;
const BASE = 74;
// Crater scales: grid cell, chance a cell has one, rim radius range.
const SCALES = [
  { cell: 420, chance: 0.5, r0: 50, r1: 110, salt: 0x61 },
  { cell: 170, chance: 0.7, r0: 16, r1: 42, salt: 0x62 },
  { cell: 52, chance: 0.68, r0: 5, r1: 14, salt: 0x63 },
  { cell: 17, chance: 0.5, r0: 1.5, r1: 4.5, salt: 0x64 },
];
const SCARP_CELL = 360;
export const MERCURY_LANDING = { x: 0, z: 0, r: 60 };
const smooth = (a, b, v) => {
  const t = Math.max(0, Math.min(1, (v - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

export class MercuryGenerator {
  constructor(seed) {
    this.seed = (seed ^ 0x4d455243) >>> 0;
    this.noise = new Noise(this.seed);
    this.plain = new Noise((this.seed ^ 0x5a17c3) >>> 0);
    this.detail = new Noise((this.seed ^ 0x2545f491) >>> 0);
    this.hollow = new Noise((this.seed ^ 0x7f4a7c15) >>> 0);
    this._craters = new Map();
    this._scarps = new Map();
    this._probe = null;
    this.structures = {
      chestAt: () => null,
      spawnerSpots: () => ({ columns: [], cells: [] }),
    };
  }

  // 0-1: how much of the smooth (younger, darker) plains is at (x, z).
  _plains(x, z) {
    return smooth(0.08, 0.24, this.plain.fbm2(x, z, 3, 0.5, 2, 1 / 700));
  }

  // The crater of grid cell (gx, gz) at scale k, or null.
  _crater(k, gx, gz) {
    const key = `${k}:${gx},${gz}`;
    let c = this._craters.get(key);
    if (c !== undefined) return c;
    c = null;
    const sc = SCALES[k];
    const s = this.seed ^ sc.salt;
    const x = (gx + 0.15 + hash2(s ^ 0x11, gx, gz) * 0.7) * sc.cell;
    const z = (gz + 0.15 + hash2(s ^ 0x22, gx, gz) * 0.7) * sc.cell;
    // (the plains are younger: fewer craters on them)
    const chance = sc.chance * (1 - 0.55 * this._plains(x, z));
    if (hash2(s, gx, gz) < chance) {
      const u = hash2(s ^ 0x33, gx, gz);
      const r = sc.r0 + (sc.r1 - sc.r0) * u * u;
      const dl = Math.hypot(x - MERCURY_LANDING.x, z - MERCURY_LANDING.z);
      if (!(k < 3 && dl < MERCURY_LANDING.r + r * (k < 2 ? 1.6 : 1.1))) {
        const depth = Math.min([24, 17, 9, 3][k], r * (k === 3 ? 0.45 : k === 0 ? 0.2 : 0.32));
        c = { x, z, r, k, depth, rim: r * (k === 3 ? 0.12 : k === 0 ? 0.05 : 0.085), peak: k === 1 && r > 26, ring: k === 0, hollows: k < 2 && hash2(s ^ 0x44, gx, gz) < 0.6 };
      }
    }
    if (this._craters.size > 8000) this._craters.clear();
    this._craters.set(key, c);
    return c;
  }

  // The scarp of grid cell (gx, gz), or null: a curved fault line.
  _scarp(gx, gz) {
    const key = `${gx},${gz}`;
    let sc = this._scarps.get(key);
    if (sc !== undefined) return sc;
    sc = null;
    const s = this.seed ^ 0x5c;
    if (hash2(s, gx, gz) < 0.55) {
      const x = (gx + 0.2 + hash2(s ^ 1, gx, gz) * 0.6) * SCARP_CELL;
      const z = (gz + 0.2 + hash2(s ^ 2, gx, gz) * 0.6) * SCARP_CELL;
      const a = hash2(s ^ 3, gx, gz) * Math.PI;
      const L = 220 + hash2(s ^ 4, gx, gz) * 300;
      const H = 6 + hash2(s ^ 5, gx, gz) * 10;
      const bend = (hash2(s ^ 6, gx, gz) - 0.5) * 70;
      const side = hash2(s ^ 7, gx, gz) < 0.5 ? 1 : -1;
      // (not across the landing zone)
      if (Math.hypot(x, z) > MERCURY_LANDING.r + L * 0.6) sc = { x, z, ca: Math.cos(a), sa: Math.sin(a), L, H, bend, side };
    }
    if (this._scarps.size > 2000) this._scarps.clear();
    this._scarps.set(key, sc);
    return sc;
  }

  // The scarps' uplift at (x, z) (blocks), and whether this is the cliff's face.
  _scarpLift(x, z, out) {
    let lift = 0;
    let face = 0;
    const gx = Math.floor(x / SCARP_CELL);
    const gz = Math.floor(z / SCARP_CELL);
    for (let dz = -1; dz <= 1; dz++) {
      for (let dx = -1; dx <= 1; dx++) {
        const sc = this._scarp(gx + dx, gz + dz);
        if (!sc) continue;
        const ex = x - sc.x;
        const ez = z - sc.z;
        const u = ex * sc.ca + ez * sc.sa; // along
        const half = sc.L / 2;
        if (u < -half - 10 || u > half + 10) continue;
        // (curved, and lobed along its front)
        let v = (-ex * sc.sa + ez * sc.ca) * sc.side;
        v -= sc.bend * (1 - (u / half) ** 2) + Math.sin(u / 23) * 3.5 + Math.sin(u / 7.3) * 1.2;
        if (v < -6 || v > 110) continue;
        const taper = 1 - smooth(half * 0.55, half, Math.abs(u));
        if (taper <= 0) continue;
        // the steep face (over about four blocks), then the long back slope
        const prof = v < 0 ? smooth(-4.5, 0, v) : 1 - smooth(4, 105, v) * 0.95;
        const l = sc.H * taper * prof;
        if (l > lift) {
          lift = l;
          face = v < 0.5 && v > -4.5 ? 1 : 0;
        }
      }
    }
    out.face = face;
    return lift;
  }

  // Height and ground kind of column (x, z): { h, plains (0-1), hollows, face }.
  column(x, z, out = {}) {
    const n = this.noise.fbm2(x, z, 4, 0.5, 2, 1 / 210);
    const d = this.detail.fbm2(x, z, 2, 0.5, 2, 1 / 21);
    const m = this._plains(x, z);
    let h = BASE + n * 10 + d * 1.5;
    h = h * (1 - m) + (BASE - 7 + n * 2.5 + d * 0.4) * m;
    let hollows = false;
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
          const reach = c.r * 2.4;
          if (ex > reach || ex < -reach || ez > reach || ez < -reach) continue;
          const t = Math.hypot(ex, ez) / (c.r * (1 + d * 0.06));
          if (t >= 2.4) continue;
          if (t < 1) {
            // the bowl (flat-floored in the big ones), the rim; a young crater digs into the old
            const flat = k === 0 ? 1.6 : k === 1 ? 1.25 : 1;
            let dh = c.depth * (Math.min(1, t * t * flat) - 1) + c.rim * t ** 6;
            if (c.peak && t < 0.2) dh += c.depth * 0.6 * (1 - t / 0.2);
            if (c.ring) dh += c.depth * 0.5 * Math.exp(-(((t - 0.45) / 0.07) ** 2)) * (0.6 + 0.4 * Math.sin(Math.atan2(ez, ex) * 9 + d * 2));
            h += dh;
            if (c.hollows && t < 0.6 && this.hollow.fbm2(x, z, 2, 0.5, 2, 1 / 9) > 0.18) hollows = true;
          } else {
            h += c.rim * Math.exp(-(t - 1) * 3);
          }
        }
      }
    }
    h += this._scarpLift(x, z, out);
    out.h = Math.max(6, Math.min(WORLD_HEIGHT - 8, Math.round(h)));
    out.plains = m;
    out.hollows = hollows;
    return out;
  }

  heightAt(x, z) {
    return this.column(x, z).h;
  }

  biomeAt() {
    return -1;
  }

  // (The far terrain, js/lod-mesher.js) the top face's height and block of column (x, z).
  lodColumn(x, z, out) {
    const c = this.column(x, z, _col);
    out.top = c.h + 1;
    out.id = c.hollows ? MERCURY_HOLLOWS : c.face ? MERCURY_ROCK : MERCURY_REGOLITH;
    out.depth = 0;
    return out;
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
        // (a scarp's face: bare rock; the plains: a thin dust over their basalt)
        const dust = col.face ? 0 : col.plains > 0.5 ? 1 : 2 + (hash2(this.seed, wx, wz) < 0.5 ? 1 : 0);
        const plainsFrom = col.plains > 0.5 ? top - 5 - Math.floor(col.plains * 5) : WORLD_HEIGHT;
        for (let y = 1; y <= top; y++) {
          let id;
          if (y > top - dust) id = MERCURY_REGOLITH;
          else if (y > plainsFrom) id = MERCURY_PLAINS;
          else id = MERCURY_ROCK;
          if (id === MERCURY_ROCK && y < top - 2 && hash2(this.seed ^ 0x6f, wx * 131 + y, wz) < 0.0018) id = HEMATITE_ORE;
          blocks[(y << 8) | i0] = id;
        }
        if (col.hollows) {
          blocks[(top << 8) | i0] = MERCURY_HOLLOWS;
          if (top > 1) blocks[((top - 1) << 8) | i0] = MERCURY_HOLLOWS;
        }
      }
    }
    this._stamp(blocks, bx, bz);
  }

  // ---------- The probe near the landing zone ----------

  // A probe that came down long ago: its plated body half buried, a sun
  // shade bent over it, one panel wing, the core still glowing.
  _probeCells() {
    if (this._probe) return this._probe;
    const cells = [];
    const x = 38;
    const z = -27;
    const g = this.column(x, z).h;
    for (let dz = -1; dz <= 1; dz++) for (let dx = -2; dx <= 2; dx++) for (let y = 0; y < 2; y++) cells.push(x + dx, g + y, z + dz, PROBE_PLATING);
    cells.push(x, g + 1, z + 1, PROBE_CORE);
    cells.push(x, g + 1, z + 2, BLOCK.AIR);
    // (the sun shade: a curved plate over the top)
    for (let dz = -2; dz <= 2; dz++) cells.push(x - 3, g + 2 + (Math.abs(dz) < 2 ? 1 : 0), z + dz, PROBE_PLATING);
    for (let dx = 3; dx <= 7; dx++) cells.push(x + dx, g + 1 - (dx > 5 ? 1 : 0), z, SOLAR_PANEL);
    for (let dx = -10; dx < -3; dx++) cells.push(x + dx, this.column(x + dx, z).h, z, BLOCK.AIR);
    this._probe = cells;
    return cells;
  }

  _stamp(blocks, bx, bz) {
    if (bx + S < 20 || bx > 60 || bz + S < -45 || bz > -15) return;
    const c = this._probeCells();
    for (let i = 0; i < c.length; i += 4) {
      const x = c[i] - bx;
      const z = c[i + 2] - bz;
      const y = c[i + 1];
      if (x < 0 || x >= S || z < 0 || z >= S || y < 1 || y >= WORLD_HEIGHT) continue;
      blocks[(y << 8) | (z << 4) | x] = c[i + 3];
    }
  }
}

const _col = {};
