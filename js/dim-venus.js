// Venus' terrain (Round 17): a dimension's generator (js/dim-registry.js:
// generate(chunk), heightAt(x, z), biomeAt(x, z), lodColumn(x, z, out),
// structures). Pure (no three.js, no DOM): the chunk workers and the far
// terrain's builders (js/lod-mesher.js) run it too.
//
// - The volcanic plains: wide, gently rolling basalt under a thin orange
//   soil, crossed by low wrinkle ridges.
// - Shield volcanoes (one in each 1100-block square, the nearest in sight of
//   the landing zone): a wide low cone, a caldera at the top with a pool of
//   lava, sulfur round its rim, and lava flows running down and out over
//   the plains in long lobes (lava crust: black, its cracks still glowing).
// - Pancake domes: round, flat-topped domes of pale rock with steep sides,
//   often in groups, their tops cracked; a group stands near the landing
//   zone.
// - Tesserae: patches of high, crumpled ground (two ridged patterns
//   crossing).
// The air: a thick orange haze (sky.js, js/space-sky.js), no water (it
// boils), gravity 0.9.
import { BLOCK } from "./content/base.js";
import { LAVA } from "./content/ids.js";
import { VENUS_SOIL, VENUS_BASALT, VENUS_CRUST, VENUS_FELSIC, SULFUR_CRUST } from "./content/space.js";
import { Noise, hash2 } from "./noise.js";
import { CHUNK_SIZE, WORLD_HEIGHT } from "./constants.js";

const S = CHUNK_SIZE;
const PLAIN = 70;
const VOLCANO_CELL = 1100;
const DOME_CELL = 150;
export const VENUS_LANDING = { x: 0, z: 0, r: 45 };
const smooth = (a, b, v) => {
  const t = Math.max(0, Math.min(1, (v - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

export class VenusGenerator {
  constructor(seed) {
    this.seed = (seed ^ 0x56454e55) >>> 0;
    this.noise = new Noise(this.seed);
    this.ridge = new Noise((this.seed ^ 0x3c6ef372) >>> 0);
    this.tess = new Noise((this.seed ^ 0xa54ff53a) >>> 0);
    this.flow = new Noise((this.seed ^ 0x510e527f) >>> 0);
    this.detail = new Noise((this.seed ^ 0x9b05688c) >>> 0);
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

  // The volcano of grid cell (gx, gz): { x, z, R, H, flows: [{ a, w, len }] }.
  _volcano(gx, gz) {
    return this._cached(`v${gx},${gz}`, () => {
      const s = this.seed ^ 0x766f;
      let x = (gx + 0.25 + hash2(s, gx, gz) * 0.5) * VOLCANO_CELL;
      let z = (gz + 0.25 + hash2(s ^ 1, gx, gz) * 0.5) * VOLCANO_CELL;
      if (gx === 0 && gz === 0) {
        // (the home one, in sight of the landing zone)
        x = 380;
        z = -330;
      }
      const R = 150 + hash2(s ^ 2, gx, gz) * 90;
      const H = 28 + hash2(s ^ 3, gx, gz) * 18;
      const n = 5 + Math.floor(hash2(s ^ 4, gx, gz) * 5);
      const flows = [];
      for (let i = 0; i < n; i++) {
        flows.push({ a: (i / n) * Math.PI * 2 + (hash2(s ^ (10 + i), gx, gz) - 0.5) * 0.9, w: 0.08 + hash2(s ^ (30 + i), gx, gz) * 0.12, len: 1.15 + hash2(s ^ (50 + i), gx, gz) * 1.3 });
      }
      return { x, z, R, H, flows };
    });
  }

  // The pancake dome of grid cell (gx, gz), or null: { x, z, r, H }.
  _dome(gx, gz) {
    return this._cached(`d${gx},${gz}`, () => {
      const s = this.seed ^ 0x646f;
      const home = gx === -1 && gz === 0;
      // (in groups: a low-frequency field decides where they gather)
      const field = this.tess.fbm2(gx * 13.1, gz * 13.1, 2, 0.5, 2, 1 / 90);
      if (!home && hash2(s, gx, gz) > 0.18 + Math.max(0, field) * 1.6) return null;
      let x = (gx + 0.25 + hash2(s ^ 1, gx, gz) * 0.5) * DOME_CELL;
      let z = (gz + 0.25 + hash2(s ^ 2, gx, gz) * 0.5) * DOME_CELL;
      if (home) {
        x = -120;
        z = 70;
      }
      const r = 17 + hash2(s ^ 3, gx, gz) * 22;
      if (Math.hypot(x - VENUS_LANDING.x, z - VENUS_LANDING.z) < VENUS_LANDING.r + r) return null;
      return { x, z, r, H: 6 + r * 0.22 + hash2(s ^ 4, gx, gz) * 3 };
    });
  }

  // Column (x, z): { h, kind: "plain" | "flow" | "dome" | "cone" | "tess", lava (a lava pool's surface y, or 0), sulfur, glow }.
  column(x, z, out = {}) {
    const n = this.noise.fbm2(x, z, 4, 0.5, 2, 1 / 260);
    const d = this.detail.fbm2(x, z, 2, 0.5, 2, 1 / 19);
    let h = PLAIN + n * 5 + d * 0.8;
    let kind = "plain";
    let lava = 0;
    let sulfur = false;
    let glow = false;
    // wrinkle ridges: low, narrow, winding
    const rv = 1 - Math.abs(this.ridge.fbm2(x, z, 2, 0.5, 2, 1 / 170));
    h += smooth(0.9, 0.99, rv) * 2.2;
    // tesserae: high crumpled ground
    const tk = smooth(0.3, 0.42, this.tess.fbm2(x, z, 3, 0.5, 2, 1 / 900)) * smooth(VENUS_LANDING.r + 200, VENUS_LANDING.r + 400, Math.hypot(x, z));
    if (tk > 0) {
      const a = 1 - Math.abs(this.ridge.fbm2(x * 0.8 + 300, z * 1.3, 3, 0.5, 2, 1 / 48));
      const b = 1 - Math.abs(this.tess.fbm2(x * 1.3, z * 0.8 - 200, 3, 0.5, 2, 1 / 40));
      h += tk * (10 + a * a * 9 + b * b * 7);
      if (tk > 0.5) kind = "tess";
    }
    // the shield volcanoes and their flows
    const vx = Math.floor(x / VOLCANO_CELL);
    const vz = Math.floor(z / VOLCANO_CELL);
    for (let dz = -1; dz <= 1; dz++) {
      for (let dx = -1; dx <= 1; dx++) {
        const v = this._volcano(vx + dx, vz + dz);
        const ex = x - v.x;
        const ez = z - v.z;
        const dist = Math.hypot(ex, ez);
        const t = dist / v.R;
        if (t >= 2.6) continue;
        if (t < 1) {
          // the cone (gentle: a shield), its caldera
          let ch = PLAIN + v.H * Math.pow(1 - t, 1.5) + d * (1 - t);
          const top = PLAIN + v.H;
          if (t < 0.08) ch = top - 9 + (t / 0.08) * 3;
          else if (t < 0.1) ch = top - 6 + ((t - 0.08) / 0.02) * 7.5;
          if (ch > h) {
            h = ch;
            kind = "cone";
            if (t < 0.06) lava = top - 7;
            if (t > 0.08 && t < 0.2 && this.flow.fbm2(x, z, 2, 0.5, 2, 1 / 11) > 0.05) sulfur = true;
          }
        }
        // the flows: long lobes out from the summit, over the cone and the plains
        if (t > 0.1) {
          const ang = Math.atan2(ez, ex) + this.flow.fbm2(x, z, 3, 0.5, 2, 1 / 140) * 0.45;
          for (const f of v.flows) {
            let da = ang - f.a;
            da = Math.atan2(Math.sin(da), Math.cos(da));
            // (narrower close in, spreading in lobes further out)
            const w = f.w * (0.6 + 0.6 * smooth(0.2, 1.8, t)) * (1 + 0.35 * Math.sin(t * 9 + f.a * 3));
            const len = f.len * (1 + this.flow.fbm2(x * 0.5, z * 0.5, 2, 0.5, 2, 1 / 60) * 0.25);
            if (Math.abs(da) < w && t < len) {
              const edge = Math.min(1 - Math.abs(da) / w, (len - t) * 8);
              h += Math.min(1.6, edge * 5);
              kind = kind === "cone" && t < 0.2 ? kind : "flow";
              // (fresh, still glowing near the vent and at the lobes' ends)
              if (t < 0.45 || len - t < 0.06) glow = true;
              break;
            }
          }
        }
      }
    }
    // the pancake domes
    const gx = Math.floor(x / DOME_CELL);
    const gz = Math.floor(z / DOME_CELL);
    for (let dz = -1; dz <= 1; dz++) {
      for (let dx = -1; dx <= 1; dx++) {
        const dm = this._dome(gx + dx, gz + dz);
        if (!dm) continue;
        const ex = x - dm.x;
        const ez = z - dm.z;
        const t = Math.hypot(ex, ez) / (dm.r * (1 + d * 0.03));
        if (t >= 1.15) continue;
        // flat top, a little sunken in the middle; steep sides; a small apron
        let dh = dm.H * (1 - smooth(0.8, 1.0, t)) - (t < 0.7 ? (1 - t / 0.7) * 1.2 : 0);
        if (t >= 1) dh = 0.6 * (1 - (t - 1) / 0.15);
        // radial cracks across the top
        if (t < 0.78 && t > 0.15 && Math.abs(Math.sin(Math.atan2(ez, ex) * 6 + dm.r)) < 0.06) dh -= 1.5;
        const base = Math.max(h, PLAIN + n * 5);
        if (base + dh > h) {
          h = base + dh;
          kind = t < 1 ? "dome" : kind;
          lava = 0;
          glow = false;
        }
      }
    }
    out.h = Math.max(6, Math.min(WORLD_HEIGHT - 6, Math.round(h)));
    out.kind = kind;
    out.lava = lava > out.h ? Math.round(lava) : 0;
    out.sulfur = sulfur;
    out.glow = glow;
    return out;
  }

  heightAt(x, z) {
    return this.column(x, z).h;
  }

  biomeAt() {
    return -1;
  }

  _surface(c) {
    if (c.lava) return LAVA;
    if (c.kind === "dome") return VENUS_FELSIC;
    if (c.kind === "flow") return c.glow ? VENUS_CRUST : VENUS_BASALT;
    if (c.sulfur) return SULFUR_CRUST;
    if (c.kind === "tess" || c.kind === "cone") return VENUS_BASALT;
    return VENUS_SOIL;
  }

  // (The far terrain, js/lod-mesher.js) the top face's height and block of column (x, z).
  lodColumn(x, z, out) {
    const c = this.column(x, z, _col);
    out.top = (c.lava || c.h) + 1;
    out.id = this._surface(c);
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
        const surf = this._surface(col);
        const soil = col.kind === "plain" ? 2 : 0;
        for (let y = 1; y <= top; y++) {
          let id = VENUS_BASALT;
          if (y > top - soil) id = VENUS_SOIL;
          else if (col.kind === "dome" && y > top - 6) id = VENUS_FELSIC;
          else if (col.kind === "flow" && y > top - 2) id = col.glow ? VENUS_CRUST : VENUS_BASALT;
          blocks[(y << 8) | i0] = id;
        }
        if (col.lava) {
          blocks[(top << 8) | i0] = VENUS_CRUST;
          for (let y = top + 1; y <= col.lava; y++) blocks[(y << 8) | i0] = LAVA;
        } else if (surf !== VENUS_SOIL && surf !== LAVA) blocks[(top << 8) | i0] = surf;
      }
    }
  }
}

const _col = {};
