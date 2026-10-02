// Player settings: defaults, validation, and the tabbed settings screen.
//
// Everything is saved in localStorage (storage.js) as one versioned JSON
// object (`v`: SETTINGS_VERSION) under the game's prefix, the moment it
// changes. On load it is read before anything else applies a default, a
// preset or a menu value: a setting added later simply falls back to its
// default in older saves, and garbage values are clamped back into range.
//
// Most settings are declared once in SCHEMA below (where they live in the
// settings object, their group, type, range and default). The settings
// screen builds its rows from it, validates saved values with it, and resets
// a whole group to its defaults with it. A few older settings with custom
// behavior (render distance, graphics preset and options, time of day) keep
// hand-written rows in index.html and plug into the same group reset.

export const DIFFICULTIES = ["peaceful", "easy", "normal", "hard"];

// Damage dealt to the player by creatures, per difficulty. Peaceful also
// stops hostile creatures from spawning (and removes the ones around).
export const DIFFICULTY_DAMAGE = { peaceful: 0, easy: 0.5, normal: 1, hard: 1.5 };

export const AUDIO_CATEGORIES = [
  ["master", "Master volume"],
  ["blocks", "Blocks and footsteps"],
  ["weapons", "Weapons and explosions"],
  ["creatures", "Creatures"],
  ["player", "Player (hurt, splash)"],
  ["ui", "Menus and pickups"],
];

// Tabs of the settings screen, in order. `page` is the tab's data-page
// (the first four keep their old names).
export const SETTING_GROUPS = [
  { page: "video", label: "Graphics" },
  { page: "performance", label: "Performance" },
  { page: "controls", label: "Controls" },
  { page: "audio", label: "Audio" },
  { page: "gameplay", label: "Gameplay" },
  { page: "weapons", label: "Weapons" },
  { page: "mobs", label: "Mobs" },
  { page: "ufos", label: "UFOs" },
  { page: "vehicles", label: "Vehicles" },
];

const pct = (v) => `${Math.round(v * 100)}%`;
const times = (v) => `${Number(v).toFixed(v < 10 ? 2 : 1).replace(/\.?0+$/, "")}x`;
const int = (v) => String(Math.round(v));
const secs = (v) => `${Number(v).toFixed(1)} s`;
const deg = (v) => `${Math.round(v)}°`;

// Zombie spawn rate: a multiplier on the normal rate, shown with a name at
// the top end. Beyond ~5x it is really a zombie apocalypse.
function spawnRateLabel(v) {
  if (v === 0) return "Off";
  if (v >= 40) return "APOCALYPSE";
  return times(v);
}

// type: "range" | "select" | "checkbox". A range with `values` is a slider
// over those steps (for settings with a huge range, like zombie counts). `key` is the path in the settings
// object. `id` is the element id (defaults to the key with dots turned into
// dashes). `note(v)` returns a warning shown next to heavy values. `sub`
// starts a sub-heading above the row; `advanced` rows are folded away under
// an "Advanced" toggle in their group.
export const SCHEMA = [
  // ----- Graphics (hand-written rows: render distance, preset, options) -----
  { key: "showFps", id: "show-fps", group: "video", type: "checkbox", label: "Show FPS counter", def: true, static: true },

  // ----- Performance -----
  { key: "perf.detailDistance", group: "performance", type: "range", label: "Full-detail distance (chunks)", min: 0, max: 24, step: 1, def: 0, fmt: (v) => (v === 0 ? "Auto" : int(v)), hint: "Chunks drawn in full detail around you (Auto: the graphics preset's). Beyond them the land is drawn as simplified tiles.", note: (v) => (v >= 18 ? "Very heavy: every full-detail chunk is meshed and lit on the main thread (fine on a fast CPU)." : v >= 12 ? "Heavy: every full-detail chunk is meshed and lit on the main thread." : "") },
  { key: "perf.lodQuality", group: "performance", type: "select", label: "Far terrain (LOD) quality", choices: [["low", "Low"], ["medium", "Medium"], ["high", "High"], ["ultra", "Ultra"], ["extreme", "Extreme"]], def: "medium", hint: "How detailed the simplified distant land is (it always follows the same terrain as the full-detail chunks). The far terrain distance is the render distance on the Graphics tab." },
  { key: "perf.resolution", group: "performance", type: "range", label: "Resolution scale", min: 0.5, max: 2, step: 0.05, def: 1, fmt: pct, hint: "Below 100%: fewer pixels, scaled up (the biggest speed-up on weak graphics cards). Above 100%: supersampling, sharper edges on a powerful GPU.", note: (v) => (v > 1.3 ? "Heavy: draws many more pixels (only for strong graphics cards)." : "") },
  { key: "perf.effects", group: "performance", type: "select", label: "Effects detail", choices: [["low", "Low"], ["medium", "Medium"], ["high", "High"]], def: "high", hint: "Particles in explosions, trails and smoke." },

  // ----- Controls -----
  { key: "fov", id: "fov", group: "controls", type: "range", label: "Field of view", min: 50, max: 110, step: 1, def: 75, fmt: int, static: true },
  { key: "sensitivity", id: "sensitivity", group: "controls", type: "range", label: "Mouse sensitivity", min: 0.1, max: 4, step: 0.05, def: 1, fmt: (v) => `${v.toFixed(2)}x`, static: true },
  { key: "invertY", id: "invert-y", group: "controls", type: "checkbox", label: "Invert mouse Y", def: false, static: true },
  { key: "binocularZoom", group: "controls", type: "range", label: "Binocular zoom (hold both mouse buttons)", min: 2, max: 12, step: 0.5, def: 6, fmt: times },

  // ----- Gameplay -----
  { key: "difficulty", id: "difficulty", group: "gameplay", type: "select", label: "Difficulty", choices: DIFFICULTIES.map((d) => [d, d]), def: "normal", static: true },
  { key: "mobSpawning", creativeOnly: true, id: "mob-spawning", group: "gameplay", type: "checkbox", label: "Creatures spawn", def: true, static: true },
  { key: "timeLocked", creativeOnly: true, id: "time-lock", group: "gameplay", type: "checkbox", label: "Lock time of day", def: false, static: true },
  { key: "statsOverlay", group: "gameplay", type: "checkbox", label: "Stats on the HUD (UFOs shot down, play time)", def: false },

  // ----- Weapons -----
  { key: "explosionScale.grenade", creativeOnly: true, id: "explosion-grenade", group: "weapons", type: "range", label: "Grenade blast size", min: 0.4, max: 2, step: 0.05, def: 1, fmt: times, static: true },
  { key: "explosionScale.bazooka", creativeOnly: true, id: "explosion-bazooka", group: "weapons", type: "range", label: "Bazooka blast size", min: 0.4, max: 2, step: 0.05, def: 1, fmt: times, static: true },
  { key: "weapons.blasterColor", group: "weapons", type: "select", label: "Laser blaster color", choices: [["red", "Red"], ["green", "Green"], ["blue", "Blue"]], def: "red", sub: "Laser blaster" },
  { key: "weapons.airstrike.count", creativeOnly: true, group: "weapons", type: "range", label: "Meteors per strike", min: 1, max: 40, step: 1, def: 7, fmt: int, sub: "Airstrike", note: (v) => (v > 20 ? "Many craters at once: expect a short hitch on each impact wave." : "") },
  { key: "weapons.airstrike.spread", creativeOnly: true, group: "weapons", type: "range", label: "Spread radius (blocks)", min: 0, max: 80, step: 1, def: 22, fmt: int },
  { key: "weapons.airstrike.delay", creativeOnly: true, group: "weapons", type: "range", label: "Delay until impact", min: 1, max: 20, step: 0.5, def: 5, fmt: secs },
  { key: "weapons.airstrike.angle", creativeOnly: true, group: "weapons", type: "range", label: "Fall angle (from vertical)", min: 0, max: 70, step: 1, def: 35, fmt: deg },
  { key: "weapons.airstrike.speed", creativeOnly: true, group: "weapons", type: "range", label: "Fall speed (blocks/s)", min: 30, max: 250, step: 5, def: 95, fmt: int },
  { key: "explosionScale.airstrike", creativeOnly: true, id: "explosion-airstrike", group: "weapons", type: "range", label: "Meteor explosion size", min: 0.4, max: 2, step: 0.05, def: 1, fmt: times, static: true },
  { key: "weapons.nukeSize", creativeOnly: true, group: "weapons", type: "range", label: "Nuke size (crater radius)", min: 12, max: 200, step: 1, def: 96, fmt: int, sub: "Jet nuke", hint: "The default (96) wipes out everything within about 125 blocks: land, trees, buildings, runways.", note: (v) => (v > 120 ? "A crater this size takes a few seconds to carve and rebuild, even on a fast PC. Chunks beyond your render distance are cleared as they load." : v > 96 ? "Bigger than the default: the blast takes a moment to carve and rebuild on slower PCs." : "") },
  { key: "weapons.nukeIntensity", group: "weapons", type: "select", label: "Nuke effects intensity", choices: [["low", "Low"], ["medium", "Medium"], ["high", "High"]], def: "high", hint: "How much smoke and fire the mushroom cloud uses." },

  // ----- Mobs -----
  { key: "zombies.spawnRate", creativeOnly: true, group: "mobs", type: "range", label: "Zombie spawn rate", values: [0, 0.25, 0.5, 1, 1.5, 2, 3, 5, 8, 12, 20, 30, 50], min: 0, max: 50, def: 1, fmt: spawnRateLabel, sub: "Zombies", note: (v) => (v >= 10 ? "Zombie apocalypse: far zombies are drawn as simple crowds and think less, but a slow CPU will feel it." : "") },
  { key: "zombies.max", creativeOnly: true, group: "mobs", type: "range", label: "Max zombies", values: [0, 2, 4, 8, 12, 16, 24, 32, 48, 64, 96, 128, 192, 256, 400], min: 0, max: 400, def: 8, fmt: int, note: (v) => (v > 150 ? "Hundreds of zombies: fine on a fast PC, heavy on a laptop." : v > 60 ? "Lots of zombies: far ones are simplified to stay smooth." : "") },
  { key: "zombies.health", creativeOnly: true, group: "mobs", type: "range", label: "Zombie health", min: 0.25, max: 5, step: 0.25, def: 1, fmt: times },
  { key: "zombies.damage", creativeOnly: true, group: "mobs", type: "range", label: "Zombie damage", min: 0.25, max: 5, step: 0.25, def: 1, fmt: times },
  { key: "zombies.daylight", creativeOnly: true, group: "mobs", type: "checkbox", label: "Daylight zombies (spawn by day, don't burn)", def: false },

  // ----- UFOs -----
  { key: "ufos.activity", group: "ufos", creativeOnly: true, type: "range", label: "UFO activity", values: [0, 0.1, 0.25, 0.5, 1, 2, 4, 8, 16], min: 0, max: 16, def: 0.5, fmt: (v) => ACTIVITY_NAMES[[0, 0.1, 0.25, 0.5, 1, 2, 4, 8, 16].indexOf(v)] ?? times(v), hint: "From rare sightings to a sky full of them. Far more activity at night.", note: (v) => (v >= 8 ? "The sky will be full of UFOs: far ones are drawn simply and think less, but expect a heavier load." : "") },
  { key: "ufos.spawnChance", group: "ufos", creativeOnly: true, advanced: true, type: "range", label: "Spawn chance", min: 0.25, max: 4, step: 0.25, def: 1, fmt: times },
  { key: "ufos.maxCount", group: "ufos", creativeOnly: true, advanced: true, type: "range", label: "Max UFOs at once", values: [0, 1, 2, 3, 5, 8, 12, 20, 30, 50, 80, 120, 150], min: 0, max: 150, def: 0, fmt: (v) => (v === 0 ? "Auto" : int(v)) },
  { key: "ufos.aggression", creativeOnly: true, group: "ufos", advanced: true, type: "range", label: "Aggression", min: 0, max: 2, step: 0.1, def: 1, fmt: (v) => (v === 0 ? "Never attack" : times(v)) },
  { key: "ufos.detection", creativeOnly: true, group: "ufos", advanced: true, type: "range", label: "Detection range (blocks)", min: 40, max: 300, step: 10, def: 130, fmt: int },
  { key: "ufos.beamLift", creativeOnly: true, group: "ufos", advanced: true, type: "range", label: "Tractor beam lift (blocks/s)", min: 1, max: 12, step: 0.5, def: 4, fmt: (v) => v.toFixed(1) },
  { key: "ufos.sizes", group: "ufos", creativeOnly: true, advanced: true, type: "select", label: "Sizes", choices: [["small", "Mostly small"], ["balanced", "Balanced"], ["big", "More big ones and motherships"]], def: "balanced" },
  { key: "ufos.nightMultiplier", creativeOnly: true, group: "ufos", advanced: true, type: "range", label: "Night activity multiplier", min: 1, max: 6, step: 0.5, def: 3, fmt: times },
  { key: "ufos.toughness", creativeOnly: true, group: "ufos", advanced: true, type: "range", label: "Toughness", min: 0.25, max: 4, step: 0.25, def: 1, fmt: times },

  // ----- Vehicles -----
  { key: "vehicles.ufoTopSpeed", creativeOnly: true, group: "vehicles", type: "range", label: "UFO top speed (blocks/s)", values: [20, 50, 100, 200, 300, 500, 800, 1200], min: 20, max: 1200, def: 300, fmt: int, sub: "Your UFO", hint: "The mouse wheel sets the cruising speed between the slowest and the top speed; Ctrl boosts it 3x.", note: (v) => (v >= 800 ? "Faster than the world can load: you'll outrun the terrain." : "") },
  { key: "vehicles.ufoMinSpeed", creativeOnly: true, group: "vehicles", type: "range", label: "UFO slowest speed (blocks/s)", values: [0.5, 1, 2, 4, 8], min: 0.5, max: 8, def: 2, fmt: (v) => String(v) },
  { key: "vehicles.ufoGhost", creativeOnly: true, group: "vehicles", type: "checkbox", label: "Ghost mode: fly through terrain, burning a tunnel", def: false },
  { key: "vehicles.ufoDash", creativeOnly: true, group: "vehicles", type: "range", label: "Teleport dash distance (R)", values: [0, 0.5, 1, 1.5, 2, 3], min: 0, max: 3, def: 1, fmt: (v) => (v <= 0 ? "Off" : `${v}x`), hint: "How far R dashes your UFO along the view (it grows with the cruise speed). Off disables the dash." },
  { key: "vehicles.ufoDashTime", creativeOnly: true, group: "vehicles", type: "range", label: "Teleport dash travel time", values: [0.08, 0.15, 0.25, 0.4, 0.6], min: 0.08, max: 0.6, def: 0.25, fmt: (v) => `${v} s`, hint: "How long the ultra-fast trip takes: shorter is nearly instant, longer lets you watch the world streak by." },
  { key: "vehicles.beamBlocks", creativeOnly: true, group: "vehicles", type: "checkbox", label: "Tractor beam also lifts loose blocks", def: true },
  { key: "vehicles.jetAssist", group: "vehicles", type: "checkbox", label: "Flight assist (the jet flies toward the crosshair)", def: true, sub: "Fighter jet", hint: "Off: the mouse is the stick (up/down pitch, left/right roll), for experienced pilots." },
  { key: "vehicles.jetAirborne", creativeOnly: true, group: "vehicles", type: "checkbox", label: "Called-in jet arrives airborne (you start in the cockpit)", def: false },
  { key: "vehicles.jetMaxSpeed", creativeOnly: true, group: "vehicles", type: "range", label: "Jet top speed (afterburner)", min: 80, max: 700, step: 10, def: 300, fmt: (v) => `${Math.round(v * 3.6)} km/h`, hint: "The afterburner top speed (100% throttle alone gives about 88% of it). The default is about 1080 km/h.", note: (v) => (v > 480 ? "This fast, the world can't always load in time: you'll outrun the terrain." : "") },
  { key: "vehicles.jetAimAssist", creativeOnly: true, group: "vehicles", type: "checkbox", label: "Cannon aim assist (pulls shots toward a target near the nose)", def: true },
  { key: "vehicles.enemyJets", creativeOnly: true, group: "vehicles", type: "range", label: "Patrol fighters at once", min: 0, max: 3, step: 1, def: 1, fmt: int, hint: "Fighters that hunt UFOs and leave you alone, unless you attack one of them: that one hunts you with missiles and guns. (Survival: from mission 10, 'Take to the air'.)" },
  { key: "vehicles.jetAccel", creativeOnly: true, group: "vehicles", type: "range", label: "Jet acceleration (thrust)", min: 0.5, max: 2.5, step: 0.1, def: 1, fmt: times },
  { key: "vehicles.jetTurn", creativeOnly: true, group: "vehicles", type: "range", label: "Jet turn rate", min: 0.5, max: 2, step: 0.1, def: 1, fmt: times },
  { key: "vehicles.jetStall", creativeOnly: true, group: "vehicles", type: "range", label: "Jet stall speed", min: 25, max: 70, step: 1, def: 42, fmt: (v) => `${Math.round(v * 3.6)} km/h`, hint: "Below this the wings can't hold the jet up: it sinks and drops its nose." },
];

const ACTIVITY_NAMES = ["Off", "Very rare", "Rare", "Occasional", "Normal", "Frequent", "Busy skies", "Invasion", "UFO APOCALYPSE"];

const SCHEMA_BY_KEY = new Map(SCHEMA.map((e) => [e.key, e]));

export function schemaEntry(key) {
  return SCHEMA_BY_KEY.get(key);
}

export function getPath(obj, path) {
  let o = obj;
  for (const k of path.split(".")) {
    if (o == null || typeof o !== "object") return undefined;
    o = o[k];
  }
  return o;
}

export function setPath(obj, path, value) {
  const keys = path.split(".");
  let o = obj;
  for (let i = 0; i < keys.length - 1; i++) {
    if (o[keys[i]] == null || typeof o[keys[i]] !== "object") o[keys[i]] = {};
    o = o[keys[i]];
  }
  o[keys[keys.length - 1]] = value;
}

// A valid value for schema entry `e` from whatever was saved.
export function validValue(e, raw) {
  if (e.type === "checkbox") return typeof raw === "boolean" ? raw : e.def;
  if (e.type === "select") return e.choices.some(([v]) => v === raw) ? raw : e.def;
  const n = Number(raw);
  if (raw === null || raw === undefined || raw === "" || !Number.isFinite(n)) return e.def;
  if (e.values) return e.values.reduce((best, v) => (Math.abs(v - n) < Math.abs(best - n) ? v : best), e.values[0]);
  return Math.max(e.min, Math.min(e.max, n));
}

// The settings object's format version (the `v` field). Older saves (no
// version) are read and upgraded; unknown or broken values fall back to
// their defaults.
export const SETTINGS_VERSION = 5;

export const DEFAULT_SETTINGS = {
  v: SETTINGS_VERSION,
  renderDistance: 15,
  // Whether the player set the render distance themselves (then picking a
  // graphics preset keeps it instead of adopting the preset's suggestion).
  renderDistanceCustom: false,
  graphics: "medium",
  gfxOverrides: {},
  volume: { master: 0.3, blocks: 1, weapons: 1, creatures: 1, player: 1, ui: 1 },
  mods: true,
};
for (const e of SCHEMA) setPath(DEFAULT_SETTINGS, e.key, e.def);

// Returns a complete, valid, current-version settings object from whatever
// was saved (nothing, an older version, or garbage). Only known settings are
// kept. opts (from the game, which knows its graphics presets and options):
// presets: valid preset names; defaultPreset; minRenderDistance,
// maxRenderDistance; isOverride(key, value): a valid individual graphics option.
export function normalizeSettings(raw, opts = {}) {
  const s = raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
  const out = { v: SETTINGS_VERSION };
  for (const e of SCHEMA) setPath(out, e.key, validValue(e, getPath(s, e.key)));
  // Render distance (chunks).
  const minRD = opts.minRenderDistance ?? 2;
  const maxRD = opts.maxRenderDistance ?? 256;
  const rd = Math.round(Number(s.renderDistance));
  out.renderDistance = Number.isFinite(rd) && s.renderDistance !== null && s.renderDistance !== "" ? Math.max(minRD, Math.min(maxRD, rd)) : DEFAULT_SETTINGS.renderDistance;
  out.renderDistanceCustom = s.renderDistanceCustom === true;
  // Graphics preset and individual options.
  const presets = opts.presets || ["low", "medium", "high", "ultra"];
  out.graphics = presets.includes(s.graphics) ? s.graphics : opts.defaultPreset || DEFAULT_SETTINGS.graphics;
  out.gfxOverrides = {};
  if (s.gfxOverrides && typeof s.gfxOverrides === "object" && !Array.isArray(s.gfxOverrides)) {
    for (const [k, val] of Object.entries(s.gfxOverrides)) {
      if (typeof val !== "string") continue;
      if (opts.isOverride && !opts.isOverride(k, val)) continue;
      out.gfxOverrides[k] = val;
    }
  }
  // Volumes 0-1 per category.
  out.volume = {};
  for (const [k] of AUDIO_CATEGORIES) {
    const raw = s.volume && typeof s.volume === "object" ? s.volume[k] : undefined;
    const n = Number(raw);
    out.volume[k] = raw !== null && raw !== undefined && raw !== "" && Number.isFinite(n) ? Math.max(0, Math.min(1, n)) : (k === "master" ? DEFAULT_SETTINGS.volume.master : 1);
  }
  out.mods = s.mods !== false;
  // Upgrades from older versions. (Round 2 raised the jet's default top
  // speed to 220; Round 3 went back to 160: a value still at that old
  // default follows it, once. Saves before Round 3 had no `v` and no `rev`.)
  if (!Number.isFinite(s.v) && (s.rev ?? 0) < 3 && out.vehicles.jetMaxSpeed === 220) out.vehicles.jetMaxSpeed = 160;
  // Round 5 made the jets much faster: a top speed still at the old default
  // follows the new one, once.
  if ((!Number.isFinite(s.v) || s.v < 5) && out.vehicles.jetMaxSpeed === 160) out.vehicles.jetMaxSpeed = 300;
  return out;
}

// "HH:MM" for a 0-24 clock time.
export function formatHours(h) {
  const hh = Math.floor(h) % 24;
  const mm = Math.floor((h - Math.floor(h)) * 60);
  return `${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}`;
}

// ---------- Settings screen ----------
// Switches tabs, builds a row for every schema setting that has no
// hand-written row in index.html, binds every row to the settings object,
// saves on change, and resets a group to its defaults.
export class SettingsPanel {
  // settings: the live settings object; save(): persists it.
  constructor(settings, save) {
    this.settings = settings;
    this.save = save;
    this.tabs = [...document.querySelectorAll(".settings-tab")];
    this.pages = [...document.querySelectorAll(".settings-page")];
    for (const tab of this.tabs) tab.addEventListener("click", () => this.show(tab.dataset.page));
    this._appliers = new Map(); // key -> [fn(value)]
    this._controls = new Map(); // key -> { set(value) }
    this._resetHooks = new Map(); // page -> [fn()]
    this._build();
    this.show("video");
  }

  show(page) {
    for (const t of this.tabs) t.classList.toggle("active", t.dataset.page === page);
    for (const p of this.pages) p.classList.toggle("hidden", p.dataset.page !== page);
    this.current = page;
  }

  // Current value of a schema setting.
  get(key) {
    return getPath(this.settings, key);
  }

  // Calls fn(value) whenever setting `key` changes, and once right away.
  on(key, fn, { now = true } = {}) {
    if (!this._appliers.has(key)) this._appliers.set(key, []);
    this._appliers.get(key).push(fn);
    if (now) fn(this.effective(key));
  }

  // The value the game really uses: in Survival the rule settings (the ones
  // that are Creative's) are always their defaults, whatever was set in
  // Creative; everything else is what the player chose.
  effective(key) {
    const e = SCHEMA_BY_KEY.get(key);
    if (this.survival && e?.creativeOnly) return e.def;
    return this.get(key);
  }

  // Changes a setting from code (updates its row, applies and saves it).
  set(key, value) {
    const e = SCHEMA_BY_KEY.get(key);
    const v = e ? validValue(e, value) : value;
    setPath(this.settings, key, v);
    this._controls.get(key)?.set(v);
    this._apply(key, v);
    this.save();
  }

  // Takes a value saved elsewhere (another tab of the game): updates the
  // row and applies it, without saving it again.
  adopt(key, value) {
    const e = SCHEMA_BY_KEY.get(key);
    const v = e ? validValue(e, value) : value;
    if (JSON.stringify(getPath(this.settings, key)) === JSON.stringify(v)) return false;
    setPath(this.settings, key, v);
    this._controls.get(key)?.set(v);
    this._apply(key, v);
    return true;
  }

  // Survival: the settings the mission chain decides (UFO numbers and
  // sizes) are hidden, with a note saying why. (Their values are kept for
  // Creative.)
  setSurvival(on) {
    this.survival = !!on;
    for (const el of this._creativeOnly) el.classList.toggle("survival-hidden", this.survival);
    for (const el of document.querySelectorAll(".creative-only")) el.classList.toggle("survival-hidden", this.survival);
    // The game now uses the defaults (Survival) or the saved values (Creative) of the rule settings.
    for (const e of SCHEMA) if (e.creativeOnly) for (const fn of this._appliers.get(e.key) || []) fn(this.effective(e.key));
    document.getElementById("ufo-survival-note")?.classList.toggle("hidden", !this.survival);
    // The Survival note on every page that lost rules, and no sub-heading left without rows under it.
    for (const page of document.querySelectorAll(".settings-page")) {
      const note = this._survivalNote(page);
      if (note) note.classList.toggle("hidden", !this.survival);
      for (const h of page.querySelectorAll(".subhead")) {
        let any = false;
        for (let el = h.nextElementSibling; el && !el.classList.contains("subhead"); el = el.nextElementSibling) {
          if (el.classList.contains("row") && !el.classList.contains("survival-hidden")) any = true;
        }
        h.classList.toggle("survival-hidden", this.survival && !any);
      }
    }
  }

  // The "Creative only" note at the top of a page that has rule settings.
  _survivalNote(page) {
    const has = page.querySelector(".survival-hidden") || this._creativeOnly.some((el) => page.contains(el));
    if (!has || page.dataset.page === "ufos") return null;
    let note = page.querySelector(".survival-note");
    if (!note) {
      note = document.createElement("div");
      note.className = "hint survival-note hidden";
      note.textContent = "Survival: the rules of the game (weapon stats, creature and UFO numbers, vehicle performance, the clock) are fixed so every run is balanced. Those settings are Creative's.";
      page.insertBefore(note, page.firstChild);
    }
    return note;
  }

  // Extra work for a group's "Reset to defaults" (hand-written settings).
  onReset(page, fn) {
    if (!this._resetHooks.has(page)) this._resetHooks.set(page, []);
    this._resetHooks.get(page).push(fn);
  }

  resetGroup(page) {
    for (const e of SCHEMA) if (e.group === page) this.set(e.key, e.def);
    for (const fn of this._resetHooks.get(page) || []) fn();
    this.save();
  }

  _apply(key, v) {
    const e = SCHEMA_BY_KEY.get(key);
    const used = this.survival && e?.creativeOnly ? e.def : v;
    for (const fn of this._appliers.get(key) || []) fn(used);
    const note = this._notes?.get(key);
    if (note && e?.note) {
      const text = e.note(v);
      note.textContent = text ? `⚠ ${text}` : "";
      note.classList.toggle("hidden", !text);
    }
  }

  _build() {
    this._notes = new Map();
    this._creativeOnly = []; // rows (and their hints) hidden in Survival
    const pageEl = (page) => document.querySelector(`.settings-page[data-page="${page}"]`);
    const lastSub = new Map();
    for (const e of SCHEMA) {
      const page = pageEl(e.group);
      if (!page) continue;
      let input;
      if (e.static) {
        input = document.getElementById(e.id);
        if (!input) continue;
        if (e.creativeOnly) {
          const row = input.closest(".row");
          if (row) this._creativeOnly.push(row);
        }
      } else {
        const container = page.querySelector(e.advanced ? ".auto-rows-advanced" : ".auto-rows") || page;
        if (e.sub && lastSub.get(e.group + !!e.advanced) !== e.sub) {
          const h = document.createElement("div");
          h.className = "subhead";
          h.textContent = e.sub;
          container.appendChild(h);
          lastSub.set(e.group + !!e.advanced, e.sub);
        }
        const id = e.id || e.key.replace(/\./g, "-");
        const row = document.createElement("div");
        row.className = "row";
        const label = document.createElement("label");
        label.textContent = e.label;
        label.htmlFor = id;
        row.appendChild(label);
        if (e.type === "range") {
          input = document.createElement("input");
          input.type = "range";
          input.min = String(e.values ? 0 : e.min);
          input.max = String(e.values ? e.values.length - 1 : e.max);
          input.step = String(e.values ? 1 : e.step);
          const val = document.createElement("span");
          val.className = "val";
          val.id = `${id}-value`;
          row.append(input, val);
        } else if (e.type === "select") {
          input = document.createElement("select");
          for (const [v, text] of e.choices) {
            const o = document.createElement("option");
            o.value = v;
            o.textContent = text;
            input.appendChild(o);
          }
          row.appendChild(input);
        } else {
          input = document.createElement("input");
          input.type = "checkbox";
          row.appendChild(input);
        }
        input.id = id;
        container.appendChild(row);
        if (e.creativeOnly) this._creativeOnly.push(row);
        if (e.hint) {
          const hint = document.createElement("div");
          hint.className = "hint";
          hint.textContent = e.hint;
          container.appendChild(hint);
          if (e.creativeOnly) this._creativeOnly.push(hint);
        }
        if (e.note) {
          const note = document.createElement("div");
          note.className = "hint perf-note hidden";
          container.appendChild(note);
          this._notes.set(e.key, note);
        }
      }
      this._bind(e, input);
    }
    // Every group gets a "Reset to defaults" button.
    for (const { page } of SETTING_GROUPS) {
      const el = pageEl(page);
      if (!el || el.querySelector(".reset-group-btn")) continue;
      const bar = document.createElement("div");
      bar.className = "menu-buttons small";
      const btn = document.createElement("button");
      btn.className = "btn secondary reset-group-btn";
      btn.dataset.page = page;
      btn.textContent = "Reset to defaults";
      btn.addEventListener("click", () => this.resetGroup(page));
      bar.appendChild(btn);
      el.appendChild(bar);
    }
    // "Advanced" folds.
    for (const toggle of document.querySelectorAll(".advanced-toggle")) {
      toggle.addEventListener("click", () => {
        const box = toggle.nextElementSibling;
        const open = box.classList.toggle("hidden") === false;
        toggle.textContent = `${open ? "▾" : "▸"} Advanced`;
      });
    }
  }

  _bind(e, input) {
    const label = e.type === "range" ? document.getElementById(`${input.id}-value`) : null;
    const fmt = e.fmt || ((v) => String(v));
    const show = (v) => {
      if (e.type === "checkbox") input.checked = !!v;
      else if (e.values) input.value = String(Math.max(0, e.values.indexOf(v)));
      else input.value = String(v);
      if (label) label.textContent = fmt(Number(v));
    };
    this._controls.set(e.key, { set: show });
    show(this.get(e.key));
    const onChange = () => {
      const raw = e.type === "checkbox" ? input.checked : e.values ? e.values[Number(input.value)] : e.type === "range" ? Number(input.value) : input.value;
      const v = validValue(e, raw);
      setPath(this.settings, e.key, v);
      if (label) label.textContent = fmt(v);
      this._apply(e.key, v);
      this.save();
    };
    input.addEventListener(e.type === "range" ? "input" : "change", onChange);
    // Show any warning for the saved value.
    if (e.note) this._apply(e.key, this.get(e.key));
  }

  // Binds a hand-written range input + its value label. format(v) -> label
  // text. (Settings with custom behavior, like the time of day.)
  static range(id, value, format, onInput) {
    const input = document.getElementById(id);
    const label = document.getElementById(`${id}-value`);
    input.value = String(value);
    if (label) label.textContent = format(Number(value));
    input.addEventListener("input", () => {
      const v = Number(input.value);
      if (label) label.textContent = format(v);
      onInput(v);
    });
    return {
      input,
      set(v) {
        input.value = String(v);
        if (label) label.textContent = format(Number(v));
      },
    };
  }
}
