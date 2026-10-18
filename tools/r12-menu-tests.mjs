// Round 12 menu tests: MINECLAUDE, the modes, one-click play, the home
// screen per mode, the Fullscreen setting, multiplayer in every mode.
// In Node (fast): a new world's type (Survival on a fresh start, Missions for
// an old ?seed= link), the world labels, the one-click flag (set, read once,
// taken out of the address, a room asked for only in this tab and for that
// world), the old settings without a Fullscreen key.
// In the browser (the real game): the name and the logo; a fresh install is a
// Survival world with Survival lit, a calm flyover and nothing to shoot; a
// ?seed= link is a Missions world with UFOs; picking Survival sends the UFO
// off, Missions brings one in; Play on a picked world reloads straight into
// the game (Click to play, the flag gone; a reload shows the menu again);
// New world > Creative makes a Survival world in Creative, in one go; the
// Fullscreen setting is saved, its buttons follow fullscreen and Play goes
// fullscreen with it on; Ctrl+W and friends are held back in the game; the
// Multiplayer screen offers Survival, Creative, Missions and Dogfight, and a
// Dogfight asked for in a Survival world opens a Missions world with the
// room open (a local signaling server).
//
//   node r12-menu-tests.mjs [--only=substring] [--node]
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

// ---------- In Node ----------

await check("a new world nothing picked is a Survival world; a ?seed= link without a type stays Missions; labels", async () => {
  const WT = await imp("js/worldtype.js");
  assert(WT.newWorldType(undefined) === "survival" && WT.newWorldType(null) === "survival", "a fresh start: Survival");
  assert(WT.newWorldType(null, { link: true }) === "missions", "an old world link: Missions");
  assert(WT.newWorldType("survival", { link: true }) === "survival" && WT.newWorldType("missions") === "missions" && WT.newWorldType("junk") === "missions", "a type given wins (junk: Missions, as an old save)");
  assert(WT.normalizeWorldType(undefined) === "missions", "an old save without a type is still a Missions world");
  assert(WT.worldLabel("survival", "creative") === "Survival world, in Creative" && WT.worldLabel("missions", "creative") === "Missions world, in Creative" && WT.worldLabel("missions") === "Missions world", "labels");
});

await check("the one-click flag: set on the reload's address, read once, gone from the address; a room only for that world, in this tab", async () => {
  const store = new Map();
  let replaced = null;
  globalThis.window = { location: { href: "http://x/index.html?seed=5&peerServer=h%3A1%2Fp" } };
  globalThis.sessionStorage = { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, val) => store.set(k, String(val)), removeItem: (k) => store.delete(k) };
  globalThis.history = { state: null, replaceState: (s, t, u) => (replaced = u) };
  try {
    window.location.search = "?seed=5&peerServer=h%3A1%2Fp";
    const G = await imp("js/menu-go.js");
    const url = new URL("http://x/index.html");
    url.searchParams.set("seed", "77");
    G.goUrl(url, "creative", "dogfight");
    assert(url.searchParams.get("go") === "creative" && url.searchParams.get("peerServer") === "h:1/p", `the address: ${url}`);
    assert(!url.search.includes("dogfight"), "the room is never in the address");
    window.location.href = url.toString();
    const go = G.takeGo(77);
    assert(go && go.mode === "creative" && go.host === "dogfight", `read: ${JSON.stringify(go)}`);
    assert(replaced && !replaced.includes("go="), `taken out of the address: ${replaced}`);
    window.location.href = replaced;
    assert(G.takeGo(77) === null, "read once");
    // Another world's page (or a stale ask): no room.
    const u2 = new URL("http://x/index.html?seed=3");
    G.goUrl(u2, null, "survival");
    assert(u2.searchParams.get("go") === "1", "the world's own mode");
    window.location.href = u2.toString();
    const g2 = G.takeGo(4);
    assert(g2 && g2.mode === null && g2.host === null, `another world: ${JSON.stringify(g2)}`);
  } finally {
    delete globalThis.window;
    delete globalThis.sessionStorage;
    delete globalThis.history;
  }
});

await check("settings: Fullscreen is off by default, kept when on, junk is off", async () => {
  const S = await imp("js/settings.js");
  assert(S.DEFAULT_SETTINGS.fullscreen === false, "default");
  assert(S.normalizeSettings({}).fullscreen === false && S.normalizeSettings({ fullscreen: true }).fullscreen === true && S.normalizeSettings({ fullscreen: "yes" }).fullscreen === false, "normalized");
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
  const BASE = `http://127.0.0.1:${PORT}/index.html`;
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
  // Opens `url` and waits for the game (Low graphics: quick under software rendering).
  async function boot(p, url) {
    await p.goto(url, { waitUntil: "load", timeout: 60000 });
    await p.waitForFunction(() => !!window.__ufo, null, { timeout: 90000 });
    await v(p, (g) => g.setGraphics("low"));
    await p.waitForFunction(() => window.__ufo.graphicsReady, null, { timeout: 180000 });
  }
  // After a navigation the page itself clicked.
  async function rebooted(p) {
    await p.waitForFunction(() => !!window.__ufo && window.__ufo.graphicsReady, null, { timeout: 180000 });
  }
  const menu = (p) =>
    v(p, (g) => ({
      title: document.title,
      logo: !!document.querySelector("#menu-logo svg") && document.querySelector("#menu-logo").getAttribute("aria-label"),
      cards: [...document.querySelectorAll(".mode-card")].map((c) => c.id + (c.classList.contains("active") ? "*" : "")),
      play: document.getElementById("play-btn").textContent,
      wt: g.worldType,
      ufos: g.flyover.ufos,
      gs: g.gameState,
      menu: !document.getElementById("start-menu").classList.contains("hidden"),
      ctp: !document.getElementById("click-to-play").classList.contains("hidden"),
      url: location.href,
      mode: g.player.mode,
    }));

  await check("browser: a fresh install is a Survival world (Survival lit, MINECLAUDE, a calm flyover with nothing to shoot)", async () => {
    const p = await newPage("fresh");
    await boot(p, BASE);
    const m = await menu(p);
    assert(m.title === "MINECLAUDE" && m.logo === "MINECLAUDE", `the name: ${JSON.stringify(m)}`);
    assert(m.wt === "survival" && m.cards.join() === "mode-card-vanilla*,mode-card-creative,mode-card-survival" && !m.ufos && m.play === "Play", `Survival first and lit: ${JSON.stringify(m)}`);
    const shot = await v(p, (g) => g.flyover.shoot(0, 0));
    assert(shot && shot.hit === false, "nothing to shoot over a Survival menu");
    await frames(p, 4);
    assert(!(await v(p, (g) => g.flyover.ufoVisible)), "no UFO in the sky");
    // Into the game: a Survival world, remembered as the last one.
    await p.click("#play-btn");
    assert(await until(p, (g) => g.gameState === "playing", 60000), "Play");
    await p.close();
  });

  await check("browser: a ?seed= link is a Missions world with UFOs; Survival sends the UFO off, Creative is a Survival world's, Missions brings it back", async () => {
    const p = await newPage("missions");
    await boot(p, `${BASE}?seed=42`);
    let m = await menu(p);
    assert(m.wt === "missions" && m.ufos && m.cards[2] === "mode-card-survival*", `a Missions world: ${JSON.stringify(m)}`);
    // A UFO on its pass (sped up), then the Survival card.
    await v(p, (g) => { g.flyover._gap = 0; });
    assert(await until(p, (g) => g.flyover.ufoVisible, 60000), "a UFO flies by");
    await p.click("#mode-card-vanilla");
    m = await menu(p);
    assert(!m.ufos && m.cards[0] === "mode-card-vanilla*" && /^New Survival world$/.test(m.play), `Survival picked: ${JSON.stringify(m)}`);
    assert(!(await v(p, (g) => g.flyover.ufoVisible)) && (await v(p, (g) => g.flyover._leaving > 0)), "the UFO flies off (and can't be shot)");
    await p.click("#mode-card-creative");
    m = await menu(p);
    assert(m.cards[1] === "mode-card-creative*" && /^New Creative world$/.test(m.play), `Creative picked (a Survival world's): ${JSON.stringify(m)}`);
    await p.click("#mode-card-survival");
    m = await menu(p);
    assert(m.ufos && m.play === "Play" && m.cards[2] === "mode-card-survival*", `back to this Missions world: ${JSON.stringify(m)}`);
    await p.close();
  });

  await check("browser: Play on a picked world reloads straight into the game (Click to play, once); a reload then shows the menu", async () => {
    const p = await newPage("oneclick");
    await boot(p, `${BASE}?seed=42`);
    await p.click("#mode-card-vanilla");
    await Promise.all([p.waitForNavigation({ waitUntil: "load", timeout: 60000 }), p.click("#play-btn")]);
    await rebooted(p);
    let m = await menu(p);
    assert(m.wt === "survival" && !m.menu && m.ctp && m.gs === "paused" && !/[?&]go=/.test(m.url) && m.mode === "survival", `straight in: ${JSON.stringify(m)}`);
    const text = await v(p, () => document.querySelector("#click-to-play b").textContent);
    assert(text === "Click to play", `ready: ${text}`);
    await p.click("#click-to-play");
    assert(await until(p, (g) => g.gameState === "playing", 30000), "one click and it plays");
    // Ctrl+W, Ctrl+S, Ctrl+D, Ctrl+Q held back while playing (those a page may cancel).
    const held = await v(p, () => ["KeyW", "KeyS", "KeyD", "KeyQ", "KeyT", "KeyN"].map((code) => {
      const e = new KeyboardEvent("keydown", { code, ctrlKey: true, bubbles: true, cancelable: true });
      document.body.dispatchEvent(e);
      return e.defaultPrevented;
    }));
    assert(held.every(Boolean), `held back: ${held}`);
    // A reload (or the link): the menu, as always.
    await p.reload({ waitUntil: "load" });
    await rebooted(p);
    m = await menu(p);
    assert(m.menu && m.gs === "start" && m.wt === "survival", `a reload shows the menu: ${JSON.stringify(m)}`);
    await p.close();
  });

  await check("browser: New world > Creative makes a Survival world in Creative, in one go", async () => {
    const p = await newPage("newworld");
    await boot(p, `${BASE}?seed=42`);
    await p.click("#new-world-btn");
    await p.click('[data-nwtype="creative"]');
    await p.fill("#new-seed", "12121");
    await Promise.all([p.waitForNavigation({ waitUntil: "load", timeout: 60000 }), p.click("#new-world-create")]);
    await rebooted(p);
    const m = await menu(p);
    assert(m.wt === "survival" && m.mode === "creative" && !m.menu && m.ctp && /seed=12121/.test(m.url), `a Survival world in Creative: ${JSON.stringify(m)}`);
    await p.close();
  });

  await check("browser: the Fullscreen setting (saved, its buttons follow fullscreen)", async () => {
    const p = await newPage("fullscreen");
    await boot(p, `${BASE}?seed=42`);
    await p.click("#menu-settings-btn");
    let s = await v(p, () => ({ shown: !!document.getElementById("fullscreen-row").offsetParent, on: document.getElementById("fullscreen-setting").checked, hint: document.getElementById("fullscreen-hint").textContent }));
    assert(s.shown && !s.on && /Ctrl\+W/.test(s.hint), `off, with its hint: ${JSON.stringify(s)}`);
    await p.click("#fullscreen-setting");
    s = await until(p, () => !!document.fullscreenElement && { saved: Object.entries(localStorage).some(([k, val]) => /settings/.test(k) && /"fullscreen":true/.test(val)), btn: document.getElementById("menu-fs-btn").textContent }, 10000);
    assert(s && s.saved && s.btn === "Leave fullscreen", `on and saved: ${JSON.stringify(s)}`);
    await p.click("#settings-back-btn");
    await p.click("#menu-fs-btn");
    s = await until(p, () => !document.fullscreenElement && { on: document.getElementById("fullscreen-setting").checked, btn: document.getElementById("menu-fs-btn").textContent }, 10000);
    assert(s && !s.on && s.btn === "Fullscreen", `the button leaves it and the setting follows: ${JSON.stringify(s)}`);
    // On again, then left the browser's way (the setting stays): Play goes back to fullscreen, with the mouse, in one click.
    await p.click("#menu-fs-btn");
    assert(await until(p, () => !!document.fullscreenElement, 10000), "the button enters it");
    await v(p, () => document.exitFullscreen());
    s = await until(p, () => !document.fullscreenElement && { on: document.getElementById("fullscreen-setting").checked }, 10000);
    assert(s && s.on, "a browser exit keeps the setting");
    await p.click("#play-btn");
    s = await until(p, (g) => g.gameState === "playing" && { fs: !!document.fullscreenElement, lock: !!document.pointerLockElement }, 30000);
    assert(s && s.fs && s.lock, `Play: fullscreen and the mouse: ${JSON.stringify(s)}`);
    await p.close();
  });

  await check("browser: Multiplayer in every mode: Survival, Creative, Missions, Dogfight; a Dogfight asked in a Survival world opens a Missions world with the room", async () => {
    const { createRequire } = await import("node:module");
    const require = createRequire(path.join(__dirname, "package.json"));
    const express = require("express");
    const { ExpressPeerServer } = require("peer");
    const PEER_PORT = 9930 + Math.floor(Math.random() * 40);
    const app = express();
    const peerHttp = app.listen(PEER_PORT, "127.0.0.1");
    app.use("/ufo", ExpressPeerServer(peerHttp, { path: "/" }));
    try {
      const p = await newPage("host");
      await boot(p, `${BASE}?seed=777&type=survival&peerServer=127.0.0.1:${PEER_PORT}/ufo&noStun=1`);
      await p.click("#menu-mp-btn");
      const cards = await v(p, () => [...document.querySelectorAll("[data-mpmode]")].filter((c) => !c.classList.contains("hidden")).map((c) => c.querySelector("b").textContent + (c.classList.contains("active") ? "*" : "")));
      assert(cards.join() === "Survival*,Creative,Missions,Dogfight", `the cards: ${cards}`);
      await p.fill("#mp-nick", "Tester");
      await p.click('[data-mpmode="dogfight"]');
      await Promise.all([p.waitForNavigation({ waitUntil: "load", timeout: 60000 }), p.click("#mp-host-btn")]);
      await rebooted(p);
      const s = await until(p, (g) => g.mp.active && { wt: g.worldType, host: g.net.isHost, mode: g.mp.mode, gs: g.gameState, url: location.href }, 60000);
      assert(s && s.wt === "missions" && s.host && s.mode === "dogfight" && s.gs === "paused" && !/[?&]go=/.test(s.url), `the room in a Missions world: ${JSON.stringify(s)}`);
      await p.close();
    } finally {
      peerHttp.close();
    }
  });

  await browser.close();
  server.close();
  if (errors.length) {
    results.push(["no console errors", false]);
    console.log(`  FAIL  console errors:\n    ${errors.slice(0, 10).join("\n    ")}`);
  }
}

// ---------- Summary ----------
const failed = results.filter(([, ok]) => !ok);
console.log(`\n${results.length - failed.length} passed, ${failed.length} failed.`);
process.exit(failed.length ? 1 : 0);
