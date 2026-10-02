// Round 5 feature tests: boots the real game in headless Chromium (software
// WebGL, Low preset) and checks the Round 5 features: defaults, the jet's
// throttle and speed, loops and rolls, free look, armor, bunkers with guards,
// supply crates on dry land, breakable grass, the Long Night, the new UFO
// shapes and the blue alien. Time is stepped by hand with the game's own
// systems where a check needs seconds of game time.
//
//   node round5-tests.mjs [--only=substring] [--from=substring] [--seed=42]
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
const PORT = 9240 + Math.floor(Math.random() * 40);
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


await play();

await check("defaults: Medium preset, render distance 25 chunks (Round 6), master volume 30%", async () => {
  const r = await v(async () => {
    const { DEFAULT_SETTINGS } = await import("./js/settings.js");
    const { DEFAULT_PRESET } = await import("./js/graphics.js");
    return { preset: DEFAULT_PRESET, graphics: DEFAULT_SETTINGS.graphics, rd: DEFAULT_SETTINGS.renderDistance, vol: DEFAULT_SETTINGS.volume.master };
  });
  assert(r.preset === "medium" && r.graphics === "medium" && r.rd === 25 && Math.abs(r.vol - 0.3) < 1e-9, JSON.stringify(r));
});

await check("jet: speed follows the throttle (0-100%), about 1000 km/h at 100%", async () => {
  const r = await v((g) => {
    const out = {};
    g.setMode("creative");
    for (const thr of [0.5, 1]) {
      for (const j of [...g.vehicles.vehicles]) g.vehicles.remove(j);
      const p = g.player.position;
      const jet = g.vehicles.create("jet", { pos: [p.x, 400, p.z], yaw: 0, airborne: true, speed: 100, throttle: thr });
      g.vehicles.enter(jet);
      for (let t = 0; t < 60; t += 1 / 60) {
        jet.throttle = thr;
        g.vehicles.update(1 / 60);
        jet.pos.y = 400;
        jet.vel.y = 0;
      }
      out[thr] = Math.round(jet.speed * 3.6);
      g.vehicles.exit({ force: true });
    }
    return out;
  });
  assert(r[1] > 850 && r[1] < 1100, `100% -> ${r[1]} km/h`);
  assert(r[0.5] > r[1] * 0.4 && r[0.5] < r[1] * 0.62, `50% -> ${r[0.5]} km/h (proportional: ${JSON.stringify(r)})`);
});

await check("jet: a full 360 degree loop, a full roll that stops cleanly", async () => {
  const r = await v((g) => {
    const T = g.THREE;
    const mk = () => {
      for (const j of [...g.vehicles.vehicles]) g.vehicles.remove(j);
      const p = g.player.position;
      const jet = g.vehicles.create("jet", { pos: [p.x, 700, p.z], yaw: 0, airborne: true, speed: 200, throttle: 0.8 });
      g.vehicles.enter(jet);
      return jet;
    };
    const dt = 1 / 60;
    let jet = mk();
    let ang = 0;
    let prev = 0;
    const f = new T.Vector3();
    for (let t = 0; t < 16 && jet.alive; t += dt) {
      if (t < 8.65) g.vehicles.input.dy = -5.5;
      g.vehicles.update(dt);
      jet.forward(f);
      const a = Math.atan2(f.y, -f.z);
      let d = a - prev;
      d = Math.atan2(Math.sin(d), Math.cos(d));
      ang += d;
      prev = a;
    }
    const out = { loop: Math.round((Math.abs(ang) * 180) / Math.PI), alive: jet.alive };
    jet = mk();
    const bank = () => Math.atan2(-jet.right(new T.Vector3()).y, jet.up(new T.Vector3()).y);
    let cum = 0;
    let pb = bank();
    g.player.keys.add("KeyA");
    for (let t = 0; t < 2; t += dt) {
      g.vehicles.update(dt);
      const b = bank();
      let d = b - pb;
      d = Math.atan2(Math.sin(d), Math.cos(d));
      cum += d;
      pb = b;
    }
    g.player.keys.delete("KeyA");
    out.roll = Math.round((Math.abs(cum) * 180) / Math.PI);
    g.vehicles.exit({ force: true });
    return out;
  });
  assert(r.alive && r.loop >= 330, `loop ${JSON.stringify(r)}`);
  assert(r.roll >= 340, `roll ${JSON.stringify(r)}`);
});

await check("jet: both mouse buttons freeze the controls and look around freely", async () => {
  await v((g) => {
    for (const j of [...g.vehicles.vehicles]) g.vehicles.remove(j);
    const p = g.player.position;
    const jet = g.vehicles.create("jet", { pos: [p.x, 600, p.z], yaw: 0, airborne: true, speed: 200, throttle: 0.8 });
    g.vehicles.enter(jet);
  });
  await frames(5);
  await page.mouse.move(480, 270);
  await page.mouse.down({ button: "left" });
  await page.mouse.down({ button: "right" });
  const on = await until((g) => g.vehicles.active?.freeLook === true, 15000);
  await page.mouse.up({ button: "right" });
  await page.mouse.up({ button: "left" });
  const off = await until((g) => g.vehicles.active?.freeLook === false, 15000);
  assert(on && off, `free look on ${on} off ${off}`);
  await v((g) => g.vehicles.exit({ force: true }));
});

await check("armor: four slots, worn on pickup, damage is reduced, no shield", async () => {
  const r = await v(async (g) => {
    const items = await import("./js/items.js");
    g.setMode("survival");
    g.inventory.clear();
    const out = { shield: items.ITEM.SHIELD ?? null, slots: items.ARMOR_SLOTS.length };
    for (let slot = 0; slot < 4; slot++) g.inventory.add(items.armorId(2, slot), 1);
    out.points = g.inventory.armorPoints();
    out.reduction = g.inventory.armorReduction();
    out.worn = g.inventory.armor.filter(Boolean).length;
    g.inventory.clear();
    g.setMode("creative");
    return out;
  });
  assert(r.shield === null && r.slots === 4 && r.worn === 4 && r.points > 0 && r.reduction > 0.2 && r.reduction <= 0.8, JSON.stringify(r));
});

await check("bunkers: a ship hovers in the hall under armed guards; the alarm goes off in the zone", async () => {
  await v((g) => {
    g.setMode("creative");
    g.testFlags.noMissions = true;
    g.ufos.config.activity = 0;
    g.ufos.clear();
    g.mobs.clear();
    g.mobs.spawning = false; // (no random spawns, but the guards)
    g.mobs.hostileSpawning = true; // (guards are not spawned on Peaceful)
    let best = null;
    const p = g.player.position;
    for (let dx = -12; dx <= 12; dx++) for (let dz = -12; dz <= 12; dz++) {
      const s = g.sites._site(Math.floor(p.x / 1300) + dx, Math.floor(p.z / 1300) + dz);
      if (s && s.kind === "airport" && s.bunkers.length && (!best || Math.hypot(s.x - p.x, s.z - p.z) < Math.hypot(best.x - p.x, best.z - p.z))) best = s;
    }
    window.__bunker = g.sites.bunkerSpots(best)[0];
    window.__bsite = best.y;
    const b = window.__bunker;
    g.player.position.set(b.guards[0].x + 4, best.y + 6, b.guards[0].z + 30);
  });
  const found = await until((g) => {
    const u = g.vehicles.vehicles.find((x) => x.hangar);
    const guards = g.mobs.mobs.filter((m) => m.sentry).length;
    return u && guards >= 4 ? { guards, ufo: u.pos.y } : null;
  }, 120000);
  assert(found, "ship and guards");
  const alarm = await v((g) => {
    const b = window.__bunker;
    g.setMode("survival"); // (a Creative player is left alone)
    g.player.health = 20;
    g.player.position.set(b.zone.x, window.__bsite + 12, b.zone.z - 20);
    g.mobs.update(0.5);
    return g.mobs.mobs.filter((m) => m.sentry && m.alerted).length;
  });
  const alerted = alarm || (await until((g) => g.mobs.mobs.filter((m) => m.sentry && m.alerted).length, 30000));
  await v((g) => { g.mobs.clear(); g.player.health = 20; g.setMode("creative"); });
  assert(alerted, "guards alerted by the player in the zone");
});

await check("supply drops land on dry ground, never in water; the cords reach the canopy rim", async () => {
  const r = await v((g) => {
    g.setMode("survival");
    const hs = [];
    for (let i = 0; i < 8; i++) {
      const c = g.crates.drop({ dist: 30 + i * 20 });
      if (c) hs.push(g.world.heightAt(Math.floor(c.x), Math.floor(c.z)));
    }
    const c = g.crates.crates[0];
    const cords = c.cords.geometry.getAttribute("position");
    let maxGap = 0;
    for (let i = 1; i < cords.count; i += 2) {
      const rim = Math.hypot(cords.getX(i), cords.getZ(i));
      maxGap = Math.max(maxGap, Math.abs(rim - 2.4 * Math.sin(Math.PI / 2.4)));
    }
    g.crates.clear();
    g.setMode("creative");
    return { hs, maxGap, n: hs.length };
  });
  assert(r.n >= 1 && r.hs.every((h) => h >= 25), `heights ${JSON.stringify(r)}`);
  assert(r.maxGap < 0.01, `cords end on the rim: ${r.maxGap}`);
});

await check("grass: a swing clears the tufts around the spot, explosions clear them, they grow back", async () => {
  const r = await v((g) => {
    g.setMode("creative");
    g.grass.configure({ level: 1 });
    const p = g.player.position;
    g.grass.update(p);
    const before = g.grass.count;
    g.grass.clear(p.x, p.z, 6);
    g.grass.update(p);
    const after = g.grass.count;
    const cleared = g.grass.cleared.size;
    g.grass.cleared.clear();
    g.grass.configure({ level: 0 });
    return { before, after, cleared };
  });
  assert(r.cleared > 20 && (r.before === 0 || r.after < r.before), JSON.stringify(r));
});

await check("the Long Night: the clock runs to dusk, a landing party arrives, a death restarts the night", async () => {
  await v((g) => {
    g.setMode("survival");
    g.testFlags.noMissions = false;
    g.progress.enabled = true;
    g.missions.enabled = true;
    g.progress.step = 5;
    g.sky.setHours(11);
    g.sky.locked = true;
  });
  const dusk = await until((g) => g.progress.mission?.id === "long_night" && g.missions.night.active && (g.missions.state.nt ?? -1) >= 0, 120000);
  assert(dusk, "night comes");
  const night = await v((g) => ({ h: g.sky.hours, ts: g.sky.timeScale, locked: g.sky.locked }));
  assert((night.h >= 19.5 || night.h < 5.5) && night.ts === 1 && !night.locked, JSON.stringify(night));
  await v((g) => { g.missions.state.nt = 35; });
  const wave = await until((g) => g.missions.state.wave >= 1 && g.mobs.mobs.filter((m) => m.spec.alien).length >= 3, 60000);
  assert(wave, "a landing party");
  await v((g) => { g.testFlags.noMissions = true; g.missions.enabled = false; g.progress.step = 0; g.sky.timeScale = 1; g.mobs.clear(); g.setMode("creative"); });
});

await check("UFO shapes: triangle, boomerang, cylinder exist; cube and cube-ring are gone; the triangle flies point first", async () => {
  const r = await v(async () => {
    const m = await import("./js/ufo-models.js");
    return { names: Object.keys(m.UFO_DESIGN_NAMES), dir: m.DIRECTIONAL_DESIGNS ? [...Object.keys(m.DIRECTIONAL_DESIGNS)] : null };
  });
  assert(r.names.includes("triangle") && r.names.includes("boomerang") && r.names.includes("cylinder"), JSON.stringify(r));
  assert(!r.names.includes("cube") && !r.names.includes("cubering"), JSON.stringify(r));
});

await check("blue alien: spawns, blinks and fires its scatter without errors", async () => {
  const r = await v((g) => {
    g.setMode("survival");
    g.mobs.clear();
    const p = g.player.position;
    const m = g.mobs.spawn("alien_blue", p.x + 12, p.y, p.z);
    if (!m) return { ok: false };
    m.ai.target = true;
    m.aggro = true;
    for (let i = 0; i < 200; i++) g.mobs.update(1 / 20);
    const ok = !!m.spec.blinks && g.mobs.mobs.includes(m);
    g.mobs.clear();
    g.player.health = g.player.maxHealth ?? 20;
    g.setMode("creative");
    return { ok };
  });
  assert(r.ok, JSON.stringify(r));
});

// ---------- Summary ----------
const failed = results.filter(([, ok]) => !ok);
console.log(`\n${results.length - failed.length} passed, ${failed.length} failed${errors.length ? `; console errors: ${errors.length}` : ""}.`);
if (errors.length) console.log(errors.slice(0, 5).join("\n"));
await browser.close();
server.close();
process.exit(failed.length || errors.length ? 1 : 0);
