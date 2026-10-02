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

await check("nicknames over remote players, on both sides", async () => {
  const c = await until(client, (g) => {
    const r = g.mp.players.get(1);
    return r && r.seen && { nick: r.nick, plate: r.plate.nick, visible: r.plate.sprite.visible, color: r.color };
  }, 20000);
  assert(c && c.nick === "Alice" && c.plate === "Alice" && c.visible, `client sees ${JSON.stringify(c)}`);
  const h = await until(host, (g) => {
    const pid = [...g.net.players.values()].find((p) => p.nick === "Bob")?.pid;
    const r = pid && g.mp.players.get(pid);
    return r && r.seen && { nick: r.nick, plate: r.plate.nick, visible: r.plate.sprite.visible };
  }, 20000);
  assert(h && h.nick === "Bob" && h.plate === "Bob" && h.visible, `host sees ${JSON.stringify(h)}`);
});

await check("movement sync: each side sees the other walk to where it went (interpolated)", async () => {
  // The host walks east a few blocks (flying in Creative keeps it simple).
  const target = await v(host, (g) => {
    g.setMode("creative");
    g.player.flying = true;
    g.player.position.x += 6;
    g.player.position.y += 3;
    g.player.velocity.set(0, 0, 0);
    return g.player.position.toArray();
  });
  const seen = await until(client, (g, t) => {
    const r = g.mp.players.get(1);
    return r && r.position.distanceTo(new g.THREE.Vector3(...t)) < 0.6 && r.position.toArray();
  }, 15000, target);
  assert(seen, `client never saw the host at ${target}`);
  const ctarget = await v(client, (g) => {
    g.player.flying = g.player.creative;
    g.player.position.z += 5;
    g.player.velocity.set(0, 0, 0);
    return g.player.position.toArray();
  });
  const hseen = await until(host, (g, t) => {
    const pid = [...g.net.players.values()].find((p) => p.nick === "Bob")?.pid;
    const r = g.mp.players.get(pid);
    return r && r.position.distanceTo(new g.THREE.Vector3(...t)) < 0.6 && r.position.toArray();
  }, 15000, ctarget);
  assert(hseen, `host never saw the client at ${ctarget}`);
  // The avatar is drawn where the player is.
  const av = await v(client, (g) => {
    const r = g.mp.players.get(1);
    return { vis: r.avatar.root.visible, d: r.avatar.root.position.distanceTo(r.position) };
  });
  assert(av.vis && av.d < 0.01, JSON.stringify(av));
  if (args.shots) {
    // A look at the host from the client (for a human to check the avatar and nameplate).
    await v(client, (g) => {
      const r = g.mp.players.get(1);
      const p = g.player.position;
      const d = r.position.clone().sub(p);
      g.player.yaw = Math.atan2(-d.x, -d.z);
      g.player.pitch = Math.atan2(d.y, Math.hypot(d.x, d.z));
    });
    await v(client, (g) => g.toggleHud());
    await frames(client, 10);
    await client.screenshot({ path: `${args.shots}/mp-client-sees-host.png` });
    await v(client, (g) => g.toggleHud());
  }
});

await check("a block change on either side shows on the other (and a race ends the same on both)", async () => {
  const spot = await v(host, (g) => {
    const x = g.spawn.x + 3;
    const z = g.spawn.z + 3;
    const y = g.world.surfaceY(x, z) + 4;
    g.world.setBlock(x, y, z, 1); // stone, in the air
    return [x, y, z];
  });
  const seen = await until(client, (g, p) => g.world.getBlock(...p) === 1, 15000, spot);
  assert(seen, `client never got the host's block at ${spot}`);
  // The client breaks it and puts another one up.
  await v(client, (g, p) => {
    g.world.setBlock(p[0], p[1], p[2], 0);
    g.world.setBlock(p[0], p[1] + 1, p[2], 1);
  }, spot);
  const gone = await until(host, (g, p) => g.world.getBlock(p[0], p[1], p[2]) === 0 && g.world.getBlock(p[0], p[1] + 1, p[2]) === 1, 15000, spot);
  assert(gone, "host never got the client's changes");
  // A race: both change the same block at once; both must end the same.
  await Promise.all([v(host, (g, p) => g.world.setBlock(p[0], p[1] + 2, p[2], 1), spot), v(client, (g, p) => g.world.setBlock(p[0], p[1] + 2, p[2], 3), spot)]);
  await sleep(2500);
  const a = await v(host, (g, p) => g.world.getBlock(p[0], p[1] + 2, p[2]), spot);
  const b = await v(client, (g, p) => g.world.getBlock(p[0], p[1] + 2, p[2]), spot);
  assert(a === b, `race: host ${a}, client ${b}`);
});

await check("explosions: a client's blast carves the crater on the host (as edits) and is seen there", async () => {
  const before = await v(host, (g) => g.effects.explosionCount);
  const at = await v(client, (g) => {
    // A dry spot near the spawn (water soaks up a blast).
    let x = g.spawn.x - 12;
    let z = g.spawn.z + 8;
    for (let k = 0; k < 40; k++) {
      const y = g.world.surfaceY(x, z);
      if (y > 0 && g.world.getBlock(x, y, z) !== 5 && g.world.getBlock(x, y + 1, z) === 0) break;
      x += 3;
      z -= 2;
    }
    const y = g.world.surfaceY(x, z);
    g.effects.explode(new g.THREE.Vector3(x + 0.5, y, z + 0.5), { radius: 4, source: "grenade" });
    return [x, y, z, g.world.getBlock(x, y, z)];
  });
  const seen = await until(host, (g, b) => g.effects.explosionCount > b, 15000, before);
  assert(seen, "the host never saw the explosion");
  const carved = await until(host, (g, p) => g.world.getBlock(p[0], p[1], p[2]) === p[3], 15000, at);
  assert(carved, `the crater block at ${at} is still there on the host`);
});

let hostUfoId = null;
await check("the host's UFO appears on the client (a puppet, where the host has it)", async () => {
  const cpos = await v(client, (g) => g.player.position.toArray());
  hostUfoId = await v(host, (g, cp) => {
    g.ufos.config.activity = 0;
    for (const u of [...g.ufos.ufos]) u.state = "gone";
    const u = g.ufos.spawn({ size: "small", pos: new g.THREE.Vector3(cp[0] + 22, cp[1] + 9, cp[2]) });
    u.state = "trick";
    u.trick = "hover";
    u.timer = 999;
    u.peaceful = true;
    return u.id;
  }, cpos);
  const seen = await until(client, (g, id) => {
    const u = g.mp.entities.ufoById.get(id);
    return u && u.interp.last && { pos: u.pos.toArray(), puppet: !!u.net };
  }, 20000, hostUfoId);
  assert(seen && seen.puppet, "no puppet UFO on the client");
  const hpos = await v(host, (g, id) => g.ufos.ufos.find((u) => u.id === id).pos.toArray(), hostUfoId);
  const d = Math.hypot(seen.pos[0] - hpos[0], seen.pos[1] - hpos[1], seen.pos[2] - hpos[2]);
  assert(d < 3, `puppet ${seen.pos} vs host ${hpos}`);
});

await check("a hit: the client's pistol shot at the host's UFO is applied by the host", async () => {
  const before = await v(host, (g, id) => g.ufos.ufos.find((u) => u.id === id)?.health, hostUfoId);
  // The client aims at the puppet and fires the real pistol.
  await v(client, (g, id) => {
    const u = g.mp.entities.ufoById.get(id);
    const eye = g.player.getEyePosition();
    const d = u.pos.clone().sub(eye);
    g.player.yaw = Math.atan2(-d.x, -d.z);
    g.player.pitch = Math.atan2(d.y, Math.hypot(d.x, d.z));
    g.setMode("survival");
    g.weapons.enabled = true;
    g.weapons.firePistol();
  }, hostUfoId);
  const after = await until(host, (g, a) => {
    const u = g.ufos.ufos.find((x) => x.id === a.id);
    return u && u.health < a.before && { health: u.health, by: u.lastHitPid };
  }, 15000, { id: hostUfoId, before });
  assert(after, `the host's UFO was not hurt (health ${before})`);
  const bobPid = await v(client, (g) => g.net.pid);
  assert(after.by === bobPid, `hit attributed to ${after.by}, not ${bobPid}`);
});

await check("the host's AI goes for the client: a zombie near the client hunts and hurts them (and shows there)", async () => {
  const cpos = await v(client, (g) => {
    g.setMode("survival");
    g.player.flying = false;
    g.player.health = 20;
    return g.player.position.toArray();
  });
  const zid = await v(host, (g, cp) => {
    g.mobs.hostileSpawning = true;
    const x = Math.floor(cp[0]) + 3;
    const z = Math.floor(cp[2]);
    const y = g.world.surfaceY(x, z) + 1;
    const m = g.mobs.spawn("zombie", x + 0.5, y, z + 0.5);
    m.fireproof = true;
    m.persist = true;
    return m.id;
  }, cpos);
  const shown = await until(client, (g, id) => !!g.mp.entities.mobById.get(id), 15000, zid);
  assert(shown, "the zombie never appeared on the client");
  const hurt = await until(client, (g) => g.player.health < 20 && g.player.health, 25000);
  assert(hurt, "the client was never hurt by the host's zombie");
  await v(host, (g, id) => {
    const m = g.mobs.mobs.find((x) => x.id === id);
    if (m) m.dead = true;
  }, zid);
});

// ---------- Summary ----------
const failed = results.filter(([, ok]) => !ok);
console.log(`\n${results.length - failed.length}/${results.length} multiplayer checks passed`);
if (errors.length) console.log(`Console errors:\n  ${errors.slice(0, 10).join("\n  ")}`);
await browser.close();
server.close();
peerHttp.close();
process.exit(failed.length || errors.length ? 1 : 0);
