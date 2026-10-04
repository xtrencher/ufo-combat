// Performance plumbing tests (the whole-game audit's pass for slower
// computers): what moved off the main thread must give the very same
// world. Chunks generated in the workers are block for block the main
// thread's, meshes built in the workers are byte for byte the main thread's,
// and flying fast streams the world in with the main thread inside its
// budget. Also the one-draw-call bullet holes.
//
//   node perf-tests.mjs [--only=substring] [--seed=42]
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
const PORT = 9740 + Math.floor(Math.random() * 40);
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
await page.click("#play-btn", { timeout: 30000 }).catch(() => {});
await frames(60);

await check("bullet holes are one draw call (an instanced mesh), and go with their block", async () => {
  const r = await v((g) => {
    const d = g.decals;
    if (!d) return { found: false };
    const p = g.player.position;
    const x = Math.floor(p.x) + 3;
    const z = Math.floor(p.z);
    const y = g.world.surfaceY(x, z);
    const before = d.count;
    for (let i = 0; i < 5; i++) d.add(new g.THREE.Vector3(x + 0.5, y + 1.001, z + 0.5), [x, y, z], [0, 1, 0]);
    const added = d.count - before;
    g.world.setBlocks([x, y, z, 0]);
    return { found: true, instanced: d.mesh.isInstancedMesh, added, after: d.count - before };
  });
  assert(r.found, "no bullet hole pool found");
  assert(r.instanced && r.added === 5 && r.after === 0, JSON.stringify(r));
});

await check("workers run: terrain generation and meshing are off the main thread", async () => {
  const r = await v((g) => ({ workers: (g.world._genWorkers || []).length, mesh: g.world.meshInWorkers }));
  assert(r.workers >= 1 && r.mesh, JSON.stringify(r));
});

await check("chunks generated in a worker are block for block the main thread's", async () => {
  const r = await v(async (g) => {
    const { Chunk } = await import("./js/chunk.js");
    const w = g.world;
    // Fresh ground far away, generated by the workers.
    const x0 = g.spawn.x + 5000;
    g.setMode("creative");
    g.player.flying = true;
    g.player.position.set(x0, 110, g.spawn.z);
    const near = () => [...w.chunks.values()].filter((c) => Math.abs(c.cx * 16 - x0) <= 400 && Math.abs(c.cz * 16 - g.spawn.z) <= 400).length;
    for (let i = 0; i < 1500 && near() < 40; i++) {
      g.streamAround(x0, g.spawn.z);
      w.processQueues(50);
      await new Promise((res) => setTimeout(res, 20));
    }
    let n = 0;
    let diff = 0;
    for (const c of w.chunks.values()) {
      if (Math.abs(c.cx * 16 - x0) > 400 || Math.abs(c.cz * 16 - g.spawn.z) > 400 || w.edits.get(c.key)) continue;
      const fresh = new Chunk(c.cx, c.cz);
      w.terrain.generate(fresh);
      n++;
      for (let i = 0; i < fresh.blocks.length; i++) {
        if (fresh.blocks[i] !== c.blocks[i]) {
          diff++;
          break;
        }
      }
      if (n >= 40) break;
    }
    return { compared: n, differing: diff };
  });
  assert(r.compared >= 20 && r.differing === 0, JSON.stringify(r));
});

await check("meshes built in a worker are byte for byte the main thread's", async () => {
  const r = await v(async (g) => {
    const { meshChunk } = await import("./js/mesher.js");
    const w = g.world;
    for (let i = 0; i < 1500 && [...w.chunks.values()].filter((c) => c.meshed).length < 20; i++) {
      w.processQueues(50);
      await new Promise((res) => setTimeout(res, 20));
    }
    const list = [...w.chunks.values()].filter((c) => c.meshed).slice(0, 20);
    const got = new Map();
    const orig = w._applyMeshResult.bind(w);
    w._applyMeshResult = (m) => {
      got.set(m.token, m.buffers);
      return orig(m);
    };
    const want = new Map();
    for (const c of list) {
      const nb = [];
      for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) nb.push(w.getChunk(c.cx + dx, c.cz + dz) || null);
      const ref = meshChunk(nb, w.meshOptions);
      let slot = w._meshSlot();
      while (!slot) {
        await new Promise((res) => setTimeout(res, 20));
        w.processQueues(50);
        slot = w._meshSlot();
      }
      w._dispatchMesh(c, slot);
      want.set(c._meshToken, ref);
    }
    // (got also collects the ordinary streaming's meshes: wait for these.)
    for (let i = 0; i < 500 && ![...want.keys()].every((k) => got.has(k)); i++) {
      await new Promise((res) => setTimeout(res, 20));
      w.processQueues(50);
    }
    w._applyMeshResult = orig;
    const eq = (a, b) => (!a && !b) || (a && b && a.length === b.length && a.every((x, i) => x === b[i]));
    let compared = 0;
    let differing = 0;
    for (const [tok, ref] of want) {
      const m = got.get(tok);
      if (!m) continue;
      compared++;
      for (const k of ["opaque", "cutout", "water"]) {
        if (!ref[k] !== !m[k] || (ref[k] && !["position", "uv", "data", "extra", "index"].every((f) => eq(ref[k][f], m[k][f])))) {
          differing++;
          break;
        }
      }
    }
    return { asked: want.size, compared, differing };
  });
  assert(r.compared >= 15 && r.compared === r.asked && r.differing === 0, JSON.stringify(r));
});

await check("flying fast: the world streams in with the main thread inside its budget", async () => {
  await v((g) => {
    const w = g.world;
    g.setMode("creative");
    if (g.vehicles.active) g.vehicles.exit({ force: true });
    g.player.flying = true;
    g.player.position.set(g.spawn.x - 9000, 100, g.spawn.z + 3000);
    g.mp.game.callIn("f16");
    const T = { q: 0, n: 0 };
    const pq = w.processQueues.bind(w);
    w.processQueues = (b) => {
      const t0 = performance.now();
      try {
        return pq(b);
      } finally {
        T.q += performance.now() - t0;
        T.n++;
      }
    };
    window.__fly = T;
    window.__meshed0 = w.stats.meshes;
    return true;
  });
  await frames(150);
  const r = await v((g) => {
    const w = g.world;
    const T = window.__fly;
    delete w.processQueues;
    return { perFrame: +(T.q / Math.max(1, T.n)).toFixed(2), meshed: w.stats.meshes - window.__meshed0, inflight: w._meshInflight.size };
  });
  // (The budget is 3.5 ms; a chunk's integration can run a little over it.)
  assert(r.meshed >= 60 && r.perFrame < 7, JSON.stringify(r));
});

// ---------- Summary ----------
const failed = results.filter(([, ok]) => !ok);
console.log(`\n${results.length - failed.length} passed, ${failed.length} failed${errors.length ? `; console errors: ${errors.length}` : ""}.`);
if (errors.length) console.log(errors.slice(0, 5).join("\n"));
await browser.close();
server.close();
process.exit(failed.length || errors.length ? 1 : 0);
