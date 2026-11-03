// Round 16 space tests: the seamless solar system (js/solar.js,
// js/solar-data.js, js/solar-render.js, js/solar-ui.js), the Warp Saucer
// (js/warp-saucer.js), the higher sky and the jets' ceiling, the rocket's
// climb straight into space (js/rocket.js, js/space.js).
// In Node (fast): the orbital mechanics (Kepler's steps keep an orbit, a
// Lambert transfer arrives), a spot on a planet and in its world, the air
// and the sky by height, the bodies, the Warp Saucer's item.
// In the browser (a Survival world in Creative):
//   - the wiring (the call-in buttons, the summons, the controls list);
//   - the jet's ceiling far below the sky's darkening, the sky blue up to
//     2,000 m and black at the space line;
//   - a UFO climbing past the space line flies on into space: no menu, the
//     same craft, the view not black (Low and High: the canvas's pixels);
//   - the guides (markers with distances, the target cycled, toggled), the
//     map; time warp for a UFO and its cap near a planet;
//   - the UFO to the Moon: the world goes there, the UFO high over it, it
//     lands; up again, back to Earth (the trip home);
//   - the Warp Saucer: J at warp, steered to Mars under control, dropping out
//     by itself in front of it, landing on Mars;
//   - the rocket: the climb with no cut-off, into space, the core stage
//     away, the assist into orbit, time warp (and off on thrust);
//   - a save made in space; no console errors anywhere.
//
//   node r16-space-tests.mjs [--only=substring] [--node]
// (GAME_ROOT=dir runs another copy of the game; SHOTS=dir saves screenshots.)
import http from "node:http";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { pngStats } from "./png-stats.mjs";

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

await check("orbits: a Kepler orbit closes after a turn (exact at any step), an escape stays on its path, a Lambert transfer arrives", async () => {
  const S = await imp("js/solar-data.js");
  const E = S.BODIES.earth;
  const r = [66000, 0, 0];
  const v = [0, 0, -Math.sqrt(E.gm / 66000)];
  const el = S.elements(r, v, E.gm);
  const r1 = r.slice();
  const v1 = v.slice();
  for (let i = 0; i < 7; i++) S.kepler(r1, v1, el.period / 7, E.gm);
  assert(Math.hypot(r1[0] - r[0], r1[2] - r[2]) < 1, `the orbit closes: ${r1}`);
  const r2 = r.slice();
  const v2 = v.slice();
  S.kepler(r2, v2, el.period * 1000.25, E.gm);
  assert(Math.abs(r2[2] + 66000) < 5, `a thousand turns at once: ${r2}`);
  const r3 = [66000, 0, 0];
  const v3 = [0, 0, -2000];
  const e0 = 2000 * 2000 / 2 - E.gm / 66000;
  S.kepler(r3, v3, 50000, E.gm);
  const e1 = S.dot(v3, v3) / 2 - E.gm / S.len(r3);
  assert(Math.abs(e1 - e0) < 1 && S.len(r3) > 3e7, `an escape keeps its energy: ${e0} ${e1} ${S.len(r3)}`);
  const tof = 9000;
  const moon = S.localState("moon", tof);
  const L = S.lambert(r, moon, tof, E.gm);
  assert(L, "a Lambert solution");
  const r4 = r.slice();
  const v4 = L.v1.slice();
  S.kepler(r4, v4, tof, E.gm);
  assert(Math.hypot(r4[0] - moon[0], r4[2] - moon[2]) < 50, `the transfer arrives at the Moon: ${r4} ${moon}`);
});

await check("the solar system: bodies, spheres, the space lines above the planes, the air and the sky by height, a spot on a planet and in its world", async () => {
  const S = await imp("js/solar-data.js");
  for (const id of ["sun", "mercury", "venus", "earth", "moon", "mars", "jupiter", "saturn"]) assert(S.BODIES[id], id);
  assert(S.BODY_OF_DIM.overworld === "earth" && S.BODY_OF_DIM.moon === "moon" && S.BODY_OF_DIM.mars === "mars", "the dimensions' bodies");
  assert(S.soiAt(S.absState("moon", 0), 0) === "moon", "the Moon's sphere");
  assert(S.spaceLineY("overworld") >= 5000 && S.spaceLineY("overworld") <= 8000, "the space line well up");
  assert(S.airDensity(64 + 300) === 1 && S.airDensity(64 + 2500) === 0, "the air thins by 2,200 up");
  assert(S.skyDark(64 + 1800) === 0 && S.skyDark(64 + 5500) === 1, "the sky blue up to 2,200, black by 5,400");
  assert(S.skyDark(64 + 1700) === 0 && S.airDensity(64 + 1700) < 0.5, "the planes' ceiling is under the sky's darkening");
  for (const b of ["earth", "moon", "mars"]) {
    for (const [x, z] of [[0, 0], [1234, -5678], [-900, 300]]) {
      const ll = S.worldToLatLon(b, x, z);
      const w = S.latLonToWorld(b, ll.lat, ll.lon);
      assert(Math.abs(w.x - x) < 0.01 && Math.abs(w.z - z) < 0.01, `${b}: ${x},${z} -> ${w.x},${w.z}`);
    }
  }
  // (the year, the Moon's month, a light-second in "blocks")
  assert(Math.abs(S.period("earth") - S.YEAR) / S.YEAR < 0.01, "the year");
  assert(S.fmtDist(54321000) === "54,321 km" && S.fmtSpeed(3e6).endsWith("c"), "the HUD's units");
});

await check("content: the Warp Saucer's item (Creative's Vehicles tab), in the space items' range", async () => {
  const S = await imp("js/content/space.js");
  const C = await imp("js/content/index.js");
  assert(S.WARP_ITEM >= 920 && S.WARP_ITEM <= 959, "id");
  assert(C.CONTENT_ITEMS[S.WARP_ITEM]?.vehicle === "warp" && typeof S.itemUse[S.WARP_ITEM] === "function" && typeof S.icons.vehicle_warp === "function", "the item");
});

// ---------- In the browser ----------

if (!args.node) await browserChecks();

async function browserChecks() {
  const { chromium } = await import("playwright-core");
  const PORT = 9870 + Math.floor(Math.random() * 40);
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
  const ctx = await browser.newContext({ viewport: { width: 960, height: 540 } });
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
  const run = (src, arg) => page.evaluate(([s, a]) => new Function("g", "a", `return (${s})(g, a);`)(window.__ufo, a), [src, arg]);
  const out = process.env.SHOTS || "";
  const shot = async (name) => {
    const buf = await page.screenshot();
    if (out) fs.writeFileSync(path.join(out, `r16-space-${name}.png`), buf);
    return pngStats(buf);
  };
  async function play() {
    const t0 = Date.now();
    while (Date.now() - t0 < 300000) {
      const st = await v((g) => g.gameState);
      if (st === "playing") return;
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
  // Steps the game with a fixed step, whatever the page's frame rate: (g, n).
  const STEP = `(g, n) => { for (let i = 0; i < n; i++) { g.vehicles.update(1 / 30); g.space.update(1 / 30); } }`;
  // Steps until fn(g) is true or n steps: the number of steps taken, or -1.
  const STEP_UNTIL = `(g, test, n, each) => { for (let i = 0; i < n; i++) { if (each) each(g); g.vehicles.update(1 / 30); g.space.update(1 / 30); if (test(g)) return i; } return -1; }`;
  // Real frames until the landing's ground is in and the craft is back in the world.
  const LANDED = `async (g) => { for (let i = 0; i < 900 && g.space.busy; i++) await new Promise((r) => requestAnimationFrame(r)); return !g.space.busy; }`;
  const callIn = (kind) => v(async (g, k) => {
    document.querySelector(`#pause-callins [data-callin="${k}"]`).click();
    for (let i = 0; i < 3; i++) await new Promise((r) => requestAnimationFrame(r));
    return g.vehicles.active?.type || null;
  }, kind);
  // (the keys held, as the player holds them)
  const hold = (codes) => v((g, c) => { g.player.keys.clear?.(); for (const k of c) g.player.keys.add(k); return true; }, codes);

  await browserCheck("boot: space wired in (the Warp Saucer's call-in and summon, the solar system, the controls list, the hooks)", async () => {
    await page.goto(`http://127.0.0.1:${PORT}/index.html?seed=1616&type=survival&graphics=low`, { waitUntil: "load", timeout: 60000 });
    await page.waitForFunction(() => !!window.__ufo && window.__ufo.graphicsReady, null, { timeout: 120000 });
    await play();
    await v(async (g) => {
      g.setMode("creative");
      // (late morning, held: the planet's day side under the climb)
      g.sky.setHours(10);
      g.sky.locked = true;
      for (let i = 0; i < 30; i++) await new Promise((r) => requestAnimationFrame(r));
      return true;
    });
    const r = await v((g) => ({
      noWarpBtn: !document.querySelector('#pause-callins [data-callin="warp"]'), // (any UFO warps: no separate button)
      rocketBtn: !!document.querySelector('#pause-callins [data-callin="rocket"]'),
      summon: !!g.vehicles.constructor.summons.warp,
      solar: !!g.space.solar,
      step: typeof g.vehicles.spaceStep === "function",
      controls: (document.getElementById("controls-list")?.textContent || "").includes("Time warp"),
      noMenu: !document.getElementById("space-menu"),
    }));
    assert(Object.values(r).every(Boolean), `wired: ${JSON.stringify(r)}`);
  });

  await browserCheck("the higher sky: a jet can't climb past about 2,000 m; the sky is blue there and black at the space line", async () => {
    const r = await run(`async (g, a) => {
      const step = new Function("return " + a.STEP)();
      const p = g.player.position;
      const jet = g.vehicles.create("jet", { jetType: "f22", pos: [p.x, 1000, p.z], yaw: 0, airborne: true, speed: 250, throttle: 1 });
      g.vehicles.enter(jet);
      jet.vel.set(0, 0, -250);
      // (the height it holds after any zoom climb: the last 20 s of a minute's full-power climb)
      let top = 0;
      let sum = 0;
      let cnt = 0;
      for (let i = 0; i < 30 * 60; i++) {
        g.player.keys.add("KeyW");
        g.player.keys.add("ShiftLeft");
        jet.aimQ?.setFromAxisAngle(new g.THREE.Vector3(1, 0, 0), 0.9);
        step(g, 1);
        if (i > 30 * 40) { top = Math.max(top, jet.pos.y); sum += jet.pos.y; cnt++; }
      }
      g.player.keys.clear();
      g.vehicles.exit({ force: true });
      g.vehicles.remove(jet);
      const sky = {};
      for (const y of [400, 1800, 6100]) {
        g.camera.position.y = y;
        for (let i = 0; i < 90; i++) g.space.update(1 / 30);
        sky[y] = g.space.sky.altK;
      }
      return { top, mean: sum / cnt, sky };
    }`, { STEP });
    assert(r.mean < 2100 && r.top < 2700, `the jet's ceiling (a zoom climb may poke a little higher): ${JSON.stringify(r)}`);
    assert(r.sky[400] < 0.02 && r.sky[1800] < 0.02 && r.sky[6100] > 0.9, `the sky: ${JSON.stringify(r)}`);
  });

  await browserCheck("a UFO climbs past the space line into space: no menu, the same craft and camera, the view not black (Low)", async () => {
    assert((await callIn("ufo")) === "ufo", "the UFO");
    const r = await run(`async (g, a) => {
      const step = new Function("return " + a.STEP)();
      const u = g.vehicles.active;
      u.pos.y = 5980;
      u.speedLevel = 1;
      g.player.keys.add("Space");
      const before = u;
      let n = 0;
      while (!g.space.busy && n < 300) { step(g, 1); n++; }
      g.player.keys.clear();
      const s = g.space.solar;
      return { busy: g.space.busy, steps: n, same: s.craft?.v === before, inScene: before.root.parent === s.view.craft, ref: s.craft?.ref, alt: s.craft ? Math.hypot(...s.craft.r) - 60000 : 0, menu: !!document.getElementById("space-menu"), active: g.vehicles.active === before };
    }`, { STEP });
    assert(r.busy && r.same && r.inScene && r.active && r.ref === "earth" && !r.menu && r.alt > 5900 && r.alt < 6200, `into space: ${JSON.stringify(r)}`);
    await frames(20);
    // (looking down at the planet below: its day side)
    await v((g) => { g.space.solar.craft.camPitch = -0.55; return true; });
    await frames(20);
    const s = await shot("ufo-space-low");
    assert(s.lit > 0.1 && s.mean > 8 && s.colours > 12, `the view (Low): ${JSON.stringify(s)}`);
  });

  await browserCheck("space at High graphics: not black (the canvas's pixels), and back to Low", async () => {
    await v((g) => g.setGraphics("high"));
    await page.waitForFunction(() => window.__ufo.graphicsReady, null, { timeout: 180000 });
    await frames(30);
    const s = await shot("ufo-space-high");
    assert(s.lit > 0.1 && s.mean > 8 && s.colours > 12, `the view (High): ${JSON.stringify(s)}`);
    // looking out to the stars and the Sun too
    await v((g) => {
      g.space.solar.aimAt("sun");
      return true;
    });
    await frames(20);
    const s2 = await shot("ufo-space-high-sun");
    assert(s2.mean > 3, `toward the Sun (High): ${JSON.stringify(s2)}`);
    await v((g) => g.setGraphics("low"));
    await page.waitForFunction(() => window.__ufo.graphicsReady, null, { timeout: 180000 });
    await frames(5);
  });

  await browserCheck("guides: markers with distances and times, the target cycled (T), off (N) and on; the map (M); time warp, capped near the planet", async () => {
    const r = await v(async (g) => {
      const s = g.space.solar;
      const out = {};
      for (let i = 0; i < 10; i++) await new Promise((r) => requestAnimationFrame(r));
      out.guides = s.ui.lastGuides.length;
      out.moon = s.ui.lastGuides.find((m) => m.id === "moon")?.dist;
      out.html = document.querySelector("#solar-hud .marks").textContent.includes("Mars");
      const t0 = s.target;
      s.inp.pressed.add("KeyT");
      g.space.update(1 / 30);
      out.cycled = s.target !== t0;
      s.inp.pressed.add("KeyN");
      g.space.update(1 / 30);
      out.off = !s.guides && document.querySelector("#solar-hud .marks").style.display === "none";
      s.inp.pressed.add("KeyN");
      s.inp.pressed.add("KeyM");
      g.space.update(1 / 30);
      out.map = s.mapOpen && getComputedStyle(document.getElementById("solar-map")).display === "block";
      s.inp.pressed.add("KeyM");
      g.space.update(1 / 30);
      // time warp near the ground: capped; further out: up to 1,000x
      for (let i = 0; i < 5; i++) s.setWarp(s.warpIndex + 1);
      out.warpNear = s.timeWarp;
      s.setWarp(0);
      return out;
    });
    assert(r.guides >= 6 && r.moon > 1e6 && r.html, `markers: ${JSON.stringify(r)}`);
    assert(r.cycled && r.off && r.map, `target, toggle, map: ${JSON.stringify(r)}`);
    assert(r.warpNear >= 1, `time warp: ${JSON.stringify(r)}`);
  });

  await browserCheck("a UFO to the Moon under control (time warp on the way), down into it: the world goes there, the UFO high over it, it lands", async () => {
    const r = await run(`async (g, a) => {
      const until = new Function("return " + a.STEP_UNTIL)();
      const s = g.space.solar;
      s.target = "moon";
      s.craft.speedLevel = 2;
      g.player.keys.add("KeyW");
      const out = {};
      const t0 = s.t;
      let warped = 1;
      out.steps = until(g, (g) => s.craft?.ref === "moon", 6000, () => { s.aimAt("moon"); if (s.warpIndex < 2) s.setWarp(s.warpIndex + 1); warped = Math.max(warped, s.timeWarp); });
      out.warped = warped;
      out.gameSecs = s.t - t0;
      out.down = until(g, (g) => !!s.pending || !s.active, 3000, () => s.aimAt("moon"));
      g.player.keys.clear();
      return out;
    }`, { STEP_UNTIL });
    assert(r.steps > 0 && r.down >= 0, `to the Moon: ${JSON.stringify(r)}`);
    assert(await run(LANDED), "the landing never came");
    const l = await run(`async (g, a) => {
      const until = new Function("return " + a.STEP_UNTIL)();
      const u = g.vehicles.active;
      const out = { dim: g.dims.dim, type: u?.type, y: u?.pos.y };
      if (!u) return out;
      g.player.keys.add("ShiftLeft");
      u.speedLevel = 1;
      out.steps = until(g, (g) => u.pos.y - u.bottom - g.vehicles.groundBelow(u.pos.x, u.pos.y, u.pos.z) < 3, 4000);
      g.player.keys.clear();
      out.agl = u.pos.y - u.bottom - g.vehicles.groundBelow(u.pos.x, u.pos.y, u.pos.z);
      out.space = g.space.busy;
      return out;
    }`, { STEP_UNTIL });
    assert(l.dim === "moon" && l.type === "ufo" && l.y > 1500 && l.y < 3100, `over the Moon: ${JSON.stringify(l)}`);
    assert(l.steps >= 0 && l.agl < 4 && !l.space, `landed on the Moon: ${JSON.stringify(l)}`);
    await frames(20);
    await shot("moon-landed");
  });

  await browserCheck("the trip back to Earth: up from the Moon into space, to Earth, down into the Overworld", async () => {
    const r = await run(`async (g, a) => {
      const until = new Function("return " + a.STEP_UNTIL)();
      const u = g.vehicles.active;
      u.speedLevel = 1;
      g.player.keys.add("Space");
      const out = {};
      out.up = until(g, (g) => g.space.busy, 4000);
      g.player.keys.clear();
      const s = g.space.solar;
      out.ref = s.craft?.ref;
      s.target = "earth";
      s.craft.speedLevel = 2;
      // (up and away from the Moon first, then toward Earth)
      g.player.keys.add("Space");
      until(g, (g) => Math.hypot(...s.craft.r) > 60000, 3000);
      g.player.keys.clear();
      g.player.keys.add("KeyW");
      out.home = until(g, (g) => !!s.pending || !s.active, 8000, () => s.aimAt("earth"));
      g.player.keys.clear();
      return out;
    }`, { STEP_UNTIL });
    assert(r.up >= 0 && r.ref === "moon" && r.home >= 0, `back: ${JSON.stringify(r)}`);
    assert(await run(LANDED), "the landing never came");
    const h = await v((g) => ({ dim: g.dims.dim, type: g.vehicles.active?.type, y: g.vehicles.active?.pos.y }));
    assert(h.dim === "overworld" && h.type === "ufo" && h.y > 3000 && h.y < 6064, `home: ${JSON.stringify(h)}`);
  });

  await browserCheck("the Warp Saucer: into space, J at warp, steered to Mars in tens of seconds, out of warp by itself in front of it, down onto Mars", async () => {
    const r = await run(`async (g, a) => {
      const until = new Function("return " + a.STEP_UNTIL)();
      g.vehicles.exit({ force: true });
      document.querySelector('#pause-callins [data-callin="ufo"]').click(); // (every UFO has the warp drive)
      const u = g.vehicles.active;
      const out = { warp: !!u?.warp, name: u?.name, parts: !!u?.warpParts };
      if (!u) return out;
      u.pos.y = 6000;
      g.player.keys.add("Space");
      out.up = until(g, (g) => g.space.busy, 300);
      g.player.keys.clear();
      const s = g.space.solar;
      out.kind = s.craft?.kind;
      // too near Earth for the drive at first
      s.inp.pressed.add("KeyJ");
      g.space.update(1 / 30);
      out.refusedNear = !s.craft.warpOn;
      // out a little way (a fast UFO)
      s.craft.speedLevel = 2;
      g.player.keys.add("Space");
      out.out = until(g, (g) => s._nearest(s.craft).dEff * 2 > 2 * 299792, 3000);
      g.player.keys.clear();
      s.target = "mars";
      s.aimAt("mars");
      s.inp.pressed.add("KeyJ");
      g.space.update(1 / 30);
      out.on = s.craft.warpOn;
      s.craft.warpFactor = 1000;
      let steps = 0;
      let maxC = 0;
      while (s.craft.warpOn && steps < 30 * 120) {
        s.aimAt("mars");
        g.vehicles.update(1 / 30);
        g.space.update(1 / 30);
        maxC = Math.max(maxC, (s.craft.warpSpeed || 0) / 299792);
        steps++;
      }
      out.secs = steps / 30;
      out.maxC = maxC;
      out.dropped = !s.craft.warpOn;
      out.ref = s.craft.ref;
      out.dist = s._nearest(s.craft).d;
      out.near = s._nearest(s.craft).id;
      out.streaks = s.view.warp.group.visible;
      g.player.keys.add("KeyW");
      s.craft.speedLevel = 1.6;
      out.down = until(g, (g) => !!s.pending || !s.active, 6000, () => s.aimAt("mars"));
      g.player.keys.clear();
      return out;
    }`, { STEP_UNTIL });
    assert(r.warp && r.kind === "warp", `the Warp Saucer: ${JSON.stringify(r)}`);
    assert(r.refusedNear && r.out >= 0 && r.on, `the drive: ${JSON.stringify(r)}`);
    assert(r.dropped && r.secs < 90 && r.maxC > 50 && r.near === "mars", `to Mars at warp: ${JSON.stringify(r)}`);
    assert(r.down >= 0, `down to Mars: ${JSON.stringify(r)}`);
    assert(await run(LANDED), "the landing never came");
    const m = await v((g) => ({ dim: g.dims.dim, warp: !!g.vehicles.active?.warp }));
    assert(m.dim === "mars" && m.warp, `on Mars: ${JSON.stringify(m)}`);
    await frames(20);
    await shot("mars");
  });

  await browserCheck("the rocket: no cut-off, climbs on into space; the core stage falls away; the assist into orbit; time warp (and off on thrust); a save", async () => {
    // (home first: the rocket from Earth's pad)
    await v((g) => {
      g.vehicles.exit({ force: true });
      g.dims.travel("overworld", 0.5, 90, 0.5, { place: "spawn" });
      return true;
    });
    await page.waitForFunction(() => !window.__ufo.dims.pending, null, { timeout: 60000 });
    await frames(10);
    assert((await callIn("rocket")) === "rocket", "the rocket");
    const r = await run(`async (g, a) => {
      const until = new Function("return " + a.STEP_UNTIL)();
      const rk = g.vehicles.active;
      const out = {};
      rk.startCountdown();
      out.climb = until(g, (g) => g.space.busy, 30 * 120);
      out.climbSecs = out.climb / 30;
      const s = g.space.solar;
      out.kind = s.craft?.kind;
      out.same = s.craft?.v === rk;
      out.phase = rk.phase;
      until(g, () => rk.stack === "ship", 30 * 6);
      out.stack = rk.stack;
      out.debris = s.view.debris.length;
      out.orbit = until(g, () => s.craft.assistMode !== "orbit", 30 * 150);
      const el = s.craft && g.space.solar.craft ? null : null;
      out.throttle = s.craft.throttle;
      out.ref = s.craft.ref;
      // time warp in orbit
      s.setWarp(3);
      out.warp = s.timeWarp;
      const t0 = s.t;
      for (let i = 0; i < 30; i++) { g.vehicles.update(1 / 30); g.space.update(1 / 30); }
      out.gameSecs = s.t - t0;
      out.alt = Math.hypot(...s.craft.r) - 60000;
      // thrust: back to 1x
      s.inp.pressed.add("KeyZ");
      g.vehicles.update(1 / 30);
      g.space.update(1 / 30);
      out.warpOnThrust = s.timeWarp;
      s.inp.pressed.add("KeyX");
      g.space.update(1 / 30);
      out.save = g.space.serialize();
      out.rocketSave = rk.serialize();
      return out;
    }`, { STEP_UNTIL });
    assert(r.climb > 0 && r.climbSecs > 30 && r.climbSecs < 80 && r.kind === "rocket" && r.same && r.phase === "space", `the climb into space: ${JSON.stringify(r)}`);
    assert(r.stack === "ship" && r.debris >= 1, `the core stage away: ${JSON.stringify(r)}`);
    assert(r.orbit >= 0 && r.throttle === 0 && r.ref === "earth" && r.alt > 6000, `into orbit: ${JSON.stringify(r)}`);
    assert(r.warp === 1000 && r.gameSecs > 500 && r.warpOnThrust === 1, `time warp: ${JSON.stringify(r)}`);
    assert(r.save.space?.solar && (r.rocketSave.phase === "pad" || r.rocketSave.phase === "landed") && Array.isArray(r.rocketSave.pad),`saved: ${JSON.stringify(r.save)} ${JSON.stringify(r.rocketSave)}`);
    await frames(20);
    const st = await shot("rocket-orbit");
    assert(st.lit > 0.05, `the view in orbit: ${JSON.stringify(st)}`);
  });

  await browserCheck("the rocket's assist to the Moon: the burn it asks for puts the ship on a path into the Moon's sphere (time-warped)", async () => {
    const r = await run(`async (g, a) => {
      const s = g.space.solar;
      const c = s.craft;
      s.target = "moon";
      c.assist = true;
      s._plan = null;
      const out = { cues: [] };
      let burnt = 0;
      for (let i = 0; i < 30 * 200 && c.ref !== "moon" && s.active; i++) {
        const P = c.plan;
        if (P && P.cue === "burn" && P.aligned) { c.throttle = 1; burnt++; } else if (c.throttle > 0) c.throttle = 0;
        if (P && P.cue === "cut" && c.throttle === 0 && s.warpIndex < 4) s.setWarp(s.warpIndex + 1);
        if (P?.cue && out.cues[out.cues.length - 1] !== P.cue) out.cues.push(P.cue);
        g.vehicles.update(1 / 30);
        g.space.update(1 / 30);
      }
      out.burnSecs = burnt / 30;
      out.gameT = s.t;
      out.ref = s.craft?.ref;
      return out;
    }`, {});
    assert(r.ref === "moon" && r.burnSecs > 3, `to the Moon by rocket: ${JSON.stringify(r)}`);
    console.log(`        (by rocket: ${JSON.stringify(r)})`);
  });

  if (errors.length) console.log(`  (console errors: ${errors.slice(0, 5).join(" | ")})`);
  await browser.close();
  server.close();
}

// ---------- Summary ----------
const failed = results.filter(([, ok]) => !ok);
console.log(`\n${results.length - failed.length} passed, ${failed.length} failed.`);
process.exit(failed.length ? 1 : 0);
