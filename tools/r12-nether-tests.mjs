// Round 12 Nether tests (js/content/nether.js, js/dim-nether.js,
// js/nether-structures.js, js/portal.js, js/brewing.js).
// In Node (fast): the blocks' vanilla values, drops and recipes; the
// generator (bedrock floor and roof, the lava sea, every biome, the same
// chunk every time, its speed against the Overworld's); a fortress (its
// pieces, a blaze spawner standing where the plan says, its chests' table),
// a bastion's chests, a ruined portal in the Overworld; the portal frame's
// shapes (2 x 3 to 21 x 21, corners optional, a block inside or a hole in the
// frame: none); the loot tables.
// In the browser (the real game, a Survival world): a frame lit by fire
// becomes a portal and a fire on soul sand soul fire; standing in it (the
// 4 s wait) takes you to the Nether at x/8 into a portal built there and
// registered, and back into the first one; mining a frame block takes the
// portal down; the fortress's blaze spawner and chest loot in the game, its
// biome's fog; nether wart grows on soul sand; brewing with blaze powder and nether wart; water
// boils away from a bucket; soul sand slows and magma burns; a respawn
// anchor charged and used; the smithing table's upgrade. With --online, a
// host's portal seen and used by a guest, the portal the guest's trip built
// in the Nether known to the host.
//
//   node r12-nether-tests.mjs [--only=substring] [--node] [--online]
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
const WT = await imp("js/worldtype.js");
WT.setWorldType?.("survival");
const R = await imp("js/dim-registry.js");
const { BLOCK, ITEM } = await imp("js/content/base.js");
const V = await imp("js/content/ids.js");
const B = await imp("js/blocks.js");
const IT = await imp("js/items.js");
const NG = await imp("js/dim-nether.js");
const NS = await imp("js/nether-structures.js");
const PO = await imp("js/portal.js");
const CR = await imp("js/crafting.js");

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
const at = (b, x, y, z) => b[(y << 8) | (z << 4) | x];
const seq = (seed) => {
  let s = seed >>> 0;
  return () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296);
};

// ---------- In Node ----------

await check("the blocks and items: vanilla's hardness, tools and tiers, drops, light, the portal's block", async () => {
  const I = B.BLOCK_INFO;
  assert(I[V.NETHERRACK].hardness === 0.4 && I[V.NETHERRACK].tool === "pickaxe" && I[V.NETHERRACK].infiniburn, "netherrack");
  assert(I[V.ANCIENT_DEBRIS].hardness === 30 && I[V.ANCIENT_DEBRIS].minTier === 4 && I[V.ANCIENT_DEBRIS].blastResistance === 1200, "ancient debris");
  assert(I[V.GLOWSTONE].emission === 15 && I[V.SHROOMLIGHT].emission === 15 && I[V.CRYING_OBSIDIAN].emission === 10 && I[V.MAGMA_BLOCK].emission === 3, "light");
  assert(I[V.SOUL_SAND].speedFactor === 0.4 && I[V.SOUL_SAND].collision[0][4] === 14 / 16 && I[V.MAGMA_BLOCK].hotFloor, "soul sand, magma");
  const p = I[V.NETHER_PORTAL];
  assert(p.emission === 11 && !p.solid && p.hardness < 0 && R.PORTAL_BLOCKS.get(V.NETHER_PORTAL) === "nether" && R.PORTAL_BLOCKS.get(V.NETHER_PORTAL + 1) === "nether", "the portal block");
  const rand = seq(7);
  const pick = { type: "pickaxe", tier: 1 };
  for (let k = 0; k < 40; k++) {
    const g = IT.blockDrops(V.GLOWSTONE, null, rand);
    assert(g.length === 1 && g[0][0] === V.GLOWSTONE_DUST && g[0][1] >= 2 && g[0][1] <= 4, `glowstone: ${JSON.stringify(g)}`);
    const n = IT.blockDrops(V.NETHER_GOLD_ORE, pick, rand);
    assert(n[0][0] === V.GOLD_NUGGET && n[0][1] >= 2 && n[0][1] <= 6, `gold ore: ${JSON.stringify(n)}`);
    const w = IT.blockDrops(V.NETHER_WART + 3, null, rand);
    assert(w[0][0] === V.NETHER_WART && w[0][1] >= 2 && w[0][1] <= 4, `ripe wart: ${JSON.stringify(w)}`);
  }
  assert(IT.blockDrops(V.NETHER_QUARTZ_ORE, pick, rand)[0][0] === V.QUARTZ && IT.blockDrops(V.NETHER_QUARTZ_ORE, null, rand).length === 0, "quartz ore");
  assert(IT.blockDrops(V.NETHER_WART, null, rand)[0][1] === 1, "young wart");
  assert(IT.blockDrops(V.CRIMSON_NYLIUM, pick, rand)[0][0] === V.NETHERRACK, "nylium");
  assert(IT.blockDrops(V.ANCIENT_DEBRIS, { type: "pickaxe", tier: 3 }, rand).length === 0 && IT.blockDrops(V.ANCIENT_DEBRIS, { type: "pickaxe", tier: 4 }, rand)[0][0] === V.ANCIENT_DEBRIS, "debris needs diamond");
  const sword = IT.itemInfo(V.NETHERITE_SWORD);
  assert(sword.tool.durability === 2031 && sword.tool.vDamage === 8 && IT.itemInfo(V.NETHERITE_CHESTPLATE).armor.points === 8, "netherite gear");
  // (the families, when building.js makes them)
  if (I[V.NETHER_BRICK_FENCE]) assert(I[V.NETHER_BRICK_STAIRS].name === "Nether Brick Stairs" && I[V.CRIMSON_FENCE_GATE].name === "Crimson Fence Gate" && I[V.NETHER_BRICK_WALL].shape === I[V.COBBLESTONE_WALL].shape, "families");
});

await check("recipes: netherite, blaze powder, the brewing stand's blaze rod, smelting debris into scrap, nether bricks", async () => {
  const list = [...CR.coreRecipes(), ...(await imp("js/content/index.js")).recipes()];
  const makes = (id) => list.filter((r) => r.result?.[0] === id);
  const ing = makes(V.NETHERITE_INGOT).find((r) => r.type === "shapeless" && r.ingredients.includes(V.NETHERITE_SCRAP));
  assert(ing && ing.ingredients.filter((i) => i === V.NETHERITE_SCRAP).length === 4 && ing.ingredients.filter((i) => i === ITEM.GOLD_INGOT).length === 4, "netherite ingot");
  assert(makes(V.BLAZE_POWDER).some((r) => r.result[1] === 2), "blaze powder");
  const stand = makes(V.BREWING_STAND)[0];
  assert(stand && Object.values(stand.key).some((k) => k === V.BLAZE_ROD), `the brewing stand: ${JSON.stringify(stand)}`);
  assert(!Object.values(stand.key).includes(V.IRON_INGOT), "the stand-in iron ingot is still there");
  assert(list.some((r) => r.type === "smelting" && r.input === V.ANCIENT_DEBRIS && r.result[0] === V.NETHERITE_SCRAP), "debris smelted");
  assert(list.some((r) => r.type === "smelting" && r.input === V.NETHERRACK && r.result[0] === V.NETHER_BRICK), "nether brick");
  assert(makes(V.MAGMA_CREAM).length && makes(V.FIRE_CHARGE).length && makes(V.RED_NETHER_BRICKS).length && makes(V.SMITHING_TABLE).length, "more");
});

const gen = R.createGenerator("nether", 4711, { vanilla: true });
await check("the Nether's terrain: bedrock floor and roof, a lava sea up to 31, open caverns, the same chunk every time", async () => {
  const a = chunkOf(gen, 3, -2);
  const b = chunkOf(R.createGenerator("nether", 4711, { vanilla: true }), 3, -2);
  assert(a.every((v, i) => v === b[i]), "not deterministic");
  let air = 0;
  for (let x = 0; x < 16; x++) {
    for (let z = 0; z < 16; z++) {
      assert(at(a, x, 0, z) === BLOCK.BEDROCK && at(a, x, 127, z) === BLOCK.BEDROCK, "no bedrock floor or roof");
      for (let y = 5; y < 122; y++) {
        const id = at(a, x, y, z);
        if (id === BLOCK.AIR) {
          air++;
          assert(y > 31, `air in the lava sea at y ${y}`);
        }
      }
    }
  }
  assert(air > 3000, `too few caverns (${air})`);
  let lava = 0;
  for (let cx = 0; cx < 6; cx++) for (const id of chunkOf(gen, cx, 4)) if (id === V.LAVA) lava++;
  assert(lava > 500, `no lava sea (${lava})`);
});

await check("the biomes (all five within 1500 blocks) and their ground: nylium, soul sand, basalt, glowstone and ores", async () => {
  const found = new Map();
  for (let x = -1500; x <= 1500 && found.size < 5; x += 40) for (let z = -1500; z <= 1500 && found.size < 5; z += 40) if (!found.has(gen.biomeAt(x, z))) found.set(gen.biomeAt(x, z), [x, z]);
  assert(found.size === 5, `biomes: ${[...found.keys()]}`);
  const want = { 1: V.SOUL_SAND, 2: V.CRIMSON_NYLIUM, 3: V.WARPED_NYLIUM, 4: V.BASALT };
  for (const [b, id] of Object.entries(want)) {
    const [x, z] = found.get(Number(b));
    let n = 0;
    for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) for (const v of chunkOf(gen, (x >> 4) + dx, (z >> 4) + dz)) if (v === id) n++;
    assert(n > 40, `${NG.NETHER_BIOME_NAMES[b]}: ${n} of its ground`);
  }
  let glow = 0;
  let quartz = 0;
  let gold = 0;
  for (let cx = -3; cx < 3; cx++) for (let cz = -3; cz < 3; cz++) for (const v of chunkOf(gen, cx, cz)) {
    if (v === V.GLOWSTONE) glow++;
    else if (v === V.NETHER_QUARTZ_ORE) quartz++;
    else if (v === V.NETHER_GOLD_ORE) gold++;
  }
  assert(glow > 50 && quartz > 600 && gold > 200, `glowstone ${glow}, quartz ${quartz}, gold ${gold} in 36 chunks`);
});

await check("the generator's speed: about the Overworld's", async () => {
  const ow = R.createGenerator("overworld", 4711, { vanilla: true, sites: false });
  for (let i = 0; i < 4; i++) {
    chunkOf(ow, 50 + i, 3);
    chunkOf(gen, 50 + i, 3);
  }
  let t0 = performance.now();
  for (let i = 0; i < 16; i++) chunkOf(ow, i % 4, 10 + (i >> 2));
  const owMs = (performance.now() - t0) / 16;
  t0 = performance.now();
  for (let i = 0; i < 16; i++) chunkOf(gen, i % 4, 10 + (i >> 2));
  const nMs = (performance.now() - t0) / 16;
  console.log(`        (Overworld ${owMs.toFixed(2)} ms a chunk, the Nether ${nMs.toFixed(2)})`);
  assert(nMs < Math.max(6, owMs * 1.6), `${nMs.toFixed(2)} ms a chunk (the Overworld's ${owMs.toFixed(2)})`);
});

await check("a fortress: bridges, castle corridors, a blaze spawner standing where its plan says, a chest of the nether_bridge table", async () => {
  const s = gen.structures;
  const f = s.nearest("fortress", 0, 0, 3000);
  assert(f, "no fortress within 3000 blocks");
  const plan = s.startOf(Math.floor((f.x >> 4) / 27), Math.floor((f.z >> 4) / 27));
  const kinds = new Set(plan.pieces.map((p) => p.kind));
  assert(plan.pieces.length > 15 && kinds.has("bridge") && kinds.has("crossing") && kinds.has("throne"), `pieces: ${[...kinds]}`);
  assert(plan.spawners.length >= 1 && plan.spawners.length <= 2, `spawners: ${plan.spawners.length}`);
  const [sx, sy, sz] = plan.spawners[0];
  const c = chunkOf(gen, sx >> 4, sz >> 4);
  assert(at(c, sx & 15, sy, sz & 15) === V.BLAZE_SPAWNER, `no blaze spawner at ${plan.spawners[0]}`);
  const spots = s.spawnerSpots(sx >> 4, sz >> 4);
  assert(spots.cells.some((p) => p[0] === sx && p[1] === sy && p[2] === sz), "spawnerSpots");
  assert(s.fortressAt(sx, sy, sz) && !s.fortressAt(sx + 400, sy, sz), "fortressAt");
  // A deck of nether bricks under the start.
  const st = plan.pieces[0].f;
  assert(at(chunkOf(gen, st.ox >> 4, (st.oz + 4) >> 4), st.ox & 15, st.oy, (st.oz + 4) & 15) === V.NETHER_BRICKS || at(chunkOf(gen, st.ox >> 4, (st.oz + 4) >> 4), st.ox & 15, st.oy, (st.oz + 4) & 15) === V.CRACKED_NETHER_BRICKS, "no deck at the start");
  if (plan.chests.length) {
    const [cx, cy, cz] = plan.chests[0];
    assert(B.IS_CHEST[at(chunkOf(gen, cx >> 4, cz >> 4), cx & 15, cy, cz & 15)], `no chest at ${plan.chests[0]}`);
    assert(s.chestAt(cx, cy, cz) === "nether_bridge", "chestAt");
  }
  // Every fortress of a few regions has at least one spawner.
  let none = 0;
  for (let rx = -3; rx <= 3; rx++) for (let rz = -3; rz <= 3; rz++) {
    const p = s.startOf(rx, rz);
    if (p?.kind === "fortress" && !p.spawners.length) none++;
  }
  assert(none === 0, `${none} fortresses without a spawner`);
});

await check("a bastion: blackstone walls, gold, the treasure chest's and the ramparts' tables; never in the basalt deltas", async () => {
  const s = gen.structures;
  const b = s.nearest("bastion", 0, 0, 3000);
  assert(b, "no bastion within 3000 blocks");
  const plan = s.startOf(Math.floor((b.x >> 4) / 27), Math.floor((b.z >> 4) / 27));
  const [tx, ty, tz] = plan.chests[0];
  assert(s.chestAt(tx, ty, tz) === "bastion_treasure" && plan.chests.slice(1).every((c) => s.chestAt(c[0], c[1], c[2]) === "bastion_other"), "chest tables");
  let walls = 0;
  let gold = 0;
  const cx = b.x >> 4;
  const cz = b.z >> 4;
  for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) for (const v of chunkOf(gen, cx + dx, cz + dz)) {
    if (v === V.POLISHED_BLACKSTONE_BRICKS || v === V.CRACKED_POLISHED_BLACKSTONE_BRICKS) walls++;
    if (v === V.GOLD_BLOCK) gold++;
  }
  assert(walls > 400 && gold > 0, `walls ${walls}, gold ${gold}`);
  assert(s.bastionAt(b.x, b.y + 3, b.z), "bastionAt");
  for (let rx = -4; rx <= 4; rx++) for (let rz = -4; rz <= 4; rz++) {
    const p = s.startOf(rx, rz);
    if (p?.kind === "bastion") assert(gen.biomeAt(p.x, p.z) !== NG.NETHER_BIOME.BASALT_DELTAS, "a bastion in the deltas");
  }
});

await check("loot: the fortress's, the bastions' (the treasure always holds the netherite upgrade), the ruined portals'", async () => {
  const S = await imp("js/structures.js");
  const rand = seq(3);
  let up = 0;
  let items = 0;
  for (let k = 0; k < 60; k++) {
    const t = S.rollStructureLoot("bastion_treasure", rand);
    if (t.some(([id]) => id === V.NETHERITE_UPGRADE)) up++;
    items += S.rollStructureLoot("nether_bridge", rand).length + S.rollStructureLoot("ruined_portal", rand).length;
  }
  assert(up === 60, `the treasure's upgrade: ${up} of 60`);
  assert(items > 300, `too little loot (${items})`);
  assert(S.isSpawner(V.BLAZE_SPAWNER) && S.isSpawner(1661), "the blaze spawner is a spawner");
});

await check("ruined portals in the Overworld: a broken obsidian frame on netherrack, a chest of their own", async () => {
  const ow = R.createGenerator("overworld", 4711, { vanilla: true, sites: false });
  const rp = ow.structures?.ruined;
  assert(rp, "the Overworld has no ruined portals (structures.js)");
  let plan = null;
  for (let rx = -3; rx <= 3 && !plan; rx++) for (let rz = -3; rz <= 3 && !plan; rz++) plan = rp.planOf(rx, rz);
  assert(plan, "no ruined portal in 49 regions");
  const c = chunkOf(ow, plan.x >> 4, plan.z >> 4);
  let obs = 0;
  let rack = 0;
  for (const v of c) {
    if (v === V.OBSIDIAN || v === V.CRYING_OBSIDIAN) obs++;
    if (v === V.NETHERRACK || v === V.MAGMA_BLOCK) rack++;
  }
  assert(obs >= 6 && rack >= 10, `obsidian ${obs}, netherrack ${rack}`);
  const [qx, qy, qz] = plan.chest;
  let y = -1;
  const cc = chunkOf(ow, qx >> 4, qz >> 4);
  for (let yy = qy - 4; yy <= qy + 4; yy++) if (B.IS_CHEST[at(cc, qx & 15, yy, qz & 15)]) y = yy;
  assert(y > 0 && ow.structures.chestAt(qx, y, qz) === "ruined_portal", "its chest");
});

await check("the portal's frame: 2 x 3 to 21 x 21 inside, either plane, the corners optional; too small, a hole or a block inside: none", async () => {
  const make = (w, h, axis, opts = {}) => {
    const m = new Map();
    const [dx, dz] = axis ? [0, 1] : [1, 0];
    for (let i = -1; i <= w; i++) {
      for (let k = -1; k <= h; k++) {
        const frame = i === -1 || i === w || k === -1 || k === h;
        const corner = (i === -1 || i === w) && (k === -1 || k === h);
        if (frame && corner && opts.noCorners) continue;
        m.set(`${10 + dx * i},${20 + k},${10 + dz * i}`, frame ? V.OBSIDIAN : BLOCK.AIR);
      }
    }
    if (opts.hole) m.set(`${10 + dx * w},${21},${10 + dz * w}`, BLOCK.AIR);
    if (opts.inside) m.set(`10,21,10`, BLOCK.STONE);
    return (x, y, z) => m.get(`${x},${y},${z}`) ?? BLOCK.STONE;
  };
  const s = PO.findPortalShape(make(2, 3, 0), 10, 20, 10, 0);
  assert(s && s.w === 2 && s.h === 3 && s.x === 10 && s.y === 20 && s.z === 10, `2 x 3: ${JSON.stringify(s)}`);
  assert(PO.findPortalShape(make(2, 3, 1), 10, 21, 10, 1)?.w === 2, "along z");
  assert(!PO.findPortalShape(make(2, 3, 1), 10, 21, 10, 0), "the wrong plane");
  assert(PO.findPortalShape(make(2, 3, 0, { noCorners: true }), 11, 22, 10, 0)?.h === 3, "without corners");
  const big = PO.findPortalShape(make(21, 21, 0), 25, 30, 10, 0);
  assert(big && big.w === 21 && big.h === 21, `21 x 21: ${JSON.stringify(big)}`);
  assert(!PO.findPortalShape(make(22, 5, 0), 12, 21, 10, 0), "22 wide");
  assert(!PO.findPortalShape(make(1, 3, 0), 10, 20, 10, 0), "1 wide");
  assert(!PO.findPortalShape(make(2, 2, 0), 10, 20, 10, 0), "2 high");
  assert(!PO.findPortalShape(make(2, 3, 0, { hole: true }), 10, 20, 10, 0), "a hole in the frame");
  assert(!PO.findPortalShape(make(2, 3, 0, { inside: true }), 11, 20, 10, 0), "a block inside");
  assert(PO.shapeCells(s).length === 2 * 3 * 3, "its cells");
});

// ---------- In the browser ----------

if (!args.node) await browserChecks();

async function browserChecks() {
  const { chromium } = await import("playwright-core");
  const PORT = 9840 + Math.floor(Math.random() * 40);
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
      await new Promise((res) => setTimeout(res, 150));
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
  async function travel(p, dim, x, y, z, place = "safe") {
    const ok = await v(p, (g, a) => g.dims.travel(a[0], a[1], a[2], a[3], { place: a[4] }), [dim, x, y, z, place]);
    assert(ok, `the travel to ${dim} was refused`);
    assert(await until(p, (g) => !g.dims.pending, 90000), `the travel to ${dim} never ended`);
    await frames(p, 2);
  }
  // A 4 x 5 obsidian frame (2 x 3 inside) standing on the ground at (x, y, z), along x, with room round it.
  const buildFrame = (g, a) => {
    const [x, y, z, axis] = a;
    const [dx, dz] = axis ? [0, 1] : [1, 0];
    const [px, pz] = axis ? [1, 0] : [0, 1];
    const list = [];
    for (let i = -2; i <= 3; i++) for (let h = -1; h <= 4; h++) for (let j = -2; j <= 2; j++) list.push(x + dx * i + px * j, y + h, z + dz * i + pz * j, h === -1 ? 1 : 0);
    for (let i = -1; i <= 2; i++) for (let h = -1; h <= 3; h++) list.push(x + dx * i, y + h, z + dz * i, i === -1 || i === 2 || h === -1 || h === 3 ? 1550 : 0); // (obsidian)
    g.world.setBlocks(list);
    return true;
  };
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
  const SEED = 9201;
  const page = await newPage("solo");
  let F = null; // the Overworld frame's bottom-left inside cell
  await browserCheck("a frame lit by fire becomes a portal (and is registered); a frame with a hole doesn't; fire on soul sand is soul fire", async () => {
    await boot(page, `seed=${SEED}&type=survival&graphics=low`);
    F = await v(page, (g) => {
      g.sky.locked = true;
      g.sky.setHours(12);
      const p = g.player.position;
      const x = Math.floor(p.x) + 4;
      const z = Math.floor(p.z) + 4;
      return [x, Math.max(g.world.surfaceY(x, z), g.world.surfaceY(x + 1, z)) + 1, z];
    });
    await v(page, buildFrame, [...F, 0]);
    await v(page, (g, F) => g.world.setBlock(F[0] + 1, F[1] + 1, F[2], 1551), F);
    await frames(page, 3);
    const lit = await v(page, (g, F) => ({ a: g.world.getBlock(F[0], F[1], F[2]), b: g.world.getBlock(F[0] + 1, F[1] + 2, F[2]), reg: g.dims.portals.get("overworld") || [] }), F);
    assert(lit.a === V.NETHER_PORTAL && lit.b === V.NETHER_PORTAL, `not lit: ${JSON.stringify(lit)}`);
    assert(lit.reg.some((p) => p[0] === F[0] && p[1] === F[1] && p[2] === F[2]), `not registered: ${JSON.stringify(lit.reg)}`);
    // (a second frame along z, with a hole in its side: the fire stays fire)
    const G = [F[0] + 9, F[1], F[2]];
    await v(page, buildFrame, [...G, 1]);
    await v(page, (g, G) => {
      g.world.setBlock(G[0], G[1] + 1, G[2] + 2, 0);
      g.world.setBlock(G[0], G[1], G[2], 1551);
    }, G);
    await frames(page, 3);
    assert((await v(page, (g, G) => g.world.getBlock(G[0], G[1], G[2] + 1), G)) === BLOCK.AIR, "a broken frame lit");
    // (flint and steel on the inside of a frame's side, up in the air: lit all the same, vanilla's)
    const K = [F[0], F[1], F[2] + 9];
    await v(page, buildFrame, [...K, 0]);
    const side = await v(page, async (g, K) => {
      const { BLOCK_USE } = await import("./js/content/index.js");
      const inv = g.inventory;
      inv.slots[inv.selected] = { id: 370, count: 1, dur: 65 };
      const ctx = g.interaction._useCtx({ block: [K[0] - 1, K[1] + 2, K[2]], place: [K[0], K[1] + 2, K[2]], id: 1550, normal: [1, 0, 0], distance: 3 });
      const ok = BLOCK_USE[1550](ctx);
      inv.slots[inv.selected] = null;
      return { ok, at: g.world.getBlock(K[0], K[1], K[2]) };
    }, K);
    assert(side.ok && side.at === V.NETHER_PORTAL, `flint and steel on the frame's side: ${JSON.stringify(side)}`);
    // Soul fire.
    const S = [F[0] - 5, F[1], F[2] + 3];
    await v(page, (g, S) => {
      g.world.setBlocks([S[0], S[1] - 1, S[2], 2305, S[0], S[1], S[2], 0, S[0], S[1] + 1, S[2], 0]); // (soul sand)
      g.world.setBlock(S[0], S[1], S[2], 1551);
    }, S);
    await frames(page, 3);
    assert((await v(page, (g, S) => g.world.getBlock(S[0], S[1], S[2]), S)) === V.SOUL_FIRE, "no soul fire");
    if (out) {
      await v(page, (g, F) => {
        g.player.position.set(F[0] + 1, F[1] + 1, F[2] + 6);
        g.player.yaw = 0;
        g.player.pitch = 0;
      }, F);
      await frames(page, 20);
      await page.screenshot({ path: path.join(out, "nether-portal-lit.png") });
    }
  });

  let N = null; // where the Nether's portal came out
  await browserCheck("standing in it 4 s (Survival) goes to the Nether at x/8 into a portal built and registered there; back into the first one", async () => {
    await v(page, (g, F) => {
      g.setMode("survival");
      g.player.position.set(F[0] + 0.5, F[1], F[2] + 0.5);
      g.player.velocity.set(0, 0, 0);
    }, F);
    await frames(page, 4);
    const early = await v(page, (g) => ({ dim: g.dims.dim, k: g.dims.portalProgress }));
    assert(early.dim === "overworld" && early.k > 0 && early.k < 1, `the wait: ${JSON.stringify(early)}`);
    assert(await until(page, (g) => g.dims.dim === "nether" && !g.dims.pending, 180000), "never reached the Nether");
    N = await v(page, (g) => {
      const p = g.player.position;
      return { pos: [p.x, p.y, p.z], feet: g.world.getBlock(Math.floor(p.x), Math.floor(p.y), Math.floor(p.z)), reg: g.dims.portals.get("nether") || [] };
    });
    assert(N.feet === V.NETHER_PORTAL || N.feet === V.NETHER_PORTAL + 1, `not in a portal: ${JSON.stringify(N)}`);
    assert(Math.abs(N.pos[0] - (F[0] + 0.5) / 8) < 18 && Math.abs(N.pos[2] - (F[2] + 0.5) / 8) < 18, `not at x/8: ${JSON.stringify(N)} (from ${F})`);
    assert(N.reg.length >= 1, "the Nether's portal not registered");
    if (out) {
      await v(page, (g) => {
        g.player.position.y += 0.2;
        g.player.yaw = Math.PI;
      });
      await frames(page, 30);
      await page.screenshot({ path: path.join(out, "nether-arrival.png") });
    }
    // Out of it, back in: home to the first portal.
    await v(page, (g) => {
      const p = g.player.position;
      g.setMode("creative");
      g.player.flying = true;
      p.y += 4;
    });
    await frames(page, 4);
    await v(page, (g, N) => {
      g.player.flying = false;
      g.player.position.set(N.pos[0], N.pos[1], N.pos[2]);
      g.player.velocity.set(0, 0, 0);
    }, N);
    assert(await until(page, (g) => g.dims.dim === "overworld" && !g.dims.pending, 120000), "never back");
    const back = await v(page, (g) => {
      const p = g.player.position;
      return [p.x, p.y, p.z, g.world.getBlock(Math.floor(p.x), Math.floor(p.y), Math.floor(p.z))];
    });
    assert(Math.abs(back[0] - F[0] - 0.5) < 2 && Math.abs(back[2] - F[2] - 0.5) < 2 && back[3] === V.NETHER_PORTAL, `back at ${back} (the portal at ${F})`);
  });

  await browserCheck("a frame block mined: the whole portal goes, and its registration", async () => {
    await v(page, (g, F) => {
      g.player.position.set(F[0] + 0.5, F[1], F[2] + 3.5);
      g.world.setBlock(F[0] + 2, F[1] + 1, F[2], 0);
    }, F);
    await frames(page, 3);
    const r = await v(page, (g, F) => ({ a: g.world.getBlock(F[0], F[1], F[2]), b: g.world.getBlock(F[0] + 1, F[1] + 2, F[2]), reg: (g.dims.portals.get("overworld") || []).filter((p) => p[0] === F[0] && p[2] === F[2]).length }), F);
    assert(r.a === BLOCK.AIR && r.b === BLOCK.AIR && r.reg === 0, `still there: ${JSON.stringify(r)}`);
  });

  await browserCheck("in the Nether: a fortress's blaze spawner and its chest's loot in the game; nether wart grows on soul sand; water boils from a bucket", async () => {
    const f = await v(page, (g) => {
      const s = g.world.terrainOf("nether").structures;
      const near = s.nearest("fortress", 0, 0, 3000);
      const plan = s.startOf(Math.floor((near.x >> 4) / 27), Math.floor((near.z >> 4) / 27));
      return { sp: plan.spawners[0], chest: plan.chests[0] || null };
    });
    await travel(page, "nether", f.sp[0] + 0.5, f.sp[1] + 1, f.sp[2] + 0.5, "exact");
    await v(page, (g) => (g.player.flying = true));
    const sp = await v(page, (g, s) => g.world.getBlock(s[0], s[1], s[2]), f.sp);
    assert(sp === V.BLAZE_SPAWNER, `the spawner: ${sp}`);
    // The biome's fog (vanilla's colour, on the horizon).
    await frames(page, 4);
    const fog = await v(page, async (g) => {
      const { NETHER_FOG } = await import("./js/dim-nether.js");
      const p = g.player.position;
      const b = g.world.terrain.biomeAt(Math.floor(p.x), Math.floor(p.z));
      const lin = (c) => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
      const hex = NETHER_FOG[b];
      const want = [16, 8, 0].map((sh) => lin(((hex >> sh) & 255) / 255) * 1.2);
      return { b, want, got: g.dims.info.sky.horizon.slice() };
    });
    assert(fog.got.every((c, i) => Math.abs(c - fog.want[i]) < 0.004), `the fog of biome ${fog.b}: ${JSON.stringify(fog)}`);
    if (f.chest) {
      const loot = await v(page, (g, c) => g.interaction.chests.contents(c[0], c[1], c[2], "nether").filter(Boolean).map((s) => s.id), f.chest);
      const table = new Set([V.DIAMOND, V.IRON_INGOT, ITEM.GOLD_INGOT, V.GOLDEN_SWORD, ITEM.GOLD_CHESTPLATE, V.FLINT_AND_STEEL, V.NETHER_WART, V.OBSIDIAN]);
      assert(loot.every((id) => table.has(id)), `the fortress chest: ${loot}`);
    }
    // Nether wart: planted on soul sand, ripe after enough random ticks.
    const w = await v(page, (g) => {
      const p = g.player.position;
      const x = Math.floor(p.x) + 2;
      const y = Math.floor(p.y) + 3;
      const z = Math.floor(p.z);
      g.world.setBlocks([x, y - 1, z, 2305, x, y, z, 2325, x, y + 1, z, 0]);
      return [x, y, z];
    });
    const grown = await v(page, async (g, w) => {
      const { RANDOM_TICK } = await import("./js/content/index.js");
      let r = 0;
      const rand = () => ((r = (r * 1103515245 + 12345) % 2147483648) / 2147483648);
      for (let k = 0; k < 400; k++) {
        const id = g.world.getBlock(w[0], w[1], w[2]);
        RANDOM_TICK[id]?.(g.world, w[0], w[1], w[2], id, rand);
      }
      return g.world.getBlock(w[0], w[1], w[2]);
    }, w);
    assert(grown === V.NETHER_WART + 3, `the wart: ${grown}`);
    // A water bucket emptied here: no water, the bucket empty.
    await v(page, (g, w) => {
      g.setMode("survival");
      const inv = g.inventory;
      inv.slots[inv.selected] = { id: 367, count: 1 };
      g.world.setBlock(w[0] + 1, w[1] - 1, w[2], 0);
    }, w);
    const r = await v(page, async (g, w) => {
      const { ITEM_USE } = await import("./js/content/index.js");
      const ctx = g.interaction._useCtx({ block: [w[0], w[1] - 1, w[2]], place: [w[0] + 1, w[1] - 1, w[2]], id: 2305, normal: [1, 0, 0], distance: 3 });
      const ok = ITEM_USE[367](ctx);
      return { ok, water: g.world.getBlock(w[0] + 1, w[1] - 1, w[2]), held: g.inventory.slots[g.inventory.selected]?.id };
    }, w);
    assert(r.ok && r.water === BLOCK.AIR && r.held === V.BUCKET, `the bucket: ${JSON.stringify(r)}`);
    await v(page, (g) => g.setMode("creative"));
  });

  await browserCheck("brewing: blaze powder fuels the stand, nether wart makes awkward potions, blaze powder then strength; no fuel, no brew", async () => {
    const r = await v(page, async (g) => {
      const { makeStack } = await import("./js/inventory.js");
      const { BREW_TICKS, BREWING_FUEL } = await import("./js/brewing.js");
      const { potionId } = await import("./js/content/items-vanilla.js");
      const br = g.brewing;
      const p = g.player.position;
      const x = Math.floor(p.x) + 1;
      const y = Math.floor(p.y) + 1;
      const z = Math.floor(p.z) + 1;
      g.world.setBlock(x, y, z, 1805);
      const b = br.contents(x, y, z);
      for (let i = 0; i < 3; i++) b.slots[i] = makeStack(392, 1);
      b.slots[3] = makeStack(2325, 2);
      const run = (ticks) => br.update(ticks / 20 + 0.001);
      run(BREW_TICKS + 5);
      const noFuel = b.slots.map((s) => s?.id ?? 0);
      b.slots[4] = makeStack(771, 1);
      run(1);
      const fuel = [b.fuel, b.slots[4]?.count ?? 0];
      for (let k = 0; k < 4; k++) run(BREW_TICKS / 4 + 1);
      const awkward = b.slots.slice(0, 3).map((s) => s?.id);
      b.slots[3] = makeStack(771, 1);
      for (let k = 0; k < 4; k++) run(BREW_TICKS / 4 + 1);
      const strength = b.slots.slice(0, 3).map((s) => s?.id);
      return { noFuel, fuel, awkward, strength, left: b.fuel, want: potionId("strength"), max: BREWING_FUEL };
    });
    assert(r.noFuel[0] === 392 && r.noFuel[3] === 2325, `brewed without fuel: ${JSON.stringify(r)}`);
    // (the powder in at once, one of its 20 brews taken as the first starts)
    assert(r.fuel[0] === r.max - 1 && r.fuel[1] === 0, `the fuel: ${JSON.stringify(r)}`);
    assert(r.awkward.every((id) => id === V.AWKWARD_POTION), `awkward: ${JSON.stringify(r)}`);
    assert(r.strength.every((id) => id === r.want) && r.left === r.max - 2, `strength: ${JSON.stringify(r)}`);
  });

  await browserCheck("soul sand slows, a magma block burns unless sneaking (Survival)", async () => {
    const r = await v(page, async (g) => {
      g.setMode("survival");
      const p = g.player;
      p.flying = false;
      const x = Math.floor(p.position.x);
      const y = Math.floor(p.position.y) + 6;
      const z = Math.floor(p.position.z);
      const list = [];
      for (let dx = -3; dx <= 30; dx++) for (let dz = -2; dz <= 2; dz++) {
        list.push(x + dx, y - 1, z + dz, dx < 14 ? 2304 : 2305);
        for (let h = 0; h < 3; h++) list.push(x + dx, y + h, z + dz, 0);
      }
      g.world.setBlocks(list);
      const walk = async (sx) => {
        p.position.set(sx + 0.5, y + 0.05, z + 0.5);
        p.velocity.set(0, 0, 0);
        p.yaw = -Math.PI / 2;
        p.pitch = 0;
        p.keys.add("KeyW");
        for (let k = 0; k < 8; k++) await new Promise((r) => requestAnimationFrame(r));
        const x0 = p.position.x;
        const t0 = performance.now();
        for (let k = 0; k < 20; k++) await new Promise((r) => requestAnimationFrame(r));
        const d = (p.position.x - x0) / ((performance.now() - t0) / 1000);
        p.keys.delete("KeyW");
        return d;
      };
      const rack = await walk(x - 2);
      const sand = await walk(x + 15);
      // Magma.
      g.world.setBlock(x + 20, y - 1, z, 2311);
      p.position.set(x + 20.5, y + 0.05, z + 0.5);
      p.velocity.set(0, 0, 0);
      p.health = 20;
      for (let k = 0; k < 20; k++) await new Promise((r) => requestAnimationFrame(r));
      const burnt = 20 - p.health;
      p.health = 20;
      p.sneaking = true;
      p.keys.add("ShiftLeft");
      for (let k = 0; k < 20; k++) await new Promise((r) => requestAnimationFrame(r));
      p.keys.delete("ShiftLeft");
      p.sneaking = false;
      const sneaking = 20 - p.health;
      g.setMode("creative");
      return { rack, sand, burnt, sneaking };
    });
    assert(r.sand < r.rack * 0.7, `soul sand: ${r.sand.toFixed(2)} b/s, netherrack ${r.rack.toFixed(2)}`);
    assert(r.burnt > 0 && r.sneaking === 0, `magma: ${JSON.stringify(r)}`);
  });

  await browserCheck("a respawn anchor: charged with glowstone, used in the Nether it sets the spawn; dead, back by it, a charge used; in the Overworld it explodes", async () => {
    const A = await v(page, async (g) => {
      const { BLOCK_USE } = await import("./js/content/index.js");
      const p = g.player.position;
      const x = Math.floor(p.x) + 2;
      const y = Math.floor(p.y);
      const z = Math.floor(p.z) + 2;
      const list = [];
      for (let dx = -2; dx <= 2; dx++) for (let dz = -2; dz <= 2; dz++) {
        list.push(x + dx, y - 1, z + dz, 2304);
        for (let h = 0; h < 3; h++) list.push(x + dx, y + h, z + dz, 0);
      }
      list.push(x, y, z, 2352);
      g.world.setBlocks(list);
      const inv = g.inventory;
      inv.slots[inv.selected] = { id: 2307, count: 3 };
      g.setMode("survival");
      const use = () => {
        const ctx = g.interaction._useCtx({ block: [x, y, z], place: [x, y + 1, z], id: g.world.getBlock(x, y, z), normal: [0, 1, 0], distance: 2 });
        return BLOCK_USE[ctx.id](ctx);
      };
      use();
      use();
      const charged = g.world.getBlock(x, y, z);
      inv.slots[inv.selected] = null;
      use();
      return { at: [x, y, z], charged, spawn: g.sleep.spawn, dim: g.sleep.spawnDim };
    });
    assert(A.charged === V.RESPAWN_ANCHOR + 2 && A.dim === "nether" && A.spawn.join() === A.at.join(), `the anchor: ${JSON.stringify(A)}`);
    const saved = await v(page, (g) => g.sleep.serialize());
    assert(saved.length === 4 && saved[3] === "nether", `saved: ${JSON.stringify(saved)}`);
    // Dead in the Overworld: back in the Nether by the anchor.
    await travel(page, "overworld", A.at[0] * 8, 90, A.at[2] * 8);
    await v(page, (g) => g.player.damage(1000, "void"));
    assert(await until(page, (g) => g.gameState === "dead", 20000), "not dead");
    await v(page, (g) => g.respawn());
    assert(await until(page, (g) => g.gameState === "playing" || g.gameState === "paused", 60000), "not respawned");
    const r = await v(page, (g, a) => {
      const p = g.player.position;
      return { dim: g.dims.dim, d: Math.hypot(p.x - a[0] - 0.5, p.z - a[2] - 0.5), id: g.world.getBlock(a[0], a[1], a[2]) };
    }, A.at);
    assert(r.dim === "nether" && r.d < 2.5 && r.id === V.RESPAWN_ANCHOR + 1, `the respawn: ${JSON.stringify(r)}`);
    await play(page);
    // In the Overworld: a charged anchor used blows up.
    await travel(page, "overworld", A.at[0] * 8, 90, A.at[2] * 8);
    const boom = await v(page, async (g) => {
      const { BLOCK_USE } = await import("./js/content/index.js");
      g.setMode("creative");
      const p = g.player.position;
      const x = Math.floor(p.x) + 3;
      const y = Math.floor(p.y);
      const z = Math.floor(p.z);
      g.world.setBlock(x, y, z, 2353);
      g.inventory.slots[g.inventory.selected] = null;
      const ctx = g.interaction._useCtx({ block: [x, y, z], place: [x, y + 1, z], id: 2353, normal: [0, 1, 0], distance: 2 });
      BLOCK_USE[2353](ctx);
      return g.world.getBlock(x, y, z);
    });
    assert(boom !== V.RESPAWN_ANCHOR + 1, `the anchor in the Overworld: ${boom}`);
  });

  await browserCheck("the smithing table: a diamond sword, a netherite upgrade and an ingot: a netherite sword, its enchantment and wear kept", async () => {
    const r = await v(page, async (g) => {
      const { BLOCK_USE } = await import("./js/content/index.js");
      g.setMode("survival");
      const inv = g.inventory;
      inv.clear();
      inv.slots[0] = { id: 273, count: 1, dur: 1500, tag: { ench: { sharpness: 3 } } };
      inv.selected = 0;
      inv.slots[5] = { id: 787, count: 1 };
      inv.slots[6] = { id: 776, count: 2 };
      const p = g.player.position;
      const x = Math.floor(p.x) + 2;
      const y = Math.floor(p.y);
      const z = Math.floor(p.z);
      g.world.setBlock(x, y, z, 2368);
      const ctx = g.interaction._useCtx({ block: [x, y, z], place: [x, y + 1, z], id: 2368, normal: [0, 1, 0], distance: 2 });
      BLOCK_USE[2368](ctx);
      const s = inv.slots[0];
      g.setMode("creative");
      return { id: s?.id, dur: s?.dur, sharp: s?.tag?.ench?.sharpness, template: inv.countItem(787), ingots: inv.countItem(776) };
    });
    assert(r.id === V.NETHERITE_SWORD && r.sharp === 3 && r.dur === 2031 - 62 && r.template === 0 && r.ingots === 1, `the upgrade: ${JSON.stringify(r)}`);
  });

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
    await browserCheck("online: the host lights a portal, the guest sees it and goes through; the portal the guest's trip built in the Nether is known to the host", async () => {
      await host.goto(`http://127.0.0.1:${PORT}/index.html?seed=9203&type=survival&${NET_Q}`, { waitUntil: "load", timeout: 60000 });
      await host.waitForFunction(() => !!window.__ufo && window.__ufo.graphicsReady, null, { timeout: 180000 });
      const code = await v(host, (g) => g.mp.host("Alice", "creative"));
      assert(code, "no room code");
      await play(host);
      await v(host, noDraw);
      await guest.goto(`http://127.0.0.1:${PORT}/index.html?join=${code}&${NET_Q}`, { waitUntil: "load", timeout: 60000 });
      await guest.waitForSelector("#mp-join-boot:not(.hidden)", { timeout: 30000 });
      await guest.fill("#mp-boot-nick", "Bob");
      await guest.click("#mp-boot-join");
      await guest.waitForFunction(() => !!window.__ufo && window.__ufo.graphicsReady, null, { timeout: 180000 });
      assert(await until(guest, (g) => g.mp.stateLoaded, 60000), "the host's state never arrived");
      await v(guest, noDraw);
      await play(guest);
      const H = await v(host, (g) => {
        const p = g.player.position;
        const x = Math.floor(p.x) + 3;
        const z = Math.floor(p.z) + 3;
        return [x, Math.max(g.world.surfaceY(x, z), g.world.surfaceY(x + 1, z)) + 1, z];
      });
      await v(host, buildFrame, [...H, 0]);
      await v(host, (g, H) => g.world.setBlock(H[0], H[1], H[2], 1551), H);
      assert(await until(host, (g, H) => g.world.getBlock(H[0], H[1], H[2]) === 2357, 10000, H), "the host's portal");
      assert(await until(guest, (g, H) => g.world.getBlock(H[0] + 1, H[1] + 2, H[2]) === 2357 && (g.dims.portals.get("overworld") || []).length > 0, 30000, H), "the guest doesn't see the portal or its registration");
      // The guest goes through (Creative: at once).
      await v(guest, (g, H) => {
        g.player.position.set(H[0] + 0.5, H[1], H[2] + 0.5);
        g.player.velocity.set(0, 0, 0);
      }, H);
      assert(await until(guest, (g) => g.dims.dim === "nether" && !g.dims.pending, 120000), "the guest never reached the Nether");
      const n = await v(guest, (g) => (g.dims.portals.get("nether") || []).map((p) => p.join()));
      assert(n.length, "no Nether portal registered on the guest");
      assert(await until(host, (g, n) => (g.dims.portals.get("nether") || []).some((p) => n.includes(p.join())) && g.world.editsOf("nether").size > 0 && g.net.players.get(2)?.dim === 1, 30000, n), "the host doesn't know the guest's Nether portal");
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
