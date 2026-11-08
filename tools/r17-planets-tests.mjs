// Round 17 planets tests (track 17.C): the long view on the Moon and Mars
// (far terrain tiles of their own, js/lod.js + js/lod-mesher.js; the fog far
// out; the far tiles bending down as on a globe), the far view from high up
// (graphics.js FAR_VIEW), and the new landable planets Mercury and Venus
// (js/dim-mercury.js, js/dim-venus.js) reached through the solar system.
// In Node (fast): the registry (codes, prefixes, keys), the generators (the
// same chunk twice, heights in range, their blocks), the far tiles built
// from each planet's own generator, the solar system's data.
// In the browser (a Survival world in Creative):
//   - the Moon and Mars: far tiles of the planet (not the Overworld's), the
//     view and the fog kilometres out from a UFO high up, the land drawn
//     there (pixels), the tiles bending away;
//   - the Overworld from a big UFO high up: the far view;
//   - landing on Mercury and on Venus from space (down past the entry
//     altitude: the world goes there, the UFO high over it), down to the
//     ground (its own blocks, its gravity), and up again into space;
//   - the screen not black at High on each planet;
//   - a save made on Venus comes back there (its edits too);
//   - no console errors anywhere.
//
//   node r17-planets-tests.mjs [--only=substring] [--node]
// (GAME_ROOT=dir runs another copy of the game; SHOTS=dir saves screenshots.)
import http from "node:http";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { pngStats, decodePng } from "./png-stats.mjs";

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
  if (args.only && !name.startsWith("boot:") && !name.toLowerCase().includes(String(args.only).toLowerCase())) return;
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

await check("registry: Mercury and Venus are dimensions (codes, prefixes, keys), every planet has far tiles and a long view", async () => {
  const R = await imp("js/dim-registry.js");
  assert(R.DIM_IDS.includes("mercury") && R.DIM_IDS.includes("venus"), "in DIM_IDS");
  const codes = new Set();
  for (const d of Object.values(R.DIMS)) {
    assert(!codes.has(d.code), `code ${d.code} twice`);
    codes.add(d.code);
    assert(R.dimOfCode(d.code) === d.id && R.codeOf(d.id) === d.code, `code round trip ${d.id}`);
  }
  assert(R.DIMS.mercury.gravity === 0.38 && R.DIMS.venus.gravity === 0.9, "gravity");
  assert(R.DIMS.mercury.airless && !R.DIMS.venus.airless && R.DIMS.venus.haze > 0 && R.DIMS.mercury.haze === 0, "air and haze");
  for (const dim of ["moon", "mars", "mercury", "venus"]) {
    const d = R.DIMS[dim];
    assert(d.lod === true && d.viewScale >= 1 && d.minView >= 16 && d.curve > 10000 && d.maxView === undefined, `${dim}: far tiles and view ${JSON.stringify({ lod: d.lod, s: d.viewScale, m: d.minView })}`);
  }
  for (const [dim, p] of [["mercury", "h"], ["venus", "v"]]) {
    const k = R.dimKey(dim, 1, 2, -3);
    assert(k === `${p}:1,2,-3`, `key ${k}`);
    const back = R.parseDimKey(k);
    assert(back && back[3] === dim && back[2] === -3, `parsed ${JSON.stringify(back)}`);
  }
});

await check("generators: Mercury and Venus chunks (the same twice, their own blocks), heights in range, the far columns match the ground", async () => {
  const R = await imp("js/dim-registry.js");
  const S = await imp("js/content/space.js");
  const C = await imp("js/constants.js");
  const N = C.CHUNK_SIZE * C.CHUNK_SIZE * C.WORLD_HEIGHT;
  const ground = { mercury: S.MERCURY_GROUND, venus: S.VENUS_GROUND, moon: S.MOON_GROUND, mars: S.MARS_GROUND };
  for (const dim of ["mercury", "venus", "moon", "mars"]) {
    const g1 = R.createGenerator(dim, 1717);
    const g2 = R.createGenerator(dim, 1717);
    let same = true;
    let own = 0;
    let tops = 0;
    for (const [cx, cz] of [[0, 0], [7, -3], [-20, 11], [40, 40]]) {
      const a = { cx, cz, blocks: new Uint16Array(N) };
      const b = { cx, cz, blocks: new Uint16Array(N) };
      g1.generate(a);
      g2.generate(b);
      for (let i = 0; i < N; i++) if (a.blocks[i] !== b.blocks[i]) same = false;
      for (let z = 0; z < 16; z += 5) {
        for (let x = 0; x < 16; x += 5) {
          const h = g1.heightAt(cx * 16 + x, cz * 16 + z);
          const id = a.blocks[(h << 8) | (z << 4) | x];
          tops++;
          if (ground[dim].has(id) || id >= 3072) own++;
          const out = {};
          g1.lodColumn(cx * 16 + x, cz * 16 + z, out);
          assert(Math.abs(out.top - (h + 1)) <= 8 && Number.isInteger(out.id), `${dim} far column ${JSON.stringify(out)} vs ${h}`);
        }
      }
    }
    assert(same, `${dim}: the same chunk twice`);
    assert(own / tops > 0.8, `${dim}: its own ground on top (${own}/${tops})`);
    let lo = 1e9;
    let hi = -1e9;
    for (let x = -3000; x <= 3000; x += 53) for (let z = -3000; z <= 3000; z += 61) {
      const h = g1.heightAt(x, z);
      lo = Math.min(lo, h);
      hi = Math.max(hi, h);
    }
    assert(lo >= 6 && hi < C.WORLD_HEIGHT - 4 && hi - lo > 20, `${dim}: heights ${lo}..${hi}`);
  }
});

await check("far tiles: each planet's built from its own generator (not the Overworld's), no trees", async () => {
  const { LodTerrain, buildLodTile, makeLodPalette } = await imp("js/lod-mesher.js");
  const R = await imp("js/dim-registry.js");
  const pal = makeLodPalette({ top: new Float32Array(4096 * 3).fill(0.5), side: new Float32Array(4096 * 3).fill(0.4) });
  for (const dim of ["moon", "mars", "mercury", "venus"]) {
    const lt = new LodTerrain(1717, {}, dim);
    assert(lt.planet && lt.treeAt(5, 5) === null, `${dim}: a planet's terrain`);
    const g = R.createGenerator(dim, 1717);
    const s = {};
    lt.sample(123, -456, s);
    assert(s.top === g.heightAt(123, -456) + 1 || s.id === 1549, `${dim}: the sample is the generator's (${s.top} vs ${g.heightAt(123, -456) + 1})`);
    const m = buildLodTile(lt, 3, 2, -1, pal);
    assert(m.vertexCount > 500, `${dim}: a tile (${m.vertexCount} vertices)`);
  }
  const ow = new LodTerrain(1717, {});
  assert(!ow.planet, "the Overworld's as before");
});

await check("solar system: Mercury and Venus have ground (dimension, space line, entry), the other bodies as before", async () => {
  const S = await imp("js/solar-data.js");
  for (const id of ["mercury", "venus"]) {
    const B = S.BODIES[id];
    assert(B.dim === id && B.line > B.entry && B.entry > 1000 && !B.keepOut && S.BODY_OF_DIM[id] === id, `${id}: ${JSON.stringify({ dim: B.dim, line: B.line, entry: B.entry })}`);
    assert(Number.isFinite(S.spaceLineY(id)), `${id}: a space line`);
    // its gravity is the dimension's
    const R = await imp("js/dim-registry.js");
    const g = B.gm / (B.r * B.r) / S.G_EARTH;
    assert(Math.abs(g - R.DIMS[id].gravity) < 0.02, `${id}: gravity ${g}`);
  }
  assert(S.BODIES.jupiter.gas && !S.BODIES.jupiter.dim && S.BODIES.sun.star, "the gas giants and the Sun: no ground");
});

// ---------- In the browser ----------

if (!args.node) await browserChecks();

async function browserChecks() {
  const { chromium } = await import("playwright-core");
  const PORT = 9910 + Math.floor(Math.random() * 40);
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
  const localThreeRoot = path.join(__dirname, "node_modules", "three");
  const ctx = await browser.newContext({ viewport: { width: 960, height: 540 } });
  const page = await ctx.newPage();
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
  const run = (src, arg) => page.evaluate(([s, a]) => new Function("g", "a", `return (${s})(g, a);`)(window.__ufo, a), [src, arg]);
  const out = process.env.SHOTS || "";
  if (out) fs.mkdirSync(out, { recursive: true });
  const shot = async (name) => {
    const buf = await page.screenshot();
    if (out) fs.writeFileSync(path.join(out, `r17-${name}.png`), buf);
    return pngStats(buf);
  };
  async function play() {
    const t0 = Date.now();
    while (Date.now() - t0 < 300000) {
      const st = await v((g) => g.gameState);
      if (st === "playing") return;
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
  const STEP_UNTIL = `(g, test, n, each) => { for (let i = 0; i < n; i++) { if (each) each(g); g.vehicles.update(1 / 30); g.space.update(1 / 30); if (test(g)) return i; } return -1; }`;
  const LANDED = `async (g) => { for (let i = 0; i < 900 && g.space.busy; i++) await new Promise((r) => requestAnimationFrame(r)); return !g.space.busy; }`;
  const callIn = (kind) =>
    v(async (g, k) => {
      document.querySelector(`#pause-callins [data-callin="${k}"]`).click();
      for (let i = 0; i < 3; i++) await new Promise((r) => requestAnimationFrame(r));
      return g.vehicles.active?.type || null;
    }, kind);
  // To `dim` on foot (the dimensions' own travel), then a UFO called in and lifted to `alt` blocks, level, facing +x.
  const ufoOver = async (dim, alt) => {
    await v((g, d) => {
      g.vehicles.exit({ force: true });
      if (g.dims.dim !== d) g.dims.travel(d, 0.5, 100, 0.5, { place: "safe" });
      return true;
    }, dim);
    await page.waitForFunction(() => !window.__ufo.dims.pending, null, { timeout: 90000 });
    await frames(5);
    assert((await callIn("ufo")) === "ufo", "the UFO");
    return v((g, a) => {
      const u = g.vehicles.active;
      u.pos.y = a;
      u.vel.set(0, 0, 0);
      u.speedLevel = 0;
      u.camYaw = -Math.PI / 2;
      u.camPitch = -0.12;
      return { dim: g.dims.dim, y: u.pos.y };
    }, alt);
  };
  // Waits (real frames) for the far view to settle: the view distance reached and the tiles built.
  const settle = (maxFrames = 1500) =>
    v(async (g, n) => {
      let last = -1;
      let still = 0;
      for (let i = 0; i < n; i++) {
        await new Promise((r) => requestAnimationFrame(r));
        const rd = g.debugViewRD();
        if (rd === last && g.lod.busy === 0 && i > 30) still++;
        else still = 0;
        last = rd;
        if (still > 20) break;
      }
      return true;
    }, maxFrames);
  // What the far view is now: the view distance, the fog, the far plane, the tiles shown and how far out.
  const viewInfo = () =>
    v((g) => {
      const cam = g.camera.position;
      let far = 0;
      let shown = 0;
      for (const t of g.lod._shownTiles || []) {
        const span = 32 << t.level;
        const d = Math.hypot(t.x0 + span / 2 - cam.x, t.z0 + span / 2 - cam.z);
        far = Math.max(far, d);
        shown++;
      }
      const f = g.uniforms.uFog.value;
      return { dim: g.dims.dim, lodDim: g.lod.dim, rd: g.debugViewRD(), lodRD: g.lod.renderDistance, fogStart: Math.round(f.x), fogEnd: Math.round(f.y), haze: f.z, camFar: Math.round(g.camera.far), shown, far: Math.round(far), chunks: g.lod.stats.shownChunks, curve: g.lod.curve, y: Math.round(cam.y) };
    });
  // The share of the middle band of the view, aimed down at the ground `frac`
  // of the way to the fog's end, that isn't the black of the sky (the far
  // land drawn there, not faded out).
  const groundShare = async (frac = 0.75) => {
    await v(async (g, f) => {
      const u = g.vehicles.active;
      const agl = u.pos.y - g.vehicles.groundBelow(u.pos.x, u.pos.y, u.pos.z);
      u.camPitch = -Math.atan2(agl, f * g.uniforms.uFog.value.y);
      for (let i = 0; i < 12; i++) await new Promise((r) => requestAnimationFrame(r));
      return true;
    }, frac);
    const buf = await page.screenshot();
    if (out) fs.writeFileSync(path.join(out, `r17-aim-${await v((g) => g.dims.dim)}.png`), buf);
    const { w, h, bpp, data } = decodePng(buf);
    // (a patch just under the crosshair, right of the craft low in the middle of the screen)
    let lit = 0;
    let n = 0;
    for (let y = Math.floor(h * 0.5); y < Math.floor(h * 0.62); y += 2) {
      for (let i = Math.floor(w * 0.64); i < w * 0.82; i += 2) {
        const k = (y * w + i) * bpp;
        n++;
        if (data[k] + data[k + 1] + data[k + 2] > 30) lit++;
      }
    }
    return lit / n;
  };

  await browserCheck("boot: a Survival world in Creative, the far view setting, Mercury and Venus in the solar system", async () => {
    await page.goto(`http://127.0.0.1:${PORT}/index.html?seed=1717&type=survival&graphics=low`, { waitUntil: "load", timeout: 60000 });
    await page.waitForFunction(() => !!window.__ufo && window.__ufo.graphicsReady, null, { timeout: 120000 });
    await play();
    const r = await v(async (g) => {
      g.setMode("creative");
      g.sky.setHours(10);
      g.sky.locked = true;
      for (let i = 0; i < 20; i++) await new Promise((r) => requestAnimationFrame(r));
      const G = await import("./js/graphics.js");
      return {
        farView: G.farViewOf("extreme", "low").top > G.farViewOf("normal", "ultra").top && G.farViewOf("auto", "ultra") === G.FAR_VIEW.extreme && G.farViewOf("auto", "low") === G.FAR_VIEW.normal,
        setting: g.settings.perf.farView === "auto",
        lodDim: g.lod.dim,
        curveU: !!g.lod.material.uniforms.uCurve,
        dims: g.dims.enabled,
      };
    });
    assert(r.setting && r.lodDim === "overworld" && r.curveU && r.dims, `boot: ${JSON.stringify(r)}`);
  });

  await browserCheck("the Moon: far tiles of its own, the view and the fog kilometres out from a UFO 700 up, land drawn to the horizon", async () => {
    await v((g) => g.settingsPanel.set("perf.farView", "extreme")); // (a strong PC's far view)
    const o = await ufoOver("moon", 780);
    assert(o.dim === "moon", `on the Moon: ${JSON.stringify(o)}`);
    await settle();
    const i = await viewInfo();
    const s = await shot("moon-ufo");
    const share = await groundShare();
    console.log(`        (the Moon: ${JSON.stringify(i)}, land ${share.toFixed(2)})`);
    assert(i.lodDim === "moon" && i.curve > 10000, `the Moon's own far tiles: ${JSON.stringify(i)}`);
    assert(i.rd >= 90 && i.fogEnd > 1400 && i.camFar > i.fogEnd && i.fogStart >= i.fogEnd * 0.85, `a long, crisp view: ${JSON.stringify(i)}`);
    assert(i.shown > 8 && i.far > i.fogEnd * 0.6, `the far land drawn: ${JSON.stringify(i)}`);
    assert(share > 0.5 && s.colours > 8, `the land under the horizon (not black): ${share} ${JSON.stringify(s)}`);
  });

  await browserCheck("Mars: far tiles of its own, a long hazy view from a UFO 700 up", async () => {
    await v((g) => {
      g.vehicles.exit({ force: true });
      return true;
    });
    const o = await ufoOver("mars", 780);
    assert(o.dim === "mars", `on Mars: ${JSON.stringify(o)}`);
    await settle();
    const i = await viewInfo();
    await shot("mars-ufo");
    const share = await groundShare();
    console.log(`        (Mars: ${JSON.stringify(i)}, land ${share.toFixed(2)})`);
    assert(i.lodDim === "mars" && i.rd >= 75 && i.fogEnd > 1150 && i.haze > 0 && i.camFar > i.fogEnd, `Mars' view: ${JSON.stringify(i)}`);
    assert(i.shown > 8 && i.far > i.fogEnd * 0.6 && share > 0.5, `the far land drawn: ${JSON.stringify(i)} ${share}`);
  });

  await browserCheck("the Overworld from a big UFO 1,500 up: the far view reaches kilometres (Far and Extreme further)", async () => {
    await v((g) => {
      g.vehicles.exit({ force: true });
      g.dims.travel("overworld", 0.5, 90, 0.5, { place: "spawn" });
      return true;
    });
    await page.waitForFunction(() => !window.__ufo.dims.pending, null, { timeout: 90000 });
    await v((g) => g.settingsPanel.set("perf.farView", "auto"));
    const o = await ufoOver("overworld", 1500);
    assert(o.dim === "overworld", `home: ${JSON.stringify(o)}`);
    await settle(600);
    const normal = await viewInfo();
    await v((g) => {
      g.settingsPanel.set("perf.farView", "extreme");
      return true;
    });
    await settle(900);
    const extreme = await viewInfo();
    await shot("overworld-ufo-extreme");
    await v((g) => {
      g.settingsPanel.set("perf.farView", "auto");
      return true;
    });
    console.log(`        (the Overworld at 1,500: ${JSON.stringify(normal)} -> extreme ${JSON.stringify(extreme)})`);
    assert(normal.lodDim === "overworld" && normal.rd >= 18, `the view (Low, Auto): ${JSON.stringify(normal)}`);
    assert(extreme.rd > normal.rd * 1.8 && extreme.fogEnd > 900 && extreme.camFar > extreme.fogEnd, `Extreme reaches further: ${JSON.stringify(extreme)}`);
  });

  // Into space from the world the UFO is in, then into `body`'s sphere above its entry altitude, and down.
  const landOn = async (body) => {
    const r = await run(`async (g, a) => {
      const until = new Function("return " + a.STEP_UNTIL)();
      const u = g.vehicles.active;
      const line = a.line;
      u.pos.y = line - 30;
      u.speedLevel = 1;
      g.player.keys.add("Space");
      const out = {};
      out.up = until(g, (g) => g.space.busy, 600);
      g.player.keys.clear();
      const s = g.space.solar;
      out.from = s.craft?.ref;
      if (!s.craft) return out;
      // (there, as if flown: inside its sphere, a little above its entry altitude)
      const B = a.B;
      s.craft.ref = a.body;
      s.craft.r = [0, B.r + B.entry + 250, 0];
      s.craft.vel = [0, 0, 0];
      s.target = a.body;
      s.craft.speedLevel = 1;
      g.player.keys.add("ShiftLeft");
      out.down = until(g, (g) => !!s.pending || !s.active, 3000);
      g.player.keys.clear();
      out.caption = g.space.lastCaption;
      return out;
    }`, { STEP_UNTIL, body, line: await v((g, d) => 64 + ({ overworld: 6000, moon: 3000, mars: 4500, mercury: 3000, venus: 5000 })[d], await v((g) => g.dims.dim)), B: await v(async (g, b) => { const S = await import("./js/solar-data.js"); const B = S.BODIES[b]; return { r: B.r, entry: B.entry }; }, body) });
    assert(r.up >= 0 && r.down >= 0, `into space and down to ${body}: ${JSON.stringify(r)}`);
    assert(await run(LANDED), `the landing on ${body} never came`);
    return r;
  };
  // Down from high up to the ground with Shift; what is under the UFO.
  const downToGround = () =>
    run(`async (g, a) => {
      const until = new Function("return " + a.STEP_UNTIL)();
      const u = g.vehicles.active;
      const out = { dim: g.dims.dim, type: u?.type, y0: Math.round(u?.pos.y ?? 0) };
      if (!u) return out;
      g.player.keys.add("ShiftLeft");
      u.speedLevel = 1;
      out.steps = until(g, (g) => u.pos.y - u.bottom - g.vehicles.groundBelow(u.pos.x, u.pos.y, u.pos.z) < 3, 5000);
      g.player.keys.clear();
      const gy = Math.floor(g.vehicles.groundBelow(u.pos.x, u.pos.y, u.pos.z) - 0.5);
      out.block = g.world.getBlock(Math.floor(u.pos.x), gy, Math.floor(u.pos.z));
      out.gravity = g.world.dimInfo.gravity;
      out.space = g.space.busy;
      return out;
    }`, { STEP_UNTIL });
  // Up past the space line: into space over the planet the UFO is on.
  const upToSpace = async () =>
    run(`async (g, a) => {
      const until = new Function("return " + a.STEP_UNTIL)();
      const u = g.vehicles.active;
      u.pos.y = a.line - 40;
      u.speedLevel = 1;
      g.player.keys.add("Space");
      const n = until(g, (g) => g.space.busy, 900);
      g.player.keys.clear();
      return { n, ref: g.space.solar.craft?.ref, busy: g.space.busy };
    }`, { STEP_UNTIL, line: await v((g) => 64 + ({ overworld: 6000, moon: 3000, mars: 4500, mercury: 3000, venus: 5000 })[g.dims.dim]) });

  await browserCheck("landing on Mercury from space: the world goes there, the UFO high over it; down to its grey-brown ground (0.38 gravity); the far view; up into space again", async () => {
    const r = await landOn("mercury");
    const h = await v((g) => ({ dim: g.dims.dim, type: g.vehicles.active?.type, y: Math.round(g.vehicles.active?.pos.y ?? 0), lodDim: g.lod.dim }));
    assert(h.dim === "mercury" && h.type === "ufo" && h.y > 1200 && h.y < 3064 && h.lodDim === "mercury", `over Mercury: ${JSON.stringify(h)} ${JSON.stringify(r)}`);
    await v((g) => {
      const u = g.vehicles.active;
      u.pos.y = 700;
      u.camYaw = -Math.PI / 2 - 2.3;
      u.camPitch = -0.1;
      return true;
    });
    await settle();
    const i = await viewInfo();
    await shot("mercury-ufo");
    console.log(`        (Mercury: ${JSON.stringify(i)})`);
    assert(i.rd >= 40 && i.fogEnd > 600 && i.shown > 8, `Mercury's view: ${JSON.stringify(i)}`);
    const d = await downToGround();
    assert(d.steps >= 0 && !d.space && d.gravity === 0.38 && d.block >= 3093 && d.block <= 3101 || d.block === 3082, `on Mercury's ground: ${JSON.stringify(d)}`);
    await frames(10);
    await shot("mercury-ground");
    const up = await upToSpace();
    assert(up.n >= 0 && up.busy && up.ref === "mercury", `up from Mercury into space: ${JSON.stringify(up)}`);
  });

  await browserCheck("landing on Venus from space; down to its volcanic plains (0.9 gravity), the haze a tint (the far land still seen); up into space again", async () => {
    // (straight from Mercury's space to Venus: the craft is still in space)
    const r = await run(`async (g, a) => {
      const until = new Function("return " + a.STEP_UNTIL)();
      const s = g.space.solar;
      s.craft.ref = "venus";
      s.craft.r = [0, a.B.r + a.B.entry + 250, 0];
      s.craft.vel = [0, 0, 0];
      g.player.keys.add("ShiftLeft");
      const down = until(g, (g) => !!s.pending || !s.active, 3000);
      g.player.keys.clear();
      return { down };
    }`, { STEP_UNTIL, B: await v(async () => { const S = await import("./js/solar-data.js"); return { r: S.BODIES.venus.r, entry: S.BODIES.venus.entry }; }) });
    assert(r.down >= 0, `down to Venus: ${JSON.stringify(r)}`);
    assert(await run(LANDED), "the landing on Venus never came");
    const h = await v((g) => ({ dim: g.dims.dim, type: g.vehicles.active?.type, y: Math.round(g.vehicles.active?.pos.y ?? 0), lodDim: g.lod.dim }));
    assert(h.dim === "venus" && h.type === "ufo" && h.y > 2000 && h.y < 5064 && h.lodDim === "venus", `over Venus: ${JSON.stringify(h)}`);
    await v((g) => {
      const u = g.vehicles.active;
      u.pos.y = 600;
      u.camYaw = -Math.PI / 2 + 0.75;
      u.camPitch = -0.12;
      return true;
    });
    await settle();
    const i = await viewInfo();
    const share = await groundShare();
    await shot("venus-ufo");
    console.log(`        (Venus: ${JSON.stringify(i)}, land ${share.toFixed(2)})`);
    assert(i.rd >= 30 && i.fogEnd > 450 && i.haze > 0 && i.fogStart < i.fogEnd * 0.7 && i.shown > 6, `Venus' view: ${JSON.stringify(i)}`);
    const d = await downToGround();
    assert(d.steps >= 0 && !d.space && d.gravity === 0.9 && ((d.block >= 3097 && d.block <= 3101) || d.block === 1549), `on Venus' ground: ${JSON.stringify(d)}`);
    await frames(10);
    await shot("venus-ground");
  });

  await browserCheck("the screen at High on Venus and Mercury: not black (the canvas's pixels), and back to Low", async () => {
    await v((g) => g.setGraphics("high"));
    await page.waitForFunction(() => window.__ufo.graphicsReady, null, { timeout: 180000 });
    await v((g) => {
      const u = g.vehicles.active;
      u.pos.y = 400;
      u.camPitch = -0.15;
      return true;
    });
    await settle(600);
    const s = await shot("venus-high");
    assert(s.lit > 0.3 && s.mean > 20 && s.colours > 12, `Venus at High: ${JSON.stringify(s)}`);
    const up = await upToSpace();
    assert(up.n >= 0 && up.busy && up.ref === "venus", `up from Venus into space: ${JSON.stringify(up)}`);
    await frames(10);
    const sp = await shot("venus-space-high");
    assert(sp.mean > 3, `space at High: ${JSON.stringify(sp)}`);
    const r = await run(`async (g, a) => {
      const until = new Function("return " + a.STEP_UNTIL)();
      const s = g.space.solar;
      s.craft.ref = "mercury";
      s.craft.r = [0, a.B.r + a.B.entry + 250, 0];
      s.craft.vel = [0, 0, 0];
      g.player.keys.add("ShiftLeft");
      const down = until(g, (g) => !!s.pending || !s.active, 3000);
      g.player.keys.clear();
      return { down };
    }`, { STEP_UNTIL, B: await v(async () => { const S = await import("./js/solar-data.js"); return { r: S.BODIES.mercury.r, entry: S.BODIES.mercury.entry }; }) });
    assert(r.down >= 0 && (await run(LANDED)), `back down to Mercury: ${JSON.stringify(r)}`);
    await v((g) => {
      const u = g.vehicles.active;
      u.pos.y = 500;
      u.camYaw = -Math.PI / 2 - 2.3;
      u.camPitch = -0.08;
      return true;
    });
    await settle(600);
    const m = await shot("mercury-high");
    assert(m.lit > 0.2 && m.mean > 12 && m.colours > 12, `Mercury at High: ${JSON.stringify(m)}`);
    await v((g) => g.setGraphics("low"));
    await page.waitForFunction(() => window.__ufo.graphicsReady, null, { timeout: 180000 });
  });

  await browserCheck("saving on Venus: a block placed there and the place are kept; after a reload the world is on Venus again with the block", async () => {
    await v((g) => {
      g.vehicles.exit({ force: true });
      g.dims.travel("venus", 40.5, 100, 40.5, { place: "safe" });
      return true;
    });
    await page.waitForFunction(() => !window.__ufo.dims.pending, null, { timeout: 90000 });
    await frames(10);
    const placed = await v((g) => {
      const p = g.player.position;
      const x = Math.floor(p.x) + 2;
      const z = Math.floor(p.z);
      const y = g.world.surfaceY(x, z) + 1;
      g.world.setBlocks([x, y, z, 3101]);
      g.flushSave(true);
      return { x, y, z, dim: g.dims.dim, key: Object.keys(localStorage).some((k) => k.endsWith("_venus")) };
    });
    assert(placed.dim === "venus" && placed.key, `saved on Venus: ${JSON.stringify(placed)}`);
    await page.reload({ waitUntil: "load" });
    await page.waitForFunction(() => !!window.__ufo && window.__ufo.graphicsReady, null, { timeout: 120000 });
    await play();
    await frames(30);
    const back = await v((g, p) => ({ dim: g.dims.dim, lodDim: g.lod.dim, block: g.world.getBlock(p.x, p.y, p.z), near: Math.hypot(g.player.position.x - p.x, g.player.position.z - p.z) }), placed);
    assert(back.dim === "venus" && back.lodDim === "venus" && back.block === 3101 && back.near < 12, `back on Venus: ${JSON.stringify(back)}`);
  });

  if (errors.length) console.log(`  (console errors: ${errors.slice(0, 5).join(" | ")})`);
  await browser.close();
  server.close();
}

// ---------- Summary ----------
const failed = results.filter(([, ok]) => !ok);
console.log(`\n${results.length - failed.length} passed, ${failed.length} failed.`);
process.exit(failed.length ? 1 : 0);
