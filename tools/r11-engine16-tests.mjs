// Round 11 engine tests (16-bit block ids and the content registries): boots
// the real game in headless Chromium (software WebGL, Low preset) and walks a
// block with an id above 1023 (the test-only Debug Block and Debug Slab of
// js/content/debug.js) through every path: placed by a right click, meshed
// (the workers' meshes byte for byte the main thread's) with its own texture
// layer, lit, collided with (standing on the slab), its block use (right
// click turns the block into the slab), an item use and a placeAs, the
// world's random ticks, broken into an item that is picked up, carried and
// placed again, saved (format v3) and back after a reload; an old save
// (format v2, byte ids) loads with all its edits; the distant terrain draws
// the block in its own colour. With --mp, online too (a host and a guest in
// two pages through a local PeerJS server): the join snapshot and the live
// edit batches carry the 16-bit ids both ways.
//
//   node r11-engine16-tests.mjs [--only=substring] [--seed=42] [--mp]
//
// Like the other suites, it fails on any console error or page error.
import http from "node:http";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
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
const PORT = 9940 + Math.floor(Math.random() * 40);
const SEED = Number(args.seed ?? 42);
const OLD_SEED = 7771; // (a world written by the previous version: the v2 byte format)
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
await new Promise((r) => server.listen(PORT, r));

const errors = [];
const results = [];
const browser = await chromium.launch({
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

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}
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
const until = async (fn, timeout = 30000, arg) => {
  const t0 = Date.now();
  while (Date.now() - t0 < timeout) {
    const r = await v(fn, arg);
    if (r) return r;
    await frames(2);
  }
  return null;
};

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

// ---------- Boot ----------
// In-page helpers (again after every load): aiming the player at a block face.
const helpers = () =>
  page.evaluate(() => {
    window.__t16 = {
      // Stands the player's eye a little off face n of block (x, y, z) (3.2
      // blocks over a top face: the body clear of the cell above), looking at
      // the face's centre, and updates the crosshair target.
      aim(g, [x, y, z], [nx, ny, nz]) {
        const pl = g.player;
        const px = x + 0.5 + nx * 0.5;
        const py = y + 0.5 + ny * 0.5;
        const pz = z + 0.5 + nz * 0.5;
        const d = ny > 0 ? 3.2 : 2.2;
        const ex = px + nx * d + (ny ? 0.01 : 0);
        const ey = py + ny * d;
        const ez = pz + nz * d;
        pl.velocity.set(0, 0, 0);
        const eyeOff = pl.getEyePosition().y - pl.position.y;
        pl.position.set(ex, ey - eyeOff, ez);
        const dx = px - ex;
        const dy = py - ey;
        const dz = pz - ez;
        pl.yaw = Math.atan2(-dx, -dz);
        pl.pitch = Math.asin(dy / Math.hypot(dx, dy, dz));
        g.interaction.updateTarget(true);
        return g.interaction.target;
      },
      rightClick(g) {
        g.interaction.mouseDown(2);
        g.interaction.mouseUp(2);
      },
    };
  });
async function boot() {
  await page.waitForFunction(() => !!window.__ufo, null, { timeout: 60000 });
  await page.evaluate(() => window.__ufo.setGraphics("low"));
  await page.waitForFunction(() => window.__ufo.graphicsReady, null, { timeout: 120000 });
  await helpers();
}
async function play() {
  const t0 = Date.now();
  while (Date.now() - t0 < 90000) {
    const st = await v((g) => g.gameState);
    if (st === "playing") return;
    if (st === "dead") {
      await v((g) => g.respawn());
      continue;
    }
    if (st === "start") {
      await page.click("#play-btn", { timeout: 5000 }).catch(() => {});
    } else if (await page.isVisible("#resume-btn")) {
      await page.click("#resume-btn", { timeout: 3000 }).catch(() => {});
    } else {
      await page.mouse.click(480, 270);
      await frames(5);
      if ((await v((g) => g.gameState)) === "paused" && !(await page.isVisible("#resume-btn"))) await page.evaluate(() => document.getElementById("pause-menu").classList.remove("hidden"));
    }
    await frames(3);
  }
  throw new Error(`the game didn't start playing (state ${await v((g) => g.gameState)})`);
}
await page.goto(`http://localhost:${PORT}/index.html?seed=${SEED}`, { waitUntil: "load", timeout: 60000 });
await boot();
await play();

// A test site: a 7x7 stone floor near spawn with air above it (built, so
// it is the same in every world), loaded and meshed. Returns { x, y, z }
// with (x, y - 1, z) the floor block under the middle.
const site = await v(async (g) => {
  g.testFlags.noMissions = true;
  const w = g.world;
  const x = Math.floor(g.spawn.x) + 7;
  const z = Math.floor(g.spawn.z) + 7;
  w.prepareArea(x, z, 2);
  const y = Math.max(w.surfaceY(x, z) + 1, 34);
  const list = [];
  for (let ax = -3; ax <= 3; ax++) {
    for (let az = -3; az <= 3; az++) {
      list.push(x + ax, y - 1, z + az, 3);
      for (let ay = 0; ay <= 5; ay++) list.push(x + ax, y + ay, z + az, 0);
    }
  }
  w.setBlocks(list);
  w.processQueues(50);
  return { x, y, z };
});
assert(site, "no flat test site near spawn");
const DEBUG_BLOCK = 4095;
const DEBUG_SLAB = 4094;

await check("a 16-bit block placed by a right click is in the world, recorded, meshed with its own texture layer, and lit", async () => {
  const r = await v(async (g, s) => {
    const { TILE } = await import("./js/blocks.js");
    const { makeStack } = await import("./js/inventory.js");
    g.setMode("survival");
    g.player.flying = false;
    const inv = g.inventory;
    inv.clear();
    inv.slots[0] = makeStack(4095, 5);
    inv.selected = 0;
    const t = window.__t16.aim(g, [s.x, s.y - 1, s.z], [0, 1, 0]);
    if (!t) return { aimed: false };
    window.__t16.rightClick(g);
    const placed = g.world.getBlock(s.x, s.y, s.z);
    const edit = g.world.edits.get(`${s.x >> 4},${s.z >> 4}`)?.get(((s.y << 8) | ((s.z & 15) << 4) | (s.x & 15)));
    g.world.processQueues(50); // (the edit's rebuild)
    const chunk = g.world.getChunk(s.x >> 4, s.z >> 4);
    const ex = chunk.meshes.opaque.geometry.getAttribute("aExtra").array;
    const pos = chunk.meshes.opaque.geometry.getAttribute("position").array;
    let faces = 0;
    for (let i = 0; i < ex.length / 4; i++) {
      if (ex[i * 4] + ex[i * 4 + 3] * 256 !== TILE.debug) continue;
      if (Math.floor(pos[i * 3] + 1e-4) - (s.x & 15) <= 1 && Math.abs(pos[i * 3 + 1] - s.y) <= 1 && Math.floor(pos[i * 3 + 2] + 1e-4) - (s.z & 15) <= 1) faces++;
    }
    const l = g.world.lightAt(s.x, s.y, s.z); // (opaque: holds no light)
    return { aimed: true, placed, edit, left: inv.countItem(4095), faces, sky: l.sky };
  }, site);
  assert(r.aimed && r.placed === DEBUG_BLOCK && r.edit === DEBUG_BLOCK && r.left === 4, JSON.stringify(r));
  assert(r.faces >= 16 && r.sky === 0, JSON.stringify(r));
});

await check("a debug slab: placed beside it, light reaches into it, and the player stands on its top (y + 0.5)", async () => {
  const r = await v(async (g, s) => {
    const { makeStack } = await import("./js/inventory.js");
    g.inventory.slots[1] = makeStack(4094, 3);
    g.inventory.selected = 1;
    const t = window.__t16.aim(g, [s.x + 2, s.y - 1, s.z], [0, 1, 0]);
    if (!t) return { aimed: false };
    window.__t16.rightClick(g);
    const placed = g.world.getBlock(s.x + 2, s.y, s.z);
    const light = g.world.lightAt(s.x + 2, s.y, s.z);
    // Drop the player onto it from a little above.
    g.player.flying = false;
    g.player.position.set(s.x + 2.5, s.y + 1.2, s.z + 0.5);
    g.player.velocity.set(0, 0, 0);
    return { aimed: true, placed, sky: light.sky };
  }, site);
  assert(r.aimed && r.placed === DEBUG_SLAB && r.sky > 0, JSON.stringify(r));
  await frames(40);
  const y = await v((g) => g.player.position.y);
  assert(Math.abs(y - (site.y + 0.5)) < 0.02, `standing at ${y}, the slab's top is ${site.y + 0.5}`);
});

await check("meshes of chunks with 16-bit blocks built in a worker are byte for byte the main thread's", async () => {
  const r = await v(async (g, s) => {
    const { meshChunk } = await import("./js/mesher.js");
    const w = g.world;
    if (!w._genWorkers || !w._genWorkers.length || !w.meshInWorkers) return { skipped: true };
    // A few more of both, across a chunk border.
    const bx = (s.x & ~15) + 15;
    for (let k = 0; k < 4; k++) w.setBlock(bx + (k & 1), s.y + 3 + (k >> 1), s.z, k & 1 ? 4094 : 4095);
    w.processQueues(50);
    const list = [w.getChunk(s.x >> 4, s.z >> 4), w.getChunk((bx + 1) >> 4, s.z >> 4)].filter(Boolean);
    const got = new Map();
    const orig = w._applyMeshResult.bind(w);
    w._applyMeshResult = (m) => {
      got.set(m.token, m.buffers);
      return orig(m);
    };
    const want = new Map();
    for (const c of list) {
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
    for (let k = 0; k < 4; k++) w.setBlock(bx + (k & 1), s.y + 3 + (k >> 1), s.z, 0);
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
    return { asked: want.size, compared, differing };
  }, site);
  assert(r.skipped || (r.asked >= 2 && r.compared === r.asked && r.differing === 0), JSON.stringify(r));
});

await check("block use: a right click turns the debug block into the slab; item use and placeAs are dispatched", async () => {
  const r = await v(async (g, s) => {
    const content = await import("./js/content/index.js");
    const B = await import("./js/blocks.js");
    const { ITEM } = await import("./js/items.js");
    const { makeStack } = await import("./js/inventory.js");
    const w = g.world;
    const out = {};
    // Block use (js/content/debug.js), with an empty hand.
    w.setBlock(s.x - 2, s.y, s.z, 4095);
    g.inventory.selected = 8;
    g.inventory.slots[8] = null;
    window.__t16.aim(g, [s.x - 2, s.y, s.z], [0, 0, 1]);
    window.__t16.rightClick(g);
    out.used = w.getBlock(s.x - 2, s.y, s.z);
    // Item use: a stick with a (temporary) handler.
    let ctx = null;
    content.ITEM_USE[ITEM.STICK] = (c) => ((ctx = { x: c.x, y: c.y, z: c.z, id: c.id, place: c.place, hit: !!c.hit }), true);
    g.inventory.slots[8] = makeStack(ITEM.STICK, 1);
    try {
      window.__t16.aim(g, [s.x, s.y - 1, s.z - 2], [0, 1, 0]);
      window.__t16.rightClick(g);
    } finally {
      content.ITEM_USE[ITEM.STICK] = null;
    }
    out.itemUse = ctx;
    // placeAs: the slab item placed as the block (temporary).
    B.BLOCK_INFO[4094].placeAs = (c) => (c.place ? 4095 : null);
    g.inventory.slots[8] = makeStack(4094, 1);
    try {
      window.__t16.aim(g, [s.x, s.y - 1, s.z - 2], [0, 1, 0]);
      window.__t16.rightClick(g);
    } finally {
      delete B.BLOCK_INFO[4094].placeAs;
    }
    out.placedAs = w.getBlock(s.x, s.y, s.z - 2);
    w.setBlocks([s.x - 2, s.y, s.z, 0, s.x, s.y, s.z - 2, 0]);
    return out;
  }, site);
  assert(r.used === DEBUG_SLAB, `block use: ${r.used}`);
  assert(r.itemUse && r.itemUse.x === site.x && r.itemUse.y === site.y - 1 && r.itemUse.place[1] === site.y && r.itemUse.hit, JSON.stringify(r.itemUse));
  assert(r.placedAs === DEBUG_BLOCK, `placeAs: ${r.placedAs}`);
});

await check("random ticks reach loaded blocks near the player (and cost nothing with none registered)", async () => {
  const r = await v(async (g) => {
    const content = await import("./js/content/index.js");
    const { BLOCK } = await import("./js/blocks.js");
    const w = g.world;
    let calls = 0;
    let wrong = 0;
    content.registerRandomTick(BLOCK.STONE, (world, x, y, z, id, rand) => {
      calls++;
      if (world !== w || id !== BLOCK.STONE || w.getBlock(x, y, z) !== BLOCK.STONE || !(rand() >= 0 && rand() < 1)) wrong++;
    });
    const before = w.stats.randomTicks || 0;
    let ran = 0;
    try {
      for (let i = 0; i < 20; i++) ran += w.randomTick(0.05, [g.player.position]);
    } finally {
      content.registerRandomTick(BLOCK.STONE, null);
    }
    const off = w.randomTick(1, [g.player.position]); // (nothing registered: nothing runs)
    return { calls, wrong, ran, counted: (w.stats.randomTicks || 0) - before, off, any: content.TICKING.any };
  });
  // (The nature module's crops, leaves and fire tick too now: count stone's calls among all the ticks.)
  assert(r.calls > 50 && r.wrong === 0 && r.ran >= r.calls && r.counted === r.ran + r.off, JSON.stringify(r));
});

await check("broken in survival it drops as an item, is picked up, carried and placed again", async () => {
  const r = await v(async (g, s) => {
    g.inventory.clear();
    const t = window.__t16.aim(g, [s.x, s.y, s.z], [0, 1, 0]);
    if (!t || t.id !== 4095) return { aimed: t && t.id };
    g.interaction._breakBlock(s.x, s.y, s.z, 4095, true);
    const drop = g.entities.items.find((it) => it.id === 4095 && Math.hypot(it.pos.x - s.x - 0.5, it.pos.z - s.z - 0.5) < 1.5);
    // Stand on the spot, so it is picked up.
    g.player.position.set(s.x + 0.5, s.y, s.z + 0.5);
    g.player.velocity.set(0, 0, 0);
    return { aimed: 4095, gone: g.world.getBlock(s.x, s.y, s.z), drop: !!drop };
  }, site);
  assert(r.aimed === DEBUG_BLOCK && r.gone === 0 && r.drop, JSON.stringify(r));
  const got = await until((g) => g.inventory.countItem(4095) === 1, 20000);
  assert(got, "the dropped debug block was never picked up");
  const again = await v((g, s) => {
    g.inventory.selected = g.inventory.slots.findIndex((st) => st && st.id === 4095);
    if (g.inventory.selected > 8) return { hotbar: false };
    window.__t16.aim(g, [s.x, s.y - 1, s.z], [0, 1, 0]);
    window.__t16.rightClick(g);
    return { placed: g.world.getBlock(s.x, s.y, s.z), left: g.inventory.countItem(4095) };
  }, site);
  assert(again.placed === DEBUG_BLOCK && again.left === 0, JSON.stringify(again));
});

await check("saved (format v3) and back after a reload", async () => {
  const saved = await v((g) => {
    g.flushSave();
    const raw = JSON.parse(localStorage.getItem(`ufocombat_v1_edits_${g.world.seed}`));
    return { v: raw.v, wide: Object.values(raw.chunks).some((s) => s.startsWith("!")) };
  });
  assert(saved.v === 3 && saved.wide, JSON.stringify(saved));
  await page.reload({ waitUntil: "load", timeout: 60000 });
  await boot();
  await play();
  const r = await v((g, s) => {
    g.world.prepareArea(s.x, s.z, 1);
    return [g.world.getBlock(s.x, s.y, s.z), g.world.getBlock(s.x + 2, s.y, s.z)];
  }, site);
  assert(r[0] === DEBUG_BLOCK && r[1] === DEBUG_SLAB, JSON.stringify(r));
});

await check("the distant terrain draws a 16-bit block in its own colour", async () => {
  const r = await v(async (g, s) => {
    const { LodTerrain, buildLodTile, makeLodPalette, tileSpan } = await import("./js/lod-mesher.js");
    const w = g.world;
    const pal = makeLodPalette(w.facePalette);
    const lt = new LodTerrain(w.seed);
    // A debug block on top of a column, as the edits of an unloaded chunk.
    const x = s.x;
    const z = s.z;
    const h = w.surfaceY(x, z);
    lt.setChunkEdits(`${x >> 4},${z >> 4}`, [((h + 4) << 8) | ((z & 15) << 4) | (x & 15), 4095]);
    // A level-1 tile: cells of 2 blocks sampled at their centre (an odd block).
    const span = tileSpan(1);
    const tx = Math.floor((x - 1) / span);
    const tz = Math.floor((z - 1) / span);
    const cx = x - ((x - 1) & 1) ; // (the cell's sample point: odd coordinates)
    const cz = z - ((z - 1) & 1);
    lt.setChunkEdits(`${cx >> 4},${cz >> 4}`, [((h + 4) << 8) | ((cz & 15) << 4) | (cx & 15), 4095]);
    const mesh = buildLodTile(lt, 1, tx, tz, pal);
    const want = pal.top[4095];
    let hits = 0;
    for (let i = 0; i < mesh.color.length; i += 4) if (mesh.color[i] === want[0] && mesh.color[i + 1] === want[1] && mesh.color[i + 2] === want[2]) hits++;
    return { hits, want, stone: pal.top[3], palette: w.facePalette.top.length };
  }, site);
  assert(r.palette === 4096 * 3 && r.hits >= 4 && r.want.join() !== r.stone.join() && r.want.some((c) => c > 0), JSON.stringify(r));
});

await check("an old save (format v2, byte ids) loads with all its edits", async () => {
  // As the previous version wrote it: records of [index lo, index hi, run, id].
  await v((g, seed) => {
    const rec = (x, y, z, run, id) => {
      const i = (y << 8) | (z << 4) | x;
      return [i & 255, i >> 8, run, id];
    };
    const b64 = (bytes) => btoa(String.fromCharCode(...bytes));
    const data = { v: 2, chunks: { "0,0": b64([...rec(2, 100, 3, 4, 9), ...rec(2, 101, 3, 1, 41), ...rec(5, 102, 5, 1, 23)]), "-1,0": b64(rec(15, 100, 0, 1, 18)) } };
    localStorage.setItem(`ufocombat_v1_edits_${seed}`, JSON.stringify(data));
    g.flushSave();
  }, OLD_SEED);
  await page.goto(`http://localhost:${PORT}/index.html?seed=${OLD_SEED}`, { waitUntil: "load", timeout: 60000 });
  await boot();
  await play();
  const r = await v((g) => {
    g.world.prepareArea(0, 0, 1);
    const b = (x, y, z) => g.world.getBlock(x, y, z);
    return { seed: g.world.seed, glass: [2, 3, 4, 5].map((x) => b(x, 100, 3)), chest: b(2, 101, 3), bricks: b(5, 102, 5), lumen: b(-1, 100, 0) };
  });
  assert(r.seed === OLD_SEED && r.glass.every((id) => id === 9) && r.chest === 41 && r.bricks === 23 && r.lumen === 18, JSON.stringify(r));
});

// ---------- Online (--mp) ----------
async function mpChecks() {
  const { default: express } = await import("express");
  const { ExpressPeerServer } = await import("peer");
  const PEER_PORT = PORT + 60;
  const app = express();
  const peerHttp = app.listen(PEER_PORT, "127.0.0.1");
  app.use("/ufo", ExpressPeerServer(peerHttp, { path: "/" }));
  const NET_Q = `peerServer=127.0.0.1:${PEER_PORT}/ufo&noStun=1&graphics=low`;
  const peerjsFile = path.join(__dirname, "node_modules", "peerjs", "dist", "peerjs.min.js");
  const newPage = async (label) => {
    const ctx = await browser.newContext({ viewport: { width: 640, height: 360 } });
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
  };
  const pv = (p, fn, arg) => p.evaluate(([src, a]) => new Function("g", "arg", `return (${src})(g, arg);`)(window.__ufo, a), [fn.toString(), arg]);
  const puntil = async (p, fn, timeout = 30000, arg) => {
    const t0 = Date.now();
    while (Date.now() - t0 < timeout) {
      const r = await pv(p, fn, arg);
      if (r) return r;
      await new Promise((res) => setTimeout(res, 150));
    }
    return null;
  };
  const host = await newPage("host");
  const guest = await newPage("guest");
  // Near the host's spawn: the spots both pages have loaded.
  let spot = null;

  await check("online: a joining guest gets the host's 16-bit blocks in the join snapshot", async () => {
    await host.goto(`http://127.0.0.1:${PORT}/index.html?seed=${SEED + 1}&${NET_Q}`, { waitUntil: "load", timeout: 60000 });
    await host.waitForFunction(() => !!window.__ufo && window.__ufo.graphicsReady, null, { timeout: 120000 });
    await host.click("#menu-mp-btn");
    await host.fill("#mp-nick", "Alice");
    await host.click("#mp-host-btn");
    const code = await puntil(host, (g) => g.net.code, 30000);
    assert(code, "no room code");
    await host.click("#mp-lobby-play");
    await host.waitForFunction(() => window.__ufo.gameState === "playing", null, { timeout: 30000 });
    spot = await pv(host, (g) => {
      g.testFlags.noMissions = true;
      const x = Math.floor(g.player.position.x) + 3;
      const z = Math.floor(g.player.position.z) + 3;
      g.world.prepareArea(x, z, 1);
      const y = g.world.surfaceY(x, z) + 1;
      g.world.setBlock(x, y + 2, z, 4095); // (in the air: nothing pops or falls)
      return { x, y: y + 2, z };
    });
    await guest.goto(`http://127.0.0.1:${PORT}/index.html?join=${code}&${NET_Q}`, { waitUntil: "load", timeout: 60000 });
    await guest.waitForSelector("#mp-join-boot:not(.hidden)", { timeout: 30000 });
    await guest.fill("#mp-boot-nick", "Bob");
    await guest.click("#mp-boot-join");
    await guest.waitForFunction(() => !!window.__ufo && window.__ufo.graphicsReady, null, { timeout: 120000 });
    assert(await puntil(guest, (g) => g.mp.stateLoaded, 60000), "the host's state never arrived");
    const r = await puntil(guest, (g, s) => {
      g.world.prepareArea(s.x, s.z, 1);
      const id = g.world.getBlock(s.x, s.y, s.z);
      return id === 4095 ? { id, unreadable: g.mp.world.stats.unreadable } : null;
    }, 30000, spot);
    assert(r && r.unreadable === 0, `the guest sees ${JSON.stringify(r)}`);
  });

  await check("online: live edit batches carry 16-bit ids both ways", async () => {
    assert(spot, "no spot");
    await pv(host, (g, s) => g.world.setBlock(s.x + 1, s.y, s.z, 4094), spot);
    const atGuest = await puntil(guest, (g, s) => g.world.getBlock(s.x + 1, s.y, s.z) === 4094, 20000, spot);
    await pv(guest, (g, s) => {
      g.world.prepareArea(s.x, s.z, 1);
      g.world.setBlock(s.x - 1, s.y, s.z, 4095);
    }, spot);
    const atHost = await puntil(host, (g, s) => g.world.getBlock(s.x - 1, s.y, s.z) === 4095, 20000, spot);
    const edit = await pv(host, (g, s) => g.world.edits.get(`${(s.x - 1) >> 4},${s.z >> 4}`)?.get((s.y << 8) | ((s.z & 15) << 4) | ((s.x - 1) & 15)), spot);
    const bad = await Promise.all([host, guest].map((p) => pv(p, (g) => g.mp.world.stats.unreadable)));
    assert(atGuest && atHost && edit === DEBUG_BLOCK && bad.every((n) => n === 0), JSON.stringify({ atGuest, atHost, edit, bad }));
  });
  await host.context().close();
  await guest.context().close();
  peerHttp.close();
}
if (args.mp) await mpChecks();

// ---------- Summary ----------
const failed = results.filter(([, ok]) => !ok);
console.log(`\n${results.length - failed.length} passed, ${failed.length} failed${errors.length ? `; console errors: ${errors.length}` : ""}.`);
if (errors.length) console.log(errors.slice(0, 5).join("\n"));
await browser.close();
server.close();
process.exit(failed.length || errors.length ? 1 : 0);
