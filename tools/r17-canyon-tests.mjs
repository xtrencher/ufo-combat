// Round 17 canyon run tests (track B, "Canyon"): the time of day held, the
// canyon ahead in full detail and in time at a jet's top speed, the throttle
// carried over a respawn, and a respawn at every checkpoint that flies on.
// (js/canyon.js, js/dim-canyon.js, js/menu-canyon.js)
//
// In Node (fast): every checkpoint of every course, difficulty, scenery and
// open-stretch choice: the respawn's spot (dim-canyon.js respawnPoint) has
// room for a wingspan and clear air straight ahead (the old spot, the ring
// itself, counted for comparison); the time option in the run's address.
// In the browser: the canyon screen's Time option reaches the run, and the
// sun stays where it was put (the settings' clock lock off, minutes on);
// the view scales with the graphics preset (Ultra and High much further);
// the canyon streamed ahead of a jet flown at 1.5 times today's top speed
// (headless, a paced 60 Hz loop: the frames' drawing left out), the chunks
// on its line always in before it gets there; the throttle, the afterburner
// and the speed carried into the respawned jet (a sensible speed for that
// throttle); every checkpoint respawn of every course and difficulty (and
// the Space scenery, lots of valleys) flown 3 seconds with no input by the
// real flight model, against the course's own rock: never into it.
//
//   node r17-canyon-tests.mjs [--only=substring] [--node]
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

// Clear air straight ahead of (x, y, z) along (dx, dz), level: a jet's width (blocks, up to max).
function aheadOf(c, x, y, z, dx, dz, max = 400) {
  const n = Math.hypot(dx, dz);
  dx /= n;
  dz /= n;
  for (let d = 0; d <= max; d += 4) {
    const px = x + dx * d;
    const pz = z + dz * d;
    for (const [o, oy] of [[0, 0], [6, 0], [-6, 0], [0, 3], [0, -3]]) if (c.solidAt(px - dz * o, y + oy, pz + dx * o)) return d;
  }
  return max;
}

await check("every checkpoint's respawn spot: room for a wingspan, clear air ahead (all courses, difficulties, sceneries, open stretches)", async () => {
  let n = 0;
  let oldBad = 0;
  let newBad = 0;
  const worst = [];
  const biomes = [null, ...BIO.BIOME_ORDER, C.BIOME_MIXED, C.BIOME_SPACE];
  const opens = args.quick ? [null] : [null, "none", "lots"];
  for (const course of C.CANYON_COURSES) {
    for (const diff of BIO.DIFF_ORDER) {
      for (const biome of biomes) {
        for (const open of opens) {
          const c = new C.CanyonCourse(C.canyonSeed(course.seed, { biome, diff, open }));
          for (const r of c.rings()) {
            if (r.kind === "finish") continue;
            n++;
            // (the old spot: in the ring, along the canyon there)
            if (aheadOf(c, r.x, r.y, r.z, Math.sin(r.yaw), Math.cos(r.yaw)) < 100) oldBad++;
            const p = c.respawnPoint(r, 140);
            const dx = -Math.sin(p.yaw);
            const dz = -Math.cos(p.yaw);
            const ahead = aheadOf(c, p.x, p.y, p.z, dx, dz);
            const room = c._room(p.x, p.y, p.z);
            const tag = `${course.id} ${diff} ${biome || "own"} ${open || "some"} checkpoint ${r.i} (z ${r.z})`;
            assert(c._clear(p.x, p.y, p.z, 9) && room >= 8, `${tag}: no room at the spot (${room})`);
            assert(p.z > r.z && p.z <= r.z + 200, `${tag}: the spot at z ${p.z}`);
            const sl = c.slope(p.z + 30);
            const along = (dx * sl + dz) / Math.hypot(sl, 1);
            assert(along > Math.cos(0.7), `${tag}: heading ${p.yaw} (more than 40 degrees off the course there)`);
            assert(p.y >= c.row(Math.round(p.z)).lo - 4 && p.y <= c.row(Math.round(p.z)).hi + 6, `${tag}: altitude ${p.y}`);
            if (ahead < 100) {
              newBad++;
              worst.push(`${tag}: ${ahead}`);
            }
            assert(ahead >= 24, `${tag}: rock ${ahead} blocks straight ahead`);
          }
        }
      }
    }
  }
  console.log(`        ${n} respawn spots: under 100 blocks of clear air straight ahead, the old spot (the ring) ${oldBad}, the new ${newBad}`);
  for (const w of worst.slice(0, 6)) console.log(`          ${w}`);
  assert(newBad <= n * 0.005, `${newBad} of ${n} spots with little room ahead`);
});

// ---------- Browser ----------

if (!args.node) await browserChecks();

async function browserChecks() {
  const { chromium } = await import("playwright-core");
  const PORT = 9960 + Math.floor(Math.random() * 25);
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
  const ctx = await browser.newContext({ viewport: { width: Number(args.w) || 640, height: Number(args.h) || 360 } });
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
      await new Promise((res) => setTimeout(res, 250));
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
  async function open(q) {
    await page.goto(`${base}?${q}`, { waitUntil: "load", timeout: 60000 });
    await page.waitForFunction(() => !!window.__ufo && window.__ufo.graphicsReady && window.__ufo.canyon, null, { timeout: 120000 });
  }
  const shots = process.env.SHOTS || "";
  const shot = async (name) => {
    if (!shots) return;
    fs.mkdirSync(shots, { recursive: true });
    await page.screenshot({ path: path.join(shots, `${name}.png`) });
    console.log(`        screenshot ${path.join(shots, `${name}.png`)}`);
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
  // Simulated frames (deterministic, faster than real time).
  const STEP = `(g, a) => {
    const c = g.canyon; const dt = a.dt || 1 / 30;
    for (let i = 0; i < a.n; i++) {
      g.vehicles.update(dt);
      if (g.vehicles.active) g.vehicles.updateCamera(g.camera, dt);
      c.update(dt, true);
      if (a.stopAt && c.state === a.stopAt) break;
    }
    return c.info();
  }`;
  const step = (n, opts = {}) => page.evaluate(([src, a]) => new Function("return " + src)()(window.__ufo, a), [STEP, { n, ...opts }]);
  const base = `http://127.0.0.1:${PORT}/index.html`;
  // (the afterburner burst at 1.5 x today's top speed, blocks: --burst=)
  const BURST = Number(args.burst) || 4000;

  await browserCheck("time of day: the canyon screen's Time option (Day by default) reaches the run's address", async () => {
    await page.goto(`${base}?seed=4242&graphics=low`, { waitUntil: "load", timeout: 60000 });
    await page.waitForFunction(() => !!window.__ufo && window.__ufo.graphicsReady, null, { timeout: 120000 });
    await page.evaluate(() => localStorage.removeItem("ufocombat_v1_canyon_pref"));
    await click("#menu-canyon-btn");
    await frames(3);
    const r = await v(() => ({ n: document.querySelectorAll('[data-opt="time"] .cy-seg-btn').length, def: document.querySelector('[data-opt="time"] .cy-seg-btn.active')?.dataset.v, labels: [...document.querySelectorAll('[data-opt="time"] .cy-seg-btn')].map((b) => b.textContent) }));
    assert(r.n === 3 && r.def === "day" && r.labels.join() === "Day,Dusk,Night", `the Time option: ${JSON.stringify(r)}`);
    await shot("r17-menu");
    await page.evaluate(() => document.querySelector('[data-opt="time"] .cy-seg-btn[data-v="dusk"]').click());
    await Promise.all([page.waitForURL(/canyon=/, { timeout: 60000 }), click("#canyon-fly")]);
    const q = Object.fromEntries(new URL(page.url()).searchParams);
    assert(q.time === "dusk", `the address: ${page.url()}`);
    await page.waitForFunction(() => !!window.__ufo && window.__ufo.graphicsReady && window.__ufo.canyon, null, { timeout: 120000 });
    const t = await v((g) => ({ tod: g.canyon.timeOfDay, angle: g.sky.sunAngle, locked: g.sky.locked, pref: JSON.parse(localStorage.getItem("ufocombat_v1_canyon_pref")).time, next: g.canyon.options.time }));
    assert(t.tod === "dusk" && Math.abs(t.angle - 2.98) < 1e-3 && t.locked && t.pref === "dusk" && t.next === "dusk", `the run: ${JSON.stringify(t)}`);
  });

  await browserCheck("time of day held: day by default, night when asked, the sun never moving (the settings' clock lock off, minutes going by)", async () => {
    for (const [q, angle] of [["", 2.2], ["&time=night", 4.6]]) {
      await open(`canyon=night&jet=f22&graphics=low${q}`);
      await play();
      const a = await v((g) => ({ time: g.sky.time, angle: g.sky.sunAngle, night: g.sky.isNight }));
      // (the settings unlock the clock, hacks speed it up, minutes of sky go by)
      await v((g) => {
        g.settingsPanel?.set?.("timeLocked", false);
        g.sky.locked = false;
        g.sky.timeScale = 120;
        for (let i = 0; i < 600; i++) {
          g.sky.update(0.5, g.camera.position, new g.THREE.Vector3(0, 0, 1));
          g.canyon.update(0.5, false);
        }
        g.sky.timeScale = 1;
        return true;
      });
      await frames(30);
      const b = await v((g) => ({ time: g.sky.time, angle: g.sky.sunAngle, locked: g.sky.locked, night: g.sky.isNight }));
      assert(Math.abs(a.angle - angle) < 1e-3 && Math.abs(b.angle - angle) < 1e-3 && Math.abs(b.time - a.time) < 1e-6 && b.locked, `${q || "day"}: ${JSON.stringify({ a, b })}`);
      assert(b.night === (angle > Math.PI), `${q || "day"}: night ${b.night}`);
      await shot(`r17-time${q.replace(/\W/g, "") || "day"}`);
    }
  });

  await browserCheck("the view scales with the graphics: Ultra and High stream much further in full than Low (the fog past the far terrain)", async () => {
    await open("canyon=grand&jet=f22&graphics=low");
    const out = {};
    for (const p of ["low", "medium", "high", "ultra"]) {
      await v((g, pp) => g.setGraphics(pp, { adoptRenderDistance: "force" }), p); // (as the Settings menu picks a preset: its render distance too)
      await until((g) => g.graphicsReady, 120000);
      await frames(3);
      out[p] = await v((g) => {
        const c = g.canyon;
        const u = g.THREE ? null : null;
        void u;
        return { near: c.aheadRows, far: c.farRows, rd: g.renderDistance, budget: c.streamBudget, fogEnd: c.farRows * 16 - 40, camFar: g.camera.far };
      });
    }
    console.log(`        ${Object.entries(out).map(([p, o]) => `${p}: ${o.near} rows in full (${o.near * 16} blocks), far terrain to ${o.far}, ${o.budget} ms`).join("; ")}`);
    assert(out.low.near >= 36 && out.medium.near > out.low.near && out.high.near > out.medium.near && out.ultra.near > out.high.near, `the rows: ${JSON.stringify(out)}`);
    assert(out.ultra.near * 16 >= 1500 && out.high.near * 16 >= 1200, `Ultra / High not far enough: ${JSON.stringify(out)}`);
    for (const o of Object.values(out)) assert(o.far > o.near && o.camFar >= o.fogEnd, `the far end: ${JSON.stringify(o)}`);
  });

  await browserCheck("the canyon ahead is in before the jet gets there at 1.5 x today's top speed (afterburner), Ultra and High", async () => {
    for (const preset of ["high", "ultra"]) {
      await open(`canyon=grand&jet=f22&graphics=low`);
      await v((g, p) => g.setGraphics(p, { adoptRenderDistance: "force" }), preset);
      await until((g) => g.graphicsReady, 120000);
      // (headless: the page's own frames stopped; a loop paced at 60 Hz streams
      // and meshes as the frame does, the jet flown along the course's line at
      // 1.5 x the F-22's afterburner top; the world's drawing left out)
      const r = await page.evaluate(async (arg) => {
        const g = window.__ufo;
        const c = g.canyon;
        const w = g.world;
        window.requestAnimationFrame = () => 0;
        await new Promise((res) => setTimeout(res, 200));
        const j = g.vehicles.active;
        const top = Math.max(j.cfg.maxSpeed, (1235 / 3.6) * (j.spec.mach || 1));
        const speed = top * 1.5;
        const tick = 1000 / 60;
        const out = { speed, top, workers: w._genWorkers?.length || 0, waits: 0, ticks: 0, minLead: Infinity, minLeadFull: Infinity, preloadS: 0, near: c.aheadRows, flown: 0, budgetMs: 0, overTicks: 0 };
        let z = j.pos.z;
        const place = (zz) => {
          const p = c.course.safePoint(zz);
          const q = c.course.safePoint(zz + 8);
          const f = (zz - Math.floor(zz / 8) * 8) / 8;
          j.pos.set(p.x + (q.x - p.x) * f, p.y + (q.y - p.y) * f, zz);
          j.vel.set(0, 0, speed);
          g.player.position.copy(j.pos);
        };
        const T = { stream: 0, queues: 0, far: 0, lead: 0 };
        // (where the main thread's time goes: the chunks taken in and lit, the meshes handed out and taken back)
        const P = {};
        for (const name of ["_generate", "_dispatchMesh", "_applyMeshResult", "_dispatchGen", "_buildMesh"]) {
          const f = w[name].bind(w);
          P[name] = { n: 0, ms: 0, max: 0 };
          w[name] = (...a) => {
            const t = performance.now();
            const r = f(...a);
            const d = performance.now() - t;
            P[name].n++;
            P[name].ms += d;
            P[name].max = Math.max(P[name].max, d);
            return r;
          };
        }
        const frame = (sp) => {
          const t0 = performance.now();
          if (sp) {
            // (the run holds a jet whose ground just ahead isn't in: counted)
            const nz = z + sp / 60;
            const cx = Math.floor(c.course.row(Math.floor(nz)).xc / 16);
            const ok = [0, 8].every((k) => {
              const zz = Math.floor((nz + sp * (k / 60)) / 16);
              return !w.wantsMesh(cx, zz) || !!w.getChunk(cx, zz)?.meshed;
            });
            if (ok) z = nz;
            else out.waits++;
          }
          place(z);
          j.vel.set(0, 0, sp || speed);
          const t1 = performance.now();
          c.stream(j.pos.x, j.pos.z);
          const t2 = performance.now();
          const b = c.streamBudget;
          w.processQueues(b);
          const t3 = performance.now();
          c._updateFar();
          const t4 = performance.now();
          c._measureLead(j);
          const t5 = performance.now();
          T.stream += t2 - t1;
          T.queues += t3 - t2;
          T.far += t4 - t3;
          T.lead += t5 - t4;
          out.budgetMs = b;
          const ms = performance.now() - t0;
          if (ms > tick * 1.5) out.overTicks++;
          return ms;
        };
        const sleep = (ms) => new Promise((res) => setTimeout(res, Math.max(0, ms)));
        // At the mouth: what the run waits for (the line 10 rows ahead, then
        // most of the view: canyon.js _loadedAhead), then the 3 s countdown.
        const t0 = performance.now();
        while (!(c._readyAhead(z, 10) && c._loadedAhead(1 / 60)) && performance.now() - t0 < 180000) await sleep(tick - frame(0));
        out.preloadS = (performance.now() - t0) / 1000;
        for (let i = 0; i < 180; i++) await sleep(tick - frame(0));
        for (const k in P) P[k] = { n: 0, ms: 0, max: 0 };
        const g0 = w.stats.generated;
        const tf0 = performance.now();
        // Then the afterburner at 1.5 x today's top for BURST blocks, and
        // on at today's top speed (the afterburner's) to 6 km: the lead
        // (seconds of flight to the first row not in) and any wait counted.
        const startZ = z;
        out.burst = arg.burst;
        out.minLeadTop = Infinity;
        out.waitsTop = 0;
        while (z < startZ + 6000 && out.ticks < 60 * 90) {
          const fast = z < startZ + arg.burst;
          const w0 = out.waits;
          const ms = frame(fast ? speed : top);
          out.ticks++;
          if (fast) {
            out.minLead = Math.min(out.minLead, c.lead.s);
            out.minLeadFull = Math.min(out.minLeadFull, c.lead.fullS);
          } else {
            out.minLeadTop = Math.min(out.minLeadTop, c.lead.s);
            out.waitsTop += out.waits - w0;
          }
          await sleep(tick - ms);
          if (out.ticks === 1) out.leadAtGo = { line: c.lead.line, full: c.lead.full };
        }
        out.flown = z - startZ;
        const secs = (performance.now() - tf0) / 1000;
        // (what this computer keeps up with: chunks a second, the rows of a corridor that makes)
        out.genPerS = (w.stats.generated - g0) / secs;
        let n = 0;
        let sum = 0;
        for (const [a, b] of c._spans.values()) {
          sum += b - a + 3;
          n++;
        }
        out.perRow = sum / Math.max(1, n);
        out.sustained = (out.genPerS / out.perRow) * 16;
        out.parts = Object.fromEntries(Object.entries(P).map(([k, o]) => [k, `${o.n} x ${(o.ms / Math.max(1, o.n)).toFixed(2)} ms`]));
        out.ms = Object.fromEntries(Object.entries(T).map(([k, x]) => [k, +(x / Math.max(1, out.ticks)).toFixed(1)]));
        out.endLead = { line: c.lead.line, full: c.lead.full, s: +c.lead.s.toFixed(2) };
        return out;
      }, { burst: BURST });
      console.log(`        ${preset}: ${r.near} rows in full (${r.near * 16} blocks), ${r.workers} workers; loaded in ${r.preloadS.toFixed(1)} s, at GO ${JSON.stringify(r.leadAtGo)} rows in; ${(BURST / 1000).toFixed(1)} km at ${r.speed.toFixed(0)} blocks/s (1.5 x the afterburner's ${r.top.toFixed(0)}): the least lead ${r.minLead.toFixed(2)} s on the line (${r.minLeadFull.toFixed(2)} s whole rows), waits ${r.waits - r.waitsTop}; then ${r.top.toFixed(0)} blocks/s to 6 km: the least lead ${r.minLeadTop.toFixed(2)} s, waits ${r.waitsTop}; end ${JSON.stringify(r.endLead)}`);
      console.log(`          this computer: ${r.genPerS.toFixed(0)} chunks a second (${r.perRow.toFixed(1)} a row: ${r.sustained.toFixed(0)} blocks/s kept up for good); main thread a frame ${JSON.stringify(r.ms)} ms; ${JSON.stringify(r.parts)}; slow frames ${r.overTicks}/${r.ticks}`);
      assert(r.leadAtGo.full >= r.near * 0.8, `${preset}: little in at GO: ${JSON.stringify(r.leadAtGo)}`);
      assert(r.waits - r.waitsTop === 0 && r.minLead >= 0.5, `${preset}: the jet caught up with the canyon at 1.5 x top speed (${r.waits - r.waitsTop} frames held, the least lead ${r.minLead.toFixed(2)} s)`);
    }
  });

  await browserCheck("throttle carried over: the respawned jet flies at the throttle, afterburner and speed it had (a sensible speed for it)", async () => {
    await open("canyon=grand&jet=f22&graphics=low");
    await play();
    const r = await until((g) => (g.canyon.state === "flying" ? g.canyon.info() : null), 200000);
    assert(r, "never flying");
    // (the speed a throttle holds in level flight: the jet's top speed setting x throttle / sqrt(1.3), vehicle-jet.js)
    const cfg = await v((g) => ({ max: g.vehicles.active.cfg.maxSpeed, stall: g.vehicles.active.cfg.stallSpeed }));
    const hold = (t) => (cfg.max * t) / Math.sqrt(1.3);
    const cases = [
      { throttle: 0.9, ab: false, speed: hold(0.9) * 0.95, want: [0.9, false, hold(0.9) * 0.95, hold(0.9) * 0.95] },
      { throttle: 1, ab: true, speed: 470, want: [1, true, 470, 470] },
      { throttle: 0.05, ab: false, speed: 40, want: [0.3, false, Math.max(cfg.stall * 1.7, hold(0.3) * 0.7), hold(0.3) * 1.1] }, // (raised: no stalling)
      { throttle: 0.5, ab: false, speed: 380, want: [0.5, false, hold(0.5) * 0.7, hold(0.5) * 1.1] }, // (a dive's speed brought back to what the throttle holds)
    ];
    for (const k of cases) {
      const s = await v((g, k) => {
        const c = g.canyon;
        const j = g.vehicles.active;
        // (past checkpoint 2, then into the wall: the frame before the crash at this throttle and speed)
        if (c.clock === null) c.clock = 10;
        c.nextCheck = 3;
        const ring = c.checks[2];
        const row = c.course.row(ring.z + 60);
        const y = Math.round((row.floor + Math.min(row.rim, row.ceil)) / 2);
        j.throttle = k.throttle;
        j.afterburner = k.ab;
        c._abHold = false; // (the last case's afterburner let go: as Shift pressed and released)
        c._carry = { throttle: k.throttle, ab: k.ab, speed: k.speed };
        c.waitForGround = false;
        j.pos.set(row.R[y] - 12, y, row.z);
        j.q.setFromAxisAngle(new g.THREE.Vector3(0, 1, 0), -Math.PI / 2);
        j.vel.set(k.speed, 0, 0);
        // (the afterburner: Shift held into the wall, let go after the crash)
        if (k.ab) g.player.keys.add("ShiftLeft");
        j.aimQ.copy(j.q);
        c._lastPos.copy(j.pos);
        return true;
      }, k);
      void s;
      let i = await step(20, { stopAt: "crashed" });
      assert(i.state === "crashed", `crashed: ${i.state}`);
      await v((g) => g.player.keys.delete("ShiftLeft"));
      i = await step(200, { stopAt: "countdown" });
      assert(i.state === "countdown", `respawned: ${i.state}`);
      const a = await v((g) => ({ ...g.canyon.info(), stall: g.vehicles.active.cfg.stallSpeed }));
      const [t, ab, lo, hi] = k.want;
      assert(Math.abs(a.throttle - t) < 0.02 && a.afterburner === ab && a.speed >= lo * 0.97 - 1 && a.speed <= hi * 1.03 + 1 && a.speed > a.stall * 1.6, `${JSON.stringify(k)}: ${JSON.stringify({ throttle: a.throttle, ab: a.afterburner, speed: a.speed, stall: a.stall })}`);
      i = await step(120, { stopAt: "flying" });
      assert(i.state === "flying", `flying: ${i.state}`);
      // (no input: the throttle stays as it was, the speed holds up)
      i = await step(30);
      assert(i.state === "flying" && Math.abs(i.throttle - t) < 0.02 && i.speed > a.stall * 1.5 && i.afterburner === ab, `after GO: ${JSON.stringify({ state: i.state, throttle: i.throttle, ab: i.afterburner, speed: i.speed })}`);
      console.log(`        before the crash ${k.throttle} ${k.ab ? "AB" : ""} ${k.speed.toFixed(0)}: back at ${a.throttle.toFixed(2)} ${a.afterburner ? "AB" : ""} ${a.speed.toFixed(0)} blocks/s`);
    }
    await shot("r17-respawn");
  });

  await browserCheck("every checkpoint respawn survives its first 3 seconds with no input (every course and difficulty, Space, lots of valleys)", async () => {
    await open("canyon=grand&jet=f22&graphics=low");
    await play();
    await until((g) => (g.canyon.state === "flying" ? 1 : null), 200000);
    // (the page's own frames stopped, its chunks dropped: each course's rock is its own shape here)
    await page.evaluate(async () => {
      const g = window.__ufo;
      window.requestAnimationFrame = () => 0;
      await new Promise((res) => setTimeout(res, 300));
      const w = g.world;
      g.canyon.stream = () => true;
      for (const ch of w.chunks.values()) {
        w.scene.remove(ch.group);
        ch.dispose();
      }
      w.chunks.clear();
      w.genQueue.length = 0;
      w.genQueued.clear();
      w.meshQueue.length = 0;
      w._meshSet = new Set();
    });
    const configs = [];
    for (const course of ["grand", "slot", "night", "gauntlet"]) for (const diff of ["easy", "normal", "hard", "insane"]) configs.push({ course, diff });
    for (const course of ["grand", "slot", "night", "gauntlet"]) configs.push({ course, diff: "normal", biome: "space" }, { course, diff: "hard", open: "lots" });
    const speeds = args.old ? [null] : [null, { throttle: 1, ab: false, speed: 263 }];
    let total = 0;
    let rescued = 0;
    const fails = [];
    const graced = [];
    for (const cfg of configs) {
      for (const carry of speeds) {
        const r = await page.evaluate(
          async ([cfg, carry, old]) => {
            const g = window.__ufo;
            const C = await import("./js/dim-canyon.js");
            const base = C.CANYON_COURSES.find((c) => c.id === cfg.course).seed;
            const course = new C.CanyonCourse(C.canyonSeed(base, { biome: cfg.biome || null, diff: cfg.diff, open: cfg.open || null }));
            const c = g.canyon;
            const own = c.course;
            c.course = course;
            const T = g.THREE;
            const fails = [];
            const graced = [];
            let rescued = 0;
            let n = 0;
            const dt = 1 / 30;
            const fw = new T.Vector3();
            const rt = new T.Vector3();
            const up = new T.Vector3();
            try {
              for (const ring of course.rings()) {
                if (ring.kind === "finish") continue;
                n++;
                c._carry = carry;
                c.jet = c.jet || g.vehicles.active;
                const k = c._respawnCarry();
                // (--old: the Round 16 respawn, in the ring along the canyon, no autopilot, for comparison)
                const pose = old ? { x: ring.x, y: ring.y, z: ring.z, yaw: Math.PI + ring.yaw, ahead: "-" } : course.respawnPoint(ring, k.speed);
                const j = c._makeJet(pose, k.speed, k.throttle);
                c._guide = old ? null : { t: 0, on: true, aim: null, steered: false };
                c.state = "flying";
                const r0 = c.stats.rescues || 0;
                let hit = null;
                let out = null;
                // (the airframe against the rock every frame, as the jet's own
                // probes do against the blocks in the game: a touch is a crash,
                // which the respawn's grace eases back onto the line)
                let touched = null;
                for (let i = 0; i < 90 && !hit; i++) {
                  g.vehicles.update(dt);
                  if (!old) c._guideJet(dt, j);
                  if (!j.alive) {
                    hit = `destroyed at ${(i * dt).toFixed(1)}s (${j.crashWhy || j.lastHitBy})`;
                    break;
                  }
                  j.forward(fw);
                  j.right(rt);
                  j.up(up);
                  const p = j.pos;
                  for (const [a, b, h] of [[7.4, 0, 0], [3, 0, 0], [0, 6.2, 0], [0, -6.2, 0], [-6, 0, 0], [0, 0, -1.4], [-5, 0, 2]]) {
                    if (course.solidAt(p.x + fw.x * a + rt.x * b + up.x * h, p.y + fw.y * a + rt.y * b + up.y * h, p.z + fw.z * a + rt.z * b + up.z * h)) {
                      touched = touched || `rock at ${(i * dt).toFixed(2)}s (${p.x.toFixed(0)}, ${p.y.toFixed(0)}, ${p.z.toFixed(0)})`;
                      j._crash("crash");
                      if (!j.alive) hit = `crashed: ${touched}`;
                      break;
                    }
                  }
                  const row = course.row(Math.floor(p.z));
                  if (!out && (p.y > row.outY || Math.abs(p.x - row.xc) > row.outX)) out = `out of the course at ${(i * dt).toFixed(1)}s`;
                }
                if (j.alive && (c.stats.rescues || 0) > r0) {
                  rescued++;
                  graced.push(`checkpoint ${ring.i} (z ${ring.z}, spot z ${pose.z}): ${touched || "the jet's own probes"}`);
                }
                if (hit || out) fails.push(`checkpoint ${ring.i} (z ${ring.z}, spot z ${pose.z} ahead ${pose.ahead}): ${hit || out}`);
              }
            } finally {
              c.course = own;
              c._guide = null;
            }
            return { n, fails, rescued, graced };
          },
          [cfg, carry, !!args.old]
        );
        total += r.n;
        rescued += r.rescued;
        for (const f of r.graced) graced.push(`${cfg.course} ${cfg.diff} ${cfg.biome || ""}${cfg.open || ""} ${carry ? "full throttle" : "start speed"}: ${f}`);
        for (const f of r.fails) fails.push(`${cfg.course} ${cfg.diff} ${cfg.biome || ""}${cfg.open || ""} ${carry ? "full throttle" : "start speed"}: ${f}`);
      }
    }
    console.log(`        ${total} respawns flown 3 s with no input: ${fails.length} lost (crashed or out of the course); ${rescued} touched the rock and were eased back by the grace (${((rescued / total) * 100).toFixed(1)}%)`);
    for (const f of fails.slice(0, args.verbose ? 500 : 8)) console.log(`          lost: ${f}`);
    for (const f of graced.slice(0, args.verbose ? 500 : 4)) console.log(`          grace: ${f}`);
    assert(rescued <= total * 0.02, `${rescued} of ${total} respawns needed the grace`);
    assert(fails.length === 0, `${fails.length} respawns didn't fly on: ${fails.slice(0, 3).join(" | ")}`);
  });

  await browserCheck("no console errors", async () => {
    assert(errors.length === 0, errors.slice(0, 5).join(" | "));
  });

  await browser.close();
  server.close();
}

// ---------- Summary ----------
const failed = results.filter(([, ok]) => !ok);
console.log(`\n${results.length - failed.length} passed, ${failed.length} failed.`);
process.exit(failed.length ? 1 : 0);
