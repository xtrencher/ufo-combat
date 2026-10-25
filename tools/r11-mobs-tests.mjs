// Round 11 vanilla mobs: boots the real game in headless Chromium (software
// WebGL, Low preset) and checks a Survival world's mobs (js/mobs.js):
//  - at night its spawners make only vanilla kinds, and creepers, endermen,
//    slimes and witches do spawn (forced tries); none in daylight in the open;
//  - a creeper near the player hisses, swells and bursts, breaking blocks and
//    hurting the player;
//  - a sheep can be shorn (its wool drops) and its wool grows back as it eats
//    grass (the grass turns to dirt);
//  - two cows fed wheat breed: a calf, which grows up; a cow gives milk;
//  - an enderman stared at gets angry, and dodges a shot by teleporting;
//  - a big slime splits; a spawn egg makes its creature;
//  - a wolf tamed with bones sits, stands, follows and defends its owner;
//  - a villager's trade swaps the items (the trade screen, js/trading.js);
//  - in a Missions world (Round 13: one world) the vanilla mob set and drops, with the Missions animals too.
//
//  - online (a host and a guest through a local PeerJS server): the guest
//    sees the host's mobs as they are, shears, feeds and trades with them (the
//    host's claims and stock), and a creeper's blast reaches the guest; a
//    hostile mob's health doesn't grow with the group (vanilla).
//
//   node r11-mobs-tests.mjs [--only=substring] [--seed=4242] [--solo]
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
const SEED = Number(args.seed ?? 4242);
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
  args: ["--use-gl=swiftshader", "--enable-webgl", "--ignore-gpu-blocklist", "--no-sandbox", "--disable-dev-shm-usage"],
});
const localThreeRoot = path.join(__dirname, "node_modules", "three");
const peerjsFile = path.join(__dirname, "node_modules", "peerjs", "dist", "peerjs.min.js");
let page = null;
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

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}
// v(fn, arg): runs fn(game, arg) in the page (game = window.__ufo); vp: in page p.
const vp = (p, fn, arg) => p.evaluate(([src, a]) => new Function("g", "arg", `return (${src})(g, arg);`)(window.__ufo, a), [fn.toString(), arg]);
const v = (fn, arg) => vp(page, fn, arg);
async function until(p, fn, timeout = 30000, arg) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeout) {
    const r = await vp(p, fn, arg).catch(() => null);
    if (r) return r;
    await new Promise((res) => setTimeout(res, 200));
  }
  return null;
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

async function check(name, fn) {
  if (args.only && !name.toLowerCase().includes(String(args.only).toLowerCase())) return;
  const t0 = Date.now();
  const errBefore = errors.length;
  try {
    // (The Survival world's checks share one page, booted by whichever runs first.)
    if (!page && !/^(Missions|online)/.test(name)) {
      await boot(`seed=${SEED}&type=survival`);
      await v(HELPERS);
    }
    await fn();
    if (errors.length > errBefore) throw new Error(`console errors: ${errors.slice(errBefore, errBefore + 3).join(" | ")}`);
    results.push([name, true]);
    console.log(`  PASS  ${name} (${((Date.now() - t0) / 1000).toFixed(1)}s)`);
  } catch (err) {
    results.push([name, false]);
    console.log(`  FAIL  ${name}: ${err.message}`);
  }
}

async function boot(query) {
  page = await newPage(query);
  await page.goto(`http://127.0.0.1:${PORT}/index.html?${query}&graphics=low`, { waitUntil: "load", timeout: 60000 });
  await page.waitForFunction(() => !!window.__ufo, null, { timeout: 90000 });
  await page.waitForFunction(() => window.__ufo.graphicsReady, null, { timeout: 120000 });
  await page.click("#play-btn", { timeout: 120000 });
  await page.waitForFunction(() => window.__ufo.gameState === "playing" || window.__ufo.gameState === "paused", null, { timeout: 60000 });
  // (Ground under the player, and the test's own control of the mobs: no
  // spawning of their own, a fixed time of day.)
  await page.waitForFunction(() => window.__ufo.world.getChunk(Math.floor(window.__ufo.player.position.x) >> 4, Math.floor(window.__ufo.player.position.z) >> 4)?.meshed, null, { timeout: 60000 });
  await v((g) => {
    g.mobs.enabled = false;
    g.mobs.clear();
    g.sky.locked = true;
    g.player.setMode?.("survival");
  });
}

// Shared page-side helpers (installed once per page): a flat 9x9 pad of
// grass at the player's feet with air above, and running the mobs alone.
const HELPERS = (g) => {
  const B = g.world;
  const p = g.player.position;
  const H = (window.__mt = {});
  H.pad = (R = 6) => {
    const x0 = Math.floor(p.x);
    const z0 = Math.floor(p.z);
    const y = Math.floor(p.y) - 1;
    const edits = [];
    for (let dx = -R; dx <= R; dx++)
      for (let dz = -R; dz <= R; dz++) {
        edits.push(x0 + dx, y, z0 + dz, 1); // grass
        edits.push(x0 + dx, y - 1, z0 + dz, 2); // dirt
        for (let k = 1; k <= 4; k++) edits.push(x0 + dx, y + k, z0 + dz, 0);
      }
    B.setBlocks(edits);
    g.player.position.set(x0 + 0.5, y + 1, z0 + 0.5);
    g.player.velocity.set(0, 0, 0);
    return { x: x0, y: y + 1, z: z0 };
  };
  // n steps of dt seconds of the mobs only (not the whole game).
  H.run = (n, dt = 0.05) => {
    for (let i = 0; i < n; i++) g.mobs.update(dt);
  };
  return true;
};

// ================= A Survival world =================

await check("Survival world: the spawners make vanilla mobs only; creepers, endermen, slimes and witches spawn at night, not by day", async () => {
  assert(await v((g) => g.worldType === "survival"), "a Survival world");
  const r = await v((g) => {
    const M = g.mobs;
    g.sky.setHours(0);
    g.sky.update(0.01, g.player.position, new g.THREE.Vector3(0, 0, -1));
    const seen = {};
    M.enabled = true;
    // A long night's spawning (no waiting: the spawner itself, many times).
    for (let i = 0; i < 400; i++) {
      M._updateSpawningVanilla(0.45);
      if (i % 3 === 0) M._trySpawnPassive(6, 26);
      for (const m of M.mobs) seen[m.kind] = (seen[m.kind] || 0) + 1;
      if (M.mobs.length > 40) M.clear();
    }
    M.clear();
    // Forced tries for the rarer ones.
    const forced = {};
    for (const kind of ["creeper", "enderman", "witch"]) {
      forced[kind] = false;
      for (let k = 0; k < 600 && !forced[kind]; k++) forced[kind] = M._trySpawnHostile(kind);
    }
    const chunk = M._slimeChunk;
    M._slimeChunk = () => true;
    forced.slime = false;
    for (let k = 0; k < 800 && !forced.slime; k++) forced.slime = M._trySpawnSlime();
    M._slimeChunk = chunk;
    const kinds = M.mobs.map((m) => m.kind);
    M.clear();
    // Daylight in the open: no monster.
    g.sky.setHours(12);
    g.sky.update(0.01, g.player.position, new g.THREE.Vector3(0, 0, -1));
    const P = g.player.position;
    const top = g.world.surfaceY(Math.floor(P.x), Math.floor(P.z));
    let dayOk = 0;
    for (let k = 0; k < 50; k++) if (M._darkEnough(Math.floor(P.x), top + 1, Math.floor(P.z))) dayOk++;
    M.enabled = false;
    return { seen, forced, kinds, dayOk };
  });
  const allowed = new Set(["zombie", "skeleton", "spider", "creeper", "enderman", "witch", "slime", "slime_medium", "slime_small", "cow", "pig", "chicken", "sheep", "wolf", "villager", "iron_golem", "cod", "salmon", "parrot"]);
  const bad = Object.keys(r.seen).filter((k) => !allowed.has(k));
  assert(!bad.length, `only vanilla kinds: ${bad} in ${JSON.stringify(r.seen)}`);
  assert(Object.keys(r.seen).some((k) => ["zombie", "skeleton", "spider", "creeper"].includes(k)), `monsters at night: ${JSON.stringify(r.seen)}`);
  assert(r.forced.creeper && r.forced.enderman && r.forced.witch && r.forced.slime, `forced spawns: ${JSON.stringify(r.forced)} ${r.kinds}`);
  assert(r.dayOk === 0, `no monsters in the open by day (${r.dayOk} of 50 tries were dark enough)`);
});

await check("a creeper near the player hisses, swells and bursts: blocks broken, the player hurt", async () => {
  const r = await v((g) => {
    const H = window.__mt;
    const at = H.pad();
    g.sky.setHours(0);
    g.player.health = 20;
    // (Vanilla's blast, power 3, takes about 24 from an unarmored player 2
    // blocks off on Normal: iron armor, so the player lives for the next checks.)
    const inv = g.inventory;
    const worn = inv.armor.slice();
    for (const id of [308, 309, 310, 311]) inv.armor[inv.constructor.armorSlotOf(id)] = { id, count: 1 };
    const M = g.mobs;
    const c = M.spawn("creeper", at.x + 2.5, at.y, at.z + 0.5);
    const solidBefore = (() => {
      let n = 0;
      for (let dx = -4; dx <= 4; dx++) for (let dz = -4; dz <= 4; dz++) for (let dy = -3; dy <= 0; dy++) if (g.world.getBlock(at.x + dx, at.y + dy, at.z + dz)) n++;
      return n;
    })();
    const count0 = g.effects.explosionCount;
    let fused = 0;
    for (let i = 0; i < 80 && M.mobs.includes(c); i++) {
      H.run(1, 0.05);
      fused = Math.max(fused, c.fuse);
    }
    let solidAfter = 0;
    for (let dx = -4; dx <= 4; dx++) for (let dz = -4; dz <= 4; dz++) for (let dy = -3; dy <= 0; dy++) if (g.world.getBlock(at.x + dx, at.y + dy, at.z + dz)) solidAfter++;
    const health = g.player.health;
    worn.forEach((s, i) => (inv.armor[i] = s));
    g.player.health = 20;
    return { gone: !M.mobs.includes(c), exploded: !!c.exploded, fused, blasts: g.effects.explosionCount - count0, source: g.effects.lastExplosion?.source, solidBefore, solidAfter, health };
  });
  assert(r.fused > 1 && r.gone && r.exploded && r.blasts === 1 && r.source === "creeper", `the creeper burst: ${JSON.stringify(r)}`);
  assert(r.solidAfter < r.solidBefore - 4, `blocks broken: ${JSON.stringify(r)}`);
  assert(r.health < 20 && r.health > 0, `the player hurt (in iron armor, not killed at 2 blocks): ${JSON.stringify(r)}`);
});

await check("a sheep can be shorn (wool drops) and its wool grows back eating grass", async () => {
  const r = await v(async (g) => {
    const V = await import("./js/content/ids.js");
    const H = window.__mt;
    const at = H.pad();
    const M = g.mobs;
    M.inventory = g.inventory;
    const s = M.spawn("sheep", at.x + 1.5, at.y, at.z + 0.5, { variant: 14 });
    H.run(10);
    const inv = g.inventory;
    inv.slots[inv.selected] = { id: V.SHEARS, count: 1, dur: 238 };
    const items0 = g.entities.items.length;
    const used = M.useMob(s, inv.selectedStack, inv);
    const wool = g.entities.items.slice(items0).map((it) => it.id);
    const again = M.useMob(s, inv.selectedStack, inv);
    // Grazing: the sheep stands on grass and eats now and then.
    let ticks = 0;
    const x = Math.floor(s.pos.x);
    const z = Math.floor(s.pos.z);
    const y = Math.floor(s.pos.y + 0.05);
    for (; ticks < 3000 && s.sheared; ticks++) {
      s.onGround = true;
      s.walk = 0;
      s.pos.set(x + 0.5, y, z + 0.5);
      g.world.setBlock(x, y - 1, z, 1);
      g.world.setBlock(x, y, z, 0);
      M._animalTick(s, 1);
    }
    return { used, again, wool, woolId: V.RED_WOOL, sheared: s.sheared, ticks, below: g.world.getBlock(x, y - 1, z), dur: inv.selectedStack?.dur };
  });
  assert(r.used && !r.again, `shorn once: ${JSON.stringify(r)}`);
  assert(r.wool.length >= 1 && r.wool.length <= 3, `1-3 wool dropped: ${JSON.stringify(r)}`);
  assert(r.wool.every((id) => id === r.woolId || id === 24), `wool of its colour (red, or white if the colours aren't in yet): ${JSON.stringify(r)}`);
  assert(r.dur === 237, `the shears wear: ${r.dur}`);
  assert(!r.sheared && r.below === 2, `the wool grew back as it ate the grass (now dirt): ${JSON.stringify(r)}`);
});

await check("two cows fed wheat breed: a calf, which grows up; a cow gives milk", async () => {
  const r = await v(async (g) => {
    const V = await import("./js/content/ids.js");
    const { isValidItem } = await import("./js/items.js");
    const H = window.__mt;
    const at = H.pad();
    const M = g.mobs;
    M.inventory = g.inventory;
    const inv = g.inventory;
    const a = M.spawn("cow", at.x + 2.5, at.y, at.z + 0.5);
    const b = M.spawn("cow", at.x + 3.5, at.y, at.z + 0.5);
    inv.slots[inv.selected] = { id: V.WHEAT, count: 3 };
    const fedA = M.useMob(a, inv.selectedStack, inv);
    const fedB = M.useMob(b, inv.selectedStack, inv);
    const fedAgain = M.useMob(a, inv.selectedStack, inv);
    const left = inv.selectedStack?.count;
    let calf = null;
    for (let i = 0; i < 400 && !calf; i++) {
      H.run(1, 0.05);
      calf = M.mobs.find((m) => m.kind === "cow" && m.baby);
    }
    const res = { fedA, fedB, fedAgain, left, calf: !!calf, small: calf ? calf.spec.h < 1 : false, cd: a.breedCd > 0 && b.breedCd > 0, kept: a.persist && !!calf?.persist };
    if (calf) {
      calf.growT = 0.02;
      H.run(2);
      res.grown = !calf.baby && calf.spec.h > 1;
    }
    // Milk.
    if (isValidItem(V.MILK_BUCKET) && isValidItem(V.BUCKET)) {
      inv.slots[inv.selected] = { id: V.BUCKET, count: 1 };
      res.milked = M.useMob(a, inv.selectedStack, inv);
      res.milk = inv.countItem(V.MILK_BUCKET);
      res.bucketLeft = inv.countItem(V.BUCKET);
    } else res.milked = "no bucket items yet";
    return res;
  });
  assert(r.fedA && r.fedB && !r.fedAgain && r.left === 1, `fed (one wheat each, not twice): ${JSON.stringify(r)}`);
  assert(r.calf && r.small && r.cd && r.kept, `a calf: ${JSON.stringify(r)}`);
  assert(r.grown, `the calf grew up: ${JSON.stringify(r)}`);
  if (r.milked === "no bucket items yet") console.log("        (the items part's buckets aren't in yet: milking not checked)");
  else assert(r.milked === true && r.milk === 1 && r.bucketLeft === 0, `milk: ${JSON.stringify(r)}`);
});

await check("an enderman stared at gets angry; it dodges a shot by teleporting", async () => {
  const r = await v((g) => {
    const H = window.__mt;
    const at = H.pad();
    const M = g.mobs;
    g.player.yaw = Math.PI; // (looking away first)
    g.player.pitch = 0;
    const e = M.spawn("enderman", at.x + 0.5, at.y, at.z - 5.5);
    H.run(2);
    const calm = !(e.angerT > 0);
    // Look it in the eyes.
    const eye = g.player.getEyePosition();
    const dx = e.pos.x - eye.x;
    const dy = e.pos.y + e.spec.eye - eye.y;
    const dz = e.pos.z - eye.z;
    g.player.yaw = Math.atan2(-dx, -dz);
    g.player.pitch = Math.atan2(dy, Math.hypot(dx, dz));
    H.run(8);
    const angry = e.angerT > 0 && e.foe === g.player;
    const before = e.pos.clone();
    const hp = e.health;
    const hit = M.shoot(e, 5, new g.THREE.Vector3(0, 0, -1));
    return { calm, angry, hit, moved: e.pos.distanceTo(before), hp, after: e.health };
  });
  assert(r.calm && r.angry, `calm, then angry when stared at: ${JSON.stringify(r)}`);
  assert(!r.hit && r.moved > 1 && r.after === r.hp, `the shot dodged: ${JSON.stringify(r)}`);
});

await check("a big slime splits into smaller ones; a spawn egg makes its creature", async () => {
  const r = await v(async (g) => {
    const { ITEM_USE } = await import("./js/content/index.js");
    const H = window.__mt;
    const at = H.pad();
    const M = g.mobs;
    M.clear();
    const s = M.spawn("slime", at.x + 3.5, at.y, at.z + 0.5);
    M._hurt(s, 100, null, 0, true);
    H.run(30);
    const medium = M.mobs.filter((m) => m.kind === "slime_medium").length;
    M.clear();
    const egg = ITEM_USE[643];
    const used = egg?.({ place: [at.x + 2, at.y, at.z], creative: true, inventory: g.inventory });
    const creepers = M.mobs.filter((m) => m.kind === "creeper").length;
    M.clear();
    return { medium, used, creepers };
  });
  assert(r.medium >= 2 && r.medium <= 4, `2-4 medium slimes: ${JSON.stringify(r)}`);
  assert(r.used && r.creepers === 1, `the creeper spawn egg: ${JSON.stringify(r)}`);
});

await check("a villager's trade swaps the items (the trade screen)", async () => {
  const r = await v(async (g) => {
    const V = await import("./js/content/ids.js");
    const { TradeScreen, makeOffers } = await import("./js/trading.js");
    const { isValidItem } = await import("./js/items.js");
    if (!isValidItem(V.EMERALD) || !isValidItem(V.WHEAT)) return { skip: true };
    const H = window.__mt;
    const at = H.pad();
    const M = g.mobs;
    M.inventory = g.inventory;
    const inv = g.inventory;
    inv.clear();
    inv.add(V.WHEAT, 25);
    const vg = M.spawn("villager", at.x + 1.5, at.y, at.z + 0.5, { variant: 1 }); // a farmer
    vg.trades = makeOffers(0, () => 0); // (first of each level: 20 wheat for an emerald first)
    const ts = (window.__mt.ts ||= new TradeScreen({ icons: g.hud.icons, inventory: inv, audio: g.audio, mobs: M, player: g.player }));
    M.onTrade = (session) => {
      ts.open(session);
      return true;
    };
    const opened = M.useMob(vg, inv.selectedStack, inv);
    const rows = ts.rows.length;
    const first = vg.trades[0];
    ts._trade(0, false);
    const res = { opened, rows, first: [first.a, first.out], wheat: inv.countItem(V.WHEAT), emeralds: inv.countItem(V.EMERALD), uses: first.uses, standing: vg.tradingT > M.time };
    ts._trade(0, false); // (5 wheat left: can't pay)
    res.wheat2 = inv.countItem(V.WHEAT);
    ts.close();
    res.free = !(vg.tradingT > M.time);
    return res;
  });
  if (r.skip) {
    console.log("        (emeralds or wheat aren't in yet: trading not checked)");
    return;
  }
  assert(r.opened && r.rows >= 2, `the screen opened with offers: ${JSON.stringify(r)}`);
  assert(r.wheat === 5 && r.emeralds === 1 && r.uses === 1 && r.standing, `20 wheat for an emerald: ${JSON.stringify(r)}`);
  assert(r.wheat2 === 5 && r.free, `no second trade without the price; the villager walks on after: ${JSON.stringify(r)}`);
});

await check("a wolf tamed with bones sits and stands at a click, follows its owner and fights what hurts them", async () => {
  const r = await v(async (g) => {
    const V = await import("./js/content/ids.js");
    const H = window.__mt;
    const at = H.pad(11);
    const M = g.mobs;
    M.clear();
    M.inventory = g.inventory;
    const inv = g.inventory;
    const w = M.spawn("wolf", at.x - 8.5, at.y, at.z + 0.5);
    let bones = 0;
    for (; bones < 60 && !w.tamed; bones++) {
      inv.slots[inv.selected] = { id: V.BONE, count: 1 };
      M.useMob(w, inv.selectedStack, inv);
    }
    const res = { bones, tamed: w.tamed, owner: w.owner, sitting: w.sitting, hp: w.maxHealth, collar: w.model.parts.collar ? true : false };
    inv.slots[inv.selected] = null;
    M.useMob(w, null, inv);
    res.stood = !w.sitting;
    // The owner walks off: it follows (teleporting from far off).
    g.player.position.x += 9;
    H.run(60);
    res.near = Math.hypot(w.pos.x - g.player.position.x, w.pos.z - g.player.position.z);
    // A zombie hits the owner: the wolf goes for it.
    g.player.health = 20;
    const z = M.spawn("zombie", g.player.position.x + 1.2, g.player.position.y, g.player.position.z);
    z.attackCooldown = 0;
    M.player = g.player;
    M._attackPlayer(z, 1, 0);
    res.rallied = w.revenge === z;
    const hp0 = z.health;
    H.run(60);
    res.bitten = z.health < hp0 || z.dead;
    M.clear();
    return res;
  });
  assert(r.tamed && r.owner === 1 && r.sitting && r.hp === 20 && r.collar, `tamed (one bone in three: ${r.bones}), sitting, healthier, a collar: ${JSON.stringify(r)}`);
  assert(r.stood, "a click stands it up");
  assert(r.near < 6, `it followed its owner: ${JSON.stringify(r)}`);
  assert(r.rallied && r.bitten, `it fought the zombie that hit its owner: ${JSON.stringify(r)}`);
});

await check("Survival drops: a zombie drops rotten flesh, not coal; cooked meat from a cow that died burning", async () => {
  const r = await v(async (g) => {
    const V = await import("./js/content/ids.js");
    const { ITEM } = await import("./js/items.js");
    const H = window.__mt;
    const at = H.pad();
    const M = g.mobs;
    M.clear();
    const z = M.spawn("zombie", at.x + 3.5, at.y, at.z + 0.5);
    const zd = z.spec.drops.map((d) => d[0]);
    const c = M.spawn("cow", at.x - 2.5, at.y, at.z + 0.5);
    c.fireT = 5;
    const n0 = g.entities.items.length;
    M._hurt(c, 100, null, 0, true);
    H.run(30);
    const items = g.entities.items.slice(n0).map((it) => it.id);
    const { isValidItem } = await import("./js/items.js");
    return { zd, coal: ITEM.COAL, flesh: V.ROTTEN_FLESH, items, beef: V.BEEF, cooked: V.COOKED_BEEF, hasCooked: isValidItem(V.COOKED_BEEF) };
  });
  assert(r.zd.includes(r.flesh) && !r.zd.includes(r.coal), `zombie drops: ${JSON.stringify(r)}`);
  if (!r.hasCooked) console.log("        (cooked beef isn't in yet: the cooked drop not checked)");
  else assert(!r.items.includes(r.beef) && r.items.includes(r.cooked), `cooked, not raw: ${JSON.stringify(r)}`);
});

// ================= A Missions world =================

// (Round 13: one world: a Missions world has the vanilla creatures and drops, its own animals beside them.)
await check("Missions world: the vanilla mob set and drops, with the Missions animals too", async () => {
  if (page) await page.context().close();
  await boot(`seed=${SEED}`);
  await v(HELPERS);
  const r = await v(async (g) => {
    const { ITEM } = await import("./js/items.js");
    const M = g.mobs;
    const seen = {};
    M.enabled = true;
    for (const h of [0, 12]) {
      g.sky.setHours(h);
      g.sky.update(0.01, g.player.position, new g.THREE.Vector3(0, 0, -1));
      for (let i = 0; i < 300; i++) {
        M._updateSpawning(0.45);
        if (i % 3 === 0) M._trySpawnPassive(6, 26);
        for (const m of M.mobs) seen[m.kind] = (seen[m.kind] || 0) + 1;
        if (M.mobs.length > 40) M.clear();
      }
    }
    M.enabled = false;
    M.clear();
    const z = M.spawn("zombie", g.player.position.x + 3, g.player.position.y, g.player.position.z);
    const drops = z ? z.spec.drops.map((d) => d[0]) : null;
    const health = z?.maxHealth;
    M.clear();
    const P = g.player.position;
    const tops = [];
    for (let k = 0; k < 8; k++) {
      const x = Math.floor(P.x + Math.cos(k) * 12);
      const z = Math.floor(P.z + Math.sin(k) * 12);
      tops.push(g.world.getBlock(x, g.world.surfaceY(x, z), z));
    }
    const V = await import("./js/content/ids.js");
    return { type: g.worldType, seen, drops, flesh: V.ROTTEN_FLESH, health, tops };
  });
  const vanillaOnly = ["creeper", "enderman", "witch", "slime", "slime_medium", "slime_small", "sheep", "wolf", "iron_golem", "cod", "salmon"];
  assert(r.type === "missions", "a Missions world");
  const vanilla = Object.keys(r.seen).filter((k) => vanillaOnly.includes(k));
  assert(vanilla.length >= 3, `the vanilla kinds: ${vanilla} in ${JSON.stringify(r.seen)}`);
  assert(Object.keys(r.seen).some((k) => ["fluffalo", "hoplet", "mossback"].includes(k)), `the Missions animals too: ${JSON.stringify(r.seen)}`);
  assert(r.drops && r.drops[0] === r.flesh && r.health === 20, `vanilla's zombie (rotten flesh, 20 health): ${JSON.stringify(r)}`);
});

// ================= Online: a host and a guest =================

async function online() {
  const { default: express } = await import("express");
  const { ExpressPeerServer } = await import("peer");
  const PEER_PORT = PORT + 60;
  const app = express();
  const peerHttp = app.listen(PEER_PORT, "127.0.0.1");
  app.use("/ufo", ExpressPeerServer(peerHttp, { path: "/" }));
  const NET_Q = `peerServer=127.0.0.1:${PEER_PORT}/ufo&noStun=1&graphics=low`;
  if (page) await page.context().close();
  page = null;
  const host = await newPage("host", { width: 560, height: 320 });
  const guest = await newPage("guest", { width: 560, height: 320 });
  // (No pictures: two worlds drawn in software are slow.)
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
  let ok = false;
  await check("online: a guest sees the host's vanilla mobs as they are (colour, trade, baby, a creeper's fuse)", async () => {
    await host.goto(`http://127.0.0.1:${PORT}/index.html?seed=${SEED + 7}&type=survival&${NET_Q}`, { waitUntil: "load", timeout: 60000 });
    await host.waitForFunction(() => !!window.__ufo && window.__ufo.graphicsReady, null, { timeout: 120000 });
    await host.click("#menu-mp-btn");
    await host.fill("#mp-nick", "Alice");
    await host.click("#mp-host-btn");
    const code = await until(host, (g) => g.net.code, 30000);
    assert(code, "no room code");
    await host.click("#mp-lobby-play");
    await host.waitForFunction(() => window.__ufo.gameState === "playing", null, { timeout: 30000 });
    await vp(host, noDraw);
    await guest.goto(`http://127.0.0.1:${PORT}/index.html?join=${code}&${NET_Q}`, { waitUntil: "load", timeout: 60000 });
    await guest.waitForSelector("#mp-join-boot:not(.hidden)", { timeout: 30000 });
    await guest.fill("#mp-boot-nick", "Bob");
    await guest.click("#mp-boot-join");
    await guest.waitForFunction(() => !!window.__ufo && window.__ufo.graphicsReady, null, { timeout: 120000 });
    assert(await until(guest, (g) => g.mp.stateLoaded, 60000), "the host's state never arrived");
    await vp(guest, noDraw);
    for (let k = 0; k < 40 && (await vp(guest, (g) => g.gameState)) !== "playing"; k++) {
      const st = await vp(guest, (g) => g.gameState);
      if (st === "start") await guest.click("#play-btn", { timeout: 5000 }).catch(() => {});
      else if (await guest.isVisible("#resume-btn").catch(() => false)) await guest.click("#resume-btn", { timeout: 3000 }).catch(() => {});
      else if (await guest.isVisible("#click-to-play").catch(() => false)) await guest.click("#click-to-play", { timeout: 3000 }).catch(() => {});
      else await guest.mouse.click(200, 150);
      await new Promise((r) => setTimeout(r, 500));
    }
    assert(await until(host, (g) => g.mp.players.active().some((r) => r.seen), 30000), "the host never saw the guest");
    // The host's creatures, made next to the guest (seen by the host through its stand-in).
    await vp(host, async (g) => {
      const { makeOffers } = await import("./js/trading.js");
      g.mobs.enabled = false;
      g.mobs.clear();
      g.sky.locked = true;
      g.sky.setHours(12);
      const r = g.mp.players.active().find((x) => x.seen);
      const P = r.livePos;
      const x = Math.floor(P.x);
      const z = Math.floor(P.z);
      const top = (dx, dz) => g.world.surfaceY(x + dx, z + dz) + 1;
      const M = g.mobs;
      window.__mt2 = {
        sheep: M.spawn("sheep", x + 2.5, top(2, 0), z + 0.5, { variant: 11 }),
        lamb: M.spawn("sheep", x - 2.5, top(-2, 0), z + 0.5, { variant: 4, baby: true }),
        cowA: M.spawn("cow", x + 0.5, top(0, 3), z + 3.5),
        cowB: M.spawn("cow", x + 1.5, top(1, 3), z + 3.5),
        villager: M.spawn("villager", x - 0.5, top(-1, -3), z - 2.5, { variant: 1 }),
      };
      window.__mt2.villager.trades = makeOffers(0, () => 0); // (a farmer buying wheat first)
      // (A hostile mob's health doesn't grow with the group in a Survival world: vanilla's.)
      const zz = M.spawn("zombie", x + 0.5, top(0, 0), z + 0.5, { wet: true });
      window.__mt2.zhp = zz ? [zz.maxHealth, zz.spec.health * M.zombies.health] : null;
      if (zz) M._remove(M.mobs.indexOf(zz));
      return true;
    });
    const zhp = await vp(host, () => window.__mt2.zhp);
    assert(zhp && zhp[0] === zhp[1], `a zombie's health in a 2-player Survival room: ${JSON.stringify(zhp)}`);
    const seen = await until(guest, (g) => {
      const list = [...g.mp.entities.mobById.values()];
      const sheep = list.find((m) => m.kind === "sheep" && !m.baby);
      const lamb = list.find((m) => m.kind === "sheep" && m.baby);
      const vil = list.find((m) => m.kind === "villager");
      return sheep && lamb && vil && list.filter((m) => m.kind === "cow").length === 2 ? { sheep: sheep.variant, lamb: lamb.variant, small: lamb.spec.h < 1, vil: vil.variant } : null;
    }, 40000);
    assert(seen && seen.sheep === 11 && seen.lamb === 4 && seen.small && seen.vil === 1, `the guest's copies: ${JSON.stringify(seen)}`);
    ok = true;
  });
  if (ok) {
    await check("online: a guest shears the host's sheep, feeds its cows and trades with its villager (claims, the host's stock)", async () => {
      const r = await vp(guest, async (g) => {
        const V = await import("./js/content/ids.js");
        const { TradeScreen } = await import("./js/trading.js");
        const list = [...g.mp.entities.mobById.values()];
        const sheep = list.find((m) => m.kind === "sheep" && !m.baby);
        const cows = list.filter((m) => m.kind === "cow");
        const vil = list.find((m) => m.kind === "villager");
        const M = g.mobs;
        const inv = g.inventory;
        M.inventory = inv;
        // (Right next to them, as a player using them would be.)
        g.player.position.set(sheep.pos.x - 1, sheep.pos.y, sheep.pos.z);
        inv.slots[inv.selected] = { id: V.SHEARS, count: 1, dur: 238 };
        const shorn = M.useMob(sheep, inv.selectedStack, inv);
        inv.slots[inv.selected] = { id: V.WHEAT, count: 4 };
        const fed = cows.map((c) => M.useMob(c, inv.selectedStack, inv));
        inv.slots[inv.selected] = null;
        inv.add(V.WHEAT, 22);
        // (Its own root: the inventory screen isn't open here, which would close it.)
        const ts = new TradeScreen({ icons: g.hud.icons, inventory: inv, audio: g.audio, mobs: M, player: g.player, root: document.createElement("div") });
        window.__ts = ts;
        M.onTrade = (s) => {
          ts.open(s);
          return true;
        };
        const opened = M.useMob(vil, inv.selectedStack, inv);
        return { shorn, fed, opened, wheat: inv.countItem(V.WHEAT) };
      });
      assert(r.shorn && r.fed.every(Boolean) && r.opened, `the guest's uses: ${JSON.stringify(r)}`);
      const host1 = await until(host, (g) => {
        const t = window.__mt2;
        return t.sheep.sheared && t.cowA.loveT > 0 && t.cowB.loveT > 0 ? { wool: g.entities.items.filter((it) => it.id === 1348 || it.id === 24).length } : null;
      }, 20000);
      assert(host1, `the host's sheep shorn and cows in love: ${JSON.stringify(await vp(host, () => ({ sh: window.__mt2.sheep.sheared, a: window.__mt2.cowA.loveT, b: window.__mt2.cowB.loveT })))}`);
      // The trade: the offers come from the host, then one trade, the host's stock counted.
      const offers = await until(guest, () => window.__ts.session?.offers?.length || null, 20000);
      assert(offers >= 2, `the host's offers arrived: ${offers}`);
      await vp(guest, async () => {
        const s = window.__ts.session;
        const i = s.offers.findIndex((o) => o.a[0] === 401 && o.a[1] <= 22);
        window.__tradeI = i;
        if (i >= 0) window.__ts._trade(i, false);
        return i;
      });
      const after = await until(guest, async () => {
        const V = await import("./js/content/ids.js");
        const g = window.__ufo;
        return !window.__ts.busy && g.inventory.countItem(V.EMERALD) === 1 ? { wheat: g.inventory.countItem(V.WHEAT) } : null;
      }, 20000);
      const i = await vp(guest, () => window.__tradeI);
      assert(i >= 0, "the farmer buys wheat");
      assert(after, `the guest got an emerald for its wheat: ${JSON.stringify(await vp(guest, () => ({ busy: window.__ts.busy, s: !!window.__ts.session })))}`);
      const uses = await vp(host, (g, k) => window.__mt2.villager.trades?.[k]?.uses, i);
      assert(uses === 1, `the host's stock counted the guest's trade: ${uses}`);
      // A calf on the host, seen on the guest.
      const calf = await until(guest, (g) => [...g.mp.entities.mobById.values()].some((m) => m.kind === "cow" && m.baby), 40000);
      assert(calf, "the cows' calf reached the guest");
    });

    await check("online: a guest tames the host's wolf with bones; it's theirs (sits at their click, follows them)", async () => {
      await vp(host, (g) => {
        const r = g.mp.players.active().find((x) => x.seen);
        const P = r.livePos;
        window.__mt2.wolf = g.mobs.spawn("wolf", P.x + 1.5, g.world.surfaceY(Math.floor(P.x + 1.5), Math.floor(P.z)) + 1, P.z);
        return true;
      });
      const pid = await vp(guest, (g) => g.net.pid);
      let tamed = null;
      for (let k = 0; k < 30 && !tamed; k++) {
        await vp(guest, async (g) => {
          const V = await import("./js/content/ids.js");
          const w = [...g.mp.entities.mobById.values()].find((m) => m.kind === "wolf");
          if (!w || w.tamed) return false;
          g.inventory.slots[g.inventory.selected] = { id: V.BONE, count: 1 };
          g.player.position.set(w.pos.x - 1, w.pos.y, w.pos.z);
          return g.mobs.useMob(w, g.inventory.selectedStack, g.inventory);
        });
        tamed = await until(guest, (g) => {
          const w = [...g.mp.entities.mobById.values()].find((m) => m.kind === "wolf");
          return w?.tamed ? { owner: w.owner, sitting: w.sitting } : null;
        }, 1500);
      }
      assert(tamed && tamed.owner === pid && tamed.sitting, `tamed by the guest (pid ${pid}): ${JSON.stringify(tamed)}`);
      const host1 = await vp(host, () => ({ owner: window.__mt2.wolf.owner, tamed: window.__mt2.wolf.tamed, persist: window.__mt2.wolf.persist }));
      assert(host1.tamed && host1.owner === pid && host1.persist, `the host's wolf is the guest's: ${JSON.stringify(host1)}`);
      // A click stands it up; the host refuses the host player's own click (not theirs).
      await vp(guest, (g) => {
        const w = [...g.mp.entities.mobById.values()].find((m) => m.kind === "wolf");
        g.inventory.slots[g.inventory.selected] = null;
        return g.mobs.useMob(w, null, g.inventory);
      });
      assert(await until(host, () => !window.__mt2.wolf.sitting, 10000), "the guest's click stood it up");
      const hostClick = await vp(host, (g) => g.mobs.useMob(window.__mt2.wolf, null, g.inventory));
      assert(!hostClick && !(await vp(host, () => window.__mt2.wolf.sitting)), "not the host's wolf to command");
    });

    await check("online: the host's creeper goes for the guest, swells on the guest's screen and its blast hurts the guest", async () => {
      await vp(guest, (g) => {
        window.__ts?.close();
        g.player.health = 20;
        // (Iron armor: vanilla's blast this close would kill an unarmored player.)
        for (const id of [308, 309, 310, 311]) g.inventory.armor[g.inventory.constructor.armorSlotOf(id)] = { id, count: 1 };
        return true;
      });
      await vp(host, (g) => {
        const r = g.mp.players.active().find((x) => x.seen);
        const P = r.livePos;
        window.__mt2.creeper = g.mobs.spawn("creeper", P.x + 2, g.world.surfaceY(Math.floor(P.x + 2), Math.floor(P.z)) + 1, P.z);
        return true;
      });
      const swelled = await until(guest, (g) => [...g.mp.entities.mobById.values()].some((m) => m.kind === "creeper" && m.fuse > 0), 30000);
      assert(swelled, "the guest saw the creeper swell");
      const hurt = await until(guest, (g) => (g.player.health < 20 ? g.player.health : null), 30000);
      assert(hurt && hurt > 0, `the guest hurt by the blast: ${hurt}`);
      const gone = await until(host, () => window.__mt2.creeper.removed, 5000);
      assert(gone, "the creeper is gone");
    });
  }
  await guest.close();
  await host.close();
  peerHttp.close();
}
if (!args.solo) await online();

const failed = results.filter(([, ok]) => !ok);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
await browser.close();
server.close();
process.exit(failed.length ? 1 : 0);
