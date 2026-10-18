// Round 12 "nethermobs" tests: the creatures of the Nether and the End
// (js/mobs.js, js/mob-models.js, js/net/entities.js, js/content/mobs-vanilla.js).
// In the browser (the real game, a Survival world): every new model builds
// and is drawn (a screenshot of them in a row with SHOTS=dir); each kind
// spawns where it should (the Nether's lists by its floor, a fortress's,
// the End's endermen, striders on the lava, a portal's zombified piglin, an
// ender pearl's endermite) and nothing of the Overworld's in the Nether; a
// ghast shoots at a player level with it and its fireball blows up; a
// fireball hit back kills the ghast (the advancement); a blaze's burst sets
// the player alight; a zombified piglin's group turns on whoever hits one
// (not the one far off); piglins leave a player in gold be, barter for a
// gold ingot, turn zombified out of the Nether; a wither skeleton's blow
// withers; a hoglin tosses the player and keeps away from warped fungi; a
// strider walks on lava and goes cold off it; a magma cube splits; a
// shulker opens, its bullet makes the player levitate; the drops; a
// shulker kept in the save; a bastion's piglins and an end city's shulkers
// put down once and kept. With --online: a guest sees the host's ghast,
// its shooting face and its fireball, and its blow on the fireball sends
// it back as the guest's; the host's piglins know a guest's gold and
// barter for its ingot.
//
//   node r12-nethermobs-tests.mjs [--only=substring] [--online]
// (GAME_ROOT=dir runs another copy of the game; SHOTS=dir keeps screenshots.)
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
const V = await imp("js/content/ids.js");
const { BLOCK, ITEM } = await imp("js/content/base.js");

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

const NEW_KINDS = ["ghast", "blaze", "magma_cube", "magma_cube_medium", "magma_cube_small", "piglin", "zombified_piglin", "hoglin", "zoglin", "wither_skeleton", "strider", "endermite", "silverfish", "shulker", "ghast_fireball", "small_fireball", "shulker_bullet"];

const { chromium } = await import("playwright-core");
const PORT = 9930 + Math.floor(Math.random() * 40);
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
  while (Date.now() - t0 < 400000) {
    const st = await v(p, (g) => g.gameState);
    if (st === "playing") return;
    if (st === "dead") {
      await v(p, (g) => g.respawn());
      continue;
    }
    if (st === "start") await p.click("#play-btn", { timeout: 60000 }).catch(() => {});
    else if (await p.isVisible("#resume-btn").catch(() => false)) await p.click("#resume-btn", { timeout: 60000 }).catch(() => {});
    else if (await p.isVisible("#click-to-play").catch(() => false)) await p.click("#click-to-play", { timeout: 60000 }).catch(() => {});
    else {
      await p.mouse.click(300, 200);
      await frames(p, 5);
    }
    await frames(p, 3);
  }
  throw new Error("the game didn't start playing");
}
async function boot(p, query) {
  await p.goto(`http://127.0.0.1:${PORT}/index.html?${query}`, { waitUntil: "load", timeout: 60000 });
  await p.waitForFunction(() => !!window.__ufo && window.__ufo.graphicsReady, null, { timeout: 180000 });
  await play(p);
}
async function travel(p, dim, x, y, z) {
  const ok = await v(p, (g, a) => g.dims.travel(a[0], a[1], a[2], a[3]), [dim, x, y, z]);
  assert(ok, `the travel to ${dim} was refused`);
  assert(await until(p, (g) => !g.dims.pending, 90000), `the travel to ${dim} never ended`);
  await frames(p, 2);
}
// The page's helpers: a room of air with a floor, the creatures' clock run
// without frames (the AI alone: a slow software renderer would take minutes),
// spawning at an offset from the player.
async function helpers(p) {
  await v(p, (g) => {
    window.__nm = {
      room(cx, y, cz, r, h, floor, wall = 0) {
        const list = [];
        for (let x = cx - r; x <= cx + r; x++) {
          for (let z = cz - r; z <= cz + r; z++) {
            list.push(x, y - 1, z, floor);
            for (let k = 0; k < h; k++) list.push(x, y + k, z, 0);
            if (wall) list.push(x, y + h, z, wall);
          }
        }
        g.world.setBlocks(list);
      },
      sim(seconds, each) {
        const n = Math.round(seconds / 0.05);
        for (let i = 0; i < n; i++) {
          g.mobs.update(0.05);
          // (the player's hurt grace runs out as in its own update)
          g.player._invulnerable = Math.max(0, (g.player._invulnerable || 0) - 0.05);
          if (each && each(i)) return i;
        }
        return n;
      },
      at(kind, dx, dy, dz, opts) {
        const p = g.player.position;
        return g.mobs.spawn(kind, p.x + dx, p.y + dy, p.z + dz, opts || {});
      },
      clear() {
        g.mobs.clear();
        g.entities.items.length && g.entities.clear?.();
      },
      kinds() {
        return g.mobs.mobs.filter((m) => !m.dead).map((m) => m.kind);
      },
    };
    g.mobs.enabled = false; // (no spawning of its own: the checks spawn what they test)
    return true;
  });
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
if (out) fs.mkdirSync(out, { recursive: true });
const SEED = 9201;
const page = await newPage("solo");
await boot(page, `seed=${SEED}&type=survival&graphics=low`);
await helpers(page);
// A platform high in the Overworld's sky (the fights), the player on it in Survival at noon.
const SKY = await v(page, (g) => {
  const p = g.player.position;
  const P = [Math.floor(p.x), 112, Math.floor(p.z)];
  window.__nm.room(P[0], P[1], P[2], 14, 8, 1);
  g.sky.locked = true;
  g.sky.setHours(12);
  g.weather.set("clear", 1000, { instant: true });
  return P;
});
async function onSky(p) {
  await v(p, (g, P) => {
    window.__nm.clear();
    g.setMode("survival");
    g.player.flying = false;
    g.player.position.set(P[0] + 0.5, P[1], P[2] + 0.5);
    g.player.velocity.set(0, 0, 0);
    g.player.health = 20;
    g.player._invulnerable = 0;
    g.player.fireTime = 0;
    g.player.clearEffects?.();
    g.player.yaw = Math.PI; // (looking toward +z)
    g.player.pitch = 0;
    g.inventory.armor.fill(null);
    return true;
  }, SKY);
}

await browserCheck("every new creature's model builds and is drawn (a row of them: SHOTS)", async () => {
  const r = await v(page, (g, kinds) => {
    window.__nm.clear();
    g.setMode("creative");
    const p = g.player.position;
    const P = [Math.floor(p.x), 112, Math.floor(p.z)];
    g.player.position.set(P[0] + 0.5, P[1], P[2] + 0.5);
    g.player.yaw = Math.PI;
    g.player.pitch = -0.12;
    const bad = [];
    const show = kinds.filter((k) => !k.includes("_medium") && !k.includes("_small") && k !== "zoglin");
    show.forEach((k, i) => {
      const x = P[0] + 0.5 + (i - (show.length - 1) / 2) * 2.6;
      const z = P[2] + (k === "ghast" ? 22 : 11);
      const y = k === "ghast" ? P[1] + 2.5 : k.includes("fireball") || k.includes("bullet") ? P[1] + 1.2 : P[1];
      const m = g.mobs.spawn(k, x, y, z, { wet: true });
      if (!m || !m.model.meshes.length) bad.push(k);
      else {
        m.yaw = Math.PI;
        if (k === "shulker") m.peek = 0.7;
        if (k === "ghast") m.shootFace = false;
      }
    });
    // (frozen in place: only their animation runs)
    g.mobs._realUpdate = g.mobs.update;
    g.mobs.update = function (dt) {
      this.time += dt;
      for (const m of this.mobs) this._afterMove(m, 10, 99);
    };
    return { bad, n: g.mobs.mobs.length };
  }, NEW_KINDS);
  assert(!r.bad.length, `models missing: ${r.bad}`);
  await frames(page, 6);
  if (out) await page.screenshot({ path: path.join(out, "models-row.png") });
  // Up close: the hoglin, the piglins, the wither skeleton, the strider, the blaze.
  await v(page, (g) => {
    const p = g.player.position;
    for (const m of g.mobs.mobs) if (["ghast", "endermite", "silverfish", "shulker", "ghast_fireball", "small_fireball", "shulker_bullet", "magma_cube"].includes(m.kind)) m.model.root.visible = false;
    g.player.position.set(p.x, p.y + 1.2, p.z + 6);
    return true;
  });
  await frames(page, 4);
  if (out) await page.screenshot({ path: path.join(out, "models-close.png") });
  await v(page, (g) => {
    g.mobs.update = g.mobs._realUpdate;
    window.__nm.clear();
    return true;
  });
});

await browserCheck("a ghast shoots at a player level with it; its fireball flies at them and blows up", async () => {
  await onSky(page);
  const r = await v(page, () => {
    const nm = window.__nm;
    const g = window.__ufo;
    const ghast = nm.at("ghast", 0, -1, 20);
    const before = g.effects.explosionCount;
    let fb = 0;
    let face = false;
    const n = nm.sim(12, () => {
      face ||= ghast.shootFace;
      if (g.mobs.mobs.some((m) => m.kind === "ghast_fireball")) fb++;
      return g.effects.explosionCount > before;
    });
    return { fb, face, blasts: g.effects.explosionCount - before, health: g.player.health, n, target: ghast.ai.target };
  });
  assert(r.target && r.face, `the ghast never saw the player or opened its face: ${JSON.stringify(r)}`);
  assert(r.fb > 0 && r.blasts > 0, `no fireball, or it never blew up: ${JSON.stringify(r)}`);
  assert(r.health < 20, `the player wasn't hurt: ${JSON.stringify(r)}`);
});

await browserCheck("a ghast doesn't notice a player far below it", async () => {
  await onSky(page);
  const r = await v(page, () => {
    const nm = window.__nm;
    const ghast = nm.at("ghast", 0, 14, 20);
    ghast.ai.dest = { x: ghast.pos.x, y: ghast.pos.y + 2, z: ghast.pos.z };
    ghast.ai.destT = 99;
    nm.sim(3);
    return { target: ghast.ai.target, fb: window.__ufo.mobs.mobs.some((m) => m.kind === "ghast_fireball") };
  });
  assert(!r.target && !r.fb, `it went for a player 14 blocks below it: ${JSON.stringify(r)}`);
});

await browserCheck("a fireball hit back kills the ghast that shot it (Return to Sender)", async () => {
  await onSky(page);
  const r = await v(page, () => {
    const nm = window.__nm;
    const g = window.__ufo;
    let toast = "";
    const prev = g.mobs.onToast;
    g.mobs.onToast = (t) => (toast = t);
    const ghast = nm.at("ghast", 0, -1, 24);
    ghast.ai.dest = { x: ghast.pos.x, y: ghast.pos.y + 2, z: ghast.pos.z };
    ghast.ai.destT = 99;
    const p = g.player.position;
    const from = new g.THREE.Vector3(p.x, p.y + 1.5, p.z + 3);
    const fb = g.mobs._launch("ghast_fireball", from, new g.THREE.Vector3(0, 0, -1), ghast);
    const hit = g.mobs.attack(fb, null);
    const back = fb.power.z > 0 && fb.shooterPid === g.mobs.localPid;
    nm.sim(6, () => ghast.dead);
    g.mobs.onToast = prev;
    return { hit, back, dead: ghast.dead, toast, health: g.player.health };
  });
  assert(r.hit && r.back, `the fireball wasn't sent back: ${JSON.stringify(r)}`);
  assert(r.dead && /Return to Sender/.test(r.toast), `the ghast lived, or no advancement: ${JSON.stringify(r)}`);
});

await browserCheck("a blaze charges and fires three small fireballs that set the player alight", async () => {
  await onSky(page);
  const r = await v(page, () => {
    const nm = window.__nm;
    const g = window.__ufo;
    const blaze = nm.at("blaze", 0, 0, 6);
    let charged = false;
    let shots = 0;
    const seen = new Set();
    nm.sim(80, () => {
      charged ||= blaze.charged;
      for (const m of g.mobs.mobs) if (m.kind === "small_fireball" && !seen.has(m.id)) {
        seen.add(m.id);
        shots++;
      }
      return shots >= 3 && g.player.fireTime > 0;
    });
    return { charged, shots, fire: g.player.fireTime, health: g.player.health };
  });
  assert(r.charged && r.shots >= 3, `no burst: ${JSON.stringify(r)}`);
  assert(r.fire > 0 && r.health < 20, `the player wasn't set alight: ${JSON.stringify(r)}`);
});

await browserCheck("zombified piglins: neutral, and a hit turns its whole group on the player (not one far off)", async () => {
  await onSky(page);
  const r = await v(page, () => {
    const nm = window.__nm;
    const g = window.__ufo;
    const group = [nm.at("zombified_piglin", -1, 0, 6), nm.at("zombified_piglin", 1, 0, 6), nm.at("zombified_piglin", 0, 0, 8), nm.at("zombified_piglin", 2, 0, 9)];
    const far = nm.at("zombified_piglin", 0, 0, -12);
    far.pos.z = group[0].pos.z + 26;
    nm.sim(1.5);
    const calm = group.every((m) => !m.ai.target && !(m.angerT > 0));
    g.mobs.attack(group[0], null);
    nm.sim(0.5);
    return { calm, angry: group.map((m) => m.angerT > 0 && m.foe === g.player), far: far.angerT > 0, health0: g.player.health };
  });
  assert(r.calm, "they went for the player before any hit");
  assert(r.angry.every(Boolean), `not all of the group turned: ${r.angry}`);
  assert(!r.far, "one 26 blocks off turned too");
});

await browserCheck("piglins: hostile without gold armor, calm with a gold helmet; a gold ingot bartered for vanilla's goods; out of the Nether one turns zombified", async () => {
  await onSky(page);
  const r = await v(page, (g, ids) => {
    const nm = window.__nm;
    const a = nm.at("piglin", 0, 0, 6);
    nm.sim(1.5);
    const hostile = a.ai.target;
    window.__nm.clear();
    g.inventory.armor[0] = { id: ids.GOLD_HELMET, count: 1 };
    const b = nm.at("piglin", 0, 0, 3);
    nm.sim(2);
    const calm = !b.ai.target;
    g.inventory.slots[g.inventory.selected] = { id: ids.GOLD_INGOT, count: 3 };
    const before = g.entities.items.length;
    const took = g.mobs.useMob(b, g.inventory.selectedStack);
    const admiring = b.admireT > 0;
    nm.sim(6.5);
    const got = g.entities.items.slice(before).map((it) => it.id);
    // Out of the Nether: 15 s then a zombified piglin.
    b.zombT = 14.8;
    nm.sim(0.5);
    return { hostile, calm, took, admiring, got, ingots: g.inventory.selectedStack?.count, zomb: nm.kinds() };
  }, { GOLD_HELMET: ITEM.GOLD_HELMET, GOLD_INGOT: ITEM.GOLD_INGOT });
  assert(r.hostile, "a piglin left a player without gold be");
  assert(r.calm, "a piglin went for a player in a gold helmet");
  assert(r.took && r.admiring && r.ingots === 2, `the ingot wasn't taken: ${JSON.stringify(r)}`);
  assert(r.got.length > 0, `nothing bartered: ${JSON.stringify(r)}`);
  assert(r.zomb.includes("zombified_piglin") && !r.zomb.includes("piglin"), `no zombification: ${JSON.stringify(r)}`);
});

await browserCheck("a wither skeleton's blow withers the player", async () => {
  await onSky(page);
  const r = await v(page, () => {
    const nm = window.__nm;
    const g = window.__ufo;
    nm.at("wither_skeleton", 0, 0, 1.6);
    nm.sim(4, () => g.player.effects.some((e) => e.effect === "wither"));
    return { wither: g.player.effects.find((e) => e.effect === "wither"), health: g.player.health };
  });
  assert(r.wither && r.wither.time > 5 && r.health < 20, `no wither: ${JSON.stringify(r)}`);
});

await browserCheck("a hoglin tosses the player up; it keeps away from a warped fungus", async () => {
  await onSky(page);
  const r = await v(page, (g, fungus) => {
    const nm = window.__nm;
    const hog = nm.at("hoglin", 0, 0, 2);
    let up = 0;
    const imp = g.player.applyImpulse.bind(g.player);
    g.player.applyImpulse = (vv) => {
      up = Math.max(up, vv.y);
      return imp(vv);
    };
    nm.sim(4, () => up > 0);
    g.player.applyImpulse = imp;
    const hurt = g.player.health < 20;
    window.__nm.clear();
    // The fungus: the hoglin backs off (a Creative player: no target to chase).
    let fear = null;
    if (Number.isFinite(fungus) && g.world.setBlock(Math.floor(g.player.position.x) + 6, Math.floor(g.player.position.y), Math.floor(g.player.position.z) + 6, fungus)) {
      g.setMode("creative");
      const h2 = nm.at("hoglin", 3.5, 0, 6.5);
      const f = [Math.floor(g.player.position.x) + 6.5, Math.floor(g.player.position.z) + 6.5];
      const d0 = Math.hypot(h2.pos.x - f[0], h2.pos.z - f[1]);
      nm.sim(3);
      fear = { d0, d1: Math.hypot(h2.pos.x - f[0], h2.pos.z - f[1]) };
      g.world.setBlock(Math.floor(g.player.position.x) + 6, Math.floor(g.player.position.y), Math.floor(g.player.position.z) + 6, 0);
      g.setMode("survival");
    }
    return { up, hurt, fear };
  }, V.WARPED_FUNGUS);
  assert(r.up > 6 && r.hurt, `no toss: ${JSON.stringify(r)}`);
  if (r.fear) assert(r.fear.d1 > r.fear.d0 + 1, `it didn't keep away from the fungus: ${JSON.stringify(r.fear)}`);
});

await browserCheck("a strider stands on lava, warm; on land it is cold", async () => {
  await onSky(page);
  const r = await v(page, (g, lava) => {
    const nm = window.__nm;
    const p = g.player.position;
    const x0 = Math.floor(p.x) + 4;
    const z0 = Math.floor(p.z) + 4;
    const y = Math.floor(p.y);
    const list = [];
    for (let x = x0; x < x0 + 5; x++) for (let z = z0; z < z0 + 5; z++) list.push(x, y - 1, z, lava, x, y - 2, z, lava);
    g.world.setBlocks(list);
    const s = g.mobs.spawn("strider", x0 + 2.5, y - 1.5, z0 + 2.5);
    nm.sim(2);
    const onLava = { y: s.pos.y, lava: s.onLava, cold: s.cold };
    s.pos.set(p.x - 4, y, p.z - 4);
    nm.sim(1);
    const land = { cold: s.cold };
    const back = [];
    for (let x = x0; x < x0 + 5; x++) for (let z = z0; z < z0 + 5; z++) back.push(x, y - 1, z, 1, x, y - 2, z, 0);
    g.world.setBlocks(back);
    return { onLava, land, surface: y };
  }, V.LAVA);
  assert(r.onLava.lava && !r.onLava.cold && Math.abs(r.onLava.y - r.surface) < 0.3, `not on the lava: ${JSON.stringify(r)}`);
  assert(r.land.cold, "not cold on land");
});

await browserCheck("a big magma cube splits into medium ones; its kind jumps higher than a slime", async () => {
  await onSky(page);
  const r = await v(page, () => {
    const nm = window.__nm;
    const g = window.__ufo;
    g.setMode("creative");
    const m = nm.at("magma_cube", 0, 0, 6);
    let peak = m.pos.y;
    nm.sim(6, () => {
      peak = Math.max(peak, m.pos.y);
      return false;
    });
    g.mobs._hurt(m, 100, { x: 0, z: 1 }, 0, true);
    nm.sim(1.2);
    return { jump: peak - g.player.position.y, kids: nm.kinds().filter((k) => k === "magma_cube_medium").length };
  });
  assert(r.kids >= 2 && r.kids <= 4, `split into ${r.kids}`);
  assert(r.jump > 1.6, `it only jumped ${r.jump}`);
});

await browserCheck("a shulker opens at a player and its bullet makes them levitate", async () => {
  await onSky(page);
  const r = await v(page, () => {
    const nm = window.__nm;
    const g = window.__ufo;
    const s = nm.at("shulker", 0, 0, 7);
    let open = 0;
    let bullet = false;
    nm.sim(12, () => {
      open = Math.max(open, s.peek || 0);
      bullet ||= g.mobs.mobs.some((m) => m.kind === "shulker_bullet");
      return g.player.effects.some((e) => e.effect === "levitation");
    });
    const kept = g.mobs.serializeKept()?.some((e) => e[0] === "shulker");
    return { open, bullet, lev: g.player.effects.some((e) => e.effect === "levitation"), health: g.player.health, kept, variant: s.variant };
  });
  assert(r.open > 0.9 && r.bullet, `it never opened or shot: ${JSON.stringify(r)}`);
  assert(r.lev && r.health < 20, `no levitation: ${JSON.stringify(r)}`);
  assert(r.kept && r.variant === 0, `not kept in the save, or not on the floor: ${JSON.stringify(r)}`);
});

await browserCheck("drops: blaze rods, a ghast's gunpowder or tear, a wither skeleton's bones, a zombified piglin's flesh or gold, a hoglin's pork, a strider's string, a magma cube's cream", async () => {
  await onSky(page);
  const r = await v(page, (g, ids) => {
    const nm = window.__nm;
    g.setMode("creative");
    // (every drop as it is made: the item list itself merges and evicts)
    const got = new Set();
    const spawn = g.entities.spawn;
    g.entities.spawn = function (id, ...rest) {
      got.add(id);
      return spawn.call(this, id, ...rest);
    };
    const kill = (kind, n) => {
      for (let i = 0; i < n; i++) {
        const m = nm.at(kind, (i % 5) * 1.5 - 3, 0, 5 + Math.floor(i / 5) * 2);
        if (!m) continue;
        m.invulnerable = 0;
        g.mobs._hurt(m, 1000, { x: 0, z: 1 }, 0, true);
      }
      nm.sim(1.2);
    };
    try {
      for (const [k, n] of [["blaze", 10], ["ghast", 4], ["wither_skeleton", 4], ["zombified_piglin", 10], ["hoglin", 2], ["strider", 2], ["magma_cube_medium", 16]]) kill(k, n);
    } finally {
      g.entities.spawn = spawn;
    }
    return Object.fromEntries(Object.entries(ids).map(([k, id]) => [k, got.has(id)]));
  }, { blaze: V.BLAZE_ROD, ghast: V.GUNPOWDER, bones: V.BONE, flesh: V.ROTTEN_FLESH, pork: V.PORKCHOP, string: V.STRING, cream: V.MAGMA_CREAM });
  const missing = Object.entries(r).filter(([, ok]) => !ok).map(([k]) => k);
  assert(!missing.length, `no drop of: ${missing}`);
});

await browserCheck("an ender pearl's endermite (1 in 20); a nether portal's zombified piglin in the Overworld", async () => {
  await onSky(page);
  const r = await v(page, () => {
    const g = window.__ufo;
    const rnd = Math.random;
    Math.random = () => 0.01;
    let mite;
    try {
      const p = g.player.position;
      mite = g.mobs.pearlLanded?.(p.x + 2, p.y, p.z + 2);
    } finally {
      Math.random = rnd;
    }
    const p = g.player.position;
    const z = g.mobs.portalSpawn(Math.floor(p.x) - 3, Math.floor(p.y), Math.floor(p.z) + 5);
    return { mite: mite?.kind, piglin: z?.kind };
  });
  assert(r.mite === "endermite", `no endermite: ${JSON.stringify(r)}`);
  assert(r.piglin === "zombified_piglin", `no portal piglin: ${JSON.stringify(r)}`);
});

// ---------- The Nether ----------
await browserCheck("the Nether: each floor's creatures (vanilla's lists), a fortress's, striders on the lava, none of the Overworld's", async () => {
  await v(page, (g) => {
    window.__nm.clear();
    g.setMode("creative");
    return true;
  });
  const P = await v(page, (g) => [Math.floor(g.player.position.x), Math.floor(g.player.position.z)]);
  await travel(page, "nether", P[0] + 0.5, 100, P[1] + 0.5);
  await helpers(page);
  assert(await until(page, (g) => {
    const p = g.player.position;
    return !!g.world.getChunk((Math.floor(p.x) + 34) >> 4, Math.floor(p.z) >> 4) && !!g.world.getChunk((Math.floor(p.x) - 30) >> 4, Math.floor(p.z) >> 4);
  }, 60000), "the Nether's ground near never came in");
  const r = await v(page, (g, ids) => {
    const nm = window.__nm;
    const p = g.player.position;
    const Y = 100;
    // (The generator's biome and fortress words aside: the floors decide here.)
    const t = g.world.terrain;
    const saved = [t.biomeNameAt, t.biomeAt, t.structures];
    t.biomeNameAt = undefined;
    t.biomeAt = () => -1;
    t.structures = null;
    const ready = g.mobs._chunkReady;
    g.mobs._chunkReady = () => true; // (the rooms' ground is in: not yet drawn is no matter here)
    const out = {};
    try {
      for (const [name, floor] of Object.entries(ids)) {
        if (!Number.isFinite(floor) || name === "lava") continue;
        nm.clear();
        const x = Math.floor(p.x) + 34;
        const z = Math.floor(p.z);
        nm.room(x, Y, z, 7, 7, floor, 1);
        const kinds = new Set();
        for (let i = 0; i < 400 && kinds.size < 6; i++) {
          g.mobs.netherSpawnAt(x, Y, z);
          for (const k of nm.kinds()) kinds.add(k);
          nm.clear();
        }
        out[name] = [...kinds].sort();
      }
    } finally {
      [t.biomeNameAt, t.biomeAt, t.structures] = saved;
      g.mobs._chunkReady = ready;
    }
    // Striders on a lava lake.
    nm.clear();
    const lx = Math.floor(p.x) - 30;
    const lz = Math.floor(p.z);
    const lake = [];
    for (let x = lx - 6; x <= lx + 6; x++) for (let z = lz - 6; z <= lz + 6; z++) lake.push(x, Y - 1, z, ids.lava, x, Y, z, 0, x, Y + 1, z, 0, x, Y + 2, z, 0);
    g.world.setBlocks(lake);
    for (let i = 0; i < 20; i++) g.mobs.striderSpawnAt(lx + Math.floor(Math.random() * 13) - 6, lz + Math.floor(Math.random() * 13) - 6);
    const striders = g.mobs.mobs.filter((m) => m.kind === "strider").length;
    const st = g.mobs.mobs.find((m) => m.kind === "strider");
    nm.clear();
    // A bastion's piglins (its walls: bastionAt), put down once and kept.
    const bx = Math.floor(p.x) + 34;
    const bz = Math.floor(p.z);
    nm.room(bx, Y, bz, 7, 7, ids.wastes, 1);
    const saved2 = t.structures;
    t.structures = { bastionAt: (x, y, z) => Math.abs(x - bx) <= 7 && Math.abs(z - bz) <= 7 && y >= Y - 1 && y <= Y + 7 };
    const ready2 = g.mobs._chunkReady;
    g.mobs._chunkReady = () => true;
    g.mobs._structDone.clear();
    g.mobs._structNone.clear();
    const pp = g.player.position.clone();
    g.player.position.set(bx + 20.5, Y + 2, bz + 0.5);
    let bastion = [];
    try {
      for (let i = 0; i < 4; i++) g.mobs._structureMobs();
      bastion = g.mobs.mobs.filter((m) => m.kind === "piglin").map((m) => m.persist);
      const again = g.mobs.mobs.length;
      g.mobs._structureMobs();
      if (g.mobs.mobs.length !== again) bastion.push("again");
    } finally {
      t.structures = saved2;
      g.mobs._chunkReady = ready2;
      g.player.position.copy(pp);
    }
    const kept = g.mobs.serializeKept()?.filter((e) => e[0] === "piglin" || e[0] === "@s").map((e) => e[0]);
    nm.clear();
    // The Nether's own spawning for a while: nothing of the Overworld's.
    g.mobs.enabled = true;
    for (let i = 0; i < 150; i++) g.mobs._spawnNether(0.4);
    const natural = [...new Set(nm.kinds())];
    g.mobs.enabled = false;
    nm.clear();
    return { out, striders, strider: st ? { y: st.pos.y } : null, natural, dim: g.dims.dim, bastion, kept };
  }, { wastes: V.NETHERRACK, crimson: V.CRIMSON_NYLIUM, warped: V.WARPED_NYLIUM, soul: V.SOUL_SAND, deltas: V.BASALT, fortress: V.NETHER_BRICKS, lava: V.LAVA });
  if (out) await page.screenshot({ path: path.join(out, "nether.png") });
  const allow = {
    wastes: ["ghast", "zombified_piglin", "magma_cube", "magma_cube_medium", "magma_cube_small", "enderman", "piglin"],
    crimson: ["zombified_piglin", "hoglin", "piglin"],
    warped: ["enderman"],
    soul: ["skeleton", "ghast", "enderman"],
    deltas: ["ghast", "magma_cube", "magma_cube_medium", "magma_cube_small"],
    fortress: ["blaze", "zombified_piglin", "wither_skeleton", "skeleton", "magma_cube", "magma_cube_medium", "magma_cube_small"],
  };
  for (const [name, kinds] of Object.entries(r.out)) {
    assert(kinds.length, `nothing came on the ${name} floor`);
    const wrong = kinds.filter((k) => !allow[name].includes(k));
    assert(!wrong.length, `on the ${name} floor: ${wrong}`);
  }
  assert(r.out.crimson?.includes("hoglin") && r.out.fortress?.includes("blaze") && r.out.fortress?.includes("wither_skeleton"), `the lists: ${JSON.stringify(r.out)}`);
  assert(r.striders > 0, "no strider on the lava");
  assert(r.bastion.length && r.bastion.every((k) => k === true), `a bastion's piglins: ${JSON.stringify(r.bastion)}`);
  assert(r.kept?.includes("piglin") && r.kept?.includes("@s"), `the bastion's piglins not kept: ${JSON.stringify(r.kept)}`);
  const overworld = r.natural.filter((k) => ["zombie", "creeper", "spider", "cow", "pig", "sheep", "chicken", "witch", "slime", "wolf"].includes(k));
  assert(!overworld.length, `the Overworld's in the Nether: ${overworld}`);
  console.log(`    (the Nether's floors: ${JSON.stringify(r.out)}; its own spawning: ${r.natural})`);
});

// ---------- The End ----------
await browserCheck("the End: endermen on its island, nothing else", async () => {
  await travel(page, "end", 100.5, 50, 0.5);
  await helpers(page);
  const r = await v(page, (g) => {
    const nm = window.__nm;
    nm.clear();
    g.mobs.enabled = true;
    const p = g.player.position.clone();
    // (from over the island, so its ground is near)
    g.player.position.set(30, p.y, 0);
    for (let i = 0; i < 300 && nm.kinds().length < 4; i++) g.mobs._spawnEnd(0.4);
    g.player.position.copy(p);
    g.mobs.enabled = false;
    const kinds = nm.kinds();
    nm.clear();
    // An end city's shulkers (shulkerSpots): put down once, on their floor, kept.
    const t = g.world.terrain;
    const saved = t.structures;
    const P = [Math.floor(p.x) + 3, Math.floor(p.y), Math.floor(p.z) + 3];
    g.world.setBlock(P[0], P[1] - 1, P[2], 1);
    g.world.setBlock(P[0], P[1], P[2], 0);
    t.structures = { shulkerSpots: (cx, cz) => (cx === P[0] >> 4 && cz === P[2] >> 4 ? [P.slice()] : []) };
    let sh = [];
    try {
      g.mobs._structDone.clear();
      g.mobs._structNone.clear();
      for (let i = 0; i < 3; i++) g.mobs._structureMobs();
      sh = g.mobs.mobs.filter((m) => m.kind === "shulker").map((m) => ({ persist: m.persist, variant: m.variant, at: [Math.floor(m.pos.x), Math.floor(m.pos.y), Math.floor(m.pos.z)] }));
    } finally {
      t.structures = saved;
    }
    nm.clear();
    return { kinds, dim: g.dims.dim, sh, P };
  });
  assert(r.dim === "end", "not in the End");
  assert(r.kinds.length && r.kinds.every((k) => k === "enderman"), `the End's: ${r.kinds}`);
  assert(r.sh.length === 1 && r.sh[0].persist && r.sh[0].variant === 0 && r.sh[0].at.join() === r.P.join(), `an end city's shulker: ${JSON.stringify(r)}`);
  await travel(page, "overworld", SKY[0] + 0.5, SKY[1] + 1, SKY[2] + 0.5);
  await helpers(page);
});

// ---------- Online ----------
if (args.online) {
  const { default: express } = await import("express");
  const { ExpressPeerServer } = await import("peer");
  const PEER_PORT = PORT + 60;
  const app = express();
  const peerHttp = app.listen(PEER_PORT, "127.0.0.1");
  app.use("/ufo", ExpressPeerServer(peerHttp, { path: "/" }));
  const NET_Q = `peerServer=127.0.0.1:${PEER_PORT}/ufo&noStun=1&graphics=low`;
  await page.close();
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
  await browserCheck("online: a guest sees the host's ghast, its shooting face and its fireball; the guest's blow sends the fireball back as theirs", async () => {
    await host.goto(`http://127.0.0.1:${PORT}/index.html?seed=9203&type=survival&${NET_Q}`, { waitUntil: "load", timeout: 60000 });
    await host.waitForFunction(() => !!window.__ufo && window.__ufo.graphicsReady, null, { timeout: 180000 });
    const code = await v(host, (g) => g.mp.host("Alice", "survival"));
    assert(code, "no room code");
    await play(host);
    await v(host, noDraw);
    await guest.goto(`http://127.0.0.1:${PORT}/index.html?join=${code}&${NET_Q}`, { waitUntil: "load", timeout: 60000 });
    await guest.waitForSelector("#mp-join-boot:not(.hidden)", { timeout: 30000 });
    await guest.fill("#mp-boot-nick", "Bob");
    await guest.click("#mp-boot-join");
    await guest.waitForFunction(() => !!window.__ufo && window.__ufo.graphicsReady, null, { timeout: 180000 });
    assert(await until(guest, (g) => g.mp.stateLoaded, 60000), "the host's state never arrived");
    await v(guest, noDraw);
    await play(guest);
    assert(await until(host, (g) => [...g.mp.players.active()].length === 1, 30000), "the host never saw the guest");
    // The guest on a platform in the sky, in Survival; the host's ghast level with them.
    const G = await v(guest, (g) => {
      const p = g.player.position;
      const P = [Math.floor(p.x), 112, Math.floor(p.z)];
      const list = [];
      for (let x = P[0] - 4; x <= P[0] + 4; x++) for (let z = P[2] - 4; z <= P[2] + 4; z++) list.push(x, P[1] - 1, z, 1);
      g.world.setBlocks(list);
      g.player.flying = false;
      g.player.position.set(P[0] + 0.5, P[1], P[2] + 0.5);
      g.player.yaw = Math.PI;
      g.player.pitch = 0;
      return P;
    });
    await v(host, (g) => {
      g.mobs.enabled = false;
      g.mobs.clear();
      return true;
    });
    await until(host, (g) => {
      const r = [...g.mp.players.active()][0];
      return r && Math.abs(r.livePos.y - 112) < 1.5;
    }, 30000);
    await v(host, (g, P) => {
      const gh = g.mobs.spawn("ghast", P[0] + 0.5, P[1] - 1, P[2] + 18.5, { wet: true });
      gh.ai.dest = { x: gh.pos.x, y: gh.pos.y + 2, z: gh.pos.z };
      gh.ai.destT = 999;
      return true;
    }, G);
    const seen = await until(guest, (g) => [...g.mp.entities.mobById.values()].some((m) => m.kind === "ghast"), 30000);
    assert(seen, "the guest never saw the ghast");
    const face = await until(guest, (g) => [...g.mp.entities.mobById.values()].some((m) => m.kind === "ghast" && m.shootFace), 60000);
    assert(face, "the guest never saw its shooting face");
    const fb = await until(guest, (g) => [...g.mp.entities.mobById.values()].some((m) => m.kind === "ghast_fireball"), 60000);
    assert(fb, "the guest never saw a fireball");
    // The guest hits a fireball (one the host sends at it, right in front).
    await v(host, (g, P) => {
      for (const m of g.mobs.mobs) if (m.kind === "ghast_fireball") m.removed || g.mobs._remove(g.mobs.mobs.indexOf(m));
      const gh = g.mobs.mobs.find((m) => m.kind === "ghast");
      gh.ai.charge = -999; // (no more of its own)
      const f = g.mobs._launch("ghast_fireball", new g.THREE.Vector3(P[0] + 0.5, P[1] + 1.5, P[2] + 6.5), new g.THREE.Vector3(0, 0, -1), gh);
      f.power.set(0, 0, 0);
      f.pv.set(0, 0, 0);
      return true;
    }, G);
    const hit = await until(guest, (g, P) => {
      // (the one in front: not a puppet of the ghast's own still on its way out)
      const f = [...g.mp.entities.mobById.values()].find((m) => m.kind === "ghast_fireball" && Math.abs(m.pos.z - (P[2] + 6.5)) < 1.5 && Math.abs(m.pos.x - P[0] - 0.5) < 1.5);
      if (!f) return false;
      return g.mobs.attack(f, null);
    }, 30000, G);
    assert(hit, "the guest couldn't hit the fireball");
    const back = await until(host, (g) => {
      const pid = [...g.mp.players.active()][0]?.pid;
      const f = g.mobs.mobs.find((m) => m.kind === "ghast_fireball");
      const gh = g.mobs.mobs.find((m) => m.kind === "ghast");
      return (f && pid && f.shooterPid === pid && f.power.z > 0 && { pid: f.shooterPid }) || (gh?.dead && gh.lastHitPid === pid && { dead: true });
    }, 30000);
    assert(back, "the host didn't send it back as the guest's");
  });
  await browserCheck("online: the host's piglins leave a guest in gold be (its word), and barter for the guest's gold ingot", async () => {
    const pidOf = async () => v(host, (g) => [...g.mp.players.active()][0]?.pid);
    const pid = await pidOf();
    assert(pid, "no guest");
    await v(guest, (g, id) => {
      g.inventory.armor[0] = { id, count: 1 };
      return true;
    }, ITEM.GOLD_HELMET);
    assert(await until(host, (g, pid) => g.mp.entities.proxies.get(pid)?.goldArmor === true, 20000, pid), "the host never heard of the guest's gold");
    const calm = await v(host, (g, pid) => {
      g.mobs.clear();
      const r = [...g.mp.players.active()][0];
      const pg = g.mobs.spawn("piglin", r.livePos.x + 0.5, r.livePos.y, r.livePos.z + 3);
      for (let i = 0; i < 40; i++) g.mobs.update(0.05);
      return { target: pg.ai.target, id: pg.id };
    }, pid);
    assert(!calm.target, "the piglin went for the guest in gold");
    // The guest gives it a gold ingot (its puppet: a claim).
    const gave = await until(guest, (g, id) => {
      const pg = [...g.mp.entities.mobById.values()].find((m) => m.kind === "piglin");
      if (!pg) return false;
      g.inventory.slots[g.inventory.selected] = { id, count: 2 };
      return g.mobs.useMob(pg, g.inventory.selectedStack) && { left: g.inventory.selectedStack?.count };
    }, 30000, ITEM.GOLD_INGOT);
    assert(gave && gave.left === 1, `the guest couldn't give it: ${JSON.stringify(gave)}`);
    assert(await until(host, (g) => g.mobs.mobs.some((m) => m.kind === "piglin" && m.admireT > 0), 20000), "the host's piglin never took the ingot");
    // Without the gold: it goes for them.
    await v(guest, (g) => {
      g.inventory.armor[0] = null;
      return true;
    });
    assert(await until(host, (g, pid) => g.mp.entities.proxies.get(pid)?.goldArmor === false, 20000, pid), "the host never heard the gold was off");
    const angry = await v(host, () => {
      const g = window.__ufo;
      const pg = g.mobs.mobs.find((m) => m.kind === "piglin");
      pg.admireT = 0;
      for (let i = 0; i < 40; i++) g.mobs.update(0.05);
      return pg.ai.target;
    });
    assert(angry, "the piglin left the guest without gold be");
    await guest.close();
    await host.close();
  });
  peerHttp.close();
}

await browser.close();
server.close();
const failed = results.filter(([, ok]) => !ok);
console.log(`\n${results.length - failed.length} passed, ${failed.length} failed.`);
process.exit(failed.length ? 1 : 0);
