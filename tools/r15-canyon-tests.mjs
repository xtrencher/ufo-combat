// Round 15 canyon run tests: the courses (js/dim-canyon.js), the run
// (js/canyon.js) and its menu (js/menu-canyon.js).
// In Node (fast): a course is the same block for block from the same seed
// (and another seed another canyon), quick to make; every course is
// flyable end to end (open air down the middle, the rings clear of the
// rock, in order, from the start gate to the finish); the par times, the
// time format, the page's parameters.
// In the browser: the main menu's "Canyon run" opens its screen, a course
// and a jet picked there open the run's page; that page is in the canyon's
// dimension, the player in the jet picked at the mouth, nothing of the
// player's worlds touched; the countdown, then flying; a ring flown through
// counts (the start gate starts the clock), one flown past costs 5 s; a
// wall hit ends the run (the results, R flies again); a finish records the
// best time (and its ghost); The Gauntlet's AA guns shoot and are destroyed;
// "Main menu" goes back to the plain menu. --fly flies a whole course on an
// autopilot (the streaming keeps up; slow).
//
//   node r15-canyon-tests.mjs [--only=substring] [--node] [--fly]
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

function hashBlocks(b) {
  let h = 2166136261;
  for (let i = 0; i < b.length; i++) h = Math.imul(h ^ b[i], 16777619);
  return h >>> 0;
}

await check("the course generator: the same seed makes the same canyon, another seed another one; quick", async () => {
  const { CanyonGenerator, CANYON_COURSES } = await imp("js/dim-canyon.js");
  for (const c of CANYON_COURSES) {
    const a = new CanyonGenerator(c.seed);
    const b = new CanyonGenerator(c.seed);
    let n = 0;
    let ms = 0;
    for (const [dx, cz] of [[0, 3], [1, 40], [-1, 90], [0, 200], [2, 300]]) {
      const cx = Math.floor(a.course.centerX(cz * 16) / 16) + dx;
      const ca = { cx, cz, blocks: new Uint16Array(16 * 16 * 128) };
      const cb = { cx, cz, blocks: new Uint16Array(16 * 16 * 128) };
      const t0 = performance.now();
      a.generate(ca);
      ms += performance.now() - t0;
      b.generate(cb);
      n++;
      assert(hashBlocks(ca.blocks) === hashBlocks(cb.blocks), `${c.id}: chunk ${cx},${cz} differs between two generators`);
    }
    // (rows of a second generator made in another order: the same)
    const late = new CanyonGenerator(c.seed);
    const cz = 120;
    const cx = Math.floor(late.course.centerX(cz * 16) / 16);
    const x1 = { cx, cz, blocks: new Uint16Array(16 * 16 * 128) };
    late.generate({ cx: cx + 1, cz: cz + 1, blocks: new Uint16Array(16 * 16 * 128) });
    late.generate(x1);
    const x2 = { cx, cz, blocks: new Uint16Array(16 * 16 * 128) };
    a.generate(x2);
    assert(hashBlocks(x1.blocks) === hashBlocks(x2.blocks), `${c.id}: the order chunks are made in changes them`);
    void ms;
  }
  const g1 = new CanyonGenerator(CANYON_COURSES[0].seed);
  const g2 = new CanyonGenerator(CANYON_COURSES[0].seed + 7);
  let same = 0;
  for (let cz = 10; cz < 30; cz++) if (Math.round(g1.course.centerX(cz * 16)) === Math.round(g2.course.centerX(cz * 16))) same++;
  assert(same < 10, "another seed winds the same way");
  // (a chunk's worth of time, on average over a stretch of canyon)
  const t0 = performance.now();
  let k = 0;
  for (let cz = 50; cz < 70; cz++) for (let dx = -3; dx <= 3; dx++) {
    g1.generate({ cx: Math.floor(g1.course.centerX(cz * 16) / 16) + dx, cz, blocks: new Uint16Array(16 * 16 * 128) });
    k++;
  }
  const per = (performance.now() - t0) / k;
  assert(per < 8, `a stretch of canyon: ${per.toFixed(2)} ms a chunk`);
  console.log(`        (${per.toFixed(2)} ms a chunk)`);
});

await check("every course is flyable end to end: open air down the canyon, rings in order, clear of the rock", async () => {
  const { CanyonCourse, CANYON_COURSES } = await imp("js/dim-canyon.js");
  for (const c of CANYON_COURSES) {
    const course = new CanyonCourse(c.seed);
    const t0 = performance.now();
    const rings = course.rings();
    const ms = performance.now() - t0;
    assert(ms < 1500, `${c.id}: rings planned in ${ms.toFixed(0)} ms`);
    assert(rings[0].kind === "start" && rings[0].z === 0, `${c.id}: the start gate first`);
    assert(rings[rings.length - 1].kind === "finish" && rings[rings.length - 1].z === course.length, `${c.id}: the finish last`);
    const checks = rings.filter((r) => r.kind === "check");
    assert(checks.length >= course.length / 600, `${c.id}: ${checks.length} checkpoints`);
    for (let i = 1; i < rings.length; i++) assert(rings[i].z >= rings[i - 1].z, `${c.id}: rings out of order at ${i}`);
    for (const r of rings) {
      assert(!course.solidAt(r.x, r.y, r.z), `${c.id}: ring ${r.i} (${r.kind}) in the rock`);
      for (let a = 0; a < 8; a++) {
        const ang = (a / 8) * Math.PI * 2;
        const ox = Math.cos(ang) * r.r;
        assert(!course.solidAt(r.x + Math.cos(r.yaw) * ox, r.y + Math.sin(ang) * r.r, r.z - Math.sin(r.yaw) * ox), `${c.id}: ring ${r.i}'s rim in the rock`);
      }
    }
    // Every 25 blocks: somewhere across the canyon, a gap a jet fits (16 wide, 10 tall).
    let tight = Infinity;
    for (let z = -200; z <= course.length + 100; z += 25) {
      const row = course.row(z);
      let ok = false;
      let widest = 0;
      for (let y = row.floor + 5; y < Math.min(row.rim - 4, row.ceil - 4) && !ok; y += 3) {
        let run = 0;
        for (let x = Math.floor(row.xMin) - 2; x <= Math.ceil(row.xMax) + 2; x++) {
          const open = !course.solidAt(x, y, z) && !course.solidAt(x, y + 5, z) && !course.solidAt(x, y - 5, z);
          run = open ? run + 1 : 0;
          widest = Math.max(widest, run);
          if (run >= 16) ok = true;
        }
      }
      tight = Math.min(tight, widest);
      assert(ok, `${c.id}: no way through at z ${z} (widest ${widest})`);
    }
    // ...and a corridor of open air joins one ring to the next (sampled along the straight line between them, the ring's own radius tolerance).
    let blocked = 0;
    for (let i = 1; i < rings.length; i++) {
      const a = rings[i - 1];
      const b = rings[i];
      for (let k = 1; k < 8; k++) {
        const f = k / 8;
        if (course.solidAt(a.x + (b.x - a.x) * f, a.y + (b.y - a.y) * f, a.z + (b.z - a.z) * f)) {
          blocked++;
          break;
        }
      }
    }
    console.log(`        ${c.id}: ${(course.length / 1000).toFixed(1)} km, ${checks.length} checkpoints, ${rings.filter((r) => r.kind === "boost").length} boost rings, ${course.arches.length} arches, ${course.pillars.length} pillars, ${course.fins.length} fins, ${course.tunnels.length} tunnels, ${course.turrets().length} AA, tightest ${tight}, ${blocked} legs not straight`);
  }
});

await check("par times, the time's format, the page's parameters", async () => {
  const C = await imp("js/dim-canyon.js");
  // (canyon.js needs a browser's three.js: its pure helpers are checked in the page below; the
  // time format here from its source)
  const src = fs.readFileSync(path.join(ROOT, "js/canyon.js"), "utf8");
  assert(src.includes("export function medalTimes") && src.includes("export function canyonParams"), "helpers exported");
  const grand = C.courseOf(C.CANYON_COURSES[0].seed);
  assert(grand.id === "grand", "a fixed course's seed");
  const rnd = C.courseOf(123456789);
  assert(rnd.id === null && ["grand", "slot", "night", "gauntlet"].includes(rnd.kind) && rnd.length >= 9000, "a random seed is a canyon too");
});

if (!args.node) await browserChecks();

async function browserChecks() {
  const { chromium } = await import("playwright-core");
  const PORT = 9970 + Math.floor(Math.random() * 25);
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
  // Run a few simulated frames at once (deterministic, faster than real time).
  const STEP = `(g, n, dt = 1 / 30) => { const c = g.canyon; c.waitForGround = false; for (let i = 0; i < n; i++) { g.vehicles.update(dt); if (g.vehicles.active) g.vehicles.updateCamera(g.camera, dt); g.lasers.update(dt); c.update(dt, true); } return c.info(); }`;
  const step = (n, dt) => page.evaluate(([src, n, dt]) => new Function("return " + src)()(window.__ufo, n, dt), [STEP, n, dt]);

  const base = `http://127.0.0.1:${PORT}/index.html`;
  let menuOk = false;
  await browserCheck("the main menu: Canyon run opens its screen (4 courses, 2 jets); Fly opens the run's page", async () => {
    await page.goto(`${base}?seed=4242&graphics=low`, { waitUntil: "load", timeout: 60000 });
    await page.waitForFunction(() => !!window.__ufo && window.__ufo.graphicsReady, null, { timeout: 120000 });
    await page.evaluate(() => localStorage.setItem("ufocombat_v1_last", JSON.stringify({ seed: 4242, type: "survival" })));
    await click("#menu-canyon-btn");
    await frames(3);
    const r = await v(() => ({ shown: !document.getElementById("canyon-screen")?.classList.contains("hidden"), cards: document.querySelectorAll(".cy-course-card").length, jets: document.querySelectorAll(".cy-jet").length }));
    assert(r.shown && r.cards === 4 && r.jets === 2, `the screen: ${JSON.stringify(r)}`);
    await shot("canyon-menu");
    await page.evaluate(() => {
      document.querySelectorAll(".cy-course-card")[1].click();
      [...document.querySelectorAll(".cy-jet")].find((b) => b.textContent.includes("F-16")).click();
    });
    await Promise.all([page.waitForURL(/canyon=slot/, { timeout: 60000 }), click("#canyon-fly")]);
    const url = page.url();
    assert(/canyon=slot/.test(url) && /jet=f16/.test(url), `the run's address: ${url}`);
    menuOk = true;
  });

  await browserCheck("the run's page: the canyon's dimension, the jet picked at the mouth, nothing of the player's worlds touched", async () => {
    if (!menuOk) await page.goto(`${base}?canyon=slot&jet=f16`, { waitUntil: "load", timeout: 60000 });
    await page.waitForFunction(() => !!window.__ufo && window.__ufo.graphicsReady && window.__ufo.canyon, null, { timeout: 120000 });
    await v((g) => g.setGraphics?.("low"));
    await play();
    const r = await v((g) => {
      const c = g.canyon;
      const j = g.vehicles.active;
      return { dim: g.dims.dim, active: c?.active, type: j?.type, jet: j?.jetType, z: j?.pos.z, creative: g.player.creative, last: localStorage.getItem("ufocombat_v1_last"), state: c?.state, rings: c?.info().rings };
    });
    assert(r.dim === "canyon" && r.active && r.type === "jet" && r.jet === "f16" && r.z < -100 && r.creative, `the run: ${JSON.stringify(r)}`);
    assert(r.last && JSON.parse(r.last).seed === 4242, `the last world untouched: ${r.last}`);
    const playerSave = await v(() => Object.keys(localStorage).filter((k) => k.includes("1515002")));
    assert(playerSave.length === 0, `saved something for the course: ${playerSave}`);
  });

  await browserCheck("the countdown, then flying; the corridor streams in ahead", async () => {
    const r = await until((g) => (g.canyon.state === "flying" ? g.canyon.info() : null), 120000);
    assert(r, `never flying: ${await v((g) => g.canyon.state)}`);
    await frames(20);
    const s = await v((g) => {
      const j = g.vehicles.active;
      return { z: j.pos.z, speed: j.vel.length(), chunks: g.world.chunks.size, fog: g.THREE ? null : null };
    });
    assert(s.speed > 40, `flying: ${JSON.stringify(s)}`);
    await shot("canyon-start");
  });

  await browserCheck("rings: the start gate starts the clock, a ring flown through counts, one flown past costs 5 s", async () => {
    const put = `(g, a) => { const c = g.canyon; const j = g.vehicles.active; const r = c.checks[a.i]; const s = Math.sin(r.yaw), co = Math.cos(r.yaw); j.pos.set(r.x - s * 30, r.y + (a.off ? r.r + 2.5 : 0), r.z - co * 30); j.q.setFromAxisAngle(new g.THREE.Vector3(0, 1, 0), Math.PI - r.yaw); j.vel.set(s * 120, 0, co * 120); j.aimQ.copy(j.q); c._lastPos.copy(j.pos); return true; }`;
    const putAt = (i, off) => page.evaluate(([src, a]) => new Function("return " + src)()(window.__ufo, a), [put, { i, off }]);
    // The start gate.
    await putAt(0, 0);
    let r = await step(15);
    assert(r.clock !== null && r.clock > 0 && r.nextCheck === 1, `the start gate: ${JSON.stringify(r)}`);
    await putAt(1, 0);
    r = await step(15);
    assert(r.passed === 1 && r.nextCheck === 2 && r.missed === 0, `ring 1 through the middle: ${JSON.stringify(r)}`);
    await putAt(2, 1);
    r = await step(15);
    assert(r.missed === 1 && r.penalty === 5 && r.nextCheck === 3, `ring 2 flown past: ${JSON.stringify(r)}`);
    await shot("canyon-ring");
  });

  await browserCheck("a wall hit ends the run: the crash, the results; R flies again from the mouth", async () => {
    await v((g) => g.canyon.state !== "flying" && g.canyon.restart());
    await until((g) => g.canyon.state === "flying", 60000);
    const r0 = await v((g) => {
      const c = g.canyon;
      const j = g.vehicles.active;
      const row = c.course.row(Math.floor(j.pos.z));
      // (straight at the right wall, at half height)
      const y = Math.round((row.floor + row.rim) / 2);
      j.pos.set(row.R[y] - 12, y, row.z);
      j.q.setFromAxisAngle(new g.THREE.Vector3(0, 1, 0), -Math.PI / 2);
      j.vel.set(150, 0, 0);
      j.aimQ.copy(j.q);
      c._lastPos.copy(j.pos);
      return true;
    });
    let r = await step(20);
    assert(r.state === "crashed", `crashed: ${JSON.stringify(r)}`);
    r = await step(90);
    assert(r.results, `the results: ${JSON.stringify(r)}`);
    const title = await v(() => document.querySelector("#canyon-results h2")?.textContent);
    assert(/CRASH/.test(title), `the results say: ${title}`);
    await shot("canyon-crash");
    await page.keyboard.press("KeyR");
    await frames(3);
    r = await v((g) => ({ ...g.canyon.info(), z: g.vehicles.active?.pos.z, jets: g.vehicles.vehicles.filter((x) => x.type === "jet" && x.alive).length }));
    assert(!r.results && (r.state === "loading" || r.state === "countdown") && r.z < -100 && r.jets === 1, `flying again: ${JSON.stringify(r)}`);
    void r0;
  });

  await browserCheck("a finish records the best time (and its ghost), the results show it", async () => {
    await until((g) => g.canyon.state === "flying", 60000);
    const r = await v((g) => {
      const c = g.canyon;
      const j = g.vehicles.active;
      // (straight to the finish: the run's clock as if flown)
      c.clock = 61.5;
      c.passed = c.checks.length - 2;
      for (const r of c.checks) r.state = "passed";
      c.nextCheck = c.checks.length - 1;
      const f = c.checks[c.nextCheck];
      f.state = "next";
      for (let i = 0; i < 40; i++) c._sample(j);
      j.pos.set(f.x, f.y, f.z - 20);
      j.q.setFromAxisAngle(new g.THREE.Vector3(0, 1, 0), Math.PI);
      j.vel.set(0, 0, 120);
      j.aimQ.copy(j.q);
      c._lastPos.copy(j.pos);
      return f.kind;
    });
    assert(r === "finish", "the last ring is the finish");
    let info = await step(10);
    assert(info.state === "finished" && Math.abs(info.final - 61.5) < 0.6, `finished: ${JSON.stringify(info)}`);
    await until((g) => g.canyon.info().results, 10000);
    const saved = await v(() => ({ rec: JSON.parse(localStorage.getItem("ufocombat_v1_canyon") || "{}"), ghost: JSON.parse(localStorage.getItem("ufocombat_v1_canyon_ghost_slot") || "null"), title: document.querySelector("#canyon-results h2")?.textContent }));
    assert(Math.abs(saved.rec.slot?.best - info.final) < 0.01 && saved.rec.slot.splits.length > 0, `the record: ${JSON.stringify(saved.rec)}`);
    assert(saved.ghost && saved.ghost.data.length >= 7 * 40, "the ghost saved");
    assert(/RECORD/.test(saved.title), `the results: ${saved.title}`);
    await shot("canyon-results");
  });

  await browserCheck("The Gauntlet: AA guns on the rim fire at the jet; a blast destroys one", async () => {
    await page.goto(`${base}?canyon=gauntlet&jet=f22`, { waitUntil: "load", timeout: 60000 });
    await page.waitForFunction(() => !!window.__ufo && window.__ufo.graphicsReady && window.__ufo.canyon, null, { timeout: 120000 });
    await play();
    await until((g) => g.canyon.state === "flying", 120000);
    const r = await v((g) => {
      const c = g.canyon;
      const j = g.vehicles.active;
      const t = c.turrets[0];
      // (the jet down in the canyon below the gun, flying along it)
      const row = c.course.row(t.z - 120);
      j.pos.set(row.xc, row.rim - 30, t.z - 120);
      j.q.setFromAxisAngle(new g.THREE.Vector3(0, 1, 0), Math.PI);
      j.vel.set(0, 0, 60);
      j.aimQ.copy(j.q);
      c._lastPos.copy(j.pos);
      t.cool = 0;
      t.losT = 0;
      return { n: c.turrets.length, bolts: g.lasers.bolts?.length ?? null };
    });
    assert(r.n > 10, `${r.n} AA guns`);
    let fired = false;
    for (let i = 0; i < 12 && !fired; i++) {
      await step(5);
      fired = await v((g) => (g.lasers.bolts || g.lasers.list || []).some((b) => b.owner === "ufo" && b.alive !== false));
      if (!fired) fired = await v((g) => g.canyon.turrets[0].burst < 4 && g.canyon.turrets[0].cool > 1);
    }
    assert(fired, "the gun never fired");
    const k = await v((g) => {
      const t = g.canyon.turrets[0];
      g.effects.explode(t.pos.clone().add(new g.THREE.Vector3(2, 0, 0)), { radius: 4, source: "missile" });
      return { alive: t.alive, left: g.canyon.info().turretsAlive };
    });
    assert(!k.alive, `the blast left it standing: ${JSON.stringify(k)}`);
  });

  if (args.fly) {
    await browserCheck("an autopilot flies the Grand Canyon to the finish (the streaming keeps up)", async () => {
      await page.goto(`${base}?canyon=grand&jet=f22`, { waitUntil: "load", timeout: 60000 });
      await page.waitForFunction(() => !!window.__ufo && window.__ufo.graphicsReady && window.__ufo.canyon, null, { timeout: 120000 });
      await play();
      assert(await until((g) => g.canyon.state === "flying", 400000), "never flying");
      const r = await page.evaluate(async () => {
        const g = window.__ufo;
        const c = g.canyon;
        const T = g.THREE;
        const t0 = performance.now();
        let unloaded = 0;
        let frames = 0;
        while (c.state === "flying" && performance.now() - t0 < 600000) {
          const j = g.vehicles.active;
          if (!j) break;
          const r = c.checks[c.nextCheck];
          // aim: a point ~2 s ahead along the canyon's middle, at the next ring's height, then the ring itself
          const sp = Math.max(60, j.vel.length());
          const lead = Math.min(r.z - j.pos.z, sp * 0.8);
          const near = r.z - j.pos.z < sp * 0.9;
          const az = near ? r.z : j.pos.z + lead;
          const row = c.course.row(Math.floor(az));
          const ty = near ? r.y : Math.min(Math.min(row.rim, row.ceil) - 18, Math.max(row.floor + 16, r.y));
          const want = new T.Vector3((near ? r.x : row.xc) - j.pos.x, ty - j.pos.y, az - j.pos.z).normalize();
          j.aimQ.setFromUnitVectors(new T.Vector3(0, 0, -1), want);
          j.throttle = 0.55;
          if (!g.world.getChunk(Math.floor(j.pos.x / 16), Math.floor((j.pos.z + 120) / 16))?.meshed) unloaded++;
          frames++;
          await new Promise((res) => requestAnimationFrame(res));
        }
        return { ...c.info(), unloaded, frames, z: g.vehicles.active?.pos.z ?? c.crashAt?.pos.z, secs: (performance.now() - t0) / 1000 };
      });
      console.log(`        ${JSON.stringify({ why: r.crashWhy, seen: r.crashSeen, waits: r.stats.waits, state: r.state, final: r.final, passed: r.passed, missed: r.missed, z: Math.round(r.z), unloaded: r.unloaded, frames: r.frames, secs: Math.round(r.secs) })}`);
      assert(r.state === "finished" || r.state === "crashed", `the flight ended: ${r.state}`);
      assert(r.state === "finished" || r.crashSeen, "it crashed into rock that wasn't drawn yet");
    });
  }

  await browserCheck("Main menu from the run: the plain menu (no canyon in the address)", async () => {
    await page.evaluate(() => document.exitPointerLock?.());
    await frames(5);
    await Promise.all([page.waitForURL((u) => !/canyon=/.test(String(u)), { timeout: 60000 }), click("#main-menu-btn")]);
    await page.waitForFunction(() => !!window.__ufo && window.__ufo.graphicsReady, null, { timeout: 120000 });
    const r = await v((g) => ({ dim: g.dims.dim, canyon: !!g.canyon, menu: !document.getElementById("start-menu").classList.contains("hidden") }));
    assert(r.dim === "overworld" && !r.canyon && r.menu, `back at the menu: ${JSON.stringify(r)}`);
  });

  await browser.close();
  server.close();
}

// ---------- Summary ----------
const failed = results.filter(([, ok]) => !ok);
console.log(`\n${results.length - failed.length} passed, ${failed.length} failed.`);
process.exit(failed.length ? 1 : 0);
