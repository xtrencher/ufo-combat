// Round 17 track D tests: missions and ground.
// - Missions start by themselves again (js/mission-board.js tickAuto,
//   js/mission-catalog.js AUTO_ORDER): in Node, the order (every board
//   mission, each after what opens it), the flow (the first one after a
//   short break, the next after a win, a failed one retried, moved on from
//   after MAX_TRIES failures and coming back later, abandon, pause and
//   resume), the save (and a Round 16 save) and the online state; in the
//   browser (a Missions world, the board as a player gets it), the
//   director starting them, chaining them after a win (with its reward)
//   and retrying a failed one, the tracker saying what comes next.
// - No parked plane on a runway (js/airports.js): every airport and city
//   of several seeds, set out on flat ground (the stands' rules and the
//   layout's), each aircraft's footprint clear of the runway and of the
//   others; an airport of the page's world with its real blocks; a fighter
//   taxis from the apron onto the runway and takes off, and so does the
//   big jet from its stand beside the runway; the call-in still waits on
//   the runway.
// - Ground vehicles never stuck (js/vehicle-tank.js): an obstacle course
//   (steps of one to three blocks, a gentle and a steep slope, a tree, a
//   fence, slabs, flowers, a hull boxed in, a hull with a block put into
//   it), and the real terrain of hills, mountains, forests, villages and
//   beaches, driven like a player would: never wedged, always on the move.
//
//   node r17-ground-tests.mjs [--only=substring] [--node]
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
  const only = args.only ? String(args.only).toLowerCase() : "";
  if (only && !name.startsWith("boot") && !name.toLowerCase().includes(only)) return;
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

// ---------- Node: the automatic flow ----------

const C = await imp("js/mission-catalog.js");
const B = await imp("js/mission-board.js");
const P = await imp("js/progression.js");
const { MissionBoard, AUTO_BREAK, MAX_TRIES } = B;
const blankStats = () => Object.fromEntries(P.MISSIONS.flatMap((m) => m.objectives.map((o) => [o.stat, 0])));
// Every objective of the running mission met.
const winIt = (b, st) => {
  for (const o of b.mission.objectives) st[o.stat] = (st[o.stat] || 0) + b.goalFor(o) + 50;
  return b.update(st);
};
// The break counted down in half seconds until something starts (or n steps).
const tick = (b, st, n = 200) => {
  for (let i = 0; i < n && !b.mission; i++) b.tickAuto(0.5, st);
  return b.mission?.id || null;
};

await check("the order: every board mission once, each one after what opens it, the finale last", async () => {
  const ids = C.BOARD.map((e) => e.id);
  assert(C.AUTO_ORDER.length === ids.length && new Set(C.AUTO_ORDER).size === ids.length, "every mission once");
  assert(ids.every((id) => C.AUTO_ORDER.includes(id)), "none left out");
  const won = new Set();
  for (const id of C.AUTO_ORDER) {
    const why = C.lockReason(C.BOARD_BY_ID.get(id), won);
    assert(!why, `${id} comes before what opens it: ${why}`);
    won.add(id);
  }
  assert(C.AUTO_ORDER[C.AUTO_ORDER.length - 1] === "armada" && C.AUTO_ORDER[0] === "skeleton", "first and last");
  // Recruit before Veteran before Elite.
  const tiers = C.AUTO_ORDER.map((id) => C.BOARD_BY_ID.get(id).tier);
  assert(tiers.every((t, i) => !i || t >= tiers[i - 1]), `tiers in order: ${tiers.join("")}`);
});

await check("the flow: the first mission by itself, the next after a win (a break between), chained through the whole board", async () => {
  const b = new MissionBoard();
  const st = blankStats();
  b.load(null, st);
  assert(b.auto && !b.mission, "on, nothing running");
  b.tickAuto(0.5, st);
  assert(b.next?.id === "skeleton" && Math.abs(b.next.left - (AUTO_BREAK.first - 0.5)) < 1e-6, `queued: ${JSON.stringify(b.next)}`);
  assert(tick(b, st) === "skeleton", "the first one started by itself");
  let rewards = 0;
  b.onComplete = () => rewards++;
  winIt(b, st);
  assert(!b.mission && b.result.ok && b.next?.id === "supply" && b.next.left === AUTO_BREAK.win && !b.next.retry, `after the win: ${JSON.stringify(b.next)}`);
  // Half the break: nothing yet.
  for (let i = 0; i < AUTO_BREAK.win; i++) b.tickAuto(0.5, st);
  assert(!b.mission, "a break between missions");
  assert(tick(b, st) === "supply", "the next one");
  // The rest of the board, one after another.
  const seen = ["skeleton", "supply"];
  winIt(b, st);
  for (let i = 0; i < 60 && tick(b, st); i++) {
    seen.push(b.mission.id);
    winIt(b, st);
  }
  assert(seen.join() === C.AUTO_ORDER.join(), `the order played: ${seen.join()}`);
  assert(rewards === C.AUTO_ORDER.length, `a reward each: ${rewards}`);
  assert(!b.next && b.allDone && !tick(b, st), "every mission won: nothing more comes");
});

await check("failing: retried by itself after a pause; after three failures in a row the next one comes, the failed one comes back later; abandon; pause and resume", async () => {
  const b = new MissionBoard();
  const st = blankStats();
  b.load(null, st);
  tick(b, st);
  winIt(b, st); // skeleton
  tick(b, st); // supply
  let fails = 0;
  b.onFail = () => fails++;
  b.fail("Test failure.");
  assert(b.next?.id === "supply" && b.next.retry && b.next.left === AUTO_BREAK.fail && b.next.tries === 1, `a retry queued: ${JSON.stringify(b.next)}`);
  assert(/Trying again in 12 s \(try 2 of 3\)/.test(b.failNote()), b.failNote());
  const run = b.runId;
  assert(tick(b, st) === "supply" && b.runId === run + 1 && b.mission.retry === 1, "retried (a fresh set-up)");
  b.fail("Again.");
  assert(tick(b, st) === "supply" && b.mission.retry === 2, "the third try");
  b.fail("And again.");
  assert(fails === 3, "three failures");
  assert(b.next?.id === "landing" && !b.next.retry && b.skipped.has("supply"), `moved on: ${JSON.stringify(b.next)}`);
  assert(/Moving on: UFO landing|Moving on/.test(b.failNote()), b.failNote());
  assert(tick(b, st) === "landing", "the next one started");
  winIt(b, st);
  // first_contact and scout_hunter need the pistol (supply): locked, so the tank battle comes.
  assert(b.next?.id === "tank_battle", `skips the locked ones: ${JSON.stringify(b.next)}`);
  tick(b, st);
  b.abandon();
  assert(b.skipped.has("tank_battle") && b.next?.id === "touchdown", `abandoned: put aside, the next one: ${JSON.stringify(b.next)}`);
  // Pause and resume.
  b.setAuto(false);
  assert(!b.next && !tick(b, st, 100), "paused: nothing starts");
  assert(/paused/.test(b.failNote()), "the note says so");
  b.setAuto(true);
  assert(b.next?.id === "touchdown" && tick(b, st) === "touchdown", "resumed");
  // A board pick skips ahead (what was coming waits).
  winIt(b, st);
  assert(b.next && b.begin("evac", st) === null && b.mission.id === "evac" && !b.next, "the board starts one out of turn");
  winIt(b, st);
  // Everything else won: the ones put aside come back.
  for (let i = 0; i < 60 && tick(b, st); i++) winIt(b, st);
  assert(b.won.has("supply") && b.won.has("tank_battle") && b.allDone, `the put-aside ones came back: ${[...b.skipped]}`);
});

await check("the save keeps the flow (paused, put aside, a failed one to retry); a Round 16 save flows on; online the guests see what comes next", async () => {
  const st = blankStats();
  const b = new MissionBoard();
  b.load(null, st);
  tick(b, st);
  winIt(b, st);
  tick(b, st); // supply
  b.fail("x");
  const s1 = JSON.parse(JSON.stringify(b.serialize()));
  assert(s1.v === 8 && Array.isArray(s1.streak) && s1.streak[0] === "supply" && s1.streak[1] === 1, JSON.stringify(s1));
  const c = new MissionBoard();
  c.load(s1, st);
  c.tickAuto(0.5, st);
  assert(c.next?.id === "supply" && c.next.retry, `reloaded: the failed one comes again: ${JSON.stringify(c.next)}`);
  b.setAuto(false);
  b.skipped.add("landing");
  const s2 = JSON.parse(JSON.stringify(b.serialize()));
  const d = new MissionBoard();
  d.load(s2, st);
  assert(d.auto === false && d.skipped.has("landing") && !tick(d, st, 50), `paused kept: ${JSON.stringify(s2)}`);
  // A Round 16 save: wins, no flow fields: on, the next not won.
  const e = new MissionBoard();
  e.load({ v: 8, board: true, won: { skeleton: 1, supply: 2, tank_battle: 1 }, fails: 1 }, st);
  assert(e.auto && tick(e, st) === "landing", `a Round 16 save: ${e.mission?.id}`);
  // Online: the host's next mission and the flow go to the guests.
  const h = new MissionBoard();
  h.load(null, st);
  h.tickAuto(0.5, st);
  const ns = JSON.parse(JSON.stringify(h.netState()));
  assert(Array.isArray(ns.n) && ns.n[0] === "skeleton" && ns.au === 1, JSON.stringify(ns));
  const g = new MissionBoard();
  g.mirror = true;
  g.load(null, st);
  g.applyNet(ns);
  assert(g.next?.id === "skeleton" && g.next.left > 0 && !tick(g, st, 50), "the guest shows it, never starts one itself");
  let asked = null;
  g.onRequest = (k, id) => (asked = [k, id]);
  g.setAuto(false);
  assert(asked?.[0] === "auto" && asked[1] === "off" && g.auto, "a guest's pause goes to the host");
  // An older host (no flow fields): nothing shown coming.
  g.applyNet({ a: null, r: null, w: "" });
  assert(!g.next, "an older host");
});

if (!args.node) await browserChecks();

async function browserChecks() {
  const { chromium } = await import("playwright-core");
  const PORT = 9750 + Math.floor(Math.random() * 40);
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
  const v = (fn, arg) => page.evaluate(([src, a]) => new Function("g", "arg", `return (${src})(g, arg);`)(window.__ufo, a), [fn.toString(), arg]);
  async function until(fn, timeout = 30000, arg) {
    const t0 = Date.now();
    while (Date.now() - t0 < timeout) {
      const r = await v(fn, arg).catch(() => null);
      if (r) return r;
      await new Promise((res) => setTimeout(res, 150));
    }
    return null;
  }
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

  await browserCheck("boot: a Missions world on the board, the automatic flow on", async () => {
    await page.goto(`http://127.0.0.1:${PORT}/index.html?seed=1717&type=missions&graphics=low&board=1`, { waitUntil: "load", timeout: 60000 });
    await page.waitForFunction(() => !!window.__ufo && window.__ufo.graphicsReady, null, { timeout: 120000 });
    await play();
    const r = await v((g) => ({ board: g.progress.board, auto: g.progress.auto, enabled: g.missions.enabled }));
    assert(r.board && r.auto && r.enabled, JSON.stringify(r));
  });

  // (--probe=file.mjs: a scratch scenario run against the booted page, for debugging.)
  if (args.probe) {
    const mod = await import(pathToFileURL(path.resolve(String(args.probe))).href);
    await mod.default({ page, v, frames, until });
    await browser.close();
    server.close();
    return;
  }

  // ---------- Missions ----------

  // The tracker's lines (js/mission-ui.js), as text.
  const TRACK = async (g) => {
    const { trackerHtml } = await import("./js/mission-ui.js");
    const el = document.createElement("div");
    el.innerHTML = trackerHtml({ board: g.progress, stats: g.stats.world, target: g.missions.target, pos: g.player.position, note: "" });
    return el.textContent;
  };
  // The director for a while (its checks every half second), until a mission runs (or n steps).
  const RUN = async (g, n) => {
    const D = g.missions;
    for (let i = 0; i < n; i++) {
      D.checkT = 0;
      D.update(0.5);
      if (g.progress.mission) break;
    }
    return g.progress.mission?.id || null;
  };

  await browserCheck("missions: the first one starts by itself; a win chains the next (its reward, a break, the tracker counting down); a failure is retried by itself, three move on", async () => {
    // (The game's own loop: the director queues the first mission once playing.)
    const first = await until((g) => g.progress.next?.id || g.progress.mission?.id, 30000);
    assert(first === "skeleton", `the first mission: ${first}`);
    const t0 = await v(async (g, TRACK) => {
      g.player.damage = () => false;
      return g.progress.mission ? "started" : await new Function("g", `return (${TRACK})(g)`)(g);
    }, TRACK.toString());
    assert(t0 === "started" || (/NEXT MISSION/.test(t0) && /The archer: starts in 0:0\d/.test(t0)), `the tracker before it: ${t0}`);
    // (The rest of the break skipped: a software-rendered page plays slowly. The game's own loop starts it.)
    await v((g) => (g.progress.next && (g.progress.next.left = Math.min(g.progress.next.left, 0.3)), true));
    const started = await until((g) => g.progress.mission?.id, 30000);
    assert(started === "skeleton", `started by itself: ${started}`);
    const r = await v(async (g, src) => {
      const TRACK = new Function("g", `return (${src.track})(g)`);
      const RUN = new Function("g", "n", `return (${src.run})(g, n)`);
      const P = g.progress;
      const apples = () => g.inventory.slots.reduce((n, s) => n + (s && s.id === 262 ? s.count : 0), 0);
      const a0 = apples();
      // Win it.
      for (const o of P.mission.objectives) g.stats.add(o.stat, P.goalFor(o) + 2);
      P.update(g.stats.world);
      const afterWin = { result: P.result, next: P.next && { ...P.next }, apples: apples() - a0, track: await TRACK(g) };
      // The break: the director starts the next one by itself.
      const next = await RUN(g, 60);
      const fails = [];
      // Fail it three times: retried by itself twice, then the next one.
      for (let k = 0; k < 3; k++) {
        const run = P.runId;
        P.fail(`Test failure ${k + 1}.`);
        const q = P.next && { ...P.next };
        const tr = await TRACK(g);
        const id = await RUN(g, 60);
        fails.push({ q, tr: tr.slice(0, 160), id, retry: P.mission?.retry ?? null, fresh: P.runId === run + 1 });
      }
      const out = { afterWin, next, fails, skipped: [...P.skipped] };
      // Leave the world without a mission for the checks after this one.
      P.setAuto(false);
      P.abandon();
      RUN(g, 2);
      return out;
    }, { track: TRACK.toString(), run: RUN.toString() });
    const w = r.afterWin;
    assert(w.result?.ok && w.result.id === "skeleton" && w.apples >= 1, `won, with its reward: ${JSON.stringify(w)}`);
    assert(w.next?.id === "supply" && w.next.left === 20 && /NEXT MISSION/.test(w.track) && /0:20/.test(w.track), `the next one queued, the tracker counting down: ${JSON.stringify(w)}`);
    assert(r.next === "supply", `chained: ${r.next}`);
    const [f1, f2, f3] = r.fails;
    assert(f1.q?.id === "supply" && f1.q.retry && /TRYING AGAIN/.test(f1.tr) && f1.id === "supply" && f1.retry === 1 && f1.fresh, `the first failure: ${JSON.stringify(f1)}`);
    assert(f2.id === "supply" && f2.retry === 2, `the second: ${JSON.stringify(f2)}`);
    assert(f3.q?.id === "landing" && !f3.q.retry && f3.id === "landing" && r.skipped.includes("supply"), `the third moves on: ${JSON.stringify(f3)}`);
  });

  // ---------- Airports ----------

  // Every airport and city of a world seed (cells round the origin), set out
  // by the real AirportManager on flat stand-in ground: each aircraft's
  // footprint (local u, v) and the runway's half width.
  const PARK = async (g, a) => {
    const { TerrainGenerator } = await import("./js/terrain.js");
    const { AirportManager } = await import("./js/airports.js");
    const { SITE_CELL } = await import("./js/sites.js");
    const T = new TerrainGenerator(a.seed, g.world.terrain.options);
    const S = T.sites;
    const out = [];
    const SIZE = { b2: [48, 22], sr71: [16, 30] };
    for (let cx = -a.r; cx <= a.r; cx++) {
      for (let cz = -a.r; cz <= a.r; cz++) {
        const s = S._site(cx, cz);
        if (!s || !s.apron || out.some((o) => o.id === s.id)) continue;
        const world = { getChunk: () => ({}), getBlock: (x, y) => (y <= s.y ? 1 : 0) };
        const made = [];
        const vehicles = { vehicles: made, create: (type, d) => {
          const j = { type, jetType: d.jetType, pos: new g.THREE.Vector3(...d.pos), yaw: d.yaw, alive: true };
          made.push(j);
          return j;
        }, remove: () => {} };
        const am = new AirportManager({ sites: S, vehicles, world, player: { position: new g.THREE.Vector3(s.x, s.y, s.z) }, mobs: null });
        am.groupSize = a.group;
        const jets = [];
        am._fill(s, jets);
        const rows = jets.map((j) => {
          const [u, v] = S.toLocal(s, j.pos.x, j.pos.z);
          const [span, len] = SIZE[j.jetType] || [15, 16];
          // (Every parked aircraft faces the runway: its length across the runway's line.)
          const facing = Math.abs(Math.sin(j.yaw - Math.atan2(...S.dirV(s)))) < 1e-6;
          return { t: j.jetType, k: j.parkKey, u, v, span, len, facing };
        });
        out.push({ id: s.id, kind: s.kind, size: s.size, rw: s.rw, half: s.half, apron: s.apron, jets: rows });
      }
    }
    return out;
  };

  await browserCheck("no parked plane on a runway: every airport and city of four seeds (fighters, hangars, the B-2, the SR-71), clear of the runway and of each other", async () => {
    const all = [];
    for (const seed of [1717, 42, 8131, 20260]) {
      const list = await v((g, a) => new Function("g", "a", `return (${a.src})(g, a)`)(g, a), { seed, r: 3, group: 4, src: PARK.toString() });
      all.push(...list.map((s) => ({ ...s, seed })));
    }
    let n = 0;
    const kinds = { f22: 0, f16: 0, b2: 0, sr71: 0, standB2: 0, standSR71: 0 };
    for (const s of all) {
      for (const j of s.jets) {
        n++;
        kinds[j.t] = (kinds[j.t] || 0) + 1;
        if (j.t === "b2" && !/#b$/.test(j.k)) throw new Error("a B-2 under another key");
        // Its footprint: nose to the runway, v from v - len/2 (its nose) to v + len/2.
        const nose = j.v - j.len / 2;
        assert(j.facing, `${s.seed} ${s.id} ${j.k}: not facing the runway`);
        assert(nose > s.rw + 2, `${s.seed} ${s.id} ${j.t} ${j.k}: its nose at v ${nose.toFixed(1)}, the runway's edge at ${s.rw} (lights at ${s.rw + 2})`);
        assert(Math.abs(j.u) + j.span / 2 < s.half + 24, `${s.id} ${j.k}: off the levelled ground`);
        if (j.t === "b2" && j.v - j.len / 2 > 0 && (j.u < s.apron.u0 || j.u > s.apron.u1)) kinds.standB2++;
        if (j.t === "sr71") kinds.standSR71++;
      }
      for (let i = 0; i < s.jets.length; i++) {
        for (let k = i + 1; k < s.jets.length; k++) {
          const a = s.jets[i];
          const b = s.jets[k];
          const overlap = Math.abs(a.u - b.u) < (a.span + b.span) / 2 && Math.abs(a.v - b.v) < (a.len + b.len) / 2;
          assert(!overlap, `${s.seed} ${s.id}: ${a.k} and ${b.k} overlap`);
        }
      }
    }
    assert(all.length >= 8 && n >= 30, `sites ${all.length}, aircraft ${n}`);
    assert(kinds.b2 >= all.length - 1 && kinds.sr71 >= 1 && kinds.standSR71 === kinds.sr71, `the big ones: ${JSON.stringify(kinds)} at ${all.length} sites`);
    console.log(`        (${all.length} sites, ${n} aircraft: ${JSON.stringify(kinds)})`);
  });

  // The nearest airport of the page's world: the player at its apron, its chunks there.
  const GOTO_AIRPORT = async (g) => {
    const p = g.player;
    let s = null;
    for (const r of [1500, 3000, 6000]) if (!s) s = g.sites.nearest(p.position.x, p.position.z, r, "airport");
    if (!s) return null;
    g.player.setMode("creative");
    g.player.damage = () => false;
    const [wx, wz] = g.sites.toWorld(s, (s.apron.u0 + s.apron.u1) / 2, s.rw + 10);
    p.flying = false;
    p.velocity.set(0, 0, 0);
    p.position.set(wx, s.y + 2, wz);
    // (The whole runway and its sides: generated, no mesh needed out there.)
    const [ux, uz] = g.sites.dirU(s);
    for (let u = -s.half - 40; u <= s.half + 40; u += 16) {
      for (let vv = -s.rw - 40; vv <= s.apron.v1 + 20; vv += 16) {
        const [x, z] = g.sites.toWorld(s, u, vv);
        g.world._generate(Math.floor(x) >> 4, Math.floor(z) >> 4);
      }
    }
    g.world.prepareArea(wx, wz, 3);
    void ux;
    void uz;
    return { id: s.id, x: s.x, z: s.z, y: s.y, rw: s.rw, half: s.half };
  };

  // Taxis jet j (the player in it) forward off its spot onto the runway,
  // turns down the runway the long way, and takes off: the assist's aim is
  // the steering (the mouse), the throttle a little for the taxi, then all.
  const TAXI = async (g, a) => {
    const s = g.sites.nearest(g.player.position.x, g.player.position.z, 600, "airport");
    const j = g.vehicles.vehicles.find((x) => x.type === "jet" && x.parkKey === a.key);
    if (!j) return { error: `no jet at ${a.key}` };
    g.player.position.set(j.pos.x + 3, j.pos.y, j.pos.z);
    g.vehicles.enter(j);
    const E = new g.THREE.Euler();
    const local = () => g.sites.toLocal(s, j.pos.x, j.pos.z);
    const [uDir, vDir] = [g.sites.dirU(s), g.sites.dirV(s)];
    let phase = "taxi";
    let want = j.yaw ?? Math.atan2(-(-vDir[0]), -(-vDir[1]));
    const fwd = new g.THREE.Vector3();
    const heading = () => {
      j.forward(fwd);
      return Math.atan2(-fwd.x, -fwd.z);
    };
    want = heading();
    // (A taxiing speed held with the throttle, as a player does: blocks/s.)
    const taxi = (want) => {
      const sp = Math.hypot(j.vel.x, j.vel.z);
      return sp < want ? Math.min(0.6, 0.3 + (want - sp) * 0.05) : 0.05;
    };
    let onRunwayAt = null;
    let maxV = 0;
    let crashed = false;
    let lift = null;
    const log = [];
    const u0 = local()[0];
    const dirU = Math.abs(u0 + 1) < s.half ? (u0 > 0 ? -1 : 1) : 1; // (the long way down the runway)
    const runwayYaw = Math.atan2(-uDir[0] * dirU, -uDir[1] * dirU);
    for (let i = 0; i < 30 * 70 && !lift; i++) {
      const [u, vv] = local();
      if (phase === "taxi") {
        j.throttle = taxi(7);
        if (vv < 21) { // (the turn begins on the taxiway: its radius of about 20 ends near the centre line)
          phase = "turn";
          onRunwayAt = [Math.round(u), Math.round(vv)];
        }
      } else if (phase === "turn") {
        j.throttle = taxi(6);
        want = runwayYaw;
        const d = Math.atan2(Math.sin(want - heading()), Math.cos(want - heading()));
        if (Math.abs(d) < 0.06) phase = "roll";
      } else {
        // (Back to the centre line as it rolls.)
        { const dx = uDir[0] * dirU - vDir[0] * Math.max(-0.25, Math.min(0.25, vv * 0.04)); const dz = uDir[1] * dirU - vDir[1] * Math.max(-0.25, Math.min(0.25, vv * 0.04)); want = Math.atan2(-dx, -dz); }
        j.throttle = 1;
        g.player.keys.add("ShiftLeft");
        if (!j.onGround && j.pos.y > s.y + 8) lift = { u: Math.round(u), roll: Math.round(Math.abs(u - (onRunwayAt?.[0] ?? u))) };
      }
      j.aimQ.setFromEuler(E.set(phase === "roll" ? 0.12 : 0, want, 0, "YXZ"));
      g.vehicles.update(1 / 30);
      if (!j.alive) {
        crashed = j.crashWhy || "destroyed";
        break;
      }
      if (phase === "roll") maxV = Math.max(maxV, Math.abs(vv)); // (the takeoff roll on the runway)
      if (i % 30 === 0) log.push(`${phase}:${Math.round(u)},${Math.round(vv)}`);
    }
    g.player.keys.delete("ShiftLeft");
    const out = { key: a.key, type: j.jetType, onRunwayAt, lift, crashed, maxV: Math.round(maxV), rw: s.rw, log: log.slice(-6).join(" ") };
    if (g.vehicles.active) g.vehicles.exit({ force: true });
    g.vehicles.remove(j);
    return out;
  };

  await browserCheck("an airport with its real blocks: no parked plane on the runway; a fighter taxis from the apron and takes off, and so does the big jet from its stand; the call-in still waits on the runway", async () => {
    const site = await v((g, src) => new Function("g", `return (${src})(g)`)(g), GOTO_AIRPORT.toString());
    assert(site, "no airport near");
    await frames(3);
    const r = await v((g) => {
      const s = g.sites.nearest(g.player.position.x, g.player.position.z, 600, "airport");
      for (let i = 0; i < 4; i++) {
        g.airports.timer = 0;
        g.airports.update(0.1);
      }
      const jets = g.vehicles.vehicles.filter((x) => x.type === "jet" && x.parkedAt === s.id);
      return {
        jets: jets.map((j) => {
          const [u, vv] = g.sites.toLocal(s, j.pos.x, j.pos.z);
          return { k: j.parkKey, t: j.jetType, u: Math.round(u), v: Math.round(vv), y: j.pos.y };
        }),
        rw: s.rw,
        y: s.y,
      };
    });
    assert(r.jets.length >= 2, `parked: ${JSON.stringify(r)}`);
    const LEN = { b2: 22, sr71: 30 };
    for (const j of r.jets) assert(j.v - (LEN[j.t] || 16) / 2 > r.rw + 2, `on the runway: ${JSON.stringify(j)} (runway half width ${r.rw})`);
    // A fighter from the row (not a hangar: the hangars' way out is the same taxiway).
    const fighter = r.jets.find((j) => (j.t === "f16" || j.t === "f22") && /#\d+$/.test(j.k)) || r.jets.find((j) => j.t === "f16" || j.t === "f22");
    const t1 = await v((g, a) => new Function("g", "a", `return (${a.src})(g, a)`)(g, a), { key: fighter.k, src: TAXI.toString() });
    assert(!t1.crashed && t1.onRunwayAt && t1.lift && t1.maxV <= t1.rw, `the fighter: ${JSON.stringify(t1)}`);
    // The big one: its stand (or, at an airport without one, an SR-71 put on the stand it would have).
    let big = r.jets.find((j) => j.t === "sr71") || r.jets.find((j) => j.t === "b2" && Math.abs(j.v) > 0);
    if (!r.jets.some((j) => j.t === "sr71")) {
      const made = await v((g) => {
        const s = g.sites.nearest(g.player.position.x, g.player.position.z, 600, "airport");
        const jets = g.airports.parked.get(s.id) || [];
        const spot = g.airports._sr71Spot(s, jets);
        if (!spot) return null;
        const j = g.vehicles.create("jet", { jetType: "sr71", pos: [spot.x, spot.y + 2, spot.z], yaw: spot.yaw });
        j.pos.y = spot.y + j.gearH;
        j.parkKey = "test#s";
        return { k: "test#s", t: "sr71" };
      });
      if (made) big = made;
    }
    if (big) {
      const t2 = await v((g, a) => new Function("g", "a", `return (${a.src})(g, a)`)(g, a), { key: big.k, src: TAXI.toString() });
      assert(!t2.crashed && t2.onRunwayAt && t2.lift, `the ${big.t}: ${JSON.stringify(t2)}`);
    }
    // The call-in: a jet waiting at the runway's end, as before.
    const c = await v((g) => {
      const s = g.sites.nearest(g.player.position.x, g.player.position.z, 600, "airport");
      g.player.setMode("survival");
      g.callJet(true);
      const jet = g.vehicles.vehicles.find((x) => x.isPlayerJet);
      const [u, vv] = jet ? g.sites.toLocal(s, jet.pos.x, jet.pos.z) : [0, 99];
      g.player.setMode("creative");
      if (jet) g.vehicles.remove(jet);
      return { u: Math.round(u), v: Math.round(vv), half: s.half };
    });
    assert(Math.abs(c.v) < 3 && Math.abs(c.u) < c.half, `the call-in on the runway (its end, or as far toward it as the ground is loaded): ${JSON.stringify(c)}`);
  });

  // ---------- Ground vehicles ----------

  // A flat stone field at y 70 round the player (x0 - 60 .. x0 + 60, z0 - 120
  // .. z0 + 20), loaded; no ground vehicles; the player in Creative.
  const FIELD = `async (g) => {
    const p = g.player;
    if (g.vehicles.active) g.vehicles.exit({ force: true });
    const x0 = Math.floor(p.position.x), z0 = Math.floor(p.position.z);
    for (let cx = (x0 - 80) >> 4; cx <= (x0 + 80) >> 4; cx++) for (let cz = (z0 - 140) >> 4; cz <= (z0 + 40) >> 4; cz++) g.world._generate(cx, cz);
    const y = 70;
    const list = [];
    for (let x = x0 - 60; x <= x0 + 60; x++) for (let z = z0 - 120; z <= z0 + 20; z++) for (let k = -4; k < 24; k++) list.push(x, y + k, z, k < 0 ? 1 : 0);
    g.world.setBlocks(list);
    g.player.setMode("creative");
    g.player.damage = () => false;
    for (const v of [...g.vehicles.vehicles]) if (v.isGround || v.type === "heli" || v.type === "jet") g.vehicles.remove(v);
    p.flying = true;
    p.position.set(x0 + 0.5, y + 30, z0 + 0.5);
    return { x0, y, z0 };
  }`;
  const field = () => page.evaluate((src) => new Function("g", `return (${src})(g);`)(window.__ufo), FIELD);

  // Drives vehicle t for `secs` (30 steps a second) with keys held, the
  // player in it; returns where it got and how it went.
  const DRIVE = `(g, t, keys, secs, probe) => {
    g.vehicles.enter(t);
    for (const k of keys) g.player.keys.add(k);
    let top = t.pos.y, minV = Infinity, maxSpeed = 0;
    const z0 = t.pos.z;
    for (let i = 0; i < secs * 30; i++) {
      g.vehicles.update(1 / 30);
      top = Math.max(top, t.pos.y);
      maxSpeed = Math.max(maxSpeed, Math.abs(t.speed));
      if (probe) probe(t, i);
    }
    for (const k of keys) g.player.keys.delete(k);
    g.vehicles.exit({ force: true });
    return { dz: z0 - t.pos.z, top, y: t.pos.y, maxSpeed };
  }`;

  await browserCheck("the obstacle course: tanks climb one- and two-block steps (a truck one), stop at a wall and back off; a gentle slope slowly, never a steep one; a tree knocked down; fences, slabs and flowers rolled over", async () => {
    const f = await field();
    const r = await v(async (g, a) => {
      const { f, DRIVE } = a;
      const drive = new Function("g", "t", "keys", "secs", "probe", `return (${DRIVE})(g, t, keys, secs, probe)`);
      const { summonTank } = await import("./js/vehicle-tank.js");
      const { BLOCK } = await import("./js/blocks.js");
      const ids = await import("./js/content/ids.js");
      const out = {};
      const lane = (dx) => f.x0 + dx;
      const put = (l) => g.world.setBlocks(l);
      // Lanes (each 14 wide, along -z from z0 - 10): an obstacle 25 blocks out.
      const box = (x0, x1, z0, z1, y0, y1, id) => {
        const l = [];
        for (let x = x0; x <= x1; x++) for (let z = z0; z <= z1; z++) for (let y = y0; y <= y1; y++) l.push(x, y, z, id);
        put(l);
      };
      const zA = f.z0 - 35; // the obstacle's near face
      // 1: a one-block step (a ledge running on); 2: two blocks; 3: three (a wall).
      box(lane(-52), lane(-40), zA - 60, zA, f.y, f.y, 1);
      box(lane(-36), lane(-24), zA - 60, zA, f.y, f.y + 1, 1);
      box(lane(-20), lane(-8), zA - 60, zA, f.y, f.y + 2, 1);
      // 4: a gentle slope (one up every two along: 27 degrees), ten blocks up.
      for (let i = 0; i < 20; i++) box(lane(-4), lane(8), zA - 2 * i - 1, zA - 2 * i, f.y, f.y + i, 1);
      box(lane(-4), lane(8), zA - 80, zA - 40, f.y, f.y + 19, 1);
      // 5: a steep one (one up every block: 45 degrees).
      for (let i = 0; i < 20; i++) box(lane(12), lane(24), zA - i, zA - i, f.y, f.y + i, 1);
      // 6: a tree (a trunk of six, leaves round its top), fences, slabs, flowers.
      const LOG = BLOCK.WOOD ?? ids.OAK_LOG;
      const LEAVES = BLOCK.LEAVES;
      box(lane(34), lane(34), zA, zA, f.y, f.y + 5, LOG);
      for (let dx = -2; dx <= 2; dx++) for (let dz = -2; dz <= 2; dz++) for (let y = 4; y <= 7; y++) if (dx || dz || y > 5) put([lane(34) + dx, f.y + y, zA + dz, LEAVES]);
      const FENCE = ids.OAK_FENCE ?? ids.FENCE;
      const SLAB = ids.STONE_SLAB ?? ids.SMOOTH_STONE_SLAB;
      const FLOWER = BLOCK.FLOWER_RED ?? BLOCK.TALL_GRASS ?? ids.POPPY;
      box(lane(29), lane(40), zA - 15, zA - 15, f.y, f.y, FENCE);
      box(lane(29), lane(40), zA - 25, zA - 22, f.y, f.y, SLAB);
      box(lane(29), lane(40), zA - 32, zA - 30, f.y, f.y, FLOWER);
      out.blocks = { LOG, LEAVES, FENCE, SLAB, FLOWER };
      const at = (dx, kind = "mbt", yaw = 0) => {
        const t = kind === "tel" ? g.vehicles.create("tel", { pos: [lane(dx) + 0.5, f.y, f.z0 - 12], yaw }) : summonTank(g.vehicles, kind, new g.THREE.Vector3(lane(dx) + 0.5, f.y, f.z0 - 12), yaw);
        t.pos.y = f.y;
        t.settle?.(true);
        return t;
      };
      const go = (dx, kind, secs = 9) => {
        const t = at(dx, kind);
        const r = drive(g, t, ["KeyW"], secs);
        g.vehicles.remove(t);
        return r;
      };
      out.step1 = go(-46);
      out.step1tel = go(-46, "tel");
      out.step2 = go(-30);
      out.step2tiger = go(-30, "tiger", 12);
      out.step2tel = go(-30, "tel");
      {
        const t = at(-14);
        out.wall = drive(g, t, ["KeyW"], 6);
        out.wallBack = drive(g, t, ["KeyS"], 3);
        g.vehicles.remove(t);
      }
      out.flat = go(48, "mbt", 5);
      {
        const t = at(2);
        let slowest = Infinity;
        out.gentle = drive(g, t, ["KeyW"], 16, (t, i) => {
          if (t.pitch > 0.3 && i > 30) slowest = Math.min(slowest, Math.abs(t.speed));
        });
        out.gentle.uphillSpeed = slowest;
        g.vehicles.remove(t);
      }
      {
        const t = at(18);
        out.steep = drive(g, t, ["KeyW"], 10);
        out.steepBack = drive(g, t, ["KeyS"], 3);
        g.vehicles.remove(t);
      }
      out.tree = go(34, "mbt", 9);
      out.treeLeft = (() => {
        let n = 0;
        for (let y = 0; y < 6; y++) if (g.world.getBlock(lane(34), f.y + y, zA) === LOG) n++;
        return n;
      })();
      return out;
    }, { f, DRIVE });
    const s = (o) => JSON.stringify(o);
    console.log(`        (${["step1", "step1tel", "step2", "step2tiger", "step2tel", "wall", "wallBack", "flat", "gentle", "steep", "steepBack", "tree"].map((k) => `${k} ${r[k].dz.toFixed(0)} along, up ${(r[k].top - f.y).toFixed(1)}`).join("; ")}; uphill ${r.gentle.uphillSpeed.toFixed(1)} vs ${r.flat.maxSpeed.toFixed(1)})`);
    assert(r.step1.dz > 45 && r.step1.top >= f.y + 0.9, `a one-block step: ${s(r.step1)}`);
    assert(r.step1tel.dz > 40 && r.step1tel.top >= f.y + 0.9, `a truck over a one-block step: ${s(r.step1tel)}`);
    assert(r.step2.dz > 45 && r.step2.top >= f.y + 1.9, `a tank up two blocks: ${s(r.step2)}`);
    assert(r.step2tiger.dz > 40 && r.step2tiger.top >= f.y + 1.9, `the heavy tank up two blocks: ${s(r.step2tiger)}`);
    assert(r.step2tel.dz < 25 && r.step2tel.top < f.y + 0.5, `a truck stops at two blocks: ${s(r.step2tel)}`);
    assert(r.wall.dz < 22 && r.wall.top < f.y + 0.5 && r.wallBack.dz < -3, `a wall stops it, it backs off: ${s(r.wall)} ${s(r.wallBack)}`);
    assert(r.gentle.top >= f.y + 15 && r.gentle.dz > 45, `up the gentle slope: ${s(r.gentle)}`);
    assert(r.gentle.uphillSpeed < r.flat.maxSpeed * 0.8, `slower uphill: ${r.gentle.uphillSpeed.toFixed(1)} vs ${r.flat.maxSpeed.toFixed(1)} on the flat`);
    assert(r.steep.top < f.y + 8 && r.steepBack.dz < r.steep.dz - 2, `not up a 45-degree slope, backs off it: ${s(r.steep)} ${s(r.steepBack)}`);
    assert(r.tree.dz > 45 && r.treeLeft === 0, `through the tree (knocked down), the fence, the slabs and the flowers: ${s(r.tree)}, logs left ${r.treeLeft}, ${s(r.blocks)}`);
  });

  await browserCheck("never wedged: a hull boxed in by walls is nudged out; a block put into a hull lifts it; one spawned against a post drives away", async () => {
    const f = await field();
    const r = await v(async (g, a) => {
      const { f, DRIVE } = a;
      const drive = new Function("g", "t", "keys", "secs", "probe", `return (${DRIVE})(g, t, keys, secs, probe)`);
      const { summonTank } = await import("./js/vehicle-tank.js");
      const out = {};
      const box = (x0, x1, z0, z1, y0, y1, id = 1) => {
        const l = [];
        for (let x = x0; x <= x1; x++) for (let z = z0; z <= z1; z++) for (let y = y0; y <= y1; y++) l.push(x, y, z, id);
        g.world.setBlocks(l);
      };
      const at = (x, z, yaw = 0) => {
        const t = summonTank(g.vehicles, "mbt", new g.THREE.Vector3(x + 0.5, f.y, z + 0.5), yaw);
        t.pos.y = f.y;
        t.settle(true);
        return t;
      };
      // Boxed in: walls three high touching its corners all round (a pit's sides), blocks inside its outline.
      {
        const x = f.x0 - 30, z = f.z0 - 40;
        const t = at(x, z);
        const hx = Math.ceil(t.half.x * 0.8), hz = Math.ceil(t.half.z * 0.86);
        box(x - hx - 1, x + hx + 1, z - hz - 1, z - hz + 1, f.y, f.y + 3);
        box(x - hx - 1, x + hx + 1, z + hz - 1, z + hz + 1, f.y, f.y + 3);
        box(x - hx - 1, x - hx + 1, z - hz - 1, z + hz + 1, f.y, f.y + 3);
        box(x + hx - 1, x + hx + 1, z - hz - 1, z + hz + 1, f.y, f.y + 3);
        const p0 = t.pos.clone();
        out.boxed = drive(g, t, ["KeyW"], 6);
        out.boxed.moved = Math.hypot(t.pos.x - p0.x, t.pos.z - p0.z);
        out.boxed.stuck = !t._canMove(t.pos.x - Math.sin(t.yaw) * 0.4, t.pos.z - Math.cos(t.yaw) * 0.4, t.yaw, 1, 1, {}) && !t._canMove(t.pos.x + Math.sin(t.yaw) * 0.4, t.pos.z + Math.cos(t.yaw) * 0.4, t.yaw, -1, -1, {});
        g.vehicles.remove(t);
      }
      // A block put into the hull (a layer of stone under it all, as if it sank in).
      {
        const x = f.x0 + 10, z = f.z0 - 40;
        const t = at(x, z);
        box(x - 6, x + 6, z - 8, z + 8, f.y, f.y + 1);
        out.sunk = drive(g, t, ["KeyW"], 5);
        g.vehicles.remove(t);
      }
      // Spawned with a post (four high) inside its outline: it drives off it.
      {
        const x = f.x0 + 35, z = f.z0 - 40;
        box(x + 1, x + 1, z - 3, z - 3, f.y, f.y + 3);
        const t = at(x, z);
        out.post = drive(g, t, ["KeyS"], 4);
        g.vehicles.remove(t);
      }
      return out;
    }, { f, DRIVE });
    assert(r.boxed.moved > 1.5 && !r.boxed.stuck, `boxed in: nudged out: ${JSON.stringify(r.boxed)}`);
    assert(r.sunk.top >= f.y + 1.9 && Math.abs(r.sunk.dz) > 10, `a block put into it: lifted onto it and away: ${JSON.stringify(r.sunk)}`);
    assert(r.post.dz < -6, `spawned against a post: drives away from it: ${JSON.stringify(r.post)}`);
  });

  // Driven like a player: ahead toward a far point; when it makes no
  // headway for 3 s, back off 1.5 s and turn a quarter. Returns how far it
  // got from where it started and the longest time it could move nowhere.
  const ROAM = `(g, t, secs, heading) => {
    g.vehicles.enter(t);
    const K = g.player.keys;
    let mode = "go", modeT = 0, want = heading;
    let anchor = t.pos.clone(), anchorT = 0, wedgedT = 0, wedgedMax = 0, path = 0, last = t.pos.clone();
    const start = t.pos.clone();
    let far = 0, deep = 0, minY = t.pos.y, maxY = t.pos.y, diag = null, turn = 1;
    const trace = [];
    const fp = {};
    for (let i = 0; i < secs * 30; i++) {
      K.delete("KeyW"); K.delete("KeyS"); K.delete("KeyA"); K.delete("KeyD");
      if (mode === "go") {
        const d = Math.atan2(Math.sin(want - t.yaw), Math.cos(want - t.yaw));
        if (Math.abs(d) < 1) K.add("KeyW");
        if (d > 0.08) K.add("KeyA");
        else if (d < -0.08) K.add("KeyD");
      } else {
        K.add("KeyS");
        K.add(turn > 0 ? "KeyA" : "KeyD");
      }
      g.vehicles.update(1 / 30);
      path += Math.hypot(t.pos.x - last.x, t.pos.z - last.z);
      last.copy(t.pos);
      far = Math.max(far, Math.hypot(t.pos.x - start.x, t.pos.z - start.z));
      minY = Math.min(minY, t.pos.y);
      maxY = Math.max(maxY, t.pos.y);
      if (t.inWater && t.depth > 1) deep++;
      anchorT += 1 / 30;
      if (mode === "back") {
        modeT -= 1 / 30;
        if (modeT <= 0) { mode = "go"; want += turn * Math.PI / 2; anchor.copy(t.pos); anchorT = 0; }
      } else if (anchorT > 3) {
        if (t.pos.distanceTo(anchor) < 3) { mode = "back"; modeT = 1.5; turn = Math.random() < 0.5 ? 1 : -1; }
        anchor.copy(t.pos);
        anchorT = 0;
      }
      // Wedged: it can't go forward, back, nor turn.
      if (i % 6 === 0) {
        const f = t.forward(new g.THREE.Vector3());
        const cans = [[0.4, 0, 1], [-0.4, 0, -1], [0, 0.15, 0], [0, -0.15, 0]].map(([d, dy, dir]) => t._canMove(t.pos.x + f.x * d, t.pos.z + f.z * d, t.yaw + dy, dir, dir || 1, fp));
        const can = cans.some(Boolean);
        if (i % 60 === 0) trace.push(mode + "@" + [t.pos.x, t.pos.y, t.pos.z].map(Math.round).join(",") + " y" + t.yaw.toFixed(1) + " p" + t.pitch.toFixed(2) + " v" + t.speed.toFixed(1) + " " + cans.map((c) => (c ? 1 : 0)).join(""));
        wedgedT = can ? 0 : wedgedT + 0.2;
        wedgedMax = Math.max(wedgedMax, wedgedT);
        // (What it was like when it first stayed wedged: for the failure's message.)
        if (wedgedT > 2 && !diag) {
          const cols = [];
          for (let dz = -6; dz <= 6; dz += 2) { const row = []; for (let dx = -6; dx <= 6; dx += 2) row.push(Math.round(t._ground(t.pos.x + dx, t.pos.z + dz, t.pos.y + 6) - t.pos.y)); cols.push(row.join(",")); }
          diag = { pos: [t.pos.x, t.pos.y, t.pos.z].map((n) => Math.round(n * 10) / 10), yaw: Math.round(t.yaw * 100) / 100, pitch: Math.round(t.pitch * 100) / 100, flooded: !!t.flooded, depth: t.depth, inWater: t.inWater, ground: cols.join(" / ") };
        }
      }
    }
    for (const k of ["KeyW", "KeyS", "KeyA", "KeyD"]) K.delete(k);
    g.vehicles.exit({ force: true });
    return { far: Math.round(far), path: Math.round(path), wedgedMax: Math.round(wedgedMax * 10) / 10, climb: Math.round(maxY - minY), wet: deep, diag, trace: trace.join(" | ") };
  }`;

  await browserCheck("real terrain: tanks and a missile truck driven over hills, mountains, forests, a village and a beach never get wedged and keep moving", async () => {
    // Places of each kind near the world's middle (the terrain's own biomes and heights).
    const spots = await v(async (g) => {
      const { BIOME } = await import("./js/biomes.js");
      const { SEA_LEVEL } = await import("./js/constants.js");
      const T = g.world.terrain;
      const found = {};
      const want = {
        forest: (b) => b === BIOME.FOREST || b === BIOME.DARK_FOREST || b === BIOME.BIRCH_FOREST || b === BIOME.TAIGA || b === BIOME.JUNGLE,
        mountain: (b) => b === BIOME.MOUNTAINS,
        beach: (b) => b === BIOME.BEACH,
      };
      for (let r = 0; r <= 2400 && !(found.forest && found.mountain && found.beach && found.hill); r += 48) {
        const n = Math.max(1, Math.round((r * 2 * Math.PI) / 64));
        for (let i = 0; i < n; i++) {
          const x = Math.round(Math.cos((i / n) * Math.PI * 2) * r);
          const z = Math.round(Math.sin((i / n) * Math.PI * 2) * r);
          const b = T.biomeAt(x, z);
          for (const [k, fn] of Object.entries(want)) if (!found[k] && fn(b) && T.heightAt(x, z) >= (k === "beach" ? SEA_LEVEL : 64)) found[k] = [x, z];
          // (A shore will do for a beach: low land with the sea beside it.)
          if (!found.beach && T.heightAt(x, z) >= SEA_LEVEL && T.heightAt(x, z) <= SEA_LEVEL + 2 && [[16, 0], [-16, 0], [0, 16], [0, -16]].some(([dx, dz]) => T.heightAt(x + dx, z + dz) < SEA_LEVEL - 2)) found.beach = [x, z];
          if (!found.hill && !want.mountain(b) && !want.beach(b)) {
            const hs = [[0, 0], [24, 0], [-24, 0], [0, 24], [0, -24]].map(([dx, dz]) => T.heightAt(x + dx, z + dz));
            if (Math.max(...hs) - Math.min(...hs) >= 10 && Math.min(...hs) > 64) found.hill = [x, z];
          }
        }
      }
      const vil = T.villages?.nearestVillage?.(0, 0, 3000);
      if (vil) found.village = [Math.round(vil.x), Math.round(vil.z)];
      return found;
    });
    const kinds = Object.keys(spots);
    assert(kinds.length >= 4, `places found: ${JSON.stringify(spots)}`);
    const out = [];
    for (const [kind, [x, z]] of Object.entries(spots)) {
      for (const [vk, heading] of [["mbt", 0], ["tiger", Math.PI * 0.75], ["tel", -Math.PI / 2]]) {
        const r = await v(async (g, a) => {
          const { summonTank } = await import("./js/vehicle-tank.js");
          const ROAM = new Function("g", "t", "secs", "heading", `return (${a.ROAM})(g, t, secs, heading)`);
          if (g.vehicles.active) g.vehicles.exit({ force: true });
          for (const v of [...g.vehicles.vehicles]) if (v.isGround) g.vehicles.remove(v);
          g.player.setMode("creative");
          g.player.damage = () => false;
          g.player.flying = true;
          for (let cx = (a.x - 96) >> 4; cx <= (a.x + 96) >> 4; cx++) for (let cz = (a.z - 96) >> 4; cz <= (a.z + 96) >> 4; cz++) g.world._generate(cx, cz);
          g.player.position.set(a.x + 0.5, g.world.heightAt(a.x, a.z) + 30, a.z + 0.5);
          // (A dry spot on the open ground near it to start from: not a roof, a tree top, a pond.)
          const { IS_WET } = await import("./js/blocks.js");
          let sx = a.x, sz = a.z;
          search: for (let r = 0; r <= 64; r += 4) {
            for (let k = 0; k < Math.max(1, r * 2); k++) {
              const x = Math.round(a.x + Math.cos((k / Math.max(1, r * 2)) * Math.PI * 2) * r);
              const z = Math.round(a.z + Math.sin((k / Math.max(1, r * 2)) * Math.PI * 2) * r);
              const y = g.vehicles.groundBelow(x + 0.5, 250, z + 0.5);
              const h = g.world.terrain.heightAt(x, z);
              if (Math.abs(y - (h + 1)) > 1.5 || IS_WET[g.world.getBlock(x, Math.floor(y), z)] || IS_WET[g.world.getBlock(x, Math.floor(y) - 1, z)]) continue;
              const near = [[5, 0], [-5, 0], [0, 5], [0, -5]].map(([dx, dz]) => g.vehicles.groundBelow(x + dx + 0.5, y + 8, z + dz + 0.5));
              if (near.some((n) => Math.abs(n - y) > 2)) continue;
              sx = x;
              sz = z;
              break search;
            }
          }
          const y = g.vehicles.groundBelow(sx + 0.5, 250, sz + 0.5);
          const t = a.vk === "tel" ? g.vehicles.create("tel", { pos: [sx + 0.5, y, sz + 0.5], yaw: a.heading }) : summonTank(g.vehicles, a.vk, new g.THREE.Vector3(sx + 0.5, y, sz + 0.5), a.heading);
          t.settle(true);
          const r = ROAM(g, t, 40, a.heading);
          g.vehicles.remove(t);
          return r;
        }, { x, z, vk, heading, ROAM });
        out.push({ kind, vk, ...r });
      }
    }
    console.log(`        ${out.map((o) => `${o.kind}/${o.vk}: ${o.far} far, ${o.path} driven, climbed ${o.climb}, wedged ${o.wedgedMax}s`).join("; ")}`);
    const bad = [];
    for (const o of out) {
      if (o.wedgedMax > 2.6) bad.push(`${o.kind} ${o.vk}: wedged for ${o.wedgedMax} s (${JSON.stringify(o)})`);
      if (o.path < (o.vk === "tel" ? 30 : 50)) bad.push(`${o.kind} ${o.vk}: hardly moved (${JSON.stringify(o)})`);
    }
    assert(!bad.length, bad.join(" | "));
  });

  await browser.close();
  server.close();
}

// ---------- Summary ----------
const failed = results.filter(([, ok]) => !ok);
console.log(`\n${results.length - failed.length} passed, ${failed.length} failed.`);
process.exit(failed.length ? 1 : 0);
