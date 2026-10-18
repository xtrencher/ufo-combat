// The End's terrain (Round 12): the generator of every dimension's shape
// (js/dim-registry.js): generate(chunk), heightAt(x, z), biomeAt(x, z), and
// `structures` (the cities' chests for chests.js, no monster spawners, the
// shulkers' places for the creatures' part). Pure (no three.js): the chunk
// workers run it too, so a chunk is the same everywhere.
//
// As vanilla's (Java 1.20):
// - The main island: end stone floating over the void around (0, 0), about
//   90 blocks out (the arrival platform at (100, 48, 0) is just off its edge,
//   built by js/dimensions.js on every arrival), its top near y 62, its
//   underside tapering down toward y 15.
// - The ten obsidian pillars (vanilla's SpikeFeature): on a ring of radius
//   42, radius 2 + i / 3 and height 76 + 3 i in an order the seed shuffles; a
//   bedrock block on each top for its end crystal (js/dragon.js); the two
//   lowest-but-one (i = 1, 2) caged in iron bars.
// - The exit portal at (0, 0) (vanilla's EndPodiumFeature): a bedrock bowl
//   on the island's top, its pillar with four torches; empty until the dragon
//   dies (js/dragon.js lights it and puts the egg on top: edits).
// - The void from about 100 blocks out to 1000; past it the outer islands,
//   scattered blobs of end stone (vanilla's island noise, simplified to a
//   grid of jittered islands), with chorus trees and end cities
//   (js/end-structures.js). The gateways to them open as the dragon dies.
import { BLOCK } from "./content/base.js";
import { END_STONE, OBSIDIAN, IRON_BARS } from "./content/ids.js";
import { Noise, hash2, mulberry32 } from "./noise.js";
import { CHUNK_SIZE, WORLD_HEIGHT } from "./constants.js";
import { EndCities, OUTER_START } from "./end-structures.js";
import { wallTorch } from "./blocks.js";

const S = CHUNK_SIZE;
const MAIN_R = 88; // the main island's radius, about
const MAIN_TOP = 62;
const PILLAR_RING = 42;
const ISLAND_CELL = 48; // the outer islands' grid
const ISLAND_CHANCE = 0.5;

// The ten pillars of a world (vanilla's order: 0-9 shuffled with the seed).
export function endPillars(seed) {
  const order = [...Array(10).keys()];
  const rand = mulberry32((seed ^ 0x5ea1c0de) >>> 0);
  for (let i = order.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [order[i], order[j]] = [order[j], order[i]];
  }
  const out = [];
  for (let i = 0; i < 10; i++) {
    const a = 2 * (-Math.PI + (Math.PI / 10) * i);
    const j = order[i];
    out.push({ i, x: Math.floor(PILLAR_RING * Math.cos(a)), z: Math.floor(PILLAR_RING * Math.sin(a)), r: 2 + Math.floor(j / 3), h: 76 + j * 3, guarded: j === 1 || j === 2 });
  }
  return out;
}

export class EndGenerator {
  constructor(seed) {
    this.seed = (seed ^ 0x454e44) >>> 0;
    this.noise = new Noise(this.seed);
    this.detail = new Noise((this.seed ^ 0x2545f491) >>> 0);
    this.pillars = endPillars(seed >>> 0);
    this.cities = new EndCities(this);
    // (the exit portal's floor: the first air over the island's middle)
    this.podiumY = this._main(0, 0)[1] + 1;
    this.structures = {
      chestAt: (x, y, z) => this.cities.chestAt(x, y, z),
      spawnerSpots: () => ({ columns: [], cells: [] }),
      shulkerSpots: (cx, cz) => this.cities.shulkerSpots(cx, cz),
    };
    this._islands = new Map(); // "gx,gz" -> island or null
  }

  // The main island's bottom and top in column (x, z), or null.
  _main(x, z) {
    const r = Math.hypot(x, z);
    if (r > MAIN_R + 12) return null;
    const n = this.noise.fbm2(x, z, 3, 0.5, 2, 1 / 44);
    const R = Math.min(96, Math.max(76, MAIN_R + n * 18));
    if (r >= R) return null;
    const t = r / R;
    const d = this.detail.fbm2(x, z, 2, 0.5, 2, 1 / 12);
    const top = Math.round(MAIN_TOP - t * t * 7 + n * 2 + d * 0.8);
    const bottom = Math.round(top - 3 - Math.pow(1 - t, 1.25) * 44 + d * 4);
    return bottom < top ? [Math.max(1, bottom), top] : null;
  }

  // The outer island of grid cell (gx, gz), or null: { x, z, r, top }.
  _island(gx, gz) {
    const key = `${gx},${gz}`;
    if (this._islands.has(key)) return this._islands.get(key);
    let isl = null;
    const s = this.seed ^ 0x1517;
    if (hash2(s, gx, gz) < ISLAND_CHANCE) {
      const x = gx * ISLAND_CELL + 8 + hash2(s ^ 0x11, gx, gz) * (ISLAND_CELL - 16);
      const z = gz * ISLAND_CELL + 8 + hash2(s ^ 0x22, gx, gz) * (ISLAND_CELL - 16);
      if (Math.hypot(x, z) > OUTER_START) isl = { x, z, r: 14 + hash2(s ^ 0x33, gx, gz) * 24, top: 55 + Math.floor(hash2(s ^ 0x44, gx, gz) * 10) };
    }
    if (this._islands.size > 4096) this._islands.clear();
    this._islands.set(key, isl);
    return isl;
  }

  // The outer islands' bottom and top in column (x, z), or null.
  _outer(x, z) {
    if (x * x + z * z < (OUTER_START - 60) ** 2) return null;
    const gx = Math.floor(x / ISLAND_CELL);
    const gz = Math.floor(z / ISLAND_CELL);
    let top = -1;
    let bottom = WORLD_HEIGHT;
    let warp = null;
    for (let dz = -1; dz <= 1; dz++) {
      for (let dx = -1; dx <= 1; dx++) {
        const isl = this._island(gx + dx, gz + dz);
        if (!isl) continue;
        const ex = x - isl.x;
        const ez = z - isl.z;
        if (Math.abs(ex) > isl.r + 8 || Math.abs(ez) > isl.r + 8) continue;
        if (warp === null) warp = this.noise.fbm2(x, z, 3, 0.5, 2, 1 / 26);
        const d = Math.hypot(ex, ez) * (1 + warp * 0.35);
        if (d >= isl.r) continue;
        const t = d / isl.r;
        const tp = Math.round(isl.top + (1 - t * t) * 3 + warp * 2);
        const bt = Math.round(tp - 2 - Math.pow(1 - t, 1.3) * isl.r * 0.6 + warp * 3);
        if (tp > top) top = tp;
        if (bt < bottom) bottom = bt;
      }
    }
    return top >= 0 && bottom < top ? [Math.max(1, bottom), top] : null;
  }

  // The end stone of column (x, z): [bottom, top], or null (the void).
  column(x, z) {
    return this._main(x, z) || this._outer(x, z);
  }

  generate(chunk) {
    const blocks = chunk.blocks;
    const bx = chunk.cx * S;
    const bz = chunk.cz * S;
    const dist = Math.hypot(bx + 8, bz + 8);
    // (the void between the main island and the outer ones: nothing, at once)
    if (dist > MAIN_R + 32 && dist < OUTER_START - 80) return;
    for (let z = 0; z < S; z++) {
      for (let x = 0; x < S; x++) {
        const col = this.column(bx + x, bz + z);
        if (!col) continue;
        for (let y = col[0]; y <= col[1]; y++) blocks[(y << 8) | (z << 4) | x] = END_STONE;
      }
    }
    if (dist < MAIN_R + 32) {
      this._placePillars(blocks, bx, bz);
      this._placePodium(blocks, bx, bz);
    } else this.cities.placeInChunk(blocks, chunk.cx, chunk.cz);
  }

  // The pillars (vanilla's spikes): obsidian through the island and up to
  // its height, bedrock on top, the guarded ones' cages.
  _placePillars(blocks, bx, bz) {
    for (const p of this.pillars) {
      if (p.x + p.r + 3 < bx || p.x - p.r - 3 > bx + S - 1 || p.z + p.r + 3 < bz || p.z - p.r - 3 > bz + S - 1) continue;
      for (let z = 0; z < S; z++) {
        for (let x = 0; x < S; x++) {
          const dx = bx + x - p.x;
          const dz = bz + z - p.z;
          if (dx * dx + dz * dz <= p.r * p.r + 1) {
            const col = this._main(bx + x, bz + z);
            for (let y = col ? col[0] : 20; y < p.h; y++) blocks[(y << 8) | (z << 4) | x] = OBSIDIAN;
          }
          if (dx === 0 && dz === 0) blocks[(p.h << 8) | (z << 4) | x] = BLOCK.BEDROCK;
          if (p.guarded && Math.abs(dx) <= 2 && Math.abs(dz) <= 2) {
            for (let dy = 0; dy <= 3; dy++) if (Math.abs(dx) === 2 || Math.abs(dz) === 2 || dy === 3) blocks[((p.h + dy) << 8) | (z << 4) | x] = IRON_BARS;
          }
        }
      }
    }
  }

  // The exit portal, empty (podiumCells: the same cells, lit or not).
  _placePodium(blocks, bx, bz) {
    if (bx > 4 || bx + S - 1 < -4 || bz > 4 || bz + S - 1 < -4) return;
    const list = podiumCells(this.podiumY, false);
    for (let i = 0; i < list.length; i += 4) {
      const x = list[i] - bx;
      const z = list[i + 2] - bz;
      if (x < 0 || x >= S || z < 0 || z >= S) continue;
      blocks[(list[i + 1] << 8) | (z << 4) | x] = list[i + 3];
    }
  }

  // (The island's top, or -1 over the void.)
  heightAt(x, z) {
    const col = this.column(x, z);
    return col ? col[1] : -1;
  }

  biomeAt() {
    return -1;
  }
}

// The exit portal at (0, y, 0) (vanilla's EndPodiumFeature): its cells,
// [x, y, z, id, ...], with the portal in it (active) or empty; its middle
// pillar of bedrock four high with a torch on each side.
export function podiumCells(y, active, portalId = 0) {
  const out = [];
  for (let dx = -4; dx <= 4; dx++) {
    for (let dz = -4; dz <= 4; dz++) {
      for (let dy = -1; dy <= 4; dy++) {
        const d2 = dx * dx + dy * dy + dz * dz;
        const inside = d2 < 6.25;
        if (!inside && d2 >= 12.25) continue;
        let id;
        if (dy < 0) id = inside ? BLOCK.BEDROCK : END_STONE;
        else if (dy > 0) id = BLOCK.AIR;
        else if (!inside) id = BLOCK.BEDROCK;
        else id = active && portalId ? portalId : BLOCK.AIR;
        out.push(dx, y + dy, dz, id);
      }
    }
  }
  for (let dy = 0; dy < 4; dy++) out.push(0, y + dy, 0, BLOCK.BEDROCK);
  for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) out.push(dx, y + 2, dz, wallTorch(dx, dz));
  return out;
}
