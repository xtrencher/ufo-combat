// Round 9: the multiplayer damage matrix. A host and a guest in two headless
// pages (real PeerJS + WebRTC through a local signaling server, like
// mp-tests.mjs). For every weapon and every kind of target, the attacker
// (first the guest, then the host) fires the weapon at a target the host
// owns (or at the other player), through the game's own weapon functions
// (the same ones the mouse and keys call), and the check is that:
//   - the target takes the damage and dies (on the host, the judge),
//   - the attacker gets the kill (its own stats: aliens, soldiers, zombies,
//     skeletons, creatures, UFOs, enemy fighters, players; abductions for
//     the tractor beam),
//   - the other screen shows the same (the creature dead, the UFO falling,
//     the fighter down, the player dead with the attacker's name, the block
//     gone), and the target's health reads the same on both screens.
// Results are printed as a table (and written to tools/probe-out/
// damage-matrix.json); the run fails on any failed cell or console error.
//
//   node mp-damage-tests.mjs [--only=guest|host] [--weapon=name] [--target=name] [--verbose]
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
const app = express();
const peerHttp = app.listen(PEER_PORT, "127.0.0.1");
app.use("/ufo", ExpressPeerServer(peerHttp, { path: "/" }));

const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome",
  args: ["--use-gl=swiftshader", "--enable-webgl", "--ignore-gpu-blocklist", "--no-sandbox", "--disable-dev-shm-usage", "--disable-features=WebRtcHideLocalIpsWithMdns", "--autoplay-policy=no-user-gesture-required"],
});
const errors = [];
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
const v = (page, fn, arg) => page.evaluate(([src, a]) => new Function("g", "arg", `return (${src})(g, arg);`)(window.__ufo, a), [fn.toString(), arg]);
async function until(page, fn, timeout = 30000, arg) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeout) {
    const r = await v(page, fn, arg);
    if (r) return r;
    await new Promise((res) => setTimeout(res, 80));
  }
  return null;
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const NET_Q = `peerServer=127.0.0.1:${PEER_PORT}/ufo&noStun=1&graphics=low`;

async function play(page) {
  if ((await v(page, (g) => g.gameState)) === "playing") return;
  for (const id of ["mp-lobby", "mp-screen"]) await page.evaluate((i) => document.getElementById(i).classList.add("hidden"), id);
  await v(page, (g) => g.screens.closeAll());
  if ((await v(page, (g) => g.gameState)) === "paused") await page.evaluate(() => document.getElementById("pause-menu").classList.remove("hidden"));
  const st = await v(page, (g) => g.gameState);
  if (st === "playing") return;
  if (!(await page.isVisible("#click-to-play").catch(() => false))) {
    const btn = st === "start" ? "#play-btn" : "#resume-btn";
    await page.click(btn, { timeout: 60000 });
  } else await page.click("#click-to-play", { timeout: 20000 });
  await page.waitForFunction(() => window.__ufo.gameState === "playing", null, { timeout: 30000 });
}

// ---------- Page-side helpers (installed in both pages) ----------
function installDm() {
  const g = window.__ufo;
  const T = g.THREE;
  // No pictures are needed (the matrix checks what happens, not how it looks):
  // drawing two worlds in software slowed the game to a fifth of real time.
  // The scene's matrices still update every frame (muzzles and hit tests use them).
  const rr = g.renderer;
  if (rr && !rr.__noDraw) {
    rr.__noDraw = true;
    rr.render = (scene, camera) => {
      scene?.updateMatrixWorld?.();
      camera?.updateMatrixWorld?.();
    };
  }
  const dm = (window.__dm = { pins: [], seen: new Set(), god: true });
  // God mode for the matrix: nothing hurts this player unless it is the
  // target of a cell (then only that cell's attacker should get to it).
  const dmg = g.player.damage.bind(g.player);
  g.player.damage = (a, c, o) => (dm.god ? false : dmg(a, c, o));
  // What this page has seen die (a creature, a UFO going down, a fighter down).
  const ents = g.mp.entities;
  const driveMob = ents._driveMob.bind(ents);
  ents._driveMob = (m, dt) => {
    driveMob(m, dt);
    if (m.dead) dm.seen.add(`mob:${m.net.id}`);
    dm.lastHp = dm.lastHp || {};
    dm.lastHp[`mob:${m.net.id}`] = m.health;
  };
  const driveUfo = ents._driveUfo.bind(ents);
  ents._driveUfo = (u, dt) => {
    driveUfo(u, dt);
    if (u.falling) dm.seen.add(`ufo:${u.net.id}`);
  };
  const tick = () => {
    for (const p of dm.pins) {
      const o = p.obj;
      if (p.kind === "mob" && !o.dead) {
        o.pos.x = p.pos.x;
        o.pos.z = p.pos.z;
        if (o.pos.y < p.pos.y - 0.5) o.pos.y = p.pos.y;
        o.knock?.set?.(0, 0, 0);
      } else if (p.kind === "ufo" && !o.falling && o.state !== "gone") {
        o.pos.copy(p.pos);
        o.vel.set(0, 0, 0);
      } else if (p.kind === "jet" && o.alive && !(o.beamHeld > 0)) {
        // (Held in place, as if flying on the spot, until a tractor beam takes it.)
        o.pos.copy(p.pos);
        o.vel.set(0, 0, 0);
        o.provoked = 0;
        if (o.ai) {
          o.ai.burstT = 1e9;
          o.ai.missileT = 1e9;
        }
      } else if (p.kind === "self" && o.alive) {
        o.pos.copy(p.pos);
        o.vel.set(0, 0, 0);
      }
    }
    for (const m of g.mobs.mobs) if (m.dead) dm.seen.add(`mob:${m.net ? m.net.id : m.id}`);
    for (const u of g.ufos.ufos) if (u.falling || u.absorbed) dm.seen.add(`ufo:${u.net ? u.net.id : u.id}`);
    for (const j of g.vehicles.vehicles) if (j.isEnemyJet && !j.alive) dm.seen.add(`jet:${j.netEJ ?? j.id}`);
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);

  // Diagnostics for a failed cell: where this page's explosions went off, and
  // (the host) who last hurt each target and how.
  dm.booms = [];
  const explode = g.effects.explode.bind(g.effects);
  g.effects.explode = (pos, opts = {}) => {
    dm.booms.push({ x: Math.round(pos.x * 10) / 10, y: Math.round(pos.y * 10) / 10, z: Math.round(pos.z * 10) / 10, s: opts.source, m: !!opts.mirror });
    if (dm.booms.length > 30) dm.booms.shift();
    return explode(pos, opts);
  };
  dm.hits = {};
  const where = () => (new Error().stack || "").split("\n").slice(3, 6).map((l) => l.trim().replace(/^at /, "").replace(/\(?https?:\/\/[^/]+\/js\//, "").replace(/\)$/, "")).join(" < ");
  if (g.net.isHost) {
    const ud = g.ufos.damage.bind(g.ufos);
    g.ufos.damage = (u, amount, byPlayer = true, from = null, attacker = null) => {
      if (u?.dmTarget) dm.hits[`ufo:${u.id}`] = `${amount} ${byPlayer ? `player ${g.ufos.currentAttacker ?? 1}` : "AI"} @ ${where()}`;
      return ud(u, amount, byPlayer, from, attacker);
    };
    const mh = g.mobs._hurt.bind(g.mobs);
    g.mobs._hurt = (m, amount, dir, kb, byPlayer = false) => {
      if (m?.dmTarget) dm.hits[`mob:${m.id}`] = `${amount} ${byPlayer ? `player ${g.mobs.currentAttacker ?? 1}` : "world"} @ ${where()}`;
      return mh(m, amount, dir, kb, byPlayer);
    };
  }
  // Kills given and received, shots fired, claims sent (for the failure reasons).
  dm.kills = [];
  dm.shots = [];
  dm.claimLog = [];
  const r1 = (x) => Math.round(x * 10) / 10;
  dm.recv = [];
  if (g.net.isHost) {
    const oh = ents._onHits.bind(ents);
    ents._onHits = (m, from) => {
      if (Array.isArray(m?.l)) for (const c of m.l) dm.recv.push(`${from}>${c[0]}:${c[1]}:${c[2]}`);
      if (dm.recv.length > 20) dm.recv.splice(0, dm.recv.length - 20);
      return oh(m, from);
    };
    const kf = ents._killFor.bind(ents);
    ents._killFor = (pid, kind, obj) => {
      dm.kills.push(`${kind}:${obj.id}->${pid}`);
      return kf(pid, kind, obj);
    };
    const jd = g.enemyJets.onDown;
    g.enemyJets.onDown = (jet, cause) => {
      dm.kills.push(`jdown ${jet.id} ${cause} last ${jet.lastHitByPid} other ${!!jet.downedByOther} abs ${!!jet.absorbedBy}`);
      return jd(jet, cause);
    };
    const sd = g.ufos.onShotDown;
    g.ufos.onShotDown = (u, byPlayer) => {
      dm.kills.push(`crash ufo:${u.id} last ${u.lastHitPid} bp ${byPlayer}`);
      return sd?.(u, byPlayer);
    };
  } else {
    const ok = ents._onKill.bind(ents);
    ents._onKill = (m) => {
      dm.kills.push(`got ${m.k}`);
      return ok(m);
    };
    const th = g.net.toHost.bind(g.net);
    g.net.toHost = (m, o) => {
      if (m?.t === "hit" && Array.isArray(m.l)) for (const c of m.l) dm.claimLog.push(`${c[0]}:${c[1]}:${c[2]}`);
      if (dm.claimLog.length > 20) dm.claimLog.splice(0, dm.claimLog.length - 20);
      return th(m, o);
    };
  }
  dm.provLog = [];
  g.lasers.providers.forEach((pr, i) => {
    const rc = pr.raycast.bind(pr);
    pr.raycast = (o, d, max, bolt, dt) => {
      const h = rc(o, d, max, bolt, dt);
      if (h && bolt?.owner === "playerufo" && !bolt.mirror) {
        dm.provLog.push(`p${i}@${h.distance.toFixed(2)} from ${o.x.toFixed(1)},${o.y.toFixed(1)},${o.z.toFixed(1)}`);
        if (dm.provLog.length > 12) dm.provLog.shift();
      }
      return h;
    };
  });
  dm.castLog = [];
  const cast = g.lasers._cast.bind(g.lasers);
  g.lasers._cast = (b, step, dt) => {
    const r = cast(b, step, dt);
    if (r && b.owner === "playerufo" && !b.mirror) {
      dm.castLog.push(`${r.block ? "block " + (r.block.block || []).join(",") : "target"}@${r.distance.toFixed(2)} pos ${b.pos.x.toFixed(1)},${b.pos.y.toFixed(1)},${b.pos.z.toFixed(1)} trav ${b.traveled.toFixed(1)}`);
      if (dm.castLog.length > 8) dm.castLog.shift();
    }
    return r;
  };
  dm.shootLog = [];
  const sh = g.mobs.shoot.bind(g.mobs);
  g.mobs.shoot = (m, dmg, d, kb, bp) => {
    const before = m.invulnerable;
    const r = sh(m, dmg, d, kb, bp);
    dm.shootLog.push(`${m.kind}${m.net ? "p" : ""} ${dmg} bp${bp} inv${before?.toFixed?.(2)} -> ${r}`);
    if (dm.shootLog.length > 10) dm.shootLog.shift();
    return r;
  };
  const lf = g.lasers.fire.bind(g.lasers);
  g.lasers.fire = (o) => {
    if (!o.mirror) dm.lastShot = { from: [o.from.x, o.from.y, o.from.z], dir: [o.dir.x, o.dir.y, o.dir.z], owner: o.owner };
    dm.shots.push(`${o.owner} ${r1(o.from.x)},${r1(o.from.y)},${r1(o.from.z)} > ${r1(o.dir.x)},${r1(o.dir.y)},${r1(o.dir.z)}${o.mirror ? " m" : ""}`);
    if (dm.shots.length > 12) dm.shots.shift();
    return lf(o);
  };
  // A trace of one creature (host): height, speed, beam, every 0.25 s.
  dm.trace = [];
  dm.traceId = null;
  let traceT = 0;
  const traceTick = () => {
    const now = performance.now();
    if (dm.traceId != null && now - traceT > 250) {
      traceT = now;
      const m = g.mobs.mobs.find((x) => x.id === dm.traceId);
      if (m) dm.trace.push(`y${m.pos.y.toFixed(1)} vy${m.vel.y.toFixed(1)} rb${m.remoteBeam ? (m.remoteBeam.until - g.mobs.time).toFixed(2) : "-"} g${m.onGround ? 1 : 0} st${m.stagger.toFixed(1)} ab${m.abductedBy ? 1 : 0} x${m.pos.x.toFixed(1)} z${m.pos.z.toFixed(1)}`);
      if (dm.trace.length > 40) dm.trace.shift();
    }
    requestAnimationFrame(traceTick);
  };
  requestAnimationFrame(traceTick);
  // What a bolt along the last shot's line would hit first, provider by provider.
  dm.probeLine = () => {
    const last = dm.lastShot;
    if (!last) return null;
    const from = new T.Vector3(...last.from);
    const dir = new T.Vector3(...last.dir).normalize();
    const bolt = { owner: last.owner, radius: 0.06, damage: 0, step: 60, source: null };
    const out = [];
    g.lasers.providers.forEach((pr, i) => {
      if (pr.ignores?.(bolt)) return;
      const h = pr.raycast(from, dir, 60, bolt, 0.016);
      if (h) out.push(`${i}@${h.distance.toFixed(1)}`);
    });
    const veh = g.vehicles.vehicles.map((v) => `${v.type}${v.isEnemyJet ? "E" : ""}${v.puppet ? "p" : ""}${v.alive ? "" : "x"}@${v.pos.x.toFixed(0)},${v.pos.y.toFixed(0)},${v.pos.z.toFixed(0)}`);
    const mobs = g.mobs.mobs.map((m) => `${m.kind}${m.net ? "p" : ""}${m.dead ? "x" : ""}@${m.pos.x.toFixed(0)},${m.pos.y.toFixed(0)},${m.pos.z.toFixed(0)}`);
    return { hits: out, veh, mobs: mobs.slice(0, 6) };
  };
  dm.diag = () => ({ mlog: dm.mlog, cast: dm.castLog.slice(-6), prov: dm.provLog.slice(-8), shoot: dm.shootLog.slice(-5), ufoShot: dm.ufoShot, probe: dm.probeLine(), booms: dm.booms.slice(-3), shots: dm.shots.slice(-3), claims: dm.claimLog.slice(-4), kills: dm.kills.slice(-3), others: [...g.mp.players.active()].map((r) => [r.pid, Math.round(r.position.x * 10) / 10, Math.round(r.position.y * 10) / 10, Math.round(r.position.z * 10) / 10, r.dead ? "dead" : "", r.vehicle || r.vehicleNid ? "veh" : "", r.creative ? "cr" : ""]) });
  dm.give = (id) => {
    g.inventory.slots[0] = { id, count: id === 286 ? 16 : 1 };
    g.inventory.selected = 0;
    g.mp.game.markInventoryChanged();
  };
  dm.stats = () => ({ ...g.stats.world });
  dm.aimAt = (p) => {
    const eye = g.player.getEyePosition();
    const d = p.clone().sub(eye);
    g.player.yaw = Math.atan2(-d.x, -d.z);
    g.player.pitch = Math.atan2(d.y, Math.hypot(d.x, d.z));
  };
  // This page's copy of a target: the host's own object, or a guest's puppet.
  dm.local = (ref) => {
    if (!ref) return null;
    const host = g.net.isHost;
    if (ref.kind === "mob") return host ? g.mobs.mobs.find((m) => m.id === ref.id) || null : ents.mobById.get(ref.id) || null;
    if (ref.kind === "ufo") return host ? g.ufos.ufos.find((u) => u.id === ref.id) || null : ents.ufoById.get(ref.id) || null;
    if (ref.kind === "jet") return host ? g.vehicles.vehicles.find((j) => j.isEnemyJet && j.id === ref.id) || null : ents.jetById.get(ref.id) || null;
    if (ref.kind === "player") return ref.pid === g.net.pid ? g.player : g.mp.players.get(ref.pid) || null;
    return null;
  };
  dm.center = (ref) => {
    if (ref.kind === "block") return new T.Vector3(ref.x + 0.5, ref.y + 0.5, ref.z + 0.5);
    const o = dm.local(ref);
    if (!o) return null;
    if (ref.kind === "mob") return o.pos.clone().setY(o.pos.y + o.spec.h * 0.5);
    if (ref.kind === "player") return (o.position || o.livePos).clone().setY((o.position || o.livePos).y + 0.9);
    return o.pos.clone();
  };
  dm.state = (ref) => {
    if (ref.kind === "block") return { dead: g.world.getBlock(ref.x, ref.y, ref.z) === 0, exists: true };
    const o = dm.local(ref);
    const key = `${ref.kind}:${ref.id}`;
    if (ref.kind === "player") {
      if (!o) return { exists: false, dead: false };
      return { exists: true, dead: !!o.dead, health: o.health ?? null, cause: ref.pid === g.net.pid ? g.deathCause ?? null : null };
    }
    if (!o) return { exists: false, dead: dm.seen.has(key) };
    if (ref.kind === "mob") return { exists: true, dead: !!o.dead || dm.seen.has(key), health: o.health, max: o.maxHealth, y: Math.round(o.pos.y * 10) / 10, rb: o.remoteBeam ? Math.round((o.remoteBeam.topY ?? -1) * 10) / 10 : null, t: Math.round((g.mobs.time ?? 0) * 10) / 10 };
    if (ref.kind === "ufo") return { exists: true, dead: !!o.falling || o.state === "gone" || dm.seen.has(key), health: o.health, max: o.maxHealth };
    if (ref.kind === "jet") return { exists: true, dead: !o.alive || dm.seen.has(key), health: o.health };
    return { exists: false };
  };

  // ---------- Host: targets ----------
  dm.arena = () => {
    const p = g.player.position;
    const x0 = Math.floor(p.x);
    const z0 = Math.floor(p.z);
    let top = 0;
    for (let dx = -40; dx <= 40; dx += 8) for (let dz = -40; dz <= 40; dz += 8) top = Math.max(top, g.world.terrain.heightAt(x0 + dx, z0 + dz));
    const y = Math.min(118, top + 22);
    g.world.prepareArea(x0, z0, 4);
    const list = [];
    for (let dx = -36; dx <= 36; dx++) {
      for (let dz = -36; dz <= 36; dz++) {
        list.push(x0 + dx, y, z0 + dz, 3);
        for (let h = 1; h <= 14; h++) list.push(x0 + dx, y + h, z0 + dz, 0);
      }
    }
    g.world.setBlocks(list);
    return { x0, y, z0 };
  };
  // Puts the arena back as it was (only the blocks that changed, so there is
  // little to send to the other page).
  dm.repair = (a) => {
    const list = [];
    const w = g.world;
    for (let dx = -20; dx <= 20; dx++) {
      for (let dz = -20; dz <= 22; dz++) {
        for (let h = -3; h <= 0; h++) if (w.getBlock(a.x0 + dx, a.y + h, a.z0 + dz) !== 3) list.push(a.x0 + dx, a.y + h, a.z0 + dz, 3);
        for (let h = 1; h <= 14; h++) if (w.getBlock(a.x0 + dx, a.y + h, a.z0 + dz) !== 0) list.push(a.x0 + dx, a.y + h, a.z0 + dz, 0);
      }
    }
    if (list.length) w.setBlocks(list);
    return list.length / 4;
  };
  dm.clear = () => {
    dm.pins = dm.pins.filter((p) => p.kind === "self");
    // (Every creature near the arena: the targets, and anything that got there.)
    const p = g.player.position;
    for (let i = g.mobs.mobs.length - 1; i >= 0; i--) {
      const m = g.mobs.mobs[i];
      if (m.dmTarget || Math.hypot(m.pos.x - p.x, m.pos.z - p.z) < 160) g.mobs._remove(i);
    }
    for (const u of g.ufos.ufos) if (u.dmTarget) u.state = "gone";
    // (And the wrecks the last cell left: a shot-down UFO's burnt-out hull is
    // solid, for the host and the guest alike, and stood in the next cell's line of fire.)
    for (const j of [...g.vehicles.vehicles]) if (j.dmTarget || (!j.puppet && !j.occupied && (j.crashed || !j.alive))) g.vehicles.remove(j);
  };
  dm.spawn = (type, pos, hp, pin = true) => {
    const at = new T.Vector3(pos[0], pos[1], pos[2]);
    if (["zombie", "skeleton", "spider", "cow", "villager", "alien", "alien_gray", "alien_red", "alien_blue", "guard"].includes(type)) {
      const m = g.mobs.spawn(type, at.x, at.y, at.z);
      if (!m) return null;
      m.dmTarget = true;
      m.persist = true;
      m.fireproof = true; // (no burning in the midday sun: only the attacker may kill it)
      m.calmT = 1e6;
      m.attackCooldown = 1e9;
      if (hp != null) m.health = Math.min(m.maxHealth, hp);
      if (pin) dm.pins.push({ kind: "mob", obj: m, pos: at.clone() });
      return { kind: "mob", id: m.id, type };
    }
    if (type === "ufo") {
      const u = g.ufos.spawn({ size: "small", design: "saucer", pos: at.clone(), hidden: false });
      u.dmTarget = true;
      u.state = "trick";
      u.trick = "hover";
      u.timer = 1e6;
      u.noLeave = true;
      u.blinkT = 1e9;
      u.dodgeMul = 0;
      u.hostile = false;
      u.spawnFade = 0;
      u.age = 9;
      u.crashPlan = { exploded: true, crew: 0 }; // (no crew climbing out to shoot at the next cell's target)
      if (hp != null) u.health = Math.min(u.maxHealth, hp);
      if (pin) dm.pins.push({ kind: "ufo", obj: u, pos: at.clone() });
      return { kind: "ufo", id: u.id, type };
    }
    if (type === "jet") {
      const j = g.vehicles.create("enemyjet", { pos: [at.x, at.y, at.z], yaw: 0, airborne: true, speed: 0, throttle: 0 });
      if (!j) return null;
      j.dmTarget = true;
      j.mission = true; // (kept whatever the patrol setting says)
      // (No flares: a decoyed missile can turn back on its shooter, which
      // makes the missile cell a coin toss. Flares work online since Round 9:
      // the host's are replayed for the guests.)
      j.flareT = 1e9;
      if (hp != null) j.health = Math.min(j.maxHealth ?? j.health, hp);
      if (pin) dm.pins.push({ kind: "jet", obj: j, pos: at.clone() });
      return { kind: "jet", id: j.id, type };
    }
    if (type === "block") {
      g.world.setBlocks([pos[0], pos[1], pos[2], 3]);
      return { kind: "block", x: pos[0], y: pos[1], z: pos[2], type };
    }
    return null;
  };

  // ---------- The attacker: weapons ----------
  dm.vehicle = null;
  dm.enter = (kind, at, face) => {
    dm.leave();
    const pos = new T.Vector3(at[0], at[1], at[2]);
    let v;
    if (kind === "ufo") v = g.vehicles.create("ufo", { design: "saucer", seed: 11, radius: 8.5, pos: [pos.x, pos.y, pos.z], yaw: 0 });
    else v = g.vehicles.create("jet", { jetType: kind, pos: [pos.x, pos.y, pos.z], yaw: 0, airborne: true, speed: 120, throttle: 0.5 });
    g.vehicles.enter(v);
    dm.vehicle = v;
    dm.pins.push({ kind: "self", obj: v, pos: pos.clone() });
    if (face) dm.face(new T.Vector3(face[0], face[1], face[2]));
    return !!g.vehicles.active;
  };
  dm.face = (p) => {
    const v = dm.vehicle;
    if (!v) return;
    const d = p.clone().sub(v.pos).normalize();
    if (v.type === "jet") {
      // (A jet's nose is its local -Z: Matrix4.lookAt points -Z at the target.)
      const m = new T.Matrix4().lookAt(new T.Vector3(0, 0, 0), d.clone(), new T.Vector3(0, 1, 0));
      v.q.setFromRotationMatrix(m);
      v.aimQ?.copy(v.q);
    } else {
      v.camYaw = Math.atan2(-d.x, -d.z);
      v.camPitch = Math.asin(Math.max(-1, Math.min(1, d.y)));
    }
  };
  dm.leave = () => {
    dm.pins = dm.pins.filter((p) => p.kind !== "self");
    const v = dm.vehicle;
    dm.vehicle = null;
    g.vehicles.input.buttons[0] = false;
    g.vehicles.input.buttons[2] = false;
    if (g.vehicles.active) g.vehicles.exit({ force: true });
    if (v && g.vehicles.vehicles.includes(v)) g.vehicles.remove(v);
  };
  dm.fire = async (w, ref) => {
    const c = dm.center(ref);
    if (!c) return "no target";
    const W = g.weapons;
    W.refill();
    const shots = (n, fn) => {
      for (let i = 0; i < n; i++) fn(i);
    };
    switch (w) {
      case "melee": {
        dm.give(273);
        dm.aimAt(c);
        const { itemInfo } = await import("./js/items.js");
        const eye = g.player.getEyePosition();
        const dir = c.clone().sub(eye).normalize();
        const hit = g.mobs.raycast(eye, dir, 6);
        if (!hit) return "nothing in reach";
        g.mobs.lastAttackTime = -99;
        g.mobs.attack(hit.mob, itemInfo(273)?.tool);
        return "ok";
      }
      case "bow":
        dm.give(297);
        dm.aimAt(c.clone().setY(c.y + 0.15));
        W.bow.drawing = true;
        W.bow.t = 1.2;
        W.release();
        return "ok";
      case "pistol":
        dm.give(287);
        dm.aimAt(c);
        W.press("pistol");
        W.release();
        return "ok";
      case "blaster":
        dm.give(292);
        dm.aimAt(c);
        W.press("blaster");
        W.release();
        return "ok";
      case "machinegun":
        dm.give(289);
        dm.aimAt(c);
        shots(3, () => W.fireMachineGun());
        return "ok";
      case "minigun":
        dm.give(295);
        dm.aimAt(c);
        shots(5, () => W.fireMinigunBolt());
        return "ok";
      case "sniper":
        dm.give(290);
        dm.aimAt(c);
        W.sniperShot();
        return "ok";
      case "railgun":
        dm.give(294);
        dm.aimAt(c);
        W.fireRailgun();
        return "ok";
      case "bazooka":
        dm.give(288);
        dm.aimAt(c);
        W.fireBazooka(null);
        return "ok";
      case "grenade": {
        dm.give(286);
        dm.aimAt(c.clone().setY(c.y + 2));
        const gr = W.throwGrenade(0.42);
        gr.age = 4.1;
        return "ok";
      }
      case "airstrike":
        dm.give(291);
        dm.aimAt(c.clone().setY(c.y - 0.9));
        Object.assign(W.airstrike.config, { delay: 0.7, spread: 1, count: 2 });
        W.fireAirstrike();
        return "ok";
      case "jet_cannon": {
        const j = dm.vehicle;
        if (!j || j.type !== "jet") return "no jet";
        dm.face(c);
        const fwd = c.clone().sub(j.pos).normalize();
        shots(8, () => {
          j.heat = 0;
          j.jammed = false;
          j._fireCannon(fwd);
        });
        return "ok";
      }
      case "jet_missile": {
        const j = dm.vehicle;
        if (!j || j.type !== "jet") return "no jet";
        dm.face(c);
        const o = dm.local(ref);
        // (Debug: which test stops the missile in its first second.)
        dm.mlog = [];
        const wrap = (obj, name, tag) => {
          const f = obj[name].bind(obj);
          obj[name] = (...a) => {
            const r = f(...a);
            if (r && dm.mlog.length < 6) dm.mlog.push(`${tag}${r.distance !== undefined ? "@" + r.distance.toFixed(1) : ""}${r.vehicle ? ":" + r.vehicle.type + (r.vehicle.puppet ? "p" : "") : r.ufo ? ":ufo" + r.ufo.id + r.ufo.state : r.mob ? ":" + r.mob.kind : ""}`);
            return r;
          };
          setTimeout(() => (obj[name] = f), 1500);
        };
        wrap(g.vehicles, "raycast", "veh");
        wrap(g.ufos, "raycast", "ufo");
        wrap(g.mobs, "sphereHit", "mob");
        if (ref.kind === "ufo") j._launchMissile({ kind: "ufo", ref: o });
        else if (ref.kind === "jet") j._launchMissile({ kind: "jet", ref: o });
        else j._launchMissile(null);
        return "ok";
      }
      case "nuke": {
        const j = dm.vehicle;
        if (!j || j.jetType !== "b2") return "no B-2";
        j._dropNuke();
        return "ok";
      }
      case "ufo_laser": {
        const s = dm.vehicle;
        if (!s || s.type !== "ufo") return "no ship";
        dm.face(c);
        const st = s.pilotStyle;
        dm.ufoShot = { c: [c.x, c.y, c.z].map((x) => Math.round(x * 10) / 10), style: { homing: !!st.homing, count: st.count, blast: st.blast, speed: st.speed }, from: [] };
        shots(3, () => {
          const from = s._muzzle(new T.Vector3());
          dm.ufoShot.from.push([from.x, from.y, from.z].map((x) => Math.round(x * 10) / 10));
          const dd = c.clone().sub(from).normalize();
          const mh = g.mobs.raycast(from.clone(), dd, 60);
          const wh = g.world.raycast(from.clone(), dd, 60, { solidOnly: true });
          dm.ufoShot.ray = `${mh ? mh.mob.kind + "@" + mh.distance.toFixed(1) : "-"} world ${wh ? wh.distance.toFixed(1) : "-"} dist ${c.distanceTo(from).toFixed(1)}`;
          const bb = s._bolt(from, dd);
          (dm.ufoShot.out || (dm.ufoShot.out = [])).push(`${dd.x.toFixed(2)},${dd.y.toFixed(2)},${dd.z.toFixed(2)} -> ${bb.dir.x.toFixed(2)},${bb.dir.y.toFixed(2)},${bb.dir.z.toFixed(2)} n${g.lasers.bolts.length} in${g.lasers.bolts.includes(bb)}`);
        });
        return "ok";
      }
      case "tractor": {
        const s = dm.vehicle;
        if (!s || s.type !== "ufo") return "no ship";
        g.vehicles.input.buttons[2] = true;
        return "ok";
      }
      case "superweapon": {
        const s = dm.vehicle;
        if (!s || s.type !== "ufo") return "no ship";
        s.sw.cool = 0;
        s._startSuper();
        return "ok";
      }
    }
    return `unknown weapon ${w}`;
  };
  return true;
}

// ---------- Setup: a host and a guest ----------
const host = await newPage("host");
await host.goto(`http://127.0.0.1:${PORT}/index.html?seed=${SEED}&${NET_Q}`, { waitUntil: "load", timeout: 60000 });
await host.waitForFunction(() => window.__ufo?.graphicsReady, null, { timeout: 120000 });
await host.click("#menu-mp-btn");
await host.fill("#mp-nick", "Alice");
await host.click("#mp-host-btn");
const code = await until(host, (g) => g.net.code, 30000);
await host.click("#mp-lobby-play");
await host.waitForFunction(() => window.__ufo.gameState === "playing", null, { timeout: 30000 });
const guest = await newPage("guest");
await guest.goto(`http://127.0.0.1:${PORT}/index.html?join=${code}&${NET_Q}`, { waitUntil: "load", timeout: 60000 });
await guest.waitForSelector("#mp-join-boot:not(.hidden)", { timeout: 30000 });
await guest.fill("#mp-boot-nick", "Bob");
await guest.click("#mp-boot-join");
await guest.waitForFunction(() => window.__ufo?.graphicsReady && window.__ufo.mp.stateLoaded, null, { timeout: 120000 });
await play(guest);
const GUEST_PID = await v(guest, (g) => g.net.pid);
console.log(`  joined: room ${code}, guest pid ${GUEST_PID}`);

// The rules: Survival, PvP on, no missions, nothing spawning by itself, midday.
await v(host, (g) => {
  g.mp.rules.setMode("survival");
  g.mp.rules.setPvp(true);
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
await until(guest, (g) => g.player.mode === "survival" && g.mp.pvp !== false, 10000);
for (const p of [host, guest]) await v(p, installDm);
const A = await v(host, () => window.__dm.arena());
console.log(`  arena at ${A.x0}, ${A.y}, ${A.z0}`);
const SIDE = [A.x0 + 24, A.y + 1, A.z0 + 24];
for (const p of [host, guest]) {
  await v(p, (g, s) => {
    g.mp.game.teleport(s[0] + 0.5, s[1], s[2] + 0.5);
    g.player.flying = false;
  }, SIDE);
}
await until(guest, (g, a) => g.world.getChunk(a.x0 >> 4, a.z0 >> 4) && g.world.getBlock(a.x0, a.y, a.z0) === 3, 30000, A);
await sleep(1500);

// The game's speed here (game seconds per real second): two pages drawing
// with software WebGL run the game in slow motion, so the waits for things
// that take game time (a beam's lift, a charge, a fall) are stretched to match.
async function gameSpeed(page) {
  const t0 = await v(page, (g) => g.mobs.time);
  const r0 = Date.now();
  await sleep(2000);
  const t1 = await v(page, (g) => g.mobs.time);
  return Math.max(0.05, (t1 - t0) / ((Date.now() - r0) / 1000));
}
const SPEED = Math.min(await gameSpeed(host), await gameSpeed(guest));
const SLOW = Math.min(8, Math.max(1, 1 / SPEED));
console.log(`  game speed ${SPEED.toFixed(2)}x real time: waits x${SLOW.toFixed(1)}`);

// ---------- The matrix ----------
const MOB_TARGETS = ["zombie", "skeleton", "spider", "cow", "villager", "alien", "alien_gray", "alien_red", "alien_blue", "guard"];
const TARGETS = [...MOB_TARGETS, "ufo", "jet", "player", "block"];
const HAND = ["melee", "bow", "pistol", "blaster", "machinegun", "minigun", "sniper", "railgun", "bazooka", "grenade", "airstrike"];
const VEHICLE = ["jet_cannon", "jet_missile", "nuke", "ufo_laser", "tractor", "superweapon"];
const WEAPONS = [...HAND, ...VEHICLE];
const BLAST = new Set(["bazooka", "grenade", "airstrike", "jet_missile", "nuke", "superweapon"]);
// Which kill stat a target counts in (the attacker's own stats).
const CREDIT = { zombie: "zombiesKilled", skeleton: "skeletonsKilled", guard: "guardsKilled", alien: "aliensKilled", alien_gray: "aliensKilled", alien_red: "aliensKilled", alien_blue: "aliensKilled", spider: "mobsKilled", cow: "mobsKilled", villager: "mobsKilled", ufo: "ufosDown", jet: "enemyJetsDown", player: "playerKills" };

function applicable(w, t) {
  if (t === "block") return BLAST.has(w) || w === "superweapon";
  if (w === "melee") return t !== "ufo" && t !== "jet";
  if (w === "airstrike") return t !== "ufo" && t !== "jet";
  if (w === "tractor") return t !== "player";
  return true;
}
// Where things stand for a cell: the target, and the attacker (on foot or in a vehicle).
function layout(w, t) {
  const x = A.x0;
  const y = A.y + 1;
  const z = A.z0;
  const air = t === "ufo" ? 9 : t === "jet" ? 14 : 0;
  const target = t === "block" ? [x, A.y + 1, z] : [x + 0.5, y + air, z + 0.5];
  let attacker = [x + 0.5, y, z + 9.5];
  let vehicle = null;
  if (w === "melee") attacker = [x + 0.5, y, z + 2.2];
  if (w === "grenade") attacker = [x + 0.5, y, z + 7.5];
  if (w === "airstrike" || w === "bazooka") attacker = [x + 0.5, y, z + 10.5];
  if (w === "jet_cannon" || w === "jet_missile") vehicle = { kind: "f22", at: [x + 0.5, y + air + (t === "jet" || t === "ufo" ? 4 : 18), z + 80] };
  if (w === "nuke") vehicle = { kind: "b2", at: [x + 0.5, y + 70, z + 0.5] };
  if (w === "ufo_laser") vehicle = { kind: "ufo", at: [x + 0.5, y + air + 12, z + 28] };
  if (w === "tractor" || w === "superweapon") vehicle = { kind: "ufo", at: [x + 0.5, t === "ufo" ? y + air + 22 : t === "jet" ? y + air + 22 : y + 26, z + 0.5] };
  return { target, attacker, vehicle };
}
const TIMEOUT = { nuke: 30000, tractor: 14000, superweapon: 9000, grenade: 6000, airstrike: 7000, bazooka: 5000, jet_missile: 8000, bow: 5000 };

async function runCell(attacker, observer, w, t, attackerName) {
  if (!applicable(w, t)) return { r: "n/a" };
  const L = layout(w, t);
  const victimIsHost = attackerName === "guest";
  const victimPage = victimIsHost ? host : guest;
  const victimPid = victimIsHost ? 1 : GUEST_PID;
  const bystander = attacker === host ? guest : host;
  // (The tractor beam takes what it holds aboard: gone, not dead.)
  const goneOk = w === "tractor";
  // Clean slate, the attacker in place, the other player out of the way.
  await v(host, () => window.__dm.clear());
  await v(host, (g, a) => window.__dm.repair(a), A);
  await v(attacker, (g, a) => {
    window.__dm.leave();
    if (g.player.dead) g.respawn();
    g.mp.game.teleport(a.at[0], a.at[1], a.at[2]);
    g.player.velocity.set(0, 0, 0);
  }, { at: L.attacker });
  if (t !== "player") {
    await v(bystander, (g, s) => {
      window.__dm.leave();
      if (g.player.dead) g.respawn();
      g.mp.game.teleport(s[0] + 0.5, s[1], s[2] + 0.5);
    }, SIDE);
  }
  // The target.
  let ref;
  if (t === "player") {
    ref = { kind: "player", pid: victimPid, id: victimPid };
    await v(victimPage, (g, a) => {
      window.__dm.leave();
      if (g.player.dead) g.respawn();
      g.mp.game.teleport(a.p[0], a.p[1], a.p[2]);
      g.player.velocity.set(0, 0, 0);
      g.player.health = 1;
      g.inventory.armor?.fill?.(null);
      window.__dm.god = false;
    }, { p: L.target });
    // (The attacker sees the victim there: remote players are drawn a little in the past.)
    await until(attacker, (g, a) => {
      const c = window.__dm.center(a.ref);
      return !!c && Math.hypot(c.x - a.p[0], c.z - a.p[2]) < 0.6 && Math.abs(c.y - 0.9 - a.p[1]) < 0.6;
    }, 6000, { ref: { kind: "player", pid: victimPid, id: victimPid }, p: L.target });
    await sleep(300);
  } else {
    // (The tractor beam's targets are free to be lifted; a fighter is held on
    // the spot until the beam takes it, or it would stall and crash first.)
    ref = await v(host, (g, a) => window.__dm.spawn(a.t, a.p, a.hp, a.pin), { t, p: L.target, hp: 1, pin: w !== "tractor" || t === "jet" });
    if (!ref) return { r: "FAIL", why: "could not spawn the target" };
  }
  const done = async (why) => {
    await v(attacker, () => window.__dm.leave());
    if (t === "player") await v(victimPage, (g) => {
      window.__dm.god = true;
      if (g.player.dead) g.respawn();
    });
    return why ? { r: "FAIL", why } : { r: "PASS" };
  };
  if (L.vehicle) {
    const ok = await v(attacker, (g, a) => window.__dm.enter(a.kind, a.at, a.face), { kind: L.vehicle.kind, at: L.vehicle.at, face: L.target });
    if (!ok) return done("could not board the vehicle");
  }
  const seen = await until(attacker, (g, ref) => !!window.__dm.center(ref), 8000, ref);
  if (!seen) return done("the attacker never saw the target");
  await sleep(250);
  const before = await v(attacker, () => window.__dm.stats());
  await v(host, (g, r) => {
    window.__dm.recv.length = 0;
    window.__dm.trace.length = 0;
    window.__dm.traceId = r.kind === "mob" ? r.id : null;
  }, ref);
  await v(attacker, () => {
    window.__dm.shootLog.length = 0;
    window.__dm.provLog.length = 0;
    window.__dm.castLog.length = 0;
    window.__dm.booms.length = 0;
    window.__dm.shots.length = 0;
    window.__dm.claimLog.length = 0;
  });
  const res = await v(attacker, (g, a) => window.__dm.fire(a.w, a.ref), { w, ref });
  if (res !== "ok") return done(`fire: ${res}`);
  const timeout = (TIMEOUT[w] ?? 4000) * SLOW;
  // Judged on the host (by the victim, for a player).
  const judge = t === "player" ? victimPage : host;
  const killed = (g, a) => {
    const s = window.__dm.state(a.ref);
    return s.dead || (a.goneOk && !s.exists);
  };
  const dead = await until(judge, killed, timeout, { ref, goneOk });
  if (!dead) {
    const st = await v(judge, (g, ref) => window.__dm.state(ref), ref);
    const diag = await v(attacker, () => window.__dm.diag());
    const hd = await v(host, (g, a) => ({ recv: window.__dm.recv.slice(-4), hit: window.__dm.hits[a.k] || "none", trace: a.verbose ? window.__dm.trace.filter((_, i) => i % 3 === 0) : undefined }), { k: `${ref.kind}:${ref.id}`, verbose: !!args.verbose });
    return done(`not killed (judge: ${JSON.stringify(st)}) target ${JSON.stringify(L.target)} attacker ${JSON.stringify(diag)} host ${JSON.stringify(hd)}`);
  }
  // The other screen: the attacker sees the victim dead; for anything else, the guest's copy.
  const other = t === "player" ? attacker : guest;
  const seenDead = await until(other, killed, 6000 * SLOW, { ref, goneOk });
  // The credit.
  let why = "";
  if (t !== "block") {
    const key = w === "tractor" && MOB_TARGETS.includes(t) ? "animalsAbducted" : CREDIT[t];
    const got = await until(attacker, (g, a) => (g.stats.world[a.key] ?? 0) > (a.before[a.key] ?? 0), (t === "ufo" ? 6000 : 3000) * SLOW, { key, before });
    if (!got) why += `no ${key} for the attacker (last hit: ${await v(host, (g, k) => window.__dm.hits[k] || "none", `${ref.kind}:${ref.id}`)}; host kills ${JSON.stringify(await v(host, () => window.__dm.kills.slice(-3)))}; attacker kills ${JSON.stringify(await v(attacker, () => window.__dm.kills.slice(-3)))}); `;
  }
  // A player's death names the attacker.
  if (t === "player") {
    const cause = await v(victimPage, (g) => g.deathCause ?? null);
    const pid = attackerName === "guest" ? GUEST_PID : 1;
    const named = typeof cause === "string" && (cause.includes(`@${pid}`) || cause === `pvp@${pid}`);
    if (!named) why += `death cause ${cause}; `;
  }
  if (!seenDead) why += "the other screen didn't show it; ";
  return done(why.trim());
}

// The B-2's nuke, once per attacker: one of every target around ground zero
// (and the other player), all down in one blast, each kill the attacker's.
async function nukeCell(attacker, attackerName) {
  const out = {};
  const victimPage = attackerName === "guest" ? host : guest;
  const victimPid = attackerName === "guest" ? 1 : GUEST_PID;
  await v(host, () => window.__dm.clear());
  for (const p of [host, guest]) await v(p, (g) => (g.nuke.config.size = 24));
  const refs = {};
  const types = [...MOB_TARGETS, "ufo", "jet", "block"];
  for (let i = 0; i < types.length; i++) {
    const t = types[i];
    const a = (i / types.length) * Math.PI * 2;
    const r = t === "block" ? 2 : 6 + (i % 3) * 3;
    const pos = t === "block" ? [A.x0 + 2, A.y, A.z0] : [A.x0 + 0.5 + Math.cos(a) * r, A.y + 1 + (t === "ufo" ? 8 : t === "jet" ? 12 : 0), A.z0 + 0.5 + Math.sin(a) * r];
    refs[t] = await v(host, (g, a) => window.__dm.spawn(a.t, a.p, 1), { t, p: pos });
  }
  refs.player = { kind: "player", pid: victimPid, id: victimPid };
  await v(victimPage, (g, a) => {
    window.__dm.leave();
    if (g.player.dead) g.respawn();
    g.mp.game.teleport(a[0], a[1], a[2]);
    g.player.health = 1;
    window.__dm.god = false;
  }, [A.x0 + 12.5, A.y + 1, A.z0 + 12.5]);
  await v(attacker, (g, a) => {
    if (g.player.dead) g.respawn();
    window.__dm.enter("b2", a, null);
  }, [A.x0 + 0.5, A.y + 70, A.z0 + 0.5]);
  for (const t of Object.keys(refs)) if (refs[t].kind !== "block") await until(attacker, (g, ref) => !!window.__dm.center(ref), 8000, refs[t]);
  await sleep(500);
  const before = await v(attacker, () => window.__dm.stats());
  const res = await v(attacker, (g) => window.__dm.fire("nuke", { kind: "block", x: 0, y: 0, z: 0 }));
  if (res !== "ok") console.log(`  nuke: ${res}`);
  const boom = await until(attacker, (g) => g.nuke.active.length > 0, 40000 * SLOW);
  if (!boom) {
    for (const t of Object.keys(refs)) out[t] = "FAIL: the nuke never went off";
    await v(attacker, () => window.__dm.leave());
    await v(victimPage, () => (window.__dm.god = true));
    return out;
  }
  // (The kills of things that fall, like the UFO, come when they hit the ground.)
  await until(attacker, (g, a) => Object.keys(a.need).every((k) => (g.stats.world[k] ?? 0) - (a.before[k] ?? 0) >= a.need[k]), 12000 * SLOW, { need: Object.fromEntries(Object.keys(refs).filter((t) => CREDIT[t]).map((t) => [CREDIT[t], Object.keys(refs).filter((u) => CREDIT[u] === CREDIT[t]).length])), before });
  const after = await v(attacker, () => window.__dm.stats());
  const need = {};
  for (const t of Object.keys(refs)) if (CREDIT[t]) need[CREDIT[t]] = (need[CREDIT[t]] ?? 0) + 1;
  for (const t of Object.keys(refs)) {
    const ref = refs[t];
    const judge = t === "player" ? victimPage : host;
    const dead = await until(judge, (g, r) => window.__dm.state(r).dead, 4000 * SLOW, ref);
    const other = t === "player" ? attacker : guest;
    const seen = await until(other, (g, r) => window.__dm.state(r).dead, 4000 * SLOW, ref);
    let why = "";
    if (!dead) why += "not killed; ";
    if (!seen) why += "the other screen didn't show it; ";
    if (CREDIT[t] && (after[CREDIT[t]] ?? 0) - (before[CREDIT[t]] ?? 0) < need[CREDIT[t]]) why += `${CREDIT[t]} ${(after[CREDIT[t]] ?? 0) - (before[CREDIT[t]] ?? 0)}/${need[CREDIT[t]]}; `;
    if (t === "player") {
      const cause = await v(victimPage, (g) => g.deathCause ?? null);
      const pid = attackerName === "guest" ? GUEST_PID : 1;
      if (!(typeof cause === "string" && cause.includes(`@${pid}`))) why += `death cause ${cause}; `;
    }
    out[t] = why ? `FAIL: ${why.trim()}` : "PASS";
  }
  await v(attacker, () => window.__dm.leave());
  await v(victimPage, (g) => {
    window.__dm.god = true;
    if (g.player.dead) g.respawn();
  });
  return out;
}

// The health of a target after one non-lethal hit: the same on both screens.
async function healthSync(attacker) {
  const out = {};
  for (const t of ["zombie", "alien_red", "guard", "ufo", "jet"]) {
    await v(host, () => window.__dm.clear());
    const L = layout("pistol", t);
    await v(attacker, (g, a) => {
      window.__dm.leave();
      g.mp.game.teleport(a[0], a[1], a[2]);
    }, L.attacker);
    const ref = await v(host, (g, a) => window.__dm.spawn(a.t, a.p, null), { t, p: L.target });
    await until(attacker, (g, ref) => !!window.__dm.center(ref), 8000, ref);
    await until(guest, (g, ref) => !!window.__dm.local(ref), 8000, ref);
    await sleep(300);
    await v(attacker, (g, a) => window.__dm.fire("pistol", a), ref);
    const hit = await until(host, (g, ref) => {
      const s = window.__dm.state(ref);
      return s.health !== undefined && s.max !== undefined ? s.health < s.max && s : s.health !== undefined && s;
    }, 4000 * SLOW, ref);
    await sleep(900 * SLOW);
    const h = await v(host, (g, ref) => window.__dm.state(ref), ref);
    const gs = await v(guest, (g, ref) => window.__dm.state(ref), ref);
    const same = h.health !== undefined && gs.health !== undefined && Math.abs(h.health - gs.health) <= Math.max(0.6, Math.abs(h.health) * 0.02);
    out[t] = { host: h.health, guest: gs.health, same, hit: !!hit };
  }
  return out;
}

const matrix = {};
const failures = [];
let first = true;
for (const [attackerName, attacker, observer] of [["guest", guest, host], ["host", host, guest]]) {
  if (args.only && args.only !== attackerName) continue;
  if (!first) {
    // (The first attacker's nuke left a crater: a fresh arena farther on.)
    await v(host, (g, a) => g.mp.game.teleport(a.x0 + 260.5, null, a.z0 + 0.5), A);
    await sleep(1500);
    Object.assign(A, await v(host, () => window.__dm.arena()));
    SIDE[0] = A.x0 + 24;
    SIDE[1] = A.y + 1;
    SIDE[2] = A.z0 + 24;
    for (const p of [host, guest]) await v(p, (g, s) => g.mp.game.teleport(s[0] + 0.5, s[1], s[2] + 0.5), SIDE);
    await until(guest, (g, a) => g.world.getBlock(a.x0, a.y, a.z0) === 3, 30000, A);
    await sleep(1500);
  }
  first = false;
  matrix[attackerName] = {};
  console.log(`\n  ===== ${attackerName.toUpperCase()} attacking =====`);
  const sync = await healthSync(attacker);
  matrix[attackerName].healthSync = sync;
  for (const [t, s] of Object.entries(sync)) {
    if (!s.same || !s.hit) failures.push(`${attackerName}: health sync ${t}: ${JSON.stringify(s)}`);
  }
  console.log(`  health after one pistol hit, host vs guest: ${Object.entries(sync).map(([t, s]) => `${t} ${s.host?.toFixed?.(1)}/${s.guest?.toFixed?.(1)} ${s.same ? "ok" : "DIFF"}`).join(", ")}`);
  for (const w of WEAPONS) {
    if (w === "nuke" || (args.weapon && !String(args.weapon).split(",").includes(w))) continue;
    const row = {};
    for (const t of TARGETS) {
      if (args.target && !String(args.target).split(",").includes(t)) continue;
      let res;
      try {
        res = await runCell(attacker, observer, w, t, attackerName);
      } catch (err) {
        res = { r: "FAIL", why: `error: ${err.message.split("\n")[0]}` };
      }
      row[t] = res.r === "FAIL" ? `FAIL: ${res.why}` : res.r;
      if (res.r === "FAIL") failures.push(`${attackerName} ${w} -> ${t}: ${res.why}`);
    }
    matrix[attackerName][w] = row;
    const cells = TARGETS.filter((t) => row[t] !== undefined).map((t) => `${t}:${row[t] === "PASS" ? "ok" : row[t] === "n/a" ? "-" : "FAIL"}`);
    console.log(`  ${w.padEnd(12)} ${cells.join(" ")}`);
  }
  if (!args.weapon || String(args.weapon).split(",").includes("nuke")) {
    let row;
    try {
      row = await nukeCell(attacker, attackerName);
    } catch (err) {
      row = Object.fromEntries(TARGETS.map((t) => [t, `FAIL: error: ${err.message.split("\n")[0]}`]));
    }
    matrix[attackerName].nuke = row;
    for (const [t, r] of Object.entries(row)) if (r !== "PASS") failures.push(`${attackerName} nuke -> ${t}: ${r}`);
    console.log(`  ${"nuke".padEnd(12)} ${TARGETS.filter((t) => row[t]).map((t) => `${t}:${row[t] === "PASS" ? "ok" : "FAIL"}`).join(" ")}`);
  }
}

fs.mkdirSync(path.join(__dirname, "probe-out"), { recursive: true });
fs.writeFileSync(path.join(__dirname, "probe-out", "damage-matrix.json"), JSON.stringify(matrix, null, 1));
const cellsAll = Object.values(matrix).flatMap((m) => Object.entries(m).filter(([k]) => k !== "healthSync").flatMap(([, row]) => Object.values(row)));
const pass = cellsAll.filter((c) => c === "PASS").length;
const na = cellsAll.filter((c) => c === "n/a").length;
console.log(`\n  ${pass} cells passed, ${failures.length} failed, ${na} not applicable`);
if (failures.length) console.log(`  failures:\n    ${failures.join("\n    ")}`);
if (errors.length) console.log(`  console errors:\n    ${errors.slice(0, 10).join("\n    ")}`);
await browser.close();
server.close();
peerHttp.close();
process.exit(failures.length || errors.length ? 1 : 0);
