// The canyon run's courses (Round 15): a dimension of its own (js/dim-registry.js
// "canyon"), one long winding canyon per course, cut through a desert plateau.
// Pure (no three.js, no DOM): the chunk workers run it too, and the run
// (js/canyon.js) asks the same course where its walls, rings and features are.
//
// A course runs along +z, from its start gate at z 0 to its finish at
// z = length; the jet starts in the mouth before it (z < 0), a funnel that
// narrows into the canyon. Everything follows from the course's seed
// (courseOf): the same seed is the same canyon, block for block, everywhere.
//
// The shape, per row of constant z (row(), cached): the canyon's middle
// winds left and right (a few sines, xc(z)), its half-width W(z) changes
// slowly (and pinches at the narrows); at each height the wall stands off
// the middle by that width, less the talus at its foot, plus the bulge of an
// undercut (the slot canyons'), the terraces flaring out toward the rim, the
// strata's own recess (soft bands erode back, hard ones stand out: ledges and
// overhangs) and a rough noise of its own on either side. Over the floor a
// river winds between sand banks; the plateau above is red sand on banded
// terracotta. Features (feats): arches across the canyon, rock pillars
// (hoodoos with caps), fins that split it into two lanes, tunnels where the
// rock closes overhead (lit by lumen crystals), narrows, waterfalls down the
// walls, and the checkered banners of the start and the finish.
//
// Rings (course.rings()): the checkpoints, every few hundred blocks, put
// where the flying is: under an arch, in a fin's lane, inside a tunnel, low
// over the river; boost rings between some; the AA sites of a course that has
// them (turrets()). Checked against the rock (solidAt) so none is buried.
import { BLOCK } from "./content/base.js";
import { RED_TERRACOTTA, ORANGE_TERRACOTTA, YELLOW_TERRACOTTA, WHITE_TERRACOTTA, BROWN_TERRACOTTA, LIGHT_GRAY_TERRACOTTA, SMOOTH_SANDSTONE, SANDSTONE, RED_SAND, BLACK_CONCRETE, WHITE_CONCRETE, COARSE_DIRT, GLOWSTONE, SHROOMLIGHT } from "./content/ids.js";
import { Noise, hash2, mulberry32 } from "./noise.js";
import { CHUNK_SIZE, WORLD_HEIGHT } from "./constants.js";

export const CANYON = "canyon";
const S = CHUNK_SIZE;
const H = WORLD_HEIGHT;
const TERRACOTTA = BLOCK.TERRACOTTA;
const ROW_CACHE = 1536; // rows of z kept (a chunk column's 16, many times over)

// The kinds of canyon: their widths (half-widths, blocks), how much they
// wind, their depth and what they hold. (Per 1000 blocks of course: the features.)
const KINDS = {
  grand: { wMin: 24, wMax: 46, wander: [150, 70, 22], waves: [1500, 820, 330], bulge: 0, flare: 26, talus: 13, rim: 106, floor: 6, river: 6, arches: 0.35, pillars: 1.6, fins: 0.18, tunnels: 0.07, narrows: 0.16, falls: 0.35, spacing: 430, ringR: 10.5 },
  slot: { wMin: 13, wMax: 21, wander: [95, 46, 15], waves: [1100, 560, 240], bulge: 7, flare: 9, talus: 6, rim: 100, floor: 6, river: 2.5, arches: 0.55, pillars: 0, fins: 0, tunnels: 0.2, narrows: 0.3, falls: 0.25, spacing: 320, ringR: 8.5 },
  night: { wMin: 20, wMax: 38, wander: [140, 60, 20], waves: [1300, 700, 300], bulge: 3, flare: 18, talus: 10, rim: 104, floor: 6, river: 5, arches: 0.4, pillars: 1.1, fins: 0.15, tunnels: 0.16, narrows: 0.2, falls: 0.2, spacing: 400, ringR: 10, glow: true },
  gauntlet: { wMin: 16, wMax: 40, wander: [160, 72, 24], waves: [1250, 640, 280], bulge: 4, flare: 20, talus: 10, rim: 104, floor: 6, river: 4, arches: 0.45, pillars: 1.3, fins: 0.22, tunnels: 0.12, narrows: 0.28, falls: 0.25, spacing: 400, ringR: 9.5, turrets: 2.2 },
};

// The courses on the menu (js/menu-canyon.js): fixed seeds, so a best time is
// always set on the same canyon. A seed that is none of these (a random
// course) is a canyon of the kind its seed picks.
export const CANYON_COURSES = [
  { id: "grand", name: "Grand Canyon", seed: 1515001, kind: "grand", length: 15000, time: "golden", blurb: "Wide, deep and winding: arches, rock pillars and a river far below. The one to learn." },
  { id: "slot", name: "Slot Canyon", seed: 1515002, kind: "slot", length: 8200, time: "noon", blurb: "A crack in the rock barely two wingspans wide, undercut walls, arches and dark tunnels. Throttle back." },
  { id: "night", name: "Night Run", seed: 1515003, kind: "night", length: 11000, time: "night", blurb: "The Grand Canyon's cousin by moonlight: glowing crystals, long tunnels and rings that light the way." },
  { id: "gauntlet", name: "The Gauntlet", seed: 1515004, kind: "gauntlet", length: 16000, time: "dusk", blurb: "Everything at once, and AA guns on the rim that shoot back. Shoot them first, or fly low." },
];
const KIND_ORDER = ["grand", "slot", "night", "gauntlet"];

export function courseOf(seed) {
  seed = seed >>> 0;
  const fixed = CANYON_COURSES.find((c) => c.seed === seed);
  if (fixed) return fixed;
  const kind = KIND_ORDER[seed % KIND_ORDER.length];
  return { id: null, name: "Random canyon", seed, kind, length: 9000 + (seed % 7) * 1000, time: kind === "night" ? "night" : "golden", blurb: "" };
}

// The strata: bands of terracotta, thick and thin, the hard ones (sandstone,
// white) standing out of the wall, the soft ones eroded back.
const BANDS = [
  { id: RED_TERRACOTTA, recess: 1.5 },
  { id: ORANGE_TERRACOTTA, recess: 0.5 },
  { id: TERRACOTTA, recess: 0 },
  { id: YELLOW_TERRACOTTA, recess: -1 },
  { id: WHITE_TERRACOTTA, recess: -2.5 },
  { id: BROWN_TERRACOTTA, recess: 2.5 },
  { id: LIGHT_GRAY_TERRACOTTA, recess: -1.5 },
  { id: SMOOTH_SANDSTONE, recess: -3 },
];

function smooth(a, b, x) {
  const t = x <= a ? 0 : x >= b ? 1 : (x - a) / (b - a);
  return t * t * (3 - 2 * t);
}

export class CanyonCourse {
  constructor(seed) {
    this.seed = seed >>> 0;
    this.spec = courseOf(this.seed);
    this.kind = KINDS[this.spec.kind] || KINDS.grand;
    this.length = this.spec.length;
    const k = this.kind;
    const rand = mulberry32((this.seed ^ 0xca7f00d) >>> 0);
    this.noise = new Noise((this.seed ^ 0x51ab) >>> 0);
    this.wallL = new Noise((this.seed ^ 0x1eff) >>> 0);
    this.wallR = new Noise((this.seed ^ 0x919e) >>> 0);
    this.phase = k.waves.map(() => rand() * Math.PI * 2);
    this.waves = k.waves.map((w) => w * (0.85 + rand() * 0.3));
    // The strata's sequence, from the floor up: a seeded order of the bands,
    // each 2-8 blocks thick (sandstone caps the top).
    const table = new Uint16Array(H + 64);
    const recess = new Float32Array(H + 64);
    let y = 0;
    while (y < H + 64) {
      const b = BANDS[Math.floor(rand() * (BANDS.length - 1))];
      const t = 2 + Math.floor(rand() * rand() * 8);
      for (let i = 0; i < t && y < H + 64; i++, y++) {
        table[y] = b.id;
        recess[y] = b.recess;
      }
    }
    this.bandId = table;
    this.bandRecess = recess;
    this._rows = new Map();
    this._makeFeatures(rand);
  }

  // ---------- The path ----------

  // The canyon's middle (x) at z, and its slope dx/dz. Straight in the
  // mouth and past the finish, winding in between.
  centerX(z) {
    const k = this.kind;
    const e = smooth(-150, 500, z) * (1 - smooth(this.length + 100, this.length + 700, z));
    let x = 0;
    for (let i = 0; i < this.waves.length; i++) x += k.wander[i] * Math.sin((z * Math.PI * 2) / this.waves[i] + this.phase[i]);
    return x * e;
  }

  slope(z) {
    return (this.centerX(z + 1) - this.centerX(z - 1)) / 2;
  }

  // The half-width across the canyon (perpendicular to it), before the walls' shapes.
  halfWidth(z) {
    const k = this.kind;
    const n = this.noise.fbm2(z / 900, 3.7, 2, 0.5, 2, 1) * 0.5 + 0.5;
    let w = k.wMin + (k.wMax - k.wMin) * Math.min(1, Math.max(0, n * 1.2 - 0.1));
    for (const f of this.narrows) {
      const d = Math.abs(z - f.z);
      if (d < f.len) w -= (w - f.w) * smooth(f.len, f.len * 0.35, d);
    }
    // (a fin in the middle: the canyon widens round it, two full lanes)
    for (const f of this.fins) {
      if (z > f.z0 - 80 && z < f.z1 + 80) w = Math.max(w, this._finHalf(f, z) + f.lane);
    }
    // (the mouth and the run-out: a funnel opening wide)
    if (z < 0) w += -z * 0.45;
    if (z > this.length) w += (z - this.length) * 0.5;
    return w;
  }

  floorY(z) {
    return this.kind.floor + Math.round(this.noise.perlin2(z / 260, 9.1) * 2);
  }

  rimY(z) {
    return this.kind.rim + this.noise.perlin2(z / 640, 1.3) * 7;
  }

  // ---------- Features ----------

  _makeFeatures(rand) {
    const k = this.kind;
    const L = this.length;
    const per = (rate, from = 250, to = L - 250) => {
      const n = Math.round(((to - from) / 1000) * rate + rand() * 0.6);
      const out = [];
      for (let i = 0; i < n; i++) out.push(from + ((i + 0.2 + rand() * 0.6) / n) * (to - from));
      return out;
    };
    // Narrows: the canyon pinches to a gap (the slot's to 9-11: a knife-edge pass).
    this.narrows = per(k.narrows, 400).map((z) => ({ z, len: 60 + rand() * 90, w: Math.max(9, k.wMin * (0.55 + rand() * 0.2)) }));
    // Fins: a blade of rock splitting the canyon (two lanes; over the top too, where it is low).
    this.fins = per(k.fins, 600).map((z) => ({ z0: z - 90 - rand() * 80, z1: z + 90 + rand() * 80, t: 4 + rand() * 5, lane: 20 + rand() * 8, top: rand() < 0.4 ? k.rim - 28 - rand() * 20 : k.rim + 8 }));
    // Tunnels: the rock closes overhead.
    this.tunnels = per(k.tunnels, 900).map((z) => {
      const len = 160 + rand() * 260;
      return { z0: z - len / 2, z1: z + len / 2, ceil: k.floor + 34 + rand() * 16 };
    });
    const inTunnel = (z, m = 60) => this.tunnels.some((t) => z > t.z0 - m && z < t.z1 + m);
    const nearFin = (z, m = 80) => this.fins.some((f) => z > f.z0 - m && z < f.z1 + m);
    // Arches across the canyon (high or low: under or over them).
    this.arches = per(k.arches, 300)
      .filter((z) => !inTunnel(z) && !nearFin(z))
      .map((z) => ({ z, y0: k.floor + 26 + rand() * 40, thick: 5 + rand() * 6, t: 5 + rand() * 5, drop: 10 + rand() * 14 }));
    // Pillars: hoodoos standing off the middle (a lane always beside them).
    this.pillars = [];
    for (const z of per(k.pillars, 200)) {
      if (inTunnel(z, 30) || nearFin(z, 40) || this.arches.some((a) => Math.abs(a.z - z) < 40)) continue;
      const off = (rand() < 0.5 ? -1 : 1) * (0.15 + rand() * 0.35);
      this.pillars.push({ z, off, x: this.centerX(z) + off * this.halfWidth(z), r: 3 + rand() * 3.5, top: k.rim - 6 - rand() * 50, ph: rand() * 6 });
    }
    // Waterfalls down a wall into the river.
    this.falls = per(k.falls, 300)
      .filter((z) => !inTunnel(z, 20))
      .map((z) => ({ z: Math.floor(z), w: 2 + Math.floor(rand() * 3), side: rand() < 0.5 ? -1 : 1 }));
    // (features by z, for the rows: each with its z-range)
    const all = [];
    for (const f of this.fins) all.push({ kind: "fin", f, z0: f.z0 - 2, z1: f.z1 + 2 });
    for (const t of this.tunnels) all.push({ kind: "tunnel", f: t, z0: t.z0 - 50, z1: t.z1 + 50 });
    for (const a of this.arches) all.push({ kind: "arch", f: a, z0: a.z - a.t - 4, z1: a.z + a.t + 4 });
    for (const p of this.pillars) all.push({ kind: "pillar", f: p, z0: p.z - p.r - 4, z1: p.z + p.r + 4 });
    for (const w of this.falls) all.push({ kind: "fall", f: w, z0: w.z, z1: w.z + w.w - 1 });
    all.sort((a, b) => a.z0 - b.z0);
    this.feats = all;
  }

  _finHalf(f, z) {
    if (z <= f.z0 || z >= f.z1) return 0;
    const t = (z - f.z0) / (f.z1 - f.z0);
    return f.t * Math.min(1, Math.sin(t * Math.PI) * 1.6);
  }

  _tunnelCeil(t, z, rim) {
    const ramp = 50;
    let c = t.ceil + this.noise.perlin2(z / 23, 4.4) * 4;
    if (z < t.z0) c += (rim + 6 - c) * Math.min(1, (t.z0 - z) / ramp);
    else if (z > t.z1) c += (rim + 6 - c) * Math.min(1, (z - t.z1) / ramp);
    return c;
  }

  // ---------- A row (constant z) ----------

  // Everything about the canyon at row z (an integer): the walls' x at each
  // height (L[y], R[y]: solid left of L, right of R), the floor, the rim,
  // the river and the features crossing it. Cached.
  row(z) {
    let r = this._rows.get(z);
    if (r) return r;
    const k = this.kind;
    const xc = this.centerX(z);
    const sl = this.slope(z);
    const sec = Math.sqrt(1 + sl * sl);
    const W = this.halfWidth(z);
    const floor = this.floorY(z);
    const rim = this.rimY(z);
    const span = rim - floor;
    const tilt = this.noise.perlin2(z / 400, 7.7) * 7 + z * 0.0007;
    const L = new Float32Array(H);
    const R = new Float32Array(H);
    let xMin = Infinity;
    let xMax = -Infinity;
    const talus = k.talus;
    const top = Math.min(H - 2, Math.ceil(rim + 4));
    for (let y = 0; y < H; y++) {
      const t = (y - floor) / span;
      let hw = W;
      if (y < floor + talus) hw -= (floor + talus - y) * 0.85;
      if (k.bulge) hw += k.bulge * Math.sin(Math.PI * Math.min(1, Math.max(0, t * 1.15))) * (0.6 + 0.4 * this.noise.perlin2(z / 120, 2.2));
      if (t > 0.72) {
        const f = Math.min(1, (t - 0.72) / 0.28);
        hw += k.flare * (0.55 * f * f + 0.45 * (Math.floor(f * 3.2) / 3.2));
      }
      const band = Math.max(0, Math.min(H + 63, Math.floor(y + tilt + 32)));
      hw += this.bandRecess[band] * (t > 0.08 ? 1 : 0.3);
      const nl = this.wallL.perlin2(z / 21, y / 13) * 3.2 + this.wallL.perlin2(z / 6.5, y / 4.5) * 1.1;
      const nr = this.wallR.perlin2(z / 21, y / 13) * 3.2 + this.wallR.perlin2(z / 6.5, y / 4.5) * 1.1;
      const minW = k.river + 1.5;
      L[y] = xc - Math.max(minW, hw + nl) * sec;
      R[y] = xc + Math.max(minW, hw + nr) * sec;
      if (y <= top) {
        if (L[y] < xMin) xMin = L[y];
        if (R[y] > xMax) xMax = R[y];
      }
    }
    // (the river winds a little within the floor)
    const riverX = xc + this.noise.perlin2(z / 180, 5.5) * Math.max(0, W - k.river - talus) * 0.5;
    const feats = [];
    for (const e of this.feats) {
      if (e.z0 > z) break;
      if (e.z1 >= z) feats.push(e);
    }
    let fin = 0;
    let finTop = 0;
    let ceil = Infinity;
    let arch = null;
    const pillars = [];
    let fall = null;
    for (const e of feats) {
      if (e.kind === "fin") {
        fin = this._finHalf(e.f, z);
        finTop = e.f.top;
      } else if (e.kind === "tunnel") ceil = Math.min(ceil, this._tunnelCeil(e.f, z, rim));
      else if (e.kind === "arch" && Math.abs(z - e.f.z) <= e.f.t) arch = e.f;
      else if (e.kind === "pillar") pillars.push(e.f);
      else if (e.kind === "fall") fall = e.f;
    }
    r = { z, xc, sl, sec, W, floor, rim, top, tilt, L, R, xMin, xMax, riverX, fin, finTop, ceil, arch, pillars, fall, start: z >= -2 && z <= 1, finish: Math.abs(z - this.length) <= 1 };
    if (this._rows.size >= ROW_CACHE) this._rows.delete(this._rows.keys().next().value);
    this._rows.set(z, r);
    return r;
  }

  // The plateau's top in column (x, z) (a little rough).
  plateauTop(x, z, row) {
    return Math.floor(row.rim + 1.5 + this.noise.perlin2(x / 17, z / 17) * 1.6);
  }

  // Is (x, y, z) rock? (The shape only: what blockAt fills.)
  solidAt(x, y, z) {
    x = Math.floor(x);
    y = Math.floor(y);
    z = Math.floor(z);
    if (y < 0) return true;
    if (y >= H) return false;
    return this._shape(x, y, this.row(z)) > 0;
  }

  // (top: the column's plateau top, when the caller has it)

  // 0 air, 1 wall/plateau rock, 2 feature rock, 3 river water, 4 floor.
  _shape(x, y, r, top) {
    if (y === 0) return 1;
    const cx = x + 0.5;
    if (cx < r.L[y] || cx > r.R[y]) return y <= (top ?? this.plateauTop(x, r.z, r)) ? 1 : 0;
    // inside the canyon at this height
    const dr = Math.abs(cx - r.riverX);
    const rw = this.kind.river;
    if (dr < rw) {
      if (y <= r.floor - 3) return 4;
      if (y <= r.floor) return 3;
    } else {
      const bank = r.floor + Math.min(3, Math.max(0, (dr - rw) * 0.3));
      if (y <= bank) return 4;
    }
    if (y >= r.ceil && y <= r.top + 6) return 2;
    const dx = cx - r.xc;
    if (r.fin > 0 && Math.abs(dx) < r.fin && y <= r.finTop) return 2;
    if (r.arch) {
      const a = r.arch;
      const half = r.W * r.sec + 6;
      const d = Math.min(1, Math.abs(dx) / half);
      const y0 = a.y0 - a.drop * d * d * d;
      const y1 = a.y0 + a.thick + d * 4;
      const tz = a.t * (1 - 0.35 * Math.max(0, (y - y0) / (y1 - y0 + 1)));
      if (y >= y0 && y <= y1 && Math.abs(r.z - a.z) <= tz) return 2;
    }
    for (const p of r.pillars) {
      if (y > p.top) continue;
      const px = p.x;
      const cap = y > p.top - 3 ? 1.8 : 0;
      const rr = p.r * (1 + 0.18 * Math.sin(y * 0.35 + p.ph)) + cap + (y < r.floor + 6 ? (r.floor + 6 - y) * 0.6 : 0);
      const ddx = cx - px;
      const ddz = r.z + 0.5 - p.z;
      if (ddx * ddx + ddz * ddz <= rr * rr) return 2;
    }
    return 0;
  }

  // ---------- Rings ----------

  // The checkpoints (and boost rings) of the course: [{ i, kind
  // ("start" | "check" | "boost" | "finish"), x, y, z, yaw, r }], in order
  // along it. yaw: the ring faces along the canyon (the jet's yaw through it).
  rings() {
    if (this._rings) return this._rings;
    const k = this.kind;
    const rand = mulberry32((this.seed ^ 0x7121e5) >>> 0);
    const out = [];
    const add = (kind, z, pick) => {
      z = Math.round(z);
      const row = this.row(z);
      const R = kind === "start" || kind === "finish" ? Math.min(18, row.W * 0.7) : kind === "boost" ? k.ringR * 0.8 : k.ringR;
      const tries = pick(row, R);
      for (const [x, y] of tries) {
        if (this._ringClear(x, y, z, R + 1.5, row.sl)) {
          out.push({ i: out.length, kind, x, y, z, yaw: Math.atan2(row.sl, 1), r: R });
          return true;
        }
      }
      return false;
    };
    // (the default spots: mid-canyon at a few heights, then anywhere)
    const spots = (row, R, lateral = 0) => {
      const list = [];
      const lo = row.floor + R + 4;
      const hi = Math.min(row.ceil - R - 3, row.rim - R - 6);
      const pref = [0.25, 0.55, 0.1, 0.8, 0.4];
      const start = Math.floor(rand() * pref.length);
      for (let i = 0; i < pref.length; i++) {
        const y = lo + (hi - lo) * pref[(start + i) % pref.length];
        for (const s of [lateral, 0, 0.3, -0.3]) list.push([row.xc + s * row.W * row.sec, y]);
      }
      return list;
    };
    add("start", 0, (row, R) => [[row.xc, row.floor + 30], [row.xc, row.floor + 40], [row.xc, row.floor + 22]]);
    const L = this.length;
    let z = k.spacing;
    while (z < L - k.spacing * 0.6) {
      // A feature near: the ring goes through it.
      const arch = this.arches.find((a) => Math.abs(a.z - z) < k.spacing * 0.45);
      const fin = this.fins.find((f) => z > f.z0 - k.spacing * 0.3 && z < f.z1 + k.spacing * 0.3);
      const tun = this.tunnels.find((t) => z > t.z0 - k.spacing * 0.3 && z < t.z1 + k.spacing * 0.3);
      if (arch) {
        z = arch.z;
        const under = rand() < 0.65;
        add("check", z, (row, R) => {
          const below = [row.xc, Math.max(row.floor + R + 4, arch.y0 - R - 5)];
          const above = [row.xc, Math.min(row.rim - R - 4, arch.y0 + arch.thick + R + 6)];
          return under ? [below, above, ...spots(row, R)] : [above, below, ...spots(row, R)];
        });
      } else if (fin) {
        z = (fin.z0 + fin.z1) / 2;
        const side = rand() < 0.5 ? -1 : 1;
        add("check", z, (row, R) => {
          const lane = (row.fin + (row.W - row.fin) * 0.5) * row.sec;
          const y = row.floor + R + 8 + rand() * 20;
          return [[row.xc + side * lane, y], [row.xc - side * lane, y], [row.xc + side * lane, y + 14], [row.xc - side * lane, y + 14], ...spots(row, R)];
        });
      } else if (tun) {
        z = Math.min(tun.z1 - 40, Math.max(tun.z0 + 40, z));
        add("check", z, (row, R) => [[row.xc, (row.floor + row.ceil) / 2], [row.xc, row.floor + R + 4], ...spots(row, R)]);
      } else add("check", z, (row, R) => spots(row, R, (rand() - 0.5) * 0.6));
      // A boost ring on some stretches (half way to the next).
      if (rand() < 0.4 && z + k.spacing * 0.5 < L - 100) add("boost", z + k.spacing * 0.5, (row, R) => spots(row, R, (rand() - 0.5) * 0.8));
      z += k.spacing * (0.85 + rand() * 0.3);
    }
    add("finish", L, (row, R) => [[row.xc, row.floor + 30], [row.xc, row.floor + 40], [row.xc, row.floor + 22], [row.xc, row.floor + 55]]);
    // (in order along the canyon)
    out.sort((a, b) => a.z - b.z);
    out.forEach((r, i) => (r.i = i));
    this._rings = out;
    return out;
  }

  // Nothing solid in the ring's disc (its rim and a cross through it).
  _ringClear(x, y, z, R, sl) {
    // (the ring's plane: across the canyon, turned with it)
    const c = 1 / Math.sqrt(1 + sl * sl);
    const ux = c;
    const uz = -sl * c;
    if (y < 2 || y + R > H - 2) return false;
    for (let a = 0; a < 16; a++) {
      const ang = (a / 16) * Math.PI * 2;
      for (const rr of [R, R * 0.5]) {
        const ox = Math.cos(ang) * rr;
        const oy = Math.sin(ang) * rr;
        if (this.solidAt(x + ux * ox, y + oy, z + uz * ox) || this.solidAt(x + ux * ox, y + oy, z + uz * ox + 3) || this.solidAt(x + ux * ox, y + oy, z + uz * ox - 3)) return false;
      }
    }
    return !this.solidAt(x, y, z);
  }

  // The AA sites (a course with turrets): on the rim's edge, looking down
  // into the canyon. [{ x, y, z }]
  turrets() {
    if (this._turrets) return this._turrets;
    const out = [];
    const k = this.kind;
    if (k.turrets) {
      const rand = mulberry32((this.seed ^ 0xaa6a) >>> 0);
      const n = Math.round((this.length / 1000) * k.turrets);
      for (let i = 0; i < n; i++) {
        const z = Math.round(600 + ((i + 0.3 + rand() * 0.4) / n) * (this.length - 1000));
        if (this.tunnels.some((t) => z > t.z0 - 60 && z < t.z1 + 60)) continue;
        const row = this.row(z);
        const side = rand() < 0.5 ? -1 : 1;
        const top = Math.ceil(row.rim + 4);
        const edge = side < 0 ? row.L[Math.min(H - 1, top - 6)] - 4 : row.R[Math.min(H - 1, top - 6)] + 4;
        const x = Math.round(edge);
        const y = this.plateauTop(x, z, row) + 1;
        out.push({ i: out.length, x, y, z, side });
      }
    }
    this._turrets = out;
    return out;
  }
}

export class CanyonGenerator {
  constructor(seed) {
    this.course = new CanyonCourse(seed);
    this.seed = this.course.seed;
    this.structures = null;
  }

  generate(chunk) {
    const blocks = chunk.blocks;
    const bx = chunk.cx * S;
    const bz = chunk.cz * S;
    const c = this.course;
    const glow = !!c.kind.glow;
    const seed = this.seed;
    for (let lz = 0; lz < S; lz++) {
      const z = bz + lz;
      const r = c.row(z);
      const bandOff = r.tilt + 32;
      // (all plateau: no canyon in this stretch of the row)
      const solidRow = bx + S < r.xMin - 1 || bx > r.xMax + 1;
      for (let lx = 0; lx < S; lx++) {
        const x = bx + lx;
        const top = Math.min(H - 1, c.plateauTop(x, z, r));
        const tiltX = (x - r.xc) * 0.012;
        const col = (lz << 4) | lx;
        if (solidRow) {
          for (let y = 0; y <= top; y++) blocks[(y << 8) | col] = this._rock(x, y, z, bandOff + tiltX, top, seed);
          if (hash2(seed ^ 0xdb, x, z) < 0.004) blocks[((top + 1) << 8) | col] = BLOCK.DEAD_BUSH;
          continue;
        }
        let prev = 1;
        for (let y = 0; y < H; y++) {
          const s = c._shape(x, y, r, top);
          if (s === 0) {
            // (a waterfall down this wall: water on the rock face)
            if (r.fall && prev === 1 && y > r.floor && y <= top) {
              const near = r.fall.side < 0 ? x + 0.5 - r.L[y] < 1.6 : r.R[y] - (x + 0.5) < 1.6;
              if (near) blocks[(y << 8) | col] = BLOCK.WATER;
            }
            if (prev === 4 && y > r.floor && hash2(seed ^ 0x5b, x, z) < 0.012) blocks[(y << 8) | col] = BLOCK.DEAD_BUSH;
            prev = 0;
            continue;
          }
          let id;
          if (s === 3) id = BLOCK.WATER;
          else if (s === 4) {
            const below = y < r.floor - 1;
            // (the floor in patches: red sand, pale sand by the water, gravel bars, dry dirt)
            const n = c.noise.perlin2(x / 9, z / 9) + (hash2(seed ^ 0x77, x, z) - 0.5) * 0.25;
            const dr = Math.abs(x + 0.5 - r.riverX) - c.kind.river;
            id = below ? this._rock(x, y, z, bandOff + tiltX, top, seed) : dr < 2.5 ? (n > 0.15 ? BLOCK.GRAVEL : BLOCK.SAND) : n > 0.32 ? COARSE_DIRT : n < -0.3 ? BLOCK.SAND : RED_SAND;
          } else {
            id = y === top && s === 1 ? RED_SAND : this._rock(x, y, z, bandOff + tiltX, top, seed);
            // Lumen crystals and glowstone where the rock meets the air: the
            // tunnels' ceilings always, a night course's walls too.
            if ((s === 2 && y >= r.ceil && y < r.ceil + 1.5) || glow) {
              const g = hash2(seed ^ 0x6170, x * 7 + y, z);
              if (g < (s === 2 && y >= r.ceil ? 0.03 : 0.0035) && this._exposed(x, y, z, r)) id = g < 0.0012 ? GLOWSTONE : g < 0.002 ? SHROOMLIGHT : BLOCK.LUMEN;
            }
          }
          // (the start's and the finish's checkered banners on the walls)
          if ((r.start || r.finish) && s === 1 && y > r.floor + 8 && y < r.rim - 4 && this._exposed(x, y, z, r)) id = ((Math.floor(y / 3) + (z & 1) + (x & 1)) & 1) === 0 ? BLACK_CONCRETE : WHITE_CONCRETE;
          blocks[(y << 8) | col] = id;
          prev = s === 3 ? 3 : s === 4 ? 4 : 1;
        }
      }
    }
  }

  // Rock at (x, y, z): its stratum, a little mixed; bedrock at the bottom; a
  // sandstone cap under the plateau's sand.
  _rock(x, y, z, off, top, seed) {
    if (y === 0) return BLOCK.BEDROCK;
    if (y < 3) return BLOCK.STONE;
    if (top - y <= 2 && top - y >= 1) return SANDSTONE;
    const c = this.course;
    let b = Math.floor(y + off);
    // (a few blocks of the band above or below: the band edges ragged)
    const h = hash2(seed, x, z * 131 + y);
    if (h < 0.06) b += 1;
    else if (h > 0.95) b -= 1;
    b = b < 0 ? 0 : b > H + 63 ? H + 63 : b;
    return c.bandId[b];
  }

  // Air beside (x, y, z) across the canyon (the rock's face).
  _exposed(x, y, z, r) {
    const c = this.course;
    return c._shape(x - 1, y, r) === 0 || c._shape(x + 1, y, r) === 0 || (y > 0 && c._shape(x, y - 1, r) === 0) || c._shape(x, y + 1, r) === 0;
  }

  // The top block of a column (the plateau, a ledge, the canyon's floor).
  heightAt(x, z) {
    const r = this.course.row(Math.floor(z));
    x = Math.floor(x);
    for (let y = Math.min(H - 1, r.top + 8); y > 0; y--) if (this.course._shape(x, y, r) !== 0) return y;
    return 0;
  }

  biomeAt() {
    return -1;
  }
}
