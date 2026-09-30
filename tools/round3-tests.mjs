// Round 3 feature tests: boots the real game in headless Chromium (software
// WebGL, Low preset) and checks the Round 3 features (restored jet flight,
// combat fixes, the UFO redesign and behaviour, jet visuals, the world,
// missions):
//
//   node round3-tests.mjs [--only=substring] [--from=substring] [--seed=42]
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
const PORT = 9140 + Math.floor(Math.random() * 40);
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
  if (!(await page.isVisible("#resume-btn")) && (await v((g) => g.gameState)) === "paused") {
    await page.mouse.click(480, 270);
    await frames(3);
    if ((await v((g) => g.gameState)) === "playing") return;
  }
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

// ================= Part 1: critical bug fixes =================
// A segment (a, b) to point p distance.
const SEG = `(ax, ay, az, bx, by, bz, px, py, pz) => {
  const dx = bx - ax, dy = by - ay, dz = bz - az;
  const l2 = dx * dx + dy * dy + dz * dz || 1e-9;
  let t = ((px - ax) * dx + (py - ay) * dy + (pz - az) * dz) / l2;
  t = Math.max(0, Math.min(1, t));
  const qx = ax + dx * t - px, qy = ay + dy * t - py, qz = az + dz * t - pz;
  return Math.sqrt(qx * qx + qy * qy + qz * qz);
}`;

// ================= Part 1: combat fixes =================

await check("UFO shots: every bolt that reaches the player on foot hurts (standing, running, bursts); dodging avoids them", async () => {
  await play();
  await skyArena();
  const r = await v((g, SEG) => {
    const seg = new Function(`return ${SEG}`)();
    const THREE = g.THREE;
    g.setMode("survival");
    const p = g.player;
    p.flying = false;
    p.position.y = 150;
    const out = [];
    for (const [style, size, dist, run] of [["volley", "small", 60, 0], ["burst", "medium", 140, 0], ["heavy", "large", 120, 0], ["volley", "medium", 90, 6], ["burst", "small", 70, 6]]) {
      g.ufos.clear();
      g.lasers.clear();
      const u = g.ufos.spawn({ design: "saucer", size, pos: { x: p.position.x + dist, y: 175, z: p.position.z }, style });
      u.state = "hover_test";
      let near = 0, hits = 0, shots = 0;
      p.velocity.set(0, 0, run);
      const origDamage = p.damage.bind(p);
      let calls = 0;
      p.damage = (a, c, o) => {
        if (c === "ufo_laser" && o?.projectile) calls++;
        return origDamage(a, c, o);
      };
      for (let k = 0; k < 12; k++) {
        p.health = 20;
        p.absorption = 0;
        // (Explosions knock the player about: back in place for every shot.)
        p.position.y = 150;
        p.velocity.set(0, 0, run);
        const before = g.lasers.bolts.length;
        g.ufos._fireAt(u, p.position.clone().setY(p.position.y + 1), p.velocity.clone(), 1);
        const mine = g.lasers.bolts.slice(before);
        shots += mine.length;
        const hp0 = p.health;
        // Closest approach of each bolt's straight path to the body (feet to
        // head), in the frame of the running player.
        const closest = mine.map((b) => {
          const rv = b.dir.clone().multiplyScalar(b.speed).sub(p.velocity);
          const o = b.pos.clone();
          let d = 99;
          for (let t = 0; t < 4; t += 0.002) {
            const x = o.x + rv.x * t - p.position.x, y = o.y + rv.y * t - p.position.y, z = o.z + rv.z * t - p.position.z;
            const yy = Math.max(0, Math.min(1.85, y));
            d = Math.min(d, Math.hypot(x, y - yy, z));
          }
          return d;
        });
        let s = 0;
        while (s < 4 && mine.some((b) => g.lasers.bolts.includes(b))) {
          p.position.addScaledVector(p.velocity, 0.05);
          g.lasers.update(0.05);
          s += 0.05;
        }
        // Visibly reaching the body: the bolt's core passes within the body's half width.
        for (const c of closest) if (c < 0.36) near++;
        p.dead = false;
      }
      hits = calls;
      p.damage = origDamage;
      out.push({ style, size, dist, run, shots, near, hits });
    }
    p.velocity.set(0, 0, 0);
    p.health = 20;
    g.ufos.clear();
    g.setMode("creative");
    return out;
  }, SEG);
  for (const c of r) {
    assert(c.hits >= c.near, `every bolt that reached the body hurt: ${JSON.stringify(c)}`);
    assert(c.hits >= c.shots * 0.25, `aimed shots hit a player who does not dodge: ${JSON.stringify(c)}`);
  }
  // Dodging: a player who changes direction right after the shot is fired is missed.
  const d = await v((g) => {
    g.setMode("survival");
    const p = g.player;
    p.position.y = 150;
    g.ufos.clear();
    const u = g.ufos.spawn({ design: "saucer", size: "small", pos: { x: p.position.x + 120, y: 175, z: p.position.z }, style: "volley" });
    u.state = "hover_test";
    let hurt = 0;
    for (let k = 0; k < 8; k++) {
      p.health = 20;
      p.velocity.set(0, 0, 6);
      g.ufos._fireAt(u, p.position.clone().setY(p.position.y + 1), p.velocity.clone(), 1);
      p.velocity.set(0, 0, -6); // turn around
      for (let s = 0; s < 3; s += 0.05) {
        p.position.addScaledVector(p.velocity, 0.05);
        g.lasers.update(0.05);
      }
      if (p.health < 20) hurt++;
    }
    p.velocity.set(0, 0, 0);
    p.health = 20;
    g.ufos.clear();
    g.setMode("creative");
    return { hurt, state: g.gameState };
  });
  assert(d.hurt <= 3, `changing direction dodges most shots: ${JSON.stringify(d)}`);
});

await check("UFO shots hit a fast jet: a bolt that reaches the jet always damages it", async () => {
  await play();
  await skyArena();
  const r = await v((g, SEG) => {
    const seg = new Function(`return ${SEG}`)();
    const THREE = g.THREE;
    const p = g.player.position;
    const jet = g.vehicles.create("jet", { pos: [p.x, 200, p.z], yaw: 0, airborne: true, speed: 150, throttle: 1 });
    jet.vel.set(0, 0, -150);
    const out = [];
    for (const style of ["volley", "burst", "heavy"]) {
      g.ufos.clear();
      const u = g.ufos.spawn({ design: "saucer", size: "medium", pos: { x: jet.pos.x + 160, y: 215, z: jet.pos.z - 60 }, style });
      u.state = "hover_test";
      let near = 0, hitShots = 0, shots = 0;
      for (let k = 0; k < 10; k++) {
        jet.health = jet.maxHealth;
        const before = g.lasers.bolts.length;
        g.ufos._fireAt(u, jet.pos.clone(), jet.vel.clone(), 1, jet);
        const mine = g.lasers.bolts.slice(before);
        shots += mine.length;
        const closest = mine.map(() => 99);
        let hitsNow = 0;
        const orig = jet.damage.bind(jet);
        jet.damage = (a, c) => { hitsNow++; return orig(a, c); };
        for (let s = 0; s < 4 && mine.some((b) => g.lasers.bolts.includes(b)); s += 0.02) {
          const prev = mine.map((b) => b.pos.clone());
          const jp = jet.pos.clone();
          jet.pos.addScaledVector(jet.vel, 0.02);
          g.lasers.update(0.02);
          // Closest approach in the jet's frame of motion.
          mine.forEach((b, i) => {
            const rel0 = prev[i].clone().sub(jp);
            const rel1 = b.pos.clone().sub(jet.pos);
            closest[i] = Math.min(closest[i], seg(rel0.x, rel0.y, rel0.z, rel1.x, rel1.y, rel1.z, 0, 0, 0));
          });
        }
        jet.damage = orig;
        for (const c of closest) if (c < jet.hitRadius) near++;
        hitShots += hitsNow;
        // Keep the geometry the same for the next shot.
        jet.pos.set(p.x, 200, p.z);
        u.pos.set(jet.pos.x + 160, 215, jet.pos.z - 60);
      }
      out.push({ style, shots, near, hitShots });
    }
    g.ufos.clear();
    g.vehicles.remove(jet);
    return out;
  }, SEG);
  for (const c of r) assert(c.hitShots >= c.near && c.hitShots > 0, `bolts that reached the jet damaged it: ${JSON.stringify(c)}`);
});

await check("UFO attack styles: rapid bursts, heavy bolts, spread fans, charged shots and sweeping beams, each with its own color", async () => {
  await play();
  await skyArena();
  const r = await v((g) => {
    const THREE = g.THREE;
    g.setMode("survival");
    const p = g.player;
    p.flying = false;
    p.position.y = 150;
    const out = {};
    for (const style of ["rapid", "heavy", "spread", "charged", "sweep"]) {
      g.ufos.clear();
      g.lasers.clear();
      const u = g.ufos.spawn({ design: "saucer", size: "medium", pos: { x: p.position.x + 70, y: 185, z: p.position.z }, style });
      u.state = "hover_test";
      p.health = 20;
      const fired = [];
      const firedAt = [];
      p.velocity.set(0, 0, 0);
      const f0 = g.lasers.fired;
      g.ufos._attack(u);
      for (let k = f0; k < g.lasers.fired; k++) firedAt.push(0);
      let t = 0;
      let beamSeen = false;
      let hurtAt = -1;
      while (t < 3) {
        const before = g.lasers.fired;
        g.ufos._updateWeapons(u, 0.02);
        if (g.lasers.fired > before) {
          for (let k = before; k < g.lasers.fired; k++) firedAt.push(+t.toFixed(2));
        }
        if (u.sweep && u.sweep.mesh && u.sweep.mesh.parent) beamSeen = true;
        p.position.y = 150;
        g.lasers.update(0.02);
        if (p.health < 20 && hurtAt < 0) hurtAt = +t.toFixed(2);
        t += 0.02;
      }
      const bolts = g.lasers.fired - f0;
      out[style] = { bolts, firedAt, beamSeen, hurtAt, color: u.laserKey, hp: p.health };
    }
    g.ufos.clear();
    p.health = 20;
    g.setMode("creative");
    return out;
  });
  const j = JSON.stringify(r);
  assert(r.rapid.bolts === 5 && r.rapid.firedAt[4] - r.rapid.firedAt[0] > 0.25, `rapid: five bolts one after another: ${j}`);
  assert(r.heavy.bolts === 1, `heavy: one bolt: ${j}`);
  assert(r.spread.bolts === 5 && r.spread.firedAt[4] === r.spread.firedAt[0], `spread: five bolts at once: ${j}`);
  assert(r.charged.bolts === 1 && r.charged.firedAt[0] > 1.1, `charged: one bolt after the charge: ${j}`);
  assert(r.sweep.bolts === 0 && r.sweep.beamSeen && r.sweep.hurtAt > 0, `sweep: a beam that burns the player standing on its line: ${j}`);
  const colors = new Set(["rapid", "heavy", "spread", "charged", "sweep"].map((k) => r[k].color));
  assert(colors.size === 5, `each style has its own color: ${j}`);
  for (const k of ["rapid", "heavy", "charged"]) assert(r[k].hurtAt > 0, `${k}: a standing player gets hit: ${j}`);
});

// ---------- Summary ----------
const failed = results.filter(([, ok]) => !ok);
console.log(`\n${results.length - failed.length} passed, ${failed.length} failed${errors.length ? `; console errors: ${errors.length}` : ""}.`);
if (errors.length) console.log(errors.slice(0, 5).join("\n"));
await browser.close();
server.close();
process.exit(failed.length || errors.length ? 1 : 0);
