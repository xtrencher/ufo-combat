// Round 20 (track A) tests: a death never kicks to the main menu, and the
// world is saved (also with the browser's storage full).
// In Node (fast): js/storage.js against a storage with a quota: a write that
// doesn't fit frees the canyon's ghost replays and tries again; a world
// still too big fails without throwing and leaves the old save whole; the
// storage report lists the worlds; a world is deleted (every key) but never
// the one being played.
// In the browser (the real game, a Missions world, Survival):
//   - a death in the Overworld, the Nether, on the Moon, in a jet and out in
//     space: the death screen with Respawn, never the main menu; Respawn
//     brings the player back (space left: the world drawn again);
//   - on the death screen the browser's shortcuts that leave the page (Ctrl+R,
//     Alt+Left, the mouse's back button) are held back, and leaving asks first;
//   - the death is saved at once (as respawned, the things on the ground), and
//     the save survives a reload: the things are still there, the player alive;
//   - a respawn that throws on the way still brings the player back;
//   - a full storage (localStorage.setItem throws QuotaExceededError past a
//     quota): no error, the game goes on, a warning stays up (over the death
//     screen too) with "Free space"; the ghost replays go first by themselves;
//     an old world deleted on the storage screen makes room: the save works
//     again and the warning goes;
//   - a page shown again from the back-forward cache reloads from the save
//     and doesn't write its old world over it;
//   - no console errors (the expected quota warnings are warnings).
// With --online: a guest and the host each die (Survival room): the death
// screen, never the main menu, and Respawn.
//
//   node r20-death-save-tests.mjs [--only=substring] [--node] [--online] [--verbose]
// (GAME_ROOT=dir runs another copy of the game.)
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

// ---------- Node: storage.js with a quota ----------

// A localStorage of `limit` characters (keys and values), throwing as browsers do.
class QuotaStorage {
  constructor(limit) {
    this.m = new Map();
    this.limit = limit;
  }
  get length() {
    return this.m.size;
  }
  key(i) {
    return [...this.m.keys()][i] ?? null;
  }
  getItem(k) {
    return this.m.has(k) ? this.m.get(k) : null;
  }
  used(except = null) {
    let n = 0;
    for (const [k, v] of this.m) if (k !== except) n += k.length + v.length;
    return n;
  }
  setItem(k, v) {
    v = String(v);
    if (this.used(k) + k.length + v.length > this.limit) {
      const e = new Error("The quota has been exceeded.");
      e.name = "QuotaExceededError";
      e.code = 22;
      throw e;
    }
    this.m.set(k, v);
  }
  removeItem(k) {
    this.m.delete(k);
  }
}

const P = "ufocombat_v1_";
const quiet = async (fn) => {
  const w = console.warn;
  console.warn = () => {};
  try {
    return await fn();
  } finally {
    console.warn = w;
  }
};

await check("storage: a full storage frees the ghost replays and saves; still full: false, no throw, the old save whole", async () => {
  const ls = new QuotaStorage(60000);
  globalThis.localStorage = ls;
  const S = await imp("js/storage.js");
  S.setActiveSeed(5);
  ls.setItem(`${P}canyon`, JSON.stringify({ a: { best: 60 } }));
  ls.setItem(`${P}canyon_ghost_a`, "x".repeat(20000));
  ls.setItem(`${P}canyon_ghost_b`, "x".repeat(15000));
  ls.setItem(`${P}player_5`, JSON.stringify({ v: 1, inv: [1] }));
  // 20,000 more characters: only with the ghosts gone.
  const ok = await quiet(() => S.savePlayer(5, { inv: [2], pad: "y".repeat(40000) }));
  assert(ok, "the player save fits once the ghosts are freed");
  assert(ls.getItem(`${P}canyon_ghost_a`) === null && ls.getItem(`${P}canyon_ghost_b`) === null, "the ghosts were freed");
  assert(ls.getItem(`${P}canyon`) !== null, "the canyon's best times stay");
  const saved = S.loadPlayer(5);
  assert(saved && saved.pad.length === 40000 && Number.isFinite(saved.savedAt), "the save, with its time");
  // Far too big: false, no throw, the last save kept as it was.
  let threw = false;
  let ok2;
  try {
    ok2 = await quiet(() => S.savePlayer(5, { inv: [3], pad: "z".repeat(90000) }));
  } catch {
    threw = true;
  }
  assert(!threw && ok2 === false, "a save that can't fit: false, no exception");
  assert(S.loadPlayer(5).inv[0] === 2, "the previous save is whole");
  // The edits too.
  const edits = new Map([["0,0", new Map([[1, 5]])]]);
  assert((await quiet(() => S.saveEdits(5, edits))) === false || ls.used() <= ls.limit, "the edits: no throw");
  // isQuotaError knows the browsers' names.
  assert(S.isQuotaError({ name: "QuotaExceededError" }) && S.isQuotaError({ name: "NS_ERROR_DOM_QUOTA_REACHED" }) && !S.isQuotaError(new TypeError("x")), "isQuotaError");
});

await check("storage: the report lists every world; a deleted world loses every key, never the one played", async () => {
  const ls = new QuotaStorage(1e7);
  globalThis.localStorage = ls;
  const S = await imp("js/storage.js");
  S.setActiveSeed(5);
  ls.setItem(`${P}player_5`, JSON.stringify({ v: 1, worldType: "survival", savedAt: 1000 }));
  ls.setItem(`${P}player_77`, JSON.stringify({ v: 1, worldType: "missions", savedAt: 2000 }));
  ls.setItem(`${P}edits_77`, "a".repeat(5000));
  ls.setItem(`${P}edits_77_nether`, "b".repeat(3000));
  ls.setItem(`${P}world_77`, JSON.stringify({ type: "missions", gen: 2 }));
  ls.setItem(`${P}hacks_77`, "{}");
  ls.setItem(`${P}edits_88_end`, "c".repeat(100));
  ls.setItem(`${P}worlds`, JSON.stringify({ missions: 77, survival: 5 }));
  ls.setItem(`${P}last`, JSON.stringify({ seed: 77 }));
  ls.setItem(`${P}settings`, "{}");
  ls.setItem(`${P}canyon_ghost_x`, "g".repeat(400));
  ls.setItem("voxelands_v1_edits_77", "not ours");
  const r = S.storageReport();
  const w77 = r.worlds.find((w) => w.seed === "77");
  assert(r.worlds.length === 3 && w77 && w77.type === "missions" && w77.at === 2000 && w77.keys.length === 5 && w77.chars > 8000, `the report: ${JSON.stringify(r.worlds.map((w) => [w.seed, w.type, w.keys.length, w.chars]))}`);
  assert(r.ghosts.n === 1 && r.ghosts.chars > 400 && r.worlds[0].seed === "77", "the ghosts; the largest world first");
  assert(S.deleteWorld(5) === 0 && ls.getItem(`${P}player_5`) !== null, "the world being played is never deleted");
  const freed = S.deleteWorld(77);
  assert(freed > 8000, `freed ${freed}`);
  assert(![...ls.m.keys()].some((k) => k.startsWith(P) && /_77(_|$)/.test(k)), `no key of world 77 left: ${[...ls.m.keys()]}`);
  assert(ls.getItem("voxelands_v1_edits_77") === "not ours", "another game's data is left alone");
  assert(ls.getItem(`${P}last`) === null && JSON.parse(ls.getItem(`${P}worlds`)).missions === undefined && JSON.parse(ls.getItem(`${P}worlds`)).survival === 5, "forgotten as the last world played");
  assert(S.deleteGhosts() > 400 && ls.getItem(`${P}canyon_ghost_x`) === null, "the ghosts deleted");
  delete globalThis.localStorage;
});

await check("storage: the saves' packed edits (v4) read back exactly, smaller than the classic runs; v2 / v3 still read", async () => {
  const S = await imp("js/storage.js");
  let rs = 7;
  const rnd = () => (rs = (rs * 16807) % 2147483647) / 2147483647;
  let classic = 0;
  let packed = 0;
  for (let c = 0; c < 60; c++) {
    // A nuke's scorched chunk: a block a column at a rolling height, plants gone, a tree crown or two; ids up to 4095.
    const m = new Map();
    const ox = rnd() * 100;
    const oz = rnd() * 100;
    for (let z = 0; z < 16; z++) {
      for (let x = 0; x < 16; x++) {
        const h = Math.round(40 + 6 * Math.sin((x + ox) / 7) + 5 * Math.cos((z + oz) / 9));
        m.set(h * 256 + z * 16 + x, c % 5 === 0 ? 1500 + (x % 3) : 3);
        if (rnd() < 0.3) m.set((h + 1) * 256 + z * 16 + x, 0);
        if (rnd() < 0.04) for (let y = h + 4; y < h + 8; y++) for (let k = 0; k < 40; k++) m.set(y * 256 + ((z * 16 + x + k) & 255), 0);
      }
    }
    if (c === 7) for (let i = 0; i < 32768; i++) m.set(i, i < 9000 ? 0 : 1); // (a whole chunk: runs past 255)
    const enc = S.encodeChunkEditsPacked(m);
    assert(enc.startsWith(S.PACKED), "the packed prefix");
    const back = S.decodeChunkEdits(enc);
    assert(back.size === m.size && [...m].every(([k, id]) => back.get(k) === id), `chunk ${c} read back exactly`);
    classic += S.encodeChunkEdits(m).length;
    packed += enc.length;
  }
  assert(packed < classic * 0.75, `smaller: ${packed} vs ${classic}`);
  const edits = new Map([["0,0", new Map([[5, 3]])], ["-2,9", new Map([[70, 2000]])]]);
  const data = JSON.parse(JSON.stringify(S.serializeEdits(edits)));
  assert(data.v === 4 && Object.values(data.chunks).every((x) => x.startsWith(S.PACKED)), JSON.stringify(data));
  const p = S.parseEdits(data);
  assert(p.get("0,0").get(5) === 3 && p.get("-2,9").get(70) === 2000, "v4 parsed");
  // An older save, classic strings, cached and mixed with packed ones: all read.
  const mixed = S.parseEdits({ v: 4, chunks: { "1,1": S.encodeChunkEdits(new Map([[9, 4]])), "2,2": S.encodeChunkEdits(new Map([[9, 3000]])), "3,3": S.encodeChunkEditsPacked(new Map([[9, 5]])) } });
  assert(mixed.get("1,1").get(9) === 4 && mixed.get("2,2").get(9) === 3000 && mixed.get("3,3").get(9) === 5, "mixed formats");
  let threw = 0;
  for (const bad of [S.PACKED + "gA==", S.PACKED + Buffer.from([2, 0, 0x80, 0x40]).toString("base64"), S.PACKED + Buffer.from([0xfe, 0xff, 0x07, 0, 1]).toString("base64")]) {
    try {
      S.decodeChunkEdits(bad);
    } catch {
      threw++;
    }
  }
  assert(threw === 3, `damaged packed strings fail loudly: ${threw}/3`);
});

// ---------- In the browser ----------

if (!args.node) await browserChecks();

async function browserChecks() {
  const { chromium } = await import("playwright-core");
  const PORT = 10760 + Math.floor(Math.random() * 30);
  const MIME = { ".html": "text/html", ".js": "text/javascript", ".json": "application/json" };
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
    executablePath: (await import("./chromium-path.mjs")).default,
    args: ["--use-gl=swiftshader", "--enable-webgl", "--ignore-gpu-blocklist", "--no-sandbox", "--disable-dev-shm-usage", "--disable-features=WebRtcHideLocalIpsWithMdns", "--autoplay-policy=no-user-gesture-required"],
  });
  const localThreeRoot = path.join(__dirname, "node_modules", "three");
  const peerjsFile = path.join(__dirname, "node_modules", "peerjs", "dist", "peerjs.min.js");
  // Navigations of a page (a main frame's): a death must not cause one.
  const navs = new Map();
  async function newPage(label, size = { width: 960, height: 540 }) {
    const ctx = await browser.newContext({ viewport: size });
    const p = await ctx.newPage();
    await p.route("https://cdn.jsdelivr.net/npm/three@0.160.0/**", (route) => {
      const rel = new URL(route.request().url()).pathname.replace("/npm/three@0.160.0/", "");
      route.fulfill({ path: path.join(localThreeRoot, rel), contentType: "text/javascript" });
    });
    await p.route("https://cdn.jsdelivr.net/npm/peerjs@1.5.4/**", (route) => route.fulfill({ path: peerjsFile, contentType: "text/javascript" }));
    p.on("console", (m) => {
      if (m.type() === "error") errors.push(`[${label}] ${m.text()}`);
      if (args.verbose && !/GPU stall/.test(m.text())) console.log(`    [${label}] ${m.text()}`);
    });
    p.on("pageerror", (e) => errors.push(`[${label}] ${String(e)}`));
    p.on("dialog", (d) => d.accept());
    navs.set(p, 0);
    p.on("framenavigated", (f) => {
      if (f === p.mainFrame()) navs.set(p, navs.get(p) + 1);
    });
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
    while (Date.now() - t0 < 180000) {
      const st = await v(p, (g) => g.gameState);
      if (st === "playing") return;
      if (st === "dead") {
        await v(p, (g) => g.respawn());
        continue;
      }
      for (const id of ["mp-lobby", "mp-screen", "storage-screen"]) await p.evaluate((i) => document.getElementById(i)?.classList.add("hidden"), id);
      if (st === "start") await p.click("#play-btn", { timeout: 5000 }).catch(() => {});
      else if (await p.isVisible("#resume-btn")) await p.click("#resume-btn", { timeout: 3000 }).catch(() => {});
      else if (await p.isVisible("#click-to-play").catch(() => false)) await p.click("#click-to-play", { timeout: 3000 }).catch(() => {});
      else {
        await v(p, (g) => g.screens.closeAll());
        await p.mouse.click(300, 200);
        await frames(p, 5);
      }
      await frames(p, 3);
    }
    throw new Error("the game didn't start playing");
  }
  // expected: console errors this check causes on purpose (a regex).
  const browserCheck = async (name, fn, expected = null) => {
    const before = errors.length;
    await check(name, async () => {
      const mine = () => errors.slice(before).filter((e) => !(expected && expected.test(e)));
      try {
        await fn();
      } catch (err) {
        if (mine().length) err.message += ` (console errors: ${mine().slice(0, 3).join(" | ")})`;
        throw err;
      }
      if (mine().length) throw new Error(`console errors: ${mine().slice(0, 3).join(" | ")}`);
    });
  };

  // The screen's state: the game's, the death screen, the main menu, the warning.
  const SCREEN = (g) => {
    const shown = (id) => {
      const el = document.getElementById(id);
      return !!el && !el.classList.contains("hidden") && getComputedStyle(el).display !== "none";
    };
    return { st: g.gameState, dead: g.player.dead, dim: g.world.dim, death: shown("death-screen"), menu: shown("start-menu"), warn: shown("save-warning"), vehicle: g.vehicles.active?.type ?? null, space: g.space.busy, idle: g.space.worldIdle, respawnBtn: shown("respawn-btn") };
  };
  const screen = (p) => v(p, SCREEN);
  // Kills the player (Survival): a pierce goes through a vehicle's seat, as its destruction does.
  const kill = (p, cause = "fall", pierce = false) =>
    v(p, (g, a) => {
      g.setMode("survival");
      g.player._invulnerable = 0;
      g.player.damage(1000, a.cause, { pierce: a.pierce });
      return g.player.dead;
    }, { cause, pierce });
  // Dead: the death screen, its button, never the main menu; then Respawn (the button, once it unlocks).
  async function deathAndRespawn(p, label) {
    await frames(p, 10);
    const d = await screen(p);
    assert(d.st === "dead" && d.dead && d.death && d.respawnBtn && !d.menu, `${label}: the death screen: ${JSON.stringify(d)}`);
    await p.waitForFunction(() => !document.getElementById("respawn-btn").disabled, null, { timeout: 5000 });
    await p.click("#respawn-btn");
    await frames(p, 20);
    const r = await screen(p);
    assert(!r.dead && r.st !== "dead" && r.st !== "start" && !r.death && !r.menu, `${label}: respawned: ${JSON.stringify(r)}`);
    return { d, r };
  }
  async function teleport(p, dim) {
    await v(p, (g) => (g.setMode("creative"), true));
    const ok = await v(p, (g, d) => g.mp.game.teleportTo(d), dim);
    assert(ok, `the teleport to ${dim}`);
    const done = await until(p, (g, d) => (g.world.dim === d && !g.dims.pending ? true : null), 90000, dim);
    assert(done, `arrived in ${dim}`);
    await frames(p, 15);
  }
  // A quota for localStorage (characters, keys and values), as a browser's: setItem past it throws QuotaExceededError.
  const QUOTA = () => {
    if (!window.__quota) {
      window.__quota = { limit: Infinity, hits: 0 };
      const orig = Storage.prototype.setItem;
      Storage.prototype.setItem = function (k, val) {
        const q = window.__quota;
        if (this === window.localStorage && Number.isFinite(q.limit)) {
          let n = 0;
          for (let i = 0; i < this.length; i++) {
            const kk = this.key(i);
            if (kk !== k) n += kk.length + (this.getItem(kk)?.length ?? 0);
          }
          if (n + k.length + String(val).length > q.limit) {
            q.hits++;
            throw new DOMException("The quota has been exceeded.", "QuotaExceededError");
          }
        }
        return orig.call(this, k, val);
      };
    }
    let n = 0;
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      n += k.length + localStorage.getItem(k).length;
    }
    return n;
  };
  const SEED = 20201;
  const PKEY = `ufocombat_v1_player_${SEED}`;

  const page = await newPage("solo");
  await page.goto(`http://127.0.0.1:${PORT}/index.html?seed=${SEED}&type=missions&graphics=low`, { waitUntil: "load", timeout: 60000 });
  await page.waitForFunction(() => !!window.__ufo && window.__ufo.graphicsReady, null, { timeout: 120000 });
  await play(page);
  await frames(page, 20);
  const navs0 = navs.get(page);
  let reloads = 0; // (the reloads made on purpose below)

  await browserCheck("a death in the Overworld: the death screen with Respawn (never the main menu); Respawn brings the player back", async () => {
    assert(await kill(page), "dead");
    await deathAndRespawn(page, "Overworld");
    await play(page);
  });

  await browserCheck("on the death screen the shortcuts that leave the page are held back (Ctrl+R, Alt+Left, the mouse's back button), and leaving asks", async () => {
    await play(page);
    assert(await kill(page, "lava"), "dead");
    await frames(page, 5);
    const r = await page.evaluate(() => {
      const key = (code, o) => {
        const e = new KeyboardEvent("keydown", { code, key: code, bubbles: true, cancelable: true, ...o });
        window.dispatchEvent(e);
        return e.defaultPrevented;
      };
      const mouse = (type, button) => {
        const e = new MouseEvent(type, { button, bubbles: true, cancelable: true });
        document.getElementById("death-screen").dispatchEvent(e);
        return e.defaultPrevented;
      };
      const unload = new Event("beforeunload", { cancelable: true });
      window.dispatchEvent(unload);
      return { ctrlR: key("KeyR", { ctrlKey: true }), metaR: key("KeyR", { metaKey: true }), altLeft: key("ArrowLeft", { altKey: true }), f5: key("F5", {}), backDown: mouse("mousedown", 3), backUp: mouse("mouseup", 3), fwdUp: mouse("mouseup", 4), asks: unload.defaultPrevented, st: window.__ufo.gameState };
    });
    assert(r.st === "dead", `still dead: ${JSON.stringify(r)}`);
    assert(r.ctrlR && r.metaR && r.altLeft && r.f5, `the keys held back: ${JSON.stringify(r)}`);
    assert(r.backDown && r.backUp && r.fwdUp, `the mouse's side buttons held back: ${JSON.stringify(r)}`);
    assert(r.asks, "leaving the page while dead asks first");
    await deathAndRespawn(page, "keys");
    await play(page);
  });

  await browserCheck("the death is saved at once (as respawned, the things on the ground)", async () => {
    await play(page);
    const r = await v(page, async (g) => {
      const V = await import("./js/content/ids.js");
      g.setMode("survival");
      g.inventory.slots[0] = { id: V.DIAMOND, count: 7 };
      g.mp.game.markInventoryChanged?.();
      g.flushSave();
      const before = JSON.parse(localStorage.getItem("ufocombat_v1_player_20201"));
      g.player._invulnerable = 0;
      g.player.damage(1000, "fall");
      // (no frame in between: saved by the death itself)
      const after = JSON.parse(localStorage.getItem("ufocombat_v1_player_20201"));
      return { beforePos: before.pos, afterPos: after.pos, invAfter: (after.inv || []).filter(Boolean).length, dropped: (after.items || []).some((e) => Array.isArray(e[6]) && e[6][0] === V.DIAMOND && e[6][1] === 7), items: (after.items || []).length };
    });
    assert(Array.isArray(r.beforePos) && r.afterPos === null, `saved as respawned at the death: ${JSON.stringify(r)}`);
    assert(r.invAfter === 0 && r.items > 0 && r.dropped, `the things on the ground in the save: ${JSON.stringify(r)}`);
  });

  await browserCheck("the save survives a reload after the death: the things still on the ground, the player alive", async () => {
    // (dead from the check before; the page reloaded as the player might, by hand)
    const st = await v(page, (g) => g.gameState);
    assert(st === "dead", `dead before the reload: ${st}`);
    const items0 = await v(page, (g) => g.entities.items.length);
    reloads++;
    await page.reload({ waitUntil: "load" });
    await page.waitForFunction(() => !!window.__ufo && window.__ufo.graphicsReady, null, { timeout: 120000 });
    const r = await v(page, (g) => ({ items: g.entities.items.length, dead: g.player.dead, hp: g.player.health, inv: g.inventory.slots.filter(Boolean).length }));
    assert(r.items >= Math.min(items0, 1) && r.items > 0, `the dropped things are back: ${JSON.stringify(r)} (before ${items0})`);
    assert(!r.dead && r.hp > 0, `alive: ${JSON.stringify(r)}`);
    await play(page);
  });

  await browserCheck("a death in the Nether and on the Moon: the death screen, Respawn back in the Overworld", async () => {
    for (const dim of ["nether", "moon"]) {
      await play(page);
      await teleport(page, dim);
      assert(await kill(page, "lava"), `dead in ${dim}`);
      const { d, r } = await deathAndRespawn(page, dim);
      assert(d.dim === dim, `died in ${dim}: ${d.dim}`);
      assert(r.dim === "overworld", `respawned in the Overworld: ${r.dim}`);
    }
    await play(page);
  });

  await browserCheck("a death in a jet (its destruction): out of it, the death screen, Respawn on foot", async () => {
    await play(page);
    await v(page, (g) => {
      if (g.vehicles.active) g.vehicles.exit({ force: true });
      g.setMode("creative");
      return g.mp.game.callIn("f22");
    });
    await frames(page, 5);
    const s = await screen(page);
    assert(s.vehicle === "jet", `in the jet: ${JSON.stringify(s)}`);
    assert(await kill(page, "crash", true), "dead");
    const { d, r } = await deathAndRespawn(page, "jet");
    assert(!d.vehicle && !r.vehicle, `out of the jet: ${JSON.stringify(d)}`);
    await play(page);
  });

  await browserCheck("a death out in space: back from space at once, the death screen; Respawn draws the world again", async () => {
    await play(page);
    const up = await v(page, async (g) => {
      if (g.vehicles.active) g.vehicles.exit({ force: true });
      g.setMode("creative");
      document.querySelector(`#pause-callins [data-callin="ufo"]`).click();
      for (let i = 0; i < 3; i++) await new Promise((r) => requestAnimationFrame(r));
      const u = g.vehicles.active;
      if (!u) return { ufo: false };
      u.pos.y = 5980;
      u.speedLevel = 1;
      g.player.keys.add("Space");
      let n = 0;
      while (!g.space.busy && n < 300) {
        g.vehicles.update(1 / 30);
        g.space.update(1 / 30);
        n++;
      }
      g.player.keys.clear();
      return { ufo: true, space: g.space.busy };
    });
    assert(up.ufo && up.space, `in space: ${JSON.stringify(up)}`);
    await frames(page, 10);
    assert(await kill(page, "ufo_crash", true), "dead");
    const { d, r } = await deathAndRespawn(page, "space");
    assert(!d.space && !d.vehicle, `back from space at the death: ${JSON.stringify(d)}`);
    await frames(page, 30);
    const r2 = await screen(page);
    assert(!r2.space && !r2.idle, `the world drawn and streamed again: ${JSON.stringify(r2)}`);
    const saved = await v(page, (g, k) => (g.flushSave(), JSON.parse(localStorage.getItem(k)).space?.solar?.resume ?? null), PKEY);
    assert(!saved, `no trip saved to resume: ${JSON.stringify(saved)}`);
    await play(page);
  });

  await browserCheck("a respawn that throws on the way still brings the player back (at the world spawn)", async () => {
    await play(page);
    assert(await kill(page), "dead");
    await frames(page, 5);
    await v(page, (g) => {
      const orig = g.dims.enterNow;
      let once = true;
      g.dims.enterNow = function (...a) {
        if (once) {
          once = false;
          throw new Error("test: a dimension that fails");
        }
        return orig.apply(this, a);
      };
      g.__restoreEnterNow = () => (g.dims.enterNow = orig);
      return true;
    });
    const { r } = await deathAndRespawn(page, "throwing respawn");
    await v(page, (g) => (g.__restoreEnterNow(), true));
    assert(r.dim === "overworld", `at home: ${JSON.stringify(r)}`);
    await play(page);
  }, /the respawn failed|test: a dimension that fails/);

  await browserCheck("a full storage: the ghost replays go first by themselves (no warning), the save made", async () => {
    await play(page);
    await v(page, (g) => (g.flushSave(), true));
    const used = await page.evaluate(QUOTA);
    await page.evaluate((u) => {
      localStorage.setItem("ufocombat_v1_canyon_ghost_test", "g".repeat(40000));
      window.__quota.limit = u + 20000; // (the ghost doesn't fit with the save any more)
      return true;
    }, used);
    const r = await v(page, (g, k) => {
      const before = JSON.parse(localStorage.getItem(k)).savedAt;
      g.player.position.x += 0.5;
      g.flushSave();
      return { saved: JSON.parse(localStorage.getItem(k)).savedAt > before, ghost: localStorage.getItem("ufocombat_v1_canyon_ghost_test"), hits: window.__quota.hits };
    }, PKEY);
    await frames(page, 3);
    const s = await screen(page);
    assert(r.hits > 0, `the quota was hit: ${JSON.stringify(r)}`);
    assert(r.ghost === null && r.saved, `the ghost freed, the save made: ${JSON.stringify(r)}`);
    assert(!s.warn, "no warning");
    await page.evaluate(() => (window.__quota.limit = Infinity));
  });

  await browserCheck("a full storage: no error, the game goes on, the warning stays up (over the death screen too); a world deleted makes room and the save works again", async () => {
    await play(page);
    // An old world of 120,000 characters, and a quota with no room left.
    await page.evaluate(() => {
      localStorage.setItem("ufocombat_v1_player_99", JSON.stringify({ v: 1, worldType: "survival", savedAt: Date.now() - 86400000 * 3, pad: "p".repeat(60000) }));
      localStorage.setItem("ufocombat_v1_edits_99", "e".repeat(60000));
      return true;
    });
    await v(page, (g) => (g.flushSave(), true));
    const used = await page.evaluate(QUOTA);
    await page.evaluate((u) => (window.__quota.limit = u - 2000), used);
    const saved0 = await page.evaluate((k) => localStorage.getItem(k), PKEY);
    // A block broken and the player moved: the edits and the player both fail.
    await v(page, (g) => {
      const p = g.player.position;
      g.world.setBlock(Math.floor(p.x) + 2, Math.floor(p.y) - 1, Math.floor(p.z) + 2, 0);
      g.player.position.x += 0.25;
      g.flushSave();
      return true;
    });
    await frames(page, 30);
    let s = await screen(page);
    assert(s.warn && s.st === "playing", `the warning, the game going on: ${JSON.stringify(s)}`);
    assert((await page.evaluate((k) => localStorage.getItem(k), PKEY)) === saved0, "the old save is whole");
    // The game still runs: a few seconds of play (the 5 s saves fail quietly).
    await page.waitForTimeout(6000);
    s = await screen(page);
    assert(s.st === "playing" && s.warn, `still playing: ${JSON.stringify(s)}`);
    // Dying with the storage full: the death screen, the warning over it.
    assert(await kill(page), "dead");
    await frames(page, 10);
    s = await screen(page);
    assert(s.death && s.warn && !s.menu, `the death screen and the warning: ${JSON.stringify(s)}`);
    const onTop = await page.evaluate(() => {
      const b = document.getElementById("save-warning-btn").getBoundingClientRect();
      const el = document.elementFromPoint(b.left + b.width / 2, b.top + b.height / 2);
      return el?.id === "save-warning-btn";
    });
    assert(onTop, "the warning's button is clickable over the death screen");
    // Free space: the storage screen, the old world deleted (two clicks).
    await page.click("#save-warning-btn");
    await page.waitForSelector("#storage-screen:not(.hidden)", { timeout: 5000 });
    const listed = await page.evaluate(() => [...document.querySelectorAll("#storage-list .st-row")].map((r) => r.textContent));
    assert(listed.some((t) => t.includes("99")) && listed.some((t) => t.includes("20201") && t.includes("playing")), `the worlds listed: ${JSON.stringify(listed)}`);
    assert(!(await page.$('#storage-list [data-del="20201"]')), "no Delete for the world being played");
    await page.click('#storage-list [data-del="99"]');
    await page.click('#storage-list [data-del="99"]');
    await frames(page, 5);
    const r = await page.evaluate((k) => ({ gone: localStorage.getItem("ufocombat_v1_player_99") === null && localStorage.getItem("ufocombat_v1_edits_99") === null, saved: localStorage.getItem(k) }), PKEY);
    assert(r.gone, "the old world deleted");
    assert(r.saved !== saved0 && JSON.parse(r.saved).pos === null, "the world saved at once (dead: as respawned)");
    s = await screen(page);
    assert(!s.warn && s.death, `the warning gone, still on the death screen: ${JSON.stringify(s)}`);
    await page.click("#storage-close");
    await deathAndRespawn(page, "full storage");
    // Saving goes on after.
    const t = await v(page, (g, k) => {
      const before = JSON.parse(localStorage.getItem(k)).savedAt;
      g.flushSave();
      return JSON.parse(localStorage.getItem(k)).savedAt >= before;
    }, PKEY);
    assert(t, "saves again");
    await page.evaluate(() => (window.__quota.limit = Infinity));
    await play(page);
  });

  await browserCheck("a nuke's blast zones save their chunks done as a bitmap, read back the same (and an old list still read)", async () => {
    const r = await v(page, (g) => {
      const n = g.nuke;
      const keep = n.zones;
      const done = new Set();
      for (let cx = 12472; cx <= 12534; cx++) for (let cz = -12530; cz <= -12472; cz++) if ((cx * 7 + cz * 3) % 5 !== 0) done.add(`${cx},${cz}`);
      // (far from the chunks loaded: loadZones applies a zone to those at once, adding them as done)
      n.zones = [{ x: 200040.37, y: 70, z: -200012.71, R: 150, done }, { x: 300005, y: 60, z: 5, R: 30, done: new Set(["18750,0", "18751,-1"]) }];
      const saved = JSON.parse(JSON.stringify(n.serializeZones()));
      const oldList = [{ x: -300001, y: 2, z: 3, R: 20, done: ["-18751,5", "-18750,-2"] }];
      n.loadZones(saved);
      const back = n.zones.map((z) => [...z.done].sort().join(" "));
      n.loadZones(oldList);
      const old = [...n.zones[0].done].sort().join(" ");
      n.zones = keep;
      return { len: JSON.stringify(saved).length, listLen: [...done].join('","').length, same: back[0] === [...done].sort().join(" ") && back[1] === ["18750,0", "18751,-1"].sort().join(" "), old: old === ["-18750,-2", "-18751,5"].sort().join(" "), db: typeof saved[0].db };
    });
    assert(r.same && r.old && r.db === "string", JSON.stringify(r));
    assert(r.len < r.listLen / 8, `smaller: ${r.len} vs ${r.listLen}`);
  });

  await browserCheck("never a navigation from any of the deaths above (no kick to the main menu)", async () => {
    // (only the reload the save-survives check made on purpose)
    assert(navs.get(page) - navs0 === reloads, `navigations: ${navs.get(page) - navs0} (reloads made: ${reloads})`);
  });

  await browserCheck("a page back from the back-forward cache reloads from the save, writing nothing of its old world", async () => {
    await play(page);
    await v(page, (g) => (g.flushSave(), true));
    const saved0 = await page.evaluate((k) => JSON.parse(localStorage.getItem(k)).pos, PKEY);
    const n0 = navs.get(page);
    await v(page, (g) => {
      g.player.position.x += 40;
      window.dispatchEvent(new PageTransitionEvent("pageshow", { persisted: true }));
      return true;
    }).catch(() => {});
    const t0 = Date.now();
    while (navs.get(page) === n0 && Date.now() - t0 < 20000) await new Promise((r) => setTimeout(r, 100));
    assert(navs.get(page) > n0, "reloaded");
    await page.waitForFunction(() => !!window.__ufo && window.__ufo.graphicsReady, null, { timeout: 120000 });
    const saved1 = await page.evaluate((k) => JSON.parse(localStorage.getItem(k)).pos, PKEY);
    assert(JSON.stringify(saved1) === JSON.stringify(saved0), `the save untouched: ${JSON.stringify(saved0)} -> ${JSON.stringify(saved1)}`);
  });
  await page.close();

  // ---------- Online ----------
  if (args.online) {
    const { default: express } = await import("express");
    const { ExpressPeerServer } = await import("peer");
    const PEER_PORT = PORT + 50;
    const app = express();
    const peerHttp = app.listen(PEER_PORT, "127.0.0.1");
    app.use("/ufo", ExpressPeerServer(peerHttp, { path: "/" }));
    const NET_Q = `peerServer=127.0.0.1:${PEER_PORT}/ufo&noStun=1&graphics=low`;
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
    const host = await newPage("host", { width: 640, height: 360 });
    const guest = await newPage("guest", { width: 640, height: 360 });
    await browserCheck("online: the guest and the host each die (Survival): the death screen, never the main menu, Respawn", async () => {
      await host.goto(`http://127.0.0.1:${PORT}/index.html?seed=20209&type=missions&${NET_Q}`, { waitUntil: "load", timeout: 60000 });
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
      assert(await until(guest, (g) => g.mp.stateLoaded, 150000), "the host's state never arrived");
      await v(guest, noDraw);
      await play(guest).catch(() => {});
      const gn = navs.get(guest);
      const hn = navs.get(host);
      for (const [p, who] of [[guest, "guest"], [host, "host"]]) {
        assert(await kill(p, "fall"), `${who} dead`);
        await deathAndRespawn(p, who);
      }
      assert(navs.get(guest) === gn && navs.get(host) === hn, "no navigation");
    });
    await guest.close();
    await host.close();
    peerHttp.close();
  }

  await browser.close();
  server.close();
}

// ---------- Summary ----------
const failed = results.filter(([, ok]) => !ok);
console.log(`\n${results.length - failed.length} passed, ${failed.length} failed.`);
process.exit(failed.length ? 1 : 0);
