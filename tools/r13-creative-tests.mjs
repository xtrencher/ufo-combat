// Round 13 creative tests: planes and UFOs in Creative.
// In Node (fast): the vehicle items (names, one to a stack, a use, an icon,
// in the Creative palette), the summons registered for each.
// In the browser (the real game, a Survival world, so no Mods): in Creative
// the palette's Vehicles tab has the F-22, the F-16, the B-2 and the UFO; a
// jet put down from the palette item sits on its wheels on the grass aimed
// at and is boarded with F; one summoned at the sky takes the player up and
// flies; a jet lands on a field of grass (no runway); a B-2 and a UFO are
// summoned and boarded; nothing brings UFO fleets or missions; after a
// reload the summoned vehicles are back; in the Nether they stay behind
// in the Overworld. In Survival mode: no palette, the
// items summon nothing, F next to a vehicle swaps the hands instead of
// boarding, and a pilot switched to Survival is set down. A Missions world's
// Creative has them too (and its call-ins); with its Mods off they say so.
// With --online: a
// guest sees the host's jet, and the host the guest's UFO.
//
//   node r13-creative-tests.mjs [--only=substring] [--node] [--online]
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
const imp = (p) => import(pathToFileURL(path.join(ROOT, p)).href);

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

// ---------- Node ----------

const VEHICLE_IDS = [266, 267, 268, 269];

await check("items: the F-22, the F-16, the B-2 and the UFO, one to a stack, used by the vehicles, painted, in the palette", async () => {
  const { itemInfo, maxStack, CREATIVE_ITEMS, MOD_ITEMS } = await imp("js/items.js");
  const C = await imp("js/content/index.js");
  const V = await imp("js/content/vehicles.js");
  const { paintItemIcon } = await imp("js/itemtextures.js");
  const names = VEHICLE_IDS.map((id) => itemInfo(id)?.name);
  assert(names.join("|") === "F-22 Raptor|F-16 Fighting Falcon|B-2 Spirit|UFO", `names: ${names}`);
  assert(VEHICLE_IDS.every((id) => maxStack(id) === 1 && typeof C.ITEM_USE[id] === "function" && !MOD_ITEMS.has(id)), "one to a stack, a use, not a mod item (a Survival world's Creative has them)");
  assert(VEHICLE_IDS.every((id) => CREATIVE_ITEMS.includes(id)), "in the Creative palette");
  assert(V.items[266].vehicle === "f22" && V.items[269].vehicle === "ufo", "the summon keys");
  for (const id of VEHICLE_IDS) {
    const px = paintItemIcon(itemInfo(id).icon);
    let n = 0;
    for (let i = 3; i < px.length; i += 4) if (px[i]) n++;
    assert(n > 150, `icon of ${id}: ${n} pixels`);
  }
  assert(!C.recipes().some((r) => VEHICLE_IDS.includes(r.result?.[0])), "never crafted");
});

// ---------- In the browser ----------

if (!args.node) await browserChecks();

async function browserChecks() {
  const { chromium } = await import("playwright-core");
  const PORT = 9910 + Math.floor(Math.random() * 40);
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
    executablePath: process.env.CHROMIUM_PATH || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome",
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
    while (Date.now() - t0 < 180000) {
      const st = await v(p, (g) => g.gameState);
      if (st === "playing") return;
      if (st === "dead") {
        await v(p, (g) => g.respawn());
        continue;
      }
      if (st === "start") await p.click("#play-btn", { timeout: 5000 }).catch(() => {});
      else if (await p.isVisible("#resume-btn")) await p.click("#resume-btn", { timeout: 3000 }).catch(() => {});
      else if (await p.isVisible("#click-to-play").catch(() => false)) await p.click("#click-to-play", { timeout: 3000 }).catch(() => {});
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

  // A field of grass high up (x0-30..x0+30, z0-100..z0+10 at y0), air over it; the player in Creative at its south end.
  const FIELD = `async (g, o = {}) => {
    const x0 = Math.floor(g.spawn.x), y0 = o.y || 100, z0 = Math.floor(g.spawn.z);
    const list = [];
    for (let x = x0 - 30; x <= x0 + 30; x++) for (let z = z0 - 100; z <= z0 + 10; z++) { list.push(x, y0, z, 1); for (let y = 1; y < 9; y++) list.push(x, y0 + y, z, 0); }
    g.world.setBlocks(list);
    for (const v of [...g.vehicles.vehicles]) g.vehicles.remove(v);
    g.setMode("creative");
    g.player.flying = false;
    g.player.position.set(x0 + 0.5, y0 + 1, z0 + 0.5);
    g.player.velocity.set(0, 0, 0);
    g.player.yaw = 0;
    g.player.pitch = 0;
    return { x0, y0, z0 };
  }`;
  // (Built where the player is put first: the ground there loaded, so the field's blocks are in the world.)
  async function field(p, o) {
    await v(p, (g) => {
      g.player.position.set(g.spawn.x, 110, g.spawn.z);
      g.player.flying = true;
      return true;
    });
    const t0 = Date.now();
    const loaded = await until(p, (g) => [-1, 0, 1].every((dx) => [-6, -5, -4, -3, -2, -1, 0].every((dz) => g.world.getChunk((Math.floor(g.spawn.x) >> 4) + dx, (Math.floor(g.spawn.z) >> 4) + dz))), 60000);
    if (args.verbose) console.log(`        ground loaded: ${!!loaded} (${Date.now() - t0} ms)`);
    const a = await p.evaluate(([src, a]) => new Function("g", "a", `return (${src})(g, a);`)(window.__ufo, a), [FIELD, o || {}]);
    const built = await until(p, (g, a) => g.world.getBlock(a.x0, a.y0, a.z0 - 95) === 1 && g.world.getBlock(a.x0 - 30, a.y0, a.z0) === 1, 30000, a);
    if (args.verbose) console.log(`        field built: ${!!built} (${Date.now() - t0} ms)`);
    return a;
  }
  // The vehicle item in hand, used as a right click does (aim: the view direction).
  const useItem = (p, id, forward) =>
    v(
      p,
      async (g, [id, forward]) => {
        const C = await import("./js/content/index.js");
        g.inventory.slots[0] = { id, count: 1 };
        g.inventory.selected = 0;
        g.vehicles._summonT = -99; // (no held-button debounce between the test's uses)
        const before = g.vehicles.vehicles.length;
        const ctx = { ...g.interaction._useCtx(null), forward };
        const handled = C.ITEM_USE[id](ctx);
        const nv = g.vehicles.vehicles.length > before ? g.vehicles.vehicles[g.vehicles.vehicles.length - 1] : null;
        return { handled, n: g.vehicles.vehicles.length, v: nv && { type: nv.type, jetType: nv.jetType, name: nv.name, x: nv.pos.x, y: nv.pos.y, z: nv.pos.z, onGround: nv.onGround, summoned: !!nv.summoned, bottom: nv.bottom }, seated: g.vehicles.active?.name ?? null };
      },
      [id, forward]
    );
  const down = [0, -0.45, -0.89]; // (ahead and down: the grass in front)
  const sky = [0, 0.8, -0.6];

  const page = await newPage("solo");
  await browserCheck("boot: a Survival world in Creative, its palette's Vehicles tab has the four aircraft", async () => {
    await page.goto(`http://127.0.0.1:${PORT}/index.html?seed=9137&type=survival&graphics=low`, { waitUntil: "load", timeout: 60000 });
    await page.waitForFunction(() => !!window.__ufo && window.__ufo.graphicsReady, null, { timeout: 120000 });
    await play(page);
    const r = await v(page, (g) => {
      g.setMode("creative");
      g.invScreen.open("inventory", true);
      const i = g.invScreen.tabBtns.findIndex((b) => b.textContent === "Vehicles");
      if (i >= 0) g.invScreen.setTab(i);
      const shown = g.invScreen.paletteViews.filter((sv) => !sv.el.classList.contains("hidden")).length;
      return { tab: i, shown, mods: g.mods.enabled, on: g.vehicles.enabled, type: g.worldType };
    });
    if (out) await page.screenshot({ path: path.join(out, "creative-palette.png") });
    await v(page, (g) => g.invScreen.close());
    assert(r.type === "survival" && !r.mods && r.on, `a Survival world, Mods off, vehicles on: ${JSON.stringify(r)}`);
    assert(r.tab >= 0 && r.shown >= 4, `the Vehicles tab (the four aircraft, and the ground war's vehicles): ${JSON.stringify(r)}`);
  });

  await browserCheck("a jet from the palette: on its wheels on the grass aimed at, its tail clear of the player; F boards it", async () => {
    const a = await field(page);
    await frames(page, 3);
    const r = await useItem(page, 266, down);
    assert(r.handled && r.v && r.v.type === "jet" && r.v.jetType === "f22" && r.v.summoned && r.v.onGround, `placed: ${JSON.stringify(r)}`);
    assert(Math.abs(r.v.y - (a.y0 + 1 + r.v.bottom)) < 0.3 && r.v.z < a.z0 - 6, `on the grass ahead: ${JSON.stringify(r.v)} field ${JSON.stringify(a)}`);
    assert(!r.seated, "not boarded by placing");
    const b = await v(page, (g) => {
      for (let i = 0; i < 20; i++) g.vehicles.update(1 / 30);
      const jet = g.vehicles.vehicles[g.vehicles.vehicles.length - 1];
      g.player.position.set(jet.pos.x + 4, jet.pos.y - jet.bottom, jet.pos.z + 3);
      const wants = g.vehicles.wantsF();
      g.vehicles.toggle();
      return { wants, seated: g.vehicles.active === jet, alive: jet.alive, onGround: jet.onGround, y: jet.pos.y };
    });
    assert(b.wants && b.seated && b.alive && b.onGround, `boarded with F: ${JSON.stringify(b)}`);
    if (out) {
      await frames(page, 4);
      await page.screenshot({ path: path.join(out, "creative-jet-parked.png") });
    }
    await v(page, (g) => g.vehicles.exit({ force: true }));
  });

  await browserCheck("aimed at the sky: the player straight into an F-16 up in the air; it flies", async () => {
    await field(page);
    const r = await useItem(page, 267, sky);
    assert(r.v && r.v.jetType === "f16" && !r.v.onGround && r.seated === r.v.name, `in the air, seated: ${JSON.stringify(r)}`);
    const f = await v(page, (g) => {
      const jet = g.vehicles.active;
      const p0 = jet.pos.clone();
      for (let i = 0; i < 90; i++) g.vehicles.update(1 / 30);
      return { moved: jet.pos.distanceTo(p0), alive: jet.alive, speed: jet.speed, seated: g.vehicles.active === jet };
    });
    assert(f.alive && f.seated && f.moved > 60 && f.speed > 30, `flying: ${JSON.stringify(f)}`);
    await v(page, (g) => g.vehicles.exit({ force: true }));
  });

  await browserCheck("a jet lands on the field of grass (no runway) and stays whole", async () => {
    const a = await field(page);
    const r = await v(page, (g, a) => {
      const vm = g.vehicles;
      const jet = vm.create("jet", { jetType: "f22", pos: [a.x0 + 0.5, a.y0 + 1 + 1.35 + 3, a.z0 + 5], yaw: 0, airborne: true, speed: 50, throttle: 0, summoned: true });
      vm.enter(jet);
      jet.aimPitch = -0.08;
      let t = 0;
      for (; t < 600 && !jet.onGround && jet.alive; t++) vm.update(1 / 30);
      // (Then the wheel brakes, Space, to a stop.)
      g.player.keys.add("Space");
      jet.throttle = 0;
      for (let i = 0; i < 240 && jet.alive && jet.speed > 0.5; i++) vm.update(1 / 30);
      g.player.keys.delete("Space");
      const x = Math.floor(jet.pos.x), z = Math.floor(jet.pos.z);
      return { t, onGround: jet.onGround, alive: jet.alive, health: jet.health, speed: jet.speed, y: jet.pos.y - jet.bottom, z: jet.pos.z, under: g.world.getBlock(x, Math.floor(jet.pos.y - jet.bottom - 0.5), z), field: g.world.getBlock(x, a.y0, z), chunk: !!g.world.getChunk(x >> 4, z >> 4), gb: vm.groundBelow(jet.pos.x, jet.pos.y + 3, jet.pos.z) };
    }, a);
    assert(r.alive && r.onGround && r.under === 1 && Math.abs(r.y - (a.y0 + 1)) < 0.6, `landed: ${JSON.stringify(r)}`);
    assert(r.speed < 1, `stopped: ${JSON.stringify(r)}`);
    await v(page, (g) => g.vehicles.exit({ force: true }));
  });

  await browserCheck("the B-2 and a UFO from the palette, boarded; no UFO fleets, no missions", async () => {
    const a = await field(page);
    const b2 = await useItem(page, 268, [0, -0.25, -0.97]);
    assert(b2.v && b2.v.jetType === "b2" && b2.v.onGround, `the B-2 on the grass: ${JSON.stringify(b2)}`);
    const ufo = await v(page, (g, a) => {
      g.player.position.set(a.x0 - 22.5, a.y0 + 1, a.z0 + 0.5);
      return true;
    }, a);
    const u = await useItem(page, 269, down);
    assert(ufo && u.v && u.v.type === "ufo" && u.v.summoned && u.v.y > a.y0 + 1, `a UFO over the grass: ${JSON.stringify(u)}`);
    const s = await v(page, (g) => {
      const ship = g.vehicles.vehicles[g.vehicles.vehicles.length - 1];
      g.player.position.set(ship.pos.x + ship.radius + 1.5, ship.pos.y - ship.bottom, ship.pos.z);
      g.vehicles.toggle();
      const inUfo = g.vehicles.active === ship;
      for (let i = 0; i < 30; i++) g.vehicles.update(1 / 30);
      g.vehicles.exit({ force: true });
      const bomber = g.vehicles.vehicles.find((v) => v.jetType === "b2");
      g.player.position.set(bomber.pos.x, bomber.pos.y - bomber.bottom, bomber.pos.z + 9);
      g.vehicles.toggle();
      // (Review fix) No patrol fighters either: they are the Missions layer's.
      const ej = g.enemyJets;
      const count = ej.config.count;
      ej.config.count = 4;
      ej.timer = 0;
      ej.update(1 / 30);
      const patrols = ej.jets.length;
      ej.config.count = count;
      return { inUfo, inB2: g.vehicles.active === bomber, ufos: g.ufos.ufos.length, ufosOn: g.ufos.enabled, aliens: g.mobs.countKind("alien"), progress: g.progress.enabled, mods: g.mods.enabled, patrols };
    });
    assert(s.inUfo && s.inB2, `boarded: ${JSON.stringify(s)}`);
    assert(s.ufos === 0 && !s.mods && s.aliens === 0 && s.patrols === 0, `no fleets: ${JSON.stringify(s)}`);
    if (out) {
      await frames(page, 4);
      await page.screenshot({ path: path.join(out, "creative-b2.png") });
    }
    await v(page, (g) => g.vehicles.exit({ force: true }));
  });

  await browserCheck("saves: the summoned vehicles are back after a reload", async () => {
    const before = await v(page, (g) => {
      g.flushSave(true);
      return g.vehicles.vehicles.filter((v) => v.summoned).map((v) => v.jetType || v.type).sort().join();
    });
    assert(before.includes("b2") && before.includes("ufo"), `before: ${before}`);
    await page.reload({ waitUntil: "load" });
    await page.waitForFunction(() => !!window.__ufo && window.__ufo.graphicsReady, null, { timeout: 120000 });
    await play(page);
    const after = await until(page, (g) => {
      const l = g.vehicles.vehicles.filter((v) => v.summoned && v.alive);
      return l.length ? l.map((v) => v.jetType || v.type).sort().join() : null;
    }, 30000);
    assert(after === before, `after the reload: ${after} (before: ${before})`);
  });

  await browserCheck("the Nether: the vehicles stay in the Overworld (hidden, nothing summoned there), back on the return", async () => {
    const r = await v(page, (g) => {
      const vm = g.vehicles;
      const n = vm.vehicles.length;
      const ok = g.dims.enterNow("nether");
      vm.update(1 / 30);
      const there = { ok, on: vm.enabled, shown: vm.vehicles.filter((v) => v.root.visible).length, why: vm.summonRefusal() };
      g.dims.enterNow("overworld");
      vm.update(1 / 30);
      return { n, there, back: { on: vm.enabled, shown: vm.vehicles.filter((v) => v.root.visible).length } };
    });
    assert(r.there.ok && !r.there.on && r.there.shown === 0 && /Overworld/.test(r.there.why), `in the Nether: ${JSON.stringify(r)}`);
    assert(r.back.on && r.back.shown === r.n && r.n > 0, `back: ${JSON.stringify(r)}`);
    await play(page);
  });

  await browserCheck("Survival mode: no palette, the items summon nothing, F swaps the hands, a pilot is set down", async () => {
    const a = await field(page);
    const jetAt = await useItem(page, 266, down);
    assert(jetAt.v, "a jet to test with");
    const r = await v(page, async (g) => {
      const C = await import("./js/content/index.js");
      const vm = g.vehicles;
      const jet = vm.vehicles[vm.vehicles.length - 1];
      g.player.position.set(jet.pos.x + 4, jet.pos.y - jet.bottom, jet.pos.z + 3);
      vm.toggle();
      const seated = vm.active === jet;
      g.setMode("survival");
      vm.update(1 / 30);
      const setDown = !vm.active && !g.player.vehicle;
      g.invScreen.open("inventory", false);
      const palette = !g.invScreen.paletteEl.classList.contains("hidden");
      g.invScreen.close();
      const n = vm.vehicles.length;
      vm._summonT = -99;
      C.ITEM_USE[266]({ ...g.interaction._useCtx(null), forward: [0, -0.45, -0.89] });
      const summoned = vm.vehicles.length - n;
      g.player.position.set(jet.pos.x + 4, jet.pos.y - jet.bottom, jet.pos.z + 3);
      const wants = vm.wantsF();
      const boarded = vm.toggle();
      return { seated, setDown, palette, summoned, wants, boarded, prompt: vm.promptEl?.classList.contains("hidden") };
    });
    assert(r.seated && r.setDown, `set down: ${JSON.stringify(r)}`);
    assert(!r.palette && r.summoned === 0 && !r.wants && !r.boarded, `nothing of Creative's: ${JSON.stringify(r)}`);
    await v(page, (g) => g.setMode("creative"));
  });

  await browserCheck("a Missions world: a palette jet and a call-in in its Creative; with the Mods off, the items say so", async () => {
    await page.goto(`http://127.0.0.1:${PORT}/index.html?seed=9139&type=missions&graphics=low`, { waitUntil: "load", timeout: 60000 });
    await page.waitForFunction(() => !!window.__ufo && window.__ufo.graphicsReady, null, { timeout: 120000 });
    await play(page);
    await field(page);
    const r = await useItem(page, 267, down);
    assert(r.v && r.v.jetType === "f16" && r.v.onGround, `a palette jet: ${JSON.stringify(r)}`);
    const c = await v(page, (g) => {
      const ok = g.mp.game.callIn("b2");
      const seated = g.vehicles.active?.jetType;
      g.vehicles.exit({ force: true });
      return { ok, seated, palette: g.vehicles.vehicles.some((v) => v.summoned && v.jetType === "f16") };
    });
    assert(c.ok && c.seated === "b2" && c.palette, `the call-in (the palette's jet kept): ${JSON.stringify(c)}`);
    const off = await v(page, async (g) => {
      const C = await import("./js/content/index.js");
      g.setModsEnabled(false, false);
      const n = g.vehicles.vehicles.length;
      g.vehicles._summonT = -99;
      C.ITEM_USE[266]({ ...g.interaction._useCtx(null), forward: [0, 0.8, -0.6] });
      const res = { on: g.vehicles.enabled, added: g.vehicles.vehicles.length - n, why: g.vehicles.summonRefusal() };
      g.setModsEnabled(true, false);
      return res;
    });
    assert(!off.on && off.added === 0 && /mods/i.test(off.why), `Mods off: ${JSON.stringify(off)}`);
  });

  if (args.online) {
    const { default: express } = await import("express");
    const { ExpressPeerServer } = await import("peer");
    const PEER_PORT = PORT + 60;
    const app = express();
    const peerHttp = app.listen(PEER_PORT, "127.0.0.1");
    app.use("/ufo", ExpressPeerServer(peerHttp, { path: "/" }));
    const NET_Q = `peerServer=127.0.0.1:${PEER_PORT}/ufo&noStun=1&graphics=low`;
    const host = await newPage("host", { width: 640, height: 360 });
    const guest = await newPage("guest", { width: 640, height: 360 });
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
    await browserCheck("online: a guest sees the host's Creative jet, the host the guest's UFO (a Survival world)", async () => {
      await host.goto(`http://127.0.0.1:${PORT}/index.html?seed=9138&type=survival&${NET_Q}`, { waitUntil: "load", timeout: 60000 });
      await host.waitForFunction(() => !!window.__ufo && window.__ufo.graphicsReady, null, { timeout: 120000 });
      await host.click("#menu-mp-btn");
      await host.fill("#mp-nick", "Alice");
      await host.click("#mp-host-btn");
      const code = await until(host, (g) => g.net.code, 30000);
      assert(code, "no room code");
      await host.click("#mp-lobby-play");
      await host.waitForFunction(() => window.__ufo.gameState === "playing", null, { timeout: 30000 });
      await v(host, noDraw);
      await field(host);
      const h = await useItem(host, 266, down);
      assert(h.v, `the host's jet: ${JSON.stringify(h)}`);
      await guest.goto(`http://127.0.0.1:${PORT}/index.html?join=${code}&${NET_Q}`, { waitUntil: "load", timeout: 60000 });
      await guest.waitForSelector("#mp-join-boot:not(.hidden)", { timeout: 30000 });
      await guest.fill("#mp-boot-nick", "Bob");
      await guest.click("#mp-boot-join");
      await guest.waitForFunction(() => !!window.__ufo && window.__ufo.graphicsReady, null, { timeout: 120000 });
      assert(await until(guest, (g) => g.mp.stateLoaded, 60000), "the host's state never arrived");
      await v(guest, noDraw);
      await play(guest);
      const seen = await until(guest, (g) => (g.vehicles.vehicles.some((v) => v.puppet && v.type === "jet" && v.root.visible) ? true : null), 20000);
      assert(seen, "the guest doesn't see the host's jet");
      const gu = await v(guest, (g) => {
        g.setMode("creative");
        g.player.flying = true;
        return true;
      });
      const u = await useItem(guest, 269, sky);
      assert(gu && u.v && u.seated, `the guest's UFO: ${JSON.stringify(u)}`);
      const hostSees = await until(host, (g) => (g.vehicles.vehicles.some((v) => v.puppet && v.type === "ufo" && v.root.visible) ? true : null), 20000);
      assert(hostSees, "the host doesn't see the guest's UFO");
      await guest.close();
      await host.close();
    });
    peerHttp.close();
  }
  await browser.close();
  server.close();
}

// ---------- Summary ----------
const failed = results.filter(([, ok]) => !ok);
console.log(`\n${results.length - failed.length} passed, ${failed.length} failed.`);
process.exit(failed.length ? 1 : 0);
