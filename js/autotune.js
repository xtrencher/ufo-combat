// Automatic graphics (Round 12): a new install starts at the best graphics
// and performance settings, and while the player hasn't chosen their own,
// this steps them down one level at a time while the frame rate in play
// stays low, until the game runs smoothly (or the bottom is reached).
//
// The ladder below goes from the best to the lightest; each level is a whole
// set (graphics preset, render distance, full-detail distance, far-terrain
// quality, resolution, effects), and each step drops the costliest things
// still on: first Ultra's extras (reflective water, parallax, the third
// shadow cascade, the sharpest pixels), then the view and detail distance,
// then shadows, light shafts and plants (Medium), then resolution, then all
// post-processing and shadows (Low), then resolution and distance again.
//
// Measuring: only in play (not on menus, paused, dead, while the shaders of
// a new level compile, or in a hidden tab), not for a few seconds after
// entering play or a step, and not while a burst of chunks streams in (a
// load, a teleport, a portal: at most BUSY_MAX_S of it, then the frame rate
// is what it is). Over a window of WINDOW_S seconds of play the median frame
// time is taken (hitches, a GC pause or a chunk remesh, don't move a
// median); under TARGET_FPS for SLOW_S seconds running (about 6 s of slow
// frames in all; under half of it, as soon as the window is full), one step
// down. A step that made no difference
// twice running means the frame rate isn't the graphics' doing (a busy CPU):
// the tuner stops for the session rather than strip everything for nothing.
// Once in a session it may step back up one level, after a long time with
// lots of headroom (never back and forth): to a level that ran fine earlier
// in that session, or else, on trial, to the one above where the session
// started (a busy moment may have pushed it down in an earlier session; it
// would only ever ratchet down otherwise). A trial that turns out slow steps
// back down, and isn't tried again for RETRY_SESSIONS sessions. The level is
// saved as it changes: the next session starts there, and keeps tuning.
//
// Online the world doesn't stop while a new level's shaders compile (nothing
// is drawn meanwhile), so there a step waits for the next moment out of play
// (the pause menu, the inventory, a death); alone, main.js holds the world.
//
// The player's choice wins: picking a preset (graphics or performance) or
// changing any graphics or performance setting turns the tuner off for good
// (saved), and their settings stay. The "Auto" choice in the preset rows
// (and "Reset to defaults") turns it back on, at the level it had found.
//
// The safe start (main.js): a start that never got as far as drawing the
// world at the auto level's preset means that level is too heavy for this
// PC: the tuner starts this one at the next lower preset, and saves it
// (instead of the session-only step-down a chosen preset gets).
//
// Automated browsers (navigator.webdriver: the test suites) start on the old
// default (Medium) with the tuner off, as before, unless the page URL has
// ?autotune=1; picking Auto in the menu turns it on there too.
//
// Settings: settings.autoGraphics = { on, level, retryAfter? } (js/settings.js;
// retryAfter: the sessions still to go before a trial step up).

export const LADDER = [
  { label: "Max", graphics: "ultra", renderDistance: 32, detail: 10, lod: "ultra", resolution: 1, effects: "high" },
  { label: "High", graphics: "high", renderDistance: 28, detail: 8, lod: "high", resolution: 1, effects: "high" },
  { label: "High, shorter view", graphics: "high", renderDistance: 20, detail: 6, lod: "high", resolution: 1, effects: "high" },
  { label: "Medium", graphics: "medium", renderDistance: 20, detail: 6, lod: "medium", resolution: 1, effects: "medium" },
  { label: "Medium, lower resolution", graphics: "medium", renderDistance: 16, detail: 5, lod: "medium", resolution: 0.8, effects: "medium" },
  { label: "Low", graphics: "low", renderDistance: 12, detail: 4, lod: "medium", resolution: 1, effects: "low" },
  { label: "Low, lower resolution", graphics: "low", renderDistance: 9, detail: 3, lod: "low", resolution: 0.75, effects: "low" },
  { label: "Lowest", graphics: "low", renderDistance: 7, detail: 3, lod: "low", resolution: 0.6, effects: "low" },
];

export const TARGET_FPS = 40; // below this for a whole window: a step down
const WINDOW_S = 5; // seconds of play judged at a time (a median of its frames)...
const SLOW_S = 3; // ...under TARGET_FPS all this time, without a break: a step down
const WARMUP_S = 8; // after entering play (from a menu, a pause, a new level's shaders)
const SETTLE_S = 4; // after a step (on top of the warm-up its shaders bring)
const BUSY_MAX_S = 15; // chunks streaming in hold the measuring this long at most
const MAX_FRAME_S = 0.5; // (one frame's share of the window: a long stall doesn't flush it)
const FINE_S = 30; // seconds at a good frame rate before a level counts as fine
const HEADROOM_FPS = 58; // lots of headroom (about a 60 Hz screen's full rate)...
const HEADROOM_S = 90; // ...this long without a break: one step back up
const RETRY_SESSIONS = 5; // a trial step up that ran slow: not tried again for this many sessions
const NO_GAIN = 0.92; // a step that left the frame time above 92% of before gained nothing
const EVAL_S = 0.5;
const RING = 1024;

const clampLevel = (n) => Math.max(0, Math.min(LADDER.length - 1, Math.floor(Number(n)) || 0));

// A ladder level's values written into the settings object (the shape of
// js/settings.js: graphics, gfxOverrides, renderDistance, perf.*).
export function writeLevel(settings, lv) {
  settings.graphics = lv.graphics;
  settings.gfxOverrides = {};
  settings.renderDistance = lv.renderDistance;
  settings.renderDistanceCustom = false;
  settings.perf = { ...settings.perf, detailDistance: lv.detail, lodQuality: lv.lod, resolution: lv.resolution, effects: lv.effects };
}

export class AutoTune {
  // settings: the live settings object (settings.autoGraphics is the saved
  // state); save(): persists it. lastBoot: the boot record of the last start
  // (storage.js), for the safe start. search: the page URL's query.
  constructor(settings, { save = () => {}, lastBoot = null, search = globalThis.location?.search ?? "", automated = null } = {}) {
    this.settings = settings;
    this.save = save;
    const q = new URLSearchParams(search);
    this.automated = automated ?? (globalThis.navigator?.webdriver === true && q.get("autotune") !== "1");
    if (!settings.autoGraphics || typeof settings.autoGraphics !== "object") settings.autoGraphics = { on: false, level: 0 };
    this.state = settings.autoGraphics;
    this.state.level = clampLevel(this.state.level);
    this.hooks = {};
    this.bootNotice = "";
    this.fakeFrameTime = null; // (tests: a frame time used instead of the real one)
    this._ft = new Float32Array(RING);
    this._noTrial = false; // (a trial step up taken back lately: none this session)
    this._resetSession();
    // ?graphics=low|medium|high|ultra picks a preset (main.js): the player's choice.
    if (["low", "medium", "high", "ultra"].includes(q.get("graphics")) && this.state.on) {
      this.state.on = false;
      save();
    }
    if (this.state.on && !this.automated) {
      // The safe start: the last start never drew the world at this level's preset.
      const lv = LADDER[this.state.level];
      if (lastBoot && lastBoot.ok === false && lastBoot.preset === lv.graphics) {
        let i = this.state.level;
        while (i < LADDER.length - 1 && LADDER[i].graphics === lv.graphics) i++;
        if (LADDER[i].graphics !== lv.graphics) {
          this.state.level = i;
          this.bootNotice = `The last start didn't get as far as showing the world, so automatic graphics now start at ${LADDER[i].label}.`;
        }
      }
      // (A session counted towards the next trial step up.)
      const wait = Math.floor(Number(this.state.retryAfter)) || 0;
      this._noTrial = wait > 0;
      this._setRetry(wait - 1);
      writeLevel(settings, LADDER[this.state.level]);
      save();
    }
  }

  _setRetry(n) {
    if (n > 0) this.state.retryAfter = Math.min(99, n);
    else delete this.state.retryAfter;
  }

  // Whether the tuner picks the graphics this session.
  get on() {
    return this.state.on && !this.automated;
  }

  get level() {
    return this.state.level;
  }

  get label() {
    return LADDER[this.state.level].label;
  }

  // The settings screen's line about it.
  describe() {
    return `Auto: the best graphics this PC runs smoothly, a step lower whenever the frame rate stays under ${TARGET_FPS} (any change of your own turns it off). Now: ${this.label}.`;
  }

  // hooks: apply(level) puts a ladder level into effect (graphics, render
  // distance, the Performance settings) without counting as the player's
  // choice; toast(text, seconds); busy(): a burst of chunks is streaming in;
  // online(): in a multiplayer game (a step waits for a moment out of play);
  // refresh(): the settings screen's preset rows show the state again;
  // panel: the SettingsPanel (its Performance rows count as a choice).
  attach(hooks) {
    this.hooks = { ...this.hooks, ...hooks };
    if (hooks.panel) hooks.panel.onTuningChange = () => this.chosen();
  }

  // The player chose graphics or performance settings of their own: the
  // tuner is off for good (until Auto is picked again).
  chosen() {
    if (!this.state.on) return;
    this.state.on = false;
    this.save();
    this.hooks.refresh?.();
  }

  // Auto picked (or the defaults restored): the tuner is on again, from the
  // level it had found. Returns the level applied.
  enable() {
    this.state.on = true;
    this.automated = false;
    this._resetSession();
    this.save();
    this.hooks.apply?.(LADDER[this.state.level]);
    this.hooks.refresh?.();
    return LADDER[this.state.level];
  }

  // The state saved by another tab of the game (storage event).
  adopt(state) {
    if (!state || typeof state !== "object") return;
    const on = state.on === true;
    const level = clampLevel(state.level);
    this._setRetry(Math.floor(Number(state.retryAfter)) || 0);
    if (on === this.state.on && level === this.state.level) return;
    this.state.on = on;
    this.state.level = level;
    this._resetSession();
    this.hooks.refresh?.();
  }

  _resetSession() {
    this._count = 0;
    this._head = 0;
    this._span = 0;
    this._hold = WARMUP_S;
    this._busyT = 0;
    this._evalT = 0;
    this._slowT = 0;
    this._fineT = 0;
    this._roomT = 0;
    this._wasActive = false;
    this._lastFt = 1;
    this._lastDown = null; // the median frame time before the last step down
    this._noGain = 0;
    this._stopped = false;
    this._upDone = false;
    this._trial = false; // (on a level stepped up to on trial: see the header)
    this._pending = null; // (online: a step waiting for a moment out of play)
    this._bottomNoted = false;
    this._toasted = false;
    this.fine = new Set(); // levels that ran fine this session
    this.slow = new Set(); // levels stepped down from this session
    this.lastFps = 0;
  }

  _clearWindow() {
    this._count = 0;
    this._head = 0;
    this._span = 0;
    this._evalT = 0;
    this._slowT = 0;
  }

  // Every frame. frameTime: the real time since the last frame (s); active:
  // in play with the world drawn (main.js decides).
  update(frameTime, active) {
    if (!this.on) return;
    const ft = this.fakeFrameTime ?? frameTime;
    if (!active || !(ft > 0)) {
      if (this._wasActive) {
        this._wasActive = false;
        this._clearWindow();
        this._roomT = 0;
        this._hold = Math.max(this._hold, WARMUP_S);
      }
      if (this._pending) this._applyPending();
      return;
    }
    if (this._pending) {
      this._wasActive = true;
      // (Out of the room meanwhile: nothing to wait for.)
      if (!this.hooks.online?.()) this._applyPending();
      return;
    }
    // (A frame spanning a gap, e.g. the first one back from a hidden tab: a
    // fresh start. A PC that is steadily that slow still gets judged.)
    const gap = ft > 2 && ft > 8 * this._lastFt;
    this._lastFt = ft;
    if (gap) {
      this._clearWindow();
      this._roomT = 0;
      this._hold = Math.max(this._hold, WARMUP_S);
      return;
    }
    this._wasActive = true;
    const t = Math.min(ft, MAX_FRAME_S);
    if (this._hold > 0) {
      this._hold -= t;
      return;
    }
    // A burst of chunks streaming in (a load, a teleport): not a steady frame rate.
    if (this.hooks.busy?.()) {
      this._busyT += t;
      if (this._busyT < BUSY_MAX_S) {
        this._clearWindow();
        return;
      }
    } else {
      this._busyT = 0;
    }
    // The window: the last WINDOW_S seconds of frames.
    const ring = this._ft;
    if (this._count === RING) this._span -= Math.min(ring[this._head], MAX_FRAME_S);
    ring[this._head] = ft;
    this._head = (this._head + 1) % RING;
    this._count = Math.min(RING, this._count + 1);
    this._span += t;
    while (this._count > 1) {
      const oldest = ring[(this._head - this._count + RING) % RING];
      const o = Math.min(oldest, MAX_FRAME_S);
      if (this._span - o < WINDOW_S) break;
      this._span -= o;
      this._count--;
    }
    this._evalT += t;
    if (this._evalT < EVAL_S || this._span < WINDOW_S * 0.95) return;
    const dt = this._evalT;
    this._evalT = 0;
    const med = this._median();
    const fps = 1 / med;
    this.lastFps = fps;
    if (fps < TARGET_FPS) {
      this._roomT = 0;
      this._slowT += dt;
      // (Under half the target the full window is evidence enough: a weak PC
      // starting at the top doesn't sit through every level's wait.)
      if (this._slowT >= SLOW_S || fps < TARGET_FPS / 2) this._stepDown(med);
      return;
    }
    this._slowT = 0;
    // (Fast enough: the last step down did its job.)
    this._lastDown = null;
    this._noGain = 0;
    this._fineT += dt;
    if (this._fineT >= FINE_S) {
      this.fine.add(this.state.level);
      this._trial = false; // (the trial went well)
    }
    this._roomT = fps >= HEADROOM_FPS ? this._roomT + dt : 0;
    if (this._roomT >= HEADROOM_S && !this._upDone && this.state.level > 0) {
      const up = this.state.level - 1;
      if (this.fine.has(up)) this._stepUp(false);
      else if (!this._noTrial && !this.slow.has(up)) this._stepUp(true);
    }
  }

  _median() {
    const n = this._count;
    const a = new Float32Array(n);
    for (let i = 0; i < n; i++) a[i] = this._ft[(this._head - n + i + RING) % RING];
    a.sort();
    return n % 2 ? a[n >> 1] : (a[n / 2 - 1] + a[n / 2]) / 2;
  }

  _stepDown(med) {
    if (this._stopped) return;
    // Did the last step down help at all?
    if (this._lastDown !== null) {
      this._noGain = med > this._lastDown * NO_GAIN ? this._noGain + 1 : 0;
      if (this._noGain >= 2) {
        this._stopped = true; // (not the graphics: see the header)
        return;
      }
    }
    if (this.state.level >= LADDER.length - 1) {
      this._stopped = true;
      if (!this._bottomNoted) {
        this._bottomNoted = true;
        this.hooks.toast?.("The game runs slowly even on the lightest graphics: closing other programs and browser tabs may help.", 5);
      }
      return;
    }
    this._lastDown = med;
    this.slow.add(this.state.level);
    // (A trial step up that ran slow: back down, and not tried again for a while.)
    if (this._trial) {
      this._trial = false;
      this._noTrial = true;
      this._setRetry(RETRY_SESSIONS);
    }
    const label = LADDER[clampLevel(this.state.level + 1)].label;
    this._change(this.state.level + 1, this._toasted ? `Graphics lowered to ${label} for a smoother game.` : `Graphics lowered to ${label} for a smoother game (Settings > Graphics to choose your own).`);
    this._toasted = true;
  }

  _stepUp(trial) {
    this._upDone = true;
    this._trial = trial;
    this._lastDown = null;
    this._noGain = 0;
    this._change(this.state.level - 1, `Graphics raised to ${LADDER[clampLevel(this.state.level - 1)].label}: this PC has room for it.`);
  }

  // A step now, or online at the next moment out of play (see the header).
  _change(level, text) {
    if (this.hooks.online?.()) {
      this._pending = { level, text };
      this._clearWindow();
      return;
    }
    this._go(level);
    this.hooks.toast?.(text, 3.5);
  }

  _applyPending() {
    const { level, text } = this._pending;
    this._pending = null;
    this._go(level);
    this.hooks.toast?.(text, 3.5);
  }

  _go(level) {
    this.state.level = clampLevel(level);
    this._clearWindow();
    this._fineT = 0;
    this._roomT = 0;
    this._hold = SETTLE_S;
    this.save();
    this.hooks.apply?.(LADDER[this.state.level]);
    this.hooks.refresh?.();
  }

  // For tests and the debug overlay.
  stats() {
    return { on: this.on, level: this.state.level, label: this.label, fps: Math.round(this.lastFps * 10) / 10, hold: Math.max(0, this._hold), span: this._span, stopped: this._stopped, upDone: this._upDone, trial: this._trial, pending: this._pending?.level ?? null, fine: [...this.fine] };
  }
}
