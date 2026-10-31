// Round 14 "aim" tests: the missile truck's targeting and the fighter HUD's
// compact lock box. Boots the real game in headless Chromium (software
// WebGL, Low preset):
//   - telAim on a made-up world: a hit within reach is the target; a far
//     hill and the sky mark the ground at the full reach on the bearing
//     (capped); the surface of water over what the ray hit; too close is
//     refused; straight up has no bearing;
//   - in the game (Creative, a launcher on a raised pad): the crosshair on a
//     hill (a stone tower), on water (its surface), over the horizon (2 km,
//     capped), too close (refused, the message says so, nothing starts), then
//     a launch at the hill (the ring and the readout shown, amber on the
//     launch's target), all hidden once out of the truck;
//   - the fighter HUD at 1920x1080, 1280x720 and 800x500: the lock box is
//     small (64 closing to 34 while it builds, 32 locked: Round 12's sizes,
//     a little bigger on a big screen), the seeker ring small, the states
//     (seek, locking, locked) and the missile warning's data-warn.
//
//   node r14-aim-tests.mjs [--only=substring] [--seed=42]
// (SHOTS=dir saves screenshots.)
import http from "node:http";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(process.env.GAME_ROOT || path.join(__dirname, ".."));
const SHOTS = process.env.SHOTS ? path.resolve(process.env.SHOTS) : null;
if (SHOTS) fs.mkdirSync(SHOTS, { recursive: true });
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

const PORT = 9760 + Math.floor(Math.random() * 40);
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
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome",
  args: ["--use-gl=swiftshader", "--enable-webgl", "--ignore-gpu-blocklist", "--no-sandbox", "--disable-dev-shm-usage"],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
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
const v = (fn, arg) => page.evaluate(([src, a]) => new Function("g", "arg", `return (${src})(g, arg);`)(window.__ufo, a), [fn.toString(), arg]);
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
async function shot(name) {
  if (!SHOTS) return;
  const file = path.join(SHOTS, `${name}.png`);
  await page.screenshot({ path: file });
  console.log(`        screenshot: ${file}`);
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
async function play() {
  const t0 = Date.now();
  while (Date.now() - t0 < 300000) {
    const st = await v((g) => g.gameState);
    if (st === "playing") return;
    if (st === "dead") await v((g) => g.respawn());
    else if (st === "start") await page.click("#play-btn", { timeout: 5000 }).catch(() => {});
    else if (await page.isVisible("#resume-btn")) await page.click("#resume-btn", { timeout: 3000 }).catch(() => {});
    else {
      const vp = page.viewportSize();
      await page.mouse.click(vp.width / 2, vp.height / 2);
      await frames(5);
      if ((await v((g) => g.gameState)) === "paused" && !(await page.isVisible("#resume-btn"))) await page.evaluate(() => document.getElementById("pause-menu").classList.remove("hidden"));
    }
    await frames(3);
  }
}

await page.goto(`http://localhost:${PORT}/index.html?seed=${SEED}`, { waitUntil: "load", timeout: 240000 });
await page.waitForFunction(() => !!window.__ufo, null, { timeout: 240000 });
await page.evaluate(() => window.__ufo.setGraphics("low"));
await page.waitForFunction(() => window.__ufo.graphicsReady, null, { timeout: 240000 });
await play();
await v((g) => {
  g.testFlags.noMissions = true;
  g.setMode("creative");
  g.ufos.clear();
  g.mobs.clear();
  g.enemyJets.config.count = 0;
  for (const j of [...g.vehicles.vehicles]) g.vehicles.remove(j);
});

// ---------- The missile truck ----------

await check("telAim on a made-up world: a hit in reach, a far hill and the sky capped at the full reach, water's surface, too close, straight up", async () => {
  const r = await v(async (g) => {
    const { telAim, TEL_RANGE } = await import("./js/ballistic.js");
    const T = g.THREE;
    // Flat ground at y 30 (the height map), loaded nowhere; a hit `hitAt` along the ray.
    const mk = (hitAt, water = false) => ({
      dimInfo: { heightfield: true },
      raycast: (o, d, max) => (hitAt !== null && hitAt <= max ? { distance: hitAt, block: [Math.floor(o.x + d.x * hitAt), 29, Math.floor(o.z + d.z * hitAt)], place: [0, water ? 999 : 30, 0], normal: [0, 1, 0] } : null),
      getBlock: (x, y) => (water && y >= 999 && y < 1001 ? 5 : 0),
      getChunk: () => (water ? {} : null),
      surfaceY: () => -1,
      heightAt: () => 30,
    });
    const origin = new T.Vector3(0, 31, 0);
    const from = new T.Vector3(0, 41, 22);
    const dir = (pitch, yaw = 0) => new T.Vector3(-Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), -Math.cos(yaw) * Math.cos(pitch));
    const out = {};
    const cp = (a) => ({ ok: a.ok, why: a.why, capped: a.capped, dist: Math.round(a.dist), p: a.point.toArray().map((n) => Math.round(n * 10) / 10) });
    out.inReach = cp(telAim(mk(500), origin, from, dir(-0.02)));
    out.farHill = cp(telAim(mk(2300), origin, from, dir(-0.004)));
    out.sky = cp(telAim(mk(null), origin, from, dir(0.2, 0.7)));
    out.near = cp(telAim(mk(60), origin, from, dir(-0.2)));
    out.up = cp(telAim(mk(null), origin, from, new T.Vector3(0, 1, 0)));
    // (Water: the ray hits the bottom at 300; the cell before it is water up to 1000: the surface is 1000.85.)
    const wd = new T.Vector3(0, -0.5, -1).normalize();
    const wf = new T.Vector3(0, 1200, 0);
    out.water = cp(telAim(mk(500, true), new T.Vector3(0, 1190, 0), wf, wd));
    out.range = TEL_RANGE;
    return out;
  });
  assert(r.inReach.ok && !r.inReach.capped && r.inReach.dist > 450 && r.inReach.dist < 500, `in reach: ${JSON.stringify(r.inReach)}`);
  assert(r.farHill.ok && r.farHill.capped && r.farHill.dist === r.range.max && r.farHill.p[1] === 31, `a far hill: the ground at the full reach: ${JSON.stringify(r.farHill)}`);
  assert(r.sky.ok && r.sky.capped && r.sky.dist === r.range.max && r.sky.p[0] < -1000, `the sky: the ground at the full reach on its bearing: ${JSON.stringify(r.sky)}`);
  assert(!r.near.ok && r.near.why === "near", `too close: ${JSON.stringify(r.near)}`);
  assert(!r.up.ok && r.up.why === "up", `straight up: ${JSON.stringify(r.up)}`);
  assert(r.water.ok && Math.abs(r.water.p[1] - 1000.85) < 0.05, `the water's surface: ${JSON.stringify(r.water)}`);
});

await check("the launcher in the game: a hill, water, over the horizon, too close refused, a launch at the hill (the ring and readout), hidden once out", async () => {
  await play();
  const S = await v(async (g) => {
    const W = g.world;
    const p = g.player.position.clone();
    const x0 = Math.floor(p.x);
    const z0 = Math.floor(p.z);
    W.prepareArea(x0, z0, 1);
    // (A raised pad: the view looks down on the targets, not along the ground.)
    const gy = W.surfaceY(x0, z0) + 26;
    const L = [];
    for (let x = x0 - 6; x <= x0 + 6; x++) for (let z = z0 - 8; z <= z0 + 8; z++) {
      L.push(x, gy, z, 1);
      for (let y = gy + 1; y < gy + 12; y++) L.push(x, y, z, 0);
    }
    W.setBlocks(L);
    const { summonTel } = await import("./js/ballistic.js");
    const t = summonTel(g.vehicles, new g.THREE.Vector3(x0 + 0.5, gy + 1, z0 + 0.5), 0);
    t.pos.y = gy + 1;
    g.vehicles.enter(t);
    window.__t = t;
    // A "hill": a stone tower 9 x 9, 30 tall, 170 north.
    W.prepareArea(x0, z0 - 170, 1);
    const hy = W.surfaceY(x0, z0 - 170);
    const H = [];
    for (let x = x0 - 4; x <= x0 + 4; x++) for (let z = z0 - 174; z <= z0 - 166; z++) for (let y = hy; y <= hy + 30; y++) H.push(x, y, z, 1);
    W.setBlocks(H);
    // A pool: water 3 deep, 21 x 21, 150 north-east, in a stone basin (the land round it may lie lower).
    const px = x0 + 110;
    const pz = z0 - 110;
    W.prepareArea(px, pz, 1);
    const py = W.surfaceY(px, pz);
    const P = [];
    for (let x = px - 11; x <= px + 11; x++) for (let z = pz - 11; z <= pz + 11; z++) {
      const rim = Math.abs(x - px) === 11 || Math.abs(z - pz) === 11;
      P.push(x, py - 3, z, 1);
      for (let y = py - 2; y <= py; y++) P.push(x, y, z, rim ? 1 : 5);
      for (let y = py + 1; y <= py + 8; y++) P.push(x, y, z, 0);
    }
    W.setBlocks(P);
    return { x0, z0, gy, hy, px, pz, py };
  });
  // Turns the truck's view so the crosshair is on the point, then a step.
  const aimAt = (pt) =>
    v((g, pt) => {
      const t = window.__t;
      for (let k = 0; k < 3; k++) {
        t.updateCamera(g.camera, 1 / 30);
        const d = new g.THREE.Vector3(pt[0], pt[1], pt[2]).sub(t._cam).normalize();
        t.lookYaw = Math.atan2(-d.x, -d.z);
        t.lookPitch = Math.asin(d.y) + 0.1;
      }
      t.updateCamera(g.camera, 1 / 30);
      t._aimAge = 9;
      g.vehicles.update(1 / 30);
      const a = t.aim;
      // (Where the crosshair, the view's centre, is: the aim's point on the screen.)
      g.camera.updateMatrixWorld();
      const sp = a.point.clone().project(g.camera);
      return { ok: a.ok, why: a.why, capped: a.capped, dist: Math.round(a.dist), p: a.point.toArray().map((n) => Math.round(n * 10) / 10), centre: Math.hypot(sp.x, sp.y) };
    }, pt);
  const hill = await aimAt([S.x0 + 0.5, S.hy + 15, S.z0 - 165.5]);
  assert(hill.ok && Math.abs(hill.p[2] - (S.z0 - 165)) < 1.2 && Math.abs(hill.p[1] - (S.hy + 15)) < 2, `the hill: ${JSON.stringify(hill)}`);
  assert(hill.centre < 0.02, `the aim is the crosshair's point (the view's centre): ${hill.centre}`);
  // The marker as a frame draws it (the HUD's ask, then the camera's), not
  // waiting on the game's loop (a slow machine may sit behind a menu).
  const drawn = () =>
    v((g) => {
      const t = window.__t;
      t.hud();
      t.updateCamera(g.camera, 1 / 30);
      return { ring: !!t._mark?.parent, label: t._label?.style.display, text: t._label?.textContent, color: t._label?.style.color };
    });
  const shown = await drawn();
  assert(shown && shown.ring && shown.label === "block" && /^\d+ m$/.test(shown.text), `the ring and the readout: ${JSON.stringify(shown)}`);
  await shot("tel-hill");
  const water = await aimAt([S.px + 0.5, S.py + 0.85, S.pz + 0.5]);
  assert(water.ok && Math.abs(water.p[1] - (S.py + 0.85)) < 0.3 && Math.abs(water.p[0] - (S.px + 0.5)) < 1.5, `the water's surface: ${JSON.stringify(water)} (${JSON.stringify(S)})`);
  await frames(4);
  await shot("tel-water");
  const far = await v((g) => {
    const t = window.__t;
    t.lookYaw = 0.6;
    t.lookPitch = 0.3;
    t._aimAge = 9;
    g.vehicles.update(1 / 30);
    return { ok: t.aim.ok, capped: t.aim.capped, dist: Math.round(t.aim.dist) };
  });
  assert(far.ok && far.capped && far.dist === 2000, `over the horizon: the full reach: ${JSON.stringify(far)}`);
  const farText = (await drawn()).text;
  assert(/MAX RANGE/.test(farText), `the readout says it's the full reach: ${farText}`);
  await shot("tel-far");
  const near = await aimAt([S.x0 + 0.5, S.gy + 1, S.z0 - 7]);
  assert(!near.ok && near.why === "near", `too close: ${JSON.stringify(near)}`);
  const fire = () =>
    v((g) => {
      const msgs = [];
      const om = g.vehicles.onMessage;
      g.vehicles.onMessage = (m) => (msgs.push(m), om?.(m));
      g.vehicles.input.pressed.add("mouse0");
      g.vehicles.update(1 / 30);
      g.vehicles.onMessage = om;
      return { msgs, state: window.__t.state, target: window.__t.target?.toArray() };
    });
  const no = await fire();
  assert(no.state === "travel" && no.msgs.some((m) => /too close/i.test(m) && /120 m/.test(m)), `refused, saying why: ${JSON.stringify(no)}`);
  await frames(3);
  await shot("tel-near");
  await aimAt([S.x0 + 0.5, S.hy + 15, S.z0 - 165.5]);
  const go = await fire();
  assert(go.state === "jacks" && go.msgs.some((m) => /LAUNCH/.test(m)) && Math.abs(go.target[2] - (S.z0 - 165)) < 1.2, `launched at the hill: ${JSON.stringify(go)}`);
  await v(() => (window.__t.lookYaw += 0.12));
  const amber = await drawn();
  assert(/^TARGET/.test(amber.text) && /255, 195, 90/.test(amber.color), `the launch's target, amber: ${JSON.stringify(amber)}`);
  await shot("tel-launching");
  const gone = await v((g) => {
    window.__t.abort();
    g.vehicles.exit({ force: true });
    return { ring: !!window.__t._mark?.parent, label: window.__t._label.style.display };
  });
  assert(!gone.ring && gone.label === "none", `hidden once out: ${JSON.stringify(gone)}`);
  await v((g) => g.vehicles.remove(window.__t));
});

// ---------- The fighter HUD ----------

await check("the fighter HUD is compact (Round 12's lock box) at 1920x1080, 1280x720 and 800x500; seek, locking, locked, the missile warning", async () => {
  await play();
  await v(async (g) => {
    const { FighterHud } = await import("./js/fighter-hud.js");
    window.__FH = FighterHud;
    if (g.vehicles.active) g.vehicles.exit({ force: true });
    for (const j of [...g.vehicles.vehicles]) g.vehicles.remove(j);
    g.ufos.clear();
    const p = g.player.position;
    const jet = g.vehicles.create("jet", { jetType: "f22", pos: [p.x, 200, p.z], yaw: 0, airborne: true, speed: 150, throttle: 0.7 });
    g.vehicles.enter(jet);
    window.__j = jet;
    const T = g.THREE;
    window.__keep = () => {
      const u = window.__u;
      if (!u) return;
      const f = new T.Vector3(0, 0, -1).applyQuaternion(jet.aimQ);
      const side = new T.Vector3(1, 0, 0).applyQuaternion(jet.aimQ);
      u.pos.copy(jet.pos).addScaledVector(f, 450).addScaledVector(side, 20);
      u.vel.set(0, 0, 0);
      u.health = u.maxHealth;
      jet.pos.y = 200;
    };
    window.__hk = setInterval(() => window.__keep(), 16);
    // A frame of the HUD as main.js draws it (not waiting on the game's loop:
    // a slow machine may sit behind a menu, where the loop hides the HUD).
    window.__hudNow = (steps = 0) => {
      for (let i = 0; i < steps; i++) {
        window.__keep();
        g.vehicles.update(1 / 30);
      }
      window.__keep();
      jet.updateCamera(g.camera, 1 / 30);
      g.camera.updateMatrixWorld();
      const H = window.__FH.last;
      H.update({ vehicle: jet, camera: g.camera, overlay: jet.overlay(g.camera) });
      return H;
    };
    const orig = jet.overlay.bind(jet);
    jet.overlay = (cam) => {
      const o = orig(cam);
      if (window.__threat && o.hud) o.hud.threat = { pos: jet.pos.clone().add(new T.Vector3(-200, -20, 300)), dist: 300, kind: "missile" };
      return o;
    };
  });
  const out = [];
  for (const [w, h] of [[1920, 1080], [1280, 720], [800, 500]]) {
    await page.setViewportSize({ width: w, height: h });
    await play();
    await v((g) => {
      g.ufos.clear();
      window.__u = null;
      window.__j.lock.target = null;
    });
    const seek = await until(() => {
      const H = window.__hudNow(1);
      return H.state === "seek" && { ring: H.ring, s: H.s };
    }, null, 60000);
    assert(seek && seek.ring > 4 && seek.ring <= 22 * seek.s + 0.01, `${w}x${h}: the seeker ring is small: ${JSON.stringify(seek)}`);
    await v((g) => {
      const p = window.__j.pos;
      window.__u = g.ufos.spawn({ design: "saucer", size: "medium", pos: new g.THREE.Vector3(p.x, 200, p.z - 450) });
      window.__keep();
    });
    const building = await until(() => {
      const j = window.__j;
      const H = window.__hudNow(4);
      if (j.lock.t > 0.7) j.lock.t = 0.7;
      return document.getElementById("fighter-hud").dataset.state === "locking" && H.box.ok && { size: H.box.size, s: H.s };
    }, null, 60000);
    assert(building && building.size >= 30 * building.s && building.size <= 66 * building.s, `${w}x${h}: the box while it builds: ${JSON.stringify(building)}`);
    await shot(`hud-${w}x${h}-locking`);
    const locked = await until(() => {
      const H = window.__hudNow(10);
      return document.getElementById("fighter-hud").dataset.state === "locked" && { size: H.box.size, s: H.s };
    }, null, 60000);
    // (32 once eased in; up to 15% more on the first frame it shows.)
    assert(locked && locked.size >= 30 * locked.s && locked.size <= 37 * locked.s + 0.5, `${w}x${h}: the locked box, small: ${JSON.stringify(locked)}`);
    await shot(`hud-${w}x${h}-locked`);
    await v(() => (window.__threat = true));
    const warn = await until(() => window.__hudNow(0) && document.getElementById("fighter-hud").dataset.warn === "missile", null, 30000);
    assert(warn, `${w}x${h}: the missile warning`);
    await shot(`hud-${w}x${h}-missile`);
    await v(() => (window.__threat = false));
    out.push([w, h, building.size.toFixed(1), locked.size.toFixed(1), seek.ring.toFixed(1)]);
  }
  console.log(`        sizes (w, h, building box, locked box, seeker ring): ${JSON.stringify(out)}`);
  await v((g) => {
    clearInterval(window.__hk);
    g.ufos.clear();
    g.vehicles.exit({ force: true });
  });
});

const passed = results.filter((r) => r[1]).length;
console.log(`\n${passed}/${results.length} passed${errors.length ? `; console errors: ${errors.slice(0, 5).join(" | ")}` : ""}`);
await browser.close();
server.close();
process.exit(passed === results.length ? 0 : 1);
