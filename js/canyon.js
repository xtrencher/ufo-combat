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
//     finish ring; checkpoint rings in between (a missed one: +5 s), boost
//     rings (a kick of speed), splits against the best run at every
//     checkpoint, a ghost of the best run flying alongside;
//   - hitting the rock (or being shot down) ends the run: the explosion, a
//     look at the wreck, then the results; climbing out of the canyon over
//     the rim for more than a few seconds ends it too;
//   - the results: the time, rings, penalties, the medal (bronze, silver,
//     gold by the course's par times), a new record saved with its splits
//     and its ghost (per course, ufocombat_v1_canyon / canyon_ghost_<id>);
//     R flies again (any time), N the next course, M back to the menu;
//   - The Gauntlet's AA guns on the rim fire tracers at the jet; the cannon
//     and missile blasts destroy them.
// Streaming: the course runs along +z, so the chunks wanted are a corridor
// along the canyon ahead of the jet (stream(), handed to world.js as its
// plan instead of the distant-terrain system's), as wide as its walls, with
// the fog at its end.
import * as THREE from "three";
import { CANYON, CANYON_COURSES, courseOf } from "./dim-canyon.js";
import { loadJSON, saveJSON } from "./storage.js";
import { createJetModel } from "./jet-model.js";
import { worldUniforms } from "./shaders.js";
import { LAYER_FX } from "./layers.js";
import { voice } from "./voice.js";

export { CANYON_COURSES };

const START_BACK = 240; // blocks before the start gate the jet waits
const AHEAD_ROWS = 22; // chunk rows streamed ahead of the jet (16 blocks each)
const BEHIND_ROWS = 3;
const SIDE_MARGIN = 10; // blocks beyond the walls' widest reach
const MISS_PENALTY = 5; // seconds per missed checkpoint
const OUT_LIMIT = 4; // seconds over the rim before the run is over
const OUT_MARGIN = 6; // blocks over the rim that count as out
const CRASH_LOOK = 2.4; // seconds looking at the wreck before the results
const GHOST_DT = 0.2; // seconds between two samples of the ghost
const GHOST_MAX = 3600; // samples (12 minutes)
const BOOST = 70; // blocks/s a boost ring adds
const START_SPEED = { grand: 140, slot: 92, night: 125, gauntlet: 140 };
const TURRET_RANGE = 330;
const TURRET_HP = 40;
const TURRET_REFIRE = 1.7;
const COURSE_TIME = { golden: 2.88, dusk: 3.0, noon: 1.9, night: 4.6 }; // the sun's angle (sky.js: 0 sunrise, PI sunset)

// ---------- The page's parameters and links ----------

// The run this page is for (from its address), or null: a normal page.
export function canyonParams(search = typeof window !== "undefined" ? window.location.search : "") {
  const p = new URLSearchParams(search);
  const c = p.get("canyon");
  if (c === null) return null;
  const fixed = CANYON_COURSES.find((x) => x.id === c);
  const seed = fixed ? fixed.seed : /^\d{1,10}$/.test(c) ? Number(c) >>> 0 : CANYON_COURSES[0].seed;
  return { seed, course: courseOf(seed), jet: p.get("jet") === "f16" ? "f16" : "f22" };
}

// The address of a run (course: a course of CANYON_COURSES, or { seed }).
export function canyonUrl(course, jet = "f22") {
  const u = new URL(window.location.href);
  u.search = "";
  u.hash = "";
  u.searchParams.set("canyon", course.id ?? String(course.seed >>> 0));
  u.searchParams.set("jet", jet === "f16" ? "f16" : "f22");
  return u.toString();
}

// Back to the main menu (the plain address: the last world played, as it was).
export function menuUrl() {
  const u = new URL(window.location.href);
  u.search = "";
  u.hash = "";
  return u.toString();
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

// The par times (seconds): gold, silver and bronze, from the course's length.
export function medalTimes(course) {
  const pace = { grand: 158, slot: 96, night: 140, gauntlet: 148 }[course.kind] || 140;
  const gold = Math.round(course.length / pace);
  return { gold, silver: Math.round(gold * 1.15), bronze: Math.round(gold * 1.35) };
}

export function medalFor(course, time) {
  if (!Number.isFinite(time)) return null;
  const m = medalTimes(course);
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
function ghostKey(course) {
  return `canyon_ghost_${course.id ?? course.seed}`;
}

// ---------- The run ----------

const _v = new THREE.Vector3();
const _w = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _dir = new THREE.Vector3();

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
    this.active = false;
    this.state = "idle"; // loading | countdown | flying | crashed | finished | out
    this.jet = null;
    this.records = loadRecords();
    this.record = this.spec.id ? this.records[this.spec.id] || null : null;
    this.ghostData = this.spec.id ? loadJSON(ghostKey(this.spec)) : null;
    this.stats = { restarts: 0, crashes: 0, finishes: 0, ringsPassed: 0, plans: 0 };
    this._planKey = null;
    this._plan = null;
  }

  // Into the canyon: the dimension, the sky, the rings, the HUD, the hooks,
  // the jet at the mouth. Called once, as the page starts (main.js).
  init() {
    const g = this.game;
    const dims = this.world.dims;
    if (dims?.enterNow) dims.enterNow(CANYON);
    else this.world.setDimension?.(CANYON);
    this.world.chunksHidden = false;
    this.course = this.world.terrainOf(CANYON).course;
    this.length = this.course.length;
    this.rings = this.course.rings().map((r) => ({ ...r, state: "ahead", t: 0, mesh: null }));
    this.checks = this.rings.filter((r) => r.kind !== "boost");
    this.boosts = this.rings.filter((r) => r.kind === "boost");
    this.medals = medalTimes(this.spec);
    this.active = true;
    document.body.classList.add("canyon-mode");
    // The sky: a fixed hour (the course's), clouds, the sun's shadows down the walls.
    const sky = g.sky;
    if (sky) {
      sky.locked = true;
      sky.setSunAngle(COURSE_TIME[this.spec.time] ?? COURSE_TIME.golden);
    }
    this._buildRings();
    this._buildTurrets();
    this._buildGhost();
    this._buildHud();
    this._hook();
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

  // ---------- Streaming ----------

  // The chunks around (x, z): a corridor along the canyon (world.js's plan).
  // False when the world is not in the canyon (the distant-terrain system's then).
  stream(x, z) {
    if (!this.active || this.world.dim !== CANYON) return false;
    const pcx = Math.floor(x / 16);
    const pcz = Math.floor(z / 16);
    const key = `${pcx},${pcz}`;
    if (key !== this._planKey) {
      this._planKey = key;
      this._plan = this._corridor(pcx, pcz);
      this.stats.plans++;
    }
    this.world.ensureChunksAround(x, z, this._plan);
    return true;
  }

  _corridor(pcx, pcz) {
    const set = new Set();
    let reach = 1;
    const c = this.course;
    for (let cz = pcz - BEHIND_ROWS; cz <= pcz + AHEAD_ROWS; cz++) {
      let lo = Infinity;
      let hi = -Infinity;
      for (let i = 0; i < 16; i += 5) {
        const r = c.row(cz * 16 + i);
        lo = Math.min(lo, r.xMin);
        hi = Math.max(hi, r.xMax);
      }
      const r = c.row(cz * 16 + 15);
      lo = Math.min(lo, r.xMin) - SIDE_MARGIN;
      hi = Math.max(hi, r.xMax) + SIDE_MARGIN;
      // (the mouth and the run-out are wide open: only so far each side)
      lo = Math.max(lo, pcx * 16 - 260);
      hi = Math.min(hi, pcx * 16 + 260);
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

  _spawn() {
    const mgr = this.vehicles;
    if (this.jet) {
      const old = this.jet;
      this.jet = null;
      if (mgr.vehicles.includes(old)) mgr.remove(old);
    }
    const s = this._startPose();
    const speed = START_SPEED[this.spec.kind] ?? 130;
    const v = mgr.create("jet", { jetType: this.jetType, pos: [s.x, s.y, s.z], yaw: s.yaw, airborne: true, speed, throttle: 0.72 });
    if (!v) return;
    v.transient = true; // (never saved)
    v.keep = true;
    v.canyon = true;
    v.throttle = 0.72;
    this.jet = v;
    this._start = { pos: v.pos.clone(), q: v.q.clone(), vel: v.vel.clone() };
    mgr.enter(v);
    const p = this.game.player;
    p.position.copy(v.pos);
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
    this._lastPos = v.pos.clone();
    this._boostT = 0;
    this._streak = 0;
    this._wait = null;
    for (const r of this.rings) {
      r.state = "ahead";
      r.t = 0;
    }
    this.checks[0] && (this.checks[0].state = "next");
    for (const t of this.turrets) this._resetTurret(t);
    this._hideResults();
    this._banner("", 0);
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
    this._updateRings(dt, running);
    if (!running) {
      this._hud(0);
      // (The results are their own menu: no pause menu over them.)
      if (this._resultsShown && g.gameState === "paused") g.ui?.hidePauseMenu?.();
      return;
    }
    const v = this.jet;
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
          voice.say("canyon_go", { text: "Go!" });
        }
        break;
      }
      case "flying":
        if (!v || !v.alive) break;
        // (A slow computer: the canyon ahead isn't in yet. The jet waits
        // where it was, the clock stopped, rather than fly into rock not
        // there yet.)
        if (!this._aheadIn(v)) {
          if (!this._wait) this._wait = { pos: this._lastPos.clone(), q: v.q.clone(), vel: v.vel.clone() };
          this._hold(this._wait, true);
          this.stats.waits = (this.stats.waits || 0) + 1;
          this._banner("Loading the canyon...", 0.3, "info");
          break;
        }
        this._wait = null;
        this.t += dt;
        if (this.clock !== null) this.clock += dt;
        this._record(dt);
        this._checkRings(v);
        this._checkOut(dt, v);
        if (this._boostT > 0) this._boostT -= dt;
        break;
      case "crashed":
        this.resultT += dt;
        this._crashCam(dt);
        if (this.resultT >= CRASH_LOOK && !this._resultsShown) this._showResults("crashed");
        break;
      case "finished":
      case "out":
        this.resultT += dt;
        break;
    }
    this._updateTurrets(dt);
    this._updateGhost();
    if (v) this._lastPos.copy(v.pos);
    this._hud(dt);
  }

  // The fog ends where the corridor does (the course's own sky otherwise).
  _fog() {
    const end = AHEAD_ROWS * 16 - 30;
    const fog = worldUniforms.uFog.value;
    if (fog.y !== end) {
      fog.set(end * 0.55, end, fog.z, fog.w);
      const sf = this.game.scene?.fog;
      if (sf) {
        sf.near = end * 0.55;
        sf.far = end;
      }
    }
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
        const hit = cross.dist <= ring.r;
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
    // Boost rings: any of them, flown through.
    for (const r of this.boosts) {
      if (r.state !== "ahead" || Math.abs(r.z - b.z) > 60) continue;
      const cross = this._cross(r, a, b);
      if (!cross) continue;
      if (cross.dist <= r.r) {
        r.state = "passed";
        r.t = 0;
        const f = v.forward(_v);
        v.vel.addScaledVector(f, BOOST);
        this._boostT = 1.2;
        this._banner("BOOST!", 0.8, "boost");
        this._whoosh();
        this.game.effects?.shake?.add?.(0.25);
      } else r.state = "gone";
    }
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
    this.newRecord = better && !!this.spec.id;
    if (this.spec.id) {
      const rec = this.records[this.spec.id] || { runs: 0 };
      rec.runs = (rec.runs || 0) + 1;
      rec.finished = (rec.finished || 0) + 1;
      if (better) {
        Object.assign(rec, { best: Math.round(this.final * 1000) / 1000, splits: this.splits.map((s) => Math.round(s * 1000) / 1000), rings: this.passed, missed: this.missed, jet: this.jetType, medal: medalFor(this.spec, this.final), date: Date.now() });
        // (The ghost: the run flown to the finish ring.)
        this._sample(v, true);
        if (this.ghostRec.length > 4) {
          const ghost = { dt: GHOST_DT, jet: this.jetType, data: this.ghostRec };
          if (saveJSON(ghostKey(this.spec), ghost)) this.ghostData = ghost;
        }
      }
      this.records[this.spec.id] = rec;
      saveRecords(this.records);
      this.record = rec;
    }
    if (this.newRecord) voice.say("canyon_record", { text: "New record!" });
    setTimeout(() => this.state === "finished" && this._showResults("finished"), 900);
  }

  _fail(why) {
    if (this.state !== "flying") return;
    this.state = "out";
    this.resultT = 0;
    this._countRun();
    this._showResults(why);
  }

  _countRun() {
    if (!this.spec.id) return;
    const rec = this.records[this.spec.id] || { runs: 0 };
    rec.runs = (rec.runs || 0) + 1;
    this.records[this.spec.id] = rec;
    saveRecords(this.records);
    this.record = rec;
  }

  // Over the rim: a few seconds to get back down, then the run is over.
  _checkOut(dt, v) {
    const r = this.course.row(Math.floor(v.pos.z));
    const over = v.pos.y > r.rim + OUT_MARGIN && v.pos.z > -40 && v.pos.z < this.length + 40;
    if (!over) {
      if (this.outT > 0) this._warn("");
      this.outT = 0;
      return;
    }
    this.outT += dt;
    const left = Math.ceil(OUT_LIMIT - this.outT);
    this._warn(`BACK INTO THE CANYON! ${Math.max(0, left)}`);
    if (Math.floor(this.outT * 2) !== Math.floor((this.outT - dt) * 2)) this.game.audio?.playWarning?.();
    if (this.outT >= OUT_LIMIT) {
      this._warn("");
      this._fail("out");
    }
  }

  // The jet blew up (vehicles.onPilotKilled, hooked): the run is over.
  _crashed(v) {
    if (v !== this.jet) return;
    this.stats.crashes++;
    const was = this.state;
    this.crashAt = { pos: v.pos.clone(), dir: v.vel.lengthSq() > 1 ? v.vel.clone().normalize() : v.forward(new THREE.Vector3()), yaw: 0 };
    this._warn("");
    if (was === "finished" || was === "out") return; // (after the results: nothing changes)
    this.state = "crashed";
    this.resultT = 0;
    this.crashCause = v.lastHitBy && v.lastHitBy !== "crash" ? "shot" : "crashed";
    this._countRun();
    this._banner(this.crashCause === "shot" ? "SHOT DOWN" : "CRASHED", 2, "bad");
  }

  _crashCam(dt) {
    const c = this.crashAt;
    if (!c) return;
    const cam = this.game.camera;
    c.yaw += dt * 0.35;
    const back = 26 + this.resultT * 6;
    const side = new THREE.Vector3(-c.dir.z, 0, c.dir.x).normalize();
    cam.position.copy(c.pos).addScaledVector(c.dir, -back * Math.cos(c.yaw)).addScaledVector(side, back * Math.sin(c.yaw));
    cam.position.y += 10 + this.resultT * 2;
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
    const show = (this.state === "flying" || this.state === "countdown") && this.game.settings?.canyonGhost !== false;
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
      boost: new THREE.MeshBasicMaterial({ color: new THREE.Color(0.6, 4.5, 1.4), fog: false, toneMapped: false }),
      start: new THREE.MeshBasicMaterial({ color: new THREE.Color(4, 4, 4), fog: false, toneMapped: false }),
      missed: new THREE.MeshBasicMaterial({ color: new THREE.Color(5, 0.4, 0.3), fog: false, transparent: true, toneMapped: false }),
      passed: new THREE.MeshBasicMaterial({ color: new THREE.Color(3, 3.4, 4), fog: false, transparent: true, toneMapped: false }),
    };
    this._haloMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(1, 0.7, 0.25), transparent: true, opacity: 0.18, blending: THREE.AdditiveBlending, depthWrite: false, fog: false, toneMapped: false });
    for (const r of this.rings) {
      const big = r.kind === "start" || r.kind === "finish";
      const m = new THREE.Mesh(torus(r.r, big ? 1.1 : r.kind === "boost" ? 0.45 : 0.6), this._matFor(r));
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
      // (a boost ring's chevrons pointing through it)
      if (r.kind === "boost") {
        const chev = new THREE.Group();
        const bar = new THREE.BoxGeometry(0.5, r.r * 0.5, 0.5);
        for (let i = 0; i < 3; i++) {
          for (const side of [-1, 1]) {
            const b = new THREE.Mesh(bar, this._ringMats.boost);
            b.position.set(side * r.r * 0.16, 0, -i * 2.2);
            b.rotation.x = side * 0.7;
            b.rotation.y = Math.PI / 2;
            b.layers.set(LAYER_FX);
            chev.add(b);
          }
        }
        chev.rotation.y = 0;
        holder.add(chev);
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
    if (r.kind === "boost") return M.boost;
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
      const near = d > -60 && d < AHEAD_ROWS * 16 + 220;
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
      r.halo.visible = next || r.kind === "boost";
      m.rotation.z = r.kind === "boost" ? now * 2 : 0;
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
      t.root.visible = Math.abs(t.z - this.game.camera.position.z) < AHEAD_ROWS * 16 + 100;
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
    // (No getting out: the run is in the jet.)
    const locked = mgr.exitLocked;
    mgr.exitLocked = () => (this.active ? "Canyon run: no getting out (R flies again)" : locked?.());
    this._turretHits();
    // Keys: R flies again; the results' N and M; the game's own keys that
    // make no sense here (the inventory, F7's dimensions, items) stay off.
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

  next() {
    const i = CANYON_COURSES.findIndex((c) => c.id === this.spec.id);
    const nx = CANYON_COURSES[(i + 1) % CANYON_COURSES.length];
    this.hooks.go ? this.hooks.go(canyonUrl(nx, this.jetType)) : (window.location.href = canyonUrl(nx, this.jetType));
  }

  leave() {
    this.hooks.leave ? this.hooks.leave() : (window.location.href = menuUrl());
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

  _whoosh() {
    const a = this.game.audio;
    const ctx = a?.ctx;
    if (!ctx) return;
    a._cat?.("ui");
    const out = a._out || a.master;
    const t = ctx.currentTime;
    const o = ctx.createOscillator();
    o.type = "sawtooth";
    o.frequency.setValueAtTime(120, t);
    o.frequency.exponentialRampToValueAtTime(900, t + 0.5);
    const f = ctx.createBiquadFilter();
    f.type = "lowpass";
    f.frequency.value = 1400;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.09, t + 0.05);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.6);
    o.connect(f).connect(g).connect(out);
    o.start(t);
    o.stop(t + 0.65);
  }

  // ---------- The HUD ----------

  _buildHud() {
    injectStyle();
    const el = document.createElement("div");
    el.id = "canyon-hud";
    el.innerHTML = `
      <div class="cy-top">
        <div class="cy-course"></div>
        <div class="cy-time">0.00</div>
        <div class="cy-sub"><span class="cy-rings"></span><span class="cy-pen"></span><span class="cy-best"></span></div>
        <div class="cy-speed"></div>
        <div class="cy-bar"><div class="cy-fill"></div><div class="cy-ghost"></div></div>
      </div>
      <div class="cy-banner"></div>
      <div class="cy-warn"></div>
      <div class="cy-arrow">&#9650;</div>
      <div class="cy-keys">R: fly again &nbsp; Esc: menu</div>`;
    document.body.appendChild(el);
    const res = document.createElement("div");
    res.id = "canyon-results";
    res.className = "hidden";
    document.body.appendChild(res);
    const q = (s) => el.querySelector(s);
    this.ui = { el, res, speed: q(".cy-speed"), course: q(".cy-course"), time: q(".cy-time"), rings: q(".cy-rings"), pen: q(".cy-pen"), best: q(".cy-best"), fill: q(".cy-fill"), ghost: q(".cy-ghost"), banner: q(".cy-banner"), warn: q(".cy-warn"), arrow: q(".cy-arrow") };
    this.ui.course.textContent = this.spec.name.toUpperCase();
    this._bannerT = 0;
    this._hudT = 0;
    this._text = {};
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
    const t = this.state === "finished" ? this.final : this.clock !== null ? this.clock + this.penalty : 0;
    this._set("time", u.time, formatTime(t));
    const total = this.checks.length - 2;
    this._set("rings", u.rings, `RINGS ${this.passed}/${Math.max(0, total)}`);
    this._set("pen", u.pen, this.penalty ? `+${this.penalty} s` : "");
    this._set("best", u.best, Number.isFinite(this.record?.best) ? `BEST ${formatTime(this.record.best)}` : "");
    const v = this.jet;
    const z = v ? v.pos.z : 0;
    if (v?.alive) this._set("speed", u.speed, `${Math.round(v.vel.length() * 3.6)} KM/H  ${v.afterburner ? "AB" : `${Math.round((v.throttle || 0) * 100)}%`}${this._boostT > 0 ? "  BOOST" : ""}`);
    const frac = Math.max(0, Math.min(1, z / this.length));
    const pct = `${(frac * 100).toFixed(1)}%`;
    if (this._text.fill !== pct) {
      this._text.fill = pct;
      u.fill.style.width = pct;
    }
    const gr = this.ghost?.model.root;
    const gf = gr && this.state === "flying" ? Math.max(0, Math.min(1, gr.position.z / this.length)) : -1;
    const gp = gf < 0 ? "none" : `${(gf * 100).toFixed(1)}%`;
    if (this._text.ghost !== gp) {
      this._text.ghost = gp;
      u.ghost.style.display = gf < 0 ? "none" : "block";
      if (gf >= 0) u.ghost.style.left = gp;
    }
    this._arrow();
  }

  // An arrow at the edge of the screen toward the next ring, when it is off it.
  _arrow() {
    const a = this.ui.arrow;
    const r = this.checks[this.nextCheck];
    const cam = this.game.camera;
    let show = false;
    if (r && (this.state === "flying" || this.state === "countdown") && this.jet) {
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

  // ---------- The results ----------

  _showResults(why) {
    const u = this.ui;
    if (!u) return;
    this._resultsShown = true;
    const done = why === "finished";
    const title = done ? (this.newRecord ? "NEW RECORD!" : "FINISHED") : why === "out" ? "OUT OF THE CANYON" : this.crashCause === "shot" ? "SHOT DOWN" : "CRASHED";
    const time = done ? this.final : null;
    const medal = done ? medalFor(this.spec, this.final) : null;
    const M = this.medals;
    const best = this.record?.best;
    const total = this.checks.length - 2;
    const prog = this.jet ? Math.max(0, Math.min(1, (this.crashAt?.pos.z ?? this.jet.pos.z) / this.length)) : 0;
    const medalRow = (m, label) => `<div class="cy-m ${m} ${medal === m ? "got" : ""}"><i></i><b>${label}</b><span>${formatTime(M[m])}</span></div>`;
    u.res.innerHTML = `
      <div class="cy-panel ${done ? "done" : "fail"}">
        <div class="cy-course-name">${this.spec.name}</div>
        <h2>${title}</h2>
        ${done ? `<div class="cy-big">${formatTime(time)}</div>` : `<div class="cy-big small">${Math.round(prog * 100)}% of the canyon</div>`}
        ${medal ? `<div class="cy-medal ${medal}">${medal.toUpperCase()} MEDAL</div>` : done ? `<div class="cy-medal none">No medal: beat ${formatTime(M.bronze)} for bronze</div>` : ""}
        <div class="cy-stats">
          <div><span>Rings</span><b>${this.passed}/${Math.max(0, total)}</b></div>
          <div><span>Missed</span><b>${this.missed}${this.penalty ? ` (+${this.penalty} s)` : ""}</b></div>
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
  }

  // (Tests: the run's state.)
  info() {
    return { state: this.state, clock: this.clock, penalty: this.penalty, passed: this.passed, missed: this.missed, nextCheck: this.nextCheck, checks: this.checks.length, boosts: this.boosts.length, rings: this.rings.length, results: !!this._resultsShown, final: this.final ?? null, record: this.record, length: this.length, turrets: this.turrets.length, turretsAlive: this.turrets.filter((t) => t.alive).length, stats: this.stats };
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
  `;
  document.head.appendChild(s);
}
