// Round 15 space tests: the rocket (js/rocket.js), the trip through space
// (js/space.js, js/space-sky.js), the Moon and Mars (js/dim-moon.js,
// js/dim-mars.js, js/content/space.js, their js/dim-registry.js entries).
// In Node (fast): the blocks and items (ids in their ranges, the rocket item,
// the drops), the dimensions' entries (codes, keys, gravity), the generators
// (deterministic, fast, heights in the world, the landing zones level, the
// things to find near them). In the browser (a Survival world in Creative):
// the call-in puts a rocket on a new pad by its tower, the player in it;
// the countdown, ignition, lift-off, the climb, the boosters falling away,
// the sky darkening; engine cut-off hands over to the orbit's scene; the
// choice of the Moon: the world goes there, the ship comes down by itself
// and lands on its legs; low gravity there (the player, an item, a creature;
// a fall hurts less); back to orbit from the Moon and home to Earth, landing
// by the pad; a save made mid-trip puts the player back at the pad with the
// rocket. With --online: a guest watches the host's launch (the countdown's
// smoke, the climb, the boosters falling) and the rocket goes at orbit.
//
//   node r15-space-tests.mjs [--only=substring] [--node] [--online]
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

await check("content: the Moon's and Mars' blocks and items in their ranges, registered; the rocket item; the drops", async () => {
  const S = await imp("js/content/space.js");
  const C = await imp("js/content/index.js");
  const ids = Object.keys(S.blocks).map(Number);
  assert(ids.length >= 20 && ids.every((id) => id >= 3072 && id <= 3199), `block ids: ${ids}`);
  for (const id of ids) assert(C.CONTENT_BLOCKS[id] === S.blocks[id], `block ${id} registered`);
  const items = Object.keys(S.items).map(Number);
  assert(items.every((id) => id >= 920 && id <= 959), `item ids: ${items}`);
  for (const id of items) assert(C.CONTENT_ITEMS[id] === S.items[id], `item ${id} registered`);
  assert(S.items[S.ROCKET_ITEM].vehicle === "rocket" && typeof S.itemUse[S.ROCKET_ITEM] === "function" && typeof S.icons.vehicle_rocket === "function", "the rocket item");
  const crystals = C.BLOCK_DROPS[S.LUNAR_CRYSTAL_ORE](null, Math.random);
  assert(crystals[0][0] === S.LUNAR_CRYSTAL && crystals[0][1] >= 1, "lunar crystal ore drops crystals");
  for (const def of Object.values(S.blocks)) {
    const faces = typeof def.faces === "string" ? [def.faces] : Object.values(def.faces);
    for (const f of faces) assert(typeof S.tiles[f] === "function", `tile ${f}`);
  }
});

await check("dimensions: the Moon and Mars in the registry (codes, keys, generators, gravity, rocket only)", async () => {
  const D = await imp("js/dim-registry.js");
  assert(D.DIMS.moon && D.DIMS.mars, "entries");
  const codes = Object.values(D.DIMS).map((d) => d.code);
  assert(new Set(codes).size === codes.length, `codes unique: ${codes}`);
  for (const dim of ["moon", "mars"]) {
    assert(D.dimOfCode(D.codeOf(dim)) === dim, `code round trip: ${dim}`);
    assert(D.DIM_IDS.includes(dim), `${dim} in DIM_IDS`);
    const k = D.dimKey(dim, 1, 2, 3);
    const p = D.parseDimKey(k);
    assert(p && p[3] === dim && p[0] === 1 && p[2] === 3, `key ${k}`);
    assert(D.DIMS[dim].sky?.sun && D.DIMS[dim].rocketOnly, `${dim}: a sky with a sun, rocket only`);
  }
  assert(Math.abs(D.DIMS.moon.gravity - 1 / 6) < 1e-6 && Math.abs(D.DIMS.mars.gravity - 0.38) < 1e-6, "gravity");
  assert(D.createGenerator("moon", 1).constructor.name === "MoonGenerator" && D.createGenerator("mars", 1).constructor.name === "MarsGenerator", "generators");
});

await check("generators: deterministic, fast, heights in the world, level landing zones, things to find near them", async () => {
  const { MoonGenerator } = await imp("js/dim-moon.js");
  const { MarsGenerator } = await imp("js/dim-mars.js");
  const S = await imp("js/content/space.js");
  const { WORLD_HEIGHT } = await imp("js/constants.js");
  for (const [name, G, wants] of [["moon", MoonGenerator, [S.PROBE_CORE, S.ALIEN_RELIC]], ["mars", MarsGenerator, [S.PROBE_CORE, S.ALIEN_RELIC]]]) {
    const a = new G(4242);
    const b = new G(4242);
    let ms = 0;
    let n = 0;
    const found = new Set();
    for (let cz = -9; cz <= 9; cz++) {
      for (let cx = -9; cx <= 9; cx++) {
        const c1 = { cx, cz, blocks: new Uint16Array(16 * WORLD_HEIGHT * 16) };
        const t0 = performance.now();
        a.generate(c1);
        ms += performance.now() - t0;
        n++;
        if ((cx + cz) % 4 === 0) {
          const c2 = { cx, cz, blocks: new Uint16Array(16 * WORLD_HEIGHT * 16) };
          b.generate(c2);
          for (let i = 0; i < c1.blocks.length; i += 97) assert(c1.blocks[i] === c2.blocks[i], `${name} deterministic at ${cx},${cz}`);
        }
        for (const id of wants) if (c1.blocks.includes(id)) found.add(id);
      }
    }
    const per = ms / n;
    assert(per < 15, `${name}: ${per.toFixed(2)} ms a chunk`);
    let lo = 999;
    let hi = -1;
    for (let x = -60; x <= 60; x += 4) for (let z = -60; z <= 60; z += 4) {
      const h = a.heightAt(x, z);
      assert(h > 4 && h < WORLD_HEIGHT - 4, `${name}: height ${h} at ${x},${z}`);
      if (Math.hypot(x, z) < 24) {
        lo = Math.min(lo, h);
        hi = Math.max(hi, h);
      }
    }
    assert(hi - lo <= 9, `${name}: the landing zone is level enough (${lo}..${hi})`);
    for (const id of wants) assert(found.has(id), `${name}: block ${id} near the landing zone`);
    console.log(`        ${name}: ${per.toFixed(2)} ms a chunk, landing zone ${lo}..${hi}`);
  }
});

// ---------- In the browser ----------

if (!args.node) await browserChecks();

async function browserChecks() {
  const { chromium } = await import("playwright-core");
  const PORT = 9830 + Math.floor(Math.random() * 40);
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
    executablePath: (await import("./chromium-path.mjs")).default,
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
    while (Date.now() - t0 < 300000) {
      const st = await v(p, (g) => g.gameState);
      if (st === "playing") return;
      if (st === "dead") {
        await v(p, (g) => g.respawn());
        continue;
      }
      const click = (sel) => p.evaluate((s) => document.querySelector(s)?.click(), sel).catch(() => {});
      if (st === "start") await click("#play-btn");
      else if (await p.isVisible("#resume-btn")) await click("#resume-btn");
      else if (await p.isVisible("#click-to-play").catch(() => false)) await click("#click-to-play");
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
  const shot = async (p, name) => out && (await p.screenshot({ path: path.join(out, `r15-space-${name}.png`) }));
  // Steps the rocket (and the trip) with a fixed step, whatever the page's frame rate: (g, n).
  const STEP = `(g, n) => { for (let i = 0; i < n; i++) { g.vehicles.update(1 / 30); g.space.update(1 / 30); g.effects.update(1 / 30); } }`;
  // Waits (real frames) until the trip's travel has its ground and the ship is in the world again.
  const ARRIVE = `async (g) => {
    for (let i = 0; i < 600 && g.space.trip; i++) {
      const t = g.space.trip;
      if (t.phase === "transfer") t.t = Math.max(t.t, 9);
      if (t.phase === "approach") t.t = Math.max(t.t, 4.9);
      await new Promise((r) => requestAnimationFrame(r));
    }
    return !g.space.trip;
  }`;
  const run = (p, src, arg) => p.evaluate(([s, a]) => new Function("g", "a", `return (${s})(g, a);`)(window.__ufo, a), [src, arg]);

  const page = await newPage("solo");
  const soloOnly = args.only && String(args.only).includes("online");
  if (!soloOnly) await browserCheck("boot: the rocket and space wired in (the vehicle type, its summon, the call-in button, the space system, the sky's hook)", async () => {
    await page.goto(`http://127.0.0.1:${PORT}/index.html?seed=1515&type=survival&graphics=low`, { waitUntil: "load", timeout: 60000 });
    await page.waitForFunction(() => !!window.__ufo && window.__ufo.graphicsReady, null, { timeout: 120000 });
    await play(page);
    const r = await v(page, (g) => ({ type: !!g.vehicles.constructor.types.rocket, summon: !!g.vehicles.constructor.summons.rocket?.ground, button: !!document.querySelector('#pause-callins [data-callin="rocket"]'), space: !!g.space, hook: typeof g.sky.post === "function" }));
    assert(Object.values(r).every(Boolean), `wired: ${JSON.stringify(r)}`);
  });

  if (!soloOnly) await browserCheck("the call-in: a rocket on a new launch pad by its tower, the player aboard", async () => {
    const r = await v(page, async (g) => {
      g.setMode("creative");
      for (let i = 0; i < 40; i++) await new Promise((res) => requestAnimationFrame(res));
      document.querySelector('#pause-callins [data-callin="rocket"]').click();
      const rk = g.vehicles.active;
      if (!rk) return { none: true };
      const [x, y, z] = rk.pad;
      const S = await import("./js/content/space.js");
      return { type: rk.type, stack: rk.stack, phase: rk.phase, tower: !!rk.tower, under: g.world.getBlock(Math.floor(x), y - 1, Math.floor(z)) === S.LAUNCH_PAD, edge: g.world.getBlock(Math.floor(x) + 6, y - 1, Math.floor(z)) === S.LAUNCH_PAD_EDGE, onPad: Math.abs(rk.pos.y - y) < 0.01 };
    });
    assert(r.type === "rocket" && r.stack === "full" && r.phase === "pad" && r.tower && r.under && r.edge && r.onPad, `called in: ${JSON.stringify(r)}`);
    await frames(page, 20);
    await shot(page, "pad");
  });

  if (!soloOnly) await browserCheck("the launch: countdown (Space), the tower's arms, ignition held down, lift-off, the climb speeding up, the boosters falling away, the sky darkening, engine cut-off into orbit", async () => {
    const r = await run(page, `async (g, a) => {
      const step = new Function("return " + a.STEP)();
      const rk = g.vehicles.active;
      const out = {};
      g.vehicles.input.pressed.add("Space");
      step(g, 1);
      out.counting = rk.phase === "count" && rk.count > 9;
      step(g, 30 * 5);
      out.arms = rk.tower ? rk.tower.arms[0].rotation.y : 0;
      step(g, 30 * 3.5);
      out.ignition = rk.phase === "count" && rk.power.core > 0.3 && rk.power.boost > 0.3;
      out.heldDown = Math.abs(rk.pos.y - rk.pad[1]) < 0.01;
      out.caption = g.space.lastCaption;
      step(g, 30 * 2);
      out.liftoff = rk.phase === "ascent";
      step(g, 30 * 3);
      const y1 = rk.pos.y, v1 = rk.vel.length();
      step(g, 30 * 3);
      out.climb = rk.pos.y - y1;
      out.faster = rk.vel.length() > v1 * 1.3;
      step(g, 30 * 8.5);
      out.stack = rk.stack;
      out.debris = g.space.debris.length;
      step(g, 30 * 9);
      // (the sky follows the eye: the camera up with the rocket)
      rk.updateCamera(g.camera, 1 / 30);
      for (let i = 0; i < 60; i++) g.space.update(1 / 30);
      out.alt = rk.pos.y - rk.pad[1];
      out.altK = g.space.sky.altK;
      out.tilt = rk._up(new g.THREE.Vector3()).y;
      step(g, 30 * 2);
      out.trip = g.space.trip?.phase;
      out.view = !!g.space.view;
      out.rocketGone = !g.vehicles.vehicles.includes(rk);
      out.held = g.player.enabled === false && !g.vehicles.active;
      return out;
    }`, { STEP });
    assert(r.counting && r.arms < -0.5, `the countdown, the arms: ${JSON.stringify(r)}`);
    assert(r.ignition && r.heldDown, `ignition held down: ${JSON.stringify(r)}`);
    assert(r.liftoff && r.climb > 15 && r.faster, `lift-off and the climb: ${JSON.stringify(r)}`);
    assert(r.stack === "core" && r.debris === 4, `the boosters away: ${JSON.stringify(r)}`);
    assert(r.alt > 500 && r.altK > 0.6 && r.tilt < 0.95, `high, turned over, the sky darkening: ${JSON.stringify(r)}`);
    assert(r.trip === "insert" && r.view && r.rocketGone && r.held, `into orbit: ${JSON.stringify(r)}`);
    await frames(page, 20);
    await shot(page, "insert");
  });

  if (!soloOnly) await browserCheck("orbit: the destinations; a save made now goes back to the pad; to the Moon: the world goes there, the ship comes down by itself and lands on its legs", async () => {
    const saved = await v(page, (g) => {
      g.space.trip.t = 99;
      g.space.update(1 / 30);
      const s = g.space.serialize();
      return { phase: g.space.trip.phase, menu: document.querySelector("#space-menu").style.display, s };
    });
    assert(saved.phase === "orbit" && saved.menu === "flex", `in orbit: ${JSON.stringify(saved)}`);
    assert(Array.isArray(saved.s.pos) && saved.s.space?.trip?.stack === "full", `a save mid-trip: back at the pad: ${JSON.stringify(saved.s)}`);
    await frames(page, 10);
    await shot(page, "orbit");
    // (pressing 1: the Moon)
    await page.keyboard.press("Digit1");
    const tr = await v(page, (g) => g.space.trip?.phase);
    assert(tr === "transfer", `the transfer: ${tr}`);
    const arrived = await run(page, ARRIVE);
    assert(arrived, "the trip never ended");
    const r = await run(page, `async (g, a) => {
      const step = new Function("return " + a.STEP)();
      const rk = g.vehicles.active;
      const out = { dim: g.dims.dim, type: rk?.type, phase: rk?.phase, y0: rk?.pos.y };
      if (!rk) return out;
      let t = 0;
      while (rk.phase === "descent" && t < 30 * 90) {
        step(g, 10);
        t += 10;
      }
      out.phase2 = rk.phase;
      out.legs = rk.legsK;
      out.alive = rk.alive;
      out.secs = t / 30;
      out.site = g.space.sites.moon;
      out.onGround = Math.abs(rk.pos.y - g.vehicles.groundBelow(rk.pos.x, rk.pos.y + 1, rk.pos.z)) < 0.05;
      return out;
    }`, { STEP });
    assert(r.dim === "moon" && r.type === "rocket" && r.phase === "descent" && r.y0 > 150, `coming down on the Moon: ${JSON.stringify(r)}`);
    assert(r.phase2 === "landed" && r.legs > 0.9 && r.alive && r.onGround && Array.isArray(r.site), `landed: ${JSON.stringify(r)}`);
    await frames(page, 30);
    await shot(page, "moon-landed");
  });

  if (!soloOnly) await browserCheck("the Moon's low gravity: the player (a jump six times as high, a fall hurting less), a dropped item, a creature", async () => {
    const r = await v(page, async (g) => {
      const out = {};
      g.vehicles.exit({ force: true });
      const p = g.player;
      p.flying = false;
      // a jump's rise: v^2 / 2g
      p.velocity.set(0, 0, 0);
      p.position.y += 30;
      const v0 = p.velocity.y;
      for (let i = 0; i < 3; i++) p.update(1 / 30);
      out.dvPlayer = (p.velocity.y - v0) / 0.1; // (blocks/s^2 over 0.1 s: -26/6 expected)
      // a fall from 15 blocks in Survival: no harm (it hurts as a fall of 2.5)
      p.setMode("survival");
      const hp = p.health;
      const gy = g.vehicles.groundBelow(p.position.x, p.position.y, p.position.z);
      p.position.y = gy + 15;
      p.velocity.set(0, 0, 0);
      p.resetFall?.();
      for (let i = 0; i < 400 && !(p.onGround && i > 5); i++) p.update(1 / 30);
      out.fallHurt = hp - p.health;
      p.setMode("creative");
      // an item
      const it = g.entities.spawn(1, 1, new g.THREE.Vector3(p.position.x + 2, p.position.y + 20, p.position.z));
      const item = it && it.vel ? it : g.entities.items?.[g.entities.items.length - 1];
      if (item) {
        item.vel.set(0, 0, 0);
        const y0 = item.vel.y;
        g.entities.update(0.1, p);
        out.dvItem = (item.vel.y - y0) / 0.1;
      }
      // a creature
      const m = g.mobs.spawn ? g.mobs.spawn("pig", { x: p.position.x + 3, y: p.position.y + 25, z: p.position.z }) : null;
      if (m) {
        m.vel.set(0, 0, 0);
        const before = m.vel.y;
        g.mobs.update(0.05);
        out.dvMob = (m.vel.y - before) / 0.05;
      }
      return out;
    });
    assert(Math.abs(r.dvPlayer + 26 / 6) < 0.6, `the player falls at 1/6 g: ${JSON.stringify(r)}`);
    assert(r.fallHurt === 0, `a 15-block fall doesn't hurt on the Moon: ${JSON.stringify(r)}`);
    if (r.dvItem !== undefined) assert(r.dvItem > -6 && r.dvItem < -1, `an item falls slowly: ${JSON.stringify(r)}`);
    if (r.dvMob !== undefined) assert(r.dvMob > -8 && r.dvMob < -1, `a creature falls slowly: ${JSON.stringify(r)}`);
  });

  if (!soloOnly) await browserCheck("home: back aboard on the Moon, lift-off, orbit, Earth: the ship lands by the pad it left from", async () => {
    const r = await run(page, `async (g, a) => {
      const step = new Function("return " + a.STEP)();
      const rk = g.vehicles.vehicles.find((x) => x.type === "rocket" && x.phase === "landed");
      const out = { found: !!rk };
      if (!rk) return out;
      g.vehicles.enter(rk);
      rk.startCountdown();
      step(g, 30 * 4);
      out.climbing = rk.phase === "ascent";
      let t = 0;
      while (!g.space.trip && t < 30 * 30) {
        step(g, 10);
        t += 10;
      }
      out.trip = g.space.trip?.phase;
      out.from = g.space.trip?.from;
      return out;
    }`, { STEP });
    assert(r.found && r.climbing && r.trip === "insert" && r.from === "moon", `off the Moon: ${JSON.stringify(r)}`);
    await v(page, (g) => {
      g.space.trip.t = 99;
      g.space.update(1 / 30);
      return g.space.choose("overworld");
    });
    assert(await run(page, ARRIVE), "the trip home never ended");
    const h = await run(page, `async (g, a) => {
      const step = new Function("return " + a.STEP)();
      const rk = g.vehicles.active;
      const out = { dim: g.dims.dim, phase: rk?.phase };
      if (!rk) return out;
      let t = 0;
      while (rk.phase === "descent" && t < 30 * 90) {
        step(g, 10);
        t += 10;
      }
      out.phase2 = rk.phase;
      const pad = g.space.sites.overworld;
      out.pad = pad;
      out.dist = pad ? Math.hypot(rk.pos.x - pad[0], rk.pos.z - pad[2]) : -1;
      return out;
    }`, { STEP });
    assert(h.dim === "overworld" && h.phase === "descent", `coming home: ${JSON.stringify(h)}`);
    assert(h.phase2 === "landed" && h.dist >= 0 && h.dist < 12, `landed by the pad: ${JSON.stringify(h)}`);
    await frames(page, 30);
    await shot(page, "home");
  });

  if (!soloOnly) await browserCheck("a save mid-trip: loaded, the player is back by the pad and the rocket stands on it again", async () => {
    const r = await v(page, (g) => {
      const before = g.vehicles.vehicles.length;
      g.space.init({ sites: { overworld: [10, 70, 10] }, trip: { from: "overworld", pad: [g.player.position.x + 30.5, 90, g.player.position.z + 0.5], stack: "full", yaw: 0 } });
      const rk = g.vehicles.vehicles[g.vehicles.vehicles.length - 1];
      return { added: g.vehicles.vehicles.length - before, type: rk?.type, phase: rk?.phase, stack: rk?.stack, tower: !!rk?.tower, site: g.space.sites.overworld };
    });
    assert(r.added === 1 && r.type === "rocket" && r.phase === "pad" && r.stack === "full" && r.tower && r.site?.[0] === 10, `restored: ${JSON.stringify(r)}`);
  });

  if (args.online) {
    const { default: express } = await import("express");
    const { ExpressPeerServer } = await import("peer");
    const PEER_PORT = PORT + 60;
    const app = express();
    const peerHttp = app.listen(PEER_PORT, "127.0.0.1");
    app.use("/ufo", ExpressPeerServer(peerHttp, { path: "/" }));
    const NET_Q = `peerServer=127.0.0.1:${PEER_PORT}/ufo&noStun=1&graphics=low`;
    await page.close();
    const host = await newPage("host", { width: 640, height: 360 });
    const guest = await newPage("guest", { width: 640, height: 360 });
    await browserCheck("online: a guest watches the host's launch (the countdown, the climb, the boosters falling); the rocket goes at orbit", async () => {
      await host.goto(`http://127.0.0.1:${PORT}/index.html?seed=1516&type=survival&${NET_Q}`, { waitUntil: "load", timeout: 60000 });
      await host.waitForFunction(() => !!window.__ufo && window.__ufo.graphicsReady, null, { timeout: 120000 });
      await host.click("#menu-mp-btn");
      await host.fill("#mp-nick", "Alice");
      await host.click("#mp-host-btn");
      const code = await until(host, (g) => g.net.code, 30000);
      assert(code, "no room code");
      await host.click("#mp-lobby-play");
      await host.waitForFunction(() => window.__ufo.gameState === "playing", null, { timeout: 30000 });
      await guest.goto(`http://127.0.0.1:${PORT}/index.html?join=${code}&${NET_Q}`, { waitUntil: "load", timeout: 60000 });
      await guest.waitForSelector("#mp-join-boot:not(.hidden)", { timeout: 30000 });
      await guest.fill("#mp-boot-nick", "Bob");
      await guest.click("#mp-boot-join");
      await guest.waitForFunction(() => !!window.__ufo && window.__ufo.graphicsReady, null, { timeout: 120000 });
      assert(await until(guest, (g) => g.mp.stateLoaded, 60000), "the host's state never arrived");
      await play(guest);
      const pad = await v(host, (g) => {
        g.setMode("creative");
        document.querySelector('#pause-callins [data-callin="rocket"]').click();
        const rk = g.vehicles.active;
        return rk ? rk.pad : null;
      });
      assert(pad, "the host's rocket");
      await v(guest, (g, pad) => { g.player.position.set(pad[0] + 40, pad[1] + 2, pad[2]); return true; }, pad);
      const seen = await until(guest, (g) => (g.vehicles.vehicles.find((x) => x.type === "rocket" && x.puppet) ? true : null), 30000);
      assert(seen, "the guest never saw the host's rocket");
      await v(host, (g) => { g.vehicles.active.startCountdown(); g.vehicles.active.count = 2; return true; });
      const count = await until(guest, (g) => { const r = g.vehicles.vehicles.find((x) => x.type === "rocket" && x.puppet); return r && (r.phase === "count" || r.phase === "ascent") ? r.phase : null; }, 20000);
      assert(count, "the guest never saw the countdown");
      // (the host's climb, stepped on the host whatever its page's frame rate)
      await v(host, (g) => { for (let i = 0; i < 30 * 16; i++) { g.vehicles.update(1 / 30); g.space.update(1 / 30); } return true; });
      const climb = await until(guest, (g, y0) => { const r = g.vehicles.vehicles.find((x) => x.type === "rocket" && x.puppet); return r && r.pos.y > y0 + 80 && r.stack === "core" && g.space.debris.length ? { y: r.pos.y, debris: g.space.debris.length } : null; }, 30000, pad[1]);
      assert(climb, "the guest didn't see the climb and the boosters");
      await v(host, (g) => { for (let i = 0; i < 30 * 14; i++) { g.vehicles.update(1 / 30); g.space.update(1 / 30); } return !!g.space.trip; });
      const gone = await until(guest, (g) => (!g.vehicles.vehicles.some((x) => x.type === "rocket" && x.puppet) ? true : null), 30000);
      assert(gone, "the host's rocket stayed on the guest's screen after orbit");
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
