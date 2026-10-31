// Round 13 "air" tests: the fighter's auto aim, the lock-on HUD, homing
// missiles, the sonic boom, bigger missile blasts and the pilot's voice.
// Boots the real game in headless Chromium (software WebGL, Low preset):
// keeping a UFO round the crosshair locks it in about 2 s with auto aim
// (not before 1.6 s) and the HUD canvas shows the lock (Round 14: Round
// 12's small lock box again, on the target); a click then sends a
// missile that homes on a UFO flying across and hits it; a click with
// nothing in the seeker fires one straight ahead; a fighter on its
// afterburner breaks the sound barrier (a boom and a vapor cone, once) and a
// jet just under Mach 1 makes none; slowing back through it booms softly;
// a missile's blast is the bigger one (crater 6.5) and gets the extras; a
// kill queues the pilot's callout ("UFO destroyed", "Ball UFO", "Splash
// one"), "Fox two" on a guided launch (speech is stubbed here).
//
//   node r13-air-tests.mjs [--only=substring] [--seed=42]
// (SHOTS=dir saves screenshots of the lock HUD, the vapor cone, the blast.)
//
// Until the lead wires js/fighter-hud.js and js/voice.js into main.js, the
// server applies that patch to main.js as it serves it (a no-op once it is in).
import http from "node:http";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(process.env.GAME_ROOT || path.join(__dirname, ".."));
const SHOTS = process.env.SHOTS ? path.resolve(process.env.SHOTS) : null;
if (SHOTS) fs.mkdirSync(SHOTS, { recursive: true });
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

// The main.js wiring (the same as the patch in the round's report).
function wire(src) {
  if (src.includes("./fighter-hud.js")) return src;
  const rep = (a, b) => {
    if (!src.includes(a)) throw new Error(`main.js patch: anchor not found: ${a.slice(0, 60)}`);
    src = src.replace(a, b);
  };
  rep(`import { Radar } from "./radar.js";\n`, `import { Radar } from "./radar.js";\nimport { FighterHud } from "./fighter-hud.js";\nimport { voice } from "./voice.js";\n`);
  rep(
    `settingsPanel.on("vehicles.jetAimAssist", (v) => (vehicles.config.jet.aimAssist = v));\n`,
    `settingsPanel.on("vehicles.jetAimAssist", (v) => (vehicles.config.jet.aimAssist = v));\nsettingsPanel.on("vehicles.jetAutoAim", (v) => (vehicles.config.jet.autoAim = v));\nsettingsPanel.on("vehicles.voiceCallouts", (v) => (voice.enabled = v !== false));\nvoice.attach({ audio, stats, ufos, listener: effects.listener });\n`
  );
  rep(`const _lockV = new THREE.Vector3();\nfunction updateJetOverlay() {`, `const _lockV = new THREE.Vector3();\nconst fighterHud = new FighterHud(document.getElementById("fighter-hud"));\nfunction updateJetOverlay() {`);
  const a = src.indexOf(`  lockBoxEl.classList.toggle("hidden", !lock);`);
  const b = src.indexOf(`  jetNoseEl.classList.toggle("hidden"`, a);
  const c = src.indexOf(`  // Incoming missile: an arrow pointing where it comes from`, b);
  const d = src.indexOf(`\n}\n`, c);
  if (a < 0 || b < 0 || c < 0 || d < 0) throw new Error("main.js patch: updateJetOverlay not found");
  src =
    src.slice(0, a) +
    `  // (Round 13) The targeting symbols and the warnings: js/fighter-hud.js.\n  lockBoxEl.classList.add("hidden");\n  salvoGlowEl.style.opacity = "0";\n  missileWarnEl.classList.add("hidden");\n  fighterHud.update({ vehicle: v, camera, overlay: o, lock: o?.hud ? null : lock });\n` +
    src.slice(b, c) +
    src.slice(d + 1);
  return src;
}

const PORT = 9720 + Math.floor(Math.random() * 40);
const SEED = Number(args.seed ?? 42);
const MIME = { ".html": "text/html", ".js": "text/javascript" };
const server = http.createServer((req, res) => {
  const url = decodeURIComponent(req.url.split("?")[0]);
  let filePath = path.join(ROOT, url);
  if (filePath.endsWith("/")) filePath = path.join(filePath, "index.html");
  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404);
      res.end("not found");
      return;
    }
    if (url === "/js/main.js") data = wire(String(data));
    res.writeHead(200, { "Content-Type": MIME[path.extname(filePath)] || "application/octet-stream" });
    res.end(data);
  });
});
await new Promise((r) => server.listen(PORT, r));

const errors = [];
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome",
  args: ["--use-gl=swiftshader", "--enable-webgl", "--ignore-gpu-blocklist", "--no-sandbox", "--disable-dev-shm-usage"],
});
const [VW, VH] = (process.env.SIZE || "960x540").split("x").map(Number);
const page = await browser.newPage({ viewport: { width: VW, height: VH } });
const localThreeRoot = path.join(__dirname, "node_modules", "three");
await page.route("https://cdn.jsdelivr.net/npm/three@0.160.0/**", (route) => {
  const rel = new URL(route.request().url()).pathname.replace("/npm/three@0.160.0/", "");
  route.fulfill({ path: path.join(localThreeRoot, rel), contentType: "text/javascript" });
});
page.on("console", (m) => {
  if (m.type() === "error") errors.push(m.text());
});
page.on("pageerror", (e) => errors.push(String(e)));
page.on("dialog", (d) => d.accept());
// Speech, stubbed: what the pilot says goes into window.__spoken.
await page.addInitScript(() => {
  window.__spoken = [];
  class U {
    constructor(text) {
      this.text = text;
    }
  }
  window.SpeechSynthesisUtterance = U;
  const synth = {
    speak(u) {
      window.__spoken.push(u.text);
      setTimeout(() => u.onend?.(), 30);
    },
    cancel() {},
    getVoices: () => [{ name: "Test English Male", lang: "en-US" }],
    addEventListener() {},
  };
  Object.defineProperty(window, "speechSynthesis", { value: synth, configurable: true });
});

const frames = (n = 2) =>
  page.evaluate(
    (k) =>
      new Promise((r) => {
        let i = 0;
        const f = () => (++i >= k ? r() : requestAnimationFrame(f));
        requestAnimationFrame(f);
      }),
    n
  );
const v = (fn, arg) => page.evaluate(([src, a]) => new Function("g", "arg", `return (${src})(g, arg);`)(window.__ufo, a), [fn.toString(), arg]);
async function until(fn, arg, ms = 30000) {
  const t0 = Date.now();
  let r;
  while (Date.now() - t0 < ms) {
    r = await v(fn, arg);
    if (r) return r;
    await frames(2);
  }
  return r;
}
async function shot(name) {
  if (!SHOTS) return;
  const file = path.join(SHOTS, `${name}.png`);
  await page.screenshot({ path: file });
  console.log(`        screenshot: ${file}`);
}

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

await page.goto(`http://localhost:${PORT}/index.html?seed=${SEED}`, { waitUntil: "load", timeout: 60000 });
await page.waitForFunction(() => !!window.__ufo, null, { timeout: 60000 });
await page.evaluate(() => window.__ufo.setGraphics("low"));
await page.waitForFunction(() => window.__ufo.graphicsReady, null, { timeout: 120000 });
{
  const t0 = Date.now();
  while (Date.now() - t0 < 300000) {
    const st = await v((g) => g.gameState);
    if (st === "playing") break;
    if (st === "start") await page.click("#play-btn", { timeout: 5000 }).catch(() => {});
    else if (await page.isVisible("#resume-btn")) await page.click("#resume-btn", { timeout: 3000 }).catch(() => {});
    else await page.mouse.click(VW / 2, VH / 2);
    await frames(3);
  }
}

// A clear sky: Creative, no missions, UFOs, creatures or patrols; a fighter
// in the air at y 200 heading north (-Z), the player in it. Returns nothing:
// the jet is window.__j.
async function play() {
  // (Retried until the game runs: the pointer lock a click asks for can come
  // a moment later and pause the game again.)
  const t0 = Date.now();
  while (Date.now() - t0 < 300000) {
    const st = await v((g) => g.gameState);
    if (st === "playing") return;
    if (st === "dead") await v((g) => g.respawn());
    else if (st === "start") await page.click("#play-btn", { timeout: 5000 }).catch(() => {});
    else if (await page.isVisible("#resume-btn")) await page.click("#resume-btn", { timeout: 3000 }).catch(() => {});
    else {
      await page.mouse.click(VW / 2, VH / 2);
      await frames(5);
      if ((await v((g) => g.gameState)) === "paused" && !(await page.isVisible("#resume-btn"))) await page.evaluate(() => document.getElementById("pause-menu").classList.remove("hidden"));
    }
    await frames(3);
  }
}
const sky = async (opts = {}) => {
  await play();
  return v((g, o) => {
    g.testFlags.noMissions = true;
    if (g.player.dead) g.respawn();
    if (g.vehicles.active) g.vehicles.exit({ force: true });
    g.setMode("creative");
    g.ufos.clear();
    g.mobs.clear();
    g.enemyJets.config.count = 0;
    for (const j of [...g.vehicles.vehicles]) g.vehicles.remove(j);
    const p = g.player.position;
    const jet = g.vehicles.create("jet", { jetType: o.type || "f22", pos: [p.x, 200, p.z], yaw: 0, airborne: true, speed: o.speed ?? 150, throttle: o.throttle ?? 0.7 });
    g.vehicles.enter(jet);
    g.player.keys.clear();
    g.vehicles.input.buttons.fill(false);
    window.__j = jet;
    return true;
  }, opts);
  await frames(2); // (the camera, and the listener with it, on the new jet)
};

await check("auto aim: a UFO kept round the crosshair locks in about 2 s (not before 1.6 s), the seeker tone goes solid, the HUD shows the lock", async () => {
  await sky();
  const r = await v((g) => {
    const jet = window.__j;
    const T = g.THREE;
    const u = g.ufos.spawn({ design: "saucer", size: "medium", pos: new T.Vector3(jet.pos.x, 200, jet.pos.z - 500) });
    window.__u = u;
    const keep = () => {
      u.pos.copy(jet.pos).addScaledVector(new T.Vector3(0, 0, -1).applyQuaternion(jet.aimQ), 500);
      u.vel.set(0, 0, 0);
      jet.pos.y = 200;
    };
    const tones = [];
    const tone = g.audio.setSeekerTone.bind(g.audio);
    g.audio.setSeekerTone = (st, p) => (tones.push(st), tone(st, p));
    let lockedAt = -1;
    let t = 0;
    let at1 = null;
    const dt = 1 / 30;
    while (t < 2.6) {
      keep();
      g.vehicles.update(dt);
      t += dt;
      if (Math.abs(t - 1.0) < dt / 2) at1 = { target: !!jet.lock.target, progress: jet.lock.progress, locked: jet.lock.locked };
      if (jet.lock.locked && lockedAt < 0) lockedAt = t;
    }
    g.audio.setSeekerTone = tone;
    keep();
    return { lockedAt, at1, auto: jet.lock.auto, solid: tones.slice(-3).every((s) => s === 2), growl: tones.includes(1), name: jet.overlay(g.camera).hud?.target?.name };
  });
  assert(r.at1 && r.at1.target && !r.at1.locked && r.at1.progress > 0.35 && r.at1.progress < 0.65, `a second in: tracking, about half way: ${JSON.stringify(r)}`);
  assert(r.lockedAt >= 1.6 && r.lockedAt <= 2.3, `locked after about 2 s: ${JSON.stringify(r)}`);
  assert(r.auto && r.growl && r.solid, `the seeker's growl, then a solid tone: ${JSON.stringify(r)}`);
  // The HUD (a few real frames, the UFO held ahead).
  await play();
  const hud = await until(() => {
    const j = window.__j;
    window.__u.pos.copy(j.pos).addScaledVector(new window.__ufo.THREE.Vector3(0, 0, -1).applyQuaternion(j.aimQ), 500);
    j.pos.y = 200;
    const c = document.getElementById("fighter-hud");
    window.__dbg = { gs: window.__ufo.gameState, act: window.__ufo.vehicles.active === j, body: document.body.className, st: c?.dataset.state, hidden: c?.classList.contains("hidden"), locked: j.lock.locked, tgt: !!j.lock.target, auto: j.lock.auto, alive: window.__u.state };
    return c && !c.classList.contains("hidden") && c.dataset.state === "locked" && { state: c.dataset.state, lockBoxHidden: document.getElementById("lock-box").classList.contains("hidden") };
  }, null, 60000);
  if (!hud) console.log(JSON.stringify(await v(() => window.__dbg)));
  assert(hud && hud.lockBoxHidden, `the HUD canvas shows the lock (the old DOM box stays hidden): ${JSON.stringify(hud)}`);
  // (Round 14) Small: Round 12's locked box (32 at 720 lines), not a big circle.
  const box = await until(async () => {
    const j = window.__j;
    window.__u.pos.copy(j.pos).addScaledVector(new window.__ufo.THREE.Vector3(0, 0, -1).applyQuaternion(j.aimQ), 500);
    j.pos.y = 200;
    const { FighterHud } = await import("./js/fighter-hud.js");
    const H = FighterHud.last;
    return H && H.box.ok && H.pop >= 1 && Math.abs(H.box.size - 32 * H.s) < 2 && { size: H.box.size, s: H.s, ring: H.ring };
  }, null, 30000);
  assert(box && box.size <= 34 * box.s && box.ring <= 22 * box.s + 0.01, `the locked box and the seeker ring are small: ${JSON.stringify(box)}`);
  await shot("lock-locked");
});

await check("auto aim: the lock's HUD while building (the box closing in on the target), and the idle seeker ring", async () => {
  await sky();
  await v((g) => {
    const jet = window.__j;
    const T = g.THREE;
    const u = g.ufos.spawn({ design: "sphere", size: "medium", pos: new T.Vector3(jet.pos.x, 200, jet.pos.z - 400) });
    window.__u = u;
    window.__keep = () => {
      const f = new T.Vector3(0, 0, -1).applyQuaternion(jet.aimQ);
      const side = new T.Vector3(1, 0, 0).applyQuaternion(jet.aimQ);
      u.pos.copy(jet.pos).addScaledVector(f, 400).addScaledVector(side, 30);
      u.vel.set(0, 0, 0);
      jet.pos.y = 200;
    };
    for (let i = 0; i < 25; i++) {
      window.__keep();
      g.vehicles.update(1 / 30);
    }
  });
  const st = await until(() => {
    window.__keep();
    window.__j.lock.t = Math.min(window.__j.lock.t, 0.9);
    const c = document.getElementById("fighter-hud");
    return c.dataset.state === "locking" && c.dataset.state;
  }, null, 60000);
  assert(st === "locking", `the HUD shows the lock building: ${st}`);
  await shot("lock-building");
  const idle = await until((g) => {
    g.ufos.clear();
    const c = document.getElementById("fighter-hud");
    return c.dataset.state === "seek" && c.dataset.state;
  }, null, 60000);
  assert(idle === "seek", `the idle seeker ring: ${idle}`);
});

await check("a missile fired with the lock homes on a UFO flying across and hits it; Fox two is called", async () => {
  await sky();
  const r = await v((g) => {
    const jet = window.__j;
    const T = g.THREE;
    window.__spoken.length = 0;
    const u = g.ufos.spawn({ design: "saucer", size: "medium", pos: new T.Vector3(jet.pos.x, 200, jet.pos.z - 600) });
    u.health = u.maxHealth = 5000;
    const f = new T.Vector3(0, 0, -1).applyQuaternion(jet.aimQ);
    const dt = 1 / 30;
    for (let t = 0; t < 2.3; t += dt) {
      u.pos.copy(jet.pos).addScaledVector(f, 600);
      jet.pos.y = 200;
      g.vehicles.update(dt);
    }
    const locked = jet.lock.locked;
    // The UFO starts flying across at 90 blocks/s; a click fires.
    const side = new T.Vector3(1, 0, 0).applyQuaternion(jet.aimQ);
    g.vehicles.mouseDown(2);
    g.vehicles.update(dt);
    g.vehicles.mouseUp(2);
    g.vehicles.update(dt);
    const m = jet.missiles[0];
    const guided = !!m?.target;
    const follow = !!jet.lock.follow;
    let hit = false;
    let t = 0;
    const hp0 = u.health;
    let dirTurn = 0;
    const d0 = m ? m.dir.clone() : null;
    while (t < 10 && !hit) {
      u.vel.copy(side).multiplyScalar(90);
      u.pos.addScaledVector(u.vel, dt);
      g.vehicles.update(dt);
      t += dt;
      if (m && d0) dirTurn = Math.max(dirTurn, m.dir.angleTo(d0));
      if (u.health < hp0 || u.falling) hit = true;
    }
    return { locked, guided, follow, hit, t: +t.toFixed(2), dirTurn: +dirTurn.toFixed(3), still: jet.lock.locked, spoken: [...window.__spoken], blast: g.effects.lastExplosion?.radius };
  });
  assert(r.locked && r.guided, `a guided missile at the lock: ${JSON.stringify(r)}`);
  assert(!r.follow, `a click on the auto lock keeps the view with the pilot: ${JSON.stringify(r)}`);
  assert(r.hit && r.dirTurn > 0.05, `it turned after the crossing UFO and hit it: ${JSON.stringify(r)}`);
  assert(Math.abs(r.blast - 6.5) < 0.01, `the missile's blast is the bigger one (6.5): ${JSON.stringify(r)}`);
  await until(() => window.__spoken.length > 0, null, 5000);
  const spoken = await v(() => window.__spoken);
  assert(spoken.some((s) => /fox two/i.test(s)), `Fox two was called: ${JSON.stringify(spoken)}`);
});

await check("without a lock a missile flies straight ahead", async () => {
  await sky();
  const r = await v((g) => {
    const jet = window.__j;
    const T = g.THREE;
    // A UFO well off to the side (out of the seeker).
    const side = new T.Vector3(1, 0, 0).applyQuaternion(jet.aimQ);
    g.ufos.spawn({ design: "saucer", size: "medium", pos: jet.pos.clone().addScaledVector(side, 400) });
    const dt = 1 / 30;
    for (let i = 0; i < 70; i++) g.vehicles.update(dt);
    const lockedBefore = jet.lock.locked || !!jet.lock.target;
    g.vehicles.mouseDown(2);
    g.vehicles.update(dt);
    g.vehicles.mouseUp(2);
    g.vehicles.update(dt);
    const m = jet.missiles[0];
    const d0 = m.dir.clone();
    for (let i = 0; i < 30; i++) g.vehicles.update(dt);
    return { lockedBefore, guided: !!m.target, turn: m.dir.angleTo(d0) };
  });
  assert(!r.lockedBefore && !r.guided && r.turn < 0.002, `straight and unguided: ${JSON.stringify(r)}`);
});

await check("sonic boom: a fighter on its afterburner breaks Mach 1 (one boom, a vapor cone); one just under Mach 1 makes none; slowing back through it booms softly", async () => {
  await sky({ speed: 330, throttle: 1 });
  const under = await v((g) => {
    const jet = window.__j;
    const booms = [];
    g.vehicles.update(1 / 30); // (the air effects come with the first frame)
    g.vehicles.airFx.onBoom = (o, up) => booms.push(up);
    const dt = 1 / 30;
    let maxSp = 0;
    // No afterburner: it settles at ~950 km/h, under the barrier.
    for (let t = 0; t < 4; t += dt) {
      jet.pos.y = 200;
      g.vehicles.update(dt);
      maxSp = Math.max(maxSp, jet.speed);
    }
    return { booms: booms.length, maxSp };
  });
  assert(under.booms === 0 && under.maxSp < 343, `no boom under Mach 1: ${JSON.stringify(under)}`);
  const r = await v((g) => {
    const jet = window.__j;
    const fx = g.vehicles.airFx;
    const booms = [];
    fx.onBoom = (o, up) => booms.push({ up, sp: Math.round(o.speed) });
    const dt = 1 / 30;
    g.player.keys.add("ShiftLeft");
    let crossT = -1;
    let t = 0;
    let cone = false;
    while (t < 25 && !booms.length) {
      jet.pos.y = 200;
      g.vehicles.update(dt);
      t += dt;
      if (jet.speed > 343 && crossT < 0) crossT = t;
    }
    cone = fx.cones.some((c) => c.mesh.visible && c.o === jet);
    const mach = jet.speed / 343;
    // Hold it there a while: still one boom.
    for (let i = 0; i < 40; i++) {
      jet.pos.y = 200;
      g.vehicles.update(dt);
    }
    const holdBooms = booms.length;
    window.__coneJet = jet;
    return { booms: booms.slice(), holdBooms, crossT: +crossT.toFixed(2), cone, mach: +mach.toFixed(3) };
  });
  assert(r.booms.length === 1 && r.booms[0].up && r.booms[0].sp >= 343, `one boom crossing Mach 1: ${JSON.stringify(r)}`);
  assert(r.cone, `a vapor cone round the jet: ${JSON.stringify(r)}`);
  assert(r.holdBooms === 1, `no more booms past it: ${JSON.stringify(r)}`);
  // A picture of the cone: boom again (a fresh flash) and let real frames draw it.
  await v((g) => {
    const j = window.__coneJet;
    j._sb.cool = 0;
    g.vehicles.airFx.lastBoom = -99;
    g.vehicles.airFx.boom(j, true);
    j._sb.cool = 0;
  });
  await frames(2);
  await shot("vapor-cone");
  // (From the side: a free look.)
  await v((g) => {
    const j = window.__coneJet;
    j._sb.cool = 0;
    g.vehicles.airFx.lastBoom = -99;
    j.freeLook = true;
    j.lookYaw = 1.35;
    j.lookPitch = -0.15;
    g.vehicles.airFx.boom(j, true);
    j._sb.cool = 0;
  });
  await frames(2);
  if (process.env.DBG) console.log(JSON.stringify(await v((g) => {
    const j = window.__coneJet;
    const out = [];
    g.scene.traverse((o) => {
      if (!o.isMesh || !o.visible || !o.material?.transparent) return;
      const p = new g.THREE.Vector3();
      o.getWorldPosition(p);
      if (p.distanceTo(j.pos) < 60) out.push([o.geometry.type, o.material.type, o.scale.toArray().map((x) => +x.toFixed(1)), +p.distanceTo(j.pos).toFixed(1), o.material.opacity ?? o.material.uniforms?.opacity?.value]);
    });
    return out;
  })));
  await shot("vapor-cone-side");
  if (process.env.DBG) {
    await v((g) => g.vehicles.airFx.cones.forEach((c) => (c.mesh.material.visible = false)));
    await frames(1);
    await shot("dbg-no-cone");
    await v((g) => g.vehicles.airFx.cones.forEach((c) => (c.mesh.material.visible = true)));
  }
  await v(() => {
    window.__coneJet.freeLook = false;
  });
  const down = await v((g) => {
    const jet = window.__j;
    const booms = [];
    g.vehicles.airFx.onBoom = (o, up) => booms.push(up);
    g.vehicles.airFx.lastBoom = -99;
    jet._sb.cool = 0;
    g.player.keys.delete("ShiftLeft");
    g.player.keys.add("Space");
    const dt = 1 / 30;
    for (let t = 0; t < 6 && !booms.length; t += dt) {
      jet.pos.y = 200;
      g.vehicles.update(dt);
    }
    g.player.keys.delete("Space");
    g.vehicles.airFx.onBoom = null;
    return { booms, sp: Math.round(jet.speed) };
  });
  assert(down.booms.length === 1 && down.booms[0] === false, `a soft boom slowing through it: ${JSON.stringify(down)}`);
});

await check("a missile's blast in the air: the extras (shock rings) and a picture", async () => {
  await sky();
  const r = await v((g) => {
    const jet = window.__j;
    const T = g.THREE;
    const f = jet.forward(new T.Vector3());
    const at = jet.pos.clone().addScaledVector(f, 70).add(new T.Vector3(0, 6, 0));
    g.effects.explode(at, { radius: 6.5, source: "missile" });
    const rings = g.vehicles.airFx.rings.filter((r) => r.mesh.visible).length;
    window.__dbgB = { d: at.distanceTo(g.effects.listener), l: g.effects.listener.toArray(), last: g.effects.lastExplosion?.source };
    jet.throttle = 0;
    return { rings };
  });
  assert(r.rings >= 2, `the shock sphere's rings: ${JSON.stringify(r)} ${JSON.stringify(await v(() => window.__dbgB))}`);
  await frames(1);
  await shot("missile-blast");
});

await check("callouts: a UFO kill ('UFO destroyed'-like), a Ball UFO ('Ball UFO'), an enemy fighter ('Splash one')", async () => {
  await sky();
  const said = async (fn) => {
    await v(() => (window.__spoken.length = 0));
    await v(fn);
    return until(() => window.__spoken.length > 0 && [...window.__spoken], null, 8000);
  };
  const a = await said((g) => {
    const u = g.ufos.spawn({ design: "saucer", size: "small", pos: window.__j.pos.clone().add(new g.THREE.Vector3(0, 0, -300)) });
    g.ufos.damage(u, 99999, true);
  });
  assert(a && a.some((s) => /UFO|object|bogey/i.test(s) && !/ball/i.test(s)), `a UFO kill: ${JSON.stringify(a)}`);
  const b = await said((g) => {
    const u = g.ufos.spawn({ design: "sphere", size: "small", pos: window.__j.pos.clone().add(new g.THREE.Vector3(60, 0, -300)) });
    g.ufos.damage(u, 99999, true);
  });
  assert(b && b.some((s) => /ball ufo/i.test(s)), `a Ball UFO kill: ${JSON.stringify(b)}`);
  const c = await said((g) => {
    const p = window.__j.pos;
    const e = g.vehicles.create("enemyjet", { pos: [p.x + 200, p.y + 40, p.z - 400], yaw: 0, airborne: true, speed: 110 });
    e.damage(9999, "missile", true);
  });
  assert(c && c.some((s) => /splash one/i.test(s)), `an enemy fighter: ${JSON.stringify(c)}`);
});

await v((g) => {
  if (g.vehicles.active) g.vehicles.exit({ force: true });
});
const passed = results.filter((r) => r[1]).length;
console.log(`\n${passed}/${results.length} passed${errors.length ? `; console errors: ${errors.slice(0, 5).join(" | ")}` : ""}`);
await browser.close();
server.close();
process.exit(passed === results.length ? 0 : 1);
