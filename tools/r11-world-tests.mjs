// Round 11 world tests: structures and weather.
// In Node (fast): a Survival world's chunks over a few seeds hold dungeons
// (a spawner, mossy cobblestone, chests by the walls), mineshafts (planks,
// fences, cobwebs, chests) and desert temples (four chests in the hidden
// room) at plausible rates, their chests roll vanilla's loot, a Missions
// world's chunks are unchanged; the weather cycles within vanilla's times,
// rain stays out of deserts and from under roofs, snow falls in the snowy
// biomes and settles, water freezes in the cold, lightning sets fire and
// hurts, rain puts fire out, a monster spawner spawns in the dark near a
// player and not in the light.
// In the browser (the real game, a Survival world): rain darkens the sky and
// falls round the camera, a bolt is drawn and flashes, the weather is saved;
// with --online, a guest gets the host's weather and its bolts.
//
//   node r11-world-tests.mjs [--only=substring] [--node] [--online]
// (GAME_ROOT=dir runs another copy of the game.)
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
const { BLOCK, BLOCK_INFO, IS_SOLID, IS_CHEST } = await imp("js/blocks.js");
const { itemInfo } = await imp("js/items.js");
const V = await imp("js/content/ids.js");
const N = await imp("js/content/nature.js");
const { TerrainGenerator } = await imp("js/terrain.js");
const { LodTerrain } = await imp("js/lod-mesher.js");
const { FireSim } = await imp("js/nature-sim.js");
const { BIOME } = await imp("js/biomes.js");
const WT = await imp("js/worldtype.js");
const ST = await imp("js/structures.js");
const W = await imp("js/weather.js");
const { LIB } = await imp("js/content/base.js");

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

// ---------- Generated chunks ----------

// A Survival world's chunks on demand (getBlock across them).
class Chunks {
  constructor(seed) {
    this.gen = new TerrainGenerator(seed, { sites: false });
    this.map = new Map();
  }
  chunk(cx, cz) {
    const k = `${cx},${cz}`;
    let b = this.map.get(k);
    if (!b) {
      b = new Uint16Array(16 * 128 * 16);
      this.gen.generate({ cx, cz, blocks: b });
      this.map.set(k, b);
    }
    return b;
  }
  getBlock(x, y, z) {
    if (y < 0 || y >= 128) return BLOCK.AIR;
    return this.chunk(x >> 4, z >> 4)[(y * 16 + (z & 15)) * 16 + (x & 15)];
  }
}
const isSpawner = (id) => id >= N.SPAWNER && id < N.SPAWNER + 3;
const SEEDS = [12345, 777, 2024];

await check("Survival chunks hold dungeons at a plausible rate: a spawner on a mossy floor, chests by the walls rolling the dungeon's loot", async () => {
  WT.setWorldType("survival");
  const rates = [];
  for (const seed of SEEDS) {
    const c = new Chunks(seed);
    let rooms = 0;
    let chests = 0;
    const R = 10;
    for (let cx = -R; cx < R; cx++) {
      for (let cz = -R; cz < R; cz++) {
        const b = c.chunk(cx, cz);
        for (let i = 0; i < b.length; i++) {
          if (!isSpawner(b[i])) continue;
          const x = cx * 16 + (i & 15);
          const y = i >> 8;
          const z = cz * 16 + ((i >> 4) & 15);
          // (a mineshaft's spider spawner stands in a corridor, among cobwebs)
          if (c.getBlock(x, y - 1, z) === BLOCK.PLANKS || ![V.MOSSY_COBBLESTONE, BLOCK.COBBLESTONE].includes(c.getBlock(x, y - 1, z))) continue;
          rooms++;
          let mossy = 0;
          for (let dx = -2; dx <= 2; dx++) for (let dz = -2; dz <= 2; dz++) if (c.getBlock(x + dx, y - 1, z + dz) === V.MOSSY_COBBLESTONE) mossy++;
          assert(mossy >= 8, `seed ${seed}: a dungeon at ${x},${y},${z} without its mossy floor (${mossy})`);
          for (let dx = -3; dx <= 3; dx++) {
            for (let dz = -3; dz <= 3; dz++) {
              if (!IS_CHEST[c.getBlock(x + dx, y, z + dz)]) continue;
              chests++;
              assert(c.gen.structures.chestAt(x + dx, y, z + dz, (a, b2, d) => c.getBlock(a, b2, d)) === "dungeon", `a dungeon chest at ${x + dx},${y},${z + dz} is not known as one`);
              // (its spawner broken, or the ground not loaded where it is asked: still a dungeon's)
              assert(c.gen.structures.chestAt(x + dx, y, z + dz, () => BLOCK.AIR) === "dungeon", `a dungeon chest at ${x + dx},${y},${z + dz} without its spawner is not known as one`);
            }
          }
        }
      }
    }
    rates.push(rooms / (4 * R * R));
    assert(chests >= rooms * 0.5, `seed ${seed}: ${rooms} dungeons but only ${chests} chests`);
  }
  // (vanilla's are a few chunks apart where caves are plenty; this world's caves are sparser)
  for (const r of rates) assert(r > 0.02 && r < 0.3, `dungeons per chunk: ${rates.map((x) => x.toFixed(3))}`);
  const loot = ST.rollStructureLoot("dungeon", seeded(3));
  assert(loot.length >= 4 && loot.every(([id, n]) => itemInfo(id) && n >= 1), `dungeon loot: ${JSON.stringify(loot)}`);
});

await check("mineshafts run under the land of about one region in five: corridors of planks and fences with cobwebs, chests, some spider spawners", async () => {
  WT.setWorldType("survival");
  for (const seed of SEEDS) {
    const c = new Chunks(seed);
    let plans = 0;
    let first = null;
    for (let rx = -8; rx < 8; rx++) {
      for (let rz = -8; rz < 8; rz++) {
        const p = c.gen.structures.minePlan(rx, rz);
        if (!p) continue;
        plans++;
        assert(p.pieces.length >= 5 && p.box[2] - p.box[0] <= 2 * 80 + 40, `seed ${seed}: a mineshaft of ${p.pieces.length} pieces, ${p.box}`);
        if (!first || (p.chests.length && !first.chests.length)) first = p;
      }
    }
    assert(plans >= 10 && plans <= 160, `seed ${seed}: ${plans} mineshafts in 256 regions`);
    // Cut one: its room is dirt-floored, its corridors have supports.
    const cnt = { planks: 0, fence: 0, web: 0, chest: 0 };
    const [x0, z0, x1, z1] = first.box;
    for (let cx = x0 >> 4; cx <= x1 >> 4; cx++) {
      for (let cz = z0 >> 4; cz <= z1 >> 4; cz++) {
        const b = c.chunk(cx, cz);
        for (let i = 0; i < b.length; i++) {
          const id = b[i];
          const y = i >> 8;
          if (y < 6 || y > 30) continue;
          if (id === V.OAK_FENCE) cnt.fence++;
          else if (id === V.COBWEB) cnt.web++;
          else if (IS_CHEST[id]) cnt.chest++;
        }
      }
    }
    assert(cnt.fence > 40 && cnt.web > 5, `seed ${seed}: a cut mineshaft has ${JSON.stringify(cnt)}`);
    for (const [x, y, z] of first.chests) {
      const id = c.getBlock(x, y, z);
      if (IS_CHEST[id]) assert(c.gen.structures.chestAt(x, y, z) === "mineshaft", `mineshaft chest ${x},${y},${z}`);
    }
  }
  const loot = ST.rollStructureLoot("mineshaft", seeded(9));
  assert(loot.length >= 3 && loot.every(([id]) => itemInfo(id)), `mineshaft loot: ${JSON.stringify(loot)}`);
});

await check("desert temples stand in deserts only, a pyramid over a hidden room with four chests (TNT under a plate when the redstone blocks exist)", async () => {
  WT.setWorldType("survival");
  let found = 0;
  for (const seed of SEEDS) {
    const c = new Chunks(seed);
    let t = null;
    let n = 0;
    for (let rx = -6; rx < 6; rx++) {
      for (let rz = -6; rz < 6; rz++) {
        const tt = c.gen.structures.templeAt(rx, rz);
        if (!tt) continue;
        n++;
        assert(c.gen.biomeAt(tt.x0 + 10, tt.z0 + 10) === BIOME.DESERT, `seed ${seed}: a temple outside a desert`);
        t = t || tt;
      }
    }
    assert(n <= 40, `seed ${seed}: ${n} temples in 144 regions`);
    if (!t) continue;
    found++;
    let chests = 0;
    for (const [x, y, z] of t.chests) {
      const id = c.getBlock(x, y, z);
      assert(IS_CHEST[id], `seed ${seed}: no chest at ${x},${y},${z} (${BLOCK_INFO[id]?.name})`);
      assert(c.gen.structures.chestAt(x, y, z) === "desert_pyramid", "a temple chest not known as one");
      chests++;
    }
    // The blue terracotta at the centre of the floor, the shaft under it, the floor 12 down.
    const [cx, cz] = [t.x0 + 10, t.z0 + 10];
    assert(c.getBlock(cx, t.floor, cz) === V.BLUE_TERRACOTTA, "no blue terracotta at the centre");
    for (let y = t.floor - 11; y < t.floor; y++) assert(!IS_SOLID[c.getBlock(cx, y, cz)], `the shaft is blocked at ${y}`);
    assert(c.getBlock(cx, t.floor - 12, cz) === V.SANDSTONE, "the hidden room's floor");
    if (BLOCK_INFO[V.TNT]) assert(c.getBlock(cx, t.floor - 13, cz) === V.TNT, "no TNT under the floor");
    assert(chests === 4, `${chests} chests`);
  }
  assert(found >= 1, "no temple in any seed's 144 regions");
  const loot = ST.rollStructureLoot("desert_pyramid", seeded(4));
  assert(loot.length >= 4 && loot.every(([id]) => itemInfo(id)), `temple loot: ${JSON.stringify(loot)}`);
});

await check("loot keeps vanilla's odds: what the game lacks gives nothing (a dungeon chest's golden apple about 1 roll in 8)", async () => {
  const rand = seeded(11);
  let apples = 0;
  let books = 0;
  let rolls = 0;
  for (let i = 0; i < 4000; i++) {
    const loot = ST.rollStructureLoot("dungeon", rand);
    apples += loot.filter(([id]) => id === 262).length;
    books += loot.filter(([id, n, tag]) => id === V.ENCHANTED_BOOK && n === 1 && tag).length;
    rolls += 2; // (1-3 rolls of the first pool: 2 on average)
  }
  const share = apples / rolls;
  assert(share > 0.09 && share < 0.15, `golden apples per roll: ${share.toFixed(3)} (vanilla 15/127 = 0.118)`);
  assert(books / rolls > 0.05 && books / rolls < 0.11, `enchanted books per roll: ${(books / rolls).toFixed(3)} (vanilla 10/127 = 0.079)`);
});

await check("an old Missions save's chunks (Round 13: the legacy generator) are unchanged (no structures), and the distant terrain of a Survival world still matches its chunks' heights", async () => {
  WT.setWorldType("missions");
  const MISSIONS_HASHES = { 12345: 1268467022, 777: 739122713, 2024: 48227652 };
  const coords = [[0, 0], [1, 0], [-3, 2], [10, -7], [40, 40], [-60, 13], [100, -100], [7, 200], [-250, -31], [333, 90]];
  for (const [seed, hash] of Object.entries(MISSIONS_HASHES)) {
    const gen = new TerrainGenerator(Number(seed), {});
    assert(!gen.structures, "a Missions terrain has structures");
    let h = 2166136261;
    for (const [cx, cz] of coords) {
      const blocks = new Uint16Array(16 * 128 * 16);
      gen.generate({ cx, cz, blocks });
      h = fnv(blocks, h);
      for (const id of blocks) assert(!isSpawner(id), `a spawner in a Missions chunk`);
    }
    assert(h === hash, `seed ${seed}: ${h}`);
  }
  WT.setWorldType("survival");
  // (the structures change no column's height: the LOD's samples are the terrain's)
  const lt = new LodTerrain(12345, { sites: false });
  const s = { top: 0, id: 0, depth: 0 };
  const gen = new TerrainGenerator(12345, { sites: false });
  for (let i = 0; i < 200; i++) {
    const x = i * 97 - 9000;
    const z = i * 61 + 300;
    lt.sample(x, z, s);
    assert(s.top === Math.max(gen.heightAt(x, z), 23) + 1 || s.depth > 0 || s.id === V.ICE, `LOD column ${x},${z}`);
  }
});

// ---------- A small world for the weather and the spawners ----------
// Flat chunks of stone with grass on top at `ground`, air above, the given
// light everywhere; the real terrain's biomes (biomeAt) at any column.
class TestWorld {
  constructor(seed = 5, light = 0xf0) {
    this.terrain = new TerrainGenerator(seed, { sites: false });
    this.chunks = new Map();
    this.changeListeners = [];
    this.edits = new Map();
    this.light = light;
  }
  build(cx0, cz0, r = 2, ground = 30) {
    for (let cz = cz0 - r; cz <= cz0 + r; cz++) {
      for (let cx = cx0 - r; cx <= cx0 + r; cx++) {
        const blocks = new Uint16Array(16 * 128 * 16);
        for (let i = 0; i < blocks.length; i++) {
          const y = i >> 8;
          blocks[i] = y === 0 ? BLOCK.BEDROCK : y < ground ? BLOCK.STONE : y === ground ? BLOCK.GRASS : BLOCK.AIR;
        }
        this.chunks.set(`${cx},${cz}`, { cx, cz, blocks, light: new Uint8Array(blocks.length).fill(this.light) });
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
  lightAt(x, y, z) {
    return { sky: this.light >> 4, block: this.light & 15 };
  }
  setBlock(x, y, z, id) {
    return this.setBlocks([x, y, z, id]) > 0;
  }
  setBlocks(list) {
    const changed = [];
    for (let i = 0; i < list.length; i += 4) {
      const [x, y, z, id] = [list[i], list[i + 1], list[i + 2], list[i + 3]];
      const c = this.getChunk(x >> 4, z >> 4);
      if (!c || y < 0 || y >= 128) continue;
      const k = (y << 8) | ((z & 15) << 4) | (x & 15);
      if (c.blocks[k] === id) continue;
      c.blocks[k] = id;
      changed.push(x, y, z);
    }
    for (const fn of this.changeListeners) fn(changed, {});
    return changed.length / 3;
  }
}
// A column of the given biome near the origin (the real terrain's).
function findBiome(terrain, biomes) {
  for (let r = 0; r < 12000; r += 64) {
    for (let a = 0; a < 16; a++) {
      const x = Math.round(Math.cos(a * 0.39 + r) * r);
      const z = Math.round(Math.sin(a * 0.39 + r) * r);
      if (biomes.includes(terrain.biomeAt(x, z)) && biomes.includes(terrain.biomeAt(x + 8, z + 8)) && biomes.includes(terrain.biomeAt(x - 8, z - 8))) return [x, z];
    }
  }
  return null;
}
function stubPlayer(x, y, z) {
  return {
    position: { x, y, z },
    dead: false,
    creative: false,
    fireTime: 0,
    health: 20,
    hurts: [],
    damage(n, cause) {
      this.hurts.push([n, cause]);
      this.health -= n;
      return true;
    },
  };
}

await check("the weather cycles within vanilla's times (on this world's day) and fades in and out over 5 s", async () => {
  WT.setWorldType("survival");
  const w = new W.Weather({ world: new TestWorld(), dayLength: 600 });
  w.rand = seeded(5);
  const spells = { clear: [], rain: [] };
  let t = 0;
  let last = w.raining;
  let since = 0;
  for (let i = 0; i < 400000 && spells.rain.length < 20; i++) {
    w.update(1);
    t += 1;
    if (w.raining !== last) {
      spells[last ? "rain" : "clear"].push(t - since);
      since = t;
      last = w.raining;
    }
  }
  const tick = 600 / 24000;
  assert(spells.rain.length >= 10, `only ${spells.rain.length} rains`);
  for (const s of spells.rain) assert(s >= 12000 * tick - 2 && s <= 24000 * tick + 2, `a rain of ${s} s`);
  for (const s of spells.clear.slice(1)) assert(s >= 12000 * tick - 2 && s <= 180000 * tick + 2, `a clear spell of ${s} s`);
  // The fade.
  w.set("clear", 1000, { instant: true });
  w.set("rain", 1000);
  w.update(2.5);
  assert(w.levels.rain > 0.4 && w.levels.rain < 0.6 && w.isRaining, `half way: ${w.levels.rain}`);
  w.update(3);
  assert(w.levels.rain === 1 && !w.isThundering, "full rain");
  w.set("thunder", 1000);
  w.update(5);
  assert(w.isThundering && w.kind === "thunder", "a thunderstorm");
  // Saved and loaded.
  const w2 = new W.Weather({ world: new TestWorld(), dayLength: 600 });
  w2.load(JSON.parse(JSON.stringify(w.serialize())));
  assert(w2.raining && w2.thundering && w2.isThundering && Math.abs(w2.rainTime - w.rainTime) < 0.2, "the saved weather");
  w2.load(undefined);
  assert(!w2.raining && !w2.isRaining, "an old save: clear");
  // (Round 13: a Missions world has the weather too.)
  WT.setWorldType("missions");
  w.update(1);
  assert(w.levels.rain === 1 && w.isRaining, "the weather goes on in a Missions world");
  WT.setWorldType("survival");
});

await check("rain falls in the open, not under a roof nor in a desert; snow in the snowy biomes settles and the cold freezes water", async () => {
  WT.setWorldType("survival");
  const probe = new TestWorld(31);
  const plains = findBiome(probe.terrain, [BIOME.PLAINS, BIOME.FOREST, BIOME.MEADOW, BIOME.BIRCH_FOREST]);
  const desert = findBiome(probe.terrain, [BIOME.DESERT]);
  const snowy = findBiome(probe.terrain, [BIOME.SNOWY_PLAINS, BIOME.SNOWY_TAIGA]);
  assert(plains && desert && snowy, `biomes found: ${plains} ${desert} ${snowy}`);
  for (const [[x, z], kind] of [[plains, "rain"], [desert, "none"], [snowy, "snow"]]) {
    const world = new TestWorld(31).build(x >> 4, z >> 4, 1);
    const w = new W.Weather({ world });
    w.set("rain", 1000, { instant: true });
    assert(w.rainingAt(x, 31, z) === (kind === "rain"), `${kind}: raining at ${x},${z}: ${w.rainingAt(x, 31, z)}`);
    assert(w.snowingAt(x, 31, z) === (kind === "snow"), `${kind}: snowing`);
    if (kind === "rain") {
      world.setBlock(x, 35, z, BLOCK.PLANKS); // a roof
      assert(!w.rainingAt(x, 31, z) && w.rainingAt(x, 36, z) && w.rainingAt(x + 1, 31, z), "under the roof");
      world.setBlock(x, 35, z, BLOCK.AIR);
      assert(w.rainingAt(x, 31, z), "the roof gone");
      // The bucket under the sky: a cauldron fills now and then, when the containers part has one.
      if (BLOCK_INFO[V.CAULDRON] && /cauldron/i.test(BLOCK_INFO[V.CAULDRON].name) && BLOCK_INFO[V.CAULDRON + 1]) {
        world.setBlock(x + 2, 31, z, V.CAULDRON);
        for (let i = 0; i < 300 && world.getBlock(x + 2, 31, z) === V.CAULDRON; i++) w.precipitationTick(x + 2, z);
        assert(world.getBlock(x + 2, 31, z) === V.CAULDRON + 1, "the cauldron never filled");
      }
    }
    if (kind === "snow") {
      assert(w.precipitationTick(x, z) === "snow" && world.getBlock(x, 31, z) === V.SNOW_LAYER && world.getBlock(x, 30, z) === N.SNOWY_GRASS, "no snow settled");
      // Still water at the edge of a pond freezes (also when clear).
      world.setBlock(x + 3, 30, z, BLOCK.WATER);
      w.set("clear", 1000, { instant: true });
      assert(w.precipitationTick(x + 3, z) === "ice" && world.getBlock(x + 3, 30, z) === V.ICE, "the water never froze");
    }
    if (kind === "none") assert(w.precipitationTick(x, z) === null && world.getBlock(x, 31, z) === BLOCK.AIR, "something fell in the desert");
  }
});

await check("lightning in a thunderstorm: it strikes where it rains, sets fire (Normal), hurts and burns what stands by it; rain puts fire out", async () => {
  WT.setWorldType("survival");
  const probe = new TestWorld(31);
  const [x, z] = findBiome(probe.terrain, [BIOME.PLAINS, BIOME.FOREST, BIOME.MEADOW, BIOME.BIRCH_FOREST]);
  const world = new TestWorld(31).build(x >> 4, z >> 4, 8);
  const player = stubPlayer(x + 0.5, 31, z + 0.5);
  const w = new W.Weather({ world, player, difficulty: () => "normal" });
  w.rand = seeded(8);
  const struck = [];
  w.onStrike = (a, b, c) => struck.push([a, b, c]);
  w.set("thunder", 1000, { instant: true });
  // A strike two blocks off finds the player (within 3).
  assert(w.tryStrike(x + 2, z, [player.position]), "no strike");
  assert(struck[0][0] === x && struck[0][2] === z, `the bolt went to ${struck[0]} not the player`);
  assert(player.hurts.length === 1 && player.hurts[0][0] === 5 && player.hurts[0][1] === "lightning" && player.fireTime === 8, `the player: ${JSON.stringify(player.hurts)} ${player.fireTime}`);
  assert(world.getBlock(x, 31, z) === V.FIRE, "no fire where it struck");
  // On Easy: no fire.
  const w2 = new W.Weather({ world, difficulty: () => "easy" });
  w2.set("thunder", 1000, { instant: true });
  w2.strike(x + 6, 31, z + 6);
  assert(world.getBlock(x + 6, 31, z + 6) === BLOCK.AIR, "fire on Easy");
  // Over a while, bolts fall around a player on their own.
  struck.length = 0;
  player.position.x += 40; // (out of their way)
  for (let i = 0; i < 600; i++) w.update(0.5, [player.position]);
  assert(struck.length >= 2 && struck.length <= 60, `${struck.length} bolts in 300 s`);
  // The rain: burning goes out, and a fire in the open goes out within a few ticks.
  player.position.x -= 40;
  player.fireTime = 8;
  w.update(0.05, [player.position]);
  assert(player.fireTime === 0, "the rain didn't put the player out");
  // Fires on a few planks: in the rain they go out much sooner than with no
  // rain (vanilla: 20% a tick, more as they age), and spread less.
  const lifetimes = (rain) => {
    const fworld = new TestWorld(31).build(x >> 4, z >> 4, 1);
    const fw = new W.Weather({ world: fworld });
    fw.set("rain", 1000, { instant: true });
    const fire = new FireSim(fworld);
    fire.rand = seeded(2);
    if (rain) fire.rainingAt = (a, b, c) => fw.nearRain(a, b, c);
    let sum = 0;
    for (let k = 0; k < 9; k++) {
      const fx = x - 12 + (k % 3) * 12;
      const fz = z - 12 + Math.floor(k / 3) * 12;
      const list = [];
      for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) list.push(fx + dx, 30, fz + dz, BLOCK.PLANKS);
      fworld.setBlocks(list);
      fworld.setBlock(fx, 31, fz, V.FIRE);
      const anyFire = () => {
        for (let dx = -3; dx <= 3; dx++) for (let dz = -3; dz <= 3; dz++) for (let y = 29; y <= 34; y++) if (fworld.getBlock(fx + dx, y, fz + dz) === V.FIRE) return true;
        return false;
      };
      let t = 0;
      for (; t < 120 && anyFire(); t += 0.25) fire.update(0.25);
      sum += t;
    }
    return sum / 9;
  };
  const wet = lifetimes(true);
  const dry = lifetimes(false);
  assert(wet < dry * 0.6, `fires burned ${wet.toFixed(1)} s on average in the rain, ${dry.toFixed(1)} s without`);
});

await check("a monster spawner spawns its creature in the dark near a player (up to 6 nearby), not in the light, not far away, not on Peaceful", async () => {
  WT.setWorldType("survival");
  const dark = new TestWorld(5, 0x00).build(0, 0, 2, 20);
  dark.setBlocks([8, 21, 8, N.SPAWNER + 1]); // a skeleton spawner
  dark.edits.set("0,0", new Map([[(21 << 8) | (8 << 4) | 8, N.SPAWNER + 1]]));
  const mobs = { mobs: [], sky: { daylight: 1 } };
  let peaceful = false;
  const before = LIB.spawnMob;
  LIB.spawnMob = (kind, x, y, z) => {
    if (peaceful) return null;
    const m = { kind, pos: { x, y, z }, dead: false };
    mobs.mobs.push(m);
    return m;
  };
  try {
    const sp = new ST.Spawners({ world: dark, mobs });
    sp.rand = seeded(3);
    const far = [{ x: 8, y: 21, z: 40 }];
    for (let i = 0; i < 100; i++) sp.update(0.1, far);
    assert(mobs.mobs.length === 0, "it spawned with nobody near");
    const near = [{ x: 8, y: 21, z: 16 }];
    for (let i = 0; i < 30; i++) sp.update(0.1, near);
    assert(mobs.mobs.length >= 1 && mobs.mobs.every((m) => m.kind === "skeleton" && Math.abs(m.pos.x - 8.5) <= 4 && Math.abs(m.pos.y - 21) <= 1), `the first wave: ${JSON.stringify(mobs.mobs)}`);
    for (let i = 0; i < 4000; i++) sp.update(0.1, near);
    assert(mobs.mobs.length >= 6 && mobs.mobs.length <= 9, `after 400 s: ${mobs.mobs.length} (6 at most near, then it waits)`);
    // In the light: nothing.
    const lit = new TestWorld(5, 0x0f).build(0, 0, 1, 20);
    lit.setBlocks([8, 21, 8, N.SPAWNER]);
    lit.edits.set("0,0", new Map([[(21 << 8) | (8 << 4) | 8, N.SPAWNER]]));
    mobs.mobs.length = 0;
    const sp2 = new ST.Spawners({ world: lit, mobs });
    for (let i = 0; i < 300; i++) sp2.update(0.1, near);
    assert(mobs.mobs.length === 0, "it spawned in the light");
    // Peaceful (the spawn request refused).
    peaceful = true;
    const sp3 = new ST.Spawners({ world: dark, mobs });
    for (let i = 0; i < 300; i++) sp3.update(0.1, near);
    assert(mobs.mobs.length === 0, "it spawned on Peaceful");
  } finally {
    LIB.spawnMob = before;
  }
  // The block: no drop, 15-43 experience, in the Creative palette, the cage tile.
  const info = BLOCK_INFO[N.SPAWNER];
  assert(info && info.xp[0] === 15 && info.xp[1] === 43 && info.creative !== false && !info.opaque, "the spawner block");
});

// ---------- In the browser ----------

if (!args.node) await browserChecks();

async function browserChecks() {
  const { chromium } = await import("playwright-core");
  const PORT = 9840 + Math.floor(Math.random() * 40);
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
    args: ["--use-gl=swiftshader", "--enable-webgl", "--ignore-gpu-blocklist", "--no-sandbox", "--disable-dev-shm-usage", "--disable-features=WebRtcHideLocalIpsWithMdns", "--autoplay-policy=no-user-gesture-required"],
  });
  const localThreeRoot = path.join(__dirname, "node_modules", "three");
  const peerjsFile = path.join(__dirname, "node_modules", "peerjs", "dist", "peerjs.min.js");
  async function newPage(label, size = { width: 960, height: 540 }) {
    const ctx = await browser.newContext({ viewport: size });
    const p = await ctx.newPage();
    await p.route("https://cdn.jsdelivr.net/npm/three@0.160.0/**", (route) => {
      const rel = new URL(route.request().url()).pathname.replace("/npm/three@0.160.0/", "");
      route.fulfill({ path: path.join(localThreeRoot, rel), contentType: "text/javascript" });
    });
    await p.route("https://cdn.jsdelivr.net/npm/peerjs@1.5.4/**", (route) => route.fulfill({ path: peerjsFile, contentType: "text/javascript" }));
    p.on("console", (m) => m.type() === "error" && errors.push(`[${label}] ${m.text()}`));
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
  async function until(p, fn, timeout = 30000, arg) {
    const t0 = Date.now();
    while (Date.now() - t0 < timeout) {
      const r = await v(p, fn, arg).catch(() => null);
      if (r) return r;
      await new Promise((res) => setTimeout(res, 150));
    }
    return null;
  }
  async function play(p) {
    const t0 = Date.now();
    while (Date.now() - t0 < 180000) {
      const st = await v(p, (g) => g.gameState);
      if (st === "playing") return;
      if (st === "dead") {
        await v(p, (g) => g.respawn());
        continue;
      }
      if (st === "start") await p.click("#play-btn", { timeout: 5000 }).catch(() => {});
      else if (await p.isVisible("#resume-btn")) await p.click("#resume-btn", { timeout: 3000 }).catch(() => {});
      else if (await p.isVisible("#click-to-play").catch(() => false)) await p.click("#click-to-play", { timeout: 3000 }).catch(() => {});
      else {
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
  const out = process.env.SHOTS || "";

  const page = await newPage("solo");
  await browserCheck("in the game: rain darkens the sky and falls round the camera (none on Low), a bolt flashes, the weather is saved", async () => {
    await page.goto(`http://127.0.0.1:${PORT}/index.html?seed=4711&type=survival&graphics=low`, { waitUntil: "load", timeout: 60000 });
    await page.waitForFunction(() => !!window.__ufo && window.__ufo.graphicsReady, null, { timeout: 120000 });
    await play(page);
    const clear = await v(page, (g) => {
      g.sky.locked = true;
      g.sky.setHours(12);
      g.weather.set("clear", 1000, { instant: true });
      return null;
    });
    await frames(page, 3);
    const sun0 = await v(page, (g) => [g.sky.sunLight.color.r, g.sky.material.uniforms.uCloudCoverage.value]);
    await v(page, (g) => g.weather.set("thunder", 1000, { instant: true }));
    await frames(page, 3);
    const s = await v(page, (g) => ({
      kind: g.weather.kind,
      sun: g.sky.sunLight.color.r,
      cover: g.sky.material.uniforms.uCloudCoverage.value,
      rain: g.weatherFx.rain.mesh.visible,
      f3: g.weather.isThundering,
    }));
    assert(s.kind === "thunder" && s.sun < sun0[0] * 0.4 && s.cover > 0.9 && sun0[1] < 0.5, `the storm's sky: ${JSON.stringify(s)} clear ${sun0}`);
    assert(!s.rain, "rain drawn on Low");
    await v(page, (g) => g.setGraphics("medium"));
    await page.waitForFunction(() => window.__ufo.graphicsReady, null, { timeout: 120000 });
    await frames(page, 4);
    const drawn = await v(page, (g) => {
      const p = g.player.position;
      const open = g.weather.rainingAt(p.x, p.y + 2, p.z) || g.weather.snowingAt(p.x, p.y + 2, p.z) || g.weather.precipAt(p.x, p.z) === 0;
      return { visible: g.weatherFx.rain.mesh.visible, n: g.weatherFx.rain.geometry.instanceCount, open };
    });
    assert(drawn.visible && drawn.n > 300, `drops on Medium: ${JSON.stringify(drawn)}`);
    if (out) await page.screenshot({ path: path.join(out, "world-rain.png") });
    // A bolt near the player.
    const bolt = await v(page, (g) => {
      const p = g.player.position;
      g.weather.strike(Math.floor(p.x) + 12, Math.floor(p.y), Math.floor(p.z) + 4);
      return { visible: g.weatherFx.boltMesh.visible, flash: g.weather.levels.flash };
    });
    await frames(page, 1);
    if (out) await page.screenshot({ path: path.join(out, "world-bolt.png") });
    assert(bolt.visible && bolt.flash === 1, `the bolt: ${JSON.stringify(bolt)}`);
    const saved = await v(page, (g) => {
      g.flushSave(true);
      for (const k of Object.keys(localStorage)) {
        const text = localStorage.getItem(k) || "";
        if (text.includes('"weather":{')) return JSON.parse(text).weather;
      }
      return null;
    });
    assert(saved && saved.r === 1 && saved.t === 1, `the saved weather: ${JSON.stringify(saved)}`);
    await v(page, (g) => g.setGraphics("low"));
  });

  await browserCheck("in the game: a spawner in a dark room spawns its creatures near the player; a dungeon's chest holds the dungeon's loot", async () => {
    const r = await v(page, async (g) => {
      const N = await import("./js/content/nature.js");
      const { BLOCK, IS_CHEST } = await import("./js/blocks.js");
      const V = await import("./js/content/ids.js");
      g.weather.set("clear", 1000, { instant: true });
      // A sealed stone room in the air, the player and a zombie spawner in it.
      const p = g.player.position;
      const x0 = Math.floor(p.x) - 4;
      const y0 = 100;
      const z0 = Math.floor(p.z) - 4;
      const list = [];
      for (let x = x0; x <= x0 + 8; x++) for (let y = y0; y <= y0 + 5; y++) for (let z = z0; z <= z0 + 8; z++) list.push(x, y, z, x === x0 || x === x0 + 8 || y === y0 || y === y0 + 5 || z === z0 || z === z0 + 8 ? BLOCK.STONE : BLOCK.AIR);
      list.push(x0 + 4, y0 + 1, z0 + 2, N.SPAWNER);
      g.world.setBlocks(list);
      p.set(x0 + 4.5, y0 + 1, z0 + 6.5);
      g.mobs.hostileSpawning = true;
      const before = g.mobs.countKind("zombie");
      for (let i = 0; i < 40; i++) g.spawners.update(0.1, [p], true);
      const zombies = g.mobs.mobs.filter((m) => m.kind === "zombie" && !m.dead && m.pos.y > y0 && m.pos.y < y0 + 5 && Math.abs(m.pos.x - (x0 + 4.5)) < 5);
      const light = g.world.lightAt(x0 + 4, y0 + 2, z0 + 4);
      // A dungeon in the ground around: its chest's loot.
      const dungeonIds = new Set([262, V.IRON_INGOT, 259, V.BREAD, V.WHEAT, V.BUCKET, V.REDSTONE, 257, V.MELON_SEEDS, V.PUMPKIN_SEEDS, V.BEETROOT_SEEDS, V.BONE, V.GUNPOWDER, V.ROTTEN_FLESH, V.STRING]);
      let loot = null;
      for (const c of g.world.chunks.values()) {
        const b = c.blocks;
        for (let i = 0; i < b.length && !loot; i++) {
          if (!IS_CHEST[b[i]]) continue;
          const x = c.cx * 16 + (i & 15);
          const y = i >> 8;
          const z = c.cz * 16 + ((i >> 4) & 15);
          if (g.world.terrain.structures.chestAt(x, y, z, (a, bb, cc) => g.world.getBlock(a, bb, cc)) !== "dungeon") continue;
          loot = g.interaction.chests.contents(x, y, z).filter(Boolean).map((st) => st.id);
        }
        if (loot) break;
      }
      for (let x = x0; x <= x0 + 8; x++) for (let y = y0; y <= y0 + 5; y++) for (let z = z0; z <= z0 + 8; z++) list.push(x, y, z, BLOCK.AIR);
      g.world.setBlocks(list.slice(-9 * 6 * 9 * 4));
      return { spawned: zombies.length, before, light, loot, ok: loot ? loot.every((id) => dungeonIds.has(id)) : null };
    });
    assert(r.spawned >= 1 && r.spawned <= 6, `the spawner: ${JSON.stringify(r)}`);
    if (r.loot) assert(r.ok && r.loot.length >= 3, `a dungeon chest: ${JSON.stringify(r.loot)}`);
    else console.log("        (no dungeon chest in the loaded ground)");
  });

  if (args.online) {
    const { default: express } = await import("express");
    const { ExpressPeerServer } = await import("peer");
    const PEER_PORT = PORT + 60;
    const app = express();
    const peerHttp = app.listen(PEER_PORT, "127.0.0.1");
    app.use("/ufo", ExpressPeerServer(peerHttp, { path: "/" }));
    const NET_Q = `peerServer=127.0.0.1:${PEER_PORT}/ufo&noStun=1&graphics=low`;
    const host = await newPage("host", { width: 640, height: 360 });
    const guest = await newPage("guest", { width: 640, height: 360 });
    // (two pages drawing at once crawl on a software renderer: neither draws)
    const noDraw = () => {
      const rr = window.__ufo.renderer;
      if (rr && !rr.__noDraw) {
        rr.__noDraw = true;
        rr.render = (scene, camera) => {
          scene?.updateMatrixWorld?.();
          camera?.updateMatrixWorld?.();
        };
      }
      return true;
    };
    await browserCheck("online: a guest gets the host's weather (also on joining) and its bolts, and a bolt by the guest hurts the guest", async () => {
      await host.goto(`http://127.0.0.1:${PORT}/index.html?seed=4712&type=survival&${NET_Q}`, { waitUntil: "load", timeout: 60000 });
      await host.waitForFunction(() => !!window.__ufo && window.__ufo.graphicsReady, null, { timeout: 120000 });
      await host.click("#menu-mp-btn");
      await host.fill("#mp-nick", "Alice");
      await host.click("#mp-host-btn");
      const code = await until(host, (g) => g.net.code, 30000);
      assert(code, "no room code");
      await host.click("#mp-lobby-play");
      await host.waitForFunction(() => window.__ufo.gameState === "playing", null, { timeout: 30000 });
      await v(host, noDraw);
      await v(host, (g) => g.weather.set("rain", 1000, { instant: true }));
      await guest.goto(`http://127.0.0.1:${PORT}/index.html?join=${code}&${NET_Q}`, { waitUntil: "load", timeout: 60000 });
      await guest.waitForSelector("#mp-join-boot:not(.hidden)", { timeout: 30000 });
      await guest.fill("#mp-boot-nick", "Bob");
      await guest.click("#mp-boot-join");
      await guest.waitForFunction(() => !!window.__ufo && window.__ufo.graphicsReady, null, { timeout: 120000 });
      assert(await until(guest, (g) => g.mp.stateLoaded, 60000), "the host's state never arrived");
      const joined = await v(guest, (g) => ({ raining: g.weather.raining, level: g.weather.levels.rain, authority: g.weather.authority }));
      assert(joined.raining && joined.level > 0.9 && !joined.authority, `on joining: ${JSON.stringify(joined)}`);
      await v(guest, noDraw);
      await play(guest);
      // The host turns it to a thunderstorm; the guest follows.
      await v(host, (g) => g.weather.set("thunder", 1000));
      assert(await until(guest, (g) => g.weather.thundering, 20000), "the guest never got the thunder");
      // The guest's own timers never turn it.
      await v(guest, (g) => g.weather.set("clear", 1000, { instant: true }));
      assert(await v(guest, (g) => g.weather.raining), "a guest changed the weather");
      // A bolt by the guest: drawn there, and the guest is hurt.
      const at = await v(guest, (g) => {
        const p = g.player.position;
        g.__boltSeen = 0;
        const s = g.weatherFx.strike.bind(g.weatherFx);
        g.weatherFx.strike = (...a) => {
          g.__boltSeen++;
          s(...a);
        };
        g.player.health = 20;
        g.player._invulnerable = 0;
        return [Math.floor(p.x), Math.floor(p.y), Math.floor(p.z)];
      });
      await v(host, (g, a) => g.weather.strike(a[0], a[1], a[2]), at);
      const hit = await until(guest, (g) => g.__boltSeen > 0 && { health: g.player.health, fire: g.player.fireTime }, 20000);
      assert(hit && hit.health <= 15, `the guest under the bolt: ${JSON.stringify(hit)}`);
      await guest.close();
      await host.close();
    });
    peerHttp.close();
  }
  await browser.close();
  server.close();
}

// ---------- Summary ----------
const failed = results.filter(([, ok]) => !ok);
console.log(`\n${results.length - failed.length} passed, ${failed.length} failed.`);
process.exit(failed.length ? 1 : 0);
