// Round 16 bug-fix tests (track D): a regression check per fixed bug.
// In the browser (a Missions world, so the ground war is there):
// - ground vehicles in water: a tank fords shallow water on the bed (slowly)
//   and stops at deep water; one dropped into deep water sinks, its engine
//   floods (it won't drive) and its driver gets out into the water; the
//   enemy tank, the parked AA vehicle and the missile truck sit on the bed
//   too; Creative won't place one in deep water (shallow is fine);
// - a post between a tank's corners stops it (it drove through);
// - a tank driven off the edge of the world into the void is lost (it
//   floated at the bottom);
// - lava burns a tank (and isn't crushed away by it); a helicopter set
//   down in lava burns (a parked one too: it slept through it);
// - the jet's cockpit view isn't blocked by its own pilot's helmet.
//
//   node r16-bugs-tests.mjs [--only=substring]
// (GAME_ROOT=dir runs another copy of the game.)
import http from "node:http";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";

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

const { chromium } = await import("playwright-core");
const PORT = 9870 + Math.floor(Math.random() * 40);
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
  args: ["--use-gl=swiftshader", "--enable-webgl", "--ignore-gpu-blocklist", "--no-sandbox", "--disable-dev-shm-usage", "--autoplay-policy=no-user-gesture-required"],
});
const ctx = await browser.newContext({ viewport: { width: 960, height: 540 } });
const page = await ctx.newPage();
const localThreeRoot = path.join(__dirname, "node_modules", "three");
await page.route("https://cdn.jsdelivr.net/npm/three@0.160.0/**", (route) => {
  const rel = new URL(route.request().url()).pathname.replace("/npm/three@0.160.0/", "");
  route.fulfill({ path: path.join(localThreeRoot, rel), contentType: "text/javascript" });
});
page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
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
async function play() {
  const t0 = Date.now();
  while (Date.now() - t0 < 300000) {
    const st = await v((g) => g.gameState);
    if (st === "playing") return;
    if (st === "dead") {
      await v((g) => g.respawn());
      continue;
    }
    const click = (sel) => page.evaluate((s) => document.querySelector(s)?.click(), sel).catch(() => {});
    if (st === "start") await click("#play-btn");
    else if (await page.isVisible("#resume-btn")) await click("#resume-btn");
    else await page.mouse.click(300, 200);
    await frames(3);
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

// A flat stone field at y 60 round the player, with a pool ahead (north):
// shallow (1 deep) from 30 to 40 blocks out, deep (4) from 41 to 70; and
// a pit of lava (1 deep) to the east. Loaded chunks; no ground vehicles.
const FIELD = `async (g) => {
  const { BLOCK } = await import("./js/blocks.js");
  const { LAVA } = await import("./js/content/ids.js");
  const p = g.player;
  const x0 = Math.floor(p.position.x), z0 = Math.floor(p.position.z);
  for (let i = 0; i < 200; i++) { let ok = true; for (let z = z0 - 100; z <= z0 + 20; z += 16) for (let x = x0 - 40; x <= x0 + 40; x += 16) if (!g.world.getChunk(x >> 4, z >> 4)) ok = false; if (ok) break; await new Promise((r) => setTimeout(r, 300)); }
  const y = 60;
  const list = [];
  for (let x = x0 - 40; x <= x0 + 40; x++) for (let z = z0 - 100; z <= z0 + 20; z++) {
    const dz = z0 - z;
    const pool = Math.abs(x - x0) < 12 && dz >= 30 && dz <= 70 ? (dz <= 40 ? 1 : 4) : 0;
    const lava = x - x0 >= 20 && x - x0 <= 34 && Math.abs(z - z0 + 10) <= 7 ? 1 : 0;
    for (let k = -6; k < 16; k++) {
      const yy = y + k;
      let id = 0;
      if (pool) id = yy < y - pool ? 1 : yy < y ? BLOCK.WATER : 0;
      else if (lava) id = yy < y - 1 ? 1 : yy < y ? LAVA : 0;
      else id = yy < y ? 1 : 0;
      list.push(x, yy, z, id);
    }
  }
  g.world.setBlocks(list);
  g.player.setMode("creative");
  if (g.vehicles.active) g.vehicles.exit({ force: true });
  for (const v of [...g.vehicles.vehicles]) if (v.isGround || v.isHeli || v.type === "heli") g.vehicles.remove(v);
  p.position.set(x0 + 0.5, y + 0.05, z0 + 0.5);
  p.yaw = 0;
  p.pitch = 0;
  return { x0, y, z0 };
}`;
const field = () => page.evaluate((src) => new Function("g", `return (${src})(g);`)(window.__ufo), FIELD);

await browserCheck("boot: a Missions world", async () => {
  await page.goto(`http://127.0.0.1:${PORT}/index.html?seed=1616&type=missions&graphics=low`, { waitUntil: "load", timeout: 60000 });
  await page.waitForFunction(() => !!window.__ufo && window.__ufo.graphicsReady, null, { timeout: 120000 });
  await play();
  assert(await v((g) => !!g.vehicles.ground && !!g.vehicles.constructor.types.tank), "the ground war is wired in");
});

await browserCheck("a tank fords shallow water on the bed, slowly, and stops at deep water (it drove on the surface)", async () => {
  const f = await field();
  const r = await v(async (g, f) => {
    const { summonTank } = await import("./js/vehicle-tank.js");
    const t = summonTank(g.vehicles, "mbt", new g.THREE.Vector3(f.x0 + 0.5, f.y, f.z0 - 20), 0);
    t.pos.y = f.y;
    g.vehicles.enter(t);
    g.player.keys.add("KeyW");
    let wetY = null;
    let wetSpeed = 0;
    for (let i = 0; i < 30 * 14; i++) {
      g.vehicles.update(1 / 30);
      if (t.inWater && f.z0 - t.pos.z > 32) wetY = Math.min(wetY ?? 1e9, t.pos.y);
    }
    g.player.keys.delete("KeyW");
    const reach = f.z0 - t.pos.z;
    // (Its top speed in the shallows: from a standstill along the pool, west.)
    t.pos.set(f.x0 + 9.5, t.pos.y, f.z0 - 35);
    t.yaw = Math.PI / 2;
    t.speed = 0;
    g.player.keys.add("KeyW");
    for (let i = 0; i < 30 * 3; i++) {
      g.vehicles.update(1 / 30);
      if (t.inWater) wetSpeed = Math.max(wetSpeed, Math.abs(t.speed));
    }
    g.player.keys.delete("KeyW");
    const out = { reach, wetY, wetSpeed, top: t.spec.speed, y: f.y };
    g.vehicles.exit({ force: true });
    return out;
  }, f);
  assert(r.wetY !== null && r.wetY <= r.y - 0.9, `on the bed in the shallows (y ${r.wetY}, the surface ${r.y})`);
  assert(r.wetSpeed < r.top * 0.5, `slow in the water: ${r.wetSpeed.toFixed(1)} of ${r.top}`);
  assert(r.reach > 33 && r.reach < 41, `stopped at the deep water (the deep starts 41 out, the hull's half 4): reached ${r.reach.toFixed(1)}`);
});

await browserCheck("a tank dropped into deep water sinks, its engine floods (no driving), its driver gets out into the water", async () => {
  const f = await field();
  const r = await v(async (g, f) => {
    const { summonTank } = await import("./js/vehicle-tank.js");
    const t = summonTank(g.vehicles, "tiger", new g.THREE.Vector3(f.x0 + 0.5, f.y + 2, f.z0 - 55), 0);
    g.vehicles.enter(t);
    g.player.keys.add("KeyW");
    const z0 = t.pos.z;
    for (let i = 0; i < 30 * 5; i++) g.vehicles.update(1 / 30);
    g.player.keys.delete("KeyW");
    const out = { y: t.pos.y, flooded: !!t.flooded, moved: Math.abs(t.pos.z - z0), warning: t.hud().warning, alive: t.alive };
    g.vehicles.exit({});
    const { IS_WET } = await import("./js/blocks.js");
    const p = g.player.position;
    out.out = !g.vehicles.active;
    out.swim = !!IS_WET[g.world.getBlock(Math.floor(p.x), Math.floor(p.y + 0.5), Math.floor(p.z))];
    return out;
  }, f);
  assert(r.y <= f.y - 3.9, `on the bed (y ${r.y}, the bed ${f.y - 4})`);
  assert(r.flooded && r.moved < 0.5 && /flooded/i.test(r.warning), `flooded, not driving: ${JSON.stringify(r)}`);
  assert(r.out && r.swim, `out and in the water: ${JSON.stringify(r)}`);
});

await browserCheck("the enemy tank, the parked AA vehicle and the missile truck sit on the bed in water too", async () => {
  const f = await field();
  const r = await v(async (g, f) => {
    const at = [f.x0 + 0.5, f.y, f.z0 - 36];
    const e = g.vehicles.ground.spawnTank(at, 0, { kind: "mbt", force: true });
    const aa = g.vehicles.create("aapark", { pos: [f.x0 - 6.5, f.y, f.z0 - 36], yaw: 0 });
    const tel = g.vehicles.create("tel", { pos: [f.x0 + 7.5, f.y, f.z0 - 36], yaw: 0 });
    for (let i = 0; i < 60; i++) g.vehicles.update(1 / 30);
    return [e, aa, tel].map((u) => (u ? +u.pos.y.toFixed(2) : null));
  }, f);
  for (const y of r) assert(y !== null && y <= f.y - 0.9, `on the bed (the bed ${f.y - 1}): ${JSON.stringify(r)}`);
});

await browserCheck("Creative won't place a ground vehicle in deep water; shallow water is fine", async () => {
  const f = await field();
  const r = await v((g, f) => {
    const msgs = [];
    const say = g.vehicles.onMessage;
    g.vehicles.onMessage = (t) => msgs.push(t);
    g.player.position.set(f.x0 + 0.5, f.y + 0.05, f.z0 - 15);
    g.player.yaw = 0;
    const deep = g.vehicles.summonOnGround("mbt", { x: f.x0 + 0.5, y: f.y, z: f.z0 - 55 });
    const shallow = g.vehicles.summonOnGround("mbt", { x: f.x0 + 0.5, y: f.y, z: f.z0 - 35 });
    g.vehicles.onMessage = say;
    return { deep: !!deep, shallow: !!shallow, msgs };
  }, f);
  assert(!r.deep && r.msgs.some((m) => /deep water/i.test(m)), `refused in deep water: ${JSON.stringify(r)}`);
  assert(r.shallow, `placed in the shallows: ${JSON.stringify(r)}`);
});

await browserCheck("a post between a tank's corners stops it (it drove through)", async () => {
  const f = await field();
  const r = await v(async (g, f) => {
    const { summonTank } = await import("./js/vehicle-tank.js");
    // (A four-block post 0.4 to 1.4 right of the tank's centre line, 10 blocks ahead: between its corner probes.)
    const l = [];
    for (let k = 0; k < 4; k++) l.push(f.x0, f.y + k, f.z0 - 25, 1);
    g.world.setBlocks(l);
    const t = summonTank(g.vehicles, "mbt", new g.THREE.Vector3(f.x0 - 0.4, f.y, f.z0 - 10), 0);
    t.pos.y = f.y;
    g.vehicles.enter(t);
    g.player.keys.add("KeyW");
    for (let i = 0; i < 30 * 5; i++) g.vehicles.update(1 / 30);
    g.player.keys.delete("KeyW");
    const reach = f.z0 - t.pos.z;
    // Backing away from it still works.
    g.player.keys.add("KeyS");
    for (let i = 0; i < 30 * 2; i++) g.vehicles.update(1 / 30);
    g.player.keys.delete("KeyS");
    const back = f.z0 - t.pos.z;
    g.vehicles.exit({ force: true });
    return { reach, back };
  }, f);
  assert(r.reach < 21, `stopped by the post (its face 24 out, the hull's front 3.3): reached ${r.reach.toFixed(1)}`);
  assert(r.back < r.reach - 1, `backs away: ${JSON.stringify(r)}`);
});

await browserCheck("a tank driven off the edge of the world into the void is lost (it floated at the bottom)", async () => {
  const f = await field();
  const r = await v(async (g, f) => {
    const { summonTank } = await import("./js/vehicle-tank.js");
    // (A hole to the bottom of the world, the bedrock too, 12 blocks south.)
    const l = [];
    for (let x = f.x0 - 8; x <= f.x0 + 8; x++) for (let z = f.z0 + 8; z <= f.z0 + 20; z++) for (let y = 0; y < f.y + 2; y++) l.push(x, y, z, 0);
    g.world.setBlocks(l);
    const t = summonTank(g.vehicles, "mbt", new g.THREE.Vector3(f.x0 + 0.5, f.y, f.z0 + 14), 0);
    t.pos.y = f.y + 0.5;
    t.vy = 0;
    for (let i = 0; i < 30 * 8 && t.alive; i++) g.vehicles.update(1 / 30);
    return { alive: t.alive, y: t.pos.y };
  }, f);
  assert(!r.alive && r.y < 0, `lost in the void: ${JSON.stringify(r)}`);
});

await browserCheck("lava burns a tank; a helicopter set down in lava burns", async () => {
  const f = await field();
  const r = await v(async (g, f) => {
    const { summonTank } = await import("./js/vehicle-tank.js");
    const t = summonTank(g.vehicles, "mbt", new g.THREE.Vector3(f.x0 + 23.5, f.y, f.z0 - 14), 0);
    const h0 = t.health;
    for (let i = 0; i < 30 * 3; i++) g.vehicles.update(1 / 30);
    // (Driven through the lava: it stays, it isn't crushed away like grass.)
    const { isLava } = await import("./js/content/nature.js");
    const count = () => { let n = 0; for (let x = f.x0 + 20; x <= f.x0 + 34; x++) for (let z = f.z0 - 17; z <= f.z0 - 3; z++) if (isLava(g.world.getBlock(x, f.y - 1, z))) n++; return n; };
    const lava0 = count();
    g.vehicles.enter(t);
    t.yaw = -Math.PI / 2;
    g.player.keys.add("KeyW");
    for (let i = 0; i < 30 * 1.5; i++) g.vehicles.update(1 / 30);
    g.player.keys.delete("KeyW");
    g.vehicles.exit({ force: true });
    const tank = { lost: h0 - t.health, y: t.pos.y, lava0, lava1: count() };
    g.vehicles.remove(t);
    // (A wider pool of lava for the helicopter's wheels and tail.)
    const { LAVA } = await import("./js/content/ids.js");
    const l = [];
    for (let x = f.x0 + 20; x <= f.x0 + 36; x++) for (let z = f.z0 - 68; z <= f.z0 - 52; z++) l.push(x, f.y - 1, z, LAVA);
    g.world.setBlocks(l);
    const h = g.vehicles.create("heli", { pos: [f.x0 + 28.5, f.y + 1.5, f.z0 - 59.5], yaw: 0 });
    h.settle?.();
    const hh0 = h.health;
    for (let i = 0; i < 30 * 2; i++) g.vehicles.update(1 / 30);
    return { tank, heli: hh0 - h.health, hy: h.pos.y };
  }, f);
  assert(r.tank.lost > 40 && r.tank.y <= f.y - 0.4, `the tank burns in the lava, on its bed: ${JSON.stringify(r)}`);
  assert(r.tank.lava1 >= r.tank.lava0 - 1, `the lava isn't crushed away: ${JSON.stringify(r.tank)}`);
  assert(r.heli > 30, `the helicopter burns: ${JSON.stringify(r)}`);
});

await browserCheck("the jet's cockpit view isn't blocked by its own pilot's helmet", async () => {
  const f = await field();
  const r = await v((g, f) => {
    const out = {};
    for (const jetType of ["f22", "f16"]) {
      const j = g.vehicles.create("jet", { jetType, pos: [f.x0 + 0.5, f.y + 60, f.z0 - 20], yaw: 0, airborne: true, speed: 60, throttle: 0.7 });
      g.vehicles.enter(j);
      while (j.cameraModes[j.cameraMode] !== "cockpit") j.cycleCamera();
      g.vehicles.update(1 / 30);
      j.updateCamera(g.camera, 1 / 30);
      j.root.updateMatrixWorld(true);
      const dir = new g.THREE.Vector3(0, 0, -1).applyQuaternion(g.camera.quaternion);
      const rc = new g.THREE.Raycaster(g.camera.position.clone(), dir, 0, 1.5);
      const hits = rc.intersectObject(j.root, true).filter((h) => h.object.visible && h.object.material?.visible !== false);
      out[jetType] = hits.length ? +hits[0].distance.toFixed(2) : null;
      g.vehicles.exit({ force: true });
      g.vehicles.remove(j);
    }
    return out;
  }, f);
  assert(r.f22 === null && r.f16 === null, `nothing of the jet right in front of the eyes: ${JSON.stringify(r)}`);
});

await browser.close();
server.close();

const failed = results.filter(([, ok]) => !ok);
console.log(`\n${results.length - failed.length} passed, ${failed.length} failed.`);
process.exit(failed.length ? 1 : 0);
