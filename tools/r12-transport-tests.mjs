// Round 12 transport tests: rails, minecarts and boats (vanilla Java 1.20's).
// In Node (fast): the rails' shapes as vanilla's RailState makes them (a
// line, a curve at a corner, a slope up a step, a rail joined at both ends
// left alone, a junction's south-east rule and its north-west one powered,
// the powered rails never curving), the recipes, the items, the tiles.
// In the browser (the real game, a Survival world): rails put down with the
// interaction join; a powered line is powered 8 rails on from its source
// and goes off with it; a detector rail turns on under a cart (a lamp beside
// it lights) and off a second after it leaves; a cart rolls down a slope,
// is boosted by a powered rail to vanilla's top speed and braked to a stop
// by an unpowered one, an activator rail throws its rider out; a boat
// floats at rest on water, rows at vanilla's 8 blocks a second, flies on
// ice, breaks into planks and sticks falling onto land; hits break a boat
// (its item dropped; nothing in Creative) and a chest minecart (its
// contents spilled); a player gets in and out; the vehicles, their chests
// and the seat are saved. With --online: a guest sees the host's boat, gets
// in and rows it (the host sees it move, with the guest in it), opens a
// chest minecart and puts something in (the host's chest has it).
//
//   node r12-transport-tests.mjs [--only=substring] [--node] [--online]
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
const { BLOCK, TILE, BLOCK_INFO } = await imp("js/blocks.js");
const { itemInfo, maxStack } = await imp("js/items.js");
const I = await imp("js/content/ids.js");
const T = await imp("js/content/transport.js");
const C = await imp("js/content/index.js");

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

// A world of rails in a map (a floor of stone everywhere under y 0).
function railWorld() {
  const map = new Map();
  const k = (x, y, z) => `${x},${y},${z}`;
  const w = {
    getBlock: (x, y, z) => (y < 0 ? BLOCK.STONE : map.get(k(x, y, z)) || 0),
    set: (x, y, z, id) => map.set(k(x, y, z), id),
    shape: (x, y, z) => T.RAIL_SHAPE[w.getBlock(x, y, z)],
    // as a player puts one down: the placement's shape, then the rails it joins turn
    place(x, y, z, kind = T.K_RAIL, alongX = false, powered = false) {
      const first = T.railId(kind, alongX ? T.EW : T.NS);
      const o = T.railOverlay(w);
      o.set(x, y, z, first);
      const id = T.railPlace(o, x, y, z, first, powered, true);
      w.set(x, y, z, id);
      const o2 = T.railOverlay(w);
      T.railPlace(o2, x, y, z, id, powered, true);
      const l = o2.list();
      for (let i = 0; i < l.length; i += 4) w.set(l[i], l[i + 1], l[i + 2], l[i + 3]);
      return id;
    },
  };
  return w;
}

await check("rails join as vanilla's: a line, a curve at a corner, a slope up a step, a full rail left alone", async () => {
  const w = railWorld();
  for (let z = 0; z < 3; z++) w.place(0, 0, z);
  assert([0, 1, 2].every((z) => w.shape(0, 0, z) === T.NS), "a north-south line");
  w.place(1, 0, 2, T.K_RAIL, true);
  assert(w.shape(0, 0, 2) === T.NE && w.shape(1, 0, 2) === T.EW, `the end turns to the new rail: ${w.shape(0, 0, 2)}`);
  w.set(0, 0, -1, BLOCK.STONE);
  w.place(0, 1, -1);
  assert(w.shape(0, 0, 0) === T.ASC_N, `a slope up to the rail on the step: ${w.shape(0, 0, 0)}`);
  // (the middle of the line is joined at both ends: a rail beside it doesn't bend it)
  w.place(1, 0, 1, T.K_RAIL, true);
  assert(w.shape(0, 0, 1) === T.NS, `a rail joined at both ends is left alone: ${w.shape(0, 0, 1)}`);
});

await check("junctions: the south-east rule, north-west while powered; powered rails never curve", async () => {
  for (const [powered, want] of [[false, T.SE], [true, T.NW]]) {
    const w = railWorld();
    // four rails round (0, 0): the last one in the middle meets all of them
    w.set(1, 0, 0, T.railId(T.K_RAIL, T.EW));
    w.set(-1, 0, 0, T.railId(T.K_RAIL, T.EW));
    w.set(0, 0, 1, T.railId(T.K_RAIL, T.NS));
    w.set(0, 0, -1, T.railId(T.K_RAIL, T.NS));
    w.place(0, 0, 0, T.K_RAIL, false, powered);
    assert(w.shape(0, 0, 0) === want, `a crossing ${powered ? "powered" : "unpowered"}: ${w.shape(0, 0, 0)}`);
  }
  const w = railWorld();
  w.place(0, 0, 0, T.K_POWERED);
  w.place(1, 0, 1, T.K_POWERED, true);
  w.place(0, 0, 1, T.K_POWERED);
  assert(T.RAIL_SHAPE[w.getBlock(0, 0, 1)] <= T.ASC_S, "a powered rail curved");
  assert(T.RAIL_KIND[w.getBlock(0, 0, 1)] === T.K_POWERED && T.RAIL_ON[w.getBlock(0, 0, 1)] === 0, "kind and power kept through a turn");
});

await check("items, recipes and tiles: the boats of every wood, the carts, the rails, as vanilla's", async () => {
  const names = [];
  for (let i = 0; i < 12; i++) names.push(itemInfo(I.OAK_BOAT + i)?.name);
  assert(names.every(Boolean) && names[0] === "Oak Boat" && names[11] === "Dark Oak Boat with Chest", `boats: ${names}`);
  assert(maxStack(I.OAK_BOAT) === 1 && maxStack(I.MINECART) === 1 && maxStack(I.RAIL) === 64, "stack sizes");
  const rec = C.recipes().filter((r) => r.module === "transport");
  const out = (id) => rec.find((r) => r.result?.[0] === id);
  assert(out(I.RAIL)?.result[1] === 16 && out(I.POWERED_RAIL)?.result[1] === 6 && out(I.DETECTOR_RAIL)?.result[1] === 6 && out(I.ACTIVATOR_RAIL)?.result[1] === 6, "the rails' recipes");
  assert(out(I.MINECART)?.pattern.join("|") === "# #|###" && out(I.CHEST_MINECART)?.type === "shapeless", "the carts' recipes");
  assert(rec.filter((r) => r.type === "fuel").length === 6, "boats burn");
  const tiles = Object.keys((await imp("js/content/transport.js")).tiles);
  assert(tiles.length <= 40 && tiles.every((t) => TILE[t] !== undefined), `tiles: ${tiles.length}`);
  for (let s = 0; s < 10; s++) assert(BLOCK_INFO[I.RAIL + s] && BLOCK_INFO[I.RAIL + s].solid === false, `rail shape ${s}`);
  assert(BLOCK_INFO[I.RAIL + 6].faces.top !== BLOCK_INFO[I.RAIL].faces.top, "a curve's own tile");
  console.log(`        ${tiles.length} tiles, ${rec.length} recipes`);
});

// ---------- In the browser ----------

if (!args.node) await browserChecks();

async function browserChecks() {
  const { chromium } = await import("playwright-core");
  const PORT = 9870 + Math.floor(Math.random() * 40);
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

  // An arena high in the air: a stone floor (x0..x0+29, z0-6..z0+6 at y0), air over it.
  const ARENA = `async (g, o = {}) => {
    const { BLOCK } = await import("./js/blocks.js");
    const p = g.player.position;
    const x0 = Math.floor(p.x) + (o.dx || 0), y0 = o.y || 112, z0 = Math.floor(p.z);
    const list = [];
    for (let x = x0 - 2; x <= x0 + 30; x++) for (let z = z0 - 6; z <= z0 + 6; z++) { list.push(x, y0, z, BLOCK.STONE); for (let y = 1; y < 8; y++) list.push(x, y0 + y, z, 0); }
    g.world.setBlocks(list);
    g.transport.clear();
    g.player.setMode("creative");
    g.player.flying = true;
    g.player.position.set(x0 + 0.5, y0 + 3, z0 + 5.5);
    return { x0, y0, z0 };
  }`;
  const arena = (p, o) => p.evaluate(([src, a]) => new Function("g", "a", `return (${src})(g, a);`)(window.__ufo, a), [ARENA, o || {}]);
  // Rails put down as the interaction does (placeAs, then the block; the neighbours turn after).
  const PLACE = `async (g, cells) => {
    const { BLOCK_INFO } = await import("./js/blocks.js");
    for (const [x, y, z, base, ax] of cells) {
      const id = BLOCK_INFO[base].placeAs({ world: g.world, place: [x, y, z], forward: ax ? [1, 0, 0] : [0, 0, -1] });
      g.world.setBlocks([x, y, z, id]);
      await new Promise((r) => setTimeout(r, 0));
    }
    return true;
  }`;
  const place = (p, cells) => p.evaluate(([src, a]) => new Function("g", "a", `return (${src})(g, a);`)(window.__ufo, a), [PLACE, cells]);
  // n ticks of a vehicle (as its frames would run them).
  const TICKS = `(g, [id, n]) => { const T = g.transport; const v = T.vehicles.get(id); for (let i = 0; i < n && T.vehicles.has(id); i++) { v.prev.copy(v.pos); v.prevYaw = v.yaw; T._tick(v); } const w = T.vehicles.get(id); return w ? { x: w.pos.x, y: w.pos.y, z: w.pos.z, vx: w.vel.x, vy: w.vel.y, vz: w.vel.z, speed: Math.hypot(w.vel.x, w.vel.z) * 20, onRail: w.onRail, status: w.status, riders: w.riders.length } : null; }`;
  const ticks = (p, id, n) => p.evaluate(([src, a]) => new Function("g", "a", `return (${src})(g, a);`)(window.__ufo, a), [TICKS, [id, n]]);

  const page = await newPage("solo");
  await browserCheck("boot: a Survival world with boats, minecarts and rails in the game", async () => {
    await page.goto(`http://127.0.0.1:${PORT}/index.html?seed=8123&type=survival&graphics=low`, { waitUntil: "load", timeout: 60000 });
    await page.waitForFunction(() => !!window.__ufo && window.__ufo.graphicsReady, null, { timeout: 120000 });
    await play(page);
    const r = await v(page, (g) => ({ t: !!g.transport, lib: typeof g.player.mount, combat: typeof g.interaction.combat.raycast }));
    assert(r.t && r.lib !== "undefined" && r.combat === "function", `wired: ${JSON.stringify(r)}`);
  });

  await browserCheck("rails: the interaction's rails join; a powered line is powered 8 rails on from its source and goes off with it", async () => {
    const a = await arena(page);
    const { x0, y0, z0 } = a;
    const cells = [];
    for (let x = x0; x <= x0 + 12; x++) cells.push([x, y0 + 1, z0, I.POWERED_RAIL, 1]);
    await place(page, cells);
    await v(page, (g, a) => g.world.setBlocks([a.x0, a.y0 + 1, a.z0 + 1, a.rb]), { ...a, rb: I.REDSTONE_BLOCK });
    await frames(page, 3);
    const on = await v(page, async (g, a) => {
      const T = await import("./js/content/transport.js");
      const out = [];
      for (let x = a.x0; x <= a.x0 + 12; x++) out.push(T.RAIL_ON[g.world.getBlock(x, a.y0 + 1, a.z0)]);
      return out;
    }, a);
    assert(on.join("") === "1111111110000", `power along the line: ${on.join("")}`);
    await v(page, (g, a) => g.world.setBlocks([a.x0, a.y0 + 1, a.z0 + 1, 0]), a);
    await frames(page, 3);
    const off = await v(page, async (g, a) => {
      const T = await import("./js/content/transport.js");
      let n = 0;
      for (let x = a.x0; x <= a.x0 + 12; x++) n += T.RAIL_ON[g.world.getBlock(x, a.y0 + 1, a.z0)];
      return n;
    }, a);
    assert(off === 0, `${off} still powered`);
  });

  await browserCheck("carts: down a slope faster, a powered rail to vanilla's top speed, an unpowered one brakes, a detector rail lights a lamp, an activator throws the rider out", async () => {
    const a = await arena(page);
    const { x0, y0, z0 } = a;
    // a step at x0..x0+1 two high, a slope down, a long flat line east with a powered stretch
    await v(page, (g, a) => g.world.setBlocks([a.x0 - 1, a.y0 + 1, a.z0, 3, a.x0, a.y0 + 1, a.z0, 3]), a);
    const cells = [[x0 - 1, y0 + 2, z0, I.RAIL, 1], [x0, y0 + 2, z0, I.RAIL, 1]];
    for (let x = x0 + 1; x <= x0 + 26; x++) cells.push([x, y0 + 1, z0, x >= x0 + 6 && x <= x0 + 9 ? I.POWERED_RAIL : x === x0 + 22 ? I.DETECTOR_RAIL : x === x0 + 26 ? I.ACTIVATOR_RAIL : I.RAIL, 1]);
    await place(page, cells);
    await v(page, (g, a) => g.world.setBlocks([a.x0 + 7, a.y0 + 1, a.z0 - 1, a.rb, a.x0 + 22, a.y0 + 1, a.z0 + 1, a.lamp]), { ...a, rb: I.REDSTONE_BLOCK, lamp: I.REDSTONE_LAMP });
    await frames(page, 3);
    const shapes = await v(page, async (g, a) => {
      const T = await import("./js/content/transport.js");
      return [T.RAIL_SHAPE[g.world.getBlock(a.x0 + 1, a.y0 + 1, a.z0)], T.RAIL_ON[g.world.getBlock(a.x0 + 8, a.y0 + 1, a.z0)]];
    }, a);
    assert(shapes[0] === 3 && shapes[1] === 1, `the slope (ascending west) and the powered stretch: ${shapes}`);
    // A cart on the top: it rolls down and gains speed.
    const id = await v(page, (g, a) => g.transport.add({ k: "c", p: [a.x0 + 0.5, a.y0 + 2.0625, a.z0 + 0.5], y: Math.PI / 2 }).id, a);
    await v(page, (g, id) => { g.transport.vehicles.get(id).vel.x = 0.15; }, id);
    let s = await ticks(page, id, 4);
    const sp0 = s.speed;
    s = await ticks(page, id, 8);
    assert(s && s.onRail && s.x > x0 + 2 && s.y < y0 + 1.1 && s.speed > sp0, `down the slope: ${JSON.stringify(s)} from ${sp0}`);
    // (an empty cart slows fast: pushed again before the powered stretch)
    await v(page, (g, [id, a]) => { const v = g.transport.vehicles.get(id); v.pos.set(a.x0 + 4.5, a.y0 + 1.0625, a.z0 + 0.5); v.vel.set(0.2, 0, 0); }, [id, a]);
    s = await ticks(page, id, 14);
    assert(s.speed > 7.5, `boosted: ${JSON.stringify(s)}`);
    // (vanilla's top speed: 0.4 blocks a tick as it moves, 8 m/s)
    const top = await v(page, (g, id) => {
      const T = g.transport;
      const v = T.vehicles.get(id);
      v.pos.x -= 6; // (back over the powered stretch)
      v.vel.set(1.5, 0, 0);
      let most = 0;
      for (let i = 0; i < 10; i++) {
        const x = v.pos.x;
        v.prev.copy(v.pos);
        T._tick(v);
        most = Math.max(most, v.pos.x - x);
      }
      return most * 20;
    }, id);
    assert(top <= 8.001 && top > 7.9, `top speed: ${top}`);
    // The detector rail under it (the cart left standing on it).
    await v(page, (g, [id, a]) => { const v = g.transport.vehicles.get(id); v.pos.set(a.x0 + 22.5, a.y0 + 1.0625, a.z0 + 0.5); v.vel.set(0, 0, 0); }, [id, a]);
    const lit = await until(page, async (g, a) => {
      const T = await import("./js/content/transport.js");
      const { ON } = await import("./js/content/redstone.js");
      const d = g.world.getBlock(a.x0 + 22, a.y0 + 1, a.z0);
      return T.RAIL_ON[d] && ON[g.world.getBlock(a.x0 + 22, a.y0 + 1, a.z0 + 1)] ? true : null;
    }, 8000, a);
    assert(lit, "the detector rail and its lamp on under the cart");
    if (out) await page.screenshot({ path: path.join(out, "transport-detector.png") });
    await v(page, (g, id) => g.transport.vehicles.get(id).pos.set(g.transport.vehicles.get(id).pos.x - 6, g.transport.vehicles.get(id).pos.y, g.transport.vehicles.get(id).pos.z), id);
    const unlit = await until(page, async (g, a) => {
      const T = await import("./js/content/transport.js");
      return T.RAIL_ON[g.world.getBlock(a.x0 + 22, a.y0 + 1, a.z0)] ? null : true;
    }, 8000, a);
    assert(unlit, "the detector rail off after the cart left");
    // An unpowered powered rail brakes a cart to a stop.
    await v(page, (g, a) => g.world.setBlocks([a.x0 + 7, a.y0 + 1, a.z0 - 1, 0]), a);
    await frames(page, 3);
    await v(page, (g, [id, a]) => { const v = g.transport.vehicles.get(id); v.pos.set(a.x0 + 3.5, a.y0 + 1.0625, a.z0 + 0.5); v.vel.set(0.25, 0, 0); }, [id, a]);
    s = await ticks(page, id, 60);
    assert(s.speed < 0.01 && s.x < x0 + 10.5, `braked: ${JSON.stringify(s)}`);
    // The activator rail, powered: the rider is out.
    await v(page, (g, a) => g.world.setBlocks([a.x0 + 26, a.y0 + 1, a.z0 + 1, a.rb]), { ...a, rb: I.REDSTONE_BLOCK });
    await frames(page, 3);
    const ej = await v(page, (g, [id, a]) => {
      const T = g.transport;
      const v = T.vehicles.get(id);
      g.player.setMode("survival");
      g.player.flying = false;
      v.pos.set(a.x0 + 24.5, a.y0 + 1.0625, a.z0 + 0.5);
      v.prev.copy(v.pos);
      g.player.position.set(v.pos.x, v.pos.y + 0.5, v.pos.z + 1);
      const ok = T.mount(v);
      const seated = !!g.player.mount;
      v.vel.set(0.15, 0, 0);
      for (let i = 0; i < 40 && g.player.mount; i++) { v.prev.copy(v.pos); T._tick(v); }
      return { ok, seated, after: !!g.player.mount, riders: v.riders.length, x: v.pos.x };
    }, [id, a]);
    assert(ej.ok && ej.seated && !ej.after && ej.riders === 0, `the activator rail: ${JSON.stringify(ej)}`);
  });

  await browserCheck("boats: float at rest, row at vanilla's 8 blocks a second, fly on ice, break into planks and sticks falling onto land", async () => {
    const a = await arena(page);
    await v(page, (g, a) => {
      const l = [];
      for (let x = a.x0; x <= a.x0 + 28; x++) for (let z = a.z0 - 3; z <= a.z0 + 3; z++) l.push(x, a.y0, z, 5); // (water, over the floor below)
      for (let x = a.x0 - 2; x <= a.x0 + 30; x++) for (let z = a.z0 - 6; z <= a.z0 + 6; z++) l.push(x, a.y0 - 1, z, 3);
      g.world.setBlocks(l);
      return true;
    }, a);
    const id = await v(page, (g, a) => g.transport.add({ k: "b", w: 1, p: [a.x0 + 2, a.y0 + 0.9, a.z0 + 0.5], y: -Math.PI / 2 }).id, a);
    let s = await ticks(page, id, 120);
    assert(s.status === 0 && Math.abs(s.vy) < 0.005 && s.y > a.y0 + 0.3 && s.y < a.y0 + 0.65, `at rest on the water: ${JSON.stringify(s)}`);
    // Rowing east (W): 0.4 blocks a tick at the most.
    const row = await v(page, (g, id) => {
      const T = g.transport;
      const v = T.vehicles.get(id);
      g.player.setMode("survival");
      g.player.flying = false;
      g.player.position.set(v.pos.x, v.pos.y + 1, v.pos.z + 1.5);
      T.mount(v);
      g.player.keys.add("KeyW");
      const x0 = v.pos.x;
      for (let i = 0; i < 40; i++) { v.prev.copy(v.pos); T._tick(v); }
      const x1 = v.pos.x;
      for (let i = 0; i < 10; i++) { v.prev.copy(v.pos); T._tick(v); }
      g.player.keys.clear();
      return { moved: x1 - x0, top: (v.pos.x - x1) / 0.5, seated: !!g.player.mount };
    }, id);
    assert(row.seated && row.moved > 10 && row.top > 7.4 && row.top < 8.2, `rowing: ${JSON.stringify(row)}`);
    if (out) {
      await v(page, (g) => { g.player.cameraMode = 1; });
      await frames(page, 4);
      await page.screenshot({ path: path.join(out, "transport-boat.png") });
      await v(page, (g) => { g.player.cameraMode = 0; });
    }
    await v(page, (g) => g.transport.dismount());
    // On packed ice: much faster.
    const ice = await v(page, (g, a) => {
      const l = [];
      for (let x = a.x0 - 2; x <= a.x0 + 30; x++) for (let z = a.z0 - 3; z <= a.z0 + 3; z++) l.push(x, a.y0, z, a.ice);
      g.world.setBlocks(l);
      const T = g.transport;
      const v = T.add({ k: "b", w: 0, p: [a.x0, a.y0 + 1, a.z0 + 0.5], y: -Math.PI / 2 });
      g.player.position.set(v.pos.x, v.pos.y + 1, v.pos.z + 1.5);
      T.mount(v);
      g.player.keys.add("KeyW");
      for (let i = 0; i < 25; i++) { v.prev.copy(v.pos); T._tick(v); }
      g.player.keys.clear();
      const sp = Math.hypot(v.vel.x, v.vel.z) * 20;
      T.dismount();
      return sp;
    }, { ...a, ice: I.PACKED_ICE });
    // (vanilla's: 0.98 friction, 2 blocks a tick at the most; after 25 ticks 0.79, 15.9 blocks a second)
    assert(ice > 14 && ice < 17, `on ice: ${ice} blocks a second`);
    // Dropped from 6 blocks onto land: planks and sticks, not a boat.
    const fall = await v(page, (g, a) => {
      const T = g.transport;
      const before = g.entities.items?.length ?? 0;
      g.world.setBlocks([a.x0 + 5, a.y0, a.z0 - 5, 3]);
      const v = T.add({ k: "b", w: 3, p: [a.x0 + 5.5, a.y0 + 7, a.z0 - 4.5], y: 0 });
      for (let i = 0; i < 60 && T.vehicles.has(v.id); i++) { v.prev.copy(v.pos); T._tick(v); }
      const items = (g.entities.items || g.entities.list || []).slice(before).map((e) => e.id);
      return { gone: !T.vehicles.has(v.id), items };
    }, a);
    assert(fall.gone && fall.items.includes(I.JUNGLE_PLANKS) && fall.items.includes(256) && !fall.items.includes(I.OAK_BOAT + 3), `the fall: ${JSON.stringify(fall)}`);
  });

  await browserCheck("hits: a boat breaks into its item (nothing in Creative), a chest minecart spills its chest; right click in, Shift out", async () => {
    const a = await arena(page);
    const r = await v(page, (g, a) => {
      const T = g.transport;
      const ents = g.entities.items || g.entities.list || [];
      const before = ents.length;
      g.player.setMode("survival");
      const b = T.add({ k: "b", w: 4, p: [a.x0 + 3, a.y0 + 1, a.z0 + 0.5], y: 0 });
      const iron = { type: "sword", damage: 6, vDamage: 6 };
      g.mobs.lastAttackTime = -99;
      T.attack(b, iron);
      const boat = !T.vehicles.has(b.id);
      g.player.setMode("creative");
      const b2 = T.add({ k: "b", w: 0, p: [a.x0 + 6, a.y0 + 1, a.z0 + 0.5], y: 0 });
      T.attack(b2, null);
      const creative = !T.vehicles.has(b2.id);
      g.player.setMode("survival");
      const c = T.add({ k: "c", c: 1, p: [a.x0 + 9.5, a.y0 + 1.0625, a.z0 + 0.5], y: 0 });
      c.slots = new Array(27).fill(null);
      c.slots[4] = { id: 264, count: 7 };
      for (let i = 0; i < 6 && T.vehicles.has(c.id); i++) { g.mobs.lastAttackTime = -99; T.attack(c, null); }
      const items = (g.entities.items || g.entities.list || []).slice(before).map((e) => [e.id, e.count]);
      // In and out of a boat (right click: the interaction's use).
      const b3 = T.add({ k: "b", w: 0, p: [a.x0 + 12, a.y0 + 1, a.z0 + 0.5], y: 0 });
      g.player.position.set(a.x0 + 12, a.y0 + 1, a.z0 + 2);
      g.player.flying = false;
      const used = T.use(b3, null);
      const inside = g.player.mount && b3.riders.length === 1;
      return { boat, creative, items, used, inside, id: b3.id };
    }, a);
    assert(r.boat && r.creative, `broken: ${JSON.stringify(r)}`);
    const ids = r.items.map((e) => e[0]);
    assert(ids.filter((id) => id === I.OAK_BOAT + 4).length === 1 && !ids.includes(I.OAK_BOAT), `drops: ${JSON.stringify(r.items)}`);
    assert(ids.includes(I.CHEST_MINECART) && r.items.some(([id, n]) => id === 264 && n === 7), `the chest minecart's drops: ${JSON.stringify(r.items)}`);
    assert(r.used && r.inside, "right click: in");
    await v(page, (g) => g.player.keys.add("ShiftLeft"));
    const outside = await until(page, (g, id) => (!g.player.mount && g.transport.vehicles.get(id).riders.length === 0 ? true : null), 10000, r.id);
    await v(page, (g) => g.player.keys.clear());
    assert(outside, "Shift: out");
  });

  await browserCheck("saves: the vehicles, a chest's contents and the seat come back after a reload", async () => {
    const a = await arena(page);
    const id = await v(page, (g, a) => {
      const T = g.transport;
      const c = T.add({ k: "c", c: 1, p: [a.x0 + 4.5, a.y0 + 1.0625, a.z0 + 0.5], y: 0 });
      c.slots = new Array(27).fill(null);
      c.slots[0] = { id: 264, count: 3 };
      const b = T.add({ k: "b", w: 2, p: [a.x0 + 8, a.y0 + 1, a.z0 + 0.5], y: 1 });
      g.player.setMode("survival");
      g.player.flying = false;
      g.player.position.set(b.pos.x, b.pos.y + 1, b.pos.z + 1.5);
      T.mount(b);
      g.flushSave(true);
      return b.id;
    }, a);
    await page.reload({ waitUntil: "load" });
    await page.waitForFunction(() => !!window.__ufo && window.__ufo.graphicsReady, null, { timeout: 120000 });
    await play(page);
    const back = await until(page, (g, id) => {
      const T = g.transport;
      const b = T.vehicles.get(id);
      const c = [...T.vehicles.values()].find((v) => v.kind === "cart" && v.chest);
      return b && c && g.player.mount ? { n: T.vehicles.size, slot: c.slots?.[0], seated: b.riders.length } : null;
    }, 30000, id);
    assert(back && back.n === 2 && back.slot?.id === 264 && back.slot.count === 3 && back.seated === 1, `after the reload: ${JSON.stringify(back)}`);
    await v(page, (g) => g.transport.dismount());
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
    await browserCheck("online: a guest sees the host's boat, gets in and rows it (the host sees it move with the guest in it), and fills a chest minecart", async () => {
      await host.goto(`http://127.0.0.1:${PORT}/index.html?seed=8124&type=survival&${NET_Q}`, { waitUntil: "load", timeout: 60000 });
      await host.waitForFunction(() => !!window.__ufo && window.__ufo.graphicsReady, null, { timeout: 120000 });
      await host.click("#menu-mp-btn");
      await host.fill("#mp-nick", "Alice");
      await host.click("#mp-host-btn");
      const code = await until(host, (g) => g.net.code, 30000);
      assert(code, "no room code");
      await host.click("#mp-lobby-play");
      await host.waitForFunction(() => window.__ufo.gameState === "playing", null, { timeout: 30000 });
      await v(host, noDraw);
      const a = await arena(host);
      await v(host, (g, a) => {
        const l = [];
        for (let x = a.x0; x <= a.x0 + 28; x++) for (let z = a.z0 - 3; z <= a.z0 + 3; z++) l.push(x, a.y0, z, 5);
        for (let x = a.x0 - 2; x <= a.x0 + 30; x++) for (let z = a.z0 - 6; z <= a.z0 + 6; z++) l.push(x, a.y0 - 1, z, 3);
        g.world.setBlocks(l);
        g.transport.add({ k: "b", w: 0, p: [a.x0 + 3, a.y0 + 0.6, a.z0 + 0.5], y: -Math.PI / 2 });
        g.transport.add({ k: "c", c: 1, p: [a.x0 + 3.5, a.y0 + 1.0625, a.z0 + 5.5], y: 0 });
        g.player.position.set(a.x0 + 3.5, a.y0 + 1, a.z0 + 4.5);
        return true;
      }, a);
      await guest.goto(`http://127.0.0.1:${PORT}/index.html?join=${code}&${NET_Q}`, { waitUntil: "load", timeout: 60000 });
      await guest.waitForSelector("#mp-join-boot:not(.hidden)", { timeout: 30000 });
      await guest.fill("#mp-boot-nick", "Bob");
      await guest.click("#mp-boot-join");
      await guest.waitForFunction(() => !!window.__ufo && window.__ufo.graphicsReady, null, { timeout: 120000 });
      assert(await until(guest, (g) => g.mp.stateLoaded, 60000), "the host's state never arrived");
      await v(guest, noDraw);
      await play(guest);
      const seen = await until(guest, (g) => (g.transport.vehicles.size === 2 ? [...g.transport.vehicles.values()].map((v) => v.kind).sort().join() : null), 20000);
      assert(seen === "boat,cart", `the guest's vehicles: ${seen}`);
      // The guest goes there and gets in.
      const bid = await v(guest, (g, a) => {
        const b = [...g.transport.vehicles.values()].find((v) => v.kind === "boat");
        g.player.setMode("survival");
        g.player.flying = false;
        g.player.position.set(b.pos.x, a.y0 + 1, b.pos.z + 1.5);
        g.transport.mount(b);
        return b.id;
      }, a);
      const seated = await until(guest, (g, id) => (g.player.mount && g.transport.vehicles.get(id).riders[0]?.p === g.net.pid ? true : null), 15000, bid);
      assert(seated, "the guest never got in");
      const hostSees = await until(host, (g, id) => (g.transport.vehicles.get(id)?.riders[0]?.p > 1 ? true : null), 10000, bid);
      assert(hostSees, "the host doesn't see the guest in the boat");
      const x0 = await v(host, (g, id) => g.transport.vehicles.get(id).pos.x, bid);
      await v(guest, (g) => g.player.keys.add("KeyW"));
      const moved = await until(host, (g, [id, x0]) => (g.transport.vehicles.get(id).pos.x - x0 > 2 ? g.transport.vehicles.get(id).pos.x - x0 : null), 30000, [bid, x0]);
      await v(guest, (g) => g.player.keys.clear());
      assert(moved, "the host never saw the boat move");
      // Out, and the chest minecart: a stack put in on the guest's screen is in the host's chest.
      await v(guest, (g) => g.transport.dismount());
      const put = await v(guest, async (g, a) => {
        const T = g.transport;
        const c = [...T.vehicles.values()].find((v) => v.kind === "cart");
        g.player.position.set(c.pos.x, a.y0 + 1, c.pos.z - 1.2);
        g.inventory.slots[5] = { id: 264, count: 9 };
        const opened = T.use(c, null);
        return { opened, id: c.id };
      }, a);
      assert(put.opened, "the guest's chest screen didn't open");
      const ready = await until(guest, (g) => (g.transport.view?.ready ? true : null), 10000);
      assert(ready, "the host's contents never came");
      await v(guest, (g) => new Promise((r) => g.transport.view && g.transport._submit(g.transport.view.v, [[2, null, { id: 264, count: 9 }]], r)));
      const hostHas = await until(host, (g, id) => {
        const s = g.transport.vehicles.get(id)?.slots?.[2];
        return s && s.id === 264 && s.count === 9 ? true : null;
      }, 10000, put.id);
      assert(hostHas, "the host's chest minecart doesn't have it");
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
