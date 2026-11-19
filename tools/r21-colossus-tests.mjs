// Round 21, track B: the colossi (js/colossi.js, js/colossus-models.js,
// js/colossus-audio.js, js/mission-colossi.js, js/net/colossi.js) and the
// missions starting one after another at once (js/mission-board.js).
// Node: the board's numbers (no break longer than 3 s; the new missions on
// the board, in a new category, early in the order and each after what opens
// it); stop / resume.
// In the browser (Creative for the creatures, a Missions world for the
// missions):
// - each colossus spawns, animates (walks: its root moves, its feet step),
//   and its planted feet touch the ground;
// - the weak points take damage from the jet's weapons (the cannon's bolts,
//   the nose laser, a locked missile); the armour rules hold (the cannon
//   does nothing to a plate, a super missile cracks one; a mini-nuke hurts a
//   lot but never kills one outright); the Strider falls after three knees
//   and dies with its sac; the Watcher is blinded; the Hive Mother dies;
// - its attacks hurt a jet (the swat, the beam, the acid, the screech's
//   stall); the swarm chases a jet and flares lure it;
// - the new missions start and complete through the hooks (the jet called
//   in, the boss bar, the markers, Long Legs failing at the town);
// - immediate chaining: the next mission within ~3 s, the stop control (the
//   board, Shift+M, the setting), the resume;
// - frame time with two colossi and a swarm; no console errors;
// - online (--solo skips): the guest sees the host's colossus walking and its
//   health dropping; the guest's hit goes to the host.
//
//   node r21-colossus-tests.mjs [--only=substring] [--seed=42] [--solo] [--verbose]
// (GAME_ROOT=dir runs another copy of the game; SHOTS=dir saves screenshots.)
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

// (The catalog and the board import three.js-free modules only; the
// progression's items need nothing of the browser.)
const imp = (f) => import(pathToFileURL(path.join(ROOT, f)).href);
let C = null;
let B = null;
try {
  C = await imp("js/mission-catalog.js");
  B = await imp("js/mission-board.js");
} catch (err) {
  console.log(`  (the Node checks can't load the board here: ${err.message})`);
}

if (C && B) {
  await check("the board: no break over 3 s; the colossus missions on it (a seventh category), early in the order, each after what opens it", async () => {
    const { AUTO_BREAK } = B;
    for (const [k, v] of Object.entries(AUTO_BREAK)) assert(v <= 3, `break ${k}: ${v} s`);
    const ids = ["long_legs", "watcher", "nest", "colossi"];
    for (const id of ids) assert(C.BOARD_BY_ID.get(id)?.cat === "colossus" && C.BOARD_BY_ID.get(id).vehicle === "jet", `${id} on the board`);
    assert(C.CATEGORIES.some((c) => c.id === "colossus"), "the Colossi category");
    const order = C.AUTO_ORDER;
    assert(order.indexOf("long_legs") < 12, `Long Legs early: #${order.indexOf("long_legs") + 1}`);
    assert(order.indexOf("watcher") < 20 && order.indexOf("nest") < 25, `the Veteran ones early in their tier: ${order.indexOf("watcher") + 1}, ${order.indexOf("nest") + 1}`);
    assert(order.length === C.BOARD.length && new Set(order).size === order.length, "every mission once");
    const won = new Set();
    for (const id of order) {
      assert(!C.lockReason(C.BOARD_BY_ID.get(id), won), `${id} is locked when its turn comes: ${C.lockReason(C.BOARD_BY_ID.get(id), won)}`);
      won.add(id);
    }
  });

  await check("the flow: a win chains the next at once; a failure retries at once; stop ends the running one (no failure) and nothing starts; resume brings it back first", async () => {
    const b = new B.MissionBoard();
    b.load(null, {});
    const st = {};
    const tick = (n = 20, dt = 0.5) => {
      for (let i = 0; i < n; i++) if (b.tickAuto(dt, st)) return true;
      return false;
    };
    assert(tick(7) && b.mission?.id === "skeleton", `the first one within 3 s: ${b.mission?.id}`);
    st.skeletonsKilled = 1;
    b.update(st);
    assert(!b.mission && b.result?.ok && b.next?.id === "supply" && b.next.left <= 3, `the next queued: ${JSON.stringify(b.next)}`);
    assert(tick(7) && b.mission?.id === "supply", "the next within 3 s");
    b.fail("Out of time.");
    assert(b.next?.retry && b.next.left <= 3 && /Trying again now/.test(b.failNote()), `a retry at once: ${JSON.stringify(b.next)} ${b.failNote()}`);
    assert(tick(7) && b.mission?.id === "supply", "retried");
    b.setAuto(false);
    assert(!b.mission && !b.auto && b.result?.reason === "Stopped." && b.fails === 1 && !b.skipped.has("supply"), `stopped: ${JSON.stringify(b.result)} fails ${b.fails}`);
    assert(!tick(40), "nothing starts while stopped");
    b.setAuto(true);
    assert(tick(4) && b.mission?.id === "supply", `resumed: the stopped one first: ${b.mission?.id}`);
    assert(b.toggleChain() === false && !b.mission, "the toggle stops");
    assert(b.toggleChain() === true && b.next?.id === "supply", "and resumes");
  });
}

// ---------- Browser ----------

const { chromium } = await import("playwright-core");
const PORT = 11520 + Math.floor(Math.random() * 10);
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
const shot = async (p, name) => {
  if (!SHOTS) return;
  fs.mkdirSync(SHOTS, { recursive: true });
  await p.screenshot({ path: path.join(SHOTS, `${name}.png`) });
};

const page = await newPage("solo");
const frames = (n) => framesOn(page, n);
const v = (fn, arg) => vOn(page, fn, arg);
const until = (fn, arg, ms) => untilOn(page, fn, arg, ms);
const play = () => playOn(page);

// In-page helpers (window.__r21): stepping the world by hand, a jet held still, aiming.
const HELPERS = `(() => {
  const g = window.__ufo;
  const T = g.THREE;
  const H = {};
  H.step = (dt = 1 / 30) => {
    g.vehicles.update(dt);
    g.ufos.update(dt);
    g.colossi.update(dt);
    g.lasers.update(dt);
    g.nuke.update(dt, g.vehicles.active ? g.vehicles.active.pos : g.player.getEyePosition(), 1);
    g.effects.update(dt);
  };
  H.run = (secs, dt = 1 / 30, each = null) => {
    for (let t = 0; t < secs; t += dt) {
      H.step(dt);
      if (each && each(t)) return true;
    }
    return false;
  };
  H.hold = (j, at) => {
    j.pos.copy(at.pos);
    j.q.copy(at.q);
    j.vel.copy(at.vel);
  };
  H.snap = (j) => ({ pos: j.pos.clone(), q: j.q.clone(), vel: j.vel.clone() });
  // A jet at p, its nose at target t (a Vector3), still in the air.
  H.aimJet = (j, p, t) => {
    j.pos.copy(p);
    const m = new T.Matrix4().lookAt(p, t, new T.Vector3(0, 1, 0));
    j.q.setFromRotationMatrix(m);
    j.vel.copy(t).sub(p).normalize().multiplyScalar(1);
    j._levelAim?.();
  };
  H.ground = (x, z) => g.colossi.groundAt(x, z);
  H.msgs = [];
  if (!H._hooked) {
    const say = g.vehicles.onMessage;
    g.vehicles.onMessage = (t) => {
      H.msgs.push(t);
      say?.(t);
    };
    const local = g.colossi.onLocalMessage;
    g.colossi.onLocalMessage = (t, s) => {
      H.msgs.push(t);
      local?.(t, s);
    };
    H._hooked = true;
  }
  // A colossus of a kind, \`dist\` blocks north of the player, standing still unless given a goal.
  H.spawn = (kind, dist = 260, o = {}) => {
    const p = g.player.position;
    const c = g.colossi.spawn(kind, { x: p.x + (o.dx ?? 0), z: p.z - dist, yaw: o.yaw ?? 0, ...o });
    return c;
  };
  window.__r21 = H;
  return true;
})()`;

// A clear sky: Creative, no missions, UFOs, creatures or patrols; a jet in the
// air at height y (window.__j); no colossi.
const sky = async (opts = {}) => {
  await play();
  await v((g, o) => {
    g.testFlags.noMissions = true;
    if (g.player.dead) g.respawn();
    if (g.vehicles.active) g.vehicles.exit({ force: true });
    g.setMode("creative");
    g.ufos.clear();
    g.mobs.clear();
    g.colossi.clear();
    g.settingsPanel?.set?.("ufos.activity", 0);
    g.ufos.prankRate = 0;
    g.enemyJets.config.count = 0;
    for (const j of [...g.vehicles.vehicles]) g.vehicles.remove(j);
    const ground = g.world.heightAt(Math.floor(g.player.position.x), Math.floor(g.player.position.z));
    const p = [g.player.position.x, o.y ?? ground + 220, g.player.position.z];
    const jet = g.vehicles.create("jet", { jetType: o.type || "f22", pos: p, yaw: 0, airborne: true, speed: 150, throttle: 0.7 });
    g.vehicles.enter(jet);
    g.player.keys.clear();
    g.vehicles.input.buttons.fill(false);
    g.vehicles.input.pressed.clear();
    window.__j = jet;
    // (Creative: the colossi's attacks still hurt the jet; the player is safe in it.)
    jet.health = jet.maxHealth;
    window.__r21.msgs.length = 0;
    return true;
  }, opts);
  await frames(2);
};

await browserCheck("boot: a world, playing", async () => {
  await page.goto(`http://127.0.0.1:${PORT}/index.html?seed=${SEED}&graphics=low&board&auto=0`, { waitUntil: "load", timeout: 60000 });
  await page.waitForFunction(() => !!window.__ufo && window.__ufo.graphicsReady, null, { timeout: 120000 });
  await play();
  await page.evaluate(HELPERS);
});

await browserCheck("each colossus spawns, walks (its root moves, its feet step) and its planted feet touch the ground", async () => {
  await sky();
  const r = await v((g) => {
    const H = window.__r21;
    const out = {};
    for (const kind of ["strider", "weeper", "hive"]) {
      g.colossi.clear();
      const p = g.player.position;
      const c = H.spawn(kind, 300, { goal: { x: p.x + 600, z: p.z - 300 } });
      const r0 = c.root.clone();
      const steps0 = c.steps || 0;
      H.run(25, 1 / 20);
      const legs = c.legs.filter((l) => !l.arm);
      const planted = legs.filter((l) => l.swing < 0);
      const off = planted.map((l) => Math.abs(l.foot.y - H.ground(l.foot.x, l.foot.z)));
      // The tallest point of the model (its knees, its head) over the ground.
      let top = -Infinity;
      c.group.traverse((o) => {
        if (!o.isMesh) return;
        top = Math.max(top, o.position.y);
      });
      out[kind] = { moved: Math.round(c.root.distanceTo(r0)), steps: (c.steps || 0) - steps0, planted: planted.length, legs: legs.length, worstFoot: Math.round(Math.max(...off) * 100) / 100, height: Math.round(top - c.root.y), meshes: c.group.children.length, weak: c.weak.length, plates: c.plates.length };
    }
    g.colossi.clear();
    return out;
  });
  console.log(`    ${JSON.stringify(r)}`);
  for (const [k, x] of Object.entries(r)) {
    assert(x.moved > 30, `${k} walked: ${x.moved}`);
    assert(x.steps >= 4, `${k} stepped: ${x.steps}`);
    assert(x.planted >= 2 && x.worstFoot < 1.6, `${k}'s planted feet on the ground: ${JSON.stringify(x)}`);
    assert(x.height >= 80, `${k} is huge: ${x.height}`);
  }
  assert(r.strider.height >= 150 && r.weeper.height >= 150, "the Strider and the Watcher tower");
});

// A still colossus of `kind` (no walking, no attacks) north of the jet; returns its id.
const still = (kind, dist = 300) =>
  v((g, o) => {
    const H = window.__r21;
    g.colossi.clear();
    const c = H.spawn(o.kind, o.dist);
    c.speedMul = 0;
    c.turnRate = 0;
    for (const k of Object.keys(c.cool)) c.cool[k] = 1e9;
    H.run(3, 1 / 20);
    window.__c = c;
    return c.id;
  }, { kind, dist });

await browserCheck("the jet's weapons hurt the weak points: the cannon, the nose laser, a locked missile (the lock picks a weak point)", async () => {
  await sky();
  await still("strider", 320);
  const r = await v((g) => {
    const H = window.__r21;
    const T = g.THREE;
    const c = window.__c;
    const j = window.__j;
    const knee = c.weak.find((p) => p.kind === "knee");
    const out = {};
    // The cannon: 2 s held at a knee from 160 blocks.
    const from = knee.pos.clone().add(new T.Vector3(0, 10, 160));
    H.aimJet(j, from, knee.pos);
    const at = H.snap(j);
    let hp = knee.hp;
    g.vehicles.mouseDown(0);
    H.run(2, 1 / 30, () => {
      H.hold(j, at);
      j.heat = 0;
      j.jammed = false;
    });
    g.vehicles.mouseUp(0);
    H.run(0.5, 1 / 30, () => H.hold(j, at));
    out.cannon = Math.round(hp - knee.hp);
    // The nose laser: 3 s held (its bursts).
    H.aimJet(j, knee.pos.clone().add(new T.Vector3(0, 10, 160)), knee.pos);
    const atL = H.snap(j);
    hp = knee.hp;
    j.selectWeapon("laser");
    g.vehicles.mouseDown(2);
    H.run(3, 1 / 30, () => H.hold(j, atL));
    g.vehicles.mouseUp(2);
    H.run(0.5, 1 / 30, () => H.hold(j, atL));
    out.laser = Math.round(hp - knee.hp);
    out.laserInfo = { bursts: j.laserBursts, hit: j.laserShot?.hitKind, assisted: j.laserShot?.assisted, target: j.laserShot?.target?.kind, core: Math.round(c.hp) };
    // The missile lock: held on the knee, it locks onto a colossus part.
    j.selectWeapon("missile");
    const knee2 = c.weak.filter((p) => p.kind === "knee")[1];
    H.aimJet(j, knee2.pos.clone().add(new T.Vector3(0, 30, 300)), knee2.pos);
    const at2 = H.snap(j);
    g.vehicles.mouseDown(2);
    let locked = null;
    H.run(2.5, 1 / 30, () => {
      H.hold(j, at2);
      if (j.lock.locked && j.lock.target?.ref?.col) locked = j.lock.target.ref;
      return false;
    });
    out.lockedOn = locked ? `${locked.kind}` : `${j.lock.target?.ref?.kind || "none"}`;
    hp = (locked || knee2).hp;
    const tgt = locked || knee2;
    g.vehicles.mouseUp(2);
    H.run(5, 1 / 30, () => H.hold(j, at2));
    out.missile = Math.round(hp - tgt.hp);
    if (!(out.missile > 0)) {
      // (Straight from the launcher, locked on it.)
      hp = knee2.hp;
      j._launchMissile({ kind: "ufo", ref: knee2 });
      H.run(5, 1 / 30, () => H.hold(j, at2));
      out.missile = Math.round(hp - knee2.hp);
      out.direct = true;
    }
    out.core = Math.round((c.hp / c.maxHp) * 1000) / 10;
    return out;
  });
  console.log(`    ${JSON.stringify(r)}`);
  assert(r.cannon >= 40, `the cannon hurts a knee: ${r.cannon}`);
  assert(r.laser >= 55, `the laser hurts a knee: ${r.laser}`);
  assert(r.lockedOn !== "none", `the lock picks a colossus part: ${r.lockedOn}`);
  assert(r.missile >= 150, `a missile hurts it: ${r.missile}`);
  assert(r.core < 100, "the health bar goes down");
});

await browserCheck("armour: the cannon and laser do nothing to a plate or the hide; a super missile cracks a plate; a mini-nuke hurts a lot but never kills one", async () => {
  await sky();
  await still("strider", 320);
  const r = await v((g) => {
    const H = window.__r21;
    const T = g.THREE;
    const c = window.__c;
    const j = window.__j;
    const sac = c.weak.find((p) => p.kind === "sac");
    const plate = c.plates[0];
    const out = {};
    // Cannon bolts straight at a plate.
    const core0 = c.hp;
    const sac0 = sac.hp;
    for (let i = 0; i < 40; i++) {
      const from = plate.pos.clone().addScaledVector(plate.dir, 60);
      g.lasers.fire({ from, dir: plate.pos.clone().sub(from).normalize(), speed: 900, damage: 5, owner: "jet", source: j, range: 200, radius: 0.07 });
      H.step(1 / 30);
    }
    H.run(0.5);
    out.plateAfterCannon = plate.state;
    out.sacHurtThroughPlate = Math.round(sac0 - sac.hp);
    // Bolts at the body (the hide).
    for (let i = 0; i < 20; i++) {
      const from = c.bodyPos.clone().add(new T.Vector3(0, 0, 80));
      g.lasers.fire({ from, dir: c.bodyPos.clone().sub(from).normalize(), speed: 900, damage: 5, owner: "jet", source: j, range: 200, radius: 0.07 });
      H.step(1 / 30);
    }
    H.run(0.5);
    out.coreAfterSmallArms = Math.round(core0 - c.hp);
    // A super missile locked on the plate.
    // (From below and outside the plate: nothing of the hide in the way.)
    const from = plate.pos.clone().addScaledVector(plate.dir, 70).add(new T.Vector3(0, -55, 0));
    H.aimJet(j, from, plate.pos);
    const at = H.snap(j);
    const hits = [];
    const orig = c.hit.bind(c);
    c.hit = (p, amount, heavy, from) => {
      hits.push([p.kind, Math.round(amount), heavy]);
      return orig(p, amount, heavy, from);
    };
    j._launchMissile({ kind: "ufo", ref: plate }, { heavy: true });
    H.run(5, 1 / 30, () => H.hold(j, at));
    out.plateAfterSuper = plate.state;
    out.hits = hits.slice(0, 5);
    out.boom = j.missiles.length;
    out.platesLeft = c.plates.filter((q) => q.state !== "gone").length;
    // A mini-nuke going off by the body (a fresh one, full health).
    g.colossi.clear();
    const c2 = H.spawn("strider", 320);
    c2.speedMul = 0;
    for (const k of Object.keys(c2.cool)) c2.cool[k] = 1e9;
    H.run(0.5);
    const hp0 = c2.hp;
    g.nuke.detonate(c2.sacPos.clone(), { R: 22, mini: true });
    H.run(3);
    out.mini = { pct: Math.round(((hp0 - c2.hp) / hp0) * 1000) / 10, alive: c2.alive, plates: c2.plates.filter((q) => q.state !== "gone").length };
    return out;
  });
  console.log(`    ${JSON.stringify(r)}`);
  assert(r.plateAfterCannon === "alive", `the cannon doesn't crack a plate: ${r.plateAfterCannon}`);
  assert(r.sacHurtThroughPlate <= 10, `nor hurt the sac through it: ${r.sacHurtThroughPlate}`);
  assert(r.coreAfterSmallArms === 0, `the hide shrugs off small arms: ${r.coreAfterSmallArms}`);
  assert(r.plateAfterSuper === "gone" && r.platesLeft === 2, `a super missile cracks a plate: ${JSON.stringify(r)}`);
  assert(r.mini.alive && r.mini.pct >= 8 && r.mini.pct <= 35 && r.mini.plates < 3, `a mini-nuke hurts a lot (plates cracked) but doesn't kill: ${JSON.stringify(r.mini)}`);
});

await browserCheck("the Strider: three knees bring it down (a collapse, its shell split), the sac kills it; flying between its legs trips it", async () => {
  await sky();
  await still("strider", 320);
  const r = await v((g) => {
    const H = window.__r21;
    const c = window.__c;
    const st0 = { ...g.stats.world };
    const knees = c.weak.filter((p) => p.kind === "knee");
    const out = { phases: [] };
    // Between its legs: a jet under the body.
    const j = window.__j;
    c.cool.tangle = 0;
    j.pos.set(c.bodyPos.x, c.root.y + 60, c.bodyPos.z);
    H.run(0.3, 1 / 30, () => j.pos.set(c.bodyPos.x, c.root.y + 60, c.bodyPos.z));
    out.tangle = { phase: c.phase, vuln: c.vulnT > 0 };
    j.pos.set(c.bodyPos.x, c.root.y + 400, c.bodyPos.z + 400);
    c.cool.tangle = 1e9;
    // A knee in the stumble takes double.
    const hp = knees[3].hp;
    g.ufos.damage(knees[3], 100, true, knees[3].pos.clone());
    out.stumbleHit = Math.round(hp - knees[3].hp);
    for (let i = 0; i < 3; i++) {
      g.ufos.damage(knees[i], 5000, true, knees[i].pos.clone());
      H.run(0.2);
      out.phases.push(c.phase);
    }
    H.run(4, 1 / 20);
    out.down = c.phase;
    out.bodyAboveGround = Math.round(c.bodyPos.y - c.root.y);
    out.sacPlates = c.plates.filter((q) => q.state !== "gone").length;
    const sac = c.weak.find((p) => p.kind === "sac");
    g.ufos.damage(sac, 4000, true, sac.pos.clone());
    H.run(8, 1 / 20);
    out.end = c.phase;
    out.stats = { striderDown: (g.stats.world.striderDown || 0) - (st0.striderDown || 0), colossiDown: (g.stats.world.colossiDown || 0) - (st0.colossiDown || 0) };
    return out;
  });
  console.log(`    ${JSON.stringify(r)}`);
  assert(r.tangle.phase === "stagger" && r.tangle.vuln, `flying between its legs trips it: ${JSON.stringify(r.tangle)}`);
  assert(r.stumbleHit === 200, `x2 in the stumble: ${r.stumbleHit}`);
  assert(r.phases[0] !== "falling" && r.phases[2] === "falling", `the third knee fells it: ${r.phases}`);
  assert(r.down === "fallen" && r.bodyAboveGround < 20, `down on the ground: ${r.down} ${r.bodyAboveGround}`);
  assert(r.sacPlates === 0, "its shell split: the sac open");
  assert(r.end === "dead" || r.end === "dying", `the sac kills it: ${r.end}`);
  assert(r.stats.striderDown === 1 && r.stats.colossiDown === 1, `stats: ${JSON.stringify(r.stats)}`);
});

await browserCheck("the Watcher: eyes x3 while it charges (a backfire), a swat lured into the ground sticks (wrist x3), blinded it dies; the Hive Mother: a sac about to open x3, the heart under plates", async () => {
  await sky();
  await still("weeper", 300);
  const r = await v((g) => {
    const H = window.__r21;
    const c = window.__c;
    const A = { CHARGE: 2, SWAT: 1 };
    const out = {};
    const eyes = c.weak.filter((p) => p.kind === "eye");
    let hp = eyes[0].hp;
    g.ufos.damage(eyes[0], 50, true, eyes[0].pos.clone());
    out.eyeNormal = Math.round(hp - eyes[0].hp);
    c.startAttack(A.CHARGE, 2.6, 0, c.headPos.clone().add(new g.THREE.Vector3(0, 0, 200)), null);
    H.step(1 / 30);
    hp = eyes[1].hp;
    g.ufos.damage(eyes[1], 50, true, eyes[1].pos.clone());
    out.eyeCharging = Math.round(hp - eyes[1].hp);
    g.ufos.damage(eyes[1], 5000, true, eyes[1].pos.clone());
    out.backfire = { phase: c.phase, atk: c.atk.code };
    c.setPhase("walk");
    c.vulnT = 0;
    // A swat aimed at a point low over the ground: the hand sticks.
    const arm = c.arms[0];
    const aim = c.at(new g.THREE.Vector3(), c.root, -40, 0, 70);
    aim.y = H.ground(aim.x, aim.z) + 5;
    c.startAttack(A.SWAT, 1.9, 0, aim, null);
    H.run(2, 1 / 30);
    out.stuck = Math.round(arm.stuckT * 10) / 10;
    hp = arm.part.hp;
    g.ufos.damage(arm.part, 50, true, arm.part.pos.clone());
    out.wristStuck = Math.round(hp - arm.part.hp);
    for (const e of eyes) if (e.state !== "gone") g.ufos.damage(e, 5000, true, e.pos.clone());
    out.blind = c.phase;
    H.run(9, 1 / 20);
    out.end = c.phase;
    // The Hive Mother.
    g.colossi.clear();
    const h = H.spawn("hive", 300);
    h.speedMul = 0;
    for (const k of Object.keys(h.cool)) h.cool[k] = 1e9;
    H.run(0.5);
    const egg = h.weak.find((p) => p.kind === "egg");
    hp = egg.hp;
    g.ufos.damage(egg, 50, true, egg.pos.clone());
    out.egg = Math.round(hp - egg.hp);
    egg.openT = 1.2;
    hp = egg.hp;
    g.ufos.damage(egg, 50, true, egg.pos.clone());
    out.eggOpening = Math.round(hp - egg.hp);
    const heart = h.weak.find((p) => p.kind === "heart");
    hp = heart.hp;
    g.ufos.damage(heart, 300, true, heart.pos.clone());
    out.heartArmored = Math.round(hp - heart.hp);
    for (const q of heart.plates) g.ufos.damage(q, 900, true, q.pos.clone());
    hp = heart.hp;
    g.ufos.damage(heart, 300, true, heart.pos.clone());
    out.heartOpen = Math.round(hp - heart.hp);
    g.ufos.damage(heart, 5000, true, heart.pos.clone());
    H.run(1);
    out.hive = h.phase;
    return out;
  });
  console.log(`    ${JSON.stringify(r)}`);
  assert(r.eyeNormal === 20 && r.eyeCharging === 150, `eyes tough, x3 charging: ${r.eyeNormal} / ${r.eyeCharging}`);
  assert(r.backfire.phase === "stagger" && r.backfire.atk === 0, `an eye out mid-charge backfires: ${JSON.stringify(r.backfire)}`);
  assert(r.stuck > 2 && r.wristStuck === 150, `the swat into the ground sticks, the wrist x3: ${r.stuck} ${r.wristStuck}`);
  assert(r.blind === "blind" && (r.end === "dying" || r.end === "dead"), `blinded, then it dies: ${r.blind} ${r.end}`);
  assert(r.egg === 50 && r.eggOpening === 150, `an opening sac x3: ${r.egg} ${r.eggOpening}`);
  assert(r.heartArmored <= 30 && r.heartOpen === 300, `the heart under its plates: ${r.heartArmored} / ${r.heartOpen}`);
  assert(r.hive === "dying" || r.hive === "dead", `the heart kills it: ${r.hive}`);
});

await browserCheck("its attacks hurt a jet: the swat, the eye beam, the acid, the tendrils, the screech stalls the engines; a stomp hurts a player on foot", async () => {
  await sky();
  await still("weeper", 300);
  const r = await v((g) => {
    const H = window.__r21;
    const T = g.THREE;
    const c = window.__c;
    const j = window.__j;
    const out = {};
    const hold = (p) => {
      j.pos.copy(p);
      j.vel.set(0, 0, 0);
      j.health = Math.max(j.health, 60);
    };
    // The swat: the jet by its shoulder, in reach, where the hand will pass.
    const sh = c.at(new T.Vector3(), c.spinePts[6], -17, -4, 0);
    const p1 = sh.clone().addScaledVector(c.fwd, 60).addScaledVector(c.right, -50);
    hold(p1);
    let h0 = j.health;
    c.cool.swat = 0;
    H.run(2.4, 1 / 30, () => {
      hold(p1);
      return c.atk.hit;
    });
    c.cool.swat = 1e9;
    out.swat = Math.round(h0 - j.health);
    c.endAttack();
    // The beam: charged at the jet hanging in front of the head.
    j.health = j.maxHealth;
    const p2 = c.headPos.clone().addScaledVector(c.fwd, 300).add(new T.Vector3(0, 20, 0));
    hold(p2);
    h0 = j.health;
    c.cool.beam = 0;
    H.run(6, 1 / 30, () => hold(p2));
    c.cool.beam = 1e9;
    out.beam = Math.round(h0 - j.health);
    c.endAttack();
    // The screech: the engines stall.
    j.health = j.maxHealth;
    const p3 = c.headPos.clone().addScaledVector(c.fwd, 200).add(new T.Vector3(0, 60, 0));
    hold(p3);
    j.throttle = 1;
    c.cool.roar = 0;
    let stalled = false;
    H.run(1, 1 / 30, () => {
      hold(p3);
      j.throttle = Math.max(j.throttle, 0.9);
      H.step(0);
      if (g.colossi.stallT > 0 && j.throttle === 0) stalled = true;
    });
    out.stall = { stalled, t: Math.round(g.colossi.stallT * 10) / 10 };
    c.cool.roar = 1e9;
    g.colossi.stallT = 0;
    // The Strider's acid and tendrils.
    g.colossi.clear();
    const s = H.spawn("strider", 320);
    s.speedMul = 0;
    for (const k of Object.keys(s.cool)) s.cool[k] = 1e9;
    H.run(0.5);
    j.health = j.maxHealth;
    const p4 = s.sacPos.clone().add(new T.Vector3(0, -20, 250));
    hold(p4);
    h0 = j.health;
    s.cool.glob = 0;
    H.run(4, 1 / 30, () => {
      hold(p4);
      s.cool.glob = Math.min(s.cool.glob, 0.3);
    });
    s.cool.glob = 1e9;
    out.acid = Math.round(h0 - j.health);
    j.health = j.maxHealth;
    const p5 = s.bodyPos.clone().add(new T.Vector3(30, -40, 30));
    hold(p5);
    h0 = j.health;
    s.cool.lash = 0;
    H.run(2, 1 / 30, () => hold(p5));
    out.lash = Math.round(h0 - j.health);
    // A stomp: a player on foot by a foot as it lands.
    g.vehicles.exit({ force: true });
    for (const v of [...g.vehicles.vehicles]) g.vehicles.remove(v);
    g.setMode("survival");
    const pl = g.player;
    pl.health = 20;
    const leg = s.legs[0];
    pl.position.set(leg.foot.x + 3, H.ground(leg.foot.x, leg.foot.z), leg.foot.z);
    pl.hurtTime = 9;
    g.colossi.footfall(s, leg.foot, s.footSize, s.footShake);
    out.stomp = Math.round(20 - pl.health);
    pl.health = 20;
    g.setMode("creative");
    return out;
  });
  console.log(`    ${JSON.stringify(r)}`);
  assert(r.swat >= 40, `the swat: ${r.swat}`);
  assert(r.beam >= 30, `the beam: ${r.beam}`);
  assert(r.stall.stalled, `the screech stalls the engines: ${JSON.stringify(r.stall)}`);
  assert(r.acid >= 6, `the acid: ${r.acid}`);
  assert(r.lash >= 30, `the tendrils: ${r.lash}`);
  assert(r.stomp >= 3, `a stomp on foot: ${r.stomp}`);
});

await browserCheck("the swarm chases a jet, flares lure most of it, the cannon picks parasites off", async () => {
  await sky();
  await still("hive", 400);
  const r = await v((g) => {
    const H = window.__r21;
    const T = g.THREE;
    const c = window.__c;
    const j = window.__j;
    const C = g.colossi;
    const out = {};
    const egg = c.eggs[0];
    C.launchSwarm(c, egg.pos, 12);
    // The jet 350 blocks off, flying away slowly.
    const p = c.bodyPos.clone().add(new T.Vector3(0, 80, 350));
    j.pos.copy(p);
    const d0 = C.swarm.reduce((s, x) => s + x.pos.distanceTo(j.pos), 0) / C.swarm.length;
    H.run(2, 1 / 30, () => {
      j.pos.copy(p);
      j.vel.set(0, 0, 0);
      j.health = j.maxHealth;
    });
    out.closer = Math.round(d0 - C.swarm.reduce((s, x) => s + x.pos.distanceTo(j.pos), 0) / Math.max(1, C.swarm.length));
    out.chasing = C.swarm.filter((x) => x.target?.ref === j).length;
    // Flares.
    j.flareT = 0;
    j._launchFlares();
    let lured = 0;
    H.run(0.8, 1 / 30, () => {
      j.pos.copy(p);
      lured = Math.max(lured, C.swarm.filter((x) => x.decoy).length);
    });
    out.lured = lured;
    out.left = C.swarm.length;
    // The cannon's bolts at one.
    C.clear();
    const c2 = H.spawn("hive", 400);
    c2.speedMul = 0;
    for (const k of Object.keys(c2.cool)) c2.cool[k] = 1e9;
    C.launchSwarm(c2, c2.eggs[0].pos, 1);
    const par = C.swarm[0];
    par.life = 99;
    par.pos.y += 150; // (clear of the hive's body)
    const upd = C._updateSwarm;
    C._updateSwarm = () => {}; // (held still for the shot)
    const killed0 = g.stats.world.parasitesDown || 0;
    for (let i = 0; i < 10 && C.swarm.length; i++) {
      const from = par.pos.clone().add(new T.Vector3(0, 0, 40));
      g.lasers.fire({ from, dir: par.pos.clone().sub(from).normalize(), speed: 2000, damage: 5, owner: "jet", source: j, range: 100, radius: 0.07 });
      H.step(1 / 60);
    }
    C._updateSwarm = upd;
    out.shotDown = C.swarm.length === 0;
    out.stat = (g.stats.world.parasitesDown || 0) - killed0;
    return out;
  });
  console.log(`    ${JSON.stringify(r)}`);
  assert(r.closer > 100 && r.chasing >= 8, `they chase the jet: ${JSON.stringify(r)}`);
  assert(r.lured >= 6, `flares lure most: ${r.lured} of 12`);
  assert(r.shotDown && r.stat === 1, `the cannon shoots one down (counted): ${JSON.stringify(r)}`);
});

// ---------- The missions ----------

// A Missions world's mode (not Creative), the chain off, nothing running; the player can't die.
const missionsOn = () =>
  v((g) => {
    if (g.vehicles.active) g.vehicles.exit({ force: true });
    for (const j of [...g.vehicles.vehicles]) g.vehicles.remove(j);
    g.colossi.clear();
    g.testFlags.noMissions = false;
    g.setMode("survival");
    if (!window.__noDie) {
      window.__noDie = true;
      g.player.damage = () => false;
    }
    if (g.progress.mission) g.progress.setAuto(false);
    g.progress.auto = false;
    g.progress.next = null;
    return g.missions.enabled && g.progress.board && !g.progress.mission;
  });
// Starts board mission id now (the hook the board's Start uses).
const begin = (id, variant = 0) => v((g, o) => g.progress.begin(o.id, g.stats.world, { force: true, variant: o.variant }) || g.progress.mission?.id, { id, variant });
// Waits for the director to set it up: its colossi, the jet called in, the boss bar.
const setUp = (kinds) =>
  until(
    (g, k) => {
      const list = g.colossi.list.filter((c) => c.alive).map((c) => c.kind).sort();
      const jet = g.vehicles.active?.type === "jet" ? g.vehicles.active.jetType : null;
      const bar = !document.getElementById("boss-bar").classList.contains("hidden");
      return list.join() === k.slice().sort().join() && jet && g.missions.bossInfo && bar ? { list, jet, boss: g.missions.bossInfo, note: document.querySelector("#boss-bar .bb-note")?.textContent, target: g.missions.target?.label, marks: !!document.getElementById("colossus-marks") } : null;
    },
    kinds,
    60000
  );

await browserCheck("the missions: Long Legs, The Watcher, Nest and Colossi start through the board's hook (the jet called in, the boss bar, the markers) and complete", async () => {
  await play();
  assert(await missionsOn(), "a Missions world, the director on");
  for (const [id, kinds, extra] of [["long_legs", ["strider"]], ["watcher", ["weeper"]], ["nest", ["hive"], "parasites"], ["colossi", ["strider", "weeper"]]]) {
    await missionsOn();
    assert((await begin(id)) === id, `${id} started`);
    const s = await setUp(kinds);
    assert(s, `${id}: set up (${JSON.stringify(await v((g) => ({ list: g.colossi.list.map((c) => c.kind), act: g.vehicles.active?.type, boss: g.missions.bossInfo, m: g.progress.mission?.id })))})`);
    console.log(`    ${id}: ${s.list.join(" + ")}, an ${s.jet} called in, "${s.boss.name}" ${s.note}, marker "${s.target}"`);
    s.marks ||= !!(await until(() => document.getElementById("colossus-marks"), null, 10000));
    assert(s.jet === "f22" && /ARMOR|OPEN/.test(s.note) && s.marks, `${id}: the jet, the bar's note, the markers: ${JSON.stringify(s)}`);
    if (id === "long_legs") assert(await v((g) => !!g.missions.state.town && g.colossi.list[0].goal && g.missions.netObjects()?.z?.length), "Long Legs: the town ringed, the Strider walking to it");
    // Brought down (and the parasites for Nest): the mission is won.
    const done = await v(
      (g, o) => {
        if (o.extra) g.stats.add("parasitesDown", 20);
        for (const c of g.colossi.list) c.die();
        return true;
      },
      { extra }
    );
    const won = await until((g, k) => (g.progress.result?.id === k && g.progress.result.ok ? g.progress.result : null), id, 60000);
    assert(done && won, `${id} completed: ${JSON.stringify(await v((g) => ({ r: g.progress.result, obj: g.progress.objectives(g.stats.world) })))}`);
  }
});

await browserCheck("Long Legs fails when the Strider reaches the town", async () => {
  await missionsOn();
  await begin("long_legs");
  assert(await setUp(["strider"]), "set up");
  await v((g) => {
    const t = g.missions.state.town;
    const c = g.colossi.list[0];
    c.root.set(t.x + 30, c.root.y, t.z);
    return true;
  });
  const r = await until((g) => (g.progress.result && !g.progress.result.ok ? g.progress.result.reason : null), null, 30000);
  assert(/reached the/.test(r || ""), `failed at the town: ${r}`);
  await v((g) => g.progress.setAuto(false));
  // (The Strider still standing goes: it sinks away.)
  const gone = await until((g) => g.colossi.list.every((c) => c.phase === "leave") || !g.colossi.list.length, null, 20000);
  assert(gone, "the leftover Strider leaves");
});

await browserCheck("immediate chaining: the next mission starts within 3 s of a win; Shift+M stops (nothing starts, no failure), the board resumes the stopped one; the setting too", async () => {
  await missionsOn();
  await v((g) => {
    // (The game time the break takes: the director's ticks, summed.)
    const tick = g.progress.tickAuto.bind(g.progress);
    window.__brk = 0;
    g.progress.tickAuto = (dt, st) => {
      if (!g.progress.mission && g.progress.next) window.__brk += dt;
      return tick(dt, st);
    };
    return true;
  });
  await begin("long_legs");
  assert(await setUp(["strider"]), "set up");
  await v((g) => {
    g.progress.auto = true;
    window.__brk = 0;
    for (const c of g.colossi.list) c.die();
    return true;
  });
  const queued = await until((g) => (g.progress.result?.ok && !g.progress.mission ? { next: g.progress.next ? { ...g.progress.next } : null } : g.progress.mission && g.progress.mission.id !== "long_legs" ? { started: g.progress.mission.id } : null), null, 30000);
  assert(queued && (queued.started || queued.next?.left <= 3), `the next queued, 3 s at most: ${JSON.stringify(queued)}`);
  const next = await until((g) => (g.progress.mission && g.progress.mission.id !== "long_legs" ? { id: g.progress.mission.id, brk: Math.round(window.__brk * 100) / 100 } : null), null, 40000);
  assert(next && next.brk <= 3.2, `started within 3 s of game time: ${JSON.stringify(next)}`);
  console.log(`    after the win: ${next.id} started ${next.brk} s (game time) later`);
  // Shift+M: stopped.
  await v(() => window.dispatchEvent(new KeyboardEvent("keydown", { code: "KeyM", key: "M", shiftKey: true })));
  const stopped = await v((g) => ({ auto: g.progress.auto, mission: g.progress.mission?.id || null, result: g.progress.result?.reason, fails: g.progress.fails, next: g.progress.next }));
  assert(!stopped.auto && !stopped.mission && stopped.result === "Stopped." && !stopped.next, `Shift+M stops: ${JSON.stringify(stopped)}`);
  await new Promise((r) => setTimeout(r, 5000));
  assert(!(await v((g) => g.progress.mission?.id)), "nothing starts while stopped");
  // The board: Resume missions (the stopped one first).
  const btn = await v((g) => {
    g.screens.onOpen["missions-screen"]();
    const b = document.querySelector("#missions-list [data-act=resume]");
    b?.click();
    return !!b;
  });
  assert(btn, "the board's Resume button");
  const resumed = await until((g) => g.progress.mission?.id, null, 30000);
  assert(resumed === next.id, `resumed with the stopped one: ${resumed} (stopped ${next.id})`);
  // The board's Stop button while it runs.
  const stop2 = await v((g) => {
    g.screens.onOpen["missions-screen"]();
    document.querySelector("#missions-list [data-act=pause]")?.click();
    return { auto: g.progress.auto, mission: g.progress.mission?.id || null };
  });
  assert(!stop2.auto && !stop2.mission, `the board's Stop missions: ${JSON.stringify(stop2)}`);
  // The setting: on resumes, off stops.
  await v((g) => g.settingsPanel.set("missionChain", true));
  assert(await until((g) => g.progress.mission?.id, null, 30000), "the setting on resumes them");
  await v((g) => g.settingsPanel.set("missionChain", false));
  const off = await v((g) => ({ auto: g.progress.auto, mission: g.progress.mission?.id || null }));
  assert(!off.auto && !off.mission, `the setting off stops them: ${JSON.stringify(off)}`);
  await v((g) => {
    g.settingsPanel.set("missionChain", true);
    g.progress.setAuto(false);
    return true;
  });
});

await browserCheck("frame time: two colossi and a swarm of 40 (the real game loop)", async () => {
  await sky();
  const measure = () =>
    page.evaluate(
      () =>
        new Promise((res) => {
          const g = window.__ufo;
          const upd = g.colossi.update.bind(g.colossi);
          let cost = 0;
          let n = 0;
          let worst = 0;
          g.colossi.update = (dt) => {
            const t0 = performance.now();
            upd(dt);
            const d = performance.now() - t0;
            cost += d;
            worst = Math.max(worst, d);
            n++;
          };
          const times = [];
          let last = performance.now();
          const t0 = last;
          const f = () => {
            const now = performance.now();
            times.push(now - last);
            last = now;
            if (now - t0 < 4000) requestAnimationFrame(f);
            else {
              g.colossi.update = upd;
              times.sort((a, b) => a - b);
              res({ frame: Math.round(times.reduce((s, x) => s + x, 0) / times.length), p95: Math.round(times[Math.floor(times.length * 0.95)]), colAvg: n ? Math.round((cost / n) * 100) / 100 : 0, colWorst: Math.round(worst * 10) / 10 });
            }
          };
          requestAnimationFrame(f);
        })
    );
  const before = await measure();
  await v((g) => {
    const H = window.__r21;
    const s = H.spawn("strider", 350, { dx: -150 });
    const h = H.spawn("hive", 380, { dx: 150 });
    s.speedMul = 0.5;
    g.colossi.launchSwarm(h, h.eggs[0].pos, 20);
    g.colossi.launchSwarm(h, h.eggs[1].pos, 20);
    for (const p of g.colossi.swarm) p.life = 99;
    return true;
  });
  const during = await measure();
  console.log(`    frames: ${before.frame} ms (p95 ${before.p95}) alone, ${during.frame} ms (p95 ${during.p95}) with 2 colossi and ${await v((g) => g.colossi.swarm.length)} parasites; colossi.update ${during.colAvg} ms avg, ${during.colWorst} ms worst`);
  assert(during.colAvg < 4 && during.colWorst < 40, `the colossi's own work per frame: ${JSON.stringify(during)}`);
  assert(during.frame < before.frame * 1.8 + 15, `the frame time stays sane: ${JSON.stringify({ before, during })}`);
  await v((g) => g.colossi.clear());
});

if (SHOTS) {
  await browserCheck("views (SHOTS): each colossus from the ground and from the air", async () => {
    for (const kind of ["strider", "weeper", "hive"]) {
      for (const [dist, up, pitch] of [[380, 30, 0.3], [260, 140, -0.05], [170, 60, 0.35]]) {
        await sky();
        await v((g, o) => {
          if (g.vehicles.active) g.vehicles.exit({ force: true });
          for (const j of [...g.vehicles.vehicles]) g.vehicles.remove(j);
          const p = g.player.position;
          g.player.flying = true;
          const gy = window.__r21.ground(p.x, p.z);
          p.y = gy + o.up;
          g.player.velocity.set(0, 0, 0);
          const c = window.__r21.spawn(o.kind, o.dist, o.kind === "strider" ? { goal: { x: p.x, z: p.z - o.dist - 200 } } : { keepAway: 0, yaw: Math.PI });
          window.__r21.run(6, 1 / 20);
          g.player.yaw = 0;
          g.player.pitch = o.pitch;
          return true;
        }, { kind, dist, up, pitch });
        await frames(12);
        await shot(page, `${kind}-${dist}-${up}`);
      }
    }
    await v((g) => g.colossi.clear());
  });
}

// ---------- Online ----------
if (!args.solo && (!args.only || "online".includes(String(args.only).toLowerCase()))) {
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
  await browserCheck("online: the guest sees the host's colossus walking and its health dropping; the guest's hits go to the host", async () => {
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
      g.testFlags.noMissions = true;
      g.setMode("creative");
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
    // The host's Strider, 300 blocks from the host, walking off east (no attacks).
    const cid = await vOn(host, (g) => {
      const p = g.player.position;
      const c = g.colossi.spawn("strider", { x: p.x, z: p.z - 300, yaw: -Math.PI / 2, goal: { x: p.x + 2000, z: p.z - 300 } });
      for (const k of Object.keys(c.cool)) c.cool[k] = 1e9;
      window.__c = c;
      return c.id;
    });
    const seen = await untilOn(guest, (g, id) => {
      const c = g.colossi.byId(id);
      return c ? { x: c.root.x, puppet: c.puppet, kind: c.kind } : null;
    }, cid, 30000);
    assert(seen && seen.puppet && seen.kind === "strider", `the guest sees it: ${JSON.stringify(seen)}`);
    const moved = await untilOn(guest, (g, o) => {
      const c = g.colossi.byId(o.id);
      return c && c.root.x - o.x > 60 && (c.steps || 0) > 0 ? { dx: Math.round(c.root.x - o.x), steps: c.steps || 0 } : null;
    }, { id: cid, x: seen.x }, 90000);
    assert(moved && moved.steps > 0, `it walks on the guest's side (its own steps): ${JSON.stringify(moved)}`);
    // The host hurts it: the guest's bar drops.
    await vOn(host, (g) => {
      const c = window.__c;
      const k = c.weak.find((p) => p.kind === "knee");
      g.ufos.damage(k, 600, true, k.pos.clone());
      return true;
    });
    const drop = await untilOn(guest, (g, id) => {
      const c = g.colossi.byId(id);
      const k = c?.weak.find((p) => p.kind === "knee");
      return c && c.hp < c.maxHp * 0.99 && k.hp < k.maxHp * 0.6 ? { core: Math.round((c.hp / c.maxHp) * 1000) / 10, knee: Math.round(k.hp) } : null;
    }, cid, 20000);
    assert(drop, "the guest sees its health drop");
    // The guest's own hit on another knee: to the host.
    const h0 = await vOn(host, () => window.__c.weak.filter((p) => p.kind === "knee")[1].hp);
    await vOn(guest, (g, id) => {
      const c = g.colossi.byId(id);
      const k = c.weak.filter((p) => p.kind === "knee")[1];
      g.ufos.damage(k, 400, true, k.pos.clone());
      return true;
    }, cid);
    const hurt = await untilOn(host, (g, h0) => {
      const k = window.__c.weak.filter((p) => p.kind === "knee")[1];
      return h0 - k.hp >= 300 ? Math.round(h0 - k.hp) : null;
    }, h0, 20000);
    assert(hurt, "the guest's hit reaches the host");
    // Gone on the host: gone for the guest.
    await vOn(host, (g) => g.colossi.clear());
    const gone = await untilOn(guest, (g) => (g.colossi.list.length === 0 ? "gone" : null), null, 20000);
    assert(gone, "cleared on the guest too");
    console.log(`    the guest: saw it walk ${moved.dx} blocks (${moved.steps} steps of its own), the host's hit took the bar to ${drop.core}%, the guest's hit did ${hurt} on the host`);
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
