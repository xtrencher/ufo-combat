// Round 20, track C: the jets' new weapons (js/vehicle-jet.js MINI_NUKE,
// JET_LASER; js/nuke.js; js/fighter-hud.js; js/net/fx.js, js/net/vehicles.js).
// Node: the numbers (the mini-nuke's crater between the super missile's
// blast and the big nuke's, a few aboard, the B-2 more, a long reload; the
// laser's damage, range and heat); the enemy fighters never touch them.
// In the browser (Creative, a clear sky):
// - the weapon switch: X goes missiles -> super missile -> MINI-NUKE ->
//   NOSE LASER -> missiles (1-4 pick); the SR-71: camera -> mini-nuke ->
//   laser; an enemy fighter keeps its own; the HUD and the panel show it;
// - the laser: the beam starts just under the nose of each jet type and
//   points along the nose (and the flight path); it damages a UFO (a ship
//   that dodges still takes most of it), a target block burns away, an
//   enemy fighter is hurt; its pulses are seen by the UFOs (dodging);
// - overheat: 5 s of fire jams it, it cools and works again; the HUD;
// - the mini-nuke: a hit before it arms is a dud; armed, it goes off as a
//   nuke of size 22 (no mission credit): its crater wider than the super
//   missile's blast and far narrower than the big nuke's; the HUD's
//   DANGER CLOSE; a pilot following it too close is hurt, one far off isn't;
//   ammo (none left: a word), the rearm in the air and on the ground;
// - the frame time while one goes off (the real game loop);
// - no console errors throughout.
// With --online (on by default; --solo skips): a host and a guest: the guest
// sees the host's laser beam (and its pulses) and the mini-nuke in flight
// and going off; the guest's own laser hurts the host's UFO.
//
//   node r20-jet-weapons-tests.mjs [--only=substring] [--seed=42] [--solo] [--verbose]
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
const SHOTS = process.env.SHOTS || "";

const results = [];
function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}
async function check(name, fn) {
  if (args.only && !name.startsWith("boot") && !name.toLowerCase().includes(String(args.only).toLowerCase())) return;
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

const jetSrc = fs.readFileSync(path.join(ROOT, "js/vehicle-jet.js"), "utf8");
const block = (name) => new RegExp(`export const ${name} = \\{([\\s\\S]*?)\\n\\};`).exec(jetSrc)?.[1];
const numIn = (b, k) => Number(new RegExp(`\\b${k}: ([\\d.]+)`).exec(b)?.[1]);

await check("the numbers: the mini-nuke between the super missile and the big nuke, a few aboard (the B-2 more), a long reload; the laser", async () => {
  const M = block("MINI_NUKE");
  const S = block("SUPER_MISSILE");
  const L = block("JET_LASER");
  assert(M && S && L, "MINI_NUKE, SUPER_MISSILE, JET_LASER");
  const nukeSrc = fs.readFileSync(path.join(ROOT, "js/nuke.js"), "utf8");
  const big = Number(/NUKE_DEFAULTS = \{ size: (\d+)/.exec(nukeSrc)?.[1]);
  const cw = Number(/const CRATER_W = ([\d.]+)/.exec(nukeSrc)?.[1]);
  const crater = numIn(M, "R") * cw;
  console.log(`    mini-nuke size ${numIn(M, "R")}: crater ~${crater.toFixed(1)} (the super missile's blast ${numIn(S, "radius")}, the big nuke's crater ${big * cw})`);
  assert(crater > numIn(S, "radius") * 2 && crater < big * cw * 0.4, "far bigger than the super missile's, clearly smaller than the big nuke's");
  const ammo = /ammo: \{ f22: (\d+), f16: (\d+), b2: (\d+), sr71: (\d+) \}/.exec(M);
  assert(ammo && +ammo[1] >= 1 && +ammo[1] <= 2 && +ammo[2] >= 1 && +ammo[2] <= 2 && +ammo[3] > +ammo[1] && +ammo[4] >= 1, `ammo: ${ammo?.[0]}`);
  assert(numIn(M, "reload") >= 20 && numIn(M, "rearm") >= 60 && numIn(M, "arm") >= 1, "a long reload and rearm, an arming delay");
  assert(numIn(L, "damage") * numIn(L, "rate") >= 40 && numIn(L, "damage") * numIn(L, "rate") <= 90, "moderate damage a second");
  assert(numIn(L, "range") >= 800 && numIn(L, "heatUp") > 0 && numIn(L, "resume") < 1, "range, heat");
  const enemy = fs.readFileSync(path.join(ROOT, "js/enemy-jets.js"), "utf8");
  assert(!/mininuke|laser|_fireMini|JET_LASER|MINI_NUKE/.test(enemy), "the enemy fighters never use them");
});

// ---------- Browser ----------

const { chromium } = await import("playwright-core");
const PORT = 10740 + Math.floor(Math.random() * 10);
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
  p.on("console", (m) => {
    if (m.type() === "error") errors.push(`[${label}] ${m.text()}`);
    if (args.verbose) console.log(`    [${label}] ${m.text()}`);
  });
  p.on("pageerror", (e) => errors.push(`[${label}] ${String(e)}`));
  p.on("dialog", (d) => d.accept());
  return p;
}
const framesOn = (p, n = 2) =>
  p.evaluate(
    (k) =>
      new Promise((r) => {
        let i = 0;
        const f = () => (++i >= k ? r() : requestAnimationFrame(f));
        requestAnimationFrame(f);
      }),
    n
  );
const vOn = (p, fn, arg) => p.evaluate(([src, a]) => new Function("g", "arg", `return (${src})(g, arg);`)(window.__ufo, a), [fn.toString(), arg]);
async function untilOn(p, fn, arg, ms = 30000) {
  const t0 = Date.now();
  let r;
  while (Date.now() - t0 < ms) {
    r = await vOn(p, fn, arg).catch(() => null);
    if (r) return r;
    await new Promise((res) => setTimeout(res, 120));
  }
  return r;
}
async function playOn(p) {
  const t0 = Date.now();
  while (Date.now() - t0 < 300000) {
    const st = await vOn(p, (g) => g.gameState);
    if (st === "playing") return;
    if (st === "dead") {
      await vOn(p, (g) => g.respawn());
      continue;
    }
    for (const id of ["mp-lobby", "mp-screen"]) await p.evaluate((i) => document.getElementById(i)?.classList.add("hidden"), id);
    const click = (sel) => p.evaluate((s) => document.querySelector(s)?.click(), sel).catch(() => {});
    if (st === "start") await click("#play-btn");
    else if (await p.isVisible("#resume-btn").catch(() => false)) await click("#resume-btn");
    else {
      await p.mouse.click(300, 200);
      await framesOn(p, 5);
      if ((await vOn(p, (g) => g.gameState)) === "paused" && !(await p.isVisible("#resume-btn"))) await p.evaluate(() => document.getElementById("pause-menu").classList.remove("hidden"));
    }
    await framesOn(p, 3);
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

const page = await newPage("solo");
const frames = (n) => framesOn(page, n);
const v = (fn, arg) => vOn(page, fn, arg);
const until = (fn, arg, ms) => untilOn(page, fn, arg, ms);
const play = () => playOn(page);

// In-page helpers (window.__r20): a clear sky, stepping the world by hand.
const HELPERS = `(() => {
  const g = window.__ufo;
  const T = g.THREE;
  const H = {};
  // Steps the jets, the bolts, the UFOs and the nukes together.
  H.step = (dt = 1 / 30) => {
    g.vehicles.update(dt);
    g.ufos.update(dt);
    g.lasers.update(dt);
    g.nuke.update(dt, g.vehicles.active ? g.vehicles.active.pos : g.player.getEyePosition(), 1);
  };
  H.press = (code, dt = 1 / 30) => {
    g.vehicles.keyDown(code);
    H.step(dt);
    return window.__j.weapon;
  };
  H.click = (dt = 1 / 30) => {
    g.vehicles.mouseDown(2);
    H.step(dt);
    g.vehicles.mouseUp(2);
    H.step(dt);
  };
  // The jet held where it is (position, attitude, speed) while the world steps.
  H.hold = (j, at) => {
    j.pos.copy(at.pos);
    j.q.copy(at.q);
    j.vel.copy(at.vel);
    j._levelAim();
  };
  H.snap = (j) => ({ pos: j.pos.clone(), q: j.q.clone(), vel: j.vel.clone() });
  H.msgs = [];
  if (!H._hooked) {
    const say = g.vehicles.onMessage;
    g.vehicles.onMessage = (t) => {
      H.msgs.push(t);
      say?.(t);
    };
    H._hooked = true;
  }
  // A UFO hovering still at p.
  H.hover = (p, size = "medium") => {
    const u = g.ufos.spawn({ size, pos: p.clone(), design: "saucer" });
    H.still(u);
    u.health = u.maxHealth = 5000;
    return u;
  };
  H.still = (u) => {
    u.state = "trick";
    u.trick = "hover";
    u.timer = 1e9;
    u.vel.set(0, 0, 0);
    u.blinkT = 1e9;
    u.whimT = 1e9;
    u.temper = 0;
    u.hostile = false;
  };
  window.__r20 = H;
  return true;
})()`;

// A clear sky: Creative, no missions, UFOs, creatures or patrols; a jet in
// the air at height `y` heading north (-Z, or `yaw`), the player in it
// (window.__j). (As tools/r17-jets-tests.mjs.)
const sky = async (opts = {}) => {
  await play();
  await v((g, o) => {
    g.testFlags.noMissions = true;
    if (g.player.dead) g.respawn();
    if (g.vehicles.active) g.vehicles.exit({ force: true });
    g.setMode("creative");
    g.ufos.clear();
    g.mobs.clear();
    g.settingsPanel?.set?.("ufos.activity", 0);
    g.ufos.prankRate = 0;
    g.ufos.dodgeScale = 1;
    g.enemyJets.config.count = 0;
    for (const j of [...g.vehicles.vehicles]) g.vehicles.remove(j);
    const ground = g.world.heightAt(Math.floor(g.player.position.x), Math.floor(g.player.position.z));
    const p = o.at || [g.player.position.x, o.agl ? ground + o.agl : o.y ?? 200, g.player.position.z];
    const jet = g.vehicles.create("jet", { jetType: o.type || "f22", pos: p, yaw: o.yaw ?? 0, airborne: true, speed: o.speed ?? 150, throttle: o.throttle ?? 0.7 });
    g.vehicles.enter(jet);
    g.player.keys.clear();
    g.vehicles.input.buttons.fill(false);
    g.vehicles.input.pressed.clear();
    window.__j = jet;
    window.__jetAt = { pos: jet.pos.clone(), q: jet.q.clone(), vel: jet.vel.clone(), throttle: jet.throttle };
    return true;
  }, opts);
  await frames(2);
  await v(() => {
    const j = window.__j;
    const a = window.__jetAt;
    j.pos.copy(a.pos);
    j.q.copy(a.q);
    j.vel.copy(a.vel);
    j.throttle = a.throttle;
    j._levelAim();
    j.health = j.maxHealth;
    window.__r20.msgs.length = 0;
  });
};

await browserCheck("boot: a world, playing", async () => {
  await page.goto(`http://127.0.0.1:${PORT}/index.html?seed=${SEED}&graphics=low`, { waitUntil: "load", timeout: 60000 });
  await page.waitForFunction(() => !!window.__ufo && window.__ufo.graphicsReady, null, { timeout: 120000 });
  await play();
  await page.evaluate(HELPERS);
});

await browserCheck("the weapon switch: X goes missiles, super missile, MINI-NUKE, NOSE LASER (1-4 pick); the SR-71's own list; an enemy fighter keeps its own; the HUD", async () => {
  await sky({ y: 200 });
  const r = await v((g) => {
    const H = window.__r20;
    const j = window.__j;
    const seq = [j.weapon, H.press("KeyX"), H.press("KeyX"), H.press("KeyX"), H.press("KeyX")];
    const picks = [H.press("Digit3"), H.press("Digit4"), H.press("Digit2"), H.press("Digit1")];
    H.press("Digit3");
    const nukeHud = { ...j.overlay(g.camera).hud.weapon };
    const nukeRow = j.hud().rows.find((x) => x[0] === "Weapon")?.[1];
    H.press("Digit4");
    const laserHud = { ...j.overlay(g.camera).hud.weapon };
    const h = j.hud();
    return { seq, picks, nukeHud, nukeRow, laserHud, laserRow: h.rows.find((x) => x[0] === "Weapon")?.[1], ammoRow: h.rows.find((x) => x[0] === "Mini-nukes")?.[1], help: h.help, weaponText: h.weapon, msgs: H.msgs.slice(-3), info: j.infoPanel().stats.map((s) => s[0]) };
  });
  assert(r.seq.join() === "missile,super,mininuke,laser,missile", `X cycles: ${r.seq}`);
  assert(r.picks.join() === "mininuke,laser,super,missile", `1-4 pick: ${r.picks}`);
  assert(r.nukeHud.kind === "mininuke" && r.nukeHud.ammo === 2 && /MINI-NUKE/.test(r.nukeRow), `the mini-nuke on the HUD: ${JSON.stringify(r)}`);
  assert(r.laserHud.kind === "laser" && /NOSE LASER/.test(r.laserRow) && /NOSE LASER/.test(r.weaponText) && /X weapons/.test(r.help), `the laser on the HUD: ${JSON.stringify(r)}`);
  assert(/2 of 2/.test(r.ammoRow) && r.info.includes("Mini-nuke") && r.info.includes("Nose laser"), `the panels: ${JSON.stringify(r)}`);
  assert(r.msgs.some((t) => /NOSE LASER selected/.test(t)), `a word on the switch: ${JSON.stringify(r.msgs)}`);
  // The fighter HUD's canvas.
  const st = await until(() => document.getElementById("fighter-hud")?.dataset.weapon === "laser" && "ok", null, 15000);
  assert(st === "ok", `the fighter HUD shows the laser: ${await v(() => document.getElementById("fighter-hud")?.dataset.weapon)}`);
  // The SR-71: its camera, the mini-nuke, the laser.
  await sky({ y: 200, type: "sr71", speed: 300 });
  const s = await v((g) => {
    const H = window.__r20;
    const j = window.__j;
    return [j.weapon, H.press("KeyX"), H.press("KeyX"), H.press("KeyX"), H.press("Digit4"), H.press("Digit2"), H.press("Digit1")];
  });
  assert(s.join() === "recon,mininuke,laser,recon,laser,laser,recon", `the SR-71: ${s}`);
  // An enemy fighter: its weapon can't be switched, and it never fires the new ones.
  const e = await v((g) => {
    const H = window.__r20;
    const ej = g.enemyJets.spawn({ dist: 400, angle: 0 });
    if (!ej) return { none: true };
    ej.selectWeapon("laser");
    ej.selectWeapon("mininuke");
    let laser = false;
    let mini = false;
    for (let i = 0; i < 150; i++) {
      H.step(1 / 30);
      laser ||= ej.laserOn;
      mini ||= ej.missiles.some((m) => m.mini);
    }
    const out = { weapon: ej.weapon, list: ej.weapons, laser, mini };
    g.vehicles.remove(ej);
    return out;
  });
  assert(!e.none && e.weapon === "missile" && e.list.length === 1 && !e.laser && !e.mini, `the enemy fighter: ${JSON.stringify(e)}`);
});

await browserCheck("the laser: the beam starts just under the nose of each jet and points along the nose and the flight path", async () => {
  const out = [];
  for (const type of ["f22", "f16", "b2", "sr71"]) {
    await sky({ y: 220, type, speed: type === "sr71" ? 300 : type === "b2" ? 110 : 150 });
    const r = await v((g, type) => {
      const H = window.__r20;
      const j = window.__j;
      const T = g.THREE;
      H.press("Digit4");
      // (A slight climb and bank: the beam must follow the nose wherever it points.)
      j.q.setFromEuler(new T.Euler(0.15, 0.4, -0.3, "YXZ"));
      j.vel.copy(new T.Vector3(0, 0, -1).applyQuaternion(j.q).multiplyScalar(j.vel.length()));
      j._levelAim();
      const at = H.snap(j);
      g.vehicles.mouseDown(2);
      for (let i = 0; i < 6; i++) {
        H.hold(j, at);
        H.step(1 / 30);
      }
      const hit = j.laserHit;
      const fwd = j.forward(new T.Vector3());
      const up = j.up(new T.Vector3());
      const off = hit.from.clone().sub(j.pos);
      const beamDir = new T.Vector3(0, 0, 1).applyQuaternion(j._beam.group.getWorldQuaternion(new T.Quaternion()));
      const r = {
        type,
        on: j.laserOn,
        visible: j._beam.group.visible,
        along: +off.dot(fwd).toFixed(2),
        under: +off.dot(up).toFixed(2),
        nose: j.spec.probes.nose,
        angNose: +hit.dir.angleTo(fwd).toFixed(4),
        angVel: +hit.dir.angleTo(j.vel).toFixed(4),
        angMesh: +beamDir.angleTo(fwd).toFixed(4),
        meshAt: +j._beam.group.getWorldPosition(new T.Vector3()).distanceTo(hit.from).toFixed(3),
        len: Math.round(j._beam.core.scale.z),
        pulses: j.laserPulses || 0,
      };
      g.vehicles.mouseUp(2);
      H.step(1 / 30);
      r.off = !j.laserOn && !j._beam.group.visible;
      return r;
    }, type);
    out.push(r);
    assert(r.on && r.visible && r.off, `fires while held, stops when let go: ${JSON.stringify(r)}`);
    assert(r.along > r.nose * 0.75 && r.along <= r.nose + 0.3 && r.under < 0 && r.under > -1.6, `from just under the nose: ${JSON.stringify(r)}`);
    assert(r.angNose < 1e-3 && r.angVel < 0.02 && r.angMesh < 1e-3 && r.meshAt < 0.01, `along the nose and the flight path: ${JSON.stringify(r)}`);
    assert(r.len > 100 && r.pulses >= 2, `a long beam and its pulses: ${JSON.stringify(r)}`);
  }
  console.log(`    ${out.map((r) => `${r.type} ${r.along}/${r.nose} fwd, ${r.under} up`).join("; ")}`);
  if (SHOTS) {
    await sky({ y: 120, type: "f22", speed: 150 });
    await v((g) => {
      const j = window.__j;
      j.selectWeapon("laser");
      j.cameraMode = 0;
      return true;
    });
    await frames(2);
    await v((g) => g.vehicles.mouseDown(2));
    await frames(12);
    await page.screenshot({ path: path.join(SHOTS, "r20-laser.png") });
    await v((g) => (g.setGraphics?.("high"), true));
    await frames(12);
    await page.screenshot({ path: path.join(SHOTS, "r20-laser-high.png") });
    await v((g) => {
      window.__j.cameraMode = 1;
      return true;
    });
    await frames(8);
    await page.screenshot({ path: path.join(SHOTS, "r20-laser-cockpit.png") });
    await v((g) => {
      g.setGraphics?.("low");
      window.__j.cameraMode = 0;
      g.vehicles.mouseUp(2);
      return true;
    });
  }
});

await browserCheck("the laser hurts a UFO (one that dodges still takes most of it; the UFOs see the pulses), an enemy fighter, and burns a target block", async () => {
  await sky({ y: 200, speed: 150 });
  const r = await v((g) => {
    const H = window.__r20;
    const j = window.__j;
    const T = g.THREE;
    H.press("Digit4");
    const at = H.snap(j);
    const fwd = j.forward(new T.Vector3());
    // (The ship held where it was put, hovering, as hit it would turn and
    // fight; a dodger's slide is its own until it ends.)
    const burst = (u, secs, each = null) => {
      const hp0 = u.health;
      const p0 = u.pos.clone();
      g.vehicles.mouseDown(2);
      for (let t = 0; t < secs; t += 1 / 30) {
        H.hold(j, at);
        if (u.state !== "gone" && !u.falling) {
          H.still(u);
          u.dash = null;
          if (!u.evade) u.pos.copy(p0);
        }
        j.laserHeat = 0; // (the heat is the next check's)
        H.step(1 / 30);
        each?.();
      }
      g.vehicles.mouseUp(2);
      H.step(1 / 30);
      return Math.round(hp0 - u.health);
    };
    // No dodging (the test switch), then a skilled dodger.
    g.ufos.dodgeScale = 0;
    const u1 = H.hover(j.pos.clone().addScaledVector(fwd, 420));
    let hitKind = null;
    const plain = burst(u1, 3, () => (hitKind ||= j.laserHit?.kind));
    g.ufos.clear();
    g.ufos.dodgeScale = 1;
    const u2 = H.hover(j.pos.clone().addScaledVector(fwd, 650));
    u2.dodgeSkill = 0.9;
    u2.dodgeReact = 0.06;
    u2.mood = "cheeky";
    const st = g.ufos.mischief;
    const tries0 = st?.threats ?? 0;
    const dodges0 = st?.dodges ?? 0;
    const dodged = burst(u2, 3);
    const seen = (st?.threats ?? 0) - tries0;
    const dodges = (st?.dodges ?? 0) - dodges0;
    g.ufos.clear();
    // An enemy fighter ahead.
    const ej = g.vehicles.create("enemyjet", { pos: j.pos.clone().addScaledVector(fwd, 300).toArray(), yaw: 0, airborne: true, speed: 0, throttle: 0 });
    const ehp0 = ej.health;
    g.vehicles.mouseDown(2);
    for (let t = 0; t < 1; t += 1 / 30) {
      H.hold(j, at);
      ej.pos.copy(j.pos).addScaledVector(fwd, 300);
      ej.vel.set(0, 0, 0);
      j.laserHeat = 0;
      H.step(1 / 30);
    }
    g.vehicles.mouseUp(2);
    H.step(1 / 30);
    const ejHurt = Math.round(ehp0 - ej.health);
    g.vehicles.remove(ej);
    return { plain, hitKind, dodged, seen, dodges, ejHurt };
  });
  console.log(`    UFO: ${r.plain} damage in 3 s (no dodging), ${r.dodged} by a skilled dodger (${r.dodges} dodges of ${r.seen} pulses seen); enemy fighter ${r.ejHurt} in 1 s`);
  assert(r.hitKind === "ufo" && r.plain >= 120 && r.plain <= 260, `about 60 a second on a UFO: ${JSON.stringify(r)}`);
  assert(r.seen > 20, `the UFOs see the pulses coming: ${JSON.stringify(r)}`);
  assert(r.dodges >= 1 && r.dodged >= r.plain * 0.5, `a dodger slips some, still takes most: ${JSON.stringify(r)}`);
  assert(r.ejHurt >= 25, `an enemy fighter hurt: ${JSON.stringify(r)}`);
  // A target block: a stone pillar ahead, kept under the beam. (Blocks go
  // up to y 127: the jet flies at 112 here, the air cleared before it.)
  await sky({ y: 112, speed: 150 });
  const b = await v((g) => {
    const H = window.__r20;
    const j = window.__j;
    const T = g.THREE;
    H.press("Digit4");
    const at = H.snap(j);
    const x = Math.floor(j.pos.x);
    const y = Math.floor(j.pos.y - 0.8);
    const z = Math.floor(j.pos.z) - 120;
    for (let zz = z - 16; zz <= Math.floor(j.pos.z) + 16; zz += 16) g.world.prepareArea(x, zz, 1);
    const list = [];
    for (let dx = -2; dx <= 2; dx++) for (let dy = -3; dy <= 3; dy++) for (let dz = 0; dz < 3; dz++) list.push(x + dx, y + dy, z - dz, 1);
    for (let zz = z + 1; zz < Math.floor(j.pos.z) - 8; zz++) for (let dx = -2; dx <= 2; dx++) for (let dy = -3; dy <= 3; dy++) list.push(x + dx, y + dy, zz, 0);
    g.world.setBlocks(list);
    const count = () => {
      let n = 0;
      for (let dx = -2; dx <= 2; dx++) for (let dy = -3; dy <= 3; dy++) for (let dz = 0; dz < 3; dz++) n += g.world.getBlock(x + dx, y + dy, z - dz) === 1 ? 1 : 0;
      return n;
    };
    const n0 = count();
    const burnt0 = j.laserBurnt || 0;
    g.vehicles.mouseDown(2);
    let kind = null;
    for (let t = 0; t < 2; t += 1 / 30) {
      H.hold(j, at);
      j.laserHeat = 0;
      H.step(1 / 30);
      kind ||= j.laserHit?.kind;
    }
    g.vehicles.mouseUp(2);
    H.step(1 / 30);
    return { n0, n1: count(), kind, burnt: (j.laserBurnt || 0) - burnt0, hitAir: g.world.getBlock(x, y, z) };
  });
  assert(b.kind === "block" && b.n0 === 105 && b.n1 < b.n0 && b.burnt >= 1 && b.n0 - b.n1 <= 40, `burns a few blocks where it is held: ${JSON.stringify(b)}`);
});

await browserCheck("overheat: 5 s of fire jams the laser (a word, the HUD), it cools and fires again", async () => {
  await sky({ y: 220, speed: 150 });
  const r = await v((g) => {
    const H = window.__r20;
    const j = window.__j;
    H.press("Digit4");
    const at = H.snap(j);
    g.vehicles.mouseDown(2);
    let t = 0;
    while (!j.laserJam && t < 8) {
      H.hold(j, at);
      H.step(1 / 30);
      t += 1 / 30;
    }
    const jamAt = +t.toFixed(2);
    const pulses = j.laserPulses;
    for (let i = 0; i < 15; i++) {
      H.hold(j, at);
      H.step(1 / 30);
    }
    const whileJam = { on: j.laserOn, pulses: j.laserPulses - pulses, hud: { ...j.overlay(g.camera).hud.weapon }, warn: j.hud().warning };
    g.vehicles.mouseUp(2);
    let c = 0;
    while (j.laserJam && c < 10) {
      H.hold(j, at);
      H.step(1 / 30);
      c += 1 / 30;
    }
    g.vehicles.mouseDown(2);
    H.step(1 / 30);
    H.hold(j, at);
    H.step(1 / 30);
    const again = j.laserOn;
    g.vehicles.mouseUp(2);
    H.step(1 / 30);
    return { jamAt, whileJam, cool: +c.toFixed(2), again, msgs: H.msgs.filter((m) => /OVERHEAT/.test(m)) };
  });
  console.log(`    jammed after ${r.jamAt} s of fire, cooled in ${r.cool} s`);
  assert(r.jamAt > 4.5 && r.jamAt < 5.6, `jams after ~5 s: ${JSON.stringify(r)}`);
  assert(!r.whileJam.on && r.whileJam.pulses === 0 && r.whileJam.hud.jam && /LASER OVERHEATED/.test(r.whileJam.warn) && r.msgs.length >= 1, `jammed: no beam, no pulses, the HUD says so: ${JSON.stringify(r)}`);
  assert(r.cool > 1 && r.cool < 3.5 && r.again, `cools and fires again: ${JSON.stringify(r)}`);
});

// Flies the jet's mini-nuke: the jet held level (or `follow`ing it `follow`
// blocks behind once armed) while the world steps, until it goes off (or
// `secs`). Returns what happened.
const FLY_MINI = `(g, o) => {
  const H = window.__r20;
  const j = window.__j;
  const T = g.THREE;
  const n0 = g.nuke.count;
  const x0 = g.effects.explosionCount;
  const carve = g.effects._carve;
  let maxR = 0;
  let removed = 0;
  let center = null;
  g.effects._carve = function (c, r, opts) {
    const out = carve.call(this, c, r, opts);
    if (center && opts?.vScale) {
      for (let i = 0; i < out.length; i += 4) {
        const d = Math.hypot(out[i] + 0.5 - center.x, out[i + 2] + 0.5 - center.z);
        if (d > maxR) maxR = d;
      }
      removed += out.length / 4;
    }
    return out;
  };
  const det = g.nuke.detonate.bind(g.nuke);
  let info = null;
  g.nuke.detonate = (c, opts) => {
    center = c.clone();
    const d = det(c, opts);
    info = { R: d.R, mini: d.mini, air: d.air, slices: d.slices };
    return d;
  };
  try {
    // (The ground where it comes down generated now: between two calls the
    // game drops chunks out of its view.)
    if (o.prep) for (let d = o.prep[0]; d <= o.prep[1]; d += 32) g.world.prepareArea(j.pos.x, j.pos.z - d, 2);
    if (o.pitch) j.q.setFromEuler(new T.Euler(o.pitch, 0, 0, "YXZ"));
    j._levelAim();
    H.click();
    const m = j.missiles.find((x) => x.mini);
    const level = H.snap(j);
    level.q.setFromEuler(new T.Euler(0, 0, 0, "YXZ"));
    level.vel.set(0, 0, -150);
    let t = 0;
    let danger = "";
    let hpAt = null;
    let distAt = null;
    while (m && j.missiles.includes(m) && t < (o.secs || 16)) {
      if (o.follow && m.age > m.armAt - 0.2) {
        j.pos.copy(m.pos).addScaledVector(m.dir, -o.follow);
        j.q.setFromUnitVectors(new T.Vector3(0, 0, -1), m.dir);
        j.vel.copy(m.vel);
        j._levelAim();
      } else {
        level.pos.addScaledVector(level.vel, 1 / 30);
        H.hold(j, level);
      }
      const hp = j.health;
      const at = j.pos.clone();
      H.step(1 / 30);
      if (j.miniDanger === "close") danger = "close";
      if (!j.missiles.includes(m)) {
        hpAt = hp;
        distAt = at.distanceTo(j.lastMiniBoom?.at ?? m.pos);
      }
      t += 1 / 30;
    }
    const hurt = hpAt !== null ? Math.round(hpAt - j.health) : null;
    // The crater, carved over the next frames.
    for (let i = 0; i < 40 && center; i++) g.nuke.update(1 / 30, j.pos, 1);
    return { fired: !!m, armAt: m?.armAt, age: +(j.lastMiniBoom?.age ?? -1).toFixed(2), t: +t.toFixed(2), nukes: g.nuke.count - n0, blasts: g.effects.explosionCount - x0, last: { ...g.effects.lastExplosion }, info, maxR: +maxR.toFixed(1), removed, hurt, alive: j.alive, distAt: distAt && +distAt.toFixed(1), danger, ammo: j.miniAmmo, msgs: H.msgs.slice(-4) };
  } finally {
    g.effects._carve = carve;
    g.nuke.detonate = det;
  }
}`;
const flyMini = (o) => page.evaluate(([src, a]) => new Function("g", "a", `return (${src})(g, a);`)(window.__ufo, a), [FLY_MINI, o]);

await browserCheck("the mini-nuke: a hit before it arms is a dud; armed, a nuke of size 22 whose crater is between the super missile's blast and the big nuke's", async () => {
  // A dud: a wall 110 blocks ahead (the air before it cleared).
  await sky({ y: 112, speed: 150 });
  await v((g) => {
    const j = window.__j;
    window.__r20.press("Digit3");
    const x = Math.floor(j.pos.x);
    const y = Math.floor(j.pos.y);
    const z = Math.floor(j.pos.z) - 110;
    for (let zz = z - 16; zz <= Math.floor(j.pos.z) + 16; zz += 16) g.world.prepareArea(x, zz, 1);
    const list = [];
    for (let dx = -12; dx <= 12; dx++) for (let dy = -10; dy <= 10; dy++) {
      list.push(x + dx, y + dy, z, 1);
      for (let zz = z + 1; zz < Math.floor(j.pos.z) + 4; zz++) list.push(x + dx, y + dy, zz, 0);
    }
    g.world.setBlocks(list);
    return true;
  });
  const dud = await flyMini({ secs: 4 });
  assert(dud.fired && dud.nukes === 0 && dud.blasts === 1 && Math.abs(dud.last.radius - 3) < 0.01 && dud.msgs.some((t) => /DUD/.test(t)), `a dud: ${JSON.stringify(dud)}`);
  // Armed: fired 25 degrees nose down from 260 above the ground.
  await sky({ agl: 260, speed: 150 });
  await v(() => {
    window.__r20.press("Digit3");
    window.__j.miniT = 0;
    return true;
  });
  const r = await flyMini({ pitch: -0.45, secs: 10, prep: [380, 720] });
  const sizes = await v((g) => ({ big: g.nuke.radius, superR: 14, craterBig: g.nuke.constructor.craterRadius(g.nuke.radius), craterMini: g.nuke.constructor.craterRadius(22) }));
  console.log(`    went off ${r.age} s after launch; size ${r.info?.R}; crater ${r.maxR} blocks across in radius (${r.removed} blocks; the super missile's blast 14, the big nuke's crater ${sizes.craterBig}); ammo left ${r.ammo}`);
  assert(r.fired && r.nukes === 1 && r.info?.R === 22 && r.info.mini && !r.info.air, `a mini nuke: ${JSON.stringify(r)}`);
  assert(r.age >= r.armAt && r.armAt >= 1, `armed first: ${JSON.stringify(r)}`);
  assert(r.maxR > 14 * 1.5 && r.maxR < sizes.craterBig * 0.5 && r.removed > 2000, `its crater between the super missile's and the big nuke's: ${JSON.stringify({ ...r, sizes })}`);
  assert(r.alive && r.hurt === 0, `the pilot far off is unhurt: ${JSON.stringify(r)}`);
  assert(r.ammo === 1 && r.msgs.some((t) => /MINI-NUKE AWAY/.test(t)), `one used: ${JSON.stringify(r)}`);
});

await browserCheck("the mini-nuke's danger: DANGER CLOSE on the HUD while following it, a pilot too close is hurt by its blast", async () => {
  await sky({ agl: 220, speed: 150 });
  await v(() => {
    window.__r20.press("Digit3");
    return true;
  });
  const r = await flyMini({ pitch: -0.45, secs: 10, follow: 45, prep: [300, 640] });
  console.log(`    the pilot ${r.distAt} blocks from it: ${r.hurt} damage`);
  assert(r.nukes === 1 && r.danger === "close", `the warning: ${JSON.stringify(r)}`);
  assert(r.hurt >= 20 || !r.alive, `the pilot too close is hurt: ${JSON.stringify(r)}`);
  // The "short" warning: something straight ahead closer than it can arm.
  await sky({ y: 112, speed: 150 });
  const s = await v((g) => {
    const j = window.__j;
    window.__r20.press("Digit3");
    const x = Math.floor(j.pos.x);
    const y = Math.floor(j.pos.y);
    const z = Math.floor(j.pos.z) - 150;
    g.world.prepareArea(x, z, 1);
    const list = [];
    for (let zz = z + 16; zz <= Math.floor(j.pos.z) + 16; zz += 16) g.world.prepareArea(x, zz, 1);
    for (let dx = -6; dx <= 6; dx++) for (let dy = -6; dy <= 6; dy++) {
      list.push(x + dx, y + dy, z, 1);
      for (let zz = z + 1; zz < Math.floor(j.pos.z) + 4; zz++) list.push(x + dx, y + dy, zz, 0);
    }
    g.world.setBlocks(list);
    window.__r20.step(1 / 30);
    return { danger: j.miniDanger, hud: j.overlay(g.camera).hud.danger, warn: j.hud().warning };
  });
  assert(s.danger === "short" && s.hud === "short" && /DUD/.test(s.warn), `too close to arm: ${JSON.stringify(s)}`);
  const st = await until(() => document.getElementById("fighter-hud")?.dataset.danger === "short" && "ok", null, 15000);
  assert(st === "ok", "the fighter HUD shows it");
});

await browserCheck("mini-nuke ammo: none left is a word; one more in the air after a while; all of them after a stop on the ground; the B-2 carries more", async () => {
  await sky({ y: 400, type: "f16", speed: 150 });
  const r = await v((g) => {
    const H = window.__r20;
    const j = window.__j;
    H.press("Digit3");
    const max = j.miniMax;
    H.click();
    const n1 = j.missiles.filter((m) => m.mini).length;
    const after = { ammo: j.miniAmmo, reload: j.miniT };
    j.miniT = 0;
    H.click();
    const n2 = j.missiles.filter((m) => m.mini).length;
    const none = H.msgs.some((t) => /none left/.test(t));
    for (const m of [...j.missiles]) {
      g.scene.remove(m.mesh);
      j.missiles.splice(j.missiles.indexOf(m), 1);
    }
    j.rearmT = 89.9;
    H.step(1 / 30);
    H.step(1 / 30);
    H.step(1 / 30);
    const air = j.miniAmmo;
    j.miniAmmo = 0;
    j.rearmT = 0;
    const onGround = j.onGround;
    j.onGround = true;
    j.vel.set(0, 0, 0);
    for (let t = 0; t < 4.2; t += 1 / 30) j._rearm(1 / 30);
    const ground = j.miniAmmo;
    j.onGround = onGround;
    const saved = j.serialize().mn;
    const b2 = g.vehicles.create("jet", { jetType: "b2", pos: j.pos.clone().add(new g.THREE.Vector3(200, 0, 0)).toArray(), airborne: true, speed: 110 });
    const b2Max = b2.miniMax;
    g.vehicles.remove(b2);
    return { max, n1, after, n2, none, air, ground, saved, b2Max, msgs: H.msgs.slice(-3) };
  });
  assert(r.max === 1 && r.n1 === 1 && r.after.ammo === 0 && r.after.reload >= 20, `one aboard, a long reload: ${JSON.stringify(r)}`);
  assert(r.n2 === 1 && r.none, `none left: nothing fired, a word: ${JSON.stringify(r)}`);
  assert(r.air === 1 && r.ground === 1 && r.saved === 1, `rearmed in the air and on the ground: ${JSON.stringify(r)}`);
  assert(r.b2Max >= 3, `the B-2 carries more: ${JSON.stringify(r)}`);
});

await browserCheck("the frame time while a mini-nuke goes off (the real game loop)", async () => {
  await sky({ agl: 300, speed: 150 });
  const r = await page.evaluate(async () => {
    const g = window.__ufo;
    const j = window.__j;
    const raf = () => new Promise((res) => requestAnimationFrame(res));
    const sample = async (ms) => {
      const out = [];
      let last = await raf();
      const t0 = last;
      while (last - t0 < ms) {
        const t = await raf();
        out.push(t - last);
        last = t;
      }
      return out;
    };
    // (The jet held still meanwhile: autopilot-free, level, its speed kept.)
    const at = { pos: j.pos.clone(), q: j.q.clone(), vel: j.vel.clone() };
    const hold = setInterval(() => {
      j.pos.copy(at.pos);
      j.q.copy(at.q);
      j.vel.copy(at.vel);
    }, 0);
    const upd = g.nuke.update.bind(g.nuke);
    const costs = [];
    g.nuke.update = (...a) => {
      const t = performance.now();
      const r = upd(...a);
      costs.push(performance.now() - t);
      return r;
    };
    try {
      const before = await sample(2500);
      // On the ground 380 blocks ahead.
      const x = Math.floor(j.pos.x);
      const z = Math.floor(j.pos.z - 380);
      const y = g.world.heightAt(x, z) + 1;
      g.nuke.detonate(new g.THREE.Vector3(x + 0.5, y, z + 0.5), { R: 22, mini: true });
      const during = await sample(3500);
      const avg = (a) => a.reduce((s, x) => s + x, 0) / Math.max(1, a.length);
      const p95 = (a) => [...a].sort((p, q) => p - q)[Math.floor(a.length * 0.95)] ?? 0;
      return { before: +avg(before).toFixed(1), during: +avg(during).toFixed(1), worst: +Math.max(...during).toFixed(1), p95: +p95(during).toFixed(1), nukeMax: +Math.max(0, ...costs).toFixed(1), nukeAvg: +avg(costs).toFixed(2), frames: during.length };
    } finally {
      clearInterval(hold);
      g.nuke.update = upd;
    }
  });
  if (SHOTS) await page.screenshot({ path: path.join(SHOTS, "r20-mini-nuke.png") });
  console.log(`    frames: ${r.before} ms before, ${r.during} ms during (p95 ${r.p95}, worst ${r.worst}); nuke.update ${r.nukeAvg} ms avg, ${r.nukeMax} ms worst`);
  assert(r.nukeMax < 60 && r.nukeAvg < 15, `the nuke's own work per frame: ${JSON.stringify(r)}`);
  assert(r.during < r.before * 2.5 + 15, `the frame time stays sane: ${JSON.stringify(r)}`);
});

await v((g) => {
  if (g.vehicles.active) g.vehicles.exit({ force: true });
  return true;
});

// ---------- Online ----------
if (!args.solo) {
  const { default: express } = await import("express");
  const { ExpressPeerServer } = await import("peer");
  const PEER_PORT = PORT + 20;
  const app = express();
  const peerHttp = app.listen(PEER_PORT, "127.0.0.1");
  app.use("/ufo", ExpressPeerServer(peerHttp, { path: "/" }));
  const NET_Q = `peerServer=127.0.0.1:${PEER_PORT}/ufo&noStun=1&graphics=low`;
  await page.close();
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
  await browserCheck("online: the guest sees the host's laser beam and pulses, the mini-nuke in flight and going off; the guest's laser hurts the host's UFO", async () => {
    await host.goto(`http://127.0.0.1:${PORT}/index.html?seed=${SEED}&${NET_Q}`, { waitUntil: "load", timeout: 60000 });
    await host.waitForFunction(() => !!window.__ufo && window.__ufo.graphicsReady, null, { timeout: 120000 });
    await host.click("#menu-mp-btn");
    await host.fill("#mp-nick", "Alice");
    await host.click("#mp-host-btn");
    const code = await untilOn(host, (g) => g.net.code, null, 30000);
    assert(code, "no room code");
    await host.click("#mp-lobby-play");
    await host.waitForFunction(() => window.__ufo.gameState === "playing", null, { timeout: 30000 });
    await vOn(host, noDraw);
    await vOn(host, (g) => {
      g.mp.rules.setMode("creative");
      g.testFlags.noMissions = true;
      g.settingsPanel?.set?.("ufos.activity", 0);
      g.ufos.clear();
      return true;
    });
    await guest.goto(`http://127.0.0.1:${PORT}/index.html?join=${code}&${NET_Q}`, { waitUntil: "load", timeout: 60000 });
    await guest.waitForSelector("#mp-join-boot:not(.hidden)", { timeout: 30000 });
    await guest.fill("#mp-boot-nick", "Bob");
    await guest.click("#mp-boot-join");
    await guest.waitForFunction(() => !!window.__ufo && window.__ufo.graphicsReady, null, { timeout: 120000 });
    assert(await untilOn(guest, (g) => g.mp.stateLoaded, null, 150000), "the host's state never arrived");
    await vOn(guest, noDraw);
    await playOn(guest).catch(() => {});
    await playOn(host).catch(() => {});
    // The host's jet, 250 up over the guest, flying north; its nose laser on.
    const hj = await vOn(host, (g) => {
      const gp = [...g.net.players.values()].find((p) => p.nick === "Bob");
      const at = g.player.position.clone();
      for (const v of [...g.vehicles.vehicles]) if (!v.puppet) g.vehicles.remove(v);
      const jet = g.vehicles.create("jet", { jetType: "f22", pos: [at.x, g.world.heightAt(Math.floor(at.x), Math.floor(at.z)) + 250, at.z], yaw: 0, airborne: true, speed: 150, throttle: 0.7 });
      g.vehicles.enter(jet);
      window.__j = jet;
      jet.selectWeapon("laser");
      // (A fresh press of the button after the switch.)
      setTimeout(() => g.vehicles.mouseDown(2), 300);
      return { nid: jet.net?.nid ?? null, bob: !!gp };
    });
    assert(hj.nid, `the host's jet is shared: ${JSON.stringify(hj)}`);
    // The guest: count the host's mirrored pulses.
    await vOn(guest, (g) => {
      const fire = g.lasers.fire.bind(g.lasers);
      window.__mirror = 0;
      g.lasers.fire = (o) => {
        if (o.mirror && o.owner === "jet") window.__mirror++;
        return fire(o);
      };
      // (The guest by the host's jet: within its view and sync range.)
      return true;
    });
    const seen = await untilOn(guest, (g, nid) => {
      const p = g.vehicles.vehicles.find((x) => x.puppet && x.net?.nid === nid);
      if (!p) return null;
      g.player.position.set(p.pos.x + 60, p.pos.y - 30, p.pos.z + 40);
      g.player.flying = true;
      return p.laserOn && p._beam?.group.visible && window.__mirror > 3 ? { on: true, mirror: window.__mirror, hit: p.laserHit?.dist } : null;
    }, hj.nid, 40000);
    assert(seen?.on, `the guest sees the beam and its pulses: ${JSON.stringify(seen)} ${JSON.stringify(await vOn(guest, (g, nid) => { const p = g.vehicles.vehicles.find((x) => x.puppet && x.net?.nid === nid); return p ? { laser: p.laserOn, netLaser: p._netLaser, mirror: window.__mirror } : "no puppet"; }, hj.nid))}`);
    // The host lets go: the beam goes on the guest's side too.
    await vOn(host, (g) => g.vehicles.mouseUp(2));
    const off = await untilOn(guest, (g, nid) => {
      const p = g.vehicles.vehicles.find((x) => x.puppet && x.net?.nid === nid);
      return p && !p.laserOn && !p._beam?.group.visible ? true : null;
    }, hj.nid, 20000);
    assert(off, "the beam goes off for the guest too");
    // The mini-nuke: fired nose down at the ground far ahead.
    const n0 = await vOn(guest, (g) => {
      window.__mn = 0;
      window.__nk = null;
      const upd = g.mp.fx._updateRemotePj.bind(g.mp.fx);
      g.mp.fx._updateRemotePj = (dt) => {
        for (const p of g.mp.fx.remotePj.values()) if (p.kind === "mn") window.__mn++;
        return upd(dt);
      };
      const det = g.nuke.detonate.bind(g.nuke);
      g.nuke.detonate = (c, o) => {
        const d = det(c, o);
        window.__nk = { R: d.R, mini: d.mini, mirror: d.mirror };
        return d;
      };
      return g.nuke.count;
    });
    await vOn(host, (g) => {
      const j = window.__j;
      j.selectWeapon("mininuke");
      j.q.setFromEuler(new g.THREE.Euler(-0.45, 0, 0, "YXZ"));
      j._levelAim();
      g.vehicles.mouseDown(2);
      setTimeout(() => g.vehicles.mouseUp(2), 60);
      return true;
    });
    const boom = await untilOn(guest, (g) => (window.__nk ? { ...window.__nk, inFlight: window.__mn } : null), null, 30000);
    assert(boom && boom.R === 22 && boom.mini && boom.mirror, `the guest sees it go off: ${JSON.stringify(boom)}`);
    assert(boom.inFlight > 0, `and saw it in flight: ${JSON.stringify(boom)}`);
    // The guest's own laser at a UFO of the host's: the host's ship is hurt.
    const ufo = await vOn(host, (g) => {
      if (g.vehicles.active) g.vehicles.exit({ force: true });
      g.ufos.clear();
      return true;
    });
    const gj = await vOn(guest, (g) => {
      if (g.vehicles.active) g.vehicles.exit({ force: true });
      const at = g.player.position.clone();
      const jet = g.vehicles.create("jet", { jetType: "f16", pos: [at.x, g.world.heightAt(Math.floor(at.x), Math.floor(at.z)) + 200, at.z], yaw: 0, airborne: true, speed: 150, throttle: 0.7 });
      g.vehicles.enter(jet);
      window.__j = jet;
      return jet.pos.toArray();
    });
    const uid = await vOn(host, (g, p) => {
      const u = g.ufos.spawn({ size: "medium", design: "saucer", pos: new g.THREE.Vector3(p[0], p[1], p[2] - 300) });
      u.health = u.maxHealth = 5000;
      u.state = "trick";
      u.trick = "hover";
      u.timer = 1e9;
      u.vel.set(0, 0, 0);
      u.dodgeMul = 0;
      window.__u = u;
      window.__uhp = u.health;
      return u.id;
    }, gj);
    assert(uid !== undefined, "a UFO on the host");
    const pupp = await untilOn(guest, (g) => g.ufos.ufos.some((u) => u.net) || null, null, 20000);
    assert(pupp, "the guest sees the host's UFO");
    // Held level at its spot, aimed at the UFO, the laser on, for 3 s.
    await vOn(guest, (g, p) => {
      const j = window.__j;
      const at = { pos: new g.THREE.Vector3(p[0], p[1], p[2]), q: j.q.clone(), vel: j.vel.clone() };
      window.__hold = setInterval(() => {
        j.pos.copy(at.pos);
        j.q.copy(at.q);
        j.vel.copy(at.vel);
        j.laserHeat = 0;
      }, 0);
      j.selectWeapon("laser");
      setTimeout(() => g.vehicles.mouseDown(2), 100);
      return true;
    }, gj);
    const hurt = await untilOn(host, (g) => {
      const u = window.__u;
      u.state = "trick";
      u.trick = "hover";
      u.vel.set(0, 0, 0);
      return window.__uhp - u.health >= 40 ? Math.round(window.__uhp - u.health) : null;
    }, null, 30000);
    await vOn(guest, (g) => {
      clearInterval(window.__hold);
      g.vehicles.mouseUp(2);
      return true;
    });
    assert(hurt >= 40, `the host's UFO hurt by the guest's laser: ${hurt} ${JSON.stringify(await vOn(host, () => ({ hp: window.__u.health, st: window.__u.state })))}`);
    console.log(`    the guest: ${seen.mirror} pulses mirrored, the beam ${Math.round(seen.hit ?? 0)} long; the mini-nuke seen in flight (${boom.inFlight} frames) and going off; the guest's laser did ${hurt}+ to the host's UFO`);
  });
  await guest.close();
  await host.close();
  peerHttp.close();
}

await browser.close();
server.close();

const failed = results.filter(([, ok]) => !ok);
console.log(`\n${results.length - failed.length} passed, ${failed.length} failed.`);
process.exit(failed.length ? 1 : 0);
