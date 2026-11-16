// Round 18 (track B) tests: modes and Creative.
// In Node (fast): every hand weapon (the guns, the grenade, the bazooka, the
// lasers, the railgun, the airstrike designator, the bow, the swords, the
// axes, the throwables, the shield, the arrows) is in the Creative palette's
// list.
// In the browser (the real game):
//   - a tank and a UFO boarded in Creative, the mode switched to Survival
//     (and the Mods off): still inside, still driven / flown;
//   - a parked airport jet boarded in Survival (a Missions world, the
//     mission chain at its start); a vehicle item placed in Survival (and
//     used up); a missile truck boarded in Survival;
//   - the pause menu's teleports: each one (the Nether, the End, the Moon,
//     Mars, Mercury, Venus, home) lands the player on solid, open ground in
//     its dimension; a UFO and a tank go along; the buttons are off (with
//     the reason) in a world without dimensions;
//   - the Creative palette's Weapons tab shows every hand weapon (a Survival
//     world's too: the guns as well), and each one is used (pressed,
//     released, swung) without an error;
//   - tank tracks rest on the ground's surface (within a small tolerance:
//     none of the model under it, none far over it) for the Tiger, the
//     battle tank, the AA vehicle and the missile truck, on flat ground, on a
//     slope of steps and across a 1-block step; a close screenshot at
//     graphics=high (SHOTS=dir).
// With --online: a guest and the host each teleport to the Moon alone
// (each lands; the other stays where they were).
//
//   node r18-modes-tests.mjs [--only=substring] [--node] [--online] [--verbose]
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

// Every hand weapon's id (Node and the page share this list's rule).
const HAND_WEAPONS = `(I, V) => {
  const out = [];
  for (const id of I.CREATIVE_ITEMS.concat(Object.keys(I.ITEM).map((k) => I.ITEM[k]))) {
    const info = I.itemInfo(id);
    if (!info || out.includes(id)) continue;
    const t = info.tool?.type;
    if (info.weapon || t === "sword" || t === "axe" || info.shield || id === V.ARROW || id === V.SNOWBALL || id === V.EGG || id === V.ENDER_PEARL) out.push(id);
  }
  return out;
}`;

await check("every hand weapon is in the Creative palette's list", async () => {
  const I = await imp("js/items.js");
  const V = await imp("js/content/ids.js");
  const list = new Function(`return ${HAND_WEAPONS}`)()(I, V);
  const names = list.map((id) => I.itemInfo(id).name);
  for (const want of ["Pistol", "Grenade", "Bazooka", "Machine Gun", "Sniper Rifle", "Laser Blaster", "Railgun", "Laser Minigun", "Airstrike Designator", "Bow", "Diamond Sword", "Shield", "Snowball"]) assert(names.includes(want), `${want} among the hand weapons: ${names.join(", ")}`);
  const missing = list.filter((id) => !I.CREATIVE_ITEMS.includes(id)).map((id) => I.itemInfo(id).name);
  assert(!missing.length, `not in the palette: ${missing.join(", ")}`);
});

// ---------- In the browser ----------

if (!args.node) await browserChecks();

async function browserChecks() {
  const { chromium } = await import("playwright-core");
  const PORT = 9960 + Math.floor(Math.random() * 30);
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
  const out = process.env.SHOTS || "";
  const anyOnly = (...names) => !args.only || names.some((n) => n.toLowerCase().includes(String(args.only).toLowerCase()));

  // A flat field of grass high up (x0-30..x0+30, z0-60..z0+10 at y0), air
  // over it, the player at its south end. o.step: a 1-block step across it
  // at z0-20 (the north part a block higher); o.stairs: steps of one block
  // every 3 blocks north from z0-30.
  const FIELD = `async (g, o = {}) => {
    const x0 = Math.floor(g.spawn.x), y0 = o.y || 100, z0 = Math.floor(g.spawn.z);
    const list = [];
    for (let x = x0 - 30; x <= x0 + 30; x++) for (let z = z0 - 60; z <= z0 + 10; z++) {
      let top = y0;
      if (o.step && z < z0 - 20) top = y0 + 1;
      if (o.stairs && z < z0 - 30) top = y0 + Math.min(8, Math.floor((z0 - 30 - z) / 3) + 1);
      for (let y = y0 - 1; y <= top; y++) list.push(x, y, z, y === y0 ? o.top || 1 : 1);
      for (let y = top + 1; y < y0 + 14; y++) list.push(x, y, z, 0);
    }
    g.world.setBlocks(list);
    for (const v of [...g.vehicles.vehicles]) if (!v.npc) g.vehicles.remove(v);
    g.player.flying = false;
    g.player.position.set(x0 + 0.5, y0 + 1, z0 + 0.5);
    g.player.velocity.set(0, 0, 0);
    g.player.yaw = 0;
    g.player.pitch = 0;
    return { x0, y0, z0 };
  }`;
  async function field(p, o) {
    await v(p, (g) => {
      if (g.vehicles.active) g.vehicles.exit({ force: true });
      g.player.position.set(g.spawn.x, 110, g.spawn.z);
      g.player.flying = true;
      return true;
    });
    await until(p, (g) => [-2, -1, 0, 1].every((dx) => [-4, -3, -2, -1, 0].every((dz) => g.world.getChunk((Math.floor(g.spawn.x) >> 4) + dx, (Math.floor(g.spawn.z) >> 4) + dz))), 60000);
    const a = await p.evaluate(([src, a]) => new Function("g", "a", `return (${src})(g, a);`)(window.__ufo, a), [FIELD, o || {}]);
    await until(p, (g, a) => g.world.getBlock(a.x0, a.y0 - 1, a.z0 - 55) === 1 && g.world.getBlock(a.x0 - 30, a.y0 - 1, a.z0) === 1, 30000, a);
    return a;
  }

  // ---------- A Missions world ----------
  const page = await newPage("solo");
  await page.goto(`http://127.0.0.1:${PORT}/index.html?seed=9181&type=missions&graphics=low`, { waitUntil: "load", timeout: 60000 });
  await page.waitForFunction(() => !!window.__ufo && window.__ufo.graphicsReady, null, { timeout: 120000 });
  await play(page);

  await browserCheck("a tank called in in Creative, the mode switched to Survival: still inside, still drives", async () => {
    await field(page);
    const r = await v(page, (g) => {
      g.setMode("creative");
      const ok = g.mp.game.callIn("tiger");
      const tank = g.vehicles.active;
      g.setMode("survival");
      for (let i = 0; i < 20; i++) g.vehicles.update(1 / 30);
      const still = g.vehicles.active === tank;
      const p0 = tank.pos.clone();
      g.player.keys.add("KeyW");
      for (let i = 0; i < 90; i++) g.vehicles.update(1 / 30);
      g.player.keys.delete("KeyW");
      const moved = tank.pos.distanceTo(p0);
      return { ok, type: tank?.type, kind: tank?.kind, mode: g.player.mode, still, moved, seated: g.vehicles.active === tank, alive: tank.alive };
    });
    assert(r.ok && r.type === "tank" && r.mode === "survival", `called in: ${JSON.stringify(r)}`);
    assert(r.still && r.seated && r.alive && r.moved > 3, `still in it and driving in Survival: ${JSON.stringify(r)}`);
    // Out and back in (F) in Survival.
    const b = await v(page, (g) => {
      const tank = g.vehicles.active;
      g.vehicles.toggle();
      const out = !g.vehicles.active;
      for (let i = 0; i < 5; i++) g.vehicles.update(1 / 30);
      const wants = g.vehicles.wantsF();
      g.vehicles.toggle();
      return { out, wants, back: g.vehicles.active === tank, prompt: document.getElementById("vehicle-prompt")?.textContent };
    });
    assert(b.out && b.wants && b.back, `out and in again with F in Survival: ${JSON.stringify(b)}`);
    await v(page, (g) => g.vehicles.exit({ force: true }));
  });

  await browserCheck("a UFO boarded in Creative, then Survival and the Mods off: still flying it", async () => {
    await field(page);
    const r = await v(page, (g) => {
      g.setMode("creative");
      const ok = g.mp.game.callIn("ufo");
      const ufo = g.vehicles.active;
      g.setMode("survival");
      g.setModsEnabled(false, false);
      for (let i = 0; i < 20; i++) g.vehicles.update(1 / 30);
      const still = g.vehicles.active === ufo && ufo.root.visible;
      const p0 = ufo.pos.clone();
      g.player.keys.add("KeyW");
      for (let i = 0; i < 60; i++) g.vehicles.update(1 / 30);
      g.player.keys.delete("KeyW");
      const moved = ufo.pos.distanceTo(p0);
      const res = { ok, type: ufo?.type, still, moved, seated: g.vehicles.active === ufo, mods: g.mods.enabled, enabled: g.vehicles.enabled };
      g.vehicles.exit({ force: true });
      g.setModsEnabled(true, false);
      return res;
    });
    assert(r.ok && r.type === "ufo" && !r.mods, `called in: ${JSON.stringify(r)}`);
    assert(r.still && r.seated && r.enabled && r.moved > 2, `still in it and flying: ${JSON.stringify(r)}`);
  });

  await browserCheck("Survival: a vehicle item placed (and used up), a missile truck boarded, the call-ins still Creative's", async () => {
    await field(page);
    const r = await v(page, async (g) => {
      const C = await import("./js/content/index.js");
      g.setMode("survival");
      g.inventory.slots[0] = { id: 317, count: 1 };
      g.inventory.selected = 0;
      g.vehicles._summonT = -99;
      const before = g.vehicles.vehicles.length;
      C.ITEM_USE[317]({ ...g.interaction._useCtx(null), forward: [0, -0.45, -0.89] });
      const nv = g.vehicles.vehicles.length > before ? g.vehicles.vehicles[g.vehicles.vehicles.length - 1] : null;
      const out = { placed: nv && nv.type + ":" + nv.kind, left: g.inventory.slots[0]?.count ?? 0 };
      if (nv) {
        g.player.position.set(nv.pos.x + nv.half.x + 1.5, nv.pos.y, nv.pos.z);
        out.boarded = g.vehicles.toggle() && g.vehicles.active === nv;
        g.vehicles.exit({ force: true });
        g.vehicles.remove(nv);
      }
      const tel = g.vehicles.create("tel", { pos: [g.player.position.x + 8, g.player.position.y, g.player.position.z - 8], yaw: 0 });
      tel.settle?.(true);
      g.player.position.set(tel.pos.x + tel.half.x + 1.2, tel.pos.y, tel.pos.z);
      out.tel = { usable: !tel.unusable, boarded: g.vehicles.toggle() && g.vehicles.active === tel };
      g.vehicles.exit({ force: true });
      g.vehicles.remove(tel);
      out.callIn = g.mp.game.callIn("tiger");
      return out;
    });
    assert(r.placed === "tank:mbt" && r.left === 0, `the battle tank item placed and used up: ${JSON.stringify(r)}`);
    assert(r.boarded, `the placed tank boarded: ${JSON.stringify(r)}`);
    assert(r.tel.usable && r.tel.boarded, `the missile truck in Survival: ${JSON.stringify(r)}`);
    assert(!r.callIn, "no call-ins out of Creative");
  });

  await browserCheck("Survival in a Missions world, the chain at its start: a parked airport jet is boarded", async () => {
    const at = await v(page, (g) => {
      if (g.vehicles.active) g.vehicles.exit({ force: true });
      g.setMode("survival");
      const p = g.player.position;
      const list = g.sites.within(p.x, p.z, 7000).filter((s) => g.sites.parkingSlots(s).fighters.length);
      list.sort((a, b) => Math.hypot(a.x - p.x, a.z - p.z) - Math.hypot(b.x - p.x, b.z - p.z));
      const s = list[0];
      if (!s) return null;
      const slot = g.sites.parkingSlots(s).fighters[0];
      g.player.position.set(slot.x + 0.5, s.y + 3, slot.z + 0.5);
      g.player.flying = true;
      g.streamAround(slot.x, slot.z);
      return { id: s.id, x: slot.x, z: slot.z, y: s.y, progress: g.progress.enabled, wings: g.progress.reached("wings") };
    });
    assert(at, "no airport with parked fighters within 7000 blocks");
    assert(at.progress && !at.wings, `the mission chain on, the jets not reached yet: ${JSON.stringify(at)}`);
    const jet = await until(page, (g, a) => {
      g.world.prepareArea(a.x, a.z, 2);
      g.airports.timer = 0;
      g.airports.update(1);
      const j = g.vehicles.vehicles.find((x) => x.type === "jet" && x.parkedAt && Math.hypot(x.pos.x - a.x, x.pos.z - a.z) < 120);
      return j ? { type: j.jetType, x: j.pos.x, y: j.pos.y, z: j.pos.z } : null;
    }, 60000, at);
    assert(jet, "no jet parked at the airport");
    const r = await v(page, (g) => {
      const j = g.vehicles.vehicles.find((x) => x.type === "jet" && x.parkedAt);
      g.player.flying = false;
      g.player.position.set(j.pos.x + 3, j.pos.y - j.bottom, j.pos.z + 2);
      const near = g.vehicles.nearestEnterable() === j;
      const why = g.vehicles.canBoard?.(j) ?? null;
      const ok = g.vehicles.toggle();
      const res = { near, why, ok, seated: g.vehicles.active === j, mode: g.player.mode, prompt: null };
      g.vehicles.exit({ force: true });
      g.vehicles.updateHud(0.2, true);
      res.prompt = document.getElementById("vehicle-prompt")?.textContent;
      return res;
    });
    assert(r.mode === "survival" && r.near && !r.why && r.ok && r.seated, `boarded in Survival: ${JSON.stringify(r)}`);
  });

  // ---------- Teleports ----------
  // The player's spot after a travel: the dimension, solid ground under the
  // feet (not lava, not the void), two open cells.
  const SPOT = (g) => {
    const p = g.player.position;
    const x = Math.floor(p.x);
    const y = Math.floor(p.y + 0.01);
    const z = Math.floor(p.z);
    const below = g.world.getBlock(x, y - 1, z);
    const B = g.blocks || null;
    return { dim: g.world.dim, x: p.x, y: p.y, z: p.z, below, feet: g.world.getBlock(x, y, z), head: g.world.getBlock(x, y + 1, z), pending: !!g.dims.pending, onGround: g.player.onGround, vehicle: g.vehicles.active?.type ?? null };
  };
  async function teleport(p, dim) {
    const ok = await v(p, (g, d) => g.mp.game.teleportTo(d), dim);
    if (!ok) return { refused: true };
    const done = await until(p, (g, d) => (g.world.dim === d && !g.dims.pending ? true : null), 90000, dim);
    if (!done) return { never: true, dim: await v(p, (g) => g.world.dim) };
    await frames(p, 20);
    return v(p, async (g, src) => {
      const B = await import("./js/blocks.js");
      const s = new Function(`return ${src}`)()(g);
      s.solidBelow = !!B.IS_SOLID[s.below];
      s.openFeet = !B.IS_SOLID[s.feet];
      s.openHead = !B.IS_SOLID[s.head];
      s.lava = B.BLOCK_INFO[s.below]?.name?.toLowerCase().includes("lava") || false;
      return s;
    }, SPOT.toString());
  }

  if (anyOnly("teleport")) {
    await browserCheck("the pause menu's teleport buttons: seven, under the call-ins, shown in Creative", async () => {
      const r = await v(page, (g) => {
        if (g.vehicles.active) g.vehicles.exit({ force: true });
        g.setMode("creative");
        const box = document.getElementById("pause-teleports");
        const btns = [...box.querySelectorAll("[data-teleport]")];
        return { inCallins: !!box.closest("#pause-callins"), shown: !document.getElementById("pause-callins").classList.contains("hidden"), dims: btns.map((b) => b.dataset.teleport), off: btns.filter((b) => b.disabled).length };
      });
      assert(r.inCallins && r.shown && r.off === 0, JSON.stringify(r));
      assert(r.dims.join() === "overworld,nether,end,moon,mars,mercury,venus", JSON.stringify(r.dims));
    });

    for (const dim of ["nether", "end", "moon", "mars", "mercury", "venus", "overworld"]) {
      await browserCheck(`teleport to ${dim}: there, on solid open ground`, async () => {
        await play(page);
        const s = await teleport(page, dim);
        assert(!s.refused && !s.never, `the travel: ${JSON.stringify(s)}`);
        assert(s.dim === dim && s.solidBelow && s.openFeet && s.openHead && !s.lava, `the spot: ${JSON.stringify(s)}`);
        if (dim === "end") assert(Math.hypot(s.x - 100.5, s.z - 0.5) < 3 && Math.abs(s.y - 49) < 0.6 && s.below === 1550, `on the End's platform: ${JSON.stringify(s)}`);
        // (A moment later: still standing there, not fallen through.)
        await frames(page, 30);
        const later = await v(page, (g) => ({ y: g.player.position.y, dead: g.player.dead, health: g.player.health }));
        assert(!later.dead && Math.abs(later.y - s.y) < 1.2, `still standing: ${JSON.stringify({ s, later })}`);
      });
    }

    await browserCheck("teleport in a UFO (to Mars) and in a tank (to the Moon): the vehicle goes along, the player at its controls", async () => {
      await play(page);
      await field(page);
      const u = await v(page, (g) => {
        g.setMode("creative");
        return g.mp.game.callIn("ufo") && g.vehicles.active?.type;
      });
      assert(u === "ufo", `in a UFO: ${u}`);
      const n0 = await v(page, (g) => g.vehicles.all().filter((x) => x.type === "ufo").length);
      const s = await teleport(page, "mars");
      assert(s.dim === "mars", `on Mars: ${JSON.stringify(s)}`);
      const ufo = await until(page, (g) => (g.vehicles.active ? { type: g.vehicles.active.type, dim: g.vehicles.active.dim, n: g.vehicles.all().filter((x) => x.type === "ufo").length } : null), 10000);
      assert(ufo && ufo.type === "ufo" && ufo.dim === "mars" && ufo.n === n0, `the UFO came along (not a copy left behind): ${JSON.stringify({ ufo, n0 })}`);
      await v(page, (g) => g.vehicles.exit({ force: true }));
      const back = await teleport(page, "overworld");
      assert(back.dim === "overworld", "home again");
      await field(page);
      const t = await v(page, (g) => g.mp.game.callIn("mbt") && g.vehicles.active?.type);
      assert(t === "tank", `in a tank: ${t}`);
      const m = await teleport(page, "moon");
      assert(m.dim === "moon", `on the Moon: ${JSON.stringify(m)}`);
      const tank = await until(page, (g) => (g.vehicles.active ? { type: g.vehicles.active.type, dim: g.vehicles.active.dim, kind: g.vehicles.active.kind } : null), 10000);
      assert(tank && tank.type === "tank" && tank.kind === "mbt" && tank.dim === "moon", `the tank came along: ${JSON.stringify(tank)}`);
      const drive = await v(page, (g) => {
        const tk = g.vehicles.active;
        const p0 = tk.pos.clone();
        g.player.keys.add("KeyW");
        for (let i = 0; i < 60; i++) g.vehicles.update(1 / 30);
        g.player.keys.delete("KeyW");
        return { moved: tk.pos.distanceTo(p0), alive: tk.alive };
      });
      assert(drive.alive && drive.moved > 1, `it drives on the Moon: ${JSON.stringify(drive)}`);
      await v(page, (g) => g.vehicles.exit({ force: true }));
      // A jet flying, to the End: flying there over the platform.
      const j = await v(page, (g) => g.mp.game.callIn("f16") && g.vehicles.active?.jetType);
      assert(j === "f16", `in an F-16: ${j}`);
      const e = await teleport(page, "end");
      assert(e.dim === "end", `in the End: ${JSON.stringify(e)}`);
      const jet = await until(page, (g) => (g.vehicles.active ? { type: g.vehicles.active.jetType, dim: g.vehicles.active.dim, ground: g.vehicles.active.onGround, speed: g.vehicles.active.speed, alive: g.vehicles.active.alive, y: g.vehicles.active.pos.y } : null), 10000);
      assert(jet && jet.type === "f16" && jet.dim === "end" && !jet.ground && jet.alive && jet.speed > 30 && jet.y > 60, `the jet came along, flying: ${JSON.stringify(jet)}`);
      // (Home in it: out over the void of the End would be a fall.)
      const home = await teleport(page, "overworld");
      assert(home.dim === "overworld", "home again");
      const jetHome = await until(page, (g) => (g.vehicles.active ? g.vehicles.active.dim : null), 10000);
      assert(jetHome === "overworld", `the jet home too: ${jetHome}`);
      await v(page, (g) => g.vehicles.exit({ force: true }));
    });

    await browserCheck("teleports: refused out of Creative; the buttons off (with the reason) in a world without dimensions", async () => {
      const r = await v(page, (g) => {
        g.setMode("survival");
        const surv = g.mp.game.teleportTo("nether");
        g.setMode("creative");
        g.dims.enabled = false;
        g.setMode("creative");
        const btns = [...document.querySelectorAll("#pause-teleports [data-teleport]")];
        const res = { surv, off: btns.filter((b) => b.disabled).length, title: btns[0].title, row: document.getElementById("pause-teleports").title, refused: !g.mp.game.teleportTo("end") };
        g.dims.enabled = true;
        g.setMode("creative");
        res.on = btns.filter((b) => !b.disabled).length;
        return res;
      });
      assert(!r.surv && r.refused, `refused: ${JSON.stringify(r)}`);
      assert(r.off === 7 && /no other dimensions/i.test(r.title) && /no other dimensions/i.test(r.row) && r.on === 7, JSON.stringify(r));
    });
  }

  // ---------- Weapons ----------
  // The Weapons tab's items (shown), in the page.
  const WEAPONS_TAB = async (g, src) => {
    const I = await import("./js/items.js");
    const V = await import("./js/content/ids.js");
    const want = new Function(`return ${src}`)()(I, V);
    g.setMode("creative");
    g.invScreen.open("inventory", true);
    const i = g.invScreen.tabBtns.findIndex((b) => b.textContent === "Weapons" || b.textContent === "Combat");
    g.invScreen.setTab(i);
    const shown = new Set(g.invScreen.paletteViews.map((sv, k) => (sv.el.classList.contains("hidden") ? null : I.CREATIVE_ITEMS[k])).filter((x) => x !== null));
    g.invScreen.close();
    return { tab: i, missing: want.filter((id) => !shown.has(id)).map((id) => I.itemInfo(id).name), want };
  };
  // Each one in hand, used as the mouse does: the right button held and let
  // go, the left clicked; then the frames run. Returns what each did.
  const USE_ALL = async (g, list) => {
    const I = await import("./js/items.js");
    const out = [];
    const wait = (n) => new Promise((r) => {
      let i = 0;
      const f = () => (++i >= n ? r() : requestAnimationFrame(f));
      requestAnimationFrame(f);
    });
    for (const id of list) {
      const info = I.itemInfo(id);
      g.player.position.y += 0;
      g.inventory.slots[0] = { id, count: I.maxStack(id) > 1 ? 4 : 1 };
      g.inventory.selected = 0;
      g.player.pitch = -0.15;
      await wait(2);
      const kind = info.weapon?.kind;
      const before = kind ? g.weapons.status(kind) : null;
      g.interaction.mouseDown(2);
      // (a charge, a draw, a lock: 1.3 s of game time; else a few frames)
      if (kind === "grenade" || kind === "bow" || kind === "railgun" || kind === "bazooka") {
        const t0 = performance.now();
        while (performance.now() - t0 < 1300) await wait(1);
        // (the railgun fires when its charge is full: game time, slower than the clock here)
        for (let n = 0; kind === "railgun" && g.weapons.rail.charging && n < 200; n++) await wait(1);
      } else await wait(3);
      g.interaction.mouseUp(2);
      await wait(3);
      g.interaction.mouseDown(0);
      await wait(2);
      g.interaction.mouseUp(0);
      await wait(2);
      const after = kind ? g.weapons.status(kind) : null;
      out.push({ name: info.name, kind, fired: before && after ? after.ammo !== before.ammo || after.reloading || kind === "sniper" : null });
      g.weapons.cancel?.();
      if (g.weapons.scoped) g.interaction.mouseDown(2), g.interaction.mouseUp(2);
    }
    g.inventory.slots[0] = null;
    return out;
  };

  await browserCheck("a Missions world's Creative: the Weapons tab has every hand weapon, and each is used without an error", async () => {
    await play(page);
    await field(page);
    const tab = await v(page, WEAPONS_TAB, HAND_WEAPONS);
    assert(tab.tab >= 0 && !tab.missing.length, `missing from the Weapons tab: ${JSON.stringify(tab.missing)}`);
    const used = await v(page, USE_ALL, tab.want);
    const guns = used.filter((u) => u.kind && u.kind !== "bow" && u.kind !== "minigun" && u.kind !== "sniper");
    assert(guns.every((u) => u.fired !== false), `each gun fired: ${JSON.stringify(guns)}`);
    if (args.verbose) console.log(`        used: ${used.map((u) => u.name).join(", ")}`);
  });

  // ---------- Tracks on the ground ----------
  // The model's lowest point against the ground under each point of it: the
  // deepest point inside the ground (how far a vertex is under the top of
  // the block column it is over) and, at rest on flat ground, its lowest
  // point over the ground.
  const MEASURE = async (g, tk) => {
    const B = await import("./js/blocks.js");
    const T = g.THREE;
    const veh = tk;
    veh.root.updateMatrixWorld(true);
    const m = new T.Matrix4();
    const p = new T.Vector3();
    let low = Infinity;
    let sink = 0;
    let sinkAt = null;
    let touch = Infinity; // (the least gap over the ground: it rests on it somewhere)
    const top = (x, z, from) => {
      for (let y = Math.floor(from); y > 0; y--) if (B.IS_SOLID[g.world.getBlock(Math.floor(x), y, Math.floor(z))]) return y + 1;
      return 0;
    };
    const hullY = veh.pos.y;
    const look = (geo, mw) => {
      const pos = geo.getAttribute("position");
      for (let i = 0; i < pos.count; i++) {
        p.set(pos.getX(i), pos.getY(i), pos.getZ(i)).applyMatrix4(mw);
        if (p.y > hullY + 1.2) continue;
        low = Math.min(low, p.y);
        const t = top(p.x, p.z, hullY + 3);
        touch = Math.min(touch, p.y - t);
        if (t - p.y > sink) {
          sink = t - p.y;
          sinkAt = [p.x, p.y, p.z, t];
        }
      }
    };
    veh.model.root.traverse((o) => {
      if (!o.isMesh || o.isSprite || !o.visible || o.material?.transparent) return;
      if (o.isInstancedMesh) {
        for (let k = 0; k < o.count; k++) {
          o.getMatrixAt(k, m);
          look(o.geometry, m.premultiply(o.matrixWorld));
        }
      } else look(o.geometry, o.matrixWorld);
    });
    return { low, sink, sinkAt, touch, y: veh.pos.y, pitch: veh.pitch, roll: veh.roll };
  };
  const KINDS = [["tank", "tiger"], ["tank", "mbt"], ["aapark", null], ["tel", null]];
  await browserCheck("tank tracks (and the truck's tyres) rest on the ground: flat ground, a slope of steps, a 1-block step", async () => {
    const res = {};
    for (const [type, kind] of KINDS) {
      const name = kind || type;
      for (const ground of ["flat", "stairs", "step"]) {
        const a = await field(page, { stairs: ground === "stairs", step: ground === "step" });
        const r = await v(page, async (g, [type, kind, ground, a, src]) => {
          const at = ground === "flat" ? a.z0 - 12 : ground === "step" ? a.z0 - 20 : a.z0 - 40;
          const tk = g.vehicles.create(type, { pos: [a.x0 + 0.5, a.y0 + 3, at + 0.5], yaw: 0, kind: kind || undefined });
          tk.settle?.(true);
          // (as it stands after a moment: its attitude eased, at rest)
          for (let i = 0; i < 60; i++) g.vehicles.update(1 / 30);
          const fn = new Function(`return ${src}`)();
          const m = await fn(g, tk);
          m.ground = a.y0 + 1;
          g.vehicles.remove(tk);
          return m;
        }, [type, kind, ground, a, MEASURE.toString()]);
        res[`${name}/${ground}`] = r;
      }
    }
    if (args.verbose) for (const [k, r] of Object.entries(res)) console.log(`        ${k}: low ${(r.low - r.ground).toFixed(3)} sink ${r.sink.toFixed(3)} touch ${r.touch.toFixed(3)} pitch ${r.pitch.toFixed(3)}`);
    for (const [k, r] of Object.entries(res)) {
      assert(r.sink < 0.03, `${k}: the model in the ground by ${r.sink.toFixed(3)} at ${JSON.stringify(r.sinkAt)}`);
      assert(r.touch < 0.05, `${k}: resting on nothing (the least gap ${r.touch.toFixed(3)})`);
      if (k.endsWith("/flat")) assert(r.low - r.ground > 0 && r.low - r.ground < 0.05 && Math.abs(r.pitch) < 0.01, `${k}: on the ground (lowest ${(r.low - r.ground).toFixed(3)} over it)`);
    }
  });

  // A close look at graphics=high (SHOTS=dir): the Tiger's tracks on grass.
  if (out && anyOnly("screenshot")) {
    await browserCheck("screenshot: a Tiger's tracks on the grass, close, graphics=high", async () => {
      // (The same page, its graphics put to high: a second page at high takes minutes to start here.)
      const hp = page;
      await hp.setViewportSize({ width: 1280, height: 720 });
      await v(hp, (g) => (g.setGraphics("high"), true));
      await play(hp);
      // (on dirt: the grass's plants would hide where the tracks meet it)
      const a = await field(hp, { top: 2 });
      await v(hp, (g, a) => {
        g.setMode("creative");
        g.sky?.setHours?.(10);
        const tk = g.vehicles.create("tank", { pos: [a.x0 + 0.5, a.y0 + 2, a.z0 - 10.5], yaw: Math.PI / 2, kind: "tiger" });
        tk.settle(true);
        g.player.flying = true;
        g.player.position.set(a.x0 + 3.5, a.y0 + 0.6, a.z0 - 6.5);
        g.player.yaw = Math.atan2(3, 4);
        g.player.pitch = -0.28;
        return true;
      }, a);
      await frames(hp, 40);
      await hp.screenshot({ path: path.join(out, "r18-tiger-tracks.png") });
      await v(hp, (g) => (g.setGraphics("low"), true));
      await hp.setViewportSize({ width: 960, height: 540 });
    });
  }

  // ---------- Online ----------
  if (args.online) {
    const { default: express } = await import("express");
    const { ExpressPeerServer } = await import("peer");
    const PEER_PORT = PORT + 50;
    const app = express();
    const peerHttp = app.listen(PEER_PORT, "127.0.0.1");
    app.use("/ufo", ExpressPeerServer(peerHttp, { path: "/" }));
    const NET_Q = `peerServer=127.0.0.1:${PEER_PORT}/ufo&noStun=1&graphics=low`;
    // (The solo page's work is done: its frames would only slow the two here.)
    await page.close();
    const host = await newPage("host", { width: 640, height: 360 });
    // (Nothing drawn on the two pages: the world still runs, the tests read it.)
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
    const guest = await newPage("guest", { width: 640, height: 360 });
    await browserCheck("online: the guest and the host each teleport to the Moon alone, and home", async () => {
      await host.goto(`http://127.0.0.1:${PORT}/index.html?seed=9182&type=missions&${NET_Q}`, { waitUntil: "load", timeout: 60000 });
      await host.waitForFunction(() => !!window.__ufo && window.__ufo.graphicsReady, null, { timeout: 120000 });
      await host.click("#menu-mp-btn");
      await host.fill("#mp-nick", "Alice");
      await host.click("#mp-host-btn");
      const code = await until(host, (g) => g.net.code, 30000);
      assert(code, "no room code");
      await host.click("#mp-lobby-play");
      await host.waitForFunction(() => window.__ufo.gameState === "playing", null, { timeout: 30000 });
      await v(host, noDraw);
      await v(host, (g) => {
        g.mp.rules.setMode("creative");
        return true;
      });
      await guest.goto(`http://127.0.0.1:${PORT}/index.html?join=${code}&${NET_Q}`, { waitUntil: "load", timeout: 60000 });
      await guest.waitForSelector("#mp-join-boot:not(.hidden)", { timeout: 30000 });
      await guest.fill("#mp-boot-nick", "Bob");
      await guest.click("#mp-boot-join");
      await guest.waitForFunction(() => !!window.__ufo && window.__ufo.graphicsReady, null, { timeout: 120000 });
      assert(await until(guest, (g) => g.mp.stateLoaded, 150000), "the host's state never arrived");
      await v(guest, noDraw);
      // (Online the world runs behind the pause menu too: the teleport works from either.)
      await play(guest).catch(() => {});
      if (args.verbose) console.log(`        guest: ${await v(guest, (g) => g.gameState)}`);
      assert(await until(guest, (g) => g.player.creative, 20000), "the guest is in the room's Creative");
      const gs = await teleport(guest, "moon");
      assert(gs.dim === "moon" && gs.solidBelow && gs.openFeet, `the guest on the Moon: ${JSON.stringify(gs)}`);
      const hostDim = await v(host, (g) => g.world.dim);
      assert(hostDim === "overworld", `the host stayed home: ${hostDim}`);
      const seen = await until(host, (g) => {
        const pid = [...g.net.players.values()].find((p) => p.nick === "Bob")?.pid;
        return pid && (g.net.players.get(pid)?.dim | 0) === 3 ? true : null;
      }, 20000);
      assert(seen, "the host knows the guest is on the Moon");
      await play(host).catch(() => {});
      if (args.verbose) console.log(`        host: ${await v(host, (g) => g.gameState)}`);
      const hs = await teleport(host, "moon");
      assert(hs.dim === "moon" && hs.solidBelow, `the host on the Moon: ${JSON.stringify(hs)}`);
      const gh = await teleport(guest, "overworld");
      assert(gh.dim === "overworld" && gh.solidBelow, `the guest home: ${JSON.stringify(gh)}`);
      const hh = await teleport(host, "overworld");
      assert(hh.dim === "overworld" && hh.solidBelow, `the host home: ${JSON.stringify(hh)}`);
    });
    await guest.close();
    await host.close();
    peerHttp.close();
  }

  await browser.close();
  server.close();
}

// ---------- Summary ----------
const failed = results.filter(([, ok]) => !ok);
console.log(`\n${results.length - failed.length} passed, ${failed.length} failed.`);
process.exit(failed.length ? 1 : 0);
