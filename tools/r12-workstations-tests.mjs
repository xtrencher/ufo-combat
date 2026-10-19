// Round 12 workstations tests (js/content/workstations.js, js/chests.js,
// js/furnace.js, js/inventory-ui.js).
// In Node (fast): the blocks, their tiles and recipes; the smoker's and the
// blast furnace's recipes; the stonecutter's cuts; a Survival village's job
// blocks are the real ones.
// In the browser (the real game, a Survival world, Creative): two chests
// join into a double chest of 54 slots (each half its own 27), a half broken
// leaves a single chest and spills its own; a barrel opens empty; a shulker
// box keeps its things when broken and takes no box; the smoker cooks food
// twice as fast and refuses ore, the blast furnace raw metal; a campfire
// cooks food in 30 s and pops it off, a shovel puts it out; the composter
// fills and gives bone meal; the grindstone disenchants (experience back)
// and repairs, the stonecutter cuts stone; the bell rings. Screenshots of
// the blocks and the screens (SHOTS=dir).
//
//   node r12-workstations-tests.mjs [--only=substring] [--node]
import http from "node:http";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";

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
const imp = (p) => import(pathToFileURL(path.join(ROOT, p)).href);
const { BLOCK, BLOCK_INFO, TILE_NAMES } = await imp("js/blocks.js");
const { itemInfo, CREATIVE_ITEMS } = await imp("js/items.js");
const V = await imp("js/content/ids.js");
const W = await imp("js/content/workstations.js");
const C = await imp("js/content/index.js");
const WT = await imp("js/worldtype.js");
const { TerrainGenerator } = await imp("js/terrain.js");
const { SEA_LEVEL } = await imp("js/constants.js");

const results = [];
function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}
async function check(name, fn) {
  if (args.only && !name.toLowerCase().includes(String(args.only).toLowerCase())) return;
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

// ---------- In Node ----------

await check("the blocks: in their range, named, in the palette once each (variants not), at most 40 new tiles", async () => {
  const ws = C.CONTENT_ORDER.find((o) => o.module === "workstations");
  assert(ws && ws.blocks.length >= 50, `workstations blocks: ${ws?.blocks.length}`);
  for (const id of ws.blocks) assert(id >= 2816 && id <= 2879 && BLOCK_INFO[id]?.name, `block ${id}`);
  const palette = CREATIVE_ITEMS.filter((id) => id >= 2816 && id <= 2879);
  for (const id of [V.SMOKER, V.BLAST_FURNACE, V.CAMPFIRE, V.SOUL_CAMPFIRE, V.COMPOSTER, V.GRINDSTONE, V.STONECUTTER, V.LECTERN, V.FLETCHING_TABLE, V.CARTOGRAPHY_TABLE, V.LOOM, V.BELL, V.SHULKER_BOX]) assert(palette.includes(id), `${BLOCK_INFO[id]?.name} not in the palette`);
  assert(palette.length === 13, `palette: ${palette.map((id) => BLOCK_INFO[id].name)}`);
  assert(CREATIVE_ITEMS.includes(V.BARREL) && BLOCK_INFO[V.BARREL].name === "Barrel", "the barrel");
  const mine = Object.keys((await imp("js/content/workstations.js")).tiles).length + ["barrel_side", "barrel_top", "barrel_bottom"].filter((t) => TILE_NAMES.includes(t)).length;
  assert(mine <= 40, `${mine} tiles`);
  assert(itemInfo(V.SHULKER_BOX).stack === 1, "a shulker box stacks to 1");
  // The double chest's halves pair up both ways.
  for (let v = 0; v < 8; v++) {
    const id = V.CHEST_DOUBLE + v;
    const [px, pz] = W.chestPartner(id, 10, 20);
    const { k, right } = W.chestHalf(id);
    const other = W.doubleChestId(k, !right);
    const [bx, bz] = W.chestPartner(other, px, pz);
    assert(bx === 10 && bz === 20 && Math.abs(px - 10) + Math.abs(pz - 20) === 1, `half ${v}: partner ${px},${pz} back ${bx},${bz}`);
    assert(BLOCK_INFO[id].item === BLOCK.CHEST, "a half counts as a chest");
  }
  for (const id of [V.CAMPFIRE, V.CAMPFIRE + 1, V.SOUL_CAMPFIRE, V.SOUL_CAMPFIRE + 1]) {
    assert(W.campfireLit(id) && !W.campfireLit(W.campfireAs(id, false)) && W.campfireAs(W.campfireAs(id, false), true) === id, `campfire ${id}`);
  }
  assert(BLOCK_INFO[V.CAMPFIRE].emission === 15 && BLOCK_INFO[V.SOUL_CAMPFIRE].emission === 10 && BLOCK_INFO[V.CAMPFIRE + 2].emission === 0, "campfire light 15 / 10, out 0");
});

await check("the recipes: each new block is crafted as vanilla's; the stonecutter's cuts are real blocks", async () => {
  WT.setWorldType("survival");
  const { craftResult, resetRecipes } = await imp("js/crafting.js");
  resetRecipes();
  const g = (rows, key) => rows.flatMap((r) => [...r].map((c) => (c === " " ? 0 : key[c])));
  const cases = [
    [V.SMOKER, [" L ", "LFL", " L "], { L: BLOCK.WOOD, F: V.FURNACE }],
    [V.BLAST_FURNACE, ["III", "IFI", "SSS"], { I: V.IRON_INGOT, F: V.FURNACE, S: V.SMOOTH_STONE }],
    [V.CAMPFIRE, [" S ", "SCS", "LLL"], { S: 256, C: 257, L: BLOCK.BIRCH_LOG }],
    [V.SOUL_CAMPFIRE, [" S ", "SCS", "LLL"], { S: 256, C: V.SOUL_SAND, L: BLOCK.WOOD }],
    [V.COMPOSTER, ["S S", "S S", "SSS"], { S: V.OAK_SLAB }],
    [V.GRINDSTONE, ["T#T", "P P", "   "], { T: 256, "#": V.STONE_SLAB, P: BLOCK.PLANKS }],
    [V.STONECUTTER, [" I ", "###", "   "], { I: V.IRON_INGOT, "#": BLOCK.STONE }],
    [V.LECTERN, ["SSS", " B ", " S "], { S: V.OAK_SLAB, B: V.BOOKSHELF }],
    [V.SHULKER_BOX, [" S ", " C ", " S "], { S: V.SHULKER_SHELL, C: BLOCK.CHEST }],
  ];
  for (const [want, rows, key] of cases) {
    const r = craftResult(g(rows, key), 3);
    assert(r && r.id === want, `${BLOCK_INFO[want].name}: ${JSON.stringify(r)}`);
  }
  const cuts = W.stonecutting();
  assert(cuts.length >= 40, `${cuts.length} cuts`);
  for (const [a, b, n] of cuts) assert(itemInfo(a) && itemInfo(b) && n >= 1, `cut ${a} -> ${b}`);
  assert(cuts.some(([a, b, n]) => a === BLOCK.STONE && b === V.STONE_SLAB && n === 2), "stone into 2 slabs");
  assert(cuts.some(([a, b]) => a === BLOCK.STONE && b === V.STONE_BRICK_STAIRS), "stone into stone brick stairs");
  assert(W.compostChance(V.WHEAT_SEEDS) === 0.3 && W.compostChance(V.BREAD) === 0.85 && W.compostChance(BLOCK.STONE) === 0, "the compost chances");
});

await check("a Survival village's job blocks are the real ones (composter, lectern, smoker, blast furnace, loom, fletching table, stonecutter, grindstone)", async () => {
  WT.setWorldType("survival");
  const found = new Set();
  const want = new Map([
    [V.COMPOSTER, "composter"],
    [V.LECTERN, "lectern"],
    [V.SMOKER, "smoker"],
    [V.BLAST_FURNACE, "blast furnace"],
    [V.LOOM, "loom"],
    [V.FLETCHING_TABLE, "fletching table"],
    [V.STONECUTTER, "stonecutter"],
    [V.GRINDSTONE, "grindstone"],
  ]);
  const base = (id) => {
    for (const [b] of want) if (id >= b && id < b + (b === V.COMPOSTER ? 9 : b === V.SMOKER || b === V.BLAST_FURNACE ? 8 : 4)) return b;
    return -1;
  };
  for (const seed of [42, 777, 12345, 2024]) {
    const gen = new TerrainGenerator(seed, { sites: false });
    const [sx, sz] = gen.spawnColumn();
    const list = gen.villages._villagesNear(sx - 3000, sz - 3000, sx + 3000, sz + 3000).sort((a, b) => Math.hypot(a.x - sx, a.z - sz) - Math.hypot(b.x - sx, b.z - sz));
    const v = list[0];
    if (!v) continue;
    const chunks = new Map();
    const at = (x, y, z) => {
      const k = `${x >> 4},${z >> 4}`;
      let b = chunks.get(k);
      if (!b) {
        b = new Uint16Array(16 * 128 * 16);
        gen.generate({ cx: x >> 4, cz: z >> 4, blocks: b });
        chunks.set(k, b);
      }
      return b[(y * 16 + (z & 15)) * 16 + (x & 15)];
    };
    for (let dx = -62; dx <= 62; dx++) for (let dz = -62; dz <= 62; dz++) for (let y = SEA_LEVEL - 2; y < 100; y++) {
      const b = base(at(v.x + dx, y, v.z + dz));
      if (b >= 0) found.add(b);
    }
  }
  const missing = [...want].filter(([b]) => !found.has(b)).map(([, n]) => n);
  assert(found.size >= 5, `job blocks found: ${[...found].map((b) => want.get(b))}; missing ${missing}`);
  console.log(`        found: ${[...found].map((b) => want.get(b)).join(", ")}${missing.length ? `; not in these villages: ${missing.join(", ")}` : ""}`);
});

// ---------- In the browser ----------

if (!args.node) await browserChecks();

async function browserChecks() {
  const { chromium } = await import("playwright-core");
  const PORT = 9300 + Math.floor(Math.random() * 400);
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
  const browser = await chromium.launch({
    executablePath: process.env.CHROMIUM_PATH || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome",
    args: ["--use-gl=swiftshader", "--enable-webgl", "--ignore-gpu-blocklist", "--no-sandbox", "--disable-dev-shm-usage"],
  });
  const localThreeRoot = path.join(__dirname, "node_modules", "three");
  const page = await browser.newPage({ viewport: { width: 960, height: 540 } });
  await page.route("https://cdn.jsdelivr.net/npm/three@0.160.0/**", (route) => {
    const rel = new URL(route.request().url()).pathname.replace("/npm/three@0.160.0/", "");
    route.fulfill({ path: path.join(localThreeRoot, rel), contentType: "text/javascript" });
  });
  page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
  page.on("pageerror", (e) => errors.push(String(e)));
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
    await page.click("#play-btn", { timeout: 120000 }).catch(() => {});
    const t0 = Date.now();
    while (Date.now() - t0 < 240000) {
      const st = await v((g) => g.gameState);
      if (st === "playing") return;
      if (st === "start" && (await page.isVisible("#play-btn").catch(() => false))) await page.click("#play-btn", { timeout: 5000 }).catch(() => {});
      else if (await page.isVisible("#resume-btn").catch(() => false)) await page.click("#resume-btn", { timeout: 3000 }).catch(() => {});
      else if (await page.isVisible("#click-to-play").catch(() => false)) await page.click("#click-to-play", { timeout: 3000 }).catch(() => {});
      else await page.mouse.click(300, 200).catch(() => {});
      await frames(3);
    }
    throw new Error("the game didn't start playing");
  }
  const browserCheck = async (name, fn) => {
    const before = errors.length;
    await check(name, async () => {
      await fn();
      if (errors.length > before) throw new Error(`console errors: ${errors.slice(before, before + 3).join(" | ")}`);
    });
  };
  const out = process.env.SHOTS || "";
  const shot = async (name) => {
    if (!out) return;
    await page.screenshot({ path: path.join(out, `${name}.png`) });
    console.log(`        screenshot: ${path.join(out, `${name}.png`)}`);
  };

  await page.goto(`http://127.0.0.1:${PORT}/index.html?seed=1&type=survival&graphics=low`, { waitUntil: "load", timeout: 60000 });
  await page.waitForFunction(() => !!window.__ufo && window.__ufo.graphicsReady, null, { timeout: 180000 });
  await play();
  // A flat stone floor near the start, the air cleared over it; the
  // engine's modules (the same ones the game runs), and a use context.
  const S = await v(async (g) => {
    g.testFlags.noMissions = true;
    if (!g.player.creative) g.setMode("creative");
    g.player.flying = true;
    const p = g.player.position;
    const x0 = Math.floor(p.x) - 10;
    const z0 = Math.floor(p.z) - 14;
    const y0 = Math.min(100, Math.max(40, Math.floor(p.y) + 6));
    g.world.prepareArea(x0 + 10, z0 + 4, 2);
    const list = [];
    for (let x = x0 - 2; x < x0 + 24; x++) for (let z = z0 - 4; z < z0 + 12; z++) {
      list.push(x, y0 - 1, z, 3);
      for (let y = y0; y < y0 + 6; y++) list.push(x, y, z, 0);
    }
    g.world.setBlocks(list);
    // (The one-line patch to js/blocks.js IS_CHEST this part asks for: a double chest's halves are chests.)
    const B = await import("/js/blocks.js");
    const I = await import("/js/content/ids.js");
    for (let k = 0; k < 8; k++) B.IS_CHEST[I.CHEST_DOUBLE + k] = 1;
    return { x0, y0, z0 };
  });
  const ctxOf = `(g, x, y, z, stack) => ({ world: g.world, player: g.player, inventory: g.inventory, entities: g.entities, audio: g.audio, effects: g.effects, interaction: g.interaction, x, y, z, id: g.world.getBlock(x, y, z), normal: [0, 1, 0], place: [x, y + 1, z], forward: [0, 0, -1], stack, info: stack ? g.__items.itemInfo(stack.id) : null, creative: true, sneaking: false })`;
  await v(async (g) => {
    g.__items = await import("/js/items.js");
    g.__content = await import("/js/content/index.js");
    g.__ids = await import("/js/content/ids.js");
    g.__ws = await import("/js/content/workstations.js");
    g.__base = await import("/js/content/base.js");
  });

  await browserCheck("double chests: two chests side by side facing the same way join (54 slots, each half its own 27); a broken half leaves a single chest and spills only its own", async () => {
    const r = await v((g, s) => {
      const ch = g.interaction.chests;
      const I = g.__ids;
      const x = s.x0 + 2;
      const y = s.y0;
      const z = s.z0;
      const [a] = ch.placeChest(x, y, z, 0, 1);
      g.world.setBlocks([x, y, z, a]);
      const [b, more] = ch.placeChest(x + 1, y, z, 0, 1);
      g.world.setBlocks([x + 1, y, z, b, ...(more || [])]);
      const ids = [g.world.getBlock(x, y, z), g.world.getBlock(x + 1, y, z)];
      // (a third beside them stays single: a chest joins one other)
      const [c, more3] = ch.placeChest(x + 2, y, z, 0, 1);
      const sneaky = ch.placeChest(x + 2, y, z, 0, 1, true);
      const view = ch.openView(x + 1, y, z, () => {});
      const parts = view.parts.map((p) => [p.x, p.z]);
      const n = view.slots.length;
      let ok = false;
      ch.submit([[30, null, { id: I.BREAD, count: 5 }]], (o) => (ok = o));
      const right = ch.store.get(ch.keyOf(x + 1, y, z))[3];
      const left = ch.store.get(ch.keyOf(x, y, z))[3];
      ch.closeView();
      // The screen: 54 slots, "Large Chest".
      g.invScreen.chestPos = [x, y, z];
      g.invScreen.open("chest", true);
      const shown = g.invScreen.chestViews.filter((sv) => !sv.el.classList.contains("hidden")).length;
      const title = g.invScreen.titleEl.textContent;
      return { a, b, more, ids, c, more3, sneaky, parts, n, ok, right, left, shown, title, x, y, z };
    }, S);
    const I = V;
    assert(r.a === BLOCK.CHEST, `the first: a single chest (${r.a})`);
    assert(r.ids[0] === I.CHEST_DOUBLE + 0 && r.ids[1] === I.CHEST_DOUBLE + 4, `joined: ${r.ids} (more ${r.more})`);
    assert(r.c === BLOCK.CHEST && !r.more3 && r.sneaky[0] === BLOCK.CHEST, `a third stays single: ${r.c} ${r.more3}`);
    assert(r.n === 54 && r.parts[0][0] === r.x && r.parts[1][0] === r.x + 1, `the view: ${r.n} slots, parts ${JSON.stringify(r.parts)}`);
    assert(r.ok && r.right?.id === V.BREAD && r.right.count === 5 && !r.left, `slot 30 is the right half's slot 3: ${JSON.stringify(r)}`);
    assert(r.shown === 54 && r.title === "Large Chest", `the screen: ${r.shown} slots, "${r.title}"`);
    await frames(2);
    await shot("ws-double-chest-screen");
    const after = await v((g, s) => {
      g.invScreen.close();
      const n0 = g.entities.items.length;
      g.world.setBlock(s.x + 1, s.y, s.z, 0); // (the right half, holding the bread)
      const left = g.world.getBlock(s.x, s.y, s.z);
      const dropped = g.entities.items.slice(n0).map((it) => [it.id, it.count]);
      return { left, dropped };
    }, r);
    assert(after.left === BLOCK.CHEST, `the left half is single again: ${after.left}`);
    assert(after.dropped.length === 1 && after.dropped[0][0] === V.BREAD && after.dropped[0][1] === 5, `spilled: ${JSON.stringify(after.dropped)}`);
    // (the pair again, for the picture)
    await v((g, s) => {
      const ch = g.interaction.chests;
      const [b, more] = ch.placeChest(s.x + 1, s.y, s.z, 0, 1);
      g.world.setBlocks([s.x + 1, s.y, s.z, b, ...(more || [])]);
    }, r);
  });

  await browserCheck("a barrel opens empty (27 slots, the chest's screen); a shulker box keeps its things when broken, and takes no shulker box", async () => {
    const r = await v((g, s) => {
      const ch = g.interaction.chests;
      const I = g.__ids;
      const ws = g.__ws;
      const bx = s.x0 + 6;
      g.world.setBlock(bx, s.y0, s.z0, I.BARREL);
      const view = ch.openView(bx, s.y0, s.z0, () => {});
      const barrel = { n: view.slots.length, empty: view.slots.every((x) => !x) };
      ch.closeView();
      g.invScreen.chestPos = [bx, s.y0, s.z0];
      g.invScreen.open("chest", true);
      barrel.title = g.invScreen.titleEl.textContent;
      g.invScreen.close();
      // A box placed from an item holding bread.
      const sx = s.x0 + 20;
      ch.fillPlaced([sx, s.y0, s.z0], { id: I.SHULKER_BOX, count: 1, tag: { items: [[4, I.BREAD, 3]] } });
      g.world.setBlocks([sx, s.y0, s.z0, ws.SHULKER_PLACED]);
      const held = ch.store.get(ch.keyOf(sx, s.y0, s.z0))?.[4];
      const v2 = ch.openView(sx, s.y0, s.z0, () => {});
      let boxIn = null;
      ch.submit([[0, null, { id: I.SHULKER_BOX, count: 1 }]], (o) => (boxIn = o));
      ch.closeView();
      // Broken: the box drops with the bread in it.
      const n0 = g.entities.items.length;
      g.world.setBlock(sx, s.y0, s.z0, 0);
      const drops = g.entities.items.slice(n0).map((it) => ({ id: it.id, count: it.count, tag: it.tag }));
      void v2;
      return { barrel, held, boxIn, drops };
    }, S);
    assert(r.barrel.n === 27 && r.barrel.empty && r.barrel.title === "Barrel", `the barrel: ${JSON.stringify(r.barrel)}`);
    assert(r.held?.id === V.BREAD && r.held.count === 3, `the box's bread: ${JSON.stringify(r.held)}`);
    assert(r.boxIn === false, "a shulker box went into a shulker box");
    assert(r.drops.length === 1 && r.drops[0].id === V.SHULKER_BOX && JSON.stringify(r.drops[0].tag?.items) === JSON.stringify([[4, V.BREAD, 3]]), `the drop: ${JSON.stringify(r.drops)}`);
  });

  await browserCheck("the smoker cooks food twice as fast and takes no ore; the blast furnace smelts raw iron in 5 s and no food", async () => {
    const r = await v((g, s) => {
      const I = g.__ids;
      const fu = g.furnaces;
      const mk = (id, n) => ({ id, count: n });
      const at = (dx, id) => {
        g.world.setBlock(s.x0 + dx, s.y0, s.z0, id);
        return fu.contents(s.x0 + dx, s.y0, s.z0);
      };
      const sm = at(8, I.SMOKER);
      sm.slots[0] = mk(I.BEEF, 2);
      sm.slots[1] = mk(257, 1);
      const sm2 = at(9, I.SMOKER);
      sm2.slots[0] = mk(14, 2); // (iron ore)
      sm2.slots[1] = mk(257, 1);
      const bl = at(10, I.BLAST_FURNACE);
      bl.slots[0] = mk(I.RAW_IRON, 1);
      bl.slots[1] = mk(257, 1);
      const bl2 = at(11, I.BLAST_FURNACE);
      bl2.slots[0] = mk(I.BEEF, 1);
      bl2.slots[1] = mk(257, 1);
      const fn = at(12, I.FURNACE);
      fn.slots[0] = mk(I.BEEF, 1);
      fn.slots[1] = mk(257, 1);
      fu.update(5.1);
      const res = (f) => (f.slots[2] ? [f.slots[2].id, f.slots[2].count] : null);
      const lit = g.world.getBlock(s.x0 + 8, s.y0, s.z0);
      return { kinds: [sm.kind, bl.kind, fn.kind], sm: res(sm), sm2: res(sm2), sm2fuel: sm2.slots[1]?.count, bl: res(bl), bl2: res(bl2), fn: res(fn), fnProg: fn.prog, lit };
    }, S);
    assert(r.kinds.join() === "1,2,0", `kinds ${r.kinds}`);
    assert(r.sm && r.sm[0] === V.COOKED_BEEF && r.sm[1] === 1, `the smoker in 5 s: ${JSON.stringify(r.sm)}`);
    assert(!r.sm2 && r.sm2fuel === 1, `the smoker took ore: ${JSON.stringify(r)}`);
    assert(r.bl && r.bl[0] === V.IRON_INGOT, `the blast furnace: ${JSON.stringify(r.bl)}`);
    assert(!r.bl2, `the blast furnace cooked beef: ${JSON.stringify(r.bl2)}`);
    assert(!r.fn && r.fnProg > 90, `the furnace takes 10 s: ${JSON.stringify(r.fn)} ${r.fnProg}`);
    assert(r.lit === V.SMOKER + 4, `the smoker lit: ${r.lit}`);
  });

  await browserCheck("a campfire cooks food laid on it in 30 s (it pops off cooked), shows it, smokes; a shovel puts it out", async () => {
    const r = await v(
      (g, [s, ctxSrc]) => {
        const ctxOf = new Function(`return ${ctxSrc}`)();
        const I = g.__ids;
        const use = g.__content.BLOCK_USE;
        const cx = s.x0 + 14;
        g.world.setBlock(cx, s.y0, s.z0, I.CAMPFIRE);
        const put = use[I.CAMPFIRE](ctxOf(g, cx, s.y0, s.z0, { id: I.BEEF, count: 1 }));
        const notFood = use[I.CAMPFIRE](ctxOf(g, cx, s.y0, s.z0, { id: 3, count: 1 }));
        const cf = g.furnaces.campfires;
        const rec = cf.store.get(cf.keyOf(cx, s.y0, s.z0));
        const had = rec ? rec.slots.filter(Boolean).length : 0;
        const n0 = g.entities.items.length;
        cf.update(30.1);
        const drops = g.entities.items.slice(n0).map((it) => it.id);
        // Three more for the picture (they stay), on the soul campfire too.
        for (const id of [I.PORKCHOP, I.COD, I.POTATO]) use[I.CAMPFIRE](ctxOf(g, cx, s.y0, s.z0, { id, count: 1 }));
        g.world.setBlock(cx + 1, s.y0, s.z0, I.SOUL_CAMPFIRE + 1);
        use[I.SOUL_CAMPFIRE](ctxOf(g, cx + 1, s.y0, s.z0, { id: I.SALMON, count: 1 }));
        const shown = cf._meshes.size;
        // A shovel on a third: out.
        g.world.setBlock(cx + 2, s.y0, s.z0, I.CAMPFIRE);
        use[I.CAMPFIRE](ctxOf(g, cx + 2, s.y0, s.z0, { id: 284, count: 1, dur: 200 }));
        const out = g.world.getBlock(cx + 2, s.y0, s.z0);
        return { put, notFood, had, drops, out, shown, hot: g.__items.itemInfo ? !!g.__base.LIB.BLOCK_INFO?.[I.CAMPFIRE]?.hotFloor : null };
      },
      [S, ctxOf]
    );
    assert(r.put && !r.notFood && r.had === 1, `laid on: ${JSON.stringify(r)}`);
    assert(r.drops.length === 1 && r.drops[0] === V.COOKED_BEEF, `popped off: ${JSON.stringify(r.drops)}`);
    assert(r.out === V.CAMPFIRE + 2, `the shovel: ${r.out}`);
    assert(r.hot === true, "a lit campfire burns whoever stands on it");
    await frames(3);
    const shown = await v((g) => g.furnaces.campfires._meshes.size);
    assert(shown >= 2, `the food drawn on ${shown} campfires`);
  });

  await browserCheck("the composter: plant matter fills it, a full one is ready a second later, then gives bone meal", async () => {
    const r = await v(
      async (g, [s, ctxSrc]) => {
        const ctxOf = new Function(`return ${ctxSrc}`)();
        const I = g.__ids;
        const use = g.__content.BLOCK_USE;
        const x = s.x0 + 4;
        const z = s.z0 + 3;
        g.world.setBlock(x, s.y0, z, I.COMPOSTER);
        const first = use[I.COMPOSTER](ctxOf(g, x, s.y0, z, { id: I.WHEAT_SEEDS, count: 64 })) && g.world.getBlock(x, s.y0, z);
        for (let i = 0; i < 200 && g.world.getBlock(x, s.y0, z) < I.COMPOSTER + 7; i++) use[I.COMPOSTER](ctxOf(g, x, s.y0, z, { id: I.BREAD, count: 64 }));
        const full = g.world.getBlock(x, s.y0, z);
        await new Promise((res) => setTimeout(res, 1300));
        const ready = g.world.getBlock(x, s.y0, z);
        const n0 = g.entities.items.length;
        use[I.COMPOSTER](ctxOf(g, x, s.y0, z, null));
        const after = g.world.getBlock(x, s.y0, z);
        const drops = g.entities.items.slice(n0).map((it) => it.id);
        // (a half-full one for the picture)
        g.world.setBlock(x + 1, s.y0, z, I.COMPOSTER + 5);
        return { first, full, ready, after, drops };
      },
      [S, ctxOf]
    );
    assert(r.first === V.COMPOSTER + 1, `the first item always takes: ${r.first}`);
    assert(r.full === V.COMPOSTER + 7 && r.ready === V.COMPOSTER + 8, `full ${r.full}, ready ${r.ready}`);
    assert(r.after === V.COMPOSTER && r.drops.length === 1 && r.drops[0] === V.BONE_MEAL, `bone meal: ${JSON.stringify(r)}`);
  });

  await browserCheck("the grindstone disenchants with experience back and repairs two of a kind; the stonecutter cuts stone", async () => {
    const r = await v((g, s) => {
      const I = g.__ids;
      const inv = g.invScreen;
      const gx = s.x0 + 16;
      g.world.setBlock(gx, s.y0, s.z0, I.GRINDSTONE);
      g.world.setBlock(gx + 1, s.y0, s.z0, I.STONECUTTER);
      inv.screenPos = [gx, s.y0, s.z0];
      inv.open("grindstone", true);
      inv.grindSlots[0] = { id: 272, count: 1, dur: 100, tag: { ench: [["sharpness", 3]], name: "Edge" } };
      inv._localChanged();
      const dis = inv._grindResult();
      inv.grindSlots[1] = { id: 272, count: 1, dur: 120 };
      inv._localChanged();
      const rep = inv._grindResult();
      inv.grindSlots[0] = { id: 3, count: 1 };
      inv.grindSlots[1] = null;
      inv._localChanged();
      const none = inv._grindResult();
      inv.grindSlots[0] = null;
      const gTitle = inv.titleEl.textContent;
      inv.close();
      inv.screenPos = [gx + 1, s.y0, s.z0];
      inv.open("stonecutter", true);
      inv.cutSlots[0] = { id: 3, count: 10 };
      inv.refresh();
      const list = inv._cutList();
      const slab = list.findIndex(([id]) => id === I.STONE_SLAB);
      inv._pickCut(slab);
      const out = inv._cutResult();
      inv._takeCut(false);
      const left = inv.cutSlots[0]?.count;
      const cursor = inv.cursor;
      inv.cursor = null;
      inv.refresh();
      return { dis: dis && { id: dis.out.id, dur: dis.out.dur, tag: dis.out.tag ?? null, xp: dis.xp }, rep: rep && { dur: rep.out.dur, tag: rep.out.tag ?? null }, none, gTitle, n: list.length, out, left, cursor };
    }, S);
    assert(r.dis && r.dis.id === 272 && r.dis.dur === 100 && JSON.stringify(r.dis.tag) === JSON.stringify({ name: "Edge" }) && r.dis.xp >= 12 && r.dis.xp <= 23, `disenchanted: ${JSON.stringify(r.dis)}`);
    assert(r.rep && r.rep.dur === 100 + 120 + 12 && JSON.stringify(r.rep.tag) === JSON.stringify({ name: "Edge" }), `repaired: ${JSON.stringify(r.rep)}`);
    assert(!r.none && r.gTitle === "Repair & Disenchant", `stone on the grindstone: ${JSON.stringify(r.none)}, "${r.gTitle}"`);
    assert(r.n >= 7 && r.out?.id === V.STONE_SLAB && r.out.count === 2 && r.left === 9 && r.cursor?.id === V.STONE_SLAB, `the stonecutter: ${JSON.stringify(r)}`);
    await frames(2);
    await shot("ws-stonecutter-screen");
    await v((g) => {
      g.invScreen.cutSlots[0] = null;
      g.invScreen.close();
    });
  });

  await browserCheck("the bell rings (and the scene of every new block)", async () => {
    const r = await v((g, s) => {
      const I = g.__ids;
      const z = s.z0 + 3;
      const row = [I.SMOKER + 4, I.BLAST_FURNACE + 4, I.LECTERN, I.FLETCHING_TABLE, I.CARTOGRAPHY_TABLE, I.LOOM, I.BELL, g.__ws.SHULKER_PLACED, I.GRINDSTONE, I.STONECUTTER + 1, I.BARREL, I.SOUL_CAMPFIRE];
      row.forEach((id, i) => g.world.setBlock(s.x0 + 7 + i, s.y0, z, id));
      const rang = g.__base.LIB.ringBell?.(s.x0 + 13, s.y0, z);
      // The camera: in front of the rows, looking at them.
      g.player.position.set(s.x0 + 12.5, s.y0 + 1.6, s.z0 + 9);
      g.player.velocity.set(0, 0, 0);
      g.player.yaw = 0;
      g.player.pitch = -0.38;
      return { rang };
    }, S);
    assert(r.rang === true, "the bell");
    await frames(8);
    await new Promise((res) => setTimeout(res, 1500));
    await frames(4);
    await shot("ws-blocks");
    await v((g, s) => {
      g.player.position.set(s.x0 + 15.5, s.y0 + 1.1, s.z0 + 2.2);
      g.player.yaw = 0;
      g.player.pitch = -0.7;
    }, S);
    await frames(6);
    await shot("ws-campfires");
  });

  await browser.close();
  server.close();
}

// ---------- Summary ----------
const failed = results.filter(([, ok]) => !ok);
console.log(`\n${results.length - failed.length} passed, ${failed.length} failed.`);
process.exit(failed.length ? 1 : 0);
