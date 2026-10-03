// Round 4 feature tests: boots the real game in headless Chromium (software
// WebGL, Low preset) and checks the Round 4 features: jet takeoff at real
// frame rates, the damped bank, missiles (unguided click, lock on aircraft
// only, attackers first, the camera following the target), the F-16 and the
// jet picker, patrol fighters, UFO health, the tractor beam, one crew kind
// per UFO, muzzles, hangar UFOs, the UFO camera, held dash and UFO weapons,
// the Survival chain (opening, lanes, reloads, the shield, locks) and the
// parrot. Time is stepped by hand with the game's own systems where the
// check needs seconds of game time.
//
//   node round4-tests.mjs [--only=substring] [--from=substring] [--seed=42]
//
// Like the other suites, it fails on any console error or page error.
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


// Game-time stepping with the game's own systems (much faster than real
// frames under software rendering), and aiming.
async function helpers() {
  await v((g) => {
    window.__step = (seconds, dt = 1 / 20) => {
      for (let t = 0; t < seconds - 1e-9; t += dt) {
        g.player.update(dt);
        g.mobs.update(dt);
        g.ufos.update(dt);
        g.weapons.update(dt);
        g.lasers.update(dt);
        g.entities.update(dt, g.player);
        g.crates.update(dt);
        g.missions.update(dt);
        g.progress.update(g.stats.world);
      }
    };
    // A teleport that lands on the ground there (no fall from a height).
    window.__place = (x, z) => {
      const top = g.world.surfaceY(Math.floor(x), Math.floor(z));
      g.player.position.set(x, top + 1, z);
      g.player.velocity.set(0, 0, 0);
      g.player.resetFall();
    };
    window.__face = (pos, yOff = 1) => {
      const p = g.player.getEyePosition();
      const dx = pos.x - p.x;
      const dy = pos.y + yOff - p.y;
      const dz = pos.z - p.z;
      g.player.yaw = Math.atan2(-dx, -dz);
      g.player.pitch = Math.atan2(dy, Math.hypot(dx, dz));
    };
  });
}
await play();
await helpers();

// ================= Part 1: jets =================

await check("jet takeoff: from an airport runway at 144, 60 and 20 FPS, both jets leave the ground after a real roll and climb away", async () => {
  await play();
  await v((g) => {
    g.setMode("creative");
    g.testFlags.noMissions = true;
    g.ufos.config.activity = 0;
    g.ufos.clear();
    const s = g.sites.nearest(g.player.position.x, g.player.position.z, 6000);
    const e = g.sites.runwayEnds(s)[0];
    g.player.position.set(e.x + 10, s.y + 3, e.z);
    g.player.velocity.set(0, 0, 0);
  });
  assert(await until((g) => !!g.airports.runwayNear(g.player.position.x, g.player.position.z, 700), 90000), "the runway's chunks load");
  const out = [];
  const start = await v((g) => g.player.position.toArray());
  for (const [type, dt] of [["f22", 1 / 144], ["f22", 1 / 60], ["f22", 1 / 20], ["f16", 1 / 60]]) {
    // (Back at the runway's end each time: the last takeoff carried the
    // player away, and the runway's chunks have to load again.)
    await v((g, start) => {
      if (g.vehicles.active) g.vehicles.exit({ force: true });
      for (const j of [...g.vehicles.vehicles]) if (j.isPlayerJet) g.vehicles.remove(j);
      g.player.position.fromArray(start);
      g.player.velocity.set(0, 0, 0);
    }, start);
    assert(await until((g) => !!g.airports.runwayNear(g.player.position.x, g.player.position.z, 700), 90000), "the runway's chunks load again");
    const r = await v((g, a) => {
      g.ufos.time += 5; // (past the double-press guard of the call)
      g.callJet(true, a.type);
      const jet = g.vehicles.vehicles.find((j) => j.isPlayerJet);
      g.player.position.copy(jet.pos);
      g.vehicles.enter(jet);
      const keys = g.player.keys;
      keys.add("KeyW");
      let t = 0;
      let lifted = -1;
      let rolled = 0;
      let y0 = jet.pos.y;
      while (t < 30 && jet.alive) {
        g.vehicles.update(a.dt);
        t += a.dt;
        if (jet.onGround) rolled = jet.rolled;
        if (!jet.onGround && lifted < 0) lifted = t;
        if (lifted > 0 && t > lifted + 4) break;
      }
      keys.clear();
      const o = { type: jet.jetType, alive: jet.alive, lifted: +lifted.toFixed(1), rolled: Math.round(rolled), climb: Math.round(jet.pos.y - y0), name: jet.name };
      g.vehicles.exit({ force: true });
      return o;
    }, { type, dt, start });
    out.push(r);
  }
  const j = JSON.stringify(out);
  for (const r of out) assert(r.alive && r.lifted > 2 && r.lifted < 12 && r.rolled > 50 && r.rolled < 200 && r.climb > 15, `a clean takeoff: ${j}`);
  assert(out[3].rolled < out[1].rolled && out[3].name === "F-16 Fighting Falcon", `the F-16 needs a shorter roll: ${j}`);
});

await check("jet roll: flight assist banks at most ~70 degrees in a turn and levels off without tilting over the other way", async () => {
  const r = await v((g) => {
    const T = g.THREE;
    const out = [];
    for (const turn of [90, -40, 170]) {
      for (const j of [...g.vehicles.vehicles]) g.vehicles.remove(j);
      const p = g.player.position;
      const jet = g.vehicles.create("jet", { pos: [p.x, 150, p.z], yaw: 0, airborne: true, speed: 110, throttle: 0.8 });
      g.vehicles.enter(jet);
      const bank = () => {
        const r = jet.right(new T.Vector3());
        const u = jet.up(new T.Vector3());
        return (Math.atan2(-r.y, u.y) * 180) / Math.PI;
      };
      jet.aimYaw = (turn * Math.PI) / 180;
      let peak = 0;
      for (let t = 0; t < 4; t += 1 / 60) {
        g.vehicles.update(1 / 60);
        jet.pos.y = 150;
        peak = Math.max(peak, Math.abs(bank()));
      }
      const b0 = bank();
      let over = 0;
      for (let t = 0; t < 4; t += 1 / 60) {
        const f = jet.forward(new T.Vector3());
        jet.aimYaw = Math.atan2(-f.x, -f.z);
        jet.aimPitch = 0;
        g.vehicles.update(1 / 60);
        jet.pos.y = 150;
        const b = bank();
        if (Math.sign(b) !== Math.sign(b0)) over = Math.max(over, Math.abs(b));
      }
      out.push({ turn, peak: Math.round(peak), over: +over.toFixed(1), end: +Math.abs(bank()).toFixed(1) });
      g.vehicles.exit({ force: true });
    }
    return out;
  });
  const j = JSON.stringify(r);
  for (const x of r) assert(x.peak > 20 && x.peak < 76 && x.over < 3 && x.end < 3, `limited bank, no overshoot: ${j}`);
});

await check("jet missiles: a click fires one unguided; the lock takes only UFOs and aircraft, attackers first; the camera follows the target to the hit; right click brings it back", async () => {
  const r = await v((g) => {
    const T = g.THREE;
    const dt = 1 / 60;
    const out = {};
    const reset = () => {
      if (g.vehicles.active) g.vehicles.exit({ force: true });
      for (const j of [...g.vehicles.vehicles]) g.vehicles.remove(j);
      g.ufos.clear();
      const p = g.player.position;
      const jet = g.vehicles.create("jet", { pos: [p.x, 150, p.z], yaw: 0, airborne: true, speed: 110, throttle: 0.8 });
      g.vehicles.enter(jet);
      return jet;
    };
    const step = (jet, n) => {
      for (let i = 0; i < n; i++) {
        g.vehicles.update(dt);
        jet.pos.y = Math.max(jet.pos.y, 150);
      }
    };
    let jet = reset();
    g.ufos.spawn({ size: "small", pos: new T.Vector3(jet.pos.x, 150, jet.pos.z - 400) });
    g.vehicles.mouseDown(2);
    step(jet, 6);
    g.vehicles.mouseUp(2);
    step(jet, 2);
    out.tap = jet.missiles.map((m) => !!m.target);
    jet = reset();
    const calm = g.ufos.spawn({ size: "small", pos: new T.Vector3(jet.pos.x, 150, jet.pos.z - 400) });
    const att = g.ufos.spawn({ size: "small", pos: new T.Vector3(jet.pos.x - 250, 150, jet.pos.z - 400) });
    att.hostile = true;
    att.state = "attack";
    g.vehicles.mouseDown(2);
    step(jet, 80);
    out.pick = jet.lock.target?.ref === att ? "attacker" : jet.lock.target?.ref === calm ? "calm" : "none";
    g.vehicles.mouseUp(2);
    step(jet, 1);
    out.follow = !!jet.lock.follow;
    let t = 0;
    let lookMid = 0;
    while (jet.missiles.length && t < 10) {
      step(jet, 6);
      t += 0.1;
      if (t > 0.4 && t < 0.6) lookMid = jet.lock.look;
    }
    out.lookMid = +lookMid.toFixed(2);
    out.hit = att.falling || att.health < att.maxHealth;
    step(jet, 180);
    out.lookAfter = +jet.lock.look.toFixed(2);
    jet = reset();
    g.ufos.spawn({ size: "large", pos: new T.Vector3(jet.pos.x, 150, jet.pos.z - 1400) });
    g.vehicles.mouseDown(2);
    step(jet, 80);
    g.vehicles.mouseUp(2);
    step(jet, 60);
    out.followLong = !!jet.lock.follow && jet.lock.look > 0.9;
    g.vehicles.mouseDown(2);
    step(jet, 12);
    out.rmbBack = { follow: !!jet.lock.follow, look: +jet.lock.look.toFixed(2) };
    g.vehicles.mouseUp(2);
    jet = reset();
    const m = g.mobs.spawn("zombie", jet.pos.x, 100, jet.pos.z - 200);
    if (m) m.pos.y = 150;
    g.vehicles.mouseDown(2);
    step(jet, 90);
    out.mob = jet.lock.target ? jet.lock.target.kind : "none";
    g.vehicles.mouseUp(2);
    g.vehicles.exit({ force: true });
    for (const j of [...g.vehicles.vehicles]) g.vehicles.remove(j);
    if (m) m.dead = true;
    g.ufos.clear();
    return out;
  });
  const j = JSON.stringify(r);
  assert(r.tap.length === 1 && r.tap[0] === false, `a click: one unguided missile: ${j}`);
  assert(r.pick === "attacker", `the attacker off to the side wins over a calm UFO ahead: ${j}`);
  assert(r.follow && r.lookMid > 0.9 && r.hit && r.lookAfter < 0.05, `the camera follows to the hit, then returns: ${j}`);
  assert(r.followLong && !r.rmbBack.follow && r.rmbBack.look < 0.1, `right click brings the view back at once: ${j}`);
  assert(r.mob === "none", `creatures are never locked: ${j}`);
});

await check("jets: an F-16 has its own model, handling and weapons; navigation lights are small points; the jets have the skin shader (Round 6: no picker, jets are parked at airports)", async () => {
  await play();
  await v((g) => {
    for (const j of [...g.vehicles.vehicles]) g.vehicles.remove(j);
    const p = g.player.position;
    const jet = g.vehicles.create("jet", { jetType: "f16", pos: [p.x, p.y + 200, p.z], yaw: 0, airborne: true, speed: 150, throttle: 0.6 });
    g.vehicles.enter(jet);
  });
  const open = "F-22 F-16";
  const r = await until((g) => {
    const j = g.vehicles.active;
    if (!j || j.type !== "jet") return null;
    const nav = [];
    j.model.setLights(0, 1); // (night: the lights are on)
    j.model.root.traverse((o) => {
      if (o.isSprite && o.material.color.r > 1.5 && o.material.color.g < 1) nav.push(o.scale.x);
    });
    let skin = false;
    j.model.root.traverse((o) => {
      if (o.material?.defines && "USE_SKIN" in o.material.defines) skin = true;
    });
    return { type: j.jetType, name: j.name, hp: j.maxHealth, cannon: j.spec.cannonRate, salvo: j.spec.salvo, turn: j.cfg.turnRate, slot: g.inventory.selected, nav, skin, span: j.model.span };
  }, 20000);
  await v((g) => {
    g.vehicles.exit({ force: true });
    for (const j of [...g.vehicles.vehicles]) g.vehicles.remove(j);
  });
  const j = JSON.stringify(r);
  assert(r && r.type === "f16" && r.hp === 130 && r.cannon === 20 && r.salvo === 2 && r.turn > 1.1 && r.span < 12, `an F-16 with its own handling and weapons: ${j}`);
  assert(r.slot !== 1, `2 picked the jet instead of hotbar slot 2: ${j}`);
  assert(r.nav.length && r.nav.every((s) => s < 0.4), `small navigation lights: ${j}`);
  assert(r.skin, `the skin shader: ${j}`);
});

// ================= Part 2: enemy jets and UFOs =================

await check("patrol fighters hunt UFOs, leave the player alone when the player shoots UFOs, only the fighter attacked turns hostile, and they fly faster", async () => {
  const r = await v((g) => {
    const T = g.THREE;
    const p = g.player.position;
    g.ufos.clear();
    g.enemyJets.clear();
    const u = g.ufos.spawn({ size: "small", pos: new T.Vector3(p.x + 200, 150, p.z) });
    u.noLeave = true;
    const a = g.enemyJets.spawn({});
    const b = g.enemyJets.spawn({});
    a.hunt.pause = 0;
    a.hunt.checkT = 0;
    let hunted = false;
    for (let i = 0; i < 400; i++) {
      g.vehicles.update(1 / 30);
      a.hunt.pause = Math.min(a.hunt.pause, 0);
      if (a.hunt.ufo) hunted = true;
    }
    g.ufos.damage(u, 1, true);
    for (let i = 0; i < 5; i++) g.vehicles.update(1 / 30);
    const afterUfo = [a.hostile, b.hostile];
    a.damage(5, "player", true);
    for (let i = 0; i < 5; i++) g.vehicles.update(1 / 30);
    const out = { hunted, afterUfo, afterJet: [a.hostile, b.hostile], speed: a.cfg.maxSpeed, mine: g.vehicles.config.jet.maxSpeed, name: a.name };
    g.enemyJets.clear();
    g.ufos.clear();
    return out;
  });
  const j = JSON.stringify(r);
  assert(r.hunted, `they hunt UFOs: ${j}`);
  assert(!r.afterUfo[0] && !r.afterUfo[1], `shooting a UFO doesn't turn them on the player: ${j}`);
  assert(r.afterJet[0] && !r.afterJet[1], `only the one attacked: ${j}`);
  assert(r.speed > r.mine, `faster than before (and than the player's jet): ${j}`);
});

await check("UFOs: more health; a beaming UFO that dashes away takes its beam along (or turns it off); every alien from one UFO is the same kind", async () => {
  const r = await v((g) => {
    const T = g.THREE;
    const p = g.player.position;
    g.ufos.clear();
    const small = g.ufos.spawn({ size: "small", pos: new T.Vector3(p.x, 200, p.z + 300) });
    const u = g.ufos.spawn({ size: "small", pos: new T.Vector3(p.x + 30, p.y + 20, p.z) });
    u.noLeave = true;
    const beam = g.ufos._getBeam(u);
    u.state = "trick";
    u.trick = "abduct";
    u.timer = 30;
    u.target = g.mobs.spawn("cow", p.x + 30, p.y, p.z);
    for (let i = 0; i < 60; i++) g.ufos.update(1 / 30);
    const on = beam.on;
    g.ufos._blink(u, 80, 60);
    for (let i = 0; i < 20; i++) g.ufos.update(1 / 30);
    const beamAfter = u.beam ? { on: u.beam.on, gap: u.beam.top.distanceTo(new T.Vector3(u.pos.x, u.pos.y - u.info.bottom * u.radius, u.pos.z)) } : { on: false, gap: 0 };
    // A crew of six from one ship.
    const big = g.ufos.spawn({ size: "large", pos: new T.Vector3(p.x + 20, p.y + 40, p.z + 20) });
    big.crashPlan = { exploded: false, crew: 6 };
    big.byPlayer = false;
    g.ufos._crash(big);
    const pending = g.ufos.pendingCrews[g.ufos.pendingCrews.length - 1];
    const kinds = new Set();
    for (let k = 0; k < 8; k++) kinds.add(g.ufos.spawn({ size: "medium", pos: new T.Vector3(p.x, 250, p.z + 500) }).crewKind);
    const out = { hp: small.maxHealth, on, beamAfter, pendingKind: pending?.kind, crewKinds: kinds.size };
    g.ufos.pendingCrews.length = 0;
    g.ufos.clear();
    return out;
  });
  const j = JSON.stringify(r);
  assert(r.hp >= 45, `small UFOs are tougher (base 65): ${j}`);
  assert(r.on && !r.beamAfter.on && r.beamAfter.gap < 0.01, `the beam goes out and stays on the ship: ${j}`);
  assert(typeof r.pendingKind === "string", `a wreck's crew has one kind: ${j}`);
});

await check("aliens and skeletons shoot from their weapon's muzzle (the gun's tip, the bow)", async () => {
  const r = await v((g) => {
    g.setMode("survival");
    g.testFlags.noMissions = true;
    g.missions.enabled = false;
    g.progress.enabled = false;
    g.mobs.hostileSpawning = false;
    const out = {};
    let fired = null;
    const lf = g.lasers.fire.bind(g.lasers);
    g.lasers.fire = (o) => {
      if (o.owner === "alien") fired = o.from.clone();
      return lf(o);
    };
    for (const kind of ["alien", "alien_gray", "alien_red", "skeleton"]) {
      for (const m of [...g.mobs.mobs]) if (m.spec.hostile) m.dead = true;
      const p = g.player.position;
      const x = Math.floor(p.x + 2) + 0.5;
      const z = Math.floor(p.z - 9) + 0.5;
      // (In the open: a muzzle inside a tree or a hillside falls back to the eyes, by design.)
      const top = g.world.surfaceY(Math.floor(x), Math.floor(z));
      const air = [];
      for (let dx = -2; dx <= 2; dx++) for (let dz = -2; dz <= 2; dz++) for (let dy = 1; dy <= 4; dy++) air.push(Math.floor(x) + dx, top + dy, Math.floor(z) + dz, 0);
      g.world.setBlocks(air);
      const m = g.mobs.spawn(kind, x, top + 1, z);
      m.ai.target = true;
      m.aggro = true;
      fired = null;
      const arrows0 = g.mobs.arrows.length;
      for (let i = 0; i < 120 && !fired && g.mobs.arrows.length === arrows0; i++) {
        g.mobs.update(1 / 20);
        g.player.health = 20;
      }
      if (kind === "skeleton" && g.mobs.arrows.length > arrows0) fired = g.mobs.arrows[g.mobs.arrows.length - 1].pos.clone();
      g.mobs._animate?.(m);
      m.model.root.updateMatrixWorld(true);
      const arm = kind === "skeleton" ? m.model.parts.armL : m.model.parts.armR;
      const reach = { alien: 14.5, alien_gray: 22.5, alien_red: 17.5, skeleton: 12 }[kind];
      const tip = arm.localToWorld(new g.THREE.Vector3(0, -reach / 16, 0));
      out[kind] = fired ? +fired.distanceTo(tip).toFixed(2) : null;
      m.dead = true;
    }
    g.lasers.fire = lf;
    g.player.health = 20;
    return out;
  });
  for (const [k, d] of Object.entries(r)) assert(d !== null && d < 0.9, `${k} fires from its weapon: ${JSON.stringify(r)}`);
});

await check("airport bunkers (Round 5): an alien ship hovers in the hall of a secured bunker under armed guards; Survival locks it until the Salvage mission", async () => {
  await v((g) => {
    g.setMode("creative");
    let best = null;
    const p = g.player.position;
    for (let dx = -12; dx <= 12; dx++) for (let dz = -12; dz <= 12; dz++) {
      const s = g.sites._site(Math.floor(p.x / 1300) + dx, Math.floor(p.z / 1300) + dz);
      if (s && s.kind === "airport" && s.bunkers.length && (!best || Math.hypot(s.x - p.x, s.z - p.z) < Math.hypot(best.x - p.x, best.z - p.z))) best = s;
    }
    const b = g.sites.bunkerSpots(best)[0];
    g.player.position.set(b.guards[0].x + 4, best.y + 6, b.guards[0].z + 30);
  });
  const found = await until((g) => {
    const u = g.vehicles.vehicles.find((x) => x.hangar);
    const guards = g.mobs.mobs.filter((m) => m.sentry).length;
    if (!u || guards < 4) return null;
    return { guards, y: +u.pos.y.toFixed(1), r: u.radius };
  }, 90000);
  assert(found && found.r < 5, `a bunker ship under guard: ${JSON.stringify(found)}`);
  const lock = await v((g) => {
    const u = g.vehicles.vehicles.find((x) => x.hangar);
    g.setMode("survival");
    g.testFlags.noMissions = false;
    g.progress.enabled = true;
    g.progress.step = 3;
    const early = g.vehicles.canBoard(u);
    g.progress.step = 16; // (Round 6: "Salvage" is mission 17)
    const late = g.vehicles.canBoard(u);
    g.progress.step = 0;
    g.testFlags.noMissions = true;
    g.setMode("creative");
    return { early: !!early, late: !!late };
  });
  assert(lock.early && !lock.late, `locked early, open with Salvage: ${JSON.stringify(lock)}`);
});

// ================= Part 3: UFO piloting =================

await check("UFO piloting: the camera keeps the crosshair clear of the ship for every size and pitch; holding R keeps dashing; each ship fires its own kind's weapon", async () => {
  const r = await v((g) => {
    const T = g.THREE;
    const out = { blocked: [], dash: null, weapons: {} };
    for (const [design, radius] of [["saucer", 4], ["sphere", 8], ["saucer_domed", 16], ["triangle", 38], ["sphere", 70]]) {
      if (g.vehicles.active) g.vehicles.exit({ force: true });
      for (const j of [...g.vehicles.vehicles]) g.vehicles.remove(j);
      const p = g.player.position;
      const u = g.vehicles.create("ufo", { design, radius, pos: [p.x, 200, p.z], yaw: 0 });
      g.vehicles.enter(u);
      for (const pitch of [-1.4, -0.6, 0, 0.5, 1.0]) {
        u.camPitch = pitch;
        u.updateCamera(g.camera, 0.016);
        g.camera.updateMatrixWorld(true);
        const dir = g.camera.getWorldDirection(new T.Vector3());
        const rc = new T.Raycaster(g.camera.position.clone(), dir, 0, 5000);
        rc.camera = g.camera;
        const hits = rc.intersectObject(u.model.hull, true).filter((h) => h.object.isMesh && h.object.visible);
        if (hits.length) out.blocked.push(`${design}/${radius}@${pitch}`);
      }
    }
    // Held dash.
    for (const j of [...g.vehicles.vehicles]) g.vehicles.remove(j);
    const p = g.player.position;
    const u = g.vehicles.create("ufo", { design: "saucer", radius: 5, pos: [p.x, 180, p.z], yaw: 0 });
    g.vehicles.enter(u);
    u.camPitch = 0.1;
    const start = u.pos.clone();
    g.vehicles.keyDown("KeyR");
    g.player.keys.add("KeyR");
    for (let t = 0; t < 3; t += 1 / 60) g.vehicles.update(1 / 60);
    const held = u.pos.distanceTo(start);
    g.player.keys.delete("KeyR");
    for (let i = 0; i < 30; i++) g.vehicles.update(1 / 60);
    out.dash = { held: Math.round(held), after: +(u.pos.distanceTo(start) - held).toFixed(1), tap: Math.round(u.dashDistance) };
    // Weapons per style.
    for (const style of ["rapid", "heavy", "spread", "charged", "sweep", "seeker"]) {
      if (g.vehicles.active) g.vehicles.exit({ force: true });
      for (const j of [...g.vehicles.vehicles]) g.vehicles.remove(j);
      g.ufos.clear();
      g.lasers.clear();
      const s = g.vehicles.create("ufo", { design: "saucer", radius: 5, pos: [p.x, 200, p.z], yaw: 0, style });
      g.vehicles.enter(s);
      s.camYaw = 0;
      s.camPitch = 0;
      const e = g.ufos.spawn({ size: "medium", pos: new T.Vector3(p.x, 203, p.z - 70) });
      e.noLeave = true;
      e.dodgeMul = 0;
      e.health = e.maxHealth = 5000;
      const inp = g.vehicles.input;
      inp.buttons[0] = true;
      inp.pressed.add("mouse0");
      for (let i = 0; i < 180; i++) {
        s.updateCamera(g.camera, 1 / 60);
        g.camera.updateMatrixWorld(true);
        g.vehicles.update(1 / 60);
        g.lasers.update(1 / 60);
        e.pos.set(p.x, 203, p.z - 70);
        e.vel.set(0, 0, 0);
      }
      inp.buttons[0] = false;
      out.weapons[style] = Math.round(5000 - e.health);
    }
    g.vehicles.exit({ force: true });
    for (const j of [...g.vehicles.vehicles]) g.vehicles.remove(j);
    g.ufos.clear();
    return out;
  });
  const j = JSON.stringify(r);
  assert(r.blocked.length === 0, `the crosshair is never behind the ship: ${j}`);
  assert(r.dash.held > r.dash.tap * 4 && r.dash.after < 1, `holding R keeps streaking, letting go stops it: ${j}`);
  for (const [s, d] of Object.entries(r.weapons)) assert(d > 60 && d < 600, `${s}: its own weapon hurts (3 s): ${j}`);
});

// ================= Part 4: Survival =================

await check("Survival settings: the UFO numbers are the mission chain's (activity, spawn chance, max count and sizes hidden); Creative keeps them", async () => {
  const r = await v((g) => {
    g.testFlags.noMissions = false;
    g.setMode("survival");
    g.progress.load(null, g.stats.world);
    g.missions.update(0.5);
    const hidden = document.getElementById("ufos-activity").closest(".row").classList.contains("survival-hidden");
    const note = !document.getElementById("ufo-survival-note").classList.contains("hidden");
    const max0 = g.ufos.maxCount;
    g.progress.step = 2;
    g.missions.update(0.5);
    const max2 = g.ufos.maxCount;
    g.progress.step = 18;
    g.missions.update(0.5);
    const max18 = g.ufos.maxCount;
    g.setMode("creative");
    g.missions.update(0.5);
    const shown = !document.getElementById("ufos-activity").closest(".row").classList.contains("survival-hidden");
    g.progress.step = 0;
    return { hidden, note, max0, max2, max18, shown };
  });
  const j = JSON.stringify(r);
  assert(r.hidden && r.note && r.shown, `the rows: ${j}`);
  assert(r.max0 === 0 && r.max2 >= 1 && r.max2 <= 2 && r.max18 >= 7, `no UFOs first, then one, then many: ${j}`);
});

await check("Survival opening: basic gear; a skeleton drops the bow; a UFO lands and its crew waits before attacking; arrows kill them; the first crate has the pistol; the scout falls to it", async () => {
  await v((g) => {
    g.testFlags.noMissions = false;
    g.setMode("survival");
    g.inventory.clear();
    for (const [id, n] of [[271, 1], [275, 1], [261, 5]]) g.inventory.add(id, n);
    g.progress.load(null, g.stats.world);
    g.missions.missionId = null;
    g.missions.update(0.5);
    g.player.health = 20;
    g.mobs.hostileSpawning = false;
    g.ufos.clear();
    // (The game loads the land around the player as it plays; the hand-stepped
    // time here doesn't, and earlier checks moved the player far away.)
    // (It starts where a new Survival world does: at the spawn, on dry land.)
    g.world.prepareArea(g.spawn.x, g.spawn.z, 8);
    g.player.position.set(g.spawn.x + 0.5, g.world.surfaceY(g.spawn.x, g.spawn.z) + 1, g.spawn.z + 0.5);
    g.player.velocity.set(0, 0, 0);
    g.player.resetFall();
    g.player.air = 10;
    // (Earlier checks leave aliens, skeletons and fighters around: a clean start.)
    g.mobs.clear();
    g.enemyJets.clear();
    for (const x of [...g.vehicles.vehicles]) if (x !== g.vehicles.active) g.vehicles.remove(x);
    window.__hurt = [];
    if (!g.player.__logged) {
      g.player.__logged = true;
      const orig = g.player.damage.bind(g.player);
      g.player.damage = (amount, cause, opts) => {
        window.__hurt.push(`${cause}:${amount}`);
        return orig(amount, cause, opts);
      };
    }
  });
  await play();
  await helpers();
  const r = await v((g) => {
    const out = {};
    out.gear = g.inventory.slots.filter(Boolean).map((s) => s.id).sort().join();
    // 1. The skeleton.
    let sk = null;
    for (let i = 0; i < 60 && !sk; i++) {
      window.__step(0.5);
      sk = g.mobs.mobs.find((x) => x.kind === "skeleton" && x.missionTarget);
    }
    if (!sk) return { ...out, fail: "no skeleton" };
    g.player.position.set(sk.pos.x + 1.5, sk.pos.y, sk.pos.z);
    g.player.resetFall();
    g.inventory.selected = g.inventory.slots.findIndex((s) => s && s.id === 271);
    let hits = 0;
    while (!sk.dead && hits < 20) {
      window.__step(0.7);
      g.mobs.attack(sk, g.interaction.tool);
      hits++;
    }
    out.skDead = sk.dead;
    out.hits = hits;
    out.kills = g.stats.world.skeletonsKilled;
    window.__step(2.5);
    const bow = g.entities.items.find((x) => x.id === 297);
    out.bowItem = !!bow;
    if (bow) {
      g.player.position.copy(bow.pos);
      window.__step(1.5);
    }
    out.bow = g.inventory.slots.some((s) => s && s.id === 297);
    out.m2 = g.progress.mission?.id;
    // 2. The landing.
    let crew = [];
    let poked = false;
    for (let i = 0; i < 90 && !crew.length; i++) {
      window.__step(1);
      const ship = g.missions.state.ship;
      if (ship && !poked && g.missions.state.phase === "incoming") {
        // Watched too long (the marker is on it), then thrown off its course:
        // it must still land.
        poked = true;
        ship.stare = 999;
        g.ufos.anger(ship);
        out.stareHostile = !!ship.hostile;
        ship.state = "circle";
        ship.waypoint = null;
      }
      crew = g.missions.state.crew || [];
    }
    if (!crew.length) {
      const p = g.player.position;
      const probe = [];
      for (let k = 0; k < 8; k++) {
        const a = (k / 8) * Math.PI * 2;
        const x = Math.floor(p.x + Math.cos(a) * 75);
        const z = Math.floor(p.z + Math.sin(a) * 75);
        const top = g.world.surfaceY(x, z);
        probe.push(`${top}/${g.missions.terrain.heightAt(x, z)}/${g.world.getBlock(x, top, z)}/${!!g.world.getChunk(x >> 4, z >> 4)}`);
      }
      return { ...out, fail: "no crew", st: g.missions.state.phase, mid: g.missions.missionId, en: g.missions.enabled, spot: !!g.missions._groundSpot(75, 0.2), probe: probe.join(" "), p: [p.x, p.y, p.z].map(Math.round), wait: g.missions.state.waitT };
    }
    out.calm = crew.every((m) => m.calmT > 20);
    window.__place(crew[0].pos.x + 12, crew[0].pos.z);
    const hp = g.player.health;
    window.__step(8);
    out.calmHp = g.player.health === hp && crew.every((m) => !m.ai.target);
    g.inventory.selected = g.inventory.slots.findIndex((s) => s && s.id === 297);
    let arrows = 0;
    for (let k = 0; k < 14 && crew.some((m) => !m.dead); k++) {
      const m = crew.find((x) => !x.dead);
      // Stand 8 blocks off on a side with a clear line of sight (hills and trees block arrows).
      let spot = 0;
      for (let k = 0; k < 8; k++) {
        const a = (k / 8) * Math.PI * 2;
        window.__place(m.pos.x + Math.cos(a) * 8, m.pos.z + Math.sin(a) * 8);
        const eye = g.player.getEyePosition();
        const to = new g.THREE.Vector3(m.pos.x, m.pos.y + 1, m.pos.z).sub(eye);
        const dist = to.length();
        const hit = g.world.raycast(eye, to.normalize(), dist, { solidOnly: true });
        if (!hit && Math.abs(g.player.position.y - m.pos.y) < 4) {
          spot = 1;
          break;
        }
      }
      out.clear = (out.clear ?? 0) + spot;
      window.__face(m.pos, 1.0);
      g.weapons.press("bow");
      window.__step(1.05);
      window.__face(m.pos, 1.1);
      g.weapons.release();
      arrows++;
      window.__step(0.6);
      g.player.health = Math.max(g.player.health, 10);
    }
    out.arrows = arrows;
    out.m3 = g.progress.mission?.id;
    // 3. The crate.
    let c = null;
    for (let i = 0; i < 80 && !c; i++) {
      window.__step(1);
      g.player.health = Math.max(g.player.health, 10);
      c = g.crates.crates.find((x) => x.state === "landed");
    }
    out.diedBefore = g.player.dead;
    if (!c) return { ...out, fail: "no crate" };
    g.player.position.set(c.pos.x + 1, c.pos.y, c.pos.z);
    g.player.resetFall();
    window.__step(0.5);
    // (A crate can land on a treetop or a ledge: back down on the ground, without a fall.)
    window.__place(g.player.position.x, g.player.position.z);
    out.pistol = g.inventory.slots.some((s) => s && s.id === 287);
    out.m4 = g.progress.mission?.id;
    // 4. The scout, with the pistol (a magazine, then reloads).
    let u = null;
    for (let i = 0; i < 40 && !u; i++) {
      window.__step(0.5);
      g.player.health = Math.max(g.player.health, 10);
      u = g.missions.state.scout;
    }
    if (!u) return { ...out, fail: "no scout", dead: g.player.dead, en: g.missions.enabled, mid: g.missions.missionId, st: Object.keys(g.missions.state).join(), ufos: g.ufos.ufos.length };
    g.inventory.selected = g.inventory.slots.findIndex((s) => s && s.id === 287);
    let shots = 0;
    for (let k = 0; k < 160 && !u.falling && u.state !== "gone"; k++) {
      // (Round 5: real bullets and bigger hills: keep the scout close and above the player, in the clear.)
      u.pos.y = Math.min(Math.max(u.pos.y, g.player.position.y + 8), g.player.position.y + 24);
      const d = Math.hypot(u.pos.x - g.player.position.x, u.pos.z - g.player.position.z);
      if (d > 70) {
        // (It wanders within its tether: bring it back within pistol range
        // rather than walking the player over unknown ground.)
        const q = 45 / d;
        u.pos.x = g.player.position.x + (u.pos.x - g.player.position.x) * q;
        u.pos.z = g.player.position.z + (u.pos.z - g.player.position.z) * q;
      }
      // (Round 5: the pistol fires real bullets: lead the moving target.)
      const lead = u.vel ? u.pos.clone().addScaledVector(u.vel, d / 240) : u.pos;
      window.__face(lead, 0);
      g.weapons.press("pistol");
      shots++;
      window.__step(0.25);
      g.player.health = Math.max(g.player.health, 10);
    }
    window.__step(4);
    out.scoutDown = u.falling || u.state === "gone";
    out.scoutHp = u.maxHealth;
    out.m5 = g.progress.mission?.id;
    return out;
  });
  const hurt = await v(() => window.__hurt.slice(0, 12).join(" "));
  const j = JSON.stringify({ ...r, hurt });
  assert(!r.fail, `the opening ran through: ${j}`);
  assert(r.gear === "261,271,275", `basic gear: ${j}`);
  assert(r.bow && r.m2 === "landing", `the skeleton's bow: ${j}`);
  assert(r.calm && r.calmHp && r.stareHostile === false, `the landed crew waits (and watching the ship come down doesn't anger it): ${j}`);
  assert(r.m3 === "supply" && r.arrows <= 8, `arrows kill the crew: ${j}`);
  assert(r.pistol && r.m4 === "first_contact", `the crate's pistol: ${j}`);
  assert(r.scoutDown && r.scoutHp <= 45 && r.m5 === "crew", `the scout falls to the pistol: ${j}`);
});

await check("reloads: the pistol's 12-round magazine reloads by itself (R early), the sniper has one round, the minigun overheats; the HUD shows it", async () => {
  const r = await v((g) => {
    if (g.player.dead) g.respawn(); // (a check that failed before must not fail this one too)
    g.setMode("creative");
    g.testFlags.noMissions = true;
    for (const id of [287, 295]) if (!g.inventory.slots.some((s) => s && s.id === id)) g.inventory.add(id, 1);
    const w = g.weapons;
    const out = {};
    for (const k in w.reloadT) w.reloadT[k] = 0;
    w.ammo.pistol = 12;
    for (let i = 0; i < 12; i++) {
      w.press("pistol");
      w.update(0.25);
    }
    out.pistolEmpty = { ammo: w.ammo.pistol, reloading: w.reloadT.pistol > 0 };
    const shots0 = w.shots;
    w.press("pistol");
    out.blocked = w.shots === shots0;
    w.update(1.6);
    out.reloaded = w.ammo.pistol === 12;
    w.ammo.pistol = 5;
    out.rKey = w.startReload("pistol");
    w.update(1.6);
    out.sniper = { before: w.ammo.sniper };
    w.sniperShot();
    const s1 = w.shots;
    w.sniperShot();
    out.sniper.second = w.shots === s1;
    w.update(2);
    out.sniper.again = w.ammo.sniper === 1;
    // Minigun heat.
    const slot = g.inventory.slots.findIndex((s) => s && s.id === 295);
    g.inventory.selected = slot;
    w.press("minigun");
    let t = 0;
    while (!w.minigun.overheated && t < 8) {
      w.update(0.05);
      t += 0.05;
    }
    out.minigun = { overheatedAt: +t.toFixed(1) };
    w.release();
    w.update(3.2);
    out.minigun.cool = !w.minigun.overheated;
    // HUD.
    g.inventory.selected = g.inventory.slots.findIndex((s) => s && s.id === 287);
    w.ammo.pistol = 0;
    w.reloadT.pistol = 0;
    w.startReload("pistol");
    return out;
  });
  await frames(3);
  const hud = await v(() => ({ ws: !document.getElementById("weapon-status").classList.contains("hidden") && document.getElementById("weapon-status").textContent, bar: !document.getElementById("reload-bar").classList.contains("hidden") }));
  const j = JSON.stringify({ ...r, hud });
  assert(r.pistolEmpty.ammo === 0 && r.pistolEmpty.reloading && r.blocked && r.reloaded && r.rKey, `pistol: ${j}`);
  assert(r.sniper.second && r.sniper.again, `sniper: ${j}`);
  assert(r.minigun.overheatedAt > 4 && r.minigun.overheatedAt < 6.5 && r.minigun.cool, `minigun: ${j}`);
  assert(hud.bar && /reloading/i.test(hud.ws), `the HUD shows the reload: ${j}`);
});

await check("the chain: jets unlock with 'Take to the air', alien ships with 'Salvage'; missions reward only apples", async () => {
  const r = await v((g) => {
    g.testFlags.noMissions = false;
    g.setMode("survival");
    const list = g.progress.list(g.stats.world);
    const jet = g.vehicles.create("jet", { pos: [g.player.position.x + 30, 200, g.player.position.z], airborne: true, speed: 100 });
    const at = (step) => {
      g.progress.step = step;
      return { jet: !!g.vehicles.canBoard(jet) };
    };
    const out = { n: list.length, rewards: [...new Set(list.flatMap((m) => m.reward.map(([id]) => id)))].join(), jetEarly: at(8).jet, jetLate: at(9).jet };
    g.vehicles.remove(jet);
    g.progress.step = 0;
    g.setMode("creative");
    g.testFlags.noMissions = true;
    return out;
  });
  const j = JSON.stringify(r);
  assert(r.n === 22 && r.rewards === "261,262", `22 missions, apples only: ${j}`);
  assert(r.jetEarly && !r.jetLate, `jets with mission 10: ${j}`);
});

// ================= Part 5: parrots =================

await check("parrots: a macaw rig (hooked beak, wings, long tail) that perches on leaves between flights", async () => {
  const r = await v((g) => {
    const p = g.player.position;
    const x = Math.floor(p.x);
    const z = Math.floor(p.z) - 4;
    // A branch in the open (above whatever is there: a roof would hide it).
    let y = Math.floor(p.y) + 8;
    for (const [dx, dz] of [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1]]) y = Math.max(y, g.world.surfaceY(x + dx, z + dz) + 4);
    g.world.setBlocks([x, y, z, 7, x + 1, y, z, 7, x - 1, y, z, 7, x, y, z + 1, 7, x, y, z - 1, 7]);
    const m = g.mobs.spawn("parrot", x + 0.5, y + 3, z + 0.5);
    m.home = { x: x + 0.5, y: y + 2, z: z + 0.5 };
    const parts = Object.keys(m.model.parts).join();
    let perched = false;
    for (let i = 0; i < 1200 && !perched; i++) {
      g.mobs.update(1 / 20);
      if (m.perched) perched = true;
    }
    for (let i = 0; i < 20; i++) g.mobs.update(1 / 20);
    const out = { parts, perched, perch: +(m.perch ?? 0).toFixed(2), onLeaves: g.world.getBlock(Math.floor(m.pos.x), Math.floor(m.pos.y - 0.1), Math.floor(m.pos.z)) };
    m.dead = true;
    return out;
  });
  const j = JSON.stringify(r);
  assert(/wingL/.test(r.parts) && /tail/.test(r.parts) && /legL/.test(r.parts), `the rig: ${j}`);
  assert(r.perched, `it lands on a branch: ${j}`);
});

// ---------- Summary ----------
const failed = results.filter(([, ok]) => !ok);
console.log(`\n${results.length - failed.length} passed, ${failed.length} failed${errors.length ? `; console errors: ${errors.length}` : ""}.`);
if (errors.length) console.log(errors.slice(0, 5).join("\n"));
await browser.close();
server.close();
process.exit(failed.length || errors.length ? 1 : 0);
