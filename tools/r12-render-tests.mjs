// Round 12 render tests: fire and lava animated, no sky light in caves, the
// texture pages past 256 layers.
// In Node (fast): the texture capacity (pages of 256 layers, room for 1024)
// holds the named tiles and the flipbook frames; the mesher marks fire's
// faces as a flipbook and lava's as flowing, with the flow direction
// (still in a pool, downhill on a flow, none on other blocks).
// In the browser (the real game, High preset): the atlas comes in pages
// with fire's frames after the named tiles; a layer on the second page is
// drawn (not the first page's); fire's flames and lava move with time; a
// closed cave room is as dark by day as by night (no sun, moon or sky haze
// on its rock), and a torch lights it.
//
//   node r12-render-tests.mjs [--only=substring] [--node]
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
const { BLOCK, TILE, TILE_NAMES } = await imp("js/blocks.js");
const BASE = await imp("js/content/base.js");
const ID = await imp("js/content/ids.js");
const N = await imp("js/content/nature.js");
const { meshChunk, FLAG } = await imp("js/mesher.js");
const { CHUNK_SIZE, WORLD_HEIGHT } = await imp("js/constants.js");

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

await check("texture capacity: pages of 256 layers, room for 1024, the named tiles and the flipbooks' frames fit", async () => {
  assert(BASE.TILE_PAGE === 256, `page ${BASE.TILE_PAGE}`);
  assert(BASE.TILE_CAPACITY >= 512 && BASE.TILE_CAPACITY === BASE.TILE_PAGE * BASE.TILE_MAX_PAGES, `capacity ${BASE.TILE_CAPACITY}`);
  const fire = BASE.TILE_FLIPBOOKS.find((f) => f.tile === "fire");
  assert(fire && fire.frames === 32 && fire.fps === 20, "fire: vanilla's 32 frames at 20 a second");
  assert(BASE.FLIPBOOK_LAYERS === BASE.TILE_FLIPBOOKS.reduce((n, f) => n + f.frames, 0), "flipbook layers");
  const layers = TILE_NAMES.length + BASE.FLIPBOOK_LAYERS;
  assert(layers <= BASE.TILE_CAPACITY, `${layers} layers`);
  assert(BASE.TILE_FLOWING.includes("lava") && TILE.lava !== undefined, "lava flows");
  for (const f of BASE.TILE_FLIPBOOKS) assert(TILE[f.tile] !== undefined, `flipbook tile ${f.tile}`);
  console.log(`        ${TILE_NAMES.length} named tiles + ${BASE.FLIPBOOK_LAYERS} frames = ${layers} layers, ${Math.ceil(layers / 256)} pages of ${BASE.TILE_CAPACITY / 256}`);
});

// One chunk (others missing: open sky), blocks set by (x, y, z), lit flat.
function meshOne(cells) {
  const S = CHUNK_SIZE;
  const blocks = new Uint16Array(S * WORLD_HEIGHT * S);
  const light = new Uint8Array(S * WORLD_HEIGHT * S).fill(0xf0);
  const idx = (x, y, z) => (y * S + z) * S + x;
  for (let x = 0; x < S; x++) for (let z = 0; z < S; z++) for (let y = 0; y < 10; y++) blocks[idx(x, y, z)] = BLOCK.STONE;
  for (const [x, y, z, id] of cells) blocks[idx(x, y, z)] = id;
  const nb = new Array(9).fill(null);
  nb[4] = { cx: 0, cz: 0, blocks, light };
  return meshChunk(nb, {});
}
function vertices(buf) {
  const out = [];
  for (let v = 0; v < buf.vertexCount; v++) {
    out.push({
      x: buf.position[v * 3],
      y: buf.position[v * 3 + 1],
      z: buf.position[v * 3 + 2],
      face: buf.data[v * 4] >> 2,
      flags: buf.data[v * 4 + 3],
      layer: buf.extra[v * 4] + buf.extra[v * 4 + 3] * 256,
      byte: buf.extra[v * 4 + 1],
    });
  }
  return out;
}

await check("mesher: fire's faces are its flipbook, lava's are flowing (still in a pool, downhill on a flow), stone's neither", async () => {
  const cells = [[2, 10, 2, ID.FIRE]];
  // A pool of sources at y 9 (x 4-7, z 4-7), a flow east from it (x 8-10, z 5).
  for (let x = 4; x <= 7; x++) for (let z = 4; z <= 7; z++) cells.push([x, 9, z, ID.LAVA]);
  for (let l = 1; l <= 3; l++) cells.push([7 + l, 9, 5, N.lavaFlowId(l)]);
  const m = meshOne(cells);
  const cut = vertices(m.cutout).filter((v) => v.layer === TILE.fire);
  assert(cut.length >= 24, `fire vertices ${cut.length}`);
  for (const v of cut) assert(v.flags & FLAG.ANIM && v.byte === BASE.TILE_FLIPBOOKS.findIndex((f) => f.tile === "fire"), `a fire vertex: flags ${v.flags}, flipbook ${v.byte}`);
  const op = vertices(m.opaque);
  const lava = op.filter((v) => v.layer === TILE.lava);
  assert(lava.length > 0, "lava vertices");
  for (const v of lava) assert(v.flags & FLAG.FLOW && !(v.flags & FLAG.ANIM), `a lava vertex's flags ${v.flags}`);
  // The top of the pool's middle cell (5, 5): still (0); the flow's tops
  // (cells 8, 9 at z 5): east, direction 0 (code 1). (A quad is 4 vertices in a row.)
  const topOf = (cx, cz) => {
    const all = vertices(m.opaque);
    const codes = [];
    for (let q = 0; q + 3 < all.length; q += 4) {
      const vs = all.slice(q, q + 4);
      if (vs[0].layer !== TILE.lava || vs[0].face !== 2) continue;
      const x = (vs[0].x + vs[2].x) / 2;
      const z = (vs[0].z + vs[2].z) / 2;
      if (Math.floor(x) === cx && Math.floor(z) === cz) codes.push(...vs.map((v) => v.byte));
    }
    return codes;
  };
  const mid = topOf(5, 5);
  assert(mid.length === 4 && mid.every((c) => c === 0), `the pool's middle: ${JSON.stringify(mid)}`);
  for (const x of [8, 9]) {
    const q = topOf(x, 5);
    assert(q.length === 4 && q.every((c) => c === 1), `the flow at x ${x}: ${JSON.stringify(q)}`);
  }
  const stone = op.filter((v) => v.layer === TILE.stone);
  assert(stone.length > 0 && stone.every((v) => !(v.flags & (FLAG.ANIM | FLAG.FLOW))), "stone is not animated");
});

// ---------- Browser ----------

const MIME = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json" };
async function browserChecks() {
  const { chromium } = await import("playwright-core");
  const PORT = 9300 + Math.floor(Math.random() * 300);
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
    args: ["--use-gl=swiftshader", "--enable-webgl", "--ignore-gpu-blocklist", "--no-sandbox", "--disable-dev-shm-usage"],
  });
  const localThreeRoot = path.join(__dirname, "node_modules", "three");
  const page = await browser.newPage({ viewport: { width: 640, height: 360 } });
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
  const out = process.env.SHOTS || "";
  const shot = async (name) => out && (await page.screenshot({ path: path.join(out, `r12-render-${name}.png`) }));
  const browserCheck = async (name, fn) => {
    const before = errors.length;
    await check(name, async () => {
      await fn();
      if (errors.length > before) throw new Error(`console errors: ${errors.slice(before, before + 3).join(" | ")}`);
    });
  };

  await page.goto(`http://127.0.0.1:${PORT}/index.html?seed=4711&type=survival&graphics=low`, { waitUntil: "load", timeout: 60000 });
  await page.waitForFunction(() => !!window.__ufo && window.__ufo.graphicsReady, null, { timeout: 120000 });
  for (let i = 0; i < 60 && (await v((g) => g.gameState)) !== "playing"; i++) {
    await page.click("#play-btn", { timeout: 5000 }).catch(() => {});
    await frames(3);
  }
  await v((g) => g.setGraphics("high"));
  await page.waitForFunction(() => window.__ufo.graphicsReady, null, { timeout: 120000 });

  // A closed stone room 16 below the surface (no sky light in it), with the
  // things to look at; the camera in it, looking along it.
  const room = await v(async (g) => {
    const { world, player, spawn } = g;
    g.setMode("creative");
    const ID = await import("/js/content/ids.js");
    const x0 = spawn.x + 40;
    const z0 = spawn.z + 40;
    world.prepareArea(x0, z0, 2);
    const y = Math.max(8, world.surfaceY(x0, z0) - 16);
    const e = [];
    for (let dx = -8; dx <= 8; dx++) for (let dz = -8; dz <= 8; dz++) for (let dy = -3; dy <= 7; dy++) e.push(x0 + dx, y + dy, z0 + dz, 3);
    for (let dx = -6; dx <= 6; dx++) for (let dz = -6; dz <= 6; dz++) for (let dy = 0; dy <= 4; dy++) e.push(x0 + dx, y + dy, z0 + dz, 0);
    for (let dy = 0; dy <= 4; dy++) e.push(x0 - 2, y + dy, z0 - 3, 3, x0 + 2, y + dy, z0 - 3, 3);
    world.setBlocks(e);
    player.flying = true;
    player.velocity.set(0, 0, 0);
    player.position.set(x0 + 0.5, y + 1.2, z0 + 4.5);
    player.yaw = 0;
    player.pitch = 0.1;
    g.mobs.clear();
    g.sky.locked = true;
    g.uniforms.uEyeSky.value = 0; // (main.js eases it to the eye's sky light: 0 in here)
    return { x0, z0, y, sky: world.lightAt(x0 + 0.5, y + 1.5, z0 + 4.5).sky };
  });

  await browserCheck("the atlas in pages: the named tiles, then fire's frames; all of them sampled by the terrain", async () => {
    const r = await v(async (g) => {
      const B = await import("/js/blocks.js");
      const T = await import("/js/textures.js");
      const a = g.world.atlas.userData;
      return {
        pages: a.pages.map((p) => p.image.depth),
        relief: g.world.relief.userData.pages.length,
        flip: a.flipbooks,
        tiles: B.TILE_NAMES.length,
        layers: T.TILE_LAYERS,
        defines: g.world.materials.opaque.defines.ATLAS_PAGES,
        uniform: !!g.world.materials.opaque.uniforms.uAtlas1 && g.world.materials.opaque.uniforms.uAtlas1.value === a.pages[1],
      };
    });
    assert(r.pages.reduce((n, d) => n + d, 0) === r.layers && r.pages.every((d) => d <= 256) && r.pages.length === Math.ceil(r.layers / 256), `pages ${JSON.stringify(r.pages)}`);
    assert(r.relief === r.pages.length, "relief pages");
    assert(r.flip[0].tile === "fire" && r.flip[0].layer === r.tiles && r.flip[0].frames === 32, `flipbooks ${JSON.stringify(r.flip)}`);
    assert(r.defines === r.pages.length && (r.pages.length < 2 || r.uniform), `the opaque material: ATLAS_PAGES ${r.defines}, second page bound ${r.uniform}`);
  });

  await browserCheck("a layer on the second page is drawn from it (a block given a fire frame's layer past 256)", async () => {
    // The debug block (magenta and black squares) in front of the camera, lit
    // by a torch; then its faces pointed at layer TILE_NAMES.length + 3 (on the
    // second page: a fire frame, orange on black).
    // (a column down the block's face: the frame's flame is in its lower half)
    const sample = async () => {
      await frames(4);
      return v((g) => g.samplePixels([0.5, 0.56, 0.62, 0.68, 0.74].map((y) => [0.5, y])));
    };
    await v((g, a) => g.world.setBlocks([a.x0, a.y + 2, a.z0 + 2, 4095, a.x0 + 1, a.y, a.z0 + 3, 17]), room);
    const before = await sample();
    await shot("page1");
    const layer = await v(async (g, a) => {
      const B = await import("/js/blocks.js");
      const l = B.TILE_NAMES.length + 3;
      for (let f = 0; f < 6; f++) B.FACE_TILES[4095 * 6 + f] = l;
      g.world.setBlocks([a.x0, a.y + 2, a.z0 + 2, 0]);
      g.world.setBlocks([a.x0, a.y + 2, a.z0 + 2, 4095]);
      return l;
    }, room);
    const after = await sample();
    await shot("page2");
    await v(async (g, a) => {
      const B = await import("/js/blocks.js");
      for (let f = 0; f < 6; f++) B.FACE_TILES[4095 * 6 + f] = B.TILE.debug;
      g.world.setBlocks([a.x0, a.y + 2, a.z0 + 2, 0, a.x0 + 1, a.y, a.z0 + 3, 0]);
    }, room);
    console.log(`        debug tile ${JSON.stringify(before)}, layer ${layer} ${JSON.stringify(after)}`);
    assert(layer >= 256, "the layer is on the second page");
    // Magenta (red and blue, no green) on the first page; on the second, a
    // flame (red over green over blue) and no magenta.
    const magenta = (c) => c[0] > 40 && c[2] > 25 && c[1] < c[2] * 0.5;
    const flame = (c) => c[0] > 60 && c[0] >= c[1] && c[1] > c[2] && c[2] < c[0] * 0.5;
    assert(before.some(magenta) && !before.some(flame), `the debug tile ${JSON.stringify(before)}`);
    assert(after.some(flame) && !after.some(magenta), `the second page's flame ${JSON.stringify(after)}`);
  });

  await browserCheck("fire's flames and lava move with time (no remeshing)", async () => {
    await v(async (g, a) => {
      const ID = await import("/js/content/ids.js");
      const e = [];
      for (let dx = -1; dx <= 1; dx++) e.push(a.x0 + dx, a.y, a.z0 - 4, ID.FIRE);
      for (let dx = -3; dx <= 3; dx++) for (let dz = -2; dz <= 0; dz++) e.push(a.x0 + dx, a.y - 1, a.z0 + dz, ID.LAVA);
      g.world.setBlocks(e);
      g.player.pitch = -0.3;
    }, room);
    try {
      await frames(6);
      // (where the fire's middle and three spots on the pool are on the screen)
      const pts = await v((g, a) => {
        g.renderer.render(g.scene, g.camera); // (the camera's matrices up to date)
        return [[0, 0.4, -4], [-0.7, 0.4, -4], [0.7, 0.4, -4], [-2, -0.1, -1], [0, -0.1, -1.5], [2, -0.1, -0.5]].map(([dx, dy, dz]) => {
          const p = new g.THREE.Vector3(a.x0 + 0.5 + dx, a.y + dy, a.z0 + 0.5 + dz).project(g.camera);
          return [(p.x + 1) / 2, (1 - p.y) / 2];
        });
      }, room);
      // (all in one go: no frame runs between, so nothing is remeshed; only the clock moves)
      const [a, b, c] = await v((g, p) => {
        const a = g.samplePixels(p);
        g.uniforms.uTime.value += 0.73; // (fire: a frame every 0.05 s)
        const b = g.samplePixels(p);
        g.uniforms.uTime.value += 1.5; // (still lava churns slowly)
        return [a, b, g.samplePixels(p)];
      }, pts);
      await shot("anim-b");
      const diff = (x, y, i) => Math.abs(x[i][0] - y[i][0]) + Math.abs(x[i][1] - y[i][1]) + Math.abs(x[i][2] - y[i][2]);
      console.log(`        fire ${[0, 1, 2].map((i) => diff(a, b, i))}, lava ${[3, 4, 5].map((i) => diff(a, c, i))}`);
      assert([0, 1, 2].some((i) => diff(a, b, i) > 20), "the fire didn't change");
      assert([3, 4, 5].some((i) => diff(a, c, i) > 12), "the lava didn't change");
    } finally {
      await v((g, a) => {
        const e = [];
        for (let dx = -1; dx <= 1; dx++) e.push(a.x0 + dx, a.y, a.z0 - 4, 0);
        for (let dx = -3; dx <= 3; dx++) for (let dz = -2; dz <= 0; dz++) e.push(a.x0 + dx, a.y - 1, a.z0 + dz, 3);
        g.world.setBlocks(e);
        g.player.pitch = 0.1;
      }, room);
    }
  });

  await browserCheck("a closed cave room is as dark by day as by night (no sun, moon or sky haze on its rock); a torch lights it", async () => {
    assert(room.sky === 0, `sky light in the room ${room.sky}`);
    const stats = async (h) => {
      await v((g, hh) => g.sky.setHours(hh), h);
      await frames(6);
      return v((g) => g.captureStats());
    };
    const day = await stats(12);
    await shot("cave-day");
    const night = await stats(0);
    await shot("cave-night");
    await v((g, a) => g.world.setBlocks([a.x0 + 3, a.y, a.z0 - 1, 17]), room);
    const torch = await stats(12);
    await shot("cave-torch");
    await v((g, a) => g.world.setBlocks([a.x0 + 3, a.y, a.z0 - 1, 0]), room);
    console.log(`        mean luminance: day ${day.mean.toFixed(4)}, night ${night.mean.toFixed(4)}, a torch ${torch.mean.toFixed(4)}`);
    assert(day.mean < 0.03, `the room by day: ${day.mean}`);
    assert(Math.abs(day.mean - night.mean) < 0.006, `day ${day.mean} vs night ${night.mean}`);
    assert(torch.mean > day.mean + 0.02, `a torch: ${torch.mean}`);
  });

  await browser.close();
  server.close();
}
if (!args.node) await browserChecks();

// ---------- Summary ----------
const failed = results.filter(([, ok]) => !ok);
console.log(`\n${results.length - failed.length} passed, ${failed.length} failed.`);
process.exit(failed.length ? 1 : 0);
