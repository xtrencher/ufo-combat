// Round 14 "look" tests (Node only, fast): creatures' ambient calls are
// rarer and quieter (the owner: "too loud and too frequent"), through the
// game's own mobs.js (_sounds, _voice) and audio.js (the gate, the gains),
// on a fake clock: a herd of 20 cows 10 blocks off calls at most 10 times a
// minute, a mixed farm at most twice in any 10 s, a lone cow
// now and then; an ambient call fades out over 16 blocks; hurt sounds keep
// their falloff; the creatures' bus plays at 60% of the slider. Lava's look
// is tested in r12-render-tests.mjs.
//
//   node r14-look-tests.mjs [--only=substring]
// (GAME_ROOT=dir runs another copy of the game.)
import path from "node:path";
import { register } from "node:module";
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
// (the game imports "three" through the page's import map: here, the tools' copy)
const three = pathToFileURL(path.join(__dirname, "node_modules", "three", "build", "three.module.js")).href;
register("data:text/javascript," + encodeURIComponent(`export async function resolve(s, c, n) { return s === "three" ? { url: ${JSON.stringify(three)}, shortCircuit: true } : n(s, c); }`));
const imp = (p) => import(pathToFileURL(path.join(ROOT, p)).href);
const A = await imp("js/audio.js");
const { MobManager, specOf } = await imp("js/mobs.js");

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

// `seconds` of the mobs' sound clocks (MobManager's own _sounds and _voice)
// for creatures [{ kind, dist }], on a fake clock; returns the calls heard
// as [{ t, kind }].
function simulate(herd, seconds, dt = 0.05) {
  let now = 0;
  const gate = new A.AmbientGate();
  const heard = [];
  const turn = (kind) => {
    const ok = gate.allow(kind, now);
    if (ok) heard.push({ t: now, kind });
    return ok;
  };
  const audio = {
    ctx: {},
    _cat() {},
    _voice() {},
    _hit() {},
    // (a kind without a voice of mobs.js's own: audio.js's, which takes its turn the same way)
    playMob: (kind, event) => A.AMBIENT_EVENTS.has(event) && turn(kind),
    creatureGain: A.creatureGain,
    ambientDelay: A.ambientDelay,
    ambientTurn: turn,
  };
  const fake = { audio, _audioDist: (m) => m.dist, _voice: MobManager.prototype._voice };
  const mobs = herd.map(({ kind, dist }) => ({ kind, dist, spec: { ...specOf(kind), vanilla: true }, soundTimer: 3 + Math.random() * 8 }));
  for (; now < seconds; now += dt) for (const m of mobs) MobManager.prototype._sounds.call(fake, m, dt);
  return heard;
}

await check("20 cows 10 blocks off: at most 10 calls a minute (vanilla's rate would be about 170), and some", async () => {
  const counts = [];
  for (let run = 0; run < 5; run++) counts.push(simulate(Array.from({ length: 20 }, () => ({ kind: "cow", dist: 10 })), 60).length);
  console.log(`        calls in 60 s: ${counts.join(", ")}`);
  assert(counts.every((n) => n >= 3 && n <= 10), `calls ${counts}`);
});

await check("a mixed farm (cows, sheep, pigs, chickens, 6 each, 4-12 blocks): at most 2 calls in any 10 s, none within 2 s", async () => {
  const herd = [];
  for (const kind of ["cow", "sheep", "pig", "chicken"]) for (let i = 0; i < 6; i++) herd.push({ kind, dist: 4 + ((i * 3) % 9) });
  const calls = simulate(herd, 120);
  console.log(`        ${calls.length} calls in 120 s (${[...new Set(calls.map((c) => c.kind))].join(", ")})`);
  assert(calls.length >= 8 && calls.length <= 40, `calls ${calls.length}`);
  for (let i = 0; i < calls.length; i++) {
    const within = calls.filter((c) => c.t >= calls[i].t && c.t < calls[i].t + 10).length;
    assert(within <= 2, `${within} calls in 10 s from ${calls[i].t.toFixed(1)}`);
    if (i) assert(calls[i].t - calls[i - 1].t >= 2 - 1e-9, `two calls ${(calls[i].t - calls[i - 1].t).toFixed(2)} s apart`);
  }
  const byKind = {};
  for (const c of calls) {
    if (byKind[c.kind] !== undefined) assert(c.t - byKind[c.kind] >= 6 - 1e-9, `${c.kind} again after ${(c.t - byKind[c.kind]).toFixed(1)} s`);
    byKind[c.kind] = c.t;
  }
});

await check("a lone cow 5 blocks off calls now and then (every 10-22 s); one 20 blocks off is never heard", async () => {
  let n = 0;
  for (let run = 0; run < 10; run++) n += simulate([{ kind: "cow", dist: 5 }], 120).length;
  console.log(`        a lone cow: ${(n / 10).toFixed(1)} calls in 2 minutes`);
  assert(n / 10 >= 4 && n / 10 <= 12, `${n / 10} calls`);
  assert(simulate([{ kind: "cow", dist: 20 }], 120).length === 0, "heard 20 blocks off");
});

await check("gains: an ambient call fades out over 16 blocks (well under the old 1/(1 + d/7)); hurt keeps it; the bus at 60%", async () => {
  const old = (d) => 1 / (1 + d / 7);
  for (const d of [1, 4, 8, 12]) assert(A.creatureGain("idle", d) < old(d) * 0.8, `idle at ${d}: ${A.creatureGain("idle", d)}`);
  assert(A.creatureGain("idle", 10) < old(10) * 0.5, "idle at 10");
  assert(A.creatureGain("idle", 16) === 0 && A.creatureGain("idle", 30) === 0, "idle beyond 16");
  assert(A.creatureGain("idle", 0) > 0.6, "idle up close");
  for (const ev of ["hurt", "death", "attack"]) for (const d of [0, 5, 20]) assert(Math.abs(A.creatureGain(ev, d) - old(d)) < 1e-9, `${ev} at ${d}`);
  assert(A.creatureGain("idle", 40, true) > 0, "a ghast is heard far");
  assert(A.CREATURE_LEVEL === 0.6, "the creatures' level");
  const a = new A.Audio();
  assert(a._busGain("creatures", 1) === 0.6 && a._busGain("creatures", 0.5) === 0.3 && a._busGain("blocks", 0.7) === 0.7, "bus gains follow the sliders");
  const d = [];
  for (let i = 0; i < 2000; i++) d.push(A.ambientDelay(false), A.ambientDelay(true));
  assert(d.every((x) => x >= 7 && x <= 22), "delays");
});

const failed = results.filter(([, ok]) => !ok);
console.log(`\n${results.length - failed.length} passed, ${failed.length} failed.`);
process.exit(failed.length ? 1 : 0);
