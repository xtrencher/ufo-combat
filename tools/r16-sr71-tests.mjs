// Round 16: the SR-71 Blackbird (js/sr71-model.js, js/sr71-shape.js).
// Node: its type (unarmed, the fastest, slow to turn, a higher ceiling), its
// hit shape, the Creative item. In the browser (Creative):
// - the "SR-71" call-in puts you in one in the air; its model builds (a
//   sensible triangle count) with its flames, heat and controls;
// - flown level with the afterburner, high up, it is far faster than the
//   F-22 (and past Mach 3); the right button takes a recon photo (no
//   missile, no errors); the HUD and the info panel work for a jet with no
//   weapons;
// - its takeoff roll on a flat field is longer than the F-22's;
// - flown into the ground it crashes;
// - no console errors throughout.
//
//   node r16-sr71-tests.mjs [--only=substring]
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
const imp = (rel) => import(pathToFileURL(path.join(ROOT, rel)).href);

// ---------- Node ----------

await check("the type: unarmed, the fastest, slow to turn and roll, a long roll, a higher ceiling", async () => {
  const S = await imp("js/sr71-shape.js");
  // (vehicle-jet.js needs three: read its table's line instead.)
  const src = fs.readFileSync(path.join(ROOT, "js/vehicle-jet.js"), "utf8");
  const line = src.split("\n").find((l) => l.trim().startsWith("sr71: {"));
  assert(line, "JET_TYPES.sr71");
  const num = (k) => Number(new RegExp(`\\b${k}: ([\\d.]+)`).exec(line)?.[1]);
  assert(/name: "SR-71 Blackbird"/.test(line) && /Mach 3 reconnaissance jet/.test(line), "its name");
  assert(num("speed") >= 1.8 && num("mach") >= 3 && num("turn") < 0.7 && num("roll") < 0.7 && num("stall") > 1, line);
  assert(num("cannonRate") === 0 && /nuke: false/.test(line) && /recon: true/.test(line) && /missiles: false/.test(line), "unarmed");
  assert(num("ceiling") > 1.5 && 2000 * num("ceiling") < 6000, "a higher ceiling, below the space line");
  assert(Math.abs(S.SR71_LENGTH / S.K - 32.7) < 0.05 && Math.abs(S.SR71_SPAN / S.K - 16.94) < 0.05, "the real proportions");
  assert(S.SR71_LENGTH > 15.2 * 1.6, "much longer than the F-22");
  // The leading edge's sweep (52 degrees).
  const sweep = (Math.atan2(S.TIP_LE - S.OUT_ROOT[1], S.TIP_X - S.OUT_ROOT[0]) * 180) / Math.PI;
  assert(Math.abs(sweep - 52) < 0.5, `sweep ${sweep}`);
});

await check("the hit shape: the nose, the wingtip, the fin are hit; beside the nose is a miss", async () => {
  const H = await imp("js/hitboxes.js");
  const S = await imp("js/sr71-shape.js");
  const s = H.hullShape("sr71");
  assert(s && s.parts.length > 20, "built");
  const pos = { x: 0, y: 0, z: 0 };
  const q = { x: 0, y: 0, z: 0, w: 1 };
  const down = { x: 0, y: -1, z: 0 };
  const ray = (x, z) => H.hullRay(s, pos, q, { x, y: 30, z }, down, 60);
  const [, , zn] = S.toModel(0, 0, 1.5);
  const [xt, , zt] = S.toModel(S.TIP_X - 0.2, 0, (S.TIP_LE + S.TIP_TE) / 2);
  const [xf, , zf] = S.toModel(S.XN - 0.5, 0, 29.6);
  assert(ray(0, zn) > 0, "the nose");
  assert(ray(xt, zt) > 0, "the wingtip");
  assert(ray(xf, zf) > 0 && ray(xf, zf) < 29, "the fin (above the wing)");
  assert(ray(3.5, zn + 3) < 0, "beside the nose");
});

await check("the Creative item: the Vehicles tab's SR-71", async () => {
  const V = await imp("js/content/vehicles.js");
  assert(V.items[V.SR71_ITEM]?.vehicle === "sr71" && V.items[V.SR71_ITEM].name === "SR-71 Blackbird" && typeof V.icons.vehicle_sr71 === "function", "the item");
  const html = fs.readFileSync(path.join(ROOT, "index.html"), "utf8");
  assert(/data-callin="sr71"/.test(html), "the call-in button");
});

// ---------- Browser ----------

const { chromium } = await import("playwright-core");
const PORT = 9930 + Math.floor(Math.random() * 40);
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
const ctx = await browser.newContext({ viewport: { width: 960, height: 540 } });
const page = await ctx.newPage();
const localThreeRoot = path.join(__dirname, "node_modules", "three");
await page.route("https://cdn.jsdelivr.net/npm/three@0.160.0/**", (route) => {
  const rel = new URL(route.request().url()).pathname.replace("/npm/three@0.160.0/", "");
  route.fulfill({ path: path.join(localThreeRoot, rel), contentType: "text/javascript" });
});
page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
page.on("pageerror", (e) => errors.push(String(e)));
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

// A flat stone field at y 70, 60 wide and 700 long (north), round the player.
const FIELD = `async (g) => {
  const p = g.player;
  const x0 = Math.floor(p.position.x), z0 = Math.floor(p.position.z);
  const y = 70;
  for (let z = z0 - 700; z <= z0 + 20; z += 16) g.world.prepareArea(x0, z, 2); // (generated: far chunks too)
  const list = [];
  for (let x = x0 - 30; x <= x0 + 30; x++) for (let z = z0 - 700; z <= z0 + 20; z++) for (let k = -2; k < 24; k++) list.push(x, y + k, z, k < 0 ? 1 : 0);
  g.world.setBlocks(list);
  return { x0, y, z0 };
}`;

await browserCheck("boot: a Survival world in Creative", async () => {
  await page.goto(`http://127.0.0.1:${PORT}/index.html?seed=7171&type=survival&graphics=low`, { waitUntil: "load", timeout: 60000 });
  await page.waitForFunction(() => !!window.__ufo && window.__ufo.graphicsReady, null, { timeout: 120000 });
  await play();
  await v((g) => g.player.setMode("creative"));
});

await browserCheck("the SR-71 call-in: in the air at the controls; the model, the HUD and the info panel", async () => {
  const r = await v(async (g) => {
    const ok = g.mp.game.callIn("sr71");
    const j = g.vehicles.active;
    for (let i = 0; i < 20; i++) g.vehicles.update(1 / 30);
    const { sr71Triangles } = await import("./js/sr71-model.js");
    const hud = j.hud();
    const info = j.infoPanel();
    let meshes = 0;
    j.root.traverse((o) => o.isMesh && meshes++);
    return { ok, type: j?.jetType, air: !j.onGround, tris: sr71Triangles(), meshes, title: hud.title, weapon: hud.weapon, rows: hud.rows.map((r) => r[0]), info: info.title, hull: !!j.hull, button: !!document.querySelector('#pause-callins [data-callin="sr71"]') };
  });
  assert(r.ok && r.type === "sr71" && r.air && r.button, JSON.stringify(r));
  assert(r.tris > 3000 && r.tris < 40000, `triangles: ${r.tris}`);
  assert(r.hull && r.meshes > 8, JSON.stringify(r));
  assert(/Unarmed/.test(r.weapon) && r.rows.includes("Camera") && !r.rows.includes("Missile") && /reconnaissance/.test(r.info), JSON.stringify(r));
  await frames(6);
});

await browserCheck("flown level high up with the afterburner, it is far faster than the F-22 (past Mach 3); the camera takes a photo, no missile", async () => {
  const r = await v(async (g) => {
    const { MACH1 } = await import("./js/air-fx.js");
    const fly = (jetType, h = 2000) => {
      const j = g.vehicles.create("jet", { jetType, pos: [g.player.position.x, h, g.player.position.z], yaw: 0, airborne: true, speed: 250, throttle: 1 });
      g.vehicles.enter(j);
      g.player.keys.add("ShiftLeft");
      let top = 0;
      for (let i = 0; i < 30 * 60; i++) {
        j.pos.y = h; // (held at this height: level flight)
        j.vel.y = 0;
        j.throttle = 1;
        g.vehicles.update(1 / 30);
        top = Math.max(top, j.speed);
      }
      g.player.keys.delete("ShiftLeft");
      const out = { top, ab: j.afterburner, mach: top / MACH1, missiles: j.missiles.length };
      return { j, out };
    };
    // (Low down first: y 200, the thick air.)
    const low = {};
    for (const t of ["f22", "sr71"]) {
      const x = fly(t, 200);
      low[t] = x.out.top;
      g.vehicles.exit({ force: true });
      g.vehicles.remove(x.j);
    }
    const a = fly("f22");
    g.vehicles.exit({ force: true });
    g.vehicles.remove(a.j);
    const b = fly("sr71");
    // A right click: a recon photo.
    const msgs = [];
    const say = g.vehicles.onMessage;
    g.vehicles.onMessage = (t) => msgs.push(t);
    g.vehicles.input.pressed.add("mouse2");
    b.j._weapons(1 / 30, g.vehicles.input);
    g.vehicles.input.pressed.delete("mouse2");
    g.vehicles.onMessage = say;
    const missiles = b.j.missiles.length;
    const shots = b.j.reconShots;
    return { low, f22: a.out, sr71: b.out, msgs, missiles, shots, hud: b.j.hud().rows.find((r) => r[0] === "Camera")?.[1] };
  });
  console.log(`    F-22 ${Math.round(r.f22.top * 3.6)} km/h (M ${r.f22.mach.toFixed(2)}), SR-71 ${Math.round(r.sr71.top * 3.6)} km/h (M ${r.sr71.mach.toFixed(2)})`);
  console.log(`    low down: F-22 ${Math.round(r.low.f22 * 3.6)} km/h, SR-71 ${Math.round(r.low.sr71 * 3.6)} km/h`);
  assert(r.low.sr71 > r.low.f22 * 1.3, JSON.stringify(r.low));
  assert(r.sr71.ab && r.sr71.top > r.f22.top * 2 && r.sr71.mach > 2.9, JSON.stringify(r));
  assert(r.shots === 1 && r.missiles === 0 && r.msgs.some((m) => /RECON/.test(m)), JSON.stringify(r));
  await frames(4);
});

await browserCheck("its takeoff roll is longer than the F-22's", async () => {
  if (await v((g) => !!g.vehicles.active)) await v((g) => g.vehicles.exit({ force: true }));
  const f = await page.evaluate((src) => new Function("g", `return (${src})(g);`)(window.__ufo), FIELD);
  const r = await v((g, f) => {
    const roll = (jetType) => {
      const j = g.vehicles.create("jet", { jetType, pos: [f.x0 + 0.5, f.y + 1 + 3, f.z0 + 0.5], yaw: 0 });
      j.pos.y = f.y + j.gearH;
      g.vehicles.enter(j);
      j.throttle = 1;
      g.player.keys.add("KeyW");
      let dist = null;
      for (let i = 0; i < 30 * 40 && dist === null; i++) {
        j.aimPitch = 0.2; // (pull for the rotation)
        g.vehicles.update(1 / 30);
        if (!j.onGround && j.pos.y > f.y + j.gearH + 2) dist = f.z0 + 0.5 - j.pos.z;
      }
      g.player.keys.delete("KeyW");
      const dbg = { alive: j.alive, ground: j.onGround, speed: j.speed, rolled: f.z0 + 0.5 - j.pos.z, y: j.pos.y - f.y, why: j.crashWhy };
      g.vehicles.exit({ force: true });
      g.vehicles.remove(j);
      return dist ?? dbg;
    };
    return { f22: roll("f22"), sr71: roll("sr71") };
  }, f);
  console.log(`    lift-off: F-22 ${JSON.stringify(r.f22)} blocks, SR-71 ${JSON.stringify(r.sr71)} blocks`);
  assert(r.f22 > 0 && r.sr71 > r.f22 * 1.15 && r.sr71 < 690, JSON.stringify(r));
});

await browserCheck("flown into the ground it crashes", async () => {
  const r = await v((g) => {
    const p = g.player.position;
    const ground = g.world.heightAt(Math.floor(p.x), Math.floor(p.z));
    const j = g.vehicles.create("jet", { jetType: "sr71", pos: [p.x, ground + 40, p.z], yaw: 0, airborne: true, speed: 200, throttle: 1 });
    j.q.setFromEuler(new g.THREE.Euler(-0.7, 0, 0, "YXZ"));
    j.vel.set(0, -130, -150);
    g.vehicles.enter(j);
    for (let i = 0; i < 30 * 4 && j.alive; i++) g.vehicles.update(1 / 30);
    return { alive: j.alive, active: g.vehicles.active?.jetType ?? null };
  });
  assert(!r.alive, JSON.stringify(r));
  await frames(10);
});

await browser.close();
server.close();

const failed = results.filter(([, ok]) => !ok);
console.log(`\n${results.length - failed.length} passed, ${failed.length} failed.`);
process.exit(failed.length ? 1 : 0);
