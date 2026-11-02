// Round 15 "anywhere" tests: every vehicle enterable (the parked AA vehicle,
// js/tanks.js ParkedAA, driven and fired), and vehicles in every dimension
// (js/vehicles.js switchDim, js/dimensions.js, js/net/vehicles.js).
// In Node (fast): the Creative item (the Battle Tank sneaking is the AA).
// In the browser (a Missions world): the parked AA is boarded (F), drives,
// its radar locks a UFO, the cannons fire (heat) and a SAM hits it; in the
// Nether a tank is summoned and driven, a jet summoned into the air flies,
// one parked on the ground; back in the Overworld the Nether's vehicles wait
// aside and the AA is back; in the Nether again they are where they were; a
// save and reload in the Nether keeps both dimensions' vehicles. With
// --online: a guest in the Nether sees the host's Nether jet (and in the
// Overworld does not).
//
//   node r15-anywhere-tests.mjs [--only=substring] [--node] [--online]
// (GAME_ROOT=dir runs another copy of the game: one with the main.js patch.)
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

// ---------- Node ----------

await check("the Creative item: the Battle Tank placed sneaking is the AA vehicle", async () => {
  const V = await imp("js/content/vehicles.js");
  const { LIB } = await imp("js/content/base.js");
  const seen = [];
  const prev = LIB.summonVehicle;
  LIB.summonVehicle = (ctx, key) => (seen.push(key), true);
  try {
    V.itemUse[V.MBT_ITEM]({ sneaking: true });
    V.itemUse[V.MBT_ITEM]({ sneaking: false });
    V.itemUse[V.TIGER_ITEM]({ sneaking: true });
  } finally {
    LIB.summonVehicle = prev;
  }
  assert(seen.join() === "aa,mbt,tiger", `summoned: ${seen.join()}`);
});

if (!args.node) await browserChecks();

async function browserChecks() {
  const { chromium } = await import("playwright-core");
  const PORT = 9970 + Math.floor(Math.random() * 20);
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
    executablePath: (await import("./chromium-path.mjs")).default,
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
    while (Date.now() - t0 < 300000) {
      const st = await v(p, (g) => g.gameState);
      if (st === "playing") return;
      if (st === "dead") {
        await v(p, (g) => g.respawn());
        continue;
      }
      const click = (sel) => p.evaluate((s) => document.querySelector(s)?.click(), sel).catch(() => {});
      if (st === "start") await click("#play-btn");
      else if (await p.isVisible("#resume-btn")) await click("#resume-btn");
      else if (await p.isVisible("#click-to-play").catch(() => false)) await click("#click-to-play");
      else {
        await p.mouse.click(300, 200);
        await frames(p, 5);
      }
      await frames(p, 3);
    }
    throw new Error("the game didn't start playing");
  }
  async function travel(p, dim, x, y, z) {
    const ok = await v(p, (g, a) => g.dims.travel(a[0], a[1], a[2], a[3]), [dim, x, y, z]);
    assert(ok, `the travel to ${dim} was refused`);
    assert(await until(p, (g) => !g.dims.pending, 90000), `the travel to ${dim} never ended`);
    await frames(p, 2);
  }
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
  // A big open room round the player (a stone floor, 34 blocks of air over it,
  // 150 ahead of them, -z), the chunks loaded first: an Overworld field, a
  // Nether cavern.
  const ROOM = `async (g) => {
    const p = g.player;
    const x0 = Math.floor(p.position.x), z0 = Math.floor(p.position.z);
    for (let i = 0; i < 200; i++) { let ok = true; for (let z = z0 - 150; z <= z0 + 20; z += 16) for (let x = x0 - 30; x <= x0 + 30; x += 16) if (!g.world.getChunk(x >> 4, z >> 4)) ok = false; if (ok) break; await new Promise((r) => setTimeout(r, 300)); }
    const y = g.world.dimInfo?.ceiling ? 50 : 90;
    const list = [];
    for (let x = x0 - 30; x <= x0 + 30; x++) for (let z = z0 - 150; z <= z0 + 20; z++) { list.push(x, y - 1, z, 1); for (let k = 0; k < 34; k++) list.push(x, y + k, z, 0); }
    g.world.setBlocks(list);
    for (const v of [...g.vehicles.vehicles]) if (v.npc) g.vehicles.remove(v);
    p.position.set(x0 + 0.5, y + 0.05, z0 + 0.5);
    p.velocity.set(0, 0, 0);
    p.yaw = 0;
    p.pitch = 0;
    return { x0, y, z0 };
  }`;
  const room = (p) => p.evaluate((src) => new Function("g", `return (${src})(g);`)(window.__ufo), ROOM);
  const STEP = `(g, n) => { for (let i = 0; i < n; i++) { g.vehicles.update(1 / 30); g.effects.update(1 / 30); g.lasers.update(1 / 30); } }`;
  const noDraw = (g) => {
    const rr = g.renderer;
    if (rr && !rr.__noDraw) {
      rr.__noDraw = true;
      rr.render = (scene, camera) => {
        scene?.updateMatrixWorld?.();
        camera?.updateMatrixWorld?.();
      };
    }
    return true;
  };
  const SEED = 8151;
  const page = await newPage("solo");
  const soloOnly = args.only && String(args.only).includes("online");
  let f = null; // (the Overworld's room)
  let nf = null; // (the Nether's)

  if (!soloOnly) await browserCheck("boot: a Missions world; the parked AA is a vehicle to board (not unusable), its Creative summon", async () => {
    await page.goto(`http://127.0.0.1:${PORT}/index.html?seed=${SEED}&type=missions&graphics=low`, { waitUntil: "load", timeout: 60000 });
    await page.waitForFunction(() => !!window.__ufo && window.__ufo.graphicsReady, null, { timeout: 180000 });
    await play(page);
    await v(page, noDraw);
    // (Creative from the start: no UFO's or alien's shot ends the test's player.)
    await v(page, (g) => g.player.setMode("creative"));
    const r = await v(page, (g) => ({ type: !!g.vehicles.constructor.types.aapark, summon: g.vehicles.constructor.summons.aa?.type === "aapark", dims: !!g.dims?.enabled, switchDim: typeof g.vehicles.switchDim === "function" }));
    assert(Object.values(r).every(Boolean), `wired: ${JSON.stringify(r)}`);
  });

  if (!soloOnly) await browserCheck("the parked AA: F boards it, it drives; the radar locks a UFO, the cannons fire (heat), a SAM hits it", async () => {
    if (await v(page, (g) => g.player.dead)) {
      await v(page, (g) => g.respawn());
      await play(page);
    }
    f = await room(page);
    const r = await v(page, async (g, a) => {
      const step = new Function("return " + a.STEP)();
      const T = g.THREE;
      const out = {};
      g.player.setMode("creative");
      const aa = g.vehicles.create("aapark", { pos: [a.f.x0 + 0.5, a.f.y, a.f.z0 - 6], yaw: 0 });
      aa.settle(true);
      // (A base's: standing by, as tanks.js sets one out.)
      aa.parkedAt = "test";
      out.unusable = !!aa.unusable;
      out.near = g.vehicles.nearestEnterable() === aa;
      out.boarded = g.vehicles.toggle() && g.vehicles.active === aa;
      out.parkedAfter = aa.parkedAt;
      if (!out.boarded) return out;
      const z0 = aa.pos.z;
      g.player.keys.add("KeyW");
      step(g, 45);
      g.player.keys.delete("KeyW");
      step(g, 20);
      out.drove = z0 - aa.pos.z;
      // A UFO up ahead, still (its own update isn't run here).
      const at = new T.Vector3(aa.pos.x + 6, aa.pos.y + 70, aa.pos.z - 120);
      const u = g.ufos.spawn({ size: "small", design: "saucer", pos: at.clone(), hidden: false });
      u.pos.copy(at);
      // (Tough: the cannons mustn't bring it down before the SAM gets there.)
      u.health = u.maxHealth = 5000;
      const hp0 = u.health;
      const d = at.clone().sub(aa.pos);
      aa.lookYaw = Math.atan2(-d.x, -d.z);
      aa.lookPitch = Math.atan2(d.y, Math.hypot(d.x, d.z)) + 0.12;
      step(g, 40);
      out.lock = aa.lock?.kind || null;
      const fired0 = g.lasers.fired;
      g.vehicles.input.buttons[0] = true;
      step(g, 30);
      g.vehicles.input.buttons[0] = false;
      out.rounds = g.lasers.fired - fired0;
      out.heat = Math.round(aa.heat * 100) / 100;
      // A SAM.
      const hpGun = u.health;
      g.vehicles.mouseDown(2);
      step(g, 1);
      g.vehicles.mouseUp(2);
      out.sams = aa.sams;
      out.inFlight = aa.missiles.length;
      for (let i = 0; i < 400 && aa.missiles.length; i++) step(g, 1);
      out.left = aa.missiles.length;
      out.hurt = hp0 - (u.state === "gone" ? 0 : u.health);
      out.sam = hpGun - (u.state === "gone" ? 0 : u.health);
      out.hud = aa.hud().rows.map((r) => r.join(": ")).join(" | ");
      g.vehicles.exit({ force: true });
      out.out = !g.vehicles.active;
      out.id = aa.id;
      return out;
    }, { f, STEP });
    assert(!r.unusable && r.near && r.boarded && r.parkedAfter == null, `boarding: ${JSON.stringify(r)}`);
    assert(r.drove > 2, `it didn't drive: ${JSON.stringify(r)}`);
    assert(r.lock === "ufo", `no lock on the UFO: ${JSON.stringify(r)}`);
    assert(r.rounds >= 8 && r.heat > 0.1, `the cannons: ${JSON.stringify(r)}`);
    assert(r.sams === 3 && r.inFlight === 1 && r.left === 0 && r.hurt > 0 && r.sam >= 100, `the SAM: ${JSON.stringify(r)}`);
    assert(r.out, "couldn't get out");
    f.aa = r.id;
  });

  if (!soloOnly) await browserCheck("the Nether: a tank summoned and driven, a jet summoned into the air flies, one parked; all the Nether's", async () => {
    assert(f, "no Overworld room");
    await travel(page, "nether", f.x0 + 0.5, 60, f.z0 + 0.5);
    nf = await room(page);
    const r = await v(page, async (g, a) => {
      const step = new Function("return " + a.STEP)();
      const out = { dim: g.dims.dim, enabled: g.vehicles.enabled, away: g.vehicles.away };
      out.owHere = g.vehicles.vehicles.some((x) => x.id === a.aa);
      out.owAside = g.vehicles.elsewhere.some((x) => x.id === a.aa && x.dim === "overworld" && !x.root.parent);
      g.player.setMode("creative");
      out.refusal = g.vehicles.summonRefusal();
      // A tank, on the cavern's floor ahead.
      const t = g.vehicles.summonOnGround("mbt", { x: a.nf.x0 + 0.5, y: a.nf.y, z: a.nf.z0 - 14 });
      out.tank = t ? t.dim : null;
      if (!t) return out;
      g.vehicles.enter(t);
      const tz = t.pos.z;
      g.player.keys.add("KeyW");
      step(g, 45);
      g.player.keys.delete("KeyW");
      step(g, 20);
      out.tankDrove = tz - t.pos.z;
      g.vehicles.exit({ force: true });
      // A jet into the air: it flies down the cavern.
      g.player.position.set(a.nf.x0 + 0.5, a.nf.y + 0.05, a.nf.z0 + 0.5);
      g.player.yaw = 0;
      const j = g.vehicles.summonInAir("f16");
      out.jet = j ? { dim: j.dim, y: Math.round(j.pos.y - a.nf.y), active: g.vehicles.active === j } : null;
      if (!j) return out;
      const jz = j.pos.z;
      step(g, 20);
      out.jetFlew = Math.round(jz - j.pos.z);
      out.jetAlive = j.alive;
      g.vehicles.exit({ force: true });
      g.vehicles.remove(j);
      // One parked on the floor (to find again).
      g.player.position.set(a.nf.x0 + 0.5, a.nf.y + 0.05, a.nf.z0 + 0.5);
      const pj = g.vehicles.summonOnGround("f16", { x: a.nf.x0 + 0.5, y: a.nf.y, z: a.nf.z0 - 60 });
      out.parked = pj ? pj.dim : null;
      out.ids = [t.id, pj?.id];
      out.pos = [t.pos.toArray(), pj?.pos.toArray()];
      return out;
    }, { nf, STEP, aa: f.aa });
    assert(r.dim === "nether" && r.enabled && r.away && !r.owHere && r.owAside && r.refusal === null, `in the Nether: ${JSON.stringify(r)}`);
    assert(r.tank === "nether" && r.tankDrove > 2, `the tank: ${JSON.stringify(r)}`);
    assert(r.jet && r.jet.dim === "nether" && r.jet.active && r.jet.y > 3 && r.jet.y < 34 && r.jetFlew > 30 && r.jetAlive, `the jet: ${JSON.stringify(r)}`);
    assert(r.parked === "nether", `the parked jet: ${JSON.stringify(r)}`);
    nf.ids = r.ids;
    nf.pos = r.pos;
  });

  if (!soloOnly) await browserCheck("back in the Overworld the Nether's vehicles wait aside and the AA is back; in the Nether again they are where they were", async () => {
    assert(nf?.ids, "nothing summoned in the Nether");
    // (Where they are as the player leaves: a jet set down settles on its wheels meanwhile.)
    nf.pos = await v(page, (g, ids) => ids.map((id) => g.vehicles.vehicles.find((o) => o.id === id).pos.toArray()), nf.ids);
    nf.dbg = await v(page, (g, ids) => ids.map((id) => { const o = g.vehicles.vehicles.find((x) => x.id === id); return { t: o.type, v: o.vel.toArray().map((n) => +n.toFixed(2)), g: o.onGround, th: o.throttle }; }), nf.ids);
    await travel(page, "overworld", f.x0 + 0.5, f.y + 1, f.z0 + 3.5);
    const a =await v(page, (g, ids) => ({
      dim: g.dims.dim,
      here: g.vehicles.vehicles.filter((x) => ids.includes(x.id)).length,
      aside: g.vehicles.elsewhere.filter((x) => ids.includes(x.id) && x.dim === "nether" && !x.root.parent).length,
      aa: g.vehicles.vehicles.some((x) => x.type === "aapark" && x.root.parent && x.root.visible),
    }), nf.ids);
    assert(a.dim === "overworld" && a.here === 0 && a.aside === 2 && a.aa, `the Overworld: ${JSON.stringify(a)}`);
    await travel(page, "nether", nf.x0 + 0.5, nf.y + 1, nf.z0 + 0.5);
    const b = await v(page, (g, a) => {
      const out = { aaAside: g.vehicles.elsewhere.some((x) => x.type === "aapark") };
      out.back = a.ids.map((id, i) => {
        const x = g.vehicles.vehicles.find((o) => o.id === id);
        return x ? Math.hypot(x.pos.x - a.pos[i][0], x.pos.y - a.pos[i][1], x.pos.z - a.pos[i][2]) : -1;
      });
      return out;
    }, nf);
    assert(b.aaAside && b.back.every((d) => d >= 0 && d < 1), `in the Nether again: ${JSON.stringify(b)} ${JSON.stringify(nf.dbg)}`);
  });

  if (!soloOnly) await browserCheck("a save and reload in the Nether keeps both dimensions' vehicles", async () => {
    assert(nf?.ids, "nothing summoned in the Nether");
    const saved = await v(page, (g, seed) => {
      g.flushSave(true);
      const key = Object.keys(localStorage).find((k) => k.includes("_player_") && k.endsWith(String(seed)));
      const pl = key ? JSON.parse(localStorage.getItem(key)) : null;
      return { key, dim: pl?.dim, list: (pl?.vehicles?.list || []).map((d) => `${d.type}:${d.dim || "-"}`) };
    }, SEED);
    assert(saved.dim === "nether" && saved.list.includes("tank:nether") && saved.list.includes("jet:nether") && saved.list.includes("aapark:-"), `the save: ${JSON.stringify(saved)}`);
    await page.reload({ waitUntil: "load" });
    await page.waitForFunction(() => !!window.__ufo && window.__ufo.graphicsReady, null, { timeout: 180000 });
    await play(page);
    await v(page, noDraw);
    const r = await v(page, (g) => ({
      dim: g.dims.dim,
      here: g.vehicles.vehicles.filter((x) => x.dim === "nether" && x.root.parent).map((x) => x.type).sort().join(),
      aside: g.vehicles.elsewhere.filter((x) => x.dim === "overworld").map((x) => x.type).join(),
    }));
    assert(r.dim === "nether" && r.here === "jet,tank" && r.aside.includes("aapark"), `after the reload: ${JSON.stringify(r)}`);
    await travel(page, "overworld", f.x0 + 0.5, f.y + 1, f.z0 + 3.5);
    const back = await v(page, (g) => g.vehicles.vehicles.some((x) => x.type === "aapark") && g.vehicles.elsewhere.filter((x) => x.dim === "nether").length === 2);
    assert(back, "the Overworld's after the reload");
  });

  if (args.online) {
    const { default: express } = await import("express");
    const { ExpressPeerServer } = await import("peer");
    const PEER_PORT = PORT + 60;
    const app = express();
    const peerHttp = app.listen(PEER_PORT, "127.0.0.1");
    app.use("/ufo", ExpressPeerServer(peerHttp, { path: "/" }));
    const NET_Q = `peerServer=127.0.0.1:${PEER_PORT}/ufo&noStun=1&graphics=low`;
    await page.close();
    const host = await newPage("host", { width: 640, height: 360 });
    const guest = await newPage("guest", { width: 640, height: 360 });
    await browserCheck("online: a guest in the Nether sees the host's Nether jet; in the Overworld it waits aside", async () => {
      await host.goto(`http://127.0.0.1:${PORT}/index.html?seed=9161&type=survival&${NET_Q}`, { waitUntil: "load", timeout: 60000 });
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
      const hp = await v(host, (g) => [Math.floor(g.player.position.x), Math.floor(g.player.position.z)]);
      // The host in the Nether, a jet parked in a cavern there.
      await travel(host, "nether", hp[0] + 0.5, 60, hp[1] + 0.5);
      const hf = await room(host);
      const jet = await v(host, (g, a) => {
        g.player.setMode("creative");
        const j = g.vehicles.summonOnGround("f16", { x: a.x0 + 0.5, y: a.y, z: a.z0 - 40 });
        return j ? { dim: j.dim, pos: j.pos.toArray() } : null;
      }, hf);
      assert(jet && jet.dim === "nether", `the host's jet: ${JSON.stringify(jet)}`);
      // The guest (in the Overworld) keeps it aside.
      const aside = await until(guest, (g) => {
        const j = g.vehicles.elsewhere.find((x) => x.type === "jet" && x.puppet && x.dim === "nether");
        return j && !g.vehicles.vehicles.includes(j) && !j.root.parent ? true : null;
      }, 30000);
      assert(aside, "the guest in the Overworld doesn't keep the host's Nether jet aside");
      // The guest goes to the Nether: there it is.
      await travel(guest, "nether", hf.x0 + 0.5, hf.y + 1, hf.z0 + 3.5);
      const seen = await until(guest, (g, p) => {
        const j = g.vehicles.vehicles.find((x) => x.type === "jet" && x.puppet && x.dim === "nether");
        return j && j.root.parent ? { d: Math.hypot(j.pos.x - p[0], j.pos.z - p[2]) } : null;
      }, 30000, jet.pos);
      assert(seen && seen.d < 3, `the guest in the Nether doesn't see the host's jet: ${JSON.stringify(seen)}`);
      // Back in the Overworld: aside again.
      await travel(guest, "overworld", hp[0] + 0.5, 90, hp[1] + 0.5);
      const gone = await v(guest, () => true) && (await v(guest, (g) => !g.vehicles.vehicles.some((x) => x.type === "jet" && x.dim === "nether") && g.vehicles.elsewhere.some((x) => x.type === "jet" && x.dim === "nether")));
      assert(gone, "the guest back in the Overworld still has the Nether jet in its list");
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
