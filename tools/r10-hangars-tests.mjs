// Round 10 hangar and city tests: boots the real game in headless Chromium
// (software WebGL, Low preset) and checks the fighters parked inside hangars
// and the chests and wall torches of the cities: an airport with a fighter
// in a hangar (it stands inside, nose to the doorway, its lights off,
// nothing solid overlapping it; the hangar differs from a plain one only in
// its lights; the airport parks as many fighters as before), the way out to
// the runway is clear and flat, the marker finds it, boarding it and
// taxiing out works without a scrape, getting out inside leaves the pilot
// on the hangar's floor, a jet taken from it (here or by another player)
// keeps the hangar empty and one that is gone is set out again; a city's
// buildings have chests in their lobbies that can be walked up to from the
// street (right click opens one: loot), and wall torches by their doors and
// in the lobbies that hang on real walls and light them.
//
//   node r10-hangars-tests.mjs [--only=substring] [--seed=42]
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
const PORT = 9880 + Math.floor(Math.random() * 40);
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

async function play() {
  const t0 = Date.now();
  while (Date.now() - t0 < 90000) {
    const st = await v((g) => g.gameState);
    if (st === "playing") return;
    if (st === "dead") {
      await v((g) => g.respawn());
      continue;
    }
    if (st === "start") {
      await page.click("#play-btn", { timeout: 5000 }).catch(() => {});
    } else if (await page.isVisible("#resume-btn")) {
      await page.click("#resume-btn", { timeout: 3000 }).catch(() => {});
    } else {
      await page.mouse.click(480, 270);
      await frames(5);
      if ((await v((g) => g.gameState)) === "paused" && !(await page.isVisible("#resume-btn"))) await page.evaluate(() => document.getElementById("pause-menu").classList.remove("hidden"));
    }
    await frames(3);
  }
  throw new Error(`the game didn't start playing (state ${await v((g) => g.gameState)})`);
}
await play();
await v((g) => {
  g.testFlags.noMissions = true;
  if (g.player.creative) g.setMode("survival");
});

// The nearest airport (or city) with a fighter's hangar, its slot and the
// hangar: the player stands outside the doorway, the area loaded and the
// airport's aircraft set out. Returns { id, key, hangar, slot, y }.
const goHangar = () =>
  v((g) => {
    const p = g.player.position;
    const list = g.sites.within(p.x, p.z, 7000).filter((s) => g.sites.parkingSlots(s).hangars.length);
    list.sort((a, b) => Math.hypot(a.x - p.x, a.z - p.z) - Math.hypot(b.x - p.x, b.z - p.z));
    const s = list[0];
    if (!s) return null;
    const slot = g.sites.parkingSlots(s).hangars[0];
    const h = s.hangars[slot.hangar];
    const [dx, dz] = g.sites.toWorld(s, h.uc + 12, h.v0 - 4);
    g.world.prepareArea(slot.x, slot.z, 4);
    g.player.position.set(dx + 0.5, s.y + 1, dz + 0.5);
    g.player.velocity.set(0, 0, 0);
    g.streamAround(slot.x, slot.z);
    g.mobs.clear?.();
    g.airports.timer = 0;
    g.airports.update(1);
    return { id: s.id, key: slot.key, slot, hangar: { ...h }, y: s.y, rw: s.rw };
  });

// In the page: the solid blocks overlapping a jet's model (its hull, control
// surfaces, canopy and gear: not the flames or the light sprites).
const SOLID_IN_JET = `(g, jet, B) => {
  const box = new g.THREE.Box3();
  jet.root.updateMatrixWorld(true);
  jet.model.body.traverse((o) => {
    if (o.isMesh && (!o.material.transparent || o === jet.model.canopy)) box.expandByObject(o);
  });
  const hits = [];
  for (let x = Math.floor(box.min.x); x <= Math.floor(box.max.x); x++)
    for (let y = Math.floor(box.min.y + 0.05); y <= Math.floor(box.max.y); y++)
      for (let z = Math.floor(box.min.z); z <= Math.floor(box.max.z); z++) if (B.IS_SOLID[g.world.getBlock(x, y, z)]) hits.push([x, y, z, g.world.getBlock(x, y, z)]);
  return { hits, min: box.min.toArray(), max: box.max.toArray() };
}`;

let hangar = null;

await check("an airport with a fighter in a hangar: it stands inside, nose to the doorway, lights off, nothing solid in it", async () => {
  hangar = await goHangar();
  assert(hangar, "no airport with a fighter's hangar within 7000 blocks");
  const r = await v(
    async (g, a) => {
      const B = await import("./js/blocks.js");
      const solidIn = new Function(`return ${a.SOLID_IN_JET}`)();
      const s = g.sites.nearest(g.player.position.x, g.player.position.z, 1000);
      const jet = g.vehicles.vehicles.find((j) => j.type === "jet" && j.parkKey === a.h.key);
      if (!jet) return { none: true, site: s.id, parked: g.vehicles.vehicles.filter((j) => j.parkedAt).map((j) => j.parkKey) };
      const h = a.h.hangar;
      const [u, vv] = g.sites.toLocal(s, jet.pos.x - 0.5, jet.pos.z - 0.5);
      const fwd = jet.forward(new g.THREE.Vector3());
      const [vx, vz] = g.sites.dirV(s);
      const solid = solidIn(g, jet, B);
      const [mu0, mv0] = g.sites.toLocal(s, solid.min[0] - 0.5, solid.min[2] - 0.5);
      const [mu1, mv1] = g.sites.toLocal(s, solid.max[0] - 0.5, solid.max[2] - 0.5);
      return {
        site: s.id,
        type: jet.jetType,
        parked: !!jet.parkedAt,
        u,
        v: vv,
        inside: u > h.u0 + 1 && u < h.u1 - 1 && vv > h.v0 && vv < h.v1,
        // The model's footprint, in the hangar's local frame: within the walls, the tail clear of the back wall.
        foot: [Math.min(mu0, mu1), Math.max(mu0, mu1), Math.min(mv0, mv1), Math.max(mv0, mv1)],
        noseOut: fwd.x * vx + fwd.z * vz < -0.99, // (toward the doorway: -v)
        onGround: jet.onGround && Math.abs(jet.pos.y - (a.h.y + 1 + jet.gearH)) < 0.3,
        lights: jet.lightsActive,
        hits: solid.hits,
        hangarDiff: (() => {
          // Only the lights differ from a plain hangar (the shell is the same: the distant terrain's box still fits).
          const plain = { ...s.hangars[h.id], jet: false };
          let diff = 0;
          for (let uu = h.u0; uu <= h.u1; uu++)
            for (let v2 = h.v0; v2 <= h.v1; v2++)
              for (let y = 1; y <= h.h + 1; y++) {
                const x1 = g.sites._structureBlock({ t: "hangar", o: s.hangars[h.id] }, uu, v2, y);
                const x0 = g.sites._structureBlock({ t: "hangar", o: plain }, uu, v2, y);
                const light = (id) => id === 0 || id === B.BLOCK.TORCH || B.IS_WALL_TORCH[id] === 1;
                if (x1 !== x0 && !(light(x1) && light(x0))) diff++;
              }
          return diff;
        })(),
      };
    },
    { h: hangar, SOLID_IN_JET }
  );
  assert(!r.none, `no jet set out in the hangar: ${JSON.stringify(r)}`);
  const h = hangar.hangar;
  assert(r.parked && r.inside && r.noseOut && r.onGround, JSON.stringify(r));
  assert(r.foot[0] > h.u0 + 0.5 && r.foot[1] < h.u1 - 0.5 && r.foot[3] < h.v1 - 0.5 - 0.4 && r.foot[2] > h.v0 - 1.5, `the jet fits the hall: ${JSON.stringify({ foot: r.foot, h })}`);
  assert(r.lights === false, "a parked jet's lights are off");
  assert(r.hits.length === 0, `solid blocks inside the jet: ${JSON.stringify(r.hits.slice(0, 5))}`);
  assert(r.hangarDiff === 0, `the hangar's shell changed: ${r.hangarDiff} blocks`);
});

await check("the hangar's lights hang on its walls and light the hall; the way out to the runway is clear and flat", async () => {
  assert(hangar, "no hangar");
  const r = await v(async (g, a) => {
    const B = await import("./js/blocks.js");
    const s = g.sites.nearest(g.player.position.x, g.player.position.z, 1000);
    const h = a.hangar;
    const w = g.world;
    const at = (u, vv, y) => {
      const [x, z] = g.sites.toWorld(s, u, vv);
      return w.getBlock(x, s.y + y, z);
    };
    const light = (x, y, z) => w.getChunk(x >> 4, z >> 4).light[(y << 8) | ((z & 15) << 4) | (x & 15)] & 15;
    let torches = 0;
    let floating = 0;
    let dim = 0;
    let floor = 0;
    for (let u = h.u0; u <= h.u1; u++)
      for (let vv = h.v0; vv <= h.v1; vv++)
        for (let y = 1; y < h.h; y++) {
          const id = at(u, vv, y);
          if (id === B.BLOCK.TORCH && u === h.uc) floor++; // (none on the middle line: under the jet)
          if (!B.IS_WALL_TORCH[id]) continue;
          torches++;
          const [x, z] = g.sites.toWorld(s, u, vv);
          const [fx, fz] = B.BLOCK_INFO[id].facing;
          if (!B.isWallSupportedBy(w.getBlock(x - fx, s.y + y, z - fz)) || w.getBlock(x + fx, s.y + y, z + fz) !== 0) floating++;
          if (light(x, s.y + y, z) < 13) dim++;
        }
    // The lane: from the jet's middle out through the doorway to the runway.
    const blocked = [];
    const holes = [];
    for (let vv = Math.floor(a.slot.v); vv >= 0; vv--)
      for (let u = h.uc - 7; u <= h.uc + 7; u++) {
        if (!B.IS_SOLID[at(u, vv, 0)]) holes.push([u, vv]);
        for (let y = 1; y <= 6; y++) if (B.IS_SOLID[at(u, vv, y)]) blocked.push([u, vv, y, at(u, vv, y)]);
      }
    // No other aircraft parked in the lane.
    const inLane = g.vehicles.vehicles.filter((j) => {
      if (j.parkKey === a.key || !j.parkedAt || j.type !== "jet") return false;
      const [u, vv] = g.sites.toLocal(s, j.pos.x - 0.5, j.pos.z - 0.5);
      return Math.abs(u - h.uc) < 7 + (j.spec?.probes?.wing ?? 7) + 1 && vv < h.v0 && vv > 0;
    }).map((j) => j.parkKey);
    return { torches, floating, dim, floor, blocked: blocked.slice(0, 5), holes: holes.slice(0, 5), inLane };
  }, hangar);
  assert(r.torches >= 6 && r.floating === 0 && r.dim === 0 && r.floor === 0, JSON.stringify(r));
  assert(!r.blocked.length && !r.holes.length, `the way out: ${JSON.stringify(r)}`);
  assert(!r.inLane.length, `aircraft parked in the way out: ${JSON.stringify(r.inLane)}`);
});

await check("the airport parks as many fighters as before (a hangar's jet is one of them), every peer the same slots", async () => {
  const r = await v(async (g) => {
    const p = g.player.position;
    const { SiteGrower } = await import("./js/sites.js");
    const other = new SiteGrower(g.world.terrain); // (another peer's planner: the same seed)
    const out = { sites: 0, withJets: 0, less: [], differ: [] };
    for (const s of g.sites.within(p.x, p.z, 9000)) {
      out.sites++;
      const slots = g.sites.parkingSlots(s);
      if (slots.hangars.length) out.withJets++;
      const before = g.sites._row(s, []).fighters;
      if (slots.fighters.length + slots.hangars.length < Math.min(before, 3)) out.less.push(s.id);
      const s2 = other.siteAt(s.x, s.z);
      const o = other.parkingSlots(s2);
      const key = (l) => l.map((x) => `${x.key}@${x.x},${x.z}`).join(" ");
      if (key(o.hangars) !== key(slots.hangars) || key(o.fighters) !== key(slots.fighters)) out.differ.push(s.id);
    }
    // And what the airport near the player sets out: the whole count, at least one on the apron
    // (each aircraft waits for the chunks under its slot: those are loaded first).
    const s = g.sites.nearest(p.x, p.z, 1000);
    for (const sl of [...g.sites.parkingSlots(s).fighters, ...g.sites.parkingSlots(s).hangars]) g.world.prepareArea(sl.x, sl.z, 1);
    g.airports.timer = 0;
    g.airports.update(1);
    const jets = g.airports.parked.get(s.id).filter((j) => j.type === "jet" && j.jetType !== "b2");
    out.here = { total: g.airports.fighterCount(s), jets: jets.length, apron: jets.filter((j) => !/#g\d+$/.test(j.parkKey)).length, room: g.sites.parkingSlots(s).fighters.length + g.sites.parkingSlots(s).hangars.length };
    return out;
  });
  assert(r.sites >= 3 && r.withJets >= 1, JSON.stringify(r));
  assert(!r.less.length && !r.differ.length, JSON.stringify(r));
  assert(r.here.jets === Math.min(r.here.total, r.here.room) && r.here.apron >= 1, JSON.stringify(r.here));
});

await check("the marker finds the hangar's jet; boarding it and taxiing out works (no scrape), getting out inside leaves you on the floor", async () => {
  assert(hangar, "no hangar");
  const r = await v(
    async (g, a) => {
      const B = await import("./js/blocks.js");
      const solidIn = new Function(`return ${a.SOLID_IN_JET}`)();
      const s = g.sites.nearest(g.player.position.x, g.player.position.z, 1000);
      const h = a.h.hangar;
      const jet = g.vehicles.vehicles.find((j) => j.type === "jet" && j.parkKey === a.h.key);
      // Walk up to it: the marker points at it.
      const [ux, uz] = g.sites.dirU(s);
      g.player.position.set(jet.pos.x + ux * 9, a.h.y + 1, jet.pos.z + uz * 9);
      const marker = g.missions._parkedJetTarget?.();
      const out = { marker: marker?.follow === jet };
      // Get in and out again inside the hangar.
      g.player.position.set(jet.pos.x + ux * 5, a.h.y + 1, jet.pos.z + uz * 5);
      out.boarded = g.vehicles.enter(jet);
      g.vehicles.exit({ force: true });
      out.outY = g.player.position.y - (a.h.y + 1);
      const [pu, pv] = g.sites.toLocal(s, g.player.position.x - 0.5, g.player.position.z - 0.5);
      out.outInside = pu > h.u0 && pu < h.u1 && pv > h.v0 - 3 && pv < h.v1;
      // In again, and taxi out: throttle up, straight out of the doorway to the taxiway.
      g.player.position.set(jet.pos.x + ux * 5, a.h.y + 1, jet.pos.z + uz * 5);
      g.vehicles.enter(jet);
      out.taken = !jet.parkedAt;
      let t = 0;
      let worst = 0;
      let vv = 0;
      while (t < 20 && jet.alive) {
        jet.throttle = 0.45;
        g.vehicles.update(0.05);
        t += 0.05;
        vv = g.sites.toLocal(s, jet.pos.x - 0.5, jet.pos.z - 0.5)[1];
        if (Math.round(t * 20) % 4 === 0) worst = Math.max(worst, solidIn(g, jet, B).hits.length);
        if (vv < a.h.rw + 4) break;
      }
      const [u2] = g.sites.toLocal(s, jet.pos.x - 0.5, jet.pos.z - 0.5);
      Object.assign(out, { alive: jet.alive, t: +t.toFixed(2), v: vv, drift: u2 - h.uc, speed: jet.speed, onGround: jet.onGround, health: jet.health, max: jet.maxHealth, worst, why: jet.crashWhy || null });
      // Stop and get out (for the next test).
      jet.throttle = 0;
      jet.vel.set(0, 0, 0);
      g.vehicles.exit({ force: true });
      return out;
    },
    { h: hangar, SOLID_IN_JET }
  );
  assert(r.marker, `the marker points at the hangar's jet: ${JSON.stringify(r)}`);
  assert(r.boarded && Math.abs(r.outY) < 0.6 && r.outInside, `in and out inside the hangar: ${JSON.stringify(r)}`);
  assert(r.taken, "boarded: no longer the airport's");
  assert(r.alive && r.onGround && r.v < hangar.rw + 4 && Math.abs(r.drift) < 1.5, `taxied out to the taxiway: ${JSON.stringify(r)}`);
  assert(r.health === r.max && r.worst === 0, `without a scrape: ${JSON.stringify(r)}`);
  console.log(`        (taxied out in ${r.t} s at ${r.speed.toFixed(1)} blocks/s, ${r.drift.toFixed(2)} off the middle line)`);
});

await check("taken: the hangar stays empty while the jet is about (here or another player's), and it is set out again once that jet is gone", async () => {
  assert(hangar, "no hangar");
  const r = await v((g, a) => {
    const s = g.sites.nearest(g.player.position.x, g.player.position.z, 1000);
    const mine = g.vehicles.vehicles.find((j) => j.type === "jet" && j.parkKey === a.key);
    const out = {};
    g.airports.timer = 0;
    g.airports.update(1);
    out.whileOut = g.vehicles.vehicles.filter((j) => j.parkKey === a.key && j.parkedAt).length;
    // Gone (shot down, crashed): the airport sets out a new one.
    if (mine) g.vehicles.remove(mine);
    g.airports.timer = 0;
    g.airports.update(1);
    const fresh = g.vehicles.vehicles.find((j) => j.type === "jet" && j.parkKey === a.key && j.parkedAt);
    out.fresh = !!fresh;
    out.freshAt = fresh ? Math.hypot(fresh.pos.x - a.slot.x, fresh.pos.z - a.slot.z) : -1;
    // Another player took it (net/vehicles.js "took"): our copy goes, and stays gone.
    g.airports.takeParked(a.key);
    g.airports.timer = 0;
    g.airports.update(1);
    out.afterTake = g.vehicles.vehicles.filter((j) => j.parkKey === a.key).length;
    g.airports.taken.delete(a.key);
    g.airports.timer = 0;
    g.airports.update(1);
    out.back = g.vehicles.vehicles.filter((j) => j.parkKey === a.key && j.parkedAt).length;
    out.site = s.id;
    return out;
  }, hangar);
  assert(r.whileOut === 0, `no second copy while it is out: ${JSON.stringify(r)}`);
  assert(r.fresh && r.freshAt < 0.5, `set out again once gone: ${JSON.stringify(r)}`);
  assert(r.afterTake === 0 && r.back === 1, `taken by another player: ${JSON.stringify(r)}`);
});

// ---------- Cities ----------
let city = null;

await check("a city: chests in building lobbies, reachable from the street; wall torches by the doors and in the lobbies on real walls, lit", async () => {
  city = await v(async (g) => {
    const B = await import("./js/blocks.js");
    const p = g.player.position;
    const s = g.sites.nearest(p.x, p.z, 9000, "city");
    if (!s) return null;
    // The lots with a chest nearest the city's first street.
    const lot = s.lots.find((l) => l.deco?.some((d) => B.IS_CHEST[d.id]));
    const d = lot.deco.find((e) => B.IS_CHEST[e.id]);
    const [cx, cz] = g.sites.toWorld(s, d.u, d.v);
    g.world.prepareArea(cx, cz, 3);
    g.player.position.set(cx + 0.5, s.y + 1, cz + 0.5);
    g.streamAround(cx, cz);
    g.mobs.clear?.();
    const w = g.world;
    const at = (u, vv, y) => {
      const [x, z] = g.sites.toWorld(s, u, vv);
      return w.getBlock(x, s.y + y, z);
    };
    const light = (x, y, z) => w.getChunk(x >> 4, z >> 4).light[(y << 8) | ((z & 15) << 4) | (x & 15)] & 15;
    const out = { id: s.id, chests: 0, reach: 0, torches: 0, floating: 0, dim: 0, missing: 0, lots: 0 };
    // Every building whose chunks are loaded around here.
    for (const l of s.lots) {
      if (!l.deco) continue;
      const b = l.boxes[0];
      const [x0, z0] = g.sites.toWorld(s, b.u0 - 3, b.v0 - 3);
      const [x1, z1] = g.sites.toWorld(s, b.u1 + 3, b.v1 + 3);
      const ok = [[x0, z0], [x1, z1], [x0, z1], [x1, z0]].every(([x, z]) => w.getChunk(x >> 4, z >> 4));
      if (!ok) continue;
      out.lots++;
      const outDir = l.doorSide === "v0" ? -1 : 1;
      for (const e of l.deco) {
        const id = at(e.u, e.v, e.y);
        if (id !== e.id) {
          out.missing++;
          continue;
        }
        const [x, z] = g.sites.toWorld(s, e.u, e.v);
        const [fx, fz] = B.BLOCK_INFO[id].facing;
        const backed = B.isWallSupportedBy(w.getBlock(x - fx, s.y + e.y, z - fz)) && w.getBlock(x + fx, s.y + e.y, z + fz) === 0;
        if (B.IS_CHEST[id]) {
          out.chests++;
          if (!out.chest) out.chest = [x, s.y + e.y, z, id];
          // Reachable: a walk (two blocks high) from the street outside the door to the cell in front of the chest.
          const cu = Math.floor((b.u0 + b.u1) / 2);
          const start = [cu, (outDir < 0 ? b.v0 : b.v1) + 2 * outDir];
          const goal = `${e.u},${e.v + outDir}`;
          const seen = new Set([start.join()]);
          const q = [start];
          let found = false;
          while (q.length) {
            const [u, vv] = q.shift();
            if (`${u},${vv}` === goal) {
              found = true;
              break;
            }
            for (const [du, dv] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
              const nu = u + du;
              const nv = vv + dv;
              if (nu < b.u0 - 3 || nu > b.u1 + 3 || nv < b.v0 - 3 || nv > b.v1 + 3 || seen.has(`${nu},${nv}`)) continue;
              if (B.IS_SOLID[at(nu, nv, 1)] || B.IS_SOLID[at(nu, nv, 2)] || !B.IS_SOLID[at(nu, nv, 0)]) continue;
              seen.add(`${nu},${nv}`);
              q.push([nu, nv]);
            }
          }
          if (found && backed) out.reach++;
        } else {
          out.torches++;
          if (!backed) out.floating++;
          if (light(x, s.y + e.y, z) < 13) out.dim++;
        }
      }
    }
    return out;
  });
  assert(city, "no city within 9000 blocks");
  assert(city.lots >= 1 && city.missing === 0, JSON.stringify(city));
  assert(city.chests >= 1 && city.reach === city.chests, `chests: ${JSON.stringify(city)}`);
  assert(city.torches >= city.lots * 2 && city.floating === 0 && city.dim === 0, `torches: ${JSON.stringify(city)}`);
});

await check("right click opens a city chest: loot (rolled from the chest code, the host's online)", async () => {
  assert(city?.chest, "no chest");
  const r = await v(async (g, c) => {
    const B = await import("./js/blocks.js");
    const [x, y, z, id] = c.chest;
    const [fx, fz] = B.BLOCK_INFO[id].facing;
    const p = g.player;
    p.position.set(x + 0.5 + fx * 1.7, y, z + 0.5 + fz * 1.7);
    p.velocity.set(0, 0, 0);
    const eye = p.getEyePosition();
    const dx = x + 0.5 - eye.x;
    const dy = y + 0.4 - eye.y;
    const dz = z + 0.5 - eye.z;
    p.yaw = Math.atan2(-dx, -dz);
    p.pitch = Math.asin(dy / Math.hypot(dx, dy, dz));
    g.interaction.updateTarget(true);
    const target = g.interaction.target ? g.interaction.target.id : null;
    g.interaction.mouseDown(2);
    g.interaction.mouseUp(2);
    return { target, state: g.gameState };
  }, city);
  assert(r.target !== null && r.state === "inventory", JSON.stringify(r));
  await frames(3);
  const s = await v((g) => {
    const view = g.invScreen.chestView;
    return { ready: !!view?.ready, items: view?.slots?.filter(Boolean).length || 0 };
  });
  assert(s.ready && s.items >= 1, JSON.stringify(s));
  await page.keyboard.press("Escape");
  await frames(3);
});

// ---------- Summary ----------
const failed = results.filter(([, ok]) => !ok);
console.log(`\n${results.length - failed.length} passed, ${failed.length} failed${errors.length ? `; console errors: ${errors.length}` : ""}.`);
if (errors.length) console.log(errors.slice(0, 5).join("\n"));
await browser.close();
server.close();
process.exit(failed.length || errors.length ? 1 : 0);
