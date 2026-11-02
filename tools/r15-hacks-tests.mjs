// Round 15 hacks tests: the Creative hacks (js/hacks.js, js/hacks-ui.js and
// their hooks in weapons.js, player.js, effects.js, interaction.js). In the
// browser (a Missions world, so the mod weapons work): wired in (the pause
// menu's button, the screen); Survival can't use them and switching to it
// clears them; every hack's effect and that turning it off restores the
// game: no reload, rapid fire, no overheat, explosion size (and not for
// another player's blast or a creeper's), one-hit kills, the super punch,
// explosive ammo; super speed, jump, gravity, fly speed, ghost flight, the
// jetpack, size (and growing only with room); reach, area mining, instant
// mining; x-ray, night vision, the clock, bullet time, frozen creatures, the
// army, smite; the hand powers (chain lightning, the gravity gun with a
// block and a creature, nuke rain); the vehicles (no reload, no overheat,
// turbo, god mode, infinite boost); fireworks on kills and the rainbow
// trail; the screen's controls and Reset. With --online: a guest's hacks
// are its own (the host's stay off), its one-hit kill lands on the host's
// creature, its bigger blast arrives at its size; the guest can't freeze the
// host's creatures or use bullet time.
//
//   node r15-hacks-tests.mjs [--only=substring] [--online]
// (GAME_ROOT=dir runs another copy of the game; SHOTS=dir saves screenshots.)
import http from "node:http";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";

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

const { chromium } = await import("playwright-core");
const PORT = 9730 + Math.floor(Math.random() * 40);
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
const out = process.env.SHOTS || "";

// A flat stone field (grass on top) round the player at y 90, open sky; the
// player on it facing -z; every hack off; Creative.
const FIELD = `async (g) => {
  const p = g.player;
  const x0 = Math.floor(p.position.x), z0 = Math.floor(p.position.z);
  for (let i = 0; i < 200; i++) { let ok = true; for (let z = z0 - 48; z <= z0 + 24; z += 16) for (let x = x0 - 24; x <= x0 + 24; x += 16) if (!g.world.getChunk(x >> 4, z >> 4)) ok = false; if (ok) break; await new Promise((r) => setTimeout(r, 300)); }
  const y = 90;
  const list = [];
  for (let x = x0 - 24; x <= x0 + 24; x++) for (let z = z0 - 48; z <= z0 + 24; z++) { list.push(x, y - 2, z, 1, x, y - 1, z, 2); for (let k = 0; k < 24; k++) list.push(x, y + k, z, 0); }
  g.world.setBlocks(list);
  for (const m of [...g.mobs.mobs]) m.dead = true;
  g.mobs.update(1 / 30);
  for (const v of [...g.vehicles.vehicles]) if (!v.puppet) g.vehicles.remove(v);
  if (g.vehicles.active) g.vehicles.exit({ force: true });
  g.setMode("creative");
  g.hacks.reset();
  g.hacks.update(0.016);
  p.flying = false;
  p.position.set(x0 + 0.5, y, z0 + 0.5);
  p.velocity.set(0, 0, 0);
  p.yaw = 0;
  p.pitch = 0;
  return { x0, y, z0 };
}`;
const field = (p) => p.evaluate((src) => new Function("g", `return (${src})(g);`)(window.__ufo), FIELD);

const page = await newPage("solo");
const onlineOnly = args.only && String(args.only).includes("online");
if (!onlineOnly) {
  await browserCheck("boot: wired in (the system, the pause menu's button with the call-ins, the screen)", async () => {
    await page.goto(`http://127.0.0.1:${PORT}/index.html?seed=8151&type=missions&graphics=low`, { waitUntil: "load", timeout: 60000 });
    await page.waitForFunction(() => !!window.__ufo && window.__ufo.graphicsReady, null, { timeout: 120000 });
    await play(page);
    const r = await v(page, (g) => ({
      system: !!g.hacks && typeof g.hacks.update === "function",
      button: !!document.querySelector("#pause-callins #pause-hacks-btn"),
      screen: !!document.querySelector("#hacks-screen #hacks-body") && !!document.querySelector("#hacks-screen .back-btn"),
      powers: g.interaction.powers === g.hacks,
    }));
    assert(Object.values(r).every(Boolean), `wired: ${JSON.stringify(r)}`);
  });

  await browserCheck("Survival: no hacks (the button hidden, nothing works, switching to Survival clears them)", async () => {
    await field(page);
    const r = await v(page, (g) => {
      const h = g.hacks;
      const out = {};
      g.setMode("survival");
      h.update(0.016);
      out.hidden = document.getElementById("pause-callins").classList.contains("hidden");
      h.set("noReload", true);
      h.set("speedMul", 4);
      h.update(0.016);
      out.allowed = h.allowed;
      out.list = h.activeList().length;
      // The pistol still spends its magazine.
      g.weapons.refill();
      for (let i = 0; i < 3; i++) {
        g.weapons._cooldowns.pistol = 0;
        g.weapons.press("pistol");
      }
      out.ammo = g.weapons.ammo.pistol;
      // Creative: they work.
      g.setMode("creative");
      h.update(0.016);
      out.cHidden = document.getElementById("pause-callins").classList.contains("hidden");
      g.weapons.refill();
      for (let i = 0; i < 3; i++) {
        g.weapons._cooldowns.pistol = 0;
        g.weapons.press("pistol");
      }
      out.cAmmo = g.weapons.ammo.pistol;
      // Back to Survival: off and cleared; Creative again: still off.
      g.setMode("survival");
      h.update(0.016);
      out.cleared = h.values.noReload === false && h.values.speedMul === 1;
      g.setMode("creative");
      h.update(0.016);
      out.after = h.activeList().length;
      return out;
    });
    assert(r.hidden && !r.cHidden, `the button with the call-ins, Creative only: ${JSON.stringify(r)}`);
    assert(!r.allowed && r.list === 0 && r.ammo === 9, `Survival: nothing: ${JSON.stringify(r)}`);
    assert(r.cAmmo === 12, `Creative: no reload works: ${JSON.stringify(r)}`);
    assert(r.cleared && r.after === 0, `Survival clears them: ${JSON.stringify(r)}`);
  });

  await browserCheck("weapons: no reload, rapid fire, no overheat (and off restores each)", async () => {
    await field(page);
    const r = await v(page, (g) => {
      const h = g.hacks;
      const w = g.weapons;
      const out = {};
      const shoot = (kind, n) => {
        for (let i = 0; i < n; i++) {
          w._cooldowns[kind] = 0;
          w.press(kind);
          w.release();
        }
      };
      h.set("noReload", true);
      h.update(0.016);
      w.refill();
      shoot("pistol", 30);
      out.noReload = [w.ammo.pistol, w.reloadT.pistol];
      shoot("sniper", 0);
      w.sniperShot();
      w.sniperShot();
      out.sniper = w.ammo.sniper;
      h.set("noReload", false);
      h.update(0.016);
      w.refill();
      shoot("pistol", 12);
      out.off = [w.ammo.pistol, w.reloadT.pistol > 0];
      // Rapid fire: the pistol's wait divided.
      w.refill();
      h.set("fireRate", 5);
      h.update(0.016);
      w.press("pistol");
      out.gap5 = w._cooldowns.pistol;
      h.set("fireRate", 1);
      h.update(0.016);
      w._cooldowns.pistol = 0;
      w.press("pistol");
      out.gap1 = w._cooldowns.pistol;
      // No overheat: the minigun.
      w.refill();
      h.set("noOverheat", true);
      h.update(0.016);
      const m = w.minigun;
      m.held = true;
      m.spin = 1;
      const kind = "minigun";
      for (let i = 0; i < 300; i++) w._updateMinigun(1 / 30, kind);
      out.hot = [m.heat, m.overheated];
      h.set("noOverheat", false);
      h.update(0.016);
      m.held = true;
      out.hotOff = false;
      for (let i = 0; i < 300; i++) {
        w._updateMinigun(1 / 30, kind);
        out.hotOff ||= m.overheated;
      }
      m.held = false;
      w.refill();
      return out;
    });
    assert(r.noReload[0] === 12 && r.noReload[1] === 0 && r.sniper === 1, `no reload: ${JSON.stringify(r)}`);
    assert(r.off[0] === 0 && r.off[1], `off: the magazine empties and reloads: ${JSON.stringify(r)}`);
    assert(Math.abs(r.gap5 - 0.04) < 1e-6 && Math.abs(r.gap1 - 0.2) < 1e-6, `rapid fire: ${JSON.stringify(r)}`);
    assert(r.hot[0] < 0.01 && !r.hot[1] && r.hotOff, `no overheat: ${JSON.stringify(r)}`);
  });

  await browserCheck("explosion size: this player's blasts x4 (the crater capped), not another player's or a creeper's; off restores", async () => {
    const f = await field(page);
    const r = await v(page, (g, f) => {
      const T = g.THREE;
      const h = g.hacks;
      const at = new T.Vector3(f.x0 + 0.5, f.y - 1, f.z0 - 30);
      const out = {};
      h.set("blastMul", 4);
      h.update(0.016);
      const opts = { radius: 7, source: "grenade" };
      g.effects.explode(at.clone(), opts);
      out.big = { ...g.effects.lastExplosion, sent: opts.radius };
      g.effects.explode(at.clone().setX(at.x + 20), { radius: 7, source: "grenade", mirror: true });
      out.mirror = g.effects.lastExplosion.radius;
      g.effects.explode(at.clone().setX(at.x - 20), { radius: 3, source: "creeper", carve: false });
      out.creeper = g.effects.lastExplosion.radius;
      h.set("blastMul", 1);
      h.update(0.016);
      g.effects.explode(at.clone().setZ(at.z + 14), { radius: 7, source: "grenade", carve: false });
      out.off = g.effects.lastExplosion.radius;
      return out;
    }, f);
    assert(r.big.radius === 28 && r.big.hacked === 4 && r.big.sent === 28, `x4: ${JSON.stringify(r.big)}`);
    assert(r.big.maxDist < 24 && r.big.removed > 1000, `the crater capped: ${JSON.stringify(r.big)}`);
    assert(r.mirror === 7 && r.creeper === 3 && r.off === 7, `others unchanged, off restores: ${JSON.stringify(r)}`);
  });

  await browserCheck("one-hit kills and the super punch (and off restores); explosive ammo", async () => {
    const f = await field(page);
    const r = await v(page, async (g, f) => {
      const h = g.hacks;
      const out = {};
      const zombie = (dz) => g.mobs.spawn("zombie", f.x0 + 0.5, f.y, f.z0 - dz);
      // A bare-handed blow: one hit kills.
      h.set("oneHit", true);
      h.update(0.016);
      const z1 = zombie(2);
      g.mobs.lastAttackTime = -99;
      g.mobs.attack(z1, null);
      out.oneHit = z1.dead;
      h.set("oneHit", false);
      h.update(0.016);
      const z2 = zombie(2);
      g.mobs.lastAttackTime = -99;
      g.mobs.attack(z2, null);
      out.offHit = [z2.dead, z2.health];
      z2.dead = true;
      // The super punch: a far bigger push.
      const z3 = zombie(2);
      g.mobs.lastAttackTime = -99;
      z3.knock.set(0, 0, 0);
      g.mobs.attack(z3, null);
      out.kb0 = Math.hypot(z3.knock.x, z3.knock.z);
      z3.invulnerable = 0;
      z3.knock.set(0, 0, 0);
      h.set("superPunch", true);
      h.update(0.016);
      g.mobs.lastAttackTime = -99;
      g.mobs.attack(z3, null);
      out.kb1 = Math.hypot(z3.knock.x, z3.knock.z);
      z3.dead = true;
      h.set("superPunch", false);
      // Explosive ammo: a pistol shot at the ground ahead blows up there.
      g.mobs.update(1 / 30);
      h.set("explosiveAmmo", true);
      h.update(0.016);
      g.player.pitch = -0.5;
      const n0 = g.effects.explosionCount;
      g.weapons.refill();
      g.weapons.press("pistol");
      for (let i = 0; i < 20; i++) g.weapons.update(1 / 30);
      out.boom = g.effects.explosionCount - n0;
      out.src = g.effects.lastExplosion.source;
      h.set("explosiveAmmo", false);
      h.update(0.016);
      const n1 = g.effects.explosionCount;
      g.weapons._cooldowns.pistol = 0;
      g.weapons.press("pistol");
      for (let i = 0; i < 20; i++) g.weapons.update(1 / 30);
      out.boomOff = g.effects.explosionCount - n1;
      g.player.pitch = 0;
      return out;
    }, f);
    assert(r.oneHit && !r.offHit[0] && r.offHit[1] > 10, `one-hit: ${JSON.stringify(r)}`);
    assert(r.kb1 > r.kb0 * 3, `super punch: ${JSON.stringify(r)}`);
    assert(r.boom === 1 && r.src === "hackammo" && r.boomOff === 0, `explosive ammo: ${JSON.stringify(r)}`);
  });

  await browserCheck("the body: super speed, super jump, Moon gravity, fly speed, ghost flight, jetpack, size (only with room); off restores", async () => {
    const f = await field(page);
    const r = await v(page, (g, f) => {
      const h = g.hacks;
      const p = g.player;
      const out = {};
      const reset = () => {
        p.position.set(f.x0 + 0.5, f.y, f.z0 + 0.5);
        p.velocity.set(0, 0, 0);
        p.knockback.set(0, 0, 0);
        p.onGround = true;
        p.keys.clear();
      };
      const walk = (n) => {
        reset();
        p.keys.add("KeyW");
        for (let i = 0; i < n; i++) p.update(1 / 30);
        p.keys.clear();
        return f.z0 + 0.5 - p.position.z;
      };
      const jump = () => {
        reset();
        for (let i = 0; i < 3; i++) p.update(1 / 30);
        p.keys.add("Space");
        let top = p.position.y;
        for (let i = 0; i < 240; i++) {
          p.update(1 / 30);
          if (i === 1) p.keys.delete("Space");
          top = Math.max(top, p.position.y);
        }
        return top - f.y;
      };
      const was = p.enabled;
      p.enabled = true;
      out.walk1 = walk(30);
      h.set("speedMul", 4);
      h.update(0.016);
      out.walk4 = walk(30);
      h.set("speedMul", 1);
      h.update(0.016);
      out.jump1 = jump();
      h.set("jumpMul", 4);
      h.update(0.016);
      out.jump4 = jump();
      h.set("jumpMul", 1);
      h.set("gravity", 0.165);
      h.update(0.016);
      out.moon = jump();
      h.set("gravity", 1);
      h.update(0.016);
      out.jumpOff = jump();
      // Fly speed.
      const fly = (n) => {
        reset();
        p.position.y = f.y + 6;
        p.flying = true;
        p.keys.add("KeyW");
        for (let i = 0; i < n; i++) p.update(1 / 30);
        p.keys.clear();
        p.flying = false;
        return f.z0 + 0.5 - p.position.z;
      };
      out.fly1 = fly(20);
      h.set("flyMul", 3);
      h.update(0.016);
      out.fly3 = fly(20);
      h.set("flyMul", 1);
      // Ghost flight: through a wall (and not without it).
      const wall = [];
      for (let x = -3; x <= 3; x++) for (let y = 0; y < 12; y++) wall.push(f.x0 + x, f.y + y, f.z0 - 3, 1);
      g.world.setBlocks(wall);
      out.wallOff = fly(20);
      h.set("noclip", true);
      h.update(0.016);
      out.wallGhost = fly(20);
      h.set("noclip", false);
      g.world.setBlocks(wall.map((v, i) => (i % 4 === 3 ? 0 : v)));
      // The jetpack: Space held in the air rises.
      h.set("jetpack", true);
      h.update(0.016);
      reset();
      p.position.y = f.y + 3;
      p.onGround = false;
      p.keys.add("Space");
      for (let i = 0; i < 45; i++) p.update(1 / 30);
      p.keys.clear();
      out.jet = p.position.y - (f.y + 3);
      h.set("jetpack", false);
      h.update(0.016);
      // Size: giant in the open; in a tunnel 2 high it waits.
      reset();
      h.set("size", 3);
      h.update(0.016);
      p.update(1 / 30);
      out.giant = [p.size, p.bodyHeight, p.eyeHeight];
      h.set("size", 0.3);
      h.update(0.016);
      p.update(1 / 30);
      out.tiny = p.size;
      reset();
      const roof = [];
      for (let x = -2; x <= 2; x++) for (let z = -2; z <= 2; z++) roof.push(f.x0 + x, f.y + 2, f.z0 + z, 1);
      g.world.setBlocks(roof);
      h.set("size", 3);
      h.update(0.016);
      p.update(1 / 30);
      out.roofed = p.size;
      g.world.setBlocks(roof.map((v, i) => (i % 4 === 3 ? 0 : v)));
      p.update(1 / 30);
      out.unroofed = p.size;
      h.set("size", 1);
      h.update(0.016);
      p.update(1 / 30);
      out.normal = [p.size, p.bodyHeight];
      p.enabled = was;
      reset();
      return out;
    }, f);
    assert(r.walk4 > r.walk1 * 3.5, `super speed: ${JSON.stringify(r)}`);
    assert(r.jump4 > r.jump1 * 3.3 && r.moon > r.jump1 * 4.5 && Math.abs(r.jumpOff - r.jump1) < 0.05, `jump and gravity: ${JSON.stringify(r)}`);
    assert(r.fly3 > r.fly1 * 2.6, `fly speed: ${JSON.stringify(r)}`);
    assert(r.wallOff < 3 && r.wallGhost > 6, `ghost flight: ${JSON.stringify(r)}`);
    assert(r.jet > 4, `jetpack: ${JSON.stringify(r)}`);
    assert(r.giant[0] === 3 && Math.abs(r.giant[1] - 5.4) < 1e-6 && r.tiny === 0.3, `size: ${JSON.stringify(r)}`);
    assert(r.roofed === 0.3 && r.unroofed === 3 && r.normal[0] === 1 && Math.abs(r.normal[1] - 1.8) < 1e-6, `grows with room only: ${JSON.stringify(r)}`);
  });

  await browserCheck("building: super reach, area mining (no bedrock), instant mining; x-ray; night vision; off restores", async () => {
    const f = await field(page);
    const r = await v(page, (g, f) => {
      const h = g.hacks;
      const it = g.interaction;
      const out = {};
      out.reach0 = it.reach;
      h.set("reach", 40);
      h.update(0.016);
      out.reach = it.reach;
      h.set("reach", 6);
      h.update(0.016);
      out.reachOff = it.reach;
      // Area mining: a stone cube with bedrock (the world's floor's block) in its middle row.
      const BED = g.world.getBlock(f.x0, 0, f.z0);
      out.bedId = BED;
      const cube = [];
      const cx = f.x0, cy = f.y + 3, cz = f.z0 - 8;
      for (let x = -2; x <= 2; x++) for (let y = -2; y <= 2; y++) for (let z = -2; z <= 2; z++) cube.push(cx + x, cy + y, cz + z, y === 1 && x === 0 && z === 0 ? BED : 1);
      g.world.setBlocks(cube);
      h.set("mineArea", 3);
      h.update(0.016);
      it.target = { block: [cx, cy, cz], id: 1, normal: [0, 0, 1], distance: 3 };
      it._startMining();
      let left = 0;
      for (let x = -1; x <= 1; x++) for (let y = -1; y <= 1; y++) for (let z = -1; z <= 1; z++) if (g.world.getBlock(cx + x, cy + y, cz + z)) left++;
      out.left = left;
      out.bedrock = g.world.getBlock(cx, cy + 1, cz);
      out.outer = g.world.getBlock(cx + 2, cy, cz);
      out.cd = it._breakCooldown;
      h.set("fastMine", true);
      h.update(0.016);
      it.target = { block: [cx + 2, cy, cz], id: 1, normal: [0, 0, 1], distance: 3 };
      it._startMining();
      out.cdFast = it._breakCooldown;
      h.set("fastMine", false);
      h.set("mineArea", 1);
      it.target = { block: [cx + 2, cy + 2, cz + 2], id: 1, normal: [0, 0, 1], distance: 3 };
      h.update(0.016);
      it._startMining();
      out.single = g.world.getBlock(cx + 2, cy + 2, cz + 1) === 1;
      g.world.setBlocks(cube.map((v, i) => (i % 4 === 3 ? 0 : v)));
      it.target = null;
      return out;
    }, f);
    assert(r.reach0 === 6 && r.reach === 40 && r.reachOff === 6, `reach: ${JSON.stringify(r)}`);
    assert(r.bedId > 0 && r.left === 1 && r.bedrock === r.bedId && r.outer === 1 && r.single, `area mining: ${JSON.stringify(r)}`);
    assert(r.cd > 0.2 && r.cdFast < 0.1, `instant mining: ${JSON.stringify(r)}`);
    const xr = await v(page, (g, f) => {
      const h = g.hacks;
      const out = {};
      // X-ray: an ore buried under the field (the first block id it shows).
      h.set("xray", true);
      h.update(0.016);
      const base = h.xrayCount;
      let ore = 0;
      for (let i = 1; i < 4096 && !ore; i++) {
        g.world.setBlock(f.x0, f.y - 2, f.z0 - 4, i);
        h._xrayT = 0;
        h.update(0.016);
        if (h.xrayCount > base) ore = i;
      }
      out.ore = ore;
      out.count = [base, h.xrayCount];
      out.visible = h._xray?.visible;
      g.world.setBlock(f.x0, f.y - 2, f.z0 - 4, 1);
      h.set("xray", false);
      h.update(0.016);
      out.off = h._xray?.visible;
      h.set("nightVision", true);
      h.update(0.016);
      out.nv = g.uniforms.uNightVision.value;
      h.set("nightVision", false);
      h.update(0.016);
      return out;
    }, f);
    assert(xr.ore > 0 && xr.visible && xr.off === false, `x-ray: ${JSON.stringify(xr)}`);
    assert(xr.nv === 1, `night vision: ${JSON.stringify(xr)}`);
  });

  await browserCheck("the world: the clock (frozen, x120, the time buttons), bullet time, frozen creatures, the army, smite", async () => {
    const f = await field(page);
    const r = await v(page, (g, f) => {
      const h = g.hacks;
      const out = {};
      h.set("dayClock", "frozen");
      h.update(0.016);
      out.frozen = g.sky.timeScale;
      h.set("dayClock", "hyper");
      h.update(0.016);
      out.hyper = g.sky.timeScale;
      h.set("dayClock", "normal");
      h.update(0.016);
      out.normal = g.sky.timeScale;
      h.setTime(12);
      out.noon = g.sky.hours;
      // Bullet time.
      h.set("bulletTime", 0.25);
      h.slowmo = true;
      h.update(0.016);
      out.warp = h.timeWarp;
      out.vignette = document.body.classList.contains("hack-slowmo");
      h.set("bulletTime", 0);
      h.update(0.016);
      out.warpOff = h.timeWarp;
      h.slowmo = false;
      // Frozen creatures.
      const z = g.mobs.spawn("zombie", f.x0 + 0.5, f.y, f.z0 - 10);
      h.set("freezeMobs", true);
      h.update(0.016);
      const p0 = z.pos.clone();
      z.ai.state = "wander";
      for (let i = 0; i < 30; i++) {
        g.mobs.update(1 / 30);
        h.update(1 / 30);
      }
      out.frozenMoved = Math.hypot(z.pos.x - p0.x, z.pos.z - p0.z);
      out.held = [z.stagger > 0, z.attackCooldown > 0];
      h.set("freezeMobs", false);
      h.update(0.016);
      for (let i = 0; i < 40; i++) g.mobs.update(1 / 30);
      out.thawed = [z.stagger, z.attackCooldown];
      // Smite: lightning on the hostiles.
      out.smote = h.smite();
      g.mobs.update(1 / 30);
      out.smoteDead = z.dead;
      // The army.
      const c0 = g.mobs.countKind("chicken");
      h.spawnArmy("chicken", 4);
      for (let i = 0; i < 20; i++) h.update(0.1);
      out.army = g.mobs.countKind("chicken") - c0;
      return out;
    }, f);
    assert(r.frozen === 0 && r.hyper === 120 && r.normal === 1 && Math.abs(r.noon - 12) < 0.05, `clock: ${JSON.stringify(r)}`);
    assert(r.warp === 0.25 && r.vignette && r.warpOff === 1, `bullet time: ${JSON.stringify(r)}`);
    assert(r.frozenMoved < 0.05 && r.held[0] && r.held[1] && r.thawed[0] === 0, `frozen creatures: ${JSON.stringify(r)}`);
    assert(r.smote >= 1 && r.smoteDead, `smite: ${JSON.stringify(r)}`);
    assert(r.army === 4, `the army: ${JSON.stringify(r)}`);
  });

  await browserCheck("hand powers: chain lightning down a line of creatures, the gravity gun (a block thrown lands, a creature held), nuke rain", async () => {
    const f = await field(page);
    const r = await v(page, async (g, f) => {
      const h = g.hacks;
      const it = g.interaction;
      const out = {};
      g.inventory.selected = 8;
      g.inventory.slots[8] = null;
      out.empty = !g.inventory.selectedStack;
      // Nothing set: the click is the hand's own.
      out.noPower = h.press();
      h.set("power", "lightning");
      h.update(0.016);
      const zs = [0, 1, 2].map((i) => g.mobs.spawn("zombie", f.x0 + 0.5 + i * 3, f.y, f.z0 - 6 - i * 2));
      g.player.pitch = -0.12;
      g.player.yaw = 0;
      for (const z of zs) z.invulnerable = 0;
      const hp = zs.map((z) => z.health);
      it.mouseDown(2);
      it.mouseUp(2);
      out.hits = h.lightningHits;
      out.hurt = zs.map((z, i) => hp[i] - z.health);
      for (const z of zs) z.dead = true;
      g.mobs.update(1 / 30);
      // The gravity gun: a block lifted and thrown.
      h.set("power", "gravity");
      h.update(0.016);
      g.player.pitch = -0.6;
      g.interaction.updateTarget(true);
      const t = g.world.raycast(g.player.getEyePosition(), g.player.getForwardVector(), 40, { solidOnly: true });
      const cell = t.block;
      const id0 = g.world.getBlock(...cell);
      it.mouseDown(2);
      it.mouseUp(2);
      out.lifted = !!h.grab && h.grab.id === id0 && g.world.getBlock(...cell) === 0;
      for (let i = 0; i < 10; i++) h.update(1 / 30);
      // (Left click: dropped ahead, turned away from the hole it left.)
      g.player.pitch = 0.2;
      g.player.yaw = 1.2;
      for (let i = 0; i < 20; i++) h.update(1 / 30);
      it.mouseDown(0);
      it.mouseUp(0);
      out.thrown = h._thrown.length;
      for (let i = 0; i < 200 && h._thrown.length; i++) h.update(1 / 30);
      out.landed = h._thrown.length === 0;
      // (It landed somewhere as a block, not where it was taken from.)
      const at = h.lastLanded;
      out.placed = !!at && g.world.getBlock(...at) === id0 && at.join() !== cell.join();
      out.at = [at, cell];
      g.player.yaw = 0;
      // A creature held in front, up in the air.
      g.player.pitch = -0.1;
      const z = g.mobs.spawn("zombie", f.x0 + 0.5, f.y, f.z0 - 5);
      it.mouseDown(2);
      it.mouseUp(2);
      out.heldMob = h.grab?.mob === z;
      g.player.pitch = 0.5;
      for (let i = 0; i < 20; i++) {
        g.mobs.update(1 / 30);
        h.update(1 / 30);
      }
      out.mobUp = z.pos.y - f.y;
      g.player.pitch = 0;
      it.mouseDown(0);
      it.mouseUp(0);
      out.dropped = !h.grab;
      z.dead = true;
      // Nuke rain: three nukes, one after another.
      h.set("power", "nuke");
      h.set("nukeSize", 12);
      h.update(0.016);
      g.player.pitch = -0.35;
      const n0 = g.nuke.count ?? 0;
      const d0 = h.nukesDropped || 0;
      it.mouseDown(2);
      it.mouseUp(2);
      out.queued = h._nukes.length;
      for (let i = 0; i < 160 && h._nukes.length; i++) h.update(1 / 30);
      out.dropped3 = (h.nukesDropped || 0) - d0;
      out.nukeCount = (g.nuke.count ?? 0) - n0;
      h.set("power", "");
      h.update(0.016);
      g.player.pitch = 0;
      return out;
    }, f);
    assert(r.empty && r.noPower === false, `empty hand, no power: ${JSON.stringify(r)}`);
    assert(r.hits === 3 && r.hurt.every((d) => d > 0), `chain lightning: ${JSON.stringify(r)}`);
    assert(r.lifted && r.thrown === 1 && r.landed && r.placed, `gravity gun, a block: ${JSON.stringify(r)}`);
    assert(r.heldMob && r.mobUp > 1.5 && r.dropped, `gravity gun, a creature: ${JSON.stringify(r)}`);
    assert(r.queued === 3 && r.dropped3 === 3, `nuke rain: ${JSON.stringify(r)}`);
  });

  await browserCheck("vehicles: no reload, no overheat, turbo (x3 as far), god mode (and off: hurt again), infinite boost", async () => {
    const f = await field(page);
    const r = await v(page, (g, f) => {
      const h = g.hacks;
      const out = {};
      const V = g.vehicles;
      // A helicopter in the air, flying forward.
      const fly = (n) => {
        const heli = V.create("heli", { kind: "apache", pos: [f.x0 + 0.5, f.y + 30, f.z0 + 0.5], yaw: 0, airborne: true });
        V.enter(heli);
        g.player.keys.add("KeyW");
        for (let i = 0; i < 20; i++) V.update(1 / 30);
        const z0 = heli.pos.z;
        for (let i = 0; i < n; i++) V.update(1 / 30);
        g.player.keys.delete("KeyW");
        const d = z0 - heli.pos.z;
        return { heli, d };
      };
      const a = fly(30);
      out.d1 = a.d;
      V.exit({ force: true });
      V.remove(a.heli);
      h.set("turbo", 3);
      h.update(0.016);
      const b = fly(30);
      out.d3 = b.d;
      h.set("turbo", 1);
      h.update(0.016);
      const heli = b.heli;
      // No reload, no overheat.
      heli.heat = 0.9;
      heli.jammed = true;
      heli.missileT = 5;
      heli.rockets = 0;
      h.set("noReload", true);
      h.set("noOverheat", true);
      h.update(0.016);
      out.refill = [heli.heat, heli.jammed, heli.missileT, heli.rockets === heli.spec.rockets];
      h.set("noReload", false);
      h.set("noOverheat", false);
      // God mode.
      h.set("godMode", true);
      h.update(0.016);
      const hp = heli.health;
      out.godHit = heli.damage(40, "test");
      out.godHp = heli.health === hp;
      h.set("godMode", false);
      h.update(0.016);
      out.wrapped = Object.hasOwn(heli, "damage");
      heli.damage(40, "test");
      out.hurtAgain = heli.health < hp;
      V.exit({ force: true });
      V.remove(heli);
      // Infinite boost: the UFO's dash cooldown.
      const u = V.create("ufo", { design: 0, seed: 7, radius: 5, pos: [f.x0, f.y + 40, f.z0], yaw: 0 });
      V.enter(u);
      u.dashT = 3;
      h.set("infiniteBoost", true);
      h.update(0.016);
      out.dashT = u.dashT;
      h.set("infiniteBoost", false);
      h.update(0.016);
      V.exit({ force: true });
      V.remove(u);
      return out;
    }, f);
    assert(r.d3 > r.d1 * 2.4 && r.d1 > 3, `turbo: ${JSON.stringify(r)}`);
    assert(r.refill[0] === 0 && r.refill[1] === false && r.refill[2] <= 0.25 && r.refill[3], `no reload, no overheat: ${JSON.stringify(r)}`);
    assert(r.godHit === false && r.godHp && !r.wrapped && r.hurtAgain, `god mode: ${JSON.stringify(r)}`);
    assert(r.dashT === 0, `infinite boost: ${JSON.stringify(r)}`);
  });

  await browserCheck("the party: fireworks on a kill, the rainbow trail; the screen (groups, a toggle, a slider, Reset); a screenshot", async () => {
    const f = await field(page);
    const r = await v(page, (g, f) => {
      const h = g.hacks;
      const out = {};
      h.set("killFx", true);
      h.set("oneHit", true);
      h.update(0.016);
      const z = g.mobs.spawn("zombie", f.x0 + 0.5, f.y, f.z0 - 2);
      const n0 = h.fireworksCount || 0;
      g.mobs.lastAttackTime = -99;
      g.mobs.attack(z, null);
      h.update(0.016);
      out.fireworks = (h.fireworksCount || 0) - n0;
      h.set("trail", true);
      h.update(0.016);
      const live0 = g.effects.glow.count ?? null;
      g.player.position.z -= 3;
      h.update(0.016);
      out.trail = live0 === null || (g.effects.glow.count ?? 0) > live0;
      // The screen.
      document.getElementById("pause-hacks-btn").click();
      out.open = !document.getElementById("hacks-screen").classList.contains("hidden");
      out.groups = document.querySelectorAll("#hacks-body .hk-group").length;
      const sw = [...document.querySelectorAll("#hacks-body .hk-row")].find((r) => r.textContent.startsWith("Jetpack"))?.querySelector(".hk-switch");
      sw?.click();
      out.toggled = h.values.jetpack === true && sw?.classList.contains("on");
      const rng = [...document.querySelectorAll("#hacks-body .hk-row")].find((r) => r.textContent.startsWith("Explosion size"))?.querySelector("input");
      rng.value = 6;
      rng.dispatchEvent(new Event("input"));
      out.slider = h.values.blastMul === 6;
      out.hud = h.activeList().length;
      return out;
    }, f);
    if (out) {
      await frames(page, 4);
      await page.screenshot({ path: path.join(out, "r15-hacks-screen.png") });
    }
    const r2 = await v(page, (g) => {
      const h = g.hacks;
      document.getElementById("hacks-reset").click();
      const out = { after: h.activeList().length, saved: localStorage.getItem(`ufocombat_v1_hacks_8151`) };
      g.screens.back();
      return out;
    });
    assert(r.fireworks === 1, `fireworks: ${JSON.stringify(r)}`);
    assert(r.trail, `trail: ${JSON.stringify(r)}`);
    assert(r.open && r.groups === 8 && r.toggled && r.slider && r.hud >= 4, `the screen: ${JSON.stringify(r)}`);
    assert(r2.after === 0 && r2.saved === null, `reset: ${JSON.stringify(r2)}`);
  });
}

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
  await browserCheck("online: a guest's hacks are its own; its one-hit kill lands on the host's creature, its big blast arrives at its size; no freezing the host's creatures or bullet time", async () => {
    await host.goto(`http://127.0.0.1:${PORT}/index.html?seed=8152&type=missions&${NET_Q}`, { waitUntil: "load", timeout: 60000 });
    await host.waitForFunction(() => !!window.__ufo && window.__ufo.graphicsReady, null, { timeout: 120000 });
    await host.click("#menu-mp-btn");
    await host.fill("#mp-nick", "Alice");
    await host.click("#mp-host-btn");
    const code = await until(host, (g) => g.net.code, 30000);
    assert(code, "no room code");
    await host.click("#mp-lobby-play");
    await host.waitForFunction(() => window.__ufo.gameState === "playing", null, { timeout: 30000 });
    const f = await field(host);
    await v(host, (g) => { g.mp.rules?.setMode?.("creative"); return true; });
    await guest.goto(`http://127.0.0.1:${PORT}/index.html?join=${code}&${NET_Q}`, { waitUntil: "load", timeout: 60000 });
    await guest.waitForSelector("#mp-join-boot:not(.hidden)", { timeout: 30000 });
    await guest.fill("#mp-boot-nick", "Bob");
    await guest.click("#mp-boot-join");
    await guest.waitForFunction(() => !!window.__ufo && window.__ufo.graphicsReady, null, { timeout: 120000 });
    assert(await until(guest, (g) => g.mp.stateLoaded, 60000), "the host's state never arrived");
    await play(guest);
    assert(await until(guest, (g) => g.player.creative, 20000), "the guest isn't in Creative (the host's mode)");
    await v(guest, (g, f) => { g.player.position.set(f.x0 + 0.5, f.y, f.z0 + 0.5); g.player.yaw = 0; g.player.pitch = 0; return true; }, f);
    // The guest's hacks.
    const gs = await v(guest, (g) => {
      const h = g.hacks;
      h.set("oneHit", true);
      h.set("blastMul", 3);
      h.set("freezeMobs", true);
      h.set("bulletTime", 0.25);
      h.update(0.016);
      h.slowmo = true;
      return { usableFreeze: h.usable({ host: true }), warp: h.timeWarp, list: h.activeList() };
    });
    const hs = await v(host, (g) => ({ list: g.hacks.activeList().length }));
    assert(!gs.usableFreeze && gs.warp === 1, `the guest can't freeze the host's creatures or slow the world: ${JSON.stringify(gs)}`);
    assert(hs.list === 0, `the host's hacks stay off: ${JSON.stringify(hs)}`);
    // A host zombie; the guest's bare hand kills it in one blow.
    const id = await v(host, (g, f) => { const z = g.mobs.spawn("husk", f.x0 + 0.5, f.y, f.z0 - 2) || g.mobs.spawn("zombie", f.x0 + 0.5, f.y, f.z0 - 2); return z.id; }, f);
    const seen = await until(guest, (g, id) => (g.mobs.mobs.find((m) => m.net && (m.net.id ?? m.id) === id) ? true : null), 20000, id);
    assert(seen, "the guest never saw the host's zombie");
    await v(guest, (g, id) => { const m = g.mobs.mobs.find((x) => x.net && (x.net.id ?? x.id) === id); g.mobs.lastAttackTime = -99; g.mobs.attack(m, null); return true; }, id);
    const dead = await until(host, (g, id) => { const m = g.mobs.mobs.find((x) => x.id === id); return !m || m.dead ? true : null; }, 15000, id);
    assert(dead, "the host's zombie survived the guest's one-hit blow");
    // The guest's grenade blast x3: the host sees it at 21.
    const n0 = await v(host, (g) => g.effects.explosionCount);
    await v(guest, (g, f) => { g.effects.explode(new g.THREE.Vector3(f.x0 + 0.5, f.y - 1, f.z0 - 30), { radius: 7, source: "grenade" }); return true; }, f);
    const seenR = await until(host, (g, n0) => (g.effects.explosionCount > n0 && g.effects.lastExplosion.source === "grenade" ? g.effects.lastExplosion.radius : null), 15000, n0);
    assert(Math.abs(seenR - 21) < 0.1, `the host sees the guest's blast at its size: ${seenR}`);
    await guest.close();
    await host.close();
  });
  peerHttp.close();
}

await browser.close();
server.close();

const failed = results.filter(([, ok]) => !ok);
console.log(`\n${results.length - failed.length} passed, ${failed.length} failed.`);
process.exit(failed.length ? 1 : 0);
