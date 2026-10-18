// Round 11 building-block tests (js/content/building.js): boots the real game
// in headless Chromium (software WebGL, Low preset) and checks, on a flat
// test floor near spawn: stairs placed facing away from the player and
// upside down on a side's upper half or under a block; vanilla stair corners
// (outer and inner) in the mesh and the collision; a slab onto its other
// half making the full block (not across kinds); a door placing both halves,
// a right click opening both, breaking either taking both and dropping one
// door, and the second of a pair hinged on the other side; fence, wall and
// pane connections; collision (a fence is 1.5 tall, a slab is stood on at
// half height); beds (two cells, the survival hook); a ladder and a hanging
// lantern coming off with their block; every shape meshed byte for byte the
// same in a worker and on the main thread; icons and item models for every
// building block; every building recipe's ingredients exist. Without a
// browser (Node): a Survival world's village has doors, beds and panes, a
// Missions world's has none of the new blocks.
//
//   node r11-building-tests.mjs [--only=substring] [--seed=42] [--nobrowser]
//
// Like the other suites, it fails on any console error or page error.
import http from "node:http";
import path from "node:path";
import fs from "node:fs";
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
const mod = (p) => import(pathToFileURL(path.join(ROOT, p)).href);

// ---------- Node: villages ----------
await check("a Survival world's village has oak doors (both halves, a pair hinged at the sides), beds and panes; a Missions world's none of the new blocks", async () => {
  const { TerrainGenerator } = await mod("js/terrain.js");
  const I = await mod("js/content/ids.js");
  const Bm = await mod("js/content/building.js");
  const findVillage = (t) => {
    for (let r = 1; r < 12; r++) {
      const list = t.villages._villagesNear(-r * 320, -r * 320, r * 320, r * 320);
      if (list.length) return list[0];
    }
    return null;
  };
  const vanilla = new TerrainGenerator(SEED, { sites: false });
  const missions = new TerrainGenerator(SEED, { sites: true });
  assert(vanilla.villages.vanilla && !missions.villages.vanilla, "the village growers' types");
  const v = findVillage(vanilla);
  assert(v, "no village found in the Survival world");
  const s = vanilla.villages.shape(v);
  const houses = vanilla.villages.layout(v).houses.length;
  // (the last entry at a cell wins, as placeInChunk writes them in order)
  const cells = new Map();
  for (let i = 0; i < s.length; i += 4) cells.set(`${s[i]},${s[i + 1]},${s[i + 2]}`, s[i + 3]);
  const isDoor = (id) => (id >= I.OAK_DOOR && id < I.OAK_DOOR + 16) || (id >= Bm.OAK_DOOR_RIGHT && id < Bm.OAK_DOOR_RIGHT + 16);
  let lowers = 0;
  let pairs = 0;
  let rights = 0;
  let beds = 0;
  let panes = 0;
  for (const [k, id] of cells) {
    const [x, y, z] = k.split(",").map(Number);
    if (id === I.GLASS_PANE) panes++;
    if (id >= I.RED_BED + 4 && id < I.RED_BED + 8) beds++;
    if (!isDoor(id) || (id - (id >= Bm.OAK_DOOR_RIGHT ? Bm.OAK_DOOR_RIGHT : I.OAK_DOOR)) >= 8) continue;
    lowers++;
    if (id >= Bm.OAK_DOOR_RIGHT) rights++;
    if (cells.get(`${x},${y + 1},${z}`) === id + 8) pairs++;
  }
  assert(lowers === houses * 2 && pairs === lowers && rights === houses, `doors: ${lowers} lower halves, ${pairs} with their upper, ${rights} hinged right, for ${houses} houses`);
  assert(beds >= 1 && panes >= houses, `beds ${beds}, panes ${panes}`);
  // A Missions world: the same village (where it has one there) without anything new.
  const m = missions.villages._villagesNear(v.x - 1, v.z - 1, v.x + 1, v.z + 1).find((c) => c.x === v.x && c.z === v.z) || findVillage(missions);
  assert(m, "no village found in the Missions world");
  const ms = missions.villages.shape(m);
  for (let i = 3; i < ms.length; i += 4) assert(ms[i] < 1024, `a Missions village holds block ${ms[i]}`);
});

if (args.nobrowser) await finish();

// ---------- The browser ----------
const PORT = 9840 + Math.floor(Math.random() * 40);
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
  // In-page helpers: aiming the player's eye at a point, a right click.
  await page.evaluate(() => {
    window.__tb = {
      aim(g, eye, at) {
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
      use(g, stackId, eye, at) {
        const inv = g.inventory;
        inv.selected = 0;
        inv.slots[0] = stackId ? window.__tb.stack(stackId, 16) : null;
        const t = window.__tb.aim(g, eye, at);
        g.interaction.mouseDown(2);
        g.interaction.mouseUp(2);
        return t ? { id: t.id, block: t.block, normal: t.normal } : null;
      },
      dropsOf(g, id) {
        return g.entities.items.filter((it) => it.id === id).reduce((n, it) => n + it.count, 0);
      },
    };
  });
  await v(async () => {
    const { makeStack } = await import("./js/inventory.js");
    window.__tb.stack = makeStack;
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
await page.goto(`http://localhost:${PORT}/index.html?seed=${SEED}`, { waitUntil: "load", timeout: 60000 });
await boot();
await play();

// A test site: a 24x20 stone floor near spawn with air above (built, so it is
// the same in every world), loaded and meshed: (x, y - 1, z) is the floor.
const site = await v(async (g) => {
  if (g.testFlags) g.testFlags.noMissions = true;
  g.setMode("survival");
  const w = g.world;
  const x = Math.floor(g.spawn.x) + 8;
  const z = Math.floor(g.spawn.z) + 8;
  w.prepareArea(x + 10, z + 8, 2);
  const y = Math.max(w.surfaceY(x, z) + 1, 34);
  const list = [];
  for (let ax = -2; ax <= 22; ax++) {
    for (let az = -4; az <= 18; az++) {
      list.push(x + ax, y - 1, z + az, 3);
      for (let ay = 0; ay <= 6; ay++) list.push(x + ax, y + ay, z + az, 0);
    }
  }
  w.setBlocks(list);
  w.processQueues(50);
  g.entities.items.length = 0;
  return { x, y, z };
});
const I = await mod("js/content/ids.js");
const Bm = await mod("js/content/building.js");

await check("stairs: facing away from the player; upside down on a side's upper half or under a block", async () => {
  const r = await v((g, { s, I }) => {
    const T = window.__tb;
    const { x, y, z } = s;
    const out = {};
    // On the floor, looking +Z: facing +Z (0), bottom half.
    T.use(g, I.OAK_STAIRS, [x + 0.5, y + 2.6, z - 2.5], [x + 0.5, y, z + 0.5]);
    out.floor = g.world.getBlock(x, y, z);
    // Looking -X at a block's side, upper half: facing -X (3), upside down.
    g.world.setBlock(x + 2, y, z, 3);
    T.use(g, I.OAK_STAIRS, [x + 5.5, y + 0.8, z + 0.5], [x + 3, y + 0.8, z + 0.5]);
    out.side = g.world.getBlock(x + 3, y, z);
    // The same side, lower half: right way up.
    g.world.setBlock(x + 2, y, z + 2, 3);
    T.use(g, I.OAK_STAIRS, [x + 5.5, y + 0.25, z + 2.5], [x + 3, y + 0.25, z + 2.5]);
    out.low = g.world.getBlock(x + 3, y, z + 2);
    // Under a block, looking -Z: facing -Z (1), upside down.
    g.world.setBlock(x + 5, y + 2, z, 3);
    T.use(g, I.COBBLESTONE_STAIRS, [x + 5.5, y + 0.6, z + 2.5], [x + 5.5, y + 2, z + 0.5]);
    out.under = g.world.getBlock(x + 5, y + 1, z);
    out.left = g.inventory.countItem(I.COBBLESTONE_STAIRS);
    return out;
  }, { s: site, I: { OAK_STAIRS: I.OAK_STAIRS, COBBLESTONE_STAIRS: I.COBBLESTONE_STAIRS } });
  assert(r.floor === I.OAK_STAIRS + 0, `on the floor: ${r.floor}`);
  assert(r.side === I.OAK_STAIRS + 3 + 4, `a side's upper half: ${r.side}`);
  assert(r.low === I.OAK_STAIRS + 3, `a side's lower half: ${r.low}`);
  assert(r.under === I.COBBLESTONE_STAIRS + 1 + 4 && r.left === 15, `under a block: ${JSON.stringify(r)}`);
});

await check("stair corners: an outer and an inner corner from the neighbours, in the collision too", async () => {
  const r = await v(async (g, { s, I }) => {
    const { boxInSolid } = await import("./js/physics.js");
    const { x, y, z } = s;
    const w = g.world;
    const bx = x + 8;
    const bz = z;
    // Outer: a stair facing +Z with one facing +X in front of it (its tall side).
    w.setBlocks([bx, y, bz, I.OAK_STAIRS + 0, bx, y, bz + 1, I.OAK_STAIRS + 2]);
    const solid = (px, py, pz) => boxInSolid(w, { x: px, y: py, z: pz }, 0.05, 0.05);
    const outer = { tallQuarter: solid(bx + 0.75, y + 0.7, bz + 0.75), emptyQuarter: solid(bx + 0.25, y + 0.7, bz + 0.75), back: solid(bx + 0.75, y + 0.7, bz + 0.25), slab: solid(bx + 0.25, y + 0.2, bz + 0.25) };
    // Inner: a stair facing +Z with one facing +X behind it (its low side).
    const ix = x + 11;
    w.setBlocks([ix, y, bz + 1, I.OAK_STAIRS + 0, ix, y, bz, I.OAK_STAIRS + 2]);
    const inner = { front: solid(ix + 0.25, y + 0.7, bz + 1.75), backRight: solid(ix + 0.75, y + 0.7, bz + 1.25), backLeft: solid(ix + 0.25, y + 0.7, bz + 1.25) };
    // A plain one: half its top empty.
    w.setBlock(x + 14, y, z, I.OAK_STAIRS + 0);
    const straight = { back: solid(x + 14.5, y + 0.7, z + 0.25), front: solid(x + 14.5, y + 0.7, z + 0.75) };
    return { outer, inner, straight };
  }, { s: site, I: { OAK_STAIRS: I.OAK_STAIRS } });
  const o = r.outer;
  assert(o.tallQuarter && !o.emptyQuarter && !o.back && o.slab, `outer corner: ${JSON.stringify(o)}`);
  const n = r.inner;
  assert(n.front && n.backRight && !n.backLeft, `inner corner: ${JSON.stringify(n)}`);
  assert(r.straight.front && !r.straight.back, `straight: ${JSON.stringify(r.straight)}`);
});

await check("slabs: one onto its other half (on its top, or into its cell from a side's upper half) is the full block; not across kinds", async () => {
  const r = await v((g, { s, I }) => {
    const T = window.__tb;
    const { x, y } = s;
    const z = s.z + 4;
    const w = g.world;
    const out = {};
    T.use(g, I.OAK_SLAB, [x + 0.5, y + 2.6, z - 2.5], [x + 0.5, y, z + 0.5]);
    out.placed = w.getBlock(x, y, z);
    T.use(g, I.OAK_SLAB, [x + 0.5, y + 2.6, z - 2.5], [x + 0.5, y + 0.5, z + 0.5]);
    out.stacked = w.getBlock(x, y, z);
    out.above = w.getBlock(x, y + 1, z);
    // Into a bottom slab's cell from the upper half of the block beside it.
    w.setBlocks([x + 3, y, z, I.OAK_SLAB, x + 4, y, z, 3]);
    T.use(g, I.OAK_SLAB, [x + 1.2, y + 0.75, z + 0.5], [x + 4, y + 0.75, z + 0.5]);
    out.side = w.getBlock(x + 3, y, z);
    // A stone slab under an oak one: the oak one goes on top.
    w.setBlock(x + 6, y, z, I.STONE_SLAB);
    T.use(g, I.OAK_SLAB, [x + 6.5, y + 2.6, z - 2.5], [x + 6.5, y + 0.5, z + 0.5]);
    out.mixed = [w.getBlock(x + 6, y, z), w.getBlock(x + 6, y + 1, z)];
    // A top slab, placed under a block, and one more from below: the full block.
    w.setBlock(x + 8, y + 2, z, 3);
    T.use(g, I.STONE_SLAB, [x + 8.5, y + 0.4, z - 1.5], [x + 8.5, y + 2, z + 0.5]);
    out.top = w.getBlock(x + 8, y + 1, z);
    T.use(g, I.STONE_SLAB, [x + 8.5, y + 0.3, z + 0.2], [x + 8.5, y + 1.5, z + 0.5]);
    out.topStacked = w.getBlock(x + 8, y + 1, z);
    return out;
  }, { s: site, I: { OAK_SLAB: I.OAK_SLAB, STONE_SLAB: I.STONE_SLAB } });
  assert(r.placed === I.OAK_SLAB && r.stacked === 8 && r.above === 0, `on its top: ${JSON.stringify(r)}`);
  assert(r.side === 8, `into its cell from the side: ${r.side}`);
  assert(r.mixed[0] === I.STONE_SLAB && r.mixed[1] === I.OAK_SLAB, `across kinds: ${r.mixed}`);
  assert(r.top === I.STONE_SLAB + 1 && r.topStacked === 3, `a top slab and its bottom half: ${r.top}, ${r.topStacked}`);
});

await check("doors: placing puts both halves, a right click opens both, breaking either takes both and drops one door; a pair's second is hinged right", async () => {
  const r = await v((g, { s, I }) => {
    const T = window.__tb;
    const { x, y } = s;
    const z = s.z + 8;
    const w = g.world;
    const out = {};
    T.use(g, I.OAK_DOOR, [x + 0.5, y + 1.6, z - 2], [x + 0.5, y, z + 0.5]);
    out.placed = [w.getBlock(x, y, z), w.getBlock(x, y + 1, z)];
    out.left = g.inventory.countItem(I.OAK_DOOR);
    // The second of a pair, on the first's right (looking +Z: -X).
    T.use(g, I.OAK_DOOR, [x - 0.5, y + 1.6, z - 2], [x - 0.5, y, z + 0.5]);
    out.pair = [w.getBlock(x - 1, y, z), w.getBlock(x - 1, y + 1, z)];
    // A right click on the upper half opens both halves.
    T.use(g, null, [x + 0.5, y + 1.5, z - 2], [x + 0.5, y + 1.5, z + 0.5]);
    out.opened = [w.getBlock(x, y, z), w.getBlock(x, y + 1, z)];
    // Breaking the upper half (survival): both go, one door drops.
    g.entities.items.length = 0;
    g.interaction._breakBlock(x, y + 1, z, w.getBlock(x, y + 1, z), true);
    out.broken = [w.getBlock(x, y, z), w.getBlock(x, y + 1, z)];
    out.dropped = T.dropsOf(g, I.OAK_DOOR);
    // The pair's lower half: both go, one door.
    g.entities.items.length = 0;
    g.interaction._breakBlock(x - 1, y, z, w.getBlock(x - 1, y, z), true);
    out.broken2 = [w.getBlock(x - 1, y, z), w.getBlock(x - 1, y + 1, z)];
    out.dropped2 = T.dropsOf(g, I.OAK_DOOR);
    // An iron door: a right click does nothing; setDoorOpen (redstone) opens it.
    w.setBlocks([x + 3, y, z, I.IRON_DOOR, x + 3, y + 1, z, I.IRON_DOOR + 8]);
    T.use(g, null, [x + 3.5, y + 0.5, z - 2], [x + 3.5, y + 0.5, z + 0.5]);
    out.iron = w.getBlock(x + 3, y, z);
    return out;
  }, { s: site, I: { OAK_DOOR: I.OAK_DOOR, IRON_DOOR: I.IRON_DOOR } });
  assert(r.placed[0] === I.OAK_DOOR && r.placed[1] === I.OAK_DOOR + 8 && r.left === 15, `placed: ${JSON.stringify(r)}`);
  assert(r.pair[0] === Bm.OAK_DOOR_RIGHT && r.pair[1] === Bm.OAK_DOOR_RIGHT + 8, `the pair's second: ${r.pair}`);
  assert(r.opened[0] === I.OAK_DOOR + 4 && r.opened[1] === I.OAK_DOOR + 12, `opened: ${r.opened}`);
  assert(r.broken[0] === 0 && r.broken[1] === 0 && r.dropped === 1, `broken from the top: ${r.broken} dropping ${r.dropped}`);
  assert(r.broken2[0] === 0 && r.broken2[1] === 0 && r.dropped2 === 1, `broken from the bottom: ${r.broken2} dropping ${r.dropped2}`);
  assert(r.iron === I.IRON_DOOR, `an iron door opened by hand: ${r.iron}`);
  const p = await v(async (g, { s, I }) => {
    const B = await import("./js/content/building.js");
    const z = s.z + 8;
    B.setDoorOpen(g.world, s.x + 3, s.y + 1, z, true);
    return [g.world.getBlock(s.x + 3, s.y, z), g.world.getBlock(s.x + 3, s.y + 1, z)];
  }, { s: site, I: { IRON_DOOR: I.IRON_DOOR } });
  assert(p[0] === I.IRON_DOOR + 4 && p[1] === I.IRON_DOOR + 12, `setDoorOpen: ${p}`);
});

await check("fences join fences, gates across them and blocks; a fence is 1.5 tall; a gate opens to walk through; a slab is stood on at half height", async () => {
  const r = await v(async (g, { s, I }) => {
    const { boxInSolid, sweepAxis } = await import("./js/physics.js");
    const T = window.__tb;
    const { x, y } = s;
    const z = s.z + 12;
    const w = g.world;
    w.setBlocks([x, y, z, I.OAK_FENCE, x + 1, y, z, I.OAK_FENCE, x, y, z + 1, 3, x + 2, y, z, I.OAK_FENCE_GATE]);
    const solid = (px, py, pz, r = 0.05) => boxInSolid(w, { x: px, y: py, z: pz }, r, 0.05);
    const out = {
      armX: solid(x + 1, y + 0.5, z + 0.5), // (between the two fences)
      armZ: solid(x + 0.5, y + 0.5, z + 0.95), // (toward the block)
      noArm: solid(x + 0.5, y + 0.5, z + 0.05), // (nothing on -Z)
      tall: solid(x + 0.5, y + 1.4, z + 0.5),
      above: solid(x + 0.5, y + 1.56, z + 0.5),
      gateJoin: solid(x + 1.95, y + 0.5, z + 0.5),
    };
    // Dropped onto the fence from above: it lands at 1.5.
    const pos = { x: x + 0.5, y: y + 3, z: z + 0.5 };
    pos.y += sweepAxis(w, pos, 0.3, 1.8, "y", -5);
    out.landed = pos.y - y;
    // Onto a bottom slab: at 0.5.
    w.setBlock(x + 6, y, z, I.OAK_SLAB);
    const p2 = { x: x + 6.5, y: y + 3, z: z + 0.5 };
    p2.y += sweepAxis(w, p2, 0.3, 1.8, "y", -5);
    out.slab = p2.y - y;
    // The gate: closed it blocks, a right click opens it, then it's walked through.
    out.gateClosed = solid(x + 2.5, y + 0.5, z + 0.5);
    T.use(g, null, [x + 2.5, y + 1.6, z - 2], [x + 2.5, y + 0.6, z + 0.5]);
    out.gateId = w.getBlock(x + 2, y, z);
    out.gateOpen = solid(x + 2.5, y + 0.5, z + 0.5);
    return out;
  }, { s: site, I: { OAK_FENCE: I.OAK_FENCE, OAK_FENCE_GATE: I.OAK_FENCE_GATE, OAK_SLAB: I.OAK_SLAB } });
  assert(r.armX && r.armZ && !r.noArm && r.gateJoin, `arms: ${JSON.stringify(r)}`);
  assert(r.tall && !r.above && Math.abs(r.landed - 1.5) < 0.01, `1.5 tall: ${JSON.stringify(r)}`);
  assert(Math.abs(r.slab - 0.5) < 0.01, `on a slab at ${r.slab}`);
  assert(r.gateClosed && !r.gateOpen && r.gateId >= I.OAK_FENCE_GATE + 4 && r.gateId < I.OAK_FENCE_GATE + 8, `the gate: ${JSON.stringify(r)}`);
});

await check("a bed takes two cells (foot where placed, head beyond), calls LIB.onBedUse, and breaking either half takes both for one bed", async () => {
  const r = await v(async (g, { s, I }) => {
    const { LIB } = await import("./js/content/base.js");
    const T = window.__tb;
    const x = s.x + 16;
    const { y, z } = s;
    const w = g.world;
    T.use(g, I.RED_BED, [x + 0.5, y + 2.2, z - 2], [x + 0.5, y, z + 0.5]);
    const out = { foot: w.getBlock(x, y, z), head: w.getBlock(x, y, z + 1) };
    let got = null;
    const before = LIB.onBedUse;
    LIB.onBedUse = (ctx) => ((got = ctx.bed), true);
    try {
      T.use(g, null, [x + 0.5, y + 2.2, z - 2], [x + 0.5, y + 0.5, z + 0.5]);
    } finally {
      LIB.onBedUse = before;
    }
    out.bed = got;
    g.entities.items.length = 0;
    g.interaction._breakBlock(x, y, z + 1, w.getBlock(x, y, z + 1), true);
    out.after = [w.getBlock(x, y, z), w.getBlock(x, y, z + 1)];
    out.dropped = T.dropsOf(g, I.RED_BED);
    // Looking +X: the head on +X.
    T.use(g, I.RED_BED, [x - 2, y + 2.2, z + 3.5], [x + 0.5, y, z + 3.5]);
    out.east = [w.getBlock(x, y, z + 3), w.getBlock(x + 1, y, z + 3)];
    return out;
  }, { s: site, I: { RED_BED: I.RED_BED } });
  const x = site.x + 16;
  assert(r.foot === I.RED_BED + 0 && r.head === I.RED_BED + 4, `placed: ${JSON.stringify(r)}`);
  assert(r.bed && r.bed.foot.join() === [x, site.y, site.z].join() && r.bed.head.join() === [x, site.y, site.z + 1].join() && r.bed.facing.join() === "0,1", `the hook: ${JSON.stringify(r.bed)}`);
  assert(r.after[0] === 0 && r.after[1] === 0 && r.dropped === 1, `broken: ${JSON.stringify(r)}`);
  assert(r.east[0] === I.RED_BED + 2 && r.east[1] === I.RED_BED + 6, `facing +X: ${r.east}`);
});

await check("a ladder goes on a wall's side (climbable) and comes off with it; a lantern hangs under a block and comes off with it", async () => {
  const r = await v(async (g, { s, I, H }) => {
    const B = await import("./js/blocks.js");
    const T = window.__tb;
    const x = s.x + 19;
    const { y } = s;
    const z = s.z + 4;
    const w = g.world;
    w.setBlock(x, y, z, 3);
    T.use(g, I.LADDER, [x + 0.5, y + 0.5, z - 2.5], [x + 0.5, y + 0.5, z]);
    const out = { ladder: w.getBlock(x, y, z - 1), climbable: !!B.BLOCK_INFO[I.LADDER + 1].climbable };
    T.use(g, I.LADDER, [x + 0.5, y + 2.6, z - 3.5], [x + 0.5, y, z - 2.5]); // (on the floor: no)
    out.floor = w.getBlock(x, y, z - 3);
    g.entities.items.length = 0;
    g.interaction._breakBlock(x, y, z, 3, true);
    out.ladderAfter = w.getBlock(x, y, z - 1);
    out.ladderDrop = T.dropsOf(g, I.LADDER);
    // A lantern under a block.
    w.setBlock(x, y + 3, z + 4, 3);
    T.use(g, I.LANTERN, [x + 0.5, y + 0.8, z + 2.5], [x + 0.5, y + 3, z + 4.5]);
    out.lantern = w.getBlock(x, y + 2, z + 4);
    out.light = w.lightAt(x, y + 2, z + 4).block;
    g.entities.items.length = 0;
    g.interaction._breakBlock(x, y + 3, z + 4, 3, true);
    out.lanternAfter = w.getBlock(x, y + 2, z + 4);
    out.lanternDrop = T.dropsOf(g, I.LANTERN);
    return out;
  }, { s: site, I: { LADDER: I.LADDER, LANTERN: I.LANTERN } });
  assert(r.ladder === I.LADDER + 1 && r.climbable && r.floor === 0, `placed: ${JSON.stringify(r)}`);
  assert(r.ladderAfter === 0 && r.ladderDrop === 1, `the wall went: ${JSON.stringify(r)}`);
  assert(r.lantern === Bm.LANTERN_HANGING && r.light === 15, `the lantern: ${JSON.stringify(r)}`);
  assert(r.lanternAfter === 0 && r.lanternDrop === 1, `its block went: ${JSON.stringify(r)}`);
});

await check("every building shape meshes byte for byte the same in a worker and on the main thread", async () => {
  const r = await v(async (g, { s, list }) => {
    const { meshChunk } = await import("./js/mesher.js");
    const w = g.world;
    if (!w._genWorkers || !w._genWorkers.length || !w.meshInWorkers) return { skipped: true };
    // A row of every shape (with neighbours to join), across a chunk border.
    const bx = (s.x & ~15) + 15 - 6;
    const edits = [];
    list.forEach((id, i) => edits.push(bx + (i % 12), s.y + 2 + Math.floor(i / 12), s.z + 16, id));
    w.setBlocks(edits);
    w.processQueues(50);
    const chunks = [w.getChunk(bx >> 4, (s.z + 16) >> 4), w.getChunk((bx + 12) >> 4, (s.z + 16) >> 4)].filter(Boolean);
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
    let compared = 0;
    let differing = 0;
    for (const [tok, ref] of want) {
      const m = got.get(tok);
      if (!m) continue;
      compared++;
      for (const k of ["opaque", "cutout", "water"]) {
        if (!ref[k] !== !m[k] || (ref[k] && !["position", "uv", "data", "extra", "index"].every((f) => eq(ref[k][f], m[k][f])))) {
          differing++;
          break;
        }
      }
    }
    return { asked: want.size, compared, differing, cutout: !!want.values().next().value?.cutout };
  }, {
    s: site,
    list: [
      I.OAK_STAIRS, I.OAK_STAIRS + 2, I.OAK_STAIRS + 5, I.STONE_STAIRS + 1, I.OAK_SLAB, I.OAK_SLAB + 1, I.SMOOTH_STONE_SLAB, I.OAK_FENCE, I.OAK_FENCE, I.OAK_FENCE_GATE, I.OAK_FENCE_GATE + 5, I.COBBLESTONE_WALL,
      I.COBBLESTONE_WALL, I.GLASS_PANE, I.GLASS_PANE, I.IRON_BARS, I.OAK_DOOR + 1, I.OAK_DOOR + 9, Bm.OAK_DOOR_RIGHT + 6, I.OAK_TRAPDOOR, I.IRON_TRAPDOOR + 12, I.LADDER + 1, I.RED_BED + 2, I.RED_BED + 6,
      I.LANTERN, Bm.LANTERN_HANGING, I.WHITE_CARPET + 3, I.STONE_BRICKS, I.BOOKSHELF, I.SANDSTONE,
    ],
  });
  assert(r.skipped || (r.asked >= 2 && r.compared === r.asked && r.differing === 0), JSON.stringify(r));
});

await check("icons and 3D item models build for every building block; every building recipe's ingredients and results exist", async () => {
  const r = await v(async (g) => {
    const B = await import("./js/blocks.js");
    const items = await import("./js/items.js");
    const T = await import("./js/textures.js");
    const { itemModel } = await import("./js/models.js");
    const { recipes } = await import("./js/content/index.js");
    const canv = {};
    for (const n of B.TILE_NAMES) {
      const c = document.createElement("canvas");
      c.width = 32;
      c.height = 32;
      c.getContext("2d").putImageData(new ImageData(new Uint8ClampedArray(T.paintTile(n)), 32, 32), 0, 0);
      canv[n] = c;
    }
    const ids = items.CREATIVE_ITEMS.filter((id) => id >= 1024 && id < 1536);
    let blank = [];
    let noModel = [];
    for (const id of ids) {
      const c = T.drawBlockIcon(canv, B.BLOCK_INFO[id], 32);
      const px = c.getContext("2d").getImageData(0, 0, 32, 32).data;
      let n = 0;
      for (let i = 3; i < px.length; i += 4) if (px[i] > 0) n++;
      if (n < 20) blank.push(id);
      const m = itemModel(id);
      if (!m || !m.geometry || m.geometry.getAttribute("position").count < 4) noModel.push(id);
    }
    const missing = [];
    let count = 0;
    for (const rc of recipes().filter((x) => x.module === "building")) {
      count++;
      const ing = [];
      if (rc.key) for (const k of Object.values(rc.key)) ing.push(...[].concat(k));
      if (rc.ingredients) for (const k of rc.ingredients) ing.push(...[].concat(k));
      if (rc.input !== undefined) ing.push(...[].concat(rc.input));
      if (rc.result) ing.push(rc.result[0]);
      for (const id of ing) if (!items.itemInfo(id)) missing.push(`${rc.type}:${id}`);
    }
    return { n: ids.length, blank, noModel, count, missing: [...new Set(missing)] };
  });
  assert(r.n > 130 && !r.blank.length && !r.noModel.length, JSON.stringify(r));
  assert(r.count > 100 && !r.missing.length, `recipes: ${JSON.stringify(r)}`);
});

await finish();

async function finish() {
  const failed = results.filter(([, ok]) => !ok).length;
  console.log(`\n${results.length - failed}/${results.length} passed`);
  await browser?.close().catch(() => {});
  server?.close();
  process.exit(failed ? 1 : 0);
}
