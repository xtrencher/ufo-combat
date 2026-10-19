// Round 12 dimension engine tests (js/dimensions.js, js/dim-registry.js).
// In Node (fast): the registry (codes, keys, the 1:8 scale), the stand-in
// generators (the Nether's floor, roof and lava sea, the End's island over
// the void, deterministic), each dimension's edits key and the eviction of
// a whole world, chests and furnaces with the same place in two dimensions,
// the old saves' keys as the Overworld's, the water's state handed over.
// In the browser (the real game, a Survival world): to the stand-in Nether
// and back with an edit kept in each, the Nether's sky, fog, light and no
// weather or distant tiles, a chest in each dimension at the same place, a
// save and reload in the Nether, the End's platform, an old save loading in
// the Overworld; with --online, a host and a guest in different dimensions
// placing blocks at the same place that the other never sees, and the guest
// coming back seeing the host's.
//
//   node r12-dims-tests.mjs [--only=substring] [--node] [--online]
// (GAME_ROOT=dir runs another copy of the game; SHOTS=dir keeps screenshots.)
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
const R = await imp("js/dim-registry.js");
const { BLOCK } = await imp("js/content/base.js");
const V = await imp("js/content/ids.js");
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
const chunkOf = (gen, cx, cz) => {
  const c = { cx, cz, blocks: new Uint16Array(16 * 128 * 16) };
  gen.generate(c);
  return c.blocks;
};
const at = (b, x, y, z) => b[(y << 8) | (z << 4) | x];

// ---------- In Node ----------

await check("the registry: codes, the Overworld's keys unchanged, other dimensions' prefixed, the Nether's 1:8", async () => {
  assert(R.codeOf("overworld") === 0 && R.codeOf("nether") === 1 && R.codeOf("end") === 2, "codes");
  assert(R.dimOfCode(0) === "overworld" && R.dimOfCode(2) === "end" && R.dimOfCode(9) === "overworld" && R.dimOfCode(undefined) === "overworld", "dimOfCode");
  assert(R.dimId("nether") === "nether" && R.dimId("hell") === "overworld" && R.dimId(undefined) === "overworld", "dimId");
  assert(R.dimKey("overworld", 1, 2, -3) === "1,2,-3" && R.dimKey("nether", 1, 2, -3) === "n:1,2,-3" && R.dimKey("end", 0, 64, 0) === "e:0,64,0", "keys");
  assert(JSON.stringify(R.parseDimKey("n:1,2,-3")) === JSON.stringify([1, 2, -3, "nether"]) && JSON.stringify(R.parseDimKey("4,5,6")) === JSON.stringify([4, 5, 6, "overworld"]) && R.parseDimKey("x:1,2,3") === null, "parse");
  assert(R.scaleBetween("overworld", "nether", 800) === 100 && R.scaleBetween("nether", "overworld", -12.5) === -100 && R.scaleBetween("end", "overworld", 7) === 7, "scale");
  assert(R.dmOf("overworld") === null && R.dmOf("nether").dm === 1, "dmOf");
  const n = R.DIMS.nether;
  assert(n.waterEvaporates && n.bedsExplode && n.ceiling && !n.weather && !n.dayCycle && n.lod === false && n.lightFloor > 0, "the Nether's rules");
  const e = R.DIMS.end;
  assert(e.voidBelow && e.bedsExplode && !e.weather && R.belowWorld("end") === BLOCK.AIR && R.belowWorld("nether") === BLOCK.BEDROCK, "the End's rules");
});

await check("the stand-in Nether: a bedrock floor and roof, caves, a lava sea up to 31, the same chunk every time", async () => {
  const g = R.createGenerator("nether", 4711, { sites: false, vanilla: true });
  const a = chunkOf(g, 3, -2);
  const b = chunkOf(R.createGenerator("nether", 4711, { sites: false, vanilla: true }), 3, -2);
  assert(a.every((v, i) => v === b[i]), "not deterministic");
  let air = 0;
  let lava = 0;
  for (let x = 0; x < 16; x++) {
    for (let z = 0; z < 16; z++) {
      assert(at(a, x, 0, z) === BLOCK.BEDROCK && at(a, x, 127, z) === BLOCK.BEDROCK, "no floor or roof");
      for (let y = 5; y < 122; y++) {
        const id = at(a, x, y, z);
        if (id === BLOCK.AIR) {
          air++;
          assert(y > 31, `air in the lava sea at y ${y}`);
        }
        // (Round 12: the real Nether has lava falls and the deltas' pools above its sea too)
        if (id === V.LAVA && y <= 31) lava++;
      }
    }
  }
  assert(air > 2000, `too few caves (${air} cells)`);
  const t0 = performance.now();
  for (let i = 0; i < 12; i++) chunkOf(g, i, 7);
  const ms = (performance.now() - t0) / 12;
  assert(ms < 40, `${ms.toFixed(1)} ms a chunk`);
});

await check("the End: an island near (0, 0) over the void, nothing far out; the Overworld's generator unchanged", async () => {
  const g = R.createGenerator("end", 4711, {});
  const mid = chunkOf(g, 0, 0);
  let stone = 0;
  for (const id of mid) if (id === V.END_STONE) stone++;
  assert(stone > 3000, `the island's middle: ${stone}`);
  assert(at(mid, 0, 0, 0) === BLOCK.AIR, "bedrock under the End");
  const far = chunkOf(g, 40, 40);
  assert(far.every((id) => id === BLOCK.AIR), "something far out in the void");
  assert(g.heightAt(500, 500) === -1 && g.heightAt(0, 0) > 40, "heights");
  const { TerrainGenerator } = await imp("js/terrain.js");
  const ow = chunkOf(R.createGenerator("overworld", 99, { sites: false, vanilla: true }), 2, 2);
  const old = chunkOf(new TerrainGenerator(99, { sites: false, vanilla: true }), 2, 2);
  assert(ow.every((v, i) => v === old[i]), "the Overworld's chunk differs");
});

await check("saves: each dimension's edits under its own key (the Overworld's the old one); a full storage evicts another world whole", async () => {
  const store = new Map();
  globalThis.localStorage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => {
      let size = 0;
      for (const [kk, vv] of store) if (kk !== k) size += vv.length;
      if (size + v.length > 60000) throw new Error("QuotaExceeded");
      store.set(k, String(v));
    },
    removeItem: (k) => store.delete(k),
    key: (i) => [...store.keys()][i],
    get length() {
      return store.size;
    },
  };
  const S = await imp("js/storage.js");
  assert(S.editsKey(5) === "ufocombat_v1_edits_5" && S.editsKey(5, "overworld") === "ufocombat_v1_edits_5" && S.editsKey(5, "nether") === "ufocombat_v1_edits_5_nether", "keys");
  const edits = new Map([["0,0", new Map([[300, BLOCK.BRICKS]])]]);
  assert(S.saveEdits(5, edits, null, null, "nether"), "save");
  assert(S.loadEdits(5, "nether").get("0,0").get(300) === BLOCK.BRICKS, "load the Nether's");
  assert(S.loadEdits(5).size === 0, "the Overworld's got the Nether's");
  // Another world (seed 7), both dimensions, big; this one (seed 5) active.
  store.set("ufocombat_v1_edits_7", "x".repeat(20000));
  store.set("ufocombat_v1_edits_7_nether", "y".repeat(20000));
  store.set("ufocombat_v1_edits_5_end", "z".repeat(5000));
  S.setActiveSeed(5);
  // (Object.keys(localStorage) in the eviction: a plain object view of the keys)
  const proxy = new Proxy(globalThis.localStorage, { ownKeys: () => [...store.keys()], getOwnPropertyDescriptor: (t, k) => (store.has(k) ? { enumerable: true, configurable: true, value: store.get(k) } : undefined) });
  globalThis.localStorage = proxy;
  let info = null;
  S.setStorageFullHandler((i) => (info = i));
  const ok = S.saveSettings({ big: "s".repeat(17000) });
  assert(ok && info?.evicted?.length === 1 && info.evicted[0] === "7", `eviction: ${JSON.stringify(info)}`);
  assert(!store.has("ufocombat_v1_edits_7") && !store.has("ufocombat_v1_edits_7_nether"), "half a world left");
  assert(store.has("ufocombat_v1_edits_5_end") && store.has("ufocombat_v1_edits_5_nether"), "the active world lost a dimension");
});

// A world stand-in for the containers: one loaded chunk in its dimension.
function mockWorld() {
  const w = {
    seed: 1,
    dim: "overworld",
    _edits: { overworld: new Map(), nether: new Map(), end: new Map() },
    get edits() {
      return this._edits[this.dim];
    },
    editsOf(d) {
      return this._edits[d];
    },
    changeListeners: [],
    getChunk: () => null,
    getBlock: () => BLOCK.AIR,
    terrainOf: () => ({}),
    blockIn: () => BLOCK.AIR,
    inDim(d, fn) {
      this.dropDim = d;
      try {
        return fn();
      } finally {
        this.dropDim = null;
      }
    },
    setBlocks: () => 0,
    queueEdit: () => {},
  };
  return w;
}

await check("chests and furnaces: the same place in two dimensions is two of them, saved with their keys; an old save's are the Overworld's", async () => {
  WT.setWorldType("survival");
  const { Chests } = await imp("js/chests.js");
  const { Furnaces } = await imp("js/furnace.js");
  const { makeStack } = await imp("js/inventory.js");
  const w = mockWorld();
  const ch = new Chests({ world: w });
  // Both placed (an edit says so): empty, then filled differently.
  const idx = (5 << 8) | (3 << 4) | 2;
  w._edits.overworld.set("0,0", new Map([[idx, BLOCK.CHEST]]));
  w._edits.nether.set("0,0", new Map([[idx, BLOCK.CHEST]]));
  const a = ch.contents(2, 5, 3);
  a[0] = makeStack(BLOCK.BRICKS, 3);
  w.dim = "nether";
  const b = ch.contents(2, 5, 3);
  assert(b !== a && !b[0], "the Nether's chest is the Overworld's");
  b[1] = makeStack(BLOCK.WOOL, 7);
  const saved = JSON.parse(JSON.stringify(ch.serialize()));
  assert(saved["2,5,3"] && saved["n:2,5,3"], `keys: ${Object.keys(saved)}`);
  const ch2 = new Chests({ world: w });
  ch2.load(saved);
  assert(ch2.contents(2, 5, 3)[1]?.id === BLOCK.WOOL, "the Nether's chest after loading");
  assert(ch2.contents(2, 5, 3, "overworld")[0]?.id === BLOCK.BRICKS, "the Overworld's chest after loading");
  // A key from before Round 12: the Overworld's.
  const ch3 = new Chests({ world: w });
  ch3.load({ "9,9,9": [[0, BLOCK.WOOL, 2]] });
  assert(ch3.store.has("9,9,9") && ch3.contents(9, 9, 9, "overworld")[0]?.count === 2, "an old chest key");
  // The authority spills a gone chest of another dimension there.
  let droppedIn = null;
  ch2.onDrop = () => (droppedIn = w.dropDim);
  w.dim = "overworld";
  ch2.goneUnloaded(2, 5, 3, "nether");
  assert(droppedIn === "nether", `spilt in ${droppedIn}`);
  // Furnaces: the same, and one of another dimension lights there.
  const fu = new Furnaces({ world: w });
  const f1 = fu.contents(1, 2, 3);
  w.dim = "end";
  const f2 = fu.contents(1, 2, 3);
  assert(f1 !== f2 && f2.key === "e:1,2,3" && f2.dim === "end" && f1.dim === "overworld", "furnace records");
  f2.slots[0] = makeStack(BLOCK.WOOL, 1);
  const fs2 = new Furnaces({ world: w });
  fs2.load(JSON.parse(JSON.stringify(fu.serialize())));
  assert(fs2.store.get("e:1,2,3")?.dim === "end", "the End's furnace after loading");
});

await check("water: a dimension's flow cells handed over and back, and from a saved list", async () => {
  const { WaterSim } = await imp("js/watersim.js");
  const w = { changeListeners: [], getBlock: () => BLOCK.AIR, getChunk: () => null, setBlocks: () => 0 };
  const sim = new WaterSim(w);
  sim.meta.set("1,2,3", { level: 2, parent: [1, 2, 4] });
  const v0 = sim.metaVersion;
  const prev = sim.swapDim(null);
  assert(prev.meta.has("1,2,3") && sim.meta.size === 0 && sim.metaVersion > v0, "handed over");
  sim.swapDim(prev);
  assert(sim.meta.get("1,2,3")?.level === 2, "back");
  const m = WaterSim.metaFromList(sim.serializeMeta());
  assert(m.get("1,2,3")?.parent[2] === 4, "from a list");
  const other = new Map();
  sim.applyRemoteMeta([5, 6, 7, 1, 5, 6, 8], null, other);
  assert(other.has("5,6,7") && !sim.meta.has("5,6,7"), "another dimension's remote cells");
});

// ---------- In the browser ----------

if (!args.node) await browserChecks();

async function browserChecks() {
  const { chromium } = await import("playwright-core");
  const PORT = 9880 + Math.floor(Math.random() * 40);
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
  async function newPage(label, size = { width: 960, height: 540 }, ctx = null) {
    ctx ||= await browser.newContext({ viewport: size });
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
    while (Date.now() - t0 < 400000) {
      const st = await v(p, (g) => g.gameState);
      if (st === "playing") return;
      if (st === "dead") {
        await v(p, (g) => g.respawn());
        continue;
      }
      if (st === "start") await p.click("#play-btn", { timeout: 60000 }).catch(() => {});
      else if (await p.isVisible("#resume-btn").catch(() => false)) await p.click("#resume-btn", { timeout: 60000 }).catch(() => {});
      else if (await p.isVisible("#click-to-play").catch(() => false)) await p.click("#click-to-play", { timeout: 60000 }).catch(() => {});
      else {
        await p.mouse.click(300, 200);
        await frames(p, 5);
      }
      await frames(p, 3);
    }
    throw new Error("the game didn't start playing");
  }
  async function boot(p, query) {
    await p.goto(`http://127.0.0.1:${PORT}/index.html?${query}`, { waitUntil: "load", timeout: 60000 });
    await p.waitForFunction(() => !!window.__ufo && window.__ufo.graphicsReady, null, { timeout: 180000 });
    await play(p);
  }
  // A travel, to its end (the loading screen gone, the player put down).
  async function travel(p, dim, x, y, z) {
    const ok = await v(p, (g, a) => g.dims.travel(a[0], a[1], a[2], a[3]), [dim, x, y, z]);
    assert(ok, `the travel to ${dim} was refused`);
    assert(await until(p, (g) => !g.dims.pending, 60000), `the travel to ${dim} never ended`);
    await frames(p, 2);
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
  const SEED = 9101;
  const ctx = await browser.newContext({ viewport: { width: 960, height: 540 } });
  const page = await newPage("solo", null, ctx);
  let P = null; // [x, y, z]: the edits' place (the same in both dimensions)
  await browserCheck("to the stand-in Nether and back: an edit kept in each dimension; its sky, fog, light, no weather, no distant tiles", async () => {
    await boot(page, `seed=${SEED}&type=survival&graphics=low`);
    P = await v(page, (g) => {
      const p = g.player.position;
      g.setMode("creative");
      g.sky.locked = true;
      g.sky.setHours(12);
      g.weather.set("rain", 1000, { instant: true });
      return [Math.floor(p.x) + 2, Math.min(100, Math.floor(p.y) + 4), Math.floor(p.z) + 1];
    });
    await v(page, (g, P) => g.world.setBlock(P[0], P[1], P[2], 23), P);
    assert((await v(page, (g, P) => g.world.getBlock(P[0], P[1], P[2]), P)) === BLOCK.BRICKS, "the Overworld's edit");
    const lodBefore = await v(page, (g) => g.lod.tiles.size);
    await travel(page, "nether", P[0] + 0.5, 70, P[2] + 3.5);
    const n = await v(page, (g, P) => {
      const u = g.uniforms;
      return {
        dim: g.dims.dim,
        here: g.world.getBlock(P[0], P[1], P[2]),
        light: [u.uLightColor.value.r, u.uLightColor.value.g],
        night: u.uNight.value,
        fogEnd: u.uFog.value.y,
        rain: g.weather.levels.rain,
        raining: g.weather.raining,
        lod: g.lod.tiles.size,
        distant: g.distant.enabled,
        floor: u.uNightVision.value,
        daylight: g.sky.daylight,
        chunks: g.world.chunks.size,
        pos: [g.player.position.x, g.player.position.y, g.player.position.z],
        feet: g.world.getBlock(Math.floor(g.player.position.x), Math.floor(g.player.position.y) - 1, Math.floor(g.player.position.z)),
      };
    }, P);
    assert(n.dim === "nether" && n.here !== BLOCK.BRICKS, `in the Nether: ${JSON.stringify(n)}`);
    assert(n.light[0] === 0 && n.light[1] === 0 && n.night === 0 && n.daylight === 0 && n.fogEnd <= 96, `the Nether's sky: ${JSON.stringify(n)}`);
    assert(n.rain === 0 && n.raining, `the weather there: ${JSON.stringify(n)}`);
    assert(n.lod === 0 && !n.distant && n.floor >= 0.3, `distant tiles / light floor: ${JSON.stringify(n)} (before: ${lodBefore} tiles)`);
    assert(n.feet !== BLOCK.AIR && n.feet !== V.LAVA, `put down on ${n.feet} at ${n.pos}`);
    if (out) await page.screenshot({ path: path.join(out, "dims-nether.png") });
    // The Nether's own edit, one above.
    await v(page, (g, P) => g.world.setBlock(P[0], P[1] + 1, P[2], 24), P);
    // Water put there boils away.
    const boiled = await v(page, (g, P) => {
      g.world.setBlock(P[0], P[1] + 2, P[2], 5);
      return g.world.getBlock(P[0], P[1] + 2, P[2]);
    }, P);
    assert(boiled === BLOCK.AIR, `water in the Nether: ${boiled}`);
    await travel(page, "overworld", P[0] + 0.5, P[1] + 2, P[2] + 3.5);
    const o = await v(page, (g, P) => ({ dim: g.dims.dim, a: g.world.getBlock(P[0], P[1], P[2]), b: g.world.getBlock(P[0], P[1] + 1, P[2]), rain: g.weather.levels.rain, sky: !!g.sky.dimSky, distant: g.distant.enabled }), P);
    assert(o.dim === "overworld" && o.a === BLOCK.BRICKS && o.b !== BLOCK.WOOL, `back in the Overworld: ${JSON.stringify(o)}`);
    assert(o.rain === 1 && !o.sky && o.distant, `the Overworld's sky and rain at once: ${JSON.stringify(o)}`);
    assert(await until(page, (g) => g.lod.tiles.size > 0, 60000), "no distant tiles back in the Overworld");
    await travel(page, "nether", P[0] + 0.5, 70, P[2] + 3.5);
    const n2 = await v(page, (g, P) => [g.world.getBlock(P[0], P[1], P[2]), g.world.getBlock(P[0], P[1] + 1, P[2])], P);
    assert(n2[0] !== BLOCK.BRICKS && n2[1] === BLOCK.WOOL, `the Nether's edit kept: ${n2}`);
  });

  const C = () => [P[0] - 3, P[1], P[2] - 2];
  await browserCheck("a chest in each dimension at the same place, each its own", async () => {
    const r = await v(page, async (g, c) => {
      const { makeStack } = await import("./js/inventory.js");
      const ch = g.interaction.chests;
      g.world.setBlock(c[0], c[1], c[2], 41);
      ch.contents(c[0], c[1], c[2])[4] = makeStack(24, 9);
      return { dim: g.dims.dim, keys: [...ch.store.keys()] };
    }, C());
    assert(r.dim === "nether" && r.keys.includes(`n:${C().join(",")}`), `the Nether's chest: ${JSON.stringify(r)}`);
    await travel(page, "overworld", P[0] + 0.5, P[1] + 2, P[2] + 3.5);
    const r2 = await v(page, async (g, c) => {
      const { makeStack } = await import("./js/inventory.js");
      const ch = g.interaction.chests;
      g.world.setBlock(c[0], c[1], c[2], 41);
      const slots = ch.contents(c[0], c[1], c[2]);
      const before = slots.map((s) => (s ? s.id : 0));
      slots[2] = makeStack(23, 5);
      return { before, nether: ch.store.get(`n:${c.join(",")}`)?.[4]?.count, own: ch.store.get(c.join(","))?.[2]?.id };
    }, C());
    assert(r2.before.every((id) => id === 0) && r2.nether === 9 && r2.own === BLOCK.BRICKS, `two chests: ${JSON.stringify(r2)}`);
  });

  await browserCheck("a save and reload in the Nether: back there, both dimensions' edits and chests; the End's platform", async () => {
    await travel(page, "nether", P[0] + 0.5, 70, P[2] + 3.5);
    const saved = await v(page, (g, seed) => {
      g.flushSave(true);
      const pl = JSON.parse(localStorage.getItem(`ufocombat_v1_player_${seed}`));
      return { dim: pl.dim, pos: pl.pos, chests: Object.keys(pl.chests || {}), nether: !!localStorage.getItem(`ufocombat_v1_edits_${seed}_nether`), ow: !!localStorage.getItem(`ufocombat_v1_edits_${seed}`) };
    }, SEED);
    assert(saved.dim === "nether" && saved.nether && saved.ow && saved.chests.length >= 2, `the save: ${JSON.stringify(saved)}`);
    await page.reload({ waitUntil: "load" });
    await page.waitForFunction(() => !!window.__ufo && window.__ufo.graphicsReady, null, { timeout: 180000 });
    await play(page);
    const r = await v(page, (g, a) => {
      const [P, c] = a;
      const ch = g.interaction.chests;
      const p = g.player.position;
      return { dim: g.dims.dim, wool: g.world.getBlock(P[0], P[1] + 1, P[2]), bricks: g.world.getBlock(P[0], P[1], P[2]), pos: [p.x, p.y, p.z], nc: ch.store.get(`n:${c.join(",")}`)?.[4]?.count, oc: ch.store.get(c.join(","))?.[2]?.id, sky: !!g.sky.dimSky };
    }, [P, C()]);
    assert(r.dim === "nether" && r.sky && r.wool === BLOCK.WOOL && r.bricks !== BLOCK.BRICKS, `after the reload: ${JSON.stringify(r)}`);
    assert(Math.abs(r.pos[0] - saved.pos[0]) < 1 && Math.abs(r.pos[2] - saved.pos[2]) < 1, `where: ${r.pos} (saved ${saved.pos})`);
    assert(r.nc === 9 && r.oc === BLOCK.BRICKS, `the chests after the reload: ${JSON.stringify(r)}`);
    await travel(page, "overworld", P[0] + 0.5, P[1] + 2, P[2] + 3.5);
    assert((await v(page, (g, P) => g.world.getBlock(P[0], P[1], P[2]), P)) === BLOCK.BRICKS, "the Overworld's edit after the reload");
    // The End: the obsidian platform at (100, 48, 0), the player on it, over the void.
    await v(page, (g) => g.dims.debugTravel("end"));
    assert(await until(page, (g) => !g.dims.pending, 60000), "the End travel never ended");
    await frames(page, 3);
    const e = await v(page, (g) => ({ dim: g.dims.dim, under: g.world.getBlock(100, 48, 0), corner: g.world.getBlock(102, 48, -2), pos: [g.player.position.x, g.player.position.y, g.player.position.z], below: g.world.getBlock(100, -1, 0), stars: g.uniforms.uNight.value }));
    assert(e.dim === "end" && e.under === V.OBSIDIAN && e.corner === V.OBSIDIAN && Math.abs(e.pos[1] - 49) < 0.2 && Math.abs(e.pos[0] - 100.5) < 0.2, `the End's arrival: ${JSON.stringify(e)}`);
    assert(e.below === BLOCK.AIR && e.stars === 1, `the End's void and sky: ${JSON.stringify(e)}`);
    if (out) await page.screenshot({ path: path.join(out, "dims-end.png") });
    // A nether portal stood in for 4 s (Survival): to the Nether, scaled; standing in it again needs a step out first.
    await v(page, (g) => g.dims.toSpawn());
    assert(await until(page, (g) => !g.dims.pending && g.dims.dim === "overworld", 60000), "the End's exit never ended");
    // A block registered as a portal (the portal parts' PORTAL_BLOCKS) at the player's feet puts them in it.
    const auto = await v(page, async (g) => {
      const { PORTAL_BLOCKS } = await import("./js/dim-registry.js");
      g.setMode("survival"); // (Creative goes through at once)
      const p = g.player.position;
      const c = [Math.floor(p.x), Math.floor(p.y + 0.1), Math.floor(p.z)];
      const was = g.world.getBlock(c[0], c[1], c[2]);
      g.world.setBlocks([c[0], c[1], c[2], 24], { recordEdit: false });
      PORTAL_BLOCKS.set(24, "nether");
      g.dims._cool = 0;
      g.dims._needExit = false;
      g.dims.update(0.25);
      const t = g.dims._portalT;
      PORTAL_BLOCKS.delete(24);
      g.world.setBlocks([c[0], c[1], c[2], was], { recordEdit: false });
      g.dims.update(0.25);
      return { t, after: g.dims._portalT };
    });
    assert(auto.t > 0.2 && auto.after < auto.t, `a portal block at the feet: ${JSON.stringify(auto)}`);
    // (All in one go, no frame between: the player never steps out of the portal.)
    const portal = await v(page, (g) => {
      g.setMode("survival");
      g.dims._cool = 0; // (the last arrival's second, in game time, may not be over: frames are slow here)
      const p = g.player.position.clone();
      const step = (n) => {
        for (let i = 0; i < n; i++) {
          g.dims.enterPortal("nether", g.player.position.clone());
          g.dims.update(0.1);
        }
      };
      step(30);
      const early = g.dims.dim;
      step(15);
      const r = { early, now: g.dims.dim, pending: !!g.dims.pending, from: [p.x, p.z], to: [g.dims.pending?.x, g.dims.pending?.z] };
      // The arrival, at once: its ground made here.
      if (g.dims.pending) g.world.prepareArea(g.dims.pending.x, g.dims.pending.z, 1);
      for (let i = 0; i < 5 && g.dims.pending; i++) g.dims.update(0.05);
      r.arrived = !g.dims.pending;
      step(50);
      r.after = g.dims.dim;
      return r;
    });
    assert(portal.early === "overworld" && portal.now === "nether" && portal.pending, `the portal's wait: ${JSON.stringify(portal)}`);
    assert(Math.abs(portal.to[0] - (Math.floor(portal.from[0]) + 0.5) / 8) < 0.01, `the 1:8 scale: ${JSON.stringify(portal)}`);
    assert(portal.arrived && portal.after === "nether", `bounced back without stepping out: ${JSON.stringify(portal)}`);
    await v(page, (g) => g.setMode("creative"));
  });

  // (Round 12 wave C: the review's fixes, on a page of their own.)
  await browserCheck("review fixes: paused in the arrival portal, saved under the loading screen, XP orbs kept, no nether portal in the End, the End's exit with the anchor gone, a dead save at an anchor, the Overworld's sleepers, a sign gone away, the water list kept", async () => {
    const pg = await newPage("fixes", null, ctx);
    await boot(pg, "seed=9103&type=survival&graphics=low");
    // Paused alone (the player held) just after an arrival: still has to step out of the portal.
    const pause = await v(pg, (g) => {
      const d = g.dims;
      g.setMode("creative");
      d._needExit = true;
      const was = g.player.enabled;
      g.player.enabled = false;
      for (let i = 0; i < 10; i++) d.update(0.1);
      const held = d._needExit;
      g.player.enabled = was;
      d.update(0.1);
      return { held, after: d._needExit };
    });
    assert(pause.held && !pause.after, `paused in the arrival portal: ${JSON.stringify(pause)}`);
    // A save made under a portal trip's loading screen: where the trip started.
    const mid = await v(pg, (g) => {
      const d = g.dims;
      const p = g.player.position;
      const at = { x: Math.floor(p.x), y: Math.floor(p.y), z: Math.floor(p.z) };
      const feet = p.y;
      d._throughPortal({ kind: "nether", at });
      return { pending: !!d.pending, s: d.pending ? d.serialize() : null, at, feet };
    });
    assert(mid.pending && mid.s.dim === undefined && mid.s.pos[0] === mid.at.x + 0.5 && mid.s.pos[2] === mid.at.z + 0.5 && Math.abs(mid.s.pos[1] - mid.feet) < 1e-6, `the save under the loading screen: ${JSON.stringify(mid)}`);
    assert(await until(pg, (g) => !g.dims.pending && g.dims.dim === "nether", 60000), "the portal trip never ended");
    // XP orbs left in the Nether are there on the return.
    const n0 = await v(pg, (g) => {
      const p = g.player.position;
      g.xp.spawn(p.x + 20, p.y + 1, p.z, 30);
      return { xp: g.xp.pending, at: [p.x, p.y, p.z] };
    });
    await travel(pg, "overworld", n0.at[0] * 8, 60, n0.at[2] * 8);
    const away = await v(pg, (g) => g.xp.orbs.length);
    await travel(pg, "nether", n0.at[0], n0.at[1], n0.at[2]);
    const back = await v(pg, (g) => g.xp.pending);
    assert(n0.xp === 30 && away === 0 && back === 30, `the Nether's orbs: ${n0.xp} -> ${away} away -> ${back}`);
    // A respawn anchor: a save made dead (no pos) loads at it; gone, at the world spawn.
    const A = await v(pg, async (g) => {
      const V = await import("./js/content/ids.js");
      const p = g.player.position;
      const a = [Math.floor(p.x) + 1, Math.floor(p.y), Math.floor(p.z)];
      g.world.setBlock(a[0], a[1], a[2], V.RESPAWN_ANCHOR + 2);
      g.sleep.spawn = a.slice();
      g.sleep.spawnDim = "nether";
      return a;
    });
    await travel(pg, "overworld", A[0] * 8, 60, A[2] * 8);
    const dead1 = await v(pg, (g) => {
      g.dims.init({ dim: "nether", pos: null });
      const p = g.player.position;
      return { dim: g.dims.dim, pos: [p.x, p.y, p.z], spawn: g.sleep.spawn };
    });
    assert(dead1.dim === "nether" && Math.abs(dead1.pos[0] - (A[0] + 0.5)) <= 1.6 && Math.abs(dead1.pos[2] - (A[2] + 0.5)) <= 1.6 && Math.abs(dead1.pos[1] - A[1]) <= 1.6 && dead1.spawn, `a dead save at the anchor: ${JSON.stringify(dead1)} (anchor ${A})`);
    await v(pg, (g, a) => g.world.setBlock(a[0], a[1], a[2], 0), A);
    await travel(pg, "overworld", A[0] * 8, 60, A[2] * 8);
    const dead2 = await v(pg, (g) => {
      g.sleep.spawn = [Math.floor(g.player.position.x / 8), 40, Math.floor(g.player.position.z / 8)];
      g.sleep.spawnDim = "nether";
      g.dims.init({ dim: "nether", pos: null });
      const p = g.player.position;
      return { dim: g.dims.dim, pos: [p.x, p.z], spawn: g.sleep.spawn, world: [g.spawn.x, g.spawn.z] };
    });
    assert(dead2.dim === "overworld" && !dead2.spawn && Math.abs(dead2.pos[0] - (dead2.world[0] + 0.5)) < 1 && Math.abs(dead2.pos[1] - (dead2.world[1] + 0.5)) < 1, `a dead save at an anchor gone: ${JSON.stringify(dead2)}`);
    // The End: no nether portal lights there; its exit with the anchor gone goes to the Overworld's spawn.
    await v(pg, (g) => g.dims.debugTravel("end"));
    assert(await until(pg, (g) => !g.dims.pending && g.dims.dim === "end", 60000), "the End travel never ended");
    const end = await v(pg, async (g) => {
      const { findPortalShape } = await import("./js/portal.js");
      const V = await import("./js/content/ids.js");
      const list = [];
      for (const [x, y] of [[100, 49], [101, 49], [99, 50], [99, 51], [99, 52], [102, 50], [102, 51], [102, 52], [100, 53], [101, 53]]) list.push(x, y, 4, V.OBSIDIAN);
      for (let x = 100; x <= 101; x++) for (let y = 50; y <= 52; y++) list.push(x, y, 4, 0);
      g.world.setBlocks(list);
      const shape = !!findPortalShape((x, y, z) => g.world.getBlock(x, y, z), 100, 50, 4, 0);
      const lit = g.netherPortals.tryLight(100, 50, 4);
      g.sleep.spawn = [3, 40, 3];
      g.sleep.spawnDim = "nether";
      g.dims.toSpawn();
      return { shape, lit, to: g.dims.pending?.dim, spawn: g.sleep.spawn };
    });
    assert(end.shape && !end.lit, `a nether portal in the End: ${JSON.stringify(end)}`);
    assert(end.to === "overworld" && !end.spawn, `the End's exit with no anchor: ${JSON.stringify(end)}`);
    assert(await until(pg, (g) => !g.dims.pending && g.dims.dim === "overworld", 60000), "the End's exit never ended");
    // The sleepers: the Overworld's only (a player in the Nether doesn't keep the night going).
    const sl = await v(pg, async (g) => {
      const { Sleep } = await import("./js/sleep.js");
      const mk = (dim, others) => new Sleep({ player: { dead: false, sleeping: null }, sky: g.sky, world: { dim }, mobs: null, toast() {}, players: () => [], everyone: () => others, online: () => true, isHost: () => true, inGame: () => true, sendTime() {} });
      const asleep = { dead: false, sleeping: true, sleepTime: 6, dim: 0 };
      return [mk("nether", [asleep])._count(), mk("overworld", [asleep])._count(), mk("nether", [asleep, { dead: false, sleeping: false, dim: 1 }])._count()];
    });
    assert(JSON.stringify(sl) === JSON.stringify([[1, 1, true], [1, 2, false], [1, 1, true]]), `the sleepers counted: ${JSON.stringify(sl)}`);
    // A sign broken in another dimension (another player's edit): its text goes.
    const sign = await v(pg, async (g) => {
      const { encodeChunkEdits } = await import("./js/storage.js");
      g.signs.set(5, 40, 5, ["away"], undefined, false, "nether");
      const had = !!g.signs.get(5, 40, 5, "nether");
      g.mp.world._apply({ "0,0": encodeChunkEdits(new Map([[(40 << 8) | (5 << 4) | 5, 0]])) }, 2, "nether");
      return { had, now: !!g.signs.get(5, 40, 5, "nether") };
    });
    assert(sign.had && !sign.now, `a sign gone in another dimension: ${JSON.stringify(sign)}`);
    // Another dimension's flow cells: listed once, again only once they change.
    const wl = await v(pg, (g) => {
      const d = g.dims;
      const s = d._stashOf("end");
      s.water = { meta: new Map([["1,40,1", { level: 2, parent: [1, 40, 0] }]]), active: new Set() };
      s.waterList = s.waterSaved = undefined;
      const a = d._waterList(s);
      const b = d._waterList(s);
      d.waterMeta("end").set("2,40,1", { level: 3, parent: [1, 40, 1] });
      const c = d._waterList(s);
      return { same: a === b, a: a.length, c: c.length };
    });
    assert(wl.same && wl.a === 7 && wl.c === 14, `the stashed water's list: ${JSON.stringify(wl)}`);
    await pg.close();
  });

  await browserCheck("an old save (no dimension in it) loads in the Overworld with its edits", async () => {
    await v(page, async () => {
      const { encodeChunkEdits } = await import("./js/storage.js");
      const idx = (100 << 8) | (5 << 4) | 5;
      localStorage.setItem("ufocombat_v1_edits_9102", JSON.stringify({ v: 2, chunks: { "0,0": encodeChunkEdits(new Map([[idx, 23]])) } }));
      localStorage.setItem("ufocombat_v1_player_9102", JSON.stringify({ v: 1, worldType: "survival", mode: "creative", pos: [5.5, 101, 5.5], yaw: 0, pitch: 0, time: 300, dayLen: 1200 }));
      return true;
    });
    await page.close();
    const p2 = await newPage("old", null, ctx);
    await boot(p2, "seed=9102&graphics=low");
    const r = await v(p2, (g) => ({ dim: g.dims.dim, b: g.world.getBlock(5, 100, 5), type: g.worldType }));
    assert(r.dim === "overworld" && r.b === BLOCK.BRICKS && r.type === "survival", `the old save: ${JSON.stringify(r)}`);
    await p2.close();
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
    await browserCheck("online: a host and a guest in different dimensions place blocks at one place that the other never sees; the guest back sees the host's", async () => {
      await host.goto(`http://127.0.0.1:${PORT}/index.html?seed=9103&type=survival&${NET_Q}`, { waitUntil: "load", timeout: 60000 });
      await host.waitForFunction(() => !!window.__ufo && window.__ufo.graphicsReady, null, { timeout: 180000 });
      const code = await v(host, (g) => g.mp.host("Alice", "creative"));
      assert(code, "no room code");
      await play(host);
      await v(host, noDraw);
      await guest.goto(`http://127.0.0.1:${PORT}/index.html?join=${code}&${NET_Q}`, { waitUntil: "load", timeout: 60000 });
      await guest.waitForSelector("#mp-join-boot:not(.hidden)", { timeout: 30000 });
      await guest.fill("#mp-boot-nick", "Bob");
      await guest.click("#mp-boot-join");
      await guest.waitForFunction(() => !!window.__ufo && window.__ufo.graphicsReady, null, { timeout: 180000 });
      assert(await until(guest, (g) => g.mp.stateLoaded, 60000), "the host's state never arrived");
      await v(guest, noDraw);
      await play(guest);
      const hp = await v(host, (g) => {
        const p = g.player.position;
        return [Math.floor(p.x), Math.min(100, Math.floor(p.y) + 5), Math.floor(p.z)];
      });
      assert(await until(guest, (g) => [...g.mp.players.active()].length === 1, 30000), "the guest never saw the host");
      // The guest goes to the Nether, at the same place (not scaled).
      await travel(guest, "nether", hp[0] + 0.5, 70, hp[2] + 2.5);
      assert(await until(host, (g) => g.net.players.get(2)?.dim === 1 && [...g.mp.players.active()].length === 0, 20000), "the host still sees the guest here");
      assert(await until(guest, (g) => [...g.mp.players.active()].length === 0 && g.mobs.puppets === false, 20000), "the guest still sees the host, or has the host's creatures");
      // One block each, at the same place, each in their own dimension.
      await v(host, (g, Q) => g.world.setBlock(Q[0], Q[1], Q[2], 23), hp);
      await v(guest, (g, Q) => g.world.setBlock(Q[0], Q[1], Q[2], 24), hp);
      const key = `${hp[0] >> 4},${hp[2] >> 4}`;
      const idx = (hp[1] << 8) | ((hp[2] & 15) << 4) | (hp[0] & 15);
      const hostOk = await until(host, (g, a) => g.world.editsOf("nether").get(a[0])?.get(a[1]) === 24 && { here: g.world.getBlock(a[2][0], a[2][1], a[2][2]) }, 20000, [key, idx, hp]);
      assert(hostOk && hostOk.here === BLOCK.BRICKS, `the host: ${JSON.stringify(hostOk)}`);
      const guestOk = await until(guest, (g, a) => g.world.editsOf("overworld").get(a[0])?.get(a[1]) === 23 && { here: g.world.getBlock(a[2][0], a[2][1], a[2][2]) }, 20000, [key, idx, hp]);
      assert(guestOk && guestOk.here === BLOCK.WOOL, `the guest: ${JSON.stringify(guestOk)}`);
      // The host keeps (and saves) the Nether's edit.
      const stored = await v(host, (g) => {
        g.flushSave(true);
        return !!localStorage.getItem("ufocombat_v1_edits_9103_nether");
      });
      assert(stored, "the host didn't save the guest's Nether edit");
      // Back in the Overworld: the host's block, the host seen again, its creatures.
      await travel(guest, "overworld", hp[0] + 0.5, hp[1] + 2, hp[2] + 2.5);
      const back = await v(guest, (g, Q) => g.world.getBlock(Q[0], Q[1], Q[2]), hp);
      assert(back === BLOCK.BRICKS, `the guest back sees ${back}`);
      assert(await until(guest, (g) => [...g.mp.players.active()].length === 1 && g.mobs.puppets === true, 20000), "the guest back doesn't see the host or its creatures");
      assert(await until(host, (g) => g.net.players.get(2)?.dim === undefined && [...g.mp.players.active()].length === 1, 20000), "the host doesn't see the guest back");
      // The host goes to the Nether: the guest (now alone in the Overworld) simulates it there.
      await travel(host, "nether", hp[0] + 0.5, 70, hp[2] + 2.5);
      const sim = await until(guest, (g) => g.net.players.get(1)?.dim === 1 && g.dims.simulatesWorld() && !g.mobs.puppets && { b: g.world.getBlock(0, 0, 0) }, 20000);
      assert(sim, "the guest doesn't simulate the Overworld with the host away");
      const hostSees = await v(host, (g, Q) => g.world.getBlock(Q[0], Q[1], Q[2]), hp);
      assert(hostSees === BLOCK.WOOL, `the host in the Nether sees ${hostSees}`);
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
