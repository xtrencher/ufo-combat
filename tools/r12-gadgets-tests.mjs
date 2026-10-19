// Round 12 gadgets tests: hoppers, droppers, dispensers, observers, tripwire,
// item frames, armor stands, the flower pot's other plants, bamboo (and the
// bamboo jungle) and scaffolding (js/content/gadgets.js, js/gadgets.js,
// js/redstone-sim.js).
// In Node (fast): the blocks, tiles and recipes are there; a hopper takes
// from a chest above and fills a furnace's input, side hoppers its fuel, one
// under it empties its output, a powered hopper is locked, a hopper picks up
// items in its bowl; a dropper puts into a chest or throws out, a dispenser
// shoots arrows (they hurt), places and takes water, uses bone meal, primes
// TNT, puts armor on a stand; an observer pulses once per change; two hooks
// with string between them are strung, pulled while something stands on it,
// let go after; frames and stands take and give their things, refuse what
// doesn't fit, are saved; bamboo grows as vanilla's (its leaves, thick from
// the third block, 12-16 tall); scaffolding keeps its distance and falls at
// 7; a Survival world's bamboo jungles are thick with bamboo, a Missions
// world has none.
// In the browser (the real game, a Survival world): the box screen shows a
// hopper's five slots, items flow through a hopper chain, a frame's item and
// a stand's armor are drawn (screenshots with SHOTS=dir); with --online a
// guest opens a hopper (the host's contents), puts an item in a frame and
// armor on a stand (asked of the host, seen by both).
//
//   node r12-gadgets-tests.mjs [--only=substring] [--node] [--online]
// (GAME_ROOT=dir runs another copy of the game.)
import http from "node:http";
import path from "node:path";
import fs from "node:fs";
import { register } from "node:module";
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
    console.log(`  FAIL  ${name}: ${err.stack?.split("\n").slice(0, 3).join(" / ") || err.message}`);
  }
}
// (Node: "three" from this folder's node_modules, as the page's import map gives it.)
const THREE_URL = pathToFileURL(path.join(__dirname, "node_modules", "three", "build", "three.module.js")).href;
register(`data:text/javascript,${encodeURIComponent(`export async function resolve(s, c, n) { return s === "three" ? { url: ${JSON.stringify(THREE_URL)}, shortCircuit: true } : n(s, c); }`)}`, import.meta.url);
const mod = (p) => import(pathToFileURL(path.join(ROOT, p)).href);

const THREE = await import(THREE_URL);
const B = await mod("js/blocks.js");
const I = await mod("js/content/ids.js");
const G = await mod("js/content/gadgets.js");
const IDX = await mod("js/content/index.js");
const { itemInfo } = await mod("js/items.js");
const { LIB } = await mod("js/content/base.js");
const { RedstoneSim } = await mod("js/redstone-sim.js");
const { Gadgets } = await mod("js/gadgets.js");
const { Chests } = await mod("js/chests.js");
const { Furnaces } = await mod("js/furnace.js");
const { makeStack, Inventory } = await mod("js/inventory.js");
const WT = await mod("js/worldtype.js");
const { TerrainGenerator } = await mod("js/terrain.js");
const { BIOME } = await mod("js/biomes.js");
const { BLOCK } = B;
const S = (id, n = 1) => makeStack(id, n);

// ---------- Node: a world of plain chunks ----------

function plainWorld() {
  const chunks = new Map();
  const nk = (cx, cz) => cx * 100000 + cz;
  const w = {
    seed: 7,
    dim: "overworld",
    dimInfo: { code: 0 },
    chunks,
    edits: new Map(),
    changeListeners: [],
    popped: [],
    getChunk: (cx, cz) => chunks.get(nk(cx, cz)),
    editsOf() {
      return this.edits;
    },
    getBlock(x, y, z) {
      x = Math.floor(x);
      y = Math.floor(y);
      z = Math.floor(z);
      if (y < 0) return BLOCK.BEDROCK;
      const c = y < 128 && this.getChunk(x >> 4, z >> 4);
      return c ? c.blocks[(y << 8) | ((z & 15) << 4) | (x & 15)] : 0;
    },
    setBlock(x, y, z, id) {
      return this.setBlocks([x, y, z, id]) > 0;
    },
    setBlocks(list) {
      const changed = [];
      for (let i = 0; i < list.length; i += 4) {
        const [x, y, z, id] = [list[i], list[i + 1], list[i + 2], list[i + 3]];
        const c = y >= 0 && y < 128 && this.getChunk(x >> 4, z >> 4);
        const k = (y << 8) | ((z & 15) << 4) | (x & 15);
        if (!c || c.blocks[k] === id) continue;
        c.blocks[k] = id;
        changed.push(x, y, z);
      }
      if (changed.length) for (const fn of this.changeListeners) fn(changed, {});
      return changed.length / 3;
    },
    raycast(o, d, len) {
      for (let t = 0; t <= len; t += 0.05) {
        const x = Math.floor(o.x + d.x * t);
        const y = Math.floor(o.y + d.y * t);
        const z = Math.floor(o.z + d.z * t);
        if (B.IS_SOLID[this.getBlock(x, y, z)]) return { distance: t, block: [x, y, z], place: [Math.floor(o.x + d.x * (t - 0.06)), Math.floor(o.y + d.y * (t - 0.06)), Math.floor(o.z + d.z * (t - 0.06))] };
      }
      return null;
    },
    lightAt: () => ({ sky: 15, block: 0 }),
    onBlockPopped(x, y, z, id) {
      this.popped.push([x, y, z, id]);
    },
  };
  for (let cx = -3; cx <= 3; cx++) for (let cz = -3; cz <= 3; cz++) chunks.set(nk(cx, cz), { cx, cz, blocks: new Uint16Array(16 * 16 * 128) });
  const floor = [];
  for (let x = -40; x < 48; x++) for (let z = -40; z < 48; z++) floor.push(x, 10, z, BLOCK.STONE);
  w.setBlocks(floor);
  return w;
}
// Dropped items, as js/entities.js keeps them.
function fakeItems() {
  return {
    items: [],
    spawn(id, count, pos, vel, opts = {}) {
      const it = { id, count, dur: opts.dur, tag: opts.tag, pos: pos.clone(), vel: vel ? vel.clone() : new THREE.Vector3(), dim: 0 };
      this.items.push(it);
      return it;
    },
    collect(it) {
      const i = this.items.indexOf(it);
      if (i >= 0) this.items.splice(i, 1);
    },
  };
}
// The game's systems on a plain world: run(seconds) steps the redstone and the gadgets.
function bench() {
  WT.setWorldType("survival");
  const w = plainWorld();
  const entities = fakeItems();
  const sim = new RedstoneSim({ world: w, entities });
  const chests = new Chests({ world: w });
  chests.onDrop = (s, x, y, z) => entities.spawn(s.id, s.count, new THREE.Vector3(x + 0.5, y + 0.5, z + 0.5));
  const furnaces = new Furnaces({ world: w });
  const player = { position: new THREE.Vector3(0, -50, 0), dead: false, creative: false, hurt: 0, damage(n) {
    this.hurt += n;
    return true;
  }, applyImpulse() {} };
  const inventory = new Inventory();
  const g = new Gadgets({ world: w, entities, chests, furnaces, redstone: sim, player, inventory });
  g.onDrop = chests.onDrop;
  const run = (s) => {
    for (let t = 0; t < s; t += 0.05) {
      sim.update(0.05);
      g.update(0.05);
    }
  };
  return { w, sim, g, chests, furnaces, entities, player, inventory, run };
}
const count = (slots, id) => slots.reduce((n, s) => n + (s && s.id === id ? s.count : 0), 0);

await check("the gadgets' blocks, items and recipes are there; 21 tiles of their own", async () => {
  const names = { [I.HOPPER]: "Hopper", [I.DROPPER + 4]: "Dropper", [I.DISPENSER + 4]: "Dispenser", [I.OBSERVER]: "Observer", [I.TRIPWIRE_HOOK]: "Tripwire Hook", [I.ITEM_FRAME + 4]: "Item Frame", [I.ARMOR_STAND]: "Armor Stand", [I.BAMBOO]: "Bamboo", [I.BAMBOO_BLOCK]: "Block of Bamboo", [I.SCAFFOLDING]: "Scaffolding" };
  for (const [id, name] of Object.entries(names)) assert(itemInfo(Number(id))?.name === name, `item ${id}: ${itemInfo(Number(id))?.name}`);
  // (the other variants count as their item)
  assert(B.ITEM_OF[I.HOPPER + 3] === I.HOPPER && B.ITEM_OF[I.DROPPER + 1] === I.DROPPER + 4 && B.ITEM_OF[I.OBSERVER + 7] === I.OBSERVER && B.ITEM_OF[I.TRIPWIRE] === I.STRING && B.ITEM_OF[I.ARMOR_STAND_TOP] === I.ARMOR_STAND && B.ITEM_OF[I.BAMBOO_SAPLING] === I.BAMBOO, "variants' items");
  const rs = IDX.recipes().filter((r) => r.module === "gadgets");
  const made = new Set(rs.map((r) => r.result?.[0] ?? r.input));
  for (const id of [I.HOPPER, I.DROPPER + 4, I.DISPENSER + 4, I.OBSERVER, I.TRIPWIRE_HOOK, I.ITEM_FRAME + 4, I.ARMOR_STAND, I.BAMBOO_BLOCK, I.SCAFFOLDING]) assert(made.has(id), `no recipe for ${itemInfo(id)?.name}`);
  const tiles = Object.keys(G.tiles);
  assert(tiles.length === 21 && tiles.every((t) => B.TILE_NAMES.includes(t)), `tiles: ${tiles.length}`);
});

await check("a hopper under a chest feeds a furnace's input; side hoppers its fuel; one under it empties its output; a powered one is locked", async () => {
  const { w, chests, furnaces, g, run } = bench();
  // chest (0,14,0) -> hopper (0,13,0) down -> furnace (0,12,0); chest (2,13,0) -> hopper (1,13,0) pointing -X? no: a side hopper at (1,12,0) points -X into the furnace
  w.setBlocks([0, 14, 0, BLOCK.CHEST, 0, 13, 0, I.HOPPER, 0, 12, 0, I.FURNACE, 1, 12, 0, I.HOPPER + 4, 1, 13, 0, BLOCK.CHEST, 0, 11, 0, I.HOPPER]);
  // (the hopper under the furnace stands on the floor's level: lift the floor away from it)
  w.setBlocks([0, 10, 0, BLOCK.AIR]);
  const top = chests.contents(0, 14, 0);
  top.fill(null);
  top[0] = S(I.RAW_IRON, 3);
  const side = chests.contents(1, 13, 0);
  side.fill(null);
  side[0] = S(BLOCK.PLANKS, 2);
  run(0.3); // (the simulation sees the hoppers)
  run(3);
  const f = furnaces.contents(0, 12, 0);
  assert(count(top, I.RAW_IRON) === 0 && (f.slots[0]?.count ?? 0) + count(g.contents(0, 13, 0).slots, I.RAW_IRON) <= 3, `the input: ${JSON.stringify(f.slots)}`);
  assert(f.slots[0]?.id === I.RAW_IRON || f.slots[2], `iron in the furnace: ${JSON.stringify(f.slots)}`);
  assert(count(side, BLOCK.PLANKS) === 0, `fuel taken: ${JSON.stringify(side)}`);
  // (smelting: a raw iron makes an ingot in 10 s; the hopper under it takes it)
  for (let k = 0; k < 40; k++) {
    furnaces.update(0.5);
    run(0.5);
  }
  const under = g.contents(0, 11, 0).slots;
  assert(count(under, I.IRON_INGOT) >= 1, `the output taken out: ${JSON.stringify(under)} furnace ${JSON.stringify(f.slots)}`);
  // A redstone block beside the top hopper locks it.
  top[0] = S(I.RAW_IRON, 5);
  w.setBlocks([0, 13, 1, I.REDSTONE_BLOCK]);
  run(3);
  assert(count(top, I.RAW_IRON) === 5, `locked hopper moved: ${JSON.stringify(top[0])}`);
  w.setBlocks([0, 13, 1, BLOCK.AIR]);
  run(1);
  assert(count(top, I.RAW_IRON) < 5, "unlocked hopper still");
});

await check("a hopper picks up items lying in its bowl (unless a full block covers it), at vanilla's pace of one item every 8 ticks from a chest", async () => {
  const { w, g, entities, chests, run } = bench();
  w.setBlocks([5, 11, 5, I.HOPPER]);
  run(0.3);
  entities.spawn(I.DIAMOND, 3, new THREE.Vector3(5.5, 12.1, 5.5));
  run(0.2);
  assert(count(g.contents(5, 11, 5).slots, I.DIAMOND) === 3 && !entities.items.length, `picked up: ${JSON.stringify(g.contents(5, 11, 5).slots)}`);
  w.setBlocks([7, 11, 5, I.HOPPER, 7, 12, 5, BLOCK.STONE]);
  run(0.3);
  entities.spawn(I.EMERALD, 1, new THREE.Vector3(7.5, 13.1, 5.5));
  run(0.5);
  assert(entities.items.length === 1, "picked up through stone");
  // Pace: 20 items from a chest take 20 x 0.4 s.
  w.setBlocks([9, 12, 5, BLOCK.CHEST, 9, 11, 5, I.HOPPER]);
  const c = chests.contents(9, 12, 5);
  c.fill(null);
  c[0] = S(BLOCK.COBBLESTONE, 20);
  run(4.1);
  const n = count(g.contents(9, 11, 5).slots, BLOCK.COBBLESTONE);
  assert(n >= 9 && n <= 12, `items in 4 s: ${n}`);
});

await check("a dropper puts one item into a chest in front, or throws it out; empty, it only clicks", async () => {
  const { w, g, chests, entities, run } = bench();
  // dropper facing +X (FACE 0), a lever on it
  w.setBlocks([0, 11, 0, I.DROPPER + 0, 1, 11, 0, BLOCK.CHEST]);
  const c = chests.contents(1, 11, 0);
  c.fill(null);
  g.contents(0, 11, 0).slots[3] = S(I.BREAD, 4);
  run(0.3);
  w.setBlocks([0, 11, -1, I.LEVER + 8 + 0]); // (a lever on its -Z side, on: attachment 0 faces +Z)
  run(0.6);
  assert(count(c, I.BREAD) === 1 && count(g.contents(0, 11, 0).slots, I.BREAD) === 3, `into the chest: ${JSON.stringify(c.filter(Boolean))}`);
  w.setBlocks([0, 11, -1, BLOCK.AIR, 1, 11, 0, BLOCK.AIR]);
  entities.items.length = 0;
  run(0.5);
  w.setBlocks([0, 11, -1, I.LEVER + 8]);
  run(0.6);
  assert(entities.items.some((it) => it.id === I.BREAD && it.vel.x > 1), `thrown out: ${JSON.stringify(entities.items.map((i) => [i.id, i.vel.x]))}`);
});

await check("a dispenser shoots an arrow that hurts a player in front, places and takes back water, uses bone meal, primes TNT, puts armor on a stand", async () => {
  const { w, g, sim, player, entities, run } = bench();
  const fire = (x, y, z) => {
    w.setBlocks([x, y - 1, z, BLOCK.AIR]);
    run(0.2);
    w.setBlocks([x, y - 1, z, I.REDSTONE_BLOCK]);
    run(0.4);
  };
  // dispenser at (0,12,0) facing +X; the player 4 blocks away
  w.setBlocks([0, 12, 0, I.DISPENSER + 0]);
  g.contents(0, 12, 0).slots[0] = S(I.ARROW, 2);
  run(0.3);
  player.position.set(4.5, 11, 0.5);
  w.setBlocks([0, 11, 0, I.REDSTONE_BLOCK]);
  run(1.5);
  assert(player.hurt === 3, `the arrow's damage: ${player.hurt}, shots ${g.shots.length}`);
  player.position.set(0, -50, 0);
  // water: placed, then taken back with a bucket
  const box = g.contents(0, 12, 0).slots;
  box.fill(null);
  box[0] = S(I.WATER_BUCKET);
  fire(0, 12, 0);
  assert(w.getBlock(1, 12, 0) === BLOCK.WATER && box[0]?.id === I.BUCKET, `water: ${w.getBlock(1, 12, 0)} ${JSON.stringify(box[0])}`);
  fire(0, 12, 0);
  assert(w.getBlock(1, 12, 0) === BLOCK.AIR && box.some((s) => s?.id === I.WATER_BUCKET), `taken back: ${JSON.stringify(box)}`);
  // bone meal on a sapling
  box.fill(null);
  box[0] = S(I.BONE_MEAL, 10);
  w.setBlocks([1, 11, 0, BLOCK.GRASS, 1, 12, 0, I.OAK_SAPLING]);
  fire(0, 12, 0);
  assert(count(box, I.BONE_MEAL) === 9, `bone meal used: ${count(box, I.BONE_MEAL)}`);
  // TNT
  w.setBlocks([1, 12, 0, BLOCK.AIR, 1, 11, 0, BLOCK.STONE]);
  box.fill(null);
  box[0] = S(I.TNT);
  fire(0, 12, 0);
  assert(sim.tnt.length === 1 && !box[0], `primed: ${sim.tnt.length}`);
  sim.tnt.length = 0;
  // armor onto a stand in front
  w.setBlocks([1, 12, 0, I.ARMOR_STAND, 1, 13, 0, I.ARMOR_STAND_TOP]);
  box[0] = S(309); // (an iron chestplate)
  fire(0, 12, 0);
  assert(g.showAt(1, 12, 0)?.slots[1]?.id === 309 && !box[0], `on the stand: ${JSON.stringify(g.showAt(1, 12, 0)?.slots)}`);
  void entities;
});

await check("an observer pulses once (one tick, after one tick) for each change in front; observers face to face make a clock", async () => {
  const { w, sim, run } = bench();
  // observer at (0,11,0) looking +X (FACE 0) at (1,11,0); a lamp behind it at (-1,11,0)
  w.setBlocks([0, 11, 0, I.OBSERVER + 0, -1, 11, 0, I.REDSTONE_LAMP]);
  run(0.5);
  assert(w.getBlock(-1, 11, 0) === I.REDSTONE_LAMP, "lit with no change");
  w.setBlocks([1, 11, 0, BLOCK.STONE]);
  let on = 0;
  let lamp = 0;
  for (let i = 0; i < 6; i++) {
    sim.update(0.1);
    if (w.getBlock(0, 11, 0) === I.OBSERVER + 6) on++;
    if (w.getBlock(-1, 11, 0) === I.REDSTONE_LAMP + 1) lamp++;
  }
  assert(on === 1 && lamp >= 1, `pulse ticks: ${on}, lamp ${lamp}`);
  // two facing each other
  w.setBlocks([5, 11, 0, I.OBSERVER + 0, 6, 11, 0, I.OBSERVER + 1]);
  let flips = 0;
  let last = w.getBlock(5, 11, 0);
  for (let i = 0; i < 30; i++) {
    sim.update(0.1);
    const now = w.getBlock(5, 11, 0);
    if (now !== last) flips++;
    last = now;
  }
  assert(flips >= 10, `the clock: ${flips} flips in 3 s`);
});

await check("tripwire: two hooks with string between are strung; something on the string pulls them (power), they let go after; cut, they're loose", async () => {
  const { w, sim, run, entities } = bench();
  // hooks on stone posts: wall at x=0 and x=6, hooks at x=1 (facing +X) and x=5 (facing -X), string x 2..4
  w.setBlocks([0, 11, 0, BLOCK.STONE, 6, 11, 0, BLOCK.STONE, 1, 11, 0, I.TRIPWIRE_HOOK + 2, 5, 11, 0, I.TRIPWIRE_HOOK + 3, 2, 11, 0, I.TRIPWIRE, 3, 11, 0, I.TRIPWIRE, 4, 11, 0, I.TRIPWIRE, 1, 11, 1, I.REDSTONE_LAMP]);
  run(1);
  const strung = (id) => ((id - I.TRIPWIRE_HOOK) >> 2) & 1;
  assert(strung(w.getBlock(1, 11, 0)) && strung(w.getBlock(5, 11, 0)) && w.getBlock(3, 11, 0) === I.TRIPWIRE + 1, `strung: ${w.getBlock(1, 11, 0)} ${w.getBlock(3, 11, 0)}`);
  // an item on the string (the plates' way: items count)
  entities.spawn(I.STICK, 1, new THREE.Vector3(3.5, 11.25, 0.5));
  run(0.4);
  assert(w.getBlock(1, 11, 0) >= I.TRIPWIRE_HOOK + 12 && w.getBlock(1, 11, 1) === I.REDSTONE_LAMP + 1, `pulled: ${w.getBlock(1, 11, 0)} lamp ${w.getBlock(1, 11, 1)}`);
  entities.items.length = 0;
  run(1.5);
  assert(w.getBlock(1, 11, 0) === I.TRIPWIRE_HOOK + 6 && w.getBlock(1, 11, 1) === I.REDSTONE_LAMP, `let go: ${w.getBlock(1, 11, 0)}`);
  w.setBlocks([3, 11, 0, BLOCK.AIR]);
  run(0.5);
  assert(w.getBlock(1, 11, 0) === I.TRIPWIRE_HOOK + 2 && w.getBlock(2, 11, 0) === I.TRIPWIRE, `cut: ${w.getBlock(1, 11, 0)} ${w.getBlock(2, 11, 0)}`);
});

await check("item frames and armor stands take and give their things (only the right armor slot), drop them when broken, are saved", async () => {
  const { w, g, entities, inventory } = bench();
  w.setBlocks([0, 12, 0, BLOCK.STONE, 1, 12, 0, I.ITEM_FRAME + 0, 3, 11, 0, I.ARMOR_STAND, 3, 12, 0, I.ARMOR_STAND_TOP]);
  inventory.slots[0] = S(I.DIAMOND, 5);
  inventory.selected = 0;
  const ctx = (x, y, z, hitY = y + 0.5) => ({ world: w, x, y, z, stack: inventory.selectedStack, inventory, creative: false, hit: [x + 0.5, hitY, z + 0.5], interaction: null });
  assert(g.useFrame(ctx(1, 12, 0)) && g.showAt(1, 12, 0).slots[0].id === I.DIAMOND && inventory.slots[0].count === 4, "into the frame");
  g.useFrame(ctx(1, 12, 0));
  assert(g.showAt(1, 12, 0).rot === 1 && inventory.slots[0].count === 4, "turned");
  inventory.slots[1] = S(312); // (diamond helmet)
  inventory.selected = 1;
  assert(g.useStand(ctx(3, 11, 0), 3, 11, 0) && g.showAt(3, 11, 0).slots[0]?.id === 312 && !inventory.slots[1], "helmet on");
  assert(!g.applyShow("overworld", 3, 11, 0, "stand", [[1, null, S(312)]], 0), "a helmet as a chestplate");
  // the empty hand takes it back (aimed at the head)
  assert(g.useStand(ctx(3, 11, 0, 12.8), 3, 11, 0) && !g.showAt(3, 11, 0).slots[0] && inventory.slots.some((s) => s?.id === 312), "helmet taken");
  g.useStand({ ...ctx(3, 11, 0), stack: S(309) }, 3, 11, 0);
  const saved = JSON.parse(JSON.stringify(g.serialize()));
  const g2 = new Gadgets({ world: w });
  g2.load(saved);
  assert(g2.showAt(1, 12, 0)?.slots[0]?.id === I.DIAMOND && g2.showAt(1, 12, 0).rot === 1 && g2.showAt(3, 11, 0)?.slots[1]?.id === 309, `saved: ${JSON.stringify(saved)}`);
  w.changeListeners.splice(w.changeListeners.indexOf(w.changeListeners.at(-1)), 1); // (g2 off)
  entities.items.length = 0;
  w.setBlocks([1, 12, 0, BLOCK.AIR, 3, 11, 0, BLOCK.AIR]);
  assert(entities.items.some((i) => i.id === I.DIAMOND) && entities.items.some((i) => i.id === 309) && !g.showAt(1, 12, 0), `dropped: ${JSON.stringify(entities.items.map((i) => i.id))}`);
  // a box's contents saved and dropped when it goes
  w.setBlocks([8, 11, 8, I.HOPPER]);
  g.contents(8, 11, 8).slots[2] = S(I.FLINT, 7);
  const g3 = new Gadgets({ world: w });
  g3.load(JSON.parse(JSON.stringify(g.serialize())));
  assert(g3.boxes.get("8,11,8")?.slots[2]?.count === 7, "box saved");
  w.changeListeners.pop();
  entities.items.length = 0;
  w.setBlocks([8, 11, 8, BLOCK.AIR]);
  assert(entities.items.length === 1 && entities.items[0].count === 7, "box spilled");
});

await check("bamboo grows as vanilla's: a shoot becomes a stalk, the top two leafy and large, the next small, thick from the third block, 12-16 tall; scaffolding keeps its distance and falls at 7", async () => {
  const { w, g, run } = bench();
  w.setBlocks([0, 10, 0, BLOCK.GRASS, 0, 11, 0, I.BAMBOO_SAPLING]);
  LIB.BLOCK_INFO = B.BLOCK_INFO;
  const tickS = IDX.RANDOM_TICK[I.BAMBOO_SAPLING];
  tickS(w, 0, 11, 0, I.BAMBOO_SAPLING, Math.random);
  assert(w.getBlock(0, 11, 0) === G.bambooId(0, false) && w.getBlock(0, 12, 0) === G.bambooId(1, false), "the shoot grew");
  let top = 12;
  for (let i = 0; i < 40; i++) if (G.growBamboo(w, 0, top, 0)) top++;
  const h = top - 10;
  assert(h === G.bambooMax(0, 0) && h >= 12 && h <= 16, `height ${h}`);
  const col = [];
  for (let y = 11; y <= top; y++) col.push([G.bambooLeaves(w.getBlock(0, y, 0)), G.bambooThick(w.getBlock(0, y, 0)) ? 1 : 0]);
  const L = col.map((c) => c[0]);
  assert(L.at(-1) === 2 && L.at(-2) === 2 && L.at(-3) === 1 && L.slice(0, -3).every((l) => l === 0), `leaves ${L}`);
  assert(col[0][1] === 0 && col.at(-1)[1] === 1, `thickness ${col.map((c) => c[1])}`);
  // scaffolding: a tower and an arm out of it
  const list = [];
  for (let y = 11; y <= 13; y++) list.push(10, y, 10, I.SCAFFOLDING);
  w.setBlocks(list);
  for (let x = 11; x <= 16; x++) w.setBlocks([x, 13, 10, I.SCAFFOLDING + G.scaffoldDistanceAt(w, x, 13, 10)]);
  run(0.5);
  assert(G.scaffoldDistance(w.getBlock(16, 13, 10)) === 6 && G.scaffoldDistanceAt(w, 17, 13, 10) === 7, `distances ${G.scaffoldDistance(w.getBlock(16, 13, 10))}`);
  // cut the tower's foot: everything over unsupported falls
  w.popped.length = 0;
  w.setBlocks([10, 10, 10, BLOCK.AIR, 10, 9, 10, BLOCK.AIR]);
  w.setBlocks([10, 11, 10, BLOCK.AIR]);
  for (let i = 0; i < 20; i++) run(0.05);
  let left = 0;
  for (let x = 10; x <= 16; x++) for (let y = 11; y <= 13; y++) if (G.isScaffolding(w.getBlock(x, y, 10))) left++;
  assert(left === 0 && w.popped.length >= 7, `left ${left}, fell ${w.popped.length}`);
  void g;
});

await check("a Survival world's bamboo jungles are thick with bamboo on podzol (and a Missions world's jungles have none)", async () => {
  WT.setWorldType("survival");
  const surv = new TerrainGenerator(777, { sites: false, vanilla: true });
  let at = null;
  for (let r = 0; r < 8000 && !at; r += 48) for (let a = 0; a < 24 && !at; a++) {
    const x = Math.round(Math.cos((a * Math.PI) / 12) * r);
    const z = Math.round(Math.sin((a * Math.PI) / 12) * r);
    if (surv.biomes.hotWet(x, z) && surv.biomes.bambooField(x, z) > 0.8 && surv.biomeAt(x, z) === BIOME.JUNGLE) at = [x, z];
  }
  assert(at, "no bamboo jungle found");
  const stalks = (gen) => {
    let n = 0;
    let podzol = 0;
    const c = { cx: at[0] >> 4, cz: at[1] >> 4, blocks: new Uint16Array(16 * 16 * 128) };
    gen.generate(c);
    for (let i = 256; i < c.blocks.length; i++) {
      if (G.isBamboo(c.blocks[i]) && !G.isBamboo(c.blocks[i - 256])) n++;
      if (c.blocks[i] === I.PODZOL) podzol++;
    }
    return { n, podzol };
  };
  const s = stalks(surv);
  assert(s.n >= 15 && s.podzol >= 15, `the bamboo jungle's chunk: ${JSON.stringify(s)} at ${at}`);
  WT.setWorldType("missions");
  const miss = stalks(new TerrainGenerator(777, { sites: false, vanilla: false }));
  assert(miss.n === 0, `Missions bamboo: ${miss.n}`);
  WT.setWorldType("survival");
});

// ---------- In the browser ----------

async function browserChecks() {
  const { chromium } = await import("playwright-core");
  const PORT = 9740 + Math.floor(Math.random() * 40);
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
  // A little workshop in the air before the player: [x, y, z] of its corner.
  const build = (g) => {
    const p = g.player.position;
    const x0 = Math.floor(p.x) + 3;
    const y0 = Math.min(110, Math.floor(p.y) + 30);
    const z0 = Math.floor(p.z) - 2;
    const V = g.__V;
    const list = [];
    for (let x = x0 - 1; x <= x0 + 6; x++) for (let z = z0 - 1; z <= z0 + 5; z++) list.push(x, y0, z, 3); // (a stone floor)
    for (let y = y0 + 1; y <= y0 + 4; y++) for (let z = z0 - 1; z <= z0 + 5; z++) list.push(x0 + 6, y, z, 3); // (a wall)
    list.push(x0, y0 + 3, z0, 41, x0, y0 + 2, z0, V.HOPPER, x0, y0 + 1, z0, 41); // chest, hopper, chest
    list.push(x0 + 2, y0 + 1, z0, V.DISPENSER + 4, x0 + 3, y0 + 1, z0, V.DROPPER + 4, x0 + 4, y0 + 1, z0, V.OBSERVER + 1);
    list.push(x0 + 5, y0 + 2, z0 + 2, V.ITEM_FRAME + 1, x0 + 3, y0 + 1, z0 + 3, V.ARMOR_STAND + 6, x0 + 3, y0 + 2, z0 + 3, V.ARMOR_STAND_TOP);
    list.push(x0, y0 + 1, z0 + 3, V.BAMBOO + 3, x0, y0 + 2, z0 + 3, V.BAMBOO + 3, x0, y0 + 3, z0 + 3, V.BAMBOO + 4, x0, y0 + 4, z0 + 3, V.BAMBOO + 5, x0, y0 + 5, z0 + 3, V.BAMBOO + 5);
    list.push(x0 + 1, y0 + 1, z0 + 5, V.SCAFFOLDING, x0 + 1, y0 + 2, z0 + 5, V.SCAFFOLDING, x0 + 2, y0 + 2, z0 + 5, V.SCAFFOLDING + 1, x0 + 2, y0 + 1, z0 + 2, V.POTTED_MORE + 3);
    g.world.setBlocks(list);
    return [x0, y0, z0];
  };

  const page = await newPage("solo");
  await browserCheck("in the game: a hopper moves a chest's items down; its box screen shows five slots; a frame's item and a stand's armor are drawn", async () => {
    await page.goto(`http://127.0.0.1:${PORT}/index.html?seed=4721&type=survival&graphics=low`, { waitUntil: "load", timeout: 60000 });
    await page.waitForFunction(() => !!window.__ufo && window.__ufo.graphicsReady, null, { timeout: 120000 });
    await play(page);
    assert(await v(page, (g) => !!g.gadgets), "no gadgets in the game (main.js wiring)");
    const at = await v(page, async (g, src) => {
      g.__V = await import("./js/content/ids.js");
      g.sky.locked = true;
      g.sky.setHours(12);
      g.weather?.set?.("clear", 1000, { instant: true });
      const [x0, y0, z0] = new Function("return " + src)()(g);
      const c = g.interaction.chests.contents(x0, y0 + 3, z0);
      c.fill(null);
      c[0] = { id: 264, count: 3 };
      g.interaction.chests.contents(x0, y0 + 1, z0).fill(null);
      const sh = g.gadgets;
      sh.applyShow(g.world.dim, x0 + 5, y0 + 2, z0 + 2, "frame", [[0, null, { id: 276, count: 1, dur: 250 }]], 1);
      sh.applyShow(g.world.dim, x0 + 3, y0 + 1, z0 + 3, "stand", [[0, null, { id: 312, count: 1, dur: 363 }], [1, null, { id: 313, count: 1, dur: 528 }], [2, null, { id: 306, count: 1, dur: 105 }], [3, null, { id: 303, count: 1, dur: 65 }]], 0);
      // the player looking at it all
      g.player.position.set(x0 + 0.5, y0 + 1, z0 + 9.5);
      g.player.velocity?.set(0, 0, 0);
      g.player.flying = true;
      g.player.yaw = 0;
      g.player.pitch = -0.25;
      return [x0, y0, z0];
    }, build.toString());
    await frames(page, 30);
    const moved = await until(page, (g, a) => {
      const below = g.interaction.chests.contents(a[0], a[1] + 1, a[2]);
      return below.some((s) => s?.id === 264) && { below: below.filter(Boolean), drawn: g.gadgets.drawnCount };
    }, 30000, at);
    assert(moved, "the hopper moved nothing");
    assert(moved.drawn === 2, `frame and stand drawn: ${moved.drawn}`);
    if (out) await page.screenshot({ path: path.join(out, "gadgets-workshop.png") });
    // the hopper's screen
    const screen = await v(page, (g, a) => {
      g.interaction.onOpenScreen("box", a[0], a[1] + 2, a[2]);
      const s = g.invScreen;
      const shown = s.chestViews.filter((x) => !x.el.classList.contains("hidden")).length;
      return { kind: s.kind, shown, title: s.titleEl.textContent, size: s.chestView?.slots?.length };
    }, at);
    if (out) await page.screenshot({ path: path.join(out, "gadgets-hopper-screen.png") });
    await v(page, (g) => g.invScreen.onCloseRequest?.());
    assert(screen.kind === "box" && screen.shown === 5 && screen.title === "Hopper" && screen.size === 5, `the screen: ${JSON.stringify(screen)}`);
    // the save holds them
    const saved = await v(page, (g) => {
      g.flushSave(true);
      for (const k of Object.keys(localStorage)) {
        const text = localStorage.getItem(k) || "";
        if (text.includes('"gadgets":{')) return JSON.parse(text).gadgets;
      }
      return null;
    });
    assert(saved?.s && Object.keys(saved.s).length === 2, `saved: ${JSON.stringify(saved)}`);
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
    await browserCheck("online: a guest sees the host's dispenser contents, puts a pickaxe in a frame and a helmet on a stand (asked of the host), both see them", async () => {
      await host.goto(`http://127.0.0.1:${PORT}/index.html?seed=4722&type=survival&${NET_Q}`, { waitUntil: "load", timeout: 60000 });
      await host.waitForFunction(() => !!window.__ufo && window.__ufo.graphicsReady, null, { timeout: 120000 });
      await host.click("#menu-mp-btn");
      await host.fill("#mp-nick", "Alice");
      await host.click("#mp-host-btn");
      const code = await until(host, (g) => g.net.code, 30000);
      assert(code, "no room code");
      await host.click("#mp-lobby-play");
      await host.waitForFunction(() => window.__ufo.gameState === "playing", null, { timeout: 30000 });
      await v(host, noDraw);
      const at = await v(host, async (g, src) => {
        g.__V = await import("./js/content/ids.js");
        const a = new Function("return " + src)()(g);
        g.gadgets.contents(a[0] + 2, a[1] + 1, a[2]).slots[1] = { id: 264, count: 7 }; // (the dispenser)
        return a;
      }, build.toString());
      await guest.goto(`http://127.0.0.1:${PORT}/index.html?join=${code}&${NET_Q}`, { waitUntil: "load", timeout: 60000 });
      await guest.waitForSelector("#mp-join-boot:not(.hidden)", { timeout: 30000 });
      await guest.fill("#mp-boot-nick", "Bob");
      await guest.click("#mp-boot-join");
      await guest.waitForFunction(() => !!window.__ufo && window.__ufo.graphicsReady, null, { timeout: 120000 });
      assert(await until(guest, (g) => g.mp.stateLoaded, 60000), "the host's state never arrived");
      await v(guest, noDraw);
      await play(guest);
      // the guest stands by the workshop
      await v(guest, (g, a) => {
        g.player.position.set(a[0] + 0.5, a[1] + 1, a[2] + 4.5);
        g.player.flying = true;
      }, at);
      assert(await until(guest, async (g, a) => (g.__V2 ||= await import("./js/content/ids.js")) && g.world.getBlock(a[0], a[1] + 2, a[2]) === g.__V2.HOPPER, 30000, at), "the guest never saw the hopper");
      const view = await v(guest, (g, a) => {
        g.__view = g.gadgets.openView(a[0] + 2, a[1] + 1, a[2], () => {});
        return true;
      }, at);
      const seen = await until(guest, (g) => g.__view.ready && g.__view.slots[1]?.count === 7 && g.__view.slots.length, 20000);
      assert(view && seen === 9, `the guest's view of the dispenser: ${seen}`);
      await v(guest, (g) => g.gadgets.closeView());
      // the frame and the stand
      await v(guest, (g, a) => {
        const inv = g.inventory;
        inv.slots[0] = { id: 276, count: 1, dur: 250 };
        inv.slots[1] = { id: 312, count: 1, dur: 363 };
        inv.selected = 0;
        const ctx = (x, y, z, hy) => ({ world: g.world, x, y, z, stack: inv.selectedStack, inventory: inv, creative: false, hit: [x + 0.5, hy, z + 0.5], interaction: g.interaction });
        g.gadgets.useFrame(ctx(a[0] + 5, a[1] + 2, a[2] + 2, a[1] + 2.5));
        return true;
      }, at);
      assert(await until(guest, (g) => !g.inventory.slots[0] && !g.gadgets.pending, 20000), "the guest's pickaxe never went in");
      await v(guest, (g, a) => {
        const inv = g.inventory;
        inv.selected = 1;
        g.gadgets.useStand({ world: g.world, x: a[0] + 3, y: a[1] + 1, z: a[2] + 3, stack: inv.selectedStack, inventory: inv, creative: false, hit: [0, a[1] + 2.8, 0], interaction: g.interaction }, a[0] + 3, a[1] + 1, a[2] + 3);
      }, at);
      assert(await until(guest, (g) => !g.inventory.slots[1] && !g.gadgets.pending, 20000), "the guest's helmet never went on");
      const hostSees = await until(host, (g, a) => {
        const f = g.gadgets.showAt(a[0] + 5, a[1] + 2, a[2] + 2);
        const s = g.gadgets.showAt(a[0] + 3, a[1] + 1, a[2] + 3);
        return f?.slots[0]?.id === 276 && s?.slots[0]?.id === 312 && { f: f.slots[0].id, s: s.slots[0].id };
      }, 20000, at);
      const guestSees = await until(guest, (g, a) => g.gadgets.showAt(a[0] + 5, a[1] + 2, a[2] + 2)?.slots[0]?.id === 276 && g.gadgets.showAt(a[0] + 3, a[1] + 1, a[2] + 3)?.slots[0]?.id === 312, 20000, at);
      assert(hostSees && guestSees, `host ${JSON.stringify(hostSees)} guest ${guestSees}`);
      await guest.close();
      await host.close();
    });
    peerHttp.close();
  }
  await browser.close();
  server.close();
}
if (!args.node) await browserChecks();

// ---------- Summary ----------
const failed = results.filter(([, ok]) => !ok);
console.log(`\n${results.length - failed.length} passed, ${failed.length} failed.`);
process.exit(failed.length ? 1 : 0);
