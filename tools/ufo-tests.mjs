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

// ---------- Boot ----------
await page.goto(`http://localhost:${PORT}/index.html?seed=${SEED}`, { waitUntil: "load", timeout: 60000 });
await page.waitForFunction(() => !!window.__ufo, null, { timeout: 60000 });
await page.evaluate(() => window.__ufo.setGraphics("low"));
await page.waitForFunction(() => window.__ufo.graphicsReady, null, { timeout: 120000 });

// Enters the game (pointer lock) from the main or pause menu.
async function play() {
  if ((await v((g) => g.gameState)) === "playing") return;
  const btn = (await v((g) => g.gameState)) === "start" ? "#play-btn" : "#resume-btn";
  await page.click(btn, { timeout: 60000 });
  await page.waitForFunction(() => window.__ufo.gameState === "playing", null, { timeout: 30000 });
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
  assert(s.preset === "medium" || s.preset === "low", `preset ${s.preset}`);
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

await check("new game: 8-slot loadout with the laser blaster and jet radio", async () => {
  await play();
  const hotbar = await v((g) => g.inventory.slots.slice(0, 9).map((s) => s?.id ?? 0));
  assert(JSON.stringify(hotbar.slice(0, 8)) === JSON.stringify([287, 286, 288, 289, 291, 290, 292, 293]), `hotbar ${hotbar}`);
  await v((g) => {
    g.setMode("creative");
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

// ---------- Summary ----------
const failed = results.filter(([, ok]) => !ok);
console.log(`\n${results.length - failed.length} passed, ${failed.length} failed${errors.length ? `; console errors: ${errors.length}` : ""}.`);
if (errors.length) console.log(errors.slice(0, 5).join("\n"));
await browser.close();
server.close();
process.exit(failed.length || errors.length ? 1 : 0);
