// Round 17, track A: the jets.
// Node: the fighters' faster afterburner top; the super missile's numbers
// (a blast far bigger than a missile's, far smaller than the nuke's, a long
// reload, slower); the SR-71 still unarmed.
// In the browser (Creative, a clear sky):
// - scrapes: a wingtip along a wall at a shallow angle scrapes in the normal
//   world (sparks, a little damage, no bounce, the heading kept); the nose
//   into the wall crashes; so does a wingtip at a steep angle;
// - the super missile: X selects it (and back; 1 / 2 pick), it fires once
//   (one big slow missile), a second click while it reloads fires nothing,
//   it explodes with its big blast (14, looks 46), the HUD shows it;
// - the afterburner: held, latched by a double tap of Shift (on with no key
//   held) and let go by another; much faster with it than without;
// - the lock: an auto aim lock is held while the view stays on the target:
//   the cockpit's view on it while the aim leads in a hard turn, a free
//   look orbiting round it, and a UFO circling close in;
// - no console errors throughout.
//
//   node r17-jets-tests.mjs [--only=substring] [--seed=42]
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

// ---------- Node ----------

const jetSrc = fs.readFileSync(path.join(ROOT, "js/vehicle-jet.js"), "utf8");
const typeLine = (id) => jetSrc.split("\n").find((l) => l.trim().startsWith(`${id}: {`));
const num = (line, k) => Number(new RegExp(`\\b${k}: ([\\d.]+)`).exec(line)?.[1]);

await check("the numbers: the fighters' afterburner top, the super missile's blast, reload and speed; the SR-71 unarmed", async () => {
  assert(num(typeLine("f22"), "mach") >= 1.2 && num(typeLine("f16"), "mach") >= 1.15, "the fighters' afterburner tops");
  assert(/recon: true/.test(typeLine("sr71")) && /missiles: false/.test(typeLine("sr71")), "the SR-71 unarmed");
  assert(/nuke: true/.test(typeLine("b2")), "the B-2 keeps its nuke");
  const block = /export const SUPER_MISSILE = \{([\s\S]*?)\n\};/.exec(jetSrc)?.[1];
  assert(block, "SUPER_MISSILE");
  const S = (k) => Number(new RegExp(`\\b${k}: ([\\d.]+)`).exec(block)?.[1]);
  const nukeSize = Number(/NUKE_DEFAULTS = \{ size: (\d+)/.exec(fs.readFileSync(path.join(ROOT, "js/nuke.js"), "utf8"))?.[1]);
  assert(S("radius") >= 6.5 * 1.8 && S("radius") < nukeSize / 4 && S("look") > S("radius") * 2, `the blast: ${S("radius")} (looks ${S("look")}), the nuke ${nukeSize}`);
  assert(S("reload") >= 10, `a long reload: ${S("reload")}`);
  assert(S("maxSpeed") < 420 && S("speed") < 300, "slower than a missile (420-520)");
  const ab = Number(/const AB_THRUST_PILOT = ([\d.]+)/.exec(jetSrc)?.[1]);
  assert(ab >= 1.8, `a much stronger afterburner: ${ab}`);
});

// ---------- Browser ----------

const { chromium } = await import("playwright-core");
const PORT = 9810 + Math.floor(Math.random() * 40);
const SEED = Number(args.seed ?? 42);
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
    else {
      await page.mouse.click(300, 200);
      await frames(5);
      if ((await v((g) => g.gameState)) === "paused" && !(await page.isVisible("#resume-btn"))) await page.evaluate(() => document.getElementById("pause-menu").classList.remove("hidden"));
    }
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

// A clear sky: Creative, no missions, UFOs, creatures or patrols; a jet in
// the air at height `y` heading north (-Z, or `yaw`), the player in it
// (window.__j).
const sky = async (opts = {}) => {
  await play();
  await v((g, o) => {
    g.testFlags.noMissions = true;
    if (g.player.dead) g.respawn();
    if (g.vehicles.active) g.vehicles.exit({ force: true });
    g.setMode("creative");
    g.ufos.clear();
    g.mobs.clear();
    g.enemyJets.config.count = 0;
    for (const j of [...g.vehicles.vehicles]) g.vehicles.remove(j);
    const p = o.at || [g.player.position.x, o.y ?? 200, g.player.position.z];
    const jet = g.vehicles.create("jet", { jetType: o.type || "f22", pos: p, yaw: o.yaw ?? 0, airborne: true, speed: o.speed ?? 150, throttle: o.throttle ?? 0.7 });
    g.vehicles.enter(jet);
    g.player.keys.clear();
    g.vehicles.input.buttons.fill(false);
    g.vehicles.input.pressed.clear();
    window.__j = jet;
    window.__jetAt = { pos: jet.pos.clone(), q: jet.q.clone(), vel: jet.vel.clone(), throttle: jet.throttle };
    return true;
  }, opts);
  await frames(2);
  // (Back where it was put: the real frames above flew it on.)
  await v(() => {
    const j = window.__j;
    const a = window.__jetAt;
    j.pos.copy(a.pos);
    j.q.copy(a.q);
    j.vel.copy(a.vel);
    j.throttle = a.throttle;
    j._levelAim();
    j._noseAt = null;
    j.health = j.maxHealth;
  });
};

await browserCheck("boot: a world, playing", async () => {
  await page.goto(`http://127.0.0.1:${PORT}/index.html?seed=${SEED}&graphics=low`, { waitUntil: "load", timeout: 60000 });
  await page.waitForFunction(() => !!window.__ufo && window.__ufo.graphicsReady, null, { timeout: 120000 });
  await play();
});

// A stone wall (x0 + 10 .. x0 + 12, y 104 .. 127, 460 long to the north)
// with the air cleared beside it (x0 - 14 .. x0 + 9): a corridor up high.
// (Built again before each use: chunks far from the player are dropped and
// come back as the terrain made them.)
const WALL = `async (g) => {
  const p = g.player.position;
  const x0 = window.__wall?.x0 ?? Math.floor(p.x), z0 = window.__wall?.z0 ?? Math.floor(p.z);
  for (let z = z0 - 480; z <= z0 + 40; z += 16) for (let x = x0 - 16; x <= x0 + 32; x += 16) g.world.prepareArea(x, z, 1);
  const list = [];
  for (let z = z0 - 470; z <= z0 + 20; z++) for (let y = 100; y < 128; y++) {
    for (let x = x0 - 14; x <= x0 + 9; x++) list.push(x, y, z, 0);
    for (let x = x0 + 10; x <= x0 + 12; x++) list.push(x, y, z, y >= 104 ? 1 : 0);
  }
  g.world.setBlocks(list);
  return { x0, z0 };
}`;
let wall = null;

await browserCheck("a scrape in the normal world: a wingtip along a wall at a shallow angle sparks and scrapes, no bounce, no explosion, the heading kept", async () => {
  await play();
  wall = await page.evaluate((src) => new Function("g", `return (${src})(g);`)(window.__ufo), WALL);
  await v((g, w) => (window.__wall = w), wall);
  await sky({ at: [wall.x0 + 10 - 6.2 - 0.6, 116, wall.z0 + 10], yaw: -0.07, speed: 150, throttle: 0.75 });
  const r = await v((g) => {
    const j = window.__j;
    const T = g.THREE;
    const f0 = j.forward(new T.Vector3());
    const hp0 = j.health;
    const sparks0 = g.effects.glow.count ?? null;
    let maxAway = 0; // the most speed away from the wall (-x): a bounce would show here
    let maxKick = 0; // the most the jet moved away from the wall in one step
    let maxHead = 0;
    let lastX = j.pos.x;
    let t = 0;
    const dt = 1 / 30;
    for (; t < 2.5 && j.alive; t += dt) {
      j.pos.y = 116;
      j.vel.y = 0;
      g.vehicles.update(dt);
      maxAway = Math.max(maxAway, -j.vel.x);
      maxKick = Math.max(maxKick, lastX - j.pos.x);
      lastX = j.pos.x;
      maxHead = Math.max(maxHead, j.forward(new T.Vector3()).angleTo(f0));
    }
    return { alive: j.alive, grazes: j.grazes || 0, hurt: hp0 - j.health, maxAway: +maxAway.toFixed(2), maxKick: +maxKick.toFixed(2), maxHead: +maxHead.toFixed(3), last: j.lastGraze, why: j.crashWhy, t: +t.toFixed(2), sparks0, speed: Math.round(j.speed), warn: j.hud().warning };
  });
  console.log(`    ${JSON.stringify(r)}`);
  assert(r.alive, `it scraped and flew on: ${JSON.stringify(r)}`);
  assert(r.grazes > 3, `it touched the wall (scrapes): ${JSON.stringify(r)}`);
  assert(r.hurt > 0 && r.hurt < 60, `a little damage: ${JSON.stringify(r)}`);
  assert(r.maxAway < 1.5, `no bounce off the wall: ${JSON.stringify(r)}`);
  assert(r.maxKick < 0.8, `no kick: eased out of the wall only: ${JSON.stringify(r)}`);
  assert(r.maxHead < 0.12, `the heading kept: ${JSON.stringify(r)}`);
  assert(r.speed > 120, `the speed kept: ${JSON.stringify(r)}`);
});

await browserCheck("the nose into the wall crashes; a wingtip at a steep angle crashes too", async () => {
  assert(wall, "the wall");
  await play();
  await page.evaluate((src) => new Function("g", `return (${src})(g);`)(window.__ufo), WALL);
  // Straight at it (east), a few blocks off.
  await sky({ at: [wall.x0 + 10 - 12, 116, wall.z0 - 150], yaw: -Math.PI / 2, speed: 150, throttle: 0.75 });
  const nose = await v((g) => {
    const j = window.__j;
    const log = [];
    for (let i = 0; i < 30 && j.alive; i++) {
      j.pos.y = 116;
      j.vel.y = 0;
      if (i < 4) log.push([+(j.pos.x - window.__wall.x0).toFixed(1), j.onGround, j.beamHeld, g.vehicles.active === j, j._noseAt ? +(j._noseAt.x - window.__wall.x0).toFixed(1) : null]);
      g.vehicles.update(1 / 30);
    }
    window.__log = log;
    return { alive: j.alive, grazes: j.grazes || 0, why: j.crashWhy, x: j.pos.x - window.__wall.x0, z: j.pos.z - window.__wall.z0, block: g.world.getBlock(window.__wall.x0 + 10, 116, Math.floor(j.pos.z)), chunk: !!g.world.getChunk((window.__wall.x0 + 10) >> 4, Math.floor(j.pos.z) >> 4), pl: [g.player.position.x - window.__wall.x0, g.player.position.z - window.__wall.z0], log: window.__log };
  });
  assert(!nose.alive, `the nose hit crashed: ${JSON.stringify(nose)}`);
  // A wingtip in at 35 degrees: too steep.
  await play();
  await page.evaluate((src) => new Function("g", `return (${src})(g);`)(window.__ufo), WALL);
  await sky({ at: [wall.x0 + 10 - 6.6, 116, wall.z0 - 60], yaw: -0.6, speed: 150, throttle: 0.75 });
  const steep = await v((g) => {
    const j = window.__j;
    const T = g.THREE;
    for (let i = 0; i < 30 && j.alive; i++) {
      j.pos.y = 116;
      j.vel.y = 0;
      g.vehicles.update(1 / 30);
    }
    return { alive: j.alive, last: j.lastGraze, why: j.crashWhy, x: j.pos.x - window.__wall.x0, z: j.pos.z - window.__wall.z0, block: g.world.getBlock(window.__wall.x0 + 10, 116, Math.floor(j.pos.z)), active: g.vehicles.active === j, dead: g.player.dead };
  });
  assert(!steep.alive, `the steep touch crashed: ${JSON.stringify(steep)}`);
  assert(!steep.last || steep.last.ang > 0.28 || steep.last.hits & 3, `crashed for its steep angle (or the nose): ${JSON.stringify(steep)}`);
});

await browserCheck("the super missile: X selects it (1 / 2 pick), one big slow missile, nothing while it reloads, its big blast, the HUD", async () => {
  await sky({ y: 120, speed: 150, throttle: 0.7 });
  const r = await v((g) => {
    const j = window.__j;
    const T = g.THREE;
    const msgs = [];
    const say = g.vehicles.onMessage;
    g.vehicles.onMessage = (t) => msgs.push(t);
    const dt = 1 / 30;
    const press = (code) => {
      g.vehicles.keyDown(code);
      g.vehicles.update(dt);
    };
    const click = () => {
      g.vehicles.mouseDown(2);
      g.vehicles.update(dt);
      g.vehicles.mouseUp(2);
      g.vehicles.update(dt);
    };
    // A normal missile first, for comparison.
    click();
    const mm = j.missiles[j.missiles.length - 1];
    let topN = 0;
    for (let i = 0; i < 40 && mm && j.missiles.includes(mm); i++) {
      j.pos.y = 120;
      j.vel.y = 0;
      g.vehicles.update(dt);
      topN = Math.max(topN, mm.vel.length());
    }
    const w0 = j.weapon;
    press("KeyX");
    const w1 = j.weapon;
    press("KeyX");
    const w2 = j.weapon;
    press("Digit2");
    const w3 = j.weapon;
    const heavies = () => j.missiles.filter((x) => x.heavy).length;
    const n0 = heavies();
    j.missileT = 0;
    // (Fired 25 degrees nose down: it meets the ground ahead.)
    j.q.setFromEuler(new T.Euler(-0.45, 0, 0, "YXZ"));
    click();
    j.q.setFromEuler(new T.Euler(0, 0, 0, "YXZ"));
    j.vel.set(0, 0, -150);
    j._levelAim();
    const m = j.missiles.find((x) => x.heavy);
    const fired = heavies() - n0;
    const heavy = !!m?.heavy;
    const reload = j.superT;
    click(); // (while it reloads: nothing)
    const fired2 = heavies() - n0 + (j.missiles.includes(m) ? 0 : 1);
    // Its flight: slower than a missile's; its blast where it lands.
    let top = 0;
    let boom = null;
    const exps = g.effects.explosionCount;
    for (let i = 0; i < 30 * 20 && j.missiles.includes(m); i++) {
      j.pos.y = 120;
      j.vel.y = 0;
      g.vehicles.update(dt);
      top = Math.max(top, m.vel.length());
    }
    if (g.effects.explosionCount > exps) boom = { ...g.effects.lastExplosion };
    const rings = g.vehicles.airFx.rings.filter((r) => r.mesh.visible).length;
    const hud = j.overlay(g.camera).hud;
    const rows = j.hud().rows.find((x) => x[0] === "Weapon")?.[1];
    press("Digit1");
    const w4 = j.weapon;
    g.vehicles.onMessage = say;
    return { w: [w0, w1, w2, w3, w4], fired, fired2, heavy, reload, top: Math.round(top), topN: Math.round(topN), boom, rings, hudWeapon: hud.weapon, rows, msgs };
  });
  console.log(`    super missile ${r.top} blocks/s (a missile ${r.topN}); blast ${JSON.stringify(r.boom && { radius: r.boom.radius, look: r.boom.look, removed: r.boom.removed, maxDist: +r.boom.maxDist.toFixed(1) })}`);
  assert(r.w.join() === "missile,super,missile,super,missile", `X switches, 1 / 2 pick: ${JSON.stringify(r.w)}`);
  assert(r.fired === 1 && r.heavy && r.reload >= 10, `one heavy missile, a long reload: ${JSON.stringify(r)}`);
  assert(r.fired2 === 1 && r.msgs.some((t) => /reloading/i.test(t)), `nothing while it reloads (a word instead): ${JSON.stringify(r)}`);
  assert(r.top > 150 && r.top < 420 && r.top < r.topN, `slower than a missile: ${JSON.stringify(r)}`);
  assert(r.boom && r.boom.source === "missile" && Math.abs(r.boom.radius - 14) < 0.01 && r.boom.look >= 40, `its big blast: ${JSON.stringify(r.boom)}`);
  assert(r.boom.removed > 1000 && r.boom.maxDist > 10, `a big crater: ${JSON.stringify(r.boom)}`);
  assert(r.rings >= 3, `the blast's extras: ${JSON.stringify(r)}`);
  assert(r.hudWeapon?.super && r.hudWeapon.ready < 1 && /SUPER MISSILE/.test(r.rows), `the HUD: ${JSON.stringify(r)}`);
  // The fighter HUD's canvas shows the selected weapon and its reload.
  await v((g) => window.__j.selectWeapon("super"));
  const st = await until(() => document.getElementById("fighter-hud")?.dataset.weapon === "super-reload" && "ok", null, 20000);
  assert(st === "ok", `the fighter HUD shows the super missile reloading: ${await v(() => document.getElementById("fighter-hud")?.dataset.weapon)}`);
  await v((g) => {
    window.__j.superT = 0;
  });
  const st2 = await until(() => document.getElementById("fighter-hud")?.dataset.weapon === "super" && "ok", null, 20000);
  assert(st2 === "ok", "the fighter HUD shows it ready");
});

await browserCheck("the super missile at a locked UFO: homes on it and hits it hard", async () => {
  await sky({ y: 120, speed: 150, throttle: 0.7 });
  const r = await v((g) => {
    const j = window.__j;
    const T = g.THREE;
    const u = g.ufos.spawn({ design: "saucer", size: "medium", pos: new T.Vector3(j.pos.x, 120, j.pos.z - 500) });
    u.health = u.maxHealth = 5000;
    const f = new T.Vector3(0, 0, -1).applyQuaternion(j.aimQ);
    const dt = 1 / 30;
    for (let t = 0; t < 2.3; t += dt) {
      u.pos.copy(j.pos).addScaledVector(f, 500);
      u.vel.set(0, 0, 0);
      j.pos.y = 120;
      g.vehicles.update(dt);
    }
    const locked = j.lock.locked;
    j.selectWeapon("super");
    g.vehicles.mouseDown(2);
    g.vehicles.update(dt);
    g.vehicles.mouseUp(2);
    g.vehicles.update(dt);
    const m = j.missiles[0];
    const side = new T.Vector3(1, 0, 0).applyQuaternion(j.aimQ);
    const hp0 = u.health;
    let t = 0;
    while (t < 12 && j.missiles.includes(m)) {
      u.vel.copy(side).multiplyScalar(30);
      u.pos.addScaledVector(u.vel, dt);
      j.pos.y = 120;
      g.vehicles.update(dt);
      t += dt;
    }
    return { locked, guided: !!m?.target, heavy: !!m?.heavy, hurt: hp0 - u.health, t: +t.toFixed(2) };
  });
  assert(r.locked && r.guided && r.heavy, `a guided heavy missile: ${JSON.stringify(r)}`);
  assert(r.hurt >= 650, `a hard hit (direct and blast): ${JSON.stringify(r)}`);
});

await browserCheck("the afterburner: held, latched by a double tap of Shift and let go by another; much faster with it", async () => {
  await sky({ y: 200, speed: 200, throttle: 1 });
  const r = await v((g) => {
    const j = window.__j;
    const dt = 1 / 30;
    const fly = (secs) => {
      let top = 0;
      for (let t = 0; t < secs; t += dt) {
        j.pos.y = 200;
        j.vel.y = 0;
        j.throttle = Math.max(j.throttle, 1);
        g.vehicles.update(dt);
        top = Math.max(top, j.speed);
      }
      return top;
    };
    const tap = () => {
      g.vehicles.keyDown("ShiftLeft");
      g.player.keys.add("ShiftLeft");
      g.vehicles.update(dt);
      g.player.keys.delete("ShiftLeft");
      g.vehicles.update(dt);
    };
    // Without it: settles.
    const off = fly(25);
    const accOff = (() => {
      j.vel.setLength(150);
      const s0 = j.speed;
      fly(1);
      return j.speed - s0;
    })();
    // Held.
    g.player.keys.add("ShiftLeft");
    g.vehicles.update(dt);
    const held = { ab: j.afterburner, latch: j.abLatch };
    g.player.keys.delete("ShiftLeft");
    g.vehicles.update(dt);
    const released = { ab: j.afterburner, latch: j.abLatch };
    // A single tap: no latch.
    tap();
    fly(0.6);
    const single = { ab: j.afterburner, latch: j.abLatch };
    // A double tap: latched, on with no key held.
    tap();
    g.vehicles.update(dt);
    tap();
    const latched = { ab: j.afterburner, latch: j.abLatch };
    const hud = j.overlay(g.camera).hud.ab;
    const accOn = (() => {
      j.vel.setLength(150);
      const s0 = j.speed;
      fly(1);
      return j.speed - s0;
    })();
    const on = fly(25);
    const still = { ab: j.afterburner, latch: j.abLatch };
    // Another double tap: off.
    tap();
    g.vehicles.update(dt);
    tap();
    fly(0.5);
    const unlatched = { ab: j.afterburner, latch: j.abLatch };
    // Latched again, then S lets it go.
    tap();
    g.vehicles.update(dt);
    tap();
    const again = j.abLatch;
    g.player.keys.add("KeyS");
    g.vehicles.update(dt);
    g.player.keys.delete("KeyS");
    g.vehicles.update(dt);
    const byS = { ab: j.afterburner, latch: j.abLatch };
    return { off: Math.round(off), on: Math.round(on), accOff: +accOff.toFixed(1), accOn: +accOn.toFixed(1), held, released, single, latched, hud, still, unlatched, again, byS };
  });
  console.log(`    top speed: ${Math.round(r.off * 3.6)} km/h without, ${Math.round(r.on * 3.6)} km/h with it; acceleration at 540 km/h: ${r.accOff} vs ${r.accOn} blocks/s in 1 s`);
  assert(r.held.ab && !r.held.latch && !r.released.ab, `held: on, released: off: ${JSON.stringify(r)}`);
  assert(!r.single.ab && !r.single.latch, `a single tap doesn't latch: ${JSON.stringify(r)}`);
  assert(r.latched.ab && r.latched.latch && r.hud?.on && r.hud.latched, `a double tap latches it on: ${JSON.stringify(r)}`);
  assert(r.still.ab && r.still.latch, `it stays on with no key held: ${JSON.stringify(r)}`);
  assert(!r.unlatched.ab && !r.unlatched.latch, `another double tap lets it go: ${JSON.stringify(r)}`);
  assert(r.again && !r.byS.latch && !r.byS.ab, `S lets it go too: ${JSON.stringify(r)}`);
  assert(r.on > r.off * 1.45, `a much higher top speed with it: ${JSON.stringify(r)}`);
  assert(r.accOn > r.accOff * 1.7, `much stronger acceleration with it: ${JSON.stringify(r)}`);
});

// An auto aim lock made on a UFO ahead (2.3 s): window.__u.
const lockUfo = (y = 200) =>
  v((g, y) => {
    const j = window.__j;
    const T = g.THREE;
    const u = g.ufos.spawn({ design: "saucer", size: "medium", pos: new T.Vector3(j.pos.x, y, j.pos.z - 300) });
    u.health = u.maxHealth = 50000;
    window.__u = u;
    const f = new T.Vector3(0, 0, -1).applyQuaternion(j.aimQ);
    for (let t = 0; t < 2.4; t += 1 / 30) {
      u.pos.copy(j.pos).addScaledVector(f, 300);
      u.vel.set(0, 0, 0);
      j.pos.y = y;
      g.vehicles.update(1 / 30);
    }
    return j.lock.locked && j.lock.auto && j.lock.target?.ref === u;
  }, y);

await browserCheck("the lock holds while the view stays on the target: the cockpit's view on it while the aim leads in a hard turn", async () => {
  await sky({ y: 200, speed: 200, throttle: 0.8 });
  assert(await lockUfo(), "locked");
  const r = await v((g) => {
    const j = window.__j;
    const u = window.__u;
    const T = g.THREE;
    j.cameraMode = j.cameraModes.indexOf("cockpit"); // (the view along the nose)
    const dt = 1 / 30;
    let lost = -1;
    let maxAimOff = 0;
    for (let t = 0; t < 4; t += dt) {
      // A hard turn: the aim swung 1.3 rad (75 degrees) round from the nose
      // and back up, the UFO kept dead ahead of the nose (the cockpit's view).
      const f = j.forward(new T.Vector3());
      u.pos.copy(j.pos).addScaledVector(f, 300);
      u.vel.set(0, 0, 0);
      j.aimQ.copy(j.q).multiply(new T.Quaternion().setFromAxisAngle(new T.Vector3(0, 1, 0), 1.3 * Math.sign(Math.sin(t * 1.3) + 0.01))).multiply(new T.Quaternion().setFromAxisAngle(new T.Vector3(1, 0, 0), 0.4));
      g.vehicles.update(dt);
      maxAimOff = Math.max(maxAimOff, new T.Vector3(0, 0, -1).applyQuaternion(j.aimQ).angleTo(u.pos.clone().sub(j.pos).normalize()));
      if (!(j.lock.locked && j.lock.target?.ref === u) && lost < 0) lost = t;
    }
    j.cameraMode = 0;
    return { lost, maxAimOff: +maxAimOff.toFixed(2), alive: j.alive };
  });
  assert(r.maxAimOff > 1.1, `the aim was far off the target: ${JSON.stringify(r)}`);
  assert(r.lost < 0, `the lock held: ${JSON.stringify(r)}`);
});

await browserCheck("the lock holds while a free look orbits the camera round the target", async () => {
  await sky({ y: 200, speed: 200, throttle: 0.8 });
  assert(await lockUfo(), "locked");
  const r = await v((g) => {
    const j = window.__j;
    const u = window.__u;
    const T = g.THREE;
    const dt = 1 / 30;
    // Both buttons: the free look.
    g.vehicles.mouseDown(2);
    g.vehicles.mouseDown(0);
    for (let i = 0; i < 6; i++) g.vehicles.update(dt);
    const free = j.freeLook;
    const kept = j.lock.locked && j.lock.target?.ref === u;
    let lost = -1;
    // The UFO swings round the jet (the whole way round, 300 blocks out),
    // the free look turned onto it the whole time.
    const c0 = j.pos.clone();
    for (let t = 0; t < 6; t += dt) {
      const a = (t / 6) * Math.PI * 2;
      u.pos.set(j.pos.x - Math.sin(a) * 300, j.pos.y + 40 * Math.sin(a * 2), j.pos.z - Math.cos(a) * 300);
      u.vel.set(0, 0, 0);
      j.pos.y = 200;
      // Where it is, in the jet's own frame: the look's yaw and pitch.
      const local = u.pos.clone().sub(j.pos).applyQuaternion(j.q.clone().invert()).normalize();
      j.lookYaw = Math.atan2(-local.x, -local.z);
      j.lookPitch = Math.asin(Math.max(-1, Math.min(1, local.y)));
      g.vehicles.update(dt);
      if (!(j.lock.locked && j.lock.target?.ref === u) && lost < 0) lost = t;
    }
    const camOff = new T.Vector3(0, 0, -1).applyQuaternion(j.camView).angleTo(u.pos.clone().sub(j.pos).normalize());
    g.vehicles.mouseUp(0);
    g.vehicles.mouseUp(2);
    for (let i = 0; i < 4; i++) g.vehicles.update(dt);
    const after = { free: j.freeLook, locked: j.lock.locked, target: j.lock.target?.ref === u, missiles: j.missiles.length };
    return { free, kept, lost, camOff: +camOff.toFixed(3), after };
  });
  assert(r.free && r.kept, `the free look began with the lock kept: ${JSON.stringify(r)}`);
  assert(r.camOff < 0.15, `the camera stayed on it: ${JSON.stringify(r)}`);
  assert(r.lost < 0, `the lock held all the way round: ${JSON.stringify(r)}`);
  assert(!r.after.free && r.after.locked && r.after.target && r.after.missiles === 0, `after the free look: still locked, nothing fired: ${JSON.stringify(r)}`);
});

await browserCheck("the lock holds with a UFO circling close in (inside 25 blocks) while the aim follows it", async () => {
  await sky({ y: 200, speed: 200, throttle: 0.8 });
  assert(await lockUfo(), "locked");
  const r = await v((g) => {
    const j = window.__j;
    const u = window.__u;
    const T = g.THREE;
    const dt = 1 / 30;
    let lost = -1;
    let minD = 1e9;
    for (let t = 0; t < 3; t += dt) {
      const f = new T.Vector3(0, 0, -1).applyQuaternion(j.aimQ);
      const side = new T.Vector3(1, 0, 0).applyQuaternion(j.aimQ);
      u.pos.copy(j.pos).addScaledVector(f, 18).addScaledVector(side, 6 * Math.sin(t * 3));
      u.vel.set(0, 0, 0);
      j.pos.y = 200;
      g.vehicles.update(dt);
      minD = Math.min(minD, u.pos.distanceTo(j.pos));
      if (!(j.lock.locked && j.lock.target?.ref === u) && lost < 0) lost = t;
    }
    return { lost, minD: +minD.toFixed(1) };
  });
  assert(r.minD < 25 && r.lost < 0, `held close in: ${JSON.stringify(r)}`);
});

await browserCheck("a held lock (the button down) stays on a UFO that turns to flee", async () => {
  await sky({ y: 200, speed: 200, throttle: 0.8 });
  const r = await v((g) => {
    const j = window.__j;
    const T = g.THREE;
    const cfg0 = j.manager.config.jet;
    j.manager.config.jet = { ...(cfg0 || {}), autoAim: false };
    const u = g.ufos.spawn({ design: "saucer", size: "medium", pos: new T.Vector3(j.pos.x, 200, j.pos.z - 300) });
    u.health = u.maxHealth = 50000;
    const dt = 1 / 30;
    g.vehicles.mouseDown(2);
    const f = new T.Vector3(0, 0, -1).applyQuaternion(j.aimQ);
    for (let t = 0; t < 1.5; t += dt) {
      u.pos.copy(j.pos).addScaledVector(f, 300);
      u.vel.set(0, 0, 0);
      j.pos.y = 200;
      g.vehicles.update(dt);
    }
    const locked = j.lock.locked && j.lock.target?.ref === u;
    u.state = "leave";
    for (let t = 0; t < 0.5; t += dt) {
      u.state = "leave";
      u.pos.copy(j.pos).addScaledVector(f, 300);
      g.vehicles.update(dt);
    }
    const still = j.lock.locked && j.lock.target?.ref === u;
    g.vehicles.mouseUp(2);
    g.vehicles.update(dt);
    const fired = j.missiles.length;
    j.manager.config.jet = cfg0;
    return { locked, still, fired };
  });
  assert(r.locked && r.still && r.fired >= 1, JSON.stringify(r));
});

await v((g) => {
  if (g.vehicles.active) g.vehicles.exit({ force: true });
});
await browser.close();
server.close();

const failed = results.filter(([, ok]) => !ok);
console.log(`\n${results.length - failed.length} passed, ${failed.length} failed.`);
process.exit(failed.length ? 1 : 0);
