// Round 21, track A: the jets' nose laser as bursts with aim assist
// (js/vehicle-jet.js JET_LASER, _updateLaser, _fireLaser, _laserAssist,
// _aimTargets; js/fighter-hud.js _laserCue; js/lasers.js onHit;
// js/vehicles.js aimTargets; js/audio.js playJetLaserZap).
// Node: the numbers (damage a burst, its length, the recharge, the cone).
// In the browser (Creative, a clear sky):
// - the bug: with the laser selected, the right button (real mouse events,
//   the real game loop), held or clicked, fires no cannon round (counted)
//   and no visible tracer stream; the left button still fires the cannon;
// - one click is one burst of limited length (its beam ~0.2 s, then gone),
//   with its damage; held, never a constant beam: a burst each recharge;
//   the recharge is enforced (clicks while charging do nothing, one just
//   before it is charged fires then); the HUD's charge;
// - the aim assist: a UFO ~3 degrees off the nose is hit (the burst bends
//   onto it, leading a crossing one), one 15 degrees off is not assisted;
//   an enemy fighter; a provider in vehicles.aimTargets (a boss's weak
//   point; entries marked player are ignored; a provider that throws
//   doesn't break anything); the HUD's cue (fighter HUD data-assist);
// - UFO dodging: the bursts are registered as shots; average UFOs are hit
//   most of the time, an uncanny one sometimes slips one;
// - a burst on a block burns a small hole;
// - no console errors throughout.
// With --online (on by default; --solo skips): a host and a guest: the
// guest sees the host's burst along the assisted direction (not the nose);
// the host's assist never picks the guest's jet (PvP on or not).
//
//   node r21-laser-tests.mjs [--only=substring] [--seed=42] [--solo] [--verbose]
// (GAME_ROOT=dir runs another copy of the game; SHOTS=dir saves screenshots.)
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


// ---------- Node ----------

const jetSrc = fs.readFileSync(path.join(ROOT, "js/vehicle-jet.js"), "utf8");
const block = (name) => new RegExp(`export const ${name} = \\{([\\s\\S]*?)\\n\\};`).exec(jetSrc)?.[1];
const numIn = (b, k) => Number(new RegExp(`\\b${k}: ([\\d.]+)`).exec(b)?.[1]);

await check("the numbers: a strong burst, short, a short recharge (about the old beam's damage over time), a 4-6 degree cone", async () => {
  const L = block("JET_LASER");
  assert(L, "JET_LASER");
  const dmg = numIn(L, "damage");
  const burst = numIn(L, "burst");
  const rech = numIn(L, "recharge");
  const deg = (r) => (r * 180) / Math.PI;
  console.log(`    ${dmg} a burst, ${burst} s of beam, ${rech} s to recharge: ${(dmg / (burst + rech)).toFixed(1)} a second held; cone ${deg(numIn(L, "cone")).toFixed(1)} to ${deg(numIn(L, "coneFar")).toFixed(1)} degrees, range ${numIn(L, "range")}`);
  assert(dmg >= 45 && dmg <= 70, `damage a burst: ${dmg}`);
  assert(burst >= 0.15 && burst <= 0.25, `the burst's length: ${burst}`);
  assert(rech >= 0.6 && rech <= 1.0, `the recharge: ${rech}`);
  const dps = dmg / (burst + rech);
  assert(dps >= 40 && dps <= 75, `about the old beam's 60 a second (41 over its heat cycle): ${dps}`);
  assert(deg(numIn(L, "cone")) >= 4 && deg(numIn(L, "cone")) <= 6.5 && deg(numIn(L, "coneFar")) >= 3 && deg(numIn(L, "coneFar")) <= numIn(L, "cone") * 57.3, "the cone");
  assert(!/heatUp|rate: 15/.test(L), "no heat, no pulse rate (bursts)");
  assert(!/laser|_fireLaser|JET_LASER/.test(fs.readFileSync(path.join(ROOT, "js/enemy-jets.js"), "utf8")), "the enemy fighters never use it");
  assert(/this\.aimTargets = \[\]/.test(fs.readFileSync(path.join(ROOT, "js/vehicles.js"), "utf8")), "vehicles.aimTargets");
});


// ---------- Browser ----------

const { chromium } = await import("playwright-core");
const PORT = 11630 + Math.floor(Math.random() * 10);
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

// In-page helpers (window.__r21): a clear sky, stepping the world by hand.
const HELPERS = `(() => {
  const g = window.__ufo;
  const T = g.THREE;
  const H = {};
  // Steps the jets, the bolts and the UFOs together.
  H.step = (dt = 1 / 30) => {
    g.vehicles.update(dt);
    g.ufos.update(dt);
    g.lasers.update(dt);
  };
  H.press = (code, dt = 1 / 30) => {
    g.vehicles.keyDown(code);
    H.step(dt);
    return window.__j.weapon;
  };
  // A right click: down for one step, up the next.
  H.click = (dt = 1 / 30) => {
    g.vehicles.mouseDown(2);
    H.step(dt);
    g.vehicles.mouseUp(2);
    H.step(dt);
  };
  H.hold = (j, at) => {
    j.pos.copy(at.pos);
    j.q.copy(at.q);
    j.vel.copy(at.vel);
    j._levelAim();
  };
  H.snap = (j) => ({ pos: j.pos.clone(), q: j.q.clone(), vel: j.vel.clone() });
  // A point \`dist\` ahead of the jet's laser, \`yawDeg\` to the side and \`pitchDeg\` up off the nose.
  H.off = (j, yawDeg, dist, pitchDeg = 0) => {
    const d = new T.Vector3(0, 0, -1).applyAxisAngle(new T.Vector3(0, 1, 0), (yawDeg * Math.PI) / 180).applyAxisAngle(new T.Vector3(1, 0, 0), (pitchDeg * Math.PI) / 180).applyQuaternion(j.q);
    return j.laserOrigin(new T.Vector3()).addScaledVector(d, dist);
  };
  H.msgs = [];
  if (!H._hooked) {
    const say = g.vehicles.onMessage;
    g.vehicles.onMessage = (t) => {
      H.msgs.push(t);
      say?.(t);
    };
    H._hooked = true;
  }
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
  // Every bolt our jet fires (the laser's and the cannon's).
  H.bolts = [];
  const fire = g.lasers.fire.bind(g.lasers);
  g.lasers.fire = (o) => {
    const b = fire(o);
    if (o.source && o.source === window.__j) H.bolts.push({ radius: o.radius, length: o.length, damage: o.damage, speed: o.speed, cannon: o.length === 9 });
    return b;
  };
  window.__r21 = H;
  return true;
})()`;

// A clear sky: Creative, no missions, UFOs, creatures or patrols; a jet in
// the air at height \`y\` heading north, the player in it (window.__j).
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
    g.vehicles.aimTargets.length = 0;
    for (const j of [...g.vehicles.vehicles]) g.vehicles.remove(j);
    const ground = g.world.heightAt(Math.floor(g.player.position.x), Math.floor(g.player.position.z));
    const p = [g.player.position.x, o.agl ? ground + o.agl : o.y ?? 200, g.player.position.z];
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
    window.__r21.msgs.length = 0;
    window.__r21.bolts.length = 0;
  });
};

await browserCheck("boot: a world, playing", async () => {
  await page.goto(`http://127.0.0.1:${PORT}/index.html?seed=${SEED}&graphics=low`, { waitUntil: "load", timeout: 60000 });
  await page.waitForFunction(() => !!window.__ufo && window.__ufo.graphicsReady, null, { timeout: 120000 });
  await play();
  await page.evaluate(HELPERS);
});

await browserCheck("the bug: the laser's button (real mouse, held and clicked) fires no cannon round and no tracer stream; the cannon is the left button's alone", async () => {
  await sky({ y: 220, speed: 150 });
  await v((g) => {
    const j = window.__j;
    j.selectWeapon("laser");
    const C = (window.__cnt = { cannon: 0, cannonSnd: 0 });
    const fc = j._fireCannon.bind(j);
    j._fireCannon = (...a) => {
      C.cannon++;
      return fc(...a);
    };
    const pc = g.audio.playCannon?.bind(g.audio);
    window.__pc = g.audio.playCannon;
    g.audio.playCannon = (...a) => {
      C.cannonSnd++;
      return pc?.(...a);
    };
    // (Held where it is, while the real game loop runs.) The laser's own
    // clock (game seconds: the loop here may run slower than real time):
    // how long held, how long its beam was out at a stretch.
    const L = (window.__lt = { t: 0, run: 0, max: 0, rmb: false });
    const upd = j._updateLaser.bind(j);
    j._updateLaser = (dt, want, pressed) => {
      const r = upd(dt, want, pressed);
      if (L.rmb) L.t += dt;
      L.run = j.laserOn ? L.run + dt : 0;
      L.max = Math.max(L.max, L.run);
      return r;
    };
    window.__hold = setInterval(() => {
      const a = window.__jetAt;
      j.pos.copy(a.pos);
      j.q.copy(a.q);
      j.vel.copy(a.vel);
    }, 0);
    return true;
  });
  // Waits for `secs` of game time (the laser's clock).
  const gameWait = async (secs) => {
    const t0 = await v(() => window.__j.time);
    await until((g, a) => (window.__j.time - a.t0 >= a.secs ? true : null), { t0, secs }, 60000);
  };
  try {
    await frames(4);
    await page.mouse.move(480, 270);
    const b0 = await v(() => window.__j.laserBursts);
    // Held 2.5 s (game time), then three clicks, each once it's charged.
    await page.mouse.down({ button: "right" });
    await v(() => ((window.__lt.rmb = true), true));
    await gameWait(2.5);
    await page.mouse.up({ button: "right" });
    const heldT = await v(() => ((window.__lt.rmb = false), window.__lt.t));
    await frames(3);
    const held = await v((g, b0) => ({ bursts: window.__j.laserBursts - b0, ...window.__cnt, onMax: +window.__lt.max.toFixed(3), bolts: window.__r21.bolts.map((b) => ({ ...b })) }), b0);
    for (let i = 0; i < 3; i++) {
      await until(() => (window.__j.laserT <= 0 ? true : null), null, 30000);
      await page.mouse.click(480, 270, { button: "right" });
      await frames(3);
    }
    await gameWait(0.4);
    const clicked = await v((g, b0) => ({ bursts: window.__j.laserBursts - b0, ...window.__cnt, onMax: +window.__lt.max.toFixed(3), bolts: window.__r21.bolts.length }), b0);
    // The left button: the cannon (the laser still selected).
    await page.mouse.down({ button: "left" });
    await gameWait(0.5);
    await page.mouse.up({ button: "left" });
    await frames(2);
    const left = await v((g, b0) => ({ bursts: window.__j.laserBursts - b0, ...window.__cnt, weapon: window.__j.weapon }), b0);
    console.log(`    held ${heldT.toFixed(2)} s: ${held.bursts} bursts (the beam out at most ${held.onMax} s at a time), ${held.cannon} cannon rounds; 3 clicks: ${clicked.bursts - held.bursts} bursts, ${clicked.cannon} cannon rounds; the left button: ${left.cannon} cannon rounds`);
    assert(held.cannon === 0 && held.cannonSnd === 0 && clicked.cannon === 0 && clicked.cannonSnd === 0, `no cannon round from the laser's button: ${JSON.stringify({ held, clicked })}`);
    assert(held.bursts === Math.floor(heldT + 0.999) || held.bursts === Math.floor(heldT) + 1, `held: a burst each 1 s: ${held.bursts} in ${heldT}`);
    assert(held.bolts.length === held.bursts && held.bolts.every((b) => !b.cannon && b.radius < 0.03 && b.damage >= 45), `one unseen bolt a burst (no tracer stream): ${JSON.stringify(held.bolts)}`);
    assert(clicked.onMax <= 0.26, `never a constant beam: out at most ${clicked.onMax} s at a time`);
    assert(clicked.bursts - held.bursts === 3, `a click, a burst: ${JSON.stringify(clicked)}`);
    assert(left.cannon >= 2 && left.cannonSnd >= 2 && left.bursts === clicked.bursts && left.weapon === "laser", `the left button fires the cannon (only it): ${JSON.stringify(left)}`);
  } finally {
    await v((g) => {
      clearInterval(window.__hold);
      g.audio.playCannon = window.__pc;
      delete window.__j._fireCannon;
      delete window.__j._updateLaser;
      return true;
    });
  }
});

await browserCheck("one click is one burst: a short beam (~0.2 s, then gone), its damage on a UFO ahead; held, a burst a second, never a constant beam", async () => {
  await sky({ y: 220, speed: 150 });
  const r = await v((g) => {
    const H = window.__r21;
    const j = window.__j;
    H.press("Digit4");
    const at = H.snap(j);
    g.ufos.dodgeScale = 0;
    const u = H.hover(H.off(j, 0, 400));
    const p0 = u.pos.clone();
    const hp0 = u.health;
    const b0 = j.laserBursts;
    const dt = 1 / 60;
    let on = 0;
    let vis = 0;
    let maxLen = 0;
    let kind = null;
    g.vehicles.mouseDown(2);
    H.step(dt);
    g.vehicles.mouseUp(2);
    for (let t = 0; t < 1.6; t += dt) {
      H.hold(j, at);
      H.still(u);
      u.pos.copy(p0);
      if (j.laserOn) on += dt;
      if (j._beam?.group.visible) {
        vis += dt;
        maxLen = Math.max(maxLen, j._beam.core.scale.z);
      }
      kind ||= j.laserHit?.kind;
      H.step(dt);
    }
    const one = { bursts: j.laserBursts - b0, on: +on.toFixed(3), vis: +vis.toFixed(3), maxLen: Math.round(maxLen), kind, dmg: Math.round(hp0 - u.health), hidden: !j._beam.group.visible && !j.laserOn, bolts: H.bolts.length };
    // Held for 3.5 s.
    g.ufos.clear();
    const b1 = j.laserBursts;
    let onRun = 0;
    let onMax = 0;
    let onAll = 0;
    g.vehicles.mouseDown(2);
    for (let t = 0; t < 3.5; t += dt) {
      H.hold(j, at);
      H.step(dt);
      onRun = j.laserOn ? onRun + dt : 0;
      onMax = Math.max(onMax, onRun);
      if (j.laserOn) onAll += dt;
    }
    g.vehicles.mouseUp(2);
    H.step(dt);
    return { one, held: { bursts: j.laserBursts - b1, onMax: +onMax.toFixed(3), onShare: +(onAll / 3.5).toFixed(2) } };
  });
  console.log(`    one click: ${r.one.bursts} burst, the beam out ${r.one.on} s, seen ${r.one.vis} s (up to ${r.one.maxLen} long), ${r.one.dmg} damage; held 3.5 s: ${r.held.bursts} bursts, on ${Math.round(r.held.onShare * 100)}% of the time, ${r.held.onMax} s at most`);
  assert(r.one.bursts === 1 && r.one.bolts === 1, `one burst: ${JSON.stringify(r)}`);
  assert(r.one.on >= 0.15 && r.one.on <= 0.26 && r.one.vis <= 0.6 && r.one.hidden, `a short beam: ${JSON.stringify(r)}`);
  assert(r.one.kind === "ufo" && r.one.maxLen > 350 && r.one.dmg >= 45 && r.one.dmg <= 70, `it hits the UFO with a burst's damage: ${JSON.stringify(r)}`);
  assert(r.held.bursts === 4 && r.held.onMax <= 0.26 && r.held.onShare <= 0.3, `held: a burst each recharge, never a constant beam: ${JSON.stringify(r)}`);
});

await browserCheck("the recharge: clicks while it charges do nothing, one just before it is charged fires then; the HUD's charge", async () => {
  await sky({ y: 220, speed: 150 });
  const r = await v((g) => {
    const H = window.__r21;
    const j = window.__j;
    H.press("Digit4");
    const at = H.snap(j);
    const dt = 1 / 60;
    const b0 = j.laserBursts;
    const at0 = [];
    let t = 0;
    const run = (secs) => {
      for (let s = 0; s < secs - 1e-6; s += dt) {
        H.hold(j, at);
        const n = j.laserBursts;
        H.step(dt);
        t += dt;
        if (j.laserBursts > n) at0.push(+t.toFixed(2));
      }
    };
    const click = () => {
      g.vehicles.mouseDown(2);
      run(dt);
      g.vehicles.mouseUp(2);
    };
    click(); // t 0: fires
    run(0.25);
    const hud1 = { ...j.overlay(g.camera).hud.weapon };
    const row1 = j.hud().rows.find((x) => x[0] === "Laser")?.[1];
    const bar1 = j.hud().bars.find((b) => b.label === "Laser charge")?.value;
    run(0.05);
    click(); // ~0.3: charging, nothing
    run(0.3);
    click(); // ~0.6: still charging
    const mid = j.laserBursts - b0;
    run(0.22);
    click(); // ~0.85: 0.15 s before it is charged: fires at ~1.0
    run(0.5);
    const after = j.laserBursts - b0;
    run(0.2);
    click(); // ~1.6: charging again
    run(0.3);
    const hud2 = { ...j.overlay(g.camera).hud.weapon };
    run(1);
    const ready = { ...j.overlay(g.camera).hud.weapon };
    const row2 = j.hud().rows.find((x) => x[0] === "Laser")?.[1];
    return { at0, mid, after, total: j.laserBursts - b0, hud1, row1, bar1, hud2, ready, row2 };
  });
  console.log(`    bursts at ${r.at0.join(", ")} s`);
  assert(r.mid === 1, `no burst while charging: ${JSON.stringify(r)}`);
  assert(r.after === 2 && r.at0[1] >= 0.98 && r.at0[1] <= 1.05, `a click just before it is charged fires once charged: ${JSON.stringify(r)}`);
  assert(r.total === 2, `the click at 1.6 s did nothing: ${JSON.stringify(r)}`);
  assert(r.hud1.kind === "laser" && r.hud1.ready < 0.35 && r.hud1.left > 0.65 && !r.hud1.on && /charging/.test(r.row1) && r.bar1 < 0.35, `the HUD charges: ${JSON.stringify(r)}`);
  assert(r.ready.ready === 1 && /READY/.test(r.row2), `the HUD: ready: ${JSON.stringify(r)}`);
});

await browserCheck("the aim assist: a UFO 3 degrees off the nose is hit (a crossing one led), one 15 degrees off is not assisted; the HUD's cue", async () => {
  await sky({ y: 230, speed: 150 });
  const r = await v((g) => {
    const H = window.__r21;
    const j = window.__j;
    const T = g.THREE;
    H.press("Digit4");
    const at = H.snap(j);
    g.ufos.dodgeScale = 0;
    const dt = 1 / 60;
    const fwd = j.forward(new T.Vector3());
    const trial = (yaw, pitch, dist, vel = null) => {
      g.ufos.clear();
      j.laserT = 0;
      H.hold(j, at);
      const u = H.hover(H.off(j, yaw, dist, pitch));
      if (vel) u.vel.copy(vel);
      const p0 = u.pos.clone();
      const hp0 = u.health;
      H.step(dt);
      const cue = j.overlay(g.camera).hud.laserAim;
      g.vehicles.mouseDown(2);
      H.hold(j, at);
      H.step(dt);
      g.vehicles.mouseUp(2);
      const s = j.laserShot;
      const shot = s ? { assisted: s.assisted, bendDeg: +((s.dir.angleTo(fwd) * 180) / Math.PI).toFixed(2), toUfoDeg: +((s.dir.angleTo(p0.clone().sub(s.origin)) * 180) / Math.PI).toFixed(2) } : null;
      for (let t = 0; t < 0.6; t += dt) {
        H.hold(j, at);
        if (vel) {
          u.state = "trick";
          u.vel.copy(vel);
        } else {
          H.still(u);
          u.pos.copy(p0);
        }
        H.step(dt);
      }
      return { yaw, pitch, dist, cue: cue ? cue.name : null, ...shot, dmg: Math.round(hp0 - u.health) };
    };
    const out = [trial(3, 0, 400), trial(-2.5, 1.5, 700), trial(0, -3, 250), trial(15, 0, 400), trial(0, 12, 300), trial(9, 0, 900)];
    // A crossing UFO 3 degrees off, 500 out, at 45 blocks/s sideways: the burst leads it.
    const right = j.right(new T.Vector3());
    out.push({ ...trial(3, 0, 500, right.clone().multiplyScalar(-45)), crossing: true });
    return out;
  });
  for (const t of r) console.log(`    ${t.crossing ? "crossing " : ""}UFO ${t.yaw}/${t.pitch} deg off at ${t.dist}: ${t.assisted ? `assisted (bent ${t.bendDeg} deg)` : "not assisted"}, ${t.dmg} damage, cue ${t.cue || "none"}`);
  const [a, b, c, d, e, f, x] = r;
  for (const t of [a, b, c]) assert(t.assisted && t.dmg >= 45 && t.cue === "UFO" && t.toUfoDeg < 0.6, `assisted onto it and hit: ${JSON.stringify(t)}`);
  assert(Math.abs(a.bendDeg - 3) < 0.6, `bent ~3 degrees: ${JSON.stringify(a)}`);
  for (const t of [d, e, f]) assert(!t.assisted && t.bendDeg < 0.01 && t.dmg === 0 && !t.cue, `not assisted: ${JSON.stringify(t)}`);
  assert(x.assisted && x.dmg >= 45 && x.toUfoDeg > 0.6, `a crossing UFO led and hit: ${JSON.stringify(x)}`);
  // The fighter HUD's cue in the real loop: a UFO 3 degrees off.
  await v((g) => {
    const j = window.__j;
    const H = window.__r21;
    g.ufos.clear();
    window.__cueU = H.hover(H.off(j, 2, 350, 1));
    window.__hold = setInterval(() => {
      const a = window.__jetAt;
      j.pos.copy(a.pos);
      j.q.copy(a.q);
      j.vel.copy(a.vel);
      H.still(window.__cueU);
    }, 0);
    return true;
  });
  try {
    const st = await until(() => document.getElementById("fighter-hud")?.dataset.assist === "1" && "ok", null, 15000);
    assert(st === "ok", `the fighter HUD's cue: ${await v(() => JSON.stringify(document.getElementById("fighter-hud")?.dataset))}`);
    if (SHOTS) await page.screenshot({ path: path.join(SHOTS, "r21-assist-cue.png") });
    await v(() => {
      window.__cueU.pos.add(new window.__ufo.THREE.Vector3(120, 0, 0));
      return true;
    });
    const off = await until(() => document.getElementById("fighter-hud")?.dataset.assist === "" && "ok", null, 15000);
    assert(off === "ok", "the cue goes when the target leaves the cone");
  } finally {
    await v(() => (clearInterval(window.__hold), true));
  }
});

await browserCheck("the aim assist's other targets: an enemy fighter; vehicles.aimTargets (a boss's weak point; player entries ignored; a provider that throws)", async () => {
  await sky({ y: 230, speed: 150 });
  const r = await v((g) => {
    const H = window.__r21;
    const j = window.__j;
    const T = g.THREE;
    H.press("Digit4");
    const at = H.snap(j);
    const dt = 1 / 60;
    const fwd = j.forward(new T.Vector3());
    const fireOnce = () => {
      j.laserT = 0;
      H.hold(j, at);
      g.vehicles.mouseDown(2);
      H.step(dt);
      g.vehicles.mouseUp(2);
      return j.laserShot;
    };
    // An enemy fighter 3 degrees off, 300 out, held still.
    const p = H.off(j, -3, 300);
    const ej = g.vehicles.create("enemyjet", { pos: p.toArray(), yaw: 0, airborne: true, speed: 0, throttle: 0 });
    const hp0 = ej.health;
    const s1 = fireOnce();
    const jet = { assisted: s1.assisted, toDeg: (s1.dir.angleTo(p.clone().sub(s1.origin)) * 180) / Math.PI };
    for (let t = 0; t < 0.5; t += dt) {
      H.hold(j, at);
      ej.pos.copy(p);
      ej.vel.set(0, 0, 0);
      H.step(dt);
    }
    jet.hurt = Math.round(hp0 - ej.health);
    g.vehicles.remove(ej);
    // A provider: a boss's weak point (a point 2.5 degrees off, 500 out), a
    // "player" 1 degree off (ignored), and one that throws.
    const weak = H.off(j, 2.5, 500, -1);
    const pl = H.off(j, -1, 200);
    let calls = 0;
    const prov = () => {
      calls++;
      return [{ pos: weak, radius: 3, name: "WEAK POINT" }, { pos: pl, radius: 2, player: true }];
    };
    const bad = () => {
      throw new Error("a broken provider");
    };
    g.vehicles.aimTargets.push(bad, prov);
    H.step(dt);
    const cue = j.overlay(g.camera).hud.laserAim?.name;
    const s2 = fireOnce();
    const boss = { assisted: s2.assisted, toDeg: (s2.dir.angleTo(weak.clone().sub(s2.origin)) * 180) / Math.PI, cue, calls };
    // Only the "player": not assisted.
    g.vehicles.aimTargets.length = 0;
    g.vehicles.aimTargets.push(() => [{ pos: pl, radius: 2, player: true }]);
    const s3 = fireOnce();
    const player = { assisted: s3.assisted, bend: (s3.dir.angleTo(fwd) * 180) / Math.PI };
    g.vehicles.aimTargets.length = 0;
    for (let t = 0; t < 0.5; t += dt) H.step(dt);
    return { jet, boss, player };
  });
  console.log(`    enemy fighter: ${r.jet.assisted ? "assisted" : "not assisted"}, ${r.jet.hurt} damage; weak point: ${r.boss.assisted ? "assisted" : "not"} (${r.boss.toDeg.toFixed(2)} deg off it, cue ${r.boss.cue}); player entry: ${r.player.assisted ? "ASSISTED" : "ignored"}`);
  assert(r.jet.assisted && r.jet.toDeg < 0.6 && r.jet.hurt >= 25, `the enemy fighter: ${JSON.stringify(r.jet)}`);
  assert(r.boss.assisted && r.boss.toDeg < 0.3 && r.boss.cue === "WEAK POINT" && r.boss.calls > 0, `a registered weak point: ${JSON.stringify(r.boss)}`);
  assert(!r.player.assisted && r.player.bend < 0.01, `a player entry is never assisted onto: ${JSON.stringify(r.player)}`);
});

await browserCheck("UFO dodging: each burst is a shot the UFOs see; average UFOs are hit most of the time, an uncanny one sometimes slips one", async () => {
  await sky({ y: 240, speed: 150 });
  const r = await v((g) => {
    const H = window.__r21;
    const j = window.__j;
    H.press("Digit4");
    const at = H.snap(j);
    const dt = 1 / 60;
    g.ufos.dodgeScale = 1;
    const st = g.ufos.mischief;
    const trial = (size, dist, setup) => {
      g.ufos.clear();
      j.laserT = 0;
      H.hold(j, at);
      const u = g.ufos.spawn({ size, pos: H.off(j, 2.5 * (Math.random() < 0.5 ? -1 : 1), dist, (Math.random() - 0.5) * 2), design: "saucer" });
      H.still(u);
      u.health = u.maxHealth = 5000;
      setup?.(u);
      const p0 = u.pos.clone();
      for (let i = 0; i < 6; i++) {
        H.hold(j, at);
        H.step(dt);
      }
      const hp0 = u.health;
      const th0 = st.threats;
      const d0 = st.dodges;
      g.vehicles.mouseDown(2);
      H.step(dt);
      g.vehicles.mouseUp(2);
      let slid = false;
      for (let t = 0; t < 0.7; t += dt) {
        H.hold(j, at);
        H.still(u);
        slid ||= !!(u.evade || u.dash);
        if (!slid) u.pos.copy(p0);
        H.step(dt);
      }
      return { hit: hp0 - u.health > 0, seen: st.threats - th0, dodged: st.dodges - d0 };
    };
    // Average ships as they come (their own skill, reaction and mood), 450 out.
    const avg = [];
    for (let i = 0; i < 16; i++)
      avg.push(
        trial("medium", 450, (u) => {
          u.dodgeSkill = 0.2 + Math.random() * 0.3; // (the "average" band)
          u.dodgeReact = 0.1 + Math.random() * 0.2;
          u.mood = ["calm", "curious", "playful", "grumpy"][i % 4];
        })
      );
    // An uncanny small one, 650 out, quick and cheeky, fired at once a
    // second (held: its fatigue and wariness carry over from one to the next).
    g.ufos.clear();
    j.laserT = 0;
    H.hold(j, at);
    const uu = g.ufos.spawn({ size: "small", pos: H.off(j, 2, 650, 0.5), design: "saucer" });
    H.still(uu);
    uu.health = uu.maxHealth = 50000;
    uu.dodgeSkill = 0.9;
    uu.dodgeReact = 0.06;
    uu.mood = "cheeky";
    const up0 = uu.pos.clone();
    const unc = [];
    for (let i = 0; i < 14; i++) {
      uu.evade = null;
      uu.dash = null;
      uu.pos.copy(up0);
      uu.mood = "cheeky";
      const hp0 = uu.health;
      const d0 = st.dodges;
      j.laserT = 0;
      g.vehicles.mouseDown(2);
      H.step(dt);
      g.vehicles.mouseUp(2);
      let slid = false;
      for (let t = 0; t < 1; t += dt) {
        H.hold(j, at);
        H.still(uu);
        slid ||= !!(uu.evade || uu.dash);
        if (!slid) uu.pos.copy(up0);
        H.step(dt);
      }
      unc.push({ hit: hp0 - uu.health > 0, dodged: st.dodges - d0 });
    }
    const sum = (a, k) => a.reduce((s, x) => s + (x[k] ? 1 : 0), 0);
    return { avgHits: sum(avg, "hit"), avgN: avg.length, avgSeen: sum(avg, "seen"), uncHits: sum(unc, "hit"), uncN: unc.length, uncDodged: sum(unc, "dodged") };
  });
  console.log(`    average UFOs at 450: ${r.avgHits}/${r.avgN} hit (${r.avgSeen} saw it coming); an uncanny one at 650, a burst a second: ${r.uncDodged}/${r.uncN} dodged, ${r.uncHits} hit`);
  assert(r.avgSeen >= r.avgN - 1, `every burst is a shot the UFOs see: ${JSON.stringify(r)}`);
  assert(r.avgHits >= Math.ceil(r.avgN * 0.75), `average UFOs hit most of the time: ${JSON.stringify(r)}`);
  assert(r.uncDodged >= 1 && r.uncHits >= 1 && r.uncDodged + r.uncHits >= r.uncN - 1, `an uncanny one sometimes dodges (and then isn't hit): ${JSON.stringify(r)}`);
});

await browserCheck("a burst on a block burns a small hole", async () => {
  // (Blocks go up to y 127: the jet flies at 112 here, the air cleared before it.)
  await sky({ y: 112, speed: 150 });
  const b = await v((g) => {
    const H = window.__r21;
    const j = window.__j;
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
    let kind = null;
    for (let k = 0; k < 2; k++) {
      j.laserT = 0;
      g.vehicles.mouseDown(2);
      H.step(1 / 30);
      g.vehicles.mouseUp(2);
      for (let t = 0; t < 0.5; t += 1 / 30) {
        H.hold(j, at);
        H.step(1 / 30);
        kind ||= j.laserHit?.kind;
      }
    }
    return { n0, n1: count(), kind, burnt: j.laserBurnt || 0 };
  });
  console.log(`    2 bursts: ${b.n0 - b.n1} blocks burnt`);
  assert(b.kind === "block" && b.n0 === 105 && b.n1 < b.n0 && b.n0 - b.n1 <= 40, `a small hole: ${JSON.stringify(b)}`);
});

if (SHOTS) {
  await sky({ y: 140, speed: 150 });
  await v((g) => {
    const j = window.__j;
    const H = window.__r21;
    j.selectWeapon("laser");
    j.cameraMode = 0;
    window.__shotU = H.hover(H.off(j, 3, 260));
    window.__hold = setInterval(() => {
      const a = window.__jetAt;
      j.pos.copy(a.pos);
      j.q.copy(a.q);
      j.vel.copy(a.vel);
      H.still(window.__shotU);
      // (The burst held mid-flash for the picture: the loop here is slow.)
      if (j.laserShot) j.laserShot.t = Math.min(j.laserShot.t, 0.08);
    }, 0);
    return true;
  });
  await frames(6);
  await v((g) => (g.vehicles.mouseDown(2), true));
  await frames(3);
  await page.screenshot({ path: path.join(SHOTS, "r21-burst.png") });
  await v((g) => {
    window.__j.cameraMode = 1;
    return true;
  });
  await frames(3);
  await page.screenshot({ path: path.join(SHOTS, "r21-burst-cockpit.png") });
  await v(() => ((window.__j.cameraMode = 0), true));
  await v((g) => (g.vehicles.mouseUp(2), clearInterval(window.__hold), true));
}

await v((g) => {
  if (g.vehicles.active) g.vehicles.exit({ force: true });
  g.vehicles.aimTargets.length = 0;
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
  await browserCheck("online: the guest sees the host's burst along the assisted direction; the host's assist never picks the guest's jet", async () => {
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
    // The host's jet 250 up over the guest, flying north, held level; a UFO
    // 3 degrees off its nose, 450 out (no dodging).
    const hj = await vOn(host, (g) => {
      const at = g.player.position.clone();
      for (const v of [...g.vehicles.vehicles]) if (!v.puppet) g.vehicles.remove(v);
      const jet = g.vehicles.create("jet", { jetType: "f22", pos: [at.x, g.world.heightAt(Math.floor(at.x), Math.floor(at.z)) + 250, at.z], yaw: 0, airborne: true, speed: 150, throttle: 0.7 });
      g.vehicles.enter(jet);
      window.__j = jet;
      jet.selectWeapon("laser");
      const hold = { pos: jet.pos.clone(), q: jet.q.clone(), vel: jet.vel.clone() };
      window.__jh = hold;
      const T = g.THREE;
      const d = new T.Vector3(0, 0, -1).applyAxisAngle(new T.Vector3(0, 1, 0), (3 * Math.PI) / 180).applyQuaternion(jet.q);
      const u = g.ufos.spawn({ size: "medium", design: "saucer", pos: jet.laserOrigin(new T.Vector3()).addScaledVector(d, 450) });
      u.health = u.maxHealth = 5000;
      u.state = "trick";
      u.trick = "hover";
      u.timer = 1e9;
      u.vel.set(0, 0, 0);
      u.dodgeMul = 0;
      window.__u = u;
      window.__up = u.pos.clone();
      window.__hold = setInterval(() => {
        jet.pos.copy(hold.pos);
        jet.q.copy(hold.q);
        jet.vel.copy(hold.vel);
        jet._levelAim();
        u.pos.copy(window.__up);
        u.vel.set(0, 0, 0);
        u.state = "trick";
      }, 0);
      return { nid: jet.net?.nid ?? null };
    });
    assert(hj.nid, `the host's jet is shared: ${JSON.stringify(hj)}`);
    // The guest: near the host's jet (in its sync range), watching its copy.
    const seenJet = await untilOn(guest, (g, nid) => {
      const p = g.vehicles.vehicles.find((x) => x.puppet && x.net?.nid === nid);
      if (!p) return null;
      g.player.position.set(p.pos.x + 60, p.pos.y - 30, p.pos.z + 40);
      g.player.flying = true;
      window.__seenShots = [];
      if (!window.__wrapped) {
        window.__wrapped = true;
        const nj = p.netJet.bind(p);
        p.netJet = (st, dt) => {
          const before = p.laserShot;
          nj(st, dt);
          const s = p.laserShot;
          if (s && s !== before && s.remote) {
            const fwd = p.forward(new g.THREE.Vector3());
            window.__seenShots.push({ dir: s.dir.toArray(), offNoseDeg: (s.dir.angleTo(fwd) * 180) / Math.PI });
          }
        };
      }
      return p._netSeen ? true : null;
    }, hj.nid, 40000);
    assert(seenJet, "the guest sees the host's jet");
    // The host clicks: one assisted burst.
    const fired = await vOn(host, (g) =>
      new Promise((res) => {
        const j = window.__j;
        const hp0 = window.__u.health;
        g.vehicles.mouseDown(2);
        setTimeout(() => {
          g.vehicles.mouseUp(2);
          const s = j.laserShot;
          setTimeout(() => res({ assisted: !!s?.assisted, dir: s?.dir.toArray(), bendDeg: s ? (s.dir.angleTo(j.forward(new g.THREE.Vector3())) * 180) / Math.PI : null, dmg: Math.round(hp0 - window.__u.health), bursts: j.laserBursts }), 600);
        }, 80);
      })
    );
    assert(fired.assisted && fired.bendDeg > 2.3 && fired.dmg >= 45, `the host's burst is assisted and hits: ${JSON.stringify(fired)}`);
    const seen = await untilOn(guest, () => (window.__seenShots.length ? window.__seenShots[0] : null), null, 20000);
    assert(seen, "the guest sees the host's burst");
    const ang = await vOn(guest, (g, a) => (new g.THREE.Vector3(...a[0]).angleTo(new g.THREE.Vector3(...a[1])) * 180) / Math.PI, [seen.dir, fired.dir]);
    console.log(`    the host's burst bent ${fired.bendDeg.toFixed(2)} deg onto its UFO (${fired.dmg} damage); the guest drew it ${seen.offNoseDeg.toFixed(2)} deg off the copy's nose, ${ang.toFixed(2)} deg from the host's own`);
    assert(seen.offNoseDeg > 2 && ang < 0.8, `the guest's beam follows the assisted direction, not the nose: ${JSON.stringify({ seen, fired, ang })}`);
    // The guest's jet 3 degrees off the host's nose, 300 out (PvP on and off):
    // never picked by the assist.
    await vOn(host, (g) => {
      g.ufos.clear();
      clearInterval(window.__hold);
      const j = window.__j;
      const hold = window.__jh;
      window.__hold = setInterval(() => {
        j.pos.copy(hold.pos);
        j.q.copy(hold.q);
        j.vel.copy(hold.vel);
        j._levelAim();
      }, 0);
      return true;
    });
    const gp = await vOn(host, (g) => {
      const j = window.__j;
      const T = g.THREE;
      const d = new T.Vector3(0, 0, -1).applyAxisAngle(new T.Vector3(0, 1, 0), (-3 * Math.PI) / 180).applyQuaternion(j.q);
      return j.laserOrigin(new T.Vector3()).addScaledVector(d, 300).toArray();
    });
    await vOn(guest, (g, p) => {
      if (g.vehicles.active) g.vehicles.exit({ force: true });
      g.player.position.set(p[0], p[1] - 40, p[2]);
      const jet = g.vehicles.create("jet", { jetType: "f16", pos: p, yaw: 0, airborne: true, speed: 150, throttle: 0.7 });
      g.vehicles.enter(jet);
      const hold = { pos: jet.pos.clone(), q: jet.q.clone(), vel: jet.vel.clone() };
      window.__gh = setInterval(() => {
        jet.pos.copy(hold.pos);
        jet.q.copy(hold.q);
        jet.vel.copy(hold.vel);
      }, 0);
      return true;
    }, gp);
    const there = await untilOn(host, (g) => {
      const p = g.vehicles.vehicles.find((x) => x.puppet && x.type === "jet" && x.netOcc);
      return p && p.pos.distanceTo(window.__j.pos) < 330 ? true : null;
    }, null, 30000);
    assert(there, "the host sees the guest's jet ahead");
    const pvp = [];
    for (const on of [false, true]) {
      pvp.push(
        await vOn(host, (g, on) =>
          new Promise((res) => {
            const j = window.__j;
            g.vehicles.pvp = on;
            j.laserT = 0;
            setTimeout(() => {
              const aim = j.overlay(g.camera).hud.laserAim;
              const lock = j._lockables().some((t) => t.ref?.puppet && t.ref.netOcc);
              g.vehicles.mouseDown(2);
              setTimeout(() => {
                g.vehicles.mouseUp(2);
                const s = j.laserShot;
                res({ pvp: on, aim: aim ? aim.name : null, assisted: !!s?.assisted, bendDeg: s ? (s.dir.angleTo(j.forward(new g.THREE.Vector3())) * 180) / Math.PI : null, missileLockable: lock });
              }, 60);
            }, 150);
          }), on)
      );
    }
    await vOn(host, (g) => {
      clearInterval(window.__hold);
      g.vehicles.pvp = false;
      return true;
    });
    await vOn(guest, () => (clearInterval(window.__gh), true));
    console.log(`    the guest's jet 3 deg off the host's nose: ${pvp.map((x) => `PvP ${x.pvp ? "on" : "off"}: ${x.assisted ? "ASSISTED" : "not assisted"}`).join(", ")}`);
    for (const x of pvp) assert(!x.aim && !x.assisted && x.bendDeg < 0.01, `never another player: ${JSON.stringify(pvp)}`);
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
