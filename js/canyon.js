// The canyon run (Round 15): a single-player time trial in a jet, through a
// huge winding canyon (js/dim-canyon.js: the course, a dimension of its own).
//
// The page: ?canyon=<course id or seed>&jet=f22|f16 (js/menu-canyon.js sends
// it there from the main menu). Like a world, the page is built around it:
// main.js reads canyonParams() before anything is built, makes no save of
// any kind for it (the player's worlds are never touched: no "last world",
// no player save, no edits), goes straight into the canyon's dimension and
// hands the run over to this module (CanyonRun). "Main menu" takes the plain
// address back to the menu (the player's last world as it was).
//
// The run:
//   - the jet waits at the canyon's mouth while the course streams in, then
//     3, 2, 1, GO (frozen in the air, engine running);
//   - the clock starts at the start gate (a flying start) and stops at the
//     finish ring; checkpoint rings in between (a missed one: +5 s), splits
//     against the best run at every checkpoint, a ghost of the best run
//     flying alongside;
//   - hitting the rock (or being shot down) brings the jet back at the last
//     checkpoint (below) or ends the run: the explosion, a look at the
//     wreck, then the results; leaving the course (over the rim, off the
//     line through a valley or space) for more than a few seconds too;
//   - the results: the time, rings, penalties, the medal (bronze, silver,
//     gold by the course's par times), a new record saved with its splits
//     and its ghost (per course and options, ufocombat_v1_canyon /
//     canyon_ghost_<id>); R flies again (any time), N the next course, M
//     back to the menu;
//   - The Gauntlet's AA guns on the rim fire tracers at the jet; the cannon
//     and missile blasts destroy them.
// (Round 16) The run's options (the canyon screen, js/menu-canyon.js; in
// the address: diff, biome, open, bots, crash): the difficulty (how wide
// and winding: Easy .. Insane), the scenery (a biome, a mix of them, or a
// random one), open stretches (a valley, space), enemy jets (js/canyon-bots.js:
// they fly the canyon and fight; kills counted, the jet's damage shown) and
// what a crash does: by default the jet comes back at the last checkpoint
// passed (the clock runs on: a crash costs the time it takes), or the run
// is over (the results, R from the mouth). No ring speeds the jet up any
// more (Round 15's boost rings are gone). The sky follows the scenery under
// the jet, and goes black with stars out in space.
// Streaming: the course runs along +z, so the chunks wanted are a corridor
// along the canyon ahead of the jet (stream(), handed to world.js as its
// plan instead of the distant-terrain system's), as wide as its walls, with
// the fog at its end.
import * as THREE from "three";
import { CANYON, CANYON_COURSES, courseOf, canyonSeed, BIOME_MIXED, BIOME_SPACE } from "./dim-canyon.js";
import { CANYON_BIOMES, BIOME_ORDER, BIOME_SKY, CANYON_DIFFS, DIFF_ORDER, OPEN_ORDER } from "./canyon-biomes.js";
import { CanyonBots, BOT_LEVELS } from "./canyon-bots.js";
import { CanyonFar } from "./canyon-far.js";
import { loadJSON, saveJSON, STORAGE_PREFIX } from "./storage.js";
import { createJetModel } from "./jet-model.js";
import { worldUniforms } from "./shaders.js";
import { LAYER_FX } from "./layers.js";
import { voice } from "./voice.js";

export { CANYON_COURSES };

const START_BACK = 240; // blocks before the start gate the jet waits
const AHEAD_ROWS = 36; // chunk rows streamed in full ahead of the jet (16 blocks each; Round 17: 22 before, the fog at 322 blocks)
const FAR_ROWS = 72; // (Round 17) ... and drawn as far terrain beyond them (js/canyon-far.js), the fog at its end
const BEHIND_ROWS = 3; // (Round 16: 6 with enemy jets, who fly behind the player too)
const CANYON_HAZE = 0.0015; // (Round 17) the haze's density (the main game's 0.0024): the far canyon stays clear
const SIDE_MARGIN = 10; // blocks beyond the walls' widest reach
const MISS_PENALTY = 5; // seconds per missed checkpoint
const OUT_LIMIT = 4; // seconds out of the course before the run is over
const CRASH_LOOK = 2.4; // seconds looking at the wreck before the results
const DOWN_LOOK = 1.5; // (Round 16) ... before the respawn's panel
const RESPAWN_AUTO = 2.5; // (Round 16) seconds on that panel before the jet comes back by itself
const RESPAWN_SHIELD = 3; // (Round 16) seconds after a respawn no shot hurts the jet
const RADAR_AHEAD = 620; // (Round 17) the course map: blocks ahead of the jet shown
const RADAR_BEHIND = 140; // ... and behind it
const GHOST_DT = 0.2; // seconds between two samples of the ghost
const GHOST_MAX = 3600; // samples (12 minutes)
const START_SPEED = { grand: 140, slot: 92, night: 125, gauntlet: 140 };
const TURRET_RANGE = 330;
const TURRET_HP = 40;
const TURRET_REFIRE = 1.7;
const COURSE_TIME = { golden: 2.88, dusk: 3.0, noon: 1.9, night: 4.6 }; // the sun's angle (sky.js: 0 sunrise, PI sunset)
const BOT_IDS = BOT_LEVELS.map((b) => b.id);

// ---------- The page's parameters and links ----------

// The run this page is for (from its address), or null: a normal page.
// (Round 16) Its options: diff (easy | normal | hard | insane), biome (a
// biome, "mixed", "random" or none: the course's own), open (none | some |
// lots), bots (none | few | some | many), crash (checkpoint | restart). The
// ones that shape the canyon go into the world's seed (canyonSeed): the
// chunk workers make the same canyon from it.
export function canyonParams(search = typeof window !== "undefined" ? window.location.search : "") {
  const p = new URLSearchParams(search);
  const c = p.get("canyon");
  if (c === null) return null;
  const fixed = CANYON_COURSES.find((x) => x.id === c);
  const base = fixed ? fixed.seed : /^\d{1,10}$/.test(c) ? (Number(c) >>> 0) & 0x1fffff : CANYON_COURSES[0].seed;
  const own = courseOf(base);
  const diff = DIFF_ORDER.includes(p.get("diff")) ? p.get("diff") : "normal";
  let biome = p.get("biome");
  if (biome === "random") biome = BIOME_ORDER[Math.floor(Math.random() * BIOME_ORDER.length)];
  // (Round 17: "space", the Space scenery, is a choice of its own: never Random's)
  if (!(BIOME_ORDER.includes(biome) || biome === BIOME_MIXED || biome === BIOME_SPACE) || biome === own.biome) biome = null;
  const open = OPEN_ORDER.includes(p.get("open")) && p.get("open") !== "some" ? p.get("open") : null;
  const bots = Math.max(0, BOT_IDS.indexOf(p.get("bots")));
  const seed = canyonSeed(base, { biome, diff, open });
  // (Round 17) rings: the rings to fly through (+5 s a miss): off by default.
  return { seed, course: courseOf(seed), jet: p.get("jet") === "f16" ? "f16" : "f22", bots, crash: p.get("crash") === "restart" ? "restart" : "checkpoint", rings: p.get("rings") === "on" };
}

// The address of a run (course: a course of CANYON_COURSES, or { seed }).
// (Round 16) opts: { diff, biome, open, bots, crash } (the defaults left out);
// (Round 17) rings ("on" / true: the rings are on).
export function canyonUrl(course, jet = "f22", opts = {}) {
  const u = new URL(window.location.href);
  u.search = "";
  u.hash = "";
  u.searchParams.set("canyon", course.id ?? String((course.courseSeed ?? course.seed) >>> 0));
  u.searchParams.set("jet", jet === "f16" ? "f16" : "f22");
  if (opts.diff && opts.diff !== "normal") u.searchParams.set("diff", opts.diff);
  if (opts.biome && opts.biome !== "default") u.searchParams.set("biome", opts.biome);
  if (opts.open && opts.open !== "some") u.searchParams.set("open", opts.open);
  const bots = typeof opts.bots === "number" ? BOT_IDS[opts.bots] : opts.bots;
  if (bots && bots !== "none") u.searchParams.set("bots", bots);
  if (opts.crash === "restart") u.searchParams.set("crash", "restart");
  if (opts.rings === "on" || opts.rings === true) u.searchParams.set("rings", "on");
  return u.toString();
}

// Back to the main menu (the plain address: the last world played, as it was).
export function menuUrl() {
  const u = new URL(window.location.href);
  u.search = "";
  u.hash = "";
  return u.toString();
}

// (Round 17) Edits of the canyon's dimension left in storage (storage.js
// edits_<seed>_canyon: never written by the run, which saves nothing, but
// cleared all the same so no hole ever comes back). The count removed.
export function clearSavedCanyonEdits() {
  try {
    const head = `${STORAGE_PREFIX}edits_`;
    const tail = `_${CANYON}`;
    const gone = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.startsWith(head) && k.endsWith(tail)) gone.push(k);
    }
    for (const k of gone) localStorage.removeItem(k);
    return gone.length;
  } catch {
    return 0;
  }
}

// ---------- Records ----------

// Best times per course: { [id]: { best, splits: [s...], rings, missed, medal, jet, runs, finished } }.
export function loadRecords() {
  const r = loadJSON("canyon");
  return r && typeof r === "object" ? r : {};
}

function saveRecords(rec) {
  return saveJSON("canyon", rec);
}

// (Round 16) A course's record key: its id with the default options (as in
// Round 15), else the id and the options (another difficulty, scenery, open
// stretches or enemy jets is another race: its own best time and ghost).
export function recordId(spec, bots = 0) {
  if (!spec?.id) return null;
  return spec.opts || bots ? `${spec.id}~${spec.opts}~${bots}` : spec.id;
}

// The par times (seconds): gold, silver and bronze, from the course's length.
// (Round 16: at the difficulty's pace; a little more with enemy jets about.)
export function medalTimes(course, bots = 0) {
  const pace = ({ grand: 158, slot: 96, night: 140, gauntlet: 148 }[course.kind] || 140) * (CANYON_DIFFS[course.diff]?.pace ?? 1);
  const gold = Math.round((course.length / pace) * (bots ? 1.08 : 1));
  return { gold, silver: Math.round(gold * 1.15), bronze: Math.round(gold * 1.35) };
}

export function medalFor(course, time, bots = 0) {
  if (!Number.isFinite(time)) return null;
  const m = medalTimes(course, bots);
  return time <= m.gold ? "gold" : time <= m.silver ? "silver" : time <= m.bronze ? "bronze" : null;
}

export function formatTime(t, plus = false) {
  if (!Number.isFinite(t)) return "--:--.--";
  const sign = t < 0 ? "-" : plus ? "+" : "";
  t = Math.abs(t);
  const m = Math.floor(t / 60);
  const s = t - m * 60;
  return m > 0 ? `${sign}${m}:${s < 10 ? "0" : ""}${s.toFixed(2)}` : `${sign}${s.toFixed(2)}`;
}

// The ghost of a course's best run (a separate key: the records stay small).
function ghostKey(course, bots = 0) {
  return `canyon_ghost_${recordId(course, bots) ?? course.seed}`;
}

// (Round 16) The run's options in words (the HUD, the results).
export function optionsLabel(spec, bots = 0) {
  const parts = [CANYON_DIFFS[spec.diff]?.name || "Normal", spec.space ? "Space" : spec.biome === BIOME_MIXED ? "Mixed scenery" : CANYON_BIOMES[spec.biome]?.name || ""];
  if (spec.open === "none") parts.push("no open stretches");
  else if (spec.open === "lots") parts.push("lots of open stretches");
  if (bots) parts.push(`${BOT_LEVELS[bots].name.toLowerCase()} enemy jets`);
  return parts.filter(Boolean).join(" · ");
}

// ---------- The run ----------

const _v = new THREE.Vector3();
const _w = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _dir = new THREE.Vector3();
const _c = new THREE.Color();
function smooth(a, b, x) {
  const t = x <= a ? 0 : x >= b ? 1 : (x - a) / (b - a);
  return t * t * (3 - 2 * t);
}

export class CanyonRun {
  // game: main.js's game object; params: canyonParams(); hooks: { enter() (into
  // the game, "Click to fly"), leave() (back to the menu) }.
  constructor(game, params, hooks = {}) {
    this.game = game;
    this.params = params;
    this.hooks = hooks;
    this.world = game.world;
    this.vehicles = game.vehicles;
    this.spec = params.course;
    this.jetType = params.jet;
    this.botLevel = params.bots || 0;
    this.crashMode = params.crash === "restart" ? "restart" : "checkpoint";
    // (Round 17) The rings (off by default): off, the checkpoints are still
    // there (the respawn's, the splits) but not drawn, and a miss costs nothing.
    this.ringsOn = !!params.rings;
    // (Round 17) How far ahead the canyon is streamed in full (chunk rows)
    // and how far it is drawn at all (the far terrain beyond: the fog ends
    // there). ?view=<rows> (the far end) and ?near=<rows> for tests.
    const q = typeof window !== "undefined" ? new URLSearchParams(window.location.search) : new URLSearchParams();
    const rows = (k, def) => {
      const n = Number(q.get(k));
      return q.has(k) && Number.isFinite(n) && n >= 8 ? Math.min(120, Math.round(n)) : def;
    };
    this.farRows = rows("view", FAR_ROWS);
    this.aheadRows = Math.min(this.farRows, rows("near", AHEAD_ROWS));
    this.far = null;
    this.diff = CANYON_DIFFS[this.spec.diff] || CANYON_DIFFS.normal;
    this.active = false;
    this.state = "idle"; // loading | countdown | flying | crashed | down (Round 16: the respawn's panel) | finished | out
    this.jet = null;
    this.records = loadRecords();
    this.recId = recordId(this.spec, this.botLevel);
    this.record = this.recId ? this.records[this.recId] || null : null;
    this.ghostData = this.recId ? loadJSON(ghostKey(this.spec, this.botLevel)) : null;
    this.stats = { restarts: 0, crashes: 0, finishes: 0, ringsPassed: 0, plans: 0, respawns: 0 };
    this._planKey = null;
    this._plan = null;
    this.waitForGround = true; // (tests that move the jet about turn it off)
    this.respawns = 0;
    this.shieldT = 0;
    this.bots = null;
  }

  // Into the canyon: the dimension, the sky, the rings, the HUD, the hooks,
  // the jet at the mouth. Called once, as the page starts (main.js).
  init() {
    const g = this.game;
    const dims = this.world.dims;
    if (dims?.enterNow) dims.enterNow(CANYON);
    else this.world.setDimension?.(CANYON);
    this.world.chunksHidden = false;
    // (Round 17) A fresh canyon: no edit kept from before (none is ever
    // saved for it; any an older build left in storage goes too).
    clearSavedCanyonEdits();
    this._resetEdits();
    this.course = this.world.terrainOf(CANYON).course;
    this.length = this.course.length;
    this.rings = this.course.rings().map((r) => ({ ...r, state: "ahead", t: 0, mesh: null }));
    this.checks = this.rings; // (Round 16: all of them: no boost rings)
    this.medals = medalTimes(this.spec, this.botLevel);
    this.active = true;
    document.body.classList.add("canyon-mode");
    // The sky: a fixed hour (the course's), clouds, the sun's shadows down the walls.
    const sky = g.sky;
    if (sky) {
      sky.locked = true;
      sky.setSunAngle(COURSE_TIME[this.spec.time] ?? COURSE_TIME.golden);
      // (Round 16) ...tinted by the scenery under the jet, black in space
      // (after any other hook of the sky's: space's own, js/space-sky.js).
      const prev = sky.post;
      sky.post = (s, e, dt) => {
        prev?.(s, e, dt);
        if (this.active) this._skyPost(s);
      };
    }
    // (Round 16) The enemy jets (none unless picked); the game's own patrols never fly here.
    this.bots = new CanyonBots(this, this.botLevel, this.spec.diff);
    // (its manager would take our bandits for its patrols, and clear them)
    if (g.enemyJets) g.enemyJets.update = () => {};
    this.behindRows = this.botLevel ? 6 : BEHIND_ROWS;
    // (Round 17) The far terrain past the streamed chunks (and in any row of them not drawn yet).
    this.far = new CanyonFar(g.scene, this.world, this.course);
    this._buildRings();
    this._buildTurrets();
    this._buildGhost();
    this._buildHud();
    this._hook();
    // The pause menu: "Fly again", and the way out says what it does.
    const menuBtn = document.getElementById("main-menu-btn");
    if (menuBtn) menuBtn.textContent = "Leave the canyon";
    const resume = document.getElementById("resume-btn");
    if (resume && !document.getElementById("canyon-again-btn")) {
      const again = document.createElement("button");
      again.className = "btn big";
      again.id = "canyon-again-btn";
      again.textContent = "Restart the course (R)";
      again.addEventListener("click", () => this.restart());
      resume.after(again);
    }
    // The ground around the start, at once (the mouth: wide open, quick).
    const s = this._startPose();
    this.world.prepareArea(s.x, s.z, 2);
    this.stream(s.x, s.z);
    g.player.position.set(s.x, s.y, s.z);
    this._spawn();
  }

  // Into the game (after init: "Click to fly", in Creative: a pilot can't
  // be hurt but by the rock).
  start() {
    this.game.ui?.setModeShown?.("creative");
    this.hooks.enter?.();
    this.game.setMode?.("creative");
  }

  _startPose() {
    const z = -START_BACK;
    const row = this.course.row(z);
    return { x: row.xc, y: row.floor + 36, z, yaw: Math.PI };
  }

  // (Round 16) The jet's speed as it sets off (the difficulty's).
  get startSpeed() {
    return (START_SPEED[this.spec.kind] ?? 130) * (this.diff.speed ?? 1);
  }

  // ---------- Streaming ----------

  // The chunks around (x, z): a corridor along the canyon (world.js's plan).
  // False when the world is not in the canyon (the distant-terrain system's then).
  stream(x, z) {
    if (!this.active || this.world.dim !== CANYON) return false;
    const pcx = Math.floor(x / 16);
    const pcz = Math.floor(z / 16);
    const key = `${pcx},${pcz}`;
    let replanned = false;
    if (key !== this._planKey) {
      this._planKey = key;
      this._plan = this._corridor(pcx, pcz);
      this.stats.plans++;
      replanned = true;
    }
    this.world.ensureChunksAround(x, z, this._plan);
    if (replanned) this._prioritise(pcx, pcz);
    return true;
  }

  // (Round 17) The far terrain (js/canyon-far.js): every row from just ahead
  // of the camera to the far end, but the ones whose chunks are drawn (the
  // line's own chunk and its neighbours across the canyon).
  _updateFar() {
    const f = this.far;
    if (!f || this.world.dim !== CANYON) return;
    const z = this.game.camera.position.z;
    const pcz = Math.floor(z / 16);
    const w = this.world;
    const c = this.course;
    const limit = pcz + this.aheadRows;
    const drawn = (cz) => {
      if (cz > limit) return false;
      const xc = c.row(cz * 16 + 8).xc;
      const cx = Math.floor(xc / 16);
      for (const dx of [-1, 0, 1]) if (!w.getChunk(cx + dx, cz)?.meshed) return false;
      return true;
    };
    f.update(pcz, pcz + 1, pcz + this.farRows, drawn, 4);
  }

  // (Round 17) The world's queues in the run's order: the course's line
  // ahead first, row by row (the chunks off to the sides of a far row after
  // the line's own), what is behind the jet last. (world.js sorts them by
  // the distance round the jet: the plateau beside it came before the
  // canyon a few hundred blocks ahead.)
  _prioritise(pcx, pcz) {
    const w = this.world;
    const c = this.course;
    const lineX = new Map();
    const key = (cx, cz) => {
      const d = cz - pcz;
      let xc = lineX.get(cz);
      if (xc === undefined) lineX.set(cz, (xc = c.row(cz * 16 + 8).xc));
      const lat = Math.abs(cx * 16 + 8 - xc) / 16;
      const near = Math.abs(cx - pcx) <= 1 && Math.abs(d) <= 1 ? -100 : 0; // (the jet's own ground first of all)
      return near + (d < 0 ? -d * 4 : d) + Math.max(0, lat - 1.5) * 2.2;
    };
    if (w.genQueue.length > 1) {
      for (const e of w.genQueue) e._p = key(e.cx, e.cz);
      w.genQueue.sort((a, b) => a._p - b._p);
    }
    if (w.meshQueue.length > 1) {
      for (const ch of w.meshQueue) ch._cyP = key(ch.cx, ch.cz);
      w.meshQueue.sort((a, b) => a._cyP - b._cyP);
    }
  }

  _corridor(pcx, pcz) {
    const set = new Set();
    let reach = 1;
    const c = this.course;
    for (let cz = pcz - (this.behindRows ?? BEHIND_ROWS); cz <= pcz + this.aheadRows; cz++) {
      let lo = Infinity;
      let hi = -Infinity;
      let xc = 0;
      let wide = 0;
      for (let i = 0; i < 16; i += 5) {
        const r = c.row(cz * 16 + i);
        lo = Math.min(lo, r.xMin);
        hi = Math.max(hi, r.xMax);
        xc = r.xc;
        wide = Math.max(wide, r.W * r.sec + (r.valley > 0 ? 50 : 0));
      }
      const r = c.row(cz * 16 + 15);
      lo = Math.min(lo, r.xMin) - SIDE_MARGIN;
      hi = Math.max(hi, r.xMax) + SIDE_MARGIN;
      // (the mouth and the run-out are wide open: only so far each side;
      // Round 16: a valley's or space's too, round the course's line)
      // (Round 17: round the line's own x, not the jet's: far ahead the line
      // has wound a long way off to one side)
      lo = Math.max(lo, xc - 200, xc - wide - 60);
      hi = Math.min(hi, xc + 200, xc + wide + 60);
      for (let cx = Math.floor(lo / 16); cx <= Math.floor(hi / 16); cx++) {
        set.add(`${cx},${cz}`);
        reach = Math.max(reach, Math.ceil(Math.hypot(cx - pcx, cz - pcz)));
      }
    }
    return { id: `canyon:${pcx},${pcz}`, reach, meshed: (cx, cz) => set.has(`${cx},${cz}`) };
  }

  // Is the stretch ahead of the jet in (meshed)? (The countdown waits for it.)
  _readyAhead(z, rows = 8) {
    const c = this.course;
    for (let cz = Math.floor(z / 16); cz <= Math.floor(z / 16) + rows; cz++) {
      const r = c.row(cz * 16 + 8);
      const ch = this.world.getChunk(Math.floor(r.xc / 16), cz);
      if (!ch || !ch.meshed) return false;
    }
    return true;
  }

  // The ground half a second ahead of the jet is in (or not the run's to stream).
  _aheadIn(v) {
    const w = this.world;
    for (const k of [0.15, 0.5]) {
      const cx = Math.floor((v.pos.x + v.vel.x * k) / 16);
      const cz = Math.floor((v.pos.z + v.vel.z * k) / 16);
      if (!w.wantsMesh(cx, cz)) continue;
      const ch = w.getChunk(cx, cz);
      if (!ch || !ch.meshed) return false;
    }
    return true;
  }

  // ---------- The jet ----------

  // A new jet at a pose ({ x, y, z, yaw }: yaw about +y, PI flies along +z),
  // the player in its seat; the old one (or its wreck) gone.
  _makeJet(pose, speed) {
    const mgr = this.vehicles;
    if (this.jet) {
      const old = this.jet;
      this.jet = null;
      if (mgr.vehicles.includes(old)) mgr.remove(old);
    }
    const v = mgr.create("jet", { jetType: this.jetType, pos: [pose.x, pose.y, pose.z], yaw: pose.yaw, airborne: true, speed, throttle: 0.72 });
    if (!v) return null;
    v.transient = true; // (never saved)
    v.keep = true;
    v.canyon = true;
    v.throttle = 0.72;
    // (Round 16) Just back at a checkpoint: a moment no shot hurts it (the rock still does).
    const hurt = v.damage.bind(v);
    v.damage = (amount, cause, byPlayer) => ((this.shieldT > 0 || this.state === "countdown" || this.state === "loading") && cause !== "crash" ? false : hurt(amount, cause, byPlayer));
    // (Round 17) A light touch of the rock is a scrape, not a crash (vehicle-jet.js's hook).
    v.onGraze = (hits, pts, dt) => this._graze(v, hits, pts, dt);
    this.jet = v;
    this._start = { pos: v.pos.clone(), q: v.q.clone(), vel: v.vel.clone() };
    // (Back in the seat, not boarded anew: no "jets flown" for every try.)
    mgr.restoring = true;
    try {
      mgr.enter(v);
    } finally {
      mgr.restoring = false;
    }
    this.game.player.position.copy(v.pos);
    this._lastPos = v.pos.clone();
    return v;
  }

  // (Round 17) Every block the run changed (the holes blasted and crashed
  // into the walls) back as the course made it: the edits forgotten, and
  // the chunks they were in (and their neighbours, whose meshes and light
  // saw them) dropped, to stream in again from the generator. A respawn at
  // a checkpoint keeps them (the same run); a restart or a new run doesn't.
  _resetEdits() {
    const w = this.world;
    if (w.dim !== CANYON) return 0;
    const keys = [...w.edits.keys()];
    w.edits.clear();
    w.dirtyEditChunks?.clear();
    w.lodDirty?.clear();
    w._scratch?.clear?.();
    w._heightCache?.clear?.();
    if (!keys.length) return 0;
    const drop = new Set();
    for (const k of keys) {
      const [cx, cz] = k.split(",").map(Number);
      if (!Number.isFinite(cx) || !Number.isFinite(cz)) continue;
      for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) drop.add(w.key(cx + dx, cz + dz));
    }
    let n = 0;
    for (const nk of drop) {
      const ch = w.chunks.get(nk);
      if (!ch) continue;
      w.scene.remove(ch.group);
      ch.dispose();
      w.chunks.delete(nk);
      w.remeshQueue.delete(ch);
      w.editRemeshQueue.delete(ch);
      w.meshQueued.delete(ch);
      n++;
    }
    w.meshQueue = w.meshQueue.filter((ch) => w.chunks.get(w.key(ch.cx, ch.cz)) === ch);
    // (the next stream() plans afresh: the dropped chunks are wanted again)
    w._planCx = w._planCz = w._planId = null;
    this._planKey = null;
    this.stats.editResets = (this.stats.editResets || 0) + 1;
    return n;
  }

  _spawn() {
    // (Round 17) A new run (the first, a restart): the canyon as the course made it.
    this._resetEdits();
    const v = this._makeJet(this._startPose(), this.startSpeed);
    if (!v) return;
    // The run's own state.
    this.state = "loading";
    this.t = 0; // since GO (the ghost's clock)
    this.clock = null; // the official time: since the start gate
    this.penalty = 0;
    this.missed = 0;
    this.passed = 0;
    this.nextCheck = 0;
    this.splits = [];
    this.countT = 0;
    this.outT = 0;
    this.resultT = 0;
    this.crashAt = null;
    this.ghostRec = [];
    this._ghostAcc = GHOST_DT;
    this._wait = null;
    this._resume = false;
    this._streak = 0;
    this.respawns = 0;
    this.shieldT = 0;
    this.final = null;
    this.ghostOff = false;
    for (const r of this.rings) {
      r.state = "ahead";
      r.t = 0;
    }
    this.checks[0] && (this.checks[0].state = "next");
    for (const t of this.turrets) this._resetTurret(t);
    this.bots?.reset();
    this._hideResults();
    this._banner("", 0);
    this._warn("");
  }

  // (Round 16) Back at the last checkpoint passed (or missed) after a crash:
  // a new jet in the ring, along the canyon, at the starting speed, a short
  // countdown (the clock runs on), a moment's shield; the bandits near it
  // gone. Before the start gate there is none: the run starts again.
  respawn() {
    if (!this.active) return;
    const ring = this.checks[this.nextCheck - 1];
    if (!ring || this.clock === null || this.state === "finished") return this.restart();
    const v = this._makeJet({ x: ring.x, y: ring.y, z: ring.z, yaw: Math.PI + ring.yaw }, this.startSpeed);
    if (!v) return;
    this.respawns++;
    this.stats.respawns++;
    this.state = "countdown";
    this._resume = true;
    this.countT = 1; // (2, 1, GO)
    this._lastCount = 0;
    this.outT = 0;
    this.crashAt = null;
    this._wait = null;
    this.ghostOff = true; // (the ghost no longer flies alongside: it would be off by the time lost)
    this.bots?.clearNear(v.pos);
    this._hideResults();
    this._warn("");
    this._banner(ring.kind === "start" ? "START" : `CHECKPOINT ${ring.i}`, 1, "good");
    if (this.game.gameState !== "playing") this.game.requestLock?.();
  }

  // Holds the jet at the start, engine running (loading, the countdown).
  _hold(pose = this._start, keepAim = false) {
    const v = this.jet;
    if (!v || !v.alive) return;
    v.pos.copy(pose.pos);
    v.q.copy(pose.q);
    v.vel.copy(pose.vel);
    if (!keepAim) v.aimQ?.copy(v.q);
    v.angVel?.set(0, 0, 0);
    v.root.position.copy(v.pos);
    v.root.quaternion.copy(v.q);
    if (this.vehicles.active === v) {
      v.seatPosition(this.game.player.position);
      v.updateCamera(this.game.camera, 0);
    }
  }

  // R: fly again from the mouth.
  restart() {
    if (!this.active) return;
    this.stats.restarts++;
    // (a run that got going and didn't finish counts as one flown)
    if (this.clock !== null && this.state !== "finished") this._countRun();
    this._spawn();
    if (this.game.gameState !== "playing") this.game.requestLock?.();
  }

  // ---------- The frame ----------

  // Every frame (main.js simulate, after everything else). running: the
  // world is running (not paused, not compiling shaders).
  update(dt, running) {
    if (!this.active) return;
    const g = this.game;
    this._fog();
    this._updateFar();
    this._updateRings(dt, running);
    if (!running) {
      this._hud(0);
      // (The results are their own menu: no pause menu over them.)
      if (this._resultsShown && g.gameState === "paused") g.ui?.hidePauseMenu?.();
      return;
    }
    const v = this.jet;
    // (Round 16) The clock runs on while the jet is down and comes back.
    if (this.clock !== null && (this.state === "crashed" || this.state === "down" || (this.state === "countdown" && this._resume))) this.clock += dt;
    switch (this.state) {
      case "loading":
        this._hold();
        if (this._readyAhead(-START_BACK, 10) && g.gameState === "playing") {
          this.state = "countdown";
          this.countT = 0;
          this._lastCount = 0;
        } else this._banner("Loading the canyon...", 0.3, "info");
        break;
      case "countdown": {
        this._hold();
        // (back at a checkpoint: the ground there may still be coming in)
        if (this._resume && this.waitForGround && !this._readyAhead(this._start.pos.z, 4)) {
          this._banner("Loading the canyon...", 0.3, "info");
          break;
        }
        this.countT += dt;
        const n = Math.ceil(3 - this.countT);
        if (n !== this._lastCount && n > 0) {
          this._lastCount = n;
          this._banner(String(n), 0.9, "count");
          this._tone([440], 0.18, 0.12);
        }
        if (this.countT >= 3) {
          this.state = "flying";
          this._banner("GO!", 1.2, "go");
          this._tone([880], 0.4, 0.15);
          if (this._resume) this.shieldT = RESPAWN_SHIELD;
          else voice.say("canyon_go", { text: "Go!" });
          this._resume = false;
        }
        break;
      }
      case "flying":
        if (!v || !v.alive) break;
        // (A slow computer: the canyon ahead isn't in yet. The jet waits
        // where it was, the clock stopped, rather than fly into rock not
        // there yet.)
        if (this.waitForGround && !this._aheadIn(v)) {
          if (!this._wait) this._wait = { pos: this._lastPos.clone(), q: v.q.clone(), vel: v.vel.clone() };
          this._hold(this._wait, true);
          this.stats.waits = (this.stats.waits || 0) + 1;
          this._banner("Loading the canyon...", 0.3, "info");
          break;
        }
        this._wait = null;
        this.t += dt;
        if (this.clock !== null) this.clock += dt;
        if (this.shieldT > 0) this.shieldT -= dt;
        this._record(dt);
        if (this._rockUnloaded(v)) break;
        this._checkRings(v);
        this._checkOut(dt, v);
        this._sections(v);
        break;
      case "crashed":
        this.resultT += dt;
        this._crashCam(dt);
        if (this.crashMode === "checkpoint" && this.resultT >= DOWN_LOOK && this.clock !== null) this._down(this.crashCause);
        else if (this.resultT >= CRASH_LOOK && !this._resultsShown) {
          if (this.clock === null && this.crashMode === "checkpoint") this.restart(); // (before the start gate: from the mouth again)
          else this._showResults("crashed");
        }
        break;
      case "down":
        this.resultT += dt;
        this.downT += dt;
        if (this.jet?.alive) this._hold(this._downPose, true);
        else this._crashCam(dt);
        this._downTick();
        if (this.downT >= RESPAWN_AUTO) this.respawn();
        break;
      case "finished":
      case "out":
        this.resultT += dt;
        break;
    }
    // (No hand or body in view at the wreck: the camera is the run's.)
    if (!this.vehicles.active && (this.state === "crashed" || this.state === "down" || this.state === "finished" || this.state === "out") && this.game.held) {
      this.game.held.visible = false;
      if (this.game.held.pivot) this.game.held.pivot.visible = false;
    }
    this._updateTurrets(dt);
    this.bots?.update(dt);
    this._updateGhost();
    if (this.jet) this._lastPos.copy(this.jet.pos);
    this._hud(dt);
  }

  // (Round 17) Some tolerance on the rock (vehicle-jet.js's onGraze hook).
  // (Round 17, jets track: the scrape itself is the jet's own now, Jet.graze,
  // the same in the whole game: a wingtip, the tail or the belly, shallow
  // and slow into the rock, scrapes with sparks and no bounce; the nose, the
  // fuselage, a steep angle or a fast hit is a crash, as before.) Here only
  // while the run is flying. True: taken as a scrape.
  _graze(v, hits, pts, dt) {
    if (!this.active || v !== this.jet || !v.alive || this.state !== "flying") return false;
    const ok = v.graze(hits, pts, dt);
    this.lastGraze = v.lastGraze; // (tests)
    if (ok) this.stats.grazes = (this.stats.grazes || 0) + 1;
    return ok;
  }

  // (Round 16) The rock where the world hasn't loaded the ground yet (a
  // jump ahead, a test): the course's own shape stops the jet as the
  // blocks would.
  _rockUnloaded(v) {
    if (this.world.getChunk(Math.floor(v.pos.x) >> 4, Math.floor(v.pos.z) >> 4)) return false;
    const c = this.course;
    const f = v.forward(_v);
    const r = v.right(_w);
    const p = v.pos;
    for (const [a, b] of [[7, 0], [0, 6], [0, -6]]) {
      if (c.solidAt(p.x + f.x * a + r.x * b, p.y + f.y * a + r.y * b, p.z + f.z * a + r.z * b)) {
        v.crashWhy = "the rock (ground not loaded yet)";
        v._crash("crash");
        return true;
      }
    }
    return false;
  }

  // (Round 16) A banner as the jet enters a valley, space, another scenery.
  _sections(v) {
    const c = this.course;
    const z = v.pos.z;
    const o = c.openAt(z, -20);
    const key = o ? `${o.kind}${o.i}` : null;
    if (key !== this._openKey) {
      if (o) this._banner(o.kind === "space" ? "INTO SPACE" : "OPEN VALLEY", 1.4, "info");
      else if (this._openKey) this._banner("BACK INTO THE CANYON", 1.2, "info");
      this._openKey = key;
    }
    const b = c.biomeAt(z);
    const id = b.t > 0.5 ? b.b : b.a;
    if (this._biome && id !== this._biome && !o) this._banner(CANYON_BIOMES[id].name.toUpperCase(), 1.4, "info");
    this._biome = id;
  }

  // The fog ends where the corridor does (the course's own sky otherwise).
  // (Round 17: much further out, with a lighter haze, and the camera's far
  // plane past it: the canyon ahead is in view in time to react.)
  _fog() {
    const end = this.farRows * 16 - 40;
    const fog = worldUniforms.uFog.value;
    if (fog.y !== end) {
      fog.set(end * 0.62, end, Math.min(fog.z, CANYON_HAZE), fog.w);
      const sf = this.game.scene?.fog;
      if (sf) {
        sf.near = end * 0.62;
        sf.far = end;
      }
    }
    const cam = this.game.camera;
    if (cam && cam.far < end + 160) {
      cam.far = end + 160;
      cam.updateProjectionMatrix();
    }
  }

  // (Round 16) The sky over the jet: its scenery's tint (blended across a
  // change of biome), and space's black and stars (sky.js post hook, after
  // the hour's colours are worked out). The haze from the view's fog base.
  _skyPost(sky) {
    const u = worldUniforms;
    const m = sky.material.uniforms;
    const z = this.game.camera.position.z;
    const c = this.course;
    const b = c.biomeAt(z);
    const A = BIOME_SKY[b.a];
    const B = BIOME_SKY[b.b];
    const t = b.t;
    const mix = (key, i, def = 1) => (A ? A[key][i] : def) * (1 - t) + (B ? B[key][i] : def) * t;
    const desat = (A?.desat ?? 0) * (1 - t) + (B?.desat ?? 0) * t;
    const tint = (col, key) => {
      if (desat > 0) {
        const l = col.r * 0.3 + col.g * 0.59 + col.b * 0.11;
        col.setRGB(col.r + (l - col.r) * desat, col.g + (l - col.g) * desat, col.b + (l - col.b) * desat);
      }
      col.setRGB(col.r * mix(key, 0), col.g * mix(key, 1), col.b * mix(key, 2));
    };
    if (A || B) {
      tint(u.uSkyZenith.value, "zen");
      tint(u.uSkyHorizon.value, "hor");
      tint(u.uLightColor.value, "light");
      tint(u.uAmbientSky.value, "amb");
      tint(u.uAmbientGround.value, "amb");
    }
    let haze = (A?.haze ?? 1) * (1 - t) + (B?.haze ?? 1) * t;
    // Space: the canyon's sky fades to black, the stars come out, no clouds, no air.
    const o = c.openAt(z, 90);
    const sp = o && o.kind === "space" ? smooth(o.z0 - 90, o.z0 + 30, z) * (1 - smooth(o.z1 - 30, o.z1 + 90, z)) : 0;
    this.spaceK = sp;
    if (sp > 0) {
      u.uSkyZenith.value.multiplyScalar(1 - 0.995 * sp);
      u.uSkyHorizon.value.lerp(_c.setRGB(0.004, 0.005, 0.012), sp);
      u.uSkyGlow.value.multiplyScalar(1 - sp);
      u.uNight.value = Math.max(u.uNight.value, sp);
      m.uCloudCoverage.value *= 1 - sp;
      u.uAmbientSky.value.multiplyScalar(1 - 0.5 * sp);
      haze *= 1 - sp;
    }
    sky.sunLight.color.copy(u.uLightColor.value);
    sky.hemiLight.color.copy(u.uAmbientSky.value);
    sky.hemiLight.groundColor.copy(u.uAmbientGround.value);
    sky.horizonColor.copy(u.uSkyHorizon.value);
    const fog = u.uFog.value;
    const base = sky._fogBase;
    if (base && haze !== 1) {
      fog.z = base.z * haze;
      sky._fogSet?.copy(fog);
    }
    this._planet(sp);
  }

  // (Round 16) A ringed planet hanging in space's sky.
  _planet(k) {
    const scene = this.game.scene;
    if (k <= 0.02) {
      if (this._planetG) this._planetG.visible = false;
      return;
    }
    if (!this._planetG) {
      const g = new THREE.Group();
      const ball = new THREE.Mesh(new THREE.SphereGeometry(60, 32, 16), new THREE.MeshBasicMaterial({ color: new THREE.Color(0.55, 0.36, 0.62), fog: false, transparent: true, depthWrite: false }));
      const ring = new THREE.Mesh(new THREE.RingGeometry(78, 118, 64), new THREE.MeshBasicMaterial({ color: new THREE.Color(0.7, 0.6, 0.48), side: THREE.DoubleSide, fog: false, transparent: true, opacity: 0.55, depthWrite: false }));
      ring.rotation.x = Math.PI / 2 - 0.35;
      ring.rotation.y = 0.2;
      // (the lit side and the night side: a darker shell offset from the sun)
      const shade = new THREE.Mesh(new THREE.SphereGeometry(60.5, 32, 16, 0, Math.PI), new THREE.MeshBasicMaterial({ color: 0x000000, fog: false, transparent: true, opacity: 0.55, depthWrite: false }));
      shade.rotation.y = -0.6;
      g.add(ball, shade, ring);
      g.renderOrder = -1;
      for (const o of [ball, shade, ring]) {
        o.renderOrder = -1;
        o.frustumCulled = false;
      }
      scene.add(g);
      this._planetG = g;
    }
    const g = this._planetG;
    g.visible = true;
    const cam = this.game.camera;
    const d = Math.min(800, (cam.far || 1000) * 0.8);
    g.position.copy(cam.position).add(_v.set(-0.55, 0.32, 0.77).normalize().multiplyScalar(d));
    g.scale.setScalar(d / 800);
    for (const o of g.children) o.material.opacity = (o.geometry.type === "RingGeometry" ? 0.55 : o.material.color.r === 0 ? 0.55 : 1) * k;
  }

  // ---------- Rings ----------

  _checkRings(v) {
    const a = this._lastPos;
    const b = v.pos;
    // The start gate starts the clock (passed or not: a flying start).
    const ring = this.checks[this.nextCheck];
    if (ring) {
      const cross = this._cross(ring, a, b);
      if (cross) {
        // (Round 17: rings off, crossing the checkpoint's line anywhere is passing it)
        const hit = cross.dist <= ring.r || !this.ringsOn;
        if (ring.kind === "start") {
          this.clock = 0;
          ring.state = "passed";
          ring.t = 0;
          this._banner("START", 1, "go");
          this._tone([660, 990], 0.25, 0.12);
        } else if (hit) {
          ring.state = "passed";
          ring.t = 0;
          this.passed++;
          this.stats.ringsPassed++;
          this._streak++;
          this._split(ring);
          this._tone([700 + Math.min(8, this._streak) * 60, 1050 + Math.min(8, this._streak) * 90], 0.3, 0.1);
        } else {
          ring.state = "missed";
          ring.t = 0;
          this.missed++;
          this.penalty += MISS_PENALTY;
          this._streak = 0;
          this._banner(`MISSED  +${MISS_PENALTY} s`, 1.4, "bad");
          this._tone([220, 160], 0.35, 0.14, "sawtooth");
          this.splits.push(this.clock + this.penalty);
        }
        if (ring.kind === "finish") return this._finish();
        this.nextCheck++;
        const nx = this.checks[this.nextCheck];
        if (nx) nx.state = "next";
      }
    }
    // (Round 16: no boost rings: a ring never changes the jet's speed.)
  }

  // Where the jet's step a -> b crosses the ring's plane: { dist (from its
  // middle), frac }, or null if it doesn't cross it this frame.
  _cross(r, a, b) {
    const s = Math.sin(r.yaw);
    const c = Math.cos(r.yaw);
    const da = (a.x - r.x) * s + (a.z - r.z) * c;
    const db = (b.x - r.x) * s + (b.z - r.z) * c;
    if (!(da < 0 && db >= 0)) return null;
    const f = da / (da - db);
    const px = a.x + (b.x - a.x) * f - r.x;
    const py = a.y + (b.y - a.y) * f - r.y;
    const pz = a.z + (b.z - a.z) * f - r.z;
    return { dist: Math.hypot(px, py, pz), frac: f };
  }

  // A checkpoint's split, against the best run's at the same ring.
  _split(ring) {
    const t = this.clock + this.penalty;
    const i = this.splits.length;
    this.splits.push(t);
    const best = this.record?.splits?.[i];
    const last = this.checks.length - 2 === this.nextCheck;
    if (Number.isFinite(best)) {
      const d = t - best;
      this._banner(`${formatTime(d, true)}`, 1.2, d <= 0 ? "ahead" : "behind");
    } else this._banner(last ? "FINAL CHECKPOINT" : "CHECKPOINT", 0.9, "good");
    if (last) voice.say("canyon_final", { text: "Final checkpoint!" });
  }

  _finish() {
    const v = this.jet;
    this.state = "finished";
    this.resultT = 0;
    this.stats.finishes++;
    this.final = this.clock + this.penalty;
    this._tone([523, 659, 784, 1046], 0.5, 0.12);
    this._banner("FINISH!", 2, "go");
    const prev = this.record?.best;
    const better = !Number.isFinite(prev) || this.final < prev;
    const id = this.recId;
    this.newRecord = better && !!id;
    if (id) {
      const rec = this.records[id] || { runs: 0 };
      rec.runs = (rec.runs || 0) + 1;
      rec.finished = (rec.finished || 0) + 1;
      if (better) {
        Object.assign(rec, { best: Math.round(this.final * 1000) / 1000, splits: this.splits.map((s) => Math.round(s * 1000) / 1000), rings: this.passed, missed: this.missed, respawns: this.respawns, kills: this.bots?.kills ?? 0, jet: this.jetType, medal: medalFor(this.spec, this.final, this.botLevel), date: Date.now() });
        // (The ghost: the run flown to the finish ring; not one with a respawn in it, a jump.)
        this._sample(v, true);
        if (this.ghostRec.length > 4 && !this.respawns) {
          const ghost = { dt: GHOST_DT, jet: this.jetType, data: this.ghostRec };
          if (saveJSON(ghostKey(this.spec, this.botLevel), ghost)) this.ghostData = ghost;
        }
      }
      this.records[id] = rec;
      saveRecords(this.records);
      this.record = rec;
    }
    if (this.newRecord) voice.say("canyon_record", { text: "New record!" });
    setTimeout(() => this.state === "finished" && this._showResults("finished"), 900);
  }

  // Out of the course for too long: the run is over (or, Round 16, back at
  // the last checkpoint).
  _fail(why) {
    if (this.state !== "flying") return;
    if (this.crashMode === "checkpoint" && this.clock !== null) {
      this.crashAt = null;
      this._downPose = { pos: this.jet.pos.clone(), q: this.jet.q.clone(), vel: this.jet.vel.clone() };
      this._down(why);
      return;
    }
    this.state = "out";
    this.resultT = 0;
    this._countRun();
    this._showResults(why);
  }

  _countRun() {
    if (!this.recId) return;
    const rec = this.records[this.recId] || { runs: 0 };
    rec.runs = (rec.runs || 0) + 1;
    this.records[this.recId] = rec;
    saveRecords(this.records);
    this.record = rec;
  }

  // Out of the course: over the rim (Round 16: off the line through a
  // valley or space, or low in space): a few seconds to get back, then the
  // run is over.
  _checkOut(dt, v) {
    const r = this.course.row(Math.floor(v.pos.z));
    const inCourse = v.pos.z > -40 && v.pos.z < this.length + 40;
    const wide = Math.abs(v.pos.x - r.xc) > r.outX;
    const over = inCourse && (v.pos.y > r.outY || wide || (r.space && v.pos.y < 6));
    if (!over) {
      if (this.outT > 0) this._warn("");
      this.outT = 0;
      return;
    }
    this.outT += dt;
    const left = Math.ceil(OUT_LIMIT - this.outT);
    this._warn(`${r.valley > 0.3 || r.space ? "BACK ON COURSE!" : "BACK INTO THE CANYON!"} ${Math.max(0, left)}`);
    if (Math.floor(this.outT * 2) !== Math.floor((this.outT - dt) * 2)) this.game.audio?.playWarning?.();
    if (this.outT >= OUT_LIMIT) {
      this._warn("");
      this._fail("out");
    }
  }

  // The jet blew up (vehicles.onPilotKilled, hooked): the run is over, or
  // (Round 16) the jet comes back at the last checkpoint.
  _crashed(v) {
    if (v !== this.jet) return;
    this.stats.crashes++;
    const was = this.state;
    this.crashAt = { pos: v.pos.clone(), dir: v.vel.lengthSq() > 1 ? v.vel.clone().normalize() : v.forward(new THREE.Vector3()), yaw: 0 };
    this._warn("");
    if (was === "finished" || was === "out" || was === "down") return; // (after the results: nothing changes)
    this.state = "crashed";
    this.resultT = 0;
    this.crashCause = v.lastHitBy && v.lastHitBy !== "crash" ? "shot" : "crashed";
    this.crashWhy = v.crashWhy || v.lastHitBy || null;
    // (tests: the rock it met was drawn, not ground still streaming in)
    this.crashSeen = !!this.world.getChunk(Math.floor(v.pos.x / 16), Math.floor(v.pos.z / 16))?.meshed;
    if (this.crashMode === "restart" || this.clock === null) this._countRun();
    this._banner(this.crashCause === "shot" ? "SHOT DOWN" : "CRASHED", 2, "bad");
  }

  // (Round 16) Down, the respawn's panel: back at the last checkpoint in a
  // moment (Enter at once), or R for the whole course from the mouth.
  _down(why) {
    this.state = "down";
    this.downT = 0;
    this.downWhy = why;
    this._warn("");
    const u = this.ui;
    if (!u) return;
    const ring = this.checks[this.nextCheck - 1];
    const title = why === "out" ? "OUT OF THE COURSE" : why === "shot" ? "SHOT DOWN" : "CRASHED";
    u.down.innerHTML = `
      <div class="cy-down-title">${title}</div>
      <div class="cy-down-sub">Back at ${ring?.kind === "start" ? "the start gate" : `checkpoint ${ring?.i ?? 1}`} in <b class="cy-down-n">${Math.ceil(RESPAWN_AUTO)}</b></div>
      <div class="cy-down-keys"><span><kbd>Enter</kbd> Respawn now</span><span><kbd>R</kbd> Restart the course</span><span><kbd>M</kbd> Main menu</span></div>`;
    u.down.classList.add("show");
    this._downN = null;
  }

  _downTick() {
    const n = Math.max(0, Math.ceil(RESPAWN_AUTO - this.downT));
    if (n === this._downN) return;
    this._downN = n;
    const el = this.ui?.down.querySelector(".cy-down-n");
    if (el) el.textContent = String(n);
  }

  _crashCam(dt) {
    const c = this.crashAt;
    if (!c) return;
    const cam = this.game.camera;
    const w = this.world;
    c.yaw += dt * 0.35;
    const side = _w.set(-c.dir.z, 0, c.dir.x).normalize();
    // (pulled back and up from the wreck, slowly round it, never into the rock)
    let back = 22 + Math.min(this.resultT, 3) * 4;
    for (let i = 0; i < 8; i++) {
      cam.position.copy(c.pos).addScaledVector(c.dir, -back * Math.cos(c.yaw)).addScaledVector(side, back * Math.sin(c.yaw));
      cam.position.y += 5 + back * 0.15;
      if (!w.isSolidAt(Math.floor(cam.position.x), Math.floor(cam.position.y), Math.floor(cam.position.z))) break;
      back *= 0.7;
    }
    cam.lookAt(c.pos);
    const p = this.game.player;
    p.position.copy(c.pos);
    p.velocity?.set(0, 0, 0);
  }

  // ---------- The ghost ----------

  _record(dt) {
    this._ghostAcc += dt;
    if (this._ghostAcc >= GHOST_DT) {
      this._ghostAcc -= GHOST_DT;
      this._sample(this.jet, false);
    }
  }

  _sample(v, last) {
    if (!v || this.ghostRec.length >= GHOST_MAX * 7) return;
    const r10 = (x) => Math.round(x * 10);
    const r1k = (x) => Math.round(x * 1000);
    if (last && this.ghostRec.length) {
      // (the finish: a last sample at its own time)
      this.ghostRec.push(r10(v.pos.x), r10(v.pos.y), r10(v.pos.z), r1k(v.q.x), r1k(v.q.y), r1k(v.q.z), r1k(v.q.w));
      return;
    }
    this.ghostRec.push(r10(v.pos.x), r10(v.pos.y), r10(v.pos.z), r1k(v.q.x), r1k(v.q.y), r1k(v.q.z), r1k(v.q.w));
  }

  _buildGhost() {
    const d = this.ghostData;
    this.ghost = null;
    if (!d || !Array.isArray(d.data) || d.data.length < 14) return;
    const model = createJetModel(1, { type: d.jet === "f16" ? "f16" : "f22" });
    const mat = new THREE.MeshBasicMaterial({ color: new THREE.Color(0.45, 1.6, 2.4), transparent: true, opacity: 0.32, depthWrite: false, blending: THREE.AdditiveBlending, fog: false });
    model.root.traverse((o) => {
      if (o.isMesh || o.isSprite || o.isPoints) {
        if (o.isMesh) o.material = mat;
        else o.visible = false;
      }
      o.layers.set(LAYER_FX);
    });
    model.root.visible = false;
    this.game.scene.add(model.root);
    this.ghost = { model, data: d.data, dt: d.dt || GHOST_DT };
  }

  _updateGhost() {
    const gh = this.ghost;
    if (!gh) return;
    const show = (this.state === "flying" || this.state === "countdown") && !this.ghostOff && this.game.settings?.canyonGhost !== false;
    const root = gh.model.root;
    const n = gh.data.length / 7;
    const t = this.state === "flying" ? this.t : 0;
    const f = t / gh.dt;
    const i = Math.min(n - 2, Math.floor(f));
    if (!show || f > n - 1) {
      root.visible = false;
      return;
    }
    const k = f - i;
    const D = gh.data;
    const a = i * 7;
    const b = a + 7;
    root.position.set((D[a] + (D[b] - D[a]) * k) / 10, (D[a + 1] + (D[b + 1] - D[a + 1]) * k) / 10, (D[a + 2] + (D[b + 2] - D[a + 2]) * k) / 10);
    _q.set(D[a + 3], D[a + 4], D[a + 5], D[a + 6]).normalize();
    root.quaternion.set(D[b + 3], D[b + 4], D[b + 5], D[b + 6]).normalize();
    root.quaternion.slerpQuaternions(_q, root.quaternion.clone(), k);
    // (not right on top of the player's own jet at the start)
    root.visible = this.jet ? root.position.distanceTo(this.jet.pos) > 9 : true;
  }

  // ---------- The rings' looks ----------

  _buildRings() {
    const group = (this._ringGroup = new THREE.Group());
    group.name = "canyon-rings";
    const geoms = new Map();
    const torus = (r, tube) => {
      const key = `${r.toFixed(1)}:${tube}`;
      if (!geoms.has(key)) geoms.set(key, new THREE.TorusGeometry(r, tube, 8, 56));
      return geoms.get(key);
    };
    this._ringMats = {
      next: new THREE.MeshBasicMaterial({ color: new THREE.Color(6, 3.6, 0.7), fog: false, toneMapped: false }),
      ahead: new THREE.MeshBasicMaterial({ color: new THREE.Color(0.5, 1.7, 2.6), fog: false, toneMapped: false }),
      start: new THREE.MeshBasicMaterial({ color: new THREE.Color(4, 4, 4), fog: false, toneMapped: false }),
      missed: new THREE.MeshBasicMaterial({ color: new THREE.Color(5, 0.4, 0.3), fog: false, transparent: true, toneMapped: false }),
      passed: new THREE.MeshBasicMaterial({ color: new THREE.Color(3, 3.4, 4), fog: false, transparent: true, toneMapped: false }),
    };
    this._haloMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(1, 0.7, 0.25), transparent: true, opacity: 0.18, blending: THREE.AdditiveBlending, depthWrite: false, fog: false, toneMapped: false });
    for (const r of this.rings) {
      const big = r.kind === "start" || r.kind === "finish";
      const m = new THREE.Mesh(torus(r.r, big ? 1.1 : 0.6), this._matFor(r));
      const halo = new THREE.Mesh(torus(r.r, big ? 2.8 : 1.8), this._haloMat);
      const holder = new THREE.Group();
      holder.add(m, halo);
      holder.position.set(r.x, r.y, r.z);
      holder.rotation.y = r.yaw;
      holder.visible = false;
      for (const o of [holder, m, halo]) o.layers.set(LAYER_FX);
      // (the finish: a checkered ring of tiles around it)
      if (big) {
        const tiles = new THREE.Group();
        const box = new THREE.BoxGeometry(1.6, 1.6, 1.6);
        const black = new THREE.MeshBasicMaterial({ color: 0x111111, fog: false });
        const white = new THREE.MeshBasicMaterial({ color: new THREE.Color(3, 3, 3), fog: false, toneMapped: false });
        const n = Math.round((r.r * Math.PI * 2) / 1.7);
        for (let i = 0; i < n; i++) {
          const a = (i / n) * Math.PI * 2;
          const t = new THREE.Mesh(box, i % 2 ? black : white);
          t.position.set(Math.cos(a) * (r.r + 2.4), Math.sin(a) * (r.r + 2.4), 0);
          t.rotation.z = a;
          t.layers.set(LAYER_FX);
          tiles.add(t);
        }
        tiles.layers.set(LAYER_FX);
        holder.add(tiles);
      }
      r.mesh = holder;
      r.core = m;
      r.halo = halo;
      group.add(holder);
    }
    group.layers.set(LAYER_FX);
    this.game.scene.add(group);
  }

  _matFor(r) {
    const M = this._ringMats;
    if (r.state === "missed") return M.missed;
    if (r.state === "passed") return M.passed;
    if (r.kind === "start" || r.kind === "finish") return r.state === "next" || r.kind === "start" ? M.start : M.ahead;
    return r.state === "next" ? M.next : M.ahead;
  }

  _updateRings(dt, running) {
    const cam = this.game.camera.position;
    const now = performance.now() / 1000;
    for (const r of this.rings) {
      const m = r.mesh;
      if (!m) continue;
      const d = r.z - cam.z;
      // (Round 17: rings off, only the start and finish gates are drawn)
      const near = d > -60 && d < this.farRows * 16 + 120 && (this.ringsOn || r.kind !== "check");
      if (r.state === "passed" || r.state === "missed" || r.state === "gone") {
        if (running) r.t += dt;
        const done = r.state === "gone" || r.t > 0.7;
        m.visible = near && !done;
        if (m.visible) {
          const k = r.t / 0.7;
          m.scale.setScalar(1 + k * 0.6);
          r.core.material = this._matFor(r);
          r.core.material.opacity = 1 - k;
          r.halo.visible = false;
        }
        continue;
      }
      m.visible = near;
      if (!near) continue;
      r.core.material = this._matFor(r);
      const next = r.state === "next";
      const pulse = next ? 1 + Math.sin(now * 6) * 0.06 : 1;
      m.scale.setScalar(pulse);
      r.halo.visible = next;
      m.rotation.z = 0;
    }
  }

  // ---------- The AA guns (The Gauntlet) ----------

  _buildTurrets() {
    this.turrets = [];
    const sites = this.course.turrets();
    if (!sites.length) return;
    const dark = new THREE.MeshLambertMaterial({ color: 0x3b4036 });
    const mid = new THREE.MeshLambertMaterial({ color: 0x5b6150 });
    const lamp = new THREE.MeshBasicMaterial({ color: new THREE.Color(4, 0.3, 0.2), toneMapped: false });
    const base = new THREE.CylinderGeometry(2.2, 2.8, 1.6, 10);
    const head = new THREE.BoxGeometry(2.6, 1.6, 2.8);
    const barrel = new THREE.CylinderGeometry(0.18, 0.22, 4.2, 6);
    barrel.rotateX(Math.PI / 2);
    barrel.translate(0, 0, -2.4);
    const light = new THREE.SphereGeometry(0.3, 6, 4);
    this._turretGroup = new THREE.Group();
    for (const s of sites) {
      const root = new THREE.Group();
      root.position.set(s.x + 0.5, s.y, s.z + 0.5);
      const b = new THREE.Mesh(base, dark);
      b.position.y = 0.8;
      const yawG = new THREE.Group();
      yawG.position.y = 2.2;
      const h = new THREE.Mesh(head, mid);
      const pitchG = new THREE.Group();
      for (const sx of [-0.55, 0.55]) {
        const br = new THREE.Mesh(barrel, dark);
        br.position.x = sx;
        pitchG.add(br);
      }
      const l = new THREE.Mesh(light, lamp);
      l.position.set(0, 1, 0.8);
      yawG.add(h, pitchG, l);
      root.add(b, yawG);
      this._turretGroup.add(root);
      this.turrets.push({ ...s, root, yawG, pitchG, lamp: l, hp: TURRET_HP, alive: true, cool: 1 + Math.random(), burst: 0, burstT: 0, los: false, losT: 0, pos: new THREE.Vector3(s.x + 0.5, s.y + 2.4, s.z + 0.5) });
    }
    this.game.scene.add(this._turretGroup);
  }

  _resetTurret(t) {
    t.hp = TURRET_HP;
    t.alive = true;
    t.cool = 1 + Math.random();
    t.burst = 0;
    t.root.visible = true;
    t.root.scale.setScalar(1);
    t.yawG.rotation.set(0, 0, 0);
    t.root.rotation.set(0, 0, 0);
  }

  _killTurret(t) {
    if (!t.alive) return;
    t.alive = false;
    const fx = this.game.effects;
    fx?.explode?.(t.pos.clone(), { radius: 3, source: "canyonaa", carve: false });
    // (knocked over, burnt out)
    t.root.rotation.z = 0.5;
    t.root.position.y -= 0.6;
    t.lamp.visible = false;
    this._banner("AA DOWN", 0.9, "good");
    voice.say("aa");
  }

  _updateTurrets(dt) {
    if (!this.turrets.length) return;
    const v = this.jet;
    const flying = this.state === "flying" && v && v.alive;
    const lasers = this.game.lasers;
    for (const t of this.turrets) {
      const d = v ? t.pos.distanceTo(v.pos) : Infinity;
      t.root.visible = Math.abs(t.z - this.game.camera.position.z) < this.farRows * 16;
      if (!t.alive || !flying || d > TURRET_RANGE || !t.root.visible) continue;
      // Aim with lead.
      const tof = d / 260;
      _v.copy(v.pos).addScaledVector(v.vel, tof).sub(t.pos);
      const yaw = Math.atan2(-_v.x, -_v.z);
      t.yawG.rotation.y = yaw;
      t.pitchG.rotation.x = Math.atan2(_v.y, Math.hypot(_v.x, _v.z));
      t.lamp.visible = Math.floor(performance.now() / 250) % 2 === 0;
      // (sees the jet: checked a few times a second)
      t.losT -= dt;
      if (t.losT <= 0) {
        t.losT = 0.3;
        const dir = _w.copy(v.pos).sub(t.pos);
        const len = dir.length();
        dir.normalize();
        const hit = this.world.raycast(t.pos.clone().addScaledVector(dir, 3), dir, len - 8, { solidOnly: true });
        t.los = !hit;
      }
      if (!t.los) continue;
      t.cool -= dt;
      if (t.cool <= 0 && t.burst <= 0) {
        t.burst = 4;
        t.burstT = 0;
        t.cool = TURRET_REFIRE + Math.random() * 0.8;
      }
      if (t.burst > 0) {
        t.burstT -= dt;
        if (t.burstT <= 0) {
          t.burst--;
          t.burstT = 0.09;
          const dir = _v.clone().normalize();
          dir.x += (Math.random() - 0.5) * 0.05;
          dir.y += (Math.random() - 0.5) * 0.05;
          dir.z += (Math.random() - 0.5) * 0.05;
          dir.normalize();
          lasers?.fire?.({ from: t.pos.clone().addScaledVector(dir, 4.5), dir, color: new THREE.Color(5, 2.2, 0.4), speed: 260, damage: 6, owner: "ufo", source: null, range: TURRET_RANGE + 60, radius: 0.12, length: 6, sound: false });
          if (t.burst === 3) this.game.audio?.playDistant?.(Math.min(320, d), () => this.game.audio.playCannon?.());
        }
      }
    }
  }

  // The jet's cannon (lasers.js) hits the guns, and blasts (missiles) near them.
  _turretHits() {
    const run = this;
    const lasers = this.game.lasers;
    if (lasers?.addProvider) {
      lasers.addProvider({
        ignores: (b) => b.owner === "ufo" || b.mirror,
        raycast(origin, dir, maxDist) {
          if (!run.active || !run.turrets.length) return null;
          let best = null;
          for (const t of run.turrets) {
            if (!t.alive) continue;
            const ox = origin.x - t.pos.x;
            const oy = origin.y - t.pos.y + 0.8;
            const oz = origin.z - t.pos.z;
            const b = ox * dir.x + oy * dir.y + oz * dir.z;
            const c = ox * ox + oy * oy + oz * oz - 3.2 * 3.2;
            const disc = b * b - c;
            if (disc < 0) continue;
            const s = -b - Math.sqrt(disc);
            if (s < 0 || s > maxDist) continue;
            if (!best || s < best.distance) best = { distance: s, t };
          }
          if (!best) return null;
          return {
            distance: best.distance,
            hit(bolt) {
              best.t.hp -= bolt.damage || 5;
              run.game.hud?.hitMarker?.();
              if (best.t.hp <= 0) run._killTurret(best.t);
            },
          };
        },
      });
    }
    const fx = this.game.effects;
    if (fx?.explode && !fx._canyonWrapped) {
      const explode = fx.explode.bind(fx);
      fx._canyonWrapped = true;
      fx.explode = (pos, opts = {}) => {
        const r = explode(pos, opts);
        if (run.active && opts.source !== "canyonaa" && pos) {
          const reach = (opts.radius ?? 3) * 1.8 + 3;
          for (const t of run.turrets) if (t.alive && t.pos.distanceTo(pos) < reach) run._killTurret(t);
        }
        return r;
      };
    }
  }

  // ---------- Hooks into the game ----------

  _hook() {
    const mgr = this.vehicles;
    const killed = mgr.onPilotKilled;
    mgr.onPilotKilled = (cause, v) => {
      if (this.active && v && v.canyon) return this._crashed(v);
      return killed?.(cause, v);
    };
    // (Round 16) The ground under a jet over a chunk not loaded yet: the
    // course's own shape below it, not the height map (the canyon's is the
    // plateau's top: a jet down in the canyon "landed" on it in mid-air and
    // broke up: the Round 15 crashes with "touchdown" after a jump ahead).
    const below = mgr.groundBelow.bind(mgr);
    mgr.groundBelow = (x, y, z) => {
      if (!this.active || this.world.dim !== CANYON || this.world.getChunk(Math.floor(x) >> 4, Math.floor(z) >> 4)) return below(x, y, z);
      const c = this.course;
      for (let by = Math.min(127, Math.floor(y)); by >= 0; by--) if (c.solidAt(x, by, z)) return by + 1;
      return 0;
    };
    // (No getting out: the run is in the jet.)
    const locked = mgr.exitLocked;
    mgr.exitLocked = () => (this.active ? "Canyon run: no getting out (R flies again)" : locked?.());
    this._turretHits();
    // Keys: R flies again; the results' N and M; (Round 16) the respawn's
    // Enter and M; the game's own keys that make no sense here (the
    // inventory, F7's dimensions, items) stay off.
    window.addEventListener(
      "keydown",
      (e) => {
        if (!this.active) return;
        const playing = this.game.gameState === "playing";
        if (e.code === "KeyR" && !e.repeat && (playing || this._resultsShown)) {
          e.preventDefault();
          e.stopImmediatePropagation();
          this.restart();
          return;
        }
        if (this.state === "down" && playing && !e.repeat) {
          if (e.code === "Enter" || e.code === "Space" || e.code === "NumpadEnter") {
            e.preventDefault();
            e.stopImmediatePropagation();
            this.respawn();
            return;
          }
          if (e.code === "KeyM") {
            e.stopImmediatePropagation();
            this.leave();
            return;
          }
        }
        if (this._resultsShown && !e.repeat) {
          if (e.code === "KeyN") {
            e.stopImmediatePropagation();
            this.next();
            return;
          }
          if (e.code === "KeyM") {
            e.stopImmediatePropagation();
            this.leave();
            return;
          }
          if (e.code === "Enter" || e.code === "Space") {
            e.preventDefault();
            e.stopImmediatePropagation();
            this.restart();
            return;
          }
        }
        if (playing && (BLOCKED_KEYS.has(e.code) || e.code.startsWith("Digit"))) {
          if (e.code === "F7") e.preventDefault();
          e.stopImmediatePropagation();
        }
      },
      true
    );
  }

  // (Round 16) The run's options, for the next course's address.
  get options() {
    const own = CANYON_COURSES.find((c) => c.id === this.spec.id);
    return { diff: this.spec.diff, biome: this.spec.space ? BIOME_SPACE : own && this.spec.biome === own.biome ? null : this.spec.biome, open: this.spec.open, bots: this.botLevel, crash: this.crashMode, rings: this.ringsOn };
  }

  next() {
    const i = CANYON_COURSES.findIndex((c) => c.id === this.spec.id);
    const nx = CANYON_COURSES[(i + 1) % CANYON_COURSES.length];
    // (the same options; a course's own scenery stays its own)
    const url = canyonUrl(nx, this.jetType, this.options);
    this.hooks.go ? this.hooks.go(url) : (window.location.href = url);
  }

  leave() {
    this.hooks.leave ? this.hooks.leave() : (window.location.href = menuUrl());
  }

  // (Round 16) A bandit shot down (js/canyon-bots.js).
  onBotKilled() {
    const k = this.bots.kills;
    this._banner(k > 1 ? `BANDIT DOWN  x${k}` : "BANDIT DOWN", 1.1, "good");
    this._tone([880, 1320], 0.25, 0.1);
    voice.say(`splash${Math.min(3, k)}`);
  }

  // ---------- Sounds ----------

  _tone(freqs, dur = 0.3, vol = 0.1, type = "triangle") {
    const a = this.game.audio;
    const ctx = a?.ctx;
    if (!ctx) return;
    a._cat?.("ui");
    const out = a._out || a.master;
    freqs.forEach((f, i) => {
      const t = ctx.currentTime + i * 0.07;
      const o = ctx.createOscillator();
      o.type = type;
      o.frequency.value = f;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(vol, t + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      o.connect(g).connect(out);
      o.start(t);
      o.stop(t + dur + 0.02);
    });
  }

  // ---------- The HUD ----------

  _buildHud() {
    injectStyle();
    const el = document.createElement("div");
    el.id = "canyon-hud";
    el.innerHTML = `
      <div class="cy-top">
        <div class="cy-course"></div>
        <div class="cy-opts"></div>
        <div class="cy-time">0.00</div>
        <div class="cy-sub"><span class="cy-rings"></span><span class="cy-pen"></span><span class="cy-best"></span><span class="cy-kills"></span></div>
        <div class="cy-speed"></div>
        <div class="cy-bar"><div class="cy-fill"></div><div class="cy-ghost"></div></div>
      </div>
      <div class="cy-hp"><span>ARMOR</span><div class="cy-hp-bar"><div class="cy-hp-fill"></div></div></div>
      <div class="cy-hit"></div>
      <div class="cy-marks"></div>
      <div class="cy-banner"></div>
      <div class="cy-warn"></div>
      <div class="cy-down"></div>
      <div class="cy-arrow">&#9650;</div>
      <canvas class="cy-radar" aria-label="Course map"></canvas>
      <div class="cy-keys">R: restart &nbsp; Esc: menu</div>`;
    document.body.appendChild(el);
    const res = document.createElement("div");
    res.id = "canyon-results";
    res.className = "hidden";
    document.body.appendChild(res);
    const q = (s) => el.querySelector(s);
    this.ui = { el, res, speed: q(".cy-speed"), course: q(".cy-course"), opts: q(".cy-opts"), time: q(".cy-time"), rings: q(".cy-rings"), pen: q(".cy-pen"), best: q(".cy-best"), kills: q(".cy-kills"), fill: q(".cy-fill"), ghost: q(".cy-ghost"), banner: q(".cy-banner"), warn: q(".cy-warn"), arrow: q(".cy-arrow"), hp: q(".cy-hp"), hpFill: q(".cy-hp-fill"), hit: q(".cy-hit"), marks: q(".cy-marks"), down: q(".cy-down"), radar: q(".cy-radar") };
    this._radarT = 0;
    this.ui.course.textContent = this.spec.name.toUpperCase();
    this.ui.opts.textContent = optionsLabel(this.spec, this.botLevel);
    this._bannerT = 0;
    this._hudT = 0;
    this._text = {};
    this._marks = [];
  }

  _set(key, el, text) {
    if (this._text[key] === text) return;
    this._text[key] = text;
    el.textContent = text;
  }

  _banner(text, dur, kind = "") {
    const b = this.ui?.banner;
    if (!b) return;
    b.textContent = text;
    b.className = `cy-banner ${kind} ${text ? "show" : ""}`;
    this._bannerT = dur;
  }

  _warn(text) {
    if (this.ui) this._set("warn", this.ui.warn, text);
  }

  _hud(dt) {
    const u = this.ui;
    if (!u) return;
    const g = this.game;
    const playing = g.gameState === "playing" || g.gameState === "paused";
    u.el.classList.toggle("hidden", !playing || this._resultsShown);
    if (this._bannerT > 0) {
      this._bannerT -= dt;
      if (this._bannerT <= 0) u.banner.classList.remove("show");
    }
    if (this.state !== "down" && u.down.classList.contains("show")) u.down.classList.remove("show");
    const t = this.state === "finished" ? this.final : this.clock !== null ? this.clock + this.penalty : 0;
    this._set("time", u.time, formatTime(t));
    const total = this.checks.length - 2;
    this._set("rings", u.rings, `${this.ringsOn ? "RINGS" : "CHECKPOINTS"} ${this.passed}/${Math.max(0, total)}`);
    this._set("pen", u.pen, this.penalty ? `+${this.penalty} s` : "");
    this._set("best", u.best, Number.isFinite(this.record?.best) ? `BEST ${formatTime(this.record.best)}` : "");
    this._set("kills", u.kills, this.bots?.count ? `KILLS ${this.bots.kills}` : "");
    const v = this.jet;
    const z = v ? v.pos.z : 0;
    if (v?.alive) this._set("speed", u.speed, `${Math.round(v.vel.length() * 3.6)} KM/H  ${v.afterburner ? "AB" : `${Math.round((v.throttle || 0) * 100)}%`}`);
    const frac = Math.max(0, Math.min(1, z / this.length));
    const pct = `${(frac * 100).toFixed(1)}%`;
    if (this._text.fill !== pct) {
      this._text.fill = pct;
      u.fill.style.width = pct;
    }
    const gr = this.ghost?.model.root;
    const gf = gr && this.state === "flying" && !this.ghostOff ? Math.max(0, Math.min(1, gr.position.z / this.length)) : -1;
    const gp = gf < 0 ? "none" : `${(gf * 100).toFixed(1)}%`;
    if (this._text.ghost !== gp) {
      this._text.ghost = gp;
      u.ghost.style.display = gf < 0 ? "none" : "block";
      if (gf >= 0) u.ghost.style.left = gp;
    }
    // (Round 16) The jet's armor (shown once it is hurt, or with enemies
    // about), a red flash on a hit, the shield after a respawn.
    const hpK = v?.alive ? v.health / v.maxHealth : 0;
    const hpS = `${Math.round(hpK * 100)}`;
    if (this._text.hp !== hpS) {
      if (v?.alive && this._lastHp !== undefined && hpK < this._lastHp - 0.001 && this._lastJet === v) {
        u.hit.classList.remove("on");
        void u.hit.offsetWidth;
        u.hit.classList.add("on");
      }
      this._text.hp = hpS;
      u.hpFill.style.width = `${hpK * 100}%`;
      u.hpFill.style.background = hpK > 0.6 ? "#7dff9a" : hpK > 0.3 ? "#ffd36b" : "#ff6d5e";
    }
    this._lastHp = hpK;
    this._lastJet = v;
    const showHp = !!v?.alive && (hpK < 0.999 || !!this.bots?.count || this.turrets.length > 0);
    if (this._text.hpOn !== showHp) {
      this._text.hpOn = showHp;
      u.hp.style.display = showHp ? "flex" : "none";
    }
    const shield = this.shieldT > 0 && this.state === "flying";
    if (this._text.shield !== shield) {
      this._text.shield = shield;
      u.hp.classList.toggle("shield", shield);
    }
    this._arrow();
    this._botMarks();
    this._radarT -= dt;
    if (this._radarT <= 0 && !u.el.classList.contains("hidden")) {
      this._radarT = 1 / 15;
      this._drawRadar();
    }
  }

  // (Round 17) The course map (bottom right; the aircraft radar's corner,
  // js/radar.js, which is hidden here): the canyon ahead seen from above,
  // the course up the map, the jet low in it. Its walls at the jet's height
  // (space: the course's edges), the fins, pillars and asteroids, the line,
  // the checkpoints (the next one yellow), the bandits (red, their heading)
  // and the jet (its heading); the next checkpoint's distance underneath.
  _drawRadar() {
    const cv = this.ui?.radar;
    const v = this.jet;
    if (!cv) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    if (!this._radarCss) this._radarCss = { w: cv.clientWidth || 170, h: cv.clientHeight || 240 };
    const W = Math.round(this._radarCss.w * dpr);
    const H = Math.round(this._radarCss.h * dpr);
    if (cv.width !== W || cv.height !== H) {
      cv.width = W;
      cv.height = H;
    }
    const ctx = cv.getContext("2d");
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, W, H);
    const pad = 4 * dpr;
    const rr = 12 * dpr;
    ctx.beginPath();
    ctx.roundRect ? ctx.roundRect(0, 0, W, H, rr) : ctx.rect(0, 0, W, H);
    ctx.fillStyle = "rgba(34,22,14,0.78)"; // (the rock)
    ctx.fill();
    ctx.save();
    ctx.clip();
    const c = this.course;
    const pos = v ? v.pos : this.game.camera.position;
    const AHEAD = RADAR_AHEAD;
    const BEHIND = RADAR_BEHIND;
    const s = (H - pad * 2) / (AHEAD + BEHIND); // px per block
    const cx = W / 2;
    const cy = pad + AHEAD * s;
    // (the course up the map: +z up; the jet's right, -x, to the right)
    const X = (x) => cx - (x - pos.x) * s;
    const Y = (z) => cy - (z - pos.z) * s;
    const z0 = Math.floor((pos.z - BEHIND) / 8) * 8;
    const z1 = pos.z + AHEAD;
    // The air: between the walls at the jet's height.
    const left = [];
    const right = [];
    const line = [];
    for (let z = z0; z <= z1 + 8; z += 8) {
      const r = c.row(z);
      let a;
      let b;
      if (r.space && Number.isFinite(r.outX)) {
        a = r.xc - (r.outX - 12);
        b = r.xc + (r.outX - 12);
      } else {
        const y = Math.max(r.floor + 3, Math.min(Math.floor(r.rim) - 1, Math.floor(pos.y)));
        a = r.L[y];
        b = r.R[y];
        if (r.valley > 0.3 && Number.isFinite(r.outX)) {
          a = Math.max(a, r.xc - r.outX);
          b = Math.min(b, r.xc + r.outX);
        }
      }
      left.push(X(a), Y(z));
      right.push(X(b), Y(z));
      line.push(X(r.xc), Y(z));
    }
    ctx.beginPath();
    ctx.moveTo(left[0], left[1]);
    for (let i = 2; i < left.length; i += 2) ctx.lineTo(left[i], left[i + 1]);
    for (let i = right.length - 2; i >= 0; i -= 2) ctx.lineTo(right[i], right[i + 1]);
    ctx.closePath();
    ctx.fillStyle = this.spaceK > 0.5 ? "rgba(20,26,60,0.85)" : "rgba(70,110,150,0.55)";
    ctx.fill();
    ctx.lineWidth = 1.5 * dpr;
    ctx.strokeStyle = "rgba(255,190,120,0.85)";
    for (const side of [left, right]) {
      ctx.beginPath();
      ctx.moveTo(side[0], side[1]);
      for (let i = 2; i < side.length; i += 2) ctx.lineTo(side[i], side[i + 1]);
      ctx.stroke();
    }
    // The course's line.
    ctx.setLineDash([4 * dpr, 4 * dpr]);
    ctx.lineWidth = 1 * dpr;
    ctx.strokeStyle = "rgba(255,255,255,0.35)";
    ctx.beginPath();
    ctx.moveTo(line[0], line[1]);
    for (let i = 2; i < line.length; i += 2) ctx.lineTo(line[i], line[i + 1]);
    ctx.stroke();
    ctx.setLineDash([]);
    // Rock in the way: fins, pillars, asteroids.
    ctx.fillStyle = "rgba(34,22,14,0.95)";
    for (let z = z0; z <= z1; z += 8) {
      const r = c.row(z);
      if (r.fin > 0.5) {
        const w = Math.max(1.5 * dpr, r.fin * r.sec * 2 * s);
        ctx.fillRect(X(r.xc) - w / 2, Y(z) - 4 * s, w, 8 * s + 1);
      }
    }
    const dots = (list, col, min) => {
      ctx.fillStyle = col;
      for (const p of list) {
        if (p.z < z0 - 20 || p.z > z1 + 20) continue;
        ctx.beginPath();
        ctx.arc(X(p.x), Y(p.z), Math.max(min * dpr, p.r * s), 0, Math.PI * 2);
        ctx.fill();
      }
    };
    dots(c.pillars || [], "rgba(34,22,14,0.95)", 1.2);
    if (this.spaceK > 0 || c.spec.space) dots((c.rocks || []).filter((r) => r.r > 5 && Math.abs(r.y - pos.y) < r.r + 10), "rgba(150,140,130,0.9)", 1);
    // The checkpoints: a bar across the course (the next one yellow).
    for (const r of this.checks) {
      if (r.z < z0 - 10 || r.z > z1 + 10) continue;
      const next = r === this.checks[this.nextCheck];
      const gate = r.kind !== "check";
      const half = Math.max(5 * dpr, (gate ? r.r : Math.max(r.r, 14)) * s);
      const ca = Math.cos(r.yaw);
      const sa = Math.sin(r.yaw);
      const px = X(r.x);
      const py = Y(r.z);
      // (across the course: the ring's own plane, turned with it)
      const dx = -ca * half;
      const dy = -sa * half;
      ctx.lineWidth = (next ? 3 : 2) * dpr;
      ctx.strokeStyle = r.state === "passed" || r.state === "missed" ? "rgba(255,255,255,0.25)" : next ? "#ffd23f" : gate ? "#ffffff" : "rgba(120,220,255,0.85)";
      ctx.beginPath();
      ctx.moveTo(px - dx, py + dy);
      ctx.lineTo(px + dx, py - dy);
      ctx.stroke();
    }
    // The bandits.
    const tri = (x, y, ang, size, fill) => {
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(ang);
      ctx.beginPath();
      ctx.moveTo(0, -size);
      ctx.lineTo(size * 0.7, size * 0.8);
      ctx.lineTo(0, size * 0.4);
      ctx.lineTo(-size * 0.7, size * 0.8);
      ctx.closePath();
      ctx.fillStyle = fill;
      ctx.fill();
      ctx.restore();
    };
    // (screen angle of a heading: forward +z is up, +x to the left)
    const angOf = (fx, fz) => Math.atan2(-fx, fz);
    for (const b of this.bots?.list ?? []) {
      if (!b.alive || b.pos.z < z0 - 10 || b.pos.z > z1 + 10) continue;
      const f = b.forward(_v);
      tri(X(b.pos.x), Y(b.pos.z), angOf(f.x, f.z), 5 * dpr, "#ff5a4a");
    }
    // The jet.
    if (v) {
      const f = v.forward(_v);
      tri(X(pos.x), Y(pos.z), angOf(f.x, f.z), 7 * dpr, v.alive ? "#7dffb0" : "#888");
    }
    ctx.restore();
    // The rim, and the next checkpoint's distance.
    ctx.lineWidth = 1 * dpr;
    ctx.strokeStyle = "rgba(255,200,140,0.35)";
    ctx.beginPath();
    ctx.roundRect ? ctx.roundRect(0.5, 0.5, W - 1, H - 1, rr) : ctx.rect(0.5, 0.5, W - 1, H - 1);
    ctx.stroke();
    const nx = this.checks[this.nextCheck];
    if (nx && v) {
      const d = Math.max(0, Math.round(nx.z - pos.z));
      ctx.font = `700 ${10 * dpr}px ui-monospace, Consolas, monospace`;
      ctx.fillStyle = "rgba(255,230,190,0.85)";
      ctx.textAlign = "center";
      ctx.fillText(`${nx.kind === "finish" ? "FINISH" : nx.kind === "start" ? "START" : `CP ${nx.i}`}  ${d} m`, W / 2, H - 6 * dpr);
    }
  }

  // An arrow at the edge of the screen toward the next ring, when it is off it.
  _arrow() {
    const a = this.ui.arrow;
    const r = this.checks[this.nextCheck];
    const cam = this.game.camera;
    let show = false;
    // (Round 17: rings off, no arrow to a checkpoint: the radar shows the way)
    if (r && (this.ringsOn || r.kind !== "check") && (this.state === "flying" || this.state === "countdown") && this.jet) {
      _v.set(r.x, r.y, r.z).project(cam);
      const behind = _w.set(r.x, r.y, r.z).sub(cam.position).dot(cam.getWorldDirection(_dir)) < 0;
      let x = _v.x;
      let y = _v.y;
      if (behind) {
        x = -x;
        y = -y;
      }
      const off = behind || Math.abs(x) > 0.92 || Math.abs(y) > 0.88;
      if (off) {
        const k = 0.86 / Math.max(Math.abs(x), Math.abs(y), 1e-3);
        x *= k;
        y *= k;
        const ang = Math.atan2(x, y);
        const key = `${x.toFixed(2)},${y.toFixed(2)}`;
        if (this._text.arrow !== key) {
          this._text.arrow = key;
          a.style.left = `${(x * 0.5 + 0.5) * 100}%`;
          a.style.top = `${(-y * 0.5 + 0.5) * 100}%`;
          a.style.transform = `translate(-50%, -50%) rotate(${ang}rad)`;
        }
        show = true;
      }
    }
    if (this._text.arrowOn !== show) {
      this._text.arrowOn = show;
      a.style.display = show ? "block" : "none";
    }
  }

  // (Round 16) A red marker on each bandit in view (its distance under it).
  _botMarks() {
    const list = this.bots?.list ?? [];
    const cam = this.game.camera;
    const fwd = cam.getWorldDirection(_dir);
    let n = 0;
    if (this.state === "flying" || this.state === "countdown") {
      for (const b of list) {
        if (!b.alive) continue;
        const d = _w.copy(b.pos).sub(cam.position);
        const dist = d.length();
        if (dist > 900 || d.dot(fwd) <= 0) continue;
        _v.copy(b.pos).project(cam);
        if (Math.abs(_v.x) > 1 || Math.abs(_v.y) > 1) continue;
        let m = this._marks[n];
        if (!m) {
          m = document.createElement("div");
          m.className = "cy-mark";
          m.innerHTML = "<i></i><span></span>";
          this.ui.marks.appendChild(m);
          this._marks.push(m);
        }
        m.style.display = "block";
        m.style.left = `${(_v.x * 0.5 + 0.5) * 100}%`;
        m.style.top = `${(-_v.y * 0.5 + 0.5) * 100}%`;
        const t = `${Math.round(dist)}`;
        if (m._t !== t) {
          m._t = t;
          m.lastChild.textContent = t;
        }
        n++;
      }
    }
    for (let i = n; i < this._marks.length; i++) if (this._marks[i].style.display !== "none") this._marks[i].style.display = "none";
  }

  // ---------- The results ----------

  _showResults(why) {
    const u = this.ui;
    if (!u) return;
    this._resultsShown = true;
    u.down.classList.remove("show");
    const done = why === "finished";
    const title = done ? (this.newRecord ? "NEW RECORD!" : "FINISHED") : why === "out" ? "OUT OF THE CANYON" : this.crashCause === "shot" ? "SHOT DOWN" : "CRASHED";
    const time = done ? this.final : null;
    const medal = done ? medalFor(this.spec, this.final, this.botLevel) : null;
    const M = this.medals;
    const best = this.record?.best;
    const total = this.checks.length - 2;
    const prog = this.jet ? Math.max(0, Math.min(1, (this.crashAt?.pos.z ?? this.jet.pos.z) / this.length)) : 0;
    const medalRow = (m, label) => `<div class="cy-m ${m} ${medal === m ? "got" : ""}"><i></i><b>${label}</b><span>${formatTime(M[m])}</span></div>`;
    const extra = [];
    if (this.respawns) extra.push(`<div><span>Respawns</span><b>${this.respawns}</b></div>`);
    if (this.bots?.count) extra.push(`<div><span>Kills</span><b>${this.bots.kills}</b></div>`);
    u.res.innerHTML = `
      <div class="cy-panel ${done ? "done" : "fail"}">
        <div class="cy-course-name">${this.spec.name}</div>
        <div class="cy-opts-name">${optionsLabel(this.spec, this.botLevel)}</div>
        <h2>${title}</h2>
        ${done ? `<div class="cy-big">${formatTime(time)}</div>` : `<div class="cy-big small">${Math.round(prog * 100)}% of the canyon</div>`}
        ${medal ? `<div class="cy-medal ${medal}">${medal.toUpperCase()} MEDAL</div>` : done ? `<div class="cy-medal none">No medal: beat ${formatTime(M.bronze)} for bronze</div>` : ""}
        <div class="cy-stats">
          <div><span>${this.ringsOn ? "Rings" : "Checkpoints"}</span><b>${this.passed}/${Math.max(0, total)}</b></div>
          ${this.ringsOn ? `<div><span>Missed</span><b>${this.missed}${this.penalty ? ` (+${this.penalty} s)` : ""}</b></div>` : ""}
          ${extra.join("")}
          <div><span>Best</span><b>${Number.isFinite(best) ? formatTime(best) : "none yet"}</b></div>
        </div>
        <div class="cy-medals">${medalRow("gold", "Gold")}${medalRow("silver", "Silver")}${medalRow("bronze", "Bronze")}</div>
        <div class="cy-buttons">
          <button class="btn big primary" data-cy="again">Fly again <kbd>R</kbd></button>
          <div class="button-pair">
            <button class="btn big" data-cy="next">Next course <kbd>N</kbd></button>
            <button class="btn big" data-cy="menu">Main menu <kbd>M</kbd></button>
          </div>
        </div>
      </div>`;
    u.res.classList.remove("hidden");
    u.res.querySelector('[data-cy="again"]').onclick = () => this.restart();
    u.res.querySelector('[data-cy="next"]').onclick = () => this.next();
    u.res.querySelector('[data-cy="menu"]').onclick = () => this.leave();
    this.game.audio?.playClick && this.game.audio.ensureStarted?.();
  }

  _hideResults() {
    this._resultsShown = false;
    this.ui?.res.classList.add("hidden");
    this.ui?.down.classList.remove("show");
  }

  // (Tests: the run's state.)
  info() {
    const j = this.jet;
    return { state: this.state, clock: this.clock, penalty: this.penalty, passed: this.passed, missed: this.missed, nextCheck: this.nextCheck, checks: this.checks.length, rings: this.rings.length, results: !!this._resultsShown, final: this.final ?? null, record: this.record, length: this.length, crashWhy: this.crashWhy ?? null, crashSeen: this.crashSeen ?? null, turrets: this.turrets.length, turretsAlive: this.turrets.filter((t) => t.alive).length, stats: this.stats, respawns: this.respawns, health: j?.alive ? j.health : 0, maxHealth: j?.maxHealth ?? 0, bots: this.bots ? { count: this.bots.count, alive: this.bots.list.filter((b) => b.alive).length, kills: this.bots.kills, spawned: this.bots.spawned, lost: this.bots.lost } : null, spec: { diff: this.spec.diff, biome: this.spec.biome, open: this.spec.open, space: !!this.spec.space }, space: this.spaceK ?? 0, ringsOn: this.ringsOn, aheadRows: this.aheadRows, farRows: this.farRows, far: this.far ? { ...this.far.stats } : null };
  }
}

const BLOCKED_KEYS = new Set(["KeyE", "KeyQ", "KeyF", "F7", "KeyT", "Slash"]);

// ---------- Styles ----------

let styled = false;
function injectStyle() {
  if (styled) return;
  styled = true;
  const s = document.createElement("style");
  s.textContent = `
  #canyon-hud { position: fixed; inset: 0; pointer-events: none; z-index: 9; font-family: var(--ui-font, sans-serif); color: #fff; }
  #canyon-hud.hidden { display: none; }
  body.hud-off #canyon-hud { display: none; }
  #canyon-hud .cy-top { position: absolute; top: 12px; left: 50%; transform: translateX(-50%); text-align: center; text-shadow: 0 2px 6px rgba(0,0,0,0.8); min-width: 280px; }
  #canyon-hud .cy-course { font: 800 11px var(--ui-font, sans-serif); letter-spacing: 4px; color: #ffcf8a; opacity: 0.9; }
  #canyon-hud .cy-time { font: 800 40px ui-monospace, "Cascadia Mono", Consolas, monospace; letter-spacing: 1px; line-height: 1.05; font-variant-numeric: tabular-nums; }
  #canyon-hud .cy-sub { display: flex; gap: 14px; justify-content: center; font: 700 12px ui-monospace, Consolas, monospace; letter-spacing: 1.5px; color: #d6e4f0; }
  #canyon-hud .cy-pen { color: #ff8a7a; }
  #canyon-hud .cy-best { color: #9fdcff; }
  #canyon-hud .cy-speed { font: 700 12px ui-monospace, Consolas, monospace; letter-spacing: 1.5px; color: #ffe2b8; margin-top: 2px; }
  #canyon-hud .cy-bar { position: relative; margin: 7px auto 0; width: 300px; height: 5px; border-radius: 3px; background: rgba(0,0,0,0.45); border: 1px solid rgba(255,255,255,0.25); }
  #canyon-hud .cy-fill { height: 100%; width: 0; border-radius: 3px; background: linear-gradient(90deg, #ff8a3d, #ffd36b); }
  #canyon-hud .cy-ghost { position: absolute; top: -3px; width: 3px; height: 11px; margin-left: -1px; background: #7fe4ff; box-shadow: 0 0 6px #7fe4ff; display: none; }
  #canyon-hud .cy-banner { position: absolute; top: 26%; left: 50%; transform: translate(-50%, -50%) scale(0.9); font: 900 34px var(--ui-font, sans-serif); letter-spacing: 3px; text-shadow: 0 3px 12px rgba(0,0,0,0.85); opacity: 0; transition: opacity 0.18s, transform 0.18s; white-space: nowrap; }
  #canyon-hud .cy-banner.show { opacity: 1; transform: translate(-50%, -50%) scale(1); }
  #canyon-hud .cy-banner.count { font-size: 96px; color: #ffd36b; top: 38%; }
  #canyon-hud .cy-banner.go { color: #8dff9a; font-size: 64px; top: 38%; }
  #canyon-hud .cy-banner.bad { color: #ff6d5e; }
  #canyon-hud .cy-banner.good { color: #ffe08a; font-size: 26px; }
  #canyon-hud .cy-banner.boost { color: #7dffb0; font-size: 30px; font-style: italic; }
  #canyon-hud .cy-banner.ahead { color: #6dff8e; font: 900 30px ui-monospace, Consolas, monospace; }
  #canyon-hud .cy-banner.behind { color: #ff7a6b; font: 900 30px ui-monospace, Consolas, monospace; }
  #canyon-hud .cy-banner.info { color: #d6e4f0; font-size: 20px; font-weight: 700; letter-spacing: 2px; }
  #canyon-hud .cy-warn { position: absolute; top: 34%; left: 50%; transform: translateX(-50%); font: 900 24px var(--ui-font, sans-serif); color: #ff5a4a; letter-spacing: 2px; text-shadow: 0 2px 10px #000; animation: cy-blink 0.5s steps(2) infinite; }
  #canyon-hud .cy-warn:empty { display: none; }
  @keyframes cy-blink { 50% { opacity: 0.35; } }
  #canyon-hud .cy-arrow { position: absolute; display: none; color: #ffd36b; font-size: 30px; text-shadow: 0 0 10px rgba(255,180,60,0.9), 0 2px 4px #000; }
  #canyon-hud .cy-keys { position: absolute; top: 14px; right: 18px; font: 700 11px var(--ui-font, sans-serif); letter-spacing: 1.5px; color: rgba(255,255,255,0.55); text-shadow: 0 1px 3px #000; }
  #canyon-hud .cy-opts { font: 600 10px var(--ui-font, sans-serif); letter-spacing: 1px; color: rgba(255,255,255,0.6); }
  #canyon-hud .cy-kills { color: #ff9a7a; }
  #canyon-hud .cy-hp { position: absolute; bottom: 26px; left: 50%; transform: translateX(-50%); display: none; align-items: center; gap: 8px; font: 800 10px var(--ui-font, sans-serif); letter-spacing: 2px; color: rgba(255,255,255,0.75); text-shadow: 0 1px 3px #000; }
  #canyon-hud .cy-hp-bar { width: 220px; height: 7px; border-radius: 4px; background: rgba(0,0,0,0.5); border: 1px solid rgba(255,255,255,0.3); overflow: hidden; }
  #canyon-hud .cy-hp-fill { height: 100%; width: 100%; background: #7dff9a; transition: width 0.15s; }
  #canyon-hud .cy-hp.shield .cy-hp-bar { border-color: #7fe4ff; box-shadow: 0 0 10px #7fe4ff; }
  #canyon-hud .cy-hit { position: absolute; inset: 0; opacity: 0; background: radial-gradient(ellipse at center, transparent 55%, rgba(255,30,10,0.55)); }
  #canyon-hud .cy-hit.on { animation: cy-hit 0.45s ease-out; }
  @keyframes cy-hit { 0% { opacity: 1; } 100% { opacity: 0; } }
  #canyon-hud .cy-mark { position: absolute; display: none; transform: translate(-50%, -50%); text-align: center; pointer-events: none; }
  #canyon-hud .cy-mark i { display: block; width: 14px; height: 14px; margin: 0 auto; border: 2px solid #ff5a4a; transform: rotate(45deg); box-shadow: 0 0 6px rgba(255,80,60,0.8); }
  #canyon-hud .cy-mark span { display: block; margin-top: 3px; font: 700 10px ui-monospace, Consolas, monospace; color: #ff9a8a; text-shadow: 0 1px 2px #000; }
  #canyon-hud .cy-down { position: absolute; top: 64%; left: 50%; transform: translate(-50%, -50%); display: none; text-align: center; padding: 16px 26px; border-radius: 14px; background: rgba(16,14,14,0.78); border: 1px solid rgba(255,110,90,0.45); box-shadow: 0 16px 50px rgba(0,0,0,0.55); }
  #canyon-hud .cy-down.show { display: block; }
  #canyon-hud .cy-down-title { font: 900 30px var(--ui-font, sans-serif); letter-spacing: 3px; color: #ff7a66; }
  #canyon-hud .cy-down-sub { margin: 4px 0 10px; font: 700 15px var(--ui-font, sans-serif); color: #e6edf3; }
  #canyon-hud .cy-down-sub b { color: #ffd36b; font-family: ui-monospace, Consolas, monospace; }
  #canyon-hud .cy-down-keys { display: flex; gap: 16px; justify-content: center; font: 600 12px var(--ui-font, sans-serif); color: rgba(255,255,255,0.75); }
  #canyon-hud .cy-down-keys kbd, #canyon-results kbd { font: 700 10px ui-monospace, Consolas, monospace; padding: 1px 5px; border-radius: 4px; background: rgba(0,0,0,0.3); border: 1px solid rgba(255,255,255,0.25); margin-right: 4px; }
  #canyon-results .cy-opts-name { font: 600 11px var(--ui-font, sans-serif); color: rgba(255,255,255,0.55); margin-top: 2px; }
  #canyon-results { position: fixed; inset: 0; z-index: 40; display: flex; align-items: center; justify-content: center; background: radial-gradient(ellipse at 50% 45%, rgba(10,8,6,0.35), rgba(4,4,6,0.75)); font-family: var(--ui-font, sans-serif); color: #fff; }
  #canyon-results.hidden { display: none; }
  #canyon-results .cy-panel { width: min(440px, 92vw); padding: 24px 28px; border-radius: 18px; background: rgba(16,14,14,0.86); border: 1px solid rgba(255,255,255,0.14); box-shadow: 0 24px 70px rgba(0,0,0,0.6); text-align: center; }
  #canyon-results .cy-panel.done { border-color: rgba(255,200,110,0.4); }
  #canyon-results .cy-panel.fail { border-color: rgba(255,110,90,0.4); }
  #canyon-results .cy-course-name { font: 800 11px var(--ui-font, sans-serif); letter-spacing: 4px; color: #ffcf8a; text-transform: uppercase; }
  #canyon-results h2 { font-size: 30px; margin: 6px 0 4px; letter-spacing: 2px; border: 0; padding: 0; }
  #canyon-results .fail h2 { color: #ff7a66; }
  #canyon-results .cy-big { font: 800 46px ui-monospace, Consolas, monospace; font-variant-numeric: tabular-nums; margin: 4px 0; }
  #canyon-results .cy-big.small { font-size: 22px; color: #d6e4f0; }
  #canyon-results .cy-medal { display: inline-block; margin: 6px 0 10px; padding: 5px 14px; border-radius: 20px; font: 900 13px var(--ui-font, sans-serif); letter-spacing: 3px; }
  #canyon-results .cy-medal.gold { background: linear-gradient(180deg, #ffe27a, #d9a520); color: #3a2800; }
  #canyon-results .cy-medal.silver { background: linear-gradient(180deg, #f2f5f8, #a9b4bf); color: #1f2730; }
  #canyon-results .cy-medal.bronze { background: linear-gradient(180deg, #f0b27a, #a8642c); color: #2b1505; }
  #canyon-results .cy-medal.none { background: rgba(255,255,255,0.08); color: #c9d3dc; letter-spacing: 1px; font-weight: 600; }
  #canyon-results .cy-stats { display: flex; justify-content: space-around; margin: 10px 0; padding: 10px 0; border-top: 1px solid rgba(255,255,255,0.1); border-bottom: 1px solid rgba(255,255,255,0.1); }
  #canyon-results .cy-stats span { display: block; font-size: 10px; letter-spacing: 2px; text-transform: uppercase; color: rgba(255,255,255,0.55); }
  #canyon-results .cy-stats b { font: 700 16px ui-monospace, Consolas, monospace; }
  #canyon-results .cy-medals { display: flex; gap: 8px; justify-content: center; margin: 10px 0 16px; }
  #canyon-results .cy-m { flex: 1; padding: 6px; border-radius: 10px; background: rgba(255,255,255,0.05); border: 1px solid rgba(255,255,255,0.08); opacity: 0.75; }
  #canyon-results .cy-m.got { opacity: 1; border-color: rgba(255,220,120,0.7); box-shadow: 0 0 14px rgba(255,200,90,0.25); }
  #canyon-results .cy-m i { display: block; width: 14px; height: 14px; border-radius: 50%; margin: 0 auto 3px; }
  #canyon-results .cy-m.gold i { background: #f2c641; } #canyon-results .cy-m.silver i { background: #cfd7df; } #canyon-results .cy-m.bronze i { background: #c27a3c; }
  #canyon-results .cy-m b { display: block; font-size: 11px; letter-spacing: 1.5px; text-transform: uppercase; }
  #canyon-results .cy-m span { font: 600 12px ui-monospace, Consolas, monospace; color: #d6e4f0; }
  #canyon-results .cy-buttons { display: flex; flex-direction: column; gap: 8px; }
  #canyon-results kbd { font: 700 10px ui-monospace, Consolas, monospace; padding: 1px 5px; border-radius: 4px; background: rgba(0,0,0,0.3); border: 1px solid rgba(255,255,255,0.25); margin-left: 6px; }
  body.canyon-mode #pause-callins, body.canyon-mode #pause-missions-btn, body.canyon-mode #pause-mp-btn, body.canyon-mode #copy-link-btn,
  body.canyon-mode #pause-mode-select, body.canyon-mode label[for="pause-mode-select"], body.canyon-mode #pause-mode-hint, body.canyon-mode #pause-seed,
  body.canyon-mode #hotbar, body.canyon-mode #crosshair-hint, body.canyon-mode #vehicle-hud, body.canyon-mode #mode-badge { display: none !important; }
  body.canyon-mode #radar { display: none !important; }
  #canyon-hud .cy-radar { position: absolute; right: 16px; bottom: 16px; width: min(170px, 24vh); height: min(240px, 34vh); border-radius: 12px; filter: drop-shadow(0 6px 18px rgba(0,0,0,0.5)); }
  `;
  document.head.appendChild(s);
}
