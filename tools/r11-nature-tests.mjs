// Round 11 nature tests: a Survival world's terrain (ores at their depths,
// lava lakes, frozen waters, snow, red sand), a Missions world's terrain
// unchanged (its chunks and distant terrain hash as before Round 11), and
// the nature systems on a small test world in Node (the same world API the
// game's handlers use): lava flowing and drying, lava and water making
// obsidian, cobblestone and stone, crops growing through their stages under
// forced random ticks and dropping right, a hoe making farmland, seeds
// planted, bone meal growing a sapling into its tree, leaves decaying once
// their log is gone (Survival worlds only), fire spreading and burning out,
// the new shapes meshing. Node only (no browser): about a minute.
//
//   node r11-nature-tests.mjs [--only=substring]
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const args = Object.fromEntries(
  process.argv
    .slice(2)
    .filter((a) => a.startsWith("--"))
    .map((a) => {
      const [k, ...rest] = a.slice(2).split("=");
      return [k, rest.length ? rest.join("=") : true];
    })
);
const imp = (p) => import(path.join(ROOT, p));
const { BLOCK, BLOCK_INFO, isSupportedBy, TILE_NAMES, SHAPE_NAME, IS_WET } = await imp("js/blocks.js");
const { itemInfo, blockDrops } = await imp("js/items.js");
const { ITEM_USE, RANDOM_TICK, BLOCK_USE } = await imp("js/content/index.js");
const V = await imp("js/content/ids.js");
const N = await imp("js/content/nature.js");
const { TerrainGenerator } = await imp("js/terrain.js");
const { LodTerrain } = await imp("js/lod-mesher.js");
const { LavaSim } = await imp("js/lavasim.js");
const { NatureSim } = await imp("js/nature-sim.js");
const { WaterSim } = await imp("js/watersim.js");
const { meshChunk } = await imp("js/mesher.js");
const WT = await imp("js/worldtype.js");

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
// A seeded random stream (xorshift).
function seeded(s = 1) {
  let x = s >>> 0 || 1;
  return () => {
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    return (x >>> 0) / 4294967296;
  };
}
const fnv = (arr, h = 2166136261) => {
  for (let i = 0; i < arr.length; i++) h = Math.imul(h ^ arr[i], 16777619) >>> 0;
  return h;
};

// ---------- A small test world (the game World's block API) ----------
// Flat chunks: bedrock, stone to `ground` - 2, dirt, grass at `ground`, air
// above, full sky light everywhere (light only gates growth here). Edits pop
// unsupported plants (onBlockPopped records them) and reach the change
// listeners (the sims), as world.js does.
class TestWorld {
  constructor(seed = 5, opts = { sites: false }) {
    this.terrain = new TerrainGenerator(seed, opts);
    this.chunks = new Map();
    this.changeListeners = [];
    this.popped = [];
    this.edits = 0;
    this.onBlockPopped = (x, y, z, id) => this.popped.push([x, y, z, id]);
  }
  build(r = 2, ground = 30) {
    for (let cz = -r; cz <= r; cz++) {
      for (let cx = -r; cx <= r; cx++) {
        const blocks = new Uint16Array(16 * 128 * 16);
        for (let i = 0; i < blocks.length; i++) {
          const y = i >> 8;
          blocks[i] = y === 0 ? BLOCK.BEDROCK : y < ground - 1 ? BLOCK.STONE : y < ground ? BLOCK.DIRT : y === ground ? BLOCK.GRASS : BLOCK.AIR;
        }
        this.chunks.set(`${cx},${cz}`, { cx, cz, blocks, light: new Uint8Array(blocks.length).fill(0xf0) });
      }
    }
    return this;
  }
  getChunk(cx, cz) {
    return this.chunks.get(`${cx},${cz}`);
  }
  getBlock(x, y, z) {
    if (y < 0) return BLOCK.BEDROCK;
    if (y >= 128) return BLOCK.AIR;
    const c = this.getChunk(x >> 4, z >> 4);
    return c ? c.blocks[(y << 8) | ((z & 15) << 4) | (x & 15)] : BLOCK.AIR;
  }
  setBlock(x, y, z, id, opts) {
    return this.setBlocks([x, y, z, id], opts) > 0;
  }
  setBlocks(list, { recordEdit = true, remote = false } = {}) {
    const changed = [];
    const apply = (x, y, z, id) => {
      const c = this.getChunk(x >> 4, z >> 4);
      if (!c || y < 0 || y >= 128) return false;
      const i = (y << 8) | ((z & 15) << 4) | (x & 15);
      if (id === BLOCK.AIR && BLOCK_INFO[c.blocks[i]]?.waterlogged) id = BLOCK.WATER;
      if (c.blocks[i] === id) return false;
      c.blocks[i] = id;
      changed.push(x, y, z);
      return true;
    };
    for (let i = 0; i < list.length; i += 4) apply(list[i], list[i + 1], list[i + 2], list[i + 3]);
    for (let i = 0; i < changed.length; i += 3) {
      const [x, y, z] = [changed[i], changed[i + 1] + 1, changed[i + 2]];
      const above = this.getBlock(x, y, z);
      if (BLOCK_INFO[above]?.support && !isSupportedBy(above, this.getBlock(x, y - 1, z)) && apply(x, y, z, BLOCK.AIR)) this.onBlockPopped(x, y, z, above);
    }
    if (!changed.length) return 0;
    this.edits++;
    for (const fn of this.changeListeners) fn(changed, { recordEdit, remote });
    return changed.length / 3;
  }
  // A random tick for the block at (x, y, z), `n` times.
  tick(x, y, z, n = 1, rand = Math.random) {
    for (let i = 0; i < n; i++) {
      const id = this.getBlock(x, y, z);
      RANDOM_TICK[id]?.(this, x, y, z, id, rand);
    }
  }
}
// What an item use gets (interaction.js _useCtx), for a click on face n of (x, y, z).
function useCtx(world, stackId, [x, y, z], n = [0, 1, 0], creative = false) {
  const inv = {
    slots: [{ id: stackId, count: 10, dur: 100 }],
    selected: 0,
    get selectedStack() {
      return this.slots[0];
    },
    consumeSelected(k = 1) {
      this.slots[0].count -= k;
    },
    damageSelected(k = 1) {
      this.slots[0].dur -= k;
      return false;
    },
  };
  return {
    world,
    player: { position: { clone: () => ({ set() { return this; } }) }, getEyePosition: () => ({ x: x + 0.5, y: y + 2.5, z: z + 0.5 }) },
    inventory: inv,
    entities: { spawn() {} },
    audio: {},
    effects: {},
    interaction: null,
    x,
    y,
    z,
    id: world.getBlock(x, y, z),
    normal: n,
    place: [x + n[0], y + n[1], z + n[2]],
    hit: null,
    forward: [0, -1, 0],
    stack: inv.slots[0],
    info: itemInfo(stackId),
    creative,
    sneaking: false,
  };
}

// ---------- Terrain ----------

// The Missions terrain before Round 11's nature part (recorded with the
// code of commit 03bdc91): chunks and distant-terrain samples hash the same.
const MISSIONS_HASHES = {
  12345: [1268467022, 4028305257, "-18,0"],
  777: [739122713, 4069794209, "3,9"],
  2024: [48227652, 1157504331, "15,-33"],
};
await check("a Missions world's terrain is unchanged: its chunks, distant terrain and spawn hash as before, and it has no vanilla ores", async () => {
  WT.setWorldType("missions");
  const coords = [[0, 0], [1, 0], [-3, 2], [10, -7], [40, 40], [-60, 13], [100, -100], [7, 200], [-250, -31], [333, 90]];
  for (const [seed, [hash, lodHash, spawn]] of Object.entries(MISSIONS_HASHES)) {
    const gen = new TerrainGenerator(Number(seed), {});
    let h = 2166136261;
    const vanillaOres = new Set([BLOCK.IRON_ORE, BLOCK.DIAMOND_ORE, V.REDSTONE_ORE, V.COPPER_ORE, V.LAPIS_ORE, V.EMERALD_ORE, V.LAVA, V.ICE, V.SNOW_LAYER, N.SNOWY_GRASS]);
    for (const [cx, cz] of coords) {
      const blocks = new Uint16Array(16 * 128 * 16);
      gen.generate({ cx, cz, blocks });
      h = fnv(blocks, h);
      for (const id of blocks) assert(!vanillaOres.has(id), `seed ${seed} chunk ${cx},${cz} has ${id}`);
    }
    const lt = new LodTerrain(Number(seed), {});
    const s = { top: 0, id: 0, depth: 0 };
    let lh = 2166136261;
    for (let i = 0; i < 4000; i++) {
      lt.sample(i * 37 - 70000, i * 53 - 9000, s, i % 3);
      lh = fnv([Math.round(s.top * 10), s.id, s.depth], lh);
    }
    assert(h === hash && lh === lodHash && gen.spawnColumn().join(",") === spawn, `seed ${seed}: ${h} ${lh} ${gen.spawnColumn()}`);
  }
});

// A scan of a Survival world's chunks: per block id, the count and the y range.
function scan(seed, coords) {
  const gen = new TerrainGenerator(seed, { sites: false });
  const stats = new Map();
  const add = (id, y) => {
    let s = stats.get(id);
    if (!s) stats.set(id, (s = { n: 0, lo: 999, hi: -1, chunks: 0 }));
    s.n++;
    s.lo = Math.min(s.lo, y);
    s.hi = Math.max(s.hi, y);
  };
  const emeraldBiomes = new Set();
  for (const [cx, cz] of coords) {
    const blocks = new Uint16Array(16 * 128 * 16);
    gen.generate({ cx, cz, blocks });
    for (let i = 0; i < blocks.length; i++) {
      const id = blocks[i];
      if (id === BLOCK.AIR || id === BLOCK.STONE || id === BLOCK.WATER || id === BLOCK.DIRT) continue;
      add(id, i >> 8);
      if (id === V.EMERALD_ORE) emeraldBiomes.add(gen.biomeAt(cx * 16 + (i & 15), cz * 16 + ((i >> 4) & 15)));
    }
  }
  return { gen, stats, emeraldBiomes };
}
await check("a Survival world's ores lie at vanilla's depths: diamonds and redstone deep, iron and coal common, emeralds only in the mountains", async () => {
  WT.setWorldType("survival");
  const coords = [];
  for (let i = 0; i < 160; i++) coords.push([((i * 37) % 61) - 30, ((i * 53) % 59) - 29]);
  const { stats, emeraldBiomes } = scan(424242, coords);
  const n = coords.length;
  const per = (id) => (stats.get(id)?.n || 0) / n;
  const range = (id) => stats.get(id) || { lo: -1, hi: -1 };
  assert(per(BLOCK.DIAMOND_ORE) > 1 && per(BLOCK.DIAMOND_ORE) < 8 && range(BLOCK.DIAMOND_ORE).hi <= 18, `diamonds: ${per(BLOCK.DIAMOND_ORE)} up to y ${range(BLOCK.DIAMOND_ORE).hi}`);
  assert(per(V.REDSTONE_ORE) > 8 && range(V.REDSTONE_ORE).hi <= 20, `redstone: ${per(V.REDSTONE_ORE)} up to ${range(V.REDSTONE_ORE).hi}`);
  assert(per(BLOCK.IRON_ORE) > 15 && range(BLOCK.IRON_ORE).hi <= 62, `iron: ${per(BLOCK.IRON_ORE)} up to ${range(BLOCK.IRON_ORE).hi}`);
  assert(per(BLOCK.COAL_ORE) > 15, `coal: ${per(BLOCK.COAL_ORE)}`);
  assert(per(V.COPPER_ORE) > 4 && range(V.COPPER_ORE).lo >= 5, `copper: ${per(V.COPPER_ORE)} from ${range(V.COPPER_ORE).lo}`);
  assert(per(V.LAPIS_ORE) > 1 && range(V.LAPIS_ORE).hi <= 34, `lapis: ${per(V.LAPIS_ORE)} up to ${range(V.LAPIS_ORE).hi}`);
  assert(per(BLOCK.GOLD_ORE) > 2, `gold: ${per(BLOCK.GOLD_ORE)}`);
  assert([...emeraldBiomes].every((b) => b === 17), `emeralds only in mountains: ${[...emeraldBiomes]}`);
  assert(!stats.get(BLOCK.LUMEN), "no alien crystals in a Survival world");
});
await check("a Survival world's caves end in lava lakes below y 11, and a rare lava pool lies on the surface", async () => {
  const coords = [];
  for (let i = 0; i < 120; i++) coords.push([i * 3 - 180, (i * 7) % 40]);
  const gen = new TerrainGenerator(424242, { sites: false });
  let deep = 0;
  let pools = 0;
  let deepAir = 0;
  for (const [cx, cz] of coords) {
    const blocks = new Uint16Array(16 * 128 * 16);
    gen.generate({ cx, cz, blocks });
    for (let i = 0; i < blocks.length; i++) {
      const y = i >> 8;
      if (blocks[i] === V.LAVA) {
        if (y <= 10) deep++;
        else pools++;
      } else if (blocks[i] === BLOCK.AIR && y >= 2 && y <= 10) deepAir++;
    }
  }
  assert(deep > 200, `lava in deep caves: ${deep}`);
  assert(deepAir === 0, `no open air left at the bottom of the caves: ${deepAir}`);
  // (pools are rare: look for one chunk with surface lava among many)
  let found = null;
  for (let cx = -60; cx < 60 && !found; cx++) {
    for (let cz = -6; cz < 6 && !found; cz++) {
      const blocks = new Uint16Array(16 * 128 * 16);
      gen.generate({ cx, cz, blocks });
      for (let i = 11 << 8; i < blocks.length; i++) {
        if (blocks[i] !== V.LAVA) continue;
        const above = blocks[i + 256];
        const y = i >> 8;
        found = { cx, cz, y, above, h: gen.heightAt(cx * 16 + (i & 15), cz * 16 + ((i >> 4) & 15)) };
        break;
      }
    }
  }
  assert(found && found.y >= 25, `a surface lava pool: ${JSON.stringify(found)}`);
});
await check("a Survival world's cold waters freeze, its snowy ground is snowy grass under a snow layer, its badlands red sand", async () => {
  const gen = new TerrainGenerator(424242, { sites: false });
  // Find a cold place and a badlands spot by walking out.
  let cold = null;
  let bad = null;
  for (let r = 0; r < 60000 && (!cold || !bad); r += 97) {
    for (const [x, z] of [[r, 0], [-r, 0], [0, r], [0, -r], [r, r], [-r, -r]]) {
      const b = gen.biomeAt(x, z);
      if (!cold && (b === 10 || b === 11)) cold = [x, z];
      if (!bad && b === 16) bad = [x, z];
    }
  }
  assert(cold && bad, `found the biomes: ${cold} ${bad}`);
  const col = (x, z) => {
    const blocks = new Uint16Array(16 * 128 * 16);
    gen.generate({ cx: x >> 4, cz: z >> 4, blocks });
    return { blocks, h: gen.heightAt(x, z), at: (y) => blocks[(y << 8) | ((z & 15) << 4) | (x & 15)] };
  };
  let ok = 0;
  for (let k = 0; k < 40 && ok < 3; k++) {
    const c = col(cold[0] + k * 5, cold[1]);
    if (c.h <= 25) continue;
    if (c.at(c.h) === N.SNOWY_GRASS && (c.at(c.h + 1) === V.SNOW_LAYER || BLOCK_INFO[c.at(c.h + 1)]?.leaves || c.at(c.h + 1) !== BLOCK.AIR)) ok++;
  }
  assert(ok >= 3, `snowy ground under snow (${ok})`);
  const b = col(bad[0], bad[1]);
  assert(b.at(b.h) === V.RED_SAND, `red sand on the badlands: ${b.at(b.h)}`);
  // Frozen water: some cold column under the sea.
  let ice = 0;
  for (let x = cold[0] - 4000; x < cold[0] + 4000 && !ice; x += 7) {
    for (let z = cold[1] - 4000; z < cold[1] + 4000 && !ice; z += 509) {
      if (gen.heightAt(x, z) < 23 && gen.frozenAt(x, z)) {
        const c = col(x, z);
        if (c.at(24) === V.ICE) ice++;
        const lt = new LodTerrain(424242, { sites: false });
        const s = lt.sample(x, z, { top: 0, id: 0, depth: 0 });
        assert(s.id === V.ICE, `the distant terrain shows the ice too: ${s.id}`);
      }
    }
  }
  assert(ice > 0, "frozen water somewhere in the cold");
});
await check("a Survival world grows its own trees: jungle, acacia and dark oak woods in their biomes", async () => {
  const gen = new TerrainGenerator(424242, { sites: false });
  const found = {};
  // (biomes by a coarse walk, then their trees by a fine one)
  for (let gx = -60; gx <= 60 && Object.keys(found).length < 3; gx++) {
    for (let gz = -60; gz <= 60 && Object.keys(found).length < 3; gz++) {
      const b = gen.biomeAt(gx * 400, gz * 400);
      const want = b === 14 ? 5 : b === 13 ? 6 : b === 8 ? 7 : 0;
      if (!want || found[want]) continue;
      for (let dx = 0; dx < 64 && !found[want]; dx++) {
        for (let dz = 0; dz < 64; dz++) {
          const root = gen.trees.rootAt(gx * 400 + dx, gz * 400 + dz);
          if (root && root.species === want) {
            found[want] = root;
            break;
          }
        }
      }
    }
  }
  assert(found[5] && found[6] && found[7], `species found: ${Object.keys(found)}`);
  assert(found[5].log === V.JUNGLE_LOG && found[6].leaf === V.ACACIA_LEAVES && found[7].wide, "their woods");
  const shape = gen.trees.shape(found[6]);
  assert(shape.length > 40 && [...shape].some((v, i) => i % 4 === 3 && v === V.ACACIA_LOG), "an acacia's shape");
  // A jungle tree's vines cling to its trunk (the wall each one faces is a log).
  let vines = 0;
  for (let k = 0; k < 20 && !vines; k++) {
    const j = gen.trees.shape(found[5]);
    const at = new Map();
    // (logs win, else the first block put in a cell, as placed)
    for (let i = 0; i < j.length; i += 4) {
      const k = `${j[i]},${j[i + 1]},${j[i + 2]}`;
      if (j[i + 3] === V.JUNGLE_LOG || !at.has(k)) at.set(k, j[i + 3]);
    }
    const isVine = (id) => id >= V.VINE && id < V.VINE + 4;
    for (let i = 0; i < j.length; i += 4) {
      if (!isVine(j[i + 3]) || at.get(`${j[i]},${j[i + 1]},${j[i + 2]}`) !== j[i + 3]) continue;
      const [wx, wz] = BLOCK_INFO[j[i + 3]].wall;
      // (Round 12: on its trunk, on its leaves, or hanging from a vine above)
      const wall = at.get(`${j[i] + wx},${j[i + 1]},${j[i + 2] + wz}`);
      assert(wall === V.JUNGLE_LOG || wall === V.JUNGLE_LEAVES || isVine(at.get(`${j[i]},${j[i + 1] + 1},${j[i + 2]}`)), `a vine at ${j[i]},${j[i + 1]},${j[i + 2]} hangs on nothing`);
      vines++;
    }
  }
  assert(vines > 0, "the jungle tree has vines");
});
await check("a Survival world's swamps have lily pads on their pools; ice is not water", async () => {
  const gen = new TerrainGenerator(424242, { sites: false });
  let lily = 0;
  let spots = 0;
  for (let gx = -30; gx <= 30 && !lily; gx++) {
    for (let gz = -30; gz <= 30 && !lily; gz++) {
      if (gen.biomeAt(gx * 500, gz * 500) !== 15) continue;
      spots++;
      for (let dx = -2; dx <= 2; dx++) {
        for (let dz = -2; dz <= 2; dz++) {
          const blocks = new Uint16Array(16 * 128 * 16);
          gen.generate({ cx: ((gx * 500) >> 4) + dx, cz: ((gz * 500) >> 4) + dz, blocks });
          for (let i = 0; i < blocks.length; i++) {
            if (blocks[i] !== V.LILY_PAD) continue;
            assert(blocks[i - 256] === BLOCK.WATER && i >> 8 === 25, `a lily pad on the water's surface: ${i >> 8}`);
            lily++;
          }
        }
      }
    }
  }
  assert(lily > 0, `lily pads by ${spots} swamps`);
  assert(!IS_WET[V.ICE] && !BLOCK_INFO[V.ICE].waterlogged, "ice doesn't count as water (no swimming in it, no water drawn inside it)");
});

// ---------- Lava and water ----------

await check("lava flows 3 blocks on flat ground every 1.5 s, falls into a hole, and dries up when its source goes", async () => {
  WT.setWorldType("survival");
  const w = new TestWorld().build(1);
  const lava = new LavaSim(w);
  w.setBlock(0, 31, 0, V.LAVA);
  lava.update(1.0);
  assert(w.getBlock(1, 31, 0) === BLOCK.AIR, "not yet: lava is slow");
  for (let i = 0; i < 12; i++) lava.update(0.5);
  const at = (x) => w.getBlock(x, 31, 0);
  assert(at(1) === N.lavaFlowId(1) && at(2) === N.lavaFlowId(2) && at(3) === N.lavaFlowId(3) && at(4) === BLOCK.AIR, `the flow: ${[1, 2, 3, 4].map(at)}`);
  // A hole under the flow: it pours in.
  w.setBlock(2, 30, 0, BLOCK.AIR);
  for (let i = 0; i < 8; i++) lava.update(0.5);
  assert(N.isLava(w.getBlock(2, 30, 0)), `it falls into the hole: ${w.getBlock(2, 30, 0)}`);
  // The source taken away (a bucket): everything dries.
  w.setBlock(0, 31, 0, BLOCK.AIR);
  for (let i = 0; i < 40; i++) lava.update(0.5);
  let left = 0;
  for (let x = -4; x <= 4; x++) for (let z = -4; z <= 4; z++) for (let y = 28; y <= 32; y++) if (N.isLava(w.getBlock(x, y, z))) left++;
  assert(left === 0, `dried up: ${left} lava cells left`);
});
await check("lava and water: water on a lava source makes obsidian, on flowing lava cobblestone; lava falling on water makes stone; water never flows into lava", async () => {
  const w = new TestWorld().build(1);
  const lava = new LavaSim(w);
  const water = new WaterSim(w);
  // Pools: a lava source in a pit, a water source beside it.
  w.setBlocks([0, 30, 0, BLOCK.AIR, 0, 29, 0, BLOCK.STONE]);
  w.setBlock(0, 30, 0, V.LAVA);
  w.setBlock(1, 31, 0, BLOCK.WATER); // (water on the rim: flows down onto/next to the lava)
  for (let i = 0; i < 30; i++) {
    water.update();
    lava.update(0.5);
  }
  assert(w.getBlock(0, 30, 0) === V.OBSIDIAN, `obsidian: ${w.getBlock(0, 30, 0)}`);
  // Flowing lava meeting water: cobblestone.
  const w2 = new TestWorld().build(1);
  const lava2 = new LavaSim(w2);
  new WaterSim(w2);
  w2.setBlock(0, 31, 0, V.LAVA);
  w2.setBlock(3, 31, 0, BLOCK.WATER); // (a water cell two blocks from where the flow reaches)
  for (let i = 0; i < 20; i++) lava2.update(0.5);
  const row = [1, 2, 3].map((x) => w2.getBlock(x, 31, 0));
  assert(row.includes(BLOCK.COBBLESTONE) && w2.getBlock(3, 31, 0) === BLOCK.WATER, `cobblestone where the flow met the water: ${row}`);
  // Lava falling onto water: the water turns to stone.
  const w3 = new TestWorld().build(1);
  const lava3 = new LavaSim(w3);
  w3.setBlocks([0, 30, 0, BLOCK.WATER, 0, 31, 0, BLOCK.AIR]);
  w3.setBlock(0, 32, 0, V.LAVA);
  for (let i = 0; i < 10; i++) lava3.update(0.5);
  assert(w3.getBlock(0, 30, 0) === BLOCK.STONE || w3.getBlock(0, 31, 0) === BLOCK.COBBLESTONE || w3.getBlock(0, 32, 0) === V.OBSIDIAN, `stone under falling lava: ${[30, 31, 32].map((y) => w3.getBlock(0, y, 0))}`);
  // Water beside lava never takes its cell.
  const w4 = new TestWorld().build(1);
  const water4 = new WaterSim(w4);
  w4.setBlock(1, 31, 0, V.LAVA); // (no lava sim: it can't harden)
  w4.setBlock(0, 31, 0, BLOCK.WATER);
  for (let i = 0; i < 20; i++) water4.update();
  assert(w4.getBlock(1, 31, 0) === V.LAVA, `water left the lava alone: ${w4.getBlock(1, 31, 0)}`);
});
await check("water runs 7 blocks in a Survival world and 4 in a Missions world", async () => {
  for (const [type, reach] of [["survival", 7], ["missions", 4]]) {
    WT.setWorldType(type);
    const w = new TestWorld().build(1);
    const water = new WaterSim(w);
    w.setBlock(0, 31, 0, BLOCK.WATER);
    for (let i = 0; i < 60; i++) water.update();
    const far = [reach, reach + 1].map((x) => w.getBlock(x, 31, 0));
    assert(far[0] === BLOCK.WATER && far[1] === BLOCK.AIR, `${type}: ${far}`);
  }
  WT.setWorldType("survival");
});

// ---------- Farming ----------

await check("a hoe tills grass into farmland, seeds plant on it, and wheat, carrots and beetroots grow through every stage under random ticks", async () => {
  WT.setWorldType("survival");
  const w = new TestWorld().build(1);
  for (const [x, crop, seed] of [[0, V.WHEAT_CROP, V.WHEAT_SEEDS], [2, V.CARROTS, V.CARROT], [4, V.BEETROOTS, V.BEETROOT_SEEDS]]) {
    assert(ITEM_USE[V.WOODEN_HOE](useCtx(w, V.WOODEN_HOE, [x, 30, 0])), "tilled");
    assert(w.getBlock(x, 30, 0) === V.FARMLAND, `farmland: ${w.getBlock(x, 30, 0)}`);
    w.setBlock(x, 30, 1, BLOCK.WATER); // (water within 4: wet farmland)
    const ctx = useCtx(w, seed, [x, 30, 0]);
    assert(ITEM_USE[seed](ctx) && ctx.inventory.slots[0].count === 9, "planted (one used)");
    assert(w.getBlock(x, 31, 0) === crop, `the crop: ${w.getBlock(x, 31, 0)}`);
    w.tick(x, 30, 0, 3); // (farmland wets)
    assert(w.getBlock(x, 30, 0) === V.FARMLAND + 1, "wet farmland");
    const last = crop + (crop === V.WHEAT_CROP ? 7 : 3);
    const seen = new Set([crop]);
    let ticks = 0;
    for (; ticks < 3000 && w.getBlock(x, 31, 0) !== last; ticks++) {
      w.tick(x, 31, 0);
      seen.add(w.getBlock(x, 31, 0));
    }
    assert(w.getBlock(x, 31, 0) === last && seen.size === last - crop + 1, `grew through all stages: ${[...seen]} -> ${w.getBlock(x, 31, 0)}`);
    // (vanilla pace: wheat on wet farmland in a row grows a stage in about 3 random ticks)
    assert(ticks > (last - crop) * 1.2 && ticks < (last - crop) * 40, `${ticks} random ticks to ripen`);
  }
});
await check("crops drop as vanilla's: seeds while young, the harvest and 1-4 seeds when ripe; carrots 2-5", async () => {
  const r = seeded(9);
  const young = blockDrops(V.WHEAT_CROP + 3, null, r);
  assert(young.length === 1 && young[0][0] === V.WHEAT_SEEDS && young[0][1] === 1, JSON.stringify(young));
  let seeds = [99, 0];
  for (let i = 0; i < 200; i++) {
    const d = blockDrops(V.WHEAT_CROP + 7, null, r);
    assert(d[0][0] === V.WHEAT && d[0][1] === 1, JSON.stringify(d));
    seeds = [Math.min(seeds[0], d[1][1]), Math.max(seeds[1], d[1][1])];
  }
  assert(seeds[0] === 1 && seeds[1] === 4, `seeds 1-4: ${seeds}`);
  let carrots = [99, 0];
  for (let i = 0; i < 200; i++) {
    const n = blockDrops(V.CARROTS + 3, null, r)[0][1];
    carrots = [Math.min(carrots[0], n), Math.max(carrots[1], n)];
  }
  assert(carrots[0] === 2 && carrots[1] === 5, `carrots 2-5: ${carrots}`);
  const pot = blockDrops(V.POTATOES + 1, null, r);
  assert(pot[0][0] === V.POTATO && pot[0][1] === 1, JSON.stringify(pot));
  assert(itemInfo(V.CARROT).food.hunger === 3 && itemInfo(V.MELON_SLICE).food.saturation === 1.2, "food values");
});
await check("bone meal grows a sapling into its tree; four dark oak saplings make a dark oak, one alone does not", async () => {
  const w = new TestWorld(77).build(2);
  w.setBlock(0, 31, 0, V.OAK_SAPLING);
  const ctx = useCtx(w, V.BONE_MEAL, [0, 31, 0]);
  let uses = 0;
  const rnd = Math.random;
  Math.random = () => 0.1; // (bone meal's 45%: always)
  try {
    while (w.getBlock(0, 31, 0) === V.OAK_SAPLING && uses < 10) {
      ITEM_USE[V.BONE_MEAL](ctx);
      uses++;
    }
  } finally {
    Math.random = rnd;
  }
  assert(w.getBlock(0, 31, 0) === BLOCK.WOOD && uses === 2, `an oak trunk after ${uses} uses: ${w.getBlock(0, 31, 0)}`);
  let leaves = 0;
  for (let x = -4; x <= 4; x++) for (let z = -4; z <= 4; z++) for (let y = 32; y < 42; y++) if (w.getBlock(x, y, z) === BLOCK.LEAVES) leaves++;
  assert(leaves > 15 && w.getBlock(0, 30, 0) === BLOCK.DIRT, `a crown (${leaves}) and dirt under the trunk`);
  // Dark oak: one alone never grows.
  w.setBlock(8, 31, 8, V.DARK_OAK_SAPLING);
  for (let i = 0; i < 6; i++) N.advanceSapling(w, 8, 31, 8, V.DARK_OAK_SAPLING, () => 0.1);
  assert(w.getBlock(8, 31, 8) === V.DARK_OAK_SAPLING, "a lone dark oak sapling waits");
  w.setBlocks([9, 31, 8, V.DARK_OAK_SAPLING, 8, 31, 9, V.DARK_OAK_SAPLING, 9, 31, 9, V.DARK_OAK_SAPLING]);
  N.advanceSapling(w, 9, 31, 9, V.DARK_OAK_SAPLING, () => 0.1);
  N.advanceSapling(w, 9, 31, 9, V.DARK_OAK_SAPLING, () => 0.1);
  const trunk = [[8, 8], [9, 8], [8, 9], [9, 9]].every(([x, z]) => w.getBlock(x, 31, z) === V.DARK_OAK_LOG);
  assert(trunk, `a 2x2 dark oak trunk: ${[[8, 8], [9, 8], [8, 9], [9, 9]].map(([x, z]) => w.getBlock(x, 31, z))}`);
});
await check("leaves decay once their log is gone (Survival worlds; never in a Missions world, never a player's) and drop saplings now and then", async () => {
  const build = () => {
    const w = new TestWorld().build(1);
    const list = [];
    for (let y = 31; y < 35; y++) list.push(0, y, 0, BLOCK.WOOD);
    for (let x = -2; x <= 2; x++) for (let z = -2; z <= 2; z++) for (let y = 34; y < 37; y++) if (x || z || y > 34) list.push(x, y, z, BLOCK.LEAVES);
    list.push(3, 36, 0, N.PERSISTENT_LEAVES); // (a player's leaf, touching the crown)
    w.setBlocks(list);
    return w;
  };
  const leavesLeft = (w) => {
    let n = 0;
    for (let x = -3; x <= 3; x++) for (let z = -3; z <= 3; z++) for (let y = 33; y < 38; y++) if (BLOCK_INFO[w.getBlock(x, y, z)]?.leaves) n++;
    return n;
  };
  WT.setWorldType("survival");
  const w = build();
  const before = leavesLeft(w);
  for (let x = -2; x <= 2; x++) for (let z = -2; z <= 2; z++) for (let y = 34; y < 37; y++) w.tick(x, y, z, 2);
  assert(leavesLeft(w) === before, "held by the log: none decay");
  for (let y = 31; y < 35; y++) w.setBlock(0, y, 0, BLOCK.AIR);
  for (let x = -2; x <= 3; x++) for (let z = -2; z <= 2; z++) for (let y = 34; y < 37; y++) w.tick(x, y, z, 1);
  assert(leavesLeft(w) === 1 && w.getBlock(3, 36, 0) === N.PERSISTENT_LEAVES, `the crown decayed, the player's leaf stays: ${leavesLeft(w)}`);
  assert(w.popped.length === before - 1, `each decayed leaf dropped its drops (onBlockPopped): ${w.popped.length}`);
  let saplings = 0;
  const r = seeded(3);
  for (let i = 0; i < 2000; i++) for (const [id] of blockDrops(BLOCK.LEAVES, null, r)) if (id === V.OAK_SAPLING) saplings++;
  assert(saplings > 60 && saplings < 150, `about 1 in 20 leaves gives a sapling: ${saplings}/2000`);
  WT.setWorldType("missions");
  const m = build();
  for (let y = 31; y < 35; y++) m.setBlock(0, y, 0, BLOCK.AIR);
  for (let x = -2; x <= 2; x++) for (let z = -2; z <= 2; z++) for (let y = 34; y < 37; y++) m.tick(x, y, z, 2);
  assert(leavesLeft(m) === before, "a Missions world's leaves never decay");
  WT.setWorldType("survival");
});
await check("sugar cane grows to 3 by water and dries out without it; a stem grows its fruit beside it", async () => {
  const w = new TestWorld().build(1);
  w.setBlocks([0, 30, 0, BLOCK.SAND, 1, 30, 0, BLOCK.WATER]);
  w.setBlock(0, 31, 0, V.SUGAR_CANE);
  for (let i = 0; i < 400; i++) w.tick(0, 31 + Math.floor(Math.random() * 3), 0);
  assert(w.getBlock(0, 33, 0) === V.SUGAR_CANE && w.getBlock(0, 34, 0) === BLOCK.AIR, "three tall, no more");
  w.setBlock(1, 30, 0, BLOCK.SAND);
  w.tick(0, 33, 0);
  assert(w.getBlock(0, 31, 0) === BLOCK.AIR && w.getBlock(0, 33, 0) === BLOCK.AIR, "dried out without its water");
  w.setBlocks([4, 30, 4, V.FARMLAND + 1, 4, 29, 3, BLOCK.WATER]);
  w.setBlock(4, 31, 4, V.PUMPKIN_STEM + 7);
  for (let i = 0; i < 500; i++) w.tick(4, 31, 4);
  const fruit = [[5, 4], [3, 4], [4, 5], [4, 3]].filter(([x, z]) => w.getBlock(x, 31, z) === V.PUMPKIN).length;
  assert(fruit === 1, `one pumpkin beside its stem: ${fruit}`);
});

// ---------- Fire ----------

await check("fire spreads through a wooden hut and burns out, leaving no fire behind", async () => {
  WT.setWorldType("survival");
  const w = new TestWorld().build(1);
  const sim = new NatureSim(w);
  const r = seeded(11);
  sim.fire.rand = r;
  const list = [];
  for (let x = -2; x <= 2; x++) for (let z = -2; z <= 2; z++) for (let y = 31; y <= 33; y++) if (Math.abs(x) === 2 || Math.abs(z) === 2 || y === 33) list.push(x, y, z, BLOCK.PLANKS);
  w.setBlocks(list);
  const planks = () => {
    let n = 0;
    for (let x = -3; x <= 3; x++) for (let z = -3; z <= 3; z++) for (let y = 30; y <= 36; y++) if (w.getBlock(x, y, z) === BLOCK.PLANKS) n++;
    return n;
  };
  const fires = () => {
    let n = 0;
    for (let x = -4; x <= 4; x++) for (let z = -4; z <= 4; z++) for (let y = 30; y <= 38; y++) if (w.getBlock(x, y, z) === V.FIRE) n++;
    return n;
  };
  const start = planks();
  w.setBlock(1, 31, 0, V.FIRE); // (lit inside, against a wall: a fire spreads only from beside fuel)
  let most = 0;
  for (let t = 0; t < 1200 && (t < 20 || fires() > 0); t++) {
    sim.update(0.5);
    most = Math.max(most, fires());
  }
  assert(most > 3, `the fire spread: up to ${most} at once`);
  assert(planks() < start * 0.6, `the hut burnt: ${planks()} of ${start} planks left`);
  assert(fires() === 0, `and it burnt out: ${fires()} fires left`);
  // On bare stone with nothing to burn, a fire goes out by itself.
  w.setBlocks([10, 30, 10, BLOCK.STONE]);
  w.setBlock(10, 31, 10, V.FIRE);
  for (let t = 0; t < 60; t++) sim.update(0.5);
  assert(w.getBlock(10, 31, 10) === BLOCK.AIR, "a lone fire on stone goes out");
});
await check("lava sets fire to flammable blocks near it (its random tick)", async () => {
  const w = new TestWorld().build(1);
  w.setBlocks([0, 31, 0, V.LAVA, 1, 31, 0, BLOCK.PLANKS, 1, 32, 0, BLOCK.PLANKS, -1, 31, 0, BLOCK.PLANKS]);
  const r = seeded(5);
  for (let i = 0; i < 400; i++) w.tick(0, 31, 0, 1, r);
  let fires = 0;
  for (let x = -2; x <= 2; x++) for (let z = -2; z <= 2; z++) for (let y = 31; y <= 34; y++) if (w.getBlock(x, y, z) === V.FIRE) fires++;
  assert(fires > 0, "a fire was lit");
});

// ---------- Blocks, items and shapes ----------

await check("every nature block and item is defined and named, within the texture budget, and their shapes mesh", async () => {
  const ids = Object.keys(N.blocks).map(Number);
  for (const id of ids) assert(BLOCK_INFO[id] && BLOCK_INFO[id].name, `block ${id}`);
  for (const id of Object.keys(N.items).map(Number)) assert(itemInfo(id)?.name && itemInfo(id).icon, `item ${id}`);
  assert(Object.keys(N.tiles).length <= 74, `nature tiles: ${Object.keys(N.tiles).length}`); // (70, the world part's spawner cage, the cocoa pod's 3 ages)
  assert(TILE_NAMES.length <= 256, `all tiles: ${TILE_NAMES.length}`);
  // A chunk with one of every shaped block, meshed.
  const blocks = new Uint16Array(16 * 128 * 16);
  const light = new Uint8Array(blocks.length).fill(0xf0);
  const shaped = ids.filter((id) => SHAPE_NAME[BLOCK_INFO[id].shape] && BLOCK_INFO[id].shape >= 16);
  shaped.forEach((id, k) => {
    const x = k % 14;
    const z = Math.floor(k / 14) % 14;
    const y = 40 + Math.floor(k / 196) * 2;
    blocks[((y - 1) << 8) | (z << 4) | x] = BLOCK.STONE;
    blocks[(y << 8) | (z << 4) | x] = id;
  });
  const nb = new Array(9).fill(null);
  nb[4] = { cx: 0, cz: 0, blocks, light };
  const m = meshChunk(nb);
  const quads = (b) => (b ? b.index.length / 6 : 0);
  assert(quads(m.opaque) + quads(m.cutout) > shaped.length, `meshed ${shaped.length} shaped blocks: ${quads(m.opaque)} + ${quads(m.cutout)} quads`);
  // A field of snow layers costs about one quad a column (its top; sides only at the edge).
  const ground = new Uint16Array(blocks.length);
  for (let i = 0; i < 256; i++) ground[(30 << 8) | i] = BLOCK.STONE;
  nb[4] = { cx: 0, cz: 0, blocks: ground, light };
  const bare = quads(meshChunk(nb).opaque);
  const snow = ground.slice();
  for (let i = 0; i < 256; i++) snow[(31 << 8) | i] = V.SNOW_LAYER;
  nb[4] = { cx: 0, cz: 0, blocks: snow, light };
  const ms = quads(meshChunk(nb).opaque);
  assert(ms - bare <= 256 + 64, `snow field quads: ${ms - bare} over the bare ground's ${bare}`);
  // Ore drops and XP.
  const r = seeded(4);
  assert(blockDrops(V.LAPIS_ORE, { type: "pickaxe", tier: 2, speed: 4 }, r)[0][1] >= 4, "lapis 4-9");
  assert(blockDrops(V.DIAMOND_BLOCK, { type: "pickaxe", tier: 2, speed: 4 }, r).length === 0, "a diamond block needs iron");
  assert(blockDrops(V.OBSIDIAN, { type: "pickaxe", tier: 4, speed: 8 }, r)[0][0] === V.OBSIDIAN && BLOCK_INFO[V.OBSIDIAN].hardness === 50, "obsidian: diamond pickaxe, hardness 50");
  assert(N.blockXp(V.EMERALD_ORE, r) >= 3 && N.ORE_XP[BLOCK.COAL_ORE][1] === 2, "ore XP");
  assert(BLOCK_INFO[V.LAVA].lava && BLOCK_INFO[V.LAVA].burns && BLOCK_INFO[V.FIRE].burns && BLOCK_INFO[V.VINE].climbable, "the survival part's flags");
});

const passed = results.filter((r) => r[1]).length;
console.log(`\n${passed}/${results.length} passed`);
process.exit(passed === results.length ? 0 : 1);
