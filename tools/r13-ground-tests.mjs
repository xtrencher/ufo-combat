// Round 13 ground tests: tanks, ballistic missiles, the tank-fire effects,
// the military bases and the new missions (js/vehicle-tank.js, js/tanks.js,
// js/ballistic.js, js/effects.js, js/sites.js, js/missions.js).
// In Node (fast): the airbases only in worlds with the Round 13 terrain, the same
// for every peer, with their parts (walls, towers, barracks, the yard's
// vehicles, AA positions); the new missions in the pool (the tank battle in
// every run, real stats, the director's events).
// In the browser (a Missions world): a tank drives (and climbs a step),
// fires, its shell bursts (the dust before the fireball); an enemy tank
// engages a player on foot; the player's tank destroys it (the kill
// counted); an AA vehicle fires flak and a SAM at a jet (its warning
// sees it); a launcher raises its missile and launches (slow at first)
// and the warhead lands; Creative puts a tank down; the new missions start
// and set out their units. With --online: a guest sees the host's enemy
// tank, its shots, and hurts it.
//
//   node r13-ground-tests.mjs [--only=substring] [--node] [--online]
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
  // (The boot always runs: the browser checks build on it.)
  if (args.only && !name.startsWith("boot") && !name.toLowerCase().includes(String(args.only).toLowerCase())) return;
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

await check("airbases: only with the Round 13 terrain, the same for every peer, walls, towers, barracks, the yard, AA positions", async () => {
  const { TerrainGenerator } = await imp("js/terrain.js");
  const old = new TerrainGenerator(1234, { sites: true, vanilla: false });
  assert(!old.sites.within(0, 0, 12000).some((s) => s.base), "an old Missions world's sites are as they were");
  const a = new TerrainGenerator(1234, { sites: true, vanilla: true });
  const b = new TerrainGenerator(1234, { sites: true, vanilla: true });
  const sa = a.sites.within(0, 0, 12000).filter((s) => s.base);
  const sb = b.sites.within(0, 0, 12000).filter((s) => s.base);
  assert(sa.length >= 3, `airbases: ${sa.length}`);
  assert(sa.map((s) => s.id).join() === sb.map((s) => s.id).join(), "the same bases for the same seed");
  const s = sa[0];
  const B = s.base;
  assert(B.towers.length >= 8 && B.barracks.length >= 2 && B.sheds.length >= 1 && B.aa.length >= 4 && B.fuel.length === 4 && B.ammo.length >= 1 && B.dishes.length === 2, `parts: ${JSON.stringify({ t: B.towers.length, b: B.barracks.length, s: B.sheds.length, aa: B.aa.length })}`);
  const yard = a.sites.yardSpots(s);
  assert(yard.length >= 6 && yard.some((y) => y.kind === "tel") && yard.every((y) => Number.isFinite(y.x + y.z + y.yaw) && y.key.startsWith(s.id)), `the yard: ${yard.length}`);
  // The blocks: a chunk at the main gate has the wall, the fence, the road.
  const [gx, gz] = a.sites.toWorld(s, B.gate + 7, B.v0 + 3);
  const blocks = new Uint16Array(16 * 16 * 256);
  a.sites.placeInChunk(blocks, Math.floor(gx / 16), Math.floor(gz / 16));
  const I = await imp("js/content/ids.js");
  const n = (id) => blocks.reduce((c, x) => c + (x === id ? 1 : 0), 0);
  assert(n(I.STONE_BRICKS) > 20 && n(I.IRON_BARS) > 10 && n(I.GRAY_CONCRETE) > 10, `the gate's chunk: bricks ${n(I.STONE_BRICKS)}, bars ${n(I.IRON_BARS)}, concrete ${n(I.GRAY_CONCRETE)}`);
});

await check("the new missions: in the pool, the tank battle in every run, real stats, known events", async () => {
  const P = await imp("js/progression.js");
  const { STAT_LABELS } = await imp("js/stats.js");
  const known = new Set(STAT_LABELS.map(([k]) => k));
  const NEW = ["tank_battle", "stop_launch", "convoy", "air_defense", "base_assault"];
  for (const id of NEW) {
    const m = P.missionById(id);
    assert(m, `${id} in the pool`);
    for (const o of m.objectives) assert(known.has(o.stat), `${id}: ${o.stat} is counted`);
  }
  const src = fs.readFileSync(path.join(ROOT, "js/missions.js"), "utf8");
  for (const ev of ["tanks", "launch", "convoy", "aasites", "baseassault"]) assert(src.includes(`case "${ev}":`), `the director plays ${ev}`);
  let seen = 0;
  for (let seed = 1; seed <= 200; seed++) {
    const c = P.makeChain(seed);
    assert(c.ids.length >= P.CHAIN_MIN && c.ids.length <= P.CHAIN_MAX, `length ${seed}`);
    assert(c.ids.includes("tank_battle"), `the tank battle in run ${seed}`);
    const at = (id) => c.ids.indexOf(id);
    assert(at("tank_battle") > at("patrol"), `after the patrol: ${seed}`);
    for (const id of ["stop_launch", "convoy", "air_defense"]) if (at(id) >= 0) assert(at(id) > at("wings"), `${id} after the jets: ${seed}`);
    if (at("base_assault") >= 0) assert(at("base_assault") > at("tank_battle"), `the base after the tanks: ${seed}`);
    seen += NEW.filter((id) => at(id) >= 0).length;
  }
  assert(seen > 200 + 200, `the optional ones play too: ${seen}`);
});

// ---------- In the browser ----------

if (!args.node) await browserChecks();

async function browserChecks() {
  const { chromium } = await import("playwright-core");
  const PORT = 9870 + Math.floor(Math.random() * 40);
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
      if (st === "start") await p.click("#play-btn", { timeout: 5000 }).catch(() => {});
      else if (await p.isVisible("#resume-btn")) await p.click("#resume-btn", { timeout: 3000 }).catch(() => {});
      else if (await p.isVisible("#click-to-play").catch(() => false)) await p.click("#click-to-play", { timeout: 3000 }).catch(() => {});
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
  const step = (p, n, extra = null) => v(p, (g, a) => {
    for (let i = 0; i < a.n; i++) {
      g.vehicles.update(1 / 30);
      g.effects.update(1 / 30);
      g.lasers.update(1 / 30);
    }
    return true;
  }, { n });
  // A flat field round the player (stone under grass), the chunks loaded.
  const FIELD = `async (g, o) => {
    const p = g.player;
    const x0 = Math.floor(p.position.x), z0 = Math.floor(p.position.z);
    for (let i = 0; i < 200; i++) { let ok = true; for (let z = z0 - 100; z <= z0 + 20; z += 16) for (let x = x0 - 32; x <= x0 + 32; x += 16) if (!g.world.getChunk(x >> 4, z >> 4)) ok = false; if (ok) break; await new Promise((r) => setTimeout(r, 300)); }
    const y = 90;
    const list = [];
    for (let x = x0 - 32; x <= x0 + 32; x++) for (let z = z0 - 100; z <= z0 + 20; z++) { list.push(x, y - 1, z, 3, x, y, z, 1); for (let k = 1; k < 12; k++) list.push(x, y + k, z, 0); }
    g.world.setBlocks(list);
    for (const v of [...g.vehicles.vehicles]) if (v.isGround) g.vehicles.remove(v);
    p.position.set(x0 + 0.5, y + 1, z0 + 0.5);
    return { x0, y, z0 };
  }`;
  const field = (p) => p.evaluate((src) => new Function("g", `return (${src})(g);`)(window.__ufo), FIELD);

  const page = await newPage("solo");
  const soloOnly = args.only && String(args.only).includes("online");
  if (!soloOnly) await browserCheck("boot: a Missions world with the ground war wired in", async () => {
    await page.goto(`http://127.0.0.1:${PORT}/index.html?seed=8131&type=missions&graphics=low`, { waitUntil: "load", timeout: 60000 });
    await page.waitForFunction(() => !!window.__ufo && window.__ufo.graphicsReady, null, { timeout: 120000 });
    await play(page);
    const r = await v(page, (g) => ({ ground: !!g.vehicles.ground, shells: !!g.vehicles.shells, bal: !!g.vehicles.ballistics, tank: !!g.vehicles.constructor.types.tank, enemy: !!g.vehicles.constructor.types.enemytank, aa: !!g.vehicles.constructor.types.aa, tel: !!g.vehicles.constructor.types.tel }));
    assert(Object.values(r).every(Boolean), `wired: ${JSON.stringify(r)}`);
  });

  await browserCheck("a tank: drives, climbs a step, fires; its shell bursts (the dust first, then the fireball)", async () => {
    const f = await field(page);
    const r = await v(page, async (g, f) => {
      g.player.setMode("creative");
      g.world.setBlocks((() => { const l = []; for (let x = f.x0 - 5; x <= f.x0 + 5; x++) for (let z = f.z0 - 30; z <= f.z0 - 26; z++) l.push(x, f.y + 1, z, 3); return l; })());
      const { summonTank } = await import("./js/vehicle-tank.js");
      const t = summonTank(g.vehicles, "mbt", new g.THREE.Vector3(f.x0 + 0.5, f.y + 1, f.z0 - 8), 0);
      t.pos.y = f.y + 1;
      g.vehicles.enter(t);
      g.player.keys.add("KeyW");
      let top = 0;
      const z0 = t.pos.z;
      for (let i = 0; i < 150; i++) { g.vehicles.update(1 / 30); top = Math.max(top, t.pos.y); }
      g.player.keys.delete("KeyW");
      for (let i = 0; i < 60; i++) g.vehicles.update(1 / 30);
      const moved = z0 - t.pos.z;
      t.reloadT = 0;
      t.gunPitch = -0.05;
      const shell = t.fireGun({});
      const tf = g.effects.lastTankFire;
      const dustFirst = tf && tf.flashAt === null;
      g.effects.update(0.05);
      const flash = g.effects.lastTankFire.flashAt !== null;
      let hit = null;
      for (let i = 0; i < 120 && !hit; i++) { g.vehicles.update(1 / 30); g.effects.update(1 / 30); hit = g.vehicles.shells.hits.find((h) => performance.now() - h.t < 5000); }
      const fx = g.effects.lastShellFx;
      const before = fx && fx.fireAt === null;
      for (let i = 0; i < 6; i++) g.effects.update(1 / 30);
      return { moved, top, y: f.y, fired: !!shell, dustFirst, flash, hit: hit?.what, fxBefore: before, fxAfter: g.effects.lastShellFx?.fireAt > g.effects.lastShellFx?.dustAt, src: g.effects.lastExplosion?.source };
    }, f);
    assert(r.moved > 20 && r.top >= r.y + 1.9, `drove ${r.moved.toFixed(1)}, climbed to ${r.top} (ground ${r.y + 1})`);
    assert(r.fired && r.dustFirst && r.flash, `fired: ${JSON.stringify(r)}`);
    assert(r.hit && r.fxBefore && r.fxAfter && r.src === "tankshell", `the burst: ${JSON.stringify(r)}`);
    await v(page, (g) => g.vehicles.exit({ force: true }));
  });

  await browserCheck("an enemy tank engages a player on foot; the player's tank destroys it (the kill counted)", async () => {
    const f = await field(page);
    const r = await v(page, async (g, f) => {
      g.player.setMode("survival");
      g.player.flying = false;
      const hurt = [];
      const dmg = g.player.damage;
      g.player.damage = (a, c) => (hurt.push([a, c]), false);
      const e = g.vehicles.ground.spawnTank([f.x0 + 0.5, f.y + 1, f.z0 - 70], Math.PI, { kind: "tiger", force: true });
      e.pos.y = f.y + 1;
      const f0 = g.vehicles.shells.fired;
      for (let i = 0; i < 30 * 18 && g.vehicles.shells.fired - f0 < 2; i++) { g.vehicles.update(1 / 30); g.effects.update(1 / 30); }
      const fired = g.vehicles.shells.fired - f0;
      for (let i = 0; i < 60; i++) { g.vehicles.update(1 / 30); g.effects.update(1 / 30); }
      const near = g.vehicles.shells.hits.filter((h) => h.at.distanceTo(g.player.position) < 12).length;
      g.player.damage = dmg;
      // Our tank: it takes the Tiger out.
      g.player.setMode("creative");
      const { summonTank } = await import("./js/vehicle-tank.js");
      const t = summonTank(g.vehicles, "mbt", new g.THREE.Vector3(f.x0 + 0.5, f.y + 1, f.z0 - 20), 0);
      t.pos.y = f.y + 1;
      g.vehicles.enter(t);
      const down0 = g.stats.world.tanksDown || 0;
      for (let i = 0; i < 30 * 45 && e.alive; i++) {
        t.updateCamera(g.camera, 1 / 30);
        const d = e.pos.clone().setY(e.pos.y + 1.5).sub(g.camera.position);
        t.lookYaw = Math.atan2(-d.x, -d.z);
        t.lookPitch = Math.atan2(d.y, Math.hypot(d.x, d.z)) + 0.12;
        if (t.reloadT <= 0 && t.aimError < 0.02) g.vehicles.input.pressed.add("mouse0");
        g.vehicles.update(1 / 30);
        g.effects.update(1 / 30);
      }
      g.vehicles.exit({ force: true });
      return { foe: !!e.ai.foe || fired > 0, fired, near, hurt: hurt.length, dead: !e.alive, down: (g.stats.world.tanksDown || 0) - down0 };
    }, f);
    assert(r.fired >= 1 && r.near >= 1, `the enemy fired at the player: ${JSON.stringify(r)}`);
    assert(r.dead && r.down === 1, `destroyed and counted: ${JSON.stringify(r)}`);
  });

  await browserCheck("an AA vehicle fires flak and a SAM at a jet; the jet's warning sees the SAM", async () => {
    const f = await field(page);
    const r = await v(page, async (g, f) => {
      g.player.setMode("survival");
      const aa = g.vehicles.ground.spawnAA([f.x0 + 0.5, f.y + 1, f.z0 - 40], 0, { force: true });
      aa.pos.y = f.y + 1;
      const jet = g.vehicles.create("jet", { pos: [f.x0 + 450, f.y + 80, f.z0 - 10], yaw: Math.PI / 2, airborne: true, speed: 90, throttle: 0.6 });
      g.vehicles.enter(jet);
      const fired0 = g.lasers.fired;
      let sam = 0;
      let warn = false;
      for (let i = 0; i < 30 * 14; i++) {
        g.vehicles.update(1 / 30);
        g.effects.update(1 / 30);
        g.lasers.update(1 / 30);
        sam = Math.max(sam, aa.missiles.length);
        if (jet.warn?.kind === "missile") warn = true;
      }
      g.vehicles.exit({ force: true });
      g.vehicles.remove(jet);
      g.vehicles.remove(aa);
      return { flak: g.lasers.fired - fired0, sam, warn };
    }, f);
    assert(r.flak >= 9 && r.sam >= 1 && r.warn, `the AA: ${JSON.stringify(r)}`);
  });

  await browserCheck("a launcher raises its missile and launches it (slow at first); the warhead lands on the target", async () => {
    const f = await field(page);
    const r = await v(page, async (g, f) => {
      g.player.setMode("creative");
      const { summonTel } = await import("./js/ballistic.js");
      const t = summonTel(g.vehicles, new g.THREE.Vector3(f.x0 + 0.5, f.y + 1, f.z0 - 30), 0);
      t.pos.y = f.y + 1;
      const target = new g.THREE.Vector3(f.x0 + 700, f.y, f.z0 - 300);
      t.startLaunch(target);
      const states = new Set();
      let erectAt = null;
      let i = 0;
      for (; i < 30 * 30 && !t.lastMissile; i++) {
        g.vehicles.update(1 / 30);
        g.effects.update(1 / 30);
        states.add(t.state);
        if (erectAt === null && t.erect >= 0.999) erectAt = i / 30;
      }
      const m = t.lastMissile;
      const launchAt = i / 30;
      for (let k = 0; k < 30 * 2; k++) g.vehicles.update(1 / 30);
      const after2 = m ? m.dist : 0;
      const n0 = g.vehicles.ballistics.impacts.length;
      for (let k = 0; k < 30 * 40 && g.vehicles.ballistics.impacts.length === n0; k++) { g.vehicles.update(1 / 30); g.effects.update(1 / 30); }
      const imp = g.vehicles.ballistics.impacts[g.vehicles.ballistics.impacts.length - 1];
      return { states: [...states], erectAt, launchAt, after2, impact: imp ? imp.at.distanceTo(target) : null, src: g.effects.lastExplosion?.source };
    }, f);
    assert(["jacks", "raise", "ready", "ignite", "lower"].every((s) => r.states.includes(s)), `the sequence: ${r.states}`);
    assert(r.erectAt > 8 && r.launchAt > 14, `slow and deliberate: upright at ${r.erectAt}, away at ${r.launchAt}`);
    assert(r.after2 > 1 && r.after2 < 15, `slow off the arm: ${r.after2.toFixed(1)} blocks in 2 s`);
    assert(r.impact !== null && r.impact < 2 && r.src === "ballistic", `the warhead: ${JSON.stringify(r)}`);
  });

  await browserCheck("Creative: a tank and a launcher put down from the palette's summons", async () => {
    await field(page);
    const r = await v(page, (g) => {
      g.player.setMode("creative");
      const p = g.player.position;
      const t = g.vehicles.summonOnGround?.("tiger", { x: p.x, y: p.y, z: p.z - 16 });
      const l = g.vehicles.summonOnGround?.("tel", { x: p.x + 12, y: p.y, z: p.z - 24 });
      return { tank: t?.type === "tank" && t.kind === "tiger", tel: l?.type === "tel" && !l.unusable };
    });
    assert(r.tank && r.tel, `summoned: ${JSON.stringify(r)}`);
  });

  await browserCheck("review fixes: a boarded base tank isn't set out again (and keeps its spot over a save); an enemy launcher's warhead isn't a player's; a convoy launcher drives its road; AA with SAMs up never idles; a tank lost with the player inside hides its overlay", async () => {
    const f = await field(page);
    const r = await v(page, async (g, f) => {
      g.player.setMode("creative");
      const war = g.vehicles.ground;
      const out = {};
      // The base's yard: one spot by the player (a stub site).
      const spot = { key: "test#y0", x: f.x0 + 0.5, y: f.y + 1, z: f.z0 - 12, yaw: 0, kind: "mbt", paint: "olive" };
      const sites = war.sites;
      war.sites = { yardSpots: () => [spot], within: () => [{ id: "test" }] };
      war._yardUpkeep();
      const parked = war.yard.get(spot.key);
      g.vehicles.enter(parked);
      g.vehicles.exit({ force: true });
      for (let i = 0; i < 3; i++) war._yardUpkeep();
      out.yard = { parked: !!parked, again: g.vehicles.vehicles.filter((o) => o.alive && o.isGround && Math.hypot(o.pos.x - spot.x, o.pos.z - spot.z) < 6).length, took: parked?.tookKey, npc: !!parked?.npc, saved: parked?.serialize().tookKey };
      war.sites = sites;
      g.vehicles.remove(parked);
      war.yard.clear();
      // An enemy launcher's warhead.
      war.ballistics.impact({ T: new g.THREE.Vector3(f.x0 + 200, f.y, f.z0 - 200), owner: { enemy: true } });
      out.src = g.effects.lastExplosion?.source;
      // A convoy's launcher on its road.
      const tel = war._spawn("enemytel", [f.x0 + 0.5, f.y + 1, f.z0 - 20], 0, { route: [[f.x0 + 0.5, 0, f.z0 - 90]], force: true });
      tel.pos.y = f.y + 1;
      const z0 = tel.pos.z;
      for (let i = 0; i < 30 * 6; i++) g.vehicles.update(1 / 30);
      out.telMoved = z0 - tel.pos.z;
      g.vehicles.remove(tel);
      // The idle rule: far off, an AA vehicle with a SAM in the air keeps going.
      const aa = war.spawnAA([f.x0 + 1400, f.y + 1, f.z0], 0, { force: true });
      aa.missiles.push({ fake: true });
      war._farT = 0;
      war.update(0);
      out.aaIdle = aa.idle;
      aa.missiles.length = 0;
      g.vehicles.remove(aa);
      // A tank destroyed with the player inside.
      const { summonTank } = await import("./js/vehicle-tank.js");
      const t = summonTank(g.vehicles, "mbt", new g.THREE.Vector3(f.x0 + 0.5, f.y + 1, f.z0 - 8), 0);
      g.vehicles.enter(t);
      t._hudSeen = performance.now();
      t._drawOverlay(g.camera);
      const shown = document.getElementById("tank-overlay")?.style.display;
      g.vehicles.destroy(t, "test");
      out.overlay = [shown, document.getElementById("tank-overlay")?.style.display, t.model.barrel ? t.model.barrel.visible : true];
      g.vehicles.remove(t);
      return out;
    }, f);
    assert(r.yard.parked && r.yard.again === 1 && r.yard.took === "test#y0" && !r.yard.npc && r.yard.saved === "test#y0", `the yard: ${JSON.stringify(r.yard)}`);
    assert(r.src === "enemyballistic", `an enemy warhead: ${r.src}`);
    assert(r.telMoved > 10, `the convoy launcher moved ${r.telMoved}`);
    assert(r.aaIdle === false, "an AA vehicle with a SAM up doesn't idle");
    assert(r.overlay[0] === "block" && r.overlay[1] === "none" && r.overlay[2], `the overlay: ${JSON.stringify(r.overlay)}`);
  });

  await browserCheck("the new missions start, set out their units and complete", async () => {
    await field(page);
    const r = await v(page, async (g) => {
      g.player.setMode("survival");
      const out = {};
      const P = g.progress;
      const D = g.missions;
      for (const id of ["tank_battle", "stop_launch", "convoy", "air_defense", "base_assault"]) {
        P.setChain(["skeleton", id, "armada"]);
        P.step = 1;
        P.base = P._pick(g.stats.world);
        D.enabled = true;
        D.missionId = null;
        for (let i = 0; i < 90; i++) {
          D.checkT = 0;
          D.update(0.5);
          D.state.t = Math.max(D.state.t || 0, 60);
          if (id === "base_assault" && D.state.at) g.player.position.set(D.state.at.x + 20, g.player.position.y, D.state.at.z + 20);
          if (g.vehicles.ground.units.some((u) => u.mission)) break;
        }
        const o = { units: g.vehicles.ground.units.filter((u) => u.mission).length, target: !!D.target, mine: (D.state.mine || []).length };
        // The goal met: the mission is done.
        for (const ob of P.mission.objectives) g.stats.add(ob.stat, ob.goal * 3);
        P.update(g.stats.world);
        o.done = P.step === 2;
        D._cleanup();
        for (const u of g.vehicles.ground.units) g.vehicles.remove(u);
        out[id] = o;
      }
      return out;
    });
    for (const [id, o] of Object.entries(r)) assert(o.units >= 1 && o.target && o.done, `${id}: ${JSON.stringify(o)}`);
    assert(r.tank_battle.mine >= 1 && r.base_assault.mine >= 1, "a tank of ours for the tank battle and the base");
  });

  if (args.online) {
    const { default: express } = await import("express");
    const { ExpressPeerServer } = await import("peer");
    const PEER_PORT = PORT + 60;
    const app = express();
    const peerHttp = app.listen(PEER_PORT, "127.0.0.1");
    app.use("/ufo", ExpressPeerServer(peerHttp, { path: "/" }));
    const NET_Q = `peerServer=127.0.0.1:${PEER_PORT}/ufo&noStun=1&graphics=low`;
    await page.close(); // (two more games on a slow machine: the solo one goes)
    const host = await newPage("host", { width: 640, height: 360 });
    const guest = await newPage("guest", { width: 640, height: 360 });
    await browserCheck("online: a guest sees the host's enemy tank and its shots, and hurts it", async () => {
      await host.goto(`http://127.0.0.1:${PORT}/index.html?seed=8132&type=missions&${NET_Q}`, { waitUntil: "load", timeout: 60000 });
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
      const nid = await v(host, (g, f) => {
        const e = g.vehicles.ground.spawnTank([f.x0 + 0.5, f.y + 1, f.z0 - 60], Math.PI, { kind: "mbt", force: true });
        e.pos.y = f.y + 1;
        return true;
      }, f);
      const seen = await until(guest, (g) => g.vehicles.vehicles.find((v) => v.type === "enemytank" && v.puppet) ? true : null, 30000);
      assert(seen, "the guest never saw the host's tank");
      // Its shots reach the guest's screen.
      const shots = await until(guest, (g) => (g.vehicles.shells.fired > 0 ? g.vehicles.shells.fired : null), 60000);
      assert(shots, "no shot seen on the guest");
      // The guest hits it: the host's tank is hurt.
      const hp0 = await v(host, (g) => g.vehicles.ground.units[0]?.health);
      await v(guest, (g) => { const e = g.vehicles.vehicles.find((v) => v.type === "enemytank" && v.puppet); e.damage(60, "player", true); return true; });
      const hurt = await until(host, (g, hp0) => (g.vehicles.ground.units[0]?.health < hp0 ? true : null), 15000, hp0);
      assert(hurt, "the host's tank wasn't hurt by the guest's hit");
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
