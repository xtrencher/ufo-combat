// Settings persistence: boots the real game in headless Chromium (software
// WebGL) and checks that every setting survives a reload.
//
//   node settings-tests.mjs [--only=substring] [--from=substring] [--seed=42]
//
// Like the other suites, it fails on any console error or page error.
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
const PORT = 9240 + Math.floor(Math.random() * 40);
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
const context = await browser.newContext({ viewport: { width: 960, height: 540 } });
const page = await context.newPage();
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
async function until(fn, timeout = 60000, arg) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeout) {
    const r = await v(fn, arg);
    if (r) return r;
    await frames(2);
  }
  return null;
}

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
const KEY = "ufocombat_v1_settings";
async function boot() {
  await page.goto(`http://localhost:${PORT}/index.html?seed=${SEED}`, { waitUntil: "load", timeout: 60000 });
  await page.waitForFunction(() => !!window.__ufo, null, { timeout: 60000 });
  await page.waitForFunction(() => window.__ufo.graphicsReady, null, { timeout: 180000 });
}
// A clean browser profile: no saved settings (a script that runs before the
// game's own, once; the old page may save as it unloads).
async function freshBoot(setup = "clear") {
  await page.evaluate(([mode, key]) => {
    sessionStorage.setItem("__settingsTestSetup", mode);
    sessionStorage.setItem("__settingsTestKey", key);
  }, [setup, KEY]);
  await boot();
}
await page.addInitScript(() => {
  const mode = sessionStorage.getItem("__settingsTestSetup");
  if (!mode) return;
  sessionStorage.removeItem("__settingsTestSetup");
  const key = sessionStorage.getItem("__settingsTestKey");
  for (const k of Object.keys(localStorage)) if (k.startsWith("ufocombat_v1_settings") || k.startsWith("ufocombat_v1_boot")) localStorage.removeItem(k);
  if (mode === "corrupt") localStorage.setItem(key, "{not json!");
  if (mode === "garbage") localStorage.setItem(key, JSON.stringify({ v: 999, fov: "banana", volume: { master: -4 }, perf: null, renderDistance: 1e9, gfxOverrides: 7 }));
  if (mode === "legacy") localStorage.setItem(key, JSON.stringify({ fov: 88, renderDistance: 21, graphics: "medium", volume: { master: 0.3 }, ufos: { activity: 4 } }));
});
await boot();
await freshBoot("clear");

// Sets a control like a player would (its value, then the input/change event).
async function setControl(id, value) {
  const ok = await page.evaluate(([id, value]) => {
    const el = document.getElementById(id);
    if (!el) return false;
    if (el.type === "checkbox") el.checked = value;
    else el.value = String(value);
    el.dispatchEvent(new Event(el.type === "range" ? "input" : "change", { bubbles: true }));
    return true;
  }, [id, value]);
  assert(ok, `no control #${id}`);
}

await check("every setting changed through the menus is restored exactly after a reload (and applied)", async () => {
  // 1. The graphics preset first (it adopts its suggested render distance and
  // clears individual options), then everything else on top of it.
  await setControl("graphics-preset", "high");
  await frames(2);
  // 2. Every schema setting (all tabs), to a value that isn't its default.
  const plan = await v(async () => {
    const { SCHEMA } = await import("./js/settings.js");
    const out = [];
    for (const e of SCHEMA) {
      const id = e.id || e.key.replace(/\./g, "-");
      let dom;
      let want;
      if (e.type === "checkbox") {
        want = !e.def;
        dom = want;
      } else if (e.type === "select") {
        want = e.choices.map((c) => c[0]).find((c) => c !== e.def);
        dom = want;
      } else if (e.values) {
        const i = e.values.findIndex((x) => x !== e.def && x !== e.values[0]) ;
        want = e.values[i >= 0 ? i : e.values.length - 1];
        dom = e.values.indexOf(want);
      } else {
        const steps = Math.round((e.max - e.min) / e.step);
        let k = Math.round(steps * 0.63);
        want = +(e.min + k * e.step).toFixed(6);
        if (Math.abs(want - e.def) < 1e-9) want = +(e.min + (k - 1) * e.step).toFixed(6);
        dom = want;
      }
      out.push({ key: e.key, id, want, dom });
    }
    return out;
  });
  for (const p of plan) await setControl(p.id, p.dom);
  // 3. Hand-written settings: audio volumes, an individual graphics option,
  // the render distance, the Mods switch.
  const vols = { master: 0.37, blocks: 0.21, weapons: 0.64, creatures: 0.12, player: 0.88, ui: 0.5 };
  for (const [k, x] of Object.entries(vols)) await setControl(`vol-${k}`, x);
  await setControl("gfx-bloom", "off");
  await setControl("render-distance", 23);
  await setControl("mods-enabled", false);
  await frames(3);
  const before = await v(() => JSON.parse(localStorage.getItem("ufocombat_v1_settings")));
  // Saved immediately: every change is already in storage.
  const byKey = (o, k) => k.split(".").reduce((a, b) => (a == null ? a : a[b]), o);
  const notSaved = plan.filter((p) => JSON.stringify(byKey(before, p.key)) !== JSON.stringify(p.want)).map((p) => `${p.key}: saved ${JSON.stringify(byKey(before, p.key))}, set ${JSON.stringify(p.want)}`);
  assert(notSaved.length === 0, `saved at once: ${notSaved.join("; ")}`);
  assert(before.graphics === "high" && before.gfxOverrides?.bloom === "off" && before.renderDistance === 23 && before.mods === false, `hand-written ones saved: ${JSON.stringify({ g: before.graphics, o: before.gfxOverrides, rd: before.renderDistance, mods: before.mods })}`);
  for (const [k, x] of Object.entries(vols)) assert(Math.abs(before.volume[k] - x) < 1e-9, `volume ${k} saved`);
  // 4. Reload (the game's own unload handlers run) and compare.
  await boot();
  const after = await v(() => ({
    saved: JSON.parse(localStorage.getItem("ufocombat_v1_settings")),
    live: JSON.parse(JSON.stringify(window.__ufo.settings)),
    graphics: window.__ufo.graphics,
    rd: window.__ufo.renderDistance,
    lodRD: window.__ufo.lod.renderDistance,
    fov: window.__ufo.player.baseFov,
    sens: window.__ufo.player.mouseSensitivity,
    vols: { ...window.__ufo.audio.volumes },
    mods: window.__ufo.mods.enabled,
    bloomSelect: document.getElementById("gfx-bloom").value,
    rdSlider: document.getElementById("render-distance").value,
    presetSelect: document.getElementById("graphics-preset").value,
  }));
  const dom = await v(async (g, plan) => {
    const out = {};
    for (const p of plan) {
      const el = document.getElementById(p.id);
      out[p.key] = el.type === "checkbox" ? el.checked : el.type === "range" ? Number(el.value) : el.value;
    }
    return out;
  }, plan);
  const bad = [];
  for (const p of plan) {
    if (JSON.stringify(byKey(after.live, p.key)) !== JSON.stringify(p.want)) bad.push(`${p.key}: live ${JSON.stringify(byKey(after.live, p.key))} want ${JSON.stringify(p.want)}`);
    if (JSON.stringify(dom[p.key]) !== JSON.stringify(p.dom)) bad.push(`${p.key}: control shows ${JSON.stringify(dom[p.key])} want ${JSON.stringify(p.dom)}`);
  }
  for (const [k, x] of Object.entries(vols)) if (Math.abs(after.live.volume[k] - x) > 1e-9 || Math.abs(after.vols[k] - x) > 1e-9) bad.push(`volume ${k}: ${after.live.volume[k]} / applied ${after.vols[k]}`);
  if (after.graphics !== "high" || after.presetSelect !== "high") bad.push(`preset ${after.graphics} / ${after.presetSelect}`);
  if (after.live.gfxOverrides?.bloom !== "off" || after.bloomSelect !== "off") bad.push(`bloom override ${JSON.stringify(after.live.gfxOverrides)} / ${after.bloomSelect}`);
  if (after.rd !== 23 || after.lodRD !== 23 || after.rdSlider !== "23") bad.push(`render distance ${after.rd} / lod ${after.lodRD} / slider ${after.rdSlider}`);
  if (after.mods !== false || after.live.mods !== false) bad.push(`mods ${after.mods}`);
  const fovWant = plan.find((p) => p.key === "fov").want;
  const sensWant = plan.find((p) => p.key === "sensitivity").want;
  if (after.fov !== fovWant || Math.abs(after.sens - sensWant) > 1e-9) bad.push(`applied fov ${after.fov} sens ${after.sens}`);
  if (JSON.stringify(after.saved) !== JSON.stringify(before)) bad.push(`storage changed by the reload: ${JSON.stringify(before).slice(0, 200)} -> ${JSON.stringify(after.saved).slice(0, 200)}`);
  assert(bad.length === 0, `not restored: ${bad.join("; ")}`);
  // A second reload changes nothing either.
  await boot();
  const again = await v(() => JSON.parse(localStorage.getItem("ufocombat_v1_settings")));
  const diff = [];
  const walk = (a, b, pre) => {
    for (const k of new Set([...Object.keys(a || {}), ...Object.keys(b || {})])) {
      if (a?.[k] && typeof a[k] === "object") walk(a[k], b?.[k], `${pre}${k}.`);
      else if (JSON.stringify(a?.[k]) !== JSON.stringify(b?.[k])) diff.push(`${pre}${k}: ${JSON.stringify(a?.[k])} -> ${JSON.stringify(b?.[k])}`);
    }
  };
  walk(before, again, "");
  assert(diff.length === 0, `a second reload keeps everything: ${diff.join("; ")}`);
});

await check("a graphics preset picked later doesn't silently undo individual settings changed afterwards; picking one only changes what it controls", async () => {
  await freshBoot("clear");
  await setControl("graphics-preset", "medium");
  await setControl("gfx-shadows", "off"); // an individual option on top of the preset
  await setControl("render-distance", 17);
  await setControl("fov", 95);
  await setControl("perf-resolution", 0.8);
  await boot();
  const r = await v(() => ({ s: window.__ufo.settings, g: window.__ufo.graphics, rd: window.__ufo.renderDistance, shadows: document.getElementById("gfx-shadows").value }));
  assert(r.g === "medium" && r.s.gfxOverrides.shadows === "off" && r.shadows === "off" && r.rd === 17 && r.s.fov === 95 && r.s.perf.resolution === 0.8, `a preset and later changes survive: ${JSON.stringify({ g: r.g, o: r.s.gfxOverrides, rd: r.rd, fov: r.s.fov, res: r.s.perf.resolution })}`);
});

await check("versioned, one object under the game's prefix; missing, corrupted or garbage data falls back to defaults without errors", async () => {
  for (const mode of ["clear", "corrupt", "garbage"]) {
    await freshBoot(mode);
    const r = await v(async () => {
      const { DEFAULT_SETTINGS, SETTINGS_VERSION } = await import("./js/settings.js");
      const s = window.__ufo.settings;
      const keys = Object.keys(localStorage).filter((k) => k.includes("settings"));
      return { v: s.v, SETTINGS_VERSION, fov: s.fov, master: s.volume.master, rd: window.__ufo.renderDistance, def: DEFAULT_SETTINGS.fov, perfOk: typeof s.perf === "object" && s.perf.resolution === DEFAULT_SETTINGS.perf.resolution, overrides: s.gfxOverrides, keys, state: window.__ufo.gameState };
    });
    assert(r.state === "start" && r.v === r.SETTINGS_VERSION && r.fov === r.def && r.master >= 0 && r.master <= 1 && r.rd >= 2 && r.rd <= 256 && r.perfOk && typeof r.overrides === "object" && !Array.isArray(r.overrides), `${mode}: ${JSON.stringify(r)}`);
    assert(r.keys.length === 1 && r.keys[0] === KEY, `${mode}: one settings key: ${r.keys}`);
  }
  // An older save (no version) keeps its values.
  await freshBoot("legacy");
  const r = await v(() => ({ s: window.__ufo.settings, g: window.__ufo.graphics, rd: window.__ufo.renderDistance }));
  assert(r.s.fov === 88 && r.rd === 21 && r.g === "medium" && r.s.volume.master === 0.3 && r.s.ufos.activity === 4, `an unversioned save is kept: ${JSON.stringify({ fov: r.s.fov, rd: r.rd, g: r.g, m: r.s.volume.master, a: r.s.ufos.activity })}`);
  await freshBoot("clear");
});

await check("a full browser storage (world saves filling the quota) doesn't stop settings from being saved", async () => {
  await freshBoot("clear");
  // Fill the storage up to the quota with something the game can't remove.
  const filled = await v(() => {
    let n = 0;
    const big = "x".repeat(256 * 1024);
    try {
      for (;;) localStorage.setItem(`__filler_${n++}`, big);
    } catch (err) {}
    const small = "x".repeat(512);
    try {
      for (let i = 0; i < 100000; i++) localStorage.setItem(`__fill_small_${i}`, small);
    } catch (err) {}
    let ok = true;
    try {
      localStorage.setItem("__probe", "y".repeat(4096));
      localStorage.removeItem("__probe");
    } catch (err) {
      ok = false;
    }
    return { n, full: !ok };
  });
  assert(filled.full, `the storage is full: ${JSON.stringify(filled)}`);
  await setControl("fov", 101);
  await setControl("sensitivity", 3.35);
  await setControl("ufos-activity", 7); // (index into its steps: Invasion)
  await setControl("vol-master", 0.42);
  await boot();
  const r = await v(() => ({ fov: window.__ufo.settings.fov, sens: window.__ufo.settings.sensitivity, act: window.__ufo.settings.ufos.activity, master: window.__ufo.settings.volume.master }));
  await v(() => {
    for (const k of Object.keys(localStorage)) if (k.startsWith("__fill")) localStorage.removeItem(k);
  });
  assert(r.fov === 101 && Math.abs(r.sens - 3.35) < 1e-9 && r.act === 8 && r.master === 0.42, `saved despite the full storage: ${JSON.stringify(r)}`);
});

await check("two tabs: a change in one is taken over by the other, which never writes its older copy back", async () => {
  await freshBoot("clear");
  const other = await page.context().newPage();
  await other.route("https://cdn.jsdelivr.net/npm/three@0.160.0/**", (route) => {
    const rel = new URL(route.request().url()).pathname.replace("/npm/three@0.160.0/", "");
    route.fulfill({ path: path.join(localThreeRoot, rel), contentType: "text/javascript" });
  });
  other.on("pageerror", (e) => errors.push(String(e)));
  await other.goto(`http://localhost:${PORT}/index.html?seed=${SEED}`, { waitUntil: "load", timeout: 60000 });
  await other.waitForFunction(() => window.__ufo && window.__ufo.graphicsReady, null, { timeout: 180000 });
  // Tab 2 changes the field of view; tab 1 then changes the sensitivity.
  await other.evaluate(() => {
    const el = document.getElementById("fov");
    el.value = "104";
    el.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await frames(5);
  const tab1 = await v(() => window.__ufo.settings.fov);
  await setControl("sensitivity", 2.2);
  const stored = await v(() => JSON.parse(localStorage.getItem("ufocombat_v1_settings")));
  await other.close();
  assert(tab1 === 104, `tab 1 took over the new field of view: ${tab1}`);
  assert(stored.fov === 104 && stored.sensitivity === 2.2, `both changes are stored: ${JSON.stringify({ fov: stored.fov, sens: stored.sensitivity })}`);
});

await check("a render distance the player set is kept when a graphics preset is picked later (a performance preset sets it explicitly)", async () => {
  await freshBoot("clear");
  await setControl("render-distance", 33);
  await setControl("graphics-preset", "low");
  let r = await v(() => ({ rd: window.__ufo.renderDistance, g: window.__ufo.graphics }));
  assert(r.rd === 33 && r.g === "low", `the player's render distance survives a preset pick: ${JSON.stringify(r)}`);
  await page.evaluate(() => document.querySelector('#perf-presets button[data-preset="balanced"]').click());
  await boot();
  r = await v(() => ({ rd: window.__ufo.renderDistance, g: window.__ufo.graphics }));
  assert(r.rd === 12 && r.g === "medium", `a performance preset sets it: ${JSON.stringify(r)}`);
});

await check("a lost graphics context (sleep, driver reset) doesn't lower the next start or drop the player's graphics options", async () => {
  await freshBoot("clear");
  await setControl("graphics-preset", "high");
  await setControl("gfx-shadows", "low");
  // (Once the preset has been drawn: a loss while its shaders are still
  // compiling is what the safe start is for.)
  await page.waitForFunction(() => window.__ufo.graphicsReady, null, { timeout: 180000 });
  await frames(8);
  await page.evaluate(() => {
    const e = new Event("webglcontextlost", { cancelable: true });
    document.querySelector("canvas").dispatchEvent(e);
  });
  await boot();
  const r = await v(() => ({ g: window.__ufo.graphics, o: window.__ufo.settings.gfxOverrides, sel: document.getElementById("graphics-preset").value }));
  assert(r.g === "high" && r.sel === "high" && r.o.shadows === "low", `the next start keeps them: ${JSON.stringify(r)}`);
  // "Reload with lower graphics once": that session only; the saved settings stay.
  await frames(8);
  await page.evaluate(() => document.querySelector("canvas").dispatchEvent(new Event("webglcontextlost", { cancelable: true })));
  await Promise.all([page.waitForNavigation({ waitUntil: "load" }), page.click("#gpu-lost-lower")]);
  await page.waitForFunction(() => window.__ufo && window.__ufo.graphicsReady, null, { timeout: 180000 });
  const low = await v(() => ({ g: window.__ufo.graphics, saved: JSON.parse(localStorage.getItem("ufocombat_v1_settings")) }));
  assert(low.g === "medium" && low.saved.graphics === "high" && low.saved.gfxOverrides.shadows === "low", `lowered once, saved unchanged: ${JSON.stringify({ g: low.g, s: low.saved.graphics, o: low.saved.gfxOverrides })}`);
  await boot();
  const back = await v(() => window.__ufo.graphics);
  assert(back === "high", `the start after that is back to the saved preset: ${back}`);
  await freshBoot("clear");
});

// ---------- Summary ----------
const failed = results.filter(([, ok]) => !ok);
console.log(`\n${results.length - failed.length} passed, ${failed.length} failed${errors.length ? `; console errors: ${errors.length}` : ""}.`);
if (errors.length) console.log(errors.slice(0, 5).join("\n"));
await browser.close();
server.close();
process.exit(failed.length || errors.length ? 1 : 0);
