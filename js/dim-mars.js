// Mars' terrain (Round 15): a dimension's generator (js/dim-registry.js:
// generate(chunk), heightAt(x, z), biomeAt(x, z), structures). Pure (no
// three.js, no DOM): the chunk workers run it too.
//
// - The plains: rusty regolith over martian rock, rolling, strewn with
//   small eroded craters.
// - The canyons (a Valles Marineris of its own): one great canyon winding
//   east-west a little north of the landing zone (it is always in sight
//   from there), and a network of side canyons (a ridged noise, warped);
//   their floors 30-40 blocks down, sandy, their walls stepped in terraces
//   of layered rock.
// - Mesas and buttes standing out of the plains, flat-topped, terraced.
// - Dune fields: martian sand in long ripples (it falls, as sand).
// - A shield volcano (one in each 1536-block square, the nearest a few
//   hundred blocks from the landing zone): a wide gentle cone up to near the
//   top of the world, a caldera at its summit, frost on its upper slopes.
// - Hematite ore in the rock ("blueberries": raw iron); polar ice on high
//   ground and in some crater floors.
// - Things to find: the alien ruins (a stepped pyramid of alien bricks, its
//   glyph bands lit, the relic in a chamber at its heart) and crashed
//   probes. One of each is near the landing zone (around 0, 0: js/space.js).
import { BLOCK } from "./content/base.js";
import { MARS_SAND, MARS_REGOLITH, MARS_ROCK, MARS_STRATA, MARS_ICE, HEMATITE_ORE, ALIEN_BRICKS, ALIEN_GLYPH, ALIEN_RELIC, PROBE_PLATING, SOLAR_PANEL, PROBE_CORE } from "./content/space.js";
import { Noise, hash2 } from "./noise.js";
import { CHUNK_SIZE, WORLD_HEIGHT } from "./constants.js";

const S = CHUNK_SIZE;
const PLAIN = 72; // (above the Overworld's sea level: the morning mist stays in the canyons)
const FLOOR = 34; // the canyons' floor
export const MARS_LANDING = { x: 0, z: 0, r: 40 };
const VOLCANO_CELL = 1536;
const CRATER_CELL = 72;
const RUIN_CELL = 448;
const PROBE_CELL = 224;
const HOME_SITES = [[RUIN_CELL, "ruin", 0.55, 14], [PROBE_CELL, "probe", 0.5, 12]]; // (the kinds of site: grid cell, chance, reach)
const smooth = (a, b, v) => {
  const t = Math.max(0, Math.min(1, (v - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

export class MarsGenerator {
  constructor(seed) {
    this.seed = (seed ^ 0x4d415253) >>> 0;
    this.noise = new Noise(this.seed);
    this.warp = new Noise((this.seed ^ 0x51ed27) >>> 0);
    this.canyon = new Noise((this.seed ^ 0x2b7e15) >>> 0);
    this.mesa = new Noise((this.seed ^ 0x1f83d9) >>> 0);
    this.dunes = new Noise((this.seed ^ 0x5be0cd) >>> 0);
    this.detail = new Noise((this.seed ^ 0x6a09e6) >>> 0);
    this._cache = new Map();
    this.structures = {
      chestAt: () => null,
      spawnerSpots: () => ({ columns: [], cells: [] }),
    };
  }

  _cached(key, fn) {
    let v = this._cache.get(key);
    if (v !== undefined) return v;
    v = fn();
    if (this._cache.size > 4000) this._cache.clear();
    this._cache.set(key, v);
    return v;
  }

  // The volcano of grid cell (gx, gz): { x, z, R, top }.
  _volcano(gx, gz) {
    return this._cached(`v${gx},${gz}`, () => {
      const s = this.seed ^ 0x766f;
      let x = (gx + 0.25 + hash2(s, gx, gz) * 0.5) * VOLCANO_CELL;
      let z = (gz + 0.25 + hash2(s ^ 1, gx, gz) * 0.5) * VOLCANO_CELL;
      // (the home one in sight of the landing zone, across the great canyon)
      if (gx === 0 && gz === 0) {
        x = 330;
        z = 420;
      }
      return { x, z, R: 210 + hash2(s ^ 2, gx, gz) * 60, top: 118 };
    });
  }

  _crater(gx, gz) {
    return this._cached(`c${gx},${gz}`, () => {
      const s = this.seed ^ 0x6372;
      if (hash2(s, gx, gz) > 0.45) return null;
      const x = (gx + 0.2 + hash2(s ^ 1, gx, gz) * 0.6) * CRATER_CELL;
      const z = (gz + 0.2 + hash2(s ^ 2, gx, gz) * 0.6) * CRATER_CELL;
      const u = hash2(s ^ 3, gx, gz);
      const r = 5 + u * u * 22;
      if (Math.hypot(x - MARS_LANDING.x, z - MARS_LANDING.z) < MARS_LANDING.r + r) return null;
      return { x, z, r, depth: Math.min(10, r * 0.3), icy: hash2(s ^ 4, gx, gz) < 0.2 };
    });
  }

  // The great canyon's middle line's z at x, and its half width.
  _main(x) {
    const z = 150 + Math.sin(x / 260) * 70 + Math.sin(x / 97 + 1.3) * 22 + this.warp.fbm2(x, 0, 2, 0.5, 2, 1 / 300) * 60;
    const w = 34 + Math.sin(x / 180 + 0.4) * 12 + this.warp.fbm2(x, 50, 2, 0.5, 2, 1 / 140) * 10;
    return [z, w];
  }

  // Column (x, z): { h, kind: "plain" | "canyon" | "mesa" | "dune" | "volcano", wallFrom (strata above this y), sand, ice }.
  column(x, z, out = {}) {
    const n = this.noise.fbm2(x, z, 4, 0.5, 2, 1 / 190);
    const d = this.detail.fbm2(x, z, 2, 0.5, 2, 1 / 17);
    let h = PLAIN + n * 7 + d * 1.2;
    let kind = "plain";
    let sand = false;
    let ice = false;
    // Mesas: plateaus with terraced sides.
    const mv = this.mesa.fbm2(x, z, 3, 0.5, 2, 1 / 130);
    const mk = smooth(0.32, 0.4, mv) * smooth(MARS_LANDING.r + 30, MARS_LANDING.r + 90, Math.hypot(x, z));
    if (mk > 0) {
      const top = PLAIN + 16 + Math.floor(mv * 14);
      h += (top - h) * mk;
      if (mk > 0.02 && mk < 0.98) h = Math.floor(h / 3) * 3 + 1;
      if (mk > 0.98) kind = "mesa";
      else kind = "wall";
    }
    // Dunes: long ripples across the sand fields.
    const dv = this.dunes.fbm2(x, z, 2, 0.5, 2, 1 / 260);
    const dk = smooth(0.08, 0.25, dv) * (1 - mk);
    if (dk > 0) {
      const ph = x * 0.11 + z * 0.045 + this.dunes.fbm2(x, z, 2, 0.5, 2, 1 / 45) * 4;
      const saw = ph - Math.floor(ph);
      const ridge = saw < 0.7 ? saw / 0.7 : (1 - saw) / 0.3; // (the gentle windward side, the steep lee)
      h += dk * (ridge * 5 - 1);
      if (dk > 0.3) {
        kind = "dune";
        sand = true;
      }
    }
    // Craters, eroded.
    const gx = Math.floor(x / CRATER_CELL);
    const gz = Math.floor(z / CRATER_CELL);
    for (let dz = -1; dz <= 1; dz++) {
      for (let dx = -1; dx <= 1; dx++) {
        const c = this._crater(gx + dx, gz + dz);
        if (!c) continue;
        const t = Math.hypot(x - c.x, z - c.z) / c.r;
        if (t >= 2) continue;
        if (t < 1) {
          h += c.depth * (t * t - 1) + c.depth * 0.25 * t ** 6;
          if (t < 0.6) sand = true;
          if (c.icy && t < 0.45) ice = true;
        } else h += c.depth * 0.25 * Math.exp(-(t - 1) * 3);
      }
    }
    // The volcano.
    const vx = Math.floor(x / VOLCANO_CELL);
    const vz = Math.floor(z / VOLCANO_CELL);
    let vk = 0;
    for (let dz = -1; dz <= 1 && !vk; dz++) {
      for (let dx = -1; dx <= 1 && !vk; dx++) {
        const v = this._volcano(vx + dx, vz + dz);
        const t = Math.hypot(x - v.x, z - v.z) / v.R;
        if (t >= 1) continue;
        vk = 1;
        const cone = PLAIN + (v.top - PLAIN) * Math.pow(1 - t, 1.7) + d * 1.5 * (1 - t);
        let vh = cone;
        // (the caldera: a sunken pit at the summit, cliffs around)
        if (t < 0.07) vh = v.top - 14 + (t / 0.07) * 4;
        else if (t < 0.09) vh = v.top - 10 + ((t - 0.07) / 0.02) * 12;
        h = Math.max(h, vh);
        kind = "volcano";
        sand = false;
        if (vh > 100) ice = true;
      }
    }
    // The canyons: the great one and the side network, cut into all of it.
    const [mz, mw] = this._main(x);
    const cm = 1 - smooth(mw * 0.55, mw, Math.abs(z - mz));
    const wx = x + this.warp.fbm2(x, z, 2, 0.5, 2, 1 / 160) * 70;
    const wz = z + this.warp.fbm2(z, x, 2, 0.5, 2, 1 / 160) * 70;
    const ridge = 1 - Math.abs(this.canyon.fbm2(wx, wz, 3, 0.5, 2, 1 / 420));
    const cn = smooth(0.9, 0.965, ridge) * smooth(MARS_LANDING.r, MARS_LANDING.r + 60, Math.hypot(x, z));
    const ck = Math.max(cm, cn);
    let wallFrom = WORLD_HEIGHT;
    if (ck > 0) {
      const floor = FLOOR + this.detail.fbm2(x, z, 2, 0.5, 2, 1 / 60) * 3;
      // (terraced walls: the cut steps down in ledges of three)
      let cut = floor + (h - floor) * (1 - ck);
      if (ck < 0.97) cut = Math.floor(cut / 3) * 3 + (d > 0.2 ? 1 : 0);
      if (cut < h) {
        h = cut;
        wallFrom = Math.max(1, Math.floor(floor) - 2);
        kind = ck > 0.97 ? "canyon" : "wall";
        sand = ck > 0.97;
      }
    }
    out.h = Math.max(6, Math.min(WORLD_HEIGHT - 6, Math.round(h)));
    out.kind = kind;
    out.wallFrom = kind === "mesa" || kind === "wall" ? Math.min(wallFrom, PLAIN - 6) : wallFrom;
    out.sand = sand;
    out.ice = ice;
    out.vk = vk;
    return out;
  }

  heightAt(x, z) {
    return this.column(x, z).h;
  }

  biomeAt() {
    return -1;
  }

  // (Round 17: the far terrain, js/lod-mesher.js) the top face's height and block of column (x, z).
  lodColumn(x, z, out) {
    const c = this.column(x, z, _col);
    out.top = c.h + 1;
    out.id = c.ice ? MARS_ICE : c.sand ? MARS_SAND : c.kind === "wall" ? ((c.h >> 2) % 3 === 1 ? MARS_ROCK : MARS_STRATA) : MARS_REGOLITH;
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
        const soil = col.sand ? 3 : col.kind === "wall" ? 0 : 2;
        const surf = col.sand ? MARS_SAND : MARS_REGOLITH;
        for (let y = 1; y <= top; y++) {
          let id;
          if (y > top - soil) id = surf;
          else if (y >= col.wallFrom && y > top - 40) id = (y >> 2) % 3 === 1 ? MARS_ROCK : MARS_STRATA;
          else id = MARS_ROCK;
          if (id === MARS_ROCK && y < top - 2 && hash2(this.seed ^ 0x68, wx * 131 + y, wz) < 0.0022) id = HEMATITE_ORE;
          blocks[(y << 8) | i0] = id;
        }
        if (col.ice) blocks[(top << 8) | i0] = MARS_ICE;
      }
    }
    this._stamp(blocks, bx, bz);
  }

  // ---------- Things to find ----------

  _sitesNear(bx, bz) {
    const out = [];
    for (const [cell, kind, chance, span] of HOME_SITES) {
      for (let gz = Math.floor((bz - span) / cell); gz <= Math.floor((bz + S + span) / cell); gz++) {
        for (let gx = Math.floor((bx - span) / cell); gx <= Math.floor((bx + S + span) / cell); gx++) {
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
    return this._cached(`s${kind}${gx},${gz}`, () => {
      const s = this.seed ^ (kind === "ruin" ? 0x7275 : 0x7072);
      const home = gx === 0 && gz === 0;
      if (!home && hash2(s, gx, gz) >= chance) return null;
      let x = Math.floor((gx + 0.2 + hash2(s ^ 1, gx, gz) * 0.6) * cell);
      let z = Math.floor((gz + 0.2 + hash2(s ^ 2, gx, gz) * 0.6) * cell);
      if (home) {
        x = kind === "ruin" ? -110 : 58;
        z = kind === "ruin" ? -70 : -36;
      }
      // (not down in a canyon: on the ground around it)
      if (this.column(x, z).kind === "canyon" && !home) return null;
      return { x, z, cells: kind === "ruin" ? this._ruin(x, z) : this._probe(x, z, Math.floor(hash2(s ^ 3, gx, gz) * 4)) };
    });
  }

  // The alien ruin: a stepped pyramid 17 across, 7 steps, the glyph bands
  // on every second step lit, a doorway on each side into the chamber at its
  // heart, where the relic stands on a pedestal; half buried in drifted sand.
  _ruin(x, z) {
    const cells = [];
    let g = WORLD_HEIGHT;
    for (let dz = -9; dz <= 9; dz += 3) for (let dx = -9; dx <= 9; dx += 3) g = Math.min(g, this.column(x + dx, z + dz).h);
    g = Math.max(8, g);
    for (let dz = -10; dz <= 10; dz++) {
      for (let dx = -10; dx <= 10; dx++) {
        const h = this.column(x + dx, z + dz).h;
        for (let y = h + 1; y < g; y++) cells.push(x + dx, y, z + dz, MARS_ROCK);
        const ring = Math.max(Math.abs(dx), Math.abs(dz));
        if (ring > 8) continue;
        const steps = 8 - ring; // (height of the step at this ring)
        for (let y = g; y <= g + steps; y++) {
          const inChamber = ring <= 2 && y >= g + 1 && y <= g + 3;
          const door = (dx === 0 || dz === 0) && y >= g + 1 && y <= g + 2 && ring <= 8;
          let id = inChamber || door ? BLOCK.AIR : y === g + steps && steps % 2 === 0 && ring > 2 ? ALIEN_GLYPH : ALIEN_BRICKS;
          cells.push(x + dx, y, z + dz, id);
        }
        // (sand drifted against the west side)
        if (dx < -5 && ring > 6) cells.push(x + dx, g + 1, z + dz, MARS_SAND);
        for (let y = g + steps + 1; y <= Math.max(h, g + steps) + 1; y++) cells.push(x + dx, y, z + dz, BLOCK.AIR);
      }
    }
    cells.push(x, g + 1, z, ALIEN_GLYPH);
    cells.push(x, g + 2, z, ALIEN_RELIC);
    for (const [dx, dz] of [[2, 2], [-2, 2], [2, -2], [-2, -2]]) cells.push(x + dx, g + 3, z + dz, ALIEN_GLYPH);
    return cells;
  }

  // A crashed lander: the plated body tipped on its side, a panel snapped
  // off, the core glowing in the wreck, sand over the far end.
  _probe(x, z, yaw) {
    const cells = [];
    const g = this.column(x, z).h;
    const dir = [[1, 0], [0, 1], [-1, 0], [0, -1]][yaw];
    const side = [-dir[1], dir[0]];
    const at = (f, s, y, id) => cells.push(x + dir[0] * f + side[0] * s, y, z + dir[1] * f + side[1] * s, id);
    for (let f = -2; f <= 2; f++) for (let s = -1; s <= 1; s++) for (let y = 0; y < 2; y++) at(f, s, g + y, PROBE_PLATING);
    at(0, 1, g + 1, PROBE_CORE);
    at(0, 2, g + 1, BLOCK.AIR);
    for (let s = 2; s <= 4; s++) at(-2, s, g, SOLAR_PANEL);
    for (let f = 4; f <= 6; f++) at(f, 3, g + 1, SOLAR_PANEL);
    for (let s = -1; s <= 1; s++) at(2, s, g + 2, MARS_SAND);
    for (let f = -6; f < -2; f++) at(f, 0, this.column(x + dir[0] * f, z + dir[1] * f).h, BLOCK.AIR);
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

const _col = {};
