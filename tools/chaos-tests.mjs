// Chaos test: drives the real game (one headless page) through a long,
// seeded random sequence of actions: modes, creatures, UFOs, every hand
// weapon, every vehicle and its weapons, deaths and respawns, every mission
// by day and night, menus, time of day, far teleports, explosions, block
// edits, graphics changes, saving and a reload. Any exception (thrown by an
// action or by the game loop) is reported with the actions that led to it.
// The same seed replays the same run.
//
//   node chaos-tests.mjs [--steps=400] [--seed=1] [--world=42] [--verbose]
//
// Fails on any page error or console error.
import http from "node:http";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";

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
const STEPS = Number(args.steps ?? 400);
const RUN_SEED = Number(args.seed ?? 1);
const WORLD = Number(args.world ?? 42);
const PORT = 9700 + Math.floor(Math.random() * 40);
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
await new Promise((r) => server.listen(PORT, r));
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome",
  args: ["--use-gl=swiftshader", "--enable-webgl", "--ignore-gpu-blocklist", "--no-sandbox", "--disable-dev-shm-usage"],
});
const page = await browser.newPage({ viewport: { width: 480, height: 270 } });
const localThreeRoot = path.join(__dirname, "node_modules", "three");
await page.route("https://cdn.jsdelivr.net/npm/three@0.160.0/**", (route) => {
  const rel = new URL(route.request().url()).pathname.replace("/npm/three@0.160.0/", "");
  route.fulfill({ path: path.join(localThreeRoot, rel), contentType: "text/javascript" });
});
const errors = [];
page.on("console", (m) => {
  if (m.type() === "error") errors.push(m.text());
  else if (args.verbose) console.log(`    [console] ${m.text()}`);
});
page.on("pageerror", (e) => errors.push(`${e.message}\n${(e.stack || "").split("\n").slice(1, 6).join("\n")}`));
page.on("dialog", (d) => d.accept());

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

async function boot() {
  await page.goto(`http://localhost:${PORT}/index.html?seed=${WORLD}`, { waitUntil: "load", timeout: 60000 });
  await page.waitForFunction(() => !!window.__ufo, null, { timeout: 60000 });
  await page.evaluate(() => window.__ufo.setGraphics("low"));
  await page.waitForFunction(() => window.__ufo.graphicsReady, null, { timeout: 120000 });
  await page.click("#play-btn", { timeout: 120000 });
  await page.waitForFunction(() => window.__ufo.gameState === "playing", null, { timeout: 60000 });
}
await boot();

// A small seeded generator (the run is reproducible).
let s = RUN_SEED >>> 0 || 1;
const rnd = () => {
  s = (s + 0x6d2b79f5) >>> 0;
  let t = s;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
const pick = (a) => a[Math.floor(rnd() * a.length)];

const MOBS = ["zombie", "skeleton", "spider", "cow", "pig", "sheep", "chicken", "villager", "alien", "alien_gray", "alien_red", "alien_blue", "guard", "fish", "parrot", "butterfly"];
const HAND = ["melee", "bow", "pistol", "blaster", "machinegun", "minigun", "sniper", "railgun", "bazooka", "grenade", "airstrike"];
const MISSIONS = await v((g) => g.MISSIONS.map((m) => m.id));

// Every action runs inside the page, defensively: an exception from the
// game is what we're after (it is caught, reported and the run goes on).
const ACTIONS = {
  mode: (r) =>
    v((g, r) => {
      g.setMode(r < 0.5 ? "survival" : "creative");
      return g.player.mode;
    }, r),
  mob: (r) =>
    v((g, a) => {
      const p = g.player.position;
      const x = p.x + (a.r - 0.5) * 30;
      const z = p.z + (a.r2 - 0.5) * 30;
      const y = Math.max(g.world.surfaceY(Math.floor(x), Math.floor(z)) + 1, p.y);
      const m = g.mobs.spawn(a.kind, x, y, z);
      return m ? `${a.kind} spawned` : `${a.kind} refused`;
    }, { r, r2: rnd(), kind: pick(MOBS) }),
  ufo: (r) =>
    v((g, a) => {
      const T = g.THREE;
      const p = g.player.position;
      const u = g.ufos.spawn({ size: a.size, pos: new T.Vector3(p.x + (a.r - 0.5) * 120, p.y + 25 + a.r * 40, p.z + (a.r2 - 0.5) * 120) });
      if (u && a.angry) g.ufos.anger?.(u, 30);
      return u ? `${a.size} ufo` : "no ufo";
    }, { r, r2: rnd(), size: pick(["small", "medium", "large", "mothership"]), angry: rnd() < 0.6 }),
  hurtUfo: (r) =>
    v((g, r) => {
      const list = g.ufos.ufos.filter((u) => u.state !== "gone");
      if (!list.length) return "none";
      const u = list[Math.floor(r * list.length)];
      g.ufos.damage(u, r < 0.4 ? 99999 : 5 + r * 80, true, u.pos.clone());
      return `hit ufo ${u.id}`;
    }, r),
  hurtMob: (r) =>
    v((g, r) => {
      const list = g.mobs.mobs.filter((m) => !m.dead);
      if (!list.length) return "none";
      const m = list[Math.floor(r * list.length)];
      const d = new g.THREE.Vector3(r - 0.5, 0, 0.5 - r).normalize();
      g.mobs.shoot(m, r < 0.5 ? 999 : 4, d, 2, true);
      return `hit ${m.kind}`;
    }, r),
  weapon: (r) =>
    v(
      async (g, a) => {
        if (g.player.dead) return "dead";
        if (g.vehicles.active) g.vehicles.exit({ force: true });
        const W = g.weapons;
        W.refill?.();
        const ids = { melee: 273, bow: 297, pistol: 287, blaster: 292, machinegun: 289, minigun: 295, sniper: 290, railgun: 294, bazooka: 288, grenade: 286, airstrike: 291 };
        const id = ids[a.w];
        g.inventory.slots[0] = { id, count: a.w === "grenade" || a.w === "airstrike" ? 8 : 1 };
        g.inventory.selected = 0;
        g.player.yaw = a.yaw;
        g.player.pitch = a.pitch;
        const { itemInfo } = await import("./js/items.js");
        switch (a.w) {
          case "melee": {
            const eye = g.player.getEyePosition();
            const dir = g.player.getForwardVector();
            const hit = g.mobs.raycast(eye, dir, 6);
            if (hit) g.mobs.attack(hit.mob, itemInfo(273)?.tool);
            break;
          }
          case "bow":
            W.bow.drawing = true;
            W.bow.t = 1.2;
            W.release();
            break;
          case "pistol":
          case "blaster":
            W.press(a.w);
            W.release();
            break;
          case "machinegun":
            for (let i = 0; i < 4; i++) W.fireMachineGun();
            break;
          case "minigun":
            for (let i = 0; i < 6; i++) W.fireMinigunBolt();
            break;
          case "sniper":
            W.sniperShot();
            break;
          case "railgun":
            W.fireRailgun();
            break;
          case "bazooka":
            W.fireBazooka(null);
            break;
          case "grenade":
            W.throwGrenade(0.5);
            break;
          case "airstrike":
            W.fireAirstrike();
            break;
        }
        return a.w;
      },
      { w: pick(HAND), yaw: rnd() * Math.PI * 2, pitch: (rnd() - 0.6) * 1.2 }
    ),
  vehicle: (r) =>
    v(
      (g, a) => {
        if (g.player.dead) return "dead";
        const wasCreative = g.player.creative;
        g.setMode("creative");
        const ok = g.mp.game.callIn(a.kind);
        const veh = g.vehicles.active;
        if (!veh) {
          if (!wasCreative) g.setMode("survival");
          return `call-in ${a.kind} failed`;
        }
        veh.__chaos = a.act;
        if (veh.type === "jet") {
          if (a.act === 0) for (let i = 0; i < 6; i++) veh._fireCannon?.(veh.forward?.(new g.THREE.Vector3()) || new g.THREE.Vector3(0, 0, -1));
          else if (a.act === 1) veh._launchMissile?.(null);
          else if (a.act === 2) veh._launchFlares?.();
          else if (a.act === 3 && veh.jetType === "b2") veh._dropNuke?.();
        } else {
          const T = g.THREE;
          if (a.act === 0) for (let i = 0; i < 3; i++) veh._bolt?.(veh._muzzle(new T.Vector3()), new T.Vector3(Math.sin(a.yaw), -0.3, Math.cos(a.yaw)).normalize());
          else if (a.act === 1) g.vehicles.input.buttons[2] = true;
          else if (a.act === 2) {
            veh.sw && (veh.sw.cool = 0);
            veh._startSuper?.();
          } else if (a.act === 3) veh.ghost !== undefined && (veh.ghost = !veh.ghost);
        }
        if (!wasCreative && a.back) g.setMode("survival");
        return `${a.kind} act ${a.act}${ok ? "" : " (not called)"}`;
      },
      { kind: pick(["f22", "f16", "b2", "ufo"]), act: Math.floor(rnd() * 4), yaw: rnd() * 6.28, back: rnd() < 0.5 }
    ),
  leaveVehicle: () =>
    v((g) => {
      g.vehicles.input.buttons[2] = false;
      if (g.vehicles.active) g.vehicles.exit({ force: true });
      return "out";
    }),
  die: (r) =>
    v((g, r) => {
      if (g.player.dead) {
        g.respawn();
        return "respawned";
      }
      if (g.player.creative) g.setMode("survival");
      g.player.damage(9999, pickCause(r), { pierce: true });
      function pickCause(r) {
        const c = ["fall", "zombie", "alien", "soldier", "ufo_laser", "enemyjet", "nuke", "grenade", "ufo_crash", "drown"];
        return c[Math.floor(r * c.length)];
      }
      return `died: ${g.mp.game.deathMessage(g.player.lastCause ?? "")}`;
    }, r),
  respawn: () =>
    v((g) => {
      if (g.player.dead || g.gameState === "dead") g.respawn();
      return g.gameState;
    }),
  mission: (r) =>
    v(
      (g, a) => {
        g.testFlags.noMissions = false;
        g.setMode("survival");
        g.progress.enabled = true;
        g.missions.enabled = true;
        g.progress.step = Math.max(0, g.MISSIONS.findIndex((m) => m.id === a.id));
        g.progress.start(g.stats.world);
        g.sky.setHours(a.night ? 22 : 11);
        for (let i = 0; i < a.ticks; i++) {
          g.missions.checkT = 0;
          g.missions.update(0.5);
        }
        return `${a.id} ${a.night ? "night" : "day"} target=${g.missions.target?.label || "-"}`;
      },
      { id: pick(MISSIONS), night: rnd() < 0.4, ticks: 2 + Math.floor(rnd() * 10) }
    ),
  missionTick: (r) =>
    v((g, n) => {
      for (let i = 0; i < n; i++) {
        g.missions.checkT = 0;
        g.missions.update(0.5);
      }
      g.progress.update(g.stats.world);
      return `${g.progress.mission?.id || "post-game"} ${g.missions.note?.() || ""}`;
    }, 1 + Math.floor(r * 8)),
  screens: (r) =>
    page.evaluate((r) => {
      const ids = ["pause-menu", "missions-screen", "stats-screen", "victory-screen"];
      const id = ids[Math.floor(r * ids.length)];
      const g = window.__ufo;
      if (id === "victory-screen") g.mp.game.showVictory();
      else if (id === "missions-screen" || id === "stats-screen") g.screens.show(id, g.gameState === "start" ? "start-menu" : "pause-menu");
      else document.getElementById(id)?.classList.remove("hidden");
      return id;
    }, r),
  closeScreens: () =>
    page.evaluate(() => {
      const g = window.__ufo;
      g.screens.closeAll?.();
      for (const id of ["pause-menu", "victory-screen"]) document.getElementById(id)?.classList.add("hidden");
      return "closed";
    }),
  time: (r) =>
    v((g, r) => {
      g.sky.setHours(r * 24);
      return `${(r * 24).toFixed(1)}h`;
    }, r),
  teleport: (r) =>
    v((g, a) => {
      if (g.vehicles.active) g.vehicles.exit({ force: true });
      const p = g.player.position;
      const x = p.x + Math.cos(a.ang) * a.d;
      const z = p.z + Math.sin(a.ang) * a.d;
      g.world.prepareArea(x, z, 2);
      g.player.flying = a.fly;
      g.player.position.set(x, a.fly ? 100 : g.world.surfaceY(Math.floor(x), Math.floor(z)) + 1, z);
      g.player.velocity.set(0, 0, 0);
      g.player.resetFall?.();
      g.streamAround(x, z);
      return `teleport ${Math.round(a.d)}`;
    }, { d: 100 + r * 2500, ang: rnd() * 6.28, fly: rnd() < 0.4 }),
  explode: (r) =>
    v((g, a) => {
      const p = g.player.position;
      const T = g.THREE;
      g.effects.explode(new T.Vector3(p.x + (a.r - 0.5) * 40, p.y + (a.r2 - 0.3) * 10, p.z + (a.r2 - 0.5) * 40), { radius: 2 + a.r * 8, source: a.src });
      return `boom ${a.src}`;
    }, { r, r2: rnd(), src: pick(["grenade", "bazooka", "ufo_crash", "ufo_blast", "enemymissile", "meteor", "missile"]) }),
  blocks: (r) =>
    v((g, a) => {
      const p = g.player.position;
      const list = [];
      for (let i = 0; i < 20; i++) list.push(Math.floor(p.x + (i % 5) - 2 + a.dx), Math.floor(p.y) + Math.floor(i / 5) - 1, Math.floor(p.z + 3), a.id);
      g.world.setBlocks(list);
      return `blocks ${a.id}`;
    }, { dx: Math.floor(r * 6) - 3, id: pick([0, 1, 3, 5, 8, 9, 17]) }),
  nuke: (r) =>
    v((g, r) => {
      const p = g.player.position;
      g.nuke.detonate(new g.THREE.Vector3(p.x + 120 + r * 200, p.y, p.z), {});
      return "nuke";
    }, r),
  graphics: (r) =>
    v((g, r) => {
      const p = r < 0.5 ? "low" : "medium";
      g.setGraphics(p);
      g.setRenderDistance?.(r < 0.3 ? 6 : r < 0.6 ? 10 : 16);
      return p;
    }, r),
  save: () =>
    v((g) => {
      g.flushSave?.();
      return "saved";
    }),
  crate: (r) =>
    v((g) => {
      g.crates.dropNear?.(g.player.position) ?? g.crates.spawn?.();
      return "crate";
    }, r),
};

// Weights: what a session mostly consists of.
const WEIGHTED = [
  ["mob", 10], ["ufo", 7], ["hurtUfo", 6], ["hurtMob", 6], ["weapon", 14], ["vehicle", 7], ["leaveVehicle", 5], ["die", 3], ["respawn", 4],
  ["mission", 8], ["missionTick", 8], ["screens", 3], ["closeScreens", 3], ["time", 3], ["teleport", 4], ["explode", 4], ["blocks", 3],
  ["nuke", 1], ["graphics", 1], ["save", 2], ["mode", 3], ["crate", 1],
];
const total = WEIGHTED.reduce((a, [, w]) => a + w, 0);
const choose = () => {
  let x = rnd() * total;
  for (const [k, w] of WEIGHTED) {
    if ((x -= w) <= 0) return k;
  }
  return "mob";
};

const log = [];
const problems = [];
let reloaded = false;
const t0 = Date.now();
for (let i = 0; i < STEPS; i++) {
  // One reload in the middle (a save and a fresh start on it).
  if (!reloaded && i === Math.floor(STEPS / 2)) {
    reloaded = true;
    await v((g) => g.flushSave?.());
    log.push(`${i}: reload`);
    await boot();
  }
  const name = choose();
  const r = rnd();
  const before = errors.length;
  let out;
  try {
    out = await ACTIONS[name](r);
  } catch (err) {
    out = `THREW: ${String(err.message || err).split("\n")[0]}`;
    problems.push({ step: i, kind: "action threw", action: name, error: String(err.message || err).slice(0, 600), recent: log.slice(-8) });
  }
  log.push(`${i}: ${name} -> ${typeof out === "string" ? out : JSON.stringify(out)}`);
  if (args.verbose) console.log(`  ${log[log.length - 1]}`);
  await frames(3 + Math.floor(rnd() * 5));
  if (errors.length > before) {
    for (const e of errors.slice(before)) problems.push({ step: i, kind: "page error", action: name, error: e.slice(0, 800), recent: log.slice(-8) });
  }
  // Keep the run going: back in the game if a screen or death stopped it.
  await v((g) => {
    if (g.gameState === "dead" && Math.random() < 0.7) g.respawn();
    return true;
  });
}

console.log(`\n${STEPS} steps in ${((Date.now() - t0) / 1000).toFixed(0)} s, run seed ${RUN_SEED}, world ${WORLD}: ${problems.length} problem(s).`);
const seen = new Set();
for (const p of problems) {
  const key = p.error.split("\n")[0];
  if (seen.has(key)) continue;
  seen.add(key);
  console.log(`\n--- step ${p.step} (${p.kind}, during ${p.action}):\n${p.error}\n  recent:\n    ${p.recent.join("\n    ")}`);
}
await browser.close();
server.close();
process.exit(problems.length ? 1 : 0);
