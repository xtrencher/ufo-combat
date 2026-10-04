// Round 10 village tests: boots the real game in headless Chromium (software
// WebGL, Low preset) and checks the wall torches and chests in single
// player: a village's wall torches hang on real walls and light the rooms,
// houses have chests; a torch on the side of a block hangs on it (on top it
// stands, underneath it doesn't go); right click opens a chest, a
// shift-click takes an item, and a reload keeps what is left; a broken
// wall drops its torch; a broken chest drops its contents and a placed one
// starts empty; meshes of chunks with the new blocks are byte for byte the
// same from the workers. With --mp, online too (a host and a guest in two
// pages through a local PeerJS server, like mp-tests.mjs): the guest opens a
// chest and sees the host's contents, both have it open and see each
// other's clicks, a stale click is refused and nothing is lost, and a chest
// the guest breaks spills the host's contents for both.
//
//   node r10-villages-tests.mjs [--only=substring] [--seed=42] [--mp]
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
const PORT = 9840 + Math.floor(Math.random() * 40);
const SEED = Number(args.seed ?? 42);
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
async function boot() {
  await page.waitForFunction(() => !!window.__ufo, null, { timeout: 60000 });
  await page.evaluate(() => window.__ufo.setGraphics("low"));
  await page.waitForFunction(() => window.__ufo.graphicsReady, null, { timeout: 120000 });
}
await page.goto(`http://localhost:${PORT}/index.html?seed=${SEED}`, { waitUntil: "load", timeout: 60000 });
await boot();

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
await play();

// To the nearest village, standing on its plaza (Survival, no missions, no
// creatures in the way). Returns what it holds: { center, houses, torches:
// [[x, y, z, id]], chests: [[x, y, z, id]] }.
const goVillage = () =>
  v(async (g) => {
    const B = await import("./js/blocks.js");
    g.testFlags.noMissions = true;
    if (g.player.creative) g.setMode("survival");
    const vg = g.world.terrain.villages;
    const c = vg.nearestVillage(g.player.position.x, g.player.position.z, 8000);
    if (!c) return null;
    const w = g.world;
    w.prepareArea(c.x, c.z, 3);
    g.player.position.set(c.x + 0.5, c.groundY + 1, c.z + 3.5);
    g.player.velocity.set(0, 0, 0);
    g.streamAround(c.x, c.z);
    g.mobs.clear?.();
    const torches = [];
    const chests = [];
    for (let dx = -30; dx <= 30; dx++) {
      for (let dz = -30; dz <= 30; dz++) {
        for (let dy = 0; dy <= 12; dy++) {
          const x = c.x + dx;
          const y = c.groundY + dy;
          const z = c.z + dz;
          const id = w.getBlock(x, y, z);
          if (B.IS_WALL_TORCH[id]) torches.push([x, y, z, id]);
          else if (B.IS_CHEST[id]) chests.push([x, y, z, id]);
        }
      }
    }
    return { center: { x: c.x, z: c.z, groundY: c.groundY }, houses: vg.houses(c).length, torches, chests };
  });

let village = null;

await check("a village: wall torches hang on real walls and light the rooms; houses have chests facing into the room", async () => {
  village = await goVillage();
  assert(village, "no village found");
  const r = await v(async (g, vil) => {
    const B = await import("./js/blocks.js");
    const w = g.world;
    const light = (x, y, z) => w.getChunk(x >> 4, z >> 4).light[(y << 8) | ((z & 15) << 4) | (x & 15)] & 15;
    let floating = 0;
    let dim = 0;
    let blockedFront = 0;
    for (const [x, y, z, id] of vil.torches) {
      const [fx, fz] = B.BLOCK_INFO[id].facing;
      if (!B.isWallSupportedBy(w.getBlock(x - fx, y, z - fz))) floating++;
      if (w.getBlock(x + fx, y, z + fz) !== B.BLOCK.AIR) blockedFront++;
      if (light(x, y, z) < 13) dim++;
    }
    let chestsOk = 0;
    for (const [x, y, z, id] of vil.chests) {
      const [fx, fz] = B.BLOCK_INFO[id].facing;
      if (w.getBlock(x + fx, y, z + fz) === B.BLOCK.AIR && B.isWallSupportedBy(w.getBlock(x - fx, y, z - fz))) chestsOk++;
    }
    return { torches: vil.torches.length, floating, dim, blockedFront, chests: vil.chests.length, chestsOk, houses: vil.houses };
  }, village);
  assert(r.torches >= r.houses * 2 && r.floating === 0 && r.dim === 0 && r.blockedFront === 0, JSON.stringify(r));
  assert(r.chests >= 1 && r.chestsOk === r.chests, JSON.stringify(r));
});

await check("a torch on the side of a block hangs on it, on top it stands, underneath it doesn't go", async () => {
  const r = await v(async (g, vil) => {
    const B = await import("./js/blocks.js");
    const w = g.world;
    const { x: cx, z: cz, groundY: gy } = vil.center;
    // A stone block floating over the plaza's corner, two above the ground.
    const P = [cx + 2, gy + 3, cz - 3];
    w.setBlocks([P[0], P[1], P[2], B.BLOCK.STONE, P[0] + 1, P[1], P[2], 0, P[0], P[1] + 1, P[2], 0, P[0], P[1] - 1, P[2], 0]);
    const inter = g.interaction;
    g.inventory.slots[0] = { id: B.BLOCK.TORCH, count: 10 };
    g.inventory.selected = 0;
    const at = (normal, place) => {
      inter.target = { block: P, place, normal, id: B.BLOCK.STONE, distance: 2 };
      return inter._place(B.BLOCK.TORCH);
    };
    const side = at([1, 0, 0], [P[0] + 1, P[1], P[2]]);
    const top = at([0, 1, 0], [P[0], P[1] + 1, P[2]]);
    const under = at([0, -1, 0], [P[0], P[1] - 1, P[2]]);
    const out = {
      side,
      sideId: w.getBlock(P[0] + 1, P[1], P[2]),
      top,
      topId: w.getBlock(P[0], P[1] + 1, P[2]),
      under,
      underId: w.getBlock(P[0], P[1] - 1, P[2]),
      left: g.inventory.slots[0]?.count,
      wanted: B.wallTorch(1, 0),
      // (a selection box of its own, leaning out from the wall: world.js selectionBox)
      box: (await import("./js/world.js")).selectionBox(B.wallTorch(1, 0)),
    };
    w.setBlocks([P[0], P[1], P[2], 0, P[0] + 1, P[1], P[2], 0, P[0], P[1] + 1, P[2], 0]);
    inter.target = null;
    return out;
  }, village);
  assert(r.side && r.sideId === r.wanted, JSON.stringify(r));
  assert(r.top && r.topId === 17 && !r.under && r.underId === 0 && r.left === 8, JSON.stringify(r));
  assert(r.box && r.box[0] === 0 && r.box[3] < 0.5 && r.box[1] > 0, `wall torch selection box ${JSON.stringify(r.box)}`);
});

let opened = null;
await check("right click opens a chest: loot of the chain's tier, and a shift-click takes a stack into the inventory", async () => {
  assert(village?.chests.length, "no chest");
  const r = await v(async (g, vil) => {
    const B = await import("./js/blocks.js");
    const [x, y, z, id] = vil.chests[0];
    const [fx, fz] = B.BLOCK_INFO[id].facing;
    const p = g.player;
    p.position.set(x + 0.5 + fx * 1.7, y, z + 0.5 + fz * 1.7);
    p.velocity.set(0, 0, 0);
    const eye = p.getEyePosition();
    const dx = x + 0.5 - eye.x;
    const dy = y + 0.4 - eye.y;
    const dz = z + 0.5 - eye.z;
    p.yaw = Math.atan2(-dx, -dz);
    p.pitch = Math.asin(dy / Math.hypot(dx, dy, dz));
    g.inventory.clear();
    g.interaction.updateTarget(true);
    const target = g.interaction.target ? g.interaction.target.id : null;
    g.interaction.mouseDown(2);
    g.interaction.mouseUp(2);
    return { target, state: g.gameState, pos: [x, y, z] };
  }, village);
  assert(r.target !== null && r.state === "inventory", JSON.stringify(r));
  await frames(3);
  const s = await v((g) => {
    const view = g.invScreen.chestView;
    const items = view?.slots?.filter(Boolean).map((st) => [st.id, st.count]) || [];
    return { ready: !!view?.ready, items, first: view?.slots?.findIndex(Boolean), visible: !document.querySelector(".inv-chest").classList.contains("hidden") };
  });
  assert(s.ready && s.items.length >= 1 && s.visible, JSON.stringify(s));
  // A real shift-click on the first full slot.
  await page.evaluate((i) => {
    const el = document.querySelectorAll(".inv-chest .slot")[i];
    el.dispatchEvent(new MouseEvent("mousedown", { button: 0, shiftKey: true, bubbles: true }));
  }, s.first);
  await frames(2);
  const t = await v((g, i) => {
    const view = g.invScreen.chestView;
    return { slot: view.slots[i], inv: g.inventory.slots.filter(Boolean).map((st) => [st.id, st.count]) };
  }, s.first);
  const took = s.items[0];
  assert(!t.slot && t.inv.some(([id, n]) => id === took[0] && n === took[1]), JSON.stringify({ s, t }));
  await page.keyboard.press("Escape");
  await frames(3);
  const st = await v((g) => ({ state: g.gameState, view: !!g.interaction.chests.view }));
  assert(st.state !== "inventory" && !st.view, JSON.stringify(st));
  opened = { pos: r.pos, left: s.items.slice(1) };
});

await check("a reload keeps the chest's contents (opened chests are saved with the world)", async () => {
  assert(opened, "no chest opened");
  await v((g) => g.flushSave());
  await page.reload({ waitUntil: "load", timeout: 60000 });
  await boot();
  await play();
  const r = await v((g, pos) => {
    const [x, y, z] = pos;
    g.world.prepareArea(x, z, 2);
    const slots = g.interaction.chests.store.get(`${x},${y},${z}`);
    return { stored: !!slots, items: slots ? slots.filter(Boolean).map((st) => [st.id, st.count]) : null };
  }, opened.pos);
  const sort = (l) => JSON.stringify([...l].sort((a, b) => a[0] - b[0] || a[1] - b[1]));
  assert(r.stored && sort(r.items) === sort(opened.left), JSON.stringify({ r, want: opened.left }));
});

await check("a broken wall drops its torch; a broken chest drops its contents, and a chest put back starts empty", async () => {
  village = await goVillage();
  const r = await v(async (g, vil) => {
    const B = await import("./js/blocks.js");
    const w = g.world;
    const near = (x, y, z, id) => g.entities.items.filter((it) => (id === undefined || it.id === id) && Math.hypot(it.pos.x - x - 0.5, it.pos.z - z - 0.5) < 2.5 && Math.abs(it.pos.y - y) < 3).length;
    // An inside torch (head height), its wall mined away.
    const [tx, ty, tz, tid] = vil.torches.find(([, y]) => y === vil.center.groundY + 3);
    const [fx, fz] = B.BLOCK_INFO[tid].facing;
    const before = near(tx, ty, tz, B.BLOCK.TORCH);
    w.setBlock(tx - fx, ty, tz - fz, 0);
    const torchCell = w.getBlock(tx, ty, tz);
    const dropped = near(tx, ty, tz, B.BLOCK.TORCH) - before;
    // The last chest: what it holds (rolled now), then broken.
    const [cx, cy, cz] = vil.chests[vil.chests.length - 1];
    const holds = g.interaction.chests.contents(cx, cy, cz).filter(Boolean).length;
    const itemsBefore = near(cx, cy, cz);
    w.setBlock(cx, cy, cz, 0);
    const spilled = near(cx, cy, cz) - itemsBefore;
    const forgotten = !g.interaction.chests.store.has(`${cx},${cy},${cz}`);
    // A chest put there by a player: empty.
    w.setBlock(cx, cy, cz, B.BLOCK.CHEST);
    const placed = g.interaction.chests.contents(cx, cy, cz).filter(Boolean).length;
    return { torchCell, dropped, holds, spilled, forgotten, placed };
  }, village);
  assert(r.torchCell === 0 && r.dropped === 1, JSON.stringify(r));
  assert(r.holds >= 1 && r.spilled === r.holds && r.forgotten && r.placed === 0, JSON.stringify(r));
});

await check("chunks with wall torches and chests: meshes built in a worker are byte for byte the main thread's", async () => {
  const r = await v(async (g, vil) => {
    const { meshChunk } = await import("./js/mesher.js");
    const B = await import("./js/blocks.js");
    const w = g.world;
    if (!w.meshInWorkers || !w._meshSlot) return { skipped: true };
    const list = [...w.chunks.values()].filter((c) => w._isReady(c) && c.blocks.some((b) => B.IS_CHEST[b] || B.IS_WALL_TORCH[b])).slice(0, 8);
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
  }, village);
  assert(r.skipped || (r.asked >= 1 && r.compared === r.asked && r.differing === 0), JSON.stringify(r));
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
  const until = async (p, fn, timeout = 30000, arg) => {
    const t0 = Date.now();
    while (Date.now() - t0 < timeout) {
      const r = await pv(p, fn, arg);
      if (r) return r;
      await new Promise((res) => setTimeout(res, 150));
    }
    return null;
  };
  const pframes = (p, n = 2) => p.evaluate((k) => new Promise((r) => { let i = 0; const f = () => (++i >= k ? r() : requestAnimationFrame(f)); requestAnimationFrame(f); }), n);
  // Back in control (as mp-tests.mjs does it: a click, else the menus' buttons).
  const mpPlay = async (p) => {
    if ((await pv(p, (g) => g.gameState)) === "dead") await pv(p, (g) => g.respawn());
    if ((await pv(p, (g) => g.gameState)) === "playing") return;
    for (let k = 0; k < 3 && !(await p.isVisible("#resume-btn")) && (await pv(p, (g) => g.gameState)) === "paused"; k++) {
      await p.mouse.click(320, 180);
      await pframes(p, 5);
      if ((await pv(p, (g) => g.gameState)) === "playing") return;
    }
    for (const id of ["mp-lobby", "mp-screen"]) await p.evaluate((i) => document.getElementById(i).classList.add("hidden"), id);
    await pv(p, (g) => g.screens.closeAll());
    if ((await pv(p, (g) => g.gameState)) === "paused") await p.evaluate(() => document.getElementById("pause-menu").classList.remove("hidden"));
    const btn = (await pv(p, (g) => g.gameState)) === "start" ? "#play-btn" : "#resume-btn";
    await p.click(btn, { timeout: 60000 });
    await p.waitForFunction(() => window.__ufo.gameState === "playing", null, { timeout: 30000 });
  };
  const host = await newPage("host");
  const guest = await newPage("guest");
  let chestPos = null;
  // Both at the village, the guest in front of a chest, looking at it.
  // (side: a step to the side, so two players don't stand in each other's way)
  const toChest = async (p, pos, side = 0) => {
    await mpPlay(p);
    return pv(p, async (g, [pos, side]) => {
      const B = await import("./js/blocks.js");
      g.testFlags.noMissions = true;
      const [x, y, z] = pos;
      g.world.prepareArea(x, z, 2);
      g.streamAround(x, z);
      const id = g.world.getBlock(x, y, z);
      const [fx, fz] = B.BLOCK_INFO[id].facing;
      const pl = g.player;
      pl.flying = false;
      // (to the open side: a chest in a corner has a wall on the other)
      if (side && g.world.isSolidAt(x - fz * Math.sign(side), y, z + fx * Math.sign(side))) side = -side;
      pl.position.set(x + 0.5 + fx * 1.7 - fz * side, y, z + 0.5 + fz * 1.7 + fx * side);
      pl.velocity.set(0, 0, 0);
      const eye = pl.getEyePosition();
      const dx = x + 0.5 - eye.x;
      const dy = y + 0.4 - eye.y;
      const dz = z + 0.5 - eye.z;
      pl.yaw = Math.atan2(-dx, -dz);
      pl.pitch = Math.asin(dy / Math.hypot(dx, dy, dz));
      g.inventory.clear();
      g.interaction.updateTarget(true);
      const t = g.interaction.target;
      if (!t || !B.IS_CHEST[t.id]) return { open: false, state: g.gameState, target: t ? t.id : null, entity: !!g.interaction.entityHit };
      g.interaction.mouseDown(2);
      g.interaction.mouseUp(2);
      return { open: g.gameState === "inventory", state: g.gameState };
    }, [pos, side]);
  };
  const shiftClick = (p, i) => p.evaluate((i) => document.querySelectorAll(".inv-chest .slot")[i].dispatchEvent(new MouseEvent("mousedown", { button: 0, shiftKey: true, bubbles: true })), i);
  const enc = (slots) => JSON.stringify(slots.map((s) => (s ? [s.id, s.count] : 0)));

  await check("online: a guest opens a village chest and sees the host's contents", async () => {
    await host.goto(`http://127.0.0.1:${PORT}/index.html?seed=${SEED}&${NET_Q}`, { waitUntil: "load", timeout: 60000 });
    await host.waitForFunction(() => !!window.__ufo && window.__ufo.graphicsReady, null, { timeout: 120000 });
    await host.click("#menu-mp-btn");
    await host.fill("#mp-nick", "Alice");
    await host.click("#mp-host-btn");
    const code = await until(host, (g) => g.net.code, 30000);
    assert(code, "no room code");
    await host.click("#mp-lobby-play");
    await host.waitForFunction(() => window.__ufo.gameState === "playing", null, { timeout: 30000 });
    // (A chest in the nearest village; one nobody opened yet.)
    chestPos = await pv(host, async (g) => {
      const B = await import("./js/blocks.js");
      const c = g.world.terrain.villages.nearestVillage(g.player.position.x, g.player.position.z, 8000);
      g.world.prepareArea(c.x, c.z, 3);
      for (let dx = -30; dx <= 30; dx++) for (let dz = -30; dz <= 30; dz++) for (let dy = 0; dy <= 3; dy++) if (B.IS_CHEST[g.world.getBlock(c.x + dx, c.groundY + dy, c.z + dz)] && !g.interaction.chests.store.has(`${c.x + dx},${c.groundY + dy},${c.z + dz}`)) return [c.x + dx, c.groundY + dy, c.z + dz];
      return null;
    });
    assert(chestPos, "no chest in the village");
    await guest.goto(`http://127.0.0.1:${PORT}/index.html?join=${code}&${NET_Q}`, { waitUntil: "load", timeout: 60000 });
    await guest.waitForSelector("#mp-join-boot:not(.hidden)", { timeout: 30000 });
    await guest.fill("#mp-boot-nick", "Bob");
    await guest.click("#mp-boot-join");
    await guest.waitForFunction(() => !!window.__ufo && window.__ufo.graphicsReady, null, { timeout: 120000 });
    assert(await until(guest, (g) => g.mp.stateLoaded, 60000), "the host's state never arrived");
    // (The host stands near too, so the ground there is loaded on both.)
    await pv(host, (g, pos) => {
      g.player.position.set(pos[0] + 0.5, pos[1] + 6, pos[2] + 6.5);
      g.player.flying = true;
    }, chestPos);
    const opened = await toChest(guest, chestPos, 0);
    assert(opened.open, `the guest's chest screen didn't open: ${JSON.stringify(opened)}`);
    const ready = await until(guest, (g) => g.invScreen.chestView?.ready, 10000);
    assert(ready, "the host never answered");
    const r = await pv(guest, (g) => g.invScreen.chestView.slots.map((s) => (s ? [s.id, s.count] : 0)));
    const h = await pv(host, (g, pos) => g.interaction.chests.store.get(pos.join(","))?.map((s) => (s ? [s.id, s.count] : 0)), chestPos);
    assert(h && JSON.stringify(r) === JSON.stringify(h) && r.some(Boolean), JSON.stringify({ guest: r, host: h }));
  });

  await check("online: with the chest open on both, each side's clicks show on the other, in the host's order", async () => {
    assert(chestPos, "no chest");
    const opened = await toChest(host, chestPos, 1);
    assert(opened.open, `the host's chest screen didn't open: ${JSON.stringify(opened)}`);
    const first = await pv(guest, (g) => g.invScreen.chestView.slots.findIndex(Boolean));
    await shiftClick(guest, first);
    const took = await until(guest, (g, i) => !g.invScreen.busy && !g.invScreen.chestView.slots[i] && g.inventory.slots.some(Boolean) && g.inventory.slots.filter(Boolean).map((s) => [s.id, s.count]), 10000, first);
    assert(took, "the guest's shift-click never went through");
    const hostSees = await until(host, (g, i) => !g.interaction.chests.store.get(g.invScreen.chestView.key)[i] && !g.invScreen.chestViews[i].stack, 10000, first);
    assert(hostSees, "the host's screen doesn't show the guest's take");
    const second = await pv(host, (g) => g.invScreen.chestView.slots.findIndex(Boolean));
    if (second >= 0) {
      await shiftClick(host, second);
      const guestSees = await until(guest, (g, i) => !g.invScreen.chestView.slots[i] && !g.invScreen.chestViews[i].stack, 10000, second);
      assert(guestSees, "the guest's screen doesn't show the host's take");
    }
    // A stale click (what the slot held a moment ago): refused, nothing changes.
    const stale = await pv(guest, async (g, i) => {
      const inv = JSON.stringify(g.inventory.slots);
      const ok = await new Promise((res) => g.interaction.chests.submit([[i, { id: 261, count: 1 }, null]], res));
      return { ok, same: inv === JSON.stringify(g.inventory.slots) };
    }, first);
    assert(!stale.ok && stale.same, JSON.stringify(stale));
    const g2 = await pv(guest, (g) => g.invScreen.chestView.slots.map((s) => (s ? [s.id, s.count] : 0)));
    const h2 = await pv(host, (g, pos) => g.interaction.chests.store.get(pos.join(",")).map((s) => (s ? [s.id, s.count] : 0)), chestPos);
    assert(JSON.stringify(g2) === JSON.stringify(h2), JSON.stringify({ guest: g2, host: h2 }));
  });

  await check("online: a chest the guest breaks spills the host's contents for both, and both screens close", async () => {
    assert(chestPos, "no chest");
    const holds = await pv(host, (g, pos) => g.interaction.chests.store.get(pos.join(",")).filter(Boolean).length, chestPos);
    const near = (g, pos) => g.entities.items.filter((it) => Math.hypot(it.pos.x - pos[0] - 0.5, it.pos.z - pos[2] - 0.5) < 3).length;
    const before = await pv(guest, near, chestPos);
    await pv(guest, (g, pos) => g.world.setBlock(pos[0], pos[1], pos[2], 0), chestPos);
    const hostState = await until(host, (g, pos) => g.world.getBlock(pos[0], pos[1], pos[2]) === 0 && g.gameState !== "inventory" && g.gameState, 10000, chestPos);
    const guestState = await pv(guest, (g) => g.gameState);
    const spilled = await until(guest, (g, a) => {
      const n = g.entities.items.filter((it) => Math.hypot(it.pos.x - a.pos[0] - 0.5, it.pos.z - a.pos[2] - 0.5) < 3).length - a.before;
      return n >= a.holds ? n : 0;
    }, 10000, { pos: chestPos, before, holds });
    assert(hostState && guestState !== "inventory", JSON.stringify({ hostState, guestState }));
    assert(holds === 0 || spilled === holds, JSON.stringify({ holds, spilled }));
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
