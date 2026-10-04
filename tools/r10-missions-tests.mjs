// Round 10 mission tests: boots the real game in headless Chromium (software
// WebGL, Low preset) and checks the random campaign and the smooth dusk:
// automation plays the classic chain, a drawn run plays by its places
// (tracker, the classified mission list, unlocks by mission id), the long
// night's clock eases to dusk (no jump) and a lost night eases on to the next
// dusk, and a guest mirrors the host's run (its rewards, the victory screen,
// the host's dusk on its own sky), modelled at the unit level on one page;
// and the new missions (missions-b): Don't look up (the hunters, the clock
// set back), Crash site (the crash, holding it, the loot), Run for cover,
// Sabotage and Rescue (each set up and counted).
// (The run's rules for 200 seeds: unit-tests.mjs.)
//
//   node r10-missions-tests.mjs [--only=substring[|substring...]] [--seed=42]
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
const PORT = 9690 + Math.floor(Math.random() * 40);
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
const until = async (fn, ms, arg) => {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    const r = await v(fn, arg);
    if (r) return r;
    await new Promise((res) => setTimeout(res, 250));
  }
  return null;
};

async function check(name, fn) {
  if (args.only && !String(args.only).toLowerCase().split("|").some((o) => name.toLowerCase().includes(o))) return;
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
await page.goto(`http://localhost:${PORT}/index.html?seed=${SEED}`, { waitUntil: "load", timeout: 60000 });
await page.waitForFunction(() => !!window.__ufo, null, { timeout: 60000 });
await page.evaluate(() => window.__ufo.setGraphics("low"));
await page.waitForFunction(() => window.__ufo.graphicsReady, null, { timeout: 120000 });

async function play() {
  const t0 = Date.now();
  while (Date.now() - t0 < 90000) {
    const st = await v((g) => g.gameState);
    if (st === "playing") return;
    if (st === "dead") {
      await v((g) => g.respawn());
      continue;
    }
    if (st === "start") await page.click("#play-btn", { timeout: 5000 }).catch(() => {});
    else if (await page.isVisible("#resume-btn")) await page.click("#resume-btn", { timeout: 3000 }).catch(() => {});
    else {
      await page.mouse.click(480, 270);
      await frames(5);
      if ((await v((g) => g.gameState)) === "paused" && !(await page.isVisible("#resume-btn"))) await page.evaluate(() => document.getElementById("pause-menu").classList.remove("hidden"));
    }
    await frames(3);
  }
  throw new Error(`the game didn't start playing (state ${await v((g) => g.gameState)})`);
}
await play();

// Survival with the missions on, at the spawn, a clean sky.
const survival = () =>
  v((g) => {
    g.testFlags.noMissions = false;
    if (g.player.dead) g.respawn();
    if (g.vehicles.active) g.vehicles.exit({ force: true });
    g.setMode("survival");
    g.progress.enabled = true;
    g.missions.enabled = true;
    g.player.health = 20;
    g.ufos.clear();
    g.mobs.clear();
  });

await check("a new world under automation plays the classic chain; a drawn run plays by its places: tracker, classified list, unlocks by id", async () => {
  await survival();
  const r = await v(async (g) => {
    const { CLASSIC_IDS } = await import("./js/progression.js");
    const out = { classic: g.progress.chain.join() === CLASSIC_IDS.join() };
    g.progress.newChain(9001);
    g.progress.start(g.stats.world);
    out.random = g.progress.chain.join() !== CLASSIC_IDS.join();
    out.total = g.progress.total;
    out.first = g.progress.mission?.id;
    // Unlocks by id: the jet is locked until "wings" in this run, and the text names its place.
    const jet = g.vehicles.create("jet", { pos: [g.player.position.x + 30, 200, g.player.position.z], airborne: true, speed: 100 });
    const wings = g.progress.indexOf("wings");
    g.progress.step = wings - 1;
    out.lockedText = g.vehicles.canBoard(jet);
    g.progress.step = wings;
    out.unlocked = !g.vehicles.canBoard(jet);
    out.wingsN = wings + 1;
    g.vehicles.remove(jet);
    // Random crates wait for the supply drop, wherever it is.
    g.progress.step = g.progress.indexOf("supply");
    out.cratesAtSupply = g.crates.randomAllowed();
    g.progress.step = g.progress.indexOf("supply") + 1;
    out.cratesAfter = g.crates.randomAllowed();
    // The list: done and current in full, the rest classified.
    g.progress.step = 3;
    g.progress.start(g.stats.world);
    g.screens.onOpen["missions-screen"]();
    const el = document.getElementById("missions-list");
    out.items = el.querySelectorAll(".ml-item").length;
    out.done = el.querySelectorAll(".ml-item.done").length;
    out.current = el.querySelector(".ml-item.current .ml-title")?.textContent;
    out.secret = el.querySelector(".ml-item.locked .ml-title")?.textContent;
    out.leaks = g.progress.chain.slice(4).filter((id) => el.textContent.includes(g.progress.missionAt(g.progress.indexOf(id)).title)).length;
    out.currentTitle = g.progress.mission.title;
    return out;
  });
  const j = JSON.stringify(r);
  assert(r.classic && r.random && r.total >= 26 && r.total <= 30, j);
  assert(r.lockedText && r.lockedText.includes(`mission ${r.wingsN} `) && r.unlocked, `unlocks by id: ${j}`);
  assert(!r.cratesAtSupply && r.cratesAfter, `crates after the supply drop: ${j}`);
  assert(r.items === 5 && r.done === 3 && r.current?.startsWith(r.currentTitle) && /classified/.test(r.secret || "") && r.leaks === 0, `the list: ${j}`);
  // The tracker: MISSION 4/N, and no title for what comes next.
  await v((g) => (g.missions.checkT = 0));
  const shown = await until((g) => /MISSION 4\//.test(document.getElementById("mission-tracker").textContent) && document.getElementById("mission-tracker").textContent, 20000);
  assert(shown && shown.includes(`MISSION 4/${r.total}`) && /Next: classified/.test(shown), `the tracker: ${shown}`);
  // A save keeps the run.
  const saved = await v((g) => {
    const s = JSON.parse(JSON.stringify(g.progress.serialize()));
    const chain = g.progress.chain.join();
    g.progress.load(s, g.stats.world);
    return { v: s.v, same: g.progress.chain.join() === chain, step: g.progress.step, seed: g.progress.seed };
  });
  assert(saved.v === 7 && saved.same && saved.step === 3 && saved.seed === 9001, JSON.stringify(saved));
});

await check("the long night: the clock eases to dusk (no jump: speeds up, then slows to normal), and a lost night eases on to the next dusk", async () => {
  await survival();
  await v(async (g) => {
    const { CLASSIC_IDS } = await import("./js/progression.js");
    g.progress.setChain(CLASSIC_IDS);
    g.progress.step = CLASSIC_IDS.indexOf("long_night");
    g.progress.start(g.stats.world);
    g.missions.state = { t: 0 };
    g.missions.missionId = "long_night";
    g.missions.night.active = false;
    g.sky.locked = false;
    g.sky.timeScale = 1;
    g.sky.setHours(13);
    // A sampler every frame: the hour and the clock's speed.
    window.__samples = [];
    const f = () => {
      window.__samples.push([g.sky.hours, g.sky.timeScale, !!g.missions.state.warp]);
      if (window.__samples.length < 4000) window.__sampler = requestAnimationFrame(f);
    };
    window.__sampler = requestAnimationFrame(f);
  });
  const dusk = await until((g) => g.missions.night.active && !g.missions.state.warp && (g.missions.state.nt ?? -1) >= 0 && g.missions.state.fastDone, 90000);
  const r = await v((g) => {
    cancelAnimationFrame(window.__sampler);
    const s = window.__samples.filter((x) => x[2]);
    const scales = s.map((x) => x[1]);
    let back = 0;
    for (let i = 1; i < s.length; i++) if (s[i][0] < s[i - 1][0] - 1e-6) back++;
    return { n: s.length, first: scales[0], peak: Math.max(...scales), last: scales[scales.length - 1], back, h: g.sky.hours, ts: g.sky.timeScale, note: g.missions.note() };
  });
  const j = JSON.stringify(r);
  assert(dusk, `night came: ${j}`);
  assert(r.n >= 4 && r.back === 0, `the clock only goes forward: ${j}`);
  assert(r.first < r.peak && r.last < r.peak && r.peak > 8, `it speeds up and slows down: ${j}`);
  assert(r.h >= 19.5 && r.h < 20.5 && r.ts === 1, `normal speed at dusk: ${j}`);
  // The player dies in the night: the night is lost; after the respawn the clock eases on to the next dusk.
  const lost = await v((g) => {
    g.stats.add("deaths");
    g.missions.update(0.05);
    const st = g.missions.state;
    return { retry: !!st.retry, warp: !!st.warp, note: g.missions.note() };
  });
  assert(lost.retry && lost.warp, `the lost night: ${JSON.stringify(lost)}`);
  const next = await until((g) => !g.missions.state.warp && !g.missions.state.retry && g.missions.night.active && g.missions.night.clean && g.sky.timeScale === 1 && g.sky.hours, 90000);
  assert(next && next >= 19.5 && next < 20.5, `the next dusk: ${next}`);
  await v((g) => {
    g.testFlags.noMissions = true;
    g.missions.enabled = false;
    g.progress.step = 0;
    g.sky.timeScale = 1;
    g.sky.setHours(12);
    g.mobs.clear();
  });
});

await check("a guest mirrors the host's run: its missions and order, its rewards by place, the victory on the final, the host's dusk on its sky", async () => {
  const r = await v(async (g) => {
    const { makeChain, CLASSIC_IDS } = await import("./js/progression.js");
    const { CoopSync } = await import("./js/net/coop.js");
    const { warpTime } = await import("./js/missions.js");
    const game = g.mp.game;
    g.setMode("survival");
    const c = Object.create(CoopSync.prototype);
    c.game = game;
    c.mp = g.mp;
    c.net = { isHost: false, isClient: true, time: 1000 };
    c._lastStep = -1;
    const run = makeChain(4242);
    const p = game.progress;
    p.step = 0;
    const out = {};
    // The host's state, with its run.
    c._onMission({ t: "mis", on: true, step: 5, obj: [["Aliens killed", 1, 2]], ch: run.ids.join(","), cv: run.vars.join(""), gs: 1 });
    out.chain = p.chain.join() === run.ids.join();
    out.vars = p.vars.join() === run.vars.join();
    out.step = p.step;
    out.done = p.done.length;
    out.mission = p.mission?.id === run.ids[5];
    // A later state without the run keeps it.
    c._onMission({ t: "mis", on: true, step: 6, obj: [], gs: 1 });
    out.kept = p.chain.join() === run.ids.join() && p.step === 6;
    // The reward is the place's.
    const fin = p.missionById("armada");
    const apples = () => game.inventory.slots.reduce((n, s) => n + (s && s.id === 262 ? s.count : 0), 0);
    const before = apples();
    c._onMissionDone({ t: "misdone", id: "armada", fin: true });
    out.reward = apples() - before;
    out.finReward = fin.reward.find(([id]) => id === 262)[1];
    // The host's dusk: this sky follows the curve from the host's plan.
    const sky = game.sky;
    const plan = [100, 300, 10, 1000 - 4]; // (4 s into a 10 s warp)
    sky.time = warpTime(100, 300, 10, 4);
    c.mission = { on: true, dk: plan };
    c._guestDusk(0.05);
    out.duskScale = sky.timeScale;
    out.expect = (warpTime(100, 300, 10, 4.05) - sky.time) / 0.05;
    c.mission = { on: true, dk: null };
    c._guestDusk(0.05);
    out.after = sky.timeScale;
    // (Back to this page's own game.)
    p.setChain(CLASSIC_IDS);
    p.step = 0;
    p.done = [];
    p.mirrorObjectives = null;
    delete game.missions.note; // (_onMission points the director's note at the host's)
    game.missions.target = null;
    sky.setHours(12);
    g.setMode("creative");
    return out;
  });
  const j = JSON.stringify(r);
  assert(r.chain && r.vars && r.step === 5 && r.done === 5 && r.mission && r.kept, `the run: ${j}`);
  assert(r.reward === r.finReward && r.finReward >= 20, `the place's reward: ${j}`);
  assert(Math.abs(r.duskScale - r.expect) < 0.5 && r.duskScale > 10 && r.after === 1, `the dusk: ${j}`);
  const won = await until(() => !document.getElementById("victory-screen").classList.contains("hidden"), 8000);
  assert(won, "the victory screen on the final");
  await page.evaluate(() => document.getElementById("victory-screen").classList.add("hidden"));
});

// ---------- (missions-b) The new missions ----------
// A short run with the mission at place `at` (the others around it only fill the places).
const RUN = ["skeleton", "supply", "first_contact", "evac", "hunted", "crash_site", "patrol", "hold_line", "rescue", "grays", "wings", "touchdown", "sabotage", "reds", "salvage", "sunburn", "steal", "overlord", "armada"];
const startNew = (id, variant = 0) =>
  v(
    (g, a) => {
      g.testFlags.noMissions = false;
      g.progress.enabled = true;
      g.missions.enabled = true;
      g.progress.setChain(a.run, a.run.map((x) => (x === a.id ? a.variant : 0)));
      g.progress.step = g.progress.indexOf(a.id);
      g.progress.place = null;
      g.progress.start(g.stats.world);
      g.missions.checkT = 0;
      g.missions.update(0.5);
      return g.progress.mission?.id;
    },
    { id, variant, run: RUN }
  );
const endNew = () =>
  v((g) => {
    g.testFlags.noMissions = true;
    g.missions.enabled = false;
    g.progress.step = 0;
    g.progress.place = null;
    g.ufos.clear();
    g.mobs.clear();
    g.player.health = 20;
  });

await check("Don't look up: abductor hunters come (for any player), the clock runs, a player taken sets it back a minute, held out: done, and the hunters leave", async () => {
  await survival();
  assert((await startNew("hunted")) === "hunted", "the mission is on");
  const r = await v((g) => {
    const tick = (n) => {
      for (let i = 0; i < n; i++) {
        g.missions.checkT = 0;
        g.missions.update(0.5);
      }
    };
    const val = () => g.progress.objectives(g.stats.world)[0].value;
    tick(14);
    const hs = g.ufos.ufos.filter((u) => u.hunter);
    const out = { hunters: hs.length, kept: hs.every((u) => u.style === "abductor" && u.missionTarget && u.noLeave && u.hostile), goal: g.progress.objectives(g.stats.world)[0].goal, label: g.missions.target?.label, note: g.missions.note() };
    const a = val();
    tick(10);
    out.ticked = val() - a;
    g.stats.add("holdTime", 80);
    out.before = val();
    g.stats.add("abducted");
    tick(1);
    out.after = val();
    g.stats.add("holdTime", 400);
    g.progress.update(g.stats.world);
    out.next = g.progress.mission?.id;
    tick(1);
    out.huntersLeft = g.ufos.ufos.filter((u) => u.hunter).length;
    out.leaving = hs.filter((u) => g.ufos.ufos.includes(u)).every((u) => u.state === "leave" || u.state === "gone");
    return out;
  });
  const j = JSON.stringify(r);
  assert(r.hunters >= 2 && r.kept && r.goal === 150 && /Abductor/.test(r.label || "") && /Hold out/.test(r.note), `the hunters: ${j}`);
  assert(r.ticked >= 4 && r.ticked <= 6, `the clock runs: ${j}`);
  assert(r.before - r.after >= 59 && r.before - r.after <= 61, `taken: a minute back: ${j}`);
  assert(r.next === "crash_site" && r.huntersLeft === 0 && r.leaving, `done, and the hunters go: ${j}`);
  await endNew();
});

await check("Crash site: a UFO comes down on fire, the site is held (contested by aliens in it), a recovery team drops in, then the wreck is looted", async () => {
  await survival();
  assert((await startNew("crash_site")) === "crash_site", "the mission is on");
  const r = await v((g) => {
    const tick = () => {
      g.missions.checkT = 0;
      g.missions.update(0.5);
    };
    const st = () => g.missions.state;
    let k = 0;
    for (; k < 120 && !st().zone; k++) {
      g.ufos.update(0.1);
      if (k % 5 === 0) tick();
    }
    const out = { falls: k, zone: !!st().zone, place: g.progress.place?.mission === "crash_site" };
    if (!st().zone) return out;
    const z = st().zone;
    out.wreck = g.vehicles.vehicles.some((v) => v.type === "ufo" && v.crashed && Math.hypot(v.pos.x - z.x, v.pos.z - z.z) < 25);
    out.mo = JSON.stringify(g.missions.netObjects());
    // Into the site: the clock runs.
    g.player.position.set(z.x + 3, z.y + 0.1, z.z);
    g.player.velocity.set(0, 0, 0);
    const v0 = g.progress.objectives(g.stats.world)[0].value;
    for (let i = 0; i < 8; i++) tick();
    out.held = g.progress.objectives(g.stats.world)[0].value - v0;
    // An alien in it: contested, the clock stops.
    const m = g.mobs.spawn("alien", z.x - 3, z.y, z.z);
    const v1 = g.progress.objectives(g.stats.world)[0].value;
    for (let i = 0; i < 4; i++) tick();
    out.contested = g.progress.objectives(g.stats.world)[0].value - v1;
    out.noteC = g.missions.note();
    if (m) {
      m.health = 0;
      m.dead = true;
    }
    g.mobs.clear();
    // The recovery team (18 s after the crash).
    for (let i = 0; i < 30; i++) tick();
    out.team = (st().alive || []).length;
    g.mobs.clear();
    // Held: the wreck opens; walking up to it loots it.
    g.player.position.set(z.x + 12, z.y + 0.1, z.z);
    g.stats.add("holdTime", 200);
    tick();
    out.lootLabel = g.missions.target?.label;
    const items0 = g.entities.items.length;
    g.player.position.set(z.x, z.y + 0.1, z.z);
    tick();
    out.items = g.entities.items.length - items0;
    out.looted = g.progress.objectives(g.stats.world)[1].value;
    g.progress.update(g.stats.world);
    out.next = g.progress.mission?.id;
    return out;
  });
  const j = JSON.stringify(r);
  assert(r.zone && r.place && r.wreck && /"z":\[\[/.test(r.mo || ""), `the crash: ${j}`);
  assert(r.held >= 3 && r.contested === 0 && /Contested/.test(r.noteC || ""), `holding it: ${j}`);
  assert(r.team >= 2, `the recovery team: ${j}`);
  assert(/loot/.test(r.lootLabel || "") && r.items >= 1 && r.looted === 1 && r.next === "patrol", `the loot: ${j}`);
  await endNew();
});

await check("Run for cover, Sabotage and Rescue: a shelter and the bombardment's rings (sent to guests), arriving counts; beacons land, are guarded and count when shot down; carriers run, and freed captives land", async () => {
  await survival();
  assert((await startNew("evac", 3)) === "evac", "the run for cover is on");
  const e = await v((g) => {
    const tick = (n = 1) => {
      for (let i = 0; i < n; i++) {
        g.missions.checkT = 0;
        g.missions.update(0.5);
      }
    };
    tick(20);
    const st = g.missions.state;
    const z = st.zone;
    const out = { zone: !!z, dist: z ? Math.round(Math.hypot(z.x - st.from.x, z.z - st.from.z)) : 0, rings: st.rings.length, spotter: !!st.spotter?.spotter, mo: JSON.stringify(g.missions.netObjects()), resp: g.missions.respawnPlace() };
    if (!z) return out;
    g.player.position.set(z.x, z.y + 0.1, z.z);
    tick();
    out.in = g.progress.objectives(g.stats.world)[0].value;
    g.progress.update(g.stats.world);
    out.next = g.progress.mission?.id;
    return out;
  });
  const je = JSON.stringify(e);
  assert(e.zone && e.dist >= 100 && e.rings >= 1 && e.spotter && /"r":\[\[/.test(e.mo) && /"z":\[\[/.test(e.mo), `the run for cover: ${je}`);
  assert(e.resp && e.in === 1 && e.next === "hunted", `arrived: ${je}`);
  await endNew();
  await survival();
  assert((await startNew("sabotage")) === "sabotage", "sabotage is on");
  const s = await v((g) => {
    const tick = () => {
      g.missions.checkT = 0;
      g.missions.update(0.5);
    };
    for (let i = 0; i < 8; i++) tick();
    const pods = g.missions.state.pods || [];
    const out = { pods: pods.length, flags: pods.every((u) => u.beacon && u.errand && u.peaceful && u.missionTarget) };
    // Down on the ground (the UFOs move only in their own update).
    for (let i = 0; i < 80; i++) {
      g.ufos.update(0.1);
      if (i % 5 === 0) tick();
    }
    out.down = pods.filter((u) => u.podDown).length;
    out.mo = JSON.stringify(g.missions.netObjects());
    // Someone near one (its ground loaded: the guards wait for it).
    const u = pods[0];
    g.player.position.set(u.podAt.x + 40, u.podAt.y + 30, u.podAt.z);
    g.player.velocity.set(0, 0, 0);
    return out;
  });
  const loaded = await until((g) => {
    const u = g.missions.state.pods?.[0];
    g.player.velocity.set(0, 0, 0);
    return !!u && !!g.world.getChunk(Math.floor(u.podAt.x) >> 4, Math.floor(u.podAt.z) >> 4) && !!g.world.getChunk(Math.floor(u.podAt.x + 40) >> 4, Math.floor(u.podAt.z) >> 4);
  }, 60000);
  assert(loaded, "the beacon's ground loads");
  Object.assign(s, await v((g) => {
    const tick = () => {
      g.missions.checkT = 0;
      g.missions.update(0.5);
    };
    const u = g.missions.state.pods[0];
    const out = {};
    const n0 = g.mobs.mobs.filter((m) => m.spec.alien && !m.dead).length;
    tick();
    out.guards = g.mobs.mobs.filter((m) => m.spec.alien && !m.dead).length - n0;
    // Shot (it never flies off to fight), down: counted.
    const b0 = g.progress.objectives(g.stats.world)[0].value;
    g.ufos.damage(u, 30, true);
    out.stayed = u.state === "trick" && u.trick === "land";
    g.ufos.damage(u, 9999, true);
    for (let i = 0; i < 30 && g.ufos.ufos.includes(u); i++) g.ufos.update(0.1);
    out.counted = g.progress.objectives(g.stats.world)[0].value - b0;
    g.mobs.clear();
    return out;
  }));
  const js = JSON.stringify(s);
  assert(s.pods === 3 && s.flags && s.down >= 1 && /"b":\[\[/.test(s.mo), `the beacons: ${js}`);
  assert(s.guards >= 2 && s.stayed && s.counted === 1, `guards and the count: ${js}`);
  await endNew();
  await survival();
  assert((await startNew("rescue")) === "rescue", "the rescue is on");
  const c = await v((g) => {
    const tick = () => {
      g.missions.checkT = 0;
      g.missions.update(0.5);
    };
    // (A farm close by, not a far village: its ground is loaded for the captives.)
    const p = g.player.position;
    g.missions.state.place = { x: p.x + 15, y: p.y, z: p.z + 10, name: "farm", kinds: ["cow", "sheep"] };
    for (let i = 0; i < 3; i++) tick();
    const cs = (g.missions.state.carriers || []).slice();
    const out = { carriers: cs.length, flags: cs.every((u) => u.carrier && u.errand && u.tripSpeed > 0 && u.missionTarget) };
    for (let i = 0; i < 160; i++) {
      g.ufos.update(0.1);
      if (i % 5 === 0) tick();
    }
    const u = cs.find((x) => g.ufos.ufos.includes(x) && !x.falling);
    out.running = !!u?.runDir;
    out.speed = u ? Math.round(u.vel.length() * 10) / 10 : 0;
    if (!u) return out;
    const k0 = g.mobs.mobs.length;
    const c0 = g.progress.objectives(g.stats.world)[0].value;
    g.ufos.damage(u, 9999, true);
    for (let i = 0; i < 120 && g.ufos.ufos.includes(u); i++) g.ufos.update(0.1);
    out.counted = g.progress.objectives(g.stats.world)[0].value - c0;
    out.freed = g.mobs.mobs.length - k0;
    out.crashAt = [Math.round(u.pos.x), Math.round(u.pos.y), Math.round(u.pos.z)];
    out.loaded = !!g.world.getChunk(Math.floor(u.pos.x) >> 4, Math.floor(u.pos.z) >> 4);
    return out;
  });
  const jc = JSON.stringify(c);
  assert(c.carriers >= 2 && c.flags && c.running && c.speed > 3 && c.speed < 11, `the carriers: ${jc}`);
  assert(c.counted === 1 && c.freed >= 1, `shot down: ${jc}`);
  await endNew();
});

// ---------- Summary ----------
const failed = results.filter(([, ok]) => !ok);
console.log(`\n${results.length - failed.length} passed, ${failed.length} failed${errors.length ? `; console errors: ${errors.length}` : ""}.`);
if (errors.length) console.log(errors.slice(0, 5).join("\n"));
await browser.close();
server.close();
process.exit(failed.length || errors.length ? 1 : 0);
