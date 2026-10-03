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

await check("a hidden tab keeps the game going (the worker clock steps the world without drawing)", async () => {
  const r = await host.evaluate(async () => {
    const g = window.__ufo;
    const t0 = g.mp.bg.ticks;
    const time0 = g.sky.time;
    Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "hidden" });
    await new Promise((res) => setTimeout(res, 1500));
    delete document.visibilityState;
    return { ticks: g.mp.bg.ticks - t0, visible: document.visibilityState, clock: g.sky.time !== time0 };
  });
  assert(r.ticks >= 10 && r.visible === "visible" && r.clock, JSON.stringify(r));
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
await check("items handed over: what the client throws lands on the host's side, and only one player can pick it up", async () => {
  const key = await v(client, (g) => {
    g.setMode("survival");
    if (g.player.dead) g.respawn();
    g.inventory.slots[7] = { id: 10, count: 5 };
    g.inventory.selected = 7;
    g.interaction.dropSelected(true);
    const it = g.entities.items.find((x) => x.shared && x.id === 10);
    return it && it.shared;
  });
  assert(key, "the client's thrown stack is not shared");
  const there = await until(host, (g, k) => g.mp.items.byKey.has(k), 10000, key);
  assert(there, "the thrown stack never reached the host");
  // Both reach for it at once: one gets it, the other doesn't (no copies).
  const hostBefore = await v(host, (g) => g.inventory.slots.reduce((n, s) => n + (s && s.id === 10 ? s.count : 0), 0));
  const clientBefore = await v(client, (g) => g.inventory.slots.reduce((n, s) => n + (s && s.id === 10 ? s.count : 0), 0));
  await Promise.all([
    v(host, (g, k) => g.entities.onPickup(g.mp.items.byKey.get(k)), key),
    v(client, (g, k) => g.entities.onPickup(g.mp.items.byKey.get(k)), key),
  ]);
  const gone = await until(host, (g, k) => !g.mp.items.byKey.has(k), 10000, key);
  const gone2 = await until(client, (g, k) => !g.mp.items.byKey.has(k), 10000, key);
  assert(gone && gone2, "the stack is still lying around");
  await sleep(500);
  const hostGot = (await v(host, (g) => g.inventory.slots.reduce((n, s) => n + (s && s.id === 10 ? s.count : 0), 0))) - hostBefore;
  const clientGot = (await v(client, (g) => g.inventory.slots.reduce((n, s) => n + (s && s.id === 10 ? s.count : 0), 0))) - clientBefore;
  assert(hostGot + clientGot === 5 && (hostGot === 0 || clientGot === 0), `host got ${hostGot}, client got ${clientGot}`);
});

await check("the host's UFO appears on the client (a puppet, where the host has it)", async () => {
  const cpos = await v(client, (g) => g.player.position.toArray());
  hostUfoId = await v(host, (g, cp) => {
    g.ufos.config.activity = 0;
    for (const u of [...g.ufos.ufos]) u.state = "gone";
    // Straight above the client (nothing in the way of the shot), out of reach of the ground.
    const top = g.world.surfaceY(Math.floor(cp[0]), Math.floor(cp[2]));
    const u = g.ufos.spawn({ size: "small", pos: new g.THREE.Vector3(cp[0] + 4, Math.max(cp[1], top) + 16, cp[2] + 3) });
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
  // The client aims at the puppet and fires the real pistol (a few times if
  // a shot goes wide: the ship drifts a little while it hovers).
  let after = null;
  for (let k = 0; k < 4 && !after; k++) {
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
    after = await until(host, (g, a) => {
      const u = g.ufos.ufos.find((x) => x.id === a.id);
      return u && u.health < a.before && { health: u.health, by: u.lastHitPid };
    }, 5000, { id: hostUfoId, before });
  }
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
  // (Round 8: its state is never shown wrong: no "dead" pose while it walks and attacks.)
  await client.evaluate((id) => {
    const g = window.__ufo;
    window.__deadSeen = 0;
    const f = () => {
      const m = g.mp.entities.mobById.get(id);
      if (m && m.dead) window.__deadSeen++;
      if (!window.__stopDeadWatch) requestAnimationFrame(f);
    };
    requestAnimationFrame(f);
  }, zid);
  const hurt = await until(client, (g) => g.player.health < 20 && g.player.health, 25000);
  assert(hurt, "the client was never hurt by the host's zombie");
  const deadSeen = await client.evaluate(() => {
    window.__stopDeadWatch = true;
    return window.__deadSeen;
  });
  assert(deadSeen === 0, `the client drew the living zombie dead in ${deadSeen} frames`);
  await v(host, (g, id) => {
    const m = g.mobs.mobs.find((x) => x.id === id);
    if (m) m.dead = true;
  }, zid);
});

await check("PvP: the client's shots and sword hurt the host on foot; with the host's PvP rule off they don't", async () => {
  // Both in Survival, the client a few blocks from the host, facing it.
  await v(host, (g) => {
    g.mp.rules.setMode("survival");
    if (g.player.dead) g.respawn();
    g.player.flying = false;
    g.player.health = 20;
  });
  await until(client, (g) => g.player.mode === "survival", 10000);
  // (Placed and aimed in one go, from a spot with a clear line to the host's chest.)
  const aim = `(g) => {
    if (g.player.dead) g.respawn();
    const r = g.mp.players.get(1);
    const chest = r.position.clone().add(new g.THREE.Vector3(0, 1.1, 0));
    for (const [dx, dy, dz] of [[3, 0, 0], [-3, 0, 0], [0, 0, 3], [0, 0, -3], [2.5, 1.5, 0], [-2.5, 1.5, 0], [0, 2, 2.5], [0, 2, -2.5]]) {
      g.player.position.set(r.position.x + dx, r.position.y + dy, r.position.z + dz);
      g.player.velocity.set(0, 0, 0);
      const eye = g.player.getEyePosition();
      const d = chest.clone().sub(eye);
      const len = d.length();
      if (!g.world.raycast(eye, d.clone().normalize(), len, { solidOnly: true })) break;
    }
    const eye = g.player.getEyePosition();
    const d = chest.clone().sub(eye);
    g.player.yaw = Math.atan2(-d.x, -d.z);
    g.player.pitch = Math.atan2(d.y, Math.hypot(d.x, d.z));
  }`;
  const aimAnd = (body) => v(client, new Function("g", `(${aim})(g); return (${body})(g);`));
  assert(await v(host, (g) => g.mp.pvp === true), "PvP is not on by default");
  await sleep(800);
  const before = await v(host, (g) => g.player.health);
  const r = await aimAnd((g) => {
    g.weapons.enabled = true;
    return g.weapons.fireSniper();
  });
  assert(r && r.type === "mob", `the sniper shot did not hit the host: ${JSON.stringify(r)}`);
  const hurt = await until(host, (g, b) => g.player.health < b || g.player.dead, 8000, before);
  assert(hurt, "the host was not hurt by the client's shot");
  // Melee: the sword (a creature hit through the same stand-in).
  await v(host, (g) => {
    if (g.player.dead) g.respawn();
    g.player.health = 20;
  });
  await sleep(1200);
  const meleeHit = await aimAnd((g) => {
    const eye = g.player.getEyePosition();
    const hit = g.mobs.raycast(eye, g.player.getForwardVector(), 6);
    return hit && hit.mob.isRemotePlayer ? g.mobs.attack(hit.mob, { type: "sword", damage: 6 }) : false;
  });
  assert(meleeHit, "the client's swing found no player");
  const meleeHurt = await until(host, (g) => g.player.health < 20 || g.player.dead, 8000);
  assert(meleeHurt, "the sword did not hurt the host");
  // The host turns PvP off (lobby checkbox): nothing hurts any more.
  await host.evaluate(() => {
    const cb = document.getElementById("mp-lobby-pvp");
    cb.checked = false;
    cb.dispatchEvent(new Event("change"));
  });
  const off = await until(client, (g) => g.mp.pvp === false, 8000);
  assert(off, "the client never got the PvP rule");
  await v(host, (g) => {
    if (g.player.dead) g.respawn();
    g.player.health = 20;
  });
  await sleep(800);
  const r2 = await aimAnd((g) => g.weapons.fireSniper());
  await sleep(1500);
  const h2 = await v(host, (g) => g.player.health);
  assert(h2 === 20 && r2.type !== "mob", `with PvP off: host ${h2}, shot ${JSON.stringify(r2)}`);
  await v(host, (g) => g.mp.rules.setPvp(true));
  await until(client, (g) => g.mp.pvp === true, 8000);
});

await check("one shared world: a supply crate and dropped items are the same for both, and only one player opens the crate", async () => {
  const id = await v(host, (g) => {
    const r = g.mp.players.get([...g.mp.players.remotes.keys()][0]);
    const c = g.crates.drop({ center: r.livePos, dist: 12 });
    return c && c.id;
  });
  assert(id, "the host could not drop a crate");
  const seen = await until(client, (g, i) => g.crates.byId(i) && g.crates.byId(i).pos.toArray(), 10000, id);
  assert(seen, "the client never saw the host's crate");
  // Both fast-forward the fall (it is the same path everywhere), the client walks up to it.
  await v(host, (g, i) => g.crates._advance(g.crates.byId(i), 60), id);
  const opened0 = await v(client, (g) => g.stats.world.cratesOpened);
  const landed = await v(client, (g, i) => {
    const c = g.crates.byId(i);
    g.crates._advance(c, 60);
    if (g.player.dead) g.respawn();
    g.player.position.set(c.pos.x + 0.5, c.pos.y, c.pos.z);
    return c.state;
  }, id);
  assert(landed === "landed", `crate state ${landed}`);
  const opened = await until(client, (g, a) => g.stats.world.cratesOpened > a.o && !g.crates.byId(a.i), 10000, { o: opened0, i: id });
  assert(opened, "the client could not open the crate");
  const goneOnHost = await until(host, (g, i) => !g.crates.byId(i) || g.crates.byId(i).state === "gone", 8000, id);
  assert(goneOnHost, "the crate is still there on the host");
  // An item that drops on the host (a broken block) shows up for the client too.
  const key = await v(host, (g) => {
    const p = g.player.position;
    const it = g.entities.spawn(12, 2, new g.THREE.Vector3(p.x + 40, p.y + 1, p.z));
    return it && it.shared;
  });
  assert(key, "the host's dropped item is not shared");
  const there = await until(client, (g, k) => g.mp.items.byKey.has(k), 8000, key);
  assert(there, "the client never saw the host's dropped item");
});

await check("Survival together: the client follows the host's mission, and a finished mission rewards both", async () => {
  await v(host, (g) => {
    g.testFlags.noMissions = false;
    g.setMode("survival");
  });
  const step = await v(host, (g) => g.progress.step);
  const seen = await until(client, (g, s) => g.progress.step === s && g.progress.objectives(g.stats.world).length > 0 && g.progress.objectives(g.stats.world)[0].label, 15000, step);
  assert(seen, `the client never showed mission ${step + 1}`);
  const rewardId = await v(client, (g) => g.progress.mission.reward[0][0]);
  const before = await v(client, (g, id) => g.inventory.slots.reduce((n, s) => n + (s && s.id === id ? s.count : 0), 0), rewardId);
  // The host's group finishes the objective (another player's kill counts for the world).
  await v(host, (g) => {
    for (const o of g.progress.mission.objectives) g.stats.addWorld(o.stat, g.progress.goalFor(o));
  });
  const got = await until(client, (g, a) => {
    const n = g.inventory.slots.reduce((k, s) => k + (s && s.id === a.id ? s.count : 0), 0);
    return n > a.before && n;
  }, 15000, { id: rewardId, before });
  assert(got, "the client got no reward");
  const next = await until(client, (g, s) => g.progress.step === s + 1, 10000, step);
  assert(next, "the client did not move on to the next mission");
});

await check("co-op scaling: goals grow with the group (2 aliens each), the supply mission drops a crate for each player", async () => {
  // The supply mission: one crate per player, near each.
  const r = await v(host, (g) => {
    const idx = g.MISSIONS.findIndex((m) => m.id === "supply");
    g.progress.step = idx;
    g.progress.start(g.stats.world);
    g.crates.clear();
    return { goal: g.progress.objectives(g.stats.world)[0].goal, n: g.progress.groupN };
  });
  assert(r.n === 2 && r.goal === 2, `supply goal ${JSON.stringify(r)}`);
  const crates = await until(host, (g) => g.crates.active.length >= 2 && g.crates.active.length, 15000);
  assert(crates === 2, `the host dropped ${crates} crates`);
  const seen = await until(client, (g) => g.crates.active.length === 2 && g.progress.objectives(g.stats.world)[0]?.goal === 2, 15000);
  assert(seen, "the client does not see both crates and a goal of 2");
  // Each crate came down near a different player.
  const near = await v(host, (g) => {
    const r = g.mp.players.get([...g.mp.players.remotes.keys()][0]);
    const ps = [g.player.position, r.livePos];
    return ps.map((p) => Math.min(...g.crates.active.map((c) => Math.hypot(c.x - p.x, c.z - p.z))));
  });
  assert(near.every((d) => d < 260), `crate distances ${near}`);
  // The landing mission: 2 aliens per player.
  const g2 = await v(host, (g) => {
    g.crates.clear();
    const idx = g.MISSIONS.findIndex((m) => m.id === "landing");
    g.progress.step = idx;
    g.progress.start(g.stats.world);
    return g.progress.objectives(g.stats.world)[0].goal;
  });
  assert(g2 === 4, `landing goal ${g2}`);
  const cg = await until(client, (g) => g.progress.objectives(g.stats.world)[0]?.goal === 4, 10000);
  assert(cg, "the client's tracker does not show 4");
});

await check("only the host picks the mode: Creative for everyone, a guest can't change it", async () => {
  await v(host, (g) => g.mp.rules.setMode("creative"));
  const c = await until(client, (g) => g.player.mode === "creative" && g.mp.mode === "creative", 10000);
  assert(c, "the client did not switch to Creative");
  // The guest's pause-menu mode switch is locked, and trying it changes nothing.
  const r = await v(client, (g) => {
    const sel = document.getElementById("pause-mode-select");
    sel.value = "survival";
    sel.dispatchEvent(new Event("change"));
    return { disabled: sel.disabled, mode: g.player.mode, hostRules: !!g.settingsPanel.hostRules };
  });
  assert(r.disabled && r.mode === "creative" && r.hostRules, JSON.stringify(r));
  const h = await v(host, (g) => g.player.mode);
  assert(h === "creative", `host mode ${h}`);
  await v(host, (g) => g.mp.rules.setMode("survival"));
  const back = await until(client, (g) => g.player.mode === "survival", 10000);
  assert(back, "the client did not switch back to Survival");
});

await check("vehicles: the client climbs into the host's empty UFO (a claim), flies it, and the host sees it move", async () => {
  await v(host, (g) => g.mp.rules.setMode("creative"));
  await until(client, (g) => g.player.mode === "creative", 10000);
  const cpos = await v(client, (g) => g.player.position.toArray());
  const nid = await v(host, (g, cp) => {
    const top = g.world.surfaceY(Math.floor(cp[0]) + 6, Math.floor(cp[2]));
    const v = g.vehicles.create("ufo", { design: "saucer", seed: 7, radius: 4, pos: [cp[0] + 6, top + 4, cp[2]], yaw: 0 });
    return v ? "pending" : null;
  }, cpos);
  assert(nid, "the host could not make a UFO");
  // (Shared on the host's next update.)
  const id = await until(host, (g) => g.vehicles.vehicles.find((v) => v.type === "ufo" && v.net && !v.puppet && v.radius === 4)?.net.nid, 10000);
  assert(id, "the host's UFO was not shared");
  const puppet = await until(client, (g, n) => {
    const v = g.mp.vehicles.byNid(n);
    return v && v.puppet && v.pos.toArray();
  }, 15000, id);
  assert(puppet, "the client never got the UFO");
  // Next to it, F.
  const asked = await v(client, (g, n) => {
    if (g.player.dead) g.respawn();
    const v = g.mp.vehicles.byNid(n);
    g.player.position.set(v.pos.x + 2, v.pos.y - v.bottom, v.pos.z);
    g.player.flying = true;
    const near = g.vehicles.nearestEnterable();
    g.vehicles.toggle();
    return { asked: !!g.mp.vehicles.pendingClaim, near: near === v, dead: g.player.dead, active: !!g.vehicles.active, unusable: v.unusable, occ: v.netOcc, enabled: g.vehicles.enabled };
  }, id);
  if (!asked.asked) {
    const hs = await v(host, (g, n) => {
      const v = g.mp.vehicles.byNid(n);
      return { state: g.mp.vehicles._state(v), active: g.vehicles.active?.net?.nid ?? g.vehicles.active?.type ?? null, puppet: v.puppet };
    }, id);
    const cs = await v(client, (g, n) => {
      const v = g.mp.vehicles.byNid(n);
      return { last: v.interp.last, buf: v.interp.buf.length };
    }, id);
    console.log("DEBUG", JSON.stringify(hs), JSON.stringify(cs));
  }
  assert(asked.asked, `boarding did not ask the host: ${JSON.stringify(asked)}`);
  const inIt = await until(client, (g, n) => g.vehicles.active && g.vehicles.active.net?.nid === n && !g.vehicles.active.puppet, 15000, id);
  assert(inIt, "the client is not flying the UFO");
  const hostSide = await until(host, (g, n) => {
    const v = g.mp.vehicles.byNid(n);
    return v && v.puppet && v.netOcc && v.netOcc;
  }, 10000, id);
  const bob = await v(client, (g) => g.net.pid);
  assert(hostSide === bob, `on the host the UFO is flown by ${hostSide}`);
  const target = await v(client, (g) => {
    const v = g.vehicles.active;
    v.pos.x += 25;
    v.pos.y += 6;
    return v.pos.toArray();
  });
  const moved = await until(host, (g, a) => {
    const v = g.mp.vehicles.byNid(a.n);
    return v && v.pos.distanceTo(new g.THREE.Vector3(...a.t)) < 1.5;
  }, 15000, { n: id, t: target });
  assert(moved, "the host never saw the UFO move");
  // Out again (it stays the client's, parked).
  await v(client, (g) => g.vehicles.exit());
  await v(host, (g) => g.mp.rules.setMode("survival"));
});

await check("Dogfight: everyone in a jet, PvP hits, kills and deaths on the scoreboard, a winner and a loser", async () => {
  // The host picks Dogfight and a death limit of 3 in the Multiplayer screen (the real controls).
  await host.evaluate(() => {
    const ui = window.__ufo.mp.ui;
    ui.open();
    const deaths = document.getElementById("mp-lobby-deaths");
    deaths.value = "3";
    deaths.dispatchEvent(new Event("change"));
    const mode = document.getElementById("mp-lobby-mode");
    mode.value = "dogfight";
    mode.dispatchEvent(new Event("change"));
  });
  await play(host);
  await play(client);
  const inJets = await until(client, (g) => g.mp.mode === "dogfight" && g.vehicles.active?.type === "jet" && g.mp.dogfight.phase === "live" && g.mp.dogfight.deathLimit === 3, 30000);
  assert(inJets, "the client is not in a jet in a live dogfight");
  const hostJet = await until(host, (g) => g.vehicles.active?.type === "jet" && g.mp.dogfight.phase === "live", 20000);
  assert(hostJet, "the host is not in a jet");
  const bob = await v(client, (g) => g.net.pid);
  // The host shoots the client's jet down, three times (each time the client is back in a jet after 3 s).
  for (let round = 1; round <= 3; round++) {
    const ok = await until(host, (g, pid) => {
      const r = g.mp.players.get(pid);
      const v = r?.vehicle;
      if (!v || !v.alive || !v.puppet) return false;
      // Cannon-like hits (the shooter's call, sent to the owner).
      for (let k = 0; k < 6; k++) v.damage(60, "player", true);
      return true;
    }, 20000, bob);
    assert(ok, `round ${round}: the host could not find the client's jet`);
    const deaths = await until(host, (g, a) => (g.mp.dogfight.scores.get(a.pid)?.d ?? 0) >= a.round && g.mp.dogfight.scores.get(a.pid).d, 20000, { pid: bob, round });
    assert(deaths, `round ${round}: the client's death was not counted`);
    if (round < 3) {
      const back = await until(client, (g) => !g.player.dead && g.vehicles.active?.type === "jet" && g.vehicles.active.alive, 20000);
      assert(back, `round ${round}: the client was not put back in a jet`);
    }
  }
  const scores = await v(host, (g, pid) => ({ host: g.mp.dogfight.scores.get(1), bob: g.mp.dogfight.scores.get(pid), phase: g.mp.dogfight.phase, winner: g.mp.dogfight.winner }), bob);
  assert(scores.host.k === 3 && scores.bob.d === 3 && scores.bob.out, JSON.stringify(scores));
  assert(scores.phase === "over" && scores.winner === 1, JSON.stringify(scores));
  // Everyone sees the end: the client its defeat, the host its victory.
  const cres = await until(client, () => !document.getElementById("mp-results").classList.contains("hidden") && document.getElementById("mp-result-big").textContent, 15000);
  const hres = await until(host, () => !document.getElementById("mp-results").classList.contains("hidden") && document.getElementById("mp-result-big").textContent, 15000);
  assert(cres === "DEFEAT" && hres === "VICTORY", `client ${cres}, host ${hres}`);
  // The client's scoreboard shows the same numbers.
  const board = await v(client, (g, pid) => ({ host: g.mp.dogfight.scores.get(1), me: g.mp.dogfight.scores.get(pid) }), bob);
  assert(board.host.k === 3 && board.me.d === 3, JSON.stringify(board));
  // (Round 8) The mouse is free for the results: no pointer lock, no pause menu over them,
  // and a real click on the buttons works (Playwright clicks only what is on top).
  for (const [page, name] of [[host, "host"], [client, "client"]]) {
    const st = await page.evaluate(() => ({ lock: !!document.pointerLockElement, pause: !document.getElementById("pause-menu").classList.contains("hidden"), state: window.__ufo.gameState }));
    assert(!st.lock && !st.pause && st.state !== "playing", `${name}: ${JSON.stringify(st)}`);
  }
  await client.click("#mp-result-close", { timeout: 5000 });
  assert(await client.evaluate(() => document.getElementById("mp-results").classList.contains("hidden")), "Close did not close the results");
});

await check("a client leaving: the host drops it; joining again (same nickname) brings its things back", async () => {
  await v(host, (g) => {
    g.mp.dogfight.closeResults();
    g.mp.rules.setMode("survival");
  });
  await until(client, (g) => g.mp.mode === "survival" && !g.vehicles.active, 15000);
  // Something to recognise: a stack of 7 cobblestone in the last hotbar slot.
  const marker = await v(client, (g) => {
    if (g.player.dead) g.respawn();
    g.inventory.slots[8] = { id: 10, count: 7 };
    g.mp.game.markInventoryChanged();
    // (The host is sent a guest's things every few seconds; leaving sends nothing more.)
    g.net.toHost({ t: "pdata", d: g.mp.game.playerData() });
    return g.inventory.slots[8];
  });
  await sleep(1500);
  // Leaving takes the guest back to its own single-player page.
  await Promise.all([client.waitForURL((u) => !u.searchParams.has("join"), { timeout: 30000 }), client.evaluate(() => window.__ufo.mp.leave())]);
  await client.waitForFunction(() => !!window.__ufo, null, { timeout: 90000 });
  assert(!(await v(client, (g) => g.mp.active)), "the guest's own page is not online");
  const gone = await until(host, (g) => g.net.playerCount === 1 && g.mp.players.remotes.size === 0, 15000);
  assert(gone, "the host still has the client");
  // Back again, from the invite link, with the same nickname.
  await client.goto(`http://127.0.0.1:${PORT}/index.html?join=${code}&${NET_Q}`, { waitUntil: "load", timeout: 60000 });
  await client.waitForSelector("#mp-join-boot:not(.hidden)", { timeout: 30000 });
  assert((await client.inputValue("#mp-boot-nick")) === "Bob", "the nickname is remembered");
  await client.click("#mp-boot-join");
  await client.waitForFunction(() => window.__ufo?.graphicsReady && window.__ufo.mp.stateLoaded, null, { timeout: 120000 });
  const back = await v(client, (g) => g.inventory.slots[8]);
  assert(back && back.id === marker.id && back.count === 7, `inventory slot 9 after rejoining: ${JSON.stringify(back)}`);
  const h = await until(host, (g) => g.net.playerCount === 2, 15000);
  assert(h, "the host does not see the client again");
});

await check("the host leaving: the client is told, and can go back to its own world", async () => {
  await play(client);
  await host.evaluate(() => window.__ufo.mp.leave());
  await client.waitForSelector("#mp-ended:not(.hidden)", { timeout: 30000 });
  const title = await client.textContent("#mp-ended-title");
  assert(/host left/i.test(title), title);
  const r = await v(client, (g) => ({ active: g.mp.active, remotes: g.mp.players.remotes.size }));
  assert(!r.active && r.remotes === 0, JSON.stringify(r));
  const hostAlone = await v(host, (g) => ({ active: g.mp.active, remotes: g.mp.players.remotes.size }));
  assert(!hostAlone.active && hostAlone.remotes === 0, JSON.stringify(hostAlone));
});

// ---------- Summary ----------
const failed = results.filter(([, ok]) => !ok);
console.log(`\n${results.length - failed.length}/${results.length} multiplayer checks passed`);
if (errors.length) console.log(`Console errors:\n  ${errors.slice(0, 10).join("\n  ")}`);
await browser.close();
server.close();
peerHttp.close();
process.exit(failed.length || errors.length ? 1 : 0);
