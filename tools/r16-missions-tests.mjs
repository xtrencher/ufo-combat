// Round 16 missions tests: the mission board (js/mission-board.js,
// js/mission-catalog.js, js/mission-ui.js) and the director's new and
// reworked missions (js/missions.js).
// In Node (fast): the catalog (every board mission in the pool, a director
// case for each event, a Recruit mission in every category, the unlocks),
// the board's rules (begin, complete, fail, retry, abandon, the vehicle
// locks, the save and old saves: a Round 10 run's wins carried over, junk
// loaded without errors).
// In the browser (a Missions world, ?board: the board as a player gets it):
// the tracker between missions and the board screen (categories, tiers,
// locks; Start from the board); a mission of each category starts, shows
// its objective and its marker and is completed by driving the game
// (killing its targets); the new ones (Convoy escort, Air raid, Airport
// defense) set out what they need; a failure (the raid overruns the
// position; the clock runs out) and a retry; the board kept by a save and
// a reload. With --online (also run by default): a guest mirrors the host's
// board, asks for a mission, gets the reward, sees a failure.
//
//   node r16-missions-tests.mjs [--only=substring] [--node] [--solo]
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
  // (The boot always runs, the solo checks build on it; not for --only=online, which boots its own.)
  const only = args.only ? String(args.only).toLowerCase() : "";
  if (only && !(name.startsWith("boot") && only !== "online") && !name.toLowerCase().includes(only)) return;
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

const C = await imp("js/mission-catalog.js");
const { MissionBoard } = await imp("js/mission-board.js");
const P = await imp("js/progression.js");
const blankStats = () => Object.fromEntries(P.MISSIONS.flatMap((m) => m.objectives.map((o) => [o.stat, 0])));

await check("catalog: every board mission in the pool, a director case for each, a Recruit mission in every category", async () => {
  const src = fs.readFileSync(path.join(ROOT, "js/missions.js"), "utf8");
  for (const e of C.BOARD) {
    const m = P.missionById(e.id);
    assert(m, `${e.id} is not in the pool`);
    assert(src.includes(`case "${m.event}":`), `no director case for ${m.event}`);
    assert(C.CATEGORY_BY_ID[e.cat] && e.tier >= 1 && e.tier <= 3, `${e.id}: category and tier`);
    assert(C.limitFor(e) >= 300, `${e.id}: a time limit`);
  }
  for (const c of C.CATEGORIES) assert(C.BOARD.some((e) => e.cat === c.id && e.tier === 1), `${c.id} has no Recruit mission`);
  assert(new Set(C.BOARD.map((e) => e.id)).size === C.BOARD.length, "a mission twice on the board");
  for (const id of ["escort", "air_raid", "airport_defense", "tank_battle", "air_cav", "abductors", "base_assault"]) assert(C.BOARD_BY_ID.has(id), `${id} is on the board`);
  // Every Veteran and Elite mission can be opened by winning something.
  const won = new Set();
  for (let pass = 0; pass < 6; pass++) for (const e of C.BOARD) if (!C.lockReason(e, won)) won.add(e.id);
  assert(won.size === C.BOARD.length, `never opened: ${C.BOARD.filter((e) => !won.has(e.id)).map((e) => e.id)}`);
});

await check("board: begin, complete (the reward, the unlock), fail, retry, abandon, the locks", async () => {
  const b = new MissionBoard();
  const st = blankStats();
  b.load(null, st);
  assert(b.board && !b.mission && b.wins === 0, "a fresh board, no mission");
  assert(!b.reached("wings") && !b.reached("air_cav") && !b.isDone("supply"), "jets, helicopters and random crates locked at first");
  assert(b.begin("convoy", st) && b.lockOf("convoy"), "a Veteran mission is locked");
  assert(b.begin("dogfight", st) === null && b.mission?.id === "dogfight", "a Recruit mission starts");
  assert(b.reached("wings"), "its jet may be flown while it runs");
  assert(b.active.left === C.limitFor(C.BOARD_BY_ID.get("dogfight")), "its clock");
  let won = null;
  b.onComplete = (m) => (won = m);
  st.ufosDownByJet = 5;
  b.update(st);
  assert(won?.id === "dogfight" && !b.mission && b.result.ok, "completed");
  assert(won.reward.length >= 3, `the first win's reward: ${JSON.stringify(won.reward)}`);
  assert(/fighter jets/.test(b.result.unlock), `the unlock: ${b.result.unlock}`);
  assert(b.reached("wings") && b.isDone("supply") && !b.reached("air_cav"), "jets open now, helicopters not");
  assert(!b.lockOf("convoy"), "an Air Veteran mission opens");
  // Fail and retry.
  let failed = null;
  b.onFail = (m, why) => (failed = why);
  b.begin("convoy", st);
  b.tickTimer(99999);
  assert(failed === "Out of time." && !b.mission && b.result && !b.result.ok, "the clock ran out: failed");
  const run = b.runId;
  assert(b.retry(st) === null && b.mission?.id === "convoy" && b.runId === run + 1, "retried");
  b.abandon();
  assert(!b.mission && b.result.reason === "Abandoned." && b.fails === 1, "abandoned (not a failure)");
  // The rank, the reward of a repeat.
  assert(C.rewardFor(C.BOARD_BY_ID.get("dogfight"), true).length === 1, "a repeat pays less");
});

await check("board: the save, and old saves (a Round 10 run's wins carried over; junk loads)", async () => {
  const st = blankStats();
  const b = new MissionBoard();
  b.load(null, st);
  b.begin("tank_battle", st);
  st.tanksDown = 9;
  b.update(st);
  b.begin("air_cav", st);
  const saved = JSON.parse(JSON.stringify(b.serialize()));
  assert(saved.v === 8 && saved.won.tank_battle === 1 && saved.active?.id === "air_cav", JSON.stringify(saved));
  const c = new MissionBoard();
  c.load(saved, st);
  assert(c.won.get("tank_battle") === 1 && c.mission?.id === "air_cav" && c.active.left > 0, "reloaded, the mission still running");
  // A Round 10 save (v7): its wins on the board, no mission running.
  const old = new MissionBoard();
  old.load({ v: 7, step: 6, chain: ["skeleton", "landing", "supply", "first_contact", "crew", "wings", "long_night"], vars: [0, 0, 0, 0, 0, 0, 0], done: ["skeleton", "landing", "supply", "first_contact", "crew", "wings"], base: {} }, st);
  assert(old.board && !old.mission && old.won.has("skeleton") && old.won.has("supply") && !old.won.has("crew"), `the old run's wins: ${[...old.won.keys()]}`);
  for (const junk of [{ v: 3, step: 4 }, { v: 5, step: 99 }, { v: 8, won: { nope: 3, skeleton: "x" }, active: { id: "nope" } }, "junk", 42, { v: 8, active: { id: "armada", v: 9, left: -5 } }]) {
    const j = new MissionBoard();
    j.load(junk, st);
    assert(j.board, `junk: ${JSON.stringify(junk)}`);
  }
});

// ---------- Browser ----------

if (!args.node) await browserChecks();

async function browserChecks() {
  const { chromium } = await import("playwright-core");
  const PORT = 9930 + Math.floor(Math.random() * 40);
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
      if (st === "start") await p.click("#play-btn", { timeout: 5000 }).catch(() => {});
      else if (await p.isVisible("#resume-btn")) await p.click("#resume-btn", { timeout: 3000 }).catch(() => {});
      else if (await p.isVisible("#click-to-play").catch(() => false)) await p.click("#click-to-play", { timeout: 3000 }).catch(() => {});
      else {
        await p.mouse.click(300, 200);
        await frames(p, 5);
      }
      await frames(p, 3);
    }
    const why = await v(p, (g) => ({ state: g.gameState, shown: [...document.querySelectorAll(".overlay:not(.hidden), #click-to-play:not(.hidden), #death-screen:not(.hidden)")].map((e) => e.id).join(",") })).catch((e) => String(e));
    throw new Error(`the game didn't start playing: ${JSON.stringify(why)}`);
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

  // Plays the director for a while (its checks every half second), the
  // vehicles and the UFOs on with it; returns what `probe` says.
  const RUN = `(g, n, probe) => {
    const D = g.missions;
    for (let i = 0; i < n; i++) {
      D.checkT = 0;
      D.update(0.5);
      if (D.state) D.state.t = (D.state.t || 0) + 0.5;
      if (probe && probe(g)) return true;
    }
    return false;
  }`;
  // A board mission started for the test (Recruit or not), the director set to go.
  const START = `(g, id, variant = 0) => {
    const P = g.progress, D = g.missions;
    g.player.setMode("survival");
    g.player.damage = () => false;
    P.enabled = true;
    D.enabled = true;
    const why = P.begin(id, g.stats.world, { force: true, variant });
    if (why) throw new Error(why);
    return P.mission.id;
  }`;
  const tracker = (p) => v(p, (g) => {
    g.__forceTracker = true;
    return document.getElementById("mission-tracker").textContent;
  });
  // Every enemy of the mission destroyed by the player (vehicles, UFOs).
  const KILL = `(g) => {
    let n = 0;
    for (const u of [...g.vehicles.vehicles]) if (u.alive && (u.isEnemyGround || u.isGunship) && (u.mission || u.apMission)) { u.damage(99999, "player", true); n++; }
    for (const u of [...g.ufos.ufos]) if (!u.falling && u.state !== "gone" && (u.missionTarget || u.raider || u.abductor || u.raidMission || u.apMission)) { g.ufos.damage(u, 999999, true); n++; }
    return n;
  }`;
  const run = (p, n, probe = null) => p.evaluate(([src, n, pr]) => new Function("g", "n", "pr", `return (${src})(g, n, pr ? new Function("g", "return (" + pr + ")(g)") : null);`)(window.__ufo, n, pr), [RUN, n, probe ? probe.toString() : null]);
  const start = (p, id, variant = 0) => p.evaluate(([src, id, va]) => new Function("g", "id", "va", `return (${src})(g, id, va);`)(window.__ufo, id, va), [START, id, variant]);
  const kill = (p) => p.evaluate((src) => new Function("g", `return (${src})(g);`)(window.__ufo), KILL);
  const finish = (p) => v(p, (g) => {
    g.progress.update(g.stats.world);
    return { mission: g.progress.mission?.id || null, result: g.progress.result };
  });
  const clear = (p) => v(p, (g) => {
    g.progress.abandon();
    g.missions.checkT = 0;
    g.missions.update(0.5);
    for (const u of [...g.vehicles.vehicles]) if (u.mission || u.missionTank || u.missionHeli || u.missionAA || u.missionTruck || u.isEnemyGround || u.isGunship || u.isEnemyJet || u.isPlayerJet) g.vehicles.remove(u);
    for (const u of g.ufos.ufos) u.state = "gone";
    if (g.vehicles.active) g.vehicles.exit({ force: true });
    return true;
  });

  const page = await newPage("solo");
  const soloOnly = !!args.solo;
  await browserCheck("boot: a Missions world plays the board, no mission running", async () => {
    await page.goto(`http://127.0.0.1:${PORT}/index.html?seed=8131&type=missions&graphics=low&board=1`, { waitUntil: "load", timeout: 60000 });
    await page.waitForFunction(() => !!window.__ufo && window.__ufo.graphicsReady, null, { timeout: 120000 });
    await play(page);
    const r = await v(page, (g) => ({ board: g.progress.board, mission: g.progress.mission, enabled: g.progress.enabled, wins: g.progress.wins }));
    assert(r.board && !r.mission && r.enabled && r.wins === 0, JSON.stringify(r));
    await frames(page, 4);
    const t = await until(page, (g) => document.getElementById("mission-tracker").textContent || null, 10000);
    assert(/NO MISSION/.test(t || "") && /Press M/.test(t), `the tracker: ${t}`);
  });

  await browserCheck("the board screen: six categories, tiers, locks; Start from a card begins the mission", async () => {
    const r = await v(page, (g) => {
      g.screens.show("missions-screen", "pause-menu");
      const el = document.getElementById("missions-list");
      const tabs = [...el.querySelectorAll(".mb-tab")].map((b) => b.textContent);
      el.querySelector('[data-tab="ground"]').click();
      const cards = [...el.querySelectorAll(".mb-card")].map((c) => c.className + "|" + c.querySelector(".mb-title").textContent);
      const btn = el.querySelector('[data-start="tank_battle"]');
      btn?.click();
      return { tabs, cards, started: g.progress.mission?.id || null };
    });
    assert(r.tabs.length === 6 && r.tabs.some((t) => /Helicopter/.test(t)) && r.tabs.some((t) => /Defense/.test(t)), `tabs: ${r.tabs}`);
    assert(r.cards.some((c) => /locked\|Base assault/.test(c)) && r.cards.some((c) => /open\|Tank battle/.test(c)), `cards: ${r.cards}`);
    assert(r.started === "tank_battle", `started: ${r.started}`);
    await clear(page);
    await play(page);
  });

  const cats = [
    // [category, id, what to check after a while, how to finish]
    ["Infantry", "skeleton", (g) => g.missions.state.sks?.length > 0 && !!g.missions.target, "skel"],
    ["Ground", "tank_battle", (g) => g.missions.state.mine?.length > 0 && g.vehicles.vehicles.some((u) => u.mission && u.isEnemyGround), "kill"],
    ["Air", "dogfight", (g) => g.vehicles.vehicles.some((u) => u.isPlayerJet) && !!g.missions.target, "stat"],
    ["Helicopter", "air_cav", (g) => g.missions.state.helis?.length > 0 && g.vehicles.vehicles.some((u) => u.mission && u.isEnemyGround), "kill"],
    ["UFO", "abductors", (g) => g.ufos.ufos.some((u) => u.abductor) && !!g.missions.target, "kill"],
    ["Defense", "air_raid", (g) => g.missions.state.aas?.length > 0 && g.missions.state.raiders?.length > 0, "kill"],
  ];
  if (!soloOnly || true) for (const [cat, id, ready, how] of cats) {
    await browserCheck(`${cat}: "${id}" starts, shows its objective and marker, and is completed`, async () => {
      await play(page);
      await start(page, id);
      const ok = await run(page, 140, ready);
      const r = await v(page, (g) => ({ target: g.missions.target?.label || null, obj: g.progress.objectives(g.stats.world), title: g.progress.mission?.title }));
      assert(ok, `not set up: ${JSON.stringify(r)}`);
      await frames(page, 3);
      const t = await until(page, (g, title) => (document.getElementById("mission-tracker").textContent.includes(title) ? document.getElementById("mission-tracker").textContent : null), 8000, r.title);
      assert(t && /left/.test(t) && /blocks/.test(t), `the tracker: ${t}`);
      let rounds = 0;
      for (; rounds < 12; rounds++) {
        if (how === "kill") {
          await kill(page);
          // (A UFO counts when it hits the ground: wait for the falling ones.)
          await until(page, (g) => (g.ufos.ufos.every((u) => !u.falling) ? true : null), 30000);
        }
        else if (how === "skel") await v(page, (g) => { for (const m of g.missions.state.sks || []) m.missionTarget && g.stats.add("skeletonsKilled"); return true; });
        else await v(page, (g) => { for (const o of g.progress.mission?.objectives || []) g.stats.add(o.stat, o.goal); return true; });
        await run(page, 6);
        const f = await finish(page);
        if (!f.mission) {
          assert(f.result?.ok && f.result.id === id, `the outcome: ${JSON.stringify(f.result)}`);
          break;
        }
      }
      assert(rounds < 12, `never completed: ${JSON.stringify(await v(page, (g) => g.progress.objectives(g.stats.world)))}`);
      await clear(page);
    });
  }

  await browserCheck("Convoy escort: the trucks roll while escorted, wait when not, and two delivered win it", async () => {
    await play(page);
    await start(page, "escort");
    const ok = await run(page, 40, (g) => g.missions.state.trucks?.length === 3);
    assert(ok, "no trucks");
    const r = await v(page, async (g) => {
      const st = g.missions.state;
      const d0 = st.dist;
      const lead = st.trucks[0];
      g.player.position.set(lead.pos.x + 8, lead.pos.y + 1, lead.pos.z);
      await new Promise((res) => setTimeout(res, 1500));
      const d1 = st.dist;
      g.player.position.set(lead.pos.x + 400, lead.pos.y + 30, lead.pos.z);
      await new Promise((res) => setTimeout(res, 800));
      const d2 = st.dist;
      await new Promise((res) => setTimeout(res, 800));
      const d3 = st.dist;
      const tank = st.mine?.length || 0;
      // To the end of the road.
      st.dist = st.len + 39;
      g.player.position.set(lead.pos.x + 8, lead.pos.y + 1, lead.pos.z);
      g.missions._fxEscort(0.01);
      return { d0, d1, d2, d3, tank, delivered: st.trucks.filter((t) => t.delivered).length, len: st.len };
    });
    assert(r.d1 > r.d0 && Math.abs(r.d3 - r.d2) < 0.01 && r.tank >= 1, `moving and waiting: ${JSON.stringify(r)}`);
    assert(r.delivered === 3, `delivered: ${JSON.stringify(r)}`);
    const f = await finish(page);
    assert(!f.mission && f.result?.ok, JSON.stringify(f));
    await clear(page);
  });

  await browserCheck("Airport defense: a helicopter and an AA vehicle, waves at the airport, the attackers counted", async () => {
    await play(page);
    await start(page, "airport_defense");
    const ok = await run(page, 140, (g) => g.missions.state.helis?.length > 0 && g.missions.state.aas?.length > 0 && (g.missions.state.attackers?.length > 0 || g.missions.state.ufoAtk?.length > 0));
    assert(ok, `not set up: ${JSON.stringify(await v(page, (g) => ({ note: g.missions.note(), wave: g.missions.state.wave })))}`);
    let n = 0;
    for (let i = 0; i < 16 && (await v(page, (g) => !!g.progress.mission)); i++) {
      n += await kill(page);
      await until(page, (g) => (g.ufos.ufos.every((u) => !u.falling) ? true : null), 30000);
      await run(page, 40, (g) => (g.missions.state.attackers || []).some((u) => u.alive) || (g.missions.state.ufoAtk || []).some((u) => !u.falling && u.state !== "gone"));
      await finish(page);
    }
    const f = await finish(page);
    assert(!f.mission && f.result?.ok, `${JSON.stringify(f)} after ${n} kills; ${JSON.stringify(await v(page, (g) => g.progress.objectives?.(g.stats.world)))}`);
    await clear(page);
  });

  await browserCheck("failure and retry: the raid overruns the position (failed, the tracker says so), the retry sets it up afresh; the clock runs out", async () => {
    await play(page);
    await start(page, "air_raid");
    await run(page, 80, (g) => g.missions.state.raiders?.length > 0);
    const r = await v(page, (g) => {
      const st = g.missions.state;
      for (const u of st.raiders) u.pos.set(st.center.x + 5, u.pos.y, st.center.z);
      st.hp = 0.2;
      g.missions.checkT = 0;
      g.missions.update(0.5);
      return { mission: g.progress.mission?.id || null, result: g.progress.result };
    });
    assert(!r.mission && r.result && !r.result.ok && /overrun/.test(r.result.reason), JSON.stringify(r));
    await frames(page, 3);
    const t = await until(page, (g) => (/MISSION FAILED/.test(document.getElementById("mission-tracker").textContent) ? document.getElementById("mission-tracker").textContent : null), 8000);
    assert(t && /retry/.test(t), `the tracker: ${t}`);
    const again = await v(page, (g) => {
      const why = g.progress.retry(g.stats.world);
      g.missions.checkT = 0;
      g.missions.update(0.5);
      return { why, mission: g.progress.mission?.id, hp: g.missions.state.hp, wave: g.missions.state.wave };
    });
    assert(!again.why && again.mission === "air_raid" && again.hp === 100 && again.wave === 0, `retried: ${JSON.stringify(again)}`);
    const out = await v(page, (g) => {
      g.progress.active.left = 0.2;
      g.missions.update(0.5);
      return g.progress.result;
    });
    assert(out && !out.ok && out.reason === "Out of time.", JSON.stringify(out));
    await clear(page);
  });

  await browserCheck("the locks: a jet can't be boarded before an Air win (with a board message), the board's wins kept by a save and a reload", async () => {
    await play(page);
    const r = await v(page, (g) => {
      const P = g.progress;
      const was = new Map(P.won);
      P.won = new Map();
      const jet = g.vehicles.create("jet", { jetType: "f16", pos: [g.player.position.x + 30, g.player.position.y + 2, g.player.position.z], yaw: 0 });
      const before = g.vehicles.canBoard(jet);
      P.won = was;
      const after = g.vehicles.canBoard(jet);
      g.vehicles.remove(jet);
      return { before, after, won: [...P.won.keys()] };
    });
    assert(/Air mission/.test(r.before || "") && !r.after && r.won.includes("dogfight"), JSON.stringify(r));
    await v(page, (g) => (g.flushSave(), true));
    await page.reload({ waitUntil: "load" });
    await page.waitForFunction(() => !!window.__ufo && window.__ufo.graphicsReady, null, { timeout: 120000 });
    await play(page);
    const s = await v(page, (g) => ({ board: g.progress.board, won: [...g.progress.won.keys()], mission: g.progress.mission?.id || null }));
    assert(s.board && ["skeleton", "tank_battle", "dogfight", "air_cav", "abductors", "air_raid", "escort"].every((k) => s.won.includes(k)), `after the reload: ${JSON.stringify(s)}`);
  });

  if (!args.solo) {
    const { default: express } = await import("express");
    const { ExpressPeerServer } = await import("peer");
    const PEER_PORT = PORT + 60;
    const app = express();
    const peerHttp = app.listen(PEER_PORT, "127.0.0.1");
    app.use("/ufo", ExpressPeerServer(peerHttp, { path: "/" }));
    const NET_Q = `peerServer=127.0.0.1:${PEER_PORT}/ufo&noStun=1&graphics=low&board=1`;
    await page.close();
    const host = await newPage("host", { width: 640, height: 360 });
    const guest = await newPage("guest", { width: 640, height: 360 });
    await browserCheck("online co-op: the guest mirrors the host's mission, asks for one, gets the reward, sees a failure", async () => {
      await host.goto(`http://127.0.0.1:${PORT}/index.html?seed=8132&type=missions&${NET_Q}`, { waitUntil: "load", timeout: 60000 });
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
      // (The guest is not put into play: two pages of one headless browser
      // don't both get the pointer lock. Its board and rewards run anyway.)
      // The guest asks for a mission from its board: the host starts it.
      await v(host, (g) => {
        g.player.setMode("survival");
        g.player.damage = () => false;
        return true;
      });
      await v(guest, (g) => (g.progress.begin("tank_battle", g.stats.world), true));
      const hs = await until(host, (g) => g.progress.mission?.id || null, 20000);
      assert(hs === "tank_battle", `the host's mission: ${hs}`);
      const gs = await until(guest, (g) => (g.progress.board && g.progress.mission?.id === "tank_battle" ? g.progress.active.left : null), 20000);
      assert(gs > 0, "the guest never mirrored the mission");
      // Its objectives on the guest's tracker (its lines, js/mission-ui.js).
      const t = await until(guest, async (g) => {
        const { trackerHtml } = await import("./js/mission-ui.js");
        const h = trackerHtml({ board: g.progress, stats: g.stats.world, target: g.missions.target, pos: g.player.position, note: g.missions.note() });
        return /Tank battle/.test(h) ? h : null;
      }, 15000);
      assert(t && /Enemy tanks destroyed/.test(t), `the guest's tracker: ${t}`);
      // The host wins it: the guest's reward.
      const g0 = await v(guest, (g) => g.inventory.slots.reduce((n, s) => n + (s && s.id === 262 ? s.count : 0), 0));
      await v(host, (g) => {
        g.stats.add("tanksDown", 20);
        g.progress.update(g.stats.world);
        return true;
      });
      const won = await until(guest, (g) => (g.progress.won.has("tank_battle") && !g.progress.mission ? true : null), 20000);
      assert(won, "the guest never saw the win");
      const g1 = await until(guest, (g, g0) => {
        const n = g.inventory.slots.reduce((k, s) => k + (s && s.id === 262 ? s.count : 0), 0);
        return n > g0 ? n : null;
      }, 15000, g0);
      assert(g1, "the guest got no reward");
      // A failure on the host: the guest sees it.
      await v(host, (g) => {
        g.progress.begin("tank_battle", g.stats.world);
        return true;
      });
      await until(guest, (g) => (g.progress.mission ? true : null), 15000);
      await v(host, (g) => (g.progress.fail("Test failure."), true));
      const gf = await until(guest, (g) => (g.progress.result && !g.progress.result.ok && !g.progress.mission ? g.progress.result.reason : null), 15000);
      assert(gf === "Test failure.", `the guest's outcome: ${gf}`);
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
