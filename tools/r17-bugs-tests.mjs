// Round 17 bug-fix tests (track E): a regression check per fixed bug.
// (Each is in the browser unless it says otherwise; a Survival world in
// Creative, seed 1717, unless the check loads its own page.)
//
//   node r17-bugs-tests.mjs [--only=substring]
// (GAME_ROOT=dir runs another copy of the game: an older one shows the bugs.)
import http from "node:http";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";

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
  if (args.only && !name.startsWith("boot") && !name.toLowerCase().includes(String(args.only).toLowerCase())) return;
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

const { chromium } = await import("playwright-core");
const PORT = 9910 + Math.floor(Math.random() * 40);
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
const ctx = await browser.newContext({ viewport: { width: 960, height: 540 } });
const page = await ctx.newPage();
const localThreeRoot = path.join(__dirname, "node_modules", "three");
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
const until = async (fn, timeout = 60000, arg) => {
  const t0 = Date.now();
  while (Date.now() - t0 < timeout) {
    const r = await v(fn, arg);
    if (r) return r;
    await new Promise((res) => setTimeout(res, 200));
  }
  return null;
};
const v = (fn, arg) => page.evaluate(([src, a]) => new Function("g", "arg", `return (${src})(g, arg);`)(window.__ufo, a), [fn.toString(), arg]);
async function play() {
  const t0 = Date.now();
  while (Date.now() - t0 < 300000) {
    const st = await v((g) => g.gameState);
    if (st === "playing") return;
    if (st === "dead") {
      await v((g) => g.respawn());
      continue;
    }
    const click = (sel) => page.evaluate((s) => document.querySelector(s)?.click(), sel).catch(() => {});
    if (st === "start") await click("#play-btn");
    else if (await page.isVisible("#resume-btn")) await click("#resume-btn");
    else await page.mouse.click(300, 200);
    await frames(3);
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


// A flat stone field at y 60 round the player (loaded chunks), the player
// on it in Creative; `extra` cells [dx, dy, dz, id] relative to (x0, y, z0).
const FIELD = `async (g, extra) => {
  const { BLOCK } = await import("./js/blocks.js");
  const p = g.player;
  const x0 = Math.floor(p.position.x), z0 = Math.floor(p.position.z);
  for (let i = 0; i < 200; i++) { let ok = true; for (let z = z0 - 24; z <= z0 + 24; z += 16) for (let x = x0 - 24; x <= x0 + 24; x += 16) if (!g.world.getChunk(x >> 4, z >> 4)) ok = false; if (ok) break; await new Promise((r) => setTimeout(r, 300)); }
  const y = 60;
  const list = [];
  for (let x = x0 - 20; x <= x0 + 20; x++) for (let z = z0 - 20; z <= z0 + 20; z++) for (let k = -4; k < 12; k++) list.push(x, y + k, z, k < 0 ? BLOCK.STONE : 0);
  for (const [dx, dy, dz, id] of extra || []) list.push(x0 + dx, y + dy, z0 + dz, id);
  g.world.setBlocks(list);
  g.player.setMode("creative");
  if (g.vehicles.active) g.vehicles.exit({ force: true });
  p.position.set(x0 + 0.5, y + 0.05, z0 + 0.5);
  p.velocity.set(0, 0, 0);
  p.yaw = 0;
  p.pitch = 0;
  return { x0, y, z0 };
}`;
const field = (extra) => page.evaluate(([src, e]) => new Function("g", "e", `return (${src})(g, e);`)(window.__ufo, e), [FIELD, extra]);

await browserCheck("boot: a Survival world", async () => {
  await page.goto(`http://127.0.0.1:${PORT}/index.html?seed=1717&type=survival&mode=creative&graphics=low`, { waitUntil: "load", timeout: 60000 });
  await page.waitForFunction(() => !!window.__ufo && window.__ufo.graphicsReady, null, { timeout: 120000 });
  await play();
});

// ---------- Items ----------

await browserCheck("a dropped item burns up in lava and in fire (it sank and lay at the bottom); netherite floats up in lava", async () => {
  const { LAVA, FIRE } = await v(async () => {
    const ids = await import("./js/content/ids.js");
    return { LAVA: ids.LAVA, FIRE: ids.FIRE };
  });
  // A lava pit 3 deep 8 blocks east, a fire on the stone 8 blocks west.
  const pit = [];
  for (let dx = 6; dx <= 10; dx++) for (let dz = -2; dz <= 2; dz++) for (let dy = -3; dy < 0; dy++) pit.push([dx, dy, dz, LAVA]);
  const f = await field([...pit, [-8, 0, 0, FIRE]]);
  const r = await v(async (g, f) => {
    const T = g.THREE;
    const ids = await import("./js/content/ids.js");
    const { BLOCK } = await import("./js/blocks.js");
    const { ITEM } = await import("./js/items.js");
    const E = g.entities;
    E.clear();
    const drop = (id, x, y, z) => E.spawn(id, 1, new T.Vector3(x, y, z), new T.Vector3(0, 0, 0), { pickupDelay: 99 });
    const cob = drop(BLOCK.COBBLESTONE, f.x0 + 8.5, f.y + 0.5, f.z0 + 0.5);
    const debris = drop(ids.NETHERITE_INGOT, f.x0 + 8.5, f.y - 2.5, f.z0 + 0.5);
    const inFire = drop(ITEM.STICK, f.x0 - 7.5, f.y + 0.6, f.z0 + 0.5);
    const onStone = drop(ITEM.STICK, f.x0 + 0.5, f.y + 0.6, f.z0 + 3.5);
    let burnt = 0;
    const was = E.onBurn;
    E.onBurn = (it) => { burnt++; was?.(it); };
    // (And an experience orb: lava burns it too.)
    g.xp.clear?.();
    g.xp.spawn(f.x0 + 9.5, f.y + 0.5, f.z0 + 0.5, 3);
    g.xp.spawn(f.x0 - 15.5, f.y + 0.5, f.z0 + 0.5, 3);
    const orbs0 = g.xp.orbs.length;
    for (let i = 0; i < 60; i++) {
      E.update(1 / 30, null);
      g.xp.update(1 / 30);
    }
    E.onBurn = was;
    const has = (it) => E.items.includes(it);
    return { cob: has(cob), inFire: has(inFire), onStone: has(onStone), debris: has(debris), debrisY: +(debris.pos.y - f.y).toFixed(2), burnt, orbs: [orbs0, g.xp.orbs.length] };
  }, f);
  assert(!r.cob, `an item in lava burns up: ${JSON.stringify(r)}`);
  assert(!r.inFire, `an item in fire burns up: ${JSON.stringify(r)}`);
  assert(r.onStone, `an item on stone stays: ${JSON.stringify(r)}`);
  assert(r.debris && r.debrisY > -1.2, `a netherite ingot doesn't burn and floats up in lava: ${JSON.stringify(r)}`);
  assert(r.orbs[0] === 2 && r.orbs[1] === 1, `an experience orb in lava burns up, one on stone stays: ${JSON.stringify(r)}`);
});

await browserCheck("an item or an orb in ground that isn't loaded doesn't age (a death's things far away were gone after 5 minutes); a near one despawns", async () => {
  const f = await field();
  const r = await v(async (g, f) => {
    const T = g.THREE;
    const { ITEM } = await import("./js/items.js");
    const E = g.entities;
    E.clear();
    g.xp.clear();
    const far = E.spawn(ITEM.STICK, 1, new T.Vector3(f.x0 + 9000.5, 70, f.z0 + 0.5), new T.Vector3(), { pickupDelay: 99 });
    const near = E.spawn(ITEM.STICK, 1, new T.Vector3(f.x0 + 9.5, f.y + 0.2, f.z0 + 9.5), new T.Vector3(), { pickupDelay: 99 });
    g.xp.spawn(f.x0 + 9000.5, 70, f.z0 + 0.5, 3);
    for (let i = 0; i < 320; i++) {
      E.update(1, null);
      g.xp.update(1);
    }
    const out = { far: E.items.includes(far), near: E.items.includes(near), orbs: g.xp.orbs.length };
    E.clear();
    g.xp.clear();
    return out;
  }, f);
  assert(r.far && r.orbs === 1, `the far item and orb wait: ${JSON.stringify(r)}`);
  assert(!r.near, `the near item despawned after 5 minutes: ${JSON.stringify(r)}`);
});

// ---------- Creatures ----------

await browserCheck("a creature burns in flowing lava and in soul fire (only the still source and plain fire burnt it)", async () => {
  const ids = await v(async () => {
    const n = await import("./js/content/nature.js");
    const I = await import("./js/content/ids.js");
    return { flow: n.lavaFlowId(2), soul: I.SOUL_FIRE, soulBase: I.SOUL_SAND };
  });
  // A strip of flowing lava 6 blocks east (no source: nothing else ticks it
  // here), soul fire on soul sand 6 blocks west.
  const f = await field([[6, 0, 0, ids.flow], [7, 0, 0, ids.flow], [6, 0, 1, ids.flow], [7, 0, 1, ids.flow], [-6, -1, 0, ids.soulBase], [-6, 0, 0, ids.soul]]);
  const r = await v((g, f) => {
    g.sky.setHours(12);
    g.mobs.clear();
    const a = g.mobs.spawn("pig", f.x0 + 6.5, f.y, f.z0 + 0.5);
    const b = g.mobs.spawn("pig", f.x0 - 5.5, f.y, f.z0 + 0.5);
    const hp = [a.health, b.health];
    for (let i = 0; i < 30 * 1.5; i++) {
      a.pos.set(f.x0 + 6.5, f.y, f.z0 + 0.5);
      b.pos.set(f.x0 - 5.5, f.y, f.z0 + 0.5);
      a.vel.set(0, 0, 0);
      b.vel.set(0, 0, 0);
      g.mobs.update(1 / 30);
    }
    const out = { lava: [hp[0], a.health, a.fireT > 0 || a.dead], soul: [hp[1], b.health, b.fireT > 0 || b.dead] };
    g.mobs.clear();
    return out;
  }, f);
  assert(r.lava[1] < r.lava[0] && r.lava[2], `burnt in flowing lava: ${JSON.stringify(r)}`);
  assert(r.soul[1] < r.soul[0] && r.soul[2], `burnt in soul fire: ${JSON.stringify(r)}`);
});

await browserCheck("a creeper going off in water breaks no blocks, as vanilla's (it blew a crater under water); on land it does", async () => {
  const W = await v(async () => (await import("./js/blocks.js")).BLOCK.WATER);
  // A pool 3 deep 8 blocks north (stone round it), dry ground elsewhere.
  const pool = [];
  for (let dx = -2; dx <= 2; dx++) for (let dz = -10; dz <= -6; dz++) for (let dy = -3; dy < 0; dy++) pool.push([dx, dy, dz, W]);
  const f = await field(pool);
  const r = await v((g, f) => {
    const count = (x, y, z) => {
      let n = 0;
      for (let dx = -3; dx <= 3; dx++) for (let dy = -4; dy <= 1; dy++) for (let dz = -3; dz <= 3; dz++) if (g.world.isSolidAt(x + dx, y + dy, z + dz)) n++;
      return n;
    };
    g.mobs.clear();
    const wet = g.mobs.spawn("creeper", f.x0 + 5.5, f.y, f.z0 + 5.5);
    const dry = g.mobs.spawn("creeper", f.x0 + 12.5, f.y, f.z0 + 0.5);
    wet.pos.set(f.x0 + 0.5, f.y - 2.5, f.z0 - 7.5);
    const a0 = count(f.x0, f.y - 2, f.z0 - 8);
    const b0 = count(f.x0 + 12, f.y, f.z0);
    g.mobs._creeperBlast(wet);
    g.mobs._creeperBlast(dry);
    const out = { wet: [a0, count(f.x0, f.y - 2, f.z0 - 8)], dry: [b0, count(f.x0 + 12, f.y, f.z0)] };
    g.mobs.clear();
    g.entities.clear();
    return out;
  }, f);
  assert(r.wet[1] === r.wet[0], `in water: no block broken: ${JSON.stringify(r)}`);
  assert(r.dry[1] < r.dry[0], `on land: a crater: ${JSON.stringify(r)}`);
});

// ---------- Memory ----------

await browserCheck("travelling far and back doesn't keep the unloaded chunks in memory (the rain's column cache held hundreds of them)", async () => {
  const cdp = await page.context().newCDPSession(page);
  const heap = async () => {
    await cdp.send("HeapProfiler.collectGarbage");
    await cdp.send("HeapProfiler.collectGarbage");
    return page.evaluate(() => performance.memory.usedJSHeapSize / 1e6);
  };
  const home = await v((g) => {
    g.player.setMode("creative");
    g.player.flying = true;
    g.setRenderDistance(6);
    return g.player.position.toArray();
  });
  const settle = async () => {
    await until((g) => g.world.isIdle, 20000);
    await new Promise((r) => setTimeout(r, 800));
  };
  const trip = async (k) => {
    for (const d of [350, 700, 1050]) {
      await v((g, [h, d, k]) => {
        const a = k * 1.3;
        g.player.position.set(h[0] + Math.cos(a) * d, 110, h[2] + Math.sin(a) * d);
        g.streamAround(g.player.position.x, g.player.position.z);
        for (let i = 0; i < 400; i++) g.weather.update(0.05, [[g.player.position.x, g.player.position.z]]);
      }, [home, d, k]);
      await settle();
    }
    await v((g, h) => {
      g.player.position.set(h[0], 110, h[2]);
      g.streamAround(h[0], h[2]);
    }, home);
    await settle();
  };
  await settle();
  await trip(0);
  const before = await heap();
  await trip(1);
  await trip(2);
  const after = await heap();
  const kept = await v((g) => [...g.world.chunks.values()].length);
  await v((g) => {
    g.player.flying = false;
    g.setRenderDistance(8);
  });
  await cdp.detach();
  assert(after - before < 40, `the heap grew ${(after - before).toFixed(0)} MB over two round trips (${before.toFixed(0)} -> ${after.toFixed(0)} MB; ${kept} chunks loaded)`);
});

// ---------- The End's void ----------

await browserCheck("over the End's void a boat, a minecart and falling sand are lost (they fell for ever / the sand landed at y 0 in mid-air); a Creative player caught by the void flies", async () => {
  await v((g) => {
    g.player.setMode("creative");
    g.dims.debugTravel("end");
  });
  assert(await until((g) => g.dims.dim === "end" && !g.dims.pending, 90000), "never reached the End");
  const r = await v(async (g) => {
    const { BLOCK } = await import("./js/blocks.js");
    const p = g.player.position;
    let spot = null;
    for (let rr = 20; rr < 120 && !spot; rr += 4) for (let a = 0; a < 6.28 && !spot; a += 0.4) {
      const x = Math.floor(p.x + Math.cos(a) * rr), z = Math.floor(p.z + Math.sin(a) * rr);
      let open = true;
      for (let dx = -3; dx <= 1 && open; dx++) if (!g.world.getChunk((x + dx) >> 4, z >> 4) || g.world.surfaceY(x + dx, z) >= 0) open = false;
      if (open) spot = [x, z];
    }
    if (!spot) return null;
    const [x, z] = spot;
    const boat = g.transport.add({ k: "b", w: 0, p: [x + 0.5, 30, z + 0.5], y: 0, d: g.transport.here });
    const cart = g.transport.add({ k: "c", p: [x - 1.5, 30, z + 0.5], y: 0, d: g.transport.here });
    g.world.setBlocks([x - 3, 30, z, BLOCK.SAND]);
    for (let i = 0; i < 30 * 8; i++) {
      g.transport.update(1 / 30);
      g.falling.update(1 / 30);
    }
    const out = { boat: g.transport.vehicles.has(boat.id), cart: g.transport.vehicles.has(cart.id), sand: g.world.getBlock(x - 3, 0, z), falling: g.falling.entities.length };
    // A Creative player falling out of the world: back up at y 70, flying.
    g.player.flying = false;
    g.player.position.set(x + 0.5, -9, z + 0.5);
    g.player.velocity.set(0, -20, 0);
    g.player.update(1 / 30);
    out.flying = g.player.flying;
    for (let i = 0; i < 30 * 3; i++) g.player.update(1 / 30);
    out.py = Math.round(g.player.position.y);
    g.player.flying = false;
    return out;
  });
  assert(r, "no open void found near the End's platform");
  assert(!r.boat && !r.cart, `the boat and the minecart are lost in the void: ${JSON.stringify(r)}`);
  assert(r.sand === 0 && r.falling === 0, `the sand fell out of the world: ${JSON.stringify(r)}`);
  assert(r.flying && r.py > 60, `a Creative player caught by the void is put back up flying: ${JSON.stringify(r)}`);
  await v((g) => g.dims.toSpawn());
  assert(await until((g) => g.dims.dim === "overworld" && !g.dims.pending, 90000), "never back home");
});

await browserCheck("what lies on the ground is saved: a death's spilled things and experience orbs are still there after a reload (they were lost)", async () => {
  const f = await field();
  const at = await v(async (g, f) => {
    const { ITEM } = await import("./js/items.js");
    g.entities.clear();
    g.xp.clear();
    g.player.setMode("survival");
    g.inventory.clear();
    const { DIAMOND } = await import("./js/content/ids.js");
    g.inventory.slots[0] = { id: DIAMOND, count: 7 };
    g.inventory.slots[1] = { id: ITEM.IRON_PICKAXE, count: 1, dur: 99 };
    g.player.xpLevel = 3;
    g.player.position.set(f.x0 + 6.5, f.y, f.z0 + 6.5);
    g.player.damage(999, "zombie", { pierce: true });
    for (let i = 0; i < 60; i++) {
      g.entities.update(1 / 30, null);
      g.xp.update(1 / 30);
    }
    const items = g.entities.items.map((it) => `${it.id}x${it.count}`).sort();
    g.respawn();
    g.flushSave();
    return { items, orbs: g.xp.pending };
  }, f);
  await page.reload({ waitUntil: "load" });
  await page.waitForFunction(() => !!window.__ufo && window.__ufo.graphicsReady, null, { timeout: 120000 });
  await play();
  const back = await v((g) => ({ items: g.entities.items.map((it) => `${it.id}x${it.count}`).sort(), dur: g.entities.items.find((it) => it.dur !== undefined)?.dur, orbs: g.xp.pending }));
  assert(at.items.length >= 2 && JSON.stringify(back.items) === JSON.stringify(at.items), `the items are back: ${JSON.stringify(at)} -> ${JSON.stringify(back)}`);
  assert(back.dur === 99, `with their wear: ${back.dur}`);
  assert(at.orbs > 0 && back.orbs === at.orbs, `the orbs are back: ${at.orbs} -> ${back.orbs}`);
  await v((g) => g.player.setMode("creative"));
});

await browserCheck("saved standing on a slab under a roof, a reload puts the player back on the slab (it put them up on the roof)", async () => {
  const I = await v(async () => {
    const ids = await import("./js/content/ids.js");
    const { BLOCK } = await import("./js/blocks.js");
    return { slab: ids.OAK_SLAB, planks: BLOCK.PLANKS };
  });
  const roof = [];
  for (let dx = -4; dx <= 4; dx++) for (let dz = -4; dz <= 4; dz++) roof.push([dx, 6, dz, I.planks]);
  const f = await field([...roof, [0, 0, 0, I.slab]]);
  const saved = await v((g, f) => {
    g.player.setMode("survival");
    g.player.position.set(f.x0 + 0.5, f.y + 0.5, f.z0 + 0.5);
    g.player.velocity.set(0, 0, 0);
    for (let i = 0; i < 10; i++) g.player.update(1 / 30);
    g.flushSave();
    return g.player.position.y;
  }, f);
  await page.reload({ waitUntil: "load" });
  await page.waitForFunction(() => !!window.__ufo && window.__ufo.graphicsReady, null, { timeout: 120000 });
  const back = await v((g) => g.player.position.y);
  await play();
  await v((g) => g.player.setMode("creative"));
  assert(Math.abs(saved - (f.y + 0.5)) < 0.01, `stood on the slab: ${saved}`);
  assert(Math.abs(back - saved) < 0.01, `back on the slab after the reload: ${saved} -> ${back}`);
});

// ---------- Saves (last: the first page stops saving here) ----------

await browserCheck("two tabs of one world: the new tab owns it, the old one stops saving and says so (closing it undid the new tab's progress)", async () => {
  await v((g) => {
    g.player.setMode("survival");
    g.inventory.slots[0] = { id: 1, count: 5 };
    g.mp.game.markInventoryChanged();
    g.flushSave();
  });
  const page2 = await ctx.newPage();
  await page2.route("https://cdn.jsdelivr.net/npm/three@0.160.0/**", (route) => {
    const rel = new URL(route.request().url()).pathname.replace("/npm/three@0.160.0/", "");
    route.fulfill({ path: path.join(localThreeRoot, rel), contentType: "text/javascript" });
  });
  page2.on("pageerror", (e) => errors.push(String(e)));
  await page2.goto(`http://127.0.0.1:${PORT}/index.html?seed=1717&graphics=low`, { waitUntil: "load", timeout: 60000 });
  await page2.waitForFunction(() => !!window.__ufo && window.__ufo.graphicsReady, null, { timeout: 120000 });
  const loaded = await page2.evaluate(() => window.__ufo.inventory.slots[0]?.count);
  await page2.evaluate(() => {
    const g = window.__ufo;
    g.inventory.slots[0] = { id: 1, count: 40 };
    g.mp.game.markInventoryChanged();
    g.flushSave();
  });
  const notice = await until(() => !document.getElementById("world-elsewhere").classList.contains("hidden"), 10000);
  // The old tab closes (it saves on the way out, as any tab does).
  await v((g) => g.flushSave());
  await page.evaluate(() => window.dispatchEvent(new Event("beforeunload")));
  const kept = await page2.evaluate(() => JSON.parse(localStorage.getItem("ufocombat_v1_player_1717")).inv[0]);
  const own = await page2.evaluate(() => !document.getElementById("world-elsewhere").classList.contains("hidden"));
  await page2.close();
  assert(loaded === 5, `the new tab started from the old one's save: ${loaded}`);
  assert(notice, "the old tab says the world is open in another tab");
  assert(!own, "the new tab is not told so");
  assert(Array.isArray(kept) && kept[1] === 40, `the new tab's progress is kept: ${JSON.stringify(kept)}`);
});

await browser.close();
server.close();

const failed = results.filter(([, ok]) => !ok);
console.log(`\n${results.length - failed.length} passed, ${failed.length} failed.`);
process.exit(failed.length ? 1 : 0);
