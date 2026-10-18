// Round 11 items tests (the vanilla items of js/content/items-vanilla.js and
// their uses): boots the real game in headless Chromium (software WebGL, Low
// preset) in a new Survival world and checks every new item has a name, a
// painted icon and its stack size; foods carry the classic hunger values; a
// bucket picks up a water source and pours it back; flint and steel sets
// fire (when the nature module's fire block exists); the bow takes an arrow
// per shot (none in Creative) and a stuck arrow can be picked up again; the
// fishing rod casts, a forced bite reels in a catch; eggs and ender pearls
// are thrown (the pearl takes you there, 5 damage); shears cut leaves whole;
// golden tools mine at gold's speed; the core ores drop raw metal and gems;
// a village chest holds the classic village loot; the compass and clock turn
// in hand. Then a Missions world: the bow needs no arrows and the ores and
// chests are as before.
//
//   node r11-items-tests.mjs [--only=substring] [--seed=4711]
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
const PORT = 9760 + Math.floor(Math.random() * 40);
const SEED = Number(args.seed ?? 4711);
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
// A page in a context of its own (its own saved worlds).
async function newPage() {
  const ctx = await browser.newContext({ viewport: { width: 960, height: 540 } });
  const p = await ctx.newPage();
  await p.route("https://cdn.jsdelivr.net/npm/three@0.160.0/**", (route) => {
    const rel = new URL(route.request().url()).pathname.replace("/npm/three@0.160.0/", "");
    route.fulfill({ path: path.join(localThreeRoot, rel), contentType: "text/javascript" });
  });
  p.on("console", (m) => {
    if (m.type() === "error") errors.push(m.text());
  });
  p.on("pageerror", (e) => errors.push(String(e)));
  p.on("dialog", (d) => d.accept());
  return p;
}
let page = await newPage();

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
// In-page helpers (again after every load): aiming the player at a block face
// and a test site.
const helpers = () =>
  page.evaluate(() => {
    window.__ti = {
      // Stands the player's eye off face n of block (x, y, z), looking at the
      // face's centre, and updates the crosshair target.
      aim(g, [x, y, z], [nx, ny, nz], d = ny > 0 ? 3.2 : 2.2) {
        const pl = g.player;
        const px = x + 0.5 + nx * 0.5;
        const py = y + 0.5 + ny * 0.5;
        const pz = z + 0.5 + nz * 0.5;
        const ex = px + nx * d + (ny ? 0.01 : 0);
        const ey = py + ny * d;
        const ez = pz + nz * d;
        pl.velocity.set(0, 0, 0);
        const eyeOff = pl.getEyePosition().y - pl.position.y;
        pl.position.set(ex, ey - eyeOff, ez);
        const dx = px - ex;
        const dy = py - ey;
        const dz = pz - ez;
        pl.yaw = Math.atan2(-dx, -dz);
        pl.pitch = Math.asin(dy / Math.hypot(dx, dy, dz));
        g.interaction.updateTarget(true);
        return g.interaction.target;
      },
      rightClick(g) {
        g.interaction.mouseDown(2);
        g.interaction.mouseUp(2);
      },
      async hold(g, id, count = 1) {
        const { makeStack } = await import("./js/inventory.js");
        g.inventory.slots[0] = makeStack(id, count);
        g.inventory.selected = 0;
        return g.inventory.slots[0];
      },
      // A 9x9 stone floor with air above (built, the same in every world)
      // and a 3x3 pool two deep in its middle. (x, y, z): the cell above
      // the floor's middle (the pool's top water cell).
      site(g) {
        g.testFlags.noMissions = true;
        const w = g.world;
        const x = Math.floor(g.spawn.x) + 9;
        const z = Math.floor(g.spawn.z) + 9;
        w.prepareArea(x, z, 2);
        const y = Math.max(w.surfaceY(x, z) + 1, 34);
        const list = [];
        for (let ax = -4; ax <= 4; ax++) {
          for (let az = -4; az <= 4; az++) {
            const pool = Math.abs(ax) <= 1 && Math.abs(az) <= 1;
            list.push(x + ax, y - 3, z + az, 3);
            list.push(x + ax, y - 2, z + az, pool ? 5 : 3);
            list.push(x + ax, y - 1, z + az, pool ? 5 : 3);
            for (let ay = 0; ay <= 6; ay++) list.push(x + ax, y + ay, z + az, 0);
          }
        }
        // (built: no flow from the sim, the pool is all sources)
        w.setBlocks(list, { recordEdit: false });
        w.processQueues(50);
        return { x, y, z };
      },
    };
  });
async function ready() {
  await page.waitForFunction(() => !!window.__ufo, null, { timeout: 90000 });
  await page.waitForFunction(() => window.__ufo.graphicsReady, null, { timeout: 120000 });
  await helpers();
}
async function play() {
  const t0 = Date.now();
  while (Date.now() - t0 < 90000) {
    const st = await v((g) => g.gameState);
    if (st === "playing") return;
    if (st === "dead") {
      await v((g) => g.respawn());
      continue;
    }
    if (st === "start") await page.click("#play-btn", { timeout: 5000 }).catch(() => {});
    else if (await page.isVisible("#resume-btn")) await page.click("#resume-btn", { timeout: 3000 }).catch(() => {});
    else if (await page.isVisible("#click-to-play").catch(() => false)) await page.click("#click-to-play", { timeout: 3000 }).catch(() => {});
    else {
      await page.mouse.click(480, 270);
      await frames(5);
      if ((await v((g) => g.gameState)) === "paused" && !(await page.isVisible("#resume-btn"))) await page.evaluate(() => document.getElementById("pause-menu").classList.remove("hidden"));
    }
    await frames(3);
  }
  throw new Error(`the game didn't start playing (state ${await v((g) => g.gameState)})`);
}
async function boot(query) {
  await page.goto(`http://127.0.0.1:${PORT}/index.html?${query}&graphics=low`, { waitUntil: "load", timeout: 60000 });
  await ready();
  await play();
}

// ================= A Survival world =================
await boot(`seed=${SEED}&type=survival`);
const site = await v((g) => window.__ti.site(g));
assert(site, "no test site");

await check("a Survival world (the setup)", async () => {
  const t = await v((g) => g.worldType);
  assert(t === "survival", `the world type: ${t}`);
});

await check("every vanilla item has a name, a painted icon and its stack size; foods have the classic values", async () => {
  const r = await v(async () => {
    const V = await import("./js/content/ids.js");
    const I = await import("./js/items.js");
    const T = await import("./js/itemtextures.js");
    const bad = [];
    const ids = Object.values(V).filter((id) => id >= 320 && id < 394);
    for (const id of ids) {
      const info = I.itemInfo(id);
      if (!info || !info.name) {
        bad.push(`${id}: no item`);
        continue;
      }
      const px = T.itemIconPixels(id);
      let opaque = 0;
      for (let i = 3; i < (px?.length ?? 0); i += 4) if (px[i]) opaque++;
      if (opaque < 30) bad.push(`${info.name}: icon has ${opaque} pixels`);
    }
    const stack = (id) => I.maxStack(id);
    const stacks = {
      egg: stack(V.EGG), pearl: stack(V.ENDER_PEARL), bucket: stack(V.BUCKET), water: stack(V.WATER_BUCKET), milk: stack(V.MILK_BUCKET),
      stew: stack(V.MUSHROOM_STEW), sword: stack(V.GOLDEN_SWORD), hoe: stack(V.WOODEN_HOE), shears: stack(V.SHEARS), arrow: stack(V.ARROW), iron: stack(V.IRON_INGOT), compass: stack(V.COMPASS),
    };
    const f = (id) => {
      const food = I.itemInfo(id).food;
      return [food.hunger, food.saturation];
    };
    const foods = { bread: f(V.BREAD), steak: f(V.COOKED_BEEF), chicken: f(V.CHICKEN), salmon: f(V.COOKED_SALMON), carrot: f(V.GOLDEN_CARROT), apple: f(I.ITEM.APPLE), golden: f(I.ITEM.GOLDEN_APPLE), stewReturns: I.itemInfo(V.MUSHROOM_STEW).returns === V.BOWL };
    const heal = [I.foodHeal(I.itemInfo(I.ITEM.APPLE)), I.foodHeal(I.itemInfo(I.ITEM.GOLDEN_APPLE)), I.foodHeal(I.itemInfo(I.ITEM.RAW_MEAT)), +I.itemInfo(I.ITEM.COOKED_MEAT).food];
    const palette = { potion: I.CREATIVE_ITEMS.includes(V.POTION), shears: I.CREATIVE_ITEMS.includes(V.SHEARS), rod: I.CREATIVE_ITEMS.includes(V.FISHING_ROD) };
    return { n: ids.length, bad, stacks, foods, heal, palette };
  });
  assert(r.n === 74 && r.bad.length === 0, `${r.n} items: ${r.bad.join("; ")}`);
  const s = r.stacks;
  assert(s.egg === 16 && s.pearl === 16 && s.bucket === 16 && s.water === 1 && s.milk === 1 && s.stew === 1 && s.sword === 1 && s.hoe === 1 && s.shears === 1 && s.arrow === 64 && s.iron === 64 && s.compass === 64, `stack sizes ${JSON.stringify(s)}`);
  const fd = r.foods;
  assert(String(fd.bread) === "5,6" && String(fd.steak) === "8,12.8" && String(fd.chicken) === "2,1.2" && String(fd.salmon) === "6,9.6" && String(fd.carrot) === "6,14.4" && String(fd.apple) === "4,2.4" && String(fd.golden) === "4,9.6" && fd.stewReturns, `foods ${JSON.stringify(fd)}`);
  assert(String(r.heal) === "4,20,2,8", `a Missions world's heals as before: ${r.heal}`);
  assert(!r.palette.potion && r.palette.shears && r.palette.rod, `the creative palette ${JSON.stringify(r.palette)}`);
});

await check("a bucket picks up a water source and pours it back", async () => {
  const before = await v(async (g, s) => {
    const V = await import("./js/content/ids.js");
    g.setMode("survival");
    g.player.flying = false;
    g.inventory.clear();
    await window.__ti.hold(g, V.BUCKET, 2);
    // (looking down at the pool's middle from above; the water isn't a target: the floor under it is)
    window.__ti.aim(g, [s.x, s.y - 3, s.z], [0, 1, 0], 4.2);
    const water = g.world.getBlock(s.x, s.y - 1, s.z);
    window.__ti.rightClick(g);
    return { water, after: g.world.getBlock(s.x, s.y - 1, s.z), slot0: g.inventory.slots[0] && [g.inventory.slots[0].id, g.inventory.slots[0].count], filled: g.inventory.countItem(V.WATER_BUCKET) };
  }, site);
  assert(before.water === 5 && before.after === 0, `the source was taken: ${JSON.stringify(before)}`);
  assert(before.slot0[0] === 366 && before.slot0[1] === 1 && before.filled === 1, `one bucket filled: ${JSON.stringify(before)}`);

  const after = await v(async (g, s) => {
    const V = await import("./js/content/ids.js");
    g.inventory.slots[0] = null;
    const i = g.inventory.slots.findIndex((x) => x && x.id === V.WATER_BUCKET);
    g.inventory.selected = i;
    // Pour it onto the top of the floor beside the pool.
    const t = window.__ti.aim(g, [s.x + 3, s.y - 1, s.z], [0, 1, 0]);
    window.__ti.rightClick(g);
    return { aimed: !!t, poured: g.world.getBlock(s.x + 3, s.y, s.z), held: g.inventory.slots[i]?.id };
  }, site);
  assert(after.aimed && after.poured === 5 && after.held === 366, `poured back: ${JSON.stringify(after)}`);
  await v((g, s) => g.world.setBlocks([s.x + 3, s.y, s.z, 0, s.x, s.y - 1, s.z, 5], { recordEdit: false }), site);
});

await check("a bucket takes lava from a lava source and pours it again (when lava exists)", async () => {
  const r = await v(async (g, s) => {
    const V = await import("./js/content/ids.js");
    const { BLOCK_INFO } = await import("./js/blocks.js");
    if (!BLOCK_INFO[V.LAVA]) return { none: true };
    g.world.setBlocks([s.x - 3, s.y - 1, s.z + 3, V.LAVA], { recordEdit: false });
    g.inventory.clear();
    await window.__ti.hold(g, V.BUCKET);
    window.__ti.aim(g, [s.x - 3, s.y - 2, s.z + 3], [0, 1, 0], 3.2);
    window.__ti.rightClick(g);
    const taken = g.world.getBlock(s.x - 3, s.y - 1, s.z + 3);
    const held = g.inventory.slots[0]?.id;
    window.__ti.aim(g, [s.x - 3, s.y - 1, s.z - 3], [0, 1, 0]);
    window.__ti.rightClick(g);
    const poured = g.world.getBlock(s.x - 3, s.y, s.z - 3);
    const back = g.inventory.slots[0]?.id;
    g.world.setBlocks([s.x - 3, s.y - 1, s.z + 3, 3, s.x - 3, s.y, s.z - 3, 0], { recordEdit: false });
    return { taken, held, poured, back, lava: V.LAVA, full: V.LAVA_BUCKET };
  }, site);
  if (r.none) return;
  assert(r.taken === 0 && r.held === r.full && r.poured === r.lava && r.back === 366, JSON.stringify(r));
});

await check("flint and steel sets fire on the face clicked (when the fire block exists)", async () => {
  const r = await v(async (g, s) => {
    const V = await import("./js/content/ids.js");
    const { BLOCK_INFO } = await import("./js/blocks.js");
    const st = await window.__ti.hold(g, V.FLINT_AND_STEEL);
    const dur = st.dur;
    window.__ti.aim(g, [s.x - 3, s.y - 1, s.z - 3], [0, 1, 0]);
    window.__ti.rightClick(g);
    const fire = g.world.getBlock(s.x - 3, s.y, s.z - 3);
    const out = { hasFire: !!BLOCK_INFO[V.FIRE], fire, isFire: fire === V.FIRE, dur, after: g.inventory.slots[0]?.dur };
    g.world.setBlocks([s.x - 3, s.y, s.z - 3, 0], { recordEdit: false });
    return out;
  }, site);
  if (r.hasFire) assert(r.isFire && r.after === r.dur - 1, `fire, one use worn: ${JSON.stringify(r)}`);
  else assert(r.fire === 0 && r.after === r.dur, `no fire block yet: nothing happens ${JSON.stringify(r)}`);
});

await check("the bow takes one arrow a shot in a Survival world (none in Creative) and a stuck arrow is picked up again", async () => {
  const r = await v(async (g, s) => {
    const V = await import("./js/content/ids.js");
    const { ITEM } = await import("./js/items.js");
    const w = g.weapons;
    g.inventory.clear();
    await window.__ti.hold(g, ITEM.BOW);
    // No arrows: no draw.
    w.refill();
    w.press("bow");
    const drewEmpty = w.bow.drawing;
    w.release();
    g.inventory.slots[5] = { id: V.ARROW, count: 3 };
    // Stand on the floor, facing a wall built 4 blocks away.
    g.world.setBlocks([s.x, s.y, s.z - 4, 3, s.x, s.y + 1, s.z - 4, 3], { recordEdit: false });
    g.player.position.set(s.x + 0.5, s.y, s.z + 0.5);
    g.player.yaw = 0;
    g.player.pitch = 0;
    w.refill();
    w.press("bow");
    w.bow.t = 1;
    w.release();
    const left = g.inventory.countItem(V.ARROW);
    const arrow = w.arrows[w.arrows.length - 1];
    // Creative: no arrow used.
    g.setMode("creative");
    w.refill();
    w.press("bow");
    w.bow.t = 1;
    w.release();
    const leftCreative = g.inventory.countItem(V.ARROW);
    const creativeArrow = w.arrows[w.arrows.length - 1];
    g.setMode("survival");
    g.player.flying = false;
    // The survival arrow sticks in the wall; walking up to it picks it up.
    for (let i = 0; i < 40 && !arrow.stuck; i++) w._updateArrows(0.02);
    const stuck = arrow.stuck;
    g.player.position.set(arrow.pos.x, s.y, arrow.pos.z + 0.6);
    for (let i = 0; i < 15; i++) w._updateArrows(0.02); // (not in the first moment it sticks)
    const picked = !w.arrows.includes(arrow);
    return { drewEmpty, left, leftCreative, pickup: arrow.pickup, creativePickup: creativeArrow?.pickup, stuck, picked, after: g.inventory.countItem(V.ARROW) };
  }, site);
  assert(!r.drewEmpty, "no draw without arrows");
  assert(r.left === 2 && r.pickup === true, `one arrow used: ${JSON.stringify(r)}`);
  assert(r.leftCreative === 2 && r.creativePickup === false, `none in Creative: ${JSON.stringify(r)}`);
  assert(r.stuck && r.picked && r.after === 3, `picked up again: ${JSON.stringify(r)}`);
  await v((g, s) => g.world.setBlocks([s.x, s.y, s.z - 4, 0, s.x, s.y + 1, s.z - 4, 0], { recordEdit: false }), site);
});

await check("the fishing rod casts into water and a forced bite reels in a catch", async () => {
  const r = await v(async (g, s) => {
    const V = await import("./js/content/ids.js");
    const f = g.weapons.fishing;
    g.inventory.clear();
    const st = await window.__ti.hold(g, V.FISHING_ROD);
    const dur = st.dur;
    // At the pool's edge, looking down into it.
    g.player.position.set(s.x + 2.5, s.y, s.z + 0.5);
    g.player.yaw = Math.PI / 2; // (facing -X)
    g.player.pitch = -0.7;
    g.interaction.updateTarget(true);
    window.__ti.rightClick(g);
    const cast = f.cast;
    for (let i = 0; i < 200 && f.bobber && !f.bobber.inWater; i++) f.update(0.02);
    for (let i = 0; i < 30 && f.bobber; i++) f.update(0.02);
    const inWater = !!f.bobber?.inWater;
    const bit = f.forceBite();
    if (f.bobber) f.bobber.nibble = 5; // (the real frames until the next click must not let it get away)
    const items = g.entities.items.length;
    return { cast, inWater, bit, items, dur, rodShown: g.held.rodCast };
  }, site);
  assert(r.cast && r.inWater && r.bit && r.rodShown, `cast into the pool: ${JSON.stringify(r)}`);

  const c = await v(async (g) => {
    const f = g.weapons.fishing;
    const before = g.entities.items.length;
    window.__ti.rightClick(g);
    const it = g.entities.items[g.entities.items.length - 1];
    return { caught: f.caught, cast: f.cast, spawned: g.entities.items.length - before, id: it?.id, dur: g.inventory.slots[0]?.dur, rodShown: g.held.rodCast };
  });
  assert(c.caught === 1 && !c.cast && c.spawned === 1 && c.dur === r.dur - 1 && !c.rodShown, `a catch: ${JSON.stringify(c)}`);
});

await check("an ender pearl takes you where it lands (5 damage); an egg is thrown and used up", async () => {
  const r = await v(async (g, s) => {
    const V = await import("./js/content/ids.js");
    const T = g.weapons.throwables;
    g.inventory.clear();
    await window.__ti.hold(g, V.ENDER_PEARL, 2);
    g.player.revive?.();
    g.player.health = 20;
    g.player._invulnerable = 0;
    // Thrown straight down from the floor's corner onto the floor.
    g.player.position.set(s.x - 3.5, s.y + 4, s.z - 3.5);
    g.player.velocity.set(0, 0, 0);
    g.player.yaw = 0;
    g.player.pitch = -Math.PI / 2 + 0.05;
    g.interaction.updateTarget(true);
    window.__ti.rightClick(g);
    const thrown = T.list.length;
    let hops = 0;
    for (; hops < 100 && T.list.length; hops++) T.update(0.02);
    const p = g.player.position;
    const out = { thrown, landed: !T.list.length, left: g.inventory.countItem(V.ENDER_PEARL), y: p.y, health: g.player.health, at: [p.x, p.z] };
    await window.__ti.hold(g, V.EGG, 3);
    let hatched = 0;
    T.onHatch = (pos, n) => (hatched += n);
    window.__ti.rightClick(g);
    out.eggs = g.inventory.countItem(V.EGG);
    out.eggFlying = T.list.length;
    T.onHatch = null;
    return out;
  }, site);
  assert(r.thrown === 1 && r.landed && r.left === 1, `a pearl thrown: ${JSON.stringify(r)}`);
  assert(Math.abs(r.y - site.y) < 0.6 && r.health === 15, `teleported onto the floor with 5 damage: ${JSON.stringify(r)} (floor top ${site.y})`);
  assert(r.eggs === 2 && r.eggFlying === 1, `an egg thrown: ${JSON.stringify(r)}`);
});

await check("shears cut leaves whole and fast; golden tools mine at gold's speed; Survival ores drop raw metal and gems", async () => {
  const r = await v(async (g, s) => {
    const V = await import("./js/content/ids.js");
    const I = await import("./js/items.js");
    const { BLOCK } = await import("./js/blocks.js");
    const shears = I.itemInfo(V.SHEARS).tool;
    const gold = I.itemInfo(V.GOLDEN_PICKAXE).tool;
    const ironPick = I.itemInfo(I.ITEM.IRON_PICKAXE).tool;
    // Mining a stone block with the golden pickaxe, in the game.
    g.world.setBlocks([s.x + 3, s.y, s.z + 3, BLOCK.STONE], { recordEdit: false });
    await window.__ti.hold(g, V.GOLDEN_PICKAXE);
    window.__ti.aim(g, [s.x + 3, s.y, s.z + 3], [1, 0, 0]);
    g.interaction.mouseDown(0);
    const mining = g.interaction.mining?.time;
    g.interaction.mouseUp(0);
    g.world.setBlocks([s.x + 3, s.y, s.z + 3, 0], { recordEdit: false });
    return {
      leaves: I.blockDrops(BLOCK.LEAVES, shears),
      leavesTime: I.breakTime(BLOCK.LEAVES, shears),
      leavesHand: I.breakTime(BLOCK.LEAVES, null),
      wool: I.breakTime(BLOCK.WOOL, shears),
      grass: I.blockDrops(BLOCK.TALL_GRASS, shears),
      goldStone: I.breakTime(BLOCK.STONE, gold),
      mining,
      goldIron: I.canHarvest(BLOCK.IRON_ORE, gold),
      ores: [BLOCK.IRON_ORE, BLOCK.GOLD_ORE, BLOCK.DIAMOND_ORE, BLOCK.COAL_ORE].map((id) => I.blockDrops(id, ironPick)[0]?.[0]),
      gravel: [I.blockDrops(BLOCK.GRAVEL, null, () => 0.05)[0][0], I.blockDrops(BLOCK.GRAVEL, null, () => 0.5)[0][0]],
      ids: [V.RAW_IRON, V.RAW_GOLD, V.DIAMOND, I.ITEM.COAL, V.FLINT],
    };
  }, site);
  assert(r.leaves[0]?.[0] === 7 && r.leavesTime < 0.05 && r.leavesHand > 0.25 && r.wool < 0.3 && r.grass[0]?.[0] === 20, `shears ${JSON.stringify(r)}`);
  assert(Math.abs(r.goldStone - 0.1875) < 1e-6 && Math.abs(r.mining - 0.1875) < 1e-6 && !r.goldIron, `gold ${JSON.stringify(r)}`);
  assert(String(r.ores) === String(r.ids.slice(0, 4)) && r.gravel[0] === r.ids[4] && r.gravel[1] === 12, `ores and gravel ${JSON.stringify(r)}`);
});

await check("a Survival world's village chest holds the classic village loot", async () => {
  const r = await v(async () => {
    const C = await import("./js/chests.js");
    const { ALL_WEAPONS } = await import("./js/items.js");
    let n = 0;
    const seen = new Set();
    for (let i = 0; i < 60; i++) for (const [id, count] of C.rollChestLoot(5, new Set())) {
      seen.add(id);
      n += count;
    }
    return { kinds: seen.size, n, guns: ALL_WEAPONS.filter((id) => seen.has(id)).length, emerald: seen.has(324), bread: seen.has(347) };
  });
  assert(r.kinds > 8 && r.guns === 0 && r.emerald && r.bread, JSON.stringify(r));
});

await check("the compass and the clock turn in hand", async () => {
  const r = await v(async (g) => {
    const V = await import("./js/content/ids.js");
    const h = g.held;
    await window.__ti.hold(g, V.COMPASS);
    const frame = async () => {
      h.setItem(g.inventory.selectedStack.id, true);
      h.update(0.016, g.player, g.player.light ?? { sky: 15, block: 0 }, g.camera, 0);
      return h._dialFrame;
    };
    g.player.yaw = 0;
    const a = await frame();
    g.player.yaw = Math.PI / 2;
    const b = await frame();
    await window.__ti.hold(g, V.CLOCK);
    g.sky.setHours(12);
    g.sky.update(0.001, g.camera.position, new g.THREE.Vector3(0, 0, -1));
    const noon = await frame();
    g.sky.setHours(0);
    g.sky.update(0.001, g.camera.position, new g.THREE.Vector3(0, 0, -1));
    const midnight = await frame();
    return { a, b, noon, midnight, target: h.compassTarget };
  });
  const turn = (((r.b - r.a) % 32) + 32) % 32;
  assert(r.target && turn === 8, `a quarter turn of the view to the left turns the needle a quarter to the right: ${JSON.stringify(r)}`);
  assert(r.noon === 16 && r.midnight === 48, `the clock's dial: ${JSON.stringify(r)}`);
});

// ================= A Missions world =================
// (A fresh browser profile: Play would continue the last world, the Survival one.)
await page.context().close();
page = await newPage();
await boot(`seed=${SEED + 1}`);

await check("a Missions world: the bow needs no arrows, ores and chests as before", async () => {
  const r = await v(async (g) => {
    const I = await import("./js/items.js");
    const C = await import("./js/chests.js");
    const { BLOCK } = await import("./js/blocks.js");
    const w = g.weapons;
    g.testFlags.noMissions = true;
    g.setMode("survival");
    g.inventory.clear();
    await window.__ti.hold(g, I.ITEM.BOW);
    const n = w.arrows.length;
    w.refill();
    w.press("bow");
    w.bow.t = 1;
    w.release();
    const ironPick = I.itemInfo(I.ITEM.IRON_PICKAXE).tool;
    const loot = new Set();
    for (let i = 0; i < 30; i++) for (const [id] of C.rollChestLoot(2, new Set())) loot.add(id);
    return {
      type: g.worldType,
      shot: w.arrows.length - n,
      pickup: w.arrows[w.arrows.length - 1]?.pickup,
      ores: [BLOCK.IRON_ORE, BLOCK.GOLD_ORE, BLOCK.DIAMOND_ORE].map((id) => I.blockDrops(id, ironPick)[0]?.[0]),
      gravel: I.blockDrops(BLOCK.GRAVEL, null, () => 0.01)[0][0],
      grass: I.blockDrops(BLOCK.TALL_GRASS, null, () => 0.01).length,
      vanillaLoot: [324, 347, 320].filter((id) => loot.has(id)).length,
    };
  });
  assert(r.type === "missions", `a Missions world: ${r.type}`);
  assert(r.shot === 1 && r.pickup === false, `the bow shoots without arrows: ${JSON.stringify(r)}`);
  assert(String(r.ores) === "10,259,10" && r.gravel === 12 && r.grass === 0 && r.vanillaLoot === 0, `drops and loot as before: ${JSON.stringify(r)}`);
});

// ---------- Summary ----------
const failed = results.filter(([, ok]) => !ok);
console.log(`\n${results.length - failed.length} passed, ${failed.length} failed${errors.length ? `; console errors: ${errors.length}` : ""}.`);
if (errors.length) console.log(errors.slice(0, 5).join("\n"));
await browser.close();
server.close();
process.exit(failed.length || errors.length ? 1 : 0);
