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
//   airport: a 260 block runway (dark, with markings and edge lights), a
//   taxiway, an apron with three hangars (parked aircraft appear in front of
//   them, see airports.js), a control tower and a few fuel tanks;
//   city: the same airport with a grid of streets and towers of all heights
//   next to it.
//
// Local coordinates: u runs along the runway, v across it (the apron and the
// city lie on the +v side); the runway's centre is (u, v) = (0, 0). `axis`
// (0: u is world x, 1: u is world z) and `flip` (the side v points to)
// orient it in the world.
import { hash2, mulberry32 } from "./noise.js";
import { BLOCK } from "./blocks.js";
import { CHUNK_SIZE, WORLD_HEIGHT, SEA_LEVEL } from "./constants.js";

export const SITE_CELL = 700; // grid cell a site candidate is picked from
const CITY_CHANCE = 0.25;
const AIRPORT_CHANCE = 0.4; // (in addition to the cities, which have an airport too)
const REACH = 270; // bounding radius of a site incl. its slopes: the site's centre keeps this far from the cell's edges
const BLEND = 30; // width of the slope from the pad down to the natural terrain
const MAX_SPREAD = 14; // the natural terrain under a site may vary this much (10th to 90th percentile)
const TRIES = 12;
const KIND_SALT = 0x51a7e001;
const PLACE_SALT = 0x51a7e002;
const ORIENT_SALT = 0x51a7e003;

export const RUNWAY_HALF = 130; // half the runway length
export const RUNWAY_HALF_WIDTH = 7;
const AIRPORT_RECT = { u0: -150, u1: 150, v0: -20, v1: 64 };
const CITY_RECT = { u0: -150, u1: 150, v0: -20, v1: 172 };
const CITY_V0 = 66; // first street of the city grid
const LOT = 32; // city grid pitch (24 lot + 8 street)

const ROOFS = [BLOCK.COBBLESTONE, BLOCK.STONE, BLOCK.BRICKS];
const WALLS = [BLOCK.STONE, BLOCK.BRICKS, BLOCK.TERRACOTTA, BLOCK.PLANKS, BLOCK.COBBLESTONE, BLOCK.WOOL];

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
    const rect = kind === "city" ? CITY_RECT : AIRPORT_RECT;
    const terrain = this.terrain;
    for (let t = 0; t < TRIES; t++) {
      const jx = hash2((this.seed ^ PLACE_SALT) >>> 0, cx * 16 + t, cz);
      const jz = hash2((this.seed ^ PLACE_SALT ^ 0x9e37) >>> 0, cx * 16 + t, cz);
      const x = cx * SITE_CELL + REACH + Math.floor(jx * (SITE_CELL - REACH * 2));
      const z = cz * SITE_CELL + REACH + Math.floor(jz * (SITE_CELL - REACH * 2));
      const axis = hash2((this.seed ^ ORIENT_SALT) >>> 0, cx * 16 + t, cz) < 0.5 ? 0 : 1;
      const flip = hash2((this.seed ^ ORIENT_SALT ^ 0x77) >>> 0, cx * 16 + t, cz) < 0.5 ? 1 : -1;
      const site = { kind, x, z, axis, flip, rect, y: 0, seed: (this.seed ^ Math.imul(x, 0x9e3779b1) ^ Math.imul(z, 0x85ebca6b)) >>> 0, id: `${kind}:${x},${z}` };
      // The natural terrain across the footprint must be mostly dry land, fairly
      // gentle (a few outliers are levelled or filled) and low enough.
      const hs = [];
      let wet = 0;
      let mountain = 0;
      for (let u = rect.u0; u <= rect.u1; u += 25) {
        for (let v = rect.v0; v <= rect.v1; v += 24) {
          const [wx, wz] = this.toWorld(site, u, v);
          const info = terrain._baseInfo(wx, wz);
          if (info.height <= SEA_LEVEL + 1) wet++;
          if (info.mountainT > 0.5) mountain++;
          hs.push(info.height);
        }
      }
      hs.sort((a, b) => a - b);
      const n = hs.length;
      if (wet / n > 0.25 || mountain / n > 0.25) continue;
      if (hs[Math.floor(n * 0.9)] - hs[Math.floor(n * 0.1)] > MAX_SPREAD) continue;
      const median = hs[Math.floor(n / 2)];
      const limit = kind === "city" ? SEA_LEVEL + 16 : SEA_LEVEL + 22;
      if (median > limit) continue;
      site.y = Math.max(SEA_LEVEL + 4, median);
      site.hangars = [-72, 0, 72].map((uc, i) => ({ uc, u0: uc - 14, u1: uc + 14, v0: 40, v1: 58, h: 12, id: i }));
      site.tower = { u0: 104, u1: 109, v0: 22, v1: 27, h: 22 };
      site.tanks = [[-118, 46], [-118, 56], [-106, 51]].map(([u, v]) => ({ u, v, r: 3.6, h: 7 }));
      site.parking = site.hangars.map((h) => ({ u: h.uc, v: 26 }));
      if (kind === "city") site.lots = this._lots(site);
      return site;
    }
    return null;
  }

  // The building lots of a city grid: [{ m, k, kind, u0, u1, v0, v1, h, wall, roof, doorSide }].
  _lots(site) {
    const rand = mulberry32(site.seed ^ 0xc17e);
    const lots = [];
    const centerU = 0;
    const centerV = CITY_V0 + LOT * 1.5;
    const maxH = Math.max(8, WORLD_HEIGHT - 3 - site.y - 2);
    for (let k = 0; k < 3; k++) {
      for (let m = 0; m < 9; m++) {
        const lu0 = -144 + m * LOT + 8;
        const lv0 = CITY_V0 + 8 + k * LOT;
        const kindRoll = rand();
        const w = 12 + Math.floor(rand() * 11); // 12-22
        const d = 12 + Math.floor(rand() * 11);
        const u0 = lu0 + Math.floor((24 - w) / 2 + (rand() - 0.5) * 2);
        const v0 = lv0 + Math.floor((24 - d) / 2 + (rand() - 0.5) * 2);
        const cu = u0 + w / 2;
        const cv = v0 + d / 2;
        const dist = Math.hypot(cu - centerU, (cv - centerV) * 1.3);
        const downtown = Math.max(0, 1 - dist / 190);
        let h = Math.round(6 + downtown * (10 + rand() * 12) + rand() * 5);
        h = Math.min(h, maxH);
        let kind = "skyscraper";
        if (kindRoll < 0.1) kind = "plaza";
        else if (kindRoll < 0.3) {
          kind = "house";
          h = 5 + Math.floor(rand() * 3);
        }
        lots.push({
          m,
          k,
          kind,
          u0,
          u1: u0 + w - 1,
          v0,
          v1: v0 + d - 1,
          h,
          wall: WALLS[Math.floor(rand() * WALLS.length)],
          roof: ROOFS[Math.floor(rand() * ROOFS.length)],
          // The door faces the nearer street along v (front k = the -v street).
          doorSide: rand() < 0.5 ? "v0" : "v1",
        });
      }
    }
    return lots;
  }

  // The site whose bounding circle covers world column (wx, wz), or null.
  siteAt(wx, wz) {
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

  // Both ends of a site's runway: [{ x, z, dx, dz, yaw }] (a takeoff starts at
  // (x, z) heading (dx, dz); yaw is the jet's heading for that).
  runwayEnds(site) {
    const [ux, uz] = this.dirU(site);
    const out = [];
    for (const s of [-1, 1]) {
      const [x, z] = this.toWorld(site, s * (RUNWAY_HALF - 12), 0);
      const dx = -s * ux;
      const dz = -s * uz;
      out.push({ x: x + 0.5, z: z + 0.5, dx, dz, yaw: Math.atan2(-dx, -dz), length: RUNWAY_HALF * 2 - 24, y: site.y + 1 });
    }
    return out;
  }

  // Where aircraft are parked: [{ x, y, z, yaw }] (nose toward the runway).
  parkingSpots(site) {
    const [vx, vz] = this.dirV(site);
    return (site.parking || []).map((p) => {
      const [x, z] = this.toWorld(site, p.u, p.v);
      return { x: x + 0.5, y: site.y + 1, z: z + 0.5, yaw: Math.atan2(vx, vz) };
    });
  }

  // A villager-style "settlement" description: { x, z, radius } near the
  // people (the apron of an airport, the middle of a city).
  settlement(site) {
    const [x, z] = this.toWorld(site, 0, site.kind === "city" ? CITY_V0 + LOT * 1.5 : 34);
    return { x, z, groundY: site.y, radius: site.kind === "city" ? 110 : 55, kind: site.kind };
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
    // The runway: dark, with a dashed centre line, edge lines, thresholds and edge lights.
    if (au <= RUNWAY_HALF + 2 && Math.abs(v) <= RUNWAY_HALF_WIDTH) {
      const av = Math.abs(v);
      if (av === 6 && au <= RUNWAY_HALF - 2) return BLOCK.WOOL;
      if (v === 0 && au <= RUNWAY_HALF - 14 && (((u + 400) % 16) < 8)) return BLOCK.WOOL;
      if (au >= RUNWAY_HALF - 10 && au <= RUNWAY_HALF - 2 && av >= 1 && av <= 5 && (av & 1) === 1) return BLOCK.WOOL;
      return BLOCK.BEDROCK;
    }
    // Runway edge lights (they glow at night).
    if (Math.abs(v) === 9 && au <= RUNWAY_HALF && ((u + 400) % 12) === 0) return BLOCK.LUMEN;
    // Taxiway.
    if (v >= 8 && v <= 12 && au <= RUNWAY_HALF - 6) return BLOCK.GRAVEL;
    // Connectors from the runway to the taxiway and the apron.
    if (v >= 8 && v <= 13 && (Math.abs(au - 96) <= 3 || au <= 3)) return BLOCK.GRAVEL;
    // Apron.
    if (v >= 13 && v <= 60 && au <= 118) return (u + 400) % 16 === 0 || (v & 15) === 0 ? BLOCK.GRAVEL : BLOCK.STONE;
    if (s.kind === "city" && v >= CITY_V0 - 2) {
      const cv = v - CITY_V0;
      const cu = u + 144;
      if (cu < 0 || cu >= 9 * LOT + 8) return BLOCK.STONE;
      // Streets and sidewalks.
      const inStreetV = ((cv % LOT) + LOT) % LOT < 8;
      const inStreetU = ((cu % LOT) + LOT) % LOT < 8;
      if (inStreetV || inStreetU) return BLOCK.GRAVEL;
      return BLOCK.STONE; // the lots' ground (sidewalk-grey)
    }
    return 0;
  }

  // Lists of solid structure boxes overlapping local (u, v).
  _structuresAt(s, u, v) {
    const out = [];
    if (s.hangars) {
      for (const h of s.hangars) if (u >= h.u0 && u <= h.u1 && v >= h.v0 && v <= h.v1) out.push({ t: "hangar", o: h });
    }
    const t = s.tower;
    if (t && u >= t.u0 - 3 && u <= t.u1 + 3 && v >= t.v0 - 3 && v <= t.v1 + 3) out.push({ t: "tower", o: t });
    if (s.tanks) {
      for (const k of s.tanks) if (Math.hypot(u - k.u, v - k.v) <= k.r + 0.6) out.push({ t: "tank", o: k });
    }
    if (s.lots) {
      // Lots are on a grid: find the one covering (u, v).
      const m = Math.floor((u + 144 - 8) / LOT);
      const k = Math.floor((v - CITY_V0 - 8) / LOT);
      if (m >= 0 && m < 9 && k >= 0 && k < 3) {
        const l = s.lots[k * 9 + m];
        if (u >= l.u0 - 1 && u <= l.u1 + 1 && v >= l.v0 - 1 && v <= l.v1 + 1) out.push({ t: l.kind, o: l });
      }
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
        // The shaft: a hollow brick tube with a door at the bottom.
        const wall = u === o.u0 || u === o.u1 || v === o.v0 || v === o.v1;
        if (!wall) return 0;
        if (y <= 2 && v === o.v0 && u === o.u0 + 2) return 0;
        return BLOCK.BRICKS;
      }
      case "tank": {
        const d = Math.hypot(u - o.u, v - o.v);
        if (d > o.r || y > o.h) return 0;
        if (y === o.h) return BLOCK.COBBLESTONE;
        return d > o.r - 1 ? (y % 3 === 0 ? BLOCK.BRICKS : BLOCK.COBBLESTONE) : BLOCK.COBBLESTONE;
      }
      case "plaza": {
        const cu = Math.floor((o.u0 + o.u1) / 2);
        const cv = Math.floor((o.v0 + o.v1) / 2);
        if (u === cu && v === cv && y <= 4) return y === 4 ? BLOCK.LUMEN : BLOCK.COBBLESTONE;
        return 0;
      }
      default:
        return 0;
    }
  }

  // A city building (tower or house): hollow, with floors, windows, a door.
  _buildingBlock(o, u, v, y) {
    if (u < o.u0 || u > o.u1 || v < o.v0 || v > o.v1) return 0;
    const perim = u === o.u0 || u === o.u1 || v === o.v0 || v === o.v1;
    if (y > o.h + 1) return 0;
    if (y === o.h + 1) {
      // Parapet and rooftop lamps.
      if (!perim) return 0;
      return (u === o.u0 || u === o.u1) && (v === o.v0 || v === o.v1) ? BLOCK.LUMEN : o.roof;
    }
    if (y === o.h) return o.roof;
    if (perim) {
      // The door: 3 wide, 3 tall, in the middle of the street-facing wall.
      const cu = Math.floor((o.u0 + o.u1) / 2);
      const door = (o.doorSide === "v0" ? v === o.v0 : v === o.v1) && Math.abs(u - cu) <= 1 && y <= 3;
      if (door) return 0;
      // Windows: two rows of glass in every storey, with wall pillars between.
      const storey = y % 5;
      if (y >= 2 && (storey === 2 || storey === 3)) {
        const along = v === o.v0 || v === o.v1 ? u - o.u0 : v - o.v0;
        if (along % 3 !== 0) return BLOCK.GLASS;
      }
      return o.wall;
    }
    // Interior: floors every 5 blocks, a lamp on each.
    if (y % 5 === 0) return BLOCK.PLANKS;
    if (y % 5 === 1) {
      const cu = Math.floor((o.u0 + o.u1) / 2);
      const cv = Math.floor((o.v0 + o.v1) / 2);
      if (u === cu && v === cv) return BLOCK.TORCH;
    }
    return 0;
  }

  // Places every site overlapping chunk (cx, cz) into its block array: a
  // cleared, levelled top, the runway/apron/street surfaces and structures.
  placeInChunk(blocks, cx, cz) {
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
        const h = this.terrain.heightAt(wx, wz);
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
          for (let y = 1; y <= 40 && y0 + y < WORLD_HEIGHT; y++) {
            const id = st.t === "skyscraper" || st.t === "house" ? this._buildingBlock(st.o, u, v, y) : this._structureBlock(st, u, v, y);
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
