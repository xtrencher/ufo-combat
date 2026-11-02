// (Round 16) The mission board: pick a mission, play it, win it (or fail it
// and retry). It takes the place of Round 10's classified campaign for a
// Missions world (see js/mission-catalog.js for what is on it and why).
//
// MissionBoard is a Progress (js/progression.js) and keeps its interface, so
// the director (js/missions.js), the HUD and the network sync work as
// before: while a mission runs, the "run" is that one mission (chain [id],
// step 0); when none does, the step is past it (progress.mission is null).
// What the board adds: the career (missions won, how often, the vehicles
// unlocked), the active mission's time limit, failing and retrying, the
// locks (by what you have won, not by a place in a run) and its own save.
//
// (A "sequence" mode keeps the old campaign's behaviour for the automated
// suites that set a run up with setChain; see legacyAutomation below. A real
// player always gets the board.)
import { Progress, missionById as poolMission, curveAt } from "./progression.js";
import { BOARD, BOARD_BY_ID, CATEGORIES, TIERS, VEHICLE_NAMES, tierCurve, limitFor, rewardFor, rankFor, lockReason, setTitles } from "./mission-catalog.js";

setTitles((id) => poolMission(id)?.title);

// Mission ids the game's locks ask about (progress.reached / isDone), and
// the vehicle (or anything) a win of which opens them on the board.
const GATES = { wings: "jet", salvage: "ufo", sunburn: "b2", air_cav: "heli", tank_battle: "tank", supply: "any" };

// (Automation: the suites from before Round 16 drive the classic run; a page
// opened with ?board plays the board like a player.)
function legacyAutomation() {
  try {
    return typeof navigator !== "undefined" && !!navigator.webdriver && !/[?&]board\b/.test(globalThis.location?.search || "");
  } catch {
    return false;
  }
}

export class MissionBoard extends Progress {
  constructor() {
    super();
    this.board = true;
    this.won = new Map(); // id -> wins
    this.fails = 0;
    this.active = null; // { id, tier, left, limit } while a mission runs
    this.result = null; // { id, ok, reason, t } the last mission's outcome
    this.onFail = null; // (mission, reason) => void
    this.onRequest = null; // (online, a guest) (kind, id) => void: asks the host
    this._idle(null);
  }

  // ---------- The legacy run (automated suites) ----------

  setChain(ids, vars, acts) {
    if (!this._internal) {
      this.board = false;
      this.active = null;
    }
    return super.setChain(ids, vars, acts);
  }

  // (Back to the board, idle; tests and a guest leaving a room.)
  useBoard() {
    this.board = true;
    this._idle(null);
    if (this.onChange) this.onChange();
  }

  _set(ids, vars) {
    this._internal = true;
    try {
      super.setChain(ids, vars);
    } finally {
      this._internal = false;
    }
  }

  // No mission running: the run is the last one (or a placeholder), its step past it.
  // (Its view stays as it was played: a guest's reward comes after it ends.)
  _idle(id) {
    const last = this.mission || (this.chain?.[0] === id ? this._views?.[0] : null);
    this._set([id || BOARD[0].id]);
    if (last && last.id === id) this._views[0] = last;
    else if (id && this.won) this._views[0] = this._view(id) || this._views[0];
    this.step = 1;
    this.active = null;
  }

  // ---------- The career ----------

  get wins() {
    let n = 0;
    for (const k of this.won.values()) n += k;
    return n;
  }

  get rank() {
    return rankFor(this.wins);
  }

  _wonSet() {
    return new Set(this.won.keys());
  }

  // Why a board mission can't be started now (null: it can).
  lockOf(id) {
    return lockReason(BOARD_BY_ID.get(id), this._wonSet());
  }

  // Has a win (or the mission running now) opened this vehicle?
  unlocked(kind) {
    if (kind === "any") return this.wins > 0;
    const cur = this.active && BOARD_BY_ID.get(this.active.id);
    if (cur && (cur.vehicle === kind || (kind === "jet" && cur.vehicle === "b2"))) return true;
    for (const id of this.won.keys()) {
      const v = BOARD_BY_ID.get(id)?.vehicle;
      if (v === kind || (kind === "jet" && v === "b2")) return true;
    }
    return false;
  }

  // ---------- Locks and difficulty (Progress's, for the board) ----------

  reached(id) {
    if (!this.board) return super.reached(id);
    return GATES[id] ? this.unlocked(GATES[id]) : true;
  }

  isDone(id) {
    if (!this.board) return super.isDone(id);
    return GATES[id] ? this.unlocked(GATES[id]) : this.won.has(id);
  }

  indexOf(id) {
    if (!this.board) return super.indexOf(id);
    return BOARD_BY_ID.has(id) ? BOARD.findIndex((e) => e.id === id) : -1;
  }

  missionById(id) {
    if (!this.board) return super.missionById(id);
    return this.mission?.id === id ? this.mission : this.chain[0] === id ? this._views[0] : this._view(id);
  }

  // The loot tier: the mission's while one runs; else by wins.
  tier(stats) {
    if (!this.board) return super.tier(stats);
    if (this.mission) return this.mission.tier;
    return Math.min(5, Math.floor(this.wins / 3));
  }

  difficulty(stats) {
    if (!this.board) return super.difficulty(stats);
    if (this.mission) return [0, 0.25, 0.55, 0.85][this.mission.boardTier] ?? 0.5;
    return Math.min(0.6, this.wins / 30);
  }

  // The sky between missions: calm, a little busier as you win.
  get rules() {
    if (!this.board || this.mission) return super.rules;
    const c = curveAt(Math.min(18, this.wins * 2), 28);
    return { ...c.rules, max: Math.min(c.rules.max, this.wins ? 2 : 0) };
  }

  // A board mission as it plays: its tier's sky, loot tier and reward.
  _view(id, variant = 0) {
    const e = BOARD_BY_ID.get(id);
    const m = poolMission(id);
    if (!e || !m) return null;
    const c = tierCurve(e.tier);
    const text = m.twists?.[variant] ? `${m.text} ${m.twists[variant]}` : m.text;
    const objectives = m.objectives.map((o) => (Array.isArray(o.goals) && Number.isFinite(o.goals[variant]) ? { ...o, goal: o.goals[variant] } : o));
    return { ...m, n: 0, variant, text, objectives, act: 1, tier: Math.max(c.tier, e.loot ?? 0), rules: m.sky ? { ...c.rules, ...m.sky } : c.rules, reward: rewardFor(e, this.won.has(id)), final: !!m.final, cat: e.cat, boardTier: e.tier, vehicle: e.vehicle || null, limit: limitFor(e), brief: e.brief };
  }

  // ---------- Running a mission ----------

  // Starts board mission `id` (online, a guest asks the host). Returns null, or why not.
  begin(id, stats, opts = {}) {
    if (this.mirror) {
      this.onRequest?.("start", id);
      return null;
    }
    const e = BOARD_BY_ID.get(id);
    if (!e) return "Unknown mission.";
    const why = opts.force ? null : this.lockOf(id);
    if (why) return why;
    this.board = true;
    const variant = Number.isInteger(opts.variant) ? opts.variant : Math.floor(Math.random() * 4);
    this._set([id], [variant]);
    this._views[0] = this._view(id, variant);
    this.step = 0;
    this.done = [];
    this.place = null;
    this.base = { ...this._pick(stats || {}) };
    this.runId = (this.runId || 0) + 1; // (the director sets a retried mission up afresh)
    this.active = { id, tier: e.tier, limit: limitFor(e), left: limitFor(e) };
    this.result = null;
    if (this.onChange) this.onChange();
    if (this.onStart) this.onStart(this.mission);
    return null;
  }

  // The last mission again (after a failure, or for the fun of it).
  retry(stats) {
    const id = this.result?.id || this.active?.id;
    return id ? this.begin(id, stats) : "No mission to retry.";
  }

  // The mission is lost (time up, the convoy gone, the base overrun...).
  fail(reason = "Mission failed.") {
    const m = this.mission;
    if (!this.board || !m || this.mirror) return;
    this.fails++;
    this.result = { id: m.id, ok: false, reason, t: Date.now() };
    this._idle(m.id);
    this.onFail?.(m, reason);
    if (this.onChange) this.onChange();
  }

  // Walking away from it (no penalty but the time).
  abandon() {
    if (this.mirror) {
      this.onRequest?.("abandon", this.mission?.id);
      return;
    }
    const m = this.mission;
    if (!this.board || !m) return;
    this.result = { id: m.id, ok: false, reason: "Abandoned.", t: Date.now() };
    this._idle(m.id);
    if (this.onChange) this.onChange();
  }

  // Seconds to go (the director counts them down on the host).
  tickTimer(dt) {
    const a = this.active;
    if (!this.board || !a || !this.mission || this.mirror) return;
    a.left -= dt;
    if (a.left <= 0) this.fail("Out of time.");
  }

  update(stats) {
    if (!this.board) return super.update(stats);
    const m = this.mission;
    const was = this.won.get(m?.id) || 0;
    const done = super.update(stats);
    if (done) {
      this.won.set(done.id, was + 1);
      this.result = { id: done.id, ok: true, reason: "", t: Date.now(), unlock: this._unlockText(done.id, was) };
      this.active = null;
    }
    return done;
  }

  // "Fighter jets are yours for free flight now." (a first win that opens a vehicle)
  _unlockText(id, was) {
    const v = BOARD_BY_ID.get(id)?.vehicle;
    if (was || !v || v === "aa") return "";
    const before = [...this.won.keys()].some((k) => k !== id && (BOARD_BY_ID.get(k)?.vehicle === v || (v === "jet" && BOARD_BY_ID.get(k)?.vehicle === "b2")));
    return before ? "" : `Unlocked: ${VEHICLE_NAMES[v]} for free play.`;
  }

  // ---------- The board's list (the Missions screen) ----------

  list(stats) {
    if (!this.board) return super.list(stats);
    return BOARD.map((e) => {
      const m = poolMission(e.id);
      const cur = this.mission?.id === e.id;
      const lock = this.lockOf(e.id);
      return { id: e.id, cat: e.cat, tier: e.tier, tierName: TIERS[e.tier].name, title: m?.title || e.id, text: m?.text || "", brief: e.brief, vehicle: e.vehicle || null, limit: limitFor(e), reward: rewardFor(e, this.won.has(e.id)), wins: this.won.get(e.id) || 0, state: cur ? "current" : lock ? "locked" : this.won.has(e.id) ? "done" : "open", lock, objectives: cur ? this.objectives(stats) : null };
    });
  }

  categories() {
    return CATEGORIES;
  }

  // ---------- Saving ----------

  serialize() {
    if (!this.board) return super.serialize();
    const a = this.active && this.mission ? { id: this.active.id, v: this.mission.variant, left: Math.round(this.active.left), base: this.base } : null;
    return { v: 8, board: true, won: Object.fromEntries(this.won), fails: this.fails, ...(a ? { active: a } : {}), ...(this.place ? { place: this.place } : {}) };
  }

  load(data, stats) {
    if (data?.v !== 8 && legacyAutomation()) {
      // (The old suites: the classic run, as before.)
      super.load(data, stats);
      this.board = false;
      return;
    }
    this.board = true;
    this.won = new Map();
    this.fails = 0;
    this.result = null;
    if (data?.v === 8) {
      for (const [k, n] of Object.entries(data.won || {})) if (BOARD_BY_ID.has(k) && Number.isFinite(n) && n > 0) this.won.set(k, Math.min(999, n | 0));
      this.fails = Number.isFinite(data.fails) ? data.fails | 0 : 0;
      const a = data.active;
      if (a && BOARD_BY_ID.has(a.id) && !this.begin(a.id, stats, { force: true, variant: Number.isInteger(a.v) ? Math.max(0, Math.min(3, a.v)) : 0 })) {
        if (Number.isFinite(a.left)) this.active.left = Math.max(30, a.left);
        if (a.base && typeof a.base === "object") for (const [k, v] of Object.entries(a.base)) if (Number.isFinite(v)) this.base[k] = v;
        if (data.place && typeof data.place === "object") this.place = { ...data.place };
        return;
      }
      this._idle(null);
      return;
    }
    // A save from before the board (Round 10's run, or older): the campaign's
    // place is gone, but what it had won counts on the board (the missions
    // still on it), so its vehicles stay open.
    const done = Array.isArray(data?.done) ? data.done.filter((x) => typeof x === "string") : [];
    for (const id of done) if (BOARD_BY_ID.has(id)) this.won.set(id, 1);
    this._idle(null);
    this.base = { ...this._pick(stats || {}) };
  }

  // ---------- Online (js/net/coop.js) ----------

  // The host's board, compactly, for the guests.
  netState() {
    if (!this.board) return null;
    const a = this.active && this.mission ? [this.active.id, this.mission.variant, Math.max(0, Math.round(this.active.left))] : null;
    const r = this.result ? [this.result.id, this.result.ok ? 1 : 0, String(this.result.reason || "").slice(0, 120), this.result.t] : null;
    return { a, r, w: [...this.won.keys()].join(",") };
  }

  // A guest mirrors it. Returns "start" when a new mission began here.
  applyNet(s) {
    if (!s || typeof s !== "object") return null;
    this.board = true;
    const w = typeof s.w === "string" && s.w.length < 4000 ? s.w.split(",").filter((k) => BOARD_BY_ID.has(k)) : [];
    for (const k of w) if (!this.won.has(k)) this.won.set(k, 1);
    let out = null;
    const a = Array.isArray(s.a) && BOARD_BY_ID.has(s.a[0]) ? s.a : null;
    if (a) {
      if (this.mission?.id !== a[0] || this.mission?.variant !== a[1]) {
        const v = Number.isInteger(a[1]) ? Math.max(0, Math.min(3, a[1])) : 0;
        this._set([a[0]], [v]);
        this._views[0] = this._view(a[0], v);
        this.step = 0;
        this.active = { id: a[0], tier: BOARD_BY_ID.get(a[0]).tier, limit: limitFor(BOARD_BY_ID.get(a[0])), left: 0 };
        out = "start";
      }
      this.active.left = Number(a[2]) || 0;
    } else if (this.mission) this._idle(this.mission.id);
    const r = Array.isArray(s.r) && typeof s.r[0] === "string" ? { id: s.r[0], ok: !!s.r[1], reason: String(s.r[2] || "").slice(0, 120), t: Number(s.r[3]) || 0 } : null;
    if (r && (!this.result || this.result.t !== r.t || this.result.id !== r.id)) {
      this.result = r;
      // (Not for the outcome already there when joining.)
      if (this._joined && !r.ok && r.reason !== "Abandoned.") out = out || "fail";
    }
    this._joined = true;
    return out;
  }
}
