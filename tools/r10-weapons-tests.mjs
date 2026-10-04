// Round 10 weapons tests: boots the real game in headless Chromium (software
// WebGL, Low preset) and checks the guns' real bullets and the lasers'
// speed: a machine-gun bullet takes time to reach a far target (no hit on
// the first frame), the lasers outrun every bullet, a very fast bolt over a
// very long step (a slow frame) never passes through a wall or a creature
// and strikes the nearest thing first, and bolts are reused (no garbage
// per shot). Each check runs in one synchronous step of the page, driving
// lasers.update itself, so the machine's frame rate doesn't matter.
// (Online hits: mp-damage-tests.mjs.)
//
//   node r10-weapons-tests.mjs [--only=substring] [--seed=42]
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


// A clear patch of sky to shoot in: the player hovering high above the
// spawn, looking north (-z), nothing around (creatures, UFOs, bolts gone).
const SETUP = `(g) => {
  if (g.player.dead) g.respawn();
  if (g.vehicles.active) g.vehicles.exit({ force: true });
  g.mobs.clear();
  g.ufos.clear();
  g.lasers.clear();
  g.lasers.update(0);
  const x = g.spawn.x + 0.5, z = g.spawn.z + 0.5;
  const y = g.world.surfaceY(g.spawn.x, g.spawn.z) + 60;
  g.player.flying = true;
  g.player.position.set(x, y, z);
  g.player.velocity.set(0, 0, 0);
  g.player.yaw = 0;
  g.player.pitch = 0;
  g.weapons.viewRange = 160;
  g.weapons._mgHeat = 0;
  g.weapons.refill();
  const eye = g.player.getEyePosition();
  // A cow in the line of fire, at the crosshair's height, too tough to die.
  g.__cow = (dist) => {
    const m = g.mobs.spawn("cow", eye.x, eye.y - 0.7, eye.z - dist);
    m.health = m.maxHealth = 1000;
    m.ai && (m.ai.timer = 999);
    return m;
  };
  return eye;
}`;
const setup = (body) => v(new Function("g", `const eye = (${SETUP})(g); return (${body})(g, eye);`));

await check("the machine gun fires real bullets: a cow 100 blocks off is not hit at once, but a moment later (as long as the bullet's flight)", async () => {
  const r = await setup((g) => {
    const cow = g.__cow(100);
    const rnd = Math.random;
    Math.random = () => 0.5; // (no spread: dead on target)
    let shot;
    try {
      shot = { ...g.weapons.fireMachineGun() };
    } finally {
      Math.random = rnd;
    }
    const bolt = g.lasers.bolts[g.lasers.bolts.length - 1];
    const out = { aimed: shot.type, tracer: !!bolt?.tracer, gun: bolt?.gun, speed: bolt?.speed, atOnce: 1000 - cow.health };
    g.lasers.update(1 / 60);
    out.firstFrame = 1000 - cow.health;
    let t = 1 / 60;
    while (cow.health >= 1000 && t < 3) {
      g.lasers.update(1 / 60);
      t += 1 / 60;
    }
    out.t = t;
    out.hurt = 1000 - cow.health;
    g.mobs.clear();
    return out;
  });
  console.log(`        ${JSON.stringify(r)}`);
  assert(r.aimed === "mob" && r.tracer && r.gun === "machinegun", `a machine-gun tracer bullet aimed at the cow: ${JSON.stringify(r)}`);
  assert(r.atOnce === 0 && r.firstFrame === 0, `no instant hit: ${JSON.stringify(r)}`);
  const flight = 100 / r.speed;
  assert(r.hurt > 0 && r.t > flight * 0.85 && r.t < flight * 1.2, `hit after the bullet's flight (~${flight.toFixed(2)} s): ${JSON.stringify(r)}`);
});

await check("lasers outrun bullets: the blaster and the laser minigun fly ~3x as fast as the pistol and machine gun, and faster than the sniper", async () => {
  const r = await setup((g) => {
    const W = g.weapons;
    const L = g.lasers;
    const last = () => L.bolts[L.bolts.length - 1];
    W.firePistol();
    const pistol = last();
    W.fireMachineGun();
    const mg = last();
    W.fireSniper();
    const sniper = last();
    W.fireBlaster();
    const blaster = last();
    W.fireMinigunBolt();
    const minigun = last();
    const bolts = { pistol, mg, sniper, blaster, minigun };
    // A third of a second of flight in the open (none at the end of its range yet): how far each got.
    for (let i = 0; i < 20; i++) L.update(1 / 60);
    const out = {};
    for (const [k, b] of Object.entries(bolts)) out[k] = { speed: b.speed, traveled: Math.round(b.traveled), tracer: !!b.tracer, length: b.length };
    L.clear();
    return out;
  });
  console.log(`        ${JSON.stringify(r)}`);
  assert(r.pistol.tracer && r.mg.tracer && r.sniper.tracer && !r.blaster.tracer && !r.minigun.tracer, "bullets are tracers, lasers are not");
  for (const laser of ["blaster", "minigun"]) {
    for (const gun of ["pistol", "mg"]) assert(r[laser].speed >= 3 * r[gun].speed, `${laser} vs ${gun}: ${JSON.stringify(r)}`);
    assert(r[laser].speed > r.sniper.speed * 1.2, `${laser} vs the sniper: ${JSON.stringify(r)}`);
    assert(r[laser].traveled > 2.5 * r.mg.traveled, `${laser} got further than the bullets: ${JSON.stringify(r)}`);
    assert(r[laser].length >= 6, `a fast laser is a long streak: ${JSON.stringify(r)}`);
  }
  assert(r.sniper.speed > 2 * r.mg.speed && r.pistol.speed < r.mg.speed * 1.1, `the sniper's bullet is the fast one: ${JSON.stringify(r)}`);
});

await check("no tunnelling: a 700 blocks/s bolt over a 0.25 s step (175 blocks) stops at a wall, hits the nearest creature, and never what is behind", async () => {
  const r = await setup((g, eye) => {
    const L = g.lasers;
    const T = g.THREE;
    const out = {};
    const fwd = new T.Vector3(0, 0, -1);
    const fire = () => L.fire({ from: eye, dir: fwd, speed: 700, damage: 7, owner: "player", source: g.player, range: 400, sound: false });
    const wallZ = Math.floor(eye.z) - 30;
    const ex = Math.floor(eye.x), ey = Math.floor(eye.y);
    const wall = [];
    for (let dx = -1; dx <= 1; dx++) for (let dy = -2; dy <= 1; dy++) wall.push(ex + dx, ey + dy, wallZ, 1);
    g.world.setBlocks(wall);
    // 1. A wall at 30 blocks, a cow behind it at 60.
    let behind = g.__cow(60);
    let b = fire();
    L.update(0.25);
    out.wall = { gone: !L.bolts.includes(b), at: Math.round(b.hitDist * 10) / 10, behindHurt: 1000 - behind.health };
    // 2. The sniper aims at the wall: its shot says so (where the bullet will land).
    const s = g.weapons.fireSniper();
    out.sniperAim = { type: s.type, distance: Math.round(s.distance) };
    for (let i = 0; i < 4; i++) L.update(0.25);
    out.sniperBehind = 1000 - behind.health;
    g.mobs.clear();
    // 3. No wall: a cow at 40 and another at 80, both on the line.
    const clear = [];
    for (let i = 0; i < wall.length; i += 4) clear.push(wall[i], wall[i + 1], wall[i + 2], 0);
    g.world.setBlocks(clear);
    const near = g.__cow(40);
    const far = g.__cow(80);
    b = fire();
    L.update(0.25);
    out.cows = { gone: !L.bolts.includes(b), at: Math.round(b.hitDist * 10) / 10, near: 1000 - near.health, far: 1000 - far.health };
    // 4. A cow in front of a wall: the cow first.
    g.mobs.clear();
    g.world.setBlocks(wall);
    const front = g.__cow(20);
    b = fire();
    L.update(0.25);
    out.front = { cow: 1000 - front.health, at: Math.round(b.hitDist * 10) / 10 };
    g.world.setBlocks(clear);
    g.mobs.clear();
    L.clear();
    return out;
  });
  console.log(`        ${JSON.stringify(r)}`);
  assert(r.wall.gone && r.wall.at > 28 && r.wall.at < 31 && r.wall.behindHurt === 0, `the wall stops it: ${JSON.stringify(r.wall)}`);
  assert(r.sniperAim.type === "block" && r.sniperAim.distance >= 28 && r.sniperAim.distance <= 31 && r.sniperBehind === 0, `the sniper's bullet stops at the wall: ${JSON.stringify(r)}`);
  assert(r.cows.gone && r.cows.near > 0 && r.cows.far === 0 && r.cows.at > 38 && r.cows.at < 41, `the nearest creature, only: ${JSON.stringify(r.cows)}`);
  assert(r.front.cow > 0 && r.front.at < 21, `the creature before the wall: ${JSON.stringify(r.front)}`);
});

await check("bolts are reused: 300 machine-gun bullets and laser bolts make only a few dozen bolt objects", async () => {
  const r = await setup((g) => {
    const L = g.lasers;
    const seen = new Set();
    for (let i = 0; i < 300; i++) {
      if (i % 2) g.weapons.fireMachineGun();
      else g.weapons.fireMinigunBolt();
      seen.add(L.bolts[L.bolts.length - 1]);
      L.update(1 / 30);
    }
    const n = seen.size;
    for (let i = 0; i < 60; i++) L.update(1 / 30);
    const left = L.bolts.length;
    L.clear();
    return { n, left };
  });
  console.log(`        ${JSON.stringify(r)}`);
  assert(r.n < 80, `bolt objects made: ${r.n}`);
  assert(r.left === 0, `every bolt ended: ${r.left} left`);
});

await check("bullets hit UFOs like the pistol's: the machine gun and the sniper damage a UFO once their bullets arrive", async () => {
  const r = await setup((g, eye) => {
    const u = g.ufos.spawn({ size: "large", design: "saucer", pos: eye.clone().add(new g.THREE.Vector3(0, 0, -60)) });
    u.state = "trick";
    u.trick = "hover";
    u.timer = 999;
    const out = {};
    for (const [k, fire] of [["mg", () => g.weapons.fireMachineGun()], ["sniper", () => g.weapons.fireSniper()]]) {
      const h0 = u.health;
      const shot = fire();
      out[k] = { aimed: shot.type, atOnce: h0 - u.health };
      for (let i = 0; i < 60 && u.health === h0; i++) g.lasers.update(1 / 60);
      out[k].hurt = h0 - u.health;
    }
    g.ufos.clear();
    g.lasers.clear();
    return out;
  });
  console.log(`        ${JSON.stringify(r)}`);
  for (const k of ["mg", "sniper"]) assert(r[k].aimed === "target" && r[k].atOnce === 0 && r[k].hurt > 0, `${k}: ${JSON.stringify(r)}`);
});

await check("online: a bullet goes out from the muzzle with its gun (the others hear it), and a received one flies here without hurting anything", async () => {
  const r = await setup(async (g, eye) => {
    const { FxSync } = await import("./js/net/fx.js");
    const sent = [];
    // (A stand-in multiplayer session: only what FxSync touches.)
    const mp = { game: g, active: true, stateLoaded: true, refOf: () => 0, net: { isHost: true, pid: 1, time: 0, on() {}, toAll: (m) => sent.push(m) } };
    const vr = g.vehicles.remoteMissiles, vra = g.vehicles.remoteMissilesAt;
    const fx = new FxSync(mp);
    const out = {};
    try {
      const cow = g.__cow(30);
      g.weapons.fireMachineGun();
      const b = g.lasers.bolts[g.lasers.bolts.length - 1];
      const origin = b.origin.toArray();
      // (The bullet already struck within the frame: it is still sent from the muzzle.)
      for (let i = 0; i < 12; i++) g.lasers.update(1 / 60);
      fx.update(0);
      const e = sent.flatMap((m) => m.l || []).find((x) => x[0] === "b");
      out.sent = !!e && { gun: e[20], tracer: !!(e[15] & 8), hole: !!(e[15] & 1), fromMuzzle: Math.hypot(e[1] - origin[0], e[2] - origin[1], e[3] - origin[2]) < 0.02 };
      out.cowHurt = 1000 - cow.health;
      // The same event received from another player: a mirrored bullet that only blocks stop.
      const h1 = cow.health;
      const n0 = g.lasers.fired;
      fx._onFx({ l: [e] }, 2);
      const m = g.lasers.bolts[g.lasers.bolts.length - 1];
      out.mirror = { made: g.lasers.fired === n0 + 1, mirror: !!m?.mirror, tracer: !!m?.tracer };
      for (let i = 0; i < 12; i++) g.lasers.update(1 / 60);
      out.mirrorHurt = h1 - cow.health;
    } finally {
      mp.active = false;
      g.vehicles.remoteMissiles = vr;
      g.vehicles.remoteMissilesAt = vra;
      g.mobs.clear();
      g.lasers.clear();
    }
    return out;
  });
  console.log(`        ${JSON.stringify(r)}`);
  assert(r.sent && r.sent.gun === "machinegun" && r.sent.tracer && r.sent.hole && r.sent.fromMuzzle, `sent: ${JSON.stringify(r)}`);
  assert(r.cowHurt > 0, `the shooter's own bullet hit: ${JSON.stringify(r)}`);
  assert(r.mirror.made && r.mirror.mirror && r.mirror.tracer && r.mirrorHurt === 0, `received: ${JSON.stringify(r)}`);
});

// ---------- Summary ----------
const failed = results.filter(([, ok]) => !ok);
console.log(`\n${results.length - failed.length} passed, ${failed.length} failed${errors.length ? `; console errors: ${errors.length}` : ""}.`);
if (errors.length) console.log(errors.slice(0, 5).join("\n"));
await browser.close();
server.close();
process.exit(failed.length || errors.length ? 1 : 0);
