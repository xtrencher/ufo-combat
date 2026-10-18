// Round 12 graphics tests: the automatic graphics (js/autotune.js) and the
// lighter grass.
// In Node (fast): the tuner's ladder and rules, driven with made-up frame
// times (best by default, a step down after a few seconds under 40 FPS,
// hitches ignored, menus and chunk bursts ignored, one step back up at most,
// stopping when a step gains nothing, the bottom, the player's choice, the
// saved level, the safe start, ?graphics=, automated browsers), and the
// settings upgrade of older saves.
// In the browser (the real game): an automated browser keeps the old
// default with the tuner off; with ?autotune=1 the tuner steps down while
// the frames are slow (faked through autotune.fakeFrameTime), saves where it
// settled and starts there after a reload; a preset the player picks turns
// it off for good, Auto turns it back on, a Performance setting turns it off
// again; no grass grows over a dropped item.
//
//   node r12-graphics-tests.mjs [--only=substring] [--node]
// (GAME_ROOT=dir runs another copy of the game; R12_PATCHED=dir serves
// dir/js/main.js and dir/index.html instead of the game's own, to try the
// wiring before it is merged.)
import http from "node:http";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(process.env.GAME_ROOT || path.join(__dirname, ".."));
const PATCHED = process.env.R12_PATCHED ? path.resolve(process.env.R12_PATCHED) : null;
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
const { AutoTune, LADDER, TARGET_FPS } = await imp("js/autotune.js");
const { normalizeSettings } = await imp("js/settings.js");

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

// ---------- In Node ----------

// A tuner over a settings object normalized from `raw`, with recording hooks.
function tuner(raw, opts = {}) {
  const settings = normalizeSettings(raw);
  const t = new AutoTune(settings, { save: () => {}, automated: false, search: "", ...opts });
  const applied = [];
  const toasts = [];
  t.attach({ apply: (lv) => applied.push(lv.label), toast: (x) => toasts.push(x), busy: () => false });
  return { settings, t, applied, toasts };
}
// `seconds` of frames of `ft` seconds each (or ft(level) per frame).
const run = (t, seconds, ft, active = true) => {
  for (let x = 0; x < seconds; ) {
    const f = typeof ft === "function" ? ft(t.level) : ft;
    t.update(f, active);
    x += f;
  }
};

await check("a new install starts at the best graphics and performance", () => {
  const { settings: s, t } = tuner(null);
  assert(t.on && t.level === 0 && LADDER[0].graphics === "ultra", `on at the top: ${JSON.stringify(t.stats())}`);
  assert(s.graphics === "ultra" && s.renderDistance === 32 && s.perf.detailDistance === 10 && s.perf.lodQuality === "ultra" && s.perf.resolution === 1 && s.perf.effects === "high" && !s.renderDistanceCustom, `the settings: ${JSON.stringify({ g: s.graphics, rd: s.renderDistance, perf: s.perf })}`);
});

await check("the ladder goes from the best to the lightest, a real change each step", () => {
  const order = ["low", "medium", "high", "ultra"];
  for (let i = 1; i < LADDER.length; i++) {
    const a = LADDER[i - 1];
    const b = LADDER[i];
    assert(order.indexOf(b.graphics) <= order.indexOf(a.graphics) && b.renderDistance <= a.renderDistance && b.detail <= a.detail, `level ${i} is no lighter`);
    assert(JSON.stringify({ ...a, label: 0 }) !== JSON.stringify({ ...b, label: 0 }), `level ${i} changes nothing`);
  }
});

await check(`under ${TARGET_FPS} FPS for a few seconds: one step down (not sooner), with a toast`, () => {
  const { t, applied, toasts } = tuner(null);
  run(t, 60, 1 / 60);
  assert(t.level === 0 && !applied.length, "60 FPS: stays");
  run(t, 5, 1 / 30);
  assert(t.level === 0, "not after 5 s");
  run(t, 3, 1 / 30);
  assert(t.level === 1 && applied[0] === LADDER[1].label && /lowered to/.test(toasts[0]), `a step: ${JSON.stringify(t.stats())} ${toasts}`);
});

await check("hitches, menus and chunk bursts don't count", () => {
  let { t } = tuner(null);
  for (let i = 0; i < 40; i++) {
    run(t, 1, 1 / 50);
    t.update(0.4, true);
  }
  assert(t.level === 0, "a hitch a second at 50 FPS");
  ({ t } = tuner(null));
  run(t, 100, 1 / 10, false);
  assert(t.level === 0, "slow frames on a menu");
  ({ t } = tuner(null));
  t.attach({ busy: () => true });
  run(t, 14, 1 / 20);
  assert(t.level === 0, "a chunk burst");
  run(t, 20, 1 / 20);
  assert(t.level === 1, "but not forever");
  ({ t } = tuner(null));
  run(t, 20, 1 / 60);
  t.update(30, true);
  run(t, 3, 1 / 60);
  assert(t.level === 0, "a frame spanning a gap (a hidden tab)");
});

await check("it steps on while slow, stops when steps gain nothing, and at the bottom", () => {
  let { t, applied, toasts } = tuner(null);
  const fps = [12, 18, 26, 34, 45, 60, 60, 60];
  run(t, 400, (l) => 1 / fps[l]);
  assert(t.level === 4 && applied.length === 4, `stops where it is fast enough: ${applied}`);
  ({ t } = tuner(null));
  run(t, 200, 1 / 20);
  assert(t.level === 2 && t.stats().stopped, `two steps without a gain: stops (${t.level})`);
  ({ t, toasts } = tuner(null));
  const slow = [5, 7, 9, 11, 13, 16, 19, 23];
  run(t, 800, (l) => 1 / slow[l]);
  assert(t.level === LADDER.length - 1 && /lightest/.test(toasts[toasts.length - 1]), "the bottom, with a note");
  ({ t } = tuner(null));
  run(t, 120, 2);
  assert(t.level >= 1, "a PC at 0.5 FPS is tuned too");
});

await check("one step back up at most, only to a level that ran fine this session", () => {
  let { t, toasts } = tuner(null);
  run(t, 60, 1 / 50);
  run(t, 12, 1 / 30);
  assert(t.level === 1, "down in a heavy scene");
  run(t, 100, 1 / 60);
  assert(t.level === 0 && /raised/.test(toasts[toasts.length - 1]), `back up after a long headroom: ${t.level}`);
  run(t, 12, 1 / 30);
  run(t, 300, 1 / 60);
  assert(t.level === 1, "never up twice");
  const saved = JSON.parse(JSON.stringify(tuner({ autoGraphics: { on: true, level: 2 } }).settings));
  ({ t } = tuner(saved));
  run(t, 300, 1 / 60);
  assert(t.level === 2, "no climb above where a session started");
});

await check("the player's choice turns it off for good; Auto turns it on again", () => {
  const { settings: s, t, applied } = tuner(null);
  t.chosen();
  run(t, 100, 1 / 10);
  assert(!t.on && s.autoGraphics.on === false && t.level === 0 && !applied.length, "off: no tuning");
  assert(normalizeSettings(JSON.parse(JSON.stringify(s))).autoGraphics.on === false, "and saved");
  t.enable();
  assert(t.on && applied[0] === LADDER[0].label, "Auto: on, its level applied");
});

await check("the settled level is saved; the safe start steps a failed level down for good", () => {
  const { settings: s, t } = tuner(null);
  run(t, 20, 1 / 25);
  const saved = JSON.parse(JSON.stringify(s));
  let n = tuner(saved);
  assert(n.t.level === 1 && n.settings.graphics === LADDER[1].graphics, "the next session starts there");
  n = tuner(saved, { lastBoot: { preset: LADDER[1].graphics, ok: false } });
  assert(n.t.level === 3 && n.settings.graphics === "medium" && n.t.bootNotice, `a start that never drew the world: the next lower preset (${n.t.level})`);
  n = tuner(saved, { lastBoot: { preset: LADDER[1].graphics, ok: true } });
  assert(n.t.level === 1 && !n.t.bootNotice, "a good last start: unchanged");
  n = tuner({ autoGraphics: { on: true, level: LADDER.length - 1 } }, { lastBoot: { preset: "low", ok: false } });
  assert(n.t.level === LADDER.length - 1, "nothing below the bottom");
});

await check("?graphics= is a choice; an automated browser keeps the old default, tuner off", () => {
  let n = tuner(null, { search: "?graphics=low" });
  assert(!n.t.on && n.settings.autoGraphics.on === false, "?graphics=low");
  n = tuner(null, { automated: true });
  assert(!n.t.on && n.settings.graphics === "medium" && n.settings.renderDistance === 25, "automated");
});

await check("older saves: still on every old default gets Auto (once), a choice of its own stays", () => {
  const defaults = { graphics: "medium", renderDistance: 25, gfxOverrides: {}, perf: { detailDistance: 0, lodQuality: "medium", resolution: 1, effects: "high" } };
  assert(normalizeSettings({ v: 5, ...defaults }).autoGraphics.on === true, "untouched");
  assert(normalizeSettings({ ...defaults }).autoGraphics.on === true, "untouched, no version");
  assert(normalizeSettings({ v: 5, ...defaults, graphics: "high" }).autoGraphics.on === false, "a preset");
  assert(normalizeSettings({ v: 5, ...defaults, renderDistanceCustom: true, renderDistance: 40 }).autoGraphics.on === false, "a render distance");
  assert(normalizeSettings({ v: 5, ...defaults, gfxOverrides: { bloom: "off" } }).autoGraphics.on === false, "an option");
  assert(normalizeSettings({ v: 5, ...defaults, perf: { ...defaults.perf, resolution: 0.7 } }).autoGraphics.on === false, "a performance setting");
  assert(normalizeSettings({ v: 6, ...defaults }).autoGraphics.on === false, "a current save without it");
  const s = normalizeSettings({ autoGraphics: { on: "yes", level: "x" } });
  assert(s.autoGraphics.on === false && s.autoGraphics.level === 0, "garbage");
});

// ---------- In the browser ----------

if (!args.node) await browserChecks();

async function browserChecks() {
  const { chromium } = await import("playwright-core");
  const PORT = 9880 + Math.floor(Math.random() * 40);
  const MIME = { ".html": "text/html", ".js": "text/javascript" };
  const server = http.createServer((req, res) => {
    const url = decodeURIComponent(req.url.split("?")[0]);
    let filePath = path.join(ROOT, url);
    if (filePath.endsWith("/")) filePath = path.join(filePath, "index.html");
    if (PATCHED && (url === "/js/main.js" || url === "/index.html" || url === "/")) filePath = path.join(PATCHED, url === "/" ? "index.html" : url);
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
    args: ["--use-gl=swiftshader", "--enable-webgl", "--ignore-gpu-blocklist", "--no-sandbox", "--disable-dev-shm-usage"],
  });
  const localThreeRoot = path.join(__dirname, "node_modules", "three");
  const peerjsFile = path.join(__dirname, "node_modules", "peerjs", "dist", "peerjs.min.js");
  async function newPage(label, size = { width: 800, height: 450 }) {
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
  const v = (p, fn, arg) => p.evaluate(([src, a]) => new Function("g", "arg", `return (${src})(g, arg);`)(window.__ufo, a), [fn.toString(), arg]);
  async function until(p, fn, timeout = 30000, arg) {
    const t0 = Date.now();
    while (Date.now() - t0 < timeout) {
      const r = await v(p, fn, arg).catch(() => null);
      if (r) return r;
      await new Promise((res) => setTimeout(res, 250));
    }
    return null;
  }
  const boot = async (p, query) => {
    await p.goto(`http://127.0.0.1:${PORT}/index.html?seed=4242${query}`, { waitUntil: "load", timeout: 60000 });
    await p.waitForFunction(() => !!window.__ufo && window.__ufo.graphicsReady, null, { timeout: 180000 });
  };
  async function play(p) {
    const t0 = Date.now();
    while (Date.now() - t0 < 180000) {
      const st = await v(p, (g) => g.gameState);
      if (st === "playing") return;
      if (st === "dead") await v(p, (g) => g.respawn());
      else if (st === "start") await p.click("#play-btn", { timeout: 5000 }).catch(() => {});
      else if (await p.isVisible("#resume-btn").catch(() => false)) await p.click("#resume-btn", { timeout: 3000 }).catch(() => {});
      else await p.mouse.click(300, 200);
      await new Promise((r) => setTimeout(r, 500));
    }
    throw new Error("the game didn't start playing");
  }
  const saved = (p) => p.evaluate(() => JSON.parse(localStorage.getItem("ufocombat_v1_settings")));
  const browserCheck = async (name, fn) => {
    const before = errors.length;
    await check(name, async () => {
      await fn();
      if (errors.length > before) throw new Error(`console errors: ${errors.slice(before, before + 3).join(" | ")}`);
    });
  };

  await browserCheck("an automated browser: the old default (Medium), the tuner off", async () => {
    const p = await newPage("automated");
    await boot(p, "");
    const r = await v(p, (g) => ({ on: g.autotune.on, g: g.graphics, sel: document.getElementById("graphics-preset").value, rd: g.renderDistance }));
    assert(!r.on && r.g === "medium" && r.sel === "medium" && r.rd === 25, JSON.stringify(r));
    await p.context().close();
  });

  const p = await newPage("auto");
  // A start a few levels down the ladder (cheap shaders under software rendering).
  await p.goto(`http://127.0.0.1:${PORT}/none`).catch(() => {});
  await p.evaluate(() => localStorage.setItem("ufocombat_v1_settings", JSON.stringify({ v: 6, autoGraphics: { on: true, level: 4 } })));

  await browserCheck("?autotune=1: Auto shown, its level in effect", async () => {
    await boot(p, "&autotune=1");
    const r = await v(p, (g) => ({ s: g.autotune.stats(), g: g.graphics, rd: g.renderDistance, res: g.settings.perf.resolution, sel: document.getElementById("graphics-preset").value, btn: document.querySelector('#perf-presets [data-preset="auto"]')?.classList.contains("active"), hint: document.getElementById("graphics-hint").textContent }));
    assert(r.s.on && r.s.level === 4 && r.g === LADDER[4].graphics && r.rd === LADDER[4].renderDistance && r.res === LADDER[4].resolution, JSON.stringify(r));
    assert(r.sel === "auto" && r.btn && /^Auto: /.test(r.hint), `the preset rows: ${JSON.stringify(r)}`);
  });

  await browserCheck("slow frames in play: a step down (toast, saved), and on while slow until steps gain nothing", async () => {
    await play(p);
    await v(p, (g) => {
      g.autotune.fakeFrameTime = 0.25; // 4 FPS
      g.autotune.hooks.busy = () => false;
    });
    const one = await until(p, (g) => g.autotune.level === 5 && { g: g.graphics, rd: g.renderDistance, toast: document.getElementById("hud-toast").textContent }, 240000);
    assert(one && one.g === LADDER[5].graphics && one.rd === LADDER[5].renderDistance && /lowered to Low/.test(one.toast), `the first step: ${JSON.stringify(one)}`);
    const s = await saved(p);
    assert(s.autoGraphics.on && s.autoGraphics.level === 5 && s.graphics === "low", `saved: ${JSON.stringify(s.autoGraphics)}`);
    // (The same fake frame time at every level: the second step gains nothing, the third is not taken.)
    const two = await until(p, (g) => g.autotune.stats().stopped && g.autotune.stats(), 300000);
    assert(two && two.level === 6, `stopped after two steps without a gain: ${JSON.stringify(two)}`);
  });

  await browserCheck("after a reload: starts where it settled", async () => {
    await boot(p, "&autotune=1");
    const r = await v(p, (g) => ({ s: g.autotune.stats(), g: g.graphics, rd: g.renderDistance, res: g.settings.perf.resolution }));
    assert(r.s.on && r.s.level === 6 && r.g === LADDER[6].graphics && r.rd === LADDER[6].renderDistance && r.res === LADDER[6].resolution, JSON.stringify(r));
  });

  await browserCheck("the player's preset: tuner off for good (after a reload too); Auto: on again; a Performance setting: off", async () => {
    await p.evaluate(() => {
      const sel = document.getElementById("graphics-preset");
      sel.value = "medium";
      sel.dispatchEvent(new Event("change", { bubbles: true }));
    });
    let r = await v(p, (g) => ({ on: g.autotune.on, g: g.graphics, sel: document.getElementById("graphics-preset").value, btn: document.querySelector('#perf-presets [data-preset="auto"]').classList.contains("active") }));
    assert(!r.on && r.g === "medium" && r.sel === "medium" && !r.btn, `picked Medium: ${JSON.stringify(r)}`);
    await play(p);
    await v(p, (g) => {
      g.autotune.fakeFrameTime = 0.25;
      g.autotune.hooks.busy = () => false;
    });
    await new Promise((res) => setTimeout(res, 20000));
    r = await v(p, (g) => ({ on: g.autotune.on, g: g.graphics }));
    assert(!r.on && r.g === "medium", `slow frames change nothing: ${JSON.stringify(r)}`);
    assert((await saved(p)).autoGraphics.on === false, "saved off");
    await boot(p, "&autotune=1");
    r = await v(p, (g) => ({ on: g.autotune.on, g: g.graphics, sel: document.getElementById("graphics-preset").value }));
    assert(!r.on && r.g === "medium" && r.sel === "medium", `after a reload: ${JSON.stringify(r)}`);
    await p.evaluate(() => {
      const sel = document.getElementById("graphics-preset");
      sel.value = "auto";
      sel.dispatchEvent(new Event("change", { bubbles: true }));
    });
    r = await v(p, (g) => ({ on: g.autotune.on, g: g.graphics, rd: g.renderDistance, sel: document.getElementById("graphics-preset").value }));
    assert(r.on && r.g === LADDER[6].graphics && r.rd === LADDER[6].renderDistance && r.sel === "auto", `Auto again: ${JSON.stringify(r)}`);
    await p.evaluate(() => {
      const sel = document.getElementById("perf-lodQuality");
      sel.value = "high";
      sel.dispatchEvent(new Event("change", { bubbles: true }));
    });
    r = await v(p, (g) => ({ on: g.autotune.on, lod: g.settings.perf.lodQuality, sel: document.getElementById("graphics-preset").value }));
    assert(!r.on && r.lod === "high" && r.sel === LADDER[6].graphics, `a Performance setting: ${JSON.stringify(r)}`);
    await p.evaluate(() => document.querySelector('#perf-presets [data-preset="auto"]').click());
    r = await v(p, (g) => ({ on: g.autotune.on, lod: g.settings.perf.lodQuality }));
    assert(r.on && r.lod === LADDER[6].lod, `the Auto button: ${JSON.stringify(r)}`);
  });

  await browserCheck("no grass grows over a dropped item", async () => {
    await play(p);
    const r = await v(p, (g) => {
      const { world, player, entities, grass, THREE } = g;
      g.autotune.chosen();
      const s = g.spawn;
      let spot = null;
      for (let rr = 0; rr < 90 && !spot; rr++) {
        for (let a = 0; a < 16 && !spot; a++) {
          const x = Math.floor(s.x + Math.cos((a / 16) * Math.PI * 2) * rr);
          const z = Math.floor(s.z + Math.sin((a / 16) * Math.PI * 2) * rr);
          const y = world.heightAt(x, z);
          if (world.getBlock(x, y, z) === 1 && world.getBlock(x, y + 1, z) === 0 && world.getChunk(x >> 4, z >> 4)?.meshed) spot = { x, y, z };
        }
      }
      if (!spot) return { err: "no grass" };
      player.position.set(spot.x + 0.5, spot.y + 1, spot.z + 3.5);
      grass.configure({ level: 2 });
      const item = entities.spawn(323, 1, new THREE.Vector3(spot.x + 0.5, spot.y + 1.02, spot.z + 0.5), new THREE.Vector3(0, 0, 0), { pickupDelay: 999 });
      item.onGround = true;
      grass._builtAt.set(Infinity, 0, 0);
      grass.update(player.position);
      const o = grass.layers.tuft.offset.array;
      let nearest = Infinity;
      for (let i = 0; i < grass.layers.tuft.count; i++) {
        if (Math.abs(o[i * 3 + 1] - item.pos.y) > 1) continue;
        nearest = Math.min(nearest, Math.hypot(o[i * 3] - item.pos.x, o[i * 3 + 2] - item.pos.z));
      }
      return { nearest, wired: !!grass.items, count: grass.count };
    });
    assert(!r.err && r.wired && r.count > 50 && r.nearest >= 0.6 && r.nearest < 3, JSON.stringify(r));
  });

  await p.context().close();
  await browser.close();
  server.close();
}

// ---------- Summary ----------
const failed = results.filter(([, ok]) => !ok);
console.log(`\n${results.length - failed.length} passed, ${failed.length} failed.`);
process.exit(failed.length ? 1 : 0);
