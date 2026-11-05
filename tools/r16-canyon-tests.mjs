// Round 16 canyon run tests (track B, "Canyon"): the run's new options and
// fixes (js/canyon.js, js/dim-canyon.js, js/canyon-biomes.js,
// js/canyon-bots.js, js/menu-canyon.js).
// In Node (fast): the options ride in the seed and come back out; no ring
// speeds the jet up (no boost rings); every biome generates its own blocks
// (and a mixed course passes through several), quickly; the difficulties'
// widths are in order (Easy comfortably wide) and every one is flyable end
// to end; open stretches (a valley, space with its asteroids) are there
// when asked for and not when not; the enemy jets' safe line runs the whole
// course.
// In the browser: the canyon screen's options reach the run's address; a
// run's page with options (Easy, Frozen pass, enemy jets, lots of open
// stretches) is that canyon; flying through a checkpoint doesn't change
// the speed; a crash brings the jet back at the last checkpoint (Enter, or
// by itself), the clock running on; "Restart the course" mode ends the run
// instead; enemy jets spawn, fly the canyon without hitting the rock, shoot
// the player and are shot down (kills counted), and shoot the player down
// (back at the checkpoint); space (black sky, stars, asteroids) and a
// valley; leaving the course's line there; graphics High and Low; no
// console errors.
//
//   node r16-canyon-tests.mjs [--only=substring] [--node]
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

// ---------- Node ----------

const C = await imp("js/dim-canyon.js");
const BIO = await imp("js/canyon-biomes.js");
const IDS = await imp("js/content/ids.js");
const { BLOCK } = await imp("js/content/base.js");

// The blocks of a stretch of course (chunks across the canyon every few rows).
function census(gen, z0, z1, step = 5) {
  const counts = new Map();
  const c = gen.course;
  let chunks = 0;
  let ms = 0;
  for (let cz = Math.floor(z0 / 16); cz <= Math.floor(z1 / 16); cz += step) {
    const row = c.row(cz * 16 + 8);
    const lo = Math.max(Math.floor(row.xMin / 16), Math.floor((row.xc - 140) / 16));
    const hi = Math.min(Math.floor(row.xMax / 16), Math.floor((row.xc + 140) / 16));
    for (let cx = lo; cx <= hi; cx++) {
      const blocks = new Uint16Array(16 * 16 * 128);
      const t0 = performance.now();
      gen.generate({ cx, cz, blocks });
      ms += performance.now() - t0;
      chunks++;
      for (const b of blocks) if (b) counts.set(b, (counts.get(b) || 0) + 1);
    }
  }
  return { counts, ms: ms / Math.max(1, chunks), chunks, has: (id) => (counts.get(id) || 0) > 0, n: (id) => counts.get(id) || 0 };
}

await check("the options ride in the world's seed and come back out", async () => {
  for (const course of C.CANYON_COURSES) {
    for (const diff of BIO.DIFF_ORDER) {
      for (const biome of [null, ...BIO.BIOME_ORDER, "mixed"]) {
        for (const open of [null, "none", "some", "lots"]) {
          const seed = C.canyonSeed(course.seed, { biome, diff, open });
          const s = C.courseOf(seed);
          assert(s.id === course.id && s.diff === diff && s.biome === (biome || course.biome) && s.open === (open || "some"), `${course.id} ${diff} ${biome} ${open}: ${JSON.stringify(s)}`);
          assert(seed < 2 ** 31, "the seed stays a positive 31-bit number");
        }
      }
    }
  }
  // (Round 17) The Space scenery rides in a bit of its own.
  for (const course of C.CANYON_COURSES) {
    const s = C.courseOf(C.canyonSeed(course.seed, { biome: C.BIOME_SPACE, diff: "hard", open: "lots" }));
    assert(s.id === course.id && s.space === true && s.diff === "hard" && s.biome === course.biome, `space: ${JSON.stringify(s)}`);
    assert(!C.courseOf(C.canyonSeed(course.seed, { biome: "mixed" })).space, "mixed is not space");
  }
  // (the defaults: the course's own seed, as in Round 15)
  assert(C.canyonSeed(1515001, {}) === 1515001, "the default options are the course's own seed");
});

await check("no boost rings: no ring on any course speeds the jet up", async () => {
  for (const course of C.CANYON_COURSES) {
    for (const diff of BIO.DIFF_ORDER) {
      const c = new C.CanyonCourse(C.canyonSeed(course.seed, { diff }));
      const kinds = new Set(c.rings().map((r) => r.kind));
      assert(!kinds.has("boost"), `${course.id} ${diff}: a boost ring`);
      assert(kinds.has("start") && kinds.has("check") && kinds.has("finish"), `${course.id}: ${[...kinds]}`);
    }
  }
  const src = fs.readFileSync(path.join(ROOT, "js/canyon.js"), "utf8");
  assert(!/addScaledVector\(f, BOOST\)|const BOOST =/.test(src), "the run still has a boost");
});

await check("every biome generates its own rock, ground, river and plants (and quickly)", async () => {
  const want = {
    mesa: { rock: [IDS.RED_TERRACOTTA, IDS.ORANGE_TERRACOTTA], top: IDS.RED_SAND, river: BLOCK.WATER },
    desert: { rock: [IDS.SMOOTH_SANDSTONE, IDS.CUT_SANDSTONE], top: BLOCK.SAND, river: BLOCK.WATER, plant: BLOCK.CACTUS },
    green: { rock: [BLOCK.STONE, IDS.MOSSY_COBBLESTONE], top: BLOCK.GRASS, river: BLOCK.WATER, plant: BLOCK.TALL_GRASS, tree: BLOCK.WOOD },
    grey: { rock: [BLOCK.STONE, IDS.ANDESITE], top: BLOCK.STONE, river: BLOCK.WATER, not: [IDS.RED_TERRACOTTA, BLOCK.GRASS] },
    snow: { rock: [BLOCK.STONE, IDS.PACKED_ICE], top: BLOCK.SNOW, river: IDS.ICE, plant: IDS.SNOW_LAYER + 1, tree: BLOCK.PINE_LOG },
    volcanic: { rock: [IDS.BASALT, IDS.BLACKSTONE, IDS.MAGMA_BLOCK], top: IDS.BLACKSTONE, river: IDS.LAVA, not: [BLOCK.WATER] },
  };
  for (const id of BIO.BIOME_ORDER) {
    const gen = new C.CanyonGenerator(C.canyonSeed(1515001, { biome: id === "mesa" ? null : id, open: "none" }));
    assert(gen.course.spec.biome === id, `${id}: the course's biome ${gen.course.spec.biome}`);
    const s = census(gen, 300, 3200, 6);
    const w = want[id];
    for (const b of w.rock) assert(s.has(b), `${id}: no block ${b} in its walls`);
    assert(s.has(w.top), `${id}: no ${w.top} on top`);
    assert(s.has(w.river), `${id}: no river of ${w.river}`);
    if (w.plant) assert(s.has(w.plant), `${id}: no ${w.plant}`);
    if (w.tree) assert(s.has(w.tree), `${id}: no trees`);
    for (const b of w.not || []) assert(!s.has(b), `${id}: ${b} doesn't belong`);
    assert(s.ms < 8, `${id}: ${s.ms.toFixed(2)} ms a chunk`);
    console.log(`        ${id}: ${s.chunks} chunks, ${s.ms.toFixed(2)} ms a chunk`);
  }
});

await check("a mixed course passes through several biomes, blended at the edges", async () => {
  const c = new C.CanyonCourse(C.canyonSeed(1515001, { biome: "mixed" }));
  const seen = new Set();
  let blended = 0;
  for (let z = 0; z < c.length; z += 50) {
    const b = c.biomeAt(z);
    seen.add(b.a);
    seen.add(b.b);
    if (b.t > 0 && b.t < 1) blended++;
  }
  assert(seen.size >= 4, `only ${[...seen]}`);
  assert(blended > 0, "no blend between two biomes");
  // (The Gauntlet is a mixed course of its own.)
  assert(new C.CanyonCourse(1515004).biomes.length >= 4, "The Gauntlet: one biome");
  // (and the same course in another scenery winds the same way)
  const a = new C.CanyonCourse(C.canyonSeed(1515001, { biome: "snow" }));
  const b = new C.CanyonCourse(C.canyonSeed(1515001, { biome: "volcanic" }));
  for (let z = 0; z < 15000; z += 500) assert(Math.abs(a.centerX(z) - b.centerX(z)) < 1e-6 && a.halfWidth(z) === b.halfWidth(z), `another scenery, another canyon at ${z}`);
});

// The canyon's widths at mid height (the open stretches left out).
function widths(c) {
  const ws = [];
  for (let z = 100; z < c.length - 100; z += 20) {
    const r = c.row(z);
    if (r.space || r.valley > 0) continue;
    let narrow = Infinity;
    for (let y = r.floor + 14; y < Math.min(r.rim, r.ceil) - 12; y += 4) narrow = Math.min(narrow, r.R[y] - r.L[y]);
    if (Number.isFinite(narrow)) ws.push(narrow);
  }
  ws.sort((a, b) => a - b);
  return { min: ws[0], p10: ws[Math.floor(ws.length * 0.1)], avg: ws.reduce((a, b) => a + b, 0) / ws.length };
}

await check("difficulty: the widths are in order (Easy wide open, Insane a crack), every level flyable end to end", async () => {
  for (const course of C.CANYON_COURSES) {
    const w = {};
    for (const diff of BIO.DIFF_ORDER) {
      const c = new C.CanyonCourse(C.canyonSeed(course.seed, { diff }));
      w[diff] = widths(c);
      // every 25 blocks a gap a jet fits through (Insane: a tighter one)
      const need = diff === "insane" ? 13 : 16;
      for (let z = -200; z <= c.length + 100; z += 25) {
        const row = c.row(z);
        let ok = false;
        for (let y = row.floor + 5; y < Math.max(row.hi, Math.min(row.rim - 4, row.ceil - 4)) && !ok; y += 3) {
          let run = 0;
          for (let x = Math.floor(Math.min(row.xMin, row.xc - 100)) - 2; x <= Math.ceil(Math.max(row.xMax, row.xc + 100)) + 2 && !ok; x++) {
            run = !c.solidAt(x, y, z) && !c.solidAt(x, y + 5, z) && !c.solidAt(x, y - 5, z) ? run + 1 : 0;
            if (run >= need) ok = true;
          }
        }
        assert(ok, `${course.id} ${diff}: no way through at z ${z}`);
      }
      for (const r of c.rings()) assert(!c.solidAt(r.x, r.y, r.z), `${course.id} ${diff}: ring ${r.i} in the rock`);
    }
    const s = BIO.DIFF_ORDER.map((d) => `${d} ${w[d].p10.toFixed(0)}/${w[d].avg.toFixed(0)}`).join(", ");
    console.log(`        ${course.id} (narrowest 10% / average, blocks): ${s}`);
    assert(w.easy.avg > w.normal.avg && w.normal.avg > w.hard.avg && w.hard.avg > w.insane.avg, `${course.id}: averages out of order`);
    assert(w.easy.p10 > w.normal.p10 && w.normal.p10 > w.hard.p10 && w.hard.p10 > w.insane.p10, `${course.id}: narrow spots out of order`);
    assert(w.easy.min >= 44, `${course.id}: Easy's narrowest ${w.easy.min.toFixed(1)} (not comfortably wide)`);
  }
});

// (Round 17) Open stretches are valleys only; space is the Space scenery (the whole run).
await check("open stretches: valleys only (never space) when asked for, none when not; the Space scenery: the whole run among asteroids", async () => {
  for (const course of C.CANYON_COURSES) {
    const none = new C.CanyonCourse(C.canyonSeed(course.seed, { open: "none" }));
    assert(none.opens.length === 0 && none.rocks.length === 0, `${course.id}: open stretches with "none"`);
    const some = new C.CanyonCourse(course.seed);
    assert(some.opens.length >= 1, `${course.id}: no open stretch by default`);
    const lots = new C.CanyonCourse(C.canyonSeed(course.seed, { open: "lots" }));
    assert(lots.opens.length > some.opens.length || lots.opens.length >= 3, `${course.id}: lots ${lots.opens.length} vs some ${some.opens.length}`);
    for (const k of [some, lots]) assert(k.opens.every((o) => o.kind === "valley") && k.rocks.length === 0, `${course.id}: space between the canyons`);
    const sp = new C.CanyonCourse(C.canyonSeed(course.seed, { biome: C.BIOME_SPACE }));
    assert(sp.spec.space && sp.opens.length === 1 && sp.opens[0].kind === "space" && sp.opens[0].z1 - sp.opens[0].z0 > sp.length - 700, `${course.id}: the Space scenery ${JSON.stringify(sp.opens)}`);
  }
  assert(!BIO.BIOME_ORDER.includes("space"), "Mixed or Random could pick space");
  const gen = new C.CanyonGenerator(C.canyonSeed(1515001, { biome: C.BIOME_SPACE }));
  const c = gen.course;
  const space = c.opens.find((o) => o.kind === "space");
  const valley = new C.CanyonCourse(C.canyonSeed(1515001, { open: "lots" })).opens.find((o) => o.kind === "valley");
  assert(space && valley, `kinds: ${c.opens.map((o) => o.kind)}`);
  // Space: the canyon gone (no wall, no floor), asteroids to dodge, rings among them.
  const mid = Math.round((space.z0 + space.z1) / 2);
  const row = c.row(mid);
  let solid = 0;
  let rock = 0;
  const s = census(gen, Math.max(space.z0 + 40, mid - 500), Math.min(space.z1 - 40, mid + 500), 2);
  for (const [id, n] of s.counts) {
    solid += n;
    if ([IDS.BLACKSTONE, IDS.BASALT, IDS.ANDESITE, BLOCK.COBBLESTONE, BLOCK.LUMEN, IDS.MAGMA_BLOCK].includes(id)) rock += n;
  }
  assert(rock > 200 && rock / solid > 0.9, `space: ${rock} of ${solid} blocks are asteroids`);
  assert(c.rocks.filter((r) => r.z > space.z0 && r.z < space.z1).length > 20, "too few asteroids");
  assert(!c.solidAt(row.xc - 60, 6, mid) || c.row(mid).rocks.length, "the floor goes on into space");
  const inSpace = c.rings().filter((r) => r.z > space.z0 && r.z < space.z1);
  assert(inSpace.length >= 1, "no ring in space");
  // A valley: wide, low walls.
  const vm = new C.CanyonCourse(C.canyonSeed(1515001, { open: "lots" })).row(Math.round((valley.z0 + valley.z1) / 2));
  assert(vm.valley > 0.99 && vm.W >= 95 && vm.rim < vm.floor + 20, `the valley: W ${vm.W} rim ${vm.rim} floor ${vm.floor}`);
});

await check("the enemy jets' line: a way through all along every course", async () => {
  for (const course of C.CANYON_COURSES) {
    for (const diff of ["easy", "insane"]) {
      const c = new C.CanyonCourse(C.canyonSeed(course.seed, { diff, open: "lots" }));
      let blocked = 0;
      let n = 0;
      for (let z = 0; z < c.length; z += 8) {
        n++;
        if (c.safePoint(z).blocked) blocked++;
      }
      assert(blocked / n < 0.01, `${course.id} ${diff}: ${blocked} of ${n} points blocked`);
    }
  }
});

if (!args.node) await browserChecks();

async function browserChecks() {
  const { chromium } = await import("playwright-core");
  const PORT = 9930 + Math.floor(Math.random() * 25);
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
  const ctx = await browser.newContext({ viewport: { width: Number(args.w) || 960, height: Number(args.h) || 540 } });
  const page = await ctx.newPage();
  await page.route("https://cdn.jsdelivr.net/npm/three@0.160.0/**", (route) => {
    const rel = new URL(route.request().url()).pathname.replace("/npm/three@0.160.0/", "");
    route.fulfill({ path: path.join(localThreeRoot, rel), contentType: "text/javascript" });
  });
  page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
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
  const click = (sel) => page.evaluate((s) => document.querySelector(s)?.click(), sel).catch(() => {});
  async function play() {
    const t0 = Date.now();
    while (Date.now() - t0 < 200000) {
      const st = await v((g) => g.gameState);
      if (st === "playing") return;
      if (await page.isVisible("#click-to-play").catch(() => false)) await click("#click-to-play");
      else if (await page.isVisible("#resume-btn").catch(() => false)) await click("#resume-btn");
      else await page.mouse.click(300, 200);
      await frames(4);
    }
    throw new Error("the run didn't start playing");
  }
  const shots = process.env.SHOTS || "";
  const shot = async (name) => {
    if (!shots) return;
    fs.mkdirSync(shots, { recursive: true });
    await page.screenshot({ path: path.join(shots, `${name}.png`) });
    console.log(`        screenshot ${name}.png`);
  };
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
  // Simulated frames (deterministic, faster than real time). With
  // rails: the player's jet moved along the course's line (never into the rock).
  const STEP = `(g, a) => {
    const c = g.canyon; c.waitForGround = !!a.rails; const T = g.THREE; const dt = a.dt || 1 / 30; const log = [];
    for (let i = 0; i < a.n; i++) {
      const j = g.vehicles.active;
      // (rails: the player's jet moved along the course's line at 110 blocks/s, waiting for the ground ahead as the run does)
      let railZ = null;
      if (a.rails && j && c.state === "flying") {
        const z = j.pos.z + (c._aheadIn(j) ? 110 * dt : 0);
        const z0 = Math.floor(z / 8) * 8;
        const p = c.course.safePoint(z0);
        const q = c.course.safePoint(z0 + 8);
        const f = (z - z0) / 8;
        j.pos.set(p.x + (q.x - p.x) * f, p.y + (q.y - p.y) * f, z);
        j.vel.set(0, 0, 110);
        j.q.setFromAxisAngle(new T.Vector3(0, 1, 0), Math.PI);
        j.aimQ.copy(j.q);
        railZ = z;
      }
      g.vehicles.update(dt);
      if (railZ !== null && g.vehicles.active) g.vehicles.active.pos.z = railZ; if (g.vehicles.active) g.vehicles.updateCamera(g.camera, dt); g.lasers.update(dt); c.update(dt, true);
      if (a.log && g.vehicles.active) log.push(+g.vehicles.active.vel.length().toFixed(2));
      if (a.stopAt && c.state === a.stopAt) break;
    }
    return { ...c.info(), log };
  }`;
  const step = (n, opts = {}) => page.evaluate(([src, a]) => new Function("return " + src)()(window.__ufo, a), [STEP, { n, ...opts }]);
  // The jet in front of a checkpoint, flying through it (off: past its rim).
  const PUT = `(g, a) => { const c = g.canyon; const j = g.vehicles.active; const r = c.checks[a.i]; const s = Math.sin(r.yaw), co = Math.cos(r.yaw); j.pos.set(r.x - s * 30, r.y + (a.off ? r.r + 2.5 : 0), r.z - co * 30); j.q.setFromAxisAngle(new g.THREE.Vector3(0, 1, 0), Math.PI + r.yaw); j.vel.set(s * 120, 0, co * 120); j.aimQ.copy(j.q); j.angVel.set(0, 0, 0); c._lastPos.copy(j.pos); return true; }`;
  const putAt = (i, off = 0) => page.evaluate(([src, a]) => new Function("return " + src)()(window.__ufo, a), [PUT, { i, off }]);
  // Into the right wall at half height: a crash.
  const crash = () =>
    v((g) => {
      const c = g.canyon;
      const j = g.vehicles.active;
      const row = c.course.row(Math.floor(j.pos.z));
      const y = Math.round((row.floor + Math.min(row.rim, row.ceil)) / 2);
      j.pos.set(row.R[y] - 12, y, row.z);
      j.q.setFromAxisAngle(new g.THREE.Vector3(0, 1, 0), -Math.PI / 2);
      j.vel.set(150, 0, 0);
      j.aimQ.copy(j.q);
      c._lastPos.copy(j.pos);
      return true;
    });

  const base = `http://127.0.0.1:${PORT}/index.html`;

  await browserCheck("the canyon screen: difficulty, scenery, open stretches, enemy jets and crash options reach the run's address", async () => {
    await page.goto(`${base}?seed=4242&graphics=low`, { waitUntil: "load", timeout: 60000 });
    await page.waitForFunction(() => !!window.__ufo && window.__ufo.graphicsReady, null, { timeout: 120000 });
    await page.evaluate(() => localStorage.removeItem("ufocombat_v1_canyon_pref"));
    await click("#menu-canyon-btn");
    await frames(3);
    const r = await v(() => {
      const n = (k) => document.querySelectorAll(`[data-opt="${k}"] .cy-seg-btn`).length;
      const act = (k) => document.querySelector(`[data-opt="${k}"] .cy-seg-btn.active`)?.dataset.v;
      return { shown: !document.getElementById("canyon-screen")?.classList.contains("hidden"), cards: document.querySelectorAll(".cy-course-card").length, diff: n("diff"), biome: n("biome"), open: n("open"), bots: n("bots"), crash: n("crash"), rings: n("rings"), defaults: [act("diff"), act("biome"), act("open"), act("bots"), act("crash"), act("rings")] };
    });
    assert(r.shown && r.cards === 4 && r.diff === 4 && r.biome === 10 && r.open === 3 && r.bots === 4 && r.crash === 2 && r.rings === 2, `the screen: ${JSON.stringify(r)}`);
    assert(r.defaults.join() === "normal,default,some,none,checkpoint,off", `the defaults: ${r.defaults}`);
    await shot("r16-menu");
    await page.evaluate(() => {
      const pick = (k, val) => document.querySelector(`[data-opt="${k}"] .cy-seg-btn[data-v="${val}"]`).click();
      pick("diff", "insane");
      pick("biome", "volcanic");
      pick("open", "lots");
      pick("bots", "many");
      pick("crash", "restart");
      pick("rings", "on");
      document.querySelectorAll(".cy-course-card")[2].click();
    });
    await Promise.all([page.waitForURL(/canyon=night/, { timeout: 60000 }), click("#canyon-fly")]);
    const url = new URL(page.url());
    const q = Object.fromEntries(url.searchParams);
    assert(q.diff === "insane" && q.biome === "volcanic" && q.open === "lots" && q.bots === "many" && q.crash === "restart" && q.rings === "on", `the address: ${url.search}`);
    await page.waitForFunction(() => !!window.__ufo && window.__ufo.graphicsReady && window.__ufo.canyon, null, { timeout: 120000 });
    const s = await v((g) => g.canyon.info().spec);
    assert(s.diff === "insane" && s.biome === "volcanic" && s.open === "lots", `the run: ${JSON.stringify(s)}`);
    const pref = await v(() => JSON.parse(localStorage.getItem("ufocombat_v1_canyon_pref")));
    assert(pref.diff === "insane" && pref.bots === "many" && pref.crash === "restart", `remembered: ${JSON.stringify(pref)}`);
  });

  await browserCheck("a run with options: Easy, Frozen pass, enemy jets, lots of open stretches; flying", async () => {
    await page.goto(`${base}?canyon=grand&jet=f22&diff=easy&biome=snow&open=lots&bots=some`, { waitUntil: "load", timeout: 60000 });
    await page.waitForFunction(() => !!window.__ufo && window.__ufo.graphicsReady && window.__ufo.canyon, null, { timeout: 120000 });
    await v((g) => g.setGraphics?.("low"));
    await play();
    const r = await until((g) => (g.canyon.state === "flying" ? g.canyon.info() : null), 200000);
    assert(r, `never flying: ${await v((g) => g.canyon.state)}`);
    assert(r.spec.diff === "easy" && r.spec.biome === "snow" && r.spec.open === "lots" && r.bots.count === 4, `the run: ${JSON.stringify(r.spec)} ${JSON.stringify(r.bots)}`);
    // (the canyon's blocks are the Frozen pass's: snow on top, an ice river)
    const b = await v((g) => {
      const c = g.canyon.course;
      const w = g.world;
      let snow = 0;
      let ice = 0;
      let terracotta = 0;
      for (let z = -100; z < 200; z += 3) {
        const row = c.row(z);
        for (let x = Math.floor(row.xc - 80); x < row.xc + 80; x += 2) {
          for (let y = 1; y < 120; y += 1) {
            const id = w.getBlock(x, y, z);
            if (id === 30) snow++;
            else if (id === 1554) ice++;
            else if (id === 31 || id === 1367) terracotta++;
          }
        }
      }
      return { snow, ice, terracotta };
    });
    assert(b.snow > 100 && b.ice > 20 && b.terracotta === 0, `the blocks: ${JSON.stringify(b)}`);
    await frames(10);
    await shot("r16-snow-start");
  });

  await browserCheck("no speed-up at checkpoints: flying through one leaves the speed as it was", async () => {
    await putAt(0);
    let r = await step(15);
    assert(r.clock !== null && r.nextCheck === 1, `the start gate: ${JSON.stringify(r)}`);
    await putAt(1);
    r = await step(20, { log: true });
    assert(r.passed === 1 && r.nextCheck === 2, `through ring 1: ${JSON.stringify({ passed: r.passed, next: r.nextCheck })}`);
    let jump = 0;
    for (let i = 1; i < r.log.length; i++) jump = Math.max(jump, r.log[i] - r.log[i - 1]);
    // (the engine's own steady pull, no kick: Round 15's boost added 70 at once)
    assert(jump < 3 && r.log[r.log.length - 1] < r.log[0] + 15, `the speed: ${r.log.join(" ")}`);
  });

  await browserCheck("a crash brings the jet back at the last checkpoint (Enter, or by itself); the clock runs on", async () => {
    await v((g) => {
      g.canyon.bots.clear();
      g.canyon.bots.timer = 99;
    });
    const before = await v((g) => ({ clock: g.canyon.clock, next: g.canyon.nextCheck, ring: g.canyon.checks[g.canyon.nextCheck - 1].z }));
    await crash();
    let r = await step(20);
    assert(r.state === "crashed", `crashed: ${r.state}`);
    r = await step(60, { stopAt: "down" });
    assert(r.state === "down" && !r.results, `the respawn's panel: ${JSON.stringify({ state: r.state, results: r.results })}`);
    const panel = await v(() => document.querySelector("#canyon-hud .cy-down")?.textContent || "");
    assert(/Back at checkpoint 1/.test(panel) && /Enter/.test(panel), `the panel: ${panel}`);
    await shot("r16-down");
    await page.keyboard.press("Enter");
    await frames(2);
    r = await v((g) => ({ ...g.canyon.info(), z: g.vehicles.active?.pos.z, speed: g.vehicles.active?.vel.length() }));
    assert(r.state === "countdown" && r.respawns === 1 && Math.abs(r.z - before.ring) < 2 && r.nextCheck === before.next && r.clock > before.clock, `back at the checkpoint: ${JSON.stringify({ state: r.state, respawns: r.respawns, z: r.z, ring: before.ring, next: r.nextCheck, clock: r.clock })}`);
    r = await step(100, { stopAt: "flying" });
    assert(r.state === "flying", `flying again: ${r.state}`);
    // ... and by itself, a moment after the next crash.
    await crash();
    r = await step(20 + 45 + 90, { stopAt: "countdown" });
    assert(r.state === "countdown" && r.respawns === 2, `by itself: ${JSON.stringify({ state: r.state, respawns: r.respawns })}`);
    r = await step(100, { stopAt: "flying" });
    assert(r.state === "flying" && r.health === r.maxHealth, `a whole jet again: ${JSON.stringify({ state: r.state, hp: r.health })}`);
  });

  await browserCheck("'Restart the course' mode: a crash ends the run (the results), R from the mouth", async () => {
    await v((g) => (g.canyon.crashMode = "restart"));
    await crash();
    let r = await step(20 + 80, { stopAt: "never" });
    assert(r.results && r.state === "crashed", `the results: ${JSON.stringify({ state: r.state, results: r.results })}`);
    await page.keyboard.press("KeyR");
    await frames(3);
    r = await v((g) => ({ ...g.canyon.info(), z: g.vehicles.active?.pos.z }));
    assert(!r.results && (r.state === "loading" || r.state === "countdown") && r.z < -100 && r.respawns === 0, `from the mouth: ${JSON.stringify({ state: r.state, z: r.z })}`);
    await v((g) => (g.canyon.crashMode = "checkpoint"));
    // (from the mouth: the countdown waits for the canyon to be drawn, in real time)
    r = await until((g) => (g.canyon.state === "flying" ? g.canyon.info() : null), 200000);
    assert(r && r.state === "flying", "never flying again");
  });

  await browserCheck("enemy jets: they spawn ahead, fly the canyon without hitting the rock, and shoot at the player", async () => {
    const fired = await v((g) => {
      const c = g.canyon;
      // (a stretch of plain canyon, the player on its line, a shield for a while)
      const ring = c.checks[2];
      const sp = c.course.safePoint(ring.z - 200);
      const j = g.vehicles.active;
      j.pos.set(sp.x, sp.y, ring.z - 200);
      j.q.setFromAxisAngle(new g.THREE.Vector3(0, 1, 0), Math.PI);
      j.vel.set(0, 0, 110);
      j.aimQ.copy(j.q);
      c._lastPos.copy(j.pos);
      c.bots.reset();
      // (as if flown here: the start gate and the first checkpoints passed)
      if (c.clock === null) c.clock = 20;
      c.nextCheck = 2;
      c.checks[2].state = "next";
      c.bots.timer = 0.1;
      window.__bolts = 0;
      if (!g.lasers.__counted) {
        const fire = g.lasers.fire.bind(g.lasers);
        g.lasers.fire = (o) => {
          if (o.owner === "enemyjet") window.__bolts++;
          return fire(o);
        };
        g.lasers.__counted = true;
      }
      return true;
    });
    void fired;
    // (the player can't be shot down in this check: its health topped up)
    let r = null;
    let minHp = Infinity;
    for (let k = 0; k < 22; k++) {
      r = await step(30, { rails: true });
      minHp = Math.min(minHp, r.health || Infinity);
      await v((g) => g.vehicles.active && (g.vehicles.active.health = g.vehicles.active.maxHealth));
      if (r.state !== "flying") break;
    }
    const bolts = await v(() => window.__bolts);
    console.log(`        ${JSON.stringify({ state: r.state, bots: r.bots, bolts, minHp })}`);
    assert(r.bots.spawned >= 3, `spawned ${r.bots.spawned}`);
    assert(r.state === "flying", `the player: ${r.state}`);
    // (Round 17: a bandit never crashes, and none comes head-on)
    assert(r.bots.lost === 0, `${r.bots.lost} of ${r.bots.spawned} flew into the rock`);
    assert(await v((g) => g.canyon.bots.list.every((b) => b.dirZ === 1 && !b.collider)), "a bandit head-on, or one that can ram");
    assert(bolts > 0, "no enemy jet fired");
    await shot("r16-bots");
  });

  await browserCheck("enemy jets: the player's guns shoot one down (a kill counted); one's guns hurt the player", async () => {
    const r = await v((g) => {
      const c = g.canyon;
      const T = g.THREE;
      const j = g.vehicles.active;
      c.bots.clear();
      c.bots.timer = 99;
      c.shieldT = 0;
      const ring = c.checks[3];
      const sp = c.course.safePoint(ring.z - 250);
      j.pos.set(sp.x, sp.y, ring.z - 250);
      j.vel.set(0, 0, 100);
      j.health = j.maxHealth;
      // A bandit right in front, the same way: guns on it.
      const b = c.bots.spawn({ dirZ: 1, ahead: 120 });
      if (!b) return { err: "no spawn" };
      const kills0 = c.bots.kills;
      for (let i = 0; i < 160 && b.alive; i++) {
        const d = b.pos.clone().sub(j.pos).normalize();
        j.q.setFromUnitVectors(new T.Vector3(0, 0, -1), d);
        j.aimQ.copy(j.q);
        j.vel.copy(d).multiplyScalar(b.vel.length());
        j.cannonT = 0;
        j.heat = 0;
        j.jammed = false;
        j._fireCannon(j.forward(new T.Vector3()));
        g.lasers.update(1 / 30);
        b.pos.addScaledVector(b.vel, 1 / 30);
        j.pos.addScaledVector(j.vel, 1 / 30);
      }
      c._hud(0);
      const out = { alive: b.alive, hp: b.health, kills: c.bots.kills - kills0, hud: document.querySelector("#canyon-hud .cy-kills")?.textContent };
      // A bandit (Round 17: the player's way, never head-on), its guns on the player.
      const h = c.bots.spawn({ ahead: 160 });
      const hp0 = j.health;
      for (let i = 0; i < 90 && h && h.alive; i++) {
        h.ai.burstT = 0;
        const d = j.pos.clone().sub(h.pos).normalize();
        h.q.setFromUnitVectors(new T.Vector3(0, 0, -1), d);
        h.cannonT = 0;
        h.ai.burstLeft = 1;
        h._fireCannon(d);
        g.lasers.update(1 / 30);
      }
      out.hurt = hp0 - j.health;
      out.hpBar = document.querySelector("#canyon-hud .cy-hp")?.style.display;
      return out;
    });
    assert(!r.err, r.err);
    assert(!r.alive && r.kills === 1 && /KILLS 1/.test(r.hud), `the kill: ${JSON.stringify(r)}`);
    assert(r.hurt > 0 && r.hpBar === "flex", `the bandit's guns: ${JSON.stringify(r)}`);
  });

  await browserCheck("shot down by an enemy jet: back at the checkpoint", async () => {
    await v((g) => {
      const j = g.vehicles.active;
      g.canyon.shieldT = 0;
      j.damage(9999, "enemyjet");
    });
    let r = await step(10);
    assert(r.state === "crashed", `down: ${r.state}`);
    const cause = await v((g) => g.canyon.crashCause);
    assert(cause === "shot", `the cause: ${cause}`);
    r = await step(200, { stopAt: "flying" });
    assert(r.state === "flying" && r.respawns >= 1, `back: ${JSON.stringify({ state: r.state, respawns: r.respawns })}`);
  });

  // (Round 17: space is the Space scenery now, its own run)
  const runPage = async (q) => {
    await page.goto(`${base}?${q}`, { waitUntil: "load", timeout: 60000 });
    await page.waitForFunction(() => !!window.__ufo && window.__ufo.graphicsReady && window.__ufo.canyon, null, { timeout: 120000 });
    await v((g) => g.setGraphics?.("low"));
    await play();
    const f = await until((g) => (g.canyon.state === "flying" ? g.canyon.info() : null), 200000);
    assert(f, "never flying");
  };
  await browserCheck("space: a black sky with stars, asteroids, rings among them; off the line there is out", async () => {
    await runPage("canyon=grand&jet=f22&diff=easy&biome=space&bots=some");
    const r = await v((g) => {
      const c = g.canyon;
      c.bots.clear();
      c.bots.timer = 99;
      const o = c.course.opens.find((x) => x.kind === "space");
      const z = Math.round((o.z0 + o.z1) / 2);
      const sp = c.course.safePoint(z);
      const j = g.vehicles.active;
      j.pos.set(sp.x, sp.y, z);
      j.q.setFromAxisAngle(new g.THREE.Vector3(0, 1, 0), Math.PI);
      j.vel.set(0, 0, 60);
      j.aimQ.copy(j.q);
      c._lastPos.copy(j.pos);
      g.player.position.copy(j.pos);
      return { z, rocks: c.course.rocks.filter((k) => k.z > o.z0 && k.z < o.z1).length };
    });
    assert(r.rocks > 20, `asteroids: ${r.rocks}`);
    // (the chunks there come in, the sky turns)
    await until((g) => {
      const j = g.vehicles.active;
      g.canyon.stream(j.pos.x, j.pos.z);
      return g.world.getChunk(Math.floor(j.pos.x / 16), Math.floor(j.pos.z / 16))?.meshed;
    }, 90000);
    await step(3, { n: 3 });
    await frames(6);
    const s = await v((g) => {
      const u = g.canyon;
      const w = g.world;
      const j = g.vehicles.active;
      let rock = 0;
      let other = 0;
      for (let x = Math.floor(j.pos.x - 40); x < j.pos.x + 40; x += 2) for (let z = Math.floor(j.pos.z - 30); z < j.pos.z + 30; z += 2) for (let y = 0; y < 128; y += 2) {
        const id = w.getBlock(x, y, z);
        if (!id) continue;
        if ([2312, 2315, 1330, 10, 18, 2311].includes(id)) rock++;
        else other++;
      }
      return { space: u.info().space, night: g.THREE ? null : null, uNight: u.spaceK, rock, other };
    });
    assert(s.space > 0.95 && s.rock > 0 && s.other < s.rock * 0.1, `space: ${JSON.stringify(s)}`);
    await shot("r16-space");
    // Off the line: a warning, then back at the checkpoint.
    await v((g) => {
      const j = g.vehicles.active;
      const c = g.canyon;
      j.pos.x = c.course.row(Math.round(j.pos.z)).xc + 150;
      c._lastPos.copy(j.pos);
      c.waitForGround = false;
    });
    let r2 = await step(10);
    const warn = await v(() => document.querySelector("#canyon-hud .cy-warn")?.textContent || "");
    assert(/BACK ON COURSE/.test(warn), `the warning: ${warn}`);
    r2 = await step(150, { stopAt: "down" });
    assert(r2.state === "down", `out: ${r2.state}`);
    r2 = await step(200, { stopAt: "flying" });
    assert(r2.state === "flying", `back: ${r2.state}`);
  });

  await browserCheck("a valley: wide open, low hills; the sky back to the scenery's", async () => {
    await runPage("canyon=grand&jet=f22&diff=easy&biome=snow&open=lots");
    const r = await v((g) => {
      const c = g.canyon;
      const o = c.course.opens.find((x) => x.kind === "valley");
      const z = Math.round((o.z0 + o.z1) / 2);
      const sp = c.course.safePoint(z);
      const j = g.vehicles.active;
      j.pos.set(sp.x, sp.y, z);
      j.vel.set(0, 0, 60);
      c._lastPos.copy(j.pos);
      g.player.position.copy(j.pos);
      const row = c.course.row(z);
      return { W: row.W, rim: row.rim, floor: row.floor, outX: row.outX };
    });
    assert(r.W >= 95 && r.rim - r.floor < 20 && Number.isFinite(r.outX), `the valley: ${JSON.stringify(r)}`);
    await step(3);
    await frames(4);
    const s = await v((g) => g.canyon.info().space);
    assert(s === 0, `space's sky in a valley: ${s}`);
  });

  await browserCheck("graphics High and Low: the canyon draws without errors", async () => {
    for (const preset of ["high", "low"]) {
      await v((g, p) => g.setGraphics?.(p), preset);
      await until((g) => g.graphicsReady, 120000);
      await frames(20);
      await shot(`r16-${preset}`);
    }
  });

  await browserCheck("no console errors over the whole run", async () => {
    assert(errors.length === 0, errors.slice(0, 5).join(" | "));
  });

  await browser.close();
  server.close();
}

// ---------- Summary ----------
const failed = results.filter(([, ok]) => !ok);
console.log(`\n${results.length - failed.length} passed, ${failed.length} failed.`);
process.exit(failed.length ? 1 : 0);
