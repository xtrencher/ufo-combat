// Round 7 multiplayer tests: a host and a client in two headless Chromium
// pages (two separate browser contexts, like two computers), connected
// through the real PeerJS client and real WebRTC data channels. A local
// PeerJS signaling server (the `peer` package) stands in for the public one
// (the test machine has no internet), and the game is pointed at it with
// ?peerServer=...&noStun=1.
//
//   node mp-tests.mjs [--only=substring] [--seed=42] [--keep]
//
// Checks: joining by room code, nicknames, movement sync, a block change,
// a hit (client shoots the host's UFO; the host applies it), Dogfight
// scoring, a client leaving and the host leaving. Fails on any console
// error or page error in either page.
import http from "node:http";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";
import express from "express";
import { ExpressPeerServer } from "peer";

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
const PORT = 9300 + Math.floor(Math.random() * 40);
const PEER_PORT = PORT + 50;
const SEED = Number(args.seed ?? 42);
const MIME = { ".html": "text/html", ".js": "text/javascript" };

// The game's files.
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

// A local PeerJS signaling server.
const app = express();
const peerHttp = app.listen(PEER_PORT, "127.0.0.1");
app.use("/ufo", ExpressPeerServer(peerHttp, { path: "/" }));

const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome",
  args: ["--use-gl=swiftshader", "--enable-webgl", "--ignore-gpu-blocklist", "--no-sandbox", "--disable-dev-shm-usage", "--disable-features=WebRtcHideLocalIpsWithMdns", "--autoplay-policy=no-user-gesture-required"],
});
const errors = [];
const results = [];
const localThreeRoot = path.join(__dirname, "node_modules", "three");
const peerjsFile = path.join(__dirname, "node_modules", "peerjs", "dist", "peerjs.min.js");

async function newPage(label) {
  const ctx = await browser.newContext({ viewport: { width: 640, height: 360 } });
  const page = await ctx.newPage();
  await page.route("https://cdn.jsdelivr.net/npm/three@0.160.0/**", (route) => {
    const rel = new URL(route.request().url()).pathname.replace("/npm/three@0.160.0/", "");
    route.fulfill({ path: path.join(localThreeRoot, rel), contentType: "text/javascript" });
  });
  await page.route("https://cdn.jsdelivr.net/npm/peerjs@1.5.4/**", (route) => route.fulfill({ path: peerjsFile, contentType: "text/javascript" }));
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(`[${label}] ${m.text()}`);
    if (args.verbose) console.log(`    [${label}] ${m.text()}`);
  });
  page.on("pageerror", (e) => errors.push(`[${label}] ${String(e)}`));
  page.on("dialog", (d) => d.accept());
  page.label = label;
  return page;
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}
const frames = (page, n = 2) =>
  page.evaluate(
    (k) =>
      new Promise((r) => {
        let i = 0;
        const f = () => (++i >= k ? r() : requestAnimationFrame(f));
        requestAnimationFrame(f);
      }),
    n
  );
// v(page, fn, arg): runs fn(game, arg) in the page (game = window.__ufo).
const v = (page, fn, arg) => page.evaluate(([src, a]) => new Function("g", "arg", `return (${src})(g, arg);`)(window.__ufo, a), [fn.toString(), arg]);
async function until(page, fn, timeout = 60000, arg) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeout) {
    const r = await v(page, fn, arg);
    if (r) return r;
    await new Promise((res) => setTimeout(res, 100));
  }
  return null;
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

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

const NET_Q = `peerServer=127.0.0.1:${PEER_PORT}/ufo&noStun=1&graphics=low`;

async function play(page) {
  if ((await v(page, (g) => g.gameState)) === "dead") await v(page, (g) => g.respawn());
  if ((await v(page, (g) => g.gameState)) === "playing") return;
  for (let k = 0; k < 3 && !(await page.isVisible("#resume-btn")) && (await v(page, (g) => g.gameState)) === "paused"; k++) {
    await page.mouse.click(320, 180);
    await frames(page, 5);
    if ((await v(page, (g) => g.gameState)) === "playing") return;
  }
  for (const id of ["mp-lobby", "mp-screen"]) await page.evaluate((i) => document.getElementById(i).classList.add("hidden"), id);
  await v(page, (g) => g.screens.closeAll());
  if ((await v(page, (g) => g.gameState)) === "paused") await page.evaluate(() => document.getElementById("pause-menu").classList.remove("hidden"));
  const btn = (await v(page, (g) => g.gameState)) === "start" ? "#play-btn" : "#resume-btn";
  await page.click(btn, { timeout: 60000 });
  await page.waitForFunction(() => window.__ufo.gameState === "playing", null, { timeout: 30000 });
}

// ---------- Host ----------
const host = await newPage("host");
await host.goto(`http://127.0.0.1:${PORT}/index.html?seed=${SEED}&${NET_Q}`, { waitUntil: "load", timeout: 60000 });
await host.waitForFunction(() => !!window.__ufo, null, { timeout: 90000 });
await host.waitForFunction(() => window.__ufo.graphicsReady, null, { timeout: 120000 });
let code = null;

await check("host opens a room and gets a room code", async () => {
  // Through the real menu: Multiplayer > nickname > Host > Open room.
  await host.click("#menu-mp-btn");
  await host.fill("#mp-nick", "Alice");
  await host.click("#mp-host-btn");
  code = await until(host, (g) => g.net.code, 30000);
  assert(/^[A-HJ-NP-Z2-9]{5}$/.test(code || ""), `room code: ${code}`);
  assert(await host.isVisible("#mp-lobby"), "the lobby shows after hosting");
  const shown = await host.textContent("#mp-lobby-code");
  assert(shown === code, `lobby shows ${shown}`);
  await host.click("#mp-lobby-play");
  await host.waitForFunction(() => window.__ufo.gameState === "playing", null, { timeout: 30000 });
});

// ---------- Client ----------
const client = await newPage("client");
await check("client joins by room code (nickname prompt, world from the host's seed)", async () => {
  await client.goto(`http://127.0.0.1:${PORT}/index.html?join=${code}&${NET_Q}`, { waitUntil: "load", timeout: 60000 });
  await client.waitForSelector("#mp-join-boot:not(.hidden)", { timeout: 30000 });
  assert((await client.inputValue("#mp-boot-code")) === code, "the code from the link is filled in");
  await client.fill("#mp-boot-nick", "Bob");
  await client.click("#mp-boot-join");
  await client.waitForFunction(() => !!window.__ufo, null, { timeout: 90000 });
  await client.waitForFunction(() => window.__ufo.graphicsReady, null, { timeout: 120000 });
  const loaded = await until(client, (g) => g.mp.stateLoaded, 60000);
  assert(loaded, "the host's state arrived");
  const r = await v(client, (g) => ({ seed: g.world.seed, guest: g.mp.isClient, players: [...g.net.players.values()].map((p) => p.nick).sort() }));
  assert(r.seed === SEED, `client world seed ${r.seed}`);
  assert(r.guest, "client role");
  assert(JSON.stringify(r.players) === JSON.stringify(["Alice", "Bob"]), JSON.stringify(r.players));
  const h = await until(host, (g) => g.net.playerCount === 2 && [...g.net.players.values()].map((p) => p.nick).sort().join(","), 10000);
  assert(h === "Alice,Bob", `host sees ${h}`);
  await play(client);
});

if (!args.keep) {
  // (later checks are added here)
}

// ---------- Summary ----------
const failed = results.filter(([, ok]) => !ok);
console.log(`\n${results.length - failed.length}/${results.length} multiplayer checks passed`);
if (errors.length) console.log(`Console errors:\n  ${errors.slice(0, 10).join("\n  ")}`);
await browser.close();
server.close();
peerHttp.close();
process.exit(failed.length || errors.length ? 1 : 0);
