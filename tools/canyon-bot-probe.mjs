// (Round 16) A quick look at the canyon's enemy jets: loads a run with
// bots, waits for GO, then flies the player along the course's line on an
// autopilot (simulated frames) and prints, every second, the run's state,
// the bandits (where, how fast, alive), their shots and what brought
// anyone down. A debugging aid for js/canyon-bots.js, not a test suite.
//
//   node canyon-bot-probe.mjs [--course=grand] [--diff=normal] [--bots=some] [--secs=30]
import http from "node:http";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(process.env.GAME_ROOT || path.join(__dirname, ".."));
const args = Object.fromEntries(process.argv.slice(2).filter((a) => a.startsWith("--")).map((a) => a.slice(2).split("=")));
const { chromium } = await import("playwright-core");
const PORT = 9880 + Math.floor(Math.random() * 40);
const server = http.createServer((req, res) => {
  let f = path.join(ROOT, decodeURIComponent(req.url.split("?")[0]));
  if (f.endsWith("/")) f = path.join(f, "index.html");
  fs.readFile(f, (err, data) => {
    if (err) {
      res.writeHead(404);
      res.end();
      return;
    }
    res.writeHead(200, { "Content-Type": f.endsWith(".html") ? "text/html" : f.endsWith(".js") ? "text/javascript" : "application/octet-stream" });
    res.end(data);
  });
});
await new Promise((r) => server.listen(PORT, "127.0.0.1", r));
const browser = await chromium.launch({ executablePath: (await import("./chromium-path.mjs")).default, args: ["--use-gl=swiftshader", "--enable-webgl", "--ignore-gpu-blocklist", "--no-sandbox", "--disable-dev-shm-usage"] });
const page = await browser.newPage({ viewport: { width: 800, height: 450 } });
await page.route("https://cdn.jsdelivr.net/npm/three@0.160.0/**", (route) => route.fulfill({ path: path.join(__dirname, "node_modules", "three", new URL(route.request().url()).pathname.replace("/npm/three@0.160.0/", "")), contentType: "text/javascript" }));
page.on("pageerror", (e) => console.log("PAGE ERROR", String(e)));
page.on("console", (m) => m.type() === "error" && console.log("CONSOLE", m.text()));
await page.goto(`http://127.0.0.1:${PORT}/index.html?canyon=${args.course || "grand"}&diff=${args.diff || "normal"}&bots=${args.bots || "some"}&open=none`);
await page.waitForFunction(() => window.__ufo?.graphicsReady && window.__ufo.canyon, null, { timeout: 120000 });
await page.evaluate(() => window.__ufo.setGraphics("low"));
for (let i = 0; i < 300; i++) {
  const st = await page.evaluate(() => window.__ufo.gameState);
  if (st === "playing") break;
  await page.mouse.click(300, 200);
  await page.waitForTimeout(300);
}
await page.waitForFunction(() => window.__ufo.canyon.state === "flying", null, { timeout: 300000, polling: 500 });
const out = await page.evaluate(async (secs) => {
  const g = window.__ufo;
  const c = g.canyon;
  const T = g.THREE;
  c.waitForGround = false;
  c.bots.timer = 0.1;
  const log = [];
  const downs = [];
  const onDown = c.bots.onDown.bind(c.bots);
  c.bots.onDown = (b, cause) => {
    downs.push({ cause, why: b.crashWhy, role: b.role, z: Math.round(b.pos.z), age: +b.age.toFixed(1) });
    return onDown(b, cause);
  };
  let bolts = 0;
  const fire = g.lasers.fire.bind(g.lasers);
  g.lasers.fire = (o) => {
    if (o.owner === "enemyjet") bolts++;
    return fire(o);
  };
  const traces = [];
  const spawn = c.bots.spawn.bind(c.bots);
  c.bots.spawn = (o) => {
    const b = spawn(o);
    if (b) {
      b.trace = [];
      traces.push(b);
    }
    return b;
  };
  for (let s = 0; s < secs; s++) {
    for (let i = 0; i < 30; i++) {
      const j = g.vehicles.active;
      if (j && c.state === "flying") {
        // (the player on rails along the course's line: never into the rock)
        const z = j.pos.z + (c._aheadIn(j) ? 120 / 30 : 0); // (waits for the ground ahead, as the run does)
        const z0 = Math.floor(z / 8) * 8;
        const a = c.course.safePoint(z0);
        const b = c.course.safePoint(z0 + 8);
        const f = (z - z0) / 8;
        j.pos.set(a.x + (b.x - a.x) * f, a.y + (b.y - a.y) * f, z);
        j.vel.set(0, 0, 120);
        j.q.setFromAxisAngle(new T.Vector3(0, 1, 0), Math.PI);
        j.aimQ.copy(j.q);
        j.health = j.maxHealth;
      }
      g.vehicles.update(1 / 30);
      if (j && c.state === "flying") j.pos.z -= 120 / 30; // (its own step undone: the rails above move it)
      g.lasers.update(1 / 30);
      c.update(1 / 30, true);
    }
    const j = g.vehicles.active;
    log.push(`${s}s ${c.state} z ${j ? Math.round(j.pos.z) : "-"} v ${j ? Math.round(j.vel.length()) : "-"} ${c.crashWhy ?? ""} | ` + c.bots.list.map((b) => `${b.role[0]} dz ${Math.round(b.pos.z - (j?.pos.z ?? 0))} dx ${Math.round(b.pos.x - (j?.pos.x ?? 0))} v ${Math.round(b.vel.length())}${b.avoidT > 0 ? " AVOID" : ""}`).join(", "));
    await new Promise((r) => requestAnimationFrame(r));
  }
  const crashed = traces.filter((b) => !b.alive).map((b) => ({ role: b.role, why: b.crashWhy, tail: b.trace.slice(-40).filter((_, i) => i % 2 === 0) }));
  return { log, downs, bolts, info: c.info().bots, crashed };
}, Number(args.secs || 30));
console.log(out.log.join("\n"));
console.log("downs", JSON.stringify(out.downs, null, 0));
for (const t of out.crashed) console.log(t.role, t.why, "\n  " + t.tail.map((r) => r.join(" ")).join("\n  "));
console.log("bolts", out.bolts, JSON.stringify(out.info));
await browser.close();
server.close();
