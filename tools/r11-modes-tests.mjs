// Round 11 world types and modes: boots the real game in headless Chromium
// (software WebGL, Low preset) and checks the three ways to play:
//  - a new Missions world as before (survival mode, the starter kit, the
//    missions, Mods on) and the main menu's three cards;
//  - a new Survival world made from the New World screen: empty-handed, Mods
//    off for it (the setting untouched, the switch locked), no missions,
//    crates, UFOs, aliens, parked vehicles or call-ins, no Missions button,
//    and no airports or cities in its terrain (once the terrain takes the option);
//  - Creative and back in it keeps it a Survival world (Round 13: Creative's
//    vehicles and call-ins there too), and its type
//    survives a reload (the save's, not the link's);
//  - an old save without a type loads as a Missions world;
//  - the other type's card opens the last world of that type (Round 12:
//    Creative is a Survival world's card);
//  - online (a host and a guest through a local PeerJS server, like
//    mp-tests.mjs): a Survival room gives the guest a Survival world with
//    Mods off, the room's modes are Survival and Creative only (no
//    Dogfight); a Missions room is as before (Mods on, the starter kit).
//
//   node r11-modes-tests.mjs [--only=substring] [--seed=42] [--solo]
//
// Like the other suites, it fails on any console error or page error.
import http from "node:http";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(process.env.GAME_ROOT || path.join(__dirname, "..")); // (GAME_ROOT=dir: another copy of the game)
const args = Object.fromEntries(
  process.argv
    .slice(2)
    .filter((a) => a.startsWith("--"))
    .map((a) => {
      const [k, ...rest] = a.slice(2).split("=");
      return [k, rest.length ? rest.join("=") : true];
    })
);
const PORT = 9700 + Math.floor(Math.random() * 40);
const SEED = Number(args.seed ?? 42);
const VANILLA_SEED = 777;
const OLD_SEED = 4242;
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

// A page load (or a navigation the game made) until the game is up.
async function ready(p) {
  await p.waitForFunction(() => !!window.__ufo, null, { timeout: 90000 });
  await p.waitForFunction(() => window.__ufo.graphicsReady, null, { timeout: 120000 });
}
async function boot(query) {
  await page.goto(`http://127.0.0.1:${PORT}/index.html?${query}&graphics=low`, { waitUntil: "load", timeout: 60000 });
  await ready(page);
}
// (Navigations the game makes itself: wait for the next page.)
async function afterNavigation(action) {
  const nav = page.waitForNavigation({ waitUntil: "load", timeout: 60000 });
  await action();
  await nav;
  await ready(page);
}

async function play(p = page) {
  const t0 = Date.now();
  while (Date.now() - t0 < 180000) { // (Round 13: a slow, shared machine)
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

// What a world is like right now.
const STATE = (g) => {
  const site = g.world.terrain.sites;
  const p = g.player.position;
  return {
    type: g.worldType,
    mode: g.player.mode,
    mods: g.mods.enabled,
    setting: g.settings.mods,
    items: g.inventory.slots.filter(Boolean).length,
    progress: g.progress.enabled,
    director: g.missions.enabled,
    crates: g.crates.enabled,
    ufos: g.ufos.enabled,
    vehicles: g.vehicles.enabled,
    parked: g.vehicles.vehicles.length, // (Round 13: vehicles are on in a Survival world too, for Creative's; none waiting about)
    aliens: g.mobs.countKind("alien"),
    missionsBtn: !document.getElementById("pause-missions-btn").classList.contains("hidden"),
    callins: !document.getElementById("pause-callins").classList.contains("hidden"),
    modsBox: { checked: document.getElementById("mods-enabled").checked, disabled: document.getElementById("mods-enabled").disabled, note: !document.getElementById("mods-world-note").classList.contains("hidden") },
    cards: [...document.querySelectorAll(".mode-card")].map((c) => `${c.id}${c.classList.contains("active") ? "*" : ""}`),
    label: document.getElementById("world-state").textContent,
    play: document.getElementById("play-btn").textContent,
    pauseName: [...document.getElementById("pause-mode-select").options].find((o) => o.value === "survival")?.textContent,
    sitesOption: g.world.terrainOptions ? g.world.terrainOptions.sites : undefined,
    sitesNear: site.within(p.x, p.z, 2500).length,
  };
};

// ================= Single player =================

await check("a new Missions world as before: three cards, survival mode, the starter kit, missions and Mods on", async () => {
  await boot(`seed=${SEED}`);
  const menu = await v(page, STATE);
  assert(menu.type === "missions" && menu.mode === "survival", `a Missions world in survival mode: ${JSON.stringify(menu)}`);
  // (Round 12) Survival, Creative (a Survival world's), then Missions.
  assert(menu.cards.join() === "mode-card-vanilla,mode-card-creative,mode-card-survival*", `three cards, Missions lit: ${menu.cards}`);
  assert(/new Missions world/.test(menu.label) && menu.play === "Play" && menu.pauseName === "Missions", JSON.stringify(menu));
  await play();
  const s = await v(page, STATE);
  assert(s.items === 3 && s.mods && s.progress && s.director && s.crates && s.ufos && s.vehicles, `the starter kit and the missions: ${JSON.stringify(s)}`);
  assert(s.missionsBtn && !s.callins && s.modsBox.checked && !s.modsBox.disabled && !s.modsBox.note, `the menus as before: ${JSON.stringify(s)}`);
  assert(s.sitesOption !== false, "a Missions world keeps its airports and cities");
  // (Online: "survival" is the world's own game, called Missions here; "missions" is taken for it.)
  const modes = await page.evaluate(async () => {
    const R = await import("./js/net/rules.js");
    return [R.roomMode("survival", "missions"), R.roomMode("missions", "survival"), R.roomMode("dogfight", "survival"), R.roomMode("dogfight", "missions"), R.roomMode("creative", "survival"), R.roomMode("nonsense", "missions"), R.modeName("survival", "missions"), R.modeName("survival", "survival")];
  });
  assert(JSON.stringify(modes) === JSON.stringify(["survival", "survival", null, "dogfight", "creative", null, "Missions", "Survival"]), `room modes: ${JSON.stringify(modes)}`);
  // (The Host tab's modes in a Missions world: Round 12, every mode, as on the main menu.)
  const cards = await v(page, (g) => {
    g.mp.ui._hostCards();
    return [...document.querySelectorAll("[data-mpmode]")].filter((c) => !c.classList.contains("hidden")).map((c) => c.querySelector("b").textContent + (c.classList.contains("active") ? "*" : ""));
  });
  assert(JSON.stringify(cards) === JSON.stringify(["Survival", "Creative", "Missions*", "Dogfight"]), `the Host tab's modes: ${cards}`);
  await v(page, (g) => g.flushSave());
});

await check("New world > Survival: empty-handed, Mods off for that world only, no missions, UFOs, aliens or vehicles", async () => {
  // To the main menu (saved), then the New World screen: Survival, seed 777.
  await page.evaluate(() => document.exitPointerLock());
  await until(page, (g) => g.gameState === "paused", 10000);
  await afterNavigation(() => page.evaluate(() => document.getElementById("main-menu-btn").click()).catch(() => {}));
  const back = await v(page, STATE);
  assert(back.type === "missions" && /saved Missions world/.test(back.label) && back.play === "Continue", `back at the menu: ${JSON.stringify(back)}`);
  await page.click("#new-world-btn");
  await page.click('[data-nwtype="survival"]');
  await page.fill("#new-seed", String(VANILLA_SEED));
  const hint = await page.evaluate(() => document.getElementById("new-type-hint").textContent);
  assert(/Survival world/.test(hint), `the type's hint: ${hint}`);
  await afterNavigation(() => page.click("#new-world-create"));
  const menu = await v(page, STATE);
  assert(menu.type === "survival" && /seed=777/.test(page.url()) && /type=survival/.test(page.url()), `a Survival world: ${JSON.stringify(menu)} ${page.url()}`);
  assert(menu.cards[0] === "mode-card-vanilla*" && /new Survival world/.test(menu.label) && menu.pauseName === "Survival", `its card and label: ${JSON.stringify(menu)}`);
  assert(!menu.mods && menu.setting === true && !menu.modsBox.checked && menu.modsBox.disabled && menu.modsBox.note, `Mods off here, the setting kept: ${JSON.stringify(menu)}`);
  await play();
  await frames(page, 30);
  const s = await v(page, STATE);
  assert(s.items === 0, `nothing to start with: ${JSON.stringify(s)}`);
  assert(!s.progress && !s.director && !s.crates && !s.ufos && s.parked === 0 && s.aliens === 0, `no missions, crates, UFOs or vehicles: ${JSON.stringify(s)}`);
  assert(!s.missionsBtn, "no Missions button in the pause menu");
  if (s.sitesOption === undefined) console.log("        (terrain option not in yet: airports and cities still generate)");
  else assert(s.sitesOption === false && s.sitesNear === 0, `no airports or cities: ${JSON.stringify(s)}`);
  // The settings' own Mods switch stays the player's; the world doesn't take it.
  const t = await v(page, (g) => {
    g.setModsEnabled(true);
    const r = { mods: g.mods.enabled, setting: g.settings.mods, ufos: g.ufos.enabled };
    return r;
  });
  assert(!t.mods && t.setting && !t.ufos, `the switch can't put Mods on here: ${JSON.stringify(t)}`);
  // (Something to keep: a dirt block, for the reload below.)
  await v(page, async (g) => {
    const { BLOCK } = await import("./js/blocks.js");
    g.inventory.add(BLOCK.DIRT, 5);
    g.mp.game.markInventoryChanged();
  });
});

await check("Creative and back in a Survival world keeps it a Survival world; the type survives a reload", async () => {
  const c = await v(page, (g) => {
    g.setMode("creative");
    return { type: g.worldType, mode: g.player.mode, mods: g.mods.enabled, callins: !document.getElementById("pause-callins").classList.contains("hidden"), progress: g.progress.enabled, call: g.mp.game.callIn("f16") };
  });
  // (Round 13: Creative's vehicles and call-ins in a Survival world too.)
  assert(c.type === "survival" && c.mode === "creative" && !c.mods && c.callins && !c.progress && c.call, `Creative in a Survival world: ${JSON.stringify(c)}`);
  const back = await v(page, (g) => {
    if (g.vehicles.active) g.vehicles.toggle();
    for (const x of [...g.vehicles.vehicles]) g.vehicles.remove(x);
    g.setMode("survival");
    return { type: g.worldType, mode: g.player.mode, mods: g.mods.enabled, progress: g.progress.enabled, crates: g.crates.enabled };
  });
  assert(back.type === "survival" && back.mode === "survival" && !back.mods && !back.progress && !back.crates, `back to Survival: ${JSON.stringify(back)}`);
  await v(page, (g) => g.flushSave());
  // (Reloaded from a link without the type, and one that says Missions: the save's type wins.)
  await boot(`seed=${VANILLA_SEED}&type=missions`);
  const s = await v(page, STATE);
  assert(s.type === "survival" && !s.mods && /saved Survival world/.test(s.label) && s.play === "Continue", `still a Survival world: ${JSON.stringify(s)}`);
  await play();
  const inv = await v(page, async (g) => {
    const { BLOCK } = await import("./js/blocks.js");
    return { dirt: g.inventory.slots.filter((x) => x && x.id === BLOCK.DIRT).reduce((n, x) => n + x.count, 0), items: g.inventory.slots.filter(Boolean).length, progress: g.progress.enabled };
  });
  assert(inv.dirt === 5 && inv.items === 1 && !inv.progress, `the things kept, no starter kit on a reload: ${JSON.stringify(inv)}`);
  const saved = await page.evaluate(async (seed) => {
    const S = await import("./js/storage.js");
    return JSON.parse(localStorage.getItem(S.playerKey(seed))).worldType;
  }, VANILLA_SEED);
  assert(saved === "survival", `saved with its type: ${saved}`);
});

await check("an old save without a type loads as a Missions world", async () => {
  await page.evaluate(async (seed) => {
    const S = await import("./js/storage.js");
    localStorage.setItem(S.playerKey(seed), JSON.stringify({ v: 1, mode: "survival", pos: null, inv: [[1, 3]], sel: 0, loadout: true }));
  }, OLD_SEED);
  // (Even from a link that says Survival: the save is a Missions world.)
  await boot(`seed=${OLD_SEED}&type=survival`);
  const s = await v(page, STATE);
  assert(s.type === "missions" && s.mods && /saved Missions world/.test(s.label) && s.cards[2] === "mode-card-survival*", `an old save: ${JSON.stringify(s)}`);
  await play();
  const p = await v(page, STATE);
  assert(p.progress && p.crates && p.items === 1 && p.missionsBtn, `missions on, its things kept: ${JSON.stringify(p)}`);
  await v(page, (g) => g.flushSave());
});

await check("the other type's card opens the last world of that type; Creative is the Survival world's; Missions clears the pick", async () => {
  await afterNavigation(async () => {
    await page.evaluate(() => document.exitPointerLock());
    await until(page, (g) => g.gameState === "paused", 10000);
    await page.evaluate(() => document.getElementById("main-menu-btn").click()).catch(() => {});
  });
  // (In the Missions world of OLD_SEED: the Survival card offers 777 again.)
  await page.click("#mode-card-vanilla");
  const picked = await v(page, STATE);
  assert(picked.play === "Continue Survival world" && picked.cards[0] === "mode-card-vanilla*" && picked.type === "missions", `the Survival world picked: ${JSON.stringify(picked)}`);
  const hint = await page.evaluate(() => document.getElementById("mode-hint").textContent);
  assert(/seed 777/.test(hint), `the hint says which: ${hint}`);
  // (Round 12) The Creative card is a Survival world's: the same world, in Creative.
  await page.click("#mode-card-creative");
  const creative = await v(page, STATE);
  assert(creative.play === "Continue Creative world" && creative.cards.join() === "mode-card-vanilla,mode-card-creative*,mode-card-survival" && creative.type === "missions" && creative.mode === "survival", `the Survival world in Creative picked: ${JSON.stringify(creative)}`);
  // (The Missions card: back to this world, in its own game.)
  await page.click("#mode-card-survival");
  const cleared = await v(page, STATE);
  assert(cleared.play === "Continue" && cleared.cards.join() === "mode-card-vanilla,mode-card-creative,mode-card-survival*" && cleared.mode === "survival", `back to this world: ${JSON.stringify(cleared)}`);
  await page.click("#mode-card-vanilla");
  await afterNavigation(() => page.click("#play-btn"));
  const s = await v(page, STATE);
  assert(s.type === "survival" && /seed=777/.test(page.url()) && s.play === "Continue", `into the Survival world: ${JSON.stringify(s)} ${page.url()}`);
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
  // (No pictures needed: two worlds drawn in software are slow.)
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

  await check("online: a Survival room gives the guest a Survival world with Mods off; its modes are Survival and Creative", async () => {
    await host.goto(`http://127.0.0.1:${PORT}/index.html?seed=${VANILLA_SEED + 1}&type=survival&${NET_Q}`, { waitUntil: "load", timeout: 60000 });
    await host.waitForFunction(() => !!window.__ufo && window.__ufo.graphicsReady, null, { timeout: 120000 });
    await host.click("#menu-mp-btn");
    const cards = await host.evaluate(() => [...document.querySelectorAll("[data-mpmode]")].filter((c) => !c.classList.contains("hidden")).map((c) => c.querySelector("b").textContent + (c.classList.contains("active") ? "*" : "")));
    // (Round 12) Every mode; a Missions card opens the last Missions world first.
    assert(JSON.stringify(cards) === JSON.stringify(["Survival*", "Creative", "Missions", "Dogfight"]), `the Host tab's modes: ${cards}`);
    await host.fill("#mp-nick", "Alice");
    await host.click("#mp-host-btn");
    const code = await until(host, (g) => g.net.code, 30000);
    assert(code, "no room code");
    const lobby = await host.evaluate(() => [...document.getElementById("mp-lobby-mode").options].filter((o) => !o.hidden).map((o) => `${o.value}:${o.textContent}`));
    assert(JSON.stringify(lobby) === JSON.stringify(["survival:Survival", "creative:Creative"]), `the lobby's modes: ${lobby}`);
    await host.click("#mp-lobby-play");
    await host.waitForFunction(() => window.__ufo.gameState === "playing", null, { timeout: 30000 });
    await v(host, noDraw);
    const h = await v(host, (g) => ({ mode: g.mp.mode, type: g.worldType, mods: g.mods.enabled, items: g.inventory.slots.filter(Boolean).length }));
    assert(h.mode === "survival" && h.type === "survival" && !h.mods && h.items === 0, `the host: ${JSON.stringify(h)}`);
    await guest.goto(`http://127.0.0.1:${PORT}/index.html?join=${code}&${NET_Q}`, { waitUntil: "load", timeout: 60000 });
    await guest.waitForSelector("#mp-join-boot:not(.hidden)", { timeout: 30000 });
    await guest.fill("#mp-boot-nick", "Bob");
    await guest.click("#mp-boot-join");
    await guest.waitForFunction(() => !!window.__ufo && window.__ufo.graphicsReady, null, { timeout: 120000 });
    assert(await until(guest, (g) => g.mp.stateLoaded, 60000), "the host's state never arrived");
    await v(guest, noDraw);
    await play(guest);
    await frames(guest, 20);
    const s = await v(guest, STATE);
    assert(s.type === "survival" && !s.mods && s.items === 0 && !s.progress && !s.crates && !s.ufos && s.parked === 0 && !s.missionsBtn, `the guest's world: ${JSON.stringify(s)}`);
    assert(s.modsBox.disabled && !s.modsBox.checked, `the guest's Mods switch: ${JSON.stringify(s.modsBox)}`);
    const gm = await v(guest, (g) => ({ mode: g.mp.mode, lobby: [...document.getElementById("mp-lobby-mode").options].filter((o) => !o.hidden).map((o) => o.value) }));
    assert(gm.mode === "survival" && JSON.stringify(gm.lobby) === JSON.stringify(["survival", "creative"]), JSON.stringify(gm));
  });

  await check("online: the host's Creative is everyone's and back; no Dogfight in a Survival world", async () => {
    await v(host, (g) => (g.mp.rules.setMode("creative"), true));
    assert(await until(guest, (g) => g.player.mode === "creative" && g.mp.mode === "creative", 15000), "the guest never went Creative");
    const c = await v(guest, (g) => ({ type: g.worldType, mods: g.mods.enabled, callins: !document.getElementById("pause-callins").classList.contains("hidden") }));
    assert(c.type === "survival" && !c.mods && c.callins, `Creative in the Survival room (Round 13: with its call-ins): ${JSON.stringify(c)}`);
    // (Dogfight needs a Missions world: refused, the room stays in Creative.)
    await v(host, (g) => (g.mp.rules.setMode("dogfight"), true));
    await new Promise((r) => setTimeout(r, 1500));
    const d = await v(host, (g) => ({ mode: g.mp.mode, df: g.mp.dogfight.phase, mods: g.mods.enabled }));
    assert(d.mode === "creative" && d.df === "off" && !d.mods, `no Dogfight: ${JSON.stringify(d)}`);
    // ("missions" is taken for this world's own game, Survival here.)
    await v(host, (g) => (g.mp.rules.setMode("missions"), true));
    assert(await until(guest, (g) => g.player.mode === "survival" && g.mp.mode === "survival", 15000), "the guest never came back to Survival");
    const s = await v(guest, STATE);
    assert(!s.mods && !s.progress && !s.crates && s.type === "survival", `back in Survival: ${JSON.stringify(s)}`);
  });

  await check("online: a Missions room as before: the guest gets a Missions world, Mods on, the starter kit; the mode is called Missions", async () => {
    await guest.close();
    await host.close();
    const h2 = await newPage("host2", { width: 640, height: 360 });
    const g2 = await newPage("guest2", { width: 640, height: 360 });
    await h2.goto(`http://127.0.0.1:${PORT}/index.html?seed=${SEED + 3}&${NET_Q}`, { waitUntil: "load", timeout: 60000 });
    await h2.waitForFunction(() => !!window.__ufo && window.__ufo.graphicsReady, null, { timeout: 120000 });
    await h2.click("#menu-mp-btn");
    await h2.fill("#mp-nick", "Alice");
    await h2.click("#mp-host-btn");
    const code = await until(h2, (g) => g.net.code, 30000);
    assert(code, "no room code");
    const lobby = await h2.evaluate(() => [...document.getElementById("mp-lobby-mode").options].filter((o) => !o.hidden).map((o) => `${o.value}:${o.textContent}`));
    assert(JSON.stringify(lobby) === JSON.stringify(["survival:Missions", "creative:Creative", "dogfight:Dogfight"]), `the lobby's modes: ${lobby}`);
    await h2.click("#mp-lobby-play");
    await h2.waitForFunction(() => window.__ufo.gameState === "playing", null, { timeout: 30000 });
    await v(h2, noDraw);
    await g2.goto(`http://127.0.0.1:${PORT}/index.html?join=${code}&${NET_Q}`, { waitUntil: "load", timeout: 60000 });
    await g2.waitForSelector("#mp-join-boot:not(.hidden)", { timeout: 30000 });
    await g2.fill("#mp-boot-nick", "Bob");
    await g2.click("#mp-boot-join");
    await g2.waitForFunction(() => !!window.__ufo && window.__ufo.graphicsReady, null, { timeout: 120000 });
    assert(await until(g2, (g) => g.mp.stateLoaded, 60000), "the host's state never arrived");
    await v(g2, noDraw);
    await play(g2);
    const s = await v(g2, STATE);
    const hud = await until(g2, () => document.getElementById("mp-hud").textContent, 10000);
    assert(s.type === "missions" && s.mods && s.items === 3 && s.progress && s.missionsBtn && s.mode === "survival", `the guest's world: ${JSON.stringify(s)}`);
    assert(/^Missions/.test(hud), `the HUD chip names the mode: ${hud}`);
    await g2.close();
    await h2.close();
  });

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
