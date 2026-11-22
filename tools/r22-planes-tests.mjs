// Round 22, track B: more aircraft (js/plane-specs.js, js/plane-models.js,
// js/plane-kit.js, js/plane-features.js; wired in js/vehicle-jet.js,
// js/vehicles.js, js/airports.js, js/hitboxes.js, js/content/vehicles.js,
// index.html, js/audio.js, js/fighter-hud.js, js/net/fx.js).
// Node: the numbers and the wiring (types, seats, items, call-in buttons,
// hit shapes, the old jets' numbers untouched); the airports park the new
// types (a mix in every big airport's row, AC-130s on stands).
// In the browser (a Survival world in Creative, a flat field built for it):
// - each type is called in (the pause menu) and placed from its Creative
//   item; the right model, hull, HUD, panel and seat count;
// - each takes off from the field, flies and lands back on it;
// - performance: the top speeds and turn rates in the intended order;
// - the features: the F-35B's hover holds its height, lands and lifts off
//   straight up; the F-14's wings sweep with the speed (and V); the
//   Su-57's thrust vectoring keeps its pitch rate slow and past the stall;
//   the props spin, the P-51 sits on its tail and lifts it on the roll;
//   the AC-130 orbits a point with its guns on it;
// - weapons per type: the lists, the GAU-8, rockets, bombs landing on the
//   pipper, the AC-130's shells, the P-51's no nuke, the Phoenix's range,
//   the stealth;
// - a save and a load keep the type and its stores; no console errors.
// Online (--solo skips): a guest sees the host's aircraft with the right
// model and its moving parts (the sweep, the hover nozzle, the props).
//
//   node r22-planes-tests.mjs [--only=substring] [--solo] [--verbose]
// (SHOTS=dir saves screenshots of each aircraft.)
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
const SHOTS = process.env.SHOTS || "";
if (SHOTS) fs.mkdirSync(SHOTS, { recursive: true });
const TYPES = ["a10", "f35", "su57", "f14", "p51", "ac130"];

const results = [];
function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}
async function check(name, fn) {
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
const imp = (p) => import(pathToFileURL(path.join(ROOT, p)).href);

// ---------- Node ----------

await check("the numbers and the wiring: six types, seats, items, call-in buttons, hit shapes; the old jets untouched", async () => {
  const S = await imp("js/plane-specs.js");
  assert(TYPES.every((t) => S.PLANE_TYPES[t]?.id === t && S.PLANE_GEAR[t] && S.PLANE_LASER[t] && S.PLANE_HULLS[t]), "every type's data");
  const P = S.PLANE_TYPES;
  // The intended character: the Su-57 the most agile, the A-10 the toughest
  // fighter-sized one, the AC-130 the biggest and slowest, the P-51 the
  // slowest stall.
  assert(P.su57.turn > P.f14.turn && P.su57.roll > P.f35.roll && P.su57.tvc, "the Su-57 the most agile");
  assert(P.a10.maxHealth > 400 && P.ac130.maxHealth > P.a10.maxHealth && P.p51.maxHealth < 130, "toughness");
  assert(P.ac130.speed < P.p51.speed && P.p51.speed < P.a10.speed && P.a10.speed < P.f35.speed, "speeds");
  assert(P.p51.stall < P.a10.stall && P.a10.stall < P.f35.stall, "stall speeds");
  assert(P.f35.hover && P.f35.stealth > 0 && P.f14.sweep && P.ac130.orbit, "the specials");
  assert(!P.p51.weapons.includes("mininuke") && !P.p51.weapons.includes("laser") && P.p51.missiles === false && P.p51.prop === "piston", "the P-51: guns, bombs, rockets");
  assert(["a10", "f35", "su57", "f14", "ac130"].every((t) => !P[t].weapons || (P[t].weapons.includes("mininuke") && P[t].weapons.includes("laser"))), "the mini-nuke and the laser for the others");
  const veh = fs.readFileSync(path.join(ROOT, "js/vehicles.js"), "utf8");
  for (const t of TYPES) assert(new RegExp(`\\b${t}: ${S.PLANE_SEATS[t]}\\b`).test(/JET_SEATS = \{[^}]*\}/.exec(veh)[0]), `seats ${t}`);
  assert(S.PLANE_SEATS.f14 === 2 && S.PLANE_SEATS.ac130 >= 8 && S.PLANE_SEATS.a10 === 1, "seat counts");
  const items = fs.readFileSync(path.join(ROOT, "js/content/vehicles.js"), "utf8");
  for (const t of TYPES) assert(new RegExp(`vehicle: "${t}"`).test(items) && items.includes(`icons.vehicle_${t}`), `item ${t}`);
  const html = fs.readFileSync(path.join(ROOT, "index.html"), "utf8");
  for (const t of TYPES) assert(html.includes(`data-callin="${t}"`), `call-in ${t}`);
  const H = await imp("js/hitboxes.js");
  for (const t of TYPES) {
    const h = H.hullShape(t);
    assert(h && h.parts.length >= 8 && h.r > 3, `hull ${t}`);
  }
  // A shot down onto the A-10's wingtip hits, one beside it misses.
  const q = { x: 0, y: 0, z: 0, w: 1 };
  const o = { x: 0, y: 0, z: 0 };
  assert(H.hullRay(H.hullShape("a10"), o, q, { x: 6.8, y: 10, z: 0 }, { x: 0, y: -1, z: 0 }, 20) > 0 && H.hullRay(H.hullShape("a10"), o, q, { x: 7.4, y: 10, z: 0 }, { x: 0, y: -1, z: 0 }, 20) < 0, "the A-10's wing");
  const jet = fs.readFileSync(path.join(ROOT, "js/vehicle-jet.js"), "utf8");
  assert(/ammo: \{ f22: (\d+), f16: (\d+), b2: (\d+), sr71: (\d+) \}/.test(jet), "the old mini-nuke loads untouched");
  const enemy = fs.readFileSync(path.join(ROOT, "js/enemy-jets.js"), "utf8");
  assert(!/rockets|bombs|gun105|gun40|_fireMini/.test(enemy), "the enemy fighters never use the new weapons");
});

// The airports (the real AirportManager on stand-in ground, as tools/r21-airports-tests.mjs).
await check("the airports park the new types: a mix in the rows and hangars, AC-130s on stands, a Raptor or Falcon first", async () => {
  const { register } = await import("node:module");
  register(
    "data:text/javascript," +
      encodeURIComponent(`export async function resolve(s, c, n) { if (s === "three") return n(${JSON.stringify(pathToFileURL(path.join(__dirname, "node_modules/three/build/three.module.js")).href)}, c); return n(s, c); }`),
    import.meta.url
  );
  const { AirportManager } = await imp("js/airports.js");
  const { TerrainGenerator } = await imp("js/terrain.js");
  const seen = {};
  let sites = 0;
  let ac = 0;
  const bad = [];
  for (const seed of [42, 12345, 777, 842645]) {
    const S = new TerrainGenerator(seed, { sites: true, vanilla: true, bigAirports: true }).sites;
    for (const s of S.within(0, 0, 9000)) {
      const world = { getChunk: () => ({}), getBlock: (x, y) => (y <= s.y ? 1 : 0) };
      const made = [];
      const vehicles = { vehicles: made, create: (type, d) => {
        const j = { type, jetType: d.jetType, pos: { x: d.pos[0], y: d.pos[1], z: d.pos[2] }, yaw: d.yaw, alive: true };
        made.push(j);
        return j;
      }, remove: () => {} };
      const am = new AirportManager({ sites: S, vehicles, world, player: { position: { x: s.x, y: s.y, z: s.z } }, mobs: null });
      const jets = [];
      am._fill(s, jets);
      sites++;
      for (const j of jets) seen[j.jetType] = (seen[j.jetType] || 0) + 1;
      if (jets.some((j) => j.jetType === "ac130")) ac++;
      if (!jets.some((j) => j.jetType === "f16" || j.jetType === "f22")) bad.push(`${s.id}: no Raptor or Falcon`);
      // (The AC-130's stand clear of the runway: its 26-block length beside the taxiway.)
      for (const j of jets.filter((x) => x.jetType === "ac130")) {
        const [, v] = S.toLocal(s, j.pos.x, j.pos.z);
        if (Math.abs(v) - 13 <= s.rw + 2) bad.push(`${s.id}: the AC-130 on the runway`);
      }
      // (Hangars hold only the small ones.)
      for (const j of jets.filter((x) => /#g\d+$/.test(x.parkKey || ""))) if (!["f22", "f16", "f35", "p51"].includes(j.jetType)) bad.push(`${s.id}: a ${j.jetType} in a hangar`);
    }
  }
  console.log(`    ${sites} airports: ${Object.entries(seen).map(([k, n]) => `${k} ${n}`).join(", ")}; ${ac} with an AC-130`);
  assert(!bad.length, bad.slice(0, 5).join("; "));
  for (const t of ["a10", "f35", "su57", "f14", "p51"]) assert(seen[t] > 0, `some ${t} parked`);
  assert(ac > 0, "some AC-130s");
});

// ---------- Browser ----------

const { chromium } = await import("playwright-core");
const PORT = 12470 + Math.floor(Math.random() * 10);
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
  p.on("console", (m) => {
    if (m.type() === "error") errors.push(`[${label}] ${m.text()}`);
    if (args.verbose) console.log(`    [${label}] ${m.text()}`);
  });
  p.on("pageerror", (e) => errors.push(`[${label}] ${String(e)}`));
  p.on("dialog", (d) => d.accept());
  return p;
}
const framesOn = (p, n = 2) =>
  p.evaluate(
    (k) =>
      new Promise((r) => {
        let i = 0;
        const f = () => (++i >= k ? r() : requestAnimationFrame(f));
        requestAnimationFrame(f);
      }),
    n
  );
const vOn = (p, fn, arg) => p.evaluate(([src, a]) => new Function("g", "arg", `return (${src})(g, arg);`)(window.__ufo, a), [fn.toString(), arg]);
async function untilOn(p, fn, arg, ms = 30000) {
  const t0 = Date.now();
  let r;
  while (Date.now() - t0 < ms) {
    r = await vOn(p, fn, arg).catch(() => null);
    if (r) return r;
    await new Promise((res) => setTimeout(res, 120));
  }
  return r;
}
async function playOn(p) {
  const t0 = Date.now();
  while (Date.now() - t0 < 300000) {
    const st = await vOn(p, (g) => g.gameState);
    if (st === "playing") return;
    if (st === "dead") {
      await vOn(p, (g) => g.respawn());
      continue;
    }
    for (const id of ["mp-lobby", "mp-screen"]) await p.evaluate((i) => document.getElementById(i)?.classList.add("hidden"), id);
    const click = (sel) => p.evaluate((s) => document.querySelector(s)?.click(), sel).catch(() => {});
    if (st === "start") await click("#play-btn");
    else if (await p.isVisible("#resume-btn").catch(() => false)) await click("#resume-btn");
    else {
      await p.mouse.click(300, 200);
      await framesOn(p, 5);
      if ((await vOn(p, (g) => g.gameState)) === "paused" && !(await p.isVisible("#resume-btn"))) await p.evaluate(() => document.getElementById("pause-menu").classList.remove("hidden"));
    }
    await framesOn(p, 3);
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

const page = await newPage("solo");
const frames = (n) => framesOn(page, n);
const v = (fn, arg) => vOn(page, fn, arg);
const play = () => playOn(page);
const shot = async (name) => {
  if (SHOTS) await page.screenshot({ path: path.join(SHOTS, `${name}.png`) });
};

// In-page helpers (window.__r22): stepping the world by hand, a clear sky,
// a flat field (as tools/r16-sr71-tests.mjs), messages.
const HELPERS = `(() => {
  const g = window.__ufo;
  const T = g.THREE;
  const H = {};
  H.step = (dt = 1 / 30) => {
    g.vehicles.update(dt);
    g.ufos.update(dt);
    g.lasers.update(dt);
  };
  H.press = (code, dt = 1 / 30) => {
    g.vehicles.keyDown(code);
    H.step(dt);
  };
  H.click = (b = 2, dt = 1 / 30) => {
    g.vehicles.mouseDown(b);
    H.step(dt);
    g.vehicles.mouseUp(b);
    H.step(dt);
  };
  H.msgs = [];
  if (!H._hooked) {
    const say = g.vehicles.onMessage;
    g.vehicles.onMessage = (t) => {
      H.msgs.push(t);
      say?.(t);
    };
    H._hooked = true;
  }
  H.clear = () => {
    g.testFlags.noMissions = true;
    if (g.player.dead) g.respawn();
    if (g.vehicles.active) g.vehicles.exit({ force: true });
    g.player.setMode("creative");
    g.ufos.clear();
    g.mobs.clear();
    g.settingsPanel?.set?.("ufos.activity", 0);
    g.ufos.prankRate = 0;
    g.enemyJets.config.count = 0;
    for (const j of [...g.vehicles.vehicles]) g.vehicles.remove(j);
    g.player.keys.clear();
    g.vehicles.input.buttons.fill(false);
    g.vehicles.input.pressed.clear();
  };
  // A jet in the air at height y (or agl above the ground), heading north, the player in it.
  H.sky = (type, o = {}) => {
    H.clear();
    const p = g.player.position;
    const ground = g.world.heightAt(Math.floor(p.x), Math.floor(p.z));
    const j = g.vehicles.create("jet", { jetType: type, pos: [p.x, o.agl ? ground + o.agl : o.y ?? 260, p.z], yaw: o.yaw ?? 0, airborne: true, speed: o.speed ?? 120, throttle: o.throttle ?? 0.7 });
    g.vehicles.enter(j);
    window.__j = j;
    H.msgs.length = 0;
    return j;
  };
  // A UFO hovering still at p.
  H.hover = (p, size = "medium") => {
    const u = g.ufos.spawn({ size, pos: p.clone(), design: "saucer" });
    u.state = "trick";
    u.trick = "hover";
    u.timer = 1e9;
    u.vel.set(0, 0, 0);
    u.blinkT = 1e9;
    u.whimT = 1e9;
    u.temper = 0;
    u.hostile = false;
    u.health = u.maxHealth = 5000;
    return u;
  };
  H.heading = (j) => {
    const f = j.forward(new T.Vector3());
    return Math.atan2(-f.x, -f.z);
  };
  // (The flight path's heading: where it goes, not where the nose points.)
  H.track = (j) => Math.atan2(-j.vel.x, -j.vel.z);
  window.__r22 = H;
  return true;
})()`;

// A flat field 61 wide and 720 long at y = 70 (north of the player), clear above.
// (Built again each time, at the same place: far chunks may have been unloaded meanwhile.)
const FIELD = `async (g) => {
  const p = g.player;
  const x0 = window.__field?.x0 ?? Math.floor(p.position.x), z0 = window.__field?.z0 ?? Math.floor(p.position.z);
  const y = 70;
  for (let z = z0 - 700; z <= z0 + 20; z += 16) g.world.prepareArea(x0, z, 2);
  const list = [];
  for (let x = x0 - 30; x <= x0 + 30; x++) for (let z = z0 - 700; z <= z0 + 20; z++) for (let k = -2; k < 26; k++) list.push(x, y + k, z, k < 0 ? 1 : 0);
  g.world.setBlocks(list);
  window.__field = { x0, y, z0 };
  return window.__field;
}`;

await browserCheck("boot: a Survival world in Creative", async () => {
  await page.goto(`http://127.0.0.1:${PORT}/index.html?seed=7171&type=survival&graphics=low`, { waitUntil: "load", timeout: 60000 });
  await page.waitForFunction(() => !!window.__ufo && window.__ufo.graphicsReady, null, { timeout: 120000 });
  await play();
  await v((g) => g.player.setMode("creative"));
  await page.evaluate(HELPERS);
});

await browserCheck("each type: called in from the pause menu (in the air, at the controls), the right model, hull, HUD, panel, seats; screenshots", async () => {
  for (const t of TYPES) {
    const r = await v(async (g, t) => {
      const H = window.__r22;
      H.clear();
      const ok = g.mp.game.callIn(t);
      const j = g.vehicles.active;
      for (let i = 0; i < 30; i++) g.vehicles.update(1 / 30);
      const { seatCount } = await import("./js/vehicles.js");
      const hud = j.hud();
      const info = j.infoPanel();
      let meshes = 0;
      j.root.traverse((o) => o.isMesh && meshes++);
      return { ok, type: j?.jetType, model: j.model.type, air: !j.onGround, alive: j.alive, meshes, title: hud.title, help: hud.help, weapon: hud.weapon, info: info.title, hull: !!j.hull, seats: seatCount(j), weapons: j.weapons, button: !!document.querySelector(`#pause-callins [data-callin="${t}"]`) };
    }, t);
    assert(r.ok && r.type === t && r.model === t && r.air && r.alive && r.hull && r.button && r.meshes > 10, `${t}: ${JSON.stringify(r)}`);
    assert(r.seats === { a10: 1, f35: 1, su57: 1, f14: 2, p51: 1, ac130: 10 }[t], `${t} seats ${r.seats}`);
    assert(/your /.test(r.info) && r.title.length > 3, `${t} panels: ${JSON.stringify(r)}`);
    await frames(20);
    await shot(`r22-${t}-callin`);
  }
});

await browserCheck("each type placed from its Creative item on the ground: parked on its gear", async () => {
  await v((g) => window.__r22.clear());
  await page.evaluate((src) => new Function("g", `return (${src})(g);`)(window.__ufo), FIELD);
  const r = await v(async (g) => {
    const H = window.__r22;
    const V = await import("./js/content/vehicles.js");
    const out = {};
    const ids = { a10: V.A10_ITEM, f35: V.F35_ITEM, su57: V.SU57_ITEM, f14: V.F14_ITEM, p51: V.P51_ITEM, ac130: V.AC130_ITEM };
    for (const [t, id] of Object.entries(ids)) {
      H.clear();
      for (const x of [...g.vehicles.vehicles]) g.vehicles.remove(x);
      // (Standing on the field, looking down at it a little ahead.)
      const f = window.__field;
      g.player.flying = false;
      g.player.position.set(f.x0 + 0.5, f.y, f.z0 - 40);
      g.player.velocity?.set?.(0, 0, 0);
      g.player.yaw = 0;
      const before = g.vehicles.vehicles.length;
      g.vehicles._summonT = -9;
      const used = V.itemUse[id]({ forward: [0, -0.7, -0.7], sneaking: false });
      for (let i = 0; i < 30; i++) g.vehicles.update(1 / 30);
      const j = g.vehicles.vehicles.find((x) => x.type === "jet" && x.jetType === t);
      const ground = j ? g.vehicles.groundBelow(j.pos.x, j.pos.y, j.pos.z) : null;
      out[t] = { used, made: g.vehicles.vehicles.length > before, type: j?.jetType, onGround: j?.onGround, h: j ? +(j.pos.y - j.gearH - ground).toFixed(2) : null, name: V.items[id].name, msg: H.msgs.slice(-1)[0] };
    }
    return out;
  });
  for (const t of TYPES) assert(r[t].used && r[t].type === t && r[t].onGround && Math.abs(r[t].h) < 1.5, `${t}: ${JSON.stringify(r[t])}`);
});

await browserCheck("each type takes off from the field, flies and lands back on it (the F-35B straight down in the hover)", async () => {
  await v((g) => window.__r22.clear());
  const f = await page.evaluate((src) => new Function("g", `return (${src})(g);`)(window.__ufo), FIELD);
  const r = await v((g, f) => {
    const H = window.__r22;
    const out = {};
    for (const t of ["a10", "f35", "su57", "f14", "p51", "ac130"]) {
      H.clear();
      const j = g.vehicles.create("jet", { jetType: t, pos: [f.x0 + 0.5, f.y + 3, f.z0 + 0.5], yaw: 0 });
      j.pos.y = f.y + j.gearH;
      g.vehicles.enter(j);
      g.player.keys.add("KeyW");
      let lift = null;
      for (let i = 0; i < 30 * 40 && lift === null && j.alive; i++) {
        j.aimPitch = 0.2;
        g.vehicles.update(1 / 30);
        if (!j.onGround && j.pos.y > f.y + j.gearH + 2) lift = Math.round(f.z0 + 0.5 - j.pos.z);
      }
      // Fly: climb out for 6 s.
      for (let i = 0; i < 30 * 6 && j.alive; i++) {
        j.aimPitch = 0.15;
        g.vehicles.update(1 / 30);
      }
      const flown = { alive: j.alive, up: Math.round(j.pos.y - f.y), speed: Math.round(j.speed) };
      g.player.keys.delete("KeyW");
      // Land: set up a gentle approach over the field (gear down, slow, sinking), and fly it down.
      const vs = j.cfg.stallSpeed * (j.stallMul ?? 1);
      j.pos.set(f.x0 + 0.5, f.y + j.gearH + 14, f.z0 - 120);
      j.q.setFromEuler(new g.THREE.Euler(0.06, 0, 0, "YXZ"));
      j.vel.set(0, -3.5, -vs * 1.25);
      j.angVel.set(0, 0, 0);
      j.throttle = 0.35;
      j._levelAim();
      let landed = null;
      if (t === "f35") {
        // (The F-35B: convert to the hover and come straight down.)
        j.vel.set(0, 0, -40);
        H.press("KeyV");
        for (let i = 0; i < 30 * 4; i++) H.step(1 / 30);
        g.player.keys.add("ShiftLeft");
        for (let i = 0; i < 30 * 12 && landed === null && j.alive; i++) {
          H.step(1 / 30);
          if (j.onGround) landed = { at: Math.round(f.z0 - j.pos.z) };
        }
        g.player.keys.delete("ShiftLeft");
      } else {
        // (A steady glide: the attitude and the approach speed held, as a
        // pilot does on final; the touchdown and the roll-out are the jet's.)
        for (let i = 0; i < 30 * 15 && landed === null && j.alive; i++) {
          j.q.setFromEuler(new g.THREE.Euler(0.06, 0, 0, "YXZ"));
          j._levelAim();
          j.angVel.set(0, 0, 0);
          j.vel.set(0, -3, -vs * 1.3);
          const fw = j.forward(new g.THREE.Vector3());
          if (j.pos.y < f.y + j.gearH + 3) j._dbg = { c: j._contacts(Math.atan2(-fw.x, -fw.z)), x: j.pos.x - f.x0, z: j.pos.z - f.z0, y: j.pos.y - f.y };
          g.vehicles.update(1 / 30);
          if (j.onGround) landed = { at: Math.round(f.z0 - j.pos.z) };
        }
        // (Roll out with the brakes.)
        g.player.keys.add("Space");
        for (let i = 0; i < 30 * 8 && j.alive; i++) g.vehicles.update(1 / 30);
        g.player.keys.delete("Space");
      }
      out[t] = { lift, flown, landed, alive: j.alive, onGround: j.onGround, hp: Math.round(j.health), why: j.crashWhy || null, dbg: j.alive ? undefined : j._dbg };
      g.vehicles.exit({ force: true });
      g.vehicles.remove(j);
    }
    return out;
  }, f);
  for (const t of TYPES) console.log(`    ${t}: lift-off after ${r[t].lift} blocks, ${JSON.stringify(r[t].flown)}, landed ${JSON.stringify(r[t].landed)}, ${r[t].hp} hp`);
  for (const t of TYPES) {
    const x = r[t];
    assert(x.lift > 0 && x.lift < 600 && x.flown.alive && x.flown.up > 20 && x.landed && x.alive && x.onGround, `${t}: ${JSON.stringify(x)}`);
  }
  // Short takeoffs: the P-51, the A-10 and the AC-130 lift off sooner than the Su-57 and the F-14.
  assert(r.p51.lift < r.f14.lift && r.a10.lift < r.f14.lift && r.ac130.lift < r.su57.lift * 1.3, JSON.stringify(Object.fromEntries(TYPES.map((t) => [t, r[t].lift]))));
});

await browserCheck("performance: top speeds and turn rates in the intended order", async () => {
  const r = await v((g) => {
    const H = window.__r22;
    const top = (t) => {
      const j = H.sky(t, { y: 300, speed: 150, throttle: 1 });
      g.player.keys.add("ShiftLeft");
      g.player.keys.add("KeyW");
      for (let i = 0; i < 30 * 45; i++) {
        j.aimPitch = 0;
        j.pos.y = 300;
        j.vel.y = 0;
        g.vehicles.update(1 / 30);
      }
      g.player.keys.clear();
      return Math.round(j.speed * 3.6);
    };
    const turn = (t) => {
      // A sustained turn at 70% throttle: the aim held 100 degrees to the left.
      const j = H.sky(t, { y: 300, speed: 60, throttle: 0.7 });
      for (let i = 0; i < 30 * 12; i++) {
        j.aimPitch = 0;
        g.vehicles.update(1 / 30);
      }
      const h0 = H.track(j);
      let turned = 0;
      let last = h0;
      const p0 = j.pos.clone();
      for (let i = 0; i < 30 * 6; i++) {
        j.aimYaw = H.heading(j) + 1.7;
        j.aimPitch = 0.05;
        g.vehicles.update(1 / 30);
        const h = H.track(j);
        let d = h - last;
        d = Math.atan2(Math.sin(d), Math.cos(d));
        turned += d;
        last = h;
      }
      const rate = (turned / 6) * (180 / Math.PI);
      const radius = j.speed / Math.max(1e-3, Math.abs(turned / 6));
      return { rate: Math.round(rate * 10) / 10, radius: Math.round(radius), speed: Math.round(j.speed), alive: j.alive };
    };
    const out = { top: {}, turn: {} };
    for (const t of ["f22", "a10", "f35", "su57", "f14", "p51", "ac130"]) {
      out.top[t] = top(t);
      out.turn[t] = turn(t);
    }
    H.clear();
    return out;
  });
  console.log(`    top speed (km/h): ${Object.entries(r.top).map(([k, x]) => `${k} ${x}`).join(", ")}`);
  console.log(`    turn (deg/s, radius): ${Object.entries(r.turn).map(([k, x]) => `${k} ${x.rate} / ${x.radius}`).join(", ")}`);
  const T = r.top;
  assert(T.su57 > T.f14 && T.f14 > T.f22 && T.f22 > T.f35 && T.f35 > T.a10 && T.a10 > T.p51 && T.p51 > T.ac130, `top speeds: ${JSON.stringify(T)}`);
  const R = r.turn;
  // (Of the jets the Su-57 turns fastest, the F-35 a little under the F-22;
  // the AC-130 slowest of all by far; slow, the P-51 and the A-10 out-turn
  // the jets, as they do.)
  const rates = Object.values(R).map((x) => x.rate);
  assert(R.su57.rate > Math.max(R.f22.rate, R.f35.rate, R.f14.rate) && R.ac130.rate === Math.min(...rates) && R.ac130.rate < R.f22.rate * 0.5 && R.f35.rate < R.f22.rate * 1.02, `turn rates: ${JSON.stringify(R)}`);
  assert(R.p51.radius < R.f22.radius && R.a10.radius < R.f22.radius && R.su57.radius < R.f22.radius, `turn radii: ${JSON.stringify(R)}`);
});

await browserCheck("the F-35B's hover: V converts (too fast: refused), holds its height still, climbs, lands and lifts off straight up; the nozzle and doors move", async () => {
  const r = await v((g) => {
    const H = window.__r22;
    const j = H.sky("f35", { agl: 60, speed: 200, throttle: 0.8 });
    H.press("KeyV");
    const refused = !j.hoverOn && H.msgs.some((m) => /Too fast/.test(m));
    j.vel.multiplyScalar(60 / j.vel.length());
    H.press("KeyV");
    for (let i = 0; i < 30 * 6; i++) H.step(1 / 30);
    const y0 = j.pos.y;
    const p0 = j.pos.clone();
    for (let i = 0; i < 30 * 8; i++) H.step(1 / 30);
    const hold = { dy: +(j.pos.y - y0).toFixed(2), drift: +Math.hypot(j.pos.x - p0.x, j.pos.z - p0.z).toFixed(2), speed: +j.speed.toFixed(2), nozzle: j.nozzle, rot: +j.model.groups.nozzle.rotation.x.toFixed(2), door: +j.model.groups.fanDoor.rotation.x.toFixed(2), gear: j.gearT };
    g.player.keys.add("Space");
    for (let i = 0; i < 30 * 3; i++) H.step(1 / 30);
    g.player.keys.delete("Space");
    const climbed = +(j.pos.y - y0).toFixed(1);
    // Down onto the ground.
    g.player.keys.add("ShiftLeft");
    let landed = false;
    for (let i = 0; i < 30 * 20 && !landed; i++) {
      H.step(1 / 30);
      landed = j.onGround;
    }
    g.player.keys.delete("ShiftLeft");
    for (let i = 0; i < 30; i++) H.step(1 / 30);
    const at = j.pos.clone();
    const down = { landed, alive: j.alive, hp: Math.round(j.health), max: j.maxHealth };
    // And straight up again.
    g.player.keys.add("Space");
    for (let i = 0; i < 30 * 3; i++) H.step(1 / 30);
    g.player.keys.delete("Space");
    const up = { air: !j.onGround, rose: +(j.pos.y - at.y).toFixed(1), drift: +Math.hypot(j.pos.x - at.x, j.pos.z - at.z).toFixed(1) };
    // Back to wing-borne flight: the speed builds, the lift fan holds it up.
    H.press("KeyV");
    g.player.keys.add("KeyW");
    let minY = j.pos.y;
    for (let i = 0; i < 30 * 8; i++) {
      j.aimPitch = 0.05;
      H.step(1 / 30);
      minY = Math.min(minY, j.pos.y);
    }
    g.player.keys.delete("KeyW");
    const wing = { hover: j.hoverOn, speed: Math.round(j.speed), sank: +(at.y + up.rose - minY).toFixed(1), alive: j.alive, nozzle: +j.nozzle.toFixed(2) };
    return { refused, hold, climbed, down, up, wing };
  });
  console.log(`    ${JSON.stringify(r)}`);
  assert(r.refused, "too fast: refused");
  assert(Math.abs(r.hold.dy) < 1.5 && r.hold.drift < 3 && r.hold.speed < 1.5 && r.hold.nozzle === 1 && r.hold.rot > 1.3 && r.hold.door > 1 && r.hold.gear > 0.9, `holds: ${JSON.stringify(r.hold)}`);
  assert(r.climbed > 15, `climbs: ${r.climbed}`);
  assert(r.down.landed && r.down.alive && r.down.hp === r.down.max, `lands softly: ${JSON.stringify(r.down)}`);
  assert(r.up.air && r.up.rose > 10 && r.up.drift < 3, `straight up: ${JSON.stringify(r.up)}`);
  assert(!r.wing.hover && r.wing.speed > 60 && r.wing.alive && r.wing.sank < 12, `wing-borne: ${JSON.stringify(r.wing)}`);
});

await browserCheck("the F-14's wings sweep with the speed (and V), overswept when parked; the Su-57's thrust vectoring past the stall", async () => {
  const r = await v((g) => {
    const H = window.__r22;
    const j = H.sky("f14", { y: 300, speed: 90, throttle: 0.5 });
    for (let i = 0; i < 30 * 4; i++) {
      j.aimPitch = 0;
      H.step(1 / 30);
    }
    const slow = { sweep: +j.sweep.toFixed(2), wing: +j.model.groups.wingR.rotation.y.toFixed(2), mach: +(j.speed / 272).toFixed(2) };
    g.player.keys.add("ShiftLeft");
    for (let i = 0; i < 30 * 30; i++) {
      j.aimPitch = 0;
      j.pos.y = 300;
      j.vel.y = 0;
      H.step(1 / 30);
    }
    g.player.keys.delete("ShiftLeft");
    const fast = { sweep: +j.sweep.toFixed(2), wing: +j.model.groups.wingR.rotation.y.toFixed(2), speed: Math.round(j.speed * 3.6) };
    H.press("KeyV");
    for (let i = 0; i < 30 * 4; i++) {
      j.pos.y = 300;
      j.vel.y = 0;
      H.step(1 / 30);
    }
    const forced = { mode: j.sweepMode, sweep: +j.sweep.toFixed(2), msg: H.msgs.slice(-1)[0], alive: j.alive };
    // Parked (nobody in it): overswept.
    g.vehicles.exit({ force: true });
    const p = g.player.position;
    const ground = g.world.heightAt(Math.floor(p.x), Math.floor(p.z));
    const parked = g.vehicles.create("jet", { jetType: "f14", pos: [p.x + 40, g.vehicles.groundBelow(p.x + 40, 400, p.z) + 1.415, p.z], yaw: 0 });
    for (let i = 0; i < 30 * 3; i++) H.step(1 / 30);
    const park = +parked.sweep.toFixed(2);
    // Su-57 vs F-22: the pitch rate slow (60% of the stall speed), nose up hard.
    const pitch = (t) => {
      const k = H.sky(t, { y: 300, speed: 30, throttle: 1 });
      const vs = k.cfg.stallSpeed;
      let best = 0;
      for (let i = 0; i < 30 * 1.5; i++) {
        k.vel.copy(k.forward(new g.THREE.Vector3())).multiplyScalar(vs * 0.6);
        k.aimPitch = Math.min(1.4, H.heading(k) * 0 + Math.asin(k.forward(new g.THREE.Vector3()).y) + 0.8);
        H.step(1 / 30);
        best = Math.max(best, k.angVel.x);
      }
      return { rate: +best.toFixed(2), stalled: k.stalled };
    };
    return { slow, fast, forced, park, su57: pitch("su57"), f22: pitch("f22") };
  });
  console.log(`    ${JSON.stringify(r)}`);
  assert(r.slow.sweep < 0.45 && Math.abs(r.slow.wing) < 0.1, `wings forward slow: ${JSON.stringify(r.slow)}`);
  assert(r.fast.sweep > 1.1 && r.fast.wing < -0.7, `swept fast: ${JSON.stringify(r.fast)}`);
  assert(r.forced.mode === "fwd" && r.forced.sweep < 0.6 && /FORWARD/.test(r.forced.msg), `V forces them forward: ${JSON.stringify(r.forced)}`);
  assert(r.park > 1.25, `overswept parked: ${r.park}`);
  assert(r.su57.rate > r.f22.rate * 2 && r.su57.rate > 0.8, `thrust vectoring: ${JSON.stringify(r)}`);
});

await browserCheck("props spin; the P-51 sits on its tail and lifts it on the takeoff roll; the AC-130's four props", async () => {
  await page.evaluate((src) => new Function("g", `return (${src})(g);`)(window.__ufo), FIELD);
  const r = await v((g) => {
    const H = window.__r22;
    const f = window.__field;
    H.clear();
    const j = g.vehicles.create("jet", { jetType: "p51", pos: [f.x0 + 0.5, f.y + 3, f.z0 + 0.5], yaw: 0 });
    j.pos.y = f.y + j.gearH;
    for (let i = 0; i < 30; i++) H.step(1 / 30);
    const parked = { sit: +j.model.sit.toFixed(2), angle: +j.model.props[0].angle.toFixed(2) };
    g.vehicles.enter(j);
    g.player.keys.add("KeyW");
    const a0 = j.model.props[0].angle;
    let tailUp = null;
    for (let i = 0; i < 30 * 12 && j.onGround; i++) {
      j.aimPitch = 0.2;
      H.step(1 / 30);
      if (tailUp === null && j.model.sit < 0.03 && j.onGround) tailUp = Math.round(j.speed);
    }
    g.player.keys.delete("KeyW");
    const spun = j.model.props[0].angle - a0;
    const disc = j.model.props[0].disc.material.opacity;
    const out = { parked, tailUp, spun: +spun.toFixed(1), disc: +disc.toFixed(2), air: !j.onGround, stall: Math.round(j.cfg.stallSpeed) };
    const c = H.sky("ac130", { y: 300, speed: 90, throttle: 0.8 });
    const b0 = c.model.props.map((p) => p.angle);
    for (let i = 0; i < 30 * 2; i++) H.step(1 / 30);
    out.ac130 = c.model.props.map((p, i) => +(p.angle - b0[i]).toFixed(1));
    return out;
  });
  console.log(`    ${JSON.stringify(r)}`);
  assert(r.parked.sit > 0.15, `sits on its tail: ${JSON.stringify(r.parked)}`);
  assert(r.tailUp !== null && r.tailUp < r.stall * 1.1 && r.air, `the tail comes up on the roll: ${JSON.stringify(r)}`);
  assert(r.spun > 20 && r.disc > 0.2, `the prop spins: ${JSON.stringify(r)}`);
  assert(r.ac130.length === 4 && r.ac130.every((a) => a > 20), `the AC-130's props: ${r.ac130}`);
});

await browserCheck("the AC-130's orbit: V circles the point in the crosshair, the gunner's view on it; its 105 mm lands there", async () => {
  const r = await v((g) => {
    const H = window.__r22;
    const j = H.sky("ac130", { agl: 280, speed: 80, throttle: 0.7 });
    // Aim at the ground 350 ahead, down.
    const p = j.pos.clone();
    const ground = g.world.heightAt(Math.floor(p.x), Math.floor(p.z - 350));
    const target = new g.THREE.Vector3(p.x, ground + 1, p.z - 350);
    const d = target.clone().sub(p).normalize();
    j.aimQ.setFromUnitVectors(new g.THREE.Vector3(0, 0, -1), d);
    H.press("KeyV");
    const o = j.orbit;
    const c = o ? o.c.clone() : null;
    const ds = [];
    const ys = [];
    for (let i = 0; i < 30 * 30; i++) {
      H.step(1 / 30);
      if (i > 30 * 8) {
        ds.push(Math.hypot(j.pos.x - c.x, j.pos.z - c.z));
        ys.push(j.pos.y);
      }
    }
    j.updateCamera(g.camera, 1 / 30);
    const look = g.camera.getWorldDirection(new g.THREE.Vector3());
    const toC = c.clone().sub(g.camera.position).normalize();
    const camOff = (look.angleTo(toC) * 180) / Math.PI;
    // The 105 mm at the centre.
    const booms = [];
    const ex = g.effects.explode.bind(g.effects);
    g.effects.explode = (at, opts) => {
      booms.push({ at: at.clone(), r: opts?.radius, src: opts?.source });
      return ex(at, opts);
    };
    j.selectWeapon("gun105");
    H.click(2);
    for (let i = 0; i < 30 * 3; i++) H.step(1 / 30);
    // The 25 mm (the left button).
    const fired0 = g.lasers.fired;
    g.vehicles.mouseDown(0);
    for (let i = 0; i < 30; i++) H.step(1 / 30);
    g.vehicles.mouseUp(0);
    const rounds = g.lasers.fired - fired0;
    g.effects.explode = ex;
    const shell = booms.find((b) => b.src === "tankshell" && b.r >= 7);
    const hud = j.overlay(g.camera).hud;
    const row = j.hud().rows.find((x) => x[0] === "Orbit (V)")?.[1];
    // Break off.
    H.press("KeyV");
    const off = !j.orbit;
    return { on: !!o, c: c && [Math.round(c.x - target.x), Math.round(c.y - target.y), Math.round(c.z - target.z)], R: o && Math.round(o.R), dMin: Math.round(Math.min(...ds)), dMax: Math.round(Math.max(...ds)), yMin: Math.round(Math.min(...ys) - Math.max(...ys)), camOff: +camOff.toFixed(1), shell: shell ? Math.round(shell.at.distanceTo(c)) : null, rounds, hudOrbit: !!hud.orbit, row, off, alive: j.alive };
  });
  console.log(`    ${JSON.stringify(r)}`);
  assert(r.on && r.c && Math.abs(r.c[0]) + Math.abs(r.c[2]) < 30, `the centre where it aimed: ${JSON.stringify(r)}`);
  assert(r.dMin > r.R * 0.7 && r.dMax < r.R * 1.35 && r.yMin > -25 && r.alive, `it circles: ${JSON.stringify(r)}`);
  assert(r.camOff < 40, `the gunner's view on it: ${r.camOff}`);
  assert(r.shell !== null && r.shell < 25, `the 105 mm lands on it: ${JSON.stringify(r)}`);
  assert(r.rounds > 10 && r.hudOrbit && /ORBITING/.test(r.row) && r.off, JSON.stringify(r));
  await shot("r22-ac130-orbit");
});

await browserCheck("weapons per type: the lists (X / digits), the GAU-8, rockets, bombs on the pipper, the P-51 without a nuke, the Phoenix's range", async () => {
  const r = await v((g) => {
    const H = window.__r22;
    const T = g.THREE;
    const out = {};
    // The lists.
    out.lists = {};
    for (const t of ["a10", "f35", "su57", "f14", "p51", "ac130"]) {
      const j = H.sky(t, { y: 300 });
      const seq = [j.weapon];
      for (let i = 0; i < j.weapons.length; i++) {
        H.press("KeyX");
        seq.push(j.weapon);
      }
      H.press("Digit2");
      out.lists[t] = { seq, two: j.weapon, list: j.weapons };
    }
    // The GAU-8 at a UFO ahead.
    let j = H.sky("a10", { y: 300, speed: 120 });
    const u = H.hover(j.pos.clone().add(new T.Vector3(0, 0, -260)));
    const hp0 = u.health;
    const f0 = g.lasers.fired;
    g.vehicles.mouseDown(0);
    for (let i = 0; i < 30; i++) {
      j.pos.set(j.pos.x, 300, j.pos.z);
      H.step(1 / 30);
    }
    g.vehicles.mouseUp(0);
    for (let i = 0; i < 20; i++) H.step(1 / 30);
    out.gau8 = { rounds: g.lasers.fired - f0, dmg: Math.round(hp0 - u.health), heat: +j.heat.toFixed(2) };
    g.ufos.clear();
    // Rockets: a pair a click.
    j.selectWeapon("rockets");
    const r0 = j.rocketsLeft;
    H.click(2);
    const inFlight = j.missiles.filter((m) => m.ballistic === "rocket").length;
    for (let i = 0; i < 30 * 6.5; i++) H.step(1 / 30);
    out.rockets = { fired: r0 - j.rocketsLeft, inFlight, left: j.rocketsLeft, gone: j.missiles.length };
    // Bombs: on the pipper (level at 120 above the ground).
    const p = j.pos;
    const ground = g.world.heightAt(Math.floor(p.x), Math.floor(p.z - 200));
    j.pos.y = ground + 120;
    j.q.identity();
    j.vel.set(0, 0, -110);
    j._levelAim();
    j.selectWeapon("bombs");
    const pip = j.overlay(g.camera).hud.ccip?.clone();
    j.bombHits = [];
    H.click(2);
    for (let i = 0; i < 30 * 10 && !j.bombHits.length; i++) {
      j.pos.y = ground + 120;
      j.vel.y = 0;
      H.step(1 / 30);
    }
    out.bomb = { pip: !!pip, hit: j.bombHits.length ? Math.round(j.bombHits[0].distanceTo(pip)) : null, left: j.bombsLeft, ccipShown: document.getElementById("fighter-hud")?.dataset.ccip ?? null };
    // The P-51: B says no nuke, no missiles.
    j = H.sky("p51", { y: 300 });
    H.press("KeyB");
    out.p51 = { msg: H.msgs.slice(-1)[0], list: j.weapons, armed: j.armed };
    // The Phoenix: a UFO 2,300 ahead locks from the F-14, not from the F-22.
    const lockAt = (t) => {
      const k = H.sky(t, { y: 400, speed: 150 });
      H.hover(k.pos.clone().add(new T.Vector3(0, 0, -2300)), "large");
      g.vehicles.mouseDown(2);
      for (let i = 0; i < 30 * 2; i++) {
        k.pos.y = 400;
        H.step(1 / 30);
      }
      const got = !!k.lock.target;
      g.vehicles.mouseUp(2);
      H.step(1 / 30);
      g.ufos.clear();
      return got;
    };
    out.lock = { f14: lockAt("f14"), f22: lockAt("f22") };
    H.clear();
    return out;
  });
  console.log(`    ${JSON.stringify(r)}`);
  const L = r.lists;
  assert(L.a10.seq.join() === "missile,rockets,bombs,mininuke,laser,missile" && L.a10.two === "rockets", `A-10: ${JSON.stringify(L.a10)}`);
  assert(L.p51.list.join() === "bombs,rockets" && L.p51.two === "rockets", `P-51: ${JSON.stringify(L.p51)}`);
  assert(L.ac130.list.join() === "gun40,gun105,missile,mininuke,laser", `AC-130: ${JSON.stringify(L.ac130)}`);
  assert(L.su57.list.join() === "missile,super,mininuke,laser" && L.f14.list.join() === "missile,super,mininuke,laser" && L.f35.list.includes("bombs"), JSON.stringify(L));
  assert(r.gau8.rounds > 35 && r.gau8.dmg > 150, `the GAU-8: ${JSON.stringify(r.gau8)}`);
  assert(r.rockets.fired === 2 && r.rockets.inFlight === 2 && r.rockets.gone === 0, `rockets: ${JSON.stringify(r.rockets)}`);
  assert(r.bomb.pip && r.bomb.hit !== null && r.bomb.hit < 10 && r.bomb.left === 5, `the bomb lands on the pipper: ${JSON.stringify(r.bomb)}`);
  assert(/No nuke on the P-51/.test(r.p51.msg) && !r.p51.armed, `P-51: ${JSON.stringify(r.p51)}`);
  assert(r.lock.f14 && !r.lock.f22, `the Phoenix's range: ${JSON.stringify(r.lock)}`);
});

await browserCheck("stealth: the UFOs' aim at the F-35 is much worse than at the F-22", async () => {
  const r = await v((g) => {
    const H = window.__r22;
    const T = g.THREE;
    const spread = (t) => {
      const j = H.sky(t, { y: 300, speed: 100 });
      const u = H.hover(j.pos.clone().add(new T.Vector3(300, 40, 0)));
      u.style = "volley"; // (the same plain style for both: a fan or a burst spreads its shots on purpose)
      const dirs = [];
      const fire = g.lasers.fire.bind(g.lasers);
      g.lasers.fire = (o) => {
        if (o.owner !== "jet") dirs.push(o.dir.clone().normalize());
        return fire(o);
      };
      for (let i = 0; i < 30; i++) g.ufos._fireAt(u, j.pos.clone(), new T.Vector3(), 1, j);
      g.lasers.fire = fire;
      // (The spread round their own mean: the lead's guess aside.)
      const to = dirs.reduce((m, d) => m.add(d), new T.Vector3()).normalize();
      const offs = dirs.map((d) => d.angleTo(to));
      g.ufos.clear();
      return offs.reduce((a, b) => a + b, 0) / Math.max(1, offs.length);
    };
    return { f22: spread("f22"), f35: spread("f35"), stealth: window.__j.stealth };
  });
  console.log(`    mean aim error (rad): F-22 ${r.f22.toFixed(4)}, F-35 ${r.f35.toFixed(4)}`);
  assert(r.f35 > r.f22 * 2, JSON.stringify(r));
});

await browserCheck("a save and a load keep each type, its stores and the F-14's wing mode", async () => {
  const r = await v((g) => {
    const H = window.__r22;
    H.clear();
    const p = g.player.position;
    const ground = g.world.heightAt(Math.floor(p.x), Math.floor(p.z));
    let i = 0;
    for (const t of ["a10", "f35", "su57", "f14", "p51", "ac130"]) {
      const j = g.vehicles.create("jet", { jetType: t, pos: [p.x + 60 * i++, ground + 60, p.z + 80], yaw: 0, airborne: true, speed: 100 });
      if (t === "a10") j.bombsLeft = 3;
      if (t === "f14") j.sweepMode = "back";
      if (t === "p51") j.rocketsLeft = 1;
    }
    const data = JSON.parse(JSON.stringify(g.vehicles.serialize()));
    H.clear();
    g.vehicles.load(data);
    const back = g.vehicles.vehicles.filter((x) => x.type === "jet").map((j) => ({ t: j.jetType, model: j.model.type, b: j.bombsLeft, r: j.rocketsLeft, sw: j.sweepMode }));
    H.clear();
    return back;
  });
  const by = Object.fromEntries(r.map((x) => [x.t, x]));
  for (const t of TYPES) assert(by[t]?.model === t, `${t}: ${JSON.stringify(r)}`);
  assert(by.a10.b === 3 && by.p51.r === 1 && by.f14.sw === "back" && by.ac130.b === 0, JSON.stringify(r));
});

await v((g) => window.__r22.clear());

// ---------- Online ----------
if (!args.solo) {
  const { default: express } = await import("express");
  const { ExpressPeerServer } = await import("peer");
  const PEER_PORT = PORT + 20;
  const app = express();
  const peerHttp = app.listen(PEER_PORT, "127.0.0.1");
  app.use("/ufo", ExpressPeerServer(peerHttp, { path: "/" }));
  const NET_Q = `peerServer=127.0.0.1:${PEER_PORT}/ufo&noStun=1&graphics=low`;
  await page.close();
  const noDraw = () => {
    const rr = window.__ufo.renderer;
    if (rr && !rr.__noDraw) {
      rr.__noDraw = true;
      rr.render = (scene, camera) => {
        scene?.updateMatrixWorld?.();
        camera?.updateMatrixWorld?.();
      };
    }
    return true;
  };
  const host = await newPage("host", { width: 640, height: 360 });
  const guest = await newPage("guest", { width: 640, height: 360 });
  await browserCheck("online: the guest sees the host's aircraft with the right model and its moving parts (the F-14's sweep, the F-35B's nozzle, the props); a passenger in the F-14's back seat", async () => {
    await host.goto(`http://127.0.0.1:${PORT}/index.html?seed=7171&type=survival&${NET_Q}`, { waitUntil: "load", timeout: 60000 });
    await host.waitForFunction(() => !!window.__ufo && window.__ufo.graphicsReady, null, { timeout: 120000 });
    await host.click("#menu-mp-btn");
    await host.fill("#mp-nick", "Alice");
    await host.click("#mp-host-btn");
    const code = await untilOn(host, (g) => g.net.code, null, 30000);
    assert(code, "no room code");
    await host.click("#mp-lobby-play");
    await host.waitForFunction(() => window.__ufo.gameState === "playing", null, { timeout: 30000 });
    await vOn(host, noDraw);
    await vOn(host, (g) => {
      g.mp.rules.setMode("creative");
      g.testFlags.noMissions = true;
      g.settingsPanel?.set?.("ufos.activity", 0);
      g.ufos.clear();
      return true;
    });
    await guest.goto(`http://127.0.0.1:${PORT}/index.html?join=${code}&${NET_Q}`, { waitUntil: "load", timeout: 60000 });
    await guest.waitForSelector("#mp-join-boot:not(.hidden)", { timeout: 30000 });
    await guest.fill("#mp-boot-nick", "Bob");
    await guest.click("#mp-boot-join");
    await guest.waitForFunction(() => !!window.__ufo && window.__ufo.graphicsReady, null, { timeout: 120000 });
    assert(await untilOn(guest, (g) => g.mp.stateLoaded, null, 150000), "the host's state never arrived");
    await vOn(guest, noDraw);
    await playOn(guest).catch(() => {});
    await playOn(host).catch(() => {});
    const out = {};
    for (const [t, setup] of [["f14", "back"], ["f35", "hover"], ["p51", "prop"], ["ac130", "prop"]]) {
      const hj = await vOn(host, (g, a) => {
        const at = g.player.position.clone();
        if (g.vehicles.active) g.vehicles.exit({ force: true });
        for (const v of [...g.vehicles.vehicles]) if (!v.puppet) g.vehicles.remove(v);
        const jet = g.vehicles.create("jet", { jetType: a.t, pos: [at.x, g.world.heightAt(Math.floor(at.x), Math.floor(at.z)) + 200, at.z], yaw: 0, airborne: true, speed: a.t === "f35" ? 40 : 120, throttle: 0.8 });
        g.vehicles.enter(jet);
        window.__j = jet;
        if (a.setup === "back") jet.sweepMode = "back";
        if (a.setup === "hover") {
          g.vehicles.keyDown("KeyV");
        }
        return { nid: jet.net?.nid ?? null };
      }, { t, setup });
      assert(hj.nid, `the host's ${t} is shared`);
      const seen = await untilOn(guest, (g, a) => {
        const p = g.vehicles.vehicles.find((x) => x.puppet && x.net?.nid === a.nid);
        if (!p) return null;
        g.player.position.set(p.pos.x + 50, p.pos.y - 20, p.pos.z + 30);
        g.player.flying = true;
        window.__pa ||= {};
        const prop = p.model.props?.[0];
        if (prop && window.__pa[a.nid] === undefined) window.__pa[a.nid] = prop.angle;
        const spun = prop ? prop.angle - window.__pa[a.nid] : 0;
        const ok = a.setup === "back" ? p.sweep > 1.0 && p.model.groups.wingR.rotation.y < -0.5 : a.setup === "hover" ? p.nozzle > 0.9 && p.model.groups.nozzle.rotation.x > 1.2 : spun > 10;
        return ok ? { type: p.jetType, model: p.model.type, sweep: p.sweep, nozzle: p.nozzle, spun: Math.round(spun) } : null;
      }, { nid: hj.nid, setup }, 40000);
      out[t] = seen;
      assert(seen && seen.type === t && seen.model === t, `${t}: the guest's copy ${JSON.stringify(seen)}`);
    }
    console.log(`    ${JSON.stringify(out)}`);
    // The guest in the host's F-14's back seat.
    const hj = await vOn(host, (g) => {
      if (g.vehicles.active) g.vehicles.exit({ force: true });
      for (const v of [...g.vehicles.vehicles]) if (!v.puppet) g.vehicles.remove(v);
      const at = g.player.position.clone();
      const jet = g.vehicles.create("jet", { jetType: "f14", pos: [at.x + 6, g.world.heightAt(Math.floor(at.x + 6), Math.floor(at.z)) + 1.42, at.z], yaw: 0 });
      g.vehicles.enter(jet);
      return { nid: jet.net?.nid ?? null, pos: jet.pos.toArray() };
    });
    const seat = await untilOn(guest, (g, a) => {
      const p = g.vehicles.vehicles.find((x) => x.puppet && x.net?.nid === a.nid);
      if (!p) return null;
      if (g.vehicles.active !== p) {
        g.player.flying = false;
        g.player.position.set(p.pos.x + 2, p.pos.y, p.pos.z + 2);
        if (!window.__asked) {
          window.__asked = true;
          g.vehicles.enter(p);
        }
        return null;
      }
      return { seat: g.vehicles.seat, passenger: !!g.vehicles.passenger };
    }, hj, 40000);
    assert(seat && seat.seat === 1, `the back seat: ${JSON.stringify(seat)}`);
  });
}

await browser.close();
server.close();

const failed = results.filter(([, ok]) => !ok);
console.log(`\n${results.length - failed.length} passed, ${failed.length} failed.`);
process.exit(failed.length ? 1 : 0);
