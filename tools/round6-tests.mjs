// Round 6 feature tests: boots the real game in headless Chromium (software
// WebGL, Low preset) and checks the Round 6 features: UI and fullscreen,
// balance and weapons, the nuke, jets (lock-on control, salvo, air brakes,
// roll evasion, airports), UFOs, missions and the world. Time is stepped by
// hand with the game's own systems where a check needs seconds of game time.
//
//   node round6-tests.mjs [--only=substring] [--from=substring] [--seed=42]
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

// ================= Part 1: UI and fullscreen =================

await check("fullscreen button is hidden until the mouse nears the corner; hotkey and keyboard lock hooks exist", async () => {
  const r = await v(() => {
    const btn = document.getElementById("fs-btn");
    return { exists: !!btn, op: getComputedStyle(btn).opacity, zone: !!document.getElementById("fs-zone") };
  });
  assert(r.exists && r.zone && Number(r.op) < 0.1, JSON.stringify(r));
  // F11 must be cancelled by the page (the game's own fullscreen handles it).
  const prevented = await page.evaluate(() => {
    const e = new KeyboardEvent("keydown", { code: "F11", key: "F11", cancelable: true, bubbles: true });
    window.dispatchEvent(e);
    return e.defaultPrevented;
  });
  assert(prevented, "F11 is handled by the game");
  // In the game, Ctrl+R / Ctrl+S / Ctrl+W are cancelled so a page-level reload or save never fires.
  const combos = await page.evaluate(() => {
    const out = {};
    for (const code of ["KeyR", "KeyS", "KeyD", "KeyW"]) {
      const e = new KeyboardEvent("keydown", { code, key: code.slice(3).toLowerCase(), ctrlKey: true, cancelable: true, bubbles: true });
      window.dispatchEvent(e);
      out[code] = e.defaultPrevented;
    }
    return out;
  });
  assert(Object.values(combos).every(Boolean), JSON.stringify(combos));
});

// ================= Part 2: balance and weapons =================

await check("balance: bow arrow speed, laser blaster damage, UFO counts in a jet, drops and removed items", async () => {
  const r = await v(async (g) => {
    const w = await import("./js/weapons.js");
    const items = await import("./js/items.js");
    const ufosMod = await import("./js/ufos.js");
    const terrain = await import("./js/terrain.js");
    g.setMode("creative");
    g.weapons.enabled = true;
    // A full draw: fast and (nearly) flat.
    g.player.pitch = 0;
    const a = g.weapons.shootArrow(1);
    const full = a.vel.length();
    const half = g.weapons.shootArrow(0.5).vel.length();
    const out = { full: Math.round(full), half: Math.round(half), grav: a.gravity };
    out.blaster = w.BLASTER_DAMAGE;
    out.noIron = !("IRON_INGOT" in items.ITEM) && !("DIAMOND" in items.ITEM) && !items.itemInfo(258) && !items.itemInfo(260);
    out.noRadio = !("JET_RADIO" in items.ITEM) && !items.itemInfo(293);
    out.maxAttackers = ufosMod.MAX_ATTACKERS;
    out.jetAttackers = ufosMod.JET_MAX_ATTACKERS;
    out.jetFactor = ufosMod.JET_COUNT_FACTOR;
    g.weapons.arrows.length = 0;
    return out;
  });
  assert(r.full >= 130 && r.full > r.half * 1.8 && r.grav > -9, JSON.stringify(r));
  assert(r.blaster >= 6 && r.noIron && r.noRadio && r.maxAttackers <= 3 && r.jetAttackers <= 1 && r.jetFactor <= 0.5, JSON.stringify(r));
});

await check("skeleton arrows at point blank hit the player (no more flying over the head)", async () => {
  const r = await v((g) => {
    g.setMode("survival");
    g.testFlags.noMissions = true;
    g.ufos.config.activity = 0;
    g.mobs.clear();
    const p = g.player.position;
    const out = [];
    for (const d of [2.5, 4, 6]) {
      g.mobs.arrows.length = 0;
      const m = g.mobs.spawn("skeleton", p.x + d, p.y, p.z);
      if (!m) continue;
      m.pos.set(p.x + d, p.y, p.z);
      g.mobs._shootArrow(m, p.x - m.pos.x, p.y - m.pos.y, p.z - m.pos.z);
      const a = g.mobs.arrows[g.mobs.arrows.length - 1];
      if (!a) continue;
      // Where the arrow is when it reaches the player's x: its height vs the player's body.
      const eye = g.player.getEyePosition();
      const t = Math.abs(a.pos.x - p.x) / Math.max(0.1, Math.abs(a.vel.x));
      const y = a.pos.y + a.vel.y * t - 0.5 * 16 * t * t;
      out.push({ d, y: +(y - p.y).toFixed(2), eye: +(eye.y - p.y).toFixed(2) });
    }
    g.mobs.clear();
    g.mobs.arrows.length = 0;
    g.setMode("creative");
    return out;
  });
  assert(r.length >= 2 && r.every((o) => o.y > 0.1 && o.y < 1.9), JSON.stringify(r));
});

await check("Survival: rule settings are hidden and fixed at their defaults, Creative gets them back", async () => {
  const r = await v((g) => {
    const out = {};
    g.setMode("creative");
    g.settingsPanel.set("zombies.health", 3);
    g.settingsPanel.set("weapons.nukeSize", 150);
    g.settingsPanel.set("ufos.toughness", 2);
    out.creativeZombie = g.mobs.zombies.health;
    out.creativeNuke = g.nuke.config.size;
    g.setMode("survival");
    out.survZombie = g.mobs.zombies.health;
    out.survNuke = g.nuke.config.size;
    out.survTough = g.ufos.config.toughness;
    const hidden = (id) => document.getElementById(id)?.closest(".row")?.classList.contains("survival-hidden");
    out.hidden = { zombie: hidden("zombies-health"), nuke: hidden("weapons-nukeSize"), grenade: hidden("explosion-grenade"), timeOfDay: hidden("time-of-day"), jetSpeed: hidden("vehicles-jetMaxSpeed") };
    out.visibleKept = !hidden("fov") && !hidden("difficulty") && !hidden("show-fps");
    g.setMode("creative");
    out.backZombie = g.mobs.zombies.health;
    g.settingsPanel.set("zombies.health", 1);
    g.settingsPanel.set("weapons.nukeSize", 96);
    g.settingsPanel.set("ufos.toughness", 1);
    return out;
  });
  assert(r.creativeZombie === 3 && r.creativeNuke === 150 && r.survZombie === 1 && r.survNuke === 96 && r.survTough === 1 && r.backZombie === 3, JSON.stringify(r));
  assert(Object.values(r.hidden).every(Boolean) && r.visibleKept, JSON.stringify(r));
});

// ================= Part 3: the nuke =================

await check("nuke: default size 96, a very wide crater, and everything above the ground within 1.3x the size is gone (buildings, trees, plants, runways)", async () => {
  const info = await v(async (g) => {
    g.setMode("creative");
    g.testFlags.noMissions = true;
    g.ufos.config.activity = 0;
    g.mobs.spawning = false;
    const { NUKE_DEFAULTS, NUKE_MAX_SIZE } = await import("./js/nuke.js");
    // The home airport (a runway, an apron, hangars, a tower) is the target.
    const s = g.sites.home;
    window.__site = s;
    g.player.position.set(s.x, s.y + 50, s.z + 60);
    g.player.flying = true;
    return { def: NUKE_DEFAULTS.size, max: NUKE_MAX_SIZE, R: g.nuke.radius, x: s.x, z: s.z, y: s.y };
  });
  assert(info.def === 96 && info.max === 200 && info.R === 96, JSON.stringify(info));
  for (let i = 0; i < 40; i++) {
    await v((g) => g.streamAround(window.__site.x, window.__site.z));
    await frames(2);
  }
  const res = await v((g) => {
    const s = window.__site;
    const above = () => {
      let n = 0;
      let surf = 0;
      let tot = 0;
      for (let x = s.x - 120; x <= s.x + 120; x += 1) for (let z = s.z - 120; z <= s.z + 120; z += 1) {
        if ((x - s.x) ** 2 + (z - s.z) ** 2 > 120 * 120 || !g.world.getChunk(x >> 4, z >> 4)) continue;
        tot++;
        const h = g.world.heightAt(x, z);
        for (let y = h + 1; y < h + 70; y++) { const id = g.world.getBlock(x, y, z); if (id !== 0 && id !== 5) n++; }
        const id = g.world.getBlock(x, h, z);
        if (id === 11 || id === 24 || id === 18) surf++;
      }
      return { n, surf, tot };
    };
    const before = above();
    g.nuke.detonate(new g.THREE.Vector3(s.x, s.y + 1, s.z));
    for (let i = 0; i < 300; i++) g.nuke.update(0.05, null, 1);
    const after = above();
    // The crater: depth at the centre, and how far out the ground is lowered.
    let deepest = 0;
    for (let y = s.y; y > 0; y--) { if (g.world.getBlock(Math.floor(s.x), y, Math.floor(s.z)) === 0) deepest = s.y - y; else break; }
    let rim = 0;
    for (let d = 0; d < 140; d += 4) { const h = g.world.heightAt(Math.floor(s.x + d), Math.floor(s.z)); if (g.world.getBlock(Math.floor(s.x + d), s.y, Math.floor(s.z)) === 0 || g.world.getBlock(Math.floor(s.x + d), s.y - 2, Math.floor(s.z)) === 0) rim = d; void h; }
    return { before, after, deepest, rim };
  });
  assert(res.before.n > 500 && res.before.surf > 100, `something to destroy: ${JSON.stringify(res.before)}`);
  assert(res.after.n === 0 && res.after.surf === 0, JSON.stringify(res));
  assert(res.deepest >= 15 && res.deepest <= 45 && res.rim >= 70, `a wide, not too deep crater: ${JSON.stringify(res)}`);
});


// ================= Part 4: jets =================

// A jet in the air that the player flies (stepped by hand).
const newJet = (opts = {}) =>
  v((g, o) => {
    for (const j of [...g.vehicles.vehicles]) g.vehicles.remove(j);
    const p = g.player.position;
    const jet = g.vehicles.create("jet", { jetType: o.type || "f22", pos: [p.x, o.y || 700, p.z], yaw: 0, airborne: true, speed: o.speed ?? 220, throttle: o.throttle ?? 0.7 });
    g.vehicles.enter(jet);
    window.__jet = jet;
    return true;
  }, opts);

await check("jet: no calling in (no J key, no radio, no picker), jets only at airports", async () => {
  const r = await v((g) => {
    const before = g.vehicles.vehicles.length;
    window.dispatchEvent(new KeyboardEvent("keydown", { code: "KeyJ", key: "j", bubbles: true }));
    return { before, after: g.vehicles.vehicles.length, picker: !!document.getElementById("jet-picker"), btn: !!document.getElementById("mods-call-jet") };
  });
  assert(r.after === r.before && !r.picker && !r.btn, JSON.stringify(r));
});

await check("jet: air brakes shed speed very fast, open smoothly, tighten the turn, and can stall a slow jet", async () => {
  await newJet({ speed: 260, throttle: 0.5 });
  const r = await v((g) => {
    const jet = window.__jet;
    const dt = 1 / 60;
    const out = {};
    const run = (secs, hold) => {
      if (hold) g.player.keys.add("Space");
      else g.player.keys.delete("Space");
      for (let t = 0; t < secs; t += dt) {
        g.vehicles.update(dt);
        jet.pos.y = Math.max(jet.pos.y, 600);
      }
    };
    run(2, false);
    out.v0 = Math.round(jet.speed);
    out.a0 = jet.airbrake;
    // Hold the brakes for 3 seconds.
    run(0.25, true);
    out.opening = +jet.airbrake.toFixed(2);
    run(2.75, true);
    out.v3 = Math.round(jet.speed);
    out.open = jet.airbrake;
    out.rows = jet.hud?.()?.rows?.some?.((x) => x[0] === "Air brakes");
    g.player.keys.delete("Space");
    run(1, false);
    out.closed = jet.airbrake;
    g.vehicles.exit({ force: true });
    return out;
  });
  assert(r.a0 === 0 && r.opening > 0.3 && r.opening < 1 && r.open > 0.97 && r.closed < 0.05, JSON.stringify(r));
  assert(r.v3 < r.v0 * 0.55, `speed ${r.v0} -> ${r.v3}`);
  // Turn radius: a hard pull with and without brakes (same start): the braking jet turns through more heading.
  const turn = await v((g) => {
    const out = {};
    // (Round 8: the default mouse sensitivity is 0.6; the old 1.0 pulls as hard as this check needs.)
    const sens = g.vehicles.mouseSensitivity;
    g.vehicles.mouseSensitivity = 1;
    for (const brake of [false, true]) {
      for (const j of [...g.vehicles.vehicles]) g.vehicles.remove(j);
      const p = g.player.position;
      const jet = g.vehicles.create("jet", { pos: [p.x, 700, p.z], yaw: 0, airborne: true, speed: 230, throttle: 0.6 });
      g.vehicles.enter(jet);
      const dt = 1 / 60;
      const v0 = jet.vel.clone().normalize();
      if (brake) g.player.keys.add("Space");
      for (let t = 0; t < 2.5; t += dt) {
        g.vehicles.input.dx = -9;
        g.vehicles.update(dt);
        jet.pos.y = 700;
      }
      g.player.keys.delete("Space");
      const v1 = jet.vel.clone().normalize();
      out[brake ? "brake" : "free"] = Math.round((Math.acos(Math.max(-1, Math.min(1, v0.dot(v1)))) * 180) / Math.PI);
      out[brake ? "brakeSpeed" : "freeSpeed"] = Math.round(jet.speed);
      g.vehicles.exit({ force: true });
    }
    g.vehicles.mouseSensitivity = sens;
    return out;
  });
  assert(turn.brake > turn.free + 20, `heading change in 2.5 s: ${JSON.stringify(turn)}`);
  // Too slow with the brakes open: stall.
  const stall = await v((g) => {
    for (const j of [...g.vehicles.vehicles]) g.vehicles.remove(j);
    const p = g.player.position;
    const jet = g.vehicles.create("jet", { pos: [p.x, 700, p.z], yaw: 0, airborne: true, speed: 70, throttle: 0.1 });
    g.vehicles.enter(jet);
    g.player.keys.add("Space");
    let stalled = false;
    for (let t = 0; t < 6; t += 1 / 60) {
      g.vehicles.update(1 / 60);
      if (jet.stalled) stalled = true;
    }
    g.player.keys.delete("Space");
    g.vehicles.exit({ force: true });
    return stalled;
  });
  assert(stall, "braking at low speed stalls the jet");
});

await check("jet: air brake panels move on the F-16, the F-22 brakes with control surfaces", async () => {
  const r = await v(async (g) => {
    const out = {};
    for (const type of ["f16", "f22"]) {
      for (const j of [...g.vehicles.vehicles]) g.vehicles.remove(j);
      const p = g.player.position;
      const jet = g.vehicles.create("jet", { jetType: type, pos: [p.x, 700, p.z], yaw: 0, airborne: true, speed: 200, throttle: 0.6 });
      g.vehicles.enter(jet);
      const snap = () => {
        const q = [];
        jet.model.body.traverse((o) => { if (o.isGroup && o.parent === jet.model.body) q.push(o.quaternion.toArray().map((x) => +x.toFixed(3)).join(",")); });
        return q;
      };
      for (let t = 0; t < 0.5; t += 1 / 60) { g.vehicles.update(1 / 60); jet.pos.y = 700; }
      const a = snap();
      g.player.keys.add("Space");
      for (let t = 0; t < 0.8; t += 1 / 60) { g.vehicles.update(1 / 60); jet.pos.y = 700; }
      const b = snap();
      g.player.keys.delete("Space");
      out[type] = { moved: a.filter((x, i) => x !== b[i]).length, n: a.length };
      g.vehicles.exit({ force: true });
    }
    return out;
  });
  // F-16: the two tail panels (+ rudder idle); F-22: flaperons, rudders, tailplanes.
  assert(r.f16.moved >= 2 && r.f22.moved >= 4, JSON.stringify(r));
});

await check("jet: rolling more than ~90 degrees at the last moment makes a close missile miss, narrowly", async () => {
  const r = await v((g) => {
    const T = g.THREE;
    g.testFlags.noMissions = true;
    g.ufos.config.activity = 0;
    const out = {};
    for (const roll of [true, false]) {
      for (const j of [...g.vehicles.vehicles]) g.vehicles.remove(j);
      const p = g.player.position;
      const jet = g.vehicles.create("jet", { pos: [p.x, 900, p.z], yaw: 0, airborne: true, speed: 160, throttle: 0.5 });
      g.vehicles.enter(jet);
      const foe = g.vehicles.create("jet", { pos: [p.x, 900, p.z - 900], yaw: Math.PI, airborne: true, speed: 160, throttle: 0.5 });
      foe.isEnemyJet = true;
      const hp0 = jet.health;
      const m = foe._launchMissile({ kind: "vehicle", ref: jet }, { hostile: true });
      let minD = Infinity;
      let evaded = false;
      const dt = 1 / 60;
      for (let t = 0; t < 9; t += dt) {
        if (roll && t > 1.2 && t < 2.6) g.player.keys.add("KeyD");
        else g.player.keys.delete("KeyD");
        g.vehicles.update(dt);
        jet.pos.y = Math.max(jet.pos.y, 880);
        foe.vel.set(0, 0, 0);
        foe.pos.set(p.x, 900, p.z - 900);
        const mm = foe.missiles[0] || m;
        if (m.evaded) evaded = true;
        if (foe.missiles.includes(m)) minD = Math.min(minD, m.pos.distanceTo(jet.pos));
      }
      g.player.keys.delete("KeyD");
      out[roll ? "roll" : "still"] = { evaded, minD: Math.round(minD), dmg: Math.round(hp0 - jet.health) };
      g.vehicles.remove(foe);
      g.vehicles.exit({ force: true });
    }
    return out;
  });
  assert(r.roll.evaded && r.roll.dmg === 0 && r.roll.minD > 3 && r.roll.minD < 25, `with a roll: ${JSON.stringify(r)}`);
  assert(!r.still.evaded && r.still.dmg > 0, `without a roll: ${JSON.stringify(r)}`);
});

await check("jet: during a lock-on hold the mouse still steers and the keys work (full control), the camera looks at the target", async () => {
  const r = await v((g) => {
    g.testFlags.noMissions = true;
    g.setMode("creative");
    for (const j of [...g.vehicles.vehicles]) g.vehicles.remove(j);
    g.ufos.clear();
    const p = g.player.position;
    const jet = g.vehicles.create("jet", { pos: [p.x, 600, p.z], yaw: 0, airborne: true, speed: 200, throttle: 0.7 });
    g.vehicles.enter(jet);
    const u = g.ufos.spawn({ pos: new g.THREE.Vector3(p.x + 120, 600, p.z - 500), size: "medium" });
    window.__target = u;
    const dt = 1 / 60;
    // hold the right button
    g.vehicles.input.buttons[2] = true;
    for (let t = 0; t < 1.2; t += dt) g.vehicles.update(dt);
    const out = { target: !!jet.lock.target, holding: jet.lock.holding };
    const aim0 = new g.THREE.Vector3(0, 0, -1).applyQuaternion(jet.aimQ);
    for (let t = 0; t < 0.6; t += dt) {
      g.vehicles.input.dx = 6;
      g.vehicles.update(dt);
    }
    const aim1 = new g.THREE.Vector3(0, 0, -1).applyQuaternion(jet.aimQ);
    out.aimMoved = +(aim0.angleTo(aim1) * 57.3).toFixed(1);
    out.look = +jet.lock.look.toFixed(2);
    // keys: roll with A
    const bank0 = jet.right(new g.THREE.Vector3()).y;
    g.player.keys.add("KeyA");
    for (let t = 0; t < 0.5; t += dt) g.vehicles.update(dt);
    g.player.keys.delete("KeyA");
    out.rolled = Math.abs(jet.right(new g.THREE.Vector3()).y - bank0) > 0.2;
    out.charge = jet.overlay(g.camera).lock?.charge ?? -1;
    g.vehicles.input.buttons[2] = false;
    g.vehicles.exit({ force: true });
    return out;
  });
  assert(r.target && r.holding && r.aimMoved > 3 && r.look > 0.3 && r.rolled, JSON.stringify(r));
});

await check("jet: the salvo charges over the lock (pips and charge reported), then arms the salvo", async () => {
  const r = await v((g) => {
    g.testFlags.noMissions = true;
    g.setMode("creative");
    for (const j of [...g.vehicles.vehicles]) g.vehicles.remove(j);
    g.ufos.clear();
    const p = g.player.position;
    const jet = g.vehicles.create("jet", { pos: [p.x, 600, p.z], yaw: 0, airborne: true, speed: 200, throttle: 0.7 });
    g.vehicles.enter(jet);
    g.ufos.spawn({ pos: new g.THREE.Vector3(p.x, 600, p.z - 1450), size: "large" });
    const dt = 1 / 60;
    g.vehicles.input.buttons[2] = true;
    const samples = [];
    for (let t = 0; t < 4.6; t += dt) {
      g.vehicles.update(dt);
      jet.pos.y = 600;
      if (!samples.includes(jet.lock.pip)) samples.push(jet.lock.pip);
    }
    g.camera.updateMatrixWorld(true);
    g.camera.position.copy(jet.pos);
    g.camera.lookAt(jet.pos.x, jet.pos.y, jet.pos.z - 100);
    g.camera.updateMatrixWorld(true);
    const ov = jet.overlay(g.camera).lock;
    const out = { samples, salvo: jet.lock.salvo, spiral: ov?.spiral, charge: ov?.charge };
    // HUD: the lock box shows the charge ring and pips.
    g.vehicles.input.buttons[2] = false;
    g.vehicles.exit({ force: true });
    return out;
  });
  // (Round 8: the HUD shows the charge as a spiral closing in on the target; the pips are the clicks.)
  assert(r.salvo && r.spiral && r.charge === 1 && [1, 2, 3].every((k) => r.samples.includes(k)), JSON.stringify(r));
});


// ================= Part 5: UFOs =================

const newShip = (radius = 14, y = 100) =>
  v((g, o) => {
    for (const j of [...g.vehicles.vehicles]) g.vehicles.remove(j);
    g.ufos.clear();
    const p = g.player.position;
    const ship = g.vehicles.create("ufo", { design: "saucer", seed: 7, radius: o.radius, pos: [p.x, o.y, p.z], yaw: 0 });
    g.vehicles.enter(ship);
    window.__ship = ship;
    return true;
  }, { radius, y });

await check("UFOs have no altitude limit: a piloted ship climbs to 6000, an enemy UFO keeps its height", async () => {
  await newShip(7, 200);
  const r = await v((g) => {
    const ship = window.__ship;
    const dt = 1 / 60;
    g.player.keys.add("Space");
    for (let t = 0; t < 4; t += dt) g.vehicles.update(dt);
    g.player.keys.delete("Space");
    const out = { climbed: Math.round(ship.pos.y) };
    ship.pos.y = 6000;
    for (let t = 0; t < 1; t += dt) g.vehicles.update(dt);
    out.high = Math.round(ship.pos.y);
    g.vehicles.exit({ force: true });
    // An enemy one at 2500 is not pushed down.
    g.setMode("creative");
    g.testFlags.noMissions = true;
    g.ufos.config.activity = 0;
    g.ufos.clear();
    const p = g.player.position;
    const u = g.ufos.spawn({ pos: new g.THREE.Vector3(p.x + 40, 2500, p.z), size: "medium" });
    for (let t = 0; t < 3; t += dt) g.ufos.update(dt);
    out.enemy = Math.round(u.pos.y);
    g.ufos.clear();
    return out;
  });
  assert(r.climbed > 205, `climbed ${JSON.stringify(r)}`);
  assert(r.high >= 5990 && r.enemy > 2300, JSON.stringify(r));
});

await check("player UFO beam: works at altitude (floating beam), swallows a smaller UFO, ignores a bigger one", async () => {
  await newShip(14, 3000);
  const r = await v((g) => {
    g.testFlags.noMissions = true;
    g.ufos.config.activity = 0;
    const ship = window.__ship;
    const p = ship.pos;
    const small = g.ufos.spawn({ pos: new g.THREE.Vector3(p.x + 1, p.y - 60, p.z + 1), size: "small" });
    const big = g.ufos.spawn({ pos: new g.THREE.Vector3(p.x + 3, p.y - 90, p.z), size: "giant" });
    small.hostile = false;
    small.radius = 4;
    big.radius = 40;
    const down0 = g.stats.world.ufosDown;
    g.vehicles.input.buttons[2] = true;
    const dt = 1 / 60;
    let y0 = small.pos.y;
    let swallowed = false;
    for (let t = 0; t < 14 && !swallowed; t += dt) {
      g.vehicles.update(dt);
      g.ufos.update(dt);
      small.pos.x = small.pos.x; // (the beam moves it)
      if (small.state === "gone") swallowed = true;
    }
    const out = { beamOn: ship.beam.on, floating: ship.beam.floating, swallowed, bigStill: big.state !== "gone" && !big.captured, counted: g.stats.world.ufosDown - down0 };
    g.vehicles.input.buttons[2] = false;
    g.vehicles.exit({ force: true });
    g.ufos.clear();
    return out;
  });
  assert(r.beamOn && r.floating && r.swallowed && r.bigStill && r.counted >= 1, JSON.stringify(r));
});

await check("player UFO beam: an enemy jet in the beam is pulled in and swallowed (and counts as down)", async () => {
  await newShip(14, 1500);
  const r = await v((g) => {
    g.testFlags.noMissions = true;
    const ship = window.__ship;
    const p = ship.pos;
    const jet = g.vehicles.create("jet", { pos: [p.x, p.y - 70, p.z + 2], yaw: 0, airborne: true, speed: 0, throttle: 0 });
    jet.isEnemyJet = true;
    g.vehicles.input.buttons[2] = true;
    const dt = 1 / 60;
    const d0 = jet.pos.distanceTo(ship.pos);
    let gone = false;
    let minD = d0;
    for (let t = 0; t < 14 && !gone; t += dt) {
      g.vehicles.update(dt);
      minD = Math.min(minD, jet.pos.distanceTo(ship.pos));
      if (!jet.alive) gone = true;
    }
    g.vehicles.input.buttons[2] = false;
    g.vehicles.exit({ force: true });
    return { d0: Math.round(d0), minD: Math.round(minD), gone, absorbed: !!jet.absorbedBy };
  });
  assert(r.gone && r.absorbed && r.minD < r.d0 * 0.5, JSON.stringify(r));
});

await check("player UFO: holding T locks a UFO and, after 3 s, fires a salvo of homing laser bolts that hit it", async () => {
  await newShip(14, 400);
  const r = await v((g) => {
    g.testFlags.noMissions = true;
    g.ufos.config.activity = 0;
    const ship = window.__ship;
    const p = ship.pos;
    g.vehicles.camYawHack = true;
    ship.camYaw = 0;
    ship.camPitch = 0;
    const target = g.ufos.spawn({ pos: new g.THREE.Vector3(p.x, p.y, p.z - 220), size: "large" });
    target.hostile = false;
    const hp0 = target.health;
    g.player.keys.add("KeyT");
    const dt = 1 / 60;
    let locked = false;
    for (let t = 0; t < 3.4; t += dt) {
      g.vehicles.update(dt);
      g.lasers.update(dt);
      g.ufos.update(dt);
      target.pos.set(p.x, p.y, p.z - 220);
      if (ship.lockOn.t >= 1) locked = true;
    }
    g.player.keys.delete("KeyT");
    const fired = g.lasers.bolts.length;
    for (let t = 0; t < 3; t += dt) {
      g.lasers.update(dt);
      g.ufos.update(dt);
      g.vehicles.update(dt);
    }
    const out = { locked, fired, cool: ship.lockOn.cool > 1, dmg: Math.round(hp0 - target.health) };
    g.vehicles.exit({ force: true });
    g.ufos.clear();
    return out;
  });
  assert(r.locked && r.fired >= 4 && r.cool && r.dmg > 0, JSON.stringify(r));
});


// ================= Part 6: missions =================

// Starts mission `id` of the chain in Survival (the director sets it up on its next updates).
const startMission = (id) =>
  v((g, id) => {
    g.testFlags.noMissions = false;
    if (g.player.dead) g.respawn();
    g.setMode("survival");
    g.progress.enabled = true;
    g.missions.enabled = true;
    // (Earlier checks leave the player anywhere, even high in the air: a fresh start on the ground.)
    g.world.prepareArea(g.spawn.x, g.spawn.z, 6);
    g.player.position.set(g.spawn.x + 0.5, g.world.surfaceY(g.spawn.x, g.spawn.z) + 1, g.spawn.z + 0.5);
    g.player.velocity.set(0, 0, 0);
    g.player.resetFall();
    g.player.flying = false;
    g.player.health = 20;
    g.ufos.clear();
    g.mobs.clear();
    return true;
  }, id);
const stepMission = (id, n = 8) =>
  v(async (g, [id, n]) => {
    const { MISSIONS } = await import("./js/progression.js");
    g.progress.step = MISSIONS.findIndex((m) => m.id === id);
    g.progress.base = { ...g.progress._pick(g.stats.world) };
    g.missions.state = { t: 0 };
    g.missions.missionId = id;
    g.missions.base = null;
    for (let i = 0; i < n; i++) {
      g.missions.checkT = 0;
      g.missions.update(0.5);
    }
    return g.progress.mission?.id;
  }, [id, n]);

await check("mission chain: 22 missions in the right order (touchdown after wings, meteors, Steal the ship after Sunburn, the Overlord before the slayer)", async () => {
  const r = await v(async () => {
    const { MISSIONS } = await import("./js/progression.js");
    const ids = MISSIONS.map((m) => m.id);
    return { n: ids.length, ids };
  });
  const at = (id) => r.ids.indexOf(id);
  assert(r.n === 22 && at("steal") === at("sunburn") + 1 && at("touchdown") === at("wings") + 1 && at("overlord") === at("slayer") - 1 && at("meteors") > at("reds"), JSON.stringify(r));
});

await check("mission Touchdown: a jet landing on a runway starts a red squad on the ground; killing it completes the mission", async () => {
  await startMission("touchdown");
  const r = await v(async (g) => {
    const { MISSIONS } = await import("./js/progression.js");
    const site = g.sites.home;
    const [ux, uz] = g.sites.dirU(site);
    // Ground around the runway centre must be loaded.
    g.player.position.set(site.x, site.y + 3, site.z);
    g.streamAround(site.x, site.z);
    return { ok: !!site, x: site.x, y: site.y, z: site.z, size: site.size, half: site.half, idx: MISSIONS.findIndex((m) => m.id === "touchdown") };
  });
  assert(r.ok && r.half >= 380, JSON.stringify(r));
  await until((g) => g.world.getChunk(Math.floor(window.__home?.x ?? g.sites.home.x) >> 4, Math.floor(g.sites.home.z) >> 4), 60000);
  const out = await v(async (g) => {
    const site = g.sites.home;
    await (async () => {})();
    window.__home = site;
    const { MISSIONS } = await import("./js/progression.js");
    g.progress.step = MISSIONS.findIndex((m) => m.id === "touchdown");
    g.progress.base = { ...g.progress._pick(g.stats.world) };
    g.missions.state = { t: 0 };
    g.missions.missionId = "touchdown";
    for (const j of [...g.vehicles.vehicles]) g.vehicles.remove(j);
    const jet = g.vehicles.create("jet", { pos: [site.x, site.y + 60, site.z], yaw: 0, airborne: true, speed: 120, throttle: 0.5 });
    g.vehicles.enter(jet);
    const tick = () => { g.missions.checkT = 0; g.missions.update(0.5); };
    tick();
    const flew = !!g.missions.state.air;
    const label0 = g.missions.target?.label;
    // Touch down on the runway and stop.
    jet.pos.set(site.x, site.y + 2.4, site.z);
    jet.vel.set(0, 0, 0);
    jet.onGround = true;
    tick();
    const landings = g.stats.world.landings;
    return { flew, label0, landings, landed: !!g.missions.state.landed };
  });
  assert(out.flew && out.landed && out.landings >= 1, JSON.stringify(out));
  const squad = await until((g) => {
    g.missions.checkT = 0;
    g.missions.update(0.5);
    const reds = g.mobs.mobs.filter((m) => m.kind === "alien_red" && !m.dead);
    return reds.length >= 3 ? reds.length : 0;
  }, 60000);
  assert(squad >= 3, `a red squad of ${squad}`);
  const done = await v(async (g) => {
    g.vehicles.exit({ force: true });
    for (const m of g.mobs.mobs.filter((x) => x.kind === "alien_red")) g.mobs.shoot(m, 9999, new g.THREE.Vector3(1, 0, 0), 1);
    for (let i = 0; i < 6; i++) { g.missions.checkT = 0; g.missions.update(0.5); g.mobs.update(0.1); g.progress.update(g.stats.world); }
    return { squadKilled: g.stats.world.landingSquad, next: g.progress.mission?.id };
  });
  assert(done.squadKilled >= 3 && done.next === "dogfight", JSON.stringify(done));
  await v((g) => { g.mobs.clear(); g.ufos.clear(); g.setMode("creative"); });
});

await check("mission Falling stars: meteors fall by red rings, craters leave star fragments, walking into them collects them", async () => {
  await startMission("meteors");
  const r = await v(async (g) => {
    const { MISSIONS } = await import("./js/progression.js");
    g.progress.step = MISSIONS.findIndex((m) => m.id === "meteors");
    g.progress.base = { ...g.progress._pick(g.stats.world) };
    g.missions.state = { t: 0 };
    g.missions.missionId = "meteors";
    g.sky.setHours(12);
    const out = { strikes: 0, frags: 0, collected: 0, ringsSeen: 0, impacts0: g.weapons.airstrike.impacts };
    const dt = 0.1;
    for (let t = 0; t < 70; t += dt) {
      g.missions.update(dt);
      g.weapons.airstrike.update(dt, g.effects.listener);
      g.effects.update?.(dt);
      const st = g.missions.state;
      out.ringsSeen = Math.max(out.ringsSeen, (st.rings || []).length);
      out.frags = Math.max(out.frags, (st.frags || []).length);
      // Walk to the nearest fragment.
      const f = (st.frags || [])[0];
      if (f) g.player.position.set(f.pos.x, f.pos.y, f.pos.z);
      g.player.health = 20;
    }
    out.collected = g.stats.world.meteorFragments;
    out.night = g.sky.hours >= 19.5 || g.sky.hours < 5.5;
    out.impacts = g.weapons.airstrike.impacts - out.impacts0;
    return out;
  });
  assert(r.ringsSeen >= 1 && r.impacts >= 1 && r.frags >= 1 && r.collected >= 1 && r.night, JSON.stringify(r));
  await v((g) => { g.setMode("creative"); g.weapons.airstrike.clear(); });
});

await check("mission The Overlord: a shielded boss with pylons; no damage until they fall; shield rounds with a red squad; its death completes the mission", async () => {
  await startMission("overlord");
  const r = await v(async (g) => {
    const { MISSIONS } = await import("./js/progression.js");
    g.progress.step = MISSIONS.findIndex((m) => m.id === "overlord");
    g.progress.base = { ...g.progress._pick(g.stats.world) };
    g.missions.state = { t: 0 };
    g.missions.missionId = "overlord";
    const tick = (n = 4) => { for (let i = 0; i < n; i++) { g.missions.checkT = 0; g.missions.update(0.5); } };
    tick(8);
    const boss = g.ufos.ufos.find((u) => u.boss);
    if (!boss) return { err: "no boss" };
    const out = { size: boss.size, hp: boss.maxHealth, shield: boss.shield, pylons: g.ufos.ufos.filter((u) => u.pylon).length };
    out.blocked = g.ufos.damage(boss, 500, true) === false && boss.health === boss.maxHealth;
    out.bar = !!g.missions.bossInfo;
    // Pylons down: the shield drops.
    for (const p of g.ufos.ufos.filter((u) => u.pylon)) g.ufos.damage(p, 9999, true);
    for (let i = 0; i < 40; i++) g.ufos.update(0.1);
    tick(6);
    out.shieldDown = !boss.shield;
    // Hit it to the first threshold: the shield comes back with fresh pylons and a squad.
    const got = g.ufos.damage(boss, boss.maxHealth * 0.4, true);
    out.hitLanded = got === true;
    tick(6);
    out.round = boss.shieldRound;
    out.shield2 = boss.shield;
    out.pylons2 = g.ufos.ufos.filter((u) => u.pylon && !u.falling).length;
    out.reds = g.mobs.mobs.filter((m) => m.kind === "alien_red" && !m.dead).length;
    out.hpAt = Math.round((boss.health / boss.maxHealth) * 100);
    // The rest, round by round.
    for (let k = 0; k < 4 && !boss.falling; k++) {
      for (const p of g.ufos.ufos.filter((u) => u.pylon && !u.falling)) g.ufos.damage(p, 9999, true);
      for (let i = 0; i < 30; i++) g.ufos.update(0.1);
      tick(6);
      g.ufos.damage(boss, boss.maxHealth * 0.5, true);
      tick(2);
    }
    out.rounds = boss.shieldRound;
    out.falling = boss.falling;
    // Bring it down.
    boss.pos.y = Math.max(g.world.heightAt(Math.floor(boss.pos.x), Math.floor(boss.pos.z)) + 5, 5);
    for (let i = 0; i < 400 && boss.state !== "gone"; i++) {
      g.ufos.update(0.1);
      g.effects.update?.(0.1);
    }
    tick(2);
    out.down = g.stats.world.bossesDown;
    g.progress.update(g.stats.world);
    out.next = g.progress.mission?.id;
    return out;
  });
  assert(r.size === "mothership" && r.shield && r.pylons >= 3 && r.blocked && r.bar, JSON.stringify(r));
  assert(r.shieldDown && r.hitLanded && r.round === 1 && r.shield2 && r.pylons2 >= 4 && r.reds >= 3, JSON.stringify(r));
  assert(r.falling && r.down >= 1 && r.next === "slayer", JSON.stringify(r));
  await v((g) => { g.mobs.clear(); g.ufos.clear(); g.setMode("creative"); });
});


// ---------- Summary ----------
const failed = results.filter(([, ok]) => !ok);
console.log(`\n${results.length - failed.length} passed, ${failed.length} failed${errors.length ? `; console errors: ${errors.length}` : ""}.`);
if (errors.length) console.log(errors.slice(0, 5).join("\n"));
await browser.close();
server.close();
process.exit(failed.length || errors.length ? 1 : 0);
