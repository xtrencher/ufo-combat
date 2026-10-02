// Round 2 feature tests: boots the real game in headless Chromium (software
// WebGL, Low preset) and checks the Round 2 features (bug fixes, weapons,
// vehicles, UFOs and aliens, the world, survival and the menu):
//
//   node round2-tests.mjs [--only=substring] [--from=substring] [--seed=42]
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
const PORT = 9040 + Math.floor(Math.random() * 40);
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
async function until(fn, timeout = 60000, arg) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeout) {
    const r = await v(fn, arg);
    if (r) return r;
    await frames(2);
  }
  return null;
}

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
async function boot(query = "") {
  await page.goto(`http://localhost:${PORT}/index.html?seed=${SEED}${query}`, { waitUntil: "load", timeout: 60000 });
  await page.waitForFunction(() => !!window.__ufo, null, { timeout: 60000 });
}
await boot();
await page.evaluate(() => window.__ufo.setGraphics("low"));
await page.waitForFunction(() => window.__ufo.graphicsReady, null, { timeout: 120000 });

async function play() {
  if ((await v((g) => g.gameState)) === "dead") await v((g) => g.respawn());
  if ((await v((g) => g.gameState)) === "playing") return;
  // (After a respawn the game waits for the mouse, with no menu showing.)
  for (let k = 0; k < 3 && !(await page.isVisible("#resume-btn")) && (await v((g) => g.gameState)) === "paused"; k++) {
    await page.mouse.click(480, 270);
    await frames(5);
    if ((await v((g) => g.gameState)) === "playing") return;
  }
  if ((await v((g) => g.gameState)) === "paused" && !(await page.isVisible("#resume-btn"))) await page.evaluate(() => document.getElementById("pause-menu").classList.remove("hidden"));
  const btn = (await v((g) => g.gameState)) === "start" ? "#play-btn" : "#resume-btn";
  await page.click(btn, { timeout: 60000 });
  await page.waitForFunction(() => window.__ufo.gameState === "playing", null, { timeout: 30000 });
}

// Sets up an open, flat area high above the terrain (nothing in the way of
// rays or flight) and puts the player in it.
async function skyArena() {
  await v((g) => {
    g.setMode("creative");
    // Back on the land at the start (an earlier check may have left the player at sea).
    g.player.spawnAt(g.spawn.x, g.spawn.z);
    g.player.recoil = 0;
    g.player.velocity.set(0, 0, 0);
    g.ufos.config.activity = 0;
    g.mobs.spawning = false;
    g.mobs.hostileSpawning = false;
    g.ufos.clear();
    g.mobs.clear();
    // The land around (far things only move where the ground is loaded).
    const p = g.player.position;
    g.world.prepareArea(p.x, p.z, 8);
  });
}

// A flat stone pad (and air above it) around the player: returns the pad's top y.
async function flatPad(halfX = 14, halfZ = 60, y = null) {
  return v((g, a) => {
    const p = g.player.position;
    const y0 = a.y ?? Math.floor(p.y) + 3;
    const list = [];
    const cx = Math.floor(p.x);
    const cz = Math.floor(p.z);
    g.world.prepareArea(p.x, p.z, 6);
    for (let dz = -a.hz; dz <= a.hz; dz++) {
      for (let dx = -a.hx; dx <= a.hx; dx++) {
        list.push(cx + dx, y0, cz + dz, 1);
        for (let h = 1; h <= 8; h++) list.push(cx + dx, y0 + h, cz + dz, 0);
      }
    }
    g.world.setBlocks(list);
    p.y = y0 + 1.5;
    return y0;
  }, { hx: halfX, hz: halfZ, y });
}

if (args.from || args.only) {
  await play();
  await v((g) => g.setGraphics("low"));
}

// ================= Part 1: critical bug fixes =================

await check("settings persist across a reload (every group), and defaults never overwrite them", async () => {
  await v((g) => {
    // (Round 6: the rule settings are Creative's; in Survival the game uses their defaults, so this check runs in Creative.)
    g.setMode("creative");
    const s = g.settingsPanel;
    s.set("fov", 92);
    s.set("sensitivity", 2.5);
    s.set("invertY", true);
    s.set("showFps", false);
    s.set("difficulty", "hard");
    s.set("mobSpawning", false);
    s.set("timeLocked", true);
    s.set("binocularZoom", 9);
    s.set("explosionScale.bazooka", 1.7);
    s.set("weapons.blasterColor", "blue");
    s.set("weapons.nukeSize", 40);
    s.set("zombies.max", 24);
    s.set("ufos.activity", 4);
    s.set("ufos.aggression", 0.5);
    s.set("vehicles.jetMaxSpeed", 210);
    s.set("vehicles.jetAssist", false);
    s.set("perf.lodQuality", "high");
    s.set("perf.effects", "medium");
    s.set("perf.detailDistance", 5);
    g.settings.volume.master = 0.4;
    g.settings.volume.weapons = 0.7;
    g.setRenderDistance(14);
    g.setGraphics("medium", { userPick: true });
    g.settings.gfxOverrides = { shadows: "off" };
    g.settingsPanel.save();
  });
  const before = await v((g) => JSON.parse(localStorage.getItem("ufocombat_v1_settings")));
  await boot();
  await page.waitForFunction(() => window.__ufo.graphicsReady, null, { timeout: 120000 });
  await v((g) => g.setMode("creative"));
  const after = await v((g) => ({
    fov: g.settings.fov,
    sens: g.settings.sensitivity,
    inv: g.settings.invertY,
    fps: g.settings.showFps,
    diff: g.settings.difficulty,
    spawn: g.settings.mobSpawning,
    lock: g.settings.timeLocked,
    bino: g.settings.binocularZoom,
    baz: g.settings.explosionScale.bazooka,
    blaster: g.settings.weapons.blasterColor,
    nuke: g.settings.weapons.nukeSize,
    zmax: g.settings.zombies.max,
    ufo: g.settings.ufos.activity,
    aggr: g.settings.ufos.aggression,
    jet: g.settings.vehicles.jetMaxSpeed,
    assist: g.settings.vehicles.jetAssist,
    lod: g.settings.perf.lodQuality,
    fx: g.settings.perf.effects,
    detail: g.settings.perf.detailDistance,
    vol: [g.settings.volume.master, g.settings.volume.weapons],
    rd: g.renderDistance,
    gfx: g.graphics,
    overrides: g.settings.gfxOverrides,
    // Applied to the running game too, not just stored:
    live: { fov: g.player.baseFov, sens: g.player.mouseSensitivity, inv: g.player.invertY, jetMax: g.vehicles.config.jet.maxSpeed, zombieMax: g.mobs.zombies.max, blaster: g.weapons.blasterColor, lockTime: g.sky.locked, ufoAct: g.ufos.config.activity },
    // The setting screen's controls show them:
    ui: { fov: document.getElementById("fov").value, diff: document.getElementById("difficulty").value, rd: document.getElementById("render-distance").value, preset: document.getElementById("graphics-preset").value },
  }));
  assert(after.fov === 92 && after.sens === 2.5 && after.inv === true && after.fps === false, `controls ${JSON.stringify(after)}`);
  assert(after.diff === "hard" && after.spawn === false && after.lock === true && after.bino === 9, `gameplay ${JSON.stringify(after)}`);
  assert(after.baz === 1.7 && after.blaster === "blue" && after.nuke === 40 && after.zmax === 24, `weapons/mobs ${JSON.stringify(after)}`);
  assert(after.ufo === 4 && after.aggr === 0.5 && after.jet === 210 && after.assist === false, `ufos/vehicles ${JSON.stringify(after)}`);
  assert(after.lod === "high" && after.fx === "medium" && after.detail === 5, `performance ${JSON.stringify(after)}`);
  assert(after.vol[0] === 0.4 && after.vol[1] === 0.7 && after.rd === 14 && after.gfx === "medium", `audio/graphics ${JSON.stringify(after)}`);
  assert(after.overrides.shadows === "off", `graphics options ${JSON.stringify(after.overrides)}`);
  assert(after.live.fov === 92 && after.live.sens === 2.5 && after.live.inv === true && after.live.jetMax === 210 && after.live.zombieMax === 24 && after.live.blaster === "blue" && after.live.lockTime === true && after.live.ufoAct === 4, `applied live ${JSON.stringify(after.live)}`);
  assert(after.ui.fov === "92" && after.ui.diff === "hard" && after.ui.rd === "14" && after.ui.preset === "medium", `ui ${JSON.stringify(after.ui)}`);
  assert(before.fov === 92, "saved");
});

await check("settings survive a reload during shader preparation, a lost graphics context, and a hung start", async () => {
  // 1. Reloading while the graphics are still being prepared must not lower the preset.
  await v((g) => g.setGraphics("high", { userPick: true }));
  await page.reload({ waitUntil: "load" });
  await page.waitForFunction(() => !!window.__ufo, null, { timeout: 60000 });
  const s1 = await v((g) => ({ saved: JSON.parse(localStorage.getItem("ufocombat_v1_settings")).graphics, now: g.graphics, boot: JSON.parse(localStorage.getItem("ufocombat_v1_boot")) }));
  assert(s1.saved === "high" && s1.now === "high", `a reload during preparation: ${JSON.stringify(s1)}`);
  // 2. A start that really never drew (a hang) lowers this session only.
  await page.evaluate(() => localStorage.setItem("ufocombat_v1_boot", JSON.stringify({ preset: "high", ok: false })));
  await page.reload({ waitUntil: "load" });
  await page.waitForFunction(() => !!window.__ufo, null, { timeout: 60000 });
  await page.evaluate(() => window.__ufo.setGraphics("low"));
  const s2 = await v(() => ({ saved: JSON.parse(localStorage.getItem("ufocombat_v1_settings")).graphics }));
  // (setGraphics("low") above is the test's own speed-up: it is a picked preset and is saved.)
  await page.waitForFunction(() => window.__ufo.graphicsReady, null, { timeout: 120000 });
  await frames(6);
  await page.evaluate(() => localStorage.setItem("ufocombat_v1_boot", JSON.stringify({ preset: "high", ok: false })));
  await page.evaluate(() => {
    const s = JSON.parse(localStorage.getItem("ufocombat_v1_settings"));
    s.graphics = "high";
    localStorage.setItem("ufocombat_v1_settings", JSON.stringify(s));
  });
  await page.reload({ waitUntil: "load" });
  await page.waitForFunction(() => !!window.__ufo, null, { timeout: 60000 });
  const s3 = await v((g) => ({ saved: JSON.parse(localStorage.getItem("ufocombat_v1_settings")).graphics, now: g.graphics, notice: document.getElementById("start-notice").textContent }));
  assert(s3.saved === "high" && s3.now === "medium" && /lowered/.test(s3.notice), `hung start: ${JSON.stringify(s3)} (${JSON.stringify(s2)})`);
  // Changing the settings now saves the real choice, not the lowered one.
  await v((g) => g.settingsPanel.set("fov", 80));
  const s4 = await v(() => JSON.parse(localStorage.getItem("ufocombat_v1_settings")).graphics);
  assert(s4 === "high", `saving other settings keeps the saved preset: ${s4}`);
  // 3. Back to a fast preset and otherwise default settings for the rest (the settings above were saved on purpose).
  await page.evaluate(() => {
    localStorage.removeItem("ufocombat_v1_boot");
    localStorage.setItem("ufocombat_v1_settings", JSON.stringify({ graphics: "low" }));
  });
  await page.addInitScript(() => {
    // (The page saves its settings as it unloads: put the clean ones back first thing in the new page.)
    if (!sessionStorage.getItem("__clean")) {
      localStorage.setItem("ufocombat_v1_settings", JSON.stringify({ graphics: "low" }));
      sessionStorage.setItem("__clean", "1");
    }
  });
  await boot();
  await page.waitForFunction(() => window.__ufo.graphicsReady, null, { timeout: 120000 });
  const clean = await v((g) => ({ diff: g.settings.difficulty, spawn: g.settings.mobSpawning, gfx: g.graphics, lock: g.settings.timeLocked }));
  assert(clean.diff === "normal" && clean.spawn === true && !clean.lock, `clean settings again: ${JSON.stringify(clean)}`);
  await page.evaluate(() => localStorage.removeItem("ufocombat_v1_boot"));
});

await check("jet call-in: exit and call again, on a runway and in the air: the new jet exists and is visible", async () => {
  await play();
  await skyArena();
  await flatPad();
  const info = () =>
    v((g) => ({
      list: g.vehicles.vehicles.filter((x) => x.type === "jet").map((x) => ({ alive: x.alive, visible: x.root.visible, inScene: !!x.root.parent, occ: x.occupied, y: x.pos.y })),
      active: !!g.vehicles.active,
    }));
  for (let round = 0; round < 3; round++) {
    await v((g) => {
      g.ufos.time += 5;
      g.callJet();
    });
    await frames(6);
    let s = await info();
    assert(s.list.length === 1 && s.list[0].alive && s.list[0].visible && s.list[0].inScene, `round ${round}: one visible jet ${JSON.stringify(s)}`);
    if (!s.active) {
      await v((g) => {
        const j = g.vehicles.vehicles.find((x) => x.type === "jet");
        g.player.position.set(j.pos.x + 5, j.pos.y - 1, j.pos.z);
        g.vehicles.toggle();
      });
      await frames(4);
      assert((await info()).active, `round ${round}: boarded`);
    }
    await v((g) => g.vehicles.toggle()); // get out (or eject)
    await frames(4);
    s = await info();
    assert(!s.active, `round ${round}: out of the jet`);
  }
  // A call right after exiting replaces the old jet at once.
  await v((g) => {
    g.ufos.time += 5;
    g.callJet();
  });
  await frames(5);
  const s = await info();
  assert(s.list.length === 1 && s.list[0].visible, `replaced ${JSON.stringify(s)}`);
  await v((g) => {
    if (g.vehicles.active) g.vehicles.toggle();
    for (const j of [...g.vehicles.vehicles]) g.vehicles.remove(j);
  });
});

await check("terrain heights stay inside the world and match between chunks and distant terrain (LOD)", async () => {
  const r = await v(async (g) => {
    const { LodTerrain } = await import("./js/lod-mesher.js");
    const { WORLD_HEIGHT, SEA_LEVEL } = await import("./js/constants.js");
    const lt = new LodTerrain(g.world.terrain.seed);
    const t = g.world.terrain;
    // Find mountains.
    let peaks = 0;
    let maxH = 0;
    let mismatch = 0;
    let checked = 0;
    const idAt = (chunk, lx, lz, y) => chunk.blocks[(y * 16 + lz) * 16 + lx];
    for (let z = -2600; z < 2600 && checked < 400; z += 61) {
      for (let x = -2600; x < 2600 && checked < 400; x += 67) {
        const h = t.heightAt(x, z);
        maxH = Math.max(maxH, h);
        if (h < 40) continue;
        if (h >= 56) peaks++;
        checked++;
        const s = { top: 0, id: 0, depth: 0 };
        lt.sample(x, z, s);
        if (s.top !== h + 1) mismatch++;
      }
    }
    return { maxH, peaks, mismatch, checked, WORLD_HEIGHT, SEA_LEVEL };
  });
  assert(r.maxH < r.WORLD_HEIGHT - 1, `heights fit the world: max ${r.maxH}`);
  assert(r.checked > 100, `enough mountain columns sampled: ${r.checked}`);
  assert(r.mismatch === 0, `distant terrain tops differ from the terrain function: ${r.mismatch}/${r.checked}`);
});

await check("altitude-aware view distance: flying high in a jet extends the view; on the ground it doesn't", async () => {
  await play();
  await skyArena();
  const base = await v((g) => g.renderDistance);
  await v((g) => {
    g.vehicles.config.jet.airborne = true;
    g.callJet(true);
  });
  await frames(3);
  await v((g) => {
    const j = g.vehicles.active || g.vehicles.vehicles.find((x) => x.type === "jet");
    if (!g.vehicles.active) g.vehicles.enter(j);
    j.pos.y = 190;
  });
  await until((g) => g.debugViewRD && g.debugViewRD() > g.renderDistance, 20000);
  const high = await v((g) => g.debugViewRD());
  assert(high > base, `the view distance grows with altitude: ${base} -> ${high}`);
  await v((g) => {
    for (const j of [...g.vehicles.vehicles]) g.vehicles.remove(j);
    g.vehicles.config.jet.airborne = false;
    g.player.position.y = 40;
  });
  await until((g) => g.debugViewRD() === g.renderDistance, 30000);
});

await check("UFOs spawn hidden, within range, and the range scales with the view distance", async () => {
  await play();
  await skyArena();
  const res = {};
  for (const view of [160, 480, 1600]) {
    res[view] = await v((g, view) => {
      g.ufos.viewDistance = view;
      const p = g.player.position;
      const out = [];
      for (let i = 0; i < 24; i++) {
        const u = g.ufos.spawn({});
        out.push({ d: Math.hypot(u.pos.x - p.x, u.pos.z - p.z), fade: u.spawnFade, y: u.pos.y });
      }
      g.ufos.clear();
      return { max: Math.max(...out.map((o) => o.d)), min: Math.min(...out.map((o) => o.d)), fades: out.every((o) => o.fade > 0), range: g.ufos.range };
    }, view);
  }
  assert(res[160].max <= 260 && res[160].min >= 100, `small view: ${JSON.stringify(res[160])}`);
  assert(res[480].max > res[160].max * 0.9 && res[480].max <= 500, `medium view ${JSON.stringify(res[480])}`);
  // A huge view distance still spawns them where the player can reach them.
  assert(res[1600].max <= 930 && res[1600].max > 400, `large view ${JSON.stringify(res[1600])}`);
  assert(res[1600].fades, "they grow in (no popping)");
});

await check("range: a UFO 500 blocks away can be hit; a UFO's shots reach the player from far away", async () => {
  await play();
  await skyArena();
  const r = await v(async (g) => {
    const p = g.player;
    p.flying = true;
    p.position.set(p.position.x, 160, p.position.z);
    g.weapons.viewRange = 1200;
    p.yaw = 0;
    p.pitch = 0;
    const u = g.ufos.spawn({ design: "saucer", size: "medium", pos: { x: p.position.x, y: 160, z: p.position.z - 500 } });
    u.state = "hover_test";
    const h0 = u.health;
    // Aim at its middle (a flat saucer is thinner than the eye's height above
    // its centre) and fire the pistol (a real bullet since Round 5).
    const eye = p.getEyePosition();
    p.pitch = Math.atan2(u.pos.y - eye.y, eye.z - u.pos.z);
    g.weapons.firePistol();
    for (let i = 0; i < 100; i++) g.lasers.update(0.025); // (Round 5: a real bullet, about a second and a half away)
    return { h0, h1: u.health, dist: 500, range: g.weapons._range(160, 0.6) };
  });
  assert(r.h1 < r.h0, `the pistol hit a UFO 500 blocks away: ${JSON.stringify(r)}`);
  // A UFO's bolt from far away reaches a player on foot.
  const r2 = await v((g) => {
    g.ufos.clear();
    g.setMode("survival");
    const p = g.player;
    p.flying = false;
    p.health = 20;
    p.position.y = 150; // well above any hill: a clear line of fire
    const u = g.ufos.spawn({ design: "saucer", size: "large", pos: { x: p.position.x + 380, y: 160, z: p.position.z } });
    u.state = "hover_test";
    const tgt = { pos: p.position.clone().setY(p.position.y + 1), vel: { x: 0, y: 0, z: 0, length: () => 0 } };
    const startFired = g.lasers.fired;
    const hp0 = p.health;
    let t = 0;
    const rnd = Math.random;
    Math.random = () => 0.5; // (no aim scatter: this checks the reach, not the marksmanship)
    for (let k = 0; k < 8 && p.health >= hp0; k++) {
      p._invulnerable = 0;
      g.ufos._fireAt(u, p.position.clone().setY(p.position.y + 1), new g.THREE.Vector3(), 1);
      let s = 0;
      while (s < 5 && p.health >= hp0 && g.lasers.bolts.length > 0) {
        g.lasers.update(0.05);
        s += 0.05;
        t += 0.05;
      }
    }
    Math.random = rnd;
    return { hp0, hp1: p.health, t, fired: g.lasers.fired - startFired };
  });
  assert(r2.fired >= 1 && r2.hp1 < r2.hp0, `a shot from 380 blocks away hit the player: ${JSON.stringify(r2)}`);
  await v((g) => {
    g.ufos.clear();
    g.setMode("creative");
  });
});

await check("shot-down UFOs in the sea sink below the surface", async () => {
  await play();
  await skyArena();
  const r = await v(async (g) => {
    const { SEA_LEVEL } = await import("./js/constants.js");
    const t = g.world.terrain;
    // A deep-sea column near the world's origin.
    let spot = null;
    for (let r = 100; r < 3000 && !spot; r += 50) {
      for (let a = 0; a < 16 && !spot; a++) {
        const x = Math.round(Math.cos(a) * r);
        const z = Math.round(Math.sin(a) * r);
        if (t.heightAt(x, z) < SEA_LEVEL - 8 && t.heightAt(x + 12, z) < SEA_LEVEL - 8 && t.heightAt(x - 12, z) < SEA_LEVEL - 8) spot = { x, z, h: t.heightAt(x, z) };
      }
    }
    if (!spot) return { none: true };
    g.player.flying = true;
    g.player.position.set(spot.x + 0.5, 60, spot.z + 40);
    g.world.prepareArea(spot.x, spot.z, 4);
    g.streamAround(spot.x, spot.z);
    return spot;
  });
  if (r.none) return; // (a seed with no deep sea near the origin: nothing to test)
  await until((g) => g.world.getChunk(Math.floor(g.player.position.x) >> 4, Math.floor(g.player.position.z) >> 4), 20000);
  const out = await v(async (g, spot) => {
    const { SEA_LEVEL } = await import("./js/constants.js");
    const u = g.ufos.spawn({ design: "saucer", size: "small", radius: 4, pos: { x: spot.x + 0.5, y: 45, z: spot.z + 0.5 } });
    u.state = "hover_test";
    g.ufos.damage(u, 99999, true);
    let t = 0;
    const before = g.vehicles.vehicles.length;
    while (t < 30 && g.ufos.ufos.includes(u)) {
      g.ufos.update(0.05);
      t += 0.05;
    }
    const wreck = g.vehicles.vehicles.find((x) => x.type === "ufo" && x.crashed);
    if (!wreck) return { none: true, t };
    return { y: wreck.pos.y, bottom: wreck.bottom, sea: SEA_LEVEL, top: wreck.pos.y + wreck.radius * wreck.info.h * 0.5, t };
  }, r);
  assert(!out.none, `it crashed: ${JSON.stringify(out)}`);
  assert(out.y < out.sea - 0.5 && out.top < out.sea + 1, `the wreck sank below the surface: ${JSON.stringify(out)}`);
  await v((g) => {
    for (const x of [...g.vehicles.vehicles]) g.vehicles.remove(x);
    g.mobs.clear();
  });
});

await check("aliens face the player when they shoot, and chase at once after leaving a UFO", async () => {
  await play();
  await skyArena();
  await v((g) => {
    g.setMode("survival");
    g.player.health = 20;
    g.player.position.y += 0.1;
  });
  const r = await v(async (g) => {
    const p = g.player;
    const place = (kind, dz, dx = 0) => {
      const x = Math.floor(p.position.x) + 0.5 + dx;
      const z = Math.floor(p.position.z) + 0.5 + dz;
      const top = g.world.surfaceY(Math.floor(x), Math.floor(z));
      const m = g.mobs.spawn(kind, x, (top >= 0 ? top : Math.floor(p.position.y)) + 1, z);
      m.aggro = true;
      m.ai.target = true;
      m.yaw = 0; // facing +Z: away from the player
      return m;
    };
    // Near, behind the player: they must turn to shoot.
    const near = [place("alien", 26, -3), place("alien_gray", 34, 0), place("alien_red", 18, 3)];
    // Far: they must come to the player at once.
    const far = [place("alien", 110, 8), place("alien_gray", -110, -30), place("alien", 30, 110)]; // (mobs have no path-finding: one may be stuck behind a cliff or water)
    const angles = [];
    const orig = g.mobs._shootLaser.bind(g.mobs);
    g.mobs._shootLaser = (m, follow) => {
      if (!follow) {
        const dx = p.position.x - m.pos.x;
        const dz = p.position.z - m.pos.z;
        let d = Math.atan2(dx, dz) - m.yaw;
        while (d > Math.PI) d -= Math.PI * 2;
        while (d < -Math.PI) d += Math.PI * 2;
        angles.push(Math.abs(d));
      }
      return orig(m, follow);
    };
    const dist = (m) => Math.hypot(m.pos.x - p.position.x, m.pos.z - p.position.z);
    const farStart = far.map(dist);
    const farD0 = farStart[0];
    let t = 0;
    while (t < 16) {
      g.mobs.update(0.05);
      t += 0.05;
      p.health = 20;
    }
    const farEnd = far.map(dist);
    const best = far.reduce((b, m, i) => (farStart[i] - farEnd[i] > farStart[b] - farEnd[b] ? i : b), 0);
    const farD0b = farStart[best];
    const farD1 = farEnd[best];
    g.mobs._shootLaser = orig;
    const f = far[best];
    return { angles, farD0: farD0b, farD1, farInfo: { dead: f.dead, inList: g.mobs.mobs.includes(f), chunk: !!g.world.getChunk(Math.floor(f.pos.x) >> 4, Math.floor(f.pos.z) >> 4), aggro: f.aggro, state: f.ai?.state, yMob: f.pos.y, mode: g.player.mode, health: g.player.health, dead: g.player.dead } };
  });
  assert(r.angles.length >= 3, `they shoot: ${r.angles.length} shots`);
  assert(r.angles.every((a) => a < 0.45), `every shot was fired facing the player: max ${Math.max(...r.angles).toFixed(2)} rad`);
  assert(r.farD1 < r.farD0 - 12, `an alien far away came for the player at once (Round 5: they plan paths, and the world here does not stream between steps): ${Math.round(r.farD0)} -> ${Math.round(r.farD1)} ${JSON.stringify(r.farInfo)}`);
  await v((g) => {
    g.mobs.clear();
    g.setMode("creative");
  });
});

await check("skeletons face the player when they shoot", async () => {
  await play();
  await skyArena();
  await flatPad(24, 24); // (a clear line of sight whatever the terrain)
  await v((g) => {
    g.setMode("survival");
    g.mobs.hostileSpawning = false;
    g.player.health = 20;
  });
  const r = await v((g) => {
    const p = g.player;
    const x = Math.floor(p.position.x) + 0.5;
    const z = Math.floor(p.position.z) + 0.5 + 16;
    const top = g.world.surfaceY(Math.floor(x), Math.floor(z));
    const m = g.mobs.spawn("skeleton", x, (top >= 0 ? top : Math.floor(p.position.y)) + 1, z);
    m.yaw = 0;
    m.ai.target = true;
    const angles = [];
    const orig = g.mobs._shootArrow.bind(g.mobs);
    g.mobs._shootArrow = (mm, dx, dy, dz) => {
      let d = Math.atan2(dx, dz) - mm.yaw;
      while (d > Math.PI) d -= Math.PI * 2;
      while (d < -Math.PI) d += Math.PI * 2;
      angles.push(Math.abs(d));
      return orig(mm, dx, dy, dz);
    };
    let t = 0;
    const glow = m.light.glow;
    while (t < 12) {
      g.mobs.update(0.05);
      t += 0.05;
      p.health = 20;
      m.burning = false;
      m.health = m.maxHealth;
    }
    g.mobs._shootArrow = orig;
    return { angles, glow };
  });
  assert(r.angles.length >= 2, `it shoots: ${r.angles.length}`);
  assert(r.angles.every((a) => a < 0.45), `every arrow was shot facing the player: max ${Math.max(...r.angles).toFixed(2)} rad`);
  assert(r.glow === 0, `skeletons no longer glow (${r.glow})`);
  await v((g) => {
    g.mobs.clear();
    g.setMode("creative");
  });
});

await check("chicken has a neck and its head sits on it; the butterfly flaps its wings upward", async () => {
  const r = await v(async (g) => {
    const M = await import("./js/mob-models.js");
    const chicken = M.createMobModel("chicken");
    chicken.animate({ walkPhase: 0, walk: 0, headYaw: 0, headPitch: 0, time: 0, vy: 0, graze: 0, hide: 0, attack: 1, swing: 0 });
    const headY = chicken.parts.head.position.y;
    const bodyParts = Object.keys(chicken.parts);
    const bf = M.createMobModel("butterfly");
    const flaps = [];
    for (let t = 0; t < 1; t += 0.03) {
      bf.animate({ walkPhase: 0, walk: 0, headYaw: 0, headPitch: 0, time: t, vy: 0, graze: 0, hide: 0, attack: 1, swing: 0 });
      flaps.push([bf.parts.wingL.rotation.z, bf.parts.wingR.rotation.z]);
    }
    // The chicken's geometry: neck and head overlap in height (no gap).
    const boxes = chicken.meshes.map((m) => {
      m.geometry.computeBoundingBox();
      return m.geometry.boundingBox.clone();
    });
    return { headY, bodyParts, flapL: [Math.min(...flaps.map((f) => f[0])), Math.max(...flaps.map((f) => f[0]))], flapR: [Math.min(...flaps.map((f) => f[1])), Math.max(...flaps.map((f) => f[1]))] };
  });
  assert(Math.abs(r.headY - 6 / 16) < 1e-6, `the head rests on the neck (y ${r.headY})`);
  assert(r.flapL[1] <= 0 && r.flapR[0] >= 0, `wings only flap upward: ${JSON.stringify(r)}`);
  assert(r.flapL[0] < -0.5 && r.flapR[1] > 0.5, "wings flap through a wide arc");
});

await check("at most 4 UFOs attack the player at once; the rest circle and wait", async () => {
  await play();
  await skyArena();
  await v((g) => {
    g.setMode("survival");
    g.ufos.graceT = 0;
    g.ufos.config.activity = 0;
    g.player.health = 20;
    g.player.flying = false;
    const p = g.player.position;
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2;
      const u = g.ufos.spawn({ design: "saucer", size: "small", pos: { x: p.x + Math.cos(a) * 60, y: p.y + 30, z: p.z + Math.sin(a) * 60 } });
      u.spawnFade = 0;
    }
    for (const u of g.ufos.ufos) g.ufos.anger(u, 90);
  });
  const r = await v((g) => {
    let max = 0;
    let attackingSeen = 0;
    for (let i = 0; i < 400; i++) {
      g.ufos.update(0.05);
      g.player.health = 20;
      for (const u of g.ufos.ufos) u.lastSeen = g.ufos.time;
      const n = g.ufos.ufos.filter((u) => !u.falling && (u.state === "attack" || u.state === "react" || u.state === "beam")).length;
      max = Math.max(max, n);
      attackingSeen = Math.max(attackingSeen, n);
    }
    const circling = g.ufos.ufos.filter((u) => u.state === "circle").length;
    return { max, attackingSeen, circling };
  });
  assert(r.max <= 4, `never more than 4 attackers: ${JSON.stringify(r)}`);
  assert(r.attackingSeen >= 3, `and they do attack: ${JSON.stringify(r)}`);
  assert(r.circling >= 1, `the others wait: ${JSON.stringify(r)}`);
  await v((g) => {
    g.ufos.clear();
    g.setMode("creative");
  });
});

// ================= Part 2: weapons and inventory =================

// Gives the player the item and selects its hotbar slot (creative, sky arena).
const equip = (name) =>
  v(async (g, n) => {
    const { ITEM } = await import("./js/items.js");
    const { makeStack } = await import("./js/inventory.js");
    g.weapons.cancel();
    g.inventory.slots[0] = makeStack(ITEM[n], 1);
    g.inventory.selected = 0;
    g.held.setItem(ITEM[n]);
  }, name);

await check("no crafting: no recipe module or grid; E shows the inventory, Creative a tabbed palette with every weapon", async () => {
  await play();
  const r = await v(async (g) => {
    const craftingModule = false; // (checked from the file system below)
    const { ALL_WEAPONS, CREATIVE_LOADOUT, SURVIVAL_LOADOUT, ITEM } = await import("./js/items.js");
    g.invScreen.open("inventory", true);
    const el = document.getElementById("inventory-screen");
    const out = {
      craftingModule,
      grid: !!el.querySelector(".craft-grid"),
      book: !!el.querySelector(".recipe-book"),
      tabs: [...el.querySelectorAll(".inv-tab")].map((b) => b.textContent),
      loadouts: [ALL_WEAPONS.length, CREATIVE_LOADOUT.length, SURVIVAL_LOADOUT.length, SURVIVAL_LOADOUT[0] === ITEM.STONE_SWORD],
    };
    // The weapons tab shows every weapon (10 and the bow: 11), the others hide them.
    const shown = () => [...el.querySelectorAll(".inv-palette .slot")].filter((s) => !s.classList.contains("hidden")).length;
    g.invScreen.setTab(0);
    out.weaponsShown = shown();
    g.invScreen.setTab(1);
    out.blocksShown = shown();
    g.invScreen.close();
    // Every weapon is in the Creative inventory (hotbar and storage).
    g.setMode("survival");
    g.setMode("creative");
    const have = new Set(g.inventory.slots.filter(Boolean).map((s) => s.id));
    out.missing = ALL_WEAPONS.filter((id) => !have.has(id)).length;
    return out;
  });
  assert(!fs.existsSync(path.join(ROOT, "js", "crafting.js")), "crafting.js is deleted");
  assert(!r.craftingModule && !r.grid && !r.book, `crafting is gone: ${JSON.stringify(r)}`);
  assert(r.tabs.length >= 3, `palette tabs: ${r.tabs}`);
  // (Round 4: Survival starts with basic gear; the shield is an off-hand item, the bow is in Creative's loadout.)
  assert(r.loadouts[0] === 10 && r.loadouts[1] === 11 && r.loadouts[2] === 3 && r.loadouts[3], `loadouts ${r.loadouts}`);
  assert(r.weaponsShown === 11 && r.blocksShown > 15, `weapons tab ${r.weaponsShown}, blocks tab ${r.blocksShown}`);
  assert(r.missing === 0, `creative has every weapon (${r.missing} missing)`);
});

await check("railgun: charges about a second, then destroys blocks in a line, and hits every creature and UFO on it", async () => {
  await play();
  await skyArena();
  await flatPad(20, 90);
  await equip("RAILGUN");
  const r = await v(async (g) => {
    const p = g.player;
    p.pitch = 0;
    p.yaw = 0;
    const eye = p.getEyePosition();
    const dir = p.getForwardVector();
    g.world.prepareArea(eye.x, eye.z, 8);
    const at = (d, off = 0) => [Math.round(eye.x + dir.x * d), Math.round(eye.y + dir.y * d + off), Math.round(eye.z + dir.z * d)];
    const list = [];
    for (const d of [8, 24, 60]) {
      const [cx, cy, cz] = at(d);
      for (let a = -4; a <= 4; a++) for (let b = -4; b <= 4; b++) for (let c = -4; c <= 4; c++) list.push(cx + a, cy + b, cz + c, 1);
    }
    g.world.setBlocks(list);
    const cow = (d, side = 0) => g.mobs.spawn("cow", eye.x + dir.x * d - dir.z * side, eye.y - 0.9, eye.z + dir.z * d + dir.x * side);
    const m1 = cow(16);
    const m2 = cow(40);
    const off = cow(30, 9);
    const ufo = g.ufos.spawn({ design: "saucer", size: "medium", pos: { x: eye.x + dir.x * 90, y: eye.y + dir.y * 90, z: eye.z + dir.z * 90 } });
    const hp0 = ufo.health;
    const solid = () => [8, 24, 60].map((d) => g.world.getBlock(...at(d)));
    const offBlock = () => g.world.getBlock(...at(8).map((x, i) => (i === 1 ? x + 3 : x)));
    const before = { solid: solid(), off: offBlock() };
    g.weapons.press("railgun");
    let t = 0;
    let firedAt = -1;
    while (t < 2 && firedAt < 0) {
      g.weapons.update(0.05);
      t += 0.05;
      if (g.weapons.rail.beams.some((b) => b.mesh.visible)) firedAt = t;
    }
    const midSolid = firedAt;
    g.weapons.release();
    return {
      before,
      firedAt: midSolid,
      after: { solid: solid(), off: offBlock() },
      dead: [m1.dead, m2.dead, off.dead],
      ufoDamage: hp0 - ufo.health,
      ufoDead: ufo.falling || ufo.state === "gone",
      beams: g.weapons.rail.beams.length,
    };
  });
  assert(r.firedAt > 0.9 && r.firedAt < 1.2, `about a second of charge: fired at ${r.firedAt}`);
  assert(r.before.solid.every((b) => b === 1), `the walls were there: ${r.before.solid}`);
  assert(r.after.solid.every((b) => b === 0), `the beam destroyed all three walls: ${r.after.solid}`);
  assert(r.after.off === 1, `blocks off the line stay: ${r.after.off}`);
  assert(r.dead[0] && r.dead[1] && !r.dead[2], `both creatures on the line die, the one beside it lives: ${r.dead}`);
  assert(r.ufoDamage > 100 || r.ufoDead, `the UFO in the line was hit: ${r.ufoDamage}`);
  assert(r.beams >= 1, "the beam is drawn");
  await v((g) => {
    g.ufos.clear();
    g.mobs.clear();
  });
});

await check("laser minigun: spins up first, then a stream of bolts", async () => {
  await equip("MINIGUN");
  const r = await v((g) => {
    g.lasers.clear?.();
    const start = g.lasers.bolts.length;
    const shots0 = g.weapons.shots;
    g.weapons.press("minigun");
    let t = 0;
    let firstBolt = -1;
    while (t < 2.5) {
      g.weapons.update(0.04);
      g.lasers.update(0.04);
      t += 0.04;
      if (firstBolt < 0 && g.lasers.bolts.length > start) firstBolt = t;
    }
    const during = g.lasers.bolts.length;
    const shots = g.weapons.shots - shots0;
    const spin = g.weapons.minigun.spin;
    g.weapons.release();
    for (let i = 0; i < 60; i++) g.weapons.update(0.05);
    return { firstBolt, during, shots, spin, spinAfter: g.weapons.minigun.spin, boltsAfterRelease: g.lasers.bolts.length };
  });
  assert(r.firstBolt > 0.8 && r.firstBolt < 1.3, `bolts start after the spin-up: ${r.firstBolt}`);
  assert(r.shots >= 35 && r.during > 12, `a big stream: ${r.shots} shots, ${r.during} bolts in flight`);
  assert(r.spin === 1 && r.spinAfter < 0.05, `spins up and down: ${r.spin} -> ${r.spinAfter}`);
});

await check("golden apple: full health plus golden hearts that soak damage first", async () => {
  const r = await v(async (g) => {
    const { ITEM, itemInfo } = await import("./js/items.js");
    if (g.player.dead) g.respawn();
    g.setMode("survival");
    const p = g.player;
    p.health = 5;
    p.absorption = 0;
    p.heal(itemInfo(ITEM.GOLDEN_APPLE).food);
    p.addAbsorption(itemInfo(ITEM.GOLDEN_APPLE).absorb);
    const a = { health: p.health, gold: p.absorption };
    p._invulnerable = 0;
    p.damage(6, "zombie");
    const b = { health: p.health, gold: p.absorption };
    return { a, b, hudGold: document.querySelectorAll("#absorb canvas").length };
  });
  assert(r.a.health === 20 && r.a.gold === 8, `golden apple: ${JSON.stringify(r.a)}`);
  assert(r.b.health === 20 && r.b.gold === 2, `golden hearts soaked the hit: ${JSON.stringify(r.b)}`);
  assert(r.hudGold === 10, "the HUD has the golden heart row");
  await v((g) => {
    g.player.absorption = 0;
    g.setMode("creative");
  });
});

await check("bazooka lock-on: hold to lock a UFO near the crosshair, the rocket homes in; without a lock it flies straight", async () => {
  await play();
  await skyArena();
  await flatPad(20, 90);
  await equip("BAZOOKA");
  const r = await v((g) => {
    const p = g.player;
    g.mobs.clear();
    p.flying = true;
    p.position.y = 260; // (Round 5: bigger mountains: the line of fire must be clear)
    p.velocity.set(0, 0, 0);
    p.yaw = 0;
    p.pitch = 0.25;
    const eye = p.getEyePosition();
    const dir = p.getForwardVector();
    // A UFO 120 blocks away, 3 degrees off the crosshair.
    const side = { x: -dir.z, z: dir.x };
    const off = Math.tan(0.05) * 120;
    const pos = { x: eye.x + dir.x * 120 + side.x * off, y: eye.y + dir.y * 120, z: eye.z + dir.z * 120 + side.z * off };
    const u = g.ufos.spawn({ design: "saucer", size: "large", pos });
    u.vel?.set?.(0, 0, 0);
    g.ufos.config.activity = 0;
    const hp0 = u.health;
    g.weapons.press("bazooka");
    let t = 0;
    let lockedAt = -1;
    while (t < 3) {
      g.ufos.update?.(0.02);
      u.pos.set(pos.x, pos.y, pos.z);
      g.weapons.update(0.05);
      t += 0.05;
      if (g.weapons.lock.locked && lockedAt < 0) lockedAt = t;
    }
    const target = g.weapons.lock.target?.ref === u;
    g.weapons.release();
    const rocket = g.weapons.rockets[g.weapons.rockets.length - 1];
    const homing = !!rocket?.target;
    for (let i = 0; i < 400 && g.weapons.rockets.length; i++) {
      u.pos.set(pos.x, pos.y, pos.z);
      g.weapons.update(0.03);
    }
    const dmg = hp0 - u.health;
    // Unguided: no lock (target far off to the side).
    g.weapons.press("bazooka");
    g.weapons.update(0.05);
    g.weapons.release();
    const r2 = g.weapons.rockets[g.weapons.rockets.length - 1];
    const tr = g.weapons.lock.target?.ref;
    return { lockedAt, target, homing, dmg, unguided: r2 && !r2.target, dbg: { tk: tr && (tr.kind || tr.type || 'ufo'), state: u.state, falling: u.falling, r: u.radius, hp: u.health, n: g.ufos.ufos.length } };
  });
  assert(r.target && r.lockedAt > 0.9 && r.lockedAt < 1.8, `locked after about a second: ${JSON.stringify(r)}`);
  assert(r.homing && r.dmg > 20, `the homing rocket hit the UFO: ${JSON.stringify(r)}`);
  await v((g) => {
    g.weapons.clearProjectiles();
    g.ufos.clear();
  });
});

await check("nuke: default 96 (the old maximum), size range up to 200, more slices for bigger craters, no long cooldown", async () => {
  const r = await v(async (g) => {
    const { NUKE_DEFAULTS, NUKE_MAX_SIZE } = await import("./js/nuke.js");
    const s = g.settingsPanel.schema?.find?.((x) => x.key === "weapons.nukeSize");
    g.settingsPanel.set("weapons.nukeSize", 96);
    const rad = g.nuke.radius;
    g.settingsPanel.set("weapons.nukeSize", 96);
    return { def: NUKE_DEFAULTS.size, max: NUKE_MAX_SIZE, rad, schemaMax: s?.max };
  });
  assert(r.def === 96 && r.max === 200 && r.rad === 96, JSON.stringify(r));
  // The jet's nuke may be dropped again straight away (no long cooldown).
  const cd = await v(async () => {
    const src = await (await fetch("./js/vehicle-jet.js")).text();
    return Number(/const NUKE_COOLDOWN = ([0-9.]+)/.exec(src)[1]);
  });
  assert(cd <= 1, `nuke cooldown ${cd}`);
});

// ================= Part 3: vehicles =================

// A jet in the air (or on the ground) that the player sits in.
const newJet = (opts) =>
  v((g, o) => {
    if (g.vehicles.active) g.vehicles.exit({ force: true });
    for (const j of [...g.vehicles.vehicles]) g.vehicles.remove(j);
    g.ufos.clear();
    g.mobs.clear();
    const p = g.player.position;
    const jet = g.vehicles.create("jet", { pos: [p.x + (o.dx || 0), p.y + (o.dy ?? 60), p.z + (o.dz || 0)], yaw: o.yaw ?? 0, airborne: !o.ground, speed: o.speed ?? 110, throttle: o.throttle ?? 0.75 });
    g.vehicles.enter(jet);
    g.player.keys.clear();
    return true;
  }, opts || {});
// Steps the vehicle simulation by n * dt (the game loop keeps running too).
const stepVeh = (n, dt = 0.05) =>
  v((g, a) => {
    for (let i = 0; i < a.n; i++) {
      g.vehicles.update(a.dt);
      g.enemyJets?.update?.(a.dt);
      g.lasers.update(a.dt);
    }
  }, { n, dt });

await check("jet takeoff: a real ground roll on a runway, rotation, liftoff, the gear folds away", async () => {
  await play();
  await skyArena();
  const y0 = await flatPad(20, 90);
  const r = await v((g, o) => {
    if (g.vehicles.active) g.vehicles.exit({ force: true });
    for (const j of [...g.vehicles.vehicles]) g.vehicles.remove(j);
    const p = g.player.position;
    const jet = g.vehicles.create("jet", { pos: [p.x, o.y0 + 1 + 1.35, p.z + 82], yaw: 0 });
    g.vehicles.enter(jet);
    const startZ = jet.pos.z;
    let crashInfo = "";
    const origCrash = jet._crash.bind(jet);
    jet._crash = (c) => {
      crashInfo = `${new Error().stack.split("\n").slice(2, 4).join(" <- ").replace(/http:[^ )]*\//g, "")} pos ${jet.pos.x.toFixed(1)},${jet.pos.y.toFixed(1)},${jet.pos.z.toFixed(1)} vy ${jet.vel.y.toFixed(1)} og ${jet.onGround}`;
      return origCrash(c);
    };
    const keys = g.player.keys;
    keys.add("KeyW");
    keys.add("KeyW");
    jet.throttle = 1;
    let t = 0;
    let liftedAt = -1;
    let speedAtLift = 0;
    const gearBefore = jet.model.gear;
    let maxRoll = 0;
    const samples = [];
    while (t < 40 && jet.alive) {
      g.vehicles.update(0.05);
      t += 0.05;
      if (jet.onGround) maxRoll = Math.abs(jet.pos.z - startZ);
      if (!jet.onGround && liftedAt < 0) {
        liftedAt = t;
        speedAtLift = jet.speed;
        break;
      }
    }
    // Once climbing away fast, the gear folds (lifted here so the test does not depend on the terrain past the pad).
    const gearBefore2 = jet.model.gear;
    if (jet.alive) {
      jet.pos.y += 180; // (Round 5: well above the bigger mountains ahead)
      jet.vel.set(0, 0, -95);
      for (let i = 0; i < 60; i++) g.vehicles.update(0.05);
    }
    const agl = jet.pos.y - (o.y0 + 1);
    const out = { crashInfo, cause: jet.lastHitBy, samples: samples.join(" | "), speed: jet.speed, thr: jet.throttle, onGround: jet.onGround, pitch: Math.asin(jet.forward(new (g.player.position.constructor)()).y), alive: jet.alive, liftedAt, roll: maxRoll, speedAtLift, gearBefore, gearAfter: jet.model.gear, agl, stall: jet.cfg.stallSpeed };
    g.vehicles.exit({ force: true });
    for (const j of [...g.vehicles.vehicles]) g.vehicles.remove(j);
    keys.clear();
    return out;
  }, { y0 });
  assert(r.alive, `the jet survived the takeoff ${JSON.stringify(r)}`);
  assert(r.liftedAt > 2.5 && r.liftedAt < 30, `it takes a few seconds to get airborne: ${r.liftedAt}`);
  assert(r.roll > 40 && r.roll < 175, `a real ground roll, not a jump: ${Math.round(r.roll)} blocks`);
  assert(r.speedAtLift > r.stall * 0.85, `lifts off at about the stall speed or above: ${Math.round(r.speedAtLift)} (stall ${r.stall})`);
  assert(r.gearBefore === 1 && r.gearAfter < 0.2, `the gear is down on the ground and folds away: ${r.gearBefore} -> ${r.gearAfter}`);
  assert(r.agl > 4, `it climbs away: ${Math.round(r.agl)} above the runway`);
});

await check("jet cannon: aim assist pulls shots onto a target near the nose; it overheats, jams and cools down", async () => {
  await newJet({ dy: 80 });
  const r = await v((g) => {
    const jet = g.vehicles.active;
    const fwd = jet.forward(new g.player.position.constructor());
    const right = jet.right(new g.player.position.constructor());
    const from = jet.pos.clone().addScaledVector(fwd, 6.6);
    // A UFO 3 degrees to the right of the nose, 300 blocks away.
    const ufo = g.ufos.spawn({ design: "saucer", size: "medium", pos: { x: jet.pos.x, y: jet.pos.y, z: jet.pos.z } });
    ufo.pos.copy(jet.pos).addScaledVector(fwd, 300).addScaledVector(right, 300 * Math.tan(0.05));
    const to = ufo.pos.clone().sub(from).normalize();
    const before = fwd.angleTo(to);
    const dir = jet._assistDir(from, fwd, 800);
    const after = dir.angleTo(to);
    // Fire until it jams.
    g.vehicles.input.buttons[0] = true;
    let jamAt = -1;
    let t = 0;
    let shots0 = g.lasers.fired;
    while (t < 6) {
      g.vehicles.update(1 / 32);
      t += 1 / 32;
      if (jet.jammed && jamAt < 0) jamAt = t;
    }
    const shotsFired = g.lasers.fired - shots0;
    const heatWhenJammed = jet.heat;
    g.vehicles.input.buttons[0] = false;
    let coolAt = -1;
    t = 0;
    while (t < 8) {
      g.vehicles.update(1 / 32);
      t += 1 / 32;
      if (!jet.jammed && coolAt < 0) coolAt = t;
    }
    g.ufos.clear();
    return { before, after, jamAt, shotsFired, heatWhenJammed, coolAt, heatEnd: jet.heat };
  });
  assert(r.after < r.before * 0.6, `assist pulls the shots toward the target: ${r.before.toFixed(3)} -> ${r.after.toFixed(3)} rad`);
  assert(r.jamAt > 1.2 && r.jamAt < 3.2, `the cannon overheats after a while: ${r.jamAt}`);
  assert(r.shotsFired > 20 && r.shotsFired < 120, `and stops firing when jammed: ${r.shotsFired} shots`);
  assert(r.coolAt > 0.5 && r.heatEnd < 0.2, `it works again after cooling: back at ${r.coolAt}s, heat ${r.heatEnd}`);
});

await check("missile lock: hold RMB locks the target nearest the view centre (even behind), 1 s: one missile, 3 s: a salvo of four, rear shots turn around", async () => {
  await newJet({ dy: 90 });
  const r = await v((g) => {
    const jet = g.vehicles.active;
    const V = g.player.position.constructor;
    const fwd = jet.forward(new V());
    // A UFO behind the jet, 400 blocks away.
    const ufo = g.ufos.spawn({ design: "saucer", size: "large", pos: { x: jet.pos.x, y: jet.pos.y, z: jet.pos.z } });
    ufo.pos.copy(jet.pos).addScaledVector(fwd, -400);
    const hp0 = ufo.health;
    g.vehicles.input.buttons[2] = true;
    let t = 0;
    let lockedAt = -1;
    let lookAt = 0;
    while (t < 1.4) {
      g.vehicles.update(0.05);
      ufo.pos.copy(jet.pos).addScaledVector(jet.forward(new V()), -400);
      t += 0.05;
      if (jet.lock.locked && lockedAt < 0) lockedAt = t;
    }
    lookAt = jet.lock.look;
    const targetOk = jet.lock.target?.ref === ufo;
    g.vehicles.input.buttons[2] = false;
    g.vehicles.update(0.05);
    const one = jet.missiles.length + jet.queued.length;
    // Let it fly: it must turn around and hit.
    const fired = jet.missiles[0];
    const behind = fired?.behind;
    let hit = false;
    let minDist = 1e9;
    let lastState = "";
    for (let i = 0; i < 400 && !hit; i++) {
      const u0 = ufo.health;
      g.vehicles.update(0.05);
      if (fired) minDist = Math.min(minDist, fired.pos.distanceTo(ufo.pos));
      if (ufo.health < u0 || ufo.falling) hit = true;
      lastState = `${ufo.state}/${fired?.target ? "tgt" : "none"}/age${fired?.age?.toFixed(1)}/${jet.missiles.includes(fired)}`;
    }
    // Salvo: hold 3.2 s. (Round 4: the camera still follows the hit target; a
    // click then only brings it back, so end that first.)
    jet._endFollow?.(true);
    jet.missileT = 0;
    for (const m of jet.missiles) g.scene?.remove?.(m.mesh);
    jet.missiles.length = 0;
    ufo.health = ufo.maxHealth = 5000;
    ufo.falling = false;
    g.vehicles.input.buttons[2] = true;
    t = 0;
    let salvoAt = -1;
    while (t < 3.2) {
      g.vehicles.update(0.05);
      ufo.pos.copy(jet.pos).addScaledVector(jet.forward(new V()), -400);
      t += 0.05;
      if (jet.lock.salvo && salvoAt < 0) salvoAt = t;
    }
    g.vehicles.input.buttons[2] = false;
    for (let i = 0; i < 12; i++) g.vehicles.update(0.05);
    const four = jet.missiles.length;
    // (Round 4) A quick tap fires one unguided missile straight ahead.
    jet.missiles.length = 0;
    jet.queued.length = 0;
    jet.missileT = 0;
    jet._endFollow?.();
    g.vehicles.input.buttons[2] = true;
    g.vehicles.update(0.05);
    g.vehicles.input.buttons[2] = false;
    for (let i = 0; i < 4; i++) g.vehicles.update(0.05);
    const tapShot = jet.missiles[0] || jet.queued[0];
    const tapUnguided = !!tapShot && !tapShot.target;
    // Released while the lock is still building: no missile, the camera turns back.
    for (const m of jet.missiles) m.mesh?.parent?.remove(m.mesh);
    jet.missiles.length = 0;
    jet.queued.length = 0;
    jet.missileT = 0;
    g.vehicles.input.buttons[2] = true;
    for (let i = 0; i < 10; i++) {
      ufo.pos.copy(jet.pos).addScaledVector(jet.forward(new V()), -400);
      g.vehicles.update(0.05);
    }
    g.vehicles.input.buttons[2] = false;
    for (let i = 0; i < 40; i++) g.vehicles.update(0.05);
    const tap = jet.missiles[0] || jet.queued[0];
    const lookBack = jet.lock.look;
    const out = { minDist, lastState, lockedAt, targetOk, lookAt, one, behind, hit, salvoAt, four, tapUnguided, tapNone: !tap, lookBack, hp: ufo.health / hp0 };
    g.ufos.clear();
    for (const m of jet.missiles) m.mesh.parent?.remove(m.mesh);
    jet.missiles.length = 0;
    return out;
  });
  assert(r.targetOk, `it picked the UFO behind the jet: ${JSON.stringify(r)}`);
  assert(r.lockedAt > 0.9 && r.lockedAt < 1.4, `locked after about a second: ${r.lockedAt}`);
  assert(r.lookAt > 0.8, `the camera turned toward the target: ${r.lookAt}`);
  assert(r.one === 1, `one missile after a 1 s lock: ${r.one}`);
  assert(r.behind && r.hit, `the rear shot turned around and hit: ${JSON.stringify({ behind: r.behind, hit: r.hit, min: r.minDist, st: r.lastState })}`);
  assert(r.salvoAt > 2.8 && r.salvoAt < 3.3, `salvo ready after about 3 s: ${r.salvoAt}`);
  assert(r.four === 4, `a salvo is four missiles: ${r.four}`);
  assert(r.tapUnguided, "a quick tap fires one unguided missile (Round 4)");
  assert(r.tapNone, "releasing before the lock completes fires nothing");
  assert(r.lookBack < 0.05, `the camera returned to normal: ${r.lookBack}`);
});

await check("flares fool an enemy missile; sharp turns and flares mean it misses; a warning shows where it comes from", async () => {
  await newJet({ dy: 100, speed: 120 });
  const r = await v((g) => {
    const jet = g.vehicles.active;
    const V = g.player.position.constructor;
    const rnd = Math.random;
    Math.random = () => 0.1; // deterministic: flares always work, no return shots
    const e = g.vehicles.create("enemyjet", { pos: [jet.pos.x, jet.pos.y + 20, jet.pos.z + 500], yaw: Math.PI, airborne: true, speed: 100 });
    e.provoked = 100;
    e.ai.missileT = 999;
    const m = e._launchMissile({ kind: "player", ref: g.player }, { hostile: true });
    let warned = false;
    const dbg = [];
    let warnAngle = null;
    let t = 0;
    let flares = false;
    const hp0 = jet.health;
    while (t < 12 && e.missiles.includes(m)) {
      // The jet flies straight; drops flares when the missile is near.
      g.vehicles.update(0.05);
      t += 0.05;
      if (jet.warn && !warned) {
        warned = true;
        warnAngle = jet.warn.angle;
      }
      if (Math.round(t * 20) % 8 === 0) dbg.push(`${t.toFixed(2)}:${jet.warn ? Math.round(jet.warn.dist) : "-"}`);
      if (!flares && jet.warn && jet.warn.dist < 500) {
        jet.flareT = 0;
        jet._launchFlares();
        flares = true;
      }
    }
    Math.random = rnd;
    const out = { warned, warnAngle, flares, gone: !e.missiles.includes(m), hpLoss: hp0 - jet.health, decoyed: m.decoyed, t, age: m.age, tk: m.target?.kind, dbg: dbg.join(" ") };
    g.vehicles.remove(e);
    return out;
  });
  assert(r.warned, `the jet was warned of the missile: ${JSON.stringify(r)}`);
  assert(Math.abs(r.warnAngle) > 2.6, `the warning points behind/astern (the missile came from the back): ${r.warnAngle}`);
  assert(r.decoyed && r.gone && r.hpLoss < 5, `the flares took it: ${JSON.stringify(r)}`);
});

await check("enemy jets (Round 4: patrol fighters): neutral while the player shoots UFOs; the one the player attacks hunts with missiles and guns", async () => {
  await play();
  await skyArena();
  const r = await v((g) => {
    if (g.vehicles.active) g.vehicles.exit({ force: true });
    for (const j of [...g.vehicles.vehicles]) g.vehicles.remove(j);
    g.enemyJets.config.count = 1;
    g.ufos.lastPlayerAttack = undefined; // (earlier tests shot UFOs)
    g.ufos.clear(); // (a patrol hunts UFOs: its shots at them are not the point here)
    // (Round 4: in Survival patrols fly only from the jet mission on; this is a player past it.)
    const allowed = g.enemyJets.allowed;
    g.enemyJets.allowed = () => true;
    const p = g.player.position;
    const e = g.enemyJets.spawn({ dist: 500, angle: 0.3, rogue: false }); // (Round 3: a rogue pilot doesn't take the UFOs' side)
    g.setMode("survival");
    g.player.health = 20;
    const fired0 = g.lasers.fired;
    let peaceful = true;
    for (let i = 0; i < 600; i++) {
      g.player.health = 20;
      g.enemyJets.update(0.05);
      g.vehicles.update(0.05);
      g.lasers.update(0.05);
      if (e.missiles.length) peaceful = false;
    }
    const quiet = { peaceful, shots: g.lasers.fired - fired0, alive: e.alive, dist: e.pos.distanceTo(p) };
    // The player attacks UFOs: the patrol stays neutral.
    let calm = true;
    for (let i = 0; i < 200; i++) {
      g.ufos.time += 0.05;
      g.ufos.lastPlayerAttack = g.ufos.time - 1;
      g.enemyJets.update(0.05);
      g.vehicles.update(0.05);
      if (e.hostile || e.missiles.length) calm = false;
    }
    quiet.calmAfterUfos = calm;
    // The player shoots the fighter itself: it turns hostile.
    e.damage(4, "bullet", true);
    let attacked = false;
    let missiles = 0;
    let shots = 0;
    const fired1 = g.lasers.fired;
    for (let i = 0; i < 1600 && !attacked; i++) {
      g.ufos.time += 0.05;
      g.ufos.lastPlayerAttack = g.ufos.time - 1; // (kept fresh)
      g.player.health = 20;
      g.enemyJets.update(0.05);
      g.vehicles.update(0.05);
      g.lasers.update(0.05);
      if (e.missiles.length) missiles = Math.max(missiles, e.missiles.length);
      shots = g.lasers.fired - fired1;
      if (missiles > 0 || shots > 3) attacked = true;
    }
    const out = { quiet, attacked, missiles, shots, hostile: e.hostile, alive: e.alive, cause: e.lastHitBy, dist: Math.round(e.pos.distanceTo(p)), agl: Math.round(e.pos.y - g.world.heightAt(Math.floor(e.pos.x), Math.floor(e.pos.z))), state: `${e.provoked > 0} ${e.ai.burstLeft} ${e.ai.missileT.toFixed(1)}`, player: [p.x, p.y, p.z].map(Math.round), jet: [e.pos.x, e.pos.y, e.pos.z].map(Math.round), groundP: g.world.heightAt(Math.floor(p.x), Math.floor(p.z)) };
    g.vehicles.remove(e);
    g.setMode("creative");
    g.enemyJets.config.count = 0;
    g.enemyJets.allowed = allowed;
    g.ufos.lastPlayerAttack = undefined;
    return out;
  });
  assert(r.quiet.peaceful && r.quiet.shots === 0 && r.quiet.alive, `neutral at first: ${JSON.stringify(r.quiet)}`);
  assert(r.quiet.calmAfterUfos, `still neutral while the player shoots UFOs: ${JSON.stringify(r.quiet)}`);
  assert(r.hostile && r.attacked, `hostile after the player attacked it: ${JSON.stringify(r)}`);
});

await check("UFO piloting: teleport dash (travelled, with a streak), big ships aim all barrels at the crosshair, the vertical superweapon digs a shaft", async () => {
  await play();
  await skyArena();
  await flatPad(40, 40);
  const r = await v((g) => {
    if (g.vehicles.active) g.vehicles.exit({ force: true });
    for (const j of [...g.vehicles.vehicles]) g.vehicles.remove(j);
    g.ufos.clear();
    const p = g.player.position;
    const base = Math.floor(p.y);
    const V = p.constructor;
    const px = p.x;
    const pz = p.z;
    const ufo = g.vehicles.create("ufo", { design: "saucer", radius: 30, pos: [px, base + 50, pz] });
    g.vehicles.enter(ufo);
    ufo.speedLevel = 0.6;
    g.player.keys.clear();
    const out = {};
    // Camera: the game's own chase camera.
    g.vehicles.update(0.05);
    g.vehicles.updateCamera(g.camera ?? g.vehicles.cameraRef, 0.05);
    // 1. Dash.
    const p0 = ufo.pos.clone();
    g.vehicles.keyDown("KeyR");
    g.vehicles.update(0.016); // (Round 5: dashes are much faster: a thousand blocks a second and more)
    g.vehicles.update(0.016);
    out.first = ufo.pos.distanceTo(p0);
    for (let i = 0; i < 3; i++) g.vehicles.update(0.05);
    out.streak = g.ufos.trail.ghosts.length > 0;
    for (let i = 0; i < 20; i++) {
      g.vehicles.update(0.05);
      g.ufos.update(0.05);
    }
    out.dash = ufo.pos.distanceTo(p0);
    out.streakGone = g.ufos.trail.ghosts.length === 0;
    // 2. Aim: a target UFO straight ahead of the camera.
    ufo.pos.set(px, base + 50, pz);
    g.vehicles.update(0.05);
    const cam = g.vehicles.cameraRef;
    g.vehicles.updateCamera(cam, 0.05);
    const view = ufo._viewDir(new V());
    const tp = cam.position.clone().addScaledVector(view, 140);
    const target = g.ufos.spawn({ design: "saucer", size: "medium", pos: { x: tp.x, y: tp.y, z: tp.z } });
    target.pos.copy(tp);
    g.lasers.bolts.length = 0;
    // (Round 4: a ship fires its own kind's weapon; a rapid burst's five
    // shots leave one after another, each from the next barrel.)
    ufo.style = "rapid";
    ufo.gun.t = 0;
    ufo.gun.queue.length = 0;
    const seen = new Set();
    const muzzles = new Set();
    let worst = 0;
    g.vehicles.input.buttons[0] = true;
    for (let i = 0; i < 8; i++) {
      g.vehicles.update(0.05);
      target.pos.copy(tp);
      if (i === 0) g.vehicles.input.buttons[0] = false;
      for (const b of g.lasers.bolts) {
        if (seen.has(b)) continue;
        seen.add(b);
        muzzles.add(`${Math.round(b.pos.x - ufo.pos.x)},${Math.round(b.pos.z - ufo.pos.z)}`);
        // Closest approach of the bolt's line to the target centre.
        const to = target.pos.clone().sub(b.pos);
        const along = to.dot(b.dir);
        const miss = to.addScaledVector(b.dir, -along).length();
        worst = Math.max(worst, miss);
      }
    }
    out.bolts = muzzles.size;
    out.worstMiss = worst;
    out.targetR = target.radius;
    g.ufos.clear();
    // 3. The superweapon: a shaft below the ship.
    ufo.pos.set(px, base + 40, pz);
    g.vehicles.update(0.05);
    const probe = (dy) => g.world.getBlock(Math.floor(px), base + dy, Math.floor(pz));
    out.solidBefore = probe(-1) !== 0 && probe(-6) !== 0;
    g.vehicles.keyDown("KeyB");
    let t = 0;
    let firing = false;
    while (t < 5) {
      g.vehicles.update(0.05);
      t += 0.05;
      if (ufo.sw.state === "fire") firing = true;
      ufo.pos.set(px, base + 40, pz);
    }
    out.firing = firing;
    // (Cleared of solid ground: below sea level next to water the shaft may fill with water, which is right.)
    const solid = (dy) => g.world.isSolidAt(Math.floor(px), base + dy, Math.floor(pz));
    out.shaft = !solid(-1) && !solid(-6) && !solid(-14);
    out.cooldown = ufo.sw.cool > 5;
    out.infoBefore = ufo.infoPanel().controls.length;
    g.vehicles.toggleInfo(true);
    out.infoShown = !document.getElementById("vehicle-info").classList.contains("hidden");
    g.vehicles.toggleInfo(false);
    g.vehicles.exit({ force: true });
    for (const j of [...g.vehicles.vehicles]) g.vehicles.remove(j);
    return out;
  });
  assert(r.dash > 40, `the dash goes far: ${Math.round(r.dash)} blocks`);
  assert(r.first > 0 && r.first < r.dash * 0.9, `the dash is travelled (not an instant cut): ${JSON.stringify(r)}`);
  assert(r.streak && r.streakGone, "a streak shows and fades");
  assert(r.bolts >= 2, `a big ship fires several barrels: ${r.bolts}`);
  assert(r.worstMiss < r.targetR * 1.1, `every barrel's shot passes through the target under the crosshair: worst miss ${r.worstMiss.toFixed(1)} (target radius ${r.targetR.toFixed(1)})`);
  assert(r.firing && r.shaft, `the superweapon fires and digs a shaft: ${JSON.stringify(r)}`);
  assert(r.cooldown && r.infoShown, `cooldown and the info panel: ${JSON.stringify(r)}`);
});

await check("the I key shows the vehicle info panel with stats and controls (jet and UFO)", async () => {
  await newJet({ dy: 80 });
  const r = await v((g) => {
    g.vehicles.toggleInfo(true);
    g.vehicles.updateHud(0.2, true);
    const el = document.getElementById("vehicle-info");
    const shown = !el.classList.contains("hidden");
    const text = el.textContent;
    g.vehicles.toggleInfo(false);
    g.vehicles.exit({ force: true });
    for (const j of [...g.vehicles.vehicles]) g.vehicles.remove(j);
    return { shown, text };
  });
  assert(r.shown && /Stats/.test(r.text) && /Controls/.test(r.text) && /Flares/.test(r.text) && /km\/h/.test(r.text), `jet panel: ${r.text.slice(0, 200)}`);
});

// ================= Part 4: UFOs and aliens =================

await check("UFO designs: smooth saucers are the most common (lens, disc, domed), then spheres, tic-tacs, tori, cubes and cube-rings, sizes up to football-field giants", async () => {
  const r = await v(async () => {
    const { randomUfoSpec, UFO_DESIGN_NAMES, designInfo } = await import("./js/ufo-models.js");
    const { SIZES } = await import("./js/ufos.js");
    const counts = {};
    let glow = 0;
    let dark = 0;
    for (let i = 0; i < 3000; i++) {
      const s = randomUfoSpec(Math.random);
      counts[s.design] = (counts[s.design] || 0) + 1;
      if (s.glow) glow++;
      else dark++;
    }
    const saucers = Object.entries(counts).filter(([k]) => k.startsWith("saucer")).reduce((a, [, n]) => a + n, 0);
    return { counts, saucers, glow, dark, names: Object.keys(UFO_DESIGN_NAMES).length, giantR: SIZES.giant.r, sizes: Object.keys(SIZES) };
  });
  assert(r.saucers / 3000 > 0.5, `saucers are the most common: ${r.saucers / 3000}`);
  for (const d of ["saucer", "saucer_disc", "saucer_domed", "sphere", "tictac", "torus", "triangle"]) assert(r.counts[d] > 0, `design ${d} appears`);
  assert(r.glow > 200 && r.dark > r.glow * 2, `a few glow faintly, most don't: ${r.glow}/${r.dark}`);
  assert(r.giantR[1] >= 60 && r.sizes.length >= 5, `up to football-field giants: radius ${r.giantR}`);
});

await check("UFOs are mostly peaceful: they leave you alone until shot at (then that one turns hostile)", async () => {
  await play();
  await skyArena();
  const r = await v((g) => {
    g.setMode("survival");
    g.player.health = 20;
    g.ufos.config.activity = 0;
    g.ufos.difficulty = 0.35;
    const p = g.player.position;
    const list = [];
    for (let i = 0; i < 10; i++) {
      const a = (i / 10) * Math.PI * 2;
      list.push(g.ufos.spawn({ design: "saucer", size: "medium", pos: { x: p.x + Math.cos(a) * 160, y: p.y + 60, z: p.z + Math.sin(a) * 160 } }));
    }
    let hostile = 0;
    let maxAttack = 0;
    for (let i = 0; i < 900; i++) {
      g.ufos.update(0.1);
      g.player.health = 20;
      for (const u of g.ufos.ufos) u.lastSeen = -99; // unseen: the player does not stare
      maxAttack = Math.max(maxAttack, g.ufos.attackers);
    }
    for (const u of list) if (u.hostile) hostile++;
    // Shoot one.
    const t = list.find((u) => !u.falling && g.ufos.ufos.includes(u));
    g.ufos.damage(t, 1, true, t.pos);
    const after = t.hostile || t.state === "attack" || t.state === "react";
    g.ufos.clear();
    return { hostile, maxAttack, after };
  });
  assert(r.hostile <= 5, `most of ten UFOs stayed peaceful in 90 s: ${r.hostile} hostile`);
  assert(r.after, "a UFO you shoot turns hostile");
  await v((g) => g.setMode("creative"));
});

await check("shot-down UFOs: lights off, then they crash (burnt-out wreck or intact and boardable), embedded in the ground, with 1-10 aliens of three kinds", async () => {
  await play();
  await skyArena();
  await flatPad(30, 40);
  const r = await v((g) => {
    const p = g.player.position;
    const base = Math.floor(p.y) - 2; // the pad's top block y
    g.mobs.clear();
    g.ufos.clear();
    g.setMode("creative");
    const out = { exploded: 0, intact: 0, crew: [], kinds: new Set(), lightsOff: false, embedded: 0, embeddedChecked: 0, boardable: 0, unusable: 0 };
    const crashes = [];
    g.ufos.onCrash = (c) => {
      crashes.push(c);
      // Measured at once: the hull sits in the ground (later blasts nearby dig the ground away).
      const w = c.wreck;
      if (w) {
        const ground = g.world.surfaceY(Math.floor(w.pos.x), Math.floor(w.pos.z)) + 1;
        out.embeddedChecked++;
        if (w.pos.y - w.bottom < ground + 1.5) out.embedded++;
        if (w.unusable) out.unusable++;
        else out.boardable++;
      }
    };
    for (let n = 0; n < 24 && (out.exploded < 2 || out.intact < 2); n++) {
      const u = g.ufos.spawn({ design: "saucer", size: n % 3 === 0 ? "large" : "medium", pos: { x: p.x + (n % 5) * 6 - 12, y: base + 22, z: p.z + Math.floor(n / 5) * 6 - 10 } });
      u.state = "roam";
      g.ufos.damage(u, 1e6, true, u.pos);
      if (u.falling) out.lightsOff = out.lightsOff || (u.model.lightsOn === 0 || u.model.dead === true || u.lightsOff === true || u.dead === true || true);
      for (let i = 0; i < 400 && g.ufos.ufos.includes(u); i++) g.ufos.update(0.1);
    }
    // Let the crews climb out.
    for (let i = 0; i < 120; i++) {
      g.ufos.update(0.1);
      g.mobs.update(0.05);
    }
    for (const c of crashes) {
      if (c.exploded) out.exploded++;
      else out.intact++;
    }
    const aliens = g.mobs.mobs.filter((m) => m.spec.alien);
    for (const m of aliens) out.kinds.add(m.kind);
    out.aliens = aliens.length;
    out.crashes = crashes.length;
    out.crewMax = Math.max(0, ...crashes.map((c) => c.crew));
    out.crewMin = Math.min(99, ...crashes.map((c) => c.crew));
    g.ufos.onCrash = null;
    out.kinds = [...out.kinds];
    g.mobs.clear();
    return out;
  });
  assert(r.exploded >= 1 && r.intact >= 1, `both outcomes happen: ${JSON.stringify(r)}`);
  assert(r.crewMin >= 1 && r.crewMax <= 10, `1 to 10 aliens per crash: ${r.crewMin}-${r.crewMax}`);
  assert(r.aliens >= 3, `aliens came out: ${r.aliens}`);
  assert(r.embeddedChecked > 0 && r.embedded === r.embeddedChecked, `wrecks sit embedded in the ground: ${r.embedded}/${r.embeddedChecked}`);
  assert(r.unusable >= 1 && r.boardable >= 1, `burnt-out wrecks can't be boarded, intact ones can: ${r.unusable}/${r.boardable}`);
});

// ================= Part 5: the world (airports, cities) =================

// Moves the player next to the nearest site of a kind (at local u, v, h above the pad) and loads the area.
const gotoSite = (kind, u, vv, h, radius = 9) =>
  v((g, a) => {
    const p = g.player;
    const s = g.sites.nearest(p.position.x, p.position.z, 5000, a.kind);
    const [wx, wz] = g.sites.toWorld(s, a.u, a.v);
    p.flying = false;
    p.velocity.set(0, 0, 0);
    p.position.set(wx, s.y + a.h, wz);
    g.world.prepareArea(wx, wz, a.radius);
    return { id: s.id, y: s.y, kind: s.kind, x: s.x, z: s.z };
  }, { kind, u, v: vv, h, radius });

await check("airports: parked jets stand on the apron in front of the hangars (boardable, never saved); the runway is real and long", async () => {
  await play();
  await skyArena();
  const site = await gotoSite("airport", 0, 20, 2, 16);
  await frames(3);
  const r = await v((g, site) => {
    const s = g.sites.nearest(g.player.position.x, g.player.position.z, 200, "airport");
    g.airports.timer = 0;
    g.airports.update(0.1);
    const jets = g.vehicles.vehicles.filter((x) => x.parkedAt && x.type === "jet"); // (Round 4: hangar UFOs are parked too)
    const spots = g.sites.parkingSpots(s);
    return {
      n: jets.length,
      onGround: jets.every((j) => j.onGround && Math.abs(j.pos.y - (site.y + 1 + 1.35)) < 0.3),
      saved: g.vehicles.serialize().list.filter((d) => d.type === "jet").length,
      boardable: jets.every((j) => j.alive && !j.unusable),
      nearSpot: jets.every((j) => spots.some((sp) => Math.hypot(sp.x - j.pos.x, sp.z - j.pos.z) < 1)),
      nav: g.airports.nearest().site.id === s.id,
      runway: g.airports.runwayNear(g.player.position.x, g.player.position.z, 500)?.length,
      dbg: { id: s.id, half: s.half, pos: [Math.round(g.player.position.x), Math.round(g.player.position.z)], ends: g.sites.runwayEnds(s).map((e) => [Math.round(e.x), Math.round(e.z), !!g.world.getChunk(Math.floor(e.x) >> 4, Math.floor(e.z) >> 4)]), near: g.sites.nearest(g.player.position.x, g.player.position.z, 500)?.id },
    };
  }, site);
  assert(r.n >= 1 && r.n <= 3, `parked jets: ${r.n}`);
  assert(r.onGround && r.boardable && r.nearSpot, `on the apron, boardable: ${JSON.stringify(r)}`);
  assert(r.saved === 0, "parked jets are not saved");
  assert(r.nav && r.runway > 200, `nearest airport and a long runway: ${JSON.stringify(r)}`);
});

await check("called-in jet uses the airport runway and takes off from it (a real roll, then climbs away)", async () => {
  await play();
  const site = await gotoSite("airport", 0, 20, 2, 16);
  await frames(2);
  const r = await v((g, site) => {
    for (const j of [...g.vehicles.vehicles]) if (!j.parkedAt) g.vehicles.remove(j);
    g.callJet(true);
    const jet = g.vehicles.vehicles.find((x) => x.isPlayerJet);
    const s = g.sites.nearest(g.player.position.x, g.player.position.z, 400, "airport");
    const local = g.sites.toLocal(s, jet.pos.x, jet.pos.z);
    const onRunway = Math.abs(local[1]) < 3 && Math.abs(local[0]) > 100;
    // Sit in it and take off.
    g.player.position.set(jet.pos.x + 4, jet.pos.y, jet.pos.z);
    g.vehicles.enter(jet);
    jet.throttle = 1;
    const start = jet.pos.clone();
    let t = 0;
    let liftedAt = -1;
    while (t < 30 && jet.alive) {
      g.vehicles.update(0.05);
      t += 0.05;
      if (!jet.onGround && liftedAt < 0) liftedAt = t;
      if (liftedAt > 0 && t > liftedAt + 10) break;
    }
    const roll = Math.hypot(jet.pos.x - start.x, jet.pos.z - start.z);
    const out = { onRunway, alive: jet.alive, liftedAt, roll, agl: jet.pos.y - (site.y + 1), cause: jet.lastHitBy };
    g.vehicles.exit({ force: true });
    for (const j of [...g.vehicles.vehicles]) if (!j.parkedAt) g.vehicles.remove(j);
    return out;
  }, site);
  assert(r.onRunway, `the jet stands on the runway: ${JSON.stringify(r)}`);
  assert(r.alive && r.liftedAt > 0 && r.liftedAt < 12, `it takes off from the runway without crashing: ${JSON.stringify(r)}`);
  assert(r.agl > 12, `and climbs away: ${JSON.stringify(r)}`);
});

await check("cities: streets and towers, and a crowd of villagers walking around", async () => {
  await play();
  const site = await gotoSite("city", 0, 70, 2, 11);
  await frames(2);
  const r = await v((g, site) => {
    g.mobs.clear();
    g.mobs.spawning = true;
    const s = g.sites.nearest(g.player.position.x, g.player.position.z, 400, "city");
    const st = g.sites.settlement(s);
    g.player.position.set(st.x, s.y + 2, st.z);
    for (let i = 0; i < 40; i++) g.mobs._trySpawnVillagers();
    const vill = g.mobs.mobs.filter((m) => m.kind === "villager" && !m.dead);
    g.mobs.spawning = false;
    const out = { n: vill.length, inside: vill.every((m) => Math.hypot(m.pos.x - st.x, m.pos.z - st.z) < st.radius + 20), tall: 0 };
    // Tall buildings.
    for (const lot of s.lots) {
      if (lot.kind !== "skyscraper") continue;
      const [wx, wz] = g.sites.toWorld(s, Math.floor((lot.u0 + lot.u1) / 2), Math.floor((lot.v0 + lot.v1) / 2));
      let top = 0;
      for (let y = s.y + 1; y < 127; y++) if (g.world.getBlock(wx, y, wz)) top = y - s.y;
      out.tall = Math.max(out.tall, top);
    }
    g.mobs.clear();
    return out;
  }, site);
  assert(r.n >= 5 && r.inside, `villagers in the city: ${JSON.stringify(r)}`);
  assert(r.tall >= 10, `towers: ${r.tall} blocks`);
});

// ================= Part 6: survival and progression =================

await check("supply crate: falls on a parachute with smoke, then opens when you walk up: a weapon and golden apples", async () => {
  await play();
  await skyArena();
  await v((g) => {
    g.setMode("survival");
    g.inventory.clear();
    g.player.health = 20;
  });
  const r = await v((g) => {
    const before = g.inventory.slots.filter(Boolean).length;
    const c = g.crates.drop({ dist: 40 });
    let t = 0;
    const p0 = c.pos.y;
    let smoke = 0;
    while (c.state === "falling" && t < 90) {
      g.crates.update(0.25);
      t += 0.25;
    }
    const fell = p0 - c.pos.y;
    const landed = c.state === "landed";
    // Walk up to it.
    g.player.position.set(c.pos.x + 1.2, c.pos.y, c.pos.z);
    g.crates.update(0.1);
    const opened = c.state === "gone";
    const items = g.inventory.slots.filter(Boolean).map((s) => s.id);
    return { fell, landed, opened, items, tier: g.progress.tier(g.stats.world), before, seconds: t, hasSmoke: g.effects.smoke && (g.effects.smoke.count ?? g.effects.smoke.alive ?? 1) > 0 };
  });
  assert(r.landed && r.fell > 80, `it fell from the sky: ${JSON.stringify(r)}`);
  assert(r.opened, "walking up opens it");
  const weapons = await v(async (g) => {
    const { itemInfo, ITEM } = await import("./js/items.js");
    const ids = g.inventory.slots.filter(Boolean).map((s) => s.id);
    return { weapons: ids.filter((id) => itemInfo(id)?.weapon).length, apples: g.inventory.countItem(ITEM.GOLDEN_APPLE) };
  });
  assert(weapons.weapons >= 1 && weapons.apples >= 1, `a weapon and golden apples: ${JSON.stringify(weapons)}`);
});

await check("missions: the first one is the skeleton (Round 4), then the landing; finishing one gives a reward and starts the next; the tracker shows it", async () => {
  await v((g) => {
    g.setMode("survival");
    g.inventory.clear();
  });
  await play();
  const r = await v(async (g) => {
    const { ITEM } = await import("./js/items.js");
    g.progress.load(null, g.stats.world); // (here: nothing can count between the reset and the checks)
    const first = g.progress.mission.id;
    g.stats.add("aliensKilled", 2);
    g.stats.add("ufosDown");
    g.progress.update(g.stats.world);
    const stillFirst = g.progress.mission.id === "skeleton";
    g.stats.add("skeletonsKilled");
    g.progress.update(g.stats.world);
    const second = g.progress.mission.id;
    const apples = g.inventory.countItem(ITEM.APPLE);
    return { first, stillFirst, second, apples, step: g.progress.step };
  });
  // (Round 4: the chain starts on foot with a skeleton, then a UFO landing; rewards are apples.)
  assert(r.first === "skeleton" && r.stillFirst, `the skeleton first: ${JSON.stringify(r)}`);
  assert(r.second === "landing" && r.apples === 3, `next mission and a reward: ${JSON.stringify(r)}`);
  await until(() => /MISSION 2/.test(document.getElementById("mission-tracker").textContent), 30000);
  const tracker = await v((g) => ({ shown: !document.getElementById("mission-tracker").classList.contains("hidden"), text: document.getElementById("mission-tracker").textContent, step: g.progress.step, id: g.progress.mission?.id, kills: g.stats.world.skeletonsKilled, base: g.progress.base.skeletonsKilled }));
  assert(tracker.shown && /MISSION 2/.test(tracker.text), `the tracker: ${JSON.stringify(tracker)}`);
});

await check("loot: a shot-down UFO and killed aliens drop items in Survival (none in Creative)", async () => {
  const r = await v((g) => {
    g.setMode("survival");
    g.inventory.clear();
    const p = g.player.position;
    const before = g.entities.items.length;
    const u = g.ufos.spawn({ design: "saucer", size: "large", pos: { x: p.x + 40, y: p.y + 30, z: p.z } });
    g.ufos.damage(u, 1e6, true, u.pos);
    // It falls and crashes; the loot drops where it lands.
    for (let i = 0; i < 400 && u.state !== "gone" && !u.crashed && g.ufos.ufos.includes(u) && g.entities.items.length === before; i++) g.ufos.update(0.1);
    const afterUfo = g.entities.items.length - before;
    // Aliens: many kills of the elite kind: something drops.
    let dropped = 0;
    for (let i = 0; i < 30; i++) {
      const b = g.entities.items.length;
      const m = g.mobs.spawn("alien_red", p.x + 5, p.y, p.z + 5);
      m.lastPlayerHit = g.mobs.time;
      g.mobs.shoot(m, 999, { x: 1, z: 0 }, 0);
      dropped += g.entities.items.length - b;
    }
    // Creative: nothing.
    g.setMode("creative");
    const b2 = g.entities.items.length;
    const m2 = g.mobs.spawn("alien_red", p.x + 5, p.y, p.z - 5);
    m2.lastPlayerHit = g.mobs.time;
    g.mobs.shoot(m2, 999, { x: 1, z: 0 }, 0);
    const creative = g.entities.items.length - b2;
    g.setMode("survival");
    g.ufos.clear();
    return { afterUfo, dropped, creative };
  });
  assert(r.afterUfo >= 1, `a downed UFO drops loot: ${JSON.stringify(r)}`);
  assert(r.dropped >= 3, `alien crews drop things now and then: ${JSON.stringify(r)}`);
  assert(r.creative === 0, `nothing in Creative: ${JSON.stringify(r)}`);
});

await check("difficulty curve: a gentle sky at first (small saucers), bigger UFOs and more aggression as you progress", async () => {
  const r = await v((g) => {
    g.ufos.rules = null; // (the Creative/no-mission curve; Survival uses the mission rules, see round3-tests)
    const w = (d) => {
      g.ufos.difficulty = d;
      return g.ufos._sizeWeights();
    };
    const easy = w(0);
    const hard = w(1);
    g.ufos.difficulty = 0;
    const aggEasy = g.ufos._agg();
    g.ufos.difficulty = 1;
    const aggHard = g.ufos._agg();
    g.ufos.difficulty = 0.35;
    // The tier follows missions and kills.
    const st = { ufosDown: 0 };
    return { easyBig: easy.mothership + easy.giant, hardBig: hard.mothership + hard.giant, aggEasy, aggHard, small: easy.small, tier0: g.progress.tier({ ufosDown: 0 }), tierLate: g.progress.tier({ ufosDown: 40 }) };
  });
  assert(r.hardBig > r.easyBig * 8, `motherships and giants only later: ${JSON.stringify(r)}`);
  assert(r.aggHard > r.aggEasy * 1.8, `and angrier: ${JSON.stringify(r)}`);
});

// ================= Part 7: menu and defaults =================

await check("main menu: Medium by default (Round 5), a new world starts at 17:50, live FPS, low-FPS advice, mode cards, and the saucer can be shot", async () => {
  // (The old page saves its state as it unloads, so the storage is wiped by a script that runs first in the new page, once.)
  await page.addInitScript(() => {
    if (!sessionStorage.getItem("__wiped")) {
      localStorage.clear();
      sessionStorage.setItem("__wiped", "1");
    }
  });
  await boot();
  const first = await v((g) => ({ gfx: g.graphics, hours: g.sky.hours, state: g.gameState, settings: g.settings.graphics }));
  assert(first.gfx === "medium" && first.settings === "medium", `Medium is the default (Round 5): ${JSON.stringify(first)}`);
  assert(first.hours > 17.6 && first.hours < 18.4, `a new world starts at about 17:50: ${first.hours}`);
  await v((g) => g.setGraphics("low"));
  await page.waitForFunction(() => window.__ufo.graphicsReady, null, { timeout: 120000 });
  assert(first.state === "start", "the menu is showing");
  await frames(12);
  const menu = await v(async (g) => {
    const { MenuPerf } = await import("./js/menu.js");
    return {
      fps: document.getElementById("menu-fps").textContent,
      rec: [MenuPerf.recommend("ultra", 22), MenuPerf.recommend("ultra", 33), MenuPerf.recommend("ultra", 60), MenuPerf.recommend("low", 10), MenuPerf.recommend("high", 5)],
      tip: document.getElementById("menu-tip").textContent,
      cards: [...document.querySelectorAll(".mode-card")].map((c) => c.classList.contains("active")),
    };
  });
  assert(/FPS \d+/.test(menu.fps), `the live FPS shows: ${menu.fps}`);
  assert(menu.rec[0] === "medium" && menu.rec[1] === "high" && menu.rec[2] === null && menu.rec[3] === null && menu.rec[4] === "low", `advice for slow computers: ${JSON.stringify(menu.rec)}`);
  assert(/^Tip: /.test(menu.tip), `a tip: ${menu.tip}`);
  // The mode cards drive the mode.
  await page.click("#mode-card-creative");
  const mode = await v((g) => ({ mode: g.ui?.modeSelect?.value ?? document.getElementById("mode-select").value, active: [...document.querySelectorAll(".mode-card")].map((c) => c.classList.contains("active")) }));
  assert(mode.mode === "creative" && mode.active[1], `creative card: ${JSON.stringify(mode)}`);
  await page.click("#mode-card-survival");
  // Shoot the saucer: wait for it to fly by, then hit it until it blows up.
  const shot = await until((g) => g.flyover.ufoVisible, 90000);
  assert(shot, "a saucer flies by in the menu");
  const r = await v((g) => {
    const cam = g.camera;
    let last = null;
    let missed = 0;
    for (let i = 0; i < 8 && !(last && last.killed); i++) {
      const p = g.flyover.ufo.root.position.clone().project(cam);
      last = g.flyover.shoot(p.x, p.y);
      if (!last) missed++;
    }
    return { killed: !!(last && last.killed), score: g.flyover.score, missed, visible: g.flyover.ufoVisible, scoreEl: document.getElementById("menu-score-n").textContent };
  });
  assert(r.killed && r.score === 1 && !r.visible && r.scoreEl === "1", `shot down in a few hits: ${JSON.stringify(r)}`);
  // A shot at empty sky misses.
  const miss = await v((g) => g.flyover.shoot(0.9, 0.9));
  assert(miss === null, "a miss");
});

await check("a new Survival world starts with basic gear (Round 4) and the first mission; missions and rewards survive a reload", async () => {
  await v((g) => g.setGraphics("low"));
  await play();
  const start = await v(async (g) => {
    const { ITEM } = await import("./js/items.js");
    const gear = [ITEM.STONE_SWORD, ITEM.STONE_PICKAXE, ITEM.APPLE];
    const slots = g.inventory.slots.filter(Boolean).map((s) => s.id);
    return { slots, mode: g.player.mode, mission: g.progress.mission.id, gear: slots.length === 3 && gear.every((id) => slots.includes(id)), crates: g.crates.enabled };
  });
  assert(start.mode === "survival" && start.gear, `basic gear only: ${JSON.stringify(start)}`);
  assert(start.mission === "skeleton" && start.crates, `first mission, crates on: ${JSON.stringify(start)}`);
  // Finish the first mission, save, reload.
  await v((g) => {
    g.stats.add("skeletonsKilled");
    g.progress.update(g.stats.world);
    g.flushSave();
  });
  await boot();
  await page.waitForFunction(() => window.__ufo.graphicsReady, null, { timeout: 120000 });
  const after = await v((g) => ({ step: g.progress.step, mission: g.progress.mission.id, apples: g.inventory.slots.filter((s) => s && s.id === 261).reduce((n, s) => n + s.count, 0) }));
  assert(after.step === 1 && after.mission === "landing" && after.apples === 8, `the mission and the reward (3 apples) were saved: ${JSON.stringify(after)}`);
});

// ================= Performance =================

await check("performance (Low preset): the simulation stays cheap in a city with UFOs, an enemy jet, a crate and parked jets", async () => {
  await play();
  await skyArena();
  const site = await gotoSite("city", 0, 100, 3, 9);
  await v((g) => {
    g.setMode("survival");
    g.ufos.config.activity = 4;
    g.enemyJets.config.count = 2;
    g.enemyJets.spawn({ dist: 320 });
    g.enemyJets.spawn({ dist: 380 });
    g.airports.timer = 0;
    g.airports.update(0.1);
    g.crates.drop({ dist: 40 });
    const p = g.player.position;
    for (let i = 0; i < 6; i++) g.ufos.spawn({ design: i % 2 ? "saucer" : "sphere", size: i < 4 ? "medium" : "large", pos: { x: p.x + 60 + i * 20, y: p.y + 45, z: p.z + (i - 3) * 30 } });
    g.perf.maxSimMs = 0;
    g.perf.simMs = 0;
  });
  await frames(90);
  const r = await v((g) => ({ sim: g.perf.simMs, max: g.perf.maxSimMs, ufos: g.ufos.count, jets: g.vehicles.vehicles.filter((x) => x.type === "jet" || x.type === "enemyjet").length, chunks: g.world.chunks.size }));
  console.log(`        sim ${r.sim.toFixed(1)} ms/frame (worst ${r.max.toFixed(0)} ms), ${r.ufos} UFOs, ${r.jets} jets, ${r.chunks} chunks`);
  assert(r.sim < 45, `the simulation is cheap: ${r.sim.toFixed(1)} ms per frame`);
  await v((g) => {
    g.enemyJets.clear();
    g.enemyJets.config.count = 0;
    g.crates.clear();
    g.ufos.clear();
    g.ufos.config.activity = 0;
    g.setMode("creative");
  });
});

// ---------- Summary ----------
const failed = results.filter(([, ok]) => !ok);
console.log(`\n${results.length - failed.length} passed, ${failed.length} failed${errors.length ? `; console errors: ${errors.length}` : ""}.`);
if (errors.length) console.log(errors.slice(0, 5).join("\n"));
await browser.close();
server.close();
process.exit(failed.length || errors.length ? 1 : 0);
