// Round 22.A tests: better terrain (js/terrain.js _baseInfoV2, worldtype.js
// GEN_TERRAIN_V2 = 4). The older generator's mountains were tables: its
// height field overshot the top of the world and the soft cap squeezed a
// tenth of every range onto y 123. Generator 4's ranges are a warped ridged
// multifractal held under the knee.
// In Node (the generator):
//   - the gating: a new world (either type) gets generator 4; a saved one
//     keeps its own (a Survival world saved before Round 22: 3); the option
//     reaches the generator, the biomes and the world;
//   - the older generators are byte-identical: fingerprints of their
//     heights, biomes, spawn, home airport, chunks (mountains, spawn, site)
//     and far-terrain samples, taken from the Round 21 code;
//   - no flat tops: the share of mountain columns on the top plateau
//     (y >= 122), the area within a block of each tall summit, and how far
//     the ground falls away from it (curvature), old against new;
//   - a sane height distribution: as much land, sea and lowland as before,
//     tall peaks (some snow-capped), varied summit heights, nothing over 123;
//   - snow on the summits, bare rock below, grass on the lower slopes of a
//     warm range, rivers and lakes still there, no floating terrain blocks;
//   - chunk generation time within ~20% of generator 3's;
//   - the far terrain (lod-mesher.js) samples the same heights and blocks as
//     the chunks;
//   - every new Missions world still has its home airport near the start,
//     its runways flat and clear, its pad blended in; villages; a flat dry
//     spawn.
// In the browser (the real game): a new Survival world on generator 4, its
// chunk workers' chunks the main thread's, the far terrain's heights the
// chunks'; a new Missions world's home airport and flat runway, a village;
// an older Survival world (its record says 3) keeps its land; no console
// errors.
//
//   node r22-terrain-tests.mjs [--only=substring] [--node] [--verbose]
//   node r22-terrain-tests.mjs --fingerprints [GAME_ROOT=dir]   (prints the older generators' fingerprints)
// (GAME_ROOT=dir runs another copy of the game; SHOTS=dir saves screenshots.)
import http from "node:http";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(process.env.GAME_ROOT || path.join(__dirname, ".."));
const args = Object.fromEntries(
  process.argv
    .slice(2)
    .filter((a) => a.startsWith("--"))
    .map((a) => {
      const [k, ...rest] = a.slice(2).split("=");
      return [k, rest.length ? rest.join("=") : true];
    })
);
const imp = (p) => import(pathToFileURL(path.join(ROOT, p)).href);

const results = [];
function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}
async function check(name, fn) {
  if (args.only && !name.toLowerCase().includes(String(args.only).toLowerCase())) return;
  const t0 = Date.now();
  try {
    await fn();
    results.push([name, true]);
    console.log(`  PASS  ${name} (${((Date.now() - t0) / 1000).toFixed(1)}s)`);
  } catch (err) {
    results.push([name, false]);
    console.log(`  FAIL  ${name}: ${err.message}`);
  }
}

const { TerrainGenerator, SNOW_LINE } = await imp("js/terrain.js");
const { LodTerrain } = await imp("js/lod-mesher.js");
const { BLOCK, IS_SOLID } = await imp("js/blocks.js");
const { BIOME } = await imp("js/biomes.js");
const { CHUNK_SIZE, WORLD_HEIGHT, SEA_LEVEL } = await imp("js/constants.js");

// The generators' options (worldtype.js terrainOptions).
const G1 = { sites: true, vanilla: false }; // an old Missions world
const G2 = { sites: true, vanilla: true }; // a Missions world of Round 13-20
const G3M = { sites: true, vanilla: true, bigAirports: true }; // a Missions world of Round 21
const G3S = { sites: false, vanilla: true }; // a Survival world before Round 22
const G4M = { ...G3M, terrainV2: true };
const G4S = { ...G3S, terrainV2: true };

// ---------- The older generators' fingerprints ----------

// [label, seed, options, chunks to generate (a mountain's: the old tables)]
const FP_CASES = [
  ["gen1 missions 9181", 9181, G1, [[0, 0]]],
  ["gen2 missions 12345", 12345, G2, [[-27, 43]]],
  ["gen3 missions 777", 777, G3M, [[-42, 52]]],
  ["gen3 survival 9001", 9001, G3S, [[-13, -19]]],
  ["gen3 survival 42", 42, G3S, [[-59, -7]]],
];
// (Taken from the Round 21 code, 3dc2d0b: `--fingerprints GAME_ROOT=<a copy of it>`.)
const FP_WANT = {
  "gen1 missions 9181": "2038565a/840574ab",
  "gen2 missions 12345": "2785d239/497608bf",
  "gen3 missions 777": "1d642599/fa9c251f",
  "gen3 survival 9001": "183c9178/1ec66e99",
  "gen3 survival 42": "a5670b53/aaeb26b0",
};
function fingerprint(seed, opts, chunks) {
  const T = new TerrainGenerator(seed, opts);
  let h = 2166136261;
  const mix = (x) => (h = Math.imul(h ^ (x & 0xffff), 16777619) >>> 0);
  const sp = T.spawnColumn();
  mix(sp[0]);
  mix(sp[1]);
  const S = T.sites;
  S._ensureHome?.();
  if (S.home) {
    mix(S.home.x);
    mix(S.home.z);
    mix(S.home.y);
  }
  const list = [[sp[0] >> 4, sp[1] >> 4], ...chunks];
  if (S.home) list.push([S.home.x >> 4, S.home.z >> 4]);
  for (const [cx, cz] of list) {
    for (let x = cx * 16 - 64; x < cx * 16 + 64; x += 3) {
      for (let z = cz * 16 - 64; z < cz * 16 + 64; z += 3) {
        mix(T.heightAt(x, z));
        mix(T.biomeAt(x, z));
      }
    }
    for (const [dx, dz] of [[0, 0], [1, 0], [0, 1]]) {
      const c = { cx: cx + dx, cz: cz + dz, blocks: new Uint16Array(CHUNK_SIZE * CHUNK_SIZE * WORLD_HEIGHT) };
      T.generate(c);
      for (const id of c.blocks) mix(id);
    }
  }
  // The far terrain over the mountain (single points and coarse cells).
  const L = new LodTerrain(seed, opts);
  let f = 2166136261;
  const mixf = (x) => (f = Math.imul(f ^ (Math.round(x * 16) & 0xffff), 16777619) >>> 0);
  const out = {};
  const [cx, cz] = chunks[0];
  for (let x = cx * 16 - 300; x < cx * 16 + 300; x += 7) {
    for (let z = cz * 16 - 300; z < cz * 16 + 300; z += 7) {
      L.sample(x, z, out, (x + z) % 2 ? 0 : 4);
      mixf(out.top);
      mixf(out.id);
      mixf(out.depth);
    }
  }
  return `${h.toString(16)}/${f.toString(16)}`;
}

if (args.fingerprints) {
  const o = {};
  for (const [label, seed, opts, chunks] of FP_CASES) o[label] = fingerprint(seed, opts, chunks);
  console.log(JSON.stringify(o, null, 1));
  process.exit(0);
}

const WT = await imp("js/worldtype.js");

// ---------- Node ----------

await check("the gating: a new world (either type) has generator 4, a saved one keeps its own, the option reaches the generator", async () => {
  const g = WT.terrainGenOf;
  assert(WT.GEN_TERRAIN_V2 === 4 && WT.TERRAIN_GEN === WT.GEN_TERRAIN_V2, "generator 4 is a new world's");
  assert(g("missions", undefined) === 4 && g("survival", undefined) === 4, "a new world of either type");
  assert(g("missions", 3, { old: true }) === 3 && g("missions", 2, { old: true }) === 2 && g("missions", undefined, { old: true }) === 1, "a saved Missions world keeps its generator");
  assert(g("survival", 3, { old: true }) === 3 && g("survival", undefined, { old: true }) === 3 && g("survival", 2) === 3 && g("survival", 1) === 3, "a Survival world saved before Round 22: 3, the land it always had");
  assert(g("survival", 4, { old: true }) === 4 && g("missions", 4, { old: true }) === 4 && g("missions", 99) === 4 && g("survival", 99) === 4, "a world saved with 4 keeps it (a newer number: the newest known)");
  const opts = (type, gen) => {
    WT.setWorldType(type, { gen });
    return { ...WT.terrainOptions(), gen: WT.terrainGen() };
  };
  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  assert(same(opts("missions", undefined), { sites: true, vanilla: true, bigAirports: true, terrainV2: true, gen: 4 }), JSON.stringify(opts("missions", undefined)));
  assert(same(opts("survival", undefined), { sites: false, vanilla: true, terrainV2: true, gen: 4 }), JSON.stringify(opts("survival", undefined)));
  // The older ones' options are exactly what they were (no new key).
  assert(same(opts("missions", 3), { ...G3M, gen: 3 }) && same(opts("missions", 2), { ...G2, gen: 2 }) && same(opts("missions", 1), { ...G1, gen: 1 }), "an older Missions world's options");
  assert(same(opts("survival", 3), { ...G3S, gen: 3 }), `an older Survival world's options: ${JSON.stringify(opts("survival", 3))}`);
  WT.setWorldType("missions");
  const t4 = new TerrainGenerator(1, G4S);
  const t3 = new TerrainGenerator(1, G3S);
  assert(t4.options.terrainV2 && t4.biomes.alpine && t4._baseInfo === t4._baseInfoV2, "generator 4's generator");
  assert(!("terrainV2" in t3.options) && !t3.biomes.alpine && t3._baseInfo !== t3._baseInfoV2, "generator 3's generator");
  // World copies the option (it hands its own to the workers and the far terrain).
  const src = fs.readFileSync(path.join(ROOT, "js/world.js"), "utf8");
  assert(/terrainOptions\?\.terrainV2\) this\.terrainOptions\.terrainV2 = true/.test(src), "World keeps the option");
});

await check("the older generators are byte-identical: heights, biomes, spawn, home airport, chunks and far terrain (Round 21's fingerprints)", async () => {
  const bad = [];
  for (const [label, seed, opts, chunks] of FP_CASES) {
    const got = fingerprint(seed, opts, chunks);
    if (got !== FP_WANT[label]) bad.push(`${label}: ${got} (want ${FP_WANT[label]})`);
  }
  assert(!bad.length, bad.join("; "));
  const a = fingerprint(777, G4M, [[-42, 52]]);
  assert(a.split("/")[0] !== FP_WANT["gen3 missions 777"].split("/")[0], "generator 4's differ");
});

// Mountain columns and summits over a seed's land (natural terrain).
const SEEDS = [12345, 777, 42, 9001];
function survey(seed, opts) {
  const T = new TerrainGenerator(seed, opts);
  const hs = [];
  let n = 0;
  let land = 0;
  let low = 0;
  let deep = 0;
  let river = 0;
  for (let x = -8000; x < 8000; x += 40) {
    for (let z = -8000; z < 8000; z += 40) {
      const i = T._baseInfo(x, z);
      n++;
      if (i.height > SEA_LEVEL) land++;
      if (i.height > SEA_LEVEL && i.height <= SEA_LEVEL + 20) low++;
      if (i.height < SEA_LEVEL - 12) deep++;
      if (i.river) river++;
      if (i.mountainT > 0.3) hs.push(i.height);
    }
  }
  // Summits: hill-climb from a grid of mountain points; keep the distinct tall ones.
  const summits = new Map();
  const H = (x, z) => T._baseInfo(x, z).height;
  for (let x = -5000; x < 5000; x += 90) {
    for (let z = -5000; z < 5000; z += 90) {
      if (T._baseInfo(x, z).mountainT < 0.5) continue;
      let bx = x;
      let bz = z;
      let bh = H(x, z);
      for (let it = 0; it < 200; it++) {
        let moved = false;
        for (const [dx, dz] of [[3, 0], [-3, 0], [0, 3], [0, -3], [2, 2], [-2, 2], [2, -2], [-2, -2], [1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const h = H(bx + dx, bz + dz);
          if (h > bh) {
            bh = h;
            bx += dx;
            bz += dz;
            moved = true;
            break;
          }
        }
        if (!moved) break;
      }
      if (bh >= 95) summits.set(`${bx >> 3},${bz >> 3}`, { x: bx, z: bz, h: bh });
    }
  }
  // Each tall summit: the columns within a block of it (41 x 41 around), and the fall at 8 and 16 blocks.
  const tops = [];
  // (A summit is the highest point of the 41 x 41 around it; its top is the
  // ground within a block of it joined to it, flood-filled.)
  for (const s of [...summits.values()].sort((a, b) => b.h - a.h)) {
    if (tops.length >= 25) break;
    const grid = new Int16Array(41 * 41);
    let highest = true;
    for (let dz = -20; dz <= 20; dz++) for (let dx = -20; dx <= 20; dx++) if ((grid[(dz + 20) * 41 + dx + 20] = H(s.x + dx, s.z + dz)) > s.h) highest = false;
    if (!highest || tops.some((t) => Math.abs(t.x - s.x) <= 20 && Math.abs(t.z - s.z) <= 20)) continue;
    let near = 0;
    const seen = new Uint8Array(41 * 41);
    const stack = [20 * 41 + 20];
    seen[stack[0]] = 1;
    while (stack.length) {
      const k = stack.pop();
      near++;
      const kx = k % 41;
      const kz = (k - kx) / 41;
      for (const [ex, ez] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = kx + ex;
        const nz = kz + ez;
        if (nx < 0 || nx > 40 || nz < 0 || nz > 40) continue;
        const j = nz * 41 + nx;
        if (!seen[j] && grid[j] >= s.h - 1) {
          seen[j] = 1;
          stack.push(j);
        }
      }
    }
    let f8 = 0;
    let f16 = 0;
    for (let k = 0; k < 16; k++) {
      const a = (k / 16) * Math.PI * 2;
      f8 += s.h - H(Math.round(s.x + Math.cos(a) * 8), Math.round(s.z + Math.sin(a) * 8));
      f16 += s.h - H(Math.round(s.x + Math.cos(a) * 16), Math.round(s.z + Math.sin(a) * 16));
    }
    // (and within 5 blocks of it: a knife-edge ridge is long but narrow, a table wide every way)
    let near5 = 0;
    for (let dz = -5; dz <= 5; dz++) for (let dx = -5; dx <= 5; dx++) if (grid[(dz + 20) * 41 + dx + 20] >= s.h - 1) near5++;
    tops.push({ ...s, near, near5, f8: f8 / 16, f16: f16 / 16 });
  }
  hs.sort((a, b) => a - b);
  // Neighbour steps over the ranges (a seam in the field shows as a wall).
  let worstStep = 0;
  for (let x = -4000; x < 4000; x += 29) {
    for (let z = -4000; z < 4000; z += 31) {
      const i = T._baseInfo(x, z);
      if (i.mountainT < 0.1) continue;
      worstStep = Math.max(worstStep, Math.abs(i.height - H(x + 1, z)), Math.abs(i.height - H(x, z + 1)));
    }
  }
  return { T, n, worstStep, summitHeights: [...summits.values()].map((s) => s.h), land: land / n, low: low / n, deep: deep / n, river: river / n, hs, plateau: hs.filter((h) => h >= 122).length / hs.length, max: hs[hs.length - 1], tops };
}
const surveys = {};
const surveyOf = (seed, which) => (surveys[`${seed}:${which}`] ||= survey(seed, which === 4 ? G4S : G3S));
const q = (a, p) => a[Math.floor(p * (a.length - 1))];
const avg = (l, f) => l.reduce((s, x) => s + f(x), 0) / Math.max(1, l.length);

await check("no flat tops: almost no mountain column on the top plateau, the summits small and falling away on every side", async () => {
  const rows = [];
  const bad = [];
  for (const seed of SEEDS) {
    const o = surveyOf(seed, 3);
    const s = surveyOf(seed, 4);
    const tallO = o.tops.slice(0, 10);
    const tallN = s.tops.slice(0, 10);
    rows.push(`${seed}: plateau ${(o.plateau * 100).toFixed(1)}% -> ${(s.plateau * 100).toFixed(2)}%, top-10 summits' area within a block ${Math.round(avg(tallO, (t) => t.near))} -> ${Math.round(avg(tallN, (t) => t.near))} columns (in the 11 x 11 round them ${Math.round(avg(tallO, (t) => t.near5))} -> ${Math.round(avg(tallN, (t) => t.near5))} of 121), fall at 8/16 blocks ${avg(tallO, (t) => t.f8).toFixed(1)}/${avg(tallO, (t) => t.f16).toFixed(1)} -> ${avg(tallN, (t) => t.f8).toFixed(1)}/${avg(tallN, (t) => t.f16).toFixed(1)}`);
    if (s.plateau > 0.001) bad.push(`${seed}: ${(s.plateau * 100).toFixed(2)}% of the mountain columns at y >= 122`);
    if (tallN.length < 5) bad.push(`${seed}: only ${tallN.length} tall summits`);
    // (on average small and pointed; none a table: the old ones fill the 11 x 11 and fall 0-2 blocks in 8)
    if (avg(tallN, (t) => t.near5) > 45 || avg(tallN, (t) => t.f8) < 4 || avg(tallN, (t) => t.f16) < 9) bad.push(`${seed}: the summits on average: ${avg(tallN, (t) => t.near5)} of 121, falls ${avg(tallN, (t) => t.f8)}/${avg(tallN, (t) => t.f16)}`);
    for (const t of tallN) {
      if (t.near5 > 80 || t.near > 400) bad.push(`${seed}: a summit at ${t.x},${t.z} (${t.h}) has ${t.near5} columns of the 11 x 11 round it (${t.near} in all) within a block of it`);
      if (t.f8 < 1.5 || t.f16 < 4) bad.push(`${seed}: a summit at ${t.x},${t.z} (${t.h}) falls ${t.f8.toFixed(1)}/${t.f16.toFixed(1)} at 8/16 blocks`);
    }
    // (the old generator's are the tables this round removes)
    assert(o.plateau > 0.03 && avg(tallO, (t) => t.near) > 600, `${seed}: the old generator's tables (${o.plateau}, ${avg(tallO, (t) => t.near)})`);
  }
  console.log(`        (${rows.join("\n         ")})`);
  assert(!bad.length, bad.slice(0, 6).join("; "));
});

await check("a sane height distribution: land, sea and lowland as before, tall and varied peaks (some over the snow line), nothing over 123", async () => {
  const rows = [];
  const bad = [];
  for (const seed of SEEDS) {
    const o = surveyOf(seed, 3);
    const s = surveyOf(seed, 4);
    const tops = s.tops.map((t) => t.h);
    const all = s.summitHeights;
    const sd = Math.sqrt(avg(all, (h) => (h - avg(all, (x) => x)) ** 2));
    rows.push(`${seed}: land ${(o.land * 100).toFixed(1)}% -> ${(s.land * 100).toFixed(1)}%, lowland ${(o.low * 100).toFixed(1)}% -> ${(s.low * 100).toFixed(1)}%, mountain columns p50/p90/p99 ${q(o.hs, 0.5)}/${q(o.hs, 0.9)}/${q(o.hs, 0.99)} -> ${q(s.hs, 0.5)}/${q(s.hs, 0.9)}/${q(s.hs, 0.99)}, max ${s.max}, the 25 tallest summits ${Math.min(...tops)}-${Math.max(...tops)}, ${all.length} summits over 95 (sd ${sd.toFixed(1)}), the biggest step between neighbours ${o.worstStep} -> ${s.worstStep}`);
    if (Math.abs(s.land - o.land) > 0.02 || Math.abs(s.deep - o.deep) > 0.01) bad.push(`${seed}: land ${s.land} sea ${s.deep}`);
    if (s.low < o.low - 0.02) bad.push(`${seed}: lowland ${s.low} (was ${o.low})`);
    if (s.max > 123 || s.max < 108) bad.push(`${seed}: the highest ${s.max}`);
    if (!tops.some((h) => h > SNOW_LINE + 6)) bad.push(`${seed}: no summit well over the snow line`);
    if (sd < 4 || all.length < 15) bad.push(`${seed}: summits all alike (${all.length}, sd ${sd.toFixed(1)})`);
    if (s.worstStep > 8) bad.push(`${seed}: a step of ${s.worstStep} between neighbours`);
    if (q(s.hs, 0.9) < 62) bad.push(`${seed}: low mountains (p90 ${q(s.hs, 0.9)})`);
  }
  console.log(`        (${rows.join("\n         ")})`);
  assert(!bad.length, bad.join("; "));
});

const newChunk = (T, cx, cz) => {
  const c = { cx, cz, blocks: new Uint16Array(CHUNK_SIZE * CHUNK_SIZE * WORLD_HEIGHT) };
  T.generate(c);
  return c.blocks;
};
const at = (blocks, lx, y, lz) => blocks[(y * CHUNK_SIZE + lz) * CHUNK_SIZE + lx];
const TERRAIN = new Set([BLOCK.STONE, BLOCK.DIRT, BLOCK.GRASS, BLOCK.SNOW, BLOCK.SAND, BLOCK.GRAVEL, BLOCK.TERRACOTTA]);

await check("the surface: snow on the summits, bare rock below them, grass low on a warm range; rivers and lakes; no floating terrain", async () => {
  const bad = [];
  let summitSnow = 0;
  let summits = 0;
  let rock = 0;
  let grassMtn = 0;
  let floating = 0;
  let cols = 0;
  for (const seed of SEEDS) {
    const s = surveyOf(seed, 4);
    const T = s.T;
    for (const t of s.tops.slice(0, 8)) {
      const blocks = newChunk(T, t.x >> 4, t.z >> 4);
      const lx = t.x & 15;
      const lz = t.z & 15;
      summits++;
      if (t.h > SNOW_LINE + 6 && at(blocks, lx, t.h, lz) === BLOCK.SNOW) summitSnow++;
      // Every column of the summit's chunk: no lone terrain block hanging in the air.
      for (let z = 0; z < 16; z++) {
        for (let x = 0; x < 16; x++) {
          cols++;
          const h = T.heightAt((t.x & ~15) + x, (t.z & ~15) + z);
          const top = at(blocks, x, h, z);
          if (top === BLOCK.STONE || top === BLOCK.SNOW) rock++;
          for (let y = 3; y < WORLD_HEIGHT - 1; y++) {
            const b = at(blocks, x, y, z);
            if (!TERRAIN.has(b)) continue;
            const air = (xx, yy, zz) => xx < 0 || xx > 15 || zz < 0 || zz > 15 || !IS_SOLID[at(blocks, xx, yy, zz)];
            if (air(x, y - 1, z) && air(x, y + 1, z) && air(x - 1, y, z) && air(x + 1, y, z) && air(x, y, z - 1) && air(x, y, z + 1) && x > 0 && x < 15 && z > 0 && z < 15) floating++;
          }
        }
      }
    }
    // A warm range's lower slopes: grass (the older generator: snow all the way down).
    for (let x = -4000; x < 4000 && grassMtn < 40; x += 37) {
      for (let z = -4000; z < 4000 && grassMtn < 40; z += 41) {
        const h = T.heightAt(x, z);
        if (h < 45 || h > 68 || T.biomeAt(x, z) !== BIOME.MOUNTAINS || T.biomes.coldAt(x, z)) continue;
        const top = T.landTop(x, z, h);
        if (top === BLOCK.GRASS) grassMtn++;
        else bad.push(`${seed}: a warm range's slope at ${x},${z} (${h}) is ${top}`);
      }
    }
  }
  console.log(`        (summits over the snow line with snow on top: ${summitSnow}; bare rock or snow on ${rock} of ${cols} columns of their chunks; ${grassMtn} grassy lower slopes of warm ranges; lone floating terrain blocks: ${floating})`);
  assert(summitSnow >= summits * 0.6, `snow caps: ${summitSnow} of ${summits}`);
  assert(rock > cols * 0.3, `bare rock or snow: ${rock}`);
  assert(grassMtn >= 20, `grassy slopes: ${grassMtn}`);
  assert(floating <= cols * 0.002, `floating blocks: ${floating}`);
  assert(!bad.length, bad.slice(0, 5).join("; "));
  // Rivers and lakes: as much river and water as before.
  for (const seed of SEEDS) {
    const o = surveyOf(seed, 3);
    const s = surveyOf(seed, 4);
    assert(s.river > o.river * 0.85 && s.river > 0.005, `${seed}: rivers ${s.river} (was ${o.river})`);
  }
  // A river's real chunk holds water.
  const T = new TerrainGenerator(777, G4S);
  let found = 0;
  for (let x = -3000; x < 3000 && found < 3; x += 53) {
    for (let z = -3000; z < 3000 && found < 3; z += 59) {
      const i = T._baseInfo(x, z);
      if (!i.river || i.height >= SEA_LEVEL) continue;
      const blocks = newChunk(T, x >> 4, z >> 4);
      assert(at(blocks, x & 15, SEA_LEVEL, z & 15) === BLOCK.WATER || at(blocks, x & 15, SEA_LEVEL, z & 15) === BLOCK.ICE, `the river at ${x},${z}: ${at(blocks, x & 15, SEA_LEVEL, z & 15)}`);
      found++;
    }
  }
  assert(found === 3, `rivers found: ${found}`);
});

await check("chunk generation time: within ~20% of generator 3's", async () => {
  const areas = [[777, -42, 52], [9001, -14, -20], [42, -60, -10], [12345, 0, 0]];
  const times = { 3: [], 4: [] };
  for (let rep = 0; rep < 5; rep++) {
    for (const g of [3, 4]) {
      let ms = 0;
      let n = 0;
      for (const [seed, cx0, cz0] of areas) {
        const T = new TerrainGenerator(seed, g === 4 ? G4M : G3M);
        T.sites._ensureHome();
        for (let i = 0; i < 4; i++) newChunk(T, cx0 + 50, cz0 + i);
        const t0 = performance.now();
        for (let dx = 0; dx < 6; dx++) for (let dz = 0; dz < 6; dz++, n++) newChunk(T, cx0 + dx, cz0 + dz);
        ms += performance.now() - t0;
      }
      times[g].push(ms / n);
    }
  }
  const a = Math.min(...times[3]);
  const b = Math.min(...times[4]);
  console.log(`        (ms per chunk, mountains and the start, best of 5: generator 3 ${a.toFixed(2)}, generator 4 ${b.toFixed(2)})`);
  assert(b < a * 1.2 + 0.2, `${b.toFixed(2)} ms against ${a.toFixed(2)}`);
});

await check("the far terrain samples the chunks' own heights and blocks (no step where chunks load)", async () => {
  // For each generator: the far terrain's column against the chunk's (its top
  // terrain block under any snow layer, plant or tree). The far terrain has
  // the natural height everywhere (heightAt); where a village's earthworks, a
  // structure or a cave opening changed a chunk's surface, both generators
  // differ alike.
  const rate = {};
  const lines = [];
  for (const g of [3, 4]) {
    let n = 0;
    let same = 0;
    let height = 0;
    let lean = 0;
    const bad = [];
    for (const seed of [777, 9001]) {
      const s = surveyOf(seed, g);
      const T = s.T;
      const L = new LodTerrain(seed, g === 4 ? G4S : G3S);
      const out = {};
      for (const t of s.tops.slice(0, 4)) {
        for (const [ox, oz] of [[0, 0], [-16, 16], [16, -16], [32, 0]]) {
          const cx = (t.x + ox) >> 4;
          const cz = (t.z + oz) >> 4;
          const blocks = newChunk(T, cx, cz);
          for (let lz = 0; lz < 16; lz++) {
            for (let lx = 0; lx < 16; lx++) {
              const x = cx * 16 + lx;
              const z = cz * 16 + lz;
              const h = T.heightAt(x, z);
              if (h < SEA_LEVEL) continue;
              L.sample(x, z, out, 0);
              n++;
              if (out.top === h + 1) height++;
              let y = WORLD_HEIGHT - 1;
              while (y > 0 && !(TERRAIN.has(at(blocks, lx, y, lz)) || at(blocks, lx, y, lz) === out.id)) y--;
              if (out.top === y + 1 && at(blocks, lx, y, lz) === out.id) same++;
              else if (bad.length < 3) bad.push(`${x},${z}: far ${out.top - 1}/${out.id}, chunk ${y}/${at(blocks, lx, y, lz)}`);
              // A coarse cell leans toward its highest quarter point: never below the column.
              L.sample(x, z, out, 4);
              if (out.top >= h + 1) lean++;
            }
          }
        }
      }
    }
    rate[g] = same / n;
    lines.push(`generator ${g}: ${same} of ${n} mountain columns the chunk's top and block, the natural height everywhere ${height === n}, coarse cells never under the ground ${lean === n}${bad.length ? ` (${bad.join("; ")})` : ""}`);
    assert(height === n && lean === n, lines[lines.length - 1]);
  }
  console.log(`        (${lines.join("\n         ")})`);
  assert(rate[4] >= 0.97 || rate[4] >= rate[3] - 0.01, `generator 4: ${rate[4]} against ${rate[3]}`);
});

await check("every new Missions world: a home airport near the start with flat, clear runways and a blended pad; villages; a flat, dry spawn", async () => {
  const bad = [];
  let worst = 0;
  let villages = 0;
  for (let i = 0; i < 16; i++) {
    const seed = (Math.imul(i + 7, 2654435761) >>> 0) % 1000000;
    const T = new TerrainGenerator(seed, G4M);
    const S = T.sites;
    S._ensureHome();
    const h = S.home;
    if (!h) {
      bad.push(`${seed}: no home airport`);
      continue;
    }
    const d = Math.hypot(h.x - S.anchor.x, h.z - S.anchor.z);
    worst = Math.max(worst, d);
    if (d > 1500) bad.push(`${seed}: home ${Math.round(d)} blocks off`);
    const sp = T.spawnColumn();
    const y = T.heightAt(sp[0], sp[1]);
    if (y <= SEA_LEVEL + 1) bad.push(`${seed}: spawn in the water`);
    for (const [dx, dz] of [[2, 0], [-2, 0], [0, 2], [0, -2]]) if (Math.abs(T.heightAt(sp[0] + dx, sp[1] + dz) - y) > 1) bad.push(`${seed}: spawn not flat`);
    if (T.villages.nearestVillage(sp[0], sp[1], 2500)) villages++;
  }
  console.log(`        (the farthest home airport: ${Math.round(worst)} blocks from the start; a village within 2500 blocks of the start in ${villages} of 16 worlds)`);
  assert(!bad.length, bad.slice(0, 6).join("; "));
  assert(villages >= 10, `villages near the start: ${villages} of 16`);
  // The real chunks of the home airport (and another site) of a seed with mountains near.
  const T = new TerrainGenerator(842645, G4M);
  const S = T.sites;
  S._ensureHome();
  const pick = [S.home, ...S.within(S.home.x, S.home.z, 7000).filter((s) => s !== S.home && s.kind === "airport").slice(0, 2)];
  const cache = new Map();
  const blockOf = (x, y, z) => {
    const cx = Math.floor(x) >> 4;
    const cz = Math.floor(z) >> 4;
    const key = `${cx},${cz}`;
    let c = cache.get(key);
    if (!c) {
      c = newChunk(T, cx, cz);
      cache.set(key, c);
      if (cache.size > 600) cache.delete(cache.keys().next().value);
    }
    return at(c, Math.floor(x) - cx * 16, y, Math.floor(z) - cz * 16);
  };
  const RUNWAY = new Set([BLOCK.BEDROCK, BLOCK.WOOL]);
  let cliff = 0;
  let edge = 0;
  for (const s of pick) {
    cache.clear();
    for (const c of [0, ...(s.rw2 ? [s.rw2.v] : [])]) {
      for (let u = -s.half; u <= s.half; u += 5) {
        for (let dv = -s.rw; dv <= s.rw; dv += 3) {
          const [x, z] = S.toWorld(s, u, c + dv);
          if (!RUNWAY.has(blockOf(x, s.y, z))) bad.push(`${s.id} runway at ${u},${dv}: ${blockOf(x, s.y, z)}`);
          for (let y = s.y + 1; y <= s.y + 6; y++) if (blockOf(x, y, z) !== BLOCK.AIR) bad.push(`${s.id} over the runway at ${u},${dv},+${y - s.y}`);
          if (bad.length > 5) break;
        }
      }
    }
    const r = s.rect;
    const rays = [];
    for (let u = r.u0 - S.blend; u <= r.u1 + S.blend; u += 6) rays.push([u, r.v0, 0, -1], [u, r.v1, 0, 1]);
    for (let v = r.v0; v <= r.v1; v += 6) rays.push([r.u0, v, -1, 0], [r.u1, v, 1, 0]);
    for (const [ru, rv, du, dv] of rays) {
      let prev = null;
      for (let k = 0; k <= S.blend + 4; k++) {
        const [x, z] = S.toWorld(s, ru + du * k, rv + dv * k);
        const h = T.heightAt(x, z);
        if (prev !== null) {
          edge++;
          if (Math.abs(h - prev) > 4) cliff++;
        }
        prev = h;
      }
    }
  }
  console.log(`        (${pick.map((s) => `${s.id} ${s.size}`).join(", ")}: steps over 4 blocks round the pads ${cliff} of ${edge})`);
  assert(!bad.length, bad.slice(0, 6).join("; "));
  assert(cliff / edge < 0.01, `cliffs: ${cliff} of ${edge}`);
});

// ---------- In the browser ----------

if (!args.node) await browserChecks();

async function browserChecks() {
  const { chromium } = await import("playwright-core");
  const PORT = 11720 + Math.floor(Math.random() * 20);
  const MIME = { ".html": "text/html", ".js": "text/javascript", ".json": "application/json" };
  const server = http.createServer((req, res) => {
    let filePath = path.join(ROOT, decodeURIComponent(req.url.split("?")[0]));
    if (filePath.endsWith("/")) filePath = path.join(filePath, "index.html");
    fs.readFile(filePath, (err, data) => {
      if (err) {
        res.writeHead(404);
        res.end("not found");
        return;
      }
      res.writeHead(200, { "Content-Type": MIME[path.extname(filePath)] || "application/octet-stream" });
      res.end(data);
    });
  });
  await new Promise((r) => server.listen(PORT, "127.0.0.1", r));
  const errors = [];
  const browser = await chromium.launch({
    executablePath: (await import("./chromium-path.mjs")).default,
    args: ["--use-gl=swiftshader", "--enable-webgl", "--ignore-gpu-blocklist", "--no-sandbox", "--disable-dev-shm-usage", "--autoplay-policy=no-user-gesture-required"],
  });
  const localThreeRoot = path.join(__dirname, "node_modules", "three");
  const peerjsFile = path.join(__dirname, "node_modules", "peerjs", "dist", "peerjs.min.js");
  async function newPage(label, init = null, size = { width: 960, height: 540 }) {
    const ctx = await browser.newContext({ viewport: size });
    if (init) await ctx.addInitScript(init.fn, init.arg);
    const p = await ctx.newPage();
    await p.route("https://cdn.jsdelivr.net/npm/three@0.160.0/**", (route) => {
      const rel = new URL(route.request().url()).pathname.replace("/npm/three@0.160.0/", "");
      route.fulfill({ path: path.join(localThreeRoot, rel), contentType: "text/javascript" });
    });
    await p.route("https://cdn.jsdelivr.net/npm/peerjs@1.5.4/**", (route) => route.fulfill({ path: peerjsFile, contentType: "text/javascript" }));
    p.on("console", (m) => {
      if (m.type() === "error") errors.push(`[${label}] ${m.text()}`);
      if (args.verbose) console.log(`    [${label}] ${m.text()}`);
    });
    p.on("pageerror", (e) => errors.push(`[${label}] ${String(e)}`));
    p.on("dialog", (d) => d.accept());
    return p;
  }
  const frames = (p, n = 2) =>
    p.evaluate(
      (k) =>
        new Promise((r) => {
          let i = 0;
          const f = () => (++i >= k ? r() : requestAnimationFrame(f));
          requestAnimationFrame(f);
        }),
      n
    );
  const v = (p, fn, arg) => p.evaluate(([src, a]) => new Function("g", "arg", `return (${src})(g, arg);`)(window.__ufo, a), [fn.toString(), arg]);
  async function play(p) {
    const t0 = Date.now();
    while (Date.now() - t0 < 180000) {
      const st = await v(p, (g) => g.gameState);
      if (st === "playing") return;
      if (st === "dead") {
        await v(p, (g) => g.respawn());
        continue;
      }
      for (const id of ["mp-lobby", "mp-screen"]) await p.evaluate((i) => document.getElementById(i)?.classList.add("hidden"), id);
      if (st === "start") await p.click("#play-btn", { timeout: 5000 }).catch(() => {});
      else if (await p.isVisible("#resume-btn")) await p.click("#resume-btn", { timeout: 3000 }).catch(() => {});
      else if (await p.isVisible("#click-to-play").catch(() => false)) await p.click("#click-to-play", { timeout: 3000 }).catch(() => {});
      else {
        await v(p, (g) => g.screens.closeAll());
        await p.mouse.click(300, 200);
        await frames(p, 5);
      }
      await frames(p, 3);
    }
    throw new Error("the game didn't start playing");
  }
  const browserCheck = async (name, fn) => {
    const before = errors.length;
    await check(name, async () => {
      try {
        await fn();
      } catch (err) {
        if (errors.length > before) err.message += ` (console errors: ${errors.slice(before, before + 3).join(" | ")})`;
        throw err;
      }
      if (errors.length > before) throw new Error(`console errors: ${errors.slice(before, before + 3).join(" | ")}`);
    });
  };
  const SHOTS = process.env.SHOTS || "";
  if (SHOTS) fs.mkdirSync(SHOTS, { recursive: true });
  // Flies the player (Creative) over (x, z), `back` blocks south of it at height `up`, looking north and down.
  const flyOver = (p, x, z, back = 320, up = 185, pitch = -0.2) =>
    v(
      p,
      async (g, o) => {
        g.setMode?.("creative");
        g.player.damage = () => false;
        g.player.flying = true;
        g.player.velocity.set(0, 0, 0);
        g.player.position.set(o.x, o.up, o.z + o.back);
        g.player.yaw = 0;
        g.player.pitch = o.pitch;
        g.sky.locked = true;
        g.sky.setHours(11);
        g.world.prepareArea(o.x, o.z, 2);
        let still = 0;
        for (let i = 0; i < 1500; i++) {
          await new Promise((r) => requestAnimationFrame(r));
          g.player.velocity.set(0, 0, 0);
          if (g.world.isIdle && g.lod.busy === 0 && i > 30) still++;
          else still = 0;
          if (still > 20) break;
        }
        return true;
      },
      { x, z, back, up, pitch }
    );

  // ---------- A new Survival world ----------
  const S_SEED = 9001;
  const sv = surveyOf(S_SEED, 4);
  const peak = sv.tops[0];
  const page = await newPage("survival");
  await page.goto(`http://127.0.0.1:${PORT}/index.html?seed=${S_SEED}&type=survival&graphics=low`, { waitUntil: "load", timeout: 60000 });
  await page.waitForFunction(() => !!window.__ufo && window.__ufo.graphicsReady, null, { timeout: 120000 });
  await play(page);

  await browserCheck("a new Survival world: generator 4; the chunk workers' chunks and the far terrain's heights are the main thread's", async () => {
    const r = await v(page, async (g) => {
      const W = await import("./js/worldtype.js");
      return { gen: W.terrainGen(), opts: g.world.terrainOptions, v2: !!g.world.terrain.options.terrainV2, workers: (g.world._genWorkers || g.world.genWorkers || []).length };
    });
    assert(r.gen === 4 && r.opts.terrainV2 && r.v2 && !r.opts.sites, `the generator: ${JSON.stringify(r)}`);
    await flyOver(page, peak.x, peak.z, 0, peak.h + 30, -1.2); // (right over it: the chunks round it stay loaded)
    // The loaded chunks round the summit (made by the workers) against the main thread's own generator, block for block.
    const m = await v(
      page,
      async (g, o) => {
        const { LodTerrain } = await import("./js/lod-mesher.js");
        const L = new LodTerrain(g.world.seed, g.world.terrainOptions);
        const out = {};
        let chunks = 0;
        let diff = 0;
        let cols = 0;
        let far = 0;
        for (let dz = -2; dz <= 2; dz++) {
          for (let dx = -2; dx <= 2; dx++) {
            const cx = (o.x >> 4) + dx;
            const cz = (o.z >> 4) + dz;
            const c = g.world.getChunk(cx, cz);
            if (!c) continue;
            chunks++;
            const mine = { cx, cz, blocks: new Uint16Array(c.blocks.length) };
            g.world.terrain.generate(mine);
            const edits = g.world.edits.get(`${cx},${cz}`);
            for (let i = 0; i < mine.blocks.length; i++) if (mine.blocks[i] !== c.blocks[i] && !edits?.has(i)) diff++;
            for (let k = 0; k < 16; k++) {
              const x = cx * 16 + k;
              const z = cz * 16 + ((k * 7) & 15);
              cols++;
              L.sample(x, z, out, 0);
              if (out.top === g.world.terrain.heightAt(x, z) + 1 || g.world.terrain.heightAt(x, z) < 24) far++;
            }
          }
        }
        return { chunks, diff, cols, far, top: g.world.terrain.heightAt(o.x, o.z) };
      },
      { x: peak.x, z: peak.z }
    );
    assert(m.chunks >= 9 && m.diff === 0, `the loaded chunks: ${JSON.stringify(m)}`);
    assert(m.far === m.cols && m.top === peak.h, `the far terrain: ${JSON.stringify(m)} (summit ${peak.h})`);
    if (SHOTS) {
      await page.keyboard.press("F1");
      await flyOver(page, peak.x, peak.z);
      await page.screenshot({ path: path.join(SHOTS, `survival-${S_SEED}-summit.png`) });
      await flyOver(page, peak.x, peak.z, 800, 195, -0.1);
      await page.screenshot({ path: path.join(SHOTS, `survival-${S_SEED}-far.png`) });
      await page.keyboard.press("F1");
    }
  });
  await page.context().close();

  // ---------- A new Missions world ----------
  const M_SEED = 842645;
  const mpage = await newPage("missions");
  await mpage.goto(`http://127.0.0.1:${PORT}/index.html?seed=${M_SEED}&type=missions&graphics=low`, { waitUntil: "load", timeout: 60000 });
  await mpage.waitForFunction(() => !!window.__ufo && window.__ufo.graphicsReady, null, { timeout: 120000 });
  await play(mpage);

  await browserCheck("a new Missions world: generator 4, the home airport near the start, its runway's real blocks flat and clear, a village near", async () => {
    const r = await v(mpage, async (g) => {
      const W = await import("./js/worldtype.js");
      const { BLOCK } = await import("./js/blocks.js");
      g.testFlags && (g.testFlags.noMissions = true);
      const s = g.sites.home;
      const out = { gen: W.terrainGen(), opts: g.world.terrainOptions, home: s && { id: s.id, d: Math.round(Math.hypot(s.x - g.spawn.x, s.z - g.spawn.z)) } };
      if (!s) return out;
      const bad = [];
      for (let u = -s.half; u <= s.half; u += 9) {
        for (let dv = -s.rw; dv <= s.rw; dv += 4) {
          const [x, z] = g.sites.toWorld(s, u, dv);
          if (!g.world.getChunk(Math.floor(x) >> 4, Math.floor(z) >> 4)) g.world._generate(Math.floor(x) >> 4, Math.floor(z) >> 4);
          const b = g.world.getBlock(Math.floor(x), s.y, Math.floor(z));
          let clear = true;
          for (let y = s.y + 1; y <= s.y + 6; y++) if (g.world.getBlock(Math.floor(x), y, Math.floor(z)) !== BLOCK.AIR) clear = false;
          if ((b !== BLOCK.BEDROCK && b !== BLOCK.WOOL) || !clear) bad.push(`${u},${dv}:${b}`);
        }
      }
      out.bad = bad.slice(0, 5);
      const vil = g.world.terrain.villages.nearestVillage(g.spawn.x, g.spawn.z, 3000);
      out.village = vil ? Math.round(Math.hypot(vil.x - g.spawn.x, vil.z - g.spawn.z)) : null;
      return out;
    });
    assert(r.gen === 4 && r.opts.terrainV2 && r.opts.bigAirports && r.opts.sites, `the generator: ${JSON.stringify(r)}`);
    assert(r.home && r.home.d < 1500, `the home airport: ${JSON.stringify(r.home)}`);
    assert(r.bad && !r.bad.length, `the runway: ${JSON.stringify(r.bad)}`);
    assert(r.village !== null, "no village within 3000 blocks of the start");
    console.log(`        (home airport ${r.home.id} ${r.home.d} blocks from the start, a village ${r.village} blocks off)`);
  });
  await mpage.context().close();

  // ---------- An older Survival world: its record says generator 3 ----------
  await browserCheck("an older Survival world (saved with generator 3) keeps its land", async () => {
    const T = new TerrainGenerator(S_SEED, G3S);
    const old = await newPage("old", {
      fn: ([seed]) => {
        try {
          if (!localStorage.getItem(`ufocombat_v1_world_${seed}`)) localStorage.setItem(`ufocombat_v1_world_${seed}`, JSON.stringify({ type: "survival", gen: 3 }));
        } catch {}
      },
      arg: [S_SEED],
    });
    await old.goto(`http://127.0.0.1:${PORT}/index.html?seed=${S_SEED}&type=survival&graphics=low`, { waitUntil: "load", timeout: 60000 });
    await old.waitForFunction(() => !!window.__ufo && window.__ufo.graphicsReady, null, { timeout: 120000 });
    await play(old);
    const pts = [[peak.x, peak.z], [-206, -302], [0, 0], [500, -700]];
    const r = await v(
      old,
      async (g, list) => {
        const W = await import("./js/worldtype.js");
        return { gen: W.terrainGen(), opts: g.world.terrainOptions, hs: list.map(([x, z]) => g.world.terrain.heightAt(x, z)) };
      },
      pts
    );
    const want = pts.map(([x, z]) => T.heightAt(x, z));
    assert(r.gen === 3 && !("terrainV2" in r.opts), `the generator: ${JSON.stringify(r)}`);
    assert(JSON.stringify(r.hs) === JSON.stringify(want), `the land: ${r.hs} (want ${want})`);
    await old.context().close();
  });

  await browser.close();
  server.close();
}

const failed = results.filter((r) => !r[1]);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
