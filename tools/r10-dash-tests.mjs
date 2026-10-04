// Round 10 UFO dash tests: boots the real game in headless Chromium
// (software WebGL, Low preset) and checks the piloted UFO's dash (R): a tap
// ends in view and goes no farther for being held a moment too long (at 60
// or 20 frames a second), a held streak gathers speed and never runs ahead
// of the ground that is drawn, levels off at the dash ceiling, and stops
// when R is let go; settings that are not numbers don't break it; in ghost
// mode a dash rams what it flies through (creatures, UFOs, aircraft, once
// each, half to a boss, nothing through a shield, a knock to the ship's own
// hull) and a plain dash still passes through harmlessly; another player's
// dash is drawn with the smear.
//
//   node r10-dash-tests.mjs [--only=substring] [--seed=42]
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
const PORT = 9700 + Math.floor(Math.random() * 40);
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

// ---------- Boot ----------
await page.goto(`http://localhost:${PORT}/index.html?seed=${SEED}`, { waitUntil: "load", timeout: 60000 });
await page.waitForFunction(() => !!window.__ufo, null, { timeout: 60000 });
await page.evaluate(() => window.__ufo.setGraphics("low"));
await page.waitForFunction(() => window.__ufo.graphicsReady, null, { timeout: 120000 });
{
  const t0 = Date.now();
  while ((await v((g) => g.gameState)) !== "playing" && Date.now() - t0 < 90000) {
    await page.click("#play-btn", { timeout: 5000 }).catch(() => {});
    await frames(3);
  }
}
// Let the world around the spawn stream in (the LOD tiles the dash follows).
await frames(30);

// Helpers in the page: a fresh piloted ship, and stepping it on its own
// (nothing else moves) with R held for a while.
await v((g) => {
  g.setMode("creative");
  g.testFlags.noMissions = true;
  window.__dash = {
    ship(opts = {}) {
      if (g.vehicles.active) g.vehicles.exit({ force: true });
      for (const j of [...g.vehicles.vehicles]) g.vehicles.remove(j);
      g.ufos.clear();
      g.mobs.clear();
      // (Always from the same spot: getting out leaves the player where the last ship went.)
      const home = window.__home || (window.__home = g.player.position.clone());
      const p = g.player.position;
      p.copy(home);
      const u = g.vehicles.create("ufo", { design: opts.design || "saucer", radius: opts.radius ?? 5, pos: [p.x, opts.y ?? 150, p.z], yaw: 0 });
      g.vehicles.enter(u);
      u.camYaw = 0;
      u.camPitch = opts.pitch ?? 0;
      u.speedLevel = opts.speedLevel ?? 1;
      if (opts.mul) u.dashMul = opts.mul;
      Object.assign(g.vehicles.config.ufo, { dash: 1, dashTime: 0.25, ghost: false }, opts.cfg || {});
      u.dashT = 0;
      return u;
    },
    // Steps the ship `steps` times by dt, R held for the first `hold` steps
    // (pressed on the first). Returns the distance from the start after each step.
    run(u, steps, dt, hold) {
      const inp = g.vehicles.input;
      const keys = g.player.keys;
      const start = u.pos.clone();
      const out = [];
      for (let i = 0; i < steps; i++) {
        if (i === 0 && hold > 0) inp.pressed.add("KeyR");
        if (i < hold) keys.add("KeyR");
        else keys.delete("KeyR");
        u.update(dt, inp);
        inp.pressed.clear();
        out.push(u.pos.distanceTo(start));
        if (!Number.isFinite(u.pos.x + u.pos.y + u.pos.z)) break;
      }
      keys.delete("KeyR");
      return out;
    },
  };
  return true;
});

await check("the dash knows what is drawn (main.js hands it the LOD system)", async () => {
  const ok = await v((g) => g.vehicles.lod === g.lod);
  assert(ok, "vehicles.lod is not the game's LodSystem (the main.js wiring is missing)");
});

await check("a tap ends in view, and holding R a moment too long adds nothing (60 fps and 20 fps)", async () => {
  const r = await v((g) => {
    g.vehicles.lod = g.lod;
    const D = window.__dash;
    const out = {};
    for (const [name, dt, hold] of [["one frame", 1 / 60, 1], ["0.2 s at 60 fps", 1 / 60, 12], ["3 frames at 20 fps", 0.05, 3]]) {
      const u = D.ship({ mul: 6, cfg: { dash: 3 } });
      const reach = u.dashReach;
      const d = D.run(u, 90, dt, hold);
      out[name] = { reach: Math.round(reach), want: Math.round(u.dashDistance), view: g.vehicles.viewRange, end: Math.round(d[d.length - 1]), max: Math.round(Math.max(...d)), dashing: !!u.dashing, first: Math.round(d[1]) };
    }
    return out;
  });
  const j = JSON.stringify(r);
  for (const [name, x] of Object.entries(r)) {
    assert(x.reach <= Math.max(60, x.view * 0.8) + 1 && x.reach < x.want, `${name}: the tap is capped by the view: ${j}`);
    assert(x.end <= x.reach + 1 && x.max <= x.reach + 1, `${name}: no farther than the tap: ${j}`);
    assert(x.end > x.reach * 0.4, `${name}: it still dashes: ${j}`);
    assert(!x.dashing, `${name}: the dash is over: ${j}`);
    // (Travelled over two frames at least, never in one jump.)
    assert(x.first > 0 && x.first < x.end, `${name}: seen on the way: ${j}`);
  }
});

await check("ghost mode while flying: R dashes along the view (it used to dash along a position, thousands of blocks away)", async () => {
  const r = await v((g) => {
    const D = window.__dash;
    g.vehicles.lod = g.lod;
    const u = D.ship({ mul: 1, speedLevel: 0.5, cfg: { ghost: true } });
    const keys = g.player.keys;
    const inp = g.vehicles.input;
    const start = u.pos.clone();
    keys.add("KeyW");
    // Flying along (burning its tunnel), then a tap of R.
    for (let i = 0; i < 20; i++) u.update(1 / 60, inp);
    const before = u.pos.clone();
    const reach = u.dashReach;
    const d = D.run(u, 120, 1 / 60, 1);
    keys.delete("KeyW");
    const end = u.pos.clone();
    g.vehicles.config.ufo.ghost = false;
    // (Along the view, -z: the tap, plus the cruise flown meanwhile.)
    return { reach: Math.round(reach), dash: Math.round(end.distanceTo(before)), dx: Math.round(end.x - start.x), dz: Math.round(end.z - start.z), cruise: Math.round(u.cruise) };
  });
  const j = JSON.stringify(r);
  assert(r.dash <= r.reach + r.cruise * 2.1 + 1 && r.dash > r.reach * 0.5, `a dash of the tap's length: ${j}`);
  assert(r.dz < 0 && Math.abs(r.dx) < 5, `along the view: ${j}`);
});

await check("held: gathers speed, never far ahead of the drawn ground, stops on release; without the LOD check it would run off", async () => {
  const r = await v((g) => {
    const D = window.__dash;
    const run = (lod) => {
      g.vehicles.lod = lod;
      const u = D.ship({ mul: 6 });
      const tap = u.dashReach;
      const d = D.run(u, 240, 1 / 60, 180); // 3 s held, 1 s after
      const held = d[179];
      // (The steps: slow at first.)
      const early = d[40] - d[30];
      const late = d[175] - d[165];
      return { tap: Math.round(tap), held: Math.round(held), after: +(d[d.length - 1] - held).toFixed(2), early: Math.round(early), late: Math.round(late), dashing: !!u.dashing, cool: +u.dashT.toFixed(2) };
    };
    const withLod = run(g.lod);
    const without = run(null);
    g.vehicles.lod = g.lod;
    // The frontier: the farthest built ground along the dash (north of the start).
    const p = g.player.position;
    return { withLod, without, range: g.vehicles.viewRange };
  });
  const j = JSON.stringify(r);
  const a = r.withLod;
  assert(a.held > a.tap * 3, `holding R keeps streaking: ${j}`);
  assert(a.after < 1 && !a.dashing && a.cool > 0, `letting go stops it (with the hold cooldown): ${j}`);
  // (Nothing streams in this test: past the built tiles it only creeps on, 300 blocks/s.)
  assert(a.held < r.range * 3.5 + 300 * 3 + 200, `held: not past the drawn ground: ${j}`);
  assert(r.without.held > a.held * 2, `the LOD check is what holds it back: ${j}`);
  assert(r.without.early < r.without.late, `it gathers speed: ${j}`);
});

await check("held: levels off at the dash ceiling, stops at the world's edge; NaN settings don't break it", async () => {
  const r = await v((g) => {
    const D = window.__dash;
    g.vehicles.lod = g.lod;
    let u = D.ship({ y: 2300, pitch: 1.1, mul: 3 });
    D.run(u, 200, 1 / 60, 200);
    const top = u.pos.y;
    // (Above the ceiling already: it doesn't pull the ship down.)
    u = D.ship({ y: 3000, pitch: 0.5, mul: 3 });
    D.run(u, 60, 1 / 60, 60);
    const high = u.pos.y;
    u = D.ship({ mul: 6 });
    u.pos.z = -999990;
    g.vehicles.lod = null;
    D.run(u, 120, 1 / 60, 120);
    const edge = { z: u.pos.z, dashing: !!u.dashing };
    g.vehicles.lod = g.lod;
    u = D.ship({ cfg: { dashTime: NaN, dash: "x" } });
    const speed = u.dashSpeed;
    const d = D.run(u, 60, 1 / 60, 1);
    const finite = Number.isFinite(u.pos.x + u.pos.y + u.pos.z);
    Object.assign(g.vehicles.config.ufo, { dash: 1, dashTime: 0.25 });
    return { top, high, edge, speed, finite, moved: d[d.length - 1] };
  });
  const j = JSON.stringify(r);
  assert(r.top <= 2500.01, `levels off at 2500: ${j}`);
  assert(r.high <= 3000.01 && r.high >= 2999, `a ship already higher keeps its height: ${j}`);
  assert(Math.abs(r.edge.z) <= 1000000 && !r.edge.dashing, `stops at the edge: ${j}`);
  assert(Number.isFinite(r.speed) && r.finite && r.moved > 10, `bad settings fall back to the defaults: ${j}`);
});

await check("ghost ram: creatures, UFOs and aircraft in the path are hit once each (half to a boss, nothing through a shield), the hull takes a knock; a plain dash passes through", async () => {
  const r = await v((g) => {
    const D = window.__dash;
    const T = g.THREE;
    g.vehicles.lod = g.lod;
    const setup = (ghost) => {
      const u = D.ship({ mul: 1, speedLevel: 0, cfg: { ghost, dash: 2 } });
      const p = u.pos;
      // Along the path (the view is -z), all floating at the ship's height.
      const mob = g.mobs.spawn("zombie", p.x + 1, p.y - 0.9, p.z - 30);
      const ufo = g.ufos.spawn({ size: "small", pos: new T.Vector3(p.x - 2, p.y + 1, p.z - 50) });
      const boss = g.ufos.spawn({ size: "small", pos: new T.Vector3(p.x + 2, p.y, p.z - 65) });
      boss.boss = true;
      const shield = g.ufos.spawn({ size: "small", pos: new T.Vector3(p.x, p.y - 1, p.z - 80) });
      shield.shield = true;
      const parked = g.vehicles.create("ufo", { design: "saucer", radius: 3, pos: [p.x + 3, p.y, p.z - 95], yaw: 0 });
      const off = g.mobs.spawn("zombie", p.x + 25, p.y - 0.9, p.z - 40); // (well beside the path)
      for (const x of [ufo, boss, shield]) {
        x.noLeave = true;
        x.dodgeMul = 0;
        x.health = x.maxHealth = 500;
      }
      if (mob) mob.health = mob.maxHealth = 500;
      if (off) off.health = off.maxHealth = 500;
      return { u, mob, ufo, boss, shield, parked, off };
    };
    const measure = (s) => ({
      mob: s.mob ? 500 - s.mob.health : null,
      ufo: 500 - s.ufo.health,
      boss: 500 - s.boss.health,
      shield: 500 - s.shield.health,
      parked: s.parked.maxHealth - s.parked.health,
      off: s.off ? 500 - s.off.health : null,
      self: s.u.maxHealth - s.u.health,
      selfMax: s.u.maxHealth,
      power: s.u.power,
    });
    const s = setup(true);
    const reach = s.u.dashReach;
    // Hold R through the tap and on (a held ghost dash goes back over nothing twice).
    const d = D.run(s.u, 200, 1 / 60, 150);
    const ghost = { ...measure(s), went: Math.round(d[149]), reach: Math.round(reach), cool: +s.u.dashT.toFixed(2) };
    const p = setup(false);
    D.run(p.u, 100, 1 / 60, 1);
    const plain = measure(p);
    g.vehicles.config.ufo.ghost = false;
    return { ghost, plain };
  });
  const j = JSON.stringify(r);
  const gh = r.ghost;
  const dmg = Math.round(80 * gh.power);
  assert(gh.went > 100, `the ghost dash went through them all: ${j}`);
  assert(gh.mob === null || gh.mob === dmg, `the creature is rammed once: ${j}`);
  assert(gh.ufo === dmg, `the UFO is rammed once: ${j}`);
  assert(gh.boss === Math.round(dmg * 0.5), `the boss takes half: ${j}`);
  assert(gh.shield === 0, `nothing gets through a shield: ${j}`);
  assert(gh.parked === dmg, `the parked ship is rammed once: ${j}`);
  assert(gh.off === null || gh.off === 0, `nothing beside the path: ${j}`);
  // (Each ship rammed, the shielded one too: 4 knocks of 3%.)
  assert(gh.self >= Math.floor(gh.selfMax * 0.03 * 4) - 1 && gh.self <= Math.ceil(gh.selfMax * 0.03 * 4) + 2, `the hull takes a knock: ${j}`);
  assert(gh.cool > 1.2, `a ram dash has the full cooldown: ${j}`);
  const pl = r.plain;
  assert(!pl.mob && !pl.ufo && !pl.boss && !pl.parked && !pl.self, `a plain dash passes through harmlessly: ${j}`);
});

await check("the ghost ram meets aircraft by the hull's flat shape, its path is capped in width, and the cooldown grows with what it hit", async () => {
  const r = await v((g) => {
    const D = window.__dash;
    g.vehicles.lod = g.lod;
    // A big flat ship: one fighter in its path, one just above its hull.
    let u = D.ship({ radius: 12, mul: 1, speedLevel: 0, cfg: { ghost: true, dash: 2 } });
    let p = u.pos.clone();
    const top = p.y + (u.info.top ?? u.info.bottom) * u.radius;
    const jet = (y, dz) => {
      const j = g.vehicles.create("jet", { jetType: "f16", pos: [p.x, y, p.z - dz], yaw: 0, airborne: true, speed: 0, throttle: 0 });
      j.health = j.maxHealth = 500;
      return j;
    };
    const inPath = jet(p.y, 40);
    const above = jet(top + 6, 60);
    D.run(u, 200, 1 / 60, 1);
    const air = { inPath: 500 - inPath.health, above: 500 - above.health, power: u.power };
    // A giant: a creature 20 beside the line (inside 0.85 r, outside the cap), one 5 beside it.
    u = D.ship({ radius: 30, mul: 1, speedLevel: 0, cfg: { ghost: true, dash: 2 } });
    p = u.pos;
    const near = g.mobs.spawn("zombie", p.x + 5, p.y - 0.9, p.z - 50);
    const far = g.mobs.spawn("zombie", p.x + 20, p.y - 0.9, p.z - 50);
    for (const m of [near, far]) if (m) m.health = m.maxHealth = 5000;
    D.run(u, 200, 1 / 60, 1);
    const giant = { near: near ? 5000 - near.health : null, far: far ? 5000 - far.health : null, cool: +(u.dashTotal || 0).toFixed(2) }; // (the cooldown it was given)
    g.vehicles.config.ufo.ghost = false;
    return { air, giant };
  });
  const j = JSON.stringify(r);
  assert(r.air.inPath === Math.round(80 * r.air.power), `the fighter in the path is rammed: ${j}`);
  assert(r.air.above === 0, `the fighter above the hull is not: ${j}`);
  assert(r.giant.near === null || r.giant.near > 0, `the creature beside the line is rammed: ${j}`);
  assert(r.giant.far === null || r.giant.far === 0, `the path is capped in width: ${j}`);
  assert(r.giant.near === null || r.giant.cool > 2.5, `the cooldown grows with what was hit: ${j}`);
});

await check("another player's dash is drawn with the smear (and an ordinary move, a boost or a teleport is not)", async () => {
  const r = await v((g) => {
    const D = window.__dash;
    const u = D.ship({});
    const trail = g.ufos.trail;
    trail.clear();
    const prev = u.pos.clone();
    u.pos.z -= 3;
    u.netMoved(prev, 1 / 60);
    const slow = trail.ghosts.length;
    prev.copy(u.pos);
    u.pos.z -= 60;
    u.netMoved(prev, 1 / 60);
    const fast = trail.ghosts.length;
    // With the snapshot's dash flag: a fast cruise (boost) is not a dash, a
    // dash step of a few blocks (a high frame rate) is, a teleport is not.
    trail.clear();
    prev.copy(u.pos);
    u.pos.z -= 60;
    u.netMoved(prev, 1 / 60, false);
    const boost = trail.ghosts.length;
    prev.copy(u.pos);
    u.pos.z -= 6;
    u.netMoved(prev, 1 / 144, true);
    const flagged = trail.ghosts.length;
    trail.clear();
    prev.copy(u.pos);
    u.pos.z -= 3000;
    u.netMoved(prev, 1 / 60, true);
    const teleport = trail.ghosts.length;
    g.vehicles.exit({ force: true });
    for (const j of [...g.vehicles.vehicles]) g.vehicles.remove(j);
    return { slow, fast, boost, flagged, teleport };
  });
  assert(r.slow === 0 && r.fast > 0 && r.boost === 0 && r.flagged > 0 && r.teleport === 0, JSON.stringify(r));
});

// ---------- Summary ----------
const failed = results.filter(([, ok]) => !ok);
console.log(`\n${results.length - failed.length} passed, ${failed.length} failed${errors.length ? `; console errors: ${errors.length}` : ""}.`);
if (errors.length) console.log(errors.slice(0, 5).join("\n"));
await browser.close();
server.close();
process.exit(failed.length || errors.length ? 1 : 0);
