// Creative hacks (Round 15): cheats for Creative, in either world type, from
// the pause menu's Hacks screen (js/hacks-ui.js). Weapons (no reload and
// infinite ammo, rapid fire, bigger explosions, one-hit kills, explosive
// ammo, a super punch), hand powers on the right button with an empty hand
// (chain lightning, a gravity gun, nuke rain), the body (god mode, super
// speed and jump, low gravity, faster flight, ghost flight, a jetpack, tiny
// or giant), building (super reach, area mining, instant mining and
// building), the world (x-ray, night vision, the clock, bullet time on Z,
// frozen creatures, a creature army, smite), vehicles (turbo, no dash
// cooldown; no reload and no overheat reach them too) and a party (fireworks
// on kills, a rainbow trail).
//
// How it reaches the game: `H` holds the effective values, every one neutral
// (1, false, 0, "") unless the hacks are allowed: this player in Creative,
// not in a Dogfight room. The modules that own the behaviour read it on
// their hot paths (weapons.js, player.js, effects.js, interaction.js); the
// rest is done here, per frame (HackSystem.update), or through thin wrappers
// installed once on the game's objects (the creatures' and UFOs' damage for
// one-hit kills, the vehicles' update for turbo, the seated vehicle's damage
// for god mode), each a pass-through while its hack is off. Switching to
// Survival turns every hack off (and clears them).
//
// Online the hacks are each player's own: a guest's hacks change what that
// guest controls (their weapons, body, vehicle, their own hits and blasts:
// claims and edits as usual); what the host runs follows the host's hacks
// (its creatures frozen, its clock, TNT). The clock and frozen creatures
// are the host's (or a single player's); bullet time is single player only.
// The choices are kept per world in localStorage.
import * as THREE from "three";
import { BLOCK, BLOCK_INFO, BLOCK_LIMIT, IS_SOLID, IS_CHEST, SHAPE, SHAPE_OF } from "./blocks.js";
import { LAYER_FX } from "./layers.js";
import { worldUniforms } from "./shaders.js";
import { WORLD_HEIGHT } from "./constants.js";
import { BLOCK_USE } from "./content/index.js";

// ---------- The hacks ----------

export const HACK_GROUPS = [
  ["weapons", "Weapons"],
  ["powers", "Hand powers"],
  ["body", "Body"],
  ["build", "Mining and building"],
  ["world", "World and vision"],
  ["mobs", "Creatures"],
  ["vehicles", "Vehicles"],
  ["party", "Party"],
];

const times = (v) => `x${Number(v).toFixed(v % 1 ? 1 : 0)}`;

// type: toggle | range (min, max, step, fmt) | choice (options: [value, label]);
// host: only the host (or a single player) can use it online; solo: single player only.
export const HACK_DEFS = [
  { key: "noReload", group: "weapons", type: "toggle", label: "No reload, infinite ammo", hint: "Every weapon, and the vehicles' guns, missiles, rockets, shells and flares" },
  { key: "noOverheat", group: "weapons", type: "toggle", label: "No overheat", hint: "The laser minigun, the jets' and helicopters' cannons, the UFOs' beams" },
  { key: "fireRate", group: "weapons", type: "range", min: 1, max: 5, step: 0.5, fmt: times, label: "Rapid fire", hint: "Hand weapons fire, draw, charge and reload faster" },
  { key: "blastMul", group: "weapons", type: "range", min: 1, max: 10, step: 0.5, fmt: times, label: "Explosion size", hint: "Your grenades, rockets, meteors, missiles, shells and TNT (TNT: the host's setting online)" },
  { key: "oneHit", group: "weapons", type: "toggle", label: "One-hit kills", hint: "Creatures, UFOs and the dragon go down in one hit (not other players)" },
  { key: "explosiveAmmo", group: "weapons", type: "toggle", label: "Explosive ammo", hint: "Bullets, laser bolts and arrows blow up where they land" },
  { key: "superPunch", group: "weapons", type: "toggle", label: "Super punch", hint: "Your blows and shots send creatures flying" },
  { key: "power", group: "powers", type: "choice", label: "Power in an empty hand", hint: "Right click with nothing in hand", options: [["", "Off"], ["lightning", "Chain lightning"], ["gravity", "Gravity gun"], ["nuke", "Nuke rain"]] },
  { key: "nukeSize", group: "powers", type: "range", min: 12, max: 30, step: 1, def: 14, fmt: (v) => `${v}`, label: "Nuke rain size", hint: "Three nukes fall around the spot you point at" },
  { key: "godMode", group: "body", type: "toggle", label: "God mode", hint: "Creative already takes no damage: no knockback either, and your vehicle can't be hurt" },
  { key: "speedMul", group: "body", type: "range", min: 1, max: 6, step: 0.5, fmt: times, label: "Super speed" },
  { key: "jumpMul", group: "body", type: "range", min: 1, max: 12, step: 1, fmt: times, label: "Super jump (height)" },
  { key: "gravity", group: "body", type: "choice", label: "Gravity", options: [[1, "Earth"], [0.38, "Mars"], [0.165, "Moon"], [0.05, "Feather"]] },
  { key: "flyMul", group: "body", type: "range", min: 1, max: 6, step: 0.5, fmt: times, label: "Fly speed" },
  { key: "noclip", group: "body", type: "toggle", label: "Ghost flight", hint: "While flying, through blocks" },
  { key: "jetpack", group: "body", type: "toggle", label: "Jetpack", hint: "Hold Space in the air" },
  { key: "size", group: "body", type: "choice", label: "Size", def: 1, options: [[0.3, "Tiny"], [0.6, "Small"], [1, "Normal"], [2, "Big"], [3, "Giant"]], hint: "Grows only where there is room. Others online see you at your normal size" },
  { key: "reach", group: "build", type: "range", min: 6, max: 64, step: 2, fmt: (v) => `${v} blocks`, label: "Super reach" },
  { key: "mineArea", group: "build", type: "choice", label: "Mine an area", options: [[1, "1 block"], [3, "3x3x3"], [5, "5x5x5"]] },
  { key: "fastMine", group: "build", type: "toggle", label: "Instant mining and building", hint: "Hold the button: no wait between blocks" },
  { key: "xray", group: "world", type: "toggle", label: "X-ray", hint: "Ores, chests and spawners glow through the rock around you" },
  { key: "nightVision", group: "world", type: "toggle", label: "Night vision" },
  { key: "dayClock", group: "world", type: "choice", host: true, label: "Clock", options: [["normal", "Normal"], ["frozen", "Frozen"], ["fast", "x20"], ["hyper", "x120"]] },
  { key: "bulletTime", group: "world", type: "choice", solo: true, label: "Bullet time (Z)", hint: "Z slows the whole world down (single player)", options: [[0, "Off"], [0.5, "Half"], [0.25, "Quarter"], [0.1, "Tenth"]] },
  { key: "freezeMobs", group: "mobs", type: "toggle", host: true, label: "Freeze creatures", hint: "They stand still and don't attack" },
  { key: "armyKind", group: "mobs", type: "choice", label: "Army", options: [["zombie", "Zombies"], ["skeleton", "Skeletons"], ["creeper", "Creepers"], ["iron_golem", "Iron golems"], ["wolf", "Wolves"], ["chicken", "Chickens"]] },
  { key: "turbo", group: "vehicles", type: "range", min: 1, max: 4, step: 1, fmt: times, label: "Turbo", hint: "Your vehicle runs this many times as fast (everything it does)" },
  { key: "infiniteBoost", group: "vehicles", type: "toggle", label: "Infinite boost", hint: "The UFO's teleport dash and superweapon with no cooldown" },
  { key: "killFx", group: "party", type: "toggle", label: "Fireworks on kills" },
  { key: "trail", group: "party", type: "toggle", label: "Rainbow trail", hint: "Behind you, and behind your vehicle" },
];

// (Off: a toggle false, a slider at its least, a choice at its `def` or first option.)
const DEFAULTS = {};
for (const d of HACK_DEFS) DEFAULTS[d.key] = d.def ?? (d.type === "toggle" ? false : d.type === "range" ? d.min : d.options[0][0]);
// The settings that only configure a hack (not a hack themselves).
const CONFIG_ONLY = new Set(["nukeSize", "armyKind"]);

// The effective values: what the game reads. Neutral unless allowed.
export const H = { ...DEFAULTS, active: false };

// Whether a value is a hack turned on (for the HUD's list).
function isOn(key, v) {
  return !CONFIG_ONLY.has(key) && v !== DEFAULTS[key];
}

const STORE_KEY = (seed) => `ufocombat_v1_hacks_${seed}`;
const ARMY_SIZE = 10;
const LIGHTNING_RANGE = 70;
const LIGHTNING_JUMP = 11;
const LIGHTNING_HOPS = 7;
const LIGHTNING_DAMAGE = 16;
const GRAVITY_RANGE = 45;
const NUKE_RAIN_COOLDOWN = 7;
const XRAY_RADIUS = 20;
const XRAY_MAX = 1600;
const KILL_FX_WINDOW = 4; // s: a creature hit by this player that dies this soon after gets fireworks

// ---------- X-ray: what glows ----------

let XRAY_COLOR = null; // block id -> index into XRAY_PALETTE + 1 (0: not shown)
const XRAY_PALETTE = [
  [/diamond/i, 0x40f0ff],
  [/emerald/i, 0x30ff70],
  [/gold/i, 0xffd23a],
  [/iron/i, 0xe8b48a],
  [/copper/i, 0xff8a40],
  [/redstone/i, 0xff3030],
  [/lapis/i, 0x3a6aff],
  [/coal/i, 0x8a8a8a],
  [/quartz/i, 0xf4f0e8],
  [/ancient debris/i, 0xb06a40],
  [/chest|barrel|shulker box/i, 0xffa020],
  [/spawner/i, 0xd040ff],
];
function xrayTable() {
  if (XRAY_COLOR) return XRAY_COLOR;
  XRAY_COLOR = new Uint8Array(BLOCK_LIMIT);
  for (const info of Object.values(BLOCK_INFO)) {
    const name = info?.name || "";
    if (!/ ore$|ancient debris|chest|barrel|shulker box|spawner/i.test(name) || /^potted/i.test(name)) continue;
    const k = XRAY_PALETTE.findIndex(([re]) => re.test(name));
    XRAY_COLOR[info.id] = k >= 0 ? k + 1 : 1;
  }
  return XRAY_COLOR;
}

function outlineTexture() {
  const c = document.createElement("canvas");
  c.width = c.height = 32;
  const g = c.getContext("2d");
  g.fillStyle = "rgba(255,255,255,0.16)";
  g.fillRect(0, 0, 32, 32);
  g.strokeStyle = "rgba(255,255,255,1)";
  g.lineWidth = 4;
  g.strokeRect(2, 2, 28, 28);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

const RAINBOW = [0xff3040, 0xff8a20, 0xffe030, 0x40ff50, 0x30d0ff, 0x4060ff, 0xb040ff, 0xff40c0].map((h) => new THREE.Color(h).multiplyScalar(2.2));

export class HackSystem {
  // ctx: the game's objects (main.js): player, world, scene, camera, effects,
  // weapons, interaction, mobs, ufos, vehicles, nuke, sky, audio, avatar,
  // mp, net, seed, getState() (main's gameState), toast(text, s), openScreen(id).
  constructor(ctx) {
    this.ctx = ctx;
    this.values = { ...DEFAULTS };
    this.allowed = false;
    this.slowmo = false; // bullet time engaged (Z)
    this._clockSet = false; // the clock hack changed sky.timeScale
    this._frozen = false;
    this._godVeh = null; // the vehicle whose damage is wrapped
    this._recent = []; // [{ m, t }]: creatures this player hit (fireworks on their death)
    this._time = 0;
    this._hudT = 0;
    this._xrayT = 0;
    this._xrayAt = new THREE.Vector3(1e9, 0, 0);
    this._armyQueue = [];
    this._armyT = 0;
    this._nukes = []; // falling nukes: { pos, vel, t, at }
    this._nukeCd = 0;
    this._lightCd = 0;
    this._bolts = []; // lightning lines alive
    this.grab = null; // the gravity gun's: { mob } | { id, home: [x, y, z], mesh }
    this._thrown = []; // blocks thrown: { id, pos, vel, mesh, t }
    this._v = new THREE.Vector3();
    this._w = new THREE.Vector3();
    this.listeners = []; // (values) => void: the screen refreshes
    this._load();
    this._apply();
    this._install();
  }

  // ---------- State ----------

  get online() {
    return !!this.ctx.mp?.active;
  }

  // This machine runs the world (single player, or the host online).
  get isHost() {
    return !this.online || !!this.ctx.net?.isHost;
  }

  // Whether this hack can be used here (online limits).
  usable(def) {
    if (def.solo) return !this.online;
    if (def.host) return this.isHost;
    return true;
  }

  // Bullet time's factor on the simulation step (main.js), 1 when off.
  get timeWarp() {
    return this.slowmo && H.active && H.bulletTime > 0 && !this.online ? H.bulletTime : 1;
  }

  set(key, value) {
    const def = HACK_DEFS.find((d) => d.key === key);
    if (!def) return false;
    if (def.type === "toggle") value = !!value;
    else if (def.type === "range") {
      value = Number(value);
      if (!Number.isFinite(value)) return false;
      value = Math.max(def.min, Math.min(def.max, value));
    } else if (!def.options.some(([v]) => v === value)) {
      const o = def.options.find(([v]) => String(v) === String(value));
      if (!o) return false;
      value = o[0];
    }
    this.values[key] = value;
    this._apply();
    this._save();
    return true;
  }

  reset() {
    this.values = { ...DEFAULTS };
    this.slowmo = false;
    this._apply();
    this._save();
  }

  _load() {
    try {
      const raw = localStorage.getItem(STORE_KEY(this.ctx.seed));
      const v = raw ? JSON.parse(raw) : null;
      if (v && typeof v === "object") for (const d of HACK_DEFS) if (Object.hasOwn(v, d.key)) this.set(d.key, v[d.key]);
    } catch {
      // (none kept, or storage off: the defaults)
    }
  }

  _save() {
    try {
      const out = {};
      for (const k in this.values) if (this.values[k] !== DEFAULTS[k]) out[k] = this.values[k];
      if (Object.keys(out).length) localStorage.setItem(STORE_KEY(this.ctx.seed), JSON.stringify(out));
      else localStorage.removeItem(STORE_KEY(this.ctx.seed));
    } catch {
      // (storage full or off: kept for this session)
    }
  }

  // The effective values: the player's picks while allowed, else neutral.
  _apply() {
    const on = this.allowed;
    for (const d of HACK_DEFS) {
      let v = on ? this.values[d.key] : DEFAULTS[d.key];
      if (on && !this.usable(d)) v = DEFAULTS[d.key];
      H[d.key] = v;
    }
    H.active = on;
    if (!on || !H.power) this._dropGrab();
    for (const fn of this.listeners) fn(this.values);
  }

  // The hacks turned on now (for the HUD and the screen).
  activeList() {
    if (!this.allowed) return [];
    const out = [];
    for (const d of HACK_DEFS) {
      if (!isOn(d.key, this.values[d.key]) || !this.usable(d)) continue;
      const v = this.values[d.key];
      if (d.type === "toggle") out.push(d.label);
      else if (d.type === "range") out.push(`${d.label} ${d.fmt ? d.fmt(v) : v}`);
      else out.push(`${d.label}: ${d.options.find(([o]) => o === v)?.[1] ?? v}`);
    }
    return out;
  }

  // ---------- Hooks on the game ----------

  _install() {
    const { mobs, ufos, vehicles, interaction } = this.ctx;
    // One-hit kills and the super punch: this player's own hits (on the host,
    // a guest's claim arrives with currentAttacker set, and isn't boosted;
    // another player in PvP is never one-shot).
    if (mobs) {
      const hurt = mobs._hurt.bind(mobs);
      mobs._hurt = (m, amount, dir, kb, byPlayer = false) => {
        if (byPlayer && H.active && m && !m.isRemotePlayer && mobs.currentAttacker == null) {
          if (H.oneHit && amount > 0) amount = Math.max(amount, (m.health ?? 0) + 1000);
          if (H.superPunch && dir) kb = kb * 3 + 22;
          this._noteHit(m);
        }
        return hurt(m, amount, dir, kb, byPlayer);
      };
    }
    if (ufos) {
      const damage = ufos.damage.bind(ufos);
      ufos.damage = (u, amount, byPlayer = true, from = null, attacker = null) => {
        if (byPlayer && H.oneHit && amount > 0 && u && ufos.currentAttacker == null && !attacker) amount = Math.max(amount, (u.health ?? 0) + 5000);
        return damage(u, amount, byPlayer, from, attacker);
      };
    }
    // Turbo: the seated vehicle runs extra steps of its own each frame (held
    // buttons and keys, no new presses or mouse moves), then the frame's
    // ordinary update (which seats the player and takes the input).
    if (vehicles) {
      const update = vehicles.update.bind(vehicles);
      const extra = { dx: 0, dy: 0, buttons: null, wheel: 0, pressed: new Set(), keys: null };
      vehicles.update = (dt, ...rest) => {
        const v = vehicles.active;
        const n = Math.round(H.turbo);
        if (n > 1 && v && v.alive !== false && vehicles.enabled && !v.puppet) {
          extra.buttons = vehicles.input.buttons;
          extra.keys = vehicles.input.keys;
          for (let i = 1; i < n && vehicles.active === v && v.alive !== false; i++) {
            extra.pressed.clear();
            extra.dx = extra.dy = extra.wheel = 0;
            v.update(dt, extra);
          }
        }
        return update(dt, ...rest);
      };
    }
    if (interaction) interaction.powers = this;
    // Z: bullet time.
    window.addEventListener("keydown", (e) => {
      if (e.code !== "KeyZ" || e.repeat || this.ctx.getState?.() !== "playing") return;
      if (!H.active || !(this.values.bulletTime > 0)) return;
      if (this.online) {
        this.ctx.toast?.("Bullet time is single player only", 2);
        return;
      }
      this.slowmo = !this.slowmo;
      this.ctx.audio?.playFlightToggle?.();
      this.ctx.toast?.(this.slowmo ? "Bullet time" : "Normal time", 1.2);
    });
    // The HUD line.
    this.hudEl = document.createElement("div");
    this.hudEl.id = "hack-hud";
    this.hudEl.className = "hidden";
    document.body.appendChild(this.hudEl);
    // X-ray boxes.
    this._xray = null;
    // Lightning lines (a small pool).
    this._lineMat = new THREE.LineBasicMaterial({ color: new THREE.Color(1.4, 1.8, 4), transparent: true, opacity: 1, depthWrite: false, blending: THREE.AdditiveBlending, fog: false });
    this._boltPool = [];
    // Colors for the jetpack and the smite.
    this._c = { flame: new THREE.Color(3, 1.5, 0.4), flame2: new THREE.Color(0.6, 0.2, 0.05), spark: new THREE.Color(1.6, 2, 4), smoke: new THREE.Color(0.45, 0.45, 0.47), nuke: new THREE.Color(4, 2.2, 0.8) };
  }

  _noteHit(m) {
    if (!H.killFx) return;
    const r = this._recent;
    for (const e of r) if (e.m === m) {
      e.t = this._time;
      return;
    }
    if (r.length >= 32) r.shift();
    r.push({ m, t: this._time });
  }

  // ---------- Per frame ----------

  // running: the world runs this frame (not the single-player pause or the
  // main menu): only the HUD and the night vision otherwise.
  update(dt, running = true) {
    const { player, mp } = this.ctx;
    const allowed = !!player.creative && mp?.mode !== "dogfight";
    if (allowed !== this.allowed) {
      const was = this.allowed;
      this.allowed = allowed;
      // (Out of Creative: every hack off, and cleared.)
      if (was && !allowed && !player.creative) {
        this.values = { ...DEFAULTS };
        this.slowmo = false;
        this._save();
      }
      this._apply();
    }
    // (Online, the host's or a lone player's hacks may come and go: re-check the limits now and then.)
    if (this.allowed && (this._roleT = (this._roleT ?? 0) - dt) <= 0) {
      this._roleT = 1;
      const sig = `${this.online}|${this.isHost}`;
      if (sig !== this._role) {
        this._role = sig;
        if (this.online) this.slowmo = false;
        this._apply();
      }
    }
    if (this.timeWarp === 1 && this.slowmo && (!H.active || this.online)) this.slowmo = false;
    const slow = this.timeWarp !== 1;
    if (slow !== this._slowShown) {
      this._slowShown = slow;
      document.body.classList.toggle("hack-slowmo", slow);
    }

    // Night vision (after main.js set it from the potions this frame).
    if (H.nightVision) worldUniforms.uNightVision.value = 1;
    if (!running) {
      this._updateHud(dt);
      return;
    }
    this._time += dt;
    this._updateClock();
    this._updateFreeze();
    this._updateVehicle();
    this._updateBody(dt);
    this._updateXray(dt);
    this._updateKills();
    this._updateArmy(dt);
    this._updatePowers(dt);
    this._updateHud(dt);
  }

  // The clock (the host's or a single player's: guests follow the host's sky).
  _updateClock() {
    const sky = this.ctx.sky;
    if (!sky) return;
    const mode = H.dayClock;
    if (mode && mode !== "normal") {
      sky.timeScale = mode === "frozen" ? 0 : mode === "fast" ? 20 : 120;
      this._clockSet = true;
    } else if (this._clockSet) {
      this._clockSet = false;
      sky.timeScale = 1;
    }
  }

  // Set the time of day (the screen's buttons).
  setTime(hours) {
    if (!H.active || !this.isHost || !this.ctx.sky) return false;
    this.ctx.sky.setHours(hours);
    this.ctx.sendTime?.();
    return true;
  }

  // Frozen creatures: no steps of their own, no attacks (where this machine runs them).
  _updateFreeze() {
    const mobs = this.ctx.mobs;
    if (!mobs) return;
    const on = H.freezeMobs && !mobs.puppets;
    if (!on) return;
    for (const m of mobs.mobs) {
      if (m.dead || m.spec?.projectile) continue;
      m.stagger = Math.max(m.stagger || 0, 0.25);
      m.attackCooldown = Math.max(m.attackCooldown || 0, 0.25);
      if (m.fuse > 0) m.fuse = 0;
      if (m.spec?.flies && m.vel) m.vel.set(0, 0, 0);
    }
  }

  // The seated vehicle: ammo, heat, cooldowns, god mode.
  _updateVehicle() {
    const vehicles = this.ctx.vehicles;
    const v = vehicles?.active || null;
    // God mode's wrapper on the seated vehicle's damage (taken off when it's not).
    const want = H.godMode && v && !v.puppet ? v : null;
    if (this._godVeh && this._godVeh !== want) {
      if (Object.hasOwn(this._godVeh, "damage") && this._godVeh.damage === this._godVeh._hackDamage) delete this._godVeh.damage;
      delete this._godVeh._hackDamage;
      this._godVeh = null;
    }
    if (want && this._godVeh !== want && !Object.hasOwn(want, "damage")) {
      want._hackDamage = () => false;
      want.damage = want._hackDamage;
      this._godVeh = want;
    }
    if (!v || v.puppet || !H.active) return;
    if (H.godMode && Number.isFinite(v.maxHealth) && v.alive !== false && v.health < v.maxHealth) v.health = v.maxHealth;
    if (H.noReload) {
      for (const k of ["missileT", "rocketT", "flareT", "nukeT"]) if (typeof v[k] === "number" && v[k] > 0.25) v[k] = 0.25;
      if (typeof v.reloadT === "number" && v.reloadT > 0.15) v.reloadT = 0.15;
      if (typeof v.telReloadT === "number" && v.telReloadT > 0.5) v.telReloadT = 0.5;
      if (typeof v.rockets === "number" && v.spec?.rockets > 0) v.rockets = v.spec.rockets;
      if (typeof v.missilesLeft === "number" && v.spec?.missiles > 0) v.missilesLeft = v.spec.missiles;
      if (v.sw && typeof v.sw.cool === "number" && v.sw.cool > 0) v.sw.cool = 0;
    }
    if (H.noOverheat) {
      if (typeof v.heat === "number") v.heat = 0;
      if (v.jammed === true) v.jammed = false;
      if (v.gun && typeof v.gun.heat === "number") {
        v.gun.heat = 0;
        v.gun.overheated = false;
      }
    }
    if (H.infiniteBoost) {
      if (typeof v.dashT === "number" && !v.dashing) v.dashT = 0;
      if (v.sw && typeof v.sw.cool === "number") v.sw.cool = 0;
    }
  }

  // The body: its size on the third-person model, the jetpack's flame, the rainbow trail.
  _updateBody(dt) {
    const { player, avatar, effects, vehicles } = this.ctx;
    if (avatar?.root) avatar.root.scale.setScalar(player.size || 1);
    if (!effects) return;
    const p = player.position;
    if (player.jetting) {
      for (let i = 0; i < 2; i++) {
        effects.glow.spawn({ x: p.x + (Math.random() - 0.5) * 0.3, y: p.y + 0.2, z: p.z + (Math.random() - 0.5) * 0.3, vx: (Math.random() - 0.5) * 1.5, vy: -7 - Math.random() * 4, vz: (Math.random() - 0.5) * 1.5, life: 0.25 + Math.random() * 0.15, size0: 0.35, size1: 0.05, color0: this._c.flame, color1: this._c.flame2, alpha: 0.9, drag: 2 });
      }
      if (Math.random() < 0.3) effects.smoke.spawn({ x: p.x, y: p.y - 0.2, z: p.z, vx: 0, vy: -1, vz: 0, life: 1, size0: 0.4, size1: 1.4, color0: this._c.smoke, alpha: 0.3, drag: 1.5 });
    }
    if (H.trail) {
      const v = vehicles?.active;
      const src = v ? v.pos : p;
      const last = this._trailAt || (this._trailAt = src.clone());
      const moved = last.distanceTo(src);
      if (moved > 0.35 && moved < 60) {
        const n = Math.min(4, Math.ceil(moved / 0.6));
        for (let i = 0; i < n; i++) {
          const t = i / n;
          const c = RAINBOW[Math.floor(this._time * 8 + i) % RAINBOW.length];
          effects.glow.spawn({ x: last.x + (src.x - last.x) * t, y: last.y + (src.y - last.y) * t + (v ? 0 : 0.3), z: last.z + (src.z - last.z) * t, life: v ? 1.6 : 1, size0: v ? 1.6 : 0.45, size1: 0.05, color0: c, alpha: 0.85, drag: 3 });
        }
      }
      last.copy(src);
    } else this._trailAt = null;
  }

  // X-ray: a glowing box on every ore, chest and spawner within XRAY_RADIUS
  // (rescanned now and then, seen through everything).
  _updateXray(dt) {
    const { world, player, scene } = this.ctx;
    if (!H.xray) {
      if (this._xray) this._xray.visible = false;
      this._xrayAt.set(1e9, 0, 0);
      return;
    }
    if (!this._xray) {
      const mat = new THREE.MeshBasicMaterial({ map: outlineTexture(), transparent: true, depthTest: false, depthWrite: false, blending: THREE.AdditiveBlending, fog: false });
      const mesh = new THREE.InstancedMesh(new THREE.BoxGeometry(1.02, 1.02, 1.02), mat, XRAY_MAX);
      mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(XRAY_MAX * 3), 3);
      mesh.count = 0;
      mesh.frustumCulled = false;
      mesh.renderOrder = 30;
      mesh.layers.set(LAYER_FX);
      scene.add(mesh);
      this._xray = mesh;
      this._xrayColors = XRAY_PALETTE.map(([, hex]) => new THREE.Color(hex).multiplyScalar(0.9));
    }
    this._xray.visible = true;
    this._xrayT -= dt;
    const p = player.position;
    if (this._xrayT > 0 && this._xrayAt.distanceToSquared(p) < 9) return;
    this._xrayT = 1;
    this._xrayAt.copy(p);
    const table = xrayTable();
    const mesh = this._xray;
    const m4 = new THREE.Matrix4();
    let n = 0;
    const R = XRAY_RADIUS;
    const px = Math.floor(p.x);
    const py = Math.floor(p.y);
    const pz = Math.floor(p.z);
    const y0 = Math.max(0, py - R);
    const y1 = Math.min(WORLD_HEIGHT - 1, py + R);
    for (let cx = (px - R) >> 4; cx <= (px + R) >> 4 && n < XRAY_MAX; cx++) {
      for (let cz = (pz - R) >> 4; cz <= (pz + R) >> 4 && n < XRAY_MAX; cz++) {
        const chunk = world.getChunk(cx, cz);
        const blocks = chunk?.blocks;
        if (!blocks) continue;
        const xa = Math.max(cx * 16, px - R);
        const xb = Math.min(cx * 16 + 15, px + R);
        const za = Math.max(cz * 16, pz - R);
        const zb = Math.min(cz * 16 + 15, pz + R);
        for (let y = y0; y <= y1 && n < XRAY_MAX; y++) {
          const row = y << 8;
          for (let z = za; z <= zb; z++) {
            const col = row | ((z & 15) << 4);
            for (let x = xa; x <= xb; x++) {
              const k = table[blocks[col | (x & 15)]];
              if (!k) continue;
              m4.makeTranslation(x + 0.5, y + 0.5, z + 0.5);
              mesh.setMatrixAt(n, m4);
              mesh.setColorAt(n, this._xrayColors[k - 1]);
              if (++n >= XRAY_MAX) break;
            }
          }
        }
      }
    }
    mesh.count = n;
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    this.xrayCount = n;
  }

  // Fireworks where a creature this player hit has died.
  _updateKills() {
    const r = this._recent;
    if (!r.length) return;
    for (let i = r.length - 1; i >= 0; i--) {
      const e = r[i];
      if (this._time - e.t > KILL_FX_WINDOW) {
        r.splice(i, 1);
        continue;
      }
      if (!e.m.dead) continue;
      r.splice(i, 1);
      if (H.killFx) this.fireworks(e.m.pos, (e.m.spec?.h ?? 1.5) + 0.5);
    }
  }

  fireworks(at, up = 1.5) {
    const fx = this.ctx.effects;
    if (!fx) return;
    const n = 46;
    const base = Math.floor(Math.random() * RAINBOW.length);
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const b = Math.acos(Math.random() * 2 - 1);
      const s = 5 + Math.random() * 4;
      fx.glow.spawn({ x: at.x, y: at.y + up, z: at.z, vx: Math.sin(b) * Math.cos(a) * s, vy: Math.cos(b) * s + 2, vz: Math.sin(b) * Math.sin(a) * s, life: 0.9 + Math.random() * 0.6, size0: 0.32, size1: 0.04, color0: RAINBOW[(base + (i % 3)) % RAINBOW.length], alpha: 1, drag: 1.6, gravity: 0.35 });
    }
    this.ctx.audio?.playFlarePop?.();
    this.fireworksCount = (this.fireworksCount || 0) + 1;
  }

  // ---------- Creatures: an army, smite ----------

  // A ring of creatures of the army's kind around the player (online a
  // guest's are asked of the host, a few a second: queued here).
  spawnArmy(kind = this.values.armyKind, count = ARMY_SIZE) {
    if (!H.active) return 0;
    const { player } = this.ctx;
    const p = player.position;
    const a0 = Math.random() * Math.PI * 2;
    for (let i = 0; i < count; i++) {
      const a = a0 + (i / count) * Math.PI * 2;
      const d = 6 + (i % 2) * 3;
      this._armyQueue.push({ kind, x: p.x + Math.cos(a) * d, z: p.z + Math.sin(a) * d });
    }
    return count;
  }

  _updateArmy(dt) {
    if (!this._armyQueue.length) return;
    this._armyT -= dt;
    if (this._armyT > 0) return;
    // (A guest: the host takes a few a second at most.)
    this._armyT = this.isHost ? 0.08 : 0.3;
    const s = this._armyQueue.shift();
    const y = this._groundNear(s.x, this.ctx.player.position.y, s.z);
    if (y == null) return;
    const m = this.ctx.mobs?.requestSpawn(s.kind, s.x, y, s.z);
    if (m) this.armySpawned = (this.armySpawned || 0) + 1;
    if (!m && this.isHost && !this._armyWarned) {
      this._armyWarned = true;
      this.ctx.toast?.("Some of the army can't come here (Peaceful, or water)", 3);
      setTimeout(() => (this._armyWarned = false), 4000);
    }
  }

  // A standing spot (feet height) near (x, y0, z): air with something solid below.
  _groundNear(x, y0, z) {
    const w = this.ctx.world;
    const bx = Math.floor(x);
    const bz = Math.floor(z);
    for (let d = 0; d <= 12; d++) {
      for (const y of d ? [Math.floor(y0) + d, Math.floor(y0) - d] : [Math.floor(y0)]) {
        if (y < 1 || y > WORLD_HEIGHT - 3) continue;
        if (!IS_SOLID[w.getBlock(bx, y, bz)] && !IS_SOLID[w.getBlock(bx, y + 1, bz)] && IS_SOLID[w.getBlock(bx, y - 1, bz)]) return y + 0.01;
      }
    }
    return null;
  }

  // Lightning on every hostile creature within 48 blocks (30 at most).
  smite() {
    if (!H.active) return 0;
    const { mobs, player } = this.ctx;
    if (!mobs) return 0;
    const p = player.position;
    let n = 0;
    for (const m of [...mobs.mobs]) {
      if (n >= 30) break;
      if (m.dead || !m.spec?.hostile || m.spec.projectile || m.isRemotePlayer) continue;
      if (m.pos.distanceToSquared(p) > 48 * 48) continue;
      const top = this._v.set(m.pos.x + (Math.random() - 0.5) * 6, m.pos.y + 40, m.pos.z + (Math.random() - 0.5) * 6);
      this._bolt([top.clone(), m.pos.clone().setY(m.pos.y + (m.spec.h ?? 1.6) * 0.5)], 0.45);
      this._noteHit(m);
      mobs._hurt(m, 100000, null, 0, true);
      n++;
    }
    if (n) {
      this.ctx.audio?.playRailFire?.();
      this.ctx.effects?.shake.add(0.25);
    }
    return n;
  }

  // ---------- Hand powers (an empty hand; interaction.js) ----------

  // Right button pressed. True if a power took it.
  press() {
    if (!H.active || !H.power || this.ctx.player.vehicle || this.ctx.player.dead) return false;
    if (H.power === "lightning") this.lightning();
    else if (H.power === "gravity") this.gravityPress();
    else if (H.power === "nuke") this.nukeRain();
    return true;
  }

  release() {}

  // Left button: the gravity gun drops what it holds, thrown gently ahead.
  primary() {
    if (!this.grab) return false;
    this._throwGrab(6);
    return true;
  }

  _eyeRay() {
    const p = this.ctx.player;
    return { eye: p.getEyePosition(), dir: p.getForwardVector() };
  }

  // Chain lightning: the creature (or UFO) under the crosshair, then from
  // each to the nearest hostile one within LIGHTNING_JUMP not hit yet.
  lightning() {
    if (this._lightCd > 0) return false;
    this._lightCd = 0.35 / H.fireRate;
    const { mobs, weapons, world, effects, audio } = this.ctx;
    const { eye, dir } = this._eyeRay();
    const block = world.raycast(eye, dir, LIGHTNING_RANGE, { solidOnly: true });
    const far = block ? block.distance : LIGHTNING_RANGE;
    const first = mobs?.raycast(eye, dir, far, (m) => !m.isRemotePlayer) || this._aimAssist(eye, dir);
    const hand = eye.clone().addScaledVector(dir, 0.6);
    hand.y -= 0.25;
    const pts = [hand];
    if (!first) {
      const th = weapons?._targetHit?.(eye, dir, far);
      const end = eye.clone().addScaledVector(dir, th ? th.distance : far);
      if (th) th.hit(LIGHTNING_DAMAGE * 3, dir, end.clone());
      pts.push(end);
      this._bolt(pts, 0.3);
      effects?.glow.spawn({ x: end.x, y: end.y, z: end.z, life: 0.3, size0: 2.5, size1: 0.3, color0: this._c.spark, alpha: 1 });
      audio?.playLaserHit?.();
      this.lightningHits = th ? 1 : 0;
      return true;
    }
    const hit = new Set();
    let cur = first.mob;
    let hops = 0;
    while (cur && hops < LIGHTNING_HOPS) {
      hit.add(cur);
      const c = cur.pos.clone();
      c.y += (cur.spec?.h ?? 1.6) * 0.55;
      pts.push(c);
      const d = this._w.copy(c).sub(pts[pts.length - 2]).setY(0);
      const len = d.length() || 1;
      this._noteHit(cur);
      mobs._hurt(cur, LIGHTNING_DAMAGE, { x: d.x / len, z: d.z / len }, 3, true);
      effects?.glow.spawn({ x: c.x, y: c.y, z: c.z, life: 0.35, size0: 2, size1: 0.2, color0: this._c.spark, alpha: 1 });
      hops++;
      let best = null;
      let bestD = LIGHTNING_JUMP * LIGHTNING_JUMP;
      for (const m of mobs.mobs) {
        if (m.dead || hit.has(m) || m.spec?.projectile || m.isRemotePlayer || !m.spec?.hostile) continue;
        const dd = m.pos.distanceToSquared(cur.pos);
        if (dd < bestD) {
          bestD = dd;
          best = m;
        }
      }
      cur = best;
    }
    this._bolt(pts, 0.35);
    effects?.muzzleFlash(pts[1], 3);
    audio?.playRailFire?.();
    this.lightningHits = hops;
    return true;
  }

  // The creature nearest the crosshair (within a small cone, in sight), as a raycast's hit.
  _aimAssist(eye, dir) {
    const { mobs, world } = this.ctx;
    if (!mobs) return null;
    let best = null;
    let bestA = 0.09;
    const to = this._w;
    for (const m of mobs.mobs) {
      if (m.dead || m.spec?.projectile || m.isRemotePlayer) continue;
      to.copy(m.pos).setY(m.pos.y + (m.spec?.h ?? 1.6) * 0.5).sub(eye);
      const d = to.length();
      if (d < 1 || d > LIGHTNING_RANGE) continue;
      const a = Math.acos(Math.min(1, to.dot(dir) / d));
      if (a >= bestA) continue;
      if (world.raycast(eye, to.divideScalar(d), d - 0.8, { solidOnly: true })) continue;
      best = { mob: m, distance: d };
      bestA = a;
    }
    return best;
  }

  // A jagged bolt through `pts`, fading over `life` seconds (a line, and
  // glowing beads along it so it reads at any distance).
  _bolt(pts, life = 0.3) {
    const N = 96;
    let b = this._boltPool.find((x) => !x.line.visible);
    if (!b) {
      if (this._boltPool.length >= 10) b = this._boltPool[0];
      else {
        const geo = new THREE.BufferGeometry();
        geo.setAttribute("position", new THREE.BufferAttribute(new Float32Array(N * 3), 3));
        const line = new THREE.Line(geo, this._lineMat.clone());
        line.frustumCulled = false;
        line.layers.set(LAYER_FX);
        line.renderOrder = 14;
        this.ctx.scene.add(line);
        b = { line, t: 0, life };
        this._boltPool.push(b);
      }
    }
    const pos = b.line.geometry.attributes.position;
    let k = 0;
    for (let i = 0; i + 1 < pts.length && k < N - 1; i++) {
      const a = pts[i];
      const c = pts[i + 1];
      const len = a.distanceTo(c);
      const steps = Math.max(2, Math.min(12, Math.ceil(len / 1.5)));
      for (let s = 0; s < steps && k < N - 1; s++) {
        const t = s / steps;
        const j = s === 0 ? 0 : Math.min(0.9, len * 0.08);
        pos.setXYZ(k++, a.x + (c.x - a.x) * t + (Math.random() - 0.5) * j, a.y + (c.y - a.y) * t + (Math.random() - 0.5) * j, a.z + (c.z - a.z) * t + (Math.random() - 0.5) * j);
      }
    }
    const last = pts[pts.length - 1];
    pos.setXYZ(k++, last.x, last.y, last.z);
    const fx = this.ctx.effects;
    if (fx) {
      for (let i = 1; i < k; i++) {
        if (i % 2) continue;
        fx.glow.spawn({ x: pos.getX(i), y: pos.getY(i), z: pos.getZ(i), life: life * 0.8, size0: 0.55, size1: 0.1, color0: this._c.spark, alpha: 0.9 });
      }
    }
    b.line.geometry.setDrawRange(0, k);
    pos.needsUpdate = true;
    b.t = 0;
    b.life = life;
    b.line.visible = true;
    b.line.material.opacity = 1;
    this._bolts.push(b);
  }

  // The gravity gun: right click picks up the creature or block under the
  // crosshair (a creature of the host's, on a guest, is flung at once: a hit
  // with a huge push, the host's to judge); right click again throws it,
  // left click drops it ahead.
  gravityPress() {
    if (this.grab) {
      this._throwGrab(32);
      return true;
    }
    const { mobs, world, audio } = this.ctx;
    const { eye, dir } = this._eyeRay();
    const block = world.raycast(eye, dir, GRAVITY_RANGE, { solidOnly: true });
    const mobHit = mobs?.raycast(eye, dir, block ? block.distance : GRAVITY_RANGE, (m) => !m.isRemotePlayer);
    if (mobHit) {
      const m = mobHit.mob;
      if (m.net || m.isEndPart || m.spec?.boss) {
        this._noteHit(m);
        mobs._hurt(m, 1, { x: dir.x, z: dir.z }, 40, true);
        audio?.playUfoDash?.();
        return true;
      }
      this.grab = { mob: m };
      audio?.playUfoCharge?.();
      return true;
    }
    if (!block) return false;
    const [x, y, z] = block.block;
    const id = world.getBlock(x, y, z);
    const info = BLOCK_INFO[id];
    if (!info || !(info.hardness >= 0) || info.liquid || IS_CHEST[id] || BLOCK_USE[id] || SHAPE_OF[id] !== SHAPE.CUBE || y < 1) {
      this.ctx.toast?.("The gravity gun can't lift that", 1.5);
      return true;
    }
    if (!world.setBlock(x, y, z, BLOCK.AIR)) return true;
    const mesh = this._blockMesh(id);
    mesh.position.set(x + 0.5, y + 0.5, z + 0.5);
    this.grab = { id, home: [x, y, z], mesh, pos: mesh.position.clone() };
    audio?.playUfoCharge?.();
    return true;
  }

  _blockMesh(id) {
    const rgb = this.ctx.world.blockColors?.[id] || [0.6, 0.6, 0.6];
    const mat = new THREE.MeshLambertMaterial({ color: new THREE.Color().setRGB(rgb[0], rgb[1], rgb[2], THREE.SRGBColorSpace), emissive: new THREE.Color(0.08, 0.12, 0.25) });
    const mesh = new THREE.Mesh(this._boxGeo || (this._boxGeo = new THREE.BoxGeometry(0.96, 0.96, 0.96)), mat);
    mesh.castShadow = true;
    this.ctx.scene.add(mesh);
    return mesh;
  }

  _throwGrab(speed) {
    const g = this.grab;
    if (!g) return;
    this.grab = null;
    const { dir } = this._eyeRay();
    if (g.mob) {
      const m = g.mob;
      if (!m.dead && m.knock && m.vel) {
        m.knock.set(dir.x * speed, 0, dir.z * speed);
        m.vel.y = Math.max(2, dir.y * speed * 0.8 + 5);
        m.stagger = 1.2;
        m.peakY = null;
      }
      this.ctx.audio?.playUfoDash?.();
      return;
    }
    this._thrown.push({ id: g.id, home: g.home, mesh: g.mesh, pos: g.mesh.position.clone(), vel: dir.clone().multiplyScalar(speed), t: 0, spin: new THREE.Vector3(Math.random(), Math.random(), Math.random()).normalize() });
    this.ctx.audio?.playThrow?.();
  }

  // Lets go of whatever is held (the power changed, out of Creative, seated, dead): a block falls and lands.
  _dropGrab() {
    if (!this.grab) return;
    const g = this.grab;
    this.grab = null;
    if (g.mob) return;
    this._thrown.push({ id: g.id, home: g.home, mesh: g.mesh, pos: g.mesh.position.clone(), vel: new THREE.Vector3(), t: 0, spin: new THREE.Vector3(0, 1, 0) });
  }

  // Nuke rain: three small nukes fall around the spot under the crosshair.
  nukeRain() {
    const { world, audio } = this.ctx;
    if (!this.ctx.nuke) return false;
    if (this._nukeCd > 0) {
      this.ctx.toast?.(`Nuke rain: ready in ${Math.ceil(this._nukeCd)} s`, 1.2);
      return false;
    }
    const { eye, dir } = this._eyeRay();
    const hit = world.raycast(eye, dir, 700, { solidOnly: true });
    if (!hit) {
      this.ctx.toast?.("Nuke rain: point at the ground", 1.5);
      return false;
    }
    this._nukeCd = NUKE_RAIN_COOLDOWN;
    const at = eye.clone().addScaledVector(dir, hit.distance);
    const spread = H.nukeSize * 1.6;
    for (let i = 0; i < 3; i++) {
      const a = Math.random() * Math.PI * 2;
      const r = i === 0 ? 0 : spread * (0.6 + Math.random() * 0.5);
      const tx = at.x + Math.cos(a) * r;
      const tz = at.z + Math.sin(a) * r;
      const start = new THREE.Vector3(tx + 30, Math.min(WORLD_HEIGHT + 60, at.y + 120), tz - 20);
      // (Lands on what is there when it arrives: the height is found then.)
      this._nukes.push({ pos: start, from: start.clone(), tx, tz, ty: at.y, t: -i * 1.1, dur: 1.6 });
    }
    audio?.playMeteorIncoming?.();
    this.ctx.toast?.("Nuke rain incoming!", 2);
    return true;
  }

  _updatePowers(dt) {
    const { player, mobs, world, effects } = this.ctx;
    this._lightCd = Math.max(0, this._lightCd - dt);
    this._nukeCd = Math.max(0, this._nukeCd - dt);
    if (this.grab && (H.power !== "gravity" || player.vehicle || player.dead)) this._dropGrab();
    // Held by the gravity gun: floats in front of the eyes.
    const g = this.grab;
    if (g) {
      const { eye, dir } = this._eyeRay();
      const hold = eye.addScaledVector(dir, g.mob ? 3.2 + (g.mob.spec?.r ?? 0.4) * 2 : 3);
      if (g.mob) {
        const m = g.mob;
        if (m.dead || m.removed || !mobs.mobs.includes(m)) this.grab = null;
        else {
          m.pos.lerp(this._w.set(hold.x, hold.y - (m.spec?.h ?? 1.6) * 0.5, hold.z), Math.min(1, dt * 12));
          m.vel?.set(0, 0, 0);
          m.knock?.set(0, 0, 0);
          m.stagger = Math.max(m.stagger || 0, 0.3);
          m.attackCooldown = Math.max(m.attackCooldown || 0, 0.3);
          m.peakY = null;
          if (Math.random() < 0.4) effects?.glow.spawn({ x: m.pos.x + (Math.random() - 0.5), y: m.pos.y + Math.random() * (m.spec?.h ?? 1.6), z: m.pos.z + (Math.random() - 0.5), life: 0.3, size0: 0.25, size1: 0.02, color0: this._c.spark, alpha: 0.8 });
        }
      } else {
        g.mesh.position.lerp(hold, Math.min(1, dt * 14));
        g.mesh.rotation.y += dt * 1.5;
        g.mesh.rotation.x += dt * 0.7;
        if (Math.random() < 0.3) effects?.glow.spawn({ x: g.mesh.position.x + (Math.random() - 0.5), y: g.mesh.position.y + (Math.random() - 0.5), z: g.mesh.position.z + (Math.random() - 0.5), life: 0.3, size0: 0.2, size1: 0.02, color0: this._c.spark, alpha: 0.8 });
      }
    }
    // Thrown blocks: fly, then land as a block (or knock a creature over first).
    for (let i = this._thrown.length - 1; i >= 0; i--) {
      const b = this._thrown[i];
      b.t += dt;
      b.vel.y -= 26 * dt;
      const step = this._v.copy(b.vel).multiplyScalar(dt);
      const len = step.length();
      const d = this._w.copy(step).divideScalar(len || 1);
      const hit = len > 0 ? world.raycast(b.pos, d, len + 0.5, { solidOnly: true }) : world.raycast(b.pos, this._w.set(0, -1, 0), 0.6, { solidOnly: true });
      const mobHit = len > 0 && mobs ? mobs.raycast(b.pos, d, hit ? hit.distance : len + 0.5, (m) => !m.isRemotePlayer) : null;
      if (mobHit) {
        this._noteHit(mobHit.mob);
        mobs._hurt(mobHit.mob, 10, { x: d.x, z: d.z }, Math.min(30, 4 + len / dt / 3), true);
        b.vel.multiplyScalar(-0.25);
      }
      // (Out over ground that isn't loaded: it lands at once, back where it came from if need be.)
      if (hit || b.t > 10 || b.pos.y < 1 || !world.getChunk(Math.floor(b.pos.x) >> 4, Math.floor(b.pos.z) >> 4)) {
        if (hit) b.pos.addScaledVector(d, Math.max(0, hit.distance - 0.5));
        this._land(b);
        this.ctx.scene.remove(b.mesh);
        b.mesh.material.dispose();
        this._thrown.splice(i, 1);
        continue;
      }
      b.pos.add(step);
      b.mesh.position.copy(b.pos);
      b.mesh.rotateOnAxis(b.spin, dt * 6);
    }
    // Nuke rain: the bombs fall, glowing; each goes off where it lands.
    for (let i = this._nukes.length - 1; i >= 0; i--) {
      const n = this._nukes[i];
      n.t += dt;
      if (n.t < 0) continue;
      if (n.ty2 == null) {
        const top = world.heightAt?.(Math.floor(n.tx), Math.floor(n.tz));
        n.ty2 = Number.isFinite(top) && top > 0 ? top + 1 : n.ty;
      }
      const k = Math.min(1, n.t / n.dur);
      n.pos.set(n.from.x + (n.tx - n.from.x) * k, n.from.y + (n.ty2 - n.from.y) * k * k, n.from.z + (n.tz - n.from.z) * k);
      for (let j = 0; j < 3; j++) effects?.glow.spawn({ x: n.pos.x, y: n.pos.y, z: n.pos.z, vx: (Math.random() - 0.5) * 2, vy: 2, vz: (Math.random() - 0.5) * 2, life: 0.6, size0: 2.2, size1: 0.3, color0: this._c.nuke, alpha: 0.9, drag: 1 });
      if (Math.random() < 0.6) effects?.smoke.spawn({ x: n.pos.x, y: n.pos.y, z: n.pos.z, vx: 0, vy: 0.5, vz: 0, life: 2.5, size0: 1.5, size1: 4, color0: this._c.smoke, alpha: 0.5, drag: 0.5 });
      if (k >= 1) {
        this._nukes.splice(i, 1);
        this.ctx.nuke.detonate(new THREE.Vector3(n.tx, n.ty2, n.tz), { R: H.nukeSize || this.values.nukeSize || 14 });
        this.nukesDropped = (this.nukesDropped || 0) + 1;
      }
    }
    // Lightning bolts fade (flickering).
    for (let i = this._bolts.length - 1; i >= 0; i--) {
      const b = this._bolts[i];
      b.t += dt;
      if (b.t >= b.life) {
        b.line.visible = false;
        this._bolts.splice(i, 1);
        continue;
      }
      b.line.material.opacity = (1 - b.t / b.life) * (0.6 + Math.random() * 0.4);
    }
  }

  // A thrown block comes to rest: in the cell where it stopped if that is
  // free (air or a plant), else the nearest free one above (never lost: as
  // a last resort it goes back where it was taken from, if that is free).
  _land(b) {
    const w = this.ctx.world;
    const free = (x, y, z) => {
      if (y < 1 || y >= WORLD_HEIGHT || !w.getChunk(x >> 4, z >> 4)) return false;
      const id = w.getBlock(x, y, z);
      return id === BLOCK.AIR || (BLOCK_INFO[id]?.replaceable ?? false);
    };
    const x = Math.floor(b.pos.x);
    const z = Math.floor(b.pos.z);
    const y0 = Math.floor(b.pos.y);
    const player = this.ctx.player;
    const inPlayer = (cx, cy, cz) => {
      const p = player.position;
      const r = player.bodyRadius ?? 0.3;
      return cx + 1 > p.x - r && cx < p.x + r && cz + 1 > p.z - r && cz < p.z + r && cy + 1 > p.y && cy < p.y + (player.bodyHeight ?? 1.8);
    };
    for (let y = Math.max(1, y0); y < Math.min(WORLD_HEIGHT, y0 + 8); y++) {
      if (free(x, y, z) && !inPlayer(x, y, z) && w.setBlock(x, y, z, b.id)) {
        this.lastLanded = [x, y, z];
        this.ctx.effects?.shake.add(0.05);
        return true;
      }
    }
    const [hx, hy, hz] = b.home;
    if (free(hx, hy, hz) && w.setBlock(hx, hy, hz, b.id)) this.lastLanded = [hx, hy, hz];
    return false;
  }

  // ---------- HUD ----------

  _updateHud(dt) {
    this._hudT -= dt;
    if (this._hudT > 0) return;
    this._hudT = 0.25;
    const playing = this.ctx.getState?.() === "playing";
    const list = this.activeList();
    const show = playing && list.length > 0;
    this.hudEl.classList.toggle("hidden", !show);
    if (!show) return;
    const power = H.power ? `<b>${{ lightning: "Chain lightning", gravity: this.grab ? "Gravity gun: holding (right click throws, left click drops)" : "Gravity gun", nuke: this._nukeCd > 0 ? `Nuke rain (${Math.ceil(this._nukeCd)} s)` : "Nuke rain" }[H.power]}</b>: right click, empty hand` : "";
    const slow = this.slowmo ? "<b>BULLET TIME</b> (Z)" : H.bulletTime > 0 ? "Z: bullet time" : "";
    const text = `<span class="hk-tag">HACKS</span> ${list.length} on${power ? ` &middot; ${power}` : ""}${slow ? ` &middot; ${slow}` : ""}`;
    if (text !== this._hudText) {
      this._hudText = text;
      this.hudEl.innerHTML = text;
    }
  }
}
