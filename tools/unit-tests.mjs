// Fast unit tests for the game's pure-logic modules, run directly in Node
// (no browser). Complements smoke-test.mjs, which drives the real game.
import assert from "node:assert/strict";
import { encodeChunkEdits, decodeChunkEdits, parseEdits, serializeEdits, setEdit } from "../js/storage.js";
import { CHUNK_SIZE, WORLD_HEIGHT, blockIndex } from "../js/constants.js";

let passed = 0;
let failed = 0;
async function test(name, fn) {
  try {
    await fn();
    passed++;
    console.log(`  PASS  ${name}`);
  } catch (err) {
    failed++;
    console.log(`  FAIL  ${name}\n        ${err.stack?.split("\n").slice(0, 3).join("\n        ")}`);
  }
}

// Deterministic PRNG so failures are reproducible.
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

console.log("Save format (storage.js)");

await test("chunk edits round-trip through the run-length encoding", () => {
  const rand = rng(1);
  for (let trial = 0; trial < 50; trial++) {
    const map = new Map();
    const n = Math.floor(rand() * 3000);
    for (let i = 0; i < n; i++) {
      map.set(Math.floor(rand() * CHUNK_SIZE * CHUNK_SIZE * WORLD_HEIGHT), Math.floor(rand() * 256));
    }
    const decoded = decodeChunkEdits(encodeChunkEdits(map));
    assert.equal(decoded.size, map.size);
    for (const [k, v] of map) assert.equal(decoded.get(k), v, `index ${k}`);
  }
});

await test("long runs (> 255) and index extremes encode correctly", () => {
  const map = new Map();
  for (let i = 0; i < 1000; i++) map.set(i, 0); // one long run of air
  map.set(CHUNK_SIZE * CHUNK_SIZE * WORLD_HEIGHT - 1, 7); // last index in a chunk
  const decoded = decodeChunkEdits(encodeChunkEdits(map));
  assert.deepEqual([...decoded.entries()].sort((a, b) => a[0] - b[0]), [...map.entries()].sort((a, b) => a[0] - b[0]));
});

await test("a Blast Orb-sized crater compresses to a small fraction of the legacy format", () => {
  const map = new Map();
  let legacyLen = 0;
  const r = 7;
  for (let y = 20; y < 36; y++) {
    for (let z = 0; z < 16; z++) {
      for (let x = 0; x < 16; x++) {
        if ((x - 8) ** 2 + (y - 28) ** 2 + (z - 8) ** 2 <= r * r) {
          map.set(blockIndex(x, y, z), 0);
          legacyLen += `${x},${y},${z},0,`.length;
        }
      }
    }
  }
  const encoded = encodeChunkEdits(map);
  console.log(`        ${map.size} blocks: ${encoded.length} chars vs ~${legacyLen} chars in the old flat-array format`);
  assert.ok(encoded.length * 5 < legacyLen, "expected at least 5x smaller than the legacy encoding");
});

await test("legacy flat [x,y,z,id,...] saves are still read correctly", () => {
  const legacy = [0, 22, 8, 0, -3, 23, 9, 5, -17, 10, 33, 8];
  const edits = parseEdits(legacy);
  assert.equal(edits.get("0,0").get(blockIndex(0, 22, 8)), 0);
  assert.equal(edits.get("-1,0").get(blockIndex(13, 23, 9)), 5);
  assert.equal(edits.get("-2,2").get(blockIndex(15, 10, 1)), 8);
});

await test("serialize -> JSON -> parse preserves every edit, with and without the encode cache", () => {
  const edits = new Map();
  const rand = rng(7);
  for (let i = 0; i < 2000; i++) {
    setEdit(edits, Math.floor(rand() * 9) - 4, Math.floor(rand() * 9) - 4, Math.floor(rand() * 16384), Math.floor(rand() * 20));
  }
  const cache = new Map();
  const first = JSON.stringify(serializeEdits(edits, cache, new Set(edits.keys())));
  // Change one chunk; only it is marked dirty, the rest come from the cache.
  setEdit(edits, 0, 0, 123, 9);
  const second = JSON.parse(JSON.stringify(serializeEdits(edits, cache, new Set(["0,0"]))));
  const parsed = parseEdits(second);
  assert.equal(parsed.size, edits.size);
  for (const [key, map] of edits) {
    for (const [idx, id] of map) assert.equal(parsed.get(key).get(idx), id);
  }
  assert.notEqual(first, JSON.stringify(second));
});

await test("one corrupted chunk doesn't discard the other chunks' edits", () => {
  const edits = new Map();
  setEdit(edits, 0, 0, 5, 3);
  setEdit(edits, 1, 0, 6, 4);
  const data = serializeEdits(edits);
  data.chunks["1,0"] = "@@not base64@@";
  const warn = console.warn;
  console.warn = () => {};
  try {
    const parsed = parseEdits(data);
    assert.equal(parsed.get("0,0").get(5), 3);
    assert.equal(parsed.has("1,0"), false);
  } finally {
    console.warn = warn;
  }
});

await test("garbage input yields no edits instead of throwing", () => {
  for (const bad of [null, 42, "x", {}, { v: 3 }, { v: 2, chunks: null }, { v: 2, chunks: { "a,b": "AAAA" } }]) {
    assert.equal(parseEdits(bad).size, 0);
  }
});

// ---------------------------------------------------------------------------
console.log("\nLight engine (light.js) vs. brute-force reference");

const { LightEngine } = await import("../js/light.js");
const { BLOCK, IS_OPAQUE, LIGHT_FILTER, SKY_PASS, EMISSION } = await import("../js/blocks.js");

const H = WORLD_HEIGHT;
const DIRS = [
  [1, 0, 0],
  [-1, 0, 0],
  [0, 1, 0],
  [0, -1, 0],
  [0, 0, 1],
  [0, 0, -1],
];

function makeTestWorld(size, seed) {
  const rand = rng(seed);
  const chunks = new Map();
  const world = {
    getChunk: (cx, cz) => chunks.get(`${cx},${cz}`),
    chunks,
    get(x, y, z) {
      const c = world.getChunk(x >> 4, z >> 4);
      return c && y >= 0 && y < H ? c.blocks[(y << 8) | ((z & 15) << 4) | (x & 15)] : undefined;
    },
    set(x, y, z, id) {
      world.getChunk(x >> 4, z >> 4).blocks[(y << 8) | ((z & 15) << 4) | (x & 15)] = id;
    },
  };
  const allBlocks = [];
  for (let cx = 0; cx < size; cx++) {
    for (let cz = 0; cz < size; cz++) {
      allBlocks.push({ cx, cz, blocks: new Uint8Array(16 * 16 * H), light: new Uint8Array(16 * 16 * H) });
    }
  }
  // Terrain: rolling height field, water below y=20, caves, trees, glass,
  // overhangs, and light sources both underground and on the surface.
  const W = size * 16;
  const heightAt = (x, z) => Math.floor(22 + 6 * Math.sin(x * 0.21) * Math.cos(z * 0.17) + 3 * Math.sin((x + z) * 0.4));
  for (const c of allBlocks) chunks.set(`${c.cx},${c.cz}`, c);
  for (let x = 0; x < W; x++) {
    for (let z = 0; z < W; z++) {
      const h = heightAt(x, z);
      for (let y = 0; y < H; y++) {
        let id = BLOCK.AIR;
        if (y <= h) id = y > h - 3 ? BLOCK.DIRT : BLOCK.STONE;
        else if (y <= 20) id = BLOCK.WATER;
        world.set(x, y, z, id);
      }
    }
  }
  const blob = (x0, y0, z0, r, id) => {
    for (let x = x0 - r; x <= x0 + r; x++) {
      for (let y = y0 - r; y <= y0 + r; y++) {
        for (let z = z0 - r; z <= z0 + r; z++) {
          if (x < 0 || z < 0 || x >= W || z >= W || y < 0 || y >= H) continue;
          if ((x - x0) ** 2 + (y - y0) ** 2 + (z - z0) ** 2 <= r * r) world.set(x, y, z, id);
        }
      }
    }
  };
  for (let i = 0; i < size * size * 3; i++) blob(Math.floor(rand() * W), 4 + Math.floor(rand() * 20), Math.floor(rand() * W), 2 + Math.floor(rand() * 3), BLOCK.AIR);
  for (let i = 0; i < size * size * 2; i++) {
    const x = Math.floor(rand() * W);
    const z = Math.floor(rand() * W);
    const h = heightAt(x, z);
    if (h <= 20) continue;
    for (let y = h + 1; y <= h + 4; y++) world.set(x, y, z, BLOCK.WOOD);
    blob(x, h + 5, z, 2, BLOCK.LEAVES);
  }
  for (let i = 0; i < size * size * 4; i++) {
    const x = Math.floor(rand() * W);
    const z = Math.floor(rand() * W);
    const y = 2 + Math.floor(rand() * 40);
    world.set(x, y, z, [BLOCK.TORCH, BLOCK.LUMEN, BLOCK.GLASS, BLOCK.STONE][Math.floor(rand() * 4)]);
  }
  // A floating roof, so there is shade that has to be filled in sideways.
  for (let x = 3; x < 12; x++) for (let z = 3; z < 12; z++) world.set(x, 45, z, BLOCK.PLANKS);
  return { world, chunkList: allBlocks, rand, W };
}

// Recomputes all light from scratch by relaxing until nothing changes.
function referenceLight(world, chunkList) {
  const ref = new Map();
  for (const c of chunkList) ref.set(c, new Uint8Array(16 * 16 * H));
  for (const c of chunkList) {
    const L = ref.get(c);
    for (let lz = 0; lz < 16; lz++) {
      for (let lx = 0; lx < 16; lx++) {
        let level = 15;
        for (let y = H - 1; y >= 0; y--) {
          const idx = (y << 8) | (lz << 4) | lx;
          const id = c.blocks[idx];
          if (IS_OPAQUE[id]) break;
          if (!(level === 15 && SKY_PASS[id])) level -= 1 + LIGHT_FILTER[id];
          if (level <= 0) break;
          L[idx] = level << 4;
        }
      }
    }
    for (let idx = 0; idx < L.length; idx++) L[idx] |= EMISSION[c.blocks[idx]];
  }
  let changed = true;
  while (changed) {
    changed = false;
    for (const c of chunkList) {
      const L = ref.get(c);
      for (let idx = 0; idx < L.length; idx++) {
        const sky = L[idx] >> 4;
        const blk = L[idx] & 15;
        if (sky <= 1 && blk <= 1) continue;
        const x = c.cx * 16 + (idx & 15);
        const y = idx >> 8;
        const z = c.cz * 16 + ((idx >> 4) & 15);
        for (let d = 0; d < 6; d++) {
          const [dx, dy, dz] = DIRS[d];
          const ny = y + dy;
          if (ny < 0 || ny >= H) continue;
          const nc = world.getChunk((x + dx) >> 4, (z + dz) >> 4);
          if (!nc) continue;
          const nidx = (ny << 8) | (((z + dz) & 15) << 4) | ((x + dx) & 15);
          const nid = nc.blocks[nidx];
          if (IS_OPAQUE[nid]) continue;
          const NL = ref.get(nc);
          const scost = d === 3 && sky === 15 && SKY_PASS[nid] ? 0 : 1 + LIGHT_FILTER[nid];
          const bcost = 1 + LIGHT_FILTER[nid];
          if (sky - scost > NL[nidx] >> 4) {
            NL[nidx] = (NL[nidx] & 15) | ((sky - scost) << 4);
            changed = true;
          }
          if (blk - bcost > (NL[nidx] & 15)) {
            NL[nidx] = (NL[nidx] & 0xf0) | (blk - bcost);
            changed = true;
          }
        }
      }
    }
  }
  return ref;
}

function compareLight(world, chunkList, label) {
  const ref = referenceLight(world, chunkList);
  let mismatches = 0;
  let first = null;
  for (const c of chunkList) {
    const R = ref.get(c);
    for (let idx = 0; idx < R.length; idx++) {
      if (R[idx] !== c.light[idx]) {
        mismatches++;
        if (!first) {
          first = `chunk ${c.cx},${c.cz} x=${idx & 15} y=${idx >> 8} z=${(idx >> 4) & 15} block=${c.blocks[idx]}: engine sky/blk ${c.light[idx] >> 4}/${c.light[idx] & 15}, reference ${R[idx] >> 4}/${R[idx] & 15}`;
        }
      }
    }
  }
  assert.equal(mismatches, 0, `${label}: ${mismatches} cells differ from the reference; first: ${first}`);
}

await test("chunks lit one at a time in random order match a full recompute", () => {
  for (const seed of [11, 12, 13]) {
    const { world, chunkList, rand } = makeTestWorld(3, seed);
    const order = [...chunkList].sort(() => rand() - 0.5);
    // Chunks "load" one by one: only already-loaded chunks are visible to the engine.
    const loaded = new Map();
    const view = { getChunk: (cx, cz) => loaded.get(`${cx},${cz}`) };
    const engine = new LightEngine(view);
    for (const c of order) {
      loaded.set(`${c.cx},${c.cz}`, c);
      engine.initChunk(c);
    }
    compareLight(world, chunkList, `seed ${seed}`);
  }
});

await test("random batches of block edits keep light identical to a full recompute", () => {
  const { world, chunkList, rand, W } = makeTestWorld(3, 99);
  const engine = new LightEngine(world);
  for (const c of chunkList) engine.initChunk(c);
  compareLight(world, chunkList, "initial");
  const palette = [BLOCK.AIR, BLOCK.AIR, BLOCK.AIR, BLOCK.STONE, BLOCK.TORCH, BLOCK.LUMEN, BLOCK.LEAVES, BLOCK.GLASS, BLOCK.WATER, BLOCK.PLANKS];
  for (let round = 0; round < 60; round++) {
    const changes = [];
    const n = 1 + Math.floor(rand() * (round % 10 === 0 ? 400 : 6)); // occasionally a big blast-sized batch
    const cx0 = Math.floor(rand() * W);
    const cy0 = Math.floor(rand() * 50);
    const cz0 = Math.floor(rand() * W);
    for (let i = 0; i < n; i++) {
      const x = Math.min(W - 1, Math.max(0, cx0 + Math.floor((rand() - 0.5) * 16)));
      const y = Math.min(H - 1, Math.max(0, cy0 + Math.floor((rand() - 0.5) * 16)));
      const z = Math.min(W - 1, Math.max(0, cz0 + Math.floor((rand() - 0.5) * 16)));
      world.set(x, y, z, palette[Math.floor(rand() * palette.length)]);
      changes.push(x, y, z);
    }
    engine.applyChanges(changes);
    compareLight(world, chunkList, `after edit round ${round} (${n} changes)`);
  }
});

await test("digging to the top of the world and roofing a column update sky light", () => {
  const { world, chunkList } = makeTestWorld(2, 5);
  const engine = new LightEngine(world);
  for (const c of chunkList) engine.initChunk(c);
  // Place a block at the very top of the world over an open column.
  world.set(20, H - 1, 20, BLOCK.STONE);
  engine.applyChanges([20, H - 1, 20]);
  compareLight(world, chunkList, "roof at top");
  world.set(20, H - 1, 20, BLOCK.AIR);
  engine.applyChanges([20, H - 1, 20]);
  compareLight(world, chunkList, "roof removed");
});

await test("changed-chunk set includes neighbors when light changes on a border", () => {
  const { world, chunkList } = makeTestWorld(2, 8);
  const engine = new LightEngine(world);
  for (const c of chunkList) engine.initChunk(c);
  // A torch right at the corner between chunks (15,15) of chunk 0,0.
  let y = H - 1;
  while (y > 0 && world.get(15, y - 1, 15) === BLOCK.AIR) y--;
  world.set(15, y, 15, BLOCK.TORCH);
  const changed = engine.applyChanges([15, y, 15]);
  const keys = new Set([...changed].map((c) => `${c.cx},${c.cz}`));
  for (const k of ["0,0", "1,0", "0,1", "1,1"]) assert.ok(keys.has(k), `expected chunk ${k} in changed set, got ${[...keys]}`);
});

// ---------------------------------------------------------------------------
console.log("\nTerrain generation (terrain.js)");

const { TerrainGenerator } = await import("../js/terrain.js");
const { SEA_LEVEL } = await import("../js/constants.js");

function generateRegion(seed, size, ox = 0, oz = 0) {
  const gen = new TerrainGenerator(seed);
  const chunks = new Map();
  for (let cx = ox; cx < ox + size; cx++) {
    for (let cz = oz; cz < oz + size; cz++) {
      const c = { cx, cz, blocks: new Uint8Array(16 * 16 * H) };
      gen.generate(c);
      chunks.set(`${cx},${cz}`, c);
    }
  }
  const get = (x, y, z) => {
    const c = chunks.get(`${x >> 4},${z >> 4}`);
    if (!c || y < 0 || y >= H) return undefined;
    return c.blocks[(y << 8) | ((z & 15) << 4) | (x & 15)];
  };
  return { gen, chunks, get };
}

await test("no stray water: every generated water block is walled in (no air beside or below it), and seagrass/kelp stand in water", async () => {
  const { BLOCK: B, IS_WET: WET } = await import("../js/blocks.js");
  for (const seed of [42, 2024, 7]) {
    const { get } = generateRegion(seed, 7);
    let water = 0;
    for (let x = 1; x < 7 * 16 - 1; x++) {
      for (let z = 1; z < 7 * 16 - 1; z++) {
        for (let y = 1; y < H - 1; y++) {
          const id = get(x, y, z);
          if (id === B.WATER) {
            water++;
            for (const [dx, dy, dz] of [[1, 0, 0], [-1, 0, 0], [0, 0, 1], [0, 0, -1], [0, -1, 0]]) {
              assert.notEqual(get(x + dx, y + dy, z + dz), B.AIR, `seed ${seed}: water at ${x},${y},${z} has air at +${dx},${dy},${dz}`);
            }
          } else if (id === B.SEAGRASS || id === B.KELP) {
            for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
              const n = get(x + dx, y, z + dz);
              assert.ok(n !== B.AIR || y >= SEA_LEVEL, `seed ${seed}: underwater plant at ${x},${y},${z} next to air`);
            }
            assert.ok(WET[id], "underwater plants count as water");
          }
        }
      }
    }
    assert.ok(water > 0, `seed ${seed}: some water generated`);
  }
});

await test("generation is deterministic and keeps the original height map", () => {
  const a = generateRegion(1234, 2);
  const b = generateRegion(1234, 2);
  for (const [k, c] of a.chunks) assert.deepEqual(c.blocks, b.chunks.get(k).blocks, `chunk ${k} differs between runs`);
  // Surface blocks sit exactly at heightAt (unless a cave opened the surface there).
  let matches = 0;
  let total = 0;
  for (let x = 0; x < 32; x++) {
    for (let z = 0; z < 32; z++) {
      const h = a.gen.heightAt(x, z);
      total++;
      if ([BLOCK.GRASS, BLOCK.SAND].includes(a.get(x, h, z))) matches++;
    }
  }
  assert.ok(matches / total > 0.9, `only ${matches}/${total} columns have their surface at heightAt`);
});

await test("caves never leave air touching water, and never break the bedrock floor", () => {
  for (const seed of [42, 7, 99991]) {
    const { chunks, get } = generateRegion(seed, 5, -2, -2);
    let wet = 0;
    for (let x = -32 + 1; x < 48 - 1; x++) {
      for (let z = -32 + 1; z < 48 - 1; z++) {
        assert.equal(get(x, 0, z), BLOCK.BEDROCK, `hole in the bedrock floor at ${x},${z}`);
        for (let y = 1; y <= SEA_LEVEL; y++) {
          if (get(x, y, z) !== BLOCK.AIR) continue;
          for (const [dx, dy, dz] of DIRS) {
            if (get(x + dx, y + dy, z + dz) === BLOCK.WATER) wet++;
          }
        }
      }
    }
    assert.equal(wet, 0, `seed ${seed}: ${wet} air cells touch water`);
  }
});

await test("caves, ores and crystals appear in sensible amounts", () => {
  const { gen, chunks } = generateRegion(42, 6);
  const counts = {};
  let underground = 0;
  let caveAir = 0;
  for (const c of chunks.values()) {
    for (let lz = 0; lz < 16; lz++) {
      for (let lx = 0; lx < 16; lx++) {
        const h = gen.heightAt(c.cx * 16 + lx, c.cz * 16 + lz);
        for (let y = 2; y < h - 3; y++) {
          const id = c.blocks[(y << 8) | (lz << 4) | lx];
          underground++;
          if (id === BLOCK.AIR) caveAir++;
          counts[id] = (counts[id] || 0) + 1;
        }
      }
    }
  }
  const n = chunks.size;
  const per = (id) => ((counts[id] || 0) / n).toFixed(1);
  console.log(`        underground cave air ${((caveAir / underground) * 100).toFixed(1)}%; per chunk: coal ${per(BLOCK.COAL_ORE)}, iron ${per(BLOCK.IRON_ORE)}, gold ${per(BLOCK.GOLD_ORE)}, diamond ${per(BLOCK.DIAMOND_ORE)}, gravel ${per(BLOCK.GRAVEL)}, lumen ${per(BLOCK.LUMEN)}`);
  assert.ok(caveAir / underground > 0.015 && caveAir / underground < 0.2, "cave volume out of range");
  assert.ok(counts[BLOCK.COAL_ORE] > counts[BLOCK.GOLD_ORE], "ore rarity order");
  assert.ok(!counts[BLOCK.IRON_ORE] && !counts[BLOCK.DIAMOND_ORE], "no iron or diamond ore generates any more (Round 6)");
  assert.ok((counts[BLOCK.LUMEN] || 0) > 0, "no lumen crystals generated");
});

await test("trees: oaks, birches, pines and old oaks grow, and trees are whole across chunk borders", async () => {
  const { TREE } = await import("../js/trees.js");
  const counts = {};
  for (const seed of [42, 7, 12345]) {
    const gen = new TerrainGenerator(seed);
    for (let x = -320; x < 320; x++) {
      for (let z = -320; z < 320; z++) {
        const r = gen.trees.rootAt(x, z);
        if (r) counts[r.species] = (counts[r.species] || 0) + 1;
      }
    }
  }
  console.log(`        oak ${counts[TREE.OAK]}, birch ${counts[TREE.BIRCH]}, pine ${counts[TREE.PINE]}, old oak ${counts[TREE.OLD_OAK]} in three 640x640 areas`);
  for (const sp of [TREE.OAK, TREE.BIRCH, TREE.PINE, TREE.OLD_OAK]) assert.ok(counts[sp] > 0, `no trees of species ${sp}`);
  assert.ok(counts[TREE.OLD_OAK] < counts[TREE.OAK] / 4, "old oaks should be rare");
  // Every leaf and trunk block of every tree in a region ends up in the
  // generated chunks, even where the tree spans several chunks.
  // Biomes now gate tree density (deserts, oceans, snowy plains and
  // mountains have none), so this samples a much bigger area than before to
  // reliably land on enough forest regardless of where they fall for this seed.
  const { gen, get } = generateRegion(42, 16, -8, -8);
  let trees = 0;
  let crossing = 0;
  let missing = 0;
  for (let x = -128 + 10; x < 128 - 10; x++) {
    for (let z = -128 + 10; z < 128 - 10; z++) {
      const root = gen.trees.rootAt(x, z);
      if (!root) continue;
      trees++;
      const shape = gen.trees.shape(root);
      let spans = false;
      for (let i = 0; i < shape.length; i += 4) {
        const X = x + shape[i];
        const Y = root.h + 1 + shape[i + 1];
        const Z = z + shape[i + 2];
        if (Y < 1 || Y >= H || shape[i + 1] < 0) continue;
        if (X >> 4 !== x >> 4 || Z >> 4 !== z >> 4) spans = true;
        if (get(X, Y, Z) === BLOCK.AIR) missing++;
      }
      if (spans) crossing++;
    }
  }
  console.log(`        ${trees} trees in the region, ${crossing} spanning chunk borders, ${missing} blocks missing`);
  assert.ok(trees > 15 && crossing > 5, `too few trees to check (${trees}, ${crossing} crossing)`);
  assert.equal(missing, 0, "every tree block should be placed, whichever chunk it falls in");
});

await test("biomes: a wide sample covers land, ocean, beach, snow and desert with sensible surface blocks", async () => {
  const { BIOME, isOceanBiome } = await import("../js/biomes.js");
  const gen = new TerrainGenerator(2024);
  const counts = {};
  const bad = [];
  const STEP = 6;
  const R = 900;
  for (let x = -R; x <= R; x += STEP) {
    for (let z = -R; z <= R; z += STEP) {
      const h = gen.heightAt(x, z);
      const biome = gen.biomeAt(x, z);
      counts[biome] = (counts[biome] || 0) + 1;
      if (isOceanBiome(biome) && h >= SEA_LEVEL - 1) bad.push(`${biome} at ${x},${z} has land height ${h}`);
      if (biome === BIOME.BEACH && (h < SEA_LEVEL - 1 || h > SEA_LEVEL + 1)) bad.push(`beach at ${x},${z} height ${h} out of range`);
    }
  }
  const present = Object.keys(counts).length;
  console.log(`        ${present} distinct biomes in a ${2 * R}x${2 * R} sample; counts: ${JSON.stringify(counts)}`);
  assert.equal(bad.length, 0, `biome/height mismatches: ${bad.slice(0, 5).join("; ")}`);
  assert.ok(present >= 8, `expected a wide variety of biomes, only saw ${present}`);
  assert.ok((counts[BIOME.OCEAN] || 0) + (counts[BIOME.DEEP_OCEAN] || 0) + (counts[BIOME.WARM_OCEAN] || 0) > 0, "expected some ocean");
  assert.ok((counts[BIOME.MOUNTAINS] || 0) > 0, "expected some mountains at this scale");
});

await test("biome surface materials: snow on cold ground, sand in deserts, terracotta in badlands, coral/kelp in warm oceans", async () => {
  const { BIOME } = await import("../js/biomes.js");
  const gen = new TerrainGenerator(2024);
  // Search a wide area for one column of each biome of interest, then
  // generate its chunk and check the actual placed surface block.
  const want = [BIOME.SNOWY_PLAINS, BIOME.DESERT, BIOME.BADLANDS, BIOME.WARM_OCEAN];
  const found = {};
  // (Biomes are big since Round 3: search a wide area.)
  for (let x = -5000; x <= 5000 && Object.keys(found).length < want.length; x += 24) {
    for (let z = -5000; z <= 5000 && Object.keys(found).length < want.length; z += 24) {
      const biome = gen.biomeAt(x, z);
      if (want.includes(biome) && !found[biome]) found[biome] = [x, z];
    }
  }
  for (const biome of want) assert.ok(found[biome], `no column of biome ${biome} found to check`);
  const reefBlocks = new Set([BLOCK.CORAL, BLOCK.SEAGRASS, BLOCK.KELP, BLOCK.SAND, BLOCK.WATER]);
  for (const [biome, [x, z]] of Object.entries(found)) {
    const cx = x >> 4;
    const cz = z >> 4;
    const c = { cx, cz, blocks: new Uint8Array(16 * 16 * H) };
    gen.generate(c);
    const lx = x - cx * 16;
    const lz = z - cz * 16;
    const h = gen.heightAt(x, z);
    const at = (y) => c.blocks[(y * 16 + lz) * 16 + lx];
    if (Number(biome) === BIOME.SNOWY_PLAINS) assert.equal(at(h), BLOCK.SNOW, `snowy plains column should be snow-capped (got ${at(h)})`);
    else if (Number(biome) === BIOME.DESERT) assert.equal(at(h), BLOCK.SAND, `desert column should be sand (got ${at(h)})`);
    else if (Number(biome) === BIOME.BADLANDS) assert.equal(at(h), BLOCK.TERRACOTTA, `badlands column should be terracotta (got ${at(h)})`);
    else if (Number(biome) === BIOME.WARM_OCEAN) assert.ok(reefBlocks.has(at(h + 1)) || reefBlocks.has(at(h)), `warm ocean column should have a normal sea-floor/reef block`);
  }
});

await test("forest density: open meadows have no trees, and no-tree biomes (desert, ocean, snowy plains, mountains) never grow any", async () => {
  const { BIOME } = await import("../js/biomes.js");
  const gen = new TerrainGenerator(99);
  let openZero = 0;
  let openChecked = 0;
  for (let x = -600; x <= 600; x += 3) {
    for (let z = -600; z <= 600; z += 3) {
      const { density, forest } = gen.trees._density(x, z);
      if (forest <= -0.15) {
        openChecked++;
        if (density === 0) openZero++;
      }
    }
  }
  console.log(`        ${openZero}/${openChecked} very open columns had exactly zero tree density`);
  assert.ok(openChecked > 20 && openZero === openChecked, "columns in the most open meadows should never place a tree");
  let badBiomeTrees = 0;
  for (let x = -600; x <= 600; x += 4) {
    for (let z = -600; z <= 600; z += 4) {
      const biome = gen.biomeAt(x, z);
      if (biome === BIOME.DESERT || biome === BIOME.OCEAN || biome === BIOME.SNOWY_PLAINS || biome === BIOME.MOUNTAINS) {
        if (gen.trees.rootAt(x, z)) badBiomeTrees++;
      }
    }
  }
  assert.equal(badBiomeTrees, 0, `${badBiomeTrees} trees found in biomes that should never grow any`);
});

await test("villages: a rare, deterministic structure with houses, a torch-lit doorway, paths and a farm, whole across chunk borders", async () => {
  const gen = new TerrainGenerator(777);
  let center = null;
  for (let cx = -6; cx <= 6 && !center; cx++) {
    for (let cz = -6; cz <= 6 && !center; cz++) {
      const c = gen.villages._cellCenter(cx, cz);
      if (c) center = c;
    }
  }
  assert.ok(center, "no village found in a 12x12 cell search (seed 777)");
  // Generate every chunk the village could reach and check the real placed blocks.
  const { VILLAGE_REACH } = await import("../js/village.js");
  const c0 = (center.x - VILLAGE_REACH) >> 4;
  const c1 = (center.x + VILLAGE_REACH) >> 4;
  const cz0 = (center.z - VILLAGE_REACH) >> 4;
  const cz1 = (center.z + VILLAGE_REACH) >> 4;
  const chunks = new Map();
  for (let cx = c0; cx <= c1; cx++) {
    for (let cz = cz0; cz <= cz1; cz++) {
      const c = { cx, cz, blocks: new Uint8Array(16 * 16 * H) };
      gen.generate(c);
      chunks.set(`${cx},${cz}`, c);
    }
  }
  const get = (x, y, z) => {
    const c = chunks.get(`${x >> 4},${z >> 4}`);
    return c ? c.blocks[(y * 16 + ((z & 15) + 16) % 16) * 16 + (((x & 15) + 16) % 16)] : undefined;
  };
  let planks = 0;
  let torches = 0;
  let gravel = 0;
  let crops = 0;
  for (let dx = -VILLAGE_REACH; dx <= VILLAGE_REACH; dx++) {
    for (let dz = -VILLAGE_REACH; dz <= VILLAGE_REACH; dz++) {
      for (let dy = -6; dy <= 12; dy++) {
        const id = get(center.x + dx, center.groundY + dy, center.z + dz);
        if (id === BLOCK.PLANKS) planks++;
        else if (id === BLOCK.TORCH) torches++;
        else if (id === BLOCK.GRAVEL) gravel++;
        else if (id === BLOCK.TALL_GRASS) crops++;
      }
    }
  }
  console.log(`        village at (${center.x}, ${center.z}): ${planks} plank blocks, ${torches} torches, ${gravel} gravel path blocks, ${crops} crop blocks`);
  assert.ok(planks > 50, `expected substantial house walls, got ${planks} plank blocks`);
  // (Round 8: bigger villages: a torch beside every house door, and 12 lamp posts along the streets.)
  const houses = gen.villages.houses(center).length;
  assert.ok(houses >= 6 && houses <= 10, `expected 6-10 houses, got ${houses}`);
  assert.equal(torches, houses + 12, `expected a torch per house (${houses}) and 12 lamps, got ${torches}`);
  assert.ok(gravel > 20, `expected a real path network, got ${gravel} gravel blocks`);
  assert.ok(crops > 0, "expected some crops in the farm plot");
  // Regenerating the same chunks independently gives identical results
  // (determinism across chunk borders, like trees).
  const again = { cx: c0, cz: cz0, blocks: new Uint8Array(16 * 16 * H) };
  gen.generate(again);
  assert.deepEqual(again.blocks, chunks.get(`${c0},${cz0}`).blocks, "village placement must be deterministic");
});

await test("new players start on the ground, never on top of a tree", async () => {
  let moved = 0;
  for (let i = 0; i < 120; i++) {
    const seed = i === 0 ? 42 : i * 7919;
    const gen = new TerrainGenerator(seed);
    const [x, z] = gen.spawnColumn();
    const h = gen.heightAt(x, z);
    assert.ok(h > SEA_LEVEL + 1, `seed ${seed}: spawn (${x}, ${z}) is not on land`);
    if (Math.hypot(x, z) > 0 && gen.heightAt(0, 0) > SEA_LEVEL + 1) moved++;
    // Nothing solid above the ground in the generated chunk (plants are fine).
    const { IS_SOLID } = await import("../js/blocks.js");
    const cx = Math.floor(x / 16);
    const cz = Math.floor(z / 16);
    const blocks = new Uint8Array(16 * 16 * H);
    gen.generate({ cx, cz, blocks });
    for (let y = h + 1; y < H; y++) {
      const id = blocks[(y * 16 + (z - cz * 16)) * 16 + (x - cx * 16)];
      assert.ok(!IS_SOLID[id], `seed ${seed}: block ${id} above the spawn at y=${y}`);
    }
  }
  console.log(`        120 worlds, ${moved} spawns moved to the side of a tree`);
  assert.ok(moved > 0, "some spawns should have needed moving off a tree");
});

await test("world scale (Round 3): a 128-tall world, big oceans, mountain ranges far above the sea, big biomes", async () => {
  const { BIOME } = await import("../js/biomes.js");
  assert.equal(WORLD_HEIGHT, 128);
  for (const seed of [42, 2024]) {
    const gen = new TerrainGenerator(seed);
    let n = 0;
    let ocean = 0;
    let high = 0;
    let max = 0;
    for (let x = -3000; x <= 3000; x += 50) for (let z = -3000; z <= 3000; z += 50) {
      const h = gen.heightAt(x, z);
      n++;
      if (h < SEA_LEVEL) ocean++;
      if (h > SEA_LEVEL + 60) high++;
      max = Math.max(max, h);
    }
    // Biome size: average run of the same biome along lines, in blocks.
    // (Beaches and rivers are thin bands, not regions: skipped; the oceans count as one.)
    let runs = 0;
    let changes = 0;
    const cls = (b) => (b === BIOME.OCEAN || b === BIOME.DEEP_OCEAN || b === BIOME.WARM_OCEAN ? -1 : b);
    for (let z = -3000; z <= 3000; z += 600) {
      let last = null;
      for (let x = -3000; x <= 3000; x += 8) {
        const b = gen.biomeAt(x, z);
        if (b === BIOME.BEACH || b === BIOME.RIVER) continue;
        if (cls(b) !== last) changes++;
        last = cls(b);
        runs++;
      }
    }
    const avgRun = (runs / changes) * 8;
    console.log(`        seed ${seed}: ocean ${((ocean / n) * 100).toFixed(0)}%, peaks up to ${max}, ${((high / n) * 100).toFixed(1)}% over ${SEA_LEVEL + 60}, biome runs ~${Math.round(avgRun)} blocks`);
    assert.ok(ocean / n > 0.3 && ocean / n < 0.7, `big seas: ${ocean / n}`);
    assert.ok(max > 105 && max <= WORLD_HEIGHT - 2, `mountains far above the sea, inside the world: ${max}`);
    assert.ok(high / n > 0.01, `mountain ranges, not single peaks: ${high / n}`);
    assert.ok(avgRun > 120, `big biomes: ${avgRun}`);
    assert.ok(BIOME.MOUNTAINS !== undefined);
  }
});

await test("terrain generation is fast enough to stream (< 3 ms per chunk)", () => {
  const gen = new TerrainGenerator(5);
  const t0 = performance.now();
  for (let i = 0; i < 40; i++) gen.generate({ cx: i, cz: -i, blocks: new Uint8Array(16 * 16 * H) });
  const ms = (performance.now() - t0) / 40;
  console.log(`        ${ms.toFixed(2)} ms per chunk`);
  assert.ok(ms < 3, `${ms.toFixed(2)} ms per chunk`);
});

// ---------------------------------------------------------------------------
console.log("\nItems and inventory (items.js, inventory.js)");

const { ITEM, itemInfo, breakTime, canHarvest, blockDrops, maxStack } = await import("../js/items.js");
const { Inventory, clickSlot, quickMove, makeStack } = await import("../js/inventory.js");

await test("mining: tool tiers gate drops and speed up breaking", () => {
  const woodPick = itemInfo(ITEM.WOOD_PICKAXE).tool;
  const stonePick = itemInfo(ITEM.STONE_PICKAXE).tool;
  const ironPick = itemInfo(ITEM.IRON_PICKAXE).tool;
  const stoneAxe = itemInfo(ITEM.STONE_AXE).tool;
  assert.equal(canHarvest(BLOCK.STONE, null), false, "stone by hand drops nothing");
  assert.equal(canHarvest(BLOCK.STONE, woodPick), true);
  assert.equal(canHarvest(BLOCK.IRON_ORE, woodPick), false);
  assert.equal(canHarvest(BLOCK.IRON_ORE, stonePick), true);
  assert.equal(canHarvest(BLOCK.DIAMOND_ORE, stonePick), false);
  assert.equal(canHarvest(BLOCK.DIAMOND_ORE, ironPick), true);
  assert.equal(canHarvest(BLOCK.BEDROCK, ironPick), false);
  assert.equal(breakTime(BLOCK.BEDROCK, ironPick), Infinity);
  assert.ok(Math.abs(breakTime(BLOCK.STONE, null) - 7.5) < 1e-9);
  assert.ok(Math.abs(breakTime(BLOCK.STONE, woodPick) - 1.125) < 1e-9);
  assert.ok(breakTime(BLOCK.WOOD, stoneAxe) < breakTime(BLOCK.WOOD, null));
  assert.equal(breakTime(BLOCK.TORCH, null), 0);
  assert.deepEqual(blockDrops(BLOCK.STONE, woodPick), [[BLOCK.COBBLESTONE, 1]]);
  assert.deepEqual(blockDrops(BLOCK.GRASS, null), [[BLOCK.DIRT, 1]]);
  assert.deepEqual(blockDrops(BLOCK.COAL_ORE, woodPick), [[ITEM.COAL, 1]]);
  assert.deepEqual(blockDrops(BLOCK.GLASS, null), []);
  assert.deepEqual(blockDrops(BLOCK.LEAVES, null, () => 0.01), [[ITEM.APPLE, 1]]);
});

await test("inventory add/merge/overflow and tool durability", () => {
  const inv = new Inventory();
  assert.equal(inv.add(BLOCK.DIRT, 100), 0);
  assert.equal(inv.slots[0].count, 64);
  assert.equal(inv.slots[1].count, 36);
  assert.equal(inv.add(BLOCK.DIRT, 10), 0);
  assert.equal(inv.slots[1].count, 46, "merges into the partial stack");
  assert.equal(inv.add(ITEM.IRON_SWORD, 2), 0);
  assert.equal(inv.slots[2].count, 1, "tools don't stack");
  assert.equal(inv.slots[3].count, 1);
  assert.equal(inv.slots[2].dur, itemInfo(ITEM.IRON_SWORD).tool.durability);
  for (let i = 0; i < 40; i++) inv.add(BLOCK.STONE + (i % 2 ? 0 : 7), 64); // fill it up
  assert.ok(inv.add(BLOCK.WOOL, 5) > 0, "a full inventory reports leftovers");
  assert.equal(inv.canFit(BLOCK.WOOL, 1), false);
  // Durability: a wooden pickaxe breaks after its last use.
  const inv2 = new Inventory();
  inv2.add(ITEM.WOOD_PICKAXE);
  inv2.slots[0].dur = 2;
  assert.equal(inv2.damageSelected(), false);
  assert.equal(inv2.damageSelected(), true);
  assert.equal(inv2.slots[0], null);
});

await test("slot clicks: pick up, place, split, merge, swap", () => {
  const slots = [makeStack(BLOCK.DIRT, 10), makeStack(BLOCK.DIRT, 60), null, makeStack(BLOCK.STONE, 3)];
  let cursor = clickSlot(slots, 0, null, 2); // right-click: take half
  assert.equal(cursor.count, 5);
  assert.equal(slots[0].count, 5);
  cursor = clickSlot(slots, 2, cursor, 2); // right-click on empty: place one
  assert.equal(slots[2].count, 1);
  assert.equal(cursor.count, 4);
  cursor = clickSlot(slots, 1, cursor, 0); // left-click: merge up to 64
  assert.equal(slots[1].count, 64);
  assert.equal(cursor, null, "all 4 fit");
  cursor = clickSlot(slots, 3, null, 0); // pick up the stone
  cursor = clickSlot(slots, 0, cursor, 0); // swap stone and dirt
  assert.equal(slots[0].id, BLOCK.STONE);
  assert.equal(cursor.id, BLOCK.DIRT);
  assert.equal(cursor.count, 5);
});

await test("quick-move: a stack moves between the hotbar and the main area", () => {
  const inv = new Inventory();
  inv.add(BLOCK.SAND, 5);
  const sandSlot = inv.slots.findIndex((s) => s && s.id === BLOCK.SAND);
  assert.ok(quickMove(inv, sandSlot));
  assert.ok(inv.slots.findIndex((s) => s && s.id === BLOCK.SAND) >= 9, "hotbar -> main");
});

await test("no crafting: the module is gone; Survival starts with basic gear (sword, pickaxe, apples), Creative with every weapon and the bow", async () => {
  await assert.rejects(() => import("../js/crafting.js"));
  const { SURVIVAL_LOADOUT, CREATIVE_LOADOUT, ALL_WEAPONS } = await import("../js/items.js");
  assert.deepEqual(SURVIVAL_LOADOUT, [ITEM.STONE_SWORD, ITEM.STONE_PICKAXE, [ITEM.APPLE, 5]]);
  for (const e of SURVIVAL_LOADOUT) assert.ok(!itemInfo(Array.isArray(e) ? e[0] : e)?.weapon, "no weapon in the Survival start");
  for (const id of ALL_WEAPONS) assert.ok(CREATIVE_LOADOUT.includes(id), `Creative has ${id}`);
  assert.ok(CREATIVE_LOADOUT.includes(ITEM.BOW));
  for (const id of [...ALL_WEAPONS, ITEM.BOW]) assert.ok(itemInfo(id)?.weapon, `weapon ${id}`);
});

await test("armor (Round 5): 4 slots, worn on pickup, reduces damage 4% a point (max 80%), wears out, saved; the shield is gone", async () => {
  const items = await import("../js/items.js");
  assert.equal(items.ITEM.SHIELD, undefined, "no shield item");
  assert.equal(items.ARMOR_SLOTS.length, 4);
  const inv = new Inventory();
  assert.equal(inv.armor.length, 4);
  assert.equal(inv.armorReduction(), 0);
  const ids = [];
  for (let slot = 0; slot < 4; slot++) {
    const id = items.armorId(items.ARMOR_TIERS.length - 1, slot);
    assert.equal(Inventory.armorSlotOf(id), slot);
    ids.push(id);
    assert.equal(inv.add(id, 1), 0);
    assert.equal(inv.armor[slot]?.id, id, "picked up into its free slot, worn at once");
  }
  assert.ok(inv.armorPoints() > 0 && inv.armorReduction() <= 0.8);
  const before = inv.armor[1].dur;
  const broken = inv.damageArmor(1);
  assert.equal(inv.armor[1].dur, before - 1);
  assert.deepEqual(broken, []);
  const copy = new Inventory();
  copy.loadArmor(JSON.parse(JSON.stringify(inv.serializeArmor())));
  assert.equal(copy.armor[1].dur, before - 1);
  assert.equal(copy.armorPoints(), inv.armorPoints());
  for (let i = 0; i < 400; i++) inv.damageArmor(5);
  assert.ok(inv.armor.every((a) => !a), "everything wears out");
});

await test("every hand weapon reloads or cools down, balanced by damage (the sniper has one round)", async () => {
  const { WEAPON_STATS } = await import("../js/weapon-stats.js");
  for (const k of ["bow", "pistol", "machinegun", "sniper", "grenade", "bazooka", "railgun", "airstrike", "minigun"]) {
    const st = WEAPON_STATS[k];
    assert.ok(st && ((st.mag >= 1 && st.reload > 0) || (st.heat > 0 && st.cool > 0)), `${k} has a reload or a cooldown`);
  }
  assert.equal(WEAPON_STATS.sniper.mag, 1);
  assert.ok(WEAPON_STATS.sniper.reload >= 1.5, "the sniper reloads after every shot");
  // Sustained damage per second: the hardest single hits wait the longest.
  const dps = (dmg, mag, interval, reload) => (dmg * mag) / (mag * interval + reload);
  const pistol = dps(5, WEAPON_STATS.pistol.mag, 0.2, WEAPON_STATS.pistol.reload);
  const mg = dps(3, WEAPON_STATS.machinegun.mag, 1 / 12, WEAPON_STATS.machinegun.reload);
  const sniper = dps(34, 1, 0, WEAPON_STATS.sniper.reload);
  const blaster = 3 / 0.22; // the laser pistol: no magazine, 3 a bolt, continuous fire (weaker than the pistol)
  const minigun = (3 * 32 * WEAPON_STATS.minigun.heat) / (WEAPON_STATS.minigun.heat + WEAPON_STATS.minigun.cool + 1);
  assert.ok(blaster < pistol && pistol < mg && mg < minigun, `crate guns < alien guns: ${[pistol, mg, sniper, blaster, minigun].map((x) => x.toFixed(1))}`);
  assert.ok(sniper < 25 && sniper > 12, `the sniper: big hits, modest sustained damage (${sniper.toFixed(1)})`);
  assert.ok(WEAPON_STATS.railgun.reload > WEAPON_STATS.sniper.reload && WEAPON_STATS.airstrike.reload >= 20);
});

await test("inventory survives serialize/load and rejects garbage", () => {
  const inv = new Inventory();
  inv.add(BLOCK.TORCH, 12);
  inv.add(ITEM.DIAMOND_PICKAXE);
  inv.slots[1].dur = 99;
  const data = JSON.parse(JSON.stringify(inv.serialize()));
  const inv2 = new Inventory();
  inv2.load(data);
  assert.deepEqual(inv2.slots[0], { id: BLOCK.TORCH, count: 12 });
  assert.deepEqual(inv2.slots[1], { id: ITEM.DIAMOND_PICKAXE, count: 1, dur: 99 });
  inv2.load([[9999, 3], ["x"], [BLOCK.DIRT, -4], [BLOCK.DIRT, 500], 5]);
  assert.equal(inv2.slots[0], null);
  assert.equal(inv2.slots[3].count, maxStack(BLOCK.DIRT), "counts are clamped to the stack size");
});

console.log("\nCollision (physics.js)");
{
  const { sweepAxis, boxInSolid, rayAabb } = await import("../js/physics.js");
  // A tiny voxel world: a floor at y = 0 and a wall at x = 5.
  const world = { isSolidAt: (x, y, z) => y === 0 || (x === 5 && y >= 1 && y <= 2) };
  const v = (x, y, z) => ({ x, y, z });

  await test("sweeps stop exactly at floors and walls, and pass through open space", () => {
    const pos = v(2.5, 1, 2.5);
    const down = sweepAxis(world, pos, 0.3, 1.8, "y", -0.5);
    assert.ok(Math.abs(down) < 1e-3, `standing on the floor, can't sink (moved ${down})`);
    const toWall = sweepAxis(world, pos, 0.3, 1.8, "x", 5);
    assert.ok(Math.abs(pos.x + toWall + 0.3 - 5) < 1e-3, "stops with the box's face at the wall");
    const away = sweepAxis(world, pos, 0.3, 1.8, "x", -1.5);
    assert.equal(away, -1.5, "free movement is unchanged");
    const over = sweepAxis(world, v(2.5, 3, 2.5), 0.3, 1.8, "x", 5);
    assert.equal(over, 5, "above the 2-high wall nothing blocks");
    assert.ok(boxInSolid(world, v(5.2, 1, 2.5), 0.3, 1.8) && !boxInSolid(world, v(3, 1, 3), 0.3, 1.8));
  });

  await test("ray vs box: hits from outside, misses beside, respects the max distance", () => {
    const min = v(4, 1, -0.5);
    const max = v(5, 3, 0.5);
    assert.ok(Math.abs(rayAabb(v(0, 2, 0), v(1, 0, 0), min, max, 10) - 4) < 1e-9);
    assert.equal(rayAabb(v(0, 2, 2), v(1, 0, 0), min, max, 10), null);
    assert.equal(rayAabb(v(0, 2, 0), v(1, 0, 0), min, max, 3), null);
    assert.equal(rayAabb(v(4.5, 2, 0), v(1, 0, 0), min, max, 10), 0, "starting inside counts as an immediate hit");
  });
}

console.log("\nExplosion falloff (falloff.js)");
{
  const { shakeFalloff, explosionSound } = await import("../js/falloff.js");
  await test("camera shake fades smoothly with distance, to nothing far away, and reaches farther for bigger blasts", () => {
    let prev = Infinity;
    for (let d = 0; d <= 300; d += 5) {
      const s = shakeFalloff(d, 7);
      assert.ok(s <= prev + 1e-12 && s >= 0 && s <= 1, `not monotonic at ${d}`);
      prev = s;
    }
    assert.equal(shakeFalloff(0, 7), 1);
    assert.equal(shakeFalloff(200, 7), 0);
    assert.ok(shakeFalloff(80, 35) > shakeFalloff(80, 7), "a bazooka shakes from farther away");
  });

  await test("explosions sound quieter, more muffled and later with distance; bigger blasts are louder", () => {
    let prev = explosionSound(0, 1);
    for (let d = 10; d <= 400; d += 10) {
      const s = explosionSound(d, 1);
      assert.ok(s.gain < prev.gain && s.cutoff <= prev.cutoff && s.delay > prev.delay, `not smooth at ${d}`);
      prev = s;
    }
    assert.ok(explosionSound(400, 1).cutoff < 500, "far explosions are muffled to a rumble");
    assert.ok(explosionSound(0, 1).cutoff > 15000, "close explosions are crisp");
    assert.ok(explosionSound(60, 5).gain > explosionSound(60, 1).gain, "the bazooka is louder");
  });
}

console.log("\nDistant terrain (lod-mesher.js)");
{
  const { LodTerrain, buildLodTile, makeLodPalette, tileSpan, LOD_CELLS, LOD_WATER_TOP, LOD_KIND } = await import("../js/lod-mesher.js");
  const { BLOCK, IS_LOG, IS_LEAVES } = await import("../js/blocks.js");
  const { SEA_LEVEL } = await import("../js/constants.js");
  const flat = new Float32Array(256 * 3).fill(0.4);
  const pal = makeLodPalette({ top: flat, side: flat });
  const seed = 4242;

  // Faces of a built tile, from its quads: { normal, kind, x0, x1, y0, y1, z0, z1 }.
  const facesOf = (m) => {
    const faces = [];
    for (let v = 0; v < m.vertexCount; v += 4) {
      const xs = [];
      const ys = [];
      const zs = [];
      for (let k = 0; k < 4; k++) {
        xs.push(m.position[(v + k) * 3]);
        ys.push(m.position[(v + k) * 3 + 1]);
        zs.push(m.position[(v + k) * 3 + 2]);
      }
      faces.push({ normal: m.info[v * 4], kind: m.info[v * 4 + 1], x0: Math.min(...xs), x1: Math.max(...xs), y0: Math.min(...ys), y1: Math.max(...ys), z0: Math.min(...zs), z1: Math.max(...zs) });
    }
    return faces;
  };

  await test("tiles are well-formed: quads, valid indices, tops at the terrain height sampled at each cell's centre", () => {
    const lt = new LodTerrain(seed);
    for (const level of [1, 2, 4]) {
      const m = buildLodTile(lt, level, -1, 2, pal);
      const step = 1 << level;
      assert.equal(m.vertexCount % 4, 0);
      assert.equal(m.index.length, (m.vertexCount / 4) * 6);
      for (const i of m.index) assert.ok(i < m.vertexCount);
      for (const p of m.position) assert.ok(Number.isFinite(p));
      // Every cell centre is covered by exactly one terrain top at its sampled height.
      const tops = facesOf(m).filter((f) => f.normal === 2 && f.kind !== LOD_KIND.LEAVES);
      for (let j = 0; j < LOD_CELLS; j += 5) {
        for (let i = 0; i < LOD_CELLS; i += 3) {
          const cx = i * step + step / 2;
          const cz = j * step + step / 2;
          const hits = tops.filter((f) => f.x0 < cx && f.x1 > cx && f.z0 < cz && f.z1 > cz);
          assert.equal(hits.length, 1, `cell ${i},${j} at level ${level}: ${hits.length} tops`);
          const s = {};
          lt.sample(m.x0 + cx, m.z0 + cz, s, level >= 2 ? (step >> 1) * 0.7 : 0);
          assert.ok(Math.abs(hits[0].y0 - s.top) < 1e-4, `cell ${i},${j}: top ${hits[0].y0}, ground ${s.top}`);
          // Never below the height at the cell's centre (peaks are kept), and never far above it.
          const h = lt.terrain.heightAt(m.x0 + cx, m.z0 + cz);
          assert.ok(s.top >= (h < SEA_LEVEL ? LOD_WATER_TOP : h + 1) - 1e-4 && s.top <= Math.max(LOD_WATER_TOP, h + 1 + step * 3) + 1e-4, `cell ${i},${j}: top ${s.top} vs centre ${h}`);
        }
      }
      assert.equal(m.span, tileSpan(level));
    }
  });

  await test("walls exactly cover every height step inside a tile, and skirts close every border", () => {
    const lt = new LodTerrain(seed);
    for (const level of [1, 3]) {
      // (A tile with tree boxes has extra walls: the first tile without any is the one to check.)
      let m = null;
      for (const [tx, tz] of [[3, -2], [0, 0], [5, 5], [-4, 2], [8, -7], [2, 9], [-6, -6], [11, 3], [-9, 7]]) {
        const cand = buildLodTile(lt, level, tx, tz, pal);
        if (!facesOf(cand).some((f) => f.kind === LOD_KIND.LEAVES)) {
          m = cand;
          break;
        }
      }
      assert.ok(m, "a tile without trees to check");
      const step = 1 << level;
      const N = LOD_CELLS;
      const heights = [];
      for (let j = 0; j < N; j++) {
        const row = [];
        for (let i = 0; i < N; i++) {
          const out = {};
          lt.sample(m.x0 + i * step + step / 2, m.z0 + j * step + step / 2, out, level >= 2 ? (step >> 1) * 0.7 : 0);
          row.push(out.top);
        }
        heights.push(row);
      }
      let expected = 0;
      for (let j = 0; j < N; j++) {
        for (let i = 0; i < N; i++) {
          if (i + 1 < N) expected += Math.abs(heights[j][i + 1] - heights[j][i]) * step;
          if (j + 1 < N) expected += Math.abs(heights[j + 1][i] - heights[j][i]) * step;
        }
      }
      const walls = facesOf(m).filter((f) => f.normal !== 2 && f.kind !== LOD_KIND.LEAVES && !(f.x1 - f.x0 < 1 && f.z1 - f.z0 < 1));
      const onBorder = (f) => (f.normal < 2 ? f.x0 === 0 || f.x0 === N * step : f.z0 === 0 || f.z0 === N * step);
      const inner = walls.filter((f) => !onBorder(f));
      const border = walls.filter((f) => !inner.includes(f));
      const area = inner.reduce((a, f) => a + (f.y1 - f.y0) * Math.max(f.x1 - f.x0, f.z1 - f.z0), 0);
      // Absolute tolerance for small sums, relative for large ones: bigger
      // mountain heights make for bigger sums, where float summation order
      // (this loop vs. the mesher's) can differ by a little more in absolute
      // terms without it meaning anything is actually wrong.
      assert.ok(Math.abs(area - expected) < Math.max(1e-3, expected * 1e-6), `level ${level}: wall area ${area} vs height steps ${expected}`);
      // Skirts: along each of the 4 borders, walls cover the full length,
      // reaching from below the lowest top in the tile up to each cell's top.
      const lowest = Math.min(...heights.flat());
      for (const [normal, len] of [[0, N * step], [1, N * step], [4, N * step], [5, N * step]]) {
        const side = border.filter((f) => f.normal === normal && (normal < 2 ? f.x0 === (normal === 0 ? N * step : 0) : f.z0 === (normal === 4 ? N * step : 0)));
        const covered = side.reduce((a, f) => a + Math.max(f.x1 - f.x0, f.z1 - f.z0), 0);
        assert.equal(covered, len, `level ${level}: skirt ${normal} covers ${covered} of ${len}`);
        for (const f of side) assert.ok(f.y0 <= lowest - step, "skirts reach below the tile's lowest surface");
      }
    }
  });

  await test("distant terrain and full-detail chunks agree: heights inside the world, same top blocks", () => {
    const lt = new LodTerrain(seed);
    const gen = lt.terrain;
    let max = 0;
    let mountains = 0;
    for (let z = -3000; z < 3000; z += 47) for (let x = -3000; x < 3000; x += 53) {
      const h = gen.heightAt(x, z);
      max = Math.max(max, h);
      if (h >= 50) mountains++;
    }
    assert.ok(max <= WORLD_HEIGHT - 2, `heights stay inside the world (max ${max})`);
    assert.ok(mountains > 20, `there are mountains to compare (${mountains})`);
    // Full chunks in mountain and lowland areas: the top natural block of every column is the
    // one the distant terrain colours by (the same surface function), at the same height.
    let checked = 0;
    let bad = 0;
    for (const [cx, cz] of [[-40, 30], [12, -55], [80, 80], [-100, -20], [3, 3], [60, -90], [-30, 110], [140, 20]]) {
      const chunk = { cx, cz, blocks: new Uint8Array(16 * 16 * WORLD_HEIGHT) };
      gen.generate(chunk);
      for (let lz = 0; lz < 16; lz++) for (let lx = 0; lx < 16; lx++) {
        const wx = cx * 16 + lx;
        const wz = cz * 16 + lz;
        const h = gen.heightAt(wx, wz);
        if (h < SEA_LEVEL || gen.villages && gen.villages._villagesNear(wx, wz, wx, wz).length) continue;
        const id = chunk.blocks[(h * 16 + lz) * 16 + lx];
        const above = chunk.blocks[((h + 1) * 16 + lz) * 16 + lx];
        if (id === 0 || above !== 0 && !(above >= 1 && false)) {
          // A cave opened the surface, or a tree/plant stands here: skip.
          if (id === 0 || IS_LOG[above] || IS_LEAVES[above]) continue;
        }
        // A swamp puddle (one water block sunk into the ground) is too small for distant terrain.
        if (id === BLOCK.WATER) continue;
        const s = {};
        lt.sample(wx, wz, s, 0);
        checked++;
        if (s.top !== h + 1 || s.id !== id) {
          bad++;
        }
      }
    }
    assert.ok(checked > 800, `columns compared: ${checked}`);
    assert.equal(bad, 0, `${bad} of ${checked} columns differ between the chunk and the distant terrain`);
  });

  await test("trees become canopy boxes on near levels and a grass tint far away", () => {
    const lt = new LodTerrain(seed);
    const near = buildLodTile(lt, 2, 0, 0, pal);
    const leaves = facesOf(near).filter((f) => f.kind === LOD_KIND.LEAVES).length;
    let trees = 0;
    for (let z = 0; z < near.span; z++) for (let x = 0; x < near.span; x++) if (lt.treeAt(x, z) && lt.terrain.heightAt(x, z) >= SEA_LEVEL) trees++;
    assert.ok(trees > 5 && leaves >= trees * 5, `${trees} trees, ${leaves} leaf faces`);
    const far = buildLodTile(lt, 4, 0, 0, pal);
    assert.equal(facesOf(far).filter((f) => f.kind === LOD_KIND.LEAVES).length, 0);
  });

  await test("player edits show in distant terrain: a crater lowers the surface and felled trees disappear", () => {
    const lt = new LodTerrain(seed);
    // Find a tree and dig out its whole chunk down to y = 10.
    let tree = null;
    for (let z = 0; z < 512 && !tree; z++) for (let x = 0; x < 512 && !tree; x++) if (lt.treeAt(x, z)) tree = [x, z];
    assert.ok(tree, "no tree found");
    const cx = tree[0] >> 4;
    const cz = tree[1] >> 4;
    const list = [];
    for (let y = 10; y < 128; y++) for (let z = 0; z < 16; z++) for (let x = 0; x < 16; x++) list.push((y * 16 + z) * 16 + x, BLOCK.AIR);
    lt.setChunkEdits(`${cx},${cz}`, list);
    const out = {};
    lt.sample(cx * 16 + 5, cz * 16 + 7, out);
    assert.equal(out.top, 10);
    assert.equal(lt.treeAt(tree[0], tree[1]), null);
    lt.setChunkEdits(`${cx},${cz}`, []);
    assert.ok(lt.treeAt(tree[0], tree[1]), "clearing the edits restores the tree");
  });
}

console.log("\nFlowing water (watersim.js)");
{
  const { WaterSim, MAX_FLOW_DISTANCE } = await import("../js/watersim.js");
  const { BLOCK } = await import("../js/blocks.js");

  // A minimal stand-in for World: a sparse block map plus the same
  // getChunk/getBlock/setBlock/changeListeners contract WaterSim relies on.
  class FakeWorld {
    constructor() {
      this.blocks = new Map();
      this.loaded = new Set();
      this.changeListeners = [];
    }
    k(x, y, z) {
      return `${x},${y},${z}`;
    }
    load(cx, cz) {
      this.loaded.add(`${cx},${cz}`);
    }
    getChunk(cx, cz) {
      return this.loaded.has(`${cx},${cz}`) || undefined;
    }
    getBlock(x, y, z) {
      return this.blocks.get(this.k(x, y, z)) ?? BLOCK.AIR;
    }
    setBlock(x, y, z, id, { recordEdit = true } = {}) {
      const key = this.k(x, y, z);
      if (this.blocks.get(key) === id) return false;
      this.blocks.set(key, id);
      const changed = [x, y, z];
      for (const fn of this.changeListeners) fn(changed, { recordEdit });
      return true;
    }
  }
  const floor = (w, x0, x1, y, z0, z1) => {
    for (let x = x0; x <= x1; x++) for (let z = z0; z <= z1; z++) w.setBlock(x, y, z, BLOCK.STONE);
  };
  const loadArea = (w, x0, x1, z0, z1) => {
    for (let x = (x0 >> 4) - 1; x <= (x1 >> 4) + 1; x++) for (let z = (z0 >> 4) - 1; z <= (z1 >> 4) + 1; z++) w.load(x, z);
  };
  const drain = (sim, max = 2000) => {
    let steps = 0;
    while (sim.activeCount > 0 && steps++ < max) sim.update(9999);
    return steps;
  };

  await test("water falls to fill a hole dug beneath it, instead of floating", () => {
    const w = new FakeWorld();
    loadArea(w, -5, 5, -5, 5);
    floor(w, -3, 3, 10, -3, 3);
    w.setBlock(0, 11, 0, BLOCK.WATER); // resting on the floor
    const sim = new WaterSim(w);
    // Dig a 3-deep hole under the water (as an explosion would), then let it react.
    w.setBlock(0, 10, 0, BLOCK.AIR);
    w.setBlock(0, 9, 0, BLOCK.AIR);
    w.setBlock(0, 8, 0, BLOCK.AIR);
    drain(sim);
    assert.equal(w.getBlock(0, 11, 0), BLOCK.WATER, "the original water should still be there");
    assert.equal(w.getBlock(0, 10, 0), BLOCK.WATER, "water should fall into the hole below it");
    assert.equal(w.getBlock(0, 9, 0), BLOCK.WATER);
    assert.equal(w.getBlock(0, 8, 0), BLOCK.WATER, "water should reach the bottom of the hole");
  });

  await test("water spreads sideways from a source up to a limited distance, and no farther", () => {
    const w = new FakeWorld();
    loadArea(w, -2, 20, -2, 2);
    floor(w, -1, 20, 10, -1, 1);
    w.setBlock(0, 11, 0, BLOCK.WATER);
    const sim = new WaterSim(w);
    sim.active.add(sim._key(0, 11, 0)); // wake it manually: it was placed before the sim existed
    drain(sim);
    for (let x = 1; x <= MAX_FLOW_DISTANCE; x++) assert.equal(w.getBlock(x, 11, 0), BLOCK.WATER, `should have reached x=${x}`);
    assert.equal(w.getBlock(MAX_FLOW_DISTANCE + 1, 11, 0), BLOCK.AIR, "flow should stop at its maximum distance");
  });

  await test("a flow dries up once its source is removed", () => {
    const w = new FakeWorld();
    loadArea(w, -2, 8, -2, 2);
    floor(w, -1, 8, 10, -1, 1);
    w.setBlock(0, 11, 0, BLOCK.WATER);
    const sim = new WaterSim(w);
    sim.active.add(sim._key(0, 11, 0));
    drain(sim);
    assert.equal(w.getBlock(2, 11, 0), BLOCK.WATER, "sanity: the flow should have spread first");
    w.setBlock(0, 11, 0, BLOCK.AIR); // remove the source
    drain(sim);
    for (let x = 0; x <= MAX_FLOW_DISTANCE; x++) assert.equal(w.getBlock(x, 11, 0), BLOCK.AIR, `x=${x} should have dried up`);
  });

  await test("original terrain water never dries up on its own (an untouched lake stays full)", () => {
    const w = new FakeWorld();
    loadArea(w, -2, 2, -2, 2);
    floor(w, -1, 1, 10, -1, 1);
    w.setBlock(0, 11, 0, BLOCK.WATER);
    const sim = new WaterSim(w);
    // Wake it without any real edit nearby (as a neighboring, unrelated dig might).
    sim.active.add(sim._key(0, 11, 0));
    drain(sim);
    assert.equal(w.getBlock(0, 11, 0), BLOCK.WATER, "an original water block with solid support should never dry up");
  });

  await test("out-of-band scaffolding (recordEdit: false) never wakes water, so test/world-setup placements can't trigger the sim", () => {
    const w = new FakeWorld();
    loadArea(w, -3, 3, -3, 3);
    floor(w, -2, 2, 10, -2, 2);
    w.setBlock(0, 11, 0, BLOCK.WATER, { recordEdit: false });
    const sim = new WaterSim(w);
    w.setBlock(0, 10, 0, BLOCK.AIR, { recordEdit: false });
    assert.equal(sim.activeCount, 0, "an out-of-band edit should not wake the water simulation");
  });

  await test("update() only processes a bounded number of cells per call (throttled)", () => {
    const w = new FakeWorld();
    loadArea(w, -2, 30, -2, 2);
    floor(w, -1, 30, 10, -1, 1);
    w.setBlock(0, 11, 0, BLOCK.WATER);
    const sim = new WaterSim(w);
    sim.active.add(sim._key(0, 11, 0));
    let calls = 0;
    while (sim.activeCount > 0 && calls < 50) {
      const before = sim.processed;
      sim.update(1); // a budget of exactly one cell per call
      assert.ok(sim.processed - before <= 1, "a budget of 1 should tick at most one cell per call");
      calls++;
    }
    assert.ok(calls > 1, `spreading across several cells should take more than one throttled call (took ${calls})`);
  });
}

// ---------------------------------------------------------------------------
console.log("\nRound 6 landforms (terrain.js, biomes.js)");
{
  const { TerrainGenerator } = await import("../js/terrain.js");
  const { BIOME } = await import("../js/biomes.js");
  const { SEA_LEVEL } = await import("../js/constants.js");

  await test("flat country, deep valleys, bigger mountains and the meadow exist (6 seeds, 8000 x 8000 blocks)", () => {
    let land = 0;
    let flat = 0;
    let steep = 0;
    let high = 0;
    let desert = 0;
    let jungle = 0;
    let meadow = 0;
    let valley = 0;
    for (const seed of [1, 42, 777, 2024, 31337, 99]) {
      const t = new TerrainGenerator(seed * 7919);
      for (let x = -4000; x < 4000; x += 80) {
        for (let z = -4000; z < 4000; z += 80) {
          const info = t._terrainInfo(x, z);
          if (info.height <= SEA_LEVEL + 1) continue;
          land++;
          const b = t.biomes.biomeAt(x, z, info.height, info.mountainT, info.river, info.flat);
          if (b === BIOME.DESERT) desert++;
          if (b === BIOME.JUNGLE) jungle++;
          if (b === BIOME.MEADOW) meadow++;
          if (info.height > 100) high++;
          // Flat: the 4 neighbours 8 blocks away differ by at most 2.
          const hs = [t.heightAt(x + 8, z), t.heightAt(x - 8, z), t.heightAt(x, z + 8), t.heightAt(x, z - 8)];
          const d = Math.max(...hs.map((h) => Math.abs(h - info.height)));
          if (info.flat > 0.9 && d <= 2) flat++;
          if (d >= 8) steep++;
          // A valley: low ground (below SEA_LEVEL + 8) right beside a ridge (100+ blocks away along an axis).
          if (info.height < SEA_LEVEL + 8 && info.mountainT > 0.35) valley++;
        }
      }
    }
    const pc = (n) => ((n / land) * 100).toFixed(1);
    console.log(`        land ${land}: flat ${pc(flat)}%, over 100 ${pc(high)}%, desert ${pc(desert)}%, jungle ${pc(jungle)}%, meadow ${pc(meadow)}%, valley floors in the mountains ${pc(valley)}%, steep ${pc(steep)}%`);
    assert.ok(flat / land > 0.06, "wide flat country exists");
    assert.ok(high / land > 0.05, "tall mountains");
    assert.ok(desert / land > 0.06 && jungle / land > 0.025, "much larger deserts and jungles than the 3% / 2% of Round 5");
    assert.ok(meadow / land > 0.02, "meadows");
    assert.ok(valley / land > 0.003, "valley floors cut into the mountain country");
  });
}

// ---------------------------------------------------------------------------
console.log("\nAirports and cities (sites.js)");
{
  const { TerrainGenerator } = await import("../js/terrain.js");
  const { SITE_CELL } = await import("../js/sites.js");
  const { LodTerrain } = await import("../js/lod-mesher.js");
  const { BLOCK } = await import("../js/blocks.js");

  function findSites(seed, kind = null) {
    const t = new TerrainGenerator(seed);
    const list = [];
    for (let cz = -4; cz <= 4; cz++) for (let cx = -4; cx <= 4; cx++) {
      const s = t.sites._site(cx, cz);
      if (s && (!kind || s.kind === kind)) list.push(s);
    }
    return { t, list };
  }

  await test("sites are deterministic, fairly common, and there is one within ~1200 blocks of the start", () => {
    const a = findSites(42);
    const b = findSites(42);
    assert.deepEqual(a.list.map((s) => s.id), b.list.map((s) => s.id));
    assert.ok(a.list.length >= 5, `sites in 81 cells: ${a.list.length}`);
    assert.ok(a.list.some((s) => s.kind === "airport") && a.list.some((s) => s.kind === "city"), "both kinds exist");
    let near = 0;
    let far = 0;
    for (const seed of [1, 2, 3, 4, 5, 6, 7, 8]) {
      const t = new TerrainGenerator(seed * 7919);
      const [sx, sz] = t.spawnColumn();
      if (t.sites.nearest(sx, sz, 1300)) near++;
      if (t.sites.nearest(sx, sz, 2600)) far++;
    }
    // Round 6: there is always a home airport (regional or international) close to the start, the others are far away.
    assert.ok(near >= 8, `sites within 1300 blocks for ${near}/8 seeds`);
    assert.ok(far >= 8, `sites within 2600 blocks for ${far}/8 seeds`);
    for (const seed of [1, 2, 3, 42, 99]) {
      const t = new TerrainGenerator(seed * 104729);
      const [sx, sz] = t.spawnColumn();
      const h = t.sites.home;
      assert.ok(h && h.kind === "airport" && h.size !== "field", `home airport exists (seed ${seed})`);
      assert.ok(Math.hypot(h.x - sx, h.z - sz) < 1300, `the home airport is near the start (seed ${seed}): ${Math.hypot(h.x - sx, h.z - sz)}`);
      assert.ok(t.sites._outside(h, ...t.sites.toLocal(h, sx, sz)) >= 80, "the start is clear of the airport's pad");
      let nearestOther = Infinity;
      for (let cz = -4; cz <= 4; cz++) for (let cx = -4; cx <= 4; cx++) {
        const s = t.sites._site(cx, cz);
        if (s && s !== h) nearestOther = Math.min(nearestOther, Math.hypot(s.x - h.x, s.z - h.z));
      }
      assert.ok(nearestOther > 1500, `the other sites are far from the home airport: ${nearestOther}`);
      assert.ok(h.half >= 380, `a long runway (half length ${h.half})`);
    }
  });

  await test("a site is dead flat across its whole footprint (chunks and distant terrain agree), with gentle slopes around it", () => {
    const { t, list } = findSites(42);
    const lt = new LodTerrain(t.seed);
    for (const s of list.slice(0, 6)) {
      const r = s.rect;
      const tmp = { top: 0, id: 0, depth: 0 };
      for (let u = r.u0; u <= r.u1; u += 7) {
        for (let v = r.v0; v <= r.v1; v += 7) {
          const [wx, wz] = t.sites.toWorld(s, u, v);
          assert.equal(t.heightAt(wx, wz), s.y, `${s.id} (${u},${v})`);
          lt.sample(wx, wz, tmp);
          assert.equal(tmp.top, s.y + 1, "distant terrain draws the same flat pad");
        }
      }
      // The slope outside: monotone-ish and never a cliff (steps of at most 2 per block).
      let prev = s.y;
      const [dx, dz] = t.sites.dirU(s);
      for (let k = 0; k < 40; k++) {
        const [wx, wz] = t.sites.toWorld(s, r.u1 + k, 10);
        const h = t.heightAt(wx, wz);
        assert.ok(Math.abs(h - prev) <= 3, `${s.id} slope step ${prev} -> ${h} at ${k}`);
        prev = h;
      }
      void dx;
      void dz;
    }
  });

  await test("chunk generation builds the runway (dark, with markings), an apron, hangars, a tower; a runway is long and level", () => {
    const { t, list } = findSites(42, "airport");
    const s = list[0];
    const S = 16;
    const blockAt = (chunks, wx, y, wz) => {
      const cx = wx >> 4;
      const cz = wz >> 4;
      const key = `${cx},${cz}`;
      if (!chunks.has(key)) {
        const chunk = { cx, cz, blocks: new Uint8Array(S * S * 64) };
        t.generate(chunk);
        chunks.set(key, chunk);
      }
      return chunks.get(key).blocks[(y * S + (wz & 15)) * S + (wx & 15)];
    };
    const chunks = new Map();
    let runway = 0;
    let markings = 0;
    for (let u = -s.half + 4; u <= s.half - 4; u++) {
      const [wx, wz] = t.sites.toWorld(s, u, 3);
      const id = blockAt(chunks, wx, s.y, wz);
      if (id === BLOCK.BEDROCK) runway++;
      const [mx, mz] = t.sites.toWorld(s, u, 0);
      if (blockAt(chunks, mx, s.y, mz) === BLOCK.WOOL) markings++;
      // Clear sky above the runway.
      for (let y = s.y + 1; y <= s.y + 12; y++) assert.equal(blockAt(chunks, wx, y, wz), 0, "nothing stands on the runway");
    }
    assert.ok(runway >= s.half * 2 - 60, `dark runway blocks: ${runway} of ${s.half * 2}`);
    assert.ok(markings >= s.half / 3, `centre line dashes: ${markings}`);
    // A hangar wall and the tower's brick shaft.
    const h = s.hangars[1];
    const [hx, hz] = t.sites.toWorld(s, h.u0, (h.v0 + h.v1) / 2);
    assert.notEqual(blockAt(chunks, hx, s.y + 4, hz), 0, "hangar wall");
    const [tx, tz] = t.sites.toWorld(s, s.tower.u0, s.tower.v0 + 2);
    assert.equal(blockAt(chunks, tx, s.y + 6, tz), BLOCK.BRICKS, "tower shaft");
  });

  await test("cities have streets and buildings of different heights with windows and doors", () => {
    const { t, list } = findSites(7, "city");
    const s = list[0];
    const S = 16;
    const chunks = new Map();
    const blockAt = (wx, y, wz) => {
      const cx = wx >> 4;
      const cz = wz >> 4;
      const key = `${cx},${cz}`;
      if (!chunks.has(key)) {
        const chunk = { cx, cz, blocks: new Uint8Array(S * S * 64) };
        t.generate(chunk);
        chunks.set(key, chunk);
      }
      return chunks.get(key).blocks[(y * S + (wz & 15)) * S + (wx & 15)];
    };
    const heights = new Set();
    let glass = 0;
    for (const lot of s.lots) {
      if (lot.kind === "plaza") continue;
      const cu = Math.floor((lot.u0 + lot.u1) / 2);
      const [wx, wz] = t.sites.toWorld(s, lot.u0, Math.floor((lot.v0 + lot.v1) / 2));
      let top = 0;
      for (let y = s.y + 1; y < 64; y++) {
        const id = blockAt(wx, y, wz);
        if (id) top = y - s.y;
        if (id === BLOCK.GLASS) glass++;
      }
      heights.add(top);
      void cu;
    }
    assert.ok(heights.size >= 4, `building heights vary: ${[...heights]}`);
    assert.ok(glass > 10, `windows: ${glass}`);
    assert.ok(s.lots.some((l) => l.kind === "skyscraper") && s.lots.some((l) => l.kind === "house"), "towers and houses");
  });
}

// ---------------------------------------------------------------------------
console.log("\nRound 5: pathfinding and bunkers");
{
  const { Pathfinder } = await import("../js/pathfinding.js");
  const { BLOCK } = await import("../js/blocks.js");
  const { TerrainGenerator } = await import("../js/terrain.js");

  await test("A* walks around a wall, climbs out of a pit with a big jump, and a creature that can only step 1 stays in", () => {
    const Y = 10; // (ground level of the test world)
    const blocks = new Map();
    const set = (x, y, z, id) => blocks.set(`${x},${y + Y},${z}`, id);
    for (let x = -30; x <= 30; x++) for (let z = -30; z <= 30; z++) { set(x, 0, z, BLOCK.STONE); set(x, -1, z, BLOCK.STONE); }
    const world = { getBlock: (x, y, z) => blocks.get(`${x},${y},${z}`) ?? 0 };
    // A wall 3 high from z = -10..10 at x = 5.
    for (let z = -10; z <= 10; z++) for (let y = 1; y <= 3; y++) set(5, y, z, BLOCK.STONE);
    const pf = new Pathfinder(world);
    const r = pf.find([0, Y + 1, 0], { x: 10.5, y: Y + 1, z: 0.5 }, { h: 2, maxNodes: 4000 });
    assert.ok(r.reached, "reached the far side");
    assert.ok(r.path.every(([x, , z]) => !(x === 5 && z >= -10 && z <= 10)), "never through the wall");
    assert.ok(r.path.length > 20, `a detour: ${r.path.length}`);
    // A pit 2 deep (3x3): the rim is a rise of 2 from its floor.
    for (let x = -20; x <= -18; x++) for (let z = -1; z <= 1; z++) { set(x, 0, z, 0); set(x, -1, z, 0); set(x, -2, z, BLOCK.STONE); }
    const out = pf.find([-19, Y - 1, 0], { x: -10.5, y: Y + 1, z: 0.5 }, { h: 2, step: 2, maxNodes: 4000 });
    assert.ok(out.reached, "an alien climbs out of the pit");
    const stuck = pf.find([-19, Y - 1, 0], { x: -10.5, y: Y + 1, z: 0.5 }, { h: 2, step: 1, maxNodes: 600 });
    assert.ok(!stuck.reached, "a creature that can only step 1 stays in");
  });

  await test("airport bunkers: deterministic spots, a hall below the apron with floor, guards, a zone, and a ramp down", () => {
    const t = new TerrainGenerator(42);
    let site = null;
    for (let cz = -6; cz <= 6 && !site; cz++) for (let cx = -6; cx <= 6 && !site; cx++) {
      const s = t.sites._site(cx, cz);
      if (s && s.kind === "airport" && s.bunkers.length) site = s;
    }
    assert.ok(site, "an airport with a bunker exists");
    const a = t.sites.bunkerSpots(site);
    const b = t.sites.bunkerSpots(site);
    assert.deepEqual(a, b);
    const spot = a[0];
    assert.ok(spot.guards.length >= 4 && spot.zone.r >= 40);
    assert.ok(spot.y < site.y, "the hall lies below the surface");
    const S = 16;
    const chunks = new Map();
    const blockAt = (wx, y, wz) => {
      const cx = wx >> 4;
      const cz = wz >> 4;
      const key = `${cx},${cz}`;
      if (!chunks.has(key)) {
        const chunk = { cx, cz, blocks: new Uint8Array(S * S * 128) };
        t.generate(chunk);
        chunks.set(key, chunk);
      }
      return chunks.get(key).blocks[(y * S + (wz & 15)) * S + (wx & 15)];
    };
    const hx = Math.floor(spot.x);
    const hz = Math.floor(spot.z);
    assert.notEqual(blockAt(hx, spot.y - 1, hz), 0, "a floor");
    for (let k = 0; k < 6; k++) assert.equal(blockAt(hx, Math.floor(spot.y) + k, hz), 0, "air in the hall for the ship");
    for (const g of spot.guards) {
      assert.notEqual(blockAt(Math.floor(g.x), Math.floor(g.y) - 1, Math.floor(g.z)), 0, "guards stand on something");
      assert.equal(blockAt(Math.floor(g.x), Math.floor(g.y), Math.floor(g.z)), 0, "and have room");
    }
  });
}

// ---------------------------------------------------------------------------
console.log("\nProgression (progression.js)");
{
  const { Progress, MISSIONS, rollLoot, pickWeapon, WEAPON_TIERS, CRATE_WEAPONS, ALIEN_WEAPONS, pickAlienWeapon } = await import("../js/progression.js");
  const { ITEM } = await import("../js/items.js");

  await test("the mission chain (21 missions) advances as the stats do, rewards fire, it survives save/load, and old saves carry over", () => {
    const stats = { ufosDown: 0, aliensKilled: 0, skeletonsKilled: 0, cratesOpened: 0, nightsSurvived: 0, ufosBoarded: 0, takeoffs: 0, ufosDownByJet: 0, enemyJetsDown: 0, raidersDown: 0, ufosDownLarge: 0, ufosDownBig: 0, airportsNuked: 0, landings: 0, landingSquad: 0, meteorFragments: 0, bossesDown: 0 };
    const p = new Progress();
    p.load(null, stats);
    let done = [];
    p.onComplete = (m) => done.push(m.id);
    assert.equal(MISSIONS.length, 21);
    assert.equal(p.mission.id, "skeleton");
    stats.aliensKilled = 2;
    p.update(stats);
    assert.equal(done.length, 0, "the skeleton first");
    stats.skeletonsKilled = 1;
    p.update(stats);
    assert.deepEqual(done, ["skeleton"]);
    assert.equal(p.mission.id, "landing");
    assert.equal(p.objectives(stats)[0].value, 0, "the next mission counts from now (the earlier kills don't count)");
    stats.aliensKilled = 4;
    p.update(stats);
    assert.equal(p.mission.id, "supply");
    const saved = JSON.parse(JSON.stringify(p.serialize()));
    const q = new Progress();
    q.load(saved, stats);
    assert.equal(q.mission.id, "supply");
    stats.cratesOpened = 1;
    q.update(stats);
    assert.equal(q.mission.id, "first_contact");
    // The sky: no UFOs for the first two missions, then one, then more; and
    // it grows harder along the chain.
    assert.equal(MISSIONS[0].rules.max, 0);
    assert.equal(MISSIONS[1].rules.max, 0);
    assert.equal(MISSIONS[2].rules.max, 1);
    assert.deepEqual(Object.keys(MISSIONS[3].rules.sizes), ["small"]);
    assert.ok(MISSIONS[3].rules.health < 0.7 && MISSIONS[3].rules.damage < 0.7);
    for (let i = 1; i < MISSIONS.length; i++) {
      const a = MISSIONS[i - 1].rules;
      const b = MISSIONS[i].rules;
      assert.ok(b.health >= a.health && b.damage >= a.damage && b.max >= a.max && MISSIONS[i].tier >= MISSIONS[i - 1].tier, `mission ${i + 1} is no easier than ${i}`);
    }
    // Rewards: apples and golden apples only.
    for (const m of MISSIONS) for (const [id] of m.reward) assert.ok(id === ITEM.APPLE || id === ITEM.GOLDEN_APPLE, `${m.id} rewards only apples`);
    // Alien ships are boarded late; the jets come before; the alien weapons come weakest first.
    const idx = (id) => MISSIONS.findIndex((m) => m.id === id);
    assert.ok(idx("salvage") >= 12 && idx("wings") < idx("salvage"));
    // Round 6: the landing follows the first flight, the meteor storm and the boss are in, the boss comes after
    // the railgun and before the final 25 UFOs, and the old mothership mission is the boss now.
    assert.equal(idx("touchdown"), idx("wings") + 1);
    assert.ok(idx("reds") < idx("meteors") && idx("meteors") < idx("salvage"));
    assert.ok(idx("reds") < idx("overlord") && idx("overlord") === idx("slayer") - 1 && idx("sunburn") < idx("overlord"));
    assert.equal(idx("mothership"), -1);
    assert.deepEqual(MISSIONS[idx("touchdown")].objectives.map((o) => o.stat), ["landings", "landingSquad"]);
    // A v4 (Round 4/5) save carries over by mission id: the old "wings" is still "wings", the old mothership fight continues at the base, the end stays the end.
    const v4 = (id) => { const q = new Progress(); q.load({ v: 4, step: ["skeleton", "landing", "supply", "first_contact", "crew", "long_night", "patrol", "scout_hunter", "grays", "wings", "dogfight", "air_superiority", "village", "reds", "salvage", "big_game", "mothership", "sunburn", "slayer"].indexOf(id), base: {}, done: [] }, stats); return q.mission?.id; };
    assert.equal(v4("wings"), "wings");
    assert.equal(v4("dogfight"), "dogfight");
    assert.equal(v4("mothership"), "sunburn");
    assert.equal(v4("slayer"), "slayer");
    const v4end = new Progress();
    v4end.load({ v: 4, step: 19, base: {}, done: [] }, stats);
    assert.equal(v4end.mission, null);
    assert.ok(idx("patrol") < idx("grays") && idx("grays") < idx("reds"));
    assert.deepEqual([idx("patrol"), idx("grays"), idx("reds")].map((i) => MISSIONS[i].squad.leaderDrop), [ITEM.LASER_BLASTER, ITEM.MINIGUN, ITEM.RAILGUN]);
    // The patrol leaders' weapons are within reach of their mission's tier.
    for (const i of [idx("patrol"), idx("grays"), idx("reds")]) {
      const w = MISSIONS[i].squad.leaderDrop;
      assert.ok(ALIEN_WEAPONS.find(([id]) => id === w)[1] <= MISSIONS[i].tier, `${MISSIONS[i].id} tier`);
    }
    // Everything through to the end.
    for (let i = 0; i < 25; i++) {
      for (const k of Object.keys(stats)) stats[k] += 50; // (each mission counts from when it starts)
      q.update(stats);
    }
    assert.equal(q.mission, null);
    assert.equal(q.completed, MISSIONS.length);
    assert.equal(q.list(stats).filter((m) => m.state === "done").length, MISSIONS.length);
    // A Round 3 save (15 missions; its current one was "salvage") carries over, past the new opening.
    const v3 = new Progress();
    v3.load({ v: 3, step: 4, base: {}, done: [] }, stats);
    assert.ok(v3.step >= 5 && v3.mission && v3.mission.id !== "salvage", `v3 progress kept: ${v3.step} ${v3.mission?.id}`);
    // A Round 2 save (7 old missions, 3 done) carries over.
    const old = new Progress();
    old.load({ step: 3, base: {}, done: ["first_contact", "salvage", "wings"] }, stats);
    assert.ok(old.step >= 5 && old.mission, `old progress kept: ${old.step}`);
  });

  await test("weapons come from their own sources: bows from skeletons, standard guns from crates, alien weapons from aliens (weakest first), none from wrecks, fighters or missions", () => {
    let rng = 1;
    const rand = () => ((rng = (rng * 16807) % 2147483647) / 2147483647);
    const crateSet = new Set(CRATE_WEAPONS.map(([id]) => id));
    const alienSet = new Set(ALIEN_WEAPONS.map(([id]) => id));
    const isWeapon = (id) => crateSet.has(id) || alienSet.has(id) || id === ITEM.BOW;
    // Skeletons: the bow (once).
    assert.deepEqual(rollLoot("skeleton", null, 0, new Set(), rand), [[ITEM.BOW, 1]]);
    assert.deepEqual(rollLoot("skeleton", null, 0, new Set([ITEM.BOW]), rand), []);
    // Wrecks and fighters: never a weapon.
    for (let i = 0; i < 300; i++) {
      for (const size of ["small", "large", "giant"]) for (const [id] of rollLoot("ufo", size, 5, new Set(), rand)) assert.ok(!isWeapon(id), `a ${size} wreck dropped ${id}`);
      for (const [id] of rollLoot("enemyjet", null, 5, new Set(), rand)) assert.ok(!isWeapon(id), "a fighter dropped a weapon");
    }
    // Crates: only standard weapons, the first one a pistol, never a repeat.
    const first = rollLoot("crate", null, 0, new Set(), rand);
    assert.ok(first.some(([id]) => id === ITEM.PISTOL), "the first crate has the pistol");
    for (let i = 0; i < 300; i++) {
      const owned = new Set([ITEM.PISTOL, ITEM.MACHINE_GUN]);
      for (const [id] of rollLoot("crate", null, 5, owned, rand)) {
        assert.ok(!alienSet.has(id), "no alien weapon in a crate");
        assert.ok(!owned.has(id), "crates never repeat a weapon");
      }
    }
    for (let i = 0; i < 100; i++) for (const [id] of rollLoot("crate", null, 1, new Set([ITEM.PISTOL]), rand)) assert.ok(![ITEM.BAZOOKA, ITEM.AIRSTRIKE, ITEM.SNIPER_RIFLE].includes(id), "no heavy crate weapons early");
    // Aliens: nothing before the chain gets there, then weakest first, and a green never carries a railgun.
    for (let i = 0; i < 300; i++) for (const [id] of rollLoot("alien", "red", 1, new Set(), rand)) assert.ok(!isWeapon(id), "no alien weapon at tier 1");
    assert.equal(pickAlienWeapon("green", 5, new Set()), ITEM.LASER_BLASTER);
    assert.equal(pickAlienWeapon("green", 5, new Set([ITEM.LASER_BLASTER])), null, "greens stop at the blaster");
    assert.equal(pickAlienWeapon("red", 5, new Set([ITEM.LASER_BLASTER])), ITEM.MINIGUN, "the weakest missing one first");
    assert.equal(pickAlienWeapon("red", 3, new Set([ITEM.LASER_BLASTER, ITEM.MINIGUN])), null, "the railgun waits for tier 4");
    assert.equal(pickAlienWeapon("red", 4, new Set([ITEM.LASER_BLASTER, ITEM.MINIGUN])), ITEM.RAILGUN);
    let got = 0;
    for (let i = 0; i < 400; i++) if (rollLoot("alien", "green", 2, new Set(), rand).some(([id]) => id === ITEM.LASER_BLASTER)) got++;
    assert.ok(got > 40 && got < 140, `greens sometimes drop the blaster at tier 2: ${got}/400`);
    const all = new Set(WEAPON_TIERS.map(([id]) => id));
    assert.equal(pickWeapon(5, all), null, "everything owned: nothing to pick");
  });
}

console.log("Multiplayer (js/net)");
{
  const { randomRoomCode, normalizeRoomCode, isRoomCode, cleanNick, netErrorText } = await import("../js/net/session.js");
  const { Interp } = await import("../js/net/interp.js");
  const { ROOM_CODE_ALPHABET, ROOM_CODE_LENGTH, ICE_SERVERS } = await import("../js/net/config.js");

  await test("room codes: random ones are valid, typed ones are normalised, look-alikes never appear", () => {
    for (let i = 0; i < 200; i++) {
      const c = randomRoomCode();
      assert.equal(c.length, ROOM_CODE_LENGTH);
      assert.ok(isRoomCode(c), c);
      assert.ok(!/[01OIL]/.test(c), c);
    }
    assert.equal(normalizeRoomCode(" k7m-pq "), "K7MPQ");
    assert.ok(isRoomCode(normalizeRoomCode("k7mpq")));
    assert.ok(!isRoomCode("K7MP"), "too short");
    assert.ok(!isRoomCode("K7MP0"), "0 is not in the alphabet");
    assert.ok(![..."0O1IL"].some((ch) => ROOM_CODE_ALPHABET.includes(ch)));
  });

  await test("nicknames are cleaned (no markup, no control characters, at most 16 characters)", () => {
    assert.equal(cleanNick("  Bob   the  Pilot "), "Bob the Pilot");
    assert.equal(cleanNick("<b>Eve</b>"), "bEve/b");
    assert.equal(cleanNick("x".repeat(40)).length, 16);
    assert.equal(cleanNick("\u0007Zed"), "Zed");
  });

  await test("connection errors explain themselves; ICE has STUN and room for a TURN server", () => {
    for (const code of ["room-not-found", "signaling", "connect-failed", "host-left", "kicked", "version"]) {
      const e = netErrorText({ code });
      assert.equal(e.code, code);
      assert.ok(e.title.length > 5 && e.help.length > 20, code);
    }
    assert.equal(netErrorText(new Error("boom")).code, "unknown");
    assert.ok(ICE_SERVERS.some((s) => String(s.urls).startsWith("stun:")));
  });

  await test("interpolation: in between two states, a delay behind, extrapolated briefly, snaps on a teleport", () => {
    const ip = new Interp({ angles: ["y"], quats: ["q"], snap: 20 });
    // States every 50 ms moving +10 blocks/s along x; arriving on time.
    for (let i = 0; i <= 10; i++) ip.push({ ts: i * 0.05, p: [i * 0.5, 0, 0], v: [10, 0, 0], y: 0, q: [0, 0, 0, 1] }, i * 0.05);
    const s = ip.sample(0.5);
    // Drawn ~0.1 s in the past: about 4 blocks along.
    assert.ok(Math.abs(s.p[0] - (0.5 - ip.delay) * 10) < 0.05, `x ${s.p[0]} delay ${ip.delay}`);
    // A gap in the stream: carried on by the velocity, but not for ever.
    const late = ip.sample(0.5 + ip.delay + 0.1);
    assert.ok(late.p[0] > 5 && late.p[0] < 5 + 10 * 0.26, `extrapolated ${late.p[0]}`);
    // Angles take the short way round.
    const a = new Interp({ angles: ["y"] });
    a.push({ ts: 0, p: [0, 0, 0], y: 3.1 }, 0);
    a.push({ ts: 0.1, p: [0, 0, 0], y: -3.1 }, 0.1);
    const mid = a.sample(0.05 + a.delay);
    assert.ok(Math.abs(Math.abs(mid.y) - Math.PI) < 0.05, `yaw ${mid.y}`);
    // A teleport is not slid across.
    const t = new Interp({ snap: 20 });
    t.push({ ts: 0, p: [0, 0, 0], v: [0, 0, 0] }, 0);
    t.push({ ts: 0.1, p: [500, 0, 0], v: [0, 0, 0] }, 0.1);
    const tp = t.sample(0.06 + t.delay);
    assert.ok(tp.p[0] === 0 || tp.p[0] === 500, `teleport drawn at ${tp.p[0]}`);
  });

  await test("interpolation never blends flags or ids (Round 8: a walking zombie never reads as dead)", () => {
    const ip = new Interp({ angles: ["y"] });
    // On the ground (4), then on the ground with a target (12): halfway, a blend would be 8 or an odd 5..11.
    for (let i = 0; i <= 10; i++) ip.push({ ts: i * 0.05, p: [i * 0.2, 0, 0], v: [4, 0, 0], f: i % 2 ? 12 : 4, h: i % 2 ? 300 : 7 }, i * 0.05);
    for (let t = 0.12; t < 0.6; t += 0.007) {
      const s = ip.sample(t);
      assert.ok(s.f === 4 || s.f === 12, `flags ${s.f} at ${t}`);
      assert.ok(s.h === 7 || s.h === 300, `held item ${s.h} at ${t}`);
    }
  });

  await test("a block-edit batch survives the wire (the run-length format, per chunk)", () => {
    const map = new Map();
    for (let i = 0; i < 400; i++) map.set(blockIndex(i % 16, 30 + (i >> 8), (i >> 4) % 16), i % 3 === 0 ? 0 : 5);
    const back = decodeChunkEdits(encodeChunkEdits(map));
    assert.deepEqual([...back].sort((a, b) => a[0] - b[0]), [...map].sort((a, b) => a[0] - b[0]));
  });
}

console.log(`\n${passed} passed, ${failed} failed.`);
process.exit(failed > 0 ? 1 : 0);
