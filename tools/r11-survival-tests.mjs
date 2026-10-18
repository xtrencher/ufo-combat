// Round 11 survival mechanics (vanilla, in Survival worlds): boots the real
// game in headless Chromium (software WebGL, Low preset) and checks:
//  - a Missions world keeps today's rules (no hunger bar, food heals, free
//    regeneration);
//  - hunger: sprinting drains food over distance, starving stops at the
//    difficulty's floor (Easy 10, Normal 1, Hard none), regeneration needs
//    18 food points (fast with saturation at a full bar), Peaceful refills;
//  - eating bread restores 5 food and 6 saturation (a right click held),
//    a golden apple gives Regeneration II and Absorption, a stew its bowl;
//  - XP: a mined coal ore drops orbs that fly in and fill the bar; death
//    drops 7 a level as orbs and loses the rest;
//  - beds: sleeping at night skips to the morning and sets the spawn, the
//    respawn is at the bed (or the world spawn when it is gone), not by
//    day, not with monsters near;
//  - damage: lava burns (and keeps burning after, water puts it out), a
//    cactus hurts, suffocation in a wall, 15 s of air;
//  - movement: the step up onto a slab, climbing a ladder;
//  - a reload keeps food, XP and the bed;
//  - online (--online; a host and a guest through a local PeerJS server):
//    both must sleep, the count shows, the host skips the night and the
//    guest wakes.
// Blocks other parts own (beds, ladders, lava) are used when their defs are
// in; until then the test marks core or debug blocks with the same flags.
//
//   node r11-survival-tests.mjs [--only=substring] [--online]
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
const PORT = 9760 + Math.floor(Math.random() * 40);
const SEED = 4711;
const MISSIONS_SEED = 42;
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
const page = await newPage("solo");

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
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
// v(p, fn, arg): runs fn(game, arg) in page p (game = window.__ufo).
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

async function ready(p) {
  await p.waitForFunction(() => !!window.__ufo, null, { timeout: 90000 });
  await p.waitForFunction(() => window.__ufo.graphicsReady, null, { timeout: 120000 });
}
async function boot(query, p = page) {
  await p.goto(`http://127.0.0.1:${PORT}/index.html?${query}&graphics=low`, { waitUntil: "load", timeout: 60000 });
  await ready(p);
}
async function play(p = page) {
  const t0 = Date.now();
  while (Date.now() - t0 < 180000) {
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
  throw new Error(`the game didn't start playing (state ${await v(p, (g) => g.gameState)})`);
}

// The test's tools, installed in the page: an arena (a stone floor high in
// the air, clear above), and run(seconds) stepping the player, its bed and
// the XP orbs in 0.05 s steps without drawing (the machine draws 1-2 frames
// a second). Hostile creatures are kept away and the clock is held at noon.
async function installTools(p = page) {
  await p.evaluate(async () => {
    const g = window.__ufo;
    const { BLOCK, BLOCK_INFO } = await import("./js/blocks.js");
    const S = await import("./js/survival.js");
    const ID = await import("./js/content/ids.js");
    const { DEBUG } = await import("./js/content/debug.js");
    const items = await import("./js/items.js");
    const Y = 100;
    const t = {
      BLOCK,
      BLOCK_INFO,
      S,
      ID,
      DEBUG,
      items,
      Y,
      x0: Math.floor(g.spawn.x),
      z0: Math.floor(g.spawn.z),
      calm() {
        g.mobs.hostileSpawning = false;
        g.mobs.removeHostiles();
        g.sky.locked = true;
        g.sky.setHours(12);
      },
      // A 48 x 9 stone floor at y = Y, air for 6 above; the player on it at
      // (x0 + dx + 0.5, z0 + 0.5), facing +X, still and unhurt.
      arena(dx = 0) {
        const { x0, z0 } = t;
        g.world.prepareArea(x0 + 20, z0, 2);
        const list = [];
        for (let x = x0 - 4; x <= x0 + 44; x++) {
          for (let z = z0 - 4; z <= z0 + 4; z++) {
            list.push(x, Y, z, BLOCK.STONE);
            for (let y = Y + 1; y <= Y + 6; y++) list.push(x, y, z, BLOCK.AIR);
          }
        }
        g.world.setBlocks(list);
        t.place(x0 + dx + 0.5, Y + 1, z0 + 0.5);
      },
      place(x, y, z) {
        const p = g.player;
        if (p.sleeping) p.stopSleeping();
        p.position.set(x, y, z);
        p.velocity.set(0, 0, 0);
        p.knockback.set(0, 0, 0);
        p.yaw = -Math.PI / 2; // (facing +X)
        p.pitch = 0;
        p.keys.clear();
        p.sprinting = false;
        p.fireTime = 0;
        p.resetFall();
        p.health = 20;
        p.absorption = 0;
        p.air = 10;
        p._invulnerable = 0;
        p._lastDamage = 0;
        p.clearEffects();
        // (17 food points and no saturation: no healing to blur a hurt's count.)
        p.food = 17;
        p.saturation = 0;
        p.update(0.05); // (settles on the floor)
      },
      run(seconds, each) {
        const n = Math.round(seconds / 0.05);
        for (let i = 0; i < n; i++) {
          g.player.update(0.05);
          g.sleep.update(0.05);
          g.xp.update(0.05);
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
// The Survival world the checks below play in (booted once, so --only works too).
let booted = null;
async function survival() {
  if (booted === "survival") return;
  await boot(`seed=${SEED}&type=survival`);
  await play();
  await installTools();
  booted = "survival";
}

// tt(p, fn, arg): fn(game, tools, arg) in the page.
const tt = (p, fn, arg) => p.evaluate(([src, a]) => new Function("g", "t", "arg", `return (${src})(g, t, arg);`)(window.__ufo, window.__t, a), [fn.toString(), arg]);

// ================= A Missions world =================

await check("a Missions world keeps today's rules: no hunger or XP bar, food heals, free regeneration", async () => {
  await boot(`seed=${MISSIONS_SEED}`);
  await play();
  await installTools();
  booted = "missions";
  await frames(page, 4);
  const r = await tt(page, (g, t) => {
    t.arena();
    const p = g.player;
    const hud = { food: !document.getElementById("food").classList.contains("hidden"), xp: !document.getElementById("xp-bar").classList.contains("hidden") };
    p.health = 12;
    const apple = t.items.itemInfo(t.items.ITEM.APPLE);
    const can = p.canEat(apple, t.items.ITEM.APPLE);
    p.eat(apple, t.items.ITEM.APPLE);
    const afterApple = p.health;
    p.food = 20;
    p.health = 10;
    p._sinceDamage = 99;
    t.run(6);
    return { type: g.worldType, hunger: p.hungerOn, hud, can, afterApple, regen: p.health, food: p.food, eatTime: p.eatTime(apple, t.items.ITEM.APPLE) };
  });
  assert(r.type === "missions" && !r.hunger && !r.hud.food && !r.hud.xp, `no hunger in a Missions world: ${JSON.stringify(r)}`);
  assert(r.can && r.afterApple === 16 && r.eatTime === 1.1, `an apple heals 4 as before: ${JSON.stringify(r)}`);
  assert(r.regen > 10 && r.food === 20, `the old free regeneration: ${JSON.stringify(r)}`);
});

// ================= A Survival world =================

await check("a Survival world shows the hunger bar (10 drumsticks) and the XP bar; Creative hides them", async () => {
  await survival();
  await frames(page, 6);
  const r = await v(page, (g) => ({
    type: g.worldType,
    hunger: g.player.hungerOn,
    food: g.player.food,
    sat: g.player.saturation,
    drumsticks: document.querySelectorAll("#food canvas").length,
    foodShown: !document.getElementById("food").classList.contains("hidden"),
    xpShown: !document.getElementById("xp-bar").classList.contains("hidden"),
  }));
  assert(r.type === "survival" && r.hunger && r.food === 20 && r.sat === 5, `vanilla's start: ${JSON.stringify(r)}`);
  assert(r.drumsticks === 10 && r.foodShown && r.xpShown, `the bars: ${JSON.stringify(r)}`);
  await v(page, (g) => g.setMode("creative"));
  await frames(page, 3);
  const c = await v(page, (g) => ({ hunger: g.player.hungerOn, foodShown: !document.getElementById("food").classList.contains("hidden"), xpShown: !document.getElementById("xp-bar").classList.contains("hidden") }));
  await v(page, (g) => g.setMode("survival"));
  await frames(page, 3);
  assert(!c.hunger && !c.foodShown && !c.xpShown, `Creative: no bars: ${JSON.stringify(c)}`);
});

await check("sprinting drains food over distance (0.1 exhaustion a metre, 4 a point), walking doesn't", async () => {
  await survival();
  const r = await tt(page, (g, t) => {
    t.arena(-3);
    const p = g.player;
    p.food = 20;
    p.saturation = 0;
    p.exhaustion = 0;
    const x0 = p.position.x;
    p.keys.add("KeyW");
    t.run(3.5);
    const walked = { dist: p.position.x - x0, food: p.food, exh: p.exhaustion };
    t.place(t.x0 - 3 + 0.5, t.Y + 1, t.z0 + 0.5);
    p.food = 20;
    p.saturation = 0;
    p.exhaustion = 0;
    const x1 = p.position.x;
    p.keys.add("KeyW");
    p.keys.add("ControlLeft");
    t.run(7, () => p.position.x - x1 < 44);
    const r = { walked, dist: p.position.x - x1, food: p.food, exh: p.exhaustion, sprinting: p.sprinting };
    p.keys.clear();
    return r;
  });
  assert(r.walked.dist > 10 && r.walked.food === 20 && r.walked.exh < 0.01, `walking costs nothing: ${JSON.stringify(r)}`);
  assert(r.dist > 40 && r.food === 19, `sprinting ${r.dist.toFixed(1)} m took a food point: ${JSON.stringify(r)}`);
  const expect = (r.dist * 0.1) % 4;
  assert(Math.abs(r.exh - expect) < 0.3, `exhaustion ${r.exh.toFixed(2)} for ${r.dist.toFixed(1)} m (expected ~${expect.toFixed(2)})`);
  const hungry = await tt(page, (g, t) => {
    t.place(t.x0 - 3 + 0.5, t.Y + 1, t.z0 + 0.5);
    const p = g.player;
    p.food = 6;
    p.keys.add("KeyW");
    p.keys.add("ControlLeft");
    t.run(0.5);
    const s = p.sprinting;
    p.keys.clear();
    p.food = 20;
    return s;
  });
  assert(!hungry, "no sprinting at 6 food points or less");
});

await check("starving stops at the difficulty's floor: Easy 10, Normal 1, Hard to death; Peaceful refills", async () => {
  await survival();
  const r = await tt(page, (g, t) => {
    const out = {};
    const p = g.player;
    t.place(t.x0 + 0.5, t.Y + 1, t.z0 + 0.5);
    p.difficulty = "peaceful";
    p.food = 4;
    p.health = 10;
    t.run(3);
    out.peaceful = { food: p.food, hp: p.health };
    // (Hard last: it ends in death.)
    for (const d of ["easy", "normal", "hard"]) {
      t.place(t.x0 + 0.5, t.Y + 1, t.z0 + 0.5);
      p.difficulty = d;
      p.food = 0;
      p.saturation = 0;
      p.health = 20;
      t.run(120, () => !p.dead);
      out[d] = { hp: p.health, dead: p.dead };
    }
    p.difficulty = g.mp.game.difficulty;
    out.msg = document.getElementById("death-cause").textContent;
    return out;
  });
  await play();
  await tt(page, (g, t) => t.calm());
  assert(r.easy.hp === 10 && !r.easy.dead, `Easy: ${JSON.stringify(r.easy)}`);
  assert(r.normal.hp === 1 && !r.normal.dead, `Normal: ${JSON.stringify(r.normal)}`);
  assert(r.hard.dead && r.msg === "Starved to death", `Hard: ${JSON.stringify(r)}`);
  assert(r.peaceful.food === 10 && r.peaceful.hp >= 12, `Peaceful refills: ${JSON.stringify(r.peaceful)}`);
});

await check("regeneration needs 18 food points (a half-heart every 4 s for 6 exhaustion); a full bar with saturation heals fast", async () => {
  await survival();
  const r = await tt(page, (g, t) => {
    t.place(t.x0 + 0.5, t.Y + 1, t.z0 + 0.5);
    const p = g.player;
    p.health = 10;
    p.food = 17;
    p.saturation = 0;
    p.exhaustion = 0;
    t.run(10);
    const at17 = p.health;
    p.food = 18;
    t.run(4.1);
    const at18 = { hp: p.health, food: p.food, exh: p.exhaustion };
    t.place(t.x0 + 0.5, t.Y + 1, t.z0 + 0.5);
    p.health = 10;
    p.food = 20;
    p.saturation = 5;
    p.exhaustion = 0;
    t.run(0.55);
    const fast = { hp: p.health, sat: p.saturation, exh: p.exhaustion };
    p.health = 20;
    return { at17, at18, fast };
  });
  assert(r.at17 === 10, `no regeneration at 17: ${JSON.stringify(r)}`);
  assert(r.at18.hp === 11 && r.at18.food === 17, `one half-heart at 18, and its cost took a food point: ${JSON.stringify(r)}`);
  // (Its cost, 5 exhaustion, has already taken a saturation point: 4 + 1.)
  assert(Math.abs(r.fast.hp - (10 + 5 / 6)) < 0.01 && r.fast.sat === 4 && Math.abs(r.fast.exh - 1) < 0.01, `saturation's fast healing: ${JSON.stringify(r)}`);
});

await check("eating bread (right click held 1.6 s) restores 5 food and 6 saturation; a golden apple gives Regeneration II and Absorption", async () => {
  await survival();
  const r = await tt(page, (g, t) => {
    t.place(t.x0 + 0.5, t.Y + 1, t.z0 + 0.5);
    const p = g.player;
    const inv = g.inventory;
    const patched = /eatTime/.test(g.interaction._updateUse.toString());
    const bread = t.ID.BREAD;
    const breadInfo = t.items.itemInfo(bread) || { name: "Bread", food: { hunger: 5, saturation: 6 } };
    p.food = 10;
    p.saturation = 0;
    let via = "player.eat";
    if (patched && t.items.itemInfo(bread)) {
      inv.slots[inv.selected] = { id: bread, count: 2 };
      g.interaction.target = null;
      g.interaction.entityHit = null;
      g.interaction.mouseDown(2);
      for (let i = 0; i < 31; i++) g.interaction.update(0.05);
      const early = p.food;
      for (let i = 0; i < 4; i++) g.interaction.update(0.05);
      g.interaction.mouseUp(2);
      via = `right click (${early} at 1.55 s)`;
    } else p.eat(breadInfo, bread);
    const ate = { food: p.food, sat: p.saturation, left: inv.slots[inv.selected]?.count ?? 0, via, patched };
    p.food = 20;
    const fullBread = p.canEat(breadInfo, bread);
    const apple = t.items.itemInfo(t.items.ITEM.GOLDEN_APPLE);
    const canApple = p.canEat(apple, t.items.ITEM.GOLDEN_APPLE);
    p.eat(apple, t.items.ITEM.GOLDEN_APPLE);
    const fx = p.effects.map((e) => `${e.effect}${e.level}:${Math.round(e.time)}`);
    const absorb = p.absorption;
    p.health = 12;
    t.run(5.2);
    const regen = p.health;
    p.clearEffects();
    inv.slots[inv.selected] = null;
    g.mp.game.markInventoryChanged();
    return { ate, fullBread, canApple, fx, absorb, regen, absorbAfter: p.absorption };
  });
  assert(r.ate.food === 15 && Math.abs(r.ate.sat - 6) < 1e-6, `bread: ${JSON.stringify(r.ate)}`);
  if (r.ate.patched) assert(/^right click \(10/.test(r.ate.via) && r.ate.left === 1, `eaten through the right click in 1.6 s: ${JSON.stringify(r.ate)}`);
  else console.log("        (the interaction.js patch is not in: bread eaten through player.eat)");
  assert(!r.fullBread && r.canApple, `full: no bread, but a golden apple: ${JSON.stringify(r)}`);
  assert(r.fx.includes("regeneration2:5") && r.fx.includes("absorption1:120") && r.absorb === 4, `the golden apple's effects: ${JSON.stringify(r)}`);
  assert(r.regen >= 15 && r.absorbAfter === 0, `Regeneration II heals a half-heart every 1.25 s: ${JSON.stringify(r)}`);
});

await check("a stew leaves its bowl; rotten flesh can give Hunger (green drumsticks); a spider eye poisons, never below 1", async () => {
  await survival();
  const r = await tt(page, (g, t) => {
    t.place(t.x0 + 0.5, t.Y + 1, t.z0 + 0.5);
    const p = g.player;
    const stew = t.items.itemInfo(t.ID.MUSHROOM_STEW) || { name: "Mushroom Stew", food: { hunger: 6, saturation: 7.2 } };
    p.food = 10;
    const back = p.eat(stew, t.ID.MUSHROOM_STEW);
    const rnd = Math.random;
    Math.random = () => 0; // (the 80% chance always comes up)
    const flesh = t.items.itemInfo(t.ID.ROTTEN_FLESH) || { name: "Rotten Flesh", food: { hunger: 4, saturation: 0.8 } };
    p.eat(flesh, t.ID.ROTTEN_FLESH);
    const eye = t.items.itemInfo(t.ID.SPIDER_EYE) || { name: "Spider Eye", food: { hunger: 2, saturation: 3.2 } };
    p.health = 2;
    p.eat(eye, t.ID.SPIDER_EYE);
    Math.random = rnd;
    p.food = 10; // (no healing from a full bar meanwhile)
    p.saturation = 0;
    const fx = p.effects.map((e) => e.effect).sort();
    g.hud._effectsT = 0;
    g.hud.update(0.05, p);
    const icons = document.querySelectorAll("#effects-bar .fx").length;
    t.run(6);
    const hp = p.health;
    p.clearEffects();
    p.health = 20;
    p.food = 20;
    return { back, fx, icons, hp, bowl: t.ID.BOWL };
  });
  assert(r.back === r.bowl, `the stew's bowl: ${JSON.stringify(r)}`);
  assert(JSON.stringify(r.fx) === JSON.stringify(["hunger", "poison"]) && r.icons === 2, `the effects and their icons: ${JSON.stringify(r)}`);
  assert(r.hp === 1, `poison stops at a half-heart: ${JSON.stringify(r)}`);
});

await check("a mined coal ore drops XP orbs that fly in and fill the XP bar (vanilla's curve)", async () => {
  await survival();
  const r = await tt(page, (g, t) => {
    t.place(t.x0 + 0.5, t.Y + 1, t.z0 + 0.5);
    const p = g.player;
    p.xpLevel = 0;
    p.xpProgress = 0;
    p.xpTotal = 0;
    const inv = g.inventory;
    inv.slots[inv.selected] = { id: t.items.ITEM.WOOD_PICKAXE, count: 1, dur: 59 };
    const tool = t.items.itemInfo(t.items.ITEM.WOOD_PICKAXE).tool;
    const rnd = Math.random;
    Math.random = () => 0.99; // (the most coal gives: 2 a block)
    const patched = /onBlockBroken/.test(g.interaction._breakBlock.toString());
    for (let i = 0; i < 5; i++) {
      const x = t.x0 + 2;
      const z = t.z0 - 2 + i;
      t.set(x, t.Y + 1, z, t.BLOCK.COAL_ORE);
      if (patched) g.interaction._breakBlock(x, t.Y + 1, z, t.BLOCK.COAL_ORE, true);
      else {
        t.set(x, t.Y + 1, z, t.BLOCK.AIR);
        g.interaction.onBlockBroken(x, t.Y + 1, z, t.BLOCK.COAL_ORE, tool);
      }
    }
    Math.random = rnd;
    const dropped = g.xp.pending;
    const orbs = g.xp.orbs.length;
    t.run(3);
    inv.slots[inv.selected] = null;
    g.mp.game.markInventoryChanged();
    return { patched, dropped, orbs, left: g.xp.pending, level: p.xpLevel, progress: p.xpProgress, total: p.xpTotal };
  });
  if (!r.patched) console.log("        (the interaction.js patch is not in: the ores were broken through the hook)");
  assert(r.dropped === 10 && r.orbs >= 1, `5 coal ores, 10 points of orbs: ${JSON.stringify(r)}`);
  assert(r.left === 0 && r.total === 10 && r.level === 1 && Math.abs(r.progress - 3 / 9) < 1e-6, `collected: level 1 and 3/9 of the way: ${JSON.stringify(r)}`);
  await frames(page, 3);
  const bar = await v(page, () => ({ fill: document.querySelector("#xp-bar .xp-fill").style.width, level: document.querySelector("#xp-bar .xp-level").textContent }));
  assert(parseFloat(bar.fill) > 30 && parseFloat(bar.fill) < 36 && bar.level === "1", `the bar: ${JSON.stringify(bar)}`);
  const curve = await page.evaluate(async () => {
    const X = await import("./js/xp.js");
    return [X.xpToNext(0), X.xpToNext(15), X.xpToNext(16), X.xpToNext(30), X.xpToNext(31)];
  });
  assert(JSON.stringify(curve) === JSON.stringify([7, 37, 42, 112, 121]), `the curve: ${curve}`);
});

await check("death drops 7 XP a level (at most 100) as orbs and loses the rest; the respawn has full food", async () => {
  await survival();
  const r = await tt(page, (g, t) => {
    t.place(t.x0 + 0.5, t.Y + 1, t.z0 + 0.5);
    const p = g.player;
    g.xp.clear();
    p.xpLevel = 5;
    p.xpProgress = 0.5;
    p.xpTotal = 99;
    p.food = 3;
    p.damage(999, "lava");
    const dead = { dead: p.dead, msg: document.getElementById("death-cause").textContent, orbs: g.xp.pending, level: p.xpLevel, progress: p.xpProgress };
    return dead;
  });
  assert(r.dead && r.msg === "Tried to swim in lava" && r.orbs === 35 && r.level === 0 && r.progress === 0, `died: ${JSON.stringify(r)}`);
  await v(page, (g) => g.respawn());
  await play();
  const back = await v(page, (g) => ({ food: g.player.food, sat: g.player.saturation, fx: g.player.effects.length }));
  await tt(page, (g, t) => {
    g.xp.clear();
    t.calm();
  });
  assert(back.food === 20 && back.sat === 5 && back.fx === 0, `respawned: ${JSON.stringify(back)}`);
});

// A bed: the building part's (its ids in ids.js: the foot facing +X and
// its head), else two debug blocks marked as a bed's foot and head for the
// test. Foot at (x0 + 3, z0), head at +X.
const BED = (g, t) => {
  const S = t.S;
  let foot = null;
  let head = null;
  for (let id = t.ID.RED_BED; id < t.ID.RED_BED + 8; id++) {
    const pt = t.BLOCK_INFO[id]?.partner;
    if (S.BED_PART[id] === 1 && pt && pt[0] === 1 && pt[2] === 0) foot = id;
  }
  for (let id = t.ID.RED_BED; id < t.ID.RED_BED + 8; id++) {
    const pt = t.BLOCK_INFO[id]?.partner;
    if (S.BED_PART[id] === 2 && pt && pt[0] === -1 && pt[2] === 0) head = id;
  }
  if (foot === null || head === null) {
    S.BED_PART[t.DEBUG.BLOCK] = 1;
    S.BED_PART[t.DEBUG.SLAB] = 2;
    foot = t.DEBUG.BLOCK;
    head = t.DEBUG.SLAB;
    t.fakeBed = true;
  }
  const y = t.Y + 1;
  t.set(t.x0 + 3, y, t.z0, foot);
  t.set(t.x0 + 4, y, t.z0, head);
  return { foot: [t.x0 + 3, y, t.z0, foot], head: [t.x0 + 4, y, t.z0, head] };
};

await check("sleeping at night skips to the morning and sets the spawn; the respawn is at the bed", async () => {
  await survival();
  const r = await tt(
    page,
    (g, t, BEDSRC) => {
      t.arena();
      g.sleep.spawn = null;
      const bed = new Function("g", "t", `return (${BEDSRC})(g, t);`)(g, t);
      t.place(t.x0 + 1.5, t.Y + 1, t.z0 + 0.5);
      g.sky.setHours(23);
      const [fx, fy, fz, fid] = bed.foot;
      const used = g.sleep.useBed({ x: fx, y: fy, z: fz, id: fid });
      const p = g.player;
      const lying = !!p.sleeping && p.sleeping.x === bed.head[0];
      t.run(0.1);
      const status = document.getElementById("sleep-status").textContent;
      let t4 = null;
      t.run(6, (i) => {
        if (i === 80) t4 = { hours: g.sky.hours, sleeping: !!p.sleeping };
      });
      g.sleep.update(0.05);
      const fade = Number(document.getElementById("sleep-overlay").style.opacity || 0);
      return { fake: !!t.fakeBed, used, lying, status, t4, hours: g.sky.hours, sleeping: !!p.sleeping, spawn: g.sleep.spawn, pos: [p.position.x, p.position.y, p.position.z], head: bed.head, fade };
    },
    BED.toString()
  );
  if (r.fake) console.log("        (no bed def yet: debug blocks stand in for one)");
  assert(r.used && r.lying && /leave the bed/.test(r.status), `in bed: ${JSON.stringify(r)}`);
  assert(r.t4 && r.t4.sleeping && (r.t4.hours > 22 || r.t4.hours < 1), `still night after 4 s asleep: ${JSON.stringify(r.t4)}`);
  assert(Math.abs(r.hours - 6) < 0.05 && !r.sleeping, `the morning, awake: ${JSON.stringify(r)}`);
  assert(JSON.stringify(r.spawn) === JSON.stringify(r.head.slice(0, 3)), `the spawn is the bed: ${JSON.stringify(r)}`);
  assert(Math.hypot(r.pos[0] - r.head[0], r.pos[2] - r.head[2]) < 3, `standing next to the bed: ${JSON.stringify(r)}`);
  // Died far away: back at the bed.
  await tt(page, (g, t) => {
    const p = g.player;
    t.place(t.x0 + 30.5, t.Y + 1, t.z0 + 0.5);
    p.damage(999, "void");
  });
  await v(page, (g) => g.respawn());
  await play();
  const at = await tt(page, (g, t) => {
    const p = g.player.position;
    return { d: Math.hypot(p.x - (t.x0 + 4.5), p.z - (t.z0 + 0.5)), y: p.y };
  });
  assert(at.d < 3 && Math.abs(at.y - (r.head[1])) < 1.2, `respawned at the bed: ${JSON.stringify(at)}`);
});

await check("no sleep by day (the spawn is set all the same) or with monsters near; a missing bed sends you to the world spawn", async () => {
  await survival();
  const r = await tt(
    page,
    (g, t, BEDSRC) => {
      t.arena();
      const msgs = [];
      const toast = g.sleep.d.toast;
      g.sleep.d.toast = (m) => msgs.push(m);
      g.sleep.spawn = null;
      const bed = new Function("g", "t", `return (${BEDSRC})(g, t);`)(g, t);
      t.place(t.x0 + 1.5, t.Y + 1, t.z0 + 0.5);
      g.sky.setHours(12);
      const [fx, fy, fz, fid] = bed.foot;
      g.sleep.useBed({ x: fx, y: fy, z: fz, id: fid });
      const day = { sleeping: !!g.player.sleeping, spawn: g.sleep.spawn };
      g.sky.setHours(22);
      const z = g.mobs.spawn("zombie", t.x0 + 8.5, t.Y + 1, t.z0 + 0.5);
      g.sleep.useBed({ x: fx, y: fy, z: fz, id: fid });
      const monsters = !!g.player.sleeping;
      g.mobs.removeHostiles();
      // The bed broken: the next respawn is at the world spawn, with the message.
      t.set(bed.foot[0], bed.foot[1], bed.foot[2], t.BLOCK.AIR);
      t.set(bed.head[0], bed.head[1], bed.head[2], t.BLOCK.AIR);
      g.sleep.d.toast = toast;
      g.sky.setHours(12);
      return { msgs, day, monsters, zombie: !!z };
    },
    BED.toString()
  );
  assert(!r.day.sleeping && r.day.spawn && r.msgs.some((m) => /Respawn point set/.test(m) && /only at night/.test(m)), `by day: ${JSON.stringify(r)}`);
  assert(r.zombie && !r.monsters && r.msgs.some((m) => /monsters nearby/.test(m)), `monsters near: ${JSON.stringify(r)}`);
  await tt(page, (g, t) => {
    t.place(t.x0 + 30.5, t.Y + 1, t.z0 + 0.5);
    g.player.damage(999, "void");
  });
  const toastBefore = await v(page, () => document.getElementById("hud-toast").textContent);
  await v(page, (g) => g.respawn());
  const after = await v(page, (g) => ({ toast: document.getElementById("hud-toast").textContent, spawn: g.sleep.spawn, d: Math.hypot(g.player.position.x - g.spawn.x, g.player.position.z - g.spawn.z) }));
  await play();
  await tt(page, (g, t) => t.calm());
  assert(/home bed was missing or obstructed/.test(after.toast) && after.spawn === null && after.d < 30, `the world spawn: ${JSON.stringify(after)} (before: ${toastBefore})`);
});

await check("lava burns (4 a hit, burning after it, water puts it out); a cactus pricks; a wall suffocates", async () => {
  await survival();
  const r = await tt(page, (g, t) => {
    t.arena();
    const S = t.S;
    let lava = t.ID.LAVA;
    if (!(S.BODY_FLAGS[lava] & S.BODY.LAVA) || !t.BLOCK_INFO[lava]) {
      // (No lava def yet: tall grass stands in for it.)
      lava = t.BLOCK.TALL_GRASS;
      t.oldGrass = S.BODY_FLAGS[lava];
      S.BODY_FLAGS[lava] = S.BODY.LAVA;
    }
    const p = g.player;
    const x = t.x0 + 6;
    const y = t.Y + 1;
    const z = t.z0;
    t.set(x, y, z, lava);
    t.place(x + 0.5, y, z + 0.5);
    const hp0 = p.health;
    t.run(1.02);
    const inLava = { hp: p.health, fire: p.fireTime };
    t.set(x, y, z, t.BLOCK.AIR);
    t.place(x + 0.5, y, z + 0.5);
    p.fireTime = 10;
    t.run(3.05);
    const burning = { hp: p.health, fire: p.fireTime };
    t.set(x, y, z, t.BLOCK.WATER);
    t.set(x, y + 1, z, t.BLOCK.WATER);
    t.run(0.1);
    const doused = p.fireTime;
    t.set(x, y, z, t.BLOCK.AIR);
    t.set(x, y + 1, z, t.BLOCK.AIR);
    if (t.oldGrass !== undefined) S.BODY_FLAGS[t.BLOCK.TALL_GRASS] = t.oldGrass;
    // A cactus next door, touched.
    t.set(x + 1, y, z, t.BLOCK.CACTUS);
    t.place(x + 1 - 0.31, y, z + 0.5);
    t.run(1.05);
    const cactus = p.health;
    t.set(x + 1, y, z, t.BLOCK.AIR);
    // The eyes inside stone.
    t.place(x + 0.5, y, z + 0.5);
    t.set(x, y + 1, z, t.BLOCK.STONE);
    t.run(1.05);
    const wall = p.health;
    t.set(x, y + 1, z, t.BLOCK.AIR);
    return { hp0, inLava, burning, doused, cactus, wall };
  });
  assert(r.inLava.hp === r.hp0 - 8 && r.inLava.fire > 14, `lava: 4 every 0.5 s: ${JSON.stringify(r)}`);
  assert(r.burning.hp === 17 && r.burning.fire > 6.9 && r.burning.fire < 7.1, `burning a half-heart a second: ${JSON.stringify(r)}`);
  assert(r.doused === 0, `water puts it out: ${JSON.stringify(r)}`);
  assert(r.cactus === 17, `the cactus: 1 every 0.5 s: ${JSON.stringify(r)}`);
  // (The player's physics shoves the body up out of a block it is inside, so a
  // wall at the eyes hurts once or twice, then the eyes are out of it.)
  assert(r.wall <= 19, `suffocating: ${JSON.stringify(r)}`);
  const msgs = await v(page, (g) => ["lava", "burn", "cactus", "suffocate", "fire"].map((c) => g.mp.game.deathMessage(c)));
  assert(JSON.stringify(msgs) === JSON.stringify(["Tried to swim in lava", "Burned to death", "Was pricked to death", "Suffocated in a wall", "Went up in flames"]), `the death messages: ${msgs}`);
});

await check("drowning: 15 s of air in a Survival world", async () => {
  await survival();
  const r = await tt(page, (g, t) => {
    t.arena();
    const x = t.x0 + 10;
    const y = t.Y + 1;
    const z = t.z0;
    const list = [];
    for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) for (let dy = 0; dy < 4; dy++) list.push(x + dx, y + dy, z + dz, t.BLOCK.WATER);
    g.world.setBlocks(list);
    t.place(x + 0.5, y, z + 0.5);
    const p = g.player;
    t.run(10);
    const at10 = { air: p.air, hp: p.health, head: p.headInWater };
    t.run(5.5);
    const at15 = { air: p.air, hp: p.health };
    for (let i = 0; i < list.length; i += 4) list[i + 3] = t.BLOCK.AIR;
    g.world.setBlocks(list);
    t.place(t.x0 + 0.5, t.Y + 1, t.z0 + 0.5);
    return { at10, at15 };
  });
  assert(r.at10.head && r.at10.air > 3 && r.at10.hp === 20, `10 s under: ${JSON.stringify(r)}`);
  assert(r.at15.air === 0 && r.at15.hp <= 20, `15 s: out of air: ${JSON.stringify(r)}`);
});

await check("the step up: walking onto a slab without jumping, not onto a full block", async () => {
  await survival();
  const r = await tt(page, (g, t) => {
    t.arena();
    const slab = t.BLOCK_INFO[t.ID.STONE_SLAB]?.collision ? t.ID.STONE_SLAB : t.DEBUG.SLAB;
    const y = t.Y + 1;
    const row = (id) => {
      for (let x = t.x0 + 4; x <= t.x0 + 14; x++) for (let dz = -1; dz <= 1; dz++) t.set(x, y, t.z0 + dz, id);
    };
    const p = g.player;
    const walk = () => {
      t.place(t.x0 + 1.5, y, t.z0 + 0.5);
      p.keys.add("KeyW");
      let jumped = false;
      t.run(1.5, () => {
        jumped ||= p.jumpEvent;
      });
      p.keys.clear();
      return { x: p.position.x - t.x0, y: p.position.y, ground: p.onGround, jumped };
    };
    row(slab);
    const onSlab = walk();
    row(t.BLOCK.STONE);
    const atWall = walk();
    row(t.BLOCK.AIR);
    return { slab, onSlab, atWall };
  });
  assert(Math.abs(r.onSlab.y - 101.5) < 0.01 && r.onSlab.x > 6 && r.onSlab.ground && !r.onSlab.jumped, `up on the slab: ${JSON.stringify(r)}`);
  assert(r.atWall.x < 4 && Math.abs(r.atWall.y - 101) < 0.01, `not up a full block: ${JSON.stringify(r)}`);
});

await check("climbing a ladder: walking into it climbs, sneaking holds on, no fall damage coming down", async () => {
  await survival();
  const r = await tt(page, (g, t) => {
    t.arena();
    const S = t.S;
    let ladder = null;
    for (let id = t.ID.LADDER; id < t.ID.LADDER + 4; id++) if (t.BLOCK_INFO[id] && S.BODY_FLAGS[id] & S.BODY.CLIMB) ladder = ladder ?? id;
    let fake = false;
    if (ladder === null || t.BLOCK_INFO[ladder].solid) {
      // (No ladder def yet, or a solid one: tall grass marked climbable, in the
      // cell in front of a wall.)
      ladder = t.BLOCK.TALL_GRASS;
      t.oldGrass = S.BODY_FLAGS[ladder];
      S.BODY_FLAGS[ladder] = S.BODY.CLIMB;
      fake = true;
    }
    const x = t.x0 + 4;
    const y = t.Y + 1;
    const z = t.z0;
    for (let dy = 0; dy < 6; dy++) {
      t.set(x + 1, y + dy, z, t.BLOCK.STONE);
      t.set(x, y + dy, z, ladder);
    }
    t.place(x + 0.5, y, z + 0.5);
    const p = g.player;
    p.keys.add("KeyW");
    t.run(1.5);
    const climbed = p.position.y - y;
    p.keys.clear();
    p.keys.add("ShiftLeft");
    t.run(0.3); // (the climb's last push settles)
    const held0 = p.position.y;
    t.run(1);
    const held = p.position.y - held0;
    p.keys.clear();
    t.run(3);
    const down = { y: p.position.y - y, hp: p.health, ground: p.onGround };
    for (let dy = 0; dy < 6; dy++) {
      t.set(x + 1, y + dy, z, t.BLOCK.AIR);
      t.set(x, y + dy, z, t.BLOCK.AIR);
    }
    if (fake) S.BODY_FLAGS[t.BLOCK.TALL_GRASS] = t.oldGrass;
    return { fake, climbed, held, down };
  });
  if (r.fake) console.log("        (no ladder def yet: a climbable stand-in)");
  assert(r.climbed > 3 && r.climbed < 4, `climbed ~2.35 blocks a second: ${JSON.stringify(r)}`);
  assert(Math.abs(r.held) < 0.05, `sneaking holds on: ${JSON.stringify(r)}`);
  assert(r.down.y < 0.01 && r.down.hp === 20, `slid down unhurt: ${JSON.stringify(r)}`);
});

await check("a reload keeps the food, saturation, XP, effects and the bed", async () => {
  await survival();
  await tt(page, (g, t) => {
    const p = g.player;
    t.place(t.x0 + 0.5, t.Y + 1, t.z0 + 0.5);
    p.food = 13;
    p.saturation = 2.5;
    p.xpLevel = 7;
    p.xpProgress = 0.25;
    p.xpTotal = 120;
    p.addEffect("regeneration", 60, 1);
    g.sleep.spawn = [t.x0 + 4, t.Y + 1, t.z0];
    g.flushSave();
  });
  await boot(`seed=${SEED}&type=survival`);
  booted = "reloaded";
  const s = await v(page, (g) => ({ type: g.worldType, food: g.player.food, sat: g.player.saturation, xp: [g.player.xpLevel, g.player.xpProgress, g.player.xpTotal], fx: g.player.effects.map((e) => e.effect), bed: g.sleep.spawn }));
  assert(s.type === "survival" && s.food === 13 && s.sat === 2.5 && JSON.stringify(s.xp) === JSON.stringify([7, 0.25, 120]) && s.fx[0] === "regeneration" && Array.isArray(s.bed), `after the reload: ${JSON.stringify(s)}`);
});

// ================= Online =================

async function online() {
  const { default: express } = await import("express");
  const { ExpressPeerServer } = await import("peer");
  const PEER_PORT = PORT + 60;
  const app = express();
  const peerHttp = app.listen(PEER_PORT, "127.0.0.1");
  app.use("/ufo", ExpressPeerServer(peerHttp, { path: "/" }));
  const NET_Q = `peerServer=127.0.0.1:${PEER_PORT}/ufo&noStun=1&graphics=low`;
  const host = await newPage("host", { width: 640, height: 360 });
  const guest = await newPage("guest", { width: 640, height: 360 });
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
  await check("online: everyone must sleep (x/y players sleeping); the host skips the night and the guest wakes", async () => {
    await host.goto(`http://127.0.0.1:${PORT}/index.html?seed=${SEED + 1}&type=survival&${NET_Q}`, { waitUntil: "load", timeout: 60000 });
    await host.waitForFunction(() => !!window.__ufo && window.__ufo.graphicsReady, null, { timeout: 120000 });
    await host.click("#menu-mp-btn");
    await host.fill("#mp-nick", "Alice");
    await host.click("#mp-host-btn");
    const code = await until(host, (g) => g.net.code, 30000);
    assert(code, "no room code");
    await host.click("#mp-lobby-play");
    await host.waitForFunction(() => window.__ufo.gameState === "playing", null, { timeout: 30000 });
    await v(host, noDraw);
    await guest.goto(`http://127.0.0.1:${PORT}/index.html?join=${code}&${NET_Q}`, { waitUntil: "load", timeout: 60000 });
    await guest.waitForSelector("#mp-join-boot:not(.hidden)", { timeout: 30000 });
    await guest.fill("#mp-boot-nick", "Bob");
    await guest.click("#mp-boot-join");
    await guest.waitForFunction(() => !!window.__ufo && window.__ufo.graphicsReady, null, { timeout: 120000 });
    assert(await until(guest, (g) => g.mp.stateLoaded, 60000), "the host's state never arrived");
    await v(guest, noDraw);
    await play(guest);
    await installTools(host);
    await installTools(guest);
    // Two beds side by side, built on the host (the guest gets the edits).
    const beds = await tt(
      host,
      (g, t, BEDSRC) => {
        t.arena();
        g.mobs.removeHostiles();
        const a = new Function("g", "t", `return (${BEDSRC})(g, t);`)(g, t);
        t.z0 += 2;
        const b = new Function("g", "t", `return (${BEDSRC})(g, t);`)(g, t);
        t.z0 -= 2;
        g.sky.locked = false;
        g.sky.setHours(22);
        t.place(t.x0 + 1.5, t.Y + 1, t.z0 + 0.5);
        return { a, b, fake: !!t.fakeBed };
      },
      BED.toString()
    );
    if (beds.fake) await tt(guest, (g, t) => { t.S.BED_PART[t.DEBUG.BLOCK] = 1; t.S.BED_PART[t.DEBUG.SLAB] = 2; });
    assert(await until(guest, (g, a) => g.world.getBlock(a[0], a[1], a[2]) === a[3], 45000, beds.b.head), "the beds never reached the guest");
    assert(await until(guest, () => window.__ufo.sky.hours > 21, 45000), "the guest's clock never followed the host's night");
    // The host lies down: alone in bed, the night stays.
    await tt(host, (g, t, foot) => g.sleep.useBed({ x: foot[0], y: foot[1], z: foot[2], id: foot[3] }), beds.a.foot);
    await new Promise((res) => setTimeout(res, 6000));
    const one = await v(host, (g) => ({ sleeping: !!g.player.sleeping, hours: g.sky.hours, status: document.getElementById("sleep-status").textContent }));
    const seen = await until(guest, () => document.getElementById("sleep-status").textContent, 10000);
    assert(one.sleeping && one.hours > 21 && /1\/2 players sleeping/.test(one.status), `the host alone: ${JSON.stringify(one)}`);
    assert(/1\/2 players sleeping/.test(seen), `the guest sees the count: ${seen}`);
    // The guest lies down too: after 5 s the night is gone for both.
    await tt(guest, (g, t, foot) => {
      t.place(foot[0] - 1.5, foot[1], foot[2] + 0.5);
      return g.sleep.useBed({ x: foot[0], y: foot[1], z: foot[2], id: foot[3] });
    }, beds.b.foot);
    const lying = await until(host, (g) => [...g.mp.players.active()].some((r) => r.sleeping), 10000);
    assert(lying, "the host never saw the guest lying down");
    const morning = await until(guest, (g) => !g.player.sleeping && g.sky.hours > 5.9 && g.sky.hours < 7 && { hours: g.sky.hours }, 40000);
    const hostMorning = await v(host, (g) => ({ sleeping: !!g.player.sleeping, hours: g.sky.hours }));
    assert(morning && !hostMorning.sleeping && hostMorning.hours > 5.9 && hostMorning.hours < 7, `the morning for both: guest ${JSON.stringify(morning)} host ${JSON.stringify(hostMorning)}`);
    const spawns = [await v(guest, (g) => g.sleep.spawn), await v(host, (g) => g.sleep.spawn)];
    assert(spawns[0] && spawns[1] && spawns[0][2] !== spawns[1][2], `each has their own bed: ${JSON.stringify(spawns)}`);
    await guest.close();
    await host.close();
  });
  peerHttp.close();
}
if (args.online) await online();

// ---------- Summary ----------
const failed = results.filter(([, ok]) => !ok);
console.log(`\n${results.length - failed.length} passed, ${failed.length} failed${errors.length ? `; console errors: ${errors.length}` : ""}.`);
if (errors.length) console.log(errors.slice(0, 5).join("\n"));
await browser.close();
server.close();
process.exit(failed.length || errors.length ? 1 : 0);
