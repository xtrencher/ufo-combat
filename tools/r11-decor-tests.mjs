// Round 11 decoration tests (js/content/decor.js, js/signs.js, js/decor-sim.js,
// the sheep's dye in js/mobs.js). Without a browser (Node): every dye has a
// source (a flower, bone meal, lapis, cocoa, beetroot, cactus, an ink sac, or
// mixing ones that do); the dyeing recipes (wool, carpets, terracotta, glass
// and panes, concrete powder, beds); the texture budget. In headless Chromium
// (software WebGL, a Survival world, on a stone floor built near spawn): a
// sheep dyed with a dye keeps the colour (its skin, the save) and gives that
// wool, a shorn one can't be dyed; a sign placed opens its editor, the text
// typed (15 characters a line) is drawn on it and survives a reload; signs
// online (the host keeps a guest's cleaned text and passes it on, refuses
// one from afar; a guest takes the host's word); the cake loses bites and
// feeds (none when full) and is gone after seven; a coloured bed is two
// cells and a bed to sleep in; concrete powder sets against water (and sinks
// into it); flower pots; stained panes join; icons and item models for
// everything; the shapes mesh the same in a worker.
//
//   node r11-decor-tests.mjs [--only=substring] [--seed=42] [--nobrowser] [--overlay=dir]
//
// --overlay=dir serves the files under dir instead of the repository's (to
// try the main.js wiring and other files' patches before they are merged).
// Like the other suites, it fails on any console error or page error.
import http from "node:http";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
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
const SEED = Number(args.seed ?? 4242);
const OVERLAY = args.overlay ? path.resolve(String(args.overlay)) : null;
const results = [];
const errors = [];
let browser = null;
let server = null;

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
function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}
const mod = (p) => import(pathToFileURL(path.join(ROOT, p)).href);

// ---------- Node ----------
const D = await mod("js/content/decor.js");
const I = await mod("js/content/ids.js");

await check("every dye has a source: a plant or thing of the world, or mixing dyes that have one", async () => {
  const { recipes } = await mod("js/content/index.js");
  const { itemInfo } = await mod("js/items.js");
  const list = recipes().filter((r) => r.module === "decor");
  const ingOf = (r) => (r.type === "smelting" ? [[].concat(r.input)] : r.type === "shapeless" ? r.ingredients.map((x) => [].concat(x)) : []);
  const isDye = (id) => D.dyeColorOf(id) >= 0;
  const have = new Set();
  const why = {};
  // Dyes from things that are not dyes, then mixing until nothing more comes.
  for (const r of list) {
    const c = D.dyeColorOf(r.result?.[0]);
    if (c < 0) continue;
    const ings = ingOf(r);
    if (ings.length && ings.every((alts) => alts.some((id) => !isDye(id) && itemInfo(id)))) {
      have.add(c);
      why[D.COLORS[c]] ||= ings.map((a) => itemInfo(a[0])?.name).join(" + ");
    }
  }
  for (let pass = 0; pass < 4; pass++) {
    for (const r of list) {
      const c = D.dyeColorOf(r.result?.[0]);
      if (c < 0 || have.has(c)) continue;
      const ings = ingOf(r);
      if (ings.length && ings.every((alts) => alts.some((id) => (isDye(id) ? have.has(D.dyeColorOf(id)) : !!itemInfo(id))))) {
        have.add(c);
        why[D.COLORS[c]] ||= `mixing ${ings.map((a) => itemInfo(a[0])?.name).join(" + ")}`;
      }
    }
  }
  const missing = D.COLORS.filter((_, i) => !have.has(i));
  assert(!missing.length, `no source for: ${missing.join(", ")}`);
  // (vanilla's own: bone meal white, lapis blue, cocoa brown, cactus green, an ink sac black)
  assert(/Bone Meal|Lily/.test(why.white) && /Lapis|Cornflower/.test(why.blue) && /Cocoa/.test(why.brown) && /Cactus/.test(why.green) && /Ink Sac/.test(why.black), JSON.stringify(why));
});

await check("dyeing in the grid: wool, carpets, terracotta, glass and panes, concrete powder, beds (vanilla yields)", async () => {
  const { craftResult } = await mod("js/crafting.js");
  const B = (await mod("js/blocks.js")).BLOCK;
  const r = (grid, w) => {
    const x = craftResult(grid, w);
    return x ? [x.id, x.count] : null;
  };
  const eight = (id, dye) => [id, id, id, id, dye, id, id, id, id];
  const BLUE = 11;
  const dye = D.DYES[BLUE];
  const out = {
    wool: r([B.WOOL, dye, 0, 0], 2),
    woolRedToBlue: r([I.RED_WOOL, dye, 0, 0], 2),
    carpets: r(eight(I.WHITE_CARPET + 5, dye), 3),
    terracotta: r(eight(B.TERRACOTTA, dye), 3),
    glass: r(eight(B.GLASS, dye), 3),
    panes: r(eight(I.GLASS_PANE, dye), 3),
    panesFromGlass: r([D.STAINED_GLASS + BLUE, D.STAINED_GLASS + BLUE, D.STAINED_GLASS + BLUE, D.STAINED_GLASS + BLUE, D.STAINED_GLASS + BLUE, D.STAINED_GLASS + BLUE, 0, 0, 0], 3),
    powder: r([dye, B.SAND, B.SAND, I.RED_SAND, B.SAND, B.GRAVEL, B.GRAVEL, B.GRAVEL, B.GRAVEL], 3),
    bed: r([I.RED_BED, dye, 0, 0], 2),
    mix: r([D.DYES[14], D.DYES[0], 0, 0], 2), // red + white: pink
    magenta4: r([D.DYES[BLUE], D.DYES[14], D.DYES[14], D.DYES[0]], 2),
    pot: r([I.BRICK, 0, I.BRICK, 0, I.BRICK, 0, 0, 0, 0], 3),
    sign: r([I.SPRUCE_PLANKS, I.SPRUCE_PLANKS, I.SPRUCE_PLANKS, I.SPRUCE_PLANKS, I.SPRUCE_PLANKS, I.SPRUCE_PLANKS, 0, 256, 0], 3),
  };
  const want = {
    wool: [I.BLUE_WOOL, 1],
    woolRedToBlue: [I.BLUE_WOOL, 1],
    carpets: [I.WHITE_CARPET + BLUE, 8],
    terracotta: [I.WHITE_TERRACOTTA + BLUE, 8],
    glass: [D.STAINED_GLASS + BLUE, 8],
    panes: [D.STAINED_GLASS_PANE + BLUE, 8],
    panesFromGlass: [D.STAINED_GLASS_PANE + BLUE, 16],
    powder: [D.CONCRETE_POWDER + BLUE, 8],
    bed: [D.bedOf(BLUE), 1],
    mix: [D.DYES[6], 2],
    magenta4: [D.DYES[2], 4],
    pot: [D.FLOWER_POT, 1],
    sign: [D.SPRUCE_SIGN, 3],
  };
  const bad = Object.keys(want).filter((k) => JSON.stringify(out[k]) !== JSON.stringify(want[k]));
  assert(!bad.length, bad.map((k) => `${k}: ${JSON.stringify(out[k])} (want ${JSON.stringify(want[k])})`).join("; "));
});

await check("textures: the decor tiles within the part's share (30) and every tile layer within 256", async () => {
  const B = await mod("js/blocks.js");
  const n = Object.keys(D.tiles).length;
  assert(n <= 30 && B.TILE_NAMES.length <= 256, `decor ${n}, all ${B.TILE_NAMES.length}`);
});

if (args.nobrowser) await finish();

// ---------- The browser ----------
const PORT = 9880 + Math.floor(Math.random() * 40);
const MIME = { ".html": "text/html", ".js": "text/javascript" };
server = http.createServer((req, res) => {
  const url = decodeURIComponent(req.url.split("?")[0]);
  let filePath = path.join(ROOT, url);
  if (OVERLAY && fs.existsSync(path.join(OVERLAY, url)) && fs.statSync(path.join(OVERLAY, url)).isFile()) filePath = path.join(OVERLAY, url);
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
browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome",
  args: ["--use-gl=swiftshader", "--enable-webgl", "--ignore-gpu-blocklist", "--no-sandbox", "--disable-dev-shm-usage"],
});
const page = await browser.newPage({ viewport: { width: 960, height: 540 } });
const localThreeRoot = path.join(__dirname, "node_modules", "three");
await page.route("https://cdn.jsdelivr.net/npm/three@0.160.0/**", (route) => {
  const rel = new URL(route.request().url()).pathname.replace("/npm/three@0.160.0/", "");
  route.fulfill({ path: path.join(localThreeRoot, rel), contentType: "text/javascript" });
});
page.on("console", (m) => {
  if (m.type() === "error") errors.push(m.text());
});
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
// v(fn, arg): runs fn(game, arg) in the page (game = window.__ufo).
const v = (fn, arg) => page.evaluate(([src, a]) => new Function("g", "arg", `return (${src})(g, arg);`)(window.__ufo, a), [fn.toString(), arg]);

async function boot() {
  await page.goto(`http://127.0.0.1:${PORT}/index.html?seed=${SEED}&type=survival&graphics=low`, { waitUntil: "load", timeout: 60000 });
  await page.waitForFunction(() => !!window.__ufo, null, { timeout: 90000 });
  await page.waitForFunction(() => window.__ufo.graphicsReady, null, { timeout: 120000 });
  // In-page helpers: aiming the player's eye at a point, a right click with a stack.
  await page.evaluate(async () => {
    const { makeStack } = await import("./js/inventory.js");
    const { maxStack } = await import("./js/items.js");
    window.__tb = {
      aim(g, eye, at) {
        const pl = g.player;
        pl.flying = true;
        pl.velocity.set(0, 0, 0);
        const eyeOff = pl.getEyePosition().y - pl.position.y;
        pl.position.set(eye[0], eye[1] - eyeOff, eye[2]);
        const dx = at[0] - eye[0];
        const dy = at[1] - eye[1];
        const dz = at[2] - eye[2];
        pl.yaw = Math.atan2(-dx, -dz);
        pl.pitch = Math.asin(dy / Math.hypot(dx, dy, dz));
        g.interaction.updateTarget(true);
        return g.interaction.target;
      },
      use(g, stackId, eye, at, count = 16) {
        const inv = g.inventory;
        inv.selected = 0;
        inv.slots[0] = stackId ? makeStack(stackId, Math.min(count, maxStack(stackId))) : null;
        const t = window.__tb.aim(g, eye, at);
        g.interaction.mouseDown(2);
        g.interaction.mouseUp(2);
        return t ? { id: t.id, block: t.block, normal: t.normal } : null;
      },
      dropsOf(g, id) {
        return g.entities.items.filter((it) => it.id === id).reduce((n, it) => n + it.count, 0);
      },
    };
  });
}
async function play() {
  // (A slow machine: the menu may take a while to take the click.)
  if ((await v((g) => g.gameState)) === "start") await page.click("#play-btn", { timeout: 120000 }).catch(() => {});
  const t0 = Date.now();
  while (Date.now() - t0 < 180000) {
    const st = await v((g) => g.gameState);
    if (st === "playing") return;
    if (st === "dead") {
      await v((g) => g.respawn());
      continue;
    }
    if (st === "start") await page.click("#play-btn", { timeout: 30000 }).catch(() => {});
    else if (await page.isVisible("#resume-btn")) await page.click("#resume-btn", { timeout: 3000 }).catch(() => {});
    else if (await page.isVisible("#click-to-play").catch(() => false)) await page.click("#click-to-play", { timeout: 3000 }).catch(() => {});
    else {
      await page.mouse.click(300, 200);
      await frames(5);
    }
    await frames(3);
  }
  if (args.shots) await page.screenshot({ path: path.join(String(args.shots), "not-playing.png") }).catch(() => {});
  throw new Error(`the game didn't start playing (state ${await v((g) => g.gameState)}; ${errors.slice(0, 3).join(" | ")})`);
}
// (No pictures needed for most checks: a world drawn in software is slow.)
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
// A test site: a 24 x 20 stone floor high near spawn with air above, loaded
// and meshed: (x, y - 1, z) is the floor. Calm: no monsters, noon.
const SITE = async (g) => {
  if (g.testFlags) g.testFlags.noMissions = true;
  g.setMode("survival");
  g.mobs.hostileSpawning = false;
  g.mobs.removeHostiles?.();
  g.sky.locked = true;
  g.sky.setHours(12);
  const w = g.world;
  const x = Math.floor(g.spawn.x) + 8;
  const z = Math.floor(g.spawn.z) + 8;
  w.prepareArea(x + 10, z + 8, 2);
  const y = 90;
  const list = [];
  for (let ax = -2; ax <= 22; ax++) {
    for (let az = -4; az <= 18; az++) {
      list.push(x + ax, y - 1, z + az, 3);
      for (let ay = 0; ay <= 6; ay++) list.push(x + ax, y + ay, z + az, 0);
    }
  }
  w.setBlocks(list);
  w.processQueues(50);
  g.entities.items.length = 0;
  return { x, y, z };
};

await boot();
await play();
await v(noDraw);
let site = await v(SITE);
const ids = {
  OAK_SIGN: D.OAK_SIGN,
  CAKE: I.CAKE,
  CAKE_BLOCK: D.CAKE_BLOCK,
  BLUE_BED: D.bedOf(11),
  FLOWER_POT: D.FLOWER_POT,
  POTTED_POPPY: D.POTTED,
  POWDER: D.CONCRETE_POWDER,
  WHITE_CONCRETE: I.WHITE_CONCRETE,
  PANE: D.STAINED_GLASS_PANE,
  DYES: D.DYES,
  BLUE_WOOL: I.BLUE_WOOL,
  SHEARS: I.SHEARS,
};

await check("a bed of wool of one colour is that colour's bed (the red one the building part's)", async () => {
  const r = await v(async () => {
    const { craftResult } = await import("./js/crafting.js");
    const I = await import("./js/content/ids.js");
    const row = (w) => [w, w, w, 8, 8, 8, 0, 0, 0];
    return [craftResult(row(I.BLUE_WOOL), 3)?.id, craftResult(row(24), 3)?.id, craftResult(row(I.RED_WOOL), 3)?.id];
  });
  assert(JSON.stringify(r) === JSON.stringify([D.bedOf(11), D.bedOf(0), I.RED_BED]), `blue, white, red wool: ${JSON.stringify(r)}`);
});

await check("a sheep dyed with a dye: its colour (skin, save), its wool that colour; a shorn one can't be", async () => {
  const r = await v(
    async (g, { s, ids }) => {
      const { createMobModel } = await import("./js/mob-models.js");
      const { makeStack } = await import("./js/inventory.js");
      const m = g.mobs.spawn("sheep", s.x + 10.5, s.y, s.z + 10.5, { variant: 0 });
      const inv = g.inventory;
      inv.selected = 0;
      inv.slots[0] = makeStack(ids.DYES[11], 3);
      const used = g.mobs.useMob(m, inv.slots[0], inv);
      const left = inv.slots[0]?.count;
      const skin = createMobModel("sheep", 11).meshes[0].material;
      const again = g.mobs.useMob(m, inv.slots[0], inv); // (already blue: nothing)
      const kept = (g.mobs.serializeKept() || []).find((e) => e[0] === "sheep" && Math.abs(e[1] - m.pos.x) < 1);
      g.entities.items.length = 0;
      g.mobs.shear(m);
      const wool = window.__tb.dropsOf(g, ids.BLUE_WOOL);
      const shorn = g.mobs.useMob(m, makeStack(ids.DYES[14], 1), inv);
      const out = { used, left, again, variant: m.variant, skin: m.model.meshes[0].material === skin, kept: kept?.[4], wool, shorn, persist: !!m.persist };
      m.dead = true;
      return out;
    },
    { s: site, ids }
  );
  assert(r.used && r.left === 2 && r.variant === 11 && r.skin, `dyed blue: ${JSON.stringify(r)}`);
  assert(!r.again && r.persist && r.kept === 11, `kept blue with the world: ${JSON.stringify(r)}`);
  assert(r.wool >= 1 && !r.shorn, `blue wool when shorn, no dye on a shorn sheep: ${JSON.stringify(r)}`);
});

await check("a sign placed opens its editor; the text typed (15 a line) is kept and drawn on it", async () => {
  const placed = await v(
    (g, { s, ids }) => {
      const T = window.__tb;
      const { x, y, z } = s;
      T.use(g, ids.OAK_SIGN, [x + 0.5, y + 2.6, z - 2.5], [x + 0.5, y, z + 0.5]);
      return { block: g.world.getBlock(x, y, z), state: g.gameState, editing: g.signs.isEditing, shown: !document.getElementById("sign-editor")?.classList.contains("hidden") };
    },
    { s: site, ids }
  );
  assert(placed.block === D.OAK_SIGN + 8 && placed.state === "inventory" && placed.editing && placed.shown, `placed, facing the player (-Z), the editor up: ${JSON.stringify(placed)}`);
  await page.keyboard.type("Hello there!");
  await page.keyboard.press("Enter");
  await page.keyboard.type("UFO");
  await page.keyboard.press("Enter");
  await page.keyboard.type("abcdefghijklmnopqrstuvwxyz");
  await page.keyboard.press("Escape");
  await frames(2);
  const r = await v(
    (g, { s }) => {
      const { x, y, z } = s;
      const out = { text: g.signs.text(x, y, z), editing: g.signs.isEditing, state: g.gameState, slot: g.inventory.slots[0]?.count ?? 0 };
      g.signs.update(1, g.player.getEyePosition());
      out.drawn = g.signs.drawnCount;
      const rec = g.signs.get(x, y, z);
      out.facing = rec?.mesh ? [rec.mesh.position.z - z, rec.mesh.rotation.y] : null;
      return out;
    },
    { s: site }
  );
  assert(JSON.stringify(r.text) === JSON.stringify(["Hello there!", "UFO", "abcdefghijklmno", ""]) && !r.editing && r.state !== "inventory", `the text: ${JSON.stringify(r)}`);
  assert(r.drawn >= 1 && r.facing && r.facing[0] < 0.5 && Math.abs(Math.abs(r.facing[1]) - Math.PI) < 1e-6, `drawn on the board's front (-Z): ${JSON.stringify(r)}`);
  await play();
  // A right click edits it again; a dye colours it (one used).
  const again = await v(
    (g, { s, ids }) => {
      const T = window.__tb;
      const { x, y, z } = s;
      T.use(g, ids.DYES[14], [x + 0.5, y + 1.2, z - 1.5], [x + 0.5, y + 0.75, z + 0.5], 2);
      const out = { color: g.signs.get(x, y, z)?.color, dyes: g.inventory.slots[0]?.count ?? 0, editing: g.signs.isEditing };
      T.use(g, null, [x + 0.5, y + 1.2, z - 1.5], [x + 0.5, y + 0.75, z + 0.5]);
      out.reopened = g.signs.isEditing;
      return out;
    },
    { s: site, ids }
  );
  await page.keyboard.press("Escape");
  await frames(2);
  assert(again.color === 14 && again.dyes === 1 && !again.editing && again.reopened, `dyed red, then edited again: ${JSON.stringify(again)}`);
  const kept = await v((g, { s }) => g.signs.text(s.x, s.y, s.z), { s: site });
  assert(kept[0] === "Hello there!", `unchanged when closed untouched: ${JSON.stringify(kept)}`);
  await play();
});

await check("a sign's text and colour survive a save and a reload", async () => {
  await v((g) => g.flushSave());
  await boot();
  await play();
  await v(noDraw);
  const r = await v(
    (g, { s }) => {
      g.world.prepareArea(s.x, s.z, 1);
      return { block: g.world.getBlock(s.x, s.y, s.z), text: g.signs.text(s.x, s.y, s.z), color: g.signs.get(s.x, s.y, s.z)?.color };
    },
    { s: site }
  );
  assert(r.block === D.OAK_SIGN + 8 && r.text[0] === "Hello there!" && r.text[1] === "UFO" && r.color === 14, JSON.stringify(r));
  // Broken: its text goes too.
  const gone = await v(
    (g, { s }) => {
      g.world.setBlock(s.x, s.y, s.z, 0);
      return { rec: !!g.signs.get(s.x, s.y, s.z), save: g.signs.serialize() };
    },
    { s: site }
  );
  assert(!gone.rec && !gone.save, JSON.stringify(gone));
  site = await v(SITE);
});

await check("signs online: the host keeps a guest's cleaned text and passes it on, refuses one from afar; a guest takes the host's word", async () => {
  const r = await v(
    async (g, { s }) => {
      const { Signs, SignSync } = await import("./js/signs.js");
      const { LIB } = await import("./js/content/base.js");
      const keep = [LIB.openSignEditor, LIB.dyeSign];
      const listeners = g.world.changeListeners.length;
      const fakeNet = (isHost) => ({ isHost, h: {}, sent: [], sync: null, on(t, fn) { this.h[t] = fn; }, registerSync(n, sy) { this.sync = sy; }, broadcast(m, o) { this.sent.push(["all", m, o?.except ?? 0]); }, toHost(m) { this.sent.push(["host", m]); } });
      const { x, y, z } = s;
      g.world.setBlock(x + 1, y, z + 1, 2223 + 4); // (an oak sign, turned)
      const hn = fakeNet(true);
      const host = new Signs({ scene: null, world: g.world });
      const hs = new SignSync({ net: hn, active: true, game: {}, players: { get: (pid) => (pid === 2 ? { livePos: { x: x + 3, y, z: z + 2 } } : pid === 3 ? { livePos: { x: x + 90, y, z } } : null) } }, host);
      hs.start();
      hn.h.sgset({ t: "sgset", p: [x + 1, y, z + 1], l: ["a\u0007b\nc", "x".repeat(30), 5, null, "extra"], c: 99 }, 2);
      hn.h.sgset({ t: "sgset", p: [x + 1, y, z + 2], l: ["far"], c: 1 }, 3);
      const out = { text: host.text(x + 1, y, z + 1), color: host.get(x + 1, y, z + 1)?.color, far: !!host.get(x + 1, y, z + 2), relayed: hn.sent.map((e) => [e[0], e[2], e[1].l]), join: Object.keys(hn.sync.save()) };
      // A guest: the host's word; its own edit goes to the host.
      const gn = fakeNet(false);
      const guest = new Signs({ scene: null, world: g.world });
      const gs = new SignSync({ net: gn, active: true, game: { GUEST: true }, players: { get: () => null } }, guest);
      gs.start();
      gn.sync.load(hn.sync.save());
      out.joined = guest.text(x + 1, y, z + 1);
      gn.h.sgset({ t: "sgset", p: [x + 1, y, z + 1], l: ["new"], c: 2 }, 1);
      out.guestText = guest.text(x + 1, y, z + 1)[0];
      guest.set(x + 1, y, z + 1, ["mine"], 0, true);
      out.guestSent = gn.sent.map((e) => [e[0], e[1].t, e[1].l[0]]);
      out.guestSave = guest.serialize();
      g.world.changeListeners.splice(listeners);
      [LIB.openSignEditor, LIB.dyeSign] = keep;
      g.world.setBlock(x + 1, y, z + 1, 0);
      return out;
    },
    { s: site }
  );
  assert(JSON.stringify(r.text) === JSON.stringify(["abc", "xxxxxxxxxxxxxxx", "5", ""]) && r.color === 15, `cleaned: ${JSON.stringify(r)}`);
  assert(!r.far && r.relayed.length === 1 && r.relayed[0][0] === "all" && r.relayed[0][1] === 2 && r.join.length === 1, `passed on to the others, the far one refused: ${JSON.stringify(r)}`);
  assert(r.joined[0] === "abc" && r.guestText === "new" && JSON.stringify(r.guestSent) === JSON.stringify([["host", "sgset", "mine"]]) && r.guestSave === undefined, `the guest: ${JSON.stringify(r)}`);
});

await check("the cake: placed from the cake item, a bite feeds 2 (0.4 saturation), none when full, gone after seven", async () => {
  const r = await v(
    (g, { s, ids }) => {
      const T = window.__tb;
      const p = g.player;
      const { y, z } = s;
      const x = s.x + 3;
      T.use(g, ids.CAKE, [x + 0.5, y + 2.6, z - 2.5], [x + 0.5, y, z + 0.5]);
      const out = { placed: g.world.getBlock(x, y, z), item: g.inventory.slots[0]?.count ?? 0 };
      p.food = 10;
      p.saturation = 0;
      // (aimed at the end that is eaten last: bites come off the -X side)
      const eye = [x + 0.85, y + 1.6, z - 1.5];
      const at = [x + 0.85, y + 0.3, z + 0.5];
      T.use(g, null, eye, at);
      out.one = [g.world.getBlock(x, y, z) - ids.CAKE_BLOCK, p.food, Math.round(p.saturation * 100) / 100];
      p.food = 20;
      T.use(g, null, eye, at);
      out.full = g.world.getBlock(x, y, z) - ids.CAKE_BLOCK;
      for (let i = 0; i < 6; i++) {
        p.food = 2;
        T.use(g, null, eye, at);
      }
      out.end = g.world.getBlock(x, y, z);
      return out;
    },
    { s: site, ids }
  );
  assert(r.placed === D.CAKE_BLOCK && r.item === 0, `placed: ${JSON.stringify(r)}`);
  assert(JSON.stringify(r.one) === JSON.stringify([1, 12, 0.4]) && r.full === 1 && r.end === 0, `bites: ${JSON.stringify(r)}`);
});

await check("a coloured bed: two cells facing the player's way, a bed to sleep in at night (the survival part's)", async () => {
  const r = await v(
    (g, { s, ids }) => {
      const T = window.__tb;
      const { y, z } = s;
      const x = s.x + 6;
      g.sleep.spawn = null;
      T.use(g, ids.BLUE_BED, [x + 0.5, y + 2.2, z - 1.5], [x + 0.5, y, z + 0.5]);
      const out = { foot: g.world.getBlock(x, y, z), head: g.world.getBlock(x, y, z + 1) };
      g.sky.setHours(23);
      T.use(g, null, [x + 0.5, y + 1.6, z - 1], [x + 0.5, y + 0.5, z + 0.5]);
      out.sleeping = !!g.player.sleeping;
      out.spawn = g.sleep.spawn;
      g.sleep.wake();
      g.sky.setHours(12);
      // Breaking the head takes the foot (one bed).
      g.world.setBlock(x, y, z + 1, 0);
      out.after = g.world.getBlock(x, y, z);
      return out;
    },
    { s: site, ids }
  );
  const { x, y, z } = site;
  assert(r.foot === D.bedOf(11) && r.head === D.bedOf(11) + 4, `placed: ${JSON.stringify(r)}`);
  assert(r.sleeping && JSON.stringify(r.spawn) === JSON.stringify([x + 6, y, z + 1]) && r.after === 0, `slept: ${JSON.stringify(r)}`);
});

await check("concrete powder: sets against water (beside it), sinks into water under it, falls like sand", async () => {
  const r = await v(
    async (g, { s, ids }) => {
      const w = g.world;
      const { y } = s;
      const x = s.x + 8;
      const z = s.z + 6;
      // Beside water: concrete.
      w.setBlocks([x, y, z, 5]);
      w.setBlock(x + 1, y, z, ids.POWDER + 4);
      const out = { beside: w.getBlock(x + 1, y, z) - ids.WHITE_CONCRETE };
      // Water poured next to powder.
      w.setBlock(x + 3, y, z, ids.POWDER + 1);
      w.setBlock(x + 3, y, z + 1, 5);
      out.poured = w.getBlock(x + 3, y, z) - ids.WHITE_CONCRETE;
      // Over water: it sinks into the water's cell and sets there.
      w.setBlocks([x + 5, y - 1, z, 5]);
      w.setBlock(x + 5, y, z, ids.POWDER + 2);
      out.sank = [w.getBlock(x + 5, y, z), w.getBlock(x + 5, y - 1, z) - ids.WHITE_CONCRETE];
      // Away from water: it stays powder, and falls.
      w.setBlocks([x, y, z, 0, x + 3, y, z + 1, 0]);
      w.setBlock(x + 4, y + 3, z + 8, ids.POWDER);
      for (let i = 0; i < 80 && w.getBlock(x + 4, y, z + 8) !== ids.POWDER; i++) {
        g.falling.update(0.05);
        await new Promise((res) => setTimeout(res, 0));
      }
      out.fell = [w.getBlock(x + 4, y + 3, z + 8), w.getBlock(x + 4, y, z + 8) - ids.POWDER];
      out.hardened = g.decorSim?.hardened;
      return out;
    },
    { s: site, ids }
  );
  assert(r.beside === 4 && r.poured === 1, `set beside water: ${JSON.stringify(r)}`);
  assert(r.sank[0] === 0 && r.sank[1] === 2 && r.fell[0] === 0 && r.fell[1] === 0, `sank, fell: ${JSON.stringify(r)}`);
});

await check("flower pots: a poppy in and out; a potted one breaks into the pot and the plant", async () => {
  const r = await v(
    (g, { s, ids }) => {
      const T = window.__tb;
      const { y } = s;
      const x = s.x + 2;
      const z = s.z + 12;
      const B = { POPPY: 21 }; // (the core's red flower: the poppy)
      T.use(g, ids.FLOWER_POT, [x + 0.5, y + 2.2, z - 1.5], [x + 0.5, y, z + 0.5]);
      const out = { pot: g.world.getBlock(x, y, z) };
      const eye = [x + 0.5, y + 1.4, z - 1.2];
      const at = [x + 0.5, y + 0.2, z + 0.5];
      T.use(g, B.POPPY, eye, at, 5);
      out.potted = g.world.getBlock(x, y, z);
      out.poppies = g.inventory.slots[0]?.count;
      T.use(g, null, eye, at);
      out.out = [g.world.getBlock(x, y, z), g.inventory.countItem(B.POPPY)];
      return out;
    },
    { s: site, ids }
  );
  assert(r.pot === D.FLOWER_POT && r.potted === D.POTTED && r.poppies === 4, `potted: ${JSON.stringify(r)}`);
  assert(r.out[0] === D.FLOWER_POT && r.out[1] === 1, `taken out: ${JSON.stringify(r)}`);
  const { blockDrops } = await mod("js/items.js");
  const drops = blockDrops(D.POTTED, null);
  assert(JSON.stringify(drops) === JSON.stringify([[D.FLOWER_POT, 1], [21, 1]]), `drops: ${JSON.stringify(drops)}`);
});

await check("stained glass panes join panes, walls and full blocks (as drawn, so as collided with)", async () => {
  const r = await v(
    async (g, { s, ids }) => {
      const { BLOCK_INFO } = await import("./js/blocks.js");
      const w = g.world;
      const { y, z } = s;
      const x = s.x + 16;
      // Stone, two stained panes, a glass pane: a run along x; one alone.
      w.setBlocks([x, y, z, 3, x + 1, y, z, ids.PANE + 3, x + 2, y, z, ids.PANE + 5, x + 3, y, z, 1310, x + 5, y, z + 3, ids.PANE]);
      const c = (bx, bz) => BLOCK_INFO[w.getBlock(bx, y, bz)].collide(w, bx, y, bz).map((b) => b.map((n) => Math.round(n * 16)));
      return { run: c(x + 1, z), next: c(x + 2, z), lone: c(x + 5, z + 3) };
    },
    { s: site, ids }
  );
  const along = JSON.stringify([[0, 0, 7, 16, 16, 9]]);
  assert(JSON.stringify(r.run) === along && JSON.stringify(r.next) === along && JSON.stringify(r.lone) === JSON.stringify([[7, 0, 7, 9, 16, 9]]), JSON.stringify(r));
});

await check("every decor shape meshes byte for byte the same in a worker and on the main thread", async () => {
  const list = [D.STAINED_GLASS + 1, D.STAINED_GLASS_PANE + 2, D.STAINED_GLASS_PANE + 2, D.CONCRETE_POWDER + 7, D.CAKE_BLOCK, D.CAKE_BLOCK + 3, D.bedOf(0), D.bedOf(0) + 4, D.bedOf(5) + 2, D.bedOf(5) + 6, D.OAK_SIGN + 3, D.SPRUCE_SIGN + 17, D.FLOWER_POT, D.POTTED + 4, D.POTTED + 19];
  const r = await v(
    async (g, { s, list }) => {
      const { meshChunk } = await import("./js/mesher.js");
      const w = g.world;
      if (!w._genWorkers || !w._genWorkers.length || !w.meshInWorkers) return { skipped: true };
      const bx = (s.x & ~15) + 15 - 6;
      const edits = [];
      list.forEach((id, i) => edits.push(bx + (i % 12), s.y + 2 + Math.floor(i / 12), s.z + 16, id));
      w.setBlocks(edits);
      w.processQueues(50);
      const chunks = [w.getChunk(bx >> 4, (s.z + 16) >> 4), w.getChunk((bx + 12) >> 4, (s.z + 16) >> 4)].filter(Boolean);
      const got = new Map();
      const orig = w._applyMeshResult.bind(w);
      w._applyMeshResult = (m) => {
        got.set(m.token, m.buffers);
        return orig(m);
      };
      const want = new Map();
      for (const c of chunks) {
        let slot = w._meshSlot();
        while (!slot) {
          await new Promise((res) => setTimeout(res, 20));
          w.processQueues(50);
          slot = w._meshSlot();
        }
        // (the reference right before the worker's copy is taken: nothing changes between)
        const nb = [];
        for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) nb.push(w.getChunk(c.cx + dx, c.cz + dz) || null);
        const ref = meshChunk(nb, w.meshOptions);
        w._dispatchMesh(c, slot);
        want.set(c._meshToken, ref);
      }
      for (let i = 0; i < 500 && ![...want.keys()].every((k) => got.has(k)); i++) {
        await new Promise((res) => setTimeout(res, 20));
        w.processQueues(50);
      }
      w._applyMeshResult = orig;
      const eq = (a, b) => (!a && !b) || (a && b && a.length === b.length && a.every((x, i) => x === b[i]));
      let compared = 0;
      let differing = 0;
      for (const [tok, ref] of want) {
        const m = got.get(tok);
        if (!m) continue;
        compared++;
        for (const k of ["opaque", "cutout", "water"]) {
          if (!ref[k] !== !m[k] || (ref[k] && !["position", "uv", "data", "extra", "index"].every((f) => eq(ref[k][f], m[k][f])))) {
            differing++;
            break;
          }
        }
      }
      return { asked: want.size, compared, differing };
    },
    { s: site, list }
  );
  if (r.skipped) console.log("        (no mesh workers in this browser: skipped)");
  assert(r.skipped || (r.asked >= 1 && r.compared === r.asked && r.differing === 0), JSON.stringify(r));
});

await check("icons and 3D item models build for every decor block and item; every decor recipe's ingredients and results exist", async () => {
  const r = await v(async (g) => {
    const B = await import("./js/blocks.js");
    const items = await import("./js/items.js");
    const T = await import("./js/textures.js");
    const { itemModel } = await import("./js/models.js");
    const { itemIconPixels } = await import("./js/itemtextures.js");
    const { recipes } = await import("./js/content/index.js");
    const canv = {};
    for (const n of B.TILE_NAMES) {
      const c = document.createElement("canvas");
      c.width = 32;
      c.height = 32;
      c.getContext("2d").putImageData(new ImageData(new Uint8ClampedArray(T.paintTile(n)), 32, 32), 0, 0);
      canv[n] = c;
    }
    const ids = items.CREATIVE_ITEMS.filter((id) => (id >= 2048 && id < 2304) || (id >= 704 && id < 768));
    const blank = [];
    const noModel = [];
    for (const id of ids) {
      let px;
      if (id >= 1024) {
        const c = T.drawBlockIcon(canv, B.BLOCK_INFO[id], 32);
        px = c.getContext("2d").getImageData(0, 0, 32, 32).data;
      } else px = itemIconPixels(id);
      let n = 0;
      for (let i = 3; i < px.length; i += 4) if (px[i] > 0) n++;
      if (n < 20) blank.push(id);
      const m = itemModel(id);
      if (!m || !m.geometry || m.geometry.getAttribute("position").count < 4) noModel.push(id);
    }
    const missing = [];
    let count = 0;
    for (const rc of recipes().filter((x) => x.module === "decor")) {
      count++;
      const ing = [];
      if (rc.key) for (const k of Object.values(rc.key)) ing.push(...[].concat(k));
      if (rc.ingredients) for (const k of rc.ingredients) ing.push(...[].concat(k));
      if (rc.input !== undefined) ing.push(...[].concat(rc.input));
      if (rc.result) ing.push(rc.result[0]);
      for (const id of ing) if (!items.itemInfo(id)) missing.push(`${rc.type}:${id}`);
    }
    return { n: ids.length, blank, noModel, count, missing: [...new Set(missing)] };
  });
  assert(r.n >= 16 + 17 + 16 + 16 + 15 + 3 + 1 && !r.blank.length && !r.noModel.length, JSON.stringify(r));
  assert(r.count > 100 && !r.missing.length, `recipes: ${JSON.stringify(r)}`);
});

await finish();

async function finish() {
  const failed = results.filter(([, ok]) => !ok).length;
  console.log(`\n${results.length - failed}/${results.length} passed`);
  await browser?.close().catch(() => {});
  server?.close();
  process.exit(failed ? 1 : 0);
}
