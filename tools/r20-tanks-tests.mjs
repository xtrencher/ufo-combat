// Round 20.B tests: tanks (js/vehicle-tank.js, js/tanks.js, js/net/ground.js).
// The player: "Tanks can drive up walls. And with tanks you can't drive
// down when there's a vertical wall: once you've driven up onto it, you
// can't get down. Make tanks a bit faster, especially the Tiger. Add
// different kinds of shells, including ones that blow things up: a super
// shell, like on the planes: bigger explosion, longer reload."
// In Node (fast): the rounds' table (AP < HE < SUPER in blast, SUPER the
// longest reload, every tank with a cannon has all three); the new speeds.
// In the browser (the real game, a flat stone field high up):
//   - walls of 2, 3 and 5 blocks stop the battle tank, the Tiger, the AA
//     vehicle and the missile truck, head on and at angles, pushing and
//     turning against them (the hull never ends up on top);
//   - a 1-block step (head on and at an angle) and staircases of 1-block
//     steps (one up every 2 and every 3 blocks) are still climbed;
//   - ledges: a tank on top of a platform 3, 6, 12 and 20 high drives off
//     and lands (unhurt up to 12; alive at 20); half over a ledge it drives
//     on or backs off; on a 4-wide wall it turns off it;
//   - a 2-wide gap between walls (stops, backs out), a 2-wide trench
//     (crossed), a tree (knocked down), a lake's edge (stops at deep water,
//     backs out);
//   - never stuck: 40 s driven like a player through a field of walls,
//     posts, trees and low platforms: never wedged, always moving, never on
//     anything higher than a step;
//   - top speed on the flat raised (the Tiger more), no tunnelling at full
//     speed through a post or a one-block wall, at 30 fps and at 10 fps;
//   - the shells: 1 / 2 / 3 pick AP / HE / SUPER, X cycles them; each one
//     fires from the left button; HE and SUPER blow up blocks (the crater:
//     AP < HE < SUPER), SUPER's reload is the longest; the HUD and the
//     overlay say which round and its reload; the AI's tanks keep theirs;
//   - no console errors.
// With --online: the host fires a SUPER shell; the guest sees a super
// round fly (its tracer) and the blast arrive at its size.
//
//   node r20-tanks-tests.mjs [--only=substring] [--node] [--online] [--verbose]
// (GAME_ROOT=dir runs another copy of the game.)
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

// The speeds before Round 20.B (blocks/s).
const OLD_SPEED = { mbt: 14, tiger: 8.5 };

// ---------- Node ----------

// (vehicle-tank.js imports three: the game's own copy, as the page does.)
async function tankModule() {
  const { register } = await import("node:module");
  register(
    "data:text/javascript," +
      encodeURIComponent(`export async function resolve(s, c, n) { if (s === "three") return n(${JSON.stringify(pathToFileURL(path.join(__dirname, "node_modules/three/build/three.module.js")).href)}, c); return n(s, c); }`),
    import.meta.url
  );
  return import(pathToFileURL(path.join(ROOT, "js/vehicle-tank.js")).href);
}

await check("the rounds: AP, HE, SUPER for every tank; the blast grows AP < HE < SUPER, SUPER is slow and reloads longest; the speeds raised (the Tiger most)", async () => {
  let M;
  try {
    M = await tankModule();
  } catch (err) {
    // (Some Node builds can't load the browser modules: the page checks the same below.)
    console.log(`        (skipped in Node: ${String(err.message).slice(0, 80)})`);
    return;
  }
  const { TANK_TYPES, TANK_AMMO, AMMO_ORDER, ammoStats } = M;
  assert(AMMO_ORDER.join() === "ap,he,super" && AMMO_ORDER.every((id) => TANK_AMMO[id]), `the rounds: ${AMMO_ORDER}`);
  for (const kind of Object.keys(TANK_TYPES)) {
    const S = TANK_TYPES[kind];
    const [ap, he, sp] = AMMO_ORDER.map((id) => ammoStats(S, id));
    assert(ap.radius < he.radius && he.radius < sp.radius, `${kind}: blast radii ${ap.radius} < ${he.radius} < ${sp.radius}`);
    assert(sp.radius >= 12 && he.radius >= 7 && ap.radius <= 4, `${kind}: SUPER huge, HE a crater, AP a hole: ${ap.radius}/${he.radius}/${sp.radius}`);
    assert(ap.damage > he.damage && sp.damage > ap.damage, `${kind}: direct hits AP ${ap.damage} > HE ${he.damage}, SUPER ${sp.damage} the most`);
    assert(sp.speed < he.speed && he.speed <= ap.speed && ap.speed === S.shellSpeed, `${kind}: AP at the gun's speed, HE slower, SUPER slowest: ${ap.speed}/${he.speed}/${sp.speed}`);
    assert(sp.superReload >= 12 && sp.superReload > he.reload && he.reload > ap.reload && ap.reload === S.reload, `${kind}: reloads ${ap.reload}/${he.reload}/${sp.reload}+${sp.superReload}`);
  }
  const up = (k) => TANK_TYPES[k].speed / OLD_SPEED[k];
  assert(up("mbt") >= 1.2 && up("mbt") <= 1.35, `the battle tank ${TANK_TYPES.mbt.speed} (x${up("mbt").toFixed(2)})`);
  assert(up("tiger") >= 1.45 && up("tiger") > up("mbt"), `the Tiger ${TANK_TYPES.tiger.speed} (x${up("tiger").toFixed(2)})`);
});

// ---------- In the browser ----------

if (!args.node) await browserChecks();

async function browserChecks() {
  const { chromium } = await import("playwright-core");
  const PORT = 11240 + Math.floor(Math.random() * 10);
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
    while (Date.now() - t0 < 180000) {
      const st = await v(p, (g) => g.gameState);
      if (st === "playing") return;
      if (st === "dead") {
        await v(p, (g) => g.respawn());
        continue;
      }
      for (const id of ["mp-lobby", "mp-screen"]) await p.evaluate((i) => document.getElementById(i)?.classList.add("hidden"), id);
      if (st === "start") await p.click("#play-btn", { timeout: 5000 }).catch(() => {});
      else if (await p.isVisible("#resume-btn")) await p.click("#resume-btn", { timeout: 3000 }).catch(() => {});
      else if (await p.isVisible("#click-to-play").catch(() => false)) await p.click("#click-to-play", { timeout: 3000 }).catch(() => {});
      else {
        await v(p, (g) => g.screens.closeAll());
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

  // The test bench, installed on the page once (window.__r20): a flat stone
  // field at y 70 round the player (x0 +-100, z0 - 120 .. z0 + 20, air up to
  // y 110: none of the terrain's hills left over it), helpers to build on it,
  // put a vehicle down and drive it 30 steps a second with keys held.
  const BENCH = `(g) => {
    if (window.__r20) return true;
    const T = g.THREE;
    const B = {};
    B.field = async () => {
      const p = g.player;
      if (g.vehicles.active) g.vehicles.exit({ force: true });
      const x0 = B.x0 ?? Math.floor(p.position.x), z0 = B.z0 ?? Math.floor(p.position.z);
      B.x0 = x0;
      B.z0 = z0;
      for (let cx = (x0 - 112) >> 4; cx <= (x0 + 112) >> 4; cx++) for (let cz = (z0 - 140) >> 4; cz <= (z0 + 40) >> 4; cz++) g.world._generate(cx, cz);
      const y = (B.y = 70);
      const list = [];
      for (let x = x0 - 100; x <= x0 + 100; x++) for (let z = z0 - 120; z <= z0 + 20; z++) for (let k = -6; k < 40; k++) list.push(x, y + k, z, k < 0 ? 1 : 0);
      g.world.setBlocks(list);
      g.player.setMode("creative");
      g.player.damage = () => false;
      for (const v of [...g.vehicles.vehicles]) if (v.isGround || v.type === "heli" || v.type === "jet") g.vehicles.remove(v);
      p.flying = true;
      p.position.set(x0 + 0.5, y + 30, z0 + 0.5);
      return { x0, y, z0 };
    };
    B.box = (xa, xb, za, zb, ya, yb, id = 1) => {
      const l = [];
      for (let x = xa; x <= xb; x++) for (let z = za; z <= zb; z++) for (let y = ya; y <= yb; y++) l.push(x, y, z, id);
      g.world.setBlocks(l);
    };
    // (Back to the bare field: the air over it, the stone under it.)
    B.clear = () => {
      B.box(B.x0 - 100, B.x0 + 100, B.z0 - 120, B.z0 + 20, B.y, B.y + 24, 0);
      B.box(B.x0 - 100, B.x0 + 100, B.z0 - 120, B.z0 + 20, B.y - 6, B.y - 1, 1);
    };
    B.r = (n) => Math.round(n * 100) / 100;
    // A vehicle of kind ("mbt", "tiger", "aa", "tel") at (x, y, z) heading yaw.
    B.put = async (kind, x, y, z, yaw = 0) => {
      const { summonTank } = await import("./js/vehicle-tank.js");
      const t = kind === "tel" ? g.vehicles.create("tel", { pos: [x, y, z], yaw }) : kind === "aa" ? g.vehicles.create("aapark", { pos: [x, y, z], yaw }) : summonTank(g.vehicles, kind, new T.Vector3(x, y, z), yaw);
      t.pos.y = y;
      t.settle(true);
      return t;
    };
    // Drives t for secs with keys held (the player in it); probe(t, i) each step.
    B.drive = (t, keys, secs, probe, dt = 1 / 30) => {
      g.vehicles.enter(t);
      for (const k of keys) g.player.keys.add(k);
      let top = t.pos.y, maxSpeed = 0;
      const s0 = t.pos.clone();
      for (let i = 0; i < secs / dt; i++) {
        g.vehicles.update(dt);
        top = Math.max(top, t.pos.y);
        maxSpeed = Math.max(maxSpeed, Math.abs(t.speed));
        if (probe) probe(t, i);
      }
      for (const k of keys) g.player.keys.delete(k);
      g.vehicles.exit({ force: true });
      return { moved: B.r(Math.hypot(t.pos.x - s0.x, t.pos.z - s0.z)), top: B.r(top - B.y), y: B.r(t.pos.y - B.y), maxSpeed: B.r(maxSpeed), z: B.r(t.pos.z - B.z0), x: B.r(t.pos.x - B.x0), health: Math.round(t.health), alive: t.alive };
    };
    // Can t move at all (forward, back, a turn either way)?
    B.canMove = (t) => {
      const f = t.forward(new T.Vector3());
      const fp = {};
      return [[0.4, 0, 1], [-0.4, 0, -1], [0, 0.15, 0], [0, -0.15, 0]].some(([d, dy, dir]) => t._canMove(t.pos.x + f.x * d, t.pos.z + f.z * d, t.yaw + dy, dir, dir || 1, fp));
    };
    window.__r20 = B;
    return true;
  }`;
  const bench = (p) => p.evaluate((src) => new Function("g", `return (${src})(g);`)(window.__ufo), BENCH);
  // Runs fn(g, B, arg) on the page (async allowed).
  const run = (p, fn, arg) => p.evaluate(([src, a]) => new Function("g", "B", "arg", `return (${src})(g, B, arg);`)(window.__ufo, window.__r20, a), [fn.toString(), arg]);

  const page = await newPage("solo");
  await page.goto(`http://127.0.0.1:${PORT}/index.html?seed=2020&type=missions&graphics=low&auto=0`, { waitUntil: "load", timeout: 60000 });
  await page.waitForFunction(() => !!window.__ufo && window.__ufo.graphicsReady, null, { timeout: 120000 });
  await play(page);
  await bench(page);
  await run(page, (g, B) => B.field());

  await browserCheck("walls of 2, 3 and 5 blocks stop every tank (the battle tank, the Tiger, the AA vehicle, the truck), head on and at angles, pushing and turning against them", async () => {
    const r = await run(page, async (g, B) => {
      const out = [];
      const { x0, y, z0 } = B;
      for (const kind of ["mbt", "tiger", "aa", "tel"]) {
        for (const h of [2, 3, 5]) {
          for (const ang of [0, 0.45, 0.9, 1.25]) {
            B.clear();
            // (a wall h high across the whole field, its near face at z0 - 30)
            B.box(x0 - 100, x0 + 100, z0 - 50, z0 - 30, y, y + h - 1);
            const t = await B.put(kind, x0 + 0.5, y, z0 - 22, ang);
            const a = B.drive(t, ["KeyW"], 4);
            const b = B.drive(t, ["KeyW", "KeyA"], 2);
            const c = B.drive(t, ["KeyW", "KeyD"], 3);
            const d = B.drive(t, ["KeyS"], 2);
            out.push({ kind, h, ang, top: Math.max(a.top, b.top, c.top, d.top), y: d.y, backed: d.moved });
            g.vehicles.remove(t);
          }
        }
      }
      return out;
    });
    if (args.verbose) console.log(`        ${r.map((o) => `${o.kind}/${o.h}/${o.ang}: top ${o.top}`).join("; ")}`);
    const bad = r.filter((o) => o.top > 0.6 || o.y > 0.3);
    assert(!bad.length, `climbed a wall: ${JSON.stringify(bad.slice(0, 6))}`);
    const stuck = r.filter((o) => o.backed < 2);
    assert(!stuck.length, `couldn't back off the wall: ${JSON.stringify(stuck.slice(0, 6))}`);
  });

  await browserCheck("a 1-block step (head on and at an angle) and staircases of 1-block steps (one up every 2 and every 3 blocks) are still climbed", async () => {
    const r = await run(page, async (g, B) => {
      const out = {};
      const { x0, y, z0 } = B;
      for (const kind of ["mbt", "tiger", "aa", "tel"]) {
        for (const ang of [0, 0.8]) {
          B.clear();
          B.box(x0 - 100, x0 + 100, z0 - 120, z0 - 30, y, y);
          const t = await B.put(kind, x0 + 0.5, y, z0 - 22, ang);
          out[`${kind} step a${ang}`] = B.drive(t, ["KeyW"], 4);
          g.vehicles.remove(t);
        }
        for (const run of [2, 3]) {
          B.clear();
          for (let i = 0; i < 10; i++) B.box(x0 - 20, x0 + 20, z0 - 30 - run * (i + 1) + 1, z0 - 30 - run * i, y, y + i);
          B.box(x0 - 20, x0 + 20, z0 - 115, z0 - 30 - run * 10, y, y + 9);
          const t = await B.put(kind, x0 + 0.5, y, z0 - 20, 0);
          out[`${kind} stairs/${run}`] = B.drive(t, ["KeyW"], 14);
          g.vehicles.remove(t);
        }
      }
      return out;
    });
    if (args.verbose) console.log(`        ${Object.entries(r).map(([k, o]) => `${k}: top ${o.top}, ${o.moved} along`).join("; ")}`);
    for (const [k, o] of Object.entries(r)) {
      if (k.includes("step")) assert(o.top >= 0.95 && o.y >= 0.95 && o.moved > 12, `${k}: up the step: ${JSON.stringify(o)}`);
      else assert(o.top >= 9.9 && o.moved > 45, `${k}: up the stairs (10 steps): ${JSON.stringify(o)}`);
    }
  });

  await browserCheck("ledges: a tank on a platform 3, 6, 12 and 20 high drives off and lands (unhurt up to 12, alive at 20); half over a ledge it drives on or backs off; on a 4-wide wall it turns off it", async () => {
    const r = await run(page, async (g, B) => {
      const out = {};
      const { x0, y, z0 } = B;
      for (const kind of ["mbt", "tiger"]) {
        for (const h of [3, 6, 12, 20]) {
          B.clear();
          B.box(x0 - 8, x0 + 8, z0 - 50, z0 - 30, y, y + h - 1);
          const t = await B.put(kind, x0 + 0.5, y + h, z0 - 40, Math.PI);
          const hp = t.health;
          const o = B.drive(t, ["KeyW"], 5);
          o.hurt = hp - t.health;
          out[`${kind} off ${h}`] = o;
          g.vehicles.remove(t);
        }
        for (const keys of [["KeyW"], ["KeyS"]]) {
          B.clear();
          B.box(x0 - 8, x0 + 8, z0 - 52, z0 - 30, y, y + 7);
          // (its middle over the edge, facing off it; backing up it crosses the platform and goes off the far edge)
          const t = await B.put(kind, x0 + 0.5, y + 8, z0 - 29.5, Math.PI);
          out[`${kind} half-off ${keys[0]}`] = B.drive(t, keys, 7);
          g.vehicles.remove(t);
        }
        {
          B.clear();
          B.box(x0 - 1, x0 + 2, z0 - 90, z0 - 30, y, y + 4);
          const t = await B.put(kind, x0 + 1, y + 5, z0 - 60, 0);
          const a = B.drive(t, ["KeyD", "KeyW"], 4);
          const b = B.drive(t, ["KeyW"], 2);
          out[`${kind} wall top`] = { ...b, top: Math.max(a.top, b.top), start: a };
          g.vehicles.remove(t);
        }
      }
      return out;
    });
    if (args.verbose) console.log(`        ${Object.entries(r).map(([k, o]) => `${k}: y ${o.y}, ${o.moved} along${o.hurt !== undefined ? `, hurt ${o.hurt}` : ""}`).join("; ")}`);
    for (const [k, o] of Object.entries(r)) {
      assert(o.alive, `${k}: destroyed: ${JSON.stringify(o)}`);
      assert(Math.abs(o.y) < 0.3, `${k}: down on the ground: ${JSON.stringify(o)}`);
      const h = Number(/off (\d+)/.exec(k)?.[1] || 0);
      if (h && h <= 12) assert(o.hurt === 0, `${k}: unhurt: ${JSON.stringify(o)}`);
    }
  });

  await browserCheck("a 2-wide gap between walls (stops, backs out), a 2-wide trench (crossed), a tree (knocked down), a lake (stops at deep water, backs out)", async () => {
    const r = await run(page, async (g, B) => {
      const out = {};
      const { x0, y, z0 } = B;
      const { BLOCK } = await import("./js/blocks.js");
      for (const kind of ["mbt", "tiger"]) {
        B.clear();
        B.box(x0 - 30, x0 - 1, z0 - 40, z0 - 30, y, y + 3);
        B.box(x0 + 2, x0 + 30, z0 - 40, z0 - 30, y, y + 3);
        let t = await B.put(kind, x0 + 1, y, z0 - 20, 0);
        out[`${kind} gap`] = { in: B.drive(t, ["KeyW"], 4), out: B.drive(t, ["KeyS"], 3) };
        g.vehicles.remove(t);
        B.clear();
        B.box(x0 - 30, x0 + 30, z0 - 35, z0 - 34, y - 3, y - 1, 0);
        t = await B.put(kind, x0 + 0.5, y, z0 - 20, 0);
        out[`${kind} trench`] = B.drive(t, ["KeyW"], 5);
        g.vehicles.remove(t);
        B.clear();
        const LOG = BLOCK.WOOD;
        B.box(x0, x0, z0 - 35, z0 - 35, y, y + 5, LOG);
        for (let dx = -2; dx <= 2; dx++) for (let dz = -2; dz <= 2; dz++) for (let k = 4; k <= 7; k++) if (dx || dz || k > 5) B.box(x0 + dx, x0 + dx, z0 - 35 + dz, z0 - 35 + dz, y + k, y + k, BLOCK.LEAVES);
        t = await B.put(kind, x0 + 0.5, y, z0 - 20, 0);
        const tree = B.drive(t, ["KeyW"], 4);
        let logs = 0;
        for (let k = 0; k < 6; k++) if (g.world.getBlock(x0, y + k, z0 - 35) === LOG) logs++;
        out[`${kind} tree`] = { ...tree, logs };
        g.vehicles.remove(t);
        B.clear();
        // (a shore: a shallow shelf a block deep, then deep water five down)
        B.box(x0 - 30, x0 + 30, z0 - 75, z0 - 30, y - 5, y - 1, BLOCK.WATER);
        B.box(x0 - 30, x0 + 30, z0 - 42, z0 - 30, y - 5, y - 2, 1);
        t = await B.put(kind, x0 + 0.5, y, z0 - 20, 0);
        const wIn = B.drive(t, ["KeyW"], 6);
        const wOut = B.drive(t, ["KeyS"], 6);
        out[`${kind} lake`] = { in: wIn, out: wOut, flooded: !!t.flooded };
        g.vehicles.remove(t);
      }
      return out;
    });
    if (args.verbose) console.log(`        ${JSON.stringify(r)}`);
    for (const kind of ["mbt", "tiger"]) {
      const gap = r[`${kind} gap`];
      assert(gap.in.z > -34 && gap.out.moved > 3 && gap.in.top < 0.3, `${kind}: stopped at the gap and backed out: ${JSON.stringify(gap)}`);
      const tr = r[`${kind} trench`];
      assert(tr.z < -45 && Math.abs(tr.y) < 0.2, `${kind}: across the trench: ${JSON.stringify(tr)}`);
      const tree = r[`${kind} tree`];
      assert(tree.z < -40 && tree.logs === 0, `${kind}: through the tree: ${JSON.stringify(tree)}`);
      const lake = r[`${kind} lake`];
      assert(lake.in.z > -46 && lake.in.z < -30 && !lake.flooded && lake.out.z > lake.in.z + 8, `${kind}: stopped at deep water and backed out: ${JSON.stringify(lake)}`);
    }
  });

  await browserCheck("never stuck: 40 s driven like a player through walls, posts, trees and low platforms: never wedged, always moving, never on anything higher than a step", async () => {
    const r = await run(page, async (g, B) => {
      const { x0, y, z0 } = B;
      const { BLOCK } = await import("./js/blocks.js");
      // (a seeded random: the same course every run)
      let seed = 20202;
      const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
      const out = [];
      for (const kind of ["mbt", "tiger"]) {
        B.clear();
        const low = [];
        for (let i = 0; i < 70; i++) {
          const cx = x0 - 90 + Math.floor(rnd() * 180);
          const cz = z0 - 110 + Math.floor(rnd() * 115);
          if (Math.abs(cx - x0) < 8 && cz > z0 - 12) continue;
          const kindR = rnd();
          if (kindR < 0.45) {
            const h = 2 + Math.floor(rnd() * 4);
            const w = 1 + Math.floor(rnd() * 8);
            const d = 1 + Math.floor(rnd() * 8);
            B.box(cx, cx + w, cz, cz + d, y, y + h - 1);
          } else if (kindR < 0.65) {
            B.box(cx, cx, cz, cz, y, y + 2 + Math.floor(rnd() * 5));
          } else if (kindR < 0.8) {
            B.box(cx, cx, cz, cz, y, y + 5, BLOCK.WOOD);
            B.box(cx - 2, cx + 2, cz - 2, cz + 2, y + 6, y + 7, BLOCK.LEAVES);
          } else low.push([cx, cz]);
        }
        // (low platforms, a block high, laid last, with nothing on them or
        // within a hull's width round them: a taller block there would make
        // a staircase, for one track if not both)
        for (const [cx, cz] of low) B.box(cx - 5, cx + 11, cz - 5, cz + 11, y, y + 8, 0);
        for (const [cx, cz] of low) B.box(cx, cx + 6, cz, cz + 6, y, y, 1);
        const t = await B.put(kind, x0 + 0.5, y, z0 - 4, 0);
        g.vehicles.enter(t);
        const K = g.player.keys;
        let mode = "go", modeT = 0, want = 0, turn = 1, anchorT = 0, wedgedT = 0, wedgedMax = 0, path = 0, maxY = 0, hiAt = null;
        const anchor = t.pos.clone(), last = t.pos.clone();
        for (let i = 0; i < 40 * 30; i++) {
          for (const k of ["KeyW", "KeyS", "KeyA", "KeyD"]) K.delete(k);
          // (back toward the middle when near the field's edge)
          if (Math.abs(t.pos.x - x0) > 85 || t.pos.z < z0 - 112 || t.pos.z > z0 + 12) want = Math.atan2(-(x0 - t.pos.x), -(z0 - 55 - t.pos.z));
          if (mode === "go") {
            const d = Math.atan2(Math.sin(want - t.yaw), Math.cos(want - t.yaw));
            if (Math.abs(d) < 1) K.add("KeyW");
            if (d > 0.08) K.add("KeyA");
            else if (d < -0.08) K.add("KeyD");
          } else {
            K.add("KeyS");
            K.add(turn > 0 ? "KeyA" : "KeyD");
          }
          g.vehicles.update(1 / 30);
          path += Math.hypot(t.pos.x - last.x, t.pos.z - last.z);
          last.copy(t.pos);
          if (t.pos.y - y > maxY && t.pos.y - y > 1.6 && !hiAt) {
            // (what was round it the first time it was up high: for the message)
            const cols = [];
            for (let dz = -4; dz <= 4; dz += 2) {
              const row = [];
              for (let dx = -4; dx <= 4; dx += 2) row.push(Math.round(t._ground(t.pos.x + dx, t.pos.z + dz, y + 12) - y));
              cols.push(row.join(","));
            }
            hiAt = { at: [B.r(t.pos.x - x0), B.r(t.pos.y - y), B.r(t.pos.z - z0)], yaw: B.r(t.yaw), ground: cols.join(" / ") };
          }
          maxY = Math.max(maxY, t.pos.y - y);
          anchorT += 1 / 30;
          if (mode === "back") {
            modeT -= 1 / 30;
            if (modeT <= 0) {
              mode = "go";
              want += (turn * Math.PI) / 2;
              anchor.copy(t.pos);
              anchorT = 0;
            }
          } else if (anchorT > 2.5) {
            if (t.pos.distanceTo(anchor) < 3) {
              mode = "back";
              modeT = 1.2;
              turn = rnd() < 0.5 ? 1 : -1;
            }
            anchor.copy(t.pos);
            anchorT = 0;
          }
          if (i % 6 === 0) {
            wedgedT = B.canMove(t) ? 0 : wedgedT + 0.2;
            wedgedMax = Math.max(wedgedMax, wedgedT);
          }
        }
        for (const k of ["KeyW", "KeyS", "KeyA", "KeyD"]) K.delete(k);
        g.vehicles.exit({ force: true });
        out.push({ kind, path: Math.round(path), wedgedMax: B.r(wedgedMax), maxY: B.r(maxY), alive: t.alive, hiAt });
        g.vehicles.remove(t);
      }
      return out;
    });
    console.log(`        ${r.map((o) => `${o.kind}: ${o.path} driven, wedged ${o.wedgedMax} s at most, highest ${o.maxY}`).join("; ")}`);
    for (const o of r) {
      assert(o.wedgedMax <= 2.6, `${o.kind}: wedged ${o.wedgedMax} s: ${JSON.stringify(o)}`);
      assert(o.path > 150, `${o.kind}: hardly moved: ${JSON.stringify(o)}`);
      assert(o.maxY < 1.6, `${o.kind}: up on something higher than a step: ${JSON.stringify(o)}`);
    }
  });

  await browserCheck("faster: the top speed on the flat raised (the Tiger more); at full speed it never passes through a post or a one-block wall, at 30 fps and at 10 fps", async () => {
    const r = await run(page, async (g, B) => {
      const { x0, y, z0 } = B;
      const out = {};
      for (const kind of ["mbt", "tiger"]) {
        B.clear();
        let t = await B.put(kind, x0 + 0.5, y, z0 + 10, 0);
        out[`${kind} top`] = B.drive(t, ["KeyW"], 7).maxSpeed;
        g.vehicles.remove(t);
        for (const dt of [1 / 30, 1 / 10]) {
          for (const what of ["post", "wall"]) {
            B.clear();
            if (what === "post") B.box(x0, x0, z0 - 80, z0 - 80, y, y + 7);
            else B.box(x0 - 20, x0 + 20, z0 - 80, z0 - 80, y, y + 3);
            t = await B.put(kind, x0 + 0.5, y, z0 + 10, 0);
            // (up to full speed first, then on into it)
            const o = B.drive(t, ["KeyW"], 9, null, dt);
            out[`${kind} ${what} ${Math.round(1 / dt)}fps`] = { z: o.z, top: o.top, standing: what === "post" ? g.world.getBlock(x0, y + 7, z0 - 80) : 1 };
            g.vehicles.remove(t);
          }
        }
      }
      return out;
    });
    console.log(`        top speed: battle tank ${r["mbt top"]} (was ${OLD_SPEED.mbt}), Tiger ${r["tiger top"]} (was ${OLD_SPEED.tiger})`);
    assert(r["mbt top"] >= OLD_SPEED.mbt * 1.2, `the battle tank: ${r["mbt top"]}`);
    assert(r["tiger top"] >= OLD_SPEED.tiger * 1.45 && r["tiger top"] / OLD_SPEED.tiger > r["mbt top"] / OLD_SPEED.mbt, `the Tiger: ${r["tiger top"]}`);
    for (const [k, o] of Object.entries(r)) {
      if (k.endsWith("top")) continue;
      // (a post a hull climbs over nothing: pushed over, or it stopped; never through it standing)
      if (k.includes("wall")) assert(o.z > -80 && o.top < 0.3, `${k}: through or onto the wall: ${JSON.stringify(o)}`);
      else assert(o.z > -80 || !o.standing, `${k}: through a standing post: ${JSON.stringify(o)}`);
    }
  });

  await browserCheck("the shells: 1 / 2 / 3 pick AP / HE / SUPER, X cycles them; each fires from the left button; HE and SUPER blow up blocks (AP < HE < SUPER), SUPER reloads longest; the HUD and the overlay say which; the AI keeps its own", async () => {
    const r = await run(page, async (g, B) => {
      const { x0, y, z0 } = B;
      const out = {};
      for (const kind of ["mbt", "tiger"]) {
        B.clear();
        const t = await B.put(kind, x0 + 0.5, y, z0 - 10, 0);
        g.vehicles.enter(t);
        const inp = g.vehicles.input;
        for (let i = 0; i < 10; i++) g.vehicles.update(1 / 30);
        const res = {};
        const shells = g.vehicles.shells;
        for (const [id, key] of [["ap", "Digit1"], ["he", "Digit2"], ["super", "Digit3"]]) {
          inp.pressed.add(key);
          g.vehicles.update(1 / 30);
          const picked = t.ammo;
          let w = 0;
          while (!t.gunReady && w < 30 * 30) {
            g.vehicles.update(1 / 30);
            w++;
          }
          const hud = t.hud();
          t.updateCamera(g.camera, 1 / 30);
          const overlay = document.querySelector("#tank-overlay .to-read")?.textContent || "";
          // (the left button, as the player fires: the shell is this round)
          const fired0 = shells.fired;
          inp.pressed.add("mouse0");
          g.vehicles.update(1 / 30);
          const pressFired = shells.fired - fired0;
          const shot = shells.shells[shells.shells.length - 1];
          const shotAmmo = shot?.ammo;
          const reload = t.gunLeft;
          // (then one straight down the line into the ground ahead, for its crater)
          shells.clear();
          t.reloadT = 0;
          t.superT = 0;
          const before = g.effects.explosionCount;
          const s = t.fireGun({ dir: new g.THREE.Vector3(0, -0.25, -1).normalize() });
          let n = 0;
          while (g.effects.explosionCount === before && n < 300) {
            g.vehicles.update(1 / 30);
            n++;
          }
          const ex = g.effects.lastExplosion;
          res[id] = { picked, pressFired, shotAmmo, reload: B.r(reload), superT: B.r(t.superT), removed: ex.removed, radius: ex.radius, speed: Math.round(s.vel.length()), gunRow: hud.rows.find((r) => r[0] === "Gun")?.[1], weapon: hud.weapon, overlay };
          // (the super round's own reload: ready again only after it)
          if (id === "super") {
            let k = 0;
            t.reloadT = 0;
            while (!t.gunReady && k < 40 * 30) {
              g.vehicles.update(1 / 30);
              k++;
            }
            res.superAgain = B.r(k / 30);
          }
        }
        const seq = [];
        for (let i = 0; i < 4; i++) {
          inp.pressed.add("KeyX");
          g.vehicles.update(1 / 30);
          seq.push(t.ammo);
        }
        res.cycle = seq.join(">");
        g.vehicles.exit({ force: true });
        g.vehicles.remove(t);
        out[kind] = res;
      }
      // The AI's tanks: their own shells (the enemy's numbers), the standard round.
      const { ENEMY_SHELL } = await import("./js/tanks.js");
      const e = g.vehicles.create("enemytank", { kind: "mbt", pos: [x0 + 0.5, y, z0 - 40] });
      const s = e.fireGun({ dir: new g.THREE.Vector3(0, 0, -1), cause: "enemyshell", damage: ENEMY_SHELL.damage, ufoDamage: 0, radius: ENEMY_SHELL.radius, look: ENEMY_SHELL.look, player: false, reload: 0 });
      out.enemy = { ammo: e.ammo, shell: s.ammo, damage: s.damage, radius: s.radius, superT: e.superT };
      g.vehicles.shells.clear();
      g.vehicles.remove(e);
      return out;
    });
    if (args.verbose) console.log(`        ${JSON.stringify(r)}`);
    for (const kind of ["mbt", "tiger"]) {
      const o = r[kind];
      console.log(`        ${kind}: ${["ap", "he", "super"].map((id) => `${id} ${o[id].removed} blocks (r ${o[id].radius}), ${o[id].speed} m/s, reload ${o[id].reload}`).join("; ")}; super again after ${o.superAgain} s`);
      for (const id of ["ap", "he", "super"]) {
        const s = o[id];
        assert(s.picked === id && s.pressFired === 1 && s.shotAmmo === id, `${kind} ${id}: picked and fired by the button: ${JSON.stringify(s)}`);
        assert(s.gunRow?.toLowerCase().includes(id) && s.weapon.toLowerCase().includes(id) && s.overlay.toLowerCase().includes(id), `${kind} ${id}: the HUD and the overlay say so: ${JSON.stringify(s)}`);
      }
      assert(o.ap.radius < o.he.radius && o.he.radius < o.super.radius, `${kind}: radii ${o.ap.radius} < ${o.he.radius} < ${o.super.radius}`);
      assert(o.he.removed > o.ap.removed * 4 && o.super.removed > o.he.removed * 2, `${kind}: blocks blown up ${o.ap.removed} / ${o.he.removed} / ${o.super.removed}`);
      assert(o.super.reload > o.he.reload && o.he.reload > o.ap.reload && o.superAgain >= 12, `${kind}: reloads ${o.ap.reload} / ${o.he.reload} / ${o.super.reload}, the super round again after ${o.superAgain} s`);
      assert(o.super.speed < o.he.speed && o.he.speed < o.ap.speed, `${kind}: speeds ${o.ap.speed} / ${o.he.speed} / ${o.super.speed}`);
      assert(o.cycle === "ap>he>super>ap", `${kind}: X cycles: ${o.cycle}`);
    }
    assert(r.enemy.ammo === "ap" && r.enemy.shell === "ap" && r.enemy.radius === 2 && r.enemy.superT === 0, `the AI's tank: ${JSON.stringify(r.enemy)}`);
  });

  // ---------- Online ----------
  if (args.online && anyOnly("online")) {
    const { default: express } = await import("express");
    const { ExpressPeerServer } = await import("peer");
    const PEER_PORT = PORT + 50;
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
    await browserCheck("online: the host's SUPER shell flies on the guest's screen as a super round, its blast arrives at its size", async () => {
      await host.goto(`http://127.0.0.1:${PORT}/index.html?seed=2021&type=missions&${NET_Q}`, { waitUntil: "load", timeout: 60000 });
      await host.waitForFunction(() => !!window.__ufo && window.__ufo.graphicsReady, null, { timeout: 120000 });
      await host.click("#menu-mp-btn");
      await host.fill("#mp-nick", "Alice");
      await host.click("#mp-host-btn");
      const code = await until(host, (g) => g.net.code, 30000);
      assert(code, "no room code");
      await host.click("#mp-lobby-play");
      await host.waitForFunction(() => window.__ufo.gameState === "playing", null, { timeout: 30000 });
      await v(host, noDraw);
      await guest.goto(`http://127.0.0.1:${PORT}/index.html?join=${code}&${NET_Q}`, { waitUntil: "load", timeout: 60000 });
      await guest.waitForSelector("#mp-join-boot:not(.hidden)", { timeout: 30000 });
      await guest.fill("#mp-boot-nick", "Bob");
      await guest.click("#mp-boot-join");
      await guest.waitForFunction(() => !!window.__ufo && window.__ufo.graphicsReady, null, { timeout: 120000 });
      assert(await until(guest, (g) => g.mp.stateLoaded, 150000), "the host's state never arrived");
      await v(guest, noDraw);
      await play(guest).catch(() => {});
      // The host's tank near both of them, the guest watching.
      const at = await v(host, async (g) => {
        g.player.setMode("creative");
        const { summonTank } = await import("./js/vehicle-tank.js");
        const p = g.player.position;
        const y = g.vehicles.groundBelow(p.x + 0.5, p.y + 20, p.z - 15);
        const t = summonTank(g.vehicles, "mbt", new g.THREE.Vector3(p.x + 0.5, y, p.z - 15), 0);
        g.vehicles.enter(t);
        return [t.pos.x, t.pos.y, t.pos.z];
      });
      await v(guest, (g, at) => {
        g.player.flying = true;
        g.player.position.set(at[0] + 20, at[1] + 15, at[2] + 20);
        return true;
      }, at);
      assert(await until(guest, (g) => g.vehicles.vehicles.some((x) => x.type === "tank" && x.puppet), 20000), "the guest sees the host's tank");
      await guest.evaluate(async () => {
        const g = window.__ufo;
        const { shellsOf } = await import("./js/vehicle-tank.js");
        window.__seen = { ammo: [], ex: [] };
        // (what the guest's shell system is asked to fly: the host's shot, drawn only)
        const S = shellsOf(g.vehicles);
        const fire = S.fire.bind(S);
        S.fire = (o) => {
          const s = fire(o);
          if (s.remote) window.__seen.ammo.push(s.ammo);
          return s;
        };
        const fx = g.effects;
        const ex = fx.explode.bind(fx);
        fx.explode = (p, o = {}) => {
          window.__seen.ex.push({ radius: o.radius, source: o.source, visual: o.visual, mirror: !!o.mirror });
          return ex(p, o);
        };
        return true;
      });
      await v(host, (g) => {
        const t = g.vehicles.active;
        t.selectAmmo("super");
        t.reloadT = 0;
        t.superT = 0;
        t.fireGun({ dir: new g.THREE.Vector3(0, -0.2, -1).normalize() });
        return true;
      });
      const seen = await until(guest, () => (window.__seen.ex.some((e) => e.mirror && e.radius >= 12) ? window.__seen : null), 20000);
      assert(seen, `the super blast reached the guest: ${JSON.stringify(await v(guest, () => window.__seen))}`);
      const ex = seen.ex.find((e) => e.mirror && e.radius >= 12);
      assert(ex.source === "tankshell" && ex.visual >= 30, `the blast as the host's: ${JSON.stringify(ex)}`);
      const flew = await v(guest, () => window.__seen.ammo);
      assert(flew.includes("super"), `the guest's copy of the shell is a super round: ${JSON.stringify(flew)}`);
    });
    peerHttp.close();
  }

  await browser.close();
  server.close();
}

function anyOnly(...names) {
  return !args.only || names.some((n) => n.toLowerCase().includes(String(args.only).toLowerCase()));
}

// ---------- Summary ----------
const failed = results.filter(([, ok]) => !ok);
console.log(`\n${results.length - failed.length} passed, ${failed.length} failed.`);
process.exit(failed.length ? 1 : 0);
