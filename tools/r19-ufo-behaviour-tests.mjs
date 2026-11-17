// Round 19.A tests: the UFOs' whims (js/ufo-mischief.js, installed on the
// UfoManager in js/ufos.js).
// In the browser (a Missions world in Creative, no mission chain, no enemy jets):
//   - dodging: a ship that sees a bullet coming slides just clear of it and
//     the bullet flies past right beside the hull (a miss, judged against
//     the ship's real position); one that doesn't is hit; with the ships'
//     own random skills some dodge and some don't; a shot from close up
//     always lands; tiring and the pause between dodges mean re-aimed,
//     sustained fire hits an uncanny dodger in the end; the real pistol's
//     bullets too; a railgun charging under the crosshair is seen coming;
//     the test switch (dodgeScale 0) turns it off;
//   - every prank (photobomb, mimic, halo, glare, peekaboo, shadow, buzz,
//     squat, cowdrop, twins, moo, lure, signal) started through the hook,
//     run, and doing its thing; a hologram shot pops (no kill counted);
//     shot mid-prank, a ship either flees laughing or turns on the player;
//   - the calm after landing on a planet: with a busy sky and pranks
//     encouraged, no UFO comes within 60 blocks of the player who just
//     arrived, and no prank starts on them (one starts once the calm is over);
//   - a crowded sky (120 ships, pranks and shots flying) stays quick;
//   - no console errors anywhere.
//
//   node r19-ufo-behaviour-tests.mjs [--only=substring]
// (GAME_ROOT=dir runs another copy of the game.)
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

const { chromium } = await import("playwright-core");
// (A port range no other suite uses.)
const PORT = 10630 + Math.floor(Math.random() * 10);
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
  args: ["--use-gl=swiftshader", "--enable-webgl", "--ignore-gpu-blocklist", "--no-sandbox", "--disable-dev-shm-usage", "--autoplay-policy=no-user-gesture-required"],
});
const localThreeRoot = path.join(__dirname, "node_modules", "three");
const ctx = await browser.newContext({ viewport: { width: 800, height: 450 } });
const page = await ctx.newPage();
await page.route("https://cdn.jsdelivr.net/npm/three@0.160.0/**", (route) => {
  const rel = new URL(route.request().url()).pathname.replace("/npm/three@0.160.0/", "");
  route.fulfill({ path: path.join(localThreeRoot, rel), contentType: "text/javascript" });
});
page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
page.on("pageerror", (e) => errors.push(String(e)));
page.on("dialog", (d) => d.accept());

const v = (fn, arg) => page.evaluate(([src, a]) => new Function("g", "arg", `return (${src})(g, arg);`)(window.__ufo, a), [fn.toString(), arg]);
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
const until = async (fn, timeout = 60000, arg) => {
  const t0 = Date.now();
  while (Date.now() - t0 < timeout) {
    const r = await v(fn, arg);
    if (r) return r;
    await new Promise((res) => setTimeout(res, 150));
  }
  return null;
};
async function play() {
  const t0 = Date.now();
  while (Date.now() - t0 < 300000) {
    const st = await v((g) => g.gameState);
    if (st === "playing") return;
    if (st === "dead") {
      await v((g) => g.respawn());
      continue;
    }
    const click = (sel) => page.evaluate((s) => document.querySelector(s)?.click(), sel).catch(() => {});
    if (st === "start") await click("#play-btn");
    else if (await page.isVisible("#resume-btn")) await click("#resume-btn");
    else await page.mouse.click(300, 200);
    await frames(3);
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

// In-page helpers (installed once on window.__r19).
const HELPERS = `(() => {
  const g = window.__ufo;
  const T = g.THREE;
  const H = {};
  // A calm test bench: no new UFOs, no pranks or dodges unless asked, no calm.
  H.bench = () => {
    g.ufos.clear();
    g.settingsPanel.set("ufos.activity", 0);
    g.ufos.graceT = 0;
    g.player.graceUntil = 0;
    g.ufos.prankRate = 0;
    g.ufos.dodgeScale = 1;
    g.player.velocity?.set(0, 0, 0);
  };
  // A ship hovering still where it is put, \`d\` blocks ahead of the eyes along yaw \`a\`.
  H.hover = (size, d, a = 0, dy = 0, design) => {
    const e = g.player.getEyePosition();
    const pos = e.clone().add(new T.Vector3(-Math.sin(a) * d, dy, -Math.cos(a) * d));
    const u = g.ufos.spawn({ size, pos, design });
    u.state = "trick";
    u.trick = "hover";
    u.timer = 1e9;
    u.vel.set(0, 0, 0);
    u.blinkT = 1e9;
    u.whimT = 1e9;
    u.temper = 0;
    u.dodgeMul = undefined;
    return u;
  };
  H.aimAt = (p) => {
    const e = g.player.getEyePosition();
    const d = p.clone().sub(e);
    g.player.yaw = Math.atan2(-d.x, -d.z);
    g.player.pitch = Math.atan2(d.y, Math.hypot(d.x, d.z));
  };
  // A player's bullet from the eyes straight at \`p\` (as a gun fires it).
  H.shoot = (p, speed = 175) => {
    const e = g.player.getEyePosition();
    const dir = p.clone().sub(e).normalize();
    const b = g.lasers.fire({ from: e, dir, speed, damage: 3, owner: "player", source: g.player, range: 400, radius: 0.014, length: 3.2, tracer: true, sound: false, gun: "pistol" });
    return b;
  };
  // Steps the UFOs and the bolts together (fixed steps), following bolt \`b\`
  // (by its serial): returns how close it came to the hull (in the hit
  // shape's own measure, 0 = touching) and whether it hit.
  H.step = (n, dt = 1 / 60, b = null, u = null, onStep = null) => {
    const serial = b ? b.serial : 0;
    let closest = Infinity;
    let last = b ? b.pos.clone() : null;
    const h0 = u ? u.health : 0;
    for (let i = 0; i < n; i++) {
      g.ufos.update(dt);
      g.lasers.update(dt);
      onStep?.(i);
      if (b && u && b.serial === serial && !b.dead) {
        // (the segment it flew this step, against the ship's ellipsoid)
        const sy = u.radius / u.hitHalfHeight;
        const A = last;
        const B = b.pos;
        for (let k = 0; k <= 8; k++) {
          const x = A.x + (B.x - A.x) * (k / 8) - u.pos.x;
          const y = (A.y + (B.y - A.y) * (k / 8) - u.pos.y) * sy;
          const z = A.z + (B.z - A.z) * (k / 8) - u.pos.z;
          closest = Math.min(closest, Math.hypot(x, y, z) - u.radius);
        }
        last = b.pos.clone();
      }
    }
    return { closest, hit: u ? u.health < h0 : false };
  };
  window.__r19 = H;
  return true;
})()`;
const h = (fn, arg) => page.evaluate(([src, a]) => new Function("g", "H", "arg", `return (${src})(g, H, arg);`)(window.__ufo, window.__r19, a), [fn.toString(), arg]);

await browserCheck("boot: a Missions world in Creative, no missions or enemy jets", async () => {
  await page.goto(`http://127.0.0.1:${PORT}/index.html?seed=1919&type=missions&graphics=low`, { waitUntil: "load", timeout: 60000 });
  await page.waitForFunction(() => !!window.__ufo && window.__ufo.graphicsReady, null, { timeout: 120000 });
  await play();
  const r = await v((g) => {
    g.testFlags.noMissions = true;
    g.setMode("creative");
    g.settingsPanel.set("vehicles.enemyJets", 0);
    g.player.flying = true; // (stays put in the air while the tests move it about)
    // (High over the ground: nothing in the way of the test shots.)
    g.player.position.y = g.world.heightAt(Math.floor(g.player.position.x), Math.floor(g.player.position.z)) + 70;
    g.player.velocity.set(0, 0, 0);
    return { enabled: g.ufos.enabled, mischief: !!g.ufos.mischief, pranks: typeof g.ufos.forcePrank };
  });
  await page.evaluate(HELPERS);
  assert(r.enabled && r.mischief && r.pranks === "function", `start ${JSON.stringify(r)}`);
});

// ---------- Dodging ----------

await browserCheck("dodge: an uncanny ship slides just clear of a bullet (it flies past beside the hull, a miss); a clumsy one is hit", async () => {
  const r = await h((g, H) => {
    const out = [];
    for (const skill of [1, 0]) {
      H.bench();
      g.ufos.dodgeScale = 2; // (a certain dodge for a skilled ship: the test switch)
      const u = H.hover("small", 90, 0.3, 4, "saucer");
      u.dodgeSkill = skill;
      u.dodgeReact = 0.1;
      u.mood = "curious";
      H.step(3);
      const p0 = u.pos.clone();
      H.aimAt(u.pos);
      const d0 = g.ufos.mischief.dodges;
      const b = H.shoot(u.pos);
      const s = H.step(90, 1 / 60, b, u);
      out.push({ skill, dodged: g.ufos.mischief.dodges - d0, hit: s.hit, closest: +s.closest.toFixed(2), moved: +u.pos.distanceTo(p0).toFixed(2), r: +u.radius.toFixed(2), last: g.ufos.mischief.last });
    }
    return out;
  });
  const [uncanny, clumsy] = r;
  assert(uncanny.dodged === 1 && !uncanny.hit, `the uncanny ship didn't dodge: ${JSON.stringify(uncanny)}`);
  assert(uncanny.closest >= 0 && uncanny.closest < 2.5, `the bullet didn't fly past right beside it: ${JSON.stringify(uncanny)}`);
  assert(uncanny.moved > 0.2 && uncanny.moved < uncanny.r + 4, `not a small sidestep: ${JSON.stringify(uncanny)}`);
  assert(clumsy.dodged === 0 && clumsy.hit, `the clumsy ship wasn't hit: ${JSON.stringify(clumsy)}`);
  console.log(`        dodged: moved ${uncanny.moved} (radius ${uncanny.r}), the bullet passed ${uncanny.closest} from the hull`);
});

await browserCheck("dodge: with the ships' own random skills some dodge and some don't; a dodged shot misses, the others hit", async () => {
  const r = await h((g, H) => {
    H.bench();
    const st = { shots: 0, dodged: 0, dodgedHit: 0, plainHit: 0, plainMiss: 0, skills: [] };
    for (let k = 0; k < 40; k++) {
      g.ufos.clear();
      const u = H.hover(k % 3 ? "small" : "medium", 70 + (k % 5) * 10, (k / 40) * Math.PI * 2, 2 + (k % 4));
      st.skills.push(+u.dodgeSkill.toFixed(2));
      H.step(2);
      H.aimAt(u.pos);
      const d0 = g.ufos.mischief.dodges;
      const b = H.shoot(u.pos);
      const s = H.step(80, 1 / 60, b, u);
      st.shots++;
      if (g.ufos.mischief.dodges > d0) {
        st.dodged++;
        if (s.hit) st.dodgedHit++;
      } else if (s.hit) st.plainHit++;
      else st.plainMiss++;
    }
    return st;
  });
  console.log(`        ${r.dodged}/${r.shots} dodged (${r.dodgedHit} of them hit anyway), ${r.plainHit} hit, ${r.plainMiss} missed without a dodge`);
  assert(r.dodged >= 3 && r.dodged <= r.shots - 8, `dodges not "sometimes": ${JSON.stringify(r)}`);
  assert(r.dodgedHit <= 1, `dodged shots hit: ${JSON.stringify(r)}`);
  assert(r.plainMiss <= 1, `straight shots at still ships missed: ${JSON.stringify(r)}`);
});

await browserCheck("dodge: point blank always lands; tired and between dodges, re-aimed sustained fire hits an uncanny dodger; the real pistol too", async () => {
  const r = await h((g, H) => {
    const out = {};
    // Point blank (12 blocks): no time to react.
    H.bench();
    let u = H.hover("small", 12, 0, 1, "saucer");
    u.dodgeSkill = 1;
    u.dodgeReact = 0.1;
    H.step(2);
    H.aimAt(u.pos);
    let s = H.step(30, 1 / 60, H.shoot(u.pos), u);
    out.close = s.hit;
    // Sustained fire, re-aimed every 0.12 s, at an uncanny dodger 80 blocks off.
    H.bench();
    u = H.hover("small", 80, -0.4, 3, "saucer");
    u.dodgeSkill = 1;
    u.dodgeReact = 0.1;
    u.mood = "cheeky";
    H.step(2);
    const h0 = u.health;
    const d0 = g.ufos.mischief.dodges;
    let shots = 0;
    let firstHit = -1;
    H.step(60 * 8, 1 / 60, null, null, (i) => {
      if (firstHit < 0 && u.health < h0) firstHit = shots;
      if (i % 7 === 0 && firstHit < 0) {
        H.aimAt(u.pos);
        H.shoot(u.pos);
        shots++;
      }
    });
    out.sustained = { hit: u.health < h0, shots, firstHit, dodges: g.ufos.mischief.dodges - d0, fatigue: +u.fatigue.toFixed(2) };
    // The real pistol, at a still ship with no skill: a hit; with dodging off (the test switch) even an uncanny one is hit.
    H.bench();
    u = H.hover("medium", 60, 0.8, 2, "saucer");
    u.dodgeSkill = 0;
    H.step(2);
    H.aimAt(u.pos);
    let hp = u.health;
    g.weapons.firePistol();
    H.step(60);
    out.pistol = u.health < hp;
    H.bench();
    g.ufos.dodgeScale = 0;
    u = H.hover("small", 90, -0.8, 2, "saucer");
    u.dodgeSkill = 1;
    H.step(2);
    H.aimAt(u.pos);
    s = H.step(90, 1 / 60, H.shoot(u.pos), u);
    out.off = s.hit;
    g.ufos.dodgeScale = 1;
    return out;
  });
  assert(r.close, "a point-blank shot was dodged");
  assert(r.sustained.hit && r.sustained.dodges >= 1, `sustained fire: ${JSON.stringify(r.sustained)}`);
  assert(r.pistol, "the pistol missed a still ship");
  assert(r.off, "dodgeScale 0 didn't turn dodging off");
  console.log(`        sustained: hit on shot ${r.sustained.firstHit + 1} after ${r.sustained.dodges} dodges (fatigue ${r.sustained.fatigue})`);
});

await browserCheck("dodge: a railgun charging with a ship under the crosshair: it slides before the shot; kept in the crosshair a ship sometimes sways, taunting", async () => {
  const r = await h((g, H) => {
    H.bench();
    g.ufos.dodgeScale = 2;
    const u = H.hover("small", 100, 1.2, 4, "tictac");
    u.dodgeSkill = 1;
    u.dodgeReact = 0.1;
    H.step(2);
    H.aimAt(u.pos);
    const keep = g.ufos.aimCharge;
    let left = 0.8;
    g.ufos.aimCharge = () => left;
    const p0 = u.pos.clone();
    const d0 = g.ufos.mischief.dodges;
    H.step(40, 1 / 60, null, null, () => (left = Math.max(0.01, left - 1 / 60)));
    g.ufos.aimCharge = keep;
    // The instant beam, where the crosshair still points: it misses.
    const e = g.player.getEyePosition();
    const dir = g.player.getForwardVector();
    const hit = g.ufos.raycast(e, dir, 400);
    const rail = { dodged: g.ufos.mischief.dodges - d0, moved: +u.pos.distanceTo(p0).toFixed(2), beamHits: !!hit && hit.ufo === u, threats: g.ufos.mischief.threats, tries: g.ufos.mischief.tries, last: g.ufos.mischief.last, mood: u.mood, aimT: u.aimT };
    // Kept in the crosshair: a sway now and then (a cheeky mood, encouraged).
    H.bench();
    g.ufos.prankRate = 6;
    const w = H.hover("medium", 80, 2, 6, "saucer");
    w.mood = "cheeky";
    w.whimT = 1e9;
    const s0 = g.ufos.mischief.sways;
    H.step(60 * 10, 1 / 60, null, null, () => {
      H.aimAt(w.pos);
      w.mood = "cheeky";
    });
    return { rail, sways: g.ufos.mischief.sways - s0, aimT: +w.aimT.toFixed(1) };
  });
  assert(r.rail.dodged === 1 && r.rail.moved > 0.2 && !r.rail.beamHits, `railgun: ${JSON.stringify(r.rail)}`);
  assert(r.sways >= 1, `no taunting sway in 10 s under the crosshair: ${JSON.stringify(r)}`);
});

// ---------- Pranks ----------

const PRANKS = ["photobomb", "mimic", "halo", "glare", "peekaboo", "shadow", "buzz", "squat", "cowdrop", "twins", "moo", "lure", "signal", "snatch"];
await browserCheck("pranks: the list (14), each a weighted pick by personality and mood", async () => {
  const r = await h((g, H) => {
    H.bench();
    const counts = {};
    const u = H.hover("small", 100, 0, 10);
    for (let i = 0; i < 400; i++) {
      u.state = "roam";
      u.prank = null;
      u.mood = ["calm", "curious", "playful", "cheeky", "grumpy"][i % 5];
      u.personality = ["evader", "fast", "fighter"][i % 3];
      g.ufos._prankers = 0;
      if (g.ufos._randomPrank(u)) counts[u.prank.kind] = (counts[u.prank.kind] || 0) + 1;
      g.ufos._endPrank(u);
      for (const o of [...g.ufos.ufos]) if (o.decoy) g.ufos._remove(g.ufos.ufos.indexOf(o));
    }
    return { counts };
  });
  const names = await v((g) => Object.keys(g.ufos.prankKinds()));
  assert(JSON.stringify(names.sort()) === JSON.stringify([...PRANKS].sort()), `the pranks: ${names}`);
  console.log(`        small ships on foot: ${JSON.stringify(r.counts)}`);
  for (const k of ["photobomb", "mimic", "halo", "glare", "peekaboo", "buzz", "twins", "moo", "lure"]) assert((r.counts[k] ?? 0) > 0, `${k} never picked: ${JSON.stringify(r.counts)}`);
});

// Each prank: started through the hook, run (in fixed steps, the creatures
// in real frames for the cow), and seen doing its thing.
const prankRun = {
  photobomb: (g, H) => {
    const u = H.hover("small", 140, 0.5, 10);
    if (!g.ufos.forcePrank(u, "photobomb")) return { started: false };
    let near = Infinity;
    H.step(60 * 6, 1 / 60, null, null, () => {
      const e = g.player.getEyePosition();
      const f = g.player.getForwardVector();
      const want = e.clone().addScaledVector(new g.THREE.Vector3(f.x, 0, f.z).normalize(), u.prank?.d ?? 0);
      near = Math.min(near, u.pos.distanceTo(want));
    });
    H.step(60 * 3, 1 / 60, null, null, () => H.aimAt(u.pos)); // (aimed at: it slips away)
    return { started: true, ok: near < 12 && (u.prank?.slips ?? 1) >= 1, near: +near.toFixed(1), slips: u.prank?.slips, minDist: +u.pos.distanceTo(g.player.getEyePosition()).toFixed(1), r: u.radius };
  },
  mimic: (g, H) => {
    const u = H.hover("small", 120, -0.5, 10);
    if (!g.ufos.forcePrank(u, "mimic")) return { started: false };
    H.step(60 * 6);
    const x0 = u.pos.x;
    g.player.position.x += 12;
    H.step(60 * 3);
    const dx = u.pos.x - x0;
    g.player.position.x -= 12;
    return { started: true, ok: Math.abs(dx - 12) < 3, dx: +dx.toFixed(1) };
  },
  halo: (g, H) => {
    const u = H.hover("small", 100, 1, 10);
    if (!g.ufos.forcePrank(u, "halo")) return { started: false };
    H.step(60 * 6);
    const p = g.player.position;
    const a0 = Math.atan2(u.pos.z - p.z, u.pos.x - p.x);
    const R = Math.hypot(u.pos.x - p.x, u.pos.z - p.z);
    H.step(30);
    const a1 = Math.atan2(u.pos.z - p.z, u.pos.x - p.x);
    return { started: true, ok: Math.abs(R - u.prank.R) < 5 && Math.abs(a1 - a0) > 0.2, R: +R.toFixed(1), want: +u.prank.R.toFixed(1), above: +(u.pos.y - p.y).toFixed(1) };
  },
  glare: (g, H) => {
    const u = H.hover("medium", 120, 0, 20);
    if (!g.ufos.forcePrank(u, "glare")) return { started: false };
    let glared = 0;
    H.step(60 * 8, 1 / 60, null, null, () => (glared += u.glare ? 1 : 0));
    return { started: true, ok: glared > 30, glared, flags: g.ufos.fxFlags(u) };
  },
  peekaboo: (g, H) => {
    const u = H.hover("small", 110, 0.2, 10);
    if (!g.ufos.forcePrank(u, "peekaboo")) return { started: false };
    let lo = Infinity;
    let hi = -Infinity;
    let toggles = 0;
    let was = true;
    H.step(60 * 12, 1 / 60, null, null, (i) => {
      if (i > 60 * 4) {
        lo = Math.min(lo, u.pos.y);
        hi = Math.max(hi, u.pos.y);
      }
      if (u.prank && u.prank.hiding !== was) {
        toggles++;
        was = u.prank.hiding;
      }
    });
    return { started: true, ok: toggles >= 2 && hi - lo > 2, toggles, rise: +(hi - lo).toFixed(1) };
  },
  shadow: (g, H) => {
    const u = H.hover("medium", 200, 2, 30);
    if (!g.ufos.forcePrank(u, "shadow")) return { started: false };
    H.step(60 * 14);
    const d = Math.hypot(u.pos.x - g.player.position.x, u.pos.z - g.player.position.z);
    return { started: true, ok: d > 135 && d < 195, d: +d.toFixed(1) };
  },
  buzz: (g, H) => {
    const u = H.hover("small", 140, -1, 10);
    if (!g.ufos.forcePrank(u, "buzz")) return { started: false };
    const b0 = g.ufos.mischief.buzzes;
    let closest = Infinity;
    H.step(60 * 12, 1 / 60, null, null, () => (closest = Math.min(closest, u.pos.distanceTo(g.player.getEyePosition()))));
    return { started: true, ok: g.ufos.mischief.buzzes > b0 && closest > u.radius + 1.5 && closest < u.radius + 16, passes: g.ufos.mischief.buzzes - b0, closest: +closest.toFixed(1), r: u.radius };
  },
  squat: (g, H) => {
    const u = H.hover("small", 90, 2.5, 10);
    if (!g.ufos.forcePrank(u, "squat")) return { started: false };
    let sat = false;
    H.step(60 * 25, 1 / 60, null, null, () => (sat = sat || u.prank?.phase === 2));
    return { started: true, ok: sat, perch: u.prank?.perch?.type ?? "roof/ground" };
  },
  twins: (g, H) => {
    const u = H.hover("small", 90, -2.5, 10);
    if (!g.ufos.forcePrank(u, "twins")) return { started: false };
    H.step(60);
    const decoys = g.ufos.ufos.filter((o) => o.decoy);
    const downs = g.stats.world.ufosDown;
    const d = decoys[0];
    g.ufos.damage(d, 5, true);
    H.step(2);
    return { started: true, ok: decoys.length >= 2 && !g.ufos.ufos.includes(d) && g.stats.world.ufosDown === downs && !u.falling, decoys: decoys.length, popped: !g.ufos.ufos.includes(d) };
  },
  moo: (g, H) => {
    const u = H.hover("small", 100, 3, 10);
    if (!g.ufos.forcePrank(u, "moo")) return { started: false };
    const m0 = g.ufos.mischief.moos;
    H.step(60 * 10);
    return { started: true, ok: g.ufos.mischief.moos > m0, moos: g.ufos.mischief.moos - m0 };
  },
  lure: (g, H) => {
    const u = H.hover("small", 100, -3, 10);
    if (!g.ufos.forcePrank(u, "lure")) return { started: false };
    H.step(60 * 4);
    const l0 = g.ufos.mischief.lured;
    const dest = u.prank.dest.clone();
    const home = g.player.position.clone();
    // Follow it there (in steps).
    for (let k = 0; k < 40 && g.ufos.mischief.lured === l0; k++) {
      const to = dest.clone().sub(g.player.position).setY(0);
      if (to.length() > 8) g.player.position.addScaledVector(to.normalize(), 8);
      H.step(20);
    }
    const lured = g.ufos.mischief.lured > l0;
    g.player.position.copy(home);
    return { started: true, ok: lured, dest: [Math.round(dest.x), Math.round(dest.z)] };
  },
  snatch: (g, H) => {
    const p = g.player.position;
    const at = p.clone().add(new g.THREE.Vector3(8, -2, 5));
    const it = g.entities.spawn(1, 1, at, new g.THREE.Vector3(0, 0, 0));
    if (!it) return { started: false, why: "no item" };
    it.age = 5;
    const u = H.hover("small", 100, -2, 10);
    if (!g.ufos.forcePrank(u, "snatch")) return { started: false };
    const s0 = g.ufos.mischief.snatched;
    const p0 = it.pos.clone();
    H.step(60 * 30, 1 / 60, null, null, () => {
      if (g.ufos.mischief.snatched > s0 && !it.landedT) it.landedT = 1;
    });
    const moved = Math.hypot(it.pos.x - p0.x, it.pos.z - p0.z);
    const still = g.entities.items.includes(it);
    g.entities._remove(g.entities.items.indexOf(it));
    return { started: true, ok: g.ufos.mischief.snatched > s0 && moved > 15 && still && it.pickupDelay <= 0.5, moved: +moved.toFixed(1), still };
  },
  signal: (g, H) => {
    const u = H.hover("medium", 130, 0.7, 30);
    const others = [H.hover("small", 300, 2, 40), H.hover("small", 320, -2, 40), H.hover("medium", 280, 3, 40)];
    for (const o of others) o.state = "roam";
    if (!g.ufos.forcePrank(u, "signal")) return { started: false };
    let gawkers = 0;
    let minD = Infinity;
    H.step(60 * 25, 1 / 60, null, null, () => {
      gawkers = Math.max(gawkers, g.ufos.ufos.filter((o) => o.prank?.kind === "gawk").length);
      for (const o of g.ufos.ufos) if (o.prank?.kind === "gawk") minD = Math.min(minD, o.pos.distanceTo(g.player.position));
    });
    return { started: true, ok: gawkers >= 2 && minD > 60, gawkers, minD: +minD.toFixed(1) };
  },
};
for (const kind of PRANKS) {
  if (kind === "cowdrop") continue;
  await browserCheck(`prank ${kind}: started through the hook, runs, does its thing`, async () => {
    await h((g, H) => {
      H.bench();
      return true;
    });
    const r = await page.evaluate(([src]) => new Function("g", "H", `return (${src})(g, H);`)(window.__ufo, window.__r19), [prankRun[kind].toString()]);
    assert(r.started, `${kind} didn't start`);
    assert(r.ok, `${kind}: ${JSON.stringify(r)}`);
    console.log(`        ${kind}: ${JSON.stringify(r)}`);
  });
}

await browserCheck("prank cowdrop: an animal nearby beamed up and dropped beside the player (real frames)", async () => {
  const r = await h((g, H) => {
    H.bench();
    const p = g.player.position;
    p.y = g.world.surfaceY(Math.floor(p.x), Math.floor(p.z)) + 1; // (on the ground for this one)
    for (let i = g.mobs.mobs.length - 1; i >= 0; i--) if (g.mobs.mobs[i].kind === "cow") g.mobs._remove(i);
    // (A dry spot for it, round the player.)
    let cow = null;
    for (let k = 0; k < 16 && !cow; k++) {
      const x = p.x + Math.cos(k * 0.9) * (14 + k);
      const z = p.z + Math.sin(k * 0.9) * (14 + k);
      const y = g.world.surfaceY(Math.floor(x), Math.floor(z)) + 1;
      cow = g.mobs.spawn("cow", x, y, z);
    }
    const u = H.hover("small", 80, 1.5, 15);
    window.__cowUfo = u;
    window.__drops0 = g.ufos.mischief.drops;
    return { cow: !!cow, started: g.ufos.forcePrank(u, "cowdrop"), kind: u.prank?.kind };
  });
  assert(r.cow && r.started && r.kind === "cowdrop", `cowdrop: ${JSON.stringify(r)}`);
  await play(); // (real frames: the game running)
  const done = await until((g) => g.ufos.mischief.drops > window.__drops0 || !window.__cowUfo.prank, 90000);
  await frames(20); // (it lands)
  const out = await v((g) => {
    const p = g.player.position;
    const d = g.ufos.mischief.lastDrop;
    const near = d ? g.mobs.mobs.filter((m) => m.kind === d.kind && !m.dead).map((m) => Math.round(Math.hypot(m.pos.x - p.x, m.pos.z - p.z))) : [];
    return { drops: g.ufos.mischief.drops - window.__drops0, kind: d?.kind, at: d && Math.round(Math.hypot(d.at[0] - p.x, d.at[2] - p.z)), near };
  });
  assert(done && out.drops === 1 && out.at < 8 && out.near.some((x) => x < 10), `the animal wasn't dropped by the player: ${JSON.stringify(out)}`);
  console.log(`        cowdrop: ${JSON.stringify(out)}`);
});

await browserCheck("pranks: shot mid-prank, a ship flees laughing or turns on the player (both happen)", async () => {
  const r = await h((g, H) => {
    H.bench();
    g.setMode("survival");
    g.player.health = 20;
    const out = { fled: 0, hostile: 0, other: 0 };
    const f0 = g.ufos.mischief.fled;
    for (let k = 0; k < 24; k++) {
      g.ufos.clear();
      const u = H.hover("small", 100, k, 10);
      u.mood = ["cheeky", "grumpy", "playful", "curious"][k % 4];
      g.ufos.forcePrank(u, k % 2 ? "moo" : "halo");
      H.step(10);
      const before = g.ufos.mischief.fled;
      g.ufos.damage(u, 2, true);
      if (g.ufos.mischief.fled > before) out.fled++;
      else if (u.hostile) out.hostile++;
      else out.other++;
      if (u.prank) out.other += 100;
    }
    g.ufos.clear();
    g.setMode("creative");
    out.total = g.ufos.mischief.fled - f0;
    return out;
  });
  assert(r.fled >= 2 && r.hostile >= 2 && r.other === 0, `reactions: ${JSON.stringify(r)}`);
  console.log(`        ${JSON.stringify(r)}`);
});

// ---------- The calm after landing ----------

await browserCheck("calm after landing on the Moon: a busy sky, pranks encouraged, yet no UFO within 60 blocks and no prank for 30 s; then pranks again", async () => {
  await v((g) => {
    g.ufos.clear();
    g.ufos.prankRate = 20;
    g.settingsPanel.set("ufos.activity", 8);
    g.vehicles.exit?.({ force: true });
    g.dims.travel("moon", 0.5, 100, 0.5, { place: "safe" });
    return true;
  });
  await page.waitForFunction(() => !window.__ufo.dims.pending && window.__ufo.dims.dim === "moon", null, { timeout: 90000 });
  const r = await h((g, H) => {
    const p = g.player.position;
    const out = { grace0: +g.ufos.graceT.toFixed(1), minD: Infinity, n: 0, pranks: 0, forced: false, closest: null };
    const pr0 = Object.values(g.ufos.mischief.pranks).reduce((s, x) => s + x, 0);
    // A ship told to fly right at the player, and one dashing about near.
    let lure = null;
    for (let i = 0; i < 25 * 30; i++) {
      g.ufos.update(1 / 30);
      g.lasers.update(1 / 30);
      if (i === 90) {
        lure = g.ufos.spawn({ size: "medium", pos: p.clone().add(new g.THREE.Vector3(160, 30, 0)) });
        lure.waypoint = p.clone();
        lure.timer = 60;
        out.forced = g.ufos.forcePrank(lure, "photobomb");
      }
      if (i === 200 && lure) g.ufos._blink(lure, 200, 120);
      for (const u of g.ufos.ufos) {
        if (u.falling) continue;
        const d = u.pos.distanceTo(p);
        if (d < out.minD) {
          out.minD = d;
          out.closest = { state: u.state, trick: u.trick, size: u.size, i };
        }
      }
      out.n = Math.max(out.n, g.ufos.count);
    }
    out.minD = +out.minD.toFixed(1);
    out.pranks = Object.values(g.ufos.mischief.pranks).reduce((s, x) => s + x, 0) - pr0;
    out.grace1 = +g.ufos.graceT.toFixed(1);
    return out;
  });
  console.log(`        ${JSON.stringify(r)}`);
  assert(r.grace0 > 20, `no calm on landing: ${JSON.stringify(r)}`);
  assert(r.n >= 6, `not a busy sky: ${JSON.stringify(r)}`);
  assert(r.minD >= 60, `a UFO came within ${r.minD} blocks during the calm: ${JSON.stringify(r)}`);
  assert(!r.forced && r.pranks === 0, `a prank in the calm: ${JSON.stringify(r)}`);
  // The calm over: pranks come.
  const after = await h((g, H) => {
    g.ufos.graceT = 0;
    g.player.graceUntil = 0;
    const u = H.hover("small", 120, 0, 10);
    const ok = g.ufos.forcePrank(u, "halo");
    const pr0 = Object.values(g.ufos.mischief.pranks).reduce((s, x) => s + x, 0);
    for (let i = 0; i < 30 * 30; i++) g.ufos.update(1 / 30);
    return { ok, more: Object.values(g.ufos.mischief.pranks).reduce((s, x) => s + x, 0) - pr0 };
  });
  assert(after.ok && after.more >= 1, `no pranks after the calm: ${JSON.stringify(after)}`);
});

// ---------- Load ----------

await browserCheck("a crowded sky: 120 ships with pranks and shots flying stays quick", async () => {
  const r = await h((g, H) => {
    H.bench();
    g.ufos.prankRate = 5;
    for (let i = 0; i < 120; i++) {
      const a = (i / 120) * Math.PI * 2;
      const u = g.ufos.spawn({ size: i % 4 ? "small" : "medium", pos: g.player.position.clone().add(new g.THREE.Vector3(Math.cos(a) * (90 + (i % 7) * 30), 25 + (i % 5) * 8, Math.sin(a) * (90 + (i % 7) * 30))) });
      u.whimT = Math.random() * 3;
    }
    let worst = 0;
    let total = 0;
    const N = 300;
    for (let i = 0; i < N; i++) {
      if (i % 3 === 0) {
        const u = g.ufos.ufos[i % g.ufos.ufos.length];
        if (u) H.shoot(u.pos);
      }
      const t0 = performance.now();
      g.ufos.update(1 / 30);
      const t = performance.now() - t0;
      g.lasers.update(1 / 30);
      total += t;
      if (i > 10) worst = Math.max(worst, t);
    }
    const out = { avg: +(total / N).toFixed(2), worst: +worst.toFixed(1), pranks: g.ufos.ufos.filter((u) => u.state === "prank").length, dodges: g.ufos.mischief.dodges, count: g.ufos.count };
    g.ufos.clear();
    g.ufos.prankRate = 1;
    return out;
  });
  console.log(`        ${JSON.stringify(r)}`);
  assert(r.avg < 6, `UFO update too slow: ${JSON.stringify(r)}`);
});

await browserCheck("no console errors over the whole run", async () => {
  await frames(10);
  assert(errors.length === 0, `console errors: ${errors.slice(0, 5).join(" | ")}`);
});

await browser.close();
server.close();
const passed = results.filter((r) => r[1]).length;
console.log(`\n${passed}/${results.length} passed`);
process.exit(passed === results.length ? 0 : 1);
