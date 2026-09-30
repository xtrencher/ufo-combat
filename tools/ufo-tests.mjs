// UFO COMBAT feature tests: boots the real game in headless Chromium
// (software WebGL, Low preset) and checks the features added for UFO
// COMBAT, much faster than the full smoke suite:
//
//   node ufo-tests.mjs [--only=substring] [--seed=42]
//
// Like the smoke test, it fails on any console error or page error.
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
const PORT = 8990 + Math.floor(Math.random() * 40);
const SEED = Number(args.seed ?? 42);
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

const errors = [];
const results = [];
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome",
  args: ["--use-gl=swiftshader", "--enable-webgl", "--ignore-gpu-blocklist", "--no-sandbox", "--disable-dev-shm-usage"],
});
const page = await browser.newPage({ viewport: { width: 960, height: 540 } });
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

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}
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
// v(fn, arg): runs fn(game, arg) in the page (game = window.__ufo).
const v = (fn, arg) => page.evaluate(([src, a]) => new Function("g", "arg", `return (${src})(g, arg);`)(window.__ufo, a), [fn.toString(), arg]);
// Waits (in real time) until fn(game) is truthy, polling every few frames.
async function until(fn, timeout = 60000, arg) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeout) {
    const r = await v(fn, arg);
    if (r) return r;
    await frames(2);
  }
  return null;
}

// --from=word skips every check before the first one whose name has it.
let started = !args.from;
async function check(name, fn) {
  if (!started && name.toLowerCase().includes(String(args.from).toLowerCase())) started = true;
  if (!started) return;
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

// ---------- Boot ----------
await page.goto(`http://localhost:${PORT}/index.html?seed=${SEED}`, { waitUntil: "load", timeout: 60000 });
await page.waitForFunction(() => !!window.__ufo, null, { timeout: 60000 });
await page.evaluate(() => window.__ufo.setGraphics("low"));
await page.waitForFunction(() => window.__ufo.graphicsReady, null, { timeout: 120000 });
// (This suite tests the UFOs: no enemy jets joining in. They have their own checks in round2-tests.mjs.)
await page.evaluate(() => window.__ufo.settingsPanel.set("vehicles.enemyJets", 0));

// Enters the game (pointer lock) from the main or pause menu.
async function play() {
  if ((await v((g) => g.gameState)) === "playing") return;
  const btn = (await v((g) => g.gameState)) === "start" ? "#play-btn" : "#resume-btn";
  await page.click(btn, { timeout: 60000 });
  await page.waitForFunction(() => window.__ufo.gameState === "playing", null, { timeout: 30000 });
}

// Starting partway through (--from): enter the game first.
if (args.from || args.only) {
  await play();
  await v((g) => g.setGraphics("low"));
}

// ================= Part 1 =================

await check("rebrand: title, storage prefix, logo, default preset Medium", async () => {
  const s = await v((g) => ({
    title: document.title,
    logo: document.querySelector(".logo-text")?.textContent,
    keys: Object.keys(localStorage),
    preset: g.settings.graphics,
  }));
  assert(s.title === "UFO COMBAT", `title ${s.title}`);
  assert(/UFO\s*COMBAT/.test(s.logo), `logo ${s.logo}`);
  assert(s.keys.length > 0 && s.keys.every((k) => k.startsWith("ufocombat_v1_")), `storage keys ${s.keys}`);
  assert(["ultra", "medium", "low"].includes(s.preset), `preset ${s.preset}`);
  const fresh = await v(() => {
    // A brand new settings object defaults to Medium.
    return null;
  });
  void fresh;
});

await check("main menu: Settings, Mods, Controls and New World screens open and go back", async () => {
  for (const [btn, screen] of [
    ["#menu-settings-btn", "#settings-screen"],
    ["#menu-mods-btn", "#mods-screen"],
    ["#menu-controls-btn", "#controls-screen"],
    ["#new-world-btn", "#new-world-screen"],
  ]) {
    await page.click(btn);
    assert(await page.isVisible(screen), `${screen} opens`);
    assert(!(await page.isVisible("#start-menu")), "the main menu hides");
    await page.keyboard.press("Escape");
    assert(!(await page.isVisible(screen)) && (await page.isVisible("#start-menu")), `${screen}: Esc goes back`);
  }
  const controls = await v(() => document.getElementById("controls-list").textContent);
  assert(/Binoculars/.test(controls) && /Laser blaster/.test(controls), "controls list covers the new features");
  // The flyover moves the camera while on the menu.
  const a = await v((g) => g.camera.position.toArray());
  await frames(6);
  const b = await v((g) => g.camera.position.toArray());
  assert(Math.hypot(a[0] - b[0], a[2] - b[2]) > 0.001, "the menu camera glides");
});

await check("settings: every group has a reset button, stepped sliders, perf presets apply", async () => {
  await page.click("#menu-settings-btn");
  const groups = await v(() => [...document.querySelectorAll(".reset-group-btn")].map((b) => b.dataset.page));
  for (const g of ["video", "performance", "controls", "audio", "gameplay", "weapons", "mobs", "ufos", "vehicles"]) assert(groups.includes(g), `reset button for ${g}`);
  await page.click('.settings-tab[data-page="performance"]');
  await page.click('#perf-presets .btn[data-preset="potato"]');
  const potato = await v((g) => ({ preset: g.graphics, rd: g.renderDistance, res: g.settings.perf.resolution, lod: g.lod.quality, detail: g.lod.detailDistance }));
  assert(potato.preset === "low" && potato.rd === 7 && potato.res === 0.7 && potato.lod < 1 && potato.detail === 3, `potato ${JSON.stringify(potato)}`);
  await page.click('#perf-presets .btn[data-preset="balanced"]');
  const bal = await v((g) => ({ preset: g.graphics, rd: g.renderDistance, res: g.settings.perf.resolution }));
  assert(bal.preset === "medium" && bal.rd === 12 && bal.res === 1, `balanced ${JSON.stringify(bal)}`);
  // Stepped slider: zombie spawn rate.
  await page.click('.settings-tab[data-page="mobs"]');
  await page.$eval("#zombies-spawnRate", (el) => {
    el.value = String(Number(el.max));
    el.dispatchEvent(new Event("input", { bubbles: true }));
  });
  const z = await v((g) => ({ rate: g.mobs.zombies.spawnRate, label: document.getElementById("zombies-spawnRate-value").textContent, saved: JSON.parse(localStorage.getItem("ufocombat_v1_settings")).zombies.spawnRate }));
  assert(z.rate === 50 && z.label === "APOCALYPSE" && z.saved === 50, `apocalypse ${JSON.stringify(z)}`);
  await page.click('.reset-group-btn[data-page="mobs"]');
  const r = await v((g) => g.mobs.zombies.spawnRate);
  assert(r === 1, "reset to defaults");
  // Back to Low for speed.
  await v((g) => g.setGraphics("low"));
  await page.keyboard.press("Escape");
});

await check("new game: Survival starts with the pistol only; Creative has every weapon (the suite then uses the classic 8-slot layout)", async () => {
  await play();
  const hotbar = await v((g) => g.inventory.slots.slice(0, 9).map((s) => s?.id ?? 0));
  assert(hotbar[0] === 287 && hotbar.slice(1).every((id) => id === 0), `hotbar ${hotbar}`);
  await v((g) => {
    g.setMode("creative");
    const have = new Set(g.inventory.slots.filter(Boolean).map((s) => s.id));
    // Every weapon is there (11 of them)...
    if (![286, 287, 288, 289, 290, 291, 292, 293, 294, 295, 296].every((id) => have.has(id))) throw new Error("creative is missing weapons");
    // ...and the rest of this suite uses the classic layout: pistol, grenade, bazooka, machine gun, airstrike, sniper, blaster, radio.
    g.inventory.clear();
    [287, 286, 288, 289, 291, 290, 292, 293].forEach((id, i) => (g.inventory.slots[i] = { id, count: 1 }));
    g.inventory.selected = 0;
    g.player.flying = true;
    g.player.position.y += 12;
    g.player.pitch = -0.2;
  });
});

await check("weapons are independent: a pending airstrike doesn't block the bazooka, pistol or blaster", async () => {
  const r = await v((g) => {
    const { weapons, inventory } = g;
    weapons.airstrike.config.delay = 2;
    weapons.airstrike.config.speed = 220;
    inventory.selected = 4;
    weapons.press("airstrike");
    inventory.selected = 2;
    weapons.press("bazooka");
    inventory.selected = 0;
    weapons.press("pistol");
    inventory.selected = 6;
    weapons.press("blaster");
    weapons.release();
    return { pending: weapons.airstrike.pending.length, rockets: weapons.rockets.length, shots: weapons.shots, bolts: g.lasers.bolts.length };
  });
  assert(r.pending === 1 && r.rockets === 1 && r.shots >= 2 && r.bolts === 1, JSON.stringify(r));
});

await check("airstrike: meteors come in at an angle from high up and land as explosions", async () => {
  const seen = await until((g) => {
    const m = g.weapons.airstrike.meteors[0];
    return m ? { y: m.pos.y, dir: m.dir.toArray() } : null;
  }, 90000);
  assert(seen, "a meteor launched");
  assert(Math.abs(seen.dir[1]) < 0.99, `falls at an angle: ${JSON.stringify(seen)}`);
  const done = await until((g) => g.weapons.airstrike.impacts >= g.weapons.airstrike.config.count && g.weapons.airstrike.meteors.length === 0, 120000);
  assert(done, "every meteor landed");
});

await check("laser blaster: bolts fly, hit and scorch blocks; color setting applies", async () => {
  await v((g) => g.settingsPanel.set("weapons.blasterColor", "green"));
  const r = await v((g) => {
    g.player.pitch = -1.2;
    g.inventory.selected = 6;
    const b = g.weapons.fireBlaster();
    return { g: b.color.g > b.color.r, fired: g.lasers.fired };
  });
  assert(r.g, "green bolt");
  const hit = await until((g) => g.lasers.bolts.length === 0 && g.scorches.count > 0, 30000);
  assert(hit, "the bolt hit the ground and left a scorch mark");
});

await check("sniper scope: zoomed view inside a clear scope (no black screen)", async () => {
  const s = await v((g) => {
    g.player.pitch = 0;
    g.inventory.selected = 5;
    g.weapons.press("sniper");
    return g.weapons.scoped;
  });
  await frames(8);
  const st = await v((g) => ({
    fov: g.camera.fov,
    layers: (getComputedStyle(document.getElementById("scope-overlay"), "::before").backgroundImage.match(/gradient/g) || []).length,
    visible: getComputedStyle(document.getElementById("scope-overlay")).display !== "none",
  }));
  assert(s && st.fov < 30 && st.visible, `scoped ${JSON.stringify(st)}`);
  assert(st.layers === 1, "the scope mask is a single gradient with a transparent center");
  await v((g) => g.weapons.press("sniper"));
});

await check("binoculars: both mouse buttons zoom without firing; release snaps back; one button still fires", async () => {
  await v((g) => {
    g.inventory.selected = 0;
    g.player.pitch = 0.05;
  });
  const shots0 = await v((g) => g.weapons.shots);
  await page.mouse.down({ button: "left" });
  await page.mouse.down({ button: "right" });
  await frames(5);
  const z = await v((g) => ({ on: g.binoculars.active, fov: g.camera.fov, shots: g.weapons.shots }));
  await page.mouse.up({ button: "right" });
  await frames(1);
  const z2 = await v((g) => ({ on: g.binoculars.active, fov: g.camera.fov }));
  await page.mouse.up({ button: "left" });
  await frames(2);
  assert(z.on && z.fov < 20 && z.shots === shots0, `zoomed ${JSON.stringify(z)}`);
  assert(!z2.on && z2.fov > 50, `released ${JSON.stringify(z2)}`);
  await page.mouse.down({ button: "right" });
  await frames(3);
  await page.mouse.up({ button: "right" });
  await frames(2);
  assert((await v((g) => g.weapons.shots)) === shots0 + 1 + (z.shots - shots0), "a single click fires once");
});

await check("mods off: vanilla (mod items stashed, recipes and palette hidden); on: everything back", async () => {
  const before = await v((g) => g.inventory.slots.slice(0, 9).map((s) => s && s.id));
  const off = await v((g) => {
    g.setModsEnabled(false);
    return {
      slots: g.inventory.slots.map((s) => s && s.id).filter(Boolean),
      weapons: g.weapons.enabled,
      bolts: g.lasers.bolts.length,
    };
  });
  assert(off.slots.every((id) => id < 286 || id > 293) && !off.weapons && off.bolts === 0, `vanilla ${JSON.stringify(off)}`);
  const on = await v((g) => {
    g.setModsEnabled(true);
    return g.inventory.slots.slice(0, 9).map((s) => s && s.id);
  });
  assert(JSON.stringify(on) === JSON.stringify(before), `restored ${JSON.stringify(on)} vs ${JSON.stringify(before)}`);
});

await check("zombies: apocalypse settings spawn crowds (drawn instanced far away); lowering the cap trims them", async () => {
  await v((g) => {
    g.sky.setHours(23);
    g.settingsPanel.set("zombies.max", 128);
    g.settingsPanel.set("zombies.spawnRate", 50);
  });
  const n = await until((g) => g.mobs.countKind("zombie") >= 40 && g.mobs.countKind("zombie"), 120000);
  assert(n >= 40, `zombies ${n}`);
  const st = await v((g) => {
    const t = performance.now();
    for (let i = 0; i < 10; i++) g.mobs.update(0.016);
    return { crowd: g.mobs.crowd.count, ms: (performance.now() - t) / 10 };
  });
  assert(st.crowd > 0, `crowd ${JSON.stringify(st)}`);
  await v((g) => {
    g.settingsPanel.set("zombies.max", 8);
    g.settingsPanel.set("zombies.spawnRate", 1);
    g.sky.setHours(10);
  });
  assert((await v((g) => g.mobs.countKind("zombie"))) <= 8, "trimmed");
  // Toughness multipliers.
  const tough = await v((g) => {
    g.settingsPanel.set("zombies.health", 3);
    const m = g.mobs.spawn("zombie", g.player.position.x + 5, g.player.position.y, g.player.position.z);
    const hp = m.health;
    g.settingsPanel.set("zombies.health", 1);
    return hp;
  });
  assert(tough === 60, `3x zombie health: ${tough}`);
});

// ================= Part 2 =================

// Puts the player in survival on a flat stone arena high up (open sky, no
// trees in the way), at night, with UFO spawning off.
async function arena(y = 60) {
  await respawnIfDead();
  await v((g, y) => {
    const { world, player } = g;
    if (g.vehicles.active) g.vehicles.exit();
    g.vehicles.parachute.close(g.player);
    g.setMode("survival");
    // (Round 3: these checks test the UFO features on their own, without the
    // mission chain: no mission set-ups, rules or locked jets.)
    g.testFlags.noMissions = true;
    g.missions.enabled = false;
    g.progress.enabled = false;
    g.ufos.rules = null;
    g.ufos.graceT = 0; // (Round 2: UFOs ignore a player who has just respawned)
    g.mobs.spawning = false; // (night in the arena: no zombies wandering in)
    g.settingsPanel.set("ufos.activity", 0);
    g.ufos.clear();
    g.mobs.removeKind("alien");
    g.mobs.removeHostiles();
    const x0 = Math.floor(player.position.x);
    const z0 = Math.floor(player.position.z);
    world.prepareArea(x0, z0, 2);
    const edits = [];
    for (let dx = -12; dx <= 12; dx++) for (let dz = -12; dz <= 12; dz++) {
      edits.push(x0 + dx, y, z0 + dz, 3);
      for (let dy = 1; dy <= 3; dy++) edits.push(x0 + dx, y + dy, z0 + dz, 0);
    }
    world.setBlocks(edits);
    player.flying = false;
    player.health = 20;
    player.position.set(x0 + 0.5, y + 1, z0 + 0.5);
    player.velocity.set(0, 0, 0);
    g.sky.setHours(23);
    g.sky.locked = true;
    window.__arena = { x: x0, y, z: z0 };
  }, y);
  await frames(3);
}

async function respawnIfDead() {
  if ((await v((g) => g.gameState)) === "dead") {
    await page.click("#respawn-btn");
    await page.waitForFunction(() => window.__ufo.gameState !== "dead", null, { timeout: 30000 });
    await play();
  }
}

await check("UFOs: eight distinct minimal designs in four sizes; durability scales with size; far ones drawn cheaply", async () => {
  await arena();
  const r = await v((g) => {
    const out = {};
    for (const size of ["small", "medium", "large", "mothership"]) {
      const u = g.ufos.spawn({ size, design: "saucer", pos: g.player.position.clone().add(new g.THREE.Vector3(0, 80, -300)) });
      out[size] = { hp: u.maxHealth, r: u.radius };
    }
    const designs = new Set();
    for (const d of ["saucer", "saucer_disc", "saucer_domed", "tictac", "sphere", "torus", "cube", "cubering"]) {
      const u = g.ufos.spawn({ design: d, size: "small", pos: g.player.position.clone().add(new g.THREE.Vector3(0, 60, -400)) });
      designs.add(u.model.hull.geometry.uuid);
    }
    g.ufos.update(0.016);
    const far = g.ufos.ufos.filter((u) => u.model.far).length;
    g.ufos.clear();
    return { out, designs: designs.size, far };
  });
  assert(r.designs === 8, `distinct hulls: ${r.designs}`);
  assert(r.out.small.hp < r.out.medium.hp && r.out.medium.hp < r.out.large.hp && r.out.large.hp < r.out.mothership.hp, `health by size ${JSON.stringify(r.out)}`);
  assert(r.out.mothership.r > 30, "motherships are huge");
  assert(r.far >= 8, `far UFOs use the cheap model: ${r.far}`);
});

await check("UFO activity: spawns arrive far away and out of view; APOCALYPSE fills the sky; more at night", async () => {
  await v((g) => {
    g.settingsPanel.set("ufos.activity", 4);
    g.sky.setHours(12);
  });
  await frames(2);
  const dayMax = await v((g) => g.ufos.maxCount);
  await v((g) => g.sky.setHours(23));
  await frames(2);
  const nightMax = await v((g) => g.ufos.maxCount);
  const r = await v((g) => {
    g.settingsPanel.set("ufos.activity", 16);
    const spots = [];
    for (let i = 0; i < 20; i++) {
      const u = g.ufos.spawn({});
      spots.push(u.pos.distanceTo(g.player.position));
    }
    for (let i = 0; i < 40; i++) g.ufos._updateSpawning(1);
    const n = g.ufos.count;
    const minDist = Math.min(...g.ufos.ufos.map((u) => u.pos.distanceTo(g.player.position)));
    g.settingsPanel.set("ufos.activity", 0);
    g.ufos.clear();
    return { n, minDist, spots: Math.min(...spots), view: g.ufos.viewDistance };
  });
  Object.assign(r, { dayMax, nightMax });
  assert(r.nightMax > r.dayMax, `more at night: ${JSON.stringify(r)}`);
  assert(r.n >= 40, `apocalypse count ${r.n}`);
  // (Round 2: hidden spawns may be nearer than the fog when terrain or the sea hides them, but never close: at least half the view distance or 110 blocks.)
  const floor = Math.min(110, r.view * 0.5) - 1;
  assert(r.minDist > floor && r.spots > floor, `spawned well away from the player: ${JSON.stringify(r)}`);
});

await check("on foot: a UFO that spots you flies over, beams you up, and reaching it means 'Abducted by a UFO'", async () => {
  await arena();
  await v((g) => {
    const u = g.ufos.spawn({ design: "saucer", size: "small", pos: g.player.position.clone().add(new g.THREE.Vector3(40, 22, 0)) });
    u.state = "beam";
    u.hostile = true;
    u.hostileT = 60;
    u.timer = 40;
    u.lastSeen = g.ufos.time;
    window.__u = u;
  });
  const beamed = await until((g) => g.ufos.beamingPlayer === window.__u, 120000);
  assert(beamed, "beamed");
  const lifted = await until((g) => g.player.position.y > window.__arena.y + 4, 60000);
  assert(lifted, "the beam lifts the player");
  const dead = await until((g) => g.gameState === "dead" && g.deathCause, 120000);
  const msg = await v(() => document.getElementById("death-cause").textContent);
  assert(dead === "abducted" && msg === "Abducted by a UFO", `death: ${dead} / ${msg}`);
  await respawnIfDead();
});

await check("escape: walking out of the beam breaks free (counted as an abduction survived)", async () => {
  await arena();
  const before = await v((g) => g.stats.world.abductionsSurvived);
  await v((g) => {
    const u = g.ufos.spawn({ design: "tictac", size: "small", pos: g.player.position.clone().add(new g.THREE.Vector3(0, 14, 0)) });
    u.state = "beam";
    u.timer = 30;
    u.lastSeen = g.ufos.time;
    window.__u = u;
  });
  await until((g) => g.ufos.beamingPlayer && g.player.position.y > window.__arena.y + 3.5, 90000);
  // Walk (float) out of the light sideways.
  await v((g) => g.player.knockback.set(9, 0, 0));
  const free = await until((g) => !g.ufos.beamingPlayer, 30000);
  assert(free, "left the beam");
  const after = await v((g) => g.stats.world.abductionsSurvived);
  assert(after === before + 1, `abductions survived ${before} -> ${after}`);
  await v((g) => g.ufos.clear());
  await until((g) => g.player.onGround || g.gameState === "dead", 30000);
  await respawnIfDead();
});

await check("shot on foot, a UFO reacts (counter-fire, beam run or evasive moves) and fires lasers", async () => {
  await arena();
  const r = await v((g) => {
    const states = new Set();
    for (let k = 0; k < 12; k++) {
      const u = g.ufos.spawn({ size: "medium", pos: g.player.position.clone().add(new g.THREE.Vector3(30, 25, 0)) });
      g.ufos.damage(u, 5, true);
      states.add(u.state === "react" ? u.reaction : u.state);
    }
    return [...states];
  });
  assert(r.length >= 2 && r.every((x) => ["counter", "evade", "attack", "circle", "beam", "blink", "react"].includes(x)), `reactions: ${r}`);
  const fired0 = await v((g) => g.lasers.fired);
  const fired = await until((g, f0) => g.lasers.fired > f0 + 2, 60000, fired0);
  assert(fired, "UFOs fire laser blasts");
  await v((g) => g.ufos.clear());
  await respawnIfDead();
});

await check("every weapon damages UFOs: pistol, machine gun, sniper, blaster, bazooka, grenade, airstrike", async () => {
  await arena();
  const r = await v((g) => {
    g.setMode("creative");
    const hurt = {};
    const mk = () => {
      const u = g.ufos.spawn({ size: "large", design: "saucer", pos: g.player.getEyePosition().add(new g.THREE.Vector3(0, 0, -30)) });
      u.state = "trick";
      u.trick = "hover";
      u.timer = 999;
      return u;
    };
    const aim = (u) => {
      const e = g.player.getEyePosition();
      const d = u.pos.clone().sub(e);
      g.player.yaw = Math.atan2(-d.x, -d.z);
      g.player.pitch = Math.atan2(d.y, Math.hypot(d.x, d.z));
    };
    let u = mk();
    aim(u);
    const h0 = u.health;
    g.weapons.firePistol();
    hurt.pistol = h0 - u.health;
    let h = u.health;
    g.weapons.fireMachineGun();
    hurt.mg = h - u.health;
    h = u.health;
    g.weapons.fireSniper();
    hurt.sniper = h - u.health;
    // Explosions next to it.
    h = u.health;
    g.effects.explode(u.pos.clone().add(new g.THREE.Vector3(0, -u.radius * 0.3, u.radius)), { radius: 7, source: "bazooka" });
    hurt.blast = h - u.health;
    const sphere = g.ufos.sphereHit(u.pos, 0.1) === u;
    g.ufos.clear();
    return { hurt, sphere };
  });
  for (const [k, dmg] of Object.entries(r.hurt)) assert(dmg > 0, `${k} did no damage (${JSON.stringify(r.hurt)})`);
  assert(r.sphere, "grenades and meteors hit UFOs (sphere test)");
  // A blaster bolt hits a UFO.
  const hit = await v((g) => {
    const u = g.ufos.spawn({ size: "large", design: "tictac", pos: g.player.getEyePosition().add(new g.THREE.Vector3(0, 0, -25)) });
    u.state = "trick";
    u.trick = "hover";
    u.timer = 999;
    window.__u = u;
    window.__h0 = u.health;
    g.player.yaw = 0;
    g.player.pitch = 0;
    g.lasers.fire({ from: g.player.getEyePosition(), dir: new g.THREE.Vector3(0, 0, -1), damage: 7, owner: "player", source: g.player });
    return true;
  });
  const took = await until(() => window.__u.health < window.__h0, 30000);
  assert(hit && took, "the laser blaster damages UFOs");
  await v((g) => {
    g.ufos.clear();
    g.setMode("survival");
  });
});

await check("shot down: the UFO falls burning, crash-lands (crater), leaves a boardable wreck, and armed aliens climb out", async () => {
  await arena();
  const r0 = await v((g) => {
    const u = g.ufos.spawn({ size: "medium", design: "cube", pos: g.player.position.clone().add(new g.THREE.Vector3(18, 26, 0)) });
    u.crashPlan = { exploded: false, crew: 4 }; // (the outcome is random in the game)
    window.__downs = g.stats.world.ufosDown;
    window.__boom = g.effects.explosionCount;
    g.ufos.damage(u, 99999, true);
    return u.falling;
  });
  assert(r0, "falling");
  const wreck = await until((g) => g.vehicles.vehicles.find((x) => x.crashed && !x.unusable) && g.effects.explosionCount > window.__boom, 90000);
  assert(wreck, "crashed into a wreck with an explosion");
  const aliens = await until((g) => g.mobs.countKind("alien") >= 4 && g.mobs.countKind("alien"), 60000);
  assert(aliens >= 2, `aliens: ${aliens}`);
  assert((await v((g) => g.stats.world.ufosDown - window.__downs)) === 1, "counted as shot down");
  // The aliens shoot green lasers at the player.
  await v((g) => {
    g.setMode("survival");
    for (const m of g.mobs.mobs) if (m.kind.startsWith("alien")) m.attackCooldown = 0;
    // Stand within sight of one (the crash site can be off in a crater).
    const a = g.mobs.mobs.find((m) => m.kind.startsWith("alien"));
    g.player.position.set(a.pos.x + 12, a.pos.y + 0.5, a.pos.z);
    g.player.velocity.set(0, 0, 0);
  });
  const shots = await until((g) => { g.player.health = 20; return g.lasers.bolts.some((b) => b.owner === "alien"); }, 60000); // (the Round 2 crews hit harder: keep the player alive)
  assert(shots, "aliens fire their laser guns");
  // Killing aliens counts.
  const killed = await v((g) => {
    const before = g.stats.world.aliensKilled;
    for (const m of [...g.mobs.mobs]) if (m.kind.startsWith("alien")) g.mobs.shoot(m, 999, new g.THREE.Vector3(1, 0, 0), 1, true);
    return g.stats.world.aliensKilled - before;
  });
  assert(killed >= 2, `aliens killed counted: ${killed}`);
  await respawnIfDead();
});

await check("board the wreck (F): it lifts out of the crater and flies with no inertia in any direction", async () => {
  await respawnIfDead(); // (the aliens or the crater may have killed the player)
  const r = await v((g) => {
    const w = g.vehicles.vehicles.find((x) => x.crashed && !x.unusable);
    for (const k of ["alien", "alien_gray", "alien_red"]) g.mobs.removeKind(k); // (the crews of Round 2 hit hard; the survivors would kill the player here)
    g.player.health = 20;
    const px = w.pos.x + w.radius + 1;
    g.world.prepareArea(px, w.pos.z, 2);
    // (A small stone step beside the wreck to stand on: with Round 3's taller
    // terrain the ground next to a crater can be far below or above.)
    const sy = Math.floor(w.pos.y) - 1;
    const pad = [];
    for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) {
      pad.push(Math.floor(px) + dx, sy, Math.floor(w.pos.z) + dz, 3);
      for (let dy = 1; dy <= 3; dy++) pad.push(Math.floor(px) + dx, sy + dy, Math.floor(w.pos.z) + dz, 0);
    }
    g.world.setBlocks(pad);
    window.__step = [];
    for (let i = 0; i < pad.length; i += 4) if (pad[i + 3] === 3) window.__step.push([pad[i], pad[i + 1], pad[i + 2]]);
    g.player.position.set(Math.floor(px) + 0.5, sy + 1.05, Math.floor(w.pos.z) + 0.5);
    g.player.velocity.set(0, 0, 0);
    g.player.fallDistance = 0;
    return !!w;
  });
  assert(r, "a wreck exists");
  await page.keyboard.press("KeyF");
  await frames(2);
  const inside = await v((g) => g.vehicles.active && { crashed: g.vehicles.active.crashed, hud: !document.getElementById("vehicle-hud").classList.contains("hidden") });
  const dbg = inside ? null : await v((g) => {
    const w = g.vehicles.vehicles.find((x) => x.crashed && !x.unusable);
    return { cause: g.deathCause, enabled: g.vehicles.enabled, dead: g.player.dead, mode: g.gameState, w: w && { alive: w.alive, d: w.pos.distanceTo(g.player.position), r: w.radius, cd: Math.hypot(w.pos.x - g.player.position.x, w.pos.z - g.player.position.z) }, near: g.vehicles.nearestEnterable()?.type, all: g.vehicles.vehicles.map((x) => `${x.type}:${x.crashed}:${x.unusable}:${x.alive}`) };
  });
  assert(inside && !inside.crashed && inside.hud, `boarded ${JSON.stringify(inside)} ${JSON.stringify(dbg)}`);
  // (The stone step goes again, so the ship has room.)
  await v((g) => {
    const e = [];
    for (const [x, y, z] of window.__step || []) e.push(x, y, z, 0);
    g.world.setBlocks(e);
  });
  // Boarding a wreck lifts it out of its crater by itself first.
  await until((g) => g.vehicles.active.liftOff <= 0, 60000);
  const y0 = await v((g) => g.vehicles.active.pos.y);
  await page.keyboard.down("Space");
  await frames(6);
  await page.keyboard.up("Space");
  const y1 = await v((g) => ({ y: g.vehicles.active.pos.y, v: g.vehicles.active.vel.length() }));
  assert(y1.y > y0 + 0.5 && y1.v === 0, `rose (${y0} -> ${y1.y}) and stops dead when the key is released (v=${y1.v})`);
  // Forward along the view at the cruising speed, instantly.
  await page.keyboard.down("KeyW");
  await frames(2);
  const moving = await v((g) => ({ v: g.vehicles.active.vel.length(), cruise: g.vehicles.active.cruise }));
  await page.keyboard.up("KeyW");
  assert(Math.abs(moving.v - moving.cruise) < 0.01, `instant acceleration: ${JSON.stringify(moving)}`);
  // The wheel changes the cruising speed.
  const c0 = moving.cruise;
  await page.mouse.wheel(0, -400);
  await frames(2);
  const c1 = await v((g) => g.vehicles.active.cruise);
  assert(c1 > c0, `wheel speeds up ${c0} -> ${c1}`);
});

await check("UFO weapons: the laser cannon blasts holes; the tractor beam lifts creatures (and loose blocks) aboard", async () => {
  const r = await v((g) => {
    const v = g.vehicles.active;
    const w = g.world;
    // Hover 10 blocks over the arena with a cow under the ship.
    v.pos.set(window.__arena.x + 0.5, window.__arena.y + 1 + v.bottom + 9, window.__arena.z + 0.5);
    v.camPitch = -1.2;
    const cow = g.mobs.spawn("cow", window.__arena.x + 0.5, window.__arena.y + 1, window.__arena.z + 0.5);
    window.__cow = cow;
    window.__abd = g.stats.world.animalsAbducted;
    return !!cow;
  });
  assert(r, "cow placed");
  await page.mouse.down({ button: "right" });
  const taken = await until(() => !window.__ufo.mobs.mobs.includes(window.__cow), 90000);
  await page.mouse.up({ button: "right" });
  assert(taken, "the beam took the cow aboard");
  assert((await v((g) => g.stats.world.animalsAbducted - window.__abd)) === 1, "counted");
  const b0 = await v((g) => g.effects.explosionCount);
  await page.mouse.down({ button: "left" });
  const blast = await until((g, n) => g.effects.explosionCount > n, 30000, b0);
  await page.mouse.up({ button: "left" });
  assert(blast, "the laser cannon's bolts blow small holes");
});

await check("other UFOs take you for one of their own until you shoot one (then it turns hostile)", async () => {
  const r = await v((g) => {
    const v = g.vehicles.active;
    const u = g.ufos.spawn({ size: "small", pos: v.pos.clone().add(new g.THREE.Vector3(30, 5, 0)), personality: "fighter" });
    u.state = "attack";
    u.lastSeen = g.ufos.time;
    for (let i = 0; i < 30; i++) g.ufos.update(0.05);
    const calm = u.state;
    g.ufos.damage(u, 1, true);
    return { calm, hostile: u.hostile, state: u.state };
  });
  assert(r.calm === "roam" && r.hostile && r.state === "attack", JSON.stringify(r));
  await v((g) => g.ufos.clear());
});

await check("ghost mode flies through terrain, burning a tunnel", async () => {
  const r = await v((g) => {
    const v = g.vehicles.active;
    g.settingsPanel.set("vehicles.ufoGhost", true);
    const a = window.__arena;
    // Aim down into the stone floor of the arena and push through it.
    v.pos.set(a.x + 0.5, a.y + v.bottom + 2, a.z + 0.5);
    g.world.setBlocks([a.x, a.y, a.z, 3]); // (earlier checks blast holes in the floor)
    const before = g.world.getBlock(a.x, a.y, a.z);
    v.camPitch = -1.5;
    return before;
  });
  await page.keyboard.down("KeyW");
  await frames(10);
  await until((g) => g.vehicles.active.pos.y < window.__arena.y - 0.5, 20000);
  await page.keyboard.up("KeyW");
  const after = await v((g) => ({ id: g.world.getBlock(window.__arena.x, window.__arena.y, window.__arena.z), y: g.vehicles.active.pos.y }));
  await v((g) => g.settingsPanel.set("vehicles.ufoGhost", false));
  assert(r === 3 && after.id === 0 && after.y < (await v(() => window.__arena.y)), `tunnel: ${JSON.stringify(after)}`);
});

await check("leaving: underground to the surface; mid-air on a parachute, landing without fall damage", async () => {
  // Buried in the rock: out onto the surface.
  const up = await v((g) => {
    g.vehicles.exit();
    return { vehicle: !!g.vehicles.active, solid: g.world.isSolidAt(Math.floor(g.player.position.x), Math.floor(g.player.position.y + 0.5), Math.floor(g.player.position.z)) };
  });
  assert(!up.vehicle && !up.solid, `exit from underground: ${JSON.stringify(up)}`);
  // Mid-air.
  await v((g) => {
    for (const k of ["alien", "alien_gray", "alien_red"]) g.mobs.removeKind(k); // (their shots would count as fall damage here)
    const w = g.vehicles.vehicles.find((x) => x.type === "ufo");
    w.pos.set(window.__arena.x + 0.5, window.__arena.y + 22, window.__arena.z + 0.5);
    g.vehicles.enter(w);
  });
  await frames(2);
  const air = await v((g) => {
    window.__dmg = [];
    const orig = g.player.damage.bind(g.player);
    g.player.damage = (n, cause, ...r) => { window.__dmg.push(`${cause}:${n}`); return orig(n, cause, ...r); };
    g.vehicles.exit();
    return { chute: g.vehicles.parachute.active, y: g.player.position.y, hp: g.player.health };
  });
  assert(air.chute, "a parachute is deployed");
  const landed = await until((g) => g.player.onGround && !g.vehicles.parachute.active, 240000);
  const hp = await v((g) => g.player.health);
  const dmg = await v(() => window.__dmg);
  assert(landed && hp >= air.hp, `landed softly (hp ${air.hp} -> ${hp}) ${JSON.stringify(dmg)}`);
});

await check("saving and reloading while flying a UFO puts you back in it", async () => {
  await v((g) => {
    const w = g.vehicles.vehicles.find((x) => x.type === "ufo");
    g.player.position.set(w.pos.x, w.pos.y, w.pos.z);
    g.vehicles.enter(w);
    g.flushSave();
  });
  const saved = await v(() => JSON.parse(localStorage.getItem(`ufocombat_v1_player_${new URLSearchParams(location.search).get("seed")}`)).vehicles);
  assert(saved && saved.active >= 0 && saved.list[saved.active].type === "ufo", `saved ${JSON.stringify(saved)}`);
  await page.reload({ waitUntil: "load" });
  await page.waitForFunction(() => window.__ufo?.graphicsReady, null, { timeout: 120000 });
  await v((g) => g.setGraphics("low"));
  await page.waitForFunction(() => window.__ufo.graphicsReady, null, { timeout: 120000 });
  await play();
  const again = await v((g) => g.vehicles.active?.type);
  assert(again === "ufo", `after reload: ${again}`);
});

await check("mods off while flying: set down safely, vehicles and UFOs gone; mods on: they're back", async () => {
  const r = await v((g) => {
    g.ufos.spawn({ size: "small", pos: g.player.position.clone().add(new g.THREE.Vector3(80, 30, 0)) });
    g.setModsEnabled(false);
    const s = {
      vehicle: !!g.vehicles.active,
      ufos: g.ufos.count,
      shown: g.vehicles.vehicles.some((x) => x.root.visible),
      solid: g.world.isSolidAt(Math.floor(g.player.position.x), Math.floor(g.player.position.y + 0.5), Math.floor(g.player.position.z)),
    };
    g.setModsEnabled(true);
    s.back = g.vehicles.vehicles.some((x) => x.root.visible);
    return s;
  });
  assert(!r.vehicle && r.ufos === 0 && !r.shown && !r.solid && r.back, JSON.stringify(r));
});

await check("dying in a destroyed vehicle: 'Went down with your UFO'", async () => {
  await v((g) => {
    g.setMode("survival");
    const w = g.vehicles.vehicles.find((x) => x.type === "ufo");
    g.player.position.copy(w.pos);
    g.vehicles.enter(w);
    w.damage(99999, "ufo_laser");
  });
  const dead = await until((g) => g.gameState === "dead" && g.deathCause, 30000);
  assert(dead === "ufo_down", `cause ${dead}`);
  await respawnIfDead();
});

await check("after a respawn, UFOs lose interest and ignore you for a while", async () => {
  await arena();
  const r = await v((g) => {
    const u = g.ufos.spawn({ size: "medium", pos: g.player.position.clone().add(new g.THREE.Vector3(10, 20, 0)) });
    u.state = "attack";
    u.lastSeen = g.ufos.time;
    g.ufos.playerRespawned();
    const calm = u.state === "roam";
    // Plenty of chances to notice the player during the grace period.
    for (let i = 0; i < 100; i++) {
      u.checkT = 0;
      g.ufos.update(0.05);
    }
    const out = { calm, ignored: u.state !== "attack" && u.state !== "beam", grace: g.ufos.graceT };
    g.ufos.graceT = 0;
    g.ufos.clear();
    return out;
  });
  assert(r.calm && r.ignored && r.grace > 20, `grace ${JSON.stringify(r)}`);
});

await check("UFO tricks and leaving forever run cleanly", async () => {
  await arena();
  const r = await v((g) => {
    const out = [];
    for (let i = 0; i < 12; i++) {
      const u = g.ufos.spawn({ size: "small", pos: g.player.position.clone().add(new g.THREE.Vector3(60 + i * 5, 25, 0)) });
      g.ufos._startTrick(u);
      out.push(u.trick);
    }
    for (let k = 0; k < 60; k++) g.ufos.update(0.05);
    const u = g.ufos.ufos[0];
    g.ufos._leave(u);
    for (let k = 0; k < 80; k++) g.ufos.update(0.05);
    const gone = !g.ufos.ufos.includes(u);
    g.ufos.clear();
    return { tricks: [...new Set(out)], gone };
  });
  assert(r.tricks.length >= 3 && r.gone, JSON.stringify(r));
});

// ================= Part 3 =================

// Aims the jet (flight assist) at a point, like moving the mouse there.
async function aimJetAt(fn) {
  await v((g, src) => {
    const jet = g.vehicles.active;
    const target = new Function("g", `return (${src})(g);`)(g);
    const d = target.clone().sub(jet.pos).normalize();
    jet.aimYaw = Math.atan2(-d.x, -d.z);
    jet.aimPitch = Math.asin(Math.max(-1, Math.min(1, d.y)));
  }, fn.toString());
}

await check("jet: called in on a flat strip nearby; takes off with throttle and afterburner; flies (and can't hover)", async () => {
  await arena(50);
  await v((g) => {
    g.settingsPanel.set("vehicles.jetAirborne", false);
    // A long flat stone runway next to the player.
    const a = window.__arena;
    g.world.prepareArea(a.x + 20, a.z - 80, 6);
    const edits = [];
    for (let dz = -170; dz <= 12; dz++) for (let dx = -8; dx <= 8; dx++) {
      edits.push(a.x + 20 + dx, a.y, a.z + dz, 3);
      for (let dy = 1; dy <= 45; dy++) edits.push(a.x + 20 + dx, a.y + dy, a.z + dz, 0);
    }
    // (Round 3's taller terrain: an open climb-out past the end of the strip.)
    g.world.prepareArea(a.x + 20, a.z - 260, 6);
    for (let dz = -340; dz < -170; dz++) for (let dx = -10; dx <= 10; dx++) for (let dy = 1; dy <= 45; dy++) edits.push(a.x + 20 + dx, a.y + dy, a.z + dz, 0);
    g.world.setBlocks(edits);
    g.sky.setHours(11);
  });
  await page.keyboard.press("KeyJ");
  await frames(2);
  const jet = await v((g) => {
    const j = g.vehicles.vehicles.find((x) => x.type === "jet");
    return j && { onGround: j.onGround, y: j.pos.y, dist: j.pos.distanceTo(g.player.position) };
  });
  assert(jet && jet.onGround && jet.dist < 70, `jet parked nearby: ${JSON.stringify(jet)}`);
  const boarded = await v((g) => {
    const j = g.vehicles.vehicles.find((x) => x.type === "jet");
    g.player.position.set(j.pos.x + 3, j.pos.y, j.pos.z);
    return g.vehicles.toggle() && g.vehicles.active === j;
  });
  assert(boarded, "boarded the jet");
  // Full throttle, afterburner, and pull up once fast.
  await page.keyboard.down("KeyW");
  await page.keyboard.down("ShiftLeft");
  const fast = await until((g) => g.vehicles.active.speed > g.vehicles.config.jet.stallSpeed * 1.05, 120000);
  assert(fast, "accelerates down the runway");
  await v((g) => {
    const j = g.vehicles.active;
    j.aimPitch = 0.35;
  });
  const up = await until((g) => !g.vehicles.active.onGround && g.vehicles.active.pos.y > window.__arena.y + 15, 120000);
  await page.keyboard.up("ShiftLeft");
  assert(up, "took off and climbed");
  // Throttle off, nose up: it slows, stalls and sinks (no hovering).
  await page.keyboard.up("KeyW");
  await v((g) => {
    const j = g.vehicles.active;
    j.throttle = 0;
    j.aimPitch = 0.6;
  });
  await page.keyboard.down("KeyS");
  const stall = await until((g) => g.vehicles.active.stalled && { speed: g.vehicles.active.speed, vy: g.vehicles.active.vel.y }, 120000);
  await page.keyboard.up("KeyS");
  assert(stall && stall.speed > 3, `stalls instead of hovering: ${JSON.stringify(stall)}`);
  const hud = await v(() => document.getElementById("vehicle-hud").textContent);
  assert(/Speed/.test(hud) && /Altitude/.test(hud) && /Throttle/.test(hud) && /Heading/.test(hud) && /Missile/.test(hud) && /STALL/.test(hud), `HUD: ${hud.slice(0, 200)}`);
  // Recover: full throttle, nose level.
  await v((g) => {
    const j = g.vehicles.active;
    j.throttle = 1;
    j.aimPitch = -0.2;
    j.pos.y += 60;
  });
});

// Later jet checks start from a flying jet even when an earlier one failed.
async function ensureJet() {
  if ((await v((g) => g.vehicles.active?.type)) === "jet") return;
  await respawnIfDead();
  await v((g) => {
    if (g.vehicles.active) g.vehicles.exit();
    g.settingsPanel.set("vehicles.jetAirborne", true);
    g.setMode("creative");
  });
  await frames(2);
  await v((g) => g.callJet(true));
  await frames(2);
  const st = await v((g) => ({ active: g.vehicles.active?.type, gs: g.gameState, dead: g.player.dead, mods: g.mods?.enabled ?? g.vehicles.enabled }));
  if (st.active !== "jet") console.log(`        ensureJet: no jet after the call: ${JSON.stringify(st)}`);
  await v((g) => {
    g.settingsPanel.set("vehicles.jetAirborne", false);
    g.setMode("survival");
  });
}

await check("jet weapons: autocannon tracers hit a UFO; missiles lock on (box + tone) and track the target", async () => {
  await ensureJet();
  await v((g) => {
    const j = g.vehicles.active;
    j.pos.y = Math.max(j.pos.y, 120);
    j.vel.copy(j.forward(new g.THREE.Vector3()).multiplyScalar(110));
    j.aimPitch = 0;
    j.q.setFromEuler(new g.THREE.Euler(0, j.aimYaw, 0, "YXZ"));
    const f = j.forward(new g.THREE.Vector3());
    const u = g.ufos.spawn({ size: "large", design: "saucer", pos: j.pos.clone().addScaledVector(f, 260), personality: "fighter" });
    u.state = "trick";
    u.trick = "hover";
    u.timer = 999;
    window.__u = u;
    window.__h0 = u.health;
  });
  await aimJetAt((g) => window.__u.pos);
  await page.mouse.down({ button: "left" });
  // (Kept hovering right ahead of the nose: this checks the gun, not the
  // chase.)
  const hit = await until((g) => {
    const j = g.vehicles.active;
    const u = window.__u;
    if (u.health < window.__h0) return true;
    j.pos.y = Math.max(j.pos.y, 120);
    if (j.vel.length() < 100) j.vel.copy(j.forward(new g.THREE.Vector3()).multiplyScalar(110));
    j.heat = 0; // (this checks that the rounds hit, not the overheating)
    u.state = "trick";
    u.trick = "hover";
    u.timer = 999;
    u.vel.set(0, 0, 0);
    u.pos.copy(j.pos).addScaledVector(j.forward(new g.THREE.Vector3()), 180);
    const d = u.pos.clone().sub(j.pos).normalize();
    j.aimYaw = Math.atan2(-d.x, -d.z);
    j.aimPitch = Math.asin(d.y);
    return false;
  }, 60000);
  await page.mouse.up({ button: "left" });
  assert(hit, "cannon rounds hit the UFO");
  // Put it well ahead again (the jet may have flown past it by now).
  await v((g) => {
    const j = g.vehicles.active;
    const f = j.forward(new g.THREE.Vector3());
    window.__u.pos.copy(j.pos).addScaledVector(f, 420);
    window.__u.vel.set(0, 0, 0);
  });
  await page.mouse.down({ button: "right" }); // (Round 2: hold the right button to lock on)
  const locked = await until((g) => {
    const j = g.vehicles.active;
    const d = window.__u.pos.clone().sub(j.pos).normalize();
    j.aimYaw = Math.atan2(-d.x, -d.z);
    j.aimPitch = Math.asin(d.y);
    return j.lock.locked;
  }, 90000);
  assert(locked, "locked on");
  const box = await v(() => ({ shown: !document.getElementById("lock-box").classList.contains("hidden"), locked: document.getElementById("lock-box").classList.contains("locked") }));
  assert(box.shown && box.locked, `lock box ${JSON.stringify(box)}`);
  await page.mouse.up({ button: "right" }); // (letting go fires)
  const missile = await until((g) => g.vehicles.active.missiles.length > 0 && { guided: !!g.vehicles.active.missiles[0].target, dist: window.__u.pos.distanceTo(g.vehicles.active.pos) }, 20000);
  assert(missile && missile.guided, `a guided missile is away: ${JSON.stringify(missile)}`);
  const down = await until(() => window.__u.falling || window.__u.health < window.__h0 - 150, 90000);
  assert(down, "the missile hit");
  await v((g) => g.ufos.clear());
});

await check("UFOs vs the jet: evaders flee a bit slower than the jet, fast ones faster, fighters attack (incoming warning)", async () => {
  await ensureJet();
  const r = await v((g) => {
    const j = g.vehicles.active;
    const mk = (personality) => {
      const u = g.ufos.spawn({ size: "small", pos: j.pos.clone().add(new g.THREE.Vector3(150, 10, 0)), personality });
      u.state = "attack";
      u.lastSeen = g.ufos.time;
      return u;
    };
    j.pos.y = Math.max(j.pos.y, 150); // clear skies between them
    const ev = mk("evader");
    const fast = mk("fast");
    const fighter = mk("fighter");
    fighter.shotT = 0;
    j.incoming = 0;
    // (Their top speed while running: once they are far enough away they go back to roaming.)
    let evMax = 0;
    let fastMax = 0;
    for (let i = 0; i < 80; i++) {
      g.ufos.update(0.05);
      ev.shotT = 99;
      fast.shotT = 99;
      evMax = Math.max(evMax, ev.vel.length());
      fastMax = Math.max(fastMax, fast.vel.length());
    }
    const max = g.vehicles.config.jet.maxSpeed;
    const out = { evader: evMax / max, fast: fastMax / max, fighterFired: g.lasers.bolts.some((b) => b.source === fighter), incoming: j.incoming > 0 };
    g.ufos.clear();
    return out;
  });
  assert(r.evader > 0.4 && r.evader < 1, `evader speed ratio ${JSON.stringify(r)}`);
  assert(r.fast > r.evader * 1.2, `a fast UFO runs faster than an evader: ${JSON.stringify(r)}`);
  assert(r.fighterFired && r.incoming, `fighter attacks with a warning: ${JSON.stringify(r)}`);
});

await check("the nuke: drops on a parachute, then a flash, a crater, a mushroom cloud, and it counts", async () => {
  await ensureJet();
  const r0 = await v((g) => {
    const j = g.vehicles.active;
    window.__nukes = g.stats.world.nukes;
    window.__cloud = 0;
    j.nukeT = 0;
    // A low pass, so the drop doesn't take ages of software-rendered frames.
    j.pos.y = Math.max(g.world.heightAt(Math.floor(j.pos.x), Math.floor(j.pos.z)), 40) + 45;
    return true;
  });
  await page.keyboard.press("KeyB");
  await frames(2);
  const bomb = await v((g) => g.vehicles.active.bombs.length);
  assert(r0 && bomb === 1, "bomb away");
  const boom = await until((g) => g.nuke.active.length > 0 && g.nuke.active[0].center.toArray(), 240000);
  assert(boom, "detonated");
  const after = await until((g) => g.nuke.active[0]?.slice >= 10 && { cloud: g.nuke.cloud.particles.length, air: g.world.getBlock(Math.floor(g.nuke.active[0].center.x), Math.floor(g.nuke.active[0].center.y - 3), Math.floor(g.nuke.active[0].center.z)), nukes: g.stats.world.nukes - window.__nukes }, 120000);
  assert(after && after.cloud > 20 && after.nukes === 1, `nuke aftermath ${JSON.stringify(after)}`);
});

await check("crashing the jet into the ground destroys it: 'Crashed your jet'", async () => {
  await ensureJet();
  await v((g) => {
    g.setMode("survival");
    window.__deaths = g.stats.world.deaths;
    const j = g.vehicles.active;
    j.aimPitch = -1.3;
    j.q.setFromEuler(new g.THREE.Euler(-1.2, j.aimYaw, 0, "YXZ"));
    j.vel.set(0, -80, 0);
    j.pos.y = g.world.heightAt(Math.floor(j.pos.x), Math.floor(j.pos.z)) + 12;
  });
  const dead = await until((g) => g.gameState === "dead" && g.deathCause, 60000);
  assert(dead === "jet_crash", `cause ${dead}`);
  assert((await v((g) => g.stats.world.deaths - window.__deaths)) === 1, "the death is counted");
  await respawnIfDead();
});

await check("FULL SCENARIO: jet chase -> lock -> missile -> UFO crash -> eject -> land -> fight aliens -> board the wreck -> fly off past friendly UFOs", async () => {
  await arena(55);
  // 1. The jet, already airborne.
  await v((g) => {
    g.sky.setHours(10);
    g.settingsPanel.set("vehicles.jetAirborne", true);
  });
  await v((g) => { g.ufos.time += 3; }); // (a second call right after the last one is ignored)
  await page.keyboard.press("KeyJ");
  await frames(2);
  const jdbg = await v((g) => ({ active: g.vehicles.active?.type, gs: g.gameState, dead: g.player.dead, vs: g.vehicles.vehicles.map((x) => `${x.type}:${x.alive}`) }));
  assert(jdbg.active === "jet", `in the jet, airborne ${JSON.stringify(jdbg)}`);
  // 2. An enemy UFO over the horizon ahead: it notices the jet and flees.
  await v((g) => {
    const j = g.vehicles.active;
    j.pos.y = Math.max(j.pos.y, 110);
    const f = j.forward(new g.THREE.Vector3());
    f.y = 0;
    f.normalize();
    const u = g.ufos.spawn({ size: "medium", design: "saucer", pos: j.pos.clone().addScaledVector(f, 320).add(new g.THREE.Vector3(0, 10, 0)), personality: "evader" });
    u.fleeFactor = 0.85;
    u.crashPlan = { exploded: false, crew: 3 }; // (random in the game)
    u.noLeave = true; // (it may fly away for good in the game)
    u.blinkT = 1e9; // (or blink out of the way of the missile)
    window.__u = u;
    window.__downs = g.stats.world.ufosDown;
  });
  // 3. Chase it on afterburner, keeping it in front of the nose.
  await page.keyboard.down("KeyW");
  await page.keyboard.down("ShiftLeft");
  const d0 = await v((g) => window.__u.pos.distanceTo(g.vehicles.active.pos));
  await page.mouse.down({ button: "right" }); // (Round 2: hold the right button to lock on)
  const locked = await until((g) => {
    const j = g.vehicles.active;
    j.pos.y = Math.max(j.pos.y, 100); // (the chase must not end in a hill)
    const d = window.__u.pos.clone().sub(j.pos).normalize();
    j.aimYaw = Math.atan2(-d.x, -d.z);
    j.aimPitch = Math.asin(d.y);
    return j.lock.locked && window.__u.state === "attack" && { dist: window.__u.pos.distanceTo(j.pos), fleeing: window.__u.vel.length() };
  }, 180000);
  assert(locked, "chased the fleeing UFO and locked on");
  // 4. Missile away.
  await page.mouse.up({ button: "right" }); // (letting go fires)
  const falling = await until((g) => {
    const j = g.vehicles.active;
    j.pos.y = Math.max(j.pos.y, 100);
    const d = window.__u.pos.clone().sub(j.pos).normalize();
    j.aimYaw = Math.atan2(-d.x, -d.z);
    j.aimPitch = Math.asin(Math.max(-0.3, d.y));
    return window.__u.falling;
  }, 120000);
  await page.keyboard.up("ShiftLeft");
  await page.keyboard.up("KeyW");
  const fdbg = falling ? null : await v((g) => ({ missiles: g.vehicles.active?.missiles.length, dist: g.vehicles.active && window.__u.pos.distanceTo(g.vehicles.active.pos), hp: window.__u.health, max: window.__u.maxHealth, state: window.__u.state, speed: window.__u.vel.length(), jet: g.vehicles.active?.speed }));
  assert(falling, `the missile hit and the UFO is going down ${JSON.stringify(fdbg)}`);
  // 5. It crash-lands (a crater and a wreck), counted as shot down.
  const wreck = await until((g) => {
    const w = g.vehicles.vehicles.find((x) => x.type === "ufo" && x.crashed && !x.unusable);
    return w && w.pos.toArray();
  }, 150000);
  assert(wreck, "crash-landed as a wreck");
  assert((await v((g) => g.stats.world.ufosDown - window.__downs)) === 1, "one UFO shot down");
  // 6. Eject over the crash site: a parachute opens.
  await v((g, w) => {
    const j = g.vehicles.active;
    j.pos.set(w[0] + 30, Math.max(w[1] + 40, j.pos.y), w[2] + 30);
  }, wreck);
  await page.keyboard.press("KeyF");
  const chute = await until((g) => g.vehicles.parachute.active && g.player.parachute && !g.vehicles.active, 30000);
  assert(chute, "ejected with a parachute");
  const vy = await until((g) => g.player.velocity.y < -1 && g.player.velocity.y, 30000);
  assert(vy > -4, `drifting down slowly (vy ${vy})`);
  // (Speed-up for the software renderer: drop the last stretch.)
  await v((g, w) => {
    const top = g.world.surfaceY(Math.floor(w[0] + 14), Math.floor(w[2] + 14));
    g.player.position.set(w[0] + 14.5, top + 6, w[2] + 14.5);
    g.player.velocity.set(0, -3, 0);
  }, wreck);
  const landed = await until((g) => g.player.onGround && !g.vehicles.parachute.active, 120000);
  assert(landed && (await v((g) => g.gameState)) === "playing", "landed safely");
  // 7. The aliens come out and fight: shoot them with the laser blaster.
  const aliens = await until((g) => g.mobs.countKind("alien") > 0, 90000);
  const adbg = aliens ? null : await v((g) => ({ pending: g.ufos.pendingCrews.map((c) => ({ d: c.pos.distanceTo(g.player.position).toFixed(0), delay: c.delay, tries: c.tries, count: c.count, water: c.water, meshed: !!g.world.getChunk(Math.floor(c.pos.x) >> 4, Math.floor(c.pos.z) >> 4)?.meshed })), view: g.ufos.viewDistance, mobs: g.mobs.mobs.map((m) => m.kind).join(","), dead: g.player.dead, mode: g.player.mode, gs: g.gameState, ufos: g.ufos.count }));
  assert(aliens, `aliens climbed out ${JSON.stringify(adbg)}`);
  await v((g) => {
    g.setMode("creative"); // keep the test player alive while the aliens fire
    g.inventory.selected = 6;
  });
  const cleared = await until((g) => {
    const a = g.mobs.mobs.find((m) => m.kind.startsWith("alien") && !m.dead);
    if (!a) return true;
    const e = g.player.getEyePosition();
    const d = a.pos.clone().add(new g.THREE.Vector3(0, 1, 0)).sub(e);
    g.player.yaw = Math.atan2(-d.x, -d.z);
    g.player.pitch = Math.atan2(d.y, Math.hypot(d.x, d.z));
    // Walk right up to it (so the wreck it may stand under isn't in the
    // way), then blast.
    if (d.length() > 3) g.player.position.addScaledVector(d.clone().setY(0).normalize(), Math.min(0.8, d.length() - 3));
    g.weapons._cooldowns.blaster = 0;
    g.weapons.press("blaster");
    g.weapons.release();
    return false;
  }, 240000);
  const left = cleared ? null : await v((g) => ({ sel: g.inventory.slots[g.inventory.selected]?.id, mode: g.player.mode, aliens: g.mobs.mobs.filter((m) => m.kind.startsWith("alien") && !m.dead).map((m) => `${m.kind}:${m.health}:${m.pos.distanceTo(g.player.position).toFixed(0)}`) }));
  assert(cleared, `fought off the aliens ${JSON.stringify(left)}`);
  const killed = await v((g) => g.stats.world.aliensKilled);
  assert(killed > 0, "aliens killed counted");
  // 8. Walk to the wreck and board it.
  await v((g) => {
    g.setMode("survival");
    const w = g.vehicles.vehicles.find((x) => x.type === "ufo" && x.crashed && !x.unusable);
    g.player.position.set(w.pos.x + w.radius + 1.2, w.pos.y + 0.5, w.pos.z);
  });
  await page.keyboard.press("KeyF");
  const inUfo = await until((g) => g.vehicles.active?.type === "ufo" && g.vehicles.active.liftOff <= 0, 60000);
  assert(inUfo, "boarded the wreck and lifted off");
  // 9. Other UFOs around take us for one of their own.
  await v((g) => {
    const me = g.vehicles.active;
    window.__others = [0, 1, 2].map((i) => {
      const u = g.ufos.spawn({ size: "small", pos: me.pos.clone().add(new g.THREE.Vector3(40 + i * 15, 10, 20)), personality: "fighter" });
      u.state = "attack";
      u.lastSeen = g.ufos.time;
      return u;
    });
    window.__fired = g.lasers.fired;
  });
  await page.keyboard.down("KeyW");
  await page.keyboard.down("Space");
  const start = await v((g) => g.vehicles.active.pos.toArray());
  await until((g) => g.ufos.time > 0 && window.__others.every((u) => u.state !== "attack"), 60000);
  await frames(30);
  await page.keyboard.up("Space");
  await page.keyboard.up("KeyW");
  const end = await v((g, s0) => ({
    moved: g.vehicles.active.pos.distanceTo(new g.THREE.Vector3(...s0)),
    peaceful: window.__others.every((u) => !u.hostile && u.state !== "attack" && u.state !== "react"),
    shotsAtUs: g.lasers.bolts.filter((b) => window.__others.includes(b.source)).length,
  }), start);
  assert(end.moved > 5 && end.peaceful && end.shotsAtUs === 0, `flew away peacefully: ${JSON.stringify(end)}`);
  await v((g) => g.ufos.clear());
});

await check("stats: world and total counts persist; the HUD overlay shows UFOs down and play time when switched on", async () => {
  await v((g) => g.settingsPanel.set("statsOverlay", true));
  await frames(40);
  const r = await v((g) => ({
    overlay: document.getElementById("stats-overlay").textContent,
    shown: !document.getElementById("stats-overlay").classList.contains("hidden"),
    total: JSON.parse(localStorage.getItem("ufocombat_v1_stats_total") || "{}"),
    world: g.stats.world,
  }));
  assert(r.shown && /UFOs shot down: \d+/.test(r.overlay), `overlay: ${r.overlay}`);
  // (Deaths and abductions survived are checked where they happen.)
  assert(r.world.ufosDown >= 1 && r.world.playTime > 10 && r.world.aliensKilled > 0 && r.world.ufosBoarded > 0, `world stats ${JSON.stringify(r.world)}`);
  assert(r.total.ufosDown >= r.world.ufosDown, `totals saved ${JSON.stringify(r.total)}`);
  await v((g) => g.settingsPanel.set("statsOverlay", false));
  // The Stats screen in the pause menu.
  await page.evaluate(() => document.exitPointerLock());
  await page.waitForFunction(() => window.__ufo.gameState === "paused", null, { timeout: 10000 });
  await page.click("#pause-stats-btn");
  const table = await v(() => document.getElementById("stats-table").textContent);
  assert(/UFOs shot down/.test(table) && /All worlds/.test(table), "stats screen");
  await page.keyboard.press("Escape");
  await play();
});

// ---------- Summary ----------
const failed = results.filter(([, ok]) => !ok);
console.log(`\n${results.length - failed.length} passed, ${failed.length} failed${errors.length ? `; console errors: ${errors.length}` : ""}.`);
if (errors.length) console.log(errors.slice(0, 5).join("\n"));
await browser.close();
server.close();
process.exit(failed.length || errors.length ? 1 : 0);
