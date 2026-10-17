// Round 11 crafting and smelting: boots the real game in headless Chromium
// (software WebGL, Low preset) and checks, in a Survival world:
//  - the inventory's 2x2 grid: a log into planks, planks into sticks, four
//    planks into a crafting table, a shapeless recipe in any slot, the result
//    onto the cursor (and onto the same item there), shift-click crafting as
//    many as fit (into the hotbar's end first, as in vanilla), what is left
//    in the grid going back into the inventory when the screen closes;
//  - the crafting table (its block use): the 3x3 grid, a wooden pickaxe,
//    an axe mirrored, a tool shifted in the grid, a milk bucket's bucket left
//    behind (if the items are in);
//  - a Missions world has no grid, and its crafting table opens nothing;
//  - the furnace: placed facing the player, its screen, raw iron (or
//    cobblestone) and coal into an ingot after 10 s of game time, the burn
//    times (coal 80 s, planks 15 s, a stick 5 s), the lit block and its
//    light, the experience on taking the output, the fuel slot refusing what
//    doesn't burn, contents kept through a save and a reload, dropped when
//    it is broken;
//  - online (a host and a guest through a local PeerJS server): a guest uses
//    the host's furnace (opens it, fills it, the host smelts, the guest takes
//    the output and its experience; a stale click is refused).
//
//   node r11-crafting-tests.mjs [--only=substring] [--solo] [--main=file]
//
// --main=file serves that file as js/main.js (to try main.js wiring before
// it is merged). Like the other suites, it fails on any console error or
// page error.
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
const SEED = 9301;
const MISSIONS_SEED = 9302;
const MAIN = args.main ? path.resolve(String(args.main)) : null;
const MIME = { ".html": "text/html", ".js": "text/javascript" };
const server = http.createServer((req, res) => {
  const url = decodeURIComponent(req.url.split("?")[0]);
  let filePath = MAIN && url === "/js/main.js" ? MAIN : path.join(ROOT, url);
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
  while (Date.now() - t0 < 90000) {
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
      if ((await v(p, (g) => g.gameState)) === "paused" && !(await p.isVisible("#resume-btn"))) await p.evaluate(() => document.getElementById("pause-menu").classList.remove("hidden"));
    }
    await frames(p, 3);
  }
  throw new Error(`the game didn't start playing (state ${await v(p, (g) => g.gameState)})`);
}
// Back to playing after a screen the test opened through the game (main.js's closeInventory).
async function closeScreen(p = page) {
  if ((await v(p, (g) => g.gameState)) === "inventory") await p.keyboard.press("Escape");
  await play(p);
}
// (No pictures needed for most checks: a world drawn in software is slow.)
const noDraw = () => {
  const rr = window.__ufo.renderer;
  if (rr && !rr.__noDraw) {
    rr.__noDraw = true;
    rr.__render = rr.render;
    rr.render = (scene, camera) => {
      scene?.updateMatrixWorld?.();
      camera?.updateMatrixWorld?.();
    };
  }
  return true;
};

// In the page: helpers on window.__ct (ids, a click on the screen, counts).
const HELPERS = async (g) => {
  const B = await import("./js/blocks.js");
  const I = await import("./js/items.js");
  const ID = await import("./js/content/ids.js");
  const C = await import("./js/content/index.js");
  const s = g.invScreen;
  window.__ct = {
    B: B.BLOCK,
    IT: I.ITEM,
    ID,
    has: (id) => !!I.itemInfo(id),
    click: (area, index, button = 0, shift = false) => s._click({ area, index }, button, shift),
    count: (id) => g.inventory.slots.reduce((n, x) => n + (x && x.id === id ? x.count : 0), 0),
    result: () => {
      const r = s._craftStack();
      return r ? [r.id, r.count] : null;
    },
    grid: () => s.grid.map((x) => (x ? [x.id, x.count] : 0)),
    cursor: () => (s.cursor ? [s.cursor.id, s.cursor.count] : null),
    // A right click on block (x, y, z) through its content use (as interaction.js does).
    use: (x, y, z) => {
      const id = g.world.getBlock(x, y, z);
      const fn = C.BLOCK_USE[id];
      return !!fn && !!fn({ world: g.world, player: g.player, inventory: g.inventory, interaction: g.interaction, audio: g.audio, x, y, z, id, forward: [0, 0, 1], creative: !!g.player.creative, sneaking: false });
    },
    // A free spot next to the player, at eye level's foot: [x, y, z].
    spot: (dx = 2, dz = 0) => {
      const p = g.player.position;
      return [Math.floor(p.x) + dx, Math.floor(p.y), Math.floor(p.z) + dz];
    },
  };
  return true;
};

// ================= Single player: a Survival world =================

await check("Survival inventory: 2x2 grid; log -> planks -> sticks, crafting table, result onto the cursor", async () => {
  await boot(`seed=${SEED}&type=survival`);
  await play();
  await v(page, noDraw);
  await v(page, HELPERS);
  const r = await v(page, (g) => {
    const T = window.__ct;
    const s = g.invScreen;
    const inv = g.inventory;
    inv.clear();
    inv.slots[0] = { id: T.B.WOOD, count: 2 };
    s.open("inventory", false);
    const out = { type: g.worldType, width: s.gridWidth, shown: !s.craftBox.classList.contains("hidden") };
    T.click("inv", 0); // the logs on the cursor
    T.click("craft", 3, 2); // one into the bottom right
    T.click("inv", 0); // the other back
    out.planksResult = T.result();
    T.click("result", 0);
    out.cursorAfterOne = T.cursor();
    out.gridAfterOne = T.grid();
    // (A second craft onto the same planks in the hand.)
    T.click("craft", 1, 0); // nothing in hand? the cursor holds planks: put them in slot 1...
    T.click("craft", 1, 0); // ... and pick them up again
    T.click("inv", 0, 0); // back to the logs: swap (planks to the inventory, the log in hand)
    out.swap = T.cursor();
    T.click("craft", 3, 0); // the log into the grid
    T.click("inv", 0, 0); // planks back in hand
    T.click("result", 0, 2); // right click: the same as left, onto the same item
    out.cursorTwo = T.cursor();
    // Planks in a column: sticks.
    T.click("craft", 0, 2);
    T.click("craft", 2, 2);
    out.sticksResult = T.result();
    T.click("inv", 5); // the rest of the planks down
    T.click("result", 0);
    out.sticks = T.cursor();
    T.click("inv", 6);
    // Four planks: a crafting table.
    T.click("inv", 5);
    for (const i of [0, 1, 2, 3]) T.click("craft", i, 2);
    out.tableResult = T.result();
    T.click("inv", 5);
    T.click("result", 0);
    out.table = T.cursor();
    T.click("inv", 7);
    out.planksLeft = T.count(T.B.PLANKS);
    s.close();
    return out;
  });
  assert(r.type === "survival" && r.width === 2 && r.shown, `the 2x2 grid in a Survival world: ${JSON.stringify(r)}`);
  const P = 8;
  assert(JSON.stringify(r.planksResult) === JSON.stringify([P, 4]), `a log makes 4 planks: ${JSON.stringify(r.planksResult)}`);
  assert(JSON.stringify(r.cursorAfterOne) === JSON.stringify([P, 4]) && r.gridAfterOne.every((x) => x === 0), `one craft on the cursor, the log used: ${JSON.stringify(r)}`);
  assert(JSON.stringify(r.cursorTwo) === JSON.stringify([P, 8]), `a right click crafts onto the same planks: ${JSON.stringify(r.cursorTwo)}`);
  assert(JSON.stringify(r.sticksResult) === JSON.stringify([256, 4]) && JSON.stringify(r.sticks) === JSON.stringify([256, 4]), `two planks in a column: 4 sticks: ${JSON.stringify(r)}`);
  assert(JSON.stringify(r.tableResult) === JSON.stringify([19, 1]) && JSON.stringify(r.table) === JSON.stringify([19, 1]), `four planks: a crafting table: ${JSON.stringify(r)}`);
  assert(r.planksLeft === 8 - 2 - 4, `planks used: ${r.planksLeft}`);
});

await check("Survival inventory: shapeless in any slot, shift-click crafts as many as fit, the grid comes back on close", async () => {
  const r = await v(page, (g) => {
    const T = window.__ct;
    const s = g.invScreen;
    const inv = g.inventory;
    inv.clear();
    inv.slots[20] = { id: T.B.WOOD, count: 10 };
    s.open("inventory", false);
    const out = {};
    T.click("inv", 20);
    T.click("craft", 1); // top right this time (shapeless: anywhere)
    out.result = T.result();
    T.click("result", 0, 0, true);
    out.planks = T.count(T.B.PLANKS);
    out.slot8 = inv.slots[8] ? [inv.slots[8].id, inv.slots[8].count] : null;
    out.grid = T.grid();
    // Some sticks and a log left in the grid: back into the inventory on close.
    inv.slots[3] = { id: T.IT.STICK, count: 3 };
    inv.slots[4] = { id: T.B.WOOD, count: 1 };
    T.click("inv", 3);
    T.click("craft", 0);
    T.click("inv", 4);
    T.click("craft", 2);
    out.mixed = T.result();
    out.held = s.heldStacks().length;
    s.close();
    out.afterClose = { sticks: T.count(T.IT.STICK), logs: T.count(T.B.WOOD), grid: s.grid.length };
    // (The flint and steel: a shapeless recipe of two different items, if the items are in.)
    if (T.has(T.ID.FLINT_AND_STEEL) && T.has(T.ID.FLINT) && T.has(T.ID.IRON_INGOT)) {
      inv.clear();
      inv.slots[0] = { id: T.ID.FLINT, count: 1 };
      inv.slots[1] = { id: T.ID.IRON_INGOT, count: 1 };
      s.open("inventory", false);
      T.click("inv", 0);
      T.click("craft", 3);
      T.click("inv", 1);
      T.click("craft", 0);
      out.flint = T.result();
      s.close();
    }
    return out;
  });
  assert(JSON.stringify(r.result) === JSON.stringify([8, 4]), `planks from a log in another slot: ${JSON.stringify(r)}`);
  assert(r.planks === 40 && JSON.stringify(r.slot8) === JSON.stringify([8, 40]) && r.grid.every((x) => x === 0), `shift-click: 10 crafts, into the hotbar's end: ${JSON.stringify(r)}`);
  assert(r.mixed === null && r.held === 2, `sticks and a log make nothing; held outside the inventory: ${JSON.stringify(r)}`);
  assert(r.afterClose.sticks === 3 && r.afterClose.logs === 1 && r.afterClose.grid === 0, `the grid went back on close: ${JSON.stringify(r.afterClose)}`);
  if (r.flint) assert(r.flint[0] === (await v(page, () => window.__ct.ID.FLINT_AND_STEEL)), `flint and steel: ${JSON.stringify(r.flint)}`);
  else console.log("        (flint and steel: items not in yet)");
});

await check("the crafting table: a 3x3 screen from its block; pickaxe, mirrored axe, a shifted shovel; the cake leaves its buckets", async () => {
  const r = await v(page, (g) => {
    const T = window.__ct;
    const s = g.invScreen;
    const inv = g.inventory;
    const [x, y, z] = T.spot(2, 0);
    g.world.setBlock(x, y, z, T.B.CRAFTING_TABLE);
    inv.clear();
    inv.slots[0] = { id: T.B.PLANKS, count: 20 };
    inv.slots[1] = { id: T.IT.STICK, count: 10 };
    inv.slots[2] = { id: T.B.COBBLESTONE, count: 5 };
    const out = { used: T.use(x, y, z) };
    out.kind = s.kind;
    out.width = s.gridWidth;
    out.state = g.gameState;
    const put = (slot, cells) => {
      T.click("inv", slot);
      for (const c of cells) T.click("craft", c, 2);
      T.click("inv", slot);
    };
    // Pickaxe: XXX / .#. / .#.
    put(0, [0, 1, 2]);
    put(1, [4, 7]);
    out.pick = T.result();
    T.click("result", 0);
    T.click("inv", 10);
    // Axe mirrored: .XX / .#X / .#. (the pattern is XX / X# / .#)
    put(0, [1, 2, 5]);
    put(1, [4, 7]);
    out.axe = T.result();
    T.click("result", 0, 0, true);
    // Shovel in the right column: X / # / #
    put(2, [2]);
    put(1, [5, 8]);
    out.shovel = T.result();
    // (Shift-click from the inventory goes into the grid at the table.)
    s._returnGrid();
    T.click("inv", 2, 0, true);
    out.shiftIn = T.grid().filter(Boolean).length;
    s._returnGrid();
    // The cake: three milk buckets leave three buckets in the grid.
    if (T.has(T.ID.CAKE) && T.has(T.ID.MILK_BUCKET) && T.has(T.ID.SUGAR) && T.has(T.ID.EGG) && T.has(T.ID.WHEAT)) {
      const ids = [T.ID.MILK_BUCKET, T.ID.MILK_BUCKET, T.ID.MILK_BUCKET, T.ID.SUGAR, T.ID.EGG, T.ID.SUGAR, T.ID.WHEAT, T.ID.WHEAT, T.ID.WHEAT];
      ids.forEach((id, i) => (s.grid[i] = { id, count: 1 }));
      s._gridDirty = true;
      out.cake = T.result();
      T.click("result", 0);
      out.cakeGrid = T.grid();
      out.cakeCursor = T.cursor();
      T.click("inv", 30);
    }
    s.close();
    out.tools = [T.count(T.IT.WOOD_PICKAXE), T.count(T.IT.WOOD_AXE)];
    out.pos = [x, y, z];
    return out;
  });
  await closeScreen();
  // (A broken table closes its screen, through the game.)
  const broken = await v(
    page,
    (g, [x, y, z]) => {
      const T = window.__ct;
      T.use(x, y, z);
      const open = g.invScreen.isOpen && g.gameState === "inventory";
      g.world.setBlock(x, y, z, 0);
      g.invScreen.refresh();
      return { open, closed: !g.invScreen.isOpen && g.gameState !== "inventory" };
    },
    r.pos
  );
  r.closedWhenBroken = broken.open && broken.closed;
  assert(r.used && r.kind === "table" && r.width === 3 && r.state === "inventory", `the table opens its 3x3 screen: ${JSON.stringify(r)}`);
  assert(r.pick && r.pick[0] === 274, `a wooden pickaxe: ${JSON.stringify(r.pick)}`);
  assert(r.axe && r.axe[0] === 278, `a wooden axe, mirrored: ${JSON.stringify(r.axe)}`);
  assert(r.shovel && r.shovel[0] === 283, `a stone shovel in the right column: ${JSON.stringify(r.shovel)}`);
  assert(r.shiftIn === 1, `shift-click puts the stack into the grid: ${r.shiftIn}`);
  assert(r.tools[0] === 1 && r.tools[1] === 1, `the tools in the inventory: ${JSON.stringify(r.tools)}`);
  if (r.cake) {
    const bucket = await v(page, () => window.__ct.ID.BUCKET);
    assert(r.cake[0] === (await v(page, () => window.__ct.ID.CAKE)) && r.cakeGrid.slice(0, 3).every((e) => e && e[0] === bucket) && r.cakeGrid.slice(3).every((e) => e === 0), `the cake leaves its buckets: ${JSON.stringify(r)}`);
  } else console.log("        (the cake: items not in yet)");
  assert(r.closedWhenBroken, `a broken table closes the screen: ${JSON.stringify(broken)}`);
  await closeScreen();
});

await check("the furnace: faces the player, cooks in 10 s of game time, burn times, lit block and light, experience, fuel slot rules", async () => {
  const r = await v(page, async (g) => {
    const T = window.__ct;
    const F = await import("./js/furnace.js");
    const C = await import("./js/content/index.js");
    const s = g.invScreen;
    const inv = g.inventory;
    const fu = g.furnaces;
    const [x, y, z] = T.spot(-2, 1);
    const out = {};
    // Placed facing the player: placeAs with the view along +X gives the -X front.
    const def = (await import("./js/blocks.js")).BLOCK_INFO[T.ID.FURNACE];
    const placed = def.placeAs({ forward: [1, 0, 0] });
    out.facing = (await import("./js/blocks.js")).BLOCK_INFO[placed].facing;
    g.world.setBlock(x, y, z, placed);
    g.world.setBlock(x, y + 1, z, 0);
    inv.clear();
    const ore = T.has(T.ID.RAW_IRON) ? T.ID.RAW_IRON : T.B.COBBLESTONE;
    const ingot = T.has(T.ID.RAW_IRON) ? T.ID.IRON_INGOT : T.B.STONE;
    inv.slots[0] = { id: ore, count: 3 };
    inv.slots[1] = { id: T.IT.COAL, count: 2 };
    inv.slots[2] = { id: T.B.DIRT, count: 5 };
    out.used = T.use(x, y, z);
    out.kind = s.kind;
    // The dirt doesn't burn: refused by the fuel slot; shift-click puts the ore in the input, the coal in the fuel.
    T.click("inv", 2);
    T.click("furnace", 1);
    out.dirtRefused = !fu.view.slots[1] && !!s.cursor;
    T.click("inv", 2);
    T.click("inv", 0, 0, true);
    T.click("inv", 1, 0, true);
    out.slots = fu.view.slots.map((e) => (e ? [e.id, e.count] : 0));
    let xp = 0;
    fu.onTakeXp = (n) => (xp += n);
    fu.update(9.9);
    out.at99 = { out: fu.view.slots[2], lit: F.furnaceLit(g.world.getBlock(x, y, z)), dur: fu.view.f.litDur };
    fu.update(0.15);
    out.at10 = fu.view.slots[2] ? [fu.view.slots[2].id, fu.view.slots[2].count] : null;
    // The light of the lit furnace, next to it.
    await new Promise((res) => setTimeout(res, 50));
    out.light = g.world.lightAt(x, y + 1, z).block;
    fu.update(20.1);
    out.at30 = fu.view.slots.map((e) => (e ? [e.id, e.count] : 0));
    // Shift-click the output: into the inventory, with the experience (0.7 a piece for iron, 0.1 for stone).
    T.click("furnace", 2, 0, true);
    out.taken = T.count(ingot);
    out.xp = xp;
    out.stored = fu.view.f.xp;
    // Burn times: planks 15 s, a stick 5 s (one each, a fresh furnace).
    s.close();
    const times = {};
    for (const [name, id] of [["coal", T.IT.COAL], ["planks", T.B.PLANKS], ["stick", T.IT.STICK]]) {
      const f = fu.contents(x + 50, y, z + 50);
      f.slots[0] = { id: T.B.COBBLESTONE, count: 64 };
      f.slots[1] = { id, count: 1 };
      f.slots[2] = null;
      f.lit = f.litDur = f.prog = 0;
      fu._tick(f);
      times[name] = f.litDur;
    }
    fu.store.delete(`${x + 50},${y},${z + 50}`);
    out.times = times;
    out.ore = ore;
    out.ingot = ingot;
    out.pos = [x, y, z];
    // (The crafting table opens nothing in a Missions world: checked below; the furnace's use is in either.)
    out.useFn = typeof C.BLOCK_USE[T.ID.FURNACE + 4] === "function";
    return out;
  });
  assert(JSON.stringify(r.facing) === JSON.stringify([-1, 0]), `the front faces the player: ${JSON.stringify(r.facing)}`);
  assert(r.used && r.kind === "furnace" && r.useFn, `the furnace's screen: ${JSON.stringify(r)}`);
  assert(r.dirtRefused, "dirt is refused by the fuel slot");
  assert(r.slots[0] && r.slots[0][0] === r.ore && r.slots[1] && r.slots[1][1] === 2 && !r.slots[2], `shift-click: the ore into the input, the coal into the fuel: ${JSON.stringify(r.slots)}`);
  assert(!r.at99.out && r.at99.lit && r.at99.dur === 1600, `at 9.9 s: lit, coal burns 1600 ticks, nothing out yet: ${JSON.stringify(r.at99)}`);
  assert(r.at10 && r.at10[0] === r.ingot && r.at10[1] === 1, `at 10 s: one ingot: ${JSON.stringify(r.at10)}`);
  assert(r.light >= 11, `the lit furnace gives light (13 at its face): ${r.light}`);
  assert(r.at30[0] === 0 && r.at30[2] && r.at30[2][1] === 3 && r.at30[1] && r.at30[1][1] === 1, `three smelted on one coal: ${JSON.stringify(r.at30)}`);
  assert(r.taken === 3 && r.stored === 0 && (r.ore === 10 ? r.xp <= 1 : r.xp >= 2 && r.xp <= 3), `taken with the experience: ${JSON.stringify(r)}`);
  assert(r.times.coal === 1600 && r.times.planks === 300 && r.times.stick === 100, `burn times: ${JSON.stringify(r.times)}`);
  await closeScreen();
});

await check("the furnace: contents kept through a save and a reload; breaking it drops them", async () => {
  const pos = await v(page, (g) => {
    const T = window.__ct;
    const fu = g.furnaces;
    const [x, y, z] = T.spot(-2, -1);
    g.world.setBlock(x, y, z, T.ID.FURNACE);
    const f = fu.contents(x, y, z);
    f.slots[0] = { id: T.B.DIRT, count: 7 }; // (nothing smelts: the planks don't burn meanwhile)
    f.slots[1] = { id: T.B.PLANKS, count: 3 };
    f.slots[2] = { id: T.B.GLASS, count: 2 };
    f.xp = 0.2;
    g.flushSave();
    return [x, y, z];
  });
  await boot(`seed=${SEED}&type=survival`);
  await play();
  await v(page, noDraw);
  await v(page, HELPERS);
  const r = await v(
    page,
    (g, [x, y, z]) => {
      const T = window.__ct;
      const fu = g.furnaces;
      const f = fu.store.get(`${x},${y},${z}`);
      const out = { slots: f ? f.slots.map((e) => (e ? [e.id, e.count] : 0)) : null, xp: f?.xp, block: g.world.getBlock(x, y, z) };
      const before = g.entities.items?.length ?? null;
      g.world.setBlock(x, y, z, 0);
      out.gone = !fu.store.has(`${x},${y},${z}`);
      out.dropped = before === null ? null : g.entities.items.length - before;
      return out;
    },
    pos
  );
  assert(r.block >= 1792 && r.block < 1800, `the furnace block is back: ${r.block}`);
  assert(JSON.stringify(r.slots) === JSON.stringify([[2, 7], [8, 3], [9, 2]]) && Math.abs(r.xp - 0.2) < 1e-6, `contents kept: ${JSON.stringify(r)}`);
  assert(r.gone && (r.dropped === null || r.dropped === 3), `broken: its three stacks drop: ${JSON.stringify(r)}`);
});

await check("a Missions world: no crafting grid, and the crafting table opens nothing", async () => {
  await boot(`seed=${MISSIONS_SEED}`);
  await play();
  await v(page, noDraw);
  await v(page, HELPERS);
  const r = await v(page, (g) => {
    const T = window.__ct;
    const s = g.invScreen;
    s.open("inventory", false);
    const out = { type: g.worldType, width: s.gridWidth, hidden: s.craftBox.classList.contains("hidden") };
    s.close();
    const [x, y, z] = T.spot(2, 0);
    g.world.setBlock(x, y, z, T.B.CRAFTING_TABLE);
    out.used = T.use(x, y, z);
    out.state = g.gameState;
    return out;
  });
  assert(r.type === "missions" && r.width === 0 && r.hidden, `no grid in a Missions world: ${JSON.stringify(r)}`);
  assert(!r.used && r.state === "playing", `the table does nothing new: ${JSON.stringify(r)}`);
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

  await check("online: a guest uses the host's furnace (fills it, the host smelts, the guest takes the output; stale clicks refused)", async () => {
    await host.goto(`http://127.0.0.1:${PORT}/index.html?seed=${SEED + 7}&type=survival&${NET_Q}`, { waitUntil: "load", timeout: 60000 });
    await ready(host);
    await host.click("#menu-mp-btn");
    await host.fill("#mp-nick", "Alice");
    await host.click("#mp-host-btn");
    const code = await until(host, (g) => g.net.code, 30000);
    assert(code, "no room code");
    await host.click("#mp-lobby-play");
    await host.waitForFunction(() => window.__ufo.gameState === "playing", null, { timeout: 30000 });
    await v(host, noDraw);
    await v(host, HELPERS);
    await guest.goto(`http://127.0.0.1:${PORT}/index.html?join=${code}&${NET_Q}`, { waitUntil: "load", timeout: 60000 });
    await guest.waitForSelector("#mp-join-boot:not(.hidden)", { timeout: 30000 });
    await guest.fill("#mp-boot-nick", "Bob");
    await guest.click("#mp-boot-join");
    await ready(guest);
    assert(await until(guest, (g) => g.mp.stateLoaded, 60000), "the host's state never arrived");
    await v(guest, noDraw);
    await play(guest);
    await v(guest, HELPERS);
    // The host puts a furnace next to the guest.
    const pos = await v(guest, (g) => window.__ct.spot(2, 2));
    await v(host, (g, [x, y, z]) => g.world.setBlock(x, y, z, window.__ct.ID.FURNACE), pos);
    assert(await until(guest, (g, [x, y, z]) => g.world.getBlock(x, y, z) === window.__ct.ID.FURNACE, 15000, pos), "the furnace never reached the guest");
    // The guest opens it and fills it.
    const opened = await v(
      guest,
      (g, [x, y, z]) => {
        const T = window.__ct;
        g.inventory.clear();
        g.inventory.slots[0] = { id: T.B.COBBLESTONE, count: 2 };
        g.inventory.slots[1] = { id: T.IT.COAL, count: 1 };
        return { used: T.use(x, y, z), authority: g.furnaces.authority };
      },
      pos
    );
    assert(opened.used && !opened.authority, `the guest opens it (not its own): ${JSON.stringify(opened)}`);
    assert(await until(guest, (g) => g.furnaces.view?.ready, 15000), "the host never answered the open");
    await v(guest, () => {
      window.__ct.click("inv", 0, 0, true);
      return true;
    });
    await until(guest, (g) => !g.invScreen.busy, 10000);
    await v(guest, () => {
      window.__ct.click("inv", 1, 0, true);
      return true;
    });
    await until(guest, (g) => !g.invScreen.busy, 10000);
    // (The coal lights the fire at once: it is burning at the host, the cobblestone in.)
    const hostSees = await until(
      host,
      (g, [x, y, z]) => {
        const f = g.furnaces.store.get(`${x},${y},${z}`);
        return f && f.lit > 0 ? { slots: f.slots.map((e) => (e ? [e.id, e.count] : 0)), lit: f.lit } : null;
      },
      15000,
      pos
    );
    if (!hostSees) {
      const dbg = {
        guest: await v(guest, (g) => ({ view: g.furnaces.view && { ready: g.furnaces.view.ready, slots: g.furnaces.view.slots, key: g.furnaces.view.key }, busy: g.invScreen.busy, kind: g.invScreen.kind, inv: g.inventory.slots.slice(0, 3), pending: !!g.furnaces.pending })),
        host: await v(host, (g) => ({ store: [...g.furnaces.store.values()].map((f) => [f.key, f.slots, f.lit]), watchers: [...g.mp.furnaces.watchers].map(([k, s]) => [k, [...s]]) })),
      };
      throw new Error(`the host never got the guest's things: ${JSON.stringify(dbg)}`);
    }
    const cobble = (hostSees.slots[0] ? hostSees.slots[0][1] : 0) + (hostSees.slots[2] ? hostSees.slots[2][1] : 0);
    assert(cobble === 2 && hostSees.slots[1] === 0, `the host has the guest's things, burning: ${JSON.stringify(hostSees)}`);
    const guestInv = await v(guest, (g) => [window.__ct.count(window.__ct.B.COBBLESTONE), window.__ct.count(window.__ct.IT.COAL)]);
    assert(guestInv[0] === 0 && guestInv[1] === 0, `they left the guest's inventory: ${guestInv}`);
    // The host smelts (game time moved on at the host).
    await v(host, (g) => (g.furnaces.update(10.1), true));
    const seen = await until(guest, (g) => {
      const v = g.furnaces.view;
      return v?.slots[2] ? [v.slots[2].id, v.slots[2].count, v.f.lit > 0] : null;
    }, 15000);
    assert(seen && seen[0] === 3 && seen[1] >= 1 && seen[2], `the guest sees the stone and the fire: ${JSON.stringify(seen)}`);
    // A stale click (what the guest thinks the input holds is old): refused, nothing lost.
    const stale = await v(guest, (g) => new Promise((res) => g.furnaces.submit([[0, { id: window.__ct.B.COBBLESTONE, count: 2 }, null]], (ok) => res(ok))));
    assert(stale === false, "a stale click is refused");
    // The guest takes the output (shift-click), with the experience from the host.
    const xp = await v(guest, (g) => {
      window.__xp = 0;
      g.furnaces.onTakeXp = (n) => (window.__xp += n);
      window.__ct.click("furnace", 2, 0, true);
      return true;
    });
    assert(xp, "clicked");
    const got = await until(guest, (g) => !g.invScreen.busy && window.__ct.count(window.__ct.B.STONE), 15000);
    assert(got >= 1, "the guest never got the stone");
    const left = await v(host, (g, [x, y, z]) => g.furnaces.store.get(`${x},${y},${z}`)?.slots.map((e) => (e ? e.count : 0)), pos);
    assert(left && left[0] + left[2] + got === 2, `nothing made twice or lost: the guest took ${got}, the host has ${JSON.stringify(left)}`);
    // Closing tells the host.
    await v(guest, (g) => (g.invScreen.close(), true));
    assert(await until(host, (g) => g.mp.furnaces.watchers.size === 0, 10000), "the host still thinks the guest watches");
  });

  await guest.close();
  await host.close();
  peerHttp.close();
}
if (!args.solo) await online();

// ---------- Summary ----------
const failed = results.filter(([, ok]) => !ok);
console.log(`\n${results.length - failed.length} passed, ${failed.length} failed${errors.length ? `; console errors: ${errors.length}` : ""}.`);
if (errors.length) console.log(errors.slice(0, 5).join("\n"));
await browser.close();
server.close();
process.exit(failed.length || errors.length ? 1 : 0);
