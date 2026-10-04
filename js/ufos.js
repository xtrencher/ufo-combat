// Enemy UFOs.
//
// Spawning: never in plain view, and always within a sensible range of the
// player (the range scales with the view distance, up to a cap): out of the
// view in the fog, behind terrain, rising out of the sea, or high in the
// sky, growing in from a dot. Far more of them at night. One "UFO activity"
// setting scales everything from rare sightings to a UFO APOCALYPSE.
//
// Temper: UFOs are mostly peaceful. They roam, play tricks (hovering over
// lakes, zig-zagging, following animals, beaming one up, diving into the sea
// or burrowing into a mountain, and dashing to a spot nearby at extreme
// speed: a streak, no light) and ignore the player. They turn hostile when shot, when the player
// keeps the camera on them for a while, when a jet locks a missile on them,
// and now and then on their own (some are hotter-tempered than others). At
// most MAX_ATTACKERS of them attack the player at the same time; the others
// circle at a distance until a slot frees up.
//
// Attacks differ per UFO (each has an attack style and a laser color):
// volleys of quick bolts, three-bolt bursts, slow heavy blasts that blow
// holes, seeking plasma that homes in on a vehicle (a flare decoys it), or
// the tractor beam that lifts a player on foot up into the ship.
//
// Shot down, a UFO goes dark (every light off), falls burning, and crashes:
// sometimes in a huge explosion that leaves a burnt-out, unusable wreck,
// sometimes as an intact ship that can be boarded and flown. The wreck is
// embedded in the ground (in water it sinks to the sea floor), and a random
// crew of aliens (1 to 10, green, gray and red) climbs out and hunts the
// player.
import * as THREE from "three";
import { createUfoModel, designInfo, designFacingOffset, randomUfoSpec, ufoLaserKey } from "./ufo-models.js";
import { TractorBeam } from "./tractor-beam.js";
import { LASER_COLORS } from "./lasers.js";
import { IS_SOLID, IS_WET, BLOCK } from "./blocks.js";
import { SEA_LEVEL } from "./constants.js";
import { effectsQuality } from "./effects.js";
import { LAYER_FX } from "./layers.js";
import { DashTrail } from "./dash-trail.js";

export const UFO_ACTIVITY_LEVELS = [0, 0.1, 0.25, 0.5, 1, 2, 4, 8, 16];
export const UFO_ACTIVITY_NAMES = ["Off", "Very rare", "Rare", "Occasional", "Normal", "Frequent", "Busy skies", "Invasion", "UFO APOCALYPSE"];

export const UFO_DEFAULTS = {
  activity: 0.5,
  spawnChance: 1,
  maxCount: 0, // 0 = automatic (from the activity)
  aggression: 1,
  detection: 130,
  beamLift: 4,
  sizes: "balanced",
  nightMultiplier: 3,
  toughness: 1,
};

export const MAX_ATTACKERS = 3; // UFOs attacking the player at the same time
export const JET_MAX_ATTACKERS = 1; // ... while the player flies a jet (they are fast and you have no cover: one at a time, and the hijacked fighter)
export const JET_COUNT_FACTOR = 0.5; // in a jet the sky holds half as many UFOs and fills up more slowly

// Per size: radius range (blocks), health, cruise and top speed (blocks/s),
// laser damage, hover height over a beamed player, alien crew size range.
// A giant is about the size of a football field.
export const SIZES = {
// (Round 4: about 1.6x the old health; they went down too easily. Survival
// scales it further per mission, see progression.js.)
  small: { r: [3, 4.5], health: 65, cruise: 16, top: 55, laser: 2, hover: 11, crew: [1, 3], idx: 0 },
  medium: { r: [6, 8.5], health: 210, cruise: 12, top: 45, laser: 3, hover: 14, crew: [1, 5], idx: 1 },
  large: { r: [12, 17], health: 760, cruise: 8, top: 34, laser: 5, hover: 20, crew: [2, 8], idx: 2 },
  mothership: { r: [32, 42], health: 3400, cruise: 5, top: 22, laser: 8, hover: 36, crew: [4, 10], idx: 3 },
  giant: { r: [58, 74], health: 9500, cruise: 3.5, top: 16, laser: 12, hover: 60, crew: [6, 10], idx: 4 },
};
const SIZE_WEIGHTS = {
  small: { small: 6, medium: 3, large: 0.8, mothership: 0.1, giant: 0.02 },
  balanced: { small: 4, medium: 4, large: 1.6, mothership: 0.25, giant: 0.05 },
  big: { small: 2, medium: 4, large: 3, mothership: 0.8, giant: 0.2 },
};

// Attack styles. Each UFO has one, picked from its family's list, and its
// own bolt color and sound, so different ships clearly fight differently:
//   rapid    quick bursts of five thin, fast bolts (tic-tacs, saucers)
//   heavy    one slow, big glowing ball that explodes (spheres, triangles, cylinders)
//   spread   a fan of five bolts across the target (saucers, rings)
//   charged  the ship glows up for over a second, then one very fast,
//            very hard bolt (spheres, tic-tacs): watch for the glow and move
//   sweep    a continuous beam that sweeps across the ground through the
//            target (rings, saucers): step out of its line
//   seeker   slow plasma that homes in on a vehicle (a flare decoys it)
//   abductor single shots and the tractor beam on a player on foot
//   volley / burst: plain single shots and three-shot bursts (tests, old saves)
// rate: seconds between attacks; damage multiplies the size's laser damage
// (per bolt, or per tick for the beam).
export const STYLES = {
  volley: { rate: [0.8, 1.6], speed: 110, damage: 1, radius: 0.1, length: 2.4, blast: 0, count: 1, color: "green", sound: "volley" },
  burst: { rate: [1.8, 3], speed: 130, damage: 0.7, radius: 0.08, length: 3, blast: 0, count: 3, color: "green", sound: "rapid" },
  rapid: { rate: [1.8, 2.8], speed: 160, damage: 0.35, radius: 0.07, length: 2.8, blast: 0, count: 1, shots: 5, gap: 0.085, color: "cyan", sound: "rapid" },
  heavy: { rate: [3, 4.8], speed: 58, damage: 2, radius: 0.42, length: 1.3, blast: 2.6, count: 1, color: "orange", sound: "heavy" },
  spread: { rate: [2.4, 3.8], speed: 115, damage: 0.7, radius: 0.11, length: 2.2, blast: 0, count: 5, fan: 0.2, color: "magenta", sound: "spread" },
  charged: { rate: [4.2, 6.2], speed: 270, damage: 2.6, radius: 0.2, length: 10, blast: 1.2, count: 1, charge: 1.3, color: "white", sound: "charged" },
  sweep: { rate: [4.5, 7], damage: 0.5, beam: 1.5, color: "red", sound: "sweep" },
  seeker: { rate: [4, 6.5], speed: 72, damage: 3, radius: 0.24, length: 2.6, blast: 1.8, count: 1, homing: true, color: "lime", sound: "seeker" },
  abductor: { rate: [2.5, 4], speed: 110, damage: 1, radius: 0.1, length: 2.4, blast: 0, count: 1, color: "green", sound: "volley" },
};
const STYLE_WEIGHTS = {
  saucer: { rapid: 30, spread: 22, sweep: 18, abductor: 22, charged: 8 },
  sphere: { charged: 45, heavy: 35, seeker: 20 },
  tictac: { rapid: 60, charged: 40 },
  torus: { sweep: 60, spread: 40 },
  triangle: { heavy: 30, spread: 25, seeker: 25, rapid: 20 },
  boomerang: { rapid: 35, spread: 30, sweep: 35 },
  cylinder: { heavy: 40, sweep: 30, charged: 30 },
};

const TRICKS = ["hover_lake", "zigzag", "follow", "abduct", "hover", "abduct", "dive", "burrow", "blink_hop"];
const MAX_UFOS = 150;
const DESPAWN_DISTANCE = 1500;
const SPAWN_MAX = 900; // farthest spawn (blocks), however far the view distance reaches
const MAX_KEPT_WRECKS = 8; // intact wrecks kept in the world

const _v = new THREE.Vector3();
const _w = new THREE.Vector3();
const _x = new THREE.Vector3();
const _up = new THREE.Vector3(0, 1, 0);
const WATER_C = [new THREE.Color(0.75, 0.85, 0.95), new THREE.Color(0.9, 0.95, 1)];

function rand(a, b) {
  return a + Math.random() * (b - a);
}

// Distance from point p to the segment a-b.
const _sp = new THREE.Vector3();
function segPointDist(a, b, p) {
  const abx = b.x - a.x;
  const aby = b.y - a.y;
  const abz = b.z - a.z;
  const l2 = abx * abx + aby * aby + abz * abz || 1e-9;
  let t = ((p.x - a.x) * abx + (p.y - a.y) * aby + (p.z - a.z) * abz) / l2;
  t = Math.max(0, Math.min(1, t));
  return _sp.set(a.x + abx * t - p.x, a.y + aby * t - p.y, a.z + abz * t - p.z).length();
}

function pickWeighted(weights) {
  let total = 0;
  for (const k in weights) total += weights[k];
  let r = Math.random() * total;
  for (const k in weights) {
    r -= weights[k];
    if (r <= 0) return k;
  }
  return Object.keys(weights)[0];
}

// A UFO's attack style from its design family and size (rand: a random
// number source; the player's ships use a seeded one, so a ship keeps it).
export function pickUfoStyle(design, sizeIdx, rand = Math.random) {
  const w = { ...(STYLE_WEIGHTS[familyOf(design)] || STYLE_WEIGHTS.saucer) };
  if (sizeIdx === 0) {
    // Small scouts: nothing that blows holes or homes in.
    delete w.heavy;
    delete w.seeker;
    if (!Object.keys(w).length) w.rapid = 1;
  }
  if (sizeIdx >= 2) {
    if (w.heavy) w.heavy *= 2;
    if (w.seeker) w.seeker *= 2;
    if (w.sweep) w.sweep *= 1.5;
  }
  if (sizeIdx >= 3) delete w.abductor;
  let total = 0;
  for (const k in w) total += w[k];
  let r = rand() * total;
  for (const k in w) {
    r -= w[k];
    if (r <= 0) return k;
  }
  return Object.keys(w)[0];
}

function familyOf(design) {
  if (design.startsWith("saucer")) return "saucer";
  if (design.startsWith("sphere")) return "sphere";
  if (design.startsWith("tictac")) return "tictac";
  if (design.startsWith("torus")) return "torus";
  return design;
}

export class UfoManager {
  constructor({ scene, world, player, effects, audio, lasers, mobs, vehicles, sky, camera }) {
    this.scene = scene;
    this.world = world;
    this.player = player;
    this.effects = effects;
    this.audio = audio;
    this.lasers = lasers;
    this.mobs = mobs;
    this.vehicles = vehicles;
    this.sky = sky;
    this.camera = camera;
    this.config = { ...UFO_DEFAULTS };
    this.ufos = [];
    this.enabled = true;
    this.time = 0;
    this._spawnT = 3;
    this._id = 1;
    this.viewDistance = 160; // blocks (fog end); set by the game
    this.jetMaxSpeed = 280; // the jet's top speed (for fleeing UFOs)
    this.pendingCrews = []; // aliens waiting for their wreck's chunk to load
    this.beams = []; // spare tractor beams
    this.attackers = 0; // UFOs attacking the player right now (at most MAX_ATTACKERS)
    // Hooks.
    this.onShotDown = null; // (ufo, byPlayer) => void
    this.difficulty = 0.35; // 0-1, from the player's progress (progression.js): a gentle sky first, bigger and angrier UFOs later
    this.rules = null; // Survival: the current mission's rules (sizes, health, damage, aggression, count multipliers)
    this.forceIntact = false; // the next UFO the player shoots down crashes in one piece (a mission)
    this.onCrash = null; // ({ ufo, pos, exploded, wreck, byPlayer }) => void
    this.onAbductPlayer = null; // (ufo) => void
    this.onEscape = null; // (ufo) => void: the player escaped a beam
    this.onMessage = null;
    // Player abduction state.
    this.beamingPlayer = null; // the UFO whose beam holds the player
    this.graceT = 0; // seconds after a respawn during which UFOs ignore the player
    this._beamTime = 0;
    this._beamPeak = 0;
    this.lastHum = 0;
    this._camDir = new THREE.Vector3(0, 0, -1);
    this.trail = new DashTrail(scene); // the smear a dashing UFO leaves
    // Multiplayer (js/net/entities.js). Host: `targets()` lists every player
    // (this one and Player-like stand-ins for the others): each UFO picks the
    // nearest and its AI runs for that player (this.player and the vehicle
    // are swapped for the moment); new UFOs appear around any player. Guest:
    // the UFOs are the host's (puppets: `u.net`), placed from its states.
    this.localPlayer = player;
    this.localCamera = camera;
    this.targets = null; // () => [player-like]
    this.puppets = false;
    this.groupScale = 1; // more UFOs for a bigger group (set online)
    this.onPuppetHit = null; // (ufo, amount, from) => void
    this.onPuppetUpdate = null; // (ufo, dt) => void
    this.onPuppetAbsorb = null; // (ufo, ship) => void
    this._cur = null; // the player the current UFO is thinking about (online)
  }

  get count() {
    return this.ufos.filter((u) => u.state !== "gone").length;
  }

  // ---------- Settings-derived numbers ----------

  get night() {
    return Math.max(0, Math.min(1, 1 - this.sky.daylight));
  }

  // In Survival the mission chain sets how many UFOs there are (`rules.max`
  // at most in the sky by day, more at night, and `rules.rate` new ones per
  // second): the UFO activity, spawn chance, max count and size settings are
  // Creative's. (Round 3 rules had a `count` multiplier instead: still read.)
  get missionDriven() {
    return !!this.rules && this.rules.max !== undefined;
  }

  get maxCount() {
    const c = this.config;
    const nightBoost = 1 + (c.nightMultiplier - 1) * 0.35 * this.night;
    const jet = this._playerVehicle()?.type === "jet" ? JET_COUNT_FACTOR : 1;
    const g = this.groupScale;
    if (this.missionDriven) return this.rules.max <= 0 ? 0 : Math.min(MAX_UFOS, Math.max(1, Math.round(this.rules.max * nightBoost * jet * g)));
    const auto = Math.round((3 * c.activity + (c.activity > 0 ? 1 : 0)) * nightBoost * (this.rules?.count ?? 1) * jet * g);
    return Math.min(MAX_UFOS, c.maxCount > 0 ? Math.max(1, Math.round(c.maxCount * jet)) : Math.max(c.activity > 0 ? 1 : 0, auto));
  }

  // Expected new UFOs per second.
  get spawnRate() {
    const c = this.config;
    const jet = this._playerVehicle()?.type === "jet" ? JET_COUNT_FACTOR : 1;
    if (this.missionDriven) return this.rules.rate * 0.8 * (jet < 1 ? 0.7 : 1) * (1 + (c.nightMultiplier - 1) * 0.5 * this.night);
    return (c.activity / 50) * c.spawnChance * 0.8 * (jet < 1 ? 0.7 : 1) * (1 + (c.nightMultiplier - 1) * this.night);
  }

  // How far UFOs spawn and wander: scales with the view distance.
  get range() {
    return Math.min(SPAWN_MAX, Math.max(200, this.viewDistance * 0.95));
  }

  // How far away they open fire (and how far the player can see them do it).
  get engageRange() {
    return Math.min(520, Math.max(170, this.viewDistance * 0.6));
  }

  // ---------- Spawning ----------

  // The aggression setting, scaled by the difficulty curve (0.6x at the start, 1.4x at the end).
  _agg() {
    if (this.rules) return this.config.aggression * this.rules.aggression;
    return this.config.aggression * (0.6 + 0.8 * this.difficulty);
  }

  // Size odds: with "balanced" they follow the difficulty curve: small and
  // medium saucers at first, motherships and giants only much later.
  _sizeWeights() {
    // Survival: the current mission decides (see progression.js).
    if (this.missionDriven || (this.rules && this.config.sizes === "balanced")) return this.rules.sizes;
    const base = SIZE_WEIGHTS[this.config.sizes] || SIZE_WEIGHTS.balanced;
    if (this.config.sizes !== "balanced") return base;
    const easy = { small: 6, medium: 3, large: 0.5, mothership: 0.03, giant: 0 };
    const hard = { small: 2.5, medium: 4, large: 3, mothership: 0.7, giant: 0.18 };
    const d = Math.max(0, Math.min(1, this.difficulty));
    const out = {};
    for (const k in easy) out[k] = easy[k] + (hard[k] - easy[k]) * d;
    return out;
  }

  // Spawns a UFO. opts: { design | spec, size, radius, pos, hidden, state, personality, glow }.
  // Without a position it appears somewhere the player can't see.
  spawn(opts = {}) {
    const size = opts.size || pickWeighted(this._sizeWeights());
    const S = SIZES[size] || SIZES.small;
    const spec = opts.spec || randomUfoSpec(Math.random, { glow: opts.glow, design: opts.design });
    const design = spec.design;
    const radius = opts.radius || rand(S.r[0], S.r[1]);
    const model = createUfoModel(spec, radius, { castShadow: size !== "mothership" && size !== "giant" });
    this.scene.add(model.root);
    const variation = rand(0.75, 1.3);
    const maxHealth = Math.max(8, Math.round(S.health * variation * this.config.toughness * (this.rules?.health ?? 1) * (this.groupHealth ?? 1)));
    // Personality against a jet: most flee a little slower than the jet,
    // some are faster (they can't be caught), fighters attack.
    const pr = Math.random();
    const personality = opts.personality || (S.idx >= 3 ? "fighter" : pr < 0.55 ? "evader" : pr < 0.72 ? "fast" : "fighter");
    const style = opts.style || this._pickStyle(design, S);
    const info = designInfo(spec);
    const u = {
      id: this._id++,
      design,
      spec,
      size,
      S,
      radius,
      model,
      info,
      pos: new THREE.Vector3(),
      vel: new THREE.Vector3(),
      yaw: Math.random() * Math.PI * 2,
      spin: rand(-0.6, 0.6),
      health: maxHealth,
      maxHealth,
      personality,
      style,
      laserKey: STYLES[style]?.color || ufoLaserKey(spec),
      // Its crew: one kind of alien per ship (they come from the same world).
      crewKind: opts.crewKind || this._crewKind(S.idx),
      temper: Math.random() < 0.25 ? rand(0.6, 1) : rand(0, 0.5), // how easily it turns hostile
      fleeFactor: personality === "fast" ? rand(1.25, 1.6) : rand(0.8, 0.95),
      state: opts.state || "roam",
      timer: 0,
      waypoint: null,
      trick: null,
      target: null, // a mob being followed / abducted
      beam: null,
      hostile: false, // angry at the player (shot, stared at, or its own mood)
      hostileT: 0, // seconds of anger left
      stare: 0, // seconds the player has kept the camera on it
      alert: 0, // seconds of being alerted (reacting to hits)
      reaction: null,
      shotT: rand(1, 3),
      checkT: rand(0, 0.5),
      blinkT: S.idx >= 3 ? 1e9 : rand(12, 45), // sudden dashes to a spot nearby
      dash: null, // a dash under way: { from, to, t, dur }
      dashCool: 0,
      ghostT: 0, // seconds it may pass through terrain (burrowing, diving)
      lastSeen: -99,
      hurtTime: 99,
      age: 0,
      tilt: new THREE.Vector2(),
      falling: false,
      byPlayer: false,
      light: model.light,
      lazy: 0,
    };
    u.hitHalfHeight = Math.max(u.info.h * radius * 0.55, radius * 0.3); // (thin discs: a little generous, so a shot that looks like a hit is one)
    u.pos.copy(opts.pos ? opts.pos : this._spawnPoint(u));
    u.spawnFade = opts.pos && !opts.hidden ? 0 : 3.2; // grows in from a dot when it appears far away
    if (u.spawnFade === 0) u.age = 9;
    this.ufos.push(u);
    // A UFO that starts underwater rises out of the sea first.
    if (u.pos.y - u.info.bottom * radius < SEA_LEVEL - 1 && this._waterAt(u.pos.x, u.pos.z)) {
      u.state = "emerge";
      u.timer = 30;
    }
    this._place(u, 0);
    return u;
  }

  _pickStyle(design, S) {
    return pickUfoStyle(design, S.idx);
  }

  _waterAt(x, z) {
    return this.world.heightAt(Math.floor(x), Math.floor(z)) < SEA_LEVEL - 1;
  }

  // A spawn point the player can't see: out in the fog, behind terrain,
  // under the sea (it rises out of it), or, when nothing hidden turns up,
  // high in the sky far away (it grows in from a dot). Always within `range`
  // of the player, so a large view distance never puts them out of reach.
  _spawnPoint(u) {
    const p = this.player.position;
    const cam = this.camera;
    const eye = _x.copy(cam ? cam.position : p);
    // (Around a remote player: hidden from where that player looks.)
    const camDir = cam ? cam.getWorldDirection(this._camDir) : (this.player.getForwardVector?.() ?? this._camDir);
    const view = Math.max(96, this.viewDistance);
    const maxD = this.range;
    const minD = Math.min(maxD * 0.6, Math.max(110, view * 0.5));
    let best = null;
    let bestScore = -1;
    const bottom = u.info.bottom * u.radius;
    for (let k = 0; k < 14; k++) {
      const a = Math.random() * Math.PI * 2;
      const d = rand(minD, maxD);
      const x = p.x + Math.cos(a) * d;
      const z = p.z + Math.sin(a) * d;
      const h = this.world.heightAt(Math.floor(x), Math.floor(z));
      const ground = Math.max(h, SEA_LEVEL);
      const mode = k % 3;
      let y;
      if (mode === 1 && h < SEA_LEVEL - 3) y = SEA_LEVEL - u.radius * 0.5 - bottom - rand(2, 6); // under the sea
      else if (mode === 0) y = ground + bottom + rand(4, 26); // low, hoping for a hill in the way
      else y = ground + rand(90, 240) + u.radius; // high in the sky
      const cand = new THREE.Vector3(x, y, z);
      const score = this._hiddenScore(eye, cand, d, view, camDir, u);
      if (score > bestScore) {
        bestScore = score;
        best = cand;
        if (score >= 1) break;
      }
    }
    return best;
  }

  // How well hidden a spawn point is (1 = certainly).
  _hiddenScore(eye, P, d, view, camDir, u) {
    const top = P.y + u.radius * 0.5;
    if (top < SEA_LEVEL - 0.5) return 1; // under the sea
    if (d >= view * 0.97) return 1; // beyond the fog
    // Behind terrain: sample the ground between the eye and the point.
    const dx = P.x - eye.x;
    const dz = P.z - eye.z;
    const dy = P.y - eye.y;
    const n = 26;
    for (let i = 2; i < n; i++) {
      const t = i / n;
      const gx = eye.x + dx * t;
      const gz = eye.z + dz * t;
      const g = this.world.heightAt(Math.floor(gx), Math.floor(gz)) + 1;
      if (eye.y + dy * t < g - 1) return 1;
    }
    const dir = _w.set(dx, dy, dz).normalize();
    const ang = dir.angleTo(camDir);
    let score = 0.15;
    if (ang > 1.35) score = 0.8; // behind the player
    else if (ang > 0.95) score = 0.5; // off to the side of the view
    if (dy / Math.max(1, Math.hypot(dx, dz)) > 0.5) score = Math.max(score, 0.45); // high in the sky
    return score;
  }

  _updateSpawning(dt) {
    if (this.missionDriven ? this.rules.max <= 0 : this.config.activity <= 0) return;
    this._spawnT -= dt;
    if (this._spawnT > 0) return;
    this._spawnT = 1;
    const active = this.ufos.filter((u) => !u.falling && u.state !== "leave").length;
    const max = this.maxCount;
    if (active >= max) return;
    // New arrivals per second: faster while the sky is emptier than the
    // activity calls for (so an apocalypse fills up in seconds, and even at
    // normal activity the first UFO shows up soon).
    const expected = this.spawnRate * (1 + 3 * (1 - active / Math.max(1, max)));
    let n = Math.floor(expected) + (Math.random() < expected % 1 ? 1 : 0);
    n = Math.min(n, max - active, 6);
    for (let k = 0; k < n; k++) this._aroundAnyone(() => this.spawn({}));
  }

  // Runs fn with `this.player` set to a random player in the game (online: new
  // UFOs appear around every player, hidden from that player's view if it is
  // this one).
  _aroundAnyone(fn) {
    const list = this.targets ? this.targets().filter((t) => !t.dead) : null;
    // (A lone remote player too: the host on the menu is not in the list.)
    if (!list || !list.length) return fn();
    const t = list[Math.floor(Math.random() * list.length)];
    if (t === this.localPlayer) return fn();
    this.player = t;
    this.camera = t === this.localPlayer ? this.localCamera : null;
    try {
      return fn();
    } finally {
      this.player = this.localPlayer;
      this.camera = this.localCamera;
    }
  }

  // The nearest player in the game to `pos` (online), or this player: [player, distance].
  _nearestPlayer(pos, list = this.targets ? this.targets() : null) {
    if (!list) return [this.localPlayer, pos.distanceTo(this.localPlayer.position)];
    let best = this.localPlayer;
    let bestD = Infinity;
    for (const t of list) {
      const p = t.vehicle ? t.vehicle.pos : t.position;
      const d = pos.distanceTo(p) + (t.dead ? 1e6 : 0);
      if (d < bestD) {
        bestD = d;
        best = t;
      }
    }
    return [best, bestD];
  }

  // ---------- Queries (weapons, lasers, explosions) ----------

  // Nearest UFO hit along a ray (an ellipsoid per UFO), or null.
  raycast(origin, dir, maxDist, filter = null) {
    let best = null;
    for (const u of this.ufos) {
      if (u.state === "gone" || (filter && !filter(u))) continue;
      const sy = u.radius / u.hitHalfHeight;
      const ox = origin.x - u.pos.x;
      const oy = (origin.y - u.pos.y) * sy;
      const oz = origin.z - u.pos.z;
      const dx = dir.x;
      const dy = dir.y * sy;
      const dz = dir.z;
      const a = dx * dx + dy * dy + dz * dz;
      const b = ox * dx + oy * dy + oz * dz;
      const c = ox * ox + oy * oy + oz * oz - u.radius * u.radius;
      const disc = b * b - a * c;
      if (disc < 0) continue;
      let t = (-b - Math.sqrt(disc)) / a;
      if (t < 0) t = c < 0 ? 0 : -1;
      if (t < 0 || t > maxDist) continue;
      if (!best || t < best.distance) best = { ufo: u, distance: t };
    }
    return best;
  }

  sphereHit(p, r) {
    for (const u of this.ufos) {
      if (u.state === "gone") continue;
      const dy = (p.y - u.pos.y) * (u.radius / u.hitHalfHeight);
      if (Math.hypot(p.x - u.pos.x, dy, p.z - u.pos.z) < u.radius + r) return u;
    }
    return null;
  }

  explosion(center, radius, byPlayer = true) {
    for (const u of this.ufos) {
      if (u.state === "gone" || u.falling) continue;
      const d = Math.max(0, u.pos.distanceTo(center) - u.radius * 0.7);
      const reach = radius * 1.8;
      if (d >= reach) continue;
      const f = 1 - d / reach;
      this.damage(u, Math.floor(40 * Math.sqrt(radius / 7) * f * f + 4), byPlayer, center);
    }
  }

  // Damages a UFO; the player's shots make it turn hostile (and, with the
  // player flying a UFO, maybe its neighbours).
  damage(u, amount, byPlayer = true, from = null, attacker = null) {
    if (u.state === "gone" || u.falling || amount <= 0) return false;
    // (Online: a guest's hit on the host's UFO goes to the host, after the
    // same checks as below for what the hull shrugs off.)
    if (u.net && !u.shield && !u.immune) {
      u.hurtTime = 0;
      if (byPlayer) this.onPuppetHit?.(u, amount, from);
      return true;
    }
    // A mission's landing ship: its hull shrugs off hand weapons.
    if (u.immune || (u.immuneUntil && this.time < u.immuneUntil)) {
      if (byPlayer && this.time - (u.immuneMsgT ?? -99) > 6) {
        u.immuneMsgT = this.time;
        this.onMessage?.("It doesn't even scratch the hull. Deal with the crew.");
      }
      return false;
    }
    // A shielded ship (the Overlord): nothing gets through until the shield is down.
    if (u.shield) {
      if (byPlayer && this.time - (u.shieldMsgT ?? -99) > 5) {
        u.shieldMsgT = this.time;
        this.onMessage?.("The shield holds! Shoot down the pylons first.");
      }
      if (from && from.isVector3) this.effects.glow.spawn({ x: from.x, y: from.y, z: from.z, life: 0.25, size0: 3 + u.radius * 0.1, size1: 0.5, color0: this._shieldHit || (this._shieldHit = new THREE.Color(0.4, 1.2, 2.6)), alpha: 0.8 });
      return false;
    }
    u.health -= amount;
    u.hurtTime = 0;
    if (u.bossHook) u.bossHook(u);
    // Attacked by an enemy fighter: it fights back (and dodges).
    if (attacker && !byPlayer) {
      u.foe = attacker;
      u.foeT = 25;
      if (u.health > 0) this._dodge(u, 0.7);
    }
    if (byPlayer) {
      u.byPlayer = true;
      u.lastHitPid = this.currentAttacker ?? 1; // (online: which player; 1 is the host)
      this.lastPlayerAttack = this.time; // the alien air force takes notice
      this._provoked(u);
    }
    if (u.health <= 0) this._shotDown(u);
    else if (u.state === "beam" && u.dashAbduct) this._breakOff(u);
    else if (byPlayer) this._dodge(u, 1);
    return true;
  }

  // ---------- The dash abduction (Round 8) ----------
  // Now and then a UFO fighting a player on foot dashes in to appear right
  // over a player (online: a random one of those on foot) and beams them up.
  // Hit it and it breaks off: the beam goes out, it dashes back out to a
  // distance and goes on with its guns.

  _dashAbduct(u) {
    if (u.dash || u.falling || u.S.idx >= 3 || (u.dashCool ?? 0) > 0) return false;
    const list = (this.targets ? this.targets() : [this.localPlayer]).filter((t) => !t.dead && !t.vehicle && !t.creative && !(t.graceUntil > this.time) && !(t === this.localPlayer && this.graceT > 0));
    if (!list.length) return false;
    const victim = list[Math.floor(Math.random() * list.length)];
    const p = victim.position;
    const hover = u.info.bottom * u.radius + u.S.hover;
    const to = new THREE.Vector3(p.x, Math.max(this._groundAt(p.x, p.z) + hover, p.y + hover), p.z);
    const len = to.distanceTo(u.pos);
    if (len > 700) return false;
    u.dash = { from: u.pos.clone(), to, t: 0, dur: THREE.MathUtils.clamp(len / 1100, 0.08, 0.25), last: u.pos.clone() };
    u.dashCool = 1;
    u.state = "beam";
    u.timer = rand(10, 15);
    u.dashAbduct = true;
    u.beamVictim = victim;
    u.lastSeen = this.time;
    u.hostile = true;
    u.hostileT = Math.max(u.hostileT || 0, 30);
    u.tgtPlayer = victim;
    if (this.audio?.playUfoDash) this.audio.playUfoDash(u.pos.distanceTo(this._ears()));
    this.onDashWarn?.(victim); // (online: the net side warns a guest victim)
    // (Online: only a player's own, or one in sight, makes a toast on the host.)
    if (victim === this.localPlayer) this.onMessage?.("A UFO is right above you! Shoot it to break the beam!");
    else if (to.distanceTo(this._ears()) < Math.max(150, this.viewDistance)) this.onMessage?.("A UFO dashed in to beam someone up!");
    return true;
  }

  // Hit while beaming: off with the beam, back out to a distance, guns.
  _breakOff(u) {
    u.dashAbduct = false;
    u.beamVictim = null;
    if (u.beam) u.beam.set(false);
    if (this.beamingPlayer === u) this.beamingPlayer = null;
    u.state = "attack";
    u.timer = 0;
    u.abductT = rand(35, 60);
    u.dashCool = 0;
    u.dash = null;
    this._blink(u, 130, 70);
  }

  // Makes a UFO angry at the player for a while.
  anger(u, seconds = rand(35, 70)) {
    if (u.falling || u.state === "gone" || u.peaceful) return; // (peaceful: a mission's landing ship)
    u.hostile = true;
    u.hostileT = Math.max(u.hostileT, seconds);
    u.lastSeen = this.time;
  }

  _provoked(u) {
    const pv = this._playerVehicle();
    // A slot among the (at most MAX_ATTACKERS) attackers, decided before
    // its state changes.
    const slot = u.state === "attack" || u.state === "react" || u.state === "beam" || this.attackers < this.maxAttackers;
    if (pv?.type === "ufo" && !u.hostile) {
      u.hostile = true;
      u.hostileT = 60;
      for (const o of this.ufos) {
        if (o !== u && !o.hostile && o.pos.distanceTo(u.pos) < 160 && Math.random() < 0.5) this.anger(o);
      }
    } else if (!pv && !u.hostile) {
      // Shooting one on foot can stir up its neighbours a little.
      for (const o of this.ufos) {
        if (o !== u && !o.hostile && !o.falling && o.pos.distanceTo(u.pos) < 120 && Math.random() < 0.15 * this._agg()) this.anger(o, rand(20, 40));
      }
    }
    this.anger(u, rand(90, 150)); // (shot at: it fights on)
    u.alert = 8;
    u.stare = 0;
    if (u.state === "attack" || u.state === "react" || u.state === "beam") return; // already fighting
    this._dropTarget(u); // (off to fight: it lets go of any creature it was after)
    if (!slot) {
      u.state = "circle"; // angry, but waiting for a free slot
      return;
    }
    this.attackers++;
    // React (on foot): counterattack, fly in to beam, or evade.
    if (!pv) {
      // (Shot at, they fight on: evading is the rare reaction.)
      const w = u.personality === "fighter" ? { counter: 6, beam: 3, evade: 0.5 } : u.personality === "evader" ? { counter: 4, beam: 1.5, evade: 1.2 } : { counter: 4.5, beam: 2, evade: 0.8 };
      const agg = this._agg();
      w.counter *= 0.4 + agg;
      w.beam *= agg * (this.player.creative ? 0 : 1) * (u.style === "abductor" ? 2.5 : 0.6);
      u.reaction = pickWeighted(w);
      u.state = "react";
      u.timer = rand(3, 6);
      u.jink = null;
      if (u.reaction === "beam") u.state = "attack";
    } else {
      u.state = "attack";
    }
  }

  // ---------- Per frame ----------

  _playerVehicle() {
    if (this._cur) return this._cur.vehicle ?? null;
    return this.vehicles?.active ?? null;
  }

  // Where the player (or their vehicle) is, and how fast it moves.
  _targetInfo() {
    const v = this._playerVehicle();
    if (v) return { pos: v.pos, vel: v.vel, vehicle: v };
    return { pos: this.player.getEyePosition().setY(this.player.position.y + 1), vel: this.player.velocity, vehicle: null };
  }

  // The ground under (x, z): the top of the terrain, never below the sea
  // surface (UFOs fly over water).
  _groundAt(x, z) {
    const bx = Math.floor(x);
    const bz = Math.floor(z);
    return Math.max(this._floorAt(bx, bz) + 1, SEA_LEVEL + 1);
  }

  // The top of the solid ground (the sea floor under water), +1 for the
  // block's top face.
  _floorAt(bx, bz) {
    let h = this.world.heightAt(bx, bz);
    if (this.world.getChunk(bx >> 4, bz >> 4)) {
      const s = this.world.surfaceY(bx, bz);
      if (s >= 0) h = s;
    }
    return h;
  }

  _canSee(u, target) {
    const from = _v.copy(u.pos);
    from.y -= u.info.bottom * u.radius + 0.5;
    const dir = _w.copy(target).sub(from);
    const d = dir.length();
    if (d < 1) return true;
    dir.divideScalar(d);
    const hit = this.world.raycast(from, dir, d - 1, { solidOnly: true });
    return !hit;
  }

  // Can this UFO join the attack (fewer than MAX_ATTACKERS at it right now)?
  _wantAttack(u) {
    if (u.state === "attack" || u.state === "react" || u.state === "beam") return true;
    return this.attackers < this.maxAttackers;
  }

  // How many UFOs may attack at once: fewer against a jet.
  get maxAttackers() {
    if (this._attackCap) return this._attackCap;
    return this._playerVehicle()?.type === "jet" ? JET_MAX_ATTACKERS : MAX_ATTACKERS;
  }

  update(dt) {
    this.time += dt;
    this.graceT = Math.max(0, this.graceT - dt);
    if (!this.enabled) return;
    if (this.puppets) {
      this._updatePuppets(dt);
      return;
    }
    // (A frame count, not the clock, picks the far UFOs' thinking frames: at
    // 30 fps floor(time * 60) only ever lands on every other value.)
    this._frame = ((this._frame ?? 0) + 1) | 0;
    this._updateSpawning(dt);
    this._updateCrews(dt);
    const p = this.player.position;
    let tgt = this._targetInfo();
    const night = this.night;
    // Online (host): the attackers' cap covers every player.
    const targets = this.targets ? this.targets() : null;
    this._attackCap = targets ? targets.reduce((s, t) => s + (t.vehicle?.type === "jet" ? JET_MAX_ATTACKERS : MAX_ATTACKERS), 0) : 0;
    if (this.camera) this.camera.getWorldDirection(this._camDir);
    // Count the attackers first, so the cap holds within a frame.
    // (Against a jet, the ones that run away from it are not attackers.)
    const vsJet = this._playerVehicle()?.type === "jet";
    const flees = (u) => vsJet && u.personality !== "fighter" && !u.hostile;
    this.attackers = 0;
    for (const u of this.ufos) if (!u.falling && (u.state === "attack" || u.state === "react" || u.state === "beam") && !flees(u)) this.attackers++;
    // Taking to a jet with a crowd of them on you: the surplus fall back to circling.
    if (this.attackers > this.maxAttackers) {
      const extra = this.ufos.filter((u) => !u.falling && u.state === "attack" && !u.missionTarget && !flees(u)).sort((a, b) => b.pos.distanceToSquared(p) - a.pos.distanceToSquared(p));
      for (const u of extra) {
        if (this.attackers <= this.maxAttackers) break;
        u.state = "circle";
        this.attackers--;
      }
    }
    let humD = Infinity;
    let beamOnPlayer = null;
    for (let i = this.ufos.length - 1; i >= 0; i--) {
      const u = this.ufos[i];
      const localDist = u.pos.distanceTo(p);
      let dist = localDist;
      if (targets) {
        // This UFO thinks about the nearest player (sticking with the one it
        // is after unless another is much nearer).
        let [t, d] = this._nearestPlayer(u.pos, targets);
        // (A dash abduction stays on its victim.)
        if (u.beamVictim && u.state === "beam" && targets.includes(u.beamVictim) && !u.beamVictim.dead && !u.beamVictim.vehicle) {
          t = u.beamVictim;
          d = u.pos.distanceTo(t.position);
        }
        const cur = u.tgtPlayer && targets.includes(u.tgtPlayer) && !u.tgtPlayer.dead ? u.tgtPlayer : null;
        if (cur && cur !== t) {
          const dc = u.pos.distanceTo(cur.vehicle ? cur.vehicle.pos : cur.position);
          if (dc < d * 1.5 + 60) {
            t = cur;
            d = dc;
          }
        }
        u.tgtPlayer = t;
        this.player = t;
        this._cur = t;
        tgt = this._targetInfo();
        dist = t === this.localPlayer ? localDist : u.pos.distanceTo(t.position);
      }
      try {
        if (this._stepUfo(u, i, dt, tgt, dist, targets ? Math.min(dist, localDist) : dist, localDist, night)) {
          if (u === this.beamingPlayer) beamOnPlayer = u;
        }
      } finally {
        this.player = this.localPlayer;
        this._cur = null;
      }
      // (Removed in its step: _remove(i) splices its slot.)
      if (localDist < humD && this.ufos[i] === u) humD = localDist;
    }
    this._attackCap = 0;
    this._updatePlayerBeam(dt, beamOnPlayer);
    this.trail.update(dt);
    // One engine hum for the nearest UFO.
    this.lastHum = humD;
    if (this.audio?.setUfoHum) this.audio.setUfoHum(humD < 140 ? (1 - humD / 140) * 0.5 : 0, this.beamingPlayer ? 1 : 0);
  }

  // One UFO's step: thinking (about `tgt`, `dist` away), weapons, beam,
  // drawing. `near`: the nearest player's distance (despawning, lazy
  // thinking); `localDist`: this player's (drawing). Returns true if its
  // beam holds this player.
  _stepUfo(u, i, dt, tgt, dist, near, localDist, night) {
    let beamOnPlayer = false;
    {
      // (Round 9: a mission's target never goes by distance: the mission
      // brings it back toward the players instead, see missions.js _leash.)
      if (u.state === "gone" || (near > DESPAWN_DISTANCE && !u.falling && u.state !== "attack" && !u.missionTarget)) {
        this._remove(i);
        return false;
      }
      u.hurtTime += dt;
      u.age += dt;
      // Far away: think every few frames (with the time saved up).
      let step = dt;
      if (near > 380 && !u.falling && u.state !== "leave" && !u.sweep && !u.charge && !u.dash && !(u.queue && u.queue.length)) {
        u.lazy += dt;
        if ((this._frame + u.id) % 4 !== 0) {
          this._place(u, 0, localDist, night);
          return false;
        }
        step = Math.min(0.2, u.lazy);
        u.lazy = 0;
      }
      if (u.captured && this._updateCaptured(u, step)) {
        // held in the player's tractor beam: no thinking, no shooting
      } else if (u.falling) this._fall(u, step);
      else this._think(u, step, tgt, dist);
      if (u.beam) {
        // The beam always hangs from the ship: it follows it, and goes out
        // the moment the ship stops beaming (shot and dodging, dashing,
        // falling, or off to attack), instead of staying behind in the air.
        const beaming = !u.falling && !u.dash && (u.state === "beam" || (u.state === "trick" && u.trick === "abduct"));
        if (!beaming && u.beam.on) u.beam.set(false);
        u.beam.top.set(u.pos.x, u.pos.y - u.info.bottom * u.radius, u.pos.z);
        u.beam.update(step, this.effects);
        if (u.beam.on && u === this.beamingPlayer) beamOnPlayer = true;
        if (!u.beam.on && u.beam.strength < 0.02 && u.state !== "beam" && u.state !== "trick") this._freeBeam(u);
      }
      this._place(u, step, localDist, night);
    }
    return beamOnPlayer;
  }

  // A guest's UFOs: the host's, placed from its states (entities.js).
  _updatePuppets(dt) {
    const p = this.player.position;
    let humD = Infinity;
    for (let i = this.ufos.length - 1; i >= 0; i--) {
      const u = this.ufos[i];
      if (u.state === "gone") {
        this._remove(i);
        continue;
      }
      u.hurtTime += dt;
      u.age += dt;
      this.onPuppetUpdate?.(u, dt);
      if (u.beam) {
        u.beam.top.set(u.pos.x, u.pos.y - u.info.bottom * u.radius, u.pos.z);
        u.beam.update(dt, this.effects);
      }
      const dist = u.pos.distanceTo(p);
      this._place(u, dt, dist, this.night);
      if (dist < humD) humD = dist;
      // (A beam of the host's that has this player in it lifts them here.)
      if (!this.beamingPlayer && u.beam?.on && u.beam.strength > 0.5 && !this.player.dead && !this.player.vehicle && !this.player.creative && u.beam.contains(this.player.position.clone().setY(this.player.position.y + 0.9))) {
        this.beamingPlayer = u;
        this._beamTime = 0;
        this._beamStartY = this.player.position.y;
        this._beamPeak = 0;
      }
    }
    if (this.beamingPlayer && !this.ufos.includes(this.beamingPlayer)) this.beamingPlayer = null;
    this._updatePlayerBeam(dt, this.beamingPlayer);
    this.trail.update(dt);
    this.lastHum = humD;
    if (this.audio?.setUfoHum) this.audio.setUfoHum(humD < 140 ? (1 - humD / 140) * 0.5 : 0, this.beamingPlayer ? 1 : 0);
  }

  // A UFO held by the player's tractor beam: the beam sets its pull velocity
  // each frame; it tumbles, stops fighting, and is let go (angry) when the
  // beam lets go or its ship is lost.
  _updateCaptured(u, dt) {
    const c = u.captured;
    if (!c.by.alive || c.by.beam.strength < 0.3 || this.time - c.last > 0.4 || u.falling || u.state === "gone") {
      u.captured = null;
      u.pullVel = null;
      u.heldFlag = false;
      if (!u.falling && u.state !== "gone") this.anger(u, 60);
      return false;
    }
    if (!u.heldFlag) {
      u.heldFlag = true;
      this._stopWeapons(u);
      if (u.beam?.on) u.beam.set(false);
    }
    u.vel.copy(u.pullVel);
    u.pos.addScaledVector(u.vel, dt);
    u.yaw += dt * 2.2;
    u.lastSeen = this.time;
    return true;
  }

  // Swallowed by the player's ship: gone in a flash, counted as shot down (its
  // loot goes straight into the hold).
  absorb(u, ship) {
    if (u.state === "gone" || u.falling) return;
    if (u.net) {
      this.onPuppetAbsorb?.(u, ship);
      // (The toast is the capturing guest's; once, though the claim repeats until the host takes it.)
      if (!u.swallowToast) this.onMessage?.(`Swallowed a ${u.size} UFO!`);
      u.swallowToast = true;
      return;
    }
    this._stopWeapons(u);
    const fx = this.effects;
    const col = u.model?.halo?.material?.color || new THREE.Color(0.5, 1.2, 2);
    fx.glow.spawn({ x: u.pos.x, y: u.pos.y, z: u.pos.z, life: 0.5, size0: u.radius * 2.2, size1: u.radius * 0.3, color0: col, alpha: 0.9 });
    for (let i = 0; i < 14; i++) fx.glow.spawn({ x: u.pos.x + rand(-1, 1) * u.radius, y: u.pos.y + rand(-0.5, 0.5) * u.radius, z: u.pos.z + rand(-1, 1) * u.radius, vx: rand(-4, 4), vy: rand(2, 9), vz: rand(-4, 4), life: rand(0.4, 0.9), size0: 0.4, size1: 0.05, color0: col, gravity: -0.2, drag: 1.5 });
    u.absorbed = true;
    u.byPlayer = true;
    u.lastHitPid = this.currentAttacker ?? 1;
    u.captured = null;
    this._dropTarget(u);
    u.state = "gone";
    // (Online, a guest's capture is run here for its claim: no toast for the host.)
    if ((this.currentAttacker ?? 1) === 1) this.onMessage?.(`Swallowed a ${u.size} UFO!`);
    if (this.onShotDown) this.onShotDown(u, true);
  }

  _remove(i) {
    const u = this.ufos[i];
    this._stopWeapons(u);
    this._dropTarget(u);
    if (this.beamingPlayer === u) this.beamingPlayer = null;
    this._freeBeam(u, true);
    this.scene.remove(u.model.root);
    u.model.dispose();
    this.ufos.splice(i, 1);
  }

  _getBeam(u) {
    if (!u.beam) u.beam = this.beams.pop() || new TractorBeam(this.scene);
    return u.beam;
  }

  _freeBeam(u, now = false) {
    if (!u.beam) return;
    u.beam.set(false);
    if (now) u.beam.strength = 0;
    u.beam.update(0, null);
    this.beams.push(u.beam);
    u.beam = null;
  }

  // Lets go of the creature it was after (and out of its beam, so another
  // ship, or a mission, can pick it again).
  _dropTarget(u) {
    if (u.target && u.target.beamedBy === u) u.target.beamedBy = null;
    u.target = null;
  }

  // Steers toward `goal` at `speed` (with some acceleration).
  _steer(u, goal, speed, dt, accel = 2.5) {
    const d = _v.copy(goal).sub(u.pos);
    const len = d.length();
    const want = len > 0.3 ? d.multiplyScalar(Math.min(speed, len * 2.2) / len) : d.set(0, 0, 0);
    u.vel.lerp(want, Math.min(1, dt * accel));
    return len;
  }

  _minAltitude(u, extra = 4) {
    return this._groundAt(u.pos.x, u.pos.z) + u.info.bottom * u.radius + extra;
  }

  _newWaypoint(u) {
    // Wander around the player's part of the world, any altitude (a UFO
    // with a home, a mission's scout or raider, stays near it, and low).
    const p = u.home || this.player.position;
    const a = Math.random() * Math.PI * 2;
    const d = u.tether ? rand(u.tether * 0.3, u.tether) : rand(20, Math.max(420, this.range * 0.75));
    const x = p.x + Math.cos(a) * d;
    const z = p.z + Math.sin(a) * d;
    const ground = this._groundAt(x, z);
    const low = u.tether ? true : Math.random() < 0.3;
    u.waypoint = new THREE.Vector3(x, ground + u.info.bottom * u.radius + (u.tether ? rand(18, 34) : low ? rand(5, 18) : rand(18, 160)) + (u.S.idx >= 3 ? u.radius : 0), z);
    u.timer = rand(12, 30);
  }

  // ---------- Teleport dashes ----------
  // Now and then (and often when it is shot at, or a missile closes in) a
  // UFO dashes to a spot nearby at extreme speed: it covers the distance in
  // a tenth of a second or two, leaving nothing but a smear of fading copies
  // of itself along the path (no light, no flash). The biggest ships don't.

  // Starts a dash to a random spot nearby (maxDist blocks at most).
  _blink(u, maxDist = 200, minDist = 40) {
    if (u.dash || u.falling || u.S.idx >= 4) return false;
    // (Round 9: a mission's target, or one in a fight, stays in sight: short hops only.)
    if (u.missionTarget || u.byPlayer) {
      maxDist = Math.min(maxDist, 70);
      minDist = Math.min(minDist, 25);
    }
    const a = Math.random() * Math.PI * 2;
    const d = rand(minDist, Math.max(minDist + 1, maxDist));
    const to = new THREE.Vector3(u.pos.x + Math.cos(a) * d, 0, u.pos.z + Math.sin(a) * d);
    const ground = this._groundAt(to.x, to.z) + u.info.bottom * u.radius + 6;
    to.y = Math.max(ground, u.pos.y + rand(-30, 40));
    const len = to.distanceTo(u.pos);
    u.dash = { from: u.pos.clone(), to, t: 0, dur: THREE.MathUtils.clamp(len / 1100, 0.06, 0.2), last: u.pos.clone() };
    u.blinkT = rand(15, 60);
    u.dashCool = rand(2.5, 5);
    if (this.audio?.playUfoDash) this.audio.playUfoDash(u.pos.distanceTo(this._ears()));
    return true;
  }

  // Moves a dashing UFO along its path (eased), leaving the smear.
  _updateDash(u, dt) {
    const d = u.dash;
    d.t += dt;
    const k = Math.min(1, d.t / d.dur);
    const e = k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2;
    u.pos.lerpVectors(d.from, d.to, e);
    u.vel.copy(d.to).sub(d.from).divideScalar(d.dur);
    // The smear: copies of the hull between where it was last frame and now.
    const step = d.last.distanceTo(u.pos);
    if (this.trail && step > 0.5 && u.pos.distanceTo(this.player.position) < 1500) {
      this._place(u, 0);
      const n = Math.min(10, Math.max(2, Math.round(step / Math.max(1.5, u.radius * 0.6))));
      const shade = this._ghostShade || (this._ghostShade = new THREE.Color());
      const day = 1 - this.night * 0.8;
      shade.setRGB(2.2 * day, 2.2 * day, 2.3 * day);
      this.trail.spawnPath(u.model.hull, d.last, u.pos, n, shade, 0.4);
    }
    d.last.copy(u.pos);
    if (k >= 1) {
      u.dash = null;
      // (A dash abduction stops dead over its victim.)
      if (u.dashAbduct) u.vel.set(0, 0, 0);
      else u.vel.multiplyScalar(0.05);
      // (A trick keeps its waypoint: a dive or burrow goes on to the same spot.)
      if (u.state !== "trick") u.waypoint = null;
    }
  }

  // Shot at: often it dashes out of the line of fire (smaller ships more
  // often; the giants never).
  _dodge(u, chance) {
    if (u.dash || u.falling || (u.dashCool ?? 0) > 0) return false;
    const k = [0.45, 0.35, 0.22, 0.1, 0][u.S.idx] * chance * (u.dodgeMul ?? 1);
    if (Math.random() >= k) return false;
    return this._blink(u, u.S.idx >= 2 ? 120 : 90, 30);
  }

  _startTrick(u) {
    this._dropTarget(u);
    let trick = TRICKS[Math.floor(Math.random() * TRICKS.length)];
    // (Round 9: no hiding in a lake, the sea or a mountain, no long hops, for
    // a mission's target or a ship in a fight.)
    if ((u.missionTarget || u.byPlayer) && (trick === "burrow" || trick === "hover_lake" || trick === "dive" || trick === "blink_hop")) trick = ["hover", "zigzag", "follow"][Math.floor(Math.random() * 3)];
    if (trick === "blink_hop") {
      this._blink(u, 240);
      u.state = "roam";
      u.waypoint = null;
      return;
    }
    u.trick = trick;
    u.state = "trick";
    if (trick === "hover_lake" || trick === "dive") {
      // Find open water nearby.
      for (let k = 0; k < 24; k++) {
        const x = u.pos.x + rand(-160, 160);
        const z = u.pos.z + rand(-160, 160);
        const h = this.world.heightAt(Math.floor(x), Math.floor(z));
        if (h < SEA_LEVEL - (trick === "dive" ? 6 : 1)) {
          if (trick === "hover_lake") {
            u.waypoint = new THREE.Vector3(x, SEA_LEVEL + 1 + u.info.bottom * u.radius + rand(2, 6), z);
            u.timer = rand(14, 24);
          } else {
            // Dive in and cruise under the surface, as deep as the sea floor allows.
            const depth = Math.min(rand(3, 10), Math.max(2, SEA_LEVEL - h - 3));
            u.waypoint = new THREE.Vector3(x, SEA_LEVEL - depth - u.info.bottom * u.radius * 0.2, z);
            u.timer = rand(14, 26);
            u.diveStage = 0;
          }
          return;
        }
      }
      u.trick = "hover";
    }
    if (trick === "burrow") {
      // Fly into a mountainside and out again.
      for (let k = 0; k < 30; k++) {
        const x = u.pos.x + rand(-260, 260);
        const z = u.pos.z + rand(-260, 260);
        const h = this.world.heightAt(Math.floor(x), Math.floor(z));
        if (h >= 44) {
          u.waypoint = new THREE.Vector3(x, h - rand(3, 9), z);
          u.timer = rand(14, 24);
          u.diveStage = 0;
          return;
        }
      }
      u.trick = "zigzag";
    }
    if (trick === "follow" || trick === "abduct") {
      let best = null;
      let bd = 220;
      for (const m of this.mobs.mobs) {
        if (m.dead || m.spec.hostile || m.spec.flies || m.kind === "villager") continue;
        const d = m.pos.distanceTo(u.pos);
        if (d < bd && !m.beamedBy) {
          best = m;
          bd = d;
        }
      }
      if (!best || (trick === "abduct" && u.S.idx >= 3)) {
        u.trick = "zigzag";
      } else {
        u.target = best;
        u.timer = trick === "follow" ? rand(12, 22) : 30;
        return;
      }
    }
    if (u.trick === "zigzag") {
      u.timer = rand(6, 10);
      u.zig = 0;
      return;
    }
    u.trick = "hover";
    u.timer = rand(5, 10);
  }

  _leave(u) {
    u.state = "leave";
    u.timer = 6;
    const a = Math.random() * Math.PI * 2;
    u.leaveDir = new THREE.Vector3(Math.cos(a) * 0.6, rand(0.45, 0.95), Math.sin(a) * 0.6).normalize();
    this._dropTarget(u);
    if (u.beam) u.beam.set(false);
    if (this.audio?.playUfoLeave) this.audio.playUfoLeave(u.pos.distanceTo(this._ears()));
  }

  // Is the player's camera pointing at this UFO? (a wider cone for a bigger
  // UFO or a closer one, and only with a clear line of sight)
  _stared(u, dist) {
    if (dist > 520 || this.player.dead || this.player.isRemote) return false;
    const to = _w.copy(u.pos).sub(this.camera ? this.camera.position : this.player.position).normalize();
    const ang = to.angleTo(this._camDir);
    const cone = Math.max(0.06, Math.atan(u.radius / Math.max(10, dist)) * 1.6);
    return ang < cone;
  }

  // Temper: calms down, gets stared at, snaps on its own.
  _updateMood(u, dt, tgt, dist) {
    const cfg = this.config;
    const agg = this._agg();
    if (u.hostile) {
      u.hostileT -= dt;
      // One that has been hurt keeps fighting for as long as it can see you.
      if (u.hostileT <= 0 && u.health < u.maxHealth * 0.9 && this.time - u.lastSeen < 6) u.hostileT = 10;
      const lost = this.time - u.lastSeen > 25 || dist > this.range * 1.4;
      if (u.hostileT <= 0 || lost || this.player.dead || (this._inGrace() && !tgt.vehicle)) {
        u.hostile = false;
        u.hostileT = 0;
        if (u.state === "attack" || u.state === "react" || u.state === "beam" || u.state === "circle") {
          if (u.beam) u.beam.set(false);
          u.state = "roam";
          u.waypoint = null;
        }
      }
      return;
    }
    if (agg <= 0 || this._inGrace() || this.player.dead || u.peaceful) return;
    const pv = tgt.vehicle;
    const disguised = pv?.type === "ufo";
    if (disguised) return;
    // The camera kept on it for a while: it doesn't like being watched.
    if (dist < this.range && this._stared(u, dist) && (this.camera ? this._canSee(u, this.camera.position) : true)) {
      u.stare += dt * (this.player.zoomFov || this.player.binocularFov ? 2 : 1);
    } else {
      u.stare = Math.max(0, u.stare - dt * 0.6);
    }
    const need = (5 + u.temper * -2.5 + 3) / Math.max(0.3, agg); // ~6-8 s at the default
    if (u.stare > need) {
      u.stare = 0;
      this.anger(u);
      return;
    }
    // Now and then one snaps on its own: hotter-tempered UFOs more often, and
    // more at night; it has to be somewhere near the player.
    if (dist < cfg.detection * (pv?.type === "jet" ? 3 : 2.2) && (pv || !this.player.creative)) {
      const rate = 0.0007 * agg * (0.15 + u.temper * u.temper * 2.4) * (1 + this.night * 0.8);
      if (Math.random() < rate * dt) this.anger(u, rand(25, 55));
    }
    // A missile lock makes it angry (and it will try to get away or fight).
    if (u.lockedOn && this.time - u.lockedOn < 1.5) this.anger(u, 40);
  }

  _think(u, dt, tgt, dist) {
    u.dashCool = Math.max(0, (u.dashCool ?? 0) - dt);
    if (u.dash) {
      this._updateDash(u, dt);
      return;
    }
    // A missile closing in: it often dashes away at the last moment.
    u.missileT = (u.missileT ?? 0) - dt;
    if (u.missileT <= 0) {
      u.missileT = 0.25;
      for (const v of this.vehicles?.vehicles ?? []) {
        if (!v.missiles) continue;
        for (const m of v.missiles) {
          if (m.target?.ref === u && !m.dodged && m.pos.distanceTo(u.pos) < 90 + u.radius) {
            m.dodged = true;
            this._dodge(u, 1.4);
          }
        }
      }
    }
    u.timer -= dt;
    u.alert = Math.max(0, u.alert - dt);
    u.shotT -= dt;
    u.blinkT -= dt;
    u.ghostT = Math.max(0, u.ghostT - dt);
    const pv = tgt.vehicle;
    const disguised = pv?.type === "ufo" && !u.hostile;
    this._updateMood(u, dt, tgt, dist);

    // Rarely, and more often after an abduction or with a jet on its tail,
    // a UFO leaves forever.
    if (u.state !== "leave" && u.state !== "emerge") {
      let leaveChance = 0.0004; // per second
      if (pv?.type === "jet" && dist < 350 && u.personality !== "fighter" && u.hostile) leaveChance = u.personality === "fast" ? 0.0015 : 0.0008; // (rarely)
      // (Round 9: never a mission's target, nor one a player has hit: a fight
      // never ends with the damaged ship vanishing and a fresh one coming.)
      if (!u.noLeave && !u.missionTarget && !u.byPlayer && Math.random() < leaveChance * dt) this._leave(u);
    }

    // A sudden blink to a spot nearby, when it's calm, or to dodge when angry.
    // (u.trick can outlast the trick state: only the current trick counts.)
    let tr = u.state === "trick" ? u.trick : null;
    if (u.blinkT <= 0 && u.state !== "leave" && u.state !== "beam" && u.state !== "emerge" && tr !== "abduct" && tr !== "dive" && tr !== "burrow") {
      if (u.state === "roam" || u.state === "trick" || u.state === "circle" || (u.state === "attack" && Math.random() < 0.5)) {
        if (!this._blink(u, u.state === "attack" ? 90 : 220)) u.blinkT = rand(15, 60);
      } else u.blinkT = rand(5, 12);
    }

    // Turning on the player: an angry UFO with a line of sight to a player it
    // can reach starts attacking, if there's room among the attackers.
    u.checkT -= dt;
    if (u.checkT <= 0 && u.state !== "leave") {
      u.checkT = 0.5;
      const range = Math.max(this.config.detection, this.engageRange) * (pv?.type === "jet" ? 1.6 : 1);
      const eligible = !this.player.dead && !disguised && (pv || (!this._inGrace() && !this.player.creative));
      if (u.hostile && eligible && dist < range * 1.8 && this._canSee(u, tgt.pos)) {
        u.lastSeen = this.time;
        if (u.state === "roam" || u.state === "trick" || u.state === "circle" || u.state === "emerge") {
          if (this._wantAttack(u)) {
            u.state = "attack";
            u.timer = 0;
            this.attackers++;
            this._dropTarget(u);
            if (u.beam) u.beam.set(false);
          } else if (u.state !== "circle") {
            this._dropTarget(u);
            u.state = "circle";
          }
        }
      } else if (u.hostile && eligible && dist < range * 1.8 && u.state === "circle") {
        u.lastSeen = this.time;
      }
      // Lost interest: no sight of the player for a while.
      if ((u.state === "attack" || u.state === "react" || u.state === "beam") && this.time - u.lastSeen > 14) {
        u.state = "roam";
        u.waypoint = null;
        u.hostile = false;
        u.hostileT = 0;
      }
      if (disguised && (u.state === "attack" || u.state === "react" || u.state === "beam" || u.state === "circle")) {
        u.state = "roam";
        u.waypoint = null;
      }
    }

    switch (u.state) {
      case "roam": {
        if (!u.waypoint || u.timer <= 0) this._newWaypoint(u);
        const d = this._steer(u, u.waypoint, u.S.cruise, dt, 1.2);
        if (d < 6) {
          if (Math.random() < 0.55 && dist < this.range) this._startTrick(u);
          else this._newWaypoint(u);
        }
        break;
      }
      case "emerge": {
        // Rising out of the sea to the surface and then some.
        const surface = SEA_LEVEL + 1 + u.info.bottom * u.radius + 6;
        u.vel.lerp(_v.set(0, Math.max(6, u.S.cruise), 0), Math.min(1, dt * 1.5));
        if (u.pos.y > surface) {
          u.state = "roam";
          u.waypoint = null;
        }
        break;
      }
      case "trick":
        this._trick(u, dt);
        break;
      case "circle":
        this._circle(u, dt, tgt);
        break;
      case "attack":
        if (pv) this._attackVehicle(u, dt, tgt, dist);
        else this._attackOnFoot(u, dt, tgt, dist);
        break;
      case "beam":
        this._beamPlayer(u, dt, tgt);
        break;
      case "react":
        this._react(u, dt, tgt, dist);
        break;
      case "leave": {
        const speed = Math.min(700, u.vel.length() + 350 * dt);
        u.vel.copy(u.leaveDir).multiplyScalar(Math.max(speed, 30));
        if (u.timer <= 0 || u.pos.y > 1200) u.state = "gone";
        // A glowing streak behind it.
        if (dist < 900) this.effects.glow.spawn({ x: u.pos.x, y: u.pos.y, z: u.pos.z, life: 0.5, size0: u.radius * 1.3, size1: u.radius * 0.2, color0: u.model.halo.material.color, alpha: 0.7 });
        break;
      }
      default:
        break;
    }

    // Fighting back against an enemy fighter that attacked it (unless it
    // is busy with the player).
    if (u.foe) {
      u.foeT -= dt;
      const f = u.foe;
      if (!f.alive || u.foeT <= 0) u.foe = null;
      else if (u.state !== "attack" && u.state !== "beam" && u.state !== "react") {
        u.foeShotT = (u.foeShotT ?? 1) - dt;
        const fd = f.pos.distanceTo(u.pos);
        if (u.foeShotT <= 0 && fd < 700 && this._canSee(u, f.pos)) {
          const st = STYLES[u.style] || STYLES.volley;
          u.foeShotT = st.beam ? 2.5 : rand(st.rate?.[0] ?? 1, st.rate?.[1] ?? 2) * 1.2;
          this._fireAt(u, f.pos, f.vel, 1, f);
        }
      }
    }

    this._updateWeapons(u, dt);

    // Stay above the ground and below the ceiling (not while leaving, or
    // while it is allowed to pass through terrain: diving, burrowing).
    if (u.state !== "leave" && u.state !== "emerge" && u.ghostT <= 0) {
      tr = u.state === "trick" ? u.trick : null; // (the state may have changed since)
      const minY = this._minAltitude(u, tr === "land" ? 0.3 : u.state === "beam" || tr === "hover_lake" || tr === "abduct" ? 2 : 4);
      if (u.pos.y < minY) {
        u.pos.y += (minY - u.pos.y) * Math.min(1, dt * 4);
        if (u.vel.y < 0) u.vel.y = 0;
      }
    }
    // (No ceiling: UFOs fly as high as they like. Round 6)
    const before = u.pos.y - u.info.bottom * u.radius;
    u.pos.addScaledVector(u.vel, dt);
    // Crossing the sea surface: a splash.
    const after = u.pos.y - u.info.bottom * u.radius;
    if ((before - SEA_LEVEL - 1) * (after - SEA_LEVEL - 1) < 0 && this._waterAt(u.pos.x, u.pos.z)) this._splash(u);
  }

  _splash(u, scale = 1) {
    const fx = this.effects;
    const n = Math.round((20 + (scale > 1 ? u.radius * 1.5 : 0)) * effectsQuality.scale * scale);
    const r = Math.min(u.radius * 0.7, 14) * (scale > 1 ? 1.6 : 1);
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      fx.smoke.spawn({ x: u.pos.x + Math.cos(a) * r, y: SEA_LEVEL + 1.2, z: u.pos.z + Math.sin(a) * r, vx: Math.cos(a) * rand(2, 6) * scale, vy: rand(3, 9) * Math.sqrt(scale), vz: Math.sin(a) * rand(2, 6) * scale, life: rand(0.8, 1.6) * Math.sqrt(scale), size0: 0.8 + r * 0.06, size1: 2.2 + r * 0.15, color0: WATER_C[0], color1: WATER_C[1], alpha: 0.55, drag: 1.4, gravity: 0.5 });
    }
    if (this.audio?.playSplash && u.pos.distanceTo(this._ears()) < 120) this.audio.playSplash();
  }

  _trick(u, dt) {
    const cruise = u.S.cruise;
    switch (u.trick) {
      case "hover_lake":
      case "hover": {
        if (u.trick === "hover_lake" && u.waypoint && u.pos.distanceTo(u.waypoint) > 3) this._steer(u, u.waypoint, cruise * 1.2, dt);
        else u.vel.multiplyScalar(Math.exp(-3 * dt));
        u.spinBoost = 1.5;
        break;
      }
      case "dive": {
        // Down into the sea, a slow cruise below the surface, then back up.
        u.ghostT = Math.max(u.ghostT, 0.6);
        if (u.diveStage === 0) {
          if (!u.waypoint) {
            u.timer = 0;
            break;
          }
          if (this._steer(u, u.waypoint, cruise * 1.6, dt, 2.2) < 4) {
            u.diveStage = 1;
            u.diveT = rand(5, 10);
            u.dir = rand(0, Math.PI * 2);
          }
        } else if (u.diveStage === 1) {
          u.diveT -= dt;
          u.dir += rand(-0.6, 0.6) * dt;
          u.vel.lerp(_v.set(Math.cos(u.dir) * cruise, 0, Math.sin(u.dir) * cruise), Math.min(1, dt * 1.5));
          const floor = this._floorAt(Math.floor(u.pos.x), Math.floor(u.pos.z)) + u.info.bottom * u.radius + 2;
          if (u.pos.y < floor) u.pos.y += (floor - u.pos.y) * Math.min(1, dt * 3);
          if (u.diveT <= 0) u.diveStage = 2;
        } else {
          u.vel.lerp(_v.set(0, cruise * 1.6, 0), Math.min(1, dt * 2));
          if (u.pos.y - u.info.bottom * u.radius > SEA_LEVEL + 6) u.timer = 0;
        }
        break;
      }
      case "burrow": {
        // Through the side of a mountain, and out again.
        u.ghostT = Math.max(u.ghostT, 0.6);
        if (u.diveStage === 0) {
          if (!u.waypoint) {
            u.timer = 0;
            break;
          }
          if (this._steer(u, u.waypoint, cruise * 1.8, dt, 2.2) < 5) {
            u.diveStage = 1;
            u.diveT = rand(4, 8);
            u.dir = rand(0, Math.PI * 2);
          }
        } else if (u.diveStage === 1) {
          u.diveT -= dt;
          u.vel.lerp(_v.set(Math.cos(u.dir) * cruise, 0, Math.sin(u.dir) * cruise), Math.min(1, dt * 1.5));
          if (u.diveT <= 0) u.diveStage = 2;
        } else {
          u.vel.lerp(_v.set(Math.cos(u.dir) * cruise, cruise * 1.2, Math.sin(u.dir) * cruise), Math.min(1, dt * 2));
          const g = this._groundAt(u.pos.x, u.pos.z);
          if (u.pos.y - u.info.bottom * u.radius > g + 6) u.timer = 0;
        }
        break;
      }
      case "zigzag": {
        u.zig = (u.zig || 0) - dt;
        if (u.zig <= 0) {
          u.zig = rand(0.5, 0.9);
          const a = Math.random() * Math.PI * 2;
          u.vel.set(Math.cos(a) * cruise * 2.4, rand(-0.6, 0.6) * cruise, Math.sin(a) * cruise * 2.4);
        }
        break;
      }
      case "land": {
        // A mission's landing: down to just above the ground, slowly, and
        // sits there (the director sends it off again).
        if (!u.waypoint) {
          u.vel.multiplyScalar(Math.exp(-5 * dt));
          break;
        }
        const d = this._steer(u, u.waypoint, Math.max(4, cruise * 0.9), dt, 1.6);
        if (d < 0.8) {
          u.vel.multiplyScalar(Math.exp(-5 * dt));
          u.landed = true;
        }
        u.spinBoost = 0.4;
        break;
      }
      case "follow": {
        const m = u.target;
        if (!m || m.dead) {
          u.timer = 0;
          break;
        }
        const goal = _w.set(m.pos.x, m.pos.y + u.info.bottom * u.radius + rand(5, 8), m.pos.z);
        this._steer(u, goal, cruise * 1.5, dt, 3);
        break;
      }
      case "abduct": {
        const m = u.target;
        if (!m || m.dead || !this.mobs.mobs.includes(m)) {
          if (u.beam) u.beam.set(false);
          u.timer = 0;
          break;
        }
        m.beamedBy = u;
        const hover = u.info.bottom * u.radius + 10 + u.radius * 0.5;
        const goal = _w.set(m.pos.x, m.pos.y + hover, m.pos.z);
        const d = this._steer(u, goal, cruise * 1.6, dt, 3);
        const beam = this._getBeam(u);
        const top = _v.set(u.pos.x, u.pos.y - u.info.bottom * u.radius, u.pos.z);
        const ground = this._groundAt(u.pos.x, u.pos.z);
        beam.set(d < 4, top, ground, 2.5 + u.radius * 0.25);
        if (beam.on && beam.strength > 0.5) {
          const took = this.mobs.beamLift(beam, 3.5, top.y - 0.3, u);
          if (took.length || u.abductDone) {
            u.abductDone = false;
            beam.set(false);
            u.target = null;
            // Satisfied: often it leaves for good right away.
            if (Math.random() < 0.4 && !u.noLeave && !u.missionTarget && !u.byPlayer) this._leave(u);
            else u.timer = 0;
          }
        }
        break;
      }
      default:
        break;
    }
    if (u.timer <= 0 && u.state === "trick") {
      this._dropTarget(u);
      if (u.beam) u.beam.set(false);
      u.trick = null;
      u.state = "roam";
      this._newWaypoint(u);
    }
  }

  // An angry UFO that has to wait its turn (the attacker cap is reached):
  // it circles the player at a distance.
  _circle(u, dt, tgt) {
    const a = this.time * (0.12 / Math.max(1, u.radius * 0.05)) + u.id * 1.3;
    const R = THREE.MathUtils.clamp(u.radius * 3 + 90, 100, 240);
    const goal = _w.set(tgt.pos.x + Math.cos(a) * R, Math.max(tgt.pos.y + 25 + u.radius * 0.5, this._minAltitude(u, 6)), tgt.pos.z + Math.sin(a) * R);
    this._steer(u, goal, u.S.cruise * 2, dt, 1.4);
  }

  // Leading a moving target: the direction to fire a bolt of `speed` from
  // `from` so it meets a target at `pos` moving with `vel` (the intercept
  // point; `lead` < 1 aims a little behind, so a target that keeps running
  // across can get away).
  _lead(from, pos, vel, speed, out, lead = 1) {
    const dx = pos.x - from.x;
    const dy = pos.y - from.y;
    const dz = pos.z - from.z;
    const vx = vel?.x ?? 0;
    const vy = vel?.y ?? 0;
    const vz = vel?.z ?? 0;
    const a = vx * vx + vy * vy + vz * vz - speed * speed;
    const b = 2 * (dx * vx + dy * vy + dz * vz);
    const c = dx * dx + dy * dy + dz * dz;
    let t = Math.sqrt(c) / speed;
    if (Math.abs(a) > 1e-6) {
      const disc = b * b - 4 * a * c;
      if (disc >= 0) {
        const r1 = (-b - Math.sqrt(disc)) / (2 * a);
        const r2 = (-b + Math.sqrt(disc)) / (2 * a);
        const best = Math.min(r1 > 0 ? r1 : Infinity, r2 > 0 ? r2 : Infinity);
        if (best < Infinity) t = best;
      }
    }
    t = Math.min(t, 6);
    return out.set(dx + vx * t * lead, dy + vy * t * lead, dz + vz * t * lead).normalize();
  }

  // Where the UFO's shots leave from (its underside).
  _muzzle(u, out) {
    out.copy(u.pos);
    out.y -= u.info.bottom * u.radius * 0.8;
    return out;
  }

  // Starts an attack in the UFO's style at the player (or their vehicle):
  // single shots fly at once, bursts are fired one after another (re-aimed
  // each time), a charged shot glows up first, a beam sweeps. `big`: the
  // big ships fire from several points around the hull.
  _attack(u, vehicle = null, big = false) {
    const st = STYLES[u.style] || STYLES.volley;
    if (u.charge || u.sweep || (u.queue && u.queue.length)) return;
    const tgt = this._targetInfo();
    const dist = u.pos.distanceTo(tgt.pos);
    if (st.beam) {
      this._startSweep(u, tgt, vehicle);
      return;
    }
    if (st.charge) {
      u.charge = { t: st.charge, total: st.charge, vehicle, big };
      if (this.audio?.playUfoCharge) this.audio.playUfoCharge(st.charge, dist);
      return;
    }
    if (st.shots) {
      u.queue = [];
      const rounds = big ? 2 : 1;
      for (let r = 0; r < rounds; r++) for (let k = 0; k < st.shots; k++) u.queue.push({ t: (r * st.shots + k) * st.gap, vehicle });
      return;
    }
    this._fireAt(u, tgt.pos, tgt.vel, big ? 3 : 1, vehicle);
  }

  // Queued shots, the charge and the sweeping beam, every frame.
  _updateWeapons(u, dt) {
    if (u.queue && u.queue.length) {
      const tgt = this._targetInfo();
      for (let i = 0; i < u.queue.length; i++) {
        const q = u.queue[i];
        q.t -= dt;
        if (q.t > 0) continue;
        u.queue.splice(i--, 1);
        if (!this.player.dead) this._fireAt(u, tgt.pos, tgt.vel, 1, q.vehicle);
      }
    }
    if (u.charge) {
      const c = u.charge;
      c.t -= dt;
      // The glow gathering under the ship (a clear warning).
      const k = 1 - Math.max(0, c.t) / c.total;
      const m = this._muzzle(u, _x);
      const col = LASER_COLORS[u.laserKey] || LASER_COLORS.white;
      if (u.pos.distanceTo(this.player.position) < 700) this.effects.glow.spawn({ x: m.x, y: m.y, z: m.z, life: 0.06, size0: (0.4 + u.radius * 0.12) * (0.3 + k * 1.4), size1: 0.2, color0: col, alpha: 0.35 + k * 0.6 });
      if (c.t <= 0) {
        u.charge = null;
        const tgt = this._targetInfo();
        if (!this.player.dead) this._fireAt(u, tgt.pos, tgt.vel, c.big ? 3 : 1, c.vehicle);
      }
    }
    if (u.sweep) this._updateSweep(u, dt);
  }

  // Stops whatever attack is under way (shot down, gone).
  _stopWeapons(u) {
    if (u.queue) u.queue.length = 0;
    u.charge = null;
    if (u.sweep) this._endSweep(u);
  }

  // Fires `count` bolts at a target (its position, velocity) in the UFO's
  // style. Shots are fast enough and live long enough to reach a target
  // anywhere in the engagement range. The aim is good: a player who stands
  // still gets hit, one who moves out of the way (or keeps changing
  // direction) is missed.
  _fireAt(u, target, vel, count = 1, vehicle = null) {
    const st = STYLES[u.style] && !STYLES[u.style].beam ? STYLES[u.style] : STYLES.volley;
    const from = this._muzzle(u, new THREE.Vector3());
    const color = LASER_COLORS[u.laserKey] || LASER_COLORS.green;
    const dist = from.distanceTo(target);
    const tv = vel ? Math.hypot(vel.x, vel.y, vel.z) : 0;
    // Against a fast vehicle the bolts are quicker (they have to catch it).
    const speed = st.speed + Math.min(140, dist * 0.3) + (vehicle ? tv * 0.5 : 0);
    const n = Math.max(count, st.count);
    const fan = st.fan || 0;
    const lead = vehicle ? 1 : 0.92;
    for (let k = 0; k < n; k++) {
      // Big ships fire from around the hull: the muzzle is chosen first and
      // the shot aimed from it (aiming from the middle of the ship and then
      // moving the muzzle made every shot from a big UFO miss).
      const muzzle = from.clone();
      if (u.radius > 8 && !fan) muzzle.add(new THREE.Vector3(rand(-1, 1), 0, rand(-1, 1)).multiplyScalar(u.radius * 0.5));
      const dir = this._lead(muzzle, target, vel, speed, new THREE.Vector3(), lead);
      if (fan && n > 1) {
        // A fan across the line of fire, level with the ground.
        const side = _w.set(-dir.z, 0, dir.x);
        if (side.lengthSq() < 1e-6) side.set(1, 0, 0);
        side.normalize();
        const off = (k / (n - 1) - 0.5) * 2 * fan;
        dir.addScaledVector(side, Math.tan(off)).normalize();
      } else {
        // The aim error: well under a block at the target, growing slowly
        // with distance.
        const err = 0.25 + dist * 0.0015 + (u.S.idx >= 3 ? 0.3 : 0) + (n > 1 ? 0.25 : 0);
        const spread = (err * 2) / Math.max(20, dist);
        dir.x += (Math.random() - 0.5) * spread;
        dir.y += (Math.random() - 0.5) * spread;
        dir.z += (Math.random() - 0.5) * spread;
        dir.normalize();
      }
      const start = muzzle.addScaledVector(dir, Math.min(u.radius * 0.8, 6) + 1);
      const bolt = this.lasers.fire({
        from: start,
        dir,
        color,
        speed,
        damage: Math.max(1, Math.round(u.S.laser * st.damage * (this.rules?.damage ?? 1))),
        owner: "ufo",
        source: u,
        range: dist * 1.5 + 90,
        radius: st.radius + u.radius * 0.006,
        length: st.length,
        blast: st.blast ? st.blast + (u.S.idx >= 2 ? 0.8 : 0) : u.S.idx >= 2 ? 1.2 : 0,
        sound: false,
      });
      // (A jet's warning display finds homing bolts by itself: see
      // Jet._updateWarning. `vehicle.warn` is its state, not a function.)
      if (st.homing && vehicle) bolt.homing = { target: vehicle, turn: 1.5, life: 6 };
      if (k < n - 1 && n > 1 && !fan) from.y += 0.4; // a burst leaves in a line
    }
    if (this.audio?.playUfoShot) this.audio.playUfoShot(st.sound || "volley", from.distanceTo(this._ears()));
  }

  _ears() {
    return this.camera ? this.camera.position : this.player.position;
  }

  // ---------- The sweeping beam ----------
  // A continuous laser from the ship's underside whose end runs along a line
  // on the ground through the target in about a second and a half. Whatever
  // the line crosses gets burnt: step off the line (sideways) to avoid it.
  _startSweep(u, tgt, vehicle) {
    const st = STYLES[u.style];
    const from = this._muzzle(u, new THREE.Vector3());
    // Aim through where the target will be halfway through the sweep.
    // (On foot: the ground point under the player, so the beam's line crosses their legs.)
    const mid = tgt.pos.clone();
    if (tgt.vel) mid.add(_v.set(tgt.vel.x, vehicle ? tgt.vel.y : 0, tgt.vel.z).multiplyScalar(st.beam * 0.5 * (vehicle ? 1 : 0.6)));
    if (!vehicle) mid.y = this.player.position.y + 0.2;
    const to = mid.clone().sub(from);
    const flat = new THREE.Vector3(to.x, 0, to.z);
    if (flat.lengthSq() < 1e-4) flat.set(1, 0, 0);
    flat.normalize();
    // Sweep across the line of fire (sideways) or along it (toward the ship), at random.
    const across = Math.random() < 0.65;
    const axis = across ? new THREE.Vector3(-flat.z, 0, flat.x) : flat.clone();
    if (Math.random() < 0.5) axis.negate();
    const half = vehicle ? 60 : THREE.MathUtils.clamp(to.length() * 0.18, 12, 30);
    u.sweep = {
      t: 0,
      dur: st.beam,
      a: mid.clone().addScaledVector(axis, -half),
      b: mid.clone().addScaledVector(axis, half),
      vehicle,
      tickT: 0,
      end: new THREE.Vector3(),
      mesh: null,
    };
    if (this.audio?.playUfoShot) this.audio.playUfoShot("sweep", from.distanceTo(this._ears()));
  }

  _sweepMesh() {
    if (!this._sweepGeo) {
      this._sweepGeo = new THREE.CylinderGeometry(1, 1, 1, 10, 1, true).translate(0, 0.5, 0).rotateX(Math.PI / 2);
    }
    const core = new THREE.Mesh(this._sweepGeo, new THREE.MeshBasicMaterial({ color: 0xffffff, fog: true }));
    const halo = new THREE.Mesh(this._sweepGeo, new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.5, blending: THREE.AdditiveBlending, depthWrite: false, fog: true }));
    core.add(halo);
    halo.scale.set(3.4, 3.4, 1);
    core.frustumCulled = false;
    halo.frustumCulled = false;
    core.layers.set(LAYER_FX);
    halo.layers.set(LAYER_FX);
    halo.renderOrder = 13;
    return core;
  }

  _updateSweep(u, dt) {
    const sw = u.sweep;
    sw.t += dt;
    const k = Math.min(1, sw.t / sw.dur);
    const from = this._muzzle(u, _v);
    const aim = _w.copy(sw.a).lerp(sw.b, k);
    const dir = aim.sub(from);
    let len = dir.length();
    if (len < 1e-3 || sw.t > sw.dur) {
      this._endSweep(u);
      return;
    }
    dir.divideScalar(len);
    // Past the aim point to the ground (or whatever is in the way).
    const reach = Math.min(900, len * 1.6 + 40);
    const hit = this.world.raycast(from, dir, reach, { solidOnly: true });
    len = hit ? hit.distance : reach;
    sw.end.copy(from).addScaledVector(dir, len);
    const col = LASER_COLORS[u.laserKey] || LASER_COLORS.red;
    const width = 0.16 + u.radius * 0.01;
    if (!sw.mesh) {
      sw.mesh = this._sweepMesh();
      this.scene.add(sw.mesh);
    }
    const fade = Math.min(1, sw.t / 0.12, (sw.dur - sw.t) / 0.15 + 0.2);
    sw.mesh.position.copy(from);
    sw.mesh.lookAt(sw.end);
    sw.mesh.scale.set(width * fade, width * fade, len);
    sw.mesh.material.color.copy(col).multiplyScalar(0.3).addScalar(1.2);
    sw.mesh.children[0].material.color.copy(col);
    // Where it burns: sparks, smoke and scorch marks on blocks.
    if (hit && u.pos.distanceTo(this.player.position) < 600) {
      const fx = this.effects;
      fx.glow.spawn({ x: sw.end.x, y: sw.end.y, z: sw.end.z, vx: rand(-3, 3), vy: rand(1, 5), vz: rand(-3, 3), life: 0.3, size0: 0.25, size1: 0.05, color0: col, gravity: 0.5, drag: 2 });
      fx.glow.spawn({ x: sw.end.x, y: sw.end.y, z: sw.end.z, life: 0.08, size0: 1.2, size1: 0.3, color0: col, alpha: 0.8 });
      sw.scorchT = (sw.scorchT || 0) - dt;
      if (sw.scorchT <= 0 && this.lasers?.decals && this.world.getChunk(hit.block[0] >> 4, hit.block[2] >> 4)) {
        sw.scorchT = 0.08;
        this.lasers.decals.add(sw.end, hit.block, hit.normal);
      }
    }
    // Damage: whoever the beam touches, a few times a second.
    sw.tickT -= dt;
    if (sw.tickT > 0) return;
    const dmg = Math.max(1, Math.round(u.S.laser * (STYLES[u.style]?.damage ?? 0.5) * (this.rules?.damage ?? 1)));
    const v = this._playerVehicle();
    let touched = false;
    if (v && v.alive) {
      if (segPointDist(from, sw.end, v.pos) < (v.hitRadius ?? v.radius) + width) {
        v.damage(dmg * 2, "ufo_laser");
        v.incoming = 2;
        touched = true;
      }
    } else if (!this.player.dead && !this.player.vehicle) {
      const p = this.player.position;
      let d = Infinity;
      for (let y = 0.1; y < 1.9; y += 0.3) d = Math.min(d, segPointDist(from, sw.end, _x.set(p.x, p.y + y, p.z)));
      if (d < 0.35 + width * 2) {
        this.player.damage(dmg, "ufo_laser", { projectile: true, from });
        touched = true;
      }
    }
    if (touched) sw.tickT = 0.22;
  }

  _endSweep(u) {
    const sw = u.sweep;
    if (sw?.mesh) {
      this.scene.remove(sw.mesh);
      sw.mesh.material.dispose();
      sw.mesh.children[0].material.dispose();
    }
    u.sweep = null;
  }

  _attackOnFoot(u, dt, tgt, dist) {
    // Now and then: the dash abduction (not the giants, not on Peaceful-ish aggression).
    u.abductT = (u.abductT ?? rand(18, 40)) - dt;
    if (u.abductT <= 0 && !u.missionTarget && u.style !== "abductor" && this._agg() > 0.25) {
      u.abductT = rand(40, 75);
      if (Math.random() < 0.55 && this._dashAbduct(u)) return;
    }
    const p = this.player.position;
    const hover = u.info.bottom * u.radius + u.S.hover;
    const horiz = Math.hypot(u.pos.x - p.x, u.pos.z - p.z);
    const abduct = u.style === "abductor" && !this.player.creative && !this.player.isRemote; // (online: only this player can be abducted)
    if (abduct) {
      const goal = new THREE.Vector3(p.x, Math.max(p.y + hover, this._minAltitude(u, 3)), p.z);
      // Fly in very fast, slowing near the spot above the player.
      this._steer(u, goal, u.S.top * (horiz > 40 ? 1 : 0.6), dt, 3.5);
      if (horiz < 3 + u.radius * 0.1 && Math.abs(u.pos.y - goal.y) < 4 && !this.player.dead) {
        u.state = "beam";
        u.timer = rand(12, 20);
        return;
      }
    } else {
      // A gunship: hold a strafing distance and fire.
      const want = THREE.MathUtils.clamp(this.engageRange * 0.45, 40, 160) + u.radius * 0.8;
      const away = _w.copy(u.pos).sub(tgt.pos);
      away.y = 0;
      if (away.lengthSq() < 1) away.set(1, 0, 0);
      away.normalize();
      // Circle around the player at the desired range.
      const tangent = _x.set(-away.z, 0, away.x).multiplyScalar(((u.id % 2) * 2 - 1) * 0.6);
      const goal = _v.copy(tgt.pos).addScaledVector(away, want).addScaledVector(tangent, 30);
      goal.y = Math.max(tgt.pos.y + 12 + u.radius * 0.5 + Math.sin(this.time * 0.7 + u.id) * 6, this._minAltitude(u, 5));
      this._steer(u, goal, u.S.top * 0.7, dt, 2.6);
    }
    // Fire on the way in and while it holds position.
    if (u.shotT <= 0 && dist < this.engageRange && this._canSee(u, tgt.pos)) {
      const st = STYLES[u.style] || STYLES.volley;
      u.shotT = rand(st.rate[0], st.rate[1]) / (0.5 + this._agg() * 0.5);
      if (u.style === "abductor") u.shotT *= 1.6;
      this._attack(u, null, u.S.idx >= 3);
    }
  }

  // The tractor beam on a player on foot: the UFO follows slowly (a walking
  // player can get out), and lifts whoever is inside.
  _beamPlayer(u, dt, tgt) {
    const p = this.player.position;
    const hover = u.info.bottom * u.radius + u.S.hover;
    const goalY = Math.max(this._groundAt(p.x, p.z) + hover, this._minAltitude(u, 3));
    const goal = _w.set(p.x, goalY, p.z);
    this._steer(u, goal, 2.6, dt, 2);
    const beam = this._getBeam(u);
    const top = _v.set(u.pos.x, u.pos.y - u.info.bottom * u.radius, u.pos.z);
    const ground = this._groundAt(u.pos.x, u.pos.z) - 1;
    beam.set(true, top, ground, 3 + u.radius * 0.35);
    // Beaming also lifts animals that happen to be under it.
    this.mobs.beamLift(beam, 3, top.y - 0.3, u);
    // (Online, another player in the beam is lifted on their own machine: see _updatePuppets.)
    if (!this.player.isRemote && !this.beamingPlayer && beam.strength > 0.5 && beam.contains(this.player.position.clone().setY(p.y + 0.9))) {
      this.beamingPlayer = u;
      this._beamTime = 0;
      this._beamStartY = p.y;
      this._beamPeak = 0;
    }
    if (u.shotT <= 0 && this.beamingPlayer !== u && u.timer < 8) {
      u.shotT = rand(2, 3.5);
      this._attack(u);
    }
    if (u.timer <= 0 || this.player.dead || tgt.vehicle) {
      beam.set(false);
      u.state = "attack";
      u.timer = 0;
      u.dashAbduct = false;
      u.beamVictim = null;
    }
  }

  _updatePlayerBeam(dt, u) {
    const pl = this.player;
    const held = this.beamingPlayer;
    if (!held) return;
    const beam = held.beam;
    const center = pl.position.clone();
    center.y += 0.9;
    const inside = !!(beam && beam.on && beam.strength > 0.3 && !pl.dead && !pl.vehicle && beam.contains(center, 0.2));
    if (inside) {
      this._beamTime += dt;
      pl.beamLift = this.config.beamLift;
      // A gentle pull toward the middle of the beam.
      pl.beamPull.set((beam.top.x - pl.position.x) * 0.6, 0, (beam.top.z - pl.position.z) * 0.6);
      this._beamPeak = Math.max(this._beamPeak, pl.position.y - this._beamStartY);
      if (pl.position.y + 1.8 >= beam.top.y - 0.4) {
        // Reached the ship: abducted.
        this.beamingPlayer = null;
        if (!held.net) {
          held.state = "roam";
          held.dashAbduct = false;
          held.beamVictim = null;
          if (held.beam) held.beam.set(false);
        }
        if (this.onAbductPlayer) this.onAbductPlayer(held);
        if (!held.net && !held.noLeave && !held.missionTarget && !held.byPlayer && Math.random() < 0.5) this._leave(held);
      }
      return;
    }
    // Out of the beam (or the beam stopped): escaped, if it had a real grip.
    this.beamingPlayer = null;
    if (!pl.dead && this._beamTime > 1 && this._beamPeak > 2 && this.onEscape) this.onEscape(held);
    this._beamTime = 0;
  }

  // Shot at (on foot): a counter-volley, or evasive moves.
  _react(u, dt, tgt, dist) {
    if (u.reaction === "counter") {
      // Hold position at a comfortable range and fire volleys.
      const away = _w.copy(u.pos).sub(tgt.pos);
      away.y = 0;
      const want = away.lengthSq() > 1 ? away.normalize().multiplyScalar(THREE.MathUtils.clamp(dist, 25, 60)) : away.set(30, 0, 0);
      const goal = want.add(tgt.pos);
      goal.y = Math.max(tgt.pos.y + 14 + u.radius * 0.4, this._minAltitude(u, 5));
      this._steer(u, goal, u.S.top * 0.6, dt, 3);
      if (u.shotT <= 0) {
        const st = STYLES[u.style] || STYLES.volley;
        u.shotT = rand(st.rate[0] * 0.5, st.rate[1] * 0.6);
        this._attack(u);
      }
    } else {
      // Evasive: short sideways dashes, altitude changes, strafing circles.
      u.jinkT = (u.jinkT ?? 0) - dt;
      if (!u.jink || u.jinkT <= 0) {
        u.jinkT = rand(0.6, 1.3);
        const toP = _w.copy(tgt.pos).sub(u.pos);
        toP.y = 0;
        toP.normalize();
        const side = new THREE.Vector3(-toP.z, 0, toP.x).multiplyScalar(Math.random() < 0.5 ? 1 : -1);
        u.jink = side.multiplyScalar(u.S.top * rand(0.7, 1.1));
        u.jink.y = rand(-1, 1) * u.S.top * 0.45;
      }
      u.vel.lerp(u.jink, Math.min(1, dt * 5));
      if (u.shotT <= 0 && Math.random() < 0.5) {
        u.shotT = rand(1, 2);
        this._attack(u);
      }
    }
    if (u.timer <= 0) {
      u.state = this.player.creative ? "roam" : "attack";
      u.timer = 0;
    }
  }

  // Against a player in a vehicle: evaders flee (most slightly slower than
  // the jet at full throttle, "fast" ones faster), fighters make attack
  // passes with their weapons. Hostile UFOs vs a player flying a UFO fight.
  _attackVehicle(u, dt, tgt, dist) {
    const v = tgt.vehicle;
    const jet = v.type === "jet";
    const flee = jet && u.personality !== "fighter" && !u.hostile;
    // (Measured against the jet being flown: the two jets differ a little.)
    const jetTop = (jet && v.cfg?.maxSpeed) || this.jetMaxSpeed;
    if (flee) {
      const topSpeed = jetTop * u.fleeFactor;
      const away = _w.copy(u.pos).sub(v.pos).normalize();
      // Evasive weaving while running.
      const t = this.time * 1.7 + u.id;
      const side = new THREE.Vector3(-away.z, 0, away.x);
      const dir = away.multiplyScalar(1).addScaledVector(side, Math.sin(t) * 0.45);
      dir.y += Math.sin(t * 1.3) * 0.25;
      const ground = this._minAltitude(u, 8);
      if (u.pos.y < ground + 10) dir.y = Math.abs(dir.y) + 0.3;
      dir.normalize().multiplyScalar(topSpeed);
      u.vel.lerp(dir, Math.min(1, dt * 1.6));
      // Parting shots now and then.
      if (u.shotT <= 0 && dist < this.engageRange && Math.random() < 0.3) {
        u.shotT = rand(2, 4);
        this._attack(u, v);
        v.incoming = 2;
      }
      if (dist > this.range * 1.2) {
        u.state = "roam";
        u.waypoint = null;
      }
      return;
    }
    // Attack passes: rush at the target, overshoot, turn around, repeat.
    u.passT = (u.passT ?? 0) - dt;
    if (!u.pass || u.passT <= 0) {
      u.passT = rand(3, 6);
      u.pass = new THREE.Vector3(rand(-1, 1), rand(-0.3, 0.5), rand(-1, 1)).normalize().multiplyScalar(rand(40, 90));
    }
    const goal = _w.copy(v.pos).add(u.pass);
    const topSpeed = jet ? jetTop * 0.9 : u.S.top;
    this._steer(u, goal, topSpeed, dt, 2.2);
    if (u.shotT <= 0 && dist < this.engageRange && this._canSee(u, v.pos)) {
      const st = STYLES[u.style] || STYLES.volley;
      u.shotT = rand(st.rate[0], st.rate[1]) / (0.5 + this._agg() * 0.5);
      this._attack(u, v, u.S.idx >= 3);
      v.incoming = 2;
    }
    // A fighter lining up a head-on pass sets off the warning too.
    if (dist < 220 && u.vel.lengthSq() > 1 && _v.copy(v.pos).sub(u.pos).normalize().dot(_w.copy(u.vel).normalize()) > 0.85) v.incoming = Math.max(v.incoming || 0, 1);
  }

  // ---------- Shot down ----------

  _shotDown(u) {
    this._stopWeapons(u);
    u.falling = true;
    u.state = "falling";
    u.health = 0;
    u.hostile = false;
    if (u.beam) u.beam.set(false);
    if (this.beamingPlayer === u) this.beamingPlayer = null;
    this._dropTarget(u);
    u.fallSpin = rand(1.5, 3.5) * (Math.random() < 0.5 ? -1 : 1);
    u.vel.y = Math.min(u.vel.y, 2);
    u.fallFrom = u.pos.y; // (the crash's blast grows with the height it fell from)
    u.fireT = 0;
    u.model.setDead?.(true); // every light off, for good
    // A burst of flame where it was hit.
    const fx = this.effects;
    const c = this._fireC || (this._fireC = [new THREE.Color(3, 1.3, 0.3), new THREE.Color(0.8, 0.15, 0.03), new THREE.Color(0.15, 0.13, 0.12), new THREE.Color(0.45, 0.43, 0.4)]);
    for (let i = 0; i < 20 * effectsQuality.scale; i++) {
      fx.glow.spawn({ x: u.pos.x, y: u.pos.y, z: u.pos.z, vx: rand(-8, 8), vy: rand(-2, 8), vz: rand(-8, 8), life: rand(0.4, 0.9), size0: u.radius * 0.5, size1: u.radius * 0.9, color0: c[0], color1: c[1], alpha: 0.5, drag: 2.5 });
    }
    if (this.audio?.playUfoHit) this.audio.playUfoHit(u.pos.distanceTo(this._ears()), true);
    // (Online: a guest's kill far away, or a patrol jet's anywhere, is no news here.)
    const mine = u.byPlayer && (u.lastHitPid ?? 1) === 1;
    if (mine || u.pos.distanceTo(this._ears()) < Math.max(150, this.viewDistance)) this.onMessage?.(mine ? "UFO hit! It's going down!" : "A UFO is going down!");
  }

  _fall(u, dt) {
    const bottom = u.info.bottom * u.radius;
    const bx = Math.floor(u.pos.x);
    const bz = Math.floor(u.pos.z);
    const inWater = IS_WET[this.world.getBlock(bx, Math.floor(u.pos.y - bottom * 0.3), bz)] === 1 || (u.pos.y - bottom < SEA_LEVEL + 1 && this._waterAt(u.pos.x, u.pos.z) && !this.world.getChunk(bx >> 4, bz >> 4));
    if (inWater) {
      // Into the sea: it slows, and sinks toward the sea floor.
      if (!u.splashed) {
        // A big splash and it sinks (it explodes on the sea floor, in _crash).
        u.splashed = true;
        this._splash(u, 2.2);
      }
      u.vel.y = Math.max(u.vel.y - 3 * dt, -10);
      u.vel.multiplyScalar(Math.exp(-1.1 * dt));
      u.yaw += u.fallSpin * dt * 0.3;
      u.fireT -= dt;
      if (u.fireT <= 0) {
        u.fireT = 0.12;
        for (let i = 0; i < 2; i++) this.effects.smoke.spawn({ x: u.pos.x + rand(-1, 1) * u.radius * 0.5, y: u.pos.y + rand(0, 1), z: u.pos.z + rand(-1, 1) * u.radius * 0.5, vx: 0, vy: 2.2, vz: 0, life: rand(0.7, 1.4), size0: 0.5, size1: 1.6, color0: WATER_C[0], color1: WATER_C[1], alpha: 0.4, drag: 0.8 });
      }
    } else {
      u.vel.y -= 16 * dt;
      u.vel.x *= Math.exp(-0.2 * dt);
      u.vel.z *= Math.exp(-0.2 * dt);
      u.yaw += u.fallSpin * dt;
      u.tilt.x += (0.55 * Math.sign(u.fallSpin) - u.tilt.x) * dt;
      // Fire and a thick smoke trail.
      const fx = this.effects;
      const c = this._fireC;
      u.fireT -= dt;
      if (u.fireT <= 0) {
        u.fireT = 0.03 / effectsQuality.scale;
        const r = u.radius * 0.6;
        fx.glow.spawn({ x: u.pos.x + rand(-r, r), y: u.pos.y, z: u.pos.z + rand(-r, r), vx: 0, vy: 2, vz: 0, life: rand(0.3, 0.6), size0: Math.min(6, u.radius * 0.45), size1: Math.min(8, u.radius * 0.7), color0: c[0], color1: c[1], alpha: 0.5, drag: 2 });
        fx.smoke.spawn({ x: u.pos.x + rand(-r, r), y: u.pos.y + 0.5, z: u.pos.z + rand(-r, r), vx: rand(-0.5, 0.5), vy: 1.2, vz: rand(-0.5, 0.5), life: rand(3.5, 6), size0: Math.min(4, u.radius * 0.4), size1: Math.min(12, u.radius * 1.2), color0: c[2], color1: c[3], alpha: 0.55, drag: 0.6 });
      }
    }
    u.model.lightsOn = 0; // dark: nothing glows any more
    u.pos.addScaledVector(u.vel, dt);
    // Hit the ground (solid terrain, or the sea floor): crash.
    // (Loaded: the live ground, so a crater dug below the natural height is
    // fallen into, not hit in mid-air; the floor catches a fast fall.)
    let hitGround = false;
    if (this.world.getChunk(bx >> 4, bz >> 4)) {
      const id = this.world.getBlock(bx, Math.floor(u.pos.y - bottom), bz);
      hitGround = IS_SOLID[id] === 1 || u.pos.y - bottom <= this._floorAt(bx, bz) + 1;
    } else hitGround = u.pos.y - bottom <= this.world.heightAt(bx, bz) + 1;
    if (hitGround || u.pos.y < 0) this._crash(u);
  }

  // The water thrown up over a ship that blew up on the sea floor.
  _geyser(u, size) {
    const fx = this.effects;
    const n = Math.round((30 + size * 2.5) * effectsQuality.scale);
    const r = Math.min(size * 0.5, 22);
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const d = Math.random() * r;
      fx.smoke.spawn({ x: u.pos.x + Math.cos(a) * d, y: SEA_LEVEL + 1, z: u.pos.z + Math.sin(a) * d, vx: Math.cos(a) * rand(0, 5), vy: rand(10, 26) * Math.sqrt(size / 8), vz: Math.sin(a) * rand(0, 5), life: rand(1.2, 2.4), size0: 1 + r * 0.08, size1: 3 + r * 0.25, color0: WATER_C[0], color1: WATER_C[1], alpha: 0.6, drag: 0.6, gravity: 0.8 });
    }
    if (this.audio?.playSplash && u.pos.distanceTo(this._ears()) < 200) this.audio.playSplash();
  }

  _crash(u) {
    const fx = this.effects;
    const bottom = u.info.bottom * u.radius;
    const bx = Math.floor(u.pos.x);
    const bz = Math.floor(u.pos.z);
    const floor = this._floorAt(bx, bz) + 1; // top face of the solid ground (the sea floor under water)
    const water = floor < SEA_LEVEL + 1 && this._waterAt(u.pos.x, u.pos.z);
    // Random outcome: a huge explosion that leaves a burnt-out, unusable
    // wreck (likelier for big ships), or an intact ship that can be flown.
    // (u.crashPlan = { exploded, crew } fixes the outcome: for tests.)
    let exploded = u.crashPlan?.exploded ?? Math.random() < 0.38 + 0.06 * u.S.idx;
    if (this.forceIntact && u.byPlayer && u.crashPlan?.exploded === undefined) {
      exploded = false;
      this.forceIntact = false;
    }
    // The blast grows with the ship and (Round 8) with the height it fell
    // from: a ship shot down high up hits the ground hard and blows a big
    // crater, one that only dropped a few blocks makes a small bang. The
    // crater is capped (the terrain would not survive more), but the
    // fireball, the shock ring, the shake and the roar follow it all the way:
    // a scout makes a bang, a mothership from high up a mushroom of fire.
    const fallH = Math.max(0, (u.fallFrom ?? u.pos.y) - floor);
    const hf = THREE.MathUtils.clamp(0.25 + fallH / 60, 0.25, 1.8);
    const radius = exploded ? Math.min(48, (6 + u.radius * 0.9) * hf) : Math.min(16, (3 + u.radius * 0.5) * Math.min(1.2, hf));
    const visual = (exploded ? 8 + u.radius * 1.15 : 5 + u.radius * 0.8) * (0.5 + 0.5 * hf);
    const at = new THREE.Vector3(u.pos.x, Math.max(floor + 0.5, u.pos.y - bottom * 0.5), u.pos.z);
    // (In the sea it goes off on the sea floor, under the water; the water
    // above comes up as a geyser.)
    fx.explode(at, { radius: water ? Math.min(radius, 14) : radius, visual: water ? visual * 0.75 : visual, source: "ufo_crash" });
    if (water) this._geyser(u, visual);
    // The hull is embedded in the ground (in water it sits on the sea floor,
    // below the surface): its lower part intersects the terrain blocks.
    const tilt = [rand(-0.5, 0.5) * (exploded ? 1.4 : 1), rand(-0.5, 0.5) * (exploded ? 1.4 : 1)];
    const embed = bottom * 0.45 + Math.min(3, u.radius * 0.08) + Math.abs(Math.sin(tilt[0])) * u.radius * 0.25;
    // (Measured after the blast: the crater lowered the ground under it.)
    const floorAfter = this._floorAt(bx, bz) + 1;
    const wreckY = Math.min(floor, floorAfter + 1.5) + bottom - embed;
    const wreck = this.vehicles?.create("ufo", {
      spec: u.spec,
      design: u.design,
      radius: u.radius,
      pos: [at.x, wreckY, at.z],
      yaw: u.yaw,
      crashed: true,
      wreck: exploded,
      tilt,
      health: Math.round((120 + u.radius * 40) * 0.4),
      style: u.style, // flown by the player, it fights the way it did
    });
    if (wreck) {
      wreck.byPlayer = u.byPlayer;
      // Only the newest intact wrecks are kept; the far, old ones are cleaned up.
      if (!exploded) this._pruneWrecks(wreck);
    }
    // Its crew climbs out: a random number, and a random mix of kinds. (They
    // come out of an exploded wreck too: the survivors.)
    const [lo, hi] = u.S.crew;
    const crew = u.crashPlan?.crew ?? Math.max(1, Math.round(lo + Math.pow(Math.random(), 1.5) * (hi - lo) + (Math.random() < 0.15 ? hi - lo : 0)));
    this.pendingCrews.push({ pos: new THREE.Vector3(at.x, wreckY, at.z), count: Math.min(10, crew), radius: u.radius, delay: exploded ? 2.2 : 1.2, water, sizeIdx: u.S.idx, kind: u.crashPlan?.crewKind ?? u.crewKind ?? this._crewKind(u.S.idx) });
    if (this.onShotDown) this.onShotDown(u, u.byPlayer);
    if (this.onCrash) this.onCrash({ ufo: u, pos: at, exploded, wreck, byPlayer: u.byPlayer, crew: Math.min(10, crew) });
    u.state = "gone";
  }

  // Keeps only the newest intact wrecks (the oldest, far from the player, go).
  _pruneWrecks(newest) {
    const list = this.vehicles.vehicles.filter((v) => v.type === "ufo" && v.crashed && !v.wreck && v.alive && v !== newest);
    if (list.length + 1 <= MAX_KEPT_WRECKS) return;
    const p = this.player.position;
    list.sort((a, b) => b.pos.distanceTo(p) - a.pos.distanceTo(p));
    while (list.length + 1 > MAX_KEPT_WRECKS) this.vehicles.remove(list.shift());
  }

  // Aliens climb out of a wreck once its ground is loaded: the ship's crew,
  // all of one kind (green, gray or red). Beside a wreck in the sea they
  // wade out onto the nearest shore.
  _updateCrews(dt) {
    for (let i = this.pendingCrews.length - 1; i >= 0; i--) {
      const c = this.pendingCrews[i];
      c.delay -= dt;
      if (c.delay > 0) continue;
      const [near, nd] = this._nearestPlayer(c.pos);
      if (nd > Math.max(150, this.viewDistance)) continue;
      const bx = Math.floor(c.pos.x);
      const bz = Math.floor(c.pos.z);
      // (Online the host keeps the ground around the other players generated
      // but not drawn: a crew can climb out there too, as in mobs.js.)
      const ch = this.world.getChunk(bx >> 4, bz >> 4);
      if (!ch || !(ch.meshed || (this.targets && near !== this.localPlayer))) continue;
      let spawned = 0;
      // (Beside a wreck in the sea they come up in the water around it, and
      // swim (or wade) toward the player: they are not sent to the nearest shore.)
      const reach = c.water ? 4 + c.radius * 0.35 : 6;
      for (let k = 0; k < c.count * 8 && spawned < c.count; k++) {
        const a = Math.random() * Math.PI * 2;
        const d = c.radius * 0.8 + 1.5 + Math.random() * (c.water ? reach : 4 + c.radius * 0.15);
        const x = Math.floor(c.pos.x + Math.cos(a) * d);
        const z = Math.floor(c.pos.z + Math.sin(a) * d);
        if (!this.world.getChunk(x >> 4, z >> 4)) continue;
        const top = this.world.surfaceY(x, z);
        if (top < 0) continue;
        if (c.water) {
          // Open water: the sea floor below the surface and water at the surface.
          if (top >= SEA_LEVEL - 1 || !IS_WET[this.world.getBlock(x, SEA_LEVEL, z)] || this.world.getBlock(x, SEA_LEVEL + 1, z) !== BLOCK.AIR) continue;
          const kind = c.kind || (c.kind = this._crewKind(c.sizeIdx));
          const m = this.mobs.spawn(kind, x + 0.5, SEA_LEVEL + 0.3, z + 0.5, { wet: true });
          if (m) {
            m.ai.target = true;
            m.aggro = true;
            spawned++;
          }
          continue;
        }
        const id = this.world.getBlock(x, top + 1, z);
        if (IS_SOLID[id] || IS_WET[id] || this.world.getBlock(x, top + 2, z) !== BLOCK.AIR) continue;
        const kind = c.kind || (c.kind = this._crewKind(c.sizeIdx));
        const m = this.mobs.spawn(kind, x + 0.5, top + 1, z + 0.5);
        if (m) {
          m.ai.target = true;
          m.aggro = true; // they hunt the player at once
          spawned++;
        }
      }
      if (spawned === 0 && (c.tries = (c.tries || 0) + 1) < 8) {
        c.delay = 0.6; // no room found around the wreck this time (rock, trees, water): try again
        continue;
      }
      if (spawned > 0 && this.audio?.playMob) this.audio.playMob("alien", "idle", c.pos.distanceTo(this.player.position));
      this.pendingCrews.splice(i, 1);
    }
  }

  // A ship's crew: green foot soldiers, gray sharpshooters or red brutes
  // (the tougher kinds more often on bigger ships; in Survival the current
  // mission decides which kinds are about: `rules.crew`).
  _crewKind(sizeIdx) {
    const w = this.rules?.crew;
    if (w) {
      const total = (w.alien ?? 0) + (w.alien_gray ?? 0) + (w.alien_red ?? 0) + (w.alien_blue ?? 0);
      if (total > 0) {
        let r = Math.random() * total;
        for (const k of ["alien", "alien_gray", "alien_blue", "alien_red"]) {
          r -= w[k] ?? 0;
          if (r <= 0) return k;
        }
      }
    }
    const r = Math.random();
    const red = 0.05 + sizeIdx * 0.06;
    const gray = 0.22 + sizeIdx * 0.03;
    const blue = 0.1 + sizeIdx * 0.02;
    return r < red ? "alien_red" : r < red + gray ? "alien_gray" : r < red + gray + blue ? "alien_blue" : "alien";
  }

  // ---------- Drawing ----------

  _place(u, dt, dist = u.pos.distanceTo(this.player.position), night = this.night) {
    const m = u.model;
    m.root.position.copy(u.pos);
    // Designs with a front (tic-tac, triangle, boomerang, cylinder) point where
    // they go instead of spinning.
    const facing = designFacingOffset(u.design);
    if (!u.falling) {
      if (facing === null) u.yaw += (u.spin * (u.spinBoost || 1)) * dt;
      u.spinBoost = 1;
      // Bank into the direction of motion.
      const localV = _v.copy(u.vel).applyAxisAngle(_up, -u.yaw);
      const sp = Math.max(4, u.S.top);
      u.tilt.x += (THREE.MathUtils.clamp(localV.z / sp, -1, 1) * 0.35 - u.tilt.x) * Math.min(1, dt * 3);
      u.tilt.y += (THREE.MathUtils.clamp(-localV.x / sp, -1, 1) * 0.35 - u.tilt.y) * Math.min(1, dt * 3);
    }
    if (facing !== null && !u.falling && u.vel.lengthSq() > 1) {
      const heading = Math.atan2(-u.vel.x, -u.vel.z) + facing;
      u.yaw += Math.atan2(Math.sin(heading - u.yaw), Math.cos(heading - u.yaw)) * Math.min(1, dt * 3);
    }
    m.body.rotation.set(u.tilt.x, u.yaw, u.tilt.y, "YXZ");
    // Growing in from a dot after appearing far away.
    const grow = u.age >= u.spawnFade ? 1 : 0.12 + 0.88 * (u.age / u.spawnFade) ** 1.5;
    m.body.scale.setScalar(u.radius * grow);
    m.setFar(dist > 240);
    m.root.visible = dist < 1900;
    // Far away the halo fades in as it approaches (no lights popping in).
    const fade = THREE.MathUtils.clamp((1800 - dist) / 500, 0, 1) * grow * grow;
    m.light.sky = 15;
    m.light.block = 0;
    const hurt = Math.max(0, 1 - u.hurtTime / 0.2);
    m.light.flash.setRGB(0.7 * hurt, 0.15 * hurt, 0);
    if (!u.falling) m.lightsOn = 1;
    m.animate(this.time, { night: night * fade, damage: 1 - u.health / u.maxHealth, beam: u.beam?.strength ?? 0, speed: u.vel.length(), angry: u.hostile ? 1 : 0 });
    m.halo.material.opacity *= fade;
    m.halo.scale.setScalar(u.radius * 3.2 * grow);
    // Damaged: a smoke trail.
    if (!u.falling && u.health < u.maxHealth * 0.5 && dist < 400 && Math.random() < dt * 8 * effectsQuality.scale) {
      const c = this._smokeC || (this._smokeC = [new THREE.Color(0.2, 0.19, 0.18), new THREE.Color(0.5, 0.49, 0.47)]);
      this.effects.smoke.spawn({ x: u.pos.x, y: u.pos.y, z: u.pos.z, vx: 0, vy: 1, vz: 0, life: 2.5, size0: u.radius * 0.3, size1: u.radius * 0.8, color0: c[0], color1: c[1], alpha: 0.4, drag: 1 });
    }
  }

  // Mods off: every UFO (and waiting crew) disappears; mods on: they come
  // back over time.
  setEnabled(on) {
    this.enabled = on;
    if (!on) {
      while (this.ufos.length) this._remove(this.ufos.length - 1);
      this.trail.clear();
      this.pendingCrews.length = 0;
      this.beamingPlayer = null;
      if (this.audio?.setUfoHum) this.audio.setUfoHum(0, 0);
    }
  }

  clear() {
    while (this.ufos.length) this._remove(this.ufos.length - 1);
    this.trail.clear();
    // (update() may not run again to quiet the hum: a Dogfight disables it.)
    this.pendingCrews.length = 0;
    this.beamingPlayer = null;
    if (this.audio?.setUfoHum) this.audio.setUfoHum(0, 0);
  }

  // A moment's peace after a respawn: for everyone offline (graceT), online
  // only for the player who came back (their graceUntil; Round 9: a guest's
  // too, the host is told: net/coop.js).
  _inGrace() {
    return this.graceT > 0 || (this.player?.graceUntil ?? -1) > this.time;
  }

  // After a respawn: every UFO loses interest, and none notices the player
  // for a while (no abduction straight after an abduction).
  playerRespawned(seconds = 30) {
    this.graceT = seconds;
    this.beamingPlayer = null;
    for (const u of this.ufos) {
      u.hostile = false;
      u.hostileT = 0;
      u.stare = 0;
      this._stopWeapons(u);
      if (u.state === "attack" || u.state === "react" || u.state === "beam" || u.state === "circle") {
        u.state = "roam";
        u.waypoint = null;
        if (u.beam) u.beam.set(false);
      }
    }
  }
}
