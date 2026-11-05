// The canyon run's courses (Round 15): a dimension of its own (js/dim-registry.js
// "canyon"), one long winding canyon per course, cut through a plateau.
// Pure (no three.js, no DOM): the chunk workers run it too, and the run
// (js/canyon.js) asks the same course where its walls, rings and features are.
//
// A course runs along +z, from its start gate at z 0 to its finish at
// z = length; the jet starts in the mouth before it (z < 0), a funnel that
// narrows into the canyon. Everything follows from the course's seed
// (courseOf): the same seed is the same canyon, block for block, everywhere.
//
// (Round 16) The seed also carries the run's options (canyonSeed: the
// course in its low 21 bits, then the scenery, the difficulty and the open
// stretches), so the workers, which get only the world's seed, make the same
// canyon as the page: a biome or a mix of them (js/canyon-biomes.js: the
// rock, floor, river, plants, trees), how wide and winding it is (Easy wide
// open .. Insane), and open stretches between the canyons: a wide valley of
// low hills and buttes, or space (the canyon ends at a cliff, then nothing
// but stars and floating rocks to dodge, then the next canyon's mouth).
//
// The shape, per row of constant z (row(), cached): the canyon's middle
// winds left and right (a few sines, xc(z)), its half-width W(z) changes
// slowly (and pinches at the narrows); at each height the wall stands off
// the middle by that width, less the talus at its foot, plus the bulge of an
// undercut (the slot canyons'), the terraces flaring out toward the rim, the
// strata's own recess (soft bands erode back, hard ones stand out: ledges and
// overhangs) and a rough noise of its own on either side. Over the floor a
// river winds between banks; the plateau above is the biome's top on its
// banded rock. Features (feats): arches across the canyon, rock pillars
// (hoodoos with caps; a valley's buttes), fins that split it into two lanes,
// tunnels where the rock closes overhead (lit by lumen crystals), narrows,
// waterfalls (lava falls) down the walls, asteroids in space, and the
// checkered banners of the start and the finish.
//
// Rings (course.rings()): the checkpoints, every few hundred blocks, put
// where the flying is: under an arch, in a fin's lane, inside a tunnel, low
// over the river, among the asteroids; the AA sites of a course that has
// them (turrets()). Checked against the rock (solidAt) so none is buried.
// (Round 16: no boost rings: the run never speeds the jet up by itself.)
import { BLOCK } from "./content/base.js";
import { BLACK_CONCRETE, WHITE_CONCRETE, GLOWSTONE, SHROOMLIGHT, BLACKSTONE, BASALT, ANDESITE, MAGMA_BLOCK, ICE, SNOW_LAYER } from "./content/ids.js";
import { Noise, hash2, mulberry32 } from "./noise.js";
import { CHUNK_SIZE, WORLD_HEIGHT } from "./constants.js";
import { CANYON_BIOMES, BIOME_ORDER, CANYON_DIFFS, CANYON_OPENS } from "./canyon-biomes.js";

export const CANYON = "canyon";
const S = CHUNK_SIZE;
const H = WORLD_HEIGHT;
const ROW_CACHE = 1536; // rows of z kept (a chunk column's 16, many times over)

// The kinds of canyon: their widths (half-widths, blocks), how much they
// wind, their depth and what they hold. (Per 1000 blocks of course: the features.)
// These are the Hard difficulty's numbers (the Round 15 canyons); the
// other levels scale them (js/canyon-biomes.js CANYON_DIFFS).
const KINDS = {
  grand: { wMin: 24, wMax: 46, wander: [130, 55, 14], waves: [1700, 950, 420], bulge: 0, flare: 26, talus: 13, rim: 106, floor: 6, river: 6, arches: 0.35, pillars: 1.6, fins: 0.18, tunnels: 0.07, narrows: 0.16, falls: 0.35, spacing: 430, ringR: 10.5 },
  slot: { wMin: 13, wMax: 21, wander: [95, 40, 10], waves: [1100, 560, 240], bulge: 7, flare: 9, talus: 6, rim: 100, floor: 6, river: 2.5, arches: 0.55, pillars: 0, fins: 0, tunnels: 0.2, narrows: 0.3, falls: 0.25, spacing: 320, ringR: 8.5 },
  night: { wMin: 20, wMax: 38, wander: [120, 50, 14], waves: [1400, 760, 330], bulge: 3, flare: 18, talus: 10, rim: 104, floor: 6, river: 5, arches: 0.4, pillars: 1.1, fins: 0.15, tunnels: 0.16, narrows: 0.2, falls: 0.2, spacing: 400, ringR: 10, glow: true },
  gauntlet: { wMin: 16, wMax: 40, wander: [140, 60, 14], waves: [1400, 760, 330], bulge: 4, flare: 20, talus: 10, rim: 104, floor: 6, river: 4, arches: 0.45, pillars: 1.3, fins: 0.22, tunnels: 0.12, narrows: 0.28, falls: 0.25, spacing: 400, ringR: 9.5, turrets: 2.2 },
};

// The courses on the menu (js/menu-canyon.js): fixed seeds, so a best time is
// always set on the same canyon. A seed that is none of these (a random
// course) is a canyon of the kind its seed picks. (Round 16) biome: the
// course's own scenery ("Course default" on the menu).
export const CANYON_COURSES = [
  { id: "grand", name: "Grand Canyon", seed: 1515001, kind: "grand", length: 15000, time: "golden", biome: "mesa", blurb: "Wide, deep and winding: arches, rock pillars and a river far below. The one to learn." },
  { id: "slot", name: "Slot Canyon", seed: 1515002, kind: "slot", length: 8200, time: "noon", biome: "desert", blurb: "A crack in the sandstone barely two wingspans wide, undercut walls, arches and dark tunnels. Throttle back." },
  { id: "night", name: "Night Run", seed: 1515003, kind: "night", length: 11000, time: "night", biome: "mesa", blurb: "The Grand Canyon's cousin by moonlight: glowing crystals, long tunnels and rings that light the way." },
  { id: "gauntlet", name: "The Gauntlet", seed: 1515004, kind: "gauntlet", length: 16000, time: "dusk", biome: "mixed", blurb: "Everything at once, through every kind of canyon, and AA guns on the rim that shoot back." },
];
const KIND_ORDER = ["grand", "slot", "night", "gauntlet"];

// ---------- The options in the seed (Round 16) ----------

const BASE_BITS = 21;
const BASE_MASK = (1 << BASE_BITS) - 1;
const DIFF_CODES = ["normal", "easy", "hard", "insane"]; // (0: the default)
const OPEN_CODES = [null, "none", "some", "lots"]; // (0: the course's default)
export const BIOME_MIXED = "mixed";

// (Round 17) Space is a scenery of its own (the whole run out among the
// asteroids), no longer an open stretch between canyons: a bit of its own in
// the seed. Mixed and Random never pick it (it isn't in BIOME_ORDER).
export const BIOME_SPACE = "space";

// The world seed of a course with options: { biome: a biome id, "mixed",
// "space" (Round 17) or null (the course's), diff, open }.
export function canyonSeed(base, { biome = null, diff = "normal", open = null } = {}) {
  const space = biome === BIOME_SPACE;
  const b = biome === BIOME_MIXED ? 7 : Math.max(0, BIOME_ORDER.indexOf(biome) + 1);
  const d = Math.max(0, DIFF_CODES.indexOf(diff));
  const o = Math.max(0, OPEN_CODES.indexOf(open));
  return ((base & BASE_MASK) | (b << BASE_BITS) | (d << (BASE_BITS + 3)) | (o << (BASE_BITS + 5)) | ((space ? 1 : 0) << (BASE_BITS + 7))) >>> 0;
}

export function courseOf(seed) {
  seed = seed >>> 0;
  const base = seed & BASE_MASK;
  const opts = seed >>> BASE_BITS;
  const fixed = CANYON_COURSES.find((c) => c.seed === base);
  const kind = fixed ? fixed.kind : KIND_ORDER[base % KIND_ORDER.length];
  const spec = fixed ? { ...fixed } : { id: null, name: "Random canyon", kind, length: 9000 + (base % 7) * 1000, time: kind === "night" ? "night" : "golden", biome: BIOME_ORDER[base % BIOME_ORDER.length], blurb: "" };
  const bc = opts & 7;
  spec.courseSeed = fixed ? fixed.seed : base;
  spec.seed = seed;
  spec.biome = bc === 0 ? spec.biome : bc === 7 ? BIOME_MIXED : BIOME_ORDER[bc - 1];
  spec.diff = DIFF_CODES[(opts >> 3) & 3];
  spec.open = OPEN_CODES[(opts >> 5) & 3] || "some";
  // (Round 17) The Space scenery: the course's own rock at the mouth and the run-out only.
  spec.space = ((opts >> 7) & 1) === 1;
  spec.opts = opts & 0xff; // (records: a course with other options keeps its own best)
  return spec;
}

function smooth(a, b, x) {
  const t = x <= a ? 0 : x >= b ? 1 : (x - a) / (b - a);
  return t * t * (3 - 2 * t);
}

const VALLEY_W = 100; // a valley's half-width
const VALLEY_RAMP = 220; // blocks over which the canyon opens into a valley (and closes again)
const SPACE_FROM = 260; // (Round 17) the Space scenery: its cliff edges, this far in from either end
const SPACE_HALF = 90; // the width of the course through space (each side of its line)
const BIOME_BLEND = 260; // blocks over which one biome gives way to the next
const ROCK_BLOCKS = [BLACKSTONE, BASALT, ANDESITE, BLOCK.COBBLESTONE, BLACKSTONE, BASALT];

export class CanyonCourse {
  constructor(seed) {
    this.seed = seed >>> 0;
    this.spec = courseOf(this.seed);
    this.base = this.spec.courseSeed >>> 0;
    this.diff = CANYON_DIFFS[this.spec.diff] || CANYON_DIFFS.normal;
    this.kind = this._scaledKind(KINDS[this.spec.kind] || KINDS.grand, this.diff);
    this.length = this.spec.length;
    const k = this.kind;
    // (the shape from the course's own seed: the same course in another
    // scenery winds the same way)
    const rand = mulberry32((this.base ^ 0xca7f00d) >>> 0);
    this.noise = new Noise((this.base ^ 0x51ab) >>> 0);
    this.wallL = new Noise((this.base ^ 0x1eff) >>> 0);
    this.wallR = new Noise((this.base ^ 0x919e) >>> 0);
    this.phase = k.waves.map(() => rand() * Math.PI * 2);
    this.waves = k.waves.map((w) => w * (0.85 + rand() * 0.3));
    // The strata of each biome, from the floor up: a seeded order of its
    // bands, each 2-8 blocks thick (or its own most).
    this.strata = {};
    for (const id of BIOME_ORDER) this.strata[id] = this._strata(id);
    this._rows = new Map();
    this._safe = new Map();
    this._trees = new Map();
    this._makeBiomes();
    this._makeOpens();
    this._makeFeatures(rand);
  }

  _scaledKind(base, d) {
    const k = { ...base };
    k.wMin = base.wMin * d.w + d.wAdd;
    k.wMax = base.wMax * d.w + d.wAdd;
    k.wander = base.wander.map((a) => a * d.wander);
    k.bulge = base.bulge * d.bulge;
    k.flare = base.flare * d.flare;
    for (const f of ["arches", "pillars", "fins", "tunnels", "narrows"]) k[f] = base[f] * d[f];
    k.ringR = base.ringR * d.ringR;
    k.minHalf = Math.max(base.river + 1.5, d.minHalf);
    return k;
  }

  _strata(id) {
    const B = CANYON_BIOMES[id];
    const rand = mulberry32((this.base ^ 0xb1a5 ^ (BIOME_ORDER.indexOf(id) * 0x9e3779b1)) >>> 0);
    const table = new Uint16Array(H + 64);
    const recess = new Float32Array(H + 64);
    let y = 0;
    while (y < H + 64) {
      const b = B.bands[Math.floor(rand() * B.bands.length)];
      const t = Math.min(b.max ?? 9, 2 + Math.floor(rand() * rand() * 8));
      for (let i = 0; i < t && y < H + 64; i++, y++) {
        table[y] = b.b;
        recess[y] = b.r;
      }
    }
    return { id: table, recess };
  }

  // ---------- Biomes along the course (Round 16) ----------

  _makeBiomes() {
    const b = this.spec.biome;
    if (b !== BIOME_MIXED) {
      this.biomes = [{ z0: -Infinity, id: CANYON_BIOMES[b] ? b : "mesa" }];
      return;
    }
    // A mix: stretches of 2.4-3.6 km, each a different biome (a seeded order).
    const rand = mulberry32((this.base ^ 0x6b10e5) >>> 0);
    const order = BIOME_ORDER.slice();
    for (let i = order.length - 1; i > 0; i--) {
      const j = Math.floor(rand() * (i + 1));
      [order[i], order[j]] = [order[j], order[i]];
    }
    this.biomes = [{ z0: -Infinity, id: order[0] }];
    let z = 2000 + rand() * 1200;
    let i = 1;
    while (z < this.length - 800) {
      this.biomes.push({ z0: z, id: order[i % order.length] });
      i++;
      z += 2400 + rand() * 1200;
    }
  }

  // The biome at z: { a, b, t } (from a toward b by t, 0..1, near a boundary).
  biomeAt(z) {
    const list = this.biomes;
    let i = 0;
    while (i + 1 < list.length && list[i + 1].z0 <= z) i++;
    const cur = list[i];
    const nx = list[i + 1];
    if (nx && z > nx.z0 - BIOME_BLEND / 2) return { a: cur.id, b: nx.id, t: smooth(nx.z0 - BIOME_BLEND / 2, nx.z0 + BIOME_BLEND / 2, z) };
    const pv = list[i - 1];
    if (pv && z < cur.z0 + BIOME_BLEND / 2) return { a: pv.id, b: cur.id, t: smooth(cur.z0 - BIOME_BLEND / 2, cur.z0 + BIOME_BLEND / 2, z) };
    return { a: cur.id, b: cur.id, t: 0 };
  }

  // The biome a column is made of (a dithered edge between two).
  biomeOfColumn(x, z, row) {
    if (row.bt <= 0) return row.ba;
    if (row.bt >= 1) return row.bb;
    return hash2(this.base ^ 0xb10e, x, z) < row.bt ? row.bb : row.ba;
  }

  // ---------- Open stretches (Round 16) ----------

  _makeOpens() {
    const rand = mulberry32((this.base ^ 0x0be7 ^ ((this.spec.opts & ~7) << 8)) >>> 0); // (not the biome: the same course in any scenery)
    const per = (CANYON_OPENS[this.spec.open] || CANYON_OPENS.some).per;
    this.opens = [];
    this.rocks = [];
    const L = this.length;
    // (Round 17) The Space scenery: the whole course out among the asteroids
    // (the mouth and the run-out still the course's rock, the start and the
    // finish gates in them); no valleys.
    if (this.spec.space) {
      this.opens.push({ kind: "space", z0: SPACE_FROM, z1: L - SPACE_FROM, i: 0 });
      this._makeRocks(rand);
      return;
    }
    if (!per) return;
    const n = Math.max(1, Math.round(L * per));
    const from = 1400;
    const to = L - 1300;
    if (to - from < 1200) return;
    // (Round 17) Valleys only between the canyons (space is a scenery of its own).
    rand();
    for (let i = 0; i < n; i++) {
      const kind = "valley";
      const len = 800 + rand() * 500;
      const mid = from + ((i + 0.5 + (rand() - 0.5) * 0.4) / n) * (to - from);
      const z0 = Math.round(mid - len / 2);
      const z1 = Math.round(mid + len / 2);
      if (this.opens.some((o) => z0 < o.z1 + 500 && z1 > o.z0 - 500)) continue;
      this.opens.push({ kind, z0, z1, i: this.opens.length });
    }
  }

  // The asteroids: lumpy rocks floating along the way through space, round
  // the course's line, a few big, most small.
  _makeRocks(rand) {
    for (const o of this.opens) {
      if (o.kind !== "space") continue;
      for (let z = o.z0 + 60; z < o.z1 - 40; z += 7 + rand() * 9) {
        const r = rand() < 0.12 ? 9 + rand() * 6 : 2.5 + rand() * 5;
        const x = this.centerX(z) + (rand() - 0.5) * 2 * (SPACE_HALF - 8);
        const y = 22 + rand() * 100;
        this.rocks.push({ x, y, z, r, ph: rand() * 6.28, b: Math.floor(rand() * ROCK_BLOCKS.length) });
      }
    }
  }

  // The open stretch at z (with a margin), or null.
  openAt(z, m = 0) {
    for (const o of this.opens) if (z > o.z0 - m && z < o.z1 + m) return o;
    return null;
  }

  // How far open the valley is at z (0: canyon, 1: the valley).
  _valley(z) {
    const o = this.openAt(z, VALLEY_RAMP);
    if (!o || o.kind !== "valley") return 0;
    return smooth(o.z0 - VALLEY_RAMP, o.z0, z) * (1 - smooth(o.z1, o.z1 + VALLEY_RAMP, z));
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
    if (z < 0) w += -z * 0.3;
    if (z > this.length) w += (z - this.length) * 0.5;
    // (a valley: wide open)
    const v = this._valley(z);
    if (v > 0) w += (Math.max(w, VALLEY_W) - w) * v;
    return w;
  }

  floorY(z) {
    return this.kind.floor + Math.round(this.noise.perlin2(z / 260, 9.1) * 2);
  }

  // The rim (the walls' top); a valley's low hills.
  rimY(z) {
    const rim = this.kind.rim + this.noise.perlin2(z / 640, 1.3) * 7;
    const v = this._valley(z);
    return v > 0 ? rim + (this.floorY(z) + 12 - rim) * v : rim;
  }

  // ---------- Features ----------

  _makeFeatures(rand) {
    const k = this.kind;
    const d = this.diff;
    const L = this.length;
    const per = (rate, from = 250, to = L - 250) => {
      const n = Math.round(((to - from) / 1000) * rate + rand() * 0.6);
      const out = [];
      for (let i = 0; i < n; i++) out.push(from + ((i + 0.2 + rand() * 0.6) / n) * (to - from));
      return out;
    };
    const open = (z, m) => !!this.openAt(z, m);
    // Narrows: the canyon pinches to a gap (the slot's to 9-11: a knife-edge pass).
    this.narrows = per(k.narrows, 400)
      .filter((z) => !open(z, 400))
      .map((z) => ({ z, len: 60 + rand() * 90, w: Math.max(k.minHalf, Math.max(9, k.wMin * (0.55 + rand() * 0.2)) * d.narrowW) }));
    // Fins: a blade of rock splitting the canyon (two lanes; over the top too, where it is low).
    this.fins = per(k.fins, 600)
      .filter((z) => !open(z, 500))
      .map((z) => ({ z0: z - 90 - rand() * 80, z1: z + 90 + rand() * 80, t: 4 + rand() * 5, lane: (20 + rand() * 8) * d.finLane, top: rand() < 0.4 ? k.rim - 28 - rand() * 20 : k.rim + 8 }));
    // Tunnels: the rock closes overhead.
    this.tunnels = per(k.tunnels, 900)
      .filter((z) => !open(z, 600))
      .map((z) => {
        const len = 160 + rand() * 260;
        return { z0: z - len / 2, z1: z + len / 2, ceil: Math.min(k.rim - 12, k.floor + (34 + rand() * 16) * d.tunnelH) };
      });
    const inTunnel = (z, m = 60) => this.tunnels.some((t) => z > t.z0 - m && z < t.z1 + m);
    const nearFin = (z, m = 80) => this.fins.some((f) => z > f.z0 - m && z < f.z1 + m);
    // Arches across the canyon (high or low: under or over them).
    this.arches = per(k.arches, 300)
      .filter((z) => !inTunnel(z) && !nearFin(z) && !open(z, 300))
      .map((z) => ({ z, y0: k.floor + 26 + rand() * 40, thick: 5 + rand() * 6, t: 5 + rand() * 5, drop: 10 + rand() * 14 }));
    // Pillars: hoodoos standing off the middle (a lane always beside them).
    this.pillars = [];
    for (const z of per(k.pillars, 200)) {
      if (inTunnel(z, 30) || nearFin(z, 40) || this.arches.some((a) => Math.abs(a.z - z) < 40) || open(z, 260)) continue;
      const off = (rand() < 0.5 ? -1 : 1) * (0.15 + rand() * 0.35);
      this.pillars.push({ z, off, x: this.centerX(z) + off * this.halfWidth(z), r: 3 + rand() * 3.5, top: k.rim - 6 - rand() * 50, ph: rand() * 6 });
    }
    // (Round 16) A valley's buttes: broad towers of rock to fly round.
    for (const o of this.opens) {
      if (o.kind !== "valley") continue;
      for (let z = o.z0 + 40; z < o.z1 - 40; z += 70 + rand() * 90) {
        const off = (rand() < 0.5 ? -1 : 1) * (0.3 + rand() * 0.45);
        this.pillars.push({ z, off, x: this.centerX(z) + off * VALLEY_W, r: 7 + rand() * 9, top: k.floor + 22 + rand() * 45, ph: rand() * 6, butte: true });
      }
    }
    // Waterfalls down a wall into the river.
    this.falls = per(k.falls, 300)
      .filter((z) => !inTunnel(z, 20) && !open(z, 300))
      .map((z) => ({ z: Math.floor(z), w: 2 + Math.floor(rand() * 3), side: rand() < 0.5 ? -1 : 1 }));
    // (features by z, for the rows: each with its z-range)
    const all = [];
    for (const f of this.fins) all.push({ kind: "fin", f, z0: f.z0 - 2, z1: f.z1 + 2 });
    for (const t of this.tunnels) all.push({ kind: "tunnel", f: t, z0: t.z0 - 50, z1: t.z1 + 50 });
    for (const a of this.arches) all.push({ kind: "arch", f: a, z0: a.z - a.t - 4, z1: a.z + a.t + 4 });
    for (const p of this.pillars) all.push({ kind: "pillar", f: p, z0: p.z - p.r - 6, z1: p.z + p.r + 6 });
    for (const w of this.falls) all.push({ kind: "fall", f: w, z0: w.z, z1: w.z + w.w - 1 });
    for (const r of this.rocks) all.push({ kind: "rock", f: r, z0: r.z - r.r * 1.3 - 1, z1: r.z + r.r * 1.3 + 1 });
    all.sort((a, b) => a.z0 - b.z0);
    this.feats = all;
    // (the longest reach of any feature back from its z0: the rows' scan starts there)
    this._featReach = 0;
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
  // the river and the features crossing it; (Round 16) its biome, its open
  // stretch, the band of heights to fly in (lo, hi) and where "out of the
  // course" begins (outY, outX: across from the line). Cached.
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
    const span = Math.max(8, rim - floor);
    const tilt = this.noise.perlin2(z / 400, 7.7) * 7 + z * 0.0007;
    const bio = this.biomeAt(z);
    const sa = this.strata[bio.a].recess;
    const sb = this.strata[bio.b].recess;
    const valley = this._valley(z);
    const L = new Float32Array(H);
    const R = new Float32Array(H);
    let xMin = Infinity;
    let xMax = -Infinity;
    const talus = k.talus;
    const top = Math.min(H - 2, Math.ceil(rim + 4 + valley * 12));
    const minW = k.minHalf;
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
      const rec = bio.t <= 0 ? sa[band] : sa[band] * (1 - bio.t) + sb[band] * bio.t;
      hw += rec * (t > 0.08 ? 1 : 0.3);
      const nl = this.wallL.perlin2(z / 21, y / 13) * 3.2 + this.wallL.perlin2(z / 6.5, y / 4.5) * 1.1;
      const nr = this.wallR.perlin2(z / 21, y / 13) * 3.2 + this.wallR.perlin2(z / 6.5, y / 4.5) * 1.1;
      // (never narrower than the difficulty allows, above the talus)
      const lim = y < floor + talus ? k.river + 1.5 : minW;
      L[y] = xc - Math.max(lim, hw + nl) * sec;
      R[y] = xc + Math.max(lim, hw + nr) * sec;
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
    const rocks = [];
    let fall = null;
    for (const e of feats) {
      if (e.kind === "fin") {
        fin = this._finHalf(e.f, z);
        finTop = e.f.top;
      } else if (e.kind === "tunnel") ceil = Math.min(ceil, this._tunnelCeil(e.f, z, rim));
      else if (e.kind === "arch" && Math.abs(z - e.f.z) <= e.f.t) arch = e.f;
      else if (e.kind === "pillar") pillars.push(e.f);
      else if (e.kind === "fall") fall = e.f;
      else if (e.kind === "rock") rocks.push(e.f);
    }
    // (Round 16) Space: the course's line through it (the canyon's walls
    // and floor end at a ragged cliff on either side of the stretch).
    const op = this.openAt(z, 30);
    const space = op && op.kind === "space" ? op : null;
    let lo = floor + 12;
    let hi = Math.min(rim, ceil) - 12;
    let outY = rim + 6;
    let outX = Infinity;
    let Wf = W;
    if (valley > 0) {
      hi += (floor + 72 - hi) * valley;
      lo += 3 * valley;
      outY += (floor + 150 - outY) * valley;
      if (valley > 0.3) outX = W * sec + 40;
    }
    if (space && z >= space.z0 && z <= space.z1) {
      lo = floor + 28;
      hi = k.rim - 14;
      outY = 160;
      outX = SPACE_HALF + 12;
      Wf = 55;
      xMin = Math.min(xMin, xc - SPACE_HALF - 6);
      xMax = Math.max(xMax, xc + SPACE_HALF + 6);
    }
    r = { z, xc, sl, sec, W: Wf, floor, rim, top, tilt, L, R, xMin, xMax, riverX, fin, finTop, ceil, arch, pillars, rocks, fall, space, valley, lo, hi, outY, outX, ba: bio.a, bb: bio.b, bt: bio.t, start: z >= -2 && z <= 1, finish: Math.abs(z - this.length) <= 1 };
    if (this._rows.size >= ROW_CACHE) this._rows.delete(this._rows.keys().next().value);
    this._rows.set(z, r);
    return r;
  }

  // The plateau's top in column (x, z) (a little rough; a valley's hills).
  plateauTop(x, z, row) {
    let t = row.rim + 1.5 + this.noise.perlin2(x / 17, z / 17) * 1.6;
    if (row.valley > 0) t += (this.noise.perlin2(x / 46, z / 46) * 9 + 4) * row.valley;
    return Math.floor(t);
  }

  // Is column x of a space row out in the void? (A ragged cliff edge.)
  _void(x, row) {
    const s = row.space;
    if (!s) return false;
    const e0 = s.z0 + this.noise.perlin2(x / 19, 3.3) * 14;
    const e1 = s.z1 + this.noise.perlin2(x / 19, 8.1) * 14;
    return row.z > e0 && row.z < e1;
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

  // 0 air, 1 wall/plateau rock, 2 feature rock, 3 river water, 4 floor, 5 an asteroid.
  _shape(x, y, r, top, isVoid) {
    const cx = x + 0.5;
    if (r.rocks.length) {
      for (const a of r.rocks) {
        const dx = cx - a.x;
        const dy = y + 0.5 - a.y;
        const dz = r.z + 0.5 - a.z;
        const rr = a.r * (0.82 + 0.13 * Math.sin(x * 0.61 + a.ph) * Math.cos(y * 0.53 - a.ph) + 0.1 * Math.sin(r.z * 0.47 + a.ph * 2));
        if (dx * dx + dy * dy * 1.25 + dz * dz <= rr * rr) return 5;
      }
    }
    if (isVoid ?? (r.space && this._void(x, r))) return 0;
    if (y === 0) return 1;
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
      const cap = y > p.top - 3 ? (p.butte ? 2.5 : 1.8) : 0;
      const rr = p.r * (1 + 0.18 * Math.sin(y * 0.35 + p.ph)) + cap + (y < r.floor + 6 ? (r.floor + 6 - y) * 0.6 : 0);
      const ddx = cx - px;
      const ddz = r.z + 0.5 - p.z;
      if (ddx * ddx + ddz * ddz <= rr * rr) return 2;
    }
    return 0;
  }

  // ---------- Rings ----------

  // The checkpoints of the course: [{ i, kind ("start" | "check" |
  // "finish"), x, y, z, yaw, r }], in order along it. yaw: the ring faces
  // along the canyon (the jet's yaw through it).
  rings() {
    if (this._rings) return this._rings;
    const k = this.kind;
    const rand = mulberry32((this.base ^ 0x7121e5) >>> 0);
    const out = [];
    const add = (kind, z, pick) => {
      z = Math.round(z);
      const row = this.row(z);
      const R = kind === "start" || kind === "finish" ? Math.min(18, row.W * 0.7) : k.ringR;
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
      const lo = row.lo + R - 8;
      const hi = Math.max(lo, row.hi - R + 6);
      const pref = [0.25, 0.55, 0.1, 0.8, 0.4];
      const start = Math.floor(rand() * pref.length);
      for (let i = 0; i < pref.length; i++) {
        const y = lo + (hi - lo) * pref[(start + i) % pref.length];
        for (const s of [lateral, 0, 0.3, -0.3, 0.55, -0.55]) list.push([row.xc + s * row.W * row.sec, y]);
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
      // (Round 16: the boost rings are gone; the draw kept so the rings stay where they were.)
      if (rand() < 0.4) rand();
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
      const rand = mulberry32((this.base ^ 0xaa6a) >>> 0);
      const n = Math.round((this.length / 1000) * k.turrets);
      for (let i = 0; i < n; i++) {
        const z = Math.round(600 + ((i + 0.3 + rand() * 0.4) / n) * (this.length - 1000));
        const side = rand() < 0.5 ? -1 : 1;
        if (this.tunnels.some((t) => z > t.z0 - 60 && z < t.z1 + 60) || this.openAt(z, 300)) continue;
        const row = this.row(z);
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

  // ---------- A way through (Round 16: the enemy jets' autopilot) ----------

  // A point at z (to the nearest 8 blocks) a jet can fly through: near the
  // middle of the band of heights to fly in, moved up, down or sideways
  // round whatever is in the way (an arch, a pillar, a fin, an asteroid).
  // { x, y } (cached).
  safePoint(z) {
    const zz = Math.round(z / 8) * 8;
    let p = this._safe.get(zz);
    if (p) return p;
    const row = this.row(zz);
    const lo = row.lo + 4;
    const hi = Math.max(lo, row.hi - 4);
    const y0 = lo + (hi - lo) * 0.42;
    const half = Math.min(row.W, 60) * row.sec;
    p = null;
    // (room for a wingspan and an autopilot's error; in the tightest spots, less)
    for (const m of [12, 7]) {
      for (const dy of [0, 8, -8, 16, -16, 24, -24, 34, -34, 46]) {
        const y = y0 + dy;
        if (y < lo - 6 || y > hi + 8) continue;
        for (const s of [0, 0.25, -0.25, 0.5, -0.5, 0.7, -0.7]) {
          const x = row.xc + s * half;
          if (this._clear(x, y, zz, m)) {
            p = { x, y };
            break;
          }
        }
        if (p) break;
      }
      if (p) break;
    }
    if (!p) p = { x: row.xc, y: y0, blocked: true };
    if (this._safe.size > 4096) this._safe.delete(this._safe.keys().next().value);
    this._safe.set(zz, p);
    return p;
  }

  // Room for a jet at (x, y, z): its wingspan and a little more.
  _clear(x, y, z, m = 7) {
    return !this.solidAt(x, y, z) && !this.solidAt(x - m, y, z) && !this.solidAt(x + m, y, z) && !this.solidAt(x, y + 5, z) && !this.solidAt(x, y - 5, z) && !this.solidAt(x, y, z + 8) && !this.solidAt(x, y, z - 8);
  }

  // A jet's path from a to b clear of the rock: the line, and lines a
  // wingtip (r) to either side and a little above and below it.
  tubeClear(ax, ay, az, bx, by, bz, r = 6) {
    if (!this.lineClear(ax, ay, az, bx, by, bz)) return false;
    for (const [ox, oy] of [[r, 0], [-r, 0], [0, r * 0.6], [0, -r * 0.6]]) if (!this.lineClear(ax + ox, ay + oy, az, bx + ox, by + oy, bz, 6)) return false;
    return true;
  }

  // A straight line from a to b clear of the rock (sampled every few blocks).
  lineClear(ax, ay, az, bx, by, bz, step = 5) {
    const d = Math.hypot(bx - ax, by - ay, bz - az);
    const n = Math.max(1, Math.ceil(d / step));
    for (let i = 1; i <= n; i++) {
      const f = i / n;
      if (this.solidAt(ax + (bx - ax) * f, ay + (by - ay) * f, az + (bz - az) * f)) return false;
    }
    return true;
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
      const solidRow = !r.space && !r.rocks.length && (bx + S < r.xMin - 1 || bx > r.xMax + 1);
      for (let lx = 0; lx < S; lx++) {
        const x = bx + lx;
        const col = (lz << 4) | lx;
        const isVoid = !!r.space && c._void(x, r);
        const bid = c.biomeOfColumn(x, z, r);
        const B = CANYON_BIOMES[bid];
        const strata = c.strata[bid].id;
        if (isVoid) {
          // Space: nothing but the asteroids.
          if (!r.rocks.length) continue;
          for (let y = 1; y < H; y++) if (c._shape(x, y, r, 0, true) === 5) blocks[(y << 8) | col] = this._asteroid(x, y, z, r, seed);
          continue;
        }
        const top = Math.min(H - 1, c.plateauTop(x, z, r));
        const tiltX = (x - r.xc) * 0.012;
        if (solidRow) {
          for (let y = 0; y <= top; y++) blocks[(y << 8) | col] = this._rock(x, y, z, bandOff + tiltX, top, seed, strata, B);
          blocks[(top << 8) | col] = this._top(x, z, B, seed);
          this._decorTop(blocks, col, x, top, z, B, seed);
          if (B.trees) this._treesAt(blocks, col, x, z, seed);
          continue;
        }
        let prev = 1;
        for (let y = 0; y < H; y++) {
          const s = c._shape(x, y, r, top, false);
          if (s === 0) {
            // (a waterfall down this wall: water (lava) on the rock face)
            if (r.fall && prev === 1 && y > r.floor && y <= top) {
              const near = r.fall.side < 0 ? x + 0.5 - r.L[y] < 1.6 : r.R[y] - (x + 0.5) < 1.6;
              if (near) blocks[(y << 8) | col] = B.falls ?? BLOCK.WATER;
            }
            if (prev === 4 && y > r.floor) this._floorPlant(blocks, col, x, y, z, B, seed);
            else if (B.snowLayer && (prev === 1 || prev === 2) && y > r.floor && hash2(seed ^ 0x5a0, x * 3 + y, z) < 0.8) blocks[(y << 8) | col] = B.snowLayer;
            else if (prev === 1 && y === top + 1) this._decorTop(blocks, col, x, top, z, B, seed);
            prev = 0;
            continue;
          }
          let id;
          if (s === 5) id = this._asteroid(x, y, z, r, seed);
          else if (s === 3) id = B.river === ICE && y < r.floor ? BLOCK.WATER : B.river; // (a frozen river: ice over water)
          else if (s === 4) {
            const below = y < r.floor - 1;
            // (the floor in patches: the biome's ground, pale by the water, gravel bars)
            const n = c.noise.perlin2(x / 9, z / 9) + (hash2(seed ^ 0x77, x, z) - 0.5) * 0.25;
            const dr = Math.abs(x + 0.5 - r.riverX) - c.kind.river;
            const f = B.floor;
            id = below ? this._rock(x, y, z, bandOff + tiltX, top, seed, strata, B) : dr < 2.5 ? (n > 0.15 ? f[3] : f[1]) : n > 0.38 ? f[2] : n < -0.45 ? f[1] : f[0];
            // (grass under the ground's top is dirt)
            if (id === BLOCK.GRASS && !below && y < r.floor + 3 && c._shape(x, y + 1, r, top, false) !== 0) id = BLOCK.DIRT;
          } else {
            id = y === top && s === 1 ? this._top(x, z, B, seed) : this._rock(x, y, z, bandOff + tiltX, top, seed, strata, B);
            // Lumen crystals and glowstone where the rock meets the air: the
            // tunnels' ceilings always, a night course's walls too.
            if ((s === 2 && y >= r.ceil && y < r.ceil + 1.5) || glow) {
              const g = hash2(seed ^ 0x6170, x * 7 + y, z);
              if (g < (s === 2 && y >= r.ceil ? 0.03 : 0.0035) && this._exposed(x, y, z, r)) id = g < 0.0012 ? GLOWSTONE : g < 0.002 ? SHROOMLIGHT : BLOCK.LUMEN;
            } else if (B.moss && s === 1 && y > r.floor + 3 && y < top - 1) {
              // (green clinging to the walls)
              if (hash2(seed ^ 0x3055, x * 5 + y, z) < B.mossP && this._exposed(x, y, z, r)) id = B.moss;
            } else if (B.glow && s === 1 && y > r.floor + 2 && hash2(seed ^ 0x6a6, x * 5 + y, z) < B.glowP && this._exposed(x, y, z, r)) id = B.glow;
          }
          // (the start's and the finish's checkered banners on the walls)
          if ((r.start || r.finish) && s === 1 && y > r.floor + 8 && y < r.rim - 4 && this._exposed(x, y, z, r)) id = ((Math.floor(y / 3) + (z & 1) + (x & 1)) & 1) === 0 ? BLACK_CONCRETE : WHITE_CONCRETE;
          blocks[(y << 8) | col] = id;
          prev = s === 3 ? 3 : s === 4 ? 4 : s === 5 ? 5 : 1;
        }
        if (B.trees && (r.valley > 0.5 || x + 0.5 < r.L[Math.min(H - 1, top)] - 1 || x + 0.5 > r.R[Math.min(H - 1, top)] + 1)) this._treesAt(blocks, col, x, z, seed);
      }
    }
  }

  // The plateau's top block.
  _top(x, z, B, seed) {
    if (B.topAlt && hash2(seed ^ 0x70a1, x, z) < 0.3) return B.topAlt;
    return B.top;
  }

  // On the plateau: a plant now and then, snow.
  _decorTop(blocks, col, x, top, z, B, seed) {
    if (top + 1 >= H) return;
    const i = ((top + 1) << 8) | col;
    if (blocks[i]) return;
    if (B.snowLayer) {
      blocks[i] = B.snowLayer;
      return;
    }
    if (B.topPlant && hash2(seed ^ 0xdb, x, z) < B.topPlantP) {
      blocks[i] = B.topPlant;
      if (B.topPlant === BLOCK.CACTUS && top + 2 < H && hash2(seed ^ 0xdc, x, z) < 0.5) blocks[((top + 2) << 8) | col] = BLOCK.CACTUS;
    }
  }

  // On the canyon's floor: the biome's plants (a cactus, flowers).
  _floorPlant(blocks, col, x, y, z, B, seed) {
    if (B.snowLayer) {
      blocks[(y << 8) | col] = B.snowLayer;
      return;
    }
    const h = hash2(seed ^ 0x5b, x, z);
    if (B.cactusP && h < B.cactusP) {
      const n = 1 + Math.floor(hash2(seed ^ 0x5c, x, z) * 3);
      for (let k = 0; k < n && y + k < H; k++) blocks[((y + k) << 8) | col] = BLOCK.CACTUS;
      return;
    }
    if (B.flowers && h > 1 - 0.02) {
      blocks[(y << 8) | col] = B.flowers[Math.floor(hash2(seed ^ 0x5d, x, z) * B.flowers.length)];
      return;
    }
    if (B.plant && h < B.plantP + (B.cactusP || 0)) blocks[(y << 8) | col] = B.plant;
  }

  // Trees (the biome's: round oaks, pine cones) whose crowns reach this
  // column: a tree in some cells of a 7-block grid, on the plateau (or a
  // valley's floor), never over the canyon.
  _treesAt(blocks, col, x, z, seed) {
    const cx = Math.floor(x / 7);
    const cz = Math.floor(z / 7);
    for (let i = -1; i <= 1; i++) {
      for (let j = -1; j <= 1; j++) {
        const t = this._tree(cx + i, cz + j, seed);
        if (!t) continue;
        const dx = x - t.x;
        const dz = z - t.z;
        if (Math.abs(dx) > 3 || Math.abs(dz) > 3) continue;
        const T = t.spec;
        const top = t.base + t.h;
        if (dx === 0 && dz === 0) for (let y = t.base + 1; y < top && y < H; y++) blocks[(y << 8) | col] = T.log;
        for (let y = t.base + 2; y <= top + 1 && y < H; y++) {
          let rl;
          if (T.kind === "cone") rl = y > top ? 0 : Math.min(3, Math.floor((top + 1 - y) / 2.4));
          else rl = y > top ? 0 : y === top ? 1 : y >= top - 3 ? 2 : -1;
          if (rl < 0 || Math.abs(dx) > rl || Math.abs(dz) > rl) continue;
          if (rl >= 2 && Math.abs(dx) === rl && Math.abs(dz) === rl && hash2(seed ^ 0x7ee, x + y, z) < 0.6) continue;
          const k = (y << 8) | col;
          if (!blocks[k] || (blocks[k] >= SNOW_LAYER && blocks[k] < SNOW_LAYER + 8)) blocks[k] = T.leaves;
        }
      }
    }
  }

  // The tree of a grid cell, or null (cached).
  _tree(cx, cz, seed) {
    const key = cx * 100003 + cz;
    const cache = this.course._trees;
    if (cache.has(key)) return cache.get(key);
    let t = null;
    const x = cx * 7 + 1 + Math.floor(hash2(seed ^ 0x7e1, cx, cz) * 5);
    const z = cz * 7 + 1 + Math.floor(hash2(seed ^ 0x7e2, cx, cz) * 5);
    const c = this.course;
    const r = c.row(z);
    const B = CANYON_BIOMES[c.biomeOfColumn(x, z, r)];
    if (B.trees && hash2(seed ^ 0x7e3, cx, cz) < B.trees.p && !(r.space && c._void(x, r))) {
      const top = c.plateauTop(x, z, r);
      const yt = Math.min(H - 1, top);
      const out = x + 0.5 < r.L[yt] - 3 || x + 0.5 > r.R[yt] + 3;
      let base = -1;
      if (out) base = top;
      else if (r.valley > 0.5 && Math.abs(x + 0.5 - r.riverX) > c.kind.river + 4) {
        for (let y = Math.min(H - 2, top); y > 0; y--) {
          const s = c._shape(x, y, r, top, false);
          if (s === 4 || s === 1) {
            base = y;
            break;
          }
          if (s !== 0) break;
        }
        // (none on a butte or a ledge: on the ground only)
        if (base > r.floor + 12) base = -1;
      }
      if (base > 0) {
        const T = B.trees;
        t = { x, z, base, h: T.h[0] + Math.floor(hash2(seed ^ 0x7e4, cx, cz) * (T.h[1] - T.h[0] + 1)), spec: T };
        if (t.base + t.h + 2 >= H) t = null;
      }
    }
    if (cache.size > 20000) cache.clear();
    cache.set(key, t);
    return t;
  }

  // An asteroid's block: dark rock, a vein of glowing crystal now and then.
  _asteroid(x, y, z, r, seed) {
    const h = hash2(seed ^ 0xa57e, x * 7 + y, z);
    if (h < 0.025) return BLOCK.LUMEN;
    if (h < 0.04) return MAGMA_BLOCK;
    return ROCK_BLOCKS[Math.floor(hash2(seed ^ 0xa57f, Math.floor(x / 5), Math.floor(z / 5) + y * 17) * ROCK_BLOCKS.length)];
  }

  // Rock at (x, y, z): its stratum, a little mixed; bedrock at the bottom; the
  // biome's cap under the plateau's top.
  _rock(x, y, z, off, top, seed, strata, B) {
    if (y === 0) return BLOCK.BEDROCK;
    if (y < 3) return BLOCK.STONE;
    if (top - y <= 2 && top - y >= 1) return B.cap;
    let b = Math.floor(y + off);
    // (a few blocks of the band above or below: the band edges ragged)
    const h = hash2(seed, x, z * 131 + y);
    if (h < 0.06) b += 1;
    else if (h > 0.95) b -= 1;
    b = b < 0 ? 0 : b > H + 63 ? H + 63 : b;
    return strata[b];
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
