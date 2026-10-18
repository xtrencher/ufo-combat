// Round 12 "feel" tests: boots the real game in headless Chromium (software
// WebGL, Low preset) and checks:
//  - a cactus hurts on touch (1 every 0.5 s, vanilla): walked into from the
//    side, stood on, landed on, bumped from below; in a Survival world and
//    in a Missions world; never in Creative; not from a diagonal edge one
//    block down; an item lying against a cactus is destroyed;
//  - pickup as vanilla's: items a block and a bit to the side of a sprint are
//    picked up on the way past (the check sweeps the frame's move), a mined
//    drop waits 0.5 s, a thrown one 2 s; the item flies into the player;
//  - the jet's flares go as a salvo, one every 0.1 s, left and right in
//    turn, and missiles are still fooled by them (any flare of the salvo);
//  - F5 cycles first person -> behind -> in front -> first person: the body
//    shows in third person, the camera stays 4 blocks off in the open and
//    comes in when a wall is behind, the crosshair hides in front view;
//  - vanilla's field of view (sprinting x1.15) and the death screen's score;
//  - screenshots of third person behind and in front (--shots=dir).
//
//   node r12-feel-tests.mjs [--only=substring] [--shots=dir]
//
// Like the other suites, it fails on any console error or page error.
import http from "node:http";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";

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
const PORT = 9800 + Math.floor(Math.random() * 40);
const SEED = 4711;
const MISSIONS_SEED = 42;
const SHOTS = args.shots ? path.resolve(String(args.shots)) : null;
if (SHOTS) fs.mkdirSync(SHOTS, { recursive: true });
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
const results = [];
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome",
  args: ["--use-gl=swiftshader", "--enable-webgl", "--ignore-gpu-blocklist", "--no-sandbox", "--disable-dev-shm-usage", "--autoplay-policy=no-user-gesture-required"],
});
const localThreeRoot = path.join(__dirname, "node_modules", "three");
const peerjsFile = path.join(__dirname, "node_modules", "peerjs", "dist", "peerjs.min.js");
const ctx = await browser.newContext({ viewport: { width: 960, height: 540 } });
const page = await ctx.newPage();
await page.route("https://cdn.jsdelivr.net/npm/three@0.160.0/**", (route) => {
  const rel = new URL(route.request().url()).pathname.replace("/npm/three@0.160.0/", "");
  route.fulfill({ path: path.join(localThreeRoot, rel), contentType: "text/javascript" });
});
await page.route("https://cdn.jsdelivr.net/npm/peerjs@1.5.4/**", (route) => route.fulfill({ path: peerjsFile, contentType: "text/javascript" }));
page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
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
const v = (fn, arg) => page.evaluate(([src, a]) => new Function("g", "arg", `return (${src})(g, arg);`)(window.__ufo, a), [fn.toString(), arg]);
// tt(fn, arg): fn(game, tools, arg) in the page.
const tt = (fn, arg) => page.evaluate(([src, a]) => new Function("g", "t", "arg", `return (${src})(g, t, arg);`)(window.__ufo, window.__t, a), [fn.toString(), arg]);

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
  while (Date.now() - t0 < 420000) {
    const st = await v((g) => g.gameState);
    if (st === "playing") return;
    if (st === "dead") {
      await v((g) => g.respawn());
      continue;
    }
    // (A slow, shared machine draws a frame every second or two: the click's checks need time.)
    if (st === "start") await page.click("#play-btn", { timeout: 60000 }).catch(() => {});
    else if (await page.isVisible("#resume-btn")) await page.click("#resume-btn", { timeout: 3000 }).catch(() => {});
    else if (await page.isVisible("#click-to-play").catch(() => false)) await page.click("#click-to-play", { timeout: 3000 }).catch(() => {});
    else {
      await page.mouse.click(300, 200);
      await frames(5);
    }
    await frames(3);
  }
  throw new Error(`the game didn't start playing (state ${await v((g) => g.gameState)})`);
}

// The test's tools, in the page: an arena (a stone floor high in the air,
// clear above) and run(seconds) stepping the player and the dropped items
// in 0.05 s steps without drawing (the machine draws 1-2 frames a second).
async function installTools() {
  await page.evaluate(async () => {
    const g = window.__ufo;
    const { BLOCK } = await import("./js/blocks.js");
    const Y = 100;
    const t = {
      BLOCK,
      Y,
      x0: Math.floor(g.spawn.x),
      z0: Math.floor(g.spawn.z),
      calm() {
        g.mobs.hostileSpawning = false;
        g.mobs.removeHostiles();
        g.sky.locked = true;
        g.sky.setHours(12);
        if (g.ufos) {
          g.ufos.enabled = false;
          g.ufos.clear?.();
        }
      },
      // A 48 x 9 stone floor at y = Y, air for 8 above.
      arena() {
        const { x0, z0 } = t;
        g.world.prepareArea(x0 + 20, z0, 2);
        const list = [];
        for (let x = x0 - 4; x <= x0 + 44; x++) {
          for (let z = z0 - 4; z <= z0 + 4; z++) {
            list.push(x, Y, z, BLOCK.STONE);
            for (let y = Y + 1; y <= Y + 8; y++) list.push(x, y, z, BLOCK.AIR);
          }
        }
        g.world.setBlocks(list);
        g.entities.clear();
        t.place(x0 + 0.5, Y + 1, z0 + 0.5);
      },
      place(x, y, z, yaw = -Math.PI / 2) {
        const p = g.player;
        p.position.set(x, y, z);
        p.velocity.set(0, 0, 0);
        p.knockback.set(0, 0, 0);
        p.yaw = yaw; // (-PI/2: facing +X)
        p.pitch = 0;
        p.keys.clear();
        p.sprinting = false;
        p.fireTime = 0;
        p.resetFall();
        p.health = 20;
        p.absorption = 0;
        p._invulnerable = 0;
        p._lastDamage = 0;
        p.food = 20;
        p.saturation = 0;
        p.update(0.05);
      },
      run(seconds, each) {
        const n = Math.round(seconds / 0.05);
        for (let i = 0; i < n; i++) {
          g.player.update(0.05);
          g.entities.update(0.05, g.player);
          if (each && each(i) === false) break;
        }
      },
      set(x, y, z, id) {
        g.world.setBlock(x, y, z, id);
      },
    };
    window.__t = t;
    t.calm();
  });
}
let booted = null;
async function boot(type) {
  if (booted === type) return;
  await page.goto(`http://127.0.0.1:${PORT}/index.html?seed=${type === "survival" ? SEED : MISSIONS_SEED}&type=${type}&graphics=low`, { waitUntil: "load", timeout: 60000 });
  await page.waitForFunction(() => !!window.__ufo, null, { timeout: 90000 });
  await page.waitForFunction(() => window.__ufo.graphicsReady, null, { timeout: 120000 });
  await play();
  await installTools();
  booted = type;
}

// The cactus scenarios, in the world booted: the health left after each.
// (A Survival world's cactus stands only on sand, with nothing beside it: the
// one bumped from below hangs in the air, so that one is a Missions world's.)
const cactusRun = (below) =>
  tt(
    (g, t, below) => {
      t.arena();
      const { x0, z0, Y } = t;
      const C = t.BLOCK.CACTUS;
      const p = g.player;
      const out = {};
      // A cactus (on sand) 3 blocks ahead: walk into it.
      t.set(x0 + 4, Y, z0, t.BLOCK.SAND);
      t.set(x0 + 4, Y + 1, z0, C);
      t.place(x0 + 1.5, Y + 1, z0 + 0.5);
      p.keys.add("KeyW");
      t.run(1.5);
      p.keys.clear();
      out.side = { hp: p.health, x: +(p.position.x - x0).toFixed(3) };
      // Standing on it (on top of a column of two).
      t.set(x0 + 4, Y + 2, z0, C);
      t.place(x0 + 4.5, Y + 3, z0 + 0.5);
      t.run(1.02);
      out.top = { hp: p.health, y: +(p.position.y - Y).toFixed(3) };
      // Falling onto it from 2 blocks up (too low for fall damage).
      t.place(x0 + 4.5, Y + 5, z0 + 0.5);
      p._invulnerable = 0;
      t.run(0.6);
      out.fall = { hp: p.health, y: +(p.position.y - Y).toFixed(3) };
      // Bumped from below: jumping into a cactus overhead.
      if (below) {
        t.set(x0 + 8, Y + 3, z0, C);
        t.place(x0 + 8.5, Y + 1, z0 + 0.5);
        p.keys.add("Space");
        t.run(0.6);
        p.keys.clear();
        out.below = { hp: p.health };
        t.set(x0 + 8, Y + 3, z0, t.BLOCK.AIR);
      }
      // A block down and beside (a cactus top at the feet's level, by the
      // column stood on), touched only at an edge: no hurt.
      t.set(x0 + 12, Y + 1, z0, t.BLOCK.STONE);
      t.set(x0 + 13, Y, z0 + 1, t.BLOCK.SAND);
      t.set(x0 + 13, Y + 1, z0 + 1, C);
      t.place(x0 + 12.69, Y + 2, z0 + 0.69);
      t.run(1.02);
      out.edge = { hp: p.health, cactus: g.world.getBlock(x0 + 13, Y + 1, z0 + 1) === C };
      // An item lying against a cactus's side is destroyed (after its first 0.5 s).
      t.set(x0 + 16, Y, z0, t.BLOCK.SAND);
      t.set(x0 + 16, Y + 1, z0, C);
      const it = g.entities.spawn(t.BLOCK.DIRT, 1, new g.THREE.Vector3(x0 + 15.73, Y + 1, z0 + 0.5), new g.THREE.Vector3(0, 0, 0), { pickupDelay: 99 });
      const kept = g.entities.spawn(t.BLOCK.DIRT, 1, new g.THREE.Vector3(x0 + 15.3, Y + 1, z0 + 0.5), new g.THREE.Vector3(0, 0, 0), { pickupDelay: 99 });
      t.place(x0 + 0.5, Y + 1, z0 - 3.5);
      t.run(0.4);
      const young = g.entities.items.includes(it);
      t.run(0.4);
      out.item = { young, gone: !g.entities.items.includes(it), kept: g.entities.items.includes(kept) };
      return out;
    },
    below
  );

await check("a cactus hurts on touch in a Survival world: from the side, on top, landing, from below; not at a diagonal edge; it destroys an item", async () => {
  await boot("survival");
  const r = await cactusRun(false);
  // (1 every 0.5 s: walking 2.2 blocks at 4.6 b/s takes ~0.5 s, then a second against it.)
  assert(r.side.hp >= 16 && r.side.hp <= 18 && r.side.x > 3.69 && r.side.x < 3.71, `walking into it: ${JSON.stringify(r)}`);
  assert(r.top.hp === 17 || r.top.hp === 18, `standing on it (1 every 0.5 s): ${JSON.stringify(r)}`);
  assert(r.fall.hp <= 19 && r.fall.y > 2.99 && r.fall.y < 3.01, `landing on it: ${JSON.stringify(r)}`);
  assert(r.edge.hp === 20 && r.edge.cactus, `a block down at an edge doesn't hurt: ${JSON.stringify(r)}`);
  assert(r.item.young && r.item.gone && r.item.kept, `an item against a cactus is destroyed: ${JSON.stringify(r)}`);
});

await check("a cactus doesn't hurt in Creative", async () => {
  await boot("survival");
  const r = await tt((g, t) => {
    g.setMode("creative");
    t.arena();
    const { x0, z0, Y } = t;
    t.set(x0 + 4, Y, z0, t.BLOCK.SAND);
    t.set(x0 + 4, Y + 1, z0, t.BLOCK.CACTUS);
    t.place(x0 + 3.69, Y + 1, z0 + 0.5);
    t.run(1.05);
    const hp = g.player.health;
    g.setMode("survival");
    return hp;
  });
  assert(r === 20, `creative: ${r}`);
});

await check("pickup as vanilla's: sprinting past items a block and a bit aside takes them all; a mined drop waits 0.5 s, a thrown one 2 s", async () => {
  await boot("survival");
  const r = await tt((g, t) => {
    t.arena();
    const { x0, z0, Y } = t;
    const p = g.player;
    const V3 = g.THREE.Vector3;
    g.inventory.clear();
    // Five items 1.35 blocks to the side of the sprint line (z0 + 0.5), and two 1.3 ahead-and-aside.
    const items = [];
    for (let k = 0; k < 5; k++) items.push(g.entities.spawn(t.BLOCK.DIRT, 1, new V3(x0 + 6 + k * 5, Y + 1, z0 + 0.5 + (k % 2 ? 1.35 : -1.35)), new V3(0, 0, 0), { pickupDelay: 0 }));
    t.place(x0 + 0.5, Y + 1, z0 + 0.5);
    p.keys.add("KeyW");
    p.sprinting = true;
    t.run(5.4, () => {
      p.sprinting = true;
    });
    p.keys.clear();
    p.sprinting = false;
    const taken = items.filter((it) => !g.entities.items.includes(it)).length;
    const inv = g.inventory.count?.(t.BLOCK.DIRT) ?? null;
    const ran = +(p.position.x - x0).toFixed(1);
    // A drop at the feet: not before 0.5 s.
    t.place(x0 + 0.5, Y + 1, z0 + 0.5);
    const d = g.entities.spawn(t.BLOCK.STONE, 1, new V3(x0 + 0.5, Y + 1.2, z0 + 0.5), new V3(0, 0, 0));
    t.run(0.4);
    const early = g.entities.items.includes(d);
    t.run(0.2);
    const late = g.entities.items.includes(d);
    const flying = g.entities._flying.length;
    // A throw (Q): not back in hand before 2 s.
    g.interaction.throwStack({ id: t.BLOCK.SAND, count: 1 });
    const th = g.entities.items[g.entities.items.length - 1];
    th.pos.set(x0 + 0.5, Y + 1, z0 + 0.5);
    th.vel.set(0, 0, 0);
    t.run(1.8);
    const thrownEarly = g.entities.items.includes(th);
    t.run(0.4);
    const thrownLate = g.entities.items.includes(th);
    return { taken, inv, ran, early, late, flying, thrownEarly, thrownLate };
  });
  assert(r.taken === 5, `sprinting past: ${JSON.stringify(r)}`);
  assert(r.early === true && r.late === false, `a drop's 0.5 s: ${JSON.stringify(r)}`);
  assert(r.flying >= 1, `the item flies into the player: ${JSON.stringify(r)}`);
  assert(r.thrownEarly === true && r.thrownLate === false, `a throw's 2 s: ${JSON.stringify(r)}`);
});

await check("the view: sprinting widens it x1.15, a drawn bow narrows it (vanilla)", async () => {
  await boot("survival");
  const r = await tt((g, t) => {
    t.arena();
    const p = g.player;
    const base = p.baseFov;
    p.sprinting = true;
    const sprint = p._fovTarget();
    p.sprinting = false;
    p.bowDraw = 1;
    const bow = p._fovTarget();
    p.bowDraw = 0;
    return { base, sprint, bow, walk: p._fovTarget() };
  });
  assert(Math.abs(r.sprint - r.base * 1.15) < 0.01 && Math.abs(r.bow - r.base * 0.85) < 0.01 && r.walk === r.base, JSON.stringify(r));
});

await check("F5: first person -> behind -> in front -> first person; the body shows, the camera keeps 4 blocks off (less with a wall behind), the crosshair hides in front", async () => {
  await boot("survival");
  await tt((g, t) => {
    t.arena();
    t.place(t.x0 + 20.5, t.Y + 1, t.z0 + 0.5, -Math.PI / 2);
    g.player.pitch = -0.25;
  });
  const states = [];
  for (let k = 0; k < 4; k++) {
    await frames(2);
    states.push(
      await v((g) => {
        const p = g.player;
        const eye = p.getEyePosition();
        return { mode: p.cameraMode, third: p.thirdPerson, body: g.avatar.root.visible, dist: +g.camera.position.distanceTo(eye).toFixed(2), cross: document.getElementById("crosshair").style.opacity };
      })
    );
    if (k === 1 && SHOTS) await page.screenshot({ path: path.join(SHOTS, "third-behind.png") });
    if (k === 2 && SHOTS) await page.screenshot({ path: path.join(SHOTS, "third-front.png") });
    if (k === 1) {
      // (The camera eases out to its 4 blocks: a few more frames.)
      for (let i = 0; i < 20; i++) await v((g) => g.player.syncCamera());
      states[1].dist = await v((g) => +g.camera.position.distanceTo(g.player.getEyePosition()).toFixed(2));
    }
    await page.keyboard.press("F5");
  }
  assert(states.map((s) => s.mode).join() === "0,1,2,0", `the cycle: ${JSON.stringify(states)}`);
  assert(!states[0].third && states[1].third && states[2].third && !states[3].third, `third person: ${JSON.stringify(states)}`);
  assert(!states[0].body && states[1].body && states[2].body, `the body: ${JSON.stringify(states)}`);
  assert(states[1].dist > 3.5 && states[1].dist <= 4.01, `4 blocks behind: ${JSON.stringify(states)}`);
  assert(states[2].cross === "0" && states[1].cross === "" && states[0].cross === "", `the crosshair: ${JSON.stringify(states)}`);
  // A wall 2 blocks behind: the camera comes in front of it.
  const near = await tt((g, t) => {
    const { x0, z0, Y } = t;
    for (let y = Y + 1; y <= Y + 4; y++) for (let z = z0 - 2; z <= z0 + 2; z++) t.set(x0 + 18, y, z, t.BLOCK.STONE);
    const p = g.player;
    p.pitch = 0;
    p.cameraMode = 1;
    for (let i = 0; i < 10; i++) p.syncCamera();
    const d = g.camera.position.distanceTo(p.getEyePosition());
    const cx = g.camera.position.x;
    p.cameraMode = 0;
    p.syncCamera();
    return { d: +d.toFixed(2), cx: +cx.toFixed(2), wall: x0 + 19 };
  });
  assert(near.d < 2 && near.cx > near.wall + 0.1, `pulled in before the wall: ${JSON.stringify(near)}`);
});

await check("a Survival world's death screen shows the score", async () => {
  await boot("survival");
  const r = await tt(async (g, t) => {
    t.arena();
    g.player.xpTotal = 37;
    g.hud.update(0.05, g.player);
    g.player._invulnerable = 0;
    g.player.damage(100, "void");
    const text = document.getElementById("death-score")?.textContent;
    g.respawn();
    return text;
  });
  await play();
  await installTools();
  assert(r === "Score: 37", `the score: ${r}`);
});

await check("a cactus hurts in a Missions world too", async () => {
  await boot("missions");
  const r = await cactusRun(true);
  assert(r.side.hp <= 18 && r.top.hp <= 18 && r.fall.hp <= 19 && r.below.hp <= 19 && r.edge.hp === 20 && r.item.gone, `missions: ${JSON.stringify(r)}`);
});

await check("flares: a salvo of 6, one every 0.1 s, left and right in turn; missiles still go for them", async () => {
  await boot("missions");
  const r = await tt((g, t) => {
    const c = g.player.position;
    const j = g.vehicles.create("jet", { jetType: "f16", pos: [c.x, 160, c.z], yaw: 0, airborne: true, speed: 120, throttle: 1 });
    const decoys = g.lasers.decoys;
    const n0 = decoys.length;
    j._launchFlares();
    const counts = [j.flares.length];
    for (let i = 0; i < 14; i++) {
      j._updateFlares(0.05);
      counts.push(j.flares.length);
    }
    const right = j.right(new g.THREE.Vector3());
    const sides = j.flares.map((d) => Math.sign(d.vel.clone().sub(j.vel.clone().multiplyScalar(0.55)).dot(right)));
    // Missiles from behind, homing on the jet: most turn on a flare (any of the salvo).
    const fwd = j.forward(new g.THREE.Vector3());
    let fooled = 0;
    let onSalvo = 0;
    for (let k = 0; k < 40; k++) {
      const m = { target: { kind: "vehicle", ref: j }, pos: j.pos.clone().addScaledVector(fwd, -300 - k * 5), dir: fwd.clone() };
      j._checkDecoys(m);
      if (m.target.kind === "decoy") {
        fooled++;
        if (j.flares.includes(m.target.ref)) onSalvo++;
      }
    }
    const out = { counts, sides, fooled, onSalvo, added: decoys.length - n0, salvo: j._salvo };
    g.vehicles.remove(j);
    return out;
  });
  assert(r.counts.join() === "1,1,2,2,3,3,4,4,5,5,6,6,6,6,6", `one every 0.1 s: ${JSON.stringify(r)}`);
  assert(r.sides.join() === "-1,1,-1,1,-1,1", `left and right in turn: ${JSON.stringify(r)}`);
  assert(r.fooled >= 26 && r.onSalvo === r.fooled, `decoyed (85% each): ${JSON.stringify(r)}`);
  assert(r.salvo === null && r.added === 6, `the salvo done: ${JSON.stringify(r)}`);
});

const failed = results.filter((r) => !r[1]);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
if (errors.length) console.log(`console errors:\n  ${errors.slice(0, 10).join("\n  ")}`);
await browser.close();
server.close();
process.exit(failed.length || errors.length ? 1 : 0);
