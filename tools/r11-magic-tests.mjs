// Round 11 magic tests (enchanting, anvils, brewing and potions): boots the
// real game in headless Chromium (software WebGL, Low preset, drawing off)
// in a new Survival world and checks the magic blocks and items exist (with
// icons, in the palette, under the texture budget); an Efficiency pickaxe
// mines stone faster; Silk Touch drops stone; Fortune raises diamond drops
// on average; Sharpness raises a blow's damage (Smite more on a zombie);
// the anvil combines two worn tools, merges and raises enchantments,
// renames, refuses conflicts and costs levels; the enchanting table counts
// its bookshelves, offers three enchantments and makes an enchanted book
// for lapis and levels; potions of healing heal, poison poisons, a splash
// potion reaches the player, the brewing stand brews swiftness from a water
// bottle and sugar; a cauldron fills a glass bottle; enchantments survive a
// chest round trip and a save and a reload. Needs the magic part's patches
// to main.js and the shared files (the test hook g.brewing, the stack codec).
//
//   node r11-magic-tests.mjs [--only=substring] [--seed=4711]
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
const PORT = 9840 + Math.floor(Math.random() * 40);
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
const ctx = await browser.newContext({ viewport: { width: 960, height: 540 } });
const page = await ctx.newPage();
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
// In-page helpers (again after every load): a test site, aiming, stacks.
const helpers = () =>
  page.evaluate(() => {
    const rr = window.__ufo.renderer;
    if (rr && !rr.__noDraw) {
      rr.__noDraw = true;
      rr.render = (scene, camera) => {
        scene?.updateMatrixWorld?.();
        camera?.updateMatrixWorld?.();
      };
    }
    window.__tm = {
      // A 13x13 stone floor with air above, near the spawn. (x, y, z): the cell over its middle.
      site(g) {
        g.testFlags.noMissions = true;
        const w = g.world;
        const x = Math.floor(g.spawn.x) + 11;
        const z = Math.floor(g.spawn.z) + 11;
        w.prepareArea(x, z, 2);
        const y = Math.max(w.surfaceY(x, z) + 1, 34);
        const list = [];
        for (let ax = -6; ax <= 6; ax++) {
          for (let az = -6; az <= 6; az++) {
            list.push(x + ax, y - 1, z + az, 3);
            for (let ay = 0; ay <= 6; ay++) list.push(x + ax, y + ay, z + az, 0);
          }
        }
        w.setBlocks(list, { recordEdit: false });
        w.processQueues(50);
        return (window.__tm.at = { x, y, z });
      },
      // Stands the player's eye off face n of block (x, y, z), looking at it.
      aim(g, [x, y, z], [nx, ny, nz], d = 2.2) {
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
      // Mines the block under the crosshair with whatever is in hand: the
      // interaction's own steps (on the ground), counted in 0.05 s ticks.
      mine(g, max = 4000) {
        const it = g.interaction;
        const t = it.target;
        if (!t) return -1;
        const [x, y, z] = t.block;
        it.leftDown = true;
        it._breakCooldown = 0;
        it.mining = null;
        let n = 0;
        while (g.world.getBlock(x, y, z) !== 0 && n < max) {
          g.player.onGround = true;
          g.player.flying = false;
          it._updateMining(0.05);
          n++;
        }
        it.leftDown = false;
        it._stopMining();
        return n;
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
await v((g) => {
  window.__tm.site(g);
  g.setMode("survival");
  g.player.flying = false;
});

await check("the magic blocks and items: names, icons, the palette, recipes, the texture budget", async () => {
  const r = await v(async () => {
    const V = await import("./js/content/ids.js");
    const I = await import("./js/items.js");
    const B = await import("./js/blocks.js");
    const T = await import("./js/itemtextures.js");
    const IV = await import("./js/content/items-vanilla.js");
    const C = await import("./js/content/containers.js");
    const X = await import("./js/content/index.js");
    const blocks = [V.ENCHANTING_TABLE, V.ANVIL, C.CHIPPED_ANVIL, C.DAMAGED_ANVIL, V.BREWING_STAND, V.CAULDRON].map((id) => B.BLOCK_INFO[id]?.name || `?${id}`);
    const potions = IV.POTIONS.length;
    const bad = [];
    for (const id of [V.POTION, V.EXPERIENCE_BOTTLE, V.ENCHANTED_BOOK, IV.FERMENTED_SPIDER_EYE, IV.GLISTERING_MELON_SLICE, ...IV.POTIONS.flatMap((p) => [p.id, p.splash])]) {
      const px = T.itemIconPixels(id);
      let n = 0;
      for (let i = 3; i < (px?.length ?? 0); i += 4) if (px[i]) n++;
      if (!I.itemInfo(id)?.name || n < 30) bad.push(id);
    }
    const pal = [V.ENCHANTING_TABLE, V.ANVIL, V.BREWING_STAND, V.CAULDRON, V.POTION, IV.POTIONS[0].id, IV.POTIONS[0].splash, V.EXPERIENCE_BOTTLE].map((id) => I.CREATIVE_ITEMS.includes(id));
    const results = X.recipes().map((r) => r.result?.[0]);
    const recipes = [V.BREWING_STAND, IV.FERMENTED_SPIDER_EYE, IV.GLISTERING_MELON_SLICE].map((id) => results.includes(id));
    return { blocks, potions, bad, pal, recipes, tiles: B.TILE_NAMES.length, gravity: B.HAS_GRAVITY[V.ANVIL + 2], stack: [I.maxStack(IV.POTIONS[0].id), I.maxStack(V.ENCHANTED_BOOK)] };
  });
  assert(r.blocks.join() === "Enchanting Table,Anvil,Chipped Anvil,Damaged Anvil,Brewing Stand,Cauldron", `blocks ${r.blocks}`);
  assert(r.potions === 29 && r.bad.length === 0, `potions ${r.potions}, without a name or icon: ${r.bad}`);
  assert(r.pal.every(Boolean), `in the creative palette: ${r.pal}`);
  assert(r.recipes.every(Boolean), `recipes: ${r.recipes}`);
  assert(r.tiles <= 256, `texture layers: ${r.tiles}`);
  assert(r.gravity === 1 && String(r.stack) === "1,1", `the anvil falls; potions and books stack to 1: ${r.gravity} ${r.stack}`);
});

await check("an Efficiency V pickaxe mines stone faster", async () => {
  const r = await v(async (g) => {
    const { makeStack } = await import("./js/inventory.js");
    const { ITEM } = await import("./js/items.js");
    const { x, y, z } = window.__tm.at;
    const out = {};
    for (const [key, tag] of [["plain", undefined], ["eff", { ench: [["efficiency", 5]] }]]) {
      g.world.setBlock(x, y, z, 3);
      g.inventory.slots[0] = makeStack(ITEM.IRON_PICKAXE, 1, undefined, tag);
      g.inventory.selected = 0;
      window.__tm.aim(g, [x, y, z], [0, 0, 1]);
      out[key] = window.__tm.mine(g);
    }
    return out;
  });
  // (stone 1.5 x 1.5 / 6 = 0.375 s plain; with Efficiency V speed 6 + 26: 0.07 s)
  // (the first step starts the mining)
  assert(r.plain > 4 && r.eff >= 1 && (r.eff - 1) * 3 < r.plain - 1, `ticks to mine: ${JSON.stringify(r)}`);
});

await check("Silk Touch drops stone; Fortune III gives more diamonds on average", async () => {
  const r = await v(async (g) => {
    const { makeStack } = await import("./js/inventory.js");
    const I = await import("./js/items.js");
    const V = await import("./js/content/ids.js");
    const { x, y, z } = window.__tm.at;
    g.world.setBlock(x, y, z, 3);
    g.inventory.slots[0] = makeStack(I.ITEM.IRON_PICKAXE, 1, undefined, { ench: [["silk_touch", 1]] });
    g.inventory.selected = 0;
    const before = g.entities.items.length;
    window.__tm.aim(g, [x, y, z], [0, 0, 1]);
    window.__tm.mine(g);
    const dropped = g.entities.items.slice(before).map((it) => it.id);
    const tool = I.itemInfo(I.ITEM.IRON_PICKAXE).tool;
    const avg = (ench) => {
      let n = 0;
      for (let k = 0; k < 3000; k++) for (const [id, c] of I.blockDrops(16, tool, Math.random, ench)) if (id === V.DIAMOND) n += c;
      return n / 3000;
    };
    return { dropped, plain: avg(null), fortune: avg({ fortune: 3 }), silkDiamond: I.blockDrops(16, tool, Math.random, { silk: true }).map(([id]) => id) };
  });
  assert(r.dropped.length === 1 && r.dropped[0] === 3, `silk touch on stone drops: ${r.dropped}`);
  assert(r.silkDiamond.join() === "16", `silk touch on diamond ore: ${r.silkDiamond}`);
  assert(Math.abs(r.plain - 1) < 0.01 && r.fortune > 1.9 && r.fortune < 2.5, `diamonds a block: ${r.plain} plain, ${r.fortune} with Fortune III (vanilla 2.2)`);
});

await check("Sharpness raises a blow's damage (Smite more on a zombie)", async () => {
  const r = await v(async (g) => {
    const { makeStack } = await import("./js/inventory.js");
    const { ITEM } = await import("./js/items.js");
    const { x, y, z } = window.__tm.at;
    const mobs = g.mobs;
    const out = {};
    for (const [key, tag] of [["plain", undefined], ["sharp", { ench: [["sharpness", 5]] }], ["smite", { ench: [["smite", 5]] }]]) {
      const m = mobs.spawn("zombie", x + 0.5, y, z + 2.5);
      m.health = m.maxHealth = 100;
      g.inventory.slots[0] = makeStack(ITEM.DIAMOND_SWORD, 1, undefined, tag);
      g.inventory.selected = 0;
      g.player.position.set(x + 0.5, y, z + 1);
      g.player.velocity.set(0, 0, 0);
      g.player.onGround = true;
      mobs.lastAttackTime = mobs.time - 10;
      m.invulnerable = 0;
      g.interaction.entityHit = { mob: m, distance: 1.2 };
      g.interaction.target = null;
      g.interaction._primary();
      out[key] = 100 - m.health;
      m.health = 0;
      m.dead = true;
    }
    return out;
  });
  // (diamond sword 7; Sharpness V +3; Smite V +12.5 on the undead)
  assert(Math.abs(r.plain - 7) < 0.01 && Math.abs(r.sharp - 10) < 0.01 && Math.abs(r.smite - 19.5) < 0.01, `damage: ${JSON.stringify(r)}`);
});

await check("the anvil: combines worn tools and enchantments, renames, refuses conflicts, costs levels and may wear", async () => {
  const r = await v(async (g) => {
    const E = await import("./js/enchant.js");
    const V = await import("./js/content/ids.js");
    const { ITEM } = await import("./js/items.js");
    const { makeStack } = await import("./js/inventory.js");
    const pick = (dur, ench) => makeStack(ITEM.DIAMOND_PICKAXE, 1, dur, ench ? { ench } : undefined);
    const book = (ench) => ({ id: V.ENCHANTED_BOOK, count: 1, tag: { ench } });
    const a = E.anvilResult(pick(500, [["efficiency", 4]]), pick(600, [["efficiency", 4], ["unbreaking", 2]]), "Diamond Pickaxe");
    const b = E.anvilResult(pick(1562), book([["silk_touch", 1]]), "");
    const conflict = E.anvilResult(pick(1562, [["silk_touch", 1]]), book([["fortune", 3]]), "Diamond Pickaxe");
    const rename = E.anvilResult(pick(1562), null, "Digger");
    const repair = E.anvilResult(pick(100), { id: V.DIAMOND, count: 5 }, "Diamond Pickaxe");
    const wrong = E.anvilResult({ id: ITEM.DIAMOND_SWORD, count: 1, dur: 1562 }, book([["efficiency", 2]]), "Diamond Sword");
    // The screen: an anvil placed, the result taken for levels.
    const { x, y, z } = window.__tm.at;
    g.world.setBlock(x, y, z, V.ANVIL);
    const s = g.invScreen;
    s.screenPos = [x, y, z];
    g.player.xpLevel = 30;
    s.open("anvil", false);
    s.anvilSlots[0] = pick(500, [["efficiency", 4]]);
    s.anvilSlots[1] = pick(600, [["efficiency", 4]]);
    s._localChanged();
    s.refresh();
    const cost = s._anvilResult()?.cost;
    s._click({ area: "anvilOut", index: 0 }, 0, false);
    const taken = s.cursor ? { id: s.cursor.id, ench: s.cursor.tag?.ench, level: g.player.xpLevel } : null;
    s.close();
    // (Wear: 12% a use; forced here.)
    s.screenPos = [x, y, z];
    g.world.setBlock(x, y, z, V.ANVIL);
    s._wearAnvil();
    const worn = g.world.getBlock(x, y, z);
    return {
      a: a && { dur: a.out.dur, ench: a.out.tag.ench, cost: a.cost, rc: a.out.tag.rc },
      b: b && { ench: b.out.tag.ench, cost: b.cost },
      conflict,
      rename: rename && { name: rename.out.tag.name, cost: rename.cost },
      repair: repair && { dur: repair.out.dur, use: repair.use, cost: repair.cost },
      wrong,
      cost,
      taken,
      worn,
    };
  });
  // (500 + 600 + 12% of 1562 = 1287; Efficiency IV + IV = V (1 a level x 5) + Unbreaking II (2 x 2) + 2 for the repair)
  assert(r.a && r.a.dur === 1287 && JSON.stringify(r.a.ench) === JSON.stringify([["efficiency", 5], ["unbreaking", 2]]) && r.a.cost === 11 && r.a.rc === 1, `combine: ${JSON.stringify(r.a)}`);
  assert(r.b && JSON.stringify(r.b.ench) === '[["silk_touch",1]]' && r.b.cost === 4, `a book (very rare: 8, halved for a book): ${JSON.stringify(r.b)}`);
  assert(r.conflict === null && r.wrong === null, `silk touch with fortune, efficiency on a sword: refused: ${JSON.stringify([r.conflict, r.wrong])}`);
  assert(r.rename && r.rename.name === "Digger" && r.rename.cost === 1, `rename: ${JSON.stringify(r.rename)}`);
  assert(r.repair && r.repair.dur === 1562 && r.repair.use === 4 && r.repair.cost === 4, `repair with diamonds (390 a diamond, four of the five): ${JSON.stringify(r.repair)}`);
  assert(r.taken && r.taken.level === 30 - r.cost && JSON.stringify(r.taken.ench) === '[["efficiency",5]]', `taken on the screen for ${r.cost} levels: ${JSON.stringify(r.taken)}`);
  assert(r.worn === 1811, `a worn anvil is chipped: ${r.worn}`);
});

await check("the enchanting table: bookshelves, three offers, an enchanted book for lapis and levels", async () => {
  const r = await v(async (g) => {
    const E = await import("./js/enchant.js");
    const V = await import("./js/content/ids.js");
    const { x, y, z } = window.__tm.at;
    const list = [x, y, z, V.ENCHANTING_TABLE];
    for (let dx = -2; dx <= 2; dx++) for (let dz = -2; dz <= 2; dz++) if (Math.abs(dx) === 2 || Math.abs(dz) === 2) list.push(x + dx, y, z + dz, V.BOOKSHELF, x + dx, y + 1, z + dz, V.BOOKSHELF);
    g.world.setBlocks(list);
    const shelves = E.countBookshelves(g.world, x, y, z);
    const s = g.invScreen;
    s.screenPos = [x, y, z];
    g.player.xpLevel = 40;
    s.open("enchanting", false);
    s.enchSlots[0] = { id: V.BOOK, count: 1 };
    s.enchSlots[1] = { id: V.LAPIS_LAZULI, count: 5 };
    s._localChanged();
    s.refresh();
    const offers = s._enchantOffers().map((o) => o.cost);
    const shown = s.offerEls.map((b) => b.firstChild.textContent);
    s._enchant(2);
    const made = s.enchSlots[0];
    const out = { shelves, offers, shown, made: made && { id: made.id, ench: made.tag?.ench }, level: g.player.xpLevel, lapis: s.enchSlots[1]?.count };
    s.close();
    // Many offers on a diamond sword: only sword enchantments, never two that conflict.
    const kinds = new Set();
    let conflicts = 0;
    for (let seed = 1; seed < 300; seed++) {
      for (const o of E.tableOffers({ id: 273, count: 1 }, 15, seed) || []) {
        for (const [k] of o.list) kinds.add(k);
        for (let i = 0; i < o.list.length; i++) for (let j = i + 1; j < o.list.length; j++) if (!E.compatible(o.list[i][0], o.list[j][0])) conflicts++;
      }
    }
    out.kinds = [...kinds].sort();
    out.conflicts = conflicts;
    return out;
  });
  assert(r.shelves === 15, `bookshelves: ${r.shelves}`);
  assert(r.offers[2] === 30 && r.offers[0] >= 1 && r.offers[1] > r.offers[0], `offer costs with 15 shelves: ${r.offers}`);
  assert(r.shown.every((t) => t.endsWith(". . . ?")), `the clues: ${r.shown}`);
  assert(r.made && r.made.id === 391 && r.made.ench?.length >= 1 && r.level === 37 && r.lapis === 2, `enchanted: ${JSON.stringify(r)}`);
  assert(r.conflicts === 0 && r.kinds.every((k) => ["sharpness", "smite", "bane_of_arthropods", "knockback", "fire_aspect", "looting", "unbreaking"].includes(k)) && r.kinds.includes("sharpness"), `sword offers: ${r.kinds} (${r.conflicts} conflicts)`);
});

await check("potions: healing heals, poison poisons, a splash reaches the player; the brewing stand brews; a cauldron fills a bottle", async () => {
  const r = await v(async (g) => {
    const IV = await import("./js/content/items-vanilla.js");
    const V = await import("./js/content/ids.js");
    const Br = await import("./js/brewing.js");
    const { makeStack } = await import("./js/inventory.js");
    const p = g.player;
    const it = g.interaction;
    const drink = (id) => {
      g.inventory.slots[0] = makeStack(id, 1);
      g.inventory.selected = 0;
      it.target = null;
      it.entityHit = null;
      it._use();
      it.rightDown = true;
      it._updateUse(2);
      it.rightDown = false;
      return g.inventory.slots[0]?.id;
    };
    p.clearEffects();
    p.health = 8;
    p._invulnerable = 0;
    const bottle = drink(IV.potionId("healing"));
    const healed = p.health;
    drink(IV.potionId("poison"));
    const poison = p.effects.find((e) => e.effect === "poison");
    const hp0 = p.health;
    p._invulnerable = 0;
    p._updateEffects(1.3);
    const poisoned = hp0 - p.health;
    p.clearEffects();
    Br.splashOnPlayer(p, IV.potionId("swiftness", "base", true), 1);
    const speed = p.effects.find((e) => e.effect === "speed");
    p.clearEffects();
    // The brewing stand: awkward potions and sugar, blaze powder for fuel, 20 s (Round 12).
    const { x, y, z } = window.__tm.at;
    g.world.setBlock(x + 4, y, z, V.BREWING_STAND);
    const b = g.brewing.contents(x + 4, y, z);
    b.slots[0] = makeStack(V.AWKWARD_POTION, 1);
    b.slots[2] = makeStack(V.AWKWARD_POTION, 1);
    b.slots[3] = makeStack(V.SUGAR, 2);
    b.slots[4] = makeStack(V.BLAZE_POWDER, 1);
    for (let k = 0; k < 21; k++) g.brewing.update(1);
    const brewed = b.slots.map((s) => (s ? [s.id, s.count] : 0));
    // A cauldron: water bucket in, a bottle out.
    g.world.setBlock(x - 4, y, z, V.CAULDRON);
    window.__tm.aim(g, [x - 4, y, z], [0, 1, 0]);
    g.inventory.slots[0] = makeStack(V.WATER_BUCKET, 1);
    it.mouseDown(2);
    it.mouseUp(2);
    const full = g.world.getBlock(x - 4, y, z);
    g.inventory.slots[0] = makeStack(V.GLASS_BOTTLE, 1);
    it.updateTarget(true);
    it.mouseDown(2);
    it.mouseUp(2);
    return { bottle, healed, poison: poison && [poison.level, poison.time], poisoned, speed: speed && [speed.level, Math.round(speed.time)], brewed, swift: IV.potionId("swiftness"), full, after: g.world.getBlock(x - 4, y, z), filled: g.inventory.slots[0]?.id };
  });
  assert(r.bottle === 345 && r.healed === 12, `healing: 8 -> ${r.healed} (Instant Health I: 4), the bottle back: ${r.bottle}`);
  assert(r.poison && r.poison[0] === 1 && r.poison[1] > 40 && r.poisoned === 1, `poison: ${JSON.stringify(r.poison)}, ${r.poisoned} lost in 1.3 s`);
  assert(r.speed && r.speed[0] === 1 && r.speed[1] === 135, `a splash of swiftness 1 block away: ${JSON.stringify(r.speed)} (3:00 x 0.75)`);
  assert(JSON.stringify(r.brewed) === JSON.stringify([[r.swift, 1], 0, [r.swift, 1], [410, 1], 0]), `brewed: ${JSON.stringify(r.brewed)}`);
  assert(r.full === 1809 && r.after === 1808 && r.filled === 392, `the cauldron: ${r.full} then ${r.after}, a ${r.filled}`);
});

await check("enchantments survive a chest round trip, a dropped item, and a save and a reload", async () => {
  const r = await v(async (g) => {
    const { makeStack, encodeStack, decodeStack } = await import("./js/inventory.js");
    const { ITEM } = await import("./js/items.js");
    const tag = { ench: [["efficiency", 3], ["unbreaking", 1]], name: "Old Faithful", rc: 1 };
    const st = makeStack(ITEM.IRON_PICKAXE, 1, 200, tag);
    // A chest: the codec it saves and sends with.
    const ch = g.interaction.chests;
    const { x, y, z } = window.__tm.at;
    g.world.setBlock(x + 3, y, z + 3, 41);
    const view = ch.openView(x + 3, y, z + 3, () => {});
    let ok = null;
    ch.submit([[4, null, st]], (k) => (ok = k));
    const saved = ch.serialize();
    ch.closeView();
    ch.load(saved);
    const back = ch.store.get(`${x + 3},${y},${z + 3}`)?.[4] ?? ch.contents?.(x + 3, y, z + 3)?.[4];
    // A dropped item picked up again.
    const it = g.entities.spawn(st.id, 1, g.player.position.clone(), null, { dur: st.dur, tag: st.tag, pickupDelay: 0 });
    g.inventory.clear();
    const left = g.entities.onPickup(it);
    const picked = g.inventory.slots.find(Boolean);
    // The inventory saved, then the page reloaded.
    g.inventory.clear();
    g.inventory.slots[3] = makeStack(ITEM.IRON_PICKAXE, 1, 200, tag);
    g.inventory.armor[3] = makeStack(ITEM.DIAMOND_BOOTS, 1, undefined, { ench: [["feather_falling", 4]] });
    g.flushSave();
    return { ok, view: !!view, back: back && { tag: back.tag, dur: back.dur }, round: decodeStack(JSON.parse(JSON.stringify(encodeStack(st))))?.tag, left, picked: picked && picked.tag };
  });
  const tagJson = JSON.stringify({ ench: [["efficiency", 3], ["unbreaking", 1]], name: "Old Faithful", rc: 1 });
  assert(r.ok && r.back && JSON.stringify(r.back.tag) === tagJson && r.back.dur === 200, `a chest: ${JSON.stringify(r)}`);
  assert(JSON.stringify(r.round) === tagJson, `the codec: ${JSON.stringify(r.round)}`);
  assert(r.left === 0 && JSON.stringify(r.picked) === tagJson, `picked up: ${JSON.stringify(r.picked)}`);
  await boot(`seed=${SEED}&type=survival`);
  await v((g) => {
    window.__tm.site(g);
    g.setMode("survival");
    g.player.flying = false;
  });
  const s = await v((g) => ({ slot: g.inventory.slots[3] && { id: g.inventory.slots[3].id, tag: g.inventory.slots[3].tag, dur: g.inventory.slots[3].dur }, boots: g.inventory.armor[3]?.tag }));
  assert(s.slot && JSON.stringify(s.slot.tag) === tagJson && s.slot.dur === 200, `after the reload: ${JSON.stringify(s)}`);
  assert(JSON.stringify(s.boots) === '{"ench":[["feather_falling",4]]}', `the boots after the reload: ${JSON.stringify(s.boots)}`);
});

await check("Feather Falling and Protection take damage away; Unbreaking saves wear", async () => {
  const r = await v(async () => {
    const S = await import("./js/survival.js");
    const E = await import("./js/enchant.js");
    const boots = { id: 315, count: 1, tag: { ench: [["feather_falling", 4]] } };
    const prot = [1, 2, 3, 4].map(() => ({ id: 312, count: 1, tag: { ench: [["protection", 4]] } }));
    let kept = 0;
    const tool = { id: 277, count: 1, tag: { ench: [["unbreaking", 3]] } };
    for (let k = 0; k < 4000; k++) if (E.unbreakingSaves(tool)) kept++;
    return { fall: S.protectedDamage(10, "fall", [null, null, null, boots]), hit: S.protectedDamage(10, "zombie", prot), voidDmg: S.protectedDamage(10, "void", prot), kept: kept / 4000 };
  });
  // (Feather Falling IV: 12 points = 48% off a fall; four Protection IV: 16 points = 64%; the void: nothing)
  assert(r.fall === 5 && r.hit === 4 && r.voidDmg === 10, `damage left: ${JSON.stringify(r)}`);
  assert(r.kept > 0.7 && r.kept < 0.8, `Unbreaking III keeps 3 in 4 uses: ${r.kept}`);
});

await check("the bow: Power hits harder, Infinity keeps the arrow; Fire Aspect sets a zombie alight; Looting is kept for its drops", async () => {
  const r = await v(async (g) => {
    const { makeStack } = await import("./js/inventory.js");
    const { ITEM } = await import("./js/items.js");
    const V = await import("./js/content/ids.js");
    const { x, y, z } = window.__tm.at;
    const mobs = g.mobs;
    const w = g.weapons;
    const p = g.player;
    // An arrow at a zombie straight ahead, drawn fully, with and without Power V.
    const shotAt = (ench) => {
      const m = mobs.spawn("zombie", x + 0.5, y, z - 3.5);
      m.health = m.maxHealth = 100;
      m.invulnerable = 0;
      p.position.set(x + 0.5, y, z + 1.5);
      p.yaw = 0;
      p.pitch = -0.05;
      w.shootArrow(1, { ench });
      for (let k = 0; k < 40 && w.arrows.length; k++) w._updateArrows(0.02);
      w.arrows.length = 0;
      const lost = 100 - m.health;
      m.health = 0;
      m.dead = true;
      return lost;
    };
    const plain = shotAt(null);
    const power = shotAt({ power: 5, punch: 0, flame: 1 });
    // Infinity: one arrow in the inventory stays.
    g.inventory.clear();
    g.inventory.slots[0] = makeStack(ITEM.BOW, 1, undefined, { ench: [["infinity", 1]] });
    g.inventory.slots[5] = makeStack(V.ARROW, 1);
    g.inventory.selected = 0;
    w.refill();
    w.press("bow");
    w.bow.t = 1.2;
    w.release();
    const arrowsLeft = g.inventory.countItem(V.ARROW);
    const flew = w.arrows.length;
    const pickup = w.arrows[0]?.pickup;
    w.arrows.length = 0;
    // Fire Aspect II and Looting III on a sword.
    const m = mobs.spawn("zombie", x + 0.5, y, z + 2.5);
    m.health = m.maxHealth = 100;
    g.inventory.slots[0] = makeStack(ITEM.DIAMOND_SWORD, 1, undefined, { ench: [["fire_aspect", 2], ["looting", 3]] });
    p.position.set(x + 0.5, y, z + 1);
    mobs.lastAttackTime = mobs.time - 10;
    m.invulnerable = 0;
    g.interaction.entityHit = { mob: m, distance: 1.2 };
    g.interaction._primary();
    const fire = m.fireT;
    const looting = m.looting;
    m.health = 0;
    m.dead = true;
    return { plain, power, arrowsLeft, flew, pickup, fire, looting };
  });
  // (a full draw: 10; Power V: x2.5)
  assert(r.plain === 10 && r.power === 25, `arrow damage: ${r.plain} plain, ${r.power} with Power V`);
  assert(r.arrowsLeft === 1 && r.flew === 1 && r.pickup === false, `Infinity: ${JSON.stringify(r)}`);
  assert(r.fire === 8 && r.looting === 3, `Fire Aspect II: 8 s of fire, Looting III kept: ${r.fire} ${r.looting}`);
});

await check("thrown bottles: a splash of harming hurts, the bottle o' enchanting gives experience; a glass bottle fills at water", async () => {
  const r = await v(async (g) => {
    const IV = await import("./js/content/items-vanilla.js");
    const V = await import("./js/content/ids.js");
    const { makeStack } = await import("./js/inventory.js");
    const { x, y, z } = window.__tm.at;
    const p = g.player;
    const th = g.potionThrows;
    p.position.set(x + 0.5, y, z + 0.5);
    p.velocity.set(0, 0, 0);
    p.pitch = -Math.PI / 2 + 0.05;
    p.health = 20;
    p._invulnerable = 0;
    th.throw(IV.potionId("harming", "base", true));
    for (let k = 0; k < 200 && th.list.length; k++) th.update(0.02);
    const hurt = 20 - p.health;
    const orbs0 = g.xp?.orbs?.length ?? null;
    const lvl0 = p.xpTotal;
    th.throw(V.EXPERIENCE_BOTTLE);
    for (let k = 0; k < 200 && th.list.length; k++) th.update(0.02);
    const orbs = g.xp?.orbs ? g.xp.orbs.length - orbs0 : null;
    // A glass bottle at a water block.
    g.world.setBlock(x + 1, y - 1, z, 5);
    window.__tm.aim(g, [x + 1, y - 1, z], [0, 1, 0]);
    g.inventory.slots[0] = makeStack(V.GLASS_BOTTLE, 3);
    g.inventory.selected = 0;
    g.interaction.weapons.rightReleases++;
    g.interaction._use();
    return { hurt, orbs, lvl0, held: [g.inventory.slots[0]?.id, g.inventory.slots[0]?.count], water: g.inventory.countItem(V.POTION) };
  });
  // (Instant Damage I at the feet: 6 x (1 - 0.9/4), armor no help)
  assert(r.hurt >= 4 && r.hurt <= 6, `a splash of harming at the feet: ${r.hurt}`);
  assert(r.orbs === null || r.orbs >= 1, `experience orbs: ${r.orbs}`);
  assert(r.held[0] === 345 && r.held[1] === 2 && r.water === 1, `a water bottle filled: ${JSON.stringify(r)}`);
});

// ---------- Summary ----------
const passed = results.filter(([, ok]) => ok).length;
console.log(`\n${passed}/${results.length} passed`);
await browser.close();
server.close();
process.exit(passed === results.length && results.length > 0 ? 0 : 1);
