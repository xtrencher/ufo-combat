// Round 10 "planes" tests: boots the real game in headless Chromium (software
// WebGL, Low preset) and checks the aircraft hit shapes and collisions in
// single player: a shot beside a fighter's nose or just over its back misses
// and one through the wing tip hits; a shot at a player standing under a
// B-2's wing reaches the player (and one from above meets the wing); a blast
// under the wing hurts the jet and one well above it doesn't; two jets
// meeting head-on both blow up; a gentle bump on the runway leaves both
// nearly intact and a taxiing scrape only dents them. (The hull shapes on
// their own: unit checks at the top, in Node.)
//
//   node r10-planes-tests.mjs [--only=substring] [--seed=42]
//
// Like the other suites, it fails on any console error or page error.
import http from "node:http";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";
import { hullShape, hullRay, hullDistance, hullContact, CONTACT } from "../js/hitboxes.js";

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
const results = [];
function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

// ---------- The shapes, in Node ----------
{
  const id = { x: 0, y: 0, z: 0, w: 1 };
  const o = { x: 0, y: 0, z: 0 };
  const ray = (type, from, dir, len = 100, pad = 0) => hullRay(hullShape(type), o, id, from, dir, len, pad);
  const checks = [
    ["a vertical ray 4 blocks beside the F-22's nose misses", () => ray("f22", { x: 4, y: 20, z: -5 }, { x: 0, y: -1, z: 0 }) < 0],
    ["a ray 3.5 blocks over the F-22's back (inside the old sphere) misses", () => ray("f22", { x: -50, y: 3.5, z: 0 }, { x: 1, y: 0, z: 0 }) < 0],
    ["a vertical ray through the F-22's wing tip hits", () => ray("f22", { x: 6.3, y: 20, z: 2 }, { x: 0, y: -1, z: 0 }) > 0],
    ["a ray through a canted fin's top hits", () => ray("f22", { x: -50, y: 2.9, z: 6.2 }, { x: 1, y: 0, z: 0 }) > 0],
    ["the F-16's wingtip missile is part of it", () => ray("f16", { x: 4.95, y: 20, z: 3.4 }, { x: 0, y: -1, z: 0 }) > 0],
    ["the B-2's wing tip (outside its old 13-block sphere) is hit", () => ray("b2", { x: 21.5, y: 20, z: 5 }, { x: 0, y: -1, z: 0 }) > 0],
    ["a ray a block under the B-2's wing misses", () => ray("b2", { x: 11, y: -1.2, z: -50 }, { x: 0, y: 0, z: 1 }) < 0],
    ["a point 3 below the F-22's wing is about 3 from it", () => Math.abs(hullDistance(hullShape("f22"), o, id, { x: 4, y: -3, z: 2 }) - 2.74) < 0.3],
    [
      "two fighters passing through each other in one long frame touch",
      () => hullContact(hullShape("f22"), { pos: o, q: id, vel: { x: 0, y: 0, z: -150 } }, hullShape("f16"), { pos: { x: 0, y: 0, z: 100 }, q: { x: 0, y: 1, z: 0, w: 0 }, vel: { x: 0, y: 0, z: 150 } }, 0.5) && CONTACT.entered && CONTACT.nz < -0.5,
    ],
    ["fighters 2 blocks apart wingtip to wingtip don't touch", () => !hullContact(hullShape("f22"), { pos: o, q: id, vel: { x: 0, y: 0, z: -3 } }, hullShape("f22"), { pos: { x: 15.2, y: 0, z: 0 }, q: id, vel: { x: 0, y: 0, z: 3 } }, 0.1)],
  ];
  for (const [name, fn] of checks) {
    let ok = false;
    try {
      ok = fn();
    } catch (e) {
      console.log(`        ${e.message}`);
    }
    results.push([name, ok]);
    console.log(`  ${ok ? "PASS" : "FAIL"}  ${name}`);
  }
}

// ---------- The game ----------
const PORT = 9680 + Math.floor(Math.random() * 40);
const SEED = Number(args.seed ?? 42);
const MIME = { ".html": "text/html", ".js": "text/javascript" };
const server = http.createServer((req, res) => {
  const url = decodeURIComponent(req.url.split("?")[0]);
  let filePath = path.join(ROOT, url);
  if (filePath.endsWith("/")) filePath = path.join(filePath, "index.html");
  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404);
      res.end("not found");
      return;
    }
    // (Until main.js's bolt provider asks the vehicle for its hull itself:
    // the same change, made here.)
    if (url === "/js/main.js") data = String(data).replace(/const r = \(v\.hitRadius \?\? v\.radius\) \+ bolt\.radius \* 2;\s*const t = sweptSphere\(origin, dir, step, v\.pos, r, v\.vel, dt\);/, "const t = v.sweptRaycast(origin, dir, step, bolt.radius * 2, dt);");
    res.writeHead(200, { "Content-Type": MIME[path.extname(filePath)] || "application/octet-stream" });
    res.end(data);
  });
});
await new Promise((r) => server.listen(PORT, r));

const errors = [];
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
// Frames until fn(game, arg) is true (or the time is up): its last value.
async function until(fn, arg, ms = 30000) {
  const t0 = Date.now();
  let r;
  while (Date.now() - t0 < ms) {
    r = await v(fn, arg);
    if (r) return r;
    await frames(2);
  }
  return r;
}

async function check(name, fn) {
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

await page.goto(`http://localhost:${PORT}/index.html?seed=${SEED}`, { waitUntil: "load", timeout: 60000 });
await page.waitForFunction(() => !!window.__ufo, null, { timeout: 60000 });
await page.evaluate(() => window.__ufo.setGraphics("low"));
await page.waitForFunction(() => window.__ufo.graphicsReady, null, { timeout: 120000 });
{
  const t0 = Date.now();
  while (Date.now() - t0 < 90000) {
    const st = await v((g) => g.gameState);
    if (st === "playing") break;
    if (st === "start") await page.click("#play-btn", { timeout: 5000 }).catch(() => {});
    else if (await page.isVisible("#resume-btn")) await page.click("#resume-btn", { timeout: 3000 }).catch(() => {});
    else await page.mouse.click(480, 270);
    await frames(3);
  }
}

// A quiet test ground: Survival with no missions, no UFOs, creatures or
// patrols, the player at the spawn, and a flat stone deck 60 x 90 at y 100
// (high over the land) for the aircraft on their wheels. Air targets hang
// at y 140, over everything. Returns the deck's middle (x, top, z).
const ground = () =>
  v((g) => {
    g.testFlags.noMissions = true;
    if (g.player.dead) g.respawn();
    if (g.vehicles.active) g.vehicles.exit({ force: true });
    g.setMode("survival");
    g.progress.enabled = false;
    g.ufos.clear();
    g.mobs.clear();
    g.enemyJets.config.count = 0;
    for (const j of [...g.vehicles.vehicles]) g.vehicles.remove(j);
    const sx = Math.floor(g.spawn.x);
    const sz = Math.floor(g.spawn.z);
    if (!window.__deck) {
      const list = [];
      for (let x = sx - 30; x < sx + 30; x++) for (let z = sz - 45; z < sz + 45; z++) list.push(x, 100, z, 3);
      g.world.setBlocks(list, { recordEdit: false });
      window.__deck = true;
    }
    g.player.position.set(sx + 0.5, g.world.surfaceY(sx, sz) + 1, sz + 0.5);
    g.player.velocity.set(0, 0, 0);
    g.player.flying = false;
    g.player.health = 20;
    return { x: sx + 0.5, y: 101, z: sz + 0.5 };
  });

// An aircraft hanging still in the air (its update only places it), at (x, y, z) facing -Z.
const hang = (type, at) =>
  v(
    (g, a) => {
      const j = g.vehicles.create("jet", { jetType: a.type, pos: a.at, yaw: 0, airborne: true, speed: 0, throttle: 0 });
      j.update = () => j._place();
      window.__t = j;
      return { x: j.pos.x, y: j.pos.y, z: j.pos.z, hp: j.health };
    },
    { type, at }
  );

// A player's bolt from `from` toward `to`; resolves once it has struck or flown out.
const shoot = (from, to, owner = "player", damage = 5) =>
  v(
    (g, a) => {
      const T = g.THREE;
      const f = new T.Vector3(...a.from);
      const d = new T.Vector3(...a.to).sub(f).normalize();
      window.__b = g.lasers.fire({ from: f, dir: d, speed: 300, damage: a.damage, owner: a.owner, source: null, range: 200, radius: 0.06, sound: false, cause: a.owner === "alien" ? "alien" : null });
      return true;
    },
    { from, to, owner, damage }
  ).then(() => until((g) => window.__b.dead || !g.lasers.bolts.includes(window.__b), null, 20000));

await check("A player's bolt 4 blocks beside a fighter's nose, or 3.5 over its back, misses; one through the wing tip hits", async () => {
  const c = await ground();
  const j = await hang("f22", [c.x, 140, c.z]);
  await shoot([j.x + 4, j.y + 30, j.z - 5], [j.x + 4, j.y - 30, j.z - 5]);
  await shoot([j.x - 40, j.y + 3.5, j.z], [j.x + 40, j.y + 3.5, j.z]);
  let hp = await v(() => window.__t.health);
  assert(hp === j.hp, `near misses hurt it (${j.hp} -> ${hp})`);
  await shoot([j.x + 6.3, j.y + 30, j.z + 2], [j.x + 6.3, j.y - 30, j.z + 2]);
  hp = await v(() => window.__t.health);
  assert(hp === j.hp - 5, `the wing tip shot didn't hit (${j.hp} -> ${hp})`);
});

await check("An alien's shot at a player standing under a B-2's wing reaches the player; one from above meets the wing", async () => {
  const c = await ground();
  const b = await v((g, c) => {
    const j = g.vehicles.create("jet", { jetType: "b2", pos: [c.x, c.y + 2.6, c.z], yaw: 0, airborne: false });
    window.__t = j;
    g.player.position.set(c.x + 11, c.y, c.z + 2);
    g.player.velocity.set(0, 0, 0);
    g.player.health = 20;
    g.player.hurtTime = 99;
    return { x: j.pos.x, y: j.pos.y, z: j.pos.z, hp: j.health };
  }, c);
  await frames(4);
  const p = await v((g) => ({ x: g.player.position.x, y: g.player.position.y, z: g.player.position.z }));
  assert(Math.abs(p.y - c.y) < 0.2, `the player isn't standing on the deck (${p.y})`);
  await shoot([p.x + 26, p.y + 1.1, p.z], [p.x, p.y + 1.1, p.z], "alien", 3);
  let r = await v(() => ({ hp: window.__ufo.player.health, b2: window.__t.health }));
  assert(r.hp < 20, `the player under the wing wasn't hit (${r.hp})`);
  assert(r.b2 === b.hp, `the B-2 took the shot (${b.hp} -> ${r.b2})`);
  await v((g) => {
    g.player.health = 20;
    g.player.hurtTime = 99;
  });
  await shoot([p.x, p.y + 30, p.z], [p.x, p.y + 1, p.z], "ufo", 3);
  r = await v(() => ({ hp: window.__ufo.player.health, b2: window.__t.health }));
  assert(r.hp === 20, `the shot from above went through the wing (${r.hp})`);
  assert(r.b2 < b.hp, `the wing wasn't hit (${r.b2})`);
});

await check("A blast under a fighter's wing hurts it; one 9 blocks over its back doesn't", async () => {
  const c = await ground();
  const j = await hang("f22", [c.x, 140, c.z]);
  await v((g, j) => g.effects.explode(new g.THREE.Vector3(j.x, j.y + 9, j.z), { radius: 4.5, source: "enemymissile" }), j);
  await frames(2);
  let hp = await v(() => window.__t.health);
  assert(hp === j.hp, `the blast over it hurt it (${j.hp} -> ${hp})`);
  await v((g, j) => g.effects.explode(new g.THREE.Vector3(j.x + 4, j.y - 2.5, j.z + 1.5), { radius: 4.5, source: "enemymissile" }), j);
  await frames(2);
  hp = await v(() => window.__t.health);
  assert(hp < j.hp - 10, `the blast under the wing barely hurt it (${j.hp} -> ${hp})`);
});

await check("Two jets meeting head-on at speed both blow up", async () => {
  const c = await ground();
  await v((g, c) => {
    const mk = (z, yaw) => g.vehicles.create("jet", { jetType: "f22", pos: [c.x, 150, z], yaw, airborne: true, speed: 140, throttle: 1 });
    window.__pair = [mk(c.z + 40, 0), mk(c.z - 40, Math.PI)];
  }, c);
  const r = await until(() => window.__pair.every((j) => !j.alive) && window.__pair.map((j) => j.lastHitBy), null, 30000);
  assert(Array.isArray(r), `not both destroyed: ${await v(() => window.__pair.map((j) => `${j.alive} ${j.health} z ${j.pos.z.toFixed(1)}`).join(" / "))}`);
  assert(r.includes("crash"), `not a collision: ${r.join(", ")}`);
});

// Jet B rolls into the tail of jet A (parked) on the deck at `speed`, with the player in B.
async function taxi(speed) {
  const c = await ground();
  await v(
    (g, a) => {
      const { c } = a;
      const A = g.vehicles.create("jet", { jetType: "f16", pos: [c.x, c.y + 1.35, c.z - 10], yaw: 0, airborne: false });
      const B = g.vehicles.create("jet", { jetType: "f22", pos: [c.x, c.y + 1.35, c.z - 10 + 15.2 + a.speed * 0.15], yaw: 0, airborne: false });
      g.vehicles.enter(B);
      B.throttle = 0;
      B.vel.set(0, 0, -a.speed);
      window.__pair = [A, B];
    },
    { c, speed }
  );
  await frames(3);
  await v((g, s) => window.__pair[1].vel.set(0, 0, -s), speed);
  await until(() => {
    const [A, B] = window.__pair;
    return B.vel.length() < 0.5 || !A.alive || !B.alive;
  }, null, 30000);
  await frames(4);
  return v(() => {
    const [A, B] = window.__pair;
    return { a: A.health / A.maxHealth, b: B.health / B.maxHealth, alive: A.alive && B.alive, gap: B.pos.z - A.pos.z, speed: B.vel.length() };
  });
}

await check("A gentle bump on the runway (3 blocks/s) stops the jet and leaves both nearly intact", async () => {
  const r = await taxi(3);
  assert(r.alive && r.a > 0.97 && r.b > 0.97, `hurt: ${JSON.stringify(r)}`);
  assert(r.gap > 14, `they ended up inside each other: ${JSON.stringify(r)}`);
});

await check("A taxiing scrape (14 blocks/s) dents both, destroys neither", async () => {
  const r = await taxi(14);
  assert(r.alive, `destroyed: ${JSON.stringify(r)}`);
  assert(r.a < 0.95 && r.b < 0.95, `no damage: ${JSON.stringify(r)}`);
});

await v((g) => {
  if (g.vehicles.active) g.vehicles.exit({ force: true });
});
await browser.close();
server.close();
const failed = results.filter((r) => !r[1]);
console.log(`\n${results.length - failed.length}/${results.length} passed${errors.length ? `, ${errors.length} console errors` : ""}`);
if (errors.length) console.log(errors.slice(0, 5).join("\n"));
process.exit(failed.length || errors.length ? 1 : 0);
