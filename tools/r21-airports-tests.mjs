// Round 21.C tests: the airports are bigger and fewer (js/sites.js
// AIRPORT_SIZES_BIG, worldtype.js GEN_BIG_AIRPORTS).
// In Node (the site generator):
//   - the gating: a new Missions world gets generator 3 (the big airports),
//     a world saved with 2 (or older) keeps its own; a Survival world has no
//     sites either way;
//   - fewer: the sites per area of the new generator against the old one's
//     (about a half to a third);
//   - bigger: each size's runway longer and wider, its pad 1.5 to 2.3 times
//     the old one's, more hangars, a taller tower, a second runway at the
//     international ones, floodlight masts;
//   - an older world's sites are where and as they were (a fingerprint of
//     the plans and of some chunks, taken from the Round 20 code);
//   - every seed's new Missions world has its home airport close to the
//     start, the "nearest airport" searches find one, and the B-2 mission
//     finds an enemy airport;
//   - the real chunks: both runways flat, marked and clear above, the pad
//     solid under every building, no cliff at the pad's edge;
//   - the parked aircraft (the real AirportManager on stand-in ground):
//     clear of both runways and of each other, fighters in the hangars.
// In the browser (the real game, a new Missions world): the generator and
// its home airport near the spawn; the airport's real blocks (both
// runways flat and clear), the parked jets off the runways, one boarded and
// the radar marking the airport; the call-in jet on a runway; the touchdown
// mission's marker and a landing on the second runway; an older world (its
// record says generator 2) keeps its old airports; no console errors.
//
//   node r21-airports-tests.mjs [--only=substring] [--node] [--verbose]
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

// The seed of the browser checks: its home airport is an international one
// (two runways).
const SEED = 842645;
const WT = await imp("js/worldtype.js");
const { TerrainGenerator } = await imp("js/terrain.js");
const { BLOCK, IS_SOLID } = await imp("js/blocks.js");
const { CHUNK_SIZE, WORLD_HEIGHT } = await imp("js/constants.js");
const NEW = { sites: true, vanilla: true, bigAirports: true };
const OLD = { sites: true, vanilla: true };

// (airports.js imports vehicle-jet.js, which imports three: the game's own copy, as the page does.)
let airportsMod = null;
async function airportsModule() {
  if (airportsMod) return airportsMod;
  const { register } = await import("node:module");
  register(
    "data:text/javascript," +
      encodeURIComponent(`export async function resolve(s, c, n) { if (s === "three") return n(${JSON.stringify(pathToFileURL(path.join(__dirname, "node_modules/three/build/three.module.js")).href)}, c); return n(s, c); }`),
    import.meta.url
  );
  airportsMod = await imp("js/airports.js");
  return airportsMod;
}

// ---------- Node ----------

await check("the gating: a new Missions world has the big airports, a saved one keeps its generator, a guest the host's", async () => {
  const g = WT.terrainGenOf;
  assert(WT.TERRAIN_GEN === WT.GEN_BIG_AIRPORTS && WT.GEN_BIG_AIRPORTS === 3, "generator 3 is a new world's");
  assert(g("missions", undefined) === 3, "a new Missions world");
  assert(g("missions", 2, { old: true }) === 2 && g("missions", undefined, { old: true }) === WT.GEN_LEGACY, "a saved world keeps its generator");
  assert(g("missions", 3, { old: true }) === 3, "a world saved with 3 keeps it");
  const opts = (type, gen) => {
    WT.setWorldType(type, { gen });
    return WT.terrainOptions();
  };
  assert(opts("missions", 3).bigAirports === true && opts("missions", undefined).bigAirports === true, "the big airports in a new Missions world");
  assert(!("bigAirports" in opts("missions", 2)) && !("bigAirports" in opts("missions", 1)), "none in an older one");
  assert(!opts("survival", 3).sites && !("bigAirports" in opts("survival", 3)), "a Survival world has no sites");
  // (A guest: the host's welcome's generator, an older host's 2.)
  assert(g("missions", 2, { old: true }) === 2, "an older host's");
  WT.setWorldType("missions");
  // The option reaches the sites (World and the workers copy it).
  assert(new TerrainGenerator(1, NEW).sites.big && !new TerrainGenerator(1, OLD).sites.big, "the generator's sites");
});

// Sites within R of the origin, per seed, with each generator.
const SEEDS = [12345, 777, 42, 9001];
const counts = {};
await check("fewer: about a half to a third as many sites per area", async () => {
  let o = 0;
  let n = 0;
  const rows = [];
  for (const seed of SEEDS) {
    const a = new TerrainGenerator(seed, OLD).sites.within(0, 0, 12000).length;
    const b = new TerrainGenerator(seed, NEW).sites.within(0, 0, 12000).length;
    o += a;
    n += b;
    rows.push(`${seed}: ${a} -> ${b}`);
  }
  counts.old = o;
  counts.new = n;
  const r = n / o;
  console.log(`        (sites within 12000 blocks of the origin, four seeds: ${o} -> ${n}, x${r.toFixed(2)}; ${rows.join(", ")})`);
  assert(r >= 0.3 && r <= 0.55, `the share: ${r.toFixed(2)}`);
});

await check("bigger: longer, wider runways, 1.5 to 2.3 times the pad, more hangars, a taller tower, two runways at the international ones, floodlights", async () => {
  const per = { old: {}, new: {} };
  for (const seed of [12345, 777, 42, 9001, 31337, 5]) {
    for (const [k, o] of [["old", OLD], ["new", NEW]]) {
      const S = new TerrainGenerator(seed, o).sites;
      for (const s of S.within(0, 0, 9000)) {
        const key = s.kind === "city" ? `city ${s.size}` : s.size;
        const r = s.rect;
        (per[k][key] ||= []).push({ area: (r.u1 - r.u0) * (r.v1 - r.v0), half: s.half, rw: s.rw, hangars: s.hangars.length, tower: s.tower.h, rw2: !!s.rw2, masts: s.masts?.length || 0, tanks: s.tanks.length });
      }
    }
  }
  const avg = (l, f) => l.reduce((x, y) => x + f(y), 0) / l.length;
  const lines = [];
  for (const key of Object.keys(per.new)) {
    const a = per.old[key];
    const b = per.new[key];
    if (!a || !b) continue;
    const ratio = avg(b, (x) => x.area) / avg(a, (x) => x.area);
    lines.push(`${key}: runway ${a[0].half * 2}x${a[0].rw * 2} -> ${b[0].half * 2}x${b[0].rw * 2}, pad x${ratio.toFixed(2)}, hangars ${a[0].hangars} -> ${b[0].hangars}`);
    assert(ratio >= 1.5 && ratio <= 2.3, `${key}: the pad x${ratio.toFixed(2)}`);
    assert(b.every((x) => x.half >= a[0].half * 1.3 && x.rw > a[0].rw), `${key}: the runway`);
    assert(b.every((x) => x.hangars > a[0].hangars && x.tower > a[0].tower && x.masts >= 1 && x.tanks >= a[0].tanks), `${key}: the buildings ${JSON.stringify(b[0])}`);
    assert(b.every((x) => x.rw2 === /international/.test(key)) && a.every((x) => !x.rw2), `${key}: the second runway`);
  }
  console.log(`        (${lines.join("; ")})`);
  assert(lines.length >= 4, `sizes compared: ${lines.length}`);
});

// A fingerprint of a generator's sites (their plans, parking, yards, home)
// and of a few chunks at them; the values below are the Round 20 code's.
const FP = (T) => {
  let h = 2166136261;
  const mix = (str) => {
    for (let i = 0; i < str.length; i++) h = Math.imul(h ^ str.charCodeAt(i), 16777619) >>> 0;
  };
  const S = T.sites;
  S._ensureHome();
  mix(S.home ? S.home.id : "none");
  const list = S.within(0, 0, 9000).sort((a, b) => (a.id < b.id ? -1 : 1));
  for (const s of list) {
    const slots = S.parkingSlots(s);
    mix(JSON.stringify([s.id, s.size, s.y, s.half, s.rw, s.rect, s.apron, s.hangars.map((x) => [x.u0, x.u1, x.v0, x.v1, x.h, !!x.jet]), s.tower, s.terminal, s.tanks, s.radar, s.bunkers, s.base ? [s.base.u0, s.base.u1, s.base.v0, s.base.v1, s.base.slots] : null, slots.fighters.map((f) => [f.key, f.x, f.z]), slots.bomber && [slots.bomber.x, slots.bomber.z], slots.hangars.map((f) => [f.key, f.x, f.z]), S.runwayEnds(s), S.yardSpots(s).map((y) => [y.key, y.x, y.z])]));
  }
  const chunks = [];
  for (const s of list.slice(0, 3)) {
    for (const [u, v] of [[0, 0], [s.half - 20, 0], [(s.apron.u0 + s.apron.u1) / 2, s.apron.v1 - 10], [0, s.rect.v1 + 20]]) {
      const [x, z] = S.toWorld(s, u, v);
      chunks.push([Math.floor(x) >> 4, Math.floor(z) >> 4]);
    }
  }
  for (const [cx, cz] of chunks) {
    const c = { cx, cz, blocks: new Uint16Array(CHUNK_SIZE * CHUNK_SIZE * WORLD_HEIGHT) };
    T.generate(c);
    for (const id of c.blocks) h = Math.imul(h ^ id, 16777619) >>> 0;
  }
  return `${list.length}:${h.toString(16)}`;
};

await check("an older world keeps its sites: the plans and the chunks of generator 2 (and the old terrain's) as they were", async () => {
  WT.setWorldType("missions", { gen: 2 });
  const o2 = WT.terrainOptions();
  WT.setWorldType("missions", { gen: 1 });
  const o1 = WT.terrainOptions();
  WT.setWorldType("missions");
  const a = FP(new TerrainGenerator(12345, o2));
  const b = FP(new TerrainGenerator(9181, o1));
  assert(a === "35:745a0520", `generator 2, seed 12345: ${a}`);
  assert(b === "26:6c26b643", `generator 1, seed 9181: ${b}`);
  const c = FP(new TerrainGenerator(12345, NEW));
  assert(c !== a, "the new generator's differ");
});

await check("every new Missions world: a home airport close to the start, the airport searches find one, the B-2 mission an enemy airport", async () => {
  const { AirportManager } = await airportsModule();
  const bad = [];
  let worst = 0;
  for (let i = 0; i < 24; i++) {
    const seed = (Math.imul(i + 7, 2654435761) >>> 0) % 1000000;
    const S = new TerrainGenerator(seed, NEW).sites;
    S._ensureHome();
    const h = S.home;
    const a = S.anchor;
    if (!h) {
      bad.push(`${seed}: no home airport`);
      continue;
    }
    const d = Math.hypot(h.x - a.x, h.z - a.z);
    worst = Math.max(worst, d);
    if (d > 1500) bad.push(`${seed}: home ${Math.round(d)} blocks off`);
    // airports.nearest() from the start, with the grown search radius (missions.js _airportTarget).
    const am = new AirportManager({ sites: S, vehicles: { vehicles: [] }, world: {}, player: { position: { x: a.x, y: 70, z: a.z } }, mobs: null });
    const n = am.nearest(am.far(3000));
    if (!n || n.site !== h) bad.push(`${seed}: nearest ${n?.site?.id}`);
    // (missions.js _pickBase: another airport 1200 blocks or more from the home one, within 6000.)
    const foe = S.within(h.x, h.z, 6000).filter((s) => s.kind === "airport" && s !== h && Math.hypot(s.x - h.x, s.z - h.z) >= 1200);
    if (!foe.length) bad.push(`${seed}: no enemy airport`);
    // The runway close by for a call-in from the apron (main.js callJet: 700 blocks).
    const [x, z] = S.toWorld(h, (h.apron.u0 + h.apron.u1) / 2, h.rw + 12);
    const world = { getChunk: () => ({}) };
    const am2 = new AirportManager({ sites: S, vehicles: { vehicles: [] }, world, player: { position: { x, y: 70, z } }, mobs: null });
    if (!am2.runwayNear(x, z, 700)) bad.push(`${seed}: no runway for a call-in`);
  }
  console.log(`        (the farthest home airport: ${Math.round(worst)} blocks from the start)`);
  assert(!bad.length, bad.join("; "));
  // Far from the start too: the grown search radius finds a site from anywhere.
  const S = new TerrainGenerator(SEEDS[1], NEW).sites;
  const am = new AirportManager({ sites: S, vehicles: { vehicles: [] }, world: {}, player: { position: { x: 0, y: 70, z: 0 } }, mobs: null });
  let miss = 0;
  for (let i = 0; i < 120; i++) {
    am.player.position = { x: Math.cos(i * 2.4) * 9000 * ((i % 7) / 7), y: 70, z: Math.sin(i * 2.4) * 9000 * ((i % 5) / 5) };
    if (!am.nearest(am.far(3500))) miss++;
  }
  assert(miss <= 6, `no airport within the search radius from ${miss} of 120 spots`);
});

// The block at (x, y, z) of a chunk generated on its own.
const chunkCache = new Map();
const blockOf = (T, x, y, z) => {
  const cx = Math.floor(x) >> 4;
  const cz = Math.floor(z) >> 4;
  const key = `${cx},${cz}`;
  let c = chunkCache.get(key);
  if (!c) {
    c = { cx, cz, blocks: new Uint16Array(CHUNK_SIZE * CHUNK_SIZE * WORLD_HEIGHT) };
    T.generate(c);
    chunkCache.set(key, c);
    if (chunkCache.size > 600) chunkCache.delete(chunkCache.keys().next().value);
  }
  const lx = Math.floor(x) - cx * 16;
  const lz = Math.floor(z) - cz * 16;
  return c.blocks[(y * CHUNK_SIZE + lz) * CHUNK_SIZE + lx];
};

await check("the real chunks: both runways flat, marked and clear above; the pad solid under the buildings; no cliff at the pad's edge", async () => {
  const T = new TerrainGenerator(SEED, NEW);
  const S = T.sites;
  S._ensureHome();
  const list = [S.home, ...S.within(S.home.x, S.home.z, 7000).filter((s) => s !== S.home)];
  const pick = [list.find((s) => s.rw2), list.find((s) => s.base), list.find((s) => s.kind === "city")].filter(Boolean);
  assert(pick.length >= 2 && pick[0].rw2, `sites to look at: ${pick.map((s) => s.id)}`);
  const RUNWAY = new Set([BLOCK.BEDROCK, BLOCK.WOOL]);
  const bad = [];
  let cliff = 0;
  let edge = 0;
  for (const s of pick) {
    chunkCache.clear();
    const y0 = s.y;
    const lines = [0, ...(s.rw2 ? [s.rw2.v] : [])];
    for (const c of lines) {
      for (let u = -s.half; u <= s.half; u += 3) {
        for (let dv = -s.rw; dv <= s.rw; dv += 2) {
          const [x, z] = S.toWorld(s, u, c + dv);
          const b = blockOf(T, x, y0, z);
          if (!RUNWAY.has(b)) bad.push(`${s.id} runway ${c ? 2 : 1} at ${u},${dv}: ${b}`);
          for (let y = y0 + 1; y <= y0 + 8; y++) if (blockOf(T, x, y, z) !== BLOCK.AIR) bad.push(`${s.id} over runway ${c ? 2 : 1} at ${u},${dv},+${y - y0}`);
          if (bad.length > 5) break;
        }
      }
    }
    // The pad: solid at its level under every column of the rectangle (bar a bunker's ramp and hall).
    const r = s.rect;
    for (let u = r.u0; u <= r.u1; u += 5) {
      for (let v = r.v0; v <= r.v1; v += 5) {
        if ((s.bunkers || []).some((b) => u >= b.ru0 - 2 && u <= b.hu1 + 2 && v >= b.rv0 - 2 && v <= b.hv1 + 2)) continue;
        const [x, z] = S.toWorld(s, u, v);
        const b = blockOf(T, x, y0, z);
        if (!IS_SOLID[b]) bad.push(`${s.id} pad at ${u},${v}: ${b}`);
        if (bad.length > 8) break;
      }
    }
    // The slope round the pad: no step of more than a few blocks between neighbours.
    const rays = [];
    for (let u = r.u0 - S.blend; u <= r.u1 + S.blend; u += 4) rays.push([u, r.v0, 0, -1], [u, r.v1, 0, 1]);
    for (let v = r.v0; v <= r.v1; v += 4) rays.push([r.u0, v, -1, 0], [r.u1, v, 1, 0]);
    for (const [ru, rv, du, dv] of rays) {
      {
        let prev = null;
        for (let k = 0; k <= S.blend + 4; k++) {
          const [x, z] = S.toWorld(s, ru + du * k, rv + dv * k);
          const h = T.heightAt(x, z);
          if (prev !== null) {
            const step = Math.abs(h - prev);
            edge++;
            if (step > 4) cliff++;
          }
          prev = h;
        }
      }
    }
  }
  assert(!bad.length, bad.slice(0, 6).join("; "));
  console.log(`        (${pick.map((s) => s.id + " " + s.size).join(", ")}; steps over 4 blocks on the slopes: ${cliff} of ${edge})`);
  assert(cliff / edge < 0.01, `cliffs: ${cliff} of ${edge}`);
});

await check("parked aircraft: clear of both runways and of each other, fighters in the hangars, more of them than before", async () => {
  const { AirportManager } = await airportsModule();
  const SIZE = { b2: [48, 22], sr71: [16, 30] };
  const bad = [];
  let sites = 0;
  let hangarJets = 0;
  const totals = { old: 0, new: 0 };
  const nSites = { old: 0, new: 0 };
  for (const seed of [SEED, 12345, 777]) {
    for (const [k, o] of [["old", OLD], ["new", NEW]]) {
      const S = new TerrainGenerator(seed, o).sites;
      for (const s of S.within(0, 0, 8000)) {
        const world = { getChunk: () => ({}), getBlock: (x, y) => (y <= s.y ? 1 : 0) };
        const made = [];
        const vehicles = { vehicles: made, create: (type, d) => {
          const j = { type, jetType: d.jetType, pos: { x: d.pos[0], y: d.pos[1], z: d.pos[2] }, yaw: d.yaw, alive: true };
          made.push(j);
          return j;
        }, remove: () => {} };
        const am = new AirportManager({ sites: S, vehicles, world, player: { position: { x: s.x, y: s.y, z: s.z } }, mobs: null });
        const jets = [];
        am._fill(s, jets);
        totals[k] += jets.length;
        nSites[k]++;
        if (k === "old") continue;
        sites++;
        const box = jets.map((j) => {
          const [u, v] = S.toLocal(s, j.pos.x, j.pos.z);
          const [span, len] = SIZE[j.jetType] || [15, 16];
          return { k: j.parkKey, t: j.jetType, u0: u - span / 2, u1: u + span / 2, v0: v - len / 2, v1: v + len / 2 };
        });
        for (const b of box) {
          if (b.v0 <= s.rw + 2 && b.v1 >= -s.rw - 2) bad.push(`${s.id} ${b.k} on the runway`);
          if (s.rw2 && b.v0 <= s.rw2.v + s.rw2.rw + 2 && b.v1 >= s.rw2.v - s.rw2.rw - 2) bad.push(`${s.id} ${b.k} on the second runway`);
          if (/#g\d+$/.test(b.k)) hangarJets++;
        }
        for (let i = 0; i < box.length; i++) for (let j = i + 1; j < box.length; j++) {
          const a = box[i];
          const b = box[j];
          if (a.u0 < b.u1 && b.u0 < a.u1 && a.v0 < b.v1 && b.v0 < a.v1) bad.push(`${s.id} ${a.k} overlaps ${b.k}`);
        }
        if (!jets.some((j) => j.jetType === "f16" || j.jetType === "f22")) bad.push(`${s.id}: no fighter`);
      }
    }
  }
  const per = { old: totals.old / nSites.old, new: totals.new / nSites.new };
  console.log(`        (${sites} big sites; aircraft per site: ${per.old.toFixed(1)} at the old sites, ${per.new.toFixed(1)} at the new; ${hangarJets} fighters in hangars)`);
  assert(!bad.length, bad.slice(0, 6).join("; "));
  assert(per.new > per.old, "more aircraft per airport");
  assert(hangarJets >= sites, `fighters in hangars: ${hangarJets} at ${sites} sites`);
});

// ---------- In the browser ----------

if (!args.node) await browserChecks();

async function browserChecks() {
  const { chromium } = await import("playwright-core");
  const PORT = 11560 + Math.floor(Math.random() * 20);
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
  const peerjsFile = path.join(__dirname, "node_modules", "peerjs", "dist", "peerjs.min.js");
  async function newPage(label, init = null, size = { width: 960, height: 540 }) {
    const ctx = await browser.newContext({ viewport: size });
    if (init) await ctx.addInitScript(init.fn, init.arg);
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
  const shots = process.env.SHOTS || "";

  // ---------- A new Missions world ----------
  const page = await newPage("new");
  await page.goto(`http://127.0.0.1:${PORT}/index.html?seed=${SEED}&type=missions&graphics=low`, { waitUntil: "load", timeout: 60000 });
  await page.waitForFunction(() => !!window.__ufo && window.__ufo.graphicsReady, null, { timeout: 120000 });
  await play(page);

  // The player at the home airport's apron, the runways' chunks generated.
  const GOTO = async (g) => {
    const s = g.sites.home;
    if (!s) return null;
    const p = g.player;
    g.player.setMode("creative");
    g.player.damage = () => false;
    const [wx, wz] = g.sites.toWorld(s, (s.apron.u0 + s.apron.u1) / 2, s.rw + 12);
    p.flying = false;
    p.velocity.set(0, 0, 0);
    p.position.set(wx, s.y + 2, wz);
    for (let u = -s.half - 20; u <= s.half + 20; u += 16) {
      for (let vv = (s.rw2 ? s.rw2.v : 0) - s.rw - 20; vv <= s.apron.v1 + 10; vv += 16) {
        const [x, z] = g.sites.toWorld(s, u, vv);
        g.world._generate(Math.floor(x) >> 4, Math.floor(z) >> 4);
      }
    }
    g.world.prepareArea(wx, wz, 3);
    return { id: s.id, size: s.size, x: s.x, z: s.z, y: s.y, rw: s.rw, half: s.half, rw2: s.rw2 || null };
  };

  let home = null;
  await browserCheck("a new Missions world: generator 3, the big airports, the home airport close to the spawn", async () => {
    const r = await v(page, async (g) => {
      const W = await import("./js/worldtype.js");
      const s = g.sites.home;
      return { gen: W.terrainGen(), opts: g.world.terrainOptions, big: g.sites.big, home: s && { id: s.id, size: s.size, half: s.half, d: Math.round(Math.hypot(s.x - g.spawn.x, s.z - g.spawn.z)), rw2: !!s.rw2 }, near: g.airports.nearest(g.airports.far(3000))?.site?.id };
    });
    assert(r.gen === 3 && r.opts.bigAirports && r.big, `the generator: ${JSON.stringify(r)}`);
    assert(r.home && r.home.d < 1500 && r.home.half >= 540 && r.home.rw2, `the home airport: ${JSON.stringify(r)}`);
    assert(r.near === r.home.id, `the nearest airport: ${JSON.stringify(r)}`);
    home = r.home;
  });

  await browserCheck("the home airport's real blocks: both runways flat and clear; the parked jets off the runways, a fighter in a hangar; one boarded, the radar marks the airport", async () => {
    const at = await v(page, (g, src) => new Function("g", `return (${src})(g)`)(g), GOTO.toString());
    assert(at, "no home airport");
    await frames(page, 3);
    const r = await v(page, async (g) => {
      const { BLOCK } = await import("./js/blocks.js");
      const s = g.sites.home;
      const bad = [];
      for (const c of [0, ...(s.rw2 ? [s.rw2.v] : [])]) {
        for (let u = -s.half; u <= s.half; u += 7) {
          for (let dv = -s.rw; dv <= s.rw; dv += 3) {
            const [x, z] = g.sites.toWorld(s, u, c + dv);
            // (Generated here: the far ends lie beyond the loaded area.)
            if (!g.world.getChunk(Math.floor(x) >> 4, Math.floor(z) >> 4)) g.world._generate(Math.floor(x) >> 4, Math.floor(z) >> 4);
            const b = g.world.getBlock(Math.floor(x), s.y, Math.floor(z));
            let clear = true;
            for (let y = s.y + 1; y <= s.y + 6; y++) if (g.world.getBlock(Math.floor(x), y, Math.floor(z)) !== BLOCK.AIR) clear = false;
            if ((b !== BLOCK.BEDROCK && b !== BLOCK.WOOL) || !clear) bad.push(`${c ? 2 : 1}:${u},${dv}:${b}`);
          }
        }
      }
      // (The whole apron's chunks, each aircraft waits for its own: generated here.)
      for (let u = s.apron.u0 - 80; u <= s.apron.u1 + 80; u += 8) {
        for (let vv = s.rw; vv <= s.apron.v1 + 4; vv += 8) {
          const [x, z] = g.sites.toWorld(s, u, vv);
          if (!g.world.getChunk(Math.floor(x) >> 4, Math.floor(z) >> 4)) g.world._generate(Math.floor(x) >> 4, Math.floor(z) >> 4);
        }
      }
      for (let i = 0; i < 4; i++) {
        g.airports.timer = 0;
        g.airports.update(0.1);
      }
      const jets = g.vehicles.vehicles.filter((x) => x.type === "jet" && x.parkedAt === s.id);
      return {
        bad: bad.slice(0, 5),
        jets: jets.map((j) => {
          const [u, vv] = g.sites.toLocal(s, j.pos.x, j.pos.z);
          return { k: j.parkKey, t: j.jetType, u: Math.round(u), v: Math.round(vv) };
        }),
        rw: s.rw,
        rw2: s.rw2,
        dbg: (() => {
          const sl = g.sites.parkingSlots(s);
          return { total: g.airports.fighterCount(s), row: sl.fighters.map((x) => [x.key, Math.round(x.u), g.airports._clear(s, x, 15, 16)]), hang: sl.hangars.map((x) => [x.key, g.airports._clear(s, x, 15, 16)]) };
        })(),
      };
    });
    assert(!r.bad.length, `the runways: ${r.bad.join(", ")}`);
    assert(r.jets.length >= 3, `parked: ${JSON.stringify(r.jets)} ${JSON.stringify(r.dbg)}`);
    const LEN = { b2: 22, sr71: 30 };
    for (const j of r.jets) {
      const half = (LEN[j.t] || 16) / 2;
      assert(j.v - half > r.rw + 2, `on the runway: ${JSON.stringify(j)}`);
      if (r.rw2) assert(j.v + half < r.rw2.v - r.rw2.rw - 2 || j.v - half > r.rw2.v + r.rw2.rw + 2, `on the second runway: ${JSON.stringify(j)}`);
    }
    assert(r.jets.some((j) => /#g\d+$/.test(j.k)), `a fighter in a hangar: ${JSON.stringify(r.jets)}`);
    // Board one: the radar (shown while flying) marks the airport.
    const b = await v(page, async (g) => {
      const R = await import("./js/radar.js");
      if (!R.Radar.prototype.__r21) {
        const orig = R.Radar.prototype.draw;
        R.Radar.prototype.draw = function (dt, st) {
          window.__r21Contacts = st.contacts;
          return orig.call(this, dt, st);
        };
        R.Radar.prototype.__r21 = true;
      }
      const s = g.sites.home;
      const j = g.vehicles.vehicles.find((x) => x.type === "jet" && x.parkedAt === s.id && (x.jetType === "f16" || x.jetType === "f22"));
      g.player.setMode("survival");
      g.player.position.set(j.pos.x + 3, j.pos.y, j.pos.z + 2);
      g.vehicles.enter(j);
      return { seated: g.vehicles.active === j };
    });
    assert(b.seated, "boarded");
    await frames(page, 12);
    const c = await v(page, (g) => {
      const list = (window.__r21Contacts || []).filter((x) => x.kind === "airport");
      const s = g.sites.home;
      const out = { airports: list.map((x) => ({ d: Math.round(Math.hypot(x.x - s.x, x.z - s.z)), size: x.size })) };
      g.vehicles.exit({ force: true });
      g.player.setMode("creative");
      return out;
    });
    assert(c.airports.some((x) => x.d === 0 && x.size >= home.half * 2), `the radar: ${JSON.stringify(c)}`);
    if (shots) {
      await v(page, (g) => {
        const s = g.sites.home;
        g.player.flying = true;
        g.player.position.set(s.x, s.y + 140, s.z + 160);
        g.player.pitch = -0.7;
        g.player.yaw = 0;
      });
      await frames(page, 60);
      await page.screenshot({ path: path.join(shots, "r21-airport.png") });
    }
  });

  await browserCheck("the call-in jet waits on a runway; the touchdown mission marks the airport and counts a landing on the second runway", async () => {
    await v(page, (g, src) => new Function("g", `return (${src})(g)`)(g), GOTO.toString());
    const c = await v(page, (g) => {
      const s = g.sites.home;
      g.player.setMode("survival");
      g.callJet(true);
      const jet = g.vehicles.vehicles.find((x) => x.isPlayerJet);
      const [u, vv] = jet ? g.sites.toLocal(s, jet.pos.x, jet.pos.z) : [0, 99];
      g.player.setMode("creative");
      if (jet) g.vehicles.remove(jet);
      return { u: Math.round(u), v: Math.round(vv), half: s.half, rw2: s.rw2?.v ?? null };
    });
    assert((Math.abs(c.v) < 3 || (c.rw2 !== null && Math.abs(c.v - c.rw2) < 3)) && Math.abs(c.u) < c.half, `the call-in on a runway: ${JSON.stringify(c)}`);
    const m = await v(page, (g) => {
      const P = g.progress;
      const D = g.missions;
      g.player.setMode("survival");
      g.player.damage = () => false;
      P.enabled = true;
      D.enabled = true;
      const why = P.begin("touchdown", g.stats.world, { force: true });
      if (why) return { why };
      for (let i = 0; i < 6; i++) {
        D.checkT = 0;
        D.update(0.5);
      }
      const t = D.target;
      const s = g.sites.home;
      return { id: P.mission?.id, target: t && { label: t.label, d: Math.round(Math.hypot(t.pos.x - s.x, t.pos.z - s.z)) } };
    });
    assert(m.id === "touchdown" && m.target && m.target.d < 700, `the marker: ${JSON.stringify(m)}`);
    // A jet flown and set down on the second runway, stopped: landed.
    const l = await v(page, (g) => {
      const s = g.sites.home;
      const D = g.missions;
      const [x, z] = g.sites.toWorld(s, 100, s.rw2.v);
      const j = g.vehicles.create("jet", { jetType: "f16", pos: [x + 0.5, s.y + 1 + 1.35, z + 0.5], yaw: 0 });
      g.player.position.set(j.pos.x + 3, j.pos.y, j.pos.z);
      g.vehicles.enter(j);
      D.state.flown = new Set([j]);
      D.state.air = true;
      D.state.airJet = j;
      for (let i = 0; i < 20; i++) g.vehicles.update(1 / 30);
      const onGround = j.onGround;
      j.vel.set(0, 0, 0);
      const before = !!D.state.landed;
      for (let i = 0; i < 4; i++) {
        D.checkT = 0;
        D.update(0.5);
      }
      const out = { onGround, before, landed: !!D.state.landed, onRunway: !!g.sites.onRunway(j.pos.x, j.pos.z, 2) };
      if (g.vehicles.active) g.vehicles.exit({ force: true });
      g.vehicles.remove(j);
      g.progress.abandon();
      D.checkT = 0;
      D.update(0.5);
      for (const u of [...g.vehicles.vehicles]) if (u.mission || u.isEnemyGround || u.isGunship || u.isEnemyJet || u.isPlayerJet) g.vehicles.remove(u);
      g.player.setMode("creative");
      return out;
    });
    assert(l.onGround && l.onRunway && !l.before && l.landed, `the landing: ${JSON.stringify(l)}`);
  });

  // ---------- An older world: its record says generator 2 ----------
  await browserCheck("an older Missions world (saved with generator 2) keeps its old airports", async () => {
    const T = new TerrainGenerator(SEED, OLD);
    T.sites._ensureHome();
    const want = T.sites.home.id;
    const old = await newPage("old", { fn: ([seed]) => {
      try {
        if (!localStorage.getItem(`ufocombat_v1_world_${seed}`)) localStorage.setItem(`ufocombat_v1_world_${seed}`, JSON.stringify({ type: "missions", gen: 2 }));
      } catch {}
    }, arg: [SEED] });
    await old.goto(`http://127.0.0.1:${PORT}/index.html?seed=${SEED}&type=missions&graphics=low`, { waitUntil: "load", timeout: 60000 });
    await old.waitForFunction(() => !!window.__ufo && window.__ufo.graphicsReady, null, { timeout: 120000 });
    await play(old);
    const r = await v(old, async (g) => {
      const W = await import("./js/worldtype.js");
      const s = g.sites.home;
      return { gen: W.terrainGen(), opts: g.world.terrainOptions, big: g.sites.big, home: s?.id, half: s?.half };
    });
    assert(r.gen === 2 && !r.opts.bigAirports && !r.big, `the generator: ${JSON.stringify(r)}`);
    assert(r.home === want && r.half <= 460, `the home airport: ${JSON.stringify(r)} (want ${want})`);
    await old.context().close();
  });

  await browser.close();
  server.close();
}

const failed = results.filter((r) => !r[1]);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
