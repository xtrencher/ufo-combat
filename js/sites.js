// Big sites: airports and cities. Pure, deterministic logic (no three.js),
// decided by hashes on a coarse grid so no chunk has to generate to know
// where one is, like villages (village.js).
//
// A site is a big flat rectangle: the terrain function itself is bent flat
// inside it (adjust(), called by TerrainGenerator._terrainInfo), so full
// detail chunks, distant terrain (LOD), mob spawning and everything else that
// asks for a height agree on a level pad with gentle slopes around it. On top
// of that, chunk generation places the structures (placeInChunk()):
//
//   airport: a runway (dark, with markings and edge lights; its length, width
//   and everything around it depend on the airport's size: a small field, a
//   regional airport or an international one), a taxiway with connectors, an
//   apron with two to five hangars (parked aircraft appear in front of them,
//   see airports.js), a control tower, fuel tanks and, at the bigger ones, a
//   terminal building and a radar. Some have a secured compound at the back
//   of the apron with an underground bunker (a ramp down into a hall): that
//   is where alien ships are hidden, guarded by armed soldiers.
//   city: a regional or international airport with a grid of streets and
//   buildings of every kind next to it: low houses, mid-rise blocks, parks
//   and downtown skyscrapers (glass towers with setbacks, crowns and
//   antennas, up to ~80 blocks tall).
//
// Local coordinates: u runs along the runway, v across it (the apron and the
// city lie on the +v side); the runway's centre is (u, v) = (0, 0). `axis`
// (0: u is world x, 1: u is world z) and `flip` (the side v points to)
// orient it in the world.
import { hash2, mulberry32 } from "./noise.js";
import { BLOCK } from "./blocks.js";
import { CHUNK_SIZE, WORLD_HEIGHT, SEA_LEVEL } from "./constants.js";

export const SITE_CELL = 1300; // grid cell a site candidate is picked from (Round 6: bigger cells and lower chances: airports are rarer)
const CITY_CHANCE = 0.22;
const AIRPORT_CHANCE = 0.28; // (in addition to the cities, which have an airport too)
const REACH = 520; // bounding radius of a site incl. its slopes: the site's centre keeps this far from the cell's edges
const BLEND = 30; // width of the slope from the pad down to the natural terrain
const MAX_SPREAD = 20; // the natural terrain under a site may vary this much (10th to 90th percentile)
const TRIES = 16;
const KIND_SALT = 0x51a7e001;
const PLACE_SALT = 0x51a7e002;
const ORIENT_SALT = 0x51a7e003;
const SIZE_SALT = 0x51a7e004;

// The smallest runway's half length (what older callers assume); each site
// has its own: `site.half`, and `site.rw` for its half width.
export const RUNWAY_HALF = 130;
export const RUNWAY_HALF_WIDTH = 7;

// The sizes of airport. half: half the runway length; rw: half its width;
// apronHalfW / apronD: the apron's half width along the runway and its depth;
// hangars, tanks, parking: how many; tower: the control tower's height;
// terminal / radar: whether there is one; bunker: the chance of a bunker.
const AIRPORT_SIZES = {
  // (Round 8: wider runways, for the B-2's 44-block wing.)
  field: { half: 300, rw: 14, apronHalfW: 82, apronD: 48, hangars: 2, tanks: 3, parking: 2, tower: 20, terminal: false, radar: false, bunker: 0.35 },
  regional: { half: 380, rw: 16, apronHalfW: 112, apronD: 62, hangars: 3, tanks: 4, parking: 3, tower: 26, terminal: true, radar: false, bunker: 0.6 },
  international: { half: 460, rw: 18, apronHalfW: 150, apronD: 72, hangars: 4, tanks: 6, parking: 5, tower: 34, terminal: true, radar: true, bunker: 0.95 },
};

const CITY_V_GAP = 6; // between the apron and the first street of the city
const LOT = 32; // city grid pitch (24 lot + 8 street)
const BUNKER_H = 10; // clear height of the bunker hall
const BUNKER_RAMP = 24; // length of the ramp down (a drop of 12)

const ROOFS = [BLOCK.COBBLESTONE, BLOCK.STONE, BLOCK.BRICKS];
const WALLS = [BLOCK.STONE, BLOCK.BRICKS, BLOCK.TERRACOTTA, BLOCK.PLANKS, BLOCK.COBBLESTONE, BLOCK.WOOL];
const TOWER_WALLS = [BLOCK.STONE, BLOCK.COBBLESTONE, BLOCK.BRICKS];

function smooth(t) {
  t = Math.max(0, Math.min(1, t));
  return t * t * (3 - 2 * t);
}

export class SiteGrower {
  // terrain: the TerrainGenerator (its _baseInfo is the natural terrain).
  constructor(terrain) {
    this.terrain = terrain;
    this.seed = terrain.seed;
    this._cells = new Map(); // numeric key -> site or null
    this.any = true;
  }

  _key(cx, cz) {
    return (cx + 4096) * 8192 + (cz + 4096);
  }

  // ---------- Where the sites are ----------

  _site(cx, cz) {
    this._ensureHome();
    // The home airport belongs to the cell its centre is in.
    if (this.home && Math.floor(this.home.x / SITE_CELL) === cx && Math.floor(this.home.z / SITE_CELL) === cz) return this.home;
    const key = this._key(cx, cz);
    if (this._cells.has(key)) return this._cells.get(key);
    const site = this._make(cx, cz);
    this._cells.set(key, site);
    if (this._cells.size > 500) this._cells.delete(this._cells.keys().next().value);
    return site;
  }

  _make(cx, cz) {
    const roll = hash2((this.seed ^ KIND_SALT) >>> 0, cx, cz);
    if (roll >= CITY_CHANCE + AIRPORT_CHANCE) return null;
    const kind = roll < CITY_CHANCE ? "city" : "airport";
    const terrain = this.terrain;
    const sizeRoll = hash2((this.seed ^ SIZE_SALT) >>> 0, cx, cz);
    const sizeName = kind === "city" ? (sizeRoll < 0.6 ? "regional" : "international") : sizeRoll < 0.45 ? "field" : sizeRoll < 0.8 ? "regional" : "international";
    for (let t = 0; t < TRIES; t++) {
      const jx = hash2((this.seed ^ PLACE_SALT) >>> 0, cx * 16 + t, cz);
      const jz = hash2((this.seed ^ PLACE_SALT ^ 0x9e37) >>> 0, cx * 16 + t, cz);
      const x = cx * SITE_CELL + REACH + Math.floor(jx * (SITE_CELL - REACH * 2));
      const z = cz * SITE_CELL + REACH + Math.floor(jz * (SITE_CELL - REACH * 2));
      const axis = hash2((this.seed ^ ORIENT_SALT) >>> 0, cx * 16 + t, cz) < 0.5 ? 0 : 1;
      const flip = hash2((this.seed ^ ORIENT_SALT ^ 0x77) >>> 0, cx * 16 + t, cz) < 0.5 ? 1 : -1;
      const site = { kind, size: sizeName, x, z, axis, flip, rect: null, y: 0, seed: (this.seed ^ Math.imul(x, 0x9e3779b1) ^ Math.imul(z, 0x85ebca6b)) >>> 0, id: `${kind}:${x},${z}` };
      if (!this._fits(site)) continue;
      if (this.home && Math.hypot(x - this.home.x, z - this.home.z) < 1700) return null; // (the home airport has its space: the other sites are at least this far from it)
      return site;
    }
    return null;
  }

  // Plans the site and checks the natural terrain under it: mostly dry land,
  // fairly gentle (a few outliers are levelled or filled) and low enough.
  // On success sets site.y (and the city lots) and returns true.
  _fits(site, { spread = MAX_SPREAD, coarse = 1 } = {}) {
    const terrain = this.terrain;
    this._plan(site);
    const rect = site.rect;
    const hs = [];
    let wet = 0;
    let mountain = 0;
    // (the sample count up front, so a try that is too wet or too mountainous
    // stops as soon as that is certain: the same answer, sooner)
    let nu = 0;
    let nv = 0;
    for (let u = rect.u0; u <= rect.u1; u += 25 * coarse) nu++;
    for (let v = rect.v0; v <= rect.v1; v += 24 * coarse) nv++;
    const total = nu * nv;
    for (let u = rect.u0; u <= rect.u1; u += 25 * coarse) {
      for (let v = rect.v0; v <= rect.v1; v += 24 * coarse) {
        const [wx, wz] = this.toWorld(site, u, v);
        const info = terrain._baseInfo(wx, wz);
        if (info.height <= SEA_LEVEL + 1) wet++;
        if (info.mountainT > 0.5) mountain++;
        hs.push(info.height);
        if (wet / total > 0.3 || mountain / total > 0.3) return false;
      }
    }
    hs.sort((a, b) => a - b);
    const n = hs.length;
    if (wet / n > 0.3 || mountain / n > 0.3) return false;
    if (hs[Math.floor(n * 0.9)] - hs[Math.floor(n * 0.1)] > spread) return false;
    const median = hs[Math.floor(n / 2)];
    const limit = site.kind === "city" ? SEA_LEVEL + 16 : SEA_LEVEL + 22;
    if (median > limit) return false;
    site.y = Math.max(SEA_LEVEL + 4, median);
    if (coarse > 1) return true; // (a quick pre-check: the real one follows)
    if (site.kind === "city") site.lots = this._lots(site);
    // (A bunker needs room below the pad: not on the very low ground.)
    if (site.y < SEA_LEVEL + 14) site.bunkers = [];
    return true;
  }

  // The home airport: one airport (regional or international, never a small
  // field) close to where a new player starts, whatever the seed. The spawn
  // is the first dry land from the world's origin (terrain.spawnColumn); the
  // airport is the nearest flat, dry spot to it that leaves the start itself
  // clear (at least ~80 blocks outside the levelled pad). The grid cells
  // around it give up their own sites where they would overlap it. Computed
  // once, on first use, from the natural terrain only.
  _ensureHome() {
    if (this._homeDone) return;
    this._homeDone = true;
    this.home = null;
    const terrain = this.terrain;
    // Where the start is (natural terrain, like spawnColumn without trees).
    let bx = 0;
    let bz = 0;
    for (let i = 0; i < 400 && terrain._baseInfo(bx, bz).height <= SEA_LEVEL + 1; i++) {
      const a = i * 0.5;
      const r = 40 + i * 18;
      bx = Math.round(Math.cos(a) * r);
      bz = Math.round(Math.sin(a) * r);
    }
    this.anchor = { x: bx, z: bz };
    const sizeName = hash2((this.seed ^ SIZE_SALT ^ 0x4f4d) >>> 0, 7, 11) < 0.5 ? "regional" : "international";
    for (let r = 260; r <= 2600; r += r < 1100 ? 60 : 100) {
      // (Rough country: if nothing flat enough lies within ~1100 blocks, the search goes on farther and takes more levelling.)
      const spread = r < 1100 ? MAX_SPREAD : MAX_SPREAD * 1.7;
      const n = r < 1100 ? 28 : 40;
      const a0 = hash2((this.seed ^ PLACE_SALT ^ 0x4f4d) >>> 0, r, 3) * Math.PI * 2;
      for (let k = 0; k < n; k++) {
        const a = a0 + (k / n) * Math.PI * 2;
        const x = Math.round(bx + Math.cos(a) * r);
        const z = Math.round(bz + Math.sin(a) * r);
        for (let o = 0; o < 2; o++) {
          const axis = o === 0 ? (hash2((this.seed ^ ORIENT_SALT) >>> 0, x, z) < 0.5 ? 0 : 1) : 1 - (hash2((this.seed ^ ORIENT_SALT) >>> 0, x, z) < 0.5 ? 0 : 1);
          const flip = hash2((this.seed ^ ORIENT_SALT ^ 0x77) >>> 0, x, z) < 0.5 ? 1 : -1;
          const site = { kind: "airport", size: sizeName, home: true, x, z, axis, flip, rect: null, y: 0, seed: (this.seed ^ Math.imul(x, 0x9e3779b1) ^ Math.imul(z, 0x85ebca6b)) >>> 0, id: `airport:${x},${z}` };
          if (!this._fits(site, { spread, coarse: 2 })) continue;
          // The start must lie clear of the levelled pad and its slopes.
          const [u, v] = this.toLocal(site, bx, bz);
          if (this._outside(site, u, v) < 90) continue;
          if (!this._fits(site, { spread })) continue;
          this.home = site;
          return;
        }
      }
    }
  }

  // The layout of a site (everything that depends only on its seed): the
  // runway, apron, hangars, tower, terminal, tanks, bunkers, and the
  // rectangle that is levelled.
  _plan(site) {
    const S = AIRPORT_SIZES[site.size];
    const rand = mulberry32(site.seed ^ 0x1a77);
    const half = S.half;
    const rw = S.rw;
    site.half = half;
    site.rw = rw;
    const side = rand() < 0.5 ? -1 : 1; // which end of the apron the tower stands at
    const ao = Math.round((rand() - 0.5) * half * 0.3); // the apron's offset along the runway
    const apron = { u0: ao - S.apronHalfW, u1: ao + S.apronHalfW, v0: rw + 6, v1: rw + 6 + S.apronD };
    site.apron = apron;
    // Hangars along the back of the apron: standard ones with the big doorway
    // facing the runway (the end with the tower is left free).
    const hw = 14;
    const nh = S.hangars;
    const a0 = side > 0 ? apron.u0 + hw + 4 : apron.u0 + 44;
    const a1 = side > 0 ? apron.u1 - 44 : apron.u1 - hw - 4;
    site.hangars = [];
    for (let i = 0; i < nh; i++) {
      const uc = Math.round(nh === 1 ? (a0 + a1) / 2 : a0 + (i * (a1 - a0)) / (nh - 1));
      const depth = 17 + Math.floor(rand() * 4);
      site.hangars.push({ uc, u0: uc - hw, u1: uc + hw, v0: apron.v1 - depth - 2, v1: apron.v1 - 2, h: 11 + Math.floor(rand() * 5), id: i });
    }
    // The tower at one end of the apron's front edge; a terminal beside it.
    const tu = side > 0 ? apron.u1 - 22 : apron.u0 + 16;
    site.tower = { u0: tu, u1: tu + 5, v0: rw + 16, v1: rw + 21, h: S.tower, wall: TOWER_WALLS[Math.floor(rand() * TOWER_WALLS.length)], cab: Math.floor(rand() * 2) };
    if (S.terminal) {
      const tw = half >= 250 ? 46 : 34; // half length
      const tc = Math.max(apron.u0 + tw + 4, Math.min(apron.u1 - tw - 36, ao - side * 20));
      site.terminal = { u0: tc - tw, u1: tc + tw, v0: rw + 30, v1: rw + 44, h: 8 + (half >= 250 ? 2 : 0), id: 0 };
    } else site.terminal = null;
    // Fuel tanks off the end of the apron (away from the tower).
    site.tanks = [];
    const tk0 = side > 0 ? apron.u0 - 12 : apron.u1 + 12;
    for (let i = 0; i < S.tanks; i++) site.tanks.push({ u: tk0 - side * (i % 3) * 11, v: rw + 14 + Math.floor(i / 3) * 11 + 2, r: 3.6, h: 7 });
    site.radar = S.radar ? { u: side > 0 ? apron.u0 + 14 : apron.u1 - 14, v: rw + 26, r: 5 } : null;
    // Parked aircraft: in front of the hangars (nose toward the runway), more at the bigger airports.
    site.parking = [];
    const pv = rw + 20;
    const spots = [];
    for (let i = 0; i < nh; i++) spots.push(site.hangars[i].uc);
    for (let i = 0; i < S.parking; i++) site.parking.push({ u: spots[i % spots.length] + (i >= spots.length ? 18 : 0), v: pv });
    // Bunkers: a secured compound behind the apron with a hall under the ground.
    site.bunkers = [];
    if (site.kind === "airport" && rand() < S.bunker) {
      const nb = site.size === "international" && rand() < 0.5 ? 2 : 1;
      for (let i = 0; i < nb; i++) {
        const uc = Math.round(nb === 1 ? ao + (rand() - 0.5) * S.apronHalfW : ao + (i ? 1 : -1) * (S.apronHalfW * 0.45) + (rand() - 0.5) * 12);
        const vc0 = apron.v1 + 6;
        const rv0 = vc0 + 3; // where the ramp starts (at the surface)
        site.bunkers.push({
          id: i,
          uc,
          // The compound: a walled yard.
          cu0: uc - 25,
          cu1: uc + 25,
          cv0: vc0,
          cv1: vc0 + 50,
          // The ramp (15 wide, going down toward +v), and the hall at its foot.
          ru0: uc - 7,
          ru1: uc + 7,
          rv0,
          rv1: rv0 + BUNKER_RAMP - 1,
          hu0: uc - 12,
          hu1: uc + 12,
          hv0: rv0 + BUNKER_RAMP,
          hv1: rv0 + BUNKER_RAMP + 21,
        });
      }
    }
    // The levelled rectangle.
    let v1 = apron.v1 + 6;
    if (site.bunkers.length) v1 = Math.max(v1, site.bunkers[0].cv1 + 4);
    let u0 = -(half + 24);
    let u1 = half + 24;
    if (site.kind === "city") {
      site.cols = site.size === "international" ? 12 : 9;
      site.rows = 4;
      site.cityV0 = apron.v1 + CITY_V_GAP;
      v1 = Math.max(v1, site.cityV0 + 8 + site.rows * LOT);
      const cw = (site.cols * LOT + 8) / 2;
      u0 = Math.min(u0, -cw - 6);
      u1 = Math.max(u1, cw + 6);
    }
    // Wide aprons / bunker compounds must stay inside the levelled rectangle.
    u0 = Math.min(u0, apron.u0 - 6);
    u1 = Math.max(u1, apron.u1 + 6);
    for (const k of site.tanks) {
      u0 = Math.min(u0, k.u - 6);
      u1 = Math.max(u1, k.u + 6);
    }
    if (site.bunkers.length) {
      for (const b of site.bunkers) {
        u0 = Math.min(u0, b.cu0 - 4);
        u1 = Math.max(u1, b.cu1 + 4);
      }
    }
    site.rect = { u0, u1, v0: -(rw + 13), v1 };
  }

  // The building lots of a city grid: [{ m, k, kind, u0, u1, v0, v1, boxes, wall, roof, doorSide, ... }].
  // A box is a stack level of a building: { u0, u1, v0, v1, y0, y1 } (the
  // blocks above y0 up to and with y1).
  _lots(site) {
    const rand = mulberry32(site.seed ^ 0xc17e);
    const lots = [];
    const cols = site.cols;
    const rows = site.rows;
    const centerU = (rand() - 0.5) * 60;
    const centerV = site.cityV0 + 8 + (rows * LOT) / 2 - 10;
    const maxH = Math.max(10, WORLD_HEIGHT - 4 - site.y - 6);
    const u00 = -(cols * LOT) / 2 + 8;
    for (let k = 0; k < rows; k++) {
      for (let m = 0; m < cols; m++) {
        const lu0 = Math.round(u00 + m * LOT);
        const lv0 = site.cityV0 + 8 + k * LOT;
        const kindRoll = rand();
        const w = 12 + Math.floor(rand() * 11); // 12-22
        const d = 12 + Math.floor(rand() * 11);
        const u0 = lu0 + Math.floor((24 - w) / 2 + (rand() - 0.5) * 2);
        const v0 = lv0 + Math.floor((24 - d) / 2 + (rand() - 0.5) * 2);
        const cu = u0 + w / 2;
        const cv = v0 + d / 2;
        const dist = Math.hypot((cu - centerU) / 1.5, (cv - centerV) * 1.3);
        const downtown = Math.max(0, 1 - dist / 150);
        const wall = WALLS[Math.floor(rand() * WALLS.length)];
        const roof = ROOFS[Math.floor(rand() * ROOFS.length)];
        const doorSide = rand() < 0.5 ? "v0" : "v1";
        let kind = "midrise";
        let h = 8 + Math.floor(rand() * 12);
        if (kindRoll < 0.09) kind = "park";
        else if (kindRoll < 0.3 && downtown < 0.5) {
          kind = "house";
          h = 5 + Math.floor(rand() * 3);
        } else if (downtown > 0.35 && rand() < 0.35 + downtown * 0.6) {
          kind = "skyscraper";
          h = Math.round(24 + downtown * (34 + rand() * 24) + rand() * 8);
        } else h = Math.round(8 + downtown * 12 + rand() * 12);
        h = Math.min(h, maxH);
        const lot = { m, k, kind, u0, u1: u0 + w - 1, v0, v1: v0 + d - 1, h, wall, roof, doorSide, curtain: false, antenna: 0, boxes: [] };
        if (kind === "skyscraper") {
          // A podium, the tower with a setback or two, a crown and (the tallest) an antenna.
          lot.curtain = rand() < 0.75;
          lot.wall = lot.curtain ? [BLOCK.STONE, BLOCK.COBBLESTONE, BLOCK.BRICKS][Math.floor(rand() * 3)] : wall;
          const pod = 5 + Math.floor(rand() * 3);
          lot.boxes.push({ u0, u1: u0 + w - 1, v0, v1: v0 + d - 1, y0: 0, y1: pod });
          const i1 = 1 + Math.floor(rand() * 2);
          const h1 = Math.max(pod + 8, Math.round(h * (0.55 + rand() * 0.15)));
          lot.boxes.push({ u0: u0 + i1, u1: u0 + w - 1 - i1, v0: v0 + i1, v1: v0 + d - 1 - i1, y0: pod, y1: h1 });
          if (h > h1 + 8 && w > 14 && d > 14) {
            const i2 = i1 + 2;
            lot.boxes.push({ u0: u0 + i2, u1: u0 + w - 1 - i2, v0: v0 + i2, v1: v0 + d - 1 - i2, y0: h1, y1: h });
          } else lot.boxes[1].y1 = h;
          if (h > 46 && rand() < 0.7) lot.antenna = 6 + Math.floor(rand() * 7);
        } else if (kind === "midrise" || kind === "house") {
          lot.boxes.push({ u0, u1: u0 + w - 1, v0, v1: v0 + d - 1, y0: 0, y1: h });
        }
        lots.push(lot);
      }
    }
    return lots;
  }

  // The site whose bounding circle covers world column (wx, wz), or null.
  siteAt(wx, wz) {
    this._ensureHome();
    const h = this.home;
    if (h && Math.abs(wx - h.x) <= REACH && Math.abs(wz - h.z) <= REACH) return h;
    const cx = Math.floor(wx / SITE_CELL);
    const cz = Math.floor(wz / SITE_CELL);
    const s = this._site(cx, cz);
    if (!s) return null;
    if (Math.abs(wx - s.x) > REACH || Math.abs(wz - s.z) > REACH) return null;
    return s;
  }

  toLocal(site, wx, wz) {
    const dx = wx - site.x;
    const dz = wz - site.z;
    return site.axis === 0 ? [dx, dz * site.flip] : [dz, dx * site.flip];
  }

  toWorld(site, u, v) {
    return site.axis === 0 ? [site.x + u, site.z + v * site.flip] : [site.x + v * site.flip, site.z + u];
  }

  // World direction (unit, x/z) of the local +u and +v axes.
  dirU(site) {
    return site.axis === 0 ? [1, 0] : [0, 1];
  }
  dirV(site) {
    return site.axis === 0 ? [0, site.flip] : [site.flip, 0];
  }

  // Distance (blocks) from the local point to the site's flat rectangle: 0 inside.
  _outside(site, u, v) {
    const r = site.rect;
    const du = Math.max(r.u0 - u, 0, u - r.u1);
    const dv = Math.max(r.v0 - v, 0, v - r.v1);
    return Math.hypot(du, dv);
  }

  // The terrain height of column (wx, wz), bent toward the pad near a site.
  adjust(wx, wz, h) {
    const s = this.siteAt(wx, wz);
    if (!s) return h;
    const [u, v] = this.toLocal(s, wx, wz);
    const d = this._outside(s, u, v);
    if (d >= BLEND) return h;
    const w = smooth(1 - d / BLEND);
    return Math.floor(h * (1 - w) + s.y * w + 0.5);
  }

  // Whether the column lies within `margin` blocks of a site's flat rectangle
  // (trees and villages keep out of these).
  covers(wx, wz, margin = 0) {
    const s = this.siteAt(wx, wz);
    if (!s) return false;
    const [u, v] = this.toLocal(s, wx, wz);
    return this._outside(s, u, v) <= margin;
  }

  // ---------- Queries for the game ----------

  // The airport whose runway (the dark strip, with a margin) a world column lies on, or null.
  onRunway(wx, wz, margin = 0) {
    const s = this.siteAt(wx, wz);
    if (!s || s.kind === undefined || !s.rect) return null;
    const [u, v] = this.toLocal(s, wx, wz);
    return Math.abs(u) <= s.half + 2 + margin && Math.abs(v) <= s.rw + margin ? s : null;
  }

  // Every site within maxDist of (wx, wz) (the radar).
  // Like within(), but plans at most `ms` milliseconds' worth of new cells
  // per call (at least one) and leaves the rest for later calls: for queries
  // made every frame over a wide area (the radar), so a fast flight into new
  // cells does not stall a frame on many terrain surveys.
  withinCached(wx, wz, maxDist, ms = 3) {
    const out = [];
    const c0x = Math.floor((wx - maxDist) / SITE_CELL);
    const c1x = Math.floor((wx + maxDist) / SITE_CELL);
    const c0z = Math.floor((wz - maxDist) / SITE_CELL);
    const c1z = Math.floor((wz + maxDist) / SITE_CELL);
    this._ensureHome();
    const hx = this.home ? Math.floor(this.home.x / SITE_CELL) : NaN;
    const hz = this.home ? Math.floor(this.home.z / SITE_CELL) : NaN;
    const t0 = performance.now();
    let made = 0;
    for (let cz = c0z; cz <= c1z; cz++) {
      for (let cx = c0x; cx <= c1x; cx++) {
        if (!(cx === hx && cz === hz) && !this._cells.has(this._key(cx, cz))) {
          if (made > 0 && performance.now() - t0 > ms) continue;
          made++;
        }
        const s = this._site(cx, cz);
        if (s && Math.hypot(s.x - wx, s.z - wz) < maxDist) out.push(s);
      }
    }
    return out;
  }

  within(wx, wz, maxDist) {
    const out = [];
    const c0x = Math.floor((wx - maxDist) / SITE_CELL);
    const c1x = Math.floor((wx + maxDist) / SITE_CELL);
    const c0z = Math.floor((wz - maxDist) / SITE_CELL);
    const c1z = Math.floor((wz + maxDist) / SITE_CELL);
    for (let cz = c0z; cz <= c1z; cz++) {
      for (let cx = c0x; cx <= c1x; cx++) {
        const s = this._site(cx, cz);
        if (s && Math.hypot(s.x - wx, s.z - wz) < maxDist) out.push(s);
      }
    }
    return out;
  }

  // The nearest site (optionally of a kind) within maxDist of (wx, wz), or null.
  nearest(wx, wz, maxDist, kind = null) {
    let best = null;
    let bestD = maxDist;
    const c0x = Math.floor((wx - maxDist) / SITE_CELL);
    const c1x = Math.floor((wx + maxDist) / SITE_CELL);
    const c0z = Math.floor((wz - maxDist) / SITE_CELL);
    const c1z = Math.floor((wz + maxDist) / SITE_CELL);
    for (let cz = c0z; cz <= c1z; cz++) {
      for (let cx = c0x; cx <= c1x; cx++) {
        const s = this._site(cx, cz);
        if (!s || (kind && s.kind !== kind)) continue;
        const d = Math.hypot(s.x - wx, s.z - wz);
        if (d < bestD) {
          bestD = d;
          best = s;
        }
      }
    }
    return best;
  }

  // Both ends of a site's runway: [{ x, z, dx, dz, yaw, length, y }] (a takeoff
  // starts at (x, z) heading (dx, dz); yaw is the jet's heading for that).
  runwayEnds(site) {
    const [ux, uz] = this.dirU(site);
    const half = site.half ?? RUNWAY_HALF;
    const out = [];
    for (const s of [-1, 1]) {
      const [x, z] = this.toWorld(site, s * (half - 12), 0);
      const dx = -s * ux;
      const dz = -s * uz;
      out.push({ x: x + 0.5, z: z + 0.5, dx, dz, yaw: Math.atan2(-dx, -dz), length: half * 2 - 24, y: site.y + 1 });
    }
    return out;
  }

  // Round 8: the parking row along the front of the apron, worked out from
  // the layout so no slot touches a building: { fighters: [slot], bomber:
  // slot | null }, each slot { x, y, z, yaw, u, v, key }. Fighters stand 19
  // blocks apart (a 13-block wingspan and room to walk between); the B-2
  // (a 46-block wing) gets a 54-block stretch of its own. Deterministic
  // (from the site's plan alone), so every player gets the same slots.
  parkingSlots(site) {
    if (site._slots) return site._slots;
    const a = site.apron;
    const rw = site.rw;
    const vC = rw + 21; // the row's centre line (noses toward the runway)
    const band0 = vC - 10;
    const band1 = vC + 10;
    const blocked = [];
    const block = (u0, u1, v0, v1) => {
      if (v1 >= band0 && v0 <= band1) blocked.push([u0, u1]);
    };
    const t = site.tower;
    if (t) block(t.u0 - 6, t.u1 + 6, t.v0 - 4, t.v1 + 4);
    const tm = site.terminal;
    if (tm) block(tm.u0 - 3, tm.u1 + 3, tm.v0 - 2, tm.v1);
    const rd = site.radar;
    if (rd) block(rd.u - rd.r - 4, rd.u + rd.r + 4, rd.v - rd.r - 2, rd.v + rd.r + 2);
    for (const h of site.hangars || []) block(h.u0 - 2, h.u1 + 2, h.v0, h.v1);
    // The free stretches of the row.
    let free = [[a.u0 + 3, a.u1 - 3]];
    for (const [b0, b1] of blocked) {
      const next = [];
      for (const [f0, f1] of free) {
        if (b1 < f0 || b0 > f1) next.push([f0, f1]);
        else {
          if (b0 - 1 > f0) next.push([f0, b0 - 1]);
          if (b1 + 1 < f1) next.push([b1 + 1, f1]);
        }
      }
      free = next;
    }
    const [vx, vz] = this.dirV(site);
    const yaw = Math.atan2(vx, vz);
    const slot = (u, key) => {
      const [x, z] = this.toWorld(site, u, vC);
      return { x: x + 0.5, y: site.y + 1, z: z + 0.5, yaw, u, v: vC, key };
    };
    // The bomber: the start of the longest stretch.
    let bomber = null;
    free.sort((p, q) => q[1] - q[0] - (p[1] - p[0]));
    if (free.length && free[0][1] - free[0][0] >= 54) {
      const [f0, f1] = free[0];
      bomber = slot(f0 + 27, `${site.id}#b`);
      free[0] = [f0 + 55, f1];
    }
    // The fighters: as many as fit, in the order of the row.
    free.sort((p, q) => p[0] - q[0]);
    const fighters = [];
    for (const [f0, f1] of free) {
      for (let u = f0 + 9; u + 9 <= f1; u += 19) fighters.push(slot(u, `${site.id}#${fighters.length}`));
    }
    site._slots = { fighters, bomber };
    return site._slots;
  }

  // Where aircraft are parked: [{ x, y, z, yaw }] (nose toward the runway).
  parkingSpots(site) {
    const [vx, vz] = this.dirV(site);
    return (site.parking || []).map((p) => {
      const [x, z] = this.toWorld(site, p.u, p.v);
      return { x: x + 0.5, y: site.y + 1, z: z + 0.5, yaw: Math.atan2(vx, vz) };
    });
  }

  // The middle of each hangar's floor: [{ x, y, z, yaw, id }] (yaw: facing
  // out through the big doorway, toward the runway).
  hangarSpots(site) {
    const [vx, vz] = this.dirV(site);
    return (site.hangars || []).map((h) => {
      const [x, z] = this.toWorld(site, h.uc, Math.floor((h.v0 + h.v1) / 2));
      return { x: x + 0.5, y: site.y + 1, z: z + 0.5, yaw: Math.atan2(vx, vz), id: h.id, doorHeight: 9, height: h.h - 1 };
    });
  }

  // The bunkers of an airport: [{ id, x, y, z, yaw, zone: { x, z, r }, guards: [{ x, y, z }] }]: the
  // middle of the hall's floor (where an alien ship hovers; its nose out
  // toward the ramp), the restricted zone around it and where the guards
  // stand (at the top of the ramp, at the foot of it, inside).
  bunkerSpots(site) {
    const [vx, vz] = this.dirV(site);
    const yaw = Math.atan2(-vx, -vz);
    return (site.bunkers || []).map((b) => {
      const floorY = site.y - (BUNKER_RAMP >> 1) + 2; // (feet: on top of the floor block)
      const cvh = (b.hv0 + b.hv1) / 2;
      const [x, z] = this.toWorld(site, b.uc, cvh);
      const at = (u, v, y) => {
        const [wx, wz] = this.toWorld(site, u, v);
        return { x: wx + 0.5, y, z: wz + 0.5 };
      };
      const top = site.y + 1;
      const guards = [at(b.uc - 9, b.rv0 + 3, top), at(b.uc + 9, b.rv0 + 3, top), at(b.uc - 5, b.hv0 + 2, floorY), at(b.uc + 5, b.hv0 + 2, floorY)];
      if (site.size === "international") guards.push(at(b.uc - 9, cvh + 6, floorY), at(b.uc + 9, cvh + 6, floorY));
      const [zx, zz] = this.toWorld(site, b.uc, (b.cv0 + b.cv1) / 2);
      return { id: b.id, x: x + 0.5, y: floorY, z: z + 0.5, yaw, zone: { x: zx + 0.5, z: zz + 0.5, r: 46 }, guards };
    });
  }

  // A villager-style "settlement" description: { x, z, radius } near the
  // people (the apron of an airport, the middle of a city).
  settlement(site) {
    const mid = site.kind === "city" ? site.cityV0 + 8 + (site.rows * LOT) / 2 : (site.apron.v0 + site.apron.v1) / 2;
    const [x, z] = this.toWorld(site, 0, mid);
    return { x, z, groundY: site.y, radius: site.kind === "city" ? 120 : 60, kind: site.kind };
  }

  // The surface block of a column of a site (0: the natural surface), for
  // distant terrain: the runway, apron and streets read from afar.
  surfaceAt(wx, wz) {
    const s = this.siteAt(wx, wz);
    if (!s) return 0;
    const [u, v] = this.toLocal(s, wx, wz);
    if (this._outside(s, u, v) > 0) return 0;
    return this._surface(s, u, v);
  }

  // ---------- Surface and structures ----------

  // The surface block at local (u, v) inside the rectangle (0: natural).
  _surface(s, u, v) {
    const au = Math.abs(u);
    const half = s.half;
    const rw = s.rw;
    // The runway: dark, with a dashed centre line, edge lines, thresholds and edge lights.
    if (au <= half + 2 && Math.abs(v) <= rw) {
      const av = Math.abs(v);
      if (av === rw - 1 && au <= half - 2) return BLOCK.WOOL;
      if (v === 0 && au <= half - 14 && (((u + 1000) % 16) < 8)) return BLOCK.WOOL;
      if (au >= half - 10 && au <= half - 2 && av >= 1 && av <= rw - 2 && (av & 1) === 1) return BLOCK.WOOL;
      // Touchdown zone bars on the bigger runways.
      if (rw >= 8 && au >= half - 70 && au <= half - 52 && av >= 2 && av <= rw - 3 && ((au - (half - 70)) % 6) < 2) return BLOCK.WOOL;
      return BLOCK.BEDROCK;
    }
    // Runway edge lights (they glow at night).
    if (Math.abs(v) === rw + 2 && au <= half && ((u + 1200) % 12) === 0) return BLOCK.LUMEN;
    // Taxiway.
    if (v >= rw + 1 && v <= rw + 5 && au <= half - 6) return BLOCK.GRAVEL;
    // Connectors from the runway to the taxiway and the apron.
    if (v >= rw + 1 && v <= rw + 6 && (Math.abs(au - (half - 34)) <= 3 || au <= 3)) return BLOCK.GRAVEL;
    // Apron.
    const a = s.apron;
    if (v >= a.v0 && v <= a.v1 && u >= a.u0 && u <= a.u1) return (u + 1200) % 16 === 0 || (v & 15) === 0 ? BLOCK.GRAVEL : BLOCK.STONE;
    // The secured compounds behind the apron: a concrete yard.
    if (s.bunkers) {
      for (const b of s.bunkers) {
        if (u >= b.cu0 && u <= b.cu1 && v >= b.cv0 && v <= b.cv1) return (u + v) % 7 === 0 ? BLOCK.GRAVEL : BLOCK.STONE;
        // A road from the apron to the compound's gate.
        if (Math.abs(u - b.uc) <= 4 && v > a.v1 && v < b.cv0) return BLOCK.GRAVEL;
      }
    }
    if (s.kind === "city" && v >= s.cityV0 - 2) {
      const cv = v - s.cityV0;
      const cu = u + (s.cols * LOT) / 2;
      if (cu < 0 || cu >= s.cols * LOT + 8) return BLOCK.STONE;
      // Streets and sidewalks.
      const inStreetV = ((cv % LOT) + LOT) % LOT < 8;
      const inStreetU = ((Math.floor(cu) % LOT) + LOT) % LOT < 8;
      if (inStreetV || inStreetU) return BLOCK.GRAVEL;
      // A park's ground is grass; the other lots' is concrete.
      const lot = this._lotAt(s, u, v);
      return lot && lot.kind === "park" && u >= lot.u0 && u <= lot.u1 && v >= lot.v0 && v <= lot.v1 ? BLOCK.GRASS : BLOCK.STONE;
    }
    return 0;
  }

  // The city lot of the grid cell holding local (u, v), or null.
  _lotAt(s, u, v) {
    if (!s.lots) return null;
    const m = Math.floor((u - (-(s.cols * LOT) / 2 + 8) + 1) / LOT);
    const k = Math.floor((v - s.cityV0 - 8 + 1) / LOT);
    return m >= 0 && m < s.cols && k >= 0 && k < s.rows ? s.lots[k * s.cols + m] : null;
  }

  // Lists of solid structure boxes overlapping local (u, v).
  _structuresAt(s, u, v) {
    const out = [];
    if (s.hangars) {
      for (const h of s.hangars) if (u >= h.u0 && u <= h.u1 && v >= h.v0 && v <= h.v1) out.push({ t: "hangar", o: h });
    }
    const t = s.tower;
    if (t && u >= t.u0 - 3 && u <= t.u1 + 3 && v >= t.v0 - 3 && v <= t.v1 + 3) out.push({ t: "tower", o: t });
    const tm = s.terminal;
    if (tm && u >= tm.u0 && u <= tm.u1 && v >= tm.v0 && v <= tm.v1) out.push({ t: "terminal", o: tm });
    if (s.tanks) {
      for (const k of s.tanks) if (Math.hypot(u - k.u, v - k.v) <= k.r + 0.6) out.push({ t: "tank", o: k });
    }
    const rd = s.radar;
    if (rd && Math.hypot(u - rd.u, v - rd.v) <= rd.r + 1) out.push({ t: "radar", o: rd });
    if (s.bunkers) {
      for (const b of s.bunkers) if (u >= b.cu0 && u <= b.cu1 && v >= b.cv0 && v <= b.cv1) out.push({ t: "bunker", o: b });
    }
    if (s.lots) {
      // Lots are on a grid: find the one covering (u, v).
      const l = this._lotAt(s, u, v);
      if (l && u >= l.u0 - 1 && u <= l.u1 + 1 && v >= l.v0 - 1 && v <= l.v1 + 1) out.push({ t: l.kind, o: l });
      // Street lamps at the corners of the grid's blocks.
      const cu = Math.floor(u + (s.cols * LOT) / 2);
      const cv = v - s.cityV0;
      if (cv >= 0 && cu >= 0 && cu < s.cols * LOT + 8 && ((cu % LOT) + LOT) % LOT === 3 && ((cv % LOT) + LOT) % LOT === 3 && cv < s.rows * LOT + 8) out.push({ t: "lamp", o: null });
    }
    return out;
  }

  // Block at height y above the pad (y >= 1) of one structure, or 0 for nothing.
  _structureBlock(st, u, v, y) {
    const o = st.o;
    switch (st.t) {
      case "hangar": {
        const wall = u === o.u0 || u === o.u1 || v === o.v1 || v === o.v0;
        if (y > o.h) return 0;
        if (y === o.h) return BLOCK.STONE; // roof
        if (v === o.v0 && Math.abs(u - o.uc) <= 9 && y <= 9) return 0; // the big doorway, facing the runway
        if (wall) {
          if (y >= 6 && y <= 8 && v === o.v1 && (u - o.u0) % 5 !== 0) return BLOCK.GLASS;
          return y <= 2 ? BLOCK.COBBLESTONE : BLOCK.STONE;
        }
        if (y === 1 && (u - o.uc) % 8 === 0 && (v - o.v0) % 6 === 3) return BLOCK.TORCH;
        return 0;
      }
      case "tower": {
        const inCab = y >= o.h - 3;
        if (inCab) {
          const cu0 = o.u0 - 1;
          const cu1 = o.u1 + 1;
          const cv0 = o.v0 - 1;
          const cv1 = o.v1 + 1;
          if (u < cu0 - 1 || u > cu1 + 1 || v < cv0 - 1 || v > cv1 + 1) return 0;
          if (y === o.h + 1) return BLOCK.PLANKS; // roof (flat, wider)
          if (y === o.h - 3) return BLOCK.STONE; // the cabin floor
          if (u < cu0 || u > cu1 || v < cv0 || v > cv1) return 0;
          const wall = u === cu0 || u === cu1 || v === cv0 || v === cv1;
          if (y > o.h + 1) return 0;
          if (wall) return BLOCK.GLASS;
          if (y === o.h - 2 && u === o.u0 + 2 && v === o.v0 + 2) return BLOCK.LUMEN;
          return 0;
        }
        if (u < o.u0 || u > o.u1 || v < o.v0 || v > o.v1) return 0;
        // The shaft: a hollow tube with a door at the bottom.
        const wall = u === o.u0 || u === o.u1 || v === o.v0 || v === o.v1;
        if (!wall) return 0;
        if (y <= 2 && v === o.v0 && u === o.u0 + 2) return 0;
        // (Mostly bricks: the older ones are brick, the newer concrete.)
        return o.wall === BLOCK.BRICKS || o.wall === undefined ? BLOCK.BRICKS : y % 6 === 0 ? BLOCK.BRICKS : o.wall;
      }
      case "tank": {
        const d = Math.hypot(u - o.u, v - o.v);
        if (d > o.r || y > o.h) return 0;
        if (y === o.h) return BLOCK.COBBLESTONE;
        return d > o.r - 1 ? (y % 3 === 0 ? BLOCK.BRICKS : BLOCK.COBBLESTONE) : BLOCK.COBBLESTONE;
      }
      case "terminal": {
        // A long low building with a glass front toward the runway, a canopy
        // over the entrance and a rooftop of lights.
        const wall = u === o.u0 || u === o.u1 || v === o.v1 || v === o.v0;
        if (y > o.h + 1) return 0;
        if (y === o.h + 1) return (u - o.u0) % 6 === 0 && (v === o.v0 || v === o.v1) ? BLOCK.LUMEN : 0;
        if (y === o.h) return BLOCK.STONE;
        if (wall) {
          if (v === o.v0 && y >= 2 && y <= o.h - 2) return (u - o.u0) % 8 === 0 ? BLOCK.STONE : BLOCK.GLASS; // the glass front
          if (v === o.v0 && y <= 3 && Math.abs(u - Math.floor((o.u0 + o.u1) / 2)) <= 2) return 0; // the doors
          if (y >= 3 && y <= o.h - 2 && (u - o.u0) % 4 !== 0 && v === o.v1) return BLOCK.GLASS;
          return o.id === 0 ? BLOCK.BRICKS : BLOCK.STONE;
        }
        if (y === 1 && (u - o.u0) % 6 === 3 && (v - o.v0) % 5 === 2) return BLOCK.TORCH;
        return 0;
      }
      case "radar": {
        // A white dome on a short drum, with a mast beside it.
        const d = Math.hypot(u - o.u, v - o.v);
        if (d <= 0.6 && y <= 18) return y > 14 ? BLOCK.LUMEN : BLOCK.COBBLESTONE; // the antenna mast
        if (y <= 3) return d <= 2.2 && d > 1.4 && y <= 1 ? 0 : d <= o.r + 0.6 && d > o.r - 1 ? BLOCK.COBBLESTONE : 0;
        const r = Math.sqrt(Math.max(0, o.r * o.r - (y - 3) * (y - 3)));
        return y <= o.r + 3 && d <= r + 0.3 && d > r - 1.2 ? BLOCK.WOOL : 0;
      }
      case "park": {
        // A park: grass with a few trees (trunk and a round crown) and a lamp.
        const cu = Math.floor((o.u0 + o.u1) / 2);
        const cv = Math.floor((o.v0 + o.v1) / 2);
        const dx = u - cu;
        const dz = v - cv;
        for (const [tu, tv] of [[-6, -4], [5, 5], [-4, 6], [7, -5]]) {
          const tx = u - (cu + tu);
          const tz = v - (cv + tv);
          if (tx === 0 && tz === 0 && y <= 4) return BLOCK.WOOD;
          if (y >= 4 && y <= 7 && tx * tx + tz * tz + (y - 5) * (y - 5) * 1.4 <= 8) return BLOCK.LEAVES;
        }
        if (dx === 0 && dz === 0 && y <= 4) return y === 4 ? BLOCK.LUMEN : BLOCK.COBBLESTONE;
        return 0;
      }
      case "lamp":
        return y <= 5 ? (y === 5 ? BLOCK.LUMEN : BLOCK.COBBLESTONE) : 0;
      default:
        return 0;
    }
  }

  // A city building (a stack of boxes): hollow, with floors, windows, a door.
  _buildingBlock(o, u, v, y) {
    for (const b of o.boxes) {
      if (y <= b.y0 || y > b.y1 + 1) continue;
      if (u < b.u0 || u > b.u1 || v < b.v0 || v > b.v1) continue;
      // Another box standing on this one over this column: the box's top is a floor, not a roof.
      const covered = o.boxes.some((c) => c !== b && c.y0 === b.y1 && u >= c.u0 && u <= c.u1 && v >= c.v0 && v <= c.v1);
      const perim = u === b.u0 || u === b.u1 || v === b.v0 || v === b.v1;
      if (y === b.y1 + 1) {
        // Parapet and rooftop lamps (not where another box stands).
        if (!perim || covered) continue;
        return (u === b.u0 || u === b.u1) && (v === b.v0 || v === b.v1) ? BLOCK.LUMEN : o.roof;
      }
      if (y === b.y1) return covered ? BLOCK.PLANKS : o.roof;
      if (perim) {
        // The door: 3 wide, 3 tall, in the middle of the street-facing wall (the ground box).
        if (b.y0 === 0) {
          const cu = Math.floor((b.u0 + b.u1) / 2);
          const door = (o.doorSide === "v0" ? v === b.v0 : v === b.v1) && Math.abs(u - cu) <= 1 && y <= 3;
          if (door) return 0;
        }
        if (o.curtain && b.y0 > 0) {
          // A glass tower: curtain walls of glass between stone corner pillars and floor bands.
          const corner = (u === b.u0 || u === b.u1) && (v === b.v0 || v === b.v1);
          if (corner || y % 5 === 0) return o.wall;
          const along = v === b.v0 || v === b.v1 ? u - b.u0 : v - b.v0;
          return along % 6 === 0 ? o.wall : BLOCK.GLASS;
        }
        // Windows: two rows of glass in every storey, with wall pillars between.
        const storey = y % 5;
        if (y >= 2 && (storey === 2 || storey === 3)) {
          const along = v === b.v0 || v === b.v1 ? u - b.u0 : v - b.v0;
          if (along % 3 !== 0) return BLOCK.GLASS;
        }
        return o.wall;
      }
      // Interior: floors every 5 blocks, a lamp on each.
      if (y % 5 === 0) return BLOCK.PLANKS;
      if (y % 5 === 1) {
        const cu = Math.floor((b.u0 + b.u1) / 2);
        const cv = Math.floor((b.v0 + b.v1) / 2);
        if (u === cu && v === cv) return BLOCK.TORCH;
      }
      return 0;
    }
    // The antenna on the tallest towers.
    if (o.antenna) {
      const top = o.boxes[o.boxes.length - 1];
      const cu = Math.floor((top.u0 + top.u1) / 2);
      const cv = Math.floor((top.v0 + top.v1) / 2);
      if (u === cu && v === cv && y > top.y1 + 1 && y <= top.y1 + 1 + o.antenna) return y === top.y1 + 1 + o.antenna ? BLOCK.LUMEN : BLOCK.COBBLESTONE;
    }
    return 0;
  }

  // One cell of a bunker compound (relative height yr from the pad's surface
  // block: 0 is the surface, negative below, positive above): -1 leaves the
  // block as the terrain has it, 0 clears it, anything else is the block.
  // The compound is a walled yard with a watch tower and a hut; the ramp
  // goes down from the yard (a trench, then a tunnel) into a hall.
  _bunkerBlock(s, b, u, v, yr) {
    const H = BUNKER_H;
    // The ramp: a 15-wide way down, a drop of one block every two along it
    // (an open trench with low brick walls, then a tunnel under the pad).
    if (v >= b.rv0 && v <= b.rv1) {
      const sIdx = v - b.rv0;
      const floor = -(sIdx >> 1); // the walking surface (a stone block)
      if (u >= b.ru0 && u <= b.ru1) {
        if (yr === floor) return BLOCK.STONE;
        if (yr > floor && yr <= floor + H - 1) return 0;
        return -1;
      }
      if (u === b.ru0 - 1 || u === b.ru1 + 1) return yr >= floor && yr <= 2 ? BLOCK.BRICKS : -1;
    }
    // The hall at the foot of the ramp: floor, walls, a ceiling of the pad's own stone, lights.
    if (u >= b.hu0 - 1 && u <= b.hu1 + 1 && v >= b.hv0 - 1 && v <= b.hv1 + 1) {
      const floor = -(BUNKER_RAMP >> 1) + 1; // (the ramp's last step)
      const inside = u >= b.hu0 && u <= b.hu1 && v >= b.hv0 && v <= b.hv1;
      if (yr < floor - 1 || yr > 0) return -1;
      if (inside) {
        if (yr === floor) return BLOCK.STONE;
        if (yr > floor && yr <= floor + H) {
          return 0;
        }
        if (yr === 0) return (u - b.hu0) % 6 === 3 && (v - b.hv0) % 6 === 3 ? BLOCK.LUMEN : BLOCK.STONE; // the ceiling, with lights
        return -1;
      }
      // The walls (and the open end toward the ramp).
      if (v === b.hv0 - 1 && u >= b.ru0 && u <= b.ru1) return yr >= floor && yr <= floor + H ? 0 : -1;
      return yr >= floor - 1 && yr <= 0 ? BLOCK.BRICKS : -1;
    }
    // The yard above ground: a wall around it, a gate toward the apron, a
    // watch tower in one corner, a hut by the ramp.
    const wall = u === b.cu0 || u === b.cu1 || v === b.cv0 || v === b.cv1;
    if (yr >= 1 && yr <= 40) {
      if (wall) {
        // The gate: a gap in the wall facing the apron.
        if (v === b.cv0 && Math.abs(u - b.uc) <= 4) return 0;
        if (yr <= 3) return BLOCK.COBBLESTONE;
        if (yr === 4 && (u + v) % 4 === 0) return BLOCK.LUMEN;
        return 0;
      }
      // The watch tower in the corner (a small shaft with a cabin).
      const tu = b.cu1 - 4;
      const tv = b.cv1 - 4;
      if (Math.abs(u - tu) <= 2 && Math.abs(v - tv) <= 2) {
        const tw = Math.abs(u - tu) === 2 || Math.abs(v - tv) === 2;
        if (yr <= 8) return tw ? (yr >= 6 ? BLOCK.GLASS : BLOCK.BRICKS) : 0;
        if (yr === 9) return BLOCK.STONE;
        if (yr === 10 && u === tu && v === tv) return BLOCK.LUMEN;
        return 0;
      }
      // A guard hut beside the ramp's top.
      const hu0 = b.ru1 + 4;
      const hv0 = b.rv0 - 1;
      if (u >= hu0 && u <= hu0 + 5 && v >= hv0 && v <= hv0 + 4) {
        const hw = u === hu0 || u === hu0 + 5 || v === hv0 || v === hv0 + 4;
        if (yr === 4) return BLOCK.STONE;
        if (yr > 4) return 0;
        if (hw) {
          if (v === hv0 && yr <= 2 && u === hu0 + 2) return 0; // the door
          if (yr === 2 || yr === 3) return (u + v) % 2 ? BLOCK.GLASS : BLOCK.BRICKS;
          return BLOCK.BRICKS;
        }
        return yr === 1 && u === hu0 + 2 && v === hv0 + 2 ? BLOCK.TORCH : 0;
      }
    }
    return -1;
  }

  // Places every site overlapping chunk (cx, cz) into its block array: a
  // cleared, levelled top, the runway/apron/street surfaces and structures.
  placeInChunk(blocks, cx, cz, hAt = null) {
    const S = CHUNK_SIZE;
    const bx = cx * S;
    const bz = cz * S;
    const site = this.siteAt(bx + S / 2, bz + S / 2) || this._nearSite(bx, bz);
    if (!site) return;
    const idx = (x, y, z) => (y * S + z) * S + x;
    for (let lz = 0; lz < S; lz++) {
      for (let lx = 0; lx < S; lx++) {
        const wx = bx + lx;
        const wz = bz + lz;
        const [u, v] = this.toLocal(site, wx, wz);
        const out = this._outside(site, u, v);
        if (out > 8) continue;
        const y0 = site.y;
        if (y0 + 2 >= WORLD_HEIGHT) continue;
        // Clear whatever stood there (trees, plants) above the natural surface.
        const h = hAt ? hAt(lx, lz) : this.terrain.heightAt(wx, wz);
        const top = Math.min(WORLD_HEIGHT - 1, h + 40);
        for (let y = Math.max(1, h + 1); y <= top; y++) blocks[idx(lx, y, lz)] = BLOCK.AIR;
        if (out > 0) continue;
        const surf = this._surface(site, u, v);
        if (surf) blocks[idx(lx, y0, lz)] = surf;
        // The pad's ground: solid down to the natural stone.
        for (let y = y0 - 1; y >= Math.max(1, y0 - 3); y--) {
          if (blocks[idx(lx, y, lz)] === BLOCK.AIR || blocks[idx(lx, y, lz)] === BLOCK.WATER) blocks[idx(lx, y, lz)] = BLOCK.DIRT;
        }
        // Structures.
        const list = this._structuresAt(site, u, v);
        for (const st of list) {
          if (st.t === "bunker") {
            // Above the surface and below it (the ramp and the hall are dug into the ground).
            for (let yr = -(BUNKER_RAMP >> 1) - 2; yr <= 40; yr++) {
              const y = y0 + yr;
              if (y < 1 || y >= WORLD_HEIGHT) continue;
              const id = this._bunkerBlock(site, st.o, u, v, yr);
              if (id >= 0) blocks[idx(lx, y, lz)] = id;
            }
            continue;
          }
          const tall = st.t === "skyscraper" || st.t === "house" || st.t === "midrise";
          const ymax = tall ? WORLD_HEIGHT - y0 - 1 : 40;
          for (let y = 1; y <= ymax && y0 + y < WORLD_HEIGHT; y++) {
            const id = tall ? this._buildingBlock(st.o, u, v, y) : this._structureBlock(st, u, v, y);
            if (id) blocks[idx(lx, y0 + y, lz)] = id;
          }
        }
      }
    }
  }

  // The site (if any) whose footprint can touch the chunk whose corner is (bx, bz).
  _nearSite(bx, bz) {
    const S = CHUNK_SIZE;
    const c = [
      [bx, bz],
      [bx + S, bz],
      [bx, bz + S],
      [bx + S, bz + S],
    ];
    for (const [x, z] of c) {
      const s = this.siteAt(x, z);
      if (s) return s;
    }
    return null;
  }
}
