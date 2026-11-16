// Round 18 tests: shared vehicles (seats). A host and two guests in three
// headless Chromium pages, connected through the real PeerJS client and
// WebRTC data channels (a local PeerJS server, as tools/mp-tests.mjs).
//
//   node tools/r18-seats-tests.mjs [--only=substring] [--seed=42] [--verbose]
//
// Checks: the rules' defaults (team play and friendly fire on, in every
// mode); the control sequence (A in: pilot; B in: passenger; both out; B in:
// pilot; A in: passenger) in a tank, a UFO and a helicopter, every time;
// a passenger following the vehicle; the pilot's camera for "pilot's view";
// team play off refusing a seat; friendly fire hurting a teammate on foot
// and in a vehicle; a UFO with two players to the Moon and back, both
// arriving seated; the pilot leaving the game: the passenger takes over.
// Fails on any console error or page error.
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
const PORT = 9400 + Math.floor(Math.random() * 40);
const PEER_PORT = PORT + 50;
const SEED = Number(args.seed ?? 42);
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
const app = express();
const peerHttp = app.listen(PEER_PORT, "127.0.0.1");
app.use("/ufo", ExpressPeerServer(peerHttp, { path: "/" }));

const browser = await chromium.launch({
  executablePath: (await import("./chromium-path.mjs")).default,
  args: ["--use-gl=swiftshader", "--enable-webgl", "--ignore-gpu-blocklist", "--no-sandbox", "--disable-dev-shm-usage", "--disable-features=WebRtcHideLocalIpsWithMdns", "--autoplay-policy=no-user-gesture-required"],
});
const errors = [];
const results = [];
const localThreeRoot = path.join(__dirname, "node_modules", "three");
const peerjsFile = path.join(__dirname, "node_modules", "peerjs", "dist", "peerjs.min.js");

async function newPage(label) {
  const ctx = await browser.newContext({ viewport: { width: 480, height: 270 } });
  const page = await ctx.newPage();
  await page.route("https://cdn.jsdelivr.net/npm/three@0.160.0/**", (route) => {
    const rel = new URL(route.request().url()).pathname.replace("/npm/three@0.160.0/", "");
    route.fulfill({ path: path.join(localThreeRoot, rel), contentType: "text/javascript" });
  });
  await page.route("https://cdn.jsdelivr.net/npm/peerjs@1.5.4/**", (route) => route.fulfill({ path: peerjsFile, contentType: "text/javascript" }));
  page.on("console", (m) => {
    // (A page closed on purpose: its peers' lost-connection notices are expected.)
    if (m.type() === "error" && !page.closing) errors.push(`[${label}] ${m.text()}`);
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
const v = (page, fn, arg) => page.evaluate(([src, a]) => new Function("g", "arg", `return (${src})(g, arg);`)(window.__ufo, a), [fn.toString(), arg]);
async function until(page, fn, timeout = 30000, arg) {
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
    await page.mouse.click(240, 135);
    await page.waitForTimeout(300);
    if ((await v(page, (g) => g.gameState)) === "playing") return;
  }
  for (const id of ["mp-lobby", "mp-screen"]) await page.evaluate((i) => document.getElementById(i)?.classList.add("hidden"), id);
  await v(page, (g) => g.screens.closeAll());
  const st = await v(page, (g) => g.gameState);
  if (st === "playing") return;
  if (st === "paused") await page.evaluate(() => document.getElementById("pause-menu").classList.remove("hidden"));
  const btn = st === "start" ? "#play-btn" : "#resume-btn";
  await page.click(btn, { timeout: 60000 });
  await page.waitForFunction(() => window.__ufo.gameState === "playing", null, { timeout: 30000 });
}

// ---------- The room: Alice hosts, Bob and Carol join ----------
const host = await newPage("host");
await host.goto(`http://127.0.0.1:${PORT}/index.html?seed=${SEED}&${NET_Q}`, { waitUntil: "load", timeout: 60000 });
await host.waitForFunction(() => window.__ufo?.graphicsReady, null, { timeout: 120000 });
await host.click("#menu-mp-btn");
await host.fill("#mp-nick", "Alice");
await host.click("#mp-host-btn");
const code = await until(host, (g) => g.net.code, 30000);
await host.click("#mp-lobby-play");
await host.waitForFunction(() => window.__ufo.gameState === "playing", null, { timeout: 30000 });

async function join(nick) {
  const p = await newPage(nick.toLowerCase());
  await p.goto(`http://127.0.0.1:${PORT}/index.html?join=${code}&${NET_Q}`, { waitUntil: "load", timeout: 60000 });
  await p.waitForSelector("#mp-join-boot:not(.hidden)", { timeout: 30000 });
  await p.fill("#mp-boot-nick", nick);
  await p.click("#mp-boot-join");
  await p.waitForFunction(() => window.__ufo?.graphicsReady && window.__ufo.mp.stateLoaded, null, { timeout: 120000 });
  await play(p);
  return p;
}
const bob = await join("Bob");
const carol = await join("Carol");
const PID = {};
for (const [n, p] of [["host", host], ["bob", bob], ["carol", carol]]) PID[n] = await v(p, (g) => g.net.pid);
const PAGE = { host, bob, carol };
console.log(`  room ${code}: host ${PID.host}, Bob ${PID.bob}, Carol ${PID.carol}`);

// Everyone's messages (the refusals) are kept for the checks.
for (const p of [host, bob, carol]) {
  await v(p, (g) => {
    window.__msgs = [];
    const vm = g.vehicles;
    const prev = vm.onMessage;
    vm.onMessage = (t) => {
      window.__msgs.push(String(t));
      prev?.(t);
    };
    const toast = g.mp.game.toast;
    g.mp.game.toast = (t, s) => {
      window.__msgs.push(String(t));
      return toast?.(t, s);
    };
  });
}

// A quiet world: nothing spawning or attacking by itself, midday.
await v(host, (g) => {
  g.testFlags.noMissions = true;
  g.missions.enabled = false;
  g.progress.enabled = false;
  g.ufos.config.activity = 0;
  g.ufos.config.aggression = 0;
  g.ufos.rules = null;
  g.mobs.spawning = false;
  g.enemyJets.config.count = 0;
  g.sky.setHours(12);
  g.sky.locked = true;
});

await check("the rules' defaults: team play and friendly fire on for everyone, in every mode", async () => {
  for (const mode of ["survival", "creative"]) {
    await v(host, (g, m) => g.mp.rules.setMode(m), mode);
    for (const p of [host, bob, carol]) {
      const r = await until(p, (g, m) => g.mp.mode === m && { pvp: g.mp.pvp, team: g.mp.teamPlay, allowed: g.mp.pvpAllowed() }, 10000, mode);
      assert(r && r.pvp === true && r.team === true && r.allowed === true, `${p.label} in ${mode}: ${JSON.stringify(r)}`);
    }
  }
  const box = await host.evaluate(() => ({ team: document.getElementById("mp-lobby-team")?.checked, pvp: document.getElementById("mp-lobby-pvp")?.checked }));
  assert(box.team === true && box.pvp === true, `lobby: ${JSON.stringify(box)}`);
});

// (Creative from here: every vehicle unlocked for everyone.)
await v(host, (g) => g.mp.rules.setMode("creative"));
for (const p of [host, bob, carol]) await until(p, (g) => g.mp.mode === "creative" && g.player.creative, 10000);

// ---------- Helpers ----------

// The host puts a vehicle down near the spawn (Creative); returns its shared id.
async function spawnVehicle(type, data, dx = 0) {
  const nid = await v(
    host,
    (g, a) => {
      const s = g.spawn;
      const x = s.x + 12 + a.dx;
      const z = s.z + 12;
      const top = g.world.surfaceY(Math.floor(x), Math.floor(z));
      const y = Math.max(top, 64) + (a.type === "ufo" ? 6 : a.type === "heli" ? 2.5 : 1.2);
      // (Nothing in the way: a clear box of air over flat ground.)
      for (let i = -6; i <= 6; i++) for (let k = -6; k <= 6; k++) for (let j = 1; j < 14; j++) g.world.setBlock(Math.floor(x) + i, Math.floor(y - 1.2) + j, Math.floor(z) + k, 0);
      const v = g.vehicles.create(a.type, { ...a.data, pos: [x, y, z], yaw: 0 });
      v.summoned = false;
      v.keep = true;
      window.__lastV = v;
      return true;
    },
    { type, data, dx }
  );
  assert(nid, "no vehicle");
  const id = await until(host, () => window.__lastV?.net?.nid, 10000);
  assert(id, "the vehicle never got a shared id");
  for (const p of [bob, carol]) assert(await until(p, (g, n) => !!g.mp.vehicles.byNid(n) && g.vehicles.vehicles.includes(g.mp.vehicles.byNid(n)), 15000, id), `${p.label} never got ${type} ${id}`);
  return id;
}

// Player `who` walks up to vehicle nid and presses F.
async function pressF(who, nid) {
  return v(PAGE[who], (g, n) => {
    const vm = g.vehicles;
    if (vm.active) return vm.toggle();
    const veh = g.mp.vehicles.byNid(n);
    if (!veh) return "none";
    const r = (veh.enterRadius ?? veh.radius) + 1.2;
    g.player.flying = g.player.creative;
    g.player.position.set(veh.pos.x + r, veh.pos.y, veh.pos.z);
    g.player.velocity.set(0, 0, 0);
    const near = vm.nearestEnterable();
    if (near !== veh) return `not near: ${near?.type} ${veh.pos.distanceTo(g.player.position).toFixed(1)} alive ${veh.alive} unusable ${veh.unusable} enabled ${vm.enabled} dead ${g.player.dead}`;
    const pre = { puppet: veh.puppet, taken: g.mp.seats.takenByOther(veh), row: g.mp.seats.rowOf(veh), active: !!vm.active, owner: veh.net?.owner };
    const ok = vm.toggle();
    return ok === true ? true : JSON.stringify(pre);
  }, nid);
}

// Where player `who` sits in nid: 0 the pilot, 1+ a passenger, -1 out.
const seatOf = (who, nid) => v(PAGE[who], (g, n) => {
  const veh = g.mp.vehicles.byNid(n);
  return g.vehicles.active && g.vehicles.active === veh ? g.vehicles.seat : -1;
}, nid);

async function waitSeat(who, nid, seat, what) {
  const ok = await until(PAGE[who], (g, a) => {
    const veh = g.mp.vehicles.byNid(a.n);
    const s = g.vehicles.active && g.vehicles.active === veh ? g.vehicles.seat : -1;
    if (s !== a.seat) return false;
    // (The pilot simulates it; a passenger has a puppet.)
    if (a.seat === 0) return !veh.puppet;
    if (a.seat > 0) return !!veh.puppet;
    return true;
  }, 15000, { n: nid, seat });
  if (!ok) {
    const st = await v(PAGE[who], (g, n) => ({ seat: g.vehicles.seat, active: g.vehicles.active?.net?.nid ?? null, puppet: g.mp.vehicles.byNid(n)?.puppet, row: g.mp.seats.rowOf(n), seq: g.mp.seats.seq, ack: g.mp.seats.ack, msgs: window.__msgs.slice(-3) }), nid);
    throw new Error(`${what}: ${who} not in seat ${seat} of ${nid}: ${JSON.stringify(st)}`);
  }
}

async function hostRow(nid, p, r) {
  const row = await until(host, (g, a) => {
    const e = g.mp.seats.rowOf(a.n);
    const pp = e?.p || 0;
    const rr = e?.r || [];
    return pp === a.p && JSON.stringify(rr) === JSON.stringify(a.r) && { p: pp, r: rr };
  }, 10000, { n: nid, p, r });
  if (!row) throw new Error(`host's row for ${nid}: ${JSON.stringify(await v(host, (g, n) => g.mp.seats.rowOf(n), nid))}, wanted ${JSON.stringify({ p, r })}`);
}

// The control sequence (twice, to catch stale state): A in (pilot), B in
// (passenger), both out, B in (pilot), A in (passenger), both out.
async function controlSequence(nid, A, B) {
  for (let round = 0; round < 2; round++) {
    { const f = await pressF(A, nid); assert(!String(f).startsWith("not near") && f !== "none", `${A} could not get in: ${f} ${JSON.stringify(await v(PAGE[A], () => window.__msgs.slice(-3)))}`); }
    await waitSeat(A, nid, 0, "1. A in");
    await hostRow(nid, PID[A], []);
    const fb = await pressF(B, nid);
    assert(fb !== "none" && !String(fb).startsWith("not near"), `${B}'s F: ${fb}`);
    await waitSeat(B, nid, 1, "2. B in");
    await hostRow(nid, PID[A], [PID[B]]);
    // The passenger's panel names the pilot.
    const panel = await v(PAGE[B], (g) => g.vehicles._passengerHud(g.vehicles.active).rows[0][1]);
    const aNick = { host: "Alice", bob: "Bob", carol: "Carol" }[A];
    assert(panel === aNick, `passenger's pilot: ${panel}`);
    // 3. Both out, at the same moment.
    await Promise.all([pressF(A, nid), pressF(B, nid)]);
    await waitSeat(A, nid, -1, "3. A out");
    await waitSeat(B, nid, -1, "3. B out");
    await hostRow(nid, 0, []);
    await sleep(300);
    // 4. B in: the pilot now.
    assert(!String(await pressF(B, nid)).startsWith("not near"), `${B} not near`);
    await waitSeat(B, nid, 0, "4. B in");
    await hostRow(nid, PID[B], []);
    // 5. A in: a passenger.
    assert(!String(await pressF(A, nid)).startsWith("not near"), `${A} not near`);
    await waitSeat(A, nid, 1, "5. A in");
    await hostRow(nid, PID[B], [PID[A]]);
    // (Everyone agrees on who flies it.)
    for (const p of ["host", "bob", "carol"]) {
      const pilot = await until(PAGE[p], (g, a) => g.mp.seats.pilotOf(a.n) === a.p, 8000, { n: nid, p: PID[B] });
      assert(pilot, `${p} doesn't know ${B} flies it`);
    }
    await Promise.all([pressF(A, nid), pressF(B, nid)]);
    await waitSeat(A, nid, -1, "out A");
    await waitSeat(B, nid, -1, "out B");
    await hostRow(nid, 0, []);
    await sleep(300);
  }
}

await check("seats: a tank: A in (pilot), B in (passenger), both out, B in (pilot), A in (passenger), every time (host and a guest)", async () => {
  const nid = await spawnVehicle("tank", { kind: "mbt" }, 0);
  await controlSequence(nid, "host", "bob");
});

await check("seats: a UFO, the same sequence between two guests", async () => {
  const nid = await spawnVehicle("ufo", { design: "saucer", seed: 3, radius: 7 }, 30);
  await controlSequence(nid, "bob", "carol");
});

await check("seats: a helicopter, the same sequence (a guest and the host)", async () => {
  const nid = await spawnVehicle("heli", { kind: "apache" }, 60);
  await controlSequence(nid, "carol", "host");
});

await check("seat counts: a jet 1 (F-22) or 2 (SR-71, B-2), a helicopter 4+, a tank 3, the rocket 4+, UFOs by size", async () => {
  const r = await v(host, async (g) => {
    const { seatCount } = await import("./js/vehicles.js");
    const make = (t, d) => {
      const veh = g.vehicles.create(t, { ...d, pos: [0, 200, 0] });
      const n = seatCount(veh);
      g.vehicles.remove(veh);
      return n;
    };
    return { f22: make("jet", { jetType: "f22" }), sr71: make("jet", { jetType: "sr71" }), b2: make("jet", { jetType: "b2" }), apache: make("heli", { kind: "apache" }), hawk: make("heli", { kind: "blackhawk" }), tank: make("tank", { kind: "tiger" }), small: make("ufo", { design: "saucer", radius: 4 }), big: make("ufo", { design: "saucer", radius: 12 }), rocket: make("rocket", {}) };
  });
  assert(r.f22 === 1 && r.sr71 === 2 && r.b2 === 2 && r.apache >= 4 && r.hawk >= 4 && r.tank === 3 && r.rocket >= 3 && r.small >= 2 && r.big > r.small, JSON.stringify(r));
});

let ufo = null;
await check("a passenger rides along: the seat follows the pilot's UFO, the pilot's view comes with it, F gets out", async () => {
  ufo = await spawnVehicle("ufo", { design: "saucer", seed: 5, radius: 7 }, 90);
  await pressF("bob", ufo);
  await waitSeat("bob", ufo, 0, "Bob in");
  await pressF("carol", ufo);
  await waitSeat("carol", ufo, 1, "Carol in");
  const to = await v(bob, (g) => {
    const u = g.vehicles.active;
    u.pos.x += 40;
    u.pos.y += 20;
    return u.pos.toArray();
  });
  const follow = await until(carol, (g, t) => {
    const u = g.vehicles.active;
    if (!u) return false;
    const d = u.pos.distanceTo(new g.THREE.Vector3(...t));
    const me = g.player.position.distanceTo(u.pos);
    return d < 3 && me < u.radius + 2 && { d, me };
  }, 15000, to);
  assert(follow, "the passenger never followed the UFO");
  // The pilot's view: the pilot's camera arrives with the states.
  const view = await until(carol, (g) => {
    const vm = g.vehicles;
    while (vm.passCam !== 1) vm.cycleCamera();
    const pc = vm.active.pilotCam;
    if (!pc || performance.now() - pc.t > 1000) return false;
    vm.updateCamera(g.camera, 0.016);
    return g.camera.position.distanceTo(vm.active.pos) < 80;
  }, 10000);
  assert(view, "no pilot's view");
  await v(carol, (g) => {
    g.vehicles.passCam = 0;
  });
  // A remote player in a passenger's seat: hidden, its name over the vehicle.
  const plate = await until(bob, (g, pid) => {
    const r = g.mp.players.get(pid);
    return r && r.vehicleNid && !r.avatar.root.visible;
  }, 8000, PID.carol);
  assert(plate, "Bob doesn't see Carol aboard");
  await pressF("carol", ufo);
  await waitSeat("carol", ufo, -1, "Carol out");
  const out = await v(carol, (g) => ({ veh: !!g.player.vehicle, y: g.player.position.y }));
  assert(!out.veh, JSON.stringify(out));
});

await check("team play off: no seat in someone else's vehicle (a message says why); on again: a seat", async () => {
  await v(host, (g) => {
    const cb = document.getElementById("mp-lobby-team");
    cb.checked = false;
    cb.dispatchEvent(new Event("change"));
  });
  for (const p of [bob, carol]) assert(await until(p, (g) => g.mp.teamPlay === false, 8000), `${p.label} never got team play off`);
  await v(carol, () => (window.__msgs.length = 0));
  await pressF("carol", ufo);
  await sleep(1500);
  assert((await seatOf("carol", ufo)) === -1, "Carol got in with team play off");
  let msgs = await v(carol, () => window.__msgs.slice());
  assert(msgs.some((m) => /team play is off/i.test(m)), `messages: ${JSON.stringify(msgs)}`);
  // The host refuses it too (a request that skips the check here).
  await v(carol, (g, n) => {
    window.__msgs.length = 0;
    g.mp.seats._send({ t: "vsit", n, on: 1 });
  }, ufo);
  await sleep(1500);
  msgs = await v(carol, () => window.__msgs.slice());
  assert((await seatOf("carol", ufo)) === -1 && msgs.some((m) => /team play is off/i.test(m)), `host's refusal: ${JSON.stringify(msgs)}`);
  const row = await v(host, (g, n) => g.mp.seats.rowOf(n), ufo);
  assert(row && row.p === PID.bob && row.r.length === 0, JSON.stringify(row));
  // On again.
  await v(host, (g) => g.mp.rules.setTeamPlay(true));
  assert(await until(carol, (g) => g.mp.teamPlay === true, 8000), "team play never came back on");
  await pressF("carol", ufo);
  await waitSeat("carol", ufo, 1, "Carol in (team play on)");
  await pressF("carol", ufo);
  await waitSeat("carol", ufo, -1, "Carol out");
});

await check("friendly fire: a teammate on foot is hurt by another player's shot, and a teammate's vehicle by their fire (Missions)", async () => {
  await v(host, (g) => g.mp.rules.setMode("survival"));
  for (const p of [host, carol]) assert(await until(p, (g) => g.mp.mode === "survival" && g.player.mode === "survival", 10000), `${p.label} not in survival`);
  await v(carol, (g) => {
    if (g.player.dead) g.respawn();
    g.player.health = 20;
    g.player.flying = false;
  });
  await sleep(1200);
  await v(host, (g, pid) => g.mp.pvpSync.hit(pid, 5), PID.carol);
  const hurt = await until(carol, (g) => g.player.health < 20 && g.player.health > 0, 8000);
  assert(hurt, "Carol was not hurt by Alice's shot");
  // Bob's UFO (Bob aboard), hit by Alice's weapon: the damage reaches it.
  const before = await until(bob, (g) => g.vehicles.active?.health, 5000);
  await v(host, (g, n) => g.mp.vehicles.byNid(n).damage(12, "bullet", true), ufo);
  const dmg = await until(bob, (g, b) => g.vehicles.active && g.vehicles.active.health < b, 8000, before);
  assert(dmg, "Bob's UFO took no damage from Alice");
  await v(host, (g) => g.mp.rules.setMode("creative"));
  for (const p of [host, bob, carol]) await until(p, (g) => g.mp.mode === "creative", 10000);
});

await check("travel together: a UFO with two players aboard to the Moon and back: both arrive, still seated", async () => {
  // Bob flies (seated since the last check, or again); Carol rides.
  if (!ufo) ufo = await spawnVehicle("ufo", { design: "saucer", seed: 5, radius: 7 }, 90);
  if ((await seatOf("bob", ufo)) !== 0) {
    await pressF("bob", ufo);
    await waitSeat("bob", ufo, 0, "Bob in");
  }
  await pressF("carol", ufo);
  await waitSeat("carol", ufo, 1, "Carol in");
  await v(bob, (g) => {
    const u = g.vehicles.active;
    u.vel.set(0, 0, 0);
    u.pos.y = 6100;
  });
  assert(await until(bob, (g) => g.space.busy, 20000), `Bob never went into space: ${JSON.stringify(await v(bob, (g) => ({ act: g.vehicles.active?.type, seat: g.vehicles.seat, y: g.vehicles.active?.pos.y, puppet: g.vehicles.active?.puppet, st: g.gameState, dim: g.dims.dim, vis: document.visibilityState })))}`);
  const follow = await until(carol, (g) => g.space.busy && g.space.solar.craft?.remote && { ref: g.space.solar.craft.ref }, 20000);
  assert(follow, "Carol isn't in space with Bob");
  // Carol sees the craft where Bob's machine says it is.
  await v(bob, (g) => {
    const s = g.space.solar;
    s.craft.r = s.craft.r.map((x) => x * 1.05);
  });
  await sleep(800);
  const same = await v(carol, (g) => g.space.solar.craft.r);
  const bobR = await v(bob, (g) => g.space.solar.craft.r);
  const off = Math.hypot(same[0] - bobR[0], same[1] - bobR[1], same[2] - bobR[2]);
  assert(off < 5000, `the passenger's craft is ${off} m off the pilot's`);
  // Warp with a passenger aboard: the passenger's craft is at warp too.
  await v(bob, (g) => g.space.solar.toggleWarp());
  const warp = await until(carol, (g) => g.space.solar.craft?.warpOn && g.space.solar.craft.warpK > 0, 10000);
  assert(warp, "the passenger never saw the warp");
  await v(bob, (g) => g.space.solar.dropWarp("off"));
  assert(await until(carol, (g) => !g.space.solar.craft?.warpOn, 10000), "the passenger's warp never dropped");
  // Down to the Moon (the pilot's machine decides).
  await v(bob, (g) => g.space.solar.land("moon"));
  const arrivedB = await until(bob, (g) => !g.space.busy && g.dims.dim === "moon" && g.vehicles.active?.type === "ufo" && g.vehicles.seat === 0 && !g.vehicles.active.puppet && g.vehicles.active.net?.nid, 90000);
  assert(arrivedB, `Bob didn't arrive: ${JSON.stringify(await v(bob, (g) => ({ busy: g.space.busy, dim: g.dims.dim, act: g.vehicles.active?.type })))}`);
  const arrivedC = await until(carol, (g, n) => !g.space.busy && g.dims.dim === "moon" && g.vehicles.active?.net?.nid === n && g.vehicles.seat > 0 && g.player.position.distanceTo(g.vehicles.active.pos) < 10, 90000, arrivedB);
  assert(arrivedC, `Carol didn't arrive seated: ${JSON.stringify(await v(carol, (g) => ({ busy: g.space.busy, dim: g.dims.dim, act: g.vehicles.active?.net?.nid, seat: g.vehicles.seat, pend: !!g.space.solar.pending, row: [...g.mp.seats.table] })))}`);
  await hostRow(arrivedB, PID.bob, [PID.carol]);
  // Up again and home: the Moon's space line is 3,000 up.
  await v(bob, (g) => {
    const u = g.vehicles.active;
    u.vel.set(0, 0, 0);
    u.pos.y = 3100;
  });
  assert(await until(bob, (g) => g.space.busy, 20000), "Bob never left the Moon");
  assert(await until(carol, (g) => g.space.busy && g.space.solar.craft?.remote, 20000), "Carol didn't leave the Moon with Bob");
  await v(bob, (g) => g.space.solar.land("earth"));
  const homeB = await until(bob, (g) => !g.space.busy && g.dims.dim === "overworld" && g.vehicles.active?.type === "ufo" && g.vehicles.seat === 0 && g.vehicles.active.net?.nid, 90000);
  assert(homeB, "Bob didn't get home");
  const homeC = await until(carol, (g, n) => !g.space.busy && g.dims.dim === "overworld" && g.vehicles.active?.net?.nid === n && g.vehicles.seat > 0, 90000, homeB);
  assert(homeC, "Carol didn't get home seated");
  ufo = homeB;
});

await check("a vehicle destroyed with a passenger aboard: the passenger is out (lost with it), the seats cleared", async () => {
  const nid = await spawnVehicle("tank", { kind: "tiger" }, 120);
  await pressF("bob", nid);
  await waitSeat("bob", nid, 0, "Bob in");
  await pressF("host", nid);
  await waitSeat("host", nid, 1, "Alice in");
  await v(bob, (g) => g.vehicles.destroy(g.vehicles.active, "crash"));
  await waitSeat("host", nid, -1, "Alice out");
  await waitSeat("bob", nid, -1, "Bob out");
  await hostRow(nid, 0, []);
  const r = await v(host, (g) => ({ veh: !!g.player.vehicle, seat: g.vehicles.seat }));
  assert(!r.veh && r.seat === 0, JSON.stringify(r));
  for (const p of [host, bob]) await v(p, (g) => g.player.dead && g.respawn());
});

await check("the pilot leaves the game: the passenger takes the controls (and the vehicle stays)", async () => {
  // Carol flies, Bob rides; then Carol's page closes.
  await pressF("carol", ufo); // (out)
  await pressF("bob", ufo); // (out)
  await waitSeat("bob", ufo, -1, "Bob out");
  await waitSeat("carol", ufo, -1, "Carol out");
  await hostRow(ufo, 0, []);
  await sleep(300);
  await pressF("carol", ufo);
  await waitSeat("carol", ufo, 0, "Carol in");
  await pressF("bob", ufo);
  await waitSeat("bob", ufo, 1, "Bob in");
  carol.closing = true;
  for (const p of [host, bob]) p.closing = true; // (the lost peer's notices)
  await carol.close();
  const took = await until(bob, (g, n) => g.vehicles.active?.net?.nid === n && g.vehicles.seat === 0 && !g.vehicles.active.puppet, 40000, ufo);
  assert(took, `Bob never took over: ${JSON.stringify(await v(bob, (g, n) => ({ seat: g.vehicles.seat, act: g.vehicles.active?.net?.nid, row: g.mp.seats.rowOf(n) }), ufo))}`);
  await hostRow(ufo, PID.bob, []);
  const there = await v(host, (g, n) => !!g.mp.vehicles.byNid(n), ufo);
  assert(there, "the UFO went with its pilot");
  for (const p of [host, bob]) p.closing = false;
});

const failed = results.filter(([, ok]) => !ok);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
if (errors.length) console.log(`console errors:\n  ${errors.slice(0, 10).join("\n  ")}`);
await browser.close();
server.close();
peerHttp.close();
process.exit(failed.length ? 1 : 0);
