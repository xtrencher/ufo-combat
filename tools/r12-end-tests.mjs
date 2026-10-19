// Round 12 End tests: strongholds, eyes of ender, the End, the Ender Dragon
// (js/stronghold.js, js/dim-end.js, js/end-structures.js, js/dragon.js,
// js/content/end.js).
// In Node (fast): the End's content (blocks, items, recipes); its terrain
// (the main island, the void, the ten pillars as vanilla's with their
// bedrock and two cages, the empty exit portal, the outer islands with
// chorus trees and end cities, the cities' chests and their loot, the same
// chunk every time); the strongholds (vanilla's rings, every one with a
// portal room of twelve frames turned in round its 3 x 3 and a silverfish
// spawner, cut under the ground, their chests' loot); the portal's check
// (twelve eyes, the right facings); chorus plants' hold and flowers' growth;
// the gateways' ring.
// In the browser (the real game, a Survival world): an eye of ender flies
// toward the nearest stronghold and drops or breaks; twelve eyes light the
// portal and stepping in lands on the End's platform; the pillars and their
// crystals; the dragon takes damage (the head in full, the body less), a
// crystal heals it, a crystal hit bursts and costs it 10; its breath hurts
// and is bottled; it dies: the exit portal opens, the egg, a gateway, its
// experience; the exit portal takes you home; the fight is saved; an elytra
// glides; four crystals round the exit portal bring a new dragon. With --online: a guest in the End sees the host's dragon, its hits
// reach the host's dragon, and it sees the portal open when the host kills it.
//
//   node r12-end-tests.mjs [--only=substring] [--node] [--online]
// (GAME_ROOT=dir runs another copy of the game; SHOTS=dir keeps screenshots.)
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
const { BLOCK, BLOCK_INFO } = await imp("js/blocks.js");
const { itemInfo } = await imp("js/items.js");
const V = await imp("js/content/ids.js");
const E = await imp("js/content/end.js");
const C = await imp("js/content/index.js");
const R = await imp("js/dim-registry.js");
const DE = await imp("js/dim-end.js");
const ES = await imp("js/end-structures.js");
const SH = await imp("js/stronghold.js");
const ST = await imp("js/structures.js");
const { TerrainGenerator } = await imp("js/terrain.js");
const WT = await imp("js/worldtype.js");
const { LIB } = await imp("js/content/base.js");

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
const chunkOf = (gen, cx, cz) => {
  const c = { cx, cz, blocks: new Uint16Array(16 * 128 * 16) };
  gen.generate(c);
  return c.blocks;
};
const at = (b, x, y, z) => b[(y << 8) | ((z & 15) << 4) | (x & 15)];
// A world made of generated chunks (and edits on top), for the content's handlers.
function fakeWorld(gen) {
  const chunks = new Map();
  const edits = new Map();
  const chunk = (cx, cz) => {
    const k = `${cx},${cz}`;
    if (!chunks.has(k)) chunks.set(k, gen ? chunkOf(gen, cx, cz) : new Uint16Array(16 * 128 * 16));
    return chunks.get(k);
  };
  const w = {
    getBlock(x, y, z) {
      if (y < 0 || y >= 128) return BLOCK.AIR;
      const k = `${x},${y},${z}`;
      if (edits.has(k)) return edits.get(k);
      return at(chunk(x >> 4, z >> 4), x, y, z);
    },
    setBlocks(list) {
      for (let i = 0; i < list.length; i += 4) edits.set(`${list[i]},${list[i + 1]},${list[i + 2]}`, list[i + 3]);
      return list.length / 4;
    },
    setBlock(x, y, z, id) {
      return w.setBlocks([x, y, z, id]) > 0;
    },
    getChunk: () => true,
  };
  return w;
}

// ---------- In Node ----------

await check("the End's content: blocks, items, recipes (the eye from a pearl and blaze powder, the crystal, rods, bricks, purpur)", async () => {
  for (const id of [V.END_STONE, V.END_STONE_BRICKS, V.PURPUR_BLOCK, V.PURPUR_PILLAR, V.END_ROD + 2, V.CHORUS_PLANT, V.CHORUS_FLOWER, V.DRAGON_EGG, V.END_PORTAL_FRAME, V.END_PORTAL, V.END_GATEWAY, V.DRAGON_HEAD, V.SILVERFISH_SPAWNER]) assert(BLOCK_INFO[id], `block ${id}`);
  for (const id of [V.EYE_OF_ENDER, V.DRAGON_BREATH, V.CHORUS_FRUIT, V.POPPED_CHORUS_FRUIT, V.SHULKER_SHELL, V.ELYTRA, V.END_CRYSTAL]) assert(itemInfo(id), `item ${id}`);
  const es = BLOCK_INFO[V.END_STONE];
  assert(es.hardness === 3 && es.tool === "pickaxe" && es.blastResistance === 9, "end stone's values");
  assert(BLOCK_INFO[V.END_PORTAL_FRAME].hardness === -1 && BLOCK_INFO[V.END_PORTAL].solid === false && BLOCK_INFO[V.END_PORTAL].emission === 15, "frame and portal");
  assert(BLOCK_INFO[V.END_ROD + 2].emission === 14 && BLOCK_INFO[V.DRAGON_EGG].gravity, "rod light, egg falls");
  assert(BLOCK_INFO[V.SILVERFISH_SPAWNER].spawns === "silverfish", "the spawner's creature");
  assert(itemInfo(V.CHORUS_FRUIT).food?.hunger === 4 && itemInfo(V.CHORUS_FRUIT).alwaysEat, "chorus fruit");
  assert(itemInfo(V.ELYTRA).armor?.slot === 1 && itemInfo(V.ELYTRA).armor.durability === 432, "the elytra");
  const rs = C.recipes().filter((r) => r.module === "end");
  const makes = (id) => rs.some((r) => r.result[0] === id);
  assert(makes(V.EYE_OF_ENDER) && makes(V.END_CRYSTAL) && makes(V.END_ROD + 2) && makes(V.END_STONE_BRICKS) && makes(V.PURPUR_BLOCK) && makes(V.POPPED_CHORUS_FRUIT), `recipes: ${rs.map((r) => r.result[0])}`);
  const eye = rs.find((r) => r.result[0] === V.EYE_OF_ENDER);
  assert(eye.type === "shapeless" && eye.ingredients.includes(V.ENDER_PEARL) && eye.ingredients.includes(V.BLAZE_POWDER), "the eye's recipe");
  if (E.HAS_FAMILIES) assert(BLOCK_INFO[V.END_STONE_BRICK_STAIRS] && BLOCK_INFO[V.PURPUR_SLAB] && BLOCK_INFO[V.END_STONE_BRICK_WALL] && makes(V.PURPUR_STAIRS) && makes(V.PURPUR_PILLAR), "stairs, slabs, wall");
  else console.log("        (building.js has no addFamily yet: no stairs, slabs or wall)");
});

await check("the End's terrain: the main island over the void, the ten pillars as vanilla's, the empty exit portal, the same chunk every time", async () => {
  const g = R.createGenerator("end", 4711, { sites: false, vanilla: true });
  const top = g.heightAt(0, 0);
  assert(top >= 58 && top <= 66 && g.podiumY === top + 1, `the middle: ${top} / ${g.podiumY}`);
  assert(g.heightAt(300, 0) === -1 && g.heightAt(0, -500) === -1 && g.heightAt(102, 0) === -1, "the void round it (and the platform's place)");
  assert(g.heightAt(60, 20) > 50, "the island 60 out");
  // The pillars: vanilla's ring, radii and heights, the two caged ones.
  const ps = g.pillars;
  assert(ps.length === 10 && new Set(ps.map((p) => p.h)).size === 10, "ten heights");
  assert(ps.every((p) => p.h >= 76 && p.h <= 103 && p.r >= 2 && p.r <= 5 && Math.abs(Math.hypot(p.x, p.z) - 42) < 1.5), JSON.stringify(ps));
  assert(ps.filter((p) => p.guarded).length === 2, "two caged");
  for (const p of ps) {
    const b = chunkOf(g, p.x >> 4, p.z >> 4);
    assert(at(b, p.x, p.h, p.z) === BLOCK.BEDROCK && at(b, p.x, p.h - 1, p.z) === V.OBSIDIAN && at(b, p.x, p.h - 30, p.z) === V.OBSIDIAN, `pillar ${p.i}`);
    if (p.guarded) assert(at(b, p.x + 2, p.h + 1, p.z) === V.IRON_BARS || (p.x + 2) >> 4 !== p.x >> 4, `pillar ${p.i}'s cage`);
  }
  // The exit portal: a bedrock rim, its pillar and torches, nothing in it.
  const w = fakeWorld(g);
  const y = g.podiumY;
  assert(w.getBlock(3, y, 0) === BLOCK.BEDROCK && w.getBlock(0, y + 3, 0) === BLOCK.BEDROCK && w.getBlock(1, y, 1) === BLOCK.AIR && w.getBlock(0, y - 1, 1) === BLOCK.BEDROCK, "the podium");
  assert(BLOCK_INFO[w.getBlock(1, y + 2, 0)]?.name === "Torch", "its torches");
  const a = chunkOf(g, 2, -3);
  const b = chunkOf(R.createGenerator("end", 4711, {}), 2, -3);
  assert(a.every((v, i) => v === b[i]), "not the same chunk twice");
});

await check("the outer islands: past 1000 blocks, chorus trees, end cities with chests (the ship's elytra), their loot", async () => {
  const g = R.createGenerator("end", 4711, {});
  let stone = 0;
  let chorus = 0;
  for (let cx = 66; cx < 76; cx++) for (let cz = -5; cz < 5; cz++) for (const id of chunkOf(g, cx, cz)) {
    if (id === V.END_STONE) stone++;
    else if (id === V.CHORUS_PLANT) chorus++;
  }
  assert(stone > 20000 && chorus > 50, `islands ${stone}, chorus ${chorus}`);
  // Cities: a ship among them, its three chests.
  let ship = null;
  let n = 0;
  for (let rx = -6; rx <= 6; rx++) for (let rz = -6; rz <= 6; rz++) {
    const p = g.cities.cityAt(rx, rz);
    if (!p) continue;
    n++;
    assert(Math.hypot(p.x, p.z) > 1000, "a city near the middle");
    if (p.ship && !ship) ship = p;
  }
  assert(n > 5 && ship, `cities: ${n}, a ship: ${!!ship}`);
  const kinds = ship.chests.map((c) => g.structures.chestAt(c[0], c[1], c[2]));
  assert(kinds.includes("end_ship_elytra") && kinds.filter((k) => k === "end_city_treasure").length >= 4, `chests: ${kinds}`);
  const cx = ship.chests[0][0] >> 4;
  const cz = ship.chests[0][2] >> 4;
  const c = ship.chests[0];
  assert(BLOCK_INFO[at(chunkOf(g, cx, cz), c[0], c[1], c[2])]?.name === "Chest", "the chest in the chunk");
  // Their loot (structures.js's tables).
  const loot = ST.rollStructureLoot("end_city_treasure", () => 0.3);
  const elytra = ST.rollStructureLoot("end_ship_elytra", Math.random);
  assert(loot?.length >= 2 && elytra?.[0]?.[0] === V.ELYTRA, `loot: ${JSON.stringify(loot)} / ${JSON.stringify(elytra)}`);
  assert(g.structures.spawnerSpots(0, 0).cells.length === 0 && Array.isArray(g.structures.shulkerSpots(cx, cz)), "spawners, shulkers");
});

await check("strongholds: vanilla's rings, each with a portal room (twelve frames turned in, the silverfish spawner), cut under the ground, their loot", async () => {
  WT.setWorldType("survival");
  const T = new TerrainGenerator(4711, { sites: false, vanilla: true });
  const G = T.structures?.strongholds || new SH.StrongholdGrower(T);
  assert(G.rings.length === 128, "128");
  const d = G.rings.slice(0, 3).map(([x, z]) => Math.hypot(x, z));
  assert(d.every((r) => r >= 1280 && r <= 2816), `the first ring: ${d}`);
  assert(G.rings.slice(3, 9).every(([x, z]) => Math.hypot(x, z) > 2816), "the second ring");
  for (let i = 0; i < 12; i++) {
    const p = G.plan(i);
    assert(p.portal && p.portal.frames.length === 12 && p.spawners.length === 1, `stronghold ${i}: ${p.pieces.length} pieces, portal ${!!p.portal}`);
  }
  const n = G.nearest(0, 0);
  const plan = G.plan(n.i);
  // Its chunks: the twelve frames, all turned toward the inside (eyes in
  // them all make the portal), bricks, chests, the spawner.
  const w = fakeWorld(T);
  const room = plan.portal;
  const frames = room.frames.map((f) => w.getBlock(f[0], f[1], f[2]));
  assert(frames.every(E.isFrame), `frames: ${frames}`);
  for (const f of room.frames) w.setBlock(f[0], f[1], f[2], E.frameId(E.frameFacing(w.getBlock(f[0], f[1], f[2])), true));
  const cells = E.portalOfFrame((x, y, z) => w.getBlock(x, y, z), ...room.frames[0]);
  assert(cells && cells.length === 36 && cells[3] === V.END_PORTAL, "twelve eyes: the portal");
  const s = plan.spawners[0];
  assert(w.getBlock(s[0], s[1], s[2]) === V.SILVERFISH_SPAWNER, "the spawner");
  const ch = plan.chests[0];
  assert(BLOCK_INFO[w.getBlock(ch[0], ch[1], ch[2])]?.name === "Chest" && T.structures?.chestAt?.(ch[0], ch[1], ch[2]) === ch[3], `a chest: ${ch} ${T.structures?.chestAt?.(ch[0], ch[1], ch[2])}`);
  const c = room.center;
  assert(w.getBlock(c[0], c[1] - 2, c[2]) === V.LAVA, "lava under the portal");
  // Nothing within 2 of the ground over it.
  for (const p of plan.pieces) assert(p.box[4] < T.heightAt((p.box[0] + p.box[3]) >> 1, (p.box[2] + p.box[5]) >> 1) + 20, "a piece over the ground");
  for (const kind of ["stronghold_corridor", "stronghold_crossing", "stronghold_library"]) assert(ST.rollStructureLoot(kind, Math.random)?.length >= 1, kind);
  assert(T.structures?.spawnerSpots(s[0] >> 4, s[2] >> 4).cells.some((q) => q[0] === s[0] && q[1] === s[1] && q[2] === s[2]), "the spawner known to Spawners");
});

await check("the portal's check: twelve eyes, every frame turned toward the inside; eleven, or one turned out, is no portal", async () => {
  const build = (eyes, wrong = -1) => {
    const w = fakeWorld(null);
    let k = 0;
    const list = [];
    for (let d = 0; d < 4; d++) {
      for (let j = -1; j <= 1; j++) {
        const FX = [0, 0, 1, -1][d];
        const FZ = [1, -1, 0, 0][d];
        const f = [1, 0, 3, 2][d];
        list.push(FX * 2 + FZ * j, 10, FZ * 2 + FX * j, E.frameId(k === wrong ? d : f, k < eyes));
        k++;
      }
    }
    w.setBlocks(list);
    return [w, list];
  };
  const [w1, l1] = build(12);
  assert(E.portalOfFrame((x, y, z) => w1.getBlock(x, y, z), l1[0], l1[1], l1[2])?.length === 36, "twelve");
  const [w2, l2] = build(11);
  assert(!E.portalOfFrame((x, y, z) => w2.getBlock(x, y, z), l2[4 * 5], l2[4 * 5 + 1], l2[4 * 5 + 2]), "eleven");
  const [w3, l3] = build(12, 7);
  assert(!E.portalOfFrame((x, y, z) => w3.getBlock(x, y, z), l3[0], l3[1], l3[2]), "one turned out");
});

await check("chorus: a plant holds on end stone or a held plant beside it; a flower grows up and branches; the gateways' ring", async () => {
  const w = fakeWorld(null);
  w.setBlocks([0, 10, 0, V.END_STONE, 0, 11, 0, V.CHORUS_PLANT, 0, 12, 0, V.CHORUS_PLANT, 1, 12, 0, V.CHORUS_PLANT, 2, 12, 0, V.CHORUS_FLOWER]);
  const get = (x, y, z) => w.getBlock(x, y, z);
  assert(E.chorusSurvives(get, 0, 11, 0) && E.chorusSurvives(get, 0, 12, 0) && E.chorusSurvives(get, 1, 12, 0), "held");
  w.setBlock(0, 11, 0, BLOCK.AIR);
  assert(!E.chorusSurvives(get, 0, 12, 0) || !E.chorusSurvives(get, 1, 12, 0), "the stem gone: the branch has no hold");
  // A flower on end stone, ticked: it grows.
  const g = fakeWorld(null);
  g.setBlocks([5, 20, 5, V.END_STONE, 5, 21, 5, V.CHORUS_FLOWER]);
  let r = 1;
  const rand = () => ((r = (r * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < 40; i++) {
    for (let y = 21; y < 60; y++) for (let x = 0; x < 11; x++) for (let z = 0; z < 11; z++) {
      const id = g.getBlock(x, y, z);
      if (C.RANDOM_TICK[id] && rand() < 0.3) C.RANDOM_TICK[id](g, x, y, z, id, rand);
    }
  }
  let plants = 0;
  for (let y = 21; y < 60; y++) for (let x = 0; x < 11; x++) for (let z = 0; z < 11; z++) if (g.getBlock(x, y, z) === V.CHORUS_PLANT) plants++;
  assert(plants >= 3, `the flower grew ${plants} plants`);
  const order = ES.gatewayOrder(4711);
  assert(order.length === 20 && new Set(order.map((p) => p.join())).size === 20 && order.every((p) => p[1] === 75 && Math.abs(Math.hypot(p[0], p[2]) - 96) < 2), "20 gateways on the ring");
  const cells = ES.gatewayCells(10, 75, 10);
  const gw = new Map();
  for (let i = 0; i < cells.length; i += 4) gw.set(`${cells[i]},${cells[i + 1]},${cells[i + 2]}`, cells[i + 3]);
  assert(gw.get("10,75,10") === V.END_GATEWAY && gw.get("10,76,10") === BLOCK.BEDROCK && gw.get("11,74,10") === BLOCK.BEDROCK && gw.get("10,77,10") === BLOCK.BEDROCK && gw.get("11,75,10") === BLOCK.AIR, "the gateway's shape");
});

// ---------- In the browser ----------

if (!args.node) await browserChecks();

async function browserChecks() {
  const { chromium } = await import("playwright-core");
  const PORT = 9880 + Math.floor(Math.random() * 40);
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
    args: ["--use-gl=swiftshader", "--enable-webgl", "--ignore-gpu-blocklist", "--no-sandbox", "--disable-dev-shm-usage", "--disable-features=WebRtcHideLocalIpsWithMdns", "--autoplay-policy=no-user-gesture-required"],
  });
  const localThreeRoot = path.join(__dirname, "node_modules", "three");
  const peerjsFile = path.join(__dirname, "node_modules", "peerjs", "dist", "peerjs.min.js");
  async function newPage(label, size = { width: 960, height: 540 }, ctx = null) {
    ctx ||= await browser.newContext({ viewport: size });
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
  const v = (p, fn, arg) => p.evaluate(([src, a]) => new Function("g", "arg", `return (${src})(g, arg);`)(window.__ufo, a), [fn.toString(), arg]);
  async function until(p, fn, timeout = 30000, arg) {
    const t0 = Date.now();
    while (Date.now() - t0 < timeout) {
      const r = await v(p, fn, arg).catch(() => null);
      if (r) return r;
      await new Promise((res) => setTimeout(res, 200));
    }
    return null;
  }
  async function play(p) {
    const t0 = Date.now();
    while (Date.now() - t0 < 400000) {
      const st = await v(p, (g) => g.gameState);
      if (st === "playing") return;
      if (st === "dead") {
        await v(p, (g) => g.respawn());
        continue;
      }
      if (st === "start") await p.click("#play-btn", { timeout: 60000 }).catch(() => {});
      else if (await p.isVisible("#resume-btn").catch(() => false)) await p.click("#resume-btn", { timeout: 60000 }).catch(() => {});
      else if (await p.isVisible("#click-to-play").catch(() => false)) await p.click("#click-to-play", { timeout: 60000 }).catch(() => {});
      else {
        await p.mouse.click(300, 200);
        await frames(p, 5);
      }
      await frames(p, 3);
    }
    throw new Error("the game didn't start playing");
  }
  async function boot(p, query) {
    await p.goto(`http://127.0.0.1:${PORT}/index.html?${query}`, { waitUntil: "load", timeout: 60000 });
    await p.waitForFunction(() => !!window.__ufo && window.__ufo.graphicsReady, null, { timeout: 180000 });
    await play(p);
  }
  async function travel(p, dim, x, y, z, opts) {
    const ok = await v(p, (g, a) => g.dims.travel(a[0], a[1], a[2], a[3], a[4]), [dim, x, y, z, opts]);
    assert(ok, `the travel to ${dim} was refused`);
    assert(await until(p, (g) => !g.dims.pending, 90000), `the travel to ${dim} never ended`);
    await frames(p, 2);
  }
  // (many frames of the fight at once: its clock, not the page's)
  const fast = (p, seconds) => v(p, (g, s) => {
    for (let i = 0; i < s * 20; i++) g.endGame.update(0.05);
  }, seconds);
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
  const out = process.env.SHOTS || "";
  const SEED = 4711;
  const page = await newPage("solo");

  await browserCheck("an eye of ender flies toward the nearest stronghold, rising, then drops (4 in 5) or breaks", async () => {
    await boot(page, `seed=${SEED}&type=survival&graphics=low`);
    const r = await v(page, (g) => {
      g.setMode("creative");
      const e = g.endGame;
      const p = g.player.position;
      const target = e._strongholds().nearest(p.x, p.z);
      g.inventory.slots[0] = { id: 864, count: 1 };
      g.inventory.selected = 0;
      const ok = e.throwEye({ player: g.player, inventory: g.inventory, creative: false });
      const from = e.eyes[0].pos.clone();
      for (let i = 0; i < 40; i++) e.update(0.05);
      const mid = e.eyes[0].pos.clone();
      const n0 = g.entities.items?.length ?? 0;
      for (let i = 0; i < 60; i++) e.update(0.05);
      const d = [target.x - from.x, target.z - from.z];
      const m = [mid.x - from.x, mid.z - from.z];
      const cos = (d[0] * m[0] + d[1] * m[1]) / (Math.hypot(...d) * Math.hypot(...m));
      return { ok, cos, rise: mid.y - from.y, left: g.inventory.slots[0]?.count ?? 0, gone: e.eyes.length === 0, target };
    });
    assert(r.ok && r.left === 0, `thrown: ${JSON.stringify(r)}`);
    assert(r.cos > 0.99 && r.rise > 1, `its way: ${JSON.stringify(r)}`);
    assert(r.gone, "it never came down");
  });

  let room = null;
  await browserCheck("twelve eyes light the stronghold's portal (the twelfth through the frame's use); stepping in lands on the End's platform", async () => {
    room = await v(page, (g) => {
      const G = g.endGame._strongholds();
      const p = g.player.position;
      return G.plan(G.nearest(p.x, p.z).i).portal;
    });
    const c = room.center;
    await travel(page, "overworld", c[0] + 0.5, c[1] + 2, c[2] + 0.5, { place: "exact" });
    await v(page, (g) => (g.player.flying = true));
    assert(await until(page, (g, room) => room.frames.every((f) => g.world.getBlock(f[0], f[1], f[2]) >= 2601 && g.world.getBlock(f[0], f[1], f[2]) < 2609), 60000, room), "the frames never loaded");
    const lit = await v(page, async (g, room) => {
      const { BLOCK_USE } = await import("/js/content/index.js");
      const w = g.world;
      g.setMode("survival");
      const used = [];
      g.inventory.slots[0] = { id: 864, count: 12 };
      g.inventory.selected = 0;
      for (const f of room.frames) {
        const id = w.getBlock(f[0], f[1], f[2]);
        if (id >= 2605) continue;
        used.push(BLOCK_USE[id]({ world: w, player: g.player, inventory: g.inventory, audio: g.audio, x: f[0], y: f[1], z: f[2], id, stack: g.inventory.slots[0], creative: false }));
      }
      return { used: used.every(Boolean), portal: room.cells.map((q) => w.getBlock(q[0], q[1], q[2])), eyes: g.inventory.slots[0]?.count ?? 0, n: used.length };
    }, room);
    assert(lit.used && lit.portal.every((id) => id === V.END_PORTAL), `the portal: ${JSON.stringify(lit)}`);
    assert(lit.eyes === 12 - lit.n, `eyes used: ${JSON.stringify(lit)}`);
    if (out) await page.screenshot({ path: path.join(out, "end-portal-room.png") });
    // (once the engine's second after an arrival is over)
    assert(await until(page, (g) => g.dims._cool <= 0, 20000), "the arrival's cooldown");
    await v(page, (g, c) => {
      g.player.flying = false;
      g.player.position.set(c[0] + 0.5, c[1] + 0.2, c[2] + 0.5);
    }, room.center);
    assert(await until(page, (g) => g.dims.dim === "end" && !g.dims.pending, 90000), "the portal didn't take us");
    const s = await v(page, (g) => ({ p: g.player.position.toArray(), under: g.world.getBlock(Math.floor(g.player.position.x), Math.floor(g.player.position.y) - 1, Math.floor(g.player.position.z)) }));
    assert(Math.abs(s.p[0] - 100.5) < 1 && Math.abs(s.p[1] - 49) < 0.5 && Math.abs(s.p[2] - 0.5) < 1 && s.under === V.OBSIDIAN, `the platform: ${JSON.stringify(s)}`);
  });

  await browserCheck("the End: ten crystals on the pillars' bedrock, the dragon at 200, the boss bar", async () => {
    await v(page, (g) => g.setMode("creative"));
    const s = await v(page, (g) => {
      const e = g.endGame;
      return { st: e.state, n: e.crystals().length, d: !!e.d, hp: e.d?.hp, bar: !!document.getElementById("dragon-bar") };
    });
    assert(s.st && s.st.alive && s.st.crystals === 1023 && s.n === 10 && s.d && s.hp === 200, `the fight: ${JSON.stringify(s)}`);
    const tops = await v(page, (g) => g.endGame.gen.pillars.map((p) => g.world.blockIn("end", p.x, p.h, p.z)));
    assert(tops.every((id) => id === BLOCK.BEDROCK), `the pillars' tops: ${tops}`);
  });

  await browserCheck("the dragon takes damage (its head in full, its body a quarter and one), a crystal heals it, a crystal hit bursts and costs it 10", async () => {
    const r = await v(page, (g) => {
      const e = g.endGame;
      const d = e.d;
      e._think = () => {};
      const p = e.gen.pillars[0];
      // (hovering by the first pillar's crystal, out of the others' reach)
      d.pos.set(p.x + 0.5, p.h + 8, p.z + 0.5);
      d.phase = "hold";
      e.update(0.05);
      const list = e._standInList();
      const head = list.find((s) => s.part === "head");
      const body = list.find((s) => s.part === "body");
      const h0 = d.hp;
      g.mobs._hurt(head, 10, { x: 0, z: 1 }, 2, true);
      const h1 = d.hp;
      g.mobs._hurt(body, 10, { x: 0, z: 1 }, 2, true);
      const h2 = d.hp;
      for (let i = 0; i < 40; i++) e.update(0.05);
      const h3 = d.hp;
      const healer = d.healer;
      // The healer hit: it bursts, the dragon loses 10.
      const c = e._standInList().find((s) => s.crystal === healer);
      g.mobs._hurt(c, 1, { x: 0, z: 1 }, 0, true);
      e.update(0.05);
      return { h0, h1, h2, h3, h4: d.hp, healer, left: e.crystals().length, mask: e.state.crystals };
    });
    assert(r.h1 === r.h0 - 10 && Math.abs(r.h2 - (r.h1 - 3.5)) < 1e-6, `damage: ${JSON.stringify(r)}`);
    assert(r.healer === "p0" && r.h3 >= r.h2 + 3, `healing: ${JSON.stringify(r)}`);
    // (less 10, and the next crystal's heal may have begun)
    assert(r.left === 9 && !(r.mask & 1) && r.h4 <= r.h3 - 8.5, `the burst: ${JSON.stringify(r)}`);
  });

  await browserCheck("its breath: a cloud hurts this player (6 a second, through armour) and a glass bottle in it is dragon's breath", async () => {
    const r = await v(page, (g) => {
      const e = g.endGame;
      g.setMode("survival");
      const p = g.player.position;
      g.player.health = 20;
      g.player._invulnerable = 0;
      e._addCloud({ x: p.x, y: p.y, z: p.z, r: 3, grow: 0, life: 10, kind: "breath" }, true);
      for (let i = 0; i < 25; i++) e.update(0.05);
      const hp = g.player.health;
      g.inventory.slots.fill(null);
      g.inventory.slots[0] = { id: 345, count: 2 };
      g.inventory.selected = 0;
      return { hp, cloud: e.clouds[0]?.r };
    });
    assert(r.hp <= 14 && r.hp >= 6, `hurt: ${JSON.stringify(r)}`);
    const b = await v(page, async (g) => {
      const { ITEM_USE } = await import("/js/content/index.js");
      g.player.pitch = -1.4;
      const f = g.player.getForwardVector();
      const ctx = { world: g.world, player: g.player, inventory: g.inventory, audio: g.audio, interaction: g.interaction, stack: g.inventory.slots[0], forward: [f.x, f.y, f.z], creative: false };
      const ok = ITEM_USE[345](ctx);
      return { ok, slots: g.inventory.slots.filter(Boolean).map((s) => [s.id, s.count]), r: g.endGame.clouds[0]?.r };
    });
    assert(b.ok && JSON.stringify(b.slots).includes(`[${V.DRAGON_BREATH},1]`) && b.r === 2.5, `bottled: ${JSON.stringify(b)}`);
    await v(page, (g) => {
      g.endGame.clouds.length = 0;
      g.setMode("creative");
    });
  });

  await browserCheck("it dies: ten seconds rising, then the exit portal opens with the egg on top, a gateway, its experience; the portal takes you home", async () => {
    await v(page, (g) => g.endGame._damage("head", 999));
    await fast(page, 5);
    const mid = await v(page, (g) => ({ ph: g.endGame.d?.phase, beams: g.endGame.beams.mesh.visible }));
    assert(mid.ph === "dying" && mid.beams, `dying: ${JSON.stringify(mid)}`);
    if (out) {
      await v(page, (g) => {
        const d = g.endGame.d;
        g.player.position.set(d.pos.x + 20, d.pos.y, d.pos.z + 20);
        g.player.yaw = Math.atan2(20, 20);
        g.player.pitch = 0;
      });
      await frames(page, 4);
      await page.screenshot({ path: path.join(out, "end-dragon-dying.png") });
    }
    await fast(page, 6);
    const s = await v(page, (g) => {
      const e = g.endGame;
      const y = e.gen.podiumY;
      const b = (x, yy, z) => g.world.blockIn("end", x, yy, z);
      return { st: e.state, egg: b(0, y + 4, 0), portal: [b(1, y, 1), b(-2, y, 0), b(0, y, -2)], gw: e._gatewaysKnown(), orbs: g.xp?.orbs?.length ?? 0, bar: document.getElementById("dragon-bar")?.style.display };
    });
    assert(s.st && !s.st.alive && s.st.killed && s.egg === V.DRAGON_EGG && s.portal.every((id) => id === V.END_PORTAL), `the portal: ${JSON.stringify(s)}`);
    assert(s.gw.length === 1 && s.st.gateways.length === 1 && s.orbs > 0 && s.bar === "none", `gateway, xp, bar: ${JSON.stringify(s)}`);
    const gw = s.gw[0];
    assert((await v(page, (g, p) => g.world.blockIn("end", p[0], p[1], p[2]), gw)) === V.END_GATEWAY, "the gateway's block");
    // Saved: a reload keeps the fight's end.
    await v(page, (g) => g.flushSave?.(true));
    const saved = await v(page, () => {
      const raw = localStorage.getItem("ufocombat_v1_player_4711");
      return raw ? JSON.parse(raw).end : null;
    });
    assert(saved && saved.killed && !saved.alive && saved.gateways.length === 1, `the save: ${JSON.stringify(saved)}`);
    // Home through the exit portal.
    await v(page, (g) => {
      const y = g.endGame.gen.podiumY;
      g.player.flying = false;
      g.player.position.set(1.5, y + 0.2, 1.5);
    });
    assert(await until(page, (g) => g.dims.dim === "overworld" && !g.dims.pending, 90000), "the exit portal didn't take us home");
  });

  await browserCheck("an elytra: the jump key in the air spreads it, it glides on, wears 1 a second, and folds on landing", async () => {
    await v(page, (g) => {
      g.setMode("survival");
      g.inventory.armor[1] = { id: 869, count: 1, dur: 432 };
      g.player.flying = false;
      const p = g.player.position;
      g.player.position.set(p.x, 110, p.z);
      g.player.velocity.set(0, -3, 0);
      g.player.pitch = -0.25;
    });
    await frames(page, 2);
    await v(page, (g) => g.player.keys.add("Space"));
    await frames(page, 2);
    await v(page, (g) => g.player.keys.delete("Space"));
    const a = await v(page, (g) => ({ on: g.endGame.gliding, p: g.player.position.toArray() }));
    await frames(page, 30);
    const b = await v(page, (g) => ({ on: g.endGame.gliding, p: g.player.position.toArray(), dur: g.inventory.armor[1]?.dur }));
    const dist = Math.hypot(b.p[0] - a.p[0], b.p[2] - a.p[2]);
    assert(a.on && b.on && dist > 4 && b.dur < 432, `the glide: ${JSON.stringify(a)} -> ${JSON.stringify(b)}`);
    await v(page, (g) => {
      g.inventory.armor[1] = null;
      g.setMode("creative");
    });
  });

  await browserCheck("four end crystals set round the exit portal summon a new dragon: the pillars and their crystals come back, the portal goes out", async () => {
    await v(page, (g) => g.setMode("creative"));
    await v(page, (g) => g.dims.debugTravel("end"));
    assert(await until(page, (g) => g.dims.dim === "end" && !g.dims.pending, 90000), "back to the End");
    const r = await v(page, async (g) => {
      const { LIB } = await import("/js/content/base.js");
      const e = g.endGame;
      const y = e.gen.podiumY;
      // (a pillar blown down meanwhile)
      const p = e.gen.pillars[3];
      g.world.queueEdit(p.x, p.h - 1, p.z, 0);
      g.inventory.slots[0] = { id: 870, count: 4 };
      g.inventory.selected = 0;
      const placed = [];
      for (const [x, z] of [[3, 0], [-3, 0], [0, 3], [0, -3]]) {
        placed.push(LIB.placeEndCrystal({ world: g.world, player: g.player, inventory: g.inventory, audio: g.audio, x, y, z, id: g.world.blockIn("end", x, y, z), normal: [0, 1, 0], stack: g.inventory.slots[0], creative: false }));
      }
      const before = { alive: e.state.alive, placed: e.state.placed.length, ritual: !!e.state.respawn };
      for (let i = 0; i < 20 * 15; i++) e.update(0.05);
      return { placed, before, left: g.inventory.slots[0]?.count ?? 0, after: { alive: e.state.alive, mask: e.state.crystals, placed: e.state.placed.length, d: !!e.d, hp: e.d?.hp, portal: g.world.blockIn("end", 1, y, 1), pillar: g.world.blockIn("end", p.x, p.h - 1, p.z) } };
    });
    assert(r.placed.every(Boolean) && r.left === 0 && r.before.placed === 4 && !r.before.alive, `the crystals: ${JSON.stringify(r)}`);
    const a = r.after;
    assert(a.alive && a.d && a.hp === 200 && a.mask === 1023 && a.placed === 0 && a.portal === BLOCK.AIR && a.pillar === V.OBSIDIAN, `the new dragon: ${JSON.stringify(r)}`);
  });

  // ---------- Online ----------
  if (args.online) {
    const express = (await import("express")).default;
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
    await browserCheck("online: a guest alone in the End flies the dragon (the host keeps the state); the host arriving takes it over; the guest then sees the host's dragon, its blows reach it, and it sees the portal open when the host kills it", async () => {
      await host.goto(`http://127.0.0.1:${PORT}/index.html?seed=4713&type=survival&${NET_Q}`, { waitUntil: "load", timeout: 60000 });
      await host.waitForFunction(() => !!window.__ufo && window.__ufo.graphicsReady, null, { timeout: 120000 });
      await host.click("#menu-mp-btn");
      await host.fill("#mp-nick", "Alice");
      await host.click("#mp-host-btn");
      const code = await until(host, (g) => g.net.code, 30000);
      assert(code, "no room code");
      await host.click("#mp-lobby-play");
      await host.waitForFunction(() => window.__ufo.gameState === "playing", null, { timeout: 30000 });
      await v(host, noDraw);
      await v(host, (g) => g.setMode("creative"));
      await guest.goto(`http://127.0.0.1:${PORT}/index.html?join=${code}&${NET_Q}`, { waitUntil: "load", timeout: 60000 });
      await guest.waitForSelector("#mp-join-boot:not(.hidden)", { timeout: 30000 });
      await guest.fill("#mp-boot-nick", "Bob");
      await guest.click("#mp-boot-join");
      await guest.waitForFunction(() => !!window.__ufo && window.__ufo.graphicsReady, null, { timeout: 120000 });
      assert(await until(guest, (g) => g.mp.stateLoaded, 60000), "the host's state never arrived");
      await v(guest, noDraw);
      await play(guest);
      // The guest alone in the End: it simulates the fight, the host hears of it.
      await v(guest, (g) => g.setMode("creative"));
      await v(guest, (g) => g.dims.debugTravel("end"));
      assert(await until(guest, (g) => g.dims.dim === "end" && !g.dims.pending && g.endGame.authority && g.endGame.d, 90000), "the guest never flew the dragon");
      await v(guest, (g) => {
        const e = g.endGame;
        e._think = () => {};
        e.d.pos.set(100, 70, 10);
        e._damage("head", 10);
        e._changed();
      });
      const kept = await until(host, (g) => g.endGame.state && g.endGame.state.alive && g.endGame.state.hp <= 191 && g.endGame.state, 20000);
      assert(kept, `the host never kept the guest's fight: ${JSON.stringify(await v(host, (g) => g.endGame.state))}`);
      // The host comes: it simulates from there on.
      await v(host, (g) => g.dims.debugTravel("end"));
      assert(await until(host, (g) => g.dims.dim === "end" && !g.dims.pending && g.endGame.d, 90000), "the host never reached the End");
      const took = await v(host, (g) => ({ hp: g.endGame.d.hp, auth: g.endGame.authority }));
      assert(took.auth && took.hp <= 193, `the host's dragon: ${JSON.stringify(took)}`);
      assert(await until(guest, (g) => !g.endGame.authority && !g.endGame.d, 20000), "the guest still flies its own");
      // (the host's dragon held still in front of the guest)
      await v(host, (g) => {
        const e = g.endGame;
        e._think = () => {};
        e.d.pos.set(100, 70, 10);
        e.d.phase = "hold";
      });
      const pose = await until(guest, (g) => {
        const p = !g.endGame.authority && g.endGame._poseNow?.p;
        return p && Math.abs(p[0] - 100) < 3 && Math.abs(p[1] - 70) < 3 && Math.abs(p[2] - 10) < 3 && p;
      }, 30000);
      const seen = await v(guest, (g) => ({ auth: g.endGame.authority, p: g.endGame._poseNow?.p, puppet: !!g.endGame.puppet }));
      assert(pose, `the guest's puppet: ${JSON.stringify(seen)}`);
      const hp0 = await v(host, (g) => g.endGame.d.hp);
      await v(guest, (g) => {
        const head = g.endGame._standInList().find((s) => s.part === "head");
        g.mobs._hurt(head, 12, { x: 0, z: 1 }, 2, true);
      });
      assert(await until(host, (g, hp0) => g.endGame.d.hp <= hp0 - 11, 20000, hp0), "the guest's blow never reached the host's dragon");
      // The host kills it; the guest sees the portal open.
      await v(host, (g) => g.endGame._damage("head", 999));
      await v(host, (g) => {
        for (let i = 0; i < 230; i++) g.endGame.update(0.05);
      });
      const y = await v(host, (g) => g.endGame.gen.podiumY);
      assert(await until(guest, (g, y) => g.world.getBlock(1, y, 1) === 2609 && g.endGame.state && !g.endGame.state.alive, 40000, y), "the guest never saw the portal open");
      await guest.close();
      await host.close();
    });
    peerHttp.close();
  }

  await browser.close();
  server.close();
}

// ---------- Summary ----------
const failed = results.filter(([, ok]) => !ok);
console.log(`\n${results.length - failed.length} passed, ${failed.length} failed.`);
process.exit(failed.length ? 1 : 0);
