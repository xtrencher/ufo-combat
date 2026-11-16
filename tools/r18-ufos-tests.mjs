// Round 18 track C tests: UFOs on every planet (js/ufos.js, main.js
// ufosHere, js/dimensions.js DimSync).
// In the browser (a Missions world in Creative: the "UFO activity" setting
// drives them, no mission chain):
//   - on the Moon, Mars, Mercury and Venus: UFOs on, none of the last
//     dimension's left over, they spawn round the player above that
//     planet's ground; no sea there (no spawn under it, no lake or dive
//     tricks, no rising out of it); the planet's flavour (designs, crews);
//     the night read from that sky;
//   - one shot down on each planet falls (no splash), crashes into a wreck
//     of that dimension (intact or burnt out) and its crew climbs out;
//   - back in the Overworld: the planet's UFOs gone, its wrecks aside, and
//     the Overworld's UFOs (and their sea) as before; none in the Nether;
//   - online (skip with --solo): a guest on the host's planet sees the
//     host's UFOs; with the host gone home it runs its own there; the host
//     back: the host's again;
//   - no console errors anywhere.
//
//   node r18-ufos-tests.mjs [--only=substring] [--solo]
// (GAME_ROOT=dir runs another copy of the game.)
import http from "node:http";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";

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

const results = [];
function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}
async function check(name, fn) {
  if (args.only && !name.startsWith("boot") && !name.toLowerCase().includes(String(args.only).toLowerCase())) return;
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

const { chromium } = await import("playwright-core");
// (A port range no other suite uses.)
const PORT = 10180 + Math.floor(Math.random() * 10);
const PEER_PORT = PORT + 10;
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
async function newPage(tag, viewport = { width: 800, height: 450 }) {
  const ctx = await browser.newContext({ viewport });
  const page = await ctx.newPage();
  await page.route("https://cdn.jsdelivr.net/npm/three@0.160.0/**", (route) => {
    const rel = new URL(route.request().url()).pathname.replace("/npm/three@0.160.0/", "");
    route.fulfill({ path: path.join(localThreeRoot, rel), contentType: "text/javascript" });
  });
  await page.route("https://cdn.jsdelivr.net/npm/peerjs@1.5.4/**", (route) => route.fulfill({ path: peerjsFile, contentType: "text/javascript" }));
  page.on("console", (m) => m.type() === "error" && errors.push(`[${tag}] ${m.text()}`));
  page.on("pageerror", (e) => errors.push(`[${tag}] ${String(e)}`));
  page.on("dialog", (d) => d.accept());
  return page;
}
const v = (page, fn, arg) => page.evaluate(([src, a]) => new Function("g", "arg", `return (${src})(g, arg);`)(window.__ufo, a), [fn.toString(), arg]);
const frames = (page, n = 2) =>
  page.evaluate(
    (k) =>
      new Promise((r) => {
        let i = 0;
        const f = () => (++i >= k ? r() : requestAnimationFrame(f));
        requestAnimationFrame(f);
      }),
    n
  );
const until = async (page, fn, timeout = 60000, arg) => {
  const t0 = Date.now();
  while (Date.now() - t0 < timeout) {
    const r = await v(page, fn, arg);
    if (r) return r;
    await new Promise((res) => setTimeout(res, 200));
  }
  return null;
};
async function play(page) {
  const t0 = Date.now();
  while (Date.now() - t0 < 300000) {
    const st = await v(page, (g) => g.gameState);
    if (st === "playing") return;
    if (st === "dead") {
      await v(page, (g) => g.respawn());
      continue;
    }
    const click = (sel) => page.evaluate((s) => document.querySelector(s)?.click(), sel).catch(() => {});
    if (st === "start") await click("#play-btn");
    else if (await page.isVisible("#resume-btn")) await click("#resume-btn");
    else await page.mouse.click(300, 200);
    await frames(page, 3);
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

// To `dim` on foot (the dimensions' own travel), standing on its ground.
const travel = async (page, dim) => {
  await v(page, (g, d) => {
    g.vehicles.exit?.({ force: true });
    if (g.dims.dim !== d) g.dims.travel(d, 0.5, 100, 0.5, { place: "safe" });
    return true;
  }, dim);
  await page.waitForFunction(() => !window.__ufo.dims.pending, null, { timeout: 90000 });
  await frames(page, 3);
  return v(page, (g) => g.dims.dim);
};
// Steps the UFOs (fixed steps, whatever the page's frame rate) until `count` are about.
const STEP_SPAWN = `(g, count) => { for (let i = 0; i < 30 * 40 && g.ufos.count < count; i++) g.ufos.update(1 / 30); return g.ufos.count; }`;
const run = (page, src, arg) => page.evaluate(([s, a]) => new Function("g", "a", `return (${s})(g, a);`)(window.__ufo, a), [src, arg]);

const PLANETS = ["moon", "mars", "mercury", "venus"];
const page = await newPage("solo");

await browserCheck("boot: a Missions world in Creative, UFO activity up, no missions or enemy jets", async () => {
  await page.goto(`http://127.0.0.1:${PORT}/index.html?seed=1818&type=missions&graphics=low`, { waitUntil: "load", timeout: 60000 });
  await page.waitForFunction(() => !!window.__ufo && window.__ufo.graphicsReady, null, { timeout: 120000 });
  await play(page);
  const r = await v(page, (g) => {
    g.testFlags.noMissions = true;
    g.setMode("creative");
    g.settingsPanel.set("vehicles.enemyJets", 0);
    g.settingsPanel.set("ufos.activity", 4);
    return { mods: g.mods.enabled, enabled: g.ufos.enabled, dim: g.dims.dim, sea: g.ufos.hasSea, type: g.worldType };
  });
  assert(r.mods && r.enabled && r.dim === "overworld" && r.sea && r.type === "missions", `start ${JSON.stringify(r)}`);
});

const lastIds = { max: 0 };
for (const dim of PLANETS) {
  await browserCheck(`${dim}: UFOs on, none left over from before, spawned above its ground, no sea tricks, its flavour, its sky's night`, async () => {
    // (UFOs in the dimension being left: none of them may come along.)
    const before = await v(page, (g) => {
      for (let i = 0; i < 4; i++) g.ufos.spawn({ size: "small", pos: g.player.position.clone().add(new g.THREE.Vector3(40 + i * 10, 30, 0)) });
      return Math.max(...g.ufos.ufos.map((u) => u.id));
    });
    lastIds.max = before;
    assert((await travel(page, dim)) === dim, `not on ${dim}`);
    const arrive = await v(page, (g, max) => ({ enabled: g.ufos.enabled, sea: g.ufos.hasSea, seaLevel: g.ufos.seaLevel, old: g.ufos.ufos.filter((u) => u.id <= max).length, crews: g.ufos.pendingCrews.length }), before);
    assert(arrive.enabled && !arrive.sea && arrive.seaLevel === -Infinity, `UFOs on, no sea: ${JSON.stringify(arrive)}`);
    assert(arrive.old === 0 && arrive.crews === 0, `left over from the last dimension: ${JSON.stringify(arrive)}`);
    const n = await run(page, STEP_SPAWN, 4);
    assert(n >= 4, `only ${n} UFOs spawned on ${dim}`);
    const r = await v(page, (g) => {
      const out = { bad: [], states: {}, tricks: {}, under: 0, emerge: 0, lakes: 0, designs: {}, crews: {} };
      for (const u of g.ufos.ufos) {
        const ground = g.world.heightAt(Math.floor(u.pos.x), Math.floor(u.pos.z));
        // (A moving ship eases up over a cliff it meets, as at home: buried whole is wrong.)
        if (u.pos.y + u.info.h * u.radius * 0.5 < ground && !(u.trick === "burrow" || u.ghostT > 0)) out.bad.push([u.id, Math.round(u.pos.y), ground, u.state, u.trick]);
        out.states[u.state] = (out.states[u.state] ?? 0) + 1;
        if (u.state === "emerge") out.emerge++;
      }
      // Spawn points: never under a sea, always over the ground.
      const u0 = g.ufos.ufos[0];
      for (let i = 0; i < 150; i++) {
        const p = g.ufos._spawnPoint(u0);
        if (p.y - u0.info.bottom * u0.radius < g.world.heightAt(Math.floor(p.x), Math.floor(p.z))) out.under++;
      }
      // Tricks: no lake, no dive.
      const keep = { state: u0.state, trick: u0.trick, waypoint: u0.waypoint, timer: u0.timer, target: u0.target, pos: u0.pos.clone() };
      for (let i = 0; i < 200; i++) {
        g.ufos._startTrick(u0);
        u0.pos.copy(keep.pos);
        const t = u0.state === "trick" ? u0.trick : u0.state;
        out.tricks[t] = (out.tricks[t] ?? 0) + 1;
        if (t === "hover_lake" || t === "dive") out.lakes++;
      }
      Object.assign(u0, { state: "roam", trick: null, waypoint: null, timer: 0 });
      g.ufos._dropTarget(u0);
      out.water = g.ufos._waterAt(u0.pos.x, u0.pos.z);
      // The flavour: designs and crews (fresh ships, not drawn: removed again).
      for (let i = 0; i < 40; i++) {
        const u = g.ufos.spawn({ size: "small" });
        out.designs[u.design] = (out.designs[u.design] ?? 0) + 1;
        g.ufos._remove(g.ufos.ufos.indexOf(u));
      }
      for (let i = 0; i < 200; i++) {
        const k = g.ufos._crewKind(1);
        out.crews[k] = (out.crews[k] ?? 0) + 1;
      }
      out.night = g.ufos.night;
      out.glow = g.ufos.glowNight;
      out.daylight = g.sky.daylight;
      out.airless = !!g.world.dimInfo.airless;
      out.min = g.ufos.ufos.reduce((m, u) => Math.min(m, Math.round(u.pos.y - g.world.heightAt(Math.floor(u.pos.x), Math.floor(u.pos.z)))), 1e9);
      return out;
    });
    assert(!r.bad.length, `UFOs under the ground: ${JSON.stringify(r.bad)}`);
    assert(r.emerge === 0 && r.under === 0 && r.lakes === 0 && !r.water, `sea things on ${dim}: ${JSON.stringify({ emerge: r.emerge, under: r.under, lakes: r.lakes, water: r.water, tricks: r.tricks })}`);
    const fav = { moon: "alien_gray", mars: "alien_red", mercury: "alien_blue", venus: "alien" }[dim];
    assert((r.crews[fav] ?? 0) > 80, `${dim}'s crews lean to ${fav}: ${JSON.stringify(r.crews)}`);
    assert(Number.isFinite(r.night) && r.night >= 0 && r.night <= 1 && Math.abs(r.night - (1 - r.daylight)) < 1e-6, `night ${JSON.stringify(r)}`);
    if (r.airless) assert(r.glow >= 0.6, `airless glow ${r.glow}`);
    console.log(`        ${dim}: states ${JSON.stringify(r.states)}, tricks ${JSON.stringify(r.tricks)}, designs ${JSON.stringify(r.designs)}, night ${r.night.toFixed(2)}, lowest ${r.min} over the ground`);
  });

  await browserCheck(`${dim}: a UFO shot down falls (no splash), crashes into a wreck of ${dim}, and its crew climbs out`, async () => {
    const r0 = await v(page, (g, d) => {
      // (the others go: their crews and blasts would muddle the count)
      g.ufos.clear();
      g.settingsPanel.set("ufos.activity", 0);
      for (let i = g.mobs.mobs.length - 1; i >= 0; i--) if (g.mobs.mobs[i].spec.alien) g.mobs._remove(i);
      const exploded = d === "mars" || d === "venus"; // (both outcomes: two intact, two burnt out)
      const u = g.ufos.spawn({ size: "medium", pos: g.player.position.clone().add(new g.THREE.Vector3(22, 30, 0)) });
      u.crashPlan = { exploded, crew: 3 };
      window.__wrecks = g.vehicles.vehicles.length;
      window.__boom = g.effects.explosionCount;
      window.__downs = g.stats.world.ufosDown;
      window.__u = u;
      g.ufos.damage(u, 99999, true);
      return { falling: u.falling, exploded, crew: u.crewKind };
    }, dim);
    assert(r0.falling, "not falling");
    const wreck = await until(page, (g) => {
      const u = window.__u;
      if (u.splashed) return { splashed: true };
      const w = g.vehicles.vehicles.slice(window.__wrecks).find((x) => x.type === "ufo" && x.crashed);
      return w && g.effects.explosionCount > window.__boom ? { dim: w.dim, wreck: !!w.wreck, unusable: !!w.unusable, y: w.pos.y, ground: g.world.heightAt(Math.floor(w.pos.x), Math.floor(w.pos.z)), gone: u.state === "gone" } : null;
    }, 90000);
    assert(wreck && !wreck.splashed, `no crash: ${JSON.stringify(wreck)}`);
    assert(wreck.dim === dim && wreck.wreck === r0.exploded && wreck.unusable === r0.exploded && wreck.gone, `the wreck (intact: boardable): ${JSON.stringify(wreck)}`);
    assert(Math.abs(wreck.y - wreck.ground) < 25, `the wreck sits in the ground: ${JSON.stringify(wreck)}`);
    const crew = await until(page, (g) => {
      const list = g.mobs.mobs.filter((m) => m.spec.alien && !m.dead);
      return list.length >= 2 && g.ufos.pendingCrews.length === 0 ? { n: list.length, wet: list.some((m) => m.wet), kinds: [...new Set(list.map((m) => m.kind))] } : null;
    }, 60000);
    assert(crew && !crew.wet, `the crew: ${JSON.stringify(crew)}`);
    assert((await v(page, (g) => g.stats.world.ufosDown - window.__downs)) === 1, "counted as shot down");
    console.log(`        ${dim}: ${r0.exploded ? "burnt-out" : "intact"} wreck, ${crew.n} aliens (${crew.kinds.join(", ")})`);
    await v(page, (g) => {
      for (let i = g.mobs.mobs.length - 1; i >= 0; i--) if (g.mobs.mobs[i].spec.alien) g.mobs._remove(i);
      g.settingsPanel.set("ufos.activity", 4);
      return true;
    });
  });
}

await browserCheck("back to the Overworld: the planet's UFOs gone, its wrecks aside, the Overworld's UFOs (and their sea) as before", async () => {
  const before = await v(page, (g) => {
    g.settingsPanel.set("ufos.activity", 4);
    for (let i = 0; i < 3; i++) g.ufos.spawn({ size: "small", pos: g.player.position.clone().add(new g.THREE.Vector3(40 + i * 10, 30, 0)) });
    return { max: Math.max(...g.ufos.ufos.map((u) => u.id)) };
  });
  assert((await travel(page, "overworld")) === "overworld", "not home");
  const r = await v(page, (g, max) => {
    const old = g.ufos.ufos.filter((u) => u.id <= max).length;
    const planetWrecks = g.vehicles.all().filter((x) => x.type === "ufo" && x.crashed && x.dim !== "overworld");
    return { old, enabled: g.ufos.enabled, sea: g.ufos.hasSea, seaLevel: g.ufos.seaLevel, wrecksAside: planetWrecks.length, wrecksDrawn: planetWrecks.filter((x) => x.root.visible && x.root.parent).length };
  }, before.max);
  assert(r.old === 0 && r.enabled && r.sea && r.seaLevel === 24, `home: ${JSON.stringify(r)}`);
  assert(r.wrecksAside >= 2 && r.wrecksDrawn === 0, `the planets' wrecks wait aside: ${JSON.stringify(r)}`);
  const n = await run(page, STEP_SPAWN, 4);
  assert(n >= 4, `only ${n} UFOs in the Overworld`);
  // The sea's tricks are back: over open water a lake or a dive turns up.
  const t = await v(page, (g) => {
    const u = g.ufos.ufos[0];
    let lakes = 0;
    let water = 0;
    const keep = u.pos.clone();
    // (over open water: the lake and the dive find it near)
    for (let i = 0; i < 2000; i++) {
      const x = keep.x + (Math.random() - 0.5) * 1200;
      const z = keep.z + (Math.random() - 0.5) * 1200;
      if (g.ufos._waterAt(x, z)) {
        water++;
        keep.set(x, keep.y, z);
        break;
      }
    }
    for (let i = 0; i < 120; i++) {
      g.ufos._startTrick(u);
      u.pos.copy(keep);
      if (u.state === "trick" && (u.trick === "hover_lake" || u.trick === "dive")) lakes++;
    }
    Object.assign(u, { state: "roam", trick: null, waypoint: null, timer: 0 });
    g.ufos._dropTarget(u);
    return { lakes, water };
  });
  assert(t.water === 0 || t.lakes > 0, `the sea's tricks: ${JSON.stringify(t)}`);
  // One shot down in the Overworld still makes its wreck there.
  await v(page, (g) => {
    const u = g.ufos.spawn({ size: "small", pos: g.player.position.clone().add(new g.THREE.Vector3(20, 30, 0)) });
    u.crashPlan = { exploded: false, crew: 1 };
    window.__wrecks = g.vehicles.vehicles.length;
    g.ufos.damage(u, 99999, true);
    return true;
  });
  const w = await until(page, (g) => g.vehicles.vehicles.slice(window.__wrecks).find((x) => x.type === "ufo" && x.crashed)?.dim, 90000);
  assert(w === "overworld", `the Overworld's wreck: ${w}`);
});

await browserCheck("the Nether: no UFOs there (as before), and none brought in", async () => {
  assert((await travel(page, "nether")) === "nether", "not in the Nether");
  const r = await v(page, (g) => {
    for (let i = 0; i < 60; i++) g.ufos.update(1 / 30);
    return { enabled: g.ufos.enabled, n: g.ufos.ufos.length };
  });
  assert(!r.enabled && r.n === 0, `Nether ${JSON.stringify(r)}`);
  assert((await travel(page, "overworld")) === "overworld", "not home");
  assert(await v(page, (g) => g.ufos.enabled), "UFOs back on at home");
});

await page.close();

// ---------- Online ----------
if (!args.solo && !(args.only && !"online".includes(String(args.only).toLowerCase()))) {
  const { default: express } = await import("express");
  const { ExpressPeerServer } = await import("peer");
  const app = express();
  const peerHttp = app.listen(PEER_PORT, "127.0.0.1");
  app.use("/ufo", ExpressPeerServer(peerHttp, { path: "/" }));
  const NET_Q = `peerServer=127.0.0.1:${PEER_PORT}/ufo&noStun=1&graphics=low`;
  const host = await newPage("host", { width: 640, height: 360 });
  const guest = await newPage("guest", { width: 640, height: 360 });
  await browserCheck("online: a guest on the host's planet sees the host's UFOs; host away: the guest's own there; host back: the host's again", async () => {
    await host.goto(`http://127.0.0.1:${PORT}/index.html?seed=1819&type=missions&${NET_Q}`, { waitUntil: "load", timeout: 60000 });
    await host.waitForFunction(() => !!window.__ufo && window.__ufo.graphicsReady, null, { timeout: 120000 });
    await host.click("#menu-mp-btn");
    await host.fill("#mp-nick", "Alice");
    await host.click("#mp-host-btn");
    const code = await until(host, (g) => g.net.code, 30000);
    assert(code, "no room code");
    await host.click("#mp-lobby-play");
    await host.waitForFunction(() => window.__ufo.gameState === "playing", null, { timeout: 30000 });
    await v(host, (g) => {
      g.testFlags.noMissions = true;
      g.setMode("creative");
      g.settingsPanel.set("vehicles.enemyJets", 0);
      g.settingsPanel.set("ufos.activity", 0);
      return true;
    });
    await guest.goto(`http://127.0.0.1:${PORT}/index.html?join=${code}&${NET_Q}`, { waitUntil: "load", timeout: 60000 });
    await guest.waitForSelector("#mp-join-boot:not(.hidden)", { timeout: 30000 });
    await guest.fill("#mp-boot-nick", "Bob");
    await guest.click("#mp-boot-join");
    await guest.waitForFunction(() => !!window.__ufo && window.__ufo.graphicsReady, null, { timeout: 120000 });
    assert(await until(guest, (g) => g.mp.stateLoaded, 60000), "the host's state never arrived");
    await play(guest);
    await v(guest, (g) => {
      g.setMode?.("creative");
      return true;
    });
    // Both on the Moon: the host's UFOs, drawn for the guest.
    assert((await travel(host, "moon")) === "moon", "host not on the Moon");
    assert((await travel(guest, "moon")) === "moon", "guest not on the Moon");
    const hostIds = await v(host, (g) => {
      const at = g.player.position;
      const list = [];
      for (let i = 0; i < 3; i++) list.push(g.ufos.spawn({ size: "small", pos: at.clone().add(new g.THREE.Vector3(30 + 15 * i, 25, 10)) }).id);
      return list;
    });
    const seen = await until(guest, (g) => (g.ufos.puppets && g.mp.entities.ufoById.size >= 3 && g.ufos.ufos.every((u) => u.net) ? g.mp.entities.ufoById.size : null), 45000);
    assert(seen, `the guest never saw the host's Moon UFOs ${JSON.stringify(await v(guest, (g) => ({ p: g.ufos.puppets, n: g.ufos.ufos.length, ids: g.mp.entities.ufoById.size, dim: g.dims.dim, enabled: g.ufos.enabled })))}`);
    void hostIds;
    // The host goes home: the guest's own UFOs on the Moon (none of the host's
    // left), at the host's UFO activity (its rules are everyone's).
    await v(host, (g) => {
      g.settingsPanel.set("ufos.activity", 4);
      return true;
    });
    assert((await travel(host, "overworld")) === "overworld", "host not home");
    const own = await until(guest, (g) => {
      if (g.ufos.puppets) return null;
      for (let i = 0; i < 30 * 20 && g.ufos.count < 2; i++) g.ufos.update(1 / 30);
      return g.ufos.count >= 2 && g.ufos.ufos.every((u) => !u.net) ? { n: g.ufos.count, ids: g.mp.entities.ufoById.size, sea: g.ufos.hasSea } : null;
    }, 45000);
    assert(own && own.ids === 0 && !own.sea, `the guest's own Moon UFOs: ${JSON.stringify(own)} ${JSON.stringify(await v(guest, (g) => ({ p: g.ufos.puppets, en: g.ufos.enabled, mods: g.mods.enabled, act: g.ufos.config.activity, n: g.ufos.ufos.length, dim: g.dims.dim, creative: g.player.creative, max: g.ufos.maxCount, rules: !!g.ufos.rules })))}`);
    // The guest shoots one of its own down: its wreck (shared: the host has it, aside, on the Moon) and its crew.
    await v(guest, (g) => {
      const u = g.ufos.spawn({ size: "small", pos: g.player.position.clone().add(new g.THREE.Vector3(20, 25, 0)) });
      u.crashPlan = { exploded: false, crew: 2 };
      window.__wrecks = g.vehicles.vehicles.length;
      g.ufos.damage(u, 99999, true);
      return true;
    });
    const gw = await until(guest, (g) => {
      const w = g.vehicles.vehicles.slice(window.__wrecks).find((x) => x.type === "ufo" && x.crashed);
      return w && g.mobs.mobs.some((m) => m.spec.alien) ? { dim: w.dim, nid: w.net?.nid } : null;
    }, 60000);
    assert(gw && gw.dim === "moon", `the guest's wreck and crew: ${JSON.stringify(gw)}`);
    if (gw.nid) assert(await until(host, (g, nid) => g.vehicles.all().some((x) => x.net?.nid === nid && x.dim === "moon"), 20000, gw.nid), "the host never got the guest's Moon wreck");
    // The host's Overworld UFOs are not the guest's.
    await v(host, (g) => {
      g.ufos.spawn({ size: "small", pos: g.player.position.clone().add(new g.THREE.Vector3(30, 25, 0)) });
      return true;
    });
    await new Promise((r) => setTimeout(r, 2500));
    assert((await v(guest, (g) => g.mp.entities.ufoById.size)) === 0, "the host's Overworld UFOs reached the guest on the Moon");
    // The host comes back: the guest's own go, the host's are drawn again.
    await v(host, (g) => {
      g.settingsPanel.set("ufos.activity", 0);
      return true;
    });
    assert((await travel(host, "moon")) === "moon", "host not back on the Moon");
    await v(host, (g) => {
      g.ufos.spawn({ size: "small", pos: g.player.position.clone().add(new g.THREE.Vector3(30, 25, 0)) });
      return true;
    });
    const back = await until(guest, (g) => (g.ufos.puppets && g.mp.entities.ufoById.size >= 1 && g.ufos.ufos.length && g.ufos.ufos.every((u) => u.net) ? { n: g.ufos.ufos.length } : null), 45000);
    assert(back, `the host's UFOs again: ${JSON.stringify(await v(guest, (g) => ({ p: g.ufos.puppets, n: g.ufos.ufos.length, net: g.ufos.ufos.filter((u) => u.net).length, ids: g.mp.entities.ufoById.size })))}`);
  });
  await guest.close();
  await host.close();
  peerHttp.close();
}

await browser.close();
server.close();

// ---------- Summary ----------
const failed = results.filter(([, ok]) => !ok);
console.log(`\n${results.length - failed.length} passed, ${failed.length} failed.`);
process.exit(failed.length ? 1 : 0);
