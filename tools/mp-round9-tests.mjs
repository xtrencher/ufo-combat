// Round 9 multiplayer review: a host and two guests in three headless pages
// (real PeerJS + WebRTC through a local signaling server, like mp-tests.mjs).
// Checks the Round 9 features online, for the host and the guests alike:
// missions 18-20 with guests (Big game, Operation Sunburn, Steal the ship),
// the goals for three players, respawning around a mission, Creative
// call-ins, switching modes (inventories untouched), and creature spawning
// around every player (never a land creature in water). The damage matrix
// itself is mp-damage-tests.mjs.
//
//   node mp-round9-tests.mjs [--only=substring] [--seed=42] [--verbose]
//
// Fails on any failed check or console error.
import http from "node:http";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";
import express from "express";
import { ExpressPeerServer } from "peer";

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
const PORT = 9500 + Math.floor(Math.random() * 40);
const PEER_PORT = PORT + 50;
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
await new Promise((r) => server.listen(PORT, "127.0.0.1", r));
const app = express();
const peerHttp = app.listen(PEER_PORT, "127.0.0.1");
app.use("/ufo", ExpressPeerServer(peerHttp, { path: "/" }));

const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome",
  args: ["--use-gl=swiftshader", "--enable-webgl", "--ignore-gpu-blocklist", "--no-sandbox", "--disable-dev-shm-usage", "--disable-features=WebRtcHideLocalIpsWithMdns", "--autoplay-policy=no-user-gesture-required"],
});
const errors = [];
const results = [];
const localThreeRoot = path.join(__dirname, "node_modules", "three");
const peerjsFile = path.join(__dirname, "node_modules", "peerjs", "dist", "peerjs.min.js");

async function newPage(label) {
  const ctx = await browser.newContext({ viewport: { width: 640, height: 360 } });
  const page = await ctx.newPage();
  await page.route("https://cdn.jsdelivr.net/npm/three@0.160.0/**", (route) => {
    const rel = new URL(route.request().url()).pathname.replace("/npm/three@0.160.0/", "");
    route.fulfill({ path: path.join(localThreeRoot, rel), contentType: "text/javascript" });
  });
  await page.route("https://cdn.jsdelivr.net/npm/peerjs@1.5.4/**", (route) => route.fulfill({ path: peerjsFile, contentType: "text/javascript" }));
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(`[${label}] ${m.text()}`);
    if (args.verbose) console.log(`    [${label}] ${m.text()}`);
  });
  page.on("pageerror", (e) => errors.push(`[${label}] ${String(e)}`));
  page.on("dialog", (d) => d.accept());
  page.label = label;
  return page;
}
const v = (page, fn, arg) => page.evaluate(([src, a]) => new Function("g", "arg", `return (${src})(g, arg);`)(window.__ufo, a), [fn.toString(), arg]);
async function until(page, fn, timeout = 30000, arg) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeout) {
    const r = await v(page, fn, arg);
    if (r) return r;
    await new Promise((res) => setTimeout(res, 100));
  }
  return null;
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const NET_Q = `peerServer=127.0.0.1:${PEER_PORT}/ufo&noStun=1&graphics=low`;
function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}
async function check(name, fn) {
  if (args.only && !name.toLowerCase().includes(String(args.only).toLowerCase())) return;
  const t0 = Date.now();
  const before = errors.length;
  try {
    await fn();
    if (errors.length > before) throw new Error(`console errors: ${errors.slice(before, before + 3).join(" | ")}`);
    results.push([name, true]);
    console.log(`  PASS  ${name} (${((Date.now() - t0) / 1000).toFixed(1)}s)`);
  } catch (err) {
    results.push([name, false]);
    console.log(`  FAIL  ${name}: ${err.message}`);
  }
}

async function play(page) {
  if ((await v(page, (g) => g.gameState)) === "playing") return;
  for (const id of ["mp-lobby", "mp-screen"]) await page.evaluate((i) => document.getElementById(i).classList.add("hidden"), id);
  await v(page, (g) => g.screens.closeAll());
  if ((await v(page, (g) => g.gameState)) === "dead") await v(page, (g) => g.respawn());
  if ((await v(page, (g) => g.gameState)) === "paused") await page.evaluate(() => document.getElementById("pause-menu").classList.remove("hidden"));
  const st = await v(page, (g) => g.gameState);
  if (st === "playing") return;
  if (!(await page.isVisible("#click-to-play").catch(() => false))) {
    const btn = st === "start" ? "#play-btn" : "#resume-btn";
    await page.click(btn, { timeout: 60000 });
  } else await page.click("#click-to-play", { timeout: 20000 });
  await page.waitForFunction(() => window.__ufo.gameState === "playing", null, { timeout: 30000 });
}

// No pictures needed: three worlds drawn in software would slow the game to
// a crawl. The scene's matrices still update (hit tests use them).
function noDraw() {
  const rr = window.__ufo.renderer;
  if (rr && !rr.__noDraw) {
    rr.__noDraw = true;
    rr.render = (scene, camera) => {
      scene?.updateMatrixWorld?.();
      camera?.updateMatrixWorld?.();
    };
  }
  return true;
}

// ---------- Setup: a host and two guests ----------
const host = await newPage("host");
await host.goto(`http://127.0.0.1:${PORT}/index.html?seed=${SEED}&${NET_Q}`, { waitUntil: "load", timeout: 60000 });
await host.waitForFunction(() => window.__ufo?.graphicsReady, null, { timeout: 120000 });
await host.click("#menu-mp-btn");
await host.fill("#mp-nick", "Alice");
await host.click("#mp-host-btn");
const code = await until(host, (g) => g.net.code, 30000);
await host.click("#mp-lobby-play");
await host.waitForFunction(() => window.__ufo.gameState === "playing", null, { timeout: 30000 });
await v(host, noDraw);
const guests = [];
for (const nick of ["Bob", "Cleo"]) {
  const p = await newPage(nick.toLowerCase());
  await p.goto(`http://127.0.0.1:${PORT}/index.html?join=${code}&${NET_Q}`, { waitUntil: "load", timeout: 60000 });
  await p.waitForSelector("#mp-join-boot:not(.hidden)", { timeout: 30000 });
  await p.fill("#mp-boot-nick", nick);
  await p.click("#mp-boot-join");
  await p.waitForFunction(() => window.__ufo?.graphicsReady && window.__ufo.mp.stateLoaded, null, { timeout: 120000 });
  await play(p);
  await v(p, noDraw);
  guests.push(p);
}
const [g1, g2] = guests;
const PIDS = [await v(g1, (g) => g.net.pid), await v(g2, (g) => g.net.pid)];
console.log(`  joined: room ${code}, guests ${PIDS.join(", ")}`);
const all = [host, g1, g2];

// Survival, no random UFOs or creatures, midday; everyone at the spawn.
await v(host, (g) => {
  g.mp.rules.setMode("survival");
  g.ufos.config.activity = 0;
  g.mobs.spawning = false;
  g.enemyJets.config.count = 0;
  g.sky.setHours(12);
  g.sky.locked = true;
  g.nuke.config.size = 24;
  return true;
});
for (const p of all) await v(p, (g) => (g.nuke.config.size = 24));
await until(g2, (g) => g.player.mode === "survival", 10000);

// Everyone to (x, z) (on the ground), and the guests' world there.
async function gather(x, z) {
  for (const [i, p] of all.entries()) {
    await v(p, (g, a) => {
      if (g.player.dead) g.respawn();
      if (g.vehicles.active) g.vehicles.exit({ force: true });
      g.player.flying = false;
      g.mp.game.teleport(a.x + a.i * 3, null, a.z);
      return true;
    }, { x, z, i });
  }
  for (const p of [g1, g2]) await until(p, (g, a) => !!g.world.getChunk(Math.floor(a.x) >> 4, Math.floor(a.z) >> 4), 30000, { x, z });
  await sleep(800);
}

// The host starts mission `id` of the chain (the director sets it up).
const startMission = (id) =>
  v(host, async (g, id) => {
    const { MISSIONS } = await import("./js/progression.js");
    g.testFlags.noMissions = false;
    g.progress.enabled = true;
    g.missions.enabled = true;
    g.ufos.clear();
    for (const j of [...g.vehicles.vehicles]) if (j.isEnemyJet) g.vehicles.remove(j);
    g.progress.step = MISSIONS.findIndex((m) => m.id === id);
    g.progress.base = { ...g.progress._pick(g.stats.world) };
    g.missions.state = { t: 0 };
    g.missions.missionId = id;
    g.missions.base = null;
    return g.progress.mission?.id;
  }, id);
const tick = (n = 4) =>
  v(host, (g, n) => {
    for (let i = 0; i < n; i++) {
      g.missions.checkT = 0;
      g.missions.update(0.5);
    }
    return true;
  }, n);

const spawn = await v(host, (g) => [g.spawn.x, g.spawn.z]);
await gather(spawn[0] + 0.5, spawn[1] + 0.5);

// ================= Checks =================

await check("three players: the goals grow with the group, and every guest sees the same objectives", async () => {
  await startMission("big_game");
  await tick(2);
  const h = await v(host, (g) => ({ n: g.progress.groupN, step: g.progress.step, goal: g.progress.objectives(g.stats.world)[0]?.goal }));
  // (Once the host's state for this mission has reached them.)
  const gs = [];
  for (const p of [g1, g2]) gs.push(await until(p, (g, step) => g.progress.step === step && (g.progress.objectives(g.stats.world)[0]?.goal ?? 0), 10000, h.step));
  assert(h.n === 3 && h.goal === 2 && gs.every((x) => x === h.goal), JSON.stringify({ h, gs }));
});

await check("mission 18 (Big game) online: one large UFO, the same ship on every screen; a guest's hits land; near only a guest it stays (leashed to them)", async () => {
  await tick(8);
  const big = await v(host, (g) => {
    const u = g.missions.state.big;
    return u ? { id: u.id, hp: u.health, max: u.maxHealth } : null;
  });
  assert(big, "a large UFO");
  for (const p of [g1, g2]) assert(await until(p, (g, id) => g.mp.entities.ufoById.has(id), 15000, big.id), `${p.label} sees it`);
  // Bob hits it with 50.
  await v(g1, (g, id) => {
    const u = g.mp.entities.ufoById.get(id);
    g.ufos.damage(u, 50, true, u.pos.clone());
    return true;
  }, big.id);
  const hp = await until(host, (g, a) => {
    const u = g.missions.state.big;
    return u && u.health <= a.hp - 49 && u.health;
  }, 8000, big);
  assert(hp, "the host's ship took Bob's 50");
  await sleep(1200);
  const seen = [];
  for (const p of [g1, g2]) seen.push(await v(p, (g, id) => Math.round(g.mp.entities.ufoById.get(id)?.health ?? -1), big.id));
  assert(seen.every((x) => Math.abs(x - hp) <= 2), `health on every screen: host ${hp}, guests ${seen}`);
  // Cleo far away (2 km), the ship near her and far from the host: it stays, its home follows her.
  const far = await v(host, (g) => [g.player.position.x + 2000, g.player.position.z]);
  await v(g2, (g, a) => {
    g.player.flying = true;
    g.mp.game.teleport(a[0], 110, a[1]);
    return true;
  }, far);
  await sleep(1500);
  const r = await v(host, (g, a) => {
    const u = g.missions.state.big;
    u.pos.set(a[0] + 40, u.pos.y, a[1]);
    for (let i = 0; i < 20; i++) g.ufos.update(0.1);
    for (let i = 0; i < 6; i++) {
      g.missions.checkT = 0;
      g.missions.update(0.5);
    }
    return { same: g.missions.state.big === u && g.ufos.ufos.includes(u), hp: u.health, home: u.home ? Math.round(Math.hypot(u.home.x - a[0], u.home.z - a[1])) : -1, larges: g.ufos.ufos.filter((x) => x.S.idx >= 2 && !x.falling && x.missionTarget).length }; // (the mission's own: a random large UFO near the far guest is not a replacement)
  }, far);
  assert(r.same && r.hp === hp && r.home >= 0 && r.home < 30 && r.larges === 1, JSON.stringify(r));
  await v(g2, (g) => (g.player.flying = false));
  await gather(spawn[0] + 0.5, spawn[1] + 0.5);
});

await check("mission 19 (Operation Sunburn) online: the base is marked for the guests too; a guest's nuke on it completes the mission", async () => {
  await startMission("sunburn");
  await tick(4);
  const base = await v(host, (g) => g.missions.base && [g.missions.base.x, g.missions.base.y, g.missions.base.z]);
  assert(base, "an enemy base");
  for (const p of [g1, g2]) assert(await until(p, (g) => !!g.missions.target, 10000), `${p.label} has the marker`);
  // Bob's nuke goes off on the base (flown there, as the B-2's would).
  await v(g1, (g, b) => {
    g.player.flying = true;
    g.mp.game.teleport(b[0] + 200, b[1] + 60, b[2]);
    return true;
  }, base);
  await sleep(1500);
  await v(g1, (g, b) => {
    g.nuke.detonate(new g.THREE.Vector3(b[0], b[1] + 1, b[2]), {});
    return true;
  }, base);
  const done = await until(host, (g) => (g.stats.world.airportsNuked ?? 0) > 0 && (g.progress.update(g.stats.world), g.progress.mission?.id !== "sunburn") && g.progress.mission?.id, 20000);
  assert(done === "steal", `next mission: ${done}`);
  await v(g1, (g) => (g.player.flying = false));
});

await check("mission 20 (Steal the ship) online: one ship on every screen; a guest boards it; lost after boarding, one new ship for everyone", async () => {
  // (Everyone at the spawn: the director picks the bunker nearest to the group.)
  await gather(spawn[0] + 0.5, spawn[1] + 0.5);
  await startMission("steal");
  await tick(1);
  const site = await v(host, (g) => {
    const best = g.missions.state.site;
    if (!best) return null;
    const spot = g.sites.bunkerSpots(best)[0];
    return { hall: [spot.x, spot.y, spot.z], zone: [spot.zone.x, spot.zone.z] };
  });
  if (!site) {
    console.log("        (no airport with a bunker near this seed: skipped)");
    return;
  }
  await gather(site.zone[0] + 70, site.zone[1]);
  for (const p of all) await v(p, (g, s) => (g.world.prepareArea(s.hall[0], s.hall[2], 3), true), site);
  const count = (p) =>
    v(p, (g, h) => {
      g.airports.timer = 0;
      g.airports.update(1);
      return g.vehicles.vehicles.filter((v) => v.type === "ufo" && v.alive && Math.hypot(v.pos.x - h[0], v.pos.z - h[2]) < 60).length;
    }, site.hall);
  for (let i = 0; i < 10; i++) {
    for (const p of all) await count(p);
    await tick(1);
    await sleep(200);
  }
  const first = [];
  for (const p of all) first.push(await count(p));
  assert(first.every((n) => n === 1), `one ship on every screen: ${first}`);
  assert(await v(host, (g) => !!g.missions.state.ship), "the mission picked it");
  // Bob boards his copy: the others' copies go, his comes to them.
  const boarded = await v(g1, (g, h) => {
    const s = g.vehicles.vehicles.find((v) => v.type === "ufo" && v.alive && Math.hypot(v.pos.x - h[0], v.pos.z - h[2]) < 60);
    g.player.position.copy(s.pos);
    return g.vehicles.enter(s) !== false && g.vehicles.active === s;
  }, site.hall);
  assert(boarded, "Bob is in");
  await sleep(2000);
  await tick(2);
  const aboard = [];
  for (const p of all) aboard.push(await count(p));
  const hostShip = await v(host, (g) => ({ ship: !!g.missions.state.ship, puppet: !!g.missions.state.ship?.puppet, locked: !!g.missions.state.locked }));
  assert(aboard.every((n) => n === 1) && hostShip.puppet && hostShip.locked, JSON.stringify({ aboard, hostShip }));
  // The ship is lost: one new ship comes, for everyone.
  await v(g1, (g) => {
    const s = g.vehicles.active;
    g.vehicles.exit({ force: true });
    s.damage(99999, "explosion");
    return true;
  });
  for (let i = 0; i < 16; i++) {
    await tick(1);
    for (const p of all) await count(p);
    await sleep(250);
  }
  const after = [];
  for (const p of all) after.push(await count(p));
  assert(after.every((n) => n === 1), `one new ship on every screen: ${after}`);
  await gather(spawn[0] + 0.5, spawn[1] + 0.5);
});

await check("respawning during a mission online: a guest who dies comes back around the mission's location", async () => {
  await startMission("village");
  await tick(4);
  const place = await v(host, (g) => g.missions.respawnPlace());
  assert(place, "a place");
  // (Once the host's state for this mission has reached Bob.)
  const got = await until(g1, (g, pl) => {
    const r = g.mp.coop.respawnPlace();
    return r && Math.abs(r.x - pl.x) <= 4 && Math.abs(r.z - pl.z) <= 4;
  }, 10000, place);
  assert(got, "Bob has the mission's place");
  const r = await v(g1, (g, pl) => {
    g.player.damage(9999, "fall", { pierce: true });
    g.respawn();
    const p = g.player.position;
    return { d: Math.round(Math.hypot(p.x - pl.x, p.z - pl.z)), r: pl.r };
  }, place);
  assert(r.d >= r.r - 6 && r.d <= r.r * 2.5 + 50, JSON.stringify(r));
  await play(g1);
  await v(host, (g) => {
    g.testFlags.noMissions = true;
    g.missions.enabled = false;
    g.progress.enabled = false;
    g.ufos.clear();
    g.mobs.clear();
    return true;
  });
  await gather(spawn[0] + 0.5, spawn[1] + 0.5);
});

await check("Creative call-ins online: a guest's F-16 and the host's UFO appear in the air on every screen, flown by their caller", async () => {
  await v(host, (g) => (g.mp.rules.setMode("creative"), true));
  await until(g1, (g) => g.player.creative, 10000);
  await until(g2, (g) => g.player.creative, 10000);
  const a = await v(g1, (g) => g.mp.game.callIn("f16") && g.vehicles.active?.jetType);
  const b = await v(host, (g) => g.mp.game.callIn("ufo") && g.vehicles.active?.type);
  assert(a === "f16" && b === "ufo", JSON.stringify({ a, b }));
  const onHost = await until(host, (g, pid) => {
    const j = g.vehicles.vehicles.find((v) => v.puppet && v.jetType === "f16" && v.netOcc === pid);
    if (!j) return null;
    return Math.round(j.pos.y - g.world.heightAt(Math.floor(j.pos.x), Math.floor(j.pos.z)));
  }, 15000, PIDS[0]);
  const onCleo = await until(g2, (g) => {
    const s = g.vehicles.vehicles.find((v) => v.puppet && v.type === "ufo" && v.netOcc === 1);
    const j = g.vehicles.vehicles.find((v) => v.puppet && v.jetType === "f16");
    return s && j ? Math.round(s.pos.y - g.world.heightAt(Math.floor(s.pos.x), Math.floor(s.pos.z))) : null;
  }, 15000);
  assert(onHost >= 30 && onCleo >= 25, JSON.stringify({ onHost, onCleo }));
  for (const p of [host, g1]) await v(p, (g) => (g.vehicles.exit({ force: true }), true));
});

await check("switching modes online never touches anyone's inventory (Creative's things stay)", async () => {
  const before = [];
  for (const p of [g1, g2]) {
    before.push(
      await v(p, (g) => {
        g.inventory.slots[8] = { id: 294, count: 1 }; // (taken from the palette in Creative)
        g.mp.game.markInventoryChanged();
        return JSON.stringify(g.inventory.slots);
      })
    );
  }
  await v(host, (g) => (g.mp.rules.setMode("survival"), true));
  for (const p of [g1, g2]) await until(p, (g) => !g.player.creative, 10000);
  await sleep(500);
  const after = [];
  for (const p of [g1, g2]) after.push(await v(p, (g) => JSON.stringify(g.inventory.slots)));
  assert(after[0] === before[0] && after[1] === before[1], "the inventories are as they were");
});

await check("creature spawning online: creatures come around every player, never a land creature in water", async () => {
  // Bob and Cleo each about 300 blocks off, on dry land: the host spawns around each of them.
  const at = await v(host, (g) => {
    const T = g.world.terrain;
    const out = [[g.spawn.x + 0.5, g.spawn.z + 0.5]];
    for (const R of [300, 240, 360, 200, 420]) {
      for (let k = 0; k < 72 && out.length < 3; k++) {
        const a = (k / 72) * Math.PI * 2;
        const x = Math.floor(g.spawn.x + Math.cos(a) * R);
        const z = Math.floor(g.spawn.z + Math.sin(a) * R);
        let dry = true;
        for (let dx = -24; dx <= 24 && dry; dx += 8) for (let dz = -24; dz <= 24 && dry; dz += 8) if (T.heightAt(x + dx, z + dz) <= 26) dry = false; // (sea level 24)
        if (dry && out.every(([ox, oz]) => Math.hypot(ox - x, oz - z) > 200)) out.push([x + 0.5, z + 0.5]);
      }
    }
    return out;
  });
  assert(at.length === 3, `dry land for everyone: ${JSON.stringify(at)}`);
  for (const [i, p] of all.entries()) {
    await v(p, (g, a) => {
      g.player.flying = false;
      g.mp.game.teleport(a[0], null, a[1]);
      return true;
    }, at[i]);
  }
  // (The host keeps the ground around the others generated; their positions reached it.)
  const ready = await until(host, (g, at) => {
    const ps = g.mp.entities.targets().map((t) => t.position);
    const ground = ([x, z]) => {
      for (let dz = -3; dz <= 3; dz++) for (let dx = -3; dx <= 3; dx++) if (!g.world.getChunk((Math.floor(x) >> 4) + dx, (Math.floor(z) >> 4) + dz)) return false;
      return true;
    };
    return at.every(([x, z]) => ground([x, z]) && ps.some((p) => Math.hypot(p.x - x, p.z - z) < 8));
  }, 45000, at);
  assert(ready, "the host has the ground around everyone");
  const r = await v(host, (g, at) => {
    const w = g.world;
    const wetAt = (x, y, z) => w.getBlock(Math.floor(x), Math.floor(y + 0.05), Math.floor(z)) === 5;
    const born = [];
    const orig = g.mobs.spawn;
    g.mobs.spawn = function (kind, x, y, z, o) {
      const m = orig.call(this, kind, x, y, z, o);
      if (m && !m.spec.flies && !m.spec.swims) born.push({ kind, x: m.pos.x, z: m.pos.z, wet: wetAt(m.pos.x, m.pos.y, m.pos.z) || wetAt(m.pos.x, m.pos.y + m.spec.h * 0.5, m.pos.z) });
      return m;
    };
    g.mobs.clear();
    g.mobs.spawning = true;
    g.mobs.hostileSpawning = true;
    g.sky.setHours(23);
    try {
      for (let i = 0; i < 1500; i++) g.mobs.update(0.05);
    } finally {
      g.mobs.spawn = orig;
      g.mobs.spawning = false;
      g.sky.setHours(12);
    }
    const near = at.map(([x, z]) => born.filter((b) => Math.hypot(b.x - x, b.z - z) < 140).length);
    return { n: born.length, near, wet: born.filter((b) => b.wet).map((b) => b.kind), fish: g.mobs.mobs.filter((m) => m.kind === "fish").length };
  }, at);
  assert(r.n >= 5 && r.near.every((k) => k > 0) && r.wet.length === 0, JSON.stringify(r));
  await gather(spawn[0] + 0.5, spawn[1] + 0.5);
});

// ---------- Summary ----------
const failed = results.filter(([, ok]) => !ok);
console.log(`\n${results.length - failed.length} passed, ${failed.length} failed${errors.length ? `; console errors: ${errors.length}` : ""}.`);
if (errors.length) console.log(errors.slice(0, 6).join("\n"));
await browser.close();
peerHttp.close();
server.close();
process.exit(failed.length || errors.length ? 1 : 0);
