// Round 9 feature tests: boots the real game in headless Chromium (software
// WebGL, Low preset) and checks the Round 9 features in single player:
// mission targets that are never replaced, the steal mission's one ship,
// death messages, respawning around a mission, the new missions 23-28 and
// the victory screen, Creative call-ins and mode switching, the flatter
// terrain and spawn, the airport lights' fade, no land creatures in water
// and the blue alien's matte head. (Multiplayer: mp-tests.mjs and
// mp-damage-tests.mjs.)
//
//   node round9-tests.mjs [--only=substring] [--from=substring] [--seed=42]
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
const PORT = 9640 + Math.floor(Math.random() * 40);
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

let started = !args.from;
async function check(name, fn) {
  if (!started && name.toLowerCase().includes(String(args.from).toLowerCase())) started = true;
  if (!started) return;
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
await page.goto(`http://localhost:${PORT}/index.html?seed=${SEED}`, { waitUntil: "load", timeout: 60000 });
await page.waitForFunction(() => !!window.__ufo, null, { timeout: 60000 });
await page.evaluate(() => window.__ufo.setGraphics("low"));
await page.waitForFunction(() => window.__ufo.graphicsReady, null, { timeout: 120000 });

async function play() {
  // (Retried until the game runs: the pointer lock a click asks for can come
  // a moment later and hide the pause menu just as Resume is clicked.)
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
      // (After a respawn the game waits for the mouse, with no menu showing.)
      await page.mouse.click(480, 270);
      await frames(5);
      if ((await v((g) => g.gameState)) === "paused" && !(await page.isVisible("#resume-btn"))) await page.evaluate(() => document.getElementById("pause-menu").classList.remove("hidden"));
    }
    await frames(3);
  }
  throw new Error(`the game didn't start playing (state ${await v((g) => g.gameState)})`);
}
await play();

// Starts mission `id` of the chain in Survival, on the ground at the spawn,
// with a clean sky (the director sets it up on its next updates).
const startMission = (id) =>
  v(async (g, id) => {
    const { MISSIONS } = await import("./js/progression.js");
    g.testFlags.noMissions = false;
    if (g.player.dead) g.respawn();
    if (g.vehicles.active) g.vehicles.exit({ force: true });
    g.setMode("survival");
    g.progress.enabled = true;
    g.missions.enabled = true;
    g.world.prepareArea(g.spawn.x, g.spawn.z, 6);
    g.player.position.set(g.spawn.x + 0.5, g.world.surfaceY(g.spawn.x, g.spawn.z) + 1, g.spawn.z + 0.5);
    g.player.velocity.set(0, 0, 0);
    g.player.resetFall();
    g.player.flying = false;
    g.player.health = 20;
    g.ufos.clear();
    g.mobs.clear();
    for (const j of [...g.vehicles.vehicles]) if (j.isEnemyJet) g.vehicles.remove(j);
    g.progress.step = MISSIONS.findIndex((m) => m.id === id);
    g.progress.base = { ...g.progress._pick(g.stats.world) };
    g.missions.state = { t: 0 };
    g.missions.missionId = id;
    g.missions.base = null;
    return g.progress.mission?.id;
  }, id);
// The director's checks, n times (each is half a second of mission time).
const tick = (n = 4) =>
  v((g, n) => {
    for (let i = 0; i < n; i++) {
      g.missions.checkT = 0;
      g.missions.update(0.5);
    }
    return true;
  }, n);

// ================= Part 2: mission fixes =================

await check("Big game: the large UFO is the same ship from start to finish (far off it is called back, never despawned or replaced; its damage stays)", async () => {
  assert((await startMission("big_game")) === "big_game", "mission started");
  await tick(8);
  const r = await v((g) => {
    const st = g.missions.state;
    const u = st.big;
    if (!u) return { err: "no large UFO" };
    const out = { id: u.id, size: u.size, kept: !!u.missionTarget && !!u.noLeave };
    g.ufos.damage(u, Math.floor(u.maxHealth * 0.3), true);
    out.hp = u.health;
    // It strays very far (past the despawn distance) and asks to leave: neither happens.
    u.pos.set(g.player.position.x + 2200, u.pos.y, g.player.position.z);
    g.ufos._leave(u);
    g.missions._keepTarget(u);
    for (let i = 0; i < 30; i++) g.ufos.update(0.1);
    for (let i = 0; i < 6; i++) {
      g.missions.checkT = 0;
      g.missions.update(0.5);
    }
    out.still = g.ufos.ufos.includes(u) && !u.falling && u.state !== "gone" && u.state !== "leave";
    out.same = g.missions.state.big === u;
    out.hpAfter = u.health;
    out.home = u.home ? Math.round(u.home.distanceTo(g.player.position)) : -1;
    out.larges = g.ufos.ufos.filter((x) => x.S.idx >= 2 && !x.falling).length;
    return out;
  });
  assert(!r.err && r.kept && r.still && r.same && r.hpAfter === r.hp && r.home >= 0 && r.home < 20 && r.larges === 1, JSON.stringify(r));
});

await check("village raid: the raiders stay until they are shot down (no leaving and coming back fresh)", async () => {
  await startMission("village");
  await tick(4);
  const r = await v((g) => {
    const st = g.missions.state;
    const first = (st.raiders || []).map((u) => u.id);
    for (const u of st.raiders || []) g.ufos.damage(u, 5, true);
    // Ten minutes of raid.
    for (let i = 0; i < 1200; i++) {
      g.missions.checkT = 0;
      g.missions.update(0.5);
    }
    for (let i = 0; i < 40; i++) g.ufos.update(0.1);
    const now = (g.missions.state.raiders || []).filter((u) => g.ufos.ufos.includes(u) && !u.falling && u.state !== "leave").map((u) => u.id);
    return { first, now, label: g.missions.target?.label };
  });
  assert(r.first.length >= 3 && JSON.stringify(r.first) === JSON.stringify(r.now) && !/min\)/.test(r.label || ""), JSON.stringify(r));
});

await check("scouts are called back to the players, never dropped and replaced by a fresh one", async () => {
  await startMission("first_contact");
  await tick(8);
  const r = await v((g) => {
    const st = g.missions.state;
    const u = st.scouts?.[0];
    if (!u) return { err: "no scout" };
    g.ufos.damage(u, 10, true);
    const hp = u.health;
    u.pos.x += 1600;
    for (let i = 0; i < 20; i++) g.ufos.update(0.1);
    for (let i = 0; i < 8; i++) {
      g.missions.checkT = 0;
      g.missions.update(0.5);
    }
    return { same: g.missions.state.scouts[0] === u, n: g.missions.state.scouts.length, alive: g.ufos.ufos.includes(u), hp: u.health === hp, home: Math.round(u.home.distanceTo(g.player.position)) };
  });
  assert(!r.err && r.same && r.n === 1 && r.alive && r.hp && r.home < 20, JSON.stringify(r));
});

await check("Steal the ship: exactly one ship (the bunker's own), and a lost one is set out again by the bunker, never a second", async () => {
  await startMission("steal");
  const r = await v(async (g) => {
    const sites = g.sites;
    let site = null;
    let bd = Infinity;
    for (const s of sites.within(g.spawn.x, g.spawn.z, 8000)) {
      if (s.kind !== "airport" || !s.bunkers?.length) continue;
      const d = Math.hypot(s.x - g.spawn.x, s.z - g.spawn.z);
      if (d < bd) {
        bd = d;
        site = s;
      }
    }
    if (!site) return { skip: "no bunker airport" };
    const spot = sites.bunkerSpots(site)[0];
    g.world.prepareArea(spot.zone.x, spot.zone.z, 5);
    g.world.prepareArea(spot.x, spot.z, 4);
    g.player.position.set(spot.zone.x + 60, site.y + 2, spot.zone.z);
    g.player.flying = true;
    const ships = () => g.vehicles.vehicles.filter((v) => v.type === "ufo" && v.alive && v.pos.distanceTo(new g.THREE.Vector3(spot.x, spot.y, spot.z)) < 60);
    const step = (n) => {
      for (let i = 0; i < n; i++) {
        g.airports.timer = 0;
        g.airports.update(1);
        g.missions.checkT = 0;
        g.missions.update(0.5);
      }
    };
    step(12);
    const out = { first: ships().length, picked: !!g.missions.state.ship };
    // The ship is destroyed in the hall: the bunker sets out one new ship (and only one).
    const ship = g.missions.state.ship;
    if (ship) ship.damage(99999, "explosion");
    for (let i = 0; i < 5; i++) g.vehicles.update(0.1, null);
    step(20);
    out.after = ships().length;
    out.newPicked = !!g.missions.state.ship && g.missions.state.ship !== ship;
    out.reship = [...g.airports.reship];
    g.player.flying = false;
    return out;
  });
  if (r.skip) {
    console.log(`        (${r.skip}: skipped)`);
    return;
  }
  assert(r.first === 1 && r.picked && r.after === 1 && r.newPicked, JSON.stringify(r));
});

await check("death messages: every source names itself (soldiers, melee vs shots, UFO blasts, meteors, PvP shoot-downs)", async () => {
  const r = await v((g) => {
    const m = (c) => g.mp.game.deathMessage(c);
    return {
      soldier: m("soldier"),
      guard: m("guard"),
      alien: m("alien"),
      alienMelee: m("alien_melee"),
      skeleton: m("skeleton"),
      skeletonMelee: m("skeleton_melee"),
      spider: m("spider"),
      zombie: m("zombie"),
      redShot: m("alien_red_shot"),
      plasma: m("alien_plasma"),
      ufoBlast: m("ufo_blast"),
      ufoLaser: m("ufo_laser"),
      meteor: m("meteor"),
      enemyGun: m("enemyjet_gun"),
      pvp: m("pvp@2"),
    };
  });
  assert(r.soldier === "Shot by a soldier" && r.guard === "Struck down by a soldier" && r.alien === "Shot by an alien" && r.alienMelee === "Killed by an alien", JSON.stringify(r));
  assert(r.skeleton === "Shot by a skeleton" && r.skeletonMelee === "Killed by a skeleton" && r.spider === "Killed by a spider" && r.zombie === "Killed by a zombie", JSON.stringify(r));
  assert(/red alien/.test(r.redShot) && /plasma/.test(r.plasma) && r.ufoBlast === "Blown up by a UFO" && r.ufoLaser === "Shot by a UFO" && /meteor/.test(r.meteor) && /enemy fighter/.test(r.enemyGun) && /^Shot down by /.test(r.pvp), JSON.stringify(r));
  // The real thing: a green alien's blow and a soldier's shot.
  const c = await v((g) => {
    if (g.player.dead) g.respawn();
    g.setMode("survival");
    const p = g.player.position;
    const causes = [];
    const dmg = g.player.damage.bind(g.player);
    g.player.damage = (a, cause, o) => {
      causes.push(cause);
      return dmg(a, cause, o);
    };
    const a = g.mobs.spawn("alien", p.x + 1, p.y, p.z);
    g.player.health = 20;
    g.mobs._attackPlayer(a, 1, 0);
    const s = g.mobs.spawn("guard", p.x + 6, p.y, p.z);
    g.mobs._shootLaser(s, false);
    for (let i = 0; i < 30; i++) g.lasers.update(0.05);
    g.player.damage = dmg;
    g.mobs.clear();
    return causes;
  });
  assert(c[0] === "alien_melee", `causes ${JSON.stringify(c)}`);
});

await check("respawning during a mission: a random safe spot around the mission's location (dry, flat, out of the fight)", async () => {
  await startMission("village");
  await tick(4);
  const r = await v(async (g) => {
    const { BLOCK } = await import("./js/blocks.js");
    const place = g.missions.respawnPlace();
    if (!place) return { err: "no place" };
    const spots = [];
    for (let k = 0; k < 6; k++) {
      const s = g.missions.safeSpotAround(place, place.r);
      if (s) spots.push(s);
    }
    // A real death and respawn.
    g.player.damage(9999, "fall", { pierce: true });
    g.respawn();
    const p = g.player.position;
    const d = Math.hypot(p.x - place.x, p.z - place.z);
    const top = g.world.surfaceY(Math.floor(p.x), Math.floor(p.z));
    const wet = g.world.getBlock(Math.floor(p.x), top + 1, Math.floor(p.z)) === BLOCK.WATER || g.world.getBlock(Math.floor(p.x), top, Math.floor(p.z)) === BLOCK.WATER;
    let slope = 0;
    const h = g.world.terrain.heightAt(Math.floor(p.x), Math.floor(p.z));
    for (const [dx, dz] of [[2, 0], [-2, 0], [0, 2], [0, -2]]) slope = Math.max(slope, Math.abs(g.world.terrain.heightAt(Math.floor(p.x) + dx, Math.floor(p.z) + dz) - h));
    const ds = spots.map((s) => Math.round(Math.hypot(s[0] - place.x, s[1] - place.z)));
    return { r: place.r, d: Math.round(d), wet, slope, ds, distinct: new Set(spots.map((s) => s.join(","))).size };
  });
  assert(!r.err && r.d >= r.r - 2 && r.d <= r.r * 2.5 + 40 && !r.wet && r.slope <= 1 && r.ds.length >= 4 && r.distinct >= 3, JSON.stringify(r));
  await play();
});

// ================= Part 3: missions 23-28 =================

await check("mission chain: 28 missions, the counterattack after UFO slayer, rising difficulty, the Armada last", async () => {
  const r = await v(async () => {
    const { MISSIONS } = await import("./js/progression.js");
    return MISSIONS.map((m) => ({ id: m.id, ev: m.event, h: m.rules.health, d: m.rules.damage, max: m.rules.max }));
  });
  const ids = r.map((m) => m.id);
  assert(r.length === 28 && JSON.stringify(ids.slice(22)) === JSON.stringify(["scramble", "abductors", "titan", "swarm", "fortress", "armada"]), JSON.stringify(ids));
  for (let i = 22; i < 28; i++) assert(r[i].h >= r[i - 1].h && r[i].d >= r[i - 1].d && r[i].max >= r[i - 1].max, `difficulty at ${r[i].id}`);
});

await check("Scramble!: a wing of hijacked fighters arrives together (more for a bigger group)", async () => {
  await startMission("scramble");
  const r = await v((g) => {
    const out = {};
    for (const n of [1, 3]) {
      g.progress.groupN = n;
      g.missions.state = { t: 0 };
      for (const j of [...g.vehicles.vehicles]) if (j.isEnemyJet) g.vehicles.remove(j);
      for (let i = 0; i < 12; i++) {
        g.missions.checkT = 0;
        g.missions.update(0.5);
      }
      out[n] = { jets: (g.missions.state.jets || []).length, mission: (g.missions.state.jets || []).every((j) => j.mission && j.hijacked !== false), goal: g.progress.objectives(g.stats.world)[0].goal };
    }
    g.progress.groupN = 1;
    for (const j of [...g.vehicles.vehicles]) if (j.isEnemyJet) g.vehicles.remove(j);
    return out;
  });
  assert(r[1].jets === 2 && r[3].jets === 4 && r[1].mission && r[1].goal === 3 && r[3].goal === 6, JSON.stringify(r));
});

await check("Abductions: abductor UFOs over a village, kept until shot down; each one shot down counts", async () => {
  await startMission("abductors");
  await tick(4);
  const r = await v((g) => {
    const st = g.missions.state;
    const ships = st.ships || [];
    const out = { n: ships.length, style: ships.every((u) => u.style === "abductor" && u.abductor && u.missionTarget), place: st.place?.name };
    const before = g.stats.world.abductorsDown;
    g.ufos.damage(ships[0], 99999, true);
    for (let i = 0; i < 200 && g.ufos.ufos.includes(ships[0]); i++) g.ufos.update(0.1);
    out.counted = g.stats.world.abductorsDown - before;
    out.objective = g.progress.objectives(g.stats.world)[0].value;
    return out;
  });
  assert(r.n === 3 && r.style && r.place && r.counted === 1 && r.objective === 1, JSON.stringify(r));
});

await check("Titan: one giant ship with a tough, fixed hull, kept and leashed; bringing it down completes the mission", async () => {
  await startMission("titan");
  await tick(8);
  const r = await v((g) => {
    const u = g.missions.state.big;
    if (!u) return { err: "no titan" };
    const out = { size: u.size, idx: u.S.idx, hp: u.maxHealth, kept: u.missionTarget, label: g.missions.target?.label };
    g.ufos.damage(u, 99999, true);
    for (let i = 0; i < 400 && g.ufos.ufos.includes(u); i++) g.ufos.update(0.1);
    g.progress.update(g.stats.world);
    out.next = g.progress.mission?.id;
    return out;
  });
  assert(!r.err && r.size === "giant" && r.idx === 4 && r.hp === 9000 && r.kept && r.label === "Titan" && r.next === "swarm", JSON.stringify(r));
});

await check("Night of the swarm: the clock runs to dusk, then a swarm of small fast UFOs is kept over the player and landing parties come", async () => {
  await startMission("swarm");
  const r = await v((g) => {
    // Day: the director speeds the clock up toward dusk.
    g.sky.setHours(12);
    g.sky.locked = false;
    g.missions.checkT = 0;
    g.missions.update(0.5);
    const out = { fast: g.sky.timeScale > 1 };
    // Night (an evening start counts at once: most of the night is ahead).
    g.missions.state = { t: 0 };
    g.sky.setHours(20);
    for (let i = 0; i < 120; i++) {
      g.missions.checkT = 0;
      g.missions.update(0.5);
    }
    out.night = g.missions.night.active;
    out.swarm = g.ufos.ufos.filter((u) => u.swarm && !u.falling).length;
    out.small = g.ufos.ufos.filter((u) => u.swarm).every((u) => u.size === "small");
    out.waves = g.missions.state.wave ?? 0;
    out.aliens = g.mobs.mobs.filter((m) => m.spec.alien && !m.dead).length;
    out.objectives = g.progress.objectives(g.stats.world).map((o) => o.label);
    g.sky.timeScale = 1;
    g.sky.setHours(12);
    g.ufos.clear();
    g.mobs.clear();
    return out;
  });
  assert(r.fast && r.night && r.swarm >= 3 && r.small && r.waves >= 1 && r.aliens >= 4 && r.objectives.length === 2, JSON.stringify(r));
});

await check("The fortress: a garrison of mixed aliens with two leaders and guard ships, set out when the player comes near", async () => {
  await startMission("fortress");
  await tick(2);
  const r = await v((g) => {
    const at = g.missions.state.at;
    if (!at) return { err: "no fortress spot" };
    g.world.prepareArea(at.x, at.z, 4);
    g.player.position.set(at.x + 120, g.world.surfaceY(Math.floor(at.x + 120), Math.floor(at.z)) + 1, at.z);
    for (let i = 0; i < 6; i++) {
      g.missions.checkT = 0;
      g.missions.update(0.5);
    }
    const st = g.missions.state;
    const kinds = new Set(st.garrison.map((m) => m.kind));
    return { n: st.garrison.length, kinds: [...kinds], leaders: st.garrison.filter((m) => m.leader).length, guards: st.guards.length, label: g.missions.target?.label };
  });
  assert(!r.err && r.n >= 8 && r.kinds.includes("alien_red") && r.kinds.includes("alien_blue") && r.leaders === 2 && r.guards >= 1 && /fortress/i.test(r.label || ""), JSON.stringify(r));
  await v((g) => {
    g.mobs.clear();
    g.ufos.clear();
  });
});

await check("The Armada (finale): the Dreadnought, a titan behind four shields with pylons; its fall wins the war (victory screen)", async () => {
  await startMission("armada");
  await tick(8);
  // The boss bar shows the boss's own name (it always read "THE OVERLORD").
  await frames(6);
  const bar = await page.evaluate(() => document.querySelector("#boss-bar .bb-name").textContent);
  assert(bar === "THE DREADNOUGHT", `boss bar: ${bar}`);
  const r = await v((g) => {
    const boss = g.ufos.ufos.find((u) => u.boss);
    if (!boss) return { err: "no boss" };
    const out = { name: g.missions.bossInfo?.name, size: boss.size, shields: boss.shieldAt.length, pylons: g.ufos.ufos.filter((u) => u.pylon).length, hp: boss.maxHealth };
    out.blocked = g.ufos.damage(boss, 500, true) === false;
    const tickN = (n) => {
      for (let i = 0; i < n; i++) {
        g.missions.checkT = 0;
        g.missions.update(0.5);
      }
    };
    let jets = 0;
    for (let k = 0; k < 8 && !boss.falling; k++) {
      for (const p of g.ufos.ufos.filter((u) => u.pylon && !u.falling)) g.ufos.damage(p, 99999, true);
      for (let i = 0; i < 30; i++) g.ufos.update(0.1);
      tickN(6);
      jets = Math.max(jets, g.vehicles.vehicles.filter((j) => j.isEnemyJet && j.mission).length);
      g.ufos.damage(boss, boss.maxHealth * 0.3, true);
      tickN(2);
      jets = Math.max(jets, g.vehicles.vehicles.filter((j) => j.isEnemyJet && j.mission).length);
      (out.trace || (out.trace = [])).push(`r${boss.shieldRound} st${(g.missions.state.jets || []).length} v${g.vehicles.vehicles.filter((j) => j.isEnemyJet).length}`);
    }
    out.rounds = boss.shieldRound;
    out.jets = jets;
    boss.pos.y = Math.max(g.world.heightAt(Math.floor(boss.pos.x), Math.floor(boss.pos.z)) + 5, 5);
    for (let i = 0; i < 600 && boss.state !== "gone"; i++) g.ufos.update(0.1);
    out.flagship = g.stats.world.flagshipDown;
    g.progress.update(g.stats.world);
    out.done = g.progress.mission === null;
    return out;
  });
  assert(!r.err && r.name === "THE DREADNOUGHT" && r.size === "giant" && r.shields === 4 && r.pylons >= 4 && r.blocked, JSON.stringify(r));
  assert(r.rounds === 4 && r.jets >= 1 && r.flagship >= 1 && r.done, JSON.stringify(r));
  // The victory screen comes up a moment later.
  await page.waitForFunction(() => !document.getElementById("victory-screen").classList.contains("hidden"), null, { timeout: 15000 });
  const text = await page.evaluate(() => document.getElementById("victory-stats").textContent);
  assert(/UFOs shot down/.test(text), text);
  await page.click("#victory-btn");
  assert(await page.evaluate(() => document.getElementById("victory-screen").classList.contains("hidden")), "the button closes it");
  await v((g) => {
    g.ufos.clear();
    g.mobs.clear();
    for (const j of [...g.vehicles.vehicles]) if (j.isEnemyJet) g.vehicles.remove(j);
    g.progress.step = 0;
  });
  await play();
});

// ================= Part 4: Creative =================

await check("Creative call-ins: F-22, F-16, B-2 or a random UFO, straight into the air at the controls; Creative only", async () => {
  const r = await v((g) => {
    g.testFlags.noMissions = true;
    g.setMode("creative");
    g.setModsEnabled(true);
    if (g.vehicles.active) g.vehicles.exit({ force: true });
    const out = {};
    for (const k of ["f22", "f16", "b2", "ufo"]) {
      const ok = g.mp.game.callIn(k);
      const v = g.vehicles.active;
      const ground = g.world.heightAt(Math.floor(g.player.position.x), Math.floor(g.player.position.z));
      out[k] = { ok, type: v?.type, jet: v?.jetType, air: v ? Math.round(v.pos.y - ground) : 0, onGround: !!v?.onGround };
      if (v) {
        v.pos.copy(g.player.position).setY(Math.max(g.player.position.y, ground + 3));
        g.vehicles.exit({ force: true });
      }
    }
    // Each new call-in replaced the last one nobody sits in.
    out.left = g.vehicles.vehicles.filter((v) => v.calledIn).length;
    const pauseShows = () => !document.getElementById("pause-callins").classList.contains("hidden");
    g.mp.game.callIn; // (exists)
    document.getElementById("pause-menu").classList.remove("hidden");
    out.shownCreative = (() => {
      document.getElementById("pause-callins").classList.toggle("hidden", !g.player.creative);
      return pauseShows();
    })();
    g.setMode("survival");
    out.shownSurvival = pauseShows();
    out.survivalRefused = g.mp.game.callIn("f22") === false;
    document.getElementById("pause-menu").classList.add("hidden");
    g.setMode("creative");
    return out;
  });
  assert(r.f22.ok && r.f22.jet === "f22" && r.f22.air >= 40 && !r.f22.onGround, JSON.stringify(r));
  assert(r.f16.jet === "f16" && r.b2.jet === "b2" && r.b2.air >= 60 && r.ufo.type === "ufo" && r.ufo.air >= 30, JSON.stringify(r));
  assert(r.left <= 1 && r.shownCreative && !r.shownSurvival && r.survivalRefused, JSON.stringify(r));
  await play();
});

await check("switching Creative/Survival never touches the inventory (Creative's things stay, nothing is added)", async () => {
  const r = await v((g) => {
    g.setMode("survival");
    g.inventory.clear();
    g.inventory.slots[0] = { id: 271, count: 1 };
    const a = JSON.stringify(g.inventory.slots);
    g.setMode("creative");
    const b = JSON.stringify(g.inventory.slots);
    g.inventory.slots[5] = { id: 294, count: 1 }; // the railgun, taken from the palette
    const c = JSON.stringify(g.inventory.slots);
    g.setMode("survival");
    const d = JSON.stringify(g.inventory.slots);
    g.setMode("creative");
    return { same1: a === b, same2: c === d, rail: g.inventory.slots[5]?.id === 294 };
  });
  assert(r.same1 && r.same2 && r.rail, JSON.stringify(r));
});

// ================= Part 5: world and visuals =================

await check("terrain: about two thirds flat land, fewer mountains, the big ranges kept; the spawn is on flat, dry ground", async () => {
  const r = await v(async (g) => {
    const { TerrainGenerator } = await import("./js/terrain.js");
    const { SEA_LEVEL } = await import("./js/constants.js");
    const out = [];
    for (const seed of [42, 2024]) {
      const gen = new TerrainGenerator(seed);
      let land = 0;
      let flat = 0;
      let mount = 0;
      let max = 0;
      for (let x = -2400; x <= 2400; x += 60) {
        for (let z = -2400; z <= 2400; z += 60) {
          const h = gen.heightAt(x, z);
          if (h < SEA_LEVEL) continue;
          land++;
          let s = 0;
          for (const [dx, dz] of [[6, 0], [-6, 0], [0, 6], [0, -6]]) s = Math.max(s, Math.abs(gen.heightAt(x + dx, z + dz) - h));
          if (s <= 1) flat++;
          if (h > SEA_LEVEL + 35) mount++;
          max = Math.max(max, h);
        }
      }
      const [sx, sz] = gen.spawnColumn();
      const sh = gen.heightAt(sx, sz);
      let slope = 0;
      for (let dx = -3; dx <= 3; dx++) for (let dz = -3; dz <= 3; dz++) slope = Math.max(slope, Math.abs(gen.heightAt(sx + dx, sz + dz) - sh));
      out.push({ seed, flat: flat / land, mount: mount / land, max, slope, dry: sh > SEA_LEVEL + 1 });
    }
    return out;
  });
  for (const s of r) assert(s.flat > 0.58 && s.mount < 0.22 && s.max > 110 && s.slope <= 1 && s.dry, JSON.stringify(r));
});

await check("airport lights: only within the view distance, each fading with its distance into the fog (never pulled in over it)", async () => {
  const r = await v((g) => {
    const d = g.distant;
    // Night, so the lights are on.
    g.sky.setHours(23);
    d.night = 1;
    const cam = g.camera;
    d._t = 0;
    d.update(0.1, cam);
    const lit = [...d.entries.values()].filter((e) => e.lights);
    const fog = g.scene.fog;
    const out = {
      far: d._fade.uFadeFar.value === fog.far,
      near: d._fade.uFadeNear.value === fog.near,
      identity: lit.every((e) => e.lights.matrix.equals(new g.THREE.Matrix4())),
      inRange: lit.every((e) => Math.hypot(e.x - cam.position.x, e.z - cam.position.z) < Math.max(300, d.viewRange) * 1.1 + 600),
      shader: lit.every((e) => e.lights.material.customProgramCacheKey?.() === "airport-lights-fade"),
      n: lit.length,
    };
    g.sky.setHours(12);
    return out;
  });
  assert(r.far && r.near && r.identity && r.inRange && r.shader, JSON.stringify(r));
});

await check("no land creature spawns in water (fish do; a crew from a wreck in the sea may)", async () => {
  const r = await v(async (g) => {
    const { BLOCK } = await import("./js/blocks.js");
    const w = g.world;
    // A pool of water by the player.
    const p = g.player.position;
    const x = Math.floor(p.x) + 8;
    const z = Math.floor(p.z);
    const y = w.surfaceY(x, z) + 1;
    const list = [];
    for (let dx = -2; dx <= 2; dx++) for (let dz = -2; dz <= 2; dz++) for (let h = 0; h < 3; h++) list.push(x + dx, y + h, z + dz, BLOCK.WATER);
    w.setBlocks(list);
    const out = {
      cow: !!g.mobs.spawn("cow", x + 0.5, y, z + 0.5),
      zombie: !!g.mobs.spawn("zombie", x + 0.5, y + 1, z + 0.5),
      alien: !!g.mobs.spawn("alien", x + 0.5, y, z + 0.5),
      fish: !!g.mobs.spawn("fish", x + 0.5, y + 1, z + 0.5),
      crew: !!g.mobs.spawn("alien", x + 0.5, y + 1.5, z + 0.5, { wet: true }),
      dry: !!g.mobs.spawn("cow", Math.floor(p.x) + 0.5 - 8, w.surfaceY(Math.floor(p.x) - 8, Math.floor(p.z)) + 1, Math.floor(p.z) + 0.5),
    };
    const clear = [];
    for (let dx = -2; dx <= 2; dx++) for (let dz = -2; dz <= 2; dz++) for (let h = 0; h < 3; h++) clear.push(x + dx, y + h, z + dz, 0);
    w.setBlocks(clear);
    g.mobs.clear();
    return out;
  });
  assert(!r.cow && !r.zombie && !r.alien && r.fish && r.crew && r.dry, JSON.stringify(r));
});

await check("the blue alien's head is matte: its skin never glows (the suit's seams and the gun still do)", async () => {
  const r = await v(async () => {
    const { skinCanvas } = await import("./js/mob-models.js");
    const c = skinCanvas("alien_blue");
    const data = c.getContext("2d").getImageData(0, 0, c.width, c.height).data;
    let matte = 0;
    let glowing = 0;
    for (let i = 0; i < data.length; i += 4) {
      if (data[i + 3] === 0) continue;
      if (data[i + 3] < 252) matte++;
      else if (Math.max(data[i], data[i + 1], data[i + 2]) > 200) glowing++;
    }
    // (The other aliens are untouched: no matte texels in the green one's skin.)
    const gc = skinCanvas("alien");
    const gd = gc.getContext("2d").getImageData(0, 0, gc.width, gc.height).data;
    let green = 0;
    for (let i = 3; i < gd.length; i += 4) if (gd[i] > 0 && gd[i] < 252) green++;
    return { matte, glowing, green };
  });
  assert(r.matte > 200 && r.glowing > 10 && r.green === 0, JSON.stringify(r));
});

// ---------- Summary ----------
const failed = results.filter(([, ok]) => !ok);
console.log(`\n${results.length - failed.length} passed, ${failed.length} failed${errors.length ? `; console errors: ${errors.length}` : ""}.`);
if (errors.length) console.log(errors.slice(0, 5).join("\n"));
await browser.close();
server.close();
process.exit(failed.length || errors.length ? 1 : 0);
