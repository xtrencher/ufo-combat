// Round 14 helicopter tests: the helicopters (js/vehicle-heli.js,
// js/heli-model.js), the aliens' gunships and the parked helicopters
// (js/helis.js), the helicopters' missions (progression.js, missions.js).
// In Node (fast): the three missions in the pool (real stats, known events,
// "Air cavalry" in every run after the jets and the tank battle, the other
// two after it), the run's length, the Creative item. In the browser (a
// Missions world): the call-in (the pause menu's button) puts the player in
// an Apache on the ground; the rotor spins up (no lift before), it lifts
// off, holds its height, flies forward, lands gently (and a hard landing
// hurts); getting out and boarding again; the gun's tracers, a rocket
// salvo's blasts, a Hellfire locked on a tank that hits it; an enemy
// gunship engages a player on foot (gun, rockets) and is shot down (the
// kill counted, it spins in and blows up); the jets' lock sees gunships; a
// helicopter parked at an airport, locked until its mission; the three
// missions start, set out what they need and complete (the rescue's crew
// picked up and brought home). With --online: a guest sees the host's
// helicopter (its rotor, its climb), and hurts the host's gunship.
//
//   node r14-heli-tests.mjs [--only=substring] [--node] [--online]
// (GAME_ROOT=dir runs another copy of the game; SHOTS=dir saves screenshots.)
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
  if (args.only && !name.toLowerCase().includes(String(args.only).toLowerCase())) return;
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

await check("the helicopters' missions: in the pool, Air cavalry in every run (after the jets and the tanks), real stats, known events", async () => {
  const P = await imp("js/progression.js");
  const { STAT_LABELS } = await imp("js/stats.js");
  const known = new Set(STAT_LABELS.map(([k]) => k));
  const NEW = ["air_cav", "medevac", "gunship_hunt"];
  for (const id of NEW) {
    const m = P.missionById(id);
    assert(m, `${id} in the pool`);
    for (const o of m.objectives) assert(known.has(o.stat), `${id}: ${o.stat} is counted`);
    assert(P.MISSIONS.indexOf(m) >= P.CLASSIC_IDS.length, `${id} after the classic ones`);
  }
  assert(!P.missionById("air_cav").optional && P.missionById("medevac").optional && P.missionById("gunship_hunt").optional, "Air cavalry always; the others sometimes");
  const src = fs.readFileSync(path.join(ROOT, "js/missions.js"), "utf8");
  for (const ev of ["aircav", "medevac", "gunships"]) assert(src.includes(`case "${ev}":`), `the director plays ${ev}`);
  let opt = 0;
  for (let seed = 1; seed <= 200; seed++) {
    const c = P.makeChain(seed);
    const at = (id) => c.ids.indexOf(id);
    assert(c.ids.length >= P.CHAIN_MIN && c.ids.length <= P.CHAIN_MAX, `length ${seed}`);
    assert(at("air_cav") > at("wings") && at("air_cav") > at("tank_battle"), `Air cavalry after the jets and the tanks: ${seed}`);
    for (const id of ["medevac", "gunship_hunt"]) if (at(id) >= 0) {
      assert(at(id) > at("air_cav"), `${id} after Air cavalry: ${seed}`);
      opt++;
    }
  }
  assert(opt > 120 && opt < 400, `the optional ones play in some runs: ${opt}`);
});

await check("the helicopter item: Creative's Vehicles tab (id 319), summons a helicopter", async () => {
  const V = await imp("js/content/vehicles.js");
  assert(V.HELI_ITEM === 319 && V.items[319]?.vehicle === "heli" && typeof V.icons.vehicle_heli === "function" && typeof V.itemUse[319] === "function", "the item");
});

// ---------- In the browser ----------

if (!args.node) await browserChecks();

async function browserChecks() {
  const { chromium } = await import("playwright-core");
  const PORT = 9930 + Math.floor(Math.random() * 40);
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
  const errors = [];
  const browser = await chromium.launch({
    executablePath: process.env.CHROMIUM_PATH || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome",
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
      // (Clicked from inside the page: on a busy machine the menu never looks "stable" to Playwright.)
      const click = (sel) => p.evaluate((s) => document.querySelector(s)?.click(), sel).catch(() => {});
      if (st === "start") await click("#play-btn");
      else if (await p.isVisible("#resume-btn")) await click("#resume-btn");
      else if (await p.isVisible("#click-to-play").catch(() => false)) await click("#click-to-play");
      else {
        await p.mouse.click(300, 200);
        await frames(p, 5);
      }
      await frames(p, 3);
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
  const out = process.env.SHOTS || "";
  // A big flat field round the player (stone under grass, open sky), the chunks loaded.
  const FIELD = `async (g) => {
    const p = g.player;
    const x0 = Math.floor(p.position.x), z0 = Math.floor(p.position.z);
    for (let i = 0; i < 200; i++) { let ok = true; for (let z = z0 - 120; z <= z0 + 30; z += 16) for (let x = x0 - 40; x <= x0 + 40; x += 16) if (!g.world.getChunk(x >> 4, z >> 4)) ok = false; if (ok) break; await new Promise((r) => setTimeout(r, 300)); }
    const y = 90;
    const list = [];
    for (let x = x0 - 40; x <= x0 + 40; x++) for (let z = z0 - 120; z <= z0 + 30; z++) { list.push(x, y - 1, z, 3, x, y, z, 1); for (let k = 1; k < 28; k++) list.push(x, y + k, z, 0); }
    g.world.setBlocks(list);
    for (const v of [...g.vehicles.vehicles]) if (v.isGround || v.isHeli) g.vehicles.remove(v);
    p.position.set(x0 + 0.5, y + 1, z0 + 0.5);
    p.yaw = 0;
    p.pitch = 0;
    return { x0, y, z0 };
  }`;
  const field = (p) => p.evaluate((src) => new Function("g", `return (${src})(g);`)(window.__ufo), FIELD);
  const STEP = `(g, n) => { for (let i = 0; i < n; i++) { g.vehicles.update(1 / 30); g.effects.update(1 / 30); g.lasers.update(1 / 30); } }`;

  const page = await newPage("solo");
  const soloOnly = args.only && String(args.only).includes("online");
  if (!soloOnly) await browserCheck("boot: a Missions world with the helicopters wired in (types, summons, the call-in button, the manager)", async () => {
    await page.goto(`http://127.0.0.1:${PORT}/index.html?seed=8141&type=missions&graphics=low`, { waitUntil: "load", timeout: 60000 });
    await page.waitForFunction(() => !!window.__ufo && window.__ufo.graphicsReady, null, { timeout: 120000 });
    await play(page);
    const r = await v(page, (g) => ({ heli: !!g.vehicles.constructor.types.heli, gunship: !!g.vehicles.constructor.types.gunship, summon: !!g.vehicles.constructor.summons.heli?.ground, war: !!g.vehicles.helis, button: !!document.querySelector('#pause-callins [data-callin="heli"]') }));
    assert(Object.values(r).every(Boolean), `wired: ${JSON.stringify(r)}`);
  });

  if (!soloOnly) await browserCheck("the call-in: an Apache on the ground, the player in it; the rotor spins up (no lift before), it lifts off, holds its height, flies, lands gently; F out and in again", async () => {
    const f = await field(page);
    const r = await v(page, async (g, a) => {
      const step = new Function("return " + a.STEP)();
      g.player.setMode("creative");
      const out = {};
      document.querySelector('#pause-callins [data-callin="heli"]').click();
      const h = g.vehicles.active;
      out.type = h?.type;
      out.kind = h?.kind;
      if (!h) return out;
      out.ground0 = h.onGround;
      const keys = g.player.keys;
      keys.add("Space");
      step(g, 30);
      out.rpmEarly = h.rpm;
      out.liftEarly = h.pos.y - h.bottom - (a.f.y + 1); // (the field's top is a block over y)
      step(g, 200);
      out.rpm = h.rpm;
      out.climbed = h.pos.y - h.bottom - (a.f.y + 1);
      keys.delete("Space");
      step(g, 45);
      const y1 = h.pos.y;
      step(g, 60);
      out.drift = Math.abs(h.pos.y - y1);
      keys.add("KeyW");
      const z1 = h.pos.z;
      step(g, 150);
      keys.delete("KeyW");
      out.speed = Math.hypot(h.vel.x, h.vel.z);
      out.moved = z1 - h.pos.z;
      out.tilt = h.pitch;
      keys.add("KeyS");
      step(g, 90);
      keys.delete("KeyS");
      step(g, 90);
      // Down (Shift held all the way: the assist eases the last blocks).
      const hp = h.health;
      keys.add("ShiftLeft");
      let t = 0;
      while (!h.onGround && t < 900) {
        step(g, 1);
        t++;
      }
      keys.delete("ShiftLeft");
      out.landed = h.onGround;
      out.landHurt = hp - h.health;
      // Out (F) on the ground: the engine stops; in again.
      g.vehicles.toggle();
      out.out = !g.vehicles.active;
      step(g, 60);
      out.spinDown = h.rpm < 1;
      g.vehicles.toggle();
      out.back = g.vehicles.active === h;
      // A hard landing hurts (it survives): dropped from 8 blocks with the rotor stopped.
      g.vehicles.exit({ force: true });
      h.pos.y += 8;
      h.onGround = false;
      h._settled = false;
      h.rpm = 0;
      h.engineOn = false;
      const hp2 = h.health;
      step(g, 90);
      out.hardHurt = hp2 - h.health;
      out.alive = h.alive;
      return out;
    }, { f, STEP });
    assert(r.type === "heli" && r.kind === "apache" && r.ground0, `called in: ${JSON.stringify(r)}`);
    assert(r.rpmEarly < 0.5 && r.liftEarly < 0.5, `no lift before the rotor is up: ${JSON.stringify(r)}`);
    assert(r.rpm === 1 && r.climbed > 12, `lift-off: ${JSON.stringify(r)}`);
    assert(r.drift < 1, `holds its height: ${JSON.stringify(r)}`);
    assert(r.speed > 20 && r.moved > 30 && r.tilt < -0.3, `forward flight: ${JSON.stringify(r)}`);
    assert(r.landed && r.landHurt === 0, `a gentle landing: ${JSON.stringify(r)}`);
    assert(r.out && r.spinDown && r.back, `out and in: ${JSON.stringify(r)}`);
    assert(r.hardHurt > 20 && r.alive, `a hard landing hurts: ${JSON.stringify(r)}`);
  });

  if (!soloOnly) await browserCheck("weapons: the gun's tracers, a rocket salvo's blasts, a Hellfire locks on a tank and hits it", async () => {
    const f = await field(page);
    const r = await v(page, async (g, a) => {
      const step = new Function("return " + a.STEP)();
      g.player.setMode("creative");
      const T = g.THREE;
      const h = g.vehicles.create("heli", { kind: "apache", pos: [a.f.x0 + 0.5, a.f.y + 25, a.f.z0 + 0.5], yaw: 0, airborne: true });
      g.vehicles.enter(h);
      const out = {};
      const f0 = g.lasers.fired;
      g.vehicles.input.buttons[0] = true;
      step(g, 30);
      g.vehicles.input.buttons[0] = false;
      out.rounds = g.lasers.fired - f0;
      // A salvo at the ground ahead.
      h.lookPitch = -0.35;
      const x0 = g.effects.explosionCount;
      g.vehicles.input.pressed.add("mouse2");
      step(g, 4);
      out.salvoAway = 38 - h.rockets;
      step(g, 60);
      out.blasts = g.effects.explosionCount - x0;
      out.rockets = h.rockets;
      // A Hellfire: an enemy tank ahead, kept round the crosshair, locked, fired.
      const e = g.vehicles.ground.spawnTank([a.f.x0 + 0.5, a.f.y + 1, a.f.z0 - 100], 0, { kind: "mbt", force: true });
      e.pos.y = a.f.y + 1;
      e.idle = true;
      g.vehicles.input.pressed.add("KeyX");
      step(g, 1);
      out.weapon = h.weapon;
      const hp0 = e.health;
      let locked = 0;
      for (let i = 0; i < 90; i++) {
        h.updateCamera(g.camera, 1 / 30);
        const d = e.pos.clone().setY(e.pos.y + 1.3).sub(h._camPos);
        h.lookYaw = Math.atan2(-d.x, -d.z);
        h.lookPitch = Math.atan2(d.y, Math.hypot(d.x, d.z));
        step(g, 1);
        if (h.lock.locked) locked++;
      }
      out.locked = locked > 0;
      out.hud = !!h.overlay(g.camera).hud?.target?.locked;
      g.vehicles.input.pressed.add("mouse2");
      for (let i = 0; i < 150 && e.health >= hp0; i++) {
        h.updateCamera(g.camera, 1 / 30);
        step(g, 1);
      }
      out.missiles = h.missilesLeft;
      out.tankHurt = hp0 - e.health;
      g.vehicles.exit({ force: true });
      g.vehicles.remove(h);
      if (g.vehicles.vehicles.includes(e)) g.vehicles.remove(e);
      return out;
    }, { f, STEP });
    assert(r.rounds >= 7, `the gun: ${JSON.stringify(r)}`);
    assert(r.salvoAway === 4 && r.rockets === 34 && r.blasts >= 2, `the rockets: ${JSON.stringify(r)}`);
    assert(r.weapon === "missiles" && r.locked && r.hud, `the lock: ${JSON.stringify(r)}`);
    assert(r.missiles === 7 && r.tankHurt >= 150, `the Hellfire: ${JSON.stringify(r)}`);
  });

  if (!soloOnly) await browserCheck("an enemy gunship engages a player on foot (gun, rockets), the jets' lock sees it; shot down, it spins in and blows up (the kill counted)", async () => {
    const f = await field(page);
    const r = await v(page, async (g, a) => {
      const step = new Function("return " + a.STEP)();
      g.player.setMode("survival");
      g.player.flying = false;
      const out = {};
      const hurt = [];
      const dmg = g.player.damage;
      g.player.damage = (amt, c) => (hurt.push([amt, c]), false);
      const gs = g.vehicles.helis.spawnGunship([a.f.x0 + 0.5, a.f.y + 45, a.f.z0 - 110], 0, { force: true });
      const l0 = g.lasers.fired;
      let rockets = 0;
      for (let i = 0; i < 30 * 25 && (g.lasers.fired - l0 < 6 || !rockets); i++) {
        step(g, 1);
        rockets = Math.max(rockets, gs.missiles.filter((m) => m.kind === "rocket").length);
      }
      out.foe = gs.ai.foe === g.player;
      out.rounds = g.lasers.fired - l0;
      out.rockets = rockets;
      step(g, 60);
      out.hurt = hurt.length;
      out.dist = Math.round(gs.pos.distanceTo(g.player.position));
      g.player.damage = dmg;
      // A jet's lock sees it (a "vehicle" target).
      const jet = g.vehicles.create("jet", { pos: [a.f.x0, a.f.y + 80, a.f.z0 + 60], yaw: 0, airborne: true, speed: 80, throttle: 0.6 });
      out.lockable = jet._lockables().some((c) => c.ref === gs);
      g.vehicles.remove(jet);
      // Shot down by the player: it spins in and blows up.
      const d0 = g.stats.world.gunshipsDown || 0;
      const x0 = g.effects.explosionCount;
      gs.damage(400, "missile", true);
      out.crashing = gs.crashing;
      for (let i = 0; i < 30 * 20 && gs.crashing; i++) step(g, 1);
      out.impact = !gs.crashing && g.effects.explosionCount > x0;
      out.down = (g.stats.world.gunshipsDown || 0) - d0;
      if (g.vehicles.vehicles.includes(gs)) g.vehicles.remove(gs);
      return out;
    }, { f, STEP });
    assert(r.foe && r.rounds >= 6 && r.rockets >= 1, `it engaged: ${JSON.stringify(r)}`);
    assert(r.hurt >= 1, `its fire reached the player: ${JSON.stringify(r)}`);
    assert(r.lockable, `the jets' lock: ${JSON.stringify(r)}`);
    assert(r.crashing && r.impact && r.down === 1, `down: ${JSON.stringify(r)}`);
  });

  if (!soloOnly) await browserCheck("a helicopter parked at an airport, locked until its mission (Creative: free), boarded: the player's", async () => {
    const r = await v(page, async (g) => {
      const sites = g.sites;
      const hw = g.vehicles.helis;
      const out = {};
      const p = g.player.position;
      const s = sites.nearest(p.x, p.z, 20000);
      if (!s) return { none: true };
      const spots = hw.padSpots(s);
      out.spots = spots.length;
      const sp = spots[0];
      g.player.position.set(sp.x + 14, sp.y + 2, sp.z);
      for (let i = 0; i < 200; i++) {
        let ok = true;
        for (const [dx, dz] of [[0, 0], [16, 0], [-16, 0], [0, 16], [0, -16]]) if (!g.world.getChunk(Math.floor(sp.x + dx) >> 4, Math.floor(sp.z + dz) >> 4)) ok = false;
        if (ok) break;
        await new Promise((r) => setTimeout(r, 300));
      }
      // (Its spot cleared: a terrain test, not the airport's layout.)
      const list = [];
      for (let x = -9; x <= 9; x++) for (let z = -9; z <= 9; z++) for (let y = 0; y < 8; y++) list.push(Math.floor(sp.x) + x, Math.floor(sp.y) + y, Math.floor(sp.z) + z, 0);
      g.world.setBlocks(list);
      hw._blocked.clear();
      hw._padT = 0;
      hw.update(0.1);
      const h = hw.pads.get(sp.key);
      out.parked = !!h && h.parkedAt === s.id && h.type === "heli";
      // Locked in the chain before its mission.
      g.player.setMode("survival");
      const P = g.progress;
      const was = { chain: P.chain.slice(), step: P.step, vars: P.vars?.slice(), enabled: P.enabled };
      P.setChain(["skeleton", "wings", "tank_battle", "air_cav", "armada"]);
      P.step = 1;
      P.enabled = true;
      out.locked = !!g.vehicles.canBoard(h);
      P.step = 3;
      out.unlocked = !g.vehicles.canBoard(h);
      g.player.setMode("creative");
      P.step = 0;
      out.creative = !g.vehicles.canBoard(h);
      P.setChain(was.chain, was.vars);
      P.step = was.step;
      P.enabled = was.enabled;
      g.vehicles.enter(h);
      g.vehicles.exit({ force: true });
      hw.update(1.1);
      out.taken = !h.parkedAt && h.tookKey === sp.key && !hw.pads.has(sp.key);
      g.vehicles.remove(h);
      return out;
    });
    assert(!r.none, "no airport near the seed's spawn");
    assert(r.spots >= 1 && r.parked, `parked: ${JSON.stringify(r)}`);
    assert(r.locked && r.unlocked && r.creative, `the lock: ${JSON.stringify(r)}`);
    assert(r.taken, `boarded: ${JSON.stringify(r)}`);
  });

  if (!soloOnly) await browserCheck("the helicopters' missions start, set out what they need and complete (the rescue's crew picked up and brought home)", async () => {
    await field(page);
    const r = await v(page, async (g) => {
      g.player.setMode("survival");
      g.player.damage = () => false;
      const out = {};
      const P = g.progress;
      const D = g.missions;
      for (const id of ["air_cav", "gunship_hunt", "medevac"]) {
        P.setChain(["skeleton", id, "armada"]);
        P.step = 1;
        P.base = P._pick(g.stats.world);
        P.enabled = true;
        D.enabled = true;
        D.missionId = null;
        const o = {};
        for (let i = 0; i < 90; i++) {
          D.checkT = 0;
          D.update(0.5);
          D.state.t = Math.max(D.state.t || 0, 70);
          if (id !== "medevac" && g.vehicles.vehicles.some((u) => u.mission && u.alive)) break;
          if (id === "medevac" && D.state.crews?.length) break;
        }
        o.helis = (D.state.helis || []).length;
        o.units = g.vehicles.vehicles.filter((u) => u.mission && u.alive).length;
        o.target = !!D.target;
        if (id === "medevac") {
          // Fly out there: the crew climbs in; home: rescued.
          const cr = D.state.crews[0];
          const h = D.state.helis[0];
          g.vehicles.enter(h);
          g.player.position.set(cr.pos.x + 30, cr.pos.y + 1, cr.pos.z);
          h.pos.set(cr.pos.x + 30, cr.pos.y + 40, cr.pos.z);
          h.onGround = false;
          for (let i = 0; i < 200 && !cr.people.length; i++) {
            await new Promise((r) => setTimeout(r, 100));
            D.checkT = 0;
            D.update(0.5);
          }
          o.crew = cr.people.length;
          h.pos.set(cr.pos.x + 8, cr.pos.y + 1.8, cr.pos.z);
          h.onGround = true;
          D.checkT = 0;
          D.update(0.5);
          o.aboard = cr.state === "aboard";
          const home = D.state.home;
          h.pos.set(home.x + 3, home.y + 1.8, home.z);
          h.onGround = true;
          D.checkT = 0;
          D.update(0.5);
          o.home = cr.state === "home";
          g.vehicles.exit({ force: true });
        }
        P.update(g.stats.world);
        if (id === "medevac") o.done = P.step === 2;
        else {
          for (const ob of P.mission.objectives) g.stats.add(ob.stat, ob.goal * 3);
          P.update(g.stats.world);
          o.done = P.step === 2;
        }
        D._cleanup();
        for (const u of [...g.vehicles.vehicles]) if (u.mission || u.isGunship || u.isEnemyGround) g.vehicles.remove(u);
        out[id] = o;
      }
      return out;
    });
    assert(r.air_cav.helis >= 1 && r.air_cav.units >= 2 && r.air_cav.target && r.air_cav.done, `air_cav: ${JSON.stringify(r.air_cav)}`);
    assert(r.gunship_hunt.units >= 1 && r.gunship_hunt.target && r.gunship_hunt.done, `gunship_hunt: ${JSON.stringify(r.gunship_hunt)}`);
    assert(r.medevac.helis >= 1 && r.medevac.target && r.medevac.crew >= 1 && r.medevac.aboard && r.medevac.home && r.medevac.done, `medevac: ${JSON.stringify(r.medevac)}`);
  });

  if (out && !soloOnly) {
    await field(page);
    await v(page, (g) => {
      g.player.setMode("creative");
      document.querySelector('#pause-callins [data-callin="heli"]').click();
      const h = g.vehicles.active;
      h.rpm = 1;
      h.onGround = false;
      h.pos.y += 12;
      g.player.keys.add("KeyW");
      return true;
    });
    await frames(page, 30);
    await page.screenshot({ path: path.join(out, "r14-heli-flight.png") });
    await v(page, (g) => g.player.keys.delete("KeyW"));
  }

  if (args.online) {
    const { default: express } = await import("express");
    const { ExpressPeerServer } = await import("peer");
    const PEER_PORT = PORT + 60;
    const app = express();
    const peerHttp = app.listen(PEER_PORT, "127.0.0.1");
    app.use("/ufo", ExpressPeerServer(peerHttp, { path: "/" }));
    const NET_Q = `peerServer=127.0.0.1:${PEER_PORT}/ufo&noStun=1&graphics=low`;
    await page.close();
    const host = await newPage("host", { width: 640, height: 360 });
    const guest = await newPage("guest", { width: 640, height: 360 });
    await browserCheck("online: a guest sees the host's helicopter (its rotor, its climb) and hurts the host's gunship", async () => {
      await host.goto(`http://127.0.0.1:${PORT}/index.html?seed=8142&type=missions&${NET_Q}`, { waitUntil: "load", timeout: 60000 });
      await host.waitForFunction(() => !!window.__ufo && window.__ufo.graphicsReady, null, { timeout: 120000 });
      await host.click("#menu-mp-btn");
      await host.fill("#mp-nick", "Alice");
      await host.click("#mp-host-btn");
      const code = await until(host, (g) => g.net.code, 30000);
      assert(code, "no room code");
      await host.click("#mp-lobby-play");
      await host.waitForFunction(() => window.__ufo.gameState === "playing", null, { timeout: 30000 });
      const f = await field(host);
      await guest.goto(`http://127.0.0.1:${PORT}/index.html?join=${code}&${NET_Q}`, { waitUntil: "load", timeout: 60000 });
      await guest.waitForSelector("#mp-join-boot:not(.hidden)", { timeout: 30000 });
      await guest.fill("#mp-boot-nick", "Bob");
      await guest.click("#mp-boot-join");
      await guest.waitForFunction(() => !!window.__ufo && window.__ufo.graphicsReady, null, { timeout: 120000 });
      assert(await until(guest, (g) => g.mp.stateLoaded, 60000), "the host's state never arrived");
      await play(guest);
      await v(guest, (g, f) => { g.player.setMode?.("survival"); g.player.position.set(f.x0 + 3.5, f.y + 1, f.z0 + 0.5); return true; }, f);
      // The host's helicopter: in the air, the rotor at speed.
      await v(host, (g, f) => {
        g.player.setMode("creative");
        const h = g.vehicles.create("heli", { kind: "apache", pos: [f.x0 + 0.5, f.y + 6, f.z0 - 20], yaw: 0, airborne: true });
        g.vehicles.enter(h);
        g.player.keys.add("Space");
        return true;
      }, f);
      const seen = await until(guest, (g) => {
        const h = g.vehicles.vehicles.find((v) => v.type === "heli" && v.puppet);
        return h && h.rpm > 0.5 ? { y: h.pos.y, rpm: h.rpm } : null;
      }, 30000);
      assert(seen, "the guest never saw the host's helicopter");
      // (Climbs on the host: its own steps, whatever its page's keys and focus do meanwhile.)
      await v(host, (g) => { g.player.keys.add("Space"); for (let i = 0; i < 60; i++) g.vehicles.update(1 / 30); g.player.keys.delete("Space"); return true; });
      const climbed = await until(guest, (g, y0) => {
        const h = g.vehicles.vehicles.find((v) => v.type === "heli" && v.puppet);
        return h && h.pos.y > y0 + 6 ? h.pos.y : null;
      }, 30000, seen.y);
      if (!climbed) {
        const hs = await v(host, (g) => { const h = g.vehicles.vehicles.find((x) => x.type === "heli"); return h && { y: h.pos.y, alive: h.alive, net: h.net?.nid, active: g.vehicles.active === h, rpm: h.rpm }; });
        const gs = await v(guest, (g) => g.vehicles.vehicles.filter((x) => x.type === "heli").map((h) => ({ y: h.pos.y, puppet: !!h.puppet, nid: h.net?.nid, alive: h.alive })));
        assert(false, `the guest's copy didn't climb with the host's: seen ${JSON.stringify(seen)}, host ${JSON.stringify(hs)}, guest ${JSON.stringify(gs)}`);
      }
      await v(host, (g) => { g.player.keys.delete("Space"); g.vehicles.exit({ force: true }); return true; });
      // The host's gunship: the guest sees it and hurts it.
      await v(host, (g, f) => { g.vehicles.helis.spawnGunship([f.x0 + 0.5, f.y + 40, f.z0 - 90], 0, { force: true }); return true; }, f);
      const gseen = await until(guest, (g) => (g.vehicles.vehicles.find((v) => v.type === "gunship" && v.puppet) ? true : null), 30000);
      assert(gseen, "the guest never saw the host's gunship");
      const hp0 = await v(host, (g) => g.vehicles.helis.units[0]?.health);
      await v(guest, (g) => { const e = g.vehicles.vehicles.find((v) => v.type === "gunship" && v.puppet); e.damage(50, "player", true); return true; });
      const hurt = await until(host, (g, hp0) => (g.vehicles.helis.units[0]?.health < hp0 ? true : null), 15000, hp0);
      assert(hurt, "the host's gunship wasn't hurt by the guest's hit");
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
