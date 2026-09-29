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
  if ((await v((g) => g.gameState)) === "playing") return;
  const btn = (await v((g) => g.gameState)) === "start" ? "#play-btn" : "#resume-btn";
  await page.click(btn, { timeout: 60000 });
  await page.waitForFunction(() => window.__ufo.gameState === "playing", null, { timeout: 30000 });
}

// Sets up an open, flat area high above the terrain (nothing in the way of
// rays or flight) and puts the player in it.
async function skyArena() {
  await v((g) => {
    g.setMode("creative");
    g.ufos.config.activity = 0;
    g.mobs.spawning = false;
    g.mobs.hostileSpawning = false;
    g.ufos.clear();
    g.mobs.clear();
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
  // 3. Back to a fast preset for the rest.
  await v((g) => g.setGraphics("low", { userPick: true }));
  await page.waitForFunction(() => window.__ufo.graphicsReady, null, { timeout: 120000 });
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
    // Aim at it and fire the pistol (hitscan).
    g.weapons.firePistol();
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
    for (let k = 0; k < 8 && p.health >= hp0; k++) {
      // (A few shots: the aim error is a block or two at this range.)
      p._invulnerable = 0;
      g.ufos._fireAt(u, p.position.clone().setY(p.position.y + 1), new g.THREE.Vector3(), 1);
      let s = 0;
      while (s < 5 && p.health >= hp0 && g.lasers.bolts.length > 0) {
        g.lasers.update(0.05);
        s += 0.05;
        t += 0.05;
      }
    }
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
    const far = [place("alien", 110, 8)];
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
    const farD0 = Math.hypot(far[0].pos.x - p.position.x, far[0].pos.z - p.position.z);
    let t = 0;
    while (t < 16) {
      g.mobs.update(0.05);
      t += 0.05;
      p.health = 20;
    }
    const farD1 = Math.hypot(far[0].pos.x - p.position.x, far[0].pos.z - p.position.z);
    g.mobs._shootLaser = orig;
    return { angles, farD0, farD1 };
  });
  assert(r.angles.length >= 3, `they shoot: ${r.angles.length} shots`);
  assert(r.angles.every((a) => a < 0.45), `every shot was fired facing the player: max ${Math.max(...r.angles).toFixed(2)} rad`);
  assert(r.farD1 < r.farD0 - 25, `an alien far away came for the player at once: ${Math.round(r.farD0)} -> ${Math.round(r.farD1)}`);
  await v((g) => {
    g.mobs.clear();
    g.setMode("creative");
  });
});

await check("skeletons face the player when they shoot", async () => {
  await play();
  await skyArena();
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

// ---------- Summary ----------
const failed = results.filter(([, ok]) => !ok);
console.log(`\n${results.length - failed.length} passed, ${failed.length} failed${errors.length ? `; console errors: ${errors.length}` : ""}.`);
if (errors.length) console.log(errors.slice(0, 5).join("\n"));
await browser.close();
server.close();
process.exit(failed.length || errors.length ? 1 : 0);
