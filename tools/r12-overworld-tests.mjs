// Round 12 overworld tests: a Survival world's villages, temples and jungles.
// In Node (fast): jungles cover a fair share of the land and turn up near the
// start; their chunks hold giant jungle trees (2x2 trunks 10-31 tall, a wide
// canopy, vines), jungle trees with vines and cocoa, bushes, ferns and
// melons, and cost about what other chunks do; a village found near a seed
// has its parts (a well, streets of path on the ground, houses on
// foundations with doors, beds, chests of vanilla's village loot, lamp
// posts, farms, job's blocks, residents with their trades) and is the same
// whichever order its chunks are made in; a desert temple's hidden room and
// towers; a jungle temple's chests, levers, pistons and torch; a Missions
// world's chunks are unchanged.
// In the browser (the real game, a Survival world): the jungle temple's right
// lever opens its hidden door (the pistons pull it aside) and closes it
// again; a wrong lever does nothing.
//
//   node r12-overworld-tests.mjs [--only=substring] [--node]
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
const { BLOCK, BLOCK_INFO, IS_SOLID, IS_CHEST, IS_LOG, IS_LEAVES } = await imp("js/blocks.js");
const { itemInfo } = await imp("js/items.js");
const V = await imp("js/content/ids.js");
const N = await imp("js/content/nature.js");
const { TerrainGenerator } = await imp("js/terrain.js");
const { BIOME } = await imp("js/biomes.js");
const { TREE, TREE_REACH } = await imp("js/trees.js");
const WT = await imp("js/worldtype.js");
const ST = await imp("js/structures.js");
const { SEA_LEVEL } = await imp("js/constants.js");

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
const fnv = (arr, h = 2166136261) => {
  for (let i = 0; i < arr.length; i++) h = Math.imul(h ^ arr[i], 16777619) >>> 0;
  return h;
};
function seeded(s = 1) {
  let x = s >>> 0 || 1;
  return () => {
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    return (x >>> 0) / 4294967296;
  };
}
const nameOf = (id) => BLOCK_INFO[id]?.name || String(id);
const isVine = (id) => id >= V.VINE && id < V.VINE + 4;

// A Survival world's chunks on demand.
class Chunks {
  constructor(seed) {
    this.gen = new TerrainGenerator(seed, { sites: false });
    this.map = new Map();
    this.ms = 0;
    this.made = 0;
  }
  chunk(cx, cz) {
    const k = `${cx},${cz}`;
    let b = this.map.get(k);
    if (!b) {
      b = new Uint16Array(16 * 128 * 16);
      const t0 = performance.now();
      this.gen.generate({ cx, cz, blocks: b });
      this.ms += performance.now() - t0;
      this.made++;
      this.map.set(k, b);
    }
    return b;
  }
  getBlock(x, y, z) {
    if (y < 0 || y >= 128) return BLOCK.AIR;
    return this.chunk(x >> 4, z >> 4)[(y * 16 + (z & 15)) * 16 + (x & 15)];
  }
}
const SEEDS = [12345, 777, 2024, 42, 9, 5, 31337, 1];
// The nearest column of a deep jungle to the start, or null.
function findJungle(gen, deep = 0.8, R = 4000) {
  const [sx, sz] = gen.spawnColumn();
  for (let r = 0; r < R; r += 48) {
    for (let a = 0; a < 48; a++) {
      const x = Math.round(sx + Math.cos((a / 48) * Math.PI * 2) * r);
      const z = Math.round(sz + Math.sin((a / 48) * Math.PI * 2) * r);
      if (gen.biomeAt(x, z) === BIOME.JUNGLE && gen.biomes.jungleDepth(x, z) >= deep) return { x, z, d: r };
    }
  }
  return null;
}

// ---------- Jungles ----------

await check("jungles: about one land column in twelve (twice the old share), the nearest mostly within 2 km of the start", async () => {
  WT.setWorldType("survival");
  let land = 0;
  let jungle = 0;
  let oldJungle = 0;
  const near = [];
  for (const seed of SEEDS) {
    const gen = new TerrainGenerator(seed, { sites: false });
    const old = new TerrainGenerator(seed, {});
    for (let x = -6000; x < 6000; x += 120) {
      for (let z = -6000; z < 6000; z += 120) {
        const b = gen.biomeAt(x, z);
        if (b <= BIOME.RIVER) continue;
        land++;
        if (b === BIOME.JUNGLE) jungle++;
        if (old.biomeAt(x, z) === BIOME.JUNGLE) oldJungle++;
      }
    }
    near.push(findJungle(gen, 0, 6000)?.d ?? Infinity);
  }
  const share = jungle / land;
  assert(share > 0.06 && share < 0.13, `jungle share of the land ${(share * 100).toFixed(1)}%`);
  assert(jungle > oldJungle * 1.5, `${jungle} jungle columns, a Missions world's ${oldJungle}`);
  const close = near.filter((d) => d <= 2000).length;
  assert(close >= SEEDS.length * 0.6, `nearest jungles: ${near.join(", ")}`);
});

let jungleArea = null;
await check("a jungle's chunks: giant jungle trees (2x2 trunks 10-31 tall under wide canopies, vines), jungle trees with vines and cocoa, bushes, ferns, melons", async () => {
  WT.setWorldType("survival");
  const c = new Chunks(2024);
  const j = findJungle(c.gen);
  assert(j, "no jungle near the start");
  jungleArea = { seed: 2024, ...j };
  const cnt = { giants: 0, tallest: 0, jungleTrees: 0, bushes: 0, vines: 0, hanging: 0, cocoa: 0, ferns: 0, melons: 0, chunks: 0 };
  const cx0 = j.x >> 4;
  const cz0 = j.z >> 4;
  for (let cx = cx0 - 4; cx <= cx0 + 4; cx++) {
    for (let cz = cz0 - 4; cz <= cz0 + 4; cz++) {
      cnt.chunks++;
      for (let lx = 0; lx < 16; lx++) {
        for (let lz = 0; lz < 16; lz++) {
          const x = cx * 16 + lx;
          const z = cz * 16 + lz;
          const root = c.gen.trees.rootAt(x, z);
          if (root?.species === TREE.MEGA_JUNGLE) {
            // The 2x2 trunk from the ground up, as tall as its shape says.
            let h = 0;
            while (h < 40 && [0, 1].every((dx) => [0, 1].every((dz) => c.getBlock(x + dx, root.h + 1 + h, z + dz) === V.JUNGLE_LOG))) h++;
            if (h >= 10) {
              cnt.giants++;
              cnt.tallest = Math.max(cnt.tallest, h);
              assert(h <= 31, `a giant ${h} tall`);
              // Its canopy: jungle leaves 5 out from the trunk near its top.
              let leaves = 0;
              for (let dx = -6; dx <= 7; dx++) for (let dz = -6; dz <= 7; dz++) for (let dy = h - 3; dy <= h + 1; dy++) if (c.getBlock(x + dx, root.h + 1 + dy, z + dz) === V.JUNGLE_LEAVES) leaves++;
              assert(leaves >= 60, `a giant at ${x},${z} with ${leaves} canopy leaves`);
            }
            // Never farther than TREE_REACH from its root.
            const s = c.gen.trees.shape(root);
            for (let i = 0; i < s.length; i += 4) assert(Math.abs(s[i]) <= TREE_REACH && Math.abs(s[i + 2]) <= TREE_REACH, "a giant's block out of reach");
          } else if (root?.species === TREE.JUNGLE) cnt.jungleTrees++;
          else if (root?.species === TREE.BUSH) {
            if (c.getBlock(x, root.h + 1, z) === V.JUNGLE_LOG && c.getBlock(x + 1, root.h + 1, z) === BLOCK.LEAVES) cnt.bushes++;
          }
          for (let y = SEA_LEVEL; y < 128; y++) {
            const id = c.getBlock(x, y, z);
            if (isVine(id)) {
              cnt.vines++;
              // (hanging: nothing solid on its wall's side, a vine or leaves above)
              const k = id - V.VINE;
              const [wx, wz] = [[0, 1], [0, -1], [1, 0], [-1, 0]][k];
              if (!IS_SOLID[c.getBlock(x + wx, y, z + wz)] && !IS_LEAVES[c.getBlock(x + wx, y, z + wz)]) cnt.hanging++;
            } else if (N.isCocoa(id)) cnt.cocoa++;
            else if (id === V.FERN) cnt.ferns++;
            else if (id === V.MELON) cnt.melons++;
          }
        }
      }
    }
  }
  console.log(`        jungle at ${j.x},${j.z}: ${JSON.stringify(cnt)}`);
  assert(cnt.giants >= 10, `${cnt.giants} giant jungle trees in ${cnt.chunks} chunks`);
  assert(cnt.tallest >= 18, `the tallest giant is ${cnt.tallest}`);
  assert(cnt.jungleTrees >= 20 && cnt.bushes >= 20, `${cnt.jungleTrees} jungle trees, ${cnt.bushes} bushes`);
  assert(cnt.vines > 1000 && cnt.hanging > 200, `${cnt.vines} vines, ${cnt.hanging} hanging`);
  assert(cnt.cocoa >= 4 && cnt.ferns >= 100 && cnt.melons >= 1, `${cnt.cocoa} cocoa pods, ${cnt.ferns} ferns, ${cnt.melons} melons`);
});

await check("a jungle's chunks cost about what other chunks do to make (giant trees included)", async () => {
  WT.setWorldType("survival");
  assert(jungleArea, "no jungle found");
  const c = new Chunks(jungleArea.seed);
  // (warm up the generator first: the first chunks pay for the code's compiling)
  for (let i = 0; i < 9; i++) c.chunk(400 + i, 400);
  const time = (cx0, cz0) => {
    const ms0 = c.ms;
    const n0 = c.made;
    for (let cx = cx0 - 3; cx <= cx0 + 3; cx++) for (let cz = cz0 - 3; cz <= cz0 + 3; cz++) c.chunk(cx, cz);
    return (c.ms - ms0) / (c.made - n0);
  };
  const [sx, sz] = c.gen.spawnColumn();
  const plain = time((sx >> 4) + 40, sz >> 4);
  const jungle = time(jungleArea.x >> 4, jungleArea.z >> 4);
  console.log(`        ms a chunk: jungle ${jungle.toFixed(2)}, elsewhere ${plain.toFixed(2)}`);
  assert(jungle < plain * 2.5 + 1, `jungle chunks take ${jungle.toFixed(2)} ms, others ${plain.toFixed(2)}`);
});

// ---------- Villages ----------

// The nearest village to the start of a seed's Survival world.
function nearestVillage(gen) {
  const [sx, sz] = gen.spawnColumn();
  const list = gen.villages._villagesNear(sx - 3000, sz - 3000, sx + 3000, sz + 3000);
  list.sort((a, b) => Math.hypot(a.x - sx, a.z - sz) - Math.hypot(b.x - sx, b.z - sz));
  return list[0] || null;
}

await check("a village: a well, streets of path on the ground, houses on foundations with doors, beds, chests of village loot, lamps, farms, job's blocks, residents with trades", async () => {
  WT.setWorldType("survival");
  const styles = new Set();
  for (const seed of [42, 777, 12345]) {
    const c = new Chunks(seed);
    const v = nearestVillage(c.gen);
    assert(v && v.style, `seed ${seed}: no village within 3 km`);
    styles.add(v.style);
    const lay = c.gen.villages.layout(v);
    const kinds = {};
    for (const p of lay.pieces) kinds[p.kind] = (kinds[p.kind] || 0) + 1;
    const houses = lay.houses.filter((h) => h.kind !== "well");
    assert(lay.pieces.length >= 8 && lay.pieces.length <= 24, `seed ${seed}: ${lay.pieces.length} pieces`);
    assert(houses.length >= 5, `seed ${seed}: ${houses.length} buildings`);
    // Count what stands there.
    const cnt = { water: 0, path: 0, doors: 0, beds: 0, chests: 0, lights: 0, farmland: 0, crops: 0, jobs: 0 };
    const R = 62;
    for (let dx = -R; dx <= R; dx++) {
      for (let dz = -R; dz <= R; dz++) {
        for (let y = SEA_LEVEL - 4; y < 110; y++) {
          const id = c.getBlock(v.x + dx, y, v.z + dz);
          if (!id) continue;
          const name = nameOf(id).toLowerCase();
          if (id === V.DIRT_PATH || (v.style === "desert" && id === V.SMOOTH_SANDSTONE && y <= c.gen.heightAt(v.x + dx, v.z + dz))) cnt.path++;
          else if (name.includes("door")) cnt.doors++;
          else if (name.includes("bed")) cnt.beds++;
          else if (IS_CHEST[id]) {
            cnt.chests++;
            const table = c.gen.structures.chestAt(v.x + dx, y, v.z + dz);
            assert(table && table.startsWith("village_"), `a chest at ${v.x + dx},${y},${v.z + dz} rolls ${table}`);
            const loot = ST.rollStructureLoot(table, seeded(dx * 31 + dz));
            assert(loot.every(([lid, n]) => itemInfo(lid) && n >= 1), `${table}: ${JSON.stringify(loot)}`);
          } else if (name.includes("torch") || name.includes("lantern")) cnt.lights++;
          else if (id === V.FARMLAND || id === V.FARMLAND + 1) cnt.farmland++;
          else if (name.includes("wheat") || name.includes("carrot") || name.includes("potato") || name.includes("beetroot")) cnt.crops++;
          else if ([V.BOOKSHELF, V.BREWING_STAND, V.BARREL, V.HAY_BLOCK, BLOCK.CRAFTING_TABLE].includes(id) || name.includes("furnace") || name.includes("anvil") || name.includes("cauldron")) cnt.jobs++;
          else if (id === BLOCK.WATER && Math.abs(dx) <= 2 && Math.abs(dz) <= 2) cnt.water++;
        }
      }
    }
    console.log(`        seed ${seed}: ${v.style} village at ${v.x},${v.z}: ${lay.pieces.length} pieces ${JSON.stringify(kinds)}, ${JSON.stringify(cnt)}`);
    assert(cnt.water >= 4, `seed ${seed}: the well holds ${cnt.water} water`);
    assert(cnt.path >= 150, `seed ${seed}: ${cnt.path} path blocks`);
    assert(cnt.doors >= houses.length * 2 - 4, `seed ${seed}: ${cnt.doors} door halves for ${houses.length} buildings`);
    assert(cnt.beds >= 8, `seed ${seed}: ${cnt.beds} bed halves`);
    assert(cnt.chests >= 3 && cnt.lights >= 10 && cnt.jobs >= 3, `seed ${seed}: ${JSON.stringify(cnt)}`);
    if (kinds.farm || kinds.bigfarm) assert(cnt.farmland >= 20 && cnt.crops >= 20, `seed ${seed}: farms ${cnt.farmland} farmland, ${cnt.crops} crops`);
    // The streets lie on the ground (or bridge water), open above.
    const sc = lay.streetCells;
    for (let i = 0; i < sc.length; i += 3) {
      const x = v.x + sc[i];
      const y = sc[i + 1];
      const z = v.z + sc[i + 2];
      const g = c.gen.heightAt(x, z);
      assert(y === g || (y === SEA_LEVEL && g < SEA_LEVEL), `a street at ${x},${y},${z} over ground at ${g}`);
      assert(!IS_SOLID[c.getBlock(x, y + 1, z)] || IS_CHEST[c.getBlock(x, y + 1, z)] === 0, `a street blocked at ${x},${y + 1},${z}`);
    }
    // Houses stand on their foundations: solid from the ground to the floor everywhere under them.
    for (const h of houses) {
      for (let x = h.x; x < h.x + h.w; x++) {
        for (let z = h.z; z < h.z + h.d; z++) {
          const g = c.gen.heightAt(v.x + x, v.z + z);
          for (let y = Math.min(g, h.y); y <= h.y; y++) assert(IS_SOLID[c.getBlock(v.x + x, y, v.z + z)] || c.getBlock(v.x + x, y, v.z + z) === BLOCK.WATER, `a gap under a ${h.kind} at ${v.x + x},${y},${v.z + z} (floor ${h.y}, ground ${g}): ${nameOf(c.getBlock(v.x + x, y, v.z + z))}`);
          // ... and no tree grows through them.
          for (let y = h.y + 1; y <= h.y + h.h; y++) assert(!IS_LOG[c.getBlock(v.x + x, y, v.z + z)] || [BLOCK.WOOD, BLOCK.PINE_LOG, V.ACACIA_LOG].includes(c.getBlock(v.x + x, y, v.z + z)), "a tree in a house");
        }
      }
    }
    // Its people: one a bed, the jobs handed out first.
    const res = c.gen.villages.residents(v);
    assert(res.length >= 4 && res.some((r) => r.profession >= 0), `seed ${seed}: residents ${JSON.stringify(res.slice(0, 5))}`);
    for (const r of res) assert(!IS_SOLID[c.getBlock(r.x, r.y, r.z)] && !IS_SOLID[c.getBlock(r.x, r.y + 1, r.z)], `a resident's spot at ${r.x},${r.y},${r.z} is blocked`);
    assert(c.gen.villages.streetSpot(v, seeded(1)), "no street spot");
    // No trees on its streets.
    for (let i = 0; i < sc.length; i += 3) assert(!c.gen.trees.rootAt(v.x + sc[i], v.z + sc[i + 2]), "a tree on a street");
  }
  assert(styles.size >= 2, `village styles: ${[...styles]}`);
});

await check("villages of every style turn up, and a village is the same whichever order its chunks are made in", async () => {
  WT.setWorldType("survival");
  const styles = new Set();
  for (const seed of SEEDS) {
    const gen = new TerrainGenerator(seed, { sites: false });
    for (const v of gen.villages._villagesNear(-4000, -4000, 4000, 4000)) styles.add(v.style);
  }
  for (const s of ["plains", "desert", "savanna", "taiga", "snowy"]) assert(styles.has(s), `no ${s} village in ${SEEDS.length} seeds' 8 km squares (${[...styles]})`);
  // Two generators, the chunks in opposite orders: the same blocks.
  const a = new TerrainGenerator(42, { sites: false });
  const b = new TerrainGenerator(42, { sites: false });
  const v = nearestVillage(a);
  const list = [];
  for (let cx = (v.x >> 4) - 3; cx <= (v.x >> 4) + 3; cx++) for (let cz = (v.z >> 4) - 3; cz <= (v.z >> 4) + 3; cz++) list.push([cx, cz]);
  const ha = new Map();
  for (const [cx, cz] of list) {
    const blocks = new Uint16Array(16 * 128 * 16);
    a.generate({ cx, cz, blocks });
    ha.set(`${cx},${cz}`, fnv(blocks));
  }
  for (const [cx, cz] of list.reverse()) {
    const blocks = new Uint16Array(16 * 128 * 16);
    b.generate({ cx, cz, blocks });
    assert(ha.get(`${cx},${cz}`) === fnv(blocks), `chunk ${cx},${cz} differs`);
  }
  // A Missions world's village is the old one (a pad, no streets of path).
  WT.setWorldType("missions");
  const m = new TerrainGenerator(777, {});
  let center = null;
  for (let cx = -6; cx <= 6 && !center; cx++) for (let cz = -6; cz <= 6 && !center; cz++) center = m.villages._cellCenter(cx, cz);
  assert(center && !center.style && m.villages.houses(center).length >= 6, "a Missions world's village");
  WT.setWorldType("survival");
});

// ---------- Temples ----------

await check("desert temples: hollow towers with the blue-eyed pattern, the entrance block, the hall's pillars, the hidden room's four chests over the TNT", async () => {
  WT.setWorldType("survival");
  const c = new Chunks(777);
  let t = null;
  for (let rx = -6; rx < 6 && !t; rx++) for (let rz = -6; rz < 6 && !t; rz++) t = c.gen.structures.templeAt(rx, rz);
  assert(t, "no desert temple");
  const cells = { blue: 0, orange: 0, chiseled: 0, chests: 0, stairs: 0 };
  for (let x = t.x0; x < t.x0 + 21; x++) {
    for (let z = t.z0; z < t.z0 + 21; z++) {
      for (let y = t.floor - 14; y <= t.floor + 14; y++) {
        const id = c.getBlock(x, y, z);
        if (id === V.BLUE_TERRACOTTA) cells.blue++;
        else if (id === V.ORANGE_TERRACOTTA) cells.orange++;
        else if (id === V.CHISELED_SANDSTONE) cells.chiseled++;
        else if (IS_CHEST[id]) cells.chests++;
        else if (id >= V.SANDSTONE_STAIRS && id < V.SANDSTONE_STAIRS + 8) cells.stairs++;
      }
    }
  }
  assert(cells.blue >= 5 && cells.orange >= 40 && cells.chiseled >= 8 && cells.chests === 4 && cells.stairs >= 8, JSON.stringify(cells));
  for (const [x, y, z] of t.chests) assert(c.gen.structures.chestAt(x, y, z) === "desert_pyramid", "a temple chest not known as one");
  // A tower is hollow, with a doorway into the hall.
  const cell = (u, dy, v) => ST.STRUCTURE_INFO.templeCell(u, dy, v, true, true);
  assert(cell(2, 4, 2) === BLOCK.AIR && cell(4, 1, 3) === BLOCK.AIR && cell(5, 1, 3) === BLOCK.AIR, "the tower's inside and doorway");
  assert(cell(2, 7, 0) === V.BLUE_TERRACOTTA && cell(1, 7, 0) === V.ORANGE_TERRACOTTA, "the tower's eye");
});

await check("jungle temples stand in jungles: two chests of the jungle temple's loot, three levers, two sticky pistons holding the hidden door, a lit redstone torch", async () => {
  WT.setWorldType("survival");
  let found = 0;
  for (const seed of [1, 2024, 42]) {
    const c = new Chunks(seed);
    let t = null;
    for (let rx = -8; rx < 8 && !t; rx++) {
      for (let rz = -8; rz < 8 && !t; rz++) {
        const tt = c.gen.structures.jungleTempleAt(rx, rz);
        if (tt) {
          assert(c.gen.biomeAt(tt.x0 + (tt.w >> 1), tt.z0 + (tt.d >> 1)) === BIOME.JUNGLE, "a jungle temple outside a jungle");
          t = tt;
        }
      }
    }
    if (!t) continue;
    found++;
    const cnt = { levers: 0, sticky: 0, heads: 0, torch: 0, chests: 0, mossy: 0, vines: 0 };
    for (let x = t.x0 - 1; x <= t.x0 + t.w; x++) {
      for (let z = t.z0 - 1; z <= t.z0 + t.d; z++) {
        for (let y = t.floor - 5; y <= t.floor + 12; y++) {
          const id = c.getBlock(x, y, z);
          if (id >= V.LEVER && id < V.LEVER + 16) cnt.levers++;
          else if (id >= V.STICKY_PISTON + 6 && id < V.STICKY_PISTON + 12) cnt.sticky++;
          else if (id >= V.PISTON_HEAD + 6 && id < V.PISTON_HEAD + 12) cnt.heads++;
          else if (id >= V.REDSTONE_WALL_TORCH && id < V.REDSTONE_WALL_TORCH + 4) cnt.torch++;
          else if (IS_CHEST[id]) {
            cnt.chests++;
            assert(c.gen.structures.chestAt(x, y, z) === "jungle_temple", "a jungle temple chest not known as one");
          } else if (id === V.MOSSY_COBBLESTONE) cnt.mossy++;
          else if (isVine(id)) cnt.vines++;
        }
      }
    }
    console.log(`        seed ${seed}: jungle temple at ${t.x0},${t.z0} (floor ${t.floor}, turned ${t.rot}): ${JSON.stringify(cnt)}`);
    assert(cnt.levers === 3 && cnt.sticky === 2 && cnt.heads === 2 && cnt.torch === 1 && cnt.chests === 2, JSON.stringify(cnt));
    assert(cnt.mossy > 200 && cnt.vines > 10, JSON.stringify(cnt));
    for (const [x, y, z] of t.chests) assert(IS_CHEST[c.getBlock(x, y, z)], `no chest at ${x},${y},${z}`);
  }
  assert(found >= 2, `jungle temples in ${found} of 3 seeds`);
  const loot = ST.rollStructureLoot("jungle_temple", seeded(5));
  assert(loot.length >= 1 && loot.every(([id]) => itemInfo(id)), `jungle temple loot: ${JSON.stringify(loot)}`);
});

await check("a Missions world's chunks are unchanged", async () => {
  WT.setWorldType("missions");
  const MISSIONS_HASHES = { 12345: 1268467022, 777: 739122713, 2024: 48227652 };
  const coords = [[0, 0], [1, 0], [-3, 2], [10, -7], [40, 40], [-60, 13], [100, -100], [7, 200], [-250, -31], [333, 90]];
  for (const [seed, hash] of Object.entries(MISSIONS_HASHES)) {
    const gen = new TerrainGenerator(Number(seed), {});
    let h = 2166136261;
    for (const [cx, cz] of coords) {
      const blocks = new Uint16Array(16 * 128 * 16);
      gen.generate({ cx, cz, blocks });
      h = fnv(blocks, h);
    }
    assert(h === hash, `seed ${seed}: ${h}`);
  }
  WT.setWorldType("survival");
});

// ---------- In the browser ----------

if (!args.node) await browserChecks();

async function browserChecks() {
  const { chromium } = await import("playwright-core");
  const PORT = 9300 + Math.floor(Math.random() * 400);
  const MIME = { ".html": "text/html", ".js": "text/javascript" };
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
    executablePath: process.env.CHROMIUM_PATH || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome",
    args: ["--use-gl=swiftshader", "--enable-webgl", "--ignore-gpu-blocklist", "--no-sandbox", "--disable-dev-shm-usage"],
  });
  const localThreeRoot = path.join(__dirname, "node_modules", "three");
  const page = await browser.newPage({ viewport: { width: 960, height: 540 } });
  await page.route("https://cdn.jsdelivr.net/npm/three@0.160.0/**", (route) => {
    const rel = new URL(route.request().url()).pathname.replace("/npm/three@0.160.0/", "");
    route.fulfill({ path: path.join(localThreeRoot, rel), contentType: "text/javascript" });
  });
  page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
  page.on("pageerror", (e) => errors.push(String(e)));
  const frames = (n = 2) =>
    page.evaluate(
      (k) =>
        new Promise((r) => {
          let i = 0;
          const f = () => (++i >= k ? r() : requestAnimationFrame(f));
          requestAnimationFrame(f);
        }),
      n
    );
  const v = (fn, arg) => page.evaluate(([src, a]) => new Function("g", "arg", `return (${src})(g, arg);`)(window.__ufo, a), [fn.toString(), arg]);
  async function until(fn, timeout = 30000, arg) {
    const t0 = Date.now();
    while (Date.now() - t0 < timeout) {
      const r = await v(fn, arg).catch(() => null);
      if (r) return r;
      await new Promise((res) => setTimeout(res, 200));
    }
    return null;
  }
  async function play() {
    const t0 = Date.now();
    while (Date.now() - t0 < 240000) {
      const st = await v((g) => g.gameState);
      if (st === "playing") return;
      if (st === "start" && (await page.isVisible("#play-btn").catch(() => false))) await page.click("#play-btn", { timeout: 5000 }).catch(() => {});
      else if (await page.isVisible("#resume-btn").catch(() => false)) await page.click("#resume-btn", { timeout: 3000 }).catch(() => {});
      else if (await page.isVisible("#click-to-play").catch(() => false)) await page.click("#click-to-play", { timeout: 3000 }).catch(() => {});
      else await page.mouse.click(300, 200).catch(() => {});
      await frames(3);
    }
    throw new Error("the game didn't start playing");
  }
  const browserCheck = async (name, fn) => {
    const before = errors.length;
    await check(name, async () => {
      await fn();
      if (errors.length > before) throw new Error(`console errors: ${errors.slice(before, before + 3).join(" | ")}`);
    });
  };
  const out = process.env.SHOTS || "";

  await browserCheck("in the game: the jungle temple's right lever opens the hidden door (the pistons pull it aside) and closes it again; a wrong one does nothing", async () => {
    // (the jungle temple of seed 1, in its Survival world)
    WT.setWorldType("survival");
    const gen = new TerrainGenerator(1, { sites: false });
    let t = null;
    for (let rx = -8; rx < 8 && !t; rx++) for (let rz = -8; rz < 8 && !t; rz++) t = gen.structures.jungleTempleAt(rx, rz);
    assert(t, "no jungle temple in seed 1");
    // The puzzle's cells (the temple's frame: jungleTempleCells).
    const at = (u, dy, vv) => {
      const n = [[t.x0 + u, t.z0 + vv], [t.x0 + 14 - vv, t.z0 + u], [t.x0 + 11 - u, t.z0 + 14 - vv], [t.x0 + vv, t.z0 + 11 - u]][t.rot];
      return [n[0], t.floor + dy, n[1]];
    };
    const spot = { door: at(6, -3, 4), door2: at(6, -2, 4), aside: at(6, -3, 5), right: at(4, -3, 7), wrong: at(4, -3, 3), stand: at(3.5, -3, 6) };
    await page.goto(`http://127.0.0.1:${PORT}/index.html?seed=1&type=survival&graphics=low`, { waitUntil: "load", timeout: 60000 });
    await page.waitForFunction(() => !!window.__ufo && window.__ufo.graphicsReady, null, { timeout: 180000 });
    await play();
    const before = await v(async (g, s) => {
      g.testFlags.noMissions = true;
      if (!g.player.creative) g.setMode("creative");
      g.player.flying = true;
      g.world.prepareArea(s.door[0], s.door[2], 2);
      g.player.position.set(s.stand[0] + 0.5, s.stand[1], s.stand[2] + 0.5);
      g.player.velocity.set(0, 0, 0);
      g.streamAround(s.door[0], s.door[2]);
      const b = (p) => g.world.getBlock(p[0], p[1], p[2]);
      return { door: b(s.door), door2: b(s.door2), aside: b(s.aside), right: b(s.right), wrong: b(s.wrong) };
    }, spot);
    assert(before.door === V.MOSSY_COBBLESTONE && before.door2 === V.MOSSY_COBBLESTONE && before.right >= V.LEVER && before.right < V.LEVER + 8 && before.aside >= V.PISTON_HEAD, `the puzzle as generated: ${JSON.stringify(before)}`);
    // The wrong lever: the door stays.
    await v((g, s) => g.world.setBlock(s.wrong[0], s.wrong[1], s.wrong[2], g.world.getBlock(s.wrong[0], s.wrong[1], s.wrong[2]) + 8), spot);
    await new Promise((r) => setTimeout(r, 1500));
    await frames(4);
    const still = await v((g, s) => g.world.getBlock(s.door[0], s.door[1], s.door[2]), spot);
    assert(still === V.MOSSY_COBBLESTONE, `a wrong lever moved the door: ${still}`);
    // The right one: the door is pulled aside.
    await v((g, s) => g.world.setBlock(s.right[0], s.right[1], s.right[2], g.world.getBlock(s.right[0], s.right[1], s.right[2]) + 8), spot);
    const open = await until((g, s) => {
      const b = (p) => g.world.getBlock(p[0], p[1], p[2]);
      return b(s.door) === 0 && b([s.door2[0], s.door2[1], s.door2[2]]) === 0 && { aside: b(s.aside) };
    }, 20000, spot);
    assert(open && open.aside === V.MOSSY_COBBLESTONE, `the door didn't open: ${JSON.stringify(open)}`);
    if (out) {
      await v((g, s) => {
        g.player.position.set(s.stand[0] + 0.5, s.stand[1], s.stand[2] + 0.5);
      }, spot);
      await frames(4);
      await page.screenshot({ path: path.join(out, "jungle-temple-open.png") });
    }
    // Back off: it closes again.
    await v((g, s) => g.world.setBlock(s.right[0], s.right[1], s.right[2], g.world.getBlock(s.right[0], s.right[1], s.right[2]) - 8), spot);
    const closed = await until((g, s) => {
      const id = g.world.getBlock(s.door[0], s.door[1], s.door[2]);
      return id !== 0 && { id };
    }, 20000, spot);
    assert(closed && closed.id === V.MOSSY_COBBLESTONE, `the door didn't close: ${JSON.stringify(closed)}`);
  });

  await browser.close();
  server.close();
}

// ---------- Summary ----------
const failed = results.filter(([, ok]) => !ok);
console.log(`\n${results.length - failed.length} passed, ${failed.length} failed.`);
process.exit(failed.length ? 1 : 0);
