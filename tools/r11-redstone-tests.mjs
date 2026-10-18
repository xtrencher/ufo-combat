// Round 11 redstone tests (js/content/redstone.js, js/redstone-sim.js).
// Without a browser (Node, a small world of plain chunks): a lever powers
// dust that lights a lamp 10 blocks away and one 15 away, not one 16 away;
// a torch inverts (a tick late); a button gives a 1 s pulse; a pressure
// plate under a player opens an iron door and shuts it after; a repeater
// delays and is one-way; a piston pushes a row (12 at most, never
// obsidian) and a sticky one pulls a block back; dust goes up and down
// steps, up glass but not down it; a torch clock burns out; TNT lit by
// flint and steel explodes after 4 s and sets off the TNT beside it, powered
// TNT primes, a guest's lit TNT is primed by the host, fire primes TNT; a
// guest never simulates (its flint and steel and its blasts leave TNT for
// the host to prime; the host's primed TNT falls there, harmless); a note
// block plays once a pulse; an edit far from redstone costs nothing;
// the recipes' ingredients exist; the tile budget. In the game (headless
// Chromium, a Survival world): the same circuits through real right clicks
// (a lever, a button, flint and steel, placing a piston and dust), TNT's
// crater and chain, every redstone shape meshed the same in a worker and on
// the main thread, icons and item models, and a save and a reload keeping
// the circuits working (a lamp still lit, a lever still working, a button
// saved pressed let out).
//
//   node r11-redstone-tests.mjs [--only=substring] [--seed=42] [--nobrowser]
//
// Like the other suites, it fails on any console error or page error.
import http from "node:http";
import path from "node:path";
import fs from "node:fs";
import { register } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";
import { chromium } from "playwright-core";

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
const SEED = Number(args.seed ?? 42);
const results = [];
const errors = [];
let browser = null;
let server = null;

async function check(name, fn) {
  if (args.only && !name.toLowerCase().includes(String(args.only).toLowerCase())) return;
  const t0 = Date.now();
  const errBefore = errors.length;
  try {
    await fn();
    if (errors.length > errBefore) throw new Error(`console errors: ${errors.slice(errBefore, errBefore + 3).join(" | ")}`);
    results.push([name, true]);
    console.log(`  PASS  ${name} (${((Date.now() - t0) / 1000).toFixed(1)}s)`);
  } catch (err) {
    results.push([name, false]);
    console.log(`  FAIL  ${name}: ${err.message}`);
  }
}
function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}
// (Node: "three" from this folder's node_modules, as the page's import map gives it.)
const THREE_URL = pathToFileURL(path.join(__dirname, "node_modules", "three", "build", "three.module.js")).href;
register(`data:text/javascript,${encodeURIComponent(`export async function resolve(s, c, n) { return s === "three" ? { url: ${JSON.stringify(THREE_URL)}, shortCircuit: true } : n(s, c); }`)}`, import.meta.url);
const mod = (p) => import(pathToFileURL(path.join(ROOT, p)).href);

// ---------- Node: a world of plain chunks ----------

const B = await mod("js/blocks.js");
const I = await mod("js/content/ids.js");
const R = await mod("js/content/redstone.js");
const { LIB } = await mod("js/content/base.js");
const { RedstoneSim } = await mod("js/redstone-sim.js");
const W = I.REDSTONE_WIRE;
const LAMP = I.REDSTONE_LAMP;

function plainWorld() {
  const chunks = new Map();
  const nk = (cx, cz) => cx * 100000 + cz;
  const w = {
    chunks,
    changeListeners: [],
    popped: [],
    getChunk: (cx, cz) => chunks.get(nk(cx, cz)),
    getBlock(x, y, z) {
      x = Math.floor(x);
      y = Math.floor(y);
      z = Math.floor(z);
      if (y < 0) return B.BLOCK.BEDROCK;
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
    lightAt: () => ({ sky: 15, block: 0 }),
    onBlockPopped(x, y, z, id) {
      this.popped.push([x, y, z, id]);
    },
  };
  for (let cx = -3; cx <= 3; cx++) for (let cz = -3; cz <= 3; cz++) chunks.set(nk(cx, cz), { cx, cz, blocks: new Uint16Array(16 * 16 * 128) });
  const floor = [];
  for (let x = -40; x < 48; x++) for (let z = -40; z < 48; z++) floor.push(x, 10, z, B.BLOCK.STONE);
  w.setBlocks(floor);
  return w;
}
// A simulation on a plain world: run(n) runs n redstone ticks.
function bench(extra = {}) {
  const w = plainWorld();
  const sim = new RedstoneSim({ world: w, ...extra });
  const run = (n, dt = 0.1) => {
    for (let i = 0; i < n; i++) sim.update(dt);
  };
  return { w, sim, run };
}
const b = (w) => (x, y, z) => w.getBlock(x, y, z);

await check("a lever's dust lights a lamp 10 blocks away and one 15 away, not one 16 away; off at once, the lamp 2 ticks later", async () => {
  const { w, run } = bench();
  const at = b(w);
  for (const [z, n] of [[0, 10], [3, 15], [6, 16]]) {
    const list = [0, 11, z, I.LEVER + 5];
    for (let i = 1; i <= n; i++) list.push(i, 11, z, W);
    w.setBlocks([...list, n + 1, 11, z, LAMP]);
  }
  run(3);
  assert(at(1, 11, 0) === W && at(11, 11, 0) === LAMP, "lever off: nothing powered");
  for (const z of [0, 3, 6]) w.setBlock(0, 11, z, R.FLIP[at(0, 11, z)]);
  run(2);
  const pw = (x, z) => at(x, 11, z) - W;
  assert(pw(1, 0) === 15 && pw(10, 0) === 6, `dust 15 falling by one: ${pw(1, 0)}, ${pw(10, 0)}`);
  assert(at(11, 11, 0) === LAMP + 1 && at(16, 11, 3) === LAMP + 1, "the lamps 10 and 15 away lit");
  assert(at(17, 11, 6) === LAMP && pw(16, 6) === 0 && pw(15, 6) === 1, `16 away dark: ${pw(15, 6)}, ${pw(16, 6)}`);
  for (const z of [0, 3, 6]) w.setBlock(0, 11, z, R.FLIP[at(0, 11, z)]);
  run(1);
  assert(pw(1, 0) === 0 && at(11, 11, 0) === LAMP + 1, "lever off: the dust at once, the lamp not yet");
  run(2);
  assert(at(11, 11, 0) === LAMP, "the lamp out after 2 ticks");
});

await check("a torch inverts the block it hangs on, a tick late; a lamp over a torch lights", async () => {
  const { w, run } = bench();
  const at = b(w);
  w.setBlocks([5, 11, 5, B.BLOCK.STONE, 6, 11, 5, I.REDSTONE_WALL_TORCH + 2, 7, 11, 5, W, 8, 11, 5, LAMP]);
  run(3);
  assert(at(6, 11, 5) === I.REDSTONE_WALL_TORCH + 2 && at(8, 11, 5) === LAMP + 1, "the torch lights the lamp through dust");
  w.setBlock(4, 11, 5, I.LEVER + 3 + 8); // (on the block's -X side, on)
  run(1);
  const after1 = at(6, 11, 5);
  run(1);
  assert(after1 === I.REDSTONE_WALL_TORCH + 2 && at(6, 11, 5) === I.REDSTONE_WALL_TORCH + 6, `the torch goes out a tick after: ${after1}, ${at(6, 11, 5)}`);
  run(3);
  assert(at(8, 11, 5) === LAMP, "the lamp out");
  w.setBlocks([5, 11, 8, B.BLOCK.STONE, 5, 12, 8, I.REDSTONE_TORCH, 5, 13, 8, LAMP]);
  run(2);
  assert(at(5, 13, 8) === LAMP + 1, "a lamp over a torch");
});

await check("a stone button gives a 1 s pulse, an oak one 1.5 s", async () => {
  const { w, run } = bench();
  const at = b(w);
  w.setBlocks([3, 11, 3, LAMP, 4, 11, 3, I.STONE_BUTTON + 5, 3, 11, 6, LAMP, 4, 11, 6, I.OAK_BUTTON + 5]);
  run(2);
  w.setBlocks([4, 11, 3, I.STONE_BUTTON + 13, 4, 11, 6, I.OAK_BUTTON + 13]);
  run(1);
  assert(at(3, 11, 3) === LAMP + 1 && at(3, 11, 6) === LAMP + 1, "pressed: the lamps light");
  run(9);
  assert(at(4, 11, 3) === I.STONE_BUTTON + 13, "still in at 1 s");
  run(1);
  assert(at(4, 11, 3) === I.STONE_BUTTON + 5 && at(4, 11, 6) === I.OAK_BUTTON + 13, "the stone one out after 1 s, the oak one still in");
  run(5);
  assert(at(4, 11, 6) === I.OAK_BUTTON + 5, "the oak one out after 1.5 s");
  run(3);
  assert(at(3, 11, 3) === LAMP && at(3, 11, 6) === LAMP, "the lamps out");
});

await check("a pressure plate under a player opens an iron door (both halves), and the door shuts when they leave", async () => {
  const { w, sim, run } = bench();
  const at = b(w);
  const D = I.IRON_DOOR;
  w.setBlocks([5, 11, 5, D, 5, 12, 5, D + 8, 5, 11, 4, I.STONE_PRESSURE_PLATE]);
  run(3);
  assert(at(5, 11, 5) === D, "shut");
  sim.player = { position: { x: 5.5, y: 11, z: 4.5 }, dead: false };
  run(2);
  assert(at(5, 11, 4) === I.STONE_PRESSURE_PLATE + 1 && at(5, 11, 5) === D + 4 && at(5, 12, 5) === D + 12, `open: ${at(5, 11, 5) - D}, ${at(5, 12, 5) - D}`);
  run(12);
  assert(at(5, 11, 5) === D + 4, "open while stood on");
  sim.player.position = { x: 9, y: 11, z: 9 };
  run(12);
  assert(at(5, 11, 4) === I.STONE_PRESSURE_PLATE && at(5, 11, 5) === D && at(5, 12, 5) === D + 8, "the plate up, the door shut");
});

await check("a repeater delays by its ticks and passes power one way only", async () => {
  const { w, run } = bench();
  const at = b(w);
  w.setBlocks([0, 11, 0, I.LEVER + 5, 1, 11, 0, W, 2, 11, 0, R.repeaterId(2, 4, 0), 3, 11, 0, W, 4, 11, 0, LAMP]);
  run(2);
  w.setBlock(0, 11, 0, I.LEVER + 13);
  run(3);
  assert(at(4, 11, 0) === LAMP, "not through after 0.3 s");
  run(2);
  assert(at(4, 11, 0) === LAMP + 1 && at(3, 11, 0) === W + 15, "through after 0.4 s, at full power");
  w.setBlocks([0, 11, 2, LAMP, 1, 11, 2, W, 2, 11, 2, R.repeaterId(2, 1, 0), 3, 11, 2, W, 4, 11, 2, I.LEVER + 13]);
  run(4);
  assert(at(0, 11, 2) === LAMP && at(3, 11, 2) === W + 15 && at(1, 11, 2) === W, "nothing backward");
});

await check("a piston pushes a row (12 at most, never obsidian), retracts, and a sticky one pulls its block back", async () => {
  const { w, run } = bench();
  const at = b(w);
  w.setBlocks([0, 11, 0, R.pistonId(0, 0, 0), 1, 11, 0, B.BLOCK.DIRT, 2, 11, 0, B.BLOCK.PLANKS, 3, 11, 0, B.BLOCK.COBBLESTONE, -1, 11, 0, I.REDSTONE_BLOCK]);
  run(3);
  const row = [0, 1, 2, 3, 4].map((x) => at(x, 11, 0));
  assert(row.join() === [R.pistonId(0, 0, 1), R.headId(0, 0), B.BLOCK.DIRT, B.BLOCK.PLANKS, B.BLOCK.COBBLESTONE].join(), `pushed: ${row}`);
  w.setBlock(-1, 11, 0, 0);
  run(3);
  assert(at(0, 11, 0) === R.pistonId(0, 0, 0) && at(1, 11, 0) === 0 && at(2, 11, 0) === B.BLOCK.DIRT, "retracted, the row left");
  w.setBlocks([0, 11, 4, R.pistonId(1, 0, 0), 1, 11, 4, B.BLOCK.DIRT, -1, 11, 4, I.REDSTONE_BLOCK]);
  run(3);
  w.setBlock(-1, 11, 4, 0);
  run(3);
  assert(at(1, 11, 4) === B.BLOCK.DIRT && at(2, 11, 4) === 0, "the sticky one pulled it back");
  const long = [0, 11, 8, R.pistonId(0, 0, 0)];
  for (let i = 1; i <= 13; i++) long.push(i, 11, 8, B.BLOCK.DIRT);
  w.setBlocks([...long, -1, 11, 8, I.REDSTONE_BLOCK]);
  run(3);
  assert(at(0, 11, 8) === R.pistonId(0, 0, 0), "13 in a row: no push");
  w.setBlocks([13, 11, 8, 0, -1, 11, 8, 0]);
  w.setBlock(-1, 11, 8, I.REDSTONE_BLOCK);
  run(3);
  assert(at(0, 11, 8) === R.pistonId(0, 0, 1) && at(13, 11, 8) === B.BLOCK.DIRT, "12: pushed");
  w.setBlocks([0, 11, 12, R.pistonId(0, 0, 0), 1, 11, 12, I.OBSIDIAN, -1, 11, 12, I.REDSTONE_BLOCK]);
  run(3);
  assert(at(0, 11, 12) === R.pistonId(0, 0, 0) && at(1, 11, 12) === I.OBSIDIAN, "obsidian stays");
  w.setBlocks([0, 11, 14, R.pistonId(0, 0, 0), 1, 11, 14, B.BLOCK.TORCH, -1, 11, 14, I.REDSTONE_BLOCK]);
  run(3);
  assert(at(1, 11, 14) === R.headId(0, 0) && w.popped.some((p) => p[3] === B.BLOCK.TORCH), "a torch in the way breaks off");
});

await check("dust: up and down steps, up glass but not down it, across a chunk border", async () => {
  const { w, run } = bench();
  const at = b(w);
  w.setBlocks([20, 11, 20, I.LEVER + 13, 21, 11, 20, W, 22, 11, 20, B.BLOCK.STONE, 22, 12, 20, W, 23, 12, 20, W, 24, 12, 20, B.BLOCK.STONE, 25, 11, 20, W]);
  run(3);
  assert(at(22, 12, 20) === W + 14 && at(23, 12, 20) === W + 13, `up a step: ${at(22, 12, 20) - W}`);
  w.setBlocks([5, 11, 5, B.BLOCK.STONE, 4, 12, 5, B.BLOCK.STONE, 4, 13, 5, I.LEVER + 12, 5, 12, 5, W, 6, 11, 5, W, 7, 11, 5, W]);
  run(3);
  assert(at(5, 12, 5) === W + 15 && at(6, 11, 5) === W + 14 && at(7, 11, 5) === W + 13, `down a step: ${at(6, 11, 5) - W}`);
  w.setBlocks([30, 11, 30, B.BLOCK.GLASS, 30, 12, 30, W, 31, 11, 30, W, 32, 11, 30, I.LEVER + 13]);
  run(3);
  assert(at(30, 12, 30) === W + 14, "up onto glass");
  w.setBlocks([32, 11, 30, 0, 29, 11, 30, B.BLOCK.STONE, 29, 12, 30, I.REDSTONE_TORCH]);
  run(3);
  assert(at(30, 12, 30) === W + 15 && at(31, 11, 30) === W, `not down off glass: ${at(31, 11, 30) - W}`);
  w.setBlocks([-3, 11, -6, I.LEVER + 13, ...[-2, -1, 0, 1, 2].flatMap((x) => [x, 11, -6, W])]);
  run(3);
  assert(at(2, 11, -6) === W + 11, `across x = 0: ${at(2, 11, -6) - W}`);
});

await check("a one-torch clock burns out (dark 8 s), then lights again", async () => {
  const { w, sim, run } = bench();
  const at = b(w);
  w.setBlocks([10, 11, 10, B.BLOCK.STONE, 11, 11, 10, I.REDSTONE_WALL_TORCH + 2, ...[[12, 10], [12, 11], [12, 12], [11, 12], [10, 12], [10, 11]].flatMap(([x, z]) => [x, 11, z, W])]);
  let lit = 0;
  let last = -1;
  for (let i = 0; i < 40; i++) {
    run(1);
    const t = at(11, 11, 10);
    if (t !== last && t === I.REDSTONE_WALL_TORCH + 2) lit++;
    last = t;
  }
  assert(lit >= 5 && lit <= 10 && last === I.REDSTONE_WALL_TORCH + 6, `lit ${lit} times, then out`);
  const e0 = sim.stats.edits;
  run(40);
  assert(sim.stats.edits === e0, "no edits while burnt out");
  run(50);
  assert(sim.stats.edits > e0, "lit again");
});

await check("TNT: flint and steel, 4 s, a blast; the TNT beside it goes off 0.5-1.5 s later; powered TNT, a guest's lit TNT and fire prime it", async () => {
  const blasts = [];
  let T = 0;
  const effects = {
    blastListeners: [],
    listener: { x: 0, y: 0, z: 0 },
    explode(pos, opts) {
      blasts.push({ t: T, ...opts });
      const removed = [];
      const edits = [];
      for (let x = Math.floor(pos.x) - 3; x <= pos.x + 3; x++) {
        for (let y = Math.floor(pos.y) - 3; y <= pos.y + 3; y++) {
          for (let z = Math.floor(pos.z) - 3; z <= pos.z + 3; z++) {
            const id = w.getBlock(x, y, z);
            if (!id || Math.hypot(x + 0.5 - pos.x, y + 0.5 - pos.y, z + 0.5 - pos.z) > 3) continue;
            removed.push(x, y, z, id);
            edits.push(x, y, z, 0);
          }
        }
      }
      w.setBlocks(edits);
      for (const fn of this.blastListeners) fn(pos, removed, opts.radius, { mirror: false });
      return removed;
    },
  };
  const { w, sim } = bench({ effects });
  const run = (n) => {
    for (let i = 0; i < n; i++) {
      sim.update(0.05);
      T += 0.05;
    }
  };
  run(4);
  w.setBlocks([5, 11, 5, I.TNT, 7, 11, 5, I.TNT]);
  run(2);
  assert(LIB.igniteTnt(w, 5, 11, 5) && w.getBlock(5, 11, 5) === 0 && sim.tnt.length === 1, "lit: the block is primed TNT now");
  const t0 = T;
  run(78);
  assert(!blasts.length, "nothing before 4 s");
  run(4);
  assert(blasts.length === 1 && Math.abs(blasts[0].t - t0 - 4) < 0.11 && blasts[0].source === "tnt" && Math.abs(blasts[0].radius - 16 / 3) < 1e-9, `the blast at ${(blasts[0]?.t - t0).toFixed(2)} s: ${JSON.stringify(blasts[0])}`);
  assert(sim.tnt.length === 1 && w.getBlock(7, 11, 5) === 0, "the TNT beside it primed");
  run(31);
  assert(blasts.length === 2 && blasts[1].t - blasts[0].t >= 0.45 && blasts[1].t - blasts[0].t <= 1.55, `the second at +${(blasts[1]?.t - blasts[0].t).toFixed(2)} s`);
  w.setBlocks([20, 11, 20, I.TNT, 21, 11, 20, I.REDSTONE_BLOCK]);
  run(3);
  assert(w.getBlock(20, 11, 20) === 0 && sim.tnt.length === 1, "powered TNT primes");
  w.setBlock(30, 11, 30, R.TNT_LIT);
  run(2);
  assert(w.getBlock(30, 11, 30) === 0 && sim.tnt.length === 2, "TNT a guest lit: primed by the host");
  sim.rand = () => 0.1;
  w.setBlocks([35, 11, 35, I.TNT, 36, 11, 35, I.FIRE]);
  run(50);
  assert(w.getBlock(35, 11, 35) === 0, "fire beside it primes it");
  assert(R.blocks[I.TNT].flammable[1] === 0, "fire never just burns it away");
});

await check("online: a guest never simulates (its flint and steel leaves TNT_LIT, its blast's TNT TNT_LIT_SHORT); the host's \"rs\" primed TNT falls there and never explodes; the host sends them", async () => {
  const blasts = [];
  const effects = { blastListeners: [], listener: { x: 0, y: 12, z: 0 }, explode: (p, o) => blasts.push(o) };
  // The host: its primed TNT and sounds go out.
  const host = bench({ effects });
  const sent = [];
  host.sim.send = (m) => sent.push(m);
  host.w.setBlocks([2, 11, 2, I.TNT, 4, 11, 4, LAMP, 5, 11, 4, I.LEVER + 5]);
  host.run(2);
  host.w.setBlock(5, 11, 4, I.LEVER + 13);
  host.sim.click(5, 11, 4, true);
  LIB.igniteTnt(host.w, 2, 11, 2);
  host.run(1);
  const events = sent.flatMap((m) => (m.t === "rs" ? m.e : []));
  const tnt = events.find((e) => e[0] === "t");
  assert(tnt && tnt[1] === 2.5 && tnt[2] === 11 && tnt[7] === 4, `primed TNT sent: ${JSON.stringify(events)}`);
  assert(events.some((e) => e[0] === "s" && e[1] === "click") && events.some((e) => e[0] === "s" && e[1] === "fuse"), "sounds sent");
  // The guest.
  const guest = bench({ effects: { blastListeners: [], listener: { x: 0, y: 12, z: 0 }, explode: (p, o) => blasts.push(o) } });
  guest.sim.enabled = () => false;
  guest.w.setBlocks([2, 11, 2, I.TNT, 4, 11, 4, LAMP, 5, 11, 4, I.LEVER + 13, 6, 11, 6, I.TNT]);
  guest.run(3);
  assert(guest.w.getBlock(4, 11, 4) === LAMP, "a guest's lamp waits for the host");
  assert(LIB.igniteTnt(guest.w, 2, 11, 2) && guest.w.getBlock(2, 11, 2) === R.TNT_LIT && !guest.sim.tnt.length, "flint and steel: TNT_LIT, nothing primed here");
  const removed = [6, 11, 6, I.TNT];
  guest.w.setBlock(6, 11, 6, 0);
  for (const fn of guest.sim.effects?.blastListeners || []) fn({ x: 6, y: 11, z: 6 }, removed, 3, { mirror: false });
  assert(guest.w.getBlock(6, 11, 6) === R.TNT_LIT_SHORT && removed[3] === -1, "its own blast's TNT: TNT_LIT_SHORT for the host");
  const n = blasts.length;
  guest.sim.onMessage({ t: "rs", e: [tnt, ["s", "click", 1, 2, 3, 1, 0], ["x", "junk"], "junk"] });
  assert(guest.sim.tnt.length === 1 && guest.sim.tnt[0].visual, "drawn");
  guest.run(60, 0.1);
  assert(!guest.sim.tnt.length && blasts.length === n, "gone after its fuse, without a blast here");
});

await check("a note block plays once as power comes, not when placed or when the power goes; its instrument from the block under it", async () => {
  const { w, sim, run } = bench({ effects: { blastListeners: [], listener: { x: 40, y: 12, z: 40 } } });
  const notes = [];
  sim.sounds.play = (k, d, a, c) => k === "note" && notes.push([a, c]);
  w.setBlocks([40, 11, 40, I.NOTE_BLOCK + 3, 41, 11, 40, I.LEVER + 5]);
  run(3);
  w.setBlock(41, 11, 40, I.LEVER + 13);
  run(3);
  w.setBlock(41, 11, 40, I.LEVER + 5);
  run(3);
  assert(notes.length === 1 && notes[0][0] === 3 && notes[0][1] === 2, `one note, pitch 3, a bass drum on stone: ${JSON.stringify(notes)}`);
  w.setBlocks([40, 10, 42, B.BLOCK.PLANKS, 40, 11, 42, I.NOTE_BLOCK + 24]);
  sim.playNote(40, 11, 42, I.NOTE_BLOCK + 24);
  assert(notes.length === 2 && notes[1][1] === 1, `on planks: the bass: ${JSON.stringify(notes)}`);
});

await check("an edit far from any redstone queues nothing; a 400-dust network settles in one tick", async () => {
  const { w, sim, run } = bench();
  run(2);
  const big = [];
  for (let x = 30; x < 46; x++) for (let z = 30; z < 46; z++) for (let y = 0; y < 10; y++) big.push(x, y, z, 0);
  w.setBlocks(big);
  assert(sim._queue.size === 0, "nothing queued");
  const net = [-20, 11, -20, I.LEVER + 5];
  for (let x = -19; x < 21; x++) for (let z = -20; z < -10; z++) net.push(x, 11, z, W);
  w.setBlocks(net);
  run(1);
  const t0 = performance.now();
  w.setBlock(-20, 11, -20, I.LEVER + 13);
  run(1);
  const ms = performance.now() - t0;
  assert(w.getBlock(-19, 11, -20) === W + 15 && w.getBlock(-5, 11, -20) === W + 1, `lit in one tick (${ms.toFixed(1)} ms)`);
});

await check("every redstone recipe's ingredients and results exist; the tiles keep to the part's budget", async () => {
  const { recipes, CONTENT_TILES } = await mod("js/content/index.js");
  const items = await mod("js/items.js");
  const missing = [];
  let n = 0;
  for (const rc of recipes().filter((x) => x.module === "redstone")) {
    n++;
    const ing = [];
    if (rc.key) for (const k of Object.values(rc.key)) ing.push(...[].concat(k));
    if (rc.ingredients) for (const k of rc.ingredients) ing.push(...[].concat(k));
    if (rc.input !== undefined) ing.push(...[].concat(rc.input));
    if (rc.result) ing.push(rc.result[0]);
    for (const id of ing) if (!items.itemInfo(id)) missing.push(`${rc.type}:${id}`);
  }
  assert(n >= 14 && !missing.length, `${n} recipes, missing: ${missing}`);
  const own = Object.keys(R.tiles);
  assert(own.length <= 18 && own.every((t) => CONTENT_TILES.includes(t)), `${own.length} tiles`);
  // (TNT's recipe is the core one)
  const { coreRecipes } = await mod("js/crafting.js");
  assert(coreRecipes().some((rc) => rc.result[0] === I.TNT), "TNT can be made");
});

if (args.nobrowser) await finish();

// ---------- The browser ----------
const PORT = 9880 + Math.floor(Math.random() * 40);
const MIME = { ".html": "text/html", ".js": "text/javascript" };
server = http.createServer((req, res) => {
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
await new Promise((r) => server.listen(PORT, r));
browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome",
  args: ["--use-gl=swiftshader", "--enable-webgl", "--ignore-gpu-blocklist", "--no-sandbox", "--disable-dev-shm-usage"],
});
const page = await browser.newPage({ viewport: { width: 960, height: 540 } });
const localThreeRoot = path.join(__dirname, "node_modules", "three");
await page.route("https://cdn.jsdelivr.net/npm/three@0.160.0/**", (route) => {
  const rel = new URL(route.request().url()).pathname.replace("/npm/three@0.160.0/", "");
  route.fulfill({ path: path.join(localThreeRoot, rel), contentType: "text/javascript" });
});
page.on("console", (m) => {
  if (m.type() === "error") errors.push(m.text());
});
page.on("pageerror", (e) => errors.push(String(e)));
page.on("dialog", (d) => d.accept());

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
// v(fn, arg): runs fn(game, arg) in the page (game = window.__ufo).
const v = (fn, arg) => page.evaluate(([src, a]) => new Function("g", "arg", `return (${src})(g, arg);`)(window.__ufo, a), [fn.toString(), arg]);

async function boot() {
  await page.waitForFunction(() => !!window.__ufo, null, { timeout: 60000 });
  await page.evaluate(() => window.__ufo.setGraphics("low"));
  await page.waitForFunction(() => window.__ufo.graphicsReady, null, { timeout: 120000 });
  await v(async (g) => {
    const { makeStack } = await import("./js/inventory.js");
    const { RedstoneSim } = await import("./js/redstone-sim.js");
    // (main.js builds the simulation; until it does, one is made here and driven by the tests)
    if (!g.redstone) g.redstone = new RedstoneSim({ scene: g.scene, world: g.world, effects: g.effects, audio: g.audio, entities: g.entities, mobs: g.mobs, player: g.player });
    window.__rs = {
      stack: makeStack,
      // ticks: n redstone ticks (TNT moving with them).
      run(n, dt = 0.1) {
        for (let i = 0; i < n; i++) g.redstone.update(dt);
      },
      aim(eye, at) {
        const pl = g.player;
        pl.flying = true;
        pl.velocity.set(0, 0, 0);
        const eyeOff = pl.getEyePosition().y - pl.position.y;
        pl.position.set(eye[0], eye[1] - eyeOff, eye[2]);
        const dx = at[0] - eye[0];
        const dy = at[1] - eye[1];
        const dz = at[2] - eye[2];
        pl.yaw = Math.atan2(-dx, -dz);
        pl.pitch = Math.asin(dy / Math.hypot(dx, dy, dz));
        g.interaction.updateTarget(true);
        return g.interaction.target;
      },
      // A right click at `at` from `eye`, holding stackId (or nothing).
      use(stackId, eye, at) {
        const inv = g.inventory;
        inv.selected = 0;
        inv.slots[0] = stackId ? makeStack(stackId, 16) : null;
        const t = window.__rs.aim(eye, at);
        g.interaction.mouseDown(2);
        g.interaction.mouseUp(2);
        return t ? { id: t.id, block: t.block } : null;
      },
    };
  });
}
async function play() {
  await page.click("#play-btn", { timeout: 120000 }).catch(() => {});
  const t0 = Date.now();
  while (Date.now() - t0 < 120000) {
    const st = await v((g) => g.gameState);
    if (st === "playing") return;
    if (st === "dead") {
      await v((g) => g.respawn());
      continue;
    }
    if (st === "start") await page.click("#play-btn", { timeout: 5000 }).catch(() => {});
    else if (await page.isVisible("#resume-btn")) await page.click("#resume-btn", { timeout: 3000 }).catch(() => {});
    else {
      await page.mouse.click(480, 270);
      await frames(5);
    }
    await frames(3);
  }
  throw new Error(`the game didn't start playing (state ${await v((g) => g.gameState)}; ${errors.slice(0, 3).join(" | ")})`);
}
const URL_ = `http://localhost:${PORT}/index.html?seed=${SEED}&type=survival`;
await page.goto(URL_, { waitUntil: "load", timeout: 60000 });
await boot();
await play();

// A test site: a stone floor near spawn with air above (built, the same in
// every world), loaded: (x, y - 1, z) is the floor.
const site = await v(async (g) => {
  if (g.testFlags) g.testFlags.noMissions = true;
  g.setMode("creative");
  const w = g.world;
  const x = Math.floor(g.spawn.x) + 8;
  const z = Math.floor(g.spawn.z) + 8;
  w.prepareArea(x + 10, z + 10, 2);
  const y = Math.max(w.surfaceY(x, z) + 1, 34);
  const list = [];
  for (let ax = -4; ax <= 24; ax++) {
    for (let az = -4; az <= 24; az++) {
      list.push(x + ax, y - 1, z + az, 3);
      for (let ay = 0; ay <= 7; ay++) list.push(x + ax, y + ay, z + az, 0);
    }
  }
  w.setBlocks(list);
  w.processQueues(50);
  window.__rs.run(3);
  return { x, y, z };
});
const ID = { LEVER: I.LEVER, W, LAMP, STONE_BUTTON: I.STONE_BUTTON, IRON_DOOR: I.IRON_DOOR, PLATE: I.STONE_PRESSURE_PLATE, TNT: I.TNT, FLINT: I.FLINT_AND_STEEL, PISTON: I.PISTON, REDSTONE: I.REDSTONE, TORCH: I.REDSTONE_TORCH, WALL_TORCH: I.REDSTONE_WALL_TORCH };

await check("in the game: a lever clicked lights a lamp 10 blocks away (and one 15 away, not 16); clicked again, they go out", async () => {
  const r = await v((g, { s, ID }) => {
    const T = window.__rs;
    const { x, y, z } = s;
    const w = g.world;
    for (const [dz, n] of [[0, 10], [2, 15], [4, 16]]) {
      const list = [x, y, z + dz, ID.LEVER + 5];
      for (let i = 1; i <= n; i++) list.push(x + i, y, z + dz, ID.W);
      w.setBlocks([...list, x + n + 1, y, z + dz, ID.LAMP]);
    }
    T.run(2);
    const lamps = () => [w.getBlock(x + 11, y, z), w.getBlock(x + 16, y, z + 2), w.getBlock(x + 17, y, z + 4)].map((id) => id - ID.LAMP);
    const out = { before: lamps(), clicked: [] };
    for (const dz of [0, 2, 4]) out.clicked.push(T.use(null, [x + 0.5, y + 2.4, z + dz - 1.5], [x + 0.5, y + 0.15, z + dz + 0.5])?.id - ID.LEVER);
    T.run(2);
    out.on = lamps();
    out.light = w.lightAt(x + 11, y + 1, z).block;
    for (const dz of [0, 2, 4]) T.use(null, [x + 0.5, y + 2.4, z + dz - 1.5], [x + 0.5, y + 0.15, z + dz + 0.5]);
    T.run(4);
    out.off = lamps();
    return out;
  }, { s: site, ID });
  assert(r.before.join() === "0,0,0" && r.clicked.join() === "5,5,5", `before: ${JSON.stringify(r)}`);
  assert(r.on.join() === "1,1,0" && r.light >= 13, `on: ${JSON.stringify(r)}`);
  assert(r.off.join() === "0,0,0", `off: ${JSON.stringify(r)}`);
});

await check("in the game: dust placed from redstone; a torch inverts; a button clicked gives a 1 s pulse; a pressure plate opens an iron door", async () => {
  const r = await v((g, { s, ID }) => {
    const T = window.__rs;
    const { x, y } = s;
    const z = s.z + 7;
    const w = g.world;
    const out = {};
    // Dust from the redstone item, on the floor.
    T.use(ID.REDSTONE, [x + 2.5, y + 2.2, z - 1.5], [x + 2.5, y - 0.01, z + 0.5]);
    out.dust = w.getBlock(x + 2, y, z) - ID.W;
    out.left = g.inventory.slots[0]?.count;
    // A torch on a block's side, inverted by a lever on the block's top.
    w.setBlocks([x + 5, y, z, 3, x + 6, y, z, ID.WALL_TORCH + 2, x + 7, y, z, ID.LAMP]);
    T.run(2);
    out.torchOn = [w.getBlock(x + 6, y, z) - ID.WALL_TORCH, w.getBlock(x + 7, y, z) - ID.LAMP];
    w.setBlock(x + 5, y + 1, z, ID.LEVER + 4 + 8);
    T.run(4);
    out.torchOff = [w.getBlock(x + 6, y, z) - ID.WALL_TORCH, w.getBlock(x + 7, y, z) - ID.LAMP];
    // A button on a lamp's side.
    w.setBlocks([x + 10, y, z, ID.LAMP, x + 10, y, z - 1, 0]);
    T.run(1);
    const hit = T.use(null, [x + 10.5, y + 0.5, z - 2.5], [x + 10.5, y + 0.5, z]);
    out.btnHit = hit?.id;
    w.setBlock(x + 10, y, z - 1, ID.STONE_BUTTON + 1); // (the -Z wall: a button facing -Z)
    T.use(null, [x + 10.5, y + 0.5, z - 2.5], [x + 10.5, y + 0.5, z - 0.9]);
    out.pressed = w.getBlock(x + 10, y, z - 1) - ID.STONE_BUTTON;
    T.run(1);
    out.lampDuring = w.getBlock(x + 10, y, z) - ID.LAMP;
    T.run(9);
    out.at1 = w.getBlock(x + 10, y, z - 1) - ID.STONE_BUTTON;
    T.run(4);
    out.after = [w.getBlock(x + 10, y, z - 1) - ID.STONE_BUTTON, w.getBlock(x + 10, y, z) - ID.LAMP];
    // An iron door with a plate in front of it.
    const D = ID.IRON_DOOR;
    w.setBlocks([x + 14, y, z, D, x + 14, y + 1, z, D + 8, x + 14, y, z - 1, ID.PLATE]);
    T.run(2);
    const pl = g.player;
    pl.flying = false;
    pl.velocity.set(0, 0, 0);
    pl.position.set(x + 14.5, y, z - 0.5);
    T.run(2);
    out.door = [w.getBlock(x + 14, y, z - 1) - ID.PLATE, w.getBlock(x + 14, y, z) - D, w.getBlock(x + 14, y + 1, z) - D];
    pl.position.set(x + 18.5, y + 3, z + 3.5);
    pl.flying = true;
    T.run(12);
    out.shut = [w.getBlock(x + 14, y, z - 1) - ID.PLATE, w.getBlock(x + 14, y, z) - D];
    return out;
  }, { s: site, ID });
  assert(r.dust === 0 && (r.left === 15 || r.left === 16), `dust placed: ${JSON.stringify(r)}`);
  assert(r.torchOn.join() === "2,1" && r.torchOff.join() === "6,0", `torch: ${JSON.stringify(r)}`);
  assert(r.pressed === 9 && r.lampDuring === 1 && r.at1 === 9 && r.after.join() === "1,0", `button: ${JSON.stringify(r)}`);
  assert(r.door.join() === "1,4,12" && r.shut.join() === "0,0", `door: ${JSON.stringify(r)}`);
});

await check("in the game: flint and steel on TNT: it falls, flashes and explodes after 4 s with a crater, setting off the TNT beside it", async () => {
  const r = await v((g, { s, ID }) => {
    const T = window.__rs;
    const x = s.x + 4;
    const y = s.y;
    const z = s.z + 16;
    const w = g.world;
    w.setBlocks([x, y, z, ID.TNT, x + 2, y, z, ID.TNT, x - 1, y - 1, z + 3, 3]);
    T.run(1);
    const before = g.effects.explosionCount;
    T.use(ID.FLINT, [x + 0.5, y + 2.5, z - 2.5], [x + 0.5, y + 0.9, z + 0.5]);
    const out = { primed: g.redstone.tnt.length, block: w.getBlock(x, y, z), times: [] };
    out.rose = 0;
    for (let i = 0; i < 200 && out.times.length < 2; i++) {
      T.run(1, 0.05);
      if (i === 6) out.rose = g.redstone.tnt[0]?.y - y;
      while (g.effects.explosionCount - before > out.times.length) out.times.push((i + 1) * 0.05);
    }
    out.source = g.effects.lastExplosion?.source;
    out.crater = w.getBlock(x, y - 1, z) === 0 || w.getBlock(x, y - 2, z) === 0;
    out.second = w.getBlock(x + 2, y, z);
    out.left = g.redstone.tnt.length;
    return out;
  }, { s: site, ID });
  assert(r.primed === 1 && r.block === 0 && r.rose > 0.1, `primed and hopping: ${JSON.stringify(r)}`);
  assert(r.times.length === 2 && Math.abs(r.times[0] - 4) < 0.08, `the blast after 4 s: ${JSON.stringify(r)}`);
  assert(r.times[1] - r.times[0] >= 0.45 && r.times[1] - r.times[0] <= 1.55 && r.second === 0 && r.left === 0, `the chain: ${JSON.stringify(r)}`);
  assert(r.source === "tnt" && r.crater, `a crater: ${JSON.stringify(r)}`);
});

await check("in the game: a piston placed facing the player pushes a row of blocks when a lever behind it is thrown", async () => {
  const r = await v((g, { s, ID }) => {
    const T = window.__rs;
    const x = s.x + 2;
    const y = s.y;
    const z = s.z + 11;
    const w = g.world;
    // Placed from +X looking -X at the floor: it faces the player (+X).
    T.use(ID.PISTON, [x + 6.5, y + 1.6, z + 0.5], [x + 2.6, y - 0.01, z + 0.5]);
    const placed = w.getBlock(x + 2, y, z) - ID.PISTON;
    w.setBlocks([x + 3, y, z, 4, x + 4, y, z, 8, x + 5, y, z, 10, x + 1, y, z, ID.LEVER + 4]);
    T.run(1);
    T.use(null, [x + 1.5, y + 2.5, z - 1.5], [x + 1.5, y + 0.1, z + 0.5]);
    T.run(3);
    return { placed, row: [2, 3, 4, 5, 6].map((d) => w.getBlock(x + d, y, z)) };
  }, { s: site, ID });
  assert(r.placed === 0, `placed facing +X: ${JSON.stringify(r)}`);
  assert(r.row.join() === [I.PISTON + 6, I.PISTON_HEAD, 4, 8, 10].join(), `pushed: ${JSON.stringify(r)}`);
});

await check("every redstone shape meshes byte for byte the same in a worker and on the main thread; icons and item models build", async () => {
  const list = [
    W, W + 7, W + 15, I.REDSTONE_TORCH, I.REDSTONE_TORCH + 1, I.REDSTONE_WALL_TORCH + 1, I.REDSTONE_WALL_TORCH + 6, I.LEVER + 2, I.LEVER + 12, I.LEVER + 7, I.STONE_BUTTON + 4, I.OAK_BUTTON + 9,
    I.STONE_PRESSURE_PLATE, I.OAK_PRESSURE_PLATE + 1, I.REPEATER + 6, I.REPEATER + 29, I.PISTON + 2, I.STICKY_PISTON + 4, I.PISTON + 7, I.PISTON_HEAD + 1, I.TNT, I.NOTE_BLOCK + 4, I.REDSTONE_LAMP + 1, W + 3,
  ];
  const r = await v(async (g, { s, list }) => {
    const { meshChunk } = await import("./js/mesher.js");
    const B = await import("./js/blocks.js");
    const items = await import("./js/items.js");
    const T = await import("./js/textures.js");
    const { itemModel } = await import("./js/models.js");
    const w = g.world;
    const out = {};
    // Icons and models of every redstone block in the palette.
    const canv = {};
    for (const n of B.TILE_NAMES) {
      const c = document.createElement("canvas");
      c.width = 32;
      c.height = 32;
      c.getContext("2d").putImageData(new ImageData(new Uint8ClampedArray(T.paintTile(n)), 32, 32), 0, 0);
      canv[n] = c;
    }
    const ids = items.CREATIVE_ITEMS.filter((id) => id >= 1856 && id < 2048);
    out.palette = ids.length;
    out.blank = [];
    out.noModel = [];
    for (const id of ids) {
      const c = T.drawBlockIcon(canv, B.BLOCK_INFO[id], 32);
      const px = c.getContext("2d").getImageData(0, 0, 32, 32).data;
      let n = 0;
      for (let i = 3; i < px.length; i += 4) if (px[i] > 0) n++;
      if (n < 20) out.blank.push(id);
      const m = itemModel(id);
      if (!m || !m.geometry || m.geometry.getAttribute("position").count < 4) out.noModel.push(id);
    }
    if (!w._genWorkers || !w._genWorkers.length || !w.meshInWorkers) return { ...out, skipped: true };
    // A row of every shape on stone, across a chunk border.
    const bx = (s.x & ~15) + 15 - 6;
    const by = s.y + 3;
    const bz = s.z + 21;
    const edits = [];
    list.forEach((id, i) => edits.push(bx + (i % 12), by - 1 + 2 * Math.floor(i / 12), bz, 3, bx + (i % 12), by + 2 * Math.floor(i / 12), bz, id));
    w.setBlocks(edits);
    w.processQueues(50);
    const chunks = [w.getChunk(bx >> 4, bz >> 4), w.getChunk((bx + 12) >> 4, bz >> 4)].filter(Boolean);
    const got = new Map();
    const orig = w._applyMeshResult.bind(w);
    w._applyMeshResult = (m) => {
      got.set(m.token, m.buffers);
      return orig(m);
    };
    const want = new Map();
    for (const c of chunks) {
      const nb = [];
      for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) nb.push(w.getChunk(c.cx + dx, c.cz + dz) || null);
      const ref = meshChunk(nb, w.meshOptions);
      let slot = w._meshSlot();
      while (!slot) {
        await new Promise((res) => setTimeout(res, 20));
        w.processQueues(50);
        slot = w._meshSlot();
      }
      w._dispatchMesh(c, slot);
      want.set(c._meshToken, ref);
    }
    for (let i = 0; i < 500 && ![...want.keys()].every((k) => got.has(k)); i++) {
      await new Promise((res) => setTimeout(res, 20));
      w.processQueues(50);
    }
    w._applyMeshResult = orig;
    const eq = (a, b) => (!a && !b) || (a && b && a.length === b.length && a.every((x, i) => x === b[i]));
    out.asked = want.size;
    out.compared = 0;
    out.differing = 0;
    for (const [tok, ref] of want) {
      const m = got.get(tok);
      if (!m) continue;
      out.compared++;
      for (const k of ["opaque", "cutout", "water"]) {
        if (!ref[k] !== !m[k] || (ref[k] && !["position", "uv", "data", "extra", "index"].every((f) => eq(ref[k][f], m[k][f])))) {
          out.differing++;
          break;
        }
      }
    }
    return out;
  }, { s: site, list });
  assert(r.palette >= 11 && !r.blank.length && !r.noModel.length, `icons: ${JSON.stringify(r)}`);
  assert(r.skipped || (r.asked >= 2 && r.compared === r.asked && r.differing === 0), JSON.stringify(r));
});

await check("a save and a reload keep the circuits working: a lamp still lit, its lever still works, a button saved pressed is let out", async () => {
  const pos = await v((g, { s, ID }) => {
    const T = window.__rs;
    const x = s.x + 16;
    const y = s.y;
    const z = s.z + 2;
    const w = g.world;
    w.setBlocks([x, y, z, ID.LEVER + 13, x + 1, y, z, ID.W, x + 2, y, z, ID.W, x + 3, y, z, ID.LAMP, x, y, z + 3, ID.LAMP, x + 1, y, z + 3, ID.STONE_BUTTON + 5]);
    T.run(2);
    w.setBlock(x + 1, y, z + 3, ID.STONE_BUTTON + 13);
    T.run(1);
    const before = [w.getBlock(x + 3, y, z) - ID.LAMP, w.getBlock(x, y, z + 3) - ID.LAMP, w.getBlock(x + 1, y, z + 3) - ID.STONE_BUTTON];
    g.flushSave();
    return { x, y, z, before };
  }, { s: site, ID });
  assert(pos.before.join() === "1,1,13", `before: ${pos.before}`);
  await page.goto(URL_, { waitUntil: "load", timeout: 60000 });
  await boot();
  await play();
  const r = await v((g, { p, ID }) => {
    const T = window.__rs;
    const { x, y, z } = p;
    const w = g.world;
    w.prepareArea(x, z, 2);
    const out = { loaded: [w.getBlock(x, y, z) - ID.LEVER, w.getBlock(x + 3, y, z) - ID.LAMP, w.getBlock(x + 1, y, z) - ID.W] };
    // (the simulation looks through the loaded ground, then lets the button out)
    T.run(40);
    out.button = [w.getBlock(x + 1, y, z + 3) - ID.STONE_BUTTON, w.getBlock(x, y, z + 3) - ID.LAMP];
    w.setBlock(x, y, z, ID.LEVER + 5);
    T.run(4);
    out.off = [w.getBlock(x + 1, y, z) - ID.W, w.getBlock(x + 3, y, z) - ID.LAMP];
    w.setBlock(x, y, z, ID.LEVER + 13);
    T.run(2);
    out.on = [w.getBlock(x + 1, y, z) - ID.W, w.getBlock(x + 3, y, z) - ID.LAMP];
    return out;
  }, { p: pos, ID });
  assert(r.loaded.join() === "13,1,15", `loaded: ${JSON.stringify(r)}`);
  assert(r.button.join() === "5,0", `the button let out: ${JSON.stringify(r)}`);
  assert(r.off.join() === "0,0" && r.on.join() === "15,1", `the lever still works: ${JSON.stringify(r)}`);
});

await finish();

async function finish() {
  const failed = results.filter(([, ok]) => !ok).length;
  console.log(`\n${results.length - failed}/${results.length} passed`);
  await browser?.close().catch(() => {});
  server?.close();
  process.exit(failed ? 1 : 0);
}
