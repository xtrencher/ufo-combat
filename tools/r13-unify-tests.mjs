// Round 13 "one world" tests: a Missions world is the Survival world with the
// Missions layer on top.
// In Node (fast): the terrain generator's version (worldtype.js: a new world,
// a save from before Round 13, a Survival world, a host's welcome); a new
// Missions world's terrain is the vanilla one (vanilla villages, iron,
// copper, redstone and diamonds, the structures) with its airports and
// cities on it, no village or temple on a site, the home airport's runway
// where it was; an old Missions save's terrain is the old generator's
// exactly; a Survival world's has no sites.
// In the browser (the real game): a new Missions world has that terrain and
// the vanilla game in it (the 2x2 crafting grid and its recipes, hunger and
// food, XP, the weather, beds, the starter kit kept, the Combat tab); the
// Nether is reachable from it, the Missions layer (UFOs, missions, supply
// drops) pausing there and back on the way home; an old Missions save (no
// terrain version) loads with its old terrain and keeps it in its save; a
// new Missions world's save says the new one. Online (a host and a guest
// through a local PeerJS server): a guest in a new Missions room has the
// host's generator and makes the host's chunks block for block.
//
//   node r13-unify-tests.mjs [--only=substring] [--node] [--solo] [--online]
// (--solo: single player only; --online: the online check only; neither: both.)
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
const WT = await imp("js/worldtype.js");
const { TerrainGenerator } = await imp("js/terrain.js");
const { BLOCK } = await imp("js/blocks.js");
const I = await imp("js/content/ids.js");
const { CHUNK_SIZE: S, WORLD_HEIGHT } = await imp("js/constants.js");

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

const SEED = 13013;
const OLD_SEED = 13014;
const chunkOf = (t, cx, cz) => {
  const c = { cx, cz, blocks: new Uint16Array(S * S * WORLD_HEIGHT) };
  t.generate(c);
  return c.blocks;
};
const same = (a, b) => a.length === b.length && a.every((x, i) => x === b[i]);

// ---------- Node ----------

await check("the terrain's version: new worlds the vanilla terrain, a Missions save from before Round 13 the old one", async () => {
  const g = WT.terrainGenOf;
  assert(g("missions", undefined) === WT.GEN_ONE_WORLD, "a new Missions world");
  assert(g("missions", undefined, { old: true }) === WT.GEN_LEGACY, "a Missions save without a version");
  assert(g("missions", 2, { old: true }) === WT.GEN_ONE_WORLD && g("missions", 1) === WT.GEN_LEGACY, "a saved version is kept");
  assert(g("missions", "junk", { old: true }) === WT.GEN_LEGACY && g("missions", 99) === WT.TERRAIN_GEN, "junk and a newer version");
  assert(g("survival", 1, { old: true }) === WT.TERRAIN_GEN && g("survival", undefined, { old: true }) === WT.TERRAIN_GEN, "a Survival world's terrain never changed");
  const opts = (type, gen) => {
    WT.setWorldType(type, { gen });
    return JSON.stringify({ ...WT.terrainOptions(), gen: WT.terrainGen(), legacy: WT.legacyTerrain(), rules: WT.vanillaRules(), layer: WT.missionsLayer(), survival: WT.isSurvivalWorld() });
  };
  assert(opts("missions", 2) === JSON.stringify({ sites: true, vanilla: true, gen: 2, legacy: false, rules: true, layer: true, survival: false }), opts("missions", 2));
  assert(opts("missions", 1) === JSON.stringify({ sites: true, vanilla: false, gen: 1, legacy: true, rules: true, layer: true, survival: false }), opts("missions", 1));
  assert(opts("survival", 1) === JSON.stringify({ sites: false, vanilla: true, gen: 2, legacy: false, rules: true, layer: false, survival: true }), opts("survival", 1));
  WT.setWorldType("missions");
});

await check("a new Missions world's terrain: the vanilla one (villages, ores, structures) with its airports and cities, none of them on a site", async () => {
  const t = new TerrainGenerator(SEED, { sites: true, vanilla: true });
  const old = new TerrainGenerator(SEED, { sites: true });
  // (The sites stand where they stood: they are planned on the natural heights.)
  t.sites._ensureHome();
  old.sites._ensureHome();
  assert(t.sites.home && old.sites.home && t.sites.home.id === old.sites.home.id && t.sites.home.y === old.sites.home.y, `the home airport: ${t.sites.home?.id} / ${old.sites.home?.id}`);
  const box = [-5000, -5000, 5000, 5000];
  const sites = t.sites.within(0, 0, 7000);
  assert(sites.length >= 3, `sites: ${sites.length}`);
  const vs = t.villages._villagesNear(...box);
  assert(vs.length > 20 && vs.every((v) => v.style), `vanilla villages: ${vs.length}`);
  const touches = (x, z, r) => {
    for (let k = 0; k < 16; k++) {
      const a = (k / 16) * Math.PI * 2;
      for (const d of [0, r / 2, r]) if (t.sites.covers(Math.round(x + Math.cos(a) * d), Math.round(z + Math.sin(a) * d), 8)) return true;
    }
    return false;
  };
  const bad = vs.filter((v) => touches(v.x, v.z, t.villages.reach));
  assert(bad.length === 0, `villages on a site: ${bad.map((v) => `${v.x},${v.z}`).join(" ")}`);
  // (Without the rule some would be: the check is doing something.)
  const u = new TerrainGenerator(SEED, { sites: true, vanilla: true });
  u.villages._onSite = () => false;
  assert(u.villages._villagesNear(...box).length > vs.length, "the rule moved no village");
  // Temples and ruined portals keep off the sites too.
  const st = t.structures;
  for (let rx = -6; rx <= 6; rx++) {
    for (let rz = -6; rz <= 6; rz++) {
      const tp = st.templeAt(rx, rz);
      assert(!tp || !t.sites.covers(tp.x0 + 10, tp.z0 + 10, 30), `a temple on a site at ${tp?.x0},${tp?.z0}`);
      const jt = st.jungleTempleAt(rx, rz);
      assert(!jt || !t.sites.covers(jt.x0 + 6, jt.z0 + 7, 30), `a jungle temple on a site at ${jt?.x0},${jt?.z0}`);
      const rp = st.ruined.planOf(rx, rz);
      assert(!rp || !t.sites.covers(rp.x, rp.z, 30), `a ruined portal on a site at ${rp?.x},${rp?.z}`);
    }
  }
  // The ores and stone of the vanilla terrain, none of the old crystals; the old terrain the other way round.
  const count = (gen) => {
    const n = {};
    for (let i = 0; i < 6; i++) for (const id of chunkOf(gen, 10 + i, -4)) n[id] = (n[id] || 0) + 1;
    return n;
  };
  const a = count(t);
  const b = count(old);
  assert(a[BLOCK.IRON_ORE] > 50 && a[I.COPPER_ORE] > 10 && a[I.REDSTONE_ORE] > 10 && a[BLOCK.DIAMOND_ORE] > 0 && !a[BLOCK.LUMEN], `vanilla ores: ${JSON.stringify({ iron: a[BLOCK.IRON_ORE], copper: a[I.COPPER_ORE], redstone: a[I.REDSTONE_ORE], diamond: a[BLOCK.DIAMOND_ORE], lumen: a[BLOCK.LUMEN] })}`);
  assert(!b[BLOCK.IRON_ORE] && !b[I.COPPER_ORE], `the old terrain has none: ${b[BLOCK.IRON_ORE]}`);
  // The home airport's runway in the chunk under its middle, at the pad's height.
  const h = t.sites.home;
  const blocks = chunkOf(t, h.x >> 4, h.z >> 4);
  const lx = h.x & 15;
  const lz = h.z & 15;
  let top = -1;
  for (let y = WORLD_HEIGHT - 1; y >= 0 && top < 0; y--) if (blocks[(y * S + lz) * S + lx] && blocks[(y * S + lz) * S + lx] !== BLOCK.AIR) top = y;
  assert(top === h.y, `the runway at ${top}, the pad at ${h.y}`);
  // Structures: the dungeons and mineshafts of some chunks, and a stronghold to find.
  assert(st.strongholds && st.strongholds.nearest(0, 0), "a stronghold");
});

await check("an old Missions save's terrain is the old generator's exactly; a Survival world's has no sites", async () => {
  const a = new TerrainGenerator(OLD_SEED, { sites: true, vanilla: false });
  const b = new TerrainGenerator(OLD_SEED);
  for (const [cx, cz] of [[0, 0], [7, -3], [-12, 5]]) assert(same(chunkOf(a, cx, cz), chunkOf(b, cx, cz)), `chunk ${cx},${cz} differs`);
  assert(!a.structures && !a.villages.vanilla, "no vanilla structures or villages");
  const s = new TerrainGenerator(OLD_SEED, { sites: false });
  s.sites._ensureHome();
  assert(s.options.vanilla && !s.sites.home && s.sites.within(0, 0, 6000).length === 0, "a Survival world: no sites");
  // (Two generators of the same world: the same chunks, as a host's and a guest's, a worker's.)
  const m2 = new TerrainGenerator(OLD_SEED, { sites: true, vanilla: true });
  WT.setWorldType("missions", { gen: 2 });
  const m3 = new TerrainGenerator(OLD_SEED, WT.terrainOptions());
  assert(same(chunkOf(m2, 3, 3), chunkOf(m3, 3, 3)), "the same options make the same chunks");
});

if (!args.node) await browserChecks();

async function browserChecks() {
  const { chromium } = await import("playwright-core");
  const PORT = 9930 + Math.floor(Math.random() * 40);
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
  // What this page's world is: its type and terrain.
  const WORLD = async (g) => {
    const W = await import("./js/worldtype.js");
    const t = g.world.terrain;
    return { type: g.worldType, gen: W.terrainGen(), opts: g.world.terrainOptions, structures: !!t.structures, vanillaVillages: !!t.villages.vanilla, home: t.sites.home ? t.sites.home.id : null };
  };
  // A hash of some chunks as the world's generator makes them.
  const CHUNKS = async (g, list) => {
    const { CHUNK_SIZE, WORLD_HEIGHT } = await import("./js/constants.js");
    const out = [];
    for (const [cx, cz] of list) {
      const c = { cx, cz, blocks: new Uint16Array(CHUNK_SIZE * CHUNK_SIZE * WORLD_HEIGHT) };
      g.world.terrain.generate(c);
      let h = 2166136261;
      for (const id of c.blocks) h = Math.imul(h ^ id, 16777619) >>> 0;
      out.push(h);
    }
    return out.join(",");
  };
  const chunks = (p, list) => p.evaluate(([src, a]) => new Function("g", "a", `return (${src})(g, a);`)(window.__ufo, a), [CHUNKS.toString(), list]);
  const LIST = [[0, 0], [5, -3], [-8, 9], [21, 21]];

  if (!args.online) {
    const page = await newPage("solo");
    await browserCheck("a new Missions world: the vanilla terrain with its airports, and the vanilla game in it (crafting, hunger, XP, weather, beds) with the starter kit", async () => {
      await page.goto(`http://127.0.0.1:${PORT}/index.html?seed=${SEED}&type=missions&graphics=low`, { waitUntil: "load", timeout: 60000 });
      await page.waitForFunction(() => !!window.__ufo && window.__ufo.graphicsReady, null, { timeout: 120000 });
      const w = await v(page, WORLD);
      assert(w.type === "missions" && w.gen === 2 && w.opts.sites === true && w.opts.vanilla === true && w.structures && w.vanillaVillages && w.home, `the world: ${JSON.stringify(w)}`);
      await play(page);
      const s = await v(page, async (g) => {
        const { ITEM, itemInfo } = await import("./js/items.js");
        const C = await import("./js/crafting.js");
        const { BLOCK } = await import("./js/blocks.js");
        const p = g.player;
        const before = p.food;
        p.food = 10;
        const can = p.canEat(itemInfo(ITEM.APPLE), ITEM.APPLE);
        p.eat(itemInfo(ITEM.APPLE), ITEM.APPLE);
        const ate = p.food;
        p.food = before;
        g.invScreen.open("inventory", false);
        const grid = g.invScreen.gridWidth;
        const tab = g.invScreen.tabBtns[0].textContent;
        g.invScreen.close();
        const planks = C.craftResult([BLOCK.WOOD, 0, 0, 0], 2);
        return {
          mods: g.mods.enabled,
          kit: g.inventory.slots.filter(Boolean).length,
          missions: g.missions.enabled && g.progress.enabled,
          ufos: g.ufos.enabled,
          hunger: p.hungerOn,
          can,
          ate,
          grid,
          tab,
          planks: planks ? planks.id === BLOCK.PLANKS && planks.count === 4 : false,
          xp: g.xp.enabled,
          weather: g.weather.enabled(),
          dims: g.dims.enabled && g.endGame.enabled,
          day: (await import("./js/sky.js")).dayLength(),
        };
      });
      assert(s.mods && s.kit === 3 && s.missions && s.ufos, `the Missions layer and its starter kit: ${JSON.stringify(s)}`);
      assert(s.hunger && s.can && s.ate === 14 && s.grid === 2 && s.planks && s.tab === "Combat", `the vanilla game: ${JSON.stringify(s)}`);
      assert(s.xp && s.weather && s.dims && s.day === 1200, `XP, weather, the dimensions, vanilla's day: ${JSON.stringify(s)}`);
      // A crafting table opens its 3x3 screen.
      const table = await v(page, async (g) => {
        const { blockUse } = await import("./js/content/containers.js");
        const { BLOCK } = await import("./js/blocks.js");
        const p = g.player.position;
        const x = Math.floor(p.x) + 2;
        const y = Math.floor(p.y);
        const z = Math.floor(p.z);
        g.world.setBlocks([x, y, z, BLOCK.CRAFTING_TABLE]);
        let opened = null;
        const ok = blockUse[BLOCK.CRAFTING_TABLE]({ world: g.world, x, y, z, id: BLOCK.CRAFTING_TABLE, player: g.player, openInventory: (k) => (opened = k), interaction: g.interaction, invScreen: g.invScreen });
        const width = g.invScreen.isOpen ? g.invScreen.gridWidth : null;
        if (g.invScreen.isOpen) g.invScreen.close();
        g.world.setBlocks([x, y, z, 0]);
        return { ok: !!ok, opened, width };
      });
      assert(table.ok && (table.opened === "table" || table.width === 3), `the crafting table: ${JSON.stringify(table)}`);
    });

    await browserCheck("the Nether from a Missions world: the travel works, the Missions layer pauses there and comes back home", async () => {
      const went = await v(page, (g) => g.dims.debugTravel("nether"));
      assert(went, "the travel was refused");
      const there = await until(page, (g) => (g.world.dim === "nether" && !g.dims.pending ? true : null), 90000);
      assert(there, "never got to the Nether");
      await frames(page, 5);
      const n = await v(page, (g) => ({ ufos: g.ufos.enabled, list: g.ufos.ufos.length, missions: g.missions.enabled, crates: g.crates.enabled, vehicles: g.vehicles.enabled, mods: g.mods.enabled }));
      assert(!n.ufos && n.list === 0 && !n.missions && !n.crates && !n.vehicles && n.mods, `the Missions layer in the Nether: ${JSON.stringify(n)}`);
      await v(page, (g) => g.dims.debugTravel("overworld"));
      const home = await until(page, (g) => (g.world.dim === "overworld" && !g.dims.pending ? true : null), 90000);
      assert(home, "never got back");
      await frames(page, 5);
      const o = await v(page, (g) => ({ ufos: g.ufos.enabled, missions: g.missions.enabled, crates: g.crates.enabled, vehicles: g.vehicles.enabled }));
      assert(o.ufos && o.missions && o.crates && o.vehicles, `back home: ${JSON.stringify(o)}`);
      await v(page, (g) => g.flushSave());
      const saved = await page.evaluate(async (seed) => {
        const St = await import("./js/storage.js");
        const d = JSON.parse(localStorage.getItem(St.playerKey(seed)));
        return { type: d.worldType, gen: d.gen, surv: !!d.surv };
      }, SEED);
      assert(saved.type === "missions" && saved.gen === 2 && saved.surv, `the save: ${JSON.stringify(saved)}`);
    });

    await browserCheck("an old Missions save (no terrain version) loads with its old terrain, plays, and keeps it in its save", async () => {
      await page.evaluate(async (seed) => {
        const St = await import("./js/storage.js");
        localStorage.setItem(St.playerKey(seed), JSON.stringify({ v: 1, worldType: "missions", mode: "survival", pos: null, inv: [[1, 3]], sel: 0, loadout: true, time: 300 }));
      }, OLD_SEED);
      await page.goto(`http://127.0.0.1:${PORT}/index.html?seed=${OLD_SEED}&graphics=low`, { waitUntil: "load", timeout: 60000 });
      await page.waitForFunction(() => !!window.__ufo && window.__ufo.graphicsReady, null, { timeout: 120000 });
      const w = await v(page, WORLD);
      assert(w.type === "missions" && w.gen === 1 && w.opts.sites === true && w.opts.vanilla === false && !w.structures && !w.vanillaVillages, `the old world: ${JSON.stringify(w)}`);
      const old = await page.evaluate(async ([seed, list]) => {
        const { TerrainGenerator } = await import("./js/terrain.js");
        const t = new TerrainGenerator(seed, { sites: true });
        const { CHUNK_SIZE, WORLD_HEIGHT } = await import("./js/constants.js");
        const out = [];
        for (const [cx, cz] of list) {
          const c = { cx, cz, blocks: new Uint16Array(CHUNK_SIZE * CHUNK_SIZE * WORLD_HEIGHT) };
          t.generate(c);
          let h = 2166136261;
          for (const id of c.blocks) h = Math.imul(h ^ id, 16777619) >>> 0;
          out.push(h);
        }
        return out.join(",");
      }, [OLD_SEED, LIST]);
      assert((await chunks(page, LIST)) === old, "its chunks are not the old generator's");
      await play(page);
      const s = await v(page, (g) => ({ hunger: g.player.hungerOn, food: g.player.food, mods: g.mods.enabled, missions: g.progress.enabled, items: g.inventory.slots.filter(Boolean).length }));
      assert(s.hunger && s.food === 20 && s.mods && s.missions && s.items === 1, `it plays, fed: ${JSON.stringify(s)}`);
      await v(page, (g) => g.flushSave());
      const gen = await page.evaluate(async (seed) => JSON.parse(localStorage.getItem((await import("./js/storage.js")).playerKey(seed))).gen, OLD_SEED);
      assert(gen === 1, `saved with the old version: ${gen}`);
    });
    await page.close();
  }

  if (!args.solo) {
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
    await browserCheck("online: a guest in a new Missions room has the host's terrain (its version, its chunks block for block) and the vanilla game", async () => {
      await host.goto(`http://127.0.0.1:${PORT}/index.html?seed=${SEED + 7}&type=missions&${NET_Q}`, { waitUntil: "load", timeout: 60000 });
      await host.waitForFunction(() => !!window.__ufo && window.__ufo.graphicsReady, null, { timeout: 120000 });
      await host.click("#menu-mp-btn");
      await host.fill("#mp-nick", "Alice");
      await host.click("#mp-host-btn");
      const code = await until(host, (g) => g.net.code, 30000);
      assert(code, "no room code");
      await host.click("#mp-lobby-play");
      await host.waitForFunction(() => window.__ufo.gameState === "playing", null, { timeout: 30000 });
      await v(host, noDraw);
      await guest.goto(`http://127.0.0.1:${PORT}/index.html?join=${code}&${NET_Q}`, { waitUntil: "load", timeout: 60000 });
      await guest.waitForSelector("#mp-join-boot:not(.hidden)", { timeout: 30000 });
      await guest.fill("#mp-boot-nick", "Bob");
      await guest.click("#mp-boot-join");
      await guest.waitForFunction(() => !!window.__ufo && window.__ufo.graphicsReady, null, { timeout: 120000 });
      assert(await until(guest, (g) => g.mp.stateLoaded, 60000), "the host's state never arrived");
      await v(guest, noDraw);
      const hw = await v(host, WORLD);
      const gw = await v(guest, WORLD);
      assert(JSON.stringify(hw) === JSON.stringify(gw) && gw.gen === 2 && gw.opts.vanilla && gw.opts.sites, `host ${JSON.stringify(hw)} guest ${JSON.stringify(gw)}`);
      const hc = await chunks(host, LIST);
      const gc = await chunks(guest, LIST);
      assert(hc === gc, `the chunks differ: ${hc} / ${gc}`);
      // (And the chunks the guest's world loaded, edits aside: as the host's generator makes them.)
      await play(guest);
      const loaded = await v(guest, (g) => {
        const p = g.player.position;
        const c = g.world.getChunk(Math.floor(p.x) >> 4, Math.floor(p.z) >> 4);
        return c ? [c.cx, c.cz] : null;
      });
      assert(loaded, "the guest has no chunk under it");
      const mine = await v(guest, (g, [cx, cz]) => {
        const c = g.world.getChunk(cx, cz);
        let h = 2166136261;
        for (const id of c.blocks) h = Math.imul(h ^ id, 16777619) >>> 0;
        return { h, edits: g.world.edits.get(`${cx},${cz}`)?.size || 0 };
      }, loaded);
      if (!mine.edits) assert(String(mine.h) === (await chunks(host, [loaded])), "the guest's loaded chunk is not the host's generator's");
      const s = await v(guest, (g) => {
        g.invScreen.open("inventory", false);
        const grid = g.invScreen.gridWidth;
        g.invScreen.close();
        return { hunger: g.player.hungerOn, grid, xp: g.xp.enabled, mods: g.mods.enabled, dims: g.dims.enabled };
      });
      assert(s.hunger && s.grid === 2 && s.xp && s.mods && s.dims, `the guest's game: ${JSON.stringify(s)}`);
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
